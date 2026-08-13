function executePrint() {
    const mode = document.querySelector('input[name="printMode"]:checked').value;
    
    let opts = { mode };
    
    if (mode === 'custom') {
        opts.showSettlementInfo = document.getElementById('chkPrint_SettlementInfo').checked;
        opts.showSettlementName = document.getElementById('chkPrint_SettlementName').checked;
        opts.showSettlementDate = document.getElementById('chkPrint_SettlementDate').checked;
        opts.showSettlementStatus = document.getElementById('chkPrint_SettlementStatus').checked;

        opts.showQuoteInfo = document.getElementById('chkPrint_QuoteInfo').checked;
        opts.showQuoteName = document.getElementById('chkPrint_QuoteName').checked;
        opts.showQuoteDate = document.getElementById('chkPrint_QuoteDate').checked;
        opts.showShipmentType = document.getElementById('chkPrint_ShipmentType').checked;
        opts.showPolPod = document.getElementById('chkPrint_PolPod').checked;
        opts.showForwarder = document.getElementById('chkPrint_Forwarder').checked;
        opts.showIncoterms = document.getElementById('chkPrint_Incoterms').checked;

        opts.showDash = document.getElementById('chkPrint_Dashboard').checked;
        opts.showAncillary = document.getElementById('chkPrint_Ancillary').checked;
        opts.showSummary = document.getElementById('chkPrint_Summary').checked;
        
        opts.showItemCost = document.getElementById('chkPrint_ItemCost').checked;
        opts.showItemCostValue = document.getElementById('chkPrint_ItemCostValue').checked;
        opts.showItemCostVolume = document.getElementById('chkPrint_ItemCostVolume').checked;
        opts.showRemarks = document.getElementById('chkPrint_Remarks').checked;
    } else if (mode === 'detailed') {
        opts.showSettlementInfo = opts.showSettlementName = opts.showSettlementDate = opts.showSettlementStatus = true;
        opts.showQuoteInfo = opts.showQuoteName = opts.showQuoteDate = opts.showShipmentType = opts.showPolPod = opts.showForwarder = opts.showIncoterms = true;
        opts.showDash = opts.showAncillary = opts.showSummary = true;
        opts.showItemCost = opts.showItemCostValue = opts.showItemCostVolume = true;
        opts.showRemarks = true;
    } else { // summary
        opts.showSettlementInfo = opts.showSettlementName = opts.showSettlementDate = opts.showSettlementStatus = true;
        opts.showQuoteInfo = opts.showQuoteName = opts.showQuoteDate = opts.showShipmentType = opts.showPolPod = opts.showForwarder = opts.showIncoterms = true;
        opts.showDash = opts.showSummary = opts.showRemarks = true;
        opts.showAncillary = opts.showItemCost = opts.showItemCostValue = opts.showItemCostVolume = false;
    }

    const html = generatePrintTemplate(opts);

    document.getElementById('printContainer').innerHTML = html;
    document.getElementById('printOptionModal').classList.remove('active');
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            document.getElementById('printContainer').innerHTML = '';
        }, 500);
    }, 100);
}
