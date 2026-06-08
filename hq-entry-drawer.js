/**
 * 입출고 등록 드로워 (hq-transactions.html 내장)
 * hq-entry.js 로직을 드로워 형태로 이식
 */
(function() {
    'use strict';

    async function authFetch(url, options = {}) {
        let token = null;
        try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
        if (!options.headers) options.headers = {};
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, options);
    }

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    let products = [];
    let drawerRowCounter = 0;

    const $ = id => document.getElementById(id);
    const escHtml = s => { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
    const fmt = n => Number(n||0).toLocaleString('ko-KR');

    function showToast(msg, type = 'info') {
        const c = $('toastContainer'); if (!c) return;
        const icons = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = `<i class='bx ${icons[type]||icons.info}'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    async function fetchProducts() {
        try {
            const res = await authFetch(API_BASE + '/products');
            if (res.ok) products = await res.json();
        } catch(e) { console.error('Failed to load products', e); }
    }

    function getDrawerType() {
        const el = document.querySelector('input[name="dTxType"]:checked');
        return el ? el.value : 'IN';
    }

    // ── Drawer Open / Close ──
    function openDrawer() {
        $('drawerBackdrop').classList.add('active');
        $('drawerPanel').classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
        $('drawerBackdrop').classList.remove('active');
        $('drawerPanel').classList.remove('active');
        document.body.style.overflow = '';
    }

    // ── Build Table Head ──
    function buildDrawerTableHead() {
        const type = getDrawerType();
        const head = $('dTableHead');
        if (type === 'IN') {
            head.innerHTML = `<tr>
                <th style="width:28px">#</th>
                <th>브랜드</th><th>상품명</th><th>컬러</th><th>사이즈</th>
                <th class="drawer-col-qty">수량</th>
                <th class="drawer-col-price">상품가<label class="drawer-vat-toggle"><input type="checkbox" class="d-col-vat" data-target="basePrice" checked>VAT별도</label></th>
                <th class="drawer-col-price">운임<label class="drawer-vat-toggle"><input type="checkbox" class="d-col-vat" data-target="freight" checked>VAT별도</label></th>
                <th class="drawer-col-price">매입단가</th>
                <th class="drawer-col-price">판매가</th>
                <th class="drawer-col-price">할인가</th>
                <th class="drawer-col-action"></th>
            </tr>`;
        } else {
            head.innerHTML = `<tr>
                <th style="width:28px">#</th>
                <th style="min-width:200px">상품 선택</th>
                <th class="drawer-col-stock">재고</th>
                <th class="drawer-col-qty">출고수량</th>
                <th class="drawer-col-price">매출단가<label class="drawer-vat-toggle"><input type="checkbox" class="d-col-vat" data-target="outPrice">VAT별도</label></th>
                <th class="drawer-col-price">판매가</th>
                <th class="drawer-col-price">할인가</th>
                <th class="drawer-col-action"></th>
            </tr>`;
        }
        document.querySelectorAll('.d-col-vat').forEach(chk => {
            chk.addEventListener('change', calcAllDrawerRows);
        });
    }

    // ── Toggle Mode ──
    function toggleDrawerMode() {
        const type = getDrawerType();
        const header = $('drawerHeader');
        const submitBtn = $('dSubmitBtn');
        $('dItemsBody').innerHTML = '';

        if (type === 'IN') {
            header.classList.remove('out-mode');
            submitBtn.classList.remove('out-mode');
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 입고";
        } else {
            header.classList.add('out-mode');
            submitBtn.classList.add('out-mode');
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 출고";
        }
        buildDrawerTableHead();
        addDrawerRow();
        updateDrawerSummary();
    }

    // ── Price Calc ──
    function calcDrawerRowPrice(row) {
        if (getDrawerType() !== 'IN') return;
        const baseEl = row.querySelector('.d-row-base');
        const freightEl = row.querySelector('.d-row-freight');
        if (!baseEl || !freightEl) return;
        const base = parseInt(baseEl.value, 10) || 0;
        const freight = parseInt(freightEl.value, 10) || 0;
        const baseVatChk = document.querySelector('.d-col-vat[data-target="basePrice"]');
        const freightVatChk = document.querySelector('.d-col-vat[data-target="freight"]');
        const pureBase = (baseVatChk && baseVatChk.checked) ? base : Math.round(base / 1.1);
        const pureFreight = (freightVatChk && freightVatChk.checked) ? freight : Math.round(freight / 1.1);
        row.querySelector('.d-row-price').value = pureBase + pureFreight;
        updateDrawerSummary();
    }

    function calcAllDrawerRows() {
        document.querySelectorAll('#dItemsBody tr').forEach(calcDrawerRowPrice);
    }

    // ── Autocomplete ──
    let activeDrawerDropdown = null;
    function closeDrawerAutocomplete() {
        if (activeDrawerDropdown) { activeDrawerDropdown.remove(); activeDrawerDropdown = null; }
    }

    function showDrawerAutocomplete(input, row) {
        closeDrawerAutocomplete();
        const val = input.value.trim().toLowerCase();
        if (val.length < 1) return;
        const brandFilter = row.querySelector('.d-row-brand')?.value.trim().toLowerCase() || '';
        let matches = products.filter(p => `${p.brand} ${p.name} ${p.color} ${p.size}`.toLowerCase().includes(val));
        if (brandFilter) matches = matches.filter(p => p.brand.toLowerCase().includes(brandFilter));
        const unique = []; const seen = new Set();
        for (const p of matches) { const key = `${p.brand}|${p.name}|${p.color}|${p.size}`; if (!seen.has(key)) { seen.add(key); unique.push(p); } }
        if (unique.length === 0) return;

        const list = document.createElement('div');
        list.className = 'drawer-autocomplete-list'; list.style.display = 'block';
        unique.slice(0, 10).forEach(p => {
            const item = document.createElement('div');
            item.className = 'drawer-autocomplete-item';
            item.innerHTML = `<div><span class="drawer-ac-name">${escHtml(p.brand)} — ${escHtml(p.name)}</span><br><span class="drawer-ac-detail">${escHtml(p.color)} / ${escHtml(p.size)}</span></div><span class="drawer-ac-stock">재고 ${p.stock||0}</span>`;
            item.addEventListener('click', () => {
                row.querySelector('.d-row-brand').value = p.brand;
                row.querySelector('.d-row-name').value = p.name;
                row.querySelector('.d-row-color').value = p.color;
                row.querySelector('.d-row-size').value = p.size;
                row.querySelector('.d-row-base').value = p.basePrice || 0;
                row.querySelector('.d-row-freight').value = p.freight || 0;
                const sp = row.querySelector('.d-row-sellPrice'); if (sp) sp.value = p.sellPrice || 0;
                const dp = row.querySelector('.d-row-discountPrice'); if (dp) dp.value = p.discountPrice || 0;
                calcDrawerRowPrice(row);
                closeDrawerAutocomplete();
            });
            list.appendChild(item);
        });
        input.parentNode.appendChild(list);
        activeDrawerDropdown = list;
    }

    function showDrawerOutAutocomplete(input, row) {
        closeDrawerAutocomplete();
        const val = input.value.trim().toLowerCase();
        const inStock = products.filter(p => (p.stock || 0) > 0);
        let matches = val.length > 0 ? inStock.filter(p => `${p.brand} ${p.name} ${p.color} ${p.size}`.toLowerCase().includes(val)) : inStock;

        const list = document.createElement('div');
        list.className = 'drawer-autocomplete-list'; list.style.display = 'block';
        if (matches.length === 0) {
            list.innerHTML = `<div class="drawer-autocomplete-item" style="color:var(--gray-400);cursor:default;justify-content:center;">검색 결과 없음</div>`;
        } else {
            matches.slice(0, 15).forEach(p => {
                const stock = p.stock || 0;
                const cls = stock > 10 ? 'ok' : stock > 0 ? 'low' : 'zero';
                const item = document.createElement('div');
                item.className = 'drawer-autocomplete-item';
                item.innerHTML = `<div><span class="drawer-ac-name">${escHtml(p.brand)} — ${escHtml(p.name)}</span><br><span class="drawer-ac-detail">${escHtml(p.color)} / ${escHtml(p.size)}</span></div><span class="drawer-ac-stock" style="background:var(--${cls==='ok'?'success':cls==='low'?'warning':'danger'}-muted);color:var(--${cls==='ok'?'success':cls==='low'?'warning':'danger'})">${stock}개</span>`;
                item.addEventListener('click', () => {
                    row.dataset.productId = p.id; row.dataset.brand = p.brand;
                    row.dataset.name = p.name; row.dataset.color = p.color;
                    row.dataset.size = p.size; row.dataset.stock = stock;
                    row.dataset.buyPrice = p.buyPrice || 0;
                    input.value = `${p.brand} — ${p.name} (${p.color}/${p.size})`;
                    const badge = row.querySelector('.drawer-stock-badge');
                    badge.textContent = stock; badge.className = 'drawer-stock-badge ' + cls;
                    const st = row.querySelector('.d-row-sell-text'); if (st) st.textContent = fmt(p.sellPrice||0);
                    const dt = row.querySelector('.d-row-disc-text'); if (dt) dt.textContent = fmt(p.discountPrice||0);
                    closeDrawerAutocomplete(); updateDrawerSummary();
                });
                list.appendChild(item);
            });
        }
        input.parentNode.appendChild(list);
        activeDrawerDropdown = list;
    }

    // ── Add Row ──
    function addDrawerRow() {
        drawerRowCounter++;
        const type = getDrawerType();
        const tbody = $('dItemsBody');
        const tr = document.createElement('tr');
        const rowNum = tbody.children.length + 1;

        if (type === 'IN') {
            tr.innerHTML = `
                <td class="drawer-row-num">${rowNum}</td>
                <td><input type="text" class="d-row-brand text-left" placeholder="브랜드"></td>
                <td class="drawer-autocomplete-wrapper"><input type="text" class="d-row-name text-left" placeholder="상품명 검색..." autocomplete="off"></td>
                <td><input type="text" class="d-row-color" placeholder="컬러"></td>
                <td><input type="text" class="d-row-size" placeholder="사이즈"></td>
                <td><input type="number" class="d-row-qty" min="1" placeholder="0"></td>
                <td><input type="number" class="d-row-base" min="0" placeholder="0"></td>
                <td><input type="number" class="d-row-freight" min="0" placeholder="0"></td>
                <td><input type="number" class="d-row-price readonly-input" readonly placeholder="자동"></td>
                <td><input type="number" class="d-row-sellPrice" min="0" placeholder="0"></td>
                <td><input type="number" class="d-row-discountPrice" min="0" placeholder="0"></td>
                <td><button type="button" class="drawer-btn-icon d-btn-remove"><i class='bx bx-trash'></i></button></td>`;
            tr.querySelector('.d-row-base').addEventListener('input', () => calcDrawerRowPrice(tr));
            tr.querySelector('.d-row-freight').addEventListener('input', () => calcDrawerRowPrice(tr));
            tr.querySelector('.d-row-qty').addEventListener('input', () => updateDrawerSummary());
            const nameInput = tr.querySelector('.d-row-name');
            nameInput.addEventListener('input', () => showDrawerAutocomplete(nameInput, tr));
            nameInput.addEventListener('focus', () => { if (nameInput.value.trim()) showDrawerAutocomplete(nameInput, tr); });
        } else {
            tr.innerHTML = `
                <td class="drawer-row-num">${rowNum}</td>
                <td class="drawer-autocomplete-wrapper"><input type="text" class="d-out-search text-left" placeholder="상품 검색..." autocomplete="off"></td>
                <td><div class="drawer-stock-badge zero">—</div></td>
                <td><input type="number" class="d-row-qty" min="1" placeholder="0"></td>
                <td><input type="number" class="d-row-price" min="0" placeholder="단가"></td>
                <td class="d-row-sell-text" style="color:var(--gray-500);font-size:11px;text-align:center">-</td>
                <td class="d-row-disc-text" style="color:var(--gray-500);font-size:11px;text-align:center">-</td>
                <td><button type="button" class="drawer-btn-icon d-btn-remove"><i class='bx bx-trash'></i></button></td>`;
            const si = tr.querySelector('.d-out-search');
            si.addEventListener('input', () => showDrawerOutAutocomplete(si, tr));
            si.addEventListener('focus', () => showDrawerOutAutocomplete(si, tr));
            tr.querySelector('.d-row-qty').addEventListener('input', () => updateDrawerSummary());
            tr.querySelector('.d-row-price').addEventListener('input', () => updateDrawerSummary());
        }

        tr.querySelector('.d-btn-remove').addEventListener('click', () => {
            tr.remove(); renumberDrawerRows(); updateDrawerSummary();
            if ($('dItemsBody').children.length === 0) addDrawerRow();
        });
        tbody.appendChild(tr);
        updateDrawerSummary();
    }

    function renumberDrawerRows() {
        document.querySelectorAll('#dItemsBody tr').forEach((tr, i) => {
            const n = tr.querySelector('.drawer-row-num'); if (n) n.textContent = i + 1;
        });
    }

    function updateDrawerSummary() {
        const rows = document.querySelectorAll('#dItemsBody tr');
        $('dSummaryRows').textContent = rows.length;
        let total = 0;
        rows.forEach(r => {
            const qty = parseInt(r.querySelector('.d-row-qty')?.value, 10) || 0;
            const price = parseInt(r.querySelector('.d-row-price')?.value, 10) || 0;
            total += qty * price;
        });
        if (total > 0) { $('dSummaryTotalWrap').style.display = ''; $('dSummaryTotal').textContent = fmt(total); }
        else { $('dSummaryTotalWrap').style.display = 'none'; }
    }

    // ── Submit ──
    async function handleDrawerSubmit() {
        const type = getDrawerType();
        const txDate = $('dTxDate').value;
        const supplier = $('dSupplier').value.trim();
        const commonRemarks = $('dRemarks').value.trim();
        const rows = document.querySelectorAll('#dItemsBody tr');
        if (!txDate) { showToast('일자를 선택해 주세요.', 'warning'); return; }
        if (rows.length === 0) { showToast('등록할 상품을 추가해 주세요.', 'warning'); return; }

        const btn = $('dSubmitBtn'); btn.disabled = true;
        const origHtml = btn.innerHTML;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";
        const items = [];

        for (const row of rows) {
            let brand, name, color, size, productId, buyPrice;
            const qty = parseInt(row.querySelector('.d-row-qty').value, 10) || 0;
            let price = parseInt(row.querySelector('.d-row-price').value, 10) || 0;
            const basePrice = parseInt(row.querySelector('.d-row-base')?.value, 10) || 0;
            const freight = parseInt(row.querySelector('.d-row-freight')?.value, 10) || 0;
            const sellPrice = parseInt(row.querySelector('.d-row-sellPrice')?.value, 10) || 0;
            const discountPrice = parseInt(row.querySelector('.d-row-discountPrice')?.value, 10) || 0;
            if (!qty || !price) continue;

            if (type === 'OUT') {
                const outVatCheck = document.querySelector('.d-col-vat[data-target="outPrice"]');
                if (outVatCheck && !outVatCheck.checked) price = Math.round(price / 1.1);
                productId = row.dataset.productId;
                if (!productId) { showToast('상품이 선택되지 않은 행이 있습니다.', 'warning'); btn.disabled = false; btn.innerHTML = origHtml; return; }
                brand = row.dataset.brand; name = row.dataset.name;
                color = row.dataset.color; size = row.dataset.size;
                const stock = parseInt(row.dataset.stock, 10) || 0;
                if (qty > stock) { showToast(`재고 부족: ${name} (재고 ${stock}, 요청 ${qty})`, 'error'); btn.disabled = false; btn.innerHTML = origHtml; return; }
                buyPrice = parseInt(row.dataset.buyPrice, 10) || 0;
                items.push({ type, txDate, supplier, brand, productName: name, color, size, qty, price, basePrice: 0, freight: 0, remarks: commonRemarks, productId, buyPrice });
            } else {
                brand = row.querySelector('.d-row-brand').value.trim();
                name = row.querySelector('.d-row-name').value.trim();
                color = row.querySelector('.d-row-color').value.trim();
                size = row.querySelector('.d-row-size').value.trim();
                const data = { type, txDate, supplier, brand, productName: name, color, size, qty, price, basePrice, freight, remarks: commonRemarks };
                const match = products.find(p => p.brand === brand && p.name === name && p.color === color && p.size === size);
                if (match) {
                    data.productId = match.id; data.buyPrice = match.buyPrice; items.push(data);
                    if (match.sellPrice !== sellPrice || match.discountPrice !== discountPrice || match.buyPrice !== price) {
                        try { await authFetch(API_BASE + '/products/' + match.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, match, { buyPrice: price, sellPrice, discountPrice })) }); match.buyPrice = price; match.sellPrice = sellPrice; match.discountPrice = discountPrice; } catch(e) { console.error('Price update failed', e); }
                    }
                } else {
                    try {
                        const pRes = await authFetch(API_BASE + '/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplier, brand, name, color, size, stock: 0, buyPrice: price, sellPrice, discountPrice }) });
                        const pResult = await pRes.json(); data.productId = pResult.id; data.buyPrice = price;
                        products.push({ id: pResult.id, supplier, brand, name, color, size, stock: 0, buyPrice: price, sellPrice, discountPrice });
                        items.push(data);
                    } catch(err) { showToast(`상품 등록 실패: ${name}`, 'error'); btn.disabled = false; btn.innerHTML = origHtml; return; }
                }
            }
        }

        if (items.length === 0) { showToast('유효한 입력이 없습니다.', 'warning'); btn.disabled = false; btn.innerHTML = origHtml; return; }

        try {
            const res = await authFetch(API_BASE + '/transactions/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || '등록 실패');
            showToast(`${items.length}건 ${type === 'IN' ? '매입' : '출고'} 등록 완료!`, 'success');
            $('dItemsBody').innerHTML = ''; $('dRemarks').value = '';
            await fetchProducts(); addDrawerRow(); updateDrawerSummary();
            // Refresh transaction list
            if (window._refreshTransactions) window._refreshTransactions();
            closeDrawer();
        } catch(e) { showToast('등록 실패: ' + e.message, 'error');
        } finally { btn.disabled = false; btn.innerHTML = origHtml; }
    }

    // ── Init ──
    document.addEventListener('DOMContentLoaded', async () => {
        await fetchProducts();
        $('dTxDate').value = new Date().toISOString().split('T')[0];

        // Open/close drawer
        $('newEntryBtn').addEventListener('click', () => { openDrawer(); });
        $('drawerCloseBtn').addEventListener('click', closeDrawer);
        $('drawerBackdrop').addEventListener('click', closeDrawer);

        // Mode toggle
        document.querySelectorAll('input[name="dTxType"]').forEach(r => r.addEventListener('change', toggleDrawerMode));

        // Add row / reset / submit
        $('dBtnAddRow').addEventListener('click', addDrawerRow);
        $('dResetBtn').addEventListener('click', () => {
            $('dItemsBody').innerHTML = ''; $('dSupplier').value = ''; $('dRemarks').value = '';
            $('dTxDate').value = new Date().toISOString().split('T')[0];
            $('dTypeIn').checked = true; toggleDrawerMode();
        });
        $('dSubmitBtn').addEventListener('click', handleDrawerSubmit);

        // Close autocomplete on outside click
        document.addEventListener('click', e => {
            if (!e.target.classList.contains('d-row-name') && !e.target.classList.contains('d-out-search')) {
                closeDrawerAutocomplete();
            }
        });

        // Keyboard: Escape to close drawer
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && $('drawerPanel').classList.contains('active')) closeDrawer();
        });

        // Init first load
        toggleDrawerMode();
    });
})();
