
function executePrint() {
    const mode = document.querySelector('input[name="printMode"]:checked').value;
    
    // Check custom options
    const showInfo = mode !== 'custom' || document.getElementById('chkPrintInfo').checked;
    const showDash = mode !== 'custom' || document.getElementById('chkPrintDash').checked;
    const showAncillary = mode === 'detailed' || (mode === 'custom' && document.getElementById('chkPrintAncillary').checked);
    const showSummary = mode === 'summary' || mode === 'detailed' || (mode === 'custom' && document.getElementById('chkPrintSummary').checked);
    const showItems = mode === 'detailed' || (mode === 'custom' && document.getElementById('chkPrintItems').checked);

    const html = generatePrintTemplate({
        mode, showInfo, showDash, showAncillary, showSummary, showItems
    });

    document.getElementById('printContainer').innerHTML = html;
    document.getElementById('printOptionModal').classList.remove('active');
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            document.getElementById('printContainer').innerHTML = '';
        }, 500);
    }, 100);
}

function generatePrintTemplate(opts) {
    const d = state.doc;
    if (!d) return "";
    
    let html = `<div class="print-report">`;
    
    // Header (Always show)
    html += `
        <div class="print-header">
            <h1 class="print-title">실수입비용 정산서</h1>
        </div>
    `;

    // 1. Info
    if (opts.showInfo) {
        html += `
        <div class="print-section">
            <h2 class="section-title">1. 정산 및 연동 정보</h2>
            <table class="print-info-table">
                <tr>
                    <th>정산 문서명</th><td>${d.title || '-'}</td>
                    <th>정산 일자</th><td>${d.settlementDate || '-'}</td>
                    <th>상태</th><td>${d.status === 'completed' ? '완료' : '작성 중'}</td>
                </tr>
            </table>
            <h3 class="sub-title">포워더 견적 정보 (원본)</h3>
            <table class="print-info-table">
                <tr>
                    <th>견적명</th><td colspan="3">${d.quotationSnapshot?.title || '-'}</td>
                </tr>
                <tr>
                    <th>견적일</th><td>${d.quotationSnapshot?.date || '-'}</td>
                    <th>선적형태</th><td>${d.quotationSnapshot?.shipmentType || '-'}</td>
                </tr>
                <tr>
                    <th>POL / POD</th><td>${d.quotationSnapshot?.pol || '-'} / ${d.quotationSnapshot?.pod || '-'}</td>
                    <th>적용 포워더</th><td>${d.quotationSnapshot?.forwarderName || '-'}</td>
                </tr>
            </table>
        </div>`;
    }

    // 2. Dash
    if (opts.showDash) {
        const estStr = document.getElementById('dashTotalEstimated').innerText;
        const billedStr = document.getElementById('dashTotalBilled').innerText;
        const varStr = document.getElementById('dashCostVariance').innerText;
        const exchStr = document.getElementById('dashExchangeGainLoss').innerText;

        html += `
        <div class="print-section">
            <h2 class="section-title">2. 종합 요약 대시보드</h2>
            <table class="print-dash-table">
                <tr>
                    <th>예상 총 견적비용</th>
                    <th>실제 총 투입비용</th>
                    <th>순수 물류비 증감</th>
                    <th>총 환차익 / 환차손</th>
                </tr>
                <tr>
                    <td class="bold-value">${estStr}</td>
                    <td class="bold-value highlight">${billedStr}</td>
                    <td class="bold-value">${varStr}</td>
                    <td class="bold-value">${exchStr}</td>
                </tr>
            </table>
        </div>`;
    }

    // 3. Ancillary Costs
    if (opts.showAncillary) {
        html += `
        <div class="print-section">
            <h2 class="section-title">3. 항목별 부대비용 상세 내역</h2>
            <table class="print-data-table">
                <thead>
                    <tr>
                        <th rowspan="2">구분</th>
                        <th rowspan="2">항목명</th>
                        <th colspan="3">예상 견적</th>
                        <th colspan="3">실제 청구 (입력)</th>
                    </tr>
                    <tr>
                        <th>외화금액</th>
                        <th>환율</th>
                        <th>원화(KRW)</th>
                        <th>외화금액</th>
                        <th>환율</th>
                        <th>원화(KRW)</th>
                    </tr>
                </thead>
                <tbody>`;
        
        let hasCosts = false;
        if (d.actualCosts && d.actualCosts.length > 0) {
            d.actualCosts.forEach(cost => {
                hasCosts = true;
                const groupName = cost.group === 'invoice' ? '물품대금' : (cost.group === 'ocean' ? '해상운임' : (cost.group === 'export' ? '수출국비용' : (cost.group === 'import' ? '수입국비용' : (cost.group === 'customs' ? '통관/관세' : (cost.group === 'handling' ? '포워더수수료' : (cost.group === 'finance' ? '금융비용' : '기타'))))));
                
                html += `
                    <tr>
                        <td class="text-center">${groupName}</td>
                        <td>${cost.name}</td>
                        <td class="text-right">${cost.isCustom ? '-' : formatNum(cost.quotedForeign, 2)}</td>
                        <td class="text-right">${cost.isCustom ? '-' : cost.quotedRate}</td>
                        <td class="text-right">\ ${cost.isCustom ? '-' : formatNum(cost.quotedAmount)}</td>
                        
                        <td class="text-right font-weight-bold">${formatNum(cost.billedForeign, 2)}</td>
                        <td class="text-right font-weight-bold">${cost.billedRate}</td>
                        <td class="text-right font-weight-bold">\ ${formatNum(cost.billedKrw)}</td>
                    </tr>
                `;
            });
        }
        
        if (!hasCosts) {
            html += `<tr><td colspan="8" class="text-center">등록된 비용 항목이 없습니다.</td></tr>`;
        }

        html += `</tbody></table></div>`;
    }

    // 4. Summary Table
    if (opts.showSummary) {
        html += `
        <div class="print-section">
            <h2 class="section-title">4. 비용 요약 (예상 견적 vs 실제 청구)</h2>
            <table class="print-data-table">
                ${document.getElementById('summaryTableSection').querySelector('.grid-table').innerHTML}
            </table>
        </div>`;
    }

    // 5. Cost Distribution
    if (opts.showItems) {
        html += `
        <div class="print-section">
            <h2 class="section-title">5. 품목별 실수입원가 산출 (가치비례 배분법)</h2>
            <table class="print-data-table">
                ${document.getElementById('costTableValue').innerHTML}
            </table>
            
            <br>
            <h2 class="section-title">6. 품목별 실수입원가 산출 (체적/운임톤 배분법)</h2>
            <table class="print-data-table">
                ${document.getElementById('costTableVolume').innerHTML}
            </table>
        </div>`;
    }
    
    // Remarks
    if (opts.showInfo) {
        html += `
        <div class="print-section">
            <h2 class="section-title">비고 및 특이사항</h2>
            <div class="print-remarks">
                ${(d.remarks || "").replace(/\n/g, "<br>")}
            </div>
        </div>`;
    }

    html += `</div>`;
    return html;
}

