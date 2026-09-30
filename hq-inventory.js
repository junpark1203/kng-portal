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
        } catch (e) {
            showToast('상품 목록 로딩 실패: ' + e.message, 'error');
            $('tableBody').innerHTML = `<tr><td colspan="14" class="text-center py-5 text-danger"><i class='bx bx-error-circle'></i> 데이터를 불러오지 못했습니다 (${escHtml(e.message)})</td></tr>`;
        }
    }

    async function fetchMetrics() {
        try {
            const res = await authFetch(API_BASE + '/metrics');
            if (!res.ok) return;
            metrics = await res.json();
            $('kpiRevenueBadge').textContent = '누적 매출: ' + fmtWon(metrics.totalRevenue || 0);
            $('kpiCostBadge').textContent = '누적 매입: ' + fmtWon(metrics.totalCost || 0);
        } catch (e) { /* silent */ }
    }

    // ==========================================
    // 공급사 탭 생성 (동적 카운트)
    // ==========================================
    function buildSupplierTabs() {
        const suppliersMap = {};
        products.forEach(p => {
            const s = (p.supplier || '최가유통').trim();
            suppliersMap[s] = (suppliersMap[s] || 0) + 1;
        });

        const tabGroup = $('supplierTabGroup');
        if (!tabGroup) return;

        let html = `
            <button type="button" class="erp-tab-btn ${supplierFilter === '' ? 'active' : ''}" data-supplier="" onclick="app.setSupplierFilter('')">
                전체 <span class="erp-tab-badge" id="tabCountAll">${products.length}</span>
            </button>
        `;

        const sortedSuppliers = Object.keys(suppliersMap).sort();
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

        $('skuCountBadge').textContent = `관리 ${fmtNum(totalItemsCount)} SKU`;
        $('totalQtyBadge').textContent = `총 재고: ${fmtNum(totalStockQty)}개`;
        $('totalStockValueBadge').textContent = `재고원가: ${fmtWon(totalStockVal)}`;

        // 정렬 헤더 UI 갱신
        document.querySelectorAll('#inventoryTable thead th.sortable').forEach(th => {
            const col = th.dataset.sort;
            const icon = th.querySelector('.sort-icon');
            if (sort.col === col) {
                th.classList.add('sorted');
                icon.className = `bx bx-sort-${sort.asc ? 'up' : 'down'} sort-icon text-primary`;
            } else {
                th.classList.remove('sorted');
                icon.className = 'bx bx-sort sort-icon';
            }
        });

        // 데이터가 없는 경우
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center py-5 text-muted"><i class='bx bx-search-alt'></i> 조건에 일치하는 상품 데이터가 없습니다.</td></tr>`;
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
                marginRate = Math.round(((sellPrice - buyPrice) / sellPrice) * 100);
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

        renderPagination(list.length);
        updateSelectedUI();
    }

    // ==========================================
    // 페이지네이션 렌더링
    // ==========================================
    function renderPagination(totalCount) {
        const bottomPageInfo = $('bottomPageInfo');
        const paginationContainer = $('pagination');

        if (pageSize === 'all' || totalCount === 0) {
            bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 전체 표시`;
            paginationContainer.innerHTML = '';
            return;
        }

        const ps = parseInt(pageSize, 10);
        const totalPages = Math.ceil(totalCount / ps) || 1;
        const startItem = (page - 1) * ps + 1;
        const endItem = Math.min(page * ps, totalCount);

        bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 중 ${fmtNum(startItem)}~${fmtNum(endItem)}`;

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
        paginationContainer.innerHTML = html;
    }

    // ==========================================
    // 선택 및 체크박스 제어
    // ==========================================
    function updateSelectedUI() {
        const count = selectedIds.size;
        $('selectedCount').textContent = count;
        $('bottomSelectedCount').textContent = count;

        const selectAll = $('selectAll');
        if (selectAll) {
            const pageChecks = document.querySelectorAll('.row-check');
            if (pageChecks.length > 0) {
                const allChecked = Array.from(pageChecks).every(c => c.checked);
                const someChecked = Array.from(pageChecks).some(c => c.checked);
                selectAll.checked = allChecked;
                selectAll.indeterminate = someChecked && !allChecked;
            } else {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            }
        }
    }

    // ==========================================
    // 모달 및 CRUD 제어
    // ==========================================
    function openNewModal() {
        $('editId').value = '';
        $('modalModeTitle').textContent = '본사 신규 상품 등록';
        $('mSupplier').value = '최가유통';
        $('mBrand').value = '';
        $('mName').value = '';
        $('mColor').value = '';
        $('mSize').value = '';
        $('mBuyPrice').value = '0';
        $('mSellPrice').value = '0';
        $('mDiscountPrice').value = '0';
        $('mStock').value = '0';

        calcModalMargin();
        productModal.show();
        setTimeout(() => $('mBrand').focus(), 300);
    }

    function openEditModal(id) {
        const p = products.find(item => item.id === id);
        if (!p) {
            showToast('상품 정보를 찾을 수 없습니다.', 'warning');
            return;
        }

        $('editId').value = p.id;
        $('modalModeTitle').textContent = `상품 정보 수정 (${p.name})`;
        $('mSupplier').value = p.supplier || '최가유통';
        $('mBrand').value = p.brand || '';
        $('mName').value = p.name || '';
        $('mColor').value = p.color || '';
        $('mSize').value = p.size || '';
        $('mBuyPrice').value = fmtNum(p.buyPrice || 0);
        $('mSellPrice').value = fmtNum(p.sellPrice || 0);
        $('mDiscountPrice').value = fmtNum(p.discountPrice || 0);
        $('mStock').value = p.stock ?? 0;

        calcModalMargin();
        productModal.show();
        setTimeout(() => $('mStock').focus(), 300);
    }

    function calcModalMargin() {
        const buy = parseNumber($('mBuyPrice').value);
        const sell = parseNumber($('mSellPrice').value);
        const stock = parseNumber($('mStock').value);

        const marginEl = $('modalExpectedMargin');
        if (sell > 0) {
            const marginRate = Math.round(((sell - buy) / sell) * 100);
            marginEl.textContent = `${marginRate}% (마진 ₩${fmtNum(sell - buy)})`;
            marginEl.className = marginRate >= 30 ? 'text-success fs-6' : (marginRate < 10 ? 'text-danger fs-6' : 'text-primary fs-6');
        } else {
            marginEl.textContent = '-';
            marginEl.className = 'text-muted fs-6';
        }

        $('modalExpectedStockValue').textContent = fmtWon(buy * stock);
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
        const supplier = $('mSupplier').value.trim() || '최가유통';
        const brand = $('mBrand').value.trim();
        const name = $('mName').value.trim();
        const color = $('mColor').value.trim();
        const size = $('mSize').value.trim();
        const buyPrice = parseNumber($('mBuyPrice').value);
        const sellPrice = parseNumber($('mSellPrice').value);
        const discountPrice = parseNumber($('mDiscountPrice').value);
        const stock = parseNumber($('mStock').value);

        if (!brand) {
            showToast('브랜드를 입력해 주세요.', 'warning');
            $('mBrand').focus();
            return;
        }
        if (!name) {
            showToast('상품명을 입력해 주세요.', 'warning');
            $('mName').focus();
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
        } catch (err) {
            showToast('삭제 중 오류: ' + err.message, 'error');
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
            const margin = sell > 0 ? Math.round(((sell - buy) / sell) * 100) : 0;
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
    // 이벤트 바인딩 & 공개 인터페이스
    // ==========================================
    const app = {
        setSupplierFilter(s) {
            supplierFilter = s;
            document.querySelectorAll('#supplierTabGroup .erp-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.supplier === s);
            });
            page = 1;
            renderTable();
        },

        setStockFilter(filter) {
            stockFilter = filter;
            document.querySelectorAll('.erp-stock-filters .erp-filter-chip').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.stock === filter);
            });
            page = 1;
            renderTable();
        },

        onSearchTargetChange() {
            searchTarget = $('searchTarget').value;
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
            this.search();
        },

        search() {
            searchQuery = $('searchInput').value.trim();
            page = 1;
            renderTable();
        },

        resetSearch() {
            $('searchTarget').value = 'all';
            searchTarget = 'all';
            $('searchInput').value = '';
            $('clearSearchBtn').classList.add('d-none');
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
        },

        toggleSelectAll(checked) {
            const pageChecks = document.querySelectorAll('.row-check');
            pageChecks.forEach(c => {
                c.checked = checked;
                if (checked) selectedIds.add(c.value);
                else selectedIds.delete(c.value);
            });
            updateSelectedUI();
            // 행 배경색 동기화
            document.querySelectorAll('#tableBody tr').forEach(tr => {
                tr.classList.toggle('checked-row', checked);
            });
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

        openNewModal,
        openEditModal,
        calcModalMargin,
        formatMoneyInput,
        clearZero,
        handleSaveProduct,
        handleDelete,
        exportExcel,
        printReport
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
