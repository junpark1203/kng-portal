/**
 * ==========================================================================
 * 현장 사진 대지 (A4 Auto Photo Sheet) Controller (v4 - 다중 페이지 & 마지막 페이지 옵션 지원)
 * - 제목 + 사진(장수 제한 없음) 업로드 시 A4 세로(1×1 ~ 2×4) / 가로(1×1 ~ 4×2) 자동 리사이즈 및 다중 페이지 분할
 * - 마지막 페이지에 남은 사진 처리 방식 선택 (남은 장수에 맞춰 크게 채우기 vs 앞 페이지와 동일 크기 유지)
 * - 동영상 스마트 핵심 장면 추출 (Laplacian 선명도 + 장면 전환 분석), 클릭 시 고화질 확대(Lightbox)
 * - 대용량 동영상 청크 분할 업로드 + 서버 FFmpeg 모바일 경량화 + A4 우측 상단 QR 코드 생성
 * ==========================================================================
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? `http://${window.location.hostname}:3000/api/report-builder`
    : 'https://kng.junparks.com/api/report-builder';

const DOC_PREFIX = '[PS]::';
const MAX_PER_PAGE_DEFAULT = 8;
const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB 단위 분할 업로드 (Cloudflare 100MB 제한 우회)

// 애플리케이션 상태
let state = {
    currentDocId: null,
    title: '',
    docDate: getTodayString(),
    showDate: true,
    orientation: 'portrait', // 'portrait' (세로 최대 2x4) | 'landscape' (가로 최대 4x2)
    layoutMode: 'auto',      // 'auto' (페이지당 최대 8장) 또는 '1x2', '2x2', '2x4' 등 페이지당 격자 지정
    lastPageMode: 'expand',  // 'expand' (남은 장수에 맞춰 크게 채우기) | 'same_size' (앞 페이지와 동일 크기 유지)
    fitMode: 'contain',      // 'contain' (원본 비율) | 'cover' (꽉 채우기)
    showBorder: true,
    showIndex: false,
    showQr: true,
    videos: [],              // [{ id, url, title }] (다중 동영상 재생목록 지원)
    externalVideoUrl: '',
    qrLabel: '현장 영상 보기',
    photos: []               // [{ id, url, caption }] (장수 제한 없음)
};

let allSavedDocs = [];
let draggedPhotoIndex = null;

// 동영상 추출 모달 상태 (다중 동영상 연속 처리 큐 포함)
let pendingVideoQueue = [];
let currentVideoFile = null;
let currentVideoObjectUrl = null;
let extractedFrames = []; // [{ id, blob, dataUrl, timeSec, timeLabel }]
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
const lastPageModeGroup = document.getElementById('lastPageModeGroup');
const fitModeGroup = document.getElementById('fitModeGroup');
const showBorderCheck = document.getElementById('showBorderCheck');
const showIndexCheck = document.getElementById('showIndexCheck');

const showQrCheck = document.getElementById('showQrCheck');
const videoServerStatusBox = document.getElementById('videoServerStatusBox');
const connectedVideoCountText = document.getElementById('connectedVideoCountText');
const connectedVideoList = document.getElementById('connectedVideoList');
const previewServerVideoLink = document.getElementById('previewServerVideoLink');
const externalVideoUrlInput = document.getElementById('externalVideoUrlInput');
const qrLabelInput = document.getElementById('qrLabelInput');

const uploadDropzone = document.getElementById('uploadDropzone');
const fileInput = document.getElementById('fileInput');
const videoOnlyInput = document.getElementById('videoOnlyInput');
const openVideoExtractorBtn = document.getElementById('openVideoExtractorBtn');
const photoItemList = document.getElementById('photoItemList');
const photoCountBadge = document.getElementById('photoCountBadge');
const currentGridBadge = document.getElementById('currentGridBadge');

const pagesContainer = document.getElementById('pagesContainer');
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
// 다중 페이지 분할 및 페이지별 그리드(열 × 행) 계산
// --------------------------------------------------------------------------
function computeAutoGrid(count, orientation) {
    const n = Math.max(1, Math.min(MAX_PER_PAGE_DEFAULT, count || 1));
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

/**
 * 전체 사진 배열을 페이지 단위로 분할하고, 각 페이지의 (cols, rows) 격자를 계산하여 반환
 */
function buildPaginatedPages(photos, orientation, layoutMode, lastPageMode) {
    let baseCols = orientation === 'portrait' ? 2 : 4;
    let baseRows = orientation === 'portrait' ? 4 : 2;
    let maxPerPage = MAX_PER_PAGE_DEFAULT;

    if (layoutMode && layoutMode !== 'auto') {
        const parts = layoutMode.split('x').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
            baseCols = parts[0];
            baseRows = parts[1];
            maxPerPage = baseCols * baseRows;
        }
    }

    if (!photos || photos.length === 0) {
        const emptyGrid = layoutMode === 'auto'
            ? { cols: 1, rows: 1 }
            : { cols: baseCols, rows: baseRows };
        return [{
            pageIndex: 0,
            items: [],
            cols: emptyGrid.cols,
            rows: emptyGrid.rows
        }];
    }

    const totalPhotos = photos.length;
    const pages = [];

    for (let i = 0; i < totalPhotos; i += maxPerPage) {
        const slice = photos.slice(i, i + maxPerPage).map((p, offset) => ({
            photo: p,
            globalIdx: i + offset
        }));
        pages.push(slice);
    }

    const totalPages = pages.length;

    return pages.map((items, pageIndex) => {
        const isLastPage = pageIndex === totalPages - 1;
        const countOnPage = items.length;

        let cols = baseCols;
        let rows = baseRows;

        if (layoutMode === 'auto') {
            if (totalPages === 1) {
                // 1페이지뿐이면 사진 장수에 맞춰 자동 그리드
                const g = computeAutoGrid(countOnPage, orientation);
                cols = g.cols;
                rows = g.rows;
            } else if (!isLastPage || countOnPage === maxPerPage) {
                // 꽉 찬 앞 페이지들은 8장 기준(2x4 또는 4x2)
                const g = computeAutoGrid(maxPerPage, orientation);
                cols = g.cols;
                rows = g.rows;
            } else {
                // 다중 페이지의 마지막 페이지 (남은 장수가 8장 미만일 때)
                if (lastPageMode === 'same_size') {
                    const g = computeAutoGrid(maxPerPage, orientation);
                    cols = g.cols;
                    rows = g.rows;
                } else {
                    const g = computeAutoGrid(countOnPage, orientation);
                    cols = g.cols;
                    rows = g.rows;
                }
            }
        } else {
            // 수동 격자(예: 2x2, 2x4 등)를 선택한 경우
            if (isLastPage && countOnPage < maxPerPage && lastPageMode === 'expand') {
                // '남은 장수에 맞춰 크게 채우기' 선택 시 마지막 페이지는 남은 사진 수에 맞춰 확대 배치
                const g = computeAutoGrid(countOnPage, orientation);
                cols = g.cols;
                rows = g.rows;
            } else {
                // '앞 페이지와 동일 크기 유지' 선택 시 지정한 수동 격자 그대로 유지
                cols = baseCols;
                rows = baseRows;
            }
        }

        return {
            pageIndex,
            items,
            cols,
            rows
        };
    });
}

function populateLayoutOptions() {
    const currentVal = state.layoutMode || 'auto';
    const presets = state.orientation === 'portrait'
        ? [
            { value: 'auto', label: '자동 맞춤 (페이지당 최대 8장)' },
            { value: '1x1', label: '페이지당 1장 (1 × 1 · 전면)' },
            { value: '1x2', label: '페이지당 2장 (1 × 2 · 상하 2단)' },
            { value: '2x1', label: '페이지당 2장 (2 × 1 · 좌우 2단)' },
            { value: '1x3', label: '페이지당 3장 (1 × 3 · 상하 3단)' },
            { value: '2x2', label: '페이지당 4장 (2 × 2 · 2열 2행)' },
            { value: '2x3', label: '페이지당 6장 (2 × 3 · 2열 3행)' },
            { value: '2x4', label: '페이지당 8장 (2 × 4 · 2열 4행)' }
        ]
        : [
            { value: 'auto', label: '자동 맞춤 (페이지당 최대 8장)' },
            { value: '1x1', label: '페이지당 1장 (1 × 1 · 전면)' },
            { value: '2x1', label: '페이지당 2장 (2 × 1 · 좌우 2단)' },
            { value: '1x2', label: '페이지당 2장 (1 × 2 · 상하 2단)' },
            { value: '3x1', label: '페이지당 3장 (3 × 1 · 좌우 3단)' },
            { value: '2x2', label: '페이지당 4장 (2 × 2 · 2열 2행)' },
            { value: '4x1', label: '페이지당 4장 (4 × 1 · 좌우 4단)' },
            { value: '3x2', label: '페이지당 6장 (3 × 2 · 3열 2행)' },
            { value: '4x2', label: '페이지당 8장 (4 × 2 · 4열 2행)' }
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
        const displayTitleText = state.title.trim() || '제목을 입력하세요';
        pagesContainer.querySelectorAll('.sheet-title').forEach(el => {
            el.textContent = displayTitleText;
        });
    });

    sheetDateInput.addEventListener('input', (e) => {
        state.docDate = e.target.value;
        pagesContainer.querySelectorAll('.sheet-date-val').forEach(el => {
            el.textContent = state.docDate;
        });
    });

    showDateCheck.addEventListener('change', (e) => {
        state.showDate = e.target.checked;
        pagesContainer.querySelectorAll('.sheet-meta').forEach(el => {
            el.style.display = state.showDate ? '' : 'none';
        });
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

    lastPageModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            state.lastPageMode = btn.dataset.lastMode;
            renderControlsState();
            renderPreviewSheet();
        });
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
        renderQrCodeOnSheet();
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
        if (e.target.files && e.target.files.length > 0) {
            enqueueVideoFiles(Array.from(e.target.files));
            videoOnlyInput.value = '';
        }
    });

    [uploadDropzone, pagesContainer].forEach(zone => {
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
    const videoFiles = files.filter(f => isVideoFile(f));
    const imageFiles = files.filter(f => f.type && f.type.startsWith('image/'));

    if (imageFiles.length > 0) {
        await handleFilesUpload(imageFiles);
    }
    if (videoFiles.length > 0) {
        enqueueVideoFiles(videoFiles);
    }
}

function enqueueVideoFiles(videoFiles) {
    if (!videoFiles || videoFiles.length === 0) return;
    pendingVideoQueue.push(...videoFiles);
    if (videoExtractModal.classList.contains('hidden')) {
        const nextVideo = pendingVideoQueue.shift();
        if (nextVideo) openVideoExtractorModal(nextVideo);
    } else {
        showToast(`동영상 ${videoFiles.length}건이 대기열에 추가되었습니다.`);
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

    document.querySelectorAll('.btn-step').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseFloat(btn.dataset.seek || '0');
            if (!isNaN(delta) && extractVideoPlayer.duration) {
                extractVideoPlayer.pause();
                extractVideoPlayer.currentTime = Math.max(0, Math.min(extractVideoPlayer.duration - 0.05, extractVideoPlayer.currentTime + delta));
            }
        });
    });

    // 수동 현재 장면 캡처 (장수 제한 없음)
    document.getElementById('captureCurrentFrameBtn').addEventListener('click', async () => {
        extractVideoPlayer.pause();
        const frameObj = await captureHighResFrameAtCurrentTime(extractVideoPlayer);
        if (frameObj) {
            extractedFrames.push(frameObj);
            renderExtractedTray();
            showToast(`[${frameObj.timeLabel}] 장면이 담겼습니다.`);
        }
    });

    runSmartExtractBtn.addEventListener('click', () => {
        runSmartFrameExtraction();
    });

    document.getElementById('clearTrayBtn').addEventListener('click', () => {
        extractedFrames = [];
        renderExtractedTray();
    });

    document.getElementById('applyExtractedFramesBtn').addEventListener('click', () => {
        applyExtractedFramesToSheet();
    });

    bindLightboxEvents();
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

    let sceneDiff = 30;
    if (prevGrayData && prevGrayData.length === gray.length) {
        let diffSum = 0;
        for (let i = 0; i < gray.length; i++) {
            diffSum += Math.abs(gray[i] - prevGrayData[i]);
        }
        sceneDiff = diffSum / gray.length;
    }

    let exposureFactor = 1.0;
    if (meanLum < 22 || meanLum > 238) {
        exposureFactor = 0.35;
    }

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

async function runSmartFrameExtraction() {
    if (isExtractingSmart) return;
    const duration = extractVideoPlayer.duration;
    if (!duration || duration <= 0) {
        alert('동영상 정보를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        return;
    }

    const requestedCount = parseInt(autoExtractCountSelect.value, 10) || 4;

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
        const startPad = Math.min(0.8, duration * 0.04);
        const endPad = Math.min(0.8, duration * 0.04);
        const usableDuration = Math.max(0.2, duration - startPad - endPad);
        const segmentLen = usableDuration / requestedCount;
        const candidatesPerSegment = duration > 3 ? 4 : 2;

        let prevBestGray = null;

        for (let segIdx = 0; segIdx < requestedCount; segIdx++) {
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

                const progressPct = Math.round(((segIdx * candidatesPerSegment + c + 1) / (requestedCount * candidatesPerSegment)) * 100);
                smartExtractProgressBar.style.width = `${progressPct}%`;
                smartExtractProgressText.textContent = `구간 ${segIdx + 1}/${requestedCount} 선명도 분석 중 (${progressPct}%)...`;
            }

            prevBestGray = bestGray;

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
        card.title = '클릭하여 크게 보기';
        card.innerHTML = `
            <img src="${frame.dataUrl}" alt="추출 장면 ${idx + 1}">
            <span class="ps-tray-zoom-badge"><i class='bx bx-zoom-in'></i> 확대</span>
            <div class="ps-tray-meta">
                <span>#${idx + 1}</span>
                <span>${frame.timeLabel}</span>
            </div>
            <button type="button" class="ps-tray-del" title="이 장면 제외"><i class='bx bx-x'></i></button>
        `;
        card.addEventListener('click', () => {
            openFrameLightbox(idx);
        });
        card.querySelector('.ps-tray-del').addEventListener('click', (e) => {
            e.stopPropagation();
            extractedFrames.splice(idx, 1);
            renderExtractedTray();
        });
        extractedFramesTray.appendChild(card);
    });
}

// --------------------------------------------------------------------------
// 추출된 장면 고화질 크게 보기 (Lightbox) 컨트롤러
// --------------------------------------------------------------------------
let currentLightboxIndex = 0;

function bindLightboxEvents() {
    const modal = document.getElementById('frameLightboxModal');
    const stage = document.getElementById('lightboxStage');
    const closeBtn = document.getElementById('closeLightboxBtn');
    const prevBtn = document.getElementById('lightboxPrevBtn');
    const nextBtn = document.getElementById('lightboxNextBtn');
    const jumpBtn = document.getElementById('lightboxJumpToVideoBtn');
    const deleteBtn = document.getElementById('lightboxDeleteFrameBtn');

    if (!modal) return;

    closeBtn.addEventListener('click', closeFrameLightbox);
    stage.addEventListener('click', (e) => {
        if (e.target === stage) closeFrameLightbox();
    });

    prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stepLightbox(-1);
    });

    nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stepLightbox(1);
    });

    jumpBtn.addEventListener('click', () => {
        const frame = extractedFrames[currentLightboxIndex];
        if (!frame) return;
        closeFrameLightbox();
        extractVideoPlayer.pause();
        extractVideoPlayer.currentTime = frame.timeSec || 0;
        showToast(`영상 [${frame.timeLabel}] 시점으로 이동했습니다.`);
    });

    deleteBtn.addEventListener('click', () => {
        if (extractedFrames.length === 0) return;
        extractedFrames.splice(currentLightboxIndex, 1);
        renderExtractedTray();
        if (extractedFrames.length === 0) {
            closeFrameLightbox();
            showToast('장면이 제외되었습니다.');
            return;
        }
        if (currentLightboxIndex >= extractedFrames.length) {
            currentLightboxIndex = extractedFrames.length - 1;
        }
        renderLightboxContent();
        showToast('해당 장면이 목록에서 제외되었습니다.');
    });

    window.addEventListener('keydown', (e) => {
        if (modal.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeFrameLightbox();
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            stepLightbox(-1);
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            stepLightbox(1);
        } else if (e.key === 'Delete') {
            e.preventDefault();
            deleteBtn.click();
        }
    });
}

function openFrameLightbox(index) {
    if (!extractedFrames.length) return;
    currentLightboxIndex = Math.max(0, Math.min(extractedFrames.length - 1, index));
    renderLightboxContent();
    document.getElementById('frameLightboxModal').classList.remove('hidden');
}

function closeFrameLightbox() {
    const modal = document.getElementById('frameLightboxModal');
    if (modal) modal.classList.add('hidden');
}

function stepLightbox(delta) {
    if (extractedFrames.length <= 1) return;
    currentLightboxIndex = (currentLightboxIndex + delta + extractedFrames.length) % extractedFrames.length;
    renderLightboxContent();
}

function renderLightboxContent() {
    const frame = extractedFrames[currentLightboxIndex];
    if (!frame) return;

    document.getElementById('lightboxImg').src = frame.dataUrl;
    document.getElementById('lightboxCounter').textContent = `장면 #${currentLightboxIndex + 1} / ${extractedFrames.length}`;
    document.getElementById('lightboxTimeBadge').textContent = `영상 시점: ${frame.timeLabel}`;

    const showNav = extractedFrames.length > 1 ? '' : 'none';
    document.getElementById('lightboxPrevBtn').style.display = showNav;
    document.getElementById('lightboxNextBtn').style.display = showNav;
}

async function applyExtractedFramesToSheet() {
    if (extractedFrames.length === 0 && !uploadVideoForQrCheck.checked) {
        alert('추출된 장면이 없습니다. 먼저 장면을 추출하거나 담아주세요.');
        return;
    }

    const framesToUpload = extractedFrames.slice();
    const includeTimestamp = autoTimestampCaptionCheck.checked;
    const shouldUploadVideoQr = uploadVideoForQrCheck.checked && currentVideoFile;

    closeVideoExtractorModal();
    showLoading(true, '추출된 장면을 사진 대지에 올리는 중...');

    try {
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

        if (shouldUploadVideoQr) {
            const uploadedVideoUrl = await uploadVideoWithChunkFallback(currentVideoFile);
            if (uploadedVideoUrl) {
                const defaultVidTitle = (currentVideoFile.name || '')
                    .replace(/\.[^/.]+$/, '')
                    .trim() || `현장 동영상 ${state.videos.length + 1}`;
                state.videos.push({
                    id: generateId(),
                    url: uploadedVideoUrl,
                    title: defaultVidTitle
                });
                state.showQr = true;
            }
        }

        renderControlsState();
        renderPhotoList();
        renderPreviewSheet();
        showToast('추출된 핵심 장면과 동영상 QR 코드가 반영되었습니다.');

        // 대기 중인 다음 동영상이 있으면 연속으로 추출 모달 오픈
        if (pendingVideoQueue.length > 0) {
            const nextVideo = pendingVideoQueue.shift();
            if (nextVideo) {
                setTimeout(() => openVideoExtractorModal(nextVideo), 250);
            }
        }
    } catch (err) {
        console.error(err);
        alert(`반영 중 오류가 발생했습니다.\n${err.message}`);
    } finally {
        showLoading(false);
    }
}

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
// A4 우측 상단 QR 코드 생성 및 렌더링 (다중 동영상 통합 재생목록 URL)
// --------------------------------------------------------------------------
function getActiveQrTargetUrl(includeNamesForPreview = false) {
    const serverFiles = (state.videos || [])
        .map(v => (v.url || '').split('/').pop())
        .filter(Boolean);
    const extUrl = (state.externalVideoUrl || '').trim();

    if (serverFiles.length === 0 && !extUrl) {
        return '';
    }

    // 서버 영상 없이 외부 링크 1개만 있는 경우 외부 링크로 직접 연결
    if (serverFiles.length === 0 && extUrl) {
        return extUrl;
    }

    const origin = window.location.origin;
    const params = new URLSearchParams();
    if (serverFiles.length > 0) {
        params.set('f', serverFiles.join(','));
    }
    if (extUrl) {
        params.set('u', extUrl);
    }
    if (includeNamesForPreview) {
        const names = (state.videos || []).map((v, i) => v.title || `현장 영상 ${i + 1}`);
        if (extUrl) names.push('외부 링크 영상');
        params.set('n', names.join('|'));
        if (state.title) params.set('t', state.title);
    }
    return `${origin}/05_Management/photo_sheet/watch.html?${params.toString()}`;
}

function getEffectiveQrLabelText() {
    const rawLabel = (state.qrLabel || '').trim() || '현장 영상 보기';
    const totalVideos = (state.videos ? state.videos.length : 0) + ((state.externalVideoUrl && state.externalVideoUrl.trim()) ? 1 : 0);
    if (totalVideos > 1 && rawLabel === '현장 영상 보기') {
        return `현장 영상 (${totalVideos}건)`;
    }
    return rawLabel;
}

function renderQrCodeOnSheet() {
    const targetUrl = getActiveQrTargetUrl(false);
    const labelText = getEffectiveQrLabelText();

    const qrBoxes = pagesContainer.querySelectorAll('.sheet-qr-box');
    qrBoxes.forEach(box => {
        const codeContainer = box.querySelector('.sheet-qr-code');
        const labelEl = box.querySelector('.sheet-qr-label');
        if (labelEl) labelEl.textContent = labelText;

        if (!state.showQr || !targetUrl) {
            box.classList.add('hidden');
            if (codeContainer) codeContainer.innerHTML = '';
            return;
        }

        box.classList.remove('hidden');
        if (codeContainer) {
            codeContainer.innerHTML = '';
            if (typeof window.QRCode === 'function') {
                new window.QRCode(codeContainer, {
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
                codeContainer.appendChild(fallbackImg);
            }
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
        const videos = parsed.videos || [];
        const orientation = parsed.orientation === 'landscape' ? 'landscape' : 'portrait';
        const pages = buildPaginatedPages(photos, orientation, parsed.layoutMode || 'auto', parsed.lastPageMode || 'expand');
        const orientLabel = orientation === 'landscape' ? 'A4 가로' : 'A4 세로';
        const videoCount = videos.length + (parsed.externalVideoUrl ? 1 : 0);
        const hasVideoQr = Boolean(parsed.showQr && videoCount > 0);

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
                    ${hasVideoQr ? `<span class="ps-mini-badge qr-badge"><i class='bx bx-qr'></i> 영상QR${videoCount > 1 ? ` (${videoCount})` : ''}</span>` : ''}
                    <span class="ps-mini-badge">${orientLabel} · ${pages.length}쪽</span>
                    <span class="ps-mini-badge">총 ${photos.length}장</span>
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

        // 다중 동영상 배열 복원 (구버전 단일 videoServerUrl 호환 포함)
        let videos = Array.isArray(data.videos)
            ? data.videos.map((v, idx) => ({
                id: v.id || generateId(),
                url: v.url || '',
                title: v.title || `현장 동영상 ${idx + 1}`
            })).filter(v => v.url)
            : [];

        if (videos.length === 0 && data.videoServerUrl) {
            videos.push({
                id: generateId(),
                url: data.videoServerUrl,
                title: '현장 동영상 1'
            });
        }

        if (data.rows && data.rows[0] && Array.isArray(data.rows[0].col_video)) {
            data.rows[0].col_video.forEach((copiedVidUrl, idx) => {
                if (videos[idx] && copiedVidUrl) {
                    videos[idx].url = copiedVidUrl;
                }
            });
        }

        return {
            orientation: data.orientation === 'landscape' ? 'landscape' : 'portrait',
            layoutMode: data.layoutMode || 'auto',
            lastPageMode: data.lastPageMode === 'same_size' ? 'same_size' : 'expand',
            fitMode: data.fitMode === 'cover' ? 'cover' : 'contain',
            showDate: data.showDate !== undefined ? Boolean(data.showDate) : true,
            docDate: data.docDate || getTodayString(),
            showBorder: data.showBorder !== undefined ? Boolean(data.showBorder) : true,
            showIndex: Boolean(data.showIndex),
            showQr: data.showQr !== undefined ? Boolean(data.showQr) : true,
            videos,
            externalVideoUrl: data.externalVideoUrl || '',
            qrLabel: data.qrLabel !== undefined ? data.qrLabel : '현장 영상 보기',
            photos: photos.map(p => ({
                id: p.id || generateId(),
                url: p.url || '',
                caption: p.caption || ''
            }))
        };
    } catch (e) {
        return {
            orientation: 'portrait',
            layoutMode: 'auto',
            lastPageMode: 'expand',
            fitMode: 'contain',
            showDate: true,
            docDate: getTodayString(),
            showBorder: true,
            showIndex: false,
            showQr: true,
            videos: [],
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
        lastPageMode: state.lastPageMode,
        fitMode: state.fitMode,
        showDate: state.showDate,
        docDate: state.docDate,
        showBorder: state.showBorder,
        showIndex: state.showIndex,
        showQr: state.showQr,
        videos: state.videos,
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
            col_video: (state.videos || []).map(v => v.url)
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
        lastPageMode: 'expand',
        fitMode: 'contain',
        showBorder: true,
        showIndex: false,
        showQr: true,
        videos: [],
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
                state.videos = copiedParsed.videos;
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
                for (const v of (parsed.videos || [])) {
                    deleteServerFileSilent(v.url);
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
// 일반 사진 압축 및 업로드 (장수 제한 없음)
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

    showLoading(true, `사진 업로드 및 자동 리사이징 중 (0/${imageFiles.length})...`);
    try {
        for (let i = 0; i < imageFiles.length; i++) {
            showLoading(true, `사진 업로드 및 자동 리사이징 중 (${i + 1}/${imageFiles.length})...`);
            const compressed = await compressImage(imageFiles[i]);
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
        showToast(`사진 ${imageFiles.length}장이 추가되었습니다.`);
    } catch (err) {
        console.error(err);
        alert(`사진 업로드 중 오류가 발생했습니다.\n${err.message}`);
    } finally {
        showLoading(false);
    }
}

// --------------------------------------------------------------------------
// UI 렌더링 (좌측 컨트롤 / 사진 리스트 / 우측 다중 A4 시트)
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

    if (state.videos && state.videos.length > 0) {
        videoServerStatusBox.classList.remove('hidden');
        connectedVideoCountText.textContent = `연결된 현장 동영상 (${state.videos.length}건)`;
        previewServerVideoLink.href = getActiveQrTargetUrl(true);
        renderConnectedVideoList();
    } else {
        videoServerStatusBox.classList.add('hidden');
        previewServerVideoLink.href = '#';
        connectedVideoList.innerHTML = '';
    }

    orientationGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.orientation === state.orientation);
    });

    lastPageModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lastMode === state.lastPageMode);
    });

    fitModeGroup.querySelectorAll('.ps-seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fit === state.fitMode);
    });

    gridLayoutSelect.value = state.layoutMode;
}

function renderConnectedVideoList() {
    if (!connectedVideoList) return;
    connectedVideoList.innerHTML = '';

    state.videos.forEach((vid, idx) => {
        const item = document.createElement('div');
        item.className = 'ps-connected-video-item';

        const singleWatchUrl = (() => {
            const fileName = String(vid.url || '').split('/').pop();
            const watchBase = new URL('watch.html', window.location.href).href;
            if (fileName) {
                const p = new URLSearchParams();
                p.set('f', fileName);
                if (vid.title) p.set('n', vid.title);
                return `${watchBase}?${p.toString()}`;
            }
            return getImgSrc(vid.url);
        })();

        item.innerHTML = `
            <span class="ps-connected-video-idx">${idx + 1}</span>
            <input type="text" class="ps-connected-video-title-input" value="${escapeHtml(vid.title || `현장 영상 ${idx + 1}`)}" placeholder="영상 ${idx + 1} 제목">
            <div class="ps-connected-video-actions">
                <a class="ps-connected-video-action-btn preview-single-video-btn" href="${singleWatchUrl}" target="_blank" title="이 영상만 재생"><i class='bx bx-play'></i></a>
                <button type="button" class="ps-connected-video-action-btn danger remove-single-video-btn" title="이 동영상 삭제"><i class='bx bx-trash'></i></button>
            </div>
        `;

        const titleInput = item.querySelector('.ps-connected-video-title-input');
        const singleLink = item.querySelector('.preview-single-video-btn');
        titleInput.addEventListener('input', (e) => {
            vid.title = e.target.value;
            previewServerVideoLink.href = getActiveQrTargetUrl(true);
            const fileName = String(vid.url || '').split('/').pop();
            if (fileName) {
                const watchBase = new URL('watch.html', window.location.href).href;
                const p = new URLSearchParams();
                p.set('f', fileName);
                if (vid.title) p.set('n', vid.title);
                singleLink.href = `${watchBase}?${p.toString()}`;
            }
        });

        item.querySelector('.remove-single-video-btn').addEventListener('click', async () => {
            const removed = state.videos.splice(idx, 1)[0];
            if (removed && removed.url && removed.url.startsWith('/api/report-builder/uploads/')) {
                deleteServerFileQuietly(removed.url);
            }
            if (state.videos.length === 0 && !state.externalVideoUrl.trim()) {
                state.showQr = false;
            }
            renderControlsState();
            renderPreviewSheet();
            showToast(`동영상 ${idx + 1}번이 목록에서 제거되었습니다.`);
        });

        connectedVideoList.appendChild(item);
    });
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

function updateCaptionOnPreview(globalIdx, captionText) {
    const cell = pagesContainer.querySelector(`.sheet-photo-cell[data-photo-idx="${globalIdx}"]`);
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

    const totalCount = state.photos.length;
    const pages = buildPaginatedPages(state.photos, state.orientation, state.layoutMode, state.lastPageMode);
    const totalPages = pages.length;
    const orientName = state.orientation === 'landscape' ? 'A4 가로' : 'A4 세로';

    photoCountBadge.textContent = `총 ${totalCount}장 · ${totalPages}페이지`;
    if (totalCount === 0) {
        currentGridBadge.textContent = `${orientName} · 사진 대기 중`;
    } else if (totalPages === 1) {
        currentGridBadge.textContent = `${orientName} · ${pages[0].cols} × ${pages[0].rows} 배치`;
    } else {
        const firstG = `${pages[0].cols}×${pages[0].rows}`;
        const lastG = `${pages[totalPages - 1].cols}×${pages[totalPages - 1].rows}`;
        currentGridBadge.textContent = firstG === lastG
            ? `${orientName} · 페이지당 ${firstG} (${totalPages}쪽)`
            : `${orientName} · 본문 ${firstG} / 마지막쪽 ${lastG}`;
    }

    pagesContainer.innerHTML = '';

    const displayTitleText = (state.title || '').trim() || '제목을 입력하세요';
    const displayDateText = state.docDate || getTodayString();

    pages.forEach((pageObj, pIdx) => {
        const sheetEl = document.createElement('div');
        sheetEl.className = [
            'a4-sheet',
            state.orientation === 'landscape' ? 'landscape' : 'portrait',
            state.showBorder ? 'show-border' : '',
            state.showIndex ? 'show-index' : '',
            state.fitMode === 'cover' ? 'fit-cover' : 'fit-contain'
        ].filter(Boolean).join(' ');

        const qrBoxHtml = pIdx === 0
            ? `
                <div class="sheet-qr-box hidden">
                    <div class="sheet-qr-code"></div>
                    <div class="sheet-qr-label">${escapeHtml((state.qrLabel || '').trim() || '현장 영상 보기')}</div>
                </div>
            `
            : '';

        sheetEl.innerHTML = `
            <div class="sheet-header">
                <div class="sheet-header-main">
                    <h1 class="sheet-title">${escapeHtml(displayTitleText)}</h1>
                    <div class="sheet-meta" style="${state.showDate ? '' : 'display: none;'}">
                        <span>작성일: <strong class="sheet-date-val">${escapeHtml(displayDateText)}</strong></span>
                    </div>
                </div>
                ${qrBoxHtml}
            </div>
            <div class="sheet-photo-grid" style="--cols: ${pageObj.cols}; --rows: ${pageObj.rows};" data-cols="${pageObj.cols}" data-rows="${pageObj.rows}"></div>
            ${totalPages > 1 ? `<div class="sheet-footer-page-num">- ${pIdx + 1} / ${totalPages} -</div>` : ''}
        `;

        const gridEl = sheetEl.querySelector('.sheet-photo-grid');

        if (pageObj.items.length === 0) {
            gridEl.innerHTML = `
                <div class="sheet-empty-placeholder no-print">
                    <i class='bx bx-movie-play'></i>
                    <div>좌측에서 <b>사진 또는 동영상</b>을 선택하거나 <b>Ctrl + V</b>로 붙여넣으면</div>
                    <div>8장 초과 시에도 자동으로 2쪽, 3쪽으로 나뉘어 A4 규격에 맞게 배치됩니다.</div>
                </div>
            `;
        } else {
            pageObj.items.forEach(({ photo, globalIdx }) => {
                const cell = document.createElement('div');
                cell.className = 'sheet-photo-cell';
                cell.setAttribute('data-photo-idx', String(globalIdx));
                cell.draggable = true;

                const trimmedCap = (photo.caption || '').trim();
                cell.innerHTML = `
                    <div class="sheet-photo-frame">
                        <span class="sheet-photo-index">${globalIdx + 1}</span>
                        <img src="${getImgSrc(photo.url)}" alt="사진 ${globalIdx + 1}">
                    </div>
                    <div class="sheet-photo-caption ${trimmedCap ? '' : 'empty-caption'}">${escapeHtml(trimmedCap)}</div>
                `;

                cell.addEventListener('dragstart', (e) => {
                    draggedPhotoIndex = globalIdx;
                    e.dataTransfer.effectAllowed = 'move';
                });
                cell.addEventListener('dragover', (e) => {
                    if (draggedPhotoIndex === null || draggedPhotoIndex === globalIdx) return;
                    e.preventDefault();
                    cell.classList.add('drag-over-cell');
                });
                cell.addEventListener('dragleave', () => {
                    cell.classList.remove('drag-over-cell');
                });
                cell.addEventListener('drop', (e) => {
                    cell.classList.remove('drag-over-cell');
                    if (draggedPhotoIndex !== null && draggedPhotoIndex !== globalIdx) {
                        e.preventDefault();
                        e.stopPropagation();
                        const temp = state.photos[draggedPhotoIndex];
                        state.photos[draggedPhotoIndex] = state.photos[globalIdx];
                        state.photos[globalIdx] = temp;
                        draggedPhotoIndex = null;
                        renderPhotoList();
                        renderPreviewSheet();
                    }
                });
                cell.addEventListener('dragend', () => {
                    cell.classList.remove('drag-over-cell');
                    draggedPhotoIndex = null;
                });

                gridEl.appendChild(cell);
            });
        }

        pagesContainer.appendChild(sheetEl);
    });

    renderQrCodeOnSheet();
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
