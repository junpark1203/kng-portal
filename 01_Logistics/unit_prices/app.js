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

// 3자리 콤마 자동 포맷팅 헬퍼
function formatNumberWithComma(val) {
    if (val === null || val === undefined || val === '') return '';
    const str = String(val).replace(/,/g, '').trim();
    if (!str) return '';
    const parts = str.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.length > 1 ? `${parts[0]}.${parts.slice(1).join('')}` : parts[0];
}

// 콤마 제거 후 숫자 파싱 헬퍼
function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    const clean = String(val).replace(/,/g, '').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
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
    viewMode: 'item', // 'item' | 'quote'
    checkedItemIds: new Set(),
    archiveProjects: [],
    archiveSearchQuery: '',
    quoteSections: [],
    addToQuoteModalInstance: null,
    newSectionModalInstance: null,
    editSectionNameModalInstance: null,
    saveToArchiveModalInstance: null,
    quoteArchiveModalInstance: null,
    editRateModalInstance: null,
    currentPage: 1,
    pageSize: 50,
    sortColumn: '',
    sortOrder: 'asc', // 'asc' | 'desc'
    focusedRowIndex: -1,
    defaultRates: { USD: 1350, EUR: 1480, CNY: 190, JPY: 9.0 },
    currencySymbols: { KRW: '₩', USD: '$', EUR: '€', CNY: '¥', JPY: '¥' },
    modalRows: [],

    init: async function() {
        this.bindEvents();
        await this.loadItemSpecs();
        await this.loadPrices();
        await this.loadArchiveList();
        await this.loadQuoteSections();
        this.setupAutocomplete();
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('priceTable');
        }
        if ($('addToQuoteModal') && window.bootstrap) {
            this.addToQuoteModalInstance = new bootstrap.Modal($('addToQuoteModal'));
        }
        if ($('newSectionModal') && window.bootstrap) {
            this.newSectionModalInstance = new bootstrap.Modal($('newSectionModal'));
        }
        if ($('editSectionNameModal') && window.bootstrap) {
            this.editSectionNameModalInstance = new bootstrap.Modal($('editSectionNameModal'));
        }
        if ($('saveToArchiveModal') && window.bootstrap) {
            this.saveToArchiveModalInstance = new bootstrap.Modal($('saveToArchiveModal'));
        }
        if ($('quoteArchiveModal') && window.bootstrap) {
            this.quoteArchiveModalInstance = new bootstrap.Modal($('quoteArchiveModal'));
        }
        if ($('editRateModal') && window.bootstrap) {
            this.editRateModalInstance = new bootstrap.Modal($('editRateModal'));
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

        // 그리드 키보드 방향키(↑/↓) 이동 및 스페이스바(Space) 체크 지원
        window.addEventListener('keydown', (e) => {
            // 모달 열림 상태 체크
            const openModal = document.querySelector('.modal.show');
            if (openModal) return;

            // 텍스트 인풋/텍스트에어리어/셀렉트 입력 중 가로채기 방지
            const activeEl = document.activeElement;
            const activeTag = activeEl ? activeEl.tagName.toLowerCase() : '';
            const isTyping = activeEl && (
                activeTag === 'textarea' ||
                activeTag === 'select' ||
                activeTag === 'button' ||
                (activeTag === 'input' && activeEl.type !== 'checkbox') ||
                activeEl.isContentEditable
            );
            if (isTyping) return;

            // 품목별 목록 그리드 뷰(item)에서만 동작
            if (this.viewMode !== 'item') return;

            const rows = $('priceTableBody') ? Array.from($('priceTableBody').querySelectorAll('tr[id^="price_row_"]')) : [];
            if (!rows || rows.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                let nextIdx = (this.focusedRowIndex < 0) ? 0 : (this.focusedRowIndex + 1);
                if (nextIdx >= rows.length) nextIdx = rows.length - 1;
                this.focusRow(nextIdx, true);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                let prevIdx = (this.focusedRowIndex < 0) ? 0 : (this.focusedRowIndex - 1);
                if (prevIdx < 0) prevIdx = 0;
                this.focusRow(prevIdx, true);
            } else if (e.key === ' ' || e.code === 'Space') {
                e.preventDefault();
                if (this.focusedRowIndex < 0) {
                    this.focusRow(0, true);
                }
                this.toggleCurrentRowCheck();
            } else if (e.key === 'Home') {
                e.preventDefault();
                this.focusRow(0, true);
            } else if (e.key === 'End') {
                e.preventDefault();
                this.focusRow(rows.length - 1, true);
            } else if (e.key === 'PageDown') {
                e.preventDefault();
                let nextIdx = (this.focusedRowIndex < 0) ? 0 : Math.min(rows.length - 1, this.focusedRowIndex + 10);
                this.focusRow(nextIdx, true);
            } else if (e.key === 'PageUp') {
                e.preventDefault();
                let prevIdx = (this.focusedRowIndex < 0) ? 0 : Math.max(0, this.focusedRowIndex - 10);
                this.focusRow(prevIdx, true);
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
            this.priceList = Array.isArray(data) ? data : (data && data.data ? data.data : []);
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
        this.focusedRowIndex = -1;
        this.selectedCategory = '';
        this.searchQuery = '';
        this.subSearchQuery = '';
        this.searchTarget = '';
        this.marginFilter = 'all';
        this.sortColumn = '';
        this.sortOrder = 'asc';
        this.updateSortIcons();
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
                } else if (this.searchTarget === 'category') {
                    targetText = item.category || '';
                } else {
                    targetText = `${item.item || ''} ${item.spec || ''} ${item.category || ''} ${item.default_supplier || ''} ${item.note || ''}`;
                }
                const lowerTarget = targetText.toLowerCase();
                return tokens.every(token => lowerTarget.includes(token));
            });
        }

        // 3. 결과 내 재검색
        if (this.subSearchQuery) {
            const subTokens = this.subSearchQuery.split(/\s+/).filter(Boolean);
            list = list.filter(item => {
                const combined = `${item.item || ''} ${item.spec || ''} ${item.category || ''} ${item.default_supplier || ''} ${item.note || ''}`.toLowerCase();
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
        if (this.sortColumn) {
            this.applySort();
        }
        this.currentPage = 1;
        this.focusedRowIndex = -1;
        this.renderTable();
        this.updateSortIcons();
        this.renderStats();
        if (this.viewMode === 'quote') {
            this.renderQuoteComparisonView();
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

        const totalCount = this.filteredList.length;
        if (totalCount === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="14" class="text-center py-5 text-muted">
                        <i class='bx bx-info-circle me-1'></i> 조건에 일치하는 단가 데이터가 없습니다.
                    </td>
                </tr>
            `;
            if (tfoot) tfoot.classList.add('d-none');
            this.renderPagination(0);
            return;
        }

        let sumBuy = 0;
        let sumSell = 0;
        let sumMargin = 0;
        let validRateCount = 0;
        let sumRate = 0;

        this.filteredList.forEach(r => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
            if (sell > 0 && buy > 0) {
                const marginRate = Math.round(((sell - buy) / sell) * 1000) / 10;
                sumRate += marginRate;
                validRateCount++;
            }
            sumBuy += buy;
            sumSell += sell;
            sumMargin += marginAmt;
        });

        // ── 페이징 계산 및 슬라이스 ──
        let pagedList = this.filteredList;
        let startIndex = 0;
        if (this.pageSize !== 'all') {
            const size = parseInt(this.pageSize, 10) || 50;
            const totalPages = Math.ceil(totalCount / size) || 1;
            if (this.currentPage > totalPages) this.currentPage = totalPages;
            if (this.currentPage < 1) this.currentPage = 1;
            startIndex = (this.currentPage - 1) * size;
            pagedList = this.filteredList.slice(startIndex, startIndex + size);
        }

        let html = '';
        pagedList.forEach((r, idx) => {
            const globalIdx = startIndex + idx;
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
            }

            let histCount = 0;
            try { histCount = JSON.parse(r.history || '[]').length; } catch(e){}

            // 단가 구분 뱃지 결정
            const pt = r.price_type || '견적가';
            let ptBadgeClass = 'badge-pt-quote';
            if (pt === '계약가') ptBadgeClass = 'badge-pt-contract';
            else if (pt === '일시가') ptBadgeClass = 'badge-pt-spot';
            else if (pt === '표준가') ptBadgeClass = 'badge-pt-std';

            // 통화 및 환율 표기
            const isForeign = r.currency && r.currency !== 'KRW';
            const currSymbol = this.currencySymbols[r.currency] || '$';
            let buyDisplay = buy ? buy.toLocaleString() + '원' : '-';
            let sellDisplay = sell ? sell.toLocaleString() + '원' : '-';

            if (isForeign && r.foreign_buy_price > 0) {
                buyDisplay = `
                    <div class="currency-dual-wrap" title="적용 환율: 1 ${r.currency} = ${r.exchange_rate ? r.exchange_rate.toLocaleString() : '-'}원">
                        <span class="currency-foreign">${currSymbol}${parseFloat(r.foreign_buy_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        <span class="currency-krw">(₩${buy ? buy.toLocaleString() : '0'}) <span class="badge bg-light text-secondary border" style="font-size: 8.5px; padding: 0 2px;">@${r.exchange_rate ? r.exchange_rate.toLocaleString() : '-'}</span></span>
                    </div>
                `;
            }
            if (isForeign && r.foreign_sell_price > 0) {
                sellDisplay = `
                    <div class="currency-dual-wrap">
                        <span class="currency-foreign text-primary">${currSymbol}${parseFloat(r.foreign_sell_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        <span class="currency-krw">(₩${sell ? sell.toLocaleString() : '0'})</span>
                    </div>
                `;
            }

            // 운임 조건 뱃지
            const isFreightIn = (r.freight_type === '하차도') || (r.is_freight_included === 1 || r.is_freight_included === true || (r.note && r.note.includes('[운임포함]')));
            const freightBadge = isFreightIn
                ? `<span class="badge-freight-in ms-1" style="font-size: 9.5px; padding: 0 3px;" title="하차도 (운임포함 납품)"><i class='bx bx-check-circle'></i> 하차도${r.freight_region ? ` [${escapeHtml(r.freight_region)}]` : ''}</span>`
                : `<span class="badge-freight-ex ms-1" style="font-size: 9.5px; padding: 0 3px;" title="상차도 (운임별도 / 출하지인도)">상차도</span>`;

            const isChecked = this.checkedItemIds.has(r.id);
            const isFocused = this.focusedRowIndex === idx;
            html += `
                <tr id="price_row_${r.id}" 
                    class="${isChecked ? 'selected-row' : ''} ${isFocused ? 'focused-row' : ''}"
                    data-row-index="${idx}"
                    data-item-id="${r.id}"
                    onclick="app.onRowClick(event, ${idx}, ${r.id})">
                    <td class="row-index text-center">
                        <div class="d-flex align-items-center justify-content-center gap-1">
                            <input type="checkbox" class="form-check-input mt-0 item-checkbox cursor-pointer" 
                                   data-id="${r.id}" ${isChecked ? 'checked' : ''} 
                                   onclick="event.stopPropagation(); app.focusRow(${idx}, false);"
                                   onchange="app.onItemCheck(${r.id}, this.checked)">
                            <span class="row-num">${globalIdx + 1}</span>
                        </div>
                    </td>
                    <td class="text-center"><span class="${ptBadgeClass}">${escapeHtml(pt)}</span></td>
                    <td class="text-center"><span class="category-pill">${escapeHtml(r.category || '-')}</span></td>
                    <td class="text-start ps-2 text-truncate fw-semibold text-dark" title="${escapeHtml(r.default_supplier || '')}">${escapeHtml(r.default_supplier || '-')}</td>
                    <td class="text-start ps-2 fw-semibold text-truncate" title="${escapeHtml(r.item)}">${escapeHtml(r.item)}</td>
                    <td class="text-start ps-2 text-truncate" title="${escapeHtml(r.spec || '')}">
                        ${(r.spec && r.spec.trim()) ? `<span class="spec-pill">${escapeHtml(r.spec.trim())}</span>` : '<span class="text-muted">-</span>'}
                    </td>
                    <td class="text-center text-muted">${escapeHtml(r.unit || '-')}</td>
                    <td class="text-center">${freightBadge}</td>
                    <td class="td-buy pe-2">${buyDisplay}</td>
                    <td class="td-sell pe-2">${sellDisplay}</td>
                    <td class="td-margin-amt pe-2 ${marginAmt < 0 ? 'text-danger' : ''}">${marginAmt ? marginAmt.toLocaleString() + '원' : '-'}</td>
                    <td class="text-center"><span class="margin-badge ${badgeClass}">${marginRateStr}</span></td>
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

        // 하단 합계 요약 바 (전체 필터된 데이터 기준)
        if (tfoot) {
            tfoot.classList.remove('d-none');
            const cnt = this.filteredList.length;
            $('footSummaryItems').innerText = `총 ${cnt.toLocaleString()}개 품목`;
            $('footAvgBuy').innerText = `${Math.round(sumBuy / cnt).toLocaleString()}원 (평균)`;
            $('footAvgSell').innerText = `${Math.round(sumSell / cnt).toLocaleString()}원 (평균)`;
            $('footAvgMarginAmt').innerText = `${Math.round(sumMargin / cnt).toLocaleString()}원 (평균)`;
            const avgR = validRateCount > 0 ? (Math.round((sumRate / validRateCount) * 10) / 10) : 0;
            $('footAvgMarginRate').innerText = `${avgR}%`;
        }

        // ── 페이징 컨트롤 바 렌더링 ──
        this.renderPagination(totalCount);

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

    renderPagination: function(totalCount) {
        const bar = $('itemPaginationBar');
        if (!bar) return;

        if (totalCount === 0) {
            bar.classList.add('d-none');
            return;
        }
        bar.classList.remove('d-none');

        const size = this.pageSize === 'all' ? totalCount : (parseInt(this.pageSize, 10) || 50);
        const totalPages = this.pageSize === 'all' ? 1 : Math.ceil(totalCount / size);
        const currentPage = this.currentPage;

        const start = totalCount > 0 ? ((currentPage - 1) * size + 1) : 0;
        const end = Math.min(currentPage * size, totalCount);

        const infoEl = $('pagingInfoText');
        if (infoEl) {
            if (this.pageSize === 'all') {
                infoEl.innerText = `전체 ${totalCount.toLocaleString()}건`;
            } else {
                infoEl.innerText = `전체 ${totalCount.toLocaleString()}건 중 ${start.toLocaleString()} - ${end.toLocaleString()}건 (${currentPage} / ${totalPages} 페이지)`;
            }
        }

        const nav = $('paginationNav');
        if (!nav) return;

        if (totalPages <= 1) {
            nav.innerHTML = '';
            return;
        }

        let navHtml = '';
        const prevDisabled = currentPage === 1;
        navHtml += `
            <button type="button" class="btn-erp btn-sm" ${prevDisabled ? 'disabled' : ''} onclick="app.goToPage(1)" title="첫 페이지">
                <i class='bx bx-chevrons-left'></i>
            </button>
            <button type="button" class="btn-erp btn-sm" ${prevDisabled ? 'disabled' : ''} onclick="app.goToPage(${currentPage - 1})" title="이전 페이지">
                <i class='bx bx-chevron-left'></i>
            </button>
        `;

        const maxButtons = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
        let endPage = Math.min(totalPages, startPage + maxButtons - 1);
        if (endPage - startPage + 1 < maxButtons) {
            startPage = Math.max(1, endPage - maxButtons + 1);
        }

        for (let p = startPage; p <= endPage; p++) {
            const isActive = p === currentPage;
            navHtml += `
                <button type="button" class="btn-erp btn-sm ${isActive ? 'btn-erp-primary active fw-bold' : ''}" 
                        onclick="app.goToPage(${p})">
                    ${p}
                </button>
            `;
        }

        const nextDisabled = currentPage === totalPages;
        navHtml += `
            <button type="button" class="btn-erp btn-sm" ${nextDisabled ? 'disabled' : ''} onclick="app.goToPage(${currentPage + 1})" title="다음 페이지">
                <i class='bx bx-chevron-right'></i>
            </button>
            <button type="button" class="btn-erp btn-sm" ${nextDisabled ? 'disabled' : ''} onclick="app.goToPage(${totalPages})" title="마지막 페이지">
                <i class='bx bx-chevrons-right'></i>
            </button>
        `;

        nav.innerHTML = navHtml;
    },

    goToPage: function(page) {
        this.focusedRowIndex = -1;
        this.currentPage = page;
        this.renderTable();
        const grid = $('priceGridWrapper');
        if (grid) grid.scrollTop = 0;
    },

    changePageSize: function(val) {
        this.focusedRowIndex = -1;
        this.pageSize = val === 'all' ? 'all' : parseInt(val, 10);
        this.currentPage = 1;
        this.renderTable();
    },

    // ─────────────────────────────────────────
    // 헤더 열 다중 정렬 (오름차순 / 내림차순)
    // ─────────────────────────────────────────
    sortBy: function(column) {
        this.focusedRowIndex = -1;
        if (this.sortColumn === column) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortOrder = 'asc';
        }
        this.applySort();
        this.currentPage = 1;
        this.renderTable();
        this.updateSortIcons();
    },

    applySort: function() {
        if (!this.sortColumn) return;
        const col = this.sortColumn;
        const mult = this.sortOrder === 'desc' ? -1 : 1;

        this.filteredList.sort((a, b) => {
            switch (col) {
                case 'price_type': {
                    const valA = a.price_type || '견적가';
                    const valB = b.price_type || '견적가';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'category': {
                    const valA = a.category || '';
                    const valB = b.category || '';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'item': {
                    const valA = a.item || '';
                    const valB = b.item || '';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'spec': {
                    const valA = a.spec || '';
                    const valB = b.spec || '';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'unit': {
                    const valA = a.unit || '';
                    const valB = b.unit || '';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'buy_price': {
                    const valA = Number(a.buy_price) || 0;
                    const valB = Number(b.buy_price) || 0;
                    return (valA - valB) * mult;
                }
                case 'sell_price': {
                    const valA = Number(a.sell_price) || 0;
                    const valB = Number(b.sell_price) || 0;
                    return (valA - valB) * mult;
                }
                case 'margin_amt': {
                    const buyA = Number(a.buy_price) || 0;
                    const sellA = Number(a.sell_price) || 0;
                    const mA = (sellA > 0 && buyA > 0) ? (sellA - buyA) : 0;

                    const buyB = Number(b.buy_price) || 0;
                    const sellB = Number(b.sell_price) || 0;
                    const mB = (sellB > 0 && buyB > 0) ? (sellB - buyB) : 0;

                    return (mA - mB) * mult;
                }
                case 'margin_rate': {
                    const buyA = Number(a.buy_price) || 0;
                    const sellA = Number(a.sell_price) || 0;
                    const rA = (sellA > 0 && buyA > 0) ? ((sellA - buyA) / sellA) : -999999;

                    const buyB = Number(b.buy_price) || 0;
                    const sellB = Number(b.sell_price) || 0;
                    const rB = (sellB > 0 && buyB > 0) ? ((sellB - buyB) / sellB) : -999999;

                    return (rA - rB) * mult;
                }
                case 'default_supplier': {
                    const valA = a.default_supplier || '';
                    const valB = b.default_supplier || '';
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'freight_type': {
                    const valA = a.freight_type || (a.is_freight_included ? '하차도' : '상차도');
                    const valB = b.freight_type || (b.is_freight_included ? '하차도' : '상차도');
                    return valA.localeCompare(valB, 'ko') * mult;
                }
                case 'history': {
                    let lenA = 0, lenB = 0;
                    try { lenA = JSON.parse(a.history || '[]').length; } catch(e){}
                    try { lenB = JSON.parse(b.history || '[]').length; } catch(e){}
                    return (lenA - lenB) * mult;
                }
                default:
                    return 0;
            }
        });
    },

    updateSortIcons: function() {
        const columns = [
            'price_type', 'category', 'default_supplier', 'item', 'spec', 'unit', 'freight_type', 'buy_price', 'sell_price',
            'margin_amt', 'margin_rate', 'history'
        ];

        columns.forEach(col => {
            const icon = $('sort_icon_' + col);
            const th = icon ? icon.closest('th') : null;
            if (!icon) return;

            if (this.sortColumn === col) {
                if (this.sortOrder === 'asc') {
                    icon.className = 'bx bx-sort-up sort-icon active';
                    icon.setAttribute('title', '오름차순 정렬됨 (클릭 시 내림차순)');
                } else {
                    icon.className = 'bx bx-sort-down sort-icon active';
                    icon.setAttribute('title', '내림차순 정렬됨 (클릭 시 오름차순)');
                }
                if (th) th.classList.add('sorted-th');
            } else {
                icon.className = 'bx bx-sort-alt-2 sort-icon';
                icon.removeAttribute('title');
                if (th) th.classList.remove('sorted-th');
            }
        });
    },

    // ─────────────────────────────────────────
    // 키보드 방향키 이동 & 스페이스바 체크 지원
    // ─────────────────────────────────────────
    onRowClick: function(event, idx, id) {
        // 버튼이나 링크 클릭 시 고유 기능 수행 허용 (포커스만 맞춤)
        if (event.target.closest('button, a')) {
            this.focusRow(idx, false);
            return;
        }
        // 체크박스 클릭은 체크박스 전용 핸들러에서 처리
        if (event.target.closest('.item-checkbox')) {
            return;
        }
        // 테이블 외부 버튼/인풋 포커스를 해제하여 키보드 조작 즉시 유효화
        if (document.activeElement && document.activeElement !== document.body && !document.activeElement.classList.contains('item-checkbox')) {
            document.activeElement.blur();
        }
        this.focusRow(idx, false);
    },

    focusRow: function(idx, shouldScroll = true) {
        const rows = $('priceTableBody') ? Array.from($('priceTableBody').querySelectorAll('tr[id^="price_row_"]')) : [];
        if (!rows || rows.length === 0) return;

        if (idx < 0) idx = 0;
        if (idx >= rows.length) idx = rows.length - 1;

        if (this.focusedRowIndex >= 0 && this.focusedRowIndex < rows.length) {
            rows[this.focusedRowIndex].classList.remove('focused-row');
        }

        this.focusedRowIndex = idx;
        const targetRow = rows[idx];
        if (targetRow) {
            targetRow.classList.add('focused-row');
            if (shouldScroll) {
                this.scrollRowIntoView(targetRow);
            }
        }
    },

    scrollRowIntoView: function(rowEl) {
        if (!rowEl) return;
        const grid = $('priceGridWrapper');
        if (!grid) {
            rowEl.scrollIntoView({ block: 'nearest' });
            return;
        }
        const gridRect = grid.getBoundingClientRect();
        const rowRect = rowEl.getBoundingClientRect();
        const headerHeight = 28; // Sticky thead 높이 보정

        if (rowRect.top < gridRect.top + headerHeight) {
            grid.scrollTop -= (gridRect.top + headerHeight - rowRect.top);
        } else if (rowRect.bottom > gridRect.bottom) {
            grid.scrollTop += (rowRect.bottom - gridRect.bottom);
        }
    },

    toggleCurrentRowCheck: function() {
        const rows = $('priceTableBody') ? Array.from($('priceTableBody').querySelectorAll('tr[id^="price_row_"]')) : [];
        if (this.focusedRowIndex < 0 || this.focusedRowIndex >= rows.length) return;

        const focusedRow = rows[this.focusedRowIndex];
        if (!focusedRow) return;

        const chk = focusedRow.querySelector('.item-checkbox');
        if (chk) {
            const newChecked = !chk.checked;
            chk.checked = newChecked;
            const id = parseInt(chk.getAttribute('data-id'), 10);
            this.onItemCheck(id, newChecked);
        }
    },

    // ─────────────────────────────────────────
    // 단가 등록 / 수정 모달 핸들러 (방안 2: 다건 그리드 지원)
    // ─────────────────────────────────────────
    createDefaultModalRow: function(preset = {}) {
        return {
            selected: false,
            price_type: preset.price_type || '견적가',
            item: preset.item || '',
            spec: preset.spec || '',
            unit: preset.unit || 'EA',
            buy_price: preset.buy_price !== undefined ? String(preset.buy_price) : '',
            sell_price: preset.sell_price !== undefined ? String(preset.sell_price) : '',
            freight_type: preset.freight_type || '상차도',
            freight_region: preset.freight_region || '전국',
            note: preset.note || ''
        };
    },

    updateModalItemDatalist: function() {
        const dl = $('modalItemDatalist');
        if (!dl) return;
        const mapKeys = Object.keys(this.itemsSpecsMap || {});
        const priceKeys = (this.priceList || []).map(p => p.item).filter(Boolean);
        const uniqueItems = Array.from(new Set([...mapKeys, ...priceKeys])).filter(Boolean).sort();
        dl.innerHTML = uniqueItems.map(item => `<option value="${escapeHtml(item)}"></option>`).join('');
    },

    onGridItemInput: function(idx, val) {
        if (!this.modalRows[idx]) return;
        this.modalRows[idx].item = val;
        const trimmed = (val || '').trim();
        if (trimmed) {
            const info = (this.itemsSpecsMap || {})[trimmed];
            if (info && info.defaultUnit && (!this.modalRows[idx].unit || this.modalRows[idx].unit === 'EA')) {
                this.modalRows[idx].unit = info.defaultUnit;
                const uInp = $(`gridUnit_${idx}`);
                if (uInp) uInp.value = info.defaultUnit;
            }
            if (info && info.defaultCategory && !$('inpCategory').value) {
                $('inpCategory').value = info.defaultCategory;
            }
        }
    },

    onDefaultUnitChange: function() {},

    calcRowMarginHtml: function(buyVal, sellVal) {
        const curr = $('inpCurrency') ? $('inpCurrency').value : 'KRW';
        const rate = (curr !== 'KRW') ? parseNumber($('inpExchangeRate') ? $('inpExchangeRate').value : 0) : 1;
        const rawBuy = parseNumber(buyVal);
        const rawSell = parseNumber(sellVal);

        if (rawSell <= 0 && rawBuy <= 0) {
            return `<span class="text-muted" style="font-size:11px;">-</span>`;
        }

        let buyKrw = rawBuy;
        let sellKrw = rawSell;
        if (curr !== 'KRW' && rate > 0) {
            buyKrw = Math.round(rawBuy * rate);
            sellKrw = Math.round(rawSell * rate);
        }

        if (rawSell > 0 && rawBuy > 0) {
            const diffKrw = sellKrw - buyKrw;
            const marginPct = Math.round((diffKrw / sellKrw) * 1000) / 10;
            let badgeColor = 'bg-primary';
            if (marginPct >= 20) badgeColor = 'bg-success';
            else if (marginPct < 0) badgeColor = 'bg-danger';

            const diffFmt = (diffKrw >= 0 ? '+' : '') + diffKrw.toLocaleString() + '원';
            return `
                <div class="d-flex flex-column align-items-center justify-content-center">
                    <span class="fw-bold ${diffKrw >= 0 ? 'text-primary' : 'text-danger'}" style="font-size: 11px;">${diffFmt}</span>
                    <span class="badge ${badgeColor}" style="font-size: 10px; padding: 2px 5px; margin-top: 1px;">마진 ${marginPct}%</span>
                </div>
            `;
        } else if (rawBuy > 0) {
            return `<span class="text-muted" style="font-size:11px;">매출가 미입력</span>`;
        } else {
            return `<span class="text-muted" style="font-size:11px;">매입가 미입력</span>`;
        }
    },

    renderModalGrid: function() {
        const tbody = $('modalGridBody');
        if (!tbody) return;
        const isEditMode = Boolean(this.currentEditId);
        const curr = $('inpCurrency') ? $('inpCurrency').value : 'KRW';
        const currSymbol = this.currencySymbols[curr] || '₩';
        const rate = (curr !== 'KRW') ? parseNumber($('inpExchangeRate') ? $('inpExchangeRate').value : 0) : 1;

        const rowCountEl = $('modalRowCount');
        if (rowCountEl) rowCountEl.innerText = `${this.modalRows.length}개`;
        const btnCountText = $('btnSaveCountText');
        if (btnCountText) {
            btnCountText.innerText = isEditMode ? '수정사항 저장 [F8]' : `전체 ${this.modalRows.length}건 일괄 저장 [F8]`;
        }

        const checkAll = $('checkAllModalRows');
        if (checkAll) {
            checkAll.checked = this.modalRows.length > 0 && this.modalRows.every(r => r.selected);
        }

        let html = '';
        this.modalRows.forEach((row, idx) => {
            const rowBuyNum = parseNumber(row.buy_price);
            const rowSellNum = parseNumber(row.sell_price);
            const krwBuyText = (curr !== 'KRW' && rate > 0 && rowBuyNum > 0)
                ? `<div class="text-muted text-end" style="font-size:10px;">≈ ₩${Math.round(rowBuyNum * rate).toLocaleString()}</div>` : '';
            const krwSellText = (curr !== 'KRW' && rate > 0 && rowSellNum > 0)
                ? `<div class="text-muted text-end" style="font-size:10px;">≈ ₩${Math.round(rowSellNum * rate).toLocaleString()}</div>` : '';

            html += `
                <tr class="${row.selected ? 'selected-row' : ''}" data-row-index="${idx}">
                    <td class="text-center align-middle">
                        <input type="checkbox" class="form-check-input row-chk" 
                            onchange="app.toggleModalRowCheck(${idx}, this.checked)" 
                            ${row.selected ? 'checked' : ''} 
                            ${isEditMode ? 'disabled' : ''}>
                    </td>
                    <td class="text-center align-middle fw-bold text-muted" style="font-size: 11.5px;">${idx + 1}</td>
                    <td class="align-middle">
                        <select class="form-select form-select-sm" onchange="app.updateModalRow(${idx}, 'price_type', this.value)">
                            <option value="견적가" ${row.price_type === '견적가' ? 'selected' : ''}>견적가</option>
                            <option value="계약가" ${row.price_type === '계약가' ? 'selected' : ''}>계약가</option>
                            <option value="표준가" ${row.price_type === '표준가' ? 'selected' : ''}>표준가</option>
                            <option value="일시가" ${row.price_type === '일시가' ? 'selected' : ''}>일시가</option>
                            <option value="실행가" ${row.price_type === '실행가' ? 'selected' : ''}>실행가</option>
                            <option value="기타" ${row.price_type === '기타' ? 'selected' : ''}>기타</option>
                        </select>
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm fw-bold text-dark grid-item-input" id="gridItem_${idx}" 
                            list="modalItemDatalist" 
                            value="${escapeHtml(row.item || '')}" 
                            title="${escapeHtml(row.item || '')}" 
                            placeholder="품목명 입력 (예: STS304 심리스 파이프)" 
                            oninput="app.onGridItemInput(${idx}, this.value)" 
                            autocomplete="off">
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm" id="gridSpec_${idx}" 
                            value="${escapeHtml(row.spec)}" placeholder="규격/사양 (예: 50x50x2.0T)" 
                            oninput="app.updateModalRow(${idx}, 'spec', this.value)">
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm text-center" id="gridUnit_${idx}" 
                            value="${escapeHtml(row.unit)}" placeholder="단위" style="width: 50px;" 
                            oninput="app.updateModalRow(${idx}, 'unit', this.value)">
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm text-end grid-buy-input" id="gridBuy_${idx}" 
                            value="${row.buy_price ? formatNumberWithComma(row.buy_price) : ''}" 
                            placeholder="${currSymbol}0" 
                            oninput="app.onGridPriceInput(${idx}, 'buy_price', this)">
                        <div id="gridBuyKrwPreview_${idx}">${krwBuyText}</div>
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm text-end grid-sell-input" id="gridSell_${idx}" 
                            value="${row.sell_price ? formatNumberWithComma(row.sell_price) : ''}" 
                            placeholder="${currSymbol}0" 
                            oninput="app.onGridPriceInput(${idx}, 'sell_price', this)">
                        <div id="gridSellKrwPreview_${idx}">${krwSellText}</div>
                    </td>
                    <td class="text-center align-middle" id="gridMargin_${idx}">
                        ${this.calcRowMarginHtml(row.buy_price, row.sell_price)}
                    </td>
                    <td class="align-middle">
                        <div class="d-flex align-items-center gap-1">
                            <select class="form-select form-select-sm" style="width: 84px; min-width: 84px;" 
                                onchange="app.onGridFreightTypeChange(${idx}, this.value)">
                                <option value="상차도" ${row.freight_type === '상차도' ? 'selected' : ''}>상차도</option>
                                <option value="하차도" ${row.freight_type === '하차도' ? 'selected' : ''}>하차도</option>
                            </select>
                            <input type="text" class="form-control form-control-sm ${row.freight_type === '하차도' ? '' : 'd-none'}" 
                                id="gridFreightRegion_${idx}" 
                                value="${escapeHtml(row.freight_region || '전국')}" 
                                placeholder="도착지(예:화성)" style="width: 110px;" 
                                oninput="app.updateModalRow(${idx}, 'freight_region', this.value)">
                        </div>
                    </td>
                    <td class="align-middle">
                        <input type="text" class="form-control form-control-sm" id="gridNote_${idx}" 
                            value="${escapeHtml(row.note)}" placeholder="특이사항/메모" 
                            oninput="app.updateModalRow(${idx}, 'note', this.value)">
                    </td>
                    <td class="text-center align-middle">
                        ${!isEditMode ? `
                            <button type="button" class="btn btn-outline-danger btn-grid-del" onclick="app.removeModalRow(${idx})" title="이 행 삭제">
                                <i class="bi bi-trash3"></i>
                            </button>
                        ` : `
                            <span class="text-muted" style="font-size:11px;">-</span>
                        `}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    onGridPriceInput: function(idx, field, el) {
        if (!el || !this.modalRows[idx]) return;
        const cursorPosition = el.selectionStart;
        const oldVal = el.value;
        const clean = oldVal.replace(/[^0-9.]/g, '');
        const formatted = formatNumberWithComma(clean);
        el.value = formatted;

        const cleanBefore = oldVal.slice(0, cursorPosition).replace(/,/g, '').length;
        let newPos = 0;
        let countedClean = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (formatted[i] !== ',') countedClean++;
            if (countedClean === cleanBefore) {
                newPos = i + 1;
                break;
            }
        }
        try {
            el.setSelectionRange(newPos, newPos);
        } catch (e) {}

        this.modalRows[idx][field] = clean;

        const curr = $('inpCurrency') ? $('inpCurrency').value : 'KRW';
        const rate = (curr !== 'KRW') ? parseNumber($('inpExchangeRate') ? $('inpExchangeRate').value : 0) : 1;
        const num = parseNumber(clean);

        if (field === 'buy_price') {
            const previewEl = $(`gridBuyKrwPreview_${idx}`);
            if (previewEl) {
                previewEl.innerHTML = (curr !== 'KRW' && rate > 0 && num > 0)
                    ? `<div class="text-muted text-end" style="font-size:10px;">≈ ₩${Math.round(num * rate).toLocaleString()}</div>`
                    : '';
            }
        } else if (field === 'sell_price') {
            const previewEl = $(`gridSellKrwPreview_${idx}`);
            if (previewEl) {
                previewEl.innerHTML = (curr !== 'KRW' && rate > 0 && num > 0)
                    ? `<div class="text-muted text-end" style="font-size:10px;">≈ ₩${Math.round(num * rate).toLocaleString()}</div>`
                    : '';
            }
        }

        const marginCell = $(`gridMargin_${idx}`);
        if (marginCell) {
            marginCell.innerHTML = this.calcRowMarginHtml(this.modalRows[idx].buy_price, this.modalRows[idx].sell_price);
        }
    },

    onGridFreightTypeChange: function(idx, type) {
        if (!this.modalRows[idx]) return;
        this.modalRows[idx].freight_type = type;
        const regionInp = $(`gridFreightRegion_${idx}`);
        if (regionInp) {
            if (type === '하차도') {
                regionInp.classList.remove('d-none');
                if (!this.modalRows[idx].freight_region) {
                    this.modalRows[idx].freight_region = '전국';
                    regionInp.value = '전국';
                }
            } else {
                regionInp.classList.add('d-none');
            }
        }
    },

    updateModalRow: function(idx, field, val) {
        if (!this.modalRows[idx]) return;
        this.modalRows[idx][field] = val;
    },

    toggleModalRowCheck: function(idx, checked) {
        if (!this.modalRows[idx]) return;
        this.modalRows[idx].selected = checked;
        const tr = document.querySelector(`tr[data-row-index="${idx}"]`);
        if (tr) tr.classList.toggle('selected-row', checked);
        const checkAll = $('checkAllModalRows');
        if (checkAll) {
            checkAll.checked = this.modalRows.length > 0 && this.modalRows.every(r => r.selected);
        }
    },

    toggleCheckAllModalRows: function(checked) {
        this.modalRows.forEach(r => {
            r.selected = checked;
        });
        this.renderModalGrid();
    },

    addModalRow: function(preset) {
        this.modalRows.push(this.createDefaultModalRow(preset));
        this.renderModalGrid();
        const newIdx = this.modalRows.length - 1;
        const itemInp = $(`gridItem_${newIdx}`);
        if (itemInp) itemInp.focus();
    },

    copySelectedModalRows: function() {
        const selected = this.modalRows.filter(r => r.selected);
        const toCopy = selected.length > 0 ? selected : [ this.modalRows[this.modalRows.length - 1] ];
        if (!toCopy || toCopy.length === 0 || !toCopy[0]) {
            this.addModalRow();
            return;
        }

        toCopy.forEach(item => {
            this.modalRows.push({
                selected: false,
                price_type: item.price_type,
                item: item.item, // 품목명 복사
                spec: item.spec,
                unit: item.unit,
                buy_price: item.buy_price,
                sell_price: item.sell_price,
                freight_type: item.freight_type,
                freight_region: item.freight_region,
                note: item.note
            });
        });

        this.renderModalGrid();
        const lastIdx = this.modalRows.length - 1;
        // 품목명이 있으면 규격란으로 포커스, 품목명이 비어있으면 품목명란으로 포커스
        const targetInp = this.modalRows[lastIdx].item ? $(`gridSpec_${lastIdx}`) : $(`gridItem_${lastIdx}`);
        if (targetInp) {
            targetInp.focus();
            targetInp.select();
        }
    },

    deleteSelectedModalRows: function() {
        const remaining = this.modalRows.filter(r => !r.selected);
        if (remaining.length === 0) {
            this.modalRows = [ this.createDefaultModalRow() ];
        } else {
            this.modalRows = remaining;
        }
        this.renderModalGrid();
    },

    removeModalRow: function(idx) {
        if (this.modalRows.length <= 1) {
            this.modalRows = [ this.createDefaultModalRow() ];
        } else {
            this.modalRows.splice(idx, 1);
        }
        this.renderModalGrid();
    },

    onCurrencyChange: function() {
        const curr = $('inpCurrency') ? $('inpCurrency').value : 'KRW';
        const thRate = $('thExchangeRate');
        const tdRate = $('tdExchangeRate');
        const rateBox = $('exchangeRateBox');
        const rateInp = $('inpExchangeRate');
        const rateHelp = $('exchangeRateHelp');

        if (curr === 'KRW') {
            if (thRate) thRate.classList.add('d-none');
            if (tdRate) tdRate.classList.add('d-none');
            if (rateBox) {
                rateBox.classList.remove('d-flex');
                rateBox.classList.add('d-none');
            }
        } else {
            if (thRate) thRate.classList.remove('d-none');
            if (tdRate) tdRate.classList.remove('d-none');
            if (rateBox) {
                rateBox.classList.remove('d-none');
                rateBox.classList.add('d-flex');
            }
            if (rateInp && (!rateInp.value || parseNumber(rateInp.value) <= 0)) {
                rateInp.value = formatNumberWithComma(this.defaultRates[curr] || '');
            }
            if (rateHelp) {
                if (curr === 'JPY') {
                    rateHelp.innerText = '(1 JPY당 원화, 예: 9.0)';
                } else {
                    rateHelp.innerText = `(1 ${curr}당 원화)`;
                }
            }
        }
        this.renderModalGrid();
    },

    onExchangeRateInput: function(el) {
        if (!el) return;
        const cursorPosition = el.selectionStart;
        const oldVal = el.value;
        const clean = oldVal.replace(/[^0-9.]/g, '');
        const formatted = formatNumberWithComma(clean);
        el.value = formatted;

        const cleanBefore = oldVal.slice(0, cursorPosition).replace(/,/g, '').length;
        let newPos = 0;
        let countedClean = 0;
        for (let i = 0; i < formatted.length; i++) {
            if (formatted[i] !== ',') countedClean++;
            if (countedClean === cleanBefore) {
                newPos = i + 1;
                break;
            }
        }
        try {
            el.setSelectionRange(newPos, newPos);
        } catch (e) {}

        this.renderModalGrid();
    },

    onEditRateInput: function(el) {
        if (!el) return;
        const oldVal = el.value;
        const clean = oldVal.replace(/[^0-9.]/g, '');
        el.value = formatNumberWithComma(clean);
        this.calcEditRatePreview();
    },

    openCreateModal: function() {
        $('priceForm').reset();
        $('editId').value = '';
        this.currentEditId = null;
        if ($('btnModalDelete')) $('btnModalDelete').classList.add('d-none');
        if ($('editQuoteInUseAlert')) $('editQuoteInUseAlert').classList.add('d-none');

        const toolbar = $('modalGridToolbar');
        if (toolbar) {
            toolbar.classList.remove('d-none');
            toolbar.classList.add('d-flex');
        }

        if ($('inpCurrency')) $('inpCurrency').value = 'KRW';
        if ($('inpExchangeRate')) $('inpExchangeRate').value = '';
        this.onCurrencyChange();

        $('priceModalLabel').innerHTML = `기준단가 다건 일괄 등록`;
        this.modalRows = [ this.createDefaultModalRow() ];
        this.updateModalItemDatalist();
        this.renderModalGrid();

        const modal = new bootstrap.Modal($('priceModal'));
        modal.show();

        setTimeout(() => {
            const firstItemInp = $('gridItem_0');
            if (firstItemInp) firstItemInp.focus();
        }, 200);
    },

    openCreateModalWithItemSpec: function(item, spec) {
        this.openCreateModal();
        if (item) this.modalRows[0].item = item;
        if (spec && spec !== '(규격미지정)') {
            this.modalRows[0].spec = spec;
        }
        this.renderModalGrid();
    },

    openEditModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('priceForm').reset();
        $('editId').value = item.id;
        this.currentEditId = id;
        if ($('btnModalDelete')) $('btnModalDelete').classList.remove('d-none');

        // 견적 비교 테이블 포함 여부 사전 확인 및 배너 표시
        const relatedSections = [];
        (this.quoteSections || []).forEach(sec => {
            const hasItem = (sec.items || []).some(it => 
                (it.unit_price_id && String(it.unit_price_id) === String(id)) ||
                (it.item === item.item && (it.spec || '') === (item.spec || '') && (it.default_supplier || '') === (item.default_supplier || ''))
            );
            if (hasItem) {
                relatedSections.push(sec.section_name || `섹션 #${sec.id}`);
            }
        });

        const alertEl = $('editQuoteInUseAlert');
        const alertDesc = $('editQuoteInUseDesc');
        if (alertEl && alertDesc) {
            if (relatedSections.length > 0) {
                alertEl.classList.remove('d-none');
                const secListStr = relatedSections.map(s => `[${s}]`).join(', ');
                alertDesc.innerHTML = `현재 자재 선정 & 견적 비교 <strong>작업대(Workspace)</strong>의 <strong>${secListStr}</strong> (${relatedSections.length}개 섹션)에 포함되어 있습니다.<br>• 단가표 수정 시 <strong>작업대 섹션의 해당 품목도 실시간 자동 동기화</strong>됩니다.<br>• 단, <span class="text-success fw-bold">보관함에 저장 완료된 과거 검토서들은 원래 단가 그대로 안전하게 보존</span>됩니다.`;
            } else {
                alertEl.classList.add('d-none');
            }
        }

        const toolbar = $('modalGridToolbar');
        if (toolbar) {
            toolbar.classList.add('d-none');
            toolbar.classList.remove('d-flex');
        }

        $('priceModalLabel').innerHTML = `기준단가 수정: <span class="text-primary fw-bold">${escapeHtml(item.item)}</span>`;
        $('inpCategory').value = item.category || '';
        if ($('inpDefaultUnit')) $('inpDefaultUnit').value = item.unit || '';
        $('inpSupplier').value = item.default_supplier || '';
        $('inpDestination').value = item.default_destination || '';

        const curr = item.currency || 'KRW';
        if ($('inpCurrency')) $('inpCurrency').value = curr;
        if (curr !== 'KRW') {
            const defaultRate = this.defaultRates[curr] || '';
            const rateVal = item.exchange_rate || defaultRate;
            if ($('inpExchangeRate')) $('inpExchangeRate').value = formatNumberWithComma(rateVal);
        } else {
            if ($('inpExchangeRate')) $('inpExchangeRate').value = '';
        }
        this.onCurrencyChange();

        const isFreight = (item.freight_type === '하차도') || item.is_freight_included === 1 || item.is_freight_included === true || (item.note && item.note.includes('[운임포함]'));
        const fBuy = (item.currency !== 'KRW' && item.foreign_buy_price > 0) ? item.foreign_buy_price : (item.buy_price || '');
        const fSell = (item.currency !== 'KRW' && item.foreign_sell_price > 0) ? item.foreign_sell_price : (item.sell_price || '');

        this.modalRows = [{
            selected: false,
            price_type: item.price_type || '견적가',
            item: item.item || '',
            spec: item.spec || '',
            unit: item.unit || '',
            buy_price: fBuy !== '' ? String(fBuy) : '',
            sell_price: fSell !== '' ? String(fSell) : '',
            freight_type: isFreight ? '하차도' : '상차도',
            freight_region: item.freight_region || '전국',
            note: (item.note || '').replace(/\[운임포함\]/g, '').trim()
        }];

        this.updateModalItemDatalist();
        this.renderModalGrid();
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

    syncModalRowsFromDom: function() {
        this.modalRows.forEach((row, idx) => {
            const itemEl = $(`gridItem_${idx}`);
            if (itemEl && itemEl.value !== undefined) row.item = itemEl.value;
            const specEl = $(`gridSpec_${idx}`);
            if (specEl && specEl.value !== undefined) row.spec = specEl.value;
            const unitEl = $(`gridUnit_${idx}`);
            if (unitEl && unitEl.value !== undefined) row.unit = unitEl.value;
            const buyEl = $(`gridBuy_${idx}`);
            if (buyEl && buyEl.value !== undefined) row.buy_price = buyEl.value.replace(/[^0-9.]/g, '');
            const sellEl = $(`gridSell_${idx}`);
            if (sellEl && sellEl.value !== undefined) row.sell_price = sellEl.value.replace(/[^0-9.]/g, '');
            const regionEl = $(`gridFreightRegion_${idx}`);
            if (regionEl && regionEl.value !== undefined) row.freight_region = regionEl.value;
            const noteEl = $(`gridNote_${idx}`);
            if (noteEl && noteEl.value !== undefined) row.note = noteEl.value;
        });

        // 레거시 HTML 캐시 호환: 상단 inpItem이 남아있고 하단 1행이 비어있는 경우 폴백
        const legacyItem = $('inpItem') ? $('inpItem').value.trim() : '';
        if (legacyItem && this.modalRows.length > 0 && !this.modalRows[0].item) {
            this.modalRows[0].item = legacyItem;
        }
    },

    handleSavePrice: async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        this.syncModalRowsFromDom();
        const editId = $('editId') ? $('editId').value : '';
        const category = $('inpCategory') ? $('inpCategory').value.trim() : '';
        const curr = $('inpCurrency') ? $('inpCurrency').value : 'KRW';
        const rate = (curr !== 'KRW') ? parseNumber($('inpExchangeRate') ? $('inpExchangeRate').value : 0) : 1;
        const supplier = $('inpSupplier') ? $('inpSupplier').value.trim() : '';
        const destination = $('inpDestination') ? $('inpDestination').value.trim() : '';

        if (curr !== 'KRW' && rate <= 0) {
            alert('외화 거래 시 유효한 환율(1외화당 원화)을 입력해주세요.');
            if ($('inpExchangeRate')) $('inpExchangeRate').focus();
            return;
        }

        try {
            if (editId) {
                // ── 단건 수정 모드 ──
                const row = this.modalRows[0] || {};
                const rowItem = (row.item || '').trim();
                if (!rowItem) {
                    alert('품목명은 필수 입력 항목입니다.');
                    const fItemInp = $('gridItem_0');
                    if (fItemInp) fItemInp.focus();
                    return;
                }

                const inputBuy = parseNumber(row.buy_price);
                const inputSell = parseNumber(row.sell_price);

                let buyKrw = inputBuy;
                let sellKrw = inputSell;
                let foreignBuy = 0;
                let foreignSell = 0;

                if (curr !== 'KRW') {
                    foreignBuy = inputBuy;
                    foreignSell = inputSell;
                    buyKrw = (rate > 0 && inputBuy > 0) ? Math.round(inputBuy * rate) : 0;
                    sellKrw = (rate > 0 && inputSell > 0) ? Math.round(inputSell * rate) : 0;
                }

                const isFreightIn = row.freight_type === '하차도';
                const payload = {
                    item: rowItem,
                    spec: (row.spec || '').trim(),
                    category: category,
                    unit: (row.unit || 'EA').trim(),
                    price_type: row.price_type || '견적가',
                    currency: curr,
                    exchange_rate: (curr !== 'KRW') ? rate : 1,
                    foreign_buy_price: foreignBuy,
                    foreign_sell_price: foreignSell,
                    buy_price: buyKrw,
                    sell_price: sellKrw,
                    freight_type: row.freight_type || '상차도',
                    freight_region: isFreightIn ? ((row.freight_region || '').trim() || '전국') : '',
                    is_freight_included: isFreightIn ? 1 : 0,
                    default_supplier: supplier,
                    default_destination: destination,
                    note: (row.note || '').trim()
                };

                // ── 견적 비교 테이블 등록 여부 확인 및 상세 경고창 ──
                const existingItem = this.priceList.find(p => String(p.id) === String(editId));
                const relatedSections = [];
                if (existingItem) {
                    (this.quoteSections || []).forEach(sec => {
                        const hasItem = (sec.items || []).some(it => 
                            (it.unit_price_id && String(it.unit_price_id) === String(editId)) ||
                            (it.item === existingItem.item && (it.spec || '') === (existingItem.spec || '') && (it.default_supplier || '') === (existingItem.default_supplier || ''))
                        );
                        if (hasItem) {
                            relatedSections.push(sec.section_name || `섹션 #${sec.id}`);
                        }
                    });
                }

                if (existingItem && relatedSections.length > 0) {
                    const changes = [];
                    if (existingItem.item !== rowItem) {
                        changes.push(`품목명: '${existingItem.item}' → '${rowItem}'`);
                    }
                    if ((existingItem.spec || '').trim() !== (row.spec || '').trim()) {
                        changes.push(`규격: '${existingItem.spec || '-'}' → '${(row.spec || '').trim() || '-'}'`);
                    }
                    if ((existingItem.default_supplier || '').trim() !== supplier) {
                        changes.push(`주 매입처: '${existingItem.default_supplier || '-'}' → '${supplier || '-'}'`);
                    }
                    if (curr !== (existingItem.currency || 'KRW')) {
                        changes.push(`통화: ${existingItem.currency || 'KRW'} → ${curr}`);
                    }
                    if (curr !== 'KRW' && (existingItem.foreign_buy_price || 0) !== foreignBuy) {
                        changes.push(`외화 매입단가: ${(existingItem.foreign_buy_price || 0).toLocaleString()} → ${foreignBuy.toLocaleString()} ${curr}`);
                    }
                    if ((existingItem.buy_price || 0) !== buyKrw) {
                        changes.push(`기준 매입단가: ${(existingItem.buy_price || 0).toLocaleString()}원 → ${buyKrw.toLocaleString()}원`);
                    }
                    if ((existingItem.sell_price || 0) !== sellKrw) {
                        changes.push(`기준 매출단가: ${(existingItem.sell_price || 0).toLocaleString()}원 → ${sellKrw.toLocaleString()}원`);
                    }
                    const oldFreight = existingItem.freight_type || (existingItem.is_freight_included ? '하차도' : '상차도');
                    const newFreight = row.freight_type || '상차도';
                    if (oldFreight !== newFreight) {
                        changes.push(`운임조건: ${oldFreight} → ${newFreight}`);
                    }
                    if (changes.length === 0) {
                        changes.push('상세 정보(비고 및 기타 속성)');
                    }

                    const sectionNamesStr = relatedSections.map(s => `[${s}]`).join(', ');
                    const changeListStr = changes.map(c => ` • ${c}`).join('\n');

                    const confirmMsg = 
                        `⚠️ [견적 비교 작업대 연동 안내]\n\n` +
                        `해당 항목은 현재 견적 비교 작업대(Workspace)에서 사용 중인 항목입니다.\n\n` +
                        `■ 등록된 작업대 섹션 (${relatedSections.length}곳):\n   ${sectionNamesStr}\n\n` +
                        `■ 변경 예정 내용:\n${changeListStr}\n\n` +
                        `• 단가표 수정 시 [작업대] 섹션의 해당 품목도 실시간으로 자동 동기화됩니다.\n` +
                        `• [보관함]에 이미 저장된 과거 검토서들은 원래 확정 단가 그대로 안전하게 불변 보존됩니다.\n\n` +
                        `계속하시겠습니까?`;

                    if (!confirm(confirmMsg)) {
                        return;
                    }
                }

                const res = await authFetch(`${API_BASE}/unit-prices/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                const syncMsg = (res && res.syncedQuoteCount > 0)
                    ? `\n(견적 비교 작업대 ${res.syncedQuoteCount}개 항목 실시간 동기화 완료 / 보관함 과거 문서는 불변 보존됨)`
                    : '';
                alert(`기준단가가 성공적으로 수정되었습니다.${syncMsg}`);
            } else {
                // ── 다건 일괄 등록 모드 ──
                const validRows = this.modalRows.filter(r => (r.item || '').trim().length > 0);

                if (validRows.length === 0) {
                    alert('최소 1개 이상의 행에 품목명을 입력해주세요.');
                    const fItemInp = $('gridItem_0');
                    if (fItemInp) fItemInp.focus();
                    return;
                }

                // 각 행을 단가 마스터 등록 표준 페이로드로 구성
                const buildRowPayload = (r) => {
                    const rBuy = parseNumber(r.buy_price);
                    const rSell = parseNumber(r.sell_price);
                    let buyKrw = rBuy;
                    let sellKrw = rSell;
                    let foreignBuy = 0;
                    let foreignSell = 0;

                    if (curr !== 'KRW') {
                        foreignBuy = rBuy;
                        foreignSell = rSell;
                        buyKrw = (rate > 0 && rBuy > 0) ? Math.round(rBuy * rate) : 0;
                        sellKrw = (rate > 0 && rSell > 0) ? Math.round(rSell * rate) : 0;
                    }

                    const isFreightIn = r.freight_type === '하차도';
                    return {
                        item: r.item.trim(),
                        spec: (r.spec || '').trim(),
                        category: category,
                        unit: (r.unit || 'EA').trim(),
                        price_type: r.price_type || '견적가',
                        currency: curr,
                        exchange_rate: (curr !== 'KRW') ? rate : 1,
                        foreign_buy_price: foreignBuy,
                        foreign_sell_price: foreignSell,
                        buy_price: buyKrw,
                        sell_price: sellKrw,
                        freight_type: r.freight_type || '상차도',
                        freight_region: isFreightIn ? ((r.freight_region || '').trim() || '전국') : '',
                        is_freight_included: isFreightIn ? 1 : 0,
                        default_supplier: supplier,
                        default_destination: destination,
                        note: (r.note || '').trim()
                    };
                };

                let successCount = 0;
                let skipCount = 0;

                // 1건 등록인 경우: 가장 안정적이고 호환성 높은 기존 단건 등록 API 호출
                if (validRows.length === 1) {
                    const singlePayload = buildRowPayload(validRows[0]);
                    await authFetch(`${API_BASE}/unit-prices`, {
                        method: 'POST',
                        body: JSON.stringify(singlePayload)
                    });
                    successCount = 1;
                } else {
                    // 다건(2건 이상)인 경우: batch API 우선 시도 (item 필드 포함)
                    const batchItems = validRows.map(r => buildRowPayload(r));
                    const batchPayload = {
                        item: batchItems[0].item,
                        spec: batchItems[0].spec,
                        category: category,
                        currency: curr,
                        exchange_rate: (curr !== 'KRW') ? rate : 1,
                        default_supplier: supplier,
                        default_destination: destination,
                        items: batchItems,
                        rows: batchItems
                    };

                    let batchSuccess = false;
                    try {
                        const bRes = await authFetch(`${API_BASE}/unit-prices/batch`, {
                            method: 'POST',
                            body: JSON.stringify(batchPayload)
                        });
                        successCount = bRes.insertedCount || validRows.length;
                        skipCount = bRes.skippedCount || 0;
                        batchSuccess = true;
                    } catch (batchErr) {
                        console.warn('단가 일괄(Batch) API 호출 실패, 단건 순차 등록으로 폴백 실행:', batchErr);
                    }

                    // batch 엔드포인트 미지원 또는 실패 시: 단건 순차 등록 폴백
                    if (!batchSuccess) {
                        for (const rowItem of validRows) {
                            try {
                                await authFetch(`${API_BASE}/unit-prices`, {
                                    method: 'POST',
                                    body: JSON.stringify(buildRowPayload(rowItem))
                                });
                                successCount++;
                            } catch (singleErr) {
                                if (singleErr.message && (singleErr.message.includes('이미 존재') || singleErr.message.includes('중복'))) {
                                    skipCount++;
                                } else {
                                    throw singleErr;
                                }
                            }
                        }
                    }
                }

                let alertMsg = `${successCount}건의 기준단가가 성공적으로 등록되었습니다.`;
                if (skipCount > 0) {
                    alertMsg += `\n(기등록 중복 제외: ${skipCount}건)`;
                }
                alert(alertMsg);
            }

            const modalEl = $('priceModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();

            await this.loadPrices();
            await this.loadItemSpecs();
            await this.loadQuoteSections();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    },

    deletePrice: async function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        const relatedSections = [];
        (this.quoteSections || []).forEach(sec => {
            const hasItem = (sec.items || []).some(it => 
                (it.unit_price_id && String(it.unit_price_id) === String(id)) ||
                (it.item === item.item && (it.spec || '') === (item.spec || '') && (it.default_supplier || '') === (item.default_supplier || ''))
            );
            if (hasItem) {
                relatedSections.push(sec.section_name || `섹션 #${sec.id}`);
            }
        });

        let quoteNote = '';
        if (relatedSections.length > 0) {
            quoteNote = `\n\n⚠️ 참고: 현재 견적 비교 테이블의 [${relatedSections.join(', ')}] 섹션에 등록되어 있습니다.\n단가표에서 삭제하더라도 견적 비교 테이블에 등록된 비교 견적 데이터는 보존됩니다.`;
        }

        if (!confirm(`[${item.item} (${item.spec || '규격없음'}) / ${item.default_supplier || '공급처미지정'}] 단가 마스터를 삭제하시겠습니까?\n이 품목의 가격 변동 이력도 함께 삭제됩니다.${quoteNote}`)) {
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

    getPagedItems: function() {
        if (this.pageSize === 'all') return this.filteredList;
        const size = parseInt(this.pageSize, 10) || 50;
        const start = (this.currentPage - 1) * size;
        return this.filteredList.slice(start, start + size);
    },

    toggleSelectAllItems: function(checked) {
        const paged = this.getPagedItems();
        if (checked) {
            paged.forEach(r => this.checkedItemIds.add(r.id));
        } else {
            paged.forEach(r => this.checkedItemIds.delete(r.id));
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
        const paged = this.getPagedItems();
        const totalInPage = paged.length;

        const masterCb = $('selectAllItems');
        if (masterCb) {
            const visibleCheckedCount = paged.filter(r => this.checkedItemIds.has(r.id)).length;
            masterCb.checked = totalInPage > 0 && visibleCheckedCount === totalInPage;
            masterCb.indeterminate = visibleCheckedCount > 0 && visibleCheckedCount < totalInPage;
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

        const btnAddToCompare = $('btnAddToCompare');
        const btnTopAddToCompare = $('btnTopAddToCompare');
        const textAddToCompare = $('addToCompareText');
        const textTopAddToCompare = $('topAddToCompareText');

        if (btnAddToCompare) btnAddToCompare.classList.toggle('d-none', size === 0);
        if (btnTopAddToCompare) btnTopAddToCompare.classList.toggle('d-none', size === 0);
        if (textAddToCompare) textAddToCompare.innerText = `견적 비교 테이블에 담기 (${size})`;
        if (textTopAddToCompare) textTopAddToCompare.innerText = `비교 테이블에 담기 (${size})`;
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

        // ── 1. 품목명 자동완성 ──
        if (inpItem && sugItem) {
            let activeIdx = -1;

            const updateActive = (items, idx) => {
                items.forEach((div, i) => {
                    if (i === idx) {
                        div.classList.add('active-suggestion');
                        div.scrollIntoView({ block: 'nearest' });
                    } else {
                        div.classList.remove('active-suggestion');
                    }
                });
            };

            const selectItem = (val) => {
                if (!val) return;
                inpItem.value = val;
                sugItem.style.display = 'none';
                activeIdx = -1;

                const info = (this.itemsSpecsMap || {})[val];
                if (info) {
                    if (info.defaultCategory && !$('inpCategory').value) $('inpCategory').value = info.defaultCategory;
                    if (info.defaultUnit && $('inpDefaultUnit') && !$('inpDefaultUnit').value) {
                        $('inpDefaultUnit').value = info.defaultUnit;
                        this.onDefaultUnitChange();
                    }
                } else {
                    const matchedPrice = (this.priceList || []).find(p => p.item === val);
                    if (matchedPrice) {
                        if (matchedPrice.category && !$('inpCategory').value) $('inpCategory').value = matchedPrice.category;
                        if (matchedPrice.unit && $('inpDefaultUnit') && !$('inpDefaultUnit').value) {
                            $('inpDefaultUnit').value = matchedPrice.unit;
                            this.onDefaultUnitChange();
                        }
                    }
                }
            };

            inpItem.addEventListener('input', (e) => {
                const val = e.target.value.trim().toLowerCase();
                if (!val) { sugItem.style.display = 'none'; activeIdx = -1; return; }
                const mapKeys = Object.keys(this.itemsSpecsMap || {});
                const priceKeys = (this.priceList || []).map(p => p.item).filter(Boolean);
                const itemKeys = Array.from(new Set([...mapKeys, ...priceKeys]));
                const matched = itemKeys.filter(k => k.toLowerCase().includes(val)).slice(0, 10);
                if (matched.length === 0) { sugItem.style.display = 'none'; activeIdx = -1; return; }

                sugItem.innerHTML = matched.map((m, i) => `<div class="autocomplete-suggestion" data-index="${i}">${escapeHtml(m)}</div>`).join('');
                sugItem.style.display = 'block';
                activeIdx = -1;

                const items = sugItem.querySelectorAll('.autocomplete-suggestion');
                items.forEach((div, i) => {
                    div.addEventListener('mouseenter', () => {
                        activeIdx = i;
                        updateActive(items, activeIdx);
                    });
                    div.addEventListener('click', () => {
                        selectItem(div.innerText.trim());
                        const firstGridSpec = $('gridSpec_0');
                        if (firstGridSpec) firstGridSpec.focus();
                    });
                });
            });

            inpItem.addEventListener('keydown', (e) => {
                if (sugItem.style.display === 'none') return;
                const items = sugItem.querySelectorAll('.autocomplete-suggestion');
                if (!items.length) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = (activeIdx + 1) % items.length;
                    updateActive(items, activeIdx);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = (activeIdx - 1 + items.length) % items.length;
                    updateActive(items, activeIdx);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const target = (activeIdx >= 0 && activeIdx < items.length) ? items[activeIdx] : items[0];
                    selectItem(target.innerText.trim());
                    const firstGridSpec = $('gridSpec_0');
                    if (firstGridSpec) firstGridSpec.focus();
                } else if (e.key === 'Escape') {
                    sugItem.style.display = 'none';
                    activeIdx = -1;
                } else if (e.key === 'Tab') {
                    if (activeIdx >= 0 && activeIdx < items.length) {
                        selectItem(items[activeIdx].innerText.trim());
                    } else {
                        sugItem.style.display = 'none';
                    }
                }
            });

            inpItem.addEventListener('blur', () => setTimeout(() => { sugItem.style.display = 'none'; activeIdx = -1; }, 200));
        }

        // ── 2. 규격(Spec) 자동완성 ──
        if (inpSpec && sugSpec) {
            let activeIdx = -1;

            const updateActive = (items, idx) => {
                items.forEach((div, i) => {
                    if (i === idx) {
                        div.classList.add('active-suggestion');
                        div.scrollIntoView({ block: 'nearest' });
                    } else {
                        div.classList.remove('active-suggestion');
                    }
                });
            };

            const selectSpec = (val) => {
                inpSpec.value = val;
                sugSpec.style.display = 'none';
                activeIdx = -1;
            };

            const showSpecs = () => {
                const currentItem = inpItem ? inpItem.value.trim() : '';
                const val = inpSpec.value.trim().toLowerCase();
                const info = (this.itemsSpecsMap || {})[currentItem];
                let specs = (info && info.specs) ? [...info.specs] : [];
                (this.priceList || []).filter(p => p.item === currentItem && p.spec).forEach(p => {
                    if (!specs.includes(p.spec)) specs.push(p.spec);
                });
                if (specs.length === 0) { sugSpec.style.display = 'none'; activeIdx = -1; return; }

                const filtered = val ? specs.filter(s => s.toLowerCase().includes(val)) : specs;
                if (filtered.length === 0) { sugSpec.style.display = 'none'; activeIdx = -1; return; }

                sugSpec.innerHTML = filtered.map((s, i) => `<div class="autocomplete-suggestion" data-index="${i}">${escapeHtml(s)}</div>`).join('');
                sugSpec.style.display = 'block';
                activeIdx = -1;

                const items = sugSpec.querySelectorAll('.autocomplete-suggestion');
                items.forEach((div, i) => {
                    div.addEventListener('mouseenter', () => {
                        activeIdx = i;
                        updateActive(items, activeIdx);
                    });
                    div.addEventListener('click', () => {
                        selectSpec(div.innerText.trim());
                    });
                });
            };

            inpSpec.addEventListener('focus', showSpecs);
            inpSpec.addEventListener('input', showSpecs);

            inpSpec.addEventListener('keydown', (e) => {
                if (sugSpec.style.display === 'none') return;
                const items = sugSpec.querySelectorAll('.autocomplete-suggestion');
                if (!items.length) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = (activeIdx + 1) % items.length;
                    updateActive(items, activeIdx);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = (activeIdx - 1 + items.length) % items.length;
                    updateActive(items, activeIdx);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const target = (activeIdx >= 0 && activeIdx < items.length) ? items[activeIdx] : items[0];
                    selectSpec(target.innerText.trim());
                    if ($('inpUnit') && !$('inpUnit').value.trim()) {
                        $('inpUnit').focus();
                    } else if ($('inpSupplier') && !$('inpSupplier').value.trim()) {
                        $('inpSupplier').focus();
                    } else if ($('inpBuyPrice')) {
                        $('inpBuyPrice').focus();
                    }
                } else if (e.key === 'Escape') {
                    sugSpec.style.display = 'none';
                    activeIdx = -1;
                } else if (e.key === 'Tab') {
                    if (activeIdx >= 0 && activeIdx < items.length) {
                        selectSpec(items[activeIdx].innerText.trim());
                    } else {
                        sugSpec.style.display = 'none';
                    }
                }
            });

            inpSpec.addEventListener('blur', () => setTimeout(() => { sugSpec.style.display = 'none'; activeIdx = -1; }, 200));
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

        const headers = ['No', '단가구분', '자재분류', '주 매입처', '품목명', '규격', '단위', '운임조건', '기준 매입단가', '기준 매출단가', '마진액', '마진율(%)', '비고'];
        const rows = this.filteredList.map((r, idx) => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
            const marginRate = (sell > 0 && buy > 0) ? Math.round(((sell - buy) / sell) * 1000) / 10 : 0;
            const pt = r.price_type || '견적가';
            const isFreightIn = (r.freight_type === '하차도') || (r.is_freight_included === 1 || r.is_freight_included === true || (r.note && r.note.includes('[운임포함]')));
            const freightStr = isFreightIn ? `하차도${r.freight_region ? ` [${r.freight_region}]` : ''}` : '상차도';

            return [
                idx + 1,
                pt,
                r.category || '',
                r.default_supplier || '',
                r.item || '',
                r.spec || '',
                r.unit || '',
                freightStr,
                buy,
                sell,
                marginAmt,
                marginRate,
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
    // 견적 비교 작업대 및 검토서 보관함 시스템 (Tab 2)
    // ─────────────────────────────────────────
    loadArchiveList: async function() {
        try {
            const data = await authFetch(`${API_BASE}/quote-projects`);
            this.archiveProjects = Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('loadArchiveList error:', e);
            this.archiveProjects = [];
        }

        const badge = $('archiveCountBadge');
        if (badge) badge.innerText = this.archiveProjects.length;
    },

    openSaveToArchiveModal: function() {
        if (!this.quoteSections || this.quoteSections.length === 0) {
            alert('현재 작업대에 저장할 비교 섹션이 없습니다.\n[품목별 단가표]에서 비교할 품목들을 먼저 담아주세요.');
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const inpTitle = $('inpArchiveTitle');
        if (inpTitle) inpTitle.value = `[${today}] 자재 구매 단가 비교 검토`;
        const inpDate = $('inpArchiveDate');
        if (inpDate) inpDate.value = today;
        const inpMemo = $('inpArchiveMemo');
        if (inpMemo) inpMemo.value = '';
        const chkClear = $('chkArchiveClearDraft');
        if (chkClear) chkClear.checked = false;

        if (!this.saveToArchiveModalInstance && window.bootstrap && $('saveToArchiveModal')) {
            this.saveToArchiveModalInstance = new bootstrap.Modal($('saveToArchiveModal'));
        }
        if (this.saveToArchiveModalInstance) {
            this.saveToArchiveModalInstance.show();
            setTimeout(() => { if (inpTitle) { inpTitle.focus(); inpTitle.select(); } }, 200);
        }
    },

    submitSaveToArchive: async function() {
        const inpTitle = $('inpArchiveTitle');
        const title = inpTitle ? inpTitle.value.trim() : '';
        if (!title) {
            alert('검토서 명칭을 입력해주세요.');
            if (inpTitle) inpTitle.focus();
            return;
        }

        const docDate = $('inpArchiveDate') ? $('inpArchiveDate').value.trim() : '';
        const memo = $('inpArchiveMemo') ? $('inpArchiveMemo').value.trim() : '';
        const clearDraft = $('chkArchiveClearDraft') ? $('chkArchiveClearDraft').checked : false;

        try {
            const payload = {
                title,
                doc_date: docDate,
                memo,
                clear_draft: clearDraft
            };
            const res = await authFetch(`${API_BASE}/quote-projects/save-from-draft`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (this.saveToArchiveModalInstance) {
                this.saveToArchiveModalInstance.hide();
            }

            await this.loadArchiveList();
            if (clearDraft) {
                await this.loadQuoteSections();
            }
            alert(res.message || '검토서가 보관함에 성공적으로 저장되었습니다.');
        } catch (err) {
            alert('보관함 저장 실패: ' + err.message);
        }
    },

    openArchiveModal: async function() {
        await this.loadArchiveList();
        this.archiveSearchQuery = '';
        const searchInp = $('inpArchiveSearch');
        if (searchInp) searchInp.value = '';
        this.renderArchiveList();

        if (!this.quoteArchiveModalInstance && window.bootstrap && $('quoteArchiveModal')) {
            this.quoteArchiveModalInstance = new bootstrap.Modal($('quoteArchiveModal'));
        }
        if (this.quoteArchiveModalInstance) {
            this.quoteArchiveModalInstance.show();
        }
    },

    filterArchiveList: function(keyword) {
        this.archiveSearchQuery = (keyword || '').trim().toLowerCase();
        this.renderArchiveList();
    },

    renderArchiveList: function() {
        const tbody = $('quoteArchiveListBody');
        if (!tbody) return;

        let list = this.archiveProjects || [];
        if (this.archiveSearchQuery) {
            list = list.filter(p => (p.title || '').toLowerCase().includes(this.archiveSearchQuery) || (p.memo || '').toLowerCase().includes(this.archiveSearchQuery));
        }

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-4 text-muted">
                        ${this.archiveSearchQuery ? '검색 결과와 일치하는 검토서가 없습니다.' : '보관함에 저장된 검토서가 없습니다. 작업대에서 [보관함에 저장]을 눌러 저장해보세요.'}
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        list.forEach((p, idx) => {
            const dateStr = p.doc_date ? p.doc_date.substring(0, 10) : '-';
            html += `
                <tr>
                    <td class="text-center fw-bold text-secondary">${idx + 1}</td>
                    <td class="text-start ps-2">
                        <strong class="text-dark">${escapeHtml(p.title)}</strong>
                    </td>
                    <td class="text-center text-muted">${dateStr}</td>
                    <td class="text-center">
                        <span class="badge bg-secondary">${p.section_count || 0}섹션 / ${p.item_count || 0}품목</span>
                    </td>
                    <td class="text-start ps-2 small text-muted text-truncate" style="max-width: 160px;" title="${escapeHtml(p.memo || '')}">
                        ${escapeHtml(p.memo || '-')}
                    </td>
                    <td class="text-center">
                        <div class="d-flex justify-content-center gap-1">
                            <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size: 11px; height: 24px;" 
                                    onclick="app.restoreFromArchive(${p.id})" title="이 검토서를 작업대로 불러와서 이어서 편집합니다">
                                <i class='bx bx-import'></i> 불러오기
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-success py-0 px-2" style="font-size: 11px; height: 24px;" 
                                    onclick="app.printArchivedProject(${p.id})" title="작업대 변경 없이 이 검토서 내용으로 즉시 A4 보고서를 인쇄합니다">
                                <i class='bx bx-printer'></i> 인쇄
                            </button>
                            <button type="button" class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size: 11px; height: 24px;" 
                                    onclick="app.deleteArchivedProject(${p.id})" title="이 검토서를 보관함에서 삭제합니다">
                                <i class='bx bx-trash'></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    },

    restoreFromArchive: async function(projectId) {
        const p = (this.archiveProjects || []).find(item => item.id === projectId);
        const name = p ? p.title : '선택한 검토서';

        if (!confirm(`[${name}] 검토서 내용을 현재 비교 작업대로 불러오시겠습니까?\n\n※ 주의: 현재 작업대에 작성 중이던 섹션과 품목은 이 검토서 내용으로 대체됩니다.`)) {
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/quote-projects/${projectId}/restore-to-draft`, {
                method: 'POST'
            });

            if (this.quoteArchiveModalInstance) {
                this.quoteArchiveModalInstance.hide();
            }

            await this.loadQuoteSections();
            this.switchViewMode('quote');
            alert(res.message || '검토서가 비교 작업대로 성공적으로 불러와졌습니다.');
        } catch (err) {
            alert('불러오기 실패: ' + err.message);
        }
    },

    printArchivedProject: async function(projectId) {
        try {
            const res = await authFetch(`${API_BASE}/quote-projects/${projectId}/sections`);
            if (!res || !res.project || !res.sections) {
                alert('검토서 데이터를 불러올 수 없습니다.');
                return;
            }
            if (this.quoteArchiveModalInstance) {
                this.quoteArchiveModalInstance.hide();
            }
            // 작업대 변경 없이 보관함 데이터 맞춤 설정 모달 열기
            this.openArchivePrintOptionModal(res.project, res.sections);
        } catch (err) {
            alert('인쇄 준비 실패: ' + err.message);
        }
    },

    deleteArchivedProject: async function(projectId) {
        const p = (this.archiveProjects || []).find(item => item.id === projectId);
        const name = p ? p.title : '검토서';
        if (!confirm(`[${name}] 검토서를 보관함에서 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/quote-projects/${projectId}`, {
                method: 'DELETE'
            });
            await this.loadArchiveList();
            this.renderArchiveList();
            alert('검토서가 보관함에서 삭제되었습니다.');
        } catch (err) {
            alert('검토서 삭제 실패: ' + err.message);
        }
    },

    clearDraftSections: async function() {
        if (!this.quoteSections || this.quoteSections.length === 0) {
            alert('현재 작업대에 비울 비교 섹션이 없습니다.');
            return;
        }

        if (!confirm('현재 비교 작업대의 모든 섹션과 품목을 비우시겠습니까?\n\n※ 아직 [보관함에 저장]하지 않은 작업 내용은 삭제됩니다.')) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/quote-sections/clear-draft`, {
                method: 'DELETE'
            });
            await this.loadQuoteSections();
            alert('비교 작업대가 깨끗이 비워졌습니다. 단가표에서 새 비교 작업을 시작하실 수 있습니다.');
        } catch (err) {
            alert('작업대 비우기 실패: ' + err.message);
        }
    },

    // ─────────────────────────────────────────
    // 사용자 정의 섹션 기반 견적 비교 테이블 시스템 (Tab 2: 작업대)
    // ─────────────────────────────────────────
    loadQuoteSections: async function() {
        try {
            const data = await authFetch(`${API_BASE}/quote-sections?project_id=0`);
            this.quoteSections = Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('loadQuoteSections error:', e);
            this.quoteSections = [];
        }

        const secCount = this.quoteSections.length;
        let totalItems = 0;
        this.quoteSections.forEach(s => {
            if (s.items && Array.isArray(s.items)) totalItems += s.items.length;
        });

        const badge1 = $('quoteSectionCountBadge');
        if (badge1) badge1.innerText = secCount;

        const badge2 = $('quoteTotalSectionCountBadge');
        if (badge2) badge2.innerText = `${secCount}개 섹션`;

        const badge3 = $('quoteTotalItemCountBadge');
        if (badge3) badge3.innerText = `총 ${totalItems}개 품목`;

        if (this.viewMode === 'quote') {
            this.renderQuoteComparisonView();
        }
    },

    switchViewMode: function(mode) {
        this.viewMode = mode;
        const itemBtn = $('viewModeItemBtn');
        const quoteBtn = $('viewModeQuoteBtn');
        if (itemBtn) itemBtn.classList.toggle('active', mode === 'item');
        if (quoteBtn) quoteBtn.classList.toggle('active', mode === 'quote');

        const priceGrid = $('priceGridWrapper');
        const itemPagingBar = $('itemPaginationBar');
        const quoteWrapper = $('quoteComparisonWrapper');

        if (priceGrid) priceGrid.classList.toggle('d-none', mode !== 'item');
        if (itemPagingBar) itemPagingBar.classList.toggle('d-none', mode !== 'item');
        if (quoteWrapper) quoteWrapper.classList.toggle('d-none', mode !== 'quote');

        const exportExcelBtn = $('btnExportExcel');
        if (exportExcelBtn) exportExcelBtn.classList.toggle('d-none', mode !== 'item');

        if (mode === 'quote') {
            this.renderQuoteComparisonView();
        }
    },

    formatBenchmarkItem: function(bm) {
        if (!bm) return '';
        const item = (bm.item || '').trim();
        const maker = (bm.maker || '').trim();
        if (maker && item) {
            if (item.includes(maker)) return item;
            return `[${maker}] ${item}`;
        }
        return item || (maker ? `[${maker}]` : '');
    },

    getSectionBenchmarks: function(sec) {
        if (!sec) return [];
        const result = [];

        // 1. target_benchmarks JSON 처리
        if (sec.target_benchmarks) {
            let list = [];
            if (Array.isArray(sec.target_benchmarks)) {
                list = sec.target_benchmarks;
            } else if (typeof sec.target_benchmarks === 'string' && sec.target_benchmarks.trim()) {
                try {
                    const parsed = JSON.parse(sec.target_benchmarks);
                    if (Array.isArray(parsed)) list = parsed;
                } catch (e) {}
            }
            list.forEach(b => {
                if (!b) return;
                const maker = (b.maker || '').trim();
                const item = (b.item || '').trim();
                const spec = (b.spec || '').trim();
                if (maker || item || spec) {
                    result.push({ maker, item, spec });
                }
            });
            if (result.length > 0) return result;
        }

        // 2. target_spec / recommended_spec JSON 형태 처리
        let maker = (sec.target_maker || '').trim();
        let item = (sec.target_item || '').trim();
        let spec = (sec.target_spec || sec.recommended_spec || '').trim();

        if (spec.startsWith('[') && spec.endsWith(']')) {
            try {
                const parsed = JSON.parse(spec);
                if (Array.isArray(parsed)) {
                    parsed.forEach(b => {
                        if (!b) return;
                        const m = (b.maker || '').trim();
                        const i = (b.item || '').trim();
                        const s = (b.spec || '').trim();
                        if (m || i || s) result.push({ maker: m, item: i, spec: s });
                    });
                    if (result.length > 0) return result;
                }
            } catch (e) {}
        }

        if (spec.startsWith('{') && spec.endsWith('}')) {
            try {
                const parsed = JSON.parse(spec);
                maker = parsed.maker || maker;
                item = parsed.item || item;
                spec = parsed.spec || '';
            } catch (e) {}
        }

        if (maker || item || spec) {
            result.push({ maker, item, spec });
        }
        return result;
    },

    getSectionBenchmark: function(sec) {
        const list = this.getSectionBenchmarks(sec);
        return list.length > 0 ? list[0] : null;
    },

    renderBenchmarkRows: function(tbodyId, list) {
        const tbody = $(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = '';
        const items = (Array.isArray(list) && list.length > 0) ? list : [{ maker: '', item: '', spec: '' }];
        items.forEach((bm) => {
            this.addBenchmarkRow(tbodyId, bm);
        });
    },

    addBenchmarkRow: function(tbodyId, data = {}) {
        const tbody = $(tbodyId);
        if (!tbody) return;
        const rowCount = tbody.querySelectorAll('tr').length;
        const tr = document.createElement('tr');
        tr.className = 'benchmark-input-row';
        const formattedItem = this.formatBenchmarkItem(data);
        tr.innerHTML = `
            <td class="text-center fw-bold text-secondary benchmark-row-no" style="font-size: 11px;">${rowCount + 1}</td>
            <td>
                <input type="text" class="form-control form-control-sm bm-input-item" 
                       placeholder="예: [현대오일뱅크] 테일씰그리스 HD, CONDAT WR89" maxlength="100" value="${escapeHtml(formattedItem)}">
            </td>
            <td>
                <input type="text" class="form-control form-control-sm bm-input-spec" 
                       placeholder="예: 250kg Drum, VG 46" maxlength="50" value="${escapeHtml(data.spec || '')}">
            </td>
            <td class="text-center">
                <button type="button" class="btn-subgrid-del" title="이 기준품 삭제" onclick="app.removeBenchmarkRow(this)">
                    <i class='bx bx-trash'></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    },

    removeBenchmarkRow: function(btnEl) {
        const tr = btnEl.closest('tr');
        if (!tr) return;
        const tbody = tr.parentElement;
        tr.remove();
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach((row, idx) => {
                const noEl = row.querySelector('.benchmark-row-no');
                if (noEl) noEl.innerText = idx + 1;
            });
            if (rows.length === 0) {
                this.addBenchmarkRow(tbody.id, {});
            }
        }
    },

    getBenchmarkRowsData: function(tbodyId) {
        const tbody = $(tbodyId);
        if (!tbody) return [];
        const rows = tbody.querySelectorAll('tr');
        const results = [];
        rows.forEach(tr => {
            const item = (tr.querySelector('.bm-input-item')?.value || '').trim();
            const spec = (tr.querySelector('.bm-input-spec')?.value || '').trim();
            if (item || spec) {
                results.push({ maker: '', item, spec });
            }
        });
        return results;
    },

    openAddToQuoteModal: function() {
        if (this.checkedItemIds.size === 0) {
            alert('비교할 단가 항목을 먼저 1개 이상 체크(선택)해주세요.');
            return;
        }

        const selected = this.priceList.filter(p => this.checkedItemIds.has(p.id));
        const countEl = $('modalSelectedCount');
        if (countEl) countEl.innerText = selected.length;

        const listEl = $('modalSelectedItemsList');
        if (listEl) {
            listEl.innerHTML = selected.map(it => {
                const buyStr = it.buy_price ? `${it.buy_price.toLocaleString()}원` : '단가미등록';
                const freightStr = (it.is_freight_included === 1 || it.is_freight_included === true || (it.note && it.note.includes('[운임포함]'))) ? '도착도' : '상차도';
                return `
                    <div class="d-flex justify-content-between align-items-center py-1 border-bottom small">
                        <div>
                            <strong class="text-dark">${escapeHtml(it.item)}</strong>
                            <span class="text-muted ms-1">[${escapeHtml(it.spec || '규격없음')}]</span>
                            <span class="badge bg-light text-secondary border ms-1">${escapeHtml(it.default_supplier || '공급처미지정')}</span>
                        </div>
                        <div class="text-end">
                            <span class="fw-bold text-primary">${buyStr}</span>
                            <span class="text-muted ms-1" style="font-size: 11px;">(${freightStr})</span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 기존 섹션 드롭다운 채우기
        const selectSec = $('selectExistingSection');
        const choiceExisting = $('choiceExisting');
        const choiceNew = $('choiceNew');

        if (selectSec) {
            selectSec.innerHTML = '<option value="">-- 기존 섹션을 선택하세요 --</option>' + 
                this.quoteSections.map(s => `<option value="${s.id}">${escapeHtml(s.section_name)} (${(s.items || []).length}개 후보 등록됨)</option>`).join('');
        }

        if (this.quoteSections.length === 0) {
            if (choiceExisting) choiceExisting.disabled = true;
            if (choiceNew) choiceNew.checked = true;
            if (selectSec) selectSec.disabled = true;
        } else {
            if (choiceExisting) choiceExisting.disabled = false;
        }

        const inputNew = $('inputNewSectionName');
        if (inputNew) inputNew.value = '';
        this.renderBenchmarkRows('addQuoteBenchmarkTableBody', []);

        this.onSectionChoiceChange();

        if (!this.addToQuoteModalInstance && window.bootstrap && $('addToQuoteModal')) {
            this.addToQuoteModalInstance = new bootstrap.Modal($('addToQuoteModal'));
        }
        if (this.addToQuoteModalInstance) {
            this.addToQuoteModalInstance.show();
        }
    },

    onSectionChoiceChange: function() {
        const choiceRadio = document.querySelector('input[name="sectionChoice"]:checked');
        const choice = choiceRadio ? choiceRadio.value : 'new';
        const selectSec = $('selectExistingSection');
        const inputNew = $('inputNewSectionName');
        const wrapNewInputs = $('newSectionInputsWrap');

        if (choice === 'new') {
            if (selectSec) selectSec.disabled = true;
            if (wrapNewInputs) wrapNewInputs.style.display = 'block';
            if (inputNew) {
                inputNew.disabled = false;
                setTimeout(() => inputNew.focus(), 150);
            }
        } else {
            if (selectSec) {
                selectSec.disabled = false;
                setTimeout(() => selectSec.focus(), 150);
            }
            if (wrapNewInputs) wrapNewInputs.style.display = 'none';
            if (inputNew) inputNew.disabled = true;
        }
    },

    submitAddToQuote: async function() {
        const choiceRadio = document.querySelector('input[name="sectionChoice"]:checked');
        const choice = choiceRadio ? choiceRadio.value : 'new';
        let sectionId = null;
        let sectionName = '';
        let targetMaker = '';
        let targetItem = '';
        let targetSpec = '';
        let targetBenchmarks = [];

        if (choice === 'existing') {
            const selectSec = $('selectExistingSection');
            sectionId = selectSec ? parseInt(selectSec.value) : null;
            if (!sectionId) {
                alert('기존 비교 섹션을 선택해주세요.');
                if (selectSec) selectSec.focus();
                return;
            }
            const sec = this.quoteSections.find(s => s.id === sectionId);
            if (sec) sectionName = sec.section_name;
        } else {
            const inputNew = $('inputNewSectionName');
            sectionName = inputNew ? inputNew.value.trim() : '';
            if (!sectionName) {
                alert('생성할 비교 섹션(항목)명을 입력해주세요. (예: 테일씰그리스, 2공구 급결제)');
                if (inputNew) inputNew.focus();
                return;
            }
            targetBenchmarks = this.getBenchmarkRowsData('addQuoteBenchmarkTableBody');
            targetMaker = targetBenchmarks[0]?.maker || '';
            targetItem = targetBenchmarks[0]?.item || '';
            targetSpec = targetBenchmarks[0]?.spec || '';
        }

        const selected = this.priceList.filter(p => this.checkedItemIds.has(p.id));
        if (selected.length === 0) {
            alert('담을 단가 항목이 없습니다.');
            return;
        }

        const itemsPayload = selected.map(p => ({
            unit_price_id: p.id,
            item: p.item,
            spec: p.spec,
            category: p.category,
            unit: p.unit,
            buy_price: p.buy_price || 0,
            sell_price: p.sell_price || 0,
            currency: p.currency || 'KRW',
            exchange_rate: parseFloat(p.exchange_rate) || 1.0,
            foreign_buy_price: parseFloat(p.foreign_buy_price) || 0,
            foreign_sell_price: parseFloat(p.foreign_sell_price) || 0,
            price_type: p.price_type || '견적가',
            default_supplier: p.default_supplier,
            default_destination: p.default_destination,
            freight_type: p.freight_type || ((p.is_freight_included === 1 || p.is_freight_included === true || (p.note && p.note.includes('[운임포함]'))) ? '하차도' : '상차도'),
            freight_region: p.freight_region || '',
            is_freight_included: (p.is_freight_included === 1 || p.is_freight_included === true || p.freight_type === '하차도' || (p.note && p.note.includes('[운임포함]'))) ? 1 : 0,
            note: p.note
        }));

        try {
            const res = await authFetch(`${API_BASE}/quote-sections/add-items`, {
                method: 'POST',
                body: JSON.stringify({
                    project_id: 0,
                    section_id: sectionId,
                    section_name: sectionName,
                    target_maker: targetMaker,
                    target_item: targetItem,
                    target_spec: targetSpec,
                    target_benchmarks: targetBenchmarks,
                    items: itemsPayload
                })
            });

            if (this.addToQuoteModalInstance) {
                this.addToQuoteModalInstance.hide();
            }

            // 체크 해제 및 테이블 갱신
            this.checkedItemIds.clear();
            this.updateItemSelectionState();
            this.renderTable();

            // 작업대 데이터 새로고침
            await this.loadQuoteSections();

            // 견적 비교 탭으로 자동 이동
            this.switchViewMode('quote');

            alert(`선택한 ${res.addedCount || itemsPayload.length}개 품목이 [${res.section_name || sectionName}] 비교 작업대에 성공적으로 담겼습니다.`);
        } catch (err) {
            alert('비교 작업대 담기 실패: ' + err.message);
        }
    },

    openNewSectionModal: function() {
        const inp = $('inpDirectSectionName');
        if (inp) inp.value = '';
        this.renderBenchmarkRows('directBenchmarkTableBody', []);

        if (!this.newSectionModalInstance && window.bootstrap && $('newSectionModal')) {
            this.newSectionModalInstance = new bootstrap.Modal($('newSectionModal'));
        }
        if (this.newSectionModalInstance) {
            this.newSectionModalInstance.show();
            setTimeout(() => { if (inp) inp.focus({ preventScroll: true }); }, 200);
        }
    },

    createDirectSection: async function() {
        const inp = $('inpDirectSectionName');
        const name = inp ? inp.value.trim() : '';
        if (!name) {
            alert('섹션명을 입력해주세요.');
            return;
        }
        const benchmarks = this.getBenchmarkRowsData('directBenchmarkTableBody');
        const targetMaker = benchmarks[0]?.maker || '';
        const targetItem = benchmarks[0]?.item || '';
        const targetSpec = benchmarks[0]?.spec || '';

        try {
            await authFetch(`${API_BASE}/quote-sections/add-items`, {
                method: 'POST',
                body: JSON.stringify({
                    project_id: 0,
                    section_name: name,
                    target_maker: targetMaker,
                    target_item: targetItem,
                    target_spec: targetSpec,
                    target_benchmarks: benchmarks,
                    items: []
                })
            });
            if (this.newSectionModalInstance) {
                this.newSectionModalInstance.hide();
            }
            await this.loadQuoteSections();
        } catch (err) {
            alert('섹션 생성 실패: ' + err.message);
        }
    },

    openEditSectionNameModal: function(sectionId) {
        const sec = (this.quoteSections || []).find(s => s.id === sectionId);
        if (!sec) return;
        if ($('editSectionNameId')) $('editSectionNameId').value = sectionId;
        const inp = $('inpEditSectionName');
        if (inp) {
            inp.value = sec.section_name || '';
        }
        const benchmarks = this.getSectionBenchmarks(sec);
        this.renderBenchmarkRows('editBenchmarkTableBody', benchmarks);

        if (!this.editSectionNameModalInstance && window.bootstrap && $('editSectionNameModal')) {
            this.editSectionNameModalInstance = new bootstrap.Modal($('editSectionNameModal'));
        }
        if (this.editSectionNameModalInstance) {
            this.editSectionNameModalInstance.show();
            setTimeout(() => {
                if (inp) {
                    inp.focus({ preventScroll: true });
                    inp.select();
                }
            }, 200);
        }
    },

    submitEditSectionName: async function() {
        const secId = $('editSectionNameId') ? parseInt($('editSectionNameId').value) : null;
        const inp = $('inpEditSectionName');
        const newName = inp ? inp.value.trim() : '';
        if (!secId) return;
        if (!newName) {
            alert('변경할 섹션명을 입력해주세요.');
            return;
        }

        const benchmarks = this.getBenchmarkRowsData('editBenchmarkTableBody');
        const newMaker = benchmarks[0]?.maker || '';
        const newItem = benchmarks[0]?.item || '';
        const newSpec = benchmarks[0]?.spec || '';

        try {
            await authFetch(`${API_BASE}/quote-sections/${secId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    section_name: newName,
                    target_maker: newMaker,
                    target_item: newItem,
                    target_spec: newSpec,
                    target_benchmarks: benchmarks
                })
            });

            const sec = (this.quoteSections || []).find(s => s.id === secId);
            if (sec) {
                sec.section_name = newName;
                sec.name = newName;
                sec.target_maker = newMaker;
                sec.target_item = newItem;
                sec.target_spec = newSpec;
                sec.recommended_spec = newSpec;
                sec.target_benchmarks = JSON.stringify(benchmarks);
            }

            if (this.editSectionNameModalInstance) {
                this.editSectionNameModalInstance.hide();
            }

            await this.loadQuoteSections();
        } catch (err) {
            alert('섹션 정보 변경 실패: ' + err.message);
        }
    },

    deleteQuoteSection: async function(sectionId) {
        const sec = this.quoteSections.find(s => s.id === sectionId);
        const name = sec ? sec.section_name : '섹션';
        if (!confirm(`[${name}] 비교 섹션과 등록된 모든 비교 품목을 삭제하시겠습니까?`)) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/quote-sections/${sectionId}`, {
                method: 'DELETE'
            });
            await this.loadQuoteSections();
        } catch (err) {
            alert('섹션 삭제 실패: ' + err.message);
        }
    },

    deleteQuoteItem: async function(itemId) {
        if (!confirm('이 비교 항목을 섹션에서 제외하시겠습니까?')) {
            return;
        }

        try {
            await authFetch(`${API_BASE}/quote-items/${itemId}`, {
                method: 'DELETE'
            });
            await this.loadQuoteSections();
        } catch (err) {
            alert('항목 제외 실패: ' + err.message);
        }
    },

    updateSectionMemo: async function(sectionId, textareaEl) {
        const note = textareaEl ? textareaEl.value : '';
        try {
            await authFetch(`${API_BASE}/quote-sections/${sectionId}`, {
                method: 'PUT',
                body: JSON.stringify({ section_note: note })
            });
            const sec = this.quoteSections.find(s => s.id === sectionId);
            if (sec) sec.section_note = note;
        } catch (err) {
            console.warn('updateSectionMemo error:', err);
        }
    },

    parseUnitNormalize: function(spec, price) {
        if (!price || price <= 0 || !spec) return null;
        // e.g. 15kg, 15 kg, 250kg/drum, 18L, 18리터, 1000L, 0.5ton
        const m = spec.match(/([0-9]+(?:\.[0-9]+)?)\s*(kg|l|리터|킬로|k|g|톤|ton)/i);
        if (!m) return null;
        let qty = parseFloat(m[1]);
        if (!qty || qty <= 0) return null;
        let unitStr = m[2].toLowerCase();
        if (unitStr === 'k' || unitStr === '킬로' || unitStr === 'kg') {
            unitStr = 'kg';
        } else if (unitStr === '리터' || unitStr === 'l') {
            unitStr = 'L';
        } else if (unitStr === 'ton' || unitStr === '톤') {
            qty = qty * 1000;
            unitStr = 'kg';
        } else if (unitStr === 'g') {
            qty = qty / 1000;
            unitStr = 'kg';
        }

        const normPrice = Math.round(price / qty);
        return {
            qty,
            unit: unitStr,
            normPrice
        };
    },

    // ─────────────────────────────────────────
    // 최상단 품목별 최저가 추천 종합 요약 카드 (대시보드 실시간 렌더링)
    // ─────────────────────────────────────────
    renderQuoteExecutiveSummary: function() {
        const wrapper = $('quoteExecutiveSummaryWrapper');
        if (!wrapper) return;

        if (!this.quoteSections || this.quoteSections.length === 0) {
            wrapper.innerHTML = '';
            return;
        }

        // 각 섹션별 1위 추천 품목 추출
        const summaryItems = [];
        this.quoteSections.forEach((sec, idx) => {
            const items = sec.items || [];
            if (items.length === 0) return;

            const analyzed = items.map(it => {
                const norm = this.parseUnitNormalize(it.spec, it.buy_price);
                return { ...it, norm };
            });

            const normUnits = analyzed.filter(it => it.norm && it.norm.unit).map(it => it.norm.unit);
            const commonUnit = (normUnits.length > 0 && normUnits.length === analyzed.length && normUnits.every(u => u === normUnits[0]))
                ? normUnits[0]
                : null;

            let bestId = null;
            let minVal = Infinity;
            if (commonUnit) {
                analyzed.forEach(it => {
                    if (it.norm && it.norm.normPrice > 0 && it.norm.normPrice < minVal) {
                        minVal = it.norm.normPrice;
                        bestId = it.id;
                    }
                });
            } else {
                analyzed.forEach(it => {
                    const b = it.buy_price || 0;
                    if (b > 0 && b < minVal) {
                        minVal = b;
                        bestId = it.id;
                    }
                });
            }

            const bestItem = analyzed.find(it => it.id === bestId) || analyzed[0];
            const benchmarks = this.getSectionBenchmarks(sec);
            if (bestItem) {
                summaryItems.push({
                    secId: sec.id,
                    secName: sec.section_name,
                    benchmarks: benchmarks,
                    item: bestItem,
                    commonUnit: commonUnit,
                    totalCandidates: items.length
                });
            }
        });

        if (summaryItems.length === 0) {
            wrapper.innerHTML = '';
            return;
        }

        let rowsHtml = '';
        summaryItems.forEach((sum, sIdx) => {
            const it = sum.item;
            const buy = it.buy_price || 0;
            const isForeign = it.currency && it.currency !== 'KRW';
            const currSym = this.currencySymbols[it.currency] || '$';

            let buyHtml = '';
            if (isForeign && it.foreign_buy_price > 0) {
                buyHtml = `
                    <div class="d-flex flex-column align-items-end">
                        <span class="fw-bold text-dark" style="font-size: 11.5px;">
                            ${currSym}${parseFloat(it.foreign_buy_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                        <span class="text-muted" style="font-size: 10px;">
                            (₩${buy ? buy.toLocaleString() : '0'} @${it.exchange_rate ? it.exchange_rate.toLocaleString() : '-'})
                        </span>
                    </div>
                `;
            } else {
                buyHtml = `<strong class="text-dark">₩${buy ? buy.toLocaleString() : '-'}</strong>`;
            }

            let normHtml = '<span class="text-muted">-</span>';
            if (it.norm) {
                normHtml = `<span class="badge-norm-price fw-bold" style="background:#ecfdf5; color:#047857; border-color:#a7f3d0; font-size:12px; padding:3px 7px;">₩${it.norm.normPrice.toLocaleString()}/${it.norm.unit}</span>`;
            }

            const isFreightIn = (it.freight_type === '하차도') || it.is_freight_included === 1 || it.is_freight_included === true;
            const freightBadge = isFreightIn
                ? `<span class="badge-freight-in"><i class='bx bx-check-circle'></i> 하차도${it.freight_region ? ` (${escapeHtml(it.freight_region)})` : ''}</span>`
                : `<span class="badge-freight-ex"><i class='bx bx-box'></i> 상차도</span>`;

            rowsHtml += `
                <tr style="background-color: ${sIdx % 2 === 0 ? '#ffffff' : '#fcfdfd'};">
                    <td class="text-center fw-bold text-secondary" style="font-size: 11px;">${sIdx + 1}</td>
                    <td class="text-start ps-2">
                        <a href="#quote_section_${sum.secId}" class="fw-bold text-dark text-decoration-none hover-primary d-inline-flex align-items-center gap-1" title="클릭 시 해당 비교 섹션으로 이동">
                            <i class='bx bx-folder text-primary'></i> ${escapeHtml(sum.secName)}
                        </a>
                        <span class="text-muted ms-1" style="font-size: 10px;">(${sum.totalCandidates}개 후보)</span>
                        ${(sum.benchmarks && sum.benchmarks.length > 0) ? sum.benchmarks.map((bm, bIdx) => `
                            <div class="text-muted mt-0.5" style="font-size: 10.5px; line-height: 1.25;">
                                <span class="badge bg-light text-secondary border px-1 py-0" style="font-size: 9.5px; font-weight: normal;">${sum.benchmarks.length === 1 ? '기준' : `기준 ${bIdx + 1}`}</span>
                                <strong>${escapeHtml(this.formatBenchmarkItem(bm))}</strong>${bm.spec ? ` <span class="text-secondary">(${escapeHtml(bm.spec)})</span>` : ''}
                            </div>
                        `).join('') : ''}
                    </td>
                    <td class="text-start ps-2 text-truncate" style="max-width: 130px;" title="${escapeHtml(it.default_supplier || '')}">
                        <strong class="text-dark">${escapeHtml(it.default_supplier || '-')}</strong>
                    </td>
                    <td class="text-start ps-2">
                        <div class="d-flex align-items-center gap-1">
                            <i class='bx bx-check-circle text-success fs-6 flex-shrink-0' title="최저단가 1위 추천"></i>
                            <span class="fw-bold text-success text-truncate" style="max-width: 200px;" title="${escapeHtml(it.item)}">${escapeHtml(it.item)}</span>
                        </div>
                    </td>
                    <td class="text-start ps-2 text-truncate" style="max-width: 120px;" title="${escapeHtml(it.spec || '')}">
                        <span class="spec-pill">${escapeHtml(it.spec || '-')}</span>
                    </td>
                    <td class="text-center">
                        ${freightBadge}
                    </td>
                    <td class="text-end pe-2">
                        ${buyHtml}
                    </td>
                    <td class="text-end pe-2">
                        ${normHtml}
                    </td>
                    <td class="text-start ps-2 py-1">
                        <input type="text" class="form-control form-control-sm summary-note-input quote-item-note-input-${it.id}" 
                               style="font-size: 11.5px; height: 26px; padding: 2px 6px; background-color: #fff;" 
                               value="${escapeHtml(it.note || '')}" 
                               placeholder="선정사유/비고 입력..." 
                               onchange="app.updateQuoteItemNote(${it.id}, this.value)"
                               title="입력 시 즉시 자동 저장되며 인쇄 보고서에 반영됩니다">
                    </td>
                </tr>
            `;
        });

        const projectName = this.currentProject ? escapeHtml(this.currentProject.title) : '자재 구매 단가 비교 검토';
        const projectDate = this.currentProject?.doc_date ? this.currentProject.doc_date.substring(0, 10) : new Date().toISOString().split('T')[0];

        wrapper.innerHTML = `
            <div class="card border-0 shadow-sm mb-3" style="border: 1px solid #10b981 !important; border-radius: 6px; overflow: hidden;">
                <div class="card-header py-2 px-3 d-flex justify-content-between align-items-center flex-wrap gap-2" style="background: linear-gradient(90deg, #ecfdf5 0%, #f0fdf4 100%); border-bottom: 1px solid #a7f3d0;">
                    <div class="d-flex align-items-center gap-2">
                        <div class="d-flex align-items-center justify-content-center bg-success text-white rounded-circle" style="width: 24px; height: 24px;">
                            <i class='bx bx-check-shield fs-6'></i>
                        </div>
                        <div>
                            <span class="fw-bold text-dark" style="font-size: 13px;">품목별 최저단가 추천 종합 요약 (Executive Summary)</span>
                            <span class="text-muted ms-2" style="font-size: 11px;">각 비교군별 단위단가 기준 1위 추천</span>
                        </div>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="badge bg-white text-dark border px-2 py-1" style="font-size: 11px;">
                            <i class='bx bx-file text-primary me-1'></i>${projectName} (${projectDate})
                        </span>
                    </div>
                </div>
                <div class="p-0">
                    <div class="table-responsive">
                        <table class="quote-compare-table w-100 mb-0" style="font-size: 11.5px;">
                            <thead>
                                <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                                    <th style="width: 45px;" class="text-center">순번</th>
                                    <th style="min-width: 140px;" class="text-start ps-2">비교 품목군 (섹션)</th>
                                    <th style="width: 130px;" class="text-start ps-2">추천 공급업체</th>
                                    <th style="min-width: 160px;" class="text-start ps-2">추천 선정 품목</th>
                                    <th style="width: 120px;" class="text-start ps-2">규격</th>
                                    <th style="width: 95px;" class="text-center">운임조건</th>
                                    <th style="width: 130px;" class="text-end pe-2">매입단가 (환율)</th>
                                    <th style="width: 125px;" class="text-end pe-2">환산단가 (최저)</th>
                                    <th style="min-width: 180px;" class="text-start ps-2">선정사유 및 비고 (실시간 입력)</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    },

    updateQuoteItemNote: async function(itemId, note) {
        if (!itemId) return;
        const finalNote = (note || '').trim();
        try {
            await authFetch(`${API_BASE}/quote-items/${itemId}`, {
                method: 'PUT',
                body: JSON.stringify({ note: finalNote })
            });

            // 로컬 메모리 상태 즉시 갱신
            (this.quoteSections || []).forEach(sec => {
                (sec.items || []).forEach(it => {
                    if (it.id === itemId) {
                        it.note = finalNote;
                    }
                });
            });

            // 상단 요약표와 하단 세부 비교표 내의 모든 동일 input 요소 값 동기화
            const inputs = document.querySelectorAll(`.quote-item-note-input-${itemId}`);
            inputs.forEach(inp => {
                if (inp.value !== finalNote) inp.value = finalNote;
            });
        } catch (err) {
            console.warn('updateQuoteItemNote error:', err);
            alert('비고 저장 실패: ' + err.message);
        }
    },

    renderQuoteComparisonView: function() {
        const wrapper = $('quoteComparisonWrapper');
        if (!wrapper) return;

        // 최상단 종합 요약 카드 실시간 렌더링
        this.renderQuoteExecutiveSummary();

        const container = $('quoteSectionsContainer');
        if (!container) return;

        if (!this.quoteSections || this.quoteSections.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5 text-muted bg-white rounded border">
                    <i class='bx bx-git-compare fs-1 text-secondary mb-2'></i>
                    <p class="mb-2 fw-semibold">현재 비교 작업대에 담긴 품목이 없습니다.</p>
                    <p class="small text-muted mb-3">
                        좌측 [품목별 단가표]에서 비교할 품목들을 체크한 뒤 <strong>[작업대에 담기]</strong> 버튼을 누르거나,<br>
                        아래 버튼으로 새로운 비교 섹션을 바로 만들어보세요.
                    </p>
                    <div class="d-flex justify-content-center gap-2">
                        <button type="button" class="btn btn-sm btn-primary" onclick="app.openNewSectionModal()">
                            <i class='bx bx-plus'></i> 새 비교 섹션 생성
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.openArchiveModal()">
                            <i class='bx bx-folder-open'></i> 과거 검토서 보관함 열기
                        </button>
                    </div>
                </div>
            `;
            return;
        }

        let html = '';
        this.quoteSections.forEach((sec, sIdx) => {
            const items = sec.items || [];
            
            // 환산 단가 및 최저가 후보 도출
            const analyzedItems = items.map(it => {
                const norm = this.parseUnitNormalize(it.spec, it.buy_price);
                return {
                    ...it,
                    norm
                };
            });

            // 모든 품목이 공통 단위(예: kg)로 환산 가능한지 확인
            const normUnits = analyzedItems.filter(it => it.norm && it.norm.unit).map(it => it.norm.unit);
            const commonUnit = (normUnits.length > 0 && normUnits.length === analyzedItems.length && normUnits.every(u => u === normUnits[0]))
                ? normUnits[0]
                : null;

            let bestItemId = null;
            let minVal = Infinity;

            if (commonUnit) {
                // 환산단가 기준 최저가 도출 (포장규격이 달라도 kg/L당 최저가 우선)
                analyzedItems.forEach(it => {
                    if (it.norm && it.norm.normPrice > 0 && it.norm.normPrice < minVal) {
                        minVal = it.norm.normPrice;
                        bestItemId = it.id;
                    }
                });
            } else {
                // 단순 매입단가 기준 최저가 도출
                analyzedItems.forEach(it => {
                    const b = it.buy_price || 0;
                    if (b > 0 && b < minVal) {
                        minVal = b;
                        bestItemId = it.id;
                    }
                });
            }
            if (minVal === Infinity) minVal = 0;

            const bestItem = analyzedItems.find(it => it.id === bestItemId);
            let bestSummaryHtml = '';
            if (bestItem && analyzedItems.length > 1) {
                if (commonUnit && bestItem.norm) {
                    bestSummaryHtml = `
                        <span class="badge-best-pick">
                            <i class='bx bx-check-circle'></i> 최저단가 추천: ${escapeHtml(bestItem.item)} (₩${bestItem.norm.normPrice.toLocaleString()}/${commonUnit})
                        </span>
                    `;
                } else if (bestItem.buy_price) {
                    bestSummaryHtml = `
                        <span class="badge-best-pick">
                            <i class='bx bx-check-circle'></i> 최저가 추천: ${escapeHtml(bestItem.item)} (₩${bestItem.buy_price.toLocaleString()}원)
                        </span>
                    `;
                }
            }

            const benchmarks = this.getSectionBenchmarks(sec);

            // 설계/권장 기준품 (ERP 실무 표준형 대조 행 - 복수 기준품 지원)
            let benchmarkRowHtml = '';
            if (benchmarks.length > 0) {
                benchmarkRowHtml = benchmarks.map((bm, bIdx) => {
                    const badgeText = benchmarks.length === 1 ? '기준' : `기준 ${bIdx + 1}`;
                    const itemBadgeText = benchmarks.length === 1 ? '설계기준품' : `설계기준품 #${bIdx + 1}`;
                    const noteText = benchmarks.length === 1 ? '권장 규격품 / 견적 후보 대조 기준' : `권장 규격품 #${bIdx + 1} / 견적 후보 대조 기준`;
                    return `
                        <tr class="row-benchmark-spec">
                            <td class="text-center align-middle" style="color: #94a3b8; font-size: 11px;">-</td>
                            <td class="text-center">
                                <span class="badge bg-dark text-white fw-bold px-2 py-0.5" style="font-size: 10px; letter-spacing: 0.5px;">${badgeText}</span>
                            </td>
                            <td class="text-center">
                                <span class="badge bg-secondary text-white" style="font-size: 10px;">설계/권장</span>
                            </td>
                            <td class="text-center text-muted" title="기준품(대조 규격)">-</td>
                            <td class="text-start ps-2 fw-bold text-dark text-truncate" title="${escapeHtml(this.formatBenchmarkItem(bm))}">
                                <span class="text-primary me-1"><i class='bx bx-pin'></i></span>${escapeHtml(this.formatBenchmarkItem(bm))}
                                <span class="badge bg-primary-subtle text-primary border border-primary-subtle ms-1" style="font-size: 9.5px; font-weight: 500;">${itemBadgeText}</span>
                            </td>
                            <td class="text-start ps-2 text-truncate" title="${escapeHtml(bm.spec || '-')}">
                                <span class="spec-pill fw-bold" style="background:#e2e8f0; color:#1e293b; border-color:#cbd5e1;">${escapeHtml(bm.spec || '-')}</span>
                            </td>
                            <td class="text-center text-muted">-</td>
                            <td class="text-end pe-2 text-muted" style="font-size: 11px;">(대조 기준)</td>
                            <td class="text-end pe-2 text-muted">-</td>
                            <td class="text-end pe-2 text-muted">-</td>
                            <td class="text-start ps-2 text-muted" style="font-size: 11px; font-style: italic;">
                                ${noteText}
                            </td>
                            <td class="text-center text-muted">-</td>
                        </tr>
                    `;
                }).join('');
            }

            // 테이블 렌더링
            let rowsHtml = '';
            if (analyzedItems.length === 0) {
                rowsHtml = benchmarkRowHtml + `
                    <tr>
                        <td colspan="12" class="text-center py-4 text-muted">
                            이 섹션에 담긴 품목이 없습니다. [품목별 단가표]에서 항목을 체크하여 이 섹션으로 담아보세요.
                        </td>
                    </tr>
                `;
            } else {
                rowsHtml = benchmarkRowHtml;
                analyzedItems.forEach((it, cIdx) => {
                    const isBest = (it.id === bestItemId) && analyzedItems.length > 1;
                    const buy = it.buy_price || 0;
                    const sell = it.sell_price || 0;
                    const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
                    const marginRate = (sell > 0 && buy > 0) ? Math.round(((sell - buy) / sell) * 1000) / 10 : 0;

                    // 단가구분 뱃지
                    const pt = it.price_type || '견적가';
                    let ptBadgeClass = 'badge-pt-quote';
                    if (pt === '계약가') ptBadgeClass = 'badge-pt-contract';
                    else if (pt === '일시가') ptBadgeClass = 'badge-pt-spot';
                    else if (pt === '표준가') ptBadgeClass = 'badge-pt-std';

                    // 외화 및 환율 버튼 표기
                    const isForeign = it.currency && it.currency !== 'KRW';
                    const currSymbol = this.currencySymbols[it.currency] || '$';
                    const fBuy = it.foreign_buy_price || 0;
                    const rate = it.exchange_rate || 0;

                    let buyCellHtml = '';
                    if (isForeign && fBuy > 0) {
                        buyCellHtml = `
                            <div class="d-flex flex-column align-items-end">
                                <span class="${isBest ? 'text-success fw-bold' : 'fw-bold text-dark'}" style="font-size: 11.5px;">
                                    ${currSymbol}${parseFloat(fBuy).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                </span>
                                <div class="d-flex align-items-center gap-1 mt-0">
                                    <span class="text-muted" style="font-size: 10px;">(₩${buy ? buy.toLocaleString() : '0'})</span>
                                    <button type="button" class="rate-badge-btn" 
                                            onclick="app.openEditRateModal(${it.id}, ${rate}, '${it.currency}', '${escapeHtml(it.item)}', ${fBuy})" 
                                            title="클릭하여 이 품목의 비교 환율 수정 (단가표 마스터는 불변)">
                                        <i class='bx bx-edit'></i> @${rate.toLocaleString()}원
                                    </button>
                                </div>
                            </div>
                        `;
                    } else {
                        buyCellHtml = `
                            <span class="${isBest ? 'text-success fw-bold' : 'fw-semibold text-dark'}">
                                ${buy ? `₩${buy.toLocaleString()}` : '-'}
                            </span>
                        `;
                    }

                    // 환산 단가 컬럼 렌더링
                    let normHtml = '<span class="text-muted small">-</span>';
                    if (it.norm) {
                        const isUnitBest = isBest && commonUnit;
                        let savingsBadge = '';
                        if (commonUnit && !isBest && bestItem && bestItem.norm && it.norm.normPrice > bestItem.norm.normPrice) {
                            const diff = it.norm.normPrice - bestItem.norm.normPrice;
                            const diffPct = Math.round((diff / bestItem.norm.normPrice) * 1000) / 10;
                            savingsBadge = `<span class="badge-savings ms-1" title="최저가 대비">+${diffPct}% 고가</span>`;
                        } else if (isUnitBest) {
                            savingsBadge = `<span class="badge bg-success text-white ms-1" style="font-size: 10px;">최저단가</span>`;
                        }

                        normHtml = `
                            <div class="d-flex align-items-center justify-content-end gap-1">
                                <span class="badge-norm-price">₩${it.norm.normPrice.toLocaleString()}/${it.norm.unit}</span>
                                ${savingsBadge}
                            </div>
                        `;
                    }

                    const isFreightIn = (it.freight_type === '하차도') || it.is_freight_included === 1 || it.is_freight_included === true;
                    const freightBadge = isFreightIn
                        ? `<span class="badge-freight-in"><i class='bx bx-check-circle'></i> 하차도${it.freight_region ? ` (${escapeHtml(it.freight_region)})` : ''}</span>`
                        : `<span class="badge-freight-ex"><i class='bx bx-box'></i> 상차도</span>`;

                    const isChecked = !this.quoteSelectionMap || this.quoteSelectionMap[it.id] !== false;

                    rowsHtml += `
                        <tr class="${isBest ? 'row-best-price' : ''} ${!isChecked ? 'row-unselected' : ''}" data-quote-item-id="${it.id}">
                            <td class="text-center align-middle">
                                <input type="checkbox" class="form-check-input quote-item-chk" 
                                       onchange="app.toggleQuoteItemCheck(${sec.id}, ${it.id}, this.checked)" 
                                       ${isChecked ? 'checked' : ''} title="보고서 인쇄 포함 여부">
                            </td>
                            <td class="text-center">
                                <div class="d-flex align-items-center justify-content-center gap-1">
                                    <span class="badge ${isBest ? 'bg-success' : 'bg-secondary'}" style="font-size: 10px;">후보 ${cIdx + 1}</span>
                                    ${isBest ? '<i class="bx bx-check-circle text-success fs-6" title="최저가 추천 품목"></i>' : ''}
                                </div>
                            </td>
                            <td class="text-center">
                                <span class="${ptBadgeClass}">${escapeHtml(pt)}</span>
                            </td>
                            <td class="text-start ps-2 text-truncate" title="${escapeHtml(it.default_supplier || '')}">
                                <strong class="text-dark">${escapeHtml(it.default_supplier || '-')}</strong>
                            </td>
                            <td class="text-start ps-2 fw-bold text-dark text-truncate" title="${escapeHtml(it.item)}">
                                ${escapeHtml(it.item)}
                            </td>
                            <td class="text-start ps-2 text-truncate" title="${escapeHtml(it.spec || '')}">
                                <span class="spec-pill">${escapeHtml(it.spec || '-')}</span>
                            </td>
                            <td class="text-center">
                                ${freightBadge}
                            </td>
                            <td class="text-end pe-2">
                                ${buyCellHtml}
                            </td>
                            <td class="text-end pe-2">
                                ${normHtml}
                            </td>
                            <td class="text-end pe-2">
                                ${(sell > 0 && buy > 0) ? `
                                    <span class="${marginRate >= 20 ? 'text-success' : (marginRate < 0 ? 'text-danger' : 'text-dark')} fw-semibold">
                                        ₩${marginAmt.toLocaleString()} (${marginRate}%)
                                    </span>
                                ` : '<span class="text-muted">-</span>'}
                            </td>
                            <td class="text-start ps-2 py-1">
                                <input type="text" class="form-control form-control-sm quote-item-note-input-${it.id}" 
                                       style="font-size: 11px; height: 25px; padding: 2px 6px;" 
                                       value="${escapeHtml(it.note || '')}" 
                                       placeholder="비고 입력..." 
                                       onchange="app.updateQuoteItemNote(${it.id}, this.value)"
                                       title="비고 입력 (자동 저장 및 상단 요약표 동기화)">
                            </td>
                            <td class="text-center">
                                <button type="button" class="btn-table-action btn-del" onclick="app.deleteQuoteItem(${it.id})" title="이 섹션에서 제외">
                                    <i class='bx bx-x text-danger fs-5'></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
            }

            const secItems = sec.items || [];
            const allSecChecked = secItems.length > 0 && secItems.every(it => (!this.quoteSelectionMap || this.quoteSelectionMap[it.id] !== false));
            let targetSpecBadge = '';
            if (benchmarks.length === 1) {
                const bm = benchmarks[0];
                targetSpecBadge = `
                    <span class="quote-spec-badge" title="이 비교 섹션의 기준/권장 규격품">
                        <i class='bx bx-pin text-primary'></i> 기준품: <strong>${escapeHtml(this.formatBenchmarkItem(bm))}${bm.spec ? ` (${escapeHtml(bm.spec)})` : ''}</strong>
                    </span>
                `;
            } else if (benchmarks.length > 1) {
                targetSpecBadge = `
                    <span class="quote-spec-badge" title="이 비교 섹션의 복수 기준/권장 규격품 (${benchmarks.length}개)">
                        <i class='bx bx-pin text-primary'></i> 기준품 (${benchmarks.length}개): <strong>${benchmarks.map((bm) => `${escapeHtml(this.formatBenchmarkItem(bm))}${bm.spec ? ` (${escapeHtml(bm.spec)})` : ''}`).join(', ')}</strong>
                    </span>
                `;
            }

            html += `
                <div class="quote-section-card" id="quote_section_${sec.id}">
                    <div class="quote-section-header">
                        <div class="d-flex align-items-center gap-2 flex-wrap">
                            <span class="quote-section-title" ondblclick="app.openEditSectionNameModal(${sec.id})" title="더블클릭하거나 수정 버튼을 눌러 섹션명 및 권장 규격을 변경할 수 있습니다" style="cursor: pointer;">
                                <i class='bx bx-folder-open text-primary'></i>
                                <span>${escapeHtml(sec.section_name)}</span>
                            </span>
                            <button type="button" class="btn-edit-sec" onclick="app.openEditSectionNameModal(${sec.id})" title="섹션명 및 권장 규격 수정">
                                <i class='bx bx-edit-alt'></i> 수정
                            </button>
                            ${targetSpecBadge}
                            <span class="badge bg-secondary">${analyzedItems.length}개 후보 비교</span>
                            ${bestSummaryHtml}
                        </div>
                        <div class="d-flex align-items-center gap-1 flex-wrap">
                            <button type="button" class="btn-erp btn-sm" onclick="app.selectBestOnlyInSection(${sec.id})" title="이 섹션의 최저가(가성비) 품목만 선택하고 나머지는 제외">
                                <i class='bx bx-check-double text-success'></i> 최저가만 선택
                            </button>
                            <button type="button" class="btn-erp btn-sm" onclick="app.openPrintOptionModal(${sec.id})" title="이 섹션만 A4 가로 보고서로 인쇄">
                                <i class='bx bx-printer'></i> 인쇄
                            </button>
                            <button type="button" class="btn-erp btn-sm btn-del" onclick="app.deleteQuoteSection(${sec.id})" title="섹션 및 전체 후보 삭제">
                                <i class='bx bx-trash text-danger'></i> 섹션 삭제
                            </button>
                        </div>
                    </div>

                    <div class="p-2 bg-white">
                        <div class="table-responsive">
                            <table class="quote-compare-table w-100">
                                <thead>
                                    <tr>
                                        <th style="width: 32px;" class="text-center" title="섹션 전체 선택/해제">
                                            <input type="checkbox" class="form-check-input" onchange="app.toggleAllInSection(${sec.id}, this.checked)" ${allSecChecked ? 'checked' : ''}>
                                        </th>
                                        <th style="width: 70px;">후보</th>
                                        <th style="width: 70px;">단가구분</th>
                                        <th style="width: 130px;" class="text-start ps-2">공급업체</th>
                                        <th style="min-width: 150px;" class="text-start ps-2">품목명</th>
                                        <th style="width: 120px;" class="text-start ps-2">규격</th>
                                        <th style="width: 120px;">운임조건</th>
                                        <th style="width: 135px;" class="text-end pe-2">기준 매입단가(환율)</th>
                                        <th style="width: 140px;" class="text-end pe-2" title="포장단위별(kg, L) 동일 환산 기준단가">환산단가(가성비)</th>
                                        <th style="width: 110px;" class="text-end pe-2">마진액(마진율)</th>
                                        <th class="text-start ps-2">비고</th>
                                        <th style="width: 45px;">제외</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                            </table>
                        </div>

                        <!-- 담당자 종합 검토 의견 및 추천 사유 입력 영역 -->
                        <div class="mt-2 p-2 bg-light border rounded">
                            <div class="d-flex align-items-center justify-content-between mb-1">
                                <label class="form-label small fw-bold text-dark mb-0 d-inline-flex align-items-center gap-1">
                                    <i class='bx bx-edit text-primary'></i> ※ 담당자 종합 검토 의견 및 추천 사유
                                </label>
                                <span class="text-muted" style="font-size: 10.5px;">입력 시 실시간 자동저장</span>
                            </div>
                            <textarea class="form-control form-control-sm quote-section-memo" rows="2" 
                                      placeholder="경영진 및 결재권자를 위한 검토 의견을 입력하세요 (예: A사 대비 B사가 포장단위당 16.7% 저렴하고 직배송 운임포함 조건으로 최종 선정 추천)..."
                                      onchange="app.updateSectionMemo(${sec.id}, this)">${escapeHtml(sec.section_note || '')}</textarea>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
        this.updateQuoteSelectionBadges();
    },

    // ─────────────────────────────────────────
    // 견적 비교 테이블 내 환율 간편 수정 모달 메서드
    // ─────────────────────────────────────────
    openEditRateModal: function(itemId, currentRate, currency, itemName, foreignPrice) {
        if (!$('editRateModal')) return;
        $('editRateItemId').value = itemId;
        $('editRateItemName').innerText = itemName || '-';
        this.currentEditRateCurrency = currency || 'USD';
        this.currentEditRateForeignPrice = parseFloat(foreignPrice) || 0;

        const sym = this.currencySymbols[currency] || '$';
        $('editRateForeignPrice').innerText = `${sym}${this.currentEditRateForeignPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        const rate = currentRate || this.defaultRates[currency] || 1350;
        $('inpEditRateValue').value = formatNumberWithComma(rate);

        const label = $('editRateInputLabel');
        if (label) {
            if (currency === 'JPY') {
                label.innerText = '적용 환율 (1 JPY당 원화, 예: 100엔=900원이면 9.0)';
            } else {
                label.innerText = `적용 환율 (1 ${currency}당 원화)`;
            }
        }

        this.calcEditRatePreview();

        if (!this.editRateModalInstance && window.bootstrap) {
            this.editRateModalInstance = new bootstrap.Modal($('editRateModal'));
        }
        if (this.editRateModalInstance) {
            this.editRateModalInstance.show();
            setTimeout(() => {
                const inp = $('inpEditRateValue');
                if (inp) { inp.focus(); inp.select(); }
            }, 200);
        }
    },

    calcEditRatePreview: function() {
        const rate = parseNumber($('inpEditRateValue') ? $('inpEditRateValue').value : 0);
        const fPrice = this.currentEditRateForeignPrice || 0;
        const krw = (rate > 0 && fPrice > 0) ? Math.round(rate * fPrice) : 0;
        const el = $('editRateConvertedPreview');
        if (el) el.innerText = `₩${krw.toLocaleString()}`;
    },

    submitEditRate: async function() {
        const itemId = $('editRateItemId') ? $('editRateItemId').value : null;
        const newRate = parseNumber($('inpEditRateValue') ? $('inpEditRateValue').value : 0);
        if (!itemId || newRate <= 0) {
            alert('유효한 환율을 입력해주세요.');
            return;
        }

        try {
            await authFetch(`${API_BASE}/quote-items/${itemId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    exchange_rate: newRate
                })
            });

            if (this.editRateModalInstance) {
                this.editRateModalInstance.hide();
            }

            await this.loadQuoteSections();
        } catch (err) {
            alert('환율 변경 실패: ' + err.message);
        }
    },

    // ─────────────────────────────────────────
    // 견적 비교 테이블 선택 항목 및 인쇄 설정 메서드
    // ─────────────────────────────────────────
    toggleQuoteItemCheck: function(secId, itemId, checked) {
        if (!this.quoteSelectionMap) this.quoteSelectionMap = {};
        this.quoteSelectionMap[itemId] = checked;
        const tr = document.querySelector(`tr[data-quote-item-id="${itemId}"]`);
        if (tr) tr.classList.toggle('row-unselected', !checked);
        this.updateQuoteSelectionBadges();
    },

    toggleAllInSection: function(secId, forceChecked) {
        if (!this.quoteSelectionMap) this.quoteSelectionMap = {};
        const sec = (this.quoteSections || []).find(s => s.id === secId);
        if (!sec || !sec.items) return;
        sec.items.forEach(it => {
            this.quoteSelectionMap[it.id] = forceChecked;
        });
        this.renderQuoteComparisonView();
    },

    selectBestOnlyInSection: function(secId) {
        if (!this.quoteSelectionMap) this.quoteSelectionMap = {};
        const sec = (this.quoteSections || []).find(s => s.id === secId);
        if (!sec || !sec.items || sec.items.length === 0) return;

        const analyzed = sec.items.map(it => ({
            ...it,
            norm: this.parseUnitNormalize(it.spec, it.buy_price)
        }));
        const normUnits = analyzed.filter(it => it.norm && it.norm.unit).map(it => it.norm.unit);
        const commonUnit = (normUnits.length > 0 && normUnits.length === analyzed.length && normUnits.every(u => u === normUnits[0])) ? normUnits[0] : null;

        let bestId = null;
        let minVal = Infinity;
        if (commonUnit) {
            analyzed.forEach(it => {
                if (it.norm && it.norm.normPrice > 0 && it.norm.normPrice < minVal) {
                    minVal = it.norm.normPrice;
                    bestId = it.id;
                }
            });
        } else {
            analyzed.forEach(it => {
                const b = it.buy_price || 0;
                if (b > 0 && b < minVal) {
                    minVal = b;
                    bestId = it.id;
                }
            });
        }

        sec.items.forEach(it => {
            this.quoteSelectionMap[it.id] = (bestId ? it.id === bestId : true);
        });
        this.renderQuoteComparisonView();
    },

    updateQuoteSelectionBadges: function() {
        let total = 0;
        let selected = 0;
        (this.quoteSections || []).forEach(sec => {
            (sec.items || []).forEach(it => {
                total++;
                if (!this.quoteSelectionMap || this.quoteSelectionMap[it.id] !== false) {
                    selected++;
                }
            });
        });

        const badge = $('quoteSelectedItemCountBadge');
        if (badge) {
            badge.classList.remove('d-none');
            badge.innerText = `선택 ${selected}개 / 전체 ${total}개`;
        }
        const modalSel = $('modalPrintSelectedCount');
        if (modalSel) modalSel.innerText = selected;
        const modalTot = $('modalPrintTotalCount');
        if (modalTot) modalTot.innerText = total;
    },

    openPrintOptionModal: function(singleSecId = null) {
        this.printTargetSecId = singleSecId;
        this.printArchiveData = null; // 작업대 인쇄 모드로 초기화

        // 인쇄 범위 라디오 버튼 작업대 모드로 복원
        if ($('printScopeSelected')) {
            $('printScopeSelected').disabled = false;
            $('printScopeSelected').checked = true;
        }
        if ($('printScopeAll')) {
            $('printScopeAll').disabled = false;
        }

        this.updateQuoteSelectionBadges();
        this.loadPrintColumnSettings();
        this.updatePrintPresetUI();

        const modalTitle = $('printOptionModalLabel');
        if (modalTitle) {
            if (singleSecId) {
                const sec = (this.quoteSections || []).find(s => s.id === singleSecId);
                modalTitle.innerHTML = `<i class='bx bx-printer text-primary me-1'></i> [${sec ? escapeHtml(sec.section_name) : ''}] 섹션 인쇄 맞춤 설정`;
            } else {
                modalTitle.innerHTML = `<i class='bx bx-printer text-primary me-1'></i> 견적 비교 보고서 인쇄 맞춤 설정 (작업대 대상)`;
            }
        }

        if (!this.printOptionModalInstance && window.bootstrap) {
            this.printOptionModalInstance = new bootstrap.Modal($('printOptionModal'));
        }
        if (this.printOptionModalInstance) {
            this.printOptionModalInstance.show();
        }
    },

    openArchivePrintOptionModal: function(project, sections) {
        this.printTargetSecId = null;
        this.printArchiveData = { project, sections }; // 보관함 인쇄 모드로 데이터 기억

        // 보관함 내 전체 품목 수 계산
        let totalItems = 0;
        (sections || []).forEach(sec => {
            totalItems += (sec.items || []).length;
        });

        // 인쇄 범위: 보관함 문서는 전체 출력으로 지정
        if ($('printScopeAll')) {
            $('printScopeAll').disabled = false;
            $('printScopeAll').checked = true;
        }
        if ($('printScopeSelected')) {
            $('printScopeSelected').disabled = true;
        }
        if ($('modalPrintTotalCount')) $('modalPrintTotalCount').innerText = totalItems;
        if ($('modalPrintSelectedCount')) $('modalPrintSelectedCount').innerText = totalItems;

        this.loadPrintColumnSettings();
        this.updatePrintPresetUI();

        const modalTitle = $('printOptionModalLabel');
        if (modalTitle) {
            modalTitle.innerHTML = `<i class='bx bx-printer text-success me-1'></i> [보관함: ${escapeHtml(project.title || '검토서')}] 인쇄 맞춤 설정`;
        }

        if (!this.printOptionModalInstance && window.bootstrap) {
            this.printOptionModalInstance = new bootstrap.Modal($('printOptionModal'));
        }
        if (this.printOptionModalInstance) {
            this.printOptionModalInstance.show();
        }
    },

    applyPrintPreset: function(preset) {
        if (preset === 'external') {
            // 구매/대외 발주용: 마진 숨김
            if ($('chkPrintSupplier')) $('chkPrintSupplier').checked = true;
            if ($('chkPrintBuyPrice')) $('chkPrintBuyPrice').checked = true;
            if ($('chkPrintNormPrice')) $('chkPrintNormPrice').checked = true;
            if ($('chkPrintFreight')) $('chkPrintFreight').checked = true;
            if ($('chkPrintMargin')) $('chkPrintMargin').checked = false;
            if ($('chkPrintNote')) $('chkPrintNote').checked = true;
            if ($('chkPrintOpinion')) $('chkPrintOpinion').checked = true;
        } else if (preset === 'internal') {
            // 내부 경영진 결재용: 마진 포함 전체 항목 표시
            if ($('chkPrintSupplier')) $('chkPrintSupplier').checked = true;
            if ($('chkPrintBuyPrice')) $('chkPrintBuyPrice').checked = true;
            if ($('chkPrintNormPrice')) $('chkPrintNormPrice').checked = true;
            if ($('chkPrintFreight')) $('chkPrintFreight').checked = true;
            if ($('chkPrintMargin')) $('chkPrintMargin').checked = true;
            if ($('chkPrintNote')) $('chkPrintNote').checked = true;
            if ($('chkPrintOpinion')) $('chkPrintOpinion').checked = true;
        }
        this.updatePrintPresetUI();
        this.savePrintColumnSettings();
    },

    onPrintColumnChange: function() {
        this.updatePrintPresetUI();
        this.savePrintColumnSettings();
    },

    updatePrintPresetUI: function() {
        const marginChecked = $('chkPrintMargin') ? $('chkPrintMargin').checked : false;
        const suppChecked = $('chkPrintSupplier') ? $('chkPrintSupplier').checked : true;
        const buyChecked = $('chkPrintBuyPrice') ? $('chkPrintBuyPrice').checked : true;
        const normChecked = $('chkPrintNormPrice') ? $('chkPrintNormPrice').checked : true;
        const freightChecked = $('chkPrintFreight') ? $('chkPrintFreight').checked : true;
        const noteChecked = $('chkPrintNote') ? $('chkPrintNote').checked : true;
        const opinionChecked = $('chkPrintOpinion') ? $('chkPrintOpinion').checked : true;

        const btnExt = $('btnPrintPresetExternal');
        const btnInt = $('btnPrintPresetInternal');
        const statusBadge = $('printPresetStatusBadge');

        const isExternal = !marginChecked && suppChecked && buyChecked && normChecked && freightChecked && noteChecked && opinionChecked;
        const isInternal = marginChecked && suppChecked && buyChecked && normChecked && freightChecked && noteChecked && opinionChecked;

        if (btnExt) {
            if (isExternal) {
                btnExt.classList.add('active');
                const icon = btnExt.querySelector('.preset-icon');
                if (icon) icon.className = 'bx bx-check-circle fs-6 preset-icon';
            } else {
                btnExt.classList.remove('active');
                const icon = btnExt.querySelector('.preset-icon');
                if (icon) icon.className = 'bx bx-shield-quarter preset-icon';
            }
        }

        if (btnInt) {
            if (isInternal) {
                btnInt.classList.add('active');
                const icon = btnInt.querySelector('.preset-icon');
                if (icon) icon.className = 'bx bx-check-circle fs-6 preset-icon';
            } else {
                btnInt.classList.remove('active');
                const icon = btnInt.querySelector('.preset-icon');
                if (icon) icon.className = 'bx bx-briefcase-alt preset-icon';
            }
        }

        if (statusBadge) {
            if (isExternal) {
                statusBadge.className = 'badge bg-success-subtle text-success border border-success-subtle fw-semibold';
                statusBadge.innerHTML = `<i class='bx bx-check me-1'></i>구매/대외 발주용 적용 중`;
            } else if (isInternal) {
                statusBadge.className = 'badge bg-primary-subtle text-primary border border-primary-subtle fw-semibold';
                statusBadge.innerHTML = `<i class='bx bx-check me-1'></i>경영진 결재용 적용 중`;
            } else {
                statusBadge.className = 'badge bg-light text-secondary border fw-normal';
                statusBadge.innerHTML = `<i class='bx bx-slider me-1'></i>직접 사용자 지정`;
            }
        }
    },

    savePrintColumnSettings: function() {
        const settings = {
            supplier: $('chkPrintSupplier') ? $('chkPrintSupplier').checked : true,
            buyPrice: $('chkPrintBuyPrice') ? $('chkPrintBuyPrice').checked : true,
            normPrice: $('chkPrintNormPrice') ? $('chkPrintNormPrice').checked : true,
            freight: $('chkPrintFreight') ? $('chkPrintFreight').checked : true,
            margin: $('chkPrintMargin') ? $('chkPrintMargin').checked : false,
            note: $('chkPrintNote') ? $('chkPrintNote').checked : true,
            opinion: $('chkPrintOpinion') ? $('chkPrintOpinion').checked : true
        };
        try {
            localStorage.setItem('kng_quote_print_columns', JSON.stringify(settings));
        } catch (e) {}
    },

    loadPrintColumnSettings: function() {
        try {
            const saved = localStorage.getItem('kng_quote_print_columns');
            if (saved) {
                const s = JSON.parse(saved);
                if ($('chkPrintSupplier')) $('chkPrintSupplier').checked = s.supplier !== false;
                if ($('chkPrintBuyPrice')) $('chkPrintBuyPrice').checked = s.buyPrice !== false;
                if ($('chkPrintNormPrice')) $('chkPrintNormPrice').checked = s.normPrice !== false;
                if ($('chkPrintFreight')) $('chkPrintFreight').checked = s.freight !== false;
                if ($('chkPrintMargin')) $('chkPrintMargin').checked = Boolean(s.margin);
                if ($('chkPrintNote')) $('chkPrintNote').checked = s.note !== false;
                if ($('chkPrintOpinion')) $('chkPrintOpinion').checked = s.opinion !== false;
                return;
            }
        } catch (e) {}

        // 기본값: 마진은 보안 차원에서 체크 해제
        if ($('chkPrintMargin')) $('chkPrintMargin').checked = false;
    },

    executePrintReport: function() {
        this.savePrintColumnSettings();
        const scope = document.querySelector('input[name="printScope"]:checked')?.value || 'selected';
        const columns = {
            supplier: $('chkPrintSupplier') ? $('chkPrintSupplier').checked : true,
            buyPrice: $('chkPrintBuyPrice') ? $('chkPrintBuyPrice').checked : true,
            normPrice: $('chkPrintNormPrice') ? $('chkPrintNormPrice').checked : true,
            freight: $('chkPrintFreight') ? $('chkPrintFreight').checked : true,
            margin: $('chkPrintMargin') ? $('chkPrintMargin').checked : false,
            note: $('chkPrintNote') ? $('chkPrintNote').checked : true,
            opinion: $('chkPrintOpinion') ? $('chkPrintOpinion').checked : true
        };

        if (this.printOptionModalInstance) {
            this.printOptionModalInstance.hide();
        }

        if (this.printArchiveData) {
            const archiveData = this.printArchiveData;
            this.printArchiveData = null; // 인쇄 후 초기화
            this.printExecutiveReport({
                scope: 'all',
                columns: columns,
                customSections: archiveData.sections,
                customProject: archiveData.project
            });
        } else {
            this.printExecutiveReport({
                scope: scope,
                targetSecId: this.printTargetSecId,
                columns: columns
            });
        }
    },

    printExecutiveReportFromData: function(project, sections) {
        this.printExecutiveReport({
            scope: 'all',
            columns: {
                supplier: true,
                buyPrice: true,
                normPrice: true,
                freight: true,
                margin: false,
                note: true,
                opinion: true
            },
            customSections: sections,
            customProject: project
        });
    },

    printExecutiveReport: function(options = {}) {
        const sectionsSource = (options.customSections && options.customSections.length > 0)
            ? options.customSections
            : this.quoteSections;

        if (!sectionsSource || sectionsSource.length === 0) {
            alert('인쇄할 견적 비교 섹션이 없습니다.');
            return;
        }

        const printArea = $('printArea');
        if (!printArea) return;

        const scope = options.scope || 'selected';
        const targetSecId = options.targetSecId || null;
        const cols = options.columns || {
            supplier: true,
            buyPrice: true,
            normPrice: true,
            freight: true,
            margin: false,
            note: true,
            opinion: true
        };

        const today = new Date().toISOString().split('T')[0];

        let sectionsToPrint = sectionsSource;
        if (targetSecId) {
            sectionsToPrint = sectionsSource.filter(s => s.id === targetSecId);
        }

        let sectionsHtml = '';
        let validSectionsCount = 0;
        let totalPrintedItemCount = 0;
        const executiveSummaryItems = [];

        sectionsToPrint.forEach((sec, idx) => {
            let items = sec.items || [];
            if (items.length === 0) return;

            // 선택 항목 필터링 (보관함 독립 인쇄 시 전체 품목 포함)
            if (scope === 'selected' && !options.customSections) {
                items = items.filter(it => !this.quoteSelectionMap || this.quoteSelectionMap[it.id] !== false);
            }
            if (items.length === 0) return; // 선택된 항목이 없으면 섹션 제외

            const benchmarks = this.getSectionBenchmarks(sec);

            validSectionsCount++;
            totalPrintedItemCount += items.length;

            // 외화 정보 누락 보정 (unit_price_id로 마스터 단가표 priceList 매핑)
            const analyzed = items.map(it => {
                let curr = it.currency || 'KRW';
                let exRate = parseFloat(it.exchange_rate) || 1.0;
                let fBuy = parseFloat(it.foreign_buy_price) || 0;
                let fSell = parseFloat(it.foreign_sell_price) || 0;
                let pt = it.price_type || '견적가';
                let freightType = it.freight_type || (it.is_freight_included ? '하차도' : '상차도');
                let freightRegion = it.freight_region || '';

                if ((!fBuy || curr === 'KRW') && it.unit_price_id && Array.isArray(this.priceList)) {
                    const master = this.priceList.find(p => p.id === it.unit_price_id);
                    if (master) {
                        if (master.currency && master.currency !== 'KRW') {
                            curr = master.currency;
                            exRate = parseFloat(master.exchange_rate) || exRate;
                            fBuy = parseFloat(master.foreign_buy_price) || fBuy;
                            fSell = parseFloat(master.foreign_sell_price) || fSell;
                        }
                        if (master.price_type) pt = master.price_type;
                        if (master.freight_type) freightType = master.freight_type;
                        if (master.freight_region) freightRegion = master.freight_region;
                    }
                }

                const norm = this.parseUnitNormalize(it.spec, it.buy_price);
                return {
                    ...it,
                    currency: curr,
                    exchange_rate: exRate,
                    foreign_buy_price: fBuy,
                    foreign_sell_price: fSell,
                    price_type: pt,
                    freight_type: freightType,
                    freight_region: freightRegion,
                    norm: norm
                };
            });

            // 공통 단위 판단 및 단위단가 기준 최저가순 오름차순 정렬
            const normUnits = analyzed.filter(it => it.norm && it.norm.unit).map(it => it.norm.unit);
            const commonUnit = (normUnits.length > 0 && normUnits.length === analyzed.length && normUnits.every(u => u === normUnits[0]))
                ? normUnits[0]
                : null;

            // 오름차순 정렬: 단위단가(normPrice) 기준 최저가부터 점점 비싸지는 순서로 배치
            analyzed.sort((a, b) => {
                const priceA = (commonUnit && a.norm && a.norm.normPrice > 0) ? a.norm.normPrice : (a.buy_price || Infinity);
                const priceB = (commonUnit && b.norm && b.norm.normPrice > 0) ? b.norm.normPrice : (b.buy_price || Infinity);
                return priceA - priceB;
            });

            // 1위 최저가 품목 도출 (요약표 및 강조용)
            const bestItem = analyzed[0];
            if (bestItem) {
                executiveSummaryItems.push({
                    secIdx: validSectionsCount,
                    sectionName: sec.section_name,
                    benchmarks: benchmarks,
                    item: bestItem,
                    commonUnit: commonUnit
                });
            }

            let benchmarkRowHtml = '';
            if (benchmarks.length > 0) {
                benchmarkRowHtml = benchmarks.map((bm, bIdx) => {
                    const badgeText = benchmarks.length === 1 ? '기준' : `기준 ${bIdx + 1}`;
                    const itemBadgeText = benchmarks.length === 1 ? '설계기준품' : `설계기준품 #${bIdx + 1}`;
                    return `
                        <tr style="background-color: #f1f5f9; border-top: 1.5px solid #0f172a; border-bottom: 2px solid #94a3b8; font-weight: 600; color: #1e293b;">
                            <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px;">
                                <span style="display: inline-block; padding: 1px 5px; background: #1e293b; color: #ffffff; border-radius: 2px; font-size: 7.5pt; font-weight: bold;">${badgeText}</span>
                            </td>
                            ${cols.supplier ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; color: #94a3b8;">-</td>` : ''}
                            <td style="text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1;">
                                <span style="color: #2563eb; margin-right: 3px;">■</span>${escapeHtml(this.formatBenchmarkItem(bm))}
                                <span style="display: inline-block; margin-left: 4px; padding: 1px 4px; background: #e0e7ff; color: #3730a3; border-radius: 2px; font-size: 7pt; font-weight: bold;">${itemBadgeText}</span>
                            </td>
                            <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px;">
                                <span style="display: inline-block; padding: 1px 5px; background: #e2e8f0; color: #0f172a; border-radius: 2px; font-weight: bold;">${escapeHtml(bm.spec || '-')}</span>
                            </td>
                            ${cols.freight ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; color: #64748b;">-</td>` : ''}
                            ${cols.buyPrice ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1; color: #64748b; font-size: 8pt;">(대조 기준)</td>` : ''}
                            ${cols.normPrice ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1; color: #64748b;">-</td>` : ''}
                            ${cols.margin ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1; color: #64748b;">-</td>` : ''}
                            ${cols.note ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; color: #64748b; font-size: 8pt; font-style: italic;">권장 규격품 (대조 기준)</td>` : ''}
                        </tr>
                    `;
                }).join('');
            }

            let rows = benchmarkRowHtml;
            analyzed.forEach((it, cIdx) => {
                const isBest = (cIdx === 0) && analyzed.length > 1;
                const buy = it.buy_price || 0;
                const sell = it.sell_price || 0;
                const marginAmt = (sell > 0 && buy > 0) ? (sell - buy) : 0;
                const marginRate = (sell > 0 && buy > 0) ? Math.round(((sell - buy) / sell) * 1000) / 10 : 0;
                
                const isFreightIn = (it.freight_type === '하차도') || it.is_freight_included === 1 || it.is_freight_included === true;
                const freightStr = isFreightIn 
                    ? `하차도${it.freight_region ? ` (${escapeHtml(it.freight_region)})` : ''}` 
                    : '상차도';

                const isForeign = it.currency && it.currency !== 'KRW';
                const currSym = this.currencySymbols[it.currency] || '$';

                let buyStr = buy ? `₩${buy.toLocaleString()}` : '-';
                if (isForeign && it.foreign_buy_price > 0) {
                    buyStr = `<div style="font-weight: 700;">${currSym}${parseFloat(it.foreign_buy_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div><div style="font-size: 8pt; color: #475569;">(₩${buy.toLocaleString()} @${it.exchange_rate ? it.exchange_rate.toLocaleString() : '-'})</div>`;
                }

                let normStr = '-';
                if (it.norm) {
                    normStr = `₩${it.norm.normPrice.toLocaleString()}/${it.norm.unit}`;
                    if (commonUnit && !isBest && bestItem && bestItem.norm && it.norm.normPrice > bestItem.norm.normPrice) {
                        const diffPct = Math.round(((it.norm.normPrice - bestItem.norm.normPrice) / bestItem.norm.normPrice) * 1000) / 10;
                        normStr += ` <span style="color: #dc2626; font-size: 8pt; font-weight: normal;">(+${diffPct}%)</span>`;
                    }
                }

                // 1번 최저가 행은 굵은 테두리(2px) 및 은은한 그린 배경으로 강조
                const bestRowStyle = isBest 
                    ? 'background-color: #f0fdf4; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; font-weight: bold;' 
                    : '';

                rows += `
                    <tr style="${bestRowStyle}">
                        <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; ${isBest ? 'border-left: 2px solid #0f172a;' : ''}">${cIdx + 1}</td>
                        ${cols.supplier ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px;">${escapeHtml(it.default_supplier || '-')}</td>` : ''}
                        <td style="text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1;">${escapeHtml(it.item)}</td>
                        <td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px;">${escapeHtml(it.spec || '-')}</td>
                        ${cols.freight ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px;">${freightStr}</td>` : ''}
                        ${cols.buyPrice ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1;">${buyStr}</td>` : ''}
                        ${cols.normPrice ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1; ${isBest ? 'color: #047857;' : ''}">${normStr}</td>` : ''}
                        ${cols.margin ? `<td style="text-align: right; padding: 6px 8px; border: 1px solid #cbd5e1;">${(sell > 0 && buy > 0) ? `₩${marginAmt.toLocaleString()} (${marginRate}%)` : '-'}</td>` : ''}
                        ${cols.note ? `<td style="text-align: center; border: 1px solid #cbd5e1; padding: 6px 4px; ${isBest ? 'border-right: 2px solid #0f172a;' : ''}">${escapeHtml(it.note || '-')}</td>` : ''}
                    </tr>
                `;
            });

            sectionsHtml += `
                <div class="print-quote-section" style="margin-bottom: 22px; page-break-inside: avoid;">
                    <div style="background: #0f172a; color: #ffffff; padding: 6px 12px; border-radius: 2px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-weight: 800; font-size: 10.5pt;">■ ${idx + 1}. ${escapeHtml(sec.section_name)} (${items.length}개 비교)</span>
                        ${benchmarks.length > 0 ? `
                            <span style="font-size: 8.5pt; background: rgba(255, 255, 255, 0.18); padding: 2px 8px; border-radius: 3px; font-weight: 600; letter-spacing: -0.2px;">
                                기준품 (${benchmarks.length}개): ${benchmarks.map((bm, bIdx) => `${benchmarks.length > 1 ? `#${bIdx + 1} ` : ''}${escapeHtml(this.formatBenchmarkItem(bm))}${bm.spec ? ` (${escapeHtml(bm.spec)})` : ''}`).join(' / ')}
                            </span>
                        ` : ''}
                    </div>

                    <table class="print-quote-table" style="width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 9pt;">
                        <thead>
                            <tr style="background: #f1f5f9; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; font-weight: bold;">
                                <th style="width: 48px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">순번</th>
                                ${cols.supplier ? '<th style="width: 115px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">공급업체</th>' : ''}
                                <th style="border: 1px solid #cbd5e1; padding: 6px 6px; text-align: center;">품목명</th>
                                <th style="width: 105px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">규격</th>
                                ${cols.freight ? '<th style="width: 95px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">운임조건</th>' : ''}
                                ${cols.buyPrice ? '<th style="width: 130px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">매입단가(환율)</th>' : ''}
                                ${cols.normPrice ? '<th style="width: 130px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">단위단가(최저가대비)</th>' : ''}
                                ${cols.margin ? '<th style="width: 100px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">마진액(마진율)</th>' : ''}
                                ${cols.note ? '<th style="width: 120px; border: 1px solid #cbd5e1; padding: 6px 4px; text-align: center;">비고</th>' : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${rows}
                        </tbody>
                    </table>

                    ${cols.opinion ? `
                        <div style="margin-top: 5px; padding: 6px 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-left: 4px solid #2563eb; font-size: 8.5pt;">
                            <strong style="color: #1e293b;">※ 담당자 검토 의견:</strong>
                            <span style="color: #334155; margin-left: 6px;">${escapeHtml(sec.section_note || '-(별도 기재 의견 없음)-')}</span>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        if (validSectionsCount === 0) {
            alert('인쇄할 선택 품목이 없습니다. 최소 1개 이상의 품목을 체크해주세요.');
            return;
        }

        // 최상단 품목별 최저가 추천 종합 요약표 (Executive Summary) 렌더링
        let summaryTableHtml = '';
        if (executiveSummaryItems.length > 0) {
            let summaryRows = '';
            executiveSummaryItems.forEach((sum, sIdx) => {
                const it = sum.item;
                const buy = it.buy_price || 0;
                const isForeign = it.currency && it.currency !== 'KRW';
                const currSym = this.currencySymbols[it.currency] || '$';
                let buyStr = buy ? `₩${buy.toLocaleString()}` : '-';
                if (isForeign && it.foreign_buy_price > 0) {
                    buyStr = `<strong>${currSym}${parseFloat(it.foreign_buy_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong> <span style="font-size: 8pt; color: #475569;">(₩${buy.toLocaleString()} @${it.exchange_rate ? it.exchange_rate.toLocaleString() : '-'})</span>`;
                }

                let normStr = it.norm ? `₩${it.norm.normPrice.toLocaleString()}/${it.norm.unit}` : '-';
                const isFreightIn = (it.freight_type === '하차도') || it.is_freight_included === 1 || it.is_freight_included === true;
                const freightStr = isFreightIn 
                    ? `하차도${it.freight_region ? ` (${escapeHtml(it.freight_region)})` : ''}` 
                    : '상차도';

                summaryRows += `
                    <tr style="border-bottom: 1px solid #cbd5e1; background-color: ${sIdx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                        <td style="text-align: center; padding: 5px; border: 1px solid #cbd5e1; font-weight: bold;">${sIdx + 1}</td>
                        <td style="text-align: left; padding: 5px 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #0f172a;">
                            ${escapeHtml(sum.sectionName)}
                            ${(sum.benchmarks && sum.benchmarks.length > 0) ? sum.benchmarks.map((bm, bIdx) => `
                                <div style="font-size: 7.5pt; color: #475569; font-weight: 500; margin-top: 2px;">
                                    <span style="display: inline-block; padding: 1px 4px; background: #e2e8f0; color: #1e293b; border-radius: 2px; font-size: 7pt; font-weight: bold;">${sum.benchmarks.length === 1 ? '기준' : `기준 ${bIdx + 1}`}</span>
                                    ${escapeHtml(this.formatBenchmarkItem(bm))}${bm.spec ? ` (${escapeHtml(bm.spec)})` : ''}
                                </div>
                            `).join('') : ''}
                        </td>
                        <td style="text-align: center; padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(it.default_supplier || '-')}</td>
                        <td style="text-align: left; padding: 5px 8px; border: 1px solid #cbd5e1; color: #047857; font-weight: bold;">${escapeHtml(it.item)}</td>
                        <td style="text-align: center; padding: 5px; border: 1px solid #cbd5e1;">${escapeHtml(it.spec || '-')}</td>
                        <td style="text-align: center; padding: 5px; border: 1px solid #cbd5e1;">${freightStr}</td>
                        <td style="text-align: right; padding: 5px 8px; border: 1px solid #cbd5e1;">${buyStr}</td>
                        <td style="text-align: right; padding: 5px 8px; border: 1px solid #cbd5e1; font-weight: bold; color: #047857;">${normStr}</td>
                        <td style="text-align: center; padding: 5px 6px; border: 1px solid #cbd5e1; color: #334155; font-size: 8.5pt;">${escapeHtml(it.note || '-')}</td>
                    </tr>
                `;
            });

            summaryTableHtml = `
                <div class="print-summary-box" style="margin-bottom: 22px; border: 1.5px solid #059669; border-radius: 3px; background: #ffffff; padding: 8px 10px; page-break-inside: avoid;">
                    <div style="font-size: 10.5pt; font-weight: 800; color: #065f46; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                        <span>■ 품목별 최저가 추천 종합 요약</span>
                        <span style="font-size: 8.5pt; font-weight: normal; color: #047857;">* 각 비교군별 단위단가 기준 1위 최저단가 품목</span>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 8.5pt;">
                        <thead>
                            <tr style="background: #ecfdf5; border-top: 1.5px solid #059669; border-bottom: 1.5px solid #059669; color: #065f46; font-weight: bold;">
                                <th style="width: 40px; padding: 5px; border: 1px solid #cbd5e1; text-align: center;">순번</th>
                                <th style="width: 135px; padding: 5px 8px; border: 1px solid #cbd5e1; text-align: center;">비교 품목군</th>
                                <th style="width: 110px; padding: 5px; border: 1px solid #cbd5e1; text-align: center;">공급업체</th>
                                <th style="padding: 5px 8px; border: 1px solid #cbd5e1; text-align: center;">추천 선정 품목</th>
                                <th style="width: 85px; padding: 5px; border: 1px solid #cbd5e1; text-align: center;">규격</th>
                                <th style="width: 85px; padding: 5px; border: 1px solid #cbd5e1; text-align: center;">운임조건</th>
                                <th style="width: 130px; padding: 5px 8px; border: 1px solid #cbd5e1; text-align: center;">매입단가(환율)</th>
                                <th style="width: 125px; padding: 5px 8px; border: 1px solid #cbd5e1; text-align: center;">단위단가(최저)</th>
                                <th style="width: 135px; padding: 5px 8px; border: 1px solid #cbd5e1; text-align: center;">비고</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${summaryRows}
                        </tbody>
                    </table>
                </div>
            `;
        }

        const activeProject = options.customProject || this.currentProject;
        const reportTitle = (activeProject && activeProject.title) ? escapeHtml(activeProject.title) : '자재 구매 단가 비교 검토';
        const reportDate = (activeProject && activeProject.doc_date) ? activeProject.doc_date.substring(0, 10) : today;

        printArea.innerHTML = `
            <div class="print-container" style="padding: 10px; font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;">
                <!-- 보고서 심플 헤더 (결재란 및 문서번호 삭제) -->
                <div class="report-header-wrap" style="border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 16px;">
                    <h1 style="margin: 0 0 6px 0; font-size: 21pt; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; text-align: center;">${reportTitle}</h1>
                    <div style="font-size: 9.5pt; color: #475569; text-align: center;">
                        <strong>보고일자:</strong> ${reportDate} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>대상:</strong> 총 ${validSectionsCount}개 품목 (${totalPrintedItemCount}개 규격)
                        ${activeProject?.memo ? `<div style="font-size: 8.5pt; color: #64748b; margin-top: 3px;">※ ${escapeHtml(activeProject.memo)}</div>` : ''}
                    </div>
                </div>

                <!-- 1. 최상단 품목별 최저가 추천 종합 요약표 (Executive Summary) -->
                ${summaryTableHtml}

                <!-- 2. 세부 비교 품목 테이블 목록 -->
                ${sectionsHtml}
        `;

        window.print();
    },

    printSingleSection: function(sectionId) {
        this.openPrintOptionModal(sectionId);
    }
};

window.app = app;
window.unitPriceApp = app;

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
