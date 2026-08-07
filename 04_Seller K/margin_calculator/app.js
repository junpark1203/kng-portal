document.addEventListener('DOMContentLoaded', function() {
    // Inputs
    const fldProductName = document.getElementById('fldProductName');
    const fldBuyPrice = document.getElementById('fldBuyPrice');
    const fldBuyShipping = document.getElementById('fldBuyShipping');
    const chkBuyVat = document.getElementById('chkBuyVat');
    const fldExtraCost = document.getElementById('fldExtraCost');
    
    const fldSaleShipping = document.getElementById('fldSaleShipping');
    const chkSaleVat = document.getElementById('chkSaleVat');
    const fldTargetMarginRate = document.getElementById('fldTargetMarginRate');
    const fldSalePrice = document.getElementById('fldSalePrice');

    // Outputs
    const resMarginAmount = document.getElementById('resMarginAmount');
    const resMarginRate = document.getElementById('resMarginRate');
    const resCommission = document.getElementById('resCommission');
    const resTotalCost = document.getElementById('resTotalCost');

    // History Table
    const historyTableBody = document.getElementById('historyTableBody');
    const btnSaveHistory = document.getElementById('btnSaveHistory');

    let isCalculating = false;

    // Current state values for saving
    let currentMarginAmount = 0;
    let currentMarginRate = 0;
    let currentCommission = 0;

    function formatCurrency(num) {
        return num.toLocaleString('ko-KR');
    }

    function showSnackbar(message, isError = false) {
        const snackbar = document.getElementById('snackbar');
        snackbar.textContent = message;
        snackbar.style.backgroundColor = isError ? '#ef4444' : '#333';
        snackbar.className = 'show';
        setTimeout(function(){ snackbar.className = snackbar.className.replace('show', ''); }, 3000);
    }

    function calculateForward() {
        if (isCalculating) return;
        isCalculating = true;

        const buyPrice = parseInt(fldBuyPrice.value) || 0;
        const buyShipping = parseInt(fldBuyShipping.value) || 0;
        const extraCost = parseInt(fldExtraCost.value) || 0;
        const buyVatIncluded = chkBuyVat.checked;

        const salePrice = parseInt(fldSalePrice.value) || 0;
        const saleShipping = parseInt(fldSaleShipping.value) || 0;
        const saleVatIncluded = chkSaleVat.checked;

        // 매입 원가 계산
        let totalBuy = buyPrice + buyShipping + extraCost;
        if (buyVatIncluded) {
            totalBuy = Math.round(totalBuy / 1.1);
        }

        resTotalCost.textContent = formatCurrency(totalBuy) + '원';

        if (salePrice > 0) {
            let totalSale = salePrice + saleShipping;
            let netSale = saleVatIncluded ? Math.round(totalSale / 1.1) : totalSale;
            
            // 수수료: 주문연동(3.63%) + 판매수수료(3%)
            let commission = Math.round((Math.round(totalSale * 0.0363) + Math.round(salePrice * 0.03)) / 1.1);
            if (!saleVatIncluded) {
                let realTotalSale = totalSale * 1.1;
                let realSalePrice = salePrice * 1.1;
                commission = Math.round((Math.round(realTotalSale * 0.0363) + Math.round(realSalePrice * 0.03)) / 1.1);
            }

            let margin = netSale - totalBuy - commission;
            let marginRate = netSale > 0 ? ((margin / netSale) * 100) : 0;

            currentMarginAmount = margin;
            currentMarginRate = marginRate;
            currentCommission = commission;

            resCommission.textContent = formatCurrency(commission) + '원';
            resMarginAmount.textContent = formatCurrency(margin) + '원';
            resMarginRate.textContent = marginRate.toFixed(1) + '%';
            
            fldTargetMarginRate.value = marginRate.toFixed(1);

            // 색상 업데이트
            resMarginAmount.style.color = margin >= 0 ? 'var(--mc-primary)' : '#ef4444';
            resMarginRate.style.color = margin >= 0 ? 'var(--mc-primary)' : '#ef4444';
        } else {
            currentMarginAmount = 0;
            currentMarginRate = 0;
            currentCommission = 0;

            resCommission.textContent = '0원';
            resMarginAmount.textContent = '0원';
            resMarginRate.textContent = '0.0%';
            resMarginAmount.style.color = 'var(--mc-primary)';
            resMarginRate.style.color = 'var(--mc-primary)';
        }

        isCalculating = false;
    }

    function calculateReverse() {
        if (isCalculating) return;
        isCalculating = true;

        const targetMarginRate = parseFloat(fldTargetMarginRate.value) || 0;
        
        const buyPrice = parseInt(fldBuyPrice.value) || 0;
        const buyShipping = parseInt(fldBuyShipping.value) || 0;
        const extraCost = parseInt(fldExtraCost.value) || 0;
        const buyVatIncluded = chkBuyVat.checked;

        const saleShipping = parseInt(fldSaleShipping.value) || 0;
        const saleVatIncluded = chkSaleVat.checked;

        let totalBuy = buyPrice + buyShipping + extraCost;
        if (buyVatIncluded) {
            totalBuy = Math.round(totalBuy / 1.1);
        }

        resTotalCost.textContent = formatCurrency(totalBuy) + '원';

        if (totalBuy > 0 && targetMarginRate > 0) {
            const taxDivider = saleVatIncluded ? 1.1 : 1.0;
            const commRate = 0.033;       // 3.63% / 1.1
            const salesRate = 0.02727;    // 3% / 1.1
            const totalCommRate = commRate + salesRate;
            
            let m = targetMarginRate / 100;
            let maxM = 1 - (taxDivider * totalCommRate) - 0.01; 
            if (m > maxM) {
                m = maxM;
                fldTargetMarginRate.value = (m * 100).toFixed(1);
            }

            let num = totalBuy - saleShipping * ((1 - m)/taxDivider - commRate);
            let den = (1 - m)/taxDivider - totalCommRate;
            let recommendedSalePrice = num / den;

            if (recommendedSalePrice > 0) {
                // 10원 단위 반올림
                recommendedSalePrice = Math.round(recommendedSalePrice / 10) * 10;
                fldSalePrice.value = recommendedSalePrice;
            } else {
                fldSalePrice.value = 0;
            }
        }
        
        isCalculating = false;
        
        calculateForward();
    }

    // ── API Functions ──

    async function loadHistory() {
        try {
            const res = await fetch('/api/margin-calculator');
            if (res.ok) {
                const data = await res.json();
                renderHistoryTable(data);
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    function renderHistoryTable(data) {
        if (!data || data.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:#94a3b8; padding:32px;">저장된 시뮬레이션 내역이 없습니다.</td></tr>';
            return;
        }

        historyTableBody.innerHTML = '';
        data.forEach(item => {
            const tr = document.createElement('tr');
            
            const isMarginPositive = item.marginAmount >= 0;
            const marginColor = isMarginPositive ? 'var(--mc-primary)' : '#ef4444';
            
            tr.innerHTML = `
                <td style="text-align:left; font-weight:600; color:#0f172a;">${item.productName}</td>
                <td>${formatCurrency(item.buyPrice)}원</td>
                <td>${formatCurrency(item.buyShipping)}원</td>
                <td style="font-weight:600;">${formatCurrency(item.salePrice)}원</td>
                <td>${formatCurrency(item.saleShipping)}원</td>
                <td style="color:${marginColor}; font-weight:600;">${formatCurrency(item.marginAmount)}원</td>
                <td style="color:${marginColor}; font-weight:600;">${item.marginRate.toFixed(1)}%</td>
                <td style="color:#ef4444;">${formatCurrency(item.commission)}원</td>
                <td style="text-align:center;">
                    <button class="btn-delete" data-id="${item.id}" title="삭제">
                        <i class='bx bx-trash'></i>
                    </button>
                </td>
            `;
            historyTableBody.appendChild(tr);
        });

        // Attach delete events
        document.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async function() {
                const id = this.getAttribute('data-id');
                if (confirm('이 계산 내역을 삭제하시겠습니까?')) {
                    try {
                        const res = await fetch('/api/margin-calculator/' + id, { method: 'DELETE' });
                        if (res.ok) {
                            showSnackbar('삭제되었습니다.');
                            loadHistory();
                        } else {
                            showSnackbar('삭제에 실패했습니다.', true);
                        }
                    } catch(err) {
                        showSnackbar('서버 에러가 발생했습니다.', true);
                    }
                }
            });
        });
    }

    async function saveHistory() {
        const productName = fldProductName.value.trim();
        if (!productName) {
            showSnackbar('계산 내역을 저장하려면 상품명을 입력해주세요.', true);
            fldProductName.focus();
            return;
        }

        const salePrice = parseInt(fldSalePrice.value) || 0;
        if (salePrice <= 0) {
            showSnackbar('판매가를 설정해주세요.', true);
            return;
        }

        const payload = {
            productName: productName,
            buyPrice: parseInt(fldBuyPrice.value) || 0,
            buyShipping: parseInt(fldBuyShipping.value) || 0,
            salePrice: salePrice,
            saleShipping: parseInt(fldSaleShipping.value) || 0,
            marginAmount: currentMarginAmount,
            marginRate: currentMarginRate,
            commission: currentCommission
        };

        const btnIcon = btnSaveHistory.querySelector('i');
        btnIcon.className = 'bx bx-loader-alt bx-spin';
        btnSaveHistory.disabled = true;

        try {
            const res = await fetch('/api/margin-calculator', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showSnackbar('계산 내역이 저장되었습니다.');
                fldProductName.value = ''; // clear product name
                loadHistory();
            } else {
                showSnackbar('저장에 실패했습니다.', true);
            }
        } catch (error) {
            console.error('Error saving history:', error);
            showSnackbar('서버 통신 오류.', true);
        } finally {
            btnIcon.className = 'bx bx-save';
            btnSaveHistory.disabled = false;
        }
    }

    // Event Listeners
    [fldBuyPrice, fldBuyShipping, fldExtraCost, chkBuyVat, fldSaleShipping, chkSaleVat].forEach(el => {
        el.addEventListener('input', calculateForward);
        el.addEventListener('change', calculateForward);
    });

    fldSalePrice.addEventListener('input', calculateForward);
    fldTargetMarginRate.addEventListener('input', calculateReverse);
    
    btnSaveHistory.addEventListener('click', saveHistory);

    // Initial load
    calculateForward();
    loadHistory();
});
