// API Base Configuration
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8788/api/work-logs'
    : 'https://kng.junparks.com/api/work-logs';

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    
    if (!options.headers) options.headers = {};
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

// Global State
let currentLogs = [];
let currentEditingId = null;

// DOM Elements
const listView = document.getElementById('listView');
const editView = document.getElementById('editView');
const logList = document.getElementById('logList');
const btnNewLog = document.getElementById('btnNewLog');
const btnBack = document.getElementById('btnBack');
const btnSave = document.getElementById('btnSave');
const btnSaveDraft = document.getElementById('btnSaveDraft');
const btnDelete = document.getElementById('btnDelete');

// Filter Elements
const searchInput = document.getElementById('searchInput');
const filterStartDate = document.getElementById('filterStartDate');
const filterEndDate = document.getElementById('filterEndDate');
const filterLogType = document.getElementById('filterLogType');
const filterCategory = document.getElementById('filterCategory');
const filterDraft = document.getElementById('filterDraft');

// Form Elements
const inputDate = document.getElementById('inputDate');
const inputAuthorName = document.getElementById('inputAuthorName');
const inputLogType = document.getElementById('inputLogType');
const inputCategory = document.getElementById('inputCategory');

// Initialize TinyMCE
function initEditors() {
    tinymce.init({
        selector: '#editorToday, #editorNext',
        height: 400,
        menubar: false,
        plugins: 'lists link image table code help wordcount autoresize',
        toolbar: 'undo redo | blocks | bold italic strikethrough forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | image table | removeformat',
        
        // Image Upload Configuration
        images_upload_handler: async function (blobInfo, progress) {
            return new Promise(async (resolve, reject) => {
                try {
                    const formData = new FormData();
                    formData.append('file', blobInfo.blob(), blobInfo.filename());
                    
                    const response = await authFetch(`${API_BASE}/upload-image`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (!response.ok) {
                        throw new Error('HTTP Error: ' + response.status);
                    }
                    
                    const result = await response.json();
                    if (result && result.location) {
                        resolve(result.location);
                    } else {
                        reject('Invalid JSON response from server.');
                    }
                } catch (error) {
                    reject('Image upload failed: ' + error.message);
                }
            });
        },
        
        // Allowed resize (Object Resizing is enabled by default in TinyMCE for images)
        object_resizing: true,
        
        // Paste configuration to keep sticky notes format mostly intact
        paste_data_images: true, // Allow pasting images directly
        paste_as_text: false,
        smart_paste: true
    });
}

// ----------------------------------------------------
// Routing & View Management (History API)
// ----------------------------------------------------
function handleRoute(pushState = true) {
    const hash = window.location.hash;
    
    if (hash === '#new') {
        showEditor(null, pushState);
    } else if (hash.startsWith('#edit=')) {
        const id = hash.replace('#edit=', '');
        showEditor(id, pushState);
    } else {
        showList(pushState);
    }
}

window.addEventListener('popstate', () => {
    handleRoute(false);
});

function showList(pushState = true) {
    if (pushState) history.pushState(null, '', window.location.pathname);
    editView.classList.remove('active');
    listView.classList.add('active');
    loadLogs();
}

async function showEditor(id = null, pushState = true) {
    if (pushState) history.pushState(null, '', id ? `#edit=${id}` : '#new');
    
    listView.classList.remove('active');
    editView.classList.add('active');
    
    currentEditingId = id;
    
    if (id) {
        // Load existing
        btnDelete.style.display = 'block';
        try {
            const res = await authFetch(`${API_BASE}/${id}`);
            if (res.ok) {
                const log = await res.json();
                inputDate.value = log.date || '';
                inputAuthorName.value = log.authorName || '';
                inputLogType.value = log.logType || '일일';
                inputCategory.value = log.category || '업무';
                
                tinymce.get('editorToday').setContent(log.todayTasks || '');
                tinymce.get('editorNext').setContent(log.nextTasks || '');
            } else {
                alert('업무일지를 불러오는데 실패했습니다.');
                showList(true);
            }
        } catch (e) {
            console.error(e);
            alert('오류가 발생했습니다.');
        }
    } else {
        // New
        btnDelete.style.display = 'none';
        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
        inputDate.value = today;
        inputAuthorName.value = ''; // Should ideally fetch from auth profile
        inputLogType.value = '일일';
        inputCategory.value = '업무';
        
        tinymce.get('editorToday').setContent('');
        tinymce.get('editorNext').setContent('');
    }
}

// ----------------------------------------------------
// Data Operations
// ----------------------------------------------------
async function loadLogs() {
    try {
        const res = await authFetch(`${API_BASE}`);
        if (!res.ok) throw new Error('Failed to load logs');
        currentLogs = await res.json();
        renderList();
    } catch (e) {
        console.error(e);
        logList.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--danger-color);">데이터를 불러오지 못했습니다: ${e.message}</div>`;
    }
}

function renderList() {
    // Apply filters
    let filtered = currentLogs;
    
    const sTerm = searchInput.value.trim().toLowerCase();
    const sDate = filterStartDate.value;
    const eDate = filterEndDate.value;
    const lType = filterLogType.value;
    const cat = filterCategory.value;
    const isDraft = filterDraft.checked;

    if (sTerm) {
        filtered = filtered.filter(l => 
            (l.authorName && l.authorName.toLowerCase().includes(sTerm)) ||
            (l.todayTasks && l.todayTasks.toLowerCase().includes(sTerm)) ||
            (l.nextTasks && l.nextTasks.toLowerCase().includes(sTerm))
        );
    }
    if (sDate) filtered = filtered.filter(l => l.date >= sDate);
    if (eDate) filtered = filtered.filter(l => l.date <= eDate);
    if (lType) filtered = filtered.filter(l => l.logType === lType);
    if (cat) filtered = filtered.filter(l => l.category === cat);
    if (isDraft) filtered = filtered.filter(l => l.isDraft === 1);

    logList.innerHTML = '';
    
    if (filtered.length === 0) {
        logList.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--text-muted);">조건에 맞는 업무일지가 없습니다.</div>`;
        return;
    }

    filtered.forEach(log => {
        const card = document.createElement('div');
        card.className = 'log-card';
        card.onclick = () => showEditor(log.id, true);
        
        const isDraftBadge = log.isDraft ? `<span class="meta-badge meta-draft">임시저장</span>` : '';
        
        card.innerHTML = `
            <div class="log-card-header">
                <div class="log-meta">
                    ${isDraftBadge}
                    <span class="meta-badge">[${log.logType || '분류없음'}] ${log.category || ''}</span>
                    <span class="meta-date">${log.date}</span>
                    <span class="meta-author"><i class="fa-solid fa-user"></i> ${log.authorName}</span>
                </div>
                <div class="log-meta" style="color: var(--text-muted); font-size: 12px;">
                    작성: ${new Date(log.createdAt).toLocaleString()}
                </div>
            </div>
            <div class="log-card-body">
                <div class="log-section">
                    <h3 class="today"><i class="fa-solid fa-sun"></i> 금일사항</h3>
                    <div class="log-content">${log.todayTasks || '-'}</div>
                </div>
                <div class="log-section">
                    <h3 class="next"><i class="fa-solid fa-moon"></i> 차일사항</h3>
                    <div class="log-content">${log.nextTasks || '-'}</div>
                </div>
            </div>
        `;
        logList.appendChild(card);
    });
}

async function saveLog(isDraft) {
    // Validate
    if (!inputDate.value || !inputAuthorName.value) {
        alert('작성일, 작성자는 필수 입력 항목입니다.');
        return;
    }

    const payload = {
        date: inputDate.value,
        department: '',
        company: '',
        authorName: inputAuthorName.value,
        logType: inputLogType.value,
        category: inputCategory.value,
        isDraft: isDraft,
        todayTasks: tinymce.get('editorToday').getContent(),
        nextTasks: tinymce.get('editorNext').getContent()
    };

    try {
        let url = API_BASE;
        let method = 'POST';
        
        if (currentEditingId) {
            url = `${API_BASE}/${currentEditingId}`;
            method = 'PUT';
        }
        
        const res = await authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (res.ok) {
            alert(isDraft ? '임시저장 되었습니다.' : '저장 되었습니다.');
            showList(true);
        } else {
            const data = await res.json();
            alert('저장 실패: ' + (data.error || '알 수 없는 오류'));
        }
    } catch(e) {
        console.error(e);
        alert('저장 중 통신 오류가 발생했습니다.');
    }
}

async function deleteLog() {
    if (!currentEditingId) return;
    if (!confirm('정말로 이 업무일지를 삭제하시겠습니까?')) return;
    
    try {
        const res = await authFetch(`${API_BASE}/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [currentEditingId] })
        });
        
        if (res.ok) {
            alert('삭제되었습니다.');
            showList(true);
        } else {
            alert('삭제 실패했습니다.');
        }
    } catch(e) {
        console.error(e);
        alert('오류가 발생했습니다.');
    }
}

// ----------------------------------------------------
// Event Listeners
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    initEditors();
    
    // Check initial route after a short delay to let TinyMCE init
    setTimeout(() => {
        handleRoute(false);
    }, 100);
});

btnNewLog.addEventListener('click', () => showEditor(null, true));
btnBack.addEventListener('click', () => {
    // Check if dirty could go here
    showList(true);
});

btnSave.addEventListener('click', () => saveLog(false));
btnSaveDraft.addEventListener('click', () => saveLog(true));
btnDelete.addEventListener('click', deleteLog);

// Filter Events
const filterInputs = [searchInput, filterStartDate, filterEndDate, filterLogType, filterCategory, filterDraft];
filterInputs.forEach(input => {
    input.addEventListener('input', renderList);
    input.addEventListener('change', renderList);
});
