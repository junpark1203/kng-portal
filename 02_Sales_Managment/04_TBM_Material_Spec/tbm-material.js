/* TBM 자재 규격 관리 (tbm-material.js) */

// --- Auth Fetch (with retry for iframe auth race condition) ---
async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, opts);
    if (res.status === 401 && _retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return authFetch(url, opts, _retries - 1);
    }
    return res;
}

const API = 'https://kng.junparks.com/api/tbm';
window.exchangeRates = {};
let allData = [], filteredData = [], presetsData = [];
let currentSort = { column: 'createdAt', asc: false };
let currentPage = 1, pageSize = 30;
let activeFilters = [], activeCategoryFilter = 'all';
let currentFiles = [];
let activeFieldFilters = {}; // {fieldKey: searchValue}
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
    $('compareBtn').addEventListener('click', openCompare);
    $('presetBtn').addEventListener('click', openPresetDrawer);
    $('closeModalBtn').addEventListener('click', confirmCloseModal);
    $('cancelBtn').addEventListener('click', confirmCloseModal);
    $('closeDrawerBtn').addEventListener('click', closePresetDrawer);
    $('closeDrawerBtn2').addEventListener('click', closePresetDrawer);
    $('closeCompareBtn').addEventListener('click', () => $('compareModal').classList.remove('active'));
    $('closeCompareBtn2').addEventListener('click', () => $('compareModal').classList.remove('active'));
    $('compareExportBtn').addEventListener('click', exportCompare);
    // Track mousedown to prevent close when dragging text outside modal
    let mouseDownTarget = null;
    window.addEventListener('mousedown', e => { mouseDownTarget = e.target; });
    window.addEventListener('click', e => {
        if (mouseDownTarget !== e.target) { mouseDownTarget = null; return; }
        if (e.target===$('itemModal')) confirmCloseModal();
        if (e.target===$('drawerOverlay')) closePresetDrawer();
        if (e.target===$('compareModal')) $('compareModal').classList.remove('active');
        mouseDownTarget = null;
    });
    $('itemForm').addEventListener('submit', async e => { e.preventDefault(); await saveItem(); });
    ['inpQty','inpPrice'].forEach(id => $(id)?.addEventListener('input', updateCalc));
    $('inpCategory').addEventListener('change', onCategoryChange);
    // Source type toggle
    document.querySelectorAll('input[name="sourceType"]').forEach(r => r.addEventListener('change', toggleSourceType));
    $('addPkgGroupBtn').addEventListener('click', () => addPackagingGroup());
    // Sort dropdown
    $('sortSelect').addEventListener('change', () => { const [col,dir] = $('sortSelect').value.split('-'); currentSort = {column:col, asc:dir==='asc'}; applyFiltersAndSort(); });
    // File upload
    const area = $('fileUploadArea'), inp = $('fileInput');
    area.addEventListener('click', () => inp.click());
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('dragover'); uploadFiles(e.dataTransfer.files); });
    inp.addEventListener('change', () => { if (inp.files.length) uploadFiles(inp.files); inp.value = ''; });
    // Preset drawer
    $('addDrawerCatBtn').addEventListener('click', addPresetCategory);
    $('addDrawerSectionBtn').addEventListener('click', addSectionCard);
    $('saveDrawerBtn').addEventListener('click', saveCurrentPreset);
    // Sidebar field search
    $('sidebarFieldSearchBtn').addEventListener('click', doFieldSearch);
    $('sidebarFieldResetBtn').addEventListener('click', () => { activeFieldFilters={}; $('sidebarFieldInput').value=''; applyFiltersAndSort(); });
    $('sidebarFieldInput').addEventListener('keydown', e => { if(e.key==='Enter') doFieldSearch(); });
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
        const [res, rateRes] = await Promise.all([
            authFetch(API + '/materials'),
            authFetch('https://kng.junparks.com/api/exchange-rates').catch(() => ({ok: false}))
        ]);
        if (!res.ok) throw new Error('fetch failed');
        allData = await res.json();
        if (rateRes.ok) {
            window.exchangeRates = await rateRes.json();
            updateExchangeRateUI();
        }
        renderSidebar(); updateDatalists(); applyFiltersAndSort();
    } catch(e) { console.error(e); $('cardList').innerHTML = '<div class="tbm-empty-cards" style="color:red;"><i class="bx bx-error-circle"></i>데이터를 불러오는 중 오류가 발생했습니다.</div>'; }
}

function updateExchangeRateUI() {
    const el = $('exchangeRateDisplay');
    if (!el) return;
    if (window.exchangeRates && window.exchangeRates['USD']) {
        const usdKrw = Math.round(1 / window.exchangeRates['USD']);
        el.innerHTML = `<i class='bx bx-money'></i> 오늘 환율: 1 USD = ${usdKrw.toLocaleString()} 원`;
    } else {
        el.innerHTML = `<i class='bx bx-money'></i> 환율 정보 없음`;
    }
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

function renderSidebar() {
    const cats = new Map(); // cat -> count
    allData.forEach(d => { if(d.category) cats.set(d.category, (cats.get(d.category)||0)+1); });
    presetsData.forEach(p => { if(p.category && !cats.has(p.category)) cats.set(p.category,0); });
    const totalCount = allData.length;
    const el = $('sidebarCatList');
    let html = `<div class="sidebar-cat-item${activeCategoryFilter==='all'?' active':''}" data-cat="all"><span>전체</span><span class="sidebar-cat-count">${totalCount}</span></div>`;
    [...cats.keys()].sort().forEach(cat => {
        html += `<div class="sidebar-cat-item${activeCategoryFilter===cat?' active':''}" data-cat="${cat}"><span>${cat}</span><span class="sidebar-cat-count">${cats.get(cat)}</span></div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll('.sidebar-cat-item').forEach(item => {
        item.addEventListener('click', () => {
            activeCategoryFilter = item.dataset.cat;
            activeFieldFilters = {};
            currentPage = 1;
            renderSidebar();
            renderSidebarFields();
            applyFiltersAndSort();
        });
    });
    renderSidebarFields();
}

function renderSidebarFields() {
    const section = $('sidebarFieldSection');
    const list = $('sidebarFieldList');
    if (activeCategoryFilter === 'all') { section.style.display = 'none'; return; }
    const preset = presetsData.find(p => p.category === activeCategoryFilter);
    if (!preset || !preset.fields || !preset.fields.length) { section.style.display = 'none'; return; }
    section.style.display = '';
    let html = '';
    preset.fields.forEach(f => {
        if (f.type === 'section') return;
        const lbl = (f.label||'').replace(/\n/g,' / ');
        html += `<div class="sidebar-field-row"><input type="checkbox" data-field-key="${f.key}" ${activeFieldFilters[f.key]?'checked':''}><label>${lbl}</label></div>`;
    });
    list.innerHTML = html;
}

function doFieldSearch() {
    activeFieldFilters = {};
    const val = $('sidebarFieldInput').value.trim();
    $('sidebarFieldList').querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
        activeFieldFilters[cb.dataset.fieldKey] = val;
    });
    currentPage = 1;
    applyFiltersAndSort();
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
        // Field search filters
        for (const [key, val] of Object.entries(activeFieldFilters)) {
            if (!val) continue;
            const cf = item.customFields || {};
            const cfVal = String(cf[key] || '').toLowerCase();
            if (!cfVal.includes(val.toLowerCase())) return false;
        }
        return true;
    });
    const numCols = ['qty','price','total'];
    applySorting(filteredData, currentSort.column, currentSort.asc, [], numCols);
    KngSearchEngine.renderFilterChips('filter-chips', activeFilters, fieldLabels, idx => { activeFilters.splice(idx, 1); currentPage = 1; applyFiltersAndSort(); });
    updateKPI(); renderCards();
}

function updateKPI() {
    let tQty = 0; const eqSet = new Set();
    filteredData.forEach(d => { tQty += d.qty || 0; if (d.equipment) eqSet.add(d.equipment); });
    $('kpiCount').textContent = filteredData.length.toLocaleString();
    $('kpiQty').textContent = tQty.toLocaleString();
    $('kpiEquipments').textContent = eqSet.size;
}

// --- Render Cards ---
function renderCards() {
    const el = $('cardList');
    $('totalCount').textContent = `${filteredData.length}건`;
    $('selectAll').checked = false;
    if (!filteredData.length) { el.innerHTML = '<div class="tbm-empty-cards"><i class="bx bx-package"></i>데이터가 없습니다.</div>'; $('pagination').innerHTML=''; return; }
    const pg = calcPagination(filteredData.length, currentPage, pageSize);
    currentPage = pg.page;
    const rows = filteredData.slice(pg.startIdx, pg.endIdx);
    const imgExts = ['jpg','jpeg','png','gif','webp','bmp'];
    let html = '';
    rows.forEach((d, idx) => {
        const num = pg.startIdx + idx + 1;
        const filesArr = Array.isArray(d.files) ? d.files : [];
        const thumbFile = filesArr.find(f => { const ext = (f.originalName||f.filename||'').split('.').pop().toLowerCase(); return imgExts.includes(ext); });
        const thumbHtml = thumbFile ? `<img src="${thumbFile.url||API+'/uploads/'+thumbFile.filename}" alt="${d.itemName||''}">` : `<div class="no-image"><i class='bx bx-image'></i><br>이미지 없음</div>`;
        // Custom fields rendering — group by section
        let fieldsHtml = '';
        const preset = presetsData.find(p => p.category === d.category);
        const cfNotes = d.customFieldNotes || {};
        if (preset && preset.fields && d.customFields) {
            let currentGroup = '';
            preset.fields.forEach(f => {
                if (f.type === 'section') {
                    if (currentGroup) currentGroup += '</div></div>';
                    currentGroup += `<div class="tbm-cf-group"><div class="tbm-cf-section-label">【${(f.label||'').replace(/\n/g,' / ')}】</div><div class="tbm-cf-values">`;
                } else {
                    const v = d.customFields[f.key];
                    if (v) {
                        if (!currentGroup) currentGroup = '<div class="tbm-cf-group"><div class="tbm-cf-values">';
                        const noteStr = cfNotes[f.key] ? `<em class="cf-note-badge" title="${cfNotes[f.key]}">${cfNotes[f.key]}</em>` : '';
                        currentGroup += `<span><b>${(f.label||'').replace(/\n/g,' ')}:</b> ${v}${noteStr}</span> `;
                    }
                }
            });
            if (currentGroup) currentGroup += '</div></div>';
            if (currentGroup) fieldsHtml = `<div class="tbm-card-fields">${currentGroup}</div>`;
        }
        const dateStr = d.updatedAt ? new Date(d.updatedAt).toLocaleDateString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit'}) : '';
        const fileCount = filesArr.length;
        const attachHtml = fileCount ? `<span class="attach-badge has-files"><i class='bx bx-paperclip'></i> ${fileCount}개 파일</span>` : '';
        html += `<div class="tbm-card" data-id="${d.id}">
            <div class="tbm-card-header" onclick="openModal('${d.id}')">
                <div class="tbm-card-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></div>
                <span class="tbm-card-rank">${num}</span>
                <div class="tbm-card-title-area">
                    <span class="tbm-card-name">${d.itemName||'-'}</span>
                    ${d.manufacturer?`<span class="tbm-card-mfr">| ${d.manufacturer}</span>`:''}
                </div>
                <button class="tbm-card-toggle" onclick="event.stopPropagation(); toggleCard(this)">닫기 <i class='bx bx-chevron-up'></i></button>
            </div>
            <div class="tbm-card-body">
                <div class="tbm-card-thumb" onclick="openModal('${d.id}')">${thumbHtml}</div>
                <div class="tbm-card-detail" onclick="openModal('${d.id}')">
                    <div class="tbm-card-basic">
                        ${d.category?`<span class="cat-tag">${d.category}</span>`:''}
                        ${d.spec?`<span>규격: ${d.spec}</span>`:''}
                    </div>
                    ${fieldsHtml}
                    <div class="tbm-card-meta">
                        ${d.site?`<span>현장: ${d.site}</span>`:''}
                        ${d.equipment?`<span>장비: ${d.equipment}</span>`:''}
                        <span>수량: ${d.qty||0} ${d.unit||'EA'}</span>
                    </div>
                    <div class="tbm-card-meta">
                        ${d.sourceType === 'import' ? buildImportPriceHtml(d) : `<span class="tbm-card-total">단가: ₩${fmtN(d.price)}${d.price > 0 ? ' <em style="font-size:10px;color:var(--gray-400);font-style:normal">(국내)</em>':''}</span><span>합계: ₩${fmtN(d.total)}</span>`}
                        ${d.quoteDate?`<span>견적일: ${d.quoteDate}</span>`:''}
                    </div>
                    <div class="tbm-card-footer">
                        ${attachHtml}
                        <span class="tbm-card-date">등록: ${dateStr}</span>
                    </div>
                </div>
            </div>
        </div>`;
    });
    el.innerHTML = html;
    renderPagination({container:$('pagination'),totalFiltered:filteredData.length,totalAll:allData.length,totalPages:pg.totalPages,currentPage,pageSize,startIdx:pg.startIdx,endIdx:pg.endIdx,onPageChange:p=>{currentPage=p;renderCards();},onPageSizeChange:s=>{pageSize=s;currentPage=1;renderCards();}});
}

window.toggleCard = function(btn) {
    const card = btn.closest('.tbm-card');
    card.classList.toggle('collapsed');
    btn.innerHTML = card.classList.contains('collapsed') ? '열기 <i class="bx bx-chevron-down"></i>' : '닫기 <i class="bx bx-chevron-up"></i>';
};

function fmtN(n) { return (n === 0 || n == null) ? '0' : Number(n).toLocaleString(); }

function formatKrwApprox(price, currency) {
    if (currency === 'KRW' || !window.exchangeRates || !window.exchangeRates[currency]) return '';
    const krwValue = price * (1 / window.exchangeRates[currency]);
    return ` <em style="font-size:10px;color:#9ca3af;font-style:normal">(약 ₩${fmtN(Math.round(krwValue))})</em>`;
}

function buildImportPriceHtml(d) {
    const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
    // Backward compat: fallback to old flat incoterms
    if (!groups.length) {
        const its = Array.isArray(d.incoterms) ? d.incoterms : [];
        if (!its.length) return '<span class="tbm-card-total">가격 미입력 <em style="font-size:10px;color:#f59e0b;font-style:normal">(수입)</em></span>';
        const basis = d.perUnitBasis ? ` (${d.perUnitBasis}개 기준)` : '';
        return its.map(it => {
            const sym = currencySymbol(it.currency || 'KRW');
            const priceStr = (it.currency && it.currency !== 'KRW') ? `${sym}${fmtDec(it.price)}` : `₩${fmtN(it.price)}`;
            const approxKrw = formatKrwApprox(it.price, it.currency || 'KRW');
            return `<span class="tbm-card-total" style="color:#f59e0b">${it.term}: ${priceStr}${approxKrw}${basis}</span>`;
        }).join('') + ' <em style="font-size:10px;color:#f59e0b;font-style:normal">(수입)</em>';
    }
    return groups.map(g => {
        const label = g.packaging || '미지정';
        const unitStr = g.unit ? ` ${g.unit}` : '';
        const qtyStr = g.qty ? ` · 수량: ${fmtDec(g.qty)}${unitStr}` : '';
        const itsHtml = (g.incoterms || []).map(it => {
            const sym = currencySymbol(it.currency || 'KRW');
            const priceStr = (it.currency && it.currency !== 'KRW') ? `${sym}${fmtDec(it.price)}` : `₩${fmtN(it.price)}`;
            const approxKrw = formatKrwApprox(it.price, it.currency || 'KRW');
            return `<span class="tbm-card-total" style="color:#f59e0b">${it.term}: ${priceStr}${approxKrw}</span>`;
        }).join('');
        return `<div style="margin-bottom:4px;"><span style="font-size:10px;font-weight:600;color:#92400e;">📦 ${label}${qtyStr}</span><br>${itsHtml || '<span style="font-size:10px;color:var(--gray-400);">가격 미입력</span>'}</div>`;
    }).join('') + ' <em style="font-size:10px;color:#f59e0b;font-style:normal">(수입)</em>';
}
function updateCalc() { const q = parseInt($('inpQty')?.value)||0, p = parseInt($('inpPrice')?.value)||0; $('inpTotal').value = (q*p) > 0 ? '₩'+(q*p).toLocaleString() : ''; }

const INCOTERMS_LIST = ['EXW','FCA','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'];
const CURRENCY_LIST = [
    { code: 'USD', symbol: '$', label: 'USD ($)' },
    { code: 'CNY', symbol: '¥', label: 'CNY (¥)' },
    { code: 'EUR', symbol: '€', label: 'EUR (€)' },
    { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
    { code: 'KRW', symbol: '₩', label: 'KRW (₩)' },
    { code: 'GBP', symbol: '£', label: 'GBP (£)' },
];
function currencySymbol(code) { return (CURRENCY_LIST.find(c => c.code === code) || {}).symbol || code + ' '; }
function fmtDec(n) { if (n == null || n === 0) return '0'; return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 }); }

function toggleSourceType() {
    const isImport = $('srcImport').checked;
    $('domesticFields').style.display = isImport ? 'none' : '';
    $('importFields').style.display = isImport ? '' : 'none';
}

// ── Packaging Group Functions ──
function addPackagingGroup(data) {
    const container = $('packagingGroupsContainer');
    const group = document.createElement('div');
    group.className = 'pkg-group';
    group.innerHTML = `
        <div class="pkg-group-header">
            <i class='bx bx-package pkg-icon'></i>
            <input type="text" class="pkg-name" placeholder="포장단위 입력 (예: Drum 200L, Bulk, IBC 등)" value="${data?.packaging || ''}">
            <button type="button" class="pkg-del" title="삭제"><i class='bx bx-trash'></i></button>
        </div>
        <div class="pkg-group-body">
            <div class="pkg-meta">
                <div class="fg">
                    <label>수량</label>
                    <input type="number" class="pkg-qty" placeholder="0" min="0" step="any" value="${data?.qty || ''}">
                </div>
                <div class="fg">
                    <label>단위</label>
                    <select class="pkg-unit">
                        ${['EA','SET','BOX','M','KG','L','TON','ROLL','DRUM','IBC','BAG','PAIL'].map(u => `<option value="${u}"${u===(data?.unit||'EA')?' selected':''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="pkg-incoterms"></div>
            <button type="button" class="add-incoterm-btn pkg-add-it">
                <i class='bx bx-plus'></i> Incoterms 추가
            </button>
        </div>`;
    // Delete
    group.querySelector('.pkg-del').addEventListener('click', () => {
        if (confirm('이 포장단위 그룹을 삭제하시겠습니까?')) group.remove();
    });
    // Add incoterm
    group.querySelector('.pkg-add-it').addEventListener('click', () => {
        addIncotermToGroup(group);
    });
    container.appendChild(group);
    // Populate existing incoterms
    if (data?.incoterms?.length) {
        data.incoterms.forEach(it => addIncotermToGroup(group, it.term, it.price, it.currency));
    }
    return group;
}

function addIncotermToGroup(groupEl, term, price, currency) {
    const container = groupEl.querySelector('.pkg-incoterms');
    const row = document.createElement('div');
    row.className = 'incoterm-row';
    row.innerHTML = `
        <select class="it-term">${INCOTERMS_LIST.map(t => `<option value="${t}"${t===term?' selected':''}>${t}</option>`).join('')}</select>
        <select class="it-currency">${CURRENCY_LIST.map(c => `<option value="${c.code}"${c.code===(currency||'USD')?' selected':''}>${c.label}</option>`).join('')}</select>
        <input type="number" class="it-price" placeholder="가격" min="0" step="any" value="${price||''}">
        <button type="button" class="it-del" title="삭제"><i class='bx bx-x'></i></button>`;
    row.querySelector('.it-del').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function collectPackagingGroups() {
    const groups = [];
    $('packagingGroupsContainer').querySelectorAll('.pkg-group').forEach(g => {
        const packaging = g.querySelector('.pkg-name').value.trim();
        const qty = parseFloat(g.querySelector('.pkg-qty').value) || 0;
        const unit = g.querySelector('.pkg-unit').value || 'EA';
        const incoterms = [];
        g.querySelectorAll('.incoterm-row').forEach(r => {
            const term = r.querySelector('.it-term').value;
            const currency = r.querySelector('.it-currency').value;
            const p = parseFloat(r.querySelector('.it-price').value) || 0;
            if (term && p > 0) incoterms.push({ term, price: p, currency });
        });
        groups.push({ packaging, qty, unit, incoterms });
    });
    return groups;
}

// --- Modal CRUD ---
let modalSnapshot = '';

function getFormSnapshot() {
    const vals = ['inpSite','inpEquipment','inpCategory','inpItemName','inpSpec','inpUnit','inpQty','inpPrice','inpManufacturer','inpRemarks','inpQuoteDate'].map(id => $(id)?.value || '');
    const src = document.querySelector('input[name="sourceType"]:checked')?.value || 'domestic';
    const cfVals = [];
    $('customFieldsGrid').querySelectorAll('[data-cf-key]').forEach(inp => cfVals.push(inp.value || ''));
    const cfNoteVals = [];
    $('customFieldsGrid').querySelectorAll('[data-cf-note-key]').forEach(inp => cfNoteVals.push(inp.value || ''));
    // Packaging groups snapshot
    const pkgSnap = JSON.stringify(collectPackagingGroups());
    return JSON.stringify([...vals, src, ...cfVals, ...cfNoteVals, pkgSnap, currentFiles.length]);
}

window.openModal = function(id = null) {
    $('itemForm').reset(); $('inpTotal').value = ''; currentFiles = [];
    $('customFieldsSection').style.display = 'none'; $('customFieldsGrid').innerHTML = '';
    $('packagingGroupsContainer').innerHTML = '';
    $('srcDomestic').checked = true; toggleSourceType();
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
        $('inpQuoteDate').value = d.quoteDate || '';
        currentFiles = Array.isArray(d.files) ? [...d.files] : [];
        // Source type
        if (d.sourceType === 'import') {
            $('srcImport').checked = true; toggleSourceType();
            // Load packaging groups (with backward compat for old flat incoterms)
            const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
            if (groups.length) {
                groups.forEach(g => addPackagingGroup(g));
            } else {
                // Migrate old flat incoterms to a single default packaging group
                const oldIts = Array.isArray(d.incoterms) ? d.incoterms : [];
                if (oldIts.length || d.qty) {
                    addPackagingGroup({ packaging: '', qty: d.qty || 0, unit: d.unit || 'EA', incoterms: oldIts });
                }
            }
        }
        updateCalc(); renderFileList();
        if (d.category) { onCategoryChange(null, d.customFields || {}, d.customFieldNotes || {}); }
    } else {
        $('modalTitle').textContent = '신규 자재 등록'; $('editId').value = '';
    }
    $('itemModal').classList.add('active');
    requestAnimationFrame(() => { modalSnapshot = getFormSnapshot(); });
};

function confirmCloseModal() {
    const changed = getFormSnapshot() !== modalSnapshot;
    if (!changed || confirm('변경된 내용이 있습니다. 정말 닫으시겠습니까?')) {
        closeModal();
    }
}

function closeModal() { $('itemModal').classList.remove('active'); }

async function saveItem() {
    const id = $('editId').value;
    const customFields = {};
    $('customFieldsGrid').querySelectorAll('[data-cf-key]').forEach(inp => { customFields[inp.dataset.cfKey] = inp.value; });
    const customFieldNotes = {};
    $('customFieldsGrid').querySelectorAll('[data-cf-note-key]').forEach(inp => { if (inp.value.trim()) customFieldNotes[inp.dataset.cfNoteKey] = inp.value.trim(); });
    const sourceType = document.querySelector('input[name="sourceType"]:checked')?.value || 'domestic';
    const isImport = sourceType === 'import';
    const qty = isImport ? 0 : (parseInt($('inpQty').value)||0);
    const price = isImport ? 0 : (parseInt($('inpPrice').value)||0);
    // Collect packaging groups
    const packagingGroups = isImport ? collectPackagingGroups() : [];
    // For backward compat, also flatten incoterms from first group
    const incoterms = packagingGroups.length ? packagingGroups[0].incoterms || [] : [];
    const perUnitBasis = 0;
    const payload = {
        site: $('inpSite').value.trim(), equipment: $('inpEquipment').value.trim(),
        category: $('inpCategory').value.trim(), itemName: $('inpItemName').value.trim(),
        spec: $('inpSpec').value.trim(), unit: $('inpUnit').value,
        qty, price,
        manufacturer: $('inpManufacturer').value.trim(), remarks: $('inpRemarks').value.trim(),
        customFields, customFieldNotes, files: currentFiles,
        sourceType,
        quoteDate: $('inpQuoteDate').value || '',
        perUnitBasis,
        incoterms,
        packagingGroups
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
function onCategoryChange(e, existingValues, existingNotes) {
    const cat = $('inpCategory').value;
    const section = $('customFieldsSection'), grid = $('customFieldsGrid');
    const preset = presetsData.find(p => p.category === cat);
    if (!preset || !preset.fields || !preset.fields.length) { section.style.display = 'none'; grid.innerHTML = ''; return; }
    section.style.display = '';
    $('customFieldsSectionTitle').textContent = `${cat} — 커스텀 필드`;
    grid.innerHTML = '';
    const vals = existingValues || {};
    const notes = existingNotes || {};
    preset.fields.forEach(f => {
        if (f.type === 'section') {
            const divider = document.createElement('div');
            divider.className = 'cf-section-divider';
            divider.innerHTML = `<i class='bx bx-chevrons-right'></i> ${(f.label || '').replace(/\n/g, '<br>')}`;
            grid.appendChild(divider);
            return;
        }
        const div = document.createElement('div'); div.className = 'fg cf-with-note';
        const lbl = document.createElement('label');
        lbl.innerHTML = (f.label || '').replace(/\n/g, '<br>');
        lbl.setAttribute('for', 'cf-'+f.key);
        // Preset note hint (from preset manager)
        const presetNote = f.note ? `<span class="cf-preset-hint" title="${f.note}">${f.note}</span>` : '';
        if (presetNote) { const hint = document.createElement('span'); hint.className = 'cf-preset-hint'; hint.title = f.note; hint.textContent = f.note; lbl.appendChild(hint); }
        const inp = document.createElement('input'); inp.type = f.type || 'text'; inp.id = 'cf-'+f.key;
        inp.dataset.cfKey = f.key; inp.placeholder = (f.label || '').replace(/\n/g, ' '); inp.value = vals[f.key] || '';
        if (f.required) inp.required = true;
        // Per-material note input
        const noteInp = document.createElement('input'); noteInp.type = 'text';
        noteInp.className = 'cf-note-input'; noteInp.placeholder = '비고 (Testing method 등)';
        noteInp.dataset.cfNoteKey = f.key; noteInp.value = notes[f.key] || '';
        div.appendChild(lbl); div.appendChild(inp); div.appendChild(noteInp); grid.appendChild(div);
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

// --- Preset Drawer ---
let selectedPresetId = null;

function openPresetDrawer() {
    $('drawerOverlay').classList.add('active');
    $('presetDrawer').classList.add('open');
    renderDrawerCategories();
    selectedPresetId = null;
    $('drawerNoSelection').style.display = '';
    $('drawerEditorContent').style.display = 'none';
}

function closePresetDrawer() {
    $('drawerOverlay').classList.remove('active');
    $('presetDrawer').classList.remove('open');
}

function renderDrawerCategories() {
    const el = $('drawerCatList'); el.innerHTML = '';
    presetsData.forEach(p => {
        const chip = document.createElement('button');
        chip.className = 'drawer-cat-chip' + (p.id === selectedPresetId ? ' active' : '');
        chip.innerHTML = `<span>${p.category}</span><i class='bx bx-x cat-del'></i>`;
        chip.querySelector('span').addEventListener('click', () => selectDrawerPreset(p.id));
        chip.querySelector('.cat-del').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm(`"${p.category}" 분류를 삭제하시겠습니까?`)) return;
            try {
                await authFetch(`${API}/presets/${p.id}`, {method:'DELETE'});
                await loadPresets();
                if (selectedPresetId === p.id) { selectedPresetId = null; $('drawerNoSelection').style.display = ''; $('drawerEditorContent').style.display = 'none'; }
                renderDrawerCategories();
                showToast('삭제되었습니다.', 'success');
            } catch(e2) { showToast('삭제 실패', 'error'); }
        });
        el.appendChild(chip);
    });
}

/* Group flat fields array into sections for visual editing */
function groupFieldsIntoSections(fields) {
    const sections = [];
    let cur = null;
    (fields || []).forEach(f => {
        if (f.type === 'section') {
            cur = { label: f.label || '', fields: [] };
            sections.push(cur);
        } else {
            if (!cur) { cur = { label: '기본 필드', fields: [] }; sections.push(cur); }
            cur.fields.push({ key: f.key, label: f.label || '', type: f.type || 'text', note: f.note || '' });
        }
    });
    return sections;
}

/* Flatten section cards back to flat array for storage */
function flattenSections() {
    const fields = [];
    $('drawerSectionList').querySelectorAll('.section-card').forEach(card => {
        const secLabel = card.querySelector('.sec-label').value.trim();
        fields.push({ key: '_section_' + fields.length, label: secLabel || '섹션', type: 'section' });
        card.querySelectorAll('.sec-field-row').forEach(row => {
            const label = row.querySelector('.sf-label').value.trim();
            const type = row.querySelector('.sf-type').value;
            const note = row.querySelector('.sf-note')?.value.trim() || '';
            if (label) {
                const key = label.replace(/[^a-zA-Z0-9가-힣]/g, '_').toLowerCase() || 'field_' + fields.length;
                fields.push({ key, label, type, note });
            }
        });
    });
    return fields;
}

function selectDrawerPreset(id) {
    selectedPresetId = id;
    const p = presetsData.find(x => x.id === id);
    if (!p) return;
    $('drawerNoSelection').style.display = 'none';
    $('drawerEditorContent').style.display = '';
    $('drawerEditorTitle').textContent = `"${p.category}" 필드 설정`;
    renderDrawerCategories();
    // Render section cards
    const sections = groupFieldsIntoSections(p.fields);
    const list = $('drawerSectionList'); list.innerHTML = '';
    if (sections.length === 0) {
        // Auto-create one empty section
        addSectionCard();
    } else {
        sections.forEach(sec => renderSectionCard(sec));
    }
}

function renderSectionCard(sectionData) {
    const list = $('drawerSectionList');
    const card = document.createElement('div');
    card.className = 'section-card';
    card.innerHTML = `
        <div class="section-card-header">
            <button type="button" class="sec-drag" draggable="false" title="드래그하여 순서 변경"><i class='bx bx-grid-vertical'></i></button>
            <i class='bx bx-category sec-icon'></i>
            <textarea class="sec-label" placeholder="섹션명 입력 (예: 물리적 특성)" rows="1">${sectionData?.label || ''}</textarea>
            <button type="button" class="sec-del" title="섹션 삭제"><i class='bx bx-trash'></i></button>
        </div>
        <div class="section-card-body">
            <div class="sec-fields"></div>
            <button type="button" class="sec-add-field"><i class='bx bx-plus'></i> 필드 추가</button>
        </div>`;
    // Delete section
    card.querySelector('.sec-del').addEventListener('click', () => {
        if (card.querySelectorAll('.sec-field-row').length > 0 && !confirm('이 섹션과 포함된 필드를 모두 삭제하시겠습니까?')) return;
        card.remove();
    });
    // Add field button inside section
    card.querySelector('.sec-add-field').addEventListener('click', () => addFieldToSection(card));
    // Populate existing fields
    if (sectionData?.fields) {
        sectionData.fields.forEach(f => addFieldToSection(card, f));
    }
    list.appendChild(card);
    // Section-level drag-and-drop
    initSectionDrag(card);
    return card;
}

function addSectionCard() {
    renderSectionCard({ label: '', fields: [] });
}

function addFieldToSection(card, fieldData) {
    const container = card.querySelector('.sec-fields');
    const order = container.children.length + 1;
    const row = document.createElement('div');
    row.className = 'sec-field-row';
    row.innerHTML = `
        <button type="button" class="f-drag" draggable="false" title="드래그하여 순서 변경"><i class='bx bx-grid-vertical'></i></button>
        <span class="f-order">${order}</span>
        <textarea class="sf-label" placeholder="필드명 (예: 치수&#10;Dimension)" rows="2">${fieldData?.label || ''}</textarea>
        <select class="sf-type">
            <option value="text"${(!fieldData || fieldData.type === 'text') ? ' selected' : ''}>텍스트</option>
            <option value="number"${fieldData?.type === 'number' ? ' selected' : ''}>숫자</option>
        </select>
        <input type="text" class="sf-note" placeholder="비고" value="${fieldData?.note || ''}">
        <button type="button" class="f-del" title="삭제"><i class='bx bx-x'></i></button>`;
    row.querySelector('.f-del').addEventListener('click', () => {
        row.remove();
        reorderSectionFields(container);
    });
    container.appendChild(row);
    // Field-level drag-and-drop
    initFieldDrag(row, container);
}

function reorderSectionFields(container) {
    container.querySelectorAll('.sec-field-row').forEach((r, i) => {
        r.querySelector('.f-order').textContent = i + 1;
    });
}

async function saveCurrentPreset() {
    if (!selectedPresetId) return;
    const p = presetsData.find(x => x.id === selectedPresetId);
    if (!p) return;
    const fields = flattenSections();
    const payload = { id: p.id, category: p.category, fields };
    try {
        const res = await authFetch(`${API}/presets`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        if (res.ok) { showToast('프리셋 저장 완료', 'success'); await loadPresets(); closePresetDrawer(); renderSidebar(); }
        else { showToast('저장 실패', 'error'); }
    } catch(e) { showToast('서버 오류', 'error'); }
}

// ── Drag & Drop: Pointer-based (mousedown/mousemove/mouseup) ──
// More reliable than HTML5 DnD for nested elements

const dragState = { active: false, el: null, type: null, container: null };

function initFieldDrag(row, container) {
    const handle = row.querySelector('.f-drag');
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        startDrag(row, 'field', container);
    });
}

function initSectionDrag(card) {
    const handle = card.querySelector('.sec-drag');
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        startDrag(card, 'section', $('drawerSectionList'));
    });
}

function startDrag(el, type, container) {
    dragState.active = true;
    dragState.el = el;
    dragState.type = type;
    dragState.container = container;
    el.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';

    const selector = type === 'field' ? '.sec-field-row' : '.section-card';

    function onMouseMove(e) {
        if (!dragState.active) return;
        const siblings = [...container.querySelectorAll(selector)];
        siblings.forEach(s => s.classList.remove('drag-over'));
        for (const sibling of siblings) {
            if (sibling === dragState.el) continue;
            const rect = sibling.getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                sibling.classList.add('drag-over');
                break;
            }
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!dragState.active) return;

        const target = container.querySelector(selector + '.drag-over');
        if (target && target !== dragState.el) {
            const allItems = [...container.querySelectorAll(selector)];
            const dragIdx = allItems.indexOf(dragState.el);
            const dropIdx = allItems.indexOf(target);
            if (dragIdx < dropIdx) {
                target.after(dragState.el);
            } else {
                target.before(dragState.el);
            }
            if (type === 'field') reorderSectionFields(container);
        }

        container.querySelectorAll(selector).forEach(s => s.classList.remove('drag-over'));
        dragState.el.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        dragState.active = false;
        dragState.el = null;
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function addPresetCategory() {
    const name = prompt('새 분류명을 입력하세요:');
    if (!name || !name.trim()) return;
    const id = 'TBMFP-' + Date.now() + '-' + Math.random().toString(36).substring(2,6);
    const payload = { id, category: name.trim(), fields: [] };
    authFetch(`${API}/presets`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) })
        .then(async res => { if (res.ok) { showToast('분류 추가 완료', 'success'); await loadPresets(); renderDrawerCategories(); selectDrawerPreset(id); } else showToast('추가 실패', 'error'); })
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

// --- Compare ---
let compareItems = [];

function openCompare() {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (ids.length < 2) return showToast('비교할 항목을 2개 이상 선택해주세요.', 'warning');
    const items = ids.map(id => allData.find(d => d.id === id)).filter(Boolean);
    const cats = new Set(items.map(d => d.category));
    if (cats.size > 1) return showToast('같은 분류의 자재만 비교할 수 있습니다.', 'warning');
    compareItems = items;
    renderCompareTable();
    $('compareModal').classList.add('active');
}

function renderCompareTable() {
    if (!compareItems.length) return;
    const cat = compareItems[0].category;
    const preset = presetsData.find(p => p.category === cat);
    const fields = preset?.fields || [];
    const n = compareItems.length;
    // Basic rows
    const basicRows = [
        ['품목명', d => d.itemName||'-'],
        ['규격/모델', d => d.spec||'-'],
        ['제조사', d => d.manufacturer||'-'],
        ['현장명', d => d.site||'-'],
        ['장비명', d => d.equipment||'-'],
        ['수량 (국내)', d => d.sourceType === 'import' ? '-' : `${d.qty||0} ${d.unit||'EA'}`],
        ['단가 (국내)', d => d.sourceType === 'import' ? '-' : '₩'+fmtN(d.price)],
        ['합계 (국내)', d => d.sourceType === 'import' ? '-' : '₩'+fmtN(d.total)],
        ['수입 견적<br><span style="font-size:10px;font-weight:normal">(포장 및 조건별)</span>', d => {
            if (d.sourceType !== 'import') return '-';
            const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
            if (!groups.length) {
                const its = Array.isArray(d.incoterms) ? d.incoterms : [];
                if (!its.length) return '<span style="color:var(--gray-400);">가격 미입력</span>';
                return its.map(it => {
                    const priceStr = (it.currency && it.currency !== 'KRW') ? `${currencySymbol(it.currency)}${fmtDec(it.price)}` : `₩${fmtN(it.price)}`;
                    return `<div style="color:#92400e;">${it.term}: ${priceStr}${formatKrwApprox(it.price, it.currency)}</div>`;
                }).join('');
            }
            return groups.map(g => {
                const label = g.packaging || '미지정';
                const qtyStr = g.qty ? `(${fmtDec(g.qty)} ${g.unit||''})` : '';
                const itsHtml = (g.incoterms || []).map(it => {
                    const priceStr = (it.currency && it.currency !== 'KRW') ? `${currencySymbol(it.currency)}${fmtDec(it.price)}` : `₩${fmtN(it.price)}`;
                    return `<div style="padding-left:12px;color:#92400e;font-size:12px;">- ${it.term}: ${priceStr}${formatKrwApprox(it.price, it.currency)}</div>`;
                }).join('');
                return `<div style="margin-bottom:8px;"><strong style="color:#111827;">📦 ${label} ${qtyStr}</strong>${itsHtml || '<div style="color:var(--gray-400);font-size:12px;padding-left:12px;">가격 미입력</div>'}</div>`;
            }).join('');
        }]
    ];
    let html = `<table class="compare-table"><thead><tr><th style="width:140px;">${cat} 비교 (${n}개)</th>`;
    compareItems.forEach(d => { html += `<th>${d.itemName||d.spec||'-'}</th>`; });
    html += '</tr></thead><tbody>';
    // Basic info rows
    basicRows.forEach(([label, fn]) => {
        const vals = compareItems.map(fn);
        const allSame = vals.every(v => v === vals[0]);
        html += `<tr><td class="compare-label">${label}</td>`;
        vals.forEach(v => { html += `<td class="${allSame?'':'compare-diff'}">${v}</td>`; });
        html += '</tr>';
    });
    // Custom field rows with sections
    if (fields.length) {
        fields.forEach(f => {
            if (f.type === 'section') {
                html += `<tr class="compare-section-row"><td colspan="${n+1}">▸ ${(f.label||'').replace(/\n/g,' / ')}</td></tr>`;
            } else {
                const lbl = (f.label||'').replace(/\n/g,' / ');
                const vals = compareItems.map(d => {
                    const v = (d.customFields||{})[f.key]||'-';
                    const note = (d.customFieldNotes||{})[f.key];
                    return note ? `${v} <em class="cf-note-badge">${note}</em>` : v;
                });
                const rawVals = compareItems.map(d => (d.customFields||{})[f.key]||'-');
                const allSame = rawVals.every(v => v === rawVals[0]);
                html += `<tr><td class="compare-label">${lbl}</td>`;
                vals.forEach((v, i) => { html += `<td class="${allSame?'':'compare-diff'}">${v}</td>`; });
                html += '</tr>';
            }
        });
    }
    html += '</tbody></table>';
    $('compareTableWrap').innerHTML = html;
}

function exportCompare() {
    if (!compareItems.length) return;
    const cat = compareItems[0].category;
    const preset = presetsData.find(p => p.category === cat);
    const fields = preset?.fields || [];
    const rows = [];
    const header = ['항목', ...compareItems.map(d => d.itemName||d.spec||'-')];
    rows.push(header);
    [['품목명','itemName'],['규격/모델','spec'],['제조사','manufacturer'],['현장명','site'],['장비명','equipment'],['수량','qty'],['단가','price'],['합계','total']].forEach(([lbl,key]) => {
        rows.push([lbl, ...compareItems.map(d => key==='price'||key==='total' ? d[key]||0 : d[key]||'-')]);
    });
    fields.forEach(f => {
        if (f.type === 'section') { rows.push([`[${(f.label||'').replace(/\n/g,' ')}]`]); }
        else { rows.push([(f.label||'').replace(/\n/g,' '), ...compareItems.map(d => (d.customFields||{})[f.key]||'-')]); }
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '자재 비교');
    XLSX.writeFile(wb, `TBM_자재비교_${cat}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('비교표 엑셀 다운로드', 'success');
}
