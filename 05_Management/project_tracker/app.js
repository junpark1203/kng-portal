const DOMAIN_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8788'
    : 'https://kng.junparks.com';

const API_BASE = `${DOMAIN_BASE}/api/projects`;

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) {
                await new Promise(r => setTimeout(r, 500));
                token = await window.parent.getAuthToken();
                retries++;
            }
        }
    } catch(e) {}
    
    if (!options.headers) options.headers = {};
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

let projects = [];
let currentProjectId = null;
let currentLogs = [];
let selectedFiles = [];

// DOM Elements
const projectsListEl = document.getElementById('projectsList');
const emptyStateEl = document.getElementById('emptyState');
const projectViewEl = document.getElementById('projectView');
const timelineContainer = document.getElementById('timelineContainer');
const filterStatus = document.getElementById('filterStatus');
const filterCategory = document.getElementById('filterCategory');

const projectSearch = document.getElementById('projectSearch');
const logSearchContainer = document.getElementById('logSearchContainer');
const logSearch = document.getElementById('logSearch');

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function highlightText(text, keyword) {
    if (!text) return '';
    const escapedText = escapeHtml(text);
    if (!keyword || !keyword.trim()) return escapedText;
    
    const escapedKeyword = escapeHtml(keyword.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedKeyword})`, 'gi');
    return escapedText.replace(regex, '<mark class="highlight">$1</mark>');
}

const headerTitle = document.getElementById('headerTitle');
const headerCategory = document.getElementById('headerCategory');
const headerManager = document.getElementById('headerManager');
const headerStatus = document.getElementById('headerStatus');

const logForm = document.getElementById('logForm');
const logInput = document.getElementById('logInput');
const logTypeSelect = document.getElementById('logTypeSelect');
const logDateInput = document.getElementById('logDateInput');
const fileInput = document.getElementById('fileInput');
const inputAttachments = document.getElementById('inputAttachments');
const btnAttach = document.getElementById('btnAttach');

const projectModal = document.getElementById('projectModal');
const projectForm = document.getElementById('projectForm');
const btnNewProject = document.getElementById('btnNewProject');
const btnSaveProject = document.getElementById('btnSaveProject');
const btnDeleteProject = document.getElementById('btnDeleteProject');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadProjects();
    bindEvents();
});

// Generate simple UUID
function generateId() {
    return 'PRJ-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}
function generateLogId() {
    return 'LOG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
}

// Fetch Projects
async function loadProjects() {
    try {
        const res = await authFetch(API_BASE);
        const data = await res.json();
        if (data.success) {
            projects = data.data;
            renderProjectsList();
            if (currentProjectId) {
                const stillExists = projects.find(p => p.id === currentProjectId);
                if (stillExists) {
                    renderProjectView(currentProjectId);
                } else {
                    currentProjectId = null;
                    showEmptyState();
                }
            } else {
                showEmptyState();
            }
        }
    } catch (e) {
        console.error("Failed to load projects", e);
        Swal.fire('오류', '프로젝트 목록을 불러오지 못했습니다.', 'error');
    }
}

// Render Sidebar List
function renderProjectsList() {
    const sStatus = filterStatus.value;
    const sCat = filterCategory.value;

    let filtered = projects;
    if (sStatus) filtered = filtered.filter(p => p.status === sStatus);
    if (sCat) filtered = filtered.filter(p => p.category === sCat);

    const searchKeyword = projectSearch ? projectSearch.value.trim().toLowerCase() : '';
    if (searchKeyword) {
        filtered = filtered.filter(p => 
            (p.title && p.title.toLowerCase().includes(searchKeyword)) || 
            (p.manager && p.manager.toLowerCase().includes(searchKeyword))
        );
    }

    projectsListEl.innerHTML = '';
    
    if (filtered.length === 0) {
        projectsListEl.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:13px;">프로젝트가 없습니다.</div>';
        return;
    }

    filtered.forEach(p => {
        const div = document.createElement('div');
        div.className = `project-item ${p.id === currentProjectId ? 'active' : ''}`;
        div.onclick = () => selectProject(p.id);
        
        let statusColor = p.status === '완료' ? '#10b981' : (p.status === '보류' ? '#f59e0b' : '#2563eb');

        div.innerHTML = `
            <div class="project-item-header">
                <div class="project-item-title">${highlightText(p.title, projectSearch ? projectSearch.value : '')}</div>
                <div style="width:8px; height:8px; border-radius:50%; background:${statusColor};" title="${p.status}"></div>
            </div>
            <div class="project-item-meta">
                <span>${p.category}</span>
                <span>•</span>
                <span>${highlightText(p.manager, projectSearch ? projectSearch.value : '')}</span>
            </div>
        `;
        projectsListEl.appendChild(div);
    });
}

function selectProject(id) {
    currentProjectId = id;
    renderProjectsList(); // Update active state
    renderProjectView(id);
}

function showEmptyState() {
    emptyStateEl.classList.remove('hidden');
    if(logSearchContainer) logSearchContainer.style.display='none';
    projectViewEl.classList.add('hidden');
}

// Render Main Timeline
async function renderProjectView(id) {
    const project = projects.find(p => p.id === id);
    if (!project) return;

    emptyStateEl.classList.add('hidden');
    projectViewEl.classList.remove('hidden');

    // Header info
    headerTitle.textContent = project.title;
    headerCategory.textContent = project.category;
    headerManager.innerHTML = `<i class='bx bx-user'></i> ${project.manager}`;
    headerStatus.value = project.status;
    headerCategory.className = `badge status-${project.status}`;

    // Load logs
    try {
        const res = await authFetch(`${API_BASE}/${id}/logs`);
        const data = await res.json();
        if (data.success) {
            currentLogs = data.data;
            if (logSearch) logSearch.value = '';
            if (logSearchContainer) logSearchContainer.style.display = 'flex';
            renderTimeline(currentLogs);
        }
    } catch (e) {
        console.error("Failed to load logs", e);
    }
}

function renderTimeline(logs) {
    timelineContainer.innerHTML = '';
    
    let filteredLogs = logs;
    const searchKeyword = logSearch ? logSearch.value.trim().toLowerCase() : '';
    
    if (searchKeyword) {
        filteredLogs = logs.filter(log => {
            const contentMatch = log.content && log.content.toLowerCase().includes(searchKeyword);
            const commentsMatch = log.comments && log.comments.some(c => c.content && c.content.toLowerCase().includes(searchKeyword));
            return contentMatch || commentsMatch;
        });
    }

    if (filteredLogs.length === 0) {
        timelineContainer.innerHTML = `
            <div style="text-align:center; padding: 40px; color:#94a3b8;">
                <i class='bx bx-message-square-dots' style="font-size:32px; margin-bottom:10px;"></i>
                <p>아직 기록된 로그가 없습니다.<br>하단에서 첫 이벤트를 기록해보세요.</p>
            </div>
        `;
        return;
    }

    filteredLogs.forEach(log => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        
        // Icon based on type
        let iconClass = 'info';
        let iconHtml = "<i class='bx bx-info-circle'></i>";
        if (log.logType === 'warning') {
            iconClass = 'warning';
            iconHtml = "<i class='bx bx-error'></i>";
        } else if (log.logType === 'success') {
            iconClass = 'success';
            iconHtml = "<i class='bx bx-check'></i>";
        }

        // Attachments
        let attachHtml = '';
        try {
            const atts = JSON.parse(log.attachments || '[]');
            if (atts.length > 0) {
                attachHtml = '<div class="timeline-attachments">';
                atts.forEach(url => {
                    let finalUrl = url;
                    if (finalUrl.startsWith('/uploads/projects/')) {
                        finalUrl = `/api/projects/uploads/${finalUrl.split('/').pop()}`;
                    }
                    const fullUrl = DOMAIN_BASE + finalUrl;
                    const filename = finalUrl.split('/').pop().split('-').slice(1).join('-') || finalUrl.split('/').pop();
                    attachHtml += `<a href="${fullUrl}" target="_blank" class="attachment-item"><i class='bx bx-file'></i> ${filename}</a>`;
                });
                attachHtml += '</div>';
            }
        } catch(e) {}

        let dateStr = '';
        if (log.createdAt && log.createdAt.length === 10) {
            const parts = log.createdAt.split('-');
            dateStr = `${parseInt(parts[1])}월 ${parseInt(parts[2])}일`;
        } else {
            dateStr = new Date(log.createdAt).toLocaleString('ko-KR', {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        }

        // Comments
        let commentsHtml = '';
        if (log.comments && log.comments.length > 0) {
            commentsHtml = '<div class="timeline-comments-list">';
            const topLevelComments = log.comments.filter(c => !c.parentId);
            const childComments = log.comments.filter(c => c.parentId);

            topLevelComments.forEach(c => {
                commentsHtml += window.renderCommentItem(c, log.id);
                const replies = childComments.filter(child => child.parentId === c.id);
                replies.forEach(reply => {
                    commentsHtml += window.renderCommentItem(reply, log.id, true);
                });
            });
            commentsHtml += '</div>';
        }

        const addCommentHtml = `
            <div class="add-comment-box" id="add-comment-box-${log.id}">
                <textarea class="comment-input linear-input" id="comment-input-${log.id}" rows="1" placeholder="댓글 달기..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter') submitComment('${log.id}')"></textarea>
                <button class="btn btn-sm btn-outline" onclick="submitComment('${log.id}')">전송</button>
            </div>
        `;

        item.innerHTML = `
            <div class="timeline-icon ${iconClass}">
                ${iconHtml}
            </div>
            <div class="timeline-content">
                <div class="timeline-meta">
                    <span>${dateStr}</span>
                    <div class="timeline-item-actions">
                        <button class="btn-edit-log" onclick="openEditLogModal('${log.id}')" title="수정"><i class='bx bx-edit-alt'></i></button>
                        <button class="btn-delete-log" onclick="deleteLog('${log.id}')" title="삭제"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
                <div class="timeline-text">${highlightText(log.content, logSearch ? logSearch.value : '')}</div>
                ${attachHtml}
                <div class="timeline-comments-wrapper">
                    ${commentsHtml}
                    ${addCommentHtml}
                </div>
            </div>
        `;
        timelineContainer.appendChild(item);
    });

    // Scroll to bottom smoothly
    setTimeout(() => {
        timelineContainer.scrollTop = timelineContainer.scrollHeight;
    }, 100);
}

// Comment Rendering and Actions
window.renderCommentItem = function(comment, logId, isReply = false) {
    let dateStr = new Date(comment.createdAt).toLocaleString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    
    const replyBtnHtml = isReply ? '' : `<button class="btn-reply-comment" onclick="toggleReplyBox('${comment.id}')">답글 달기</button>`;
    const deleteBtnHtml = `<button class="btn-delete-comment" onclick="deleteComment('${logId}', '${comment.id}')" title="삭제"><i class='bx bx-x'></i></button>`;

    const replyBoxHtml = isReply ? '' : `
        <div class="add-reply-box hidden" id="reply-box-${comment.id}">
            <textarea class="comment-input linear-input" id="reply-input-${comment.id}" rows="1" placeholder="답글 달기..." oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter') submitComment('${logId}', '${comment.id}')"></textarea>
            <button class="btn btn-sm btn-outline" onclick="submitComment('${logId}', '${comment.id}')">전송</button>
        </div>
    `;

    const authorTooltip = comment.authorEmail ? `title="${comment.authorEmail}"` : '';

    return `
        <div class="comment-item ${isReply ? 'comment-reply' : ''}">
            <div class="comment-header">
                <span class="comment-author" ${authorTooltip}>${comment.authorName}</span>
                <span class="comment-date">${dateStr}</span>
                ${deleteBtnHtml}
            </div>
            <div class="comment-body">${highlightText(comment.content, logSearch ? logSearch.value : '').replace(/\n/g, '<br>')}</div>
            <div class="comment-actions">
                ${replyBtnHtml}
            </div>
            ${replyBoxHtml}
        </div>
    `;
};

window.toggleReplyBox = function(commentId) {
    const box = document.getElementById(`reply-box-${commentId}`);
    if (box) {
        box.classList.toggle('hidden');
        if (!box.classList.contains('hidden')) {
            document.getElementById(`reply-input-${commentId}`).focus();
        }
    }
};

window.submitComment = async function(logId, parentId = null) {
    if (!currentProjectId) return;
    
    const inputId = parentId ? `reply-input-${parentId}` : `comment-input-${logId}`;
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    
    const content = inputEl.value.trim();
    if (!content) return;

    try {
        const payload = {
            id: generateLogId(),
            content: content,
            parentId: parentId,
            createdAt: new Date().toISOString()
        };

        const res = await authFetch(`${API_BASE}/${currentProjectId}/logs/${logId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            renderProjectView(currentProjectId); // reload timeline
        } else {
            Swal.fire('오류', data.error || '댓글 등록 실패', 'error');
        }
    } catch(e) {
        console.error(e);
        Swal.fire('오류', '댓글 등록 중 오류 발생', 'error');
    }
};

window.deleteComment = async function(logId, commentId) {
    const result = await Swal.fire({
        title: '댓글 삭제',
        text: '이 댓글을 삭제하시겠습니까? (대댓글이 있다면 함께 삭제됩니다)',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제',
        cancelButtonText: '취소'
    });

    if (result.isConfirmed) {
        try {
            const res = await authFetch(`${API_BASE}/${currentProjectId}/logs/${logId}/comments/${commentId}`, {
                method: 'DELETE'
            });
            const data = await res.json();
            if (data.success) {
                renderProjectView(currentProjectId); // reload timeline
            } else {
                Swal.fire('오류', data.error || '삭제 실패', 'error');
            }
        } catch (e) {
            Swal.fire('오류', '삭제 중 오류 발생', 'error');
        }
    }
};

// Bind Events
function bindEvents() {
    filterStatus.addEventListener('change', renderProjectsList);
    filterCategory.addEventListener('change', renderProjectsList);
    if (projectSearch) {
        projectSearch.addEventListener('input', renderProjectsList);
    }
    if (logSearch) {
        logSearch.addEventListener('input', () => renderTimeline(currentLogs));
    }

    const btnPrint = document.getElementById('btnPrintProject');
    if (btnPrint) {
        btnPrint.addEventListener('click', async () => {
            if (!currentProjectId) {
                Swal.fire('알림', '인쇄할 프로젝트를 먼저 선택해주세요.', 'info');
                return;
            }
            const project = projects.find(p => p.id === currentProjectId);
            if (!project) return;
            
            const { value: formValues } = await Swal.fire({
                title: '인쇄 설정',
                html:
                    '<input id="swal-input1" class="swal2-input" placeholder="헤더명 (예: 프로젝트 로그 내역)" value="프로젝트 로그 내역">' +
                    '<input id="swal-input2" class="swal2-input" placeholder="작성일 (예: 2026. 7. 30.)" value="' + new Date().toLocaleDateString() + '">',
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: '인쇄',
                cancelButtonText: '취소',
                preConfirm: () => {
                    return [
                        document.getElementById('swal-input1').value,
                        document.getElementById('swal-input2').value
                    ]
                }
            });

            if (formValues) {
                let printLogs = (currentLogs || []).slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
                executePrintProjectLogs(project, printLogs, formValues[0], formValues[1]);
            }
        });
    }

    // New Project Modal
    btnNewProject.addEventListener('click', () => {
        projectForm.reset();
        document.getElementById('projectId').value = '';
        projectModal.classList.remove('hidden');
    });

    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            projectModal.classList.add('hidden');
        });
    });

    // Edit Log Modal Close
    document.querySelectorAll('.close-edit-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('editLogModal').classList.add('hidden');
        });
    });

    // Edit Log Files Change
    const editLogNewFiles = document.getElementById('editLogNewFiles');
    if (editLogNewFiles) {
        editLogNewFiles.addEventListener('change', (e) => {
            currentEditNewFiles = Array.from(e.target.files);
            document.getElementById('editLogNewFilesCount').textContent = currentEditNewFiles.length > 0 ? `${currentEditNewFiles.length}개 파일 선택됨` : '';
        });
    }

    // Save Project
    btnSaveProject.addEventListener('click', async () => {
        if (!projectForm.reportValidity()) return;
        
        const pid = document.getElementById('projectId').value;
        const payload = {
            id: pid || generateId(),
            title: document.getElementById('projectTitle').value,
            category: document.getElementById('projectCategory').value,
            manager: document.getElementById('projectManager').value,
            status: '진행중',
            createdAt: new Date().toISOString()
        };

        const method = pid ? 'PUT' : 'POST';
        const url = pid ? `${API_BASE}/${pid}` : API_BASE;

        try {
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (data.success) {
                projectModal.classList.add('hidden');
                Swal.fire('성공', '프로젝트가 저장되었습니다.', 'success');
                currentProjectId = payload.id;
                loadProjects();
            } else {
                throw new Error(data.error);
            }
        } catch(e) {
            Swal.fire('오류', e.message, 'error');
        }
    });

    // Delete Project
    btnDeleteProject.addEventListener('click', async () => {
        if (!currentProjectId) return;
        
        const result = await Swal.fire({
            title: '정말 삭제하시겠습니까?',
            text: '프로젝트와 내부의 모든 로그가 영구 삭제됩니다.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소',
            confirmButtonColor: '#ef4444'
        });

        if (result.isConfirmed) {
            try {
                const res = await authFetch(`${API_BASE}/${currentProjectId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                    currentProjectId = null;
                    Swal.fire('삭제 완료', '', 'success');
                    loadProjects();
                }
            } catch(e) {
                Swal.fire('오류', '삭제 실패', 'error');
            }
        }
    });

    // Change Project Status
    headerStatus.addEventListener('change', async (e) => {
        if (!currentProjectId) return;
        const newStatus = e.target.value;
        const project = projects.find(p => p.id === currentProjectId);
        if(!project) return;
        
        try {
            const res = await authFetch(`${API_BASE}/${currentProjectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...project, status: newStatus, updatedAt: new Date().toISOString() })
            });
            const data = await res.json();
            if(data.success) {
                project.status = newStatus;
                renderProjectView(currentProjectId);
                renderProjectsList();
            }
        } catch(e) {
            console.error(e);
        }
    });

    // File Input trigger
    btnAttach.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        for (const file of e.target.files) {
            selectedFiles.push(file);
        }
        renderSelectedFiles();
        fileInput.value = ''; // Reset
    });

    // Handle form submit (New Log)
    logForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentProjectId) return;
        
        const content = logInput.value.trim();
        if (!content && selectedFiles.length === 0) return;

        let attachmentUrls = [];
        
        // 1. Upload files if any
        if (selectedFiles.length > 0) {
            const formData = new FormData();
            selectedFiles.forEach(f => formData.append('files', f));
            try {
                const uploadRes = await authFetch(`${API_BASE}/upload`, {
                    method: 'POST',
                    body: formData
                });
                const uploadData = await uploadRes.json();
                if (uploadData.success) {
                    attachmentUrls = uploadData.filePaths;
                } else {
                    throw new Error(uploadData.error);
                }
            } catch(e) {
                Swal.fire('업로드 오류', e.message, 'error');
                return;
            }
        }

        // 2. Post Log
        let finalDate = new Date().toISOString();
        if (logDateInput.value) {
            finalDate = logDateInput.value;
        }

        const logPayload = {
            id: generateLogId(),
            content: content,
            logType: logTypeSelect.value,
            attachments: attachmentUrls,
            createdAt: finalDate
        };

        try {
            const res = await authFetch(`${API_BASE}/${currentProjectId}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(logPayload)
            });
            const data = await res.json();
            if (data.success) {
                logInput.value = '';
                logInput.style.height = 'auto'; // Reset height
                logTypeSelect.value = 'info';
                logDateInput.value = '';
                selectedFiles = [];
                renderSelectedFiles();
                renderProjectView(currentProjectId); // reload timeline
            }
        } catch(e) {
            Swal.fire('오류', '로그 등록 실패', 'error');
        }
    });

    // Ctrl+Enter for quick submit
    logInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            btnSend.click();
        }
    });

    // Auto-resize logInput
    logInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
    });
}

function renderSelectedFiles() {
    inputAttachments.innerHTML = '';
    selectedFiles.forEach((file, idx) => {
        const el = document.createElement('div');
        el.className = 'preview-file';
        el.innerHTML = `<span>${file.name}</span> <i class='bx bx-x remove-file' onclick="removeFile(${idx})"></i>`;
        inputAttachments.appendChild(el);
    });
}

window.removeFile = function(idx) {
    selectedFiles.splice(idx, 1);
    renderSelectedFiles();
};

// Global Delete function
window.deleteLog = async function(logId) {
    const result = await Swal.fire({
        title: '로그를 삭제하시겠습니까?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: '삭제',
        confirmButtonColor: '#ef4444'
    });
    if(result.isConfirmed) {
        try {
            const res = await authFetch(`${API_BASE}/${currentProjectId}/logs/${logId}`, { method: 'DELETE' });
            const data = await res.json();
            if(data.success) {
                renderProjectView(currentProjectId);
            }
        } catch(e) {
            console.error(e);
        }
    }
};

// Edit Log Feature
let currentEditRetainedAttachments = [];
let currentEditNewFiles = [];

window.openEditLogModal = function(logId) {
    const log = currentLogs.find(l => l.id === logId);
    if(!log) return;

    document.getElementById('editLogId').value = log.id;
    document.getElementById('editLogType').value = log.logType || 'info';
    document.getElementById('editLogContent').value = log.content;
    
    if (log.createdAt && log.createdAt.length === 10) {
        document.getElementById('editLogDate').value = log.createdAt; 
    } else {
        const d = new Date(log.createdAt);
        const yyyymmdd = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0,10);
        document.getElementById('editLogDate').value = yyyymmdd;
    }

    currentEditRetainedAttachments = [];
    try {
        currentEditRetainedAttachments = JSON.parse(log.attachments || '[]');
    } catch(e) {}

    currentEditNewFiles = [];
    document.getElementById('editLogNewFiles').value = '';
    document.getElementById('editLogNewFilesCount').textContent = '';

    renderEditModalAttachments();
    
    document.getElementById('editLogModal').classList.remove('hidden');
};

window.removeEditAttachment = function(idx) {
    currentEditRetainedAttachments.splice(idx, 1);
    renderEditModalAttachments();
};

function renderEditModalAttachments() {
    const listEl = document.getElementById('editLogAttachmentsList');
    listEl.innerHTML = '';
    currentEditRetainedAttachments.forEach((url, idx) => {
        let finalUrl = url;
        if (finalUrl.startsWith('/uploads/projects/')) {
            finalUrl = `/api/projects/uploads/${finalUrl.split('/').pop()}`;
        }
        const filename = finalUrl.split('/').pop().split('-').slice(1).join('-') || finalUrl.split('/').pop();
        const item = document.createElement('div');
        item.className = 'manage-attachment-item';
        item.innerHTML = `
            <span><i class='bx bx-file'></i> ${filename}</span>
            <button type="button" class="remove-attachment" onclick="removeEditAttachment(${idx})" title="삭제"><i class='bx bx-x'></i></button>
        `;
        listEl.appendChild(item);
    });
}

document.getElementById('btnSaveEditLog').addEventListener('click', async () => {
    const form = document.getElementById('editLogForm');
    if (!form.reportValidity()) return;

    const btn = document.getElementById('btnSaveEditLog');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> 저장 중...';
    btn.disabled = true;

    try {
        const logId = document.getElementById('editLogId').value;
        let uploadedPaths = [];

        // 1. 새 파일 업로드
        if (currentEditNewFiles.length > 0) {
            const formData = new FormData();
            currentEditNewFiles.forEach(f => formData.append('files', f));
            const uploadRes = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
                uploadedPaths = uploadData.filePaths;
            } else {
                throw new Error("파일 업로드 실패");
            }
        }

        // 2. 최종 첨부파일 병합
        const finalAttachments = [...currentEditRetainedAttachments, ...uploadedPaths];
        
        const type = document.getElementById('editLogType').value;
        const rawDate = document.getElementById('editLogDate').value;
        const text = document.getElementById('editLogContent').value;
        
        const log = currentLogs.find(l => l.id === logId);
        let dateToSave = log.createdAt; // 기본적으로 기존 작성일시 유지
        
        if (rawDate) {
            let originalYyyymmdd = '';
            if (log.createdAt && log.createdAt.length === 10) {
                originalYyyymmdd = log.createdAt;
            } else {
                const d = new Date(log.createdAt);
                originalYyyymmdd = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0,10);
            }
            
            // 날짜가 변경되었거나, 기존에도 '시간 없는 날짜'였으면 YYYY-MM-DD 포맷 그대로 저장
            if (rawDate !== originalYyyymmdd || (log.createdAt && log.createdAt.length === 10)) {
                dateToSave = rawDate;
            }
        } else {
            // 날짜를 완전히 지운 경우, 기존 시간 유지
            dateToSave = log.createdAt;
        }

        const payload = {
            content: text,
            logType: type,
            attachments: finalAttachments,
            createdAt: dateToSave
        };

        const res = await authFetch(`${API_BASE}/${currentProjectId}/logs/${logId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            document.getElementById('editLogModal').classList.add('hidden');
            renderProjectView(currentProjectId);
        } else {
            console.error("Server returned error:", data);
            throw new Error(data.error || "서버 저장 실패");
        }
    } catch(e) {
        console.error("Edit log error:", e);
        Swal.fire('오류', '로그 수정 실패: ' + e.message, 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});


/* ==========================================================================
   Print Logic (Project Logs)
   ========================================================================== */



function executePrintProjectLogs(project, logs, headerTitle, createDate) {
    const container = document.getElementById('printContainer');
    if (!container) return;

    // Build the HTML template
    let html = `<table style="width: 100%; border: none; margin: 0; padding: 0; border-spacing: 0;">`;
    html += `<thead style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></thead>`;
    html += `<tfoot style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></tfoot>`;
    html += `<tbody><tr><td style="border: none; padding: 0 10mm;">`;
    
    html += `<div class="print-report">`;
    
    // Header
    html += `
        <div class="print-header">
            <h1 class="print-title">${headerTitle}</h1>
        </div>
    `;

    // Project Info
    html += `
        <table class="print-info-table">
            <tr>
                <th>담당자</th>
                <td>${project.manager}</td>
                <th>작성일</th>
                <td>${createDate}</td>
            </tr>
        </table>
    `;

    // Logs Table
    html += `
        <h3 style="margin-bottom: 10px; border-left: 3px solid #0f172a; padding-left: 8px;">상세 진행 내역</h3>
        <table class="print-log-table">
            <thead>
                <tr>
                    <th class="col-date" style="width: 20%; text-align: center;">일자</th>
                    <th class="col-content" style="width: 80%;">내용</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (logs.length === 0) {
        html += `<tr><td colspan="2" style="text-align:center; padding: 20px; color: #64748b;">등록된 로그가 없습니다.</td></tr>`;
    } else {
        logs.forEach(log => {
            const dateStr = (log.createdAt || "").substring(0,10);

            // Format content with newlines
            const formattedContent = (log.content || '').replace(/\n/g, '<br>');

            html += `
                <tr>
                    <td class="col-date" style="text-align: center;">${dateStr}</td>
                    <td class="col-content">
                        <div style="white-space: pre-wrap;">${formattedContent}</div>
                    </td>
                </tr>
            `;
        });
    }

    html += `
            </tbody>
        </table>
    `;
    
    html += `</div>`; // end .print-report
    html += `</td></tr></tbody></table>`; // end wrapper table

    // Inject and Print
    container.innerHTML = html;
    
    // Close sweetalert if it's open (it will automatically close but this forces it)
    if (Swal.isVisible()) {
        Swal.close();
    }
    
    setTimeout(() => {
        window.onafterprint = () => {
            container.innerHTML = '';
            window.onafterprint = null;
        };
        window.print();
    }, 500);
}
