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
let editor;
let viewer;

document.addEventListener('DOMContentLoaded', () => {
    // Toast UI Editor 초기화
    const Editor = toastui.Editor;
    editor = new Editor({
        el: document.querySelector('#editor'),
        height: '600px',
        initialEditType: 'wysiwyg',
        previewStyle: 'vertical',
        language: 'ko-KR',
        placeholder: '내용을 입력해주세요. 이미지 복사/붙여넣기도 가능합니다.',
        toolbarItems: [
            ['heading', 'bold', 'italic', 'strike'],
            ['hr', 'quote'],
            ['ul', 'ol', 'task', 'indent', 'outdent'],
            ['table', 'image', 'link'],
            ['code', 'codeblock']
        ]
    });

    // Toast UI Viewer 초기화
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

function openEditor(item = null) {
    if (item) {
        document.getElementById('editGuidelineId').value = item.id;
        document.getElementById('editCategory').value = item.category || '공통';
        document.getElementById('editTitle').value = item.title || '';
        document.getElementById('editTags').value = (item.tags || []).join(', ');
        editor.setMarkdown(item.content || '');
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 지침 수정";
    } else {
        document.getElementById('editGuidelineId').value = '';
        document.getElementById('editCategory').value = '공통';
        document.getElementById('editTitle').value = '';
        document.getElementById('editTags').value = '';
        editor.setMarkdown('');
        document.getElementById('editViewTitle').innerHTML = "<i class='bx bx-edit'></i> 새 지침 작성";
    }
    showView('editView');
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
    
    viewer.setMarkdown(item.content || '');
    
    showView('detailView');
}

async function saveGuideline() {
    const id = document.getElementById('editGuidelineId').value;
    const category = document.getElementById('editCategory').value;
    const title = document.getElementById('editTitle').value.trim();
    const tagsInput = document.getElementById('editTags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t !== '');
    const content = editor.getMarkdown(); // 마크다운 원본 저장
    
    if (!title) {
        alert("제목을 입력해주세요.");
        return;
    }
    if (!content) {
        alert("본문 내용을 입력해주세요.");
        return;
    }
    
    const data = {
        title,
        category,
        tags,
        content,
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
