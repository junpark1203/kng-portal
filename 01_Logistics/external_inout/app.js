/**
 * 외부입출내역 (External Logistics) ECOUNT ERP 고도화 프론트엔드 모듈
 * - ECOUNT ERP 초고밀도 그리드 및 콤팩트 리본 툴바 동기화
 * - 전표형 고속 스프레드시트 모달 (Zero-Mouse Keyboard First)
 * - 엑셀 블록 복사/붙여넣기 딥 파서 (Ctrl+V)
 * - 최근 거래 단가/규격 스마트 메모리 자동완성 엔진
 * - 메인 그리드 더블클릭 인라인 퀵 편집 (Direct Inline Edit)
 * - 열 너비 마우스 드래그 조절 & Auto-Fit
 * - 듀얼 탭 (내역 목록 ⇄ 통계 대시보드) & 실시간 집계
 */

const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://kng.junparks.com';

const API_BASE = `${SERVER_URL}/api/external-logistics`;
const PARTNERS_API = `${SERVER_URL}/api/partners`;

// ── Auth 헬퍼 (부모 창 Firebase 인증 토큰 동기화 대기) ──
let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent.getAuthToken) {
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

// JWT 토큰 기반 fetch 래퍼
async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && typeof window.parent.getAuthToken === 'function') {
            token = await window.parent.getAuthToken();
        }
    } catch (e) {
        console.warn('Parent token fetch failed:', e);
    }

    if (!token) {
        try {
            token = await waitForAuth();
        } catch (e) {}
    }

    if (!token) {
        try {
            token = localStorage.getItem('kng_token') || sessionStorage.getItem('kng_token');
        } catch (e) {}
    }

    if (!options.headers) options.headers = {};
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

// Format utilities
const fmtNumber = (n) => (n !== undefined && n !== null && !isNaN(n)) ? Number(n).toLocaleString() : '0';
const fmtWon = (n) => `${fmtNumber(Math.round(n || 0))}원`;

const app = {
    currentTab: 'list', // 'list' | 'dashboard'
    currentSort: { col: 'date', dir: 'desc' },
    pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
    selectedIds: new Set(),
    partnersList: [],
    itemSuggestions: [],
    categories: ['안전자재', '토목자재', '보양재', '소모품', '일반자재'],
    sheetModal: null,
    uploadModal: null,
    specDetailModal: null,
    modalDetailData: [],
    modalCurrentItem: '',
    modalCurrentSpec: '',

    // 스마트 다중 조건 검색 (AND 결합 필터)
    activeFilters: {},

    // 대시보드 순위 테이블 정렬 및 캐시 상태
    dashboardSort: { col: 'totalSupplyAmount', dir: 'desc' },
    dashboardDataCache: { specs: [], totalQty: 0, totalSupply: 0 },

    // Chart instances
    topAmountChartInstance: null,
    topQtyChartInstance: null,
    monthlyChartInstance: null,
    dashChart2Mode: 'qty',

    // 초기화
    init: async function() {
        // Bootstrap 모달 객체 초기화
        const sheetModalEl = document.getElementById('sheetVoucherModal');
        if (sheetModalEl) this.sheetModal = new bootstrap.Modal(sheetModalEl);

        const uploadModalEl = document.getElementById('uploadModal');
        if (uploadModalEl) this.uploadModal = new bootstrap.Modal(uploadModalEl);

        const specDetailModalEl = document.getElementById('specDetailModal');
        if (specDetailModalEl) this.specDetailModal = new bootstrap.Modal(specDetailModalEl);

        // 기본 날짜 설정 (전체)
        this.setDatePreset('all');

        // 거래처, 품목 추천, 자재 분류 데이터 사전 로드
        this.loadPartners();
        this.loadItemSuggestions();
        this.loadCategories();

        // 자동완성 이벤트 바인딩
        this.setupAutocompletes();

        // 단축키 이벤트 (F2: 전표등록, F3: 행추가, F9/Ctrl+S: 저장)
        this.setupGlobalShortcuts();

        // 목록 조회
        await this.loadList();

        // 테이블 열 너비 조절 및 자동맞춤 초기화
        this.initColResize();
    },

    // -------------------------------------------------------------------------
    // 글로벌 단축키 바인딩
    // -------------------------------------------------------------------------
    setupGlobalShortcuts: function() {
        document.addEventListener('keydown', (e) => {
            // F2: 전표 등록 모달 열기
            if (e.key === 'F2') {
                e.preventDefault();
                this.openSheetModal();
                return;
            }

            // 전표 모달 내부 단축키
            const sheetModalEl = document.getElementById('sheetVoucherModal');
            const isModalOpen = sheetModalEl && sheetModalEl.classList.contains('show');

            if (isModalOpen) {
                // F3: 새 행 추가
                if (e.key === 'F3') {
                    e.preventDefault();
                    this.addSheetRow();
                    return;
                }
                // F9 또는 Ctrl+S: 전표 저장
                if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 's')) {
                    e.preventDefault();
                    this.submitSheetVoucher();
                    return;
                }
            }
        });

        // 인쇄 헤더 및 하단 합계행(tfoot) 자동 갱신 리스너
        window.addEventListener('beforeprint', () => {
            this.preparePrint();
        });
    },

    // -------------------------------------------------------------------------
    // 인쇄 전 데이터 메타정보 및 tfoot 합계행 사전 계산
    // -------------------------------------------------------------------------
    preparePrint: function() {
        const now = new Date();
        const dateStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0');
        const printDateEl = document.getElementById('printDateStr');
        if (printDateEl) printDateEl.textContent = dateStr;

        const start = document.getElementById('filterStartDate')?.value || '';
        const end = document.getElementById('filterEndDate')?.value || '';
        const printPeriodEl = document.getElementById('printPeriodStr');
        if (printPeriodEl) {
            printPeriodEl.textContent = (start || end) ? `${start || '처음'} ~ ${end || '현재'}` : '전체 기간';
        }

        const printFilterEl = document.getElementById('printFilterStr');
        if (printFilterEl) {
            const cat = this.currentCategory || '전체';
            let filterArr = [`분류: ${cat}`];
            if (this.activeFilters) {
                Object.entries(this.activeFilters).forEach(([k, v]) => {
                    if (v && String(v).trim()) {
                        const labelMap = { supplier: '공급처', destination: '출고처', item: '품목', spec: '규격', voucher_id: '전표' };
                        filterArr.push(`${labelMap[k] || k}: ${v}`);
                    }
                });
            }
            const subKw = document.getElementById('subSearchInput')?.value.trim();
            if (subKw) filterArr.push(`결과내: ${subKw}`);
            printFilterEl.textContent = filterArr.join(' | ');
        }

        const titleEl = document.getElementById('printMainTitle');
        if (titleEl) {
            titleEl.textContent = this.currentTab === 'dashboard'
                ? '입 출 통 계 대 시 보 드 (외 부 건)'
                : '입 출 내 역 (외 부 건)';
        }

        // 출력 데이터 요약 및 tfoot 계산
        const printCountEl = document.getElementById('printCountStr');
        const printSupplyEl = document.getElementById('printSupplyStr');
        const printVatEl = document.getElementById('printVatStr');
        const printTotalEl = document.getElementById('printTotalStr');

        if (this.currentTab === 'dashboard' && this.dashboardSummary) {
            const s = this.dashboardSummary;
            if (printCountEl) printCountEl.textContent = `${fmtNumber(s.total_count || 0)}건`;
            if (printSupplyEl) printSupplyEl.textContent = `${fmtNumber(s.total_supply_amount || 0)}원`;
            if (printVatEl) printVatEl.textContent = `${fmtNumber(s.total_vat || 0)}원`;
            if (printTotalEl) printTotalEl.textContent = `${fmtNumber(s.total_amount || 0)}원`;
        } else {
            const rows = this.renderedRows || this.currentData || [];
            const count = rows.length;
            const totalQty = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
            const totalSupply = rows.reduce((s, r) => s + (Number(r.supply_amount) || 0), 0);
            const totalVat = rows.reduce((s, r) => s + (Number(r.vat) || 0), 0);
            const totalAmount = rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);

            // 상단 헤더 요약 갱신
            if (printCountEl) printCountEl.textContent = `${fmtNumber(count)}건`;
            if (printSupplyEl) printSupplyEl.textContent = `${fmtNumber(totalSupply)}원`;
            if (printVatEl) printVatEl.textContent = `${fmtNumber(totalVat)}원`;
            if (printTotalEl) printTotalEl.textContent = `${fmtNumber(totalAmount)}원`;

            // 하단 tfoot 합계행 갱신
            const sumQtyEl = document.getElementById('printSumQty');
            if (sumQtyEl) sumQtyEl.textContent = fmtNumber(totalQty);
            const sumSupplyEl = document.getElementById('printSumSupply');
            if (sumSupplyEl) sumSupplyEl.textContent = fmtNumber(totalSupply);
            const sumVatEl = document.getElementById('printSumVat');
            if (sumVatEl) sumVatEl.textContent = fmtNumber(totalVat);
            const sumTotalEl = document.getElementById('printSumTotal');
            if (sumTotalEl) sumTotalEl.textContent = fmtNumber(totalAmount);
        }
    },

    printPage: function() {
        this.preparePrint();
        window.print();
    },

    // -------------------------------------------------------------------------
    // 탭 전환 (내역 목록 ⇄ 통계 대시보드)
    // -------------------------------------------------------------------------
    switchTab: function(tabName) {
        this.currentTab = tabName;
        const btnList = document.getElementById('btnTabList');
        const btnDash = document.getElementById('btnTabDashboard');
        const viewList = document.getElementById('tabListView');
        const viewDash = document.getElementById('tabDashboardView');

        if (tabName === 'list') {
            btnList.classList.add('active');
            btnDash.classList.remove('active');
            viewList.style.display = 'block';
            viewDash.style.display = 'none';
        } else {
            btnList.classList.remove('active');
            btnDash.classList.add('active');
            viewList.style.display = 'none';
            viewDash.style.display = 'block';
            this.loadDashboardData();
            setTimeout(() => {
                this.initTableColResize('dashboardSpecTable', 'kng_external_inout_dash_col_widths_v1');
            }, 100);
        }
    },

    // -------------------------------------------------------------------------
    // 자재 분류(카테고리) 동적 로드 및 탭/선택창 렌더링
    // -------------------------------------------------------------------------
    loadCategories: async function() {
        try {
            const res = await authFetch(`${API_BASE}/categories`);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    this.categories = data;
                    this.renderCategoryTabs();
                    this.renderCategoryDatalist();
                }
            }
        } catch (err) {
            console.warn('Load categories error:', err);
        }
    },

    renderCategoryTabs: function() {
        const group = document.getElementById('categoryTabGroup');
        if (!group) return;

        const current = this.currentCategory || '';
        let html = `<button type="button" class="erp-tab-btn ${current === '' ? 'active' : ''}" data-category="" onclick="app.setCategoryFilter('')">전체</button>`;

        (this.categories || []).forEach(cat => {
            const isActive = current === cat;
            html += `<button type="button" class="erp-tab-btn ${isActive ? 'active' : ''}" data-category="${cat}" onclick="app.setCategoryFilter('${cat}')">${cat}</button>`;
        });

        group.innerHTML = html;
    },

    renderCategoryDatalist: function() {
        const dl = document.getElementById('categoryDataList');
        if (!dl) return;
        dl.innerHTML = (this.categories || []).map(cat => `<option value="${cat}"></option>`).join('');
    },

    // 자재 분류 퀵 필터 탭
    setCategoryFilter: function(cat) {
        this.currentCategory = cat;
        const btns = document.querySelectorAll('#categoryTabGroup .erp-tab-btn');
        btns.forEach(b => {
            if (b.getAttribute('data-category') === cat) b.classList.add('active');
            else b.classList.remove('active');
        });
        this.currentCategory = cat;
        this.pagination.page = 1;
        this.loadList();
    },

    // -------------------------------------------------------------------------
    // 날짜 프리셋
    // -------------------------------------------------------------------------
    setDatePreset: function(preset) {
        const now = new Date();
        let start = '';
        let end = '';

        const y = now.getFullYear();
        const m = now.getMonth(); // 0-11
        const d = now.getDate();

        const formatDate = (dateObj) => {
            const year = dateObj.getFullYear();
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (preset === 'prevMonth') {
            const firstDay = new Date(y, m - 1, 1);
            const lastDay = new Date(y, m, 0);
            start = formatDate(firstDay);
            end = formatDate(lastDay);
        } else if (preset === 'thisMonth') {
            const firstDay = new Date(y, m, 1);
            const lastDay = new Date(y, m + 1, 0);
            start = formatDate(firstDay);
            end = formatDate(lastDay);
        } else if (preset === 'prevYear') {
            start = `${y - 1}-01-01`;
            end = `${y - 1}-12-31`;
        } else if (preset === 'thisYear') {
            start = `${y}-01-01`;
            end = `${y}-12-31`;
        } else if (preset === 'all') {
            start = '';
            end = '';
        }

        document.getElementById('filterStartDate').value = start;
        document.getElementById('filterEndDate').value = end;

        const presetBtns = document.querySelectorAll('.erp-preset-btn');
        presetBtns.forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.getElementById(`btnPreset_${preset}`);
        if (activeBtn) activeBtn.classList.add('active');

        this.pagination.page = 1;
        this.loadList();
    },

    onDateInputChange: function() {
        const presetBtns = document.querySelectorAll('.erp-preset-btn');
        presetBtns.forEach(btn => btn.classList.remove('active'));
        this.pagination.page = 1;
        this.loadList();
    },

    // -------------------------------------------------------------------------
    // 거래처 및 추천 품목 사전 로드
    // -------------------------------------------------------------------------
    loadPartners: async function() {
        try {
            const res = await authFetch(PARTNERS_API);
            if (res.ok) {
                const data = await res.json();
                this.partnersList = Array.isArray(data) ? data : (data.partners || []);
            }
        } catch (err) {
            console.warn('Partners load error:', err);
        }
    },

    loadItemSuggestions: async function() {
        try {
            const res = await authFetch(`${API_BASE}/suggestions/items`);
            if (res.ok) {
                this.itemSuggestions = await res.json();
            }
        } catch (err) {
            console.warn('Item suggestions load error:', err);
        }
    },

    // -------------------------------------------------------------------------
    // 자동완성 설정 (공급처, 출고처)
    // -------------------------------------------------------------------------
    setupAutocompletes: function() {
        const bindInput = (inputEl, dropdownEl, filterType) => {
            if (!inputEl || !dropdownEl) return;

            let debounceTimer = null;
            inputEl.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    const val = inputEl.value.trim().toLowerCase();
                    if (!val) {
                        dropdownEl.style.display = 'none';
                        return;
                    }
                    const matched = this.partnersList.filter(p => {
                        const name = (p.name || '').toLowerCase();
                        if (!name.includes(val)) return false;
                        if (filterType === 'supplier') return p.type === 'supplier' || p.type === 'both';
                        if (filterType === 'destination') return p.type === 'customer' || p.type === 'site' || p.type === 'both';
                        return true;
                    }).slice(0, 15);

                    if (matched.length === 0) {
                        dropdownEl.style.display = 'none';
                        return;
                    }

                    dropdownEl.innerHTML = matched.map(m => `
                        <div class="autocomplete-suggestion" data-name="${m.name}">
                            <strong>${m.name}</strong> <span class="text-muted" style="font-size:10.5px;">(${m.type || '거래처'})</span>
                        </div>
                    `).join('');
                    dropdownEl.style.display = 'block';
                }, 150);
            });

            dropdownEl.addEventListener('click', (e) => {
                const item = e.target.closest('.autocomplete-suggestion');
                if (item) {
                    inputEl.value = item.getAttribute('data-name');
                    dropdownEl.style.display = 'none';
                }
            });

            document.addEventListener('click', (e) => {
                if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
                    dropdownEl.style.display = 'none';
                }
            });
        };

        bindInput(document.getElementById('sheetSupplier'), document.getElementById('sheetSupplierSuggestions'), 'supplier');
        bindInput(document.getElementById('sheetDestination'), document.getElementById('sheetDestSuggestions'), 'destination');
    },

    // -------------------------------------------------------------------------
    // 데이터 목록 조회 및 ECOUNT 고밀도 테이블 렌더링
    // -------------------------------------------------------------------------
    loadList: async function() {
        const tbody = document.getElementById('extTableBody');
        if (!tbody) return;

        tbody.innerHTML = `
            <tr>
                <td colspan="17" class="text-center py-4 text-muted">
                    <i class='bx bx-loader-alt bx-spin'></i> 데이터를 불러오는 중입니다...
                </td>
            </tr>
        `;

        try {
            const startDate = document.getElementById('filterStartDate').value;
            const endDate = document.getElementById('filterEndDate').value;
            const category = this.currentCategory || '';

            const params = new URLSearchParams({
                page: this.pagination.page,
                limit: this.pagination.limit,
                sortCol: this.currentSort.col,
                sortDir: this.currentSort.dir
            });

            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (category) params.append('category', category);

            // 누적된 활성 검색 필터 조건 (AND 결합)
            if (this.activeFilters) {
                Object.entries(this.activeFilters).forEach(([k, v]) => {
                    if (v && String(v).trim()) params.append(k, String(v).trim());
                });
            }

            // 검색창에 아직 엔터 치지 않은 미등록 검색어가 있는 경우 임시 반영
            const curSearchTarget = document.getElementById('searchTarget')?.value || 'keyword';
            const curKw = document.getElementById('historySearch')?.value.trim();
            if (curKw && (!this.activeFilters || !this.activeFilters[curSearchTarget])) {
                params.append(curSearchTarget, curKw);
            }

            const res = await authFetch(`${API_BASE}?${params.toString()}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || (res.status === 401 ? '인증 토큰 동기화 중입니다. 잠시 후 다시 시도해 주세요.' : `서버 응답 오류 (HTTP ${res.status})`));
            }

            const result = await res.json();
            this.currentData = result.data || [];
            this.pagination = result.pagination || this.pagination;

            // 결과 내 재검색 적용
            this.applySubSearch();

            // 상단 집계 요약 스트립 갱신
            this.updateSummaryStrip(result.summary || {});

            // 페이징 컨트롤 갱신
            this.renderPagination();

        } catch (err) {
            console.error('Load list error:', err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="17" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle'></i> 데이터를 불러오는 데 실패했습니다: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    // 결과 내 재검색 필터링
    applySubSearch: function() {
        const subInput = document.getElementById('subSearchInput');
        const badge = document.getElementById('subSearchCountBadge');
        const clearBtn = document.getElementById('clearSubSearchBtn');
        const subQuery = subInput ? subInput.value.trim().toLowerCase() : '';

        let filtered = this.currentData || [];
        if (subQuery) {
            filtered = filtered.filter(r => {
                const fullStr = `${r.date} ${r.voucher_id || ''} ${r.category} ${r.supplier} ${r.destination} ${r.item} ${r.spec} ${r.memo || ''}`.toLowerCase();
                return fullStr.includes(subQuery);
            });
            if (badge) {
                badge.textContent = `${filtered.length}건`;
                badge.classList.remove('d-none');
            }
            if (clearBtn) clearBtn.classList.remove('d-none');
        } else {
            if (badge) badge.classList.add('d-none');
            if (clearBtn) clearBtn.classList.add('d-none');
        }

        this.renderTableRows(filtered);
    },

    onSubSearchInput: function(val) {
        this.applySubSearch();
    },

    clearSubSearch: function() {
        const subInput = document.getElementById('subSearchInput');
        if (subInput) subInput.value = '';
        this.applySubSearch();
    },

    // 테이블 행 렌더링 (더블클릭 인라인 수정 지원)
    renderTableRows: function(rows) {
        this.renderedRows = rows || [];
        const tbody = document.getElementById('extTableBody');
        if (!tbody) return;

        if (!rows || rows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="17" class="text-center py-4 text-muted">
                        등록된 외부입출내역이 없습니다.
                    </td>
                </tr>
            `;
            return;
        }

        const startIndex = (this.pagination.page - 1) * this.pagination.limit;

        tbody.innerHTML = rows.map((r, idx) => {
            const isChecked = this.selectedIds.has(r.id);
            const rowNo = startIndex + idx + 1;
            const voucherBadge = r.voucher_id
                ? `<span class="badge bg-light text-primary border border-primary-subtle" style="font-size:10px; font-weight:normal;">${r.voucher_id}</span>`
                : `<span class="text-muted" style="font-size:10px;">${r.id}</span>`;

            return `
                <tr data-id="${r.id}" class="${isChecked ? 'is-selected' : ''}">
                    <td class="td-check">
                        <input type="checkbox" class="row-checkbox" value="${r.id}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectRow('${r.id}', this.checked)">
                    </td>
                    <td class="td-no text-muted">${rowNo}</td>
                    <td class="td-date is-inline-editable" ondblclick="app.startInlineEdit(this, '${r.id}', 'date')">${r.date}</td>
                    <td class="td-voucher">${voucherBadge}</td>
                    <td class="td-category is-inline-editable" ondblclick="app.startInlineEdit(this, '${r.id}', 'category')">${r.category || '일반자재'}</td>
                    <td class="td-supplier is-inline-editable fw-semibold" title="${r.supplier}" ondblclick="app.startInlineEdit(this, '${r.id}', 'supplier')">${r.supplier}</td>
                    <td class="td-destination is-inline-editable" title="${r.destination}" ondblclick="app.startInlineEdit(this, '${r.id}', 'destination')">${r.destination}</td>
                    <td class="td-item is-inline-editable text-primary fw-bold" title="${r.item}" ondblclick="app.startInlineEdit(this, '${r.id}', 'item')">${r.item}</td>
                    <td class="td-spec is-inline-editable" title="${r.spec}" ondblclick="app.startInlineEdit(this, '${r.id}', 'spec')">${r.spec}</td>
                    <td class="td-unit is-inline-editable text-center" ondblclick="app.startInlineEdit(this, '${r.id}', 'unit')">${r.unit || 'EA'}</td>
                    <td class="td-qty is-inline-editable text-end fw-bold" ondblclick="app.startInlineEdit(this, '${r.id}', 'qty')">${fmtNumber(r.qty)}</td>
                    <td class="td-price is-inline-editable text-end" ondblclick="app.startInlineEdit(this, '${r.id}', 'unit_price')">${fmtNumber(r.unit_price)}</td>
                    <td class="td-supply text-end">${fmtNumber(r.supply_amount)}</td>
                    <td class="td-vat text-end">${fmtNumber(r.vat)}</td>
                    <td class="td-total text-end fw-bold text-primary">${fmtNumber(r.total_amount)}</td>
                    <td class="td-memo is-inline-editable text-muted" title="${r.memo || ''}" ondblclick="app.startInlineEdit(this, '${r.id}', 'memo')">${r.memo || ''}</td>
                    <td class="td-action text-center">
                        <button type="button" class="btn-row-del" onclick="app.deleteSingleRow('${r.id}')" title="삭제">
                            <i class='bx bx-trash'></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // -------------------------------------------------------------------------
    // [핵심 기능 4] 메인 그리드 셀 더블클릭 인라인 퀵 편집 (Direct Inline Edit)
    // -------------------------------------------------------------------------
    startInlineEdit: function(tdEl, id, field) {
        if (tdEl.classList.contains('is-inline-editing')) return;

        const originalText = tdEl.textContent.trim().replace(/,/g, '');
        tdEl.classList.add('is-inline-editing');

        const input = document.createElement('input');
        input.type = (field === 'qty' || field === 'unit_price' || field === 'vat') ? 'number' : (field === 'date' ? 'date' : 'text');
        input.className = 'erp-inline-input';
        if (field === 'category') {
            input.setAttribute('list', 'categoryDataList');
        }
        if (field === 'qty' || field === 'unit_price' || field === 'vat') {
            input.classList.add('text-end');
            input.value = parseFloat(originalText) || 0;
        } else {
            input.value = originalText;
        }

        tdEl.innerHTML = '';
        tdEl.appendChild(input);
        input.focus();
        if (input.select) input.select();

        let isSaved = false;

        const saveChange = async () => {
            if (isSaved) return;
            isSaved = true;

            const newVal = input.value.trim();
            if (newVal === originalText) {
                tdEl.classList.remove('is-inline-editing');
                tdEl.textContent = (field === 'qty' || field === 'unit_price' || field === 'vat') ? fmtNumber(newVal) : newVal;
                return;
            }

            try {
                tdEl.innerHTML = `<i class='bx bx-loader-alt bx-spin text-muted'></i>`;
                const res = await authFetch(`${API_BASE}/${id}/inline`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ field, value: newVal })
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || '수정 실패');
                }

                const result = await res.json();
                const updated = result.record;

                // 해당 행의 데이터 갱신
                const tr = tdEl.closest('tr');
                if (tr && updated) {
                    tr.querySelector('.td-date').textContent = updated.date;
                    tr.querySelector('.td-category').textContent = updated.category;
                    tr.querySelector('.td-supplier').textContent = updated.supplier;
                    tr.querySelector('.td-destination').textContent = updated.destination;
                    tr.querySelector('.td-item').textContent = updated.item;
                    tr.querySelector('.td-spec').textContent = updated.spec;
                    tr.querySelector('.td-unit').textContent = updated.unit;
                    tr.querySelector('.td-qty').textContent = fmtNumber(updated.qty);
                    tr.querySelector('.td-price').textContent = fmtNumber(updated.unit_price);
                    tr.querySelector('.td-supply').textContent = fmtNumber(updated.supply_amount);
                    tr.querySelector('.td-vat').textContent = fmtNumber(updated.vat);
                    tr.querySelector('.td-total').textContent = fmtNumber(updated.total_amount);
                    tr.querySelector('.td-memo').textContent = updated.memo || '';
                }

                tdEl.classList.remove('is-inline-editing');
                this.flashCell(tdEl, '#dcfce7'); // 성공 연두색 깜빡임

                if (field === 'category') {
                    this.loadCategories();
                }
            } catch (err) {
                alert('인라인 수정 오류: ' + err.message);
                tdEl.classList.remove('is-inline-editing');
                tdEl.textContent = originalText;
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                isSaved = true;
                tdEl.classList.remove('is-inline-editing');
                tdEl.textContent = (field === 'qty' || field === 'unit_price' || field === 'vat') ? fmtNumber(originalText) : originalText;
            }
        });

        input.addEventListener('blur', saveChange);
    },

    flashCell: function(el, color) {
        const origBg = el.style.backgroundColor;
        el.style.backgroundColor = color;
        setTimeout(() => {
            el.style.backgroundColor = origBg;
        }, 600);
    },

    // -------------------------------------------------------------------------
    // [핵심 기능 2 & 3] ECOUNT ERP 전표형 스프레드시트 모달 & 고속 키보드 입력
    // -------------------------------------------------------------------------
    openSheetModal: function() {
        if (!this.sheetModal) return;

        // 마스터 헤더 기본값 세팅
        const today = new Date().toISOString().substring(0, 10);
        document.getElementById('sheetVoucherDate').value = today;
        document.getElementById('sheetCategory').value = '일반자재';
        document.getElementById('sheetSupplier').value = '';
        document.getElementById('sheetDestination').value = '';
        document.getElementById('sheetVoucherMemo').value = '';

        // 스프레드시트 초기 5행 렌더링
        this.initSheetRows(5);

        this.sheetModal.show();

        // 첫 번째 행 품목명으로 자동 포커스
        setTimeout(() => {
            const firstItemInput = document.querySelector('#sheetTableBody tr:first-child .cell-item');
            if (firstItemInput) firstItemInput.focus();
        }, 300);
    },

    initSheetRows: function(count = 5) {
        const tbody = document.getElementById('sheetTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        for (let i = 0; i < count; i++) {
            this.addSheetRow();
        }
        this.updateSheetTotals();
    },

    addSheetRow: function(data = {}) {
        const tbody = document.getElementById('sheetTableBody');
        if (!tbody) return;

        const rowIdx = tbody.children.length + 1;
        const tr = document.createElement('tr');
        tr.className = 'sheet-row';

        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="sheet-row-check"></td>
            <td class="row-no" style="text-align: center; color: #64748b; font-size: 11px;">${rowIdx}</td>
            <td>
                <input type="text" class="erp-cell-input cell-item" value="${data.item || ''}" placeholder="품목명 입력...">
            </td>
            <td>
                <input type="text" class="erp-cell-input cell-spec" value="${data.spec || ''}" placeholder="규격 입력...">
            </td>
            <td>
                <input type="text" class="erp-cell-input text-center cell-unit" value="${data.unit || 'EA'}" style="width: 100%;">
            </td>
            <td>
                <input type="number" class="erp-cell-input text-end cell-qty" value="${data.qty !== undefined ? data.qty : ''}" placeholder="0" min="0" step="any">
            </td>
            <td>
                <input type="number" class="erp-cell-input text-end cell-price" value="${data.unit_price !== undefined ? data.unit_price : ''}" placeholder="0" min="0" step="any">
            </td>
            <td>
                <input type="text" class="erp-cell-input text-end cell-supply bg-readonly" value="${data.supply_amount ? fmtNumber(data.supply_amount) : '0'}" readonly>
            </td>
            <td>
                <input type="text" class="erp-cell-input text-end cell-vat bg-readonly" value="${data.vat ? fmtNumber(data.vat) : '0'}" readonly>
            </td>
            <td>
                <input type="text" class="erp-cell-input text-end cell-total bg-readonly fw-bold text-primary" value="${data.total_amount ? fmtNumber(data.total_amount) : '0'}" readonly>
            </td>
            <td>
                <input type="text" class="erp-cell-input cell-memo" value="${data.memo || ''}" placeholder="특이사항...">
            </td>
            <td style="text-align: center;">
                <button type="button" class="btn-row-del" onclick="app.removeSpecificSheetRow(this)" title="행 삭제">
                    <i class='bx bx-x'></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);

        // 이벤트 바인딩 (키보드 네비게이션, 엑셀 붙여넣기, 실시간 계산, 단가 메모리)
        this.bindSheetRowEvents(tr);
        this.updateSheetTotals();
    },

    removeSpecificSheetRow: function(btn) {
        const tr = btn.closest('tr');
        if (tr) {
            tr.remove();
            this.reindexSheetRows();
            this.updateSheetTotals();
        }
    },

    removeSelectedSheetRows: function() {
        const tbody = document.getElementById('sheetTableBody');
        if (!tbody) return;
        const checks = tbody.querySelectorAll('.sheet-row-check:checked');
        checks.forEach(c => c.closest('tr').remove());
        this.reindexSheetRows();
        this.updateSheetTotals();
    },

    clearAllSheetRows: function() {
        if (confirm('스프레드시트의 모든 입력 행을 비우시겠습니까?')) {
            this.initSheetRows(3);
        }
    },

    reindexSheetRows: function() {
        const rows = document.querySelectorAll('#sheetTableBody tr');
        rows.forEach((tr, i) => {
            const noCell = tr.querySelector('.row-no');
            if (noCell) noCell.textContent = i + 1;
        });
    },

    toggleSheetCheckAll: function(checked) {
        const checks = document.querySelectorAll('#sheetTableBody .sheet-row-check');
        checks.forEach(c => c.checked = checked);
    },

    // -------------------------------------------------------------------------
    // 스프레드시트 셀 이벤트 바인딩 (Zero-Mouse 키보드 & 엑셀 Ctrl+V & 단가 메모리)
    // -------------------------------------------------------------------------
    bindSheetRowEvents: function(tr) {
        const itemInput = tr.querySelector('.cell-item');
        const specInput = tr.querySelector('.cell-spec');
        const unitInput = tr.querySelector('.cell-unit');
        const qtyInput = tr.querySelector('.cell-qty');
        const priceInput = tr.querySelector('.cell-price');
        const memoInput = tr.querySelector('.cell-memo');

        const calcRow = () => {
            const q = parseFloat(qtyInput.value) || 0;
            const p = parseFloat(priceInput.value) || 0;
            const supply = Math.round(q * p);
            const vat = Math.round(supply * 0.1);
            const total = supply + vat;

            tr.querySelector('.cell-supply').value = fmtNumber(supply);
            tr.querySelector('.cell-vat').value = fmtNumber(vat);
            tr.querySelector('.cell-total').value = fmtNumber(total);

            this.updateSheetTotals();
        };

        qtyInput.addEventListener('input', calcRow);
        priceInput.addEventListener('input', calcRow);

        // [핵심 기능 2] 최근 단가/규격 스마트 메모리 자동완성
        itemInput.addEventListener('blur', async () => {
            const itemVal = itemInput.value.trim();
            if (!itemVal) return;

            // 이미 단가나 규격이 차있다면 덮어쓰지 않음
            if (specInput.value.trim() && priceInput.value.trim()) return;

            const supplierVal = document.getElementById('sheetSupplier').value.trim();
            const destVal = document.getElementById('sheetDestination').value.trim();

            try {
                const params = new URLSearchParams({ item: itemVal });
                if (supplierVal) params.append('supplier', supplierVal);
                if (destVal) params.append('destination', destVal);

                const res = await authFetch(`${API_BASE}/recent-price?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.found) {
                        if (!specInput.value.trim() && data.spec) specInput.value = data.spec;
                        if (!unitInput.value.trim() && data.unit) unitInput.value = data.unit;
                        if (!priceInput.value.trim() && data.unit_price) {
                            priceInput.value = data.unit_price;
                            calcRow();
                        }
                        this.flashCell(itemInput.parentElement, '#eff6ff');
                    }
                }
            } catch (err) {
                console.warn('Recent price check error:', err);
            }
        });

        // [핵심 기능 1] 엑셀 블록 복사-붙여넣기 딥 파서 (Deep Excel Paste)
        const handlePaste = (e) => {
            const clipboardData = e.clipboardData || window.clipboardData;
            if (!clipboardData) return;

            const text = clipboardData.getData('text');
            if (!text || (!text.includes('\t') && !text.includes('\n'))) {
                return; // 단순 단일 텍스트는 브라우저 기본 붙여넣기 사용
            }

            e.preventDefault();
            this.parseExcelPaste(text, tr);
        };

        // 키보드 순차 이동 (Tab / Enter) & 마지막 셀 Enter 시 자동 행 추가
        const inputs = [itemInput, specInput, unitInput, qtyInput, priceInput, memoInput];

        inputs.forEach((inp, colIdx) => {
            inp.addEventListener('paste', handlePaste);

            inp.addEventListener('keydown', (e) => {
                // Enter 또는 Tab
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (colIdx < inputs.length - 1) {
                        inputs[colIdx + 1].focus();
                        if (inputs[colIdx + 1].select) inputs[colIdx + 1].select();
                    } else {
                        // 마지막 비고 셀에서 Enter 시 다음 행으로 이동 또는 새 행 추가!
                        const nextTr = tr.nextElementSibling;
                        if (nextTr) {
                            const nextItem = nextTr.querySelector('.cell-item');
                            if (nextItem) {
                                nextItem.focus();
                                if (nextItem.select) nextItem.select();
                            }
                        } else {
                            // 마지막 행이면 즉시 새 행 추가 후 품목명으로 포커스
                            this.addSheetRow();
                            const newTr = tr.nextElementSibling;
                            if (newTr) {
                                const newFirst = newTr.querySelector('.cell-item');
                                if (newFirst) newFirst.focus();
                            }
                        }
                    }
                } else if (e.key === 'ArrowDown') {
                    // 동일 열 아래 행 이동
                    const nextTr = tr.nextElementSibling;
                    if (nextTr) {
                        const nextInps = [
                            nextTr.querySelector('.cell-item'),
                            nextTr.querySelector('.cell-spec'),
                            nextTr.querySelector('.cell-unit'),
                            nextTr.querySelector('.cell-qty'),
                            nextTr.querySelector('.cell-price'),
                            nextTr.querySelector('.cell-memo')
                        ];
                        if (nextInps[colIdx]) {
                            e.preventDefault();
                            nextInps[colIdx].focus();
                        }
                    }
                } else if (e.key === 'ArrowUp') {
                    // 동일 열 위 행 이동
                    const prevTr = tr.previousElementSibling;
                    if (prevTr) {
                        const prevInps = [
                            prevTr.querySelector('.cell-item'),
                            prevTr.querySelector('.cell-spec'),
                            prevTr.querySelector('.cell-unit'),
                            prevTr.querySelector('.cell-qty'),
                            prevTr.querySelector('.cell-price'),
                            prevTr.querySelector('.cell-memo')
                        ];
                        if (prevInps[colIdx]) {
                            e.preventDefault();
                            prevInps[colIdx].focus();
                        }
                    }
                }
            });
        });
    },

    // [핵심 기능 1] 엑셀 붙여넣기 파싱 알고리즘
    parseExcelPaste: function(rawText, startTr) {
        const rows = rawText.trim().split(/\r\n|\n|\r/).filter(Boolean);
        if (rows.length === 0) return;

        let currentTr = startTr;
        const tbody = document.getElementById('sheetTableBody');

        rows.forEach((rowStr, rIdx) => {
            const cols = rowStr.split('\t').map(c => c.trim().replace(/^["']|["']$/g, ''));

            if (!currentTr) {
                this.addSheetRow();
                currentTr = tbody.lastElementChild;
            }

            // 일반적인 엑셀 컬럼 구성 분석:
            // 케이스 A: 품목명, 규격, 단위, 수량, 단가, (비고)
            // 케이스 B: (일자/공급처/출고처 포함된 풀 엑셀 행) -> 품목, 규격, 수량, 단가 지능형 매핑
            let item = '', spec = '', unit = 'EA', qty = 0, price = 0, memo = '';

            if (cols.length === 1) {
                item = cols[0];
            } else if (cols.length === 2) {
                item = cols[0];
                spec = cols[1];
            } else if (cols.length >= 3) {
                item = cols[0];
                spec = cols[1];
                // 수량/단가 위치 파악
                if (isNaN(parseFloat(cols[2])) && cols.length >= 4) {
                    unit = cols[2] || 'EA';
                    qty = parseFloat(cols[3].replace(/,/g, '')) || 0;
                    price = parseFloat((cols[4] || '0').replace(/,/g, '')) || 0;
                    memo = cols.slice(5).join(' ');
                } else {
                    qty = parseFloat(cols[2].replace(/,/g, '')) || 0;
                    price = parseFloat((cols[3] || '0').replace(/,/g, '')) || 0;
                    memo = cols.slice(4).join(' ');
                }
            }

            if (currentTr) {
                const itemInp = currentTr.querySelector('.cell-item');
                const specInp = currentTr.querySelector('.cell-spec');
                const unitInp = currentTr.querySelector('.cell-unit');
                const qtyInp = currentTr.querySelector('.cell-qty');
                const priceInp = currentTr.querySelector('.cell-price');
                const memoInp = currentTr.querySelector('.cell-memo');

                if (itemInp && item) itemInp.value = item;
                if (specInp && spec) specInp.value = spec;
                if (unitInp && unit) unitInp.value = unit;
                if (qtyInp && qty) qtyInp.value = qty;
                if (priceInp && price) priceInp.value = price;
                if (memoInp && memo) memoInp.value = memo;

                // 금액 자동 재계산
                const supply = Math.round(qty * price);
                const vat = Math.round(supply * 0.1);
                const total = supply + vat;

                currentTr.querySelector('.cell-supply').value = fmtNumber(supply);
                currentTr.querySelector('.cell-vat').value = fmtNumber(vat);
                currentTr.querySelector('.cell-total').value = fmtNumber(total);

                this.flashCell(currentTr, '#ecfdf5');
            }

            currentTr = currentTr ? currentTr.nextElementSibling : null;
        });

        this.updateSheetTotals();
    },

    // 스프레드시트 하단 실시간 합계 갱신
    updateSheetTotals: function() {
        const rows = document.querySelectorAll('#sheetTableBody tr');
        let totalCount = 0;
        let totalQty = 0;
        let totalSupply = 0;
        let totalVat = 0;
        let totalSum = 0;

        rows.forEach(tr => {
            const item = (tr.querySelector('.cell-item')?.value || '').trim();
            const qty = parseFloat(tr.querySelector('.cell-qty')?.value) || 0;
            const price = parseFloat(tr.querySelector('.cell-price')?.value) || 0;

            if (item || qty > 0 || price > 0) {
                totalCount++;
                totalQty += qty;
                const supply = Math.round(qty * price);
                const vat = Math.round(supply * 0.1);
                totalSupply += supply;
                totalVat += vat;
                totalSum += (supply + vat);
            }
        });

        const cntEl = document.getElementById('modalSummaryCount');
        const qtyEl = document.getElementById('modalSummaryQty');
        const supEl = document.getElementById('modalSummarySupply');
        const vatEl = document.getElementById('modalSummaryVat');
        const totEl = document.getElementById('modalSummaryTotal');

        if (cntEl) cntEl.textContent = totalCount;
        if (qtyEl) qtyEl.textContent = fmtNumber(totalQty);
        if (supEl) supEl.textContent = fmtWon(totalSupply);
        if (vatEl) vatEl.textContent = fmtWon(totalVat);
        if (totEl) totEl.textContent = fmtWon(totalSum);
    },

    // -------------------------------------------------------------------------
    // 전표 일괄 저장 및 발행 (Batch Transaction)
    // -------------------------------------------------------------------------
    submitSheetVoucher: async function() {
        const date = document.getElementById('sheetVoucherDate').value;
        const category = document.getElementById('sheetCategory').value;
        const supplier = document.getElementById('sheetSupplier').value.trim();
        const destination = document.getElementById('sheetDestination').value.trim();
        const voucherMemo = document.getElementById('sheetVoucherMemo').value.trim();

        if (!date) {
            alert('거래일자를 입력해 주세요.');
            document.getElementById('sheetVoucherDate').focus();
            return;
        }
        if (!supplier) {
            alert('공급처(구매)를 입력해 주세요.');
            document.getElementById('sheetSupplier').focus();
            return;
        }
        if (!destination) {
            alert('출고처(현장명)를 입력해 주세요.');
            document.getElementById('sheetDestination').focus();
            return;
        }

        const rows = document.querySelectorAll('#sheetTableBody tr');
        const items = [];

        rows.forEach((tr, idx) => {
            const item = (tr.querySelector('.cell-item')?.value || '').trim();
            const spec = (tr.querySelector('.cell-spec')?.value || '').trim();
            const unit = (tr.querySelector('.cell-unit')?.value || 'EA').trim();
            const qty = parseFloat(tr.querySelector('.cell-qty')?.value) || 0;
            const unit_price = parseFloat(tr.querySelector('.cell-price')?.value) || 0;
            const memo = (tr.querySelector('.cell-memo')?.value || '').trim();

            if (item && (qty > 0 || unit_price > 0)) {
                const supply_amount = Math.round(qty * unit_price);
                const vat = Math.round(supply_amount * 0.1);
                const total_amount = supply_amount + vat;

                items.push({
                    item,
                    spec: spec || '-',
                    unit,
                    qty,
                    unit_price,
                    supply_amount,
                    vat,
                    total_amount,
                    memo: memo || voucherMemo
                });
            }
        });

        if (items.length === 0) {
            alert('등록할 품목 내역을 최소 1건 이상 입력해 주세요 (품목명 및 수량/단가 필요).');
            return;
        }

        const btn = document.getElementById('btnSubmitSheet');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> 저장 중...`;
        }

        try {
            const payload = {
                date,
                category,
                supplier,
                destination,
                memo: voucherMemo,
                items
            };

            const res = await authFetch(`${API_BASE}/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || '전표 저장 실패');
            }

            const result = await res.json();
            alert(result.message || '전표가 정상 등록되었습니다.');

            if (this.sheetModal) this.sheetModal.hide();

            // 분류 목록 및 내역 목록 새로고침
            await this.loadCategories();
            this.pagination.page = 1;
            await this.loadList();

        } catch (err) {
            console.error('Submit voucher error:', err);
            alert('전표 저장 오류: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<i class='bx bx-check'></i> <strong>전표 저장 및 발행 (F9 / Ctrl+S)</strong>`;
            }
        }
    },

    // -------------------------------------------------------------------------
    // 단건 삭제 & 선택 일괄 삭제
    // -------------------------------------------------------------------------
    deleteSingleRow: async function(id) {
        if (!confirm('해당 내역을 삭제하시겠습니까?')) return;
        try {
            const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('삭제 실패');
            this.selectedIds.delete(id);
            await this.loadList();
        } catch (err) {
            alert('삭제 오류: ' + err.message);
        }
    },

    toggleSelectAll: function(checked) {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            const id = cb.value;
            const tr = cb.closest('tr');
            if (checked) {
                this.selectedIds.add(id);
                if (tr) tr.classList.add('is-selected');
            } else {
                this.selectedIds.delete(id);
                if (tr) tr.classList.remove('is-selected');
            }
        });
        this.updateSelectedCounter();
    },

    toggleSelectRow: function(id, checked) {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if (checked) {
            this.selectedIds.add(id);
            if (tr) tr.classList.add('is-selected');
        } else {
            this.selectedIds.delete(id);
            if (tr) tr.classList.remove('is-selected');
        }
        this.updateSelectedCounter();
    },

    updateSelectedCounter: function() {
        const count = this.selectedIds.size;
        const btnDelete = document.getElementById('btnBatchDelete');
        const countSpan = document.getElementById('selectedCount');
        const stripCount = document.getElementById('stripSelectedCount');

        if (countSpan) countSpan.textContent = count;
        if (stripCount) stripCount.textContent = count;

        if (btnDelete) {
            if (count > 0) btnDelete.classList.remove('d-none');
            else btnDelete.classList.add('d-none');
        }
    },

    deleteSelectedRows: async function() {
        const ids = Array.from(this.selectedIds);
        if (ids.length === 0) return;

        if (!confirm(`선택하신 ${ids.length}건의 내역을 일괄 삭제하시겠습니까?`)) return;

        try {
            const res = await authFetch(`${API_BASE}/batch-delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            if (!res.ok) throw new Error('일괄 삭제 실패');
            alert('선택된 내역이 일괄 삭제되었습니다.');
            this.selectedIds.clear();
            this.updateSelectedCounter();
            await this.loadList();
        } catch (err) {
            alert('일괄 삭제 오류: ' + err.message);
        }
    },

    // -------------------------------------------------------------------------
    // 상단 요약 집계 스트립 갱신
    // -------------------------------------------------------------------------
    updateSummaryStrip: function(summary) {
        const total = summary.total_count || 0;
        const qty = summary.sum_qty || 0;
        const supply = summary.sum_supply_amount || 0;
        const vat = summary.sum_vat || 0;
        const amount = summary.sum_total_amount || 0;

        document.getElementById('stripTotalCount').textContent = fmtNumber(total);
        document.getElementById('stripTotalQty').textContent = fmtNumber(qty);
        document.getElementById('stripSupplyAmount').textContent = fmtWon(supply);
        document.getElementById('stripVatAmount').textContent = fmtWon(vat);
        document.getElementById('stripTotalAmount').textContent = fmtWon(amount);

        const pageInfo = document.getElementById('pageInfoStr');
        if (pageInfo) {
            pageInfo.textContent = `총 ${fmtNumber(total)}건 (${this.pagination.page}/${this.pagination.totalPages} 페이지)`;
        }
    },

    // -------------------------------------------------------------------------
    // 페이징 컨트롤
    // -------------------------------------------------------------------------
    renderPagination: function() {
        const container = document.getElementById('paginationControls');
        if (!container) return;

        const { page, totalPages } = this.pagination;
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';
        html += `<button type="button" class="btn btn-outline-secondary ${page <= 1 ? 'disabled' : ''}" onclick="app.gotoPage(1)"><i class='bx bx-chevrons-left'></i></button>`;
        html += `<button type="button" class="btn btn-outline-secondary ${page <= 1 ? 'disabled' : ''}" onclick="app.gotoPage(${page - 1})"><i class='bx bx-chevron-left'></i></button>`;

        const startPage = Math.max(1, page - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let p = startPage; p <= endPage; p++) {
            html += `<button type="button" class="btn ${p === page ? 'btn-primary' : 'btn-outline-secondary'}" onclick="app.gotoPage(${p})">${p}</button>`;
        }

        html += `<button type="button" class="btn btn-outline-secondary ${page >= totalPages ? 'disabled' : ''}" onclick="app.gotoPage(${page + 1})"><i class='bx bx-chevron-right'></i></button>`;
        html += `<button type="button" class="btn btn-outline-secondary ${page >= totalPages ? 'disabled' : ''}" onclick="app.gotoPage(${totalPages})"><i class='bx bx-chevrons-right'></i></button>`;

        container.innerHTML = html;
    },

    gotoPage: function(p) {
        if (p < 1 || p > this.pagination.totalPages || p === this.pagination.page) return;
        this.pagination.page = p;
        this.loadList();
    },

    changePageSize: function(sz) {
        this.pagination.limit = parseInt(sz, 10) || 100;
        this.pagination.page = 1;
        this.loadList();
    },

    // -------------------------------------------------------------------------
    // 정렬 & 검색
    // -------------------------------------------------------------------------
    sortBy: function(col) {
        if (this.currentSort.col === col) {
            this.currentSort.dir = this.currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.col = col;
            this.currentSort.dir = 'desc';
        }
        this.pagination.page = 1;
        this.loadList();
    },

    search: function() {
        const target = document.getElementById('searchTarget')?.value || 'keyword';
        const kw = document.getElementById('historySearch')?.value.trim();

        if (kw) {
            this.activeFilters[target] = kw;
            const searchInput = document.getElementById('historySearch');
            if (searchInput) searchInput.value = '';
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.classList.add('d-none');
        }

        this.renderFilterChips();
        this.pagination.page = 1;
        this.loadList();
    },

    removeFilter: function(key) {
        if (this.activeFilters) {
            delete this.activeFilters[key];
        }
        this.renderFilterChips();
        this.pagination.page = 1;
        this.loadList();
    },

    resetAllFilters: function() {
        this.activeFilters = {};
        const inp = document.getElementById('historySearch');
        if (inp) inp.value = '';
        const target = document.getElementById('searchTarget');
        if (target) target.value = '';
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');

        this.renderFilterChips();
        this.clearSubSearch();
        this.pagination.page = 1;
        this.loadList();
    },

    resetSearch: function() {
        this.resetAllFilters();
        this.setDatePreset('all');
    },

    renderFilterChips: function() {
        const bar = document.getElementById('activeFilterBar');
        const container = document.getElementById('activeFilterChips');
        if (!bar || !container) return;

        const TARGET_LABELS = {
            supplier: '공급처',
            destination: '출고처',
            item: '품목명',
            spec: '규격',
            voucher_id: '전표번호',
            memo: '비고',
            keyword: '통합검색'
        };

        const entries = Object.entries(this.activeFilters || {}).filter(([_, v]) => Boolean(v && v.trim()));

        if (entries.length === 0) {
            bar.classList.add('d-none');
            container.innerHTML = '';
            return;
        }

        bar.classList.remove('d-none');
        container.innerHTML = `
            <span class="filter-chip-label"><i class='bx bx-filter-alt'></i> 활성 검색 조건:</span>
            ${entries.map(([k, v]) => `
                <span class="filter-chip">
                    <strong>${TARGET_LABELS[k] || k}:</strong> ${v}
                    <i class='bx bx-x filter-chip-remove' onclick="app.removeFilter('${k}')" title="이 조건 해제"></i>
                </span>
            `).join('')}
        `;
    },

    onSearchInputKeyup: function(e) {
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            if (e.target.value.trim()) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        if (e.key === 'Enter') {
            this.search();
        }
    },

    clearSearchInput: function() {
        const inp = document.getElementById('historySearch');
        if (inp) inp.value = '';
        document.getElementById('clearSearchBtn').classList.add('d-none');
        this.search();
    },

    onSearchTargetChange: function() {
        const target = document.getElementById('searchTarget').value;
        const inp = document.getElementById('historySearch');
        if (inp) {
            if (target === 'supplier') inp.placeholder = '공급처(구매)명 입력 후 Enter...';
            else if (target === 'destination') inp.placeholder = '출고처(현장)명 입력 후 Enter...';
            else if (target === 'item') inp.placeholder = '품목명 입력 후 Enter...';
            else if (target === 'spec') inp.placeholder = '규격 입력 후 Enter...';
            else if (target === 'voucher_id') inp.placeholder = '전표번호 입력 후 Enter...';
            else inp.placeholder = '스마트 다중 검색 (Enter)...';
        }
    },

    // -------------------------------------------------------------------------
    // 엑셀 업로드 / 다운로드
    // -------------------------------------------------------------------------
    openUploadModal: function() {
        if (this.uploadModal) {
            document.getElementById('excelFileInput').value = '';
            document.getElementById('uploadStatusText').innerHTML = '';
            this.uploadModal.show();
        }
    },

    downloadTemplate: async function() {
        try {
            const res = await authFetch(`${API_BASE}/template`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || '템플릿 다운로드 실패');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = '외부입출_업로드양식.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download template error:', err);
            // fallback
            window.location.href = `${API_BASE}/template`;
        }
    },

    uploadExcel: async function() {
        const fileInp = document.getElementById('excelFileInput');
        const statusText = document.getElementById('uploadStatusText');
        const submitBtn = document.getElementById('btnUploadSubmit');

        if (!fileInp || !fileInp.files || fileInp.files.length === 0) {
            alert('업로드할 엑셀 파일을 선택해 주세요.');
            return;
        }

        const file = fileInp.files[0];
        const formData = new FormData();
        formData.append('file', file);
        formData.append('excelFile', file);

        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> 업로드 중...`;
        statusText.innerHTML = `<span class="text-primary"><i class='bx bx-loader bx-spin'></i> 엑셀 데이터를 분석 및 등록하고 있습니다...</span>`;

        try {
            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });

            const resText = await res.text();
            let result = {};
            try {
                result = JSON.parse(resText);
            } catch (parseErr) {
                throw new Error(`서버 응답 오류 (HTTP ${res.status}): ${resText.substring(0, 100)}`);
            }

            if (!res.ok) throw new Error(result.error || '엑셀 업로드 실패');

            statusText.innerHTML = `<span class="text-success"><i class='bx bx-check-circle'></i> ${result.message}</span>`;
            alert(result.message);
            if (this.uploadModal) this.uploadModal.hide();
            await this.loadCategories();
            await this.loadList();

        } catch (err) {
            statusText.innerHTML = `<span class="text-danger"><i class='bx bx-error-circle'></i> ${err.message}</span>`;
            alert('업로드 오류: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class='bx bx-upload'></i> 업로드 실행`;
        }
    },

    exportExcel: async function() {
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;
        const category = this.currentCategory || '';
        const searchTarget = document.getElementById('searchTarget').value;
        const keyword = document.getElementById('historySearch').value.trim();

        const params = new URLSearchParams();
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (category) params.append('category', category);

        // 활성 필터 조건들 전달
        if (this.activeFilters) {
            Object.entries(this.activeFilters).forEach(([k, v]) => {
                if (v && String(v).trim()) params.append(k, String(v).trim());
            });
        }

        const curSearchTarget = document.getElementById('searchTarget')?.value || 'keyword';
        const curKw = document.getElementById('historySearch')?.value.trim();
        if (curKw && (!this.activeFilters || !this.activeFilters[curSearchTarget])) {
            params.append(curSearchTarget, curKw);
        }

        try {
            const res = await authFetch(`${API_BASE}/export?${params.toString()}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || '엑셀 내보내기 실패');
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const today = new Date().toISOString().slice(0, 10);
            a.download = `외부입출내역_${today}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export error:', err);
            alert('엑셀 다운로드 오류: ' + err.message);
        }
    },

    // -------------------------------------------------------------------------
    // 통계 대시보드 로드 & 차트 시각화
    // -------------------------------------------------------------------------
    loadDashboardData: async function() {
        try {
            const startDate = document.getElementById('filterStartDate').value;
            const endDate = document.getElementById('filterEndDate').value;
            const category = this.currentCategory || '';

            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (category) params.append('category', category);

            const res = await authFetch(`${API_BASE}/statistics?${params.toString()}`);
            if (!res.ok) throw new Error('통계 데이터 조회 실패');

            const data = await res.json();

            // KPI 카드 반영 (스네이크 케이스 & 카멜 케이스 안전 호환)
            const kpi = data.kpi || {};
            const totalCount = kpi.total_records ?? kpi.total_count ?? 0;
            const totalQty = kpi.total_qty ?? 0;
            const totalSupply = kpi.total_supply_amount ?? kpi.total_supply ?? 0;
            const avgPrice = kpi.avg_unit_price ?? kpi.avg_price ?? (totalQty > 0 ? Math.round(totalSupply / totalQty) : 0);
            const totalSpecs = kpi.total_specs ?? 0;
            const totalSites = kpi.total_sites ?? kpi.total_destinations ?? 0;

            document.getElementById('kpiTotalCount').textContent = `${fmtNumber(totalCount)}건`;
            document.getElementById('kpiTotalQty').textContent = `${fmtNumber(totalQty)} EA`;
            document.getElementById('kpiTotalSupply').textContent = fmtWon(totalSupply);
            document.getElementById('kpiAvgPrice').textContent = fmtWon(avgPrice);
            document.getElementById('kpiSpecCount').textContent = `${fmtNumber(totalSpecs)}종`;
            document.getElementById('kpiDestCount').textContent = `${fmtNumber(totalSites)}개소`;

            // 데이터 캐시 저장 (클릭 정렬용)
            this.dashboardDataCache = {
                specs: data.specStatistics || [],
                totalQty,
                totalSupply
            };

            // 규격 순위 테이블 렌더링 (금액 및 수량 모두 전달)
            this.renderSpecRanking(data.specStatistics || [], totalQty, totalSupply);

            // 차트 렌더링
            this.renderCharts(data.specStatistics || [], data.monthlyTrends || []);

        } catch (err) {
            console.error('Load dashboard error:', err);
        }
    },

    // -------------------------------------------------------------------------
    // 대시보드 순위 테이블 다차원 헤더 정렬
    // -------------------------------------------------------------------------
    sortDashboardSpecs: function(col) {
        if (this.dashboardSort.col === col) {
            this.dashboardSort.dir = this.dashboardSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
            this.dashboardSort.col = col;
            this.dashboardSort.dir = (col === 'item' || col === 'spec') ? 'asc' : 'desc';
        }

        // 헤더 시각적 인디케이터 갱신
        const ths = document.querySelectorAll('#dashboardSpecTable th.th-dash-sort');
        ths.forEach(th => {
            const c = th.getAttribute('data-dash-col');
            const icon = th.querySelector('i');
            if (c === col) {
                th.classList.add('active-sort');
                if (icon) {
                    icon.className = this.dashboardSort.dir === 'desc' ? 'bx bx-sort-down text-primary' : 'bx bx-sort-up text-primary';
                }
            } else {
                th.classList.remove('active-sort');
                if (icon) {
                    icon.className = 'bx bx-sort text-muted';
                }
            }
        });

        if (this.dashboardDataCache && this.dashboardDataCache.specs) {
            this.renderSpecRanking(
                this.dashboardDataCache.specs,
                this.dashboardDataCache.totalQty,
                this.dashboardDataCache.totalSupply
            );
        }
    },

    // -------------------------------------------------------------------------
    // [신규] 품목/규격별 공급 상세 내역 모달 팝업 (Drill-down Modal)
    // -------------------------------------------------------------------------
    openSpecDetailModal: async function(item, spec) {
        const modalEl = document.getElementById('specDetailModal');
        if (!modalEl) return;
        if (!this.specDetailModal) this.specDetailModal = new bootstrap.Modal(modalEl);

        const titleEl = document.getElementById('modalSpecTitle');
        const footerInfoEl = document.getElementById('modalFooterSpecInfo');
        const tbody = document.getElementById('modalSpecDetailTbody');

        const titleText = `${item}${spec ? ' (' + spec + ')' : ''} 실거래 공급 상세 내역`;
        if (titleEl) titleEl.textContent = titleText;
        if (footerInfoEl) footerInfoEl.textContent = `${item} ${spec}`;

        // KPI 초기화
        document.getElementById('modalKpiCount').textContent = '0건';
        document.getElementById('modalKpiQty').textContent = '0';
        document.getElementById('modalKpiSupply').textContent = '0원';
        document.getElementById('modalKpiAvgPrice').textContent = '0원';

        tbody.innerHTML = `
            <tr>
                <td colspan="15" class="text-center py-4 text-muted">
                    <i class='bx bx-loader-alt bx-spin'></i> 상세 전표 내역을 불러오는 중입니다...
                </td>
            </tr>
        `;

        this.specDetailModal.show();

        try {
            const startDate = document.getElementById('filterStartDate')?.value || '';
            const endDate = document.getElementById('filterEndDate')?.value || '';
            const category = this.currentCategory || '';

            const params = new URLSearchParams({
                item: item,
                limit: 'all',
                sortCol: 'date',
                sortDir: 'desc'
            });
            if (spec) params.append('spec', spec);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (category) params.append('category', category);

            const res = await authFetch(`${API_BASE}?${params.toString()}`);
            if (!res.ok) throw new Error('상세 전표 조회 실패');

            const result = await res.json();
            const rows = result.data || [];
            this.modalDetailData = rows;
            this.modalCurrentItem = item;
            this.modalCurrentSpec = spec;

            // KPI 갱신
            const totalCount = rows.length;
            const totalQty = rows.reduce((sum, r) => sum + (parseFloat(r.qty) || 0), 0);
            const totalSupply = rows.reduce((sum, r) => sum + (parseFloat(r.supply_amount) || 0), 0);
            const avgPrice = totalQty > 0 ? Math.round(totalSupply / totalQty) : 0;

            document.getElementById('modalKpiCount').textContent = `${fmtNumber(totalCount)}건`;
            document.getElementById('modalKpiQty').textContent = `${fmtNumber(totalQty)}`;
            document.getElementById('modalKpiSupply').textContent = fmtWon(totalSupply);
            document.getElementById('modalKpiAvgPrice').textContent = fmtWon(avgPrice);

            if (rows.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="15" class="text-center py-4 text-muted">
                            해당 조건의 입출고 전표 내역이 없습니다.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = rows.map((r, idx) => `
                <tr>
                    <td style="text-align: center;" class="text-muted">${idx + 1}</td>
                    <td style="text-align: center;">${r.date}</td>
                    <td style="text-align: center;">
                        ${r.voucher_id ? `<span class="badge bg-light text-primary border border-primary-subtle" style="font-size:10px; font-weight:normal;">${r.voucher_id}</span>` : `<span class="text-muted" style="font-size:10px;">${r.id}</span>`}
                    </td>
                    <td style="text-align: center;"><span class="badge bg-secondary-subtle text-secondary" style="font-size:10px;">${r.category || '일반자재'}</span></td>
                    <td class="fw-semibold" title="${r.supplier}">${r.supplier}</td>
                    <td title="${r.destination}">${r.destination}</td>
                    <td class="text-primary fw-bold" title="${r.item}">${r.item}</td>
                    <td title="${r.spec}">${r.spec}</td>
                    <td style="text-align: center;">${r.unit || 'EA'}</td>
                    <td style="text-align: right; font-weight: 700;">${fmtNumber(r.qty)}</td>
                    <td style="text-align: right;">${fmtNumber(r.unit_price)}</td>
                    <td style="text-align: right;">${fmtNumber(r.supply_amount)}</td>
                    <td style="text-align: right;">${fmtNumber(r.vat)}</td>
                    <td style="text-align: right; font-weight: 700; color: #0f172a;">${fmtNumber(r.total_amount)}</td>
                    <td class="text-muted" title="${r.memo || ''}">${r.memo || ''}</td>
                </tr>
            `).join('');

        } catch (err) {
            console.error('Open spec detail modal error:', err);
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle'></i> 데이터를 불러오지 못했습니다: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    exportModalSpecExcel: async function() {
        if (!this.modalDetailData || this.modalDetailData.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const item = this.modalCurrentItem || '품목';
        const spec = this.modalCurrentSpec || '';
        const startDate = document.getElementById('filterStartDate')?.value || '';
        const endDate = document.getElementById('filterEndDate')?.value || '';
        const category = this.currentCategory || '';

        const params = new URLSearchParams({
            item: item,
            spec: spec
        });
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        if (category) params.append('category', category);

        try {
            const res = await authFetch(`${API_BASE}/export?${params.toString()}`);
            if (!res.ok) throw new Error('엑셀 내보내기 실패');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const today = new Date().toISOString().slice(0, 10);
            a.download = `${item}_${spec ? spec + '_' : ''}상세공급내역_${today}.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Modal export error:', err);
            alert('엑셀 다운로드 오류: ' + err.message);
        }
    },

    printModalSpec: function() {
        const printArea = document.getElementById('modalSpecPrintArea');
        if (!printArea) return;
        const title = document.getElementById('modalSpecTitle')?.textContent || '품목 공급 상세 내역';
        const kpiCount = document.getElementById('modalKpiCount')?.textContent || '';
        const kpiQty = document.getElementById('modalKpiQty')?.textContent || '';
        const kpiSupply = document.getElementById('modalKpiSupply')?.textContent || '';
        const kpiAvgPrice = document.getElementById('modalKpiAvgPrice')?.textContent || '';

        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${title}</title>
                <style>
                    @page { size: A4 landscape; margin: 8mm 6mm; }
                    body { font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; font-size: 8pt; margin: 0; padding: 10px; color: #000; }
                    h2 { text-align: center; margin: 0 0 8px 0; font-size: 14pt; }
                    .kpi { display: flex; justify-content: space-around; background: #f1f5f9; padding: 6px; border: 1px solid #cbd5e1; margin-bottom: 8px; font-size: 8.5pt; }
                    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                    th, td { border: 1px solid #333; padding: 3px 2px; font-size: 7.5pt; line-height: 1.2; word-break: break-all; }
                    th { background-color: #f1f5f9; font-weight: 700; text-align: center; }
                    .text-end { text-align: right; }
                    .text-center { text-align: center; }
                </style>
            </head>
            <body>
                <h2>${title}</h2>
                <div class="kpi">
                    <span><strong>총 공급건수:</strong> ${kpiCount}</span>
                    <span><strong>총 공급수량:</strong> ${kpiQty}</span>
                    <span><strong>총 공급가액:</strong> ${kpiSupply}</span>
                    <span><strong>평균단가:</strong> ${kpiAvgPrice}</span>
                </div>
                ${printArea.innerHTML}
                <script>
                    window.onload = function() { window.print(); window.close(); };
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    },

    drillDownToDetail: function(item, spec) {
        this.openSpecDetailModal(item, spec);
    },

    renderSpecRanking: function(specs, totalQty, totalSupply) {
        const tbody = document.getElementById('specRankingTableBody');
        if (!tbody) return;

        if (!specs || specs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-center py-3 text-muted">집계 데이터가 없습니다.</td></tr>`;
            return;
        }

        // 1. 현재 정렬 기준에 맞게 정렬된 복제본 생성
        const sortCol = this.dashboardSort.col || 'totalSupplyAmount';
        const sortDir = this.dashboardSort.dir || 'desc';

        const sorted = [...specs].sort((a, b) => {
            let valA, valB;
            if (sortCol === 'totalSupplyAmount') {
                valA = a.totalSupplyAmount ?? a.spec_supply_amount ?? 0;
                valB = b.totalSupplyAmount ?? b.spec_supply_amount ?? 0;
            } else if (sortCol === 'totalQty') {
                valA = a.totalQty ?? a.spec_qty ?? 0;
                valB = b.totalQty ?? b.spec_qty ?? 0;
            } else if (sortCol === 'recordCount') {
                valA = a.recordCount ?? a.count ?? 0;
                valB = b.recordCount ?? b.count ?? 0;
            } else if (sortCol === 'avgPrice') {
                valA = a.avgPrice ?? a.avg_price ?? 0;
                valB = b.avgPrice ?? b.avg_price ?? 0;
            } else if (sortCol === 'item') {
                return sortDir === 'asc' ? (a.item || '').localeCompare(b.item || '', 'ko') : (b.item || '').localeCompare(a.item || '', 'ko');
            } else if (sortCol === 'spec') {
                return sortDir === 'asc' ? (a.spec || '').localeCompare(b.spec || '', 'ko') : (b.spec || '').localeCompare(a.spec || '', 'ko');
            } else if (sortCol === 'share') {
                valA = a.valueShare ?? a.qtyShare ?? 0;
                valB = b.valueShare ?? b.qtyShare ?? 0;
            } else {
                valA = a.totalSupplyAmount ?? 0;
                valB = b.totalSupplyAmount ?? 0;
            }

            return sortDir === 'asc' ? valA - valB : valB - valA;
        });

        // 2. 비중 헤더 텍스트 스마트 업데이트 (수량순일 때 수량%, 그 외 금액%)
        const shareHeader = document.getElementById('thDashShareHeader');
        const isQtySort = (sortCol === 'totalQty');
        if (shareHeader) {
            const sortIcon = shareHeader.querySelector('i')?.outerHTML || "<i class='bx bx-sort text-muted'></i>";
            shareHeader.innerHTML = `${isQtySort ? '물량 비중(수량%)' : '매출 비중(금액%)'} ${sortIcon}`;
        }

        // 3. 행 렌더링
        tbody.innerHTML = sorted.map((s, idx) => {
            const qty = s.totalQty ?? s.spec_qty ?? s.sum_qty ?? 0;
            const count = s.recordCount ?? s.count ?? s.record_count ?? 0;
            const supply = s.totalSupplyAmount ?? s.spec_supply_amount ?? s.sum_supply_amount ?? 0;
            const avgPrice = Math.round(s.avgPrice ?? s.avg_price ?? (qty > 0 ? (supply / qty) : 0));

            // 금액 비중 및 물량 비중 계산
            const valueShare = s.valueShare !== undefined ? s.valueShare : (totalSupply > 0 ? parseFloat(((supply / totalSupply) * 100).toFixed(1)) : 0);
            const qtyShare = s.qtyShare !== undefined ? s.qtyShare : (totalQty > 0 ? parseFloat(((qty / totalQty) * 100).toFixed(1)) : 0);
            const activeShare = isQtySort ? qtyShare : valueShare;

            // 순위 표기 (동그라미 제거, 깔끔한 숫자 텍스트)
            const rankBadge = `<span class="rank-badge">${idx + 1}</span>`;

            // 출고처(현장) 전체 표기 및 툴팁 렌더링
            const destList = s.destinationsList || (s.destinations ? s.destinations.split(',').map(d => d.trim()).filter(Boolean) : []);
            const fullText = destList.join(', ');
            let destHtml = `<span class="text-muted" style="font-size:11px;">-</span>`;
            if (destList.length > 0) {
                destHtml = `<span class="dest-full-text" title="전체 출고처 (${destList.length}곳):&#10;${destList.join('&#10;')}">${fullText}</span>`;
            }

            const safeItem = (s.item || '').replace(/'/g, "\\'");
            const safeSpec = (s.spec || '').replace(/'/g, "\\'");

            return `
                <tr>
                    <td style="text-align: center;">${rankBadge}</td>
                    <td class="fw-bold text-primary">${s.item}</td>
                    <td>${s.spec}</td>
                    <td style="text-align: center;">${s.unit || 'EA'}</td>
                    <td>${destHtml}</td>
                    <td style="text-align: right;">${fmtNumber(count)}건</td>
                    <td style="text-align: right; font-weight: 700;">${fmtNumber(qty)}</td>
                    <td style="text-align: right; font-weight: 700; color: #0f172a;">${fmtNumber(supply)}원</td>
                    <td style="text-align: right;">${fmtNumber(avgPrice)}원</td>
                    <td>
                        <div class="d-flex align-items-center gap-2" title="금액비중: ${valueShare}%, 수량비중: ${qtyShare}%">
                            <div class="progress flex-grow-1" style="height: 6px;">
                                <div class="progress-bar ${isQtySort ? 'bg-success' : 'bg-primary'}" style="width: ${Math.min(activeShare, 100)}%;"></div>
                            </div>
                            <span style="font-size: 10.5px; width: 42px; text-align: right; font-weight: 600;">${activeShare}%</span>
                        </div>
                    </td>
                    <td class="td-dash-action" style="text-align: center;">
                        <button type="button" class="btn-drilldown" onclick="app.openSpecDetailModal('${safeItem}', '${safeSpec}')" title="이 규격의 전체 실거래 전표 모달 조회">
                            <i class='bx bx-search'></i> 조회
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // 대시보드 차트 2 모드 토글 (수량 Top 10 ⇄ 월별 추이)
    setDashChart2Mode: function(mode) {
        this.dashChart2Mode = mode;
        const btnQty = document.getElementById('btnChartModeQty');
        const btnMonthly = document.getElementById('btnChartModeMonthly');
        const canvasQty = document.getElementById('topQtyBarChart');
        const canvasMonthly = document.getElementById('monthlyBarChart');
        const titleEl = document.getElementById('dashChart2Title');

        if (mode === 'qty') {
            if (btnQty) { btnQty.classList.add('active'); }
            if (btnMonthly) { btnMonthly.classList.remove('active'); }
            if (canvasQty) canvasQty.classList.remove('d-none');
            if (canvasMonthly) canvasMonthly.classList.add('d-none');
            if (titleEl) titleEl.innerHTML = `<i class='bx bx-package text-success'></i> 공급수량 상위 10대 품목 (Top 10)`;
        } else {
            if (btnQty) { btnQty.classList.remove('active'); }
            if (btnMonthly) { btnMonthly.classList.add('active'); }
            if (canvasQty) canvasQty.classList.add('d-none');
            if (canvasMonthly) canvasMonthly.classList.remove('d-none');
            if (titleEl) titleEl.innerHTML = `<i class='bx bx-bar-chart-alt-2 text-success'></i> 월별 공급 실적 추이`;
        }
    },

    renderCharts: function(specs, monthly) {
        // 1) 공급가액 상위 10대 품목 (Top 10 by Amount) - 가로 바 차트
        const topAmountCtx = document.getElementById('topAmountBarChart');
        if (topAmountCtx) {
            if (this.topAmountChartInstance) this.topAmountChartInstance.destroy();
            const sortedByAmount = [...(specs || [])]
                .sort((a, b) => (b.totalSupplyAmount ?? b.spec_supply_amount ?? 0) - (a.totalSupplyAmount ?? a.spec_supply_amount ?? 0))
                .slice(0, 10);

            this.topAmountChartInstance = new Chart(topAmountCtx, {
                type: 'bar',
                data: {
                    labels: sortedByAmount.map((s, idx) => `${idx + 1}. ${s.item}${s.spec ? ' (' + s.spec + ')' : ''}`),
                    datasets: [{
                        label: '공급가액',
                        data: sortedByAmount.map(s => s.totalSupplyAmount ?? s.spec_supply_amount ?? 0),
                        backgroundColor: '#3b82f6',
                        borderRadius: 3,
                        barPercentage: 0.75
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => ` 공급가액: ${fmtWon(ctx.parsed.x)}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                font: { size: 9.5 },
                                callback: (v) => v >= 100000000 ? `${(v / 100000000).toFixed(1)}억` : (v >= 10000 ? `${(v / 10000).toFixed(0)}만` : v)
                            }
                        },
                        y: {
                            ticks: {
                                font: { size: 9.5 },
                                autoSkip: false
                            }
                        }
                    }
                }
            });
        }

        // 2) 공급수량 상위 10대 품목 (Top 10 by Quantity) - 가로 바 차트
        const topQtyCtx = document.getElementById('topQtyBarChart');
        if (topQtyCtx) {
            if (this.topQtyChartInstance) this.topQtyChartInstance.destroy();
            const sortedByQty = [...(specs || [])]
                .sort((a, b) => (b.totalQty ?? b.spec_qty ?? 0) - (a.totalQty ?? a.spec_qty ?? 0))
                .slice(0, 10);

            this.topQtyChartInstance = new Chart(topQtyCtx, {
                type: 'bar',
                data: {
                    labels: sortedByQty.map((s, idx) => `${idx + 1}. ${s.item}${s.spec ? ' (' + s.spec + ')' : ''}`),
                    datasets: [{
                        label: '공급수량',
                        data: sortedByQty.map(s => s.totalQty ?? s.spec_qty ?? 0),
                        backgroundColor: '#10b981',
                        borderRadius: 3,
                        barPercentage: 0.75
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (ctx) => {
                                    const itemObj = sortedByQty[ctx.dataIndex] || {};
                                    return ` 공급수량: ${fmtNumber(ctx.parsed.x)} ${itemObj.unit || 'EA'}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                font: { size: 9.5 },
                                callback: (v) => fmtNumber(v)
                            }
                        },
                        y: {
                            ticks: {
                                font: { size: 9.5 },
                                autoSkip: false
                            }
                        }
                    }
                }
            });
        }

        // 3) 월별 추이 바 차트
        const barCtx = document.getElementById('monthlyBarChart');
        if (barCtx) {
            if (this.monthlyChartInstance) this.monthlyChartInstance.destroy();
            this.monthlyChartInstance = new Chart(barCtx, {
                type: 'bar',
                data: {
                    labels: (monthly || []).map(m => m.month_str),
                    datasets: [{
                        label: '공급 물량 (EA)',
                        data: (monthly || []).map(m => m.month_qty ?? m.total_qty ?? 0),
                        backgroundColor: '#0ea5e9',
                        borderRadius: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: { ticks: { font: { size: 10 } } },
                        y: { ticks: { font: { size: 10 } } }
                    }
                }
            });
        }
    },

    // -------------------------------------------------------------------------
    // 범용 테이블 열 너비 드래그 조절 & 더블클릭 Auto-Fit (localStorage 저장)
    // -------------------------------------------------------------------------
    initTableColResize: function(tableId, storageKey, minWidth = 35) {
        const table = document.getElementById(tableId);
        if (!table) return;

        const ths = table.querySelectorAll('thead th');

        // 저장된 너비 복원
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
            ths.forEach((th, idx) => {
                if (saved[idx]) {
                    th.style.width = saved[idx] + 'px';
                    th.style.minWidth = saved[idx] + 'px';
                }
            });
        } catch (e) {}

        const saveWidths = () => {
            const widths = {};
            ths.forEach((th, idx) => {
                widths[idx] = th.offsetWidth;
            });
            try {
                localStorage.setItem(storageKey, JSON.stringify(widths));
            } catch (e) {}
        };

        ths.forEach((th, idx) => {
            // 마지막 컬럼 및 첫 번째 체크박스 제외
            if (idx === ths.length - 1) return;
            if (tableId === 'mainGridTable' && idx === 0) return;

            th.style.position = 'relative';

            // 중복 생성 방지
            if (th.querySelector('.col-resizer')) return;

            const resizer = document.createElement('div');
            resizer.className = 'col-resizer';
            th.appendChild(resizer);

            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                const diff = e.pageX - startX;
                const newWidth = Math.max(minWidth, startWidth + diff);
                th.style.width = newWidth + 'px';
                th.style.minWidth = newWidth + 'px';
            };

            const onMouseUp = () => {
                resizer.classList.remove('is-resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                saveWidths();
            };

            resizer.addEventListener('mousedown', (e) => {
                e.stopPropagation(); // 헤더 정렬 클릭 이벤트 방지
                startX = e.pageX;
                startWidth = th.offsetWidth;
                resizer.classList.add('is-resizing');
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // 더블클릭 시 최적 맞춤 Auto-Fit
            resizer.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                const cells = table.querySelectorAll(`tbody td:nth-child(${idx + 1})`);
                let maxLen = th.textContent.trim().length * 10 + 24;
                cells.forEach(c => {
                    const l = c.textContent.trim().length * 8 + 20;
                    if (l > maxLen) maxLen = l;
                });
                const fitWidth = Math.min(Math.max(45, maxLen), 450);
                th.style.width = fitWidth + 'px';
                th.style.minWidth = fitWidth + 'px';
                saveWidths();
            });
        });
    },

    initColResize: function() {
        this.initTableColResize('mainGridTable', 'kng_external_inout_col_widths_v2');
        this.initTableColResize('dashboardSpecTable', 'kng_external_inout_dash_col_widths_v1');
    }
};

// DOM 로드 완료 후 앱 기동
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
