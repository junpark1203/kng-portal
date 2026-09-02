/**
 * 입출고 관리 프론트엔드 로직
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    window.parent.getAuthToken().then(t => {
                        if (t) { res(t); }
                        else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                        else { _authReady = Promise.resolve(null); res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = Promise.resolve(null); res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = Promise.resolve(null); res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = Promise.resolve(null); res(null); }
            }
        })();
    });
    return _authReady;
}

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    if (!token) {
        try { token = await waitForAuth(); } catch(e) {}
    }
    
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    options.headers['Content-Type'] = 'application/json';
    
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return res.json();
}

const $ = id => document.getElementById(id);
let locations = [];
let availableLots = []; // 출고 시 선택된 품목+규격의 잔여 Lot 목록

const app = {
    init: async function() {
        this.bindEvents();
        await this.loadLocations();
        this.initTodayDates();
        this.setupInboundAutocomplete();
        this.setupOutboundAutocomplete();
        this.setupPartnerAutocomplete();
        this.loadCategories();
        this.loadHistory();
    },

    
    categoryList: [],

    async loadCategories() {
        try {
            const res = await authFetch(`${API_BASE}/categories`);
            this.categoryList = Array.isArray(res) ? res : [];
            const datalist = $('categoryDatalist');
            const pillsContainer = $('categoryPillsContainer');
            
            if (datalist) {
                datalist.innerHTML = this.categoryList.map(c => `<option value="${c}"></option>`).join('');
            }
            if (pillsContainer) {
                const pillsHtml = this.categoryList.map(c => 
                    `<button type="button" class="btn btn-sm btn-outline-secondary rounded-pill" onclick="app.filterByCategory('${c}')">${c}</button>`
                ).join('');
                pillsContainer.innerHTML = `
                    <button type="button" class="btn btn-sm btn-secondary rounded-pill" onclick="app.filterByCategory('')">전체보기</button>
                    ${pillsHtml}
                `;
            }
            this.setupCategoryAutocomplete();
        } catch (err) {
            console.error('Failed to load categories', err);
        }
    },

    setupCategoryAutocomplete() {
        const inputs = document.querySelectorAll('.category-input, #in_category, #out_category, #dir_category, #bulkCategory, #edit_in_category, #edit_out_category, #edit_direct_category');
        
        inputs.forEach(input => {
            if (input.dataset.autocompleteAttached) return;
            input.dataset.autocompleteAttached = 'true';

            const container = input.parentElement;
            let sug = container.querySelector('.autocomplete-suggestions');
            if (!sug) {
                sug = document.createElement('div');
                sug.className = 'autocomplete-suggestions';
                sug.style.display = 'none';
                container.appendChild(sug);
            }

            const renderSuggestions = (query) => {
                const q = (query || '').trim().toLowerCase();
                const list = this.categoryList && this.categoryList.length > 0 
                    ? this.categoryList 
                    : ['유압유', '기어유', '그리스', '테일씰그리스', '절삭유', '작동유', '방청유', '엔진오일', '열매체유', '콤프레샤유', '세척유', '방전유', '안전용품', '기타'];
                
                const filtered = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) {
                    sug.style.display = 'none';
                    return;
                }
                sug.innerHTML = filtered.map(c => {
                    return `<div class="autocomplete-suggestion" style="padding: 7px 12px; cursor: pointer; font-size: 0.85rem; border-bottom: 1px solid #f1f5f9;"><i class='bx bx-purchase-tag-alt text-primary me-1' style='font-size: 0.85rem;'></i>${c}</div>`;
                }).join('');
                sug.style.display = 'block';

                sug.querySelectorAll('.autocomplete-suggestion').forEach(itemDiv => {
                    itemDiv.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        input.value = itemDiv.textContent.trim();
                        sug.style.display = 'none';
                        input.dispatchEvent(new Event('change'));
                    });
                });
            };

            input.addEventListener('focus', () => {
                renderSuggestions(input.value);
            });

            input.addEventListener('click', () => {
                renderSuggestions(input.value);
            });

            input.addEventListener('input', (e) => {
                renderSuggestions(e.target.value);
            });

            input.addEventListener('blur', () => {
                setTimeout(() => { sug.style.display = 'none'; }, 200);
            });
        });

        if (!this._globalCategoryClickListener) {
            this._globalCategoryClickListener = true;
            document.addEventListener('click', (e) => {
                if (!e.target.classList.contains('category-input') && !e.target.closest('.autocomplete-suggestions')) {
                    document.querySelectorAll('.category-input + .autocomplete-suggestions, .position-relative > .autocomplete-suggestions').forEach(s => {
                        s.style.display = 'none';
                    });
                }
            });
        }
    },

    filterByCategory(cat) {
        this.detailedFilters.category = cat;
        this.resetPageAndLoadHistory();
        if($('inboundForm')) { $('inboundForm').dataset.mode = ''; $('inboundForm').dataset.txId = ''; }
        if($('outboundForm')) { $('outboundForm').dataset.mode = ''; $('outboundForm').dataset.txId = ''; }
        if($('directForm')) { $('directForm').dataset.mode = ''; $('directForm').dataset.txId = ''; }
    },

    bindEvents: function() {
        $('inboundForm').addEventListener('submit', this.handleInboundSubmit.bind(this));
        $('outboundForm').addEventListener('submit', this.handleOutboundSubmit.bind(this));
        $('directForm').addEventListener('submit', this.handleDirectSubmit.bind(this));
        const eif = $('editInboundForm');
        if (eif) eif.addEventListener('submit', this.submitEditInbound.bind(this));
        
        const eof = $('editOutboundForm');
        if (eof) eof.addEventListener('submit', this.submitEditOutbound.bind(this));
        
        const edf = $('editDirectForm');
        if (edf) edf.addEventListener('submit', this.submitEditDirectOutbound.bind(this));
        
        const beol = $('btnEditOutboundLot');
        if (beol) beol.addEventListener('click', this.openEditOutboundLotModal.bind(this));
        
        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.id !== 'in_item') {
                const s = $('in_item_suggestions');
                if(s) s.style.display = 'none';
            }
            if (e.target.id !== 'out_item') {
                const s = $('out_item_suggestions');
                if(s) s.style.display = 'none';
            }
        });
    },

    // ----------------------------------------
    // History & Deletion (내역 및 삭제)
    // ----------------------------------------
    currentPage: 1,
    sortCol: 'date',
    sortDir: 'desc',
    detailedFilters: {
        startDate: '',
        endDate: '',
        category: ''
    },

    toggleSort: function(colName) {
        if (this.sortCol === colName) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortCol = colName;
            this.sortDir = 'desc';
        }
        
        document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');
        const icon = this.sortDir === 'asc' ? ' 🔼' : ' 🔽';
        const th = document.getElementById('th-' + colName);
        if (th) {
            th.querySelector('.sort-icon').innerHTML = icon;
        }

        this.resetPageAndLoadHistory();
    },

    openDetailedSearch: function() {
        const modalEl = document.getElementById('detailedSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    applyDetailedSearch: function() {
        this.detailedFilters.startDate = $('ds_start_date').value;
        this.detailedFilters.endDate = $('ds_end_date').value;
        this.detailedFilters.searchParty = $('ds_party').value.trim();
        this.detailedFilters.searchItem = $('ds_item').value.trim();
        this.detailedFilters.searchSpec = $('ds_spec').value.trim();

        const modalEl = document.getElementById('detailedSearchModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        this.resetPageAndLoadHistory();
    },

    resetDetailedSearch: function() {
        $('dsForm').reset();
        this.detailedFilters = {
            startDate: '', endDate: '', searchParty: '', searchItem: '', searchSpec: ''
        };
        this.resetPageAndLoadHistory();
    },

    resetPageAndLoadHistory: function() {
        this.currentPage = 1;
        this.loadHistory();
    },

    changeHistoryPage: function(page) {
        this.currentPage = page;
        this.loadHistory();
    },

    loadHistory: async function() {
        const typeFilter = document.querySelector('input[name="historyFilter"]:checked').value;
        const searchRaw = $('historySearch').value.trim();
        const limit = parseInt($('historyLimit').value) || 50;

        const params = new URLSearchParams({
            page: this.currentPage,
            limit: limit,
            type: typeFilter,
            search: searchRaw,
            sortCol: this.sortCol,
            sortDir: this.sortDir,
            startDate: $('searchStartDate')?.value || '',
            endDate: $('searchEndDate')?.value || '',
            searchTarget: $('searchTarget')?.value || '',
            searchKeyword: searchRaw
        });

        try {
            $('historyTbody').innerHTML = `<tr><td colspan="16" class="text-center text-muted">데이터를 불러오는 중입니다...</td></tr>`;
            
            const res = await authFetch(`${API_BASE}/history?${params.toString()}`);
            this.currentHistoryData = res.data;
            this.renderHistoryTable(res.data);
            this.renderPagination(res.total, res.page, res.limit);
        } catch (err) {
            console.error('History load error:', err);
            $('historyTbody').innerHTML = `<tr><td colspan="16" class="text-center text-danger">내역을 불러오지 못했습니다.</td></tr>`;
        }
    },

    renderPagination: function(total, currentPage, limit) {
        const totalPages = Math.ceil(total / limit) || 1;
        const ul = $('historyPagination');
        
        let html = '';
        
        // Prev button
        if (currentPage > 1) {
            html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${currentPage - 1})">이전</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">이전</span></li>`;
        }

        // Display up to 5 page numbers around the current page
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
            } else {
                html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${i})">${i}</button></li>`;
            }
        }

        // Next button
        if (currentPage < totalPages) {
            html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${currentPage + 1})">다음</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">다음</span></li>`;
        }

        ul.innerHTML = html;
    },

    renderHistoryTable: function(data) {
        const tbody = $('historyTbody');
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="16" class="text-center text-muted">해당하는 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(r => {
            const isOut = r.type === 'outbound';
            let badge = isOut ? `<span class="badge bg-danger">출고</span>` : `<span class="badge bg-success">입고</span>`;
            if (isOut && r.is_direct === 1) {
                badge = `<span class="badge bg-warning text-dark">직출고</span>`;
            }
            if (r.trade_type && r.trade_type !== '내수') {
                badge += ` <span class="badge bg-info text-dark">${r.trade_type}</span>`;
            }
            const delFn = isOut ? `app.deleteOutbound(${r.id})` : `app.deleteInbound(${r.id})`;
            const checkbox = `<input type="checkbox" class="history-checkbox" value="${r.id}" data-type="${r.type}">`;
            const editFn = isOut ? (r.type === '직출고' || r.is_direct === 1 ? `app.openEditDirectOutboundTx('${r.transaction_group_id}')` : `app.openEditOutboundTx('${r.transaction_group_id}')`) : `app.openEditInboundTx('${r.transaction_group_id}')`;
            
            const renderCell = (val, isNumber = false) => {
                if (val === null || val === undefined || val === '') return `<span class="text-muted">-</span>`;
                return isNumber ? val.toLocaleString() : val;
            };

            return `
            <tr style="cursor:pointer;" onclick="app.openDrawer('detail', {id: ${r.id}, type: '${r.type}'})">
                <td class="text-center d-print-none" onclick="event.stopPropagation()"><input type="checkbox" class="history-checkbox" value="${r.id}" data-type="${r.type}"></td>
                <td class="d-print-none text-muted small">${r.transaction_group_id || ''}</td>
                <td class="text-center">${badge}</td>
                <td class="text-center"><span class="badge bg-light text-dark border">${r.category || '-'}</span></td>
                <td class="text-center">${r.date.split('T')[0]}</td>
                <td>${renderCell(r.supplier)}</td>
                <td>${renderCell(r.destination)}</td>
                <td><strong class="text-primary">${r.item}</strong></td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="text-end ${isOut ? 'text-danger fw-bold' : 'text-success fw-bold'}">${r.qty.toLocaleString()}</td>
                <td class="text-end">${renderCell(r.inbound_price, true)}</td>
                <td class="text-end">${renderCell(r.inbound_total, true)}</td>
                <td class="text-end">${renderCell(r.outbound_price, true)}</td>
                <td class="text-end">${renderCell(r.outbound_total, true)}</td>
                <td class="text-center text-nowrap">
                    ${r.settlement_status === '정산완료' 
                        ? `<span class="badge bg-secondary">정산완료</span>` 
                        : `<button class="btn btn-sm btn-outline-secondary py-0 px-2 me-1" onclick="event.stopPropagation(); ${editFn}" title="수정"><i class='bx bx-edit'></i></button>
                           <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="event.stopPropagation(); ${delFn}" title="삭제"><i class='bx bx-trash'></i></button>`
                    }
                </td>
            </tr>
            `;
        }).join('');
    },

    toggleSelectAllHistory: function() {
        const selectAll = $('selectAllHistory').checked;
        document.querySelectorAll('.history-checkbox').forEach(cb => {
            cb.checked = selectAll;
        });
    },

    
    toggleSelectAllHistory() {
        const isChecked = $('selectAllHistory').checked;
        document.querySelectorAll('.history-checkbox').forEach(cb => {
            cb.checked = isChecked;
        });
    },

    openBulkUpdateModal() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        if (checkboxes.length === 0) {
            alert('일괄 수정할 항목을 체크해주세요.');
            return;
        }
        $('bulkUpdateCount').innerText = checkboxes.length;
        $('bulkUpdateForm').reset();
        
        const modalEl = document.getElementById('bulkUpdateModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    async submitBulkUpdate() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        const inboundIds = [];
        const outboundIds = [];
        
        checkboxes.forEach(cb => {
            if (cb.dataset.type === 'inbound') inboundIds.push(cb.value);
            else outboundIds.push(cb.value);
        });

        const supplier = $('bulkSupplier').value.trim();
        const destination = $('bulkDestination').value.trim();
        const category = $('bulkCategory').value.trim();

        if (!supplier && !destination && !category) {
            alert('변경할 항목을 하나 이상 입력해주세요.');
            return;
        }

        try {
            await authFetch(`${API_BASE}/bulk-update`, {
                method: 'PUT',
                body: JSON.stringify({ inboundIds, outboundIds, supplier, destination, category })
            });
            alert('일괄 수정이 완료되었습니다.');
            
            const modalEl = document.getElementById('bulkUpdateModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            
            this.resetPageAndLoadHistory();
            this.loadCategories();
        } catch (err) {
            alert('일괄 수정 실패: ' + err.message);
        }
    },

    deleteSelectedHistory: async function() {
        const checked = Array.from(document.querySelectorAll('.history-checkbox:checked'));
        if (checked.length === 0) return alert('삭제할 항목을 선택하세요.');
        if (!confirm(`선택한 ${checked.length}개의 내역을 삭제하시겠습니까? (출고 내역 삭제 시 입고 잔여수량이 복구되며, 직출고의 경우 입출고 모두 삭제됩니다.)`)) return;
        
        let successCount = 0;
        let failCount = 0;
        for (const cb of checked) {
            const id = cb.value;
            const type = cb.dataset.type;
            try {
                const res = await authFetch(`${API_BASE}/${type}/${id}`, { method: 'DELETE' });
                if (res && res.error) throw new Error(res.error);
                successCount++;
            } catch (err) {
                failCount++;
                console.error(`Failed to delete ${type} ${id}:`, err);
            }
        }
        
        const msg = `선택 삭제가 완료되었습니다.\\n(성공: ${successCount}건, 실패: ${failCount}건)`;
        alert(msg);
        $('selectAllHistory').checked = false;
        this.resetPageAndLoadHistory();
    },

    printSelectedHistory: function() {
        const checked = Array.from(document.querySelectorAll('.history-checkbox:checked'));
        if (checked.length === 0) {
            alert('출력할 내역을 선택해주세요.');
            return;
        }

        if (!this.currentHistoryData) return;

        const selectedItems = checked.map(cb => {
            const id = parseInt(cb.value);
            const type = cb.dataset.type;
            return this.currentHistoryData.find(r => r.id === id && r.type === type);
        }).filter(item => item !== undefined);

        if (selectedItems.length === 0) return;

        let tableRows = '';
        let totalAmount = 0;
        
        selectedItems.forEach(item => {
            const isOut = item.type === 'outbound';
            const qty = item.qty || 0;
            const price = isOut ? (item.outbound_price || 0) : (item.inbound_price || 0);
            const amount = isOut ? (item.outbound_total || 0) : (item.inbound_total || 0);
            totalAmount += amount;
            
            const partner = item.supplier || item.destination || '';
            const typeText = isOut ? '출고' : '입고';
            
            tableRows += `
                <tr>
                    <td class="text-center">${item.date ? item.date.split('T')[0] : ''}</td>
                    <td class="text-center">${typeText}</td>
                    <td>${item.item || ''}</td>
                    <td>${item.spec || ''}</td>
                    <td class="text-center">${item.unit || ''}</td>
                    <td class="text-end">${qty.toLocaleString()}</td>
                    <td class="text-end">${price.toLocaleString()}</td>
                    <td class="text-end">${amount.toLocaleString()}</td>
                    <td>${partner}</td>
                </tr>
            `;
        });

        const printHtml = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>거래명세서</title>
                <style>
                    body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; font-size: 12px; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .header h2 { margin: 0; font-size: 24px; text-decoration: underline; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #000; padding: 5px 8px; }
                    th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
                    .text-center { text-align: center; }
                    .text-end { text-align: right; }
                    .total-row td { font-weight: bold; background-color: #f2f2f2; }
                    @media print {
                        @page { size: A4; margin: 1cm; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>거래명세서</h2>
                    <div style="text-align: right; margin-top: 10px;">출력일시: ${new Date().toLocaleString('ko-KR')}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 12%">일자</th>
                            <th style="width: 8%">구분</th>
                            <th style="width: 20%">품목</th>
                            <th style="width: 12%">규격</th>
                            <th style="width: 8%">단위</th>
                            <th style="width: 10%">수량</th>
                            <th style="width: 10%">단가</th>
                            <th style="width: 12%">금액</th>
                            <th style="width: 18%">거래처</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                        <tr class="total-row">
                            <td colspan="7" class="text-end">합계</td>
                            <td class="text-end">${totalAmount.toLocaleString()}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printHtml);
            printWindow.document.close();
            // Wait for styles to be applied
            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 250);
        }
    },

    deleteInbound: async function(id) {
        if (!confirm('이 입고 내역을 정말 삭제하시겠습니까? (이미 출고된 내역은 삭제할 수 없습니다)')) return;
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, { method: 'DELETE' });
            alert('입고 내역이 삭제되었습니다.');
            this.loadHistory();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    deleteOutbound: async function(id) {
        if (!confirm('이 출고 내역을 정말 삭제하시겠습니까? (차감되었던 입고 재고가 다시 복구됩니다)')) return;
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, { method: 'DELETE' });
            alert('출고 내역이 삭제되고 재고가 복구되었습니다.');
            this.loadHistory();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    initTodayDates: function() {
        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
        $('in_date').value = today;
        $('out_date').value = today;
    },

    // ----------------------------------------
    // Locations (위치 관리)
    // ----------------------------------------
    loadLocations: async function() {
        try {
            locations = await authFetch(`${API_BASE}/locations`);
            const sel = $('in_location');
            sel.innerHTML = '<option value="">선택하세요</option>';
            locations.forEach(loc => {
                sel.innerHTML += `<option value="${loc.id}">${loc.name}</option>`;
            });
            this.renderLocationsModal();
        } catch (e) {
            console.error(e);
        }
    },

    renderLocationsModal: function() {
        const ul = $('locationList');
        ul.innerHTML = locations.map(loc => `
            <li>
                <span><i class='bx bx-map-pin text-muted'></i> ${loc.name}</span>
            </li>
        `).join('');
    },

    openLocationsModal: function() {
        const modalEl = $('locationsModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    addLocation: async function() {
        const input = $('newLocationInput');
        const name = input.value.trim();
        if (!name) return alert('이름을 입력하세요');
        try {
            await authFetch(`${API_BASE}/locations`, { method: 'POST', body: JSON.stringify({ name }) });
            input.value = '';
            await this.loadLocations();
        } catch (e) {
            alert('오류: ' + e.message);
        }
    },

    // ----------------------------------------
    // Partner Autocomplete & Quick Modal
    // ----------------------------------------
    partnersCache: [],
    
    setupPartnerAutocomplete: async function() {
        try {
            const CORE_API = API_BASE.replace('/logistics', '');
            const res = await authFetch(`${CORE_API}/partners`);
            this.partnersCache = res;
        } catch (e) {
            console.error('Failed to load partners', e);
        }
        // 거래처 자동완성은 이제 Partner Search Modal 로 이관됨
    },

    openPartnerSearchModal: function(targetInputId) {
        if (!this.partnersCache || this.partnersCache.length === 0) {
            this.setupPartnerAutocomplete().then(() => this.showPartnerSearchModal(targetInputId));
        } else {
            this.showPartnerSearchModal(targetInputId);
        }
    },

    showPartnerSearchModal: function(targetInputId) {
        const inputEl = $(targetInputId);
        if (!inputEl) return;
        
        $('partnerSearchTargetInput').value = targetInputId;
        const searchVal = inputEl.value.trim();
        $('partnerSearchInput').value = searchVal;
        
        this.filterPartnerSearch();

        const modalEl = $('partnerSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
        
        // 포커스 이동
        setTimeout(() => $('partnerSearchInput').focus(), 500);
    },

    filterPartnerSearch: function() {
        const val = $('partnerSearchInput').value.trim().toLowerCase();
        const listContainer = $('partnerSearchList');
        
        let matches = this.partnersCache;
        if (val) {
            matches = matches.filter(p => 
                (p.name && p.name.toLowerCase().includes(val)) || 
                (p.company_name && p.company_name.toLowerCase().includes(val))
            );
        }
        
        if (matches.length === 0) {
            listContainer.innerHTML = `<div class="list-group-item text-center text-muted py-4">검색된 거래처가 없습니다.</div>`;
            return;
        }

        listContainer.innerHTML = matches.map(m => {
            const displayText = m.company_name ? `${m.name} / <small class="text-muted">${m.company_name}</small>` : m.name;
            return `
                <button type="button" class="list-group-item list-group-item-action py-2" onclick="app.selectPartner('${m.name}')">
                    <div class="fw-bold">${m.name}</div>
                    ${m.company_name ? `<div style="font-size: 0.8rem;" class="text-muted">${m.company_name}</div>` : ''}
                </button>
            `;
        }).join('');
    },

    selectPartner: function(name) {
        const targetId = $('partnerSearchTargetInput').value;
        if (targetId && $(targetId)) {
            $(targetId).value = name;
        }
        const modal = bootstrap.Modal.getInstance($('partnerSearchModal'));
        if (modal) modal.hide();
    },


    // ----------------------------------------
    // Inbound (입고)
    // ----------------------------------------
    addInboundItemRow: function() {
        const container = $('inboundItemsContainer');
        const rowId = 'in_row_' + Date.now() + Math.floor(Math.random() * 1000);
        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light inbound-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-6 position-relative">
                        <input type="text" class="form-control form-control-sm in-item" placeholder="품목명" autocomplete="off" required>
                        <div class="autocomplete-suggestions" style="display:none;"></div>
                    </div>
                    <div class="col-6">
                        <input type="text" class="form-control form-control-sm in-spec" placeholder="규격" required>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-5">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm in-qty" placeholder="수량" step="0.01" required>
                            <input type="text" class="form-control form-control-sm in-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="단위" required>
                        </div>
                    </div>
                    <div class="col-5">
                        <input type="number" class="form-control form-control-sm in-price" placeholder="입고단가" min="0" step="1" required>
                    </div>
                    <div class="col-2 d-flex justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-danger w-100" onclick="app.removeInboundItemRow('${rowId}')"><i class='bx bx-trash'></i> 삭제</button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        // 새로 추가된 행의 품목 입력칸에 자동완성 이벤트 연결
        const newRow = $(rowId);
        const input = newRow.querySelector('.in-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/items/all`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        // 외부 클릭 시 자동완성 닫기 처리
        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        return rowId;
    },

    removeInboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
    },

    setupInboundAutocomplete: function() {
        // 초기화 시 기본으로 1개 행 추가
        this.addInboundItemRow();
    },

    handleInboundSubmit: async function(e) {
        e.preventDefault();
        
        const rows = $('inboundItemsContainer').querySelectorAll('.inbound-item-row');
        if (rows.length === 0) return alert('입고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        const docNote = $('in_note').value.trim();

        rows.forEach(row => {
            const item = row.querySelector('.in-item').value.trim();
            const spec = row.querySelector('.in-spec').value.trim();
            const unit = row.querySelector('.in-unit').value.trim();
            const qty = parseFloat(row.querySelector('.in-qty').value);
            const unit_price = parseFloat(row.querySelector('.in-price').value);
            const note = docNote;
            const trade_type = $('in_trade_type') ? $('in_trade_type').value : '내수';

            const category = $('in_category') ? $('in_category').value.trim() : '';

            if (!item || !spec || !unit || isNaN(qty) || isNaN(unit_price)) {
                hasError = true;
            } else {
                items.push({ id: row.dataset.dbId, item, spec, unit, qty, unit_price, note, trade_type, category });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const category = $('in_category') ? $('in_category').value.trim() : '';
        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            category: category,
            items: items
        };

        const mode = $('inboundForm').dataset.mode;
        const txId = $('inboundForm').dataset.txId;
        const confirmMsg = mode === 'edit' ? `총 ${items.length}건의 품목으로 입고 내역을 수정하시겠습니까?` : `총 ${items.length}건의 품목을 입고하시겠습니까?`;
        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/inbound/tx/${txId}`, { method: 'PUT', body: JSON.stringify(payload) });
                    $('inboundForm').dataset.mode = '';
                    $('inboundForm').dataset.txId = '';
                } else {
                    await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                }
                alert('입고 완료되었습니다.');
                $('inboundForm').reset();
                $('inboundItemsContainer').innerHTML = '';
                this.addInboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('입고 실패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Utility: Autocomplete Keyboard Navigation
    // ----------------------------------------
    attachAutocompleteKeyboard: function(input, sugBox) {
        let currentFocus = -1;
        input.addEventListener('keydown', function(e) {
            if (sugBox.style.display === 'none') return;
            const items = sugBox.querySelectorAll('.autocomplete-suggestion');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                currentFocus++;
                if (currentFocus >= items.length) currentFocus = 0;
                setActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                currentFocus--;
                if (currentFocus < 0) currentFocus = items.length - 1;
                setActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentFocus > -1) {
                    items[currentFocus].click();
                }
            }
        });

        input.addEventListener('input', () => { currentFocus = -1; });

        function setActive(items) {
            items.forEach(item => item.classList.remove('active-suggestion'));
            items[currentFocus].classList.add('active-suggestion');
            // Auto scroll (optional, simple logic)
            items[currentFocus].scrollIntoView({ block: 'nearest' });
        }
    },

    // ----------------------------------------
    // Direct Shipment (직출고)
    // ----------------------------------------
    addDirectItemRow: function() {
        const container = $('directItemsContainer');
        const rowId = 'dir_row_' + Date.now() + Math.floor(Math.random() * 1000);

        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light direct-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-7 position-relative">
                        <input type="text" class="form-control form-control-sm dir-item" placeholder="품목명" autocomplete="off" required>
                        <div class="autocomplete-suggestions" style="display:none;"></div>
                    </div>
                    <div class="col-5">
                        <input type="text" class="form-control form-control-sm dir-spec" placeholder="규격" required>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-4">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm dir-qty" placeholder="수량" step="0.01" required>
                            <input type="text" class="form-control form-control-sm dir-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="단위" required>
                        </div>
                    </div>
                    <div class="col-3">
                        <input type="number" class="form-control form-control-sm dir-in-price" placeholder="매입단가" min="0" step="1" required>
                    </div>
                    <div class="col-4">
                        <input type="number" class="form-control form-control-sm dir-out-price" placeholder="매출단가" min="0" step="1" required>
                    </div>
                    <div class="col-1 text-end">
                        <button type="button" class="btn btn-sm btn-outline-danger w-100 px-1" onclick="app.removeDirectItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        const newRow = $(rowId);
        const input = newRow.querySelector('.dir-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/items/all`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        return rowId;
    },

    removeDirectItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
    },

    handleDirectSubmit: async function(e) {
        e.preventDefault();
        
        const rows = $('directItemsContainer').querySelectorAll('.direct-item-row');
        if (rows.length === 0) return alert('직출고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        const date = $('dir_date').value;
        const supplier = $('dir_supplier').value.trim();
        const destination = $('dir_destination').value.trim();
        const actual_destination = $('dir_actual_destination') ? $('dir_actual_destination').value.trim() : '';
        
        if (!supplier || !destination) {
            return alert('매입처와 매출처를 모두 입력해주세요.');
        }

        const docShippingFee = parseFloat($('dir_shipping') ? $('dir_shipping').value : 0) || 0;
        const docShippingFeeVatIncluded = $('dir_shipping_vat') && $('dir_shipping_vat').checked ? 1 : 0;
        const docNote = $('dir_note') ? $('dir_note').value.trim() : '';

        rows.forEach((row, idx) => {
            const item = row.querySelector('.dir-item').value.trim();
            const spec = row.querySelector('.dir-spec').value.trim();
            const unit = row.querySelector('.dir-unit').value.trim();
            const qty = parseFloat(row.querySelector('.dir-qty').value);
            const in_price = parseFloat(row.querySelector('.dir-in-price').value);
            const out_price = parseFloat(row.querySelector('.dir-out-price').value);
            const shipping_fee = idx === 0 ? docShippingFee : 0;
            const shipping_fee_vat_included = idx === 0 ? docShippingFeeVatIncluded : 0;
            const note = docNote;
            const trade_type = $('dir_trade_type') ? $('dir_trade_type').value : '내수';
            const category = $('dir_category') ? $('dir_category').value.trim() : '';

            if (!item || !spec || !unit || isNaN(qty) || isNaN(in_price) || isNaN(out_price)) {
                hasError = true;
            } else {
                items.push({ id: row.dataset.dbId, item, spec, unit, qty, unit_price: in_price, selling_price: out_price, shipping_fee, shipping_fee_vat_included, note, trade_type, category });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const category = $('dir_category') ? $('dir_category').value.trim() : '';
        const payload = {
            date: date,
            supplier: supplier,
            destination: destination,
            actual_destination: actual_destination,
            category: category,
            items: items
        };

        const mode = $('directForm').dataset.mode;
        const txId = $('directForm').dataset.txId;
        const confirmMsg = mode === 'edit'
            ? `총 ${items.length}건의 품목으로 직출고 내역을 수정하시겠습니까?`
            : `총 ${items.length}건의 품목을 직출고로 동시 처리하시겠습니까? (입고/출고 장부에 동시 반영됨)`;

        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/direct/tx/${encodeURIComponent(txId)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    $('directForm').dataset.mode = '';
                    $('directForm').dataset.txId = '';
                    alert('직출고 수정이 완료되었습니다.');
                } else {
                    await authFetch(`${API_BASE}/direct`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    alert('직출고 처리가 완료되었습니다.');
                }
                
                $('directForm').reset();
                $('directItemsContainer').innerHTML = '';
                this.addDirectItemRow();
                this.initTodayDates();
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('직출고 처리 실패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Outbound (출고)
    // ----------------------------------------
    outboundRows: {}, // rowId -> { availableLots: [], consumedLots: [] }
    currentLotModalRowId: null,

    setupOutboundAutocomplete: function() {
        // 초기 1행
        this.addOutboundItemRow();
    },

    addOutboundItemRow: function() {
        const container = $('outboundItemsContainer');
        const rowId = 'out_row_' + Date.now() + Math.floor(Math.random() * 1000);
        this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };

        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light outbound-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-6 position-relative">
                        <input type="text" class="form-control form-control-sm out-item" placeholder="품목명" autocomplete="off" required>
                        <div class="autocomplete-suggestions"></div>
                    </div>
                    <div class="col-6">
                        <select class="form-select form-select-sm out-spec" disabled required onchange="app.handleOutboundSpecChange('${rowId}', this)">
                            <option value="">품목 먼저 선택</option>
                        </select>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-5">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm out-qty" placeholder="출고 수량" step="0.01" disabled required onchange="app.handleOutboundQtyChange('${rowId}')" onkeyup="app.handleOutboundQtyChange('${rowId}')">
                            <input type="text" class="form-control form-control-sm out-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="단위" readonly>
                        </div>
                    </div>
                    <div class="col-4">
                        <input type="number" class="form-control form-control-sm out-price" placeholder="단가" min="0" step="1" required>
                    </div>
                    <div class="col-3 d-flex gap-1 justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-primary btn-lot flex-grow-1" onclick="app.openLotModal('${rowId}')" disabled>Lot 설정</button>
                        <button type="button" class="btn btn-sm btn-outline-danger px-2" onclick="app.removeOutboundItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);

        const newRow = $(rowId);
        const input = newRow.querySelector('.out-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            const specSel = newRow.querySelector('.out-spec');
            const qtyInput = newRow.querySelector('.out-qty');
            const unitInput = newRow.querySelector('.out-unit');
            const lotBtn = newRow.querySelector('.btn-lot');

            specSel.innerHTML = '<option value="">품목을 선택하세요</option>';
            specSel.disabled = true;
            qtyInput.disabled = true;
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();

            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/inventory/items`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                            this.loadOutboundSpecsForRow(rowId, div.innerText);
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        return rowId;
    },

    removeOutboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
        delete this.outboundRows[rowId];
        this.validateAllOutboundLots();
    },

    loadOutboundSpecsForRow: async function(rowId, itemName) {
        try {
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(itemName)}`);
            const specMap = {};
            lots.forEach(l => {
                if (!specMap[l.spec]) specMap[l.spec] = { unit: l.unit, total: 0, lots: [] };
                specMap[l.spec].total += l.qty_remaining;
                specMap[l.spec].lots.push(l);
            });

            const row = $(rowId);
            const sel = row.querySelector('.out-spec');
            sel.innerHTML = '<option value="">규격을 선택하세요</option>';
            
            for (const [spec, data] of Object.entries(specMap)) {
                sel.innerHTML += `<option value="${spec}" data-lots='${JSON.stringify(data.lots)}' data-unit="${data.unit}">[잔여 ${data.total}${data.unit}] ${spec}</option>`;
            }
            sel.disabled = false;
        } catch (e) {
            console.error(e);
            alert('규격을 불러오는데 실패했습니다.');
        }
    },

    handleOutboundSpecChange: function(rowId, sel) {
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        const unitInput = row.querySelector('.out-unit');
        const lotBtn = row.querySelector('.btn-lot');

        if (!sel.value) {
            qtyInput.disabled = true;
            qtyInput.value = '';
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();
            return;
        }
        
        const option = sel.options[sel.selectedIndex];
        const unit = option.getAttribute('data-unit');
        const lots = JSON.parse(option.getAttribute('data-lots'));
        
        unitInput.value = unit;
        qtyInput.disabled = false;
        qtyInput.value = '';
        lotBtn.disabled = false;
        
        this.outboundRows[rowId].availableLots = lots;
        this.outboundRows[rowId].consumedLots = [];
        this.validateAllOutboundLots();
    },

    handleOutboundQtyChange: function(rowId) {
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        let totalOutQty = parseFloat(qtyInput.value) || 0;
        
        const rData = this.outboundRows[rowId];
        rData.consumedLots = []; // reset

        // FIFO Auto distribute
        rData.availableLots.forEach((lot) => {
            if (totalOutQty <= 0) return;
            let take = 0;
            if (totalOutQty >= lot.qty_remaining) {
                take = lot.qty_remaining;
                totalOutQty -= lot.qty_remaining;
            } else {
                take = totalOutQty;
                totalOutQty = 0;
            }
            if (take > 0) {
                rData.consumedLots.push({ inbound_id: lot.id, consumed_qty: take });
            }
        });
        
        this.validateAllOutboundLots();
    },

    openLotModal: function(rowId) {
        this.currentLotModalRowId = rowId;
        const row = $(rowId);
        const itemName = row.querySelector('.out-item').value;
        const specName = row.querySelector('.out-spec').value;
        const targetQty = parseFloat(row.querySelector('.out-qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.outboundRows[rowId];
        
        // Render table
        const tbody = $('lotModalTbody');
        tbody.innerHTML = rData.availableLots.map(lot => {
            const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
            const val = consumed ? consumed.consumed_qty : 0;
            return `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                           data-id="${lot.id}"
                           min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                           onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                </td>
            </tr>
            `;
        }).join('');
        
        this.validateLotModalSum();
        const modalEl = $('lotModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        
        // lotModal이 다른 모달(editOutboundModal 등) 위에 뜰 때 배경(backdrop) z-index 보정
        modalEl.addEventListener('shown.bs.modal', function () {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            if (backdrops.length > 1) {
                // 마지막(가장 위에 있는) backdrop의 z-index를 조정
                backdrops[backdrops.length - 1].style.zIndex = '1069';
            }
        }, { once: true });
        
        modal.show();
    },

    validateLotModalSum: function() {
        let sum = 0;
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            sum += parseFloat(inp.value) || 0;
        });
        $('lotModalCurQty').innerText = sum;
        
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        const err = $('lotModalErrorMsg');
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (isMatch || targetQty === 0) {
            err.style.display = 'none';
        } else {
            err.style.display = 'block';
        }
    },

    saveLotModal: function() {
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        let sum = 0;
        const tempConsumed = [];
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            const val = parseFloat(inp.value) || 0;
            sum += val;
            if (val > 0) {
                tempConsumed.push({ inbound_id: parseInt(inp.getAttribute('data-id')), consumed_qty: val });
            }
        });
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (!isMatch && targetQty > 0) {
            alert('차감량 합계가 총 출고 수량과 일치하지 않습니다.');
            return;
        }
        
        if (this.currentLotModalRowId === 'editOutbound') {
            this.editOutboundState.consumedLots = tempConsumed;
            $('editOutboundErrorMsg').style.display = 'none';
        } else {
            this.outboundRows[this.currentLotModalRowId].consumedLots = tempConsumed;
            this.validateAllOutboundLots();
        }
        
        const modal = bootstrap.Modal.getInstance($('lotModal'));
        modal.hide();
    },

    validateAllOutboundLots: function() {
        const rows = $('outboundItemsContainer').querySelectorAll('.outbound-item-row');
        let allValid = true;
        let hasItems = false;
        
        rows.forEach(row => {
            const rowId = row.id;
            const qty = parseFloat(row.querySelector('.out-qty').value) || 0;
            const rData = this.outboundRows[rowId];
            
            if (qty > 0 && rData) {
                hasItems = true;
                let sum = 0;
                rData.consumedLots.forEach(c => sum += c.consumed_qty);
                const isMatch = Math.abs(sum - qty) < 0.0001;
                
                const btn = row.querySelector('.btn-lot');
                if (isMatch) {
                    btn.classList.remove('btn-outline-danger');
                    btn.classList.add('btn-outline-primary');
                    btn.innerHTML = 'Lot 확인됨 <i class="bx bx-check"></i>';
                } else {
                    btn.classList.remove('btn-outline-primary');
                    btn.classList.add('btn-outline-danger');
                    btn.innerHTML = 'Lot 재설정 필요 <i class="bx bx-error"></i>';
                    allValid = false;
                }
            } else if (qty <= 0) {
                allValid = false;
            }
        });
        
        if (rows.length === 0) allValid = false;

        const btnSubmit = $('btnOutboundSubmit');
        const errMsg = $('outErrorMsg');
        
        if (allValid && hasItems) {
            btnSubmit.disabled = false;
            errMsg.style.display = 'none';
        } else {
            btnSubmit.disabled = true;
            if (hasItems) errMsg.style.display = 'block';
            else errMsg.style.display = 'none';
        }
    },

    handleOutboundSubmit: async function(e) {
        e.preventDefault();
        const rows = $('outboundItemsContainer').querySelectorAll('.outbound-item-row');
        if (rows.length === 0) return alert('출고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        const docShippingFee = parseFloat($('out_shipping').value) || 0;
        const docNote = $('out_note').value.trim();

        rows.forEach((row, idx) => {
            const rowId = row.id;
            const item = row.querySelector('.out-item').value.trim();
            const spec = row.querySelector('.out-spec').value.trim();
            const unit = row.querySelector('.out-unit').value.trim();
            const qty = parseFloat(row.querySelector('.out-qty').value);
            const selling_price = parseFloat(row.querySelector('.out-price').value);
            const shipping_fee = idx === 0 ? docShippingFee : 0;
            const shipping_fee_vat_included = idx === 0 ? ($('out_shipping_vat').checked ? 1 : 0) : 0;
            const note = docNote;
            const trade_type = $('out_trade_type') ? $('out_trade_type').value : '내수';
            const category = $('out_category') ? $('out_category').value.trim() : '';
            const consumed_lots = this.outboundRows[rowId].consumedLots;

            if (!item || !spec || isNaN(qty) || isNaN(selling_price)) {
                hasError = true;
            } else {
                items.push({ id: row.dataset.dbId, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, consumed_lots, trade_type, category });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const category = $('out_category') ? $('out_category').value.trim() : '';
        const payload = {
            date: $('out_date').value,
            destination: $('out_destination').value,
            actual_destination: $('out_actual_destination') ? $('out_actual_destination').value.trim() : '',
            category: category,
            items: items
        };

        const mode = $('outboundForm').dataset.mode;
        const txId = $('outboundForm').dataset.txId;
        const confirmMsg = mode === 'edit' ? `총 ${items.length}건의 품목으로 출고 내역을 수정하시겠습니까?` : `총 ${items.length}건의 품목을 출고하시겠습니까?`;
        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/outbound/tx/${txId}`, { method: 'PUT', body: JSON.stringify(payload) });
                    $('outboundForm').dataset.mode = '';
                    $('outboundForm').dataset.txId = '';
                } else {
                    await authFetch(`${API_BASE}/outbound`, { method: 'POST', body: JSON.stringify(payload) });
                }
                alert('출고 완료되었습니다.');
                $('outboundForm').reset();
                $('outboundItemsContainer').innerHTML = '';
                this.outboundRows = {};
                this.addOutboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('출고 실패: ' + err.message);
            }
        }
    },
    
    // ==========================================
    // Drawer & Detail & Print Logic
    // ==========================================
    openExcelMenuModal: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    closeExcelMenuAndOpenDirect: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        setTimeout(() => app.openDirectExcelModal(), 300);
    },

    downloadExcelTemplate: async function() {
        try {
            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(API_BASE + '/direct/template', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error || 'HTTP error ' + res.status);
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = '직출고_엑셀일괄등록_양식.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            alert('템플릿 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    },

    openDirectExcelModal: function() {
        const modalEl = document.getElementById('directExcelModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        $('directExcelFile').value = '';
        modal.show();
    },

    uploadDirectExcel: async function() {
        const fileInput = $('directExcelFile');
        if (!fileInput.files || fileInput.files.length === 0) {
            alert('업로드할 엑셀 파일을 선택해주세요.');
            return;
        }
        
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // Show loading state
            const btn = event.currentTarget || document.querySelector('#directExcelModal .btn-warning');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 업로드 중...';
            btn.disabled = true;

            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(`${API_BASE}/direct/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                alert(`총 ${data.count}건의 엑셀 데이터가 성공적으로 일괄 등록되었습니다.`);
                
                const modalEl = document.getElementById('directExcelModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
                
                app.resetPageAndLoadHistory();
            } else {
                let errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    errText = errJson.error || errJson.details || errText;
                } catch(e) {}
                alert(`업로드 실패: ${errText}`);
            }
        } catch (err) {
            alert(`업로드 중 오류 발생: ${err.message}`);
        } finally {
            // Reset loading state
            const btn = document.querySelector('#directExcelModal .btn-warning');
            if (btn) {
                btn.innerHTML = "<i class='bx bx-upload'></i> 업로드 및 일괄 등록";
                btn.disabled = false;
            }
        }
    },

    openDrawer: function(mode, data = null) {
        if (mode === 'inbound_create') {
            const modalEl = document.getElementById('inboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            if ($('inboundItemsContainer').children.length === 0) {
                this.addInboundItemRow();
            }
        } else if (mode === 'outbound_create') {
            const modalEl = document.getElementById('outboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            if ($('outboundItemsContainer').children.length === 0) {
                this.addOutboundItemRow();
            }
        } else if (mode === 'direct_create') {
            const modalEl = document.getElementById('directModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            if ($('directForm').dataset.mode !== 'edit') {
                const title = document.querySelector('#directModal .modal-title');
                if (title) title.innerHTML = "<i class='bx bx-shuffle'></i> 직출고 등록";
                const submitBtn = document.querySelector('#directForm button[type=\"submit\"]');
                if (submitBtn) submitBtn.innerHTML = "<i class='bx bx-check-double'></i> 직출고 동시 처리";
            }
            modal.show();
            if ($('directItemsContainer').children.length === 0) {
                this.addDirectItemRow();
            }
        } else if (mode === 'detail') {
            const typeStr = data.type === 'inbound' ? '입고' : '출고';
            $('detailModalTitle').innerHTML = `<i class='bx bx-file'></i> ${typeStr} 상세 내역`;
            const modalEl = document.getElementById('detailModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            this.renderDrawerDetail(data.id, data.type);
        }
    },
    
    
    openEditInboundTx: async function(txId) {
        try {
            const items = await authFetch(`${API_BASE}/history/inbound/tx/${encodeURIComponent(txId)}`);
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            $('inboundForm').dataset.mode = 'edit';
            $('inboundForm').dataset.txId = txId;
            $('inboundItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('in_date').value = first.date;
            $('in_supplier').value = first.supplier || '';
            $('in_location').value = first.location_id || '';
            $('in_note').value = first.note || '';
            if ($('in_trade_type')) $('in_trade_type').value = first.trade_type || '내수';
            if ($('in_category')) $('in_category').value = first.category || '';

            items.forEach(item => {
                const rowId = this.addInboundItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.in-item').value = item.item;
                newRow.querySelector('.in-spec').value = item.spec || '';
                newRow.querySelector('.in-unit').value = item.unit || '';
                newRow.querySelector('.in-qty').value = item.qty_initial;
                newRow.querySelector('.in-price').value = item.unit_price || 0;
                
                const consumed = item.qty_initial - item.qty_remaining;
                if (consumed > 0) {
                    newRow.querySelector('.in-qty').min = consumed;
                    const delBtn = newRow.querySelector('.btn-outline-danger');
                    if(delBtn) delBtn.disabled = true;
                }
            });
            this.openDrawer('inbound_create');
        } catch(err) { alert(err.message); }
    },

    openEditOutboundTx: async function(txId) {
        try {
            const items = await authFetch(`${API_BASE}/history/outbound/tx/${encodeURIComponent(txId)}`);
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            $('outboundForm').dataset.mode = 'edit';
            $('outboundForm').dataset.txId = txId;
            $('outboundItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('out_date').value = first.date;
            $('out_destination').value = first.destination || '';
            $('out_actual_destination').value = first.actual_destination || '';
            $('out_note').value = first.note || '';
            if ($('out_trade_type')) $('out_trade_type').value = first.trade_type || '내수';
            if ($('out_category')) $('out_category').value = first.category || '';
            if ($('out_shipping')) $('out_shipping').value = first.shipping_fee || 0;
            if ($('out_shipping_vat')) $('out_shipping_vat').checked = first.shipping_fee_vat_included === 1;

            for (let item of items) {
                const rowId = this.addOutboundItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.out-item').value = item.item;
                
                const specSel = newRow.querySelector('.out-spec');
                specSel.innerHTML = `<option value="${item.spec || ''}" selected>${item.spec || '규격 없음'}</option>`;
                specSel.disabled = false;
                
                newRow.querySelector('.out-unit').value = item.unit || '';
                
                const qtyInput = newRow.querySelector('.out-qty');
                qtyInput.value = item.qty;
                qtyInput.disabled = false;
                
                newRow.querySelector('.out-price').value = item.selling_price || 0;

                this.outboundRows[rowId] = {
                    consumedLots: item.consumed_lots || [],
                    availableLots: []
                };
                const lotBtn = newRow.querySelector('.btn-lot');
                if (lotBtn) {
                    lotBtn.disabled = false;
                    lotBtn.classList.remove('btn-outline-primary');
                    lotBtn.classList.add('btn-success');
                    lotBtn.innerHTML = 'Lot 확인/수정';
                }
            }
            this.openDrawer('outbound_create');
        } catch(err) { alert(err.message); }
    },

    openEditDirectOutboundTx: async function(txId) {
        try {
            const items = await authFetch(`${API_BASE}/history/direct/tx/${encodeURIComponent(txId)}`);
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            $('directForm').dataset.mode = 'edit';
            $('directForm').dataset.txId = txId;
            $('directItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('dir_date').value = first.date ? first.date.split('T')[0] : '';
            $('dir_supplier').value = first.supplier || '';
            $('dir_destination').value = first.destination || '';
            if ($('dir_actual_destination')) $('dir_actual_destination').value = first.actual_destination || '';
            if ($('dir_note')) $('dir_note').value = first.note || '';
            if ($('dir_trade_type')) $('dir_trade_type').value = first.trade_type || '내수';
            if ($('dir_category')) $('dir_category').value = first.category || '';
            if ($('dir_shipping')) $('dir_shipping').value = first.shipping_fee || 0;
            if ($('dir_shipping_vat')) $('dir_shipping_vat').checked = first.shipping_fee_vat_included === 1;

            items.forEach(item => {
                const rowId = this.addDirectItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.dir-item').value = item.item || '';
                newRow.querySelector('.dir-spec').value = item.spec || '';
                newRow.querySelector('.dir-unit').value = item.unit || '';
                newRow.querySelector('.dir-qty').value = item.qty || 0;
                newRow.querySelector('.dir-in-price').value = item.inbound_price !== undefined ? item.inbound_price : (item.unit_price || 0);
                newRow.querySelector('.dir-out-price').value = item.selling_price !== undefined ? item.selling_price : (item.outbound_price || 0);
            });

            const title = document.querySelector('#directModal .modal-title');
            if (title) title.innerHTML = "<i class='bx bx-edit'></i> 직출고 내역 수정";
            const submitBtn = document.querySelector('#directForm button[type=\"submit\"]');
            if (submitBtn) submitBtn.innerHTML = "<i class='bx bx-check-double'></i> 직출고 수정 저장";

            this.openDrawer('direct_create');
        } catch(err) { alert(err.message); }
    },
    closeDrawer: function() {
        const modals = ['inboundModal', 'outboundModal', 'directModal', 'detailModal'];
        modals.forEach(id => {
            const modalEl = document.getElementById(id);
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
        });
        $('btnFilterAll').checked = true;
        this.resetPageAndLoadHistory();
    },

    renderDrawerDetail: async function(id, type) {
        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            this.currentHistoryDetail = data;
            
            const items = data.items || [data];
            
            let badgeHtml = type === 'inbound' ? '<span class="badge bg-success">입고</span>' : '<span class="badge bg-danger">출고</span>';
            if (type === 'outbound' && data.is_direct === 1) {
                badgeHtml = '<span class="badge bg-warning text-dark">직출고</span>';
            }
            
            const metaClass = type === 'inbound' ? 'inbound' : 'outbound';
            const extraLabel = type === 'inbound' ? '창고위치' : '배송비';
            const shipVatLabel = data.shipping_fee_vat_included === 1 ? '(부가세 포함)' : '(공급가 기준)';
            const extraValue = type === 'inbound' 
                ? (data.location_name || '-')
                : (data.shipping_fee ? data.shipping_fee.toLocaleString() + '원 ' + shipVatLabel : '-');
            
            let metaBarHtml = '';
            if (type === 'outbound' && data.is_direct === 1) {
                metaBarHtml = `
                <div class="drawer-meta-bar ${metaClass} flex-column align-items-start gap-2">
                    <div class="d-flex w-100 justify-content-between flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-3 flex-wrap">
                            <div class="drawer-meta-item">${badgeHtml}</div>
                            <div class="drawer-meta-item">
                                <span class="drawer-meta-label"><i class='bx bx-calendar'></i> 일자</span>
                                <span class="drawer-meta-value">${data.date}</span>
                            </div>
                        </div>
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-info-circle'></i> ${extraLabel}</span>
                            <span class="drawer-meta-value">${extraValue}</span>
                        </div>
                    </div>
                    <hr class="w-100 my-1 border-secondary opacity-25">
                    <div class="d-flex w-100 flex-wrap gap-4">
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-buildings'></i> 매입처(공급)</span>
                            <span class="drawer-meta-value fw-bold text-dark">${data.supplier || '-'}</span>
                        </div>
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-store-alt'></i> 매출처(납품)</span>
                            <span class="drawer-meta-value fw-bold text-primary">${data.destination}</span>
                        </div>
                        ${data.actual_destination ? `
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-map'></i> 실출고처</span>
                            <span class="drawer-meta-value text-dark">${data.actual_destination}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                `;
            } else {
                const partnerLabel = type === 'inbound' ? '매입처' : '출고처';
                const partnerValue = type === 'inbound' ? data.supplier : data.destination;
                const partnerHtml = `
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-buildings'></i> ${partnerLabel}</span>
                        <span class="drawer-meta-value">${partnerValue}</span>
                    </div>
                `;
                
                let actualDestHtml = '';
                if (type === 'outbound' && data.actual_destination) {
                    actualDestHtml = `
                        <div class="drawer-meta-item ms-3">
                            <span class="drawer-meta-label"><i class='bx bx-map'></i> 실출고처</span>
                            <span class="drawer-meta-value">${data.actual_destination}</span>
                        </div>
                    `;
                }

                metaBarHtml = `
                <div class="drawer-meta-bar ${metaClass}">
                    <div class="drawer-meta-item">
                        ${badgeHtml}
                    </div>
                    <div class="drawer-meta-item ms-2">
                        <span class="drawer-meta-label"><i class='bx bx-calendar'></i> 일자</span>
                        <span class="drawer-meta-value">${data.date}</span>
                    </div>
                    ${partnerHtml}
                    ${actualDestHtml}
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-info-circle'></i> ${extraLabel}</span>
                        <span class="drawer-meta-value">${extraValue}</span>
                    </div>
                </div>
                `;
            }

            let html = `
            <div class="w-100">
                ${metaBarHtml}
                ${data.note ? `<div class="mt-2 mb-3 px-3 py-2 bg-light rounded text-muted" style="font-size:0.85rem;"><i class='bx bx-message-square-detail'></i> <strong>비고:</strong> ${data.note}</div>` : ''}
                
                <table class="table table-bordered drawer-items-table align-middle mb-0">
                    <thead>
                        <tr>
                            <th class="text-center" style="width: 5%">#</th>
                            <th class="text-center" style="width: 35%">품명 / 규격</th>
                            <th class="text-center" style="width: 10%">단위</th>
                            <th class="text-center" style="width: 10%">수량</th>
                            <th class="text-center" style="width: 20%">단가</th>
                            <th class="text-center" style="width: 20%">총액</th>
                        </tr>
                    </thead>
                    <tbody>`;

            let totalQty = 0;
            let totalAmount = 0;

            items.forEach((item, idx) => {
                const itemQty = type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const itemPrice = type === 'inbound' ? item.unit_price : item.selling_price;
                const amount = itemQty * itemPrice;
                
                totalQty += itemQty;
                totalAmount += amount;
                
                html += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td><span class="fw-bold text-primary">${item.item}</span> <span class="text-secondary">/ ${item.spec}</span></td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-end fw-bold">${itemQty.toLocaleString()}</td>
                            <td class="text-end">${itemPrice.toLocaleString()}원</td>
                            <td class="text-end fw-bold text-danger">${amount.toLocaleString()}원</td>
                        </tr>`;
                
                if (type === 'outbound') {
                    let lotsHtml = '';
                    if (item.consumed_lots && item.consumed_lots.length > 0) {
                        lotsHtml = item.consumed_lots.map(l => 
                            `<span class="badge bg-white text-dark border me-1" style="font-weight:normal; font-size:0.7rem;">${l.inbound_date} 입고 (${l.supplier}) <span class="text-danger fw-bold ms-1">-${l.consumed_qty}</span></span>`
                        ).join('');
                        html += `
                        <tr class="sub-row">
                            <td></td>
                            <td colspan="5"><i class='bx bx-layer'></i> 차감: ${lotsHtml}</td>
                        </tr>`;
                    }
                }
            });
            
            if (items.length > 1) {
                html += `
                        <tr class="total-row">
                            <td colspan="3" class="text-center">합계</td>
                            <td class="text-end text-primary">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end text-danger">${totalAmount.toLocaleString()}원</td>
                        </tr>`;
            }
            
            html += `
                    </tbody>
                </table>
            </div>`;
                
            if (type === 'inbound') {
                $('printOptInbound').classList.remove('d-none');
                $('printOptInboundLabel').classList.remove('d-none');
                $('printOptInbound').checked = true;
                $('printOptOutbound').classList.add('d-none');
                $('printOptOutboundLabel').classList.add('d-none');
                $('printOptTrans').classList.add('d-none');
                $('printOptTransLabel').classList.add('d-none');
            } else {
                $('printOptOutbound').classList.remove('d-none');
                $('printOptOutboundLabel').classList.remove('d-none');
                $('printOptTrans').classList.remove('d-none');
                $('printOptTransLabel').classList.remove('d-none');
                $('printOptTrans').checked = true;
                
                if (data.is_direct === 1) {
                    $('printOptInbound').classList.remove('d-none');
                    $('printOptInboundLabel').classList.remove('d-none');
                } else {
                    $('printOptInbound').classList.add('d-none');
                    $('printOptInboundLabel').classList.add('d-none');
                }
            }
            
            html += `</div>`;
            $('drawerDetailContent').innerHTML = html;
            
        } catch (err) {
            alert('상세 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    openCompanyPresetModal: function() {
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        $('preset_bizNo').value = preset.bizNo || '845-88-00551';
        $('preset_bizName').value = preset.bizName || '주식회사 케앤지';
        $('preset_ceo').value = preset.ceo || '윤종';
        $('preset_address').value = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        $('preset_bizType').value = preset.bizType || '도소매/임대업';
        $('preset_bizItem').value = preset.bizItem || '건설자재, 용품외';
        
        new bootstrap.Modal(document.getElementById('companyPresetModal')).show();
    },
    
    saveCompanyPreset: function() {
        const preset = {
            bizNo: $('preset_bizNo').value,
            bizName: $('preset_bizName').value,
            ceo: $('preset_ceo').value,
            address: $('preset_address').value,
            bizType: $('preset_bizType').value,
            bizItem: $('preset_bizItem').value
        };
        localStorage.setItem('kng_company_preset', JSON.stringify(preset));
        bootstrap.Modal.getInstance(document.getElementById('companyPresetModal')).hide();
        alert('기본값이 저장되었습니다.');
    },
    
    printHistoryDetail: function() {
        if (!this.currentHistoryDetail) return;
        
        const data = this.currentHistoryDetail;
        const printType = document.querySelector('input[name="printType"]:checked').value;
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        
        // Defaults if preset not set
        const bizNo = preset.bizNo || '845-88-00551';
        const bizName = preset.bizName || '주식회사 케앤지';
        const ceo = preset.ceo || '윤종';
        const address = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        const bizType = preset.bizType || '도소매/임대업';
        const bizItem = preset.bizItem || '건설자재, 용품외';
        
        let printWindow = window.open('', '_blank');
        let htmlContent = `
            <html>
            <head>
                <title>인쇄</title>
                <link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Pretendard', 'Malgun Gothic', sans-serif; padding: 20px; color:#333; }
                    /* Common Styles */
                    * { box-sizing: border-box; }
                    @page { size: A4; margin: 15mm; }
                    .print-wrapper { max-width: 800px; margin: 0 auto; background: #fff; padding: 0; color:#212529; }
                    
                    /* Hybrid Header Styles */
                    .hybrid-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px; }
                    .header-left { flex: 1; padding-bottom: 5px; text-align: center; }
                    .title { font-size: 34px; font-weight: 700; color: #212529; margin: 0 0 25px 0; letter-spacing: 12px; text-decoration: underline; text-underline-offset: 8px; padding-left: 12px; }
                    .date-text { font-size: 15px; color: #495057; margin-bottom: 25px; text-align: center; }
                    .recipient-text { font-size: 18px; text-align: left; margin-left: 20px; }
                    .header-right { width: 420px; }
                    
                    .supplier-table { width: 100%; border-collapse: collapse; font-size: 13px; border: 2px solid #212529; }
                    .supplier-table th, .supplier-table td { border: 1px solid #dee2e6; padding: 6px 8px; }
                    .supplier-table th { background-color: #f8f9fa; color: #495057; text-align: center; font-weight: 600; }
                    .supplier-table td { color: #212529; }
                    .supplier-th { width: 30px; writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 5px; padding: 10px 5px !important; }
                    .stamp-cell { position: relative; }
                    .stamp { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); width: 45px; height: 45px; opacity: 0.85; mix-blend-mode: multiply; }
                    
                    .amount-bar { display: flex; border: 2px solid #212529; border-bottom: none; align-items: stretch; font-size: 16px; }
                    .amount-label { width: 120px; background-color: #f8f9fa; display: flex; align-items: center; justify-content: center; font-weight: 600; border-right: 1px solid #dee2e6; letter-spacing: 10px; padding: 12px 0; }
                    .amount-ko { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: 600; letter-spacing: 1px; }
                    .amount-num { width: 150px; display: flex; align-items: center; justify-content: flex-end; padding-right: 20px; font-weight: 700; font-size: 17px; }
                    
                    .hybrid-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px; border: 2px solid #212529; }
                    .hybrid-table th, .hybrid-table td { border: 1px solid #dee2e6; padding: 8px 6px; }
                    .hybrid-table th { background-color: #f8f9fa; font-weight: 600; color: #495057; text-align: center; border-bottom: 2px solid #212529; }
                    .hybrid-table td { height: 32px; }
                    .footer-row { background-color: #e9ecef; border-top: 2px solid #212529 !important; }
                    .footer-row td { color: #212529; padding: 10px 6px; font-size: 14px; }
                    .text-center { text-align: center !important; }
                    .text-right { text-align: right !important; }
                    
                    .signature-area { margin-top: 40px; text-align: right; font-size: 16px; font-weight: 600; }
                    
                    @media print {
                        body { padding: 0; margin: 0; }
                        .print-wrapper { max-width: 100%; width: 100%; padding: 0 !important; margin: 0; }
                        .supplier-table th, .amount-label, .hybrid-table th, .footer-row { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
            <div class="print-wrapper">`;
            
        // 공통 공급자 정보 HTML
        const supplierHtml = `
            <table class="supplier-table">
                <tr>
                    <th rowspan="4" class="supplier-th">공급자</th>
                    <th style="width: 25%">등록번호</th>
                    <td colspan="3">${bizNo}</td>
                </tr>
                <tr>
                    <th>상호</th>
                    <td style="width: 35%">${bizName}</td>
                    <th style="width: 15%">대표자</th>
                    <td class="stamp-cell">${ceo} <img src="../../assets/images/stamp.png" class="stamp" alt="직인" onerror="this.style.display='none'"></td>
                </tr>
                <tr>
                    <th>주소</th>
                    <td colspan="3">${address}</td>
                </tr>
                <tr>
                    <th>업태</th>
                    <td>${bizType}</td>
                    <th>종목</th>
                    <td>${bizItem}</td>
                </tr>
            </table>`;
            
        const items = data.items || [data];
        
        if (printType === 'transaction_statement') {
            function numberToKorean(number) {
                const inputNumber = parseInt(number, 10);
                const hanA = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
                const danA = ["", "십", "백", "천"];
                const danG = ["", "만", "억", "조"];
                let result = "";
                let numStr = inputNumber.toString();
                let length = numStr.length;
                for (let i = 0; i < length; i++) {
                    let n = parseInt(numStr.charAt(i));
                    let pos = length - i - 1;
                    if (n > 0) result += hanA[n] + danA[pos % 4];
                    if (pos % 4 === 0 && pos > 0) {
                        let chunk = numStr.substring(Math.max(0, i - 3), i + 1);
                        if (parseInt(chunk) > 0) result += danG[pos / 4];
                    }
                }
                return result + " 원정";
            }
            
            let totalAmount = 0;
            let totalVat = 0;
            let totalSum = 0;
            let itemRowsHtml = "";
            
            items.forEach((item, idx) => {
                const itemQty = data.type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const price = data.type === 'inbound' ? item.unit_price : item.selling_price;
                const amount = price * itemQty;
                const vat = Math.floor(amount * 0.1);
                const total = amount + vat;
                
                totalAmount += amount;
                totalVat += vat;
                totalSum += total;
                
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${itemQty.toLocaleString()}</td>
                            <td class="text-right">${price.toLocaleString()}</td>
                            <td class="text-right">${amount.toLocaleString()}</td>
                            <td class="text-right">${vat.toLocaleString()}</td>
                            <td class="text-right">${total.toLocaleString()}</td>
                        </tr>`;
            });
            
            if (data.shipping_fee && data.shipping_fee > 0) {
                const isVatIncluded = data.shipping_fee_vat_included === 1;
                let shipAmount, shipVat, shipTotal;
                
                if (isVatIncluded) {
                    shipTotal = data.shipping_fee;
                    shipAmount = Math.round(shipTotal / 1.1);
                    shipVat = shipTotal - shipAmount;
                } else {
                    shipAmount = data.shipping_fee;
                    shipVat = Math.floor(shipAmount * 0.1);
                    shipTotal = shipAmount + shipVat;
                }
                
                totalAmount += shipAmount;
                totalVat += shipVat;
                totalSum += shipTotal;
                
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${items.length + 1}</td>
                            <td>배송비</td>
                            <td class="text-center"></td>
                            <td class="text-center">건</td>
                            <td class="text-right">1</td>
                            <td class="text-right">${shipAmount.toLocaleString()}</td>
                            <td class="text-right">${shipAmount.toLocaleString()}</td>
                            <td class="text-right">${shipVat.toLocaleString()}</td>
                            <td class="text-right">${shipTotal.toLocaleString()}</td>
                        </tr>`;
                
                // Add an empty item to items length so emptyRowsCount calculation is correct
                items.push({});
            }
            
            const koTotalAmount = numberToKorean(totalSum);
            const emptyRowsCount = Math.max(0, 12 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">거 래 명 세 서</h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.destination}</strong> 귀하</div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <div class="amount-bar">
                    <div class="amount-label">금 액</div>
                    <div class="amount-ko">${koTotalAmount}</div>
                    <div class="amount-num">₩ ${totalSum.toLocaleString()}</div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">순번</th>
                            <th style="width: 25%">품명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 8%">단위</th>
                            <th style="width: 8%">수량</th>
                            <th style="width: 10%">단가</th>
                            <th style="width: 12%">금액</th>
                            <th style="width: 10%">부가세</th>
                            <th style="width: 12%">합계금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- 이하여백 -</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                    <tfoot>
                        <tr class="footer-row">
                            <td colspan="6" class="text-center"><strong>계</strong></td>
                            <td class="text-right"><strong>${totalAmount.toLocaleString()}</strong></td>
                            <td class="text-right"><strong>${totalVat.toLocaleString()}</strong></td>
                            <td class="text-right"><strong>${totalSum.toLocaleString()}</strong></td>
                        </tr>
                    </tfoot>
                </table>
                
                <div style="font-size:13px; color:#495057; text-align:right;">
                    ${data.note ? '비고: ' + data.note : ''}
                </div>
            `;
        } else if (printType === 'inbound_receipt') {
            let itemRowsHtml = "";
            items.forEach((item, idx) => {
                const itemQty = item.qty_initial || item.qty;
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${itemQty.toLocaleString()}</td>
                            <td class="text-center">${item.location_name || '-'}</td>
                            <td class="text-center">${item.note || ''}</td>
                        </tr>`;
            });
            const emptyRowsCount = Math.max(0, 13 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">입 고 내 역 서</h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.supplier}</strong> 귀하</div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">순번</th>
                            <th style="width: 30%">품명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 10%">단위</th>
                            <th style="width: 10%">수량</th>
                            <th style="width: 15%">입고창고</th>
                            <th style="width: 15%">비고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- 이하여백 -</td>
                            <td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                </table>
            `;
        } else if (printType === 'outbound_receipt') {
            let itemRowsHtml = "";
            items.forEach((item, idx) => {
                let lotsInfo = (item.consumed_lots || []).map(l => `${l.location_name}`).join(', ');
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${item.qty.toLocaleString()}</td>
                            <td class="text-right">${item.shipping_fee.toLocaleString()}</td>
                            <td class="text-center">${lotsInfo}</td>
                        </tr>`;
            });
            const emptyRowsCount = Math.max(0, 13 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">출 고 내 역 서</h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.destination}</strong> 귀하</div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">순번</th>
                            <th style="width: 30%">품명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 10%">단위</th>
                            <th style="width: 10%">수량</th>
                            <th style="width: 15%">배송비</th>
                            <th style="width: 15%">출고창고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- 이하여백 -</td>
                            <td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                </table>
                <div class="signature-area">
                    인수자 서명 : _____________________ (인)
                </div>
            `;
        }
        
        htmlContent += `
            </div>
            <script>
                window.onload = function() { window.print(); window.close(); }
            </script>
            </body>
            </html>
        `;
        
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    },

    // ----------------------------------------
    // Edit Logic (수정 로직)
    // ----------------------------------------
    openEditInbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/inbound/${id}`);
            
            $('editInboundId').value = data.id;
            $('edit_in_date').value = data.date;
            $('edit_in_supplier').value = data.supplier;
            $('edit_in_location').innerHTML = locations.map(l => `<option value="${l.id}" ${l.id === data.location_id ? 'selected' : ''}>${l.name}</option>`).join('');
            
            $('edit_in_item').value = data.item;
            $('edit_in_spec').value = data.spec;
            $('edit_in_unit').value = data.unit;
            $('edit_in_qty').value = data.qty_initial;
            $('edit_in_price').value = data.unit_price;
            $('edit_in_note').value = data.note || '';
            if ($('edit_in_category')) $('edit_in_category').value = data.category || '';
            if ($('edit_in_trade_type')) $('edit_in_trade_type').value = data.trade_type || '내수';
            
            const consumed = data.qty_initial - data.qty_remaining;
            if (consumed > 0) {
                $('editInboundWarning').classList.remove('d-none');
                $('editInboundMinQty').innerText = consumed;
                $('edit_in_qty').min = consumed;
                $('edit_in_item').disabled = true;
                $('edit_in_item').readOnly = true;
                $('edit_in_item').classList.add('bg-light', 'text-muted');
                $('edit_in_spec').disabled = true;
                $('edit_in_spec').readOnly = true;
                $('edit_in_spec').classList.add('bg-light', 'text-muted');
                $('edit_in_unit').disabled = true;
                $('edit_in_unit').readOnly = true;
                $('edit_in_unit').classList.add('bg-light', 'text-muted');
            } else {
                $('editInboundWarning').classList.add('d-none');
                $('edit_in_qty').min = 0.01;
                $('edit_in_item').disabled = false;
                $('edit_in_item').readOnly = false;
                $('edit_in_item').classList.remove('bg-light', 'text-muted');
                $('edit_in_spec').disabled = false;
                $('edit_in_spec').readOnly = false;
                $('edit_in_spec').classList.remove('bg-light', 'text-muted');
                $('edit_in_unit').disabled = false;
                $('edit_in_unit').readOnly = false;
                $('edit_in_unit').classList.remove('bg-light', 'text-muted');
            }
            
            let modal = bootstrap.Modal.getInstance($('editInboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editInboundModal'));
            modal.show();
        } catch(err) {
            alert('입고 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    submitEditInbound: async function(e) {
        e.preventDefault();
        const id = $('editInboundId').value;
        const payload = {
            date: $('edit_in_date').value,
            supplier: $('edit_in_supplier').value,
            location_id: $('edit_in_location').value,
            item: $('edit_in_item').value,
            spec: $('edit_in_spec').value,
            unit: $('edit_in_unit').value,
            qty: parseFloat($('edit_in_qty').value),
            unit_price: parseFloat($('edit_in_price').value),
            note: $('edit_in_note').value,
            trade_type: $('edit_in_trade_type') ? $('edit_in_trade_type').value : '내수',
            category: $('edit_in_category') ? $('edit_in_category').value.trim() : ''
        };
        
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('입고 내역이 수정되었습니다.');
            bootstrap.Modal.getInstance($('editInboundModal')).hide();
            this.loadHistory();
            if ($('detailModal') && $('detailModal').classList.contains('show')) {
                this.renderDrawerDetail(id, 'inbound');
            }
        } catch(err) {
            alert('수정 실패: ' + err.message);
        }
    },
    
    editOutboundState: { availableLots: [], consumedLots: [] },
    
    
    openEditDirectOutbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/outbound/${id}`);
            const item = data.items ? (data.items.find(i => i.id == id) || data) : data;
            
            $('editDirectId').value = item.id;
            $('edit_direct_date').value = item.date;
            $('edit_direct_supplier').value = item.supplier || '';
            $('edit_direct_destination').value = item.actual_destination || item.destination || item.party || '';
            $('edit_direct_shipping').value = item.shipping_fee || 0;
            $('edit_direct_shipping_vat').checked = item.shipping_fee_vat_included === 1;
            $('edit_direct_note').value = item.note || '';
            if ($('edit_direct_trade_type')) $('edit_direct_trade_type').value = item.trade_type || '내수';
            if ($('edit_direct_category')) $('edit_direct_category').value = item.category || '';
            
            $('edit_direct_item').value = item.item;
            $('edit_direct_spec').value = item.spec || '';
            $('edit_direct_unit').value = item.unit || '';
            $('edit_direct_qty').value = item.qty;
            $('edit_direct_inbound_price').value = item.inbound_price || 0;
            $('edit_direct_outbound_price').value = item.selling_price || item.price || 0;
            
            const modalEl = document.getElementById('editDirectModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
        } catch(err) {
            console.error(err);
            alert('직출고 데이터를 불러오는 중 오류가 발생했습니다.');
        }
    },

    submitEditDirectOutbound: async function(e) {
        e.preventDefault();
        const id = $('editDirectId').value;
        const payload = {
            date: $('edit_direct_date').value,
            supplier: $('edit_direct_supplier').value,
            destination: $('edit_direct_destination').value,
            actual_destination: $('edit_direct_destination').value,
            qty: parseFloat($('edit_direct_qty').value) || 0,
            inbound_price: parseFloat($('edit_direct_inbound_price').value) || 0,
            selling_price: parseFloat($('edit_direct_outbound_price').value) || 0,
            shipping_fee: parseFloat($('edit_direct_shipping').value) || 0,
            shipping_fee_vat_included: $('edit_direct_shipping_vat').checked ? 1 : 0,
            note: $('edit_direct_note').value,
            trade_type: $('edit_direct_trade_type') ? $('edit_direct_trade_type').value : '내수',
            category: $('edit_direct_category') ? $('edit_direct_category').value.trim() : ''
        };

        try {
            await authFetch(`${API_BASE}/direct/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const modalEl = document.getElementById('editDirectModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            this.resetPageAndLoadHistory();
            showAlert('직출고 내역이 수정되었습니다.');
        } catch(err) {
            console.error(err);
            alert('수정 실패: ' + err.message);
        }
    },

    openEditOutbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/outbound/${id}`);
            const item = data.items ? (data.items.find(i => i.id == id) || data) : data;
            
            $('editOutboundId').value = item.id;
            $('edit_out_date').value = item.date;
            $('edit_out_destination').value = item.destination || item.party;
            $('edit_out_shipping').value = item.shipping_fee || 0;
            $('edit_out_shipping_vat').checked = item.shipping_fee_vat_included === 1;
            $('edit_out_note').value = item.note || '';
            if ($('edit_out_trade_type')) $('edit_out_trade_type').value = item.trade_type || '내수';
            if ($('edit_out_category')) $('edit_out_category').value = item.category || '';
            
            $('edit_out_item').value = item.item;
            $('edit_out_spec').value = item.spec || '';
            $('edit_out_unit').value = item.unit || '';
            $('edit_out_qty').value = item.qty;
            $('edit_out_price').value = item.selling_price || item.price;
            
            // 기존 할당된 Lot 정보 저장
            this.editOutboundState.consumedLots = (item.consumed_lots || []).map(l => ({
                inbound_id: l.inbound_id,
                consumed_qty: l.consumed_qty
            }));
            
            // 품목에 해당하는 전체 사용 가능 재고(Lot)를 백엔드에서 조회
            // 주의: 자기 자신이 차감했던 재고량도 복구된 상태로 계산해야 하므로 백엔드에서 받은 잔여량 + 내가 차감했던 양
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(item.item)}`);
            
            // 현재 차감된 lot들의 수량을 잔여량에 더해서 가상의 "수정 전 초기 상태" 잔여량을 만듬
            this.editOutboundState.availableLots = lots.map(lot => {
                const consumed = this.editOutboundState.consumedLots.find(c => c.inbound_id === lot.id);
                if (consumed) {
                    lot.qty_remaining += consumed.consumed_qty;
                }
                return lot;
            });
            
            let modal = bootstrap.Modal.getInstance($('editOutboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editOutboundModal'));
            modal.show();
            
            // 오류 메시지 리셋
            $('editOutboundErrorMsg').style.display = 'none';
        } catch(err) {
            alert('출고 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    openEditOutboundLotModal: function() {
        this.currentLotModalRowId = 'editOutbound';
        const itemName = $('edit_out_item').value;
        const specName = $('edit_out_spec').value;
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.editOutboundState;
        
        const tbody = $('lotModalTbody');
        tbody.innerHTML = rData.availableLots.map(lot => {
            const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
            const val = consumed ? consumed.consumed_qty : 0;
            return `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                           data-id="${lot.id}"
                           min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                           onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                </td>
            </tr>
            `;
        }).join('');
        
        this.validateLotModalSum();
        
        let modal = bootstrap.Modal.getInstance($('lotModal'));
        if (!modal) modal = new bootstrap.Modal($('lotModal'));
        modal.show();
    },
    
    submitEditOutbound: async function(e) {
        e.preventDefault();
        
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        const sumLots = this.editOutboundState.consumedLots.reduce((acc, cur) => acc + cur.consumed_qty, 0);
        
        if (Math.abs(sumLots - targetQty) > 0.0001) {
            $('editOutboundErrorMsg').style.display = 'block';
            return;
        }
        
        const id = $('editOutboundId').value;
        const payload = {
            date: $('edit_out_date').value,
            destination: $('edit_out_destination').value,
            item: $('edit_out_item').value,
            spec: $('edit_out_spec').value,
            unit: $('edit_out_unit').value,
            qty: targetQty,
            selling_price: parseFloat($('edit_out_price').value) || 0,
            shipping_fee: parseFloat($('edit_out_shipping').value) || 0,
            shipping_fee_vat_included: $('edit_out_shipping_vat').checked ? 1 : 0,
            trade_type: $('edit_out_trade_type') ? $('edit_out_trade_type').value : '내수',
            category: $('edit_out_category') ? $('edit_out_category').value.trim() : '',
            note: $('edit_out_note').value,
            consumed_lots: this.editOutboundState.consumedLots
        };
        
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('출고 내역이 수정되었습니다.');
            bootstrap.Modal.getInstance($('editOutboundModal')).hide();
            this.loadHistory();
            if ($('detailModal') && $('detailModal').classList.contains('show')) {
                this.renderDrawerDetail(id, 'outbound');
            }
        } catch(err) {
            alert('수정 실패: ' + err.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

