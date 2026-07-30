const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000/api/report-builder`
    : 'https://kng.junparks.com/api/report-builder';

// 앱 상태
let state = {
    currentDocId: null,
    columns: [
        { id: 'col_no', name: 'No.', type: 'text', width: 5, hAlign: 'left', vAlign: 'top' },
        { id: 'col_sample', name: '현재 샘플', type: 'image', width: 30, hAlign: 'center', vAlign: 'middle' },
        { id: 'col_example', name: '예시', type: 'image', width: 35, hAlign: 'center', vAlign: 'middle' },
        { id: 'col_request', name: '요청사항', type: 'text', width: 30, hAlign: 'left', vAlign: 'top' }
    ],
    rows: []
};

// DOM
const listView = document.getElementById('listView');
const editorView = document.getElementById('editorView');
const printLayout = document.getElementById('printLayout');
const reportList = document.getElementById('reportList');

const reportTitleInput = document.getElementById('reportTitleInput');
const columnSettingList = document.getElementById('columnSettingList');
const formDataContainer = document.getElementById('formDataContainer');

const displayTitle = document.getElementById('displayTitle');
const displayDate = document.getElementById('displayDate');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');

const colModal = document.getElementById('colModal');
const globalLoading = document.getElementById('globalLoading');

// 유틸
function generateId() { return Math.random().toString(36).substr(2, 9); }
function getTodayFormat() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function showLoading(show) {
    if(show) globalLoading.classList.remove('hidden');
    else globalLoading.classList.add('hidden');
}

function getImgSrc(url) {
    if (!url) return '';
    if (url.startsWith('/api/report-builder')) {
        const base = API_BASE.replace('/api/report-builder', '');
        return base + url;
    }
    return url;
}

// Auth Fetch
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

// 초기화
async function init() {
    bindEvents();
    await loadReportList();
}

function bindEvents() {
    // 뷰 전환 버튼
    document.getElementById('createNewBtn').addEventListener('click', createNewReport);
    document.getElementById('backToListBtn').addEventListener('click', () => {
        editorView.classList.add('hidden');
        listView.classList.remove('hidden');
        loadReportList();
    });
    
    // 저장
    document.getElementById('saveBtn').addEventListener('click', saveReport);
    
    // 인쇄 모드 전환
    document.getElementById('printBtn').addEventListener('click', openPrintPreview);
    document.getElementById('closePrintBtn').addEventListener('click', () => {
        printLayout.style.display = 'none';
        editorView.classList.remove('hidden');
    });
    document.getElementById('doPrintBtn').addEventListener('click', () => window.print());
    
    // 열(Column) 설정
    document.getElementById('openColModalBtn').addEventListener('click', () => {
        document.getElementById('colName').value = '';
        colModal.classList.remove('hidden');
    });
    document.getElementById('closeColModal').addEventListener('click', () => colModal.classList.add('hidden'));
    
    document.getElementById('addColForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('colName').value;
        const type = document.getElementById('colType').value;
        const newColId = 'col_' + generateId();
        const widthVal = document.getElementById('colWidth') ? parseInt(document.getElementById('colWidth').value) : 20;
        const defaultHAlign = type === 'image' ? 'center' : 'left';
        const defaultVAlign = type === 'image' ? 'middle' : 'top';
        state.columns.push({ id: newColId, name, type, width: widthVal || 20, hAlign: defaultHAlign, vAlign: defaultVAlign });
        // 기존 행 데이터에 새 열 필드 추가
        state.rows.forEach(row => { row[newColId] = type === 'image' ? [] : ''; });
        
        colModal.classList.add('hidden');
        renderColumnSettings();
        renderForm(); // 폼 갱신
    });

    // 행 추가
    document.getElementById('addRowBtn').addEventListener('click', () => {
        state.rows.push(createEmptyRow());
        renderForm();
    });
}

function createEmptyRow() {
    const row = { id: 'row_' + generateId() };
    state.columns.forEach(col => {
        row[col.id] = col.type === 'image' ? [] : '';
    });
    return row;
}

// API: 로드
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
                    <button class="btn-back btn-sm" onclick="deleteReport('${item.id}', event)">삭제</button>
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

// API: 새 보고서
function createNewReport() {
    state.currentDocId = null;
    state.columns = [
        { id: 'col_no', name: 'No.', type: 'text' },
        { id: 'col_sample', name: '현재 샘플', type: 'image' },
        { id: 'col_example', name: '예시', type: 'image' },
        { id: 'col_request', name: '요청사항', type: 'text' }
    ];
    state.rows = [createEmptyRow()];
    
    reportTitleInput.value = '';
    listView.classList.add('hidden');
    editorView.classList.remove('hidden');
    
    renderColumnSettings();
    renderForm();
}

// API: 열기
async function openReport(id) {
    showLoading(true);
    try {
        const res = await authFetch(`${API_BASE}/${id}`);
        if (!res.ok) throw new Error('보고서 로드 실패');
        const doc = await res.json();
        
        state.currentDocId = doc.id;
        reportTitleInput.value = doc.title;
        
        const content = JSON.parse(doc.content_json);
        state.columns = content.columns || [];
        state.rows = content.rows || [];
        
        listView.classList.add('hidden');
        editorView.classList.remove('hidden');
        
        renderColumnSettings();
        renderForm();
    } catch (err) {
        alert('보고서를 불러올 수 없습니다.');
    } finally {
        showLoading(false);
    }
}

// API: 저장
async function saveReport() {
    showLoading(true);
    const payload = {
        title: reportTitleInput.value || '제목 없는 보고서',
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
        if (data.id) state.currentDocId = data.id;
        alert('저장되었습니다.');
    } catch (err) {
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

// API: 삭제
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

// -----------------------------------------
// UI: 항목(열) 설정 렌더링
// -----------------------------------------
function renderColumnSettings() {
    columnSettingList.innerHTML = '';
    state.columns.forEach((col, index) => {
        const li = document.createElement('li');
        li.className = 'column-item';
        li.setAttribute('data-col-id', col.id);
        
        const typeLabel = col.type === 'text' ? '텍스트' : '사진';
        // 너비 속성이 없으면 기본값(예: 20) 부여
        const colWidth = col.width || 20;
        const hAlign = col.hAlign || (col.type === 'image' ? 'center' : 'left');
        const vAlign = col.vAlign || (col.type === 'image' ? 'middle' : 'top');
        
        li.innerHTML = `
            <div class="col-info" style="flex:1;">
                <strong>${col.name}</strong>
                <span class="col-badge">${typeLabel}</span>
            </div>
            <div class="col-width-control" style="display:flex; align-items:center; gap:4px; margin-right:12px;">
                <select class="form-input align-select hAlign-select" oninput="calculateDraftSum()" style="padding:4px; font-size:12px; width:70px;">
                    <option value="left" ${hAlign === 'left' ? 'selected' : ''}>가로:좌</option>
                    <option value="center" ${hAlign === 'center' ? 'selected' : ''}>가로:중</option>
                    <option value="right" ${hAlign === 'right' ? 'selected' : ''}>가로:우</option>
                </select>
                <select class="form-input align-select vAlign-select" oninput="calculateDraftSum()" style="padding:4px; font-size:12px; width:70px;">
                    <option value="top" ${vAlign === 'top' ? 'selected' : ''}>세로:상</option>
                    <option value="middle" ${vAlign === 'middle' ? 'selected' : ''}>세로:중</option>
                    <option value="bottom" ${vAlign === 'bottom' ? 'selected' : ''}>세로:하</option>
                </select>
                <input type="number" min="1" max="100" class="form-input col-width-input" value="${colWidth}" oninput="calculateDraftSum()" style="width:60px; text-align:center;"> %
            </div>
            <button class="btn-delete-col" onclick="deleteCol('${col.id}')"><i class='bx bx-trash'></i></button>
        `;
        columnSettingList.appendChild(li);
    });
    
    // 초기 렌더링 시 합계 계산
    calculateDraftSum();
}

window.calculateDraftSum = function() {
    const widthInputs = document.querySelectorAll('.col-width-input');
    let totalWidth = 0;
    widthInputs.forEach(input => {
        totalWidth += parseInt(input.value) || 0;
    });
    
    const widthSumEl = document.getElementById('widthSum');
    const applyBtn = document.getElementById('applyColBtn');
    
    if (widthSumEl) {
        widthSumEl.innerHTML = `현재 총 너비 합계: <strong>${totalWidth}%</strong> / 100%`;
        if (totalWidth > 100) {
            widthSumEl.className = 'width-summary warning';
            widthSumEl.innerHTML += ` <span><i class='bx bx-error'></i> 합계가 100%를 초과하여 표가 잘릴 수 있습니다!</span>`;
        } else {
            widthSumEl.className = 'width-summary';
        }
    }
    
    if (applyBtn) {
        // 입력이 변하면 버튼 색상을 조금 강조
        applyBtn.style.backgroundColor = '#4F46E5';
        applyBtn.innerHTML = "<i class='bx bx-edit-alt'></i> 설정 반영하기 (변경됨)";
    }
};

window.applyColumnSettings = function() {
    const items = document.querySelectorAll('.column-item');
    items.forEach(item => {
        const colId = item.getAttribute('data-col-id');
        const hAlignVal = item.querySelector('.hAlign-select').value;
        const vAlignVal = item.querySelector('.vAlign-select').value;
        const widthVal = item.querySelector('.col-width-input').value;
        
        const col = state.columns.find(c => c.id === colId);
        if (col) {
            col.hAlign = hAlignVal;
            col.vAlign = vAlignVal;
            col.width = parseInt(widthVal) || 0;
        }
    });
    
    const applyBtn = document.getElementById('applyColBtn');
    if (applyBtn) {
        applyBtn.style.backgroundColor = '#10B981'; // Green success
        applyBtn.innerHTML = "<i class='bx bx-check-double'></i> 적용 완료!";
        setTimeout(() => {
            applyBtn.style.backgroundColor = '';
            applyBtn.innerHTML = "<i class='bx bx-check'></i> 설정 반영하기";
        }, 2000);
    }
    
    // 반영 후 폼은 다시 렌더링 할 필요가 크게 없으나, 필요시 renderForm() 호출 가능.
};
window.deleteCol = function(colId) {
    if(!confirm('이 항목을 삭제하시겠습니까? 데이터도 함께 지워집니다.')) return;
    state.columns = state.columns.filter(c => c.id !== colId);
    state.rows.forEach(r => delete r[colId]);
    renderColumnSettings();
    renderForm();
};

// -----------------------------------------
// UI: 웹 폼(Form) 에디터 렌더링
// -----------------------------------------
function renderForm() {
    formDataContainer.innerHTML = '';
    state.rows.forEach((row, rowIndex) => {
        const card = document.createElement('div');
        card.className = 'data-row-card';
        
        // 헤더 및 삭제 버튼
        card.innerHTML = `
            <div class="data-row-header">
                [항목 ${rowIndex + 1}]
                ${rowIndex > 0 ? `<button class="row-delete-btn" onclick="deleteRow('${row.id}')">삭제</button>` : ''}
            </div>
        `;
        
        // 폼 내용물
        state.columns.forEach(col => {
            const fg = document.createElement('div');
            fg.className = 'form-group';
            fg.innerHTML = `<label>${col.name}</label>`;
            
            if (col.type === 'text') {
                const ta = document.createElement('textarea');
                ta.className = 'form-input';
                ta.placeholder = `${col.name} 입력...`;
                ta.rows = 2;
                ta.value = row[col.id] || '';
                ta.oninput = (e) => {
                    row[col.id] = e.target.value; // 상태 실시간 갱신
                    e.target.style.height = 'auto';
                    e.target.style.height = (e.target.scrollHeight) + 'px';
                };
                fg.appendChild(ta);
            } else if (col.type === 'image') {
                const wrap = document.createElement('div');
                wrap.className = 'image-upload-wrapper';
                
                // 미리보기 그리드
                const gridDiv = document.createElement('div');
                gridDiv.className = 'image-grid';
                const images = row[col.id] || [];
                images.forEach((imgUrl, imgIndex) => {
                    const img = document.createElement('img');
                    img.src = getImgSrc(imgUrl);
                    img.title = "클릭하여 삭제";
                    img.onclick = async () => {
                        if(confirm('이 사진을 지우시겠습니까?')) {
                            const urlToDelete = row[col.id][imgIndex];
                            row[col.id].splice(imgIndex, 1);
                            renderForm();
                            
                            // 서버에 실제 파일 삭제 요청
                            try {
                                await authFetch(`${API_BASE}/file`, {
                                    method: 'DELETE',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ url: urlToDelete })
                                });
                            } catch(e) { console.error('파일 삭제 실패', e); }
                        }
                    };
                    gridDiv.appendChild(img);
                });
                wrap.appendChild(gridDiv);
                
                // 드롭존 (복붙/드래그)
                const dz = document.createElement('div');
                dz.className = 'image-dropzone';
                dz.innerHTML = `<i class='bx bx-image-add'></i>클릭 후 <b>Ctrl+V</b>로 붙여넣기 또는 사진 드래그`;
                dz.tabIndex = 0;
                setupImageUploadEvents(dz, row, col.id);
                
                wrap.appendChild(dz);
                fg.appendChild(wrap);
            }
            card.appendChild(fg);
        });
        formDataContainer.appendChild(card);
    });
}
window.deleteRow = function(rowId) {
    state.rows = state.rows.filter(r => r.id !== rowId);
    renderForm();
};

// -----------------------------------------
// UI: 인쇄 미리보기 (표 생성)
// -----------------------------------------
function openPrintPreview() {
    // 1. 레이아웃 전환
    editorView.classList.add('hidden');
    printLayout.style.display = 'flex';
    
    // 2. 제목/날짜
    displayTitle.textContent = reportTitleInput.value || '제목 없는 보고서';
    displayDate.textContent = state.currentDocId ? new Date().toLocaleDateString() : getTodayFormat(); // 임시 날짜
    
    // 3. 표 헤더 조립
    let headHtml = '<tr>';
    state.columns.forEach(col => {
        // 기존 nowrap 로직은 유지하되, width 비율 추가 적용
        const isShort = col.name.toLowerCase().includes('no') || col.name.includes('번호') || col.name.includes('날짜');
        const widthAttr = col.width ? `width="${col.width}%"` : '';
        headHtml += `<th class="${isShort ? 'nowrap' : ''}" ${widthAttr}>${col.name}</th>`;
    });
    headHtml += '</tr>';
    tableHead.innerHTML = headHtml;
    
    // 4. 표 본문 조립
    let bodyHtml = '';
    state.rows.forEach(row => {
        bodyHtml += '<tr>';
        state.columns.forEach(col => {
            const hAlign = col.hAlign || (col.type === 'image' ? 'center' : 'left');
            const vAlign = col.vAlign || (col.type === 'image' ? 'middle' : 'top');
            const styleAttr = `style="text-align: ${hAlign}; vertical-align: ${vAlign};"`;
            
            if (col.type === 'text') {
                // 텍스트 출력 (줄바꿈 처리)
                const textStr = (row[col.id] || '').replace(/\n/g, '<br>');
                bodyHtml += `<td ${styleAttr}>${textStr}</td>`;
            } else if (col.type === 'image') {
                // 이미지 그리드 출력 (flex 정렬 적용)
                const images = row[col.id] || [];
                const justifyVal = hAlign === 'left' ? 'flex-start' : (hAlign === 'right' ? 'flex-end' : 'center');
                let imgHtml = `<div class="print-image-grid" style="justify-content: ${justifyVal};">`;
                images.forEach(imgUrl => {
                    imgHtml += `<img src="${getImgSrc(imgUrl)}">`;
                });
                imgHtml += '</div>';
                bodyHtml += `<td ${styleAttr}>${imgHtml}</td>`;
            }
        });
        bodyHtml += '</tr>';
    });
    tableBody.innerHTML = bodyHtml;
}

// -----------------------------------------
// 이미지 업로드 공통 이벤트 (Drop, Paste)
// -----------------------------------------
function setupImageUploadEvents(element, rowObj, colId) {
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
            Array.from(e.dataTransfer.files).forEach(f => uploadImage(f, rowObj, colId));
        }
    });
    element.addEventListener('paste', async (e) => {
        e.preventDefault();
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    uploadImage(blob, rowObj, colId);
                }
            }
        }
    });
    element.addEventListener('click', () => element.focus());
}

// 이미지 압축 유틸리티
function compressImage(file) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/')) return resolve(file);
        
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_SIZE = 1920;
            
            if (width > height && width > MAX_SIZE) {
                height = Math.round((height * MAX_SIZE) / width);
                width = MAX_SIZE;
            } else if (height >= width && height > MAX_SIZE) {
                width = Math.round((width * MAX_SIZE) / height);
                height = MAX_SIZE;
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
                if (!blob) return resolve(file);
                let originalName = file.name || 'pasted-image.png';
                originalName = originalName.replace(/\.[^/.]+$/, "") + ".jpg";
                const compressedFile = new File([blob], originalName, { type: 'image/jpeg' });
                resolve(compressedFile);
            }, 'image/jpeg', 0.8);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };
        img.src = objectUrl;
    });
}

async function uploadImage(file, rowObj, colId) {
    showLoading(true);
    
    try {
        const compressedFile = await compressImage(file);
        const formData = new FormData();
        formData.append('image', compressedFile, compressedFile.name);
        
        const res = await authFetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`업로드 실패 (${res.status}): ${errText}`);
        }
        const data = await res.json();
        
        if (!rowObj[colId]) rowObj[colId] = [];
        rowObj[colId].push(data.url);
        renderForm(); // 폼 갱신 (이미지 미리보기 보임)
    } catch (err) {
        console.error(err);
        alert(`이미지 업로드에 실패했습니다.\n상세: ${err.message}`);
    } finally {
        showLoading(false);
    }
}

// 실행
init();
