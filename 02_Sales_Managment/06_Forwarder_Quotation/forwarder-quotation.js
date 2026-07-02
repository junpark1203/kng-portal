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
        containerType: '20ft',
        containerQty: 1,
        exchangeRates: {},
        incoterms: ['EXW', 'FOB'],
        items: [],
        forwarders: [],
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

const UNIT_OPTIONS = ['Lump Sum', 'per Container', 'per B/L', 'per CBM', 'per TON', 'per Unit'];

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

    // 기본정보 입력 이벤트
    ['docTitle', 'docDate', 'docStatus', 'docContainerType', 'docContainerQty', 'docRemarks'].forEach(id => {
        document.getElementById(id).addEventListener('input', e => {
            let key = id.replace('doc', '');
            key = key.charAt(0).toLowerCase() + key.slice(1);
            if (id === 'docContainerQty') state.doc[key] = parseInt(e.target.value) || 1;
            else state.doc[key] = e.target.value;
            
            if (id === 'docContainerQty') {
                updateDefaultCostQuantities();
                renderAllCalculations();
            }
        });
    });

    // 인코텀즈 관리
    document.getElementById('btnAddIncoterm').addEventListener('click', () => {
        const term = prompt('추가할 인코텀즈를 입력하세요 (예: CIF, CFR):');
        if (term && !state.doc.incoterms.includes(term.toUpperCase())) {
            if (state.doc.incoterms.length >= 5) return showToast('인코텀즈는 최대 5개까지만 추가할 수 있습니다.', true);
            state.doc.incoterms.push(term.toUpperCase());
            // 기존 포워더들에 새 인코텀즈 false로 추가
            state.doc.forwarders.forEach(fw => {
                fw.costs.forEach(c => c.applyTo[term.toUpperCase()] = false);
            });
            renderIncoterms();
            renderItems();
            renderForwarderContent();
        }
    });

    // 품목 추가
    document.getElementById('btnAddItem').addEventListener('click', () => {
        const prices = {};
        state.doc.incoterms.forEach(term => prices[term] = { unitPrice: 0, currency: 'USD' });
        state.doc.items.push({ hsCode: '', name: '', qty: 1, unit: 'EA', weight: 0, maxLoad: 0, prices });
        renderItems();
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
        
        // 기본 부대비용 생성
        const costs = DEFAULT_COSTS.map(c => {
            const applyTo = {};
            state.doc.incoterms.forEach(term => {
                applyTo[term] = c.applyTo[term] || false;
            });
            let qty = 1;
            if (c.defaultUnit === 'per Container') qty = state.doc.containerQty || 1;
            
            return {
                key: c.key,
                label: c.label,
                amount: 0,
                currency: c.key === 'INS' || c.key.includes('I') || c.key.includes('WHFG') || c.key.includes('TSF') || c.key.includes('PSMF') || c.key.includes('DOC') || c.key.includes('STRIP') ? 'KRW' : 'USD', // 수입국 비용은 대개 원화
                unit: c.defaultUnit,
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
    
    // 실수입원가 선택
    document.getElementById('costResultSelector').addEventListener('change', renderCostResultTable);
}

function updateDefaultCostQuantities() {
    const cQty = state.doc.containerQty || 1;
    state.doc.forwarders.forEach(fw => {
        fw.costs.forEach(c => {
            if (c.unit === 'per Container') {
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
        state.activeForwarderIdx = 0;
        
        // 폼 채우기
        document.getElementById('docTitle').value = data.title;
        document.getElementById('docDate').value = data.quoteDate;
        document.getElementById('docStatus').value = data.status;
        document.getElementById('docContainerType').value = data.containerType;
        document.getElementById('docContainerQty').value = data.containerQty;
        document.getElementById('docRemarks').value = data.remarks;
        
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
        containerType: '20ft',
        containerQty: 1,
        exchangeRates: { ...state.rates },
        incoterms: ['EXW', 'FOB'],
        items: [],
        forwarders: [],
        remarks: ''
    };
    state.activeForwarderIdx = 0;
    
    document.getElementById('docTitle').value = '';
    document.getElementById('docDate').value = state.doc.quoteDate;
    document.getElementById('docStatus').value = 'draft';
    document.getElementById('docContainerType').value = '20ft';
    document.getElementById('docContainerQty').value = '1';
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
                ${idx > 0 ? `<button class="btn-remove" onclick="removeIncoterm('${term}')"><i class='bx bx-x'></i></button>` : ''}
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
    // 헤더 재생성
    const thead = document.getElementById('itemTableHead');
    let thHtml = `
        <th>HS CODE</th>
        <th>품명</th>
        <th class="col-num" style="width: 80px;">수량</th>
        <th style="width: 80px;">단위</th>
        <th class="col-num" style="width: 100px;">총중량(kg)</th>
        <th class="col-num" style="width: 110px;">최대적재량<br><span style="font-weight:normal;font-size:10px;">(Max/CNTR)</span></th>
    `;
    state.doc.incoterms.forEach(term => {
        thHtml += `<th class="col-num" style="width: 150px;">${term} 단가</th>`;
    });
    thHtml += `<th class="col-action">삭제</th>`;
    thead.innerHTML = thHtml;

    // 바디 재생성
    const tbody = document.getElementById('itemTableBody');
    if (state.doc.items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${7 + state.doc.incoterms.length}" style="text-align:center;">등록된 품목이 없습니다.</td></tr>`;
        renderItemFooter();
        renderAllCalculations();
        return;
    }

    let bHtml = '';
    state.doc.items.forEach((item, idx) => {
        bHtml += `
            <tr>
                <td><input type="text" value="${item.hsCode}" onchange="updateItem(${idx}, 'hsCode', this.value)"></td>
                <td><input type="text" value="${item.name}" onchange="updateItem(${idx}, 'name', this.value)"></td>
                <td><input type="number" value="${item.qty}" min="1" class="col-num" oninput="updateItem(${idx}, 'qty', this.value)"></td>
                <td><input type="text" value="${item.unit}" onchange="updateItem(${idx}, 'unit', this.value)"></td>
                <td><input type="number" value="${item.weight}" min="0" class="col-num" oninput="updateItem(${idx}, 'weight', this.value)"></td>
                <td><input type="number" value="${item.maxLoad || 0}" min="0" class="col-num" oninput="updateItem(${idx}, 'maxLoad', this.value)"></td>
        `;
        
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
    if (field === 'qty' || field === 'weight' || field === 'maxLoad') state.doc.items[idx][field] = parseFloat(val) || 0;
    else state.doc.items[idx][field] = val;
    if (field === 'qty' || field === 'maxLoad') {
        renderItemFooter();
        renderAllCalculations();
    }
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
    renderItems();
};

function renderItemFooter() {
    const tfoot = document.getElementById('itemTableFoot');
    if (state.doc.items.length === 0) {
        tfoot.innerHTML = '';
        return;
    }
    
    let totalQty = 0;
    let totalWeight = 0;
    const totalsByTerm = {};
    state.doc.incoterms.forEach(t => totalsByTerm[t] = { USD: 0, CNY: 0, EUR: 0, JPY: 0, KRW: 0 });
    
    state.doc.items.forEach(item => {
        totalQty += (item.qty || 0);
        totalWeight += (item.weight || 0);
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
            <td class="col-num">${formatNum(totalWeight)} kg</td>
            <td></td>
    `;
    
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
                <td><input type="number" class="col-num fw-cost-input" value="${c.unitQty}" min="1" oninput="updateCost(${idx}, 'unitQty', this.value)" ${isAuto?'readonly':''}></td>
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
// 전체 요약 계산 (Summary) & 원가 산출
// ─────────────────────────────────────────────────────────────
function renderAllCalculations() {
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
        subtotal: { label: '부대비용 합계 (KRW)', values: [], isTotal: true },
        grandtotal: { label: '총 비용 (물품+부대) KRW', values: [], isGrand: true }
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
            rows.grandtotal.values.push(invKrw + sub);
            
            // 데이터 속성 저장을 위해 state에 결과 캐싱 (원가 산출에서 사용)
            if (!fw.calculated) fw.calculated = {};
            fw.calculated[term] = {
                invoiceKrw: invKrw,
                ancillaryKrw: sub,
                totalKrw: invKrw + sub
            };
        });
    });

    let bHtml = '';
    Object.keys(rows).forEach(key => {
        const r = rows[key];
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
        tbodyValue.innerHTML = '<tr><td colspan="6" style="text-align:center;">선택된 조건이 없거나 품목이 없습니다.</td></tr>';
        tbodyVolume.innerHTML = '<tr><td colspan="6" style="text-align:center;">선택된 조건이 없거나 품목이 없습니다.</td></tr>';
        return;
    }
    
    const [fIdxStr, term] = selVal.split('_');
    const fw = state.doc.forwarders[parseInt(fIdxStr)];
    
    if (!fw || !fw.calculated || !fw.calculated[term]) return;
    
    const calc = fw.calculated[term];
    const totalAncillaryKrw = calc.ancillaryKrw;
    const totalInvoiceKrw = calc.invoiceKrw;
    
    // --- 5-1. 가치비례 배분법 렌더링 ---
    const allocationRatio = totalInvoiceKrw > 0 ? (totalAncillaryKrw / totalInvoiceKrw) : 0;
    let htmlValue = '';
    
    // --- 5-2. 컨테이너 적재비율 배분법 사전 계산 ---
    let totalContainers = 0;
    state.doc.items.forEach(item => {
        const p = item.prices[term];
        // 단가가 없는(렌더링에서 제외되는) 품목은 부대비용 분배 모수에서도 제외
        if (p && p.unitPrice > 0 && item.maxLoad > 0) {
            totalContainers += (item.qty / item.maxLoad);
        }
    });
    let htmlVolume = '';

    state.doc.items.forEach(item => {
        const p = item.prices[term];
        if (!p || !p.unitPrice || p.unitPrice === 0) {
            htmlValue += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="4" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            htmlVolume += `<tr><td>${item.name}</td><td class="col-num">${item.qty}</td><td colspan="4" style="text-align:center; color:var(--text-tertiary)">해당 인코텀즈 단가 없음</td></tr>`;
            return;
        }
        
        const unitPriceFC = p.unitPrice;
        const exRate = state.doc.exchangeRates[p.currency] || 1;
        
        // --- 5-1 로직 ---
        const allocatedFC_Value = unitPriceFC * allocationRatio;
        const realCostFC_Value = unitPriceFC + allocatedFC_Value;
        const realCostKrw_Value = realCostFC_Value * exRate;
        
        htmlValue += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${formatNum(item.qty)}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Value, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(realCostFC_Value, 2)}</td>
                <td class="col-num highlight-col">₩ ${formatNum(realCostKrw_Value)}</td>
            </tr>
        `;
        
        // --- 5-2 로직 ---
        let allocatedFC_Volume = 0;
        let volumeShareRatio = 0;
        
        if (item.maxLoad > 0 && totalContainers > 0 && item.qty > 0) {
            const itemContainerUsage = item.qty / item.maxLoad;
            volumeShareRatio = itemContainerUsage / totalContainers; // 전체 컨테이너 사용량 중 해당 품목의 점유율
            
            // 해당 품목이 부담해야 할 총 부대비용(원화)
            const itemTotalAncillaryKrw = totalAncillaryKrw * volumeShareRatio;
            
            // 단위당 부담 부대비용(외화) = (품목 총 부대비용 / 환율) / 수량
            allocatedFC_Volume = (itemTotalAncillaryKrw / exRate) / item.qty;
        }
        
        const realCostFC_Volume = unitPriceFC + allocatedFC_Volume;
        const realCostKrw_Volume = realCostFC_Volume * exRate;
        
        htmlVolume += `
            <tr>
                <td>${item.name}</td>
                <td class="col-num">${item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '<span style="color:var(--danger);font-size:0.85em">적재량 누락</span>'}</td>
                <td class="col-num">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                <td class="col-num">${p.currency} ${formatNum(allocatedFC_Volume, 2)}</td>
                <td class="col-num" style="font-weight:500;">${p.currency} ${formatNum(realCostFC_Volume, 2)}</td>
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
        container.innerHTML = '<p style="padding:20px; text-align:center;">견적 ?�용???�습?�다.</p>';
        return;
    }

    let html = `<table id="exportMasterTable" style="width:100%; border-collapse:collapse; font-size:12px; font-family:sans-serif;">`;
    
    // 1. ?�더 (견적 ?�보)
    html += `
        <thead>
            <tr>
                <th colspan="8" style="font-size:18px; padding:15px; text-align:center; background:#f8fafc; border:1px solid #333;">?�워??견적??(${state.doc.title || ''})</th>
            </tr>
            <tr>
                <th colspan="2" style="background:#f1f5f9; padding:8px; border:1px solid #333; text-align:center;">견적?�자</th>
                <td colspan="2" style="padding:8px; border:1px solid #333; text-align:center;">${state.doc.quoteDate || ''}</td>
                <th colspan="2" style="background:#f1f5f9; padding:8px; border:1px solid #333; text-align:center;">컨테?�너 규격 �??�량</th>
                <td colspan="2" style="padding:8px; border:1px solid #333; text-align:center;">${state.doc.containerType || ''} x ${state.doc.containerQty || 1}</td>
            </tr>
            <tr><th colspan="8" style="height:20px; border:none; background:white;"></th></tr>
        </thead>
        <tbody>
    `;

    // 2. ?�입 ?�???�목
    html += `
        <tr>
            <th colspan="8" style="font-size:14px; background:#e2e8f0; text-align:left; padding:8px; border:1px solid #333;">[1] ?�입 ?�???�목</th>
        </tr>
        <tr>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">HS CODE</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�명</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�량</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�위</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">총중??kg)</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;">최�??�재??/th>
            <th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333;">비고</th>
        </tr>
    `;
    
    let sumQty = 0;
    let sumWeight = 0;

    state.doc.items.forEach(item => {
        sumQty += (item.qty || 0);
        sumWeight += (item.weight || 0);
        html += `
            <tr>
                <td style="text-align:center; padding:6px; border:1px solid #333;">${item.hsCode || ''}</td>
                <td style="padding:6px; border:1px solid #333;">${item.name || ''}</td>
                <td style="text-align:right; padding:6px; border:1px solid #333;">${formatNum(item.qty)}</td>
                <td style="text-align:center; padding:6px; border:1px solid #333;">${item.unit || ''}</td>
                <td style="text-align:right; padding:6px; border:1px solid #333;">${formatNum(item.weight)}</td>
                <td style="text-align:right; padding:6px; border:1px solid #333;">${formatNum(item.maxLoad)}</td>
                <td colspan="2" style="padding:6px; border:1px solid #333;"></td>
            </tr>
        `;
    });
    
    html += `
        <tr>
            <th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333; text-align:center;">?�계</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333; text-align:right;">${formatNum(sumQty)}</th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333;"></th>
            <th style="background:#f8fafc; padding:6px; border:1px solid #333; text-align:right;">${formatNum(sumWeight)} kg</th>
            <th colspan="3" style="background:#f8fafc; padding:6px; border:1px solid #333;"></th>
        </tr>
        <tr><td colspan="8" style="height:20px; border:none; background:white;"></td></tr>
    `;

    // 3. 비용 ?�약 (복사 로직)
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

    let rows = {
        invoice: { label: '물품 ?��?(KRW ?�산)', values: [] },
        ocean: { label: '?�상 ?�임 (O/F)', values: [] },
        export: { label: '?�출�?부?�비용', values: [] },
        import: { label: '?�입�?부?�비용', values: [] },
        ins: { label: '?�하보험�?, values: [] },
        customs: { label: '?�입 ?��??�수�?, values: [] },
        subtotal: { label: '부?�비용 ?�계 (KRW)', values: [], isTotal: true },
        grandtotal: { label: '�?비용 (물품+부?�) KRW', values: [], isGrand: true }
    };

    let fwHeaders = [];

    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            fwHeaders.push(`${fw.name} (${term})`);
            
            const invKrw = getInvoiceSumKrw(term);
            rows.invoice.values.push(invKrw);

            let oceanKrw = 0, exportKrw = 0, importKrw = 0, insKrw = 0, customsKrw = 0;

            fw.costs.forEach(c => {
                if (c.applyTo[term]) {
                    if (c.key === 'OF') oceanKrw += c.amountKrw || 0;
                    else if (c.key.endsWith('_E')) exportKrw += c.amountKrw || 0;
                    else if (c.key.endsWith('_I') && c.key !== 'CUST_I') importKrw += c.amountKrw || 0;
                    else if (c.key === 'INS') insKrw += c.amountKrw || 0;
                    else if (c.key === 'CUST_I') customsKrw += c.amountKrw || 0;
                    else importKrw += c.amountKrw || 0; // 기�? ?�입�?비용
                }
            });

            rows.ocean.values.push(oceanKrw);
            rows.export.values.push(exportKrw);
            rows.import.values.push(importKrw);
            rows.ins.values.push(insKrw);
            rows.customs.values.push(customsKrw);

            const sub = oceanKrw + exportKrw + importKrw + insKrw + customsKrw;
            rows.subtotal.values.push(sub);
            rows.grandtotal.values.push(invKrw + sub);
        });
    });

    if (fwHeaders.length > 0) {
        html += `
            <tr>
                <th colspan="8" style="font-size:14px; background:#e2e8f0; text-align:left; padding:8px; border:1px solid #333;">[2] 비용 ?�약 (?�화 ?�산)</th>
            </tr>
            <tr>
                <th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333;">??��</th>
        `;
        // colspan 배분: �?6칸을 ?�더 ?�만???�눔. ?�더가 많으�??�긋?????�으?? ?�단 TD ?�나??�?
        // colspan="8"??최�??��?�???�� 2�? ?�머지 6칸을 ?�워?�에 분배. 
        // ?�워?��? ?�무 많으�??�어�????�으므�? table layout???�동?�으�?처리.
        fwHeaders.forEach(th => {
            html += `<th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333;">${th}</th>`;
        });
        html += `</tr>`;

        Object.keys(rows).forEach(key => {
            const r = rows[key];
            const bg = r.isGrand ? '#4f46e5' : (r.isTotal ? '#eef2ff' : '#fff');
            const col = r.isGrand ? '#fff' : '#000';
            const fw = r.isGrand || r.isTotal ? 'bold' : 'normal';
            html += `<tr><td colspan="2" style="background:${bg}; color:${col}; font-weight:${fw}; padding:6px; border:1px solid #333;">${r.label}</td>`;
            r.values.forEach(v => {
                html += `<td colspan="2" style="text-align:right; background:${bg}; color:${col}; font-weight:${fw}; padding:6px; border:1px solid #333;">${v > 0 ? '??' + formatNum(v) : '??}</td>`;
            });
            html += `</tr>`;
        });
        html += `<tr><td colspan="8" style="height:20px; border:none; background:white;"></td></tr>`;
    }

    // 4. 모든 ?�코?��??�수?�원가 (5-1, 5-2)
    state.doc.forwarders.forEach((fw, fIdx) => {
        state.doc.incoterms.forEach(term => {
            if (!fw.calculated || !fw.calculated[term]) return;

            const calc = fw.calculated[term];
            const totalAncillaryKrw = calc.ancillaryKrw;
            const totalInvoiceKrw = calc.invoiceKrw;
            
            const allocationRatio = totalInvoiceKrw > 0 ? (totalAncillaryKrw / totalInvoiceKrw) : 0;
            
            let totalContainers = 0;
            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (p && p.unitPrice > 0 && item.maxLoad > 0) {
                    totalContainers += (item.qty / item.maxLoad);
                }
            });

            // ?�?��?
            html += `
                <tr>
                    <th colspan="8" style="font-size:14px; background:#e2e8f0; text-align:left; padding:8px; border:1px solid #333;">
                        [3] ?�수?�원가 - ${fw.name} (${term})
                    </th>
                </tr>
            `;

            // 5-1 가치비례
            html += `
                <tr><td colspan="8" style="background:#f1f5f9; font-weight:bold; padding:6px; border:1px solid #333;">(1) 가치비례 배분�?(가??기�?)</td></tr>
                <tr>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�명</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�량</th>
                    <th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333;">?�수 물품?��?(?�위??</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">부?�비용 (?�위??</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�수?�원가 (?�화)</th>
                    <th colspan="2" style="background:#eef2ff; padding:6px; border:1px solid #333;">?�수?�원가 (KRW)</th>
                </tr>
            `;
            
            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (!p || !p.unitPrice || p.unitPrice === 0) {
                    html += `<tr><td style="padding:6px; border:1px solid #333;">${item.name}</td><td style="text-align:right; padding:6px; border:1px solid #333;">${item.qty}</td><td colspan="6" style="text-align:center; padding:6px; border:1px solid #333; color:#666;">?��? ?�음</td></tr>`;
                    return;
                }
                const unitPriceFC = p.unitPrice;
                const exRate = state.doc.exchangeRates[p.currency] || 1;
                const allocatedFC_Value = unitPriceFC * allocationRatio;
                const realCostFC_Value = unitPriceFC + allocatedFC_Value;
                const realCostKrw_Value = realCostFC_Value * exRate;

                html += `
                    <tr>
                        <td style="padding:6px; border:1px solid #333;">${item.name}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #333;">${formatNum(item.qty)}</td>
                        <td colspan="2" style="text-align:right; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(allocatedFC_Value, 2)}</td>
                        <td style="text-align:right; font-weight:bold; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(realCostFC_Value, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; background:#eef2ff; padding:6px; border:1px solid #333;">??${formatNum(realCostKrw_Value)}</td>
                    </tr>
                `;
            });

            // 5-2 ?�재비율
            html += `
                <tr><td colspan="8" style="background:#f1f5f9; font-weight:bold; padding:6px; border:1px solid #333;">(2) 컨테?�너 ?�재비율 배분�?(부??무게 기�?)</td></tr>
                <tr>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�명</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�유??/th>
                    <th colspan="2" style="background:#f8fafc; padding:6px; border:1px solid #333;">?�수 물품?��?(?�위??</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">부?�비용 (?�위??</th>
                    <th style="background:#f8fafc; padding:6px; border:1px solid #333;">?�수?�원가 (?�화)</th>
                    <th colspan="2" style="background:#eef2ff; padding:6px; border:1px solid #333;">?�수?�원가 (KRW)</th>
                </tr>
            `;

            state.doc.items.forEach(item => {
                const p = item.prices[term];
                if (!p || !p.unitPrice || p.unitPrice === 0) {
                    html += `<tr><td style="padding:6px; border:1px solid #333;">${item.name}</td><td style="text-align:right; padding:6px; border:1px solid #333;">-</td><td colspan="6" style="text-align:center; padding:6px; border:1px solid #333; color:#666;">?��? ?�음</td></tr>`;
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
                        <td style="padding:6px; border:1px solid #333;">${item.name}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #333;">${item.maxLoad > 0 ? (volumeShareRatio * 100).toFixed(1) + '%' : '?�락'}</td>
                        <td colspan="2" style="text-align:right; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(unitPriceFC, 2)}</td>
                        <td style="text-align:right; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(allocatedFC_Volume, 2)}</td>
                        <td style="text-align:right; font-weight:bold; padding:6px; border:1px solid #333;">${p.currency} ${formatNum(realCostFC_Volume, 2)}</td>
                        <td colspan="2" style="text-align:right; font-weight:bold; background:#eef2ff; padding:6px; border:1px solid #333;">??${formatNum(realCostKrw_Volume)}</td>
                    </tr>
                `;
            });
            html += `<tr><td colspan="8" style="height:20px; border:none; background:white;"></td></tr>`;
        });
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
}

function exportToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('?��? ?�이브러리�? 불러?��? 못했?�니??', true);
        return;
    }
    const table = document.getElementById('exportMasterTable');
    if (!table) {
        showToast('?��?�??�보???�이?��? ?�습?�다.', true);
        return;
    }

    try {
        const wb = XLSX.utils.table_to_book(table, { sheet: "?�워??견적?? });
        const dateStr = state.doc.quoteDate ? state.doc.quoteDate.replace(/-/g, '') : new Date().toISOString().split('T')[0].replace(/-/g, '');
        const title = state.doc.title || 'Untitled';
        XLSX.writeFile(wb, `?�워?�견?�서_${title}_${dateStr}.xlsx`);
    } catch (err) {
        console.error(err);
        showToast('?��? 변??�??�류가 발생?�습?�다.', true);
    }
}

