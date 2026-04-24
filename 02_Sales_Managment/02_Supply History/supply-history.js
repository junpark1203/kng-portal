/* =========================================================================
   일반 자재 공급 내역 관리 시스템 (supply-history.js)
   - NAS API (/api/supply-history) 연동
   - CRUD 및 구글 시트 마이그레이션 기능 포함
========================================================================= */

const API_BASE = 'https://kng.junparks.com/api/supply-history';
const OLD_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby_VSdKbTkclk_Skf63w6SssnHAP-l1FS_SwhN-eGkgkkN7_fzprv6oo_o32KbK_yNn6A/exec';

let itemsData = [];
let filteredData = [];
let currentSort = { column: 'supplyDate', asc: false };

// Pagination state
let currentPage = 1;
let pageSize = 50;

// Elements
const elTableBody = document.getElementById('tableBody');
const elTableFoot = document.getElementById('tableFoot');
const elTotalCount = document.getElementById('totalCount');
const elSearchStartDate = document.getElementById('searchStartDate');
const elSearchEndDate = document.getElementById('searchEndDate');
const elSearchSite = document.getElementById('searchSite');
const elSearchItem = document.getElementById('searchItem');
const elSearchCategory = document.getElementById('searchCategory');
const elSelectAll = document.getElementById('selectAll');
const elDeleteBtn = document.getElementById('deleteBtn');
const elAddBtn = document.getElementById('addBtn');
const elMigrateBtn = document.getElementById('migrateBtn');
const toastContainer = document.getElementById('toastContainer');
const actionBar = document.getElementById('actionBar');
const selectedCountEl = document.getElementById('selectedCount');

// Modal Elements
const itemModal = document.getElementById('itemModal');
const itemForm = document.getElementById('itemForm');

document.addEventListener('DOMContentLoaded', () => {
    initFilters();
    initEvents();
    loadData();
});

function initFilters() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const formatDate = (date) => date.toISOString().split('T')[0];
    
    elSearchStartDate.value = formatDate(firstDay);
    elSearchEndDate.value = formatDate(today);
}

function initEvents() {
    // Search
    [elSearchStartDate, elSearchEndDate, elSearchSite, elSearchItem, elSearchCategory].forEach(el => {
        if (!el) return;
        el.addEventListener('input', applyFiltersAndSort);
        el.addEventListener('change', applyFiltersAndSort);
    });

    // Sorting
    document.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const sortKey = th.getAttribute('data-sort');
            if (currentSort.column === sortKey) {
                currentSort.asc = !currentSort.asc;
            } else {
                currentSort.column = sortKey;
                currentSort.asc = true;
            }
            updateSortIcons();
            applyFiltersAndSort();
        });
    });

    // Select All
    if (elSelectAll) {
        elSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = isChecked;
            });
            updateActionBar();
        });
    }

    // Add Button
    if (elAddBtn) elAddBtn.addEventListener('click', () => openModal());

    // Delete Button
    if (elDeleteBtn) {
        elDeleteBtn.addEventListener('click', async () => {
            const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
            if (checked.length === 0) return showToast('삭제할 항목을 선택해주세요.', 'warning');
            if (!confirm(`선택한 ${checked.length}개의 항목을 삭제하시겠습니까?`)) return;

            try {
                const res = await fetch(`${API_BASE}/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: checked })
                });
                if (res.ok) {
                    showToast('삭제되었습니다.', 'success');
                    loadData();
                } else {
                    const err = await res.json();
                    showToast('삭제 실패: ' + err.error, 'error');
                }
            } catch (e) {
                console.error(e);
                showToast('서버 연결 오류', 'error');
            }
        });
    }

    // Migration Button
    if (elMigrateBtn) elMigrateBtn.addEventListener('click', runMigration);

    // Modal Events
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === itemModal) closeModal();
    });

    itemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveItem();
    });
}

function updateSortIcons() {
    updateSortUI(currentSort.column, currentSort.asc);
}

window.updateActionBar = function() {
    const count = document.querySelectorAll('.row-check:checked').length;
    selectedCountEl.textContent = count;
    actionBar.style.display = count > 0 ? 'flex' : 'none';
};

window.batchUpdateCategory = async function(category) {
    const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
    if (checked.length === 0) return;
    if (!confirm(`선택한 ${checked.length}개 항목을 '${category}'(으)로 변경하시겠습니까?`)) return;

    try {
        const res = await fetch(`${API_BASE}/update-category`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: checked, category: category })
        });
        if (res.ok) {
            showToast('변경되었습니다.', 'success');
            loadData();
        } else {
            showToast('변경 실패', 'error');
        }
    } catch (e) {
        showToast('서버 연결 오류', 'error');
    }
};

async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error('API fetch failed');
        itemsData = await res.json();
        applyFiltersAndSort();
    } catch (e) {
        console.error(e);
        elTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 40px; color:var(--danger);">데이터를 불러오는 중 오류가 발생했습니다. NAS 서버 상태를 확인해주세요.</td></tr>';
    }
}

function applyFiltersAndSort() {
    const startDate = elSearchStartDate.value;
    const endDate = elSearchEndDate.value;
    const siteKey = elSearchSite.value.toLowerCase().trim();
    const itemKey = elSearchItem.value.toLowerCase().trim();
    const catKey = elSearchCategory.value;

    filteredData = itemsData.filter(item => {
        if (startDate && item.supplyDate < startDate) return false;
        if (endDate && item.supplyDate > endDate) return false;
        if (siteKey && !(item.site || '').toLowerCase().includes(siteKey)) return false;
        if (itemKey && !(item.item || '').toLowerCase().includes(itemKey)) return false;
        if (catKey && item.category !== catKey) return false;
        return true;
    });

    applySorting(filteredData, currentSort.column, currentSort.asc, ['qty', 'price', 'total']);

    renderTable();
}

function renderTable() {
    elTotalCount.textContent = `${filteredData.length}건`;
    if (elSelectAll) elSelectAll.checked = false;
    updateActionBar();

    const elPagination = document.getElementById('pagination');

    if (filteredData.length === 0) {
        elTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--gray-500);">데이터가 없습니다.</td></tr>';
        elTableFoot.style.display = 'none';
        if (elPagination) elPagination.innerHTML = '';
        return;
    }

    // Pagination calculation
    const totalFiltered = filteredData.length;
    const pg = calcPagination(totalFiltered, currentPage, pageSize);
    currentPage = pg.page;
    const pageItems = filteredData.slice(pg.startIdx, pg.endIdx);

    let html = '';
    let sumQty = 0;
    let sumTotal = 0;

    // Sum all filtered data (not just current page)
    filteredData.forEach(item => {
        sumQty += item.qty || 0;
        sumTotal += item.total || 0;
    });

    pageItems.forEach(item => {
        let catColor = '';
        if (item.category === '안전자재') catColor = 'style="color:#10b981; font-weight:600;"';
        else if (item.category === '잡자재') catColor = 'style="color:#64748b; font-weight:600;"';
        else if (item.category === '미분류') catColor = 'style="color:#ef4444; font-weight:600;"';

        html += `
            <tr class="item-row" data-id="${item.id}" onclick="openModal('${item.id}')">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${item.id}" onclick="updateActionBar()"></td>
                <td style="color:var(--gray-600);">${item.supplyDate || '-'}</td>
                <td style="font-weight:600;">${item.site || '-'}</td>
                <td>${item.item || '-'}</td>
                <td class="text-right">${Number(item.qty).toLocaleString()}</td>
                <td class="text-right">${Number(item.price).toLocaleString()}</td>
                <td class="text-right" style="color:var(--primary); font-weight:600;">${Number(item.total).toLocaleString()}</td>
                <td class="text-center" ${catColor}>${item.category || '미분류'}</td>
            </tr>
        `;
    });

    elTableBody.innerHTML = html;
    
    document.getElementById('sumQty').textContent = sumQty.toLocaleString();
    document.getElementById('sumTotal').textContent = sumTotal.toLocaleString();
    elTableFoot.style.display = 'table-footer-group';
    renderPagination({
        container: 'pagination',
        totalFiltered: totalFiltered,
        totalAll: itemsData.length,
        totalPages: pg.totalPages,
        currentPage: currentPage,
        pageSize: pageSize,
        startIdx: pg.startIdx,
        endIdx: pg.endIdx,
        onPageChange: (page) => { currentPage = page; renderTable(); },
        onPageSizeChange: (size) => { pageSize = size; currentPage = 1; renderTable(); }
    });
}

// ==========================================
// CRUD 로직
// ==========================================

window.openModal = function(id = null) {
    itemForm.reset();
    document.getElementById('editId').value = '';

    if (id) {
        const item = itemsData.find(d => d.id === id);
        if (!item) return;
        document.getElementById('modalTitle').textContent = '납품 내역 수정';
        document.getElementById('editId').value = item.id;
        document.getElementById('inpDate').value = item.supplyDate || '';
        document.getElementById('inpCategory').value = item.category || '미분류';
        document.getElementById('inpSite').value = item.site || '';
        document.getElementById('inpItem').value = item.item || '';
        document.getElementById('inpQty').value = (item.qty || 0).toLocaleString();
        document.getElementById('inpPrice').value = (item.price || 0).toLocaleString();
        document.getElementById('inpTotal').value = (item.total || 0).toLocaleString();
    } else {
        document.getElementById('modalTitle').textContent = '신규 납품 등록';
        document.getElementById('inpDate').value = new Date().toISOString().split('T')[0];
    }

    itemModal.classList.add('active');
};

function closeModal() {
    itemModal.classList.remove('active');
}

window.formatNumberInput = function(input) {
    let val = input.value.replace(/[^0-9-]/g, '');
    if (val === '') {
        input.value = '';
        return;
    }
    input.value = Number(val).toLocaleString();
};

window.calculateTotal = function() {
    const qtyStr = document.getElementById('inpQty').value.replace(/,/g, '');
    const priceStr = document.getElementById('inpPrice').value.replace(/,/g, '');
    const qty = parseInt(qtyStr) || 0;
    const price = parseInt(priceStr) || 0;
    
    document.getElementById('inpTotal').value = (qty * price).toLocaleString();
};

async function saveItem() {
    const id = document.getElementById('editId').value;
    
    const qtyStr = document.getElementById('inpQty').value.replace(/,/g, '');
    const priceStr = document.getElementById('inpPrice').value.replace(/,/g, '');
    const qty = parseInt(qtyStr) || 0;
    const price = parseInt(priceStr) || 0;
    const total = qty * price;

    const payload = {
        supplyDate: document.getElementById('inpDate').value,
        category: document.getElementById('inpCategory').value,
        site: document.getElementById('inpSite').value.trim(),
        item: document.getElementById('inpItem').value.trim(),
        qty: qty,
        price: price,
        total: total
    };

    try {
        const url = id ? `${API_BASE}/${id}` : API_BASE;
        const method = id ? 'PUT' : 'POST';
        
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
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

// ==========================================
// Toast & Migration
// ==========================================

// showToast() — provided by kng-table-utils.js

// 초기 마이그레이션 함수 (구글 시트 -> NAS SQLite)
async function runMigration() {
    if (itemsData.length > 0) {
        if (!confirm('이미 NAS DB에 데이터가 존재합니다. 구글 시트에서 데이터를 다시 가져올까요? (기존 데이터 위에 덮어쓰거나 중복될 수 있습니다)')) return;
    }
    
    try {
        elMigrateBtn.disabled = true;
        elMigrateBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 구글 시트에서 가져오는 중...";
        
        // 1. 구글 시트에서 데이터 가져오기
        const res = await fetch(OLD_SCRIPT_URL);
        if (!res.ok) throw new Error('구글 시트 데이터를 불러올 수 없습니다.');
        const oldData = await res.json();
        
        // 2. 데이터 변환 (구글 시트 양식 -> SQLite 양식)
        const newPayload = oldData.map((row, i) => {
            // 날짜 포맷팅 (YYYY-MM-DD)
            let dt = new Date().toISOString().split('T')[0];
            try {
                const origDate = String(row.일자 || '').replace(/\s*-\s*\d+$/, '').replace(/[-.]/g, '/');
                const pts = origDate.split('/');
                let yPart = row.연도 ? String(row.연도).trim() : new Date().getFullYear();
                let m = '01', d = '01';
                if (pts.length >= 3) {
                    yPart = pts[0]; m = pts[1].padStart(2, '0'); d = pts[2].padStart(2, '0');
                } else if (pts.length === 2) {
                    m = pts[0].padStart(2, '0'); d = pts[1].padStart(2, '0');
                }
                dt = `${yPart}-${m}-${d}`;
            } catch(e) {}

            return {
                id: 'SH-MIG-' + String(i).padStart(4, '0'), // 기존 순서대로 ID 부여 (중복 삽입 방지)
                supplyDate: dt,
                site: row.현장명 || '',
                item: row.품목명 || '',
                qty: Number(row.수량.toString().replace(/[^0-9-]/g, '')) || 0,
                price: Number(row.단가.toString().replace(/[^0-9-]/g, '')) || 0,
                total: (Number(row.수량.toString().replace(/[^0-9-]/g, '')) || 0) * (Number(row.단가.toString().replace(/[^0-9-]/g, '')) || 0),
                category: row.구분 || '미분류'
            };
        });

        // 3. NAS 서버로 전송
        elMigrateBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> NAS에 저장 중...";
        const saveRes = await fetch(`${API_BASE}/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPayload)
        });

        if (saveRes.ok) {
            const data = await saveRes.json();
            showToast(`${data.insertedCount}건 성공적으로 가져왔습니다!`, 'success');
            loadData();
        } else {
            const err = await saveRes.json();
            showToast('NAS 저장 실패: ' + err.error, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('마이그레이션 중 오류 발생: ' + e.message, 'error');
    } finally {
        elMigrateBtn.disabled = false;
        elMigrateBtn.innerHTML = "<i class='bx bx-cloud-download'></i> 기존 데이터 가져오기";
    }
}
