/**
 * ==========================================================================
 * 현장 사진 대지 (A4 Auto Photo Sheet) Controller (v2)
 * - 제목 + 최대 8장 사진 업로드 시 A4 세로(1×1 ~ 2×4) / 가로(1×1 ~ 4×2) 자동 리사이즈
 * - 동영상 스마트 핵심 장면 추출 (Laplacian 선명도 + 장면 전환 분석) 및 수동 0.1초 단위 캡처
 * - 대용량 동영상 청크 분할 업로드 + 서버 FFmpeg 모바일 경량화 + A4 우측 상단 QR 코드 생성
 * ==========================================================================
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000/api/report-builder`
    : 'https://kng.junparks.com/api/report-builder';

const DOC_PREFIX = '[PS]::';
const MAX_PHOTOS = 8;
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB 단위 분할 업로드 (Cloudflare 100MB 제한 완벽 우회)

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
    showQr: true,            // 우측 상단 QR 코드 표시 여부
    videoServerUrl: '',      // 서버에 업로드된 동영상 경로 (/api/report-builder/uploads/...)
    externalVideoUrl: '',    // 유튜브/드라이브 등 외부 동영상 URL
    qrLabel: '현장 영상 보기',
    photos: []               // [{ id, url, caption }]
};

let allSavedDocs = [];
let draggedPhotoIndex = null;

// 동영상 추출 모달 상태
let currentVideoFile = null;
let currentVideoObjectUrl = null;
let extractedFrames = []; // [{ id, blob, dataUrl, timeSec, timeLabel, sharpness }]
let isExtractingSmart = false;

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

const showQrCheck = document.getElementById('showQrCheck');
const videoServerStatusBox = document.getElementById('videoServerStatusBox');
const previewServerVideoLink = document.getElementById('previewServerVideoLink');
const removeServerVideoBtn = document.getElementById('removeServerVideoBtn');
const externalVideoUrlInput = document.getElementById('externalVideoUrlInput');
const qrLabelInput = document.getElementById('qrLabelInput');

const uploadDropzone = document.getElementById('uploadDropzone');
const fileInput = document.getElementById('fileInput');
const videoOnlyInput = document.getElementById('videoOnlyInput');
const openVideoExtractorBtn = document.getElementById('openVideoExtractorBtn');
const photoItemList = document.getElementById('photoItemList');
const photoCountBadge = document.getElementById('photoCountBadge');
const currentGridBadge = document.getElementById('currentGridBadge');

const a4Sheet = document.getElementById('a4Sheet');
const previewTitle = document.getElementById('previewTitle');
const previewDateWrap = document.getElementById('previewDateWrap');
const previewDate = document.getElementById('previewDate');
const sheetQrBox = document.getElementById('sheetQrBox');
const qrCanvasContainer = document.getElementById('qrCanvasContainer');
const previewQrLabel = document.getElementById('previewQrLabel');
const sheetPhotoGrid = document.getElementById('sheetPhotoGrid');
const dynamicPageStyle = document.getElementById('dynamicPageStyle');

// 동영상 추출 모달 DOM
const videoExtractModal = document.getElementById('videoExtractModal');
const videoFileNameBadge = document.getElementById('videoFileNameBadge');
const extractVideoPlayer = document.getElementById('extractVideoPlayer');
const videoTimeDisplay = document.getElementById('videoTimeDisplay');
const autoExtractCountSelect = document.getElementById('autoExtractCountSelect');
const runSmartExtractBtn = document.getElementById('runSmartExtractBtn');
const smartExtractProgressWrap = document.getElementById('smartExtractProgressWrap');
const smartExtractProgressBar = document.getElementById('smartExtractProgressBar');
const smartExtractProgressText = document.getElementById('smartExtractProgressText');
const extractedFramesTray = document.getElementById('extractedFramesTray');
const trayCountText = document.getElementById('trayCountText');
const autoTimestampCaptionCheck = document.getElementById('autoTimestampCaptionCheck');
const uploadVideoForQrCheck = document.getElementById('uploadVideoForQrCheck');

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

function formatTimeMMSS(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${mm}:${ss}`;
}

function formatTimeDetailed(sec) {
    const s = Math.max(0, Number(sec || 0));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${mm}:${rem}`;
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

function isVideoFile(file) {
    if (!file) return false;
    if (file.type && file.type.startsWith('video/')) return true;
    const ext = (file.name || '').split('.').pop().toLowerCase();
    return ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', '3gp'].includes(ext);
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
        if (n === 1) return { cols: 1, rows: 1 };
        if (n === 2) return { cols: 1, rows: 2 };
        if (n <= 4)  return { cols: 2, rows: 2 };
        if (n <= 6)  return { cols: 2, rows: 3 };
        return { cols: 2, rows: 4 };
    } else {
        if (n === 1) return { cols: 1, rows: 1 };
        if (n === 2) return { cols: 2, rows: 1 };
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
    bindVideoExtractorEvents();
    populateLayoutOptions();
    loadSheetList();
}

function bindEvents() {
    document.getElementById('createNewBtn').addEventListener('click', createNewSheet);
    document.getElementById('backToListBtn').addEventListener('click', () => {
        editorView.classList.add('hidden');
        listView.classList.remove('hidden');
        loadSheetList();
    });

    searchInput.addEventListener('input', () => {
        renderSheetList(allSavedDocs);
    });

    document.getElementById('saveBtn').addEventListener('click', saveSheet);
    document.getElementById('saveCopyBtn').addEventListener('click', saveAsCopy);
    document.getElementById('printBtn').addEventListener('click', () => {
        syncPrintPageRule();
        window.print();
    });

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

    orientationGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.orientation = btn.dataset.orientation;
            state.layoutMode = 'auto';
            populateLayoutOptions();
            renderControlsState();
            renderPreviewSheet();
        });
    });

    gridLayoutSelect.addEventListener('change', (e) => {
        state.layoutMode = e.target.value;
        renderPreviewSheet();
    });

    fitModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.fitMode = btn.dataset.fit;
            renderControlsState();
            renderPreviewSheet();
        });
    });

    showBorderCheck.addEventListener('change', (e) => {
        state.showBorder = e.target.checked;
        renderPreviewSheet();
    });

    showIndexCheck.addEventListener('change', (e) => {
        state.showIndex = e.target.checked;
        renderPreviewSheet();
    });

    // QR 코드 관련 이벤트
    showQrCheck.addEventListener('change', (e) => {
        state.showQr = e.target.checked;
        renderQrCodeOnSheet();
    });

    externalVideoUrlInput.addEventListener('input', (e) => {
        state.externalVideoUrl = e.target.value.trim();
        renderQrCodeOnSheet();
    });

    qrLabelInput.addEventListener('input', (e) => {
        state.qrLabel = e.target.value;
        previewQrLabel.textContent = state.qrLabel.trim() || '현장 영상 보기';
    });

    removeServerVideoBtn.addEventListener('click', async () => {
        if (!state.videoServerUrl) return;
        if (!confirm('연결된 서버 동영상을 삭제하시겠습니까?')) return;
        const oldUrl = state.videoServerUrl;
        state.videoServerUrl = '';
        renderControlsState();
        renderQrCodeOnSheet();
        deleteServerFileSilent(oldUrl);
        showToast('서버 동영상이 삭제되었습니다.');
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

    // 파일 업로드 드롭존 (사진 & 동영상 자동 분기)
    uploadDropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files && e.target.files.length > 0) {
            await handleIncomingFiles(Array.from(e.target.files));
            fileInput.value = '';
        }
    });

    openVideoExtractorBtn.addEventListener('click', () => videoOnlyInput.click());
    videoOnlyInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            openVideoExtractorModal(e.target.files[0]);
            videoOnlyInput.value = '';
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
                await handleIncomingFiles(Array.from(e.dataTransfer.files));
            }
        });
    });

    // 에디터 화면 어디서든 Ctrl+V 클립보드 붙여넣기 지원
    window.addEventListener('paste', async (e) => {
        if (editorView.classList.contains('hidden')) return;
        if (!videoExtractModal.classList.contains('hidden')) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        const pastedFiles = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('video') !== -1) {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(file);
            }
        }
        if (pastedFiles.length > 0) {
            e.preventDefault();
            await handleIncomingFiles(pastedFiles);
        }
    });
}

async function handleIncomingFiles(files) {
    const videoFile = files.find(f => isVideoFile(f));
    const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));

    if (imageFiles.length > 0) {
        await handleFilesUpload(imageFiles);
    }
    if (videoFile) {
        openVideoExtractorModal(videoFile);
    }
}

// --------------------------------------------------------------------------
// 동영상 스마트 장면 추출기 & 수동 핀포인트 캡처 모달 로직
// --------------------------------------------------------------------------
function bindVideoExtractorEvents() {
    document.getElementById('closeVideoModalBtn').addEventListener('click', closeVideoExtractorModal);
    document.getElementById('cancelVideoModalBtn').addEventListener('click', closeVideoExtractorModal);

    extractVideoPlayer.addEventListener('timeupdate', updateVideoTimeBadge);
    extractVideoPlayer.addEventListener('loadedmetadata', updateVideoTimeBadge);

    // 0.1초 / 1.0초 단위 미세 이동 버튼
    document.querySelectorAll('.btn-step').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseFloat(btn.dataset.seek || '0');
            if (!isNaN(delta) && extractVideoPlayer.duration) {
                extractVideoPlayer.pause();
                extractVideoPlayer.currentTime = Math.max(0, Math.min(extractVideoPlayer.duration - 0.05, extractVideoPlayer.currentTime + delta));
            }
        });
    });

    // 수동 현재 장면 캡처
    document.getElementById('captureCurrentFrameBtn').addEventListener('click', async () => {
        if (extractedFrames.length >= MAX_PHOTOS) {
            alert(`한 페이지에 최대 ${MAX_PHOTOS}장까지만 담을 수 있습니다.`);
            return;
        }
        extractVideoPlayer.pause();
        const frameObj = await captureHighResFrameAtCurrentTime(extractVideoPlayer);
        if (frameObj) {
            extractedFrames.push(frameObj);
            renderExtractedTray();
            showToast(`[${frameObj.timeLabel}] 장면이 담겼습니다.`);
        }
    });

    // AI 스마트 핵심 장면 자동 추출 실행
    runSmartExtractBtn.addEventListener('click', () => {
        runSmartFrameExtraction();
    });

    // 트레이 비우기
    document.getElementById('clearTrayBtn').addEventListener('click', () => {
        extractedFrames = [];
        renderExtractedTray();
    });

    // 선택한 장면 사진 대지에 반영하기 (+ 동영상 서버 업로드 & QR 생성)
    document.getElementById('applyExtractedFramesBtn').addEventListener('click', () => {
        applyExtractedFramesToSheet();
    });
}

function openVideoExtractorModal(videoFile) {
    currentVideoFile = videoFile;
    if (currentVideoObjectUrl) {
        URL.revokeObjectURL(currentVideoObjectUrl);
    }
    currentVideoObjectUrl = URL.createObjectURL(videoFile);
    extractVideoPlayer.src = currentVideoObjectUrl;
    videoFileNameBadge.textContent = `${videoFile.name} (${(videoFile.size / (1024 * 1024)).toFixed(1)} MB)`;

    extractedFrames = [];
    renderExtractedTray();
    smartExtractProgressWrap.classList.add('hidden');

    // 남은 사진 슬롯에 맞춰 기본 추출 장수 선택
    const remaining = Math.max(1, MAX_PHOTOS - state.photos.length);
    if (remaining >= 8) autoExtractCountSelect.value = '4';
    else if (remaining >= 6) autoExtractCountSelect.value = '6';
    else if (remaining >= 4) autoExtractCountSelect.value = '4';
    else autoExtractCountSelect.value = '2';

    videoExtractModal.classList.remove('hidden');
}

function closeVideoExtractorModal() {
    if (isExtractingSmart) return;
    extractVideoPlayer.pause();
    videoExtractModal.classList.add('hidden');
}

function updateVideoTimeBadge() {
    const cur = extractVideoPlayer.currentTime || 0;
    const dur = extractVideoPlayer.duration || 0;
    videoTimeDisplay.textContent = `${formatTimeDetailed(cur)} / ${formatTimeDetailed(dur)}`;
}

function seekVideoTo(videoEl, timeSec) {
    return new Promise((resolve) => {
        const target = Math.max(0, Math.min((videoEl.duration || 1) - 0.05, timeSec));
        const onSeeked = () => {
            videoEl.removeEventListener('seeked', onSeeked);
            resolve();
        };
        videoEl.addEventListener('seeked', onSeeked);
        videoEl.currentTime = target;
    });
}

/**
 * 라플라시안 분산(Laplacian Variance) 기반 선명도(초점/흔들림) 점수 + 이전 프레임과의 장면 차이 계산
 */
function analyzeFrameQuality(videoEl, analysisCanvas, analysisCtx, prevGrayData) {
    const w = 160;
    const h = 90;
    analysisCanvas.width = w;
    analysisCanvas.height = h;
    analysisCtx.drawImage(videoEl, 0, 0, w, h);

    const imgData = analysisCtx.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    let meanLum = 0;

    for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
        const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
        gray[p] = lum;
        meanLum += lum;
    }
    meanLum /= (w * h);

    // 1. Laplacian 2차 미분으로 에지 선명도(Blur 부재) 측정
    let lapSum = 0;
    let lapSqSum = 0;
    let count = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const lap = 4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - w] - gray[idx + w];
            lapSum += lap;
            lapSqSum += lap * lap;
            count++;
        }
    }
    const lapMean = lapSum / count;
    const sharpnessVariance = (lapSqSum / count) - (lapMean * lapMean);

    // 2. 직전 선택 장면과의 장면 변화량(Scene Change) 측정
    let sceneDiff = 30;
    if (prevGrayData && prevGrayData.length === gray.length) {
        let diffSum = 0;
        for (let i = 0; i < gray.length; i++) {
            diffSum += Math.abs(gray[i] - prevGrayData[i]);
        }
        sceneDiff = diffSum / gray.length;
    }

    // 3. 너무 어둡거나(암전) 너무 하얗게 날아간 프레임 감점
    let exposureFactor = 1.0;
    if (meanLum < 22 || meanLum > 238) {
        exposureFactor = 0.35;
    }

    // 장면이 이전 컷과 거의 똑같으면(정지 화면) 감점, 새 장면이면 가산점
    const noveltyFactor = prevGrayData ? Math.min(1.4, Math.max(0.5, sceneDiff / 18)) : 1.0;
    const totalScore = sharpnessVariance * noveltyFactor * exposureFactor;

    return {
        score: totalScore,
        sharpness: Math.round(sharpnessVariance),
        grayData: gray
    };
}

async function captureHighResFrameAtCurrentTime(videoEl) {
    const canvas = document.createElement('canvas');
    let width = videoEl.videoWidth || 1280;
    let height = videoEl.videoHeight || 720;
    const MAX_DIM = 1920;

    if (width > height && width > MAX_DIM) {
        height = Math.round((height * MAX_DIM) / width);
        width = MAX_DIM;
    } else if (height >= width && height > MAX_DIM) {
        width = Math.round((width * MAX_DIM) / height);
        height = MAX_DIM;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
    const timeSec = videoEl.currentTime || 0;

    return {
        id: generateId(),
        blob,
        dataUrl,
        timeSec,
        timeLabel: formatTimeMMSS(timeSec)
    };
}

/**
 * 영상을 N개 구간으로 나누고 각 구간 내 후보 프레임들의 선명도(Laplacian)와 장면 변화를 비교하여
 * 흔들리지 않은 가장 선명한 대표 장면 N장을 자동 추출
 */
async function runSmartFrameExtraction() {
    if (isExtractingSmart) return;
    const duration = extractVideoPlayer.duration;
    if (!duration || duration <= 0) {
        alert('동영상 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    const requestedCount = parseInt(autoExtractCountSelect.value, 10) || 4;
    const maxAllowed = Math.min(MAX_PHOTOS, requestedCount);

    isExtractingSmart = true;
    extractVideoPlayer.pause();
    extractedFrames = [];
    renderExtractedTray();

    smartExtractProgressWrap.classList.remove('hidden');
    smartExtractProgressBar.style.width = '5%';
    smartExtractProgressText.textContent = '구간별 장면 변화 및 초점 선명도 분석 중...';
    runSmartExtractBtn.disabled = true;

    const analysisCanvas = document.createElement('canvas');
    const analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });

    try {
        // 앞뒤 3% 트리밍 (시작/종료 시 카메라 흔들림 구간 배제)
        const startPad = Math.min(0.8, duration * 0.04);
        const endPad = Math.min(0.8, duration * 0.04);
        const usableDuration = Math.max(0.2, duration - startPad - endPad);
        const segmentLen = usableDuration / maxAllowed;
        const candidatesPerSegment = duration > 3 ? 4 : 2;

        let prevBestGray = null;

        for (let segIdx = 0; segIdx < maxAllowed; segIdx++) {
            const segStart = startPad + segIdx * segmentLen;
            let bestCandidateTime = segStart + segmentLen * 0.5;
            let bestScore = -1;
            let bestGray = null;

            for (let c = 0; c < candidatesPerSegment; c++) {
                const ratio = (c + 0.5) / candidatesPerSegment;
                const candTime = segStart + segmentLen * ratio;
                await seekVideoTo(extractVideoPlayer, candTime);

                const result = analyzeFrameQuality(extractVideoPlayer, analysisCanvas, analysisCtx, prevBestGray);
                if (result.score > bestScore) {
                    bestScore = result.score;
                    bestCandidateTime = candTime;
                    bestGray = result.grayData;
                }

                const progressPct = Math.round(((segIdx * candidatesPerSegment + c + 1) / (maxAllowed * candidatesPerSegment)) * 100);
                smartExtractProgressBar.style.width = `${progressPct}%`;
                smartExtractProgressText.textContent = `구간 ${segIdx + 1}/${maxAllowed} 선명도 분석 중 (${progressPct}%)...`;
            }

            prevBestGray = bestGray;

            // 해당 구간에서 가장 선명했던 시점으로 이동하여 고화질 캡처
            await seekVideoTo(extractVideoPlayer, bestCandidateTime);
            const highResFrame = await captureHighResFrameAtCurrentTime(extractVideoPlayer);
            extractedFrames.push(highResFrame);
            renderExtractedTray();
        }

        smartExtractProgressText.textContent = `핵심 장면 ${extractedFrames.length}장 추출 완료!`;
        showToast(`흔들림 없는 핵심 장면 ${extractedFrames.length}장을 추출했습니다.`);
    } catch (err) {
        console.error('스마트 추출 오류:', err);
        alert('장면 추출 중 오류가 발생했습니다.');
    } finally {
        isExtractingSmart = false;
        runSmartExtractBtn.disabled = false;
    }
}

function renderExtractedTray() {
    trayCountText.textContent = String(extractedFrames.length);
    extractedFramesTray.innerHTML = '';

    if (extractedFrames.length === 0) {
        extractedFramesTray.innerHTML = `
            <div class="ps-tray-empty">
                상단의 <b>[핵심 장면 자동 추출 실행]</b>을 누르거나<br>좌측 영상에서 원하는 순간에 <b>[현재 장면 바로 담기]</b>를 눌러주세요.
            </div>
        `;
        return;
    }

    extractedFrames.forEach((frame, idx) => {
        const card = document.createElement('div');
        card.className = 'ps-tray-item';
        card.innerHTML = `
            <img src="${frame.dataUrl}" alt="추출 장면 ${idx + 1}">
            <div class="ps-tray-meta">
                <span>#${idx + 1}</span>
                <span>${frame.timeLabel}</span>
            </div>
            <button type="button" class="ps-tray-del" title="이 장면 제외"><i class='bx bx-x'></i></button>
        `;
        card.querySelector('.ps-tray-del').addEventListener('click', () => {
            extractedFrames.splice(idx, 1);
            renderExtractedTray();
        });
        extractedFramesTray.appendChild(card);
    });
}

async function applyExtractedFramesToSheet() {
    if (extractedFrames.length === 0 && !uploadVideoForQrCheck.checked) {
        alert('추출된 장면이 없습니다. 먼저 장면을 추출하거나 담아주세요.');
        return;
    }

    const remainingSlots = MAX_PHOTOS - state.photos.length;
    const framesToUpload = extractedFrames.slice(0, Math.max(0, remainingSlots));
    const includeTimestamp = autoTimestampCaptionCheck.checked;
    const shouldUploadVideoQr = uploadVideoForQrCheck.checked && currentVideoFile;

    closeVideoExtractorModal();
    showLoading(true, '추출된 장면을 사진 대지에 올리는 중...');

    try {
        // 1. 추출된 프레임 이미지 업로드
        for (let i = 0; i < framesToUpload.length; i++) {
            showLoading(true, `핵심 장면 이미지 저장 중 (${i + 1}/${framesToUpload.length})...`);
            const f = framesToUpload[i];
            const fileObj = new File([f.blob], `video-frame-${i + 1}.jpg`, { type: 'image/jpeg' });
            const formData = new FormData();
            formData.append('image', fileObj, fileObj.name);

            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) throw new Error('장면 이미지 업로드 실패');
            const data = await res.json();

            state.photos.push({
                id: generateId(),
                url: data.url,
                caption: includeTimestamp ? `[${f.timeLabel}]` : ''
            });
        }

        // 2. 동영상 원본 청크 업로드 & 우측 상단 QR 코드 자동 연동
        if (shouldUploadVideoQr) {
            const uploadedVideoUrl = await uploadVideoWithChunkFallback(currentVideoFile);
            if (uploadedVideoUrl) {
                if (state.videoServerUrl) {
                    deleteServerFileSilent(state.videoServerUrl);
                }
                state.videoServerUrl = uploadedVideoUrl;
                state.showQr = true;
            }
        }

        renderControlsState();
        renderPhotoList();
        renderPreviewSheet();
        showToast('추출된 핵심 장면과 동영상 QR 코드가 반영되었습니다.');
    } catch (err) {
        console.error(err);
        alert(`반영 중 오류가 발생했습니다.\n${err.message}`);
    } finally {
        showLoading(false);
    }
}

/**
 * 대용량 동영상을 8MB 단위 청크로 분할 업로드 후 서버 FFmpeg 경량화 실행
 * (만약 서버 도커가 아직 구버전이면 기본 /upload 엔드포인트로 자동 폴백)
 */
async function uploadVideoWithChunkFallback(videoFile) {
    const uploadId = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);

    try {
        for (let idx = 0; idx < totalChunks; idx++) {
            const pct = Math.round(((idx + 1) / totalChunks) * 100);
            showLoading(true, `QR 재생용 동영상 전송 중 (${pct}%)...`);

            const start = idx * CHUNK_SIZE;
            const end = Math.min(videoFile.size, start + CHUNK_SIZE);
            const chunkBlob = videoFile.slice(start, end);

            const fd = new FormData();
            fd.append('uploadId', uploadId);
            fd.append('chunkIndex', String(idx));
            fd.append('chunk', chunkBlob, `chunk_${idx}.part`);

            const chunkRes = await authFetch(`${API_BASE}/video-chunk`, {
                method: 'POST',
                body: fd
            });

            if (chunkRes.status === 404) {
                throw new Error('FALLBACK_LEGACY_UPLOAD');
            }
            if (!chunkRes.ok) {
                throw new Error(`동영상 청크 전송 실패 (${chunkRes.status})`);
            }
        }

        showLoading(true, '모바일 QR 스트리밍용 동영상 최적화 변환 중...');
        const completeRes = await authFetch(`${API_BASE}/video-complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                uploadId,
                originalName: videoFile.name || 'video.mp4'
            })
        });
        if (!completeRes.ok) {
            throw new Error(`동영상 변환 완료 실패 (${completeRes.status})`);
        }
        const data = await completeRes.json();
        return data.url;
    } catch (err) {
        if (err.message === 'FALLBACK_LEGACY_UPLOAD') {
            // 서버가 아직 재시작 전인 경우 기존 /upload 라우트로 직접 업로드
            showLoading(true, 'QR 재생용 동영상 서버 업로드 중...');
            const fd = new FormData();
            fd.append('image', videoFile, videoFile.name || 'video.mp4');
            const legacyRes = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: fd
            });
            if (!legacyRes.ok) {
                throw new Error('동영상 업로드에 실패했습니다 (50MB 이하 파일로 시도해 주세요).');
            }
            const legacyData = await legacyRes.json();
            return legacyData.url;
        }
        throw err;
    }
}

// --------------------------------------------------------------------------
// A4 우측 상단 QR 코드 생성 및 렌더링
// --------------------------------------------------------------------------
function getActiveQrTargetUrl() {
    // 1순위: 사용자가 직접 입력한 외부 영상 URL
    if (state.externalVideoUrl && state.externalVideoUrl.trim()) {
        return state.externalVideoUrl.trim();
    }
    // 2순위: 서버에 업로드된 동영상 -> 모바일 전용 플레이어(watch.html) URL 생성
    if (state.videoServerUrl && state.videoServerUrl.trim()) {
        const filename = state.videoServerUrl.split('/').pop();
        const origin = window.location.origin;
        return `${origin}/05_Management/photo_sheet/watch.html?f=${encodeURIComponent(filename)}`;
    }
    return '';
}

function renderQrCodeOnSheet() {
    const targetUrl = getActiveQrTargetUrl();
    previewQrLabel.textContent = (state.qrLabel || '').trim() || '현장 영상 보기';

    if (!state.showQr || !targetUrl) {
        sheetQrBox.classList.add('hidden');
        qrCanvasContainer.innerHTML = '';
        return;
    }

    sheetQrBox.classList.remove('hidden');
    qrCanvasContainer.innerHTML = '';

    if (typeof window.QRCode === 'function') {
        new window.QRCode(qrCanvasContainer, {
            text: targetUrl,
            width: 128,
            height: 128,
            colorDark: '#0f172a',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.M
        });
    } else {
        const fallbackImg = document.createElement('img');
        fallbackImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(targetUrl)}`;
        fallbackImg.alt = 'QR Code';
        qrCanvasContainer.appendChild(fallbackImg);
    }
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

        const psDocs = rawList.filter(item => String(item.title || '').startsWith(DOC_PREFIX));

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
        const hasVideoQr = Boolean(parsed.showQr && (parsed.videoServerUrl || parsed.externalVideoUrl));

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
                    ${hasVideoQr ? `<span class="ps-mini-badge qr-badge"><i class='bx bx-qr'></i> 영상QR</span>` : ''}
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
        if (data.rows && data.rows[0] && Array.isArray(data.rows[0].col_photos)) {
            data.rows[0].col_photos.forEach((copiedUrl, idx) => {
                if (photos[idx] && copiedUrl) {
                    photos[idx].url = copiedUrl;
                }
            });
        }
        let videoServerUrl = data.videoServerUrl || '';
        if (data.rows && data.rows[0] && Array.isArray(data.rows[0].col_video) && data.rows[0].col_video[0]) {
            videoServerUrl = data.rows[0].col_video[0];
        }

        return {
            orientation: data.orientation === 'landscape' ? 'landscape' : 'portrait',
            layoutMode: data.layoutMode || 'auto',
            fitMode: data.fitMode === 'cover' ? 'cover' : 'contain',
            showDate: data.showDate !== undefined ? Boolean(data.showDate) : true,
            docDate: data.docDate || getTodayString(),
            showBorder: data.showBorder !== undefined ? Boolean(data.showBorder) : true,
            showIndex: Boolean(data.showIndex),
            showQr: data.showQr !== undefined ? Boolean(data.showQr) : true,
            videoServerUrl,
            externalVideoUrl: data.externalVideoUrl || '',
            qrLabel: data.qrLabel !== undefined ? data.qrLabel : '현장 영상 보기',
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
            showQr: true,
            videoServerUrl: '',
            externalVideoUrl: '',
            qrLabel: '현장 영상 보기',
            photos: []
        };
    }
}

function serializeContentJson() {
    return JSON.stringify({
        docType: 'photo_sheet',
        orientation: state.orientation,
        layoutMode: state.layoutMode,
        fitMode: state.fitMode,
        showDate: state.showDate,
        docDate: state.docDate,
        showBorder: state.showBorder,
        showIndex: state.showIndex,
        showQr: state.showQr,
        videoServerUrl: state.videoServerUrl,
        externalVideoUrl: state.externalVideoUrl,
        qrLabel: state.qrLabel,
        photos: state.photos,
        columns: [
            { id: 'col_photos', name: '사진', type: 'image' },
            { id: 'col_video', name: '동영상', type: 'image' }
        ],
        rows: [{
            id: 'row_photos',
            col_photos: state.photos.map(p => p.url),
            col_video: state.videoServerUrl ? [state.videoServerUrl] : []
        }]
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
        showQr: true,
        videoServerUrl: '',
        externalVideoUrl: '',
        qrLabel: '현장 영상 보기',
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
            }, 400);
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
            const copiedRes = await authFetch(`${API_BASE}/${data.id}`);
            let syncedContentJson = serializeContentJson();
            if (copiedRes.ok) {
                const copiedDoc = await copiedRes.json();
                const copiedParsed = parseContentJson(copiedDoc.content_json);
                state.photos = copiedParsed.photos;
                state.videoServerUrl = copiedParsed.videoServerUrl;
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
        try {
            const detailRes = await authFetch(`${API_BASE}/${id}`);
            if (detailRes.ok) {
                const fullDoc = await detailRes.json();
                const parsed = parseContentJson(fullDoc.content_json);
                for (const p of (parsed.photos || [])) {
                    deleteServerFileSilent(p.url);
                }
                if (parsed.videoServerUrl) {
                    deleteServerFileSilent(parsed.videoServerUrl);
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
// 일반 사진 압축 및 업로드 (최대 8장)
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
    showQrCheck.checked = state.showQr;
    externalVideoUrlInput.value = state.externalVideoUrl || '';
    qrLabelInput.value = state.qrLabel || '현장 영상 보기';

    if (state.videoServerUrl) {
        videoServerStatusBox.classList.remove('hidden');
        const filename = state.videoServerUrl.split('/').pop();
        previewServerVideoLink.href = `watch.html?f=${encodeURIComponent(filename)}&t=${encodeURIComponent(state.title || '현장 동영상')}`;
    } else {
        videoServerStatusBox.classList.add('hidden');
        previewServerVideoLink.href = '#';
    }

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

        const captionInput = item.querySelector('.ps-photo-caption-input');
        captionInput.addEventListener('input', (e) => {
            photo.caption = e.target.value;
            updateCaptionOnPreview(idx, photo.caption);
        });

        item.querySelector('.ps-photo-remove-btn').addEventListener('click', async () => {
            const removed = state.photos.splice(idx, 1)[0];
            renderPhotoList();
            renderPreviewSheet();
            if (removed && removed.url) {
                deleteServerFileSilent(removed.url);
            }
        });

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

    const count = state.photos.length;
    const { cols, rows } = getEffectiveGrid();
    const orientName = state.orientation === 'landscape' ? 'A4 가로' : 'A4 세로';

    photoCountBadge.textContent = `${count} / ${MAX_PHOTOS}장`;
    currentGridBadge.textContent = count > 0
        ? `${orientName} · ${cols} × ${rows} 배치 (${cols}열 ${rows}행)`
        : `${orientName} · 사진 대기 중`;

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

    // 우측 상단 QR 코드 렌더링
    renderQrCodeOnSheet();

    sheetPhotoGrid.style.setProperty('--cols', cols);
    sheetPhotoGrid.style.setProperty('--rows', rows);
    sheetPhotoGrid.setAttribute('data-cols', cols);
    sheetPhotoGrid.setAttribute('data-rows', rows);

    sheetPhotoGrid.innerHTML = '';
    if (count === 0) {
        sheetPhotoGrid.innerHTML = `
            <div class="sheet-empty-placeholder no-print">
                <i class='bx bx-movie-play'></i>
                <div>좌측에서 <b>사진 또는 동영상</b>을 선택하거나 <b>Ctrl + V</b>로 붙여넣으면</div>
                <div>A4 1장에 자동 리사이즈 배치되며, 동영상은 우측 상단 QR 코드로 함께 연동됩니다.</div>
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
