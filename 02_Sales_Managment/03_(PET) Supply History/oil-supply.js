/* =========================================================================
   유류 자재 공급 내역 관리 시스템 (oil-supply.js)
   - NAS API (/api/oil-supply-history) 연동
   - 엑셀 업로드/다운로드 및 구글 시트 마이그레이션 기능 포함
   - 통계(Summary) 자동 생성 포함
========================================================================= */

const API_BASE = 'https://kng.junparks.com/api/oil-supply-history';
const OLD_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwrzbS2OeKtSmzxQv2OkHyXHoyQIp8AQ1GslxcnSg-y698DjzamyldYMwWGRmotZKo-Ww/exec';

let itemsData = [];
let filteredData = [];
let currentSort = { column: 'date', asc: false };

// Pagination state
let currentPage = 1;
let pageSize = 50;

// Elements
const elTableBody = document.getElementById('tableBody');
const elTotalCount = document.getElementById('totalCount');
const elSearchMonth = document.getElementById('searchMonth');
const elSearchSite = document.getElementById('searchSite');
const elSearchCategory = document.getElementById('searchCategory');
const elSearchSupplier = document.getElementById('searchSupplier');
const elSearchItem = document.getElementById('searchItem');
const elResetBtn = document.getElementById('resetBtn');

const elSelectAll = document.getElementById('selectAll');
const elDeleteBtn = document.getElementById('deleteBtn');
const elAddBtn = document.getElementById('addBtn');
const elMigrateBtn = document.getElementById('migrateBtn');
const elUploadBtn = document.getElementById('uploadBtn');
const elExportBtn = document.getElementById('exportBtn');
const elExcelUpload = document.getElementById('excelUpload');
const toastContainer = document.getElementById('toastContainer');
const actionBar = document.getElementById('actionBar');
const selectedCountEl = document.getElementById('selectedCount');
const summaryBox = document.getElementById('summaryBox');

// Modal Elements
const itemModal = document.getElementById('itemModal');
const itemForm = document.getElementById('itemForm');

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData();
});

function initEvents() {
    // Search
    [elSearchMonth, elSearchSite, elSearchCategory, elSearchSupplier, elSearchItem].forEach(el => {
        if (!el) return;
        el.addEventListener('input', applyFiltersAndSort);
    });

    if (elResetBtn) {
        elResetBtn.addEventListener('click', () => {
            elSearchMonth.value = '';
            elSearchSite.value = '';
            elSearchCategory.value = '';
            elSearchSupplier.value = '';
            elSearchItem.value = '';
            applyFiltersAndSort();
        });
    }

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
            updateSortUI();
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

    // Buttons
    if (elAddBtn) elAddBtn.addEventListener('click', () => openModal());
    if (elExportBtn) elExportBtn.addEventListener('click', downloadExcel);
    if (elUploadBtn) elUploadBtn.addEventListener('click', () => elExcelUpload.click());
    if (elExcelUpload) elExcelUpload.addEventListener('change', handleExcelUpload);

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

function updateSortUI() {
    document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('data-sort') === currentSort.column) {
            th.classList.add(currentSort.asc ? 'sort-asc' : 'sort-desc');
        }
    });
}

window.updateActionBar = function() {
    const count = document.querySelectorAll('.row-check:checked').length;
    selectedCountEl.textContent = count;
    actionBar.style.display = count > 0 ? 'flex' : 'none';
};

async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error('API fetch failed');
        itemsData = await res.json();
        applyFiltersAndSort();
    } catch (e) {
        console.error(e);
        elTableBody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding: 40px; color:var(--danger);">데이터를 불러오는 중 오류가 발생했습니다. NAS 서버 상태를 확인해주세요.</td></tr>';
    }
}

function applyFiltersAndSort() {
    const periodKeyword = elSearchMonth.value.trim();
    const siteKeyword = elSearchSite.value.toLowerCase().trim();
    const categoryKeyword = elSearchCategory.value.toLowerCase().trim();
    const supplierKeyword = elSearchSupplier.value.toLowerCase().trim();
    const itemKeyword = elSearchItem.value.toLowerCase().trim();

    filteredData = itemsData.filter(item => {
        if (periodKeyword && !(item.date || '').startsWith(periodKeyword)) return false;
        if (siteKeyword && !(item.site || '').toLowerCase().includes(siteKeyword)) return false;
        if (categoryKeyword && !(item.category || '').toLowerCase().includes(categoryKeyword)) return false;
        if (supplierKeyword && !(item.supplier || '').toLowerCase().includes(supplierKeyword)) return false;
        if (itemKeyword && !(item.item || '').toLowerCase().includes(itemKeyword)) return false;
        return true;
    });

    filteredData.sort((a, b) => {
        let valA = a[currentSort.column] || '';
        let valB = b[currentSort.column] || '';

        if (['qty', 'price', 'total'].includes(currentSort.column)) {
            valA = Number(valA);
            valB = Number(valB);
        }

        if (valA < valB) return currentSort.asc ? -1 : 1;
        if (valA > valB) return currentSort.asc ? 1 : -1;
        return 0;
    });

    renderTable();
    renderSummary();
}

function renderTable() {
    elTotalCount.textContent = `${filteredData.length}건`;
    if (elSelectAll) elSelectAll.checked = false;
    updateActionBar();

    const elPagination = document.getElementById('pagination');

    if (filteredData.length === 0) {
        elTableBody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding:30px; color:var(--gray-500);">조건에 맞는 데이터가 없습니다.</td></tr>';
        if (elPagination) elPagination.innerHTML = '';
        return;
    }

    // Pagination calculation
    const totalFiltered = filteredData.length;
    const effectivePageSize = (pageSize === 0) ? totalFiltered : pageSize;
    const totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(totalFiltered / effectivePageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const startIdx = (currentPage - 1) * effectivePageSize;
    const endIdx = (pageSize === 0) ? totalFiltered : Math.min(startIdx + effectivePageSize, totalFiltered);
    const pageItems = filteredData.slice(startIdx, endIdx);

    let html = '';

    pageItems.forEach(item => {
        html += `
            <tr class="item-row" data-id="${item.id}" onclick="openModal('${item.id}')">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${item.id}" onclick="updateActionBar()"></td>
                <td style="color:var(--gray-600);">${item.date || '-'}</td>
                <td style="font-weight:600; color:#1e293b;">${item.site || '-'}</td>
                <td>${item.supplier || '-'}</td>
                <td>${item.manufacturer || '-'}</td>
                <td><span style="background:#e2e8f0; padding:4px 8px; border-radius:4px; font-weight:600; color:#475569;">${item.category || '-'}</span></td>
                <td style="font-weight:500;">${item.item || '-'}</td>
                <td>${item.spec || '-'}</td>
                <td style="color:var(--primary); font-weight:600;">${item.totalQty || '-'}</td>
                <td class="text-right">${Number(item.qty).toLocaleString() || '0'}</td>
                <td class="text-right">${Number(item.price).toLocaleString() || '0'}</td>
                <td class="text-right" style="color:#0f172a; font-weight:700;">${Number(item.total).toLocaleString() || '0'}</td>
            </tr>
        `;
    });

    elTableBody.innerHTML = html;
    renderPagination(totalFiltered, totalPages, startIdx, endIdx);
}

function getPageNumbers(current, total) {
    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, current - Math.floor(maxVisible / 2));
    let end = start + maxVisible - 1;
    if (end > total) { end = total; start = Math.max(1, end - maxVisible + 1); }
    if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total) { if (end < total - 1) pages.push('...'); pages.push(total); }
    return pages;
}

function renderPagination(totalFiltered, totalPages, startIdx, endIdx) {
    const container = document.getElementById('pagination');
    if (!container) return;
    if (totalFiltered === 0) { container.innerHTML = ''; return; }

    let html = '<div class="pagination-bar">';
    html += '<div class="pagination-info">';
    html += '<div class="page-size-wrap">';
    html += '<label for="pageSizeSelect">페이지당</label>';
    html += '<select id="pageSizeSelect" class="page-size-select">';
    [{ value: 50, label: '50개' }, { value: 100, label: '100개' }, { value: 150, label: '150개' }, { value: 200, label: '200개' }, { value: 0, label: '전체' }].forEach(s => {
        html += `<option value="${s.value}"${s.value === pageSize ? ' selected' : ''}>${s.label}</option>`;
    });
    html += '</select></div>';
    html += `<span class="pagination-summary">총 <strong>${totalFiltered}</strong>건`;
    if (totalFiltered !== itemsData.length) html += ` <span class="filtered-note">(검색결과, 전체 ${itemsData.length}건)</span>`;
    if (pageSize !== 0 && totalFiltered > 0) html += `  |  <strong>${startIdx + 1}</strong> – <strong>${endIdx}</strong>번째`;
    html += '</span></div>';

    if (totalPages > 1) {
        html += '<div class="pagination-controls">';
        html += `<button class="page-btn" onclick="goToPage(1)"${currentPage === 1 ? ' disabled' : ''} title="처음"><i class='bx bx-chevrons-left'></i></button>`;
        html += `<button class="page-btn" onclick="goToPage(${currentPage - 1})"${currentPage === 1 ? ' disabled' : ''} title="이전"><i class='bx bx-chevron-left'></i></button>`;
        getPageNumbers(currentPage, totalPages).forEach(pg => {
            if (pg === '...') html += '<span class="page-ellipsis">…</span>';
            else html += `<button class="page-btn${pg === currentPage ? ' active' : ''}" onclick="goToPage(${pg})">${pg}</button>`;
        });
        html += `<button class="page-btn" onclick="goToPage(${currentPage + 1})"${currentPage === totalPages ? ' disabled' : ''} title="다음"><i class='bx bx-chevron-right'></i></button>`;
        html += `<button class="page-btn" onclick="goToPage(${totalPages})"${currentPage === totalPages ? ' disabled' : ''} title="끝"><i class='bx bx-chevrons-right'></i></button>`;
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;

    const sizeSelect = document.getElementById('pageSizeSelect');
    if (sizeSelect) sizeSelect.addEventListener('change', function() { pageSize = parseInt(this.value, 10); currentPage = 1; renderTable(); renderSummary(); });
}

window.goToPage = function(page) { currentPage = page; renderTable(); };

function renderSummary() {
    let sumTotalQty = 0; 
    let sumTotal = 0;    
    let units = new Set(); 
    let siteStats = {}; 
    let categoryStats = {}; 
    let globalMonths = new Set(); 

    filteredData.forEach(record => {
        const monthStr = record.date ? record.date.substring(0, 7) : '미상';
        if (monthStr !== '미상') globalMonths.add(monthStr);

        const numMatch = (record.spec || '').match(/[\d\.]+/);
        let calcSpecQty = 0;
        let currentUnit = '';

        if (numMatch && record.qty > 0) {
            calcSpecQty = Number(numMatch[0]) * record.qty;
            sumTotalQty += calcSpecQty;
            currentUnit = (record.spec || '').replace(/[\d\.\s]/g, '');
            if(currentUnit) units.add(currentUnit);
        }
        sumTotal += Number(record.total) || 0;

        const siteName = record.site || '미지정';
        if (!siteStats[siteName]) siteStats[siteName] = { specQty: 0, unit: '', count: 0, months: new Set() };
        siteStats[siteName].specQty += calcSpecQty;
        if (currentUnit) siteStats[siteName].unit = currentUnit;
        siteStats[siteName].count += 1; 
        if (monthStr !== '미상') siteStats[siteName].months.add(monthStr);

        const categoryName = record.category || '미분류';
        if (!categoryStats[categoryName]) categoryStats[categoryName] = { specQty: 0, unit: '', count: 0, months: new Set() };
        categoryStats[categoryName].specQty += calcSpecQty;
        if (currentUnit) categoryStats[categoryName].unit = currentUnit;
        categoryStats[categoryName].count += 1;
        if (monthStr !== '미상') categoryStats[categoryName].months.add(monthStr);
    });

    const unitDisplay = units.size === 1 ? Array.from(units)[0] : '';
    const displayTotalQty = sumTotalQty > 0 ? `${sumTotalQty.toLocaleString()} ${unitDisplay}`.trim() : '0';
    
    const globalMonthCount = globalMonths.size || 1;
    const globalMonthlyAvg = Math.round(sumTotalQty / globalMonthCount);
    const displayGlobalMonthlyAvg = globalMonthlyAvg > 0 ? `${globalMonthlyAvg.toLocaleString()} ${unitDisplay}/월`.trim() : '0';
    
    const siteCount = Object.keys(siteStats).length;

    let summaryHtml = `
        <div style="display: flex; gap: 40px; flex-wrap: wrap; margin-bottom: 10px;">
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 13px; color: var(--gray-500); font-weight: 600; margin-bottom: 4px;">납품 현장 수</span>
                <span style="font-size: 20px; font-weight: 700; color: #059669;">${siteCount} 곳</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 13px; color: var(--gray-500); font-weight: 600; margin-bottom: 4px;">총 조회 건수</span>
                <span style="font-size: 20px; font-weight: 700; color: #1e293b;">${filteredData.length} 건</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 13px; color: var(--gray-500); font-weight: 600; margin-bottom: 4px;">전체수량 합계</span>
                <span style="font-size: 20px; font-weight: 700; color: var(--primary);">${displayTotalQty}</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 13px; color: var(--gray-500); font-weight: 600; margin-bottom: 4px;">전체 월 평균 소요량</span>
                <span style="font-size: 20px; font-weight: 700; color: #f59e0b;">${displayGlobalMonthlyAvg}</span>
            </div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 13px; color: var(--gray-500); font-weight: 600; margin-bottom: 4px;">총 납품액 (공급가)</span>
                <span style="font-size: 20px; font-weight: 700; color: var(--primary);">${sumTotal.toLocaleString()} 원</span>
            </div>
        </div>
        <div style="display: flex; gap: 20px; flex-wrap: wrap;">
    `;

    // 현장별
    if (siteCount > 0) {
        summaryHtml += `
            <div style="flex: 1; min-width: 300px; background: rgba(255, 255, 255, 0.7); border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px;">
                <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 12px;">🏢 현장별 소요량 상세</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;">
        `;
        for (const [site, stat] of Object.entries(siteStats)) {
            const siteMonthCount = stat.months.size || 1;
            const siteMonthlyAvg = Math.round(stat.specQty / siteMonthCount);
            const displaySiteQty = stat.specQty > 0 ? `${stat.specQty.toLocaleString()} ${stat.unit}`.trim() : '0';
            const displaySiteMonthlyAvg = siteMonthlyAvg > 0 ? `${siteMonthlyAvg.toLocaleString()} ${stat.unit}/월`.trim() : '0';

            summaryHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 12px 14px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                    <span style="font-weight: 600; color: #334155; font-size: 14px; word-break: keep-all; margin-right: 10px;">${site}</span>
                    <div style="text-align: right; min-width: 100px;">
                        <div style="font-size: 12px; color: #64748b; margin-bottom: 2px;">누적: <span style="color: #0f172a; font-weight: 600;">${displaySiteQty}</span></div>
                        <div style="color: var(--primary); font-weight: 700; font-size: 15px;">평균 ${displaySiteMonthlyAvg}</div>
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">총 ${stat.count}회 납품</div>
                    </div>
                </div>
            `;
        }
        summaryHtml += `</div></div>`;
    }

    // 구분별
    if (Object.keys(categoryStats).length > 0) {
        summaryHtml += `
            <div style="flex: 1; min-width: 300px; background: rgba(255, 255, 255, 0.7); border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px;">
                <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 12px;">📑 구분별 소요량 상세</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;">
        `;
        for (const [category, stat] of Object.entries(categoryStats)) {
            const categoryMonthCount = stat.months.size || 1;
            const categoryMonthlyAvg = Math.round(stat.specQty / categoryMonthCount);
            const displayCategoryQty = stat.specQty > 0 ? `${stat.specQty.toLocaleString()} ${stat.unit}`.trim() : '0';
            const displayCategoryMonthlyAvg = categoryMonthlyAvg > 0 ? `${categoryMonthlyAvg.toLocaleString()} ${stat.unit}/월`.trim() : '0';

            summaryHtml += `
                <div style="display: flex; justify-content: space-between; align-items: center; background: #ffffff; padding: 12px 14px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
                    <span style="font-weight: 600; color: #334155; font-size: 14px; word-break: keep-all; margin-right: 10px;">${category}</span>
                    <div style="text-align: right; min-width: 100px;">
                        <div style="font-size: 12px; color: #64748b; margin-bottom: 2px;">누적: <span style="color: #0f172a; font-weight: 600;">${displayCategoryQty}</span></div>
                        <div style="color: var(--primary); font-weight: 700; font-size: 15px;">평균 ${displayCategoryMonthlyAvg}</div>
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">총 ${stat.count}회 납품</div>
                    </div>
                </div>
            `;
        }
        summaryHtml += `</div></div>`;
    }

    summaryHtml += `</div>`;
    summaryBox.innerHTML = summaryHtml;
}

// ==========================================
// CRUD 로직
// ==========================================

window.openModal = function(id = null) {
    itemForm.reset();
    document.getElementById('editId').value = '';
    document.getElementById('inpTotalQty').value = '';
    document.getElementById('inpTotal').value = '';

    if (id) {
        const item = itemsData.find(d => d.id === id);
        if (!item) return;
        document.getElementById('modalTitle').textContent = '납품 내역 수정';
        document.getElementById('editId').value = item.id;
        document.getElementById('inpDate').value = item.date || '';
        document.getElementById('inpSite').value = item.site || '';
        document.getElementById('inpCategory').value = item.category || '';
        document.getElementById('inpSupplier').value = item.supplier || '';
        document.getElementById('inpManufacturer').value = item.manufacturer || '';
        document.getElementById('inpItem').value = item.item || '';
        document.getElementById('inpSpec').value = item.spec || '';
        document.getElementById('inpTotalQty').value = item.totalQty || '';
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

    // 규격 기준 전체 수량 계산
    const specVal = document.getElementById('inpSpec').value.trim();
    const numMatch = specVal.match(/[\d\.]+/);
    if (numMatch && qty > 0) {
        const specNum = Number(numMatch[0]);
        const unit = specVal.replace(/[\d\.\s]/g, '');
        document.getElementById('inpTotalQty').value = (specNum * qty).toLocaleString() + unit;
    } else {
        document.getElementById('inpTotalQty').value = '';
    }
};

async function saveItem() {
    const id = document.getElementById('editId').value;
    
    const qtyStr = document.getElementById('inpQty').value.replace(/,/g, '');
    const priceStr = document.getElementById('inpPrice').value.replace(/,/g, '');
    const qty = parseInt(qtyStr) || 0;
    const price = parseInt(priceStr) || 0;

    const payload = {
        date: document.getElementById('inpDate').value,
        site: document.getElementById('inpSite').value.trim(),
        category: document.getElementById('inpCategory').value.trim(),
        supplier: document.getElementById('inpSupplier').value.trim(),
        manufacturer: document.getElementById('inpManufacturer').value.trim(),
        item: document.getElementById('inpItem').value.trim(),
        spec: document.getElementById('inpSpec').value.trim(),
        totalQty: document.getElementById('inpTotalQty').value.trim(),
        qty: qty,
        price: price,
        total: qty * price
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
// Excel & Migration
// ==========================================

function downloadExcel() {
    if (filteredData.length === 0) return showToast('다운로드할 데이터가 없습니다.', 'warning');

    let csvContent = '\uFEFF'; 
    csvContent += "id,공급일자,현장명,공급사,제조사,구분,품명,규격,전체수량,수량,단가(원),총액(원)\n";

    filteredData.forEach(record => {
        const row = [
            record.id,
            record.date,
            `"${record.site || ''}"`,
            `"${record.supplier || ''}"`,
            `"${record.manufacturer || ''}"`,
            `"${record.category || ''}"`,
            `"${record.item || ''}"`,
            `"${record.spec || ''}"`,
            `"${record.totalQty || ''}"`,
            record.qty || 0,
            record.price || 0,
            record.total || 0
        ].join(',');
        csvContent += row + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    const today = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `유류자재납품대장_${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        elUploadBtn.innerText = '업로드 중...';
        elUploadBtn.disabled = true;

        const reader = new FileReader();
        reader.onload = async function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                
                let recordsToAdd = [];
                const formatExcelDate = (excelDate) => {
                    if (!excelDate) return new Date().toISOString().split('T')[0];
                    if (typeof excelDate === 'number') {
                        const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
                        return `${jsDate.getUTCFullYear()}-${String(jsDate.getUTCMonth() + 1).padStart(2, '0')}-${String(jsDate.getUTCDate()).padStart(2, '0')}`;
                    }
                    return String(excelDate).trim();
                };
                const parseNumber = (val) => Number(String(val).replace(/[^0-9.-]+/g, "")) || 0;
                
                for (let i = 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0 || (!row[1] && !row[6])) continue;

                    const qty = parseNumber(row[9]); 
                    const price = parseNumber(row[10]);

                    recordsToAdd.push({
                        id: row[0] || ('OSH-EX-' + Date.now() + i),
                        date: formatExcelDate(row[1]),
                        site: String(row[2]).trim(),
                        supplier: String(row[3]).trim(),
                        manufacturer: String(row[4]).trim(),
                        category: String(row[5]).trim(),
                        item: String(row[6]).trim(),
                        spec: String(row[7]).trim(),
                        totalQty: String(row[8]).trim(),
                        qty: qty,
                        price: price,
                        total: parseNumber(row[11]) || (qty * price)
                    });
                }

                if (recordsToAdd.length === 0) { 
                    showToast('데이터가 없습니다.', 'warning'); 
                    return; 
                }

                const res = await fetch(`${API_BASE}/bulk`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(recordsToAdd)
                });

                if (res.ok) {
                    showToast(`${recordsToAdd.length}건 엑셀 업로드 완료!`, 'success');
                    loadData();
                } else {
                    showToast('업로드 실패', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('파일 파싱 오류', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    } finally {
        event.target.value = ''; 
        elUploadBtn.innerHTML = "<i class='bx bx-upload'></i> 엑셀 업로드";
        elUploadBtn.disabled = false;
    }
}

async function runMigration() {
    if (itemsData.length > 0) {
        if (!confirm('이미 NAS DB에 데이터가 존재합니다. 구글 시트에서 데이터를 다시 가져올까요? (기존 데이터 위에 덮어쓰거나 중복될 수 있습니다)')) return;
    }
    
    try {
        elMigrateBtn.disabled = true;
        elMigrateBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 구글 시트에서 가져오는 중...";
        
        const res = await fetch(OLD_SCRIPT_URL);
        if (!res.ok) throw new Error('구글 시트 데이터를 불러올 수 없습니다.');
        const oldData = await res.json();
        
        const newPayload = oldData.map((row, i) => {
            let dt = new Date().toISOString().split('T')[0];
            if (row.date && row.date.includes('T')) {
                const d = new Date(row.date);
                dt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }

            return {
                id: 'OSH-MIG-' + String(i).padStart(4, '0'),
                date: dt,
                site: row.site || '',
                supplier: row.supplier || '',
                manufacturer: row.manufacturer || '',
                category: row.category || '',
                item: row.item || '',
                spec: row.spec || '',
                totalQty: row.totalQty || '',
                qty: Number(row.qty) || 0,
                price: Number(row.price) || 0,
                total: Number(row.total) || 0
            };
        });

        elMigrateBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> NAS에 저장 중...";
        const saveRes = await fetch(`${API_BASE}/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPayload)
        });

        if (saveRes.ok) {
            const data = await saveRes.json();
            showToast(`${data.insertedCount}건 마이그레이션 성공!`, 'success');
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
        elMigrateBtn.innerHTML = "<i class='bx bx-cloud-download'></i> 구글 시트 데이터 가져오기";
    }
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = 'bx-info-circle';
    if (type === 'success') icon = 'bx-check-circle';
    if (type === 'error') icon = 'bx-error-circle';
    if (type === 'warning') icon = 'bx-error';

    toast.innerHTML = `<i class='bx ${icon}'></i> <span>${msg}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => { toast.classList.add('show'); }, 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
