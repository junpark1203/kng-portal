/**
 * 본사 매입 현황 — 실시간 재고 & 입출고·마진 통합 워크스페이스 Engine
 * - 올인원 통합 워크스페이스: [실시간 재고 현황] ⇄ [입출고 & 마진 원장] 무새로고침 즉시 전환
 * - 입고(IN) 시 인터넷 최저가(상품가 + 배송비 분리, VAT포함 기본 체크) 및 적정 판매가 설계
 * - 출고(OUT) 시 설정된 적정 판매가 자동 표기/자동 입력 및 출고단가 수정 시 실시간 판매마진(₩)·마진율(%) 산출
 * - 모든 마진 계산은 공급가(VAT별도, /1.1) 통일 기준으로 10% 부가세 착시 완벽 제거
 * - 체크박스 선택 품목 원클릭 [선택 입고] / [선택 출고] 전표 연동
 */

(function () {
    'use strict';

    // ==========================================
    // 1. Auth & API 설정
    // ==========================================
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
            if (window.parent && window.parent.getAuthToken) {
                token = await window.parent.getAuthToken();
            }
        } catch (e) {}
        if (!token) {
            try { token = await waitForAuth(); } catch (e) {}
        }
        if (!options.headers) options.headers = {};
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, options);
    }

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    // ==========================================
    // 2. State
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    const defaultTabByPath = window.location.pathname.includes('hq-transactions') ? 'transactions' : 'inventory';
    let activeWorkspace = urlParams.get('tab') || window.HQ_DEFAULT_TAB || defaultTabByPath; // 'inventory' | 'transactions'

    let products = [];
    let transactions = [];
    let metrics = { totalRevenue: 0, totalCost: 0 };

    let filteredInvList = [];
    let filteredTxList = [];

    const selectedInvIds = new Set();
    const selectedTxIds = new Set();
    let focusedRowIndex = -1;
    let viewMode = window.innerWidth <= 768 ? 'card' : 'table';

    // Inventory filter/sort state
    let invSort = { col: 'name', asc: true };
    let searchTarget = 'all';
    let searchQuery = '';
    let subSearchQuery = '';
    let stockFilter = 'all';
    let supplierFilter = '';

    // Transactions filter/sort state
    let txSort = { col: 'txDate', asc: false };
    let txTypeFilter = ''; // '', 'IN', 'OUT'
    let txStartDate = '';
    let txEndDate = '';
    let txSearchQuery = '';

    // Pagination state
    let page = 1;
    let pageSize = 50;

    // Modals & Voucher state
    let productModal = null;
    let voucherModal = null;
    let txEditModal = null;
    let voucherMode = 'IN'; // 'IN' | 'OUT'
    let voucherRowCounter = 0;

    // ==========================================
    // 3. Utility & Pricing Helpers (공급가 통일 마진 엔진)
    // ==========================================
    const $ = id => document.getElementById(id);
    const fmtNum = n => Number(Math.round(Number(n) || 0)).toLocaleString('ko-KR');
    const fmtWon = n => '₩' + fmtNum(n);
    const parseNumber = val => {
        if (val === null || val === undefined || val === '') return 0;
        return parseInt(String(val).replace(/[^0-9-]/g, ''), 10) || 0;
    };
    const escHtml = s => {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    };

    function todayStr() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * 부가세 포함 단가를 공급가(VAT별도)로 변환
     */
    function toSupplyPrice(amount, isVatIncluded) {
        const n = Number(amount) || 0;
        if (n <= 0) return 0;
        return isVatIncluded ? Math.round(n / 1.1) : Math.round(n);
    }

    /**
     * 품목 객체의 가격·마진 지표를 공급가 통일 기준으로 계산
     */
    function computeProductMetrics(p) {
        const buySupply = Number(p.buyPrice) || 0; // 매입단가는 항상 공급가(VAT별도)
        const basePrice = Number(p.basePrice) || 0;
        const freight = Number(p.freight) || 0;

        const onlinePrice = Number(p.onlinePrice) || 0;
        const onlineShipping = Number(p.onlineShipping) || 0;
        const onlineTotal = onlinePrice + onlineShipping;
        const onlineVatIncluded = p.onlineVatIncluded !== undefined ? Number(p.onlineVatIncluded) !== 0 : true;
        const onlineSupply = toSupplyPrice(onlineTotal, onlineVatIncluded);

        // 적정판매가 (기존 discountPrice나 sellPrice 완벽 계승)
        const sellPrice = Number(p.sellPrice || p.discountPrice) || 0;
        const sellVatIncluded = p.sellVatIncluded !== undefined ? Number(p.sellVatIncluded) !== 0 : true;
        const sellSupply = toSupplyPrice(sellPrice, sellVatIncluded);

        const unitMargin = sellSupply > 0 ? (sellSupply - buySupply) : 0;
        const marginRate = sellSupply > 0 ? Number(((unitMargin / sellSupply) * 100).toFixed(1)) : 0;
        const stock = Number(p.stock) || 0;
        const stockValue = buySupply * stock;

        return {
            buySupply,
            basePrice,
            freight,
            onlinePrice,
            onlineShipping,
            onlineTotal,
            onlineVatIncluded,
            onlineSupply,
            sellPrice,
            sellVatIncluded,
            sellSupply,
            unitMargin,
            marginRate,
            stock,
            stockValue
        };
    }

    /**
     * 거래 내역 객체의 마진 지표를 공급가 통일 기준으로 계산
     */
    function computeTxMetrics(t) {
        const qty = Number(t.qty) || 0;
        const txSupplyPrice = Number(t.price) || 0; // 거래 공급가 단가
        const totalAmount = txSupplyPrice * qty;

        // 연결된 품목 마스터 조회 (백업 참조용)
        const linkedProd = products.find(p => String(p.id) === String(t.productId)) ||
            products.find(p => p.brand === t.brand && p.name === t.productName && p.color === t.color && p.size === t.size);

        const buySupply = t.type === 'IN'
            ? txSupplyPrice
            : (Number(t.buyPrice) || Number(linkedProd?.buyPrice) || 0);

        const sellPrice = Number(t.sellPrice) || Number(linkedProd?.sellPrice || linkedProd?.discountPrice) || 0;
        const sellVatIncluded = t.sellVatIncluded !== undefined ? Number(t.sellVatIncluded) !== 0 : true;
        const sellSupply = toSupplyPrice(sellPrice, sellVatIncluded);

        const onlinePrice = Number(t.onlinePrice) || Number(linkedProd?.onlinePrice) || 0;
        const onlineShipping = Number(t.onlineShipping) || Number(linkedProd?.onlineShipping) || 0;
        const onlineTotal = onlinePrice + onlineShipping;

        const outVatIncluded = t.outVatIncluded !== undefined ? Number(t.outVatIncluded) !== 0 : false;
        const rawOutPrice = Number(t.rawOutPrice) || (outVatIncluded ? Math.round(txSupplyPrice * 1.1) : txSupplyPrice);

        let unitMargin = 0;
        let totalMargin = 0;
        let marginRate = 0;

        if (t.type === 'OUT') {
            unitMargin = (t.marginAmount !== undefined && t.marginAmount !== null && Number(t.marginAmount) !== 0)
                ? Number(t.marginAmount)
                : (txSupplyPrice - buySupply);
            totalMargin = unitMargin * qty;
            marginRate = txSupplyPrice > 0 ? Number(((unitMargin / txSupplyPrice) * 100).toFixed(1)) : 0;
        } else {
            // IN 거래의 경우 설정한 적정판매가 기준 예상 마진
            unitMargin = sellSupply > 0 ? (sellSupply - buySupply) : 0;
            totalMargin = unitMargin * qty;
            marginRate = sellSupply > 0 ? Number(((unitMargin / sellSupply) * 100).toFixed(1)) : 0;
        }

        return {
            qty,
            txSupplyPrice,
            totalAmount,
            buySupply,
            sellPrice,
            sellVatIncluded,
            sellSupply,
            onlinePrice,
            onlineShipping,
            onlineTotal,
            outVatIncluded,
            rawOutPrice,
            unitMargin,
            totalMargin,
            marginRate
        };
    }

    function getMarginBadgeClass(rate) {
        if (rate >= 22) return 'margin-high';
        if (rate >= 10) return 'margin-mid';
        return 'margin-low';
    }

    function showToast(msg, type = 'info') {
        const c = $('toastContainer');
        if (!c) return;
        const icons = {
            success: 'bx-check-circle',
            error: 'bx-error-circle',
            warning: 'bx-error',
            info: 'bx-info-circle'
        };
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.innerHTML = `<i class='bx ${icons[type] || icons.info} fs-5'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => t.remove(), 250);
        }, 3200);
    }

    function formatMoneyInput(el) {
        if (!el) return;
        const raw = el.value.replace(/[^0-9-]/g, '');
        if (raw === '' || raw === '-') {
            el.value = raw;
            return;
        }
        el.value = fmtNum(parseInt(raw, 10) || 0);
    }

    function clearZero(el) {
        if (!el) return;
        if (el.value === '0') el.value = '';
        el.select();
    }

    // ==========================================
    // 4. API Data Fetching & Sync
    // ==========================================
    async function loadAllData() {
        await Promise.all([fetchProducts(), fetchTransactions(), fetchMetrics()]);
        updateTopKpiBadges();
    }

    async function fetchProducts() {
        try {
            const res = await authFetch(API_BASE + '/products');
            if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
            products = await res.json();
            buildSupplierTabs();
            renderInventory();
            initGridResizer();
            applyViewMode();
            updateTopKpiBadges();
        } catch (e) {
            showToast('상품 목록 로딩 실패: ' + e.message, 'error');
            if ($('tableBody')) {
                $('tableBody').innerHTML = `<tr><td colspan="15" class="text-center py-5 text-danger"><i class='bx bx-error-circle'></i> 재고 데이터를 불러오지 못했습니다 (${escHtml(e.message)})</td></tr>`;
            }
        }
    }

    async function fetchTransactions() {
        try {
            const res = await authFetch(API_BASE + '/transactions');
            if (!res.ok) throw new Error('서버 응답 오류 (' + res.status + ')');
            transactions = await res.json();
            renderTransactions();
            initGridResizer();
            applyViewMode();
            updateTopKpiBadges();
        } catch (e) {
            showToast('입출고 원장 로딩 실패: ' + e.message, 'error');
            if ($('txTableBody')) {
                $('txTableBody').innerHTML = `<tr><td colspan="15" class="text-center py-5 text-danger"><i class='bx bx-error-circle'></i> 입출고 데이터를 불러오지 못했습니다 (${escHtml(e.message)})</td></tr>`;
            }
        }
    }

    async function fetchMetrics() {
        try {
            const res = await authFetch(API_BASE + '/metrics');
            if (!res.ok) return;
            metrics = await res.json();
            updateTopKpiBadges();
        } catch (e) { /* silent */ }
    }

    function updateTopKpiBadges() {
        const skuCount = products.length;
        let totalStockQty = 0;
        let totalStockVal = 0;
        products.forEach(p => {
            const m = computeProductMetrics(p);
            totalStockQty += m.stock;
            totalStockVal += m.stockValue;
        });

        let outRevenueSum = 0;
        let outMarginSum = 0;
        let inCostSum = 0;
        transactions.forEach(t => {
            const tm = computeTxMetrics(t);
            if (t.type === 'OUT') {
                outRevenueSum += tm.totalAmount;
                outMarginSum += tm.totalMargin;
            } else if (t.type === 'IN') {
                inCostSum += tm.totalAmount;
            }
        });

        const revDisplay = outRevenueSum || Number(metrics.totalRevenue) || 0;
        const costDisplay = inCostSum || Number(metrics.totalCost) || 0;
        const avgRealizedMarginRate = outRevenueSum > 0 ? ((outMarginSum / outRevenueSum) * 100).toFixed(1) : '0.0';

        if ($('wsCountInv')) $('wsCountInv').textContent = fmtNum(skuCount);
        if ($('mobWsCountInv')) $('mobWsCountInv').textContent = fmtNum(skuCount);
        if ($('wsCountTx')) $('wsCountTx').textContent = fmtNum(transactions.length);
        if ($('mobWsCountTx')) $('mobWsCountTx').textContent = fmtNum(transactions.length);

        if ($('skuCountBadge')) $('skuCountBadge').textContent = `관리 ${fmtNum(skuCount)} SKU`;
        if ($('totalQtyBadge')) $('totalQtyBadge').textContent = `현재고: ${fmtNum(totalStockQty)}개`;
        if ($('totalStockValueBadge')) $('totalStockValueBadge').textContent = `재고원가: ${fmtWon(totalStockVal)}`;
        if ($('kpiRevenueBadge')) $('kpiRevenueBadge').textContent = `출고매출: ${fmtWon(revDisplay)}`;
        if ($('kpiRealizedMarginBadge')) {
            $('kpiRealizedMarginBadge').textContent = `실현마진: ${fmtWon(outMarginSum)} (${avgRealizedMarginRate}%)`;
        }
        if ($('kpiCostBadge')) $('kpiCostBadge').textContent = `누적매입: ${fmtWon(costDisplay)}`;

        // 모바일 상단 KPI
        if ($('mobileKpiQty')) $('mobileKpiQty').textContent = fmtNum(totalStockQty);
        if ($('mobileKpiStockVal')) $('mobileKpiStockVal').textContent = fmtWon(totalStockVal);
        if ($('mobileKpiRevenue')) $('mobileKpiRevenue').textContent = fmtWon(revDisplay);
        if ($('mobileKpiMargin')) $('mobileKpiMargin').textContent = `${fmtWon(outMarginSum)} (${avgRealizedMarginRate}%)`;
        if ($('mobileKpiCost')) $('mobileKpiCost').textContent = fmtWon(costDisplay);
    }

    // ==========================================
    // 5. 올인원 워크스페이스 전환 (실시간 재고 ⇄ 입출고 & 마진 원장)
    // ==========================================
    function switchWorkspace(mode) {
        activeWorkspace = mode === 'transactions' ? 'transactions' : 'inventory';
        page = 1;
        focusedRowIndex = -1;

        const isInv = activeWorkspace === 'inventory';
        if ($('workspaceInventory')) $('workspaceInventory').classList.toggle('d-none', !isInv);
        if ($('workspaceTransactions')) $('workspaceTransactions').classList.toggle('d-none', isInv);

        if ($('wsBtnInventory')) $('wsBtnInventory').classList.toggle('active', isInv);
        if ($('wsBtnTransactions')) $('wsBtnTransactions').classList.toggle('active', !isInv);
        if ($('mobWsBtnInventory')) $('mobWsBtnInventory').classList.toggle('active', isInv);
        if ($('mobWsBtnTransactions')) $('mobWsBtnTransactions').classList.toggle('active', !isInv);

        if ($('mobStockFilterBar')) $('mobStockFilterBar').classList.toggle('d-none', !isInv);
        if ($('mobTxTypeFilterBar')) $('mobTxTypeFilterBar').classList.toggle('d-none', isInv);
        if ($('btnQuoteCart')) $('btnQuoteCart').classList.toggle('d-none', !isInv);

        if ($('printReportTitle')) {
            $('printReportTitle').textContent = isInv
                ? '본사 매입 현황 — 실시간 재고 및 적정판매가·마진 보고서'
                : '본사 매입 현황 — 입출고 및 실현 판매마진 원장 보고서';
        }

        if (isInv) {
            renderInventory();
        } else {
            renderTransactions();
        }
        updateSelectedUI();
        applyViewMode();
        initGridResizer();
    }

    // ==========================================
    // 6. 공급사 탭 생성
    // ==========================================
    function buildSupplierTabs() {
        const suppliersMap = {};
        products.forEach(p => {
            const s = (p.supplier || '최가유통').trim();
            suppliersMap[s] = (suppliersMap[s] || 0) + 1;
        });

        const sortedSuppliers = Object.keys(suppliersMap).sort();
        const tabGroup = $('supplierTabGroup');
        if (tabGroup) {
            let html = `
                <button type="button" class="erp-tab-btn ${supplierFilter === '' ? 'active' : ''}" data-supplier="" onclick="app.setSupplierFilter('')">
                    전체 <span class="erp-tab-badge" id="tabCountAll">${products.length}</span>
                </button>
            `;
            sortedSuppliers.forEach(s => {
                const isActive = supplierFilter === s ? 'active' : '';
                html += `
                    <button type="button" class="erp-tab-btn ${isActive}" data-supplier="${escHtml(s)}" onclick="app.setSupplierFilter('${escHtml(s)}')">
                        ${escHtml(s)} <span class="erp-tab-badge">${suppliersMap[s]}</span>
                    </button>
                `;
            });
            tabGroup.innerHTML = html;
        }

        const mobTrack = $('mobileSupplierScrollTrack');
        if (mobTrack) {
            let mobHtml = `
                <button type="button" class="mobile-supplier-chip ${supplierFilter === '' ? 'active' : ''}" onclick="app.setSupplierFilter('')">
                    전체 <span class="chip-count">${products.length}</span>
                </button>
            `;
            sortedSuppliers.forEach(s => {
                const isActive = supplierFilter === s ? 'active' : '';
                mobHtml += `
                    <button type="button" class="mobile-supplier-chip ${isActive}" onclick="app.setSupplierFilter('${escHtml(s)}')">
                        ${escHtml(s)} <span class="chip-count">${suppliersMap[s]}</span>
                    </button>
                `;
            });
            mobTrack.innerHTML = mobHtml;
        }
    }

    // ==========================================
    // 7. [WORKSPACE 1] 실시간 재고 현황 렌더링
    // ==========================================
    function filterAndSortInventory() {
        const qTokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
        const subTokens = subSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);

        filteredInvList = products.filter(p => {
            const s = (p.supplier || '최가유통').trim();
            if (supplierFilter && s !== supplierFilter) return false;

            const stock = Number(p.stock) || 0;
            if (stockFilter === 'in_stock' && stock <= 0) return false;
            if (stockFilter === 'low_stock' && (stock <= 0 || stock > 2)) return false;
            if (stockFilter === 'out_of_stock' && stock > 0) return false;

            if (qTokens.length > 0) {
                const targetStr = searchTarget === 'all'
                    ? `${p.supplier || ''} ${p.brand || ''} ${p.name || ''} ${p.color || ''} ${p.size || ''}`.toLowerCase()
                    : String(p[searchTarget] || '').toLowerCase();
                if (!qTokens.every(t => targetStr.includes(t))) return false;
            }

            if (subTokens.length > 0) {
                const allStr = `${p.supplier || ''} ${p.brand || ''} ${p.name || ''} ${p.color || ''} ${p.size || ''}`.toLowerCase();
                if (!subTokens.every(t => allStr.includes(t))) return false;
            }

            return true;
        });

        filteredInvList.sort((a, b) => {
            const ma = computeProductMetrics(a);
            const mb = computeProductMetrics(b);
            let va, vb;

            switch (invSort.col) {
                case 'buyPrice': va = ma.buySupply; vb = mb.buySupply; break;
                case 'onlineTotal': va = ma.onlineTotal; vb = mb.onlineTotal; break;
                case 'sellPrice': va = ma.sellPrice; vb = mb.sellPrice; break;
                case 'unitMargin': va = ma.unitMargin; vb = mb.unitMargin; break;
                case 'marginRate': va = ma.marginRate; vb = mb.marginRate; break;
                case 'stock': va = ma.stock; vb = mb.stock; break;
                case 'stockValue': va = ma.stockValue; vb = mb.stockValue; break;
                default:
                    va = String(a[invSort.col] || '').toLowerCase();
                    vb = String(b[invSort.col] || '').toLowerCase();
            }

            if (va < vb) return invSort.asc ? -1 : 1;
            if (va > vb) return invSort.asc ? 1 : -1;
            return 0;
        });
    }

    function renderInventory() {
        filterAndSortInventory();

        const tbody = $('tableBody');
        const tfoot = $('tableFoot');
        if (!tbody) return;

        // 정렬 아이콘 업데이트
        document.querySelectorAll('#inventoryTable thead th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.className = 'bx bx-sort sort-icon';
            if (th.dataset.sort === invSort.col) {
                th.classList.add(invSort.asc ? 'sort-asc' : 'sort-desc');
                if (icon) icon.className = `bx ${invSort.asc ? 'bx-up-arrow-alt' : 'bx-down-arrow-alt'} sort-icon`;
            }
        });

        const total = filteredInvList.length;
        const limit = pageSize === 'all' ? (total || 1) : Number(pageSize);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        if (page > totalPages) page = totalPages;

        const startIdx = (page - 1) * limit;
        const pageItems = pageSize === 'all' ? filteredInvList : filteredInvList.slice(startIdx, startIdx + limit);

        if (total === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-5 text-muted">
                        <i class='bx bx-package fs-3 d-block mb-1'></i>
                        조건에 일치하는 재고 품목이 없습니다.
                    </td>
                </tr>
            `;
            if (tfoot) tfoot.classList.add('d-none');
        } else {
            tbody.innerHTML = pageItems.map((p, idx) => {
                const m = computeProductMetrics(p);
                const isChecked = selectedInvIds.has(String(p.id));
                const no = startIdx + idx + 1;

                let stockBadgeClass = 'stock-ok';
                if (m.stock <= 0) stockBadgeClass = 'stock-out';
                else if (m.stock <= 2) stockBadgeClass = 'stock-low';

                // 매입단가(공급가) 표시 + 상품가/운임 힌트
                const buyDetailHint = (m.basePrice > 0 || m.freight > 0)
                    ? `<span class="price-sub">상품 ${fmtNum(m.basePrice)}${m.freight > 0 ? ` + 운임 ${fmtNum(m.freight)}` : ''}</span>`
                    : `<span class="price-sub">VAT별도 공급가</span>`;

                // 인터넷 최저가 (상품가 + 배송비 분리 표시)
                const onlineDisplay = m.onlineTotal > 0
                    ? `<div class="price-stack">
                           <span class="price-main text-dark">${fmtWon(m.onlineTotal)}</span>
                           <span class="price-sub">상품 ${fmtNum(m.onlinePrice)} + 배송 ${fmtNum(m.onlineShipping)}</span>
                       </div>`
                    : `<span class="text-muted">-</span>`;

                // 적정 판매가 (VAT포함 여부 + 공급가 환산 표시)
                const sellDisplay = m.sellPrice > 0
                    ? `<div class="price-stack">
                           <span class="price-main text-primary">${fmtWon(m.sellPrice)}</span>
                           <span class="price-sub">${m.sellVatIncluded ? `공급가 ${fmtWon(m.sellSupply)}` : 'VAT별도'}</span>
                       </div>`
                    : `<span class="text-muted">미설정</span>`;

                // 예상 판매마진 (공급가 기준)
                const marginWonDisplay = m.sellPrice > 0
                    ? `<div class="price-stack">
                           <span class="price-main ${m.unitMargin >= 0 ? 'text-success' : 'text-danger'}">${m.unitMargin >= 0 ? '+' : ''}${fmtWon(m.unitMargin)}</span>
                           <span class="price-sub">공급가 차익</span>
                       </div>`
                    : `<span class="text-muted">-</span>`;

                // 마진율 배지
                const marginRateDisplay = m.sellPrice > 0
                    ? `<span class="margin-badge ${getMarginBadgeClass(m.marginRate)}">${m.marginRate.toFixed(1)}%</span>`
                    : `<span class="text-muted">-</span>`;

                return `
                    <tr class="${isChecked ? 'selected-row' : ''}" onclick="app.onRowClick(event, '${escHtml(p.id)}', ${idx})" ondblclick="app.openEditModal('${escHtml(p.id)}')">
                        <td class="col-check no-print" onclick="event.stopPropagation()">
                            <input type="checkbox" class="row-check" value="${escHtml(p.id)}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${escHtml(p.id)}', this.checked)">
                        </td>
                        <td class="col-no">${no}</td>
                        <td class="text-center"><span class="supplier-tag">${escHtml(p.supplier || '최가유통')}</span></td>
                        <td class="text-start ps-2 fw-semibold text-secondary">${escHtml(p.brand || '-')}</td>
                        <td class="text-start ps-2 fw-bold text-dark">${escHtml(p.name || '-')}</td>
                        <td class="text-center">${escHtml(p.color || '-')}</td>
                        <td class="text-center"><span class="size-badge">${escHtml(p.size || '-')}</span></td>
                        <td class="col-num pe-2">
                            <div class="price-stack">
                                <span class="price-main">${fmtWon(m.buySupply)}</span>
                                ${buyDetailHint}
                            </div>
                        </td>
                        <td class="col-num pe-2">${onlineDisplay}</td>
                        <td class="col-num pe-2">${sellDisplay}</td>
                        <td class="col-num pe-2">${marginWonDisplay}</td>
                        <td class="text-center">${marginRateDisplay}</td>
                        <td class="text-center">
                            <span class="stock-pill ${stockBadgeClass}">${fmtNum(m.stock)}</span>
                        </td>
                        <td class="col-num pe-2 fw-bold" style="color:#047857;">${fmtWon(m.stockValue)}</td>
                        <td class="col-action text-center no-print" onclick="event.stopPropagation()">
                            <div class="d-inline-flex align-items-center gap-1">
                                <button type="button" class="btn-apply-mini" onclick="app.openVoucherForSingleProduct('${escHtml(p.id)}', 'IN')" title="이 품목 바로 입고 및 적정판매가 설정">입고</button>
                                <button type="button" class="btn-apply-mini" style="color:#b45309; background:#fef3c7; border-color:#fde68a;" onclick="app.openVoucherForSingleProduct('${escHtml(p.id)}', 'OUT')" title="이 품목 바로 출고 (적정판매가 자동 표기)">출고</button>
                                <button type="button" class="btn-row-edit" onclick="app.openEditModal('${escHtml(p.id)}')" title="품목 마스터 수정">수정</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // 하단 합계/평균 푸터 업데이트
            if (tfoot) {
                tfoot.classList.remove('d-none');
                let sumBuy = 0, sumOnline = 0, cntOnline = 0, sumSell = 0, cntSell = 0, sumMarginWon = 0, sumMarginRate = 0, sumStock = 0, sumStockVal = 0;

                filteredInvList.forEach(p => {
                    const m = computeProductMetrics(p);
                    sumBuy += m.buySupply;
                    if (m.onlineTotal > 0) { sumOnline += m.onlineTotal; cntOnline++; }
                    if (m.sellPrice > 0) {
                        sumSell += m.sellPrice;
                        sumMarginWon += m.unitMargin;
                        sumMarginRate += m.marginRate;
                        cntSell++;
                    }
                    sumStock += m.stock;
                    sumStockVal += m.stockValue;
                });

                const avgBuy = total > 0 ? Math.round(sumBuy / total) : 0;
                const avgOnline = cntOnline > 0 ? Math.round(sumOnline / cntOnline) : 0;
                const avgSell = cntSell > 0 ? Math.round(sumSell / cntSell) : 0;
                const avgMarginWon = cntSell > 0 ? Math.round(sumMarginWon / cntSell) : 0;
                const avgMarginRate = cntSell > 0 ? (sumMarginRate / cntSell).toFixed(1) : '0.0';

                if ($('footSummaryText')) $('footSummaryText').textContent = `조회 품목 총 ${fmtNum(total)}개 SKU (평균 단가 / 총 재고 합계)`;
                if ($('footAvgBuyPrice')) $('footAvgBuyPrice').textContent = `평균 ${fmtWon(avgBuy)}`;
                if ($('footAvgOnlinePrice')) $('footAvgOnlinePrice').textContent = cntOnline > 0 ? `평균 ${fmtWon(avgOnline)}` : '-';
                if ($('footAvgSellPrice')) $('footAvgSellPrice').textContent = cntSell > 0 ? `평균 ${fmtWon(avgSell)}` : '-';
                if ($('footAvgUnitMargin')) $('footAvgUnitMargin').textContent = cntSell > 0 ? `평균 ${fmtWon(avgMarginWon)}` : '-';
                if ($('footAvgMargin')) $('footAvgMargin').textContent = cntSell > 0 ? `${avgMarginRate}%` : '-';
                if ($('footTotalStock')) $('footTotalStock').textContent = `${fmtNum(sumStock)}개`;
                if ($('footTotalStockValue')) $('footTotalStockValue').textContent = fmtWon(sumStockVal);
            }
        }

        renderMobileInventoryCards(pageItems);
        if (activeWorkspace === 'inventory') {
            renderPagination(total, totalPages);
            if ($('bottomPageInfo')) $('bottomPageInfo').textContent = `실시간 재고 총 ${fmtNum(total)}건 조회됨`;
        }
    }

    function renderMobileInventoryCards(pageItems) {
        const container = $('mobileCardsContainer');
        if (!container) return;

        if (pageItems.length === 0) {
            container.innerHTML = `<div class="text-center py-5 text-muted"><i class='bx bx-package fs-1 mb-2'></i><div>조건에 맞는 상품이 없습니다.</div></div>`;
            return;
        }

        container.innerHTML = pageItems.map(p => {
            const m = computeProductMetrics(p);
            const isChecked = selectedInvIds.has(String(p.id));
            let stockClass = 'stock-ok', stockLabel = `재고 ${fmtNum(m.stock)}개`;
            if (m.stock <= 0) { stockClass = 'stock-out'; stockLabel = '품절 (0개)'; }
            else if (m.stock <= 2) { stockClass = 'stock-low'; stockLabel = `부족 (${fmtNum(m.stock)}개)`; }

            return `
                <div class="mobile-inv-card ${isChecked ? 'card-selected' : ''}" onclick="app.openEditModal('${escHtml(p.id)}')">
                    <div class="card-top-row">
                        <div class="d-flex align-items-center gap-2" onclick="event.stopPropagation()">
                            <input type="checkbox" class="form-check-input mt-0" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${escHtml(p.id)}', this.checked)">
                            <span class="supplier-badge">${escHtml(p.supplier || '최가유통')}</span>
                            <span class="brand-badge">${escHtml(p.brand || '-')}</span>
                        </div>
                        <span class="mobile-stock-badge ${stockClass}">${stockLabel}</span>
                    </div>
                    <div class="card-title-row">
                        <div class="product-title">${escHtml(p.name || '-')}</div>
                        <div class="product-spec">${escHtml(p.color || '-')} / ${escHtml(p.size || '-')}</div>
                    </div>
                    <div class="card-price-grid">
                        <div class="price-box">
                            <span class="price-label">매입단가(공급가)</span>
                            <span class="price-val">${fmtWon(m.buySupply)}</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">인터넷최저가(합계)</span>
                            <span class="price-val text-secondary">${m.onlineTotal > 0 ? fmtWon(m.onlineTotal) : '-'}</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">적정 판매가</span>
                            <span class="price-val text-primary fw-bold">${m.sellPrice > 0 ? fmtWon(m.sellPrice) : '미설정'}</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">예상마진 / 마진율</span>
                            <span class="price-val text-success fw-bold">${m.sellPrice > 0 ? `${fmtWon(m.unitMargin)} (${m.marginRate.toFixed(1)}%)` : '-'}</span>
                        </div>
                    </div>
                    <div class="d-flex justify-content-end gap-1 mt-2 pt-2 border-top" onclick="event.stopPropagation()">
                        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11px;" onclick="app.openVoucherForSingleProduct('${escHtml(p.id)}', 'IN')">+ 입고등록</button>
                        <button type="button" class="btn btn-sm btn-outline-warning text-dark py-0 px-2" style="font-size:11px;" onclick="app.openVoucherForSingleProduct('${escHtml(p.id)}', 'OUT')">↗ 출고등록</button>
                        <button type="button" class="btn btn-sm btn-light border py-0 px-2" style="font-size:11px;" onclick="app.openEditModal('${escHtml(p.id)}')">수정</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // 8. [WORKSPACE 2] 입출고 & 마진 원장 렌더링
    // ==========================================
    function filterAndSortTransactions() {
        const qTokens = (txSearchQuery || searchQuery).toLowerCase().split(/\s+/).filter(Boolean);

        filteredTxList = transactions.filter(t => {
            if (supplierFilter && (t.supplier || '').trim() !== supplierFilter) return false;
            if (txTypeFilter && t.type !== txTypeFilter) return false;
            if (txStartDate && (t.txDate || '') < txStartDate) return false;
            if (txEndDate && (t.txDate || '') > txEndDate) return false;

            if (qTokens.length > 0) {
                const hay = `${t.supplier || ''} ${t.brand || ''} ${t.productName || ''} ${t.color || ''} ${t.size || ''} ${t.remarks || ''}`.toLowerCase();
                if (!qTokens.every(tok => hay.includes(tok))) return false;
            }
            return true;
        });

        filteredTxList.sort((a, b) => {
            const ma = computeTxMetrics(a);
            const mb = computeTxMetrics(b);
            let va, vb;

            switch (txSort.col) {
                case 'qty': va = ma.qty; vb = mb.qty; break;
                case 'price': va = ma.txSupplyPrice; vb = mb.txSupplyPrice; break;
                case 'totalAmount': va = ma.totalAmount; vb = mb.totalAmount; break;
                case 'totalMargin': va = ma.totalMargin; vb = mb.totalMargin; break;
                case 'txDate':
                    va = `${a.txDate || ''}_${String(a.id).padStart(10, '0')}`;
                    vb = `${b.txDate || ''}_${String(b.id).padStart(10, '0')}`;
                    break;
                default:
                    va = String(a[txSort.col] || '').toLowerCase();
                    vb = String(b[txSort.col] || '').toLowerCase();
            }

            if (va < vb) return txSort.asc ? -1 : 1;
            if (va > vb) return txSort.asc ? 1 : -1;
            return 0;
        });
    }

    function renderTransactions() {
        filterAndSortTransactions();

        const tbody = $('txTableBody');
        const tfoot = $('txTableFoot');
        if (!tbody) return;

        // 조회기간 요약 리본 업데이트
        let sumIn = 0, sumOut = 0, sumOutMargin = 0, sumQty = 0;
        filteredTxList.forEach(t => {
            const tm = computeTxMetrics(t);
            sumQty += tm.qty;
            if (t.type === 'IN') {
                sumIn += tm.totalAmount;
            } else {
                sumOut += tm.totalAmount;
                sumOutMargin += tm.totalMargin;
            }
        });
        const periodMarginRate = sumOut > 0 ? ((sumOutMargin / sumOut) * 100).toFixed(1) : '0.0';

        if ($('txRibbonInSum')) $('txRibbonInSum').textContent = fmtWon(sumIn);
        if ($('txRibbonOutSum')) $('txRibbonOutSum').textContent = fmtWon(sumOut);
        if ($('txRibbonMarginSum')) $('txRibbonMarginSum').textContent = `${fmtWon(sumOutMargin)} (${periodMarginRate}%)`;

        const total = filteredTxList.length;
        const limit = pageSize === 'all' ? (total || 1) : Number(pageSize);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        if (page > totalPages) page = totalPages;

        const startIdx = (page - 1) * limit;
        const pageItems = pageSize === 'all' ? filteredTxList : filteredTxList.slice(startIdx, startIdx + limit);

        if (total === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-5 text-muted">
                        <i class='bx bx-transfer-alt fs-3 d-block mb-1'></i>
                        조회된 입출고 내역이 없습니다.
                    </td>
                </tr>
            `;
            if (tfoot) tfoot.classList.add('d-none');
        } else {
            tbody.innerHTML = pageItems.map((t, idx) => {
                const tm = computeTxMetrics(t);
                const isChecked = selectedTxIds.has(String(t.id));
                const no = startIdx + idx + 1;
                const isOut = t.type === 'OUT';

                const typeBadge = isOut
                    ? `<span class="tx-badge tx-badge-out">↗ 출고</span>`
                    : `<span class="tx-badge tx-badge-in">📥 입고</span>`;

                // 매입단가(원가)
                const buyCostCell = !isOut && (Number(t.basePrice) > 0 || Number(t.freight) > 0)
                    ? `<div class="price-stack">
                           <span class="price-main">${fmtWon(tm.buySupply)}</span>
                           <span class="price-sub">상품 ${fmtNum(t.basePrice)} + 운임 ${fmtNum(t.freight)}</span>
                       </div>`
                    : `<div class="price-stack">
                           <span class="price-main">${fmtWon(tm.buySupply)}</span>
                           <span class="price-sub">공급가 원가</span>
                       </div>`;

                // 적정판매가(기준) & 인터넷최저가
                const targetSellCell = tm.sellPrice > 0
                    ? `<div class="price-stack">
                           <span class="price-main text-primary">${fmtWon(tm.sellPrice)}</span>
                           <span class="price-sub">${tm.onlineTotal > 0 ? `최저가 ${fmtWon(tm.onlineTotal)}` : `공급가 ${fmtWon(tm.sellSupply)}`}</span>
                       </div>`
                    : `<span class="text-muted">-</span>`;

                // 거래 단가
                const txPriceCell = isOut
                    ? `<div class="price-stack">
                           <span class="price-main fw-bold" style="color:#b45309;">${fmtWon(tm.txSupplyPrice)}</span>
                           <span class="price-sub">${tm.outVatIncluded ? `VAT포함 ${fmtWon(tm.rawOutPrice)}` : '공급가 기준'}</span>
                       </div>`
                    : `<div class="price-stack">
                           <span class="price-main fw-bold text-primary">${fmtWon(tm.txSupplyPrice)}</span>
                           <span class="price-sub">입고 공급가</span>
                       </div>`;

                // 판매마진 / 마진율
                const marginCell = isOut
                    ? `<div class="price-stack">
                           <span class="price-main ${tm.totalMargin >= 0 ? 'text-success' : 'text-danger'}">
                               ${tm.totalMargin >= 0 ? '+' : ''}${fmtWon(tm.totalMargin)}
                               <span class="margin-badge ${getMarginBadgeClass(tm.marginRate)} ms-1">${tm.marginRate.toFixed(1)}%</span>
                           </span>
                           <span class="price-sub">개당 ${tm.unitMargin >= 0 ? '+' : ''}${fmtWon(tm.unitMargin)}</span>
                       </div>`
                    : (tm.sellPrice > 0
                        ? `<div class="price-stack">
                               <span class="price-sub">예상마진 ${fmtWon(tm.unitMargin)}</span>
                               <span class="margin-badge ${getMarginBadgeClass(tm.marginRate)}">${tm.marginRate.toFixed(1)}%</span>
                           </div>`
                        : `<span class="text-muted">-</span>`);

                return `
                    <tr class="${isChecked ? 'selected-row' : ''}" ondblclick="app.openTxEditModal(${t.id})">
                        <td class="col-check no-print" onclick="event.stopPropagation()">
                            <input type="checkbox" class="tx-row-check" value="${t.id}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${t.id}', this.checked)">
                        </td>
                        <td class="col-no">${no}</td>
                        <td class="text-center font-monospace">${escHtml(t.txDate || '-')}</td>
                        <td class="text-center">${typeBadge}</td>
                        <td class="text-center"><span class="supplier-tag">${escHtml(t.supplier || '-')}</span></td>
                        <td class="text-start ps-2 fw-semibold text-secondary">${escHtml(t.brand || '-')}</td>
                        <td class="text-start ps-2 fw-bold text-dark">${escHtml(t.productName || '-')}</td>
                        <td class="text-center">${escHtml(t.color || '-')} / <span class="size-badge">${escHtml(t.size || '-')}</span></td>
                        <td class="text-center fw-bold ${isOut ? 'text-danger' : 'text-primary'}">${isOut ? '-' : '+'}${fmtNum(tm.qty)}</td>
                        <td class="col-num pe-2">${buyCostCell}</td>
                        <td class="col-num pe-2">${targetSellCell}</td>
                        <td class="col-num pe-2">${txPriceCell}</td>
                        <td class="col-num pe-2 fw-bold">${fmtWon(tm.totalAmount)}</td>
                        <td class="col-num pe-2">${marginCell}</td>
                        <td class="text-start ps-2 no-print" onclick="event.stopPropagation()">
                            <div class="d-flex align-items-center justify-content-between gap-1">
                                <span class="text-muted text-truncate" style="max-width: 82px;" title="${escHtml(t.remarks || '')}">${escHtml(t.remarks || '-')}</span>
                                <button type="button" class="btn-row-edit" onclick="app.openTxEditModal(${t.id})">수정</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            if (tfoot) {
                tfoot.classList.remove('d-none');
                if ($('txFootSummaryText')) $('txFootSummaryText').textContent = `조회 총 ${fmtNum(total)}건 (매입 ${fmtWon(sumIn)} / 출고 ${fmtWon(sumOut)})`;
                if ($('txFootTotalQty')) $('txFootTotalQty').textContent = `${fmtNum(sumQty)}개`;
                if ($('txFootTotalAmount')) $('txFootTotalAmount').textContent = fmtWon(sumIn + sumOut);
                if ($('txFootTotalMargin')) $('txFootTotalMargin').textContent = `${fmtWon(sumOutMargin)} (${periodMarginRate}%)`;
            }
        }

        renderMobileTxCards(pageItems);
        if (activeWorkspace === 'transactions') {
            renderPagination(total, totalPages);
            if ($('bottomPageInfo')) $('bottomPageInfo').textContent = `입출고 내역 총 ${fmtNum(total)}건 조회됨`;
        }
    }

    function renderMobileTxCards(pageItems) {
        const container = $('mobileTxCardsContainer');
        if (!container) return;

        if (pageItems.length === 0) {
            container.innerHTML = `<div class="text-center py-5 text-muted"><i class='bx bx-transfer-alt fs-1 mb-2'></i><div>조회된 입출고 내역이 없습니다.</div></div>`;
            return;
        }

        container.innerHTML = pageItems.map(t => {
            const tm = computeTxMetrics(t);
            const isOut = t.type === 'OUT';
            return `
                <div class="mobile-inv-card" onclick="app.openTxEditModal(${t.id})">
                    <div class="card-top-row">
                        <div class="d-flex align-items-center gap-2">
                            <span class="tx-badge ${isOut ? 'tx-badge-out' : 'tx-badge-in'}">${isOut ? '출고' : '입고'}</span>
                            <span class="small text-muted font-monospace">${escHtml(t.txDate || '')}</span>
                            <span class="supplier-badge">${escHtml(t.supplier || '-')}</span>
                        </div>
                        <span class="fw-bold ${isOut ? 'text-danger' : 'text-primary'}">${isOut ? '-' : '+'}${fmtNum(tm.qty)}개</span>
                    </div>
                    <div class="card-title-row">
                        <div class="product-title">[${escHtml(t.brand || '-')}] ${escHtml(t.productName || '-')}</div>
                        <div class="product-spec">${escHtml(t.color || '-')} / ${escHtml(t.size || '-')}</div>
                    </div>
                    <div class="card-price-grid">
                        <div class="price-box">
                            <span class="price-label">매입원가(공급가)</span>
                            <span class="price-val">${fmtWon(tm.buySupply)}</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">적정판매가</span>
                            <span class="price-val text-primary">${tm.sellPrice > 0 ? fmtWon(tm.sellPrice) : '-'}</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">거래단가 / 합계</span>
                            <span class="price-val fw-bold">${fmtWon(tm.txSupplyPrice)} (${fmtWon(tm.totalAmount)})</span>
                        </div>
                        <div class="price-box">
                            <span class="price-label">${isOut ? '실현 판매마진' : '예상 마진율'}</span>
                            <span class="price-val text-success fw-bold">${isOut ? `${fmtWon(tm.totalMargin)} (${tm.marginRate.toFixed(1)}%)` : `${tm.marginRate.toFixed(1)}%`}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ==========================================
    // 9. 입출고 & 적정판매가·마진 일괄 전표 모달 (#voucherModal)
    // ==========================================
    function openVoucherWithSelected(mode = 'IN') {
        if (!voucherModal) {
            const el = $('voucherModal');
            if (el && window.bootstrap) voucherModal = new bootstrap.Modal(el, { keyboard: true });
        }

        if ($('vTxDate') && !$('vTxDate').value) {
            $('vTxDate').value = todayStr();
        }
        if ($('vRemarks')) $('vRemarks').value = '';

        // 기본 부가세 체크박스 초기화 (인터넷최저가/배송비 VAT포함 기본 체크!)
        if ($('chkBaseVat')) $('chkBaseVat').checked = true;
        if ($('chkFreightVat')) $('chkFreightVat').checked = true;
        if ($('chkOnlineVat')) $('chkOnlineVat').checked = true;
        if ($('chkSellVat')) $('chkSellVat').checked = true;
        if ($('chkOutVat')) $('chkOutVat').checked = true;

        setVoucherMode(mode, false);

        // 재고 그리드에서 체크된 품목이 있다면 자동으로 전표 행에 탑재!
        const checkedProducts = [];
        selectedInvIds.forEach(id => {
            const p = products.find(item => String(item.id) === String(id));
            if (p) checkedProducts.push(p);
        });

        const tbody = $('voucherTbody');
        if (tbody) tbody.innerHTML = '';
        voucherRowCounter = 0;

        if (checkedProducts.length > 0) {
            if ($('vSupplier') && checkedProducts[0].supplier && mode === 'IN') {
                $('vSupplier').value = checkedProducts[0].supplier;
            }
            checkedProducts.forEach(p => {
                addVoucherRow(p);
            });
            showToast(`선택한 ${checkedProducts.length}개 품목이 ${mode === 'IN' ? '입고' : '출고'} 전표에 자동 입력되었습니다.`, 'info');
        } else {
            // 기본 3개 빈 행 생성
            for (let i = 0; i < 3; i++) addVoucherRow();
        }

        recalcAllVoucherRows();
        if (voucherModal) voucherModal.show();
    }

    function openVoucherForSingleProduct(productId, mode = 'IN') {
        const p = products.find(item => String(item.id) === String(productId));
        if (!p) return;

        if (!voucherModal) {
            const el = $('voucherModal');
            if (el && window.bootstrap) voucherModal = new bootstrap.Modal(el, { keyboard: true });
        }

        if ($('vTxDate') && !$('vTxDate').value) {
            $('vTxDate').value = todayStr();
        }
        if ($('vRemarks')) $('vRemarks').value = '';
        if ($('vSupplier')) $('vSupplier').value = mode === 'IN' ? (p.supplier || '최가유통') : ($('vSupplier').value || '본사출고');

        if ($('chkBaseVat')) $('chkBaseVat').checked = true;
        if ($('chkFreightVat')) $('chkFreightVat').checked = true;
        if ($('chkOnlineVat')) $('chkOnlineVat').checked = true;
        if ($('chkSellVat')) $('chkSellVat').checked = true;
        if ($('chkOutVat')) $('chkOutVat').checked = true;

        setVoucherMode(mode, false);

        const tbody = $('voucherTbody');
        if (tbody) tbody.innerHTML = '';
        voucherRowCounter = 0;

        addVoucherRow(p);
        recalcAllVoucherRows();
        if (voucherModal) voucherModal.show();
    }

    function setVoucherMode(mode, preserveRows = true) {
        voucherMode = mode === 'OUT' ? 'OUT' : 'IN';
        const isOut = voucherMode === 'OUT';

        if ($('btnModeIn')) $('btnModeIn').className = `voucher-mode-btn ${!isOut ? 'active mode-in' : ''}`;
        if ($('btnModeOut')) $('btnModeOut').className = `voucher-mode-btn ${isOut ? 'active mode-out' : ''}`;

        if ($('inVatOptions')) $('inVatOptions').classList.toggle('d-none', isOut);
        if ($('outVatOptions')) $('outVatOptions').classList.toggle('d-none', !isOut);

        if ($('lblVSupplier')) {
            $('lblVSupplier').innerHTML = isOut ? '출고처(고객) <span class="text-danger">*</span>' : '공급사 <span class="text-danger">*</span>';
        }
        if ($('vSupplier')) {
            if (isOut && $('vSupplier').value === '최가유통') $('vSupplier').value = '본사판매출고';
            if (!isOut && $('vSupplier').value === '본사판매출고') $('vSupplier').value = '최가유통';
        }

        const banner = $('voucherGuideBanner');
        const guideText = $('voucherGuideText');
        if (banner && guideText) {
            if (isOut) {
                banner.style.background = '#fffbeb';
                banner.style.borderColor = '#fde68a';
                banner.style.color = '#92400e';
                guideText.innerHTML = `<i class='bx bx-up-arrow-circle'></i> <strong>[출고 & 실시간 마진 안내]</strong> 품목을 선택하면 입고 시 설정한 <strong>적정 판매가가 자동으로 표기 및 입력</strong>되며, 출고단가를 조정하면 <strong>판매마진(₩)과 마진율(%)</strong>이 즉시 계산됩니다.`;
            } else {
                banner.style.background = '#eff6ff';
                banner.style.borderColor = '#bfdbfe';
                banner.style.color = '#1e40af';
                guideText.innerHTML = `<i class='bx bx-down-arrow-circle'></i> <strong>[매입(입고) & 적정판매가 설계]</strong> 입고 시 <strong>인터넷 최저가와 배송비를 따로 입력(VAT포함 기본 체크)</strong>하고 <strong>적정 판매가</strong>를 직접 설정할 수 있습니다.`;
            }
        }

        if ($('lblVSummaryMargin')) {
            $('lblVSummaryMargin').textContent = isOut ? '출고 총 판매마진 (평균 마진율):' : '적정판매가 기준 예상 마진:';
        }

        // 기존 행에 선택된 품목 보존
        const existingProducts = [];
        if (preserveRows && $('voucherTbody')) {
            $('voucherTbody').querySelectorAll('tr').forEach(tr => {
                const pid = tr.dataset.productId;
                if (pid) {
                    const p = products.find(x => String(x.id) === String(pid));
                    if (p) existingProducts.push(p);
                }
            });
        }

        renderVoucherHeader();

        if ($('voucherTbody')) {
            $('voucherTbody').innerHTML = '';
            voucherRowCounter = 0;
            if (existingProducts.length > 0) {
                existingProducts.forEach(p => addVoucherRow(p));
            } else {
                for (let i = 0; i < 3; i++) addVoucherRow();
            }
        }

        recalcAllVoucherRows();
    }

    function renderVoucherHeader() {
        const thead = $('voucherThead');
        if (!thead) return;

        if (voucherMode === 'IN') {
            thead.innerHTML = `
                <tr>
                    <th style="width: 32px;">No.</th>
                    <th style="min-width: 195px;" class="text-start ps-2">상품명 (검색 또는 신규 입력) <span class="text-danger">*</span></th>
                    <th style="width: 85px;">브랜드</th>
                    <th style="width: 72px;">컬러</th>
                    <th style="width: 64px;">사이즈</th>
                    <th style="width: 62px;">입고수량 <span class="text-danger">*</span></th>
                    <th style="width: 88px;">상품가</th>
                    <th style="width: 78px;">운임</th>
                    <th style="width: 98px;" title="매입 공급가 (VAT별도)">매입단가(공급가)</th>
                    <th style="width: 95px; background:#eff6ff;" title="인터넷 최저가 상품가 (VAT포함 기본)">인터넷 최저가</th>
                    <th style="width: 85px; background:#eff6ff;" title="인터넷 최저가 배송비 (VAT포함 기본)">최저가 배송비</th>
                    <th style="width: 132px; background:#f0fdf4;" title="출고 시 자동으로 표기될 적정 판매가">적정 판매가 설정 <span class="text-danger">*</span></th>
                    <th style="width: 112px;" title="적정판매가(공급가) - 매입단가(공급가)">예상마진 / 마진율</th>
                    <th style="width: 98px;">매입합계(공급가)</th>
                    <th style="width: 36px;">삭제</th>
                </tr>
            `;
        } else {
            thead.innerHTML = `
                <tr>
                    <th style="width: 32px;">No.</th>
                    <th style="min-width: 215px;" class="text-start ps-2">출고 상품 검색 / 선택 <span class="text-danger">*</span></th>
                    <th style="width: 88px;">브랜드</th>
                    <th style="width: 85px;">컬러 / 사이즈</th>
                    <th style="width: 66px;">현재고</th>
                    <th style="width: 66px;">출고수량 <span class="text-danger">*</span></th>
                    <th style="width: 96px;" title="매입 원가 (VAT별도 공급가)">매입단가(공급가)</th>
                    <th style="width: 105px;" title="입고 시 입력한 인터넷 최저가 + 배송비 합계">인터넷 최저가(합계)</th>
                    <th style="width: 115px; background:#f5f3ff;" title="입고 시 설정한 적정 판매가">설정된 적정판매가</th>
                    <th style="width: 120px; background:#fffbeb;" title="적정 판매가가 자동으로 입력되며 자유롭게 수정 가능합니다">출고 단가 입력 <span class="text-danger">*</span></th>
                    <th style="width: 115px;" title="출고단가(공급가) - 매입단가(공급가)">판매마진 (개당/총액)</th>
                    <th style="width: 78px;" title="공급가 기준 실현 마진율">마진율</th>
                    <th style="width: 102px;">출고합계(공급가)</th>
                    <th style="width: 36px;">삭제</th>
                </tr>
            `;
        }
    }

    function addVoucherRow(prefillProduct = null) {
        const tbody = $('voucherTbody');
        if (!tbody) return;
        voucherRowCounter++;
        const rowId = voucherRowCounter;
        const tr = document.createElement('tr');
        tr.id = `vRow_${rowId}`;
        tr.dataset.rowId = String(rowId);

        if (voucherMode === 'IN') {
            tr.innerHTML = `
                <td class="text-center text-muted row-no"></td>
                <td class="position-relative">
                    <input type="text" class="form-control v-name fw-bold" placeholder="상품명 검색 또는 신규 입력..." oninput="app.onVoucherNameInput(${rowId}, this.value)" onfocus="app.onVoucherNameInput(${rowId}, this.value)">
                    <div class="erp-autocomplete-menu d-none" id="vAuto_${rowId}"></div>
                </td>
                <td><input type="text" class="form-control v-brand" placeholder="브랜드"></td>
                <td><input type="text" class="form-control v-color text-center" placeholder="컬러"></td>
                <td><input type="text" class="form-control v-size text-center" placeholder="사이즈"></td>
                <td><input type="number" class="form-control col-num pe-1 fw-bold text-primary v-qty" value="1" min="1" oninput="app.recalcVoucherRow(${rowId})" onfocus="app.clearZero(this)"></td>
                <td><input type="text" class="form-control col-num pe-1 v-base" value="0" oninput="app.formatMoneyInput(this); app.onVoucherBaseOrFreightInput(${rowId})" onfocus="app.clearZero(this)"></td>
                <td><input type="text" class="form-control col-num pe-1 v-freight" value="0" oninput="app.formatMoneyInput(this); app.onVoucherBaseOrFreightInput(${rowId})" onfocus="app.clearZero(this)"></td>
                <td>
                    <input type="text" class="form-control col-num pe-1 fw-bold v-buy" value="0" oninput="app.formatMoneyInput(this); app.recalcVoucherRow(${rowId})" onfocus="app.clearZero(this)">
                </td>
                <td style="background:#f8fafc;">
                    <input type="text" class="form-control col-num pe-1 v-online-price" value="0" placeholder="최저가" oninput="app.formatMoneyInput(this); app.onVoucherOnlineInput(${rowId})" onfocus="app.clearZero(this)">
                </td>
                <td style="background:#f8fafc;">
                    <input type="text" class="form-control col-num pe-1 v-online-ship" value="0" placeholder="배송비" oninput="app.formatMoneyInput(this); app.onVoucherOnlineInput(${rowId})" onfocus="app.clearZero(this)">
                    <div class="cell-sub-hint text-end pe-1 v-online-sum-hint">합계: ₩0</div>
                </td>
                <td style="background:#f0fdf4;">
                    <div class="d-flex align-items-center gap-1">
                        <input type="text" class="form-control col-num pe-1 fw-bold text-primary v-sell" value="0" placeholder="적정판매가" oninput="app.formatMoneyInput(this); this.dataset.manual='1'; app.recalcVoucherRow(${rowId})" onfocus="app.clearZero(this)">
                        <button type="button" class="btn-apply-mini" onclick="app.applyOnlineToSellInRow(${rowId})" title="인터넷최저가 + 배송비 합계를 적정 판매가로 즉시 적용">=최저가</button>
                    </div>
                    <div class="cell-sub-hint text-end pe-1 v-sell-supply-hint">공급가: ₩0</div>
                </td>
                <td class="col-num pe-2 v-margin-cell">
                    <div class="price-stack">
                        <span class="price-main text-muted v-margin-won">₩0</span>
                        <span class="price-sub v-margin-rate">0.0%</span>
                    </div>
                </td>
                <td class="col-num pe-2 fw-bold text-dark v-row-total">₩0</td>
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.removeVoucherRow(${rowId})" title="행 삭제"><i class='bx bx-x fs-5'></i></button>
                </td>
            `;
        } else {
            tr.innerHTML = `
                <td class="text-center text-muted row-no"></td>
                <td class="position-relative">
                    <input type="text" class="form-control v-name fw-bold" placeholder="출고할 상품 검색 / 선택..." oninput="app.onVoucherNameInput(${rowId}, this.value)" onfocus="app.onVoucherNameInput(${rowId}, this.value)">
                    <div class="erp-autocomplete-menu d-none" id="vAuto_${rowId}"></div>
                </td>
                <td><input type="text" class="form-control v-brand bg-light" readonly placeholder="-"></td>
                <td><input type="text" class="form-control v-spec text-center bg-light" readonly placeholder="-"></td>
                <td class="text-center"><span class="stock-pill stock-ok v-stock-badge">-</span></td>
                <td><input type="number" class="form-control col-num pe-1 fw-bold text-primary v-qty" value="1" min="1" oninput="app.recalcVoucherRow(${rowId})" onfocus="app.clearZero(this)"></td>
                <td class="col-num pe-2">
                    <input type="text" class="form-control col-num pe-1 bg-light v-buy" value="0" readonly>
                    <div class="cell-sub-hint text-end pe-1">공급가 원가</div>
                </td>
                <td class="col-num pe-2">
                    <div class="price-stack">
                        <span class="price-main text-secondary v-online-display">-</span>
                        <span class="price-sub v-online-detail-display">최저가 참고</span>
                    </div>
                </td>
                <td class="col-num pe-2" style="background:#f5f3ff;">
                    <div class="d-flex align-items-center justify-content-end gap-1">
                        <strong class="text-primary v-target-sell-display">미설정</strong>
                        <button type="button" class="btn-apply-mini" onclick="app.applyTargetSellToOutRow(${rowId})" title="적정 판매가를 출고 단가로 다시 적용">적정가적용</button>
                    </div>
                    <div class="cell-sub-hint text-end pe-1 v-target-sell-sub">출고 시 자동 표기</div>
                </td>
                <td style="background:#fffbeb;">
                    <input type="text" class="form-control col-num pe-1 fw-bold text-dark v-out-price" value="0" placeholder="출고단가 입력" oninput="app.formatMoneyInput(this); app.recalcVoucherRow(${rowId})" onfocus="app.clearZero(this)">
                    <div class="cell-sub-hint text-end pe-1 v-out-supply-hint">공급가: ₩0</div>
                </td>
                <td class="col-num pe-2">
                    <div class="price-stack">
                        <span class="price-main text-success v-out-margin-total">₩0</span>
                        <span class="price-sub v-out-margin-unit">개당 ₩0</span>
                    </div>
                </td>
                <td class="text-center v-out-rate-cell">
                    <span class="margin-badge margin-mid v-out-rate-badge">0.0%</span>
                </td>
                <td class="col-num pe-2 fw-bold text-dark v-row-total">₩0</td>
                <td class="text-center">
                    <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.removeVoucherRow(${rowId})" title="행 삭제"><i class='bx bx-x fs-5'></i></button>
                </td>
            `;
        }

        tbody.appendChild(tr);
        renumberVoucherRows();

        if (prefillProduct) {
            selectVoucherProduct(rowId, prefillProduct.id);
        }
    }

    function removeVoucherRow(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (tr) tr.remove();
        if ($('voucherTbody') && $('voucherTbody').children.length === 0) {
            addVoucherRow();
        }
        renumberVoucherRows();
        recalcAllVoucherRows();
    }

    function clearVoucherRows() {
        if ($('voucherTbody')) $('voucherTbody').innerHTML = '';
        voucherRowCounter = 0;
        for (let i = 0; i < 3; i++) addVoucherRow();
        recalcAllVoucherRows();
    }

    function renumberVoucherRows() {
        if (!$('voucherTbody')) return;
        $('voucherTbody').querySelectorAll('tr').forEach((tr, idx) => {
            const noCell = tr.querySelector('.row-no');
            if (noCell) noCell.textContent = idx + 1;
        });
    }

    // 상품 자동완성 검색
    function onVoucherNameInput(rowId, keyword) {
        const tr = $(`vRow_${rowId}`);
        const menu = $(`vAuto_${rowId}`);
        if (!tr || !menu) return;

        // 열려있는 다른 자동완성 닫기
        document.querySelectorAll('.erp-autocomplete-menu').forEach(el => {
            if (el.id !== `vAuto_${rowId}`) el.classList.add('d-none');
        });

        const kw = (keyword || '').trim().toLowerCase();
        const tokens = kw.split(/\s+/).filter(Boolean);

        const matches = products.filter(p => {
            if (tokens.length === 0) return true;
            const hay = `${p.supplier || ''} ${p.brand || ''} ${p.name || ''} ${p.color || ''} ${p.size || ''}`.toLowerCase();
            return tokens.every(t => hay.includes(t));
        }).slice(0, 18);

        if (matches.length === 0) {
            menu.classList.add('d-none');
            return;
        }

        menu.innerHTML = matches.map(p => {
            const m = computeProductMetrics(p);
            return `
                <div class="erp-autocomplete-item" onmousedown="app.selectVoucherProduct(${rowId}, '${escHtml(p.id)}')">
                    <div>
                        <span class="fw-bold text-dark">[${escHtml(p.brand || '-')}] ${escHtml(p.name || '-')}</span>
                        <span class="text-muted ms-1">(${escHtml(p.color || '-')} / ${escHtml(p.size || '-')})</span>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <span class="text-secondary">원가 ${fmtWon(m.buySupply)}</span>
                        <span class="text-primary fw-bold">적정가 ${m.sellPrice > 0 ? fmtWon(m.sellPrice) : '미설정'}</span>
                        <span class="badge ${m.stock > 0 ? 'bg-primary' : 'bg-danger'}">재고 ${fmtNum(m.stock)}</span>
                    </div>
                </div>
            `;
        }).join('');
        menu.classList.remove('d-none');
    }

    function selectVoucherProduct(rowId, productId) {
        const tr = $(`vRow_${rowId}`);
        const menu = $(`vAuto_${rowId}`);
        if (menu) menu.classList.add('d-none');
        if (!tr) return;

        const p = products.find(item => String(item.id) === String(productId));
        if (!p) return;

        const m = computeProductMetrics(p);
        tr.dataset.productId = String(p.id);
        tr.dataset.targetSellPrice = String(m.sellPrice);
        tr.dataset.targetSellVat = m.sellVatIncluded ? '1' : '0';

        const nameInput = tr.querySelector('.v-name');
        if (nameInput) nameInput.value = p.name || '';

        const brandInput = tr.querySelector('.v-brand');
        if (brandInput) brandInput.value = p.brand || '';

        if (voucherMode === 'IN') {
            const colorInput = tr.querySelector('.v-color');
            const sizeInput = tr.querySelector('.v-size');
            const baseInput = tr.querySelector('.v-base');
            const freightInput = tr.querySelector('.v-freight');
            const buyInput = tr.querySelector('.v-buy');
            const onlinePriceInput = tr.querySelector('.v-online-price');
            const onlineShipInput = tr.querySelector('.v-online-ship');
            const sellInput = tr.querySelector('.v-sell');

            if (colorInput) colorInput.value = p.color || '';
            if (sizeInput) sizeInput.value = p.size || '';
            if (baseInput) baseInput.value = fmtNum(m.basePrice || m.buySupply);
            if (freightInput) freightInput.value = fmtNum(m.freight || 0);
            if (buyInput) buyInput.value = fmtNum(m.buySupply);
            if (onlinePriceInput) onlinePriceInput.value = fmtNum(m.onlinePrice);
            if (onlineShipInput) onlineShipInput.value = fmtNum(m.onlineShipping);
            if (sellInput) {
                sellInput.value = fmtNum(m.sellPrice);
                sellInput.dataset.manual = m.sellPrice > 0 ? '1' : '0';
            }
        } else {
            // OUT 모드: 적정 판매가를 자동으로 표기 및 출고 단가에 기본 세팅!
            const specInput = tr.querySelector('.v-spec');
            const stockBadge = tr.querySelector('.v-stock-badge');
            const buyInput = tr.querySelector('.v-buy');
            const onlineDisplay = tr.querySelector('.v-online-display');
            const onlineDetailDisplay = tr.querySelector('.v-online-detail-display');
            const targetSellDisplay = tr.querySelector('.v-target-sell-display');
            const targetSellSub = tr.querySelector('.v-target-sell-sub');
            const outPriceInput = tr.querySelector('.v-out-price');

            if (specInput) specInput.value = `${p.color || '-'} / ${p.size || '-'}`;
            if (stockBadge) {
                stockBadge.textContent = `${fmtNum(m.stock)}개`;
                stockBadge.className = `stock-pill ${m.stock <= 0 ? 'stock-out' : (m.stock <= 2 ? 'stock-low' : 'stock-ok')}`;
            }
            if (buyInput) buyInput.value = fmtNum(m.buySupply);

            if (onlineDisplay) {
                onlineDisplay.textContent = m.onlineTotal > 0 ? fmtWon(m.onlineTotal) : '-';
            }
            if (onlineDetailDisplay) {
                onlineDetailDisplay.textContent = m.onlineTotal > 0
                    ? `상품 ${fmtNum(m.onlinePrice)} + 배송 ${fmtNum(m.onlineShipping)}`
                    : '최저가 미입력';
            }

            if (targetSellDisplay) {
                targetSellDisplay.textContent = m.sellPrice > 0 ? fmtWon(m.sellPrice) : '미설정';
            }
            if (targetSellSub) {
                targetSellSub.textContent = m.sellPrice > 0
                    ? (m.sellVatIncluded ? `VAT포함 (공급가 ${fmtWon(m.sellSupply)})` : 'VAT별도 공급가')
                    : '입고 시 설정 가능';
            }

            // 출고단가에 적정 판매가 자동 입력!
            if (outPriceInput) {
                const chkOutVat = $('chkOutVat') ? $('chkOutVat').checked : true;
                if (m.sellPrice > 0) {
                    const defaultOutVal = chkOutVat
                        ? (m.sellVatIncluded ? m.sellPrice : Math.round(m.sellSupply * 1.1))
                        : m.sellSupply;
                    outPriceInput.value = fmtNum(defaultOutVal);
                } else {
                    outPriceInput.value = fmtNum(chkOutVat ? Math.round(m.buySupply * 1.1) : m.buySupply);
                }
            }
        }

        recalcVoucherRow(rowId);
    }

    function onVoucherBaseOrFreightInput(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (!tr) return;
        const chkBaseVat = $('chkBaseVat') ? $('chkBaseVat').checked : true; // true = VAT별도
        const chkFreightVat = $('chkFreightVat') ? $('chkFreightVat').checked : true; // true = VAT별도

        const rawBase = parseNumber(tr.querySelector('.v-base')?.value);
        const rawFreight = parseNumber(tr.querySelector('.v-freight')?.value);

        const netBase = chkBaseVat ? rawBase : Math.round(rawBase / 1.1);
        const netFreight = chkFreightVat ? rawFreight : Math.round(rawFreight / 1.1);

        const buyInput = tr.querySelector('.v-buy');
        if (buyInput) buyInput.value = fmtNum(netBase + netFreight);

        recalcVoucherRow(rowId);
    }

    function onVoucherOnlineInput(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (!tr) return;
        const onlinePrice = parseNumber(tr.querySelector('.v-online-price')?.value);
        const onlineShip = parseNumber(tr.querySelector('.v-online-ship')?.value);
        const onlineSum = onlinePrice + onlineShip;

        // 적정판매가가 아직 수동 입력되지 않았다면 인터넷최저가 합계를 자동으로 가이드 세팅
        const sellInput = tr.querySelector('.v-sell');
        if (sellInput && sellInput.dataset.manual !== '1' && onlineSum > 0) {
            sellInput.value = fmtNum(onlineSum);
        }

        recalcVoucherRow(rowId);
    }

    function applyOnlineToSellInRow(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (!tr) return;
        const onlinePrice = parseNumber(tr.querySelector('.v-online-price')?.value);
        const onlineShip = parseNumber(tr.querySelector('.v-online-ship')?.value);
        const sellInput = tr.querySelector('.v-sell');
        if (sellInput) {
            sellInput.value = fmtNum(onlinePrice + onlineShip);
            sellInput.dataset.manual = '1';
        }
        recalcVoucherRow(rowId);
    }

    function applyTargetSellToOutRow(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (!tr) return;
        const targetSell = Number(tr.dataset.targetSellPrice) || 0;
        const targetSellVat = tr.dataset.targetSellVat !== '0';
        if (targetSell <= 0) {
            showToast('이 품목에 설정된 적정 판매가가 없습니다.', 'warning');
            return;
        }
        const chkOutVat = $('chkOutVat') ? $('chkOutVat').checked : true;
        const targetSupply = toSupplyPrice(targetSell, targetSellVat);
        const outPriceInput = tr.querySelector('.v-out-price');
        if (outPriceInput) {
            outPriceInput.value = fmtNum(chkOutVat ? (targetSellVat ? targetSell : Math.round(targetSupply * 1.1)) : targetSupply);
        }
        recalcVoucherRow(rowId);
    }

    function recalcVoucherRow(rowId) {
        const tr = $(`vRow_${rowId}`);
        if (!tr) return;

        const qty = Math.max(1, parseNumber(tr.querySelector('.v-qty')?.value));

        if (voucherMode === 'IN') {
            const chkOnlineVat = $('chkOnlineVat') ? $('chkOnlineVat').checked : true; // true = VAT포함
            const chkSellVat = $('chkSellVat') ? $('chkSellVat').checked : true; // true = VAT포함

            const buySupply = parseNumber(tr.querySelector('.v-buy')?.value);
            const onlinePrice = parseNumber(tr.querySelector('.v-online-price')?.value);
            const onlineShip = parseNumber(tr.querySelector('.v-online-ship')?.value);
            const onlineTotal = onlinePrice + onlineShip;
            const onlineSupply = toSupplyPrice(onlineTotal, chkOnlineVat);

            const sellPrice = parseNumber(tr.querySelector('.v-sell')?.value);
            const sellSupply = toSupplyPrice(sellPrice, chkSellVat);

            const onlineHint = tr.querySelector('.v-online-sum-hint');
            if (onlineHint) {
                onlineHint.textContent = onlineTotal > 0
                    ? `합계: ${fmtWon(onlineTotal)} (공급가 ${fmtWon(onlineSupply)})`
                    : '합계: ₩0';
            }

            const sellHint = tr.querySelector('.v-sell-supply-hint');
            if (sellHint) {
                const diffVsOnline = (onlineTotal > 0 && sellPrice > 0) ? (sellPrice - onlineTotal) : 0;
                const diffLabel = (onlineTotal > 0 && sellPrice > 0)
                    ? ` | 최저가대비 ${diffVsOnline > 0 ? '+' : ''}${fmtNum(diffVsOnline)}`
                    : '';
                sellHint.textContent = `공급가: ${fmtWon(sellSupply)}${diffLabel}`;
            }

            const unitMargin = sellSupply > 0 ? (sellSupply - buySupply) : 0;
            const marginRate = sellSupply > 0 ? ((unitMargin / sellSupply) * 100) : 0;

            const marginWonEl = tr.querySelector('.v-margin-won');
            const marginRateEl = tr.querySelector('.v-margin-rate');
            if (marginWonEl) {
                marginWonEl.textContent = sellSupply > 0 ? `${unitMargin >= 0 ? '+' : ''}${fmtWon(unitMargin)}` : '-';
                marginWonEl.className = `price-main ${unitMargin >= 0 ? 'text-success' : 'text-danger'}`;
            }
            if (marginRateEl) {
                marginRateEl.innerHTML = sellSupply > 0
                    ? `<span class="margin-badge ${getMarginBadgeClass(marginRate)}">${marginRate.toFixed(1)}%</span>`
                    : '0.0%';
            }

            const rowTotalEl = tr.querySelector('.v-row-total');
            if (rowTotalEl) rowTotalEl.textContent = fmtWon(buySupply * qty);
        } else {
            // OUT 모드: 출고단가 입력 시 실시간 판매마진 & 마진율 계산
            const chkOutVat = $('chkOutVat') ? $('chkOutVat').checked : true; // true = VAT포함 입력
            const buySupply = parseNumber(tr.querySelector('.v-buy')?.value);
            const rawOutPrice = parseNumber(tr.querySelector('.v-out-price')?.value);
            const netOutSupply = toSupplyPrice(rawOutPrice, chkOutVat);

            const outSupplyHint = tr.querySelector('.v-out-supply-hint');
            if (outSupplyHint) {
                outSupplyHint.textContent = chkOutVat
                    ? `공급가 환산: ${fmtWon(netOutSupply)}`
                    : `VAT포함 환산: ${fmtWon(Math.round(netOutSupply * 1.1))}`;
            }

            const unitMargin = netOutSupply - buySupply;
            const totalMargin = unitMargin * qty;
            const marginRate = netOutSupply > 0 ? ((unitMargin / netOutSupply) * 100) : 0;

            const marginTotalEl = tr.querySelector('.v-out-margin-total');
            const marginUnitEl = tr.querySelector('.v-out-margin-unit');
            const rateBadgeEl = tr.querySelector('.v-out-rate-badge');
            const rowTotalEl = tr.querySelector('.v-row-total');

            if (marginTotalEl) {
                marginTotalEl.textContent = `${totalMargin >= 0 ? '+' : ''}${fmtWon(totalMargin)}`;
                marginTotalEl.className = `price-main fw-bold ${totalMargin >= 0 ? 'text-success' : 'text-danger'}`;
            }
            if (marginUnitEl) {
                marginUnitEl.textContent = `개당 ${unitMargin >= 0 ? '+' : ''}${fmtWon(unitMargin)}`;
            }
            if (rateBadgeEl) {
                rateBadgeEl.textContent = `${marginRate.toFixed(1)}%`;
                rateBadgeEl.className = `margin-badge ${getMarginBadgeClass(marginRate)}`;
            }
            if (rowTotalEl) {
                rowTotalEl.textContent = fmtWon(netOutSupply * qty);
            }
        }

        updateVoucherSummaryFooter();
    }

    function recalcAllVoucherRows() {
        if (!$('voucherTbody')) return;
        $('voucherTbody').querySelectorAll('tr').forEach(tr => {
            const rowId = Number(tr.dataset.rowId);
            if (voucherMode === 'IN') {
                const rawBase = parseNumber(tr.querySelector('.v-base')?.value);
                const rawFreight = parseNumber(tr.querySelector('.v-freight')?.value);
                if (rawBase > 0 || rawFreight > 0) {
                    onVoucherBaseOrFreightInput(rowId);
                    return;
                }
            }
            recalcVoucherRow(rowId);
        });
        updateVoucherSummaryFooter();
    }

    function updateVoucherSummaryFooter() {
        if (!$('voucherTbody')) return;
        let validCount = 0;
        let sumQty = 0;
        let sumAmount = 0;
        let sumMargin = 0;
        let sumSellSupplyTotal = 0;

        const chkSellVat = $('chkSellVat') ? $('chkSellVat').checked : true;
        const chkOutVat = $('chkOutVat') ? $('chkOutVat').checked : true;

        $('voucherTbody').querySelectorAll('tr').forEach(tr => {
            const name = (tr.querySelector('.v-name')?.value || '').trim();
            if (!name) return;
            validCount++;

            const qty = Math.max(1, parseNumber(tr.querySelector('.v-qty')?.value));
            const buySupply = parseNumber(tr.querySelector('.v-buy')?.value);
            sumQty += qty;

            if (voucherMode === 'IN') {
                sumAmount += buySupply * qty;
                const sellPrice = parseNumber(tr.querySelector('.v-sell')?.value);
                const sellSupply = toSupplyPrice(sellPrice, chkSellVat);
                if (sellSupply > 0) {
                    sumMargin += (sellSupply - buySupply) * qty;
                    sumSellSupplyTotal += sellSupply * qty;
                }
            } else {
                const rawOut = parseNumber(tr.querySelector('.v-out-price')?.value);
                const netOut = toSupplyPrice(rawOut, chkOutVat);
                sumAmount += netOut * qty;
                sumMargin += (netOut - buySupply) * qty;
                sumSellSupplyTotal += netOut * qty;
            }
        });

        const avgRate = sumSellSupplyTotal > 0 ? ((sumMargin / sumSellSupplyTotal) * 100).toFixed(1) : '0.0';

        if ($('vSummaryCount')) $('vSummaryCount').textContent = fmtNum(validCount);
        if ($('vSummaryQty')) $('vSummaryQty').textContent = fmtNum(sumQty);
        if ($('vSummaryAmount')) $('vSummaryAmount').textContent = fmtWon(sumAmount);
        if ($('vSummaryMargin')) {
            $('vSummaryMargin').textContent = `${sumMargin >= 0 ? '+' : ''}${fmtWon(sumMargin)} (${avgRate}%)`;
            $('vSummaryMargin').className = `${sumMargin >= 0 ? 'text-success' : 'text-danger'} fs-6`;
        }
    }

    // 전표 일괄 저장
    async function submitVoucher() {
        const txDate = ($('vTxDate')?.value || '').trim();
        const supplier = ($('vSupplier')?.value || '').trim() || (voucherMode === 'IN' ? '최가유통' : '본사출고');
        const commonRemarks = ($('vRemarks')?.value || '').trim();

        if (!txDate) {
            showToast('거래일자를 선택해주세요.', 'warning');
            return;
        }

        const rows = Array.from($('voucherTbody')?.querySelectorAll('tr') || []);
        const chkOnlineVat = $('chkOnlineVat') ? $('chkOnlineVat').checked : true;
        const chkSellVat = $('chkSellVat') ? $('chkSellVat').checked : true;
        const chkOutVat = $('chkOutVat') ? $('chkOutVat').checked : true;

        const items = [];

        for (const tr of rows) {
            const name = (tr.querySelector('.v-name')?.value || '').trim();
            if (!name) continue;

            const qty = Math.max(1, parseNumber(tr.querySelector('.v-qty')?.value));
            const brand = (tr.querySelector('.v-brand')?.value || '').trim();
            let productId = tr.dataset.productId || '';

            if (voucherMode === 'IN') {
                const color = (tr.querySelector('.v-color')?.value || '').trim();
                const size = (tr.querySelector('.v-size')?.value || '').trim();
                const basePrice = parseNumber(tr.querySelector('.v-base')?.value);
                const freight = parseNumber(tr.querySelector('.v-freight')?.value);
                const buySupply = parseNumber(tr.querySelector('.v-buy')?.value);
                const onlinePrice = parseNumber(tr.querySelector('.v-online-price')?.value);
                const onlineShipping = parseNumber(tr.querySelector('.v-online-ship')?.value);
                const sellPrice = parseNumber(tr.querySelector('.v-sell')?.value);

                // 기존 상품 매칭 또는 신규 생성
                let match = productId
                    ? products.find(p => String(p.id) === String(productId))
                    : products.find(p => p.brand === brand && p.name === name && p.color === color && p.size === size);

                if (!match) {
                    try {
                        const createRes = await authFetch(API_BASE + '/products', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                supplier,
                                brand,
                                name,
                                color,
                                size,
                                stock: 0,
                                buyPrice: buySupply,
                                basePrice,
                                freight,
                                onlinePrice,
                                onlineShipping,
                                onlineVatIncluded: chkOnlineVat ? 1 : 0,
                                sellPrice,
                                sellVatIncluded: chkSellVat ? 1 : 0,
                                discountPrice: sellPrice
                            })
                        });
                        if (!createRes.ok) throw new Error('신규 품목 마스터 생성 실패');
                        const created = await createRes.json();
                        productId = created.id;
                    } catch (err) {
                        showToast(`품목 생성 오류 (${name}): ${err.message}`, 'error');
                        return;
                    }
                } else {
                    productId = match.id;
                }

                const sellSupply = toSupplyPrice(sellPrice, chkSellVat);
                const unitMargin = sellSupply > 0 ? (sellSupply - buySupply) : 0;
                const marginRate = sellSupply > 0 ? Number(((unitMargin / sellSupply) * 100).toFixed(1)) : 0;

                items.push({
                    type: 'IN',
                    txDate,
                    supplier,
                    brand,
                    productName: name,
                    color,
                    size,
                    qty,
                    price: buySupply,
                    basePrice,
                    freight,
                    onlinePrice,
                    onlineShipping,
                    onlineVatIncluded: chkOnlineVat ? 1 : 0,
                    sellPrice,
                    sellVatIncluded: chkSellVat ? 1 : 0,
                    buyPrice: buySupply,
                    marginAmount: unitMargin,
                    marginRate,
                    remarks: commonRemarks,
                    productId
                });
            } else {
                // OUT 모드
                const match = productId
                    ? products.find(p => String(p.id) === String(productId))
                    : products.find(p => p.name === name);

                if (!match) {
                    showToast(`출고할 상품을 목록에서 선택해주세요: ${name}`, 'warning');
                    return;
                }

                const buySupply = parseNumber(tr.querySelector('.v-buy')?.value) || Number(match.buyPrice) || 0;
                const rawOutPrice = parseNumber(tr.querySelector('.v-out-price')?.value);
                const netOutSupply = toSupplyPrice(rawOutPrice, chkOutVat);
                const unitMargin = netOutSupply - buySupply;
                const marginRate = netOutSupply > 0 ? Number(((unitMargin / netOutSupply) * 100).toFixed(1)) : 0;

                items.push({
                    type: 'OUT',
                    txDate,
                    supplier,
                    brand: match.brand || brand,
                    productName: match.name || name,
                    color: match.color || '',
                    size: match.size || '',
                    qty,
                    price: netOutSupply,
                    rawOutPrice,
                    outVatIncluded: chkOutVat ? 1 : 0,
                    basePrice: 0,
                    freight: 0,
                    onlinePrice: Number(match.onlinePrice) || 0,
                    onlineShipping: Number(match.onlineShipping) || 0,
                    onlineVatIncluded: match.onlineVatIncluded !== undefined ? Number(match.onlineVatIncluded) : 1,
                    sellPrice: Number(match.sellPrice || match.discountPrice) || 0,
                    sellVatIncluded: match.sellVatIncluded !== undefined ? Number(match.sellVatIncluded) : 1,
                    buyPrice: buySupply,
                    marginAmount: unitMargin,
                    marginRate,
                    remarks: commonRemarks,
                    productId: match.id
                });
            }
        }

        if (items.length === 0) {
            showToast('전표에 등록할 품목을 1건 이상 입력해주세요.', 'warning');
            return;
        }

        const btn = $('btnSubmitVoucher');
        if (btn) btn.disabled = true;

        try {
            const res = await authFetch(API_BASE + '/transactions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || '전표 저장 실패');
            }

            showToast(`${items.length}건의 ${voucherMode === 'IN' ? '입고 및 적정판매가' : '출고 및 판매마진'} 전표가 등록되었습니다!`, 'success');
            if (voucherModal) voucherModal.hide();
            selectedInvIds.clear();
            updateSelectedUI();
            await loadAllData();
        } catch (e) {
            showToast('전표 저장 오류: ' + e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ==========================================
    // 10. 품목 마스터 단품 등록 / 수정 모달 (#productModal)
    // ==========================================
    function openNewModal() {
        if (!productModal) {
            const el = $('productModal');
            if (el && window.bootstrap) productModal = new bootstrap.Modal(el, { keyboard: true });
        }
        $('editId').value = '';
        if ($('modalModeTitle')) $('modalModeTitle').textContent = '본사 상품 등록 및 적정판매가 설정';
        $('mSupplier').value = supplierFilter || '최가유통';
        $('mBrand').value = '';
        $('mName').value = '';
        $('mColor').value = '';
        $('mSize').value = '';
        $('mBasePrice').value = '0';
        $('mFreight').value = '0';
        $('mBuyPrice').value = '0';
        $('mStock').value = '0';
        $('mOnlineVat').checked = true;
        $('mOnlinePrice').value = '0';
        $('mOnlineShipping').value = '0';
        $('mSellVat').checked = true;
        $('mSellPrice').value = '0';

        calcModalMargin();
        if (productModal) productModal.show();
    }

    function openEditModal(id) {
        const p = products.find(item => String(item.id) === String(id));
        if (!p) return;

        if (!productModal) {
            const el = $('productModal');
            if (el && window.bootstrap) productModal = new bootstrap.Modal(el, { keyboard: true });
        }

        const m = computeProductMetrics(p);
        $('editId').value = p.id;
        if ($('modalModeTitle')) $('modalModeTitle').textContent = '본사 상품 및 적정판매가 수정';
        $('mSupplier').value = p.supplier || '최가유통';
        $('mBrand').value = p.brand || '';
        $('mName').value = p.name || '';
        $('mColor').value = p.color || '';
        $('mSize').value = p.size || '';
        $('mBasePrice').value = fmtNum(m.basePrice);
        $('mFreight').value = fmtNum(m.freight);
        $('mBuyPrice').value = fmtNum(m.buySupply);
        $('mStock').value = m.stock;
        $('mOnlineVat').checked = m.onlineVatIncluded;
        $('mOnlinePrice').value = fmtNum(m.onlinePrice);
        $('mOnlineShipping').value = fmtNum(m.onlineShipping);
        $('mSellVat').checked = m.sellVatIncluded;
        $('mSellPrice').value = fmtNum(m.sellPrice);

        calcModalMargin();
        if (productModal) productModal.show();
    }

    function onProductBaseOrFreightInput() {
        const base = parseNumber($('mBasePrice')?.value);
        const freight = parseNumber($('mFreight')?.value);
        if ($('mBuyPrice')) $('mBuyPrice').value = fmtNum(base + freight);
        calcModalMargin();
    }

    function onProductOnlineInput() {
        const onlinePrice = parseNumber($('mOnlinePrice')?.value);
        const onlineShip = parseNumber($('mOnlineShipping')?.value);
        const sum = onlinePrice + onlineShip;
        const isVat = $('mOnlineVat') ? $('mOnlineVat').checked : true;
        if ($('mOnlineSumHint')) {
            $('mOnlineSumHint').textContent = `최저가 합계: ${fmtWon(sum)} (공급가 ${fmtWon(toSupplyPrice(sum, isVat))})`;
        }
        calcModalMargin();
    }

    function applyOnlineSumToProductSellPrice() {
        const onlinePrice = parseNumber($('mOnlinePrice')?.value);
        const onlineShip = parseNumber($('mOnlineShipping')?.value);
        if ($('mSellPrice')) {
            $('mSellPrice').value = fmtNum(onlinePrice + onlineShip);
        }
        calcModalMargin();
    }

    function calcModalMargin() {
        const buySupply = parseNumber($('mBuyPrice')?.value);
        const stock = parseNumber($('mStock')?.value);
        const onlinePrice = parseNumber($('mOnlinePrice')?.value);
        const onlineShip = parseNumber($('mOnlineShipping')?.value);
        const onlineSum = onlinePrice + onlineShip;
        const onlineVat = $('mOnlineVat') ? $('mOnlineVat').checked : true;

        if ($('mOnlineSumHint')) {
            $('mOnlineSumHint').textContent = `최저가 합계: ${fmtWon(onlineSum)} (공급가 ${fmtWon(toSupplyPrice(onlineSum, onlineVat))})`;
        }

        const sellPrice = parseNumber($('mSellPrice')?.value);
        const sellVat = $('mSellVat') ? $('mSellVat').checked : true;
        const sellSupply = toSupplyPrice(sellPrice, sellVat);

        if ($('mSellSupplyHint')) {
            $('mSellSupplyHint').textContent = `(공급가 환산: ${fmtWon(sellSupply)})`;
        }

        const unitMargin = sellSupply > 0 ? (sellSupply - buySupply) : 0;
        const marginRate = sellSupply > 0 ? ((unitMargin / sellSupply) * 100).toFixed(1) : null;
        const stockValue = buySupply * stock;

        if ($('modalExpectedProfit')) {
            $('modalExpectedProfit').textContent = sellSupply > 0 ? `${unitMargin >= 0 ? '+' : ''}${fmtWon(unitMargin)}` : '₩0';
            $('modalExpectedProfit').className = `${unitMargin >= 0 ? 'text-success' : 'text-danger'} fs-6`;
        }
        if ($('modalExpectedMargin')) {
            $('modalExpectedMargin').textContent = marginRate !== null ? `${marginRate}%` : '-';
        }
        if ($('modalExpectedStockValue')) {
            $('modalExpectedStockValue').textContent = fmtWon(stockValue);
        }
    }

    async function handleSaveProduct(e) {
        if (e) e.preventDefault();

        const editId = ($('editId')?.value || '').trim();
        const payload = {
            supplier: ($('mSupplier')?.value || '최가유통').trim(),
            brand: ($('mBrand')?.value || '').trim(),
            name: ($('mName')?.value || '').trim(),
            color: ($('mColor')?.value || '').trim(),
            size: ($('mSize')?.value || '').trim(),
            basePrice: parseNumber($('mBasePrice')?.value),
            freight: parseNumber($('mFreight')?.value),
            buyPrice: parseNumber($('mBuyPrice')?.value),
            stock: parseNumber($('mStock')?.value),
            onlinePrice: parseNumber($('mOnlinePrice')?.value),
            onlineShipping: parseNumber($('mOnlineShipping')?.value),
            onlineVatIncluded: $('mOnlineVat')?.checked ? 1 : 0,
            sellPrice: parseNumber($('mSellPrice')?.value),
            sellVatIncluded: $('mSellVat')?.checked ? 1 : 0,
            discountPrice: parseNumber($('mSellPrice')?.value)
        };

        if (!payload.name) {
            showToast('상품명을 입력해주세요.', 'warning');
            return;
        }

        try {
            const url = editId ? `${API_BASE}/products/${editId}` : `${API_BASE}/products`;
            const method = editId ? 'PUT' : 'POST';
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('저장 실패 (' + res.status + ')');
            showToast(editId ? '상품 및 적정판매가 정보가 수정되었습니다.' : '새 상품이 등록되었습니다.', 'success');
            if (productModal) productModal.hide();
            await loadAllData();
        } catch (err) {
            showToast('저장 중 오류: ' + err.message, 'error');
        }
    }

    // ==========================================
    // 11. 입출고 단일 내역 수정 모달 (#txEditModal)
    // ==========================================
    function openTxEditModal(txId) {
        const t = transactions.find(x => Number(x.id) === Number(txId));
        if (!t) return;

        if (!txEditModal) {
            const el = $('txEditModal');
            if (el && window.bootstrap) txEditModal = new bootstrap.Modal(el, { keyboard: true });
        }

        const tm = computeTxMetrics(t);
        const isOut = t.type === 'OUT';

        $('eTxId').value = t.id;
        $('eTxRawType').value = t.type;
        $('eTxDate').value = t.txDate || todayStr();
        $('eTxTypeLabel').value = isOut ? '↗ 출고 (판매)' : '📥 매입 (입고)';
        $('eSupplier').value = t.supplier || '';
        $('eBrand').value = t.brand || '';
        $('eName').value = t.productName || '';
        $('eColor').value = t.color || '';
        $('eSize').value = t.size || '';
        $('eBasePrice').value = fmtNum(t.basePrice || 0);
        $('eFreight').value = fmtNum(t.freight || 0);
        $('eOnlinePrice').value = fmtNum(tm.onlinePrice);
        $('eOnlineShipping').value = fmtNum(tm.onlineShipping);
        $('eQty').value = tm.qty;
        $('eSellPrice').value = fmtNum(tm.sellPrice);
        $('eBuyPrice').value = fmtNum(tm.buySupply);
        $('eRemarks').value = t.remarks || '';

        if ($('eRowInDetails')) $('eRowInDetails').classList.toggle('d-none', isOut);
        if ($('eRowOnlineDetails')) $('eRowOnlineDetails').classList.toggle('d-none', isOut);
        if ($('eOutVatWrap')) $('eOutVatWrap').classList.toggle('d-none', !isOut);

        if (isOut) {
            if ($('lblETxPrice')) $('lblETxPrice').textContent = '출고단가';
            if ($('eOutVat')) $('eOutVat').checked = tm.outVatIncluded;
            $('ePrice').value = fmtNum(tm.outVatIncluded ? tm.rawOutPrice : tm.txSupplyPrice);
        } else {
            if ($('lblETxPrice')) $('lblETxPrice').textContent = '입고단가(공급가)';
            if ($('eOutVat')) $('eOutVat').checked = false;
            $('ePrice').value = fmtNum(tm.txSupplyPrice);
        }

        recalcTxEditModal();
        if (txEditModal) txEditModal.show();
    }

    function calcTxEditInPrice() {
        const base = parseNumber($('eBasePrice')?.value);
        const freight = parseNumber($('eFreight')?.value);
        const sum = base + freight;
        if ($('eBuyPrice')) $('eBuyPrice').value = fmtNum(sum);
        if ($('ePrice')) $('ePrice').value = fmtNum(sum);
        recalcTxEditModal();
    }

    function recalcTxEditModal() {
        const type = $('eTxRawType')?.value || 'IN';
        const qty = Math.max(1, parseNumber($('eQty')?.value));
        const buySupply = parseNumber($('eBuyPrice')?.value);
        const sellPrice = parseNumber($('eSellPrice')?.value);
        const sellSupply = toSupplyPrice(sellPrice, true);
        const rawPriceInput = parseNumber($('ePrice')?.value);

        let netTxPrice = rawPriceInput;
        let unitMargin = 0;
        let marginRate = 0;

        if (type === 'OUT') {
            const outVat = $('eOutVat') ? $('eOutVat').checked : false;
            netTxPrice = toSupplyPrice(rawPriceInput, outVat);
            unitMargin = netTxPrice - buySupply;
            marginRate = netTxPrice > 0 ? ((unitMargin / netTxPrice) * 100) : 0;
        } else {
            netTxPrice = rawPriceInput;
            unitMargin = sellSupply > 0 ? (sellSupply - netTxPrice) : 0;
            marginRate = sellSupply > 0 ? ((unitMargin / sellSupply) * 100) : 0;
        }

        if ($('eTotalAmount')) $('eTotalAmount').value = fmtWon(netTxPrice * qty);
        if ($('eUnitMarginPreview')) $('eUnitMarginPreview').textContent = `${unitMargin >= 0 ? '+' : ''}${fmtWon(unitMargin)}`;
        if ($('eMarginRatePreview')) $('eMarginRatePreview').textContent = `${marginRate.toFixed(1)}%`;
        if ($('eTotalMarginPreview')) $('eTotalMarginPreview').textContent = `${unitMargin * qty >= 0 ? '+' : ''}${fmtWon(unitMargin * qty)}`;
    }

    async function handleSaveTxEdit(e) {
        if (e) e.preventDefault();
        const id = $('eTxId')?.value;
        if (!id) return;

        const type = $('eTxRawType')?.value || 'IN';
        const qty = Math.max(1, parseNumber($('eQty')?.value));
        const buySupply = parseNumber($('eBuyPrice')?.value);
        const sellPrice = parseNumber($('eSellPrice')?.value);
        const sellSupply = toSupplyPrice(sellPrice, true);
        const rawPriceInput = parseNumber($('ePrice')?.value);
        const outVat = (type === 'OUT' && $('eOutVat')) ? $('eOutVat').checked : false;
        const netTxPrice = type === 'OUT' ? toSupplyPrice(rawPriceInput, outVat) : rawPriceInput;

        const unitMargin = type === 'OUT' ? (netTxPrice - buySupply) : (sellSupply > 0 ? sellSupply - netTxPrice : 0);
        const marginRate = type === 'OUT'
            ? (netTxPrice > 0 ? Number(((unitMargin / netTxPrice) * 100).toFixed(1)) : 0)
            : (sellSupply > 0 ? Number(((unitMargin / sellSupply) * 100).toFixed(1)) : 0);

        const payload = {
            txDate: $('eTxDate')?.value,
            supplier: ($('eSupplier')?.value || '').trim(),
            brand: ($('eBrand')?.value || '').trim(),
            productName: ($('eName')?.value || '').trim(),
            color: ($('eColor')?.value || '').trim(),
            size: ($('eSize')?.value || '').trim(),
            qty,
            price: netTxPrice,
            rawOutPrice: rawPriceInput,
            outVatIncluded: outVat ? 1 : 0,
            basePrice: parseNumber($('eBasePrice')?.value),
            freight: parseNumber($('eFreight')?.value),
            onlinePrice: parseNumber($('eOnlinePrice')?.value),
            onlineShipping: parseNumber($('eOnlineShipping')?.value),
            onlineVatIncluded: 1,
            sellPrice,
            sellVatIncluded: 1,
            buyPrice: type === 'IN' ? netTxPrice : buySupply,
            marginAmount: unitMargin,
            marginRate,
            remarks: ($('eRemarks')?.value || '').trim()
        };

        try {
            const res = await authFetch(`${API_BASE}/transactions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('내역 수정 실패');
            showToast('입출고 내역 및 재고/마진 정보가 업데이트되었습니다.', 'success');
            if (txEditModal) txEditModal.hide();
            await loadAllData();
        } catch (err) {
            showToast('수정 오류: ' + err.message, 'error');
        }
    }

    // ==========================================
    // 12. 선택/삭제/페이지네이션/엑셀/인쇄/견적 연동
    // ==========================================
    function getActiveSelectedSet() {
        return activeWorkspace === 'inventory' ? selectedInvIds : selectedTxIds;
    }

    function updateSelectedUI() {
        const set = getActiveSelectedSet();
        const cnt = set.size;
        if ($('selectedCount')) $('selectedCount').textContent = cnt;
        if ($('bottomSelectedCount')) $('bottomSelectedCount').textContent = cnt;
        if ($('mobileSelectionCount')) $('mobileSelectionCount').textContent = cnt;

        if ($('lblQuickIn')) {
            $('lblQuickIn').textContent = (activeWorkspace === 'inventory' && selectedInvIds.size > 0)
                ? `선택입고 (${selectedInvIds.size})`
                : '입고·판매가 등록';
        }
        if ($('lblQuickOut')) {
            $('lblQuickOut').textContent = (activeWorkspace === 'inventory' && selectedInvIds.size > 0)
                ? `선택출고 (${selectedInvIds.size})`
                : '출고·마진 등록';
        }

        if ($('mobileFloatingSelectionBar')) {
            $('mobileFloatingSelectionBar').classList.toggle('d-none', cnt === 0);
        }
    }

    function toggleSelectAll(checked) {
        const set = getActiveSelectedSet();
        const selector = activeWorkspace === 'inventory' ? '.row-check' : '.tx-row-check';
        document.querySelectorAll(selector).forEach(chk => {
            chk.checked = checked;
            if (checked) set.add(String(chk.value));
            else set.delete(String(chk.value));
        });
        if (activeWorkspace === 'inventory') renderInventory();
        else renderTransactions();
        updateSelectedUI();
    }

    function toggleSelectOne(id, checked) {
        const set = getActiveSelectedSet();
        if (checked) set.add(String(id));
        else set.delete(String(id));
        if (activeWorkspace === 'inventory') renderInventory();
        else renderTransactions();
        updateSelectedUI();
    }

    async function handleDelete() {
        const set = getActiveSelectedSet();
        if (set.size === 0) {
            showToast('삭제할 항목을 먼저 체크해주세요.', 'warning');
            return;
        }

        const label = activeWorkspace === 'inventory' ? '재고 품목' : '입출고 전표 내역';
        if (!confirm(`선택한 ${set.size}건의 ${label}을(를) 정말 삭제하시겠습니까?`)) return;

        try {
            for (const id of set) {
                const endpoint = activeWorkspace === 'inventory'
                    ? `${API_BASE}/products/${id}`
                    : `${API_BASE}/transactions/${id}`;
                await authFetch(endpoint, { method: 'DELETE' });
            }
            set.clear();
            updateSelectedUI();
            showToast('선택한 항목이 삭제되었습니다.', 'success');
            await loadAllData();
        } catch (err) {
            showToast('삭제 중 오류: ' + err.message, 'error');
        }
    }

    function renderPagination(total, totalPages) {
        const container = $('pagination');
        if (!container) return;
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = `<button class="erp-page-btn" ${page <= 1 ? 'disabled' : ''} onclick="app.goPage(${page - 1})"><i class='bx bx-chevron-left'></i></button>`;
        const startP = Math.max(1, page - 2);
        const endP = Math.min(totalPages, startP + 4);
        for (let p = startP; p <= endP; p++) {
            html += `<button class="erp-page-btn ${p === page ? 'active' : ''}" onclick="app.goPage(${p})">${p}</button>`;
        }
        html += `<button class="erp-page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="app.goPage(${page + 1})"><i class='bx bx-chevron-right'></i></button>`;
        container.innerHTML = html;
    }

    function addSelectedToQuoteCart() {
        if (selectedInvIds.size === 0) {
            showToast('견적서에 담을 상품을 먼저 체크박스로 선택해주세요.', 'warning');
            return;
        }

        let cart = [];
        try {
            cart = JSON.parse(localStorage.getItem('kng_quote_cart') || '[]');
            if (!Array.isArray(cart)) cart = [];
        } catch (e) {
            cart = [];
        }

        let addedCount = 0;
        selectedInvIds.forEach(id => {
            const p = products.find(item => String(item.id) === String(id));
            if (!p) return;
            const m = computeProductMetrics(p);

            const existing = cart.find(c => c.source_module === 'hq-inventory' && String(c.source_id) === String(p.id));
            if (existing) {
                existing.qty = (Number(existing.qty) || 1) + 1;
            } else {
                cart.push({
                    source_module: 'hq-inventory',
                    source_id: p.id,
                    product_name: p.name || '',
                    spec: [p.color, p.size].filter(Boolean).join(' / ') || p.spec || '',
                    color: p.color || '',
                    unit: p.unit || 'EA',
                    qty: 1,
                    cost_price: m.buySupply,
                    unit_price: m.sellPrice || m.buySupply,
                    image_url: p.image_url || '',
                    remarks: p.supplier ? `[공급사: ${p.supplier}]` : ''
                });
            }
            addedCount++;
        });

        localStorage.setItem('kng_quote_cart', JSON.stringify(cart));
        showToast(`${addedCount}개 품목이 견적서 장바구니에 담겼습니다.`, 'success');

        if (confirm(`${addedCount}개 품목이 견적서 바구니에 담겼습니다.\n지금 [견적서 관리] 화면으로 이동하시겠습니까?`)) {
            location.href = './05_Management/forms/quotation.html';
        }
    }

    function exportExcel() {
        if (!window.XLSX) {
            showToast('엑셀 라이브러리를 불러오지 못했습니다.', 'error');
            return;
        }

        if (activeWorkspace === 'inventory') {
            const rows = filteredInvList.map((p, idx) => {
                const m = computeProductMetrics(p);
                return {
                    'No.': idx + 1,
                    '공급사': p.supplier || '최가유통',
                    '브랜드': p.brand || '',
                    '상품명': p.name || '',
                    '컬러': p.color || '',
                    '사이즈': p.size || '',
                    '상품가(VAT별도)': m.basePrice,
                    '운임(VAT별도)': m.freight,
                    '매입단가(공급가)': m.buySupply,
                    '인터넷최저가(상품)': m.onlinePrice,
                    '최저가배송비': m.onlineShipping,
                    '인터넷최저가(합계)': m.onlineTotal,
                    '적정판매가(VAT포함)': m.sellPrice,
                    '적정판매가(공급가환산)': m.sellSupply,
                    '예상판매마진(공급가기준)': m.unitMargin,
                    '예상마진율(%)': m.marginRate,
                    '현재재고': m.stock,
                    '재고평가액': m.stockValue
                };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '본사_실시간재고_적정판매가');
            XLSX.writeFile(wb, `본사_실시간재고_적정판매가_${todayStr()}.xlsx`);
            showToast('실시간 재고 및 적정판매가 엑셀 다운로드 완료!', 'success');
        } else {
            const rows = filteredTxList.map((t, idx) => {
                const tm = computeTxMetrics(t);
                return {
                    'No.': idx + 1,
                    '거래일자': t.txDate || '',
                    '구분': t.type === 'OUT' ? '출고' : '매입(입고)',
                    '공급사/출고처': t.supplier || '',
                    '브랜드': t.brand || '',
                    '상품명': t.productName || '',
                    '컬러': t.color || '',
                    '사이즈': t.size || '',
                    '수량': tm.qty,
                    '매입단가(원가/공급가)': tm.buySupply,
                    '인터넷최저가(합계)': tm.onlineTotal,
                    '적정판매가': tm.sellPrice,
                    '거래단가(공급가)': tm.txSupplyPrice,
                    '총거래액(공급가)': tm.totalAmount,
                    '개당마진(공급가기준)': tm.unitMargin,
                    '총판매마진(공급가기준)': tm.totalMargin,
                    '마진율(%)': tm.marginRate,
                    '비고': t.remarks || ''
                };
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '본사_입출고_마진원장');
            XLSX.writeFile(wb, `본사_입출고_마진원장_${todayStr()}.xlsx`);
            showToast('입출고 & 마진 원장 엑셀 다운로드 완료!', 'success');
        }
    }

    function printReport() {
        if ($('printMetaInfo')) {
            $('printMetaInfo').textContent = `출력일시: ${new Date().toLocaleString('ko-KR')} | 조회모드: ${activeWorkspace === 'inventory' ? '실시간 재고 현황' : '입출고 & 마진 원장'}`;
        }
        window.print();
    }

    function initGridResizer() {
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('inventoryTable');
            window.ErpGridResizer.init('txTable');
        }
    }

    function applyViewMode() {
        const isMobile = window.innerWidth <= 768;
        const invWrapper = $('inventoryGridWrapper');
        const txWrapper = $('txGridWrapper');
        const mobInvCards = $('mobileCardsContainer');
        const mobTxCards = $('mobileTxCardsContainer');

        if (!isMobile) {
            if (invWrapper) invWrapper.classList.remove('mobile-hidden-table');
            if (txWrapper) txWrapper.classList.remove('mobile-hidden-table');
            return;
        }

        const showTable = viewMode === 'table';
        if (invWrapper) invWrapper.classList.toggle('mobile-hidden-table', !showTable);
        if (txWrapper) txWrapper.classList.toggle('mobile-hidden-table', !showTable);
        if (mobInvCards) mobInvCards.classList.toggle('d-none', showTable);
        if (mobTxCards) mobTxCards.classList.toggle('d-none', showTable);
    }

    function toggleViewMode() {
        viewMode = viewMode === 'card' ? 'table' : 'card';
        applyViewMode();
    }

    // ==========================================
    // 13. Public App Interface
    // ==========================================
    const app = {
        switchWorkspace,
        openVoucherWithSelected,
        openVoucherForSingleProduct,
        setVoucherMode,
        addVoucherRow,
        removeVoucherRow,
        clearVoucherRows,
        onVoucherNameInput,
        selectVoucherProduct,
        onVoucherBaseOrFreightInput,
        onVoucherOnlineInput,
        applyOnlineToSellInRow,
        applyTargetSellToOutRow,
        recalcVoucherRow,
        recalcAllVoucherRows,
        submitVoucher,

        openNewModal,
        openEditModal,
        onProductBaseOrFreightInput,
        onProductOnlineInput,
        applyOnlineSumToProductSellPrice,
        calcModalMargin,
        handleSaveProduct,

        openTxEditModal,
        calcTxEditInPrice,
        recalcTxEditModal,
        handleSaveTxEdit,

        formatMoneyInput,
        clearZero,
        toggleSelectAll,
        toggleSelectOne,
        handleDelete,
        addSelectedToQuoteCart,
        exportExcel,
        printReport,
        toggleViewMode,

        setSupplierFilter(s) {
            supplierFilter = s;
            document.querySelectorAll('#supplierTabGroup .erp-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.supplier === s);
            });
            page = 1;
            renderInventory();
            renderTransactions();
        },

        setStockFilter(filter) {
            stockFilter = filter;
            document.querySelectorAll('#workspaceInventory .erp-filter-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.stock === filter);
            });
            document.querySelectorAll('#mobStockFilterBar .mob-stock-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.stock === filter);
            });
            page = 1;
            renderInventory();
        },

        setTxTypeFilter(type) {
            txTypeFilter = type;
            document.querySelectorAll('#txTypeChipGroup .erp-filter-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.txtype === type);
            });
            document.querySelectorAll('#mobTxTypeFilterBar .mob-stock-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.txtype === type);
            });
            page = 1;
            renderTransactions();
        },

        setTxDatePreset(preset) {
            document.querySelectorAll('.erp-date-presets .erp-date-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.preset === preset);
            });
            const now = new Date();
            const end = todayStr();
            let start = '';

            if (preset === 'today') {
                start = end;
            } else if (preset === 'week') {
                const d = new Date(now);
                d.setDate(d.getDate() - 7);
                start = d.toISOString().slice(0, 10);
            } else if (preset === 'month') {
                start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
            } else if (preset === '3months') {
                const d = new Date(now);
                d.setMonth(d.getMonth() - 3);
                start = d.toISOString().slice(0, 10);
            } else {
                start = '';
            }

            txStartDate = start;
            txEndDate = preset === 'all' ? '' : end;
            if ($('txStartDate')) $('txStartDate').value = txStartDate;
            if ($('txEndDate')) $('txEndDate').value = txEndDate;
            page = 1;
            renderTransactions();
        },

        onTxDateRangeChange() {
            txStartDate = $('txStartDate')?.value || '';
            txEndDate = $('txEndDate')?.value || '';
            document.querySelectorAll('.erp-date-presets .erp-date-chip').forEach(btn => btn.classList.remove('active'));
            page = 1;
            renderTransactions();
        },

        onTxSearchKeyup(e) {
            txSearchQuery = ($('txSearchInput')?.value || '').trim();
            if (e.key === 'Enter') {
                page = 1;
                renderTransactions();
            }
        },

        searchTx() {
            txSearchQuery = ($('txSearchInput')?.value || '').trim();
            page = 1;
            renderTransactions();
        },

        resetTxSearch() {
            txTypeFilter = '';
            txStartDate = '';
            txEndDate = '';
            txSearchQuery = '';
            if ($('txStartDate')) $('txStartDate').value = '';
            if ($('txEndDate')) $('txEndDate').value = '';
            if ($('txSearchInput')) $('txSearchInput').value = '';
            this.setTxTypeFilter('');
            this.setTxDatePreset('all');
        },

        onSearchTargetChange() {
            searchTarget = $('searchTarget')?.value || 'all';
            page = 1;
            renderInventory();
        },

        onSearchInputKeyup(e) {
            const val = $('searchInput')?.value || '';
            if ($('clearSearchBtn')) $('clearSearchBtn').classList.toggle('d-none', !val);
            if (e.key === 'Enter') this.search();
        },

        clearSearchInput() {
            if ($('searchInput')) $('searchInput').value = '';
            if ($('clearSearchBtn')) $('clearSearchBtn').classList.add('d-none');
            this.search();
        },

        onMobileSearchKeyup(e) {
            const val = $('mobileSearchInput')?.value || '';
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.toggle('d-none', !val);
            if (e.key === 'Enter') this.submitMobileSearch();
        },

        submitMobileSearch() {
            searchQuery = ($('mobileSearchInput')?.value || '').trim();
            txSearchQuery = searchQuery;
            if ($('searchInput')) $('searchInput').value = searchQuery;
            if ($('txSearchInput')) $('txSearchInput').value = searchQuery;
            page = 1;
            renderInventory();
            renderTransactions();
        },

        clearMobileSearch() {
            if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.add('d-none');
            this.submitMobileSearch();
        },

        search() {
            searchQuery = ($('searchInput')?.value || '').trim();
            page = 1;
            renderInventory();
        },

        resetSearch() {
            if ($('searchTarget')) $('searchTarget').value = 'all';
            searchTarget = 'all';
            if ($('searchInput')) $('searchInput').value = '';
            if ($('clearSearchBtn')) $('clearSearchBtn').classList.add('d-none');
            searchQuery = '';
            if ($('subSearchInput')) $('subSearchInput').value = '';
            if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
            subSearchQuery = '';
            this.setStockFilter('all');
            this.setSupplierFilter('');
        },

        onSubSearchInput(val) {
            subSearchQuery = (val || '').trim();
            if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.toggle('d-none', !subSearchQuery);
            page = 1;
            renderInventory();
        },

        clearSubSearch() {
            if ($('subSearchInput')) $('subSearchInput').value = '';
            if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
            subSearchQuery = '';
            page = 1;
            renderInventory();
        },

        changePageSize(size) {
            pageSize = size;
            page = 1;
            renderInventory();
            renderTransactions();
        },

        goPage(p) {
            page = p;
            if (activeWorkspace === 'inventory') {
                renderInventory();
                if ($('inventoryGridWrapper')) $('inventoryGridWrapper').scrollTop = 0;
            } else {
                renderTransactions();
                if ($('txGridWrapper')) $('txGridWrapper').scrollTop = 0;
            }
        },

        onRowClick(e, id, idx) {
            focusedRowIndex = idx;
            document.querySelectorAll('#tableBody tr').forEach((tr, i) => {
                tr.classList.toggle('focused-row', i === idx);
            });
        }
    };

    window.app = app;

    // ==========================================
    // 14. DOM Ready & Event Binding
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {
        if ($('productModal') && window.bootstrap) {
            productModal = new bootstrap.Modal($('productModal'), { keyboard: true });
        }
        if ($('voucherModal') && window.bootstrap) {
            voucherModal = new bootstrap.Modal($('voucherModal'), { keyboard: true });
        }
        if ($('txEditModal') && window.bootstrap) {
            txEditModal = new bootstrap.Modal($('txEditModal'), { keyboard: true });
        }

        // 재고 그리드 정렬 클릭
        document.querySelectorAll('#inventoryTable thead th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (invSort.col === col) invSort.asc = !invSort.asc;
                else { invSort.col = col; invSort.asc = true; }
                renderInventory();
            });
        });

        // 원장 그리드 정렬 클릭
        document.querySelectorAll('#txTable thead th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.txsort;
                if (txSort.col === col) txSort.asc = !txSort.asc;
                else { txSort.col = col; txSort.asc = false; }
                renderTransactions();
            });
        });

        // 외부 클릭 시 자동완성 드롭다운 닫기
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.position-relative')) {
                document.querySelectorAll('.erp-autocomplete-menu').forEach(el => el.classList.add('d-none'));
            }
        });

        window.addEventListener('resize', applyViewMode);

        // ECOUNT ERP 단축키 (F2: 입고전표 / F3: 출고전표 / F4: 단품등록 / F8: 저장 / Alt+A: 행추가)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F2') {
                e.preventDefault();
                openVoucherWithSelected('IN');
                return;
            }
            if (e.key === 'F3') {
                e.preventDefault();
                openVoucherWithSelected('OUT');
                return;
            }
            if (e.key === 'F4') {
                e.preventDefault();
                openNewModal();
                return;
            }
            if (e.altKey && (e.key === 'a' || e.key === 'A')) {
                if ($('voucherModal')?.classList.contains('show')) {
                    e.preventDefault();
                    addVoucherRow();
                }
                return;
            }
            if (e.key === 'F8') {
                e.preventDefault();
                if ($('voucherModal')?.classList.contains('show')) {
                    submitVoucher();
                } else if ($('productModal')?.classList.contains('show')) {
                    handleSaveProduct();
                } else if ($('txEditModal')?.classList.contains('show')) {
                    handleSaveTxEdit();
                }
            }
        });

        switchWorkspace(activeWorkspace);
        loadAllData();
    });
})();
