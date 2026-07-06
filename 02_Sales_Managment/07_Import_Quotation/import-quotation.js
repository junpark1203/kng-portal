// 02_Sales_Managment/07_Import_Quotation/import-quotation.js

const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';
const API_BASE = '/api/import-quotation';
let quotes = [];
let currentQuoteId = null;
let currentItems = [];

// ==========================================
// 인증 및 API
// ==========================================
async function getToken() {
    try {
        if (window.parent && typeof window.parent.getAuthToken === 'function') {
            let token = await window.parent.getAuthToken();
            let retries = 0;
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

// ==========================================
// 유틸리티
// ==========================================
function formatCurrency(amount, currency = 'USD') {
    if (amount === undefined || amount === null || isNaN(amount)) return '0.00';
    if (currency === 'KRW') {
        return new Intl.NumberFormat('ko-KR').format(amount);
    }
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

function showToast(message, type = 'info') {
    // 부모 프레임에 토스트 요청 (통합 포털용)
    if (window.parent && window.parent.showToast) {
        window.parent.showToast(message, type);
    } else {
        alert(message);
    }
}

// ==========================================
// 초기화 및 이벤트 리스너
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadQuotes();
    
    // 뷰 전환 버튼
    document.getElementById('btnNewQuote').addEventListener('click', () => openEditor());
    document.getElementById('btnCancelEdit').addEventListener('click', () => {
        if(confirm('작성 중인 내용이 사라집니다. 목록으로 돌아가시겠습니까?')) {
            showView('listView');
        }
    });

    // 항목 추가 버튼
    document.getElementById('btnAddItem').addEventListener('click', () => addItemRow());

    // 저장 및 복사 버튼
    document.getElementById('btnSaveQuote').addEventListener('click', () => saveQuote(false));
    document.getElementById('btnSaveCopy').addEventListener('click', () => saveCopyQuote());

    // 삭제 버튼
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);

    // 전체 선택
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.row-check');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
    });

    // 인쇄 옵션 및 통화 변경
    document.querySelectorAll('input[name="printMode"]').forEach(radio => {
        radio.addEventListener('change', updateCurrencyDisplay);
    });
    
    document.getElementById('docCurrency').addEventListener('change', () => {
        updateCurrencyDisplay();
        updateExchangeRateLabel();
    });
    
    // 환율 입력 시 자동 계산
    document.getElementById('exRateInput').addEventListener('input', calculateTotals);

    // 연동 버튼들 (TODO)
    document.getElementById('btnImportInvoice').addEventListener('click', openInvoiceModal);
    document.getElementById('btnExportInvoice').addEventListener('click', exportToInvoice);
    document.getElementById('btnExportForwarder').addEventListener('click', exportToForwarder);
    
    // 닫기
    document.getElementById('closeInvoiceModal').addEventListener('click', () => {
        document.getElementById('invoiceLoadModal').style.display = 'none';
    });
    
    // 최신 환율 가져오기
    document.getElementById('btnLoadRates').addEventListener('click', loadLatestExchangeRates);
    
    // 인쇄 및 엑셀
    document.getElementById('btnPrint').addEventListener('click', printQuote);
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);
});

// ==========================================
// 뷰 전환
// ==========================================
function showView(viewId) {
    document.querySelectorAll('.view-panel').forEach(el => el.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

// ==========================================
// 데이터 로드 및 렌더링
// ==========================================
async function loadQuotes() {
    try {
        quotes = await authFetch(API_BASE);
        renderQuoteList();
    } catch (err) {
        console.error(err);
        showToast(err.message, 'error');
    }
}

function renderQuoteList() {
    const tbody = document.getElementById('quoteListBody');
    tbody.innerHTML = '';
    
    if (quotes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:2rem;">등록된 견적이 없습니다.</td></tr>';
        return;
    }
    
    quotes.forEach(q => {
        const tr = document.createElement('tr');
        
        // 상태 뱃지
        let statusHtml = '';
        if (q.status === 'draft') statusHtml = '<span class="status-badge status-draft">초안</span>';
        else if (q.status === 'sent') statusHtml = '<span class="status-badge status-sent" style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">제출</span>';
        else if (q.status === 'won') statusHtml = '<span class="status-badge status-won" style="background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">계약성사</span>';
        else if (q.status === 'lost') statusHtml = '<span class="status-badge status-lost" style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:4px;font-size:12px;font-weight:600;">실패</span>';
        
        let dateStr = '-';
        if (q.createdAt) {
            const d = new Date(q.createdAt);
            if (!isNaN(d.getTime())) {
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const hh = String(d.getHours()).padStart(2, '0');
                const min = String(d.getMinutes()).padStart(2, '0');
                dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
            } else {
                dateStr = q.createdAt.replace('T', ' ').substring(0, 16);
            }
        }
        
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="row-check" value="${q.id}"></td>
            <td>${statusHtml}</td>
            <td style="font-weight:600; cursor:pointer; color:var(--primary);" onclick="editQuote('${q.id}')">${q.title || '제목 없음'}</td>
            <td>${q.supplierName || '-'}</td>
            <td>${q.quoteDate || '-'}</td>
            <td>${q.paymentTerms || '-'}</td>
            <td>${dateStr}</td>
            <td class="col-action">
                <button class="btn-icon" onclick="editQuote('${q.id}')" title="수정"><i class='bx bx-edit-alt'></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 편집 및 항목 관리
// ==========================================
function openEditor(quote = null) {
    showView('editView');
    const isEdit = quote !== null;
    currentQuoteId = isEdit ? quote.id : null;
    
    document.getElementById('editTitle').innerHTML = isEdit ? "<i class='bx bx-edit-alt'></i> 수입 견적 수정" : "<i class='bx bx-plus'></i> 신규 수입 견적 작성";
    document.getElementById('btnSaveCopy').style.display = isEdit ? 'inline-block' : 'none';
    
    // 폼 초기화
    document.getElementById('docTitle').value = quote?.title || '';
    document.getElementById('docDate').value = quote?.quoteDate || new Date().toISOString().split('T')[0];
    document.getElementById('docValidity').value = quote?.validity || '';
    document.getElementById('docStatus').value = quote?.status || 'draft';
    
    document.getElementById('docSupplierName').value = quote?.supplierName || '';
    document.getElementById('docSupplierContact').value = quote?.supplierContact || '';
    document.getElementById('docIncoterms').value = quote?.incoterms || 'FOB';
    document.getElementById('docPaymentTerms').value = quote?.paymentTerms || '';
    document.getElementById('docPol').value = quote?.pol || '';
    document.getElementById('docPod').value = quote?.pod || '';
    document.getElementById('docLeadTime').value = quote?.leadTime || '';
    
    document.getElementById('docCurrency').value = quote?.currency || 'USD';
    
    // exchangeRates 오브젝트에서 현재 선택된 통화의 환율을 가져옴
    const curr = quote?.currency || 'USD';
    document.getElementById('exRateInput').value = quote?.exchangeRates?.[curr] || quote?.exchangeRates?.USD || '';
    
    document.getElementById('docRemarks').value = quote?.remarks || '';
    
    // 항목 초기화
    currentItems = quote?.items ? JSON.parse(JSON.stringify(quote.items)) : [];
    if (currentItems.length === 0) {
        addItemRow(true); // 빈 행 1개 추가
    } else {
        renderItems();
    }
    
    updateCurrencyDisplay();
    updateExchangeRateLabel();
}

function editQuote(id) {
    const q = quotes.find(x => x.id === id);
    if(q) openEditor(q);
}

function generateItemId() {
    return 'item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
}

function addItemRow(isInit = false) {
    currentItems.push({
        id: generateItemId(),
        modelNo: '',
        description: '',
        unit: 'EA',
        qty: 1,
        unitPrice: 0,
        amount: 0
    });
    renderItems();
    if (!isInit) setTimeout(() => document.getElementById(`modelNo-${currentItems[currentItems.length-1].id}`).focus(), 50);
}

function renderItems() {
    const tbody = document.getElementById('itemsBody');
    tbody.innerHTML = '';
    
    currentItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">${index + 1}</td>
            <td><input type="text" id="modelNo-${item.id}" value="${item.modelNo || ''}" onchange="updateItem('${item.id}', 'modelNo', this.value)"></td>
            <td><input type="text" id="desc-${item.id}" value="${item.description || ''}" onchange="updateItem('${item.id}', 'description', this.value)"></td>
            <td><input type="text" id="unit-${item.id}" value="${item.unit || 'EA'}" onchange="updateItem('${item.id}', 'unit', this.value)"></td>
            <td><input type="number" id="qty-${item.id}" min="1" value="${item.qty || 1}" oninput="updateItemAmount('${item.id}')"></td>
            <td><input type="number" id="price-${item.id}" min="0" step="0.01" value="${item.unitPrice || 0}" oninput="updateItemAmount('${item.id}')"></td>
            <td><input type="text" id="amount-${item.id}" readonly value="${formatCurrency(item.amount, document.getElementById('docCurrency').value)}"></td>
            <td class="krw-col" style="display:none;"><input type="text" id="amountKrw-${item.id}" readonly value="0"></td>
            <td style="text-align:center;">
                <button class="btn-icon" onclick="removeItem('${item.id}')"><i class='bx bx-trash'></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    updateCurrencyDisplay();
    calculateTotals();
}

window.updateItem = function(id, field, value) {
    const item = currentItems.find(x => x.id === id);
    if(item) item[field] = value;
};

window.updateItemAmount = function(id) {
    const item = currentItems.find(x => x.id === id);
    if (item) {
        const qty = parseFloat(document.getElementById(`qty-${id}`).value) || 0;
        const price = parseFloat(document.getElementById(`price-${id}`).value) || 0;
        item.qty = qty;
        item.unitPrice = price;
        item.amount = qty * price;
        document.getElementById(`amount-${id}`).value = formatCurrency(item.amount, document.getElementById('docCurrency').value);
    }
    calculateTotals();
};

window.removeItem = function(id) {
    currentItems = currentItems.filter(x => x.id !== id);
    renderItems();
};

function updateCurrencyDisplay() {
    const curr = document.getElementById('docCurrency').value;
    const printMode = document.querySelector('input[name="printMode"]:checked').value;
    
    // 통화 기호 업데이트
    document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = curr);
    
    // 원화 컬럼 표시 여부 (외화+원화 병기 선택 시에만 표시)
    const showKrw = printMode === 'dual';
    document.querySelectorAll('.krw-col').forEach(el => {
        el.style.display = showKrw ? 'table-cell' : 'none';
    });
    
    calculateTotals();
}

function updateExchangeRateLabel() {
    const curr = document.getElementById('docCurrency').value;
    const label = document.getElementById('exRateLabel');
    const input = document.getElementById('exRateInput');
    
    if (label) label.textContent = `(1 ${curr} 기준)`;
    if (input) input.placeholder = `${curr} 환율`;
}

function calculateTotals() {
    let totalForeign = 0;
    const curr = document.getElementById('docCurrency').value;
    const exRate = parseFloat(document.getElementById('exRateInput').value) || 1;
    const printMode = document.querySelector('input[name="printMode"]:checked').value;
    
    currentItems.forEach(item => {
        totalForeign += (item.amount || 0);
        
        if (printMode === 'dual') {
            const amountKrwEl = document.getElementById(`amountKrw-${item.id}`);
            if (amountKrwEl) {
                amountKrwEl.value = formatCurrency(item.amount * exRate, 'KRW');
            }
        }
    });
    
    document.getElementById('totalForeign').textContent = formatCurrency(totalForeign, curr);
    
    if (printMode === 'dual') {
        document.getElementById('totalKrw').textContent = formatCurrency(totalForeign * exRate, 'KRW');
    }
}

// ==========================================
// 저장 및 삭제
// ==========================================
async function saveQuote(isCopy = false) {
    const title = document.getElementById('docTitle').value.trim();
    if (!title) return alert('견적명을 입력해주세요.');
    
    const payload = {
        title,
        quoteDate: document.getElementById('docDate').value,
        validity: document.getElementById('docValidity').value,
        status: document.getElementById('docStatus').value,
        supplierName: document.getElementById('docSupplierName').value,
        supplierContact: document.getElementById('docSupplierContact').value,
        incoterms: document.getElementById('docIncoterms').value,
        paymentTerms: document.getElementById('docPaymentTerms').value,
        pol: document.getElementById('docPol').value,
        pod: document.getElementById('docPod').value,
        leadTime: document.getElementById('docLeadTime').value,
        currency: document.getElementById('docCurrency').value,
        exchangeRates: {
            [document.getElementById('docCurrency').value]: parseFloat(document.getElementById('exRateInput').value) || null
        },
        items: currentItems,
        remarks: document.getElementById('docRemarks').value
    };

    try {
        const btn = isCopy ? document.getElementById('btnSaveCopy') : document.getElementById('btnSaveQuote');
        const orgHtml = btn.innerHTML;
        btn.innerHTML = '저장 중...';
        btn.disabled = true;

        if (currentQuoteId && !isCopy) {
            await authFetch(`${API_BASE}/${currentQuoteId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            await authFetch(API_BASE, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }
        
        btn.innerHTML = orgHtml;
        btn.disabled = false;
        
        showToast(isCopy ? '복사본이 저장되었습니다.' : '저장되었습니다.', 'success');
        await loadQuotes();
        showView('listView');
    } catch (err) {
        console.error(err);
        showToast('저장 실패: ' + err.message, 'error');
    }
}

function saveCopyQuote() {
    if(confirm('현재 내용을 복사하여 새로운 견적서로 저장하시겠습니까?')) {
        document.getElementById('docTitle').value += ' (복사본)';
        saveQuote(true);
    }
}

async function deleteSelected() {
    const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (checked.length === 0) return alert('삭제할 항목을 선택해주세요.');
    if (!confirm(`선택한 ${checked.length}개의 견적을 삭제하시겠습니까?`)) return;

    try {
        await authFetch(API_BASE, {
            method: 'DELETE',
            body: JSON.stringify({ ids: checked })
        });
        
        showToast('삭제되었습니다.', 'success');
        document.getElementById('selectAll').checked = false;
        loadQuotes();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ==========================================
// 파이프라인 연동 기능
// ==========================================

// 환율 가져오기 (공통 환율 API 활용)
async function loadLatestExchangeRates() {
    try {
        const btn = document.getElementById('btnLoadRates');
        btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i>';
        btn.disabled = true;
        
        // KNG 환율 API가 있다면 호출 (예시)
        try {
            const curr = document.getElementById('docCurrency').value;
            const data = await authFetch('/api/exchange-rates');
            if(data && data[curr]) {
                let finalRate = (1 / data[curr]);
                document.getElementById('exRateInput').value = finalRate.toFixed(2);
                showToast(`최신 환율(${curr})을 적용했습니다.`, 'success');
                calculateTotals();
            } else if (data && data.USD) {
                let finalRate = (1 / data.USD);
                document.getElementById('exRateInput').value = finalRate.toFixed(2);
                showToast(`선택하신 통화의 환율이 없어 기본 USD 환율을 적용했습니다.`, 'info');
                calculateTotals();
            } else {
                throw new Error('No rate');
            }
        } catch (fetchErr) {
            // 실패 시 프롬프트로 대체 (임시)
            const curr = document.getElementById('docCurrency').value;
            let defRate = '1400';
            if(curr === 'CNY') defRate = '190';
            if(curr === 'EUR') defRate = '1500';
            if(curr === 'JPY') defRate = '9.5';
            
            const rate = prompt(`서버 환율 조회를 실패했습니다. 수동으로 ${curr} 환율을 입력하세요:`, defRate);
            if(rate) {
                document.getElementById('exRateInput').value = rate;
                calculateTotals();
            }
        }
    } catch(e) {
        console.error(e);
        showToast('환율 조회 중 오류가 발생했습니다.', 'error');
    } finally {
        const btn = document.getElementById('btnLoadRates');
        btn.innerHTML = "<i class='bx bx-refresh'></i> 서버 최신환율 가져오기";
        btn.disabled = false;
    }
}

// 인보이스 모달 띄우기
async function openInvoiceModal() {
    document.getElementById('invoiceLoadModal').style.display = 'block';
    const tbody = document.getElementById('invoiceListBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">로딩 중...</td></tr>';
    
    try {
        const invoices = await authFetch('/api/invoice-packing/documents');
        
        tbody.innerHTML = '';
        if(invoices.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">작성된 인보이스가 없습니다.</td></tr>';
            return;
        }
        
        invoices.forEach(inv => {
            const tr = document.createElement('tr');
            const total = inv.items ? inv.items.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
            
            tr.innerHTML = `
                <td><button class="btn-outline btn-small" onclick="loadInvoiceData('${inv.id}')">선택</button></td>
                <td>${inv.invoiceNo}</td>
                <td>${inv.docDate || inv.createdAt?.substring(0,10) || '-'}</td>
                <td>${inv.shipper?.name || inv.shipperName || ''}</td>
                <td>${inv.portOfDischarge || inv.pod || ''}</td>
                <td style="font-weight:600; color:var(--primary);">${formatCurrency(total)}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // 인보이스 원본 데이터 저장을 위해 전역 변수에 임시 저장
        window.tempInvoices = invoices;
        
    } catch(err) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">${err.message}</td></tr>`;
    }
}

window.loadInvoiceData = function(invId) {
    const inv = window.tempInvoices.find(x => x.id === invId);
    if(!inv) return;
    
    if(confirm(`${inv.invoiceNo} 데이터를 견적서로 가져오시겠습니까?\n(현재 작성 중인 품목 내용은 덮어씌워집니다)`)) {
        document.getElementById('docSupplierName').value = inv.shipper?.name || inv.shipperName || '';
        document.getElementById('docPol').value = inv.portOfLoading || inv.pol || '';
        document.getElementById('docPod').value = inv.portOfDischarge || inv.pod || '';
        document.getElementById('docPaymentTerms').value = inv.paymentTerms || '';
        document.getElementById('docIncoterms').value = inv.incoterms || 'FOB';
        
        if (inv.currency) {
            document.getElementById('docCurrency').value = inv.currency;
            updateCurrencyDisplay();
            updateExchangeRateLabel();
        }
        
        if (inv.items && inv.items.length > 0) {
            currentItems = inv.items.map((it, idx) => ({
                id: generateItemId(),
                modelNo: it.description || '', // 품명이 없는 경우 모델명에라도 임시 입력
                description: it.description || '',
                unit: it.unit || 'EA',
                qty: parseFloat(it.qty) || 0,
                unitPrice: parseFloat(it.unitPrice) || 0,
                amount: parseFloat(it.amount) || 0
            }));
            renderItems();
        }
        
        document.getElementById('invoiceLoadModal').style.display = 'none';
        showToast('인보이스 데이터가 로드되었습니다.', 'success');
    }
};

// 인보이스로 내보내기 (localStorage 이용)
function exportToInvoice() {
    if(!currentQuoteId) return alert('먼저 견적서를 저장해주세요.');
    if(!confirm('이 견적서 데이터를 인보이스 시스템으로 복사하여 새로운 인보이스를 만드시겠습니까?')) return;
    
    // 데이터를 localStorage에 임시 저장하고 iframe을 전환하도록 요청
    const transferData = {
        source: 'import-quotation',
        data: {
            shipperName: document.getElementById('docSupplierName').value,
            pol: document.getElementById('docPol').value,
            pod: document.getElementById('docPod').value,
            incoterms: document.getElementById('docIncoterms').value,
            paymentTerms: document.getElementById('docPaymentTerms').value,
            items: currentItems
        }
    };
    
    localStorage.setItem('kng_transfer_data', JSON.stringify(transferData));
    
    showToast('데이터 복사 완료. 인보이스/패킹리스트 메뉴로 이동합니다...', 'success');
    
    setTimeout(() => {
        if(window.parent && window.parent.document.querySelector('a[href*="05_Invoice_PackingList"]')) {
            window.parent.document.querySelector('a[href*="05_Invoice_PackingList"]').click();
        }
    }, 1000);
}

// 포워더 견적으로 내보내기
function exportToForwarder() {
    if(!currentQuoteId) return alert('먼저 견적서를 저장해주세요.');
    if(!confirm('물류비 산출을 위해 이 견적서 데이터를 포워더 견적 시스템으로 넘기시겠습니까?')) return;
    
    const transferData = {
        source: 'import-quotation',
        data: {
            title: document.getElementById('docTitle').value + ' 물류비 산출 건',
            pol: document.getElementById('docPol').value,
            pod: document.getElementById('docPod').value,
            incoterms: document.getElementById('docIncoterms').value,
            items: currentItems
        }
    };
    
    localStorage.setItem('kng_transfer_data', JSON.stringify(transferData));
    
    showToast('데이터 복사 완료. 포워더 견적목록 메뉴로 이동합니다...', 'success');
    
    setTimeout(() => {
        if(window.parent && window.parent.document.querySelector('a[href*="06_Forwarder_Quotation"]')) {
            window.parent.document.querySelector('a[href*="06_Forwarder_Quotation"]').click();
        }
    }, 1000);
}

// ==========================================
// 인쇄 및 엑셀
// ==========================================
function printQuote() {
    const printMode = document.querySelector('input[name="printMode"]:checked').value;
    const curr = document.getElementById('docCurrency').value;
    const exRate = parseFloat(document.getElementById('exRateInput').value) || 1;
    const printTitle = document.getElementById('printTitle').value || 'IMPORT QUOTATION';
    
    // HTML 조립
    let html = `
        <div class="print-doc">
            <h1>${printTitle}</h1>
            
            <div class="print-header-grid">
                <div class="print-company-info">
                    <h3>SUPPLIER: ${document.getElementById('docSupplierName').value || 'Supplier'}</h3>
                    <div style="font-size: 13px; color: #475569; margin-bottom: 4px;">
                        <strong>ATTN:</strong> ${document.getElementById('docSupplierContact').value || 'Sales Manager'}
                    </div>
                </div>
                
                <div class="print-meta-info">
                    <table>
                        <tr><th>DATE</th><td>${document.getElementById('docDate').value}</td></tr>
                        <tr><th>QUOTE NO</th><td>${currentQuoteId || 'DRAFT'}</td></tr>
                        <tr><th>PROJECT</th><td>${document.getElementById('docTitle').value}</td></tr>
                        <tr><th>VALIDITY</th><td>${document.getElementById('docValidity').value || '-'}</td></tr>
                        <tr><th>INCOTERMS</th><td>${document.getElementById('docIncoterms').value || '-'}</td></tr>
                        <tr><th>PAYMENT</th><td>${document.getElementById('docPaymentTerms').value || '-'}</td></tr>
                    </table>
                </div>
            </div>
            
            <table class="print-items-table">
                <thead>
                    <tr>
                        <th style="width:5%;">NO.</th>
                        <th style="width:25%;">ITEM / DESCRIPTION</th>
                        <th style="width:25%;">SPECIFICATION</th>
                        <th style="width:7%;">QTY</th>
                        <th style="width:8%;">UNIT</th>
                        <th style="width:15%;">UNIT PRICE (${curr})</th>
                        <th style="width:15%;">AMOUNT (${curr})</th>
                        ${printMode === 'dual' ? `<th style="width:15%;">AMOUNT (KRW)</th>` : ''}
                    </tr>
                </thead>
                <tbody>
    `;
    
    let totalForeign = 0;
    
    currentItems.forEach((item, idx) => {
        totalForeign += item.amount;
        html += `
            <tr>
                <td>${idx + 1}</td>
                <td class="text-left">${item.modelNo}</td>
                <td class="text-left">${item.description}</td>
                <td>${item.qty}</td>
                <td>${item.unit}</td>
                <td class="text-right">${formatCurrency(item.unitPrice, curr)}</td>
                <td class="text-right">${formatCurrency(item.amount, curr)}</td>
                ${printMode === 'dual' ? `<td class="text-right">${formatCurrency(item.amount * exRate, 'KRW')}</td>` : ''}
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
            
            <div class="print-summary-container">
                <div class="print-summary-box">
                    <div class="print-summary-row">
                        <span>SUBTOTAL</span>
                        <span>${formatCurrency(totalForeign, curr)}</span>
                    </div>
                    
                    <div class="print-summary-total">
                        <span>TOTAL AMOUNT</span>
                        <span>${formatCurrency(totalForeign, curr)} ${curr}</span>
                    </div>
                    
                    ${printMode === 'dual' ? `
                    <div class="print-summary-row" style="margin-top: 12px; font-size: 11px;">
                        <span>EX. RATE</span>
                        <span>${formatCurrency(exRate, 'KRW')} ₩ / 1 ${curr}</span>
                    </div>
                    <div class="print-summary-total-krw">
                        <span>TOTAL (KRW)</span>
                        <span>${formatCurrency(totalForeign * exRate, 'KRW')} ₩</span>
                    </div>
                    ` : ''}
                </div>
            </div>
            
            <div class="print-remarks">
                <div class="print-remarks-title">REMARKS & CONDITIONS</div>
                <div>${document.getElementById('docRemarks').value.replace(/\n/g, '<br>') || '-'}</div>
            </div>
            
            <div class="print-footer">
                <div class="print-signature">
                    <div class="print-signature-line"></div>
                    <div class="print-signature-label">AUTHORIZED SIGNATURE</div>
                </div>
            </div>
        </div>
    `;
    
    const printArea = document.getElementById('printArea');
    printArea.innerHTML = html;
    window.print();
}

function exportExcel() {
    // TODO: SheetJS Excel Export
    showToast('엑셀 내보내기 기능은 준비 중입니다.', 'info');
}
