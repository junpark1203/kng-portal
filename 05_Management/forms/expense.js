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
    expenseEditModal.classList.remove('active');
    document.body.style.overflow = '';
    loadExpenses();
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

function renderExpenseList() {
    expenseListBody.innerHTML = '';
    if (currentExpenses.length === 0) {
        expenseListBody.innerHTML = '<tr><td colspan="9" class="text-center">등록된 지출결의서가 없습니다.</td></tr>';
        return;
    }

    currentExpenses.forEach(exp => {
        const tr = document.createElement('tr');
        const currencySym = getCurrencySymbol(exp.currency);
        
        let amountText = exp.amount.toLocaleString(undefined, { minimumFractionDigits: isForeignCurrency(exp.currency) ? 2 : 0 });
        
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="check-row" value="${exp.id}"></td>
            <td>${exp.createdDate || '-'}</td>
            <td><strong>${exp.title || '-'}</strong></td>
            <td>${exp.vendorName || '-'}</td>
            <td>${exp.currency}</td>
            <td style="text-align:right;">${currencySym} ${amountText}</td>
            <td>${exp.paymentMethod === 'cash' ? '현금' : '어음'}</td>
            <td>${exp.personInCharge || '-'}</td>
            <td class="col-action">
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
    updateVendorDropdown();
    vendorInfoDisplay.style.display = 'none';
    accountSelectWrap.style.display = 'none';
    
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
        updateVendorDropdown();
        fVendorSelect.value = exp.vendorId || '';
        handleVendorSelect();
        
        // After handleVendorSelect, accounts are populated. Select the right one if multiple.
        if (exp.accountNumber) {
            const accVal = `${exp.bankName}|${exp.accountNumber}|${exp.accountHolder}`;
            fAccountSelect.value = accVal;
        }
        
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

function updateVendorDropdown() {
    fVendorSelect.innerHTML = '<option value="">-- 거래처 선택 --</option>';
    currentVendors.forEach(v => {
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

function showPrintPreview() {
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

    const html = `
        <table class="doc-table">
            <tr class="doc-title-row">
                <td colspan="5" class="doc-title-left">수입( )지출(V) 결 의 서</td>
                <td colspan="3" style="padding:0; border:none; vertical-align:top;">
                    <table style="width:100%; height:100%; border-collapse:collapse;">
                        <tr>
                            <td class="doc-date-cell" style="border-top:none; border-right:none; text-align:center !important; width:40%;">작성 일자</td>
                            <td class="doc-date-cell" style="border-top:none; border-right:none; text-align:right !important;">${createdStr}</td>
                        </tr>
                        <tr>
                            <td class="doc-date-cell" style="border-bottom:none; border-right:none; text-align:center !important;">전결 조항</td>
                            <td class="doc-date-cell" style="border-bottom:none; border-right:none;"></td>
                        </tr>
                    </table>
                </td>
            </tr>
            <tr class="amount-row">
                <td style="width: 10%; text-align:center;">금 액</td>
                <td colspan="4" style="text-align:center; font-size: 16px;">${koreanAmt}</td>
                <td colspan="3" style="width: 30%; text-align:right;">${curr}${amtStr} ${sym}</td>
            </tr>
            <tr>
                <th style="width: 10%;">은행명</th>
                <td style="width: 20%; font-size:10px; text-align:center;">${bankName || '-'}</td>
                <th style="width: 10%;">계좌번호</th>
                <td colspan="2" style="text-align:center;">${accountNumber || '-'}</td>
                <th style="width: 10%;">예금주</th>
                <td colspan="2" style="font-size:10px; text-align:center;">${accountHolder || '-'}</td>
            </tr>
            <tr>
                <th colspan="2">지급 요청일</th>
                <td colspan="2" style="text-align:center;">${payStr}</td>
                <td colspan="4" style="text-align:center;">사장</td>
            </tr>
            <tr>
                <th rowspan="2">지 불<br>조 건</th>
                <th style="width: 10%;">현금</th>
                <td colspan="2" style="text-align:center;">${isCash ? 'O' : ''}</td>
                <td colspan="4" rowspan="2"></td>
            </tr>
            <tr>
                <th>어음</th>
                <td colspan="2" style="text-align:center;">${!isCash ? 'O' : ''}</td>
            </tr>
            <tr>
                <th rowspan="4">결<br><br><br>재</th>
                <th>전무</th>
                <td style="width:10%;"></td>
                <th>부사장</th>
                <td style="width:10%;"></td>
                <td colspan="2" rowspan="4">
                    <table class="approval-table" style="border:none;">
                        <tr><td style="border:none;" class="approval-label-cell">협</td></tr>
                        <tr><td style="border:none;" class="approval-label-cell">조</td></tr>
                    </table>
                </td>
                <td rowspan="4" style="width:15%;"></td>
            </tr>
            <tr>
                <th>이사</th>
                <td></td>
                <th>상무</th>
                <td></td>
            </tr>
            <tr>
                <th>차장</th>
                <td></td>
                <th>부장</th>
                <td></td>
            </tr>
            <tr>
                <th>대리</th>
                <td></td>
                <th>과장</th>
                <td></td>
            </tr>
            <tr>
                <th colspan="2">담 당</th>
                <td colspan="3" style="text-align:center;">${fPersonInCharge.value || '-'}</td>
                <td colspan="3" style="text-align:center;">현장명</td>
            </tr>
        </table>
        
        <table class="doc-table" style="margin-top: 8px;">
            <tr>
                <th style="width: 18%;">거래처/대표자</th>
                <td style="width: 32%; font-size:10px; text-align:center;">${selectedVendor ? selectedVendor.vendorName : '-'}</td>
                <th style="width: 10%;">대표자</th>
                <td style="width: 15%; text-align:center;">${selectedVendor ? selectedVendor.representative : '-'}</td>
                <th style="width: 10%; font-size:10px;">사업자<br>등록번호</th>
                <td style="width: 15%; font-size:10px; text-align:center;">${selectedVendor ? selectedVendor.bizRegNumber : '-'}</td>
            </tr>
            <tr>
                <th>제 목</th>
                <td colspan="5">${fTitle.value || '-'}</td>
            </tr>
            <tr>
                <th>세금계산서 일자</th>
                <th colspan="2">적 요</th>
                <th colspan="2">금 액</th>
                <th>비 고</th>
            </tr>
            <tr>
                <td rowspan="3" style="text-align:center;">${fTaxInvoiceDate.value || ''}</td>
                <td colspan="2" style="text-align:center;">공 급 가</td>
                <td colspan="2" style="text-align:right;">${curr}${amtStr} ${sym}</td>
                <td rowspan="3"></td>
            </tr>
            <tr>
                <td colspan="2" style="text-align:center;">부가 가치세</td>
                <td colspan="2" style="text-align:right;">${isForeign ? '' : (vat.toLocaleString() + ' ₩')}</td>
            </tr>
            <tr class="total-row">
                <td colspan="2" style="text-align:center; background:#e8f0fe;">계</td>
                <td colspan="2" style="text-align:right;">${curr}${(amount + (isForeign ? 0 : vat)).toLocaleString(undefined, { minimumFractionDigits: isForeign ? 2 : 0 })} ${sym}</td>
            </tr>
            <tr>
                <th>내 용</th>
                <td colspan="5" class="content-cell">${fContent.value || ''}</td>
            </tr>
            <tr>
                <th>출납확인</th>
                <td style="text-align:center;">담 당</td>
                <td></td>
                <td colspan="2" style="text-align:center;">회계</td>
                <td></td>
            </tr>
        </table>
        
        <div class="doc-company-footer">(주)케이앤지</div>
    `;

    page.insertAdjacentHTML('beforeend', html);
    printLayout.style.display = 'block';
    document.body.style.overflow = 'hidden';
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
