import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

// Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyDqdzlXTddvoBYWaVbTM7_ERO_rUGWjIgE",
    authDomain: "kng-inventory.firebaseapp.com",
    projectId: "kng-inventory",
    storageBucket: "kng-inventory.firebasestorage.app",
    messagingSenderId: "647181899026",
    appId: "1:647181899026:web:7cd3b62a7a10771b204fcb",
    measurementId: "G-5VYMDB59XD"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let currentGuidelines = [];
let currentDetailId = null;
let editor = null;
let detailEditorjs = null;
let viewer = null;

document.addEventListener('DOMContentLoaded', () => {
    // Toast UI Viewer 초기화 (구버전 마크다운 데이터 호환용 뷰어)
    const Editor = toastui.Editor;
    viewer = Editor.factory({
        el: document.querySelector('#detailContent'),
        viewer: true,
        initialValue: ''
    });

    // 이벤트 리스너 등록
    document.getElementById('btnNewGuideline').addEventListener('click', () => openEditor());
    document.getElementById('btnCancelEdit').addEventListener('click', () => showView('listView'));
    document.getElementById('btnBackToList').addEventListener('click', () => showView('listView'));
    document.getElementById('btnSaveGuideline').addEventListener('click', saveGuideline);
    document.getElementById('btnEditGuideline').addEventListener('click', openEditorForEdit);
    
    // 검색 필터 이벤트
    document.getElementById('searchInput').addEventListener('input', debounce(renderGuidelines, 300));
    document.getElementById('categoryFilter').addEventListener('change', renderGuidelines);

    // 로그인 상태 확인 후 데이터 로드
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        loadGuidelines();
    });
});

function initEditorjs(containerId, readOnly = false, initialData = null) {
    const editor = new EditorJS({
        holder: containerId,
        readOnly: readOnly,
        data: initialData || {},
        placeholder: '빈 줄에서 "/" 키를 눌러 메뉴를 열거나 텍스트를 입력하세요.',
        tools: {
            header: { class: window.Header, inlineToolbar: true, config: { placeholder: '제목', levels: [1, 2, 3], defaultLevel: 2 } },
            list: { class: window.EditorjsList || window.List, inlineToolbar: true },
            checklist: { class: window.Checklist, inlineToolbar: true },
            quote: { class: window.Quote, inlineToolbar: true },
            table: { class: window.Table, inlineToolbar: true },
            marker: { class: window.Marker },
            image: {
                class: window.ImageTool || window.SimpleImage,
                config: {
                    uploader: {
                        uploadByFile(file) {
                            return new Promise((resolve, reject) => {
                                const formData = new FormData();
                                formData.append('photos', file);
                                
                                auth.currentUser.getIdToken().then(token => {
                                    fetch('https://kng.junparks.com/api/exhibition-report/upload', {
                                        method: 'POST',
                                        headers: { 'Authorization': 'Bearer ' + token },
                                        body: formData
                                    }).then(res => res.json()).then(data => {
                                        if (data.urls && data.urls.length > 0) {
                                            const url = data.urls[0].startsWith('/') ? 'https://kng.junparks.com' + data.urls[0] : data.urls[0];
                                            resolve({ success: 1, file: { url: url } });
                                        } else {
                                            reject('Upload failed');
                                        }
                                    }).catch(err => reject(err));
                                });
                            });
                        }
                    }
                }
            }
        }
    });

    // 노션 스타일 단축키 (Markdown shortcuts) 구현
    if (!readOnly) {
        editor.isReady.then(() => {
            const container = document.getElementById(containerId);
            if (!container) return;
            
            container.addEventListener('input', (e) => {
                const target = e.target;
                if (target.classList.contains('ce-paragraph') || target.getAttribute('data-placeholder')) {
                    // textContent를 통해 앞부분 텍스트 확인 (공백 문자가 &nbsp; 일 수 있으므로 변환)
                    const text = target.textContent.replace(/\u00A0/g, ' '); 
                    
                    let type = null;
                    let data = {};
                    
                    if (text === '- ' || text === '* ') {
                        type = 'list';
                        // 최신 @editorjs/list (nested-list) 포맷에 맞춘 초기 아이템 구조
                        data = { style: 'unordered', items: [ { content: '', items: [] } ] };
                    } else if (text === '1. ') {
                        type = 'list';
                        data = { style: 'ordered', items: [ { content: '', items: [] } ] };
                    } else if (text === '# ') {
                        type = 'header';
                        data = { level: 1, text: '' };
                    } else if (text === '## ') {
                        type = 'header';
                        data = { level: 2, text: '' };
                    } else if (text === '### ') {
                        type = 'header';
                        data = { level: 3, text: '' };
                    } else if (text === '> ') {
                        type = 'quote';
                        data = { text: '', caption: '' };
                    } else if (text === '[] ' || text === '[ ] ') {
                        type = 'checklist';
                        data = { items: [ { text: '', checked: false } ] };
                    }
                    
                    if (type) {
                        try {
                            const index = editor.blocks.getCurrentBlockIndex();
                            editor.blocks.delete(index);
                            
                            // 0.5초 대기 후 포커스 주는 방식으로 변경 (안전성 확보)
                            editor.blocks.insert(type, data, {}, index, false);
                            setTimeout(() => {
                                editor.caret.setToBlock(index, 'end');
                            }, 10);
                        } catch(err) {
                            console.error("Markdown shortcut error:", err);
                        }
                    }
                }
            });
        });
    }

    return editor;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function showView(viewName) {
    document.querySelectorAll('.view-section').forEach(el => {
        if(el.id === viewName) {
            el.classList.add('active');
            el.classList.remove('hidden');
        } else {
            el.classList.add('hidden');
            el.classList.remove('active');
        }
    });
}

async function loadGuidelines() {
    const tbody = document.getElementById('guidelineListBody');
    tbody.innerHTML = '<tr class="loading-row"><td colspan="6"><div class="skeleton"></div></td></tr>';
    
    try {
        const q = query(collection(db, 'guidelines'), orderBy('updatedAt', 'desc'));
        const snapshot = await getDocs(q);
        
        currentGuidelines = [];
        snapshot.forEach(doc => {
            currentGuidelines.push({ id: doc.id, ...doc.data() });
        });
        
        renderGuidelines();
    } catch (error) {
        console.error("Error loading guidelines: ", error);
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:red; padding: 20px;">데이터를 불러오는 중 오류가 발생했습니다. 권한 문제일 수 있습니다.</td></tr>';
    }
}

function renderGuidelines() {
    const tbody = document.getElementById('guidelineListBody');
    tbody.innerHTML = '';
    
    const search = document.getElementById('searchInput').value.toLowerCase();
    const category = document.getElementById('categoryFilter').value;
    
    let filtered = currentGuidelines;
    
    if (category) {
        filtered = filtered.filter(g => g.category === category);
    }
    
    if (search) {
        filtered = filtered.filter(g => 
            (g.title && g.title.toLowerCase().includes(search)) || 
            (g.tags && g.tags.some(t => t.toLowerCase().includes(search))) ||
            (g.content && g.content.toLowerCase().includes(search))
        );
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 30px;">등록된 업무 지침이 없습니다.</td></tr>';
        return;
    }
    
    filtered.forEach(item => {
        const tr = document.createElement('tr');
        
        const tagsHtml = (item.tags || []).map(t => `<span class="badge badge-tag">${t}</span>`).join(' ');
        const dateStr = item.updatedAt ? new Date(item.updatedAt.toDate()).toLocaleDateString('ko-KR') : '-';
        
        tr.innerHTML = `
            <td><span class="badge badge-category">${item.category || '분류없음'}</span></td>
            <td style="font-weight: 500;"><a href="javascript:void(0)" class="title-link" style="color:#2563eb; text-decoration:none;">${item.title}</a></td>
            <td>${tagsHtml}</td>
            <td>${item.authorName || '관리자'}</td>
            <td>${dateStr}</td>
            <td>
                <button class="btn-outline btn-outline-danger btn-delete" style="padding: 4px 8px; font-size: 12px;"><i class='bx bx-trash'></i> 삭제</button>
            </td>
        `;
        
        // 이벤트 바인딩
        tr.querySelector('.title-link').addEventListener('click', () => openDetail(item.id));
        tr.querySelector('.btn-delete').addEventListener('click', () => deleteGuideline(item.id));
        
        tbody.appendChild(tr);
    });
}

async function openEditor(item = null) {
    try {
        if (item) {
            document.getElementById('editGuidelineId').value = item.id;
            document.getElementById('editCategory').value = item.category || '공통';
            document.getElementById('editTitle').value = item.title || '';
            document.getElementById('editTags').value = (item.tags || []).join(', ');
            document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 지침 수정";
        } else {
            document.getElementById('editGuidelineId').value = '';
            document.getElementById('editCategory').value = '공통';
            document.getElementById('editTitle').value = '';
            document.getElementById('editTags').value = '';
            document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 새 지침 작성";
        }
        
        if (editor) {
            try {
                await editor.isReady;
                editor.destroy();
            } catch (e) { console.error(e); }
        }
        
        document.getElementById('editor').innerHTML = '';
        
        let initialData = null;
        if (item) {
            if (typeof item.content === 'object') {
                initialData = item.content;
            } else if (typeof item.content === 'string' && item.content.trim()) {
                initialData = {
                    blocks: [
                        { type: 'paragraph', data: { text: "<b>[안내] 이 글은 구버전 마크다운으로 작성되었습니다. 스타일이 초기화되었습니다.</b>" } },
                        { type: 'paragraph', data: { text: item.content.replace(/\n/g, '<br>') } }
                    ]
                };
            }
        }
        
        editor = initEditorjs('editor', false, initialData);

        showView('editView');
    } catch(err) {
        alert("에디터 열기 에러: " + err.message);
        console.error(err);
    }
}

function openEditorForEdit() {
    if (!currentDetailId) return;
    const item = currentGuidelines.find(g => g.id === currentDetailId);
    if (item) openEditor(item);
}

function openDetail(id) {
    const item = currentGuidelines.find(g => g.id === id);
    if (!item) return;
    
    currentDetailId = id;
    document.getElementById('detailCategory').textContent = item.category || '분류없음';
    document.getElementById('detailTitle').textContent = item.title;
    document.getElementById('detailAuthor').innerHTML = `<i class='bx bx-user'></i> ${item.authorName || '관리자'}`;
    const dateStr = item.updatedAt ? new Date(item.updatedAt.toDate()).toLocaleString('ko-KR') : '-';
    document.getElementById('detailDate').innerHTML = `<i class='bx bx-time-five'></i> ${dateStr}`;
    
    const tagsHtml = (item.tags || []).map(t => `<span class="badge badge-tag">${t}</span>`).join(' ');
    document.getElementById('detailTags').innerHTML = tagsHtml;
    
    const divMarkdown = document.getElementById('detailContent');
    const divBlocks = document.getElementById('detailBlocks');
    
    if (typeof item.content === 'string') {
        divBlocks.style.display = 'none';
        divMarkdown.style.display = 'block';
        viewer.setMarkdown(item.content || '');
    } else {
        divMarkdown.style.display = 'none';
        divBlocks.style.display = 'block';
        
        if (detailEditorjs) {
            detailEditorjs.destroy();
        }
        document.getElementById('detailBlocks').innerHTML = '';
        detailEditorjs = initEditorjs('detailBlocks', true, item.content);
    }
    
    showView('detailView');
}

async function saveGuideline() {
    const id = document.getElementById('editGuidelineId').value;
    const category = document.getElementById('editCategory').value;
    const title = document.getElementById('editTitle').value.trim();
    const tagsInput = document.getElementById('editTags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t !== '');
    
    if (!title) {
        alert("제목을 입력해주세요.");
        return;
    }
    
    let contentData = null;
    try {
        contentData = await editor.save();
        if (contentData.blocks.length === 0) {
            alert("본문 내용을 입력해주세요.");
            return;
        }
    } catch(e) {
        console.error("Editor.js save failed: ", e);
        return;
    }
    
    const data = {
        title,
        category,
        tags,
        content: contentData, // Editor.js JSON Object
        authorId: currentUser ? currentUser.uid : 'admin',
        authorName: currentUser ? (currentUser.email ? currentUser.email.split('@')[0] : 'admin') : 'admin',
        updatedAt: serverTimestamp()
    };
    
    const btn = document.getElementById('btnSaveGuideline');
    btn.disabled = true;
    btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 저장 중...";
    
    try {
        if (id) {
            await updateDoc(doc(db, 'guidelines', id), data);
        } else {
            data.createdAt = serverTimestamp();
            await addDoc(collection(db, 'guidelines'), data);
        }
        await loadGuidelines(); // 새로고침
        showView('listView');
    } catch (error) {
        console.error("Error saving guideline: ", error);
        alert("저장 중 오류가 발생했습니다. 권한을 확인해주세요.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "<i class='bx bx-save'></i> 저장";
    }
}

async function deleteGuideline(id) {
    if (!confirm("정말로 이 지침을 삭제하시겠습니까? (이 작업은 되돌릴 수 없습니다)")) return;
    
    try {
        await deleteDoc(doc(db, 'guidelines', id));
        await loadGuidelines();
        if (currentDetailId === id) {
            showView('listView');
        }
    } catch (error) {
        console.error("Error deleting guideline: ", error);
        alert("삭제 중 오류가 발생했습니다.");
    }
}
