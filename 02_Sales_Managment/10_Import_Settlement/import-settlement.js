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
    { key: 'OF', label: '해상운임 (O/F, Ocean Freight)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'PSS', label: '성수기 할증료 (P.S.S)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'LSS', label: '저유황유 할증료 (L.S.S)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'BAF', label: '유류할증료 (B.A.F)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CAF', label: '통화조정할증료 (C.A.F)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: true } },

    { key: 'CY', label: 'CY비 (CY Charge)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'PORT', label: '항만비용 (Port Charge)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'EDI', label: 'EDI/서류/부킹 (EDI+Doc+Sur+Bkg)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'THC_E', label: '터미널하역비 수출 (THC E)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'VGM', label: '총중량검증비 (VGM)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'CUST_E', label: '수출통관비 (Customs E)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'TRK_E', label: '내륙운송 수출 (Trucking E)', defaultUnit: 'Lump Sum', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    
    { key: 'CRS', label: '컨테이너회송료 (C.R.S)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'HNDL', label: '취급수수료 (Handling Charge)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DO', label: '화물인도지시서 (D/O)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'THC_I', label: '터미널하역비 수입 (THC I)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'WHFG', label: '부두사용료 (Wharfage)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TSF', label: '터미널보안료 (TSF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'PSMF', label: '항만안전관리비 (PSMF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CCC', label: '컨테이너세정비 (CCC)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DOC', label: '서류대행비 (DOC)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'STRIP', label: '컨테이너적출료 (Stripping)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TRK_I', label: '내륙운송 수입 (Trucking I)', defaultUnit: 'Lump Sum', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    
    { key: 'INS', label: '적하보험료 (Cargo Ins)', defaultUnit: 'Lump Sum', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'CUST_I', label: '통관수수료 (Customs I)', defaultUnit: 'per B/L', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: true } }
];

const UNIT_OPTIONS = ['Lump Sum', 'per Container', 'per B/L', 'per CBM', 'per R/T', 'per TON', 'per Unit'];

// ─────────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 초기화 및 이벤트 바인딩
// ─────────────────────────────────────────────────────────────
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
    
    document.getElementById('btnCloseQuoteModal').addEventListener('click', () => document.getElementById('quoteModal').classList.remove('active'));
    document.getElementById('btnCancelQuoteModal').addEventListener('click', () => document.getElementById('quoteModal').classList.remove('active'));
    document.getElementById('btnConfirmQuote').addEventListener('click', loadSelectedQuote);

    // 기본 정보 입력
    ['docTitle', 'docDate', 'docStatus', 'docRemarks'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => {
            const key = id.replace('doc', '');
            state.doc[key.charAt(0).toLowerCase() + key.slice(1)] = e.target.value;
        });
    });
    
    // 엑셀, 인쇄
    document.getElementById('btnPrint').addEventListener('click', () => window.print());
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);
    
    // 목록 전체 선택
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

// ─────────────────────────────────────────────────────────────
// 목록 관리
// ─────────────────────────────────────────────────────────────
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
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem;">저장된 정산 내역이 없습니다.</td></tr>';
        return;
    }
    
    let html = '';
    state.list.forEach(item => {
        const statusMap = { 'draft': '작성 중', 'completed': '정산 완료' };
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

// ─────────────────────────────────────────────────────────────
// 견적 불러오기 (모달)
// ─────────────────────────────────────────────────────────────
async function openQuoteModal() {
    try {
        const quotes = await authFetch(QUOTE_API);
        // 확정된(confirmed) 견적만 필터링 (원하면 모두 표시 가능, 여기서는 모두 표시하되 최신순 정렬)
        state.quotes = quotes;
        
        const tbody = document.getElementById('quoteModalBody');
        if (quotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">저장된 포워더 견적이 없습니다.</td></tr>';
        } else {
            let html = '';
            quotes.forEach((q, idx) => {
                const statusMap = { 'draft': '초안', 'confirmed': '확정', 'expired': '만료' };
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
        showToast('견적 목록을 불러오는 중 오류가 발생했습니다.', true);
    }
}

function loadSelectedQuote() {
    const radio = document.querySelector('input[name="selectedQuote"]:checked');
    if (!radio) return showToast('불러올 견적을 선택하세요.', true);
    
    const idx = radio.value;
    const quote = state.quotes[idx];
    const fwIdx = document.getElementById(`selFw_${idx}`).value;
    const term = document.getElementById(`selTerm_${idx}`).value;
    
    if (!fwIdx || !term) return showToast('포워더와 인코텀즈를 모두 선택하세요.', true);
    
    const forwarder = quote.forwarders[fwIdx];
    
    // 신규 정산 객체 초기화
    state.doc = {
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
        title: quote.title + ' 정산',
        settlementDate: new Date().toISOString().split('T')[0],
        paidRates: { ...quote.exchangeRates }, // 기본적으로 견적 환율로 초기 세팅
        actualCosts: [],
        status: 'draft',
        remarks: ''
    };
    
    // 물품 대금(Invoice) 초기화 (그룹화)
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
            label: '물품 대금 (KRW 환산) - ' + curr,
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

    // 비용 항목 초기화
    state.doc.quotationSnapshot.costs.forEach(c => {
        let amt = parseFloat(c.amount) || 0;
        let qty = parseFloat(c.unitQty) || 1;
        let quotedTotalForeign = amt * qty;
        
        state.doc.actualCosts.push({
            id: generateId(),
            key: c.key,
            group: c.group || 'import', // 추가: 과세표준 구분을 위해 그룹 저장
            label: c.label,
            unit: c.unit,
            currency: c.currency, // Legacy
            quotedCurrency: c.currency,
            quotedUnit: c.unit,       // 견적 원본 단위 보존
            quotedQty: qty,           // 견적 원본 수량 보존
            quotedAmount: amt,        // 견적 원본 단가 보존
            billedCurrency: c.currency,
            quotedForeign: quotedTotalForeign,
            amount: amt,
            unitQty: qty,
            billedRate: (quote.exchangeRates && quote.exchangeRates[c.currency]) ? quote.exchangeRates[c.currency] : 0,
        });
    });

    // 기타 비용 (이자비용 등) 가져오기
    if (quote.otherCosts && Array.isArray(quote.otherCosts)) {
        // 이자비용 계산을 위한 원본 견적 금액(원금) 산출
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
            
            // 이자비용 (견적 기준 초기 원금)
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
                group: 'other', // 기타비용 탭
                label: oc.name || oc.label || '기타비용',
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
                isCustom: false, // 견적서에서 불러온 항목은 모두 고정 텍스트로 처리
                durationMonths: duration,
                collectionDays: colDays,
                interestRate: rate
            });
        });
    }

    // 화면 갱신
    document.getElementById('quoteModal').classList.remove('active');
    fillFormFromState();
    switchView('edit');
}

// ─────────────────────────────────────────────────────────────
// 화면 렌더링 (Edit View)
// ─────────────────────────────────────────────────────────────
function fillFormFromState() {
    const doc = state.doc;
    const snap = doc.quotationSnapshot;
    
    // 기본 정보
    document.getElementById('docTitle').value = doc.title;
    document.getElementById('docDate').value = doc.settlementDate;
    document.getElementById('docStatus').value = doc.status;
    document.getElementById('docRemarks').value = doc.remarks || '';
    
    // 읽기 전용 견적 정보
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
        showToast('문서를 불러오는 중 오류가 발생했습니다.', true);
    }
};

// ─────────────────────────────────────────────────────────────
// 정산 그리드 렌더링 & 계산
// ─────────────────────────────────────────────────────────────
const COST_GROUPS = [
    { key: 'invoice', label: '물품 대금' },
    { key: 'ocean', label: '해상 운임 (O/F)' },
    { key: 'export', label: '수출국 부대비용' },
    { key: 'import', label: '수입국 부대비용' },
    { key: 'customs', label: '통관/관세' },
    { key: 'other', label: '기타 비용' }
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
                        <span class="subtotal-label">견적</span>
                        <span class="subtotal-value" id="grpEst_${grp.key}">₩ 0</span>
                    </div>
                    <div class="subtotal-item">
                        <span class="subtotal-label">실제</span>
                        <span class="subtotal-value" id="grpAct_${grp.key}">₩ 0</span>
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
                let optsHtml = `<option value="">-- 직접 입력 --</option>`;
                DEFAULT_COSTS.filter(c => c.group === cost.group).forEach(c => {
                    optsHtml += `<option value="${c.key}" ${cost.key === c.key ? 'selected' : ''}>${c.label}</option>`;
                });
                labelHtml = `
                    <div class="item-label-custom">
                        <select class="calc-input" onchange="onCostKeyChange(${idx}, this.value)" style="font-size:0.85rem;">${optsHtml}</select>
                        <input type="text" class="calc-input" value="${cost.label}" placeholder="항목명 직접 입력" style="display:${isDirectInput ? 'block' : 'none'}; font-size:0.85rem;" oninput="updateCost(${idx}, 'label', this.value)">
                    </div>`;
            } else {
                labelHtml = `<span class="item-label">${cost.label}</span>`;
            }

            // Currency select HTML
            const currOptions = ['KRW','USD','CNY','EUR','JPY'].map(c =>
                `<option value="${c}" ${bCurr===c?'selected':''}>${c}</option>`
            ).join('');

            html += `
            <div class="cost-item-card" draggable="true" data-idx="${idx}"
                ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)"
                ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)"
                ondrop="handleDrop(event, ${idx})" ondragend="handleDragEnd(event)">

                <div class="card-top">
                    <i class='bx bx-grid-vertical drag-handle' title="드래그하여 순서 변경"></i>
                    ${labelHtml}
                    <button class="btn-delete-item" onclick="removeCost(${idx})" title="항목 삭제"><i class='bx bx-trash'></i></button>
                </div>

                <div class="card-body">
                    <!-- 좌측: 예상 견적 (Read-only) -->
                    ${cost.key === 'INTEREST' ? `
                    <div class="panel-quote">
                        <div class="panel-title"><i class='bx bx-file'></i> 예상 견적</div>
                        <div class="panel-row">
                            <span class="p-label">사업기간</span>
                            <span class="p-value">${cost.durationMonths || 0} 개월</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">대금회수</span>
                            <span class="p-value">${cost.collectionDays || 0} 일</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">연이자율</span>
                            <span class="p-value">${cost.interestRate || 0} %</span>
                        </div>
                        <div class="panel-row" style="background:rgba(100,116,139,0.06); margin:4px -12px; padding:6px 12px; margin-top:20px;">
                            <span class="p-label" style="font-weight:600;">견적금액</span>
                            <span class="p-value" style="font-weight:600;">₩ ${formatNum(cost.quotedAmount)}</span>
                        </div>
                    </div>
                    ` : `
                    <div class="panel-quote">
                        <div class="panel-title"><i class='bx bx-file'></i> 예상 견적</div>
                        <div class="panel-row">
                            <span class="p-label">단위</span>
                            <span class="p-value">${cost.isCustom ? '-' : (cost.quotedUnit || cost.unit || '-')}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">통화</span>
                            <span class="p-value">${cost.isCustom ? '-' : qCurr}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">수량</span>
                            <span class="p-value">${cost.isCustom ? '-' : (cost.quotedQty != null ? cost.quotedQty : '-')}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">단가</span>
                            <span class="p-value">${cost.isCustom ? '-' : formatNum(cost.quotedAmount, 2)}</span>
                        </div>
                        <div class="panel-row" style="background:rgba(100,116,139,0.06); margin:4px -12px; padding:6px 12px;">
                            <span class="p-label" style="font-weight:600;">견적금액</span>
                            <span class="p-value" style="font-weight:600;">${cost.isCustom ? '-' : formatNum(cost.quotedForeign, 2)}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">환율</span>
                            <span class="p-value">${cost.isCustom ? '-' : (qCurr === 'KRW' ? '-' : formatNum(qRate, 2))}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">원화(KRW)</span>
                            <span class="p-value" style="font-weight:700;">₩ ${formatNum(qKrw)}</span>
                        </div>
                    </div>
                    `}

                    <!-- 우측: 실제 청구 (Editable) -->
                    ${cost.key === 'INTEREST' ? `
                    <div class="panel-billed">
                        <div class="panel-title"><i class='bx bx-edit-alt'></i> 실제 청구 (입력)</div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">사업기간</span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" style="text-align:right;" value="${cost.durationMonths || 0}" oninput="updateCost(${idx}, 'durationMonths', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">개월</span>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">대금회수</span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" style="text-align:right;" value="${cost.collectionDays || 0}" oninput="updateCost(${idx}, 'collectionDays', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">일</span>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label" style="flex:0 0 70px;">연이자율</span>
                            <div class="p-input-wide" style="display:flex; align-items:center;">
                                <input type="number" class="calc-input" step="0.1" style="text-align:right;" value="${cost.interestRate || 0}" oninput="updateCost(${idx}, 'interestRate', this.value)">
                                <span style="font-size:0.85rem; color:#64748b; margin-left:5px; white-space:nowrap;">%</span>
                            </div>
                        </div>
                        <div class="panel-row" style="background:rgba(37,99,235,0.05); margin:4px -12px; padding:6px 12px; margin-top:20px;">
                            <span class="p-label" style="color:#1d4ed8; font-weight:600;">청구금액</span>
                            <span class="p-value" id="billedForeign_${idx}" style="color:#1d4ed8; font-size:0.95rem; font-weight:700;">₩ ${formatNum(amt)}</span>
                        </div>
                    </div>
                    ` : `
                    <div class="panel-billed">
                        <div class="panel-title"><i class='bx bx-edit-alt'></i> 실제 청구 (입력)</div>
                        <div class="panel-row">
                            <span class="p-label">단위</span>
                            <div class="p-input-wide">
                                <input type="text" class="calc-input" value="${cost.unit}" style="text-align:center;" oninput="updateCost(${idx}, 'unit', this.value)">
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">통화</span>
                            <div class="p-input">
                                <select class="calc-input curr-select" onchange="updateCost(${idx}, 'billedCurrency', this.value)">${currOptions}</select>
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">수량</span>
                            <div class="p-input">
                                <input type="number" class="calc-input" step="0.01" value="${qty}" oninput="updateCost(${idx}, 'unitQty', this.value)">
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">단가</span>
                            <div class="p-input">
                                <input type="number" class="calc-input" step="0.01" value="${amt}" oninput="updateCost(${idx}, 'amount', this.value)">
                            </div>
                        </div>
                        <div class="panel-row" style="background:rgba(37,99,235,0.05); margin:4px -12px; padding:6px 12px;">
                            <span class="p-label" style="color:#1d4ed8; font-weight:600;">청구금액</span>
                            <span class="p-value" id="billedForeign_${idx}" style="color:#1d4ed8; font-size:0.95rem;">${formatNum(billedForeign, 2)}</span>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">환율</span>
                            <div class="p-input">
                                ${bCurr === 'KRW' ? '<span class="p-value">-</span>' : `<input type="number" class="calc-input" step="0.01" value="${cost.billedRate}" oninput="updateCost(${idx}, 'billedRate', this.value)">`}
                            </div>
                        </div>
                        <div class="panel-row">
                            <span class="p-label">원화(KRW)</span>
                            <span class="p-value" id="billedKrw_${idx}" style="font-weight:700;">₩ ${formatNum(billedForeign * (bCurr === 'KRW' ? 1 : cost.billedRate))}</span>
                        </div>
                    </div>
                    `}
                </div>

                <!-- 하단: 결과 -->
                <div class="card-result">
                    <div class="result-item">
                        <div class="r-label">실제 원화(KRW)</div>
                        <div class="r-value" id="krw_${idx}">₩ 0</div>
                    </div>
                    <div class="result-item">
                        <div class="r-label">비용증감</div>
                        <div class="r-value" id="var_${idx}">0</div>
                    </div>
                    <div class="result-item">
                        <div class="r-label">환차익/손</div>
                        <div class="r-value" id="gl_${idx}">0</div>
                    </div>
                </div>
            </div>`;
        });

        html += `
            </div>
            <div class="cost-group-footer">
                <button class="btn-add-in-group" onclick="addCustomCost('${grp.key}')">
                    <i class='bx bx-plus'></i> ${grp.label} 항목 추가
                </button>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// 아코디언 토글
// ─────────────────────────────────────────────────────────────
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
        label: '사용자 추가 항목',
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
    
    // --- 2-Pass 이자비용 실시간 산출 로직 ---
    // 1. 물품대 원화 환산액(invKrw) 산출 (실제 청구 환율 반영)
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

    // 2. 이자비용을 제외한 나머지 실제 부대비용 원화 합산액(subKrw) 산출
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

    // 3. 이자비용 항목의 실제 청구금액 업데이트
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
        const gk = cost.group || 'other';
        if (grpEst[gk] !== undefined) { grpEst[gk] += qKrw; grpAct[gk] += bKrw; }
        
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

        // UI 업데이트
        const bfEl = document.getElementById(`billedForeign_${idx}`);
        const bkEl = document.getElementById(`billedKrw_${idx}`);
        const krwEl = document.getElementById(`krw_${idx}`);
        const varEl = document.getElementById(`var_${idx}`);
        const glEl = document.getElementById(`gl_${idx}`);
        
        if (bfEl) bfEl.innerText = formatNum(billedForeign, 2);
        if (bkEl) bkEl.innerText = '₩ ' + formatNum(bKrw);
        if (krwEl) krwEl.innerText = '₩ ' + formatNum(bKrw);
        
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
        if (estEl) estEl.innerText = '₩ ' + formatNum(grpEst[g.key]);
        if (actEl) actEl.innerText = '₩ ' + formatNum(grpAct[g.key]);
    });
    
    // 대시보드 업데이트
    document.getElementById('dashTotalEstimated').innerText = '₩ ' + formatNum(totalEstKrw);
    document.getElementById('dashTotalBilled').innerText = '₩ ' + formatNum(totalBilledKrw);
    
    // 퍼센티지
    const pctEl = document.getElementById('dashBilledPct');
    if (pctEl && totalEstKrw > 0) {
        const pct = ((totalBilledKrw - totalEstKrw) / totalEstKrw * 100);
        const icon = pct > 0 ? '▲' : (pct < 0 ? '▼' : '');
        pctEl.innerText = `${icon} ${Math.abs(pct).toFixed(1)}%`;
        pctEl.className = 'dash-pct ' + (pct > 0 ? 'over' : (pct < 0 ? 'under' : 'neutral'));
    }
    
    const dVar = document.getElementById('dashCostVariance');
    dVar.innerText = (totalCostVariance > 0 ? '+₩ ' : '₩ ') + formatNum(totalCostVariance);
    dVar.style.color = totalCostVariance > 0 ? '#dc2626' : (totalCostVariance < 0 ? '#16a34a' : 'inherit');
    
    const dGl = document.getElementById('dashExchangeGainLoss');
    dGl.innerText = (totalExchangeVariance > 0 ? '+₩ ' : '₩ ') + formatNum(totalExchangeVariance);
    dGl.style.color = totalExchangeVariance > 0 ? '#dc2626' : (totalExchangeVariance < 0 ? '#16a34a' : 'inherit');
    
    // 6. 비용 요약 (Summary Table) 렌더링
    const sumTbody = document.getElementById('summaryTableBody');
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
            const diffStr = diff > 0 ? '+₩ ' + formatNum(diff) : (diff < 0 ? '-₩ ' + formatNum(Math.abs(diff)) : '₩ 0');
            
            htmlBody += `
                <tr>
                    <td style="padding:10px 12px;">${g.label} ${g.key !== 'invoice' && g.key !== 'other' ? '[+]' : ''}</td>
                    <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(est)}</td>
                    <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(act)}</td>
                    <td class="col-num" style="padding:10px 12px; color:${diffColor};">${diffStr}</td>
                </tr>
            `;
            
            // "통관/관세" 직후에 포워더 소계 출력
            if (g.key === 'customs') {
                const fwDiff = fwAct - fwEst;
                const fwDiffColor = fwDiff > 0 ? '#dc2626' : (fwDiff < 0 ? '#16a34a' : 'inherit');
                const fwDiffStr = fwDiff > 0 ? '+₩ ' + formatNum(fwDiff) : (fwDiff < 0 ? '-₩ ' + formatNum(Math.abs(fwDiff)) : '₩ 0');
                
                htmlBody += `
                    <tr style="background:#f1f5f9; font-weight:600;">
                        <td style="padding:10px 12px;">포워더 부대비용 소계 (KRW)</td>
                        <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(fwEst)}</td>
                        <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(fwAct)}</td>
                        <td class="col-num" style="padding:10px 12px; color:${fwDiffColor};">${fwDiffStr}</td>
                    </tr>
                `;
            }
        });
        
        // 이자비용 단독 행 추가
        const intDiff = interestAct - interestEst;
        const intDiffColor = intDiff > 0 ? '#dc2626' : (intDiff < 0 ? '#16a34a' : 'inherit');
        const intDiffStr = intDiff > 0 ? '+₩ ' + formatNum(intDiff) : (intDiff < 0 ? '-₩ ' + formatNum(Math.abs(intDiff)) : '₩ 0');
        
        htmlBody += `
            <tr>
                <td style="padding:10px 12px;">금융비용 (이자비용)</td>
                <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(interestEst)}</td>
                <td class="col-num" style="padding:10px 12px;">₩ ${formatNum(interestAct)}</td>
                <td class="col-num" style="padding:10px 12px; color:${intDiffColor};">${intDiffStr}</td>
            </tr>
        `;
        
        sumTbody.innerHTML = htmlBody;
        
        // 총 합계
        const totalDiff = totalBilledKrw - totalEstKrw;
        const totalDiffColor = totalDiff > 0 ? '#fca5a5' : (totalDiff < 0 ? '#86efac' : 'inherit'); 
        const totalDiffStr = totalDiff > 0 ? '+₩ ' + formatNum(totalDiff) : (totalDiff < 0 ? '-₩ ' + formatNum(Math.abs(totalDiff)) : '₩ 0');
        
        sumTfoot.innerHTML = `
            <tr>
                <td style="padding:12px;">총 비용 (물품+포워더+기타) KRW</td>
                <td class="col-num" style="padding:12px;">₩ ${formatNum(totalEstKrw)}</td>
                <td class="col-num" style="padding:12px;">₩ ${formatNum(totalBilledKrw)}</td>
                <td class="col-num" style="padding:12px; color:${totalDiffColor};">${totalDiffStr}</td>
            </tr>
        `;
    }

    // 5. 관세/부가세 계산
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

    // 실청구 기준 배분비율
    const allocationRatio = totalInvoiceKrw > 0 ? (totalBilledKrw / totalInvoiceKrw) : 0;
    // 견적 기준 배분비율
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
            htmlValue += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="7" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            htmlVolume += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="7" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            return;
        }

        const unitPriceFC = p.unitPrice;
        const exRate = snapRates[p.currency] || 1;
        const dutyRate = item.dutyRate || 0;

        // === 실청구 기준 (가치비례 배분) ===
        const allocatedFC_Value_Total = unitPriceFC * allocationRatio;
        const dutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableAncillaryKrw / totalInvoiceKrw) : 0;
        const allocatedFC_Value_Dutiable = unitPriceFC * dutiableAllocationRatio;

        const baseCostFC_Value = unitPriceFC + allocatedFC_Value_Total;
        const baseCostKrw_Value = baseCostFC_Value * exRate;

        const cifValueKrw_Value = (unitPriceFC + allocatedFC_Value_Dutiable) * exRate;
        const dutyKrw_Value = cifValueKrw_Value * (dutyRate / 100);

        const realCostKrw_Value = baseCostKrw_Value + dutyKrw_Value;

        // === 견적 기준 (가치비례 배분) ===
        const estAllocatedFC_Value_Total = unitPriceFC * estAllocationRatio;
        const estDutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableEstKrw / totalInvoiceKrw) : 0;
        const estAllocatedFC_Value_Dutiable = unitPriceFC * estDutiableAllocationRatio;

        const estBaseCostFC_Value = unitPriceFC + estAllocatedFC_Value_Total;
        const estBaseCostKrw_Value = estBaseCostFC_Value * exRate;

        const estCifValueKrw_Value = (unitPriceFC + estAllocatedFC_Value_Dutiable) * exRate;
        const estDutyKrw_Value = estCifValueKrw_Value * (dutyRate / 100);

        const estCostKrw_Value = estBaseCostKrw_Value + estDutyKrw_Value;

        // 증감
        const diffValue = realCostKrw_Value - estCostKrw_Value;
        const diffColorValue = diffValue > 0 ? '#dc2626' : (diffValue < 0 ? '#16a34a' : 'inherit');
        const diffTextValue = diffValue > 0 ? `+₩ ${formatNum(diffValue)}` : `₩ ${formatNum(diffValue)}`;

        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Value_Total, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Value, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Value)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num" style="background:#f0fdf4;">₩ ${formatNum(estCostKrw_Value)}</td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Value)}</td>
                <td class="col-num" style="color:${diffColorValue}; font-weight:600;">${diffTextValue}</td>
            </tr>
        `;

        // === 실청구 기준 (체적/운임톤 배분) ===
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

            allocatedFC_Volume_Total = (itemTotalAncillaryKrw / exRate) / item.qty;
            allocatedFC_Volume_Dutiable = (itemDutiableAncillaryKrw / exRate) / item.qty;
        }

        const baseCostFC_Volume = unitPriceFC + allocatedFC_Volume_Total;
        const baseCostKrw_Volume = baseCostFC_Volume * exRate;

        const cifValueKrw_Volume = (unitPriceFC + allocatedFC_Volume_Dutiable) * exRate;
        const dutyKrw_Volume = cifValueKrw_Volume * (dutyRate / 100);

        const realCostKrw_Volume = baseCostKrw_Volume + dutyKrw_Volume;

        // === 견적 기준 (체적/운임톤 배분) ===
        let estAllocatedFC_Volume_Total = 0;
        let estAllocatedFC_Volume_Dutiable = 0;

        if (totalModulus > 0 && item.qty > 0) {
            const estItemTotalAncillaryKrw = totalEstKrw * volumeShareRatio;
            const estItemDutiableAncillaryKrw = totalDutiableEstKrw * volumeShareRatio;

            estAllocatedFC_Volume_Total = (estItemTotalAncillaryKrw / exRate) / item.qty;
            estAllocatedFC_Volume_Dutiable = (estItemDutiableAncillaryKrw / exRate) / item.qty;
        }

        const estBaseCostFC_Volume = unitPriceFC + estAllocatedFC_Volume_Total;
        const estBaseCostKrw_Volume = estBaseCostFC_Volume * exRate;

        const estCifValueKrw_Volume = (unitPriceFC + estAllocatedFC_Volume_Dutiable) * exRate;
        const estDutyKrw_Volume = estCifValueKrw_Volume * (dutyRate / 100);

        const estCostKrw_Volume = estBaseCostKrw_Volume + estDutyKrw_Volume;

        // 증감
        const diffVolume = realCostKrw_Volume - estCostKrw_Volume;
        const diffColorVolume = diffVolume > 0 ? '#dc2626' : (diffVolume < 0 ? '#16a34a' : 'inherit');
        const diffTextVolume = diffVolume > 0 ? `+₩ ${formatNum(diffVolume)}` : `₩ ${formatNum(diffVolume)}`;

        const shareText = isLCL ? 
            ((volumeShareRatio * 100).toFixed(1) + '% (R/T)') : 
            (item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '<span style="color:var(--danger);font-size:0.85em">적재량 누락</span>');

        htmlVolume += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${shareText}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Volume_Total, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Volume, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Volume)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num" style="background:#f0fdf4;">₩ ${formatNum(estCostKrw_Volume)}</td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Volume)}</td>
                <td class="col-num" style="color:${diffColorVolume}; font-weight:600;">${diffTextVolume}</td>
            </tr>
        `;
    });

    if (tbodyValue) tbodyValue.innerHTML = htmlValue;
    if (tbodyVolume) tbodyVolume.innerHTML = htmlVolume;
}

// ─────────────────────────────────────────────────────────────
// 저장 및 기타 액션
// ─────────────────────────────────────────────────────────────
async function saveSettlement() {
    if (!state.doc.title) return showToast('정산 문서명을 입력하세요.', true);
    if (!state.doc.settlementDate) return showToast('정산 일자를 입력하세요.', true);
    if (!state.doc.quotationId) return showToast('연동된 견적이 없습니다.', true);
    
    // 강제 동기화 (방어 코드)
    document.querySelectorAll('.calc-input').forEach(el => el.dispatchEvent(new Event('input')));

    try {
        const isNew = !state.doc.id;
        const url = isNew ? API_BASE : `${API_BASE}/${state.doc.id}`;
        const method = isNew ? 'POST' : 'PUT';
        
        await authFetch(url, {
            method,
            body: JSON.stringify(state.doc)
        });
        
        showToast('저장되었습니다.');
        loadList();
        switchView('list');
    } catch (err) {
        showToast(err.message, true);
    }
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.row-chk:checked')).map(cb => cb.value);
    if (ids.length === 0) return showToast('삭제할 항목을 선택하세요.', true);
    if (!confirm(`선택한 ${ids.length}건을 삭제하시겠습니까?`)) return;
    
    try {
        await authFetch(`${API_BASE}/delete`, {
            method: 'POST',
            body: JSON.stringify({ ids })
        });
        showToast('삭제되었습니다.');
        loadList();
    } catch (err) {
        showToast(err.message, true);
    }
}

function exportExcel() {
    showToast('엑셀 내보내기 기능은 준비 중입니다.', false);
    // 추후 구현
}
