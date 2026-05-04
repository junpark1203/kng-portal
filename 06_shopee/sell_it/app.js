document.addEventListener('DOMContentLoaded', async () => {

    let currentMAImages = [];
    let currentMAVideoUrl = '';
    let maData = []; // cached market analysis items (상단 선언으로 TDZ 방지)
    
    // Global System Settings for Smart Pricing
    let systemSettings = { margin_safe: 40, margin_standard: 30, margin_aggressive: 10 };

    function renderMAImageGrid() {
        const grid = document.getElementById('ma-image-grid');
        const addBtn = document.getElementById('ma-image-add-btn');
        if(!grid || !addBtn) return;
        
        grid.innerHTML = '';
        currentMAImages.forEach((url, index) => {
            const div = document.createElement('div');
            div.style.aspectRatio = '1';
            div.style.position = 'relative';
            div.style.borderRadius = '8px';
            div.style.overflow = 'hidden';
            div.style.border = '1px solid var(--outline-variant)';
            
            const img = document.createElement('img');
            img.src = url;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '4px';
            removeBtn.style.right = '4px';
            removeBtn.style.background = 'rgba(0,0,0,0.5)';
            removeBtn.style.color = '#fff';
            removeBtn.style.border = 'none';
            removeBtn.style.borderRadius = '50%';
            removeBtn.style.width = '24px';
            removeBtn.style.height = '24px';
            removeBtn.style.cursor = 'pointer';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                currentMAImages.splice(index, 1);
                renderMAImageGrid();
            };
            
            div.appendChild(img);
            div.appendChild(removeBtn);
            grid.appendChild(div);
        });
        
        if (currentMAImages.length < 9) {
            grid.appendChild(addBtn);
        }
    }

    function renderMAVideo() {
        const placeholder = document.getElementById('ma-video-placeholder');
        const videoTag = document.getElementById('ma-video-tag');
        const removeBtn = document.getElementById('ma-video-remove-btn');
        if(!placeholder) return;
        
        if (currentMAVideoUrl) {
            videoTag.src = currentMAVideoUrl;
            videoTag.style.display = 'block';
            placeholder.style.display = 'none';
            removeBtn.style.display = 'block';
        } else {
            videoTag.src = '';
            videoTag.style.display = 'none';
            placeholder.style.display = 'flex';
            removeBtn.style.display = 'none';
        }
    }

    /* --- 0. Bulk Actions Event Delegation (At Top for Safety) --- */
    document.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('row-checkbox')) {
            if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
            
            // Toggle highlight on row
            const row = e.target.closest('tr');
            if (row) {
                if (e.target.checked) {
                    row.style.backgroundColor = 'var(--surface-container-high)';
                } else {
                    row.style.backgroundColor = '';
                }
            }
        }
    });

    document.addEventListener('click', (e) => {
        const td = e.target.closest('.td-checkbox');
        if (td && e.target.tagName !== 'INPUT') {
            const cb = td.querySelector('.row-checkbox');
            if (cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // --- Bulk Action Logic Elements ---
    const checkAll = document.getElementById('check-all');
    const btnExportMarket = document.getElementById('btn-export-market');
    const exportMarketSelect = document.getElementById('export-market-select');

    window.updateBulkActionBar = function() {
        const bar = document.getElementById('bulk-action-bar');
        const countEl = document.getElementById('bulk-count');
        if (!bar || !countEl) return;

        const checkboxes = document.querySelectorAll('.row-checkbox');
        const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
        const count = checkedBoxes.length;

        countEl.innerText = count;

        if (count > 0) {
            bar.classList.add('active');
        } else {
            bar.classList.remove('active');
        }

        if (checkAll) {
            checkAll.checked = count > 0 && count === checkboxes.length;
            checkAll.indeterminate = count > 0 && count < checkboxes.length;
        }
    };

    if (checkAll) {
        checkAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
            if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
        });
    }

    if (btnExportMarket && exportMarketSelect) {
        btnExportMarket.addEventListener('click', async () => {
            const selectedMarket = exportMarketSelect.value;
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            
            if (checkedBoxes.length === 0) return;

            // 선택된 상품의 ID를 수집
            const productIds = [];
            checkedBoxes.forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.productId) {
                    productIds.push(row.dataset.productId);
                }
            });

            let appliedRate = 0;
            if (window.latestExchangeRates && window.latestExchangeRates[selectedMarket]) {
                const autoRate = window.latestExchangeRates[selectedMarket];
                const confirmMsg = `선택하신 ${selectedMarket.toUpperCase()} 국가의 최신 환율 (1 단위당 KRW ${autoRate}) 로 적용하시겠습니까?\n\n'취소'를 누르면 수동으로 환율을 입력할 수 있습니다.`;
                if (confirm(confirmMsg)) {
                    appliedRate = autoRate;
                }
            }
            if (!appliedRate) {
                const manualRate = prompt(`수동으로 적용할 환율(1 단위당 KRW)을 입력해 주세요.\n(예: 싱가포르의 경우 SGD 1 = KRW 1050 일때 1050 입력)`, "1000");
                if (manualRate === null) return; // User cancelled the export
                appliedRate = parseFloat(manualRate);
                if (isNaN(appliedRate) || appliedRate <= 0) {
                    alert("올바른 환율 값을 입력해주세요.");
                    return;
                }
            }

            try {
                const result = await api.exportToMarket(productIds, selectedMarket, appliedRate);
                
                // UI 업데이트: 배지 활성화
                checkedBoxes.forEach(cb => {
                    const row = cb.closest('tr');
                    const badge = row.querySelector(`.badge-market[data-market="${selectedMarket}"]`);
                    if (badge) badge.classList.add('active');
                    cb.checked = false;
                });

                if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
                alert(`${productIds.length}개 상품이 ${selectedMarket.toUpperCase()} 마켓으로 전송되었습니다.`);
            } catch (err) {
                alert('마켓 전송 실패: ' + err.message);
            }
        });
    }

    /* --- 1. Global State & Data Store --- */

    // Render Price Calc Grid dynamically (API 기반)
    // ※ nav 클릭 핸들러 및 savedViewId 복원보다 먼저 정의되어야 함
    window.renderPriceCalcGrid = async function(marketCode) {
        const tbody = document.querySelector('#price-calc-table tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중...</td></tr>';

        // Populate control bar presets
        populatePCPresets(marketCode);

        try {
            const exports = await api.getMarketExports(marketCode);
            tbody.innerHTML = '';

            if (exports.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-disabled); padding: 2rem;">이 마켓으로 전송된 상품이 없습니다. Product List에서 먼저 내보내기를 진행해주세요.</td></tr>`;
                return;
            }

            exports.forEach(item => {
                const result = calcProductRow(item);
                const tr = document.createElement('tr');
                tr.className = 'pc-product-row';
                tr.dataset.productId = item.id || item.productId || '';
                // Preset custom badge logic
                const hasCustomPreset = item.feePresetId || item.promoPresetId || item.shipPresetId;
                const presetBadge = hasCustomPreset ? `<span class="badge" style="background: var(--primary-container); color: var(--on-primary-container); font-size: 0.65rem; padding: 2px 6px; border-radius: 4px;"><i class="fa-solid fa-thumbtack"></i> 개별설정</span>` : `<span class="body-sm text-secondary">일괄 설정</span>`;

                // New layout: 10 columns
                const sourcingCostKrw = Number(item.priceKrw) + Number(item.domesticShipping ?? 3000) + Number(item.packagingKrw || 0);
                const sourcingCostSgd = result.costSgd;
                
                const shipSgd = result.sellerShipping;
                const shipKrw = result.exchangeRate > 0 ? shipSgd / result.exchangeRate : 0;
                
                const commissionTotalSgd = result.breakdown.commission.amount + result.breakdown.pgFee.amount + result.breakdown.serviceFee.amount + result.breakdown.productGst.amount + result.breakdown.shippingGst.amount + result.breakdown.payoneer.amount;
                const commissionTotalKrw = result.exchangeRate > 0 ? commissionTotalSgd / result.exchangeRate : 0;
                
                // Promotion
                const promoVoucherR = (result.promo?.voucher || 0) / 100;
                const promoFspCcbR = (result.promo?.fspCcb || 0) / 100;
                const promoTotalSgd = (result.sellingPrice * (result.discountRate/100)) + (result.transactionPrice * promoVoucherR) + (result.transactionPrice * promoFspCcbR);
                const promoTotalKrw = result.exchangeRate > 0 ? promoTotalSgd / result.exchangeRate : 0;

                const salesPriceSgd = result.sellingPrice;
                const salesPriceKrw = result.exchangeRate > 0 ? salesPriceSgd / result.exchangeRate : 0;

                const marginRate = salesPriceSgd > 0 ? (result.marginSgd / salesPriceSgd) * 100 : 0;
                const marginRateWithVat = salesPriceSgd > 0 ? (result.marginWithVatSgd / salesPriceSgd) * 100 : 0;

                tr.innerHTML = `
                    <td class="text-center" style="color: var(--text-secondary);"><span class="body-sm text-secondary">${item.mcode}</span></td>
                    <td><span class="body-sm text-secondary">${item.catKo}</span></td>
                    <td>
                        <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${item.nameKo}">${item.nameKo}</div>
                        <div class="body-sm text-secondary" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;" title="${item.nameEn}">${item.nameEn}</div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;">₩${sourcingCostKrw.toLocaleString()}</div>
                        <div class="body-sm text-secondary">SGD ${sourcingCostSgd.toFixed(2)}</div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;">₩${Math.round(shipKrw).toLocaleString()}</div>
                        <div class="body-sm text-secondary">SGD ${shipSgd.toFixed(2)}</div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;">₩${Math.round(commissionTotalKrw).toLocaleString()}</div>
                        <div class="body-sm text-secondary">SGD ${commissionTotalSgd.toFixed(2)}</div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;">₩${Math.round(promoTotalKrw).toLocaleString()}</div>
                        <div class="body-sm text-secondary">SGD ${promoTotalSgd.toFixed(2)}</div>
                    </td>
                    <td class="text-right">
                        <input type="number" class="form-control input-sales-price" style="text-align: right; width: 100%;" value="${salesPriceSgd.toFixed(2)}" step="0.01">
                        <div class="body-sm text-secondary" style="margin-top: 4px;">₩${Math.round(salesPriceKrw).toLocaleString()}</div>
                    </td>
                    <td class="text-right">
                        <input type="number" class="form-control input-profit" style="text-align: right; width: 100%; color: ${result.marginKrw >= 0 ? 'var(--primary)' : 'var(--error)'};" value="${result.marginKrw}">
                        <div class="body-sm text-secondary" style="margin-top: 4px;">SGD ${result.marginSgd.toFixed(2)}</div>
                        <div style="color: green; font-size: 0.75rem; margin-top: 2px;">+ 환급 ₩${result.vatRefundKrw.toLocaleString()} ➔ 최종 ₩${result.marginWithVatKrw.toLocaleString()}</div>
                    </td>
                    <td class="text-right">
                        <input type="number" class="form-control input-margin-rate" style="text-align: right; width: 100%;" value="${marginRate.toFixed(2)}" step="0.1">
                        <div style="color: green; font-size: 0.75rem; margin-top: 4px;">최종 ${marginRateWithVat.toFixed(2)}%</div>
                    </td>
                `;
                tbody.appendChild(tr);

                // Inline Pricing Cockpit panel (hidden by default)
                const expandTr = document.createElement('tr');
                expandTr.className = 'pc-breakdown-row';
                expandTr.style.display = 'none';
                expandTr.innerHTML = renderPricingCockpit(item, result);
                tbody.appendChild(expandTr);

                // Toggle expand
                tr.addEventListener('click', (e) => {
                    if (e.target.tagName === 'INPUT') return; // Do not expand if clicking on inputs
                    const isOpen = expandTr.style.display !== 'none';
                    // Close all others
                    document.querySelectorAll('.pc-breakdown-row').forEach(r => r.style.display = 'none');
                    document.querySelectorAll('.pc-expand-icon').forEach(i => { i.className = 'fa-solid fa-chevron-right pc-expand-icon'; });
                    if (!isOpen) {
                        expandTr.style.display = '';
                        tr.querySelector('.pc-expand-icon').className = 'fa-solid fa-chevron-down pc-expand-icon';
                    }
                });

                // --- 3-Way Binding Listeners ---
                const inpSales = tr.querySelector('.input-sales-price');
                const inpProfit = tr.querySelector('.input-profit');
                const inpMargin = tr.querySelector('.input-margin-rate');

                let threeWayTimer;
                function updateThreeWay(source) {
                    clearTimeout(threeWayTimer);
                    threeWayTimer = setTimeout(async () => {
                        let newMarginKrw = result.marginKrw;
                        let newSalesSgd = result.sellingPrice;
                        
                        if (source === 'profit') {
                            newMarginKrw = parseFloat(inpProfit.value) || 0;
                            item.targetMarginKrw = newMarginKrw;
                        } else if (source === 'sales') {
                            newSalesSgd = parseFloat(inpSales.value) || 0;
                            let settings = getPCSettings();
                            if (item.feePresetId && presets.find(p => p.id === item.feePresetId)) {
                                const feePre = presets.find(p => p.id === item.feePresetId);
                                settings.fees = { commission: feePre.fees.commission || 0, pg: feePre.fees.pg || 0, service: feePre.fees.service || 0, payoneer: feePre.fees.payoneer || 0, gst: feePre.fees.gst || feePre.fees.special || 0 };
                            }
                            if (item.promoPresetId && promotionPresets.find(p => p.id === item.promoPresetId)) {
                                const promoPre = promotionPresets.find(p => p.id === item.promoPresetId);
                                settings.promo = { discountRate: promoPre.settings.discountRate || 0, adjustmentRate: promoPre.settings.adjustmentRate || 100, voucher: promoPre.settings.voucher || 0, fspCcb: promoPre.settings.fspCcb || 0 };
                            }
                            if (item.shipPresetId && shippingPresets.find(p => p.id === item.shipPresetId)) {
                                const shipPre = shippingPresets.find(p => p.id === item.shipPresetId);
                                settings.shippingSettings = shipPre.settings;
                            }
                            const resSales = calcPricingFromPrice({
                                costKrw: item.priceKrw || 0,
                                domesticShipping: item.domesticShipping ?? 3000,
                                packagingKrw: item.packagingKrw || 0,
                                sellingPriceSgd: newSalesSgd,
                                weight: item.weight || 0,
                                exchangeRate: item.exchangeRate || 0.00086,
                                ...settings
                            });
                            item.targetMarginKrw = resSales.marginKrw;
                        } else if (source === 'margin') {
                            const newMarginRate = parseFloat(inpMargin.value) || 0;
                            let K = newMarginRate / 100;
                            let approxRevenueKrw = result.sellingPrice / (item.exchangeRate || 0.00086);
                            item.targetMarginKrw = Math.round(approxRevenueKrw * K);
                        }

                        // Sync API and refresh UI
                        try {
                            await api.updateMarketExportSettings(item.id || item.exportId, {
                                feePresetId: item.feePresetId,
                                promoPresetId: item.promoPresetId,
                                shipPresetId: item.shipPresetId,
                                targetMarginKrw: item.targetMarginKrw,
                                packagingKrw: item.packagingKrw
                            });
                            window.renderPriceCalcGrid(marketCode);
                        } catch (e) { console.error(e); }
                    }, 800);
                }

                inpSales.addEventListener('input', () => updateThreeWay('sales'));
                inpProfit.addEventListener('input', () => updateThreeWay('profit'));
                inpMargin.addEventListener('input', () => updateThreeWay('margin'));

                // --- Inline Cockpit Handlers ---
                const marginInput = expandTr.querySelector('.pc-margin-input');
                const packagingInput = expandTr.querySelector('.pc-packaging-input');
                const feeSel = expandTr.querySelector('.pc-fee-override');
                const promoSel = expandTr.querySelector('.pc-promo-override');
                const shipSel = expandTr.querySelector('.pc-ship-override');
                const btnToggleBreakdown = expandTr.querySelector('.btn-toggle-breakdown');
                const breakdownContainer = expandTr.querySelector('.cockpit-breakdown-container');
                const btnSave = expandTr.querySelector('.btn-save-settings');

                let _pcDebounce = null;

                function recalcCockpit() {
                    const newMargin = parseFloat(marginInput?.value) || 0;
                    const newPkg = parseFloat(packagingInput?.value) || 0;
                    
                    item.feePresetId = feeSel.value || null;
                    item.promoPresetId = promoSel.value || null;
                    item.shipPresetId = shipSel.value || null;
                    item.targetMarginKrw = newMargin;
                    item.packagingKrw = newPkg;

                    const newResult = calcProductRow(item);

                    // Update summary row cells (not fully redrawing to avoid focus loss, but 3-way will redraw everything anyway)
                    const cells = tr.querySelectorAll('td');
                    // Cells: 0:Icon, 1:Cat, 2:Name, 3:Cost, 4:Ship, 5:Comm, 6:Promo, 7:Sales(Input), 8:Profit(Input), 9:Margin(Input)
                    if (cells[7]) {
                        const i = cells[7].querySelector('input');
                        if(i) i.value = newResult.sellingPrice.toFixed(2);
                    }
                    if (cells[8]) {
                        const i = cells[8].querySelector('input');
                        if(i) i.value = newResult.marginKrw;
                    }
                    if (cells[9]) {
                        const i = cells[9].querySelector('input');
                        const mr = newResult.sellingPrice > 0 ? (newResult.marginSgd / newResult.sellingPrice) * 100 : 0;
                        if(i) i.value = mr.toFixed(2);
                    }

                    // Update Cockpit Results
                    const cockpitP = expandTr.querySelector('.cockpit-P');
                    const cockpitMarginKrw = expandTr.querySelector('.cockpit-margin-krw');
                    const cockpitBase = expandTr.querySelector('.cockpit-base-margin');
                    const cockpitVat = expandTr.querySelector('.cockpit-vat-refund');
                    
                    if (cockpitP) cockpitP.innerText = newResult.sellingPrice.toFixed(2);
                    if (cockpitMarginKrw) cockpitMarginKrw.innerText = newResult.marginWithVatKrw.toLocaleString();
                    if (cockpitBase) cockpitBase.innerText = newResult.marginKrw.toLocaleString();
                    if (cockpitVat) cockpitVat.innerText = newResult.vatRefundKrw.toLocaleString();

                    // Update Breakdown
                    if (breakdownContainer) breakdownContainer.innerHTML = renderBreakdownPanel(item, newResult);
                }

                function debouncedRecalc() {
                    clearTimeout(_pcDebounce);
                    _pcDebounce = setTimeout(recalcCockpit, 300);
                }

                if (marginInput) marginInput.addEventListener('input', debouncedRecalc);
                if (packagingInput) packagingInput.addEventListener('input', debouncedRecalc);
                if (feeSel) feeSel.addEventListener('change', debouncedRecalc);
                if (promoSel) promoSel.addEventListener('change', debouncedRecalc);
                if (shipSel) shipSel.addEventListener('change', debouncedRecalc);

                // Smart Pricing Buttons
                expandTr.querySelectorAll('.btn-smart-calc').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const rate = parseFloat(btn.dataset.rate) / 100;
                        const cost = (item.priceKrw || 0) + (item.domesticShipping ?? 3000) + (parseFloat(packagingInput?.value) || 0);
                        const target = Math.round(cost * rate);
                        if (marginInput) marginInput.value = target;
                        recalcCockpit();
                    });
                });

                // Toggle Breakdown
                if (btnToggleBreakdown) {
                    btnToggleBreakdown.addEventListener('click', () => {
                        const isHidden = breakdownContainer.style.display === 'none';
                        breakdownContainer.style.display = isHidden ? 'block' : 'none';
                    });
                }

                // Save Settings
                if (btnSave) {
                    btnSave.addEventListener('click', async () => {
                        try {
                            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...';
                            await api.updateMarketExportSettings(item.id, {
                                feePresetId: item.feePresetId,
                                promoPresetId: item.promoPresetId,
                                shipPresetId: item.shipPresetId,
                                targetMarginKrw: item.targetMarginKrw,
                                packagingKrw: item.packagingKrw
                            });
                            showToast('개별 설정이 저장되었습니다.', 'success');
                            btnSave.innerHTML = '<i class="fa-solid fa-check"></i> 저장 완료';
                            setTimeout(() => {
                                btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 설정 저장';
                                window.renderPriceCalcGrid(marketCode); // Re-render to update badges
                            }, 1000);
                        } catch (err) {
                            showToast('저장 실패: ' + err.message, 'error');
                            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> 설정 저장';
                        }
                    });
                }
            });
        } catch (err) {
            console.error('[PriceCalcGrid] 로드 실패:', err.message);
            tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--error); padding: 2rem;">데이터 로드 실패: ${err.message}</td></tr>`;
        }
    };

    // Helper: Get current preset settings from control bar
    function getPCSettings() {
        const feePresetId = document.getElementById('pc-fee-preset')?.value;
        const promoPresetId = document.getElementById('pc-promo-preset')?.value;
        const shipPresetId = document.getElementById('pc-ship-preset')?.value;
        const exchangeRate = parseFloat(document.getElementById('pc-exchange-rate')?.value) || 0.00086;

        const feePre = presets.find(p => p.id === feePresetId);
        const promoPre = promotionPresets.find(p => p.id === promoPresetId);
        const shipPre = shippingPresets.find(p => p.id === shipPresetId);

        return {
            exchangeRate,
            fees: feePre ? {
                commission: feePre.fees.commission || 0,
                pg: feePre.fees.pg || 0,
                service: feePre.fees.service || 0,
                payoneer: feePre.fees.payoneer || 0,
                gst: feePre.fees.gst || feePre.fees.special || 0
            } : { commission: 15.35, pg: 3, service: 0.8, payoneer: 1.2, gst: 9 },
            promo: promoPre ? {
                discountRate: promoPre.settings.discountRate || 0,
                adjustmentRate: promoPre.settings.adjustmentRate || 100,
                voucher: promoPre.settings.voucher || 0,
                fspCcb: promoPre.settings.fspCcb || 0,
            } : { discountRate: 30, adjustmentRate: 130 },
            shippingSettings: shipPre ? shipPre.settings : { tier1Base: 2.23, tier2Add: 0.08, tier3Base: 9.83, tier3Add: 0.70, rebate: 1.83 }
        };
    }

    // Helper: Calculate one product row
    function calcProductRow(item) {
        let settings = getPCSettings();
        
        // Override with individual presets if they exist
        if (item.feePresetId && presets.find(p => p.id === item.feePresetId)) {
            const feePre = presets.find(p => p.id === item.feePresetId);
            settings.fees = {
                commission: feePre.fees.commission || 0,
                pg: feePre.fees.pg || 0,
                service: feePre.fees.service || 0,
                payoneer: feePre.fees.payoneer || 0,
                gst: feePre.fees.gst || feePre.fees.special || 0
            };
        }
        if (item.promoPresetId && promotionPresets.find(p => p.id === item.promoPresetId)) {
            const promoPre = promotionPresets.find(p => p.id === item.promoPresetId);
            settings.promo = {
                discountRate: promoPre.settings.discountRate || 0,
                adjustmentRate: promoPre.settings.adjustmentRate || 100,
                voucher: promoPre.settings.voucher || 0,
                fspCcb: promoPre.settings.fspCcb || 0,
            };
        }
        if (item.shipPresetId && shippingPresets.find(p => p.id === item.shipPresetId)) {
            const shipPre = shippingPresets.find(p => p.id === item.shipPresetId);
            settings.shippingSettings = shipPre.settings;
        }

        const targetMarginKrw = item.targetMarginKrw || 12000;
        const exportRate = item.exchangeRate || 0.00086; // Fallback if missing
        return calcPricingFromMargin({
            costKrw: item.priceKrw || 0,
            domesticShipping: item.domesticShipping ?? 3000,
            packagingKrw: item.packagingKrw || 0,
            targetMarginKrw,
            weight: item.weight || 0,
            exchangeRate: exportRate,
            ...settings
        });
    }

    // Helper: Render Pricing Cockpit UI
    function renderPricingCockpit(item, result) {
        const feeOptions = `<option value="">상단 일괄 설정 따름</option>` + presets.filter(p => p.market === currentMarketContext).map(p => `<option value="${p.id}" ${item.feePresetId===p.id?'selected':''}>${p.name}</option>`).join('');
        const promoOptions = `<option value="">상단 일괄 설정 따름</option>` + promotionPresets.filter(p => p.market === currentMarketContext).map(p => `<option value="${p.id}" ${item.promoPresetId===p.id?'selected':''}>${p.name}</option>`).join('');
        const shipOptions = `<option value="">상단 일괄 설정 따름</option>` + shippingPresets.filter(p => p.market === currentMarketContext).map(p => `<option value="${p.id}" ${item.shipPresetId===p.id?'selected':''}>${p.name}</option>`).join('');

        return `
        <td colspan="7" style="padding: 1.5rem; background: var(--surface-container-lowest); border-bottom: 2px solid var(--outline-variant);">
            <div style="display: flex; gap: 2rem;">
                <!-- Left: Setup -->
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                        <div class="label-md" style="color: var(--secondary);"><i class="fa-solid fa-wand-magic-sparkles"></i> 스마트 추천 마진</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap;">
                        <button class="btn-outline btn-sm btn-smart-calc" data-rate="${systemSettings.margin_safe}" style="white-space: nowrap;">🛡️ 안정형 (${systemSettings.margin_safe}%)</button>
                        <button class="btn-outline btn-sm btn-smart-calc" data-rate="${systemSettings.margin_standard}" style="white-space: nowrap;">⚖️ 권장형 (${systemSettings.margin_standard}%)</button>
                        <button class="btn-outline btn-sm btn-smart-calc" data-rate="${systemSettings.margin_aggressive}" style="white-space: nowrap;">🚀 공격형 (${systemSettings.margin_aggressive}%)</button>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                        <div>
                            <label class="label-sm text-secondary" style="display: block; margin-bottom: 6px;">개별 수수료 프리셋</label>
                            <select class="form-control form-control-sm pc-fee-override" style="width: 100%;">${feeOptions}</select>
                        </div>
                        <div>
                            <label class="label-sm text-secondary" style="display: block; margin-bottom: 6px;">개별 프로모션</label>
                            <select class="form-control form-control-sm pc-promo-override" style="width: 100%;">${promoOptions}</select>
                        </div>
                        <div>
                            <label class="label-sm text-secondary" style="display: block; margin-bottom: 6px;">개별 배송비 요율</label>
                            <select class="form-control form-control-sm pc-ship-override" style="width: 100%;">${shipOptions}</select>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 180px;">
                            <label class="label-sm text-secondary" style="display: block; margin-bottom: 6px;">목표 순수익 (KRW)</label>
                            <input type="number" class="form-control pc-margin-input" value="${item.targetMarginKrw || 12000}" style="width: 100%;">
                        </div>
                        <div style="flex: 1; min-width: 180px;">
                            <label class="label-sm text-secondary" style="display: block; margin-bottom: 6px;">추가 포장비 (KRW)</label>
                            <input type="number" class="form-control pc-packaging-input" value="${item.packagingKrw || 0}" style="width: 100%;">
                        </div>
                    </div>
                    
                    <div style="margin-top: 1.5rem; display: flex; gap: 0.75rem;">
                        <button class="btn-primary btn-save-settings"><i class="fa-solid fa-floppy-disk"></i> 설정 저장</button>
                        <button class="btn-secondary btn-toggle-breakdown"><i class="fa-solid fa-magnifying-glass-chart"></i> 산식 계산 내역 보기</button>
                    </div>
                </div>
                
                <!-- Right: Results Dashboard -->
                <div style="width: 280px; padding: 1.5rem; background: var(--surface-container-low); border-radius: 12px; border: 1px solid var(--outline-variant); display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div class="label-md text-secondary" style="margin-bottom: 0.25rem;">판매자 지정가 (P)</div>
                        <div class="display-sm" style="color: var(--primary); font-weight: 700;">SGD <span class="cockpit-P">${result.sellingPrice.toFixed(2)}</span></div>
                    </div>
                    <div>
                        <div class="label-md text-secondary" style="margin-bottom: 0.25rem;">최종 순수익 (VAT 환급 포함)</div>
                        <div class="display-sm" style="color: var(--primary); font-weight: 700;">₩<span class="cockpit-margin-krw">${result.marginWithVatKrw.toLocaleString()}</span></div>
                        <div class="body-sm text-secondary" style="margin-top: 0.25rem;">기본 ₩<span class="cockpit-base-margin">${result.marginKrw.toLocaleString()}</span> + 환급 ₩<span class="cockpit-vat-refund">${result.vatRefundKrw.toLocaleString()}</span></div>
                    </div>
                </div>
            </div>
            <div class="cockpit-breakdown-container" style="display: none; margin-top: 1.5rem; border-top: 1px dashed var(--outline-variant); padding-top: 1.5rem;">
                ${renderBreakdownPanel(item, result)}
            </div>
        </td>
        `;
    }

    // Helper: Render fee breakdown HTML
    function renderBreakdownPanel(item, result) {
        const bd = result.breakdown;
        const rows = Object.values(bd).map(f => `
            <tr>
                <td>${f.label}</td>
                <td class="text-right body-sm text-secondary">${f.rate}%</td>
                <td class="body-sm text-secondary">${f.baseLabel}</td>
                <td class="text-right body-sm">${f.baseValue.toFixed(2)}</td>
                <td class="text-right" style="font-weight: 600;">SGD ${f.amount.toFixed(2)}</td>
            </tr>
        `).join('');

        return `
        <div class="pc-breakdown-panel">
            <div class="pc-breakdown-grid">
                <div class="pc-breakdown-section">
                    <h4 class="label-md" style="color: var(--primary); margin-bottom: 0.75rem;"><i class="fa-solid fa-receipt"></i> 비용 분해</h4>
                    <table class="pc-breakdown-table">
                        <thead><tr><th>항목</th><th class="text-right">비율</th><th>산식 Base</th><th class="text-right">Base값</th><th class="text-right">금액</th></tr></thead>
                        <tbody>
                            <tr style="background: var(--surface-container-low);">
                                <td>원가 (SGD)</td>
                                <td class="text-right body-sm text-secondary">—</td>
                                <td class="body-sm text-secondary">₩${result.costKrw.toLocaleString()} × ${result.exchangeRate}</td>
                                <td class="text-right body-sm">—</td>
                                <td class="text-right" style="font-weight: 600;">SGD ${result.costSgd.toFixed(2)}</td>
                            </tr>
                            <tr style="background: var(--surface-container-low);">
                                <td>셀러 배송비</td>
                                <td class="text-right body-sm text-secondary">—</td>
                                <td class="body-sm text-secondary">${item.weight}g → 원래운임 ${result.grossShipping.toFixed(2)} − 감면 ${result.rebate.toFixed(2)}</td>
                                <td class="text-right body-sm">—</td>
                                <td class="text-right" style="font-weight: 600;">SGD ${result.sellerShipping.toFixed(2)}</td>
                            </tr>
                            ${rows}
                        </tbody>
                        <tfoot>
                            <tr style="border-top: 2px solid var(--outline-variant);">
                                <td colspan="4" style="font-weight: 600;">총 비용 (원가+배송+수수료)</td>
                                <td class="text-right" style="font-weight: 700;">SGD ${(result.costSgd + result.sellerShipping + result.totalFees).toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td colspan="4" style="font-weight: 600; color: var(--primary);">정산 마진</td>
                                <td class="text-right" style="font-weight: 700; color: ${result.marginSgd >= 0 ? 'var(--primary)' : 'var(--error)'};">SGD ${result.marginSgd.toFixed(2)} (₩${result.marginKrw.toLocaleString()})</td>
                            </tr>
                            <tr style="background: var(--surface-container-low); border-top: 1px dashed var(--outline-variant);">
                                <td colspan="4"><span style="color: var(--secondary);"><i class="fa-solid fa-money-bill-transfer"></i> 부가세 환급 예상액 (수출 면세)</span></td>
                                <td class="text-right" style="font-weight: 600; color: var(--secondary);">+ SGD ${result.vatRefundSgd.toFixed(2)} (₩${result.vatRefundKrw.toLocaleString()})</td>
                            </tr>
                            <tr>
                                <td colspan="4" style="font-weight: 700; color: var(--primary); font-size: 1.05rem;">환급 포함 최종 마진</td>
                                <td class="text-right" style="font-weight: 800; color: var(--primary); font-size: 1.05rem;">SGD ${result.marginWithVatSgd.toFixed(2)} (₩${result.marginWithVatKrw.toLocaleString()})</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div class="pc-breakdown-section">
                    <h4 class="label-md" style="color: var(--secondary); margin-bottom: 0.75rem;"><i class="fa-solid fa-sliders"></i> 가격 조정</h4>
                    <div class="pc-input-group">
                        <label class="label-sm text-secondary">목표 마진 (KRW)</label>
                        <input type="number" class="form-control form-control-sm pc-margin-input" value="${item.targetMarginKrw || 12000}" data-product-id="${item.id || item.productId || ''}" style="font-weight: 600;">
                    </div>
                    <div class="pc-input-group" style="margin-top: 0.5rem;">
                        <label class="label-sm text-secondary">포장비 (KRW)</label>
                        <input type="number" class="form-control form-control-sm pc-packaging-input" value="0" data-product-id="${item.id || item.productId || ''}" style="font-weight: 600;">
                    </div>
                    <div class="pc-price-summary">
                        <div class="pc-price-row"><span class="text-secondary">판매자 지정가</span><span style="font-weight: 700; font-size: 1.1rem;">SGD ${result.sellingPrice.toFixed(2)}</span></div>
                        <div class="pc-price-row"><span class="text-secondary">구매자 노출가</span><span>SGD ${result.buyerDisplayPrice.toFixed(2)}</span></div>
                        <div class="pc-price-row"><span class="text-secondary">할인 거래가 (TP)</span><span>SGD ${result.transactionPrice.toFixed(2)}</span></div>
                        <div class="pc-price-row"><span class="text-secondary">수익 (Revenue)</span><span>SGD ${result.revenue.toFixed(2)}</span></div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    // Populate control bar preset selectors
    function populatePCPresets(marketCode) {
        const code = marketCode || currentMarketContext;
        const feeSel = document.getElementById('pc-fee-preset');
        const promoSel = document.getElementById('pc-promo-preset');
        const shipSel = document.getElementById('pc-ship-preset');
        const summaryBar = document.getElementById('pc-summary-bar');
        const exchangeRateEl = document.getElementById('pc-exchange-rate');

        if (feeSel) {
            feeSel.innerHTML = presets.filter(p => p.market === code).map(p =>
                `<option value="${p.id}" ${p.isDefault ? 'selected' : ''}>${p.name}</option>`
            ).join('') || '<option value="">프리셋 없음</option>';
        }
        if (promoSel) {
            promoSel.innerHTML = promotionPresets.filter(p => p.market === code).map(p =>
                `<option value="${p.id}" ${p.isDefault ? 'selected' : ''}>${p.name}</option>`
            ).join('') || '<option value="">프리셋 없음</option>';
        }
        if (shipSel) {
            shipSel.innerHTML = shippingPresets.filter(p => p.market === code).map(p =>
                `<option value="${p.id}" ${p.isDefault ? 'selected' : ''}>${p.name}</option>`
            ).join('') || '<option value="">프리셋 없음</option>';
        }

        // Auto-fill exchange rate from latestExchangeRates
        if (exchangeRateEl && window.latestExchangeRates) {
            const currencyMap = { sg: 'SGD', my: 'MYR', tw: 'TWD', th: 'THB', ph: 'PHP', vn: 'VND', br: 'BRL', mx: 'MXN' };
            const currency = currencyMap[code];
            if (currency && window.latestExchangeRates[currency]) {
                exchangeRateEl.value = window.latestExchangeRates[currency];
            }
        }

        // Update summary bar
        const s = getPCSettings();
        if (summaryBar) {
            const rateDisplay = exchangeRateEl ? exchangeRateEl.value : '—';
            summaryBar.innerHTML = `
                <span class="pc-tag">Commission ${s.fees.commission}%</span>
                <span class="pc-tag">PG ${s.fees.pg}%</span>
                <span class="pc-tag">Service ${s.fees.service}%</span>
                <span class="pc-tag">Payoneer ${s.fees.payoneer}%</span>
                <span class="pc-tag">GST ${s.fees.gst}%</span>
                <span class="pc-tag">할인 ${s.promo.discountRate}%</span>
                <span class="pc-tag">조정율 ${s.promo.adjustmentRate}%</span>
                <span class="pc-tag">환율 ${rateDisplay}</span>
            `;
        }

        // Re-render on change
        [feeSel, promoSel, shipSel, exchangeRateEl].forEach(el => {
            if (el && !el.dataset.pcBound) {
                el.addEventListener('change', () => window.renderPriceCalcGrid(currentMarketContext));
                el.dataset.pcBound = 'true';
            }
        });
    }

    /* --- 1. Sidebar Navigation (SPA Routing) --- */
    let currentMarketContext = 'sg'; // Default market context
    const navItems = document.querySelectorAll('.sidebar .nav-item');
    const viewSections = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('page-title');
    const genericTitle = document.getElementById('generic-title');

    // Accordion for nav groups
    const navGroupTitles = document.querySelectorAll('.sidebar .nav-group-title');
    navGroupTitles.forEach(title => {
        title.addEventListener('click', () => {
            const navGroup = title.closest('.nav-group');
            if (navGroup) {
                navGroup.classList.toggle('expanded');
            }
        });
    });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked nav item
            item.classList.add('active');

            // Get target view id
            const viewId = item.getAttribute('data-view');
            
            // Save to localStorage for persistence
            localStorage.setItem('activeViewId', viewId);

            // Update Page Title Text
            const menuText = item.querySelector('a').innerText.trim();
            pageTitle.innerText = menuText;

            // Hide all views
            viewSections.forEach(section => {
                section.classList.remove('active');
            });

            // Handle Price Calculation views dynamically
            if (viewId.startsWith('price-calc-')) {
                const targetViewElement = document.getElementById('view-price-calc-container');
                const marketCode = viewId.split('-')[2];
                currentMarketContext = marketCode;
                document.getElementById('price-calc-title').innerText = `${marketCode.toUpperCase()} Market Details`;
                targetViewElement.classList.add('active');
                if (typeof window.renderPriceCalcGrid === 'function') {
                    window.renderPriceCalcGrid(marketCode);
                }
                return;
            }

            // Handle Settings views dynamically
            if (viewId.startsWith('settings-')) {
                const targetViewElement = document.getElementById('view-settings');
                const marketCode = viewId.split('-')[1];
                currentMarketContext = marketCode;
                document.getElementById('settings-preset-form-title').innerText = `${marketCode.toUpperCase()} 새 프리셋 만들기`;
                document.getElementById('settings-promotion-form-title').innerText = `${marketCode.toUpperCase()} 새 프로모션 만들기`;
                document.getElementById('settings-shipping-form-title').innerText = `${marketCode.toUpperCase()} 새 배송비 요율 만들기`;
                targetViewElement.classList.add('active');
                if (typeof renderSettingsPresetTable === 'function') {
                    renderSettingsPresetTable();
                    if (typeof clearSettingsPresetForm === 'function') clearSettingsPresetForm();
                }
                if (typeof renderSettingsPromotionTable === 'function') {
                    renderSettingsPromotionTable();
                    if (typeof clearSettingsPromotionForm === 'function') clearSettingsPromotionForm();
                }
                if (typeof renderSettingsShippingTable === 'function') {
                    renderSettingsShippingTable();
                    if (typeof clearSettingsShippingForm === 'function') clearSettingsShippingForm();
                }
                return;
            }

            const targetViewId = 'view-' + viewId;
            const targetViewElement = document.getElementById(targetViewId);

            // Show target view if it exists, otherwise show generic view
            if (targetViewElement) {
                targetViewElement.classList.add('active');
            } else {
                const genericView = document.getElementById('view-generic');
                genericTitle.innerText = menuText + " Module";
                genericView.classList.add('active');
            }
        });
    });


    /* --- 1.5. Settings Tabs Switching --- */
    const settingsTabs = document.querySelectorAll('#settings-tabs .tab');
    const settingsTabContents = document.querySelectorAll('.settings-tab-content');

    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            settingsTabs.forEach(t => t.classList.remove('active'));
            settingsTabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            
            const targetId = 'settings-tab-' + tab.getAttribute('data-settings-tab');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

    /* --- 2. Market Tabs Switching --- */
    const marketTabs = document.querySelectorAll('#market-tabs .tab');
    const currentMarketDisplay = document.getElementById('current-market-display');

    marketTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active from all tabs
            marketTabs.forEach(t => t.classList.remove('active'));
            
            // Add active to clicked tab
            tab.classList.add('active');

            // Update content display
            const marketName = tab.getAttribute('data-market');
            if(currentMarketDisplay) {
                currentMarketDisplay.innerText = marketName;
            }

            // TODO: Later, dispatch an event here so the calculator module
            // knows to re-render with the new market's JSON data.
        });
    });

    /* --- 3. Product Management Code Generator --- */
    /**
     * Generates a management code based on the given date string and sequence number.
     * Rule: Year(2 digits encoded) + Month(encoded) + Day(2 digits) + Sequence(3 digits)
     * Year encoding: 1-K, 2-C, 3-Y, 4-J, 5-E, 6-G, 7-B, 8-T, 9-U, 0-0
     * Month encoding: 1:J1, 2:F1, 3:M1, 4:A1, 5:M2, 6:J2, 7:J3, 8:A2, 9:S1, 10:O1, 11:N1, 12:D1
     */
    window.generateManagementCode = function(dateString, sequenceNumber) {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;

        // Year Mapping
        const yearMap = { '1': 'K', '2': 'C', '3': 'Y', '4': 'J', '5': 'E', '6': 'G', '7': 'B', '8': 'T', '9': 'U', '0': '0' };
        const year = date.getFullYear().toString();
        const lastTwoYear = year.slice(-2);
        const encodedYear = (yearMap[lastTwoYear[0]] || lastTwoYear[0]) + (yearMap[lastTwoYear[1]] || lastTwoYear[1]);

        // Month Mapping
        const monthMap = {
            1: 'J1', 2: 'F1', 3: 'M1', 4: 'A1', 5: 'M2', 6: 'J2',
            7: 'J3', 8: 'A2', 9: 'S1', 10: 'O1', 11: 'N1', 12: 'D1'
        };
        const encodedMonth = monthMap[date.getMonth() + 1];

        // Day and Sequence (Padded)
        const day = date.getDate().toString().padStart(2, '0');
        const seq = sequenceNumber.toString().padStart(3, '0');

        return `${encodedYear}${encodedMonth}-${day}-${seq}`;
    };

    /* --- 4. Product List & Drawer Logic --- */
    let productList = [];
    let marketExportsMap = {}; // { productId: [{marketCode, exportDate}] }

    // API에서 데이터 로드
    try {
        productList = await api.getProducts();
        marketExportsMap = await api.getAllMarketExports();
        console.log(`[INIT] ${productList.length}개 상품 로드 완료`);
    } catch (err) {
        console.error('[INIT] API 데이터 로드 실패:', err.message);
        productList = [];
        marketExportsMap = {};
    }

    function escapeHtmlAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderProductListTable() {
        const tbody = document.querySelector('#pl-table tbody');
        if (!tbody) return;

        if (productList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-disabled);">등록된 상품이 없습니다.</td></tr>';
            return;
        }

        // Sort by date descending (optional)
        // productList.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = productList.map(p => {
            let catEn1 = p.catEn;
            let catEn2 = '';
            if(p.catEn.includes(' > ')) {
                const parts = p.catEn.split(' > ');
                catEn1 = parts[0] + ' >';
                catEn2 = parts[1];
            }
            const priceUsd = (p.priceKrw / (p.rate || 1)).toFixed(2);

            // 마켓 전송 상태 확인 (API 데이터 기반)
            const exports = marketExportsMap[p.id] || [];
            const exportedMarkets = exports.map(e => e.marketCode);
            const marketCodes = ['sg','my','tw','th','ph','vn','br','mx'];
            const badgesHtml = marketCodes.map(code => {
                const isActive = exportedMarkets.includes(code) ? ' active' : '';
                return `<span class="badge-market${isActive}" data-market="${code}">${code.toUpperCase()}</span>`;
            }).join('\n                            ');

            return `
                <tr class="product-row" style="cursor: pointer;" data-mcode="${p.mcode}" data-product-id="${p.id}" data-rate-date="${p.rateDate || ''}">
                    <td style="text-align: center;" class="td-checkbox">
                        <input type="checkbox" class="row-checkbox">
                    </td>
                    <td>
                        <div style="font-weight: 600;" class="prod-date">${p.date}</div>
                        <div class="body-sm text-secondary prod-mcode">${p.mcode}</div>
                    </td>
                    <td data-cat-en="${escapeHtmlAttr(p.catEn)}" data-cat-ko="${escapeHtmlAttr(p.catKo)}">
                        <div class="prod-cat-en-1">${catEn1}</div>
                        <div class="prod-cat-en-2">${catEn2}</div>
                        <div class="body-sm text-secondary prod-cat-ko" style="margin-top: 4px;">${p.catKo}</div>
                    </td>
                    <td>
                        <div style="font-weight: 600;" class="prod-name-en">${p.nameEn}</div>
                        <div class="body-sm text-secondary prod-name-ko">${p.nameKo}</div>
                    </td>
                    <td>
                        <div class="market-badges">
                            <span class="badge-empty" style="color: var(--text-disabled); font-size: 0.875rem; padding: 4px;">-</span>
                            ${badgesHtml}
                        </div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;" class="prod-price-krw">KRW ${Number(p.priceKrw).toLocaleString()}</div>
                        <div class="body-sm text-secondary prod-price-usd">USD ${priceUsd}</div>
                    </td>
                    <td class="text-right">
                        <div class="prod-rate">${p.rate}</div>
                        <div class="body-sm text-secondary prod-weight">${p.weight}g</div>
                    </td>
                    <td>
                        <div><a href="${p.link || '#'}" class="link-btn prod-link" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${p.link ? '링크' : '-'}</a></div>
                    </td>
                    <td>
                        <div class="body-sm text-secondary prod-note">${p.note || '-'}</div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach row click events
        document.querySelectorAll('#view-product-list .product-row').forEach(row => {
            attachRowClickEvent(row);
        });
    }
    const btnAddProduct = document.getElementById('btn-add-product');
    const drawerOverlay = document.getElementById('add-product-overlay');
    const drawer = document.getElementById('add-product-drawer');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const btnCancelDrawer = document.getElementById('btn-cancel-drawer');
    const btnSaveProduct = document.getElementById('btn-save-product');
    const addProductForm = document.getElementById('add-product-form');
    
    // Inputs
    const inputDate = document.getElementById('input-date');
    const inputMcode = document.getElementById('input-mcode');
    const inputCategorySearch = document.getElementById('input-category-search');
    const inputCategoryEn = document.getElementById('input-category-en');
    const inputCategoryKo = document.getElementById('input-category-ko');
    const categoryAutocompleteList = document.getElementById('category-autocomplete-list');
    const inputNameKo = document.getElementById('input-name-ko');
    const inputNameEn = document.getElementById('input-name-en');
    const inputPriceKrw = document.getElementById('input-price-krw');
    const inputDomesticShipping = document.getElementById('input-domestic-shipping');
    const inputPackagingKrw = document.getElementById('input-packaging-krw');
    const inputRate = document.getElementById('input-rate');
    const inputRateDate = document.getElementById('input-rate-date');
    const inputWeight = document.getElementById('input-weight');
    const inputLink = document.getElementById('input-link');
    const inputNote = document.getElementById('input-note');

    let currentEditingRow = null;
    let originalEditDate = null;
    let originalEditMcode = null;

    function updateMcodePreview() {
        const selectedDate = inputDate.value;
        if (!selectedDate) return;

        if (currentEditingRow && selectedDate === originalEditDate) {
            inputMcode.value = originalEditMcode;
            return;
        }

        let maxSeq = 0;
        productList.forEach(p => {
            if (p.mcode === originalEditMcode) return; // Skip currently editing
            if (p.date === selectedDate) {
                const parts = p.mcode.split('-');
                if (parts.length === 3) {
                    const seq = parseInt(parts[2], 10);
                    if (seq > maxSeq) maxSeq = seq;
                }
            }
        });

        const nextSeq = maxSeq + 1;
        inputMcode.value = window.generateManagementCode(selectedDate, nextSeq);
    }

    if (inputDate) {
        inputDate.addEventListener('change', updateMcodePreview);
    }

    function openDrawer(isEdit = false) {
        if (!isEdit) {
            addProductForm.reset();
            currentEditingRow = null;
            originalEditDate = null;
            originalEditMcode = null;
            
            const today = new Date().toISOString().split('T')[0];
            inputDate.value = today;
            updateMcodePreview();

            if (window.latestExchangeRates && window.latestExchangeRates.usd) {
                inputRate.value = window.latestExchangeRates.usd.toFixed(2);
                inputRateDate.value = today;
            }

            drawer.querySelector('.headline-md').innerText = 'Add New Product';
        } else {
            drawer.querySelector('.headline-md').innerText = 'Edit Product';
        }
        if(drawerOverlay && drawer) {
            drawerOverlay.classList.add('active');
            drawer.classList.add('active');
        }
    }

    function closeDrawer() {
        if(drawerOverlay && drawer) {
            drawerOverlay.classList.remove('active');
            drawer.classList.remove('active');
            addProductForm.reset();
            currentEditingRow = null;
            drawer.querySelector('.headline-md').innerText = 'Add New Product';
            categoryAutocompleteList.style.display = 'none';
        }
    }

    if (btnAddProduct) btnAddProduct.addEventListener('click', () => openDrawer(false));
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
    if (btnCancelDrawer) btnCancelDrawer.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', () => {
        closeDrawer();
        if (typeof closePriceCalcDrawer === 'function') closePriceCalcDrawer();
    });

    /* --- Autocomplete Logic --- */
    function renderAutocomplete(query) {
        if (!query) {
            categoryAutocompleteList.innerHTML = '';
            categoryAutocompleteList.classList.remove('active');
            categoryAutocompleteList.style.display = 'none';
            return;
        }

        const lowerQuery = query.toLowerCase();
        // Fallback to empty array if window.SHOPEE_CATEGORIES is not loaded
        const categories = window.SHOPEE_CATEGORIES || [];
        const filtered = categories.filter(cat => 
            cat.en.toLowerCase().includes(lowerQuery) || 
            cat.ko.includes(lowerQuery)
        );

        if (filtered.length === 0) {
            categoryAutocompleteList.innerHTML = '<li style="color:var(--text-disabled); cursor:default;">검색 결과가 없습니다.</li>';
        } else {
            categoryAutocompleteList.innerHTML = filtered.map(cat => `
                <li data-en="${cat.en}" data-ko="${cat.ko}">
                    <span class="cat-en">${cat.en}</span>
                    <span class="cat-ko">${cat.ko}</span>
                </li>
            `).join('');
        }
        categoryAutocompleteList.classList.add('active');
        categoryAutocompleteList.style.display = 'block';
    }

    if (inputCategorySearch) {
        inputCategorySearch.addEventListener('input', (e) => {
            inputCategoryEn.value = '';
            inputCategoryKo.value = '';
            renderAutocomplete(e.target.value);
        });

        // Hide list when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-container')) {
                categoryAutocompleteList.classList.remove('active');
                categoryAutocompleteList.style.display = 'none';
            }
        });

        // Select an item
        categoryAutocompleteList.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li || !li.dataset.en) return;

            const en = li.dataset.en;
            const ko = li.dataset.ko;

            inputCategorySearch.value = `${en} / ${ko}`;
            inputCategoryEn.value = en;
            inputCategoryKo.value = ko;
            
            categoryAutocompleteList.classList.remove('active');
            categoryAutocompleteList.style.display = 'none';
        });
    }

    // Form Submission (Save Product)
    if (btnSaveProduct) {
        btnSaveProduct.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!addProductForm.checkValidity()) {
                addProductForm.reportValidity();
                return;
            }

            const dateStr = inputDate.value;
            const mcodeStr = inputMcode.value;
            const catEn = inputCategoryEn.value;
            const catKo = inputCategoryKo.value;
            const catSearch = inputCategorySearch.value;
            const nameKo = inputNameKo.value;
            const nameEn = inputNameEn.value;
            const priceKrw = inputPriceKrw.value;
            const domesticShipping = inputDomesticShipping ? inputDomesticShipping.value : '3000';
            const packagingKrw = inputPackagingKrw ? inputPackagingKrw.value : '0';
            const rate = inputRate.value;
            const rateDate = inputRateDate.value;
            const weight = inputWeight.value;
            const link = inputLink.value;
            const note = inputNote.value;

            if (!catEn) {
                alert("카테고리를 목록에서 올바르게 선택해주세요.");
                return;
            }

            // Duplicate Check (Array based)
            let isDuplicate = false;
            if (originalEditMcode !== mcodeStr) {
                if (productList.find(p => p.mcode === mcodeStr)) {
                    isDuplicate = true;
                }
            }

            if (isDuplicate) {
                alert(`오류: 관리코드(${mcodeStr})가 이미 존재합니다. 날짜를 변경하거나 새로고침해 주세요.`);
                return;
            }

            const productData = {
                date: dateStr,
                mcode: mcodeStr,
                catEn: catEn,
                catKo: catKo,
                nameKo: nameKo,
                nameEn: nameEn,
                priceKrw: parseInt(priceKrw, 10) || 0,
                domesticShipping: domesticShipping === '' ? 0 : (parseInt(domesticShipping, 10) || 0),
                packagingKrw: packagingKrw === '' ? 0 : (parseInt(packagingKrw, 10) || 0),
                rate: parseFloat(rate) || 1,
                rateDate: rateDate,
                weight: parseInt(weight, 10) || 0,
                link: link,
                note: note
            };

            try {
                if (currentEditingRow && originalEditMcode) {
                    // Update existing via API
                    const existing = productList.find(p => p.mcode === originalEditMcode);
                    if (existing && existing.id) {
                        const isChanged = (
                            (existing.date || '') !== productData.date ||
                            (existing.mcode || '') !== productData.mcode ||
                            (existing.catEn || '') !== productData.catEn ||
                            (existing.catKo || '') !== productData.catKo ||
                            (existing.nameKo || '') !== productData.nameKo ||
                            (existing.nameEn || '') !== productData.nameEn ||
                            Number(existing.priceKrw || 0) !== productData.priceKrw ||
                            Number(existing.domesticShipping ?? 3000) !== productData.domesticShipping ||
                            Number(existing.packagingKrw || 0) !== productData.packagingKrw ||
                            Number(existing.rate || 1) !== productData.rate ||
                            (existing.rateDate || '') !== productData.rateDate ||
                            Number(existing.weight || 0) !== productData.weight ||
                            (existing.link || '') !== productData.link ||
                            (existing.note || '') !== productData.note
                        );

                        if (!isChanged) {
                            closeDrawer();
                            return;
                        }

                        const exportsForProduct = marketExportsMap[existing.id] || [];
                        if (exportsForProduct.length > 0) {
                            const marketNames = exportsForProduct.map(e => e.marketCode.toUpperCase()).join(', ');
                            const confirmMsg = `⚠️ 이 상품은 현재 [${marketNames}] 마켓의 Price Calculation에 연동되어 있습니다.\n\n여기서 정보를 수정하시면 해당 마켓의 마진 계산에도 즉시 변경 사항이 반영됩니다.\n수정본을 저장하시겠습니까?`;
                            if (!confirm(confirmMsg)) return;
                        }
                        await api.updateProduct(existing.id, productData);
                    }
                } else {
                    // Create new via API
                    await api.createProduct(productData);
                }

                // Reload from API
                productList = await api.getProducts();
                renderProductListTable();
                closeDrawer();
            } catch (err) {
                alert('저장 실패: ' + err.message);
            }
        });
    }

    // Row Click Logic for Editing
    function attachRowClickEvent(row) {
        row.addEventListener('click', (e) => {
            // Prevent drawer from opening if clicking a link or a checkbox
            if (e.target.closest('a') || e.target.closest('input[type="checkbox"]')) return;

            currentEditingRow = row;
            
            // Extract values safely
            const dateStr = row.querySelector('.prod-date').innerText;
            const mcodeStr = row.querySelector('.prod-mcode').innerText;
            const tdCat = row.querySelector('[data-cat-en]');
            const catEn = tdCat ? tdCat.dataset.catEn : (row.dataset.catEn || '');
            const catKo = tdCat ? tdCat.dataset.catKo : (row.dataset.catKo || '');
            const nameKo = row.querySelector('.prod-name-ko').innerText;
            const nameEn = row.querySelector('.prod-name-en').innerText;
            const priceKrwText = row.querySelector('.prod-price-krw').innerText;
            const rate = row.querySelector('.prod-rate').innerText;
            const weightText = row.querySelector('.prod-weight').innerText;
            const linkHref = row.querySelector('.prod-link').getAttribute('href');
            const note = row.querySelector('.prod-note').innerText;
            const rateDateStr = row.dataset.rateDate || '';

            // Populate form
            inputDate.value = dateStr;
            inputMcode.value = mcodeStr;
            inputCategoryEn.value = catEn;
            inputCategoryKo.value = catKo;
            inputCategorySearch.value = catEn && catKo ? `${catEn} / ${catKo}` : '';
            inputNameKo.value = nameKo;
            inputNameEn.value = nameEn;
            inputPriceKrw.value = priceKrwText.replace(/[^0-9]/g, '');
            // Load domesticShipping and packagingKrw from product data
            const productObj = productList.find(pp => pp.mcode === mcodeStr);
            if (inputDomesticShipping) inputDomesticShipping.value = productObj ? (productObj.domesticShipping ?? 3000) : 3000;
            if (inputPackagingKrw) inputPackagingKrw.value = productObj ? (productObj.packagingKrw || 0) : 0;
            inputRate.value = rate.replace(/,/g, '');
            inputRateDate.value = rateDateStr;
            inputWeight.value = weightText.replace(/[^0-9]/g, '');
            inputLink.value = linkHref === '#' ? '' : linkHref;
            inputNote.value = note === '-' ? '' : note;

            originalEditDate = dateStr;
            originalEditMcode = mcodeStr;

            openDrawer(true);
        });
    }

    // Attach to existing rows (Initial Render)
    renderProductListTable();


    /* --- 5. Price Calc — Row click is now handled inline by renderPriceCalcGrid --- */

    // ==============================
    // Shopee Pricing Calculation Engine (Pure Functions)
    // ==============================

    /**
     * Calculate shipping cost based on weight and shipping preset settings.
     * @param {number} weightG - Product weight in grams
     * @param {object} ship - Shipping preset settings {tier1Base, tier2Add, tier3Base, tier3Add, rebate}
     * @returns {{grossShipping: number, sellerShipping: number, rebate: number}}
     */
    function calcShippingCost(weightG, ship) {
        if (!ship || weightG <= 0) return { grossShipping: 0, sellerShipping: 0, rebate: 0 };
        let gross = 0;
        if (weightG <= 50) {
            gross = ship.tier1Base;
        } else if (weightG <= 1000) {
            gross = ship.tier1Base + Math.ceil((weightG - 50) / 10) * ship.tier2Add;
        } else {
            gross = ship.tier3Base + Math.ceil((weightG - 1000) / 100) * ship.tier3Add;
        }
        const rebate = ship.rebate || 0;
        const sellerShipping = Math.max(0, gross - rebate);
        return { grossShipping: gross, sellerShipping, rebate };
    }

    /**
     * Forward calculation: Given a selling price (P), calculate all fees and margin.
     * @param {object} input
     * @returns {object} Full pricing breakdown
     */
    function calcPricingFromPrice(input) {
        const {
            costKrw = 0, domesticShipping = 0, packagingKrw = 0,
            sellingPriceSgd, // P (판매자 지정 판매가)
            weight = 0,
            exchangeRate = 0.00086,
            fees = {}, // { commission, pg, service, payoneer, gst }
            promo = {}, // { discountRate, adjustmentRate }
            shippingSettings = {} // { tier1Base, tier2Add, ... rebate }
        } = input;

        const commR = (fees.commission || 0) / 100;
        const pgR = (fees.pg || 0) / 100;
        const svcR = (fees.service || 0) / 100;
        const payR = (fees.payoneer || 0) / 100;
        const G = (fees.gst || 0) / 100;
        const D = (promo.discountRate || 0) / 100;
        const voucherR = (promo.voucher || 0) / 100;
        const fspCcbR = (promo.fspCcb || 0) / 100;

        // Cost
        const totalCostKrw = costKrw + domesticShipping + packagingKrw;
        const costSgd = totalCostKrw * exchangeRate;

        // Shipping
        const shipResult = calcShippingCost(weight, shippingSettings);
        const sellerShipping = shipResult.sellerShipping;
        const rebate = shipResult.rebate;
        const grossShipping = shipResult.grossShipping;

        // Price structure
        const P = sellingPriceSgd;
        const TP = P * (1 - D); // 할인 적용 거래가
        const buyerDisplay = P * (1 + G); // 구매자 노출가

        // Fees
        const commission = TP * commR;
        const pgFee = (TP * (1 + G) + rebate) * pgR;
        const serviceFee = TP * svcR;
        const productGst = TP * G;
        const shippingGst = G > 0 ? (rebate / (1 + G)) * G : 0;
        const totalGst = productGst + shippingGst;
        const voucherFee = TP * voucherR;
        const fspCcbFee = TP * fspCcbR;

        // Revenue & Settlement
        const revenue = TP * (1 + G);
        const settlement = revenue - commission - pgFee - totalGst - sellerShipping - voucherFee - fspCcbFee;
        const payoneerFee = settlement * payR;

        // Margin
        const marginSgd = revenue - costSgd - sellerShipping - commission - pgFee - serviceFee - payoneerFee - totalGst;
        const marginKrw = exchangeRate > 0 ? Math.round(marginSgd / exchangeRate) : 0;

        // VAT Refund (10% on total cost)
        const vatRefundKrw = totalCostKrw - Math.round(totalCostKrw / 1.1);
        const vatRefundSgd = vatRefundKrw * exchangeRate;
        const marginWithVatKrw = marginKrw + vatRefundKrw;
        const marginWithVatSgd = marginSgd + vatRefundSgd;

        // Total fees
        const totalFees = commission + pgFee + serviceFee + payoneerFee + totalGst;

        return {
            // Inputs echoed
            costKrw: totalCostKrw, costSgd,
            weight, exchangeRate,
            sellerShipping, rebate, grossShipping,

            // Prices
            sellingPrice: P,
            transactionPrice: TP,
            buyerDisplayPrice: buyerDisplay,
            discountRate: D * 100,
            adjustmentRate: promo.adjustmentRate || 100,

            // Fee breakdown
            breakdown: {
                commission: { label: '쇼피 판매 수수료', rate: fees.commission, base: 'TP', baseLabel: '부가세제외 주문금액', baseValue: TP, amount: commission },
                pgFee:      { label: '해외 PG 수수료', rate: fees.pg, base: 'TP×(1+G)+Rebate', baseLabel: '부가세포함 주문금액+배송비감면액', baseValue: TP * (1 + G) + rebate, amount: pgFee },
                serviceFee: { label: '기본 서비스 수수료', rate: fees.service, base: 'TP', baseLabel: '부가세제외 주문금액', baseValue: TP, amount: serviceFee },
                productGst: { label: 'Product GST', rate: fees.gst, base: 'TP', baseLabel: '부가세제외 주문금액', baseValue: TP, amount: productGst },
                shippingGst: { label: 'Shipping GST', rate: fees.gst, base: 'Rebate/(1+G)', baseLabel: '배송비감면액/(1+GST)', baseValue: rebate / (1 + G), amount: shippingGst },
                payoneer:   { label: '페이오니아 인출', rate: fees.payoneer, base: 'Settlement', baseLabel: '쇼피정산금', baseValue: settlement, amount: payoneerFee },
            },
            totalFees,
            revenue,
            settlement,
            marginSgd,
            marginKrw,
            vatRefundKrw,
            vatRefundSgd,
            marginWithVatKrw,
            marginWithVatSgd
        };
    }

    /**
     * Reverse calculation: Given a target margin (KRW), solve for selling price P.
     * Uses the same formulas, solved algebraically for TP.
     */
    function calcPricingFromMargin(input) {
        const {
            costKrw = 0, domesticShipping = 0, packagingKrw = 0,
            targetMarginKrw = 0,
            weight = 0,
            exchangeRate = 0.00086,
            fees = {},
            promo = {},
            shippingSettings = {}
        } = input;

        const commR = (fees.commission || 0) / 100;
        const pgR = (fees.pg || 0) / 100;
        const svcR = (fees.service || 0) / 100;
        const payR = (fees.payoneer || 0) / 100;
        const G = (fees.gst || 0) / 100;
        const D = (promo.discountRate || 0) / 100;
        const voucherR = (promo.voucher || 0) / 100;
        const fspCcbR = (promo.fspCcb || 0) / 100;

        const totalCostKrw = costKrw + domesticShipping + packagingKrw;
        const costSgd = totalCostKrw * exchangeRate;
        const targetMarginSgd = targetMarginKrw * exchangeRate;

        const shipResult = calcShippingCost(weight, shippingSettings);
        const sellerShipping = shipResult.sellerShipping;
        const rebate = shipResult.rebate;

        const A = 1 + G;
        const K1 = A - commR - A * pgR - svcR - G - voucherR - fspCcbR;
        const K2 = A - commR - A * pgR - G - voucherR - fspCcbR;
        const C = costSgd + sellerShipping + rebate * pgR + (G > 0 ? rebate * G / A : 0);
        const payAdj = payR * (rebate * pgR + (G > 0 ? rebate * G / A : 0) + sellerShipping);

        const denominator = K1 - payR * K2;
        if (denominator <= 0) {
            // Fees exceed 100% — cannot solve
            return calcPricingFromPrice({ ...input, sellingPriceSgd: 0 });
        }

        const TP = (targetMarginSgd + C - payAdj) / denominator;
        const P = D < 1 ? TP / (1 - D) : TP;

        // Now do forward calc with this P
        return calcPricingFromPrice({ ...input, sellingPriceSgd: P });
    }

    // Make engines available globally for price calc UI
    window.calcPricingFromPrice = calcPricingFromPrice;
    window.calcPricingFromMargin = calcPricingFromMargin;
    window.calcShippingCost = calcShippingCost;

    /* --- Preset Logic --- */
    let presets = [];
    let promotionPresets = [];
    let shippingPresets = [];

    // API에서 프리셋 및 시스템 설정 로드
    try {
        presets = await api.getPresets();
        promotionPresets = await api.getPromotionPresets();
        shippingPresets = await api.getShippingPresets();
        
        const settingsRaw = await api.getSystemSettings();
        if (settingsRaw) {
            if (settingsRaw.margin_safe !== undefined) systemSettings.margin_safe = Number(settingsRaw.margin_safe);
            if (settingsRaw.margin_standard !== undefined) systemSettings.margin_standard = Number(settingsRaw.margin_standard);
            if (settingsRaw.margin_aggressive !== undefined) systemSettings.margin_aggressive = Number(settingsRaw.margin_aggressive);
        }
        
        console.log(`[INIT] 프리셋 로드: ${presets.length}개 수수료, ${promotionPresets.length}개 프로모션, ${shippingPresets.length}개 배송비, 시스템 설정 로드됨`);
    } catch (err) {
        console.error('[INIT] 초기 설정 로드 실패:', err.message);
    }

    const presetSelector = document.getElementById('preset-selector');
    const presetModalOverlay = document.getElementById('preset-modal-overlay');
    const presetModal = document.getElementById('preset-manage-modal');

    async function savePresetsToStorage() {
        // 서버에서 재로드 (개별 저장은 각 CRUD 함수에서 처리)
        try { presets = await api.getPresets(); } catch(e) { console.error(e); }
    }

    async function savePromotionPresetsToStorage() {
        try { promotionPresets = await api.getPromotionPresets(); } catch(e) { console.error(e); }
    }

    async function saveShippingPresetsToStorage() {
        try { shippingPresets = await api.getShippingPresets(); } catch(e) { console.error(e); }
    }

    function populateDrawerPresetSelectors() {
        // Fee Selector
        const feeSel = document.getElementById('calc-fee-preset');
        if (feeSel) {
            let html = '<option value="">-- 수수료 프리셋 --</option>';
            presets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            feeSel.innerHTML = html;
        }

        // Promotion Selector
        const promoSel = document.getElementById('calc-promotion-preset');
        if (promoSel) {
            let html = '<option value="">-- 프로모션 프리셋 --</option>';
            promotionPresets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            promoSel.innerHTML = html;
        }

        // Shipping Selector
        const shipSel = document.getElementById('calc-shipping-preset');
        if (shipSel) {
            let html = '<option value="">-- 배송비 프리셋 --</option>';
            shippingPresets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            shipSel.innerHTML = html;
        }
    }

    // renderPresetSelector → populateDrawerPresetSelectors 별칭 등록
    // ※ 미정의 시 ReferenceError로 이후 코드 실행이 중단되는 버그 수정
    const renderPresetSelector = populateDrawerPresetSelectors;
    window.renderPresetSelector = renderPresetSelector;

    function applyFeePreset(presetId) {
        const p = presets.find(x => x.id === presetId);
        if (!p) return;
        const commissionEl = document.getElementById('calc-commission-fee');
        if(commissionEl) commissionEl.value = p.fees.commission;
        const pgEl = document.getElementById('calc-pg-fee');
        if(pgEl) pgEl.value = p.fees.pg;
        const serviceEl = document.getElementById('calc-service-fee');
        if(serviceEl) serviceEl.value = p.fees.service;
        const payoneerEl = document.getElementById('calc-payoneer-fee');
        if(payoneerEl) payoneerEl.value = p.fees.payoneer;
        const specialEl = document.getElementById('calc-special-fee');
        if(specialEl) specialEl.value = p.fees.special;
        calculateMargin();
    }

    function applyPromotionPreset(presetId) {
        const p = promotionPresets.find(x => x.id === presetId);
        if (!p) return;
        const voucherEl = document.getElementById('calc-promo-voucher');
        if(voucherEl) voucherEl.value = p.settings.voucher;
        const fspEl = document.getElementById('calc-promo-fsp');
        if(fspEl) fspEl.value = p.settings.fspCcb;
        const freeShipEl = document.getElementById('calc-promo-freeship');
        if(freeShipEl) freeShipEl.value = p.settings.freeShipThreshold;
        calculateMargin();
    }

    function applyShippingPreset() {
        calculateMargin(); // The calculation logic now natively reads from the selector
    }

    function loadDefaultPresets() {
        populateDrawerPresetSelectors();

        // Fee
        const feeDef = presets.find(p => p.market === currentMarketContext && p.isDefault);
        const feeSel = document.getElementById('calc-fee-preset');
        if (feeDef && feeSel) {
            feeSel.value = feeDef.id;
            applyFeePreset(feeDef.id);
        }

        // Promotion
        const promoDef = promotionPresets.find(p => p.market === currentMarketContext && p.isDefault);
        const promoSel = document.getElementById('calc-promotion-preset');
        if (promoDef && promoSel) {
            promoSel.value = promoDef.id;
            applyPromotionPreset(promoDef.id);
        }

        // Shipping
        const shipDef = shippingPresets.find(p => p.market === currentMarketContext && p.isDefault);
        const shipSel = document.getElementById('calc-shipping-preset');
        if (shipDef && shipSel) {
            shipSel.value = shipDef.id;
            applyShippingPreset();
        }
    }

    // Attach Event Listeners to Drawer Selectors
    document.getElementById('calc-fee-preset')?.addEventListener('change', (e) => {
        if(e.target.value) applyFeePreset(e.target.value);
    });
    document.getElementById('calc-promotion-preset')?.addEventListener('change', (e) => {
        if(e.target.value) applyPromotionPreset(e.target.value);
    });
    document.getElementById('calc-shipping-preset')?.addEventListener('change', (e) => {
        applyShippingPreset();
    });

    // Modal Logic
    function renderPresetTable() {
        const tbody = document.querySelector('#preset-table tbody');
        if (!tbody) return;
        
        if (presets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프리셋이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = presets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Com: ${p.fees.commission}% | PG: ${p.fees.pg}% | Serv: ${p.fees.service}%
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="default_preset" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="preset-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td>
                    <button class="btn-bulk btn-bulk-danger preset-delete-btn" data-id="${p.id}" style="padding: 4px 8px;"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.preset-default-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const id = e.target.value;
                presets.forEach(p => p.isDefault = (p.id === id));
                savePresetsToStorage();
                renderPresetSelector();
            });
        });

        document.querySelectorAll('.preset-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                presets = presets.filter(p => p.id !== id);
                if (presets.length > 0 && !presets.find(p => p.isDefault)) {
                    presets[0].isDefault = true;
                }
                savePresetsToStorage();
                renderPresetTable();
                renderPresetSelector();
                renderSettingsPresetTable(); // Settings 동기화
            });
        });
    }

    document.getElementById('btn-manage-presets')?.addEventListener('click', () => {
        renderPresetTable();
        if(presetModalOverlay && presetModal) {
            presetModalOverlay.classList.add('active');
            presetModal.classList.add('active');
        }
    });

    function closePresetModal() {
        if(presetModalOverlay && presetModal) {
            presetModalOverlay.classList.remove('active');
            presetModal.classList.remove('active');
        }
    }
    document.getElementById('btn-close-preset-modal')?.addEventListener('click', closePresetModal);
    presetModalOverlay?.addEventListener('click', closePresetModal);

    // Initial render
    renderPresetSelector();

    /* --- Settings Toggle Forms Logic --- */
    function toggleSettingsForm(type, show) {
        const form = document.getElementById(`form-container-${type}`);
        if (form) {
            form.style.display = show ? 'block' : 'none';
        }
    }
    
    document.getElementById('btn-toggle-fee-form')?.addEventListener('click', () => { clearSettingsPresetForm(); toggleSettingsForm('fee', true); });
    document.getElementById('btn-cancel-fee-form')?.addEventListener('click', () => toggleSettingsForm('fee', false));

    document.getElementById('btn-toggle-promotion-form')?.addEventListener('click', () => { clearSettingsPromotionForm(); toggleSettingsForm('promotion', true); });
    document.getElementById('btn-cancel-promotion-form')?.addEventListener('click', () => toggleSettingsForm('promotion', false));

    document.getElementById('btn-toggle-shipping-form')?.addEventListener('click', () => { clearSettingsShippingForm(); toggleSettingsForm('shipping', true); });
    document.getElementById('btn-cancel-shipping-form')?.addEventListener('click', () => toggleSettingsForm('shipping', false));

    /* --- Settings View Preset Logic --- */
    function renderSettingsPresetTable() {
        const tbody = document.querySelector('#settings-preset-table tbody');
        if (!tbody) return;
        
        const marketPresets = presets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프리셋이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Com: ${p.fees.commission}% | PG: ${p.fees.pg}% | Serv: ${p.fees.service}%
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_preset" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-preset-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-preset-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-preset-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-preset-default-radio').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                const id = e.target.value;
                for (let p of presets) {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                        await api.updatePreset(p.id, p);
                    }
                }
                await savePresetsToStorage();
                renderPresetSelector();
                renderSettingsPresetTable();
            });
        });

        document.querySelectorAll('.settings-preset-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = presets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-preset-id').value = p.id;
                    document.getElementById('settings-preset-name').value = p.name;
                    document.getElementById('settings-shopee-discount').value = p.fees.discount;
                    document.getElementById('settings-commission-fee').value = p.fees.commission;
                    document.getElementById('settings-pg-fee').value = p.fees.pg;
                    document.getElementById('settings-service-fee').value = p.fees.service;
                    document.getElementById('settings-payoneer-fee').value = p.fees.payoneer;
                    document.getElementById('settings-special-fee') && (document.getElementById('settings-special-fee').value = p.fees.special || 0);
                    const gstEl = document.getElementById('settings-gst-fee');
                    if (gstEl) gstEl.value = p.fees.gst || p.fees.special || 0;
                    document.getElementById('settings-preset-form-title').innerText = `${currentMarketContext.toUpperCase()} 프리셋 수정하기`;
                    toggleSettingsForm('fee', true);
                }
            });
        });

        document.querySelectorAll('.settings-preset-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(!confirm('정말로 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                await api.deletePreset(id);
                
                const currentMarketPresets = presets.filter(p => p.market === currentMarketContext && p.id !== id);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                    await api.updatePreset(currentMarketPresets[0].id, currentMarketPresets[0]);
                }
                await savePresetsToStorage();
                renderSettingsPresetTable();
            });
        });
    }

    function clearSettingsPresetForm() {
        const form = document.getElementById('settings-preset-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-preset-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-preset-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 프리셋 만들기`;
    }

    document.getElementById('btn-settings-preset-clear')?.addEventListener('click', clearSettingsPresetForm);

    document.getElementById('btn-settings-preset-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-preset-id').value;
        const name = document.getElementById('settings-preset-name').value;
        if (!name) {
            alert('프리셋 이름을 입력해주세요.');
            return;
        }
        
        const newFees = {
            discount: parseFloat(document.getElementById('settings-shopee-discount').value) || 0,
            commission: parseFloat(document.getElementById('settings-commission-fee').value) || 0,
            pg: parseFloat(document.getElementById('settings-pg-fee').value) || 0,
            service: parseFloat(document.getElementById('settings-service-fee').value) || 0,
            payoneer: parseFloat(document.getElementById('settings-payoneer-fee').value) || 0,
            special: parseFloat(document.getElementById('settings-special-fee')?.value) || 0,
            gst: parseFloat(document.getElementById('settings-gst-fee')?.value) || 0
        };

        if (id) {
            const p = presets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.fees = newFees;
                api.updatePreset(id, p).then(() => savePresetsToStorage()).then(() => renderSettingsPresetTable());
            }
            alert('수정되었습니다.');
        } else {
            const marketPresets = presets.filter(p => p.market === currentMarketContext);
            const newPreset = {
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                fees: newFees
            };
            api.createPreset(newPreset).then(() => savePresetsToStorage()).then(() => renderSettingsPresetTable());
            alert(`${currentMarketContext.toUpperCase()} 설정이 추가되었습니다.`);
        }
        
        clearSettingsPresetForm();
        toggleSettingsForm('fee', false);
    });

    // Call once on load
    renderSettingsPresetTable();
    if(typeof renderSettingsPromotionTable === 'function') renderSettingsPromotionTable();

    /* --- Settings View Promotion Logic --- */
    function renderSettingsPromotionTable() {
        const tbody = document.querySelector('#settings-promotion-table tbody');
        if (!tbody) return;
        
        const marketPresets = promotionPresets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프로모션이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        할인 ${p.settings.discountRate || 0}% · 조정 ${p.settings.adjustmentRate || 100}% | Voucher: ${p.settings.voucher}% | FSP+CCB: ${p.settings.fspCcb}% | FreeShip: SGD ${p.settings.freeShipThreshold}
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_promotion" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-promotion-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-promotion-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-promotion-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-promotion-default-radio').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                const id = e.target.value;
                for (let p of promotionPresets) {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                        await api.updatePromotionPreset(p.id, p);
                    }
                }
                await savePromotionPresetsToStorage();
                renderSettingsPromotionTable();
            });
        });

        document.querySelectorAll('.settings-promotion-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = promotionPresets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-promotion-id').value = p.id;
                    document.getElementById('settings-promotion-name').value = p.name;
                    document.getElementById('settings-promo-voucher').value = p.settings.voucher;
                    document.getElementById('settings-promo-fsp').value = p.settings.fspCcb;
                    document.getElementById('settings-promo-free-shipping').value = p.settings.freeShipThreshold;
                    const drEl = document.getElementById('settings-promo-discount-rate');
                    if (drEl) drEl.value = p.settings.discountRate || 30;
                    const arEl = document.getElementById('settings-promo-adjustment-rate');
                    if (arEl) arEl.value = p.settings.adjustmentRate || 130;
                    document.getElementById('settings-promotion-form-title').innerText = `${currentMarketContext.toUpperCase()} 프로모션 수정하기`;
                    toggleSettingsForm('promotion', true);
                }
            });
        });

        document.querySelectorAll('.settings-promotion-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(!confirm('정말로 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                await api.deletePromotionPreset(id);
                
                const currentMarketPresets = promotionPresets.filter(p => p.market === currentMarketContext && p.id !== id);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                    await api.updatePromotionPreset(currentMarketPresets[0].id, currentMarketPresets[0]);
                }
                await savePromotionPresetsToStorage();
                renderSettingsPromotionTable();
            });
        });
    }

    function clearSettingsPromotionForm() {
        const form = document.getElementById('settings-promotion-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-promotion-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-promotion-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 프로모션 만들기`;
    }

    document.getElementById('btn-settings-promotion-clear')?.addEventListener('click', clearSettingsPromotionForm);

    document.getElementById('btn-settings-promotion-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-promotion-id').value;
        const name = document.getElementById('settings-promotion-name').value;
        if (!name) {
            alert('프로모션 이름을 입력해주세요.');
            return;
        }
        
        const newSettings = {
            discountRate: parseFloat(document.getElementById('settings-promo-discount-rate')?.value) || 30,
            adjustmentRate: parseFloat(document.getElementById('settings-promo-adjustment-rate')?.value) || 130,
            voucher: parseFloat(document.getElementById('settings-promo-voucher').value) || 0,
            fspCcb: parseFloat(document.getElementById('settings-promo-fsp').value) || 0,
            freeShipThreshold: parseFloat(document.getElementById('settings-promo-free-shipping').value) || 0
        };

        if (id) {
            const p = promotionPresets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.settings = newSettings;
                api.updatePromotionPreset(id, p).then(() => savePromotionPresetsToStorage()).then(() => renderSettingsPromotionTable());
            }
            alert('수정되었습니다.');
        } else {
            const marketPresets = promotionPresets.filter(p => p.market === currentMarketContext);
            const newPreset = {
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                settings: newSettings
            };
            api.createPromotionPreset(newPreset).then(() => savePromotionPresetsToStorage()).then(() => renderSettingsPromotionTable());
            alert(`${currentMarketContext.toUpperCase()} 설정이 추가되었습니다.`);
        }
        
        clearSettingsPromotionForm();
        toggleSettingsForm('promotion', false);
    });

    /* --- Settings View Shipping Logic --- */
    function renderSettingsShippingTable() {
        const tbody = document.querySelector('#settings-shipping-table tbody');
        if (!tbody) return;
        
        const marketPresets = shippingPresets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 배송비 요율이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Tier1: ${p.settings.tier1Base} | Tier2: +${p.settings.tier2Add}/10g | Tier3: ${p.settings.tier3Base} +${p.settings.tier3Add}/100g
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_shipping" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-shipping-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-shipping-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-shipping-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-shipping-default-radio').forEach(radio => {
            radio.addEventListener('change', async (e) => {
                const id = e.target.value;
                for (let p of shippingPresets) {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                        await api.updateShippingPreset(p.id, p);
                    }
                }
                await saveShippingPresetsToStorage();
                renderSettingsShippingTable();
            });
        });

        document.querySelectorAll('.settings-shipping-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = shippingPresets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-shipping-id').value = p.id;
                    document.getElementById('settings-shipping-name').value = p.name;
                    document.getElementById('settings-shipping-tier1-base').value = p.settings.tier1Base;
                    document.getElementById('settings-shipping-tier2-add').value = p.settings.tier2Add;
                    document.getElementById('settings-shipping-tier3-base').value = p.settings.tier3Base;
                    document.getElementById('settings-shipping-tier3-add').value = p.settings.tier3Add;
                    document.getElementById('settings-shipping-rebate').value = p.settings.rebate;
                    document.getElementById('settings-shipping-form-title').innerText = `${currentMarketContext.toUpperCase()} 배송비 요율 수정하기`;
                    calculateShippingTest();
                    toggleSettingsForm('shipping', true);
                }
            });
        });

        document.querySelectorAll('.settings-shipping-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(!confirm('정말로 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                await api.deleteShippingPreset(id);
                
                const currentMarketPresets = shippingPresets.filter(p => p.market === currentMarketContext && p.id !== id);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                    await api.updateShippingPreset(currentMarketPresets[0].id, currentMarketPresets[0]);
                }
                await saveShippingPresetsToStorage();
                renderSettingsShippingTable();
            });
        });
    }

    function clearSettingsShippingForm() {
        const form = document.getElementById('settings-shipping-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-shipping-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-shipping-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 배송비 요율 만들기`;
        calculateShippingTest();
    }

    document.getElementById('btn-settings-shipping-clear')?.addEventListener('click', clearSettingsShippingForm);

    document.getElementById('btn-settings-shipping-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-shipping-id').value;
        const name = document.getElementById('settings-shipping-name').value;
        if (!name) {
            alert('배송비 요율 이름을 입력해주세요.');
            return;
        }
        
        const newSettings = {
            tier1Base: parseFloat(document.getElementById('settings-shipping-tier1-base').value) || 0,
            tier2Add: parseFloat(document.getElementById('settings-shipping-tier2-add').value) || 0,
            tier3Base: parseFloat(document.getElementById('settings-shipping-tier3-base').value) || 0,
            tier3Add: parseFloat(document.getElementById('settings-shipping-tier3-add').value) || 0,
            rebate: parseFloat(document.getElementById('settings-shipping-rebate').value) || 0
        };

        if (id) {
            const p = shippingPresets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.settings = newSettings;
                api.updateShippingPreset(id, p).then(() => saveShippingPresetsToStorage()).then(() => renderSettingsShippingTable());
            }
            alert('수정되었습니다.');
        } else {
            const marketPresets = shippingPresets.filter(p => p.market === currentMarketContext);
            const newPreset = {
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                settings: newSettings
            };
            api.createShippingPreset(newPreset).then(() => saveShippingPresetsToStorage()).then(() => renderSettingsShippingTable());
            alert(`${currentMarketContext.toUpperCase()} 설정이 추가되었습니다.`);
        }
        
        clearSettingsShippingForm();
        toggleSettingsForm('shipping', false);
    });

    /* --- Shipping Rate Tester Logic --- */
    function calculateShippingTest() {
        const weightStr = document.getElementById('settings-shipping-test-weight')?.value;
        if (!weightStr) {
            document.getElementById('test-total-fee').innerText = `SGD 0.00`;
            document.getElementById('test-rebate').innerText = `- SGD 0.00`;
            document.getElementById('test-seller-borne').innerText = `SGD 0.00`;
            return;
        }

        const weight = parseFloat(weightStr) || 0;
        const tier1Base = parseFloat(document.getElementById('settings-shipping-tier1-base').value) || 0;
        const tier2Add = parseFloat(document.getElementById('settings-shipping-tier2-add').value) || 0;
        const tier3Base = parseFloat(document.getElementById('settings-shipping-tier3-base').value) || 0;
        const tier3Add = parseFloat(document.getElementById('settings-shipping-tier3-add').value) || 0;
        const rebate = parseFloat(document.getElementById('settings-shipping-rebate').value) || 0;

        let totalFee = 0;
        if (weight <= 0) {
            totalFee = 0;
        } else if (weight <= 50) {
            totalFee = tier1Base;
        } else if (weight <= 1000) {
            const extraWeight = weight - 50;
            const units = Math.ceil(extraWeight / 10);
            totalFee = tier1Base + (units * tier2Add);
        } else {
            const extraWeight = weight - 1000;
            const units = Math.ceil(extraWeight / 100);
            totalFee = tier3Base + (units * tier3Add);
        }

        document.getElementById('test-total-fee').innerText = `SGD ${totalFee.toFixed(2)}`;
        document.getElementById('test-rebate').innerText = `- SGD ${rebate.toFixed(2)}`;
        
        const sellerBorne = totalFee - rebate;
        document.getElementById('test-seller-borne').innerText = `SGD ${sellerBorne.toFixed(2)}`;
    }

    document.getElementById('settings-shipping-test-weight')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier1-base')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier2-add')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier3-base')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier3-add')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-rebate')?.addEventListener('input', calculateShippingTest);
    
    // Initial Render
    if(typeof renderSettingsShippingTable === 'function') renderSettingsShippingTable();

    // ==========================================
    // MARKET ANALYSIS MODULE
    // ==========================================
    // maData는 상단에서 선언됨 (TDZ 방지)

    const MARKET_FLAGS = {
        sg: '🇸🇬', my: '🇲🇾', tw: '🇹🇼', th: '🇹🇭',
        ph: '🇵🇭', vn: '🇻🇳', br: '🇧🇷', mx: '🇲🇽'
    };

    // --- Shipping cost calculation using shipping_presets ---
    function calcSellerShipping(weight, market) {
        if (!weight || weight <= 0) return 0;
        // Find default shipping preset for the given market
        const preset = shippingPresets.find(p => p.market === market && p.isDefault);
        if (!preset || !preset.settings) return 0; // No preset yet for this country
        const s = preset.settings;
        let total = 0;
        if (weight <= 50) total = s.tier1Base || 0;
        else if (weight <= 1000) total = (s.tier1Base || 0) + (Math.ceil((weight - 50) / 10) * (s.tier2Add || 0));
        else total = (s.tier3Base || 0) + (Math.ceil((weight - 1000) / 100) * (s.tier3Add || 0));
        return Math.max(0, total - (s.rebate || 0));
    }

    // --- Load & Render Table ---
    async function loadMarketAnalysis() {
        const filter = document.getElementById('ma-market-filter')?.value || '';
        try {
            maData = await api.getMarketAnalysis(filter || undefined);
        } catch (err) {
            console.error('[MA] Load failed:', err);
            maData = [];
        }
        renderMATable();
    }

    function renderMATable() {
        const tbody = document.getElementById('ma-table-body');
        if (!tbody) return;

        if (maData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="ma-empty-state">
                <div>분석 데이터가 없습니다.<br>"Add New" 버튼을 눌러 시작하세요.</div>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = maData.map(item => {
            const market = item.market || 'sg';
            const currencyMap = { sg: 'SGD', my: 'MYR', tw: 'TWD', th: 'THB', ph: 'PHP', vn: 'VND', br: 'BRL', mx: 'MXN' };
            const currency = currencyMap[market] || 'SGD';
            const exRate = item.exchangeRate || 0;

            const shopeeQty = item.shopeeQty || 1;

            // Domestic Price (KRW) parsing
            let lowestUnitCost = 0;
            let lowestPlatformStr = '';
            
            let sOpts = [];
            try { sOpts = JSON.parse(item.sourcingOptions || '[]'); } catch(e) {}
            
            if (sOpts.length > 0) {
                let minUnitCost = Infinity;
                let minOpt = null;
                sOpts.forEach(opt => {
                    const cost = ((opt.price || 0) + (opt.shipping || 0)) / (opt.qty || 1);
                    if (cost < minUnitCost) {
                        minUnitCost = cost;
                        minOpt = opt;
                    }
                });
                if (minOpt) {
                    lowestUnitCost = minUnitCost;
                    lowestPlatformStr = `[${minOpt.platform} ${minOpt.qty}개 묶음]`;
                }
            } else {
                // Fallback for legacy
                const cTotal = (item.coupangPrice || 0) + (item.coupangShipping || 0);
                const nTotal = (item.naverPrice || 0) + (item.naverShipping || 0);
                if (cTotal > 0 && nTotal > 0) {
                    lowestUnitCost = Math.min(cTotal, nTotal);
                    lowestPlatformStr = cTotal <= nTotal ? '[쿠팡 (구형)]' : '[네이버 (구형)]';
                }
                else if (cTotal > 0) { lowestUnitCost = cTotal; lowestPlatformStr = '[쿠팡 (구형)]'; }
                else if (nTotal > 0) { lowestUnitCost = nTotal; lowestPlatformStr = '[네이버 (구형)]'; }
            }

            const totalSourcingKrw = lowestUnitCost * shopeeQty;
            item._lowestKrw = totalSourcingKrw; // cache for sorting

            // Lowest Price Strings
            let lowestStr = '-';
            if (totalSourcingKrw > 0) {
                lowestStr = `
                    <div style="font-weight: 600;">KRW ${Number(Math.round(totalSourcingKrw)).toLocaleString()}</div>
                    <div class="body-sm text-secondary">(낱개 KRW ${Number(Math.round(lowestUnitCost)).toLocaleString()})<br>${lowestPlatformStr}</div>
                `;
            }

            // Actual Price Strings
            let actualStr = '-';
            if (item.actualPrice > 0) {
                const totalActualKrw = exRate > 0 ? Math.round(item.actualPrice * exRate) : 0;
                const unitActualSgd = (item.actualPrice / shopeeQty).toFixed(2);
                actualStr = `
                    <div style="font-weight: 600;">${totalActualKrw > 0 ? `KRW ${Number(totalActualKrw).toLocaleString()}` : '-'}</div>
                    <div class="body-sm text-secondary">${currency} ${item.actualPrice}<br>(낱개 ${currency} ${unitActualSgd})</div>
                `;
            }

            // Margin Strings
            let marginStr = '-';
            let marginKrwVal = 0;
            if (item.actualPrice > 0 && lowestUnitCost > 0 && exRate > 0) {
                const totalCostLocal = totalSourcingKrw / exRate;
                const totalMarginLocal = item.actualPrice - totalCostLocal - (item.sellerShipping || 0);
                marginKrwVal = totalMarginLocal * exRate;
                const marginRate = (totalMarginLocal / item.actualPrice) * 100;
                
                const marginClass = totalMarginLocal > 0 ? 'text-primary' : 'text-error';
                marginStr = `
                    <div class="${marginClass}" style="font-weight:600;">KRW ${Math.round(marginKrwVal).toLocaleString()}</div>
                    <div class="${marginClass} body-sm">총 ${currency} ${totalMarginLocal.toFixed(2)} (${marginRate.toFixed(1)}%)</div>
                `;
            }
            item._marginKrw = marginKrwVal;

            // Exchange Rate Strings
            let exRateStr = '-';
            if (exRate > 0) {
                const reverseRate = (1 / exRate).toFixed(5);
                exRateStr = `
                    <div style="font-weight: 600;">KRW ${Number(exRate).toLocaleString()}</div>
                    <div class="body-sm text-secondary">${currency} ${reverseRate}</div>
                `;
            }

            // Category String
            const categoryStr = (item.shopeeCategory || '-').split(' / ')[0];
            let cat1 = categoryStr;
            let cat2 = '';
            if(categoryStr.includes(' > ')) {
                const parts = categoryStr.split(' > ');
                cat1 = parts[0] + ' >';
                cat2 = parts[1];
            }

            const qtyBadge = shopeeQty > 1 ? `<span style="background:var(--surface-container-high); padding:2px 4px; border-radius:4px; font-size:0.8em; margin-left:4px; color:var(--primary); font-weight:600; white-space:nowrap;">📦 ${shopeeQty}개 묶음</span>` : '';
            const prodNameHTML = `<span title="${item.productName || ''}">${item.productName || '-'}</span> ${qtyBadge}`;

            return `<tr data-id="${item.id}" class="ma-row" style="cursor: pointer;">
                <td style="text-align: center;" class="td-checkbox">
                    <input type="checkbox" class="ma-row-checkbox">
                </td>
                <td style="max-width:180px;white-space:normal;word-break:break-word;font-size:0.82em;line-height:1.3;" title="${categoryStr}">
                    <div class="prod-cat-en-1">${cat1}</div>
                    ${cat2 ? `<div class="prod-cat-en-2">${cat2}</div>` : ''}
                </td>
                <td>
                    <div style="max-width:280px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; white-space:normal; line-height:1.3;">${prodNameHTML}</div>
                </td>
                <td><span class="ma-country-badge">${market.toUpperCase()}</span></td>
                <td style="max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.storeName || ''}">${item.storeName || '-'}</td>
                <td class="text-right">${actualStr}</td>
                <td class="text-right">${lowestStr}</td>
                <td class="text-right">${marginStr}</td>
                <td class="text-right">${exRateStr}</td>
            </tr>`;
        }).join('');
    }

    // --- Drawer Management ---
    const maDrawer = document.getElementById('ma-drawer');
    const maOverlay = document.getElementById('ma-drawer-overlay');

    function openMADrawer(item) {
        if (!maDrawer) return;
        const isEdit = !!item;
        document.getElementById('ma-drawer-title').innerText = isEdit ? 'Edit Analysis' : 'Add New';
        document.getElementById('ma-edit-id').value = isEdit ? item.id : '';
        const selectedMarket = isEdit ? (item.market || 'sg') : 'sg';
        document.getElementById('ma-market').value = selectedMarket;
        document.getElementById('ma-exchange-rate').value = isEdit ? (item.exchangeRate || '') : (window.latestExchangeRates[selectedMarket] || '');
        document.getElementById('ma-category').value = isEdit ? (item.shopeeCategory || '') : '';
        document.getElementById('ma-product-name').value = isEdit ? (item.productName || '') : '';
        document.getElementById('ma-store-name').value = isEdit ? (item.storeName || '') : '';
        document.getElementById('ma-monthly-sales').value = isEdit ? (item.monthlySales || '') : '';
        document.getElementById('ma-weight').value = isEdit ? (item.weight || '') : '';
        document.getElementById('ma-seller-shipping').value = isEdit ? (item.sellerShipping || '') : '';
        document.getElementById('ma-shopee-url').value = isEdit ? (item.shopeeUrl || '') : '';
        document.getElementById('ma-note').value = isEdit ? (item.note || '') : '';

        // Initialize Dynamic Options
        document.getElementById('ma-shopee-options-container').innerHTML = '';
        document.getElementById('ma-sourcing-options-container').innerHTML = '';

        if (isEdit) {
            document.getElementById('btn-add-shopee-option').style.display = 'none';
            document.getElementById('btn-add-sourcing-option').style.display = 'inline-block';
            
            renderShopeeOptionRow(item.shopeeQty || 1, item.listingPrice || '', item.actualPrice || '');
            
            let sOpts = [];
            try { sOpts = JSON.parse(item.sourcingOptions || '[]'); } catch(e) {}
            if (!Array.isArray(sOpts) || sOpts.length === 0) {
                // Fallback
                if (item.coupangPrice || item.naverPrice) {
                    if (item.coupangPrice) renderSourcingOptionRow('Coupang', 1, item.coupangPrice, item.coupangShipping || '', item.coupangUrl || '');
                    if (item.naverPrice) renderSourcingOptionRow('Naver', 1, item.naverPrice, item.naverShipping || '', item.naverUrl || '');
                } else {
                    renderSourcingOptionRow();
                }
            } else {
                sOpts.forEach(opt => renderSourcingOptionRow(opt.platform, opt.qty, opt.price, opt.shipping, opt.url));
            }
        } else {
            document.getElementById('btn-add-shopee-option').style.display = 'inline-block';
            document.getElementById('btn-add-sourcing-option').style.display = 'inline-block';
            renderShopeeOptionRow();
            renderSourcingOptionRow();
        }

        const imgUrlInput = document.getElementById('ma-image-url');
        if (imgUrlInput) imgUrlInput.value = '';
        const videoUrlInput = document.getElementById('ma-video-url');
        if (videoUrlInput) videoUrlInput.value = '';


        // Media load
        if (isEdit) {
            if (item.imageUrls) {
                try { currentMAImages = JSON.parse(item.imageUrls); } catch(e) { currentMAImages = []; }
            } else if (item.imageUrl) {
                currentMAImages = [item.imageUrl];
            } else {
                currentMAImages = [];
            }
            currentMAVideoUrl = item.videoUrl || '';
        } else {
            currentMAImages = [];
            currentMAVideoUrl = '';
        }
        renderMAImageGrid();
        renderMAVideo();

        // Delete button
        document.getElementById('ma-delete-btn').style.display = isEdit ? 'block' : 'none';

        maDrawer.classList.add('active');
        maOverlay.classList.add('active');
        updateMAMarginDisplay();
    }

    function closeMADrawer() {
        maDrawer?.classList.remove('active');
        maOverlay?.classList.remove('active');
        const list = document.getElementById('ma-category-autocomplete-list');
        if (list) {
            list.classList.remove('active');
            list.style.display = 'none';
        }
    }

    // --- Auto-calc shipping when market or weight changes ---
    function autoCalcShipping() {
        const market = document.getElementById('ma-market')?.value || 'sg';
        const weight = parseInt(document.getElementById('ma-weight')?.value) || 0;
        const shipping = calcSellerShipping(weight, market);
        const el = document.getElementById('ma-seller-shipping');
        if (el) el.value = shipping > 0 ? shipping.toFixed(2) : '';
        updateMAMarginDisplay();
    }

    // --- Dynamic Options Logic ---
    function renderShopeeOptionRow(qty = 1, listing = '', actual = '') {
        const div = document.createElement('div');
        div.className = 'shopee-option-row surface-container-lowest';
        div.style.padding = '0.75rem';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid var(--outline-variant)';
        div.style.display = 'flex';
        div.style.gap = '0.5rem';
        div.style.alignItems = 'flex-end';
        div.innerHTML = `
            <div style="flex: 1;"><label class="label-md">옵션 수량</label><input type="number" class="form-input shopee-opt-qty" value="${qty}" min="1"></div>
            <div style="flex: 2;"><label class="label-md">리스팅 가격 (<span class="ma-currency"></span>)</label><input type="number" class="form-input shopee-opt-listing" value="${listing}" min="0" step="0.01"></div>
            <div style="flex: 2;"><label class="label-md">실제 판매가 (<span class="ma-currency"></span>)</label><input type="number" class="form-input shopee-opt-actual" value="${actual}" min="0" step="0.01"></div>
            <button type="button" class="btn-icon btn-remove-shopee-opt" style="margin-bottom: 0.25rem;"><i class="fa-solid fa-trash text-error"></i></button>
        `;
        div.querySelector('.btn-remove-shopee-opt').addEventListener('click', () => {
            if(document.querySelectorAll('.shopee-option-row').length > 1) div.remove();
            else alert('최소 1개의 옵션이 필요합니다.');
            updateMAMarginDisplay();
        });
        div.querySelectorAll('input').forEach(el => el.addEventListener('input', updateMAMarginDisplay));
        document.getElementById('ma-shopee-options-container').appendChild(div);
        updateMACurrencyLabels();
    }

    function renderSourcingOptionRow(platform = 'Coupang', qty = 1, price = '', shipping = '', url = '') {
        const div = document.createElement('div');
        div.className = 'sourcing-option-row surface-container-lowest';
        div.style.padding = '0.75rem';
        div.style.borderRadius = '8px';
        div.style.border = '1px solid var(--outline-variant)';
        
        const platformOptions = ['Coupang', 'Naver', '1688', 'Taobao', 'Other'].map(p => `<option value="${p}" ${platform===p?'selected':''}>${p}</option>`).join('');
        
        div.innerHTML = `
            <div style="display:flex; gap:0.5rem; align-items:flex-end; width:100%;">
                <div style="flex: 1.5;"><label class="label-md">플랫폼</label><select class="form-select sourcing-opt-platform">${platformOptions}</select></div>
                <div style="flex: 1;"><label class="label-md">묶음수량</label><input type="number" class="form-input sourcing-opt-qty" value="${qty}" min="1"></div>
                <div style="flex: 2;"><label class="label-md">묶음 총액(KRW)</label><input type="number" class="form-input sourcing-opt-price" value="${price}" min="0"></div>
                <div style="flex: 2;"><label class="label-md">배송비(KRW)</label><input type="number" class="form-input sourcing-opt-shipping" value="${shipping}" min="0"></div>
                <button type="button" class="btn-icon btn-remove-sourcing-opt" style="margin-bottom: 0.25rem;"><i class="fa-solid fa-trash text-error"></i></button>
            </div>
            <div style="margin-top:0.5rem;">
                <input type="url" class="form-input sourcing-opt-url" value="${url}" placeholder="상품 URL (선택)" autocomplete="off">
            </div>
        `;
        div.querySelector('.btn-remove-sourcing-opt').addEventListener('click', () => {
            if(document.querySelectorAll('.sourcing-option-row').length > 1) div.remove();
            else alert('최소 1개의 소싱 옵션이 필요합니다.');
            updateMAMarginDisplay();
        });
        div.querySelectorAll('input').forEach(el => el.addEventListener('input', updateMAMarginDisplay));
        document.getElementById('ma-sourcing-options-container').appendChild(div);
    }

    // Hook buttons
    document.getElementById('btn-add-shopee-option')?.addEventListener('click', () => renderShopeeOptionRow());
    document.getElementById('btn-add-sourcing-option')?.addEventListener('click', () => renderSourcingOptionRow());

    // --- Margin display ---
    function updateMAMarginDisplay() {
        let lowestUnitCost = Infinity;
        let sourcePlatform = '';
        
        document.querySelectorAll('.sourcing-option-row').forEach(row => {
            const platform = row.querySelector('.sourcing-opt-platform')?.value || 'Other';
            const qty = parseInt(row.querySelector('.sourcing-opt-qty')?.value) || 1;
            const price = parseFloat(row.querySelector('.sourcing-opt-price')?.value) || 0;
            const ship = parseFloat(row.querySelector('.sourcing-opt-shipping')?.value) || 0;
            if (price > 0) {
                const cost = (price + ship) / qty;
                if (cost < lowestUnitCost) {
                    lowestUnitCost = cost;
                    sourcePlatform = platform;
                }
            }
        });

        if (lowestUnitCost === Infinity) {
            lowestUnitCost = 0;
            sourcePlatform = '';
        }

        const lowestEl = document.getElementById('ma-lowest-source');
        if (lowestUnitCost > 0) {
            lowestEl.innerText = `KRW ${Number(Math.round(lowestUnitCost)).toLocaleString()} (${sourcePlatform})`;
        } else {
            lowestEl.innerText = '-';
        }

        // Preview margin for the FIRST Shopee option
        const firstShopeeRow = document.querySelector('.shopee-option-row');
        const actualPrice = firstShopeeRow ? parseFloat(firstShopeeRow.querySelector('.shopee-opt-actual')?.value) || 0 : 0;
        const shopeeQty = firstShopeeRow ? parseInt(firstShopeeRow.querySelector('.shopee-opt-qty')?.value) || 1 : 1;

        const sellerShip = parseFloat(document.getElementById('ma-seller-shipping')?.value) || 0;
        const exchangeRate = parseFloat(document.getElementById('ma-exchange-rate')?.value) || 0;

        const market = document.getElementById('ma-market')?.value || 'sg';
        const map = { sg: 'SGD', my: 'MYR', tw: 'TWD', th: 'THB', ph: 'PHP', vn: 'VND', br: 'BRL', mx: 'MXN' };
        const currency = map[market] || 'SGD';

        const marginEl = document.getElementById('ma-estimated-margin');
        const marginSgdEl = document.getElementById('ma-estimated-margin-sgd');
        const marginRateEl = document.getElementById('ma-margin-rate');

        if (actualPrice > 0 && lowestUnitCost > 0 && exchangeRate > 0) {
            const totalSourcingKrw = lowestUnitCost * shopeeQty;
            const totalCostLocal = totalSourcingKrw / exchangeRate;
            const totalMarginLocal = actualPrice - totalCostLocal - sellerShip;
            const marginKrw = totalMarginLocal * exchangeRate;
            const marginRate = (totalMarginLocal / actualPrice) * 100;
            
            marginEl.innerText = `KRW ${Math.round(marginKrw).toLocaleString()}`;
            if (marginSgdEl) marginSgdEl.innerText = `${currency} ${totalMarginLocal.toFixed(2)}`;
            if (marginRateEl) marginRateEl.innerText = `(${marginRate.toFixed(1)}%)`;
            
            if (totalMarginLocal > 0) {
                marginEl.style.color = 'var(--primary)';
                if (marginRateEl) marginRateEl.style.color = 'var(--primary)';
            } else {
                marginEl.style.color = 'var(--error)';
                if (marginRateEl) marginRateEl.style.color = 'var(--error)';
            }
        } else {
            marginEl.innerText = '-';
            if (marginSgdEl) marginSgdEl.innerText = '-';
            if (marginRateEl) marginRateEl.innerText = '(0%)';
            marginEl.style.color = '';
            if (marginRateEl) marginRateEl.style.color = 'var(--text-secondary)';
        }
    }
    
    function updateMACurrencyLabels() {
        const market = document.getElementById('ma-market')?.value || 'sg';
        const map = { sg: 'SGD', my: 'MYR', tw: 'TWD', th: 'THB', ph: 'PHP', vn: 'VND', br: 'BRL', mx: 'MXN' };
        const currency = map[market] || 'SGD';
        document.querySelectorAll('.ma-currency').forEach(el => {
            el.innerText = currency;
        });
        updateMAMarginDisplay();
    }

    // --- Save / Update ---
    async function saveMAItem() {
        const editId = document.getElementById('ma-edit-id')?.value;

        // Collect Sourcing Options
        const sourcingOptions = [];
        document.querySelectorAll('.sourcing-option-row').forEach(row => {
            const platform = row.querySelector('.sourcing-opt-platform').value;
            const qty = parseInt(row.querySelector('.sourcing-opt-qty').value) || 1;
            const price = parseFloat(row.querySelector('.sourcing-opt-price').value) || 0;
            const shipping = parseFloat(row.querySelector('.sourcing-opt-shipping').value) || 0;
            const url = row.querySelector('.sourcing-opt-url').value || '';
            if (price > 0) {
                sourcingOptions.push({ platform, qty, price, shipping, url });
            }
        });
        
        const commonData = {
            market: document.getElementById('ma-market')?.value || 'sg',
            exchangeRate: parseFloat(document.getElementById('ma-exchange-rate')?.value) || null,
            shopeeCategory: document.getElementById('ma-category')?.value || '',
            productName: document.getElementById('ma-product-name')?.value || '',
            storeName: document.getElementById('ma-store-name')?.value || '',
            monthlySales: parseInt(document.getElementById('ma-monthly-sales')?.value) || 0,
            weight: parseInt(document.getElementById('ma-weight')?.value) || 0,
            sellerShipping: parseFloat(document.getElementById('ma-seller-shipping')?.value) || 0,
            shopeeUrl: document.getElementById('ma-shopee-url')?.value || '',
            note: document.getElementById('ma-note')?.value || '',
            imageUrls: currentMAImages,
            videoUrl: currentMAVideoUrl,
            sourcingOptions: JSON.stringify(sourcingOptions),
            // Legacy fallbacks
            coupangPrice: 0, coupangShipping: 0, coupangRocket: 0,
            naverPrice: 0, naverShipping: 0, coupangUrl: '', naverUrl: ''
        };

        try {
            if (editId) {
                // Edit Mode
                const row = document.querySelector('.shopee-option-row');
                const shopeeQty = parseInt(row.querySelector('.shopee-opt-qty')?.value) || 1;
                const listingPrice = parseFloat(row.querySelector('.shopee-opt-listing')?.value) || 0;
                const actualPrice = parseFloat(row.querySelector('.shopee-opt-actual')?.value) || 0;
                
                await api.updateMarketAnalysis(editId, { ...commonData, shopeeQty, listingPrice, actualPrice });
            } else {
                // Create Mode
                const promises = [];
                document.querySelectorAll('.shopee-option-row').forEach(row => {
                    const shopeeQty = parseInt(row.querySelector('.shopee-opt-qty').value) || 1;
                    const listingPrice = parseFloat(row.querySelector('.shopee-opt-listing').value) || 0;
                    const actualPrice = parseFloat(row.querySelector('.shopee-opt-actual').value) || 0;
                    if (actualPrice > 0) {
                        promises.push(api.createMarketAnalysis({ ...commonData, shopeeQty, listingPrice, actualPrice }));
                    }
                });
                
                if (promises.length === 0) throw new Error('유효한 쇼피 옵션을 1개 이상 입력하세요.');
                await Promise.all(promises);
            }
            closeMADrawer();
            loadMarketAnalysis();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    }

    // --- Delete ---
    async function deleteMAItem() {
        const editId = document.getElementById('ma-edit-id')?.value;
        if (!editId) return;
        if (!confirm('이 분석 데이터를 삭제하시겠습니까?')) return;
        try {
            await api.deleteMarketAnalysis(editId);
            closeMADrawer();
            loadMarketAnalysis();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    }

    // --- Image/Video upload handlers ---
    document.getElementById('ma-image-add-btn')?.addEventListener('click', () => {
        document.getElementById('ma-image-file')?.click();
    });

    document.getElementById('ma-image-file')?.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        for(let i = 0; i < files.length; i++) {
            if (currentMAImages.length >= 9) {
                alert('이미지는 최대 9장까지만 업로드 가능합니다.');
                break;
            }
            try {
                const result = await api.uploadMarketAnalysisImage(files[i]);
                currentMAImages.push(result.url);
            } catch (err) {
                alert('이미지 업로드 실패: ' + err.message);
            }
        }
        renderMAImageGrid();
        e.target.value = ''; // reset
    });

    document.getElementById('ma-video-preview')?.addEventListener('click', () => {
        document.getElementById('ma-video-file')?.click();
    });

    document.getElementById('ma-video-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validation
        if (file.size > 30 * 1024 * 1024) {
            alert('동영상 크기는 30MB를 초과할 수 없습니다.');
            e.target.value = '';
            return;
        }
        
        // Check duration using temp video element
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = async function() {
            window.URL.revokeObjectURL(video.src);
            const duration = video.duration;
            if (duration < 10 || duration > 60) {
                alert(`동영상 길이는 10초에서 60초 사이여야 합니다. (현재: ${Math.round(duration)}초)`);
                e.target.value = '';
                return;
            }
            
            // Validation passed, upload
            try {
                const result = await api.uploadMarketAnalysisVideo(file);
                currentMAVideoUrl = result.url;
                renderMAVideo();
            } catch (err) {
                alert('동영상 업로드 실패: ' + err.message);
            }
            e.target.value = '';
        };
        video.src = URL.createObjectURL(file);
    });

    
    document.getElementById('ma-image-url')?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = e.target.value.trim();
        if (!url) return;
        if (currentMAImages.length >= 9) {
            alert('이미지는 최대 9장까지만 업로드 가능합니다.');
            return;
        }
        try {
            const result = await api.uploadMarketAnalysisImageUrl(url);
            currentMAImages.push(result.url);
            renderMAImageGrid();
            e.target.value = '';
        } catch (err) {
            alert('이미지 URL 업로드 실패: ' + err.message);
        }
    });

    document.getElementById('ma-video-url')?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = e.target.value.trim();
        if (!url) return;
        try {
            const result = await api.uploadMarketAnalysisVideoUrl(url);
            currentMAVideoUrl = result.url;
            renderMAVideo();
            e.target.value = '';
        } catch (err) {
            alert('동영상 URL 업로드 실패: ' + err.message);
        }
    });

    document.getElementById('ma-video-remove-btn')?.addEventListener('click', () => {
        currentMAVideoUrl = '';
        renderMAVideo();
    });

    // --- MA Category Autocomplete ---
    const maInputCategorySearch = document.getElementById('ma-category');
    const maCategoryAutocompleteList = document.getElementById('ma-category-autocomplete-list');

    function renderMACategoryAutocomplete(query) {
        if (!query) {
            if(maCategoryAutocompleteList) {
                maCategoryAutocompleteList.innerHTML = '';
                maCategoryAutocompleteList.classList.remove('active');
                maCategoryAutocompleteList.style.display = 'none';
            }
            return;
        }

        const lowerQuery = query.toLowerCase();
        const categories = window.SHOPEE_CATEGORIES || [];
        const filtered = categories.filter(cat => 
            cat.en.toLowerCase().includes(lowerQuery) || 
            cat.ko.includes(lowerQuery)
        );

        if(!maCategoryAutocompleteList) return;

        if (filtered.length === 0) {
            maCategoryAutocompleteList.innerHTML = '<li style="color:var(--text-disabled); cursor:default;">검색 결과가 없습니다.</li>';
        } else {
            maCategoryAutocompleteList.innerHTML = filtered.map(cat => `
                <li data-en="${cat.en}" data-ko="${cat.ko}">
                    <span class="cat-en">${cat.en}</span>
                    <span class="cat-ko">${cat.ko}</span>
                </li>
            `).join('');
        }
        maCategoryAutocompleteList.classList.add('active');
        maCategoryAutocompleteList.style.display = 'block';
    }

    if (maInputCategorySearch) {
        maInputCategorySearch.addEventListener('input', (e) => {
            renderMACategoryAutocomplete(e.target.value);
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#ma-category-autocomplete-list') && e.target !== maInputCategorySearch) {
                if(maCategoryAutocompleteList) {
                    maCategoryAutocompleteList.classList.remove('active');
                    maCategoryAutocompleteList.style.display = 'none';
                }
            }
        });

        if(maCategoryAutocompleteList) {
            maCategoryAutocompleteList.addEventListener('click', (e) => {
                const li = e.target.closest('li');
                if (!li || !li.dataset.en) return;
                
                maInputCategorySearch.value = li.dataset.en; // Store English only
                maCategoryAutocompleteList.classList.remove('active');
                maCategoryAutocompleteList.style.display = 'none';
            });
        }
    }

    // --- Event Listeners ---
    document.getElementById('btn-add-ma')?.addEventListener('click', () => openMADrawer(null));
    document.getElementById('ma-drawer-close')?.addEventListener('click', closeMADrawer);
    document.getElementById('ma-drawer-overlay')?.addEventListener('click', closeMADrawer);
    document.getElementById('ma-save-btn')?.addEventListener('click', saveMAItem);
    document.getElementById('ma-delete-btn')?.addEventListener('click', deleteMAItem);
    document.getElementById('ma-market-filter')?.addEventListener('change', loadMarketAnalysis);

    // Auto-calc shipping on market or weight change
    document.getElementById('ma-market')?.addEventListener('change', (e) => {
        const isEdit = document.getElementById('ma-edit-id').value !== '';
        if (!isEdit) {
            document.getElementById('ma-exchange-rate').value = window.latestExchangeRates[e.target.value] || '';
            updateMAMarginDisplay();
        }
        autoCalcShipping();
        updateMACurrencyLabels();
    });
    document.getElementById('ma-weight')?.addEventListener('input', autoCalcShipping);

    // Update margin display on domestic price changes
    ['ma-coupang-price', 'ma-coupang-shipping', 'ma-naver-price', 'ma-naver-shipping', 'ma-actual-price', 'ma-seller-shipping', 'ma-exchange-rate'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateMAMarginDisplay);
    });

    // Table row click → open drawer (skip if checkbox area)
    document.getElementById('ma-table-body')?.addEventListener('click', (e) => {
        if (e.target.closest('.td-checkbox') || e.target.tagName === 'INPUT') return;
        const btn = e.target.closest('.ma-edit-btn');
        const tr = e.target.closest('tr[data-id]');
        if (btn || tr) {
            const id = btn ? btn.getAttribute('data-id') : tr.getAttribute('data-id');
            const item = maData.find(d => d.id === id);
            if (item) openMADrawer(item);
        }
    });

    // --- MA Bulk Action Logic ---
    const maCheckAll = document.getElementById('ma-check-all');
    const maBulkBar = document.getElementById('ma-bulk-action-bar');
    const maBulkCount = document.getElementById('ma-bulk-count');
    const maBtnDeleteBulk = document.getElementById('ma-btn-delete-bulk');

    function updateMABulkBar() {
        const checkboxes = document.querySelectorAll('.ma-row-checkbox');
        const checked = document.querySelectorAll('.ma-row-checkbox:checked');
        const count = checked.length;
        if (maBulkCount) maBulkCount.innerText = count;
        if (maBulkBar) {
            if (count > 0) maBulkBar.classList.add('active');
            else maBulkBar.classList.remove('active');
        }
        if (maCheckAll) {
            maCheckAll.checked = count > 0 && count === checkboxes.length;
            maCheckAll.indeterminate = count > 0 && count < checkboxes.length;
        }
        // Update selected row styling
        document.querySelectorAll('#ma-table-body .ma-row').forEach(r => {
            const cb = r.querySelector('.ma-row-checkbox');
            if (cb && cb.checked) r.classList.add('row-selected');
            else r.classList.remove('row-selected');
        });
    }

    // Delegate checkbox change
    document.getElementById('ma-table-body')?.addEventListener('change', (e) => {
        if (e.target.classList.contains('ma-row-checkbox')) updateMABulkBar();
    });

    if (maCheckAll) {
        maCheckAll.addEventListener('change', (e) => {
            document.querySelectorAll('.ma-row-checkbox').forEach(cb => cb.checked = e.target.checked);
            updateMABulkBar();
        });
    }

    if (maBtnDeleteBulk) {
        maBtnDeleteBulk.addEventListener('click', async () => {
            const checked = document.querySelectorAll('.ma-row-checkbox:checked');
            if (checked.length === 0) return;
            if (!confirm(`${checked.length}개 항목을 삭제하시겠습니까?`)) return;
            const ids = [];
            checked.forEach(cb => {
                const row = cb.closest('tr[data-id]');
                if (row) ids.push(row.dataset.id);
            });
            try {
                await api.deleteMarketAnalysisMulti(ids);
                await loadMarketAnalysis();
                updateMABulkBar();
            } catch (err) {
                alert('삭제 실패: ' + err.message);
            }
        });
    }

    // --- Product List Bulk Delete ---
    document.getElementById('btn-delete-bulk')?.addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        if (checked.length === 0) return;
        if (!confirm(`${checked.length}개 상품을 삭제하시겠습니까?`)) return;
        const ids = [];
        checked.forEach(cb => {
            const row = cb.closest('tr[data-product-id]');
            if (row) ids.push(row.dataset.productId);
        });
        try {
            await api.deleteProducts(ids);
            productList = await api.getProducts();
            renderProductListTable();
            if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    });

    // --- Keyboard Navigation for MA Table ---
    let maKbIndex = -1;
    document.addEventListener('keydown', (e) => {
        // Only active when MA view is visible
        const maView = document.getElementById('view-market-analysis');
        if (!maView || !maView.classList.contains('active')) return;
        // Don't interfere with inputs/drawers
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (document.querySelector('.drawer.active')) return;

        const rows = Array.from(document.querySelectorAll('#ma-table-body .ma-row'));
        if (rows.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            maKbIndex = Math.min(maKbIndex + 1, rows.length - 1);
            updateMAKbFocus(rows);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            maKbIndex = Math.max(maKbIndex - 1, 0);
            updateMAKbFocus(rows);
        } else if (e.key === ' ' && maKbIndex >= 0) {
            e.preventDefault();
            const cb = rows[maKbIndex].querySelector('.ma-row-checkbox');
            if (cb) { cb.checked = !cb.checked; updateMABulkBar(); }
        } else if (e.key === 'Enter' && maKbIndex >= 0) {
            e.preventDefault();
            const id = rows[maKbIndex].dataset.id;
            const item = maData.find(d => d.id === id);
            if (item) openMADrawer(item);
        }
    });

    function updateMAKbFocus(rows) {
        rows.forEach(r => r.classList.remove('kb-focused'));
        if (maKbIndex >= 0 && rows[maKbIndex]) {
            rows[maKbIndex].classList.add('kb-focused');
            rows[maKbIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // Reset kb index when MA data reloads
    const origLoadMA = loadMarketAnalysis;
    // (No reassignment needed — maKbIndex resets naturally on interaction)

    // --- Universal Sortable Table Headers ---
    let sortState = {}; // { tableId: { key, dir } }

    function applySortToTable(tableId, dataArray, key, renderFn) {
        if (!sortState[tableId] || sortState[tableId].key !== key) {
            sortState[tableId] = { key, dir: 'asc' };
        } else {
            sortState[tableId].dir = sortState[tableId].dir === 'asc' ? 'desc' : 'asc';
        }
        const dir = sortState[tableId].dir;
        const mult = dir === 'asc' ? 1 : -1;

        dataArray.sort((a, b) => {
            let va = a[key], vb = b[key];
            // Handle computed sort keys
            if (key === 'lowestKrw') { va = a._lowestKrw || 0; vb = b._lowestKrw || 0; }
            if (key === 'marginKrw') { va = a._marginKrw || 0; vb = b._marginKrw || 0; }
            if (va == null) va = '';
            if (vb == null) vb = '';
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
            return String(va).localeCompare(String(vb), 'ko') * mult;
        });

        renderFn();

        // Update header icons
        const table = document.getElementById(tableId);
        if (table) {
            table.querySelectorAll('.sortable-th').forEach(th => {
                th.classList.remove('sort-asc', 'sort-desc');
                const icon = th.querySelector('.sort-icon');
                if (icon) icon.className = 'fa-solid fa-sort sort-icon';
            });
            const activeTh = table.querySelector(`.sortable-th[data-sort-key="${key}"]`);
            if (activeTh) {
                activeTh.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
                const icon = activeTh.querySelector('.sort-icon');
                if (icon) icon.className = `fa-solid fa-sort-${dir === 'asc' ? 'up' : 'down'} sort-icon`;
            }
        }
    }

    // MA table sort
    document.querySelectorAll('#ma-table .sortable-th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (!key) return;
            applySortToTable('ma-table', maData, key, renderMATable);
        });
    });

    // Product List table sort
    document.querySelectorAll('#view-product-list .sortable-th').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey;
            if (!key) return;
            applySortToTable(th.closest('table')?.id || 'pl-table', productList, key, renderProductListTable);
        });
    });


    // --- Helper for Autocomplete Keyboard Navigation ---
    function attachAutocompleteKeyboardNav(inputEl, listEl) {
        if (!inputEl || !listEl) return;
        let currentFocus = -1;

        inputEl.addEventListener('input', () => {
            currentFocus = -1;
        });

        inputEl.addEventListener('keydown', (e) => {
            let x = listEl.getElementsByTagName('li');
            if (!x || x.length === 0) return;
            
            if (e.key === 'ArrowDown') {
                currentFocus++;
                addActive(x);
                if(x[currentFocus]) x[currentFocus].scrollIntoView({block: 'nearest'});
            } else if (e.key === 'ArrowUp') {
                currentFocus--;
                addActive(x);
                if(x[currentFocus]) x[currentFocus].scrollIntoView({block: 'nearest'});
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentFocus > -1) {
                    if (x) x[currentFocus].click();
                } else if (x.length > 0) { // If no selection, select first item
                    x[0].click();
                }
            }
        });

        function addActive(x) {
            if (!x) return false;
            removeActive(x);
            if (currentFocus >= x.length) currentFocus = 0;
            if (currentFocus < 0) currentFocus = (x.length - 1);
            x[currentFocus].classList.add('autocomplete-active');
        }

        function removeActive(x) {
            for (let i = 0; i < x.length; i++) {
                x[i].classList.remove('autocomplete-active');
            }
        }
    }

    attachAutocompleteKeyboardNav(inputCategorySearch, categoryAutocompleteList);
    attachAutocompleteKeyboardNav(maInputCategorySearch, maCategoryAutocompleteList);

    // Load Exchange Rates on initialization
    window.latestExchangeRates = {};
    try {
        api.getExchangeRates()
            .then(rates => {
                if(rates) window.latestExchangeRates = rates;
                console.log('[INIT] Exchange rates loaded:', rates);
            })
            .catch(err => console.error("[INIT] Failed to load exchange rates:", err));
    } catch (err) {
        console.error("[INIT] Exchange rate init error:", err);
    }

    // Hook into nav: when market-analysis view becomes active, load data
    const origNavHandler = navItems;
    navItems.forEach(item => {
        const origHandler = item._maHandler;
        item.addEventListener('click', () => {
            const viewId = item.getAttribute('data-view');
            if (viewId === 'market-analysis') {
                loadMarketAnalysis();
            }
        });
    });

    // renderPriceCalcGrid는 nav 핸들러 이전으로 이동됨 (line ~105)

    // Restore active view from localStorage on load
    // ※ 모든 모듈 초기화가 완료된 후 실행해야 TDZ 에러를 방지합니다.
    const savedViewId = localStorage.getItem('activeViewId');
    if (savedViewId) {
        const targetNav = document.querySelector(`.sidebar .nav-item[data-view="${savedViewId}"]`);
        if (targetNav) {
            targetNav.click();
        }
    }
    // --- Smart Pricing Settings Modal Logic ---
    const smartModal = document.getElementById('smart-pricing-modal');
    const btnOpenSmart = document.getElementById('btn-open-smart-pricing-modal');
    const btnCloseSmart = document.getElementById('btn-close-smart-pricing-modal');
    const btnCancelSmart = document.getElementById('btn-cancel-smart-pricing');
    const btnSaveSmart = document.getElementById('btn-save-smart-pricing');

    if (btnOpenSmart) {
        btnOpenSmart.addEventListener('click', () => {
            document.getElementById('smart-margin-safe').value = systemSettings.margin_safe;
            document.getElementById('smart-margin-standard').value = systemSettings.margin_standard;
            document.getElementById('smart-margin-aggressive').value = systemSettings.margin_aggressive;
            smartModal.style.display = 'flex';
        });
    }

    function closeSmartModal() {
        if (smartModal) smartModal.style.display = 'none';
    }

    if (btnCloseSmart) btnCloseSmart.addEventListener('click', closeSmartModal);
    if (btnCancelSmart) btnCancelSmart.addEventListener('click', closeSmartModal);

    if (btnSaveSmart) {
        btnSaveSmart.addEventListener('click', async () => {
            const safe = document.getElementById('smart-margin-safe').value;
            const standard = document.getElementById('smart-margin-standard').value;
            const aggressive = document.getElementById('smart-margin-aggressive').value;
            
            const newSettings = {
                margin_safe: safe,
                margin_standard: standard,
                margin_aggressive: aggressive
            };
            
            try {
                await api.updateSystemSettings(newSettings);
                systemSettings.margin_safe = Number(safe);
                systemSettings.margin_standard = Number(standard);
                systemSettings.margin_aggressive = Number(aggressive);
                
                showToast('스마트 마진율이 저장되었습니다.', 'success');
                closeSmartModal();
                
                // If in Price Calc, re-render
                if (document.getElementById('view-price-calc-container').classList.contains('active')) {
                    if (typeof currentMarketContext !== 'undefined') {
                        window.renderPriceCalcGrid(currentMarketContext);
                    }
                }
            } catch (err) {
                showToast('저장 실패: ' + err.message, 'error');
            }
        });
    }

    // --- Bulk Apply Presets Logic ---
    const btnApplyBulk = document.getElementById('btn-apply-bulk-presets');
    if (btnApplyBulk) {
        btnApplyBulk.addEventListener('click', async () => {
            const feeId = document.getElementById('pc-fee-preset')?.value;
            const promoId = document.getElementById('pc-promo-preset')?.value;
            const shipId = document.getElementById('pc-ship-preset')?.value;
            
            if (!feeId || !promoId || !shipId) {
                showToast('적용할 프리셋을 모두 선택해주세요.', 'error');
                return;
            }

            const rows = document.querySelectorAll('.pc-product-row');
            if (rows.length === 0) {
                showToast('적용할 상품이 없습니다.', 'error');
                return;
            }

            if (!confirm(`현재 화면에 있는 ${rows.length}개 상품의 프리셋을 모두 덮어쓰시겠습니까? (이 작업은 되돌릴 수 없습니다)`)) {
                return;
            }

            btnApplyBulk.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 적용 중...';
            btnApplyBulk.disabled = true;

            let successCount = 0;
            const promises = Array.from(rows).map(async (row) => {
                const id = row.dataset.productId;
                if (!id) return;
                
                try {
                    await api.updateMarketExportSettings(id, {
                        feePresetId: feeId,
                        promoPresetId: promoId,
                        shipPresetId: shipId
                    });
                    successCount++;
                } catch (e) {
                    console.error(`Error updating product ${id}:`, e);
                }
            });

            await Promise.all(promises);

            btnApplyBulk.innerHTML = '전체 덮어쓰기';
            btnApplyBulk.disabled = false;
            
            showToast(`${successCount}개 상품에 프리셋이 일괄 적용되었습니다.`, 'success');
            
            // Re-render grid to apply the new calculation and UI
            if (typeof currentMarketContext !== 'undefined') {
                window.renderPriceCalcGrid(currentMarketContext);
            }
        });
    }

});
