// expense.js

// --- authFetch: JWT 토큰을 자동으로 실어 보내는 fetch 래퍼 ---
async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) { 
                await new Promise(r => setTimeout(r, 500)); 
                token = await window.parent.getAuthToken(); 
                retries++; 
            }
        }
    } catch(e) {}
    
    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

const API_URL = 'https://kng.junparks.com/api/expense-resolution';
const PARTNERS_API_URL = 'https://kng.junparks.com/api/partners';
const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const TRADE_REMITTANCE_API_URL = isLocalHost ? 'http://localhost:3000/api/trade-remittance' : 'https://kng.junparks.com/api/trade-remittance';
const TRADE_REMITTANCE_CACHE_KEY = 'kngTradeRemittanceRecords_v1';
let currentExpenses = [];
let currentVendors = [];
let currentTradeRemittances = [];
let editingExpenseId = null;
let editingVendorId = null;

function findVendorByIdOrName(vendorId, vendorName = '') {
    if (vendorId) {
        const strId = String(vendorId);
        const byId = currentVendors.find(v => String(v.id) === strId || (Array.isArray(v.aliasIds) && v.aliasIds.includes(strId)));
        if (byId) return byId;
    }
    if (vendorName) {
        const normName = vendorName.trim().toLowerCase();
        const byName = currentVendors.find(v =>
            (v.vendorName && v.vendorName.trim().toLowerCase() === normName) ||
            (v.korName && v.korName.trim().toLowerCase() === normName) ||
            (v.companyName && v.companyName.trim().toLowerCase() === normName) ||
            (v.companyNameEn && v.companyNameEn.trim().toLowerCase() === normName)
        );
        if (byName) return byName;
    }
    return null;
}

let filters = { title: '', vendor: '', person: '', currency: '' };
let currentSort = { key: 'createdDate', asc: false };
let initialFormData = '';

// DOM Elements
const listView = document.getElementById('listView');
const expenseEditModal = document.getElementById('expenseEditModal');
const vendorModal = document.getElementById('vendorModal');
const printLayout = document.getElementById('printLayout');

const expenseListBody = document.getElementById('expenseListBody');
const vendorListBody = document.getElementById('vendorListBody');

// Form Elements
const expenseForm = document.getElementById('expenseForm');
const fStatus = document.getElementById('fStatus');
const fCreatedDate = document.getElementById('fCreatedDate');
const fPaymentDate = document.getElementById('fPaymentDate');
const fCurrency = document.getElementById('fCurrency');
const fAmount = document.getElementById('fAmount');
const fVatAmount = document.getElementById('fVatAmount');
const fTotalAmount = document.getElementById('fTotalAmount');
const vatGroup = document.getElementById('vatGroup');
const fPersonInCharge = document.getElementById('fPersonInCharge');
const fTaxInvoiceDate = document.getElementById('fTaxInvoiceDate');
const fVendorSearch = document.getElementById('fVendorSearch');
const fVendorId = document.getElementById('fVendorId');
const fVendorList = document.getElementById('fVendorList');
const fAccountSelect = document.getElementById('fAccountSelect');
const accountSelectWrap = document.getElementById('accountSelectWrap');
const vendorInfoDisplay = document.getElementById('vendorInfoDisplay');
const fIsProxy = document.getElementById('fIsProxy');
const proxyInputWrap = document.getElementById('proxyInputWrap');
const fProxyBankName = document.getElementById('fProxyBankName');
const fProxyAccountNumber = document.getElementById('fProxyAccountNumber');
const fProxyAccountHolder = document.getElementById('fProxyAccountHolder');
const fTitle = document.getElementById('fTitle');
const fContent = document.getElementById('fContent');
const fRemarks = document.getElementById('fRemarks');
const fAttachments = document.getElementById('fAttachments');
const attachmentsPreview = document.getElementById('attachmentsPreview');
let currentAttachments = [];

function renderAttachmentsPreview() {
    attachmentsPreview.innerHTML = '';
    currentAttachments.forEach((filePath, idx) => {
        const fileName = filePath.split('-').slice(1).join('-') || filePath.split('/').pop();
        const BASE_URL = API_URL.split('/api/')[0];
        const fullUrl = filePath.startsWith('http') ? filePath : BASE_URL + filePath;
        const div = document.createElement('div');
        div.className = 'attachment-item';
        div.innerHTML = `
            <a href="${fullUrl}" target="_blank"><i class='bx bx-file'></i> ${fileName}</a>
            <button type="button" class="btn-remove" onclick="removeAttachment(${idx})"><i class='bx bx-trash'></i></button>
        `;
        attachmentsPreview.appendChild(div);
    });
}
window.removeAttachment = function(idx) {
    currentAttachments.splice(idx, 1);
    renderAttachmentsPreview();
};

let newFiles = [];
const newAttachmentsPreview = document.getElementById('newAttachmentsPreview');

function renderNewFilesPreview() {
    if (!newAttachmentsPreview) return;
    newAttachmentsPreview.innerHTML = '';
    newFiles.forEach((file, idx) => {
        const div = document.createElement('div');
        div.className = 'attachment-item new-file';
        div.style.backgroundColor = '#f0fdf4';
        div.style.borderColor = '#bbf7d0';
        div.innerHTML = `
            <span><i class='bx bx-upload'></i> ${file.name} <span class="web-only-badge" style="background:#dcfce7; color:#166534">새 파일</span></span>
            <button type="button" class="btn-remove" onclick="removeNewFile(${idx})"><i class='bx bx-trash'></i></button>
        `;
        newAttachmentsPreview.appendChild(div);
    });

    const dropZoneContent = document.getElementById('dropZoneContent');
    if (dropZoneContent) {
        const p = dropZoneContent.querySelector('p');
        if (newFiles.length > 0) {
            p.innerHTML = `새 파일 <strong>${newFiles.length}개</strong> 대기 중. 더 추가하려면 드롭하거나 클릭하세요.`;
        } else {
            p.innerHTML = `파일을 드래그 앤 드롭하거나 <strong>클릭</strong>하여 선택하세요`;
        }
    }
}

window.removeNewFile = function(idx) {
    newFiles.splice(idx, 1);
    renderNewFilesPreview();
};


document.addEventListener('DOMContentLoaded', () => {
    loadVendors().then(() => loadExpenses());

    // Expense List Events
    document.getElementById('btnNewExpense').addEventListener('click', showNewExpenseForm);
    document.getElementById('btnCloseEdit').addEventListener('click', closeExpenseModal);
    document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelectedExpenses);
    const btnGoTradeRemittance = document.getElementById('btnGoTradeRemittance');
    if (btnGoTradeRemittance) btnGoTradeRemittance.addEventListener('click', () => openTradeRemittanceModule(null));
    const btnWriteTradeRemittance = document.getElementById('btnWriteTradeRemittance');
    if (btnWriteTradeRemittance) btnWriteTradeRemittance.addEventListener('click', openTradeRemittanceFromCurrentForm);
    
    // Search & Sort Events
    const filterTitle = document.getElementById('filterTitle');
    const filterVendor = document.getElementById('filterVendor');
    const filterPerson = document.getElementById('filterPerson');
    const filterCurrency = document.getElementById('filterCurrency');
    const btnResetFilters = document.getElementById('btnResetFilters');

    const applyFilters = () => {
        filters.title = filterTitle.value.toLowerCase();
        filters.vendor = filterVendor.value.toLowerCase();
        filters.person = filterPerson.value.toLowerCase();
        filters.currency = filterCurrency.value;
        renderExpenseList();
    };

    if (filterTitle) filterTitle.addEventListener('input', applyFilters);
    if (filterVendor) filterVendor.addEventListener('input', applyFilters);
    if (filterPerson) filterPerson.addEventListener('input', applyFilters);
    if (filterCurrency) filterCurrency.addEventListener('change', applyFilters);

    if (btnResetFilters) {
        btnResetFilters.addEventListener('click', () => {
            filterTitle.value = '';
            filterVendor.value = '';
            filterPerson.value = '';
            filterCurrency.value = '';
            applyFilters();
        });
    }

    const sortHeaders = document.querySelectorAll('th[data-sort]');
    sortHeaders.forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            if (currentSort.key === key) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.key = key;
                currentSort.asc = true;
            }
            // Update icons
            sortHeaders.forEach(h => h.querySelector('i').className = 'bx bx-sort');
            const icon = currentSort.asc ? 'bx bx-sort-up' : 'bx bx-sort-down';
            th.querySelector('i').className = icon;
            renderExpenseList();
        });
    });

    // Vendor Search Event
    if (fVendorSearch) {
        fVendorSearch.addEventListener('focus', () => {
            updateVendorDropdown(fVendorSearch.value);
            fVendorList.style.display = 'block';
        });
        fVendorSearch.addEventListener('input', (e) => {
            updateVendorDropdown(e.target.value);
            fVendorList.style.display = 'block';
            fVendorId.value = ''; // clear selection
            handleVendorSelect();
        });
        fVendorSearch.addEventListener('blur', () => {
            setTimeout(() => {
                fVendorList.style.display = 'none';
                if (!fVendorId.value) fVendorSearch.value = '';
            }, 200);
        });
    }
    
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checks = document.querySelectorAll('.check-row');
        checks.forEach(c => c.checked = e.target.checked);
    });

    if (fIsProxy) {
        fIsProxy.addEventListener('change', (e) => {
            if (e.target.checked) {
                proxyInputWrap.style.display = 'block';
                accountSelectWrap.style.display = 'none';
                vendorInfoDisplay.style.display = 'none';
            } else {
                proxyInputWrap.style.display = 'none';
                if (fVendorId.value) {
                    vendorInfoDisplay.style.display = 'grid';
                    const selectedVendor = findVendorByIdOrName(fVendorId.value, fVendorSearch.value);
                    if (selectedVendor && selectedVendor.accounts && selectedVendor.accounts.length > 1) {
                        accountSelectWrap.style.display = 'block';
                    }
                }
            }
        });
    }

    // Form Events
    const calcTotal = () => {
        const amt = parseFloat(fAmount.value) || 0;
        const vat = isForeignCurrency(fCurrency.value) ? 0 : (parseFloat(fVatAmount.value) || 0);
        fTotalAmount.value = (amt + vat).toLocaleString();
    };

    fAmount.addEventListener('input', calcTotal);
    fVatAmount.addEventListener('input', calcTotal);
    fCurrency.addEventListener('change', () => {
        handleCurrencyChange();
        calcTotal();
    });
    // Vendor list is handled via clicks now, not select change

    // Vendor Management Events
    document.getElementById('btnManageVendors').addEventListener('click', openVendorModal);
    document.getElementById('btnOpenVendorMgmt').addEventListener('click', openVendorModal);
    document.getElementById('btnCloseVendorModal').addEventListener('click', closeVendorModal);
    document.getElementById('btnNewVendor').addEventListener('click', showNewVendorForm);
    document.getElementById('btnCancelVendor').addEventListener('click', hideVendorForm);
    document.getElementById('btnSaveVendor').addEventListener('click', saveVendor);
    document.getElementById('btnAddAccount').addEventListener('click', () => addAccountRow());

    // Print Events
    document.getElementById('btnPrintPreview').addEventListener('click', showPrintPreview);
    document.getElementById('btnClosePrint').addEventListener('click', () => {
        printLayout.style.display = 'none';
        document.body.style.overflow = 'hidden'; // Keep modal scroll hidden
    });

    // File Drag and Drop Events
    const dropZone = document.getElementById('dropZone');
    const dropZoneContent = document.getElementById('dropZoneContent');

    if (dropZone && fAttachments) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                Array.from(e.dataTransfer.files).forEach(file => newFiles.push(file));
                renderNewFilesPreview();
            }
        });

        dropZoneContent.addEventListener('click', () => {
            fAttachments.click();
        });
        
        fAttachments.addEventListener('change', () => {
            if (fAttachments.files && fAttachments.files.length > 0) {
                Array.from(fAttachments.files).forEach(file => newFiles.push(file));
                renderNewFilesPreview();
                fAttachments.value = ''; // clear input so same file can be selected again
            }
        });
    }
});

// ==========================================
// 지출결의서 로직
// ==========================================

function openExpenseModal() {
    expenseEditModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeExpenseModal() {
    if (getFormDataString() !== initialFormData) {
        if (!confirm('저장하지 않은 변경 사항이 있습니다. 창을 닫으시겠습니까?')) {
            return;
        }
    }
    expenseEditModal.classList.remove('active');
    document.body.style.overflow = '';
    loadExpenses();
}

function getFormDataString() {
    return JSON.stringify({
        status: fStatus ? fStatus.value : '',
        createdDate: fCreatedDate.value,
        paymentDate: fPaymentDate.value,
        currency: fCurrency.value,
        amount: fAmount.value,
        vatAmount: fVatAmount.value,
        vendorSelect: fVendorId.value,
        accountSelect: fAccountSelect.value,
        isProxy: fIsProxy ? fIsProxy.checked : false,
        proxyBankName: fProxyBankName ? fProxyBankName.value : '',
        proxyAccountNumber: fProxyAccountNumber ? fProxyAccountNumber.value : '',
        proxyAccountHolder: fProxyAccountHolder ? fProxyAccountHolder.value : '',
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked')?.value,
        title: fTitle.value,
        taxInvoiceDate: fTaxInvoiceDate.value,
        content: fContent.value,
        remarks: fRemarks.value,
        attachments: JSON.stringify(currentAttachments),
        newFilesCount: Array.isArray(newFiles) ? newFiles.length : 0,
        personInCharge: fPersonInCharge.value
    });
}

window.hasUnsavedChanges = function() {
    if (expenseEditModal && expenseEditModal.classList.contains('active')) {
        return getFormDataString() !== initialFormData;
    }
    return false;
};

window.addEventListener('beforeunload', (e) => {
    if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (vendorModal && vendorModal.classList.contains('active')) {
            e.preventDefault();
            closeVendorModal();
        } else if (expenseEditModal && expenseEditModal.classList.contains('active')) {
            e.preventDefault();
            closeExpenseModal();
        }
    }
});

async function loadExpenses() {
    try {
        expenseListBody.innerHTML = '<tr class="loading-row"><td colspan="9"><div class="skeleton"></div></td></tr>';
        await loadTradeRemittances();
        const res = await authFetch(API_URL);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        
        currentExpenses = await res.json();
        renderExpenseList();
    } catch (e) {
        showToast(e.message, 'error');
        expenseListBody.innerHTML = '<tr><td colspan="9" class="text-center">데이터를 불러오지 못했습니다.</td></tr>';
    }
}

async function loadTradeRemittances() {
    let list = [];
    try {
        const res = await authFetch(TRADE_REMITTANCE_API_URL);
        if (res.ok) {
            list = await res.json();
        }
    } catch (e) {}
    try {
        const localList = JSON.parse(localStorage.getItem(TRADE_REMITTANCE_CACHE_KEY) || '[]');
        if (Array.isArray(localList) && localList.length > 0) {
            const existingIds = new Set(list.map(d => d.id));
            localList.forEach(d => {
                if (!existingIds.has(d.id)) list.push(d);
            });
        }
    } catch (e) {}
    currentTradeRemittances = list;
}

function findTradeRemittanceForExpense(expId) {
    if (!expId) return null;
    const strId = String(expId);
    const fromMem = currentTradeRemittances.find(d => String(d.expenseId) === strId);
    if (fromMem) return fromMem;
    try {
        const localList = JSON.parse(localStorage.getItem(TRADE_REMITTANCE_CACHE_KEY) || '[]');
        return localList.find(d => String(d.expenseId) === strId) || null;
    } catch (e) {
        return null;
    }
}

function getFilteredAndSortedExpenses() {
    let filtered = currentExpenses;

    // 1. Search filters (AND condition)
    if (filters.title) {
        filtered = filtered.filter(exp => (exp.title || '').toLowerCase().includes(filters.title));
    }
    if (filters.vendor) {
        filtered = filtered.filter(exp => (exp.vendorName || '').toLowerCase().includes(filters.vendor));
    }
    if (filters.person) {
        filtered = filtered.filter(exp => (exp.personInCharge || '').toLowerCase().includes(filters.person));
    }
    if (filters.currency) {
        filtered = filtered.filter(exp => (exp.currency || '').toUpperCase() === filters.currency);
    }

    // 2. Sort
    filtered.sort((a, b) => {
        let valA = a[currentSort.key] || '';
        let valB = b[currentSort.key] || '';

        if (currentSort.key === 'amount') {
            valA = Number(valA);
            valB = Number(valB);
        } else if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }

        if (valA < valB) return currentSort.asc ? -1 : 1;
        if (valA > valB) return currentSort.asc ? 1 : -1;
        return 0;
    });

    return filtered;
}

function renderExpenseList() {
    expenseListBody.innerHTML = '';
    const displayData = getFilteredAndSortedExpenses();

    if (displayData.length === 0) {
        expenseListBody.innerHTML = '<tr><td colspan="9" class="text-center">조회된 지출결의서가 없습니다.</td></tr>';
        return;
    }

    displayData.forEach(exp => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = () => editExpense(exp.id);

        const currencySym = getCurrencySymbol(exp.currency);
        let amountText = exp.amount.toLocaleString(undefined, { minimumFractionDigits: isForeignCurrency(exp.currency) ? 2 : 0 });
        
        let statusBadge = `<span class="badge" style="background:#e2e8f0;color:#475569;">${exp.status||'임시작성'}</span>`;
        if (exp.status === '결재대기') statusBadge = `<span class="badge" style="background:#fef3c7;color:#d97706;">결재대기</span>`;
        else if (exp.status === '결재상신') statusBadge = `<span class="badge" style="background:#dbeafe;color:#2563eb;">결재상신</span>`;
        else if (exp.status === '결재완료') statusBadge = `<span class="badge" style="background:#dcfce7;color:#16a34a;">결재완료</span>`;
        else if (exp.status === '결재보류') statusBadge = `<span class="badge" style="background:#fee2e2;color:#dc2626;">결재보류</span>`;
        
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="check-row" value="${exp.id}" onclick="event.stopPropagation()"></td>
            <td>${exp.createdDate || '-'}</td>
            <td><strong>${exp.title || '-'}</strong></td>
            <td>${exp.vendorName || '-'}</td>
            <td>${exp.currency}</td>
            <td style="text-align:right;">${currencySym} ${Number(Number(exp.amount) + (isForeignCurrency(exp.currency) ? 0 : Number(exp.vatAmount || 0))).toLocaleString()}</td>
            <td>${exp.paymentMethod === 'cash' ? '현금' : '어음'}</td>
            <td>${exp.personInCharge || '-'}</td>
            <td>${statusBadge}</td>
            <td class="col-action" onclick="event.stopPropagation()">
                <div style="display: flex; gap: 4px; justify-content: center; align-items: center;">
                    ${isForeignCurrency(exp.currency) ? (findTradeRemittanceForExpense(exp.id)
                        ? `<button class="btn-outline btn-sm" style="border-color:#059669;color:#059669;background:#ecfdf5;font-weight:600;" onclick="openTradeRemittanceFromExpenseId('${exp.id}')" title="작성된 무역대금 송금 추가 확인서 PDF 미리보기"><i class='bx bxs-file-pdf'></i> 송금확인서</button>`
                        : `<button class="btn-outline btn-sm" style="border-color:#2563eb;color:#2563eb;" onclick="openTradeRemittanceFromExpenseId('${exp.id}')" title="이 내역으로 무역대금 송금 추가 확인서 작성">송금확인서</button>`) : ''}
                    <button class="btn-outline btn-sm" onclick="duplicateExpense('${exp.id}')">복사</button>
                    <button class="btn-outline btn-sm" onclick="editExpense('${exp.id}')">수정</button>
                </div>
            </td>
        `;
        expenseListBody.appendChild(tr);
    });
}

function showNewExpenseForm() {
    editingExpenseId = null;
    document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 새 지출결의서 작성";
    expenseForm.reset();
    
    // Default values
    fStatus.value = '결재상신';
    fCreatedDate.value = new Date().toISOString().split('T')[0];
    fPaymentDate.value = new Date().toISOString().split('T')[0];
    fCurrency.value = 'KRW';
    const urlParams = new URLSearchParams(window.location.search);
    let savedAuthor = urlParams.get('author');
    if (!savedAuthor) {
        try {
            savedAuthor = (window.parent && window.parent.localStorage) ? window.parent.localStorage.getItem('kngCurrentUser') : localStorage.getItem('kngCurrentUser');
        } catch(e) {
            try {
                savedAuthor = localStorage.getItem('kngCurrentUser');
            } catch(err) {
                savedAuthor = '';
            }
        }
    }
    if (savedAuthor && fPersonInCharge) fPersonInCharge.value = savedAuthor;
    
    handleCurrencyChange();
    
    fVendorSearch.value = '';
    fVendorId.value = '';
    updateVendorDropdown();
    
    vendorInfoDisplay.style.display = 'none';
    accountSelectWrap.style.display = 'none';
    fIsProxy.checked = false;
    proxyInputWrap.style.display = 'none';
    fProxyBankName.value = '';
    fProxyAccountNumber.value = '';
    fProxyAccountHolder.value = '';

    handleCurrencyChange();
    fAmount.dispatchEvent(new Event('input')); // Trigger calcTotal

    initialFormData = getFormDataString();
    currentAttachments = [];
    newFiles = [];
    renderAttachmentsPreview();
    renderNewFilesPreview();
    
    openExpenseModal();
}

async function editExpense(id) {
    try {
        const res = await authFetch(`${API_URL}/${id}`);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        const exp = await res.json();
        
        editingExpenseId = exp.id;
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 지출결의서 수정";
        
        fStatus.value = exp.status || '임시작성';
        fCreatedDate.value = exp.createdDate || '';
        fPaymentDate.value = exp.paymentDate || '';
        fCurrency.value = exp.currency || 'KRW';
        handleCurrencyChange();
        
        fAmount.value = exp.amount;
        fVatAmount.value = exp.vatAmount;
        fPersonInCharge.value = exp.personInCharge || '';
        
        const pmRadio = document.querySelector(`input[name="paymentMethod"][value="${exp.paymentMethod}"]`);
        if (pmRadio) pmRadio.checked = true;
        
        fTaxInvoiceDate.value = exp.taxInvoiceDate || '';
        fTitle.value = exp.title || '';
        fContent.value = exp.content || '';
        fRemarks.value = exp.remarks || '';
        fAttachments.value = '';
        try {
            currentAttachments = exp.attachments ? JSON.parse(exp.attachments) : [];
        } catch(e) {
            currentAttachments = [];
        }
        newFiles = [];
        renderAttachmentsPreview();
        renderNewFilesPreview();
        
        // Vendor setup
        fVendorSearch.value = '';
        fVendorId.value = exp.vendorId || '';
        
        const vendor = findVendorByIdOrName(exp.vendorId, exp.vendorName);
        if (vendor) {
            fVendorId.value = vendor.id;
            fVendorSearch.value = vendor.vendorName;
        } else if (exp.vendorName) {
            fVendorSearch.value = exp.vendorName;
        }
        
        updateVendorDropdown();
        handleVendorSelect();
        
        if (exp.isProxy === 'true') {
            fIsProxy.checked = true;
            fProxyBankName.value = exp.bankName || '';
            fProxyAccountNumber.value = exp.accountNumber || '';
            fProxyAccountHolder.value = exp.accountHolder || '';
            fIsProxy.dispatchEvent(new Event('change'));
        } else {
            fIsProxy.checked = false;
            fIsProxy.dispatchEvent(new Event('change'));
            // After handleVendorSelect, accounts are populated. Select the right one if multiple.
            if (exp.accountNumber) {
                const accVal = `${exp.bankName}|${exp.accountNumber}|${exp.accountHolder}`;
                fAccountSelect.value = accVal;
            }
        }
        
        initialFormData = getFormDataString();
        openExpenseModal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function duplicateExpense(id) {
    try {
        const res = await authFetch(`${API_URL}/${id}`);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        const exp = await res.json();
        
        editingExpenseId = null; // 신규 작성 모드로 변경
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 새 지출결의서 작성 (복사됨)";
        
        // 작성일자와 지급일자는 오늘로 초기화
        fStatus.value = '임시작성';
        fCreatedDate.value = new Date().toISOString().split('T')[0];
        fPaymentDate.value = new Date().toISOString().split('T')[0];
        
        fCurrency.value = exp.currency || 'KRW';
        handleCurrencyChange();
        
        fAmount.value = exp.amount;
        fVatAmount.value = exp.vatAmount;
        fAmount.dispatchEvent(new Event('input')); // Trigger calcTotal
        fPersonInCharge.value = exp.personInCharge || '';
        
        const pmRadio = document.querySelector(`input[name="paymentMethod"][value="${exp.paymentMethod}"]`);
        if (pmRadio) pmRadio.checked = true;
        
        fTaxInvoiceDate.value = exp.taxInvoiceDate || '';
        fTitle.value = exp.title || '';
        fContent.value = exp.content || '';
        fRemarks.value = exp.remarks || '';
        fAttachments.value = '';
        try {
            currentAttachments = exp.attachments ? JSON.parse(exp.attachments) : [];
        } catch(e) {
            currentAttachments = [];
        }
        newFiles = [];
        renderAttachmentsPreview();
        renderNewFilesPreview();
        
        // Vendor setup
        fVendorSearch.value = '';
        fVendorId.value = exp.vendorId || '';
        
        const vendor = findVendorByIdOrName(exp.vendorId, exp.vendorName);
        if (vendor) {
            fVendorId.value = vendor.id;
            fVendorSearch.value = vendor.vendorName;
        } else if (exp.vendorName) {
            fVendorSearch.value = exp.vendorName;
        }
        
        updateVendorDropdown();
        handleVendorSelect();
        
        if (exp.isProxy === 'true') {
            fIsProxy.checked = true;
            fProxyBankName.value = exp.bankName || '';
            fProxyAccountNumber.value = exp.accountNumber || '';
            fProxyAccountHolder.value = exp.accountHolder || '';
            fIsProxy.dispatchEvent(new Event('change'));
        } else {
            fIsProxy.checked = false;
            fIsProxy.dispatchEvent(new Event('change'));
            if (exp.accountNumber) {
                const accVal = `${exp.bankName}|${exp.accountNumber}|${exp.accountHolder}`;
                fAccountSelect.value = accVal;
            }
        }
        
        fStatus.value = '결재상신';
        initialFormData = '';
        openExpenseModal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function saveExpense() {
    if (!fCreatedDate.value || !fPaymentDate.value || !fTitle.value || !fVendorId.value) {
        showToast('필수 항목(* 표시)을 모두 입력해주세요.', 'warning');
        return;
    }

    const selectedVendor = findVendorByIdOrName(fVendorId.value, fVendorSearch.value);
    if (!selectedVendor) return;

    let vendorName = selectedVendor.vendorName;
    let representative = selectedVendor.representative;
    let bizRegNumber = selectedVendor.bizRegNumber;
    let bankName = '', accountNumber = '', accountHolder = '';
    const isProxyVal = fIsProxy.checked ? 'true' : 'false';

    if (fIsProxy.checked) {
        if (!fProxyBankName.value || !fProxyAccountNumber.value || !fProxyAccountHolder.value) {
            showToast('대납(직접 입력) 시 은행명, 계좌번호, 예금주는 필수 항목입니다.', 'warning');
            return;
        }
        bankName = fProxyBankName.value;
        accountNumber = fProxyAccountNumber.value;
        accountHolder = fProxyAccountHolder.value;
    } else {
        if (selectedVendor.accounts && selectedVendor.accounts.length === 1) {
            bankName = selectedVendor.accounts[0].bankName;
            accountNumber = selectedVendor.accounts[0].accountNumber;
            accountHolder = selectedVendor.accounts[0].accountHolder;
        } else if (selectedVendor.accounts && selectedVendor.accounts.length > 1) {
            const parts = fAccountSelect.value.split('|');
            if (parts.length === 3) {
                bankName = parts[0];
                accountNumber = parts[1];
                accountHolder = parts[2];
            }
        }
    }

    let uploadedFilePaths = [];
    if (newFiles.length > 0) {
        const formData = new FormData();
        newFiles.forEach(file => {
            formData.append('files', file);
        });
        
        try {
            const uploadRes = await authFetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
                uploadedFilePaths = uploadData.filePaths;
            } else {
                throw new Error('파일 업로드 실패: ' + uploadData.error);
            }
        } catch(e) {
            showToast(e.message, 'error');
            return;
        }
    }
    const finalAttachments = [...currentAttachments, ...uploadedFilePaths];

    const payload = {
        status: fStatus.value,
        createdDate: fCreatedDate.value,
        paymentDate: fPaymentDate.value,
        currency: fCurrency.value,
        amount: parseFloat(fAmount.value) || 0,
        vatAmount: isForeignCurrency(fCurrency.value) ? 0 : (parseFloat(fVatAmount.value) || 0),
        vendorId: selectedVendor.id,
        vendorName: vendorName,
        representative: representative,
        bizRegNumber: bizRegNumber,
        bankName: bankName,
        accountNumber: accountNumber,
        accountHolder: accountHolder,
        isProxy: isProxyVal,
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked').value,
        title: fTitle.value,
        taxInvoiceDate: fTaxInvoiceDate.value,
        content: fContent.value,
        personInCharge: fPersonInCharge.value,
        remarks: fRemarks.value,
        attachments: JSON.stringify(finalAttachments)
    };

    const method = editingExpenseId ? 'PUT' : 'POST';
    const url = editingExpenseId ? `${API_URL}/${editingExpenseId}` : API_URL;

    try {
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('저장에 실패했습니다.');
        let savedResData = {};
        try { savedResData = await res.json(); } catch (e) {}
        const savedExpenseId = editingExpenseId || savedResData.id || '';
        
        showToast('지출결의서가 저장되었습니다.', 'success');
        initialFormData = getFormDataString(); // 저장 성공 시 경고창 우회
        closeExpenseModal();

        if (isForeignCurrency(payload.currency)) {
            const preferredBeneficiary = (selectedVendor && selectedVendor.companyNameEn) || payload.accountHolder || payload.vendorName || '';
            setTimeout(() => {
                if (confirm('무역대금 송금 추가 확인서도 이어서 작성하시겠습니까?\n\n[확인]을 누르면 방금 작성한 신청일, 통화, 송금액, 수취인명이 확인서에 자동으로 입력됩니다.')) {
                    openTradeRemittanceModule({
                        expenseId: savedExpenseId,
                        title: payload.title,
                        remittanceDate: payload.paymentDate || payload.createdDate,
                        currency: payload.currency,
                        amount: payload.amount,
                        beneficiaryName: preferredBeneficiary,
                        submitDate: payload.createdDate
                    });
                }
            }, 150);
        }
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function deleteSelectedExpenses() {
    const checks = document.querySelectorAll('.check-row:checked');
    if (checks.length === 0) {
        showToast('삭제할 항목을 선택해주세요.', 'warning');
        return;
    }
    
    if (!confirm(`선택한 ${checks.length}개의 지출결의서를 삭제하시겠습니까?`)) return;
    
    const ids = Array.from(checks).map(c => c.value);
    try {
        const res = await authFetch(`${API_URL}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        
        if (res.ok) {
            showToast('삭제되었습니다.', 'success');
            loadExpenses();
            document.getElementById('selectAll').checked = false;
        } else {
            const data = await res.json();
            showToast(data.error || '삭제 실패', 'error');
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
    }
}

// ==========================================
// 폼 UI 핸들러
// ==========================================

function isForeignCurrency(curr) {
    return curr !== 'KRW';
}

function selectBestAccountForCurrency(vendor, curr) {
    if (!vendor || !Array.isArray(vendor.accounts) || vendor.accounts.length <= 1) return;
    const upperCurr = (curr || 'KRW').toUpperCase();
    let bestIdx = vendor.accounts.findIndex(a => (a.currency || 'KRW').toUpperCase() === upperCurr && a.isDefault);
    if (bestIdx === -1) {
        bestIdx = vendor.accounts.findIndex(a => (a.currency || 'KRW').toUpperCase() === upperCurr);
    }
    if (bestIdx === -1) {
        bestIdx = vendor.accounts.findIndex(a => a.isDefault);
    }
    if (bestIdx === -1) bestIdx = 0;
    if (fAccountSelect && fAccountSelect.options[bestIdx]) {
        fAccountSelect.selectedIndex = bestIdx;
    }
}

function handleCurrencyChange() {
    const curr = fCurrency.value;
    const btnWriteTR = document.getElementById('btnWriteTradeRemittance');
    if (isForeignCurrency(curr)) {
        fAmount.step = "0.01";
        vatGroup.style.display = 'none';
        fVatAmount.value = '';
        if (btnWriteTR) {
            btnWriteTR.style.display = 'inline-flex';
            const existingDoc = editingExpenseId ? findTradeRemittanceForExpense(editingExpenseId) : null;
            if (existingDoc) {
                btnWriteTR.innerHTML = "<i class='bx bxs-file-pdf'></i> 송금 추가 확인서 PDF 보기";
                btnWriteTR.style.borderColor = '#059669';
                btnWriteTR.style.color = '#059669';
            } else {
                btnWriteTR.innerHTML = "<i class='bx bx-transfer-alt'></i> 송금 추가 확인서 작성";
                btnWriteTR.style.borderColor = '#2563eb';
                btnWriteTR.style.color = '#2563eb';
            }
        }
    } else {
        fAmount.step = "1";
        vatGroup.style.display = 'block';
        if (btnWriteTR) btnWriteTR.style.display = 'none';
    }
    if (fVendorId.value) {
        const vendor = findVendorByIdOrName(fVendorId.value, fVendorSearch.value);
        selectBestAccountForCurrency(vendor, curr);
    }
}

let _trTemplateBytes = null;
let _trFontBytes = null;

async function generateTradeRemittancePdfBlobClient(data = {}) {
    if (!window.PDFLib || !window.fontkit) {
        throw new Error('PDF 라이브러리가 로드되지 않았습니다.');
    }
    const { PDFDocument, rgb } = window.PDFLib;
    if (!_trTemplateBytes) {
        const r = await fetch('./trade_remittance_bg.pdf');
        if (!r.ok) throw new Error('배경 양식 PDF를 불러올 수 없습니다.');
        _trTemplateBytes = await r.arrayBuffer();
    }
    if (!_trFontBytes) {
        const r = await fetch('./Templates/NanumGothic.ttf');
        if (!r.ok) throw new Error('한글 폰트를 불러올 수 없습니다.');
        _trFontBytes = await r.arrayBuffer();
    }
    const pdfDoc = await PDFDocument.load(_trTemplateBytes);
    pdfDoc.registerFontkit(window.fontkit);
    const customFont = await pdfDoc.embedFont(_trFontBytes);
    const firstPage = pdfDoc.getPages()[0];
    const height = firstPage.getHeight();

    function drawFittedCellText(text, opts) {
        const str = String(text || '').trim();
        if (!str) return;
        const { xMin, xMax, pyCenterY, maxFontSize = 17, minFontSize = 9, align = 'center', paddingX = 6 } = opts;
        const availWidth = Math.max(20, (xMax - xMin) - paddingX * 2);
        let fontSize = maxFontSize;
        while (fontSize > minFontSize) {
            if (customFont.widthOfTextAtSize(str, fontSize) <= availWidth) break;
            fontSize -= 0.5;
        }
        const finalWidth = customFont.widthOfTextAtSize(str, fontSize);
        let x = xMin + paddingX;
        if (align === 'center') {
            x = xMin + ((xMax - xMin) - finalWidth) / 2;
            if (x < xMin + 4) x = xMin + 4;
        } else if (align === 'right') {
            x = xMax - paddingX - finalWidth;
            if (x < xMin + 4) x = xMin + 4;
        }
        const capOffset = fontSize * 0.34;
        const y = height - (pyCenterY + capOffset);
        firstPage.drawText(str, { x, y, size: fontSize, font: customFont, color: rgb(0, 0, 0) });
    }

    const curr = String(data.currency || 'USD').trim().toUpperCase();
    const numAmt = parseFloat(String(data.amount ?? '0').replace(/,/g, '')) || 0;
    const amtStr = (curr === 'KRW' || curr === 'JPY')
        ? numAmt.toLocaleString('en-US', { maximumFractionDigits: 2 })
        : numAmt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const topRowCenterY = 333;
    drawFittedCellText(data.remittanceDate, { xMin: 251, xMax: 408, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 11 });
    drawFittedCellText(curr, { xMin: 408, xMax: 496, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 11 });
    drawFittedCellText(amtStr, { xMin: 496, xMax: 687, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 10, paddingX: 8 });
    drawFittedCellText(data.beneficiaryName, { xMin: 687, xMax: 1085, pyCenterY: topRowCenterY, maxFontSize: 16, minFontSize: 9, paddingX: 10 });

    const bottomRowCenterY = 1365;
    drawFittedCellText(String(data.hsCode || '').replace(/[^0-9]/g, ''), { xMin: 152, xMax: 340, pyCenterY: bottomRowCenterY, maxFontSize: 17, minFontSize: 10 });
    drawFittedCellText(data.lcOrContractNo, { xMin: 340, xMax: 543, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 9 });
    drawFittedCellText(data.importDeclNo, { xMin: 543, xMax: 789, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 9 });
    drawFittedCellText(data.priceTerms, { xMin: 789, xMax: 899, pyCenterY: bottomRowCenterY, maxFontSize: 17, minFontSize: 10 });
    drawFittedCellText(data.tradePurpose, { xMin: 899, xMax: 1085, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 10 });

    const submitStr = String(data.submitDate || '').trim();
    if (submitStr) {
        const parts = submitStr.split('-').map(Number);
        if (parts.length >= 3 && !isNaN(parts[0])) {
            const yy = String(parts[0]).slice(-2);
            const mm = String(parts[1]).padStart(2, '0');
            const dd = String(parts[2]).padStart(2, '0');
            const dateCenterY = 1546.5;
            drawFittedCellText(yy, { xMin: 517, xMax: 547, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'left', paddingX: 1 });
            drawFittedCellText(mm, { xMin: 571, xMax: 609, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2 });
            drawFittedCellText(dd, { xMin: 629, xMax: 665, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2 });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

async function openTradeRemittancePdfPreview(doc) {
    if (!doc) return;
    const newWin = window.open('about:blank', '_blank');
    if (newWin) {
        newWin.document.write('<div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#333;"><p style="font-size:18px;font-weight:600;">무역대금 송금 추가 확인서 1:1 정품 PDF 불러오는 중...</p><p style="color:#666;">잠시만 기다려주세요.</p></div>');
    }
    try {
        showToast('작성된 송금확인서 PDF 미리보기를 엽니다.', 'info');
        let blob = null;
        try {
            const res = doc.id
                ? await authFetch(`${TRADE_REMITTANCE_API_URL}/${doc.id}/pdf`)
                : await authFetch(`${TRADE_REMITTANCE_API_URL}/preview-pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(doc)
                });
            if (res.ok) blob = await res.blob();
        } catch (e) {}

        if (!blob) {
            blob = await generateTradeRemittancePdfBlobClient(doc);
        }
        const blobUrl = URL.createObjectURL(blob);
        if (newWin) newWin.location.href = blobUrl;
        else window.open(blobUrl, '_blank');
    } catch (err) {
        if (newWin) newWin.close();
        showToast('PDF 미리보기 생성 실패: ' + err.message, 'error');
    }
}

function openTradeRemittanceModule(prefillData = null) {
    if (prefillData) {
        try {
            localStorage.setItem('kngTradeRemittancePrefill', JSON.stringify(prefillData));
        } catch (e) {}
    }
    const targetUrl = './05_Management/forms/trade_remittance.html';
    if (window.parent && window.parent !== window) {
        try {
            if (typeof window.parent.openPortalTab === 'function') {
                window.parent.openPortalTab(targetUrl, '무역대금 송금 추가 확인서', 'bx bx-transfer-alt', 'iframe');
                return;
            }
        } catch (e) {
            console.warn('openPortalTab 호출 중 예외 발생, postMessage로 폴백:', e);
        }
        try {
            window.parent.postMessage({
                type: 'KNG_PORTAL_OPEN_TAB',
                url: targetUrl,
                title: '무역대금 송금 추가 확인서',
                icon: 'bx bx-transfer-alt',
                navType: 'iframe'
            }, '*');
        } catch (e) {}
        return;
    }
    window.location.href = 'trade_remittance.html';
}

async function openTradeRemittanceFromCurrentForm() {
    if (editingExpenseId) {
        await loadTradeRemittances();
        const existingDoc = findTradeRemittanceForExpense(editingExpenseId);
        if (existingDoc) {
            return openTradeRemittancePdfPreview(existingDoc);
        }
    }
    const selectedVendor = findVendorByIdOrName(fVendorId.value, fVendorSearch.value);
    const beneficiary = (selectedVendor && selectedVendor.companyNameEn) || (fIsProxy && fIsProxy.checked ? fProxyAccountHolder.value : '') || fVendorSearch.value || '';
    openTradeRemittanceModule({
        expenseId: editingExpenseId || '',
        title: fTitle.value.trim(),
        remittanceDate: fPaymentDate.value || fCreatedDate.value,
        currency: isForeignCurrency(fCurrency.value) ? fCurrency.value : 'USD',
        amount: parseFloat(fAmount.value) || 0,
        beneficiaryName: beneficiary,
        submitDate: fCreatedDate.value
    });
}

window.openTradeRemittanceFromExpenseId = async function(expId) {
    await loadTradeRemittances();
    const existingDoc = findTradeRemittanceForExpense(expId);
    if (existingDoc) {
        return openTradeRemittancePdfPreview(existingDoc);
    }

    const exp = currentExpenses.find(e => String(e.id) === String(expId));
    if (!exp) return;
    const vendor = findVendorByIdOrName(exp.vendorId, exp.vendorName);
    const beneficiary = (vendor && vendor.companyNameEn) || exp.accountHolder || exp.vendorName || '';
    openTradeRemittanceModule({
        expenseId: exp.id,
        title: exp.title || '',
        remittanceDate: exp.paymentDate || exp.createdDate,
        currency: isForeignCurrency(exp.currency) ? exp.currency : 'USD',
        amount: exp.amount || 0,
        beneficiaryName: beneficiary,
        submitDate: exp.createdDate
    });
};

window.addEventListener('storage', (e) => {
    if (e.key === TRADE_REMITTANCE_CACHE_KEY) {
        loadTradeRemittances().then(() => renderExpenseList());
    }
});
window.addEventListener('focus', () => {
    loadTradeRemittances().then(() => renderExpenseList());
});
window.onPortalTabActivated = () => {
    loadTradeRemittances().then(() => renderExpenseList());
};

function updateVendorDropdown(searchStr = '') {
    fVendorList.innerHTML = '';
    
    let filteredVendors = currentVendors;
    if (searchStr.trim() !== '') {
        const s = searchStr.toLowerCase().trim();
        filteredVendors = currentVendors.filter(v => {
            const searchable = [
                v.vendorName,
                v.korName,
                v.companyName,
                v.companyNameEn,
                v.bizRegNumber,
                v.representative
            ].filter(Boolean).join(' ').toLowerCase();
            return searchable.includes(s);
        });
    }

    if (filteredVendors.length === 0) {
        const li = document.createElement('li');
        li.textContent = '검색된 거래처가 없습니다.';
        li.style.padding = '8px 12px';
        li.style.color = '#94a3b8';
        li.style.cursor = 'default';
        fVendorList.appendChild(li);
        return;
    }

    filteredVendors.forEach(v => {
        const li = document.createElement('li');
        if (v.korName && v.korName !== v.vendorName) {
            li.innerHTML = `<span>${v.vendorName}</span> <span style="color:#64748b; font-size:12px;">(${v.korName})</span>`;
        } else {
            li.textContent = v.vendorName;
        }
        li.style.padding = '8px 12px';
        li.style.cursor = 'pointer';
        li.style.borderBottom = '1px solid #f1f5f9';
        li.onmouseover = () => li.style.backgroundColor = '#f1f5f9';
        li.onmouseout = () => li.style.backgroundColor = 'transparent';
        li.onclick = () => {
            fVendorSearch.value = v.vendorName;
            fVendorId.value = v.id;
            fVendorList.style.display = 'none';
            handleVendorSelect();
        };
        fVendorList.appendChild(li);
    });
}

function handleVendorSelect() {
    const vid = fVendorId.value;
    const vendor = findVendorByIdOrName(vid, fVendorSearch.value);
    
    if (!vendor) {
        vendorInfoDisplay.style.display = 'none';
        accountSelectWrap.style.display = 'none';
        return;
    }

    if (fIsProxy.checked) {
        vendorInfoDisplay.style.display = 'none';
        accountSelectWrap.style.display = 'none';
        return;
    }

    vendorInfoDisplay.style.display = 'grid';
    
    vendorInfoDisplay.innerHTML = `
        <div class="vi-item"><span class="vi-label">대표자:</span> <span class="vi-value">${vendor.representative || '-'}</span></div>
        <div class="vi-item"><span class="vi-label">사업자번호:</span> <span class="vi-value">${vendor.bizRegNumber || '-'}</span></div>
    `;

    const accounts = vendor.accounts || [];
    if (accounts.length === 0) {
        accountSelectWrap.style.display = 'none';
        vendorInfoDisplay.innerHTML += `<div class="vi-item" style="grid-column: 1/-1; color:#ef4444;">등록된 계좌가 없습니다.</div>`;
    } else if (accounts.length === 1) {
        accountSelectWrap.style.display = 'none';
        const acc = accounts[0];
        vendorInfoDisplay.innerHTML += `
            <div class="vi-item" style="grid-column: 1/-1;">
                <span class="vi-label">계좌정보:</span> 
                <span class="vi-value">${acc.bankName} | ${acc.accountNumber} | ${acc.accountHolder}</span>
            </div>
        `;
    } else {
        accountSelectWrap.style.display = 'block';
        fAccountSelect.innerHTML = '';
        accounts.forEach(acc => {
            const val = `${acc.bankName}|${acc.accountNumber}|${acc.accountHolder}`;
            const currPrefix = acc.currency ? `[${acc.currency}] ` : '';
            const text = `${currPrefix}${acc.bankName} | ${acc.accountNumber} | ${acc.accountHolder}`;
            const opt = new Option(text, val);
            fAccountSelect.appendChild(opt);
        });
        selectBestAccountForCurrency(vendor, fCurrency ? fCurrency.value : 'KRW');
    }
}

// ==========================================
// 거래처 프리셋 & 통합 거래처(partners) 연동 로직
// ==========================================

function openVendorModal() {
    vendorModal.classList.add('active');
    hideVendorForm();
}

function closeVendorModal() {
    const formArea = document.getElementById('vendorFormArea');
    if (formArea && formArea.style.display !== 'none') {
        const vName = document.getElementById('vName')?.value?.trim();
        const vBiz = document.getElementById('vBizNum')?.value?.trim();
        if ((vName || vBiz) && !confirm('작성 중인 거래처 정보가 있습니다. 저장하지 않고 닫으시겠습니까?')) {
            return;
        }
    }
    vendorModal.classList.remove('active');
    // If expense form is open, update dropdown
    if (expenseEditModal.classList.contains('active')) {
        const currentSel = fVendorId.value;
        const vendor = findVendorByIdOrName(currentSel, fVendorSearch.value);
        updateVendorDropdown();
        if (vendor) {
            fVendorId.value = vendor.id;
            fVendorSearch.value = vendor.vendorName;
        }
        handleVendorSelect();
    }
}

function extractPartnerAccounts(p, fallbackHolder) {
    const accs = [];
    const seenKeys = new Set();
    const addUniqueAcc = (bankName, accountNumber, accountHolder, currency = 'KRW', isDefault = false) => {
        const b = (bankName || '').trim();
        const n = (accountNumber || '').trim();
        const h = (accountHolder || fallbackHolder || '').trim();
        if (!b && !n) return;
        const normKey = `${b.toLowerCase()}|${n.replace(/[\s\-]/g, '').toLowerCase()}`;
        if (seenKeys.has(normKey)) return;
        seenKeys.add(normKey);
        accs.push({
            bankName: b,
            accountNumber: n,
            accountHolder: h,
            currency: (currency || 'KRW').toUpperCase(),
            isDefault: !!isDefault
        });
    };

    // 1) 국내 원화 계좌
    if ((p.bank_name && p.bank_name.trim()) || (p.account_number && p.account_number.trim())) {
        const korHolder = (p.account_holder || p.company_name || p.name || fallbackHolder || '').trim();
        addUniqueAcc(p.bank_name, p.account_number, korHolder, 'KRW', false);
    }

    // 2) 외화 다중 계좌 (bank_accounts_json) - SWIFT 코드는 제외하고 은행명만 표기
    let foreignList = [];
    try {
        if (p.bank_accounts_json) {
            foreignList = typeof p.bank_accounts_json === 'string'
                ? JSON.parse(p.bank_accounts_json)
                : p.bank_accounts_json;
        }
    } catch (e) {
        foreignList = [];
    }

    const engHolder = (p.company_name_en || p.company_name || p.name || fallbackHolder || '').trim();
    if (Array.isArray(foreignList) && foreignList.length > 0) {
        foreignList.forEach(fa => {
            if (!fa) return;
            addUniqueAcc(
                fa.bankName,
                fa.accountNumber,
                fa.accountHolder || engHolder,
                fa.currency || 'USD',
                !!fa.isDefault
            );
        });
    } else if ((p.bank_name_en && p.bank_name_en.trim()) || (p.account_number_en && p.account_number_en.trim())) {
        // 하위 호환용 단일 외화 계좌 필드
        addUniqueAcc(p.bank_name_en, p.account_number_en, engHolder, 'USD', true);
    }

    return accs;
}

async function loadVendors() {
    try {
        const [presetsRes, partnersRes] = await Promise.allSettled([
            authFetch(`${API_URL}/vendors`),
            authFetch(PARTNERS_API_URL)
        ]);

        let presetRows = [];
        if (presetsRes.status === 'fulfilled' && presetsRes.value.ok) {
            const data = await presetsRes.value.json();
            if (Array.isArray(data)) presetRows = data;
        }

        let partnerRows = [];
        if (partnersRes.status === 'fulfilled' && partnersRes.value.ok) {
            const data = await partnersRes.value.json();
            partnerRows = Array.isArray(data) ? data : (data.partners || []);
        }

        const normBiz = (s) => (s || '').replace(/[\s\-]/g, '').toLowerCase();
        const normName = (s) => (s || '').trim().toLowerCase();

        const usedPresetIds = new Set();
        const mergedList = [];

        // 1) 통합 거래처 관리(partners) 데이터 변환 및 기존 프리셋(vendor_presets)과 병합
        partnerRows.forEach(p => {
            const companyNameEn = (p.company_name_en || '').trim();
            const korName = (p.name || p.company_name || '').trim();
            const companyName = (p.company_name || p.name || '').trim();
            // 해외 거래처(영문 상호명 존재 시) 영문 상호명을 우선 사용
            const displayVendorName = companyNameEn || companyName || korName;
            const rep = (p.ceo_name || p.ceoName || '').trim();
            const bizNo = (p.business_number || '').trim();

            // 매칭되는 기존 지출결의서 프리셋 찾기 (사업자번호 또는 국/영문 상호명 기준)
            const matchedPresets = presetRows.filter(pr => {
                if (usedPresetIds.has(pr.id)) return false;
                if (bizNo && pr.bizRegNumber && normBiz(bizNo) === normBiz(pr.bizRegNumber)) {
                    return true;
                }
                const prName = normName(pr.vendorName);
                if (!prName) return false;
                return (
                    (companyNameEn && prName === normName(companyNameEn)) ||
                    (korName && prName === normName(korName)) ||
                    (companyName && prName === normName(companyName))
                );
            });

            const accounts = extractPartnerAccounts(p, displayVendorName);
            const seenAccKeys = new Set(
                accounts.map(a => `${(a.bankName || '').toLowerCase()}|${(a.accountNumber || '').replace(/[\s\-]/g, '').toLowerCase()}`)
            );

            const aliasIds = [`PARTNER-${p.id}`, String(p.id)];
            let primaryPresetId = null;

            matchedPresets.forEach(pr => {
                usedPresetIds.add(pr.id);
                if (!primaryPresetId) primaryPresetId = pr.id;
                aliasIds.push(String(pr.id));
                if (Array.isArray(pr.accounts)) {
                    pr.accounts.forEach(pa => {
                        const b = (pa.bankName || '').trim();
                        const n = (pa.accountNumber || '').trim();
                        const h = (pa.accountHolder || displayVendorName).trim();
                        if (!b && !n) return;
                        const k = `${b.toLowerCase()}|${n.replace(/[\s\-]/g, '').toLowerCase()}`;
                        if (!seenAccKeys.has(k)) {
                            seenAccKeys.add(k);
                            accounts.push({
                                bankName: b,
                                accountNumber: n,
                                accountHolder: h,
                                currency: pa.currency || 'KRW',
                                isDefault: false
                            });
                        }
                    });
                }
            });

            mergedList.push({
                id: primaryPresetId || `PARTNER-${p.id}`,
                presetId: primaryPresetId,
                partnerId: p.id,
                aliasIds: aliasIds,
                vendorName: displayVendorName,
                korName: korName,
                companyName: companyName,
                companyNameEn: companyNameEn,
                representative: rep || (matchedPresets[0]?.representative || ''),
                bizRegNumber: bizNo || (matchedPresets[0]?.bizRegNumber || ''),
                accounts: accounts
            });
        });

        // 2) 통합 거래처 관리에 없는 지출결의서 전용 프리셋 추가
        presetRows.forEach(pr => {
            if (usedPresetIds.has(pr.id)) return;
            mergedList.push({
                id: pr.id,
                presetId: pr.id,
                partnerId: null,
                aliasIds: [String(pr.id)],
                vendorName: pr.vendorName || '',
                korName: pr.vendorName || '',
                companyName: pr.vendorName || '',
                companyNameEn: '',
                representative: pr.representative || '',
                bizRegNumber: pr.bizRegNumber || '',
                accounts: Array.isArray(pr.accounts) ? pr.accounts : []
            });
        });

        mergedList.sort((a, b) => (a.vendorName || '').localeCompare(b.vendorName || '', 'ko'));
        currentVendors = mergedList;
        renderVendorList();
    } catch (e) {
        console.error("Failed to load vendors", e);
    }
}

function renderVendorList() {
    vendorListBody.innerHTML = '';
    if (currentVendors.length === 0) {
        vendorListBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94a3b8;">거래처가 없습니다.</td></tr>';
        return;
    }

    currentVendors.forEach(v => {
        const accCount = (v.accounts || []).length;
        const subKor = (v.korName && v.korName !== v.vendorName)
            ? ` <span style="color:#64748b; font-size:12px; font-weight:normal;">(${v.korName})</span>`
            : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${v.vendorName}</strong>${subKor}</td>
            <td>${v.representative || '-'}</td>
            <td>${v.bizRegNumber || '-'}</td>
            <td>${accCount}개</td>
            <td>
                <button class="btn-outline btn-sm" onclick="editVendor('${v.id}')"><i class='bx bx-edit'></i></button>
                <button class="btn-outline btn-sm" style="color:#ef4444; border-color:#fca5a5;" onclick="deleteVendor('${v.id}')"><i class='bx bx-trash'></i></button>
            </td>
        `;
        vendorListBody.appendChild(tr);
    });
}

function showNewVendorForm() {
    editingVendorId = null;
    document.getElementById('vendorFormTitle').innerText = '거래처 등록';
    document.getElementById('vVendorName').value = '';
    document.getElementById('vRepresentative').value = '';
    document.getElementById('vBizRegNumber').value = '';
    document.getElementById('accountsList').innerHTML = '';
    addAccountRow();
    document.getElementById('vendorFormArea').style.display = 'block';
}

function hideVendorForm() {
    document.getElementById('vendorFormArea').style.display = 'none';
    editingVendorId = null;
}

window.editVendor = function(id) {
    const v = findVendorByIdOrName(id);
    if (!v) return;
    
    editingVendorId = v.id;
    document.getElementById('vendorFormTitle').innerText = '거래처 수정';
    document.getElementById('vVendorName').value = v.vendorName || '';
    document.getElementById('vRepresentative').value = v.representative || '';
    document.getElementById('vBizRegNumber').value = v.bizRegNumber || '';
    
    const list = document.getElementById('accountsList');
    list.innerHTML = '';
    if (v.accounts && v.accounts.length > 0) {
        v.accounts.forEach(acc => addAccountRow(acc.bankName, acc.accountNumber, acc.accountHolder));
    } else {
        addAccountRow();
    }
    
    document.getElementById('vendorFormArea').style.display = 'block';
};

window.deleteVendor = async function(id) {
    const v = findVendorByIdOrName(id);
    if (!v) return;
    if (!confirm('이 거래처를 삭제하시겠습니까?')) return;
    try {
        let deleted = false;
        if (v.presetId) {
            const res = await authFetch(`${API_URL}/vendors/${v.presetId}`, { method: 'DELETE' });
            if (res.ok) deleted = true;
        }
        if (v.partnerId) {
            const res2 = await authFetch(`${PARTNERS_API_URL}/${v.partnerId}`, { method: 'DELETE' });
            if (res2.ok) deleted = true;
        }
        if (deleted) {
            showToast('거래처가 삭제되었습니다.', 'success');
            await loadVendors();
            hideVendorForm();
        } else {
            showToast('삭제 실패', 'error');
        }
    } catch(e) {
        showToast('삭제 실패', 'error');
    }
};

function addAccountRow(bank='', acc='', holder='') {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.innerHTML = `
        <input type="text" placeholder="은행명 (예: 신한은행)" class="acc-bank" value="${bank}">
        <input type="text" placeholder="계좌번호" class="acc-num" value="${acc}">
        <input type="text" placeholder="예금주" class="acc-holder" value="${holder}">
        <button type="button" class="btn-remove-account" onclick="this.parentElement.remove()"><i class='bx bx-minus-circle'></i></button>
    `;
    document.getElementById('accountsList').appendChild(row);
}

async function saveVendor() {
    const name = document.getElementById('vVendorName').value.trim();
    if (!name) return showToast('거래처명을 입력해주세요.', 'warning');
    
    const accounts = [];
    document.querySelectorAll('.account-row').forEach(row => {
        const bank = row.querySelector('.acc-bank').value.trim();
        const num = row.querySelector('.acc-num').value.trim();
        const holder = row.querySelector('.acc-holder').value.trim();
        if(bank || num || holder) {
            accounts.push({ bankName: bank, accountNumber: num, accountHolder: holder });
        }
    });

    const payload = {
        vendorName: name,
        representative: document.getElementById('vRepresentative').value.trim(),
        bizRegNumber: document.getElementById('vBizRegNumber').value.trim(),
        accounts: accounts
    };

    const existingVendor = editingVendorId ? findVendorByIdOrName(editingVendorId) : null;
    const presetTargetId = existingVendor ? existingVendor.presetId : null;
    const method = presetTargetId ? 'PUT' : 'POST';
    const url = presetTargetId ? `${API_URL}/vendors/${presetTargetId}` : `${API_URL}/vendors`;

    try {
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('거래처가 저장되었습니다.', 'success');
            await loadVendors();
            hideVendorForm();
        }
    } catch(e) {
        showToast('저장 실패', 'error');
    }
}

// ==========================================
// 인쇄 및 금액 한글 변환
// ==========================================

function getCurrencySymbol(curr) {
    if (curr === 'KRW') return '₩';
    if (curr === 'USD') return '$';
    if (curr === 'CNY') return '¥';
    if (curr === 'JPY') return '¥';
    if (curr === 'EUR') return '€';
    return curr;
}

function numberToKorean(number) {
    const danwi = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
    const danwi_10 = ["", "십", "백", "천"];
    const danwi_10000 = ["", "만", "억", "조", "경"];
    
    let result = "";
    let numStr = Math.floor(number).toString();
    
    for (let i = 0; i < numStr.length; i++) {
        let str = "";
        let num = parseInt(numStr.charAt(i));
        if (num > 0) {
            str += danwi[num];
            str += danwi_10[(numStr.length - i - 1) % 4];
        }
        
        if ((numStr.length - i - 1) % 4 === 0 && parseInt(numStr.substring(i - 3 < 0 ? 0 : i - 3, i + 1)) !== 0) {
            str += danwi_10000[Math.floor((numStr.length - i - 1) / 4)];
        }
        result += str;
    }
    return result;
}

function getCurrencyKoreanText(curr, amount) {
    let intPart = Math.floor(amount);
    let fracPart = Math.round((amount - intPart) * 100);
    
    let intText = numberToKorean(intPart);
    let fracText = '';
    
    if (fracPart > 0) {
        const danwi = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
        fracText += ".";
        let strFrac = fracPart.toString().padStart(2, '0');
        fracText += danwi[parseInt(strFrac.charAt(0))] + danwi[parseInt(strFrac.charAt(1))];
    }

    if (curr === 'KRW') {
        return `금 ${intText}원 정`;
    } else if (curr === 'CNY') {
        return `中貨 ${intText}${fracText} 원元`;
    } else if (curr === 'USD') {
        return `美貨 ${intText}${fracText} 弗`;
    } else if (curr === 'JPY') {
        return `日貨 ${intText}${fracText} 圓`;
    } else if (curr === 'EUR') {
        return `歐貨 ${intText}${fracText} 유로`;
    }
    return `${curr} ${intText}${fracText}`;
}

async function showPrintPreview() {
    if (!fCreatedDate.value || !fTitle.value || !fVendorId.value) {
        showToast('필수 항목을 모두 입력 후 미리보기가 가능합니다.', 'warning');
        return;
    }

    const page = document.getElementById('printPage');
    page.innerHTML = '';
    
    const curr = fCurrency.value;
    const amount = parseFloat(fAmount.value) || 0;
    const vat = isForeignCurrency(curr) ? null : parseFloat(fVatAmount.value) || 0;
    const isForeign = isForeignCurrency(curr);
    const sym = getCurrencySymbol(curr);
    const amtStr = amount.toLocaleString(undefined, { minimumFractionDigits: isForeign ? 2 : 0 });
    
    const koreanAmt = getCurrencyKoreanText(curr, amount);
    
    // Vendor Info
    const selectedVendor = findVendorByIdOrName(fVendorId.value, fVendorSearch.value);
    let vendorName = '', representative = '', bizRegNumber = '';
    let bankName = '', accountNumber = '', accountHolder = '';

    if (selectedVendor) {
        vendorName = selectedVendor.vendorName;
        representative = selectedVendor.representative;
        bizRegNumber = selectedVendor.bizRegNumber;
        
        if (fIsProxy && fIsProxy.checked) {
            bankName = fProxyBankName.value;
            accountNumber = fProxyAccountNumber.value;
            accountHolder = fProxyAccountHolder.value;
        } else {
            if (selectedVendor.accounts && selectedVendor.accounts.length === 1) {
                bankName = selectedVendor.accounts[0].bankName;
                accountNumber = selectedVendor.accounts[0].accountNumber;
                accountHolder = selectedVendor.accounts[0].accountHolder;
            } else if (selectedVendor.accounts && selectedVendor.accounts.length > 1) {
                const parts = fAccountSelect.value.split('|');
                if (parts.length === 3) {
                    bankName = parts[0];
                    accountNumber = parts[1];
                    accountHolder = parts[2];
                }
            }
        }
    }
    
    // Date formatting
    const createDateParts = fCreatedDate.value.split('-');
    const createdStr = `${createDateParts[0]}년 ${parseInt(createDateParts[1])}월 ${parseInt(createDateParts[2])}일`;
    
    const payDateParts = fPaymentDate.value.split('-');
    const payStr = `${parseInt(payDateParts[1])}/${parseInt(payDateParts[2])}`;
    
    const isCash = document.querySelector('input[name="paymentMethod"]:checked').value === 'cash';

    const payload = {
        createdDate: fCreatedDate.value,
        paymentDate: fPaymentDate.value,
        currency: curr,
        amount: amount,
        vatAmount: vat,
        vendorId: selectedVendor ? selectedVendor.id : '',
        vendorName: vendorName,
        representative: representative,
        bizRegNumber: bizRegNumber,
        bankName: bankName,
        accountNumber: accountNumber,
        accountHolder: accountHolder,
        paymentMethod: isCash ? 'cash' : 'bill',
        title: fTitle.value,
        taxInvoiceDate: fTaxInvoiceDate.value,
        content: fContent.value,
        personInCharge: fPersonInCharge.value
    };

    try {
        const res = await authFetch(`${API_URL}/export-excel`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            let errMsg = '엑셀 변환 실패';
            try {
                const err = await res.json();
                errMsg = err.error || errMsg;
            } catch (e) {}
            throw new Error(errMsg);
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        let filename = '지출결의서.xlsx';
        const disposition = res.headers.get('content-disposition');
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
            if (matches != null && matches[1]) { 
                filename = decodeURIComponent(matches[1].replace(/['"]/g, ''));
            }
        }
        
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
    } catch (e) {
        showToast(e.message, 'danger');
    }
}

window.editExpense = editExpense;
window.duplicateExpense = duplicateExpense;
window.downloadExcel = downloadExcel;
window.editVendor = editVendor;
window.deleteVendor = deleteVendor;
window.removeAccountRow = removeAccountRow;

function showToast(msg, type='info') {
    const tc = document.getElementById('toastContainer');
    if(!tc) return alert(msg);
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerText = msg;
    tc.appendChild(t);
    setTimeout(()=> t.remove(), 3000);
}
