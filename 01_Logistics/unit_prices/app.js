/**
 * 물류 단가표 모듈 프론트엔드 (01_Logistics/unit_prices/app.js)
 * ECOUNT ERP 디자인 시스템 완벽 동기화
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : '/api/logistics';

const $ = id => document.getElementById(id);

async function authFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        let errMsg = `HTTP error ${res.status}`;
        try {
            const err = await res.json();
            errMsg = err.error || err.message || errMsg;
        } catch (e) {}
        throw new Error(errMsg);
    }
    return res.json();
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

    init: async function() {
        this.bindEvents();
        await this.loadItemSpecs();
        await this.loadPrices();
        this.setupAutocomplete();
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('priceTable');
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
        try {
            const data = await authFetch(`${API_BASE}/unit-prices`);
            this.priceList = data || [];
            this.renderCategoryTabs();
            this.applyFiltersAndRender();
        } catch (err) {
            console.error('loadPrices error:', err);
            $('priceTableBody').innerHTML = `
                <tr>
                    <td colspan="13" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle me-1'></i> 단가 데이터를 불러오지 못했습니다: ${err.message}
                    </td>
                </tr>
            `;
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

            html += `
                <tr id="price_row_${r.id}">
                    <td class="row-index">${idx + 1}</td>
                    <td class="text-center"><span class="category-pill">${r.category || '-'}</span></td>
                    <td class="text-start ps-2 fw-semibold text-truncate" title="${r.item}">${r.item}</td>
                    <td class="text-start ps-2 text-truncate text-muted" title="${r.spec || ''}">${r.spec || '-'}</td>
                    <td class="text-center text-muted">${r.unit || '-'}</td>
                    <td class="td-buy pe-2">${buy ? buy.toLocaleString() + '원' : '-'}</td>
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
            window.ErpGridResizer.sync('priceTable');
        }
    },

    // ─────────────────────────────────────────
    // 단가 등록 / 수정 모달
    // ─────────────────────────────────────────
    openCreateModal: function() {
        $('priceForm').reset();
        $('editId').value = '';
        $('priceModalLabel').innerHTML = `<i class='bx bx-plus me-1'></i> 신규 물류 기준단가 등록 (사전 견적가)`;
        $('inpCurrency').value = 'KRW';
        this.calcModalMargin();
        const modal = new bootstrap.Modal($('priceModal'));
        modal.show();
    },

    openEditModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('priceForm').reset();
        $('editId').value = item.id;
        $('priceModalLabel').innerHTML = `<i class='bx bx-edit-alt me-1'></i> 기준단가 수정: <span class="text-warning">${item.item}</span>`;
        $('inpItem').value = item.item || '';
        $('inpSpec').value = item.spec || '';
        $('inpCategory').value = item.category || '';
        $('inpUnit').value = item.unit || '';
        $('inpCurrency').value = item.currency || 'KRW';
        $('inpBuyPrice').value = item.buy_price || '';
        $('inpSellPrice').value = item.sell_price || '';
        $('inpSupplier').value = item.default_supplier || '';
        $('inpDestination').value = item.default_destination || '';
        $('inpNote').value = item.note || '';

        this.calcModalMargin();
        const modal = new bootstrap.Modal($('priceModal'));
        modal.show();
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
            note: $('inpNote').value.trim()
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

        if (!confirm(`[${item.item} (${item.spec || '규격없음'})] 단가 마스터를 삭제하시겠습니까?\n이 품목의 가격 변동 이력도 함께 삭제됩니다.`)) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/unit-prices/${id}`, { method: 'DELETE' });
            alert('삭제되었습니다.');
            await this.loadPrices();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
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
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
