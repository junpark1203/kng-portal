const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000/api/report-builder`
    : 'https://kng.junparks.com/api/report-builder';

// 앱 상태
let state = {
    currentDocId: null,
    columns: [
        { id: 'col_no', name: 'No.', type: 'text' },
        { id: 'col_sample', name: '현재 샘플', type: 'image' },
        { id: 'col_example', name: '예시', type: 'image' },
        { id: 'col_request', name: '요청사항', type: 'text' }
    ],
    rows: []
};

// DOM 요소
const listView = document.getElementById('listView');
const editorView = document.getElementById('editorView');
const reportList = document.getElementById('reportList');
const reportTitleInput = document.getElementById('reportTitleInput');
const displayTitle = document.getElementById('displayTitle');
const displayDate = document.getElementById('displayDate');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const colControls = document.getElementById('colControls');
const colModal = document.getElementById('colModal');
const globalLoading = document.getElementById('globalLoading');

// 유틸리티: ID 생성
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// 오늘 날짜 포맷
function getTodayFormat() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// --- Auth Fetch ---
async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, opts);
    if (!res.ok && res.status === 401 && _retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return authFetch(url, opts, _retries - 1);
    }
    return res;
}

// 로딩 표시
function showLoading(show) {
    if(show) globalLoading.classList.remove('hidden');
    else globalLoading.classList.add('hidden');
}

// 초기화
async function init() {
    bindEvents();
    await loadReportList();
}

// 이벤트 바인딩
function bindEvents() {
    document.getElementById('createNewBtn').addEventListener('click', createNewReport);
    document.getElementById('backToListBtn').addEventListener('click', () => {
        editorView.classList.add('hidden');
        listView.classList.remove('hidden');
        loadReportList();
    });
    
    document.getElementById('saveBtn').addEventListener('click', saveReport);
    document.getElementById('printBtn').addEventListener('click', () => window.print());
    
    document.getElementById('addRowBtn').addEventListener('click', () => {
        state.rows.push(createEmptyRow());
        renderTable();
    });
    
    reportTitleInput.addEventListener('input', (e) => {
        displayTitle.textContent = e.target.value || '제목 없는 보고서';
    });
    
    document.getElementById('closeColModal').addEventListener('click', () => colModal.classList.add('hidden'));
    document.getElementById('addColForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('colName').value;
        const type = document.getElementById('colType').value;
        state.columns.push({ id: 'col_' + generateId(), name, type });
        // 기존 행들에 빈 데이터 추가
        state.rows.forEach(row => { row[state.columns[state.columns.length-1].id] = type === 'image' ? [] : ''; });
        colModal.classList.add('hidden');
        renderTable();
    });
}

// 빈 행 생성
function createEmptyRow() {
    const row = { id: 'row_' + generateId() };
    state.columns.forEach(col => {
        row[col.id] = col.type === 'image' ? [] : '';
    });
    return row;
}

// 보고서 목록 불러오기
async function loadReportList() {
    try {
        const res = await authFetch(API_BASE);
        if (!res.ok) throw new Error('목록 조회 실패');
        const list = await res.json();
        
        reportList.innerHTML = '';
        if (list.length === 0) {
            reportList.innerHTML = '<p style="color: #6b7280;">저장된 보고서가 없습니다.</p>';
            return;
        }
        
        list.forEach(item => {
            const date = new Date(item.updatedAt).toLocaleDateString();
            const card = document.createElement('div');
            card.className = 'report-card';
            card.innerHTML = `
                <h3>${item.title || '제목 없음'}</h3>
                <p>최근 수정: ${date}</p>
                <div class="report-card-actions">
                    <button class="secondary-btn btn-sm" onclick="deleteReport('${item.id}', event)">삭제</button>
                </div>
            `;
            card.addEventListener('click', () => openReport(item.id));
            reportList.appendChild(card);
        });
    } catch (err) {
        console.error(err);
        reportList.innerHTML = '<p style="color: red;">목록을 불러오는 중 오류가 발생했습니다.</p>';
    }
}

// 새 보고서 작성
function createNewReport() {
    state.currentDocId = null;
    // 초기 컬럼 복구
    state.columns = [
        { id: 'col_no', name: 'No.', type: 'text' },
        { id: 'col_sample', name: '현재 샘플', type: 'image' },
        { id: 'col_example', name: '예시', type: 'image' },
        { id: 'col_request', name: '요청사항', type: 'text' }
    ];
    state.rows = [createEmptyRow()]; // 기본 1줄
    
    reportTitleInput.value = '제목 없는 보고서';
    displayTitle.textContent = '제목 없는 보고서';
    displayDate.textContent = getTodayFormat();
    
    renderTable();
    
    listView.classList.add('hidden');
    editorView.classList.remove('hidden');
}

// 보고서 열기
async function openReport(id) {
    showLoading(true);
    try {
        const res = await authFetch(`${API_BASE}/${id}`);
        if (!res.ok) throw new Error('보고서 로드 실패');
        const doc = await res.json();
        
        state.currentDocId = doc.id;
        reportTitleInput.value = doc.title;
        displayTitle.textContent = doc.title;
        displayDate.textContent = new Date(doc.createdAt).toLocaleDateString();
        
        const content = JSON.parse(doc.content_json);
        state.columns = content.columns || [];
        state.rows = content.rows || [];
        
        renderTable();
        listView.classList.add('hidden');
        editorView.classList.remove('hidden');
    } catch (err) {
        console.error(err);
        alert('보고서를 불러올 수 없습니다.');
    } finally {
        showLoading(false);
    }
}

// 저장
async function saveReport() {
    showLoading(true);
    // 현재 행 데이터 동기화 (텍스트는 실시간 반영 중, 이미지는 배열에 있음)
    const payload = {
        title: reportTitleInput.value,
        content_json: JSON.stringify({ columns: state.columns, rows: state.rows })
    };
    
    try {
        const method = state.currentDocId ? 'PUT' : 'POST';
        const url = state.currentDocId ? `${API_BASE}/${state.currentDocId}` : API_BASE;
        
        const res = await authFetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('저장 실패');
        const data = await res.json();
        if (data.id) state.currentDocId = data.id; // 새로 생성된 경우 ID 업데이트
        alert('저장되었습니다.');
    } catch (err) {
        console.error(err);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

// 삭제
async function deleteReport(id, e) {
    e.stopPropagation();
    if(!confirm('정말 삭제하시겠습니까?')) return;
    
    try {
        const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');
        loadReportList();
    } catch (err) {
        alert('삭제 중 오류가 발생했습니다.');
    }
}

// -------------------------------------
// 테이블 렌더링 로직
// -------------------------------------
function renderTable() {
    // 1. 헤더 렌더링
    let headHtml = '<tr>';
    state.columns.forEach((col, index) => {
        headHtml += `
            <th>
                ${col.name}
                ${index > 0 ? `<button class="col-delete-btn no-print" onclick="deleteCol('${col.id}')"><i class='bx bx-trash'></i></button>` : ''}
            </th>
        `;
    });
    headHtml += '</tr>';
    tableHead.innerHTML = headHtml;

    // 2. 컨트롤 버튼 렌더링
    colControls.innerHTML = `<button class="secondary-btn btn-sm" onclick="openAddColModal()"><i class='bx bx-plus'></i> 새 열(Column) 추가</button>`;

    // 3. 본문 렌더링
    tableBody.innerHTML = '';
    state.rows.forEach((row, rIndex) => {
        const tr = document.createElement('tr');
        state.columns.forEach((col, cIndex) => {
            const td = document.createElement('td');
            if (cIndex === 0) { // 삭제 버튼은 첫번째 컬럼에만
                td.innerHTML += `<button class="row-delete-btn no-print" onclick="deleteRow('${row.id}')"><i class='bx bx-x'></i></button>`;
            }
            
            if (col.type === 'text') {
                const ta = document.createElement('textarea');
                ta.className = 'auto-resize';
                ta.placeholder = '텍스트 입력...';
                ta.value = row[col.id] || '';
                ta.oninput = (e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = (e.target.scrollHeight) + 'px';
                    row[col.id] = e.target.value; // 상태 동기화
                };
                // 초기 높이 조절
                setTimeout(() => {
                    ta.style.height = 'auto';
                    ta.style.height = (ta.scrollHeight) + 'px';
                }, 0);
                td.appendChild(ta);
            } else if (col.type === 'image') {
                const cellDiv = document.createElement('div');
                cellDiv.className = 'image-cell';
                
                // 그리드 래퍼
                const gridDiv = document.createElement('div');
                gridDiv.className = 'image-grid';
                
                // 기존 이미지 렌더링
                const images = row[col.id] || [];
                images.forEach((imgUrl, imgIndex) => {
                    const img = document.createElement('img');
                    img.src = imgUrl;
                    // 클릭시 삭제 기능 (선택)
                    img.title = "클릭하여 삭제";
                    img.onclick = () => {
                        if(confirm('이미지를 지우시겠습니까?')) {
                            row[col.id].splice(imgIndex, 1);
                            renderTable();
                        }
                    };
                    gridDiv.appendChild(img);
                });
                
                // 드롭존 렌더링
                const dropzone = document.createElement('div');
                dropzone.className = 'image-dropzone no-print';
                dropzone.innerHTML = `<i class='bx bx-image-add'></i>사진 붙여넣기(Ctrl+V) 또는 드래그`;
                dropzone.tabIndex = 0; // 포커스 가능하게
                
                // 이벤트 설정 (드래그앤드롭 및 페이스트)
                setupImageCellEvents(dropzone, row, col.id);
                
                cellDiv.appendChild(gridDiv);
                cellDiv.appendChild(dropzone);
                td.appendChild(cellDiv);
            }
            tr.appendChild(td);
        });
        tableBody.appendChild(tr);
    });
}

// 컬럼 추가 모달 열기
function openAddColModal() {
    document.getElementById('colName').value = '';
    colModal.classList.remove('hidden');
}

// 컬럼 삭제
function deleteCol(colId) {
    if(!confirm('이 열을 삭제하시겠습니까? 데이터도 함께 지워집니다.')) return;
    state.columns = state.columns.filter(c => c.id !== colId);
    state.rows.forEach(r => delete r[colId]);
    renderTable();
}

// 행 삭제
function deleteRow(rowId) {
    state.rows = state.rows.filter(r => r.id !== rowId);
    renderTable();
}

// -------------------------------------
// 파일 업로드 및 클립보드 이벤트
// -------------------------------------
function setupImageCellEvents(element, rowObj, colId) {
    // 1. 드래그 앤 드롭
    element.addEventListener('dragover', (e) => {
        e.preventDefault();
        element.classList.add('dragover');
    });
    element.addEventListener('dragleave', () => {
        element.classList.remove('dragover');
    });
    element.addEventListener('drop', async (e) => {
        e.preventDefault();
        element.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => handleFileUpload(file, rowObj, colId));
        }
    });

    // 2. 클립보드 붙여넣기 (포커스가 있을 때)
    element.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                handleFileUpload(blob, rowObj, colId);
            }
        }
    });
    
    // 3. 클릭 시 포커스 강제 (붙여넣기 편의)
    element.addEventListener('click', () => element.focus());
}

async function handleFileUpload(file, rowObj, colId) {
    // 로딩 표시기 추가
    showLoading(true);
    const formData = new FormData();
    formData.append('image', file);
    
    try {
        const res = await authFetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) throw new Error('업로드 실패');
        const data = await res.json();
        
        // 상태 업데이트 및 리렌더링
        if (!rowObj[colId]) rowObj[colId] = [];
        rowObj[colId].push(data.url);
        renderTable();
    } catch (err) {
        console.error(err);
        alert('이미지 업로드에 실패했습니다.');
    } finally {
        showLoading(false);
    }
}

// 실행
init();
