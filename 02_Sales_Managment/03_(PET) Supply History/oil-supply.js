/* =========================================================================
   유류 자재 공급 내역 V3 (oil-supply.js)
   - 다건 등록, 커스텀 자동완성, 키보드 네비게이션, 모노톤 UI
   ========================================================================= */

// --- authFetch: JWT 토큰을 자동으로 실어 보내는 fetch 래퍼 ---
async function authFetch(url, options = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
}

const API_BASE = 'https://kng.junparks.com/api/oil-supply-history';
let itemsData = [];
let filteredData = [];
let currentSort = { column: 'date', asc: false };
let currentPage = 1;
let pageSize = 50;
let activeFilters = [];
const fieldLabels = { all: '통합검색', site: '현장명', supplier: '공급사', manufacturer: '제조사', item: '품명', category: '구분' };
const fieldOptions = [['all', '통합검색'], ['site', '현장명'], ['supplier', '공급사'], ['manufacturer', '제조사'], ['item', '품명'], ['category', '구분']];

// Autocomplete data pools
let acPools = { site: [], supplier: [], manufacturer: [], category: [], item: [], spec: [] };
const CATEGORY_DEFAULTS = ['유압유','기어유','그리스','테일씰그리스','절삭유','안전용품','기타'];

const $ = id => document.getElementById(id);
const elTableBody = $('dataTable').querySelector('tbody');
const elTotalCount = $('totalCount');
const elStartDate = $('searchStartDate');
const elEndDate = $('searchEndDate');
const elPagination = $('pagination');
const elSelectAll = $('selectAll');
const itemModal = $('itemModal');
const itemForm = $('itemForm');

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData();
});

const debouncedSearch = debounce(() => { currentPage = 1; applyFiltersAndSort(); }, 300);

function initEvents() {
    elStartDate?.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });
    elEndDate?.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });

    $('btn-add-condition')?.addEventListener('click', () => KngSearchEngine.addConditionRow('search-conditions', fieldOptions));
    $('btn-clear-search')?.addEventListener('click', () => {
        const container = $('search-conditions');
        if (container) {
            container.innerHTML = '';
            const row = document.createElement('div');
            row.className = 'si-condition-row';
            row.innerHTML = `<select class="si-field-select" data-role="field">${fieldOptions.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select><input type="text" class="si-search-input" data-role="query" placeholder="검색어 입력...">`;
            row.querySelector('.si-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-do-search')?.click(); });
            container.appendChild(row);
        }
        activeFilters = [];
        if (elStartDate) elStartDate.value = '';
        if (elEndDate) elEndDate.value = '';
        currentPage = 1;
        applyFiltersAndSort();
    });
    $('btn-do-search')?.addEventListener('click', () => {
        activeFilters = KngSearchEngine.getConditionsFromBar('search-conditions');
        currentPage = 1;
        applyFiltersAndSort();
    });
    document.querySelector('#search-conditions .si-search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('btn-do-search')?.click();
    });

    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-sort');
            currentSort.asc = currentSort.column === key ? !currentSort.asc : true;
            currentSort.column = key;
            updateSortUI(currentSort.column, currentSort.asc);
            applyFiltersAndSort();
        });
    });

    elSelectAll.addEventListener('change', e => {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    $('addBtn').addEventListener('click', () => openModal());
    $('deleteBtn').addEventListener('click', deleteSelected);
    $('closeModalBtn').addEventListener('click', closeModal);
    $('cancelBtn').addEventListener('click', closeModal);
    window.addEventListener('click', e => { if (e.target === itemModal) closeModal(); });
    itemForm.addEventListener('submit', async e => { e.preventDefault(); await saveItem(); });

    $('addLineBtn').addEventListener('click', () => addItemLine());

    // Setup autocompletes for common fields
    setupAutocomplete('inpSite', 'acSite', 'site');
    setupAutocomplete('inpSupplier', 'acSupplier', 'supplier');
    setupAutocomplete('inpManufacturer', 'acMfr', 'manufacturer');
    setupAutocomplete('inpCategory', 'acCategory', 'category');
}

// ==========================================
// Data Loading
// ==========================================
async function loadData() {
    try {
        const res = await authFetch(API_BASE);
        if (!res.ok) throw new Error('fetch failed');
        itemsData = await res.json();
        buildCategoryChips();
        buildAcPools();
        applyFiltersAndSort();
    } catch (e) {
        console.error(e);
        elTableBody.innerHTML = '<tr><td colspan="11" style="text-align:center; color:red; padding:30px;">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>';
    }
}

// ==========================================
// Category Chips
// ==========================================
function buildCategoryChips() {
    const cats = new Set();
    itemsData.forEach(d => { if (d.category) cats.add(d.category); });
    const wrap = $('categoryChips');
    wrap.innerHTML = '<button class="cat-chip active" data-cat="all">전체</button>';
    [...cats].sort().forEach(cat => {
        wrap.innerHTML += `<button class="cat-chip" data-cat="${cat}">${cat}</button>`;
    });
    wrap.querySelectorAll('.cat-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            wrap.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilters.push({ field: 'category', query: btn.dataset.cat, logic: 'AND' });
            activeCategoryFilter = btn.dataset.cat;
            currentPage = 1;
            applyFiltersAndSort();
        });
    });
}

// ==========================================
// Autocomplete Pools
// ==========================================
function buildAcPools() {
    const sets = { site: new Set(), supplier: new Set(), manufacturer: new Set(), category: new Set(CATEGORY_DEFAULTS), item: new Set(), spec: new Set() };
    itemsData.forEach(d => {
        if (d.site) sets.site.add(d.site);
        if (d.supplier) sets.supplier.add(d.supplier);
        if (d.manufacturer) sets.manufacturer.add(d.manufacturer);
        if (d.category) sets.category.add(d.category);
        if (d.item) sets.item.add(d.item);
        if (d.spec) sets.spec.add(d.spec);
    });
    for (const key in sets) {
        acPools[key] = [...sets[key]].sort();
    }
}

// ==========================================
// Custom Autocomplete Engine
// ==========================================
function setupAutocomplete(inputId, dropdownId, poolKey) {
    const input = $(inputId);
    const dropdown = $(dropdownId);
    if (!input || !dropdown) return;

    // Find toggle button (if exists)
    const toggleBtn = input.closest('.ac-input-wrap')?.querySelector('.ac-toggle-btn');

    let highlightIdx = -1;

    input.addEventListener('input', () => {
        highlightIdx = -1;
        renderAcDropdown(input, dropdown, poolKey, highlightIdx);
    });

    // Don't open on focus — only typing or toggle button opens it

    input.addEventListener('blur', (e) => {
        // If focus moved to dropdown or toggle button, don't close
        const related = e.relatedTarget;
        if (related && (dropdown.contains(related) || (toggleBtn && toggleBtn.contains(related)))) return;
        closeAcDropdown(dropdown);
        if (toggleBtn) toggleBtn.classList.remove('open');
    });

    input.addEventListener('keydown', e => {
        if (!dropdown.classList.contains('open')) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightIdx = -1;
                renderAcDropdown(input, dropdown, poolKey, highlightIdx);
            }
            return;
        }
        const options = dropdown.querySelectorAll('.ac-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightIdx = Math.min(highlightIdx + 1, options.length - 1);
            updateAcHighlight(dropdown, highlightIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightIdx = Math.max(highlightIdx - 1, 0);
            updateAcHighlight(dropdown, highlightIdx);
        } else if (e.key === 'Enter' && highlightIdx >= 0) {
            e.preventDefault();
            const opt = options[highlightIdx];
            if (opt) { input.value = opt.dataset.value; closeAcDropdown(dropdown); if (toggleBtn) toggleBtn.classList.remove('open'); }
        } else if (e.key === 'Escape') {
            closeAcDropdown(dropdown);
            if (toggleBtn) toggleBtn.classList.remove('open');
        } else if (e.key === 'Tab') {
            closeAcDropdown(dropdown);
            if (toggleBtn) toggleBtn.classList.remove('open');
        }
    });

    // Toggle button click
    if (toggleBtn) {
        toggleBtn.addEventListener('mousedown', e => {
            e.preventDefault(); // prevent blur on input
        });
        toggleBtn.addEventListener('click', () => {
            if (dropdown.classList.contains('open')) {
                closeAcDropdown(dropdown);
                toggleBtn.classList.remove('open');
            } else {
                highlightIdx = -1;
                // Show all items (ignore current input filter)
                const pool = acPools[poolKey] || [];
                const matches = pool.slice(0, 30);
                if (matches.length === 0) return;
                let html = '';
                matches.forEach((val, idx) => {
                    html += `<div class="ac-option" data-value="${val}" data-idx="${idx}" tabindex="-1">${val}</div>`;
                });
                dropdown.innerHTML = html;
                dropdown.classList.add('open');
                toggleBtn.classList.add('open');
                bindAcOptionEvents(input, dropdown, toggleBtn);
            }
            input.focus();
        });
    }

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !dropdown.contains(e.target) && !(toggleBtn && toggleBtn.contains(e.target))) {
            closeAcDropdown(dropdown);
            if (toggleBtn) toggleBtn.classList.remove('open');
        }
    });
}

function setupLineAutocomplete(input, poolKey) {
    // Create dropdown element
    const wrapper = input.parentElement;
    let dropdown = wrapper.querySelector('.ac-dropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.className = 'ac-dropdown';
        wrapper.classList.add('ac-wrapper');
        wrapper.appendChild(dropdown);
    }

    // Create inline toggle button for line items
    let toggleBtn = wrapper.querySelector('.ac-toggle-btn');
    if (!toggleBtn) {
        // Wrap input in ac-input-wrap
        const inputWrap = document.createElement('div');
        inputWrap.className = 'ac-input-wrap';
        input.parentNode.insertBefore(inputWrap, input);
        inputWrap.appendChild(input);
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'ac-toggle-btn';
        toggleBtn.tabIndex = -1;
        toggleBtn.innerHTML = "<i class='bx bx-chevron-down'></i>";
        inputWrap.appendChild(toggleBtn);
    }

    let highlightIdx = -1;

    input.addEventListener('input', () => {
        highlightIdx = -1;
        renderAcDropdown(input, dropdown, poolKey, highlightIdx);
    });

    // Don't open on focus

    input.addEventListener('blur', (e) => {
        const related = e.relatedTarget;
        if (related && (dropdown.contains(related) || toggleBtn.contains(related))) return;
        closeAcDropdown(dropdown);
        toggleBtn.classList.remove('open');
    });

    input.addEventListener('keydown', e => {
        if (!dropdown.classList.contains('open')) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                highlightIdx = -1;
                renderAcDropdown(input, dropdown, poolKey, highlightIdx);
            }
            return;
        }
        const options = dropdown.querySelectorAll('.ac-option');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightIdx = Math.min(highlightIdx + 1, options.length - 1);
            updateAcHighlight(dropdown, highlightIdx);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightIdx = Math.max(highlightIdx - 1, 0);
            updateAcHighlight(dropdown, highlightIdx);
        } else if (e.key === 'Enter' && highlightIdx >= 0) {
            e.preventDefault();
            const opt = options[highlightIdx];
            if (opt) { input.value = opt.dataset.value; closeAcDropdown(dropdown); toggleBtn.classList.remove('open'); }
        } else if (e.key === 'Escape' || e.key === 'Tab') {
            closeAcDropdown(dropdown);
            toggleBtn.classList.remove('open');
        }
    });

    // Toggle button
    toggleBtn.addEventListener('mousedown', e => {
        e.preventDefault();
    });
    toggleBtn.addEventListener('click', () => {
        if (dropdown.classList.contains('open')) {
            closeAcDropdown(dropdown);
            toggleBtn.classList.remove('open');
        } else {
            highlightIdx = -1;
            const pool = acPools[poolKey] || [];
            const matches = pool.slice(0, 30);
            if (matches.length === 0) return;
            let html = '';
            matches.forEach((val, idx) => {
                html += `<div class="ac-option" data-value="${val}" data-idx="${idx}" tabindex="-1">${val}</div>`;
            });
            dropdown.innerHTML = html;
            dropdown.classList.add('open');
            toggleBtn.classList.add('open');
            bindAcOptionEvents(input, dropdown, toggleBtn);
        }
        input.focus();
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
            closeAcDropdown(dropdown);
            toggleBtn.classList.remove('open');
        }
    });
}

function renderAcDropdown(input, dropdown, poolKey, highlightIdx) {
    const query = input.value.trim();
    const pool = acPools[poolKey] || [];
    const toggleBtn = input.closest('.ac-input-wrap')?.querySelector('.ac-toggle-btn');

    let matches;
    if (!query) {
        matches = pool.slice(0, 30); // show all when empty (max 30)
    } else {
        matches = pool.filter(v => fuzzyMatch(v, query));
    }

    if (matches.length === 0 && query) {
        dropdown.innerHTML = '<div class="ac-no-result">일치하는 항목 없음</div>';
        dropdown.classList.add('open');
        if (toggleBtn) toggleBtn.classList.add('open');
        return;
    }
    if (matches.length === 0) {
        closeAcDropdown(dropdown);
        if (toggleBtn) toggleBtn.classList.remove('open');
        return;
    }

    let html = '';
    matches.forEach((val, idx) => {
        const cls = idx === highlightIdx ? 'ac-option ac-highlighted' : 'ac-option';
        html += `<div class="${cls}" data-value="${val}" data-idx="${idx}" tabindex="-1">${val}</div>`;
    });
    dropdown.innerHTML = html;
    dropdown.classList.add('open');
    if (toggleBtn) toggleBtn.classList.add('open');

    bindAcOptionEvents(input, dropdown, toggleBtn);
}

// Shared helper: bind click events on dropdown options
function bindAcOptionEvents(input, dropdown, toggleBtn) {
    dropdown.querySelectorAll('.ac-option').forEach(opt => {
        opt.addEventListener('mousedown', e => {
            e.preventDefault();
            input.value = opt.dataset.value;
            closeAcDropdown(dropdown);
            if (toggleBtn) toggleBtn.classList.remove('open');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
}

function updateAcHighlight(dropdown, idx) {
    dropdown.querySelectorAll('.ac-option').forEach((opt, i) => {
        opt.classList.toggle('ac-highlighted', i === idx);
        if (i === idx) opt.scrollIntoView({ block: 'nearest' });
    });
}

function closeAcDropdown(dropdown) {
    dropdown.classList.remove('open');
}

// ==========================================
// Item Lines (Multi-line entry)
// ==========================================
let lineCounter = 0;

function addItemLine(data = null) {
    lineCounter++;
    const container = $('itemLinesContainer');
    const line = document.createElement('div');
    line.className = 'item-line';
    line.dataset.lineId = lineCounter;

    line.innerHTML = `
        <div class="fg">
            <input type="text" class="line-item" placeholder="품명" autocomplete="off" ${!data ? 'required' : ''}>
        </div>
        <div class="fg">
            <input type="text" class="line-spec" placeholder="규격" autocomplete="off">
        </div>
        <div class="fg">
            <input type="number" class="line-qty" placeholder="0" min="0">
        </div>
        <div class="fg">
            <input type="number" class="line-price" placeholder="0" min="0">
        </div>
        <div class="fg">
            <div class="line-total-display">0</div>
        </div>
        <div class="item-line-actions">
            <button type="button" class="line-clone-btn" title="복제"><i class='bx bx-copy'></i></button>
            <button type="button" class="line-remove-btn" title="삭제"><i class='bx bx-x'></i></button>
        </div>
    `;

    container.appendChild(line);

    // Fill data if editing
    if (data) {
        line.querySelector('.line-item').value = data.item || '';
        line.querySelector('.line-spec').value = data.spec || '';
        line.querySelector('.line-qty').value = data.qty || 0;
        line.querySelector('.line-price').value = data.price || 0;
        updateLineTotal(line);
    }

    // Setup autocomplete for item and spec inputs
    setupLineAutocomplete(line.querySelector('.line-item'), 'item');
    setupLineAutocomplete(line.querySelector('.line-spec'), 'spec');

    // Calc events
    line.querySelector('.line-qty').addEventListener('input', () => { updateLineTotal(line); updateGrandTotal(); });
    line.querySelector('.line-price').addEventListener('input', () => { updateLineTotal(line); updateGrandTotal(); });

    // Clone button
    line.querySelector('.line-clone-btn').addEventListener('click', () => {
        const cloneData = {
            item: line.querySelector('.line-item').value,
            spec: line.querySelector('.line-spec').value,
            qty: parseInt(line.querySelector('.line-qty').value) || 0,
            price: parseInt(line.querySelector('.line-price').value) || 0
        };
        addItemLine(cloneData);
    });

    // Remove button
    line.querySelector('.line-remove-btn').addEventListener('click', () => {
        if (container.children.length <= 1) {
            showToast('최소 1개의 품목이 필요합니다.', 'warning');
            return;
        }
        line.remove();
        updateGrandTotal();
    });

    updateGrandTotal();
    return line;
}

function updateLineTotal(line) {
    const qty = parseInt(line.querySelector('.line-qty').value) || 0;
    const price = parseInt(line.querySelector('.line-price').value) || 0;
    const total = qty * price;
    line.querySelector('.line-total-display').textContent = total > 0 ? total.toLocaleString() : '0';
}

function updateGrandTotal() {
    let grand = 0;
    document.querySelectorAll('.item-line').forEach(line => {
        const qty = parseInt(line.querySelector('.line-qty').value) || 0;
        const price = parseInt(line.querySelector('.line-price').value) || 0;
        grand += qty * price;
    });
    $('grandTotalValue').textContent = grand > 0 ? grand.toLocaleString() : '0';
}

function getItemLines() {
    const lines = [];
    document.querySelectorAll('.item-line').forEach(line => {
        const item = line.querySelector('.line-item').value.trim();
        const spec = line.querySelector('.line-spec').value.trim();
        const qty = parseInt(line.querySelector('.line-qty').value) || 0;
        const price = parseInt(line.querySelector('.line-price').value) || 0;
        if (item) {
            lines.push({ item, spec, qty, price, total: qty * price });
        }
    });
    return lines;
}

// ==========================================
// Filter & Sort
// ==========================================
function applyFiltersAndSort() {
    const startDate = elStartDate?.value;
    const endDate = elEndDate?.value;
    
    let currentCategoryFilter = typeof activeCategoryFilter !== 'undefined' ? activeCategoryFilter : 'all';

    filteredData = itemsData.filter(item => {
        if (currentCategoryFilter !== 'all' && item.category !== currentCategoryFilter) return false;
        if (startDate && item.date < startDate) return false;
        if (endDate && item.date > endDate) return false;
        
        if (activeFilters.length > 0) {
            if (!KngSearchEngine.matchesGroupConditions(item, activeFilters, false, ['site', 'item', 'category', 'supplier', 'manufacturer'])) return false;
        }
        return true;
    });

    const numericCols = ['qty', 'price', 'total', 'totalQty'];
    applySorting(filteredData, currentSort.column, currentSort.asc, [], numericCols);

    updateActiveFilters();
    updateKPI();
    renderTable();
}

function updateActiveFilters() {
    KngSearchEngine.renderFilterChips('filter-chips', activeFilters, fieldLabels, (idx) => {
        activeFilters.splice(idx, 1);
        currentPage = 1;
        applyFiltersAndSort();
    });
}

// ==========================================
// KPI
// ==========================================
function updateKPI() {
    let totalQty = 0, totalAmt = 0;
    const siteSet = new Set();
    filteredData.forEach(d => {
        totalQty += d.qty || 0;
        totalAmt += d.total || 0;
        if (d.site) siteSet.add(d.site);
    });
    $('kpiCount').textContent = filteredData.length.toLocaleString();
    $('kpiQty').textContent = totalQty.toLocaleString();
    $('kpiTotal').textContent = totalAmt.toLocaleString();
    $('kpiSites').textContent = siteSet.size;
}

// ==========================================
// Render Table
// ==========================================
function renderTable() {
    elTotalCount.textContent = `${filteredData.length}건`;
    elSelectAll.checked = false;

    if (filteredData.length === 0) {
        elTableBody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding:40px; color:var(--gray-400);">데이터가 없습니다.</td></tr>';
        elPagination.innerHTML = '';
        return;
    }

    const pg = calcPagination(filteredData.length, currentPage, pageSize);
    currentPage = pg.page;
    const rows = filteredData.slice(pg.startIdx, pg.endIdx);

    let html = '';
    rows.forEach(d => {
        const catTag = d.category ? `<span class="cat-tag cat-${d.category}">${d.category}</span>` : '-';

        html += `
            <tr data-id="${d.id}">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
                <td class="supply-col" onclick="openModal('${d.id}')">${d.date || '-'}</td>
                <td class="col-site supply-col" onclick="openModal('${d.id}')">${d.site || '-'}</td>
                <td class="supply-col" onclick="openModal('${d.id}')" style="font-weight:500;">${d.supplier || '-'}</td>
                <td class="supply-col" onclick="openModal('${d.id}')">${d.manufacturer || '-'}</td>
                <td class="supply-col" onclick="openModal('${d.id}')">${catTag}</td>
                <td class="col-item product-col" onclick="openModal('${d.id}')">${d.item || '-'}</td>
                <td class="product-col" onclick="openModal('${d.id}')">${d.spec || '-'}</td>
                <td class="col-num-sm amount-col" onclick="openModal('${d.id}')">${fmtN(d.qty)}</td>
                <td class="col-num amount-col" onclick="openModal('${d.id}')">${fmtN(d.price)}</td>
                <td class="col-num amount-col total-highlight" onclick="openModal('${d.id}')">${fmtN(d.total)}</td>
            </tr>`;
    });

    elTableBody.innerHTML = html;
    
    // Apply highlight
    if (activeFilters.length > 0) {
        const queries = activeFilters.map(f => f.query).filter(Boolean);
        elTableBody.querySelectorAll('.col-site, .col-item, .supply-col, .product-col').forEach(el => {
            el.innerHTML = KngSearchEngine.highlightText(el.textContent, queries);
        });
    }

    renderPagination({
        container: elPagination,
        totalFiltered: filteredData.length,
        totalAll: itemsData.length,
        totalPages: pg.totalPages,
        currentPage, pageSize,
        startIdx: pg.startIdx,
        endIdx: pg.endIdx,
        onPageChange: p => { currentPage = p; renderTable(); },
        onPageSizeChange: s => { pageSize = s; currentPage = 1; renderTable(); }
    });
}

function fmtN(n) {
    if (n === 0 || n === undefined || n === null) return '0';
    return Number(n).toLocaleString();
}

// ==========================================
// CRUD
// ==========================================
window.openModal = function(id = null) {
    itemForm.reset();
    $('itemLinesContainer').innerHTML = '';
    lineCounter = 0;

    if (id) {
        // Edit mode: single item
        const d = itemsData.find(x => x.id === id);
        if (!d) return;
        $('modalTitle').textContent = '공급 내역 수정';
        $('editId').value = d.id;
        $('inpDate').value = d.date || '';
        $('inpSite').value = d.site || '';
        $('inpSupplier').value = d.supplier || '';
        $('inpManufacturer').value = d.manufacturer || '';
        $('inpCategory').value = d.category || '';
        addItemLine({ item: d.item, spec: d.spec, qty: d.qty, price: d.price });
        // Hide add-line button in edit mode
        $('addLineBtn').style.display = 'none';
        $('itemLinesHeader').style.display = '';
    } else {
        // New mode: multi-line
        $('modalTitle').textContent = '신규 납품 등록';
        $('editId').value = '';
        $('inpDate').value = new Date().toISOString().split('T')[0];
        addItemLine();
        $('addLineBtn').style.display = '';
        $('itemLinesHeader').style.display = '';
    }

    itemModal.classList.add('active');
};

function closeModal() { itemModal.classList.remove('active'); }

async function saveItem() {
    const editId = $('editId').value;
    const commonData = {
        date: $('inpDate').value,
        site: $('inpSite').value.trim(),
        supplier: $('inpSupplier').value.trim(),
        manufacturer: $('inpManufacturer').value.trim(),
        category: $('inpCategory').value.trim()
    };

    const lines = getItemLines();
    if (lines.length === 0) {
        showToast('최소 1개의 품목을 입력해주세요.', 'warning');
        return;
    }

    try {
        if (editId) {
            // Edit: single item update
            const line = lines[0];
            const payload = { ...commonData, ...line };
            const res = await authFetch(`${API_BASE}/${editId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast('수정되었습니다.', 'success');
                closeModal();
                loadData();
            } else {
                const err = await res.json();
                showToast('저장 실패: ' + err.error, 'error');
            }
        } else {
            // New: bulk insert
            if (lines.length === 1) {
                // Single item — use normal POST
                const payload = { ...commonData, ...lines[0] };
                const res = await authFetch(API_BASE, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    showToast('등록되었습니다.', 'success');
                    closeModal();
                    loadData();
                } else {
                    const err = await res.json();
                    showToast('저장 실패: ' + err.error, 'error');
                }
            } else {
                // Multi items — use bulk endpoint
                const bulkPayload = lines.map(line => ({
                    ...commonData,
                    ...line,
                    id: 'OSH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6)
                }));
                const res = await authFetch(`${API_BASE}/bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bulkPayload)
                });
                if (res.ok) {
                    const result = await res.json();
                    showToast(`${result.insertedCount || lines.length}건이 등록되었습니다.`, 'success');
                    closeModal();
                    loadData();
                } else {
                    const err = await res.json();
                    showToast('저장 실패: ' + err.error, 'error');
                }
            }
        }
    } catch (e) {
        console.error(e);
        showToast('서버 연결 오류', 'error');
    }
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (!ids.length) return showToast('삭제할 항목을 선택해주세요.', 'warning');
    if (!confirm(`선택한 ${ids.length}개 항목을 삭제하시겠습니까?`)) return;
    try {
        const res = await authFetch(`${API_BASE}/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) { showToast('삭제되었습니다.', 'success'); loadData(); }
        else { const err = await res.json(); showToast('삭제 실패: ' + err.error, 'error'); }
    } catch (e) { console.error(e); showToast('서버 연결 오류', 'error'); }
}
