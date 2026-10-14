// ══════════════════════════════════════════════════════════════════
// Invoice & Packing List — Frontend JS
// ══════════════════════════════════════════════════════════════════

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';

let allDocs = [];
let allPartners = [];
let currentPreviewDoc = null;
let currentPreviewType = 'proforma'; // 'proforma' | 'invoice' | 'packinglist'
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
    modalDocBadge: document.getElementById('modalDocBadge'),
    docForm: document.getElementById('docForm'),
    inpProformaNo: document.getElementById('inpProformaNo'),
    inpTermsAndConditions: document.getElementById('inpTermsAndConditions'),
    btnLoadPiTpl: document.getElementById('btnLoadPiTpl'),
    btnClearPiTpl: document.getElementById('btnClearPiTpl'),
    
    // Sub tabs
    subTabGroup: document.getElementById('docSubTabGroup'),
    btnSyncFromPiToCi: document.getElementById('btnSyncFromPiToCi'),
    chkNotifySameAsConsignee: document.getElementById('chkNotifySameAsConsignee'),
    chkPiBuyerSign: document.getElementById('chkPiBuyerSign'),
    
    // Items
    itemLines: document.getElementById('itemLines'),
    plItemLines: document.getElementById('plItemLines'),
    addItemBtn: document.getElementById('addItemBtn'),
    addPlItemBtn: document.getElementById('addPlItemBtn'),
    copyFromInvBtn: document.getElementById('copyFromInvBtn'),
    saveDocBtn: document.getElementById('saveDocBtn'),
    closeModalBtn: document.getElementById('closeModalBtn'),
    cancelModalBtn: document.getElementById('cancelModalBtn'),
    partnerBtn: document.getElementById('partnerBtn'),
    
    // Template Picker
    tplPickerModal: document.getElementById('tplPickerModal'),
    tplPickerList: document.getElementById('tplPickerList'),
    tplSearchInput: document.getElementById('tplSearchInput'),
    closeTplPickerBtn: document.getElementById('closeTplPickerBtn'),
    
    // Preview & Print
    previewOverlay: document.getElementById('previewOverlay'),
    previewContainer: document.getElementById('previewContainer'),
    closePreviewBtn: document.getElementById('closePreviewBtn'),
    printBtn: document.getElementById('printBtn'),
    btnViewPi: document.getElementById('btnViewPi'),
    btnViewCi: document.getElementById('btnViewCi'),
    btnViewPl: document.getElementById('btnViewPl'),
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
        checkTransferData();
    } catch (e) {
        showToast('문서 목록을 불러오는 데 실패했습니다.', 'error');
        console.error(e);
    }
}

function checkTransferData() {
    const dataStr = localStorage.getItem('kng_transfer_data');
    if (dataStr) {
        try {
            const transfer = JSON.parse(dataStr);
            if (transfer.source === 'import-quotation' && transfer.data) {
                localStorage.removeItem('kng_transfer_data'); // 한번만 사용
                
                // 새로운 인보이스 모달 열고 데이터 주입
                openDocModal(null);
                if (transfer.data.quotationNo) {
                    const pNo = document.getElementById('inpProformaNo');
                    if (pNo) pNo.value = 'PI-' + transfer.data.quotationNo;
                }
                document.getElementById('inpShipperName').value = transfer.data.shipperName || '';
                document.getElementById('inpPortOfLoading').value = transfer.data.pol || '';
                document.getElementById('inpPortOfDischarge').value = transfer.data.pod || '';
                document.getElementById('inpIncoterms').value = transfer.data.incoterms || '';
                document.getElementById('inpPaymentTerms').value = transfer.data.paymentTerms || '';
                
                // 품목 주입
                els.itemLines.innerHTML = '';
                if (transfer.data.items && transfer.data.items.length > 0) {
                    transfer.data.items.forEach(item => {
                        createInvItemLine({
                            description: item.description || '',
                            qty: item.qty || 1,
                            unit: item.unit || 'EA',
                            unitPrice: item.unitPrice || 0,
                            amount: item.amount || 0
                        });
                    });
                } else {
                    createInvItemLine();
                }
                calcInvTotals();
                
                showToast('견적서 데이터가 인보이스에 적용되었습니다.', 'success');
            }
        } catch (e) {
            console.error('Transfer data parse error', e);
        }
    }
}
let currentTplFilterTab = 'ALL';

async function loadPartners() {
    try {
        const res = await authFetch('/api/partners');
        const erpPartners = Array.isArray(res) ? res : (res.partners || []);
        
        allPartners = erpPartners.map(p => {
            const engName = p.company_name_en ? p.company_name_en.trim() : '';
            const korName = (p.company_name || p.name || '').trim();
            const primaryName = engName || korName;
            
            // 영문 주소 및 정보 우선 매핑
            const addr = (p.address_en || p.address || '').trim();
            const tel = (p.phone_en || p.phone || p.manager1_phone || '').trim();
            const fax = (p.fax || '').trim();
            const email = (p.email_en || p.manager1_email || '').trim();

            // 다중 통화 외화 계좌 목록 파싱 (bank_accounts_json)
            let bankAccounts = [];
            try {
                if (p.bank_accounts_json) {
                    const parsed = JSON.parse(p.bank_accounts_json);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        bankAccounts = parsed.map(a => ({
                            id: a.id || ('acc_' + Math.random().toString(36).substring(2, 7)),
                            currency: a.currency || 'USD',
                            isDefault: !!a.isDefault,
                            bankName: (a.bankName || '').trim(),
                            accountNumber: (a.accountNumber || '').trim(),
                            swiftCode: (a.swiftCode || '').trim(),
                            intermediaryBank: (a.intermediaryBank || '').trim(),
                            bankAddress: (a.bankAddress || '').trim(),
                            note: (a.note || '').trim()
                        }));
                    }
                }
            } catch (e) {
                console.warn('Bank accounts JSON parse error for partner:', p.id, e);
            }

            // bank_accounts_json이 없거나 비어있는 경우 기존 단일 컬럼들로 1개 계좌 자동 구성
            if (bankAccounts.length === 0) {
                const legacyBankName = (p.bank_name_en || p.bank_name || '').trim();
                const legacyAccNo = (p.account_number_en || p.account_number || '').trim();
                const legacySwift = (p.swift_code || (p.note && p.note.match(/SWIFT[:\s]*([A-Z0-9]+)/i)?.[1]) || '').trim();
                const legacyBankAddr = (p.bank_address_en || (p.note && p.note.match(/Bank Address[:\s]*([^\n]+)/i)?.[1]) || '').trim();
                const legacyIntermediary = (p.intermediary_bank_en || '').trim();

                if (legacyBankName || legacyAccNo || legacySwift || legacyIntermediary) {
                    bankAccounts.push({
                        id: 'acc_legacy_' + p.id,
                        currency: 'USD',
                        isDefault: true,
                        bankName: legacyBankName,
                        accountNumber: legacyAccNo,
                        swiftCode: legacySwift,
                        intermediaryBank: legacyIntermediary,
                        bankAddress: legacyBankAddr,
                        note: ''
                    });
                }
            }

            // 대표 기본 계좌 선택 (isDefault 우선, 없으면 첫 번째)
            const defaultAcc = bankAccounts.find(a => a.isDefault) || bankAccounts[0] || null;

            const swift = defaultAcc ? (defaultAcc.swiftCode || '') : ((p.swift_code || (p.note && p.note.match(/SWIFT[:\s]*([A-Z0-9]+)/i)?.[1]) || '').trim());
            const bankAddress = defaultAcc ? (defaultAcc.bankAddress || '') : ((p.bank_address_en || (p.note && p.note.match(/Bank Address[:\s]*([^\n]+)/i)?.[1]) || '').trim());
            const bankName = defaultAcc ? (defaultAcc.bankName || '') : ((p.bank_name_en || p.bank_name || '').trim());
            const accountNo = defaultAcc ? (defaultAcc.accountNumber || '') : ((p.account_number_en || p.account_number || '').trim());
            const intermediaryBank = defaultAcc ? (defaultAcc.intermediaryBank || '') : ((p.intermediary_bank_en || '').trim());

            return {
                id: String(p.id),
                role: p.type === '매출처' ? 'consignee' : (p.type === '매입처' ? 'shipper' : 'all'),
                type: p.type || '기타',
                name: primaryName,
                korName: korName,
                engName: engName,
                address: addr,
                tel: tel,
                fax: fax,
                email: email,
                bankAccounts: bankAccounts,
                bankInfo: {
                    bankName: bankName,
                    accountNo: accountNo,
                    swift: swift,
                    bankAddress: bankAddress,
                    intermediaryBank: intermediaryBank,
                    currency: defaultAcc ? (defaultAcc.currency || 'USD') : 'USD',
                    note: defaultAcc ? (defaultAcc.note || '') : ''
                },
                raw: p
            };
        });
    } catch (e) {
        console.warn('ERP partners fetch failed:', e);
        allPartners = [];
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
            (d.proformaNo || '').toLowerCase().includes(q) ||
            (d.invoiceNo || '').toLowerCase().includes(q) ||
            (d.packingListNo || '').toLowerCase().includes(q) ||
            (d.consignee?.name || '').toLowerCase().includes(q) ||
            (d.portOfLoading || '').toLowerCase().includes(q)
        );
    }
    
    if (docs.length === 0) {
        els.docTableBody.innerHTML = `<tr><td colspan="10" class="inv-table-empty">
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
        if (d.proformaNo) docHtml.push(`<div class="inv-doc-badge pi" style="background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:4px;"><i class='bx bx-file-blank'></i> PI: ${d.proformaNo}</div>`);
        if (d.invoiceNo) docHtml.push(`<div class="inv-doc-badge inv">INV: ${d.invoiceNo}</div>`);
        if (d.packingListNo) docHtml.push(`<div class="inv-doc-badge pl">PL: ${d.packingListNo}</div>`);
        
        let statusBadge = `<span class="badge" style="background:#e2e8f0;color:#475569;font-size:11px;padding:2px 6px;border-radius:4px;">${d.status||'임시작성'}</span>`;
        if (d.status === '진행중') statusBadge = `<span class="badge" style="background:#dbeafe;color:#2563eb;font-size:11px;padding:2px 6px;border-radius:4px;">진행중</span>`;
        else if (d.status === '완료') statusBadge = `<span class="badge" style="background:#dcfce7;color:#16a34a;font-size:11px;padding:2px 6px;border-radius:4px;">완료</span>`;
        
        return `<tr data-id="${d.id}" onclick="editDoc('${d.id}')" title="클릭하여 거래 내역 수정">
            <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
            <td><div style="display:flex;flex-direction:column;gap:4px;">${docHtml.join('')}</div></td>
            <td>${dateStr}</td>
            <td style="font-weight:600;color:var(--gray-800);">${cName}</td>
            <td>${d.portOfLoading || '-'}</td>
            <td>${d.currency || 'USD'}</td>
            <td class="inv-amount">${amtStr}</td>
            <td style="color:var(--gray-500);font-size:11px;">${(d.createdAt||'').split('T')[0]}</td>
            <td>${statusBadge}</td>
            <td class="col-actions" onclick="event.stopPropagation()">
                <div class="inv-row-actions">
                    <button type="button" class="btn-preview" onclick="openPreview('${d.id}')" title="미리보기/인쇄"><i class='bx bx-printer'></i></button>
                    <button type="button" onclick="editDoc('${d.id}')" title="수정"><i class='bx bx-edit-alt'></i></button>
                    <button type="button" class="btn-copy" onclick="copyDoc('${d.id}')" title="문서 복사"><i class='bx bx-copy'></i></button>
                    <button type="button" class="btn-delete" onclick="deleteDoc('${d.id}')" title="삭제"><i class='bx bx-trash'></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── HTML Escape Helper ──
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── Sub-Tab Switching (P/I · C/I · P/L) ──
function initSubTabs() {
    document.querySelectorAll('#docSubTabGroup .erp-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#docSubTabGroup .erp-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.erp-sub-tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const targetId = btn.dataset.subtab;
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.add('active');
        });
    });
}
initSubTabs();

// Notify Party: Same as Consignee
if (els.chkNotifySameAsConsignee) {
    els.chkNotifySameAsConsignee.addEventListener('change', () => {
        if (els.chkNotifySameAsConsignee.checked) {
            document.getElementById('inpNotifyName').value = document.getElementById('inpConsigneeName').value;
            document.getElementById('inpNotifyTel').value = document.getElementById('inpConsigneeTel').value;
            document.getElementById('inpNotifyAddress').value = document.getElementById('inpConsigneeAddress').value;
            showToast('Notify Party 정보가 Consignee와 동일하게 적용되었습니다.');
        }
    });
}

// Sync P/I info to C/I
if (els.btnSyncFromPiToCi) {
    els.btnSyncFromPiToCi.addEventListener('click', () => {
        const piNo = document.getElementById('inpProformaNo')?.value?.trim();
        const piDate = document.getElementById('inpDocDate')?.value;
        const ciNoEl = document.getElementById('inpInvoiceNo');
        const ciDateEl = document.getElementById('inpCiDate');
        
        if (piNo && ciNoEl && !ciNoEl.value) {
            ciNoEl.value = piNo.startsWith('PI-') ? piNo.replace('PI-', 'INV-') : ('INV-' + piNo);
        }
        if (piDate && ciDateEl && !ciDateEl.value) {
            ciDateEl.value = piDate;
        }
        showToast('P/I 번호 및 일자가 C/I에 동기화되었습니다.');
    });
}

// ── Item Lines Logic (ECOUNT ERP Sheet Table) ──
function refreshItemRowNumbers() {
    if (!els.itemLines) return;
    Array.from(els.itemLines.children).forEach((row, idx) => {
        const numEl = row.querySelector('.row-num');
        if (numEl) numEl.textContent = idx + 1;
    });
}

// Invoice Items
function createInvItemLine(item = {}) {
    const tr = document.createElement('tr');
    tr.className = 'item-row';
    const unitVal = (item.unit || 'EA').toUpperCase();
    const qtyVal = item.qty !== undefined && item.qty !== null && item.qty !== '' ? item.qty : '';
    const priceVal = item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== '' ? item.unitPrice : '';
    const amtVal = item.amount !== undefined && item.amount !== null && item.amount !== '' ? Number(item.amount).toFixed(2) : '0.00';

    tr.innerHTML = `
        <td style="text-align:center; color:#64748b; font-weight:700;" class="row-num"></td>
        <td><input type="text" placeholder="품명 및 규격" class="i-desc" value="${escapeHtml(item.description || '')}"></td>
        <td><input type="text" placeholder="HS Code" class="i-hs text-center" value="${escapeHtml(item.hsCode || '')}"></td>
        <td><input type="number" placeholder="0" class="i-qty text-end" min="0" step="any" value="${qtyVal}"></td>
        <td>
            <select class="i-unit text-center">
                <option value="EA"${unitVal === 'EA' ? ' selected' : ''}>EA</option>
                <option value="PCS"${unitVal === 'PCS' ? ' selected' : ''}>PCS</option>
                <option value="SET"${unitVal === 'SET' ? ' selected' : ''}>SET</option>
                <option value="BOX"${unitVal === 'BOX' ? ' selected' : ''}>BOX</option>
                <option value="KG"${unitVal === 'KG' ? ' selected' : ''}>KG</option>
                <option value="ROLL"${unitVal === 'ROLL' ? ' selected' : ''}>ROLL</option>
                <option value="MTR"${unitVal === 'MTR' ? ' selected' : ''}>MTR</option>
                <option value="CTN"${unitVal === 'CTN' ? ' selected' : ''}>CTN</option>
                <option value="PR"${unitVal === 'PR' ? ' selected' : ''}>PR</option>
            </select>
        </td>
        <td><input type="number" placeholder="0.00" class="i-price text-end" min="0" step="0.01" value="${priceVal}"></td>
        <td><input type="text" class="item-amount text-end fw-bold" readonly tabindex="-1" value="${amtVal}"></td>
        <td style="text-align:center;">
            <div style="display:flex; justify-content:center; gap:2px;">
                <button type="button" class="btn-row-action btn-row-copy" title="동일 품목 복사 행 추가"><i class='bx bx-copy'></i></button>
                <button type="button" class="btn-row-action btn-row-del" title="삭제"><i class='bx bx-trash'></i></button>
            </div>
        </td>
    `;
    
    const inputs = tr.querySelectorAll('.i-qty, .i-price');
    inputs.forEach(inp => inp.addEventListener('input', calcInvTotals));
    
    tr.querySelector('.btn-row-copy').addEventListener('click', () => {
        const curData = {
            description: tr.querySelector('.i-desc').value,
            hsCode: tr.querySelector('.i-hs').value,
            qty: tr.querySelector('.i-qty').value,
            unit: tr.querySelector('.i-unit').value,
            unitPrice: tr.querySelector('.i-price').value,
            amount: tr.querySelector('.item-amount').value
        };
        createInvItemLine(curData);
        calcInvTotals();
        showToast('동일 품목이 복사 추가되었습니다.');
    });

    tr.querySelector('.btn-row-del').addEventListener('click', () => {
        tr.remove();
        calcInvTotals();
        refreshItemRowNumbers();
    });

    els.itemLines.appendChild(tr);
    refreshItemRowNumbers();
}

function calcInvTotals() {
    let totQty = 0, totAmt = 0;
    Array.from(els.itemLines.children).forEach(row => {
        const qty = parseFloat(row.querySelector('.i-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.i-price')?.value) || 0;
        const amt = qty * price;
        const amtEl = row.querySelector('.item-amount');
        if (amtEl) amtEl.value = amt.toFixed(2);
        totQty += qty;
        totAmt += amt;
    });
    if (document.getElementById('totQty')) document.getElementById('totQty').textContent = totQty.toLocaleString();
    if (document.getElementById('totAmount')) document.getElementById('totAmount').textContent = totAmt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function gatherInvItems() {
    return Array.from(els.itemLines.children).map(row => ({
        description: row.querySelector('.i-desc')?.value.trim() || '',
        hsCode: row.querySelector('.i-hs')?.value.trim() || '',
        qty: parseFloat(row.querySelector('.i-qty')?.value) || 0,
        unit: row.querySelector('.i-unit')?.value.trim() || 'EA',
        unitPrice: parseFloat(row.querySelector('.i-price')?.value) || 0,
        amount: parseFloat(row.querySelector('.item-amount')?.value) || 0
    })).filter(i => i.description || i.qty > 0);
}

// Packing List Items
function createPlItemLine(item = {}) {
    const tr = document.createElement('tr');
    tr.className = 'pl-row';
    const unitVal = (item.unit || 'EA').toUpperCase();
    tr.innerHTML = `
        <td><input type="text" placeholder="컨테이너/씰 번호" class="pl-cont" value="${escapeHtml(item.containerNo || '')}"></td>
        <td><input type="text" placeholder="품명 및 규격" class="pl-desc" value="${escapeHtml(item.description || '')}"></td>
        <td><input type="number" placeholder="0" class="pl-qty text-end" min="0" value="${item.qty !== undefined && item.qty !== null && item.qty !== '' ? item.qty : ''}"></td>
        <td><input type="text" placeholder="EA" class="pl-unit text-center" value="${escapeHtml(unitVal)}"></td>
        <td><input type="number" placeholder="0.00" class="pl-nw text-end" min="0" step="0.01" value="${item.netWeight !== undefined && item.netWeight !== null && item.netWeight !== '' ? item.netWeight : ''}"></td>
        <td><input type="number" placeholder="0.00" class="pl-gw text-end" min="0" step="0.01" value="${item.grossWeight !== undefined && item.grossWeight !== null && item.grossWeight !== '' ? item.grossWeight : ''}"></td>
        <td><input type="number" placeholder="0.000" class="pl-cbm text-end" min="0" step="0.001" value="${item.cbm !== undefined && item.cbm !== null && item.cbm !== '' ? item.cbm : ''}"></td>
        <td><input type="text" placeholder="비고" class="pl-rmk" value="${escapeHtml(item.remarks || '')}"></td>
        <td style="text-align:center;">
            <button type="button" class="btn-row-action btn-row-del" title="삭제"><i class='bx bx-trash'></i></button>
        </td>
    `;
    
    const inputs = tr.querySelectorAll('.pl-nw, .pl-gw, .pl-cbm');
    inputs.forEach(inp => inp.addEventListener('input', calcPlTotals));
    
    tr.querySelector('.btn-row-del').addEventListener('click', () => {
        tr.remove();
        calcPlTotals();
    });
    
    els.plItemLines.appendChild(tr);
}

function calcPlTotals() {
    let totNW = 0, totGW = 0, totCBM = 0;
    Array.from(els.plItemLines.children).forEach(row => {
        totNW += parseFloat(row.querySelector('.pl-nw')?.value) || 0;
        totGW += parseFloat(row.querySelector('.pl-gw')?.value) || 0;
        totCBM += parseFloat(row.querySelector('.pl-cbm')?.value) || 0;
    });
    if (document.getElementById('totNW')) document.getElementById('totNW').textContent = totNW.toFixed(2);
    if (document.getElementById('totGW')) document.getElementById('totGW').textContent = totGW.toFixed(2);
    if (document.getElementById('totCBM')) document.getElementById('totCBM').textContent = totCBM.toFixed(3);
}

function gatherPlItems() {
    return Array.from(els.plItemLines.children).map(row => ({
        containerNo: row.querySelector('.pl-cont')?.value.trim() || '',
        description: row.querySelector('.pl-desc')?.value.trim() || '',
        qty: parseFloat(row.querySelector('.pl-qty')?.value) || 0,
        unit: row.querySelector('.pl-unit')?.value.trim() || 'EA',
        netWeight: parseFloat(row.querySelector('.pl-nw')?.value) || 0,
        grossWeight: parseFloat(row.querySelector('.pl-gw')?.value) || 0,
        cbm: parseFloat(row.querySelector('.pl-cbm')?.value) || 0,
        remarks: row.querySelector('.pl-rmk')?.value.trim() || ''
    })).filter(i => i.description || i.qty > 0 || i.containerNo || i.netWeight > 0);
}

if (els.copyFromInvBtn) {
    els.copyFromInvBtn.addEventListener('click', () => {
        const invItems = gatherInvItems();
        if (invItems.length === 0) return showToast('가져올 인보이스 품목이 없습니다.', 'error');
        const cNo = document.getElementById('inpPlContainerNo')?.value?.trim() || '';
        invItems.forEach(i => {
            createPlItemLine({
                containerNo: cNo,
                description: i.description,
                qty: i.qty,
                unit: i.unit,
                netWeight: 0,
                grossWeight: 0,
                cbm: 0,
                remarks: ''
            });
        });
        calcPlTotals();
        showToast(`${invItems.length}개의 인보이스 품목을 팩킹리스트로 가져왔습니다.`);
    });
}

// ── P/I Terms & Conditions Template Generator ──
function generateDefaultPiTerms(totalAmount = 0, currency = 'USD') {
    const curCode = currency || 'USD';
    const sym = { USD: 'US$', EUR: 'EUR', KRW: 'KRW ₩', CNY: 'CNY ¥', JPY: 'JPY ¥', GBP: 'GBP £' }[curCode] || curCode;
    
    let depStr = '2,940.00';
    let balStr = '6,370.00';
    let retStr = '490.00';
    
    if (totalAmount > 0) {
        depStr = Number(totalAmount * 0.30).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        balStr = Number(totalAmount * 0.65).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        retStr = Number(totalAmount * 0.05).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Shipper / Bank Info fallback
    const sBank = document.getElementById('inpShipperBank')?.value?.trim();
    const sAcc = document.getElementById('inpShipperAccountNo')?.value?.trim();
    const sSwift = document.getElementById('inpShipperSwift')?.value?.trim();
    const sIntermediary = document.getElementById('inpShipperIntermediaryBank')?.value?.trim();
    const sBankAddr = document.getElementById('inpShipperBankAddress')?.value?.trim();
    const sName = document.getElementById('inpShipperName')?.value?.trim();
    const sAddr = document.getElementById('inpShipperAddress')?.value?.trim();

    const beneficiary = sName || 'Zhejiang Glory Garment Co.,Ltd';
    const address = sAddr || 'No.209, Hengtai Road, Huibu Town, Changshan County Quzhou City, Zhejiang Province';
    const bankName = sBank || 'ZHEJIANG TAILONG COMMERCIAL BANK CO.,LTD';
    const swift = sSwift || 'ZJTLCNBH';
    const acctNo = sAcc || '3302011420100019730';
    const intermediary = sIntermediary || '';
    const bankAddr = sBankAddr || '';

    let designatedBankLines = [
        `   [Seller's Designated Bank Account]`,
        `   - Beneficiary      : ${beneficiary}`,
        `   - Address          : ${address}`,
        `   - Beneficiary Bank : ${bankName}`
    ];
    if (bankAddr) {
        designatedBankLines.push(`   - Bank Address     : ${bankAddr}`);
    }
    designatedBankLines.push(`   - SWIFT CODE       : ${swift}`);
    designatedBankLines.push(`   - A/C              : ${acctNo}`);
    if (intermediary) {
        designatedBankLines.push(`   - Intermediary Bank: ${intermediary}`);
    }
    designatedBankLines.push(`   * Note: Any request to change the bank account above via email shall be strictly invalid to prevent wire fraud.`);

    return `1) Payment Terms & Seller's Bank Information:
   All payments shall be made in ${curCode} by T/T as follows:
   - 30% Deposit (${sym} ${depStr}): Upon signing this Proforma Invoice.
   - 65% Balance (${sym} ${balStr}): Before shipment release, upon Buyer's confirmation of TOP (Top of Production) sample, shipping photos, and B/L copy.
   - 5% Final Retention (${sym} ${retStr}): Payable within 5 business days after goods arrive at the port in Korea, following a basic quality and quantity check.

${designatedBankLines.join('\n')}

2) Delivery, Lead Time & Delay Penalty:
   - PP (Pre-Production) sample approval shall be confirmed within 10 days after deposit receipt.
   - Mass production lead time: within 75 days after PP sample approval.
   - Trade Terms: FOB Shanghai.
   - In case of delayed delivery attributable to Seller, a delay penalty of 0.5% per day (up to max 10% of total contract value) shall be deducted from the balance payment.

3) Shipping Documents & Customs Clearance:
   - Seller shall provide Surrendered B/L, Commercial Invoice, Packing List, and Korea-China FTA Certificate of Origin (C/O) for Buyer's duty concession.
   - All goods must have sewn-in "Made in China" country of origin labels conforming to Korean Customs regulations.

4) Quality Assurance, Claims & Legal Effect:
   - Buyer reserves the right to inspect goods upon arrival at the port in Korea. Any defect or shortage claim shall be submitted in writing within 14 days after port arrival.
   - This Proforma Invoice, upon being signed and exchanged by both parties (including scanned electronic copies), shall constitute a legally binding Sales Contract governed by the United Nations Convention on Contracts for the International Sale of Goods (CISG). Any dispute arising hereof shall be resolved amicably, failing which it shall be submitted to arbitration (KCAB or CIETAC).`;
}

// Template Button Listeners
if (els.btnLoadPiTpl) {
    els.btnLoadPiTpl.addEventListener('click', () => {
        calcInvTotals();
        const tot = parseFloat(document.getElementById('totAmount')?.textContent?.replace(/,/g, '')) || 0;
        const cur = document.getElementById('inpCurrency')?.value || 'USD';
        if (els.inpTermsAndConditions) {
            els.inpTermsAndConditions.value = generateDefaultPiTerms(tot, cur);
            showToast('계약 특약사항(T&C) 표준 템플릿이 적용되었습니다.');
        }
    });
}
if (els.btnClearPiTpl) {
    els.btnClearPiTpl.addEventListener('click', () => {
        if (!els.inpTermsAndConditions) return;
        if (!els.inpTermsAndConditions.value || confirm('특약사항 내용을 지우시겠습니까?')) {
            els.inpTermsAndConditions.value = '';
            showToast('특약사항이 초기화되었습니다.');
        }
    });
}

// ── Modal Logic (Create/Edit - ECOUNT ERP Style) ──
function resetSubTabToPi() {
    document.querySelectorAll('#docSubTabGroup .erp-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.subtab === 'piTab');
    });
    document.querySelectorAll('.erp-sub-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === 'piTab');
    });
}

function openDocModal(doc = null) {
    els.docForm.reset();
    els.itemLines.innerHTML = '';
    els.plItemLines.innerHTML = '';
    resetSubTabToPi();
    
    if (doc) {
        els.modalTitle.textContent = '무역 전표 수정';
        if (els.modalDocBadge) {
            els.modalDocBadge.textContent = doc.proformaNo || doc.invoiceNo || doc.id || '전표 수정';
        }
        document.getElementById('editId').value = doc.id;
        document.getElementById('inpStatus').value = doc.status || '임시작성';
        
        // Common
        document.getElementById('inpCurrency').value = doc.currency || 'USD';
        document.getElementById('inpIncoterms').value = doc.incoterms || '';
        document.getElementById('inpPortOfLoading').value = doc.portOfLoading || '';
        document.getElementById('inpPortOfDischarge').value = doc.portOfDischarge || '';
        document.getElementById('inpFinalDestination').value = doc.finalDestination || '';
        document.getElementById('inpCountryOfOrigin').value = doc.countryOfOrigin || '';
        document.getElementById('inpPaymentTerms').value = doc.paymentTerms || '';
        
        // Shipper
        document.getElementById('inpShipperName').value = doc.shipper?.name || '';
        document.getElementById('inpShipperAddress').value = doc.shipper?.address || '';
        document.getElementById('inpShipperTel').value = doc.shipper?.tel || '';
        document.getElementById('inpShipperFax').value = doc.shipper?.fax || '';
        document.getElementById('inpShipperEmail').value = doc.shipper?.email || '';
        document.getElementById('inpShipperBank').value = doc.shipper?.bankInfo?.bankName || '';
        document.getElementById('inpShipperAccountNo').value = doc.shipper?.bankInfo?.accountNo || '';
        document.getElementById('inpShipperSwift').value = doc.shipper?.bankInfo?.swift || '';
        document.getElementById('inpShipperIntermediaryBank').value = doc.shipper?.bankInfo?.intermediaryBank || '';
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
        if (els.chkNotifySameAsConsignee) {
            els.chkNotifySameAsConsignee.checked = !!(doc.notifyParty?.name && doc.notifyParty?.name === doc.consignee?.name);
        }
        
        // Sub-Tab 1: P/I
        if (els.inpProformaNo) els.inpProformaNo.value = doc.proformaNo || '';
        document.getElementById('inpDocDate').value = doc.docDate || '';
        const ed = doc.extraData || {};
        if (document.getElementById('inpPiValidity')) document.getElementById('inpPiValidity').value = ed.piValidity || doc.piValidity || '';
        if (document.getElementById('inpPiShipmentDeadline')) document.getElementById('inpPiShipmentDeadline').value = ed.piShipmentDeadline || doc.piShipmentDeadline || '';
        if (document.getElementById('inpPiPartialShipment')) document.getElementById('inpPiPartialShipment').value = ed.piPartialShipment || doc.piPartialShipment || 'Not Allowed';
        if (document.getElementById('inpPiTransshipment')) document.getElementById('inpPiTransshipment').value = ed.piTransshipment || doc.piTransshipment || 'Not Allowed';
        if (document.getElementById('inpPiPaymentDetail')) document.getElementById('inpPiPaymentDetail').value = ed.piPaymentDetail || doc.piPaymentDetail || '';
        if (els.chkPiBuyerSign) {
            els.chkPiBuyerSign.checked = ed.includeBuyerSign !== undefined ? !!ed.includeBuyerSign : (doc.includeBuyerSign !== undefined ? !!doc.includeBuyerSign : true);
        }
        if (els.inpTermsAndConditions) els.inpTermsAndConditions.value = doc.termsAndConditions || '';
        
        // Sub-Tab 2: C/I
        document.getElementById('inpInvoiceNo').value = doc.invoiceNo || '';
        if (document.getElementById('inpCiDate')) document.getElementById('inpCiDate').value = ed.ciDate || doc.ciDate || doc.docDate || '';
        document.getElementById('inpVessel').value = doc.vessel || '';
        document.getElementById('inpDepartureDate').value = doc.departureDate || '';
        if (document.getElementById('inpArrivalDate')) document.getElementById('inpArrivalDate').value = ed.arrivalDate || doc.arrivalDate || '';
        if (document.getElementById('inpBlNo')) document.getElementById('inpBlNo').value = ed.blNo || doc.blNo || '';
        if (document.getElementById('inpCoNo')) document.getElementById('inpCoNo').value = ed.coNo || doc.coNo || '';
        document.getElementById('inpRemarks').value = doc.remarks || '';
        
        // Sub-Tab 3: P/L
        document.getElementById('inpPackingListNo').value = doc.packingListNo || '';
        if (document.getElementById('inpPlDate')) document.getElementById('inpPlDate').value = ed.plDate || doc.plDate || doc.docDate || '';
        if (document.getElementById('inpPlContainerNo')) document.getElementById('inpPlContainerNo').value = ed.containerNo || doc.containerNo || '';
        if (document.getElementById('inpPlSealNo')) document.getElementById('inpPlSealNo').value = ed.sealNo || doc.sealNo || '';
        if (document.getElementById('inpPlTotalPackages')) document.getElementById('inpPlTotalPackages').value = ed.totalPackages || doc.totalPackages || '';
        if (document.getElementById('inpPlShippingMark')) document.getElementById('inpPlShippingMark').value = ed.shippingMark || doc.shippingMark || '';
        
        // Items
        if (doc.items && doc.items.length > 0) {
            doc.items.forEach(item => createInvItemLine(item));
        } else {
            createInvItemLine();
        }
        
        if (doc.packingItems && doc.packingItems.length > 0) {
            doc.packingItems.forEach(item => createPlItemLine(item));
        } else {
            createPlItemLine();
        }
        
        calcInvTotals();
        calcPlTotals();
        
    } else {
        els.modalTitle.textContent = '신규 거래 전표 생성';
        if (els.modalDocBadge) els.modalDocBadge.textContent = '신규 전표';
        document.getElementById('editId').value = '';
        document.getElementById('inpStatus').value = '임시작성';
        document.getElementById('inpCurrency').value = 'USD';
        document.getElementById('inpIncoterms').value = '';
        document.getElementById('inpPortOfLoading').value = '';
        document.getElementById('inpPortOfDischarge').value = '';
        document.getElementById('inpFinalDestination').value = '';
        document.getElementById('inpCountryOfOrigin').value = 'Republic of Korea';
        document.getElementById('inpPaymentTerms').value = '';
        
        // Shipper 초기화
        document.getElementById('inpShipperName').value = '';
        document.getElementById('inpShipperAddress').value = '';
        document.getElementById('inpShipperTel').value = '';
        document.getElementById('inpShipperFax').value = '';
        document.getElementById('inpShipperEmail').value = '';
        document.getElementById('inpShipperBank').value = '';
        document.getElementById('inpShipperAccountNo').value = '';
        document.getElementById('inpShipperSwift').value = '';
        document.getElementById('inpShipperIntermediaryBank').value = '';
        document.getElementById('inpShipperBankAddress').value = '';

        // Consignee 초기화
        document.getElementById('inpConsigneeName').value = '';
        document.getElementById('inpConsigneeAddress').value = '';
        document.getElementById('inpConsigneeTel').value = '';
        document.getElementById('inpConsigneeFax').value = '';
        document.getElementById('inpConsigneeEmail').value = '';

        // Notify Party 초기화
        document.getElementById('inpNotifyName').value = '';
        document.getElementById('inpNotifyAddress').value = '';
        document.getElementById('inpNotifyTel').value = '';
        if (els.chkNotifySameAsConsignee) els.chkNotifySameAsConsignee.checked = false;

        const todayStr = new Date().toISOString().split('T')[0];
        if (els.inpProformaNo) els.inpProformaNo.value = '';
        document.getElementById('inpDocDate').value = todayStr;
        if (document.getElementById('inpPiValidity')) document.getElementById('inpPiValidity').value = '30 days from date hereof';
        if (document.getElementById('inpPiShipmentDeadline')) document.getElementById('inpPiShipmentDeadline').value = '';
        if (document.getElementById('inpPiPartialShipment')) document.getElementById('inpPiPartialShipment').value = 'Not Allowed';
        if (document.getElementById('inpPiTransshipment')) document.getElementById('inpPiTransshipment').value = 'Not Allowed';
        if (document.getElementById('inpPiPaymentDetail')) document.getElementById('inpPiPaymentDetail').value = '';
        if (els.chkPiBuyerSign) els.chkPiBuyerSign.checked = true;
        if (els.inpTermsAndConditions) els.inpTermsAndConditions.value = '';

        document.getElementById('inpInvoiceNo').value = '';
        if (document.getElementById('inpCiDate')) document.getElementById('inpCiDate').value = todayStr;
        document.getElementById('inpVessel').value = '';
        document.getElementById('inpDepartureDate').value = '';
        if (document.getElementById('inpArrivalDate')) document.getElementById('inpArrivalDate').value = '';
        if (document.getElementById('inpBlNo')) document.getElementById('inpBlNo').value = '';
        if (document.getElementById('inpCoNo')) document.getElementById('inpCoNo').value = '';
        document.getElementById('inpRemarks').value = '';

        document.getElementById('inpPackingListNo').value = '';
        if (document.getElementById('inpPlDate')) document.getElementById('inpPlDate').value = todayStr;
        if (document.getElementById('inpPlContainerNo')) document.getElementById('inpPlContainerNo').value = '';
        if (document.getElementById('inpPlSealNo')) document.getElementById('inpPlSealNo').value = '';
        if (document.getElementById('inpPlTotalPackages')) document.getElementById('inpPlTotalPackages').value = '';
        if (document.getElementById('inpPlShippingMark')) document.getElementById('inpPlShippingMark').value = '';

        createInvItemLine();
        createPlItemLine();
        calcInvTotals();
        calcPlTotals();
    }
    
    initialDocSnapshot = getDocFormSnapshot();
    els.docModal.classList.add('active');
}

let initialDocSnapshot = null;

function getDocFormSnapshot() {
    if (!els.docForm) return '';
    const data = new FormData(els.docForm);
    const obj = Object.fromEntries(data.entries());
    const invItems = [...els.itemLines.querySelectorAll('.item-row')].map(r => ({
        desc: r.querySelector('.i-desc')?.value || '',
        hs: r.querySelector('.i-hs')?.value || '',
        qty: r.querySelector('.i-qty')?.value || '',
        unit: r.querySelector('.i-unit')?.value || '',
        price: r.querySelector('.i-price')?.value || ''
    }));
    const plItems = els.plItemLines ? [...els.plItemLines.querySelectorAll('.pl-row')].map(r => ({
        cont: r.querySelector('.pl-cont')?.value || '',
        desc: r.querySelector('.pl-desc')?.value || '',
        qty: r.querySelector('.pl-qty')?.value || '',
        unit: r.querySelector('.pl-unit')?.value || '',
        nw: r.querySelector('.pl-nw')?.value || '',
        gw: r.querySelector('.pl-gw')?.value || '',
        cbm: r.querySelector('.pl-cbm')?.value || ''
    })) : [];
    return JSON.stringify({ obj, invItems, plItems, terms: els.inpTermsAndConditions?.value || '' });
}

function isDocDirty() {
    if (!initialDocSnapshot) return false;
    return getDocFormSnapshot() !== initialDocSnapshot;
}

function closeDocModal(force = false) {
    if (!force && isDocDirty()) {
        if (!confirm('작성 중이거나 변경된 내용이 저장되지 않았습니다.\n창을 닫으시겠습니까? (작성 중인 내용은 사라집니다)')) {
            return;
        }
    }
    initialDocSnapshot = null;
    els.docModal.classList.remove('active');
}

window.editDoc = function(id) {
    const doc = allDocs.find(d => d.id === id);
    if (doc) openDocModal(doc);
};

window.copyDoc = function(id) {
    const doc = allDocs.find(d => d.id === id);
    if (!doc) return;
    
    // 깊은 복사 후 ID 초기화 및 제목 수정
    const clonedDoc = JSON.parse(JSON.stringify(doc));
    clonedDoc.id = ''; 
    if (clonedDoc.proformaNo) clonedDoc.proformaNo = clonedDoc.proformaNo + '-COPY';
    if (clonedDoc.invoiceNo) clonedDoc.invoiceNo = clonedDoc.invoiceNo + '-COPY';
    if (clonedDoc.packingListNo) clonedDoc.packingListNo = clonedDoc.packingListNo + '-COPY';
    
    openDocModal(clonedDoc);
    els.modalTitle.textContent = '문서 복사 생성';
    showToast('문서 내용이 복사되었습니다. 저장 시 새로운 전표로 생성됩니다.');
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
    
    const extraData = {
        piValidity: document.getElementById('inpPiValidity')?.value?.trim() || '',
        piShipmentDeadline: document.getElementById('inpPiShipmentDeadline')?.value?.trim() || '',
        piPartialShipment: document.getElementById('inpPiPartialShipment')?.value || 'Not Allowed',
        piTransshipment: document.getElementById('inpPiTransshipment')?.value || 'Not Allowed',
        piPaymentDetail: document.getElementById('inpPiPaymentDetail')?.value?.trim() || '',
        includeBuyerSign: !!document.getElementById('chkPiBuyerSign')?.checked,
        
        ciDate: document.getElementById('inpCiDate')?.value || '',
        blNo: document.getElementById('inpBlNo')?.value?.trim() || '',
        arrivalDate: document.getElementById('inpArrivalDate')?.value || '',
        coNo: document.getElementById('inpCoNo')?.value?.trim() || '',
        
        plDate: document.getElementById('inpPlDate')?.value || '',
        containerNo: document.getElementById('inpPlContainerNo')?.value?.trim() || '',
        sealNo: document.getElementById('inpPlSealNo')?.value?.trim() || '',
        totalPackages: document.getElementById('inpPlTotalPackages')?.value?.trim() || '',
        shippingMark: document.getElementById('inpPlShippingMark')?.value?.trim() || '',
        totalCbm: parseFloat(document.getElementById('totCBM')?.textContent) || 0
    };
    
    const payload = {
        status: document.getElementById('inpStatus')?.value || '임시작성',
        proformaNo: els.inpProformaNo ? els.inpProformaNo.value.trim() : '',
        invoiceNo: document.getElementById('inpInvoiceNo')?.value?.trim() || '',
        packingListNo: document.getElementById('inpPackingListNo')?.value?.trim() || '',
        docDate: document.getElementById('inpDocDate')?.value || '',
        currency: document.getElementById('inpCurrency')?.value || 'USD',
        
        shipper: {
            name: document.getElementById('inpShipperName')?.value?.trim() || '',
            address: document.getElementById('inpShipperAddress')?.value?.trim() || '',
            tel: document.getElementById('inpShipperTel')?.value?.trim() || '',
            fax: document.getElementById('inpShipperFax')?.value?.trim() || '',
            email: document.getElementById('inpShipperEmail')?.value?.trim() || '',
            bankInfo: {
                bankName: document.getElementById('inpShipperBank')?.value?.trim() || '',
                accountNo: document.getElementById('inpShipperAccountNo')?.value?.trim() || '',
                swift: document.getElementById('inpShipperSwift')?.value?.trim() || '',
                intermediaryBank: document.getElementById('inpShipperIntermediaryBank')?.value?.trim() || '',
                bankAddress: document.getElementById('inpShipperBankAddress')?.value?.trim() || ''
            }
        },
        consignee: {
            name: document.getElementById('inpConsigneeName')?.value?.trim() || '',
            address: document.getElementById('inpConsigneeAddress')?.value?.trim() || '',
            tel: document.getElementById('inpConsigneeTel')?.value?.trim() || '',
            fax: document.getElementById('inpConsigneeFax')?.value?.trim() || '',
            email: document.getElementById('inpConsigneeEmail')?.value?.trim() || ''
        },
        notifyParty: {
            name: document.getElementById('inpNotifyName')?.value?.trim() || '',
            address: document.getElementById('inpNotifyAddress')?.value?.trim() || '',
            tel: document.getElementById('inpNotifyTel')?.value?.trim() || ''
        },
        
        countryOfOrigin: document.getElementById('inpCountryOfOrigin')?.value?.trim() || '',
        departureDate: document.getElementById('inpDepartureDate')?.value || '',
        vessel: document.getElementById('inpVessel')?.value?.trim() || '',
        incoterms: document.getElementById('inpIncoterms')?.value?.trim() || '',
        portOfLoading: document.getElementById('inpPortOfLoading')?.value?.trim() || '',
        portOfDischarge: document.getElementById('inpPortOfDischarge')?.value?.trim() || '',
        finalDestination: document.getElementById('inpFinalDestination')?.value?.trim() || '',
        paymentTerms: document.getElementById('inpPaymentTerms')?.value?.trim() || '',
        
        items: gatherInvItems(),
        packingItems: gatherPlItems(),
        termsAndConditions: els.inpTermsAndConditions ? els.inpTermsAndConditions.value.trim() : '',
        remarks: document.getElementById('inpRemarks')?.value?.trim() || '',
        
        totalAmount: parseFloat(document.getElementById('totAmount')?.textContent?.replace(/,/g,'')) || 0,
        totalQty: parseFloat(document.getElementById('totQty')?.textContent?.replace(/,/g,'')) || 0,
        totalNetWeight: parseFloat(document.getElementById('totNW')?.textContent) || 0,
        totalGrossWeight: parseFloat(document.getElementById('totGW')?.textContent) || 0,
        totalMeasurement: extraData.totalCbm,
        extraData: extraData
    };
    
    try {
        const url = isEdit ? `/api/invoice-packing/documents/${id}` : `/api/invoice-packing/documents`;
        const method = isEdit ? 'PUT' : 'POST';
        await authFetch(url, { method, body: JSON.stringify(payload) });
        
        showToast(isEdit ? '무역 전표가 수정되었습니다.' : '신규 무역 전표가 저장되었습니다.');
        closeDocModal(true);
        loadDocs();
    } catch (e) {
        showToast('저장 실패: ' + e.message, 'error');
    }
});

// ── Central Partners Management Navigation ──
function openPartnersManagement() {
    try {
        if (window.parent && window.parent.document) {
            const link = window.parent.document.querySelector('a[href*="03_monthly_closing/partners"]');
            if (link) {
                link.click();
                return;
            }
        }
    } catch (e) {}
    window.open('../../03_monthly_closing/partners/index.html', '_blank');
}

// ── Template Picker Logic (정산/거래처 연동) ──
function renderTplPickerList() {
    const search = (els.tplSearchInput?.value || '').toLowerCase().trim();
    let filtered = allPartners;

    // 1. 구분 필터
    if (currentTplFilterTab === 'OVERSEAS') {
        filtered = filtered.filter(p => p.engName || p.type === '해외/무역' || /[a-zA-Z]/.test(p.name) || (p.bankAccounts && p.bankAccounts.length > 0));
    } else if (currentTplFilterTab === '매입처') {
        filtered = filtered.filter(p => p.type === '매입처' || p.role === 'shipper');
    } else if (currentTplFilterTab === '매출처') {
        filtered = filtered.filter(p => p.type === '매출처' || p.role === 'consignee');
    }

    // 2. 검색어 필터
    if (search) {
        filtered = filtered.filter(p => 
            (p.name && p.name.toLowerCase().includes(search)) ||
            (p.korName && p.korName.toLowerCase().includes(search)) ||
            (p.engName && p.engName.toLowerCase().includes(search)) ||
            (p.address && p.address.toLowerCase().includes(search)) ||
            (p.tel && p.tel.includes(search)) ||
            (p.email && p.email.toLowerCase().includes(search)) ||
            (p.bankInfo?.bankName && p.bankInfo.bankName.toLowerCase().includes(search)) ||
            (p.bankAccounts && p.bankAccounts.some(a => 
                (a.bankName && a.bankName.toLowerCase().includes(search)) ||
                (a.accountNumber && a.accountNumber.toLowerCase().includes(search)) ||
                (a.swiftCode && a.swiftCode.toLowerCase().includes(search)) ||
                (a.intermediaryBank && a.intermediaryBank.toLowerCase().includes(search)) ||
                (a.note && a.note.toLowerCase().includes(search))
            ))
        );
    }

    const emptyEl = document.getElementById('tplPickerEmpty');
    if (filtered.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
        els.tplPickerList.innerHTML = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    els.tplPickerList.innerHTML = filtered.map(p => {
        const typeBadge = `<span class="badge" style="background:#eff6ff;color:#2563eb;font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid #bfdbfe;">${p.type || '거래처'}</span>`;
        const engBadge = p.engName ? `<span class="badge" style="background:#e0e7ff;color:#3730a3;font-size:10px;padding:2px 6px;border-radius:4px;"><i class='bx bx-globe'></i> 영문</span>` : '';

        // 계좌 목록 UI 구성
        let bankHtml = '';
        const accounts = (p.bankAccounts && p.bankAccounts.length > 0) ? p.bankAccounts : (p.bankInfo?.bankName ? [{
            id: 'legacy',
            currency: 'USD',
            isDefault: true,
            bankName: p.bankInfo.bankName,
            accountNumber: p.bankInfo.accountNo,
            swiftCode: p.bankInfo.swift,
            intermediaryBank: p.bankInfo.intermediaryBank,
            bankAddress: p.bankInfo.bankAddress,
            note: ''
        }] : []);

        if (accounts.length > 0) {
            const currColors = { USD: '#2563eb', EUR: '#059669', CNY: '#dc2626', JPY: '#7c3aed', HKD: '#d97706', GBP: '#475569', KRW: '#0891b2' };
            bankHtml = `
                <div style="margin-top:8px; padding-top:6px; border-top:1px dashed #e2e8f0;">
                    <div style="font-size:10.5px; font-weight:700; color:#475569; margin-bottom:5px; display:flex; align-items:center; justify-content:space-between;">
                        <span><i class='bx bxs-bank' style="color:#2563eb;"></i> 외화 결제 계좌 (${accounts.length}개)</span>
                        <span style="font-size:9.5px; font-weight:normal; color:#64748b;">원하는 계좌 버튼 클릭 시 해당 계좌로 즉시 적용</span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        ${accounts.map((acc, aIdx) => {
                            const badgeColor = currColors[acc.currency] || '#334155';
                            return `
                                <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; padding:6px 9px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px;">
                                    <div style="min-width:0; flex:1;">
                                        <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                                            <span style="background:${badgeColor}; color:#fff; font-size:9.5px; font-weight:700; padding:1px 5px; border-radius:3px;">
                                                ${acc.currency || 'USD'}${acc.isDefault ? ' ⭐' : ''}
                                            </span>
                                            <b style="color:#1e293b;">${acc.bankName}</b>
                                            <span style="color:#2563eb; font-family:monospace; font-size:10.5px;">${acc.accountNumber}</span>
                                            ${acc.swiftCode ? `<span style="color:#6366f1; font-size:10px; font-weight:600;">SWIFT: ${acc.swiftCode}</span>` : ''}
                                        </div>
                                        ${acc.intermediaryBank ? `<div style="font-size:10px; color:#b45309; margin-top:2px;"><i class='bx bx-git-branch'></i> <b>중계은행(Intermediary):</b> ${acc.intermediaryBank}</div>` : ''}
                                        ${acc.note ? `<div style="font-size:9.5px; color:#475569; margin-top:2px; background:#f1f5f9; padding:2px 6px; border-radius:3px;"><span style="color:#0284c7; font-weight:600;">💡 사용가이드:</span> ${acc.note}</div>` : ''}
                                    </div>
                                    <button type="button" 
                                        onclick="event.stopPropagation(); applyTemplate('${p.id}', ${aIdx})" 
                                        style="flex-shrink:0; padding:4px 9px; font-size:10.5px; font-weight:600; color:#fff; background:#2563eb; border:none; border-radius:4px; cursor:pointer; display:inline-flex; align-items:center; gap:3px;">
                                        <i class='bx bx-check'></i> ${acc.currency || 'USD'} 적용
                                    </button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }

        return `<div class="tpl-picker-card" onclick="applyTemplate('${p.id}')">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                <div>
                    <div style="font-weight:700; font-size:13px; color:var(--gray-900);">
                        ${p.name}
                        ${p.engName && p.korName && p.engName !== p.korName ? `<span style="font-weight:normal; font-size:11.5px; color:var(--gray-500); margin-left:4px;">(${p.korName})</span>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:4px; align-items:center; flex-shrink:0;">
                    ${engBadge}
                    ${typeBadge}
                </div>
            </div>
            <div style="margin-top:5px; font-size:11px; color:var(--gray-600); line-height:1.45;">
                ${p.address ? `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class='bx bx-map-pin' style="color:var(--gray-400);"></i> ${p.address}</div>` : ''}
                <div style="display:flex; gap:12px; margin-top:2px; flex-wrap:wrap;">
                    ${p.tel ? `<div><i class='bx bx-phone' style="color:var(--gray-400);"></i> ${p.tel}</div>` : ''}
                    ${p.email ? `<div><i class='bx bx-envelope' style="color:var(--gray-400);"></i> ${p.email}</div>` : ''}
                </div>
            </div>
            ${bankHtml}
        </div>`;
    }).join('');
}

document.querySelectorAll('.load-tpl-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        currentTplRole = btn.dataset.role; // 'shipper', 'consignee', 'notify'
        
        // 정산/거래처 관리에서 최근 수정한 은행 및 거래처 정보를 실시간 재조회
        await loadPartners();

        if (currentTplRole === 'shipper') {
            document.getElementById('tplPickerTitle').textContent = '판매자 (Shipper) 거래처 선택 [정산/거래처 연동]';
            currentTplFilterTab = 'OVERSEAS';
        } else if (currentTplRole === 'consignee') {
            document.getElementById('tplPickerTitle').textContent = '구매자 (Consignee) 거래처 선택 [정산/거래처 연동]';
            currentTplFilterTab = 'ALL';
        } else {
            document.getElementById('tplPickerTitle').textContent = 'Notify Party 거래처 선택 [정산/거래처 연동]';
            currentTplFilterTab = 'ALL';
        }
        
        document.querySelectorAll('.tpl-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.type === currentTplFilterTab);
        });
        
        if (els.tplSearchInput) els.tplSearchInput.value = '';
        renderTplPickerList();
        els.tplPickerModal.classList.add('active');
        setTimeout(() => { if (els.tplSearchInput) els.tplSearchInput.focus(); }, 100);
    });
});

if (els.tplSearchInput) {
    els.tplSearchInput.addEventListener('input', () => renderTplPickerList());
}
document.querySelectorAll('.tpl-tab').forEach(t => {
    t.addEventListener('click', () => {
        currentTplFilterTab = t.dataset.type;
        document.querySelectorAll('.tpl-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        renderTplPickerList();
    });
});

window.applyTemplate = function(id, accountIdx = null) {
    const p = allPartners.find(x => String(x.id) === String(id));
    if (!p) return;
    
    if (currentTplRole === 'shipper') {
        // 계좌 결정: 지정된 인덱스 -> 현재 인보이스 통화와 일치하는 계좌 -> 기본 계좌
        let chosenAcc = null;
        if (accountIdx !== null && p.bankAccounts && p.bankAccounts[accountIdx]) {
            chosenAcc = p.bankAccounts[accountIdx];
        } else if (p.bankAccounts && p.bankAccounts.length > 0) {
            const currentCur = document.getElementById('inpCurrency')?.value || 'USD';
            chosenAcc = p.bankAccounts.find(a => a.currency === currentCur) || p.bankAccounts.find(a => a.isDefault) || p.bankAccounts[0];
        }

        const bName = chosenAcc ? chosenAcc.bankName : (p.bankInfo?.bankName || '');
        const bAcc = chosenAcc ? chosenAcc.accountNumber : (p.bankInfo?.accountNo || '');
        const bSwift = chosenAcc ? chosenAcc.swiftCode : (p.bankInfo?.swift || '');
        const bIntermediary = chosenAcc ? chosenAcc.intermediaryBank : (p.bankInfo?.intermediaryBank || '');
        const bAddr = chosenAcc ? chosenAcc.bankAddress : (p.bankInfo?.bankAddress || '');

        document.getElementById('inpShipperName').value = p.name || '';
        document.getElementById('inpShipperAddress').value = p.address || '';
        document.getElementById('inpShipperTel').value = p.tel || '';
        document.getElementById('inpShipperFax').value = p.fax || '';
        document.getElementById('inpShipperEmail').value = p.email || '';
        
        // 외화 은행 정보 및 중계은행 1:1 매핑
        document.getElementById('inpShipperBank').value = bName;
        document.getElementById('inpShipperAccountNo').value = bAcc;
        document.getElementById('inpShipperSwift').value = bSwift;
        document.getElementById('inpShipperIntermediaryBank').value = bIntermediary;
        document.getElementById('inpShipperBankAddress').value = bAddr;

        const curInfo = chosenAcc ? ` [${chosenAcc.currency || 'USD'} 계좌]` : '';
        showToast(`${p.name}${curInfo} 정보 및 은행 계좌가 입력되었습니다.`);

    } else if (currentTplRole === 'consignee') {
        document.getElementById('inpConsigneeName').value = p.name || '';
        document.getElementById('inpConsigneeAddress').value = p.address || '';
        document.getElementById('inpConsigneeTel').value = p.tel || '';
        document.getElementById('inpConsigneeFax').value = p.fax || '';
        document.getElementById('inpConsigneeEmail').value = p.email || '';
        showToast(`${p.name} 정보가 바이어(Consignee)로 입력되었습니다.`);

    } else if (currentTplRole === 'notify') {
        document.getElementById('inpNotifyName').value = p.name || '';
        document.getElementById('inpNotifyAddress').value = p.address || '';
        document.getElementById('inpNotifyTel').value = p.tel || '';
        showToast(`${p.name} 정보가 통지처(Notify Party)로 입력되었습니다.`);
    }
    
    els.tplPickerModal.classList.remove('active');
};

if (document.getElementById('btnGoPartnersManage')) {
    document.getElementById('btnGoPartnersManage').addEventListener('click', openPartnersManagement);
}

// ── Preview & Print Logic ──
function setPreviewType(type) {
    currentPreviewType = type;
    [els.btnViewPi, els.btnViewCi, els.btnViewPl].forEach(btn => {
        if (!btn) return;
        if (btn.dataset.type === type) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    renderPreview();
}

// 3-way toggle buttons in preview toolbar
[els.btnViewPi, els.btnViewCi, els.btnViewPl].forEach(btn => {
    if (btn) {
        btn.addEventListener('click', () => {
            setPreviewType(btn.dataset.type);
        });
    }
});

window.openPreview = function(id, defaultType = null) {
    const doc = allDocs.find(d => d.id === id);
    if (!doc) return;
    currentPreviewDoc = doc;
    
    if (defaultType) {
        currentPreviewType = defaultType;
    } else if (doc.proformaNo || doc.termsAndConditions) {
        currentPreviewType = 'proforma';
    } else if (doc.invoiceNo) {
        currentPreviewType = 'invoice';
    } else {
        currentPreviewType = 'packinglist';
    }
    
    setPreviewType(currentPreviewType);
    els.previewOverlay.classList.add('active');
};

function closePreview() {
    els.previewOverlay.classList.remove('active');
    currentPreviewDoc = null;
}

function switchPreviewType() {
    if (currentPreviewType === 'proforma') {
        setPreviewType('invoice');
    } else if (currentPreviewType === 'invoice') {
        setPreviewType('packinglist');
    } else {
        setPreviewType('proforma');
    }
}

function renderPreview() {
    if (!currentPreviewDoc) return;
    const d = currentPreviewDoc;
    const isPi = currentPreviewType === 'proforma';
    const isInv = currentPreviewType === 'invoice';
    const isPl = currentPreviewType === 'packinglist';
    
    let docTitle = 'PROFORMA INVOICE';
    let docNoLabel = 'P/I No. & Date';
    let docNo = d.proformaNo || d.invoiceNo || '-';
    
    if (isInv) {
        docTitle = 'COMMERCIAL INVOICE';
        docNoLabel = 'Invoice No. & Date';
        docNo = d.invoiceNo || '-';
    } else if (isPl) {
        docTitle = 'PACKING LIST';
        docNoLabel = 'Packing List No. & Date';
        docNo = d.packingListNo || '-';
    }
    
    const sym = { USD: '$', EUR: '€', KRW: '₩', CNY: '¥', JPY: '¥', GBP: '£' }[d.currency || 'USD'] || d.currency;
    
    // Items
    let itemsHtml = '';
    
    if (isPi || isInv) {
        (d.items || []).forEach(i => {
            itemsHtml += `<tr>
                <td class="td-desc">${i.description}<br><span style="font-size:8px;color:#666;">HS Code: ${i.hsCode||'-'}</span></td>
                <td class="td-num">${Number(i.qty).toLocaleString()} ${i.unit}</td>
                <td class="td-num">${sym} ${Number(i.unitPrice).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                <td class="td-num">${sym} ${Number(i.amount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            </tr>`;
        });
    } else {
        // Packing List Grouping
        const pItems = d.packingItems || [];
        const grouped = {};
        pItems.forEach(i => {
            const cNo = i.containerNo || 'No Container Specified';
            if(!grouped[cNo]) grouped[cNo] = { items: [], subNW: 0, subGW: 0, subQty: 0 };
            grouped[cNo].items.push(i);
            grouped[cNo].subNW += Number(i.netWeight) || 0;
            grouped[cNo].subGW += Number(i.grossWeight) || 0;
            grouped[cNo].subQty += Number(i.qty) || 0;
        });
        
        for (const [cNo, g] of Object.entries(grouped)) {
            itemsHtml += `<tr style="background:#f1f5f9; font-weight:bold;">
                <td colspan="4" style="text-align:left; padding:8px 6px;">Container / Seal No : ${cNo}</td>
            </tr>`;
            
            g.items.forEach(i => {
                itemsHtml += `<tr>
                    <td class="td-desc">${i.description} ${i.remarks ? '<br><span style="font-size:8px;color:#666;">' + i.remarks + '</span>' : ''}</td>
                    <td class="td-num">${Number(i.qty).toLocaleString()} ${i.unit}</td>
                    <td class="td-num">${Number(i.netWeight).toFixed(2)}</td>
                    <td class="td-num">${Number(i.grossWeight).toFixed(2)}</td>
                </tr>`;
            });
            
            itemsHtml += `<tr style="font-weight:bold; color:#555;">
                <td style="text-align:right;">Subtotal</td>
                <td class="td-num">${Number(g.subQty).toLocaleString()}</td>
                <td class="td-num">${Number(g.subNW).toFixed(2)}</td>
                <td class="td-num">${Number(g.subGW).toFixed(2)}</td>
            </tr>`;
        }
    }

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
                <div style="display:flex; gap:14px;">
                    <div class="doc-party-box" style="flex:1;">
                        <div class="party-label">${docNoLabel}</div>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            <div><b>No:</b> ${docNo}</div>
                            <div><b>Date:</b> ${d.docDate || '-'}</div>
                        </div>
                    </div>
                    ${d.countryOfOrigin ? `
                    <div class="doc-party-box" style="flex:0.7;">
                        <div class="party-label">Country of Origin</div>
                        <div style="font-weight:700; font-size:12px; margin-top:6px;">${d.countryOfOrigin}</div>
                    </div>` : ''}
                </div>
                <div class="doc-party-box" style="flex:1;">
                    <div class="party-label">Remarks</div>
                    <div>${(d.remarks||'-').replace(/\n/g, '<br>')}</div>
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
        `;
        
        const ed = d.extraData || {};
        
        let shippingBoxHtml = '';
        if (isPi) {
            shippingBoxHtml = `
            <div class="doc-shipping" style="grid-template-columns: repeat(4, 1fr);">
                <div class="doc-shipping-cell"><div class="sh-label">Port of Loading</div><div class="sh-value">${d.portOfLoading || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Port of Discharge</div><div class="sh-value">${d.portOfDischarge || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Final Destination</div><div class="sh-value">${d.finalDestination || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Incoterms</div><div class="sh-value">${d.incoterms || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Price / Validity</div><div class="sh-value">${ed.piValidity || '30 days from date hereof'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Latest Shipment Date</div><div class="sh-value">${ed.piShipmentDeadline || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Partial Shipment</div><div class="sh-value">${ed.piPartialShipment || 'Not Allowed'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Transshipment</div><div class="sh-value">${ed.piTransshipment || 'Not Allowed'}</div></div>
                <div class="doc-shipping-cell" style="grid-column: span 4;"><div class="sh-label">Payment Terms</div><div class="sh-value">${ed.piPaymentDetail || d.paymentTerms || '-'}</div></div>
            </div>`;
        } else if (isInv) {
            shippingBoxHtml = `
            <div class="doc-shipping" style="grid-template-columns: repeat(4, 1fr);">
                <div class="doc-shipping-cell"><div class="sh-label">Port of Loading</div><div class="sh-value">${d.portOfLoading || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Port of Discharge</div><div class="sh-value">${d.portOfDischarge || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Final Destination</div><div class="sh-value">${d.finalDestination || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Incoterms</div><div class="sh-value">${d.incoterms || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Vessel / Flight</div><div class="sh-value">${d.vessel || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Departure Date (ETD)</div><div class="sh-value">${d.departureDate || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Arrival Date (ETA)</div><div class="sh-value">${ed.arrivalDate || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">B/L No.</div><div class="sh-value">${ed.blNo || '-'}</div></div>
                <div class="doc-shipping-cell" style="grid-column: span 3;"><div class="sh-label">Payment Terms</div><div class="sh-value">${d.paymentTerms || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">C/O No.</div><div class="sh-value">${ed.coNo || '-'}</div></div>
            </div>`;
        } else {
            // Packing List
            const totCbm = Number(d.totalMeasurement || ed.totalCbm || 0).toFixed(3);
            shippingBoxHtml = `
            <div class="doc-shipping" style="grid-template-columns: repeat(4, 1fr);">
                <div class="doc-shipping-cell"><div class="sh-label">Port of Loading</div><div class="sh-value">${d.portOfLoading || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Port of Discharge</div><div class="sh-value">${d.portOfDischarge || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Final Destination</div><div class="sh-value">${d.finalDestination || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Vessel / Flight</div><div class="sh-value">${d.vessel || '-'} ${d.departureDate ? '(ETD: '+d.departureDate+')' : ''}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Total Packages</div><div class="sh-value">${ed.totalPackages || '-'}</div></div>
                <div class="doc-shipping-cell"><div class="sh-label">Total Measurement</div><div class="sh-value">${totCbm} CBM</div></div>
                <div class="doc-shipping-cell" style="grid-column: span 2;"><div class="sh-label">Shipping Mark</div><div class="sh-value">${ed.shippingMark || 'N/M'}</div></div>
            </div>`;
        }
        
        html += shippingBoxHtml;
        
        html += `
        <table class="doc-items-table">
            <thead>
                ${(isPi || isInv) ? `
                <tr>
                    <th style="width:50%;">Description of Goods</th>
                    <th style="width:15%;">Quantity</th>
                    <th style="width:15%;">Unit Price</th>
                    <th style="width:20%;">Amount</th>
                </tr>` : `
                <tr>
                    <th style="width:55%;">Description of Goods & Remarks</th>
                    <th style="width:15%;">Quantity</th>
                    <th style="width:15%;">Net Wt (kg)</th>
                    <th style="width:15%;">Gross Wt (kg)</th>
                </tr>`}
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
            <tfoot>
                ${(isPi || isInv) ? `
                <tr>
                    <td style="text-align:right;">TOTAL</td>
                    <td class="td-num">${Number(d.totalQty).toLocaleString()}</td>
                    <td></td>
                    <td class="td-num" style="color:var(--primary);">${sym} ${Number(d.totalAmount).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                </tr>` : `
                <tr>
                    <td style="text-align:right;">GRAND TOTAL</td>
                    <td class="td-num">${d.packingItems ? d.packingItems.reduce((s,i)=>s+(Number(i.qty)||0),0).toLocaleString() : 0}</td>
                    <td class="td-num">${Number(d.totalNetWeight).toFixed(2)}</td>
                    <td class="td-num">${Number(d.totalGrossWeight).toFixed(2)}</td>
                </tr>`}
            </tfoot>
        </table>
    `;

    // Proforma Invoice: Terms & Conditions and Dual Signatures
    if (isPi) {
        if (d.termsAndConditions) {
            html += `
            <div class="doc-terms-box">
                <div class="doc-terms-title">
                    <span><i class='bx bx-check-shield'></i> Terms &amp; Conditions (Contractual Terms)</span>
                    <span style="font-size:8.5px;font-weight:normal;color:#666;">Substitute for Sales Contract under CISG</span>
                </div>
                <div class="doc-terms-content">${d.termsAndConditions.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>`;
        }

        const includeBuyerSign = ed.includeBuyerSign !== undefined ? !!ed.includeBuyerSign : true;
        if (includeBuyerSign) {
            html += `
            <div class="doc-dual-signatures">
                <div class="doc-sig-block">
                    <div>
                        <div class="sig-party-title">SELLER / EXPORTER</div>
                        <div class="sig-confirm-text">For and on behalf of Seller:</div>
                        <div style="font-weight:700; color:#1e293b; font-size:12px; margin-top:4px;">${d.shipper?.name || 'Seller'}</div>
                    </div>
                    <div class="sig-line-row">
                        <span class="sig-line-text">Authorized Signature &amp; Seal</span>
                        <span class="sig-date-text">Date: ________________</span>
                    </div>
                </div>
                <div class="doc-sig-block">
                    <div>
                        <div class="sig-party-title">BUYER / IMPORTER</div>
                        <div class="sig-confirm-text">Accepted &amp; Confirmed by Buyer:</div>
                        <div style="font-weight:700; color:#1e293b; font-size:12px; margin-top:4px;">${d.consignee?.name || 'Buyer'}</div>
                    </div>
                    <div class="sig-line-row">
                        <span class="sig-line-text">Authorized Signature &amp; Seal</span>
                        <span class="sig-date-text">Date: ________________</span>
                    </div>
                </div>
            </div>
            `;
        } else {
            html += `
            <div class="doc-footer">
                <div class="doc-signature">
                    For and on behalf of<br>
                    <b>${d.shipper?.name || 'Seller'}</b>
                    <div class="sig-line">Authorized Signature &amp; Seal</div>
                </div>
            </div>
            `;
        }
    } else {
        // Commercial Invoice Bank Info
        if (isInv && d.shipper?.bankInfo?.bankName) {
            const bi = d.shipper.bankInfo;
            html += `
            <div class="doc-remarks" style="margin-top:10px;background:#f9f9f9;padding:10px 14px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px;line-height:1.6;">
                <b><i class='bx bxs-bank'></i> Bank Information for Remittance</b><br>
                <b>Beneficiary:</b> ${d.shipper?.name || '-'}<br>
                <b>Bank Name:</b> ${bi.bankName}<br>
                <b>Account No:</b> ${bi.accountNo}<br>
                <b>SWIFT Code:</b> ${bi.swift || '-'}<br>
                ${bi.intermediaryBank ? `<b>Intermediary Bank:</b> ${bi.intermediaryBank}<br>` : ''}
                <b>Bank Address:</b> ${bi.bankAddress || '-'}
            </div>`;
        }

        // Standard Single Signature Footer
        html += `
        <div class="doc-footer">
            <div class="doc-signature">
                For and on behalf of<br>
                <b>${d.shipper?.name || ''}</b>
                <div class="sig-line">Authorized Signature</div>
            </div>
        </div>
        `;
    }
    
    els.previewContainer.innerHTML = html;
}

// ── Event Listeners ──
els.addBtn.addEventListener('click', () => openDocModal());
els.closeModalBtn.addEventListener('click', () => closeDocModal(false));
els.cancelModalBtn.addEventListener('click', () => closeDocModal(false));
els.addItemBtn.addEventListener('click', () => createInvItemLine());
if(els.addPlItemBtn) els.addPlItemBtn.addEventListener('click', () => createPlItemLine());
els.partnerBtn.addEventListener('click', openPartnersManagement);
els.closeTplPickerBtn.addEventListener('click', () => els.tplPickerModal.classList.remove('active'));
els.closePreviewBtn.addEventListener('click', closePreview);
els.previewOverlay.addEventListener('click', (e) => {
    if (e.target === els.previewOverlay) closePreview();
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'F8') {
        if (els.docModal.classList.contains('active')) {
            e.preventDefault();
            els.saveDocBtn.click();
        }
    } else if (e.key === 'Escape') {
        if (els.previewOverlay.classList.contains('active')) closePreview();
        else if (els.tplPickerModal.classList.contains('active')) els.tplPickerModal.classList.remove('active');
        else if (els.docModal.classList.contains('active')) closeDocModal(false);
    }
});
window.addEventListener('beforeunload', (e) => {
    if (els.docModal.classList.contains('active') && isDocDirty()) {
        e.preventDefault();
        e.returnValue = '';
    }
});
if (els.switchDocBtn) els.switchDocBtn.addEventListener('click', switchPreviewType);
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
