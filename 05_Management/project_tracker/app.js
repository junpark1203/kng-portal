// 05_Management/project_tracker/app.js

const API_BASE = '/api/projects';

let projects = [];
let currentProjectId = null;
let selectedFiles = [];

// DOM Elements
const projectsListEl = document.getElementById('projectsList');
const emptyStateEl = document.getElementById('emptyState');
const projectViewEl = document.getElementById('projectView');
const timelineContainer = document.getElementById('timelineContainer');
const filterStatus = document.getElementById('filterStatus');
const filterCategory = document.getElementById('filterCategory');

const headerTitle = document.getElementById('headerTitle');
const headerCategory = document.getElementById('headerCategory');
const headerManager = document.getElementById('headerManager');
const headerStatus = document.getElementById('headerStatus');

const logForm = document.getElementById('logForm');
const logInput = document.getElementById('logInput');
const logTypeSelect = document.getElementById('logTypeSelect');
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
        const res = await fetch(API_BASE);
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
                <div class="project-item-title">${p.title}</div>
                <div style="width:8px; height:8px; border-radius:50%; background:${statusColor};" title="${p.status}"></div>
            </div>
            <div class="project-item-meta">
                <span>${p.category}</span>
                <span>•</span>
                <span>${p.manager}</span>
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
        const res = await fetch(`${API_BASE}/${id}/logs`);
        const data = await res.json();
        if (data.success) {
            renderTimeline(data.data);
        }
    } catch (e) {
        console.error("Failed to load logs", e);
    }
}

function renderTimeline(logs) {
    timelineContainer.innerHTML = '';
    
    if (logs.length === 0) {
        timelineContainer.innerHTML = `
            <div style="text-align:center; padding: 40px; color:#94a3b8;">
                <i class='bx bx-message-square-dots' style="font-size:32px; margin-bottom:10px;"></i>
                <p>아직 기록된 로그가 없습니다.<br>하단에서 첫 이벤트를 등록해보세요.</p>
            </div>
        `;
        return;
    }

    logs.forEach(log => {
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
                    const filename = url.split('/').pop().split('-').slice(1).join('-') || url.split('/').pop();
                    attachHtml += `<a href="${url}" target="_blank" class="attachment-item"><i class='bx bx-file'></i> ${filename}</a>`;
                });
                attachHtml += '</div>';
            }
        } catch(e) {}

        const dateStr = new Date(log.createdAt).toLocaleString('ko-KR', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        item.innerHTML = `
            <div class="timeline-icon ${iconClass}">
                ${iconHtml}
            </div>
            <div class="timeline-content">
                <div class="timeline-meta">
                    <span>${dateStr}</span>
                    <i class='bx bx-trash' style="cursor:pointer;" onclick="deleteLog('${log.id}')" title="삭제"></i>
                </div>
                <div class="timeline-text">${log.content}</div>
                ${attachHtml}
            </div>
        `;
        timelineContainer.appendChild(item);
    });

    // Scroll to bottom smoothly
    setTimeout(() => {
        timelineContainer.scrollTop = timelineContainer.scrollHeight;
    }, 100);
}

// Bind Events
function bindEvents() {
    filterStatus.addEventListener('change', renderProjectsList);
    filterCategory.addEventListener('change', renderProjectsList);

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
            const res = await fetch(url, {
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
                const res = await fetch(`${API_BASE}/${currentProjectId}`, { method: 'DELETE' });
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
            const res = await fetch(`${API_BASE}/${currentProjectId}`, {
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
                const uploadRes = await fetch(`${API_BASE}/upload`, {
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
        const logPayload = {
            id: generateLogId(),
            content: content,
            logType: logTypeSelect.value,
            attachments: attachmentUrls,
            createdAt: new Date().toISOString()
        };

        try {
            const res = await fetch(`${API_BASE}/${currentProjectId}/logs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(logPayload)
            });
            const data = await res.json();
            if (data.success) {
                logInput.value = '';
                logTypeSelect.value = 'info';
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
            const res = await fetch(`${API_BASE}/${currentProjectId}/logs/${logId}`, { method: 'DELETE' });
            const data = await res.json();
            if(data.success) {
                renderProjectView(currentProjectId);
            }
        } catch(e) {
            console.error(e);
        }
    }
};
