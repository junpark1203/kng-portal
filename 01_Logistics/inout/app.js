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
                        else { _authReady = null; res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = null; res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = null; res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = null; res(null); }
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
        this.loadHistory();
        this.loadRecentInbounds();
        this.loadRecentOutbounds();
    },

    bindEvents: function() {
        $('inboundForm').addEventListener('submit', this.handleInboundSubmit.bind(this));
        $('outboundForm').addEventListener('submit', this.handleOutboundSubmit.bind(this));
        
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
        searchParty: '',
        searchItem: '',
        searchSpec: ''
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
            startDate: this.detailedFilters.startDate,
            endDate: this.detailedFilters.endDate,
            searchParty: this.detailedFilters.searchParty,
            searchItem: this.detailedFilters.searchItem,
            searchSpec: this.detailedFilters.searchSpec
        });

        try {
            $('historyTbody').innerHTML = `<tr><td colspan="9" class="text-center text-muted">데이터를 불러오는 중입니다...</td></tr>`;
            
            const res = await authFetch(`${API_BASE}/history?${params.toString()}`);
            this.renderHistoryTable(res.data);
            this.renderPagination(res.total, res.page, res.limit);
        } catch (err) {
            console.error('History load error:', err);
            $('historyTbody').innerHTML = `<tr><td colspan="9" class="text-center text-danger">내역을 불러오지 못했습니다.</td></tr>`;
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
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">해당하는 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(r => {
            const isOut = r.type === 'outbound';
            const badge = isOut ? `<span class="badge bg-danger">출고</span>` : `<span class="badge bg-success">입고</span>`;
            const delFn = isOut ? `app.deleteOutbound(${r.id})` : `app.deleteInbound(${r.id})`;
            return `
            <tr style="cursor:pointer;" class="inbound-item-row" onclick="app.openHistoryModal(${r.id}, '${r.type}')">
                <td>${badge}</td>
                <td>${r.date}</td>
                <td>${r.party}</td>
                <td><strong>${r.item}</strong></td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="${isOut ? 'text-danger fw-bold' : 'text-success fw-bold'}">${r.qty}</td>
                <td>${r.price.toLocaleString()}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="event.stopPropagation(); ${delFn}"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
            `;
        }).join('');
    },

    deleteInbound: async function(id) {
        if (!confirm('이 입고 내역을 정말 삭제하시겠습니까? (이미 출고된 내역은 삭제할 수 없습니다)')) return;
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, { method: 'DELETE' });
            alert('입고 내역이 삭제되었습니다.');
            this.loadHistory();
            this.loadRecentInbounds();
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
            this.loadRecentOutbounds();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    // ----------------------------------------
    // Recent Lists (최근 30건)
    // ----------------------------------------
    loadRecentInbounds: async function() {
        try {
            const res = await authFetch(`${API_BASE}/history?type=inbound&limit=30`);
            const inbounds = res.data || [];
            
            const tbody = $('recentInboundTbody');
            if(inbounds.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">내역이 없습니다.</td></tr>`;
                return;
            }
            tbody.innerHTML = inbounds.map(r => `
            <tr>
                <td>${r.date}</td>
                <td>${r.party}</td>
                <td><strong>${r.item}</strong></td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="text-success fw-bold">${r.qty}</td>
                <td>${r.price.toLocaleString()}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="app.deleteInbound(${r.id})"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
            `).join('');
        } catch(e) { console.error('Failed to load recent inbounds:', e); }
    },

    loadRecentOutbounds: async function() {
        try {
            const res = await authFetch(`${API_BASE}/history?type=outbound&limit=30`);
            const outbounds = res.data || [];
            
            const tbody = $('recentOutboundTbody');
            if(outbounds.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">내역이 없습니다.</td></tr>`;
                return;
            }
            tbody.innerHTML = outbounds.map(r => `
            <tr>
                <td>${r.date}</td>
                <td>${r.party}</td>
                <td><strong>${r.item}</strong></td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="text-danger fw-bold">${r.qty}</td>
                <td>${r.price.toLocaleString()}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="app.deleteOutbound(${r.id})"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
            `).join('');
        } catch(e) { console.error('Failed to load recent outbounds:', e); }
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
    // Inbound (입고)
    // ----------------------------------------
    addInboundItemRow: function() {
        const container = $('inboundItemsContainer');
        const rowId = 'in_row_' + Date.now();
        const rowHtml = `
            <div class="row g-2 mb-2 align-items-center inbound-item-row" id="${rowId}">
                <div class="col-md-2 position-relative">
                    <input type="text" class="form-control form-control-sm in-item" placeholder="품목명" autocomplete="off" required>
                    <div class="autocomplete-suggestions" style="display:none;"></div>
                </div>
                <div class="col-md-2">
                    <input type="text" class="form-control form-control-sm in-spec" placeholder="규격" required>
                </div>
                <div class="col-md-1">
                    <input type="text" class="form-control form-control-sm in-unit" placeholder="단위" required>
                </div>
                <div class="col-md-1">
                    <input type="number" class="form-control form-control-sm in-qty" placeholder="수량" min="0.01" step="0.01" required>
                </div>
                <div class="col-md-2">
                    <input type="number" class="form-control form-control-sm in-price" placeholder="매입단가" min="0" step="1" required>
                </div>
                <div class="col-md-3">
                    <input type="text" class="form-control form-control-sm in-note" placeholder="비고">
                </div>
                <div class="col-md-1 text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="app.removeInboundItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
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
        
        const rows = document.querySelectorAll('.inbound-item-row');
        if (rows.length === 0) return alert('입고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        rows.forEach(row => {
            const item = row.querySelector('.in-item').value.trim();
            const spec = row.querySelector('.in-spec').value.trim();
            const unit = row.querySelector('.in-unit').value.trim();
            const qty = parseFloat(row.querySelector('.in-qty').value);
            const unit_price = parseFloat(row.querySelector('.in-price').value);
            const note = row.querySelector('.in-note').value.trim();

            if (!item || !spec || !unit || isNaN(qty) || isNaN(unit_price)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, unit_price, note });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            items: items
        };

        if (confirm(`총 ${items.length}건의 품목을 입고하시겠습니까?`)) {
            try {
                await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('입고 완료되었습니다.');
                $('inboundForm').reset();
                $('inboundItemsContainer').innerHTML = '';
                this.addInboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.loadRecentInbounds();
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
            <div class="row g-2 mb-2 align-items-center outbound-item-row" id="${rowId}">
                <div class="col-md-3 position-relative">
                    <input type="text" class="form-control form-control-sm out-item" placeholder="품목명" autocomplete="off" required>
                    <div class="autocomplete-suggestions"></div>
                </div>
                <div class="col-md-2">
                    <select class="form-select form-select-sm out-spec" disabled required onchange="app.handleOutboundSpecChange('${rowId}', this)">
                        <option value="">품목 먼저 선택</option>
                    </select>
                </div>
                <div class="col-md-1">
                    <input type="text" class="form-control form-control-sm out-unit" placeholder="단위" readonly>
                </div>
                <div class="col-md-2">
                    <input type="number" class="form-control form-control-sm out-qty" placeholder="출고 수량" min="0.01" step="0.01" disabled required onchange="app.handleOutboundQtyChange('${rowId}')" onkeyup="app.handleOutboundQtyChange('${rowId}')">
                </div>
                <div class="col-md-2 d-flex gap-1">
                    <input type="number" class="form-control form-control-sm out-price" placeholder="단가" min="0" step="1" required>
                    <input type="number" class="form-control form-control-sm out-shipping" placeholder="배송비" min="0" step="1" value="0" required>
                </div>
                <div class="col-md-2 d-flex gap-1 justify-content-center">
                    <button type="button" class="btn btn-sm btn-outline-primary btn-lot flex-grow-1" onclick="app.openLotModal('${rowId}')" disabled>Lot 설정</button>
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="app.removeOutboundItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
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
        
        this.outboundRows[this.currentLotModalRowId].consumedLots = tempConsumed;
        this.validateAllOutboundLots();
        
        const modal = bootstrap.Modal.getInstance($('lotModal'));
        modal.hide();
    },

    validateAllOutboundLots: function() {
        const rows = document.querySelectorAll('.outbound-item-row');
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
        const rows = document.querySelectorAll('.outbound-item-row');
        if (rows.length === 0) return alert('출고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        rows.forEach(row => {
            const rowId = row.id;
            const item = row.querySelector('.out-item').value.trim();
            const spec = row.querySelector('.out-spec').value.trim();
            const unit = row.querySelector('.out-unit').value.trim();
            const qty = parseFloat(row.querySelector('.out-qty').value);
            const selling_price = parseFloat(row.querySelector('.out-price').value);
            const shipping_fee = parseFloat(row.querySelector('.out-shipping').value);
            const consumed_lots = this.outboundRows[rowId].consumedLots;

            if (!item || !spec || isNaN(qty) || isNaN(selling_price) || isNaN(shipping_fee)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, selling_price, shipping_fee, consumed_lots });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const payload = {
            date: $('out_date').value,
            destination: $('out_destination').value,
            items: items
        };

        if (confirm(`총 ${items.length}건의 품목을 출고하시겠습니까?`)) {
            try {
                await authFetch(`${API_BASE}/outbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('출고 완료되었습니다.');
                $('outboundForm').reset();
                $('outboundItemsContainer').innerHTML = '';
                this.outboundRows = {};
                this.addOutboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.loadRecentOutbounds();
            } catch (err) {
                alert('출고 실패: ' + err.message);
            }
        }
    },
    
    // ==========================================
    // History Modal & Print Logic
    // ==========================================
    openHistoryModal: async function(id, type) {
        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            this.currentHistoryDetail = data;
            
            $('detailModalTitle').innerText = type === 'inbound' ? '입고 상세 내역' : '출고 상세 내역';
            
            let html = `<div class="row g-3">
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">구분</div>
                        <div class="fw-bold fs-6">${type === 'inbound' ? '<span class="badge bg-success">입고</span>' : '<span class="badge bg-danger">출고</span>'}</div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">일자</div>
                        <div class="fw-bold fs-6">${data.date}</div>
                    </div>
                </div>
                
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">${type === 'inbound' ? '매입처' : '출고처'}</div>
                        <div class="fw-bold fs-6">${type === 'inbound' ? data.supplier : data.destination}</div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">품명/규격</div>
                        <div class="fw-bold fs-6 text-primary">${data.item} <span class="text-secondary fw-normal">/ ${data.spec}</span></div>
                    </div>
                </div>
                
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">수량/단위</div>
                        <div class="fw-bold fs-6">${data.qty.toLocaleString()} <span class="text-secondary fw-normal">${data.unit}</span></div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">단가/총액</div>
                        <div class="fw-bold fs-6">${(type === 'inbound' ? data.unit_price : data.selling_price).toLocaleString()}원</div>
                        <div class="text-danger small fw-bold mt-1">총액: ${(data.qty * (type === 'inbound' ? data.unit_price : data.selling_price)).toLocaleString()}원</div>
                    </div>
                </div>`;
            
            if (type === 'inbound') {
                html += `
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">창고 위치</div>
                        <div class="fw-bold fs-6">${data.location_name || '-'}</div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">비고</div>
                        <div class="fw-bold fs-6">${data.note || '-'}</div>
                    </div>
                </div>`;
                
                $('printOptInboundWrapper').style.display = 'inline-block';
                $('printOptInbound').checked = true;
                $('printOptOutboundWrapper').style.display = 'none';
                $('printOptTransWrapper').style.display = 'none';
            } else {
                let lotsHtml = '';
                if (data.consumed_lots && data.consumed_lots.length > 0) {
                    lotsHtml = data.consumed_lots.map(l => 
                        `<li class="mb-1">${l.inbound_date} 입고 <span class="text-muted">(${l.supplier}) [${l.location_name}]</span> - <span class="text-danger fw-bold">${l.consumed_qty}개 차감</span></li>`
                    ).join('');
                }
                html += `
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">배송비</div>
                        <div class="fw-bold fs-6">${data.shipping_fee.toLocaleString()}원</div>
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="p-3 bg-light rounded border border-light shadow-sm h-100">
                        <div class="text-muted small mb-1">차감 창고내역</div>
                        <ul class="mb-0 ps-3 fw-bold" style="font-size:0.85rem;">${lotsHtml || '<li class="text-muted">내역 없음</li>'}</ul>
                    </div>
                </div>`;
                    
                $('printOptInboundWrapper').style.display = 'none';
                $('printOptOutboundWrapper').style.display = 'inline-block';
                $('printOptTransWrapper').style.display = 'inline-block';
                $('printOptTrans').checked = true;
            }
            
            html += `</div>`;
            $('detailModalContent').innerHTML = html;
            
            new bootstrap.Modal(document.getElementById('historyDetailModal')).show();
            
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
                <style>
                    body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; color:#333; }
                    .header { text-align: center; font-size: 24px; font-weight: bold; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
                    .info-table, .data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }
                    .info-table th, .info-table td, .data-table th, .data-table td { border: 1px solid #ccc; padding: 8px; }
                    .info-table th, .data-table th { background-color: #f1f5f9; text-align: left; }
                    .text-right { text-align: right !important; }
                    .text-center { text-align: center !important; }
                </style>
            </head>
            <body>`;
            
        if (printType === 'transaction_statement') {
            const price = data.selling_price;
            const amount = price * data.qty;
            const vat = Math.floor(amount * 0.1);
            const total = amount + vat;
            
            htmlContent += `
                <div class="header">거 래 명 세 서</div>
                
                <table class="info-table" style="width: 50%; float: right; margin-bottom:20px;">
                    <tr><th rowspan="4" style="width:30px; text-align:center;">공<br>급<br>자</th><th>등록번호</th><td colspan="3">${bizNo}</td></tr>
                    <tr><th>상호</th><td>${bizName}</td><th>성명</th><td>${ceo}</td></tr>
                    <tr><th>주소</th><td colspan="3">${address}</td></tr>
                    <tr><th>업태</th><td>${bizType}</td><th>종목</th><td>${bizItem}</td></tr>
                </table>
                <div style="clear:both;"></div>
                
                <table class="info-table">
                    <tr>
                        <th style="width: 15%;">거래일자</th>
                        <td>${data.date}</td>
                        <th style="width: 15%;">공급받는자</th>
                        <td>${data.destination} 귀하</td>
                    </tr>
                </table>
                
                <table class="data-table">
                    <tr>
                        <th>품명</th>
                        <th>규격</th>
                        <th>단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>공급가액</th>
                        <th>세액(VAT)</th>
                        <th>합계금액</th>
                    </tr>
                    <tr>
                        <td>${data.item}</td>
                        <td>${data.spec}</td>
                        <td>${data.unit}</td>
                        <td class="text-right">${data.qty}</td>
                        <td class="text-right">${price.toLocaleString()}</td>
                        <td class="text-right">${amount.toLocaleString()}</td>
                        <td class="text-right">${vat.toLocaleString()}</td>
                        <td class="text-right">${total.toLocaleString()}</td>
                    </tr>
                </table>
            `;
        } else if (printType === 'inbound_receipt') {
            const amount = data.qty * data.unit_price;
            htmlContent += `
                <div class="header">입 고 내 역 서</div>
                <table class="info-table">
                    <tr>
                        <th style="width: 15%;">입고일자</th>
                        <td style="width: 35%;">${data.date}</td>
                        <th style="width: 15%;">매입처</th>
                        <td style="width: 35%;">${data.supplier}</td>
                    </tr>
                    <tr>
                        <th>입고창고</th>
                        <td colspan="3">${data.location_name || '-'}</td>
                    </tr>
                </table>
                <table class="data-table">
                    <tr>
                        <th>품명</th>
                        <th>규격</th>
                        <th>단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>합계금액</th>
                        <th>비고</th>
                    </tr>
                    <tr>
                        <td>${data.item}</td>
                        <td>${data.spec}</td>
                        <td>${data.unit}</td>
                        <td class="text-right">${data.qty}</td>
                        <td class="text-right">${data.unit_price.toLocaleString()}</td>
                        <td class="text-right">${amount.toLocaleString()}</td>
                        <td>${data.note || ''}</td>
                    </tr>
                </table>
            `;
        } else if (printType === 'outbound_receipt') {
            let lotsInfo = (data.consumed_lots || []).map(l => `${l.location_name}`).join(', ');
            htmlContent += `
                <div class="header">출 고 내 역 서</div>
                <table class="info-table">
                    <tr>
                        <th style="width: 15%;">출고일자</th>
                        <td style="width: 35%;">${data.date}</td>
                        <th style="width: 15%;">출고처</th>
                        <td style="width: 35%;">${data.destination}</td>
                    </tr>
                    <tr>
                        <th>출고창고</th>
                        <td colspan="3">${lotsInfo}</td>
                    </tr>
                </table>
                <table class="data-table">
                    <tr>
                        <th>품명</th>
                        <th>규격</th>
                        <th>단위</th>
                        <th>수량</th>
                        <th>배송비</th>
                        <th>담당자 확인</th>
                    </tr>
                    <tr>
                        <td>${data.item}</td>
                        <td>${data.spec}</td>
                        <td>${data.unit}</td>
                        <td class="text-right">${data.qty}</td>
                        <td class="text-right">${data.shipping_fee.toLocaleString()}</td>
                        <td></td>
                    </tr>
                </table>
                <div style="margin-top: 50px; text-align: right;">
                    인수자 서명 : _____________________ (인)
                </div>
            `;
        }
        
        htmlContent += `
            <script>
                window.onload = function() { window.print(); window.close(); }
            </script>
            </body>
            </html>
        `;
        
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
