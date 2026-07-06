// forwarder-quotation.js

// ─────────────────────────────────────────────────────────────
// 상태 관리 (State)
// ─────────────────────────────────────────────────────────────
let state = {
    view: 'list', // 'list' | 'edit'
    list: [],
    rates: { USD: 1380, CNY: 190, EUR: 1500, JPY: 9.5 },
    doc: {
        id: '',
        title: '',
        quoteDate: '',
        status: 'draft',
        shipmentType: 'FCL',
        dimUnit: 'cm',
        containerType: '20ft',
        containerQty: 1,
        pol: '',
        pod: '',
        exchangeRates: {},
        incoterms: ['EXW', 'FOB'],
        items: [],
        forwarders: [],
        otherCosts: [
            { id: 'interest', name: '금융비용(이자비용)', type: 'calculated', durationMonths: 2, interestRate: 4.0, collectionDays: 60, amount: 0 }
        ],
        remarks: ''
    },
    activeForwarderIdx: 0
};

// ─────────────────────────────────────────────────────────────
// 유틸리티 및 상수
// ─────────────────────────────────────────────────────────────
const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';
const API_BASE = '/api/forwarder-quotation';
const RATE_API = '/api/exchange-rates';

async function getToken() {
    try {
        if (window.parent && typeof window.parent.getAuthToken === 'function') {
            let token = await window.parent.getAuthToken();
            let retries = 0;
            // 부모 창의 Firebase 초기화가 늦어질 경우를 대비해 최대 5초 대기
            while (!token && retries < 10) {
                await new Promise(r => setTimeout(r, 500));
                token = await window.parent.getAuthToken();
                retries++;
            }
            return token || '';
        }
    } catch(e) {
        console.warn('Failed to get token from parent:', e);
    }
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

// 기본 부대비용 템플릿
const DEFAULT_COSTS = [
    { key: 'OF', label: '해상운임 (O/F, Ocean Freight)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'PSS', label: '성수기 할증료 (P.S.S)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'LSS', label: '저유황유 할증료 (L.S.S)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'CY', label: 'CY비 (CY Charge)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'PORT', label: '항만비용 (Port Charge)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'EDI', label: 'EDI/서류/부킹 (EDI+Doc+Sur+Bkg)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'THC_E', label: '터미널하역비 수출 (THC E)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'VGM', label: '총중량검증비 (VGM)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'CUST_E', label: '수출통관비 (Customs E)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'TRK_E', label: '내륙운송 수출 (Trucking E)', defaultUnit: 'Lump Sum', applyTo: { EXW: true, FOB: false, CIF: false } },
    
    { key: 'BAF', label: '유류할증료 (B.A.F)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CAF', label: '통화조정할증료 (C.A.F)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CRS', label: '컨테이너회송료 (C.R.S)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'HNDL', label: '취급수수료 (Handling Charge)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DO', label: '화물인도지시서 (D/O)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'THC_I', label: '터미널하역비 수입 (THC I)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'WHFG', label: '부두사용료 (Wharfage)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TSF', label: '터미널보안료 (TSF)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'PSMF', label: '항만안전관리비 (PSMF)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CCC', label: '컨테이너세정비 (CCC)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DOC', label: '서류대행비 (DOC)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'STRIP', label: '컨테이너적출료 (Stripping)', defaultUnit: 'per Container', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TRK_I', label: '내륙운송 수입 (Trucking I)', defaultUnit: 'Lump Sum', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CUST_I', label: '통관수수료 (Customs I)', defaultUnit: 'per B/L', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'INS', label: '적하보험료 (Cargo Ins)', defaultUnit: 'Lump Sum', applyTo: { EXW: true, FOB: true, CIF: false } }
];

const UNIT_OPTIONS = ['Lump Sum', 'per Container', 'per B/L', 'per CBM', 'per R/T', 'per TON', 'per Unit'];

// ─────────────────────────────────────────────────────────────
// 초기화 및 이벤트 바인딩
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadRates();
    loadList();
});

function initEvents() {
    // 뷰 전환
    document.getElementById('btnNewQuote').addEventListener('click', openNewQuote);
    document.getElementById('btnCancelEdit').addEventListener('click', closeEdit);
    document.getElementById('btnCancelEditBottom').addEventListener('click', closeEdit);
    
    // 저장
    document.getElementById('btnSaveQuote').addEventListener('click', saveQuote);
    document.getElementById('btnSaveQuoteBottom').addEventListener('click', saveQuote);
    document.getElementById('btnSaveCopy').addEventListener('click', saveAsCopy);
    document.getElementById('btnSaveCopyBottom').addEventListener('click', saveAsCopy);
    
    // 인쇄 및 엑셀
    document.getElementById('btnPrint').addEventListener('click', () => window.print());
    document.getElementById('btnExportExcel').addEventListener('click', exportToExcel);
    
    // 목록 액션
    document.getElementById('selectAll').addEventListener('change', e => {
        document.querySelectorAll('.row-chk').forEach(cb => cb.checked = e.target.checked);
    });
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
    
    // 환율 로드
    document.getElementById('btnReloadRates').addEventListener('click', loadRates);
    
    // 환율 입력 이벤트
    ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
        document.getElementById(`rate${curr}`).addEventListener('input', e => {
            state.doc.exchangeRates[curr] = parseFloat(e.target.value) || 0;
            renderAllCalculations();
        });
    });

    // 선적 형태 및 치수 단위 이벤트
    document.querySelectorAll('input[name="docShipmentType"]').forEach(el => {
        el.addEventListener('change', e => {
            state.doc.shipmentType = e.target.value;
            // UI Toggle
            document.querySelectorAll('.fcl-only').forEach(el => el.style.display = state.doc.shipmentType === 'FCL' ? '' : 'none');
            const dimUnitWrapper = document.getElementById('dimUnitWrapper');
            if(dimUnitWrapper) dimUnitWrapper.style.display = state.doc.shipmentType === 'LCL' ? 'flex' : 'none';
            updateDefaultCostQuantities();
            renderItems();
            renderForwarderContent();
        });
    });

    const dimUnitEl = document.getElementById('docDimUnit');
    if(dimUnitEl) {
        dimUnitEl.addEventListener('change', e => {
            state.doc.dimUnit = e.target.value;
            renderItems(); // re-render headers and re-calc
        });
    }

    // 기본정보 입력 이벤트
    ['docTitle', 'docDate', 'docStatus', 'docContainerType', 'docContainerQty', 'docRemarks', 'docPol', 'docPod'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => {
            let key = id.replace('doc', '');
            key = key.charAt(0).toLowerCase() + key.slice(1);
            if (id === 'docContainerQty') state.doc[key] = parseInt(e.target.value) || 1;
            else state.doc[key] = e.target.value;
            
            if (id === 'docContainerQty') {
                updateDefaultCostQuantities();
                renderForwarderContent();
                renderAllCalculations();
            }
        });
    });

    // 인코텀즈 관리
    document.getElementById('btnAddIncoterm').addEventListener('click', () => {
        let term = prompt('추가할 인코텀즈를 입력하세요 (예: CIF, CFR, FOB CNY):');
        if (!term) return;
        term = term.toUpperCase().trim();
        
        let finalTerm = term;
        let count = 1;
        while (state.doc.incoterms.includes(finalTerm)) {
            count++;
            finalTerm = `${term} (${count})`;
        }
        
        if (state.doc.incoterms.length >= 5) return showToast('인코텀즈는 최대 5개까지만 추가할 수 있습니다.', true);
        state.doc.incoterms.push(finalTerm);
        
        let baseTerm = finalTerm;
        if (finalTerm.startsWith('EXW')) baseTerm = 'EXW';
        else if (finalTerm.startsWith('FOB')) baseTerm = 'FOB';
        else if (finalTerm.startsWith('CIF') || finalTerm.startsWith('CFR')) baseTerm = 'CIF';
        
        // 기존 포워더들에 새 인코텀즈 기본값 복사하여 추가
        state.doc.forwarders.forEach(fw => {
            fw.costs.forEach(c => {
                const defaultCost = DEFAULT_COSTS.find(dc => dc.key === c.key);
                c.applyTo[finalTerm] = defaultCost ? (defaultCost.applyTo[baseTerm] || false) : false;
            });
        });
        renderIncoterms();
        renderItems();
        renderForwarderContent();
    });

    // 품목 추가
    document.getElementById('btnAddItem').addEventListener('click', () => {
        const prices = {};
        state.doc.incoterms.forEach(term => prices[term] = { unitPrice: 0, currency: 'USD' });
        state.doc.items.push({ hsCode: '', name: '', qty: 1, unit: 'EA', ctn: 1, weight: 0, maxLoad: 0, l: 0, w: 0, h: 0, pkgWeight: 0, dutyRate: 0, cbm: 0, rt: 0, prices });
        updateDefaultCostQuantities();
        renderItems();
        renderForwarderContent();
    });

    // 포워더 추가 모달
    document.getElementById('btnAddForwarder').addEventListener('click', () => {
        state.editingForwarderIdx = null;
        document.getElementById('fwModalTitle').innerText = '포워더 추가';
        document.getElementById('fwNameInput').value = '';
        document.getElementById('forwarderModal').classList.add('active');
        document.getElementById('fwNameInput').focus();
    });
    document.getElementById('btnCloseFwModal').addEventListener('click', () => {
        document.getElementById('forwarderModal').classList.remove('active');
    });
    document.getElementById('btnConfirmFw').addEventListener('click', () => {
        const name = document.getElementById('fwNameInput').value.trim();
        if (!name) return showToast('포워더 이름을 입력하세요.', true);
        
        if (state.editingForwarderIdx !== null && state.editingForwarderIdx !== undefined) {
            state.doc.forwarders[state.editingForwarderIdx].name = name;
            state.editingForwarderIdx = null;
            document.getElementById('forwarderModal').classList.remove('active');
            renderForwarderTabs();
            return;
        }
        
        const isLCL = state.doc.shipmentType === 'LCL';
        // 기본 부대비용 생성
        const costs = DEFAULT_COSTS.map(c => {
            const applyTo = {};
            state.doc.incoterms.forEach(term => {
                let baseTerm = term;
                if (term.startsWith('EXW')) baseTerm = 'EXW';
                else if (term.startsWith('FOB')) baseTerm = 'FOB';
                else if (term.startsWith('CIF') || term.startsWith('CFR')) baseTerm = 'CIF';
                applyTo[term] = c.applyTo[baseTerm] || false;
            });
            let unit = c.defaultUnit;
            if (isLCL && unit === 'per Container') {
                unit = 'per R/T';
            }
            let qty = 1;
            if (unit === 'per Container') qty = state.doc.containerQty || 1;
            else if (unit === 'per R/T' || unit === 'per CBM') qty = getTotalRT();
            
            return {
                key: c.key,
                label: c.label,
                amount: 0,
                currency: c.key === 'INS' || c.key.includes('I') || c.key.includes('WHFG') || c.key.includes('TSF') || c.key.includes('PSMF') || c.key.includes('DOC') || c.key.includes('STRIP') ? 'KRW' : 'USD', // 수입국 비용은 대개 원화
                unit: unit,
                unitQty: qty,
                applyTo
            };
        });

        state.doc.forwarders.push({
            id: 'FW-' + Date.now(),
            name: name,
            costs: costs
        });
        
        state.activeForwarderIdx = state.doc.forwarders.length - 1;
        document.getElementById('forwarderModal').classList.remove('active');
        renderForwarderTabs();
        renderForwarderContent();
    });
    
    // 기타 비용 추가
    document.getElementById('btnAddOtherCost').addEventListener('click', () => {
        state.doc.otherCosts = state.doc.otherCosts || [];
        state.doc.otherCosts.push({
            id: 'custom_' + Date.now(),
            name: '추가 비용',
            type: 'manual',
            amount: 0
        });
        renderAllCalculations();
    });

    // 실수입원가 선택
    document.getElementById('costResultSelector')?.addEventListener('change', renderAllCalculations);
}

function getTotalRT() {
    let rt = 0;
    if (state.doc.items) {
        state.doc.items.forEach(item => { rt += (item.rt || 0); });
    }
    return Math.max(rt, 1);
}

function updateDefaultCostQuantities() {
    const isLCL = state.doc.shipmentType === 'LCL';
    const cQty = state.doc.containerQty || 1;
    const totalRt = getTotalRT();
    
    state.doc.forwarders.forEach(fw => {
        fw.costs.forEach(c => {
            if (isLCL && (c.unit === 'per R/T' || c.unit === 'per CBM')) {
                c.unitQty = totalRt;
            } else if (!isLCL && c.unit === 'per Container') {
                c.unitQty = cQty;
            }
        });
    });
}

function switchView(view) {
    document.getElementById('listView').classList.remove('active');
    document.getElementById('editView').classList.remove('active');
    document.getElementById(view + 'View').classList.add('active');
    state.view = view;
}

// ─────────────────────────────────────────────────────────────
// API 통신
// ─────────────────────────────────────────────────────────────
async function loadRates() {
    try {
        const data = await authFetch(RATE_API);
        if (data.USD) {
            state.rates = {
                USD: 1 / data.USD,
                CNY: 1 / data.CNY,
                EUR: 1 / data.EUR,
                JPY: (1 / data.JPY) * 100 // 100엔당
            };
            if (state.view === 'edit') {
                // 수동 입력이 없을 경우에만 덮어쓰기
                ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
                    document.getElementById(`rate${curr}`).value = state.rates[curr].toFixed(2);
                    state.doc.exchangeRates[curr] = state.rates[curr];
                });
                renderAllCalculations();
            }
            showToast('환율을 업데이트했습니다.');
        }
    } catch (err) {
        console.error(err);
    }
}

async function loadList() {
    try {
        state.list = await authFetch(API_BASE);
        renderList();
    } catch (err) {
        showToast(err.message, true);
    }
}

async function saveQuote() {
    if (!state.doc.title) return showToast('견적명을 입력하세요.', true);
    if (!state.doc.quoteDate) return showToast('견적일자를 입력하세요.', true);
    
    // 입력값 동기화
    document.querySelectorAll('.fw-cost-input').forEach(el => {
        el.dispatchEvent(new Event('input')); // 강제 반영
    });

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

async function saveAsCopy() {
    if (!state.doc.title) return showToast('견적명을 입력하세요.', true);
    if (!confirm('현재 내용을 새로운 견적서로 복사하여 저장하시겠습니까?')) return;
    
    // ID를 제거하여 신규 생성(POST)으로 처리되도록 함
    delete state.doc.id;
    state.doc.title = state.doc.title + ' (복사본)';
    document.getElementById('docTitle').value = state.doc.title;
    
    await saveQuote();
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

async function editQuote(id) {
    try {
        const data = await authFetch(`${API_BASE}/${id}`);
        
        // 구버전 호환: '자동계산' 단위가 저장된 경우 'Lump Sum'으로 변환 및 applyTo 초기화
        if (data.forwarders) {
            data.forwarders.forEach(fw => {
                if (fw.costs) {
                    fw.costs.forEach(c => {
                        if (c.unit === '자동계산') c.unit = 'Lump Sum';
                        if (!c.applyTo) {
                            c.applyTo = {};
                            if (data.incoterms) {
                                data.incoterms.forEach(term => c.applyTo[term] = true);
                            }
                        }
                    });
                }
            });
        }
        
        state.doc = data;
        if (!state.doc.shipmentType) state.doc.shipmentType = 'FCL';
        if (!state.doc.dimUnit) state.doc.dimUnit = 'cm';
        if (!state.doc.otherCosts || state.doc.otherCosts.length === 0) {
            state.doc.otherCosts = [
                { id: 'interest', name: '금융비용(이자비용)', type: 'calculated', durationMonths: 2, interestRate: 4.0, collectionDays: 60, amount: 0 }
            ];
        }
        state.activeForwarderIdx = 0;
        
        // 폼 채우기
        document.getElementById('docTitle').value = data.title;
        document.getElementById('docDate').value = data.quoteDate;
        document.getElementById('docStatus').value = data.status;
        
        const shipRadios = document.querySelectorAll('input[name="docShipmentType"]');
        shipRadios.forEach(r => r.checked = (r.value === state.doc.shipmentType));
        document.querySelectorAll('.fcl-only').forEach(el => el.style.display = state.doc.shipmentType === 'FCL' ? '' : 'none');
        const dimUnitWrapper = document.getElementById('dimUnitWrapper');
        if(dimUnitWrapper) dimUnitWrapper.style.display = state.doc.shipmentType === 'LCL' ? 'flex' : 'none';
        
        const dimUnitEl = document.getElementById('docDimUnit');
        if (dimUnitEl) dimUnitEl.value = state.doc.dimUnit;

        document.getElementById('docContainerType').value = data.containerType || '20ft';
        document.getElementById('docContainerQty').value = data.containerQty || 1;
        document.getElementById('docPol').value = data.pol || '';
        document.getElementById('docPod').value = data.pod || '';
        document.getElementById('docRemarks').value = data.remarks || '';
        
        ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
            const val = data.exchangeRates[curr] || state.rates[curr] || 0;
            document.getElementById(`rate${curr}`).value = val.toFixed(2);
            state.doc.exchangeRates[curr] = val;
        });

        document.getElementById('editTitle').innerHTML = `<i class='bx bx-edit-alt'></i> 견적 수정`;
        document.getElementById('btnSaveCopy').style.display = 'inline-block';
        document.getElementById('btnSaveCopyBottom').style.display = 'inline-block';
        
        renderIncoterms();
        renderItems();
        renderForwarderTabs();
        renderForwarderContent();
        
        switchView('edit');
    } catch (err) {
        showToast(err.message, true);
    }
}

function openNewQuote() {
    state.doc = {
        id: '',
        title: '',
        quoteDate: new Date().toISOString().split('T')[0],
        status: 'draft',
        shipmentType: 'FCL',
        dimUnit: 'cm',
        containerType: '20ft',
        containerQty: 1,
        pol: '',
        pod: '',
        exchangeRates: { ...state.rates },
        incoterms: ['EXW', 'FOB'],
        items: [],
        forwarders: [],
        otherCosts: [
            { id: 'interest', name: '금융비용(이자비용)', type: 'calculated', durationMonths: 2, interestRate: 4.0, collectionDays: 60, amount: 0 }
        ],
        remarks: ''
    };
    state.activeForwarderIdx = 0;
    
    document.getElementById('docTitle').value = '';
    document.getElementById('docDate').value = state.doc.quoteDate;
    document.getElementById('docStatus').value = 'draft';
    
    document.querySelectorAll('input[name="docShipmentType"]').forEach(r => r.checked = (r.value === 'FCL'));
    document.querySelectorAll('.fcl-only').forEach(el => el.style.display = '');
    const dimUnitWrapper = document.getElementById('dimUnitWrapper');
    if(dimUnitWrapper) dimUnitWrapper.style.display = 'none';
    const dimUnitEl = document.getElementById('docDimUnit');
    if(dimUnitEl) dimUnitEl.value = 'cm';
    
    document.getElementById('docContainerType').value = '20ft';
    document.getElementById('docContainerQty').value = '1';
    document.getElementById('docPol').value = '';
    document.getElementById('docPod').value = '';
    document.getElementById('docRemarks').value = '';
    
    ['USD', 'CNY', 'EUR', 'JPY'].forEach(curr => {
        document.getElementById(`rate${curr}`).value = state.rates[curr].toFixed(2);
    });

    document.getElementById('editTitle').innerHTML = `<i class='bx bx-file-blank'></i> 신규 견적`;
    document.getElementById('btnSaveCopy').style.display = 'none';
    document.getElementById('btnSaveCopyBottom').style.display = 'none';
    
    renderIncoterms();
    renderItems();
    renderForwarderTabs();
    renderForwarderContent();
    
    switchView('edit');
}

function closeEdit() {
    switchView('list');
}

// ─────────────────────────────────────────────────────────────
// 렌더링 (List)
// ─────────────────────────────────────────────────────────────
function renderList() {
    const tbody = document.getElementById('quoteListBody');
    if (state.list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem;">저장된 견적이 없습니다.</td></tr>';
        return;
    }
    
    let html = '';
    state.list.forEach(item => {
        const statusMap = { 'draft': '초안', 'confirmed': '확정', 'expired': '만료' };
        html += `
            <tr style="cursor: pointer" onclick="window.editQuote('${item.id}')">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-chk" value="${item.id}"></td>
                <td><span class="status-badge ${item.status}">${statusMap[item.status] || item.status}</span></td>
                <td style="font-weight: 500;">${item.title}</td>
                <td>${item.quoteDate}</td>
                <td>${(item.forwarders || []).length} 곳</td>
                <td>${item.containerType} × ${item.containerQty}</td>
                <td>${item.createdAt.split('T')[0]}</td>
                <td class="col-action">
                    <button class="btn-icon" onclick="event.stopPropagation(); window.editQuote('${item.id}')"><i class='bx bx-edit'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

// ─────────────────────────────────────────────────────────────
// 렌더링 (Edit - Incoterms & Items)
// ─────────────────────────────────────────────────────────────
function renderIncoterms() {
    const container = document.getElementById('incotermsChips');
    let html = '';
    state.doc.incoterms.forEach((term, idx) => {
        html += `
            <div class="incoterm-chip active">
                ${term}
                ${state.doc.incoterms.length > 1 ? `<button class="btn-remove" onclick="removeIncoterm('${term}')"><i class='bx bx-x'></i></button>` : ''}
            </div>
        `;
    });
    container.innerHTML = html;
}

window.removeIncoterm = function(term) {
    if (state.doc.incoterms.length <= 1) return showToast('최소 1개의 인코텀즈는 필요합니다.', true);
    if (!confirm(`'${term}' 항목을 삭제하시겠습니까? 관련된 단가 및 비용 설정이 모두 지워집니다.`)) return;
    
    state.doc.incoterms = state.doc.incoterms.filter(t => t !== term);
    
    // 품목 단가 제거
    state.doc.items.forEach(item => {
        if (item.prices[term]) delete item.prices[term];
    });
    
    // 포워더 적용 체크 제거
    state.doc.forwarders.forEach(fw => {
        fw.costs.forEach(c => {
            if (c.applyTo[term] !== undefined) delete c.applyTo[term];
        });
    });
    
    renderIncoterms();
    renderItems();
    renderForwarderContent();
};

function renderItems() {
    const isLCL = state.doc.shipmentType === 'LCL';
    // 헤더 재생성
    const thead = document.getElementById('itemTableHead');
    let thHtml = `
        <th>HS CODE</th>
        <th>품명</th>
        <th class="col-num" style="width: 80px;">수량</th>
        <th style="width: 80px;">단위</th>
    `;
    
    if (isLCL) {
        const u = state.doc.dimUnit || 'cm';
        thHtml += `
            <th class="col-num" style="width: 80px;">총 박스수<br><span style="font-size:10px;">(CTN)</span></th>
            <th style="width: 140px;">박스 치수 (L x W x H)<br><span style="font-size:10px;">(${u})</span></th>
            <th class="col-num" style="width: 80px;">단위 중량<br><span style="font-size:10px;">(kg/개)</span></th>
            <th class="col-num" style="width: 80px;">총 중량<br><span style="font-size:10px;">(kg)</span></th>
            <th class="col-num" style="width: 80px;">CBM<br><span style="font-size:10px;">(자동계산)</span></th>
            <th class="col-num" style="width: 80px;">R/T<br><span style="font-size:10px;">(운임톤)</span></th>
        `;
    } else {
        thHtml += `
            <th class="col-num" style="width: 100px;">총중량(kg)</th>
            <th class="col-num" style="width: 110px;">최대적재량<br><span style="font-weight:normal;font-size:10px;">(Max/CNTR)</span></th>
        `;
    }
    
    thHtml += `<th class="col-num" style="width: 70px;">관세율<br><span style="font-size:10px;">(%)</span></th>`;

    state.doc.incoterms.forEach(term => {
        thHtml += `<th class="col-num" style="width: 150px;">${term} 단가</th>`;
    });
    thHtml += `<th class="col-action">삭제</th>`;
    thead.innerHTML = thHtml;

    // 바디 재생성
    const tbody = document.getElementById('itemTableBody');
    if (state.doc.items.length === 0) {
        let colSpan = isLCL ? (9 + 1 + state.doc.incoterms.length) : (6 + 1 + state.doc.incoterms.length);
        tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;">등록된 품목이 없습니다.</td></tr>`;
        renderItemFooter();
        renderAllCalculations();
        return;
    }

    let bHtml = '';
    state.doc.items.forEach((item, idx) => {
        const cbm = item.cbm || 0;
        const rt = item.rt || 0;

        bHtml += `
            <tr>
                <td><input type="text" value="${item.hsCode}" onchange="updateItem(${idx}, 'hsCode', this.value)"></td>
                <td><input type="text" value="${item.name}" onchange="updateItem(${idx}, 'name', this.value)"></td>
                <td><input type="number" value="${item.qty}" min="1" class="col-num" oninput="updateItem(${idx}, 'qty', this.value)"></td>
                <td><input type="text" value="${item.unit}" onchange="updateItem(${idx}, 'unit', this.value)"></td>
        `;
        
        if (isLCL) {
            bHtml += `
                <td><input type="number" value="${item.ctn||1}" min="1" class="col-num" oninput="updateItem(${idx}, 'ctn', this.value)"></td>
                <td>
                    <div style="display:flex; gap:2px;">
                        <input type="number" value="${item.l||0}" style="width:33%; padding:0 2px;" placeholder="L" oninput="updateItem(${idx}, 'l', this.value)">
                        <input type="number" value="${item.w||0}" style="width:33%; padding:0 2px;" placeholder="W" oninput="updateItem(${idx}, 'w', this.value)">
                        <input type="number" value="${item.h||0}" style="width:33%; padding:0 2px;" placeholder="H" oninput="updateItem(${idx}, 'h', this.value)">
                    </div>
                </td>
                <td><input type="number" value="${item.pkgWeight||0}" min="0" class="col-num" oninput="updateItem(${idx}, 'pkgWeight', this.value)"></td>
                <td class="col-num" style="background:#f9f9f9;" id="item-weight-${idx}">${formatNum(item.weight||0, 2)}</td>
                <td class="col-num" style="background:#f9f9f9;" id="item-cbm-${idx}">${formatNum(cbm, 3)}</td>
                <td class="col-num" style="background:#eef2ff; font-weight:600;" id="item-rt-${idx}">${formatNum(rt, 3)}</td>
            `;
        } else {
            bHtml += `
                <td><input type="number" value="${item.weight}" min="0" class="col-num" oninput="updateItem(${idx}, 'weight', this.value)"></td>
                <td><input type="number" value="${item.maxLoad || 0}" min="0" class="col-num" oninput="updateItem(${idx}, 'maxLoad', this.value)"></td>
            `;
        }
        
        bHtml += `<td><input type="number" value="${item.dutyRate||0}" min="0" max="100" class="col-num" oninput="updateItem(${idx}, 'dutyRate', this.value)"></td>`;

        state.doc.incoterms.forEach(term => {
            const p = item.prices[term] || { unitPrice: 0, currency: 'USD' };
            bHtml += `
                <td>
                    <div style="display:flex; gap:4px;">
                        <select onchange="updateItemPrice(${idx}, '${term}', 'currency', this.value)" style="width: 60px;">
                            <option value="USD" ${p.currency==='USD'?'selected':''}>USD</option>
                            <option value="CNY" ${p.currency==='CNY'?'selected':''}>CNY</option>
                            <option value="EUR" ${p.currency==='EUR'?'selected':''}>EUR</option>
                            <option value="JPY" ${p.currency==='JPY'?'selected':''}>JPY</option>
                            <option value="KRW" ${p.currency==='KRW'?'selected':''}>KRW</option>
                        </select>
                        <input type="number" value="${p.unitPrice}" min="0" class="col-num" style="flex:1" oninput="updateItemPrice(${idx}, '${term}', 'unitPrice', this.value)">
                    </div>
                </td>
            `;
        });
        
        bHtml += `
                <td class="col-action">
                    <button class="btn-icon" style="color:var(--danger-color)" onclick="removeItem(${idx})"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = bHtml;
    
    renderItemFooter();
    renderAllCalculations();
}

window.updateItem = function(idx, field, val) {
    const item = state.doc.items[idx];
    if (['qty', 'ctn', 'weight', 'maxLoad', 'l', 'w', 'h', 'pkgWeight', 'dutyRate'].includes(field)) {
        item[field] = parseFloat(val) || 0;
    } else {
        item[field] = val;
    }
    
    if (state.doc.shipmentType === 'LCL') {
        const qty = item.qty || 0;
        const ctn = item.ctn || 1;
        let cbmFactor = 1000000;
        if (state.doc.dimUnit === 'mm') cbmFactor = 1000000000;
        else if (state.doc.dimUnit === 'm') cbmFactor = 1;
        
        item.cbm = ((item.l || 0) * (item.w || 0) * (item.h || 0) / cbmFactor) * ctn;
        item.weight = (item.pkgWeight || 0) * qty;
        const ton = item.weight / 1000;
        item.rt = Math.max(item.cbm, ton);
        
        const wEl = document.getElementById(`item-weight-${idx}`);
        const cbmEl = document.getElementById(`item-cbm-${idx}`);
        const rtEl = document.getElementById(`item-rt-${idx}`);
        
        if(wEl) wEl.innerText = formatNum(item.weight, 2);
        if(cbmEl) cbmEl.innerText = formatNum(item.cbm, 3);
        if(rtEl) rtEl.innerText = formatNum(item.rt, 3);
    }
    
    updateDefaultCostQuantities();
    
    renderItemFooter();
    renderForwarderContent(); // Re-render forwarder content to reflect new R/T
    renderAllCalculations();
};

window.updateItemPrice = function(idx, term, field, val) {
    if (!state.doc.items[idx].prices[term]) state.doc.items[idx].prices[term] = { unitPrice: 0, currency: 'USD' };
    if (field === 'unitPrice') state.doc.items[idx].prices[term][field] = parseFloat(val) || 0;
    else state.doc.items[idx].prices[term][field] = val;
    renderItemFooter();
    renderAllCalculations();
};

window.removeItem = function(idx) {
    state.doc.items.splice(idx, 1);
    updateDefaultCostQuantities();
    renderItems();
    renderForwarderContent();
};

function renderItemFooter() {
    const isLCL = state.doc.shipmentType === 'LCL';
    const tfoot = document.getElementById('itemTableFoot');
    if (state.doc.items.length === 0) {
        tfoot.innerHTML = '';
        return;
    }
    
    let totalQty = 0;
    let totalCtn = 0;
    let totalWeight = 0;
    let totalCbm = 0;
    let totalRt = 0;
    const totalsByTerm = {};
    state.doc.incoterms.forEach(t => totalsByTerm[t] = { USD: 0, CNY: 0, EUR: 0, JPY: 0, KRW: 0 });
    
    state.doc.items.forEach(item => {
        totalQty += (item.qty || 0);
        totalWeight += (item.weight || 0);
        if(isLCL) {
            totalCtn += (item.ctn || 0);
            totalCbm += (item.cbm || 0);
            totalRt += (item.rt || 0);
        }
        state.doc.incoterms.forEach(term => {
            const p = item.prices[term];
            if (p && p.currency && p.unitPrice) {
                totalsByTerm[term][p.currency] += (p.unitPrice * item.qty);
            }
        });
    });

    let fHtml = `
        <tr style="background:var(--bg-tertiary); font-weight:600;">
            <td colspan="2" style="text-align:center;">합계</td>
            <td class="col-num">${formatNum(totalQty)}</td>
            <td></td>
    `;
    
    if (isLCL) {
        fHtml += `
            <td class="col-num">${formatNum(totalCtn)}</td>
            <td></td>
            <td></td>
            <td class="col-num" id="foot-total-weight">${formatNum(totalWeight, 2)} kg</td>
            <td class="col-num" id="foot-total-cbm">${formatNum(totalCbm, 3)}</td>
            <td class="col-num" id="foot-total-rt">${formatNum(totalRt, 3)}</td>
        `;
    } else {
        fHtml += `
            <td class="col-num">${formatNum(totalWeight)} kg</td>
            <td></td>
        `;
    }
    
    fHtml += `<td></td>`; // Duty Rate column

    state.doc.incoterms.forEach(term => {
        const currs = Object.keys(totalsByTerm[term]).filter(c => totalsByTerm[term][c] > 0);
        let str = currs.map(c => `${c} ${formatNum(totalsByTerm[term][c])}`).join('<br>') || '0';
        fHtml += `<td class="col-num" style="font-size:0.9rem;">${str}</td>`;
    });
    
    fHtml += `<td></td></tr>`;
    tfoot.innerHTML = fHtml;
}


// ─────────────────────────────────────────────────────────────
// 렌더링 (Edit - Forwarders & Costs)
// ─────────────────────────────────────────────────────────────
function renderForwarderTabs() {
    const container = document.getElementById('forwarderTabs');
    // 탭 헤더 제외 초기화 (마지막은 +버튼이므로)
    Array.from(container.children).forEach(child => {
        if (!child.classList.contains('add-tab')) child.remove();
    });
    
    const addBtn = document.getElementById('btnAddForwarder');
    
    state.doc.forwarders.forEach((fw, idx) => {
        const btn = document.createElement('button');
        btn.className = `tab-btn ${idx === state.activeForwarderIdx ? 'active' : ''}`;
        btn.innerHTML = `
            ${fw.name} 
            <i class='bx bx-edit-alt' style="margin-left:4px; font-size:1.1em; color: inherit; opacity: 0.8;" onclick="event.stopPropagation(); editForwarderName(${idx})"></i>
            <i class='bx bx-x' style="margin-left:2px; font-size:1.1em; color: inherit; opacity: 0.8;" onclick="event.stopPropagation(); removeForwarder(${idx})"></i>
        `;
        btn.onclick = () => {
            state.activeForwarderIdx = idx;
            renderForwarderTabs();
            renderForwarderContent();
        };
        container.insertBefore(btn, addBtn);
    });
}

window.editForwarderName = function(idx) {
    state.editingForwarderIdx = idx;
    document.getElementById('fwModalTitle').innerText = '포워더 이름 변경';
    document.getElementById('fwNameInput').value = state.doc.forwarders[idx].name;
    document.getElementById('forwarderModal').classList.add('active');
    document.getElementById('fwNameInput').focus();
};

window.removeForwarder = function(idx) {
    if (!confirm('해당 포워더 견적을 삭제하시겠습니까?')) return;
    state.doc.forwarders.splice(idx, 1);
    if (state.activeForwarderIdx >= state.doc.forwarders.length) {
        state.activeForwarderIdx = Math.max(0, state.doc.forwarders.length - 1);
    }
    renderForwarderTabs();
    renderForwarderContent();
};

function renderForwarderContent() {
    const area = document.getElementById('forwarderContentArea');
    if (state.doc.forwarders.length === 0) {
        area.innerHTML = '<div class="empty-state">포워더를 추가하여 부대비용 견적을 입력하세요.</div>';
        renderAllCalculations();
        return;
    }
    
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    
    let html = `
        <table class="item-table" style="margin-bottom:10px;">
            <thead>
                <tr>
                    <th>비용 항목 (약어 / 한글)</th>
                    <th class="col-num" style="width:120px;">단가</th>
                    <th style="width:80px;">통화</th>
                    <th style="width:120px;">단위</th>
                    <th class="col-num" style="width:80px;">수량</th>
                    <th class="col-num" style="width:120px;">합계</th>
    `;
    state.doc.incoterms.forEach(term => {
        html += `<th class="chk-cell" style="width:60px;">${term}</th>`;
    });
    html += `       <th class="col-action">관리</th>
                </tr>
            </thead>
            <tbody>`;
            
    fw.costs.forEach((c, idx) => {
        const isAuto = false; // 자동계산 기능 완전히 제거됨
        let labelHtml = `<input type="text" value="${c.label}" onchange="updateCost(${idx}, 'label', this.value)" ${isAuto?'readonly':''}>`;
        if (c.key === 'INS') {
            labelHtml = `<div style="display:flex; align-items:center;">
                ${labelHtml}
                <i class='bx bx-question-mark tooltip-icon'><span class="tooltip-text">일반적인 산출 공식:<br>Commercial Invoice 총액 (ex: CIF) × 110% × 0.1%</span></i>
            </div>`;
        }
        
        html += `
            <tr>
                <td>${labelHtml}</td>
                <td><input type="number" class="col-num fw-cost-input" value="${c.amount}" oninput="updateCost(${idx}, 'amount', this.value)" ${isAuto?'readonly':''}></td>
                <td>
                    <select onchange="updateCost(${idx}, 'currency', this.value)" ${isAuto?'disabled':''}>
                        <option value="KRW" ${c.currency==='KRW'?'selected':''}>KRW</option>
                        <option value="USD" ${c.currency==='USD'?'selected':''}>USD</option>
                        <option value="CNY" ${c.currency==='CNY'?'selected':''}>CNY</option>
                        <option value="EUR" ${c.currency==='EUR'?'selected':''}>EUR</option>
                        <option value="JPY" ${c.currency==='JPY'?'selected':''}>JPY</option>
                    </select>
                </td>
                <td>
                    <select onchange="updateCost(${idx}, 'unit', this.value)" ${isAuto?'disabled':''}>
                        ${UNIT_OPTIONS.map(opt => `<option value="${opt}" ${c.unit===opt?'selected':''}>${opt}</option>`).join('')}
                    </select>
                </td>
                <td><input type="number" class="col-num fw-cost-input" value="${c.unitQty}" min="0" step="0.001" oninput="updateCost(${idx}, 'unitQty', this.value)" ${isAuto?'readonly':''} ${((state.doc.shipmentType==='FCL' && c.unit==='per Container') || (state.doc.shipmentType==='LCL' && (c.unit==='per R/T' || c.unit==='per CBM'))) ? 'readonly style="background:#f0f0f0; border-color:#ddd;" title="화물 수량/부피와 연동되어 자동 계산됩니다."' : ''}></td>
                <td class="col-num" style="font-weight:500;" id="fwCostSum_${idx}">${formatNum((c.amount||0)*(c.unitQty||0))}</td>
        `;
        
        state.doc.incoterms.forEach(term => {
            const checked = c.applyTo[term] ? 'checked' : '';
            html += `<td class="chk-cell"><input type="checkbox" ${checked} onchange="updateCostApply(${idx}, '${term}', this.checked)"></td>`;
        });
        
        html += `
                <td class="col-action">
                    ${isAuto ? '' : `<button class="btn-icon" style="color:var(--danger-color)" onclick="removeCost(${idx})"><i class='bx bx-trash'></i></button>`}
                </td>
            </tr>
        `;
    });
    
    html += `</tbody></table>
        <button class="btn-outline btn-small" onclick="addCustomCost()"><i class='bx bx-plus'></i> 커스텀 항목 추가</button>
    `;
    
    area.innerHTML = html;
    calculateAutoCosts(); // 적하보험 등 렌더링 후 자동계산 갱신
    renderAllCalculations();
}

window.updateCost = function(idx, field, val) {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    if (field === 'amount' || field === 'unitQty') {
        fw.costs[idx][field] = parseFloat(val) || 0;
        document.getElementById(`fwCostSum_${idx}`).innerText = formatNum(fw.costs[idx].amount * fw.costs[idx].unitQty);
    } else {
        fw.costs[idx][field] = val;
    }
    renderAllCalculations();
};

window.updateCostApply = function(idx, term, checked) {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    if (!fw.costs[idx].applyTo) fw.costs[idx].applyTo = {};
    fw.costs[idx].applyTo[term] = checked;
    renderAllCalculations();
};

window.removeCost = function(idx) {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    fw.costs.splice(idx, 1);
    renderForwarderContent();
};

window.addCustomCost = function() {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    const applyTo = {};
    state.doc.incoterms.forEach(t => applyTo[t] = true);
    fw.costs.push({
        key: 'CUSTOM_' + Date.now(),
        label: '사용자 추가 항목',
        amount: 0,
        currency: 'KRW',
        unit: 'Lump Sum',
        unitQty: 1,
        applyTo
    });
    renderForwarderContent();
};

// ─────────────────────────────────────────────────────────────
// 자동 계산 (적하보험 등)
// ─────────────────────────────────────────────────────────────
function calculateAutoCosts() {
    // 자동계산 항목이 추가되면 이곳에 로직 구현
}


// ─────────────────────────────────────────────────────────────
// 기타 비용 렌더링
// ─────────────────────────────────────────────────────────────
function renderOtherCosts() {
    const tbody = document.getElementById('otherCostTableBody');
    const tfoot = document.getElementById('otherCostTableFoot');
    if (!tbody) return;
    
    if (!state.doc.otherCosts || state.doc.otherCosts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">추가된 항목이 없습니다.</td></tr>';
        if (tfoot) tfoot.innerHTML = '';
        return;
    }
    
    let html = '';
    
    state.doc.otherCosts.forEach((cost, idx) => {
        let conditionHtml = '';
        let amountHtml = '';
        
        if (cost.type === 'calculated') {
            conditionHtml = `
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap; font-size:0.85rem;">
                    <div>사업기간: <input type="number" style="width:50px; padding:2px;" value="${cost.durationMonths}" oninput="updateOtherCost(${idx}, 'durationMonths', this.value)">개월</div>
                    <div>연이자율: <input type="number" style="width:60px; padding:2px;" value="${cost.interestRate}" step="0.1" oninput="updateOtherCost(${idx}, 'interestRate', this.value)">%</div>
                    <div>대금회수: <input type="number" style="width:60px; padding:2px;" value="${cost.collectionDays}" oninput="updateOtherCost(${idx}, 'collectionDays', this.value)">일</div>
                    <i class='bx bx-help-circle tooltip-icon' style="font-size:1.2rem; cursor:pointer;"><span class="tooltip-text">평균 자금 묶임 기간 산출식:<br>((사업기간+1)/2) + (대금회수/30) 개월</span></i>
                </div>
            `;
            amountHtml = `<div style="text-align:right; color:var(--text-secondary);">(자동 산출)</div>`;
        } else {
            conditionHtml = `<div style="color:var(--text-secondary); font-size:0.85rem;">수동 입력</div>`;
            amountHtml = `<input type="number" class="col-num" value="${cost.amount}" oninput="updateOtherCost(${idx}, 'amount', this.value)" style="width:100%;">`;
        }
        
        html += `
            <tr>
                <td><input type="text" value="${cost.name}" onchange="updateOtherCost(${idx}, 'name', this.value)" ${cost.type==='calculated'?'readonly':''}></td>
                <td><span class="status-badge ${cost.type==='calculated'?'confirmed':'draft'}">${cost.type==='calculated'?'자동계산':'수동입력'}</span></td>
                <td>${conditionHtml}</td>
                <td>${amountHtml}</td>
                <td class="col-action">
                    ${cost.type === 'manual' ? `<button class="btn-remove" onclick="removeOtherCost(${idx})"><i class='bx bx-x'></i></button>` : ''}
                </td>
            </tr>
        `;
    });
    
    tbody.innerHTML = html;
}

window.updateOtherCost = function(idx, key, val) {
    if (key === 'name') {
        state.doc.otherCosts[idx][key] = val;
    } else {
        state.doc.otherCosts[idx][key] = parseFloat(val) || 0;
    }
    renderAllCalculations();
};

window.removeOtherCost = function(idx) {
    state.doc.otherCosts.splice(idx, 1);
    renderAllCalculations();
};

// ─────────────────────────────────────────────────────────────
// 전체 요약 계산 (Summary) & 원가 산출
// ─────────────────────────────────────────────────────────────
function renderAllCalculations() {
    renderOtherCosts();
    renderSummaryTable();
    populateCostResultSelector();
    renderCostResultTable();
    generatePrintAndExcelHTML();
}

function renderSummaryTable() {
    const thead = document.querySelector('#summaryTable thead');
    const tbody = document.querySelector('#summaryTable tbody');
    
    if (state.doc.forwarders.length === 0 || state.doc.items.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td style="text-align:center; padding:20px;">비용 요약을 계산할 데이터가 부족합니다.</td></tr>';
        return;
    }

    // 1. 헤더 (포워더 × 인코텀즈)
    let hHtml = '<tr><th>비용 구분</th>';
    state.doc.forwarders.forEach(fw => {
        state.doc.incoterms.forEach(term => {
            hHtml += `<th>${fw.name}<br><span style="font-size:0.85rem; color:var(--text-secondary)">${term}</span></th>`;
        });
    });
    hHtml += '</tr>';
    thead.innerHTML = hHtml;

    // 2. 인보이스 총액 계산 (인코텀즈별) - 통화별로 보여주기 복잡하므로, 대표적으로 KRW 환산 금액 사용 + 외화 대표 표시?
    // 깔끔하게 원화(KRW) 기준으로 통일하되 툴팁으로 표시.
    const getInvoiceSumKrw = (term) => {
        let sum = 0;
        state.doc.items.forEach(item => {
            const p = item.prices[term];
            if (p && p.currency && p.unitPrice) {
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                sum += (p.unitPrice * item.qty * exRate);
            }
        });
        return sum;
    };

    // 3. 부대비용 그룹화
    // 그룹: 해상운임(OF), 수출국(THC_E 등), 수입국(THC_I 등), 적하보험(INS), 통관수수료(CUST_I)
    
    let rows = {
        invoice: { label: '물품 대금 (KRW 환산)', values: [] },
        ocean: { label: '해상 운임 (O/F)', values: [] },
        export: { label: '수출국 부대비용', values: [] },
        import: { label: '수입국 부대비용', values: [] },
        ins: { label: '적하보험료', values: [] },
        customs: { label: '수입 통관수수료', values: [] },
        subtotal: { label: '포워더 부대비용 소계 (KRW)', values: [], isTotal: true },
        interestCost: { label: '금융비용 (이자비용)', values: [] },
        manualOther: { label: '기타 추가 부대비용 (수동)', values: [] },
        grandtotal: { label: '총 비용 (물품+포워더+기타) KRW', values: [], isGrand: true }
    };

    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            // 인보이스
            const invKrw = getInvoiceSumKrw(term);
            rows.invoice.values.push(invKrw);

            let oceanKrw = 0;
            let exportKrw = 0;
            let importKrw = 0;
            let insKrw = 0;
            let customsKrw = 0;

            fw.costs.forEach(c => {
                if (c.applyTo[term]) {
                    const amtKrw = (c.amount || 0) * (c.unitQty || 0) * (state.doc.exchangeRates[c.currency] || 1);
                    
                    if (c.key === 'OF') oceanKrw += amtKrw;
                    else if (c.key === 'INS') insKrw += amtKrw;
                    else if (c.key === 'CUST_I') customsKrw += amtKrw;
                    else if (c.key.endsWith('_E') || ['PSS', 'LSS', 'CY', 'PORT', 'EDI', 'VGM'].includes(c.key)) exportKrw += amtKrw;
                    else importKrw += amtKrw; // 나머지 모두 수입국 (커스텀 포함)
                }
            });

            rows.ocean.values.push(oceanKrw);
            rows.export.values.push(exportKrw);
            rows.import.values.push(importKrw);
            rows.ins.values.push(insKrw);
            rows.customs.values.push(customsKrw);
            
            const sub = oceanKrw + exportKrw + importKrw + insKrw + customsKrw;
            rows.subtotal.values.push(sub);
            
            // 기타 금융 및 추가비용 계산
            let manualOtherCosts = 0;
            let interestCost = 0;
            if (state.doc.otherCosts) {
                state.doc.otherCosts.forEach(oc => {
                    if (oc.type === 'manual') manualOtherCosts += (oc.amount || 0);
                    else if (oc.type === 'calculated' && oc.id === 'interest') {
                        const duration = oc.durationMonths || 0;
                        const colDays = oc.collectionDays || 0;
                        const rate = oc.interestRate || 0;
                        const avgMonths = ((duration + 1) / 2) + (colDays / 30);
                        const principal = invKrw + sub;
                        interestCost = principal * (avgMonths / 12) * (rate / 100);
                    }
                });
            }
            
            rows.interestCost.values.push(interestCost);
            rows.manualOther.values.push(manualOtherCosts);
            
            const totalOther = manualOtherCosts + interestCost;
            
            const grand = invKrw + sub + totalOther;
            rows.grandtotal.values.push(grand);
            
            // 데이터 속성 저장을 위해 state에 결과 캐싱 (원가 산출에서 사용)
            if (!fw.calculated) fw.calculated = {};
            fw.calculated[term] = {
                invoiceKrw: invKrw,
                ancillaryKrw: sub,
                otherCostsKrw: totalOther,
                totalKrw: grand
            };
        });
    });

    let bHtml = '';
    Object.keys(rows).forEach(key => {
        const r = rows[key];
        
        // 값이 전부 0인 선택적 비용 행은 숨김 처리
        if ((key === 'manualOther' || key === 'interestCost') && r.values.every(v => !v || v === 0)) return;
        
        const cls = r.isGrand ? 'grand-total-row' : (r.isTotal ? 'total-row' : '');
        bHtml += `<tr class="${cls}"><td>${r.label}</td>`;
        r.values.forEach(v => {
            bHtml += `<td>${v > 0 ? '₩ ' + formatNum(v) : '—'}</td>`;
        });
        bHtml += `</tr>`;
    });
    
    tbody.innerHTML = bHtml;
}


function populateCostResultSelector() {
    const sel = document.getElementById('costResultSelector');
    const oldVal = sel.value;
    sel.innerHTML = '';
    
    if (state.doc.forwarders.length === 0) return;
    
    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            const val = `${fIdx}_${term}`;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = `${fw.name} - ${term} 조건`;
            if (val === oldVal) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

function renderCostResultTable() {
    const tbodyValue = document.getElementById('costTableBodyValue');
    const tbodyVolume = document.getElementById('costTableBodyVolume');
    const selVal = document.getElementById('costResultSelector').value;
    
    if (!selVal || state.doc.items.length === 0) {
        tbodyValue.innerHTML = '<tr><td colspan="7" style="text-align:center;">선택된 조건이 없거나 품목이 없습니다.</td></tr>';
        tbodyVolume.innerHTML = '<tr><td colspan="7" style="text-align:center;">선택된 조건이 없거나 품목이 없습니다.</td></tr>';
        return;
    }
    
    const [fIdxStr, term] = selVal.split('_');
    const fw = state.doc.forwarders[parseInt(fIdxStr)];
    
    if (!fw || !fw.calculated || !fw.calculated[term]) return;
    
    const calc = fw.calculated[term];
    const totalAncillaryKrw = calc.ancillaryKrw + (calc.otherCostsKrw || 0);
    const totalInvoiceKrw = calc.invoiceKrw;
    
    const isLCL = state.doc.shipmentType === 'LCL';
    
    // --- 5-1. 가치비례 배분법 렌더링 ---
    const allocationRatio = totalInvoiceKrw > 0 ? (totalAncillaryKrw / totalInvoiceKrw) : 0;
    let htmlValue = '';
    
    // --- 5-2. 체적/운임톤 배분법 사전 계산 ---
    let totalModulus = 0;
    state.doc.items.forEach(item => {
        const p = item.prices[term];
        if (p && p.unitPrice > 0) {
            if (isLCL) {
                totalModulus += (item.rt || 0);
            } else {
                if (item.maxLoad > 0) totalModulus += (item.qty / item.maxLoad);
            }
        }
    });
    let htmlVolume = '';

    state.doc.items.forEach(item => {
        const p = item.prices[term];
        if (!p || !p.unitPrice || p.unitPrice === 0) {
            htmlValue += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="5" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            htmlVolume += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="5" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            return;
        }
        
        const unitPriceFC = p.unitPrice;
        const exRate = state.doc.exchangeRates[p.currency] || 1;
        const dutyRate = item.dutyRate || 0;
        
        // --- 5-1 로직 ---
        const allocatedFC_Value = unitPriceFC * allocationRatio;
        const baseCostFC_Value = unitPriceFC + allocatedFC_Value;
        const baseCostKrw_Value = baseCostFC_Value * exRate;
        const dutyKrw_Value = baseCostKrw_Value * (dutyRate / 100);
        const realCostKrw_Value = baseCostKrw_Value + dutyKrw_Value;
        
        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Value, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Value, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Value)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Value)}</td>
            </tr>
        `;
        
        // --- 5-2 로직 ---
        let allocatedFC_Volume = 0;
        let volumeShareRatio = 0;
        
        if (totalModulus > 0 && item.qty > 0) {
            if (isLCL) {
                volumeShareRatio = (item.rt || 0) / totalModulus;
            } else {
                if (item.maxLoad > 0) {
                    volumeShareRatio = (item.qty / item.maxLoad) / totalModulus;
                }
            }
            const itemTotalAncillaryKrw = totalAncillaryKrw * volumeShareRatio;
            allocatedFC_Volume = (itemTotalAncillaryKrw / exRate) / item.qty;
        }
        
        const baseCostFC_Volume = unitPriceFC + allocatedFC_Volume;
        const baseCostKrw_Volume = baseCostFC_Volume * exRate;
        const dutyKrw_Volume = baseCostKrw_Volume * (dutyRate / 100);
        const realCostKrw_Volume = baseCostKrw_Volume + dutyKrw_Volume;
        
        const shareText = isLCL ? 
            ((volumeShareRatio * 100).toFixed(1) + '% (R/T)') : 
            (item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '<span style="color:var(--danger);font-size:0.85em">적재량 누락</span>');

        htmlVolume += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${shareText}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Volume, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(baseCostFC_Volume, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Volume)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Volume)}</td>
            </tr>
        `;
    });
    
    tbodyValue.innerHTML = htmlValue;
    tbodyVolume.innerHTML = htmlVolume;
}

// 전역 노출
window.editQuote = editQuote;

function generatePrintAndExcelHTML() {
    const container = document.getElementById('printContainer');
    if (!container) return;

    if (state.doc.items.length === 0) {
        container.innerHTML = '<p style="padding:20px; text-align:center;">견적 내용이 없습니다.</p>';
        return;
    }

    // A4 width filling via table-layout:fixed and 9-column grid
    let html = `<table id="exportMasterTable" style="width:100%; border-collapse:collapse; font-size:11px; font-family:'Malgun Gothic', sans-serif; table-layout:fixed; color:#000;">`;
    
    // 9 columns definition -> 10 columns
    html += `
        <colgroup>
            <col style="width:10%;">
            <col style="width:12%;">
            <col style="width:9%;">
            <col style="width:9%;">
            <col style="width:10%;">
            <col style="width:9%;">
            <col style="width:9%;">
            <col style="width:9%;">
            <col style="width:10%;">
            <col style="width:13%;">
        </colgroup>
    `;

    // 1. 헤더 (견적 정보)
    html += `
        <thead>
            <tr>
                <th colspan="10" style="font-size:18px; color:#203864; padding:15px; text-align:left; border-bottom:2px solid #203864; background:white;">
                    포워더 견적서 (${state.doc.title || ''})
                </th>
            </tr>
            <tr>
                <th colspan="2" style="background:#203864; color:white; padding:8px; border:1px solid #203864; text-align:center;">견적일자</th>
                <td colspan="3" style="padding:8px; border:1px solid #ccc; text-align:center;">${state.doc.quoteDate || ''}</td>
                <th colspan="2" style="background:#203864; color:white; padding:8px; border:1px solid #203864; text-align:center;">선적 / 규격</th>
                <td colspan="3" style="padding:8px; border:1px solid #ccc; text-align:center;">${state.doc.shipmentType === 'LCL' ? 'LCL 화물' : `FCL (${state.doc.containerType || ''} x ${state.doc.containerQty || 1})`}</td>
            </tr>
            <tr>
                <th colspan="2" style="background:#203864; color:white; padding:8px; border:1px solid #203864; text-align:center;">출발항 (POL)</th>
                <td colspan="3" style="padding:8px; border:1px solid #ccc; text-align:center;">${state.doc.pol || ''}</td>
                <th colspan="2" style="background:#203864; color:white; padding:8px; border:1px solid #203864; text-align:center;">도착항 (POD)</th>
                <td colspan="3" style="padding:8px; border:1px solid #ccc; text-align:center;">${state.doc.pod || ''}</td>
            </tr>
            <tr>
                <th colspan="2" style="background:#203864; color:white; padding:8px; border:1px solid #203864; text-align:center;">적용 환율</th>
                <td colspan="8" style="padding:8px; border:1px solid #ccc; text-align:left; background:#fff2cc;">
                    <strong>USD:</strong> ₩${formatNum(state.doc.exchangeRates.USD, 2)} &nbsp;&nbsp;|&nbsp;&nbsp; 
                    <strong>CNY:</strong> ₩${formatNum(state.doc.exchangeRates.CNY, 2)} &nbsp;&nbsp;|&nbsp;&nbsp; 
                    <strong>EUR:</strong> ₩${formatNum(state.doc.exchangeRates.EUR, 2)} &nbsp;&nbsp;|&nbsp;&nbsp; 
                    <strong>JPY:</strong> ₩${formatNum(state.doc.exchangeRates.JPY, 2)}
                </td>
            </tr>
            <tr><th colspan="10" style="height:20px; border:none; background:white;"></th></tr>
        </thead>
        <tbody>
    `;

    // 2. 수입 대상 품목
    const printTerms = state.doc.incoterms.slice(0, 4);
    const hasMoreTerms = state.doc.incoterms.length > 4;
    const remainingCols = 4 - printTerms.length;

    html += `
        <tr>
            <th colspan="10" style="font-size:15px; color:#203864; text-align:left; padding:10px 0 5px 0; border-bottom:2px solid #203864; background:white;">
                1. 수입 대상 품목
                ${hasMoreTerms ? `<span style="font-size:12px; color:red; margin-left:15px; font-weight:normal;">* 인쇄 여백 제한으로 최대 4개의 인코텀즈 단가만 표시됩니다.</span>` : ''}
            </th>
        </tr>
        <tr>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">HS CODE</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">품명</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">수량</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">단위</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">총중량(kg)</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">${state.doc.shipmentType === 'LCL' ? 'CBM / R/T' : '최대적재량'}</th>
    `;
    printTerms.forEach(term => {
        html += `<th style="background:#203864; color:white; padding:6px; border:1px solid #203864; font-size:10px;">단가/총액<br>(${term})</th>`;
    });
    if (remainingCols > 0) {
        html += `<th colspan="${remainingCols}" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">비고</th>`;
    }
    html += `</tr>`;
    
    let sumQty = 0;
    let sumWeight = 0;
    let sumPerTerm = {};
    printTerms.forEach(t => sumPerTerm[t] = 0);

    state.doc.items.forEach(item => {
        sumQty += (item.qty || 0);
        sumWeight += (item.weight || 0);
        html += `
            <tr>
                <td style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.hsCode || ''}</td>
                <td style="padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name || ''}</td>
                <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">
                    ${formatNum(item.qty)}
                    ${state.doc.shipmentType === 'LCL' ? `<br><span style="font-size:10px; color:#555;">[CTN: ${formatNum(item.ctn || 1)}]</span>` : ''}
                </td>
                <td style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${item.unit || ''}</td>
                <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${formatNum(item.weight)}</td>
                <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${state.doc.shipmentType === 'LCL' ? `${formatNum(item.cbm || 0, 3)} / ${formatNum(item.rt || 0, 3)}` : `${formatNum(item.maxLoad)} /cntr`}</td>
        `;
        
        printTerms.forEach(term => {
            const p = item.prices[term];
            if (p && p.unitPrice) {
                const total = p.unitPrice * (item.qty || 0);
                sumPerTerm[term] += total;
                html += `<td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; font-size:10px;">
                    ${p.currency || ''} ${formatNum(p.unitPrice)}<br>
                    <span style="color:#555;">(총액 ${p.currency || ''} ${formatNum(total)})</span>
                </td>`;
            } else {
                html += `<td style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#aaa;">—</td>`;
            }
        });

        if (remainingCols > 0) {
            html += `<td colspan="${remainingCols}" style="padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;"></td>`;
        }
        
        html += `</tr>`;
    });
    
    html += `
        <tr>
            <th colspan="2" style="background:#f2f2f2; padding:6px; border:1px solid #ccc; text-align:center;">합계</th>
            <th style="background:#f2f2f2; padding:6px; border:1px solid #ccc; text-align:right;">${formatNum(sumQty)}</th>
            <th style="background:#f2f2f2; padding:6px; border:1px solid #ccc;"></th>
            <th style="background:#f2f2f2; padding:6px; border:1px solid #ccc; text-align:right;">${formatNum(sumWeight)} kg</th>
            <th style="background:#f2f2f2; padding:6px; border:1px solid #ccc;"></th>
    `;
    printTerms.forEach(term => {
        let currency = '';
        let exRate = 1;
        for (const item of state.doc.items) {
            if (item.prices[term] && item.prices[term].currency) {
                currency = item.prices[term].currency;
                exRate = state.doc.exchangeRates[currency] || 1;
                break;
            }
        }
        const sumVal = sumPerTerm[term] || 0;
        const sumKrw = sumVal * exRate;

        html += `<th style="text-align:right; padding:6px; border:1px solid #ccc; background:#f2f2f2; font-size:10px;">
            <span style="font-weight:bold; font-size:11px;">${currency} ${formatNum(sumVal)}</span><br>
            <span style="color:#555; font-weight:normal;">(₩${formatNum(sumKrw)})</span>
        </th>`;
    });
    if (remainingCols > 0) {
        html += `<th colspan="${remainingCols}" style="background:#f2f2f2; padding:6px; border:1px solid #ccc;"></th>`;
    }
    html += `
        </tr>
        <tr><td colspan="10" style="height:20px; border:none; background:white;"></td></tr>
    `;

    // 3. 비용 요약 (행/열 반전 Transpose 로직)
    const getInvoiceSumKrw = (term) => {
        let sum = 0;
        state.doc.items.forEach(item => {
            const p = item.prices[term];
            if (p && p.currency && p.unitPrice) {
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                sum += (p.unitPrice * item.qty * exRate);
            }
        });
        return sum;
    };

    html += `
        <tr>
            <th colspan="10" style="font-size:15px; color:#203864; text-align:left; padding:10px 0 5px 0; border-bottom:2px solid #203864; background:white;">
                2. 비용 요약 (원화 환산)
            </th>
        </tr>
        <tr>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">구분 (포워더 / 조건)</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">물품 대금</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">해상 운임 (O/F)</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">수출국 부대비용</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">수입국 부대비용</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">적하보험료</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">수입 통관수수료</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">포워더 소계</th>
            <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">기타 추가비용</th>
            <th style="background:#D9E1F2; color:#203864; padding:6px; border:1px solid #203864;">총 비용 (KRW)</th>
        </tr>
    `;

    state.doc.forwarders.forEach((fw) => {
        state.doc.incoterms.forEach(term => {
            if (!fw.calculated || !fw.calculated[term]) return;
            const calc = fw.calculated[term];
            const invKrw = calc.invoiceKrw;
            const sub = calc.ancillaryKrw;
            const totalOther = calc.otherCostsKrw || 0;
            const grand = calc.totalKrw;
            
            let oceanKrw = 0, exportKrw = 0, importKrw = 0, insKrw = 0, customsKrw = 0;

            fw.costs.forEach(c => {
                if (c.applyTo[term]) {
                    const amtKrw = (c.amount || 0) * (c.unitQty || 0) * (state.doc.exchangeRates[c.currency] || 1);
                    if (c.key === 'OF') oceanKrw += amtKrw;
                    else if (c.key === 'INS') insKrw += amtKrw;
                    else if (c.key === 'CUST_I') customsKrw += amtKrw;
                    else if (c.key.endsWith('_E') || ['PSS', 'LSS', 'CY', 'PORT', 'EDI', 'VGM'].includes(c.key)) exportKrw += amtKrw;
                    else importKrw += amtKrw;
                }
            });

            html += `
                <tr>
                    <td style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; font-weight:bold; word-break:keep-all;">${fw.name}<br>(${term})</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${invKrw > 0 ? '₩ ' + formatNum(invKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${oceanKrw > 0 ? '₩ ' + formatNum(oceanKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${exportKrw > 0 ? '₩ ' + formatNum(exportKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${importKrw > 0 ? '₩ ' + formatNum(importKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${insKrw > 0 ? '₩ ' + formatNum(insKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${customsKrw > 0 ? '₩ ' + formatNum(customsKrw) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; background:#f2f2f2; font-weight:bold;">${sub > 0 ? '₩ ' + formatNum(sub) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; background:#f2f2f2; font-weight:bold;">${totalOther > 0 ? '₩ ' + formatNum(totalOther) : '—'}</td>
                    <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; font-weight:bold; background:#D9E1F2; color:#203864;">${grand > 0 ? '₩ ' + formatNum(grand) : '—'}</td>
                </tr>
            `;
        });
    });

    html += `<tr><td colspan="10" style="border-top:1px solid #ccc; height:20px; border-left:none; border-right:none; background:white;"></td></tr>`;

    // 4. 모든 인코텀즈 실수입원가 (5-1, 5-2)
    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            if (!fw.calculated || !fw.calculated[term]) return;

            const calc = fw.calculated[term];
            const totalAncillaryKrw = calc.ancillaryKrw + (calc.otherCostsKrw || 0);
            const totalInvoiceKrw = calc.invoiceKrw;
            
            const allocationRatio = totalInvoiceKrw > 0 ? (totalAncillaryKrw / totalInvoiceKrw) : 0;
            
            let totalContainers = 0;
            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (p && p.unitPrice > 0 && item.maxLoad > 0) {
                    totalContainers += (item.qty / item.maxLoad);
                }
            });

            html += `
                <tr>
                    <th colspan="10" style="font-size:15px; color:#203864; text-align:left; padding:10px 0 5px 0; border-bottom:2px solid #203864; background:white;">
                        3. 실수입원가 - ${fw.name} (${term})
                    </th>
                </tr>
            `;

            // 5-1 가치비례
            html += `
                <tr><td colspan="10" style="background:#D9E1F2; color:#203864; font-weight:bold; padding:6px; border:1px solid #203864;">(1) 가치비례 배분법 (가액 기준)</td></tr>
                <tr>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">품명</th>
                    <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">수량</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">순수 물품대금 (단위당)</th>
                    <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">부대비용 (단위당)</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">실수입원가 (외화)</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">실수입원가 (KRW)</th>
                </tr>
            `;
            
            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (!p || !p.unitPrice || p.unitPrice === 0) {
                    html += `<tr><td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td><td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${item.qty}</td><td colspan="7" style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#666;">단가 없음</td></tr>`;
                    return;
                }
                const unitPriceFC = p.unitPrice;
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                const allocatedFC_Value = unitPriceFC * allocationRatio;
                const realCostFC_Value = unitPriceFC + allocatedFC_Value;
                const realCostKrw_Value = realCostFC_Value * exRate;

                html += `
                    <tr>
                        <td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${formatNum(item.qty)}</td>
                        <td colspan="2" style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(allocatedFC_Value, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(realCostFC_Value, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; background:#f2f2f2; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#203864;">₩ ${formatNum(realCostKrw_Value)}</td>
                    </tr>
                `;
            });

            // 5-2 적재비율
            html += `
                <tr><td colspan="10" style="background:#D9E1F2; color:#203864; font-weight:bold; padding:6px; border:1px solid #203864;">(2) 컨테이너 적재비율 배분법 (부피/무게 기준)</td></tr>
                <tr>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">품명</th>
                    <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">점유율</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">순수 물품대금 (단위당)</th>
                    <th style="background:#203864; color:white; padding:6px; border:1px solid #203864;">부대비용 (단위당)</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">실수입원가 (외화)</th>
                    <th colspan="2" style="background:#203864; color:white; padding:6px; border:1px solid #203864;">실수입원가 (KRW)</th>
                </tr>
            `;

            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (!p || !p.unitPrice || p.unitPrice === 0) {
                    html += `<tr><td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td><td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">-</td><td colspan="7" style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#666;">단가 없음</td></tr>`;
                    return;
                }
                const unitPriceFC = p.unitPrice;
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                
                let allocatedFC_Volume = 0;
                let volumeShareRatio = 0;
                if (item.maxLoad > 0 && totalContainers > 0 && item.qty > 0) {
                    const itemContainerUsage = item.qty / item.maxLoad;
                    volumeShareRatio = itemContainerUsage / totalContainers;
                    const itemTotalAncillaryKrw = totalAncillaryKrw * volumeShareRatio;
                    allocatedFC_Volume = (itemTotalAncillaryKrw / exRate) / item.qty;
                }

                const realCostFC_Volume = unitPriceFC + allocatedFC_Volume;
                const realCostKrw_Volume = realCostFC_Volume * exRate;

                html += `
                    <tr>
                        <td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '누락'}</td>
                        <td colspan="2" style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(allocatedFC_Volume, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(realCostFC_Volume, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; background:#f2f2f2; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#203864;">₩ ${formatNum(realCostKrw_Volume)}</td>
                    </tr>
                `;
            });
            html += `<tr><td colspan="10" style="border-top:1px solid #ccc; height:20px; border-left:none; border-right:none; background:white;"></td></tr>`;
        });
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('엑셀 라이브러리를 불러오지 못했습니다.', true);
        return;
    }
    const table = document.getElementById('exportMasterTable');
    if (!table) {
        showToast('엑셀로 내보낼 데이터가 없습니다.', true);
        return;
    }

    try {
        const wb = XLSX.utils.table_to_book(table, { sheet: "포워더 견적서" });
        const dateStr = state.doc.quoteDate ? state.doc.quoteDate.replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
        const title = state.doc.title || 'Untitled';
        XLSX.writeFile(wb, `포워더견적서_${title}_${dateStr}.xlsx`);
    } catch (err) {
        console.error(err);
        showToast('엑셀 변환 중 오류가 발생했습니다.', true);
    }
}
