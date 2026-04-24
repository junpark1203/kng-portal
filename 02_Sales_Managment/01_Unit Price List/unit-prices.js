/* =========================================================================
   매입/매출 단가 관리 시스템 V2 (unit-prices.js)
   - unit_prices_v2 테이블 연동
   - Cascading Dropdown, 마진 자동계산, 카테고리 필터
   ========================================================================= */

const API_BASE = 'https://kng.junparks.com/api/unit-prices';
let itemsData = [];
let filteredData = [];
let currentSort = { column: 'updatedAt', asc: false };
let currentPage = 1;
let pageSize = 50;
let activeCategoryFilter = 'all';

// Elements
const $ = id => document.getElementById(id);
const elTableBody = $('tableBody');
const elTotalCount = $('totalCount');
const elSearchField = $('searchField');
const elSearchInput = $('searchInput');
const elPagination = $('pagination');
const elSelectAll = $('selectAll');

// Modal
const itemModal = $('itemModal');
const itemForm = $('itemForm');
const historyModal = $('historyModal');

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData();
});

function initEvents() {
    // Search
    elSearchInput.addEventListener('input', () => { currentPage = 1; applyFiltersAndSort(); });
    elSearchField.addEventListener('change', () => { currentPage = 1; applyFiltersAndSort(); });

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

    // Select All
    elSelectAll.addEventListener('change', e => {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    });

    // Add
    $('addBtn').addEventListener('click', () => openModal());

    // Delete
    $('deleteBtn').addEventListener('click', deleteSelected);

    // Migrate V1→V2
    $('migrateBtn').addEventListener('click', runMigration);

    // Modal
    $('closeModalBtn').addEventListener('click', closeModal);
    $('cancelBtn').addEventListener('click', closeModal);
    window.addEventListener('click', e => {
        if (e.target === itemModal) closeModal();
        if (e.target === historyModal) closeHistoryModal();
    });
    $('closeHistoryModalBtn').addEventListener('click', closeHistoryModal);
    itemForm.addEventListener('submit', async e => { e.preventDefault(); await saveItem(); });

    // Cascading dropdowns
    initCascadingDropdowns();

    // Modal auto-calc
    const calcInputs = ['inpBuyPrice', 'inpLogistics', 'inpSellPrice'];
    calcInputs.forEach(id => {
        $(id)?.addEventListener('input', updateModalCalc);
    });

    // Currency change → update labels
    $('inpCurrency').addEventListener('change', () => {
        const sym = getCurrencySymbol($('inpCurrency').value);
        $('logisticsCurrLabel').textContent = sym;
        $('sellCurrLabel').textContent = sym;
    });
}

// ==========================================
// Data Loading
// ==========================================
async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error('API fetch failed');
        itemsData = await res.json();
        buildCategoryChips();
        updateDatalists();
        applyFiltersAndSort();
    } catch (e) {
        console.error(e);
        elTableBody.innerHTML = '<tr><td colspan="15" style="text-align:center; color:red; padding:30px;">데이터를 불러오는 중 오류가 발생했습니다. NAS 서버 상태를 확인해주세요.</td></tr>';
    }
}

// ==========================================
// Category Chips
// ==========================================
function buildCategoryChips() {
    const cats = new Set();
    itemsData.forEach(d => { if (d.category) cats.add(d.category); });
    const wrap = document.querySelector('.category-filter-wrap');
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
// Filter & Sort
// ==========================================
function applyFiltersAndSort() {
    const query = elSearchInput.value.toLowerCase().trim();
    const field = elSearchField.value;

    filteredData = itemsData.filter(item => {
        // Category filter
        if (activeCategoryFilter !== 'all' && item.category !== activeCategoryFilter) return false;
        // Search
        if (!query) return true;
        if (field === 'all') {
            return ['itemName', 'spec', 'category', 'manufacturer', 'supplier', 'note']
                .some(f => (item[f] || '').toLowerCase().includes(query));
        }
        return (item[field] || '').toLowerCase().includes(query);
    });

    // Sort
    const numericCols = ['buyPrice', 'logistics', 'landedCost', 'sellPrice'];
    applySorting(filteredData, currentSort.column, currentSort.asc, [], numericCols);

    renderTable();
}

// ==========================================
// Render Table
// ==========================================
function renderTable() {
    elTotalCount.textContent = `${filteredData.length}건`;
    elSelectAll.checked = false;

    if (filteredData.length === 0) {
        elTableBody.innerHTML = '<tr><td colspan="14" style="text-align:center; padding:40px; color:var(--gray-400);">데이터가 없습니다.</td></tr>';
        elPagination.innerHTML = '';
        return;
    }

    const pg = calcPagination(filteredData.length, currentPage, pageSize);
    currentPage = pg.page;
    const rows = filteredData.slice(pg.startIdx, pg.endIdx);

    let html = '';
    rows.forEach(d => {
        const sym = getCurrencySymbol(d.currency);
        const landed = d.landedCost || (d.buyPrice + (d.logistics || 0));
        const margin = d.sellPrice - landed;
        const marginRate = d.sellPrice > 0 ? ((margin / d.sellPrice) * 100) : 0;
        const dateStr = d.updatedAt ? d.updatedAt.split('T')[0] : '';

        // Margin badge
        let marginBadge;
        if (d.sellPrice <= 0) {
            marginBadge = '<span class="margin-badge badge-none">-</span>';
        } else {
            const cls = marginRate > 20 ? 'badge-high' : marginRate > 10 ? 'badge-mid' : 'badge-low';
            marginBadge = `<span class="margin-badge ${cls}">${marginRate.toFixed(1)}%</span>`;
        }

        // Margin amount
        const marginCls = margin > 0 ? 'val-positive' : margin < 0 ? 'val-negative' : 'val-zero';
        const marginAmt = margin !== 0 ? `<span class="${marginCls}">${fmtNum(margin)}</span>` : '<span class="val-zero">-</span>';

        // Buy change rate (used only for history, removed from render)

        // Category tag
        const catTag = d.category ? `<span class="cat-tag cat-${d.category}">${d.category}</span>` : '-';

        html += `
            <tr data-id="${d.id}">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${d.id}"></td>
                <td onclick="openModal('${d.id}')">${d.supplier || '-'}</td>
                <td onclick="openModal('${d.id}')" style="color:#059669; font-weight:500;">${d.manufacturer || '-'}</td>
                <td onclick="openModal('${d.id}')">${catTag}</td>
                <td class="col-item" onclick="openModal('${d.id}')">${d.itemName || '-'}</td>
                <td onclick="openModal('${d.id}')">${d.spec || '-'}</td>
                <td class="col-num cost-col" onclick="openModal('${d.id}')"><span class="curr-sym">${sym}</span>${fmtNum(d.buyPrice)}</td>
                <td class="col-num-sm cost-col" onclick="openModal('${d.id}')" style="font-size:9px; color:var(--gray-500);">${d.logistics > 0 ? fmtNum(d.logistics) : '-'}</td>
                <td class="col-num cost-col" onclick="openModal('${d.id}')" style="font-weight:600;">${fmtNum(landed)}</td>
                <td class="col-num sell-col" onclick="openModal('${d.id}')" style="font-weight:600;"><span class="curr-sym">${sym}</span>${fmtNum(d.sellPrice)}</td>
                <td class="col-num margin-col" onclick="openModal('${d.id}')">${marginAmt}</td>
                <td class="col-num-sm margin-col" onclick="openModal('${d.id}')">${marginBadge}</td>
                <td onclick="event.stopPropagation()"><button class="btn-history" onclick="window.showHistory('${d.id}')">이력</button></td>
                <td class="col-date" onclick="openModal('${d.id}')">${dateStr}</td>
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

// ==========================================
// Helpers
// ==========================================
function fmtNum(n) {
    if (n === 0 || n === undefined || n === null) return '0';
    return Number(n).toLocaleString();
}

function getCurrencySymbol(code) {
    const map = { KRW: '₩', USD: '$', JPY: '¥', EUR: '€', CNY: '¥' };
    return map[code] || code || '₩';
}

// ==========================================
// Datalist & Cascading Dropdown
// ==========================================
const fillDL = (id, vals) => {
    const dl = $(id);
    if (dl) dl.innerHTML = [...vals].sort().map(v => `<option value="${v}">`).join('');
};

function updateDatalists() {
    const suppliers = new Set();
    itemsData.forEach(d => { if (d.supplier) suppliers.add(d.supplier); });
    fillDL('listSupplier', suppliers);
    refreshCascade();
}

function refreshCascade() {
    const supplier = ($('inpSupplier')?.value || '').trim();
    const mfr = ($('inpMfr')?.value || '').trim();

    // Filter by supplier
    let f1 = itemsData;
    if (supplier) {
        const sf = itemsData.filter(d => d.supplier === supplier);
        if (sf.length) f1 = sf;
    }
    const mfrSet = new Set();
    f1.forEach(d => { if (d.manufacturer) mfrSet.add(d.manufacturer); });
    fillDL('listMfr', mfrSet);

    // Filter by supplier + mfr
    let f2 = f1;
    if (mfr) {
        const mf = f1.filter(d => d.manufacturer === mfr);
        if (mf.length) f2 = mf;
    }
    const itemSet = new Set(), specSet = new Set();
    f2.forEach(d => {
        if (d.itemName) itemSet.add(d.itemName);
        if (d.spec) specSet.add(d.spec);
    });
    fillDL('listItem', itemSet);
    fillDL('listSpec', specSet);

    // Hints
    const hintSupplier = $('hintSupplier');
    const hintMfr = $('hintMfr');
    const hintItem = $('hintItem');
    if (hintSupplier) {
        if (supplier && mfrSet.size > 0) {
            hintSupplier.textContent = `${supplier}의 제조사 ${mfrSet.size}개 필터됨`;
            hintSupplier.classList.add('active');
        } else {
            hintSupplier.textContent = '공급사를 선택하면 제조사/품목이 자동 필터됩니다';
            hintSupplier.classList.remove('active');
        }
    }
    if (hintMfr) {
        if (mfr && itemSet.size > 0) {
            hintMfr.textContent = `${mfr}의 품목 ${itemSet.size}개`;
            hintMfr.classList.add('active');
        } else { hintMfr.textContent = ''; hintMfr.classList.remove('active'); }
    }
    if (hintItem) { hintItem.textContent = ''; hintItem.classList.remove('active'); }
}

function initCascadingDropdowns() {
    ['inpSupplier', 'inpMfr', 'inpItem', 'inpSpec'].forEach(id => {
        $(id)?.addEventListener('input', refreshCascade);
    });
}

// ==========================================
// Modal Auto-Calc
// ==========================================
function updateModalCalc() {
    const buy = parseInt($('inpBuyPrice')?.value) || 0;
    const log = parseInt($('inpLogistics')?.value) || 0;
    const sell = parseInt($('inpSellPrice')?.value) || 0;
    const landed = buy + log;
    const margin = sell - landed;
    const rate = sell > 0 ? ((margin / sell) * 100) : 0;
    const sym = getCurrencySymbol($('inpCurrency')?.value);

    $('inpLandedCost').value = landed > 0 ? sym + fmtNum(landed) : '';
    $('inpLandedCost').style.color = '';

    const mAmt = $('inpMarginAmt');
    if (sell > 0 || buy > 0) {
        mAmt.value = (margin >= 0 ? '+' : '') + sym + fmtNum(margin);
        mAmt.style.color = margin > 0 ? '#059669' : margin < 0 ? '#dc2626' : '';
    } else { mAmt.value = ''; mAmt.style.color = ''; }

    const mRate = $('inpMarginRate');
    if (sell > 0) {
        mRate.value = rate.toFixed(2) + '%';
        mRate.style.color = rate > 20 ? '#059669' : rate > 10 ? '#d97706' : '#dc2626';
    } else { mRate.value = ''; mRate.style.color = ''; }
}

// ==========================================
// CRUD
// ==========================================
window.openModal = function(id = null) {
    itemForm.reset();
    $('timestampDisplay').textContent = '';
    $('inpHistory').value = '';
    $('inpCurrency').value = 'KRW';
    $('logisticsCurrLabel').textContent = '₩';
    $('sellCurrLabel').textContent = '₩';
    $('inpLandedCost').value = '';
    $('inpMarginAmt').value = '';
    $('inpMarginRate').value = '';

    if (id) {
        const d = itemsData.find(x => x.id === id);
        if (!d) return;
        $('modalTitle').textContent = '단가 수정';
        $('editId').value = d.id;
        $('inpItem').value = d.itemName || '';
        $('inpSpec').value = d.spec || '';
        $('inpCategory').value = d.category || '';
        $('inpMfr').value = d.manufacturer || '';
        $('inpSupplier').value = d.supplier || '';
        $('inpCurrency').value = d.currency || 'KRW';
        const sym = getCurrencySymbol(d.currency);
        $('logisticsCurrLabel').textContent = sym;
        $('sellCurrLabel').textContent = sym;
        $('inpBuyPrice').value = d.buyPrice || 0;
        $('inpLogistics').value = d.logistics || 0;
        $('inpSellPrice').value = d.sellPrice || 0;
        $('inpNote').value = d.note || '';
        $('inpHistory').value = d.history || '';
        updateModalCalc();
        if (d.updatedAt) {
            $('timestampDisplay').textContent = `최종 수정: ${new Date(d.updatedAt).toLocaleString()}`;
        }
    } else {
        $('modalTitle').textContent = '신규 단가 등록';
        $('editId').value = '';
    }

    refreshCascade();
    itemModal.classList.add('active');
};

function closeModal() { itemModal.classList.remove('active'); }

async function saveItem() {
    const id = $('editId').value;
    const payload = {
        itemName: $('inpItem').value.trim(),
        spec: $('inpSpec').value.trim(),
        category: $('inpCategory').value.trim(),
        manufacturer: $('inpMfr').value.trim(),
        supplier: $('inpSupplier').value.trim(),
        currency: $('inpCurrency').value,
        buyPrice: parseInt($('inpBuyPrice').value) || 0,
        logistics: parseInt($('inpLogistics').value) || 0,
        sellPrice: parseInt($('inpSellPrice').value) || 0,
        note: $('inpNote').value.trim()
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

// ==========================================
// History Modal
// ==========================================
window.showHistory = function(id) {
    const d = itemsData.find(x => x.id === id);
    if (!d) return;
    const sym = getCurrencySymbol(d.currency);
    $('historyModalTitle').textContent = `${d.itemName || '품목'} 변동 이력`;

    // 현재 단가 + 변동률 요약
    let html = '<div style="margin-bottom:14px; padding:10px 12px; background:var(--gray-50); border-radius:6px;">';
    html += '<div style="font-size:11px; font-weight:600; color:var(--gray-500); margin-bottom:6px;">📌 현재 단가</div>';
    html += `<div style="display:flex; gap:16px; font-size:12px;">` +
        `<span>매입 <b>${sym}${fmtNum(d.buyPrice)}</b></span>` +
        `<span>매출 <b>${sym}${fmtNum(d.sellPrice)}</b></span>` +
        '</div>';

    // prevBuyPrice 대비 변동률
    if (d.prevBuyPrice && d.prevBuyPrice > 0) {
        const buyRate = ((d.buyPrice - d.prevBuyPrice) / d.prevBuyPrice * 100);
        const buyDiff = d.buyPrice - d.prevBuyPrice;
        const cls = buyRate > 0 ? 'change-up' : buyRate < 0 ? 'change-down' : 'change-flat';
        const arrow = buyRate > 0 ? '▲' : buyRate < 0 ? '▼' : '';
        html += `<div style="margin-top:6px; font-size:11px;">` +
            `매입 변동: <span class="${cls}">${arrow}${Math.abs(buyRate).toFixed(1)}% (${buyDiff > 0 ? '+' : ''}${sym}${fmtNum(buyDiff)})</span>` +
            ` <span style="color:var(--gray-400); font-size:10px;">이전 ${sym}${fmtNum(d.prevBuyPrice)}</span></div>`;
    }
    if (d.prevSellPrice && d.prevSellPrice > 0) {
        const sellRate = ((d.sellPrice - d.prevSellPrice) / d.prevSellPrice * 100);
        const sellDiff = d.sellPrice - d.prevSellPrice;
        const cls = sellRate > 0 ? 'change-up' : sellRate < 0 ? 'change-down' : 'change-flat';
        const arrow = sellRate > 0 ? '▲' : sellRate < 0 ? '▼' : '';
        html += `<div style="font-size:11px;">` +
            `매출 변동: <span class="${cls}">${arrow}${Math.abs(sellRate).toFixed(1)}% (${sellDiff > 0 ? '+' : ''}${sym}${fmtNum(sellDiff)})</span>` +
            ` <span style="color:var(--gray-400); font-size:10px;">이전 ${sym}${fmtNum(d.prevSellPrice)}</span></div>`;
    }
    html += '</div>';

    // 이력 텍스트
    if (d.history) {
        html += '<div style="font-size:11px; font-weight:600; color:var(--gray-500); margin-bottom:6px;">📋 변동 기록</div>';
        const lines = d.history.split('\n').filter(l => l.trim());
        html += '<div style="font-size:12px; line-height:2;">';
        lines.forEach(line => {
            html += `<div style="padding:2px 0; border-bottom:1px solid var(--gray-100);">${line}</div>`;
        });
        html += '</div>';
    } else {
        html += '<div style="color:var(--gray-400); font-size:12px; text-align:center; padding:20px 0;">변동 이력이 없습니다.</div>';
    }

    $('historyModalBody').innerHTML = html;
    historyModal.classList.add('active');
};
function closeHistoryModal() { historyModal.classList.remove('active'); }

// ==========================================
// V1→V2 Migration
// ==========================================
async function runMigration() {
    if (!confirm('기존 V1 데이터를 V2 테이블로 마이그레이션합니다. 진행할까요?')) return;
    const btn = $('migrateBtn');
    try {
        btn.disabled = true;
        btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";
        const res = await fetch(`${API_BASE}/migrate-v2`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        if (res.ok) {
            const data = await res.json();
            showToast(`${data.migrated}건 마이그레이션 완료 (총 ${data.total}건)`, 'success');
            loadData();
        } else {
            const err = await res.json();
            showToast('마이그레이션 실패: ' + err.error, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('마이그레이션 중 오류', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = "<i class='bx bx-cloud-upload'></i> 마이그레이션";
    }
}
