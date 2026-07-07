// Contract Management JS

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';

let allContracts = [];
let allPartners = [];
let currentContract = null;

// DOM Elements
const els = {
    // List View
    contractListBody: document.getElementById('contractListBody'),
    searchInput: document.getElementById('searchInput'),
    btnNewContract: document.getElementById('btnNewContract'),
    btnDeleteSelected: document.getElementById('btnDeleteSelected'),
    selectAll: document.getElementById('selectAll'),
    
    // Contract Form Modal
    contractModal: document.getElementById('contractModal'),
    modalTitle: document.getElementById('modalTitle'),
    contractForm: document.getElementById('contractForm'),
    closeContractModalBtn: document.getElementById('closeContractModalBtn'),
    cancelContractBtn: document.getElementById('cancelContractBtn'),
    editId: document.getElementById('editId'),
    
    // Form Inputs
    inpContractNo: document.getElementById('inpContractNo'),
    inpTitle: document.getElementById('inpTitle'),
    inpBuyer: document.getElementById('inpBuyer'),
    inpSeller: document.getElementById('inpSeller'),
    inpType: document.getElementById('inpType'),
    inpCurrency: document.getElementById('inpCurrency'),
    inpAmount: document.getElementById('inpAmount'),
    inpEffectiveDate: document.getElementById('inpEffectiveDate'),
    inpPaymentTerms: document.getElementById('inpPaymentTerms'),
    inpPic: document.getElementById('inpPic'),
    inpRemarks: document.getElementById('inpRemarks'),
    
    // Form Timestamps
    timestampInfo: document.getElementById('timestampInfo'),
    lblCreatedAt: document.getElementById('lblCreatedAt'),
    lblUpdatedAt: document.getElementById('lblUpdatedAt'),
    
    // Autocomplete
    acBuyerList: document.getElementById('acBuyerList'),
    acSellerList: document.getElementById('acSellerList'),
    
    // File Manager Modal
    fileModal: document.getElementById('fileModal'),
    closeFileModalBtn: document.getElementById('closeFileModalBtn'),
    fmContractNo: document.getElementById('fmContractNo'),
    fmFileCount: document.getElementById('fmFileCount'),
    fileList: document.getElementById('fileList'),
    
    // Upload Zone
    uploadZone: document.getElementById('uploadZone'),
    fileInput: document.getElementById('fileInput'),
    fileVersionLabel: document.getElementById('fileVersionLabel'),
    
    // Preview
    previewContainer: document.getElementById('previewContainer'),
    previewDownloadBtn: document.getElementById('previewDownloadBtn')
};

// ── Auth & API ──
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
    // Only set Content-Type to JSON if it's not FormData
    if (!(opts.body instanceof FormData)) {
        opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    }
    if (token) {
        opts.headers = { ...opts.headers, 'Authorization': 'Bearer ' + token };
    }
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

function getBadgeClass(type) {
    if (type === '구매계약') return 'type-buy';
    if (type === '공급/판매계약') return 'type-sell';
    if (type === '비밀유지(NDA)') return 'type-nda';
    return 'type-other';
}

function formatDateToKST(isoString) {
    if (!isoString) return '-';
    // If it's already KST format string like "2026-07-07T18:00:00+09:00", just format it visually
    try {
        const d = new Date(isoString);
        return d.toLocaleString('ko-KR', { 
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit' 
        });
    } catch(e) {
        return isoString;
    }
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ── Load Data ──
async function loadPartners() {
    try {
        allPartners = await authFetch('/api/invoice-packing/partners');
    } catch (e) {
        console.warn('Failed to load partners for autocomplete:', e);
    }
}

async function loadContracts() {
    try {
        allContracts = await authFetch('/api/contracts');
        renderContractTable();
    } catch (e) {
        showToast('계약서 목록을 불러오는 데 실패했습니다.', 'error');
        console.error(e);
    }
}

// ── Render ──
function renderContractTable() {
    const q = els.searchInput.value.toLowerCase().trim();
    let data = allContracts;
    
    if (q) {
        data = data.filter(d => 
            (d.contractNo || '').toLowerCase().includes(q) ||
            (d.title || '').toLowerCase().includes(q) ||
            (d.buyer || '').toLowerCase().includes(q) ||
            (d.seller || '').toLowerCase().includes(q)
        );
    }
    
    if (data.length === 0) {
        els.contractListBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:40px; color:#94a3b8;"><i class='bx bx-file-blank' style="font-size:24px; display:block; margin-bottom:10px;"></i>검색된 계약건이 없습니다.</td></tr>`;
        return;
    }
    
    els.contractListBody.innerHTML = data.map(d => {
        const fileCount = d.fileCount || 0;
        const cDate = d.createdAt ? formatDateToKST(d.createdAt).split(' ')[0] : '-'; // Just date part for list
        
        return `<tr data-id="${d.id}" style="cursor:pointer;" onclick="editContract('${d.id}')">
            <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
            <td style="font-weight:600; color:var(--primary);">${d.contractNo}</td>
            <td style="font-weight:500;">${d.title}</td>
            <td>${d.buyer}</td>
            <td>${d.seller}</td>
            <td><span class="ct-badge ${getBadgeClass(d.type)}">${d.type}</span></td>
            <td>${d.effectiveDate || '-'}</td>
            <td onclick="event.stopPropagation()">
                <button class="btn-outline" style="padding: 4px 8px; font-size:11px;" onclick="openFileManager('${d.id}')">
                    <i class='bx bx-folder-open'></i> 파일 (${fileCount})
                </button>
            </td>
            <td style="color:#64748b; font-size:11px;">${cDate}</td>
            <td class="col-actions" onclick="event.stopPropagation()">
                <div class="row-actions">
                    <button type="button" title="수정" onclick="editContract('${d.id}')"><i class='bx bx-edit-alt'></i></button>
                    <button type="button" class="btn-delete" title="삭제" onclick="deleteContract('${d.id}')"><i class='bx bx-trash'></i></button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ── Modals & Actions ──
els.btnNewContract.addEventListener('click', async () => {
    els.contractForm.reset();
    els.editId.value = '';
    
    // 서버에서 순차적 계약번호 채번 (KNG-YYMM-001)
    els.inpContractNo.value = '번호 채번 중...';
    try {
        const res = await authFetch('/api/contracts/next-no');
        els.inpContractNo.value = res.nextNo;
    } catch(e) {
        els.inpContractNo.value = '';
        showToast('계약번호 채번에 실패했습니다. 직접 입력해주세요.', 'error');
    }
    
    els.modalTitle.textContent = '신규 계약 등록';
    els.timestampInfo.style.display = 'none';
    els.contractModal.classList.add('active');
});

window.editContract = function(id) {
    const d = allContracts.find(x => x.id === id);
    if (!d) return;
    
    els.editId.value = d.id;
    els.inpContractNo.value = d.contractNo || '';
    els.inpTitle.value = d.title || '';
    els.inpBuyer.value = d.buyer || '';
    els.inpSeller.value = d.seller || '';
    els.inpType.value = d.type || '기타';
    els.inpCurrency.value = d.currency || 'KRW';
    els.inpAmount.value = d.amount || '';
    els.inpEffectiveDate.value = d.effectiveDate || '';
    els.inpPaymentTerms.value = d.paymentTerms || '';
    els.inpPic.value = d.pic || '';
    els.inpRemarks.value = d.remarks || '';
    
    els.lblCreatedAt.textContent = formatDateToKST(d.createdAt);
    els.lblUpdatedAt.textContent = formatDateToKST(d.updatedAt);
    els.timestampInfo.style.display = 'block';
    
    els.modalTitle.textContent = '계약 정보 수정';
    els.contractModal.classList.add('active');
};

function closeContractModal() {
    els.contractModal.classList.remove('active');
}
els.closeContractModalBtn.addEventListener('click', closeContractModal);
els.cancelContractBtn.addEventListener('click', closeContractModal);

// Save Contract
els.contractForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = els.editId.value;
    const isEdit = !!id;
    
    const payload = {
        contractNo: els.inpContractNo.value.trim(),
        title: els.inpTitle.value.trim(),
        buyer: els.inpBuyer.value.trim(),
        seller: els.inpSeller.value.trim(),
        type: els.inpType.value,
        currency: els.inpCurrency.value,
        amount: parseFloat(els.inpAmount.value) || 0,
        effectiveDate: els.inpEffectiveDate.value,
        paymentTerms: els.inpPaymentTerms.value.trim(),
        pic: els.inpPic.value.trim(),
        remarks: els.inpRemarks.value.trim()
    };
    
    try {
        const url = isEdit ? `/api/contracts/${id}` : '/api/contracts';
        const method = isEdit ? 'PUT' : 'POST';
        await authFetch(url, { method, body: JSON.stringify(payload) });
        showToast(isEdit ? '계약 정보가 수정되었습니다.' : '계약이 등록되었습니다.');
        closeContractModal();
        loadContracts();
    } catch (err) {
        showToast('저장 실패: ' + err.message, 'error');
    }
});

// Delete Contract
window.deleteContract = async function(id) {
    if (!confirm('정말 이 계약 건과 모든 첨부파일을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`/api/contracts/${id}`, { method: 'DELETE' });
        showToast('삭제 완료되었습니다.');
        loadContracts();
    } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
    }
};

els.btnDeleteSelected.addEventListener('click', async () => {
    const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (checked.length === 0) return showToast('삭제할 계약을 선택하세요.', 'error');
    if (!confirm(`선택한 ${checked.length}개의 계약건을 삭제하시겠습니까? (관련 파일 모두 삭제됨)`)) return;
    
    // API only supports single delete currently, so we promise all
    try {
        await Promise.all(checked.map(id => authFetch(`/api/contracts/${id}`, { method: 'DELETE' })));
        showToast('선택한 계약건이 삭제되었습니다.');
        els.selectAll.checked = false;
        loadContracts();
    } catch(e) {
        showToast('일부 삭제 실패: ' + e.message, 'error');
        loadContracts(); // reload anyway
    }
});

els.selectAll.addEventListener('change', (e) => {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
});
els.searchInput.addEventListener('input', renderContractTable);

// ── Autocomplete Logic ──
function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    
    input.addEventListener('input', () => {
        const val = input.value.toLowerCase().trim();
        list.innerHTML = '';
        if (!val) {
            list.classList.remove('active');
            return;
        }
        
        const matches = allPartners.filter(p => p.name.toLowerCase().includes(val)).slice(0, 5);
        if (matches.length > 0) {
            list.innerHTML = matches.map(m => `<li data-name="${m.name}">${m.name}</li>`).join('');
            list.classList.add('active');
        } else {
            list.classList.remove('active');
        }
    });
    
    list.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'LI') {
            input.value = e.target.getAttribute('data-name');
            list.classList.remove('active');
        }
    });
    
    input.addEventListener('blur', () => {
        setTimeout(() => list.classList.remove('active'), 150);
    });
}
setupAutocomplete('inpBuyer', 'acBuyerList');
setupAutocomplete('inpSeller', 'acSellerList');


// ── File Manager Logic ──
window.openFileManager = async function(id) {
    const d = allContracts.find(x => x.id === id);
    if (!d) return;
    currentContract = d;
    
    els.fmContractNo.textContent = d.contractNo;
    els.fileModal.classList.add('active');
    
    // Clear preview
    clearPreview();
    
    await loadContractFiles(id);
};

els.closeFileModalBtn.addEventListener('click', () => {
    els.fileModal.classList.remove('active');
    currentContract = null;
    loadContracts(); // Reload list to update file count
});

async function loadContractFiles(id) {
    try {
        const data = await authFetch(`/api/contracts/${id}`);
        const files = data.files || [];
        els.fmFileCount.textContent = `${files.length}개`;
        
        if (files.length === 0) {
            els.fileList.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8; font-size:12px;">첨부된 파일이 없습니다.</div>`;
            return;
        }
        
        els.fileList.innerHTML = files.map(f => {
            let iconClass = 'other', icon = 'bx-file';
            if (f.fileType === '.pdf') { iconClass = 'pdf'; icon = 'bxs-file-pdf'; }
            else if (f.fileType.includes('doc')) { iconClass = 'doc'; icon = 'bxs-file-doc'; }
            else if (f.fileType.includes('xls')) { iconClass = 'xls'; icon = 'bx-spreadsheet'; }
            
            let badgeClass = '';
            if (f.versionLabel.includes('최종')) badgeClass = 'final';
            else if (f.versionLabel.includes('날인')) badgeClass = 'signed';
            else if (f.versionLabel.includes('초안')) badgeClass = 'draft';
            
            return `
            <div class="file-card" id="fcard-${f.id}">
                <div class="file-icon ${iconClass}"><i class='bx ${icon}'></i></div>
                <div class="file-info">
                    <div class="file-name" title="${f.fileName}" onclick="previewFile('${f.filePath}', '${f.fileType}', '${f.fileName}', '${f.id}')">${f.fileName}</div>
                    <div class="file-meta">
                        <span class="version-badge ${badgeClass}">${f.versionLabel}</span>
                        <span>${formatBytes(f.fileSize)}</span>
                        <span>${formatDateToKST(f.uploadedAt)}</span>
                    </div>
                </div>
                <div class="file-actions">
                    <button title="파일 다운로드" onclick="downloadFile('${f.filePath}', '${f.fileName}')"><i class='bx bx-download'></i></button>
                    <button title="삭제" onclick="deleteFile('${f.id}')"><i class='bx bx-trash'></i></button>
                </div>
            </div>`;
        }).join('');
        
    } catch(e) {
        showToast('파일 목록 로드 실패: ' + e.message, 'error');
    }
}

// File Upload Handlers
els.uploadZone.addEventListener('click', () => els.fileInput.click());
els.uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); els.uploadZone.classList.add('dragover'); });
els.uploadZone.addEventListener('dragleave', () => els.uploadZone.classList.remove('dragover'));
els.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    els.uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files[0]);
    }
});
els.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
    e.target.value = ''; // reset
});

async function handleFileUpload(file) {
    if (!currentContract) return;
    
    // Basic validation
    if (file.size > 50 * 1024 * 1024) {
        return showToast('50MB 이하의 파일만 업로드 가능합니다.', 'error');
    }
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('versionLabel', els.fileVersionLabel.value);
    
    // loading visual
    els.uploadZone.style.opacity = '0.5';
    try {
        const token = await getToken();
        const headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;
        
        const res = await fetch(`${API_BASE}/api/contracts/${currentContract.id}/files`, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '업로드 실패');
        
        showToast('파일이 업로드 되었습니다.');
        loadContractFiles(currentContract.id);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        els.uploadZone.style.opacity = '1';
    }
}

window.deleteFile = async function(fileId) {
    if (!confirm('이 파일을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`/api/contracts/${currentContract.id}/files/${fileId}`, { method: 'DELETE' });
        showToast('파일이 삭제되었습니다.');
        loadContractFiles(currentContract.id);
        clearPreview(); // In case we were previewing it
    } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
    }
};

window.downloadFile = function(filePath, fileName) {
    const url = `${API_BASE}/api/contracts/uploads/${filePath}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};

window.previewFile = function(filePath, fileType, fileName, fileId) {
    // Highlight selected card
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('active-preview'));
    const card = document.getElementById(`fcard-${fileId}`);
    if (card) card.classList.add('active-preview');
    
    const url = `${API_BASE}/api/contracts/uploads/${filePath}`;
    
    els.previewDownloadBtn.style.display = 'inline-flex';
    els.previewDownloadBtn.onclick = (e) => { e.preventDefault(); downloadFile(filePath, fileName); };
    
    if (fileType === '.pdf') {
        els.previewContainer.innerHTML = `<iframe src="${url}#toolbar=0" style="width:100%; height:100%; border:none; border-radius:0 0 8px 8px;"></iframe>`;
        els.previewContainer.style.padding = '0';
    } else {
        els.previewContainer.style.padding = '10px';
        els.previewContainer.innerHTML = `
            <div style="text-align: center;">
                <i class='bx bx-file' style="font-size: 64px; color:#94a3b8;"></i>
                <h3 style="margin: 15px 0 5px; color:#1e293b;">${fileName}</h3>
                <p style="font-size: 13px;">이 파일 형식은 브라우저 미리보기를 지원하지 않습니다.<br>다운로드하여 확인해 주세요.</p>
                <button class="btn-primary" style="margin-top:20px;" onclick="downloadFile('${filePath}', '${fileName}')"><i class='bx bx-download'></i> 다운로드</button>
            </div>
        `;
    }
};

function clearPreview() {
    els.previewContainer.style.padding = '10px';
    els.previewContainer.innerHTML = `
        <div style="text-align: center;">
            <i class='bx bx-file-blank' style="font-size: 48px;"></i>
            <p style="margin-top: 10px; font-size: 13px;">미리보기할 PDF 파일을 리스트에서 선택해주세요.</p>
        </div>
    `;
    els.previewDownloadBtn.style.display = 'none';
    document.querySelectorAll('.file-card').forEach(c => c.classList.remove('active-preview'));
}

// Init
window.addEventListener('DOMContentLoaded', () => {
    loadPartners();
    loadContracts();
});
