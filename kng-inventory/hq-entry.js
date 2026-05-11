/**
 * 본사 매입 현황 — 입출고 등록 폼
 */
(function() {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000/api/hq'
        : 'https://kng.junparks.com/api/hq';

    let products = [];

    const $ = id => document.getElementById(id);
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

    async function fetchProducts() {
        try {
            const res = await fetch(API_BASE + '/products');
            if (res.ok) products = await res.json();
        } catch(e) { console.error('Failed to load products for matching', e); }
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
        const submitBtn = document.querySelector('.btn-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";

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
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 등록하기";
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
                submitBtn.disabled = false;
                submitBtn.innerHTML = "<i class='bx bx-check'></i> 등록하기";
                return;
            }
        } else {
            showToast('출고하려는 상품이 등록되어 있지 않습니다.', 'warning');
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 등록하기";
            return;
        }

        try {
            const res = await fetch(API_BASE + '/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('등록 실패');
            showToast((type === 'IN' ? '매입' : '출고') + ' 등록 완료!', 'success');
            
            // 등록 성공 후 폼 초기화 (일자와 공급사는 유지)
            const savedDate = $('txDate').value;
            const savedSupplier = $('fSupplier').value;
            $('entryForm').reset();
            $('txDate').value = savedDate;
            $('fSupplier').value = savedSupplier;
            $('typeIn').checked = true;
            toggleEntryMode('IN');

            // 목록 최신화
            fetchProducts();

        } catch(e) {
            showToast('등록 실패: ' + e.message, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<i class='bx bx-check'></i> 등록하기";
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        fetchProducts();
        
        $('txDate').value = new Date().toISOString().split('T')[0];

        // Toggle IN/OUT
        document.querySelectorAll('input[name="txType"]').forEach(r => {
            r.addEventListener('change', e => toggleEntryMode(e.target.value));
        });

        // Auto-calc price
        $('txBasePrice').addEventListener('input', updateCalcPrice);
        $('txFreight').addEventListener('input', updateCalcPrice);
        $('txBaseVat').addEventListener('change', updateCalcPrice);
        $('txFreightVat').addEventListener('change', updateCalcPrice);

        // Reset
        $('resetEntry').addEventListener('click', () => {
            $('entryForm').reset();
            $('txDate').value = new Date().toISOString().split('T')[0];
            $('typeIn').checked = true;
            toggleEntryMode('IN');
        });

        $('entryForm').addEventListener('submit', handleEntry);
    });
})();
