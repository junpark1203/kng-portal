/**
 * 본사 매입 현황 — 실시간 재고 (HQ Inventory) ECOUNT ERP Engine
 * - ECOUNT ERP 고밀도 시트 그리드 및 14개 컬럼 체제
 * - 스마트 다중 교집합(AND) 검색 및 결과 내 2차 재검색
 * - 공급사 퀵 탭 & 재고 상태 세그먼트 필터 (보유/부족/품절)
 * - F2(신규) / F8(저장) ECOUNT ERP 단축키 시스템 및 0 자동 클리어 UX
 * - 실시간 재고평가액 / 마진율 자동 계산 및 하단 요약 푸터
 * - SheetJS 엑셀 다운로드 및 A4 인쇄 서식 지원
 * - ErpGridResizer 열 너비 마우스 드래그 조절 & 자동맞춤
 */

(function () {
    'use strict';

    // ==========================================
    // Auth & API 설정
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
    // State
    // ==========================================
    let products = [];
    let metrics = { totalRevenue: 0, totalCost: 0 };
    let filteredList = [];
    const selectedIds = new Set();
    let focusedRowIndex = -1;
    let viewMode = window.innerWidth <= 768 ? 'card' : 'table'; // 'card' or 'table'

    let sort = { col: 'name', asc: true };
    let searchTarget = 'all';
    let searchQuery = '';
    let subSearchQuery = '';
    let stockFilter = 'all'; // 'all', 'in_stock', 'low_stock', 'out_of_stock'
    let supplierFilter = ''; // '' for all
    let page = 1;
    let pageSize = 50;

    let productModal = null;

    // ==========================================
    // Utility Helpers
    // ==========================================
    const $ = id => document.getElementById(id);
    const fmtNum = n => Number(n || 0).toLocaleString('ko-KR');
    const fmtWon = n => '₩' + fmtNum(n);
    const escHtml = s => {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };

    function showToast(msg, type = 'info') {
        const c = $('toastContainer');
        if (!c) return;
        const icons = { success: 'bx-check-circle', error: 'bx-error-circle', warning: 'bx-error', info: 'bx-info-circle' };
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.innerHTML = `<i class='bx ${icons[type] || icons.info} fs-5'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => t.remove(), 250);
        }, 3000);
    }

    // ==========================================
    // API Data Fetching
    // ==========================================
    async function fetchProducts() {
        try {
            const res = await authFetch(API_BASE + '/products');
            if (!res.ok) throw new Error('서버 통신 실패 (' + res.status + ')');
            products = await res.json();
            buildSupplierTabs();
            renderTable();
            initGridResizer();
            applyViewMode();
        } catch (e) {
            showToast('상품 목록 로딩 실패: ' + e.message, 'error');
            $('tableBody').innerHTML = `<tr><td colspan="14" class="text-center py-5 text-danger"><i class='bx bx-error-circle'></i> 데이터를 불러오지 못했습니다 (${escHtml(e.message)})</td></tr>`;
            if ($('mobileCardsContainer')) {
                $('mobileCardsContainer').innerHTML = `<div class="text-center py-5 text-danger"><i class='bx bx-error-circle fs-2 mb-2'></i><div>데이터를 불러오지 못했습니다.</div></div>`;
            }
        }
    }

    async function fetchMetrics() {
        try {
            const res = await authFetch(API_BASE + '/metrics');
            if (!res.ok) return;
            metrics = await res.json();
            if ($('kpiRevenueBadge')) $('kpiRevenueBadge').textContent = '누적 매출: ' + fmtWon(metrics.totalRevenue || 0);
            if ($('kpiCostBadge')) $('kpiCostBadge').textContent = '누적 매입: ' + fmtWon(metrics.totalCost || 0);
            if ($('mobileKpiRevenue')) $('mobileKpiRevenue').textContent = fmtWon(metrics.totalRevenue || 0);
            if ($('mobileKpiCost')) $('mobileKpiCost').textContent = fmtWon(metrics.totalCost || 0);
        } catch (e) { /* silent */ }
    }

    // ==========================================
    // 공급사 탭 생성 (동적 카운트 & 모바일 트랙/드로어 연동)
    // ==========================================
    function buildSupplierTabs() {
        const suppliersMap = {};
        products.forEach(p => {
            const s = (p.supplier || '최가유통').trim();
            suppliersMap[s] = (suppliersMap[s] || 0) + 1;
        });

        const tabGroup = $('supplierTabGroup');
        const sortedSuppliers = Object.keys(suppliersMap).sort();

        // 1) 데스크톱 탭
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

        // 2) 모바일 가로 스와이프 트랙 (#mobileSupplierScrollTrack)
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

        // 3) 모바일 필터 드로어 공급사 드롭다운 (#mobileDrawerSupplier)
        const drawerSelect = $('mobileDrawerSupplier');
        if (drawerSelect) {
            let optHtml = `<option value="">전체 공급사 (${products.length})</option>`;
            sortedSuppliers.forEach(s => {
                optHtml += `<option value="${escHtml(s)}" ${supplierFilter === s ? 'selected' : ''}>${escHtml(s)} (${suppliersMap[s]})</option>`;
            });
            drawerSelect.innerHTML = optHtml;
        }
    }

    // ==========================================
    // 필터링 & 검색 엔진
    // ==========================================
    function filterProducts() {
        let list = products.slice();

        // 1) 공급사 필터
        if (supplierFilter) {
            list = list.filter(p => (p.supplier || '최가유통').trim() === supplierFilter);
        }

        // 2) 재고 상태 세그먼트 필터
        if (stockFilter === 'in_stock') {
            list = list.filter(p => (p.stock || 0) > 0);
        } else if (stockFilter === 'low_stock') {
            list = list.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= 2);
        } else if (stockFilter === 'out_of_stock') {
            list = list.filter(p => (p.stock || 0) === 0);
        }

        // 3) 스마트 다중 교집합(AND) 검색
        if (searchQuery) {
            const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
            list = list.filter(p => {
                let targetText = '';
                if (searchTarget === 'all') {
                    targetText = [p.supplier, p.brand, p.name, p.color, p.size].join(' ').toLowerCase();
                } else if (searchTarget === 'supplier') {
                    targetText = (p.supplier || '').toLowerCase();
                } else if (searchTarget === 'brand') {
                    targetText = (p.brand || '').toLowerCase();
                } else if (searchTarget === 'name') {
                    targetText = (p.name || '').toLowerCase();
                } else if (searchTarget === 'color') {
                    targetText = (p.color || '').toLowerCase();
                } else if (searchTarget === 'size') {
                    targetText = (p.size || '').toLowerCase();
                }
                return tokens.every(tok => targetText.includes(tok));
            });
        }

        // 4) 결과 내 2차 재검색 (Sub-Search)
        if (subSearchQuery) {
            const sq = subSearchQuery.toLowerCase();
            list = list.filter(p => {
                const combined = [p.supplier, p.brand, p.name, p.color, p.size, p.buyPrice, p.sellPrice, p.discountPrice, p.stock].join(' ').toLowerCase();
                return combined.includes(sq);
            });
        }

        // 5) 정렬 (Sorting)
        list.sort((a, b) => {
            const buyA = Number(a.buyPrice) || 0, buyB = Number(b.buyPrice) || 0;
            const sellA = Number(a.sellPrice) || 0, sellB = Number(b.sellPrice) || 0;
            const discA = Number(a.discountPrice) || 0, discB = Number(b.discountPrice) || 0;
            const stockA = Number(a.stock) || 0, stockB = Number(b.stock) || 0;
            const stockValA = buyA * stockA, stockValB = buyB * stockB;
            const marginA = sellA > 0 ? ((sellA - buyA) / sellA) * 100 : 0;
            const marginB = sellB > 0 ? ((sellB - buyB) / sellB) * 100 : 0;

            let va = a[sort.col] ?? '', vb = b[sort.col] ?? '';

            if (sort.col === 'buyPrice') { va = buyA; vb = buyB; }
            else if (sort.col === 'sellPrice') { va = sellA; vb = sellB; }
            else if (sort.col === 'discountPrice') { va = discA; vb = discB; }
            else if (sort.col === 'stock') { va = stockA; vb = stockB; }
            else if (sort.col === 'stockValue') { va = stockValA; vb = stockValB; }
            else if (sort.col === 'marginRate') { va = marginA; vb = marginB; }
            else if (typeof va === 'string') {
                va = va.toLowerCase();
                vb = (vb + '').toLowerCase();
            }

            if (va < vb) return sort.asc ? -1 : 1;
            if (va > vb) return sort.asc ? 1 : -1;
            return 0;
        });

        filteredList = list;
        return list;
    }

    // ==========================================
    // 테이블 및 푸터 렌더링
    // ==========================================
    function renderTable() {
        const list = filterProducts();
        const tbody = $('tableBody');
        const tfoot = $('tableFoot');

        // 상단 KPI 뱃지 업데이트
        const totalItemsCount = list.length;
        const totalStockQty = list.reduce((s, p) => s + (Number(p.stock) || 0), 0);
        const totalStockVal = list.reduce((s, p) => s + ((Number(p.buyPrice) || 0) * (Number(p.stock) || 0)), 0);
        const totalSellVal = list.reduce((s, p) => s + ((Number(p.sellPrice) || 0) * (Number(p.stock) || 0)), 0);

        // 데스크톱 KPI
        if ($('skuCountBadge')) $('skuCountBadge').textContent = `관리 ${fmtNum(totalItemsCount)} SKU`;
        if ($('totalQtyBadge')) $('totalQtyBadge').textContent = `총 재고: ${fmtNum(totalStockQty)}개`;
        if ($('totalStockValueBadge')) $('totalStockValueBadge').textContent = `재고원가: ${fmtWon(totalStockVal)}`;

        // 모바일 헤더 및 초슬림 KPI 바 동기화
        if ($('mobileSkuBadge')) $('mobileSkuBadge').textContent = `${fmtNum(totalItemsCount)} SKU`;
        if ($('mobileKpiQty')) $('mobileKpiQty').textContent = fmtNum(totalStockQty);
        if ($('mobileKpiStockVal')) $('mobileKpiStockVal').textContent = fmtWon(totalStockVal);
        if ($('mobileKpiRevenue')) $('mobileKpiRevenue').textContent = fmtWon(metrics.totalRevenue || 0);
        if ($('mobileKpiCost')) $('mobileKpiCost').textContent = fmtWon(metrics.totalCost || 0);

        // 정렬 헤더 UI 갱신
        document.querySelectorAll('#inventoryTable thead th.sortable').forEach(th => {
            const col = th.dataset.sort;
            const icon = th.querySelector('.sort-icon');
            if (icon) {
                if (sort.col === col) {
                    th.classList.add('sorted');
                    icon.className = `bx bx-sort-${sort.asc ? 'up' : 'down'} sort-icon text-primary`;
                } else {
                    th.classList.remove('sorted');
                    icon.className = 'bx bx-sort sort-icon';
                }
            }
        });

        // 데이터가 없는 경우
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center py-5 text-muted"><i class='bx bx-search-alt'></i> 조건에 일치하는 상품 데이터가 없습니다.</td></tr>`;
            const mobContainer = $('mobileCardsContainer');
            if (mobContainer) {
                mobContainer.innerHTML = `
                    <div class="text-center py-5 text-muted">
                        <i class='bx bx-search-alt fs-1 text-secondary mb-2'></i>
                        <div class="fw-bold">조건에 일치하는 상품이 없습니다.</div>
                        <small class="text-muted">검색어 또는 필터 조건을 변경해 보세요.</small>
                    </div>
                `;
            }
            tfoot.classList.add('d-none');
            renderPagination(0);
            updateSelectedUI();
            return;
        }

        tfoot.classList.remove('d-none');

        // 페이지네이션 슬라이스
        let pagedList = list;
        let totalPages = 1;
        let startIdx = 0;

        if (pageSize !== 'all') {
            const ps = parseInt(pageSize, 10);
            totalPages = Math.ceil(list.length / ps) || 1;
            if (page > totalPages) page = totalPages;
            if (page < 1) page = 1;
            startIdx = (page - 1) * ps;
            pagedList = list.slice(startIdx, startIdx + ps);
        }

        let html = '';
        pagedList.forEach((p, idx) => {
            const rowNo = startIdx + idx + 1;
            const isChecked = selectedIds.has(p.id);
            const isFocused = focusedRowIndex === idx;

            const buyPrice = Number(p.buyPrice) || 0;
            const sellPrice = Number(p.sellPrice) || 0;
            const discPrice = Number(p.discountPrice) || 0;
            const stock = Number(p.stock) || 0;
            const stockVal = buyPrice * stock;

            // 마진율 계산
            let marginRate = 0;
            let marginBadge = '';
            if (sellPrice > 0) {
                const activeSell = discPrice > 0 ? discPrice : sellPrice;
                marginRate = Math.round(((activeSell - buyPrice) / activeSell) * 100);
                let badgeClass = 'mid';
                if (marginRate >= 40) badgeClass = 'high';
                else if (marginRate < 10 && marginRate >= 0) badgeClass = 'low';
                else if (marginRate < 0) badgeClass = 'neg';
                marginBadge = `<span class="margin-badge ${badgeClass}">${marginRate}%</span>`;
            } else {
                marginBadge = '<span class="text-muted">-</span>';
            }

            // 재고 상태 배지
            let stockBadge = '';
            if (stock === 0) {
                stockBadge = '<span class="stock-pill stock-zero">0 품절</span>';
            } else if (stock <= 2) {
                stockBadge = `<span class="stock-pill stock-low">${stock}</span>`;
            } else {
                stockBadge = `<span class="stock-pill stock-ok">${stock}</span>`;
            }

            html += `
                <tr class="${isChecked ? 'checked-row' : ''} ${isFocused ? 'focused-row' : ''}" onclick="app.onRowClick(event, '${escHtml(p.id)}', ${idx})">
                    <td class="col-check no-print" onclick="event.stopPropagation()">
                        <input type="checkbox" class="row-check" value="${escHtml(p.id)}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${escHtml(p.id)}', this.checked)">
                    </td>
                    <td class="col-no">${rowNo}</td>
                    <td class="text-center" title="${escHtml(p.supplier || '최가유통')}">${escHtml(p.supplier || '최가유통')}</td>
                    <td class="text-start ps-2" title="${escHtml(p.brand)}">${escHtml(p.brand)}</td>
                    <td class="text-start ps-2 fw-semibold" title="${escHtml(p.name)}">${escHtml(p.name)}</td>
                    <td class="text-center" title="${escHtml(p.color)}">${escHtml(p.color || '-')}</td>
                    <td class="text-center" title="${escHtml(p.size)}">${escHtml(p.size || '-')}</td>
                    <td class="col-num pe-2">${buyPrice > 0 ? fmtWon(buyPrice) : '-'}</td>
                    <td class="col-num pe-2">${sellPrice > 0 ? fmtWon(sellPrice) : '-'}</td>
                    <td class="col-num pe-2 text-danger">${discPrice > 0 ? fmtWon(discPrice) : '-'}</td>
                    <td class="text-center">${marginBadge}</td>
                    <td class="text-center">${stockBadge}</td>
                    <td class="col-num pe-2 fw-semibold" style="color: #047857;">${stockVal > 0 ? fmtWon(stockVal) : '-'}</td>
                    <td class="col-action text-center no-print" onclick="event.stopPropagation()">
                        <button type="button" class="btn-erp" style="height: 20px; padding: 0 5px; font-size: 10.5px;" onclick="app.openEditModal('${escHtml(p.id)}')">
                            <i class='bx bx-edit-alt'></i> 수정
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

        // 푸터 합계 계산 및 반영
        const avgBuy = totalItemsCount > 0 ? Math.round(list.reduce((s, p) => s + (Number(p.buyPrice) || 0), 0) / totalItemsCount) : 0;
        const avgSell = totalItemsCount > 0 ? Math.round(list.reduce((s, p) => s + (Number(p.sellPrice) || 0), 0) / totalItemsCount) : 0;
        const avgDiscount = totalItemsCount > 0 ? Math.round(list.reduce((s, p) => s + (Number(p.discountPrice) || 0), 0) / totalItemsCount) : 0;
        const avgMargin = avgSell > 0 ? Math.round(((avgSell - avgBuy) / avgSell) * 100) : 0;

        $('footSummaryText').textContent = `조회 품목 총 ${fmtNum(totalItemsCount)}건`;
        $('footAvgBuyPrice').textContent = avgBuy > 0 ? fmtWon(avgBuy) : '-';
        $('footAvgSellPrice').textContent = avgSell > 0 ? fmtWon(avgSell) : '-';
        $('footAvgDiscountPrice').textContent = avgDiscount > 0 ? fmtWon(avgDiscount) : '-';
        $('footAvgMargin').textContent = avgSell > 0 ? `${avgMargin}%` : '-';
        $('footTotalStock').textContent = fmtNum(totalStockQty);
        $('footTotalStockValue').textContent = fmtWon(totalStockVal);

        // 모바일 카드 뷰 렌더링
        renderMobileCards(pagedList);

        renderPagination(list.length);
        updateSelectedUI();
        initGridResizer();
    }

    // ==========================================
    // 모바일 전용 카드 뷰 렌더링
    // ==========================================
    function renderMobileCards(pagedList) {
        const container = $('mobileCardsContainer');
        if (!container) return;

        if (!pagedList || pagedList.length === 0) {
            container.innerHTML = `
                <div class="text-center py-5 text-muted">
                    <i class='bx bx-search-alt fs-1 text-secondary mb-2'></i>
                    <div class="fw-bold">조건에 일치하는 상품이 없습니다.</div>
                    <small class="text-muted">검색어 또는 필터 조건을 변경해 보세요.</small>
                </div>
            `;
            return;
        }

        let html = '';
        pagedList.forEach(p => {
            const isChecked = selectedIds.has(p.id);
            const buyPrice = Number(p.buyPrice) || 0;
            const sellPrice = Number(p.sellPrice) || 0;
            const discPrice = Number(p.discountPrice) || 0;
            const stock = Number(p.stock) || 0;
            const stockVal = buyPrice * stock;

            // 마진율 계산
            let marginRate = 0;
            let marginBadgeHtml = '<span class="text-muted small">-</span>';
            if (sellPrice > 0) {
                const activeSell = discPrice > 0 ? discPrice : sellPrice;
                marginRate = Math.round(((activeSell - buyPrice) / activeSell) * 100);
                let badgeClass = 'mid';
                if (marginRate >= 40) badgeClass = 'high';
                else if (marginRate < 10 && marginRate >= 0) badgeClass = 'low';
                else if (marginRate < 0) badgeClass = 'neg';
                marginBadgeHtml = `<span class="mobile-margin-badge badge-${badgeClass}">${marginRate}%</span>`;
            }

            // 재고 상태 뱃지
            let stockBadge = '';
            if (stock === 0) {
                stockBadge = '<span class="stock-pill stock-zero">0 품절</span>';
            } else if (stock <= 2) {
                stockBadge = `<span class="stock-pill stock-low">${stock}개</span>`;
            } else {
                stockBadge = `<span class="stock-pill stock-ok">${stock}개</span>`;
            }

            // 판매가 노출 방식 (할인가 있을 시 취소선 + 레드 강조)
            let priceHtml = '';
            if (discPrice > 0) {
                priceHtml = `
                    <div class="d-flex align-items-center gap-1 flex-wrap">
                        <span class="text-decoration-line-through text-muted" style="font-size: 11px;">${fmtWon(sellPrice)}</span>
                        <span class="text-danger fw-bold">${fmtWon(discPrice)}</span>
                    </div>
                `;
            } else {
                priceHtml = sellPrice > 0 ? fmtWon(sellPrice) : '-';
            }

            html += `
                <div class="mobile-hq-card ${isChecked ? 'checked-card' : ''}" data-id="${escHtml(p.id)}">
                    <div class="mob-card-head">
                        <div class="mob-card-head-left">
                            <input type="checkbox" class="form-check-input mt-0 row-check-mob" value="${escHtml(p.id)}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${escHtml(p.id)}', this.checked)">
                            <span class="mob-badge-supplier">${escHtml(p.supplier || '최가유통')}</span>
                            <span class="mob-badge-brand">${escHtml(p.brand || '-')}</span>
                        </div>
                        <div class="mob-card-head-right">
                            ${stockBadge}
                        </div>
                    </div>

                    <div class="mob-card-title">${escHtml(p.name)}</div>

                    <div class="mob-card-meta">
                        ${p.color ? `<span class="mob-meta-tag"><i class='bx bx-palette me-1 text-primary'></i>${escHtml(p.color)}</span>` : ''}
                        ${p.size ? `<span class="mob-meta-tag"><i class='bx bx-ruler me-1 text-secondary'></i>${escHtml(p.size)}</span>` : ''}
                    </div>

                    <div class="mob-card-grid">
                        <div class="mob-grid-item">
                            <span class="mob-grid-label">매입 단가</span>
                            <span class="mob-grid-val text-dark">${buyPrice > 0 ? fmtWon(buyPrice) : '-'}</span>
                        </div>
                        <div class="mob-grid-item">
                            <span class="mob-grid-label">${discPrice > 0 ? '할인 판매가' : '일반 판매가'}</span>
                            <span class="mob-grid-val">${priceHtml}</span>
                        </div>
                        <div class="mob-grid-item">
                            <span class="mob-grid-label">마진율</span>
                            <span class="mob-grid-val">${marginBadgeHtml}</span>
                        </div>
                        <div class="mob-grid-item">
                            <span class="mob-grid-label">재고 평가액</span>
                            <span class="mob-grid-val text-success">${stockVal > 0 ? fmtWon(stockVal) : '-'}</span>
                        </div>
                    </div>

                    <div class="mob-card-actions">
                        <button type="button" class="mob-action-btn btn-quote" onclick="app.addItemToQuoteCart('${escHtml(p.id)}')">
                            <i class='bx bx-cart-alt'></i> 견적담기
                        </button>
                        <div class="d-flex gap-1">
                            <button type="button" class="mob-action-btn btn-edit" onclick="app.openEditModal('${escHtml(p.id)}')">
                                <i class='bx bx-edit-alt'></i> 수정
                            </button>
                            <button type="button" class="mob-action-btn btn-delete" onclick="app.deleteSingleProduct('${escHtml(p.id)}')">
                                <i class='bx bx-trash'></i> 삭제
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    // ==========================================
    // 페이지네이션 렌더링
    // ==========================================
    function renderPagination(totalCount) {
        const bottomPageInfo = $('bottomPageInfo');
        const paginationContainer = $('pagination');

        if (pageSize === 'all' || totalCount === 0) {
            if (bottomPageInfo) bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 전체 표시`;
            if (paginationContainer) paginationContainer.innerHTML = '';
            return;
        }

        const ps = parseInt(pageSize, 10);
        const totalPages = Math.ceil(totalCount / ps) || 1;
        const startItem = (page - 1) * ps + 1;
        const endItem = Math.min(page * ps, totalCount);

        if (bottomPageInfo) bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 중 ${fmtNum(startItem)}~${fmtNum(endItem)}`;

        let html = '';
        html += `<button type="button" class="erp-page-btn" ${page <= 1 ? 'disabled' : ''} onclick="app.goPage(${page - 1})">‹</button>`;

        const startP = Math.max(1, page - 2);
        const endP = Math.min(totalPages, startP + 4);

        if (startP > 1) {
            html += `<button type="button" class="erp-page-btn" onclick="app.goPage(1)">1</button>`;
            if (startP > 2) html += `<span class="px-1 text-muted">...</span>`;
        }

        for (let p = startP; p <= endP; p++) {
            html += `<button type="button" class="erp-page-btn ${p === page ? 'active' : ''}" onclick="app.goPage(${p})">${p}</button>`;
        }

        if (endP < totalPages) {
            if (endP < totalPages - 1) html += `<span class="px-1 text-muted">...</span>`;
            html += `<button type="button" class="erp-page-btn" onclick="app.goPage(${totalPages})">${totalPages}</button>`;
        }

        html += `<button type="button" class="erp-page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="app.goPage(${page + 1})">›</button>`;
        if (paginationContainer) paginationContainer.innerHTML = html;
    }

    // ==========================================
    // 선택 및 체크박스 제어
    // ==========================================
    function updateSelectedUI() {
        const count = selectedIds.size;
        if ($('selectedCount')) $('selectedCount').textContent = count;
        if ($('bottomSelectedCount')) $('bottomSelectedCount').textContent = count;

        // 모바일 플로팅 일괄 선택 바 업데이트
        const mobFloatingBar = $('mobileFloatingSelectionBar');
        const mobSelCount = $('mobileSelectionCount');
        const mobSelectAllCheck = $('mobSelectAllCheck');
        if (mobFloatingBar) {
            mobFloatingBar.classList.toggle('d-none', count === 0);
        }
        if (mobSelCount) {
            mobSelCount.textContent = count;
        }

        // 모바일 카드 체크박스 및 배경 동기화
        document.querySelectorAll('.mobile-hq-card').forEach(card => {
            const id = card.dataset.id;
            const checked = selectedIds.has(id);
            card.classList.toggle('checked-card', checked);
            const chk = card.querySelector('.row-check-mob');
            if (chk) chk.checked = checked;
        });

        // 데스크톱 테이블 행 체크박스 및 배경 동기화
        document.querySelectorAll('#tableBody tr').forEach(tr => {
            const chk = tr.querySelector('.row-check');
            if (chk) {
                const checked = selectedIds.has(chk.value);
                chk.checked = checked;
                tr.classList.toggle('checked-row', checked);
            }
        });

        const selectAll = $('selectAll');
        const pageChecks = document.querySelectorAll('.row-check');
        if (selectAll && pageChecks.length > 0) {
            const allChecked = Array.from(pageChecks).every(c => c.checked);
            const someChecked = Array.from(pageChecks).some(c => c.checked);
            selectAll.checked = allChecked;
            selectAll.indeterminate = someChecked && !allChecked;
            if (mobSelectAllCheck) {
                mobSelectAllCheck.checked = allChecked;
                mobSelectAllCheck.indeterminate = someChecked && !allChecked;
            }
        } else if (selectAll) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
            if (mobSelectAllCheck) {
                mobSelectAllCheck.checked = false;
                mobSelectAllCheck.indeterminate = false;
            }
        }
    }

    // ==========================================
    // 뷰 모드 전환 (카드 뷰 <-> ECOUNT 그리드)
    // ==========================================
    function toggleViewMode() {
        viewMode = viewMode === 'card' ? 'table' : 'card';
        applyViewMode();
    }

    function applyViewMode() {
        const gridWrap = $('inventoryGridWrapper');
        const cardWrap = $('mobileCardsContainer');
        const toggleBtn = $('mobileViewToggleBtn');
        const bottomBar = document.querySelector('.erp-bottom-bar');

        if (window.innerWidth <= 768) {
            if (viewMode === 'card') {
                if (gridWrap) gridWrap.classList.add('mobile-hidden-table');
                if (cardWrap) cardWrap.classList.remove('d-none');
                if (bottomBar) bottomBar.classList.add('d-none');
                if (toggleBtn) {
                    toggleBtn.innerHTML = "<i class='bx bx-table'></i>";
                    toggleBtn.title = "테이블 그리드로 보기";
                }
            } else {
                if (gridWrap) gridWrap.classList.remove('mobile-hidden-table');
                if (cardWrap) cardWrap.classList.add('d-none');
                if (bottomBar) bottomBar.classList.remove('d-none');
                if (toggleBtn) {
                    toggleBtn.innerHTML = "<i class='bx bx-grid-alt'></i>";
                    toggleBtn.title = "카드 뷰로 보기";
                }
            }
        } else {
            if (gridWrap) gridWrap.classList.remove('mobile-hidden-table');
            if (cardWrap) cardWrap.classList.add('d-none');
            if (bottomBar) bottomBar.classList.remove('d-none');
        }
    }

    // ==========================================
    // 모달 및 CRUD 제어
    // ==========================================
    function openNewModal() {
        $('editId').value = '';
        $('modalModeTitle').textContent = '본사 신규 상품 등록';

        // PC 폼 필드 초기화
        $('mSupplier').value = '최가유통';
        $('mBrand').value = '';
        $('mName').value = '';
        $('mColor').value = '';
        $('mSize').value = '';
        $('mBuyPrice').value = '0';
        $('mSellPrice').value = '0';
        $('mDiscountPrice').value = '0';
        $('mStock').value = '0';

        // 모바일 폼 필드 동기화
        if ($('mobSupplier')) $('mobSupplier').value = '최가유통';
        if ($('mobBrand')) $('mobBrand').value = '';
        if ($('mobName')) $('mobName').value = '';
        if ($('mobColor')) $('mobColor').value = '';
        if ($('mobSize')) $('mobSize').value = '';
        if ($('mobBuyPrice')) $('mobBuyPrice').value = '0';
        if ($('mobSellPrice')) $('mobSellPrice').value = '0';
        if ($('mobDiscountPrice')) $('mobDiscountPrice').value = '0';
        if ($('mobStock')) $('mobStock').value = '0';

        calcModalMargin();
        productModal.show();
        setTimeout(() => {
            if (window.innerWidth <= 768) {
                if ($('mobBrand')) $('mobBrand').focus();
            } else {
                $('mBrand').focus();
            }
        }, 300);
    }

    function openEditModal(id) {
        const p = products.find(item => String(item.id) === String(id));
        if (!p) {
            showToast('상품 정보를 찾을 수 없습니다.', 'warning');
            return;
        }

        $('editId').value = p.id;
        $('modalModeTitle').textContent = `상품 정보 수정 (${p.name})`;

        // PC 폼 필드 채우기
        $('mSupplier').value = p.supplier || '최가유통';
        $('mBrand').value = p.brand || '';
        $('mName').value = p.name || '';
        $('mColor').value = p.color || '';
        $('mSize').value = p.size || '';
        $('mBuyPrice').value = fmtNum(p.buyPrice || 0);
        $('mSellPrice').value = fmtNum(p.sellPrice || 0);
        $('mDiscountPrice').value = fmtNum(p.discountPrice || 0);
        $('mStock').value = p.stock ?? 0;

        // 모바일 폼 필드 채우기
        if ($('mobSupplier')) $('mobSupplier').value = p.supplier || '최가유통';
        if ($('mobBrand')) $('mobBrand').value = p.brand || '';
        if ($('mobName')) $('mobName').value = p.name || '';
        if ($('mobColor')) $('mobColor').value = p.color || '';
        if ($('mobSize')) $('mobSize').value = p.size || '';
        if ($('mobBuyPrice')) $('mobBuyPrice').value = fmtNum(p.buyPrice || 0);
        if ($('mobSellPrice')) $('mobSellPrice').value = fmtNum(p.sellPrice || 0);
        if ($('mobDiscountPrice')) $('mobDiscountPrice').value = fmtNum(p.discountPrice || 0);
        if ($('mobStock')) $('mobStock').value = p.stock ?? 0;

        calcModalMargin();
        productModal.show();
        setTimeout(() => {
            if (window.innerWidth <= 768) {
                if ($('mobStock')) $('mobStock').focus();
            } else {
                $('mStock').focus();
            }
        }, 300);
    }

    function syncModalInputs(field) {
        if (field === 'supplier') {
            if ($('mobSupplier')) $('mSupplier').value = $('mobSupplier').value;
        } else if (field === 'brand') {
            if ($('mobBrand')) $('mBrand').value = $('mobBrand').value;
        } else if (field === 'name') {
            if ($('mobName')) $('mName').value = $('mobName').value;
        } else if (field === 'color') {
            if ($('mobColor')) $('mColor').value = $('mobColor').value;
        } else if (field === 'size') {
            if ($('mobSize')) $('mSize').value = $('mobSize').value;
        } else if (field === 'stock') {
            if ($('mobStock')) $('mStock').value = $('mobStock').value;
        } else if (field === 'buyPrice') {
            if ($('mobBuyPrice')) $('mBuyPrice').value = $('mobBuyPrice').value;
        } else if (field === 'sellPrice') {
            if ($('mobSellPrice')) $('mSellPrice').value = $('mobSellPrice').value;
        } else if (field === 'discountPrice') {
            if ($('mobDiscountPrice')) $('mDiscountPrice').value = $('mobDiscountPrice').value;
        }
    }

    function calcModalMargin() {
        const buy = parseNumber($('mBuyPrice').value || ($('mobBuyPrice') && $('mobBuyPrice').value));
        const sell = parseNumber($('mSellPrice').value || ($('mobSellPrice') && $('mobSellPrice').value));
        const stock = parseNumber($('mStock').value || ($('mobStock') && $('mobStock').value));
        const disc = parseNumber($('mDiscountPrice').value || ($('mobDiscountPrice') && $('mobDiscountPrice').value));

        // PC 요약 패널
        const marginEl = $('modalExpectedMargin');
        if (marginEl) {
            if (sell > 0) {
                const marginRate = Math.round(((sell - buy) / sell) * 100);
                marginEl.textContent = `${marginRate}% (마진 ₩${fmtNum(sell - buy)})`;
                marginEl.className = marginRate >= 30 ? 'text-success fs-6' : (marginRate < 10 ? 'text-danger fs-6' : 'text-primary fs-6');
            } else {
                marginEl.textContent = '-';
                marginEl.className = 'text-muted fs-6';
            }
        }
        if ($('modalExpectedStockValue')) {
            $('modalExpectedStockValue').textContent = fmtWon(buy * stock);
        }

        // 모바일 실시간 프리뷰 카드
        const mobBadge = $('mobModalMarginBadge');
        if (mobBadge) {
            if (sell > 0) {
                const activeSell = disc > 0 ? disc : sell;
                const marginRate = Math.round(((activeSell - buy) / activeSell) * 100);
                let badgeClass = 'badge-mid';
                if (marginRate >= 40) badgeClass = 'badge-high';
                else if (marginRate < 10 && marginRate >= 0) badgeClass = 'badge-low';
                else if (marginRate < 0) badgeClass = 'badge-neg';

                mobBadge.textContent = `${marginRate}%`;
                mobBadge.className = `mobile-margin-badge ${badgeClass}`;
            } else {
                mobBadge.textContent = '미등록';
                mobBadge.className = 'mobile-margin-badge badge-mid';
            }
        }
        if ($('mobModalBuyPreview')) $('mobModalBuyPreview').textContent = fmtWon(buy);
        if ($('mobModalSellPreview')) $('mobModalSellPreview').textContent = sell > 0 ? fmtWon(sell) : '₩0';
        if ($('mobModalProfitPreview')) {
            const profit = sell > 0 ? (sell - buy) : 0;
            $('mobModalProfitPreview').textContent = (profit >= 0 ? '+' : '') + fmtWon(profit);
            $('mobModalProfitPreview').className = profit < 0 ? 'mob-preview-val text-danger' : 'mob-preview-val text-success';
        }
        if ($('mobModalStockValPreview')) $('mobModalStockValPreview').textContent = fmtWon(buy * stock);
    }

    function parseNumber(val) {
        if (!val) return 0;
        return parseInt(String(val).replace(/[^0-9]/g, ''), 10) || 0;
    }

    function formatMoneyInput(el) {
        const num = parseNumber(el.value);
        el.value = fmtNum(num);
    }

    function clearZero(el) {
        if (el.value === '0' || el.value === '0원') {
            el.value = '';
        }
    }

    async function handleSaveProduct(e) {
        if (e) e.preventDefault();

        const id = $('editId').value.trim();
        const supplier = ($('mSupplier').value || ($('mobSupplier') && $('mobSupplier').value) || '최가유통').trim();
        const brand = ($('mBrand').value || ($('mobBrand') && $('mobBrand').value) || '').trim();
        const name = ($('mName').value || ($('mobName') && $('mobName').value) || '').trim();
        const color = ($('mColor').value || ($('mobColor') && $('mobColor').value) || '').trim();
        const size = ($('mSize').value || ($('mobSize') && $('mobSize').value) || '').trim();
        const buyPrice = parseNumber($('mBuyPrice').value || ($('mobBuyPrice') && $('mobBuyPrice').value));
        const sellPrice = parseNumber($('mSellPrice').value || ($('mobSellPrice') && $('mobSellPrice').value));
        const discountPrice = parseNumber($('mDiscountPrice').value || ($('mobDiscountPrice') && $('mobDiscountPrice').value));
        const stock = parseNumber($('mStock').value || ($('mobStock') && $('mobStock').value));

        if (!brand) {
            showToast('브랜드를 입력해 주세요.', 'warning');
            if (window.innerWidth <= 768 && $('mobBrand')) $('mobBrand').focus();
            else $('mBrand').focus();
            return;
        }
        if (!name) {
            showToast('상품명을 입력해 주세요.', 'warning');
            if (window.innerWidth <= 768 && $('mobName')) $('mobName').focus();
            else $('mName').focus();
            return;
        }

        const payload = {
            supplier, brand, name, color, size,
            buyPrice, sellPrice, discountPrice, stock
        };

        const isEdit = !!id;
        const url = isEdit ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || '저장 실패');
            }

            showToast(isEdit ? '상품 정보가 수정되었습니다.' : '신규 상품이 등록되었습니다.', 'success');
            productModal.hide();
            await fetchProducts();
            await fetchMetrics();
        } catch (err) {
            showToast('저장 중 오류 발생: ' + err.message, 'error');
        }
    }

    async function handleDelete() {
        if (selectedIds.size === 0) {
            showToast('삭제할 상품을 먼저 체크박스로 선택해 주세요.', 'warning');
            return;
        }

        const count = selectedIds.size;
        if (!confirm(`선택한 ${count}개 상품을 영구 삭제하시겠습니까?\n(입출고 내역 데이터에는 영향이 없습니다)`)) return;

        const ids = Array.from(selectedIds);
        try {
            const res = await authFetch(API_BASE + '/products/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            if (!res.ok) throw new Error('삭제 처리 실패');

            showToast(`${count}개 상품이 삭제되었습니다.`, 'success');
            selectedIds.clear();
            await fetchProducts();
            await fetchMetrics();
        } catch (err) {
            showToast('삭제 중 오류: ' + err.message, 'error');
        }
    }

    async function deleteSingleProduct(id) {
        const p = products.find(item => String(item.id) === String(id));
        const name = p ? p.name : '해당 상품';
        if (!confirm(`[${name}] 상품을 영구 삭제하시겠습니까?\n(입출고 내역 데이터에는 영향이 없습니다)`)) return;

        try {
            const res = await authFetch(API_BASE + '/products/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [id] })
            });

            if (!res.ok) throw new Error('삭제 처리 실패');

            showToast(`[${name}] 상품이 삭제되었습니다.`, 'success');
            selectedIds.delete(id);
            await fetchProducts();
            await fetchMetrics();
        } catch (err) {
            showToast('삭제 중 오류: ' + err.message, 'error');
        }
    }

    function addItemToQuoteCart(id) {
        const p = products.find(item => String(item.id) === String(id));
        if (!p) {
            showToast('상품 정보를 찾을 수 없습니다.', 'warning');
            return;
        }

        let cart = [];
        try {
            cart = JSON.parse(localStorage.getItem('kng_quote_cart') || '[]');
            if (!Array.isArray(cart)) cart = [];
        } catch (e) {
            cart = [];
        }

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
                cost_price: Number(p.buyPrice || 0),
                unit_price: Number(p.discountPrice || p.sellPrice || p.buyPrice || 0),
                image_url: p.image_url || '',
                remarks: p.supplier ? `[공급사: ${p.supplier}]` : ''
            });
        }

        localStorage.setItem('kng_quote_cart', JSON.stringify(cart));
        showToast(`[${p.name}] 견적서 장바구니에 담겼습니다.`, 'success');

        if (confirm(`[${p.name}] 품목이 견적서 바구니에 담겼습니다.\n(현재 바구니 총 ${cart.length}개 품목)\n\n지금 [견적서 관리] 화면으로 이동하시겠습니까?`)) {
            location.href = './05_Management/forms/quotation.html';
        }
    }

    // ==========================================
    // 엑셀 내보내기 (SheetJS)
    // ==========================================
    function exportExcel() {
        if (typeof XLSX === 'undefined') {
            showToast('엑셀 생성 라이브러리를 불러오지 못했습니다.', 'error');
            return;
        }

        const list = filterProducts();
        if (list.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }

        const excelData = list.map((p, idx) => {
            const buy = Number(p.buyPrice) || 0;
            const sell = Number(p.sellPrice) || 0;
            const disc = Number(p.discountPrice) || 0;
            const stock = Number(p.stock) || 0;
            const activeSell = disc > 0 ? disc : sell;
            const margin = activeSell > 0 ? Math.round(((activeSell - buy) / activeSell) * 100) : 0;
            const stockVal = buy * stock;

            return {
                'No.': idx + 1,
                '공급사': p.supplier || '최가유통',
                '브랜드': p.brand,
                '상품명': p.name,
                '컬러': p.color || '',
                '사이즈': p.size || '',
                '매입단가(공급가)': buy,
                '일반판매가(VAT포함)': sell,
                '할인판매가(VAT포함)': disc,
                '마진율(%)': margin,
                '현재재고': stock,
                '재고평가액': stockVal
            };
        });

        // 푸터 합계 행 추가
        const totalStock = list.reduce((s, p) => s + (Number(p.stock) || 0), 0);
        const totalVal = list.reduce((s, p) => s + ((Number(p.buyPrice) || 0) * (Number(p.stock) || 0)), 0);
        excelData.push({
            'No.': '합계',
            '공급사': '',
            '브랜드': '',
            '상품명': `총 ${list.length} SKU`,
            '컬러': '',
            '사이즈': '',
            '매입단가(공급가)': '',
            '일반판매가(VAT포함)': '',
            '할인판매가(VAT포함)': '',
            '마진율(%)': '',
            '현재재고': totalStock,
            '재고평가액': totalVal
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '실시간재고현황');

        const now = new Date();
        const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
        XLSX.writeFile(wb, `본사_실시간재고현황_${ymd}.xlsx`);
        showToast('엑셀 파일이 다운로드되었습니다.', 'success');
    }

    // ==========================================
    // 인쇄 출력
    // ==========================================
    function printReport() {
        const now = new Date();
        const nowStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0');

        $('printMetaInfo').textContent = `출력일시: ${nowStr} | 조회 조건: [공급사: ${supplierFilter || '전체'}] [상태: ${stockFilter}] [검색: ${searchQuery || '전체'}]`;
        window.print();
    }

    // ==========================================
    // 열 너비 조절기 초기화
    // ==========================================
    function initGridResizer() {
        if (window.ErpGridResizer && typeof window.ErpGridResizer.init === 'function') {
            setTimeout(() => {
                window.ErpGridResizer.init('inventoryTable', {
                    storageKey: 'kng_hq_inventory_grid_widths_v1'
                });
            }, 60);
        }
    }

    // ==========================================
    // 모바일 필터 드로어 제어
    // ==========================================
    function toggleMobileFilter() {
        const drawer = $('mobileFilterDrawer');
        const backdrop = $('mobileFilterBackdrop');
        if (!drawer || !backdrop) return;

        const isOpen = drawer.classList.contains('open');
        if (isOpen) {
            drawer.classList.remove('open');
            backdrop.classList.add('d-none');
        } else {
            // 필터 드로어 열릴 때 현재 필터값 동기화
            if ($('mobileDrawerSupplier')) $('mobileDrawerSupplier').value = supplierFilter;
            if ($('mobileDrawerStock')) $('mobileDrawerStock').value = stockFilter;
            if ($('mobileDrawerTarget')) $('mobileDrawerTarget').value = searchTarget;
            if ($('mobileDrawerSort')) $('mobileDrawerSort').value = `${sort.col}_${sort.asc ? 'asc' : 'desc'}`;

            drawer.classList.add('open');
            backdrop.classList.remove('d-none');
        }
    }

    function applyMobileDrawerFilter() {
        if ($('mobileDrawerSupplier')) {
            supplierFilter = $('mobileDrawerSupplier').value;
        }
        if ($('mobileDrawerStock')) {
            stockFilter = $('mobileDrawerStock').value;
        }
        if ($('mobileDrawerTarget')) {
            searchTarget = $('mobileDrawerTarget').value;
            if ($('searchTarget')) $('searchTarget').value = searchTarget;
        }
        if ($('mobileDrawerSort')) {
            const sVal = $('mobileDrawerSort').value.split('_');
            sort.col = sVal[0];
            sort.asc = sVal[1] === 'asc';
        }

        // 모바일 필터 활성 뱃지(레드 닷) 표시 여부
        const hasFilter = supplierFilter !== '' || stockFilter !== 'all' || searchTarget !== 'all';
        if ($('mobileFilterDot')) $('mobileFilterDot').classList.toggle('d-none', !hasFilter);

        // 상단 칩 UI 동기화
        document.querySelectorAll('#supplierTabGroup .erp-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.supplier === supplierFilter);
        });
        document.querySelectorAll('.mobile-supplier-chip').forEach(chip => {
            const s = chip.getAttribute('onclick') || '';
            if (supplierFilter === '') {
                chip.classList.toggle('active', s.includes("('')"));
            } else {
                chip.classList.toggle('active', s.includes(`('${supplierFilter}')`));
            }
        });
        document.querySelectorAll('.erp-stock-filters .erp-filter-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.stock === stockFilter);
        });
        document.querySelectorAll('.mobile-stock-filter-track .mob-stock-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.stock === stockFilter);
        });

        toggleMobileFilter();
        page = 1;
        renderTable();
    }

    function resetMobileDrawerFilter() {
        supplierFilter = '';
        stockFilter = 'all';
        searchTarget = 'all';
        sort = { col: 'name', asc: true };
        searchQuery = '';
        subSearchQuery = '';

        if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
        if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.add('d-none');
        if ($('searchInput')) $('searchInput').value = '';
        if ($('clearSearchBtn')) $('clearSearchBtn').classList.add('d-none');
        if ($('mobileFilterDot')) $('mobileFilterDot').classList.add('d-none');

        // 상단 칩 UI 동기화
        document.querySelectorAll('#supplierTabGroup .erp-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.supplier === '');
        });
        document.querySelectorAll('.mobile-supplier-chip').forEach(chip => {
            const s = chip.getAttribute('onclick') || '';
            chip.classList.toggle('active', s.includes("('')"));
        });
        document.querySelectorAll('.erp-stock-filters .erp-filter-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.stock === 'all');
        });
        document.querySelectorAll('.mobile-stock-filter-track .mob-stock-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.stock === 'all');
        });

        toggleMobileFilter();
        page = 1;
        renderTable();
    }

    // ==========================================
    // 이벤트 바인딩 & 공개 인터페이스
    // ==========================================
    const app = {
        setSupplierFilter(s) {
            supplierFilter = s;
            document.querySelectorAll('#supplierTabGroup .erp-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.supplier === s);
            });
            document.querySelectorAll('.mobile-supplier-chip').forEach(chip => {
                const onclickAttr = chip.getAttribute('onclick') || '';
                if (s === '') {
                    chip.classList.toggle('active', onclickAttr.includes("('')"));
                } else {
                    chip.classList.toggle('active', onclickAttr.includes(`('${s}')`));
                }
            });
            if ($('mobileDrawerSupplier')) $('mobileDrawerSupplier').value = s;
            page = 1;
            renderTable();
        },

        setStockFilter(filter) {
            stockFilter = filter;
            document.querySelectorAll('.erp-stock-filters .erp-filter-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.stock === filter);
            });
            document.querySelectorAll('.mobile-stock-filter-track .mob-stock-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.stock === filter);
            });
            if ($('mobileDrawerStock')) $('mobileDrawerStock').value = filter;
            page = 1;
            renderTable();
        },

        onSearchTargetChange() {
            searchTarget = $('searchTarget').value;
            if ($('mobileDrawerTarget')) $('mobileDrawerTarget').value = searchTarget;
            page = 1;
            renderTable();
        },

        onSearchInputKeyup(e) {
            const val = $('searchInput').value;
            $('clearSearchBtn').classList.toggle('d-none', !val);
            if (e.key === 'Enter') {
                this.search();
            }
        },

        clearSearchInput() {
            $('searchInput').value = '';
            $('clearSearchBtn').classList.add('d-none');
            if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.add('d-none');
            this.search();
        },

        onMobileSearchKeyup(e) {
            const val = $('mobileSearchInput').value;
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.toggle('d-none', !val);
            if (e.key === 'Enter') {
                this.submitMobileSearch();
            }
        },

        submitMobileSearch() {
            searchQuery = ($('mobileSearchInput').value || '').trim();
            $('searchInput').value = searchQuery;
            $('clearSearchBtn').classList.toggle('d-none', !searchQuery);
            page = 1;
            renderTable();
        },

        clearMobileSearch() {
            if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.add('d-none');
            $('searchInput').value = '';
            $('clearSearchBtn').classList.add('d-none');
            this.search();
        },

        search() {
            searchQuery = $('searchInput').value.trim();
            if ($('mobileSearchInput')) $('mobileSearchInput').value = searchQuery;
            page = 1;
            renderTable();
        },

        resetSearch() {
            $('searchTarget').value = 'all';
            searchTarget = 'all';
            $('searchInput').value = '';
            $('clearSearchBtn').classList.add('d-none');
            if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.add('d-none');
            searchQuery = '';
            $('subSearchInput').value = '';
            $('clearSubSearchBtn').classList.add('d-none');
            subSearchQuery = '';
            this.setStockFilter('all');
            this.setSupplierFilter('');
        },

        onSubSearchInput(val) {
            subSearchQuery = (val || '').trim();
            $('clearSubSearchBtn').classList.toggle('d-none', !subSearchQuery);
            page = 1;
            renderTable();
        },

        clearSubSearch() {
            $('subSearchInput').value = '';
            $('clearSubSearchBtn').classList.add('d-none');
            subSearchQuery = '';
            page = 1;
            renderTable();
        },

        changePageSize(size) {
            pageSize = size;
            page = 1;
            renderTable();
        },

        goPage(p) {
            page = p;
            renderTable();
            $('inventoryGridWrapper').scrollTop = 0;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },

        toggleSelectAll(checked) {
            const pageChecks = document.querySelectorAll('.row-check');
            pageChecks.forEach(c => {
                c.checked = checked;
                if (checked) selectedIds.add(c.value);
                else selectedIds.delete(c.value);
            });
            updateSelectedUI();
        },

        toggleSelectOne(id, checked) {
            if (checked) selectedIds.add(id);
            else selectedIds.delete(id);
            updateSelectedUI();
        },

        onRowClick(e, id, idx) {
            focusedRowIndex = idx;
            document.querySelectorAll('#tableBody tr').forEach((tr, i) => {
                tr.classList.toggle('focused-row', i === idx);
            });
        },

        addSelectedToQuoteCart() {
            if (selectedIds.size === 0) {
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
            selectedIds.forEach(id => {
                const p = products.find(item => String(item.id) === String(id));
                if (!p) return;

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
                        cost_price: Number(p.buyPrice || 0),
                        unit_price: Number(p.discountPrice || p.sellPrice || p.buyPrice || 0),
                        image_url: p.image_url || '',
                        remarks: p.supplier ? `[공급사: ${p.supplier}]` : ''
                    });
                }
                addedCount++;
            });

            localStorage.setItem('kng_quote_cart', JSON.stringify(cart));
            showToast(`${addedCount}개 품목이 견적서 장바구니에 담겼습니다.`, 'success');

            if (confirm(`${addedCount}개 품목이 견적서 바구니에 담겼습니다.\n(현재 바구니 총 ${cart.length}개 품목)\n\n지금 [견적서 관리] 화면으로 이동하시겠습니까?`)) {
                location.href = './05_Management/forms/quotation.html';
            }
        },

        addItemToQuoteCart,
        deleteSingleProduct,
        openNewModal,
        openEditModal,
        syncModalInputs,
        calcModalMargin,
        formatMoneyInput,
        clearZero,
        handleSaveProduct,
        handleDelete,
        exportExcel,
        printReport,
        toggleViewMode,
        toggleMobileFilter,
        applyMobileDrawerFilter,
        resetMobileDrawerFilter
    };

    window.app = app;

    // DOM Ready
    document.addEventListener('DOMContentLoaded', () => {
        // Bootstrap modal 초기화
        const modalEl = $('productModal');
        if (modalEl && window.bootstrap) {
            productModal = new bootstrap.Modal(modalEl, { keyboard: true });
        }

        // 헤더 컬럼 정렬 클릭 이벤트
        document.querySelectorAll('#inventoryTable thead th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sort.col === col) {
                    sort.asc = !sort.asc;
                } else {
                    sort.col = col;
                    sort.asc = true;
                }
                renderTable();
            });
        });

        // 윈도우 크기 변경 시 뷰 모드 및 레이아웃 자동 반영
        window.addEventListener('resize', () => {
            applyViewMode();
        });

        // ECOUNT ERP 표준 키보드 단축키
        window.addEventListener('keydown', (e) => {
            // F2: 신규 등록
            if (e.key === 'F2') {
                e.preventDefault();
                openNewModal();
                return;
            }

            // F8: 모달 내 저장
            if (e.key === 'F8') {
                e.preventDefault();
                const isModalOpen = modalEl && modalEl.classList.contains('show');
                if (isModalOpen) {
                    handleSaveProduct();
                }
                return;
            }

            // 방향키 행 이동 (그리드 포커스)
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const rows = document.querySelectorAll('#tableBody tr');
                if (rows.length === 0) return;
                const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
                if (isInput) return;

                e.preventDefault();
                if (e.key === 'ArrowDown') {
                    focusedRowIndex = Math.min(rows.length - 1, focusedRowIndex + 1);
                } else {
                    focusedRowIndex = Math.max(0, focusedRowIndex - 1);
                }

                rows.forEach((tr, idx) => {
                    tr.classList.toggle('focused-row', idx === focusedRowIndex);
                });
                if (rows[focusedRowIndex]) {
                    rows[focusedRowIndex].scrollIntoView({ block: 'nearest' });
                }
            }
        });

        // 데이터 로드
        fetchProducts();
        fetchMetrics();
    });
})();
