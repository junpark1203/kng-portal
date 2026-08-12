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
                localStorage.removeItem('tbmQuoteExport');
            }
        } catch(e) {
            console.error('Failed to parse exported quote data', e);
        }
    }
});

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
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
        if (suppliers.includes(supplierName)) {
            Swal.fire('오류', '이미 추가된 업체입니다.', 'error');
            return;
        }
        
        // Save current input values before re-rendering
        saveCurrentInputValues();
        
        suppliers.push(supplierName);
        renderTable();
    }
}

function removeSupplierColumn(supplierName) {
    saveCurrentInputValues();
    suppliers = suppliers.filter(s => s !== supplierName);
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
            const input = row.querySelector(`input[data-supplier="${escapeHtml(supp)}"]`);
            if (input) {
                items[index].prices[supp] = input.value;
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
        th.style.width = '140px';
        th.style.textAlign = 'right';
        th.style.paddingRight = '12px';
        th.innerHTML = `
            <div style="display:flex; justify-content: space-between; align-items:center;">
                <i class='bx bx-x' style="cursor:pointer; color: #ef4444;" onclick="removeSupplierColumn('${escapeHtml(supp)}')"></i>
                <span>${escapeHtml(supp)} (원)</span>
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
            <td class="sticky-col" style="left: 60px; z-index: 5; font-weight:600;">${escapeHtml(item.identifier)}</td>
            <td class="sticky-col" style="left: 200px; z-index: 5;">${escapeHtml(item.name)}</td>
            <td class="sticky-col" style="left: 380px; z-index: 5;">${escapeHtml(item.specification)}</td>
            <td class="sticky-col" style="left: 530px; z-index: 5;">
                <span style="display:inline-block; padding:2px 6px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; font-size:11px;">
                    ${escapeHtml(item.sites)}
                </span>
            </td>
            <td class="sticky-col" style="left: 650px; z-index: 5; text-align: right; font-weight: 600;">${item.totalQuantity}</td>
            <td class="sticky-col" style="left: 740px; z-index: 5; text-align: center; border-right: 2px solid var(--gray-300);">${escapeHtml(item.unit)}</td>
        `;

        suppliers.forEach(supp => {
            const price = item.prices[supp] || '';
            html += `
                <td class="supplier-col" style="padding: 4px 8px;">
                    <input type="number" data-supplier="${escapeHtml(supp)}" value="${price}" 
                           style="width:100%; padding:6px; text-align:right; border:1px solid var(--gray-300); border-radius:4px; font-size:13px;"
                           placeholder="0">
                </td>
            `;
        });
        
        html += `<td style="background: #f8fafc;"></td>`; // filler for the "Add" column space
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
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
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">저장된 문서가 없습니다.</td></tr>';
        } else {
            docs.forEach(doc => {
                const statusHtml = doc.status === 'completed' 
                    ? '<span style="color:#10b981; font-weight:600;"><i class="bx bx-check-double"></i> 완료</span>'
                    : '<span style="color:#3b82f6; font-weight:600;"><i class="bx bx-edit-alt"></i> 임시저장</span>';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align:center;">${statusHtml}</td>
                    <td style="font-weight:600; cursor:pointer; color:#4f46e5;" onclick="loadDocument('${doc.id}')">${escapeHtml(doc.title)}</td>
                    <td>${new Date(doc.createdAt).toLocaleString()}</td>
                    <td style="text-align:center;">
                        <button class="btn btn-outline" style="padding:4px 8px; font-size:12px; color:#ef4444; border-color:#ef4444;" onclick="deleteDocument('${doc.id}')">삭제</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
        
        document.getElementById('loadModal').classList.add('active');
    } catch(err) {
        Swal.fire('오류', '목록을 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

function closeLoadModal() {
    document.getElementById('loadModal').classList.remove('active');
}

async function loadDocument(id) {
    try {
        const res = await authFetch(`${API_BASE}/${id}`);
        const doc = await res.json();
        
        currentDocumentId = doc.id;
        document.getElementById('documentTitle').value = doc.title;
        suppliers = doc.suppliers || [];
        items = doc.items || [];
        
        renderTable();
        closeLoadModal();
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
