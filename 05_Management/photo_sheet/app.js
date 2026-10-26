/**
 * ==========================================================================
 * 현장 사진 대지 (A4 Auto Photo Sheet) Controller
 * - 제목 + 최대 8장 사진 업로드 시 A4 세로(1×1 ~ 2×4) / 가로(1×1 ~ 4×2) 자동 리사이즈
 * - 서버 저장, 불러오기, 복사본 생성, 삭제, 실시간 A4 프리뷰 지원
 * ==========================================================================
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000/api/report-builder`
    : 'https://kng.junparks.com/api/report-builder';

const DOC_PREFIX = '[PS]::';
const MAX_PHOTOS = 8;

// 애플리케이션 상태
let state = {
    currentDocId: null,
    title: '',
    docDate: getTodayString(),
    showDate: true,
    orientation: 'portrait', // 'portrait' (세로 최대 2x4) | 'landscape' (가로 최대 4x2)
    layoutMode: 'auto',      // 'auto' 또는 '1x2', '2x2' 등 수동 지정
    fitMode: 'contain',      // 'contain' (원본 비율) | 'cover' (꽉 채우기)
    showBorder: true,
    showIndex: false,
    photos: []               // [{ id, url, caption }]
};

let allSavedDocs = [];       // 목록 검색용 캐시
let draggedPhotoIndex = null;

// DOM 참조
const listView = document.getElementById('listView');
const editorView = document.getElementById('editorView');
const sheetList = document.getElementById('sheetList');
const searchInput = document.getElementById('searchInput');

const sheetTitleInput = document.getElementById('sheetTitleInput');
const sheetDateInput = document.getElementById('sheetDateInput');
const showDateCheck = document.getElementById('showDateCheck');
const orientationGroup = document.getElementById('orientationGroup');
const gridLayoutSelect = document.getElementById('gridLayoutSelect');
const fitModeGroup = document.getElementById('fitModeGroup');
const showBorderCheck = document.getElementById('showBorderCheck');
const showIndexCheck = document.getElementById('showIndexCheck');

const uploadDropzone = document.getElementById('uploadDropzone');
const fileInput = document.getElementById('fileInput');
const photoItemList = document.getElementById('photoItemList');
const photoCountBadge = document.getElementById('photoCountBadge');
const currentGridBadge = document.getElementById('currentGridBadge');

const a4Sheet = document.getElementById('a4Sheet');
const previewTitle = document.getElementById('previewTitle');
const previewDateWrap = document.getElementById('previewDateWrap');
const previewDate = document.getElementById('previewDate');
const sheetPhotoGrid = document.getElementById('sheetPhotoGrid');
const dynamicPageStyle = document.getElementById('dynamicPageStyle');

const globalLoading = document.getElementById('globalLoading');
const loadingText = document.getElementById('loadingText');
const toastContainer = document.getElementById('toastContainer');

// --------------------------------------------------------------------------
// 유틸리티 함수
// --------------------------------------------------------------------------
function generateId() {
    return 'p_' + Math.random().toString(36).substring(2, 10);
}

function getTodayString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function stripPrefix(rawTitle) {
    if (!rawTitle) return '';
    return String(rawTitle).startsWith(DOC_PREFIX)
        ? String(rawTitle).slice(DOC_PREFIX.length)
        : String(rawTitle);
}

function addPrefix(cleanTitle) {
    const base = (cleanTitle || '').trim() || '제목 없는 사진 대지';
    return base.startsWith(DOC_PREFIX) ? base : `${DOC_PREFIX}${base}`;
}

function getImgSrc(url) {
    if (!url) return '';
    if (url.startsWith('/api/report-builder')) {
        const base = API_BASE.replace('/api/report-builder', '');
        return base + url;
    }
    return url;
}

function showLoading(show, text = '처리 중...') {
    if (loadingText) loadingText.textContent = text;
    if (show) globalLoading.classList.remove('hidden');
    else globalLoading.classList.add('hidden');
}

function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'ps-toast';
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.remove();
    }, 2800);
}

async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch (e) {}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, opts);
    if (!res.ok && res.status === 401 && _retries > 0) {
        await new Promise(r => setTimeout(r, 700));
        return authFetch(url, opts, _retries - 1);
    }
    return res;
}

// --------------------------------------------------------------------------
// 사진 개수 및 용지 방향에 따른 자동 그리드(열 × 행) 계산
// --------------------------------------------------------------------------
function computeAutoGrid(count, orientation) {
    const n = Math.max(1, Math.min(MAX_PHOTOS, count || 1));
    if (orientation === 'portrait') {
        // A4 세로: 1×1 ~ 최대 2×4
        if (n === 1) return { cols: 1, rows: 1 };
        if (n === 2) return { cols: 1, rows: 2 }; // 세로 2장일 때 상·하 1×2 배치
        if (n <= 4)  return { cols: 2, rows: 2 };
        if (n <= 6)  return { cols: 2, rows: 3 };
        return { cols: 2, rows: 4 };
    } else {
        // A4 가로: 1×1 ~ 최대 4×2
        if (n === 1) return { cols: 1, rows: 1 };
        if (n === 2) return { cols: 2, rows: 1 }; // 가로 2장일 때 좌·우 2×1 배치
        if (n === 3) return { cols: 3, rows: 1 };
        if (n === 4) return { cols: 2, rows: 2 };
        if (n <= 6)  return { cols: 3, rows: 2 };
        return { cols: 4, rows: 2 };
    }
}

function getEffectiveGrid() {
    const count = state.photos.length;
    const autoGrid = computeAutoGrid(count, state.orientation);
    if (state.layoutMode === 'auto') {
        return autoGrid;
    }
    const parts = state.layoutMode.split('x').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        const manualSlots = parts[0] * parts[1];
        // 사진 개수가 수동 선택한 칸 수보다 많으면 사진이 잘리지 않도록 자동 그리드로 보정
        if (manualSlots >= count) {
            return { cols: parts[0], rows: parts[1] };
        }
    }
    return autoGrid;
}

function populateLayoutOptions() {
    const currentVal = state.layoutMode || 'auto';
    const presets = state.orientation === 'portrait'
        ? [
            { value: 'auto', label: '자동 맞춤 (사진 개수 기준)' },
            { value: '1x1', label: '1 × 1 (1열 1행 · 최대 1장)' },
            { value: '1x2', label: '1 × 2 (1열 2행 · 상하 2장)' },
            { value: '2x1', label: '2 × 1 (2열 1행 · 좌우 2장)' },
            { value: '1x3', label: '1 × 3 (1열 3행 · 상하 3장)' },
            { value: '2x2', label: '2 × 2 (2열 2행 · 최대 4장)' },
            { value: '2x3', label: '2 × 3 (2열 3행 · 최대 6장)' },
            { value: '2x4', label: '2 × 4 (2열 4행 · 최대 8장)' }
        ]
        : [
            { value: 'auto', label: '자동 맞춤 (사진 개수 기준)' },
            { value: '1x1', label: '1 × 1 (1열 1행 · 최대 1장)' },
            { value: '2x1', label: '2 × 1 (2열 1행 · 좌우 2장)' },
            { value: '1x2', label: '1 × 2 (1열 2행 · 상하 2장)' },
            { value: '3x1', label: '3 × 1 (3열 1행 · 최대 3장)' },
            { value: '2x2', label: '2 × 2 (2열 2행 · 최대 4장)' },
            { value: '4x1', label: '4 × 1 (4열 1행 · 최대 4장)' },
            { value: '3x2', label: '3 × 2 (3열 2행 · 최대 6장)' },
            { value: '4x2', label: '4 × 2 (4열 2행 · 최대 8장)' }
        ];

    gridLayoutSelect.innerHTML = presets
        .map(p => `<option value="${p.value}">${p.label}</option>`)
        .join('');

    const exists = presets.some(p => p.value === currentVal);
    state.layoutMode = exists ? currentVal : 'auto';
    gridLayoutSelect.value = state.layoutMode;
}

// --------------------------------------------------------------------------
// 초기화 및 이벤트 바인딩
// --------------------------------------------------------------------------
function init() {
    bindEvents();
    populateLayoutOptions();
    loadSheetList();
}

function bindEvents() {
    // 목록 <-> 에디터 전환
    document.getElementById('createNewBtn').addEventListener('click', createNewSheet);
    document.getElementById('backToListBtn').addEventListener('click', () => {
        editorView.classList.add('hidden');
        listView.classList.remove('hidden');
        loadSheetList();
    });

    // 검색 필터
    searchInput.addEventListener('input', () => {
        renderSheetList(allSavedDocs);
    });

    // 저장 / 복사본 저장 / 인쇄
    document.getElementById('saveBtn').addEventListener('click', saveSheet);
    document.getElementById('saveCopyBtn').addEventListener('click', saveAsCopy);
    document.getElementById('printBtn').addEventListener('click', () => {
        syncPrintPageRule();
        window.print();
    });

    // 제목 및 날짜 실시간 반영
    sheetTitleInput.addEventListener('input', (e) => {
        state.title = e.target.value;
        previewTitle.textContent = state.title.trim() || '제목을 입력하세요';
    });

    sheetDateInput.addEventListener('input', (e) => {
        state.docDate = e.target.value;
        previewDate.textContent = state.docDate;
    });

    showDateCheck.addEventListener('change', (e) => {
        state.showDate = e.target.checked;
        previewDateWrap.style.display = state.showDate ? '' : 'none';
    });

    // 용지 방향 (A4 세로 / 가로) 전환
    orientationGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.orientation = btn.dataset.orientation;
            state.layoutMode = 'auto';
            populateLayoutOptions();
            renderControlsState();
            renderPreviewSheet();
        });
    });

    // 배치 구성 선택
    gridLayoutSelect.addEventListener('change', (e) => {
        state.layoutMode = e.target.value;
        renderPreviewSheet();
    });

    // 사진 리사이즈 맞춤 방식 (contain vs cover)
    fitModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.fitMode = btn.dataset.fit;
            renderControlsState();
            renderPreviewSheet();
        });
    });

    // 테두리 및 사진 번호 표시 옵션
    showBorderCheck.addEventListener('change', (e) => {
        state.showBorder = e.target.checked;
        renderPreviewSheet();
    });

    showIndexCheck.addEventListener('change', (e) => {
        state.showIndex = e.target.checked;
        renderPreviewSheet();
    });

    // 전체 사진 삭제
    document.getElementById('clearAllPhotosBtn').addEventListener('click', async () => {
        if (state.photos.length === 0) return;
        if (!confirm('업로드된 사진을 모두 비우시겠습니까?')) return;
        const urls = state.photos.map(p => p.url);
        state.photos = [];
        renderPhotoList();
        renderPreviewSheet();
        for (const u of urls) {
            deleteServerFileSilent(u);
        }
    });

    // 파일 업로드 드롭존 (클릭 & 드래그 앤 드롭)
    uploadDropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            await handleFilesUpload(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    [uploadDropzone, a4Sheet].forEach(zone => {
        zone.addEventListener('dragover', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                uploadDropzone.classList.add('dragover');
            }
        });
        zone.addEventListener('dragleave', () => {
            uploadDropzone.classList.remove('dragover');
        });
        zone.addEventListener('drop', async (e) => {
            uploadDropzone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                await handleFilesUpload(Array.from(e.dataTransfer.files));
            }
        });
    });

    // 에디터 화면 어디서든 Ctrl+V 클립보드 이미지 붙여넣기 지원
    window.addEventListener('paste', async (e) => {
        if (editorView.classList.contains('hidden')) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        const imageFiles = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const file = items[i].getAsFile();
                if (file) imageFiles.push(file);
            }
        }
        if (imageFiles.length > 0) {
            e.preventDefault();
            await handleFilesUpload(imageFiles);
        }
    });
}

// --------------------------------------------------------------------------
// 서버 API 연동: 목록 조회 / 열기 / 저장 / 복사 / 삭제
// --------------------------------------------------------------------------
async function loadSheetList() {
    sheetList.innerHTML = `<div class="ps-empty-state"><i class='bx bx-loader-alt bx-spin'></i> 저장된 사진 대지 목록을 불러오는 중...</div>`;
    try {
        const res = await authFetch(API_BASE);
        if (!res.ok) throw new Error('목록 조회 실패');
        const rawList = await res.json();

        // [PS]:: 프리픽스가 붙은 현장 사진 대지 문서만 필터링
        const psDocs = rawList.filter(item => String(item.title || '').startsWith(DOC_PREFIX));

        // 각 문서의 상세 정보를 병렬로 가져와 썸네일/장수/방향 표시
        const detailedDocs = await Promise.all(
            psDocs.map(async (item) => {
                try {
                    const detailRes = await authFetch(`${API_BASE}/${item.id}`);
                    if (detailRes.ok) {
                        const fullDoc = await detailRes.json();
                        const parsed = parseContentJson(fullDoc.content_json);
                        return { ...item, parsed };
                    }
                } catch (e) {}
                return { ...item, parsed: null };
            })
        );

        allSavedDocs = detailedDocs;
        renderSheetList(allSavedDocs);
    } catch (err) {
        console.error(err);
        sheetList.innerHTML = `<div class="ps-empty-state" style="color: #dc2626;">목록을 불러오는 중 오류가 발생했습니다.</div>`;
    }
}

function renderSheetList(docs) {
    const keyword = (searchInput.value || '').trim().toLowerCase();
    const filtered = docs.filter(item => {
        const cleanTitle = stripPrefix(item.title).toLowerCase();
        return !keyword || cleanTitle.includes(keyword);
    });

    sheetList.innerHTML = '';
    if (filtered.length === 0) {
        sheetList.innerHTML = `
            <div class="ps-empty-state">
                <i class='bx bx-images' style="font-size: 36px; display: block; margin-bottom: 8px; color: #94a3b8;"></i>
                저장된 현장 사진 대지가 없습니다.<br>
                우측 상단의 <b>[+ 새 사진 대지 작성]</b> 버튼을 눌러 시작해보세요.
            </div>
        `;
        return;
    }

    filtered.forEach(item => {
        const cleanTitle = stripPrefix(item.title) || '제목 없음';
        const updatedDate = item.updatedAt ? new Date(item.updatedAt).toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }) : '-';

        const parsed = item.parsed || {};
        const photos = parsed.photos || [];
        const orientation = parsed.orientation === 'landscape' ? 'landscape' : 'portrait';
        const grid = computeAutoGrid(photos.length, orientation);
        const orientLabel = orientation === 'landscape' ? 'A4 가로' : 'A4 세로';
        const gridLabel = photos.length > 0 ? `${grid.cols}×${grid.rows}` : '-';

        const previewPhotos = photos.slice(0, 4);
        const thumbClass = `thumbs-${Math.max(1, previewPhotos.length)}`;

        let thumbHtml = '';
        if (previewPhotos.length === 0) {
            thumbHtml = `<div class="ps-doc-thumb-empty"><i class='bx bx-image'></i> 사진 없음</div>`;
        } else {
            thumbHtml = previewPhotos
                .map(p => `<img src="${getImgSrc(p.url)}" alt="썸네일" loading="lazy">`)
                .join('');
        }

        const card = document.createElement('div');
        card.className = 'ps-doc-card';
        card.innerHTML = `
            <div class="ps-doc-thumb-grid ${thumbClass}">
                ${thumbHtml}
                <div class="ps-doc-badges">
                    <span class="ps-mini-badge">${orientLabel} (${gridLabel})</span>
                    <span class="ps-mini-badge">${photos.length}장</span>
                </div>
            </div>
            <div class="ps-doc-body">
                <div>
                    <h3 class="ps-doc-title">${escapeHtml(cleanTitle)}</h3>
                    <p class="ps-doc-meta">최종 수정: ${updatedDate}</p>
                </div>
                <div class="ps-doc-actions">
                    <button type="button" class="btn-ps-outline btn-ps-sm btn-quick-print" title="열어서 바로 인쇄">
                        <i class='bx bx-printer'></i> 인쇄
                    </button>
                    <button type="button" class="btn-ps-danger-sm btn-delete-doc" title="문서 삭제">
                        <i class='bx bx-trash'></i> 삭제
                    </button>
                </div>
            </div>
        `;

        card.addEventListener('click', () => openSheet(item.id, false));
        card.querySelector('.btn-quick-print').addEventListener('click', (e) => {
            e.stopPropagation();
            openSheet(item.id, true);
        });
        card.querySelector('.btn-delete-doc').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSheet(item.id, cleanTitle);
        });

        sheetList.appendChild(card);
    });
}

function parseContentJson(rawJson) {
    try {
        const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : (rawJson || {});
        const photos = Array.isArray(data.photos) ? data.photos : [];
        // 서버 /copy 실행 시 rows[0].col_photos 안의 파일 경로가 복제된 새 파일 경로로 바뀌므로 동기화
        if (data.rows && data.rows[0] && Array.isArray(data.rows[0].col_photos)) {
            data.rows[0].col_photos.forEach((copiedUrl, idx) => {
                if (photos[idx] && copiedUrl) {
                    photos[idx].url = copiedUrl;
                }
            });
        }
        return {
            orientation: data.orientation === 'landscape' ? 'landscape' : 'portrait',
            layoutMode: data.layoutMode || 'auto',
            fitMode: data.fitMode === 'cover' ? 'cover' : 'contain',
            showDate: data.showDate !== undefined ? Boolean(data.showDate) : true,
            docDate: data.docDate || getTodayString(),
            showBorder: data.showBorder !== undefined ? Boolean(data.showBorder) : true,
            showIndex: Boolean(data.showIndex),
            photos: photos.slice(0, MAX_PHOTOS).map(p => ({
                id: p.id || generateId(),
                url: p.url || '',
                caption: p.caption || ''
            }))
        };
    } catch (e) {
        return {
            orientation: 'portrait',
            layoutMode: 'auto',
            fitMode: 'contain',
            showDate: true,
            docDate: getTodayString(),
            showBorder: true,
            showIndex: false,
            photos: []
        };
    }
}

function serializeContentJson() {
    // columns & rows 필드를 함께 넣어두면 기존 백엔드의 /copy 라우트가 물리적 이미지 파일까지 완벽히 복제함
    return JSON.stringify({
        docType: 'photo_sheet',
        orientation: state.orientation,
        layoutMode: state.layoutMode,
        fitMode: state.fitMode,
        showDate: state.showDate,
        docDate: state.docDate,
        showBorder: state.showBorder,
        showIndex: state.showIndex,
        photos: state.photos,
        columns: [{ id: 'col_photos', name: '사진', type: 'image' }],
        rows: [{ id: 'row_photos', col_photos: state.photos.map(p => p.url) }]
    });
}

function createNewSheet() {
    state = {
        currentDocId: null,
        title: '',
        docDate: getTodayString(),
        showDate: true,
        orientation: 'portrait',
        layoutMode: 'auto',
        fitMode: 'contain',
        showBorder: true,
        showIndex: false,
        photos: []
    };

    document.getElementById('saveCopyBtn').style.display = 'none';
    listView.classList.add('hidden');
    editorView.classList.remove('hidden');

    populateLayoutOptions();
    renderControlsState();
    renderPhotoList();
    renderPreviewSheet();
}

async function openSheet(id, autoPrint = false) {
    showLoading(true, '사진 대지를 불러오는 중...');
    try {
        const res = await authFetch(`${API_BASE}/${id}`);
        if (!res.ok) throw new Error('문서 로드 실패');
        const doc = await res.json();
        const parsed = parseContentJson(doc.content_json);

        state = {
            currentDocId: doc.id,
            title: stripPrefix(doc.title),
            ...parsed
        };

        document.getElementById('saveCopyBtn').style.display = 'inline-flex';
        listView.classList.add('hidden');
        editorView.classList.remove('hidden');

        populateLayoutOptions();
        renderControlsState();
        renderPhotoList();
        renderPreviewSheet();

        if (autoPrint) {
            setTimeout(() => {
                syncPrintPageRule();
                window.print();
            }, 350);
        }
    } catch (err) {
        console.error(err);
        alert('문서를 불러올 수 없습니다.');
    } finally {
        showLoading(false);
    }
}

async function saveSheet() {
    showLoading(true, '서버에 저장하는 중...');
    const payload = {
        title: addPrefix(state.title),
        content_json: serializeContentJson()
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
        document.getElementById('saveCopyBtn').style.display = 'inline-flex';
        showToast('서버에 안전하게 저장되었습니다.');
    } catch (err) {
        console.error(err);
        alert('저장 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

async function saveAsCopy() {
    if (!state.currentDocId) return;
    showLoading(true, '복사본을 생성하는 중...');
    const copyCleanTitle = `[복사본] ${state.title || '제목 없는 사진 대지'}`;
    const payload = {
        title: addPrefix(state.title),
        content_json: serializeContentJson()
    };
    try {
        const res = await authFetch(`${API_BASE}/copy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('복사 실패');
        const data = await res.json();
        if (data.id) {
            // 복제된 문서의 새 이미지 파일 URL을 먼저 조회하여 보존한 뒤 제목 프리픽스([PS]::) 정규화
            const copiedRes = await authFetch(`${API_BASE}/${data.id}`);
            let syncedContentJson = serializeContentJson();
            if (copiedRes.ok) {
                const copiedDoc = await copiedRes.json();
                const copiedParsed = parseContentJson(copiedDoc.content_json);
                state.photos = copiedParsed.photos;
                syncedContentJson = serializeContentJson();
            }
            await authFetch(`${API_BASE}/${data.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: addPrefix(copyCleanTitle),
                    content_json: syncedContentJson
                })
            });
            await openSheet(data.id, false);
        }
        showToast('복사본으로 저장되었습니다.');
    } catch (err) {
        console.error(err);
        alert('복사본 저장 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

async function deleteSheet(id, titleText) {
    if (!confirm(`'${titleText}' 사진 대지를 삭제하시겠습니까?`)) return;
    showLoading(true, '삭제하는 중...');
    try {
        // 삭제 전 포함된 이미지 파일도 정리
        try {
            const detailRes = await authFetch(`${API_BASE}/${id}`);
            if (detailRes.ok) {
                const fullDoc = await detailRes.json();
                const parsed = parseContentJson(fullDoc.content_json);
                for (const p of (parsed.photos || [])) {
                    deleteServerFileSilent(p.url);
                }
            }
        } catch (e) {}

        const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('삭제 실패');
        showToast('삭제되었습니다.');
        await loadSheetList();
    } catch (err) {
        console.error(err);
        alert('삭제 중 오류가 발생했습니다.');
    } finally {
        showLoading(false);
    }
}

async function deleteServerFileSilent(url) {
    if (!url) return;
    try {
        await authFetch(`${API_BASE}/file`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
    } catch (e) {}
}

// --------------------------------------------------------------------------
// 이미지 압축 및 업로드 (최대 8장)
// --------------------------------------------------------------------------
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
                let originalName = file.name || 'photo.png';
                originalName = originalName.replace(/\.[^/.]+$/, '') + '.jpg';
                const compressedFile = new File([blob], originalName, { type: 'image/jpeg' });
                resolve(compressedFile);
            }, 'image/jpeg', 0.85);
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };
        img.src = objectUrl;
    });
}

async function handleFilesUpload(files) {
    const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const remainingSlots = MAX_PHOTOS - state.photos.length;
    if (remainingSlots <= 0) {
        alert(`사진은 한 페이지당 최대 ${MAX_PHOTOS}장까지만 올릴 수 있습니다.`);
        return;
    }

    let targetFiles = imageFiles;
    if (imageFiles.length > remainingSlots) {
        alert(`최대 ${MAX_PHOTOS}장 제한으로 인해 앞의 ${remainingSlots}장만 추가됩니다.`);
        targetFiles = imageFiles.slice(0, remainingSlots);
    }

    showLoading(true, `사진 업로드 및 자동 리사이징 중 (0/${targetFiles.length})...`);
    try {
        for (let i = 0; i < targetFiles.length; i++) {
            showLoading(true, `사진 업로드 및 자동 리사이징 중 (${i + 1}/${targetFiles.length})...`);
            const compressed = await compressImage(targetFiles[i]);
            const formData = new FormData();
            formData.append('image', compressed, compressed.name);

            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`업로드 실패 (${res.status}): ${errText}`);
            }
            const data = await res.json();
            state.photos.push({
                id: generateId(),
                url: data.url,
                caption: ''
            });
        }
        renderPhotoList();
        renderPreviewSheet();
        showToast(`사진 ${targetFiles.length}장이 추가되었습니다.`);
    } catch (err) {
        console.error(err);
        alert(`사진 업로드 중 오류가 발생했습니다.\n${err.message}`);
    } finally {
        showLoading(false);
    }
}

// --------------------------------------------------------------------------
// UI 렌더링 (좌측 컨트롤 / 사진 리스트 / 우측 실시간 A4 시트)
// --------------------------------------------------------------------------
function renderControlsState() {
    sheetTitleInput.value = state.title;
    sheetDateInput.value = state.docDate;
    showDateCheck.checked = state.showDate;
    showBorderCheck.checked = state.showBorder;
    showIndexCheck.checked = state.showIndex;

    orientationGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.orientation === state.orientation);
    });

    fitModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fit === state.fitMode);
    });

    gridLayoutSelect.value = state.layoutMode;
}

function renderPhotoList() {
    photoItemList.innerHTML = '';

    state.photos.forEach((photo, idx) => {
        const item = document.createElement('div');
        item.className = 'ps-photo-item';
        item.draggable = true;

        item.innerHTML = `
            <div class="ps-photo-drag" title="드래그하여 순서 변경"><i class='bx bx-grid-vertical'></i></div>
            <div class="ps-photo-num">${idx + 1}</div>
            <img class="ps-photo-thumb" src="${getImgSrc(photo.url)}" alt="사진 ${idx + 1}">
            <div class="ps-photo-caption-wrap">
                <input type="text" class="ps-photo-caption-input" placeholder="사진 ${idx + 1} 한 줄 메모 (선택사항)" value="${escapeHtml(photo.caption || '')}">
            </div>
            <button type="button" class="ps-photo-remove-btn" title="이 사진 삭제"><i class='bx bx-x'></i></button>
        `;

        // 캡션 실시간 업데이트 (포커스 유지)
        const captionInput = item.querySelector('.ps-photo-caption-input');
        captionInput.addEventListener('input', (e) => {
            photo.caption = e.target.value;
            updateCaptionOnPreview(idx, photo.caption);
        });

        // 개별 사진 삭제
        item.querySelector('.ps-photo-remove-btn').addEventListener('click', async () => {
            const removed = state.photos.splice(idx, 1)[0];
            renderPhotoList();
            renderPreviewSheet();
            if (removed && removed.url) {
                deleteServerFileSilent(removed.url);
            }
        });

        // 드래그 앤 드롭 순서 변경
        item.addEventListener('dragstart', (e) => {
            draggedPhotoIndex = idx;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => item.classList.add('dragging'), 0);
        });
        item.addEventListener('dragover', (e) => {
            if (draggedPhotoIndex === null) return;
            e.preventDefault();
            item.classList.add('drag-over');
        });
        item.addEventListener('dragleave', () => {
            item.classList.remove('drag-over');
        });
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            if (draggedPhotoIndex !== null && draggedPhotoIndex !== idx) {
                const moved = state.photos.splice(draggedPhotoIndex, 1)[0];
                state.photos.splice(idx, 0, moved);
                draggedPhotoIndex = null;
                renderPhotoList();
                renderPreviewSheet();
            }
        });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedPhotoIndex = null;
        });

        photoItemList.appendChild(item);
    });
}

function updateCaptionOnPreview(idx, captionText) {
    const cells = sheetPhotoGrid.querySelectorAll('.sheet-photo-cell');
    const cell = cells[idx];
    if (!cell) return;
    const capEl = cell.querySelector('.sheet-photo-caption');
    if (!capEl) return;
    const trimmed = (captionText || '').trim();
    capEl.textContent = trimmed;
    capEl.classList.toggle('empty-caption', trimmed.length === 0);
}

function syncPrintPageRule() {
    const pageOrient = state.orientation === 'landscape' ? 'landscape' : 'portrait';
    dynamicPageStyle.textContent = `
        @media print {
            @page {
                size: A4 ${pageOrient};
                margin: 0;
            }
        }
    `;
}

function renderPreviewSheet() {
    syncPrintPageRule();

    // 1. 상단 배지 업데이트
    const count = state.photos.length;
    const { cols, rows } = getEffectiveGrid();
    const orientName = state.orientation === 'landscape' ? 'A4 가로' : 'A4 세로';

    photoCountBadge.textContent = `${count} / ${MAX_PHOTOS}장`;
    currentGridBadge.textContent = count > 0
        ? `${orientName} · ${cols} × ${rows} 배치 (${cols}열 ${rows}행)`
        : `${orientName} · 사진 대기 중`;

    // 2. A4 시트 클래스 및 헤더 동기화
    a4Sheet.className = [
        'a4-sheet',
        state.orientation === 'landscape' ? 'landscape' : 'portrait',
        state.showBorder ? 'show-border' : '',
        state.showIndex ? 'show-index' : '',
        state.fitMode === 'cover' ? 'fit-cover' : 'fit-contain'
    ].filter(Boolean).join(' ');

    previewTitle.textContent = (state.title || '').trim() || '제목을 입력하세요';
    previewDate.textContent = state.docDate || getTodayString();
    previewDateWrap.style.display = state.showDate ? '' : 'none';

    // 3. 그리드 CSS 변수 설정 (--cols, --rows)
    sheetPhotoGrid.style.setProperty('--cols', cols);
    sheetPhotoGrid.style.setProperty('--rows', rows);
    sheetPhotoGrid.setAttribute('data-cols', cols);
    sheetPhotoGrid.setAttribute('data-rows', rows);

    // 4. 사진 셀 렌더링
    sheetPhotoGrid.innerHTML = '';
    if (count === 0) {
        sheetPhotoGrid.innerHTML = `
            <div class="sheet-empty-placeholder no-print">
                <i class='bx bx-images'></i>
                <div>좌측에서 사진을 선택하거나 <b>Ctrl + V</b>로 붙여넣으면</div>
                <div>사진 개수에 맞춰 A4 1장에 자동으로 리사이즈 배치됩니다. (최대 8장)</div>
            </div>
        `;
        return;
    }

    state.photos.forEach((photo, idx) => {
        const cell = document.createElement('div');
        cell.className = 'sheet-photo-cell';
        cell.draggable = true;

        const trimmedCap = (photo.caption || '').trim();
        cell.innerHTML = `
            <div class="sheet-photo-frame">
                <span class="sheet-photo-index">${idx + 1}</span>
                <img src="${getImgSrc(photo.url)}" alt="사진 ${idx + 1}">
            </div>
            <div class="sheet-photo-caption ${trimmedCap ? '' : 'empty-caption'}">${escapeHtml(trimmedCap)}</div>
        `;

        // 미리보기 시트 위에서도 드래그로 두 사진의 위치를 서로 바꿀 수 있도록 지원
        cell.addEventListener('dragstart', (e) => {
            draggedPhotoIndex = idx;
            e.dataTransfer.effectAllowed = 'move';
        });
        cell.addEventListener('dragover', (e) => {
            if (draggedPhotoIndex === null || draggedPhotoIndex === idx) return;
            e.preventDefault();
            cell.classList.add('drag-over-cell');
        });
        cell.addEventListener('dragleave', () => {
            cell.classList.remove('drag-over-cell');
        });
        cell.addEventListener('drop', (e) => {
            cell.classList.remove('drag-over-cell');
            if (draggedPhotoIndex !== null && draggedPhotoIndex !== idx) {
                e.preventDefault();
                e.stopPropagation();
                // 두 사진 위치 맞바꾸기 (Swap)
                const temp = state.photos[draggedPhotoIndex];
                state.photos[draggedPhotoIndex] = state.photos[idx];
                state.photos[idx] = temp;
                draggedPhotoIndex = null;
                renderPhotoList();
                renderPreviewSheet();
            }
        });
        cell.addEventListener('dragend', () => {
            cell.classList.remove('drag-over-cell');
            draggedPhotoIndex = null;
        });

        sheetPhotoGrid.appendChild(cell);
    });
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 실행
init();
