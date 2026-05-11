/**
 * 본사 매입 현황 — 입출고 내역
 */
(function() {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    let transactions = [];
    let page = 1;
    const PER_PAGE = 20;
    let sort = { col: 'txDate', asc: false };
    let typeFilter = 'all';

    const $ = id => document.getElementById(id);
    const fmtCurrency = n => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n);
    const escHtml = s => {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };

    function showToast(msg, type) {
        type = type || 'info';
        const c = $('toastContainer'); if (!c) return;
        const icons = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = "<i class='bx " + (icons[type]||icons.info) + "'></i> <span>" + escHtml(msg) + "</span>";
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    async function fetchTransactions() {
        try {
            let url = API_BASE + '/transactions';
            const params = [];
            if (typeFilter !== 'all') params.push('type=' + typeFilter);
            const sd = $('startDate').value; if (sd) params.push('startDate=' + sd);
            const ed = $('endDate').value; if (ed) params.push('endDate=' + ed);
            if (params.length) url += '?' + params.join('&');

            const res = await fetch(url);
            if (!res.ok) throw new Error('서버 오류');
            transactions = await res.json();
            renderTable();
        } catch(e) {
            showToast('내역 로딩 실패: ' + e.message, 'error');
        }
    }

    function renderTable() {
        const tbody = $('tableBody');
        tbody.innerHTML = '';

        let filtered = transactions;

        // Client-side search
        const searchField = $('searchField').value;
        const searchQuery = $('searchInput').value.trim().toLowerCase();
        if (searchQuery) {
            filtered = filtered.filter(t => {
                if (searchField === 'all') {
                    const typeLabel = t.type === 'IN' ? '매입' : '출고';
                    return (t.txDate||'').includes(searchQuery) || typeLabel.includes(searchQuery) ||
                           (t.supplier||'').toLowerCase().includes(searchQuery) ||
                           (t.productName||'').toLowerCase().includes(searchQuery) ||
                           (t.brand||'').toLowerCase().includes(searchQuery) ||
                           String(t.qty).includes(searchQuery) || String(t.price).includes(searchQuery) ||
                           (t.remarks||'').toLowerCase().includes(searchQuery);
                }
                if (searchField === 'type') {
                    const label = t.type === 'IN' ? '매입' : '출고';
                    return label.includes(searchQuery) || t.type.toLowerCase().includes(searchQuery);
                }
                return ((t[searchField]||'') + '').toLowerCase().includes(searchQuery);
            });
        }

        // Sort
        filtered.sort((a, b) => {
            let va = a[sort.col] || '', vb = b[sort.col] || '';
            if (sort.col === 'txDate' || sort.col === 'timestamp') {
                va = new Date(va).getTime() || 0;
                vb = new Date(vb).getTime() || 0;
            } else if (sort.col === 'qty' || sort.col === 'price') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else if (typeof va === 'string') {
                va = va.toLowerCase(); vb = (vb+'').toLowerCase();
            }
            if (va < vb) return sort.asc ? -1 : 1;
            if (va > vb) return sort.asc ? 1 : -1;
            return 0;
        });

        $('totalCount').textContent = filtered.length + '건';

        // Pagination
        const totalPages = Math.ceil(filtered.length / PER_PAGE);
        if (page > totalPages) page = Math.max(1, totalPages);
        const start = (page - 1) * PER_PAGE;
        const paged = filtered.slice(start, start + PER_PAGE);

        if (paged.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:var(--gray-400);">데이터가 없습니다.</td></tr>';
        } else {
            paged.forEach(t => {
                const tr = document.createElement('tr');
                const badge = t.type === 'IN' ? 'stock-badge' : 'stock-badge low';
                const label = t.type === 'IN' ? '매입' : '출고';
                let prodDisplay = escHtml(t.productName || '-');
                const details = [];
                if (t.color) details.push(escHtml(t.color));
                if (t.size) details.push(escHtml(t.size));
                if (details.length) prodDisplay += ' <span class="tx-detail">(' + details.join(' / ') + ')</span>';

                tr.innerHTML =
                    '<td><input type="checkbox" class="row-check" value="' + escHtml(t.id) + '"></td>' +
                    '<td>' + escHtml(t.txDate) + '</td>' +
                    '<td style="text-align:center;"><span class="' + badge + '">' + label + '</span></td>' +
                    '<td>' + escHtml(t.supplier || '-') + '</td>' +
                    '<td>' + prodDisplay + '</td>' +
                    '<td>' + t.qty + '</td>' +
                    '<td>' + fmtCurrency(t.price) + '</td>' +
                    '<td>' + escHtml(t.remarks || '') + '</td>' +
                    '<td><button class="btn-action" data-edit="' + escHtml(t.id) + '"><i class="bx bx-edit-alt"></i> 수정</button></td>';
                tbody.appendChild(tr);
            });
        }

        renderPagination(filtered.length);
    }

    function renderPagination(total) {
        const container = $('pagination');
        const totalPages = Math.ceil(total / PER_PAGE);
        if (totalPages <= 1) { container.innerHTML = '<span class="page-info">총 ' + total + '건</span>'; return; }
        let html = '<button class="page-btn" ' + (page===1?'disabled':'') + ' data-page="' + (page-1) + '">‹ 이전</button>';
        const startP = Math.max(1, page-2), endP = Math.min(totalPages, startP+4);
        for (let i = startP; i <= endP; i++) html += '<button class="page-btn ' + (i===page?'active':'') + '" data-page="' + i + '">' + i + '</button>';
        html += '<button class="page-btn" ' + (page===totalPages?'disabled':'') + ' data-page="' + (page+1) + '">다음 ›</button>';
        html += '<span class="page-info">' + total + '건 중 ' + ((page-1)*PER_PAGE+1) + '–' + Math.min(page*PER_PAGE, total) + '</span>';
        container.innerHTML = html;
    }

    // Edit Modal
    function updateEditCalcPrice() {
        const base = parseInt($('eBasePrice').value, 10) || 0;
        const freight = parseInt($('eFreight').value, 10) || 0;
        const pureBase = $('eBaseVat').checked ? base : Math.round(base / 1.1);
        const pureFreight = $('eFreightVat').checked ? freight : Math.round(freight / 1.1);
        $('ePrice').value = pureBase + pureFreight;
    }

    function openEditModal(id) {
        const t = transactions.find(x => x.id === id);
        if (!t) return;
        $('editId').value = t.id;
        $('eTxDate').value = t.txDate;
        $('eTxType').value = t.type === 'IN' ? '매입' : '출고';
        $('eSupplier').value = t.supplier || '';
        $('eBrand').value = t.brand || '';
        $('eName').value = t.productName || '';
        $('eColor').value = t.color || '';
        $('eSize').value = t.size || '';
        $('eQty').value = t.qty;
        
        const isOut = t.type === 'OUT';
        const bpCol = $('eBasePriceCol');
        const frCol = $('eFreightCol');
        const priceInput = $('ePrice');
        const lbl = $('eLblPrice');

        if (isOut) {
            lbl.textContent = '단가 (매출)';
            bpCol.style.display = 'none';
            frCol.style.display = 'none';
            priceInput.readOnly = false;
            priceInput.classList.remove('readonly-input');
            priceInput.placeholder = '판매가 입력';
            $('eBasePrice').value = '';
            $('eFreight').value = '';
            $('ePrice').value = t.price;
        } else {
            lbl.textContent = '단가 (매입)';
            bpCol.style.display = '';
            frCol.style.display = '';
            priceInput.readOnly = true;
            priceInput.classList.add('readonly-input');
            priceInput.placeholder = '자동계산';
            $('eBasePrice').value = t.basePrice || 0;
            $('eFreight').value = t.freight || 0;
            $('ePrice').value = t.price;
            // Set VAT toggles to true as we assume the DB value is pure
            $('eBaseVat').checked = true;
            $('eFreightVat').checked = true;
        }

        $('editModal').classList.add('active');
    }

    function closeEditModal() { $('editModal').classList.remove('active'); }

    async function handleEdit(e) {
        e.preventDefault();
        const id = $('editId').value;
        const orig = transactions.find(x => x.id === id);
        if (!orig) return;

        const data = {
            type: orig.type,
            txDate: $('eTxDate').value,
            productId: orig.productId,
            supplier: $('eSupplier').value.trim(),
            brand: $('eBrand').value.trim(),
            productName: $('eName').value.trim(),
            color: $('eColor').value.trim(),
            size: $('eSize').value.trim(),
            qty: parseInt($('eQty').value, 10) || 0,
            price: parseInt($('ePrice').value, 10) || 0,
            buyPrice: orig.buyPrice || 0,
            basePrice: orig.type === 'IN' ? parseInt($('eBasePrice').value, 10) || 0 : orig.basePrice || 0,
            freight: orig.type === 'IN' ? parseInt($('eFreight').value, 10) || 0 : orig.freight || 0,
            remarks: $('eRemarks').value.trim()
        };

        try {
            const res = await fetch(API_BASE + '/transactions/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('수정 실패');
            showToast('내역이 수정되었습니다.', 'success');
            closeEditModal();
            fetchTransactions();
        } catch(e) {
            showToast('수정 실패: ' + e.message, 'error');
        }
    }

    async function handleDelete() {
        const checked = document.querySelectorAll('.row-check:checked');
        if (checked.length === 0) { showToast('삭제할 항목을 선택해 주세요.', 'warning'); return; }
        if (!confirm(checked.length + '건을 삭제하시겠습니까?')) return;
        const ids = Array.from(checked).map(c => c.value);
        try {
            const res = await fetch(API_BASE + '/transactions/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            if (!res.ok) throw new Error('삭제 실패');
            showToast(ids.length + '건 삭제 완료', 'success');
            fetchTransactions();
        } catch(e) {
            showToast('삭제 실패: ' + e.message, 'error');
        }
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        fetchTransactions();

        // Type filter tabs
        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                typeFilter = btn.dataset.filter;
                page = 1;
                fetchTransactions();
            });
        });

        // Search
        const searchInput = $('searchInput');
        const searchField = $('searchField');
        if ($('btn-do-search')) {
            $('btn-do-search').addEventListener('click', () => { page = 1; renderTable(); });
        }
        if ($('btn-clear-search')) {
            $('btn-clear-search').addEventListener('click', () => {
                searchField.value = 'all';
                searchInput.value = '';
                $('startDate').value = '';
                $('endDate').value = '';
                page = 1;
                renderTable();
            });
        }
        searchInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); page = 1; renderTable(); }
        });
        $('startDate').addEventListener('change', () => { page = 1; fetchTransactions(); });
        $('endDate').addEventListener('change', () => { page = 1; fetchTransactions(); });

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

        // Pagination
        $('pagination').addEventListener('click', e => {
            const btn = e.target.closest('[data-page]');
            if (btn && !btn.disabled) { page = parseInt(btn.dataset.page, 10); renderTable(); }
        });

        // Edit modal
        $('tableBody').addEventListener('click', e => {
            const btn = e.target.closest('[data-edit]');
            if (btn) openEditModal(btn.dataset.edit);
        });
        $('closeEditModal').addEventListener('click', closeEditModal);
        $('cancelEdit').addEventListener('click', closeEditModal);
        $('editForm').addEventListener('submit', handleEdit);
        $('editModal').addEventListener('click', e => { if (e.target === $('editModal')) closeEditModal(); });

        $('eBasePrice').addEventListener('input', updateEditCalcPrice);
        $('eFreight').addEventListener('input', updateEditCalcPrice);
        $('eBaseVat').addEventListener('change', updateEditCalcPrice);
        $('eFreightVat').addEventListener('change', updateEditCalcPrice);

        // Delete
        $('deleteBtn').addEventListener('click', handleDelete);
    });
})();
