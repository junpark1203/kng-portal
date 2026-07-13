// Contract Management v2 — Full Redesign
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';
let allContracts = [], allPartners = [], currentContractId = null;

// ── Auth ──
async function getToken() {
    try {
        if (window.parent && typeof window.parent.getAuthToken === 'function') {
            let token = await window.parent.getAuthToken(), retries = 0;
            while (!token && retries < 10) { await new Promise(r => setTimeout(r, 500)); token = await window.parent.getAuthToken(); retries++; }
            return token || '';
        }
    } catch(e) {}
    return '';
}
async function authFetch(url, opts = {}) {
    const token = await getToken();
    if (!(opts.body instanceof FormData)) opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    if (token) opts.headers = { ...opts.headers, 'Authorization': 'Bearer ' + token };
    const res = await fetch(API_BASE + url, opts);
    if (!res.ok) { let msg = res.statusText; try { const e = await res.json(); msg = e.error || msg; } catch(e){} throw new Error(msg); }
    return res.json();
}

// ── Helpers ──
function showToast(msg, type='success') {
    const c = document.getElementById('toastContainer'); if (!c) return;
    const t = document.createElement('div');
    t.innerHTML = `<i class="bx ${type==='success'?'bx-check-circle':'bx-error-circle'}"></i> ${msg}`;
    Object.assign(t.style, { padding:'10px 16px', background: type==='success'?'#22c55e':'#ef4444', color:'#fff', borderRadius:'8px', marginBottom:'6px', fontSize:'12px', fontWeight:'600', display:'flex', alignItems:'center', gap:'6px', animation:'fadeIn 0.3s' });
    c.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3000);
}
function fmtDate(iso) { if(!iso) return '-'; try { return new Date(iso).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); } catch(e){ return iso; } }
function fmtDateShort(iso) { if(!iso) return '-'; try { return new Date(iso).toLocaleDateString('ko-KR'); } catch(e){ return iso; } }
function fmtBytes(b,d=1) { if(!b) return '0B'; const k=1024,s=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(k)); return parseFloat((b/Math.pow(k,i)).toFixed(d))+s[i]; }
function fmtNum(n) { return Number(n||0).toLocaleString('ko-KR'); }
function getStatusClass(s) { return ({초안:'s-draft',검토중:'s-review',체결:'s-signed',이행중:'s-active',만료:'s-expired',해지:'s-terminated'})[s]||'s-draft'; }
function getTypeClass(t) { if(t==='구매계약') return 't-buy'; if(t==='공급/판매계약') return 't-sell'; if(t==='비밀유지(NDA)') return 't-nda'; if(t==='용역/서비스') return 't-service'; return 't-other'; }
function isExpiringSoon(d) { if(!d) return false; const diff=(new Date(d)-new Date())/(1000*60*60*24); return diff>=0 && diff<=30; }

// ── Load Data ──
async function loadPartners() { try { allPartners = await authFetch('/api/invoice-packing/partners'); } catch(e){} }
async function loadContracts() {
    try { allContracts = await authFetch('/api/contracts'); updateTotalCount(); renderTable(); }
    catch(e) { showToast('계약 목록 로드 실패','error'); console.error(e); }
}

// ── Total Count ──
function updateTotalCount() {
    const total = allContracts.length;
    document.getElementById('totalCount').textContent = total + '건';
}

// ── Table ──
function renderTable() {
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const sf = document.querySelector('.ct-chip.active')?.dataset.status || 'all';
    const tf = document.getElementById('typeFilter').value;
    let data = allContracts;
    if (q) data = data.filter(d => [d.contractNo,d.title,d.buyer,d.seller].some(v => (v||'').toLowerCase().includes(q)));
    if (sf !== 'all') data = data.filter(d => d.status === sf);
    if (tf !== 'all') data = data.filter(d => d.type === tf);

    const tbody = document.getElementById('contractListBody');
    if (!data.length) { tbody.innerHTML = `<tr><td colspan="11" class="ct-empty-state"><i class='bx bx-file-blank'></i>검색 결과가 없습니다.</td></tr>`; return; }

    tbody.innerHTML = data.map(d => {
        const cur = d.currency || 'KRW';
        const sym = {KRW:'₩',USD:'$',CNY:'¥',EUR:'€',JPY:'¥'}[cur]||'';
        const expSoon = isExpiringSoon(d.expiryDate) && d.status!=='만료' && d.status!=='해지';
        
        let amountText = '-';
        if (d.multiTotals && Object.keys(d.multiTotals).length > 0) {
            const parts = [];
            for (const [c, tot] of Object.entries(d.multiTotals)) {
                if (tot > 0) {
                    const s = {KRW:'₩',USD:'$',CNY:'¥',EUR:'€',JPY:'¥'}[c]||'';
                    parts.push(`${s}${fmtNum(tot)}`);
                }
            }
            if (parts.length > 0) {
                amountText = parts.join('<br><span style="font-size:10px;color:var(--gray-400);">+ </span>');
            } else {
                amountText = `<span style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:11px;color:var(--gray-600);">단가 계약</span>`;
            }
        } else {
            const amt = d.itemsTotal || d.amount || 0;
            if (amt > 0) {
                amountText = `${sym}${fmtNum(amt)}`;
            } else {
                amountText = `<span style="background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:11px;color:var(--gray-600);">단가 계약</span>`;
            }
        }
        if (d.incoterms) amountText += `<br><span style="font-size:11px;color:var(--gray-500);">${d.incoterms}</span>`;
        
        const firstItem = d.firstItemName ? `<br><span style="font-size:11px;color:var(--gray-500);">${d.firstItemName} ${d.itemCount > 1 ? `외 ${d.itemCount - 1}건` : ''}</span>` : '';
        
        let counterparty = '';
        let roleBadge = '';
        if (d.type === '구매계약') {
            counterparty = d.seller || '-';
            roleBadge = `<br><span style="font-size:10px;background:#f3f4f6;padding:2px 4px;border-radius:4px;">Seller</span>`;
        } else if (d.type === '판매계약') {
            counterparty = d.buyer || '-';
            roleBadge = `<br><span style="font-size:10px;background:#f3f4f6;padding:2px 4px;border-radius:4px;">Buyer</span>`;
        } else {
            counterparty = (d.buyer && d.buyer !== 'K&G CO., LTD.' ? d.buyer : d.seller) || '-';
            roleBadge = '';
        }

        return `<tr data-id="${d.id}" class="${expSoon?'expiring-soon':''}" onclick="editContract('${d.id}')">
            <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
            <td class="ct-no">${d.contractNo||'-'}</td>
            <td class="ct-title" title="${d.title||''}">${d.title||'-'}${firstItem}</td>
            <td style="line-height:1.4;"><strong>${counterparty}</strong>${roleBadge}</td>
            <td><span class="ct-type ${getTypeClass(d.type)}">${d.type||'-'}</span></td>
            <td class="ct-date">${fmtDateShort(d.effectiveDate)}</td>
            <td class="ct-date">${fmtDateShort(d.expiryDate)}</td>
            <td class="ct-amount" style="line-height:1.4;">${amountText}</td>
            <td class="col-actions" onclick="event.stopPropagation()">
                <div class="ct-row-actions">
                    <button title="수정" onclick="editContract('${d.id}')"><i class='bx bx-edit-alt'></i></button>
                    <button class="btn-del" title="삭제" onclick="deleteContract('${d.id}')"><i class='bx bx-trash'></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Filters ──
document.getElementById('statusFilters').addEventListener('click', e => {
    const chip = e.target.closest('.ct-chip'); if (!chip) return;
    document.querySelectorAll('.ct-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    renderTable();
});
document.getElementById('typeFilter').addEventListener('change', renderTable);
document.getElementById('searchInput').addEventListener('input', renderTable);
document.getElementById('checkAll').addEventListener('change', e => {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
});

// ── Modal Open/Close ──
function openModal() { document.getElementById('contractModal').classList.add('active'); }
function closeModal() { document.getElementById('contractModal').classList.remove('active'); currentContractId = null; }
document.getElementById('closeModalBtn').addEventListener('click', closeModal);
document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

// ── New Contract ──
document.getElementById('btnNewContract').addEventListener('click', async () => {
    document.getElementById('contractForm').reset();
    document.getElementById('editId').value = '';
    document.getElementById('inpBuyerRole').value = 'Party A';
    document.getElementById('inpSellerRole').value = 'Party B';
    document.getElementById('inpAutoRenewal').value = '0';
    const tog = document.getElementById('toggleAutoRenewal');
    tog.classList.remove('on');
    document.getElementById('autoRenewalLabel').textContent = '미적용';
    document.getElementById('modalTitle').textContent = '신규 계약 등록';
    document.getElementById('timestampInfo').style.display = 'none';
    document.getElementById('itemLines').innerHTML = '';
    document.getElementById('fileList').innerHTML = '';
    document.getElementById('fileSaveNotice').style.display = 'block';
    currentContractId = null;
    addItemLine(); // Start with one empty line
    updateGrandTotal();
    // Get next contract number
    document.getElementById('inpContractNo').value = '채번중...';
    try { const r = await authFetch('/api/contracts/next-no'); document.getElementById('inpContractNo').value = r.nextNo; }
    catch(e) { document.getElementById('inpContractNo').value = ''; showToast('계약번호 채번 실패','error'); }
    openModal();
});

// ── Edit Contract ──
window.editContract = async function(id) {
    try {
        const d = await authFetch(`/api/contracts/${id}`);
        currentContractId = id;
        document.getElementById('editId').value = d.id;
        document.getElementById('inpContractNo').value = d.contractNo || '';
        document.getElementById('inpTitle').value = d.title || '';
        document.getElementById('inpType').value = d.type || '기타';
        document.getElementById('inpStatus').value = d.status || '초안';
        document.getElementById('inpBuyerRole').value = d.buyerRole || 'Party A';
        document.getElementById('inpBuyer').value = d.buyer || '';
        document.getElementById('inpSellerRole').value = d.sellerRole || 'Party B';
        document.getElementById('inpSeller').value = d.seller || '';
        document.getElementById('inpPaymentTerms').value = d.paymentTerms || '';
        document.getElementById('inpIncoterms').value = d.incoterms || '';
        document.getElementById('inpEffectiveDate').value = d.effectiveDate || '';
        document.getElementById('inpExpiryDate').value = d.expiryDate || '';
        document.getElementById('inpRemarks').value = d.remarks || '';
        // Auto renewal
        const ar = d.autoRenewal ? true : false;
        document.getElementById('inpAutoRenewal').value = ar ? '1' : '0';
        const tog = document.getElementById('toggleAutoRenewal');
        tog.classList.toggle('on', ar);
        document.getElementById('autoRenewalLabel').textContent = ar ? '적용' : '미적용';
        // Timestamps
        document.getElementById('lblCreatedAt').textContent = fmtDate(d.createdAt);
        document.getElementById('lblUpdatedAt').textContent = fmtDate(d.updatedAt);
        document.getElementById('timestampInfo').style.display = 'block';
        // Items
        document.getElementById('itemLines').innerHTML = '';
        if (d.items && d.items.length > 0) {
            d.items.forEach(it => addItemLine(it));
        } else { addItemLine(); }
        updateGrandTotal();
        // Files
        document.getElementById('fileSaveNotice').style.display = 'none';
        renderFileList(d.files || []);
        document.getElementById('modalTitle').textContent = '계약 정보 수정';
        openModal();
    } catch(e) { showToast('계약 로드 실패: '+e.message, 'error'); }
};

// ── Save Contract ──
document.getElementById('saveContractBtn').addEventListener('click', async () => {
    const form = document.getElementById('contractForm');
    if (!form.reportValidity()) return;
    const id = document.getElementById('editId').value;
    const isEdit = !!id;
    const items = collectItems();
    const payload = {
        contractNo: document.getElementById('inpContractNo').value.trim(),
        title: document.getElementById('inpTitle').value.trim(),
        type: document.getElementById('inpType').value,
        status: document.getElementById('inpStatus').value,
        buyerRole: document.getElementById('inpBuyerRole').value.trim() || 'Party A',
        buyer: document.getElementById('inpBuyer').value.trim(),
        sellerRole: document.getElementById('inpSellerRole').value.trim() || 'Party B',
        seller: document.getElementById('inpSeller').value.trim(),
        paymentTerms: document.getElementById('inpPaymentTerms').value.trim(),
        incoterms: document.getElementById('inpIncoterms').value,
        effectiveDate: document.getElementById('inpEffectiveDate').value,
        expiryDate: document.getElementById('inpExpiryDate').value,
        autoRenewal: document.getElementById('inpAutoRenewal').value === '1',
        remarks: document.getElementById('inpRemarks').value.trim(),
        items: items
    };
    try {
        const url = isEdit ? `/api/contracts/${id}` : '/api/contracts';
        const method = isEdit ? 'PUT' : 'POST';
        const result = await authFetch(url, { method, body: JSON.stringify(payload) });
        showToast(isEdit ? '계약 정보가 수정되었습니다.' : '계약이 등록되었습니다.');
        if (!isEdit && result.id) {
            // After creation, switch to edit mode so file upload is enabled
            currentContractId = result.id;
            document.getElementById('editId').value = result.id;
            document.getElementById('fileSaveNotice').style.display = 'none';
        }
        closeModal();
        loadContracts();
    } catch(err) { showToast('저장 실패: '+err.message, 'error'); }
});

// ── Delete ──
window.deleteContract = async function(id) {
    if (!confirm('이 계약 건과 모든 첨부파일을 삭제하시겠습니까?')) return;
    try { await authFetch(`/api/contracts/${id}`, {method:'DELETE'}); showToast('삭제 완료'); loadContracts(); }
    catch(e) { showToast('삭제 실패: '+e.message,'error'); }
};
document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (!ids.length) return showToast('삭제할 항목을 선택하세요.','error');
    if (!confirm(`${ids.length}건을 삭제하시겠습니까?`)) return;
    try { await Promise.all(ids.map(id => authFetch(`/api/contracts/${id}`,{method:'DELETE'}))); showToast('삭제 완료'); document.getElementById('selectAll').checked=false; loadContracts(); }
    catch(e) { showToast('일부 삭제 실패','error'); loadContracts(); }
});

// ── Line Items ──
function addItemLine(data={}) {
    const container = document.getElementById('itemLines');
    const div = document.createElement('div');
    div.className = 'ct-item-line';
    
    let prices = [];
    try { prices = typeof data.prices === 'string' ? JSON.parse(data.prices) : (data.prices || []); } catch(e){}
    if (!prices.length) {
        prices = [{ currency: data.currency || 'KRW', price: data.unitPrice, amount: data.amount }];
    }
    
    let curHtml = '', priceHtml = '', amtHtml = '';
    prices.forEach((p, i) => {
        const cur = p.currency || 'KRW';
        const sym = {KRW:'₩',USD:'$',CNY:'¥',EUR:'€',JPY:'¥'}[cur]||'';
        
        curHtml += `<select class="li-currency" onchange="calcLineAmount(this)">
            <option value="KRW" ${cur==='KRW'?'selected':''}>KRW</option>
            <option value="USD" ${cur==='USD'?'selected':''}>USD</option>
            <option value="CNY" ${cur==='CNY'?'selected':''}>CNY</option>
            <option value="EUR" ${cur==='EUR'?'selected':''}>EUR</option>
            <option value="JPY" ${cur==='JPY'?'selected':''}>JPY</option>
        </select>`;
        priceHtml += `<input type="number" class="li-price" value="${p.price||''}" placeholder="0" step="any" oninput="calcLineAmount(this)" style="text-align:right;">`;
        amtHtml += `<div style="display:flex; gap:4px; align-items:center;" class="li-amt-wrap">
            <input type="text" class="li-amount line-amount" value="${sym}${fmtNum(p.amount||0)}" readonly style="text-align:right;">
            ${i === 0 ? `<button type="button" class="btn-price-action" onclick="addPriceRow(this)" title="단가 추가" style="width:28px;height:30px;flex-shrink:0;padding:0;"><i class='bx bx-plus'></i></button>` : `<button type="button" class="btn-price-remove" onclick="removePriceRow(this)" title="단가 삭제" style="width:28px;height:30px;flex-shrink:0;padding:0;"><i class='bx bx-minus'></i></button>`}
        </div>`;
    });
    
    div.innerHTML = `
        <div class="li-cell-stack"><input type="text" class="li-name" value="${data.itemName||''}" placeholder="품명"></div>
        <div class="li-cell-stack"><input type="text" class="li-spec" value="${data.specification||''}" placeholder="규격/사양"></div>
        <div class="li-cell-stack"><input type="number" class="li-qty" value="${data.quantity||''}" placeholder="0" step="any" oninput="calcLineAmountAll(this)" style="text-align:right;"></div>
        <div class="li-cell-stack"><input type="text" class="li-unit" value="${data.unit||'EA'}" placeholder="EA" list="unitList" style="text-align:center;"></div>
        <div class="li-cell-stack li-currencies">${curHtml}</div>
        <div class="li-cell-stack li-prices">${priceHtml}</div>
        <div class="li-cell-stack li-amounts">${amtHtml}</div>
        <div class="li-cell-stack"><input type="text" class="li-remarks" value="${data.remarks||''}" placeholder="비고 입력"></div>
        <div class="li-cell-stack li-actions">
            <button type="button" class="ct-item-remove" onclick="removeItemLine(this)"><i class='bx bx-x'></i></button>
        </div>
    `;
    container.appendChild(div);
}

window.addPriceRow = function(btn) {
    const line = btn.closest('.ct-item-line');
    const curStack = line.querySelector('.li-currencies');
    const priceStack = line.querySelector('.li-prices');
    const amtStack = line.querySelector('.li-amounts');
    
    curStack.insertAdjacentHTML('beforeend', `<select class="li-currency" onchange="calcLineAmount(this)">
        <option value="KRW">KRW</option><option value="USD">USD</option><option value="CNY">CNY</option><option value="EUR">EUR</option><option value="JPY">JPY</option>
    </select>`);
    priceStack.insertAdjacentHTML('beforeend', `<input type="number" class="li-price" placeholder="0" step="any" oninput="calcLineAmount(this)" style="text-align:right;">`);
    amtStack.insertAdjacentHTML('beforeend', `<div style="display:flex; gap:4px; align-items:center;" class="li-amt-wrap">
        <input type="text" class="li-amount line-amount" value="₩0" readonly style="text-align:right;">
        <button type="button" class="btn-price-remove" onclick="removePriceRow(this)" title="단가 삭제" style="width:28px;height:30px;flex-shrink:0;padding:0;"><i class='bx bx-minus'></i></button>
    </div>`);
    updateGrandTotal();
};

window.removePriceRow = function(btn) {
    const wrap = btn.closest('.li-amt-wrap');
    const amtStack = wrap.parentElement;
    const line = amtStack.closest('.ct-item-line');
    const index = Array.from(amtStack.children).indexOf(wrap);
    
    line.querySelector('.li-currencies').children[index].remove();
    line.querySelector('.li-prices').children[index].remove();
    wrap.remove();
    
    updateGrandTotal();
};

window.removeItemLine = function(btn) {
    const line = btn.closest('.ct-item-line');
    if (document.querySelectorAll('.ct-item-line').length <= 1) { 
        line.querySelectorAll('input:not(.line-amount)').forEach(i => i.value = '');
        line.querySelector('.li-unit').value = 'EA';
        line.querySelector('.line-amount').value = '0';
    } else { line.remove(); }
    updateGrandTotal();
};
window.calcLineAmountAll = function(qtyEl) {
    const line = qtyEl.closest('.ct-item-line');
    const prices = line.querySelectorAll('.li-price');
    prices.forEach(p => window.calcLineAmount(p));
};
window.calcLineAmount = function(el) {
    const line = el.closest('.ct-item-line');
    const qty = parseFloat(line.querySelector('.li-qty').value) || 0;
    
    // find index of el in its stack
    let index = 0;
    if (el.classList.contains('li-currency')) index = Array.from(line.querySelector('.li-currencies').children).indexOf(el);
    if (el.classList.contains('li-price')) index = Array.from(line.querySelector('.li-prices').children).indexOf(el);
    
    const curSelect = line.querySelector('.li-currencies').children[index];
    const priceInput = line.querySelector('.li-prices').children[index];
    const amtWrap = line.querySelector('.li-amounts').children[index];
    
    const price = parseFloat(priceInput.value) || 0;
    const cur = curSelect.value || 'KRW';
    const sym = {KRW:'₩',USD:'$',CNY:'¥',EUR:'€',JPY:'¥'}[cur]||'';
    amtWrap.querySelector('.li-amount').value = sym + fmtNum(qty * price);
    updateGrandTotal();
};
function updateGrandTotal() {
    const totals = {};
    document.querySelectorAll('.ct-item-line').forEach(line => {
        const qty = parseFloat(line.querySelector('.li-qty').value) || 0;
        const prices = line.querySelectorAll('.li-price');
        const currencies = line.querySelectorAll('.li-currency');
        
        prices.forEach((pInput, i) => {
            const price = parseFloat(pInput.value) || 0;
            const cur = currencies[i] ? currencies[i].value : 'KRW';
            if (!totals[cur]) totals[cur] = 0;
            totals[cur] += (qty * price);
        });
    });
    
    const parts = [];
    for (const [cur, total] of Object.entries(totals)) {
        if (total > 0) {
            const sym = {KRW:'₩',USD:'$',CNY:'¥',EUR:'€',JPY:'¥'}[cur]||'';
            parts.push(`${sym}${fmtNum(total)}`);
        }
    }
    
    document.getElementById('grandTotalValue').textContent = parts.length > 0 ? parts.join(' / ') : '0';
}
function collectItems() {
    const items = [];
    document.querySelectorAll('.ct-item-line').forEach((line, idx) => {
        const name = line.querySelector('.li-name').value.trim();
        const qty = parseFloat(line.querySelector('.li-qty').value) || 0;
        
        const prices = [];
        const pInputs = line.querySelectorAll('.li-price');
        const cSelects = line.querySelectorAll('.li-currency');
        pInputs.forEach((p, i) => {
            const price = parseFloat(p.value) || 0;
            if (price > 0 || pInputs.length === 1) {
                prices.push({
                    currency: cSelects[i].value,
                    price: price,
                    amount: qty * price
                });
            }
        });
        
        if (name || qty || prices.length > 0) {
            items.push({
                itemName: name,
                specification: line.querySelector('.li-spec').value.trim(),
                quantity: qty,
                unit: line.querySelector('.li-unit').value.trim() || 'EA',
                prices: prices,
                hsCode: '', remarks: line.querySelector('.li-remarks').value.trim(), sortOrder: idx
            });
        }
    });
    return items;
}
document.getElementById('addItemBtn').addEventListener('click', () => addItemLine());

// ── Auto Renewal Toggle ──
window.toggleAutoRenewal = function() {
    const tog = document.getElementById('toggleAutoRenewal');
    const inp = document.getElementById('inpAutoRenewal');
    const isOn = tog.classList.toggle('on');
    inp.value = isOn ? '1' : '0';
    document.getElementById('autoRenewalLabel').textContent = isOn ? '적용' : '미적용';
};

// ── File Upload ──
const fileInput = document.getElementById('fileInput');
const fileDescInput = document.getElementById('fileDescInput');
const btnUploadFile = document.getElementById('btnUploadFile');

btnUploadFile.addEventListener('click', () => {
    if (!currentContractId) { showToast('먼저 계약 정보를 저장하세요.','error'); return; }
    if (!fileInput.files.length) { showToast('업로드할 파일을 선택하세요.','error'); return; }
    const desc = fileDescInput.value.trim();
    if (!desc) { showToast('파일 설명을 입력하세요.','error'); return; }
    handleFileUpload(fileInput.files[0], desc);
});

async function handleFileUpload(file, desc) {
    if (!currentContractId) return;
    if (file.size > 50*1024*1024) return showToast('50MB 이하만 가능','error');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionLabel', desc);
    
    btnUploadFile.disabled = true;
    btnUploadFile.innerHTML = "<i class='bx bx-loader bx-spin'></i> 업로드 중...";
    try {
        const token = await getToken();
        const headers = {}; if (token) headers['Authorization'] = 'Bearer '+token;
        const res = await fetch(`${API_BASE}/api/contracts/${currentContractId}/files`, { method:'POST', headers, body:formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error||'업로드 실패');
        showToast('파일 업로드 완료');
        fileInput.value = '';
        fileDescInput.value = '';
        
        // Reload files
        const detail = await authFetch(`/api/contracts/${currentContractId}`);
        renderFileList(detail.files || []);
    } catch(e) { showToast(e.message,'error'); }
    finally { 
        btnUploadFile.disabled = false; 
        btnUploadFile.innerHTML = "<i class='bx bx-upload'></i> 업로드";
    }
}

function renderFileList(files) {
    const list = document.getElementById('fileList');
    if (!files.length) { list.innerHTML = '<div style="text-align:center;padding:10px;color:var(--gray-400);font-size:11px;">첨부 파일 없음</div>'; return; }
    list.innerHTML = files.map(f => {
        let ic='bx-file',cls='other';
        if(f.fileType==='.pdf'){ic='bxs-file-pdf';cls='pdf';}
        else if(f.fileType&&f.fileType.includes('doc')){ic='bxs-file-doc';cls='doc';}
        else if(f.fileType&&f.fileType.includes('xls')){ic='bx-spreadsheet';cls='xls';}
        
        let previewBtn = '';
        if (f.fileType === '.pdf') {
            previewBtn = `<button type="button" style="background:transparent; border:1px solid var(--primary); color:var(--primary); padding:3px 8px; border-radius:4px; font-size:11px; cursor:pointer; margin-right:4px;" onmouseover="this.style.background='rgba(44,62,143,0.1)'" onmouseout="this.style.background='transparent'" onclick="previewFile('${f.filePath}','${f.fileType}','${f.fileName}')"><i class='bx bx-search'></i> 미리보기</button>`;
        }

        return `<div class="ct-file-card">
            <div class="ct-file-icon ${cls}"><i class='bx ${ic}'></i></div>
            <div class="ct-file-info" style="display:flex; flex-direction:column; gap:2px;">
                <div class="ct-file-name" onclick="downloadFile('${f.filePath}','${f.fileName}')" title="${f.fileName}" style="cursor:pointer; color:var(--gray-800); font-weight:600;">${f.fileName}</div>
                <div style="font-size:11.5px; color:var(--gray-600);">${f.versionLabel||'설명 없음'}</div>
                <div class="ct-file-meta" style="margin-top:2px;">
                    <span>${fmtBytes(f.fileSize)}</span>
                    <span>${fmtDate(f.uploadedAt)}</span>
                </div>
            </div>
            <div class="ct-file-actions" style="display:flex; align-items:center;">
                ${previewBtn}
                <button type="button" title="다운로드" onclick="downloadFile('${f.filePath}','${f.fileName}')"><i class='bx bx-download'></i></button>
                <button type="button" title="삭제" onclick="deleteFile('${f.id}')"><i class='bx bx-trash'></i></button>
            </div>
        </div>`;
    }).join('');
}

window.deleteFile = async function(fileId) {
    if (!confirm('파일을 삭제하시겠습니까?')) return;
    try { await authFetch(`/api/contracts/${currentContractId}/files/${fileId}`,{method:'DELETE'}); showToast('파일 삭제됨');
        const d = await authFetch(`/api/contracts/${currentContractId}`); renderFileList(d.files||[]);
    } catch(e) { showToast('삭제 실패','error'); }
};
window.downloadFile = function(fp, fn) {
    const a = document.createElement('a'); a.href=`${API_BASE}/api/contracts/uploads/${encodeURIComponent(fp)}`; a.download=fn; a.target='_blank'; document.body.appendChild(a); a.click(); a.remove();
};
window.previewFile = function(fp, ft, fn) {
    const overlay = document.getElementById('previewOverlay');
    const container = document.getElementById('previewContainer');
    const dlBtn = document.getElementById('previewDownloadBtn');
    dlBtn.onclick = e => { e.preventDefault(); downloadFile(fp,fn); };
    const url = `${API_BASE}/api/contracts/uploads/${encodeURIComponent(fp)}?t=${Date.now()}`;
    if (ft==='.pdf') {
        container.innerHTML = `<iframe src="${url}#toolbar=0"></iframe>`;
    } else {
        container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><div style="text-align:center;"><i class='bx bx-file' style="font-size:64px;color:var(--gray-400);"></i><h3 style="margin:15px 0 5px;">${fn}</h3><p style="font-size:13px;">미리보기를 지원하지 않습니다.</p><button class="btn-primary" style="margin-top:15px;" onclick="downloadFile('${fp}','${fn}')"><i class='bx bx-download'></i> 다운로드</button></div></div>`;
    }
    overlay.classList.add('active');
};
document.getElementById('closePreviewBtn').addEventListener('click', () => document.getElementById('previewOverlay').classList.remove('active'));

// ── Partner Picker ──
let pickerTarget = null;
window.openPartnerPicker = function(target) {
    pickerTarget = target;
    const list = document.getElementById('partnerPickerList');
    if (!allPartners.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);">거래처 없음</div>'; }
    else {
        list.innerHTML = allPartners.map(p => `<div class="ct-partner-item" onclick="selectPartner('${(p.companyName||p.name).replace(/'/g,"\\'")}')">
            <div class="ct-partner-name">${p.companyName||p.name}</div>
            <div class="ct-partner-addr">${p.address||''}</div>
        </div>`).join('');
    }
    document.getElementById('partnerPickerModal').classList.add('active');
};
window.closePartnerPicker = function() { document.getElementById('partnerPickerModal').classList.remove('active'); };
window.selectPartner = function(name) {
    if (pickerTarget==='buyer') document.getElementById('inpBuyer').value = name;
    else document.getElementById('inpSeller').value = name;
    closePartnerPicker();
};

// ── Init ──
window.addEventListener('DOMContentLoaded', () => { loadPartners(); loadContracts(); });
