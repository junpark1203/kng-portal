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
let currentExpenses = [];
let currentVendors = [];
let editingExpenseId = null;
let editingVendorId = null;

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
const fCreatedDate = document.getElementById('fCreatedDate');
const fPaymentDate = document.getElementById('fPaymentDate');
const fCurrency = document.getElementById('fCurrency');
const fAmount = document.getElementById('fAmount');
const fVatAmount = document.getElementById('fVatAmount');
const vatGroup = document.getElementById('vatGroup');
const fPersonInCharge = document.getElementById('fPersonInCharge');
const fTaxInvoiceDate = document.getElementById('fTaxInvoiceDate');
const fVendorSelect = document.getElementById('fVendorSelect');
const fAccountSelect = document.getElementById('fAccountSelect');
const accountSelectWrap = document.getElementById('accountSelectWrap');
const vendorInfoDisplay = document.getElementById('vendorInfoDisplay');
const fTitle = document.getElementById('fTitle');
const fContent = document.getElementById('fContent');

document.addEventListener('DOMContentLoaded', () => {
    loadVendors().then(() => loadExpenses());

    // Expense List Events
    document.getElementById('btnNewExpense').addEventListener('click', showNewExpenseForm);
    document.getElementById('btnCloseEdit').addEventListener('click', closeExpenseModal);
    document.getElementById('btnSaveExpense').addEventListener('click', saveExpense);
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelectedExpenses);
    
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
    const fVendorSearch = document.getElementById('fVendorSearch');
    if (fVendorSearch) {
        fVendorSearch.addEventListener('input', (e) => {
            updateVendorDropdown(e.target.value);
        });
    }
    
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checks = document.querySelectorAll('.check-row');
        checks.forEach(c => c.checked = e.target.checked);
    });

    // Form Events
    fCurrency.addEventListener('change', handleCurrencyChange);
    fVendorSelect.addEventListener('change', handleVendorSelect);

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
        createdDate: fCreatedDate.value,
        paymentDate: fPaymentDate.value,
        currency: fCurrency.value,
        amount: fAmount.value,
        vatAmount: fVatAmount.value,
        vendorSelect: fVendorSelect.value,
        accountSelect: fAccountSelect.value,
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked')?.value,
        title: fTitle.value,
        taxInvoiceDate: fTaxInvoiceDate.value,
        content: fContent.value,
        personInCharge: fPersonInCharge.value
    });
}

async function loadExpenses() {
    try {
        expenseListBody.innerHTML = '<tr class="loading-row"><td colspan="9"><div class="skeleton"></div></td></tr>';
        const res = await authFetch(API_URL);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        
        currentExpenses = await res.json();
        renderExpenseList();
    } catch (e) {
        showToast(e.message, 'error');
        expenseListBody.innerHTML = '<tr><td colspan="9" class="text-center">데이터를 불러오지 못했습니다.</td></tr>';
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
        
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="check-row" value="${exp.id}" onclick="event.stopPropagation()"></td>
            <td>${exp.createdDate || '-'}</td>
            <td><strong>${exp.title || '-'}</strong></td>
            <td>${exp.vendorName || '-'}</td>
            <td>${exp.currency}</td>
            <td style="text-align:right;">${currencySym} ${amountText}</td>
            <td>${exp.paymentMethod === 'cash' ? '현금' : '어음'}</td>
            <td>${exp.personInCharge || '-'}</td>
            <td class="col-action" onclick="event.stopPropagation()">
                <button class="btn-outline btn-sm" onclick="duplicateExpense('${exp.id}')" style="margin-right:4px;">복사</button>
                <button class="btn-outline btn-sm" onclick="editExpense('${exp.id}')">수정</button>
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
    fCreatedDate.value = new Date().toISOString().split('T')[0];
    fPaymentDate.value = new Date().toISOString().split('T')[0];
    fCurrency.value = 'KRW';
    
    handleCurrencyChange();
    
    const fVendorSearch = document.getElementById('fVendorSearch');
    if (fVendorSearch) fVendorSearch.value = '';
    updateVendorDropdown();
    
    vendorInfoDisplay.style.display = 'none';
    accountSelectWrap.style.display = 'none';
    
    initialFormData = getFormDataString();
    openExpenseModal();
}

async function editExpense(id) {
    try {
        const res = await authFetch(`${API_URL}/${id}`);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        const exp = await res.json();
        
        editingExpenseId = exp.id;
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 지출결의서 수정";
        
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
        
        // Vendor setup
        const fVendorSearch = document.getElementById('fVendorSearch');
        if (fVendorSearch) fVendorSearch.value = '';
        updateVendorDropdown();
        fVendorSelect.value = exp.vendorId || '';
        handleVendorSelect();
        
        // After handleVendorSelect, accounts are populated. Select the right one if multiple.
        if (exp.accountNumber) {
            const accVal = `${exp.bankName}|${exp.accountNumber}|${exp.accountHolder}`;
            fAccountSelect.value = accVal;
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
        fCreatedDate.value = new Date().toISOString().split('T')[0];
        fPaymentDate.value = new Date().toISOString().split('T')[0];
        
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
        
        // Vendor setup
        const fVendorSearch = document.getElementById('fVendorSearch');
        if (fVendorSearch) fVendorSearch.value = '';
        updateVendorDropdown();
        fVendorSelect.value = exp.vendorId || '';
        handleVendorSelect();
        
        if (exp.accountNumber) {
            const accVal = `${exp.bankName}|${exp.accountNumber}|${exp.accountHolder}`;
            fAccountSelect.value = accVal;
        }
        
        initialFormData = getFormDataString();
        openExpenseModal();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

async function saveExpense() {
    if (!fCreatedDate.value || !fPaymentDate.value || !fAmount.value || !fTitle.value || !fVendorSelect.value) {
        showToast('필수 항목(* 표시)을 모두 입력해주세요.', 'warning');
        return;
    }

    const selectedVendor = currentVendors.find(v => v.id === fVendorSelect.value);
    if (!selectedVendor) return;

    let bankName = '', accountNumber = '', accountHolder = '';
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

    const payload = {
        createdDate: fCreatedDate.value,
        paymentDate: fPaymentDate.value,
        currency: fCurrency.value,
        amount: parseFloat(fAmount.value) || 0,
        vatAmount: isForeignCurrency(fCurrency.value) ? 0 : (parseFloat(fVatAmount.value) || 0),
        vendorId: selectedVendor.id,
        vendorName: selectedVendor.vendorName,
        representative: selectedVendor.representative,
        bizRegNumber: selectedVendor.bizRegNumber,
        bankName: bankName,
        accountNumber: accountNumber,
        accountHolder: accountHolder,
        paymentMethod: document.querySelector('input[name="paymentMethod"]:checked').value,
        title: fTitle.value,
        taxInvoiceDate: fTaxInvoiceDate.value,
        content: fContent.value,
        personInCharge: fPersonInCharge.value
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
        
        showToast('지출결의서가 저장되었습니다.', 'success');
        closeExpenseModal();
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

function handleCurrencyChange() {
    const curr = fCurrency.value;
    if (isForeignCurrency(curr)) {
        fAmount.step = "0.01";
        vatGroup.style.display = 'none';
        fVatAmount.value = '';
    } else {
        fAmount.step = "1";
        vatGroup.style.display = 'block';
    }
}

function updateVendorDropdown(searchStr = '') {
    fVendorSelect.innerHTML = '<option value="">-- 거래처 선택 --</option>';
    
    let filteredVendors = currentVendors;
    if (searchStr.trim() !== '') {
        const s = searchStr.toLowerCase();
        filteredVendors = currentVendors.filter(v => v.vendorName.toLowerCase().includes(s));
    }

    filteredVendors.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.vendorName;
        fVendorSelect.appendChild(opt);
    });
}

function handleVendorSelect() {
    const vid = fVendorSelect.value;
    const vendor = currentVendors.find(v => v.id === vid);
    
    if (!vendor) {
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
            const text = `${acc.bankName} | ${acc.accountNumber} | ${acc.accountHolder}`;
            const opt = new Option(text, val);
            fAccountSelect.appendChild(opt);
        });
    }
}

// ==========================================
// 거래처 프리셋 로직
// ==========================================

function openVendorModal() {
    vendorModal.classList.add('active');
    hideVendorForm();
}

function closeVendorModal() {
    vendorModal.classList.remove('active');
    // If expense form is open, update dropdown
    if (expenseEditModal.classList.contains('active')) {
        const currentSel = fVendorSelect.value;
        updateVendorDropdown();
        fVendorSelect.value = currentSel;
        handleVendorSelect();
    }
}

async function loadVendors() {
    try {
        const res = await authFetch(`${API_URL}/vendors`);
        if (res.ok) {
            currentVendors = await res.json();
            renderVendorList();
        }
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
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${v.vendorName}</strong></td>
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
    const v = currentVendors.find(x => x.id === id);
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
    if(!confirm('이 거래처를 삭제하시겠습니까?')) return;
    try {
        const res = await authFetch(`${API_URL}/vendors/${id}`, { method: 'DELETE' });
        if(res.ok) {
            showToast('거래처가 삭제되었습니다.', 'success');
            await loadVendors();
            hideVendorForm();
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

    const method = editingVendorId ? 'PUT' : 'POST';
    const url = editingVendorId ? `${API_URL}/vendors/${editingVendorId}` : `${API_URL}/vendors`;

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
    if (!fCreatedDate.value || !fAmount.value || !fTitle.value || !fVendorSelect.value) {
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
    const selectedVendor = currentVendors.find(v => v.id === fVendorSelect.value);
    let bankName = '', accountNumber = '', accountHolder = '';
    if (selectedVendor) {
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
        vendorName: selectedVendor ? selectedVendor.vendorName : '',
        representative: selectedVendor ? selectedVendor.representative : '',
        bizRegNumber: selectedVendor ? selectedVendor.bizRegNumber : '',
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

function showToast(msg, type='info') {
    const tc = document.getElementById('toastContainer');
    if(!tc) return alert(msg);
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerText = msg;
    tc.appendChild(t);
    setTimeout(()=> t.remove(), 3000);
}
