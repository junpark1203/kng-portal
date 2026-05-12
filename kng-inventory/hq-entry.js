/**
 * 본사 매입 현황 — 입출고 등록 (Invoice-style bulk entry)
 * IN mode: 자유 입력 + 자동완성 + 상품가/운임 → 단가 자동계산
 * OUT mode: 재고 기반 드롭다운 선택 전용 (재고에 없는 상품 출고 불가)
 */
(function() {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    let products = [];
    let rowCounter = 0;

    const $ = id => document.getElementById(id);
    const escHtml = s => {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };
    const fmt = n => Number(n||0).toLocaleString('ko-KR');

    function showToast(msg, type = 'info') {
        const c = $('toastContainer');
        if (!c) return;
        const icons = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = `<i class='bx ${icons[type]||icons.info}'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3500);
    }

    async function fetchProducts() {
        try {
            const res = await fetch(API_BASE + '/products');
            if (res.ok) products = await res.json();
        } catch(e) { console.error('Failed to load products', e); }
    }

    function getType() {
        return document.querySelector('input[name="txType"]:checked').value;
    }

    // =============================================
    //  Build Table Headers per mode
    // =============================================
    function buildTableHead() {
        const type = getType();
        const head = $('tableHead');
        if (type === 'IN') {
            head.innerHTML = `<tr>
                <th style="width:36px">#</th>
                <th>브랜드</th>
                <th>상품명</th>
                <th>컬러</th>
                <th>사이즈</th>
                <th class="col-qty">수량</th>
                <th class="col-price">상품가<label class="vat-toggle"><input type="checkbox" class="col-vat-check" data-target="basePrice" checked>VAT별도</label></th>
                <th class="col-price">운임<label class="vat-toggle"><input type="checkbox" class="col-vat-check" data-target="freight" checked>VAT별도</label></th>
                <th class="col-price">매입단가</th>
                <th class="col-action"></th>
            </tr>`;
        } else {
            head.innerHTML = `<tr>
                <th style="width:36px">#</th>
                <th style="min-width:280px">상품 선택</th>
                <th class="col-stock">재고</th>
                <th class="col-qty">출고수량</th>
                <th class="col-price">매출단가</th>
                <th class="col-action"></th>
            </tr>`;
        }

        // VAT toggles
        document.querySelectorAll('.col-vat-check').forEach(chk => {
            chk.addEventListener('change', calcAllRows);
        });
    }

    // =============================================
    //  Toggle IN / OUT Mode
    // =============================================
    function toggleEntryMode() {
        const type = getType();
        const header = $('headerBar');
        const indicator = $('modeIndicator');
        const submitBtn = $('submitBtn');

        // Clear rows
        $('itemsBody').innerHTML = '';

        if (type === 'IN') {
            header.classList.remove('out-mode');
            indicator.className = 'mode-indicator in';
            indicator.innerHTML = "<i class='bx bx-down-arrow-circle'></i> 매입 모드";
            submitBtn.classList.remove('out-mode');
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 입고";
        } else {
            header.classList.add('out-mode');
            indicator.className = 'mode-indicator out';
            indicator.innerHTML = "<i class='bx bx-up-arrow-circle'></i> 출고 모드";
            submitBtn.classList.add('out-mode');
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 출고";
        }

        buildTableHead();
        addRow();
        updateSummary();
    }

    // =============================================
    //  Price Calculation (IN mode only)
    // =============================================
    function calcRowPrice(row) {
        if (getType() !== 'IN') return;
        const baseEl = row.querySelector('.row-base');
        const freightEl = row.querySelector('.row-freight');
        if (!baseEl || !freightEl) return;

        const base = parseInt(baseEl.value, 10) || 0;
        const freight = parseInt(freightEl.value, 10) || 0;
        const baseVatChk = document.querySelector('.col-vat-check[data-target="basePrice"]');
        const freightVatChk = document.querySelector('.col-vat-check[data-target="freight"]');
        const baseVat = baseVatChk ? baseVatChk.checked : true;
        const freightVat = freightVatChk ? freightVatChk.checked : true;

        const pureBase = baseVat ? base : Math.round(base / 1.1);
        const pureFreight = freightVat ? freight : Math.round(freight / 1.1);
        row.querySelector('.row-price').value = pureBase + pureFreight;
        updateSummary();
    }

    function calcAllRows() {
        document.querySelectorAll('#itemsBody tr').forEach(calcRowPrice);
    }

    // =============================================
    //  Autocomplete (IN mode)
    // =============================================
    let activeDropdown = null;
    function closeAutocomplete() { if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; } }

    function showAutocomplete(input, row) {
        closeAutocomplete();
        const val = input.value.trim().toLowerCase();
        if (val.length < 1) return;
        const brandFilter = row.querySelector('.row-brand').value.trim().toLowerCase();

        let matches = products.filter(p => p.name.toLowerCase().includes(val));
        if (brandFilter) matches = matches.filter(p => p.brand.toLowerCase().includes(brandFilter));

        const unique = []; const seen = new Set();
        for (const p of matches) {
            const key = `${p.brand}|${p.name}|${p.color}|${p.size}`;
            if (!seen.has(key)) { seen.add(key); unique.push(p); }
        }
        if (unique.length === 0) return;

        const list = document.createElement('div');
        list.className = 'autocomplete-list';
        list.style.display = 'block';

        unique.slice(0, 10).forEach(p => {
            const item = document.createElement('div');
            item.className = 'autocomplete-item';
            item.innerHTML = `<div><span class="ac-name">${escHtml(p.brand)} — ${escHtml(p.name)}</span><br><span class="ac-detail">${escHtml(p.color)} / ${escHtml(p.size)}</span></div><span class="ac-stock">재고 ${p.stock||0}</span>`;
            item.addEventListener('click', () => {
                row.querySelector('.row-brand').value = p.brand;
                row.querySelector('.row-name').value = p.name;
                row.querySelector('.row-color').value = p.color;
                row.querySelector('.row-size').value = p.size;
                row.querySelector('.row-base').value = p.basePrice || 0;
                row.querySelector('.row-freight').value = p.freight || 0;
                calcRowPrice(row);
                closeAutocomplete();
            });
            list.appendChild(item);
        });
        input.parentNode.appendChild(list);
        activeDropdown = list;
    }
    document.addEventListener('click', e => { if (!e.target.classList.contains('row-name')) closeAutocomplete(); });

    // =============================================
    //  Add Row
    // =============================================
    function addRow() {
        rowCounter++;
        const type = getType();
        const tbody = $('itemsBody');
        const tr = document.createElement('tr');
        const rowNum = tbody.children.length + 1;

        if (type === 'IN') {
            tr.innerHTML = `
                <td class="row-num">${rowNum}</td>
                <td><input type="text" class="row-brand text-left" placeholder="브랜드" required></td>
                <td class="autocomplete-wrapper"><input type="text" class="row-name text-left" placeholder="상품명 검색..." autocomplete="off" required></td>
                <td><input type="text" class="row-color" placeholder="컬러"></td>
                <td><input type="text" class="row-size" placeholder="사이즈"></td>
                <td><input type="number" class="row-qty" min="1" placeholder="0" required></td>
                <td><input type="number" class="row-base" min="0" placeholder="0"></td>
                <td><input type="number" class="row-freight" min="0" placeholder="0"></td>
                <td><input type="number" class="row-price readonly-input" readonly placeholder="자동계산" required></td>
                <td><button type="button" class="btn-icon btn-remove-row"><i class='bx bx-trash'></i></button></td>
            `;
            // Event bindings
            tr.querySelector('.row-base').addEventListener('input', () => calcRowPrice(tr));
            tr.querySelector('.row-freight').addEventListener('input', () => calcRowPrice(tr));
            tr.querySelector('.row-qty').addEventListener('input', () => updateSummary());
            const nameInput = tr.querySelector('.row-name');
            nameInput.addEventListener('input', () => showAutocomplete(nameInput, tr));
            nameInput.addEventListener('focus', () => { if (nameInput.value.trim()) showAutocomplete(nameInput, tr); });
        } else {
            // OUT mode — select from inventory
            const inStockProducts = products.filter(p => (p.stock || 0) > 0);
            let optionsHtml = '<option value="">— 상품을 선택하세요 —</option>';
            inStockProducts.forEach(p => {
                const label = `${p.brand} — ${p.name} (${p.color} / ${p.size})`;
                optionsHtml += `<option value="${p.id}" data-stock="${p.stock||0}" data-brand="${escHtml(p.brand)}" data-name="${escHtml(p.name)}" data-color="${escHtml(p.color)}" data-size="${escHtml(p.size)}">${escHtml(label)}</option>`;
            });

            tr.innerHTML = `
                <td class="row-num">${rowNum}</td>
                <td><select class="out-select row-product-select" required>${optionsHtml}</select></td>
                <td><div class="stock-badge zero" data-field="stock">—</div></td>
                <td><input type="number" class="row-qty" min="1" placeholder="0" required></td>
                <td><input type="number" class="row-price" min="0" placeholder="단가" required></td>
                <td><button type="button" class="btn-icon btn-remove-row"><i class='bx bx-trash'></i></button></td>
            `;

            // Show stock when product selected
            const select = tr.querySelector('.row-product-select');
            select.addEventListener('change', () => {
                const opt = select.selectedOptions[0];
                const stockBadge = tr.querySelector('.stock-badge');
                if (opt && opt.value) {
                    const stock = parseInt(opt.dataset.stock, 10) || 0;
                    stockBadge.textContent = stock;
                    stockBadge.className = 'stock-badge ' + (stock > 10 ? 'ok' : stock > 0 ? 'low' : 'zero');
                } else {
                    stockBadge.textContent = '—';
                    stockBadge.className = 'stock-badge zero';
                }
                updateSummary();
            });
            tr.querySelector('.row-qty').addEventListener('input', () => updateSummary());
            tr.querySelector('.row-price').addEventListener('input', () => updateSummary());
        }

        // Remove row
        tr.querySelector('.btn-remove-row').addEventListener('click', () => {
            tr.remove();
            renumberRows();
            updateSummary();
            if ($('itemsBody').children.length === 0) addRow();
        });

        tbody.appendChild(tr);
        updateSummary();
    }

    function renumberRows() {
        document.querySelectorAll('#itemsBody tr').forEach((tr, i) => {
            const numCell = tr.querySelector('.row-num');
            if (numCell) numCell.textContent = i + 1;
        });
    }

    // =============================================
    //  Summary
    // =============================================
    function updateSummary() {
        const rows = document.querySelectorAll('#itemsBody tr');
        $('summaryRows').textContent = rows.length;

        let total = 0;
        rows.forEach(row => {
            const qty = parseInt(row.querySelector('.row-qty')?.value, 10) || 0;
            const price = parseInt(row.querySelector('.row-price')?.value, 10) || 0;
            total += qty * price;
        });

        const totalWrap = $('summaryTotalWrap');
        if (total > 0) {
            totalWrap.style.display = '';
            $('summaryTotal').textContent = fmt(total);
        } else {
            totalWrap.style.display = 'none';
        }
    }

    // =============================================
    //  Submit
    // =============================================
    async function handleEntry(e) {
        e.preventDefault();
        const type = getType();
        const txDate = $('txDate').value;
        const supplier = $('fSupplier').value.trim();
        const commonRemarks = $('txRemarks').value.trim();
        const rows = document.querySelectorAll('#itemsBody tr');

        if (rows.length === 0) { showToast('등록할 상품을 추가해 주세요.', 'warning'); return; }

        const submitBtn = $('submitBtn');
        submitBtn.disabled = true;
        const origHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";

        const items = [];

        for (const row of rows) {
            let brand, name, color, size, productId, buyPrice;
            const qty = parseInt(row.querySelector('.row-qty').value, 10) || 0;
            const price = parseInt(row.querySelector('.row-price').value, 10) || 0;
            const basePrice = parseInt(row.querySelector('.row-base')?.value, 10) || 0;
            const freight = parseInt(row.querySelector('.row-freight')?.value, 10) || 0;

            if (!qty || !price) continue;

            if (type === 'OUT') {
                const select = row.querySelector('.row-product-select');
                if (!select || !select.value) continue;
                const opt = select.selectedOptions[0];
                productId = select.value;
                brand = opt.dataset.brand;
                name = opt.dataset.name;
                color = opt.dataset.color;
                size = opt.dataset.size;

                // Client-side stock check
                const stock = parseInt(opt.dataset.stock, 10) || 0;
                if (qty > stock) {
                    showToast(`재고 부족: ${name} (재고 ${stock}, 요청 ${qty})`, 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = origHtml;
                    return;
                }

                const match = products.find(p => p.id === productId);
                buyPrice = match ? match.buyPrice : 0;
                items.push({ type, txDate, supplier, brand, productName: name, color, size, qty, price, basePrice: 0, freight: 0, remarks: commonRemarks, productId, buyPrice });

            } else {
                brand = row.querySelector('.row-brand').value.trim();
                name = row.querySelector('.row-name').value.trim();
                color = row.querySelector('.row-color').value.trim();
                size = row.querySelector('.row-size').value.trim();

                const data = { type, txDate, supplier, brand, productName: name, color, size, qty, price, basePrice, freight, remarks: commonRemarks };

                const match = products.find(p => p.brand === brand && p.name === name && p.color === color && p.size === size);
                if (match) {
                    data.productId = match.id;
                    data.buyPrice = match.buyPrice;
                    items.push(data);
                } else {
                    try {
                        const pRes = await fetch(API_BASE + '/products', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ supplier, brand, name, color, size, stock: 0, buyPrice: price })
                        });
                        const pResult = await pRes.json();
                        data.productId = pResult.id;
                        data.buyPrice = price;
                        products.push({ id: pResult.id, supplier, brand, name, color, size, stock: 0, buyPrice: price });
                        items.push(data);
                    } catch(err) {
                        showToast(`상품 등록 실패: ${name}`, 'error');
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = origHtml;
                        return;
                    }
                }
            }
        }

        if (items.length === 0) {
            showToast('유효한 입력이 없습니다. 수량과 단가를 확인해 주세요.', 'warning');
            submitBtn.disabled = false;
            submitBtn.innerHTML = origHtml;
            return;
        }

        try {
            const res = await fetch(API_BASE + '/transactions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || '등록 실패');

            showToast(`${items.length}건 ${type === 'IN' ? '매입' : '출고'} 등록 완료!`, 'success');

            $('itemsBody').innerHTML = '';
            $('txRemarks').value = '';
            await fetchProducts();
            addRow();
        } catch(e) {
            showToast('등록 실패: ' + e.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origHtml;
        }
    }

    // =============================================
    //  Init
    // =============================================
    document.addEventListener('DOMContentLoaded', async () => {
        await fetchProducts();
        $('txDate').value = new Date().toISOString().split('T')[0];

        document.querySelectorAll('input[name="txType"]').forEach(r => {
            r.addEventListener('change', toggleEntryMode);
        });

        $('btnAddRow').addEventListener('click', addRow);

        $('resetEntry').addEventListener('click', () => {
            $('itemsBody').innerHTML = '';
            $('fSupplier').value = '';
            $('txRemarks').value = '';
            $('txDate').value = new Date().toISOString().split('T')[0];
            $('typeIn').checked = true;
            toggleEntryMode();
        });

        $('entryForm').addEventListener('submit', handleEntry);

        // Init first load
        toggleEntryMode();
    });
})();
