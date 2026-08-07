document.addEventListener('DOMContentLoaded', function() {
    // Inputs
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

    let isCalculating = false;

    function formatCurrency(num) {
        return num.toLocaleString('ko-KR');
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
        // 부가세 포함으로 입력했다면 공급가액을 구하기 위해 / 1.1 처리해야 하지만, 
        // 일반적으로 매입원가는 실제 지출금액 또는 매입공급가를 기준으로 합니다.
        // 스마트스토어 마진 계산에서는 통상적으로 부가세를 제외한 순매출과 총매입을 비교합니다.
        let totalBuy = buyPrice + buyShipping + extraCost;
        if (buyVatIncluded) {
            totalBuy = Math.round(totalBuy / 1.1);
        }

        resTotalCost.textContent = formatCurrency(totalBuy) + '원';

        if (salePrice > 0) {
            let totalSale = salePrice + saleShipping;
            let netSale = saleVatIncluded ? Math.round(totalSale / 1.1) : totalSale;
            
            // 수수료: (판매가+배송비)*3.63% + (판매가)*3% => 합산 후 부가세 제외 
            // 단, 네이버페이 결제 수수료와 지식쇼핑 연동 수수료 기준 (VAT 포함 결제금액 기준)
            let commission = Math.round((Math.round(totalSale * 0.0363) + Math.round(salePrice * 0.03)) / 1.1);
            if (!saleVatIncluded) {
                // 입력값이 공급가 기준이라면 결제금액은 * 1.1 임
                let realTotalSale = totalSale * 1.1;
                let realSalePrice = salePrice * 1.1;
                commission = Math.round((Math.round(realTotalSale * 0.0363) + Math.round(realSalePrice * 0.03)) / 1.1);
            }

            let margin = netSale - totalBuy - commission;
            let marginRate = netSale > 0 ? ((margin / netSale) * 100) : 0;

            resCommission.textContent = formatCurrency(commission) + '원';
            resMarginAmount.textContent = formatCurrency(margin) + '원';
            resMarginRate.textContent = marginRate.toFixed(1) + '%';
            
            fldTargetMarginRate.value = marginRate.toFixed(1);

            // 색상 업데이트
            resMarginAmount.style.color = margin >= 0 ? 'var(--primary)' : 'var(--danger)';
            resMarginRate.style.color = margin >= 0 ? 'var(--primary)' : 'var(--danger)';
        } else {
            resCommission.textContent = '0원';
            resMarginAmount.textContent = '0원';
            resMarginRate.textContent = '0.0%';
            resMarginAmount.style.color = 'var(--primary)';
            resMarginRate.style.color = 'var(--primary)';
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
        
        // Update dashboard outputs via forward calculate
        calculateForward();
    }

    // Event Listeners
    // For general inputs, update forward
    [fldBuyPrice, fldBuyShipping, fldExtraCost, chkBuyVat, fldSaleShipping, chkSaleVat].forEach(el => {
        el.addEventListener('input', calculateForward);
        el.addEventListener('change', calculateForward);
    });

    // For sale price, update forward (syncs target margin)
    fldSalePrice.addEventListener('input', calculateForward);

    // For target margin, update reverse (syncs sale price)
    fldTargetMarginRate.addEventListener('input', calculateReverse);

    // Initial calculation
    calculateForward();
});
