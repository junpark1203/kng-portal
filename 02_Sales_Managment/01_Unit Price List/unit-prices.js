/* =========================================================================
   유류소모품 단가 관리 시스템 (unit-prices.js)
   - NAS API (/api/unit-prices) 연동
   - CRUD 및 마이그레이션 기능 포함
========================================================================= */

const API_BASE = 'https://kng.junparks.com/api/unit-prices';
let itemsData = [];
let filteredData = [];
let currentSort = { column: 'updatedAt', asc: false };

// Pagination state
let currentPage = 1;
let pageSize = 50;

// Elements
const elTableBody = document.getElementById('tableBody');
const elTotalCount = document.getElementById('totalCount');
const elSearchField = document.getElementById('searchField');
const elSearchInput = document.getElementById('searchInput');
const elPagination = document.getElementById('pagination');
const elSelectAll = document.getElementById('selectAll');
const elDeleteBtn = document.getElementById('deleteBtn');
const elAddBtn = document.getElementById('addBtn');
const elMigrateBtn = document.getElementById('migrateBtn');
const toastContainer = document.getElementById('toastContainer');

// Modal Elements
const itemModal = document.getElementById('itemModal');
const itemForm = document.getElementById('itemForm');
const historyModal = document.getElementById('historyModal');

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadData();
});

function initEvents() {
    // Search
    elSearchInput.addEventListener('input', () => {
        currentPage = 1;
        applyFiltersAndSort();
    });
    elSearchField.addEventListener('change', () => {
        currentPage = 1;
        applyFiltersAndSort();
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
    elSelectAll.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        document.querySelectorAll('.row-check').forEach(cb => {
            cb.checked = isChecked;
        });
    });

    // Add Button
    elAddBtn.addEventListener('click', () => openModal());

    // Delete Button
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

    // Migration Button
    elMigrateBtn.addEventListener('click', runMigration);

    // Modal Events
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    window.addEventListener('click', (e) => {
        if (e.target === itemModal) closeModal();
        if (e.target === historyModal) closeHistoryModal();
    });

    document.getElementById('closeHistoryModalBtn').addEventListener('click', closeHistoryModal);

    itemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveItem();
    });
}

function updateSortIcons() {
    updateSortUI(currentSort.column, currentSort.asc);
}

async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error('API fetch failed');
        itemsData = await res.json();
        updateDatalists();
        applyFiltersAndSort();
    } catch (e) {
        console.error(e);
        elTableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:red;">데이터를 불러오는 중 오류가 발생했습니다. NAS 서버 상태를 확인해주세요.</td></tr>';
    }
}

function applyFiltersAndSort() {
    const query = elSearchInput.value.toLowerCase().trim();
    const field = elSearchField.value;

    filteredData = itemsData.filter(item => {
        if (!query) return true;
        if (field === 'all') {
            return (item.co || '').toLowerCase().includes(query) ||
                   (item.mfr || '').toLowerCase().includes(query) ||
                   (item.item || '').toLowerCase().includes(query) ||
                   (item.spec || '').toLowerCase().includes(query);
        }
        return (item[field] || '').toLowerCase().includes(query);
    });

    applySorting(filteredData, currentSort.column, currentSort.asc, [], ['price', 'sellPrice']);

    renderTable();
}

function renderTable() {
    elTotalCount.textContent = `${filteredData.length}건`;
    elSelectAll.checked = false;

    if (filteredData.length === 0) {
        elTableBody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:30px; color:var(--gray-500);">데이터가 없습니다.</td></tr>';
        elPagination.innerHTML = '';
        return;
    }

    const totalFiltered = filteredData.length;
    const pg = calcPagination(totalFiltered, currentPage, pageSize);
    currentPage = pg.page;
    const currentItems = filteredData.slice(pg.startIdx, pg.endIdx);

    let html = '';
    currentItems.forEach(item => {
        const dateStr = item.updatedAt ? item.updatedAt.split('T')[0] : '';
        
        // 마진율 계산
        let marginText = '-';
        if (item.price && item.sellPrice) {
            const buy = parseFloat(item.price.replace(/,/g, ''));
            const sell = parseFloat(item.sellPrice.replace(/,/g, ''));
            if (!isNaN(buy) && !isNaN(sell) && sell > 0) {
                marginText = ((sell - buy) / sell * 100).toFixed(2) + '%';
            }
        }

        html += `
            <tr class="item-row" data-id="${item.id}">
                <td class="col-check" onclick="event.stopPropagation()"><input type="checkbox" class="row-check" value="${item.id}"></td>
                <td onclick="openModal('${item.id}')"><strong>${item.co || '-'}</strong></td>
                <td onclick="openModal('${item.id}')" class="mfr-tag">${item.mfr || '-'}</td>
                <td onclick="openModal('${item.id}')">${item.item || '-'}</td>
                <td onclick="openModal('${item.id}')">${item.spec || '-'}</td>
                <td onclick="openModal('${item.id}')">${item.price && item.price !== '-' ? '\\ ' + item.price : '-'}</td>
                <td onclick="openModal('${item.id}')">${item.sellPrice && item.sellPrice !== '-' ? '\\ ' + item.sellPrice : '-'}</td>
                <td onclick="openModal('${item.id}')" style="font-weight:600; color:var(--primary);">${marginText}</td>
                <td onclick="event.stopPropagation()"><button class="btn-history" onclick="window.showHistory('${item.id}')">보기</button></td>
                <td onclick="openModal('${item.id}')">${item.note || ''}</td>
                <td onclick="openModal('${item.id}')" style="font-size:12px; color:var(--gray-500);">${dateStr}</td>
            </tr>
        `;
    });

    elTableBody.innerHTML = html;
    renderPagination({
        container: elPagination,
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

function updateDatalists() {
    const coSet = new Set(), mfrSet = new Set(), itemSet = new Set(), specSet = new Set();
    itemsData.forEach(d => {
        if (d.co && d.co !== "-") coSet.add(d.co);
        if (d.mfr && d.mfr !== "-") mfrSet.add(d.mfr);
        if (d.item && d.item !== "-") itemSet.add(d.item);
        if (d.spec && d.spec !== "-") specSet.add(d.spec);
    });

    const fillDatalist = (id, set) => {
        const dl = document.getElementById(id);
        if (dl) dl.innerHTML = [...set].sort().map(val => `<option value="${val}">`).join('');
    };

    fillDatalist('listCo', coSet);
    fillDatalist('listMfr', mfrSet);
    fillDatalist('listItem', itemSet);
    fillDatalist('listSpec', specSet);
}

// ==========================================
// CRUD 로직
// ==========================================

window.openModal = function(id = null) {
    itemForm.reset();
    document.getElementById('timestampDisplay').textContent = '';
    document.getElementById('inpHistory').value = '';

    if (id) {
        const item = itemsData.find(d => d.id === id);
        if (!item) return;
        document.getElementById('modalTitle').textContent = '단가 수정';
        document.getElementById('editId').value = item.id;
        document.getElementById('inpCo').value = item.co || '';
        document.getElementById('inpMfr').value = item.mfr || '';
        document.getElementById('inpItem').value = item.item || '';
        document.getElementById('inpSpec').value = item.spec || '';
        document.getElementById('inpPrice').value = item.price || '';
        document.getElementById('inpSellPrice').value = item.sellPrice || '';
        document.getElementById('inpNote').value = item.note || '';
        document.getElementById('inpHistory').value = item.history || '';
        
        if (window.calculateMargin) window.calculateMargin();
        
        if (item.updatedAt) {
            const dt = new Date(item.updatedAt);
            document.getElementById('timestampDisplay').textContent = `최종 수정: ${dt.toLocaleString()}`;
        }
    } else {
        document.getElementById('modalTitle').textContent = '신규 단가 등록';
        document.getElementById('editId').value = '';
        document.getElementById('inpSellPrice').value = '';
        if (window.calculateMargin) window.calculateMargin();
    }

    itemModal.classList.add('active');
};

function closeModal() {
    itemModal.classList.remove('active');
}

async function saveItem() {
    const id = document.getElementById('editId').value;
    const payload = {
        co: document.getElementById('inpCo').value.trim(),
        mfr: document.getElementById('inpMfr').value.trim(),
        item: document.getElementById('inpItem').value.trim(),
        spec: document.getElementById('inpSpec').value.trim(),
        price: document.getElementById('inpPrice').value.trim(),
        sellPrice: document.getElementById('inpSellPrice').value.trim(),
        note: document.getElementById('inpNote').value.trim()
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
// 이력 모달
// ==========================================
window.showHistory = function(id) {
    const item = itemsData.find(d => d.id === id);
    if (!item) return;
    document.getElementById('historyModalTitle').innerText = `${item.mfr} - ${item.item} 이력`;
    document.getElementById('historyModalBody').innerText = item.history || '이력 없음';
    historyModal.classList.add('active');
};

function closeHistoryModal() {
    historyModal.classList.remove('active');
}

// ==========================================
// Toast & Migration
// ==========================================
// showToast() — provided by kng-table-utils.js

// 초기 마이그레이션 함수
async function runMigration() {
    if (itemsData.length > 0) {
        if (!confirm('이미 DB에 데이터가 존재합니다. 마이그레이션을 계속 진행하시겠습니까? (중복 데이터가 발생할 수 있습니다)')) return;
    }
    
    // 기존 HTML 하드코딩 데이터
    const oldData = [
        { co: "양지유화", mfr: "SHELL", item: "Hydraulic 46", spec: "200L(D/M)", price: "437,000", history: "2026-00-00: 437,000\n2026-00-00: -", note: "유압유" },
        { co: "양지유화", mfr: "SHELL", item: "Hydraulic 46", spec: "20L(P/L)", price: "46,000", history: "2026-00-00: 46,000\n2026-00-00: -", note: "유압유" },
        { co: "양지유화", mfr: "SHELL", item: "Hydraulic 68", spec: "200L(D/M)", price: "437,000", history: "2026-00-00: 437,000\n2026-00-00: -", note: "유압유" },
        { co: "양지유화", mfr: "SHELL", item: "Hydraulic 68", spec: "20L(P/L)", price: "46,000", history: "2026-00-00: 46,000\n2026-00-00: -", note: "유압유" },
        { co: "양지유화", mfr: "SHELL", item: "Tellus S2 MX 68", spec: "200L(D/M)", price: "578,000", history: "2026-00-00: 578,000\n2026-00-00: -", note: "유압유" },
        { co: "양지유화", mfr: "SHELL", item: "Tellus S2 MX 46", spec: "20L(P/L)", price: "98,000", history: "2026-04-08: 98,000\n2026-00-00: 78,000", note: "유압유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer AW 46", spec: "20L(P/L)", price: "55,000", history: "2026-04-01: 55,000\n2026-03-24: 42,000\n2026-00-00: 36,000", note: "유압유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer AW 46", spec: "200L(D/M)", price: "528,000", history: "2026-04-01: 528,000\n2026-03-24: 420,000\n2026-00-00: 360,000", note: "유압유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer AW 68", spec: "20L(P/L)", price: "56,000", history: "2026-04-01: 56,000\n2026-03-24: 44,000\n2026-00-00: 38,000", note: "유압유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer AW 68", spec: "200L(D/M)", price: "538,000", history: "2026-04-01: 538,000\n2026-03-24: 430,000\n2026-00-00: 370,000", note: "유압유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 150", spec: "20L(P/L)", price: "64,000", history: "2026-04-01: 64,000\n2026-03-24: 53,000\n2026-00-00: 48,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 150", spec: "200L(D/M)", price: "605,000", history: "2026-04-01: 605,000\n2026-03-24: 500,000\n2026-00-00: 470,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 220", spec: "20L(P/L)", price: "64,000", history: "2026-04-01: 64,000\n2026-03-24: 53,000\n2026-00-00: 48,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 220", spec: "200L(D/M)", price: "605,000", history: "2026-04-01: 605,000\n2026-03-24: 500,000\n2026-00-00: 470,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 320", spec: "20L(P/L)", price: "65,000", history: "2026-04-01: 65,000\n2026-03-24: 54,000\n2026-00-00: 49,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer IGO 320", spec: "200L(D/M)", price: "615,000", history: "2026-04-01: 615,000\n2026-03-24: 510,000\n2026-00-00: 480,000", note: "기어유" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer Grease EP 0", spec: "15kg(P/L)", price: "73,000", history: "2026-04-01: 73,000\n2026-03-24: 62,000\n2026-00-00: 55,000", note: "그리스" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer Grease EP 1", spec: "15kg(P/L)", price: "75,000", history: "2026-04-01: 75,000\n2026-03-24: 65,000\n2026-00-00: 60,000", note: "그리스" },
        { co: "양지유화", mfr: "현대오일뱅크", item: "Xteer Grease EP 2", spec: "15kg(P/L)", price: "76,000", history: "2026-04-01: 76,000\n2026-03-24: 67,000\n2026-00-00: 62,000", note: "그리스" },
        { co: "양지유화", mfr: "대성석유화학", item: "COSMOA EP #1", spec: "15kg(P/L)", price: "84,000", history: "2026-04-13: 84,000\n2026-04-06: 79,000\n2026-03-25: 72,000\n이전: 65,000", note: "그리스" },
        { co: "양지유화", mfr: "대성석유화학", item: "COSMOA EP #2", spec: "15kg(P/L)", price: "84,000", history: "2026-04-13: 84,000\n2026-04-06: 79,000\n2026-03-25: 72,000\n이전: 65,000", note: "그리스" },
        { co: "양지유화", mfr: "대성석유화학", item: "COSMOA EP #3", spec: "15kg(P/L)", price: "84,000", history: "2026-04-13: 84,000\n2026-04-06: 79,000\n2026-03-25: 72,000\n이전: 65,000", note: "그리스" },
        { co: "맥테크놀로지", mfr: "맥테크", item: "MAK SEAL 270", spec: "KG", price: "1,760", history: "2026-04-20: 1,760\n(기존 500원->변경 280원 인상, 2026-04-20~2026-05-31 공급분 적용)\n이전: 1,480", note: "테일씰그리스(일반굴진용)" },
        { co: "맥테크놀로지", mfr: "맥테크", item: "MAK SEAL 230", spec: "KG", price: "1,810", history: "2026-04-20: 1,810\n(기존 500원->변경 280원 인상, 2026-04-20~2026-05-31 공급분 적용)\n이전: 1,530", note: "테일씰그리스(초기굴진용)" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X EP 2 Grease", spec: "15kg(P/L)", price: "58,500", history: "2025-03-30: 58,500", note: "그리스" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X EP 1 Grease", spec: "15kg(P/L)", price: "57,000", history: "2025-03-30: 57,000", note: "그리스" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X EP 0 Grease", spec: "15kg(P/L)", price: "52,500", history: "2025-03-30: 52,500", note: "그리스" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X LUBE HF 46S", spec: "20L(P/L)", price: "44,000", history: "2026-04-06: 44,000\n2026-01-16: 34,000", note: "유압유" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X LUBE HF 46S", spec: "200L(D/M)", price: "413,000", history: "2026-04-06: 413,000\n2026-01-16: 320,000", note: "유압유" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X LUBE HF 68S", spec: "20L(P/L)", price: "46,000", history: "2026-04-06: 46,000\n2026-01-16: 36,000", note: "유압유" },
        { co: "DRT(디알티)", mfr: "광우KCC", item: "2X LUBE HF 68S", spec: "200L(D/M)", price: "440,000", history: "2026-04-06: 440,000\n2026-01-16: 340,000", note: "유압유" },
        { co: "DRT(디알티)", mfr: "RECORD", item: "TMT-100", spec: "KG", price: "1,450-운임별도", history: "2026-01-15: 1,450\n2026-01-02: 1,600", note: "테일씰그리스\n70KG 보유재고분" }
    ];

    try {
        elMigrateBtn.disabled = true;
        elMigrateBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";
        
        const res = await fetch(`${API_BASE}/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(oldData)
        });

        if (res.ok) {
            const data = await res.json();
            showToast(`${data.insertedCount}건 마이그레이션 완료`, 'success');
            loadData();
        } else {
            const err = await res.json();
            showToast('마이그레이션 실패: ' + err.error, 'error');
        }
    } catch (e) {
        console.error(e);
        showToast('마이그레이션 중 오류 발생', 'error');
    } finally {
        elMigrateBtn.disabled = false;
        elMigrateBtn.innerHTML = "<i class='bx bx-cloud-upload'></i> 데이터 마이그레이션";
    }
}
