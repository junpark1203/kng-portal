// report.js

// --- authFetch: JWT 토큰을 자동으로 실어 보내는 fetch 래퍼 ---
async function authFetch(url, options = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

const API_URL = 'https://kng.junparks.com/api/exhibition-report';
let currentReports = [];
let editingId = null;

// DOM Elements
const listView = document.getElementById('listView');
const editView = document.getElementById('editView');
const printLayout = document.getElementById('printLayout');

const reportListBody = document.getElementById('reportListBody');
const boothsContainer = document.getElementById('boothsContainer');
const boothFormTemplate = document.getElementById('boothFormTemplate');

const form = document.getElementById('reportForm');
const exhibitionName = document.getElementById('exhibitionName');
const visitDate = document.getElementById('visitDate');

document.addEventListener('DOMContentLoaded', () => {
    loadReports();

    // Event Listeners
    document.getElementById('btnNewReport').addEventListener('click', showNewForm);
    document.getElementById('btnBackToList').addEventListener('click', () => switchView('list'));
    document.getElementById('btnSaveReport').addEventListener('click', saveReport);
    document.getElementById('btnAddBooth').addEventListener('click', () => addBoothForm());
    document.getElementById('btnDeleteSelected').addEventListener('click', deleteSelected);
    document.getElementById('selectAll').addEventListener('change', (e) => {
        const checks = document.querySelectorAll('.check-row');
        checks.forEach(c => c.checked = e.target.checked);
    });

    document.getElementById('btnPrintPreview').addEventListener('click', showPrintPreview);
    document.getElementById('btnClosePrint').addEventListener('click', () => {
        printLayout.style.display = 'none';
        document.body.style.overflow = '';
    });
});

function switchView(view) {
    listView.classList.remove('active');
    editView.classList.remove('active');
    
    if (view === 'list') {
        listView.classList.add('active');
        loadReports();
    } else if (view === 'edit') {
        editView.classList.add('active');
    }
}

async function loadReports() {
    try {
        reportListBody.innerHTML = '<tr class="loading-row"><td colspan="6"><div class="skeleton"></div></td></tr>';
        const res = await authFetch(API_URL);
        if (!res.ok) throw new Error('목록을 불러오지 못했습니다.');
        
        currentReports = await res.json();
        renderList();
    } catch (e) {
        showToast(e.message, 'error');
        reportListBody.innerHTML = '<tr><td colspan="6" class="text-center">데이터를 불러오지 못했습니다.</td></tr>';
    }
}

function renderList() {
    reportListBody.innerHTML = '';
    if (currentReports.length === 0) {
        reportListBody.innerHTML = '<tr><td colspan="6" class="text-center">등록된 보고서가 없습니다.</td></tr>';
        return;
    }

    currentReports.forEach(report => {
        const tr = document.createElement('tr');
        const d = new Date(report.createdAt);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="check-row" value="${report.id}"></td>
            <td>${report.visitDate || '-'}</td>
            <td><strong>${report.exhibitionName || '-'}</strong></td>
            <td>${(report.booths || []).length} 개</td>
            <td>${dateStr}</td>
            <td class="col-action">
                <button class="btn-outline btn-sm" onclick="editReport('${report.id}')">수정</button>
            </td>
        `;
        reportListBody.appendChild(tr);
    });
}

function showNewForm() {
    editingId = null;
    document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 새 보고서 작성";
    form.reset();
    boothsContainer.innerHTML = '';
    addBoothForm(); // 기본 1개 폼 추가
    switchView('edit');
}

async function editReport(id) {
    try {
        const res = await authFetch(`${API_URL}/${id}`);
        if (!res.ok) throw new Error('데이터를 불러오지 못했습니다.');
        const report = await res.json();
        
        editingId = report.id;
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 보고서 수정";
        
        exhibitionName.value = report.exhibitionName;
        visitDate.value = report.visitDate;
        
        boothsContainer.innerHTML = '';
        if (report.booths && report.booths.length > 0) {
            report.booths.forEach(booth => addBoothForm(booth));
        } else {
            addBoothForm();
        }
        
        switchView('edit');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

function addBoothForm(data = null) {
    const clone = boothFormTemplate.content.cloneNode(true);
    const card = clone.querySelector('.booth-card');
    
    // 인덱스 부여
    const idx = boothsContainer.children.length + 1;
    card.querySelector('.booth-index').innerText = idx;
    
    // 삭제 버튼
    card.querySelector('.btn-remove-booth').addEventListener('click', (e) => {
        card.remove();
        updateBoothIndices();
    });

    // 사진 파일 선택 이벤트
    const fileInput = card.querySelector('.input-photos');
    const previewContainer = card.querySelector('.photo-preview-container');
    const urlsInput = card.querySelector('.input-uploaded-urls');
    
    let uploadedUrls = [];

    // 데이터가 있는 경우 바인딩
    if (data) {
        card.querySelector('.input-boothName').value = data.boothName || '';
        card.querySelector('.input-location').value = data.location || '';
        card.querySelector('.input-mainProducts').value = data.mainProducts || '';
        card.querySelector('.input-applicability').value = data.applicability || '';
        card.querySelector('.input-counselingContent').value = data.counselingContent || '';
        card.querySelector('.input-remarks').value = data.remarks || '';
        
        if (data.photos && data.photos.length > 0) {
            uploadedUrls = [...data.photos];
            urlsInput.value = JSON.stringify(uploadedUrls);
            renderThumbnails();
        }
    }
    
    // 사진 업로드 로직
    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;
        
        if (uploadedUrls.length + files.length > 5) {
            showToast('사진은 한 업체당 최대 5장까지만 업로드 가능합니다.', 'error');
            fileInput.value = '';
            return;
        }

        const formData = new FormData();
        files.forEach(f => formData.append('photos', f));
        
        try {
            // Upload endpoint might not need auth if we allow public upload, but authFetch is safer if it's protected.
            // Wait, server.js has `app.use('/api/', verifyToken);` so upload needs it too.
            // However, FormData means we shouldn't set Content-Type header. authFetch only adds Authorization.
            const res = await authFetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (res.ok) {
                uploadedUrls = uploadedUrls.concat(result.urls);
                urlsInput.value = JSON.stringify(uploadedUrls);
                renderThumbnails();
            } else {
                showToast(result.error, 'error');
            }
        } catch (err) {
            showToast('파일 업로드 실패', 'error');
        }
        fileInput.value = ''; // 초기화
    });

    function renderThumbnails() {
        previewContainer.innerHTML = '';
        uploadedUrls.forEach((url, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'photo-thumbnail-wrap';
            wrap.innerHTML = `
                <img src="${url}" class="photo-thumbnail">
                <button type="button" class="btn-remove-photo" data-idx="${i}"><i class='bx bx-x'></i></button>
            `;
            previewContainer.appendChild(wrap);
            
            wrap.querySelector('.btn-remove-photo').addEventListener('click', () => {
                uploadedUrls.splice(i, 1);
                urlsInput.value = JSON.stringify(uploadedUrls);
                renderThumbnails();
            });
        });
    }

    boothsContainer.appendChild(card);
}

function updateBoothIndices() {
    const cards = boothsContainer.querySelectorAll('.booth-card');
    cards.forEach((card, idx) => {
        card.querySelector('.booth-index').innerText = idx + 1;
    });
}

async function saveReport() {
    if (!form.reportValidity()) return;
    
    const booths = [];
    const cards = boothsContainer.querySelectorAll('.booth-card');
    
    cards.forEach(card => {
        let urls = [];
        try { urls = JSON.parse(card.querySelector('.input-uploaded-urls').value || '[]'); } catch(e){}
        
        booths.push({
            boothName: card.querySelector('.input-boothName').value,
            location: card.querySelector('.input-location').value,
            mainProducts: card.querySelector('.input-mainProducts').value,
            photos: urls,
            applicability: card.querySelector('.input-applicability').value,
            counselingContent: card.querySelector('.input-counselingContent').value,
            remarks: card.querySelector('.input-remarks').value
        });
    });
    
    const payload = {
        exhibitionName: exhibitionName.value,
        visitDate: visitDate.value,
        booths: booths
    };
    
    const method = editingId ? 'PUT' : 'POST';
    const url = editingId ? `${API_URL}/${editingId}` : API_URL;
    
    try {
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('저장에 실패했습니다.');
        showToast('보고서가 저장되었습니다.', 'success');
        switchView('list');
    } catch(e) {
        showToast(e.message, 'error');
    }
}

async function deleteSelected() {
    const checks = document.querySelectorAll('.check-row:checked');
    if (checks.length === 0) {
        showToast('삭제할 항목을 선택해주세요.', 'warning');
        return;
    }
    
    if (!confirm(`선택한 ${checks.length}개의 보고서를 삭제하시겠습니까?`)) return;
    
    const ids = Array.from(checks).map(c => c.value);
    try {
        const res = await authFetch(`${API_URL}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
        
        if (res.ok) {
            showToast('삭제되었습니다.', 'success');
            loadReports();
            document.getElementById('selectAll').checked = false;
        } else {
            const data = await res.json();
            showToast(data.error || '삭제 실패', 'error');
        }
    } catch(e) {
        showToast('오류가 발생했습니다.', 'error');
    }
}

// 인쇄 미리보기 렌더링
function showPrintPreview() {
    const page = document.getElementById('printPage');
    page.innerHTML = '';
    
    // 헤더 (전시회명, 방문일자)
    const titleHtml = `
        <div class="doc-title">전시회 참관 보고서</div>
        <div class="doc-info">
            <div class="doc-info-item"><strong>전시회명:</strong> ${exhibitionName.value || '-'}</div>
            <div class="doc-info-item"><strong>방문일자:</strong> ${visitDate.value || '-'}</div>
        </div>
    `;
    page.insertAdjacentHTML('beforeend', titleHtml);
    
    const cards = boothsContainer.querySelectorAll('.booth-card');
    
    cards.forEach((card, idx) => {
        let urls = [];
        try { urls = JSON.parse(card.querySelector('.input-uploaded-urls').value || '[]'); } catch(e){}
        
        let photosHtml = '';
        if (urls.length > 0) {
            photosHtml = `<div class="doc-photos">` + urls.map(url => `<img src="${url}" class="doc-photo-item">`).join('') + `</div>`;
        }
        
        const boothHtml = `
            <div class="booth-print-section">
                <table class="doc-table">
                    <tr>
                        <th>업체명</th>
                        <td style="width: 35%; font-weight: 600;">${card.querySelector('.input-boothName').value || '-'}</td>
                        <th>부스위치</th>
                        <td>${card.querySelector('.input-location').value || '-'}</td>
                    </tr>
                    <tr>
                        <th>취급상품</th>
                        <td colspan="3">${card.querySelector('.input-mainProducts').value || '-'}</td>
                    </tr>
                    ${photosHtml ? `
                    <tr>
                        <th>관련 사진</th>
                        <td colspan="3">${photosHtml}</td>
                    </tr>` : ''}
                    <tr>
                        <th>적용가능성</th>
                        <td colspan="3">${card.querySelector('.input-applicability').value || '-'}</td>
                    </tr>
                    <tr>
                        <th>상담내용</th>
                        <td colspan="3">${card.querySelector('.input-counselingContent').value.replace(/\n/g, '<br>') || '-'}</td>
                    </tr>
                    <tr>
                        <th>비고</th>
                        <td colspan="3">${card.querySelector('.input-remarks').value || '-'}</td>
                    </tr>
                </table>
            </div>
        `;
        page.insertAdjacentHTML('beforeend', boothHtml);
    });
    
    printLayout.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function showToast(msg, type='info') {
    const tc = document.getElementById('toastContainer');
    if(!tc) return alert(msg);
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerText = msg;
    tc.appendChild(t);
    setTimeout(()=> t.remove(), 3000);
}

window.editReport = editReport; // 전역 노출
