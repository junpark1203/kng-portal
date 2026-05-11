/**
 * 본사 매입 현황 — 실시간 재고 현황
 * REST API 기반 (Firebase 불필요)
 */
(function() {
    'use strict';

    // ==========================================
    // API 설정
    // ==========================================
    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    // ==========================================
    // State
    // ==========================================
    let products = [];
    let page = 1;
    const PER_PAGE = 20;
    let sort = { col: 'name', asc: true };
    let searchField = 'all';
    let searchQuery = '';

    // ==========================================
    // Utility
    // ==========================================
    const $ = id => document.getElementById(id);
    const fmtCurrency = n => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n);
    const escHtml = s => {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };

    function showToast(msg, type) {
        type = type || 'info';
        const c = $('toastContainer');
        if (!c) return;
        const icons = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = "<i class='bx " + (icons[type]||icons.info) + "'></i> <span>" + escHtml(msg) + "</span>";
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    // ==========================================
    // API Calls
    // ==========================================
    async function fetchProducts() {
        try {
            const res = await fetch(API_BASE + '/products');
            if (!res.ok) throw new Error('서버 오류');
            products = await res.json();
            renderTable();
        } catch(e) {
            showToast('상품 목록 로딩 실패: ' + e.message, 'error');
        }
    }

    async function fetchMetrics() {
        try {
            const res = await fetch(API_BASE + '/metrics');
            if (!res.ok) return;
            const m = await res.json();
            $('kpiRevenue').textContent = fmtCurrency(m.totalRevenue || 0);
            $('kpiCost').textContent = fmtCurrency(m.totalCost || 0);
        } catch(e) { /* silent */ }
    }

    // ==========================================
    // Table Render
    // ==========================================
    function renderTable() {
        const tbody = $('tableBody');
        tbody.innerHTML = '';

        let filtered = products;

        // Search
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p => {
                if (searchField === 'all') {
                    return (p.supplier||'').toLowerCase().includes(q) ||
                           (p.brand||'').toLowerCase().includes(q) ||
                           (p.name||'').toLowerCase().includes(q) ||
                           (p.color||'').toLowerCase().includes(q) ||
                           (p.size||'').toLowerCase().includes(q);
                }
                return ((p[searchField]||'') + '').toLowerCase().includes(q);
            });
        }

        // Sort
        filtered.sort((a, b) => {
            let va = a[sort.col] || '', vb = b[sort.col] || '';
            if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb+'').toLowerCase(); }
            if (va < vb) return sort.asc ? -1 : 1;
            if (va > vb) return sort.asc ? 1 : -1;
            return 0;
        });

        // KPI
        const totalStock = filtered.reduce((s, p) => s + (p.stock || 0), 0);
        $('kpiTotalStock').textContent = totalStock.toLocaleString();
        $('totalCount').textContent = filtered.length + '건';

        // Pagination
        const totalPages = Math.ceil(filtered.length / PER_PAGE);
        if (page > totalPages) page = Math.max(1, totalPages);
        const start = (page - 1) * PER_PAGE;
        const paged = filtered.slice(start, start + PER_PAGE);

        if (paged.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--gray-400);">데이터가 없습니다.</td></tr>';
        } else {
            paged.forEach(p => {
                const tr = document.createElement('tr');
                const badgeClass = p.stock <= 2 ? 'stock-badge low' : 'stock-badge';
                tr.innerHTML =
                    '<td><input type="checkbox" class="row-check" value="' + escHtml(p.id) + '"></td>' +
                    '<td>' + escHtml(p.supplier || '최가유통') + '</td>' +
                    '<td>' + escHtml(p.brand) + '</td>' +
                    '<td>' + escHtml(p.name) + '</td>' +
                    '<td>' + escHtml(p.color) + '</td>' +
                    '<td>' + escHtml(p.size) + '</td>' +
                    '<td>' + fmtCurrency(p.buyPrice) + '</td>' +
                    '<td><span class="' + badgeClass + '">' + p.stock + '</span></td>' +
                    '<td><button class="btn-action" data-edit="' + escHtml(p.id) + '"><i class="bx bx-edit-alt"></i> 수정</button></td>';
                tbody.appendChild(tr);
            });
        }

        renderPagination(filtered.length);
    }

    function renderPagination(total) {
        const container = $('pagination');
        const totalPages = Math.ceil(total / PER_PAGE);
        if (totalPages <= 1) {
            container.innerHTML = '<span class="page-info">총 ' + total + '건</span>';
            return;
        }
        let html = '<button class="page-btn" ' + (page===1?'disabled':'') + ' data-page="' + (page-1) + '">‹ 이전</button>';
        const startP = Math.max(1, page - 2);
        const endP = Math.min(totalPages, startP + 4);
        for (let i = startP; i <= endP; i++) {
            html += '<button class="page-btn ' + (i===page?'active':'') + '" data-page="' + i + '">' + i + '</button>';
        }
        html += '<button class="page-btn" ' + (page===totalPages?'disabled':'') + ' data-page="' + (page+1) + '">다음 ›</button>';
        html += '<span class="page-info">' + total + '건 중 ' + ((page-1)*PER_PAGE+1) + '–' + Math.min(page*PER_PAGE, total) + '</span>';
        container.innerHTML = html;
    }

    // ==========================================
    // Entry Modal
    // ==========================================
    function openEntryModal() {
        $('entryForm').reset();
        $('txDate').value = new Date().toISOString().split('T')[0];
        $('typeIn').checked = true;
        toggleEntryMode('IN');
        $('entryModal').classList.add('active');
    }

    function closeEntryModal() {
        $('entryModal').classList.remove('active');
    }

    function toggleEntryMode(type) {
        const bpCol = $('basePriceCol');
        const frCol = $('freightCol');
        const priceInput = $('txPrice');
        const lbl = $('lblPrice');

        if (type === 'IN') {
            lbl.textContent = '매입단가 (₩)';
            bpCol.style.display = '';
            frCol.style.display = '';
            priceInput.readOnly = true;
            priceInput.classList.add('readonly-input');
            priceInput.placeholder = '자동계산';
        } else {
            lbl.textContent = '매출단가 (₩)';
            bpCol.style.display = 'none';
            frCol.style.display = 'none';
            priceInput.readOnly = false;
            priceInput.classList.remove('readonly-input');
            priceInput.placeholder = '판매가 입력';
        }
    }

    function updateCalcPrice() {
        const base = parseInt($('txBasePrice').value, 10) || 0;
        const freight = parseInt($('txFreight').value, 10) || 0;
        const pureBase = $('txBaseVat').checked ? base : Math.round(base / 1.1);
        const pureFreight = $('txFreightVat').checked ? freight : Math.round(freight / 1.1);
        $('txPrice').value = pureBase + pureFreight;
    }

    async function handleEntry(e) {
        e.preventDefault();
        const type = document.querySelector('input[name="txType"]:checked').value;
        const data = {
            type: type,
            txDate: $('txDate').value,
            supplier: $('fSupplier').value.trim(),
            brand: $('fBrand').value.trim(),
            productName: $('fName').value.trim(),
            color: $('fColor').value.trim(),
            size: $('fSize').value.trim(),
            qty: parseInt($('txQty').value, 10) || 0,
            price: parseInt($('txPrice').value, 10) || 0,
            basePrice: parseInt($('txBasePrice').value, 10) || 0,
            freight: parseInt($('txFreight').value, 10) || 0,
            remarks: $('txRemarks').value.trim()
        };

        if (!data.qty || !data.price) {
            showToast('수량과 단가를 입력해 주세요.', 'warning');
            return;
        }

        // 매칭되는 상품 찾기
        const match = products.find(p =>
            p.brand === data.brand && p.name === data.productName &&
            p.color === data.color && p.size === data.size
        );

        if (match) {
            data.productId = match.id;
            data.buyPrice = match.buyPrice;
        } else if (type === 'IN') {
            // 신규 상품 자동 등록
            try {
                const pRes = await fetch(API_BASE + '/products', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        supplier: data.supplier,
                        brand: data.brand,
                        name: data.productName,
                        color: data.color,
                        size: data.size,
                        stock: 0,
                        buyPrice: data.price
                    })
                });
                const pResult = await pRes.json();
                data.productId = pResult.id;
            } catch(e) {
                showToast('상품 등록 실패: ' + e.message, 'error');
                return;
            }
        }

        try {
            const res = await fetch(API_BASE + '/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('등록 실패');
            showToast((type === 'IN' ? '매입' : '출고') + ' 등록 완료!', 'success');
            closeEntryModal();
            fetchProducts();
            fetchMetrics();
        } catch(e) {
            showToast('등록 실패: ' + e.message, 'error');
        }
    }

    // ==========================================
    // Delete
    // ==========================================
    async function handleDelete() {
        const checked = document.querySelectorAll('.row-check:checked');
        if (checked.length === 0) {
            showToast('삭제할 항목을 선택해 주세요.', 'warning');
            return;
        }
        if (!confirm(checked.length + '개 상품을 삭제하시겠습니까?')) return;

        const ids = Array.from(checked).map(c => c.value);
        try {
            const res = await fetch(API_BASE + '/products/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            if (!res.ok) throw new Error('삭제 실패');
            showToast(ids.length + '개 항목이 삭제되었습니다.', 'success');
            fetchProducts();
        } catch(e) {
            showToast('삭제 실패: ' + e.message, 'error');
        }
    }

    // ==========================================
        // Init
    // ==========================================
    function checkHash() {
        if (window.location.hash === '#open-entry') {
            openEntryModal();
            // Clear hash so it can be opened again if closed and clicked again
            history.replaceState(null, null, ' ');
        }
    }

    window.addEventListener('hashchange', checkHash);

    document.addEventListener('DOMContentLoaded', () => {
        fetchProducts();
        fetchMetrics();
        checkHash();

        // Entry modal
        $('entryBtn').addEventListener('click', openEntryModal);
        $('closeEntryModal').addEventListener('click', closeEntryModal);
        $('cancelEntry').addEventListener('click', closeEntryModal);
        $('entryForm').addEventListener('submit', handleEntry);
        $('entryModal').addEventListener('click', e => { if (e.target === $('entryModal')) closeEntryModal(); });

        // Toggle IN/OUT
        document.querySelectorAll('input[name="txType"]').forEach(r => {
            r.addEventListener('change', e => toggleEntryMode(e.target.value));
        });

        // Auto-calc price
        $('txBasePrice').addEventListener('input', updateCalcPrice);
        $('txFreight').addEventListener('input', updateCalcPrice);
        $('txBaseVat').addEventListener('change', updateCalcPrice);
        $('txFreightVat').addEventListener('change', updateCalcPrice);

        // Delete
        $('deleteBtn').addEventListener('click', handleDelete);

        // Search
        const fieldSel = document.querySelector('[data-role="field"]');
        const queryInput = $('searchInput');
        $('btn-do-search').addEventListener('click', () => {
            searchField = fieldSel.value;
            searchQuery = queryInput.value.trim();
            page = 1;
            renderTable();
        });
        queryInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); $('btn-do-search').click(); }
        });
        $('btn-clear-search').addEventListener('click', () => {
            fieldSel.value = 'all';
            queryInput.value = '';
            searchField = 'all';
            searchQuery = '';
            page = 1;
            renderTable();
        });

        // Sort
        document.querySelectorAll('.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.sort;
                if (sort.col === col) sort.asc = !sort.asc;
                else { sort.col = col; sort.asc = true; }
                renderTable();
            });
        });

        // Select all
        $('selectAll').addEventListener('change', e => {
            document.querySelectorAll('.row-check').forEach(c => c.checked = e.target.checked);
        });

        // Pagination delegation
        $('pagination').addEventListener('click', e => {
            const btn = e.target.closest('[data-page]');
            if (btn && !btn.disabled) {
                page = parseInt(btn.dataset.page, 10);
                renderTable();
            }
        });

        // Inline edit delegation
        $('tableBody').addEventListener('click', e => {
            const btn = e.target.closest('[data-edit]');
            if (btn) {
                const id = btn.dataset.edit;
                const prod = products.find(p => p.id === id);
                if (prod) {
                    const newStock = prompt('재고 수량 수정 (' + prod.name + ')', prod.stock);
                    if (newStock !== null) {
                        fetch(API_BASE + '/products/' + id, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(Object.assign({}, prod, { stock: parseInt(newStock, 10) || 0 }))
                        }).then(() => {
                            showToast('수정 완료', 'success');
                            fetchProducts();
                        }).catch(err => showToast('수정 실패', 'error'));
                    }
                }
            }
        });
    });
})();
