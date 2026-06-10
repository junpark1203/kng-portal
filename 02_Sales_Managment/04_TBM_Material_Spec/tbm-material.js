/* TBM 자재 규격 관리 (tbm-material.js) */

// --- Auth Fetch ---
async function authFetch(url, opts = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, opts);
}

const API = 'https://kng.junparks.com/api/tbm';
let allData = [], filteredData = [], presetsData = [];
let currentSort = { column: 'updatedAt', asc: false };
let currentPage = 1, pageSize = 50;
let activeFilters = [], activeCategoryFilter = 'all';
let currentFiles = []; // files for modal
const fieldOptions = [['all','통합검색'],['site','현장명'],['equipment','장비명'],['category','분류'],['itemName','품목명'],['spec','규격/모델'],['manufacturer','제조사']];
const fieldLabels = { all:'통합검색', site:'현장명', equipment:'장비명', category:'분류', itemName:'품목명', spec:'규격/모델', manufacturer:'제조사' };
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => { initEvents(); loadPresets().then(() => loadData()); });

function initEvents() {
    $('btn-add-condition')?.addEventListener('click', () => KngSearchEngine.addConditionRow('search-conditions', fieldOptions));
    $('btn-clear-search')?.addEventListener('click', clearSearch);
    $('btn-do-search')?.addEventListener('click', doSearch);
    document.querySelector('#search-conditions .si-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    $('selectAll').addEventListener('change', e => document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked));
    $('addBtn').addEventListener('click', () => openModal());
    $('deleteBtn').addEventListener('click', deleteSelected);
    $('exportBtn').addEventListener('click', exportExcel);
    $('presetBtn').addEventListener('click', openPresetModal);
    $('closeModalBtn').addEventListener('click', closeModal);
    $('cancelBtn').addEventListener('click', closeModal);
    $('closePresetBtn').addEventListener('click', () => $('presetModal').classList.remove('active'));
    window.addEventListener('click', e => { if (e.target === $('itemModal')) closeModal(); if (e.target === $('presetModal')) $('presetModal').classList.remove('active'); });
    $('itemForm').addEventListener('submit', async e => { e.preventDefault(); await saveItem(); });
    ['inpQty','inpPrice'].forEach(id => $(id)?.addEventListener('input', updateCalc));
    $('inpCategory').addEventListener('change', onCategoryChange);
    // File upload
    const area = $('fileUploadArea'), inp = $('fileInput');
    area.addEventListener('click', () => inp.click());
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('dragover'); uploadFiles(e.dataTransfer.files); });
    inp.addEventListener('change', () => { if (inp.files.length) uploadFiles(inp.files); inp.value = ''; });
    // Preset modal
    $('addPresetCatBtn').addEventListener('click', addPresetCategory);
    $('addPresetFieldBtn').addEventListener('click', addPresetField);
    $('savePresetBtn').addEventListener('click', saveCurrentPreset);
    // Sort
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            currentSort.asc = currentSort.column === key ? !currentSort.asc : true;
            currentSort.column = key;
            updateSortUI(currentSort.column, currentSort.asc);
            applyFiltersAndSort();
        });
    });
}

function clearSearch() {
    const c = $('search-conditions');
    if (c) { c.innerHTML = ''; const row = document.createElement('div'); row.className = 'si-condition-row';
        row.innerHTML = `<select class="si-field-select" data-role="field">${fieldOptions.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><input type="text" class="si-search-input" data-role="query" placeholder="검색어 입력...">`;
        row.querySelector('.si-search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); }); c.appendChild(row); }
    activeFilters = []; activeCategoryFilter = 'all'; currentPage = 1; applyFiltersAndSort();
    $('categoryChips').querySelectorAll('.cat-chip').forEach(b => b.classList.toggle('active', b.dataset.cat === 'all'));
}

function doSearch() { activeFilters = KngSearchEngine.getConditionsFromBar('search-conditions'); currentPage = 1; applyFiltersAndSort(); }

// --- Data Loading ---
async function loadData() {
    try {
        const res = await authFetch(API + '/materials');
        if (!res.ok) throw new Error('fetch failed');
        allData = await res.json();
        buildCategoryChips(); updateDatalists(); applyFiltersAndSort();
    } catch(e) { console.error(e); $('tableBody').innerHTML = '<tr><td colspan="11" style="text-align:center;color:red;padding:30px;">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>'; }
}

async function loadPresets() {
    try {
        const res = await authFetch(API + '/presets');
        if (res.ok) presetsData = await res.json();
    } catch(e) { console.error(e); }
    updateCategorySelect();
}

function updateCategorySelect() {
    const sel = $('inpCategory');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 분류 선택 —</option>';
    presetsData.forEach(p => { const o = document.createElement('option'); o.value = p.category; o.textContent = p.category; sel.appendChild(o); });
    // Also allow categories from existing data
    const existing = new Set(presetsData.map(p => p.category));
    allData.forEach(d => { if (d.category && !existing.has(d.category)) { const o = document.createElement('option'); o.value = d.category; o.textContent = d.category; sel.appendChild(o); existing.add(d.category); } });
    sel.value = cur;
}

function buildCategoryChips() {
    const cats = new Set();
    allData.forEach(d => { if (d.category) cats.add(d.category); });
    presetsData.forEach(p => { if (p.category) cats.add(p.category); });
    const wrap = $('categoryChips');
    wrap.innerHTML = '<button class="cat-chip active" data-cat="all">전체</button>';
    [...cats].sort().forEach(cat => { wrap.innerHTML += `<button class="cat-chip" data-cat="${cat}">${cat}</button>`; });
    wrap.querySelectorAll('.cat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            wrap.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); activeCategoryFilter = btn.dataset.cat; currentPage = 1; applyFiltersAndSort();
        });
    });
}

function updateDatalists() {
    const sets = { site: new Set(), equipment: new Set(), itemName: new Set(), manufacturer: new Set() };
    allData.forEach(d => { Object.keys(sets).forEach(k => { if (d[k]) sets[k].add(d[k]); }); });
    Object.entries(sets).forEach(([k, s]) => {
        const dl = $('list' + k.charAt(0).toUpperCase() + k.slice(1));
        if (dl) dl.innerHTML = [...s].sort().map(v => `<option value="${v}">`).join('');
    });
}

// --- Filter & Sort ---
function applyFiltersAndSort() {
    filteredData = allData.filter(item => {
        if (activeCategoryFilter !== 'all' && item.category !== activeCategoryFilter) return false;
        if (activeFilters.length > 0 && !KngSearchEngine.matchesGroupConditions(item, activeFilters, false, ['site','equipment','category','itemName','spec','manufacturer'])) return false;
        return true;
    });
    const numCols = ['qty','price','total'];
    applySorting(filteredData, currentSort.column, currentSort.asc, [], numCols);
    KngSearchEngine.renderFilterChips('filter-chips', activeFilters, fieldLabels, idx => { activeFilters.splice(idx, 1); currentPage = 1; applyFiltersAndSort(); });
    updateKPI(); renderTable();
}

function updateKPI() {
    let tQty = 0, tAmt = 0; const eqSet = new Set();
    filteredData.forEach(d => { tQty += d.qty || 0; tAmt += d.total || 0; if (d.equipment) eqSet.add(d.equipment); });
    $('kpiCount').textContent = filteredData.length.toLocaleString();
    $('kpiQty').textContent = tQty.toLocaleString();
    $('kpiTotal').textContent = '₩' + tAmt.toLocaleString();
    $('kpiEquipments').textContent = eqSet.size;
}

// --- Render Table ---
function renderTable() {
    const el = $('tableBody');
    $('totalCount').textContent = `${filteredData.length}건`;
    $('selectAll').checked = false;
    if (!filteredData.length) { el.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--gray-400);">데이터가 없습니다.</td></tr>'; $('pagination').innerHTML = ''; return; }
    const pg = calcPagination(filteredData.length, currentPage, pageSize);
    currentPage = pg.page;
    const rows = filteredData.slice(pg.startIdx, pg.endIdx);
    let html = '';
    rows.forEach(d => {
        const catTag = d.category ? `<span class="cat-tag">${d.category}</span>` : '-';
        const filesArr = Array.isArray(d.files) ? d.files : [];
        const attachHtml = filesArr.length ? `<span class="attach-badge has-files"><i class='bx bx-paperclip'></i>${filesArr.length}</span>` : `<span class="attach-badge"><i class='bx bx-minus'></i></span>`;
        html += `<tr data-id="${d.id}">
            <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
            <td class="supply-col" onclick="openModal('${d.id}')">${d.site||'-'}</td>
            <td class="supply-col" onclick="openModal('${d.id}')">${d.equipment||'-'}</td>
            <td class="supply-col" onclick="openModal('${d.id}')">${catTag}</td>
            <td class="col-item product-col" onclick="openModal('${d.id}')">${d.itemName||'-'}</td>
            <td class="supply-col" onclick="openModal('${d.id}')">${d.spec||'-'}</td>
            <td class="supply-col" onclick="openModal('${d.id}')" style="text-align:center">${d.unit||'-'}</td>
            <td class="col-num-sm amount-col" onclick="openModal('${d.id}')">${fmtN(d.qty)}</td>
            <td class="col-num amount-col" onclick="openModal('${d.id}')">₩${fmtN(d.price)}</td>
            <td class="col-num amount-col total-highlight" onclick="openModal('${d.id}')">₩${fmtN(d.total)}</td>
            <td style="text-align:center" onclick="openModal('${d.id}')">${attachHtml}</td>
        </tr>`;
    });
    el.innerHTML = html;
    if (activeFilters.length) { const qs = activeFilters.map(f=>f.query).filter(Boolean); el.querySelectorAll('.supply-col,.product-col').forEach(el2 => { el2.innerHTML = KngSearchEngine.highlightText(el2.textContent, qs); }); }
    renderPagination({ container: $('pagination'), totalFiltered: filteredData.length, totalAll: allData.length, totalPages: pg.totalPages, currentPage, pageSize, startIdx: pg.startIdx, endIdx: pg.endIdx, onPageChange: p => { currentPage = p; renderTable(); }, onPageSizeChange: s => { pageSize = s; currentPage = 1; renderTable(); } });
}

function fmtN(n) { return (n === 0 || n == null) ? '0' : Number(n).toLocaleString(); }
function updateCalc() { const q = parseInt($('inpQty')?.value)||0, p = parseInt($('inpPrice')?.value)||0; $('inpTotal').value = (q*p) > 0 ? '₩'+(q*p).toLocaleString() : ''; }

// --- Modal CRUD ---
window.openModal = function(id = null) {
    $('itemForm').reset(); $('inpTotal').value = ''; currentFiles = [];
    $('customFieldsSection').style.display = 'none'; $('customFieldsGrid').innerHTML = '';
    renderFileList();
    if (id) {
        const d = allData.find(x => x.id === id);
        if (!d) return;
        $('modalTitle').textContent = '자재 규격 수정';
        $('editId').value = d.id;
        $('inpSite').value = d.site||''; $('inpEquipment').value = d.equipment||'';
        $('inpCategory').value = d.category||''; $('inpItemName').value = d.itemName||'';
        $('inpSpec').value = d.spec||''; $('inpUnit').value = d.unit||'EA';
        $('inpQty').value = d.qty||0; $('inpPrice').value = d.price||0;
        $('inpManufacturer').value = d.manufacturer||''; $('inpRemarks').value = d.remarks||'';
        currentFiles = Array.isArray(d.files) ? [...d.files] : [];
        updateCalc(); renderFileList();
        // Load custom fields
        if (d.category) { onCategoryChange(null, d.customFields || {}); }
    } else {
        $('modalTitle').textContent = '신규 자재 등록'; $('editId').value = '';
    }
    $('itemModal').classList.add('active');
};

function closeModal() { $('itemModal').classList.remove('active'); }

async function saveItem() {
    const id = $('editId').value;
    const customFields = {};
    $('customFieldsGrid').querySelectorAll('[data-cf-key]').forEach(inp => { customFields[inp.dataset.cfKey] = inp.value; });
    const payload = {
        site: $('inpSite').value.trim(), equipment: $('inpEquipment').value.trim(),
        category: $('inpCategory').value.trim(), itemName: $('inpItemName').value.trim(),
        spec: $('inpSpec').value.trim(), unit: $('inpUnit').value,
        qty: parseInt($('inpQty').value)||0, price: parseInt($('inpPrice').value)||0,
        manufacturer: $('inpManufacturer').value.trim(), remarks: $('inpRemarks').value.trim(),
        customFields, files: currentFiles
    };
    try {
        const url = id ? `${API}/materials/${id}` : `${API}/materials`;
        const method = id ? 'PUT' : 'POST';
        const res = await authFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) { showToast(id ? '수정되었습니다.' : '등록되었습니다.', 'success'); closeModal(); loadData(); }
        else { const err = await res.json(); showToast('저장 실패: '+err.error, 'error'); }
    } catch(e) { console.error(e); showToast('서버 연결 오류', 'error'); }
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (!ids.length) return showToast('삭제할 항목을 선택해주세요.', 'warning');
    if (!confirm(`선택한 ${ids.length}개 항목을 삭제하시겠습니까?`)) return;
    try {
        const res = await authFetch(`${API}/materials/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ids}) });
        if (res.ok) { showToast('삭제되었습니다.', 'success'); loadData(); }
        else { const err = await res.json(); showToast('삭제 실패: '+err.error, 'error'); }
    } catch(e) { console.error(e); showToast('서버 연결 오류', 'error'); }
}

// --- Custom Fields (Dynamic by Category) ---
function onCategoryChange(e, existingValues) {
    const cat = $('inpCategory').value;
    const section = $('customFieldsSection'), grid = $('customFieldsGrid');
    const preset = presetsData.find(p => p.category === cat);
    if (!preset || !preset.fields || !preset.fields.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
    section.style.display = '';
    $('customFieldsSectionTitle').textContent = `${cat} — 커스텀 필드`;
    grid.innerHTML = '';
    const vals = existingValues || {};
    preset.fields.forEach(f => {
        const div = document.createElement('div'); div.className = 'fg';
        const lbl = document.createElement('label'); lbl.textContent = f.label; lbl.setAttribute('for', 'cf-'+f.key);
        const inp = document.createElement('input'); inp.type = f.type || 'text'; inp.id = 'cf-'+f.key;
        inp.dataset.cfKey = f.key; inp.placeholder = f.label; inp.value = vals[f.key] || '';
        if (f.required) inp.required = true;
        div.appendChild(lbl); div.appendChild(inp); grid.appendChild(div);
    });
}

// --- File Upload ---
async function uploadFiles(fileList) {
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    try {
        showToast('파일 업로드 중...', 'info');
        const res = await authFetch(`${API}/files/upload`, { method:'POST', body: formData });
        if (res.ok) {
            const data = await res.json();
            data.files.forEach(f => currentFiles.push(f));
            renderFileList(); showToast('업로드 완료', 'success');
        } else { const err = await res.json(); showToast('업로드 실패: '+err.error, 'error'); }
    } catch(e) { console.error(e); showToast('업로드 오류', 'error'); }
}

function renderFileList() {
    const el = $('fileList'); el.innerHTML = '';
    currentFiles.forEach((f, i) => {
        const ext = (f.originalName || f.filename || '').split('.').pop().toLowerCase();
        let icon = 'bx-file';
        if (['pdf'].includes(ext)) icon = 'bx-file-blank';
        else if (['xlsx','xls','csv'].includes(ext)) icon = 'bx-spreadsheet';
        else if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) icon = 'bx-image';
        else if (['dwg','dxf'].includes(ext)) icon = 'bx-vector';
        else if (['zip','rar','7z'].includes(ext)) icon = 'bx-archive';
        const sizeStr = f.size ? (f.size < 1024*1024 ? Math.round(f.size/1024)+'KB' : (f.size/1024/1024).toFixed(1)+'MB') : '';
        const downloadUrl = f.url || `${API}/uploads/${f.filename}`;
        el.innerHTML += `<div class="file-item">
            <i class="bx ${icon} file-icon"></i>
            <span class="file-name">${f.originalName || f.filename}</span>
            <span class="file-size">${sizeStr}</span>
            <div class="file-actions">
                <a href="${downloadUrl}" target="_blank" download title="다운로드"><button type="button"><i class='bx bx-download'></i></button></a>
                <button type="button" class="file-delete-btn" onclick="removeFile(${i})" title="삭제"><i class='bx bx-trash'></i></button>
            </div>
        </div>`;
    });
}

window.removeFile = function(idx) {
    if (confirm('이 파일을 삭제하시겠습니까?')) {
        const f = currentFiles[idx];
        // Delete from server
        authFetch(`${API}/files/${f.filename}`, {method:'DELETE'}).catch(()=>{});
        currentFiles.splice(idx, 1); renderFileList();
    }
};

// --- Preset Modal ---
let selectedPresetId = null;

function openPresetModal() {
    $('presetModal').classList.add('active');
    renderPresetList(); selectedPresetId = null;
    $('presetNoSelection').style.display = ''; $('presetEditorContent').style.display = 'none';
}

function renderPresetList() {
    const el = $('presetList'); el.innerHTML = '';
    presetsData.forEach(p => {
        const div = document.createElement('div'); div.className = 'preset-item' + (p.id === selectedPresetId ? ' active' : '');
        div.innerHTML = `<span>${p.category}</span><button class="preset-delete-btn" title="삭제"><i class='bx bx-trash'></i></button>`;
        div.querySelector('span').addEventListener('click', () => selectPreset(p.id));
        div.querySelector('.preset-delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`"${p.category}" 분류를 삭제하시겠습니까?`)) return;
            try { await authFetch(`${API}/presets/${p.id}`, {method:'DELETE'}); await loadPresets(); renderPresetList();
                if (selectedPresetId === p.id) { selectedPresetId = null; $('presetNoSelection').style.display = ''; $('presetEditorContent').style.display = 'none'; }
                showToast('삭제되었습니다.', 'success');
            } catch(e2) { showToast('삭제 실패', 'error'); }
        });
        el.appendChild(div);
    });
}

function selectPreset(id) {
    selectedPresetId = id;
    const p = presetsData.find(x => x.id === id);
    if (!p) return;
    $('presetNoSelection').style.display = 'none'; $('presetEditorContent').style.display = '';
    $('presetEditorTitle').textContent = `"${p.category}" 필드 설정`;
    renderPresetList();
    const list = $('presetFieldList'); list.innerHTML = '';
    (p.fields || []).forEach((f, i) => addPresetFieldRow(f, i));
}

function addPresetFieldRow(fieldData, idx) {
    const list = $('presetFieldList');
    const row = document.createElement('div'); row.className = 'preset-field-row';
    const order = idx !== undefined ? idx + 1 : list.children.length + 1;
    row.innerHTML = `<span class="field-order">${order}</span>
        <textarea class="pf-label" placeholder="필드명 (예: 치수&#10;Dimension)" rows="2">${fieldData?.label||''}</textarea>
        <select class="pf-type"><option value="text"${fieldData?.type==='text'?' selected':''}>텍스트</option><option value="number"${fieldData?.type==='number'?' selected':''}>숫자</option></select>
        <button type="button" class="field-remove-btn"><i class='bx bx-x'></i></button>`;
    row.querySelector('.field-remove-btn').addEventListener('click', () => { row.remove(); reorderFields(); });
    list.appendChild(row);
}

function addPresetField() { addPresetFieldRow(null); }

function reorderFields() { $('presetFieldList').querySelectorAll('.preset-field-row').forEach((r,i) => r.querySelector('.field-order').textContent = i+1); }

async function saveCurrentPreset() {
    if (!selectedPresetId) return;
    const p = presetsData.find(x => x.id === selectedPresetId);
    if (!p) return;
    const fields = [];
    $('presetFieldList').querySelectorAll('.preset-field-row').forEach(row => {
        const label = row.querySelector('.pf-label').value.trim();
        const type = row.querySelector('.pf-type').value;
        if (label) { const key = label.replace(/[^a-zA-Z0-9가-힣]/g,'_').toLowerCase() || 'field_'+fields.length; fields.push({key, label, type}); }
    });
    const payload = { id: p.id, category: p.category, fields };
    try {
        const res = await authFetch(`${API}/presets`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        if (res.ok) { showToast('프리셋 저장 완료', 'success'); await loadPresets(); selectPreset(selectedPresetId); }
        else { showToast('저장 실패', 'error'); }
    } catch(e) { showToast('서버 오류', 'error'); }
}

function addPresetCategory() {
    const name = prompt('새 분류명을 입력하세요:');
    if (!name || !name.trim()) return;
    const id = 'TBMFP-' + Date.now() + '-' + Math.random().toString(36).substring(2,6);
    const payload = { id, category: name.trim(), fields: [] };
    authFetch(`${API}/presets`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
        .then(async res => { if (res.ok) { showToast('분류 추가 완료', 'success'); await loadPresets(); renderPresetList(); selectPreset(id); } else showToast('추가 실패', 'error'); })
        .catch(() => showToast('서버 오류', 'error'));
}

// --- Excel Export ---
function exportExcel() {
    if (!filteredData.length) return showToast('내보낼 데이터가 없습니다.', 'warning');
    const rows = filteredData.map(d => {
        const row = { '현장명': d.site, '장비명': d.equipment, '분류': d.category, '품목명': d.itemName, '규격/모델': d.spec, '단위': d.unit, '수량': d.qty, '단가': d.price, '합계': d.total, '제조사': d.manufacturer, '비고': d.remarks };
        // Add custom fields
        if (d.customFields && typeof d.customFields === 'object') { Object.entries(d.customFields).forEach(([k,v]) => { row[k] = v; }); }
        return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TBM 자재 규격');
    XLSX.writeFile(wb, `TBM_자재규격_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('엑셀 파일이 다운로드됩니다.', 'success');
}
