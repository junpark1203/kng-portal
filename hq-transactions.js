/**
 * 본사 매입 현황 — 입출고 내역 (HQ Transactions) ECOUNT ERP Engine
 * - ECOUNT ERP 고밀도 시트 그리드 및 14개 표준 컬럼
 * - 빠른 날짜 프리셋 (오늘/1주/당월/3개월/전체) & 스마트 다중 검색
 * - 입출고 전표 일괄 등록 모달 (다건 일괄 행 입력, 자동완성, 재고 연동)
 * - F2(신규 전표) / F8(저장) / Alt+A(행 추가) 단축키 시스템
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
    let transactions = [];
    let products = [];
    let filteredList = [];
    const selectedIds = new Set();
    let focusedRowIndex = -1;

    let typeFilter = 'all'; // 'all', 'IN', 'OUT'
    let startDate = '';
    let endDate = '';
    let sort = { col: 'txDate', asc: false };
    let searchTarget = 'all';
    let searchQuery = '';
    let subSearchQuery = '';
    let page = 1;
    let pageSize = 50;

    // 전표 모달 상태
    let voucherModal = null;
    let editModal = null;
    let voucherMode = 'IN'; // 'IN' or 'OUT'
    let voucherRowCounter = 0;

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

    function parseNumber(val) {
        if (!val) return 0;
        return parseInt(String(val).replace(/[^0-9-]/g, ''), 10) || 0;
    }

    function formatMoneyInput(el) {
        const num = parseNumber(el.value);
        el.value = fmtNum(num);
    }

    // ==========================================
    // API Data Fetching
    // ==========================================
    async function fetchTransactions() {
        try {
            let url = API_BASE + '/transactions';
            const params = [];
            if (typeFilter !== 'all') params.push('type=' + typeFilter);
            if (startDate) params.push('startDate=' + startDate);
            if (endDate) params.push('endDate=' + endDate);
            if (params.length) url += '?' + params.join('&');

            const res = await authFetch(url);
            if (!res.ok) throw new Error('서버 통신 실패 (' + res.status + ')');
            transactions = await res.json();
            renderTable();
            initGridResizer();
        } catch (e) {
            showToast('입출고 내역 로딩 실패: ' + e.message, 'error');
            $('tableBody').innerHTML = `<tr><td colspan="14" class="text-center py-5 text-danger"><i class='bx bx-error-circle'></i> 내역을 불러오지 못했습니다 (${escHtml(e.message)})</td></tr>`;
        }
    }

    async function fetchProducts() {
        try {
            const res = await authFetch(API_BASE + '/products');
            if (res.ok) products = await res.json();
        } catch (e) {
            console.error('Failed to load products master', e);
        }
    }

    // ==========================================
    // 날짜 프리셋 제어
    // ==========================================
    function setDatePreset(preset) {
        document.querySelectorAll('.erp-date-presets .erp-preset-btn').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.trim() === {
                today: '오늘',
                week: '1주일',
                month: '당월',
                '3months': '3개월',
                all: '전체'
            }[preset]);
        });

        const today = new Date();
        const formatDate = d => d.toISOString().split('T')[0];

        if (preset === 'today') {
            startDate = formatDate(today);
            endDate = formatDate(today);
        } else if (preset === 'week') {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            startDate = formatDate(d);
            endDate = formatDate(today);
        } else if (preset === 'month') {
            const d = new Date(today.getFullYear(), today.getMonth(), 1);
            startDate = formatDate(d);
            endDate = formatDate(today);
        } else if (preset === '3months') {
            const d = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            startDate = formatDate(d);
            endDate = formatDate(today);
        } else if (preset === 'all') {
            startDate = '';
            endDate = '';
        }

        $('startDate').value = startDate;
        $('endDate').value = endDate;
        page = 1;
        fetchTransactions();
    }

    // ==========================================
    // 필터링 & 검색 엔진
    // ==========================================
    function filterTransactions() {
        let list = transactions.slice();

        // 1) 스마트 다중 검색 (공백 구분 AND)
        if (searchQuery) {
            const tokens = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
            list = list.filter(t => {
                let targetText = '';
                const typeLabel = t.type === 'IN' ? '매입 입고' : '출고 매출';
                if (searchTarget === 'all') {
                    targetText = [t.txDate, typeLabel, t.supplier, t.brand, t.productName, t.color, t.size, t.remarks].join(' ').toLowerCase();
                } else if (searchTarget === 'supplier') {
                    targetText = (t.supplier || '').toLowerCase();
                } else if (searchTarget === 'brand') {
                    targetText = (t.brand || '').toLowerCase();
                } else if (searchTarget === 'productName') {
                    targetText = [t.productName, t.color, t.size].join(' ').toLowerCase();
                } else if (searchTarget === 'remarks') {
                    targetText = (t.remarks || '').toLowerCase();
                }
                return tokens.every(tok => targetText.includes(tok));
            });
        }

        // 2) 결과 내 2차 재검색 (Sub-Search)
        if (subSearchQuery) {
            const sq = subSearchQuery.toLowerCase();
            list = list.filter(t => {
                const combined = [t.txDate, t.type === 'IN' ? '매입' : '출고', t.supplier, t.brand, t.productName, t.color, t.size, t.qty, t.price, t.remarks].join(' ').toLowerCase();
                return combined.includes(sq);
            });
        }

        // 3) 정렬 (Sorting)
        list.sort((a, b) => {
            const qtyA = Number(a.qty) || 0, qtyB = Number(b.qty) || 0;
            const priceA = Number(a.price) || 0, priceB = Number(b.price) || 0;
            const totalA = qtyA * priceA, totalB = qtyB * priceB;
            const baseA = Number(a.basePrice) || 0, baseB = Number(b.basePrice) || 0;
            const frA = Number(a.freight) || 0, frB = Number(b.freight) || 0;

            let va = a[sort.col] ?? '', vb = b[sort.col] ?? '';

            if (sort.col === 'txDate') {
                va = new Date(a.txDate || 0).getTime();
                vb = new Date(b.txDate || 0).getTime();
            } else if (sort.col === 'qty') { va = qtyA; vb = qtyB; }
            else if (sort.col === 'price') { va = priceA; vb = priceB; }
            else if (sort.col === 'totalAmount') { va = totalA; vb = totalB; }
            else if (sort.col === 'basePrice') { va = baseA; vb = baseB; }
            else if (sort.col === 'freight') { va = frA; vb = frB; }
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
    // 테이블 및 요약 렌더링
    // ==========================================
    function renderTable() {
        const list = filterTransactions();
        const tbody = $('tableBody');
        const tfoot = $('tableFoot');

        // 통계 연산
        const totalCount = list.length;
        const inItems = list.filter(t => t.type === 'IN');
        const outItems = list.filter(t => t.type === 'OUT');

        const inQty = inItems.reduce((s, t) => s + (Number(t.qty) || 0), 0);
        const outQty = outItems.reduce((s, t) => s + (Number(t.qty) || 0), 0);
        const inAmount = inItems.reduce((s, t) => s + ((Number(t.qty) || 0) * (Number(t.price) || 0)), 0);
        const outAmount = outItems.reduce((s, t) => s + ((Number(t.qty) || 0) * (Number(t.price) || 0)), 0);

        // 상단 배지 업데이트
        $('statTotalCountBadge').textContent = `전체 ${fmtNum(totalCount)}건`;
        $('statInBadge').textContent = `매입: ${fmtNum(inItems.length)}건 (${fmtWon(inAmount)})`;
        $('statOutBadge').textContent = `출고: ${fmtNum(outItems.length)}건 (${fmtWon(outAmount)})`;
        $('statNetQtyBadge').textContent = `순 수량: ${fmtNum(inQty - outQty)}개`;

        // 탭 카운트 배지 갱신
        $('tabCountAll').textContent = totalCount;
        $('tabCountIn').textContent = inItems.length;
        $('tabCountOut').textContent = outItems.length;

        // 정렬 헤더 UI 갱신
        document.querySelectorAll('#txTable thead th.sortable').forEach(th => {
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

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center py-5 text-muted"><i class='bx bx-search-alt'></i> 조건에 일치하는 거래 내역이 없습니다.</td></tr>`;
            tfoot.classList.add('d-none');
            renderPagination(0);
            updateSelectedUI();
            return;
        }

        tfoot.classList.remove('d-none');

        // 페이지 슬라이스
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
        pagedList.forEach((t, idx) => {
            const rowNo = startIdx + idx + 1;
            const isChecked = selectedIds.has(t.id);
            const isFocused = focusedRowIndex === idx;

            const isIN = t.type === 'IN';
            const badgeClass = isIN ? 'tx-badge in' : 'tx-badge out';
            const typeLabel = isIN ? '매입' : '출고';

            const qty = Number(t.qty) || 0;
            const price = Number(t.price) || 0;
            const totalAmount = qty * price;
            const basePrice = Number(t.basePrice) || 0;
            const freight = Number(t.freight) || 0;

            const specDetails = [t.color, t.size].filter(Boolean).join(' / ');
            const specDisplay = specDetails ? ` <span class="text-muted" style="font-size:10.5px;">(${escHtml(specDetails)})</span>` : '';

            html += `
                <tr class="${isChecked ? 'checked-row' : ''} ${isFocused ? 'focused-row' : ''}" onclick="app.onRowClick(event, '${escHtml(t.id)}', ${idx})">
                    <td class="col-check no-print" onclick="event.stopPropagation()">
                        <input type="checkbox" class="row-check" value="${escHtml(t.id)}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectOne('${escHtml(t.id)}', this.checked)">
                    </td>
                    <td class="col-no">${rowNo}</td>
                    <td class="text-center">${escHtml(t.txDate || '-')}</td>
                    <td class="text-center"><span class="${badgeClass}">${typeLabel}</span></td>
                    <td class="text-center" title="${escHtml(t.supplier || '-')}">${escHtml(t.supplier || '-')}</td>
                    <td class="text-start ps-2" title="${escHtml(t.brand || '-')}">${escHtml(t.brand || '-')}</td>
                    <td class="text-start ps-2 fw-semibold" title="${escHtml(t.productName || '-')}">
                        ${escHtml(t.productName || '-')}${specDisplay}
                    </td>
                    <td class="col-num pe-2 fw-bold ${isIN ? 'text-primary' : 'text-danger'}">${fmtNum(qty)}</td>
                    <td class="col-num pe-2">${isIN && basePrice > 0 ? fmtWon(basePrice) : '-'}</td>
                    <td class="col-num pe-2">${isIN && freight > 0 ? fmtWon(freight) : '-'}</td>
                    <td class="col-num pe-2">${price > 0 ? fmtWon(price) : '-'}</td>
                    <td class="col-num pe-2 fw-semibold" style="color: ${isIN ? '#1d4ed8' : '#c2410c'};">${fmtWon(totalAmount)}</td>
                    <td class="text-start ps-2 text-muted" title="${escHtml(t.remarks || '')}">${escHtml(t.remarks || '-')}</td>
                    <td class="col-action text-center no-print" onclick="event.stopPropagation()">
                        <button type="button" class="btn-erp" style="height: 20px; padding: 0 5px; font-size: 10.5px;" onclick="app.openEditModal('${escHtml(t.id)}')">
                            <i class='bx bx-edit-alt'></i> 수정
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

        // 푸터 총액 반영
        const totalQty = list.reduce((s, t) => s + (Number(t.qty) || 0), 0);
        const totalAmountSum = list.reduce((s, t) => s + ((Number(t.qty) || 0) * (Number(t.price) || 0)), 0);

        $('footSummaryText').textContent = `총 ${fmtNum(totalCount)}건 (매입 ${fmtNum(inItems.length)}건 / 출고 ${fmtNum(outItems.length)}건)`;
        $('footTotalQty').textContent = fmtNum(totalQty);
        $('footTotalAmount').textContent = fmtWon(totalAmountSum);

        renderPagination(list.length);
        updateSelectedUI();
        initGridResizer();
    }

    // ==========================================
    // 페이지네이션 렌더링
    // ==========================================
    function renderPagination(totalCount) {
        const bottomPageInfo = $('bottomPageInfo');
        const paginationContainer = $('pagination');
        const topPaginationContainer = $('topPagination');

        if (pageSize === 'all') {
            if (bottomPageInfo) bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 전체 표시`;
            const allHtml = `<button type="button" class="erp-page-btn active" disabled>전체</button>`;
            if (paginationContainer) paginationContainer.innerHTML = allHtml;
            if (topPaginationContainer) topPaginationContainer.innerHTML = allHtml;
            return;
        }

        if (totalCount === 0) {
            if (bottomPageInfo) bottomPageInfo.textContent = `총 0건 조회됨`;
            const zeroHtml = `
                <button type="button" class="erp-page-btn" disabled>‹</button>
                <button type="button" class="erp-page-btn active" disabled>1</button>
                <button type="button" class="erp-page-btn" disabled>›</button>
            `;
            if (paginationContainer) paginationContainer.innerHTML = zeroHtml;
            if (topPaginationContainer) topPaginationContainer.innerHTML = zeroHtml;
            return;
        }

        const ps = parseInt(pageSize, 10);
        const totalPages = Math.ceil(totalCount / ps) || 1;
        const startItem = (page - 1) * ps + 1;
        const endItem = Math.min(page * ps, totalCount);

        if (bottomPageInfo) {
            bottomPageInfo.textContent = `총 ${fmtNum(totalCount)}건 중 ${fmtNum(startItem)}~${fmtNum(endItem)} (${page}/${totalPages} 페이지)`;
        }

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
        if (topPaginationContainer) topPaginationContainer.innerHTML = html;
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
    // 전표 일괄 등록 모달 로직 (ECOUNT ERP Style)
    // ==========================================
    function openVoucherModal() {
        $('vTxDate').value = new Date().toISOString().split('T')[0];
        setVoucherMode('IN');
        clearVoucherRows();
        addVoucherRow();
        voucherModal.show();
    }

    function setVoucherMode(mode) {
        voucherMode = mode;
        const header = $('voucherModalHeader');
        const btnIn = $('btnModeIn');
        const btnOut = $('btnModeOut');
        const inVat = $('inVatOptions');
        const outVat = $('outVatOptions');
        const lblSupplier = $('lblVSupplier');
        const thVPrice = $('thVPrice');

        if (mode === 'IN') {
            header.classList.remove('out-mode');
            btnIn.className = 'voucher-mode-btn active mode-in';
            btnOut.className = 'voucher-mode-btn';
            inVat.classList.remove('d-none');
            outVat.classList.add('d-none');
            lblSupplier.innerHTML = '공급사 <span class="text-danger">*</span>';
            $('vSupplier').placeholder = '공급사 입력 (예: 최가유통)';
            $('vSupplier').value = '최가유통';
            thVPrice.textContent = '단가(매입가)';
            document.querySelectorAll('.col-price-in').forEach(el => el.classList.remove('d-none'));
        } else {
            header.classList.add('out-mode');
            btnIn.className = 'voucher-mode-btn';
            btnOut.className = 'voucher-mode-btn active mode-out';
            inVat.classList.add('d-none');
            outVat.classList.remove('d-none');
            lblSupplier.innerHTML = '출고처 <span class="text-danger">*</span>';
            $('vSupplier').placeholder = '출고처 / 거래처 입력';
            thVPrice.textContent = '단가(매출가)';
            document.querySelectorAll('.col-price-in').forEach(el => el.classList.add('d-none'));
        }

        recalcAllVoucherRows();
    }

    function clearVoucherRows() {
        $('voucherTbody').innerHTML = '';
        voucherRowCounter = 0;
        updateVoucherSummary();
    }

    function addVoucherRow() {
        voucherRowCounter++;
        const rowId = 'vRow_' + voucherRowCounter;
        const tbody = $('voucherTbody');

        const tr = document.createElement('tr');
        tr.id = rowId;
        tr.className = 'voucher-row';

        const isOut = voucherMode === 'OUT';

        tr.innerHTML = `
            <td class="text-center col-no">${tbody.children.length + 1}</td>
            <td style="position: relative;">
                <input type="text" class="form-control ps-2 v-item-name" placeholder="상품명 또는 브랜드 검색..." autocomplete="off" oninput="app.onVoucherItemSearch(this, '${rowId}')" onfocus="app.onVoucherItemSearch(this, '${rowId}')">
                <div class="erp-autocomplete-menu d-none" id="${rowId}_ac"></div>
            </td>
            <td><input type="text" class="form-control ps-2 v-item-brand" placeholder="브랜드"></td>
            <td><input type="text" class="form-control text-center v-item-color" placeholder="컬러"></td>
            <td><input type="text" class="form-control text-center v-item-size" placeholder="사이즈"></td>
            <td><input type="number" class="form-control col-num pe-2 fw-bold text-primary v-item-qty" min="1" value="1" oninput="app.recalcVoucherRow('${rowId}')"></td>
            <td class="col-price-in ${isOut ? 'd-none' : ''}">
                <input type="text" class="form-control col-num pe-2 v-item-base" placeholder="0" oninput="app.formatMoneyInput(this); app.recalcVoucherRow('${rowId}')">
            </td>
            <td class="col-price-in ${isOut ? 'd-none' : ''}">
                <input type="text" class="form-control col-num pe-2 v-item-freight" placeholder="0" oninput="app.formatMoneyInput(this); app.recalcVoucherRow('${rowId}')">
            </td>
            <td>
                <input type="text" class="form-control col-num pe-2 fw-semibold v-item-price" placeholder="0" oninput="app.formatMoneyInput(this); app.recalcVoucherRow('${rowId}', true)" ${!isOut ? 'readonly style="background:#f8fafc !important;"' : ''}>
            </td>
            <td>
                <input type="text" class="form-control col-num pe-2 fw-bold text-success v-item-total" readonly style="background:#f8fafc !important;" value="₩0">
            </td>
            <td class="text-center">
                <button type="button" class="btn btn-link text-danger p-0" onclick="app.removeVoucherRow('${rowId}')" title="행 삭제">
                    <i class='bx bx-x fs-5'></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
        recalcVoucherRow(rowId);
        reindexVoucherRows();

        const nameInput = tr.querySelector('.v-item-name');
        if (nameInput) nameInput.focus();
    }

    function removeVoucherRow(rowId) {
        const row = $(rowId);
        if (row) {
            row.remove();
            reindexVoucherRows();
            updateVoucherSummary();
        }
    }

    function reindexVoucherRows() {
        document.querySelectorAll('#voucherTbody tr').forEach((tr, i) => {
            const noCell = tr.querySelector('.col-no');
            if (noCell) noCell.textContent = i + 1;
        });
    }

    function onVoucherItemSearch(inputEl, rowId) {
        const query = (inputEl.value || '').trim().toLowerCase();
        const acMenu = $(rowId + '_ac');
        if (!acMenu) return;

        if (!query) {
            acMenu.classList.add('d-none');
            return;
        }

        const matches = products.filter(p => {
            const str = [p.brand, p.name, p.color, p.size].join(' ').toLowerCase();
            return str.includes(query);
        }).slice(0, 15);

        if (matches.length === 0) {
            acMenu.classList.add('d-none');
            return;
        }

        let html = '';
        matches.forEach(p => {
            const stockBadge = p.stock === 0 ? '<span class="badge bg-danger">품절</span>' : `<span class="badge bg-success">${p.stock}개</span>`;
            html += `
                <div class="erp-autocomplete-item" onclick="app.selectVoucherProduct('${rowId}', '${escHtml(p.id)}')">
                    <div>
                        <strong>[${escHtml(p.brand)}] ${escHtml(p.name)}</strong>
                        <span class="text-muted small">(${escHtml(p.color || '-')}/${escHtml(p.size || '-')})</span>
                    </div>
                    <div>
                        <span class="text-muted me-2 small">매입 ₩${fmtNum(p.buyPrice)} / 판매 ₩${fmtNum(p.sellPrice)}</span>
                        ${stockBadge}
                    </div>
                </div>
            `;
        });

        acMenu.innerHTML = html;
        acMenu.classList.remove('d-none');
    }

    function selectVoucherProduct(rowId, prodId) {
        const p = products.find(item => item.id === prodId);
        const row = $(rowId);
        const acMenu = $(rowId + '_ac');
        if (acMenu) acMenu.classList.add('d-none');
        if (!p || !row) return;

        row.dataset.productId = p.id;
        row.dataset.stock = p.stock ?? 0;
        row.dataset.buyPrice = p.buyPrice ?? 0;

        row.querySelector('.v-item-name').value = p.name;
        row.querySelector('.v-item-brand').value = p.brand;
        row.querySelector('.v-item-color').value = p.color || '';
        row.querySelector('.v-item-size').value = p.size || '';

        if (voucherMode === 'IN') {
            row.querySelector('.v-item-base').value = fmtNum(p.buyPrice || 0);
            row.querySelector('.v-item-freight').value = '0';
        } else {
            // OUT mode: default price to sellPrice or discountPrice
            const outP = p.discountPrice > 0 ? p.discountPrice : (p.sellPrice || 0);
            row.querySelector('.v-item-price').value = fmtNum(outP);
        }

        recalcVoucherRow(rowId);
        const qtyEl = row.querySelector('.v-item-qty');
        if (qtyEl) { qtyEl.focus(); qtyEl.select(); }
    }

    function recalcVoucherRow(rowId, priceManualEdited = false) {
        const row = $(rowId);
        if (!row) return;

        const qty = parseNumber(row.querySelector('.v-item-qty')?.value) || 0;
        let finalPrice = 0;

        if (voucherMode === 'IN') {
            const base = parseNumber(row.querySelector('.v-item-base')?.value) || 0;
            const freight = parseNumber(row.querySelector('.v-item-freight')?.value) || 0;
            const chkBase = $('chkBaseVat').checked;
            const chkFreight = $('chkFreightVat').checked;

            const pureBase = chkBase ? base : Math.round(base / 1.1);
            const pureFreight = chkFreight ? freight : Math.round(freight / 1.1);

            finalPrice = pureBase + pureFreight;
            row.querySelector('.v-item-price').value = fmtNum(finalPrice);
        } else {
            let outPrice = parseNumber(row.querySelector('.v-item-price')?.value) || 0;
            const chkOut = $('chkOutVat').checked;
            if (!chkOut) {
                // VAT 포함 입력인 경우
                finalPrice = outPrice;
            } else {
                finalPrice = Math.round(outPrice / 1.1);
            }
        }

        const totalAmount = qty * finalPrice;
        row.querySelector('.v-item-total').value = fmtWon(totalAmount);

        updateVoucherSummary();
    }

    function recalcAllVoucherRows() {
        document.querySelectorAll('#voucherTbody tr').forEach(tr => {
            recalcVoucherRow(tr.id);
        });
    }

    function updateVoucherSummary() {
        const rows = document.querySelectorAll('#voucherTbody tr');
        let totalQty = 0;
        let totalAmt = 0;

        rows.forEach(tr => {
            const qty = parseNumber(tr.querySelector('.v-item-qty')?.value) || 0;
            const price = parseNumber(tr.querySelector('.v-item-price')?.value) || 0;
            totalQty += qty;
            totalAmt += (qty * price);
        });

        $('vSummaryCount').textContent = rows.length;
        $('vSummaryQty').textContent = fmtNum(totalQty);
        $('vSummaryAmount').textContent = fmtWon(totalAmt);
    }

    async function submitVoucher() {
        const btn = $('btnSubmitVoucher');
        const txDate = $('vTxDate').value;
        const supplier = $('vSupplier').value.trim();
        const commonRemarks = $('vRemarks').value.trim();

        if (!txDate) {
            showToast('전표 일자를 입력해 주세요.', 'warning');
            $('vTxDate').focus();
            return;
        }
        if (!supplier) {
            showToast(voucherMode === 'IN' ? '공급사를 입력해 주세요.' : '출고처를 입력해 주세요.', 'warning');
            $('vSupplier').focus();
            return;
        }

        const rows = document.querySelectorAll('#voucherTbody tr');
        if (rows.length === 0) {
            showToast('입력된 품목 행이 없습니다.', 'warning');
            return;
        }

        const items = [];
        for (const row of rows) {
            const brand = row.querySelector('.v-item-brand')?.value.trim();
            const name = row.querySelector('.v-item-name')?.value.trim();
            const color = row.querySelector('.v-item-color')?.value.trim();
            const size = row.querySelector('.v-item-size')?.value.trim();
            const qty = parseNumber(row.querySelector('.v-item-qty')?.value) || 0;
            const price = parseNumber(row.querySelector('.v-item-price')?.value) || 0;
            const basePrice = parseNumber(row.querySelector('.v-item-base')?.value) || 0;
            const freight = parseNumber(row.querySelector('.v-item-freight')?.value) || 0;

            if (!name || !qty || !price) continue;

            if (voucherMode === 'OUT') {
                const prodId = row.dataset.productId;
                const stock = parseInt(row.dataset.stock, 10) || 0;
                if (!prodId) {
                    showToast(`[${name}] 출고 품목은 기존 등록된 상품 중에서만 선택 가능합니다.`, 'warning');
                    return;
                }
                if (qty > stock) {
                    showToast(`재고 부족 오류: [${name}] (현재 재고: ${stock}개, 요청 수량: ${qty}개)`, 'error');
                    return;
                }
                const buyPrice = parseInt(row.dataset.buyPrice, 10) || 0;
                items.push({
                    type: 'OUT',
                    txDate,
                    supplier,
                    brand,
                    productName: name,
                    color,
                    size,
                    qty,
                    price,
                    basePrice: 0,
                    freight: 0,
                    remarks: commonRemarks,
                    productId: prodId,
                    buyPrice
                });
            } else {
                // IN mode
                const itemData = {
                    type: 'IN',
                    txDate,
                    supplier,
                    brand,
                    productName: name,
                    color,
                    size,
                    qty,
                    price,
                    basePrice,
                    freight,
                    remarks: commonRemarks
                };

                // Match or create product in master
                const match = products.find(p => p.brand === brand && p.name === name && p.color === color && p.size === size);
                if (match) {
                    itemData.productId = match.id;
                    itemData.buyPrice = match.buyPrice;
                    items.push(itemData);
                } else {
                    try {
                        const pRes = await authFetch(API_BASE + '/products', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                supplier, brand, name, color, size,
                                stock: 0, buyPrice: price, sellPrice: 0, discountPrice: 0
                            })
                        });
                        const pResult = await pRes.json();
                        itemData.productId = pResult.id;
                        itemData.buyPrice = price;
                        products.push({
                            id: pResult.id,
                            supplier, brand, name, color, size,
                            stock: 0, buyPrice: price, sellPrice: 0, discountPrice: 0
                        });
                        items.push(itemData);
                    } catch (err) {
                        showToast(`상품 마스터 등록 실패: ${name}`, 'error');
                        return;
                    }
                }
            }
        }

        if (items.length === 0) {
            showToast('유효한 품목 데이터가 없습니다. (상품명, 수량, 단가 필수)', 'warning');
            return;
        }

        btn.disabled = true;
        try {
            const res = await authFetch(API_BASE + '/transactions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || '등록 실패');
            }

            showToast(`${items.length}건 ${voucherMode === 'IN' ? '매입(입고)' : '출고'} 전표 등록 완료!`, 'success');
            voucherModal.hide();
            await fetchProducts();
            await fetchTransactions();
        } catch (e) {
            showToast('등록 중 오류 발생: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // ==========================================
    // 단일 내역 수정 모달 로직
    // ==========================================
    function openEditModal(id) {
        const t = transactions.find(x => x.id === id);
        if (!t) {
            showToast('거래 내역을 찾을 수 없습니다.', 'warning');
            return;
        }

        $('editId').value = t.id;
        $('eTxDate').value = t.txDate;
        $('eTxType').value = t.type === 'IN' ? '매입 (입고)' : '출고';
        $('eSupplier').value = t.supplier || '';
        $('eBrand').value = t.brand || '';
        $('eName').value = t.productName || '';
        $('eColor').value = t.color || '';
        $('eSize').value = t.size || '';
        $('eQty').value = t.qty;
        $('ePrice').value = fmtNum(t.price || 0);
        $('eBasePrice').value = fmtNum(t.basePrice || 0);
        $('eFreight').value = fmtNum(t.freight || 0);
        $('eRemarks').value = t.remarks || '';

        const rowInDetails = $('eRowInDetails');
        if (t.type === 'OUT') {
            rowInDetails.classList.add('d-none');
            $('ePrice').readOnly = false;
            $('ePrice').style.background = '#ffffff';
        } else {
            rowInDetails.classList.remove('d-none');
            $('ePrice').readOnly = true;
            $('ePrice').style.background = '#f8fafc';
        }

        recalcEditModal();
        editModal.show();
    }

    function calcPriceFromBaseAndFreight() {
        const base = parseNumber($('eBasePrice').value);
        const freight = parseNumber($('eFreight').value);
        $('ePrice').value = fmtNum(base + freight);
        recalcEditModal();
    }

    function recalcEditModal() {
        const qty = parseNumber($('eQty').value) || 0;
        const price = parseNumber($('ePrice').value) || 0;
        $('eTotalAmount').value = fmtWon(qty * price);
    }

    async function handleSaveEdit(e) {
        if (e) e.preventDefault();
        const id = $('editId').value;
        const orig = transactions.find(x => x.id === id);
        if (!orig) return;

        const payload = {
            type: orig.type,
            txDate: $('eTxDate').value,
            productId: orig.productId,
            supplier: $('eSupplier').value.trim(),
            brand: $('eBrand').value.trim(),
            productName: $('eName').value.trim(),
            color: $('eColor').value.trim(),
            size: $('eSize').value.trim(),
            qty: parseNumber($('eQty').value),
            price: parseNumber($('ePrice').value),
            buyPrice: orig.buyPrice || 0,
            basePrice: orig.type === 'IN' ? parseNumber($('eBasePrice').value) : orig.basePrice || 0,
            freight: orig.type === 'IN' ? parseNumber($('eFreight').value) : orig.freight || 0,
            remarks: $('eRemarks').value.trim()
        };

        try {
            const res = await authFetch(API_BASE + '/transactions/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('수정 실패');
            showToast('거래 내역이 성공적으로 수정되었습니다.', 'success');
            editModal.hide();
            await fetchTransactions();
        } catch (err) {
            showToast('수정 중 오류 발생: ' + err.message, 'error');
        }
    }

    // ==========================================
    // 삭제 처리
    // ==========================================
    async function handleDelete() {
        if (selectedIds.size === 0) {
            showToast('삭제할 내역을 체크박스로 선택해 주세요.', 'warning');
            return;
        }

        const count = selectedIds.size;
        if (!confirm(`선택한 ${count}건의 거래 내역을 삭제하시겠습니까?\n(삭제 시 연동된 재고 수량이 복원/감소됩니다)`)) return;

        const ids = Array.from(selectedIds);
        try {
            const res = await authFetch(API_BASE + '/transactions/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });

            if (!res.ok) throw new Error('삭제 처리 실패');
            showToast(`${count}건의 내역이 삭제되었습니다.`, 'success');
            selectedIds.clear();
            await fetchTransactions();
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

        const list = filterTransactions();
        if (list.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }

        const excelData = list.map((t, idx) => {
            const isIN = t.type === 'IN';
            const qty = Number(t.qty) || 0;
            const price = Number(t.price) || 0;

            return {
                'No.': idx + 1,
                '일시': t.txDate || '',
                '구분': isIN ? '매입' : '출고',
                '공급사/출고처': t.supplier || '',
                '브랜드': t.brand || '',
                '상품명': t.productName || '',
                '컬러': t.color || '',
                '사이즈': t.size || '',
                '수량': qty,
                '상품가': isIN ? Number(t.basePrice) || 0 : '',
                '운임': isIN ? Number(t.freight) || 0 : '',
                '단가(공급가)': price,
                '총금액(공급가)': qty * price,
                '비고': t.remarks || ''
            };
        });

        const totalQty = list.reduce((s, t) => s + (Number(t.qty) || 0), 0);
        const totalAmount = list.reduce((s, t) => s + ((Number(t.qty) || 0) * (Number(t.price) || 0)), 0);

        excelData.push({
            'No.': '합계',
            '일시': '',
            '구분': '',
            '공급사/출고처': '',
            '브랜드': '',
            '상품명': `총 ${list.length}건`,
            '컬러': '',
            '사이즈': '',
            '수량': totalQty,
            '상품가': '',
            '운임': '',
            '단가(공급가)': '',
            '총금액(공급가)': totalAmount,
            '비고': ''
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '입출고내역');

        const now = new Date();
        const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
        XLSX.writeFile(wb, `본사_입출고거래내역_${ymd}.xlsx`);
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

        $('printMetaInfo').textContent = `출력일시: ${nowStr} | 조회 기간: [${startDate || '처음'} ~ ${endDate || '현재'}] | 구분: [${typeFilter}] | 검색어: [${searchQuery || '전체'}]`;
        window.print();
    }

    // ==========================================
    // 열 너비 조절기 초기화
    // ==========================================
    function initGridResizer() {
        if (window.ErpGridResizer && typeof window.ErpGridResizer.init === 'function') {
            setTimeout(() => {
                window.ErpGridResizer.init('txTable', {
                    storageKey: 'kng_hq_transactions_grid_widths_v1'
                });
            }, 60);
        }
    }

    // ==========================================
    // 공개 인터페이스 및 이벤트 바인딩
    // ==========================================
    const app = {
        setTypeFilter(type) {
            typeFilter = type;
            document.querySelectorAll('#typeTabGroup .erp-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.type === type);
            });
            page = 1;
            fetchTransactions();
        },

        setDatePreset,

        onDateRangeChange() {
            startDate = $('startDate').value;
            endDate = $('endDate').value;
            document.querySelectorAll('.erp-date-presets .erp-preset-btn').forEach(btn => btn.classList.remove('active'));
            page = 1;
            fetchTransactions();
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
            setDatePreset('month');
            this.setTypeFilter('all');
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
            $('txGridWrapper').scrollTop = 0;
        },

        toggleSelectAll(checked) {
            const pageChecks = document.querySelectorAll('.row-check');
            pageChecks.forEach(c => {
                c.checked = checked;
                if (checked) selectedIds.add(c.value);
                else selectedIds.delete(c.value);
            });
            updateSelectedUI();
            document.querySelectorAll('#tableBody tr').forEach(tr => tr.classList.toggle('checked-row', checked));
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

        openVoucherModal,
        setVoucherMode,
        clearVoucherRows,
        addVoucherRow,
        removeVoucherRow,
        onVoucherItemSearch,
        selectVoucherProduct,
        recalcVoucherRow,
        recalcAllVoucherRows,
        submitVoucher,

        openEditModal,
        calcPriceFromBaseAndFreight,
        recalcEditModal,
        handleSaveEdit,

        addSelectedToQuoteCart() {
            if (selectedIds.size === 0) {
                showToast('견적서에 담을 내역을 먼저 체크박스로 선택해주세요.', 'warning');
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
                const tx = transactions.find(item => String(item.id) === String(id));
                if (!tx) return;

                const existing = cart.find(c => c.source_module === 'hq-transactions' && String(c.source_id) === String(tx.id));
                if (existing) {
                    existing.qty = (Number(existing.qty) || 1) + (Number(tx.qty) || 1);
                } else {
                    cart.push({
                        source_module: 'hq-transactions',
                        source_id: tx.id,
                        product_name: tx.product_name || tx.name || '',
                        spec: tx.spec || '',
                        color: tx.color || '',
                        unit: tx.unit || 'EA',
                        qty: Number(tx.qty) || 1,
                        cost_price: Number(tx.unit_price || 0),
                        unit_price: Number(tx.unit_price || 0),
                        image_url: tx.image_url || '',
                        remarks: tx.supplier ? `[거래처: ${tx.supplier}]` : ''
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

        handleDelete,
        exportExcel,
        printReport,
        formatMoneyInput
    };

    window.app = app;

    // DOM Ready
    document.addEventListener('DOMContentLoaded', () => {
        const vModalEl = $('voucherModal');
        if (vModalEl && window.bootstrap) voucherModal = new bootstrap.Modal(vModalEl, { keyboard: true });

        const eModalEl = $('editModal');
        if (eModalEl && window.bootstrap) editModal = new bootstrap.Modal(eModalEl, { keyboard: true });

        // 정렬 클릭
        document.querySelectorAll('#txTable thead th.sortable').forEach(th => {
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

        // 자동완성 닫기
        document.addEventListener('click', e => {
            if (!e.target.classList.contains('v-item-name') && !e.target.closest('.erp-autocomplete-menu')) {
                document.querySelectorAll('.erp-autocomplete-menu').forEach(el => el.classList.add('d-none'));
            }
        });

        // 단축키
        window.addEventListener('keydown', e => {
            // F2: 신규 전표 등록
            if (e.key === 'F2') {
                e.preventDefault();
                openVoucherModal();
                return;
            }

            // F8: 모달 저장
            if (e.key === 'F8') {
                e.preventDefault();
                if (vModalEl && vModalEl.classList.contains('show')) {
                    submitVoucher();
                    return;
                }
                if (eModalEl && eModalEl.classList.contains('show')) {
                    handleSaveEdit();
                    return;
                }
            }

            // Alt+A: 전표 내 행 추가
            if (e.altKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
                if (vModalEl && vModalEl.classList.contains('show')) {
                    e.preventDefault();
                    addVoucherRow();
                    return;
                }
            }

            // 방향키 행 이동
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const isModalOpen = (vModalEl && vModalEl.classList.contains('show')) || (eModalEl && eModalEl.classList.contains('show'));
                if (isModalOpen) return;

                const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
                if (isInput) return;

                const rows = document.querySelectorAll('#tableBody tr');
                if (rows.length === 0) return;

                e.preventDefault();
                if (e.key === 'ArrowDown') {
                    focusedRowIndex = Math.min(rows.length - 1, focusedRowIndex + 1);
                } else {
                    focusedRowIndex = Math.max(0, focusedRowIndex - 1);
                }

                rows.forEach((tr, idx) => tr.classList.toggle('focused-row', idx === focusedRowIndex));
                if (rows[focusedRowIndex]) rows[focusedRowIndex].scrollIntoView({ block: 'nearest' });
            }
        });

        // 기본 날짜: 당월 1일 ~ 오늘
        const today = new Date();
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        startDate = startOfMonth.toISOString().split('T')[0];
        endDate = today.toISOString().split('T')[0];
        $('startDate').value = startDate;
        $('endDate').value = endDate;

        // 초기 데이터 로딩
        fetchTransactions();
        fetchProducts();
    });
})();
