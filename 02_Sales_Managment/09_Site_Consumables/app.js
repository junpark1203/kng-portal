const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';

let sites = [];
let currentSiteId = null;
let currentConsumables = [];
let currentFiles = [];
let uploadQueue = [];

// ── Auth ──
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
    } catch(e) {}
    return '';
}

async function authFetch(url, opts = {}) {
    const token = await getToken();
    if (!(opts.body instanceof FormData)) {
        opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    }
    if (token) {
        opts.headers = { ...opts.headers, 'Authorization': 'Bearer ' + token };
    }
    const res = await fetch(API_BASE + url, opts);
    if (!res.ok) { 
        let msg = res.statusText; 
        try { 
            const e = await res.json(); 
            msg = e.error || msg; 
        } catch(e){} 
        throw new Error(msg); 
    }
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

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fmtDate(iso) {
    if(!iso) return '-';
    try { return new Date(iso).toLocaleDateString('ko-KR'); } catch(e) { return iso; }
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', () => {
    loadSites();
    setupModals();
    setupDragDrop();
});

// ── Modals ──
function setupModals() {
    window.openSiteModal = (id = null) => {
        const m = document.getElementById('siteModal');
        const form = document.getElementById('siteForm');
        form.reset();
        document.getElementById('siteId').value = '';
        document.getElementById('siteModalTitle').textContent = '현장 등록';
        
        if (id) {
            const site = sites.find(s => s.id === id);
            if (site) {
                document.getElementById('siteId').value = site.id;
                document.getElementById('siteName').value = site.name;
                document.getElementById('siteAddress').value = site.address || '';
                document.getElementById('siteRemarks').value = site.remarks || '';
                document.getElementById('siteModalTitle').textContent = '현장 수정';
            }
        }
        m.classList.add('active');
    };

    window.closeSiteModal = () => document.getElementById('siteModal').classList.remove('active');

    window.openConsumableModal = (id = null) => {
        if (!currentSiteId) return showToast('현장을 먼저 선택해주세요.', 'error');
        const m = document.getElementById('consumableModal');
        const form = document.getElementById('consumableForm');
        form.reset();
        document.getElementById('consumableId').value = '';
        document.getElementById('consumableModalTitle').textContent = '소모품 등록';
        
        if (id) {
            const c = currentConsumables.find(x => x.id === id);
            if (c) {
                document.getElementById('consumableId').value = c.id;
                document.getElementById('cName').value = c.name;
                document.getElementById('cSpec').value = c.specification || '';
                document.getElementById('cUnit').value = c.unit || '';
                document.getElementById('cRemarks').value = c.remarks || '';
                document.getElementById('consumableModalTitle').textContent = '소모품 수정';
            }
        }
        m.classList.add('active');
    };

    window.closeConsumableModal = () => document.getElementById('consumableModal').classList.remove('active');

    window.closeFileModal = () => document.getElementById('fileModal').classList.remove('active');
    window.closePreviewModal = () => {
        document.getElementById('previewModal').classList.remove('active');
        document.getElementById('previewContent').innerHTML = ''; // iframe 등 내용 초기화
    };
}

// ── Site CRUD ──
async function loadSites() {
    try {
        sites = await authFetch('/api/site-consumables/sites');
        renderSites();
    } catch(e) {
        showToast('현장 목록 로드 실패', 'error');
    }
}

function renderSites() {
    const list = document.getElementById('siteList');
    list.innerHTML = '';
    
    if (sites.length === 0) {
        list.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;">등록된 현장이 없습니다.</div>';
        return;
    }

    sites.forEach(s => {
        const div = document.createElement('div');
        div.className = `site-item ${s.id === currentSiteId ? 'active' : ''}`;
        div.onclick = () => selectSite(s.id);
        div.innerHTML = `
            <div class="site-name">${escapeHtml(s.name)}</div>
            <div class="site-addr"><i class='bx bx-map'></i> ${escapeHtml(s.address || '주소 없음')}</div>
        `;
        list.appendChild(div);
    });
}

window.selectSite = async (id) => {
    currentSiteId = id;
    renderSites();
    
    const site = sites.find(s => s.id === id);
    if (!site) return;

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('consumablesContent').classList.remove('hidden');
    
    document.getElementById('currentSiteName').textContent = site.name;
    document.getElementById('currentSiteAddress').textContent = site.address || '-';
    
    await loadConsumables();
};

document.getElementById('siteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('siteId').value;
    const body = {
        name: document.getElementById('siteName').value.trim(),
        address: document.getElementById('siteAddress').value.trim(),
        remarks: document.getElementById('siteRemarks').value.trim()
    };
    
    try {
        if (id) {
            await authFetch(`/api/site-consumables/sites/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            showToast('수정되었습니다.');
        } else {
            const res = await authFetch('/api/site-consumables/sites', { method: 'POST', body: JSON.stringify(body) });
            currentSiteId = res.id;
        }
        closeSiteModal();
        await loadSites();
        if (currentSiteId) selectSite(currentSiteId);
    } catch(err) {
        showToast(err.message, 'error');
    }
});

window.editSite = () => openSiteModal(currentSiteId);
window.deleteSite = async () => {
    if(!confirm('정말 이 현장을 삭제하시겠습니까? 관련 소모품 및 도면이 모두 삭제됩니다.')) return;
    try {
        await authFetch(`/api/site-consumables/sites/${currentSiteId}`, { method: 'DELETE' });
        showToast('현장이 삭제되었습니다.');
        currentSiteId = null;
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('consumablesContent').classList.add('hidden');
        await loadSites();
    } catch(e) {
        showToast(e.message, 'error');
    }
};

// ── Consumables CRUD ──
async function loadConsumables() {
    if (!currentSiteId) return;
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;"><i class="bx bx-loader-alt bx-spin"></i> 로딩 중...</td></tr>';
    try {
        currentConsumables = await authFetch(`/api/site-consumables/consumables/${currentSiteId}`);
        renderConsumables();
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">불러오기 실패</td></tr>';
        showToast(e.message, 'error');
    }
}

function renderConsumables() {
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '';
    
    if (currentConsumables.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px; color: #94a3b8;">등록된 소모품이 없습니다.</td></tr>';
        return;
    }

    currentConsumables.forEach(c => {
        const tr = document.createElement('tr');
        const fCount = c.fileCount || 0;
        
        tr.innerHTML = `
            <td style="font-weight:500;">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.specification || '-')}</td>
            <td>${escapeHtml(c.unit || '-')}</td>
            <td>${escapeHtml(c.remarks || '-')}</td>
            <td>
                <button class="btn-outline" style="padding: 4px 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px;" onclick="openFileManager('${c.id}')">
                    <i class='bx ${fCount>0 ? 'bx-file-find' : 'bx-upload'}'></i>
                    도면 ${fCount>0 ? `(${fCount})` : ''}
                </button>
            </td>
            <td class="col-actions">
                <button title="수정" onclick="openConsumableModal('${c.id}')" style="background:none; border:none; color:#64748b; cursor:pointer;"><i class='bx bx-edit-alt' style="font-size:18px;"></i></button>
                <button title="삭제" onclick="deleteConsumable('${c.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; margin-left: 8px;"><i class='bx bx-trash' style="font-size:18px;"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('consumableForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('consumableId').value;
    const body = {
        siteId: currentSiteId,
        name: document.getElementById('cName').value.trim(),
        specification: document.getElementById('cSpec').value.trim(),
        unit: document.getElementById('cUnit').value.trim(),
        remarks: document.getElementById('cRemarks').value.trim()
    };
    
    try {
        if (id) {
            await authFetch(`/api/site-consumables/consumables/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            showToast('소모품 정보가 수정되었습니다.');
        } else {
            await authFetch('/api/site-consumables/consumables', { method: 'POST', body: JSON.stringify(body) });
            showToast('소모품이 추가되었습니다.');
        }
        closeConsumableModal();
        await loadConsumables();
    } catch(err) {
        showToast(err.message, 'error');
    }
});

window.deleteConsumable = async (id) => {
    if(!confirm('정말 삭제하시겠습니까? 첨부된 도면 파일도 함께 삭제됩니다.')) return;
    try {
        await authFetch(`/api/site-consumables/consumables/${id}`, { method: 'DELETE' });
        showToast('소모품이 삭제되었습니다.');
        await loadConsumables();
    } catch(e) {
        showToast(e.message, 'error');
    }
};

// ── File Management ──
let currentConsumableForFiles = null;

window.openFileManager = async (id) => {
    currentConsumableForFiles = id;
    const m = document.getElementById('fileModal');
    m.classList.add('active');
    await loadFiles();
};

async function loadFiles() {
    const list = document.getElementById('fileList');
    list.innerHTML = '<div style="text-align:center;"><i class="bx bx-loader-alt bx-spin"></i></div>';
    
    try {
        currentFiles = await authFetch(`/api/site-consumables/files/${currentConsumableForFiles}`);
        renderFiles();
    } catch(e) {
        list.innerHTML = '<div style="color:red; text-align:center;">오류가 발생했습니다.</div>';
    }
}

function getFileIcon(type, name) {
    name = name.toLowerCase();
    if(name.endsWith('.pdf')) return 'bxs-file-pdf text-red-500';
    if(name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'bxs-file-image text-blue-500';
    if(name.endsWith('.dwg') || name.endsWith('.dxf')) return 'bxs-ruler text-yellow-500';
    if(name.endsWith('.xls') || name.endsWith('.xlsx')) return 'bxs-file-export text-green-500';
    return 'bx-file-blank';
}

function isPreviewable(name) {
    const n = name.toLowerCase();
    return n.endsWith('.pdf') || n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg');
}

function renderFiles() {
    const list = document.getElementById('fileList');
    list.innerHTML = '';
    
    if (currentFiles.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#94a3b8; text-align:center;">첨부된 도면/파일이 없습니다.</div>';
        return;
    }
    
    currentFiles.forEach(f => {
        const div = document.createElement('div');
        div.className = 'file-item';
        const url = `${API_BASE}/api/site-consumables/uploads/${f.fileName}`;
        const canPreview = isPreviewable(f.originalName);
        
        div.innerHTML = `
            <div class="file-info" style="cursor: ${canPreview?'pointer':'default'}" ${canPreview? `onclick="previewFile('${url}', '${f.originalName}')"` : ''}>
                <i class='bx ${getFileIcon(f.fileType, f.originalName)}' style="font-size:24px;"></i>
                <div>
                    <div class="file-name" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</div>
                    <div style="font-size:11px; color:#94a3b8;">${fmtDate(f.uploadedAt)} · ${fmtBytes(f.fileSize)}</div>
                </div>
            </div>
            <div class="file-actions">
                ${canPreview ? `<button class="btn-outline" onclick="previewFile('${url}', '${f.originalName}')"><i class='bx bx-show'></i></button>` : ''}
                <a href="${url}" download="${f.originalName}" class="btn-outline" style="text-decoration:none;"><i class='bx bx-download'></i></a>
                <button class="btn-outline btn-outline-danger" onclick="deleteFile('${f.id}')"><i class='bx bx-trash'></i></button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.previewFile = (url, name) => {
    document.getElementById('previewTitle').textContent = name;
    const content = document.getElementById('previewContent');
    const n = name.toLowerCase();
    
    content.innerHTML = '<div style="text-align:center; padding: 50px;"><i class="bx bx-loader-alt bx-spin" style="font-size:30px;"></i></div>';
    
    if (n.endsWith('.pdf')) {
        content.innerHTML = `<iframe src="${url}" style="width:100%; height:100%; border:none;"></iframe>`;
    } else {
        content.innerHTML = `<img src="${url}" style="max-width:100%; max-height:100%; object-fit:contain; padding: 20px;" alt="preview">`;
    }
    
    document.getElementById('previewModal').classList.add('active');
};

window.deleteFile = async (id) => {
    if(!confirm('파일을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`/api/site-consumables/files/${id}`, { method: 'DELETE' });
        showToast('파일이 삭제되었습니다.');
        await loadFiles();
        await loadConsumables(); // Update file count in table
    } catch(e) {
        showToast(e.message, 'error');
    }
};

// Drag and Drop Upload
function setupDragDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        handleFiles(dt.files);
    });

    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
        this.value = ''; // Reset
    });
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    if (!currentConsumableForFiles) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    const dropZone = document.getElementById('dropZone');
    const origHtml = dropZone.innerHTML;
    dropZone.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i><p>업로드 중...</p>';
    dropZone.style.pointerEvents = 'none';

    try {
        await authFetch(`/api/site-consumables/files/${currentConsumableForFiles}`, {
            method: 'POST',
            body: formData
        });
        showToast(`${files.length}개의 파일이 업로드 되었습니다.`);
        await loadFiles();
        await loadConsumables(); // Refresh count
    } catch(err) {
        showToast(`업로드 실패: ${err.message}`, 'error');
    } finally {
        dropZone.innerHTML = origHtml;
        dropZone.style.pointerEvents = 'auto';
    }
}
