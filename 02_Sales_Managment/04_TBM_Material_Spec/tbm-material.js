/* ═══════════════════════════════════════════════════════════════
   TBM 자재 규격 관리 (tbm-material.js)
   ECOUNT ERP 스타일 고밀도 스프레드시트 엔진 & 데이터 바인딩
   ═══════════════════════════════════════════════════════════════ */

// --- Auth Fetch (with retry for iframe auth race condition) ---
async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    if (!token) {
        try {
            token = localStorage.getItem('kng_token') || sessionStorage.getItem('kng_token') || localStorage.getItem('token');
        } catch(e) {}
    }
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
let activeCategoryFilter = 'all';
let activeSourceTypeFilter = 'all';
let currentFiles = [];
let subSearchText = '';
let subSearchTimer = null;
let modalSnapshot = '';
let selectedPresetId = null;
let compareItems = [];

// ── 통화 및 무역조건 상수 (최상단 즉시 초기화) ──
const INCOTERMS_LIST = ['EXW','FCA','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'];
const CURRENCY_LIST = [
    { code: 'USD', symbol: '$', label: 'USD ($)' },
    { code: 'CNY', symbol: '¥', label: 'CNY (¥)' },
    { code: 'EUR', symbol: '€', label: 'EUR (€)' },
    { code: 'JPY', symbol: '¥', label: 'JPY (¥)' },
    { code: 'KRW', symbol: '₩', label: 'KRW (₩)' },
    { code: 'GBP', symbol: '£', label: 'GBP (£)' },
];

function currencySymbol(code) {
    return (CURRENCY_LIST.find(c => c.code === code) || {}).symbol || code + ' ';
}
function fmtN(n) {
    return (n === 0 || n == null) ? '0' : Number(n).toLocaleString();
}
function fmtDec(n) {
    if (n == null || n === 0) return '0';
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function formatKrwApprox(price, currency) {
    if (currency === 'KRW' || !window.exchangeRates || !window.exchangeRates[currency]) return '';
    const krwValue = price * (1 / window.exchangeRates[currency]);
    return ` <em style="font-size:10px;color:#9ca3af;font-style:normal">(약 ₩${fmtN(Math.round(krwValue))})</em>`;
}

const $ = id => document.getElementById(id);
const escapeHtml = str => {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// 안전한 페이지네이션 계산 헬퍼 (Common/js/kng-table-utils.js 호환)
function calcPagination(totalItems, currentPage, pageSize) {
    if (typeof window.calcPagination === 'function' && window.calcPagination !== calcPagination) {
        return window.calcPagination(totalItems, currentPage, pageSize);
    }
    const size = pageSize <= 0 ? (totalItems || 1) : pageSize;
    const totalPages = Math.ceil(totalItems / size) || 1;
    const page = Math.max(1, Math.min(currentPage, totalPages));
    const startIdx = (page - 1) * size;
    const endIdx = pageSize <= 0 ? totalItems : Math.min(startIdx + size, totalItems);
    return { page, totalPages, startIdx, endIdx };
}

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadPresets().then(() => loadData());
});

// ── 1. 이벤트 초기화 ──
function initEvents() {
    // 툴바 액션 버튼들
    $('addBtn')?.addEventListener('click', () => openModal());
    $('deleteBtn')?.addEventListener('click', deleteSelected);
    $('exportBtn')?.addEventListener('click', exportExcel);
    $('compareBtn')?.addEventListener('click', openCompare);
    $('presetBtn')?.addEventListener('click', openPresetDrawer);

    // 검색창 & 엔터 검색
    $('btn-do-search')?.addEventListener('click', doSearch);
    $('btn-clear-search')?.addEventListener('click', clearSearch);
    $('searchInput')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
    });

    // 구분 필터 (전체/국내/수입)
    $('sourceTypeFilter')?.addEventListener('change', e => {
        activeSourceTypeFilter = e.target.value;
        currentPage = 1;
        applyFiltersAndSort();
    });

    // 검색 대상 변경
    $('searchTarget')?.addEventListener('change', () => {
        currentPage = 1;
        applyFiltersAndSort();
    });

    // 결과 내 실시간 재검색 (Sub-search)
    $('subSearchInput')?.addEventListener('input', e => {
        clearTimeout(subSearchTimer);
        subSearchTimer = setTimeout(() => {
            subSearchText = e.target.value.trim().toLowerCase();
            currentPage = 1;
            applyFiltersAndSort();
        }, 150);
    });

    // 열 너비 조절 도구 버튼
    $('btnAutoFitCols')?.addEventListener('click', () => {
        if (window.ErpGridResizer) window.ErpGridResizer.autoFitAll('tbmTable');
    });
    $('btnResetCols')?.addEventListener('click', () => {
        if (window.ErpGridResizer) window.ErpGridResizer.resetWidths('tbmTable');
    });

    // 페이지 크기 셀렉트
    $('pageSizeSelect')?.addEventListener('change', e => {
        pageSize = parseInt(e.target.value) || 30;
        currentPage = 1;
        applyFiltersAndSort();
    });

    // 전체 선택 체크박스
    $('selectAll')?.addEventListener('change', e => {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
        updateFloatingBar();
    });

    // 하단 플로팅 바 버튼
    $('floatingCompareBtn')?.addEventListener('click', openCompare);
    $('floatingDeleteBtn')?.addEventListener('click', deleteSelected);
    $('floatingClearBtn')?.addEventListener('click', () => {
        $('selectAll').checked = false;
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = false);
        updateFloatingBar();
    });

    // 모달 닫기
    $('closeModalBtn')?.addEventListener('click', confirmCloseModal);
    $('cancelBtn')?.addEventListener('click', confirmCloseModal);
    $('closeDrawerBtn')?.addEventListener('click', closePresetDrawer);
    $('closeDrawerBtn2')?.addEventListener('click', closePresetDrawer);
    $('closeCompareBtn')?.addEventListener('click', () => $('compareModal').classList.remove('active'));
    $('closeCompareBtn2')?.addEventListener('click', () => $('compareModal').classList.remove('active'));
    $('compareExportBtn')?.addEventListener('click', exportCompare);

    // 모달 외부 클릭 닫기 제어
    let mouseDownTarget = null;
    window.addEventListener('mousedown', e => { mouseDownTarget = e.target; });
    window.addEventListener('click', e => {
        if (mouseDownTarget !== e.target) { mouseDownTarget = null; return; }
        if (e.target === $('itemModal')) confirmCloseModal();
        if (e.target === $('drawerOverlay')) closePresetDrawer();
        if (e.target === $('compareModal')) $('compareModal').classList.remove('active');
        mouseDownTarget = null;
    });

    // 폼 저장 및 계산 이벤트
    $('saveItemBtn')?.addEventListener('click', async e => {
        e.preventDefault();
        await saveItem();
    });
    $('itemForm')?.addEventListener('submit', async e => {
        e.preventDefault();
        await saveItem();
    });
    ['inpQty', 'inpPrice'].forEach(id => $(id)?.addEventListener('input', updateCalc));
    $('inpCategory')?.addEventListener('change', onCategoryChange);
    $('modalAddSectionBtn')?.addEventListener('click', () => modalAddSection());
    $('modalAddFieldBtn')?.addEventListener('click', () => modalAddField());

    // 국내 / 수입 구분 라디오
    document.querySelectorAll('input[name="sourceType"]').forEach(r => r.addEventListener('change', toggleSourceType));
    $('addPkgGroupBtn')?.addEventListener('click', () => addPackagingGroup());

    // 파일 업로드
    const area = $('fileUploadArea'), inp = $('fileInput');
    if (area && inp) {
        area.addEventListener('click', () => inp.click());
        area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
        area.addEventListener('dragleave', () => area.classList.remove('dragover'));
        area.addEventListener('drop', e => { e.preventDefault(); area.classList.remove('dragover'); uploadFiles(e.dataTransfer.files); });
        inp.addEventListener('change', () => { if (inp.files.length) uploadFiles(inp.files); inp.value = ''; });
    }

    // 프리셋 드로어 이벤트
    $('addDrawerCatBtn')?.addEventListener('click', addPresetCategory);
    $('addDrawerSectionBtn')?.addEventListener('click', addSectionCard);
    $('saveDrawerBtn')?.addEventListener('click', saveCurrentPreset);

    // 테이블 헤더 정렬 클릭 이벤트 바인딩
    document.querySelectorAll('#tbmTable thead th.sortable-th').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (!col) return;
            if (currentSort.column === col) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.column = col;
                currentSort.asc = true;
            }
            applyFiltersAndSort();
        });
    });
}

function clearSearch() {
    $('searchInput').value = '';
    $('subSearchInput').value = '';
    $('searchTarget').value = 'all';
    $('sourceTypeFilter').value = 'all';
    subSearchText = '';
    activeCategoryFilter = 'all';
    activeSourceTypeFilter = 'all';
    currentPage = 1;
    renderCategoryTabs();
    applyFiltersAndSort();
}

function doSearch() {
    currentPage = 1;
    applyFiltersAndSort();
}

// ── 2. 데이터 로드 및 초기화 ──
async function loadData() {
    try {
        const [res, rateRes] = await Promise.all([
            authFetch(`${API}/materials?t=${Date.now()}`),
            authFetch(`https://kng.junparks.com/api/exchange-rates?t=${Date.now()}`).catch(() => ({ok: false}))
        ]);
        if (!res.ok) throw new Error(`API 응답 실패 (HTTP ${res.status})`);
        allData = await res.json();
        if (rateRes && rateRes.ok) {
            try {
                window.exchangeRates = await rateRes.json();
                updateExchangeRateUI();
            } catch(e) {}
        }
        renderCategoryTabs();
        updateDatalists();
        applyFiltersAndSort();
    } catch(e) {
        console.error('loadData error:', e);
        const tbody = $('tbmTbody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="17" class="text-center text-danger py-4">
                <i class="bx bx-error-circle fs-3 d-block mb-1"></i>
                데이터를 불러오는 중 오류가 발생했습니다. (${escapeHtml(e.message)})
            </td></tr>`;
        }
    }
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
        if (res.ok) {
            presetsData = await res.json();
            presetsData.forEach(p => {
                if (Array.isArray(p.fields)) {
                    const seen = new Set();
                    p.fields.forEach(f => {
                        if (f.type !== 'section') {
                            let k = f.key;
                            let counter = 1;
                            while (seen.has(k)) {
                                k = f.key + '_' + counter;
                                counter++;
                            }
                            f.key = k;
                            seen.add(k);
                        }
                    });
                }
            });
        }
    } catch(e) { console.error('loadPresets error:', e); }
    updateCategorySelect();
}

function updateCategorySelect() {
    const sel = $('inpCategory');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— 분류 선택 —</option>';
    presetsData.forEach(p => {
        const o = document.createElement('option');
        o.value = p.category;
        o.textContent = p.category;
        sel.appendChild(o);
    });
    const existing = new Set(presetsData.map(p => p.category));
    allData.forEach(d => {
        if (d.category && !existing.has(d.category)) {
            const o = document.createElement('option');
            o.value = d.category;
            o.textContent = d.category;
            sel.appendChild(o);
            existing.add(d.category);
        }
    });
    sel.value = cur;
}

// ── 3. 자재 분류 세그먼트 탭 렌더링 ──
function renderCategoryTabs() {
    const container = $('categoryTabGroup');
    if (!container) return;

    const cats = new Map();
    allData.forEach(d => {
        if (d.category) cats.set(d.category, (cats.get(d.category) || 0) + 1);
    });
    presetsData.forEach(p => {
        if (p.category && !cats.has(p.category)) cats.set(p.category, 0);
    });

    let html = `<button type="button" class="erp-tab-btn${activeCategoryFilter === 'all' ? ' active' : ''}" data-cat="all">전체 <span class="badge rounded-pill bg-secondary text-white" style="font-size:9px;padding:1px 4px;">${allData.length}</span></button>`;
    
    [...cats.keys()].sort().forEach(cat => {
        const count = cats.get(cat);
        html += `<button type="button" class="erp-tab-btn${activeCategoryFilter === cat ? ' active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)} <span class="badge rounded-pill bg-light text-secondary border" style="font-size:9px;padding:1px 4px;">${count}</span></button>`;
    });

    container.innerHTML = html;
    container.querySelectorAll('.erp-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeCategoryFilter = btn.dataset.cat;
            currentPage = 1;
            renderCategoryTabs();
            applyFiltersAndSort();
        });
    });
}

function updateDatalists() {
    const sets = { site: new Set(), equipment: new Set(), itemName: new Set(), manufacturer: new Set() };
    allData.forEach(d => {
        Object.keys(sets).forEach(k => { if (d[k]) sets[k].add(d[k]); });
    });
    Object.entries(sets).forEach(([k, s]) => {
        const dl = $('list' + k.charAt(0).toUpperCase() + k.slice(1));
        if (dl) dl.innerHTML = [...s].sort().map(v => `<option value="${escapeHtml(v)}">`).join('');
    });
}

// ── 4. 필터링 및 정렬 ──
function applyFiltersAndSort() {
    const searchTarget = $('searchTarget')?.value || 'all';
    const query = ($('searchInput')?.value || '').trim().toLowerCase();
    const queryTokens = query ? query.split(/\s+/).filter(Boolean) : [];

    filteredData = allData.filter(item => {
        // 1. 분류 필터
        if (activeCategoryFilter !== 'all' && item.category !== activeCategoryFilter) return false;

        // 2. 구분 필터 (국내/수입)
        if (activeSourceTypeFilter === 'domestic' && item.sourceType === 'import') return false;
        if (activeSourceTypeFilter === 'import' && item.sourceType !== 'import') return false;

        // 3. 스마트 다중 검색 (AND 검색)
        if (queryTokens.length > 0) {
            let searchableText = '';
            if (searchTarget === 'all') {
                const cfValues = Object.values(item.customFields || {}).map(v => (v != null && typeof v === 'object') ? JSON.stringify(v) : String(v || ''));
                const cfNotes = Object.values(item.customFieldNotes || {}).map(v => String(v || ''));
                searchableText = [
                    item.site, item.equipment, item.category, item.itemName,
                    item.spec, item.manufacturer, item.remarks,
                    ...cfValues,
                    ...cfNotes
                ].join(' ').toLowerCase();
            } else {
                searchableText = String(item[searchTarget] || '').toLowerCase();
            }

            const matchAllTokens = queryTokens.every(tok => searchableText.includes(tok));
            if (!matchAllTokens) return false;
        }

        // 4. 결과 내 재검색 (Sub-search)
        if (subSearchText) {
            const cfValues = Object.values(item.customFields || {}).map(v => String(v || ''));
            const rowContent = [
                item.site, item.equipment, item.category, item.itemName,
                item.spec, item.manufacturer, item.remarks, item.qty, item.price, item.total,
                ...cfValues
            ].join(' ').toLowerCase();
            if (!rowContent.includes(subSearchText)) return false;
        }

        return true;
    });

    // 정렬 수행
    const numCols = ['qty', 'price', 'total'];
    if (currentSort.column) {
        filteredData.sort((a, b) => {
            let va = a[currentSort.column], vb = b[currentSort.column];
            if (numCols.includes(currentSort.column)) {
                va = Number(va) || 0;
                vb = Number(vb) || 0;
                return currentSort.asc ? va - vb : vb - va;
            }
            if (currentSort.column === 'createdAt') {
                va = new Date(va || a.updatedAt || 0).getTime();
                vb = new Date(vb || b.updatedAt || 0).getTime();
                return currentSort.asc ? va - vb : vb - va;
            }
            va = String(va || '').toLowerCase();
            vb = String(vb || '').toLowerCase();
            return currentSort.asc ? va.localeCompare(vb, 'ko') : vb.localeCompare(va, 'ko');
        });
    }

    updateSortUI();
    updateKPI();
    renderGrid();
}

function updateSortUI() {
    document.querySelectorAll('#tbmTable thead th.sortable-th').forEach(th => {
        const col = th.dataset.sort;
        const icon = th.querySelector('.sort-icon');
        if (!icon) return;
        if (col === currentSort.column) {
            icon.textContent = currentSort.asc ? ' 🔼' : ' 🔽';
            th.classList.add('text-primary');
        } else {
            icon.textContent = '';
            th.classList.remove('text-primary');
        }
    });
}

function updateKPI() {
    let tQty = 0;
    const eqSet = new Set();
    filteredData.forEach(d => {
        tQty += d.qty || 0;
        if (d.equipment) eqSet.add(d.equipment);
    });

    if ($('totalCount')) $('totalCount').textContent = `${allData.length}건`;
    if ($('kpiCount')) $('kpiCount').textContent = filteredData.length.toLocaleString();
    if ($('kpiQty')) $('kpiQty').textContent = tQty.toLocaleString();
    if ($('kpiEquipments')) $('kpiEquipments').textContent = eqSet.size;
    if ($('filterResultCount')) $('filterResultCount').textContent = `조회 ${filteredData.length.toLocaleString()}건`;
}

// ── 5. 고밀도 ERP 시트 테이블 렌더링 ──
function renderGrid() {
    const tbody = $('tbmTbody');
    if (!tbody) return;

    if ($('selectAll')) $('selectAll').checked = false;
    updateFloatingBar();

    if (!filteredData.length) {
        tbody.innerHTML = '<tr><td colspan="17" class="text-center text-muted py-4"><i class="bx bx-package fs-3 d-block mb-1"></i>조회된 자재 규격 데이터가 없습니다.</td></tr>';
        if ($('pagination')) $('pagination').innerHTML = '';
        return;
    }

    const pg = calcPagination(filteredData.length, currentPage, pageSize);
    currentPage = pg.page;
    const rows = filteredData.slice(pg.startIdx, pg.endIdx);
    const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

    let html = '';
    rows.forEach((d, idx) => {
        const num = pg.startIdx + idx + 1;
        const filesArr = Array.isArray(d.files) ? d.files : [];
        const thumbFile = filesArr.find(f => {
            if (!f || typeof f !== 'object') return false;
            const ext = (f.originalName || f.filename || '').split('.').pop().toLowerCase();
            return imgExts.includes(ext);
        });
        const thumbUrl = thumbFile ? (thumbFile.url || API + '/uploads/' + thumbFile.filename) : '';

        // 미니 썸네일 박스
        const thumbMiniHtml = thumbUrl 
            ? `<div class="thumb-mini-box" onmouseenter="showImageHover('${thumbUrl}', '${escapeHtml(d.itemName)}', event)" onmouseleave="hideImageHover()" onclick="openModal('${d.id}')"><img src="${thumbUrl}" alt="썸네일"></div>`
            : `<div class="thumb-mini-box no-img"><i class='bx bx-image'></i></div>`;

        // 구분 플랫 배지
        const sourceBadgeHtml = d.sourceType === 'import'
            ? `<span class="erp-badge erp-badge-import">수입</span>`
            : `<span class="erp-badge erp-badge-domestic">국내</span>`;

        // 주요 사양 요약 텍스트 (커스텀 필드 요약)
        let cfSummary = '';
        if (d.customFields && typeof d.customFields === 'object') {
            let savedLabels = {};
            try {
                if (d.customFieldNotes && d.customFieldNotes['__labels__']) {
                    savedLabels = JSON.parse(d.customFieldNotes['__labels__']);
                }
            } catch(e) {}
            const entries = Object.entries(d.customFields).filter(([k, v]) => !k.startsWith('__') && v != null && v !== '');
            if (entries.length > 0) {
                const preset = presetsData.find(p => p.category === d.category);
                const fieldLabelMap = {};
                (preset?.fields || []).forEach(f => { fieldLabelMap[f.key] = (f.label || '').replace(/\n/g, ' '); });
                cfSummary = entries.slice(0, 3).map(([k, v]) => `${savedLabels[k] || fieldLabelMap[k] || k.replace(/_/g, ' ')}: ${v}`).join(' · ');
                if (entries.length > 3) cfSummary += ` (+${entries.length - 3})`;
            }
        }
        if (!cfSummary) cfSummary = '<span class="text-muted opacity-50">-</span>';

        // 날짜 포맷
        const dateStr = d.quoteDate || (d.updatedAt ? new Date(d.updatedAt).toISOString().split('T')[0] : '-');

        // 아코디언 콘텐츠 안전 생성
        let accordionHtml = '';
        try {
            accordionHtml = buildAccordionContentHtml(d, thumbUrl, filesArr);
        } catch (accErr) {
            console.error('Accordion render error for item', d.id, accErr);
            accordionHtml = `<div class="p-2 text-danger">상세 정보를 렌더링하는 중 오류가 발생했습니다: ${escapeHtml(accErr.message)}</div>`;
        }

        // 메인 데이터 행
        html += `
        <tr class="erp-main-row" data-id="${d.id}" id="row_${d.id}" ondblclick="window.onRowDblClick('${d.id}', event)">
            <td class="text-center user-select-none">
                <input type="checkbox" class="row-check form-check-input mt-0 cursor-pointer" value="${d.id}" onchange="updateFloatingBar(event)">
                <span class="text-muted ms-1" style="font-size:10.5px;">${num}</span>
            </td>
            <td class="text-center">
                <button type="button" class="btn-expand" id="btnExp_${d.id}" onclick="toggleAccordion('${d.id}', event)" title="상세 사양 및 첨부파일 펼치기">
                    <i class='bx bx-chevron-right'></i>
                </button>
            </td>
            <td class="text-center p-0">
                ${thumbMiniHtml}
            </td>
            <td class="text-center">
                ${sourceBadgeHtml}
            </td>
            <td class="text-center">
                <span class="erp-badge erp-badge-cat text-truncate d-inline-block" style="max-width:75px;" title="${escapeHtml(d.category)}">${escapeHtml(d.category || '-')}</span>
            </td>
            <td title="${escapeHtml(d.site || '-')}">
                ${escapeHtml(d.site || '-')}
            </td>
            <td title="${escapeHtml(d.equipment || '-')}">
                ${escapeHtml(d.equipment || '-')}
            </td>
            <td title="${escapeHtml(d.itemName || '-')}">
                <strong class="text-primary cursor-pointer hover-underline" onclick="openModal('${d.id}')">${escapeHtml(d.itemName || '-')}</strong>
            </td>
            <td title="${escapeHtml(d.spec || '-')}">
                ${escapeHtml(d.spec || '-')}
            </td>
            <td title="${escapeHtml(d.manufacturer || '-')}">
                ${escapeHtml(d.manufacturer || '-')}
            </td>
            <td class="text-end tabular-nums" title="${d.sourceType === 'import' ? '수입 견적' : (d.qty || 0) + ' ' + (d.unit || 'EA')}">
                ${d.sourceType === 'import' ? '<span class="text-muted">-</span>' : fmtN(d.qty) + ' <span style="font-size:10px;color:#64748b;">' + (d.unit || 'EA') + '</span>'}
            </td>
            <td class="text-end tabular-nums">
                ${d.sourceType === 'import' ? '<span class="text-muted">-</span>' : '₩' + fmtN(d.price)}
            </td>
            <td class="text-end tabular-nums fw-bold text-primary">
                ${d.sourceType === 'import' ? '<span class="text-muted fw-normal">-</span>' : '₩' + fmtN(d.total)}
            </td>
            <td class="text-muted" style="font-size:11px;" title="${escapeHtml(cfSummary.replace(/<[^>]+>/g, ''))}">
                ${cfSummary}
            </td>
            <td class="text-center">
                ${filesArr.length ? `<span class="text-primary cursor-pointer fw-bold" onclick="toggleAccordion('${d.id}', event)" title="${filesArr.length}개 첨부파일"><i class='bx bx-paperclip'></i> ${filesArr.length}</span>` : '<span class="text-muted opacity-50">-</span>'}
            </td>
            <td class="text-center text-muted tabular-nums" style="font-size:10.5px;">
                ${dateStr}
            </td>
            <td class="text-center d-print-none">
                <button type="button" class="btn-grid-action" onclick="openModal('${d.id}')" title="수정"><i class='bx bx-edit'></i></button>
                <button type="button" class="btn-grid-action ms-1" onclick="openModal('${d.id}', true)" title="복사"><i class='bx bx-copy'></i></button>
                <button type="button" class="btn-grid-action btn-grid-action-danger ms-1" onclick="deleteSingle('${d.id}')" title="삭제"><i class='bx bx-trash'></i></button>
            </td>
        </tr>

        <!-- 아코디언 상세 전표 서브 행 -->
        <tr class="erp-sub-row d-none" id="subRow_${d.id}">
            <td colspan="17" class="p-0">
                ${accordionHtml}
            </td>
        </tr>`;
    });

    tbody.innerHTML = html;

    // 페이지네이션 렌더링
    if (typeof window.renderPagination === 'function' && $('pagination')) {
        window.renderPagination({
            container: $('pagination'),
            totalFiltered: filteredData.length,
            totalAll: allData.length,
            totalPages: pg.totalPages,
            currentPage,
            pageSize,
            startIdx: pg.startIdx,
            endIdx: pg.endIdx,
            onPageChange: p => { currentPage = p; renderGrid(); },
            onPageSizeChange: s => { pageSize = s; currentPage = 1; renderGrid(); }
        });
    }

    // 그리드 열 너비 리사이저 초기화
    if (window.ErpGridResizer && typeof window.ErpGridResizer.init === 'function') {
        window.ErpGridResizer.init('tbmTable');
    }
}

// 호환성 별칭 (기존 코드에서 호출 시 안전하게 연동)
function renderCards() { renderGrid(); }
function renderSidebar() { renderCategoryTabs(); }

// ── 6. 아코디언 상세 뷰 빌더 ──
function buildAccordionContentHtml(d, thumbUrl, filesArr) {
    const preset = presetsData.find(p => p.category === d.category);
    const cfNotes = (d.customFieldNotes && typeof d.customFieldNotes === 'object') ? d.customFieldNotes : {};
    const customFields = (d.customFields && typeof d.customFields === 'object') ? d.customFields : {};

    // 1) 스펙 테이블 (섹션별 그룹)
    let specTableHtml = '<div class="text-muted small">등록된 커스텀 사양이 없습니다.</div>';
    let rowsHtml = '';
    const renderedKeys = new Set();
    let savedLabels = {};
    try {
        if (cfNotes['__labels__']) savedLabels = JSON.parse(cfNotes['__labels__']);
    } catch(e) {}

    if (preset && Array.isArray(preset.fields) && Object.keys(customFields).length > 0) {
        preset.fields.forEach(f => {
            if (f.type === 'section') {
                rowsHtml += `<tr class="table-light"><th colspan="2" class="text-primary fw-bold" style="background:#eff6ff !important;"><i class='bx bx-chevron-right'></i> ${(f.label || '').replace(/\n/g, ' / ')}</th></tr>`;
            } else {
                renderedKeys.add(f.key);
                const val = customFields[f.key];
                if (val != null && val !== '') {
                    const lbl = savedLabels[f.key] || (f.label || '').replace(/\n/g, ' ');
                    const noteText = (cfNotes[f.key] && !f.key.startsWith('__')) ? cfNotes[f.key] : '';
                    const note = noteText ? ` <span class="badge bg-light text-secondary border ms-1" title="${escapeHtml(noteText)}">${escapeHtml(noteText)}</span>` : '';
                    rowsHtml += `<tr><th>${escapeHtml(lbl)}</th><td><strong>${escapeHtml(val)}</strong>${note}</td></tr>`;
                }
            }
        });
    }

    // 프리셋 외 개별 추가된 사양 항목 (기타 특화 사양) 표시
    const orphanKeys = Object.keys(customFields).filter(k => 
        !k.startsWith('__') && !renderedKeys.has(k) && customFields[k] != null && String(customFields[k]).trim() !== ''
    );
    if (orphanKeys.length > 0) {
        rowsHtml += `<tr class="table-light"><th colspan="2" class="text-primary fw-bold" style="background:#eff6ff !important;"><i class='bx bx-chevron-right'></i> 기타 특화 사양</th></tr>`;
        orphanKeys.forEach(k => {
            const val = customFields[k];
            const lbl = savedLabels[k] || k.replace(/_/g, ' ');
            const noteText = (cfNotes[k] && !k.startsWith('__')) ? cfNotes[k] : '';
            const note = noteText ? ` <span class="badge bg-light text-secondary border ms-1" title="${escapeHtml(noteText)}">${escapeHtml(noteText)}</span>` : '';
            rowsHtml += `<tr><th>${escapeHtml(lbl)}</th><td><strong>${escapeHtml(val)}</strong>${note}</td></tr>`;
        });
    }

    if (rowsHtml) {
        specTableHtml = `<table class="acc-spec-table"><tbody>${rowsHtml}</tbody></table>`;
    }

    // 2) 첨부파일 다운로드 리스트
    let filesHtml = '<div class="text-muted" style="font-size:10.5px;">첨부파일 없음</div>';
    if (Array.isArray(filesArr) && filesArr.length > 0) {
        filesHtml = `<div class="d-flex flex-column gap-1">` + filesArr.map(f => {
            const ext = (f.originalName || f.filename || '').split('.').pop().toLowerCase();
            let icon = 'bx-file';
            if (['pdf'].includes(ext)) icon = 'bx-file-blank text-danger';
            else if (['xlsx','xls','csv'].includes(ext)) icon = 'bx-spreadsheet text-success';
            else if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) icon = 'bx-image text-primary';
            const downloadUrl = f.url || `${API}/uploads/${f.filename}`;
            return `<a href="${downloadUrl}" target="_blank" download class="text-decoration-none text-dark d-inline-flex align-items-center gap-1 p-1 border rounded bg-white hover-bg-light" style="font-size:11px;">
                <i class='bx ${icon}'></i>
                <span class="text-truncate" style="max-width:110px;">${escapeHtml(f.originalName || f.filename)}</span>
                <i class='bx bx-download text-muted ms-auto'></i>
            </a>`;
        }).join('') + `</div>`;
    }

    // 3) 가격 및 수입/패키징 정보
    let pricingHtml = '';
    if (d.sourceType === 'import') {
        const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
        if (groups.length > 0) {
            const groupsHtml = groups.map(g => {
                const its = (g.incoterms || []).map(it => {
                    const sym = currencySymbol(it.currency || 'KRW');
                    const approx = formatKrwApprox(it.price, it.currency);
                    return `<div>- <strong>${escapeHtml(it.term)}</strong>: ${sym}${fmtDec(it.price)}${approx}</div>`;
                }).join('');
                return `<div class="mb-2 p-1 border border-warning rounded bg-white">
                    <div class="fw-bold" style="color:#92400e;">📦 ${escapeHtml(g.packaging || '포장단위')} (${g.qty || 0} ${escapeHtml(g.unit || '')})</div>
                    <div class="ps-2" style="font-size:11px;">${its || '<span class="text-muted">가격 미입력</span>'}</div>
                </div>`;
            }).join('');
            pricingHtml = `
                <div class="acc-price-box">
                    <div class="fw-bold text-warning-emphasis mb-1"><i class='bx bx-globe'></i> 수입 견적 사양</div>
                    ${groupsHtml}
                </div>`;
        } else {
            // Backward compatibility: old flat incoterms
            const oldIts = Array.isArray(d.incoterms) ? d.incoterms : [];
            if (oldIts.length > 0) {
                const its = oldIts.map(it => {
                    const sym = currencySymbol(it.currency || 'KRW');
                    const approx = formatKrwApprox(it.price, it.currency);
                    return `<div>- <strong>${escapeHtml(it.term)}</strong>: ${sym}${fmtDec(it.price)}${approx}</div>`;
                }).join('');
                pricingHtml = `
                    <div class="acc-price-box">
                        <div class="fw-bold text-warning-emphasis mb-1"><i class='bx bx-globe'></i> 수입 견적 사양</div>
                        <div class="p-1 border border-warning rounded bg-white">
                            <div class="fw-bold" style="color:#92400e;">📦 기본 견적</div>
                            <div class="ps-2" style="font-size:11px;">${its}</div>
                        </div>
                    </div>`;
            } else {
                pricingHtml = `
                    <div class="acc-price-box">
                        <div class="fw-bold text-warning-emphasis mb-1"><i class='bx bx-globe'></i> 수입 견적 사양</div>
                        <div class="text-muted" style="font-size:11px;">가격 미입력</div>
                    </div>`;
            }
        }
    } else {
        pricingHtml = `
            <div class="acc-price-box">
                <div class="fw-bold text-primary mb-1"><i class='bx bx-won'></i> 국내 단가 정보</div>
                <div class="d-flex justify-content-between mb-1">
                    <span class="text-muted">수량:</span>
                    <strong>${fmtN(d.qty)} ${escapeHtml(d.unit || 'EA')}</strong>
                </div>
                <div class="d-flex justify-content-between mb-1">
                    <span class="text-muted">단가:</span>
                    <strong>₩${fmtN(d.price)}</strong>
                </div>
                <div class="d-flex justify-content-between pt-1 border-top">
                    <span class="fw-bold">합계:</span>
                    <strong class="text-primary fs-6">₩${fmtN(d.total)}</strong>
                </div>
            </div>`;
    }

    // 비고 정보
    const remarksHtml = d.remarks 
        ? `<div class="mt-2 p-1 px-2 border rounded bg-light" style="font-size:11px;"><i class='bx bx-note text-secondary'></i> <strong>비고:</strong> ${escapeHtml(d.remarks)}</div>` 
        : '';

    return `
    <div class="accordion-content-box">
        <div class="acc-grid-layout">
            <!-- 좌측: 썸네일 & 파일 -->
            <div class="acc-thumb-area">
                <div class="acc-section-title"><i class='bx bx-image'></i> 사진 및 파일</div>
                <div class="acc-big-thumb" onclick="openModal('${d.id}')">
                    ${thumbUrl ? `<img src="${thumbUrl}" alt="${escapeHtml(d.itemName)}">` : `<div class="text-muted text-center" style="font-size:11px;"><i class='bx bx-image fs-1 d-block mb-1 opacity-50'></i>이미지 없음</div>`}
                </div>
                ${filesHtml}
            </div>

            <!-- 중앙: 상세 커스텀 스펙 -->
            <div>
                <div class="acc-section-title"><i class='bx bx-slider'></i> 상세 규격 및 기술 사양 (${escapeHtml(d.category || '기본')})</div>
                ${specTableHtml}
                ${remarksHtml}
            </div>

            <!-- 우측: 가격/견적 & 전표 액션 -->
            <div>
                <div class="acc-section-title"><i class='bx bx-calculator'></i> 견적 및 관리</div>
                ${pricingHtml}
                <div class="d-flex gap-1 mt-2">
                    <button type="button" class="btn-erp btn-erp-primary flex-fill justify-content-center" onclick="openModal('${d.id}')">
                        <i class='bx bx-edit'></i> 수정
                    </button>
                    <button type="button" class="btn-erp flex-fill justify-content-center" onclick="openModal('${d.id}', true)">
                        <i class='bx bx-copy'></i> 복사
                    </button>
                    <button type="button" class="btn-erp btn-erp-danger flex-fill justify-content-center" onclick="deleteSingle('${d.id}')">
                        <i class='bx bx-trash'></i> 삭제
                    </button>
                </div>
            </div>
        </div>
    </div>`;
}

// ── 행 더블클릭 시 자재 수정 모달 호출 ──
window.onRowDblClick = function(id, event) {
    if (!id) return;
    if (event && event.target) {
        // 체크박스, 펼치기/접기 버튼, 액션 버튼(수정/복사/삭제), 링크 등 내부 상호작용 요소 클릭 시에는 무시
        if (event.target.closest('input[type="checkbox"], button, .btn-grid-action, .btn-expand, a')) {
            return;
        }
    }
    // 더블클릭 시 브라우저 텍스트 블록 선택 해제
    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
    openModal(id);
};

// ── 7. 아코디언 토글 & 호버 팝오버 ──
window.toggleAccordion = function(id, event) {
    if (event) event.stopPropagation();
    const subRow = $('subRow_' + id);
    const btn = $('btnExp_' + id);
    const mainRow = $('row_' + id);
    if (!subRow) return;

    const isHidden = subRow.classList.contains('d-none');
    if (isHidden) {
        subRow.classList.remove('d-none');
        btn?.classList.add('expanded');
        mainRow?.classList.add('selected-row');
    } else {
        subRow.classList.add('d-none');
        btn?.classList.remove('expanded');
        mainRow?.classList.remove('selected-row');
    }
};

window.showImageHover = function(url, title, e) {
    if (!url) return;
    const pop = $('imageHoverPopover');
    const img = $('imageHoverImg');
    const titleEl = $('imageHoverTitle');
    if (!pop || !img) return;

    img.src = url;
    if (titleEl) titleEl.textContent = title || '';

    pop.style.display = 'block';
    const x = Math.min(e.clientX + 15, window.innerWidth - 250);
    const y = Math.min(e.clientY + 15, window.innerHeight - 250);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
};

window.hideImageHover = function() {
    const pop = $('imageHoverPopover');
    if (pop) pop.style.display = 'none';
};

// ── 8. 하단 플로팅 요약 바 & 다중 선택 제어 ──
function updateFloatingBar(event) {
    if (event) event.stopPropagation();
    const checked = Array.from(document.querySelectorAll('.row-check:checked'));
    const bar = $('floatingBar');
    const deleteBtn = $('deleteBtn');
    const badge = $('selectedItemsBadge');

    if (!bar) return;

    if (checked.length > 0) {
        bar.classList.add('show');
        if (deleteBtn) deleteBtn.classList.remove('d-none');
        if (badge) {
            badge.classList.remove('d-none');
            badge.textContent = `${checked.length}건 선택됨`;
        }

        let domesticTotal = 0;
        checked.forEach(cb => {
            const item = allData.find(x => x.id === cb.value);
            if (item && item.sourceType !== 'import') {
                domesticTotal += item.total || 0;
            }
        });

        if ($('floatingCount')) $('floatingCount').textContent = checked.length;
        if ($('floatingDomesticTotal')) $('floatingDomesticTotal').textContent = '₩' + domesticTotal.toLocaleString();
    } else {
        bar.classList.remove('show');
        if (deleteBtn) deleteBtn.classList.add('d-none');
        if (badge) badge.classList.add('d-none');
    }
}

// ── 9. 등록 / 수정 모달 로직 ──
function getFormSnapshot() {
    const vals = ['inpSite','inpEquipment','inpCategory','inpItemName','inpSpec','inpUnit','inpQty','inpPrice','inpManufacturer','inpRemarks','inpQuoteDate'].map(id => $(id)?.value || '');
    const src = document.querySelector('input[name="sourceType"]:checked')?.value || 'domestic';
    const cfVals = [];
    const container = $('modalCustomSectionsContainer');
    if (container) {
        container.querySelectorAll('input').forEach(inp => cfVals.push(inp.value || ''));
    }
    const pkgSnap = JSON.stringify(collectPackagingGroups());
    const syncCheck = $('syncPresetCheck')?.checked ? '1' : '0';
    return JSON.stringify([...vals, src, ...cfVals, pkgSnap, syncCheck, currentFiles.length]);
}

window.openModal = function(id = null, isDuplicate = false) {
    $('itemForm').reset();
    $('inpTotal').value = '';
    currentFiles = [];
    $('customFieldsSection').style.display = 'none';
    if ($('modalCustomSectionsContainer')) $('modalCustomSectionsContainer').innerHTML = '';
    if ($('presetSyncBanner')) $('presetSyncBanner').style.display = 'none';
    if ($('syncPresetCheck')) $('syncPresetCheck').checked = false;
    $('packagingGroupsContainer').innerHTML = '';
    $('srcDomestic').checked = true;
    toggleSourceType();
    renderFileList();

    if (id) {
        const d = allData.find(x => x.id === id);
        if (!d) return;
        $('modalTitle').textContent = isDuplicate ? '자재 규격 복사 등록' : '자재 규격 수정';
        $('editId').value = isDuplicate ? '' : d.id;
        $('inpSite').value = d.site || '';
        $('inpEquipment').value = d.equipment || '';
        $('inpCategory').value = d.category || '';

        let newItemName = d.itemName || '';
        if (isDuplicate && newItemName) newItemName += ' (복사본)';
        $('inpItemName').value = newItemName;

        $('inpSpec').value = d.spec || '';
        $('inpUnit').value = d.unit || 'EA';
        $('inpQty').value = d.qty || 0;
        $('inpPrice').value = d.price || 0;
        $('inpManufacturer').value = d.manufacturer || '';
        $('inpRemarks').value = d.remarks || '';
        $('inpQuoteDate').value = d.quoteDate || '';
        currentFiles = isDuplicate ? [] : (Array.isArray(d.files) ? [...d.files] : []);

        if (d.sourceType === 'import') {
            $('srcImport').checked = true;
            toggleSourceType();
            const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
            if (groups.length) {
                groups.forEach(g => addPackagingGroup(g));
            } else {
                const oldIts = Array.isArray(d.incoterms) ? d.incoterms : [];
                if (oldIts.length || d.qty) {
                    addPackagingGroup({ packaging: '', qty: d.qty || 0, unit: d.unit || 'EA', incoterms: oldIts });
                }
            }
        }
        updateCalc();
        renderFileList();
        if (d.category) {
            let savedLabels = {};
            try {
                if (d.customFieldNotes && d.customFieldNotes['__labels__']) {
                    savedLabels = JSON.parse(d.customFieldNotes['__labels__']);
                }
            } catch(e) {}
            onCategoryChange(null, d.customFields || {}, d.customFieldNotes || {}, savedLabels);
        }
    } else {
        $('modalTitle').textContent = '신규 자재 등록';
        $('editId').value = '';
    }

    $('itemModal').classList.add('active');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { modalSnapshot = getFormSnapshot(); });
};

function confirmCloseModal() {
    const changed = getFormSnapshot() !== modalSnapshot;
    if (!changed || confirm('변경된 내용이 있습니다. 정말 닫으시겠습니까?')) {
        closeModal();
    }
}

function closeModal() {
    $('itemModal').classList.remove('active');
    document.body.style.overflow = '';
}

async function saveItem() {
    const itemName = $('inpItemName')?.value.trim();
    if (!itemName) {
        showToast('품목명을 입력해 주세요.', 'warning');
        $('inpItemName')?.focus();
        return;
    }

    const saveBtn = $('saveItemBtn') || document.querySelector('#itemForm button[type="submit"]') || document.querySelector('#itemForm button.btn-erp-primary');
    const originalBtnHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 저장 중...";
    }

    try {
        const id = $('editId')?.value || '';
        const { customFields, customFieldNotes, customFieldLabels, specFieldList } = modalCollectSpecs();
        if (Object.keys(customFieldLabels).length > 0) {
            customFieldNotes['__labels__'] = JSON.stringify(customFieldLabels);
        }

        const category = $('inpCategory')?.value.trim() || '';
        const sourceType = document.querySelector('input[name="sourceType"]:checked')?.value || 'domestic';
        const isImport = sourceType === 'import';
        const qty = isImport ? 0 : (parseFloat($('inpQty')?.value) || 0);
        const price = isImport ? 0 : (parseFloat($('inpPrice')?.value) || 0);
        const packagingGroups = isImport ? collectPackagingGroups() : [];
        const incoterms = packagingGroups.length ? packagingGroups[0].incoterms || [] : [];
        const perUnitBasis = 0;

        const payload = {
            site: $('inpSite')?.value.trim() || '',
            equipment: $('inpEquipment')?.value.trim() || '',
            category,
            itemName,
            spec: $('inpSpec')?.value.trim() || '',
            unit: $('inpUnit')?.value || 'EA',
            qty, price,
            manufacturer: $('inpManufacturer')?.value.trim() || '',
            remarks: $('inpRemarks')?.value.trim() || '',
            customFields,
            customFieldNotes,
            files: currentFiles || [],
            sourceType,
            quoteDate: $('inpQuoteDate')?.value || '',
            perUnitBasis,
            incoterms,
            packagingGroups
        };

        const url = id ? `${API}/materials/${id}` : `${API}/materials`;
        const method = id ? 'PUT' : 'POST';
        const res = await authFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) {
            // Optional: Preset sync if user checked syncPresetCheck
            if (category && $('syncPresetCheck')?.checked) {
                try {
                    let existingPreset = presetsData.find(x => x.category === category);
                    const presetPayload = {
                        id: existingPreset ? existingPreset.id : `preset_${Date.now()}`,
                        category,
                        fields: specFieldList
                    };
                    const pRes = await authFetch(`${API}/presets`, {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify(presetPayload)
                    });
                    if (pRes.ok) {
                        await loadPresets();
                    }
                } catch(presetErr) {
                    console.error('Preset sync error:', presetErr);
                }
            }

            modalSnapshot = getFormSnapshot();
            showToast(id ? '수정되었습니다.' : '등록되었습니다.', 'success');
            closeModal();
            if (!id) currentPage = 1;
            loadData();
        } else {
            let errMsg = '저장 실패';
            try {
                const err = await res.json();
                if (err && err.error) errMsg += ': ' + err.error;
            } catch(e) {}
            showToast(errMsg, 'error');
        }
    } catch(e) {
        console.error('saveItem error:', e);
        showToast('서버 연결 오류: ' + (e.message || ''), 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnHtml || "<i class='bx bx-save'></i> 저장";
        }
    }
}
window.saveItem = saveItem;

// 단일 삭제
async function deleteSingle(id) {
    if (!confirm('이 자재 규격 항목을 삭제하시겠습니까?')) return;
    try {
        const res = await authFetch(`${API}/materials/delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ids: [id] })
        });
        if (res.ok) {
            showToast('삭제되었습니다.', 'success');
            loadData();
        } else {
            const err = await res.json();
            showToast('삭제 실패: ' + err.error, 'error');
        }
    } catch(e) {
        showToast('서버 연결 오류', 'error');
    }
}

// 다중 선택 삭제
async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (!ids.length) return showToast('삭제할 항목을 선택해주세요.', 'warning');
    if (!confirm(`선택한 ${ids.length}개 항목을 일괄 삭제하시겠습니까?`)) return;
    try {
        const res = await authFetch(`${API}/materials/delete`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ ids })
        });
        if (res.ok) {
            showToast('선택 항목이 삭제되었습니다.', 'success');
            loadData();
        } else {
            const err = await res.json();
            showToast('삭제 실패: ' + err.error, 'error');
        }
    } catch(e) {
        showToast('서버 연결 오류', 'error');
    }
}

// ── 10. 수입/국내 및 패키징 관리 ──
function toggleSourceType() {
    const isImport = $('srcImport').checked;
    $('domesticFields').style.display = isImport ? 'none' : '';
    $('importFields').style.display = isImport ? '' : 'none';
}

function updateCalc() {
    const q = parseInt($('inpQty')?.value) || 0;
    const p = parseInt($('inpPrice')?.value) || 0;
    $('inpTotal').value = (q * p) > 0 ? '₩' + (q * p).toLocaleString() : '';
}

function addPackagingGroup(data) {
    const container = $('packagingGroupsContainer');
    const group = document.createElement('div');
    group.className = 'pkg-group';
    group.innerHTML = `
        <div class="pkg-group-header">
            <i class='bx bx-package pkg-icon text-warning'></i>
            <input type="text" class="pkg-name" placeholder="포장단위 (예: Drum 200L, Bulk, IBC 등)" value="${escapeHtml(data?.packaging || '')}">
            <button type="button" class="btn-grid-action btn-grid-action-danger ms-auto pkg-del" title="삭제"><i class='bx bx-trash'></i></button>
        </div>
        <div class="pkg-group-body">
            <div class="erp-form-grid mb-1">
                <div class="fg">
                    <label>수량</label>
                    <input type="number" class="pkg-qty" placeholder="0" min="0" step="any" value="${data?.qty || ''}">
                </div>
                <div class="fg">
                    <label>단위</label>
                    <select class="pkg-unit">
                        ${['EA','SET','BOX','M','KG','L','TON','ROLL','DRUM','IBC','BAG','PAIL'].map(u => `<option value="${u}"${u === (data?.unit || 'EA') ? ' selected' : ''}>${u}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="pkg-incoterms"></div>
            <button type="button" class="btn-erp btn-erp-warning mt-1 pkg-add-it">
                <i class='bx bx-plus'></i> Incoterms 추가
            </button>
        </div>`;

    group.querySelector('.pkg-del').addEventListener('click', () => {
        if (confirm('이 포장단위 그룹을 삭제하시겠습니까?')) group.remove();
    });
    group.querySelector('.pkg-add-it').addEventListener('click', () => {
        addIncotermToGroup(group);
    });

    container.appendChild(group);

    if (data?.incoterms?.length) {
        data.incoterms.forEach(it => addIncotermToGroup(group, it.term, it.price, it.currency));
    }
    return group;
}

function addIncotermToGroup(groupEl, term, price, currency) {
    const container = groupEl.querySelector('.pkg-incoterms');
    const row = document.createElement('div');
    row.className = 'd-flex align-items-center gap-1 mt-1';
    row.innerHTML = `
        <select class="form-select form-select-sm it-term" style="width:80px;height:26px;font-size:11px;padding:2px 20px 2px 8px;">${INCOTERMS_LIST.map(t => `<option value="${t}"${t === term ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <select class="form-select form-select-sm it-currency" style="width:115px;height:26px;font-size:11px;padding:2px 22px 2px 8px;">${CURRENCY_LIST.map(c => `<option value="${c.code}"${c.code === (currency || 'USD') ? ' selected' : ''}>${c.label}</option>`).join('')}</select>
        <input type="number" class="form-control form-control-sm it-price" placeholder="가격" min="0" step="any" value="${price || ''}" style="height:26px;font-size:11px;">
        <button type="button" class="btn-grid-action btn-grid-action-danger it-del" title="삭제"><i class='bx bx-x'></i></button>`;
    row.querySelector('.it-del').addEventListener('click', () => row.remove());
    container.appendChild(row);
}

function collectPackagingGroups() {
    const groups = [];
    $('packagingGroupsContainer')?.querySelectorAll('.pkg-group').forEach(g => {
        const packaging = g.querySelector('.pkg-name')?.value.trim() || '';
        const qty = parseFloat(g.querySelector('.pkg-qty')?.value) || 0;
        const unit = g.querySelector('.pkg-unit')?.value || 'EA';
        const incoterms = [];
        g.querySelectorAll('.it-term').forEach((termEl, i) => {
            const term = termEl.value;
            const currencyEl = g.querySelectorAll('.it-currency')[i];
            const currency = currencyEl ? currencyEl.value : 'USD';
            const priceEl = g.querySelectorAll('.it-price')[i];
            const p = parseFloat(priceEl?.value) || 0;
            if (term && p > 0) incoterms.push({ term, price: p, currency });
        });
        groups.push({ packaging, qty, unit, incoterms });
    });
    return groups;
}

// ── 11. 커스텀 사양 필드 모달 인라인 편집 및 프리셋 연동 ──

function modalAddFieldRow(fieldsBox, fieldData = {}, val = '', note = '') {
    const row = document.createElement('div');
    row.className = 'modal-spec-row';
    const key = fieldData.key || `tmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    row.dataset.fieldKey = key;

    const initialLabel = fieldData.label || '';
    const initialVal = val != null ? String(val) : '';
    const initialNote = note != null && note !== '' ? String(note) : (fieldData.note || '');

    row.innerHTML = `
        <button type="button" class="f-drag" title="순서 드래그"><i class='bx bx-grid-vertical'></i></button>
        <input type="text" class="spec-field-label" value="${escapeHtml(initialLabel)}" placeholder="사양 항목명 (예: 비중)">
        <input type="text" class="spec-field-val" value="${escapeHtml(initialVal)}" placeholder="측정값 / 규격치">
        <input type="text" class="spec-field-note" value="${escapeHtml(initialNote)}" placeholder="시험규격/단위/비고">
        <button type="button" class="btn-grid-action btn-grid-action-danger f-del-btn" title="항목 삭제"><i class='bx bx-x'></i></button>
    `;

    row.querySelector('.f-del-btn').addEventListener('click', () => {
        row.remove();
    });

    fieldsBox.appendChild(row);
    setupDragAndDrop(fieldsBox, '.modal-spec-row', '.f-drag', 'field');
    return row;
}

function modalRenderSection(sectionData, vals = {}, notes = {}, labels = {}) {
    const container = $('modalCustomSectionsContainer');
    if (!container) return null;

    const sec = document.createElement('div');
    sec.className = 'modal-spec-section';

    sec.innerHTML = `
        <div class="modal-spec-sec-header">
            <button type="button" class="sec-drag" title="섹션 순서 드래그"><i class='bx bx-grid-vertical'></i></button>
            <i class='bx bx-folder text-primary' style="font-size:13px;"></i>
            <input type="text" class="sec-title-inp" value="${escapeHtml(sectionData.label || '기본 사양')}" placeholder="섹션 그룹명 (예: 물리적 특성, 배합비 등)">
            <button type="button" class="btn-erp btn-erp-sm sec-add-f-btn ms-auto" title="이 섹션에 사양 항목 추가">
                <i class='bx bx-plus'></i> 항목 추가
            </button>
            <button type="button" class="btn-grid-action btn-grid-action-danger sec-del-btn" title="섹션 삭제">
                <i class='bx bx-trash'></i>
            </button>
        </div>
        <div class="modal-spec-sec-body p-1" style="background:#f8fafc;">
            <div class="modal-spec-fields-box d-flex flex-column gap-1"></div>
        </div>
    `;

    const fieldsBox = sec.querySelector('.modal-spec-fields-box');
    const addFieldBtn = sec.querySelector('.sec-add-f-btn');
    const delSecBtn = sec.querySelector('.sec-del-btn');

    addFieldBtn.addEventListener('click', () => {
        const newRow = modalAddFieldRow(fieldsBox);
        newRow.querySelector('.spec-field-label')?.focus();
    });

    delSecBtn.addEventListener('click', () => {
        const rowCount = fieldsBox.querySelectorAll('.modal-spec-row').length;
        if (rowCount > 0 && !confirm(`'${sec.querySelector('.sec-title-inp')?.value || '이 섹션'}' 및 포함된 ${rowCount}개 항목을 모두 삭제하시겠습니까?`)) {
            return;
        }
        sec.remove();
    });

    if (Array.isArray(sectionData.fields) && sectionData.fields.length > 0) {
        sectionData.fields.forEach(f => {
            const v = vals[f.key];
            const n = notes[f.key] || f.note || '';
            const lbl = (labels && labels[f.key]) || f.label || '';
            modalAddFieldRow(fieldsBox, { ...f, label: lbl }, v, n);
        });
    } else {
        modalAddFieldRow(fieldsBox);
    }

    container.appendChild(sec);
    setupDragAndDrop(container, '.modal-spec-section', '.sec-drag', 'section');
    return sec;
}

function modalAddSection(title = '신규 사양 그룹') {
    const sec = modalRenderSection({ label: title, fields: [] });
    if (sec) {
        const titleInp = sec.querySelector('.sec-title-inp');
        titleInp?.focus();
        titleInp?.select();
    }
}

function modalAddField() {
    const container = $('modalCustomSectionsContainer');
    if (!container) return;
    let lastSec = container.querySelector('.modal-spec-section:last-child');
    if (!lastSec) {
        lastSec = modalRenderSection({ label: '기본 사양', fields: [] });
    }
    const fieldsBox = lastSec.querySelector('.modal-spec-fields-box');
    const newRow = modalAddFieldRow(fieldsBox);
    newRow.querySelector('.spec-field-label')?.focus();
}

function modalCollectSpecs() {
    const customFields = {};
    const customFieldNotes = {};
    const customFieldLabels = {};
    const specFieldList = [];
    
    const container = $('modalCustomSectionsContainer');
    if (!container) return { customFields, customFieldNotes, customFieldLabels, specFieldList };

    const sections = container.querySelectorAll('.modal-spec-section');
    sections.forEach(secEl => {
        const secTitle = secEl.querySelector('.sec-title-inp')?.value.trim() || '기본 사양';
        specFieldList.push({
            key: '_section_' + specFieldList.length,
            label: secTitle,
            type: 'section'
        });

        const rows = secEl.querySelectorAll('.modal-spec-row');
        rows.forEach(row => {
            const label = row.querySelector('.spec-field-label')?.value.trim();
            const val = row.querySelector('.spec-field-val')?.value.trim() || '';
            const note = row.querySelector('.spec-field-note')?.value.trim() || '';
            let key = row.dataset.fieldKey;

            if (!label) return; // 항목명이 빈 행은 스킵

            if (!key || key.startsWith('tmp_')) {
                const baseKey = label.replace(/[^a-zA-Z0-9가-힣]/g, '_').toLowerCase() || 'field_' + specFieldList.length;
                key = baseKey;
                let counter = 1;
                while (specFieldList.some(f => f.key === key)) {
                    key = `${baseKey}_${counter++}`;
                }
                row.dataset.fieldKey = key;
            }

            customFields[key] = val;
            if (note) customFieldNotes[key] = note;
            customFieldLabels[key] = label;

            specFieldList.push({
                key,
                label,
                type: 'text',
                note
            });
        });
    });

    return { customFields, customFieldNotes, customFieldLabels, specFieldList };
}

function onCategoryChange(e, existingValues = {}, existingNotes = {}, existingLabels = {}) {
    const cat = $('inpCategory')?.value.trim();
    const section = $('customFieldsSection');
    const container = $('modalCustomSectionsContainer');
    const syncBanner = $('presetSyncBanner');
    const syncCatName = $('syncPresetCatName');
    const syncCheck = $('syncPresetCheck');

    if (!section || !container) return;

    if (!cat) {
        section.style.display = 'none';
        container.innerHTML = '';
        if (syncBanner) syncBanner.style.display = 'none';
        return;
    }

    section.style.display = '';
    $('customFieldsSectionTitle').textContent = `${cat} — 사양 필드 구성`;
    container.innerHTML = '';

    if (syncBanner) {
        syncBanner.style.display = 'flex';
        if (syncCatName) syncCatName.textContent = cat;
        if (syncCheck) syncCheck.checked = false;
    }

    const preset = presetsData.find(p => p.category === cat);
    const sections = groupFieldsIntoSections(preset?.fields || []);

    const vals = existingValues || {};
    const notes = existingNotes || {};
    let labels = existingLabels || {};

    if (notes['__labels__']) {
        try {
            labels = { ...JSON.parse(notes['__labels__']), ...labels };
        } catch(err) {}
    }

    const presetKeys = new Set();
    (preset?.fields || []).forEach(f => {
        if (f.key && f.type !== 'section') presetKeys.add(f.key);
    });

    const orphanKeys = Object.keys(vals).filter(k => 
        !k.startsWith('__') && !presetKeys.has(k) && vals[k] != null && String(vals[k]).trim() !== ''
    );

    if (sections.length === 0) {
        if (orphanKeys.length > 0) {
            const orphanFields = orphanKeys.map(k => ({
                key: k,
                label: labels[k] || k.replace(/_/g, ' '),
                type: 'text',
                note: notes[k] || ''
            }));
            modalRenderSection({ label: '사양 정보', fields: orphanFields }, vals, notes, labels);
        } else {
            modalRenderSection({ label: '기본 사양', fields: [] }, vals, notes, labels);
        }
    } else {
        sections.forEach(sec => modalRenderSection(sec, vals, notes, labels));

        if (orphanKeys.length > 0) {
            const orphanFields = orphanKeys.map(k => ({
                key: k,
                label: labels[k] || k.replace(/_/g, ' '),
                type: 'text',
                note: notes[k] || ''
            }));
            modalRenderSection({ label: '기타 특화 사양', fields: orphanFields }, vals, notes, labels);
        }
    }
}

// ── 12. 첨부파일 업로드 및 관리 ──
async function uploadFiles(fileList) {
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    try {
        showToast('파일 업로드 중...', 'info');
        const res = await authFetch(`${API}/files/upload`, { method: 'POST', body: formData });
        if (res.ok) {
            const data = await res.json();
            data.files.forEach(f => currentFiles.push(f));
            renderFileList();
            showToast('업로드 완료', 'success');
        } else {
            const err = await res.json();
            showToast('업로드 실패: ' + err.error, 'error');
        }
    } catch(e) {
        showToast('업로드 오류', 'error');
    }
}

function renderFileList() {
    const el = $('fileList');
    if (!el) return;
    el.innerHTML = '';
    currentFiles.forEach((f, i) => {
        const ext = (f.originalName || f.filename || '').split('.').pop().toLowerCase();
        let icon = 'bx-file';
        if (['pdf'].includes(ext)) icon = 'bx-file-blank text-danger';
        else if (['xlsx','xls','csv'].includes(ext)) icon = 'bx-spreadsheet text-success';
        else if (['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) icon = 'bx-image text-primary';

        const sizeStr = f.size ? (f.size < 1024*1024 ? Math.round(f.size/1024) + 'KB' : (f.size/1024/1024).toFixed(1) + 'MB') : '';
        const downloadUrl = f.url || `${API}/uploads/${f.filename}`;

        const row = document.createElement('div');
        row.className = 'd-flex align-items-center justify-content-between p-1 px-2 border rounded bg-white mt-1';
        row.innerHTML = `
            <div class="d-flex align-items-center gap-1 overflow-hidden">
                <i class='bx ${icon}'></i>
                <span class="text-truncate" style="max-width:260px; font-size:11px;">${escapeHtml(f.originalName || f.filename)}</span>
                <span class="text-muted" style="font-size:10px;">(${sizeStr})</span>
            </div>
            <div class="d-flex gap-1">
                <a href="${downloadUrl}" target="_blank" download class="btn-grid-action text-decoration-none" title="다운로드"><i class='bx bx-download'></i></a>
                <button type="button" class="btn-grid-action btn-grid-action-danger" onclick="removeFile(${i})" title="삭제"><i class='bx bx-trash'></i></button>
            </div>`;
        el.appendChild(row);
    });
}

window.removeFile = function(idx) {
    if (confirm('이 파일을 삭제하시겠습니까?')) {
        const f = currentFiles[idx];
        authFetch(`${API}/files/${f.filename}`, { method: 'DELETE' }).catch(() => {});
        currentFiles.splice(idx, 1);
        renderFileList();
    }
};

// ── 13. 프리셋 드로어 (Preset Drawer) ──
function openPresetDrawer() {
    $('drawerOverlay').classList.add('active');
    $('presetDrawer').classList.add('open');
    document.body.style.overflow = 'hidden';
    renderDrawerCategories();

    let targetPreset = null;
    if (activeCategoryFilter && activeCategoryFilter !== 'all') {
        targetPreset = presetsData.find(p => p.category === activeCategoryFilter);
    }
    if (!targetPreset && presetsData.length > 0) {
        targetPreset = presetsData[0];
    }

    if (targetPreset) {
        selectDrawerPreset(targetPreset.id);
    } else {
        selectedPresetId = null;
        $('drawerNoSelection').style.display = '';
        $('drawerEditorContent').style.display = 'none';
    }
}

function closePresetDrawer() {
    $('drawerOverlay').classList.remove('active');
    $('presetDrawer').classList.remove('open');
    document.body.style.overflow = '';
}

function renderDrawerCategories() {
    const el = $('drawerCatList');
    if (!el) return;
    el.innerHTML = '';
    presetsData.forEach(p => {
        const chip = document.createElement('button');
        chip.className = 'drawer-cat-chip' + (p.id === selectedPresetId ? ' active' : '');
        chip.innerHTML = `<span>${escapeHtml(p.category)}</span><i class='bx bx-x cat-del' style="cursor:pointer;"></i>`;
        chip.querySelector('span').addEventListener('click', () => selectDrawerPreset(p.id));
        chip.querySelector('.cat-del').addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm(`"${p.category}" 분류 프리셋을 삭제하시겠습니까?`)) return;
            try {
                await authFetch(`${API}/presets/${p.id}`, { method: 'DELETE' });
                await loadPresets();
                if (selectedPresetId === p.id) {
                    selectedPresetId = null;
                    $('drawerNoSelection').style.display = '';
                    $('drawerEditorContent').style.display = 'none';
                }
                renderDrawerCategories();
                renderCategoryTabs();
                showToast('삭제되었습니다.', 'success');
            } catch(e2) {
                showToast('삭제 실패', 'error');
            }
        });
        el.appendChild(chip);
    });
}

function groupFieldsIntoSections(fields) {
    const sections = [];
    let cur = null;
    (fields || []).forEach(f => {
        if (f.type === 'section') {
            cur = { label: f.label || '', fields: [] };
            sections.push(cur);
        } else {
            if (!cur) { cur = { label: '기본 사양', fields: [] }; sections.push(cur); }
            cur.fields.push({ key: f.key, label: f.label || '', type: f.type || 'text', note: f.note || '' });
        }
    });
    return sections;
}

function selectDrawerPreset(id) {
    selectedPresetId = id;
    const p = presetsData.find(x => x.id === id);
    if (!p) return;
    $('drawerNoSelection').style.display = 'none';
    $('drawerEditorContent').style.display = '';
    $('drawerEditorTitle').textContent = `"${p.category}" 사양 필드 설정`;
    renderDrawerCategories();

    const sections = groupFieldsIntoSections(p.fields);
    const list = $('drawerSectionList');
    list.innerHTML = '';
    if (sections.length === 0) {
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
            <button type="button" class="sec-drag" title="순서 드래그"><i class='bx bx-grid-vertical'></i></button>
            <i class='bx bx-category text-primary'></i>
            <textarea class="sec-label" placeholder="섹션명 입력 (예: 물리적 특성)" rows="1">${sectionData?.label || ''}</textarea>
            <button type="button" class="btn-grid-action btn-grid-action-danger ms-auto sec-del" title="삭제"><i class='bx bx-trash'></i></button>
        </div>
        <div class="section-card-body">
            <div class="sec-fields"></div>
            <button type="button" class="sec-add-field"><i class='bx bx-plus'></i> 사양 필드 추가</button>
        </div>`;

    card.querySelector('.sec-del').addEventListener('click', () => {
        if (card.querySelectorAll('.sec-field-row').length > 0 && !confirm('이 섹션과 포함된 필드를 모두 삭제하시겠습니까?')) return;
        card.remove();
    });

    const addBtn = card.querySelector('.sec-add-field');
    const fieldsContainer = card.querySelector('.sec-fields');

    addBtn.addEventListener('click', () => addFieldRow(fieldsContainer));

    if (sectionData?.fields?.length) {
        sectionData.fields.forEach(f => addFieldRow(fieldsContainer, f));
    } else {
        addFieldRow(fieldsContainer);
    }

    list.appendChild(card);
    setupDragAndDrop(list, '.section-card', '.sec-drag', 'section');
}

function addFieldRow(container, fieldData) {
    const row = document.createElement('div');
    row.className = 'sec-field-row';
    row.innerHTML = `
        <button type="button" class="f-drag" title="순서 드래그"><i class='bx bx-grid-vertical'></i></button>
        <span class="f-order text-muted" style="font-size:10px;">${container.children.length + 1}</span>
        <textarea class="sf-label" placeholder="필드명 (예: 정격 압력)" rows="1" style="height:26px;resize:none;font-size:11.5px;">${fieldData?.label || ''}</textarea>
        <select class="sf-type">
            <option value="text"${fieldData?.type === 'text' ? ' selected' : ''}>텍스트</option>
            <option value="number"${fieldData?.type === 'number' ? ' selected' : ''}>숫자</option>
        </select>
        <input type="text" class="sf-note" placeholder="안내/비고" value="${fieldData?.note || ''}">
        <button type="button" class="btn-grid-action btn-grid-action-danger f-del" title="삭제"><i class='bx bx-x'></i></button>`;

    row.querySelector('.f-del').addEventListener('click', () => {
        row.remove();
        reorderSectionFields(container);
    });

    container.appendChild(row);
    setupDragAndDrop(container, '.sec-field-row', '.f-drag', 'field');
}

function reorderSectionFields(container) {
    container.querySelectorAll('.sec-field-row').forEach((r, i) => {
        const orderEl = r.querySelector('.f-order');
        if (orderEl) orderEl.textContent = i + 1;
    });
}

function addSectionCard() {
    renderSectionCard({ label: '신규 섹션', fields: [] });
}

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
                const baseKey = label.replace(/[^a-zA-Z0-9가-힣]/g, '_').toLowerCase() || 'field_' + fields.length;
                let key = baseKey;
                let counter = 1;
                while (fields.some(f => f.key === key)) {
                    key = baseKey + '_' + counter;
                    counter++;
                }
                fields.push({ key, label, type, note });
            }
        });
    });
    return fields;
}

async function saveCurrentPreset() {
    if (!selectedPresetId) {
        showToast('설정할 자재 분류를 먼저 선택해 주세요.', 'warning');
        return;
    }
    const preset = presetsData.find(x => x.id === selectedPresetId);
    if (!preset) {
        showToast('선택된 프리셋 정보를 찾을 수 없습니다.', 'warning');
        return;
    }

    const saveBtn = $('saveDrawerBtn');
    const origHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 저장 중...";
    }

    const fields = flattenSections();
    const payload = { ...preset, fields };

    try {
        const res = await authFetch(`${API}/presets`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(`"${preset.category}" 프리셋이 저장되었습니다.`, 'success');
            await loadPresets();
            renderDrawerCategories();
            selectDrawerPreset(selectedPresetId);
            renderCategoryTabs();
            applyFiltersAndSort();
        } else {
            let errMsg = '저장 실패';
            try {
                const err = await res.json();
                if (err && err.error) errMsg += ': ' + err.error;
            } catch(e) {}
            showToast(errMsg, 'error');
        }
    } catch(e) {
        console.error('saveCurrentPreset error:', e);
        showToast('서버 오류: ' + (e.message || ''), 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = origHtml || "<i class='bx bx-save'></i> 저장";
        }
    }
}
window.saveCurrentPreset = saveCurrentPreset;

function addPresetCategory() {
    const name = prompt('새 자재 분류명을 입력하세요:');
    if (!name || !name.trim()) return;
    const id = 'TBMFP-' + Date.now() + '-' + Math.random().toString(36).substring(2,6);
    const payload = { id, category: name.trim(), fields: [] };
    authFetch(`${API}/presets`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    })
    .then(async res => {
        if (res.ok) {
            showToast('분류 추가 완료', 'success');
            await loadPresets();
            renderDrawerCategories();
            renderCategoryTabs();
            selectDrawerPreset(id);
        } else {
            showToast('추가 실패', 'error');
        }
    })
    .catch(() => showToast('서버 오류', 'error'));
}

function setupDragAndDrop(container, selector, handleSelector, type) {
    let dragState = { el: null, active: false };

    container.querySelectorAll(selector).forEach(item => {
        const handle = item.querySelector(handleSelector);
        if (!handle || handle.dataset.dragInit) return;
        handle.dataset.dragInit = 'true';

        handle.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            dragState.el = item;
            dragState.active = true;
            item.classList.add('dragging');
            document.body.style.userSelect = 'none';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    });

    function onMouseMove(e) {
        if (!dragState.active || !dragState.el) return;
        const items = [...container.querySelectorAll(selector + ':not(.dragging)')];
        for (const item of items) {
            const rect = item.getBoundingClientRect();
            if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
                container.querySelectorAll(selector).forEach(s => s.classList.remove('drag-over'));
                item.classList.add('drag-over');
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
        dragState.active = false;
        dragState.el = null;
    }
}

// ── 14. 엑셀 내보내기 ──
function exportExcel() {
    if (!filteredData.length) return showToast('내보낼 데이터가 없습니다.', 'warning');
    const rows = filteredData.map(d => {
        const row = {
            '구분': d.sourceType === 'import' ? '수입' : '국내',
            '현장명': d.site,
            '장비명': d.equipment,
            '분류': d.category,
            '품목명': d.itemName,
            '규격/모델': d.spec,
            '제조사': d.manufacturer,
            '단위': d.unit,
            '수량': d.qty,
            '단가': d.price,
            '합계': d.total,
            '견적일': d.quoteDate || '',
            '비고': d.remarks
        };
        if (d.customFields && typeof d.customFields === 'object') {
            Object.entries(d.customFields).forEach(([k, v]) => { row[k] = v; });
        }
        return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TBM 자재 규격');
    XLSX.writeFile(wb, `TBM_자재규격_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('엑셀 파일이 다운로드됩니다.', 'success');
}

// ── 15. 자재 비교 (Compare Modal) ──
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

    const basicRows = [
        ['품목명', d => d.itemName || '-'],
        ['규격/모델', d => d.spec || '-'],
        ['제조사', d => d.manufacturer || '-'],
        ['현장명', d => d.site || '-'],
        ['장비명', d => d.equipment || '-'],
        ['구분', d => d.sourceType === 'import' ? '수입' : '국내'],
        ['수량 (국내)', d => d.sourceType === 'import' ? '-' : `${d.qty || 0} ${d.unit || 'EA'}`],
        ['단가 (국내)', d => d.sourceType === 'import' ? '-' : '₩' + fmtN(d.price)],
        ['합계 (국내)', d => d.sourceType === 'import' ? '-' : '₩' + fmtN(d.total)],
        ['수입 견적 (포장 및 조건별)', d => {
            if (d.sourceType !== 'import') return '-';
            const groups = Array.isArray(d.packagingGroups) ? d.packagingGroups : [];
            if (!groups.length) {
                const oldIts = Array.isArray(d.incoterms) ? d.incoterms : [];
                if (!oldIts.length) return '<span class="text-muted">가격 미입력</span>';
                return oldIts.map(it => {
                    const sym = currencySymbol(it.currency || 'KRW');
                    return `<div>- <strong>${escapeHtml(it.term)}</strong>: ${sym}${fmtDec(it.price)}${formatKrwApprox(it.price, it.currency)}</div>`;
                }).join('');
            }
            return groups.map(g => {
                const label = g.packaging || '미지정';
                const qtyStr = g.qty ? `(${fmtDec(g.qty)} ${g.unit || ''})` : '';
                const itsHtml = (g.incoterms || []).map(it => {
                    const sym = currencySymbol(it.currency || 'KRW');
                    return `<div>- <strong>${escapeHtml(it.term)}</strong>: ${sym}${fmtDec(it.price)}${formatKrwApprox(it.price, it.currency)}</div>`;
                }).join('');
                return `<div class="mb-1"><strong>📦 ${escapeHtml(label)} ${qtyStr}</strong>${itsHtml || '<div class="text-muted">미입력</div>'}</div>`;
            }).join('');
        }]
    ];

    let html = `<table class="compare-table"><thead><tr><th style="width:140px;">${escapeHtml(cat)} 비교 (${n}개)</th>`;
    compareItems.forEach(d => { html += `<th>${escapeHtml(d.itemName || d.spec || '-')}</th>`; });
    html += '</tr></thead><tbody>';

    basicRows.forEach(([label, fn]) => {
        const vals = compareItems.map(fn);
        const allSame = vals.every(v => v === vals[0]);
        html += `<tr><td class="compare-label">${label}</td>`;
        vals.forEach(v => { html += `<td class="${allSame ? '' : 'compare-diff'}">${v}</td>`; });
        html += '</tr>';
    });

    const presetKeySet = new Set();
    if (fields.length) {
        fields.forEach(f => {
            if (f.type === 'section') {
                html += `<tr class="table-light"><td colspan="${n + 1}" class="text-primary fw-bold" style="background:#eff6ff !important;"><i class='bx bx-chevron-right'></i> ${(f.label || '').replace(/\n/g, ' / ')}</td></tr>`;
            } else {
                presetKeySet.add(f.key);
                const lbl = (f.label || '').replace(/\n/g, ' / ');
                const vals = compareItems.map(d => {
                    const v = (d.customFields || {})[f.key] || '-';
                    const note = (d.customFieldNotes || {})[f.key];
                    return (note && !f.key.startsWith('__')) ? `${escapeHtml(v)} <span class="badge bg-light text-secondary border">${escapeHtml(note)}</span>` : escapeHtml(v);
                });
                const rawVals = compareItems.map(d => (d.customFields || {})[f.key] || '-');
                const allSame = rawVals.every(v => v === rawVals[0]);
                html += `<tr><td class="compare-label">${lbl}</td>`;
                vals.forEach(v => { html += `<td class="${allSame ? '' : 'compare-diff'}">${v}</td>`; });
                html += '</tr>';
            }
        });
    }

    // 비교 대상 자재들에 포함된 기타 특화 사양 수집
    const extraKeysMap = new Map();
    compareItems.forEach(d => {
        let savedLabels = {};
        try {
            if (d.customFieldNotes && d.customFieldNotes['__labels__']) {
                savedLabels = JSON.parse(d.customFieldNotes['__labels__']);
            }
        } catch(e) {}
        const cfs = d.customFields || {};
        Object.keys(cfs).forEach(k => {
            if (!k.startsWith('__') && !presetKeySet.has(k) && cfs[k] != null && String(cfs[k]).trim() !== '') {
                if (!extraKeysMap.has(k)) {
                    extraKeysMap.set(k, savedLabels[k] || k.replace(/_/g, ' '));
                }
            }
        });
    });

    if (extraKeysMap.size > 0) {
        html += `<tr class="table-light"><td colspan="${n + 1}" class="text-primary fw-bold" style="background:#eff6ff !important;"><i class='bx bx-chevron-right'></i> 기타 특화 사양</td></tr>`;
        extraKeysMap.forEach((lbl, k) => {
            const vals = compareItems.map(d => {
                const v = (d.customFields || {})[k] || '-';
                const note = (d.customFieldNotes || {})[k];
                return (note && !k.startsWith('__')) ? `${escapeHtml(v)} <span class="badge bg-light text-secondary border">${escapeHtml(note)}</span>` : escapeHtml(v);
            });
            const rawVals = compareItems.map(d => (d.customFields || {})[k] || '-');
            const allSame = rawVals.every(v => v === rawVals[0]);
            html += `<tr><td class="compare-label">${escapeHtml(lbl)}</td>`;
            vals.forEach(v => { html += `<td class="${allSame ? '' : 'compare-diff'}">${v}</td>`; });
            html += '</tr>';
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
    const header = ['항목', ...compareItems.map(d => d.itemName || d.spec || '-')];
    rows.push(header);

    [['품목명','itemName'],['규격/모델','spec'],['제조사','manufacturer'],['현장명','site'],['장비명','equipment'],['수량','qty'],['단가','price'],['합계','total']].forEach(([lbl,key]) => {
        rows.push([lbl, ...compareItems.map(d => key === 'price' || key === 'total' ? d[key] || 0 : d[key] || '-')]);
    });

    const presetKeySet = new Set();
    fields.forEach(f => {
        if (f.type === 'section') {
            rows.push([`[${(f.label || '').replace(/\n/g, ' ')}]`]);
        } else {
            presetKeySet.add(f.key);
            rows.push([(f.label || '').replace(/\n/g, ' '), ...compareItems.map(d => (d.customFields || {})[f.key] || '-')]);
        }
    });

    const extraKeysMap = new Map();
    compareItems.forEach(d => {
        let savedLabels = {};
        try {
            if (d.customFieldNotes && d.customFieldNotes['__labels__']) {
                savedLabels = JSON.parse(d.customFieldNotes['__labels__']);
            }
        } catch(e) {}
        const cfs = d.customFields || {};
        Object.keys(cfs).forEach(k => {
            if (!k.startsWith('__') && !presetKeySet.has(k) && cfs[k] != null && String(cfs[k]).trim() !== '') {
                if (!extraKeysMap.has(k)) {
                    extraKeysMap.set(k, savedLabels[k] || k.replace(/_/g, ' '));
                }
            }
        });
    });

    if (extraKeysMap.size > 0) {
        rows.push(['[기타 특화 사양]']);
        extraKeysMap.forEach((lbl, k) => {
            rows.push([lbl, ...compareItems.map(d => (d.customFields || {})[k] || '-')]);
        });
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '자재 비교');
    XLSX.writeFile(wb, `TBM_자재비교_${cat}_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('비교표 엑셀 다운로드', 'success');
}
