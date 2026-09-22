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
        otherCosts: [],
        remarks: ''
    },
    activeForwarderIdx: 0,
    filters: {
        preset: 'all',
        startDate: '',
        endDate: '',
        target: '',
        keyword: '',
        subKeyword: '',
        status: ''
    }
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
    { key: 'OF', label: '해상운임 (O/F, Ocean Freight)', defaultUnit: 'per Container', group: 'ocean', applyTo: { EXW: true, FOB: true, CIF: false } },
    
    { key: 'PSS', label: '성수기 할증료 (P.S.S)', defaultUnit: 'per Container', group: 'logistics', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'LSS', label: '저유황유 할증료 (L.S.S)', defaultUnit: 'per Container', group: 'logistics', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'BAF', label: '유류할증료 (B.A.F)', defaultUnit: 'per Container', group: 'logistics', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CAF', label: '통화조정할증료 (C.A.F)', defaultUnit: 'per Container', group: 'logistics', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'HNDL', label: '취급수수료 (Handling Charge)', defaultUnit: 'per B/L', group: 'logistics', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DOC', label: '서류대행비 (DOC)', defaultUnit: 'per B/L', group: 'logistics', applyTo: { EXW: true, FOB: true, CIF: true } },

    { key: 'CY', label: 'CY비 (CY Charge)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'PORT', label: '항만비용 (Port Charge)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'EDI', label: 'EDI/서류/부킹 (EDI+Doc+Sur+Bkg)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'THC_E', label: '터미널하역비 수출 (THC E)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'VGM', label: '총중량검증비 (VGM)', defaultUnit: 'per Container', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'CUST_E', label: '수출통관비 (Customs E)', defaultUnit: 'per B/L', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    { key: 'TRK_E', label: '내륙운송 수출 (Trucking E)', defaultUnit: 'Lump Sum', group: 'export', applyTo: { EXW: true, FOB: false, CIF: false } },
    
    { key: 'CRS', label: '컨테이너회송료 (C.R.S)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'DO', label: '화물인도지시서 (D/O)', defaultUnit: 'per B/L', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'THC_I', label: '터미널하역비 수입 (THC I)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'WHFG', label: '부두사용료 (Wharfage)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TSF', label: '터미널보안료 (TSF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'PSMF', label: '항만안전관리비 (PSMF)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'CCC', label: '컨테이너세정비 (CCC)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'STRIP', label: '컨테이너적출료 (Stripping)', defaultUnit: 'per Container', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    { key: 'TRK_I', label: '내륙운송 수입 (Trucking I)', defaultUnit: 'Lump Sum', group: 'import', applyTo: { EXW: true, FOB: true, CIF: true } },
    
    { key: 'INS', label: '적하보험료 (Cargo Ins)', defaultUnit: 'Lump Sum', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: false } },
    { key: 'CUST_I', label: '통관수수료 (Customs I)', defaultUnit: 'per B/L', group: 'customs', applyTo: { EXW: true, FOB: true, CIF: true } }
];

const UNIT_OPTIONS = ['Lump Sum', 'per Container', 'per B/L', 'per CBM', 'per R/T', 'per TON', 'per Unit'];

// ─────────────────────────────────────────────────────────────
// 초기화 및 이벤트 바인딩
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadRates();
    loadList().then(() => {
        checkTransferData();
    });
});

function checkTransferData() {
    const dataStr = localStorage.getItem('kng_transfer_data');
    if (dataStr) {
        try {
            const transfer = JSON.parse(dataStr);
            if (transfer.source === 'import-quotation' && transfer.data) {
                localStorage.removeItem('kng_transfer_data'); // 한번만 사용
                
                openNewQuote();
                document.getElementById('docTitle').value = transfer.data.title || '';
                document.getElementById('docPol').value = transfer.data.pol || '';
                document.getElementById('docPod').value = transfer.data.pod || '';
                
                const terms = transfer.data.incoterms || 'FOB';
                const incotermsEl = document.getElementById('docIncoterms');
                if (incotermsEl) incotermsEl.value = terms;
                state.doc.incoterms = [terms];
                
                // 품목
                state.doc.items = [];
                if (transfer.data.items && transfer.data.items.length > 0) {
                    transfer.data.items.forEach((it, idx) => {
                        state.doc.items.push({
                            id: generateId(),
                            name: it.description || '',
                            qty: it.qty || 1,
                            unit: it.unit || 'EA',
                            weight: '',
                            cbm: ''
                        });
                    });
                } else {
                    state.doc.items.push({ id: generateId(), name: '', qty: 1, unit: 'EA', weight: '', cbm: '' });
                }
                
                renderItems();
                updateIncotermUI();
                showToast('견적서 데이터가 포워더 견적에 적용되었습니다.', false);
            }
        } catch (e) {
            console.error('Transfer data parse error', e);
        }
    }
}

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
    document.getElementById('btnPrint').addEventListener('click', () => {
        renderAllCalculations();
        generatePrintHTML();
        window.print();
    });
    window.addEventListener('beforeprint', () => {
        renderAllCalculations();
        generatePrintHTML();
    });
    document.getElementById('btnExportExcel').addEventListener('click', exportToExcel);

    // 가치비례 배분법 토글 버튼
    const btnToggleVal = document.getElementById('btnToggleValueAlloc');
    if (btnToggleVal) {
        btnToggleVal.addEventListener('click', () => {
            state.doc.showValueAlloc = !state.doc.showValueAlloc;
            updateValueAllocUI();
            generatePrintHTML();
        });
    }
    
    // Drag and Drop CSS Injection
    if (!document.getElementById('dnd-styles')) {
        const style = document.createElement('style');
        style.id = 'dnd-styles';
        style.textContent = `
            .draggable-row.dragging { opacity: 0.5; background: #f0f0f0; }
            .draggable-row.drag-over { border-top: 2px dashed var(--primary); }
            .drag-handle { cursor: grab; color: #aaa; margin-right: 5px; vertical-align: middle; font-size: 1.1rem; }
            .drag-handle:active { cursor: grabbing; color: var(--primary); }
        `;
        document.head.appendChild(style);
    }
    
    // 목록 액션
    document.getElementById('selectAll').addEventListener('change', e => {
        document.querySelectorAll('.row-chk').forEach(cb => cb.checked = e.target.checked);
        updateSelectionUI();
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
            if (id === 'docDate') key = 'quoteDate';
            
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
        state.doc.items.push({ hsCode: '', name: '', qty: 1, unit: 'EA', ctn: 1, weight: 0, maxLoad: 0, l: 0, w: 0, h: 0, pkgWeight: 0, dutyRate: 0, cbm: 0, rt: 0, remarks: '', prices });
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
        renderOtherCosts();
        renderAllCalculations();
    });

    document.getElementById('btnAddInterest').addEventListener('click', () => {
        state.doc.otherCosts = state.doc.otherCosts || [];
        if (state.doc.otherCosts.find(c => c.id === 'interest')) {
            alert('이미 금융비용 항목이 존재합니다.');
            return;
        }
        state.doc.otherCosts.push({
            id: 'interest',
            name: '금융비용(이자비용)',
            type: 'calculated',
            durationMonths: 2,
            interestRate: 4.0,
            collectionDays: 60,
            amount: 0
        });
        renderOtherCosts();
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
    document.body.style.overflow = 'auto';
    window.scrollTo({ top: 0, behavior: 'instant' });
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
        if (!state.doc.otherCosts) {
            state.doc.otherCosts = [];
        }
        state.doc.showValueAlloc = !!data.showValueAlloc;
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
        renderOtherCosts();
        updateValueAllocUI();
        renderAllCalculations();
        
        switchView('edit');
    } catch (err) {
        showToast(err.message, true);
    }
}

function updateValueAllocUI() {
    const block = document.getElementById('valAllocationBlock');
    const btn = document.getElementById('btnToggleValueAlloc');
    if (!block || !btn) return;
    if (state.doc.showValueAlloc) {
        block.style.display = 'block';
        btn.innerHTML = "<i class='bx bx-minus'></i> 가치비례 배분법 제외";
        btn.className = "btn-secondary btn-sm text-danger";
    } else {
        block.style.display = 'none';
        btn.innerHTML = "<i class='bx bx-plus'></i> 가치비례 배분법 추가";
        btn.className = "btn-secondary btn-sm";
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
        otherCosts: [],
        remarks: '',
        showValueAlloc: false
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
    renderOtherCosts();
    updateValueAllocUI();
    renderAllCalculations();
    
    switchView('edit');
}

function closeEdit() {
    switchView('list');
}

// ─────────────────────────────────────────────────────────────
// ECOUNT ERP 스타일 필터 & 검색 헬퍼
// ─────────────────────────────────────────────────────────────
function getFilteredList() {
    return state.list.filter(item => {
        // 1. 상태 필터
        if (state.filters.status && item.status !== state.filters.status) return false;

        // 2. 날짜 필터 (quoteDate 또는 createdAt 기준)
        const dateVal = item.quoteDate || (item.createdAt ? item.createdAt.split('T')[0] : '');
        if (state.filters.startDate && dateVal < state.filters.startDate) return false;
        if (state.filters.endDate && dateVal > state.filters.endDate) return false;

        // 3. 메인 검색 (공백 구분 다중 AND 교집합 검색)
        if (state.filters.keyword) {
            const tokens = state.filters.keyword.toLowerCase().split(/\s+/).filter(Boolean);
            let targetText = '';
            if (state.filters.target === 'title') {
                targetText = (item.title || '').toLowerCase();
            } else if (state.filters.target === 'pol') {
                targetText = (item.pol || '').toLowerCase();
            } else if (state.filters.target === 'pod') {
                targetText = (item.pod || '').toLowerCase();
            } else if (state.filters.target === 'remarks') {
                targetText = (item.remarks || '').toLowerCase();
            } else {
                targetText = [
                    item.title, item.pol, item.pod, item.remarks,
                    ...(item.forwarders || []).map(f => f.name),
                    ...(item.items || []).map(i => i.name)
                ].filter(Boolean).join(' ').toLowerCase();
            }
            const match = tokens.every(token => targetText.includes(token));
            if (!match) return false;
        }

        // 4. 결과 내 재검색 (Sub-search)
        if (state.filters.subKeyword) {
            const subTokens = state.filters.subKeyword.split(/\s+/).filter(Boolean);
            const allText = [
                item.title, item.quoteDate, item.status, item.pol, item.pod, item.remarks,
                ...(item.forwarders || []).map(f => f.name),
                ...(item.items || []).map(i => i.name)
            ].filter(Boolean).join(' ').toLowerCase();
            const matchSub = subTokens.every(t => allText.includes(t));
            if (!matchSub) return false;
        }

        return true;
    });
}

function updateSelectionUI() {
    const checked = document.querySelectorAll('.row-chk:checked');
    const btnDel = document.getElementById('btnDeleteSelected');
    const countSpan = document.getElementById('selectedQuoteCount');
    const selectAll = document.getElementById('selectAll');
    
    if (countSpan) countSpan.textContent = checked.length;
    if (btnDel) {
        btnDel.classList.toggle('d-none', checked.length === 0);
    }
    const allChks = document.querySelectorAll('.row-chk');
    if (selectAll && allChks.length > 0) {
        selectAll.checked = (checked.length === allChks.length);
    }
}

// ─────────────────────────────────────────────────────────────
// 렌더링 (List - ECOUNT ERP High-Density Grid)
// ─────────────────────────────────────────────────────────────
function renderList() {
    const tbody = document.getElementById('quoteListBody');
    if (!tbody) return;

    const filtered = getFilteredList();

    // 1. 상단 통계 뱃지 갱신
    const totalBadge = document.getElementById('quoteTotalCountBadge');
    if (totalBadge) {
        const isFiltering = state.filters.keyword || state.filters.subKeyword || state.filters.startDate || state.filters.endDate || state.filters.status;
        totalBadge.textContent = isFiltering
            ? `조회 ${filtered.length}건 / 총 ${state.list.length}건`
            : `관리 ${state.list.length}건`;
    }

    const fclLclBadge = document.getElementById('fclLclBadge');
    if (fclLclBadge) {
        let fclCount = 0, lclCount = 0;
        filtered.forEach(it => {
            if (it.shipmentType === 'LCL') lclCount++;
            else fclCount++;
        });
        fclLclBadge.textContent = `FCL ${fclCount}건 / LCL ${lclCount}건`;
    }

    // 결과 내 재검색 뱃지 갱신
    const subBadge = document.getElementById('subSearchCountBadge');
    if (subBadge) {
        if (state.filters.subKeyword) {
            subBadge.textContent = `${filtered.length}건 일치`;
            subBadge.classList.remove('d-none');
        } else {
            subBadge.classList.add('d-none');
        }
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted" style="height: 60px;">조건에 일치하는 견적이 없습니다.</td></tr>';
        updateSelectionUI();
        return;
    }

    let html = '';
    filtered.forEach(item => {
        const statusMap = { 'draft': '초안', 'confirmed': '확정', 'expired': '만료' };

        let containerInfo = `${item.containerType || '20ft'} × ${item.containerQty || 1}`;
        if (item.shipmentType === 'LCL') {
            let totalRt = 0;
            (item.items || []).forEach(i => totalRt += (i.rt || 0));
            containerInfo = totalRt > 0 ? `${totalRt.toFixed(2)} R/T` : 'LCL';
        }

        let ratesHtml = '-';
        if (item.exchangeRates) {
            const arr = [];
            ['USD', 'CNY', 'EUR', 'JPY'].forEach(c => {
                if (item.exchangeRates[c]) arr.push(`<b>${c}</b> ${formatNum(item.exchangeRates[c], 1)}`);
            });
            if (arr.length > 0) ratesHtml = `<div style="font-size:11px; color:#475569; white-space:nowrap;">${arr.join(' | ')}</div>`;
        }

        const dateStr = item.quoteDate || '-';
        const createdDate = item.createdAt ? item.createdAt.split('T')[0] : '-';

        html += `
            <tr style="cursor: pointer;" onclick="window.editQuote('${item.id}')">
                <td class="col-check th-no text-center" onclick="event.stopPropagation()">
                    <input type="checkbox" class="row-chk" value="${item.id}" onchange="window.updateSelectionUI()">
                </td>
                <td class="text-center">
                    <span class="status-badge ${item.status}">${statusMap[item.status] || item.status}</span>
                </td>
                <td class="text-start ps-2" style="font-weight: 600; color: #1e293b;">
                    ${item.title || '(무제 견적)'}
                </td>
                <td class="text-center tabular-nums">${dateStr}</td>
                <td class="text-start ps-2">${ratesHtml}</td>
                <td class="text-center fw-semibold text-primary">${(item.forwarders || []).length}곳</td>
                <td class="text-center">${containerInfo}</td>
                <td class="text-center tabular-nums text-muted">${createdDate}</td>
                <td class="col-action text-center" onclick="event.stopPropagation()">
                    <button type="button" class="btn-icon" onclick="window.editQuote('${item.id}')" title="견적 수정"><i class='bx bx-edit'></i></button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
    updateSelectionUI();

    // 열 너비 조절기 초기화
    if (window.ErpGridResizer && typeof window.ErpGridResizer.init === 'function') {
        setTimeout(() => window.ErpGridResizer.init('quoteListTable'), 50);
    }
}

// ─────────────────────────────────────────────────────────────
// 글로벌 이벤트 핸들러 바인딩 (window 객체)
// ─────────────────────────────────────────────────────────────
window.updateSelectionUI = updateSelectionUI;

window.setDatePreset = function(presetKey) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const toDateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    let start = '', end = '';
    if (presetKey === 'thisMonth') {
        start = toDateStr(new Date(y, m, 1));
        end = toDateStr(new Date(y, m + 1, 0));
    } else if (presetKey === 'prevMonth') {
        start = toDateStr(new Date(y, m - 1, 1));
        end = toDateStr(new Date(y, m, 0));
    } else if (presetKey === 'thisYear') {
        start = `${y}-01-01`;
        end = `${y}-12-31`;
    } else if (presetKey === 'prevYear') {
        start = `${y - 1}-01-01`;
        end = `${y - 1}-12-31`;
    } else if (presetKey === 'all') {
        start = '';
        end = '';
    }

    state.filters.preset = presetKey;
    state.filters.startDate = start;
    state.filters.endDate = end;

    const startEl = document.getElementById('searchStartDate');
    const endEl = document.getElementById('searchEndDate');
    if (startEl) startEl.value = start;
    if (endEl) endEl.value = end;

    document.querySelectorAll('#datePresetGroup .erp-preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.id === `btnPreset_${presetKey}`);
    });

    renderList();
};

window.onDateInputChange = function() {
    const startEl = document.getElementById('searchStartDate');
    const endEl = document.getElementById('searchEndDate');
    state.filters.startDate = startEl ? startEl.value : '';
    state.filters.endDate = endEl ? endEl.value : '';

    document.querySelectorAll('#datePresetGroup .erp-preset-btn').forEach(btn => btn.classList.remove('active'));
    renderList();
};

window.onSearchTargetChange = function() {
    const targetEl = document.getElementById('searchTarget');
    state.filters.target = targetEl ? targetEl.value : '';
    renderList();
};

window.onSearchInputKeyup = function(event) {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn && searchInput) clearBtn.classList.toggle('d-none', !searchInput.value);

    if (event.key === 'Enter') {
        window.applyFiltersAndRender();
    }
};

window.clearSearchInput = function() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '';
        document.getElementById('clearSearchBtn')?.classList.add('d-none');
    }
    window.applyFiltersAndRender();
};

window.applyFiltersAndRender = function() {
    const searchInput = document.getElementById('searchInput');
    const targetEl = document.getElementById('searchTarget');
    state.filters.keyword = searchInput ? searchInput.value.trim() : '';
    state.filters.target = targetEl ? targetEl.value : '';
    renderList();
};

window.resetSearch = function() {
    const searchInput = document.getElementById('searchInput');
    const targetEl = document.getElementById('searchTarget');
    const subSearchInput = document.getElementById('subSearchInput');
    if (searchInput) searchInput.value = '';
    if (targetEl) targetEl.value = '';
    if (subSearchInput) subSearchInput.value = '';
    document.getElementById('clearSearchBtn')?.classList.add('d-none');
    document.getElementById('clearSubSearchBtn')?.classList.add('d-none');

    state.filters.keyword = '';
    state.filters.subKeyword = '';
    state.filters.target = '';
    window.setDatePreset('all');
};

window.onSubSearchInput = function(val) {
    state.filters.subKeyword = (val || '').trim().toLowerCase();
    const clearBtn = document.getElementById('clearSubSearchBtn');
    if (clearBtn) clearBtn.classList.toggle('d-none', !val);
    renderList();
};

window.clearSubSearch = function() {
    const subSearchInput = document.getElementById('subSearchInput');
    if (subSearchInput) subSearchInput.value = '';
    document.getElementById('clearSubSearchBtn')?.classList.add('d-none');
    state.filters.subKeyword = '';
    renderList();
};

window.setStatusFilter = function(status) {
    state.filters.status = status;
    document.querySelectorAll('#statusTabGroup .erp-tab-btn').forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.status || '') === status);
    });
    renderList();
};

window.exportQuoteListExcel = function() {
    const filtered = getFilteredList();
    if (!filtered || filtered.length === 0) {
        showToast('내보낼 견적 데이터가 없습니다.', true);
        return;
    }
    const data = filtered.map((item, idx) => ({
        'No': idx + 1,
        '상태': item.status === 'confirmed' ? '확정' : (item.status === 'expired' ? '만료' : '초안'),
        '견적명': item.title || '',
        '견적일자': item.quoteDate || '',
        '선적형태': item.shipmentType || '',
        '컨테이너규격': item.containerType || '',
        '컨테이너수량': item.containerQty || 1,
        '출발항(POL)': item.pol || '',
        '도착항(POD)': item.pod || '',
        '포워더수': (item.forwarders || []).length,
        '등록일시': (item.createdAt || '').replace('T', ' ').substring(0, 19),
        '비고': item.remarks || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '포워더견적목록');
    XLSX.writeFile(wb, `포워더견적목록_${new Date().toISOString().slice(0,10)}.xlsx`);
};

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

// 비용 그룹 및 정렬 메타데이터 헬퍼 (요약-상세 일대일 매핑용)
function getCostGroupMeta(cost) {
    const k = cost.key || '';
    const g = cost.group || '';
    if (k === 'OF' || g === 'ocean') return { grpKey: 'ocean', grpNo: 2, label: '해상운임', sortOrder: 20 };
    if (g === 'export' || k.endsWith('_E') || ['CY', 'PORT', 'EDI', 'VGM', 'CUST_E', 'TRK_E'].includes(k)) return { grpKey: 'export', grpNo: 3, label: '수출국', sortOrder: 30 };
    if (k === 'INS') return { grpKey: 'ins', grpNo: 5, label: '보험료', sortOrder: 50 };
    if (k === 'CUST_I') return { grpKey: 'customs', grpNo: 6, label: '통관료', sortOrder: 60 };
    return { grpKey: 'import', grpNo: 4, label: '수입국/물류', sortOrder: 40 }; // import + logistics
}

function renderItems() {
    const isLCL = state.doc.shipmentType === 'LCL';
    // 헤더 재생성
    const thead = document.getElementById('itemTableHead');
    let thHtml = `
        <th style="width: 45px; text-align: center;">No.</th>
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
    thHtml += `<th style="width: 130px;">비고</th>`;
    thHtml += `<th class="col-action">삭제</th>`;
    thead.innerHTML = thHtml;

    // 바디 재생성
    const tbody = document.getElementById('itemTableBody');
    if (state.doc.items.length === 0) {
        let colSpan = (isLCL ? 14 : 10) + state.doc.incoterms.length;
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
                <td style="text-align:center; font-weight:600; color:var(--text-secondary); font-size:0.85rem;">${idx + 1}</td>
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
                <td><input type="text" value="${item.remarks || ''}" placeholder="비고 입력" onchange="updateItem(${idx}, 'remarks', this.value)"></td>
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
            <td colspan="3" style="text-align:center;">합계</td>
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
    
    fHtml += `<td></td><td></td></tr>`;
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
    
    const groups = [
        { id: 'ocean', title: '🚢 [2] 해상 운임 및 할증료 (O/F)' },
        { id: 'export', title: '🛫 [3] 수출국 부대비용 (Export Charges)' },
        { id: 'logistics', title: '🌐 [4] 물류 부대비용 (Logistics & Handling)' },
        { id: 'import', title: '🛬 [4] 수입국 부대비용 (Import Local Charges)' },
        { id: 'customs', title: '📋 [5,6] 적하보험 [5] 및 수입통관 [6]' }
    ];
    
    // 포워더 견적 항목별 [그룹-순번] 번호 산출
    const costCounters = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const fwCostNumbers = [];
    fw.costs.forEach((c, idx) => {
        let costGroup = c.group;
        if (!costGroup) {
            if (c.key === 'OF') costGroup = 'ocean';
            else if (c.key === 'INS' || c.key === 'CUST_I') costGroup = 'customs';
            else if (c.key.endsWith('_E') || ['CY', 'PORT', 'EDI', 'VGM'].includes(c.key)) costGroup = 'export';
            else if (['PSS', 'LSS', 'BAF', 'CAF', 'HNDL', 'DOC'].includes(c.key)) costGroup = 'logistics';
            else costGroup = 'import';
            c.group = costGroup;
        }
        const meta = getCostGroupMeta(c);
        costCounters[meta.grpNo] = (costCounters[meta.grpNo] || 0) + 1;
        fwCostNumbers[idx] = `${meta.grpNo}-${costCounters[meta.grpNo]}`;
    });

    let html = '';
    
    groups.forEach(g => {
        html += `
            <div style="margin-bottom:25px; border: 1px solid #eee; border-radius: 8px; overflow: hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; background: #f8f9fa; padding: 10px 15px; border-bottom: 1px solid #eee;">
                    <h4 style="margin:0; font-size:1rem; color:var(--text-primary);">${g.title}</h4>
                    <button class="btn-small btn-outline" onclick="addCustomCost('${g.id}')"><i class='bx bx-plus'></i> 추가</button>
                </div>
                <table class="item-table" style="margin:0; border:none; box-shadow:none;">
                    <thead>
                        <tr>
                            <th style="width:45px; text-align:center;">No.</th>
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
        html += `           <th class="col-action" style="width:50px;">관리</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        let hasItems = false;
        fw.costs.forEach((c, idx) => {
            let costGroup = c.group;
            if (!costGroup) {
                if (c.key === 'OF') costGroup = 'ocean';
                else if (c.key === 'INS' || c.key === 'CUST_I') costGroup = 'customs';
                else if (c.key.endsWith('_E') || ['CY', 'PORT', 'EDI', 'VGM'].includes(c.key)) costGroup = 'export';
                else if (['PSS', 'LSS', 'BAF', 'CAF', 'HNDL', 'DOC'].includes(c.key)) costGroup = 'logistics';
                else costGroup = 'import';
                c.group = costGroup;
            }
            
            if (costGroup === g.id) {
                hasItems = true;
                const isAuto = false;
                let labelHtml = `<input type="text" value="${c.label}" onchange="updateCost(${idx}, 'label', this.value)" ${isAuto?'readonly':''}>`;
                if (c.key === 'INS') {
                    labelHtml = `<div style="display:flex; align-items:center; flex: 1;">
                        ${labelHtml}
                        <i class='bx bx-question-mark tooltip-icon'><span class="tooltip-text">일반적인 산출 공식:<br>Commercial Invoice 총액 (ex: CIF) × 110% × 0.1%</span></i>
                    </div>`;
                }
                if (c.key === 'CUST_I') {
                    let estimatedFee = 0;
                    let cifKrw = 0;
                    let rawFee = 0;
                    if (fw.calculated) {
                        const baseTerm = state.doc.incoterms[0];
                        const calc = fw.calculated[baseTerm];
                        if (calc) {
                            cifKrw = calc.invoiceKrw + calc.dutiableAncillaryKrw;
                            rawFee = cifKrw * 0.002; // 0.2%
                            estimatedFee = Math.max(30000, Math.min(450000, rawFee)); // Min 3만, Max 45만
                        }
                    }
                    
                    let tooltipStr = `관세사 통관수수료 산출 공식:<br>CIF 과세표준(KRW) × 0.2%<br>(최소 3만원 ~ 최대 45만원)`;
                    if (estimatedFee > 0) {
                        tooltipStr += `<br><br><b>[현재 견적 기준 예상액]</b><br>CIF: ₩ ${formatNum(cifKrw)}<br>계산금액: ₩ ${formatNum(rawFee)}`;
                        if (rawFee < 30000) tooltipStr += `<br><span style="color:#ffd700">최소요금 3만원 적용</span>`;
                        else if (rawFee > 450000) tooltipStr += `<br><span style="color:#ffd700">최대요금 45만원 적용</span>`;
                        tooltipStr += `<br><b style="color:#66b2ff;">최종 예상: ₩ ${formatNum(estimatedFee)}</b>`;
                    } else {
                        tooltipStr += `<br><br>(과세표준 산출 후 계산됩니다.)`;
                    }
                    
                    labelHtml = `<div style="display:flex; align-items:center; flex: 1;">
                        ${labelHtml}
                        <i class='bx bx-calculator tooltip-icon' style="color:var(--primary);"><span class="tooltip-text" style="width:220px; font-weight:normal;">${tooltipStr}</span></i>
                    </div>`;
                }
                
                html += `
                    <tr class="draggable-row" draggable="true" data-idx="${idx}"
                        ondragstart="handleDragStart(event)"
                        ondragover="handleDragOver(event)"
                        ondragenter="handleDragEnter(event)"
                        ondragleave="handleDragLeave(event)"
                        ondrop="handleDrop(event, ${idx})"
                        ondragend="handleDragEnd(event)">
                        <td style="text-align:center; font-weight:600; color:var(--text-secondary); font-size:0.85rem;">
                            ${fwCostNumbers[idx]}
                        </td>
                        <td>
                            <div style="display:flex; align-items:center; width: 100%;">
                                <i class='bx bx-grid-vertical drag-handle' title="드래그하여 순서 변경"></i>
                                ${labelHtml}
                            </div>
                        </td>
                        <td>
                            <input type="number" class="col-num fw-cost-input" value="${c.amount}" oninput="updateCost(${idx}, 'amount', this.value)">
                        </td>
                        <td>
                            <select onchange="updateCost(${idx}, 'currency', this.value)">
                                <option value="KRW" ${c.currency==='KRW'?'selected':''}>KRW</option>
                                <option value="USD" ${c.currency==='USD'?'selected':''}>USD</option>
                                <option value="CNY" ${c.currency==='CNY'?'selected':''}>CNY</option>
                                <option value="EUR" ${c.currency==='EUR'?'selected':''}>EUR</option>
                                <option value="JPY" ${c.currency==='JPY'?'selected':''}>JPY</option>
                            </select>
                        </td>
                        <td>
                            <select onchange="updateCost(${idx}, 'unit', this.value)">
                                ${UNIT_OPTIONS.map(opt => `<option value="${opt}" ${c.unit===opt?'selected':''}>${opt}</option>`).join('')}
                            </select>
                        </td>
                        <td><input type="number" class="col-num fw-cost-input" value="${c.unitQty}" min="0" step="0.001" oninput="updateCost(${idx}, 'unitQty', this.value)" ${((state.doc.shipmentType==='FCL' && c.unit==='per Container') || (state.doc.shipmentType==='LCL' && (c.unit==='per R/T' || c.unit==='per CBM'))) ? 'readonly style="background:#f0f0f0; border-color:#ddd;" title="화물 수량/부피와 연동되어 자동 계산됩니다."' : ''}></td>
                        <td class="col-num" style="font-weight:500;" id="fwCostSum_${idx}">${formatNum((c.amount||0)*(c.unitQty||0))}</td>
                `;
                
                state.doc.incoterms.forEach(term => {
                    const checked = c.applyTo[term] ? 'checked' : '';
                    html += `<td class="chk-cell"><input type="checkbox" ${checked} onchange="updateCostApply(${idx}, '${term}', this.checked)"></td>`;
                });
                
                html += `
                        <td class="col-action">
                            <button class="btn-icon" style="color:var(--danger-color)" onclick="removeCost(${idx})"><i class='bx bx-trash'></i></button>
                        </td>
                    </tr>
                `;
            }
        });
        
        if (!hasItems) {
            let colSpan = 7 + state.doc.incoterms.length + 1;
            html += `<tr ondragover="handleDragOver(event)" ondragenter="handleDragEnter(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, -1, '${g.id}')">
                <td colspan="${colSpan}" style="text-align:center; color:var(--text-tertiary); padding: 15px; border: 2px dashed #e2e8f0;">이곳으로 항목을 드래그하여 추가하세요.</td>
            </tr>`;
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
    });
    
    area.innerHTML = html;
    calculateAutoCosts();
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

window.handleDrop = function(e, toIdx, targetGroupId = null) {
    e.preventDefault();
    const tr = e.target.closest('tr');
    if (tr) tr.classList.remove('drag-over');
    
    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(fromIdx) || fromIdx === toIdx) return;
    
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    
    if (toIdx !== -1 && fw.costs[toIdx]) {
        targetGroupId = fw.costs[toIdx].group;
    }
    
    const movedItem = fw.costs.splice(fromIdx, 1)[0];
    
    if (targetGroupId) {
        movedItem.group = targetGroupId;
    }
    
    if (toIdx === -1) {
        fw.costs.push(movedItem);
    } else {
        let newIdx = toIdx;
        if (fromIdx < toIdx) {
            newIdx--;
        }
        fw.costs.splice(newIdx, 0, movedItem);
    }
    
    renderForwarderContent();
};

window.handleDragEnd = function(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
};

window.removeCost = function(idx) {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    fw.costs.splice(idx, 1);
    renderForwarderContent();
};

window.addCustomCost = function(group) {
    const fw = state.doc.forwarders[state.activeForwarderIdx];
    const applyTo = {};
    state.doc.incoterms.forEach(t => applyTo[t] = true);
    fw.costs.push({
        key: 'CUSTOM_' + Date.now(),
        label: '사용자 추가 항목',
        group: group || 'import',
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
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">추가된 항목이 없습니다.</td></tr>';
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
                <td style="text-align:center; font-weight:600; color:var(--text-secondary); font-size:0.85rem;">7-${idx + 1}</td>
                <td><input type="text" value="${cost.name}" onchange="updateOtherCost(${idx}, 'name', this.value)" ${cost.type==='calculated'?'readonly':''}></td>
                <td><span class="status-badge ${cost.type==='calculated'?'confirmed':'draft'}">${cost.type==='calculated'?'자동계산':'수동입력'}</span></td>
                <td>${conditionHtml}</td>
                <td>${amountHtml}</td>
                <td class="col-action">
                    <button class="btn-remove" onclick="removeOtherCost(${idx})"><i class='bx bx-x'></i></button>
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
    renderOtherCosts();
    renderAllCalculations();
};

// ─────────────────────────────────────────────────────────────
// 전체 요약 계산 (Summary) & 원가 산출
// ─────────────────────────────────────────────────────────────
function renderAllCalculations() {
    renderSummaryTable();
    populateCostResultSelector();
    renderCostResultTable();
    generatePrintHTML();
}

function renderSummaryTable() {
    const thead = document.querySelector('#summaryTable thead');
    const tbody = document.querySelector('#summaryTable tbody');
    
    if (state.doc.forwarders.length === 0 || state.doc.items.length === 0) {
        thead.innerHTML = '';
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:20px;">비용 요약을 계산할 데이터가 부족합니다.</td></tr>';
        return;
    }

    // 1. 헤더 (포워더 × 인코텀즈)
    let hHtml = '<tr><th style="width:45px; text-align:center;">No.</th><th>비용 구분</th>';
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
        invoice: { no: '1', label: '물품 대금 (KRW 환산)', values: [], details: {} },
        ocean: { no: '2', label: '해상 운임 (O/F)', values: [], details: {}, expandable: true },
        export: { no: '3', label: '수출국 부대비용', values: [], details: {}, expandable: true },
        logistics: { no: '4', label: '물류 부대비용', values: [], details: {}, expandable: true },
        import: { no: '4', label: '수입국 부대비용', values: [], details: {}, expandable: true },
        ins: { no: '5', label: '적하보험료', values: [], details: {}, expandable: true },
        customs: { no: '6', label: '수입 통관수수료', values: [], details: {}, expandable: true },
        interestCost: { no: '7', label: '금융비용 (이자비용)', values: [] },
        manualOther: { no: '7', label: '기타 추가 부대비용 (수동)', values: [], details: {}, expandable: true },
        grandtotal: { no: '—', label: '총 비용 (KRW)', values: [], isGrand: true }
    };

    let colIdx = 0;

    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            // 인보이스
            const invKrw = getInvoiceSumKrw(term);
            rows.invoice.values.push(invKrw);
            let oceanKrw = 0;
            let exportKrw = 0;
            let logisticsKrw = 0;
            let importKrw = 0;
            let insKrw = 0;
            let customsKrw = 0;

            fw.costs.forEach(c => {
                if (c.applyTo[term]) {
                    const amtKrw = (c.amount || 0) * (c.unitQty || 0) * (state.doc.exchangeRates[c.currency] || 1);
                    
                    let tRow;
                    if (c.group === 'ocean') tRow = rows.ocean;
                    else if (c.group === 'export') tRow = rows.export;
                    else if (c.group === 'logistics') tRow = rows.logistics;
                    else if (c.key === 'INS') tRow = rows.ins;
                    else if (c.key === 'CUST_I') tRow = rows.customs;
                    else tRow = rows.import; // 나머지 모두 수입국 (커스텀 포함)
                    
                    tRow.values[colIdx] = (tRow.values[colIdx] || 0) + amtKrw;
                    
                    if (!tRow.details[c.key]) tRow.details[c.key] = { label: c.label, cols: {} };
                    tRow.details[c.key].cols[colIdx] = { curr: c.currency, amt: c.amount, qty: c.unitQty };
                    
                    // For duty calculation context (not displayed here directly)
                    if (c.group === 'ocean') oceanKrw += amtKrw;
                    else if (c.group === 'export') exportKrw += amtKrw;
                    else if (c.group === 'logistics') logisticsKrw += amtKrw;
                    else if (c.key === 'INS') insKrw += amtKrw;
                    else if (c.key === 'CUST_I') customsKrw += amtKrw;
                    else importKrw += amtKrw;
                }
            });
            
            const sub = oceanKrw + exportKrw + logisticsKrw + importKrw + insKrw + customsKrw;
            
            // 기타 금융 및 추가비용 계산
            let manualOtherCosts = 0;
            let interestCost = 0;
            if (state.doc.otherCosts) {
                state.doc.otherCosts.forEach(oc => {
                    if (oc.type === 'manual') {
                        manualOtherCosts += (oc.amount || 0);
                        const dKey = oc.id || oc.name;
                        if (!rows.manualOther.details[dKey]) rows.manualOther.details[dKey] = { label: oc.name, cols: {} };
                        rows.manualOther.details[dKey].cols[colIdx] = { curr: 'KRW', amt: oc.amount, qty: 1 };
                    }
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
            
            rows.interestCost.values[colIdx] = interestCost;
            rows.manualOther.values[colIdx] = manualOtherCosts;
            
            const totalOther = manualOtherCosts + interestCost;
            
            const grand = invKrw + sub + totalOther;
            rows.grandtotal.values.push(grand);
            
            // 데이터 속성 저장을 위해 state에 결과 캐싱 (원가 산출에서 사용)
            if (!fw.calculated) fw.calculated = {};
            fw.calculated[term] = {
                invoiceKrw: invKrw,
                ancillaryKrw: sub,
                dutiableAncillaryKrw: oceanKrw + exportKrw + logisticsKrw + insKrw, // 과세표준(CIF)용 부대비용
                otherCostsKrw: totalOther,
                totalKrw: grand
            };
            colIdx++;
        });
    });

    const colCount = colIdx;

    let bHtml = '';
    let seq = 1;
    Object.keys(rows).forEach(key => {
        const r = rows[key];
        
        // 값이 전부 0인 비용 행은 숨김 처리 (물품대금, 총비용 제외)
        if (key !== 'invoice' && key !== 'grandtotal' && r.values.every(v => !v || v === 0)) return;
        
        const displayNo = r.isGrand ? '—' : String(seq++);
        r.activeNo = displayNo;
        
        const cls = r.isGrand ? 'grand-total-row' : (r.isTotal ? 'total-row' : '');
        let rowHtml = `<tr class="${cls}" ${r.expandable ? `style="cursor:pointer;" onclick="toggleSummaryDetails('${key}')"` : ''}>`;
        rowHtml += `<td style="text-align:center; font-weight:700; color:var(--text-secondary);">${displayNo}</td>`;
        rowHtml += `<td>${r.label} ${r.expandable ? '<span style="font-size:0.8rem; color:var(--primary); margin-left:5px;">[+]</span>' : ''}</td>`;
        
        r.values.forEach(v => {
            rowHtml += `<td>${v > 0 ? '₩ ' + formatNum(v) : '—'}</td>`;
        });
        rowHtml += `</tr>`;
        bHtml += rowHtml;
        
        if (r.expandable) {
            const detailKeys = Object.keys(r.details);
            detailKeys.forEach(dk => {
                const dRow = r.details[dk];
                const hasValue = Object.values(dRow.cols).some(c => c && c.amt > 0);
                if (!hasValue) return;
                
                bHtml += `<tr class="summary_details_${key}" style="display:none; background-color: #f9fbfd; font-size: 0.85rem; color: #555;">
                    <td style="text-align:center; color:#94a3b8; font-size:0.8rem;">${r.activeNo}</td>
                    <td style="padding-left: 25px; border-right: 1px solid #eee;">
                        <span style="color:#aaa; margin-right:8px;">└</span>${dRow.label}
                    </td>`;
                
                for (let i = 0; i < colCount; i++) {
                    const cData = dRow.cols[i];
                    if (cData && cData.amt > 0) {
                        bHtml += `<td style="border-right: 1px solid #eee; font-weight:500;">
                            ${cData.curr} ${formatNum(cData.amt)} ${cData.qty !== 1 ? `<span style="color:#999;font-size:0.8em;font-weight:normal;">×${formatNum(cData.qty,2)}</span>` : ''}
                        </td>`;
                    } else {
                        bHtml += `<td style="border-right: 1px solid #eee; text-align:center; color:#ccc;">-</td>`;
                    }
                }
                bHtml += `</tr>`;
            });
        }
    });
    
    tbody.innerHTML = bHtml;
}

window.toggleSummaryDetails = function(key) {
    const els = document.querySelectorAll(`.summary_details_${key}`);
    let isHidden = false;
    if (els.length > 0) {
        isHidden = (els[0].style.display === 'none');
    }
    
    els.forEach(el => {
        el.style.display = isHidden ? 'table-row' : 'none';
    });
};


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
    const totalDutiableAncillaryKrw = calc.dutiableAncillaryKrw || 0;
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
        
        // --- 5-1 로직 (대안 A: 표시 외화 단가 기준 원화 계산) ---
        const allocatedFC_Value_Total = unitPriceFC * allocationRatio;
        const dutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableAncillaryKrw / totalInvoiceKrw) : 0;
        const allocatedFC_Value_Dutiable = unitPriceFC * dutiableAllocationRatio;
        
        const dispAllocatedFC_Value = Math.round(allocatedFC_Value_Total * 100) / 100;
        const dispBaseCostFC_Value = Math.round((unitPriceFC + dispAllocatedFC_Value) * 100) / 100;
        const baseCostKrw_Value = Math.round(dispBaseCostFC_Value * exRate); // 전체 부대비용 포함 원가 (표시 외화 기준)
        
        // 관세 계산: CIF 가액 기준 (물품대금 + 과세대상 부대비용)
        const dispAllocatedFC_Dutiable = Math.round(allocatedFC_Value_Dutiable * 100) / 100;
        const cifValueKrw_Value = Math.round((unitPriceFC + dispAllocatedFC_Dutiable) * exRate);
        const dutyKrw_Value = Math.round(cifValueKrw_Value * (dutyRate / 100));
        
        const realCostKrw_Value = baseCostKrw_Value + dutyKrw_Value;
        
        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(dispAllocatedFC_Value, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(dispBaseCostFC_Value, 2)}</td>
                <td class="col-num" style="color:var(--text-secondary);">₩ ${formatNum(dutyKrw_Value)}<br><span style="font-size:10px;">(${dutyRate}%)</span></td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Value)}</td>
            </tr>
        `;
        
        // --- 5-2 로직 (대안 A: 표시 외화 단가 기준 원화 계산) ---
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
            const itemTotalAncillaryKrw = totalAncillaryKrw * volumeShareRatio;
            const itemDutiableAncillaryKrw = totalDutiableAncillaryKrw * volumeShareRatio;
            
            allocatedFC_Volume_Total = (itemTotalAncillaryKrw / exRate) / item.qty;
            allocatedFC_Volume_Dutiable = (itemDutiableAncillaryKrw / exRate) / item.qty;
        }
        
        const dispAllocatedFC_Volume = Math.round(allocatedFC_Volume_Total * 100) / 100;
        const dispBaseCostFC_Volume = Math.round((unitPriceFC + dispAllocatedFC_Volume) * 100) / 100;
        const baseCostKrw_Volume = Math.round(dispBaseCostFC_Volume * exRate); // 전체 부대비용 포함 원가 (표시 외화 기준)
        
        // 관세 계산: CIF 가액 기준 (물품대금 + 과세대상 부대비용)
        const dispDutiableAllocated_Volume = Math.round(allocatedFC_Volume_Dutiable * 100) / 100;
        const cifValueKrw_Volume = Math.round((unitPriceFC + dispDutiableAllocated_Volume) * exRate);
        const dutyKrw_Volume = Math.round(cifValueKrw_Volume * (dutyRate / 100));
        
        const realCostKrw_Volume = baseCostKrw_Volume + dutyKrw_Volume;
        
        const shareText = isLCL ? 
            ((volumeShareRatio * 100).toFixed(1) + '% (R/T)') : 
            (item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '<span style="color:var(--danger);font-size:0.85em">적재량 누락</span>');

        htmlVolume += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${shareText}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(dispAllocatedFC_Volume, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(dispBaseCostFC_Volume, 2)}</td>
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

function generatePrintHTML() {
    const container = document.getElementById('printContainer');
    if (!container) return;

    if (state.doc.items.length === 0) {
        container.innerHTML = '<p style="padding:20px; text-align:center;">견적 내용이 없습니다.</p>';
        return;
    }

    const isLCL = state.doc.shipmentType === 'LCL';
    const printTerms = state.doc.incoterms.slice(0, 3); // 세로 폭을 고려해 최대 3개 조건 표시
    const hasMoreTerms = state.doc.incoterms.length > 3;

    // 1. 사용된 외화 통화 추출 (KRW 제외)
    const usedCurrencies = new Set();
    state.doc.items.forEach(item => {
        state.doc.incoterms.forEach(term => {
            const p = item.prices && item.prices[term];
            if (p && (p.unitPrice || 0) > 0 && p.currency && p.currency !== 'KRW') {
                usedCurrencies.add(p.currency);
            }
        });
    });
    state.doc.forwarders.forEach(fw => {
        (fw.costs || []).forEach(c => {
            if ((c.amount || 0) > 0 && c.currency && c.currency !== 'KRW') {
                const isApplied = state.doc.incoterms.some(t => c.applyTo && c.applyTo[t]);
                if (isApplied) {
                    usedCurrencies.add(c.currency);
                }
            }
        });
    });

    let exRateHtml = '';
    if (usedCurrencies.size > 0) {
        const list = Array.from(usedCurrencies);
        exRateHtml = list.map((curr, idx) => {
            const rate = state.doc.exchangeRates[curr] || 0;
            const isLast = idx === list.length - 1;
            return `<span style="display:inline-block; ${isLast ? '' : 'margin-right:15px;'}"><strong>${curr}:</strong> ₩${formatNum(rate, 2)}</span>`;
        }).join('');
    } else {
        exRateHtml = `<span style="color:#64748b;">KRW 기준 (외화 미사용)</span>`;
    }

    let html = `
        <div style="font-family:'Pretendard', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color:#0f172a; font-size:10px; line-height:1.4;">
            
            <!-- [HEADER] 제목 1(메인 타이틀), 줄바꿈, 제목 2(부제목) - 문서상태 삭제 -->
            <div style="margin-bottom:14px; border-bottom:1.5px solid #cbd5e1; padding-bottom:8px;">
                <h1 style="margin:0; font-size:19px; font-weight:800; color:#0f172a; letter-spacing:-0.5px; line-height:1.2;">
                    포워더 견적 및 실수입원가 산출
                </h1>
                <div style="font-size:12.5px; font-weight:600; color:#334155; margin-top:4px; line-height:1.3;">
                    ${state.doc.title || '무제'}
                </div>
            </div>

            <!-- ──────────────── [1. 기본정보] ──────────────── -->
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin:4px 0 5px 0;">
                1. 기본정보
            </div>
            <table style="width:100%; border-collapse:collapse; margin-bottom:12px; font-size:9.5px;">
                <colgroup>
                    <col style="width:14%;">
                    <col style="width:36%;">
                    <col style="width:14%;">
                    <col style="width:36%;">
                </colgroup>
                <tr>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">견적일자</th>
                    <td style="padding:5px 8px; border:1px solid #e2e8f0;">${state.doc.quoteDate || ''}</td>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">선적 / 규격</th>
                    <td style="padding:5px 8px; border:1px solid #e2e8f0;">${isLCL ? 'LCL (소량화물)' : `FCL (${state.doc.containerType || '20ft'} × ${state.doc.containerQty || 1}대)`}</td>
                </tr>
                <tr>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">출발항 (POL)</th>
                    <td style="padding:5px 8px; border:1px solid #e2e8f0;">${state.doc.pol || '—'}</td>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">도착항 (POD)</th>
                    <td style="padding:5px 8px; border:1px solid #e2e8f0;">${state.doc.pod || '—'}</td>
                </tr>
                <tr>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">적용 환율</th>
                    <td colspan="3" style="padding:5px 8px; border:1px solid #e2e8f0; background:#fffdf5;">
                        ${exRateHtml}
                    </td>
                </tr>
                ${state.doc.remarks ? `
                <tr>
                    <th style="background:#f8fafc; color:#334155; padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">상단 비고</th>
                    <td colspan="3" style="padding:5px 8px; border:1px solid #e2e8f0; white-space:pre-line; color:#334155;">${state.doc.remarks}</td>
                </tr>` : ''}
            </table>

            <!-- ──────────────── [2. 수입 대상 품목 및 인코텀즈 단가] ──────────────── -->
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin:12px 0 5px 0; display:flex; justify-content:space-between; align-items:baseline;">
                <span>2. 수입 대상 품목 및 인코텀즈 단가</span>
                ${hasMoreTerms ? `<span style="font-size:8.5px; color:#ef4444; font-weight:normal;">* 인쇄 지면 폭 제한으로 앞 3개 인코텀즈 조건(${printTerms.join(', ')})만 표시됩니다.</span>` : ''}
            </div>
            <table style="width:100%; border-collapse:collapse; margin-bottom:12px; font-size:9px; table-layout:fixed;">
                <thead>
                    <tr style="background:#f8fafc; color:#334155;">
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:35px; text-align:center; font-weight:600;">No.</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:72px; text-align:center; font-weight:600;">HS CODE</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">품명</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:45px; text-align:center; font-weight:600;">수량</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:30px; text-align:center; font-weight:600;">단위</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:52px; text-align:center; font-weight:600;">총중량(kg)</th>
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:62px; text-align:center; font-weight:600;">${isLCL ? 'CBM / R/T' : '최대적재량'}</th>
                        ${printTerms.map(term => `
                            <th style="padding:5px 3px; border:1px solid #e2e8f0; width:65px; text-align:center; font-weight:600;">단가<br>(${term})</th>
                            <th style="padding:5px 3px; border:1px solid #e2e8f0; width:78px; text-align:center; font-weight:600;">총액<br>(${term})</th>
                        `).join('')}
                        <th style="padding:5px 3px; border:1px solid #e2e8f0; width:75px; text-align:center; font-weight:600;">비고</th>
                    </tr>
                </thead>
                <tbody>
    `;

    let sumQty = 0;
    let sumWeight = 0;
    let sumPerTerm = {};
    printTerms.forEach(t => sumPerTerm[t] = 0);

    state.doc.items.forEach((item, itemIdx) => {
        sumQty += (item.qty || 0);
        sumWeight += (item.weight || 0);

        html += `
            <tr>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600; color:#64748b;">${itemIdx + 1}</td>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center;">${item.hsCode || '—'}</td>
                <td style="padding:4px 4px; border:1px solid #e2e8f0; font-weight:500;">${item.name || ''}</td>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.qty)}</td>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center;">${item.unit || ''}</td>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.weight)}</td>
                <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right;">
                    ${isLCL ? `${formatNum(item.cbm || 0, 2)} / ${formatNum(item.rt || 0, 2)}` : `${formatNum(item.maxLoad)} /대`}
                </td>
        `;

        printTerms.forEach(term => {
            const p = item.prices[term];
            if (p && p.unitPrice > 0) {
                const total = p.unitPrice * (item.qty || 0);
                sumPerTerm[term] += total;
                html += `
                    <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right; font-size:8.5px;">
                        ${p.currency} ${formatNum(p.unitPrice, 2)}
                    </td>
                    <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right; font-size:8.5px; font-weight:500;">
                        ${p.currency} ${formatNum(total, 1)}
                    </td>
                `;
            } else {
                html += `
                    <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">—</td>
                    <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">—</td>
                `;
            }
        });

        html += `
                <td style="padding:4px 4px; border:1px solid #e2e8f0; font-size:8.5px; color:#475569;">${item.remarks || ''}</td>
            </tr>
        `;
    });

    // 품목 합계
    html += `
            <tr style="background:#f8fafc; font-weight:700;">
                <td colspan="3" style="padding:4px; border:1px solid #e2e8f0; text-align:center;">합계</td>
                <td style="padding:4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(sumQty)}</td>
                <td style="padding:4px; border:1px solid #e2e8f0;"></td>
                <td style="padding:4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(sumWeight)} kg</td>
                <td style="padding:4px; border:1px solid #e2e8f0;"></td>
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
        html += `
            <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">—</td>
            <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:right; font-size:8.5px;">
                ${currency ? currency + ' ' : ''}${formatNum(sumVal, 1)}<br>
                <span style="color:#64748b; font-weight:normal;">(₩${formatNum(sumKrw)})</span>
            </td>
        `;
    });
    html += `
                <td style="padding:4px; border:1px solid #e2e8f0;"></td>
            </tr>
        </tbody>
    </table>
    `;

    // ──────────────── [견적 대상 목록 추출] ────────────────
    const targets = [];
    state.doc.forwarders.forEach(fw => {
        state.doc.incoterms.forEach(term => {
            if (!fw.calculated || !fw.calculated[term]) return;
            const calc = fw.calculated[term];
            const invKrw = calc.invoiceKrw || 0;
            const sub = calc.ancillaryKrw || 0;
            const totalOther = calc.otherCostsKrw || 0;
            const grand = calc.totalKrw || 0;

            let oceanKrw = 0, exportKrw = 0, importKrw = 0, insKrw = 0, customsKrw = 0;
            (fw.costs || []).forEach(c => {
                if (c.applyTo && c.applyTo[term]) {
                    const amtKrw = (c.amount || 0) * (c.unitQty || 0) * (state.doc.exchangeRates[c.currency] || 1);
                    const meta = getCostGroupMeta(c);
                    if (meta.grpNo === 2) oceanKrw += amtKrw;
                    else if (meta.grpNo === 3) exportKrw += amtKrw;
                    else if (meta.grpNo === 5) insKrw += amtKrw;
                    else if (meta.grpNo === 6) customsKrw += amtKrw;
                    else importKrw += amtKrw; // grpNo 4
                }
            });

            targets.push({
                fw,
                term,
                title: `${fw.name} (${term})`,
                invKrw,
                oceanKrw,
                exportKrw,
                importKrw,
                insKrw,
                customsKrw,
                sub,
                totalOther,
                grand
            });
        });
    });

    // ──────────────── [3. 비용요약(원화환산) - 세로형 매트릭스 비교 테이블] ────────────────
    // 0원/미입력 항목 제외, 부대비용 소계 제거, 유효 항목 1, 2, 3... 순차 부여 및 4번 상세 번호 동적 연계
    const candidateSummaryRows = [
        { grpKey: 'invoice', isMandatory: true, label: '물품 대금', getVal: t => t.invKrw },
        { grpKey: 'ocean', isMandatory: false, label: '해상운임 (O/F)', getVal: t => t.oceanKrw },
        { grpKey: 'export', isMandatory: false, label: '수출국 부대비용', getVal: t => t.exportKrw },
        { grpKey: 'import', isMandatory: false, label: '수입국 및 물류 부대비용', getVal: t => t.importKrw },
        { grpKey: 'ins', isMandatory: false, label: '적하보험료', getVal: t => t.insKrw },
        { grpKey: 'customs', isMandatory: false, label: '수입 통관수수료', getVal: t => t.customsKrw },
        { grpKey: 'other', isMandatory: false, label: '기타 금융 및 추가 부대비용', getVal: t => t.totalOther }
    ];

    const groupNumberMap = {};
    const activeSummaryRows = [];
    let summarySeq = 1;

    candidateSummaryRows.forEach(row => {
        const hasVal = row.isMandatory || targets.some(t => (row.getVal(t) || 0) > 0);
        if (hasVal) {
            const assignedNo = String(summarySeq++);
            groupNumberMap[row.grpKey] = assignedNo;
            activeSummaryRows.push({
                ...row,
                no: assignedNo
            });
        }
    });

    const grandLabel = summarySeq > 2 ? `총 비용 (KRW) (1~${summarySeq - 1}번 합계)` : '총 비용 (KRW)';
    activeSummaryRows.push({
        no: '—',
        label: grandLabel,
        getVal: t => t.grand,
        isGrand: true
    });

    html += `
        <div style="font-size:11px; font-weight:700; color:#0f172a; margin:14px 0 5px 0;">
            3. 비용요약(원화환산)
        </div>
        <table style="width:100%; border-collapse:collapse; margin-bottom:14px; font-size:9px; table-layout:fixed;">
            <thead>
                <tr style="background:#f8fafc; color:#334155;">
                    <th style="padding:5px 4px; border:1px solid #e2e8f0; text-align:center; width:35px; font-weight:600;">No.</th>
                    <th style="padding:5px 8px; border:1px solid #e2e8f0; text-align:center; width:150px; font-weight:600;">비용 항목 구분</th>
                    ${targets.map(t => `
                        <th style="padding:5px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">
                            ${t.fw.name}<br>
                            <span style="font-size:8.5px; font-weight:normal; color:#475569;">(${t.term})</span>
                        </th>
                    `).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    activeSummaryRows.forEach(row => {
        const trStyle = row.isGrand ? 'background:#f8fafc; font-weight:700; color:#0f172a;' : '';
        const labelStyle = `padding:4px 8px; border:1px solid #e2e8f0; ${row.isGrand ? 'font-weight:700; color:#0f172a;' : 'color:#1e293b;'}`;
        const noStyle = `padding:4px 8px; border:1px solid #e2e8f0; text-align:center; font-weight:700; ${row.isGrand ? 'color:#0f172a;' : 'color:#64748b;'}`;

        html += `<tr style="${trStyle}">`;
        html += `<td style="${noStyle}">${row.no}</td>`;
        html += `<td style="${labelStyle}">${row.label}</td>`;
        targets.forEach(t => {
            const val = row.getVal(t);
            const cellStyle = `padding:4px 8px; border:1px solid #e2e8f0; text-align:right; ${row.isGrand ? 'font-weight:700; font-size:9.5px; color:#0f172a;' : ''}`;
            let text = '—';
            if (row.isGrand || row.grpKey === 'invoice') {
                text = `₩${formatNum(val)}`;
            } else if (val > 0) {
                text = `₩${formatNum(val)}`;
            }
            html += `<td style="${cellStyle}">${text}</td>`;
        });
        html += `</tr>`;
    });

    html += `
            </tbody>
        </table>
    `;

    // ──────────────── [4. 포워더별 수입 부대비용 산출] ────────────────
    // (표가 중간에 자연스럽게 나누어져 이어지도록 설정: 행 단위 절단 방지 + 2페이지 상단 헤더 자동 반복)
    html += `
        <div style="font-size:11px; font-weight:700; color:#0f172a; margin:14px 0 5px 0; break-after:avoid; page-break-after:avoid;">
            4. 포워더별 수입 부대비용 산출 (실제 발생 항목)
        </div>
    `;

    if (targets.length === 1) {
        // 단일 견적: 기존과 동일하게 상세 8개 컬럼(No, 부대비용 항목명, 비용구분, 외화단가, 수량/단위, 환율, 원화환산액, 비고) 표시
        const t = targets[0];
        const validCosts = (t.fw.costs || []).filter(c => c.applyTo && c.applyTo[t.term] && (c.amount || 0) > 0);
        validCosts.sort((a, b) => getCostGroupMeta(a).sortOrder - getCostGroupMeta(b).sortOrder);
        const groupCounters = {};

        html += `
            <div style="margin-bottom:12px;">
                <div style="font-weight:700; font-size:9.5px; color:#1e293b; background:#f8fafc; padding:4px 8px; border:1px solid #e2e8f0; border-bottom:none; break-after:avoid; page-break-after:avoid;">
                    ■ ${t.fw.name} — ${t.term} 조건 부대비용 명세 (${validCosts.length}건)
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:9px; table-layout:fixed;">
                    <thead style="display:table-header-group;">
                        <tr style="background:#f8fafc; color:#334155; page-break-inside:avoid; break-inside:avoid;">
                            <th style="padding:4px 3px; border:1px solid #e2e8f0; width:35px; text-align:center; font-weight:600;">No.</th>
                            <th style="padding:4px 5px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">부대비용 항목명</th>
                            <th style="padding:4px 3px; border:1px solid #e2e8f0; width:70px; text-align:center; font-weight:600;">비용 구분</th>
                            <th style="padding:4px 5px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">외화 단가</th>
                            <th style="padding:4px 3px; border:1px solid #e2e8f0; width:65px; text-align:center; font-weight:600;">수량 / 단위</th>
                            <th style="padding:4px 5px; border:1px solid #e2e8f0; width:85px; text-align:center; font-weight:600;">적용 환율</th>
                            <th style="padding:4px 5px; border:1px solid #e2e8f0; width:95px; text-align:center; font-weight:bold;">원화 환산액 (KRW)</th>
                            <th style="padding:4px 5px; border:1px solid #e2e8f0; width:100px; text-align:center; font-weight:600;">비고</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (validCosts.length === 0) {
            html += `
                <tr style="page-break-inside:avoid; break-inside:avoid;">
                    <td colspan="8" style="padding:8px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">
                        입력된 부대비용이 없거나 0원입니다.
                    </td>
                </tr>
            `;
        } else {
            let fwTermSubtotal = 0;
            validCosts.forEach(c => {
                const exRate = state.doc.exchangeRates[c.currency] || 1;
                const amtKrw = (c.amount || 0) * (c.unitQty || 1) * exRate;
                fwTermSubtotal += amtKrw;

                const meta = getCostGroupMeta(c);
                const catNo = groupNumberMap[meta.grpKey] || meta.grpNo || '4';
                groupCounters[catNo] = (groupCounters[catNo] || 0) + 1;
                const costNo = `${catNo}-${groupCounters[catNo]}`;

                html += `
                    <tr style="page-break-inside:avoid; break-inside:avoid;">
                        <td style="padding:3px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600; color:#64748b;">${costNo}</td>
                        <td style="padding:3px 5px; border:1px solid #e2e8f0; font-weight:500;">${c.label}</td>
                        <td style="padding:3px 3px; border:1px solid #e2e8f0; text-align:center; color:#64748b;">[${catNo}] ${meta.label}</td>
                        <td style="padding:3px 5px; border:1px solid #e2e8f0; text-align:right;">${c.currency} ${formatNum(c.amount, 2)}</td>
                        <td style="padding:3px 3px; border:1px solid #e2e8f0; text-align:center;">${c.unitQty || 1} ${c.unit || ''}</td>
                        <td style="padding:3px 5px; border:1px solid #e2e8f0; text-align:right; color:#64748b;">₩${formatNum(exRate, 1)}</td>
                        <td style="padding:3px 5px; border:1px solid #e2e8f0; text-align:right; font-weight:600;">₩${formatNum(amtKrw)}</td>
                        <td style="padding:3px 5px; border:1px solid #e2e8f0; color:#64748b;">${c.remarks || ''}</td>
                    </tr>
                `;
            });

            html += `
                        <tr style="background:#f8fafc; font-weight:700; page-break-inside:avoid; break-inside:avoid;">
                            <td colspan="6" style="padding:4px; border:1px solid #e2e8f0; text-align:center;">
                                ${t.fw.name} (${t.term}) 부대비용 합계
                            </td>
                            <td style="padding:4px 5px; border:1px solid #e2e8f0; text-align:right; color:#0f172a;">
                                ₩${formatNum(fwTermSubtotal)}
                            </td>
                            <td style="padding:4px 5px; border:1px solid #e2e8f0;"></td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `;
        }
    } else {
        // 복수 견적 (2개 이상): 하나의 통합 테이블에서 우측에 열(컬럼)이 추가되어 가로로 한눈에 비교
        const itemMap = new Map();
        targets.forEach(t => {
            (t.fw.costs || []).forEach(c => {
                if (c.applyTo && c.applyTo[t.term] && (c.amount || 0) > 0) {
                    const itemKey = c.key || c.label;
                    if (!itemMap.has(itemKey)) {
                        const meta = getCostGroupMeta(c);
                        const catNo = groupNumberMap[meta.grpKey] || meta.grpNo || '4';
                        itemMap.set(itemKey, {
                            key: itemKey,
                            label: c.label,
                            catNo: catNo,
                            groupLabel: `[${catNo}] ${meta.label}`,
                            sortOrder: meta.sortOrder
                        });
                    }
                }
            });
        });

        const sortedItems = Array.from(itemMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
        const groupCounters = {};
        sortedItems.forEach(item => {
            groupCounters[item.catNo] = (groupCounters[item.catNo] || 0) + 1;
            item.costNo = `${item.catNo}-${groupCounters[item.catNo]}`;
        });

        html += `
            <div style="margin-bottom:12px;">
                <div style="font-weight:700; font-size:9.5px; color:#1e293b; background:#f8fafc; padding:4px 8px; border:1px solid #e2e8f0; border-bottom:none; break-after:avoid; page-break-after:avoid;">
                    ■ 포워더별 부대비용 비교 명세 (${targets.map(t => `${t.fw.name}(${t.term})`).join(', ')})
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:9px; table-layout:fixed;">
                    <thead style="display:table-header-group;">
                        <tr style="background:#f8fafc; color:#334155; page-break-inside:avoid; break-inside:avoid;">
                            <th style="padding:4px 3px; border:1px solid #e2e8f0; width:35px; text-align:center; font-weight:600;">No.</th>
                            <th style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center; width:140px; font-weight:600;">부대비용 항목명</th>
                            <th style="padding:4px 3px; border:1px solid #e2e8f0; width:65px; text-align:center; font-weight:600;">비용 구분</th>
                            ${targets.map(t => `
                                <th style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">
                                    ${t.fw.name}<br>
                                    <span style="font-size:8.5px; font-weight:normal; color:#475569;">(${t.term})</span>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (itemMap.size === 0) {
            html += `
                <tr style="page-break-inside:avoid; break-inside:avoid;">
                    <td colspan="${3 + targets.length}" style="padding:8px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">
                        입력된 부대비용이 없거나 0원입니다.
                    </td>
                </tr>
                </tbody>
            </table>
        </div>
            `;
        } else {
            sortedItems.forEach(item => {
                html += `
                    <tr style="page-break-inside:avoid; break-inside:avoid;">
                        <td style="padding:3px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600; color:#64748b;">${item.costNo}</td>
                        <td style="padding:3px 6px; border:1px solid #e2e8f0; font-weight:500;">${item.label}</td>
                        <td style="padding:3px 3px; border:1px solid #e2e8f0; text-align:center; color:#64748b;">${item.groupLabel}</td>
                `;

                targets.forEach(t => {
                    const c = (t.fw.costs || []).find(cost =>
                        (cost.key === item.key || cost.label === item.label) &&
                        cost.applyTo && cost.applyTo[t.term] && (cost.amount || 0) > 0
                    );

                    if (c) {
                        const exRate = state.doc.exchangeRates[c.currency] || 1;
                        const amtKrw = (c.amount || 0) * (c.unitQty || 1) * exRate;
                        html += `
                            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:right;">
                                <strong>₩${formatNum(amtKrw)}</strong><br>
                                <span style="font-size:8px; color:#64748b; font-weight:normal;">${c.currency} ${formatNum(c.amount, 2)} (${c.unitQty || 1}${c.unit ? ' ' + c.unit : ''})</span>
                            </td>
                        `;
                    } else {
                        html += `
                            <td style="padding:3px 6px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">—</td>
                        `;
                    }
                });

                html += `</tr>`;
            });

            // 합계 행 (테이블 맨 마지막 행에서 1회만 출력되도록 tbody 끝에 배치)
            html += `
                        <tr style="background:#f8fafc; font-weight:700; page-break-inside:avoid; break-inside:avoid;">
                            <td colspan="3" style="padding:5px 8px; border:1px solid #e2e8f0; text-align:center; color:#0f172a;">
                                부대비용 합계
                            </td>
            `;
            targets.forEach(t => {
                const subTotal = t.fw.calculated[t.term].ancillaryKrw || 0;
                html += `
                    <td style="padding:5px 6px; border:1px solid #e2e8f0; text-align:right; font-weight:700; color:#0f172a;">
                        ₩${formatNum(subTotal)}
                    </td>
                `;
            });
            html += `
                        </tr>
                    </tbody>
                </table>
            </div>
            `;
        }
    }

    // ──────────────── [5. 기타 금융 및 추가 부대비용] ────────────────
    const calculatedCosts = (state.doc.otherCosts || []).filter(oc =>
        oc.type === 'calculated' && (oc.interestRate || 0) > 0 && (oc.durationMonths || 0) > 0
    );
    const manualCosts = (state.doc.otherCosts || []).filter(oc =>
        oc.type === 'manual' && (oc.amount || 0) > 0
    );
    const hasOtherCosts = calculatedCosts.length > 0 || manualCosts.length > 0;

    if (hasOtherCosts) {
        const otherCatNo = groupNumberMap['other'] || '5';
        html += `
            <div style="font-size:11px; font-weight:700; color:#0f172a; margin:14px 0 5px 0;">
                5. 기타 금융 및 추가 부대비용
            </div>
        `;

        // 5-1. 금융비용 (자동산출 조건 및 내역)
        if (calculatedCosts.length > 0) {
            calculatedCosts.forEach(oc => {
                const duration = oc.durationMonths || 0;
                const colDays = oc.collectionDays || 0;
                const rate = oc.interestRate || 0;
                const avgMonths = ((duration + 1) / 2) + (colDays / 30);

                html += `
                    <div style="margin-bottom:10px; border:1px solid #e2e8f0; background:#fff; page-break-inside:avoid; break-inside:avoid;">
                        <div style="background:#f8fafc; padding:5px 8px; font-weight:700; font-size:9.5px; border-bottom:1px solid #e2e8f0; color:#0f172a;">
                            ■ [${otherCatNo}-1] 금융비용 (이자비용) 산출 조건 및 산출액
                        </div>
                        <div style="padding:5px 8px; font-size:9px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:16px; flex-wrap:wrap;">
                            <div>사업기간: <strong>${duration}개월</strong></div>
                            <div>연 이자율: <strong>${rate}%</strong></div>
                            <div>대금회수: <strong>${colDays}일</strong></div>
                            <div>평균 자금묶임기간: <strong>${avgMonths.toFixed(2)}개월</strong> <span style="font-size:8px; color:#64748b;">( = ((사업기간+1)/2) + (대금회수/30) )</span></div>
                        </div>
                        <table style="width:100%; border-collapse:collapse; font-size:9px;">
                            <thead>
                                <tr style="background:#f8fafc; color:#334155;">
                                    <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">포워더 / 조건</th>
                                    <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">적용 원금 (물품대금 + 부대비용)</th>
                                    <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">산출 공식</th>
                                    <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; font-weight:bold; width:120px;">산출 금융비용 (KRW)</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                state.doc.forwarders.forEach(fw => {
                    state.doc.incoterms.forEach(term => {
                        if (!fw.calculated || !fw.calculated[term]) return;
                        const calc = fw.calculated[term];
                        const principal = (calc.invoiceKrw || 0) + (calc.ancillaryKrw || 0);
                        const interestAmt = Math.round(principal * (avgMonths / 12) * (rate / 100));

                        html += `
                            <tr>
                                <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center; font-weight:500;">
                                    ${fw.name} (${term})
                                </td>
                                <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:right;">
                                    ₩${formatNum(principal)}
                                </td>
                                <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center; color:#64748b; font-size:8.5px;">
                                    원금 × (${avgMonths.toFixed(2)}/12) × ${rate}%
                                </td>
                                <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:right; font-weight:700; background:#f8fafc;">
                                    ₩${formatNum(interestAmt)}
                                </td>
                            </tr>
                        `;
                    });
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            });
        }

        // 5-2. 수동 추가 부대비용
        if (manualCosts.length > 0) {
            html += `
                <div style="margin-bottom:12px; border:1px solid #e2e8f0; background:#fff; page-break-inside:avoid; break-inside:avoid;">
                    <div style="background:#f8fafc; padding:5px 8px; font-weight:700; font-size:9.5px; border-bottom:1px solid #e2e8f0; color:#0f172a;">
                        ■ [${otherCatNo}-2] 기타 추가 부대비용 명세
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:9px;">
                        <thead>
                            <tr style="background:#f1f5f9; color:#334155;">
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:35px; text-align:center; font-weight:600;">No.</th>
                                <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">항목명</th>
                                <th style="padding:4px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">구분</th>
                                <th style="padding:4px; border:1px solid #e2e8f0; text-align:center; width:120px; font-weight:600;">금액 (KRW)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            let manualTotal = 0;
            manualCosts.forEach((oc, mIdx) => {
                manualTotal += (oc.amount || 0);
                const costNo = `${otherCatNo}-${calculatedCosts.length + mIdx + 1}`;
                html += `
                    <tr>
                        <td style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600; color:#64748b;">${costNo}</td>
                        <td style="padding:4px 6px; border:1px solid #e2e8f0; font-weight:500;">${oc.name}</td>
                        <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center; color:#64748b;">수동 추가</td>
                        <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:right; font-weight:600;">₩${formatNum(oc.amount)}</td>
                    </tr>
                `;
            });

            html += `
                        <tr style="background:#f8fafc; font-weight:700;">
                            <td colspan="3" style="padding:4px 6px; border:1px solid #e2e8f0; text-align:center;">추가비용 합계</td>
                            <td style="padding:4px 6px; border:1px solid #e2e8f0; text-align:right;">₩${formatNum(manualTotal)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `;
        }
    }

    // ──────────────── [대상 품목 실제 수입 원가 산출] ────────────────
    const costSectionNum = hasOtherCosts ? '6' : '5';
    html += `
        <div style="font-size:11px; font-weight:700; color:#0f172a; margin:14px 0 5px 0;">
            ${costSectionNum}. 대상 품목 실제 수입 원가 산출
        </div>
    `;

    state.doc.forwarders.forEach((fw) => {
        state.doc.incoterms.forEach(term => {
            if (!fw.calculated || !fw.calculated[term]) return;
            const calc = fw.calculated[term];
            const totalAncillaryKrw = calc.ancillaryKrw + (calc.otherCostsKrw || 0);
            const totalDutiableAncillaryKrw = calc.dutiableAncillaryKrw || 0;
            const totalInvoiceKrw = calc.invoiceKrw || 0;

            // 적재비율 / 운임톤 기준 계산
            let totalModulus = 0;
            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (p && p.unitPrice > 0) {
                    if (isLCL) totalModulus += (item.rt || 0);
                    else if (item.maxLoad > 0) totalModulus += (item.qty / item.maxLoad);
                }
            });

            html += `
                <div style="margin-bottom:12px; page-break-inside:avoid; break-inside:avoid;">
                    <div style="font-weight:700; font-size:9.5px; color:#1e293b; margin-bottom:2px;">
                        ■ ${fw.name} - ${term} 조건
                    </div>

                    <!-- 컨테이너 적재비율(부피/체적) 배분법 (기본 필수) -->
                    <div style="font-size:9px; color:#475569; font-weight:600; margin:2px 0;">
                        (1) ${isLCL ? 'LCL 체적/운임톤(R/T) 배분법' : '컨테이너 적재비율 배분법 (부피/무게 기준)'}
                    </div>
                    <table style="width:100%; border-collapse:collapse; margin-bottom:6px; font-size:9px; table-layout:fixed;">
                        <thead>
                            <tr style="background:#f8fafc; color:#0f172a;">
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">품명</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:50px; text-align:center; font-weight:600;">수량</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:65px; text-align:center; font-weight:600;">점유율</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">단위당 단가</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">배분 부대비용</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">실수입원가(외화)</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:75px; text-align:center; font-weight:600;">관세(KRW)</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:95px; text-align:center; background:#f1f5f9; font-weight:bold;">최종 원가(KRW)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (!p || !p.unitPrice || p.unitPrice === 0) {
                    html += `
                        <tr>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0;">${item.name}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.qty)}</td>
                            <td colspan="6" style="padding:3px 4px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">해당 조건 단가 없음</td>
                        </tr>
                    `;
                    return;
                }

                const unitPriceFC = p.unitPrice;
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                const dutyRate = item.dutyRate || 0;

                let allocatedFC_Volume_Total = 0;
                let allocatedFC_Volume_Dutiable = 0;
                let volumeShareRatio = 0;

                if (totalModulus > 0 && item.qty > 0) {
                    if (isLCL) volumeShareRatio = (item.rt || 0) / totalModulus;
                    else if (item.maxLoad > 0) volumeShareRatio = (item.qty / item.maxLoad) / totalModulus;

                    const itemTotalAncillaryKrw = totalAncillaryKrw * volumeShareRatio;
                    const itemDutiableAncillaryKrw = totalDutiableAncillaryKrw * volumeShareRatio;
                    allocatedFC_Volume_Total = (itemTotalAncillaryKrw / exRate) / item.qty;
                    allocatedFC_Volume_Dutiable = (itemDutiableAncillaryKrw / exRate) / item.qty;
                }

                const dispAllocatedFC = Math.round(allocatedFC_Volume_Total * 100) / 100;
                const dispBaseCostFC = Math.round((unitPriceFC + dispAllocatedFC) * 100) / 100;
                const baseCostKrw = Math.round(dispBaseCostFC * exRate);

                const dispDutiableAllocated = Math.round(allocatedFC_Volume_Dutiable * 100) / 100;
                const cifValueKrw = Math.round((unitPriceFC + dispDutiableAllocated) * exRate);
                const dutyKrw = Math.round(cifValueKrw * (dutyRate / 100));
                const realCostKrw = baseCostKrw + dutyKrw;

                const shareText = isLCL ? `${(volumeShareRatio * 100).toFixed(1)}%` : (item.maxLoad > 0 ? `${(volumeShareRatio * 100).toFixed(1)}%` : '누락');

                html += `
                    <tr>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; font-weight:500;">${item.name}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.qty)}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; color:#64748b;">${shareText}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${p.currency} ${formatNum(dispAllocatedFC, 2)}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; font-weight:500;">${p.currency} ${formatNum(dispBaseCostFC, 2)}</td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; color:#475569;">₩${formatNum(dutyKrw)} <span style="font-size:8px;">(${dutyRate}%)</span></td>
                        <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; font-weight:700; background:#f8fafc; color:#0f172a;">₩${formatNum(realCostKrw)}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                    </table>
            `;

            // 가치비례 배분법: state.doc.showValueAlloc 이 활성화된 경우에만 출력
            if (state.doc.showValueAlloc) {
                const allocationRatio = totalInvoiceKrw > 0 ? (totalAncillaryKrw / totalInvoiceKrw) : 0;
                const dutiableAllocationRatio = totalInvoiceKrw > 0 ? (totalDutiableAncillaryKrw / totalInvoiceKrw) : 0;

                html += `
                    <div style="font-size:9px; color:#475569; font-weight:600; margin:4px 0 2px 0;">
                        (2) 가치비례 배분법 (가액 기준)
                    </div>
                    <table style="width:100%; border-collapse:collapse; margin-bottom:6px; font-size:9px; table-layout:fixed;">
                        <thead>
                            <tr style="background:#f8fafc; color:#0f172a;">
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; text-align:center; font-weight:600;">품명</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:50px; text-align:center; font-weight:600;">수량</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:65px; text-align:center; font-weight:600;">배분비율</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">단위당 단가</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">배분 부대비용</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:80px; text-align:center; font-weight:600;">실수입원가(외화)</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:75px; text-align:center; font-weight:600;">관세(KRW)</th>
                                <th style="padding:4px 3px; border:1px solid #e2e8f0; width:95px; text-align:center; background:#f1f5f9; font-weight:bold;">최종 원가(KRW)</th>
                            </tr>
                        </thead>
                        <tbody>
                `;

                state.doc.items.forEach(item => {
                    const p = item.prices[term];
                    if (!p || !p.unitPrice || p.unitPrice === 0) {
                        html += `
                            <tr>
                                <td style="padding:3px 4px; border:1px solid #e2e8f0;">${item.name}</td>
                                <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.qty)}</td>
                                <td colspan="6" style="padding:3px 4px; border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">해당 조건 단가 없음</td>
                            </tr>
                        `;
                        return;
                    }

                    const unitPriceFC = p.unitPrice;
                    const exRate = state.doc.exchangeRates[p.currency] || 1;
                    const dutyRate = item.dutyRate || 0;

                    const allocatedFC_Total = unitPriceFC * allocationRatio;
                    const allocatedFC_Dutiable = unitPriceFC * dutiableAllocationRatio;

                    const dispAllocatedFC = Math.round(allocatedFC_Total * 100) / 100;
                    const dispBaseCostFC = Math.round((unitPriceFC + dispAllocatedFC) * 100) / 100;
                    const baseCostKrw = Math.round(dispBaseCostFC * exRate);

                    const dispDutiableAllocated = Math.round(allocatedFC_Dutiable * 100) / 100;
                    const cifValueKrw = Math.round((unitPriceFC + dispDutiableAllocated) * exRate);
                    const dutyKrw = Math.round(cifValueKrw * (dutyRate / 100));
                    const realCostKrw = baseCostKrw + dutyKrw;

                    html += `
                        <tr>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; font-weight:500;">${item.name}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${formatNum(item.qty)}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; color:#64748b;">${(allocationRatio * 100).toFixed(1)}%</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right;">${p.currency} ${formatNum(dispAllocatedFC, 2)}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; font-weight:500;">${p.currency} ${formatNum(dispBaseCostFC, 2)}</td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; color:#475569;">₩${formatNum(dutyKrw)} <span style="font-size:8px;">(${dutyRate}%)</span></td>
                            <td style="padding:3px 4px; border:1px solid #e2e8f0; text-align:right; font-weight:700; background:#f8fafc; color:#0f172a;">₩${formatNum(realCostKrw)}</td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                `;
            }

            html += `</div>`;
        });
    });

    html += `</div>`; // End container wrapper

    container.innerHTML = html;
}


function generateExcelHTML() {
    
    

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
                    포워더 견적 및 실수입원가 산출 (${state.doc.title || ''})
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
                    ${p.currency || ''} ${formatNum(p.unitPrice, 2)}<br>
                    <span style="color:#555;">(총액 ${p.currency || ''} ${formatNum(total, 2)})</span>
                </td>`;
            } else {
                html += `<td style="text-align:center; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#aaa;">—</td>`;
            }
        });

        if (remainingCols > 0) {
            html += `<td colspan="${remainingCols}" style="padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.remarks || ''}</td>`;
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
            <span style="font-weight:bold; font-size:11px;">${currency} ${formatNum(sumVal, 2)}</span><br>
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

    
    // 3-5. 포워더별 상세 내역 (엑셀 전용)
    html += `
        <tr><td colspan="10" style="border:none; height:20px;"></td></tr>
        <tr>
            <th colspan="10" style="font-size:15px; color:#203864; text-align:left; padding:10px 0 5px 0; border-bottom:2px solid #203864; background:white;">
                3. 포워더별 수입 부대비용 산출 (상세내역)
            </th>
        </tr>
    `;

    state.doc.forwarders.forEach(fw => {
        html += `
            <tr>
                <th colspan="10" style="text-align:left; background:#e2e8f0; font-weight:bold; padding:6px; border:1px solid #ccc;">
                    ▶ ${fw.name}
                </th>
            </tr>
            <tr>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">비용 그룹</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">비용 항목명</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">단가</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">통화</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">단위</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">수량</th>
                <th style="background:#f1f5f9; border:1px solid #ccc; padding:6px;">합계(외화)</th>
        `;
        
        let incotermsCount = state.doc.incoterms.length;
        state.doc.incoterms.forEach(term => {
            html += `<th style="background:#e0f2fe; border:1px solid #ccc; padding:6px;">${term} 적용액(KRW)</th>`;
        });
        
        // Fill remaining cols to reach 10 if necessary
        let usedCols = 7 + incotermsCount;
        let emptyCols = 10 - usedCols;
        if (emptyCols > 0) {
            html += `<th colspan="${emptyCols}" style="background:#f1f5f9; border:1px solid #ccc;"></th>`;
        } else if (emptyCols < 0) {
            // Excel can extend beyond 10 cols, that's fine.
        }
        
        html += `</tr>`;

        fw.costs.forEach(c => {
            let groupName = '수입국 부대비용';
            if (c.group === 'ocean') groupName = '해상운임';
            else if (c.group === 'export') groupName = '수출국 부대비용';
            else if (c.key === 'INS' || c.key === 'CUST_I') groupName = '적하보험 및 수입통관';

            const totalFC = (c.amount || 0) * (c.unitQty || 0);
            const exRate = state.doc.exchangeRates[c.currency] || 1;
            const totalKrwBase = totalFC * exRate;

            html += `
                <tr>
                    <td style="border:1px solid #ccc; padding:6px; text-align:center;">${groupName}</td>
                    <td style="border:1px solid #ccc; padding:6px;">${c.label}</td>
                    <td style="border:1px solid #ccc; padding:6px; text-align:right;">${c.amount}</td>
                    <td style="border:1px solid #ccc; padding:6px; text-align:center;">${c.currency}</td>
                    <td style="border:1px solid #ccc; padding:6px; text-align:center;">${c.unit}</td>
                    <td style="border:1px solid #ccc; padding:6px; text-align:right;">${c.unitQty}</td>
                    <td style="border:1px solid #ccc; padding:6px; text-align:right;">${totalFC}</td>
            `;
            
            state.doc.incoterms.forEach(term => {
                if (c.applyTo[term]) {
                    html += `<td style="border:1px solid #ccc; padding:6px; text-align:right; font-weight:bold; color:#0369a1;">${Math.round(totalKrwBase)}</td>`;
                } else {
                    html += `<td style="border:1px solid #ccc; padding:6px; text-align:center; color:#aaa;">-</td>`;
                }
            });
            
            if (emptyCols > 0) {
                html += `<td colspan="${emptyCols}" style="border:1px solid #ccc; padding:6px;"></td>`;
            }
            
            html += `</tr>`;
        });
        
        // 기타비용, 이자비용 등도 추가
        let manualOtherCosts = 0;
        let interestCost = 0;
        if (state.doc.otherCosts && state.doc.otherCosts.length > 0) {
            html += `
                <tr>
                    <th colspan="10" style="text-align:left; background:#f8fafc; font-weight:bold; padding:6px; border:1px solid #ccc; font-style:italic;">
                        * 기타 추가 부대비용 및 금융비용
                    </th>
                </tr>
            `;
            state.doc.otherCosts.forEach(oc => {
                html += `
                    <tr>
                        <td style="border:1px solid #ccc; padding:6px; text-align:center;">기타비용</td>
                        <td style="border:1px solid #ccc; padding:6px;">${oc.name}</td>
                        <td style="border:1px solid #ccc; padding:6px; text-align:right;">${oc.amount || 0}</td>
                        <td style="border:1px solid #ccc; padding:6px; text-align:center;">KRW</td>
                        <td style="border:1px solid #ccc; padding:6px; text-align:center;">Lump Sum</td>
                        <td style="border:1px solid #ccc; padding:6px; text-align:right;">1</td>
                        <td style="border:1px solid #ccc; padding:6px; text-align:right;">${oc.amount || 0}</td>
                `;
                
                state.doc.incoterms.forEach(term => {
                    let costToApply = oc.amount || 0;
                    if (oc.type === 'calculated' && oc.id === 'interest') {
                        // Recalculate interest for this specific term
                        const invKrw = fw.calculated && fw.calculated[term] ? fw.calculated[term].invoiceKrw : 0;
                        const subKrw = fw.calculated && fw.calculated[term] ? fw.calculated[term].ancillaryKrw : 0;
                        const duration = oc.durationMonths || 0;
                        const colDays = oc.collectionDays || 0;
                        const rate = oc.interestRate || 0;
                        const avgMonths = ((duration + 1) / 2) + (colDays / 30);
                        const principal = invKrw + subKrw;
                        costToApply = principal * (avgMonths / 12) * (rate / 100);
                    }
                    html += `<td style="border:1px solid #ccc; padding:6px; text-align:right; font-weight:bold; color:#0369a1;">${Math.round(costToApply)}</td>`;
                });
                
                if (emptyCols > 0) {
                    html += `<td colspan="${emptyCols}" style="border:1px solid #ccc; padding:6px;"></td>`;
                }
                html += `</tr>`;
            });
        }

    });

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
                        4. 대상 품목 실제 수입원가 산출 - ${fw.name} (${term})
                    </th>
                </tr>
            `;

            // 5-1 가치비례 (토글 활성화 시만)
            if (state.doc.showValueAlloc) {
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
                    const dispAllocatedFC_Value = Math.round(allocatedFC_Value * 100) / 100;
                    const dispRealCostFC_Value = Math.round((unitPriceFC + dispAllocatedFC_Value) * 100) / 100;
                    const realCostKrw_Value = Math.round(dispRealCostFC_Value * exRate);

                    html += `
                        <tr>
                            <td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td>
                            <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${formatNum(item.qty)}</td>
                            <td colspan="2" style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                            <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(dispAllocatedFC_Value, 2)}</td>
                            <td colspan="2" style="text-align:right; font-weight:bold; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(dispRealCostFC_Value, 2)}</td>
                            <td colspan="2" style="text-align:right; font-weight:bold; background:#f2f2f2; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#203864;">₩ ${formatNum(realCostKrw_Value)}</td>
                        </tr>
                    `;
                });
            }

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

                const dispAllocatedFC_Volume = Math.round(allocatedFC_Volume * 100) / 100;
                const dispRealCostFC_Volume = Math.round((unitPriceFC + dispAllocatedFC_Volume) * 100) / 100;
                const realCostKrw_Volume = Math.round(dispRealCostFC_Volume * exRate);

                html += `
                    <tr>
                        <td colspan="2" style="padding:6px; border-bottom:1px dashed #ccc; border-left:1px solid #ccc; border-right:1px solid #ccc; word-break:keep-all;">${item.name}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '누락'}</td>
                        <td colspan="2" style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="text-align:right; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(dispAllocatedFC_Volume, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc;">${p.currency} ${formatNum(dispRealCostFC_Volume, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; background:#f2f2f2; padding:6px; border-bottom:1px dashed #ccc; border-right:1px solid #ccc; color:#203864;">₩ ${formatNum(realCostKrw_Volume)}</td>
                    </tr>
                `;
            });
            html += `<tr><td colspan="10" style="border-top:1px solid #ccc; height:20px; border-left:none; border-right:none; background:white;"></td></tr>`;
        });
    });

    html += `</tbody></table>`;
    return html;
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('엑셀 라이브러리를 불러오지 못했습니다.', true);
        return;
    }
    const htmlStr = generateExcelHTML();
    if (!htmlStr) {
        showToast('엑셀로 내보낼 데이터가 없습니다.', true);
        return;
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlStr;
    const table = tempDiv.querySelector('#exportMasterTable');

    try {
        const wb = XLSX.utils.table_to_book(table, { sheet: "견적및실수입원가", raw: true });
        const dateStr = state.doc.quoteDate ? state.doc.quoteDate.replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
        const title = state.doc.title || 'Untitled';
        XLSX.writeFile(wb, `포워더견적_및_실수입원가산출_${title}_${dateStr}.xlsx`);
    } catch (err) {
        console.error(err);
        showToast('엑셀 변환 중 오류가 발생했습니다.', true);
    }
}
