// tbm-material-quotes.js (Frontend)

let suppliers = []; // Array of supplier names
let items = []; // Array of item objects
let currentDocumentId = null;

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000/api/tbm-material-quotes' : 'https://kng.junparks.com/api/tbm-material-quotes';


async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    opts.headers['Content-Type'] = 'application/json';
    const res = await fetch(url, opts);
    if (!res.ok && res.status === 401 && _retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return authFetch(url, opts, _retries - 1);
    }
    if (!res.ok) {
        let errStr = res.statusText;
        try { 
            const errObj = await res.json(); 
            errStr = errObj.error || errStr; 
        } catch(e) {
            try {
                const text = await res.text();
                errStr = text ? text.substring(0, 100) : ('HTTP Error ' + res.status);
            } catch (innerE) {
                errStr = 'HTTP Error ' + res.status;
            }
        }
        throw new Error(errStr || 'Unknown Error');
    }
    return res;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const user = await kngAuth.verifyToken();
        if (user && user.name) {
            document.getElementById('currentUser').textContent = user.name;
        }
    } catch (error) {
        console.error('Auth error:', error);
    }

    // Check for exported quotes from Site Consumables
    const exportDataStr = localStorage.getItem('tbmQuoteExport');
    if (exportDataStr) {
        try {
            const exportData = JSON.parse(exportDataStr);
            if (exportData && exportData.length > 0) {
                const now = new Date();
                const title = `TBM 자재 단가 비교 (${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')})`;
                document.getElementById('documentTitle').value = title;
                
                items = exportData.map(d => ({
                    identifier: d.identifier || '',
                    name: d.name || '',
                    specification: d.specification || '',
                    sites: Array.isArray(d.sites) ? d.sites.join(', ') : (d.sites || ''),
                    totalQuantity: d.totalQuantity || 0,
                    unit: d.unit || 'EA',
                    prices: {} // mapping of supplierName -> price
                }));
                
                renderTable();
                showDetailView();
                localStorage.removeItem('tbmQuoteExport');
            } else {
                showListView();
            }
        } catch(e) {
            console.error('Failed to parse exported quote data', e);
            showListView();
        }
    } else {
        showListView();
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

function showListView() {
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('listView').style.display = 'flex';
    loadDocumentList();
}

function showDetailView() {
    document.getElementById('listView').style.display = 'none';
    document.getElementById('detailView').style.display = 'flex';
}

function createNewDocument() {
    items = [];
    suppliers = [];
    currentDocumentId = null;
    document.getElementById('documentTitle').value = '';
    renderTable();
    showDetailView();
}

async function addSupplierColumn() {
    const { value: supplierName } = await Swal.fire({
        title: '업체(공급사) 추가',
        input: 'text',
        inputLabel: '업체명을 입력하세요',
        inputPlaceholder: '예: 성원멤테크(A8)',
        showCancelButton: true
    });

    if (supplierName) {
        if (suppliers.some(s => s.name === supplierName)) {
            Swal.fire('오류', '이미 추가된 업체입니다.', 'error');
            return;
        }
        
        // Save current input values before re-rendering
        saveCurrentInputValues();
        
        suppliers.push({ name: supplierName, currency: 'KRW', rate: 1 });
        renderTable();
    }
}

function removeSupplierColumn(supplierName) {
    saveCurrentInputValues();
    suppliers = suppliers.filter(s => s.name !== supplierName);
    items.forEach(item => {
        delete item.prices[supplierName];
    });
    renderTable();
}

function saveCurrentInputValues() {
    // Read all inputs from DOM and update the `items` array
    const rows = document.querySelectorAll('#quoteTableBody tr[data-index]');
    rows.forEach(row => {
        const index = parseInt(row.getAttribute('data-index'));
        suppliers.forEach(supp => {
            const input = row.querySelector(`input[data-supplier="${escapeHtml(supp.name)}"]`);
            if (input) {
                items[index].prices[supp.name] = input.value.replace(/,/g, '');
            }
        });
    });
}

function renderTable() {
    const thead = document.getElementById('tableHeaderRow');
    const tbody = document.getElementById('quoteTableBody');
    
    // 1. Rebuild Headers
    // Remove existing supplier headers
    document.querySelectorAll('.supplier-col').forEach(el => el.remove());
    
    const addTh = document.getElementById('addSupplierTh');
    
    suppliers.forEach(supp => {
        const th = document.createElement('th');
        th.className = 'supplier-col';
        th.style.width = '170px';
        th.style.textAlign = 'right';
        th.style.paddingRight = '12px';
        
        let incotermsHtml = '';
        if (supp.currency !== 'KRW') {
            incotermsHtml = `
                <div style="margin-top: 4px; display:flex;">
                    <select style="flex:1; padding:2px; font-size:11px; border:1px solid var(--gray-300); border-radius:4px; outline:none; color: var(--gray-700);" onchange="updateSupplierIncoterms('${escapeHtml(supp.name)}', this.value)">
                        <option value="">조건 선택 (Incoterms)</option>
                        <option value="EXW" ${supp.incoterms === 'EXW' ? 'selected' : ''}>EXW (공장인도)</option>
                        <option value="FCA" ${supp.incoterms === 'FCA' ? 'selected' : ''}>FCA (운송인인도)</option>
                        <option value="FOB" ${supp.incoterms === 'FOB' ? 'selected' : ''}>FOB (본선적재)</option>
                        <option value="CFR" ${supp.incoterms === 'CFR' ? 'selected' : ''}>CFR (운임포함)</option>
                        <option value="CIF" ${supp.incoterms === 'CIF' ? 'selected' : ''}>CIF (운임보험료포함)</option>
                        <option value="DAP" ${supp.incoterms === 'DAP' ? 'selected' : ''}>DAP (도착지인도)</option>
                        <option value="DDP" ${supp.incoterms === 'DDP' ? 'selected' : ''}>DDP (관세지급인도)</option>
                    </select>
                </div>
            `;
        }

        th.innerHTML = `
            <div class="web-only">
                <div style="display:flex; justify-content: space-between; align-items:flex-start;">
                    <i class='bx bx-x' style="cursor:pointer; color: #ef4444; margin-top: 2px;" onclick="removeSupplierColumn('${escapeHtml(supp.name)}')"></i>
                    <div style="text-align:right;">
                        <span>${escapeHtml(supp.name)}</span>
                        ${supp.currency !== 'KRW' ? `<div style="font-size: 10px; color: var(--gray-500); font-weight: normal; margin-top: 2px;">(${supp.currency}, ${supp.currency === 'USD' ? '$' : (supp.currency === 'EUR' ? '€' : (supp.currency === 'CNY' ? '¥' : ''))}1=₩${supp.rate.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})})</div>` : ''}
                    </div>
                </div>
                <div style="margin-top: 8px; display:flex; gap: 4px;">
                    <select style="flex:1; padding:2px; font-size:12px; border:1px solid var(--gray-300); border-radius:4px; outline:none;" onchange="updateSupplierCurrency('${escapeHtml(supp.name)}', this.value)">
                        <option value="KRW" ${supp.currency === 'KRW' ? 'selected' : ''}>KRW</option>
                        <option value="USD" ${supp.currency === 'USD' ? 'selected' : ''}>USD</option>
                        <option value="EUR" ${supp.currency === 'EUR' ? 'selected' : ''}>EUR</option>
                        <option value="CNY" ${supp.currency === 'CNY' ? 'selected' : ''}>CNY</option>
                        <option value="JPY" ${supp.currency === 'JPY' ? 'selected' : ''}>JPY</option>
                    </select>
                    <input type="number" step="0.01" placeholder="환율" value="${supp.rate || 1}" ${supp.currency === 'KRW' ? 'disabled' : ''} style="flex:1.2; width:50px; padding:2px; font-size:12px; border:1px solid var(--gray-300); border-radius:4px; text-align:right;" onchange="updateSupplierRate('${escapeHtml(supp.name)}', this.value)">
                </div>
                ${incotermsHtml}
            </div>
            <div class="print-only">
                <div style="font-weight: 800; font-size: 13px; color: #000; text-align: center;">${escapeHtml(supp.name)}</div>
                ${supp.currency !== 'KRW' ? `<div style="font-size: 10px; color: #475569; margin-top: 4px; text-align: center;">(${supp.currency} / ${supp.rate}${supp.incoterms ? ' / ' + supp.incoterms : ''})</div>` : ''}
            </div>
        `;
        thead.insertBefore(th, addTh);
    });

    // 2. Rebuild Body
    tbody.innerHTML = '';
    if (items.length === 0) {
        tbody.innerHTML = `
            <tr id="emptyStateRow">
                <td colspan="${7 + suppliers.length + 1}" style="text-align: center; padding: 60px 20px; color: var(--gray-400);">
                    <i class='bx bx-box' style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
                    <p style="font-size: 15px; font-weight: 500;">견적 비교할 항목이 없습니다.</p>
                </td>
            </tr>
        `;
        return;
    }

    items.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-index', index);
        
        let html = `
            <td class="sticky-col" style="left: 0; z-index: 5; text-align: center;">${index + 1}</td>
            <td class="sticky-col" style="left: 60px; z-index: 5; font-weight:600; word-break: break-all; max-width: 120px;">${escapeHtml(item.identifier)}</td>
            <td class="sticky-col" style="left: 200px; z-index: 5;">${escapeHtml(item.name)}</td>
            <td class="sticky-col" style="left: 380px; z-index: 5;">${escapeHtml(item.specification)}</td>
            <td class="sticky-col" style="left: 530px; z-index: 5;">
                <span class="site-tag" style="display:inline-block; padding:2px 6px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;">
                    ${escapeHtml(item.sites)}
                </span>
            </td>
            <td class="sticky-col" style="left: 650px; z-index: 5; text-align: right; font-weight: 600;">${item.totalQuantity}</td>
            <td class="sticky-col" style="left: 740px; z-index: 5; text-align: center; border-right: 2px solid var(--gray-300);">${escapeHtml(item.unit)}</td>
        `;

        suppliers.forEach(supp => {
            const suppName = supp.name;
            const price = item.prices[suppName] || '';
            let krwText = '';
            
            // Unformat first in case there are old commas
            const numericPrice = Number(String(price).replace(/,/g, ''));
            
            if (numericPrice && supp.currency !== 'KRW') {
                const krwPrice = Math.round(numericPrice * supp.rate);
                krwText = '₩' + krwPrice.toLocaleString();
            }

            // Format for display
            let displayPrice = String(price).replace(/[^0-9.]/g, '');
            let parts = displayPrice.split('.');
            if (parts[0]) {
                parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                displayPrice = parts.join('.');
            }

            html += `
                <td class="supplier-col" data-currency="${supp.currency}" style="padding: 4px 8px;">
                    <div class="web-only">
                        <input type="text" data-supplier="${escapeHtml(suppName)}" value="${displayPrice}" 
                               style="width:100%; padding:6px; text-align:right; border:1px solid var(--gray-300); border-radius:4px; font-size:13px;"
                               placeholder="0" oninput="handlePriceInput(this, '${escapeHtml(suppName)}')">
                        <div class="krw-preview" style="font-size: 11px; color: #64748b; text-align: right; min-height: 16px; margin-top: 2px;">
                            ${krwText}
                        </div>
                    </div>
                    <div class="print-only">
                        ${supp.currency === 'KRW' 
                            ? `<div style="font-size: 12px; font-weight: 800; color: #000; text-align: right; width: 100%;">${displayPrice ? '₩' + displayPrice : ''}</div>`
                            : `<div style="font-size: 12px; font-weight: 800; color: #000; text-align: right; width: 100%;">${krwText}</div>
                               <div style="font-size: 10px; color: #64748b; text-align: right; margin-top: 2px;">${displayPrice ? supp.currency + ' ' + displayPrice : ''}</div>`
                        }
                    </div>
                </td>
            `;
        });
        
        html += `<td class="filler-col" style="background: #f8fafc;"></td>`; // filler for the "Add" column space
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

function updateSupplierCurrency(supplierName, currency) {
    saveCurrentInputValues();
    const supp = suppliers.find(s => s.name === supplierName);
    if (supp) {
        supp.currency = currency;
        if (currency === 'KRW') {
            supp.rate = 1;
            supp.incoterms = '';
        }
    }
    renderTable();
}

function updateSupplierRate(supplierName, rate) {
    saveCurrentInputValues();
    const supp = suppliers.find(s => s.name === supplierName);
    if (supp) {
        supp.rate = Number(rate) || 1;
    }
    renderTable();
}

function updateSupplierIncoterms(supplierName, incoterms) {
    saveCurrentInputValues();
    const supp = suppliers.find(s => s.name === supplierName);
    if (supp) {
        supp.incoterms = incoterms;
    }
    renderTable();
}

function handlePriceInput(inputEl, supplierName) {
    // 1. Format the value with commas
    let valStr = inputEl.value.replace(/[^0-9.]/g, '');
    let parts = valStr.split('.');
    if (parts[0]) {
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        inputEl.value = parts.join('.');
    }

    // 2. Calculate KRW equivalent
    const supp = suppliers.find(s => s.name === supplierName);
    const previewEl = inputEl.nextElementSibling;
    const printContainer = inputEl.closest('.supplier-col').querySelector('.print-only');
    const val = Number(valStr);
    
    let krwFormatted = '';
    if (supp && supp.currency !== 'KRW' && val) {
        const krwPrice = Math.round(val * supp.rate);
        krwFormatted = '₩' + krwPrice.toLocaleString();
        previewEl.textContent = krwFormatted;
    } else {
        previewEl.textContent = '';
    }

    // 3. Update print-only view
    if (printContainer) {
        if (supp && supp.currency === 'KRW') {
            printContainer.innerHTML = `<div style="font-size: 12px; font-weight: 800; color: #000; text-align: right; width: 100%;">${inputEl.value ? '₩' + inputEl.value : ''}</div>`;
        } else {
            printContainer.innerHTML = `
                <div style="font-size: 12px; font-weight: 800; color: #000; text-align: right; width: 100%;">${krwFormatted}</div>
                <div style="font-size: 10px; color: #64748b; text-align: right; margin-top: 2px;">${inputEl.value ? supp.currency + ' ' + inputEl.value : ''}</div>
            `;
        }
    }
}

function clearTable() {
    Swal.fire({
        title: '초기화',
        text: '작성 중인 모든 데이터가 삭제됩니다. 계속하시겠습니까?',
        icon: 'warning',
        showCancelButton: true
    }).then((res) => {
        if(res.isConfirmed) {
            items = [];
            suppliers = [];
            currentDocumentId = null;
            document.getElementById('documentTitle').value = '';
            renderTable();
        }
    });
}

async function saveDocument(status) {
    const title = document.getElementById('documentTitle').value.trim();
    if (!title) {
        Swal.fire('입력 오류', '문서 제목을 입력해주세요.', 'warning');
        return;
    }
    
    saveCurrentInputValues(); // flush UI to memory
    
    const docData = {
        title: title,
        status: status,
        suppliers: suppliers,
        items: items
    };

    try {
        const method = currentDocumentId ? 'PUT' : 'POST';
        const url = currentDocumentId ? `${API_BASE}/${currentDocumentId}` : API_BASE;
        
        const res = await authFetch(url, {
            method: method,
            body: JSON.stringify(docData)
        });
        const result = await res.json();
        
        if (!currentDocumentId && result.id) {
            currentDocumentId = result.id;
        }
        
        Swal.fire('성공', '견적서가 저장되었습니다.', 'success');
    } catch(err) {
        Swal.fire('저장 실패', err.message, 'error');
    }
}

async function loadDocumentList() {
    try {
        const res = await authFetch(API_BASE);
        const docs = await res.json();
        
        const tbody = document.getElementById('documentListBody');
        tbody.innerHTML = '';
        
        if (docs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 40px; color: var(--gray-400);">저장된 문서가 없습니다.</td></tr>';
        } else {
            docs.forEach(doc => {
                const statusHtml = doc.status === 'completed' 
                    ? '<span style="color:#10b981; font-weight:600;"><i class="bx bx-check-double"></i> 완료</span>'
                    : '<span style="color:#3b82f6; font-weight:600;"><i class="bx bx-edit-alt"></i> 임시저장</span>';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align:center; white-space: nowrap;">${statusHtml}</td>
                    <td style="font-weight:600; cursor:pointer; color:#4f46e5; white-space: nowrap; max-width: 400px; overflow: hidden; text-overflow: ellipsis;" onclick="loadDocument('${doc.id}')">${escapeHtml(doc.title)}</td>
                    <td style="white-space: nowrap;">${new Date(doc.createdAt).toLocaleString()}</td>
                    <td style="text-align:center; white-space: nowrap;">
                        <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; color:#ef4444; border-color:#ef4444;" onclick="deleteDocument('${doc.id}')">삭제</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch(err) {
        Swal.fire('오류', '목록을 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

async function loadDocument(id) {
    try {
        const res = await authFetch(`${API_BASE}/${id}`);
        const doc = await res.json();
        
        currentDocumentId = doc.id;
        document.getElementById('documentTitle').value = doc.title;
        suppliers = (doc.suppliers || []).map(s => {
            if (typeof s === 'string') return { name: s, currency: 'KRW', rate: 1 };
            return s;
        });
        items = doc.items || [];
        
        renderTable();
        showDetailView();
    } catch(err) {
        Swal.fire('오류', '문서를 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

async function deleteDocument(id) {
    if(!confirm('이 문서를 정말 삭제하시겠습니까?')) return;
    try {
        await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        if (currentDocumentId === id) {
            items = [];
            suppliers = [];
            currentDocumentId = null;
            document.getElementById('documentTitle').value = '';
            renderTable();
        }
        loadDocumentList(); // refresh list
    } catch(err) {
        Swal.fire('삭제 실패', err.message, 'error');
    }
}

function prepareAndPrint() {
    saveCurrentInputValues();
    const title = document.getElementById('documentTitle').value || 'TBM 자재 단가 비교표';
    
    let html = `<table style="width: 100%; border: none; margin: 0; padding: 0; border-spacing: 0;">`;
    html += `<thead style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></thead>`;
    html += `<tfoot style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></tfoot>`;
    html += `<tbody><tr><td style="border: none; padding: 0 15mm;">`;
    
    html += `<div style="text-align:center; margin-bottom: 20px;">`;
    html += `<h1 style="font-size: 24px; font-weight: 800; margin: 0; color: #0f172a;">${escapeHtml(title)}</h1>`;
    html += `</div>`;
    
    html += `<table class="print-matrix-table" style="width: 100%; border-collapse: collapse; border-top: 2px solid #334155; border-bottom: 2px solid #334155; font-size: 11px;">`;
    
    // Header
    html += `<thead><tr style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1;">`;
    html += `<th style="padding: 8px 4px; text-align: center; width: 40px;">No.</th>`;
    html += `<th style="padding: 8px 4px; text-align: left;">식별번호</th>`;
    html += `<th style="padding: 8px 4px; text-align: left;">품명</th>`;
    html += `<th style="padding: 8px 4px; text-align: left;">규격</th>`;
    html += `<th style="padding: 8px 4px; text-align: left;">투입 현장</th>`;
    html += `<th style="padding: 8px 4px; text-align: right;">수량</th>`;
    html += `<th style="padding: 8px 4px; text-align: center; border-right: 1px solid #cbd5e1;">단위</th>`;
    
    suppliers.forEach(supp => {
        let rateStr = supp.currency === 'KRW' ? '' : `, ${supp.currency === 'USD' ? '$' : (supp.currency === 'EUR' ? '€' : (supp.currency === 'CNY' ? '¥' : ''))}1=₩${supp.rate.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        html += `<th style="padding: 8px 4px; text-align: right;">${escapeHtml(supp.name)}<br><span style="font-size:9px; color:#64748b; font-weight:normal;">(${supp.currency}${rateStr})</span></th>`;
    });
    html += `</tr></thead><tbody>`;
    
    if (items.length === 0) {
        html += `<tr><td colspan="${7 + suppliers.length}" style="text-align: center; padding: 20px; color: #64748b;">견적 비교할 항목이 없습니다.</td></tr>`;
    } else {
        items.forEach((item, index) => {
            let prices = [];
            suppliers.forEach(supp => {
                let p = parseFloat(item.prices[supp.name]) || 0;
                if(p > 0) {
                    // normalize to KRW for comparison
                    prices.push(p * supp.rate);
                }
            });
            let minPriceKrw = prices.length > 0 ? Math.min(...prices) : 0;
            
            html += `<tr style="border-bottom: 1px solid #e2e8f0;">`;
            html += `<td style="padding: 6px 4px; text-align: center; color: #64748b;">${index + 1}</td>`;
            html += `<td style="padding: 6px 4px; word-break: break-all;">${escapeHtml(item.identifier || '-')}</td>`;
            html += `<td style="padding: 6px 4px; font-weight: 600;">${escapeHtml(item.name || '-')}</td>`;
            html += `<td style="padding: 6px 4px;">${escapeHtml(item.specification || '-')}</td>`;
            html += `<td style="padding: 6px 4px;">${escapeHtml(item.sites || '-')}</td>`;
            html += `<td style="padding: 6px 4px; text-align: right;">${item.totalQuantity.toLocaleString()}</td>`;
            html += `<td style="padding: 6px 4px; text-align: center; border-right: 1px solid #cbd5e1;">${escapeHtml(item.unit || 'EA')}</td>`;
            
            suppliers.forEach(supp => {
                let p = parseFloat(item.prices[supp.name]) || 0;
                let isMin = (p > 0 && Math.abs(p * supp.rate - minPriceKrw) < 0.01);
                
                let cellStyle = "padding: 6px 4px; text-align: right;";
                
                if (isMin) {
                    cellStyle += " background-color: rgba(16, 185, 129, 0.1);";
                }
                
                if (p > 0) {
                    let krwValue = p * supp.rate;
                    let krwStr = '₩' + krwValue.toLocaleString('en-US', {maximumFractionDigits: 0});
                    
                    let currSymbol = supp.currency === 'USD' ? '$' : (supp.currency === 'EUR' ? '€' : (supp.currency === 'CNY' ? '¥' : ''));
                    let foreignStr = supp.currency === 'KRW' ? '' : `<br><span style="font-size: 9px; color: #64748b; font-weight: normal;">${currSymbol}${p.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>`;
                    
                    let mainColor = isMin ? '#047857' : '#0f172a';
                    let mainWeight = isMin ? '800' : '600';
                    
                    html += `<td style="${cellStyle}"><div style="font-weight: ${mainWeight}; color: ${mainColor};">${krwStr}</div>${foreignStr}</td>`;
                } else {
                    html += `<td style="${cellStyle} color: #cbd5e1;">-</td>`;
                }
            });
            html += `</tr>`;
        });
    }
    
    html += `</tbody></table>`;
    html += `</td></tr></tbody></table>`;
    
    const printContainer = document.getElementById('printContainer');
    printContainer.innerHTML = html;
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            printContainer.innerHTML = '';
        }, 500);
    }, 100);
}
