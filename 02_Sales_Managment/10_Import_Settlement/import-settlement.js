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

const formatNum = (num, decimals = 0) => Number(num).toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

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
    document.getElementById('btnAddCustomCost').addEventListener('click', window.addCustomCost);
    
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
            billedCurrency: c.currency,
            quotedForeign: quotedTotalForeign,
            amount: amt,
            unitQty: qty,
            billedRate: (quote.exchangeRates && quote.exchangeRates[c.currency]) ? quote.exchangeRates[c.currency] : 0,
        });
    });

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
    { key: 'ocean', label: '해상 운임 (O/F)' },
    { key: 'export', label: '수출국 부대비용' },
    { key: 'import', label: '수입국 부대비용' },
    { key: 'customs', label: '통관/관세' },
    { key: 'other', label: '기타 비용' }
];

function renderSettlementGrid() {
    const tbody = document.getElementById('settlementTableBody');
    let html = '';
    
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};

    state.doc.actualCosts.forEach((cost, idx) => {
        const qCurr = cost.quotedCurrency || cost.currency || 'KRW';
        const bCurr = cost.billedCurrency || cost.currency || 'KRW';

        let qRate = qCurr === 'KRW' ? 1 : (snapRates[qCurr] || 0);
        let qKrw = cost.quotedForeign * qRate;

        // 1. 그룹 선택
        let groupHtml = '';
        if (cost.isCustom) {
            groupHtml = `<select class="calc-input" style="width:100%;" onchange="updateCost(${idx}, 'group', this.value)">`;
            COST_GROUPS.forEach(g => {
                groupHtml += `<option value="${g.key}" ${cost.group === g.key ? 'selected' : ''}>${g.label}</option>`;
            });
            groupHtml += `</select>`;
        } else {
            const grp = COST_GROUPS.find(g => g.key === cost.group);
            groupHtml = grp ? grp.label : (cost.group === 'ocean' ? '해상 운임' : cost.group);
        }

        // 2. 항목명 선택/입력
        let labelHtml = cost.label;
        if (cost.isCustom) {
            let optsHtml = `<option value="">-- 직접 입력 --</option>`;
            DEFAULT_COSTS.filter(c => c.group === cost.group).forEach(c => {
                optsHtml += `<option value="${c.key}" ${cost.key === c.key ? 'selected' : ''}>${c.label}</option>`;
            });
            
            labelHtml = `
                <div style="display:flex; flex-direction:column; gap:4px; width:100%;">
                    <select class="calc-input" onchange="onCostKeyChange(${idx}, this.value)">
                        ${optsHtml}
                    </select>
                    <input type="text" class="calc-input" value="${cost.label}" style="width:100%; padding:4px;" oninput="updateCost(${idx}, 'label', this.value)">
                </div>
            `;
        }

        // 3. 단위 / 통화
        let unitHtml = `<input type="text" class="calc-input" value="${cost.unit}" style="width:100%; text-align:center; padding:4px; margin-bottom:4px;" oninput="updateCost(${idx}, 'unit', this.value)">`;
        let currHtml = `
            <select class="calc-input curr-select" style="padding:4px; width:100%; text-align:center; cursor:pointer;" onchange="updateCost(${idx}, 'billedCurrency', this.value)">
                <option value="KRW" ${bCurr==='KRW'?'selected':''}>KRW</option>
                <option value="USD" ${bCurr==='USD'?'selected':''}>USD</option>
                <option value="CNY" ${bCurr==='CNY'?'selected':''}>CNY</option>
                <option value="EUR" ${bCurr==='EUR'?'selected':''}>EUR</option>
                <option value="JPY" ${bCurr==='JPY'?'selected':''}>JPY</option>
            </select>
        `;

        // 4. 합계
        let amt = parseFloat(cost.amount) || 0;
        let qty = parseFloat(cost.unitQty) || 1;
        let billedForeign = amt * qty;

        html += `
            <tr class="draggable-row" draggable="true" data-idx="${idx}"
                ondragstart="handleDragStart(event)" ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)"
                ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, ${idx})" ondragend="handleDragEnd(event)">
                
                <!-- 1. 그룹 -->
                <td class="col-readonly">
                    <div style="display:flex; align-items:center; gap:5px;">
                        <i class='bx bx-grid-vertical drag-handle' title="드래그하여 순서 변경"></i>
                        <button class="btn-icon" style="color:var(--danger-color); padding:0; display:flex; align-items:center;" onclick="removeCost(${idx})" title="항목 삭제"><i class='bx bx-trash'></i></button>
                        ${groupHtml}
                    </div>
                </td>
                
                <!-- 2. 항목명 -->
                <td class="col-readonly">${labelHtml}</td>
                
                <!-- 3. 예상 통화 -->
                <td class="col-readonly" style="text-align:center; background:#f8fafc; font-weight:500;">
                    ${cost.isCustom ? '-' : qCurr}
                </td>
                
                <!-- 4. 예상 외화 -->
                <td class="col-num col-readonly" style="background:#f8fafc;">
                    ${formatNum(cost.quotedForeign, 2)}
                </td>
                
                <!-- 5. 예상 원화 -->
                <td class="col-num col-readonly" style="font-weight:600; background:#f8fafc;">
                    ${formatNum(qKrw)}
                </td>
                
                <!-- 6. 실제 입력: 단위/통화 -->
                <td class="col-readonly" style="text-align:center; background:#f0f9ff;">
                    ${unitHtml}
                    ${currHtml}
                </td>
                
                <!-- 7. 실제 입력: 수량 -->
                <td style="background:#f0f9ff;">
                    <input type="number" class="calc-input" step="0.01" value="${qty}" oninput="updateCost(${idx}, 'unitQty', this.value)" style="width:100%; text-align:right;">
                </td>
                
                <!-- 8. 실제 입력: 단가 -->
                <td style="background:#f0f9ff;">
                    <input type="number" class="calc-input" step="0.01" value="${amt}" oninput="updateCost(${idx}, 'amount', this.value)" style="width:100%; text-align:right;">
                </td>
                
                <!-- 9. 실제 청구 외화 -->
                <td class="col-num" style="background:#e0f2fe; color:#0369a1; font-weight:600;">
                    ${formatNum(billedForeign, 2)}
                </td>
                
                <!-- 10. 실제 입력: 인보이스 환율 -->
                <td style="background:#f0f9ff;">
                    <input type="number" class="calc-input billed-rate" step="0.01" value="${cost.billedRate}" ${bCurr === 'KRW' ? 'readonly style="background:#f1f5f9;"' : ''} oninput="updateCost(${idx}, 'billedRate', this.value)">
                </td>
                
                <!-- 11. 최종 원화 -->
                <td class="col-num" style="font-weight:600; background:#fff1f2;" id="krw_${idx}">0</td>
                
                <!-- 12. 분석 -->
                <td class="col-num" style="line-height:1.4; background:#fff1f2;">
                    <div class="val-variance" id="var_${idx}">0</div>
                    <div class="val-gainloss" id="gl_${idx}" style="font-size:0.85em;">0</div>
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

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
    if (['amount', 'unitQty', 'billedRate'].includes(field)) {
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
        currency: 'KRW', // Legacy
        quotedCurrency: 'KRW',
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

// --- Drag and Drop Handlers ---
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
    const tr = e.target.closest('tr');
    if (tr) tr.classList.add('drag-over');
};

window.handleDragLeave = function(e) {
    const tr = e.target.closest('tr');
    if (tr && !tr.contains(e.relatedTarget)) {
        tr.classList.remove('drag-over');
    }
};

window.handleDrop = function(e, toIdx) {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('drag-over');
    
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
    
    let totalCostVariance = 0;
    let totalExchangeVariance = 0;
    
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};

    state.doc.actualCosts.forEach((cost, idx) => {
        const qCurr = cost.quotedCurrency || cost.currency || 'KRW';
        const bCurr = cost.billedCurrency || cost.currency || 'KRW';
        const isKrw = bCurr === 'KRW';
        
        let amt = parseFloat(cost.amount) || 0;
        let qty = parseFloat(cost.unitQty) || 1;
        let billedForeign = amt * qty;
        
        // 1. 견적 예상 원화
        let qRate = qCurr === 'KRW' ? 1 : (snapRates[qCurr] || 0);
        let qKrw = cost.quotedForeign * qRate;
        totalEstKrw += qKrw;
        
        // 2. 인보이스 실제 원화 (청구 기준)
        let bRate = isKrw ? 1 : cost.billedRate;
        let bKrw = billedForeign * bRate;
        totalBilledKrw += bKrw;
        
        if (cost.group === 'ocean' || cost.group === 'export' || cost.key === 'INS') {
            totalDutiableKrw += bKrw;
        }
        
        // 3. 분석 분리: 순수 물류비 증감 vs 환차익손
        let varKrw = 0;
        let glKrw = 0;
        
        if (qCurr === bCurr) {
            // 통화가 같은 경우 분리 가능
            varKrw = (billedForeign - cost.quotedForeign) * qRate;
            glKrw = (bRate - qRate) * billedForeign;
        } else {
            // 통화가 다르면 통폐합
            varKrw = bKrw - qKrw;
            glKrw = 0;
        }
        
        totalCostVariance += varKrw;
        totalExchangeVariance += glKrw;

        // UI 업데이트
        const krwEl = document.getElementById(`krw_${idx}`);
        const varEl = document.getElementById(`var_${idx}`);
        const glEl = document.getElementById(`gl_${idx}`);
        
        if (krwEl) krwEl.innerText = formatNum(bKrw);
        
        if (varEl) {
            varEl.innerText = varKrw > 0 ? '+' + formatNum(varKrw) : formatNum(varKrw);
            varEl.className = 'col-num val-variance ' + (varKrw > 0 ? 'positive' : (varKrw < 0 ? 'negative' : ''));
        }
        
        if (glEl) {
            glEl.innerText = glKrw > 0 ? '+' + formatNum(glKrw) : formatNum(glKrw);
            // 양수면 환율이 오른 것이므로 손실(loss)
            glEl.className = 'col-num val-gainloss ' + (glKrw > 0 ? 'loss' : (glKrw < 0 ? 'gain' : ''));
        }
    });
    
    // 대시보드 업데이트
    document.getElementById('dashTotalEstimated').innerText = '₩ ' + formatNum(totalEstKrw);
    document.getElementById('dashTotalBilled').innerText = '₩ ' + formatNum(totalBilledKrw);
    
    const dVar = document.getElementById('dashCostVariance');
    dVar.innerText = (totalCostVariance > 0 ? '+₩ ' : '₩ ') + formatNum(totalCostVariance);
    dVar.style.color = totalCostVariance > 0 ? '#dc2626' : (totalCostVariance < 0 ? '#16a34a' : 'inherit');
    
    const dGl = document.getElementById('dashExchangeGainLoss');
    dGl.innerText = (totalExchangeVariance > 0 ? '+₩ ' : '₩ ') + formatNum(totalExchangeVariance);
    // 대시보드 환차익/손 텍스트 색상 (흰색 베이스에 부호로 구분)
    
    // 5. 관세/부가세 계산 (실제 청구 비용 기준)
    renderCostResultTable(totalBilledKrw, totalDutiableKrw);
}

function renderCostResultTable(totalBilledKrw, totalDutiableAncillaryKrw) {
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

    const allocationRatio = totalInvoiceKrw > 0 ? (totalBilledKrw / totalInvoiceKrw) : 0;
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
            htmlValue += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="5" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            htmlVolume += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="5" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            return;
        }

        const unitPriceFC = p.unitPrice;
        const exRate = snapRates[p.currency] || 1;
        const dutyRate = item.dutyRate || 0;

        // 가치비례 배분
        const allocatedFC_Value_Total = unitPriceFC * allocationRatio;
        const dutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableAncillaryKrw / totalInvoiceKrw) : 0;
        const allocatedFC_Value_Dutiable = unitPriceFC * dutiableAllocationRatio;

        const baseCostFC_Value = unitPriceFC + allocatedFC_Value_Total;
        const baseCostKrw_Value = baseCostFC_Value * exRate;

        // 관세 산출
        const cifValueKrw_Value = (unitPriceFC + allocatedFC_Value_Dutiable) * exRate;
        const dutyKrw_Value = cifValueKrw_Value * (dutyRate / 100);

        const realCostKrw_Value = baseCostKrw_Value + dutyKrw_Value;

        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Value_Total, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Value, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Value)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Value)}</td>
            </tr>
        `;

        // 체적/운임톤 배분
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
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Volume)}</td>
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
