// ══════════════════════════════════════════════════════════════════
// Invoice & Packing List — Frontend JS
// ══════════════════════════════════════════════════════════════════

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';

let allDocs = [];
let allPartners = [];
let currentPreviewDoc = null;
let currentPreviewType = 'invoice'; // 'invoice' | 'packinglist'
let currentTplRole = null; // 'shipper' | 'consignee' | 'notify'

// DOM Elements
const els = {
    // List & KPI
    kpiTotal: document.getElementById('kpiTotal'),
    kpiMonth: document.getElementById('kpiMonth'),
    kpiAmount: document.getElementById('kpiAmount'),
    totalCount: document.getElementById('totalCount'),
    searchInput: document.getElementById('searchInput'),
    docTableBody: document.getElementById('docTableBody'),
    selectAll: document.getElementById('selectAll'),
    
    // Doc Modal
    docModal: document.getElementById('docModal'),
    modalTitle: document.getElementById('modalTitle'),
    docForm: document.getElementById('docForm'),
    itemLines: document.getElementById('itemLines'),
    addItemBtn: document.getElementById('addItemBtn'),
    saveDocBtn: document.getElementById('saveDocBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelModalBtn: document.getElementById('cancelModalBtn'),
    
    // Partner Drawer
    drawerOverlay: document.getElementById('drawerOverlay'),
    partnerDrawer: document.getElementById('partnerDrawer'),
    partnerList: document.getElementById('partnerList'),
    partnerForm: document.getElementById('partnerForm'),
    ptrSaveBtn: document.getElementById('ptrSaveBtn'),
    ptrCancelBtn: document.getElementById('ptrCancelBtn'),
    closeDrawerBtn: document.getElementById('closeDrawerBtn'),
    partnerBtn: document.getElementById('partnerBtn'),
    
    // Template Picker
    tplPickerModal: document.getElementById('tplPickerModal'),
    tplPickerList: document.getElementById('tplPickerList'),
    closeTplPickerBtn: document.getElementById('closeTplPickerBtn'),
    
    // Preview
    previewOverlay: document.getElementById('previewOverlay'),
    previewContainer: document.getElementById('previewContainer'),
    closePreviewBtn: document.getElementById('closePreviewBtn'),
    printBtn: document.getElementById('printBtn'),
    switchDocBtn: document.getElementById('switchDocBtn'),
    switchLabel: document.getElementById('switchLabel'),
    
    // Top actions
    addBtn: document.getElementById('addBtn'),
    deleteBtn: document.getElementById('deleteBtn')
};

// ── Auth & API ──
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
    const res = await fetch(API_BASE + url, opts);
    if (!res.ok) {
        let errMsg = res.statusText;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch(e) {}
        throw new Error(errMsg);
    }
    return res.json();
}

function showToast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="bx ${type === 'success' ? 'bx-check-circle' : 'bx-error-circle'}"></i> ${msg}`;
    Object.assign(t.style, {
        padding: '10px 16px', background: type === 'success' ? '#22c55e' : '#ef4444',
        color: '#fff', borderRadius: '8px', marginBottom: '6px', fontSize: '12px',
        fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px',
        animation: 'fadeIn 0.3s'
    });
    c.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0'; t.style.transition = 'opacity 0.3s';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// ── Data Loading & Rendering ──
async function loadDocs() {
    try {
        allDocs = await authFetch('/api/invoice-packing/documents');
        renderTable();
        updateKPI();
    } catch (e) {
        showToast('문서 목록을 불러오는 데 실패했습니다.', 'error');
        console.error(e);
    }
}

async function loadPartners() {
    try {
        allPartners = await authFetch('/api/invoice-packing/partners');
        renderPartnerList();
    } catch (e) {
        console.error('Failed to load partners', e);
    }
}

function updateKPI() {
    els.kpiTotal.textContent = allDocs.length;
    els.totalCount.textContent = allDocs.length + '건';
    
    const now = new Date();
    const thisMonth = allDocs.filter(d => {
        const dt = new Date(d.createdAt);
        return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
    });
    els.kpiMonth.textContent = thisMonth.length;
    
    const totalAmt = thisMonth.reduce((sum, d) => sum + (d.totalAmount || 0), 0);
    const cur = thisMonth.length > 0 ? (thisMonth[0].currency || 'USD') : 'USD';
    const sym = { USD: '$', EUR: '€', KRW: '₩', CNY: '¥', JPY: '¥', GBP: '£' }[cur] || cur;
    els.kpiAmount.textContent = sym + Number(totalAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderTable() {
    const q = els.searchInput.value.toLowerCase().trim();
    let docs = allDocs;
    if (q) {
        docs = docs.filter(d => 
            (d.invoiceNo || '').toLowerCase().includes(q) ||
            (d.packingListNo || '').toLowerCase().includes(q) ||
            (d.consignee?.name || '').toLowerCase().includes(q) ||
            (d.portOfLoading || '').toLowerCase().includes(q)
        );
    }
    
    if (docs.length === 0) {
        els.docTableBody.innerHTML = `<tr><td colspan="9" class="inv-table-empty">
            <i class='bx bx-file'></i>검색된 문서가 없습니다.
        </td></tr>`;
        return;
    }
    
    els.docTableBody.innerHTML = docs.map(d => {
        const dateStr = d.docDate ? d.docDate : (d.createdAt ? d.createdAt.split('T')[0] : '');
        const sym = { USD: '$', EUR: '€', KRW: '₩', CNY: '¥', JPY: '¥', GBP: '£' }[d.currency || 'USD'] || d.currency;
        const amtStr = sym + Number(d.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const cName = d.consignee?.name || '-';
        const docHtml = [];
        if (d.invoiceNo) docHtml.push(`<div class="inv-doc-badge inv">INV: ${d.invoiceNo}</div>`);
        if (d.packingListNo) docHtml.push(`<div class="inv-doc-badge pl">PL: ${d.packingListNo}</div>`);
        
        return `<tr data-id="${d.id}">
            <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
            <td><div style="display:flex;flex-direction:column;gap:4px;">${docHtml.join('')}</div></td>
            <td>${dateStr}</td>
            <td style="font-weight:600;color:var(--gray-800);">${cName}</td>
            <td>${d.portOfLoading || '-'}</td>
            <td>${d.currency || 'USD'}</td>
            <td class="inv-amount">${amtStr}</td>
            <td style="color:var(--gray-500);font-size:11px;">${(d.createdAt||'').split('T')[0]}</td>
            <td class="col-actions" onclick="event.stopPropagation()">
                <div class="inv-row-actions">
                    <button type="button" class="btn-preview" onclick="openPreview('${d.id}')" title="미리보기/인쇄"><i class='bx bx-printer'></i></button>
                    <button type="button" onclick="editDoc('${d.id}')" title="수정"><i class='bx bx-edit-alt'></i></button>
                    <button type="button" class="btn-delete" onclick="deleteDoc('${d.id}')" title="삭제"><i class='bx bx-trash'></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Item Lines Logic ──
function createItemLine(item = {}) {
    const div = document.createElement('div');
    div.className = 'inv-item-row';
    div.innerHTML = `
        <input type="text" placeholder="품명/설명" class="i-desc" value="${item.description || ''}">
        <input type="text" placeholder="HS Code" class="i-hs" value="${item.hsCode || ''}">
        <input type="number" placeholder="0" class="i-qty" min="0" value="${item.qty || ''}">
        <input type="text" placeholder="EA" class="i-unit" value="${item.unit || 'EA'}">
        <input type="number" placeholder="0.00" class="i-price" min="0" step="0.01" value="${item.unitPrice || ''}">
        <input type="text" class="item-amount" readonly tabindex="-1" value="${item.amount || '0.00'}">
        <input type="number" placeholder="0.00" class="i-nw" min="0" step="0.01" value="${item.netWeight || ''}">
        <input type="number" placeholder="0.00" class="i-gw" min="0" step="0.01" value="${item.grossWeight || ''}">
        <input type="number" placeholder="0.000" class="i-cbm" min="0" step="0.001" value="${item.measurement || ''}">
        <button type="button" class="inv-item-del"><i class='bx bx-trash'></i></button>
    `;
    
    // Add event listeners for calculation
    const inputs = div.querySelectorAll('.i-qty, .i-price, .i-nw, .i-gw, .i-cbm');
    inputs.forEach(inp => inp.addEventListener('input', calculateRowAndTotals));
    
    div.querySelector('.inv-item-del').addEventListener('click', () => {
        div.remove();
        calculateRowAndTotals();
    });
    
    els.itemLines.appendChild(div);
}

function calculateRowAndTotals() {
    let totQty = 0, totAmt = 0, totNW = 0, totGW = 0, totCBM = 0;
    
    Array.from(els.itemLines.children).forEach(row => {
        const qty = parseFloat(row.querySelector('.i-qty').value) || 0;
        const price = parseFloat(row.querySelector('.i-price').value) || 0;
        const nw = parseFloat(row.querySelector('.i-nw').value) || 0;
        const gw = parseFloat(row.querySelector('.i-gw').value) || 0;
        const cbm = parseFloat(row.querySelector('.i-cbm').value) || 0;
        
        const amt = qty * price;
        row.querySelector('.item-amount').value = amt.toFixed(2);
        
        totQty += qty;
        totAmt += amt;
        totNW += nw;
        totGW += gw;
        totCBM += cbm;
    });
    
    document.getElementById('totQty').textContent = totQty.toLocaleString();
    document.getElementById('totAmount').textContent = totAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('totNW').textContent = totNW.toFixed(2);
    document.getElementById('totGW').textContent = totGW.toFixed(2);
    document.getElementById('totCBM').textContent = totCBM.toFixed(3);
}

function gatherItems() {
    return Array.from(els.itemLines.children).map(row => ({
        description: row.querySelector('.i-desc').value.trim(),
        hsCode: row.querySelector('.i-hs').value.trim(),
        qty: parseFloat(row.querySelector('.i-qty').value) || 0,
        unit: row.querySelector('.i-unit').value.trim() || 'EA',
        unitPrice: parseFloat(row.querySelector('.i-price').value) || 0,
        amount: parseFloat(row.querySelector('.item-amount').value) || 0,
        netWeight: parseFloat(row.querySelector('.i-nw').value) || 0,
        grossWeight: parseFloat(row.querySelector('.i-gw').value) || 0,
        measurement: parseFloat(row.querySelector('.i-cbm').value) || 0
    })).filter(i => i.description || i.qty > 0);
}

// ── Modal Logic (Create/Edit) ──
function openDocModal(doc = null) {
    els.docForm.reset();
    els.itemLines.innerHTML = '';
    
    if (doc) {
        els.modalTitle.textContent = '거래 내역 수정';
        document.getElementById('editId').value = doc.id;
        
        document.getElementById('inpInvoiceNo').value = doc.invoiceNo || '';
        document.getElementById('inpPackingListNo').value = doc.packingListNo || '';
        document.getElementById('inpDocDate').value = doc.docDate || '';
        document.getElementById('inpCurrency').value = doc.currency || 'USD';
        
        // Shipper
        document.getElementById('inpShipperName').value = doc.shipper?.name || '';
        document.getElementById('inpShipperAddress').value = doc.shipper?.address || '';
        document.getElementById('inpShipperTel').value = doc.shipper?.tel || '';
        document.getElementById('inpShipperFax').value = doc.shipper?.fax || '';
        document.getElementById('inpShipperEmail').value = doc.shipper?.email || '';
        document.getElementById('inpShipperBank').value = doc.shipper?.bankInfo?.bankName || '';
        document.getElementById('inpShipperAccountNo').value = doc.shipper?.bankInfo?.accountNo || '';
        document.getElementById('inpShipperSwift').value = doc.shipper?.bankInfo?.swift || '';
        document.getElementById('inpShipperBankAddress').value = doc.shipper?.bankInfo?.bankAddress || '';
        
        // Consignee
        document.getElementById('inpConsigneeName').value = doc.consignee?.name || '';
        document.getElementById('inpConsigneeAddress').value = doc.consignee?.address || '';
        document.getElementById('inpConsigneeTel').value = doc.consignee?.tel || '';
        document.getElementById('inpConsigneeFax').value = doc.consignee?.fax || '';
        document.getElementById('inpConsigneeEmail').value = doc.consignee?.email || '';
        
        // Notify
        document.getElementById('inpNotifyName').value = doc.notifyParty?.name || '';
        document.getElementById('inpNotifyAddress').value = doc.notifyParty?.address || '';
        document.getElementById('inpNotifyTel').value = doc.notifyParty?.tel || '';
        
        // Shipping
        document.getElementById('inpVessel').value = doc.vessel || '';
        document.getElementById('inpIncoterms').value = doc.incoterms || '';
        document.getElementById('inpPortOfLoading').value = doc.portOfLoading || '';
        document.getElementById('inpPortOfDischarge').value = doc.portOfDischarge || '';
        document.getElementById('inpFinalDestination').value = doc.finalDestination || '';
        document.getElementById('inpPaymentTerms').value = doc.paymentTerms || '';
        
        // Items
        if (doc.items && doc.items.length > 0) {
            doc.items.forEach(item => createItemLine(item));
        } else {
            createItemLine();
        }
        
        document.getElementById('inpRemarks').value = doc.remarks || '';
        
    } else {
        els.modalTitle.textContent = '신규 거래 생성';
        document.getElementById('editId').value = '';
        createItemLine();
    }
    
    calculateRowAndTotals();
    els.docModal.classList.add('active');
}

function closeDocModal() {
    els.docModal.classList.remove('active');
}

window.editDoc = function(id) {
    const doc = allDocs.find(d => d.id === id);
    if (doc) openDocModal(doc);
};

window.deleteDoc = async function(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
        await authFetch('/api/invoice-packing/documents/delete', { method: 'POST', body: JSON.stringify({ ids: [id] }) });
        showToast('삭제되었습니다.');
        loadDocs();
    } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
    }
};

els.saveDocBtn.addEventListener('click', async () => {
    const id = document.getElementById('editId').value;
    const isEdit = !!id;
    
    const payload = {
        invoiceNo: document.getElementById('inpInvoiceNo').value.trim(),
        packingListNo: document.getElementById('inpPackingListNo').value.trim(),
        docDate: document.getElementById('inpDocDate').value,
        currency: document.getElementById('inpCurrency').value,
        
        shipper: {
            name: document.getElementById('inpShipperName').value.trim(),
            address: document.getElementById('inpShipperAddress').value.trim(),
            tel: document.getElementById('inpShipperTel').value.trim(),
            fax: document.getElementById('inpShipperFax').value.trim(),
            email: document.getElementById('inpShipperEmail').value.trim(),
            bankInfo: {
                bankName: document.getElementById('inpShipperBank').value.trim(),
                accountNo: document.getElementById('inpShipperAccountNo').value.trim(),
                swift: document.getElementById('inpShipperSwift').value.trim(),
                bankAddress: document.getElementById('inpShipperBankAddress').value.trim()
            }
        },
        consignee: {
            name: document.getElementById('inpConsigneeName').value.trim(),
            address: document.getElementById('inpConsigneeAddress').value.trim(),
            tel: document.getElementById('inpConsigneeTel').value.trim(),
            fax: document.getElementById('inpConsigneeFax').value.trim(),
            email: document.getElementById('inpConsigneeEmail').value.trim()
        },
        notifyParty: {
            name: document.getElementById('inpNotifyName').value.trim(),
            address: document.getElementById('inpNotifyAddress').value.trim(),
            tel: document.getElementById('inpNotifyTel').value.trim()
        },
        
        vessel: document.getElementById('inpVessel').value.trim(),
        incoterms: document.getElementById('inpIncoterms').value.trim(),
        portOfLoading: document.getElementById('inpPortOfLoading').value.trim(),
        portOfDischarge: document.getElementById('inpPortOfDischarge').value.trim(),
        finalDestination: document.getElementById('inpFinalDestination').value.trim(),
        paymentTerms: document.getElementById('inpPaymentTerms').value.trim(),
        
        items: gatherItems(),
        remarks: document.getElementById('inpRemarks').value.trim(),
        
        totalAmount: parseFloat(document.getElementById('totAmount').textContent.replace(/,/g,'')) || 0,
        totalQty: parseFloat(document.getElementById('totQty').textContent.replace(/,/g,'')) || 0,
        totalNetWeight: parseFloat(document.getElementById('totNW').textContent) || 0,
        totalGrossWeight: parseFloat(document.getElementById('totGW').textContent) || 0,
        totalMeasurement: parseFloat(document.getElementById('totCBM').textContent) || 0
    };
    
    try {
        const url = isEdit ? `/api/invoice-packing/documents/${id}` : `/api/invoice-packing/documents`;
        const method = isEdit ? 'PUT' : 'POST';
        await authFetch(url, { method, body: JSON.stringify(payload) });
        
        showToast(isEdit ? '수정되었습니다.' : '저장되었습니다.');
        closeDocModal();
        loadDocs();
    } catch (e) {
        showToast('저장 실패: ' + e.message, 'error');
    }
});

// ── Partner Templates Logic ──
function openPartnerDrawer() {
    renderPartnerList();
    els.drawerOverlay.classList.add('active');
    els.partnerDrawer.classList.add('open');
}

function closePartnerDrawer() {
    els.drawerOverlay.classList.remove('active');
    els.partnerDrawer.classList.remove('open');
    resetPartnerForm();
}

function renderPartnerList() {
    if (allPartners.length === 0) {
        els.partnerList.innerHTML = `<div style="text-align:center;padding:40px;color:var(--gray-400);">등록된 거래처가 없습니다.</div>`;
        return;
    }
    els.partnerList.innerHTML = allPartners.map(p => {
        return `<div class="ptr-card">
            <div class="ptr-card-header">
                <div class="ptr-card-name">${p.name}</div>
                <div class="ptr-card-role ${p.role}">${p.role}</div>
            </div>
            <div class="ptr-card-detail">
                ${p.address ? `<div>${p.address}</div>` : ''}
                ${p.tel ? `<div>Tel: ${p.tel}</div>` : ''}
            </div>
            <div class="ptr-card-actions">
                <button type="button" onclick="editPartner('${p.id}')"><i class='bx bx-edit-alt'></i></button>
                <button type="button" class="ptr-del" onclick="deletePartner('${p.id}')"><i class='bx bx-trash'></i></button>
            </div>
        </div>`;
    }).join('');
}

function resetPartnerForm() {
    document.getElementById('ptrEditId').value = '';
    document.getElementById('ptrRole').value = 'shipper';
    document.getElementById('ptrName').value = '';
    document.getElementById('ptrAddress').value = '';
    document.getElementById('ptrTel').value = '';
    document.getElementById('ptrFax').value = '';
    document.getElementById('ptrEmail').value = '';
    document.getElementById('ptrBank').value = '';
    document.getElementById('ptrAccount').value = '';
    document.getElementById('ptrSwift').value = '';
    document.getElementById('ptrBankAddr').value = '';
    els.ptrCancelBtn.style.display = 'none';
}

window.editPartner = function(id) {
    const p = allPartners.find(x => x.id === id);
    if (!p) return;
    document.getElementById('ptrEditId').value = p.id;
    document.getElementById('ptrRole').value = p.role || 'shipper';
    document.getElementById('ptrName').value = p.name || '';
    document.getElementById('ptrAddress').value = p.address || '';
    document.getElementById('ptrTel').value = p.tel || '';
    document.getElementById('ptrFax').value = p.fax || '';
    document.getElementById('ptrEmail').value = p.email || '';
    document.getElementById('ptrBank').value = p.bankInfo?.bankName || '';
    document.getElementById('ptrAccount').value = p.bankInfo?.accountNo || '';
    document.getElementById('ptrSwift').value = p.bankInfo?.swift || '';
    document.getElementById('ptrBankAddr').value = p.bankInfo?.bankAddress || '';
    els.ptrCancelBtn.style.display = 'inline-flex';
    els.partnerForm.scrollIntoView({ behavior: 'smooth' });
};

window.deletePartner = async function(id) {
    if (!confirm('템플릿을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`/api/invoice-packing/partners/${id}`, { method: 'DELETE' });
        showToast('삭제되었습니다.');
        loadPartners();
    } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
    }
};

els.ptrSaveBtn.addEventListener('click', async () => {
    const id = document.getElementById('ptrEditId').value;
    const payload = {
        id: id || undefined,
        role: document.getElementById('ptrRole').value,
        name: document.getElementById('ptrName').value.trim(),
        address: document.getElementById('ptrAddress').value.trim(),
        tel: document.getElementById('ptrTel').value.trim(),
        fax: document.getElementById('ptrFax').value.trim(),
        email: document.getElementById('ptrEmail').value.trim(),
        bankInfo: {
            bankName: document.getElementById('ptrBank').value.trim(),
            accountNo: document.getElementById('ptrAccount').value.trim(),
            swift: document.getElementById('ptrSwift').value.trim(),
            bankAddress: document.getElementById('ptrBankAddr').value.trim()
        }
    };
    if (!payload.name) {
        showToast('회사명을 입력하세요.', 'error');
        return;
    }
    try {
        await authFetch('/api/invoice-packing/partners', { method: 'POST', body: JSON.stringify(payload) });
        showToast('템플릿이 저장되었습니다.');
        resetPartnerForm();
        loadPartners();
    } catch (e) {
        showToast('저장 실패: ' + e.message, 'error');
    }
});
els.ptrCancelBtn.addEventListener('click', resetPartnerForm);

// ── Template Picker Logic ──
document.querySelectorAll('.load-tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        currentTplRole = btn.dataset.role; // 'shipper', 'consignee', 'notify'
        
        let targetRole = 'shipper';
        if (currentTplRole === 'consignee' || currentTplRole === 'notify') targetRole = 'consignee';
        
        const list = allPartners.filter(p => p.role === targetRole || p.role === currentTplRole);
        
        if (list.length === 0) {
            document.getElementById('tplPickerEmpty').style.display = 'block';
            els.tplPickerList.innerHTML = '';
        } else {
            document.getElementById('tplPickerEmpty').style.display = 'none';
            els.tplPickerList.innerHTML = list.map(p => {
                return `<div class="ptr-card" onclick="applyTemplate('${p.id}')">
                    <div class="ptr-card-header"><div class="ptr-card-name">${p.name}</div></div>
                    <div class="ptr-card-detail">${p.address ? `<div>${p.address}</div>` : ''}</div>
                </div>`;
            }).join('');
        }
        
        document.getElementById('tplPickerTitle').textContent = 
            currentTplRole === 'shipper' ? '판매자 템플릿 선택' :
            (currentTplRole === 'consignee' ? '구매자 템플릿 선택' : 'Notify 템플릿 선택');
            
        els.tplPickerModal.classList.add('active');
    });
});

window.applyTemplate = function(id) {
    const p = allPartners.find(x => x.id === id);
    if (!p) return;
    
    if (currentTplRole === 'shipper') {
        document.getElementById('inpShipperName').value = p.name || '';
        document.getElementById('inpShipperAddress').value = p.address || '';
        document.getElementById('inpShipperTel').value = p.tel || '';
        document.getElementById('inpShipperFax').value = p.fax || '';
        document.getElementById('inpShipperEmail').value = p.email || '';
        document.getElementById('inpShipperBank').value = p.bankInfo?.bankName || '';
        document.getElementById('inpShipperAccountNo').value = p.bankInfo?.accountNo || '';
        document.getElementById('inpShipperSwift').value = p.bankInfo?.swift || '';
        document.getElementById('inpShipperBankAddress').value = p.bankInfo?.bankAddress || '';
    } else if (currentTplRole === 'consignee') {
        document.getElementById('inpConsigneeName').value = p.name || '';
        document.getElementById('inpConsigneeAddress').value = p.address || '';
        document.getElementById('inpConsigneeTel').value = p.tel || '';
        document.getElementById('inpConsigneeFax').value = p.fax || '';
        document.getElementById('inpConsigneeEmail').value = p.email || '';
    } else if (currentTplRole === 'notify') {
        document.getElementById('inpNotifyName').value = p.name || '';
        document.getElementById('inpNotifyAddress').value = p.address || '';
        document.getElementById('inpNotifyTel').value = p.tel || '';
    }
    
    els.tplPickerModal.classList.remove('active');
    showToast('템플릿 정보가 입력되었습니다.');
};

// ── Preview & Print Logic ──
window.openPreview = function(id) {
    const doc = allDocs.find(d => d.id === id);
    if (!doc) return;
    currentPreviewDoc = doc;
    currentPreviewType = 'invoice';
    renderPreview();
    els.previewOverlay.classList.add('active');
};

function closePreview() {
    els.previewOverlay.classList.remove('active');
    currentPreviewDoc = null;
}

function switchPreviewType() {
    if (currentPreviewType === 'invoice') {
        currentPreviewType = 'packinglist';
        els.switchLabel.textContent = 'Invoice 보기';
    } else {
        currentPreviewType = 'invoice';
        els.switchLabel.textContent = 'Packing List 보기';
    }
    renderPreview();
}

function renderPreview() {
    if (!currentPreviewDoc) return;
    const d = currentPreviewDoc;
    const isInv = currentPreviewType === 'invoice';
    
    const docTitle = isInv ? 'COMMERCIAL INVOICE' : 'PACKING LIST';
    const docNo = isInv ? d.invoiceNo : d.packingListNo;
    const sym = { USD: '$', EUR: '€', KRW: '₩', CNY: '¥', JPY: '¥', GBP: '£' }[d.currency || 'USD'] || d.currency;
    
    // Items
    let itemsHtml = '';
    d.items.forEach(i => {
        if (isInv) {
            itemsHtml += `<tr>
                <td class="td-desc">${i.description}<br><span style="font-size:8px;color:#666;">HS Code: ${i.hsCode||'-'}</span></td>
                <td class="td-num">${Number(i.qty).toLocaleString()} ${i.unit}</td>
                <td class="td-num">${sym} ${Number(i.unitPrice).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td class="td-num">${sym} ${Number(i.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            </tr>`;
        } else {
            itemsHtml += `<tr>
                <td class="td-desc">${i.description}</td>
                <td class="td-num">${Number(i.qty).toLocaleString()} ${i.unit}</td>
                <td class="td-num">${Number(i.netWeight).toFixed(2)}</td>
                <td class="td-num">${Number(i.grossWeight).toFixed(2)}</td>
                <td class="td-num">${Number(i.measurement).toFixed(3)}</td>
            </tr>`;
        }
    });

    // Format Addresses
    const fmtAddr = (p) => {
        if(!p || !p.name) return '';
        let s = `<b>${p.name}</b><br>`;
        if(p.address) s += `${p.address.replace(/\n/g, '<br>')}<br>`;
        if(p.tel) s += `Tel: ${p.tel}<br>`;
        if(p.fax) s += `Fax: ${p.fax}<br>`;
        return s;
    };

    let html = `
        <div class="doc-title">${docTitle}</div>
        
        <div class="doc-parties">
            <div class="doc-party-box">
                <div class="party-label">Shipper / Exporter</div>
                ${fmtAddr(d.shipper)}
            </div>
            <div style="display:flex;flex-direction:column;gap:14px;">
                <div class="doc-party-box" style="flex:1;">
                    <div class="party-label">${isInv ? 'Invoice No. & Date' : 'Packing List No. & Date'}</div>
                    <div style="display:flex;gap:20px;margin-bottom:8px;">
                        <div><b>No:</b> ${docNo || '-'}</div>
                        <div><b>Date:</b> ${d.docDate || '-'}</div>
                    </div>
                    <div class="party-label">Remarks</div>
                    <div>${(d.remarks||'').replace(/\n/g, '<br>')}</div>
                </div>
            </div>
        </div>
        
        <div class="doc-parties" style="margin-bottom:14px;">
            <div class="doc-party-box">
                <div class="party-label">For Account & Risk of Messrs. (Consignee)</div>
                ${fmtAddr(d.consignee)}
            </div>
            <div class="doc-party-box">
                <div class="party-label">Notify Party</div>
                ${d.notifyParty?.name ? fmtAddr(d.notifyParty) : 'Same as Consignee'}
            </div>
        </div>
        
        <div class="doc-shipping">
            <div class="doc-shipping-cell"><div class="sh-label">Port of Loading</div><div class="sh-value">${d.portOfLoading || '-'}</div></div>
            <div class="doc-shipping-cell"><div class="sh-label">Port of Discharge</div><div class="sh-value">${d.portOfDischarge || '-'}</div></div>
            <div class="doc-shipping-cell"><div class="sh-label">Final Destination</div><div class="sh-value">${d.finalDestination || '-'}</div></div>
            <div class="doc-shipping-cell"><div class="sh-label">Vessel / Flight</div><div class="sh-value">${d.vessel || '-'}</div></div>
            <div class="doc-shipping-cell" style="grid-column: span 2;"><div class="sh-label">Payment Terms</div><div class="sh-value">${d.paymentTerms || '-'}</div></div>
            <div class="doc-shipping-cell" style="grid-column: span 2;"><div class="sh-label">Incoterms</div><div class="sh-value">${d.incoterms || '-'}</div></div>
        </div>
        
        <table class="doc-items-table">
            <thead>
                ${isInv ? `
                <tr>
                    <th style="width:50%;">Description of Goods</th>
                    <th style="width:15%;">Quantity</th>
                    <th style="width:15%;">Unit Price</th>
                    <th style="width:20%;">Amount</th>
                </tr>` : `
                <tr>
                    <th style="width:40%;">Description of Goods</th>
                    <th style="width:15%;">Quantity</th>
                    <th style="width:15%;">Net Wt (kg)</th>
                    <th style="width:15%;">Gross Wt (kg)</th>
                    <th style="width:15%;">Measurement (CBM)</th>
                </tr>`}
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
            <tfoot>
                ${isInv ? `
                <tr>
                    <td style="text-align:right;">TOTAL</td>
                    <td class="td-num">${Number(d.totalQty).toLocaleString()}</td>
                    <td></td>
                    <td class="td-num" style="color:var(--primary);">${sym} ${Number(d.totalAmount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                </tr>` : `
                <tr>
                    <td style="text-align:right;">TOTAL</td>
                    <td class="td-num">${Number(d.totalQty).toLocaleString()}</td>
                    <td class="td-num">${Number(d.totalNetWeight).toFixed(2)}</td>
                    <td class="td-num">${Number(d.totalGrossWeight).toFixed(2)}</td>
                    <td class="td-num">${Number(d.totalMeasurement).toFixed(3)}</td>
                </tr>`}
            </tfoot>
        </table>
    `;

    if (isInv && d.shipper?.bankInfo?.bankName) {
        const bi = d.shipper.bankInfo;
        html += `
        <div class="doc-remarks" style="margin-top:10px;background:#f9f9f9;">
            <b><i class='bx bxs-bank'></i> Bank Information</b><br>
            Bank Name: ${bi.bankName}<br>
            Account No: ${bi.accountNo}<br>
            SWIFT Code: ${bi.swift || '-'}<br>
            Bank Address: ${bi.bankAddress || '-'}
        </div>`;
    }

    html += `
        <div class="doc-footer">
            <div class="doc-signature">
                For and on behalf of<br>
                <b>${d.shipper?.name || ''}</b>
                <div class="sig-line">Authorized Signature</div>
            </div>
        </div>
    `;
    
    els.previewContainer.innerHTML = html;
}

// ── Event Listeners ──
els.addBtn.addEventListener('click', () => openDocModal());
els.closeModalBtn.addEventListener('click', closeDocModal);
els.cancelModalBtn.addEventListener('click', closeDocModal);
els.addItemBtn.addEventListener('click', () => createItemLine());
els.partnerBtn.addEventListener('click', openPartnerDrawer);
els.closeDrawerBtn.addEventListener('click', closePartnerDrawer);
els.closeTplPickerBtn.addEventListener('click', () => els.tplPickerModal.classList.remove('active'));
els.closePreviewBtn.addEventListener('click', closePreview);
els.switchDocBtn.addEventListener('click', switchPreviewType);
els.printBtn.addEventListener('click', () => window.print());
els.searchInput.addEventListener('input', renderTable);
els.selectAll.addEventListener('change', (e) => {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
});
els.deleteBtn.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (checked.length === 0) return showToast('삭제할 항목을 선택하세요.', 'error');
    if (!confirm('선택한 ' + checked.length + '개의 거래를 삭제하시겠습니까?')) return;
    
    try {
        await authFetch('/api/invoice-packing/documents/delete', { method: 'POST', body: JSON.stringify({ ids: checked }) });
        showToast('삭제되었습니다.');
        els.selectAll.checked = false;
        loadDocs();
    } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
    }
});

// Init
window.addEventListener('DOMContentLoaded', () => {
    loadDocs();
    loadPartners();
});
