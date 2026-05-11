/**
 * 본사 매입 현황 — 일괄 입출고 등록 폼
 */
(function() {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    let products = [];
    let rowCount = 0;

    const $ = id => document.getElementById(id);
    const escHtml = s => {
        if (s == null) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    };

    function showToast(msg, type = 'info') {
        const c = $('toastContainer');
        if (!c) return;
        const icons = { success:'bx-check-circle', error:'bx-error-circle', warning:'bx-error', info:'bx-info-circle' };
        const t = document.createElement('div');
        t.className = 'toast ' + type;
        t.innerHTML = `<i class='bx ${icons[type]||icons.info}'></i> <span>${escHtml(msg)}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 3000);
    }

    async function fetchProducts() {
        try {
            const res = await fetch(API_BASE + '/products');
            if (res.ok) products = await res.json();
        } catch(e) { console.error('Failed to load products', e); }
    }

    // Toggle IN/OUT View
    function toggleEntryMode() {
        const type = document.querySelector('input[name="txType"]:checked').value;
        const inCols = document.querySelectorAll('.in-only-th, .in-only-td');
        const priceInputs = document.querySelectorAll('.row-price');
        
        inCols.forEach(el => el.style.display = type === 'IN' ? '' : 'none');
        
        priceInputs.forEach(input => {
            if (type === 'IN') {
                input.readOnly = true;
                input.classList.add('readonly-input');
                input.placeholder = '자동계산';
            } else {
                input.readOnly = false;
                input.classList.remove('readonly-input');
                input.placeholder = '매출단가';
            }
        });
        updateSummary();
    }

    // Calculate Price for a row
    function calcRowPrice(row) {
        const type = document.querySelector('input[name="txType"]:checked').value;
        if (type === 'OUT') return;

        const base = parseInt(row.querySelector('.row-base').value, 10) || 0;
        const freight = parseInt(row.querySelector('.row-freight').value, 10) || 0;
        const baseVat = document.querySelector('.col-vat-check[data-target="basePrice"]').checked;
        const freightVat = document.querySelector('.col-vat-check[data-target="freight"]').checked;

        const pureBase = baseVat ? base : Math.round(base / 1.1);
        const pureFreight = freightVat ? freight : Math.round(freight / 1.1);
        
        row.querySelector('.row-price').value = pureBase + pureFreight;
    }

    // Recalculate all rows
    function calcAllRows() {
        document.querySelectorAll('#itemsBody tr').forEach(calcRowPrice);
    }

    // Autocomplete Logic
    let activeDropdown = null;
    function closeAutocomplete() {
        if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
    }
    
    function showAutocomplete(input, row) {
        closeAutocomplete();
        const val = input.value.trim().toLowerCase();
        if (!val) return;

        const brandFilter = row.querySelector('.row-brand').value.trim().toLowerCase();
        
        let matches = products.filter(p => p.name.toLowerCase().includes(val));
        if (brandFilter) {
            matches = matches.filter(p => p.brand.toLowerCase().includes(brandFilter));
        }
        
        // Remove duplicates by name/color/size combo
        const unique = [];
        const seen = new Set();
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
            item.innerHTML = `<b>${escHtml(p.brand)}</b> - ${escHtml(p.name)} <span style="color:var(--gray-500)">(${escHtml(p.color)} / ${escHtml(p.size)})</span>`;
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

    document.addEventListener('click', e => {
        if (!e.target.classList.contains('row-name')) closeAutocomplete();
    });

    // Add Row
    function addRow() {
        rowCount++;
        const type = document.querySelector('input[name="txType"]:checked').value;
        const display = type === 'IN' ? '' : 'none';
        const readonly = type === 'IN' ? 'readonly class="row-price readonly-input" placeholder="자동계산"' : 'class="row-price" placeholder="매출단가"';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><input type="text" class="row-brand" placeholder="브랜드" required></td>
            <td class="autocomplete-wrapper"><input type="text" class="row-name" placeholder="상품명" autocomplete="off" required></td>
            <td><input type="text" class="row-color" placeholder="컬러"></td>
            <td><input type="text" class="row-size" placeholder="사이즈"></td>
            <td><input type="number" class="row-qty" min="1" placeholder="0" required></td>
            <td class="in-only-td" style="display:${display}"><input type="number" class="row-base" min="0" placeholder="0"></td>
            <td class="in-only-td" style="display:${display}"><input type="number" class="row-freight" min="0" placeholder="0"></td>
            <td><input type="number" min="0" ${readonly} required></td>
            <td><button type="button" class="btn-icon btn-remove-row"><i class='bx bx-trash'></i></button></td>
        `;

        // Event Listeners for calc
        tr.querySelector('.row-base').addEventListener('input', () => calcRowPrice(tr));
        tr.querySelector('.row-freight').addEventListener('input', () => calcRowPrice(tr));
        
        // Autocomplete listener
        const nameInput = tr.querySelector('.row-name');
        nameInput.addEventListener('input', () => showAutocomplete(nameInput, tr));
        nameInput.addEventListener('focus', () => showAutocomplete(nameInput, tr));

        // Remove row
        tr.querySelector('.btn-remove-row').addEventListener('click', () => {
            tr.remove();
            updateSummary();
            if ($('itemsBody').children.length === 0) addRow();
        });

        $('itemsBody').appendChild(tr);
        updateSummary();
    }

    function updateSummary() {
        const rows = document.querySelectorAll('#itemsBody tr');
        $('summaryQty').textContent = rows.length;
    }

    // Submit form
    async function handleEntry(e) {
        e.preventDefault();
        
        const type = document.querySelector('input[name="txType"]:checked').value;
        const txDate = $('txDate').value;
        const supplier = $('fSupplier').value.trim();
        const commonRemarks = $('txRemarks').value.trim();
        const rows = document.querySelectorAll('#itemsBody tr');

        if (rows.length === 0) {
            showToast('등록할 상품을 추가해 주세요.', 'warning');
            return;
        }

        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";

        const items = [];

        for (const row of rows) {
            const brand = row.querySelector('.row-brand').value.trim();
            const name = row.querySelector('.row-name').value.trim();
            const color = row.querySelector('.row-color').value.trim();
            const size = row.querySelector('.row-size').value.trim();
            const qty = parseInt(row.querySelector('.row-qty').value, 10) || 0;
            const price = parseInt(row.querySelector('.row-price').value, 10) || 0;
            const basePrice = parseInt(row.querySelector('.row-base').value, 10) || 0;
            const freight = parseInt(row.querySelector('.row-freight').value, 10) || 0;

            if (!qty || !price) continue;

            const data = {
                type, txDate, supplier, brand, productName: name, color, size, qty, price,
                basePrice, freight, remarks: commonRemarks
            };

            // 매칭되는 상품 찾기 (DB 등록용)
            const match = products.find(p => p.brand === brand && p.name === name && p.color === color && p.size === size);

            if (match) {
                data.productId = match.id;
                data.buyPrice = match.buyPrice;
                items.push(data);
            } else if (type === 'IN') {
                // 신규 상품 자동 등록 (병렬 처리하면 ID 충돌날 수 있으니 순차 처리)
                try {
                    const pRes = await fetch(API_BASE + '/products', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ supplier, brand, name, color, size, stock: 0, buyPrice: price })
                    });
                    const pResult = await pRes.json();
                    data.productId = pResult.id;
                    data.buyPrice = price;
                    products.push({ id: pResult.id, supplier, brand, name, color, size, stock: 0, buyPrice: price }); // 임시 추가
                    items.push(data);
                } catch(err) {
                    showToast(`상품 등록 실패: ${name}`, 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 등록하기";
                    return;
                }
            } else {
                showToast(`출고 오류: 등록되지 않은 상품입니다 (${name})`, 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 등록하기";
                return;
            }
        }

        if (items.length === 0) {
            showToast('유효한 상품 입력이 없습니다.', 'warning');
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 등록하기";
            return;
        }

        try {
            const res = await fetch(API_BASE + '/transactions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items })
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || '일괄 등록 실패');
            
            showToast(`${items.length}건 ${type === 'IN' ? '매입' : '출고'} 등록 완료!`, 'success');
            
            // 초기화
            $('itemsBody').innerHTML = '';
            addRow();
            $('txRemarks').value = '';
            fetchProducts();

        } catch(e) {
            showToast('등록 실패: ' + e.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 일괄 등록하기";
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        fetchProducts();
        
        $('txDate').value = new Date().toISOString().split('T')[0];
        addRow();

        // Type toggle
        document.querySelectorAll('input[name="txType"]').forEach(r => {
            r.addEventListener('change', toggleEntryMode);
        });

        // VAT check toggles
        document.querySelectorAll('.col-vat-check').forEach(chk => {
            chk.addEventListener('change', calcAllRows);
        });

        $('btnAddRow').addEventListener('click', addRow);
        
        $('resetEntry').addEventListener('click', () => {
            $('itemsBody').innerHTML = '';
            addRow();
            $('fSupplier').value = '';
            $('txRemarks').value = '';
            $('txDate').value = new Date().toISOString().split('T')[0];
            $('typeIn').checked = true;
            toggleEntryMode();
        });

        $('entryForm').addEventListener('submit', handleEntry);
    });
})();
