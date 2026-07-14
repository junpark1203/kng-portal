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

    // 송금 환율 입력
    ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
        document.getElementById(`paidRate${curr}`).addEventListener('input', e => {
            state.doc.paidRates[curr] = parseFloat(e.target.value) || 0;
            calculateAll();
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
            costs: forwarder.costs.filter(c => c.applyTo[term] === true)
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
            label: c.label,
            unit: c.unit,
            currency: c.currency,
            quotedForeign: quotedTotalForeign,
            billedForeign: quotedTotalForeign, // 초기값은 견적과 동일하게 셋팅
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
    
    // 견적 환율 (읽기 전용)
    const qRates = snap.exchangeRates || {};
    ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
        document.getElementById(`roRate${curr}`).innerText = formatNum(qRates[curr] || 0, 2);
    });
    
    // 실제 송금 환율
    ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
        document.getElementById(`paidRate${curr}`).value = (doc.paidRates[curr] || 0).toFixed(2);
    });

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
function renderSettlementGrid() {
    const tbody = document.getElementById('settlementTableBody');
    let html = '';
    
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};

    state.doc.actualCosts.forEach((cost, idx) => {
        // 견적 환율 적용하여 예상 원화 계산 (초기 렌더링용, 실제 계산은 calculateAll에서 수행하지만 뷰를 위해)
        let qRate = cost.currency === 'KRW' ? 1 : (snapRates[cost.currency] || 0);
        let qKrw = cost.quotedForeign * qRate;

        let labelHtml = cost.label;
        if (cost.isCustom) {
            labelHtml = `<input type="text" class="calc-input" value="${cost.label}" style="width:120px; padding:4px;" oninput="updateCost(${idx}, 'label', this.value)">`;
        }

        let currHtml = '';
        if (cost.isCustom) {
            currHtml = `
                <select class="calc-input" style="padding:6px; min-width:60px;" onchange="updateCost(${idx}, 'currency', this.value)">
                    <option value="KRW" ${cost.currency==='KRW'?'selected':''}>KRW</option>
                    <option value="USD" ${cost.currency==='USD'?'selected':''}>USD</option>
                    <option value="CNY" ${cost.currency==='CNY'?'selected':''}>CNY</option>
                    <option value="EUR" ${cost.currency==='EUR'?'selected':''}>EUR</option>
                    <option value="JPY" ${cost.currency==='JPY'?'selected':''}>JPY</option>
                </select>
            `;
        }

        html += `
            <tr class="draggable-row" draggable="true" data-idx="${idx}"
                ondragstart="handleDragStart(event)"
                ondragover="handleDragOver(event)"
                ondragenter="handleDragEnter(event)"
                ondragleave="handleDragLeave(event)"
                ondrop="handleDrop(event, ${idx})"
                ondragend="handleDragEnd(event)">
                <td class="col-readonly">
                    <div style="display:flex; align-items:center; gap:5px;">
                        <i class='bx bx-grid-vertical drag-handle' title="드래그하여 순서 변경"></i>
                        ${cost.isCustom ? `<button class="btn-icon" style="color:var(--danger-color); padding:0; display:flex; align-items:center;" onclick="removeCost(${idx})"><i class='bx bx-trash'></i></button>` : ''}
                        ${labelHtml}
                    </div>
                </td>
                <td class="col-readonly" style="text-align:center;">${cost.unit}</td>
                
                <!-- 예상 (읽기 전용) -->
                <td class="col-num col-readonly">${formatNum(cost.quotedForeign, 2)} ${cost.isCustom ? '-' : cost.currency}</td>
                <td class="col-num col-readonly">${formatNum(qRate, 2)}</td>
                <td class="col-num col-readonly" style="font-weight:600;">${formatNum(qKrw)}</td>
                
                <!-- 실제 (입력) -->
                <td>
                    <div style="display:flex; align-items:center; gap:5px; position:relative;">
                        ${cost.isCustom ? currHtml : `<span style="position:absolute; left:10px; color:var(--text-secondary); font-weight:500; font-size:0.8em; pointer-events:none;">${cost.currency}</span>`}
                        <input type="number" class="calc-input billed-foreign" step="0.01" value="${cost.billedForeign}" oninput="updateCost(${idx}, 'billedForeign', this.value)" style="width:100%; border:1px solid var(--border-color); border-radius:4px; text-align:right; font-weight:600; padding: 6px 6px 6px ${cost.isCustom ? '6px' : '35px'};">
                    </div>
                </td>
                <td>
                    <input type="number" class="calc-input billed-rate" step="0.01" value="${cost.billedRate}" ${cost.currency === 'KRW' ? 'readonly style="background:#f1f5f9;"' : ''} oninput="updateCost(${idx}, 'billedRate', this.value)">
                </td>
                <td class="col-num" style="font-weight:600; background:#f8fafc;" id="krw_${idx}">0</td>
                
                <!-- 분석 -->
                <td class="col-num val-variance" id="var_${idx}">0</td>
                <td class="col-num val-gainloss" id="gl_${idx}">0</td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

window.updateCost = function(idx, field, value) {
    if (field === 'billedForeign' || field === 'billedRate') {
        state.doc.actualCosts[idx][field] = parseFloat(value) || 0;
    } else {
        state.doc.actualCosts[idx][field] = value;
        if (field === 'currency') {
            if (value === 'KRW') {
                state.doc.actualCosts[idx].billedRate = 1;
            } else {
                const snapRates = state.doc.quotationSnapshot.exchangeRates || {};
                const paidRates = state.doc.paidRates || {};
                state.doc.actualCosts[idx].billedRate = paidRates[value] || snapRates[value] || 0;
            }
            renderSettlementGrid();
        }
    }
    calculateAll();
};

window.addCustomCost = function() {
    state.doc.actualCosts.push({
        id: generateId(),
        key: 'CUSTOM_' + Date.now(),
        label: '추가 청구 항목',
        unit: 'Lump Sum',
        currency: 'KRW',
        quotedForeign: 0,
        billedForeign: 0,
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
    let totalPaidKrw = 0;
    
    const snapRates = state.doc.quotationSnapshot.exchangeRates || {};
    const paidRates = state.doc.paidRates || {};

    state.doc.actualCosts.forEach((cost, idx) => {
        const isKrw = cost.currency === 'KRW';
        
        // 1. 견적 예상 원화
        let qRate = isKrw ? 1 : (snapRates[cost.currency] || 0);
        let qKrw = cost.quotedForeign * qRate;
        totalEstKrw += qKrw;
        
        // 2. 인보이스 실제 원화
        let bRate = isKrw ? 1 : cost.billedRate;
        let bKrw = cost.billedForeign * bRate;
        totalBilledKrw += bKrw;
        
        // 3. 실제 송금 원화 (송금 환율 적용)
        let pRate = isKrw ? 1 : (paidRates[cost.currency] || bRate); // 송금 환율이 0이면 인보이스 환율 기준
        if (pRate === 0 && !isKrw) pRate = bRate; 
        let pKrw = cost.billedForeign * pRate;
        totalPaidKrw += pKrw;
        
        // 4. 분석: 물류비 증감액 (Cost Variance) = 청구 원화 - 예상 원화
        let variance = bKrw - qKrw;
        
        // 5. 분석: 환차익/손 (Gain/Loss) = (송금 환율 - 인보이스 환율) * 외화 금액
        // (내가 지불한 원화 - 청구된 원화) = pKrw - bKrw 
        // 양수면 손실(더 냄), 음수면 이익(덜 냄). 일반적으로 이익을 양수로 표현하므로:
        let gainLoss = bKrw - pKrw; 

        // UI 업데이트
        const krwEl = document.getElementById(`krw_${idx}`);
        const varEl = document.getElementById(`var_${idx}`);
        const glEl = document.getElementById(`gl_${idx}`);
        
        if (krwEl) krwEl.innerText = formatNum(bKrw);
        
        if (varEl) {
            varEl.innerText = variance > 0 ? '+' + formatNum(variance) : formatNum(variance);
            varEl.className = 'col-num val-variance ' + (variance > 0 ? 'positive' : (variance < 0 ? 'negative' : ''));
        }
        
        if (glEl) {
            glEl.innerText = gainLoss > 0 ? '+' + formatNum(gainLoss) : formatNum(gainLoss);
            glEl.className = 'col-num val-gainloss ' + (gainLoss > 0 ? 'gain' : (gainLoss < 0 ? 'loss' : ''));
        }
    });
    
    // 대시보드 업데이트
    const totalVariance = totalBilledKrw - totalEstKrw;
    const totalGainLoss = totalBilledKrw - totalPaidKrw; // 양수: 이익(환율 내림), 음수: 손실(환율 오름)
    
    document.getElementById('dashTotalEstimated').innerText = '₩ ' + formatNum(totalEstKrw);
    document.getElementById('dashTotalBilled').innerText = '₩ ' + formatNum(totalBilledKrw);
    document.getElementById('dashTotalPaid').innerText = '₩ ' + formatNum(totalPaidKrw);
    
    const dashVar = document.getElementById('dashCostVariance');
    dashVar.innerText = totalVariance > 0 ? '+ ₩ ' + formatNum(totalVariance) : '₩ ' + formatNum(totalVariance);
    dashVar.style.color = totalVariance > 0 ? '#dc2626' : (totalVariance < 0 ? '#16a34a' : '#0f172a');
    
    const dashGl = document.getElementById('dashExchangeGainLoss');
    dashGl.innerText = totalGainLoss > 0 ? '+ ₩ ' + formatNum(totalGainLoss) : '₩ ' + formatNum(totalGainLoss);
    dashGl.style.color = totalGainLoss > 0 ? '#a7f3d0' : (totalGainLoss < 0 ? '#fecaca' : '#fff'); // Primary BG 위에 표시되므로 밝은 톤
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
