/* =========================================================================
   유류 자재 공급 내역 V2 (oil-supply.js)
   - 통합검색, 카테고리칩, date range picker, KPI, 그룹헤더 테이블
   ========================================================================= */

const API_BASE = 'https://kng.junparks.com/api/oil-supply';
let itemsData = [];
let filteredData = [];
let currentSort = { column: 'date', asc: false };
let currentPage = 1;
let pageSize = 50;
let activeCategoryFilter = 'all';

const $ = id => document.getElementById(id);
const elTableBody = $('tableBody');
const elTotalCount = $('totalCount');
const elSearchField = $('searchField');
const elSearchInput = $('searchInput');
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

function initEvents() {
    elSearchInput.addEventListener('input', () => { currentPage = 1; applyFiltersAndSort(); });
    elSearchField.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });
    elStartDate.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });
    elEndDate.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });

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

    ['inpQty', 'inpPrice'].forEach(id => {
        $(id)?.addEventListener('input', updateCalc);
    });
}

// ==========================================
// Data Loading
// ==========================================
async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error('fetch failed');
        itemsData = await res.json();
        buildCategoryChips();
        updateDatalists();
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
            activeCategoryFilter = btn.dataset.cat;
            currentPage = 1;
            applyFiltersAndSort();
        });
    });
}

// ==========================================
// Datalists
// ==========================================
function updateDatalists() {
    const sites = new Set(), suppliers = new Set(), mfrs = new Set(), items = new Set(), specs = new Set();
    itemsData.forEach(d => {
        if (d.site) sites.add(d.site);
        if (d.supplier) suppliers.add(d.supplier);
        if (d.manufacturer) mfrs.add(d.manufacturer);
        if (d.item) items.add(d.item);
        if (d.spec) specs.add(d.spec);
    });
    fillDL('listSite', sites);
    fillDL('listSupplier', suppliers);
    fillDL('listMfr', mfrs);
    fillDL('listItem', items);
    fillDL('listSpec', specs);
}

function fillDL(id, vals) {
    const dl = $(id);
    if (dl) dl.innerHTML = [...vals].sort().map(v => `<option value="${v}">`).join('');
}

// ==========================================
// Filter & Sort
// ==========================================
function applyFiltersAndSort() {
    const query = elSearchInput.value.toLowerCase().trim();
    const field = elSearchField.value;
    const startDate = elStartDate.value;
    const endDate = elEndDate.value;

    filteredData = itemsData.filter(item => {
        if (activeCategoryFilter !== 'all' && item.category !== activeCategoryFilter) return false;
        if (startDate && item.date < startDate) return false;
        if (endDate && item.date > endDate) return false;
        if (!query) return true;
        if (field === 'all') {
            return ['site', 'supplier', 'manufacturer', 'item', 'category', 'spec']
                .some(f => (item[f] || '').toLowerCase().includes(query));
        }
        return (item[field] || '').toLowerCase().includes(query);
    });

    const numericCols = ['qty', 'price', 'total', 'totalQty'];
    applySorting(filteredData, currentSort.column, currentSort.asc, [], numericCols);

    updateKPI();
    renderTable();
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
    $('kpiTotal').textContent = '₩' + totalAmt.toLocaleString();
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
                <td class="supply-col" onclick="openModal('${d.id}')" style="color:#059669; font-weight:500;">${d.supplier || '-'}</td>
                <td class="supply-col" onclick="openModal('${d.id}')">${d.manufacturer || '-'}</td>
                <td class="supply-col" onclick="openModal('${d.id}')">${catTag}</td>
                <td class="col-item product-col" onclick="openModal('${d.id}')">${d.item || '-'}</td>
                <td class="product-col" onclick="openModal('${d.id}')">${d.spec || '-'}</td>
                <td class="col-num-sm amount-col" onclick="openModal('${d.id}')">${fmtN(d.qty)}</td>
                <td class="col-num amount-col" onclick="openModal('${d.id}')">₩${fmtN(d.price)}</td>
                <td class="col-num amount-col total-highlight" onclick="openModal('${d.id}')">₩${fmtN(d.total)}</td>
            </tr>`;
    });

    elTableBody.innerHTML = html;
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
// Modal Auto-Calc
// ==========================================
function updateCalc() {
    const qty = parseInt($('inpQty')?.value) || 0;
    const price = parseInt($('inpPrice')?.value) || 0;
    const total = qty * price;
    $('inpTotal').value = total > 0 ? '₩' + total.toLocaleString() : '';
}

// ==========================================
// CRUD
// ==========================================
window.openModal = function(id = null) {
    itemForm.reset();
    $('inpTotal').value = '';

    if (id) {
        const d = itemsData.find(x => x.id === id);
        if (!d) return;
        $('modalTitle').textContent = '공급 내역 수정';
        $('editId').value = d.id;
        $('inpDate').value = d.date || '';
        $('inpSite').value = d.site || '';
        $('inpSupplier').value = d.supplier || '';
        $('inpManufacturer').value = d.manufacturer || '';
        $('inpCategory').value = d.category || '';
        $('inpItem').value = d.item || '';
        $('inpSpec').value = d.spec || '';
        $('inpQty').value = d.qty || 0;
        $('inpPrice').value = d.price || 0;
        updateCalc();
    } else {
        $('modalTitle').textContent = '신규 납품 등록';
        $('editId').value = '';
        $('inpDate').value = new Date().toISOString().split('T')[0];
    }

    itemModal.classList.add('active');
};

function closeModal() { itemModal.classList.remove('active'); }

async function saveItem() {
    const id = $('editId').value;
    const qty = parseInt($('inpQty').value) || 0;
    const price = parseInt($('inpPrice').value) || 0;
    const payload = {
        date: $('inpDate').value,
        site: $('inpSite').value.trim(),
        supplier: $('inpSupplier').value.trim(),
        manufacturer: $('inpManufacturer').value.trim(),
        category: $('inpCategory').value.trim(),
        item: $('inpItem').value.trim(),
        spec: $('inpSpec').value.trim(),
        qty, price,
        total: qty * price
    };

    try {
        const url = id ? `${API_BASE}/${id}` : API_BASE;
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(id ? '수정되었습니다.' : '등록되었습니다.', 'success');
            closeModal();
            loadData();
        } else {
            const err = await res.json();
            showToast('저장 실패: ' + err.error, 'error');
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
        const res = await fetch(`${API_BASE}/delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        if (res.ok) { showToast('삭제되었습니다.', 'success'); loadData(); }
        else { const err = await res.json(); showToast('삭제 실패: ' + err.error, 'error'); }
    } catch (e) { console.error(e); showToast('서버 연결 오류', 'error'); }
}
