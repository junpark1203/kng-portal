/**
 * 물류 단가표 모듈 프론트엔드 (01_Logistics/unit_prices/app.js)
 * ECOUNT ERP 디자인 시스템 완벽 동기화
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

// ── Auth 헬퍼 ──
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

const $ = id => document.getElementById(id);

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch (e) {}
    if (!token) {
        try { token = await waitForAuth(); } catch (e) {}
    }
    if (!token) {
        try { token = localStorage.getItem('kng_token') || sessionStorage.getItem('kng_token') || localStorage.getItem('token'); } catch (e) {}
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
        let errMsg = `HTTP error ${res.status}`;
        if (contentType.includes('application/json')) {
            try {
                const err = await res.json();
                errMsg = err.error || err.message || errMsg;
            } catch (e) {}
        }
        throw new Error(errMsg);
    }
    if (!contentType.includes('application/json')) {
        throw new Error(`응답 데이터 형식이 올바르지 않습니다 (${contentType || 'HTML'}). 서버 연결을 확인해주세요.`);
    }
    return res.json();
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

const app = {
    priceList: [],
    filteredList: [],
    selectedCategory: '',
    searchTarget: '',
    searchQuery: '',
    subSearchQuery: '',
    marginFilter: 'all',
    itemsSpecsMap: {},
    viewMode: 'item', // 'item' | 'spec'
    checkedSpecs: new Set(),
    checkedItemIds: new Set(),
    activeModalSpec: '',
    specCompareModalInstance: null,

    init: async function() {
        this.bindEvents();
        await this.loadItemSpecs();
        await this.loadPrices();
        this.setupAutocomplete();
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('priceTable');
        }
        if ($('specCompareModal') && window.bootstrap) {
            this.specCompareModalInstance = new bootstrap.Modal($('specCompareModal'));
        }
    },

    bindEvents: function() {
        // 검색 인풋 엔터키
        const searchInp = $('searchInput');
        if (searchInp) {
            searchInp.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.search();
                }
            });
        }

        // F8 저장 단축키 지원 (ECOUNT ERP 표준)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F8') {
                const priceModal = $('priceModal');
                if (priceModal && priceModal.classList.contains('show')) {
                    e.preventDefault();
                    const form = $('priceForm');
                    if (form) form.requestSubmit();
                }
            }
        });
    },

    loadItemSpecs: async function() {
        try {
            const data = await authFetch(`${API_BASE}/items/specs-map`);
            this.itemsSpecsMap = data || {};
        } catch (e) {
            console.warn('specs-map load error:', e);
            this.itemsSpecsMap = {};
        }
    },

    loadPrices: async function() {
        let data = null;
        try {
            data = await authFetch(`${API_BASE}/unit-prices`);
            this.priceList = data || [];
        } catch (err) {
            console.error('loadPrices network error:', err);
            $('priceTableBody').innerHTML = `
                <tr>
                    <td colspan="13" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle me-1'></i> 단가 데이터를 불러오지 못했습니다: ${err.message}
                    </td>
                </tr>
            `;
            return;
        }

        try {
            // Prune checkedItemIds that no longer exist
            if (this.checkedItemIds && this.checkedItemIds.size > 0) {
                const existingIds = new Set(this.priceList.map(p => p.id));
                for (const id of this.checkedItemIds) {
                    if (!existingIds.has(id)) this.checkedItemIds.delete(id);
                }
            }
            this.renderCategoryTabs();
            this.applyFiltersAndRender();
        } catch (renderErr) {
            console.error('loadPrices render error:', renderErr);
        }
    },

    // ─────────────────────────────────────────
    // 검색 & 필터링 시스템 (ECOUNT ERP 스마트 다중 검색)
    // ─────────────────────────────────────────
    onSearchTargetChange: function() {
        this.searchTarget = $('searchTarget').value;
        this.search();
    },

    onSearchInputKeyup: function(e) {
        const val = $('searchInput').value;
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.toggle('d-none', !val);

        if (e.key === 'Enter') {
            this.search();
        }
    },

    clearSearchInput: function() {
        $('searchInput').value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.search();
    },

    search: function() {
        this.searchQuery = $('searchInput') ? $('searchInput').value.trim().toLowerCase() : '';
        this.searchTarget = $('searchTarget') ? $('searchTarget').value : '';
        this.applyFiltersAndRender();
    },

    resetSearch: function() {
        if ($('searchInput')) $('searchInput').value = '';
        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('clearSearchBtn')) $('clearSearchBtn').classList.add('d-none');
        if ($('subSearchInput')) $('subSearchInput').value = '';
        if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
        if ($('marginFilter')) $('marginFilter').value = 'all';
        this.selectedCategory = '';
        this.searchQuery = '';
        this.subSearchQuery = '';
        this.searchTarget = '';
        this.marginFilter = 'all';
        this.renderCategoryTabs();
        this.applyFiltersAndRender();
    },

    onSubSearchInput: function(val) {
        this.subSearchQuery = (val || '').trim().toLowerCase();
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) clearBtn.classList.toggle('d-none', !this.subSearchQuery);
        this.applyFiltersAndRender();
    },

    clearSubSearch: function() {
        if ($('subSearchInput')) $('subSearchInput').value = '';
        if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
        this.subSearchQuery = '';
        this.applyFiltersAndRender();
    },

    renderCategoryTabs: function() {
        const container = $('categoryTabGroup');
        if (!container) return;
        const categories = new Set();
        this.priceList.forEach(p => {
            if (p.category && p.category.trim()) categories.add(p.category.trim());
        });

        let html = `<button type="button" class="erp-tab-btn ${this.selectedCategory === '' ? 'active' : ''}" data-category="" onclick="app.setCategoryFilter('')">전체</button>`;
        Array.from(categories).sort().forEach(cat => {
            html += `<button type="button" class="erp-tab-btn ${this.selectedCategory === cat ? 'active' : ''}" data-category="${cat}" onclick="app.setCategoryFilter('${cat}')">${cat}</button>`;
        });
        container.innerHTML = html;
    },

    setCategoryFilter: function(cat) {
        this.selectedCategory = cat;
        const btns = $('categoryTabGroup').querySelectorAll('.erp-tab-btn');
        btns.forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-category') === cat);
        });
        this.applyFiltersAndRender();
    },

    applyFiltersAndRender: function() {
        this.marginFilter = $('marginFilter') ? $('marginFilter').value : 'all';

        // 1. 카테고리 필터
        let list = this.priceList;
        if (this.selectedCategory) {
            list = list.filter(item => (item.category || '').trim() === this.selectedCategory);
        }

        // 2. 스마트 다중 검색 (공백 구분 AND 검색)
        if (this.searchQuery) {
            const tokens = this.searchQuery.split(/\s+/).filter(Boolean);
            list = list.filter(item => {
                let targetText = '';
                if (this.searchTarget === 'item') {
                    targetText = item.item || '';
                } else if (this.searchTarget === 'spec') {
                    targetText = item.spec || '';
                } else if (this.searchTarget === 'supplier') {
                    targetText = item.default_supplier || '';
                } else if (this.searchTarget === 'destination') {
                    targetText = item.default_destination || '';
                } else {
                    targetText = `${item.item || ''} ${item.spec || ''} ${item.category || ''} ${item.default_supplier || ''} ${item.default_destination || ''} ${item.note || ''}`;
                }
                const lowerTarget = targetText.toLowerCase();
                return tokens.every(token => lowerTarget.includes(token));
            });
        }

        // 3. 결과 내 재검색
        if (this.subSearchQuery) {
            const subTokens = this.subSearchQuery.split(/\s+/).filter(Boolean);
            list = list.filter(item => {
                const combined = `${item.item || ''} ${item.spec || ''} ${item.category || ''} ${item.default_supplier || ''} ${item.default_destination || ''} ${item.note || ''}`.toLowerCase();
                return subTokens.every(st => combined.includes(st));
            });
        }

        // 4. 마진 필터
        if (this.marginFilter !== 'all') {
            list = list.filter(item => {
                const buy = item.buy_price || 0;
                const sell = item.sell_price || 0;
                let marginRate = 0;
                if (sell > 0) marginRate = ((sell - buy) / sell) * 100;
                else if (buy > 0) marginRate = -100;

                if (this.marginFilter === 'high') return marginRate >= 20;
                if (this.marginFilter === 'mid') return marginRate >= 10 && marginRate < 20;
                if (this.marginFilter === 'low') return marginRate >= 0 && marginRate < 10;
                if (this.marginFilter === 'loss') return marginRate < 0;
                return true;
            });
        }

        this.filteredList = list;
        this.renderTable();
        this.renderStats();
        if (this.viewMode === 'spec') {
            this.renderSpecMatrix();
        }
    },

    renderStats: function() {
        const totalCount = this.priceList.length;
        const filterCount = this.filteredList.length;

        // 상단 뱃지 갱신
        $('itemCountBadge').innerText = `관리 ${totalCount} 품목`;

        let validCount = 0;
        let sumMarginRate = 0;
        this.priceList.forEach(p => {
            const b = p.buy_price || 0;
            const s = p.sell_price || 0;
            if (s > 0) {
                sumMarginRate += ((s - b) / s) * 100;
                validCount++;
            }
        });
        const avgMargin = validCount > 0 ? Math.round((sumMarginRate / validCount) * 10) / 10 : 0;
        $('avgMarginBadge').innerText = `평균 마진율: ${avgMargin}%`;

        // 필터 결과수
        $('filterResultCount').innerText = `조회 ${filterCount}건 (전체 ${totalCount}건)`;
    },

    renderTable: function() {
        const tbody = $('priceTableBody');
        const tfoot = $('priceTableFoot');

        if (this.filteredList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="13" class="text-center py-5 text-muted">
                        <i class='bx bx-info-circle me-1'></i> 조건에 일치하는 단가 데이터가 없습니다.
                    </td>
                </tr>
            `;
            if (tfoot) tfoot.classList.add('d-none');
            return;
        }

        let sumBuy = 0;
        let sumSell = 0;
        let sumMargin = 0;
        let validRateCount = 0;
        let sumRate = 0;

        let html = '';
        this.filteredList.forEach((r, idx) => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
            let marginRate = 0;
            let marginRateStr = '-';
            let badgeClass = 'margin-mid';

            if (sell > 0 && buy > 0) {
                marginRate = Math.round(((sell - buy) / sell) * 1000) / 10;
                marginRateStr = `${marginRate}%`;
                if (marginRate >= 20) badgeClass = 'margin-high';
                else if (marginRate >= 10) badgeClass = 'margin-mid';
                else if (marginRate >= 0) badgeClass = 'margin-low';
                else badgeClass = 'margin-loss';

                sumRate += marginRate;
                validRateCount++;
            }

            sumBuy += buy;
            sumSell += sell;
            sumMargin += marginAmt;

            let histCount = 0;
            try { histCount = JSON.parse(r.history || '[]').length; } catch(e){}

            const isChecked = this.checkedItemIds.has(r.id);
            html += `
                <tr id="price_row_${r.id}" class="${isChecked ? 'selected-row' : ''}">
                    <td class="row-index text-center">
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <input type="checkbox" class="form-check-input mt-0 item-checkbox cursor-pointer" 
                                   data-id="${r.id}" ${isChecked ? 'checked' : ''} 
                                   onchange="app.onItemCheck(${r.id}, this.checked)">
                            <span class="row-num">${idx + 1}</span>
                        </div>
                    </td>
                    <td class="text-center"><span class="category-pill">${escapeHtml(r.category || '-')}</span></td>
                    <td class="text-start ps-2 fw-semibold text-truncate" title="${escapeHtml(r.item)}">${escapeHtml(r.item)}</td>
                    <td class="text-start ps-2 text-truncate" title="${escapeHtml(r.spec || '')}">
                        ${(r.spec && r.spec.trim()) ? `
                            <button type="button" class="btn-spec-pill" data-group-key="${escapeHtml(((r.item || '').trim() + '___' + (r.spec || '').trim()).toLowerCase())}" onclick="event.stopPropagation(); app.openSpecCompare(this.getAttribute('data-group-key'))" title="'${escapeHtml(r.item)} [${escapeHtml(r.spec.trim())}]' 다자 견적 비교 매트릭스 보기">
                                <i class='bx bx-git-compare text-primary'></i> ${escapeHtml(r.spec.trim())}
                            </button>
                        ` : '<span class="text-muted">-</span>'}
                    </td>
                    <td class="text-center text-muted">${escapeHtml(r.unit || '-')}</td>
                    <td class="td-buy pe-2">
                        ${buy ? buy.toLocaleString() + '원' : '-'}
                        ${(r.is_freight_included === 1 || r.is_freight_included === true || (r.note && r.note.includes('[운임포함]'))) ? '<span class="badge-freight-in ms-1" style="font-size: 9.5px; padding: 0 3px;" title="운임 포함 (도착도)">운임포함</span>' : ''}
                    </td>
                    <td class="td-sell pe-2">${sell ? sell.toLocaleString() + '원' : '-'}</td>
                    <td class="td-margin-amt pe-2 ${marginAmt < 0 ? 'text-danger' : ''}">${marginAmt ? marginAmt.toLocaleString() + '원' : '-'}</td>
                    <td class="text-center"><span class="margin-badge ${badgeClass}">${marginRateStr}</span></td>
                    <td class="text-start ps-2 text-truncate" title="${r.default_supplier || ''}">${r.default_supplier || '-'}</td>
                    <td class="text-start ps-2 text-truncate" title="${r.default_destination || ''}">${r.default_destination || '-'}</td>
                    <td class="text-center">
                        <button type="button" class="btn-hist" onclick="app.openHistoryModal(${r.id})" title="단가 변동 이력 타임라인 보기">
                            <i class='bx bx-history'></i> ${histCount}건
                        </button>
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn-table-action" onclick="app.openEditModal(${r.id})" title="단가 수정">
                            <i class='bx bx-edit text-primary'></i>
                        </button>
                        <button type="button" class="btn-table-action btn-del" onclick="app.deletePrice(${r.id})" title="단가 삭제">
                            <i class='bx bx-trash'></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        this.updateItemSelectionState();

        // 하단 합계 요약 바
        if (tfoot) {
            tfoot.classList.remove('d-none');
            const cnt = this.filteredList.length;
            $('footSummaryItems').innerText = `총 ${cnt}개 품목`;
            $('footAvgBuy').innerText = `${Math.round(sumBuy / cnt).toLocaleString()}원 (평균)`;
            $('footAvgSell').innerText = `${Math.round(sumSell / cnt).toLocaleString()}원 (평균)`;
            $('footAvgMarginAmt').innerText = `${Math.round(sumMargin / cnt).toLocaleString()}원 (평균)`;
            const avgR = validRateCount > 0 ? (Math.round((sumRate / validRateCount) * 10) / 10) : 0;
            $('footAvgMarginRate').innerText = `${avgR}%`;
        }

        // ERP 그리드 리사이저 동기화
        if (window.ErpGridResizer) {
            try {
                if (typeof window.ErpGridResizer.sync === 'function') {
                    window.ErpGridResizer.sync('priceTable');
                } else if (typeof window.ErpGridResizer.init === 'function') {
                    window.ErpGridResizer.init('priceTable');
                }
            } catch (e) {
                console.warn('ErpGridResizer sync warning:', e);
            }
        }
    },

    // ─────────────────────────────────────────
    // 단가 등록 / 수정 모달
    // ─────────────────────────────────────────
    openCreateModal: function() {
        $('priceForm').reset();
        $('editId').value = '';
        this.currentEditId = null;
        if ($('btnModalDelete')) $('btnModalDelete').classList.add('d-none');
        if ($('inpFreightIncluded')) $('inpFreightIncluded').checked = false;
        $('priceModalLabel').innerHTML = `<i class='bx bx-plus me-1'></i> 신규 물류 기준단가 등록 (사전 견적가)`;
        $('inpCurrency').value = 'KRW';
        this.calcModalMargin();
        const modal = new bootstrap.Modal($('priceModal'));
        modal.show();
    },

    openCreateModalWithItemSpec: function(item, spec) {
        this.openCreateModal();
        if ($('inpItem') && item) $('inpItem').value = item;
        if ($('inpSpec') && spec && spec !== '(규격미지정)') $('inpSpec').value = spec;
    },

    openEditModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('priceForm').reset();
        $('editId').value = item.id;
        this.currentEditId = id;
        if ($('btnModalDelete')) $('btnModalDelete').classList.remove('d-none');

        const isFreight = item.is_freight_included === 1 || item.is_freight_included === true || (item.note && item.note.includes('[운임포함]'));
        if ($('inpFreightIncluded')) $('inpFreightIncluded').checked = !!isFreight;

        $('priceModalLabel').innerHTML = `<i class='bx bx-edit-alt me-1'></i> 기준단가 수정: <span class="text-warning">${escapeHtml(item.item)}</span>`;
        $('inpItem').value = item.item || '';
        $('inpSpec').value = item.spec || '';
        $('inpCategory').value = item.category || '';
        $('inpUnit').value = item.unit || '';
        $('inpCurrency').value = item.currency || 'KRW';
        $('inpBuyPrice').value = item.buy_price || '';
        $('inpSellPrice').value = item.sell_price || '';
        $('inpSupplier').value = item.default_supplier || '';
        $('inpDestination').value = item.default_destination || '';
        $('inpNote').value = (item.note || '').replace(/\[운임포함\]/g, '').trim();

        this.calcModalMargin();
        const modal = new bootstrap.Modal($('priceModal'));
        modal.show();
    },

    deletePriceFromModal: async function() {
        const id = this.currentEditId || parseInt($('editId').value, 10);
        if (!id) return;
        const modalEl = $('priceModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        await this.deletePrice(id);
    },

    calcModalMargin: function() {
        const buy = parseFloat($('inpBuyPrice').value) || 0;
        const sell = parseFloat($('inpSellPrice').value) || 0;
        const container = $('modalMarginCalc');
        if (!container) return;

        if (sell > 0 && buy > 0) {
            const diff = sell - buy;
            const rate = Math.round((diff / sell) * 1000) / 10;
            let badgeColor = 'bg-primary';
            if (rate >= 20) badgeColor = 'bg-success';
            else if (rate < 0) badgeColor = 'bg-danger';

            container.innerHTML = `
                <span class="fw-bold fs-6 text-dark me-2">${diff.toLocaleString()}원</span>
                <span class="badge ${badgeColor}" style="font-size: 11px;">마진율 ${rate}%</span>
            `;
        } else {
            container.innerHTML = `<span class="text-muted" style="font-size: 11.5px;">매입/매출단가를 입력하면 자동 계산됩니다.</span>`;
        }
    },

    handleSavePrice: async function(e) {
        e.preventDefault();
        const editId = $('editId').value;
        const isFreight = $('inpFreightIncluded') && $('inpFreightIncluded').checked ? 1 : 0;
        let noteVal = $('inpNote').value.trim();
        if (isFreight && !noteVal.includes('[운임포함]')) {
            noteVal = (noteVal ? noteVal + ' ' : '') + '[운임포함]';
        } else if (!isFreight && noteVal.includes('[운임포함]')) {
            noteVal = noteVal.replace(/\[운임포함\]/g, '').trim();
        }

        const payload = {
            item: $('inpItem').value.trim(),
            spec: $('inpSpec').value.trim(),
            category: $('inpCategory').value.trim(),
            unit: $('inpUnit').value.trim(),
            currency: $('inpCurrency').value || 'KRW',
            buy_price: parseFloat($('inpBuyPrice').value) || 0,
            sell_price: parseFloat($('inpSellPrice').value) || 0,
            default_supplier: $('inpSupplier').value.trim(),
            default_destination: $('inpDestination').value.trim(),
            note: noteVal,
            is_freight_included: isFreight
        };

        if (!payload.item) {
            alert('품목명은 필수 입력 항목입니다.');
            return;
        }

        try {
            if (editId) {
                await authFetch(`${API_BASE}/unit-prices/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                alert('기준단가가 성공적으로 수정되었습니다.');
            } else {
                await authFetch(`${API_BASE}/unit-prices`, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                alert('신규 기준단가가 등록되었습니다.');
            }

            const modalEl = $('priceModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            await this.loadPrices();
            await this.loadItemSpecs();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    },

    deletePrice: async function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        if (!confirm(`[${item.item} (${item.spec || '규격없음'}) / ${item.default_supplier || '공급처미지정'}] 단가 마스터를 삭제하시겠습니까?\n이 품목의 가격 변동 이력도 함께 삭제됩니다.`)) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/unit-prices/${id}`, { method: 'DELETE' });
            alert('삭제되었습니다.');
            this.checkedItemIds.delete(id);
            this.updateItemSelectionState();
            await this.loadPrices();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    toggleSelectAllItems: function(checked) {
        if (checked) {
            this.filteredList.forEach(r => this.checkedItemIds.add(r.id));
        } else {
            this.filteredList.forEach(r => this.checkedItemIds.delete(r.id));
        }

        document.querySelectorAll('.item-checkbox').forEach(cb => {
            const id = parseInt(cb.getAttribute('data-id'), 10);
            const isSel = this.checkedItemIds.has(id);
            cb.checked = isSel;
            const tr = document.getElementById(`price_row_${id}`);
            if (tr) tr.classList.toggle('selected-row', isSel);
        });

        this.updateItemSelectionState();
    },

    onItemCheck: function(id, checked) {
        if (checked) {
            this.checkedItemIds.add(id);
        } else {
            this.checkedItemIds.delete(id);
        }

        const tr = document.getElementById(`price_row_${id}`);
        if (tr) tr.classList.toggle('selected-row', checked);

        this.updateItemSelectionState();
    },

    updateItemSelectionState: function() {
        const size = this.checkedItemIds.size;
        const totalVisible = this.filteredList.length;

        const masterCb = $('selectAllItems');
        if (masterCb) {
            const visibleCheckedCount = this.filteredList.filter(r => this.checkedItemIds.has(r.id)).length;
            masterCb.checked = totalVisible > 0 && visibleCheckedCount === totalVisible;
            masterCb.indeterminate = visibleCheckedCount > 0 && visibleCheckedCount < totalVisible;
        }

        const badge = $('selectedItemsBadge');
        if (badge) {
            badge.innerText = `${size}건 선택됨`;
            badge.classList.toggle('d-none', size === 0);
        }

        const btnBatch = $('btnBatchDelete');
        const btnTopBatch = $('btnTopBatchDelete');
        const textBatch = $('batchDeleteText');
        const textTopBatch = $('topBatchDeleteText');

        if (btnBatch) btnBatch.classList.toggle('d-none', size === 0);
        if (btnTopBatch) btnTopBatch.classList.toggle('d-none', size === 0);
        if (textBatch) textBatch.innerText = `선택 삭제 (${size})`;
        if (textTopBatch) textTopBatch.innerText = `선택 삭제 (${size})`;
    },

    deleteSelectedItems: async function() {
        const ids = Array.from(this.checkedItemIds);
        if (ids.length === 0) {
            alert('선택된 단가 항목이 없습니다.');
            return;
        }

        if (!confirm(`선택한 ${ids.length}개의 단가 항목을 일괄 삭제하시겠습니까?\n이 품목들의 가격 변동 이력도 함께 영구 삭제됩니다.`)) {
            return;
        }

        try {
            let success = false;
            try {
                const res = await authFetch(`${API_BASE}/unit-prices/batch-delete`, {
                    method: 'POST',
                    body: JSON.stringify({ ids })
                });
                if (res && (res.deletedCount || res.message)) {
                    success = true;
                }
            } catch (apiErr) {
                console.warn('Batch delete endpoint failed, falling back to sequential delete:', apiErr);
            }

            if (!success) {
                for (const id of ids) {
                    await authFetch(`${API_BASE}/unit-prices/${id}`, { method: 'DELETE' });
                }
            }

            alert(`선택한 ${ids.length}건의 단가 항목이 성공적으로 삭제되었습니다.`);
            this.checkedItemIds.clear();
            await this.loadPrices();
            await this.loadItemSpecs();
        } catch (err) {
            alert('일괄 삭제 중 오류가 발생했습니다: ' + err.message);
            await this.loadPrices();
        }
    },

    // ─────────────────────────────────────────
    // 품목명 / 규격 자동완성 연동 (모달 폼)
    // ─────────────────────────────────────────
    setupAutocomplete: function() {
        const inpItem = $('inpItem');
        const sugItem = $('sugItem');
        const inpSpec = $('inpSpec');
        const sugSpec = $('sugSpec');

        if (inpItem && sugItem) {
            inpItem.addEventListener('input', (e) => {
                const val = e.target.value.trim().toLowerCase();
                if (!val) { sugItem.style.display = 'none'; return; }
                const itemKeys = Object.keys(this.itemsSpecsMap);
                const matched = itemKeys.filter(k => k.toLowerCase().includes(val)).slice(0, 8);
                if (matched.length === 0) { sugItem.style.display = 'none'; return; }

                sugItem.innerHTML = matched.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                sugItem.style.display = 'block';

                sugItem.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                    div.addEventListener('click', () => {
                        inpItem.value = div.innerText.trim();
                        sugItem.style.display = 'none';
                        const info = this.itemsSpecsMap[inpItem.value];
                        if (info) {
                            if (info.defaultCategory && !$('inpCategory').value) $('inpCategory').value = info.defaultCategory;
                            if (info.defaultUnit && !$('inpUnit').value) $('inpUnit').value = info.defaultUnit;
                        }
                    });
                });
            });

            inpItem.addEventListener('blur', () => setTimeout(() => sugItem.style.display = 'none', 200));
        }

        if (inpSpec && sugSpec) {
            const showSpecs = () => {
                const currentItem = inpItem ? inpItem.value.trim() : '';
                const val = inpSpec.value.trim().toLowerCase();
                const info = this.itemsSpecsMap[currentItem];
                const specs = info && info.specs ? info.specs : [];
                if (specs.length === 0) { sugSpec.style.display = 'none'; return; }

                const filtered = val ? specs.filter(s => s.toLowerCase().includes(val)) : specs;
                if (filtered.length === 0) { sugSpec.style.display = 'none'; return; }

                sugSpec.innerHTML = filtered.map(s => `<div class="autocomplete-suggestion">${s}</div>`).join('');
                sugSpec.style.display = 'block';

                sugSpec.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                    div.addEventListener('click', () => {
                        inpSpec.value = div.innerText.trim();
                        sugSpec.style.display = 'none';
                    });
                });
            };

            inpSpec.addEventListener('focus', showSpecs);
            inpSpec.addEventListener('input', showSpecs);
            inpSpec.addEventListener('blur', () => setTimeout(() => sugSpec.style.display = 'none', 200));
        }
    },

    // ─────────────────────────────────────────
    // 단가 변동 시계열 이력 모달
    // ─────────────────────────────────────────
    openHistoryModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('histItemName').innerText = item.item;
        $('histSpecName').innerText = item.spec ? `(${item.spec})` : '';
        $('histCategoryBadge').innerText = item.category || '기타';

        $('histCurrentBuy').innerText = `매입 ${(item.buy_price || 0).toLocaleString()}원`;
        $('histCurrentSell').innerText = `매출 ${(item.sell_price || 0).toLocaleString()}원`;

        let list = [];
        try { list = JSON.parse(item.history || '[]'); } catch(e){ list = []; }

        const tbody = $('histTableBody');
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">기록된 단가 변동 내역이 없습니다.</td></tr>`;
        } else {
            tbody.innerHTML = list.map(h => {
                const buy = h.buy_price || 0;
                const prevBuy = h.prev_buy_price || 0;
                let buyDiffStr = '';
                if (prevBuy > 0) {
                    const diff = buy - prevBuy;
                    if (diff > 0) buyDiffStr = ` <span class="diff-up">(▲${diff.toLocaleString()})</span>`;
                    else if (diff < 0) buyDiffStr = ` <span class="diff-down">(▼${Math.abs(diff).toLocaleString()})</span>`;
                    else buyDiffStr = ` <span class="diff-same">(-)</span>`;
                }

                const sell = h.sell_price || 0;
                const prevSell = h.prev_sell_price || 0;
                let sellDiffStr = '';
                if (prevSell > 0) {
                    const diff = sell - prevSell;
                    if (diff > 0) sellDiffStr = ` <span class="diff-up">(▲${diff.toLocaleString()})</span>`;
                    else if (diff < 0) sellDiffStr = ` <span class="diff-down">(▼${Math.abs(diff).toLocaleString()})</span>`;
                    else sellDiffStr = ` <span class="diff-same">(-)</span>`;
                }

                let sourceBadge = `<span class="source-badge source-manual">수동</span>`;
                if (h.source === 'direct') sourceBadge = `<span class="source-badge source-direct">직출고</span>`;
                else if (h.source === 'inbound') sourceBadge = `<span class="source-badge source-inbound">입고</span>`;
                else if (h.source === 'outbound') sourceBadge = `<span class="source-badge source-outbound">출고</span>`;

                return `
                    <tr>
                        <td class="text-center text-muted">${h.date || '-'}</td>
                        <td class="text-center">${sourceBadge}</td>
                        <td class="text-end pe-2 fw-semibold">${buy ? buy.toLocaleString() + '원' : '-'}${buyDiffStr}</td>
                        <td class="text-end pe-2 fw-bold text-primary">${sell ? sell.toLocaleString() + '원' : '-'}${sellDiffStr}</td>
                        <td class="text-start ps-2 text-truncate" title="${h.partner || ''}">${h.partner || '-'}</td>
                        <td class="text-start ps-2 text-muted text-truncate" title="${h.note || ''}">${h.note || '-'}</td>
                    </tr>
                `;
            }).join('');
        }

        const modal = new bootstrap.Modal($('historyModal'));
        modal.show();
    },

    // ─────────────────────────────────────────
    // 기존 장부에서 단가 자동 불러오기
    // ─────────────────────────────────────────
    populateFromHistory: async function() {
        if (!confirm('기존에 등록된 입고, 출고, 직출고 장부를 전체 분석하여 최근 단가를 물류 단가표에 자동으로 등록/갱신하시겠습니까?')) {
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/unit-prices/populate-from-history`, { method: 'POST' });
            alert(res.message || '장부 단가 반영이 완료되었습니다.');
            await this.loadPrices();
            await this.loadItemSpecs();
        } catch (err) {
            alert('장부 단가 반영 실패: ' + err.message);
        }
    },

    // ─────────────────────────────────────────
    // 엑셀(CSV) 내보내기
    // ─────────────────────────────────────────
    exportExcel: function() {
        if (this.filteredList.length === 0) {
            alert('내보낼 단가 데이터가 없습니다.');
            return;
        }

        const headers = ['No', '자재분류', '품목명', '규격', '단위', '기준 매입단가', '기준 매출단가', '마진액', '마진율(%)', '주 매입처', '주 매출처', '비고'];
        const rows = this.filteredList.map((r, idx) => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
            const marginRate = (sell > 0 && buy > 0) ? Math.round(((sell - buy) / sell) * 1000) / 10 : 0;

            return [
                idx + 1,
                r.category || '',
                r.item || '',
                r.spec || '',
                r.unit || '',
                buy,
                sell,
                marginAmt,
                marginRate,
                r.default_supplier || '',
                r.default_destination || '',
                r.note || ''
            ];
        });

        const csvContent = '\uFEFF' + [headers, ...rows].map(row => 
            row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')
        ).join('\r\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        a.href = url;
        a.download = `KNG_물류단가표_${today}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ─────────────────────────────────────────
    // 규격별 다자 비교 매트릭스 시스템
    // ─────────────────────────────────────────
    switchViewMode: function(mode) {
        this.viewMode = mode;
        const itemBtn = $('viewModeItemBtn');
        const specBtn = $('viewModeSpecBtn');
        if (itemBtn) itemBtn.classList.toggle('active', mode === 'item');
        if (specBtn) specBtn.classList.toggle('active', mode === 'spec');

        const priceGrid = $('priceGridWrapper');
        const specGrid = $('specMatrixWrapper');
        if (priceGrid) priceGrid.classList.toggle('d-none', mode !== 'item');
        if (specGrid) specGrid.classList.toggle('d-none', mode !== 'spec');

        const exportExcelBtn = $('btnExportExcel');
        const topPrintSpecsBtn = $('btnTopPrintSpecs');
        const topExportSpecsBtn = $('btnTopExportSpecs');
        if (exportExcelBtn) exportExcelBtn.classList.toggle('d-none', mode !== 'item');
        if (topPrintSpecsBtn) topPrintSpecsBtn.classList.toggle('d-none', mode !== 'spec');
        if (topExportSpecsBtn) topExportSpecsBtn.classList.toggle('d-none', mode !== 'spec');

        if (mode === 'spec') {
            this.renderSpecMatrix();
        }
    },

    getGroupKey: function(item, spec) {
        const it = (item || '').trim().toLowerCase();
        const sp = (spec || '').trim().toLowerCase();
        return `${it}___${sp}`;
    },

    getGroupedSpecs: function() {
        const map = new Map();
        this.filteredList.forEach(item => {
            const rawItem = (item.item || '').trim();
            const rawSpec = (item.spec || '').trim();
            const displayItem = rawItem || '(품목명미지정)';
            const displaySpec = rawSpec || '(규격미지정)';
            const groupKey = this.getGroupKey(displayItem, displaySpec);

            if (!map.has(groupKey)) {
                map.set(groupKey, {
                    groupKey: groupKey,
                    item: displayItem,
                    spec: displaySpec,
                    isNoSpec: !rawSpec,
                    category: item.category || '일반자재',
                    unit: item.unit || 'EA',
                    items: []
                });
            }
            map.get(groupKey).items.push(item);
        });

        const groups = Array.from(map.values());
        groups.forEach(g => {
            let minBuy = Infinity;
            let maxSell = 0;
            let bestBuySupplier = null;
            let sumMargin = 0;
            let validMarginCount = 0;

            g.items.forEach(it => {
                const buy = it.buy_price || 0;
                const sell = it.sell_price || 0;
                if (buy > 0 && buy < minBuy) {
                    minBuy = buy;
                    bestBuySupplier = it.default_supplier || it.item;
                }
                if (sell > maxSell) maxSell = sell;
                if (sell > 0 && buy > 0) {
                    sumMargin += ((sell - buy) / sell) * 100;
                    validMarginCount++;
                }
            });

            g.minBuy = minBuy === Infinity ? 0 : minBuy;
            g.maxSell = maxSell;
            g.bestBuySupplier = bestBuySupplier;
            g.avgMargin = validMarginCount > 0 ? Math.round((sumMargin / validMarginCount) * 10) / 10 : 0;
        });

        // 정렬: 견적 수 많은 순 -> 품목명 오름차순 -> 규격명 오름차순
        groups.sort((a, b) => {
            if (b.items.length !== a.items.length) return b.items.length - a.items.length;
            const itemCmp = a.item.localeCompare(b.item, 'ko');
            if (itemCmp !== 0) return itemCmp;
            return a.spec.localeCompare(b.spec, 'ko');
        });

        return groups;
    },

    renderSpecMatrix: function() {
        const container = $('specMatrixContainer');
        if (!container) return;

        const groups = this.getGroupedSpecs();
        if (groups.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5 text-muted bg-white rounded border">
                    <i class='bx bx-info-circle fs-3 me-1'></i> 조건에 일치하는 품목/규격 매트릭스 데이터가 없습니다.
                </div>
            `;
            if ($('specMatrixTotalBadge')) $('specMatrixTotalBadge').innerText = '총 0개 품목/규격';
            return;
        }

        if ($('specMatrixTotalBadge')) $('specMatrixTotalBadge').innerText = `총 ${groups.length}개 품목/규격 (${this.filteredList.length}건 견적)`;

        let html = '';
        groups.forEach((g, idx) => {
            const isChecked = this.checkedSpecs.has(g.groupKey);
            const cardId = `spec_card_${idx}`;
            const bodyId = `spec_card_body_${idx}`;

            const bestBuyText = g.minBuy > 0 ? `최저 매입: ₩${g.minBuy.toLocaleString()} (${escapeHtml(g.bestBuySupplier || '-')})` : '매입단가 미등록';
            const maxSellText = g.maxSell > 0 ? `최고 매출: ₩${g.maxSell.toLocaleString()}` : '-';

            html += `
                <div class="spec-matrix-card ${isChecked ? 'selected' : ''}" id="${cardId}" data-group-key="${escapeHtml(g.groupKey)}">
                    <div class="spec-card-header">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <input type="checkbox" class="form-check-input mt-0 spec-checkbox cursor-pointer" 
                                   data-group-key="${escapeHtml(g.groupKey)}" ${isChecked ? 'checked' : ''} 
                                   onchange="app.onSpecCheck(this.getAttribute('data-group-key'), this.checked)">
                            <span class="spec-card-title">
                                <i class='bx bx-purchase-tag-alt text-primary'></i>
                                <strong class="text-dark">${escapeHtml(g.item)}</strong>
                                <span class="spec-pill ms-1">${escapeHtml(g.spec)}</span>
                            </span>
                            <span class="category-pill">${escapeHtml(g.category)}</span>
                            <span class="badge bg-secondary">${g.items.length}개 견적 후보</span>
                            <span class="badge-best-price"><i class='bx bx-check-circle'></i> ${bestBuyText}</span>
                            <span class="badge-best-margin"><i class='bx bx-trending-up'></i> ${maxSellText} / 평균마진 ${g.avgMargin}%</span>
                        </div>

                        <div class="d-flex align-items-center gap-1">
                            <button type="button" class="btn-erp btn-sm" onclick="app.openSpecCompare('${escapeHtml(g.groupKey)}')" title="이 품목/규격의 상세 팝업 매트릭스 열기">
                                <i class='bx bx-expand-alt text-primary'></i> 상세 대조
                            </button>
                            <button type="button" class="btn-erp btn-sm" onclick="app.openCreateModalWithItemSpec('${escapeHtml(g.item)}', '${escapeHtml(g.spec)}')" title="이 품목/규격에 새로운 공급처 단가 견적 추가 등록">
                                <i class='bx bx-plus'></i> 견적 추가
                            </button>
                            <button type="button" class="btn-erp btn-sm" onclick="app.toggleCardCollapse('${bodyId}', this)" title="매트릭스 표 접기/펼치기">
                                <i class='bx bx-chevron-up'></i>
                            </button>
                        </div>
                    </div>

                    <div class="spec-card-body p-2 border-top" id="${bodyId}">
                        <div class="table-responsive">
                            ${this.generateMatrixTableHtml(g.items, g)}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this.updateCheckedBadge();
    },

    generateMatrixTableHtml: function(items, groupInfo) {
        if (!items || items.length === 0) {
            return '<div class="text-muted p-3 text-center">등록된 견적이 없습니다.</div>';
        }

        let minBuy = Infinity;
        let maxSell = 0;
        let maxMarginRate = -Infinity;
        items.forEach(it => {
            const b = it.buy_price || 0;
            const s = it.sell_price || 0;
            if (b > 0 && b < minBuy) minBuy = b;
            if (s > maxSell) maxSell = s;
            if (s > 0 && b > 0) {
                const r = Math.round(((s - b) / s) * 1000) / 10;
                if (r > maxMarginRate) maxMarginRate = r;
            }
        });
        if (minBuy === Infinity) minBuy = 0;

        let theadHtml = `
            <thead>
                <tr>
                    <th class="matrix-label-col">항목 \\ 견적 후보</th>
                    ${items.map((it, idx) => {
                        const isBestBuy = it.buy_price > 0 && it.buy_price === minBuy && items.length > 1;
                        return `
                            <th class="matrix-item-col matrix-item-header">
                                <div class="d-flex justify-content-between align-items-center gap-1">
                                    <span>후보 ${idx + 1}: ${escapeHtml(it.default_supplier || '공급처미지정')}</span>
                                    ${isBestBuy ? '<span class="badge bg-success" style="font-size: 10px;">최저가★</span>' : ''}
                                </div>
                            </th>
                        `;
                    }).join('')}
                </tr>
            </thead>
        `;

        const rowsDef = [
            {
                label: '공급업체(주 매입처)',
                render: it => `<strong class="text-dark">${escapeHtml(it.default_supplier || '-')}</strong>`
            },
            {
                label: '품목명',
                render: it => `${escapeHtml(it.item)}`
            },
            {
                label: '규격',
                render: it => `<span class="spec-pill">${escapeHtml(it.spec || '-')}</span>`
            },
            {
                label: '자재분류',
                render: it => `<span class="category-pill">${escapeHtml(it.category || '-')}</span>`
            },
            {
                label: '단위',
                render: it => `${escapeHtml(it.unit || '-')}`
            },
            {
                label: '기준 매입단가',
                render: it => {
                    const buy = it.buy_price || 0;
                    const isLowest = buy > 0 && buy === minBuy && items.length > 1;
                    return buy ? `
                        <span class="${isLowest ? 'cell-best-price px-2 py-1 rounded d-inline-block' : 'fw-bold text-dark'}">
                            ₩${buy.toLocaleString()}
                            ${isLowest ? '<i class="bx bx-check" title="최저 매입단가"></i>' : ''}
                        </span>
                    ` : '<span class="text-muted">-</span>';
                }
            },
            {
                label: '운임 조건',
                render: it => {
                    const isFreight = it.is_freight_included === 1 || it.is_freight_included === true || (it.note && it.note.includes('[운임포함]'));
                    return isFreight
                        ? `<span class="badge-freight-in"><i class='bx bx-check-circle'></i> 운임포함 (도착도)</span>`
                        : `<span class="badge-freight-ex"><i class='bx bx-box'></i> 운임별도 (상차도)</span>`;
                }
            },
            {
                label: '기준 매출단가',
                render: it => {
                    const sell = it.sell_price || 0;
                    return sell ? `<span class="text-primary fw-bold">₩${sell.toLocaleString()}</span>` : '<span class="text-muted">-</span>';
                }
            },
            {
                label: '주 매출처',
                render: it => `${escapeHtml(it.default_destination || '-')}`
            },
            {
                label: '마진액 / 마진율',
                render: it => {
                    const buy = it.buy_price || 0;
                    const sell = it.sell_price || 0;
                    if (sell > 0 && buy > 0) {
                        const amt = sell - buy;
                        const rate = Math.round((amt / sell) * 1000) / 10;
                        const isBest = rate === maxMarginRate && items.length > 1;
                        return `
                            <span class="${isBest ? 'cell-best-margin px-1 rounded' : ''}">
                                ₩${amt.toLocaleString()} (${rate}%)
                            </span>
                        `;
                    }
                    return '<span class="text-muted">-</span>';
                }
            },
            {
                label: '단가 변동 이력',
                render: it => {
                    let count = 0;
                    try { count = JSON.parse(it.history || '[]').length; } catch(e){}
                    return `
                        <button type="button" class="btn-hist btn-sm py-0" onclick="app.openHistoryModal(${it.id})" title="시계열 변동 이력 보기">
                            <i class='bx bx-history'></i> ${count}건
                        </button>
                    `;
                }
            },
            {
                label: '비고 / 메모',
                render: it => {
                    const cleanNote = (it.note || '').replace(/\[운임포함\]/g, '').trim();
                    return `<span class="text-muted small">${escapeHtml(cleanNote || '-')}</span>`;
                }
            },
            {
                label: '단가 관리',
                render: it => `
                    <div class="d-flex align-items-center gap-1">
                        <button type="button" class="btn-table-action" onclick="app.openEditModal(${it.id})" title="단가 수정">
                            <i class='bx bx-edit text-primary'></i> 수정
                        </button>
                        <button type="button" class="btn-table-action btn-del" onclick="app.deletePrice(${it.id})" title="단가 삭제">
                            <i class='bx bx-trash text-danger'></i> 삭제
                        </button>
                    </div>
                `
            }
        ];

        let tbodyHtml = '<tbody>';
        rowsDef.forEach(r => {
            tbodyHtml += `<tr><td class="matrix-label-col">${r.label}</td>`;
            items.forEach(it => {
                tbodyHtml += `<td class="matrix-item-col">${r.render(it)}</td>`;
            });
            tbodyHtml += `</tr>`;
        });
        tbodyHtml += '</tbody>';

        return `<table class="erp-matrix-table">${theadHtml}${tbodyHtml}</table>`;
    },

    toggleSelectAllSpecs: function(checked) {
        const groups = this.getGroupedSpecs();
        if (checked) {
            groups.forEach(g => this.checkedSpecs.add(g.groupKey));
        } else {
            this.checkedSpecs.clear();
        }

        document.querySelectorAll('.spec-checkbox').forEach(cb => {
            cb.checked = checked;
            const card = cb.closest('.spec-matrix-card');
            if (card) card.classList.toggle('selected', checked);
        });

        this.updateCheckedBadge();
    },

    onSpecCheck: function(groupKey, checked) {
        if (checked) {
            this.checkedSpecs.add(groupKey);
        } else {
            this.checkedSpecs.delete(groupKey);
        }

        const cards = document.querySelectorAll('.spec-matrix-card');
        cards.forEach(card => {
            if (card.getAttribute('data-group-key') === groupKey) {
                card.classList.toggle('selected', checked);
            }
        });

        this.updateCheckedBadge();
    },

    updateCheckedBadge: function() {
        const badge = $('selectedSpecsBadge');
        if (badge) {
            badge.innerText = `${this.checkedSpecs.size}개 품목/규격 선택됨`;
        }

        const masterCb = $('selectAllSpecs');
        if (masterCb) {
            const groups = this.getGroupedSpecs();
            masterCb.checked = groups.length > 0 && this.checkedSpecs.size >= groups.length;
        }
    },

    toggleCardCollapse: function(bodyId, btn) {
        const el = $(bodyId);
        if (!el) return;
        const isCollapsed = el.classList.toggle('d-none');
        if (btn) {
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = isCollapsed ? 'bx bx-chevron-down' : 'bx bx-chevron-up';
            }
        }
    },

    expandAllSpecs: function(expand) {
        document.querySelectorAll('.spec-card-body').forEach(b => {
            b.classList.toggle('d-none', !expand);
        });
        document.querySelectorAll('.spec-card-header .bx-chevron-up, .spec-card-header .bx-chevron-down').forEach(icon => {
            icon.className = expand ? 'bx bx-chevron-up' : 'bx bx-chevron-down';
        });
    },

    openSpecCompare: function(groupKey) {
        if (!groupKey) return;
        this.activeModalSpec = groupKey;

        const allGroups = this.getGroupedSpecs();
        const targetGroup = allGroups.find(g => g.groupKey === groupKey);

        if (!targetGroup || targetGroup.items.length === 0) {
            alert('해당 품목/규격의 견적 데이터를 찾을 수 없습니다.');
            return;
        }

        const items = targetGroup.items;
        $('modalSpecBadge').innerText = `${targetGroup.item} [${targetGroup.spec}]`;

        const minBuy = targetGroup.minBuy;
        const maxSell = targetGroup.maxSell;
        const avgMargin = targetGroup.avgMargin;
        const bestSupplier = targetGroup.bestBuySupplier;

        $('modalSpecSummary').innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-wrap">
                <span class="badge bg-dark">${items.length}개 공급처 견적 후보</span>
                <span class="category-pill">${escapeHtml(targetGroup.category || '-')}</span>
                <span class="badge bg-light text-dark border">단위: ${escapeHtml(targetGroup.unit || '-')}</span>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap mt-1">
                <span class="badge-best-price">최저 매입: ₩${minBuy.toLocaleString()} (${escapeHtml(bestSupplier || '-')})</span>
                <span class="badge-best-margin">최고 매출: ₩${maxSell.toLocaleString()}</span>
                <span class="badge bg-light text-dark border">평균 마진율: ${avgMargin}%</span>
            </div>
        `;

        $('modalMatrixTable').innerHTML = this.generateMatrixTableHtml(items, targetGroup);

        if (!this.specCompareModalInstance && window.bootstrap && $('specCompareModal')) {
            this.specCompareModalInstance = new bootstrap.Modal($('specCompareModal'));
        }
        if (this.specCompareModalInstance) {
            this.specCompareModalInstance.show();
        }
    },

    openCreateModalWithSpec: function(spec) {
        this.openCreateModal();
        if ($('inpSpec') && spec && spec !== '(규격미지정)') {
            $('inpSpec').value = spec;
        }
    },

    printSelectedSpecs: function() {
        let keysToPrint = Array.from(this.checkedSpecs);
        const allGroups = this.getGroupedSpecs();

        if (keysToPrint.length === 0) {
            if (!confirm(`선택된 품목/규격이 없습니다.\n현재 화면에 표시된 모든 품목/규격(총 ${allGroups.length}개)을 인쇄하시겠습니까?`)) {
                return;
            }
            keysToPrint = allGroups.map(g => g.groupKey);
        }

        const printArea = $('printArea');
        if (!printArea) return;

        const today = new Date().toISOString().split('T')[0];
        let html = `
            <div style="padding: 10px 15px; margin-bottom: 15px; border-bottom: 2px solid #0f172a; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h2 style="margin: 0; font-size: 18pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px;">K&G 물류 단가표 — 품목/규격별 다자 비교 매트릭스 보고서</h2>
                    <div style="font-size: 9pt; color: #475569; margin-top: 4px;">출력 품목/규격 수: ${keysToPrint.length}개 | 인쇄일자: ${today}</div>
                </div>
                <div style="text-align: right; font-size: 9pt; color: #64748b;">
                    <strong>주식회사 케이앤지</strong>
                </div>
            </div>
        `;

        keysToPrint.forEach(k => {
            const group = allGroups.find(g => g.groupKey === k);
            if (!group || group.items.length === 0) return;

            const items = group.items;
            const minBuy = group.minBuy;

            html += `
                <div class="print-spec-block">
                    <div class="print-spec-header">
                        <div>
                            <strong style="font-size: 12pt; color: #0f172a;">${escapeHtml(group.item)}</strong>
                            <span style="font-size: 10.5pt; color: #2563eb; font-weight: 700; margin-left: 6px;">[${escapeHtml(group.spec)}]</span>
                            <span style="font-size: 9pt; color: #475569; margin-left: 8px;">(분류: ${escapeHtml(group.category || '-')})</span>
                            <span style="font-size: 9pt; color: #0f172a; margin-left: 8px;">후보: ${items.length}개 공급처</span>
                        </div>
                        <div style="font-size: 9.5pt; font-weight: 700; color: #16a34a;">
                            ${minBuy > 0 ? `최저 매입: ₩${minBuy.toLocaleString()} (${escapeHtml(group.bestBuySupplier || '-')})` : ''}
                        </div>
                    </div>
                    <div>
                        ${this.generateMatrixTableHtml(items, group)}
                    </div>
                </div>
            `;
        });

        printArea.innerHTML = html;
        window.print();
    },

    printSingleSpec: function(groupKey) {
        if (!groupKey) groupKey = this.activeModalSpec;
        if (!groupKey) return;

        const allGroups = this.getGroupedSpecs();
        const group = allGroups.find(g => g.groupKey === groupKey);
        if (!group || group.items.length === 0) return;

        const printArea = $('printArea');
        if (!printArea) return;

        const today = new Date().toISOString().split('T')[0];
        const items = group.items;
        const minBuy = group.minBuy;

        printArea.innerHTML = `
            <div style="padding: 10px 15px; margin-bottom: 15px; border-bottom: 2px solid #0f172a; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h2 style="margin: 0; font-size: 18pt; font-weight: 800; color: #0f172a;">K&G 품목/규격별 견적 비교표 [${escapeHtml(group.item)} - ${escapeHtml(group.spec)}]</h2>
                    <div style="font-size: 9pt; color: #475569; margin-top: 4px;">분류: ${escapeHtml(group.category || '-')} | 후보: ${items.length}개 공급처 | 인쇄일자: ${today}</div>
                </div>
                <div style="text-align: right; font-size: 9pt; color: #64748b;">
                    <strong>주식회사 케이앤지</strong>
                </div>
            </div>
            <div class="print-spec-block">
                <div class="print-spec-header">
                    <div>
                        <strong style="font-size: 12pt; color: #0f172a;">${escapeHtml(group.item)} [${escapeHtml(group.spec)}]</strong>
                    </div>
                    <div style="font-size: 9.5pt; font-weight: 700; color: #16a34a;">
                        ${minBuy > 0 ? `최저 매입단가: ₩${minBuy.toLocaleString()} (${escapeHtml(group.bestBuySupplier || '-')})` : ''}
                    </div>
                </div>
                <div>
                    ${this.generateMatrixTableHtml(items, group)}
                </div>
            </div>
        `;

        window.print();
    },

    exportSelectedSpecsExcel: function() {
        let keysToExport = Array.from(this.checkedSpecs);
        const allGroups = this.getGroupedSpecs();

        if (keysToExport.length === 0) {
            keysToExport = allGroups.map(g => g.groupKey);
        }

        if (keysToExport.length === 0) {
            alert('내보낼 품목/규격 데이터가 없습니다.');
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리를 불러오지 못했습니다.');
            return;
        }

        const wb = XLSX.utils.book_new();

        const allRows = [
            ['K&G 물류 단가표 — 품목/규격별 다자 비교 매트릭스'],
            [`내보내기 일자: ${new Date().toISOString().split('T')[0]}`, `대상 품목/규격 수: ${keysToExport.length}개`],
            []
        ];

        keysToExport.forEach(k => {
            const group = allGroups.find(g => g.groupKey === k);
            if (!group || group.items.length === 0) return;

            const items = group.items;
            const minBuy = group.minBuy;

            allRows.push([`[품목: ${group.item}] [규격: ${group.spec}] (분류: ${group.category || '-'}, 후보수: ${items.length}개, 최저매입: ${minBuy.toLocaleString()}원)`]);
            
            const headerRow = ['평가 항목', ...items.map((it, idx) => `후보 ${idx + 1}: ${it.default_supplier || it.item}${it.buy_price === minBuy && items.length > 1 ? ' (최저가★)' : ''}`)];
            allRows.push(headerRow);

            allRows.push(['공급업체(주 매입처)', ...items.map(it => it.default_supplier || '')]);
            allRows.push(['품목명', ...items.map(it => it.item || '')]);
            allRows.push(['규격', ...items.map(it => it.spec || '')]);
            allRows.push(['자재분류', ...items.map(it => it.category || '')]);
            allRows.push(['단위', ...items.map(it => it.unit || '')]);
            allRows.push(['기준 매입단가', ...items.map(it => it.buy_price || 0)]);
            allRows.push(['운임 조건', ...items.map(it => {
                const isF = it.is_freight_included === 1 || it.is_freight_included === true || (it.note && it.note.includes('[운임포함]'));
                return isF ? '운임포함 (도착도)' : '운임별도 (상차도)';
            })]);
            allRows.push(['기준 매출단가', ...items.map(it => it.sell_price || 0)]);
            allRows.push(['주 매출처', ...items.map(it => it.default_destination || '')]);
            allRows.push(['마진액', ...items.map(it => (it.sell_price && it.buy_price) ? (it.sell_price - it.buy_price) : 0)]);
            allRows.push(['마진율(%)', ...items.map(it => (it.sell_price && it.buy_price) ? (Math.round(((it.sell_price - it.buy_price) / it.sell_price) * 1000) / 10) : 0)]);
            allRows.push(['비고', ...items.map(it => (it.note || '').replace(/\[운임포함\]/g, '').trim())]);
            allRows.push([]);
        });

        const ws = XLSX.utils.aoa_to_sheet(allRows);
        XLSX.utils.book_append_sheet(wb, ws, '품목규격비교매트릭스');

        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        XLSX.writeFile(wb, `KNG_품목규격별비교매트릭스_${today}.xlsx`);
    },

    exportSingleSpecExcel: function(groupKey) {
        if (!groupKey) groupKey = this.activeModalSpec;
        if (!groupKey) return;

        const allGroups = this.getGroupedSpecs();
        const group = allGroups.find(g => g.groupKey === groupKey);
        if (!group || group.items.length === 0) return;

        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리를 불러오지 못했습니다.');
            return;
        }

        const wb = XLSX.utils.book_new();
        const items = group.items;
        const minBuy = group.minBuy;

        const rows = [
            [`K&G 품목/규격별 다자 비교 견적서 [${group.item} - ${group.spec}]`],
            [`분류: ${group.category || '-'}`, `후보수: ${items.length}개`, `최저매입가: ${minBuy.toLocaleString()}원`],
            [],
            ['평가 항목', ...items.map((it, idx) => `후보 ${idx + 1}: ${it.default_supplier || it.item}${it.buy_price === minBuy && items.length > 1 ? ' (최저가★)' : ''}`)],
            ['공급업체(주 매입처)', ...items.map(it => it.default_supplier || '')],
            ['품목명', ...items.map(it => it.item || '')],
            ['규격', ...items.map(it => it.spec || '')],
            ['자재분류', ...items.map(it => it.category || '')],
            ['단위', ...items.map(it => it.unit || '')],
            ['기준 매입단가', ...items.map(it => it.buy_price || 0)],
            ['운임 조건', ...items.map(it => {
                const isF = it.is_freight_included === 1 || it.is_freight_included === true || (it.note && it.note.includes('[운임포함]'));
                return isF ? '운임포함 (도착도)' : '운임별도 (상차도)';
            })],
            ['기준 매출단가', ...items.map(it => it.sell_price || 0)],
            ['주 매출처', ...items.map(it => it.default_destination || '')],
            ['마진액', ...items.map(it => (it.sell_price && it.buy_price) ? (it.sell_price - it.buy_price) : 0)],
            ['마진율(%)', ...items.map(it => (it.sell_price && it.buy_price) ? (Math.round(((it.sell_price - it.buy_price) / it.sell_price) * 1000) / 10) : 0)],
            ['비고', ...items.map(it => (it.note || '').replace(/\[운임포함\]/g, '').trim())]
        ];

        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, '품목규격비교');

        const safeName = `${group.item}_${group.spec}`.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        XLSX.writeFile(wb, `KNG_품목규격비교_${safeName}_${today}.xlsx`);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
