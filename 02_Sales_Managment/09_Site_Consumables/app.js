const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';

let sites = [];
let currentSiteId = null;
let currentConsumables = [];
let currentFiles = [];
let uploadQueue = [];
let siteSortOrder = 'asc';

let dashboardFilters = {
    siteName: '',
    category: '',
    subCategory: '',
    name: '',
    specification: ''
};

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
    
    document.getElementById('searchSite')?.addEventListener('input', renderSites);
    document.getElementById('searchConsumable')?.addEventListener('input', () => {
        if (currentSiteId === 'dashboard') applyDashboardFilters();
        else renderConsumables();
    });
    document.getElementById('sortSiteBtn')?.addEventListener('click', () => {
        siteSortOrder = siteSortOrder === 'asc' ? 'desc' : 'asc';
        const icon = document.querySelector('#sortSiteBtn i');
        if (icon) {
            icon.className = siteSortOrder === 'asc' ? 'bx bx-sort-a-z' : 'bx bx-sort-z-a';
        }
        renderSites();
    });
    initDashboardFilters();
});

function initDashboardFilters() {
    ['filterSite', 'filterCategory', 'filterSubCategory', 'filterName', 'filterSpec'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const key = id.replace('filter', '');
                const propMap = { 'Site': 'siteName', 'Category': 'category', 'SubCategory': 'subCategory', 'Name': 'name', 'Spec': 'specification' };
                dashboardFilters[propMap[key]] = e.target.value;
                applyDashboardFilters();
            });
        }
    });
}

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
                document.getElementById('siteTbmMachine').value = site.tbmMachine || '';
                document.getElementById('siteTunnelDiameter').value = site.tunnelInnerDiameter || '';
                document.getElementById('siteTunnelLength').value = site.tunnelLength || '';
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
        const cSelectedFiles = document.getElementById('cSelectedFiles');
        if (cSelectedFiles) cSelectedFiles.textContent = '';
        
        if (id) {
            const c = currentConsumables.find(x => x.id === id);
            if (c) {
                document.getElementById('consumableId').value = c.id;
                document.getElementById('cCategory').value = c.category || '';
                document.getElementById('cSubCategory').value = c.subCategory || '';
                document.getElementById('cName').value = c.name;
                document.getElementById('cSpec').value = c.specification || '';
                document.getElementById('cOpQuantity').value = c.opQuantity || '';
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
        if (!currentSiteId) {
            selectSite('dashboard');
        }
    } catch(e) {
        const list = document.getElementById('siteList');
        if (list) list.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444;">데이터를 불러오지 못했습니다.<br><small>' + e.message + '</small></div>';
        showToast('현장 목록 로드 실패: ' + e.message, 'error');
        console.error('loadSites error:', e);
    }
}

function renderSites() {
    const list = document.getElementById('siteList');
    list.innerHTML = '';
    
    const query = (document.getElementById('searchSite')?.value || '').toLowerCase();
    let filteredSites = sites.filter(s => s.name.toLowerCase().includes(query) || (s.address || '').toLowerCase().includes(query));

    filteredSites.sort((a, b) => {
        if (siteSortOrder === 'asc') return a.name.localeCompare(b.name, 'ko');
        return b.name.localeCompare(a.name, 'ko');
    });

    const dashDiv = document.createElement('div');
    dashDiv.className = `site-item ${currentSiteId === 'dashboard' ? 'active' : ''}`;
    dashDiv.style.borderBottom = '2px solid #e2e8f0';
    dashDiv.style.marginBottom = '8px';
    dashDiv.onclick = () => selectSite('dashboard');
    dashDiv.innerHTML = `
        <div class="site-name" style="font-weight: 700; color: #4f46e5;"><i class='bx bx-grid-alt'></i> 전체 대시보드</div>
    `;
    list.appendChild(dashDiv);

    if (filteredSites.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style = "padding: 20px; text-align: center; color: #94a3b8;";
        emptyDiv.textContent = '검색된 현장이 없습니다.';
        list.appendChild(emptyDiv);
        return;
    }

    filteredSites.forEach(s => {
        const div = document.createElement('div');
        div.className = `site-item ${s.id === currentSiteId ? 'active' : ''}`;
        div.onclick = () => selectSite(s.id);
        
        let specsHtml = '';
        if (s.tbmMachine || s.tunnelInnerDiameter || s.tunnelLength) {
            specsHtml = `<div style="font-size: 11px; color: #64748b; margin-top: 4px; display: flex; gap: 8px; flex-wrap: wrap;">
                ${s.tbmMachine ? `<span><i class='bx bx-cog'></i> ${escapeHtml(s.tbmMachine)}</span>` : ''}
                ${s.tunnelInnerDiameter ? `<span><i class='bx bx-target-lock'></i> ${escapeHtml(s.tunnelInnerDiameter)}mm</span>` : ''}
                ${s.tunnelLength ? `<span><i class='bx bx-ruler'></i> ${escapeHtml(s.tunnelLength)}m</span>` : ''}
            </div>`;
        }

        div.innerHTML = `
            <div class="site-name">${escapeHtml(s.name)}</div>
            ${specsHtml}
        `;
        list.appendChild(div);
    });
}

window.selectSite = async (id) => {
    currentSiteId = id;
    renderSites();
    
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('consumablesContent').classList.remove('hidden');

    if (id === 'dashboard') {
        document.getElementById('currentSiteName').innerHTML = "<i class='bx bx-grid-alt'></i> 전체 대시보드";
        if(document.getElementById('currentSiteSpecs')) document.getElementById('currentSiteSpecs').style.display = 'none';
        
        document.querySelector('.header-actions button[onclick="editSite()"]').style.display = 'none';
        document.querySelector('.header-actions button[onclick="deleteSite()"]').style.display = 'none';
        document.querySelector('.header-actions button[onclick="openConsumableModal()"]').style.display = 'none';
        document.getElementById('dashboardPanel').style.display = 'block';

        // 대시보드 필터 초기화
        dashboardFilters = { siteName: '', category: '', subCategory: '', name: '', specification: '' };
        document.getElementById('searchConsumable').value = '';

        await loadDashboard();
        return;
    }

    document.getElementById('dashboardPanel').style.display = 'none';
    const site = sites.find(s => s.id === id);
    if (!site) return;

    document.getElementById('currentSiteName').textContent = site.name;
    if(document.getElementById('currentSiteSpecs')) {
        document.getElementById('currentSiteSpecs').style.display = 'flex';
        document.getElementById('specTbm').innerHTML = `<i class='bx bx-cog'></i> TBM장비: <b>${escapeHtml(site.tbmMachine || '-')}</b>`;
        document.getElementById('specDiameter').innerHTML = `<i class='bx bx-target-lock'></i> 터널내경: <b>${escapeHtml(site.tunnelInnerDiameter ? site.tunnelInnerDiameter + 'mm' : '-')}</b>`;
        document.getElementById('specLength').innerHTML = `<i class='bx bx-ruler'></i> 터널연장: <b>${escapeHtml(site.tunnelLength ? site.tunnelLength + 'm' : '-')}</b>`;
    }
    
    document.querySelector('.header-actions button[onclick="editSite()"]').style.display = 'inline-block';
    document.querySelector('.header-actions button[onclick="deleteSite()"]').style.display = 'inline-block';
    document.querySelector('.header-actions button[onclick="openConsumableModal()"]').style.display = 'inline-block';

    await loadConsumables();
};

document.getElementById('siteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('siteId').value;
    const body = {
        name: document.getElementById('siteName').value.trim(),
        tbmMachine: document.getElementById('siteTbmMachine').value.trim(),
        tunnelInnerDiameter: document.getElementById('siteTunnelDiameter').value.trim(),
        tunnelLength: document.getElementById('siteTunnelLength').value.trim()
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
async function loadDashboard() {
    const theadTr = document.querySelector('.data-table thead tr');
    theadTr.innerHTML = `
        <th>현장명</th>
        <th>구분(상위)</th>
        <th>구분(하위)</th>
        <th>품명</th>
        <th>규격</th>
        <th>운용수량</th>
        <th>단위</th>
        <th>비고</th>
    `;
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;"><i class="bx bx-loader-alt bx-spin"></i> 로딩 중...</td></tr>';
    try {
        currentConsumables = await authFetch(`/api/site-consumables/all-consumables`);
        applyDashboardFilters();
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red;">불러오기 실패</td></tr>';
        showToast(e.message, 'error');
    }
}

function applyDashboardFilters() {
    // 1. Calculate filtered list
    const query = (document.getElementById('searchConsumable')?.value || '').toLowerCase();
    
    let filtered = currentConsumables.filter(c => {
        if (dashboardFilters.siteName && c.siteName !== dashboardFilters.siteName) return false;
        if (dashboardFilters.category && c.category !== dashboardFilters.category) return false;
        if (dashboardFilters.subCategory && c.subCategory !== dashboardFilters.subCategory) return false;
        if (dashboardFilters.name && c.name !== dashboardFilters.name) return false;
        if (dashboardFilters.specification && c.specification !== dashboardFilters.specification) return false;
        
        if (query) {
            const matchesQuery = (c.name || '').toLowerCase().includes(query) || 
                                 (c.category || '').toLowerCase().includes(query) ||
                                 (c.subCategory || '').toLowerCase().includes(query) ||
                                 (c.specification || '').toLowerCase().includes(query) ||
                                 (c.siteName || '').toLowerCase().includes(query) ||
                                 (c.remarks || '').toLowerCase().includes(query);
            if (!matchesQuery) return false;
        }
        return true;
    });

    // 2. Update dropdowns
    const props = [
        { id: 'filterSite', key: 'siteName', label: '전체 현장' },
        { id: 'filterCategory', key: 'category', label: '전체' },
        { id: 'filterSubCategory', key: 'subCategory', label: '전체' },
        { id: 'filterName', key: 'name', label: '전체' },
        { id: 'filterSpec', key: 'specification', label: '전체' }
    ];

    props.forEach(({ id, key, label }) => {
        const otherFilters = { ...dashboardFilters };
        delete otherFilters[key]; // ignore self
        
        const validForThisDropdown = currentConsumables.filter(c => {
            if (otherFilters.siteName && c.siteName !== otherFilters.siteName) return false;
            if (otherFilters.category && c.category !== otherFilters.category) return false;
            if (otherFilters.subCategory && c.subCategory !== otherFilters.subCategory) return false;
            if (otherFilters.name && c.name !== otherFilters.name) return false;
            if (otherFilters.specification && c.specification !== otherFilters.specification) return false;
            return true;
        });

        const uniqueValues = [...new Set(validForThisDropdown.map(c => c[key] || ''))].filter(v => v !== '');
        uniqueValues.sort((a, b) => a.localeCompare(b, 'ko'));

        const el = document.getElementById(id);
        const currentVal = dashboardFilters[key];
        
        el.innerHTML = `<option value="">${label}</option>` + uniqueValues.map(v => `<option value="${escapeHtml(v)}"${v === currentVal ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
    });

    // 3. Update Summary Cards
    const uniqueSites = new Set(filtered.map(c => c.siteId)).size;
    const uniqueTypes = new Set(filtered.map(c => (c.name || '') + '|' + (c.specification || ''))).size;
    const totalQuantity = filtered.reduce((sum, c) => {
        const qty = parseFloat(c.opQuantity);
        return sum + (isNaN(qty) ? 0 : qty);
    }, 0);

    document.getElementById('summarySites').textContent = uniqueSites.toLocaleString();
    document.getElementById('summaryTypes').textContent = uniqueTypes.toLocaleString();
    document.getElementById('summaryQuantity').textContent = totalQuantity.toLocaleString();
    document.getElementById('summaryRows').textContent = filtered.length.toLocaleString();

    // 4. Render Table
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '';
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 30px; color: #94a3b8;">등록되거나 조건에 맞는 소모품이 없습니다.</td></tr>';
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600; color:#475569; white-space:nowrap;">${escapeHtml(c.siteName || '알 수 없음')}</td>
            <td><span style="display:inline-block; padding:3px 10px; background:#eef2ff; border:1px solid #c7d2fe; border-radius:12px; font-size:12px; font-weight:500; color:#4f46e5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${escapeHtml(c.category || '-')}</span></td>
            <td>${c.subCategory ? `<span style="display:inline-block; padding:3px 10px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; font-size:12px; font-weight:500; color:#475569;">${escapeHtml(c.subCategory)}</span>` : '<span style="color:#94a3b8;">-</span>'}</td>
            <td style="font-weight:500;">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.specification || '-')}</td>
            <td>${c.opQuantity ? `<span style="font-weight: 600; color: #0f172a;">${escapeHtml(c.opQuantity)}</span>` : '-'}</td>
            <td>${escapeHtml(c.unit || '-')}</td>
            <td>${escapeHtml(c.remarks || '-')}</td>
        `;
        tbody.appendChild(tr);
    });
}

window.exportDashboardExcel = async () => {
    const query = (document.getElementById('searchConsumable')?.value || '').toLowerCase();
    
    let filtered = currentConsumables.filter(c => {
        if (dashboardFilters.siteName && c.siteName !== dashboardFilters.siteName) return false;
        if (dashboardFilters.category && c.category !== dashboardFilters.category) return false;
        if (dashboardFilters.subCategory && c.subCategory !== dashboardFilters.subCategory) return false;
        if (dashboardFilters.name && c.name !== dashboardFilters.name) return false;
        if (dashboardFilters.specification && c.specification !== dashboardFilters.specification) return false;
        
        if (query) {
            const matchesQuery = (c.name || '').toLowerCase().includes(query) || 
                                 (c.category || '').toLowerCase().includes(query) ||
                                 (c.subCategory || '').toLowerCase().includes(query) ||
                                 (c.specification || '').toLowerCase().includes(query) ||
                                 (c.siteName || '').toLowerCase().includes(query) ||
                                 (c.remarks || '').toLowerCase().includes(query);
            if (!matchesQuery) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        return showToast('내보낼 데이터가 없습니다.', 'error');
    }

    try {
        const btn = document.querySelector('button[onclick="exportDashboardExcel()"]');
        if (btn) btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> 생성 중...';

        const token = await getToken();
        const ids = filtered.map(c => c.id);
        
        const res = await fetch(`${API_BASE}/api/site-consumables/all-consumables/export`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({ ids })
        });
        
        if (!res.ok) throw new Error('엑셀 내보내기 실패');
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `현장별_소모품_전체현황_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        
        if (btn) btn.innerHTML = "<i class='bx bx-export'></i> 엑셀 다운로드";
    } catch(e) {
        showToast(e.message, 'error');
        const btn = document.querySelector('button[onclick="exportDashboardExcel()"]');
        if (btn) btn.innerHTML = "<i class='bx bx-export'></i> 엑셀 다운로드";
    }
};

async function loadConsumables() {
    if (!currentSiteId || currentSiteId === 'dashboard') return;
    const theadTr = document.querySelector('.data-table thead tr');
    theadTr.innerHTML = `
        <th>구분(상위)</th>
        <th>구분(하위)</th>
        <th>품명</th>
        <th>규격</th>
        <th>운용수량</th>
        <th>단위</th>
        <th>비고</th>
        <th style="width: auto; min-width: 250px;">도면 관리</th>
        <th class="col-action" style="width: 120px; white-space: nowrap;">관리</th>
    `;
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;"><i class="bx bx-loader-alt bx-spin"></i> 로딩 중...</td></tr>';
    try {
        currentConsumables = await authFetch(`/api/site-consumables/consumables/${currentSiteId}`);
        renderConsumables();
    } catch(e) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">불러오기 실패</td></tr>';
        showToast(e.message, 'error');
    }
}

function renderConsumables() {
    const tbody = document.getElementById('consumablesTableBody');
    tbody.innerHTML = '';
    
    const query = (document.getElementById('searchConsumable')?.value || '').toLowerCase();
    const filteredConsumables = currentConsumables.filter(c => 
        (c.name || '').toLowerCase().includes(query) || 
        (c.category || '').toLowerCase().includes(query) ||
        (c.subCategory || '').toLowerCase().includes(query) ||
        (c.specification || '').toLowerCase().includes(query) ||
        (c.remarks || '').toLowerCase().includes(query)
    );
    
    if (filteredConsumables.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 30px; color: #94a3b8;">등록되거나 검색된 소모품이 없습니다.</td></tr>';
        return;
    }

    filteredConsumables.forEach(c => {
        const tr = document.createElement('tr');
        
        let fileHtml = '';
        if (c.files && c.files.length > 0) {
            fileHtml = '<div style="display:flex; flex-direction:column; gap:6px; margin-bottom: 8px;">';
            c.files.forEach(f => {
                const url = `${API_BASE}/api/site-consumables/uploads/${f.fileName}`;
                const canPreview = isPreviewable(f.originalName);
                const safeJsName = escapeHtml(f.originalName).replace(/'/g, "\\'");
                
                if (canPreview) {
                    fileHtml += `<div style="display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#3b82f6; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;" onclick="previewFile('${url}', '${safeJsName}')" title="미리보기"><i class='bx bx-file'></i> ${escapeHtml(f.originalName)}</div>`;
                } else {
                    fileHtml += `<a href="${url}" download="${escapeHtml(f.originalName)}" style="display:inline-flex; align-items:center; gap:4px; font-size:12px; color:#64748b; text-decoration:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%;" title="다운로드"><i class='bx bx-download'></i> ${escapeHtml(f.originalName)}</a>`;
                }
            });
            fileHtml += '</div>';
        }
        
        tr.innerHTML = `
            <td><span style="display:inline-block; padding:3px 10px; background:#eef2ff; border:1px solid #c7d2fe; border-radius:12px; font-size:12px; font-weight:500; color:#4f46e5; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${escapeHtml(c.category || '-')}</span></td>
            <td>${c.subCategory ? `<span style="display:inline-block; padding:3px 10px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; font-size:12px; font-weight:500; color:#475569;">${escapeHtml(c.subCategory)}</span>` : '<span style="color:#94a3b8;">-</span>'}</td>
            <td style="font-weight:500;">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.specification || '-')}</td>
            <td>${c.opQuantity ? `<span style="font-weight: 600; color: #0f172a;">${escapeHtml(c.opQuantity)}</span>` : '-'}</td>
            <td>${escapeHtml(c.unit || '-')}</td>
            <td>${escapeHtml(c.remarks || '-')}</td>
            <td>
                ${fileHtml || '<span style="color:#94a3b8; font-size:12px;">-</span>'}
            </td>
            <td class="col-actions" style="white-space: nowrap;">
                <button title="파일 관리/업로드" onclick="openFileManager('${c.id}')" style="background:none; border:none; color:#3b82f6; cursor:pointer;"><i class='bx bx-upload' style="font-size:18px;"></i></button>
                <button title="수정" onclick="openConsumableModal('${c.id}')" style="background:none; border:none; color:#64748b; cursor:pointer; margin-left: 8px;"><i class='bx bx-edit-alt' style="font-size:18px;"></i></button>
                <button title="복사" onclick="copyConsumable('${c.id}')" style="background:none; border:none; color:#10b981; cursor:pointer; margin-left: 8px;"><i class='bx bx-copy' style="font-size:18px;"></i></button>
                <button title="삭제" onclick="deleteConsumable('${c.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; margin-left: 8px;"><i class='bx bx-trash' style="font-size:18px;"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById('consumableForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const origText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> 저장 중...';
    submitBtn.disabled = true;

    try {
        let consumableId = document.getElementById('consumableId').value;
        const body = {
            siteId: currentSiteId,
            category: document.getElementById('cCategory').value.trim(),
            subCategory: document.getElementById('cSubCategory').value.trim(),
            name: document.getElementById('cName').value.trim(),
            specification: document.getElementById('cSpec').value.trim(),
            opQuantity: document.getElementById('cOpQuantity').value.trim(),
            unit: document.getElementById('cUnit').value.trim(),
            remarks: document.getElementById('cRemarks').value.trim()
        };
        
        if (consumableId) {
            await authFetch(`/api/site-consumables/consumables/${consumableId}`, { method: 'PUT', body: JSON.stringify(body) });
        } else {
            const res = await authFetch('/api/site-consumables/consumables', { method: 'POST', body: JSON.stringify(body) });
            consumableId = res.id;
        }

        // Handle file upload
        const fileInput = document.getElementById('cFiles');
        if (fileInput && fileInput.files.length > 0) {
            const formData = new FormData();
            for (let i = 0; i < fileInput.files.length; i++) {
                formData.append('files', fileInput.files[i]);
            }
            await authFetch(`/api/site-consumables/files/${consumableId}`, {
                method: 'POST',
                body: formData
            });
        }
        
        showToast(document.getElementById('consumableId').value ? '소모품 정보가 수정되었습니다.' : '소모품이 추가되었습니다.');
        closeConsumableModal();
        await loadConsumables();
    } catch(err) {
        showToast(err.message, 'error');
    } finally {
        submitBtn.innerHTML = origText;
        submitBtn.disabled = false;
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

window.copyConsumable = async (id) => {
    if(!confirm('이 소모품과 첨부된 도면 파일을 복사하시겠습니까?')) return;
    try {
        const res = await authFetch(`/api/site-consumables/consumables/${id}/copy`, { method: 'POST' });
        showToast(res.message);
        await loadConsumables();
    } catch(e) {
        showToast('복사 실패: ' + e.message, 'error');
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
        
        const safeJsName = escapeHtml(f.originalName).replace(/'/g, "\\'");
        
        div.innerHTML = `
            <div class="file-info" style="cursor: ${canPreview?'pointer':'default'}" ${canPreview? `onclick="previewFile('${url}', '${safeJsName}')"` : ''}>
                <i class='bx ${getFileIcon(f.fileType, f.originalName)}' style="font-size:24px;"></i>
                <div>
                    <div class="file-name" title="${escapeHtml(f.originalName)}">${escapeHtml(f.originalName)}</div>
                    <div style="font-size:11px; color:#94a3b8;">${fmtDate(f.uploadedAt)} · ${fmtBytes(f.fileSize)}</div>
                </div>
            </div>
            <div class="file-actions">
                ${canPreview ? `<button class="btn-outline" onclick="previewFile('${url}', '${safeJsName}')"><i class='bx bx-show'></i></button>` : ''}
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

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

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

    // Consumable Modal Drop Zone
    const cDropZone = document.getElementById('cDropZone');
    const cFiles = document.getElementById('cFiles');
    const cSelectedFiles = document.getElementById('cSelectedFiles');

    if (cDropZone && cFiles) {
        cDropZone.addEventListener('click', () => cFiles.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            cDropZone.addEventListener(eventName, preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            cDropZone.addEventListener(eventName, () => cDropZone.style.borderColor = '#3b82f6', false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            cDropZone.addEventListener(eventName, () => cDropZone.style.borderColor = '#cbd5e1', false);
        });

        const updateCSelectedFiles = () => {
            if (cFiles.files.length > 0) {
                let html = '<ul style="list-style:none; padding:0; margin:0;">';
                for (let i = 0; i < cFiles.files.length; i++) {
                    const f = cFiles.files[i];
                    html += `<li style="display:flex; align-items:center; gap:4px; margin-bottom:4px; color:#475569;"><i class="bx bx-file"></i> ${escapeHtml(f.name)} <span style="font-size:11px; color:#94a3b8;">(${fmtBytes(f.size)})</span></li>`;
                }
                html += '</ul>';
                cSelectedFiles.innerHTML = html;
            } else {
                cSelectedFiles.innerHTML = '';
            }
        };

        cDropZone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                cFiles.files = e.dataTransfer.files;
                updateCSelectedFiles();
            }
        });

        cFiles.addEventListener('change', updateCSelectedFiles);
    }
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
