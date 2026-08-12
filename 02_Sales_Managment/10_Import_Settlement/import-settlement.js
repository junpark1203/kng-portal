// import-settlement.js

const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';
const API_BASE = '/api/import-settlement';
const QUOTE_API = '/api/forwarder-quotation';

let state = {
    view: 'list',
    list: [],
    quotes: [],
    doc: {
        id: '',
        quotationId: '',
        quotationSnapshot: {},
        title: '',
        settlementDate: '',
        paidRates: { USD: 0, CNY: 0, EUR: 0, JPY: 0 },
        actualCosts: [], // { id, name, unit, currency, billedForeign, billedRate, billedKrw, variance, gainLoss }
        status: 'draft',
        remarks: ''
    }
};

const DEFAULT_COSTS = [
    { key: 'OF', label: '?¥ÏÉÅ?¥ÏûÑ (O/F, Ocean Freight)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'PSS', label: '?±ÏàòÍ∏??†Ï¶ùÎ£?(P.S.S)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'LSS', label: '?Ä?†Ìô©???†Ï¶ùÎ£?(L.S.S)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'BAF', label: '?†Î•ò?†Ï¶ùÎ£?(B.A.F)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CAF', label: '?µÌôîÏ°∞Ï†ï?†Ï¶ùÎ£?(C.A.F)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: true } },

    { key: 'CY', label: 'CYÎπ?(CY Charge)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'PORT', label: '??ßåÎπÑÏö© (Port Charge)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'EDI', label: 'EDI/?úÎ•ò/Î∂Ä??(EDI+Doc+Sur+Bkg)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'THC_E', label: '?∞Î??êÌïò??πÑ ?òÏ∂ú (THC E)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'VGM', label: 'Ï¥ùÏ§ë?âÍ?Ï¶ùÎπÑ (VGM)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'CUST_E', label: '?òÏ∂ú?µÍ?Îπ?(Customs E)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'TRK_E', label: '?¥Î•ô?¥ÏÜ° ?òÏ∂ú (Trucking E)', defaultUnit: 'Lump Sum', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    
    { key: 'CRS', label: 'Ïª®ÌÖå?¥ÎÑà?åÏÜ°Î£?(C.R.S)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'HNDL', label: 'Ï∑®Í∏â?òÏàòÎ£?(Handling Charge)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DO', label: '?îÎ¨º?∏ÎèÑÏßÄ?úÏÑú (D/O)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'THC_I', label: '?∞Î??êÌïò??πÑ ?òÏûÖ (THC I)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'WHFG', label: 'Î∂Ä?êÏÇ¨?©Î£å (Wharfage)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TSF', label: '?∞Î??êÎ≥¥?àÎ£å (TSF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'PSMF', label: '??ßå?àÏ†ÑÍ¥ÄÎ¶¨ÎπÑ (PSMF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CCC', label: 'Ïª®ÌÖå?¥ÎÑà?∏Ï†ïÎπ?(CCC)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DOC', label: '?úÎ•ò?Ä?âÎπÑ (DOC)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'STRIP', label: 'Ïª®ÌÖå?¥ÎÑà?ÅÏ∂úÎ£?(Stripping)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TRK_I', label: '?¥Î•ô?¥ÏÜ° ?òÏûÖ (Trucking I)', defaultUnit: 'Lump Sum', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    
    { key: 'INS', label: '?ÅÌïòÎ≥¥ÌóòÎ£?(Cargo Ins)', defaultUnit: 'Lump Sum', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'CUST_I', label: '?µÍ??òÏàòÎ£?(Customs I)', defaultUnit: 'per B/L', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: true } }
];

const UNIT_OPTIONS = ['Lump Sum', 'per Container', 'per B/L', 'per CBM', 'per R/T', 'per TON', 'per Unit'];

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// ?†Ìã∏Î¶¨Ìã∞
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
async function getToken() {
    try {
        if (window.parent && typeof window.parent.getAuthToken === 'function') {
            let token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) {
                await new Promise(r => setTimeout(r, 500));
                token = await window.parent.getAuthToken();
                retries++;
            }
            return token || '';
        }
    } catch(e) {}
    return '';
}

async function authFetch(url, opts = {}) {
    const token = await getToken();
    opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(SERVER_URL + url, opts);
    if (!res.ok) {
        let errMsg = res.statusText;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch(e) {}
        throw new Error(errMsg);
    }
    return res.json();
}

const formatNum = (num, decimals = 0) => {
    if (num == null || isNaN(Number(num))) return '-';
    return Number(num).toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

const showToast = (msg, isError = false) => {
    const container = document.getElementById('toastContainer');
    if (!container) return alert(msg);
    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : 'success'}`;
    toast.innerHTML = `<i class='bx ${isError ? 'bx-error' : 'bx-check-circle'}'></i> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

function generateId() { return Math.random().toString(36).substr(2, 9); }

window.toggleSummaryDetails = function(key) {
    const rows = document.querySelectorAll(`.detail-row-${key}`);
    const icon = document.getElementById(`icon_${key}`);
    
    let isHidden = false;
    rows.forEach((row, idx) => {
        if (idx === 0) isHidden = row.style.display === 'none';
        row.style.display = isHidden ? 'table-row' : 'none';
    });
    
    if (icon) {
        icon.className = isHidden ? 'bx bx-minus-square' : 'bx bx-plus-square';
    }
};

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// Î≤ÑÌäº ?ôÏûë (?ëÏ? ?§Ïö¥Î°úÎìú ??Î∞îÏù∏??// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadList();
});

function initEvents() {
    document.getElementById('btnNewSettlement').addEventListener('click', openQuoteModal);
    document.getElementById('btnCancelEdit').addEventListener('click', () => switchView('list'));
    document.getElementById('btnCancelEditBottom').addEventListener('click', () => switchView('list'));
    
    document.getElementById('btnSaveSettlement').addEventListener('click', saveSettlement);
    document.getElementById('btnSaveSettlementBottom').addEventListener('click', saveSettlement);
    
    document.getElementById('btnPrint').addEventListener('click', () => document.getElementById('printOptionModal').classList.add('active'));
    document.getElementById('btnClosePrintModal').addEventListener('click', () => document.getElementById('printOptionModal').classList.remove('active'));
    document.getElementById('btnCancelPrintModal').addEventListener('click', () => document.getElementById('printOptionModal').classList.remove('active'));
    document.getElementById('btnExecutePrint').addEventListener('click', executePrint);
    
    const printModeRadios = document.querySelectorAll('input[name="printMode"]');
    printModeRadios.forEach(radio => radio.addEventListener('change', e => {
        document.getElementById('customPrintOptions').style.display = e.target.value === 'custom' ? 'block' : 'none';
    }));

    document.getElementById('btnCloseQuoteModal').addEventListener('click', () => document.getElementById('quoteModal').classList.remove('active'));
    document.getElementById('btnCancelQuoteModal').addEventListener('click', () => document.getElementById('quoteModal').classList.remove('active'));
    document.getElementById('btnConfirmQuote').addEventListener('click', loadSelectedQuote);

    // Í∏∞Î≥∏ ?ïÎ≥¥ ?ÖÎ†•
    ['docTitle', 'docDate', 'docStatus', 'docRemarks'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => {
            const key = id.replace('doc', '');
            state.doc[key.charAt(0).toLowerCase() + key.slice(1)] = e.target.value;
        });
    });
    
    // ?ëÏ?, ?∏ÏáÑ
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);
    
    // Î™©Î°ù ?ÑÏ≤¥ ?†ÌÉù
    document.getElementById('selectAll').addEventListener('change', e => {
        document.querySelectorAll('.row-chk').forEach(cb => cb.checked = e.target.checked);
    });
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
}

function switchView(view) {
    document.getElementById('listView').classList.remove('active');
    document.getElementById('editView').classList.remove('active');
    document.getElementById(view + 'View').classList.add('active');
    state.view = view;
}

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// Î™©Î°ù Í¥ÄÎ¶?// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
async function loadList() {
    try {
        state.list = await authFetch(API_BASE);
        renderList();
    } catch (err) {
        showToast(err.message, true);
    }
}

function renderList() {
    const tbody = document.getElementById('settlementListBody');
    if (state.list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">?Ä?•Îêú ?ïÏÇ∞ ?¥Ïó≠???ÜÏäµ?àÎã§.</td></tr>';
        return;
    }
    
    let html = '';
    state.list.forEach(item => {
        const statusMap = { 'draft': '?ëÏÑ± Ï§?, 'completed': '?ïÏÇ∞ ?ÑÎ£å' };
        html += `
            <tr style="cursor: pointer" onclick="window.editSettlement('${item.id}')">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-chk" value="${item.id}"></td>
                <td><span class="status-badge ${item.status}">${statusMap[item.status] || item.status}</span></td>
                <td style="font-weight: 500;">${item.title}</td>
                <td><span style="color:#64748b; font-size:0.9em;">${item.quotationId}</span></td>
                <td>${item.settlementDate}</td>
                <td>${item.createdAt.split('T')[0]}</td>
                <td class="col-action">
                    <button class="btn-icon" onclick="event.stopPropagation(); window.editSettlement('${item.id}')"><i class='bx bx-edit'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// Í≤¨Ï†Å Î∂àÎü¨?§Í∏∞ (Î™®Îã¨)
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
async function openQuoteModal() {
    try {
        const quotes = await authFetch(QUOTE_API);
        // ?ïÏ†ï??confirmed) Í≤¨Ï†ÅÎß??ÑÌÑ∞Îß?(?êÌïòÎ©?Î™®Îëê ?úÏãú Í∞Ä?? ?¨Í∏∞?úÎäî Î™®Îëê ?úÏãú?òÎêò ÏµúÏã†???ïÎ†¨)
        state.quotes = quotes;
        
        const tbody = document.getElementById('quoteModalBody');
        if (quotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">?Ä?•Îêú ?¨Ïõå??Í≤¨Ï†Å???ÜÏäµ?àÎã§.</td></tr>';
        } else {
            let html = '';
            quotes.forEach((q, idx) => {
                const statusMap = { 'draft': 'Ï¥àÏïà', 'confirmed': '?ïÏ†ï', 'expired': 'ÎßåÎ£å' };
                let fwOptions = (q.forwarders || []).map((fw, fIdx) => `<option value="${fIdx}">${fw.name}</option>`).join('');
                let termOptions = (q.incoterms || []).map(t => `<option value="${t}">${t}</option>`).join('');
                
                html += `
                    <tr>
                        <td><input type="radio" name="selectedQuote" value="${idx}"></td>
                        <td style="font-weight:500;">${q.title}</td>
                        <td><span class="status-badge ${q.status}">${statusMap[q.status] || q.status}</span></td>
                        <td>${q.quoteDate}</td>
                        <td><select id="selFw_${idx}" style="padding:4px;" onchange="document.querySelector('input[name=selectedQuote][value=\\'${idx}\\']').checked=true">${fwOptions}</select></td>
                        <td><select id="selTerm_${idx}" style="padding:4px;" onchange="document.querySelector('input[name=selectedQuote][value=\\'${idx}\\']').checked=true">${termOptions}</select></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }
        document.getElementById('quoteModal').classList.add('active');
    } catch(err) {
        showToast('Í≤¨Ï†Å Î™©Î°ù??Î∂àÎü¨?§Îäî Ï§??§Î•òÍ∞Ä Î∞úÏÉù?àÏäµ?àÎã§.', true);
    }
}

function loadSelectedQuote() {
    const radio = document.querySelector('input[name="selectedQuote"]:checked');
    if (!radio) return showToast('Î∂àÎü¨??Í≤¨Ï†Å???†ÌÉù?òÏÑ∏??', true);
    
    const idx = radio.value;
    const quote = state.quotes[idx];
    const fwIdx = document.getElementById(`selFw_${idx}`).value;
    const term = document.getElementById(`selTerm_${idx}`).value;
    
    if (!fwIdx || !term) return showToast('?¨Ïõå?îÏ? ?∏ÏΩî?ÄÏ¶àÎ? Î™®Îëê ?†ÌÉù?òÏÑ∏??', true);
    
    const forwarder = quote.forwarders[fwIdx];
    
    // ?†Í∑ú ?ïÏÇ∞ Í∞ùÏ≤¥ Ï¥àÍ∏∞??    state.doc = {
        id: '',
        quotationId: quote.id,
        quotationSnapshot: {
            title: quote.title,
            quoteDate: quote.quoteDate,
            shipmentType: quote.shipmentType,
            pol: quote.pol,
            pod: quote.pod,
            containerType: quote.containerType,
            containerQty: quote.containerQty,
            exchangeRates: quote.exchangeRates || {},
            forwarderName: forwarder.name,
            incoterm: term,
            costs: forwarder.costs.filter(c => c.applyTo[term] === true),
            items: quote.items || []
        },
        title: quote.title + ' ?ïÏÇ∞',
        settlementDate: new Date().toISOString().split('T')[0],
        paidRates: { ...quote.exchangeRates }, // Í∏∞Î≥∏?ÅÏúºÎ°?Í≤¨Ï†Å ?òÏú®Î°?Ï¥àÍ∏∞ ?∏ÌåÖ
        actualCosts: [],
        status: 'draft',
        remarks: ''
    };
    
    // Î¨ºÌíà ?ÄÍ∏?Invoice) Ï¥àÍ∏∞??(Í∑∏Î£π??
    const invoiceByCurr = {};
    (quote.items || []).forEach(item => {
        const p = item.prices && item.prices[term] ? item.prices[term] : null;
        if (p && p.currency && p.unitPrice) {
            if(!invoiceByCurr[p.currency]) invoiceByCurr[p.currency] = 0;
            invoiceByCurr[p.currency] += p.unitPrice * (item.qty || 0);
        }
    });

    Object.keys(invoiceByCurr).forEach(curr => {
        const foreignAmt = invoiceByCurr[curr];
        const qRate = quote.exchangeRates[curr] || 1;
        state.doc.actualCosts.push({
            id: generateId(),
            key: 'INVOICE_' + curr,
            group: 'invoice',
            label: 'Î¨ºÌíà ?ÄÍ∏?(KRW ?òÏÇ∞) - ' + curr,
            unit: 'Lump Sum',
            currency: curr,
            quotedCurrency: curr,
            quotedUnit: 'Lump Sum',
            quotedQty: 1,
            quotedAmount: foreignAmt,
            billedCurrency: curr,
            quotedForeign: foreignAmt,
            amount: foreignAmt,
            unitQty: 1,
            billedRate: qRate,
            isCustom: false
        });
    });

    // ÎπÑÏö© ??™© Ï¥àÍ∏∞??    state.doc.quotationSnapshot.costs.forEach(c => {
        let amt = parseFloat(c.amount) || 0;
        let qty = parseFloat(c.unitQty) || 1;
        let quotedTotalForeign = amt * qty;
        
        state.doc.actualCosts.push({
            id: generateId(),
            key: c.key,
            group: c.group || 'import', // Ï∂îÍ?: Í≥ºÏÑ∏?úÏ? Íµ¨Î∂Ñ???ÑÌï¥ Í∑∏Î£π ?Ä??            label: c.label,
            unit: c.unit,
            currency: c.currency, // Legacy
            quotedCurrency: c.currency,
            quotedUnit: c.unit,       // Í≤¨Ï†Å ?êÎ≥∏ ?®ÏúÑ Î≥¥Ï°¥
            quotedQty: qty,           // Í≤¨Ï†Å ?êÎ≥∏ ?òÎüâ Î≥¥Ï°¥
            quotedAmount: amt,        // Í≤¨Ï†Å ?êÎ≥∏ ?®Í? Î≥¥Ï°¥
            billedCurrency: c.currency,
            quotedForeign: quotedTotalForeign,
            amount: amt,
            unitQty: qty,
            billedRate: (quote.exchangeRates && quote.exchangeRates[c.currency]) ? quote.exchangeRates[c.currency] : 0,
        });
    });

    // Í∏∞Ì? ÎπÑÏö© (?¥ÏûêÎπÑÏö© ?? Í∞Ä?∏Ïò§Í∏?    if (quote.otherCosts && Array.isArray(quote.otherCosts)) {
        // ?¥ÏûêÎπÑÏö© Í≥ÑÏÇ∞???ÑÌïú ?êÎ≥∏ Í≤¨Ï†Å Í∏àÏï°(?êÍ∏à) ?∞Ï∂ú
        let invKrw = 0;
        (quote.items || []).forEach(item => {
            const p = item.prices && item.prices[term] ? item.prices[term] : null;
            if (p && p.currency && p.unitPrice) {
                const exRate = quote.exchangeRates[p.currency] || 1;
                invKrw += p.unitPrice * (item.qty || 0) * exRate;
            }
        });

        let subKrw = 0;
        state.doc.quotationSnapshot.costs.forEach(c => {
            let amt = parseFloat(c.amount) || 0;
            let qty = parseFloat(c.unitQty) || 1;
            let exRate = quote.exchangeRates[c.currency] || 1;
            subKrw += (amt * qty) * exRate;
        });

        quote.otherCosts.forEach((oc, ocIdx) => {
            let amt = parseFloat(oc.amount) || 0;
            let duration = 0, colDays = 0, rate = 0;
            
            // ?¥ÏûêÎπÑÏö© (Í≤¨Ï†Å Í∏∞Ï? Ï¥àÍ∏∞ ?êÍ∏à)
            if (oc.type === 'calculated' && oc.id === 'interest') {
                duration = parseFloat(oc.durationMonths) || 0;
                colDays = parseFloat(oc.collectionDays) || 0;
                rate = parseFloat(oc.interestRate) || 0;
                const avgMonths = ((duration + 1) / 2) + (colDays / 30);
                const principal = invKrw + subKrw;
                amt = principal * (avgMonths / 12) * (rate / 100);
            }
            
            state.doc.actualCosts.push({
                id: generateId(),
                key: oc.id === 'interest' ? 'INTEREST' : ('CUSTOM_OTHER_' + Date.now() + ocIdx),
                group: 'other', // Í∏∞Ì?ÎπÑÏö© ??                label: oc.name || oc.label || 'Í∏∞Ì?ÎπÑÏö©',
                unit: 'Lump Sum',
                currency: 'KRW',
                quotedCurrency: 'KRW',
                quotedUnit: 'Lump Sum',
                quotedQty: 1,
                quotedAmount: amt,
                billedCurrency: 'KRW',
                quotedForeign: amt,
                amount: amt,
                unitQty: 1,
                billedRate: 1,
                isCustom: false, // Í≤¨Ï†Å?úÏóê??Î∂àÎü¨????™©?Ä Î™®Îëê Í≥†Ï†ï ?çÏä§?∏Î°ú Ï≤òÎ¶¨
                durationMonths: duration,
                collectionDays: colDays,
                interestRate: rate
            });
        });
    }

    // ?îÎ©¥ Í∞±Ïã†
    document.getElementById('quoteModal').classList.remove('active');
    fillFormFromState();
    switchView('edit');
}

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// ?îÎ©¥ ?åÎçîÎß?(Edit View)
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
function fillFormFromState() {
    const doc = state.doc;
    const snap = doc.quotationSnapshot;
    
    // Í∏∞Î≥∏ ?ïÎ≥¥
    document.getElementById('docTitle').value = doc.title;
    document.getElementById('docDate').value = doc.settlementDate;
    document.getElementById('docStatus').value = doc.status;
    document.getElementById('docRemarks').value = doc.remarks || '';
    
    // ?ΩÍ∏∞ ?ÑÏö© Í≤¨Ï†Å ?ïÎ≥¥
    document.getElementById('roQuoteTitle').innerText = snap.title || '-';
    document.getElementById('roQuoteDate').innerText = snap.quoteDate || '-';
    let shipmentInfo = snap.shipmentType === 'FCL' ? `FCL (${snap.containerType} x ${snap.containerQty})` : 'LCL';
    document.getElementById('roShipment').innerText = shipmentInfo;
    document.getElementById('roPolPod').innerText = `${snap.pol || '-'} / ${snap.pod || '-'}`;
    document.getElementById('roForwarder').innerText = snap.forwarderName || '-';
    document.getElementById('roIncoterm').innerText = snap.incoterm || '-';
    

    renderSettlementGrid();
    calculateAll();
}

window.editSettlement = async function(id) {
    try {
        const data = await authFetch(`${API_BASE}/${id}`);
        state.doc = data;
        fillFormFromState();
        switchView('edit');
    } catch(err) {
        showToast('Î¨∏ÏÑúÎ•?Î∂àÎü¨?§Îäî Ï§??§Î•òÍ∞Ä Î∞úÏÉù?àÏäµ?àÎã§.', true);
    }
};

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// ?ïÏÇ∞ Í∑∏Î¶¨???åÎçîÎß?& Í≥ÑÏÇ∞
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
const COST_GROUPS = [
    { key: 'invoice', label: 'Î¨ºÌíà ?ÄÍ∏? },
    { key: 'ocean', label: '?¥ÏÉÅ ?¥ÏûÑ (O/F)' },
    { key: 'export', label: '?òÏ∂úÍµ?Î∂Ä?ÄÎπÑÏö©' },
    { key: 'import', label: '?òÏûÖÍµ?Î∂Ä?ÄÎπÑÏö©' },
    { key: 'customs', label: '?µÍ?/Í¥Ä?? },
    { key: 'other', label: 'Í∏∞Ì? ÎπÑÏö©' }
];

function renderSettlementGrid() {
    const container = document.getElementById('settlementCardContainer');
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};

    // Group costs by their group key
    const grouped = {};
    COST_GROUPS.forEach(g => { grouped[g.key] = []; });
    
    state.doc.actualCosts.forEach((cost, idx) => {
        const grpKey = cost.group || 'other';
        if (!grouped[grpKey]) grouped[grpKey] = [];
        grouped[grpKey].push({ cost, idx });
    });

    let html = '';

    COST_GROUPS.forEach(grp => {
        const items = grouped[grp.key];
        if (!items || items.length === 0) return;

        html += `
        <div class="cost-group" id="grp_${grp.key}">
            <div class="cost-group-header" onclick="toggleGroup('${grp.key}')">
                <div class="group-title">
                    <i class='bx bx-chevron-down'></i>
                    ${grp.label} <span style="font-weight:400; color:#94a3b8; font-size:0.85em;">(${items.length})</span>
                </div>
                <div class="group-subtotal">
                    <div class="subtotal-item">
                        <span class="subtotal-label">Í≤¨Ï†Å</span>
                        <span class="subtotal-value" id="grpEst_${grp.key}">??0</span>
                    </div>
                    <div class="subtotal-item">
                        <span class="subtotal-label">?§Ï†ú</span>
                        <span class="subtotal-value" id="grpAct_${grp.key}">??0</span>
                    </div>
                </div>
            </div>
            <div class="cost-group-body">`;

        items.forEach(({ cost, idx }) => {
            const qCurr = cost.quotedCurrency || cost.currency || 'KRW';
            const bCurr = cost.billedCurrency || cost.currency || 'KRW';
            let qRate = qCurr === 'KRW' ? 1 : (snapRates[qCurr] || 0);
            let qKrw = cost.quotedForeign * qRate;
            let amt = parseFloat(cost.amount) || 0;
            let qty = parseFloat(cost.unitQty) || 1;
            let billedForeign = amt * qty;

            // Label HTML
            let labelHtml = '';
            if (cost.isCustom) {
                const isDirectInput = cost.key.startsWith('CUSTOM_');
                let optsHtml = `<option value="">-- ÏßÅÏ†ë ?ÖÎ†• --</option>`;
                DEFAULT_COSTS.filter(c => c.group === cost.group).forEach(c => {
                    optsHtml += `<option value="${c.key}" ${cost.key === c.key ? 'selected' : ''}>${c.label}</option>`;
                });
                labelHtml = `
                    <div class="item-label-custom">
                        <select class="calc-input" onchange="onCostKeyChange(${idx}, this.value)" style="font-size:0.85rem;">${optsHtml}</select>
                        <input type="text" class="calc-input" value="${cost.label}" placeholder="??™©Î™?ÏßÅÏ†ë ?ÖÎ†•" style="display:${isDirectInput ? 'block' : 'none'}; font-size:0.85rem;" oninput="updateCost(${idx}, 'label', this.value)">
                    </div>`;
            } else {
                labelHtml = `<span class="item-label">${cost.label}</span>`;
            }

            // Currency select HTML
            const currOptions = ['KRW','USD','CNY','EUR','JPY'].map(c =>
                `<option value="${c}" ${bCurr===c?'selected':''}>${c}</option>`
            ).join('');

            // Invoice ?ÑÏù¥??Î¶¨Ïä§??HTML ?ùÏÑ±
            let invoiceItemsHtml = '';
            if (cost.group === 'invoice') {
                const term = state.doc.quotationSnapshot.incoterm || 'FOB';
                const snapItems = state.doc.quotationSnapshot.items || [];
                
                let trs = '';
                let totalForeignSum = 0;
                let totalQty = 0;
                
                snapItems.forEach(sItem => {
                    const p = sItem.prices && sItem.prices[term] ? sItem.prices[term] : null;
                    if (p && p.currency === qCurr) {
                        const rowForeign = p.unitPrice * (sItem.qty || 0);
                        totalForeignSum += rowForeign;
                        totalQty += (sItem.qty || 0);
                        
                        trs += `
                            <tr style="border-bottom: 1px solid #f1f5f9;">
                                <td style="padding:8px; color:#334155;">${sItem.name || '-'}</td>
                                <td style="padding:8px; text-align:center;">${sItem.qty || 0}</td>
                                <td style="padding:8px; text-align:center;">${sItem.unit || '-'}</td>
                                <td style="padding:8px; text-align:center;">${sItem.dutyRate || 0}%</td>
                                <td style="padding:8px; text-align:center;">${p.currency}</td>
                                <td style="padding:8px; text-align:right;">${formatNum(p.unitPrice, 2)}</td>
                                <td style="padding:8px; text-align:right; font-weight:600;">${formatNum(rowForeign, 2)}</td>
                            </tr>
                        `;
                    }
                });
                
                if (trs) {
                    trs += `
                        <tr style="background: #f8fafc; font-weight: 600;">
                            <td style="padding:8px; text-align:center;">?©Í≥Ñ</td>
                            <td style="padding:8px; text-align:center;">${formatNum(totalQty)}</td>
                            <td colspan="4"></td>
                            <td style="padding:8px; text-align:right;">${qCurr} ${formatNum(totalForeignSum, 2)}</td>
                        </tr>
                    `;
                }

                invoiceItemsHtml = `
                    <div style="grid-column: 1 / -1; margin-bottom: 15px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                        <div style="background: #f8fafc; padding: 10px 12px; font-weight: 600; color: #334155; border-bottom: 1px solid #e2e8f0; font-size:14px;">
                            <i class='bx bx-list-ul'></i> ?òÏûÖ ?Ä???àÎ™© ?¥Ïó≠ (?àÏÉÅ Í≤¨Ï†Å)
                        </div>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px; background: #fff;">
                            <thead>
                                <tr style="background: #f1f5f9; color: #475569; text-align: left; border-bottom: 2px solid #e2e8f0;">
                                    <th style="padding: 8px;">?àÎ™Ö</th>
                                    <th style="padding: 8px; text-align:center;">?òÎüâ</th>
                                    <th style="padding: 8px; text-align:center;">?®ÏúÑ</th>
                                    <th style="padding: 8px; text-align:center;">Í¥Ä?∏Ïú®</th>
                                    <th style="padding: 8px; text-align:center;">?µÌôî</th>
                                    <th style="padding: 8px; text-align:right;">?®Í?</th>
                                    <th style="padding: 8px; text-align:right;">Ï¥ùÏï°</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${trs || '<tr><td colspan="7" style="text-align:center; padding:12px; color:#64748b;">??™©???ÜÏäµ?àÎã§.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                `;
            }

            html += `
            <div class="cost-item-card" draggable="true" data-idx="${idx}"
                ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)"
                ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)"
                ondrop="handleDrop(event, ${idx})" ondragend="handleDragEnd(event)">

                <div class="card-top">
                    <i class='bx bx-grid-vertical drag-handle' title="?úÎûòÍ∑∏Ìïò???úÏÑú Î≥ÄÍ≤?></i>
                    ${labelHtml}
                    <button class="btn-delete-item" onclick="removeCost(${idx})" title="??™© ??†ú"><i class='bx bx-trash'></i></button>
                </div>

                <div class="card-body">
                    ${invoiceItemsHtml}
                    <!-- Ï¢åÏ∏°: ?àÏÉÅ Í≤¨Ï†Å (Read-only) -->
                    ${cost.key === 'INTEREST' ? `
                    <div class="panel-quote">
                        <div class="panel-title"><i class='bx bx-file'></i> ?àÏÉÅ Í≤¨Ï†Å</div>
                        <div class="panel-row">
                            <span class="p-label">?¨ÏóÖÍ∏∞Í∞Ñ</span>
                            <span class="p-value">${cost.durationMonths || 0} Í∞úÏõî</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?ÄÍ∏àÌöå??/span>
                            <span class="p-value">${cost.collectionDays || 0} ??/span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?∞Ïù¥?êÏú®</span>
                            <span class="p-value">${cost.interestRate || 0} %</span>
                        </div>
                        <div class="panel-row" style="background:rgba(100,116,139,0.06); margin:4px -12px; padding:6px 12px; margin-top:20px;">
                            <span class="p-label" style="font-weight:600;">Í≤¨Ï†ÅÍ∏àÏï°</span>
                            <span class="p-value" style="font-weight:600;">??${formatNum(cost.quotedAmount)}</span>
                        </div>
                    </div>
                    ` : `
                    <div class="panel-quote">
                        <div class="panel-title"><i class='bx bx-file'></i> ?àÏÉÅ Í≤¨Ï†Å</div>
                        ${cost.group === 'invoice' ? '' : `
                        <div class="panel-row">
                            <span class="p-label">?®ÏúÑ</span>
                            <span class="p-value">${cost.isCustom ? '-' : (cost.quotedUnit || cost.unit || '-')}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?µÌôî</span>
                            <span class="p-value">${cost.isCustom ? '-' : qCurr}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?òÎüâ</span>
                            <span class="p-value">${cost.isCustom ? '-' : (cost.quotedQty != null ? cost.quotedQty : '-')}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?®Í?</span>
                            <span class="p-value">${cost.isCustom ? '-' : formatNum(cost.quotedAmount, 2)}</span>
                        </div>
                        `}
                        <div class="panel-row" style="background:rgba(100,116,139,0.06); margin:4px -12px; padding:6px 12px; ${cost.group === 'invoice' ? 'margin-top:20px;' : ''}">
                            <span class="p-label" style="font-weight:600;">Í≤¨Ï†ÅÍ∏àÏï°</span>
                            <span class="p-value" style="font-weight:600;">${cost.isCustom ? '-' : formatNum(cost.quotedForeign, 2)}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?òÏú®</span>
                            <span class="p-value">${cost.isCustom ? '-' : (qCurr === 'KRW' ? '-' : formatNum(qRate, 2))}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?êÌôî(KRW)</span>
                            <span class="p-value" style="font-weight:700;">??${formatNum(qKrw)}</span>
                        </div>
                    </div>
                    `}

                    <!-- ?∞Ï∏°: ?§Ï†ú Ï≤?µ¨ (Editable) -->
                    ${cost.key === 'INTEREST' ? `
                    <div class="panel-billed">
                        <div class="panel-title"><i class='bx bx-edit-alt'></i> ?§Ï†ú Ï≤?µ¨ (?ÖÎ†•)</div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">?¨ÏóÖÍ∏∞Í∞Ñ</span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" style="text-align:right;" value="${cost.durationMonths || 0}" oninput="updateCost(${idx}, 'durationMonths', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">Í∞úÏõî</span>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">?ÄÍ∏àÌöå??/span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" style="text-align:right;" value="${cost.collectionDays || 0}" oninput="updateCost(${idx}, 'collectionDays', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">??/span>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">?∞Ïù¥?êÏú®</span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" step="0.1" style="text-align:right;" value="${cost.interestRate || 0}" oninput="updateCost(${idx}, 'interestRate', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">%</span>
                            </div>
                        </div>
                        <div class="panel-row" style="background:rgba(37,99,235,0.05); margin:4px -12px; padding:6px 12px; margin-top:20px;">
                            <span class="p-label" style="color:#1d4ed8; font-weight:600;">Ï≤?µ¨Í∏àÏï°</span>
                            <span class="p-value" id="billedForeign_${idx}" style="color:#1d4ed8; font-size:0.95rem; font-weight:700;">??${formatNum(amt)}</span>
                        </div>
                    </div>
                    ` : `
                    <div class="panel-billed">
                        <div class="panel-title"><i class='bx bx-edit-alt'></i> ?§Ï†ú Ï≤?µ¨ (?ÖÎ†•)</div>
                        ${cost.group === 'invoice' ? '' : `
                        <div class="panel-row">
                            <span class="p-label">?®ÏúÑ</span>
                            <div class="p-input-wide">
                                <input type="text" class="calc-input" value="${cost.unit}" style="text-align:center;" oninput="updateCost(${idx}, 'unit', this.value)">
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?µÌôî</span>
                            <div class="p-input">
                                <select class="calc-input curr-select" onchange="updateCost(${idx}, 'billedCurrency', this.value)">${currOptions}</select>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?òÎüâ</span>
                            <div class="p-input">
                                <input type="number" class="calc-input" step="0.01" value="${qty}" oninput="updateCost(${idx}, 'unitQty', this.value)">
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?®Í?</span>
                            <div class="p-input">
                                <input type="number" class="calc-input" step="0.01" value="${amt}" oninput="updateCost(${idx}, 'amount', this.value)">
                            </div>
                        </div>
                        `}
                        <div class="panel-row" style="background:rgba(37,99,235,0.05); margin:4px -12px; padding:6px 12px; ${cost.group === 'invoice' ? 'margin-top:20px;' : ''}">
                            <span class="p-label" style="color:#1d4ed8; font-weight:600;">Ï≤?µ¨Í∏àÏï°</span>
                            <span class="p-value" id="billedForeign_${idx}" style="color:#1d4ed8; font-size:0.95rem;">${formatNum(billedForeign, 2)}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?òÏú®</span>
                            <div class="p-input">
                                ${bCurr === 'KRW' ? '<span class="p-value">-</span>' : `<input type="number" class="calc-input" step="0.01" value="${cost.billedRate}" oninput="updateCost(${idx}, 'billedRate', this.value)">`}
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">?êÌôî(KRW)</span>
                            <span class="p-value" id="billedKrw_${idx}" style="font-weight:700;">??${formatNum(billedForeign * (bCurr === 'KRW' ? 1 : cost.billedRate))}</span>
                        </div>
                    </div>
                    `}
                </div>

                <!-- ?òÎã®: Í≤∞Í≥º -->
                <div class="card-result">
                    <div class="result-item">
                        <div class="r-label">?§Ï†ú ?êÌôî(KRW)</div>
                        <div class="r-value" id="krw_${idx}">??0</div>
                    </div>
                    <div class="result-item">
                        <div class="r-label">ÎπÑÏö©Ï¶ùÍ∞ê</div>
                        <div class="r-value" id="var_${idx}">0</div>
                    </div>
                    <div class="result-item">
                        <div class="r-label">?òÏ∞®????/div>
                        <div class="r-value" id="gl_${idx}">0</div>
                    </div>
                </div>
            </div>`;
        });

        html += `
            </div>
            <div class="cost-group-footer">
                <button class="btn-add-in-group" onclick="addCustomCost('${grp.key}')">
                    <i class='bx bx-plus'></i> ${grp.label} ??™© Ï∂îÍ?
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// ?ÑÏΩî?îÏñ∏ ?†Í?
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
window.toggleGroup = function(key) {
    const el = document.getElementById(`grp_${key}`);
    if (el) el.classList.toggle('collapsed');
};

window.onCostKeyChange = function(idx, key) {
    const cost = state.doc.actualCosts[idx];
    if (key === '') {
        cost.key = 'CUSTOM_' + Date.now();
        cost.label = '';
    } else {
        const def = DEFAULT_COSTS.find(c => c.key === key);
        if (def) {
            cost.key = def.key;
            cost.label = def.label;
            cost.unit = def.defaultUnit;
        }
    }
    renderSettlementGrid();
    calculateAll();
};

window.updateCost = function(idx, field, value) {
    const cost = state.doc.actualCosts[idx];
    if (['amount', 'unitQty', 'billedRate', 'durationMonths', 'collectionDays', 'interestRate'].includes(field)) {
        cost[field] = parseFloat(value) || 0;
    } else {
        cost[field] = value;
    }
    
    if (field === 'group' && cost.isCustom) {
        cost.key = 'CUSTOM_' + Date.now();
        cost.label = '';
        renderSettlementGrid();
    }
    
    if (field === 'billedCurrency') {
        if (value === 'KRW') {
            cost.billedRate = 1;
        } else {
            const snap = state.doc.quotationSnapshot.exchangeRates || {};
            cost.billedRate = snap[value] || 0;
        }
        renderSettlementGrid();
    }
    calculateAll();
};

window.addCustomCost = function(group) {
    state.doc.actualCosts.push({
        id: generateId(),
        key: 'CUSTOM_' + Date.now(),
        group: group || 'import',
        label: '?¨Ïö©??Ï∂îÍ? ??™©',
        unit: 'Lump Sum',
        currency: 'KRW',
        quotedCurrency: 'KRW',
        quotedUnit: '-',
        quotedQty: 0,
        quotedAmount: 0,
        billedCurrency: 'KRW',
        quotedForeign: 0,
        amount: 0,
        unitQty: 1,
        billedRate: 1,
        isCustom: true
    });
    renderSettlementGrid();
    calculateAll();
};

window.removeCost = function(idx) {
    state.doc.actualCosts.splice(idx, 1);
    renderSettlementGrid();
    calculateAll();
};

// --- Drag and Drop Handlers (updated for cards) ---
window.handleDragStart = function(e) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.idx);
    e.currentTarget.classList.add('dragging');
};

window.handleDragOver = function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
};

window.handleDragEnter = function(e) {
    e.preventDefault();
    const card = e.target.closest('.cost-item-card');
    if (card) card.classList.add('drag-over');
};

window.handleDragLeave = function(e) {
    const card = e.target.closest('.cost-item-card');
    if (card && !card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over');
    }
};

window.handleDrop = function(e, toIdx) {
    e.preventDefault();
    const card = e.target.closest('.cost-item-card');
    if (card) card.classList.remove('drag-over');
    
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(fromIdx) || fromIdx === toIdx) return;
    
    const movedItem = state.doc.actualCosts.splice(fromIdx, 1)[0];
    state.doc.actualCosts.splice(toIdx, 0, movedItem);
    
    renderSettlementGrid();
    calculateAll();
};

window.handleDragEnd = function(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
};

function calculateAll() {
    let totalEstKrw = 0;
    let totalBilledKrw = 0;
    let totalDutiableKrw = 0;
    let totalDutiableEstKrw = 0;
    
    let totalCostVariance = 0;
    let totalExchangeVariance = 0;
    
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};
    
    // --- 2-Pass ?¥ÏûêÎπÑÏö© ?§ÏãúÍ∞??∞Ï∂ú Î°úÏßÅ ---
    // 1. Î¨ºÌíà?Ä ?êÌôî ?òÏÇ∞??invKrw) ?∞Ï∂ú (?§Ï†ú Ï≤?µ¨ ?òÏú® Î∞òÏòÅ)
    let invKrw = 0;
    state.doc.actualCosts.forEach(cost => {
        if (cost.group === 'invoice') {
            const bCurr = cost.billedCurrency || cost.currency || 'KRW';
            let amt = parseFloat(cost.amount) || 0;
            let qty = parseFloat(cost.unitQty) || 1;
            let bRate = (bCurr === 'KRW') ? 1 : (parseFloat(cost.billedRate) || 0);
            invKrw += (amt * qty) * bRate;
        }
    });

    // 2. ?¥ÏûêÎπÑÏö©???úÏô∏???òÎ®∏ÏßÄ ?§Ï†ú Î∂Ä?ÄÎπÑÏö© ?êÌôî ?©ÏÇ∞??subKrw) ?∞Ï∂ú
    let subKrw = 0;
    state.doc.actualCosts.forEach(cost => {
        if (cost.group !== 'invoice' && cost.key !== 'INTEREST') {
            const bCurr = cost.billedCurrency || cost.currency || 'KRW';
            let amt = parseFloat(cost.amount) || 0;
            let qty = parseFloat(cost.unitQty) || 1;
            let bRate = (bCurr === 'KRW') ? 1 : (parseFloat(cost.billedRate) || 0);
            subKrw += (amt * qty) * bRate;
        }
    });

    // 3. ?¥ÏûêÎπÑÏö© ??™©???§Ï†ú Ï≤?µ¨Í∏àÏï° ?ÖÎç∞?¥Ìä∏
    state.doc.actualCosts.forEach(cost => {
        if (cost.key === 'INTEREST') {
            const duration = parseFloat(cost.durationMonths) || 0;
            const colDays = parseFloat(cost.collectionDays) || 0;
            const rate = parseFloat(cost.interestRate) || 0;
            const avgMonths = ((duration + 1) / 2) + (colDays / 30);
            const principal = invKrw + subKrw;
            cost.amount = principal * (avgMonths / 12) * (rate / 100);
            cost.unitQty = 1;
            cost.billedRate = 1;
        }
    });
    // ------------------------------------------

    // Per-group accumulators
    const grpEst = {};
    const grpAct = {};
    COST_GROUPS.forEach(g => { grpEst[g.key] = 0; grpAct[g.key] = 0; });

    let totalBilledAncillaryKrw = 0;
    let totalEstAncillaryKrw = 0;
    let interestEst = 0;
    let interestAct = 0;

    state.doc.actualCosts.forEach((cost, idx) => {
        const qCurr = cost.quotedCurrency || cost.currency || 'KRW';
        const bCurr = cost.billedCurrency || cost.currency || 'KRW';
        const isKrw = bCurr === 'KRW';
        
        let amt = parseFloat(cost.amount) || 0;
        let qty = parseFloat(cost.unitQty) || 1;
        let billedForeign = amt * qty;
        
        let qRate = qCurr === 'KRW' ? 1 : (snapRates[qCurr] || 0);
        let qKrw = cost.quotedForeign * qRate;
        totalEstKrw += qKrw;
        
        let bRate = isKrw ? 1 : cost.billedRate;
        let bKrw = billedForeign * bRate;
        totalBilledKrw += bKrw;

        if (cost.group !== 'invoice') {
            totalBilledAncillaryKrw += bKrw;
            totalEstAncillaryKrw += qKrw;
        }
        
        if (cost.group === 'ocean' || cost.group === 'export' || cost.key === 'INS') {
            totalDutiableKrw += bKrw;
            totalDutiableEstKrw += qKrw;
        }
        
        // Group subtotals
        if (cost.key === 'INTEREST') {
            interestEst += qKrw;
            interestAct += bKrw;
        } else {
            const gk = cost.group || 'other';
            if (grpEst[gk] !== undefined) { grpEst[gk] += qKrw; grpAct[gk] += bKrw; }
        }
        
        let varKrw = 0;
        let glKrw = 0;
        
        if (qCurr === bCurr) {
            varKrw = (billedForeign - cost.quotedForeign) * qRate;
            glKrw = (bRate - qRate) * billedForeign;
        } else {
            varKrw = bKrw - qKrw;
            glKrw = 0;
        }
        
        totalCostVariance += varKrw;
        totalExchangeVariance += glKrw;

        // UI ?ÖÎç∞?¥Ìä∏
        const bfEl = document.getElementById(`billedForeign_${idx}`);
        const bkEl = document.getElementById(`billedKrw_${idx}`);
        const krwEl = document.getElementById(`krw_${idx}`);
        const varEl = document.getElementById(`var_${idx}`);
        const glEl = document.getElementById(`gl_${idx}`);
        
        if (bfEl) bfEl.innerText = formatNum(billedForeign, 2);
        if (bkEl) bkEl.innerText = '??' + formatNum(bKrw);
        if (krwEl) krwEl.innerText = '??' + formatNum(bKrw);
        
        if (varEl) {
            varEl.innerText = varKrw > 0 ? '+' + formatNum(varKrw) : formatNum(varKrw);
            varEl.className = 'r-value ' + (varKrw > 0 ? 'positive' : (varKrw < 0 ? 'negative' : ''));
        }
        
        if (glEl) {
            glEl.innerText = glKrw > 0 ? '+' + formatNum(glKrw) : formatNum(glKrw);
            glEl.className = 'r-value ' + (glKrw > 0 ? 'loss' : (glKrw < 0 ? 'gain' : ''));
        }
    });
    
    // Group subtotal UI
    COST_GROUPS.forEach(g => {
        const estEl = document.getElementById(`grpEst_${g.key}`);
        const actEl = document.getElementById(`grpAct_${g.key}`);
        if (estEl) estEl.innerText = '??' + formatNum(grpEst[g.key]);
        if (actEl) actEl.innerText = '??' + formatNum(grpAct[g.key]);
    });
    
    // ?Ä?úÎ≥¥???ÖÎç∞?¥Ìä∏
    document.getElementById('dashTotalEstimated').innerText = '??' + formatNum(totalEstKrw);
    document.getElementById('dashTotalBilled').innerText = '??' + formatNum(totalBilledKrw);
    
    // ?ºÏÑº?∞Ï?
    const pctEl = document.getElementById('dashBilledPct');
    if (pctEl && totalEstKrw > 0) {
        const pct = ((totalBilledKrw - totalEstKrw) / totalEstKrw * 100);
        const icon = pct > 0 ? '?? : (pct < 0 ? '?? : '');
        pctEl.innerText = `${icon} ${Math.abs(pct).toFixed(1)}%`;
        pctEl.className = 'dash-pct ' + (pct > 0 ? 'over' : (pct < 0 ? 'under' : 'neutral'));
    }
    
    const dVar = document.getElementById('dashCostVariance');
    dVar.innerText = (totalCostVariance > 0 ? '+??' : '??') + formatNum(totalCostVariance);
    dVar.style.color = totalCostVariance > 0 ? '#dc2626' : (totalCostVariance < 0 ? '#16a34a' : 'inherit');
    
    const dGl = document.getElementById('dashExchangeGainLoss');
    dGl.innerText = (totalExchangeVariance > 0 ? '+??' : '??') + formatNum(totalExchangeVariance);
    dGl.style.color = totalExchangeVariance > 0 ? '#dc2626' : (totalExchangeVariance < 0 ? '#16a34a' : 'inherit');
    
    // 6. ÎπÑÏö© ?îÏïΩ (Summary Table) ?åÎçîÎß?    const sumTbody = document.getElementById('summaryTableBody');
    const sumTfoot = document.getElementById('summaryTableFoot');
    if (sumTbody && sumTfoot) {
        let htmlBody = '';
        let fwEst = 0;
        let fwAct = 0;
        
        COST_GROUPS.forEach(g => {
            const est = grpEst[g.key] || 0;
            const act = grpAct[g.key] || 0;
            const diff = act - est;
            
            if (g.key === 'ocean' || g.key === 'export' || g.key === 'import' || g.key === 'customs') {
                fwEst += est;
                fwAct += act;
            }
            
            const diffColor = diff > 0 ? '#dc2626' : (diff < 0 ? '#16a34a' : 'inherit');
            const diffStr = diff > 0 ? '+??' + formatNum(diff) : (diff < 0 ? '-??' + formatNum(Math.abs(diff)) : '??0');
            
            const hasDetails = (g.key !== 'invoice');
            const toggleIcon = hasDetails ? `<i class='bx bx-plus-square' id="icon_${g.key}" style="color:#64748b; margin-left:8px; vertical-align:middle; cursor:pointer;" onclick="event.stopPropagation(); toggleSummaryDetails('${g.key}')"></i>` : '';
            
            htmlBody += `
                <tr style="border-bottom:1px solid #e2e8f0; ${hasDetails ? 'cursor:pointer; background:#fff;' : ''}" ${hasDetails ? `onclick="toggleSummaryDetails('${g.key}')"` : ''}>
                    <td style="padding:10px 12px; font-weight:500;">${g.label} ${toggleIcon}</td>
                    <td class="col-num" style="padding:10px 12px;">??${formatNum(est)}</td>
                    <td class="col-num" style="padding:10px 12px;">??${formatNum(act)}</td>
                    <td class="col-num" style="padding:10px 12px; color:${diffColor}; font-weight:500;">${diffStr}</td>
                </tr>
            `;

            if (hasDetails) {
                let detailRows = '';
                const snapRates = state.doc.quotationSnapshot.exchangeRates || {};
                state.doc.actualCosts.forEach(cost => {
                    const gk = cost.group || 'other';
                    if (gk === g.key && cost.key !== 'INTEREST') {
                        const qCurr = cost.quotedCurrency || cost.currency || 'KRW';
                        const bCurr = cost.billedCurrency || cost.currency || 'KRW';
                        let qRate = qCurr === 'KRW' ? 1 : (snapRates[qCurr] || 0);
                        let qKrw = cost.quotedForeign * qRate;
                        
                        let amt = parseFloat(cost.amount) || 0;
                        let qty = parseFloat(cost.unitQty) || 1;
                        let billedForeign = amt * qty;
                        let bRate = bCurr === 'KRW' ? 1 : cost.billedRate;
                        let bKrw = billedForeign * bRate;
                        
                        let itemDiff = bKrw - qKrw;
                        let itemDiffColor = itemDiff > 0 ? '#dc2626' : (itemDiff < 0 ? '#16a34a' : 'inherit');
                        let itemDiffStr = itemDiff > 0 ? '+??' + formatNum(itemDiff) : (itemDiff < 0 ? '-??' + formatNum(Math.abs(itemDiff)) : '??0');
                        
                        detailRows += `
                            <tr class="detail-row-${g.key}" style="display:none; background:#f8fafc; font-size:0.85rem; color:#475569; border-bottom:1px solid #f1f5f9;">
                                <td style="padding:6px 12px 6px 30px;"><i class='bx bx-subdirectory-right' style="color:#94a3b8; margin-right:5px;"></i>${cost.label}</td>
                                <td class="col-num" style="padding:6px 12px;">??${formatNum(qKrw)}</td>
                                <td class="col-num" style="padding:6px 12px;">??${formatNum(bKrw)}</td>
                                <td class="col-num" style="padding:6px 12px; color:${itemDiffColor};">${itemDiffStr}</td>
                            </tr>
                        `;
                    }
                });
                htmlBody += detailRows;
            }
            
            // "?µÍ?/Í¥Ä?? ÏßÅÌõÑ???¨Ïõå???åÍ≥Ñ Ï∂úÎ†•
            if (g.key === 'customs') {
                const fwDiff = fwAct - fwEst;
                const fwDiffColor = fwDiff > 0 ? '#dc2626' : (fwDiff < 0 ? '#16a34a' : 'inherit');
                const fwDiffStr = fwDiff > 0 ? '+??' + formatNum(fwDiff) : (fwDiff < 0 ? '-??' + formatNum(Math.abs(fwDiff)) : '??0');
                
                htmlBody += `
                    <tr style="background:#f1f5f9; font-weight:600;">
                        <td style="padding:10px 12px;">?¨Ïõå??Î∂Ä?ÄÎπÑÏö© ?åÍ≥Ñ (KRW)</td>
                        <td class="col-num" style="padding:10px 12px;">??${formatNum(fwEst)}</td>
                        <td class="col-num" style="padding:10px 12px;">??${formatNum(fwAct)}</td>
                        <td class="col-num" style="padding:10px 12px; color:${fwDiffColor};">${fwDiffStr}</td>
                    </tr>
                `;
            }
        });
        
        // ?¥ÏûêÎπÑÏö© ?®ÎèÖ ??Ï∂îÍ?
        const intDiff = interestAct - interestEst;
        const intDiffColor = intDiff > 0 ? '#dc2626' : (intDiff < 0 ? '#16a34a' : 'inherit');
        const intDiffStr = intDiff > 0 ? '+??' + formatNum(intDiff) : (intDiff < 0 ? '-??' + formatNum(Math.abs(intDiff)) : '??0');
        
        htmlBody += `
            <tr>
                <td style="padding:10px 12px;">Í∏àÏúµÎπÑÏö© (?¥ÏûêÎπÑÏö©)</td>
                <td class="col-num" style="padding:10px 12px;">??${formatNum(interestEst)}</td>
                <td class="col-num" style="padding:10px 12px;">??${formatNum(interestAct)}</td>
                <td class="col-num" style="padding:10px 12px; color:${intDiffColor};">${intDiffStr}</td>
            </tr>
        `;
        
        sumTbody.innerHTML = htmlBody;
        
        // Ï¥??©Í≥Ñ
        const totalDiff = totalBilledKrw - totalEstKrw;
        const totalDiffColor = totalDiff > 0 ? '#fca5a5' : (totalDiff < 0 ? '#86efac' : 'inherit'); 
        const totalDiffStr = totalDiff > 0 ? '+??' + formatNum(totalDiff) : (totalDiff < 0 ? '-??' + formatNum(Math.abs(totalDiff)) : '??0');
        
        sumTfoot.innerHTML = `
            <tr>
                <td style="padding:12px;">Ï¥?ÎπÑÏö© (Î¨ºÌíà+?¨Ïõå??Í∏∞Ì?) KRW</td>
                <td class="col-num" style="padding:12px;">??${formatNum(totalEstKrw)}</td>
                <td class="col-num" style="padding:12px;">??${formatNum(totalBilledKrw)}</td>
                <td class="col-num" style="padding:12px; color:${totalDiffColor};">${totalDiffStr}</td>
            </tr>
        `;
    }

    // 5. Í¥Ä??Î∂ÄÍ∞Ä??Í≥ÑÏÇ∞
    renderCostResultTable(totalBilledAncillaryKrw, totalDutiableKrw, totalEstAncillaryKrw, totalDutiableEstKrw);
}

function renderCostResultTable(totalBilledKrw, totalDutiableAncillaryKrw, totalEstKrw, totalDutiableEstKrw) {
    const tbodyValue = document.getElementById('costTableBodyValue');
    const tbodyVolume = document.getElementById('costTableBodyVolume');
    const section = document.getElementById('costResultSection');
    
    if (!state.doc.quotationSnapshot || !state.doc.quotationSnapshot.items || state.doc.quotationSnapshot.items.length === 0) {
        if (section) section.style.display = 'none';
        return;
    }
    
    if (section) section.style.display = 'block';

    const items = state.doc.quotationSnapshot.items;
    const term = state.doc.quotationSnapshot.incoterm;
    const isLCL = state.doc.quotationSnapshot.shipmentType === 'LCL';
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};

    let totalInvoiceKrw = 0;
    items.forEach(item => {
        const p = item.prices && item.prices[term] ? item.prices[term] : null;
        if (p && p.currency && p.unitPrice) {
            const pRate = snapRates[p.currency] || 1;
            totalInvoiceKrw += (p.unitPrice * (item.qty || 0) * pRate);
        }
    });

    // ?§Ï≤≠Íµ?Í∏∞Ï? Î∞∞Î∂ÑÎπÑÏú®
    const allocationRatio = totalInvoiceKrw > 0 ? (totalBilledKrw / totalInvoiceKrw) : 0;
    // Í≤¨Ï†Å Í∏∞Ï? Î∞∞Î∂ÑÎπÑÏú®
    const estAllocationRatio = totalInvoiceKrw > 0 ? (totalEstKrw / totalInvoiceKrw) : 0;

    let htmlValue = '';

    let totalModulus = 0;
    items.forEach(item => {
        const p = item.prices && item.prices[term] ? item.prices[term] : null;
        if (p && p.unitPrice > 0) {
            if (isLCL) {
                totalModulus += (item.rt || 0);
            } else {
                if (item.maxLoad > 0) totalModulus += (item.qty / item.maxLoad);
            }
        }
    });
    let htmlVolume = '';

    items.forEach(item => {
        const p = item.prices && item.prices[term] ? item.prices[term] : null;
        if (!p || !p.unitPrice || p.unitPrice === 0) {
            htmlValue += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="7" style="text-align:center; color:var(--text-tertiary)">?¥Îãπ ?∏ÏΩî?ÄÏ¶??®Í? ?ÜÏùå</td></tr>`;
            htmlVolume += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="7" style="text-align:center; color:var(--text-tertiary)">?¥Îãπ ?∏ÏΩî?ÄÏ¶??®Í? ?ÜÏùå</td></tr>`;
            return;
        }

        const unitPriceFC = p.unitPrice;
        
        const quotedExRate = snapRates[p.currency] || 1;
        let billedExRate = quotedExRate;
        if (state.doc && state.doc.actualCosts) {
            const invoiceCost = state.doc.actualCosts.find(c => c.group === 'invoice' && (c.billedCurrency === p.currency || c.currency === p.currency));
            if (invoiceCost && invoiceCost.billedRate) {
                billedExRate = parseFloat(invoiceCost.billedRate);
            }
        }
        
        const dutyRate = item.dutyRate || 0;

        // === ?§Ï≤≠Íµ?Í∏∞Ï? (Í∞ÄÏπòÎπÑÎ°Ä Î∞∞Î∂Ñ) ===
        const allocatedFC_Value_Total = unitPriceFC * allocationRatio;
        const dutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableAncillaryKrw / totalInvoiceKrw) : 0;
        const allocatedFC_Value_Dutiable = unitPriceFC * dutiableAllocationRatio;

        const baseCostFC_Value = unitPriceFC + allocatedFC_Value_Total;
        const baseCostKrw_Value = baseCostFC_Value * billedExRate;

        const cifValueKrw_Value = (unitPriceFC + allocatedFC_Value_Dutiable) * billedExRate;
        const dutyKrw_Value = cifValueKrw_Value * (dutyRate / 100);

        const realCostKrw_Value = baseCostKrw_Value + dutyKrw_Value;

        // === Í≤¨Ï†Å Í∏∞Ï? (Í∞ÄÏπòÎπÑÎ°Ä Î∞∞Î∂Ñ) ===
        const estAllocatedFC_Value_Total = unitPriceFC * estAllocationRatio;
        const estDutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableEstKrw / totalInvoiceKrw) : 0;
        const estAllocatedFC_Value_Dutiable = unitPriceFC * estDutiableAllocationRatio;

        const estBaseCostFC_Value = unitPriceFC + estAllocatedFC_Value_Total;
        const estBaseCostKrw_Value = estBaseCostFC_Value * quotedExRate;

        const estCifValueKrw_Value = (unitPriceFC + estAllocatedFC_Value_Dutiable) * quotedExRate;
        const estDutyKrw_Value = estCifValueKrw_Value * (dutyRate / 100);

        const estCostKrw_Value = estBaseCostKrw_Value + estDutyKrw_Value;

        // Ï¶ùÍ∞ê
        const diffValue = realCostKrw_Value - estCostKrw_Value;
        const diffColorValue = diffValue > 0 ? '#dc2626' : (diffValue < 0 ? '#16a34a' : 'inherit');
        const diffTextValue = diffValue > 0 ? `+??${formatNum(diffValue)}` : `??${formatNum(diffValue)}`;

        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Value_Total, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Value, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">??${formatNum(dutyKrw_Value)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num" style="background:#f0fdf4;">??${formatNum(estCostKrw_Value)}</td>
                <td class="col-num highlight-col">??${formatNum(realCostKrw_Value)}</td>
                <td class="col-num" style="color:${diffColorValue}; font-weight:600;">${diffTextValue}</td>
            </tr>
        `;

        // === ?§Ï≤≠Íµ?Í∏∞Ï? (Ï≤¥Ï†Å/?¥ÏûÑ??Î∞∞Î∂Ñ) ===
        let allocatedFC_Volume_Total = 0;
        let allocatedFC_Volume_Dutiable = 0;
        let volumeShareRatio = 0;

        if (totalModulus > 0 && item.qty > 0) {
            if (isLCL) {
                volumeShareRatio = (item.rt || 0) / totalModulus;
            } else {
                if (item.maxLoad > 0) {
                    volumeShareRatio = (item.qty / item.maxLoad) / totalModulus;
                }
            }
            const itemTotalAncillaryKrw = totalBilledKrw * volumeShareRatio;
            const itemDutiableAncillaryKrw = totalDutiableAncillaryKrw * volumeShareRatio;

            allocatedFC_Volume_Total = (itemTotalAncillaryKrw / billedExRate) / item.qty;
            allocatedFC_Volume_Dutiable = (itemDutiableAncillaryKrw / billedExRate) / item.qty;
        }

        const baseCostFC_Volume = unitPriceFC + allocatedFC_Volume_Total;
        const baseCostKrw_Volume = baseCostFC_Volume * billedExRate;

        const cifValueKrw_Volume = (unitPriceFC + allocatedFC_Volume_Dutiable) * billedExRate;
        const dutyKrw_Volume = cifValueKrw_Volume * (dutyRate / 100);

        const realCostKrw_Volume = baseCostKrw_Volume + dutyKrw_Volume;

        // === Í≤¨Ï†Å Í∏∞Ï? (Ï≤¥Ï†Å/?¥ÏûÑ??Î∞∞Î∂Ñ) ===
        let estAllocatedFC_Volume_Total = 0;
        let estAllocatedFC_Volume_Dutiable = 0;

        if (totalModulus > 0 && item.qty > 0) {
            const estItemTotalAncillaryKrw = totalEstKrw * volumeShareRatio;
            const estItemDutiableAncillaryKrw = totalDutiableEstKrw * volumeShareRatio;

            estAllocatedFC_Volume_Total = (estItemTotalAncillaryKrw / quotedExRate) / item.qty;
            estAllocatedFC_Volume_Dutiable = (estItemDutiableAncillaryKrw / quotedExRate) / item.qty;
        }

        const estBaseCostFC_Volume = unitPriceFC + estAllocatedFC_Volume_Total;
        const estBaseCostKrw_Volume = estBaseCostFC_Volume * quotedExRate;

        const estCifValueKrw_Volume = (unitPriceFC + estAllocatedFC_Volume_Dutiable) * quotedExRate;
        const estDutyKrw_Volume = estCifValueKrw_Volume * (dutyRate / 100);

        const estCostKrw_Volume = estBaseCostKrw_Volume + estDutyKrw_Volume;

        // Ï¶ùÍ∞ê
        const diffVolume = realCostKrw_Volume - estCostKrw_Volume;
        const diffColorVolume = diffVolume > 0 ? '#dc2626' : (diffVolume < 0 ? '#16a34a' : 'inherit');
        const diffTextVolume = diffVolume > 0 ? `+??${formatNum(diffVolume)}` : `??${formatNum(diffVolume)}`;

        const shareText = isLCL ? 
            ((volumeShareRatio * 100).toFixed(1) + '% (R/T)') : 
            (item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '<span style="color:var(--danger);font-size:0.85em">?ÅÏû¨???ÑÎùΩ</span>');

        htmlVolume += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${shareText}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Volume_Total, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Volume, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">??${formatNum(dutyKrw_Volume)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num" style="background:#f0fdf4;">??${formatNum(estCostKrw_Volume)}</td>
                <td class="col-num highlight-col">??${formatNum(realCostKrw_Volume)}</td>
                <td class="col-num" style="color:${diffColorVolume}; font-weight:600;">${diffTextVolume}</td>
            </tr>
        `;
    });

    if (tbodyValue) tbodyValue.innerHTML = htmlValue;
    if (tbodyVolume) tbodyVolume.innerHTML = htmlVolume;
}

// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
// ?Ä??Î∞?Í∏∞Ì? ?°ÏÖò
// ?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä?Ä
async function saveSettlement() {
    if (!state.doc.title) return showToast('?ïÏÇ∞ Î¨∏ÏÑúÎ™ÖÏùÑ ?ÖÎ†•?òÏÑ∏??', true);
    if (!state.doc.settlementDate) return showToast('?ïÏÇ∞ ?ºÏûêÎ•??ÖÎ†•?òÏÑ∏??', true);
    if (!state.doc.quotationId) return showToast('?∞Îèô??Í≤¨Ï†Å???ÜÏäµ?àÎã§.', true);
    
    // Í∞ïÏ†ú ?ôÍ∏∞??(Î∞©Ïñ¥ ÏΩîÎìú)
    document.querySelectorAll('.calc-input').forEach(el => el.dispatchEvent(new Event('input')));

    try {
        const isNew = !state.doc.id;
        const url = isNew ? API_BASE : `${API_BASE}/${state.doc.id}`;
        const method = isNew ? 'POST' : 'PUT';
        
        await authFetch(url, {
            method,
            body: JSON.stringify(state.doc)
        });
        
        showToast('?Ä?•Îêò?àÏäµ?àÎã§.');
        loadList();
        switchView('list');
    } catch (err) {
        showToast(err.message, true);
    }
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.row-chk:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast('??†ú????™©???†ÌÉù?òÏÑ∏??', true);
    if (!confirm(`?†ÌÉù??${ids.length}Í±¥ÏùÑ ??†ú?òÏãúÍ≤†Ïäµ?àÍπå?`)) return;
    
    try {
        await authFetch(`${API_BASE}/delete`, {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
        showToast('??†ú?òÏóà?µÎãà??');
        loadList();
    } catch (err) {
        showToast(err.message, true);
    }
}

function exportExcel() {
    showToast('?ëÏ? ?¥Î≥¥?¥Í∏∞ Í∏∞Îä•?Ä Ï§ÄÎπ?Ï§ëÏûÖ?àÎã§.', false);
    // Ï∂îÌõÑ Íµ¨ÌòÑ
}


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
            <h1 class="print-title">Ω«ºˆ¿‘∫ÒøÎ ¡§ªÍº≠</h1>
        </div>
    `;

    // 1. Info
    if (opts.showInfo) {
        html += `
        <div class="print-section">
            <h2 class="section-title">1. ¡§ªÍ π◊ ø¨µø ¡§∫∏</h2>
            <table class="print-info-table">
                <tr>
                    <th>¡§ªÍ πÆº≠∏Ì</th><td>${d.title || '-'}</td>
                    <th>¡§ªÍ ¿œ¿⁄</th><td>${d.settlementDate || '-'}</td>
                    <th>ªÛ≈¬</th><td>${d.status === 'completed' ? 'øœ∑·' : '¿€º∫ ¡ﬂ'}</td>
                </tr>
            </table>
            <h3 class="sub-title">∆˜øˆ¥ı ∞ﬂ¿˚ ¡§∫∏ (ø¯∫ª)</h3>
            <table class="print-info-table">
                <tr>
                    <th>∞ﬂ¿˚∏Ì</th><td colspan="3">${d.quotationSnapshot?.title || '-'}</td>
                </tr>
                <tr>
                    <th>∞ﬂ¿˚¿œ</th><td>${d.quotationSnapshot?.date || '-'}</td>
                    <th>º±¿˚«¸≈¬</th><td>${d.quotationSnapshot?.shipmentType || '-'}</td>
                </tr>
                <tr>
                    <th>POL / POD</th><td>${d.quotationSnapshot?.pol || '-'} / ${d.quotationSnapshot?.pod || '-'}</td>
                    <th>¿˚øÎ ∆˜øˆ¥ı</th><td>${d.quotationSnapshot?.forwarderName || '-'}</td>
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
            <h2 class="section-title">2. ¡æ«’ ø‰æ‡ ¥ÎΩ√∫∏µÂ</h2>
            <table class="print-dash-table">
                <tr>
                    <th>øπªÛ √— ∞ﬂ¿˚∫ÒøÎ</th>
                    <th>Ω«¡¶ √— ≈ı¿‘∫ÒøÎ</th>
                    <th>º¯ºˆ π∞∑˘∫Ò ¡ı∞®</th>
                    <th>√— »Ø¬˜¿Õ / »Ø¬˜º’</th>
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
            <h2 class="section-title">3. «◊∏Ò∫∞ ∫Œ¥Î∫ÒøÎ ªÛºº ≥ªø™</h2>
            <table class="print-data-table">
                <thead>
                    <tr>
                        <th rowspan="2">±∏∫–</th>
                        <th rowspan="2">«◊∏Ò∏Ì</th>
                        <th colspan="3">øπªÛ ∞ﬂ¿˚</th>
                        <th colspan="3">Ω«¡¶ √ª±∏ (¿‘∑¬)</th>
                    </tr>
                    <tr>
                        <th>ø‹»≠±›æ◊</th>
                        <th>»Ø¿≤</th>
                        <th>ø¯»≠(KRW)</th>
                        <th>ø‹»≠±›æ◊</th>
                        <th>»Ø¿≤</th>
                        <th>ø¯»≠(KRW)</th>
                    </tr>
                </thead>
                <tbody>`;
        
        let hasCosts = false;
        if (d.actualCosts && d.actualCosts.length > 0) {
            d.actualCosts.forEach(cost => {
                hasCosts = true;
                const groupName = cost.group === 'invoice' ? 'π∞«∞¥Î±›' : (cost.group === 'ocean' ? '«ÿªÛøÓ¿”' : (cost.group === 'export' ? 'ºˆ√‚±π∫ÒøÎ' : (cost.group === 'import' ? 'ºˆ¿‘±π∫ÒøÎ' : (cost.group === 'customs' ? '≈Î∞¸/∞¸ºº' : (cost.group === 'handling' ? '∆˜øˆ¥ıºˆºˆ∑·' : (cost.group === 'finance' ? '±›¿∂∫ÒøÎ' : '±‚≈∏'))))));
                
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
            html += `<tr><td colspan="8" class="text-center">µÓ∑œµ» ∫ÒøÎ «◊∏Ò¿Ã æ¯Ω¿¥œ¥Ÿ.</td></tr>`;
        }

        html += `</tbody></table></div>`;
    }

    // 4. Summary Table
    if (opts.showSummary) {
        html += `
        <div class="print-section">
            <h2 class="section-title">4. ∫ÒøÎ ø‰æ‡ (øπªÛ ∞ﬂ¿˚ vs Ω«¡¶ √ª±∏)</h2>
            <table class="print-data-table">
                ${document.getElementById('summaryTableSection').querySelector('.grid-table').innerHTML}
            </table>
        </div>`;
    }

    // 5. Cost Distribution
    if (opts.showItems) {
        html += `
        <div class="print-section">
            <h2 class="section-title">5. «∞∏Ò∫∞ Ω«ºˆ¿‘ø¯∞° ªÍ√‚ (∞°ƒ°∫Ò∑  πË∫–π˝)</h2>
            <table class="print-data-table">
                ${document.getElementById('costTableValue').innerHTML}
            </table>
            
            <br>
            <h2 class="section-title">6. «∞∏Ò∫∞ Ω«ºˆ¿‘ø¯∞° ªÍ√‚ (√º¿˚/øÓ¿”≈Ê πË∫–π˝)</h2>
            <table class="print-data-table">
                ${document.getElementById('costTableVolume').innerHTML}
            </table>
        </div>`;
    }
    
    // Remarks
    if (opts.showInfo) {
        html += `
        <div class="print-section">
            <h2 class="section-title">∫Ò∞Ì π◊ ∆Ø¿ÃªÁ«◊</h2>
            <div class="print-remarks">
                ${(d.remarks || "").replace(/\n/g, "<br>")}
            </div>
        </div>`;
    }

    html += `</div>`;
    return html;
}


