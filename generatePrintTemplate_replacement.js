function generatePrintTemplate(opts) {
    const d = state.doc;
    if (!d) return "";
    
    let sectionNum = 1;
    let html = `<div class="print-report">`;
    
    // Header (Always show)
    html += `
        <div class="print-header">
            <h1 class="print-title">실수입비용 정산서</h1>
        </div>
    `;

    // 1. Info & 2. Quote Info
    if (opts.showSettlementInfo || opts.showQuoteInfo) {
        html += `<div class="print-section">`;
        
        if (opts.showSettlementInfo) {
            html += `<h2 class="section-title">${sectionNum++}. 정산 및 연동 정보</h2>`;
            if (opts.showSettlementName || opts.showSettlementDate || opts.showSettlementStatus) {
                html += `<table class="print-info-table"><tr>`;
                if (opts.showSettlementName) html += `<th>정산 문서명</th><td>${d.title || '-'}</td>`;
                if (opts.showSettlementDate) html += `<th>정산 일자</th><td>${d.settlementDate || '-'}</td>`;
                if (opts.showSettlementStatus) html += `<th>상태</th><td>${d.status === 'completed' ? '완료' : '작성 중'}</td>`;
                html += `</tr></table>`;
            }
        }

        if (opts.showQuoteInfo) {
            html += `<h3 class="sub-title">포워더 견적 정보 (원본)</h3>`;
            if (opts.showQuoteName || opts.showQuoteDate || opts.showShipmentType || opts.showPolPod || opts.showForwarder || opts.showIncoterms) {
                html += `<table class="print-info-table">`;
                if (opts.showQuoteName) {
                    html += `<tr><th>견적명</th><td colspan="5">${d.quotationSnapshot?.title || '-'}</td></tr>`;
                }
                
                let cells = [];
                if (opts.showQuoteDate) cells.push(`<th>견적일</th><td>${d.quotationSnapshot?.date || '-'}</td>`);
                if (opts.showShipmentType) cells.push(`<th>선적형태</th><td>${d.quotationSnapshot?.shipmentType || '-'}</td>`);
                if (opts.showPolPod) cells.push(`<th>POL / POD</th><td>${d.quotationSnapshot?.pol || '-'} / ${d.quotationSnapshot?.pod || '-'}</td>`);
                if (opts.showForwarder) cells.push(`<th>적용 포워더</th><td>${d.quotationSnapshot?.forwarderName || '-'}</td>`);
                if (opts.showIncoterms) cells.push(`<th>기준 인코텀즈</th><td>${d.quotationSnapshot?.incoterms || '-'}</td>`);
                
                // Render cells in chunks of 2 pairs (4 cols) or 3 pairs (6 cols). Let's do 2 pairs per row for cleanliness
                for(let i=0; i<cells.length; i+=2) {
                    html += `<tr>${cells[i]}`;
                    if(i+1 < cells.length) html += cells[i+1];
                    else html += `<th colspan="2"></th>`; // fill empty
                    html += `</tr>`;
                }
                html += `</table>`;
            }
        }
        
        html += `</div>`;
    }

    // 3. Dash
    if (opts.showDash) {
        const estStr = document.getElementById('dashTotalEstimated').innerText;
        const billedStr = document.getElementById('dashTotalBilled').innerText;
        const varStr = document.getElementById('dashCostVariance').innerText;
        const exchStr = document.getElementById('dashExchangeGainLoss').innerText;

        html += `
        <div class="print-section">
            <h2 class="section-title">${sectionNum++}. 종합 요약 대시보드</h2>
            <table class="print-dash-table">
                <tr>
                    ${opts.includeEstimate ? '<th>예상 총 견적비용</th>' : ''}
                    ${opts.includeActual ? '<th>실제 총 투입비용</th>' : ''}
                    ${(opts.includeEstimate && opts.includeActual) ? '<th>순수 물류비 증감</th><th>총 환차익 / 환차손</th>' : ''}
                </tr>
                <tr>
                    ${opts.includeEstimate ? `<td class="bold-value">${estStr}</td>` : ''}
                    ${opts.includeActual ? `<td class="bold-value highlight">${billedStr}</td>` : ''}
                    ${(opts.includeEstimate && opts.includeActual) ? `<td class="bold-value">${varStr}</td><td class="bold-value">${exchStr}</td>` : ''}
                </tr>
            </table>
        </div>`;
    }

    // 4. Ancillary (Cost Details)
    if (opts.showAncillary) {
        html += `
        <div class="print-section">
            <h2 class="section-title">${sectionNum++}. 항목별 비용 정산 및 분석</h2>
            <table class="print-data-table">
                <thead>
                    <tr>
                        <th rowspan="2">구분</th>
                        <th rowspan="2">항목명</th>
                        ${opts.includeEstimate ? '<th colspan="3">예상 견적</th>' : ''}
                        ${opts.includeActual ? '<th colspan="3">실제 청구 (입력)</th>' : ''}
                        ${(opts.includeEstimate && opts.includeActual) ? '<th rowspan="2">증감액 (KRW)</th>' : ''}
                    </tr>
                    <tr>
                        ${opts.includeEstimate ? '<th>외화금액</th><th>환율</th><th>원화(KRW)</th>' : ''}
                        ${opts.includeActual ? '<th>외화금액</th><th>환율</th><th>원화(KRW)</th>' : ''}
                    </tr>
                </thead>
                <tbody>
            `;
            
            let hasCosts = false;
            d.actualCosts.forEach(cost => {
                hasCosts = true;
                const groupName = cost.group === 'invoice' ? '물품대금' : (cost.group === 'ocean' ? '해상운임' : (cost.group === 'export' ? '수출국비용' : (cost.group === 'import' ? '수입국비용' : (cost.group === 'customs' ? '통관/관세' : (cost.group === 'handling' ? '포워더수수료' : (cost.group === 'finance' ? '금융비용' : '기타'))))));
                
                let qCurr = cost.quotedCurrency || cost.currency || 'KRW';
                let qRate = qCurr === 'KRW' ? 1 : ((state.doc.quotationSnapshot && state.doc.quotationSnapshot.exchangeRates) ? (state.doc.quotationSnapshot.exchangeRates[qCurr] || 0) : 0);
                
                html += `
                    <tr>
                        <td class="text-center">${groupName}</td>
                        <td>${cost.label}</td>
                        ${opts.includeEstimate ? `
                        <td class="text-right">${cost.isCustom ? '-' : formatNum(cost.quotedForeign, 2)}</td>
                        <td class="text-right">${cost.isCustom ? '-' : (qRate === 1 ? '-' : formatNum(qRate, 2))}</td>
                        <td class="text-right">₩ ${cost.isCustom ? '-' : formatNum(cost.quotedForeign * qRate)}</td>
                        ` : ''}
                        ${opts.includeActual ? `
                        <td class="text-right font-weight-bold">${formatNum(cost.billedForeign, 2)}</td>
                        <td class="text-right font-weight-bold">${cost.billedRate === 1 ? '-' : formatNum(cost.billedRate, 2)}</td>
                        <td class="text-right font-weight-bold">₩ ${formatNum(cost.billedKrw || (cost.billedForeign * cost.billedRate))}</td>
                        ` : ''}
                        ${(opts.includeEstimate && opts.includeActual) ? `
                        <td class="text-right">₩ ${formatNum((cost.billedKrw || (cost.billedForeign * cost.billedRate)) - (cost.isCustom ? 0 : (cost.quotedForeign * qRate)))}</td>
                        ` : ''}
                    </tr>
                `;
            });

            if (!hasCosts) {
                html += `<tr><td colspan="${2 + (opts.includeEstimate ? 3 : 0) + (opts.includeActual ? 3 : 0) + ((opts.includeEstimate && opts.includeActual) ? 1 : 0)}" class="text-center" style="padding:15px; color:#94a3b8;">입력된 비용 내역이 없습니다.</td></tr>`;
            }

        html += `
                </tbody>
            </table>
        </div>`;
    }

    // 5. Summary
    if (opts.showSummary) {
        // We will generate the summary table HTML manually instead of using DOM innerHTML
        // to properly handle the options.
        const tbody = document.getElementById('summaryTableBody');
        const rows = tbody.querySelectorAll('tr');
        
        let sumHtml = `
            <thead>
                <tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
                    <th style="width:40%; text-align:left; padding:12px;">비용 구분</th>
                    ${opts.includeEstimate ? '<th class="col-num" style="width:20%; padding:12px;">예상 견적 (KRW)</th>' : ''}
                    ${opts.includeActual ? '<th class="col-num highlight-col" style="width:20%; padding:12px;">실제 청구 (KRW)</th>' : ''}
                    ${(opts.includeEstimate && opts.includeActual) ? '<th class="col-num" style="width:20%; padding:12px;">증감액 (KRW)</th>' : ''}
                </tr>
            </thead>
            <tbody>
        `;
        
        rows.forEach(row => {
            if (row.style.display === 'none') return;
            const cells = row.querySelectorAll('td');
            if (cells.length < 4) {
                sumHtml += `<tr>${row.innerHTML}</tr>`;
                return;
            }
            sumHtml += `<tr>`;
            sumHtml += `<td>${cells[0].innerHTML}</td>`;
            if (opts.includeEstimate) sumHtml += `<td class="text-right">${cells[1].innerHTML}</td>`;
            if (opts.includeActual) sumHtml += `<td class="text-right">${cells[2].innerHTML}</td>`;
            if (opts.includeEstimate && opts.includeActual) sumHtml += `<td class="text-right">${cells[3].innerHTML}</td>`;
            sumHtml += `</tr>`;
        });
        sumHtml += `</tbody><tfoot>`;
        const tfoot = document.getElementById('summaryTableFoot');
        if (tfoot) {
            const cells = tfoot.querySelectorAll('td');
            if (cells.length >= 4) {
                sumHtml += `<tr>`;
                sumHtml += `<td>${cells[0].innerHTML}</td>`;
                if (opts.includeEstimate) sumHtml += `<td class="text-right">${cells[1].innerHTML}</td>`;
                if (opts.includeActual) sumHtml += `<td class="text-right">${cells[2].innerHTML}</td>`;
                if (opts.includeEstimate && opts.includeActual) sumHtml += `<td class="text-right">${cells[3].innerHTML}</td>`;
                sumHtml += `</tr>`;
            } else {
                sumHtml += `<tr>${tfoot.innerHTML}</tr>`;
            }
        }
        sumHtml += `</tfoot>`;
        
        html += `
        <div class="print-section">
            <h2 class="section-title">${sectionNum++}. 비용 요약 (예상 견적 vs 실제 청구)</h2>
            <table class="print-data-table">
                ${sumHtml}
            </table>
        </div>`;
    }

    // 6. Items (Cost allocation)
    if (opts.showItemCost) {
        html += `<div class="print-section">`;
        
        const generateItemTable = (tableId) => {
            const table = document.getElementById(tableId);
            if (!table) return "";
            
            let tHtml = `
                <thead>
                    <tr>
                        <th>품명</th>
                        <th class="col-num">수량 / 점유율</th>
                        <th class="col-num">단위당 단가 (외화)</th>
                        <th class="col-num">배분된 부대비용 (외화)</th>
                        <th class="col-num">실수입원가 (외화)</th>
                        <th class="col-num">관세 (KRW)</th>
                        ${opts.includeEstimate ? '<th class="col-num" style="background:#f0fdf4;">예상원가 (KRW)</th>' : ''}
                        ${opts.includeActual ? '<th class="col-num highlight-col">실청구원가 (KRW)</th>' : ''}
                        ${(opts.includeEstimate && opts.includeActual) ? '<th class="col-num">증감</th>' : ''}
                    </tr>
                </thead>
                <tbody>
            `;
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length < 9) {
                    tHtml += `<tr>${row.innerHTML}</tr>`;
                    return;
                }
                tHtml += `<tr>`;
                tHtml += `<td>${cells[0].innerHTML}</td>`;
                tHtml += `<td class="text-right">${cells[1].innerHTML}</td>`;
                tHtml += `<td class="text-right">${cells[2].innerHTML}</td>`;
                tHtml += `<td class="text-right">${cells[3].innerHTML}</td>`;
                tHtml += `<td class="text-right">${cells[4].innerHTML}</td>`;
                tHtml += `<td class="text-right">${cells[5].innerHTML}</td>`;
                if (opts.includeEstimate) tHtml += `<td class="text-right">${cells[6].innerHTML}</td>`;
                if (opts.includeActual) tHtml += `<td class="text-right">${cells[7].innerHTML}</td>`;
                if (opts.includeEstimate && opts.includeActual) tHtml += `<td class="text-right">${cells[8].innerHTML}</td>`;
                tHtml += `</tr>`;
            });
            tHtml += `</tbody>`;
            return tHtml;
        };

        if (opts.showItemCostValue) {
            html += `
                <h2 class="section-title">${sectionNum++}. 품목별 실수입원가 산출 (가치비례 배분법)</h2>
                <table class="print-data-table">
                    ${generateItemTable('costTableValue')}
                </table>
                <br>
            `;
        }
        if (opts.showItemCostVolume) {
            html += `
                <h2 class="section-title">${sectionNum++}. 품목별 실수입원가 산출 (체적/운임톤 배분법)</h2>
                <table class="print-data-table">
                    ${generateItemTable('costTableVolume')}
                </table>
            `;
        }
        html += `</div>`;
    }

    // 7. Remarks
    if (opts.showRemarks) {
        html += `
        <div class="print-section">
            <h2 class="section-title">특이사항 및 비고</h2>
            <div class="print-remarks">
                ${(d.remarks || "").replace(/\\n/g, "<br>")}
            </div>
        </div>`;
    }

    html += `</div>`;
    return html;
}
