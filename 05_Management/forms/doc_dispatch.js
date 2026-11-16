/**
 * ═══════════════════════════════════════════════════════════════
 * K&G Document Dispatch Box Controller (문서발송함)
 * 구비서류 목록 관리, 파일 첨부/스캔본/하드카피 체크,
 * 커버페이지 + 첨부파일(PDF/이미지) 통합 병합 & 상단 넘버링 출력 엔진
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const API_ORIGIN = isLocal ? 'http://localhost:3000' : 'https://kng.junparks.com';
    const API_BASE = `${API_ORIGIN}/api/doc-dispatch`;
    const PARTNERS_API_URL = `${API_ORIGIN}/api/partners`;
    const ADMIN_USERS_API_URL = `${API_ORIGIN}/api/admin/users`;

    const STORAGE_KEY_COMPANY = 'kng_doc_dispatch_company_v1';
    const STORAGE_KEY_DRAFT = 'kng_doc_dispatch_draft_v2';
    const STORAGE_KEY_PACKAGES = 'kng_doc_dispatch_packages_fallback_v1';
    const STORAGE_KEY_TEMPLATES = 'kng_doc_dispatch_templates_fallback_v1';
    const STORAGE_KEY_VAULT = 'kng_doc_dispatch_vault_fallback_v1';

    const APPROVAL_RANKS = ['담당', '대리', '과장', '차장', '부장', '이사', '상무', '전무', '사장'];

    const DEFAULT_COMPANY_INFO = {
        nameKr: '주식회사 케앤지',
        nameEn: 'K&G Co., LTD.',
        bizNum: '845-88-00551',
        address: '서울시 강동구 구천면로 159, 1층 2호, 3호',
        tel: '02-2038-0160',
        fax: '02-2038-0162',
        logoUrl: '../../assets/images/logo.png'
    };

    const FALLBACK_TEMPLATES = [
        {
            id: 'TPL-BANK-OPEN',
            name: '[금융/은행] 은행 법인 계좌 개설 구비서류 (8종)',
            category: '금융/은행',
            purpose: '법인 신규 계좌 개설 및 인터넷뱅킹 신청',
            remarks: '※ 원본 제출 서류는 스캔본을 서버에 첨부 보관하며, 현장 방문 시 실물 원본 및 인감을 지참합니다.',
            isDefault: 1,
            items: [
                { name: '은행거래신청서', required: true, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '법인인감 날인 필' },
                { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 제출 가능' },
                { name: '법인인감증명서', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '발급일로부터 3개월 이내 원본' },
                { name: '위임장', required: true, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '대리인 방문 시 법인인감 날인' },
                { name: '사용인감계', required: false, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '사용인감 등록 시 제출' },
                { name: '법인등기부등본', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '말소사항 포함(제출용) 원본' },
                { name: '대표자 신분증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 첨부' },
                { name: '수임인 신분증', required: true, copies: 1, submitType: 'original_hardcopy', validityDays: 0, memo: '방문 대리인 실물 신분증 지참' }
            ]
        },
        {
            id: 'TPL-BID-PARTNER',
            name: '[입찰/계약] 거래처 등록 및 입찰 참가 구비서류 (6종)',
            category: '입찰/계약',
            purpose: '신규 거래처 등록 및 입찰·계약 서류 제출',
            remarks: '※ 국세·지방세 완납증명서 유효기간(30일) 및 법인인감증명서(3개월)를 반드시 확인하세요.',
            isDefault: 0,
            items: [
                { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 1부' },
                { name: '통장사본', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '법인명의 입금 계좌' },
                { name: '법인인감증명서', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '최근 3개월 이내 발급본' },
                { name: '사용인감계', required: false, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '계약 시 사용인감 날인용' },
                { name: '국세·지방세 완납증명서', required: true, copies: 1, submitType: 'file_print', validityDays: 30, memo: '유효기간 30일 이내' },
                { name: '법인등기부등본', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '말소사항 포함' }
            ]
        },
        {
            id: 'TPL-TRADE-FX',
            name: '[무역/외환] 외국환은행 송금 및 통관 구비서류 (5종)',
            category: '무역/외환',
            purpose: '무역대금 외화송금 및 수입통관 증빙 제출',
            remarks: '※ 송금 신청 금액과 인보이스(CI) 금액·통화 일치 여부를 사전 대조하세요.',
            isDefault: 0,
            items: [
                { name: '무역대금 송금 추가 확인서', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '은행 제출 양식' },
                { name: '인보이스 (Commercial Invoice)', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '서명·직인 확인' },
                { name: '팩킹리스트 (Packing List)', required: false, copies: 1, submitType: 'file_print', validityDays: 0, memo: '선적 상세' },
                { name: '수입신고필증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '관세청 발급본' },
                { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '상용서류함 연동' }
            ]
        }
    ];

    const SUBMIT_TYPE_LABELS = {
        file_print: '사본/파일 출력',
        original_scan: '원본제출(스캔보관)',
        original_hardcopy: '실물/하드카피'
    };

    const KEYWORD_ALIASES = [
        { keywords: ['은행거래신청', '거래신청', '계좌개설신청'], target: '은행거래신청서' },
        { keywords: ['사업자등록', '사업자'], target: '사업자등록증' },
        { keywords: ['법인인감증명', '인감증명'], target: '법인인감증명서' },
        { keywords: ['위임장'], target: '위임장' },
        { keywords: ['사용인감'], target: '사용인감계' },
        { keywords: ['법인등기', '등기부등본', '등기사항'], target: '법인등기부등본' },
        { keywords: ['대표자신분', '대표신분', '대표자주민'], target: '대표자 신분증' },
        { keywords: ['수임인신분', '대리인신분', '방문자신분'], target: '수임인 신분증' },
        { keywords: ['통장사본', '계좌사본'], target: '통장사본' },
        { keywords: ['완납증명', '국세', '지방세'], target: '국세·지방세 완납증명서' },
        { keywords: ['송금추가확인', '무역대금'], target: '무역대금 송금 추가 확인서' },
        { keywords: ['인보이스', 'commercialinvoice'], target: '인보이스' },
        { keywords: ['팩킹', 'packinglist'], target: '팩킹리스트' },
        { keywords: ['수입신고필증', '신고필증'], target: '수입신고필증' }
    ];

    // ── 상태 관리 ──
    const state = {
        activeTab: 'editor',
        serverOnline: false,
        currentZoom: 0.75,
        currentPackageId: null,
        company: { ...DEFAULT_COMPANY_INFO },
        currentUser: { name: '', email: '', rank: '' },
        packages: [],
        templates: [],
        vault: [],
        items: [],
        printOptions: {
            showApprovalBox: true,
            printScope: 'all',
            showNumbering: true,
            numberingStyle: 'detailed',
            stampPosition: 'top-right',
            showScanBadge: true,
            showSubPage: true,
            safeShrink: true,
            includeDivider: false
        },
        vaultPickerTargetIdx: null,
        mergedPdfBlobUrl: null,
        mergedPdfBytes: null,
        individualPdfs: []
    };

    let cachedFontBytes = null;
    let initialSettingsSnapshot = '';
    let submitDateManuallyEdited = false;
    const els = {};

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 2600,
        timerProgressBar: true
    });

    function showToast(title, icon = 'success') {
        Toast.fire({ icon, title });
    }

    // ── IndexedDB 로컬 바이너리 폴백 (서버 미연결 시에도 PDF/이미지 병합 완벽 동작) ──
    const IDB_NAME = 'kng_doc_dispatch_blobs';
    const IDB_STORE = 'files';

    function openBlobDb() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) return reject(new Error('IndexedDB unsupported'));
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveLocalBlob(id, arrayBuffer) {
        const db = await openBlobDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(arrayBuffer, id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function loadLocalBlob(id) {
        const db = await openBlobDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    // ── Auth Fetch ──
    async function authFetch(url, options = {}) {
        let token = null;
        try {
            if (window.parent && window.parent.getAuthToken) {
                token = await window.parent.getAuthToken();
                let retries = 0;
                while (!token && retries < 8) {
                    await new Promise(r => setTimeout(r, 300));
                    token = await window.parent.getAuthToken();
                    retries++;
                }
            }
        } catch (e) {}

        if (!options.headers) options.headers = {};
        if (token && !options.headers['Authorization']) {
            options.headers['Authorization'] = 'Bearer ' + token;
        }
        return fetch(url, options);
    }

    // ── 유틸리티 ──
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function generateUid(prefix) {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function getLocalTodayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function addDaysToDateStr(dateStr, days) {
        if (!dateStr) return '';
        const parts = String(dateStr).split('-').map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return '';
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        d.setDate(d.getDate() + (parseInt(days, 10) || 0));
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function generateDefaultDocNo() {
        const d = new Date();
        const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const sameDayCount = state.packages.filter(p => (p.docNo || '').includes(ymd)).length + 1;
        return `DOC-${ymd}-${String(sameDayCount).padStart(3, '0')}`;
    }

    function formatDateTimeKr(iso) {
        if (!iso) return '-';
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        } catch (e) {
            return iso;
        }
    }

    function normalizeText(str) {
        return String(str || '')
            .toLowerCase()
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[\s_\-()\[\]{}·.,/]/g, '');
    }

    function resolveUploadUrl(url) {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('blob:') || url.startsWith('data:')) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${API_ORIGIN}${url}`;
        }
        return url;
    }

    function isPdfFile(att) {
        const name = (att.originalName || att.name || att.url || '').toLowerCase();
        const mime = (att.mimeType || '').toLowerCase();
        return mime.includes('pdf') || name.endsWith('.pdf');
    }

    function computeValidityInfo(issueDate, validityDays) {
        const days = parseInt(validityDays, 10) || 0;
        if (!issueDate) {
            if (days > 0) return { status: 'info', label: `유효기간 ${days}일 기준` };
            return null;
        }
        const today = new Date(getLocalTodayStr() + 'T00:00:00');
        const issued = new Date(issueDate + 'T00:00:00');
        if (isNaN(issued.getTime())) return null;
        const elapsed = Math.floor((today - issued) / (1000 * 60 * 60 * 24));

        if (days > 0) {
            const left = days - elapsed;
            if (elapsed > days) {
                return { status: 'expired', label: `⚠️ 만료 (${elapsed}일 경과 · 기준 ${days}일)`, elapsed };
            }
            if (left <= 14) {
                return { status: 'warn', label: `만료임박 D-${left}`, elapsed };
            }
            return { status: 'ok', label: `유효 (D-${left})`, elapsed };
        }
        if (elapsed > 90) {
            return { status: 'info', label: `발급 ${elapsed}일 경과`, elapsed };
        }
        return { status: 'ok', label: `발급 ${issueDate}`, elapsed };
    }

    function updateStorageBadge(online) {
        state.serverOnline = online;
        if (!els.storageModeBadge) return;
        if (online) {
            els.storageModeBadge.className = 'storage-mode-badge online';
            els.storageModeBadge.innerHTML = `<i class='bx bx-cloud-check'></i> <span>서버 연동</span>`;
        } else {
            els.storageModeBadge.className = 'storage-mode-badge local';
            els.storageModeBadge.innerHTML = `<i class='bx bx-laptop'></i> <span>로컬 임시모드</span>`;
        }
    }

    // ── DOM 요소 캐싱 ──
    function initElements() {
        const ids = [
            'tabEditor', 'tabArchive', 'tabVault',
            'viewEditor', 'viewArchive', 'viewVault',
            'archiveCountBadge', 'vaultCountBadge', 'storageModeBadge',
            'btnSettings', 'btnNewPackage', 'btnSavePackage', 'btnBuildMergedPdf',
            'presetSelect', 'btnLoadPreset', 'btnSaveAsPreset',
            'inputDocNo', 'inputStatus', 'inputDraftDate', 'inputSubmitDate',
            'inputTitle', 'inputRecipient', 'partnerSuggestions', 'inputAuthor', 'inputContact', 'inputRemarks',
            'chkShowApprovalBox', 'btnAutoMatchVault', 'btnCheckAllItems', 'btnUncheckAllItems', 'btnAddDocItem',
            'batchDropZone', 'batchFileInput', 'checklistContainer',
            'printScopeAll', 'printScopeSubmitOnly', 'optShowNumbering', 'numberingSubOptions',
            'optNumberingStyle', 'optStampPosition', 'optShowScanBadge', 'optShowSubPage', 'optSafeShrink', 'optIncludeDivider',
            'previewSummaryBadge', 'btnZoomOut', 'zoomLevelDisplay', 'btnZoomIn', 'btnZoomFit', 'btnZoom100', 'btnPrintCoverOnly',
            'a4PreviewViewport', 'a4ZoomWrapper', 'a4PagesContainer', 'attachmentPrintQueuePreview',
            'kpiTotalPackages', 'kpiMonthPackages', 'kpiDonePackages', 'kpiTotalFiles',
            'archiveFilterKeyword', 'archiveFilterStatus', 'archiveFilterMonth', 'btnResetArchiveFilter',
            'btnDeleteSelectedPackages', 'archiveSelectAll', 'archiveTableBody',
            'vaultForm', 'vaultEditId', 'vaultDocName', 'vaultCategory', 'vaultIssueDate',
            'vaultValidityDays', 'vaultMemo', 'vaultFileInput', 'vaultCurrentFileInfo',
            'btnCancelVaultEdit', 'btnSaveVaultItem', 'vaultTableBody', 'templateListContainer',
            'mergedPdfModal', 'mergedPdfTitle', 'mergedPdfSummary', 'btnDownloadIndividualPdfs',
            'btnDownloadMergedPdf', 'btnPrintMergedPdf', 'btnCloseMergedPdf', 'mergedPdfLoading',
            'mergedPdfProgressText', 'mergedPdfNoticeBar', 'mergedPdfFrame',
            'vaultPickerModal', 'btnCloseVaultPicker', 'vaultPickerTargetInfo', 'vaultPickerBody',
            'filePreviewModal', 'filePreviewTitle', 'btnOpenFileNewTab', 'btnCloseFilePreview', 'filePreviewContainer',
            'presetSaveModal', 'btnClosePresetSave', 'presetSaveForm', 'newPresetName', 'newPresetCategory', 'btnCancelPresetSave',
            'settingsModal', 'btnCloseSettings', 'settingsForm', 'setCorpKr', 'setCorpEn', 'setBizNum',
            'setLogoUrl', 'setAddress', 'setTel', 'setFax', 'btnCancelSettings'
        ];
        ids.forEach(id => {
            els[id] = document.getElementById(id);
        });
    }

    // ── 사용자 및 거래처 로드 ──
    async function detectCurrentUser() {
        let name = '';
        let email = '';
        try {
            if (window.parent && window.parent.localStorage) {
                name = window.parent.localStorage.getItem('kngCurrentUser') || '';
                email = window.parent.localStorage.getItem('kngCurrentUserEmail') || '';
            }
        } catch (e) {}
        if (!name) name = localStorage.getItem('kngCurrentUser') || '';
        if (!email) email = localStorage.getItem('kngCurrentUserEmail') || '';

        state.currentUser.name = name || '';
        state.currentUser.email = email || '';

        try {
            const res = await authFetch(ADMIN_USERS_API_URL);
            if (res.ok) {
                const users = await res.json();
                const matched = (users || []).find(u =>
                    (email && u.email && u.email.toLowerCase() === email.toLowerCase()) ||
                    (name && u.name === name)
                );
                if (matched) {
                    if (matched.name) state.currentUser.name = matched.name;
                    if (matched.rank) state.currentUser.rank = matched.rank;
                }
            }
        } catch (e) {}
    }

    async function loadPartnersDatalist() {
        try {
            const res = await authFetch(PARTNERS_API_URL);
            if (!res.ok) return;
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.partners || []);
            if (!els.partnerSuggestions) return;
            const seen = new Set();
            const opts = [];
            list.forEach(p => {
                const label = (p.company_name || p.name || '').trim();
                if (label && !seen.has(label)) {
                    seen.add(label);
                    opts.push(`<option value="${escapeHtml(label)}">`);
                }
            });
            els.partnerSuggestions.innerHTML = opts.join('');
        } catch (e) {}
    }

    // ── 초기 데이터 로드 (서버 우선 + 로컬 폴백) ──
    async function loadServerData() {
        let online = false;
        try {
            const [pkgRes, tplRes, vltRes] = await Promise.all([
                authFetch(`${API_BASE}/packages`),
                authFetch(`${API_BASE}/templates`),
                authFetch(`${API_BASE}/vault`)
            ]);

            if (pkgRes.ok && tplRes.ok && vltRes.ok) {
                state.packages = await pkgRes.json();
                state.templates = await tplRes.json();
                state.vault = await vltRes.json();
                online = true;
                saveLocalFallbackCache();
            }
        } catch (e) {
            online = false;
        }

        if (!online) {
            state.packages = readJsonStorage(STORAGE_KEY_PACKAGES, []);
            state.templates = readJsonStorage(STORAGE_KEY_TEMPLATES, FALLBACK_TEMPLATES);
            if (!Array.isArray(state.templates) || state.templates.length === 0) {
                state.templates = JSON.parse(JSON.stringify(FALLBACK_TEMPLATES));
            }
            state.vault = readJsonStorage(STORAGE_KEY_VAULT, []);
        }

        updateStorageBadge(online);
        renderPresetSelect();
        renderArchiveTable();
        renderVaultTable();
        renderTemplateList();
        updateBadges();
    }

    function readJsonStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function saveLocalFallbackCache() {
        try {
            localStorage.setItem(STORAGE_KEY_PACKAGES, JSON.stringify(state.packages));
            localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(state.templates));
            localStorage.setItem(STORAGE_KEY_VAULT, JSON.stringify(state.vault));
        } catch (e) {}
    }

    function updateBadges() {
        if (els.archiveCountBadge) els.archiveCountBadge.textContent = state.packages.length;
        if (els.vaultCountBadge) els.vaultCountBadge.textContent = state.vault.length;
    }

    // ── 파일 업로드 처리 ──
    async function uploadFiles(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) return [];

        // 1. 서버 업로드 시도
        if (state.serverOnline) {
            try {
                const fd = new FormData();
                files.forEach(f => fd.append('files', f));
                const res = await authFetch(`${API_BASE}/upload`, {
                    method: 'POST',
                    body: fd
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && Array.isArray(data.files)) {
                        return data.files;
                    }
                } else {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.error || '파일 업로드 실패');
                }
            } catch (err) {
                console.warn('[DocDispatch] 서버 업로드 실패, 로컬 바이너리 폴백 사용:', err.message);
            }
        }

        // 2. 로컬 IndexedDB 폴백 저장
        const results = [];
        for (const f of files) {
            const buf = await f.arrayBuffer();
            const localId = generateUid('LOCALFIL');
            try {
                await saveLocalBlob(localId, buf);
            } catch (e) {}
            results.push({
                id: localId,
                localBlobId: localId,
                url: '',
                originalName: f.name,
                mimeType: f.type || (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png'),
                size: f.size,
                uploadedAt: new Date().toISOString()
            });
        }
        return results;
    }

    async function getAttachmentBytes(att) {
        if (att.localBlobId) {
            const buf = await loadLocalBlob(att.localBlobId);
            if (buf) return new Uint8Array(buf);
        }
        if (att.url) {
            const fullUrl = resolveUploadUrl(att.url);
            const res = await fetch(fullUrl);
            if (!res.ok) throw new Error(`파일 불러오기 실패 (${att.originalName || att.url})`);
            const buf = await res.arrayBuffer();
            return new Uint8Array(buf);
        }
        throw new Error(`파일 데이터를 찾을 수 없습니다: ${att.originalName || '알 수 없음'}`);
    }

    // ── 체크리스트 항목 생성 및 편집 ──
    function createEmptyItem(overrides = {}) {
        return {
            id: generateUid('ITM'),
            name: '',
            required: true,
            copies: 1,
            submitType: 'file_print',
            prepared: false,
            issueDate: '',
            validityDays: 0,
            memo: '',
            attachments: [],
            ...overrides
        };
    }

    function applyTemplateToEditor(template, confirmIfDirty = false) {
        if (!template) return;
        if (confirmIfDirty && state.items.some(it => (it.attachments && it.attachments.length > 0) || it.name.trim())) {
            if (!confirm(`[${template.name}] 목록으로 현재 서류 체크리스트를 교체하시겠습니까?`)) {
                return;
            }
        }
        if (template.remarks) els.inputRemarks.value = template.remarks;
        const curTitle = els.inputTitle.value.trim();
        const isAutoTitle = !curTitle || state.templates.some(t => (t.purpose || '').trim() === curTitle);
        if (isAutoTitle && template.purpose) {
            els.inputTitle.value = template.purpose;
        }

        state.items = (template.items || []).map(it => createEmptyItem({
            name: it.name || '',
            required: it.required !== false,
            copies: parseInt(it.copies, 10) || 1,
            submitType: it.submitType || 'file_print',
            prepared: false,
            issueDate: '',
            validityDays: parseInt(it.validityDays, 10) || 0,
            memo: it.memo || '',
            attachments: []
        }));

        renderChecklist();
        renderPreview();
        saveDraft();
    }

    function resetNewPackage() {
        state.currentPackageId = null;
        submitDateManuallyEdited = false;
        const today = getLocalTodayStr();
        els.inputDocNo.value = generateDefaultDocNo();
        els.inputStatus.value = '준비중';
        els.inputDraftDate.value = today;
        els.inputSubmitDate.value = addDaysToDateStr(today, 1);
        els.inputTitle.value = '';
        els.inputRecipient.value = '';
        els.inputRemarks.value = '';

        const authorStr = state.currentUser.name
            ? `${state.currentUser.name}${state.currentUser.rank ? ' ' + state.currentUser.rank : ''}`
            : '';
        els.inputAuthor.value = authorStr;
        els.inputContact.value = state.currentUser.email
            ? `${state.company.tel} / ${state.currentUser.email}`
            : state.company.tel;

        const defaultTpl = state.templates.find(t => t.isDefault) || state.templates[0] || FALLBACK_TEMPLATES[0];
        if (defaultTpl) {
            if (els.presetSelect) els.presetSelect.value = defaultTpl.id;
            applyTemplateToEditor(defaultTpl, false);
        } else {
            state.items = [createEmptyItem()];
            renderChecklist();
            renderPreview();
        }
    }

    function renderPresetSelect() {
        if (!els.presetSelect) return;
        const currentVal = els.presetSelect.value;
        els.presetSelect.innerHTML = state.templates
            .map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
            .join('');
        if (currentVal && state.templates.some(t => t.id === currentVal)) {
            els.presetSelect.value = currentVal;
        }
    }

    function renderChecklist() {
        if (!els.checklistContainer) return;

        if (state.items.length === 0) {
            els.checklistContainer.innerHTML = `
                <div style="text-align:center; padding: 24px; border: 1px dashed var(--slate-300); border-radius: 6px; color: var(--slate-500);">
                    등록된 서류가 없습니다. 상단의 <strong>[+ 서류 추가]</strong> 버튼을 누르거나 프리셋을 불러오세요.
                </div>
            `;
            return;
        }

        els.checklistContainer.innerHTML = state.items.map((item, idx) => {
            const hasFiles = Array.isArray(item.attachments) && item.attachments.length > 0;
            const isPrepared = !!item.prepared;
            const validity = computeValidityInfo(item.issueDate, item.validityDays);
            let validityBadge = '';
            if (validity && validity.status === 'expired') {
                validityBadge = `<span class="status-mini-pill pill-expired">${escapeHtml(validity.label)}</span>`;
            } else if (validity && validity.status === 'warn') {
                validityBadge = `<span class="status-mini-pill pill-warn">${escapeHtml(validity.label)}</span>`;
            }

            let statusTag = '';
            if (item.submitType === 'original_scan' && hasFiles) {
                statusTag = `<span class="status-mini-pill pill-scan">스캔본 보관중</span>`;
            } else if (isPrepared && !hasFiles) {
                statusTag = `<span class="status-mini-pill pill-hardcopy">실물(하드카피) 준비완료</span>`;
            }

            const chipsHtml = (item.attachments || []).map((att, aIdx) => {
                const isPdf = isPdfFile(att);
                const iconClass = isPdf ? 'bxs-file-pdf' : 'bxs-image';
                const scanCls = item.submitType === 'original_scan' ? 'scan-chip' : '';
                return `
                    <span class="file-chip ${scanCls}" title="${escapeHtml(att.originalName || '첨부파일')}">
                        <i class='bx ${iconClass}'></i>
                        <span class="file-chip-name" data-action="preview-file" data-row="${idx}" data-att="${aIdx}">${escapeHtml(att.originalName || '파일')}</span>
                        <button type="button" class="file-chip-remove" data-action="remove-file" data-row="${idx}" data-att="${aIdx}" aria-label="첨부파일 제거">&times;</button>
                    </span>
                `;
            }).join('');

            return `
                <div class="doc-item-card ${isPrepared ? 'prepared' : 'unprepared'}" data-row="${idx}">
                    <div class="doc-item-top">
                        <div class="order-controls">
                            <button type="button" class="btn-order" data-action="move-up" data-row="${idx}" ${idx === 0 ? 'disabled' : ''} title="위로 이동" aria-label="위로 이동">▲</button>
                            <button type="button" class="btn-order" data-action="move-down" data-row="${idx}" ${idx === state.items.length - 1 ? 'disabled' : ''} title="아래로 이동" aria-label="아래로 이동">▼</button>
                        </div>
                        <span class="item-num-badge">${idx + 1}</span>
                        <input type="checkbox" class="item-prep-chk" data-field="prepared" data-row="${idx}" ${isPrepared ? 'checked' : ''} title="준비 완료 체크 (파일 첨부 시 자동 체크, 하드카피는 수동 체크)" aria-label="${idx + 1}번 서류 준비 완료">
                        <input type="text" class="item-name-input" data-field="name" data-row="${idx}" value="${escapeHtml(item.name)}" placeholder="필요 서류명 입력 (예: 사업자등록증)">
                        <select class="item-req-select" data-field="required" data-row="${idx}" aria-label="필수 여부">
                            <option value="true" ${item.required !== false ? 'selected' : ''}>필수</option>
                            <option value="false" ${item.required === false ? 'selected' : ''}>선택</option>
                        </select>
                        <label class="item-copies-wrap">
                            <input type="number" class="item-copies-input" data-field="copies" data-row="${idx}" min="1" max="99" value="${parseInt(item.copies, 10) || 1}" aria-label="부수">
                            <span>부</span>
                        </label>
                        <button type="button" class="btn-delete-item" data-action="delete-row" data-row="${idx}" title="항목 삭제" aria-label="항목 삭제">
                            <i class='bx bx-trash'></i>
                        </button>
                    </div>

                    <div class="doc-item-meta">
                        <select data-field="submitType" data-row="${idx}" aria-label="제출 형태">
                            <option value="file_print" ${item.submitType === 'file_print' ? 'selected' : ''}>사본/파일 출력 제출</option>
                            <option value="original_scan" ${item.submitType === 'original_scan' ? 'selected' : ''}>원본 제출 (스캔본 첨부보관)</option>
                            <option value="original_hardcopy" ${item.submitType === 'original_hardcopy' ? 'selected' : ''}>원본/실물 지참 (하드카피)</option>
                        </select>
                        <input type="date" data-field="issueDate" data-row="${idx}" value="${escapeHtml(item.issueDate || '')}" title="서류 발급일자 (유효기간 경고 체크용)" aria-label="발급일자">
                        <input type="number" data-field="validityDays" data-row="${idx}" min="0" value="${parseInt(item.validityDays, 10) || 0}" title="유효기간(일). 0이면 무제한" placeholder="유효(일)" aria-label="유효기간 일수">
                        <input type="text" data-field="memo" data-row="${idx}" value="${escapeHtml(item.memo || '')}" placeholder="비고 (예: 법인인감 날인 필)" aria-label="비고">
                    </div>

                    <div class="doc-item-attach-bar">
                        <input type="file" class="visually-hidden row-file-input" data-row="${idx}" multiple accept=".pdf,image/*">
                        <button type="button" class="attach-btn-mini" data-action="pick-file" data-row="${idx}">
                            <i class='bx bx-paperclip'></i> 파일 첨부
                        </button>
                        <button type="button" class="attach-btn-mini" data-action="open-vault-picker" data-row="${idx}">
                            <i class='bx bx-folder-open'></i> 상용서류함
                        </button>
                        ${statusTag}
                        ${validityBadge}
                        ${chipsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    // ── 스마트 파일명 자동 매칭 ──
    function findBestMatchingRowIndex(filename) {
        const normFile = normalizeText(filename);
        if (!normFile) return -1;

        // 1. 직접 부분 문자열 일치
        let idx = state.items.findIndex(it => {
            const normItem = normalizeText(it.name);
            return normItem && (normFile.includes(normItem) || normItem.includes(normFile));
        });
        if (idx >= 0) return idx;

        // 2. 키워드 별칭 매칭
        for (const rule of KEYWORD_ALIASES) {
            if (rule.keywords.some(kw => normFile.includes(normalizeText(kw)))) {
                const targetNorm = normalizeText(rule.target);
                const found = state.items.findIndex(it => normalizeText(it.name).includes(targetNorm));
                if (found >= 0) return found;
            }
        }
        return -1;
    }

    async function handleBatchFilesDrop(files, preferredRowIdx = null) {
        const uploaded = await uploadFiles(files);
        if (uploaded.length === 0) return;

        let matchedCount = 0;
        let addedCount = 0;

        uploaded.forEach(fileMeta => {
            if (preferredRowIdx !== null && state.items[preferredRowIdx]) {
                state.items[preferredRowIdx].attachments.push(fileMeta);
                state.items[preferredRowIdx].prepared = true;
                matchedCount++;
                return;
            }
            const matchIdx = findBestMatchingRowIndex(fileMeta.originalName);
            if (matchIdx >= 0) {
                state.items[matchIdx].attachments.push(fileMeta);
                state.items[matchIdx].prepared = true;
                matchedCount++;
            } else {
                const baseName = fileMeta.originalName.replace(/\.[^.]+$/, '');
                state.items.push(createEmptyItem({
                    name: baseName,
                    required: true,
                    copies: 1,
                    submitType: 'file_print',
                    prepared: true,
                    attachments: [fileMeta]
                }));
                addedCount++;
            }
        });

        renderChecklist();
        renderPreview();
        saveDraft();

        if (preferredRowIdx !== null) {
            showToast(`${uploaded.length}개 파일이 첨부되고 준비완료 체크되었습니다.`);
        } else {
            showToast(`자동 매칭 ${matchedCount}건, 신규 항목 추가 ${addedCount}건 완료!`);
        }
    }

    function autoMatchFromVault() {
        if (state.vault.length === 0) {
            showToast('상용서류함에 등록된 서류가 없습니다. 먼저 상용서류함 탭에서 등록해 주세요.', 'info');
            return;
        }
        let attachedCount = 0;
        let expiredWarnings = [];

        state.items.forEach(item => {
            const normItem = normalizeText(item.name);
            if (!normItem) return;
            const vaultMatch = state.vault.find(v => {
                const normV = normalizeText(v.docName);
                return normV && (normItem === normV || normItem.includes(normV) || normV.includes(normItem));
            });
            if (vaultMatch && (vaultMatch.fileUrl || vaultMatch.localBlobId)) {
                const alreadyExists = (item.attachments || []).some(a =>
                    (vaultMatch.fileUrl && a.url === vaultMatch.fileUrl) ||
                    (vaultMatch.localBlobId && a.localBlobId === vaultMatch.localBlobId)
                );
                if (!alreadyExists) {
                    item.attachments.push({
                        id: generateUid('VLTREF'),
                        url: vaultMatch.fileUrl || '',
                        localBlobId: vaultMatch.localBlobId || '',
                        originalName: vaultMatch.originalName || `${vaultMatch.docName}.pdf`,
                        mimeType: vaultMatch.mimeType || 'application/pdf',
                        size: vaultMatch.fileSize || 0,
                        fromVaultId: vaultMatch.id
                    });
                    item.prepared = true;
                    if (vaultMatch.issueDate && !item.issueDate) item.issueDate = vaultMatch.issueDate;
                    if (vaultMatch.validityDays && !item.validityDays) item.validityDays = vaultMatch.validityDays;
                    attachedCount++;

                    const val = computeValidityInfo(item.issueDate, item.validityDays);
                    if (val && val.status === 'expired') {
                        expiredWarnings.push(`${item.name} (${val.label})`);
                    }
                }
            }
        });

        renderChecklist();
        renderPreview();
        saveDraft();

        if (attachedCount === 0) {
            showToast('일치하는 새 상용서류가 없거나 이미 첨부되어 있습니다.', 'info');
        } else if (expiredWarnings.length > 0) {
            Swal.fire({
                icon: 'warning',
                title: `${attachedCount}건 자동 첨부 완료 (유효기간 확인 필요)`,
                html: `다음 서류의 유효기간이 경과했습니다:<br><strong>${expiredWarnings.map(escapeHtml).join('<br>')}</strong>`
            });
        } else {
            showToast(`상용서류함에서 ${attachedCount}건의 서류를 자동 첨부했습니다.`);
        }
    }

    // ── 실시간 A4 커버페이지 및 출력 큐 프리뷰 ──
    function syncPrintOptionsFromDom() {
        state.printOptions = {
            showApprovalBox: !!els.chkShowApprovalBox?.checked,
            printScope: els.printScopeSubmitOnly?.checked ? 'submit_only' : 'all',
            showNumbering: !!els.optShowNumbering?.checked,
            numberingStyle: els.optNumberingStyle?.value || 'detailed',
            stampPosition: els.optStampPosition?.value || 'top-right',
            showScanBadge: !!els.optShowScanBadge?.checked,
            showSubPage: !!els.optShowSubPage?.checked,
            safeShrink: !!els.optSafeShrink?.checked,
            includeDivider: !!els.optIncludeDivider?.checked
        };
        if (els.numberingSubOptions) {
            els.numberingSubOptions.classList.toggle('disabled', !state.printOptions.showNumbering);
        }
    }

    function buildTopHeaderBandHtml(docNo = '-', draftDate = '') {
        return `
            <header class="cover-top-band">
                <div class="cover-top-left">
                    <div class="letterhead-brand">
                        <img src="${escapeHtml(state.company.logoUrl)}" class="letterhead-logo" alt="K&G Logo" onerror="this.style.display='none'">
                        <div class="letterhead-brand-divider"></div>
                        <div class="letterhead-name-group">
                            <span class="letterhead-corp-kr">${escapeHtml(state.company.nameKr)}</span>
                            <span class="letterhead-corp-en">${escapeHtml(state.company.nameEn)}</span>
                        </div>
                    </div>
                </div>
                <div class="cover-top-right">
                    <div class="top-meta-lines right-aligned">
                        <div><span class="lh-meta-lbl">문서번호</span><span class="lh-meta-val">${escapeHtml(docNo)}</span></div>
                        <div><span class="lh-meta-lbl">작성일자</span><span class="lh-meta-val">${escapeHtml(draftDate || getLocalTodayStr())}</span></div>
                    </div>
                </div>
            </header>
        `;
    }

    function buildApprovalBoxHtml() {
        if (!state.printOptions.showApprovalBox) return '';
        const ths = APPROVAL_RANKS.map(r => `<th class="appr-rank-th">${escapeHtml(r)}</th>`).join('');
        const tds = APPROVAL_RANKS.map(() => `<td class="appr-sign-td"></td>`).join('');
        return `
            <table class="approval-box-table" aria-label="결재란">
                <tbody>
                    <tr>
                        <th rowspan="2" class="appr-side-th">결<br>재</th>
                        ${ths}
                    </tr>
                    <tr>
                        ${tds}
                    </tr>
                </tbody>
            </table>
        `;
    }

    function buildCorporateFooterHtml(pageNum, totalPages) {
        // 사용자 요청 반영: 법인 직인(도장) 이미지 없이 깔끔한 텍스트 공식 푸터만 출력
        return `
            <footer class="a4-footer">
                <span>${escapeHtml(state.company.nameKr)} (${escapeHtml(state.company.nameEn)}) &nbsp;|&nbsp; 사업자등록번호: ${escapeHtml(state.company.bizNum)} &nbsp;|&nbsp; ${escapeHtml(state.company.address)} &nbsp;|&nbsp; TEL ${escapeHtml(state.company.tel)}</span>
                <span class="footer-page-num">- Cover ${pageNum} / ${totalPages} -</span>
            </footer>
        `;
    }

    function buildCoverItemRowHtml(item, idx) {
        const hasFiles = Array.isArray(item.attachments) && item.attachments.length > 0;
        const statusHtml = `<span class="cover-check-box ${item.prepared ? 'checked' : ''}" aria-label="${item.prepared ? '준비 완료' : '미체크'}">${item.prepared ? '✓' : ''}</span>`;

        let typeText = '';
        if (item.submitType === 'original_scan') {
            typeText = hasFiles ? '원본 제출 (스캔보관)' : '원본 제출';
        } else if (item.submitType === 'original_hardcopy') {
            typeText = hasFiles ? '실물 지참 (스캔보관)' : '실물 지참';
        } else {
            typeText = hasFiles ? '사본 제출 (첨부완료)' : '사본 제출';
        }

        const noteParts = [];
        if (item.issueDate) noteParts.push(`발급:${item.issueDate}`);
        if (item.memo) noteParts.push(item.memo);

        return `
            <tr>
                <td class="td-no">${idx + 1}</td>
                <td class="td-name">${escapeHtml(item.name || '(미입력)')}</td>
                <td class="td-center">${item.required !== false ? '필수' : '선택'}</td>
                <td class="td-center">${parseInt(item.copies, 10) || 1}부</td>
                <td class="td-center td-submit-type">${escapeHtml(typeText)}</td>
                <td class="td-center">${statusHtml}</td>
                <td class="td-note">${escapeHtml(noteParts.join(' · ') || '-')}</td>
            </tr>
        `;
    }

    function renderPreview() {
        if (!els.a4PagesContainer) return;
        syncPrintOptionsFromDom();

        const docNo = (els.inputDocNo?.value || '').trim() || '-';
        const title = (els.inputTitle?.value || '').trim() || '(문서명 미입력)';
        const recipient = (els.inputRecipient?.value || '').trim() || '(제출처 미입력)';
        const draftDate = (els.inputDraftDate?.value || '').trim() || getLocalTodayStr();
        const submitDate = (els.inputSubmitDate?.value || '').trim();
        const author = (els.inputAuthor?.value || '').trim() || '-';
        const contact = (els.inputContact?.value || '').trim() || '-';
        const remarks = (els.inputRemarks?.value || '').trim();

        const totalDocs = state.items.length;
        const preparedDocs = state.items.filter(it => it.prepared).length;
        const totalFiles = state.items.reduce((acc, it) => acc + (it.attachments ? it.attachments.length : 0), 0);

        if (els.previewSummaryBadge) {
            els.previewSummaryBadge.textContent = `총 ${totalDocs}종 · 완료 ${preparedDocs}/${totalDocs} · 파일 ${totalFiles}개`;
            els.previewSummaryBadge.className = `page-fit-badge ${preparedDocs === totalDocs && totalDocs > 0 ? 'fit-ok' : 'fit-warn'}`;
        }

        const showAppr = state.printOptions.showApprovalBox;
        const tableHeaderHtml = `
            <thead>
                <tr>
                    <th style="width: 30px;">No.</th>
                    <th>구비 서류명</th>
                    <th style="width: 40px;">구분</th>
                    <th style="width: 40px;">부수</th>
                    <th style="width: 118px;">제출 형태</th>
                    <th style="width: 58px;">확인</th>
                    <th style="width: 156px;">비고 (발급일 등)</th>
                </tr>
            </thead>
        `;

        const createSheet = (isFirst, pageNum, totalPages) => {
            const sheet = document.createElement('div');
            sheet.className = 'a4-sheet';
            const approvalRowHtml = showAppr ? `<div class="cover-approval-row">${buildApprovalBoxHtml()}</div>` : '';
            const topHeaderSection = isFirst ? `
                ${buildTopHeaderBandHtml(docNo, draftDate)}
                ${approvalRowHtml}
                <div class="cover-title-section ${showAppr ? '' : 'standalone-title'}">
                    <h1 class="cover-main-title">${escapeHtml(title)}</h1>
                </div>
                <table class="cover-info-table">
                    <tbody>
                        <tr>
                            <th>수 신 처</th>
                            <td class="meta-strong">${escapeHtml(recipient)}</td>
                            <th>제출(예정)일</th>
                            <td>${escapeHtml(submitDate || '미정')}</td>
                        </tr>
                        <tr>
                            <th>담 당 자</th>
                            <td>${escapeHtml(author)}</td>
                            <th>연 락 처</th>
                            <td>${escapeHtml(contact)}</td>
                        </tr>
                    </tbody>
                </table>
            ` : `
                ${buildTopHeaderBandHtml(docNo, draftDate)}
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong style="font-size:12px;">${escapeHtml(title)} (계속)</strong>
                    <span style="font-size:10px; color:#475569;">수신처: ${escapeHtml(recipient)}</span>
                </div>
            `;

            sheet.innerHTML = `
                <div class="a4-content-top">
                    ${topHeaderSection}
                    <table class="cover-doc-table">
                        ${tableHeaderHtml}
                        <tbody class="cover-doc-tbody"></tbody>
                    </table>
                    <div class="cover-remarks-slot"></div>
                </div>
                <div class="a4-content-bottom">
                    ${buildCorporateFooterHtml(pageNum, totalPages)}
                </div>
            `;
            return sheet;
        };

        // 동적 페이지 분할: 실제로 넘치지 않게 A4 시트 분할
        els.a4PagesContainer.innerHTML = '';
        const sheets = [];
        let currentSheet = createSheet(true, 1, 1);
        els.a4PagesContainer.appendChild(currentSheet);
        sheets.push(currentSheet);

        const rowItems = state.items.length > 0 ? state.items : [];
        if (rowItems.length === 0) {
            currentSheet.querySelector('.cover-doc-tbody').innerHTML = `<tr><td colspan="7" class="td-center" style="padding: 18px; color: #64748b;">등록된 구비서류 항목이 없습니다.</td></tr>`;
        } else {
            rowItems.forEach((item, idx) => {
                const tbody = currentSheet.querySelector('.cover-doc-tbody');
                tbody.insertAdjacentHTML('beforeend', buildCoverItemRowHtml(item, idx));
                const addedRow = tbody.lastElementChild;

                if (currentSheet.scrollHeight > currentSheet.clientHeight + 2) {
                    addedRow.remove();
                    currentSheet = createSheet(false, sheets.length + 1, sheets.length + 1);
                    els.a4PagesContainer.appendChild(currentSheet);
                    sheets.push(currentSheet);
                    currentSheet.querySelector('.cover-doc-tbody').insertAdjacentHTML('beforeend', buildCoverItemRowHtml(item, idx));
                }
            });
        }

        // 비고 박스 배치 (마지막 시트에 넘치면 새 시트 추가)
        if (remarks) {
            const remarksHtml = `<div class="cover-remarks-box"><strong>[특이사항 및 전달 메모]</strong>${escapeHtml(remarks)}</div>`;
            currentSheet.querySelector('.cover-remarks-slot').innerHTML = remarksHtml;
            if (currentSheet.scrollHeight > currentSheet.clientHeight + 2) {
                currentSheet.querySelector('.cover-remarks-slot').innerHTML = '';
                currentSheet = createSheet(false, sheets.length + 1, sheets.length + 1);
                els.a4PagesContainer.appendChild(currentSheet);
                sheets.push(currentSheet);
                currentSheet.querySelector('table.cover-doc-table').remove();
                currentSheet.querySelector('.cover-remarks-slot').innerHTML = remarksHtml;
            }
        }

        // 총 커버 페이지 번호 업데이트
        const totalCoverPages = sheets.length;
        sheets.forEach((s, i) => {
            const footerNum = s.querySelector('.footer-page-num');
            if (footerNum) footerNum.textContent = `- Cover ${i + 1} / ${totalCoverPages} -`;
        });

        updateZoomWrapperSpacing();
        renderAttachmentQueuePreview();
    }

    function formatStampLabel(itemNo, itemName, submitType, subPage, totalSubPages) {
        const opts = state.printOptions;
        let mainText = '';
        if (opts.numberingStyle === 'simple') {
            mainText = `${itemNo}`;
        } else if (opts.numberingStyle === 'bracket') {
            mainText = `[ ${itemNo} ]`;
        } else {
            mainText = `[ ${itemNo} ] ${itemName}`;
        }

        if (opts.showSubPage && totalSubPages > 1) {
            mainText += ` (${subPage}/${totalSubPages})`;
        }

        const isScan = opts.showScanBadge && submitType === 'original_scan';
        return { mainText, isScan };
    }

    function renderAttachmentQueuePreview() {
        if (!els.attachmentPrintQueuePreview) return;
        const opts = state.printOptions;
        const rows = [];

        state.items.forEach((item, idx) => {
            const no = idx + 1;
            const hasFiles = item.attachments && item.attachments.length > 0;
            const shouldPrintFile = hasFiles && (opts.printScope === 'all' || item.submitType === 'file_print');

            if (shouldPrintFile) {
                const stamp = formatStampLabel(no, item.name || '서류', item.submitType, 1, item.attachments.length);
                const stampHtml = opts.showNumbering
                    ? `<span class="queue-stamp-preview ${stamp.isScan ? 'is-scan' : ''}">${escapeHtml(stamp.mainText)}${stamp.isScan ? ' · 스캔본' : ''}</span>`
                    : `<span style="font-size:10.5px; color: var(--slate-500);">번호 표기 OFF</span>`;
                rows.push(`
                    <div class="queue-item-row">
                        <span><strong>${no}. ${escapeHtml(item.name || '(미입력)')}</strong> — 첨부 ${item.attachments.length}개 파일 (${item.attachments.map(a => escapeHtml(a.originalName)).join(', ')})</span>
                        ${stampHtml}
                    </div>
                `);
            } else if (opts.includeDivider) {
                rows.push(`
                    <div class="queue-item-row">
                        <span><strong>${no}. ${escapeHtml(item.name || '(미입력)')}</strong> — <em style="color:var(--primary-dark);">[간지 출력] 실물 원본 끼워넣기 안내 페이지</em></span>
                        <span class="queue-stamp-preview">간지 No.${no}</span>
                    </div>
                `);
            } else if (hasFiles && opts.printScope === 'submit_only') {
                rows.push(`
                    <div class="queue-item-row skipped">
                        <span>${no}. ${escapeHtml(item.name)} — 스캔본 ${item.attachments.length}개 (제출용 선별 모드에 의해 인쇄 제외됨)</span>
                        <span style="font-size:10.5px; color:var(--slate-500);">인쇄 제외</span>
                    </div>
                `);
            }
        });

        const scopeLabel = opts.printScope === 'all' ? '전체 합본 출력' : '제출용 선별 출력';
        els.attachmentPrintQueuePreview.innerHTML = `
            <div class="queue-preview-title">
                <span><i class='bx bx-layer text-primary'></i> 커버페이지 다음 출력 순서 시뮬레이션 (${scopeLabel})</span>
                <span style="font-size:11px; color:var(--slate-500);">위치: ${escapeHtml(opts.stampPosition)}</span>
            </div>
            <div class="queue-items-list">
                ${rows.length > 0 ? rows.join('') : '<div style="font-size:11.5px; color:var(--slate-500);">첨부된 파일이 없거나 출력 대상 파일이 없습니다. (커버페이지만 출력됩니다)</div>'}
            </div>
        `;
    }

    function setZoom(level) {
        state.currentZoom = Math.min(1.3, Math.max(0.45, Math.round(level * 100) / 100));
        if (els.zoomLevelDisplay) els.zoomLevelDisplay.textContent = `${Math.round(state.currentZoom * 100)}%`;
        if (els.a4ZoomWrapper) els.a4ZoomWrapper.style.transform = `scale(${state.currentZoom})`;
        if (els.btnZoomFit) els.btnZoomFit.classList.toggle('active', Math.abs(state.currentZoom - 0.75) < 0.02);
        if (els.btnZoom100) els.btnZoom100.classList.toggle('active', Math.abs(state.currentZoom - 1.0) < 0.02);
        updateZoomWrapperSpacing();
    }

    function updateZoomWrapperSpacing() {
        if (!els.a4ZoomWrapper) return;
        const h = els.a4ZoomWrapper.scrollHeight || 0;
        const diff = h * (1 - state.currentZoom);
        els.a4ZoomWrapper.style.marginBottom = diff > 0 ? `${-Math.round(diff)}px` : '0px';
    }

    // ── 임시저장 & 패키지 저장 ──
    function collectCurrentPackagePayload() {
        syncPrintOptionsFromDom();
        const title = (els.inputTitle.value || '').trim();
        const draftDate = (els.inputDraftDate.value || '').trim() || getLocalTodayStr();
        return {
            id: state.currentPackageId,
            docNo: (els.inputDocNo.value || '').trim() || generateDefaultDocNo(),
            coverTitle: title || '제출서류 목록',
            title,
            recipient: (els.inputRecipient.value || '').trim(),
            purpose: title,
            draftDate,
            submitDate: (els.inputSubmitDate.value || '').trim(),
            _submitDateManual: submitDateManuallyEdited,
            submitMethod: '',
            author: (els.inputAuthor.value || '').trim(),
            contact: (els.inputContact.value || '').trim(),
            status: (els.inputStatus.value || '').trim() || '준비중',
            remarks: (els.inputRemarks.value || '').trim(),
            items: state.items,
            printOptions: state.printOptions,
            userEmail: state.currentUser.email || ''
        };
    }

    function saveDraft() {
        try {
            const payload = collectCurrentPackagePayload();
            localStorage.setItem(STORAGE_KEY_DRAFT, JSON.stringify(payload));
        } catch (e) {}
    }

    function restoreDraft() {
        const raw = localStorage.getItem(STORAGE_KEY_DRAFT);
        if (!raw) return false;
        try {
            const d = JSON.parse(raw);
            applyPackageDataToEditor(d);
            return true;
        } catch (e) {
            return false;
        }
    }

    function applyPackageDataToEditor(pkg) {
        state.currentPackageId = pkg.id || null;
        const fallbackDraft = pkg.draftDate || (pkg.createdAt ? pkg.createdAt.slice(0, 10) : '') || getLocalTodayStr();
        const defaultSubmit = addDaysToDateStr(fallbackDraft, 1);
        const isLegacyDraft = !pkg.draftDate;
        const isUneditedSameDay = !pkg.id && pkg.submitDate === fallbackDraft && !pkg._submitDateManual;
        let resolvedSubmit = pkg.submitDate !== undefined ? pkg.submitDate : defaultSubmit;
        if (isLegacyDraft || isUneditedSameDay) {
            resolvedSubmit = defaultSubmit;
        }
        submitDateManuallyEdited = !!pkg._submitDateManual || !!(pkg.id && resolvedSubmit && resolvedSubmit !== defaultSubmit);

        els.inputDocNo.value = pkg.docNo || generateDefaultDocNo();
        els.inputStatus.value = pkg.status || '준비중';
        els.inputDraftDate.value = fallbackDraft;
        els.inputSubmitDate.value = resolvedSubmit;
        els.inputTitle.value = pkg.title || pkg.purpose || '';
        els.inputRecipient.value = pkg.recipient || '';
        els.inputAuthor.value = pkg.author || '';
        els.inputContact.value = pkg.contact || '';
        els.inputRemarks.value = pkg.remarks || '';

        const opts = pkg.printOptions || {};
        els.chkShowApprovalBox.checked = opts.showApprovalBox !== false;
        if (opts.printScope === 'submit_only') {
            els.printScopeSubmitOnly.checked = true;
        } else {
            els.printScopeAll.checked = true;
        }
        els.optShowNumbering.checked = opts.showNumbering !== false;
        els.optNumberingStyle.value = opts.numberingStyle || 'detailed';
        els.optStampPosition.value = opts.stampPosition || 'top-right';
        els.optShowScanBadge.checked = opts.showScanBadge !== false;
        els.optShowSubPage.checked = opts.showSubPage !== false;
        els.optSafeShrink.checked = opts.safeShrink !== false;
        els.optIncludeDivider.checked = !!opts.includeDivider;

        state.items = Array.isArray(pkg.items)
            ? pkg.items.map(it => createEmptyItem(it))
            : [];

        renderChecklist();
        renderPreview();
    }

    async function savePackageToServer() {
        const payload = collectCurrentPackagePayload();
        if (!payload.title) {
            showToast('문서명을 입력해 주세요.', 'warning');
            els.inputTitle.focus();
            return;
        }

        if (state.serverOnline) {
            try {
                const isUpdate = !!state.currentPackageId;
                const url = isUpdate ? `${API_BASE}/packages/${state.currentPackageId}` : `${API_BASE}/packages`;
                const method = isUpdate ? 'PUT' : 'POST';
                const res = await authFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    const data = await res.json();
                    const savedPkg = data.package;
                    state.currentPackageId = savedPkg.id;
                    const idx = state.packages.findIndex(p => p.id === savedPkg.id);
                    if (idx >= 0) state.packages[idx] = savedPkg;
                    else state.packages.unshift(savedPkg);
                    saveLocalFallbackCache();
                    updateBadges();
                    renderArchiveTable();
                    saveDraft();
                    showToast('제출 서류 패키지가 서버에 저장되었습니다.');
                    return;
                }
            } catch (e) {}
        }

        // 로컬 폴백 저장
        const now = new Date().toISOString();
        if (!payload.id) {
            payload.id = generateUid('DPK');
            payload.createdAt = now;
        }
        payload.updatedAt = now;
        state.currentPackageId = payload.id;

        const existingIdx = state.packages.findIndex(p => p.id === payload.id);
        if (existingIdx >= 0) state.packages[existingIdx] = payload;
        else state.packages.unshift(payload);

        saveLocalFallbackCache();
        updateBadges();
        renderArchiveTable();
        saveDraft();
        showToast('로컬 임시모드로 패키지가 저장되었습니다.', 'info');
    }

    // ── 통합 PDF 병합 및 상단 넘버링/스캔본 스탬핑 엔진 ──
    function sanitizePdfText(str) {
        return String(str || '')
            .replace(/[\uD800-\uDFFF]/g, '')
            .replace(/[\u2600-\u27BF\uFE00-\uFE0F]/g, '')
            .replace(/[\x00-\x1F\x7F]/g, ' ')
            .trim();
    }

    async function getKoreanFontBytes() {
        if (cachedFontBytes) return cachedFontBytes;
        const res = await fetch('./Templates/NanumGothic.ttf');
        if (!res.ok) throw new Error('한글 폰트(./Templates/NanumGothic.ttf)를 불러올 수 없습니다.');
        cachedFontBytes = await res.arrayBuffer();
        return cachedFontBytes;
    }

    async function embedAnyImage(pdfDoc, bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        // PNG magic: 89 50 4E 47
        if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) {
            return await pdfDoc.embedPng(u8);
        }
        // JPEG magic: FF D8 FF
        if (u8.length >= 3 && u8[0] === 0xFF && u8[1] === 0xD8 && u8[2] === 0xFF) {
            return await pdfDoc.embedJpg(u8);
        }
        // WEBP / GIF / BMP -> HTML5 Canvas 변환 후 PNG 임베드
        const blob = new Blob([u8]);
        const objUrl = URL.createObjectURL(blob);
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('이미지 디코딩 실패'));
                el.src = objUrl;
            });
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const pngBytes = await pngBlob.arrayBuffer();
            return await pdfDoc.embedPng(pngBytes);
        } finally {
            URL.revokeObjectURL(objUrl);
        }
    }

    function drawStampOnPage(page, font, { mainText, isScan }, position, rgb) {
        const safeMainText = sanitizePdfText(mainText) || '1';
        const pageW = page.getWidth();
        const pageH = page.getHeight();
        const fontSize = 11;
        const padX = 8;
        const boxH = 20;
        const textW = font.widthOfTextAtSize(safeMainText, fontSize);
        const mainBoxW = textW + padX * 2;

        let scanBoxW = 0;
        const scanText = '스캔본';
        const gap = isScan ? 5 : 0;
        if (isScan) {
            scanBoxW = font.widthOfTextAtSize(scanText, 10) + 12;
        }
        const totalW = mainBoxW + gap + scanBoxW;

        let startX = pageW - 18 - totalW;
        if (position === 'top-left') startX = 18;
        else if (position === 'top-center') startX = (pageW - totalW) / 2;

        const boxY = pageH - 28;

        // 메인 넘버링 배지
        page.drawRectangle({
            x: startX,
            y: boxY,
            width: mainBoxW,
            height: boxH,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.12, 0.16, 0.24),
            borderWidth: 1.2
        });
        page.drawText(safeMainText, {
            x: startX + padX,
            y: boxY + 6,
            size: fontSize,
            font,
            color: rgb(0.06, 0.09, 0.16)
        });

        // 스캔본 배지
        if (isScan) {
            const scanX = startX + mainBoxW + gap;
            page.drawRectangle({
                x: scanX,
                y: boxY,
                width: scanBoxW,
                height: boxH,
                color: rgb(0.93, 0.95, 1),
                borderColor: rgb(0.15, 0.39, 0.92),
                borderWidth: 1.2
            });
            page.drawText(scanText, {
                x: scanX + 6,
                y: boxY + 6.5,
                size: 10,
                font,
                color: rgb(0.11, 0.30, 0.85)
            });
        }
    }

    async function captureCoverSheetsToPdf(mergedPdf, rgb) {
        const sheets = Array.from(els.a4PagesContainer.querySelectorAll('.a4-sheet'));
        const offscreen = document.createElement('div');
        offscreen.style.cssText = 'position:fixed; left:-9999px; top:0; width:210mm; background:#ffffff; z-index:-1;';
        document.body.appendChild(offscreen);

        try {
            for (const sheet of sheets) {
                const clone = sheet.cloneNode(true);
                clone.style.boxShadow = 'none';
                clone.style.margin = '0';
                offscreen.innerHTML = '';
                offscreen.appendChild(clone);

                const canvas = await window.html2canvas(clone, {
                    scale: 2.1,
                    backgroundColor: '#ffffff',
                    useCORS: true,
                    logging: false
                });
                const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                const pngBytes = await pngBlob.arrayBuffer();
                const pngImage = await mergedPdf.embedPng(pngBytes);
                const page = mergedPdf.addPage([595.28, 841.89]);
                page.drawImage(pngImage, {
                    x: 0,
                    y: 0,
                    width: 595.28,
                    height: 841.89
                });
            }
        } finally {
            offscreen.remove();
        }
    }

    async function appendDividerPage(targetPdf, font, item, itemNo, opts, rgb) {
        const page = targetPdf.addPage([595.28, 841.89]);
        const w = 595.28;
        const h = 841.89;

        // 테두리 박스
        page.drawRectangle({
            x: 65,
            y: 260,
            width: w - 130,
            height: 300,
            color: rgb(0.98, 0.99, 1),
            borderColor: rgb(0.2, 0.25, 0.33),
            borderWidth: 1.5
        });

        const badgeTitle = `No. ${itemNo}  원본(실물) 끼워넣기 안내 간지`;
        const bW = font.widthOfTextAtSize(badgeTitle, 14);
        page.drawText(badgeTitle, {
            x: (w - bW) / 2,
            y: 505,
            size: 14,
            font,
            color: rgb(0.15, 0.39, 0.92)
        });

        const docName = sanitizePdfText(item.name) || '(서류명 미입력)';
        const nW = font.widthOfTextAtSize(docName, 22);
        page.drawText(docName, {
            x: (w - nW) / 2,
            y: 440,
            size: 22,
            font,
            color: rgb(0.06, 0.09, 0.16)
        });

        const guideText = `이 위치에 [ ${itemNo}. ${docName} ] 실물 원본을 끼워 넣어주세요.`;
        const gW = font.widthOfTextAtSize(guideText, 12.5);
        page.drawText(guideText, {
            x: (w - gW) / 2,
            y: 380,
            size: 12.5,
            font,
            color: rgb(0.2, 0.25, 0.33)
        });

        const safeMemo = sanitizePdfText(item.memo);
        const metaText = `구분: ${SUBMIT_TYPE_LABELS[item.submitType] || '실물지참'}   |   부수: ${item.copies || 1}부${safeMemo ? '   |   비고: ' + safeMemo : ''}`;
        const mW = font.widthOfTextAtSize(metaText, 10.5);
        page.drawText(metaText, {
            x: (w - mW) / 2,
            y: 325,
            size: 10.5,
            font,
            color: rgb(0.39, 0.45, 0.55)
        });

        if (opts.showNumbering) {
            const stamp = formatStampLabel(itemNo, docName, item.submitType, 1, 1);
            drawStampOnPage(page, font, { mainText: stamp.mainText, isScan: false }, opts.stampPosition, rgb);
        }
    }

    async function buildMergedPdfAndOpenModal() {
        if (!window.PDFLib || !window.fontkit || !window.html2canvas) {
            showToast('PDF 병합 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도하세요.', 'error');
            return;
        }

        syncPrintOptionsFromDom();
        renderPreview();

        const opts = state.printOptions;
        els.mergedPdfLoading.style.display = 'flex';
        els.mergedPdfNoticeBar.style.display = 'none';
        els.mergedPdfFrame.src = 'about:blank';
        els.mergedPdfSummary.textContent = '커버페이지와 첨부 서류를 하나의 PDF로 생성하고 있습니다...';
        els.mergedPdfProgressText.textContent = '커버페이지를 고해상도로 변환 중입니다...';

        if (!els.mergedPdfModal.open) {
            els.mergedPdfModal.showModal();
        }

        try {
            const { PDFDocument, rgb, degrees } = window.PDFLib;
            const mergedPdf = await PDFDocument.create();
            mergedPdf.registerFontkit(window.fontkit);

            const fontBytes = await getKoreanFontBytes();
            const customFont = await mergedPdf.embedFont(fontBytes, { subset: true });

            // 1) 커버페이지 캡처 삽입
            await captureCoverSheetsToPdf(mergedPdf, rgb);
            const coverPagesCount = mergedPdf.getPageCount();

            // 2) 첨부 서류 병합 준비
            state.individualPdfs = [];
            const warnings = [];
            let attachedPagesCount = 0;
            let dividerPagesCount = 0;

            for (let i = 0; i < state.items.length; i++) {
                const item = state.items[i];
                const itemNo = i + 1;
                const itemName = item.name || `서류_${itemNo}`;
                const hasFiles = Array.isArray(item.attachments) && item.attachments.length > 0;
                const shouldInclude = hasFiles && (opts.printScope === 'all' || item.submitType === 'file_print');

                if (!shouldInclude) {
                    if (opts.includeDivider) {
                        await appendDividerPage(mergedPdf, customFont, item, itemNo, opts, rgb);
                        dividerPagesCount++;
                    }
                    continue;
                }

                els.mergedPdfProgressText.textContent = `[${itemNo}/${state.items.length}] ${itemName} 병합 중...`;

                // 개별 서류의 모든 첨부파일을 먼저 로드하여 총 페이지 수 계산
                const loadedSources = [];
                let totalItemPages = 0;

                for (const att of item.attachments) {
                    try {
                        const bytes = await getAttachmentBytes(att);
                        if (isPdfFile(att)) {
                            const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
                            const cnt = srcDoc.getPageCount();
                            loadedSources.push({ type: 'pdf', doc: srcDoc, count: cnt, att });
                            totalItemPages += cnt;
                        } else {
                            loadedSources.push({ type: 'image', bytes, count: 1, att });
                            totalItemPages += 1;
                        }
                    } catch (err) {
                        warnings.push(`${itemNo}. ${itemName} (${att.originalName || '파일'}): ${err.message}`);
                    }
                }

                // 개별 넘버링 저장용 PDF도 병렬 생성
                const singleDoc = await PDFDocument.create();
                singleDoc.registerFontkit(window.fontkit);
                const singleFont = await singleDoc.embedFont(fontBytes, { subset: true });

                let curSubPage = 0;
                for (const src of loadedSources) {
                    if (src.type === 'pdf') {
                        const srcPages = src.doc.getPages();
                        for (const srcPage of srcPages) {
                            curSubPage++;
                            const rawRot = ((srcPage.getRotation()?.angle || 0) % 360 + 360) % 360;
                            const embedded = await mergedPdf.embedPage(srcPage);
                            const embeddedSingle = await singleDoc.embedPage(srcPage);
                            const swapDim = (rawRot === 90 || rawRot === 270);
                            const visSrcW = swapDim ? embedded.height : embedded.width;
                            const visSrcH = swapDim ? embedded.width : embedded.height;
                            const isLandscape = visSrcW > visSrcH * 1.15;
                            const targetSize = isLandscape ? [841.89, 595.28] : [595.28, 841.89];

                            const drawIntoTarget = (pageObj, embObj, fnt) => {
                                const pW = pageObj.getWidth();
                                const pH = pageObj.getHeight();
                                const topMargin = (opts.showNumbering && opts.safeShrink) ? 36 : 0;
                                const sidePad = (opts.showNumbering && opts.safeShrink) ? 14 : 0;
                                const bottomPad = (opts.showNumbering && opts.safeShrink) ? 12 : 0;
                                const availW = pW - sidePad * 2;
                                const availH = pH - topMargin - bottomPad;
                                const scale = Math.min(availW / visSrcW, availH / visSrcH);
                                const rawDrawW = embObj.width * scale;
                                const rawDrawH = embObj.height * scale;
                                const cx = pW / 2;
                                const cy = bottomPad + availH / 2;

                                let drawX = cx - rawDrawW / 2;
                                let drawY = cy - rawDrawH / 2;
                                let rotDeg = 0;

                                if (rawRot === 90) {
                                    drawX = cx - rawDrawH / 2;
                                    drawY = cy + rawDrawW / 2;
                                    rotDeg = -90;
                                } else if (rawRot === 180) {
                                    drawX = cx + rawDrawW / 2;
                                    drawY = cy + rawDrawH / 2;
                                    rotDeg = 180;
                                } else if (rawRot === 270) {
                                    drawX = cx + rawDrawH / 2;
                                    drawY = cy - rawDrawW / 2;
                                    rotDeg = 90;
                                }

                                pageObj.drawPage(embObj, {
                                    x: drawX,
                                    y: drawY,
                                    width: rawDrawW,
                                    height: rawDrawH,
                                    rotate: degrees(rotDeg)
                                });
                                if (opts.showNumbering) {
                                    const stamp = formatStampLabel(itemNo, itemName, item.submitType, curSubPage, totalItemPages);
                                    drawStampOnPage(pageObj, fnt, stamp, opts.stampPosition, rgb);
                                }
                            };

                            drawIntoTarget(mergedPdf.addPage(targetSize), embedded, customFont);
                            drawIntoTarget(singleDoc.addPage(targetSize), embeddedSingle, singleFont);
                            attachedPagesCount++;
                        }
                    } else {
                        curSubPage++;
                        const embImg = await embedAnyImage(mergedPdf, src.bytes);
                        const embImgSingle = await embedAnyImage(singleDoc, src.bytes);
                        const isLandscape = embImg.width > embImg.height * 1.15;
                        const targetSize = isLandscape ? [841.89, 595.28] : [595.28, 841.89];

                        const drawImgIntoTarget = (pageObj, imgObj, fnt) => {
                            const pW = pageObj.getWidth();
                            const pH = pageObj.getHeight();
                            const topMargin = (opts.showNumbering && opts.safeShrink) ? 38 : 16;
                            const sidePad = 20;
                            const bottomPad = 18;
                            const availW = pW - sidePad * 2;
                            const availH = pH - topMargin - bottomPad;
                            const scale = Math.min(availW / imgObj.width, availH / imgObj.height);
                            const drawW = imgObj.width * scale;
                            const drawH = imgObj.height * scale;
                            const drawX = (pW - drawW) / 2;
                            const drawY = bottomPad + (availH - drawH) / 2;

                            pageObj.drawImage(imgObj, { x: drawX, y: drawY, width: drawW, height: drawH });
                            if (opts.showNumbering) {
                                const stamp = formatStampLabel(itemNo, itemName, item.submitType, curSubPage, totalItemPages);
                                drawStampOnPage(pageObj, fnt, stamp, opts.stampPosition, rgb);
                            }
                        };

                        drawImgIntoTarget(mergedPdf.addPage(targetSize), embImg, customFont);
                        drawImgIntoTarget(singleDoc.addPage(targetSize), embImgSingle, singleFont);
                        attachedPagesCount++;
                    }
                }

                if (singleDoc.getPageCount() > 0) {
                    const sBytes = await singleDoc.save();
                    const safeName = `${String(itemNo).padStart(2, '0')}_${itemName.replace(/[<>:"/\\|?*]/g, '_')}.pdf`;
                    state.individualPdfs.push({ filename: safeName, bytes: sBytes });
                }
            }

            const finalBytes = await mergedPdf.save();
            state.mergedPdfBytes = finalBytes;
            if (state.mergedPdfBlobUrl) URL.revokeObjectURL(state.mergedPdfBlobUrl);
            const blob = new Blob([finalBytes], { type: 'application/pdf' });
            state.mergedPdfBlobUrl = URL.createObjectURL(blob);

            els.mergedPdfFrame.src = state.mergedPdfBlobUrl;
            els.mergedPdfLoading.style.display = 'none';

            const totalAllPages = mergedPdf.getPageCount();
            els.mergedPdfSummary.textContent = `총 ${totalAllPages}페이지 생성 완료 (커버 ${coverPagesCount}p + 첨부 서류 ${attachedPagesCount}p${dividerPagesCount > 0 ? ` + 안내 간지 ${dividerPagesCount}p` : ''})`;

            if (warnings.length > 0) {
                els.mergedPdfNoticeBar.style.display = 'block';
                els.mergedPdfNoticeBar.textContent = `⚠️ 일부 파일 병합 건너뜀: ${warnings.join(' / ')}`;
            }
        } catch (err) {
            els.mergedPdfLoading.style.display = 'none';
            els.mergedPdfNoticeBar.style.display = 'block';
            els.mergedPdfNoticeBar.textContent = `오류 발생: ${err.message}`;
            showToast('통합 PDF 생성 중 오류가 발생했습니다.', 'error');
        }
    }

    function downloadBlobBytes(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    // ── 보관함 (Archive) 렌더링 및 제어 ──
    function renderArchiveTable() {
        const list = state.packages || [];
        const nowYm = getLocalTodayStr().slice(0, 7);
        const monthCnt = list.filter(p => (p.submitDate || p.createdAt || '').startsWith(nowYm)).length;
        const doneCnt = list.filter(p => p.status === '준비완료' || p.status === '발송완료').length;
        const filesCnt = list.reduce((sum, p) => {
            const items = Array.isArray(p.items) ? p.items : [];
            return sum + items.reduce((s, it) => s + (it.attachments ? it.attachments.length : 0), 0);
        }, 0);

        if (els.kpiTotalPackages) els.kpiTotalPackages.innerHTML = `${list.length} <small>건</small>`;
        if (els.kpiMonthPackages) els.kpiMonthPackages.innerHTML = `${monthCnt} <small>건</small>`;
        if (els.kpiDonePackages) els.kpiDonePackages.innerHTML = `${doneCnt} <small>건</small>`;
        if (els.kpiTotalFiles) els.kpiTotalFiles.innerHTML = `${filesCnt} <small>개</small>`;

        if (!els.archiveTableBody) return;
        const kw = (els.archiveFilterKeyword?.value || '').trim().toLowerCase();
        const st = els.archiveFilterStatus?.value || '';
        const ym = els.archiveFilterMonth?.value || '';

        const filtered = list.filter(pkg => {
            if (st && pkg.status !== st) return false;
            if (ym && !(pkg.submitDate || '').startsWith(ym) && !(pkg.draftDate || '').startsWith(ym)) return false;
            if (kw) {
                const docNames = (pkg.items || []).map(it => it.name || '').join(' ').toLowerCase();
                const hay = `${pkg.docNo || ''} ${pkg.title || ''} ${pkg.recipient || ''} ${pkg.purpose || ''} ${pkg.author || ''} ${docNames}`.toLowerCase();
                if (!hay.includes(kw)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            els.archiveTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding: 36px; color: var(--slate-500);">저장된 발송/제출 패키지 이력이 없습니다.</td></tr>`;
            return;
        }

        els.archiveTableBody.innerHTML = filtered.map(pkg => {
            const items = Array.isArray(pkg.items) ? pkg.items : [];
            const prepCnt = items.filter(it => it.prepared).length;
            const fileCnt = items.reduce((s, it) => s + (it.attachments ? it.attachments.length : 0), 0);
            const statusCls = `status-${escapeHtml(pkg.status || '준비중')}`;
            const draftDisp = pkg.draftDate || (pkg.createdAt ? pkg.createdAt.slice(0, 10) : '-');
            const submitDisp = pkg.submitDate || '미정';

            return `
                <tr>
                    <td style="text-align:center;"><input type="checkbox" class="archive-row-chk" value="${escapeHtml(pkg.id)}"></td>
                    <td style="font-weight:700; color: var(--slate-700);">${escapeHtml(pkg.docNo || '-')}</td>
                    <td style="font-size:11px; line-height:1.45;">
                        <div><span style="color:var(--slate-500);">작성</span> ${escapeHtml(draftDisp)}</div>
                        <div><span style="color:var(--primary-dark); font-weight:600;">예정</span> ${escapeHtml(submitDisp)}</div>
                    </td>
                    <td><strong>${escapeHtml(pkg.recipient || '-')}</strong></td>
                    <td>
                        <div style="font-weight:700; color:var(--slate-900);">${escapeHtml(pkg.title || '(문서명 없음)')}</div>
                        ${pkg.purpose && pkg.purpose !== pkg.title ? `<div style="font-size:11px; color:var(--slate-500);">${escapeHtml(pkg.purpose)}</div>` : ''}
                    </td>
                    <td>
                        <span class="badge-tag">${prepCnt}/${items.length}종 완료</span>
                        <span style="font-size:11px; color:var(--primary-dark); margin-left:4px;">첨부 ${fileCnt}건</span>
                    </td>
                    <td style="text-align:center;"><span class="status-badge ${statusCls}">${escapeHtml(pkg.status || '준비중')}</span></td>
                    <td>${escapeHtml(pkg.author || '-')}</td>
                    <td style="font-size:11px; color:var(--slate-500);">${escapeHtml(formatDateTimeKr(pkg.updatedAt || pkg.createdAt))}</td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:4px;">
                            <button type="button" class="btn-custom btn-outline-custom btn-xs" data-archive-action="open" data-id="${escapeHtml(pkg.id)}" title="열기 및 수정">열기</button>
                            <button type="button" class="btn-custom btn-outline-custom btn-xs" data-archive-action="clone" data-id="${escapeHtml(pkg.id)}" title="목록과 파일을 복제해 새 제출건 작성">복제</button>
                            <button type="button" class="btn-custom btn-primary-custom btn-xs" data-archive-action="print" data-id="${escapeHtml(pkg.id)}" title="당시 저장본 통합 PDF 즉시 출력">출력</button>
                            <button type="button" class="btn-custom btn-outline-custom btn-xs danger-outline" data-archive-action="delete" data-id="${escapeHtml(pkg.id)}" title="삭제"><i class='bx bx-trash'></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async function handleArchiveAction(action, id) {
        const pkg = state.packages.find(p => p.id === id);
        if (!pkg) return;

        if (action === 'open') {
            applyPackageDataToEditor(pkg);
            switchTab('editor');
            showToast('저장된 제출 패키지를 불러왔습니다.');
        } else if (action === 'clone') {
            const cloned = JSON.parse(JSON.stringify(pkg));
            const today = getLocalTodayStr();
            cloned.id = null;
            cloned.docNo = generateDefaultDocNo();
            cloned.draftDate = today;
            cloned.submitDate = addDaysToDateStr(today, 1);
            cloned.status = '준비중';
            cloned.title = `${cloned.title || '서류 제출'} (복제본)`;

            const expired = [];
            (cloned.items || []).forEach(it => {
                const v = computeValidityInfo(it.issueDate, it.validityDays);
                if (v && v.status === 'expired') expired.push(`${it.name} (${v.label})`);
            });

            applyPackageDataToEditor(cloned);
            switchTab('editor');
            if (expired.length > 0) {
                Swal.fire({
                    icon: 'warning',
                    title: '복제 완료 (유효기간 만료 서류 확인)',
                    html: `기존 내역을 복제했습니다. 다음 서류는 유효기간이 경과되었으니 최신본으로 교체하세요:<br><strong>${expired.map(escapeHtml).join('<br>')}</strong>`
                });
            } else {
                showToast('과거 제출 내역을 복제하여 새 문서로 열었습니다.');
            }
        } else if (action === 'print') {
            applyPackageDataToEditor(pkg);
            switchTab('editor');
            await buildMergedPdfAndOpenModal();
        } else if (action === 'delete') {
            if (!confirm(`[${pkg.title || pkg.docNo}] 이력을 삭제하시겠습니까?`)) return;
            await deletePackageIds([id]);
        }
    }

    async function deletePackageIds(ids) {
        if (state.serverOnline) {
            try {
                const res = await authFetch(`${API_BASE}/packages/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids })
                });
                if (!res.ok) throw new Error('삭제 실패');
            } catch (e) {
                showToast(e.message, 'error');
                return;
            }
        }
        state.packages = state.packages.filter(p => !ids.includes(p.id));
        if (ids.includes(state.currentPackageId)) state.currentPackageId = null;
        saveLocalFallbackCache();
        updateBadges();
        renderArchiveTable();
        showToast('선택한 이력이 삭제되었습니다.');
    }

    // ── 상용서류 보관함 & 프리셋 관리 ──
    function renderVaultTable() {
        if (!els.vaultTableBody) return;
        if (state.vault.length === 0) {
            els.vaultTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 28px; color: var(--slate-500);">등록된 상용서류가 없습니다. 위 양식에서 사업자등록증 등을 등록해 보세요.</td></tr>`;
            return;
        }
        els.vaultTableBody.innerHTML = state.vault.map(v => {
            const val = computeValidityInfo(v.issueDate, v.validityDays);
            let valHtml = `<span style="font-size:11px; color:var(--slate-500);">상시 유효</span>`;
            if (val) {
                const cls = val.status === 'expired' ? 'pill-expired' : (val.status === 'warn' ? 'pill-warn' : 'pill-hardcopy');
                valHtml = `<span class="status-mini-pill ${cls}">${escapeHtml(val.label)}</span>`;
            }
            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(v.docName)}</strong>
                        ${v.memo ? `<div style="font-size:11px; color:var(--slate-500);">${escapeHtml(v.memo)}</div>` : ''}
                    </td>
                    <td><span class="badge-tag">${escapeHtml(v.category || '기타')}</span></td>
                    <td>${valHtml}</td>
                    <td style="font-size:11.5px; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(v.originalName || '-')}
                    </td>
                    <td style="text-align:center;">
                        <div style="display:inline-flex; gap:4px;">
                            <button type="button" class="btn-custom btn-outline-custom btn-xs" data-vault-action="preview" data-id="${escapeHtml(v.id)}">보기</button>
                            <button type="button" class="btn-custom btn-outline-custom btn-xs" data-vault-action="edit" data-id="${escapeHtml(v.id)}">수정</button>
                            <button type="button" class="btn-custom btn-outline-custom btn-xs danger-outline" data-vault-action="delete" data-id="${escapeHtml(v.id)}"><i class='bx bx-trash'></i></button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderTemplateList() {
        if (!els.templateListContainer) return;
        els.templateListContainer.innerHTML = state.templates.map(t => {
            const tags = (t.items || []).map((it, i) => `<span class="template-doc-tag">${i + 1}. ${escapeHtml(it.name)}</span>`).join('');
            return `
                <div class="template-item-card">
                    <div class="template-item-head">
                        <h3>${escapeHtml(t.name)}</h3>
                        <span class="badge-tag">${escapeHtml(t.category || '기타')} · ${(t.items || []).length}종</span>
                    </div>
                    <div class="template-tags-wrap">${tags}</div>
                    <div class="template-item-actions">
                        <button type="button" class="btn-custom btn-primary-custom btn-xs" data-tpl-action="use" data-id="${escapeHtml(t.id)}">이 프리셋으로 작성</button>
                        <button type="button" class="btn-custom btn-outline-custom btn-xs danger-outline" data-tpl-action="delete" data-id="${escapeHtml(t.id)}">삭제</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async function saveVaultForm(e) {
        e.preventDefault();
        const docName = (els.vaultDocName.value || '').trim();
        if (!docName) {
            showToast('상용 서류명을 입력하세요.', 'warning');
            return;
        }

        const editId = els.vaultEditId.value || '';
        const existing = editId ? state.vault.find(v => v.id === editId) : null;
        const pickedFiles = els.vaultFileInput.files;

        let fileMeta = existing ? {
            url: existing.fileUrl,
            localBlobId: existing.localBlobId || '',
            originalName: existing.originalName,
            mimeType: existing.mimeType,
            size: existing.fileSize
        } : null;

        if (pickedFiles && pickedFiles.length > 0) {
            const uploaded = await uploadFiles(pickedFiles);
            if (uploaded.length > 0) fileMeta = uploaded[0];
        }

        if (!fileMeta || (!fileMeta.url && !fileMeta.localBlobId)) {
            showToast('서류 파일(PDF 또는 이미지)을 첨부해 주세요.', 'warning');
            return;
        }

        const payload = {
            docName,
            category: els.vaultCategory.value || '법인기본',
            issueDate: els.vaultIssueDate.value || '',
            validityDays: parseInt(els.vaultValidityDays.value, 10) || 0,
            memo: (els.vaultMemo.value || '').trim(),
            fileUrl: fileMeta.url || '',
            localBlobId: fileMeta.localBlobId || '',
            originalName: fileMeta.originalName || '',
            mimeType: fileMeta.mimeType || '',
            fileSize: fileMeta.size || 0
        };

        if (state.serverOnline) {
            try {
                const url = editId ? `${API_BASE}/vault/${editId}` : `${API_BASE}/vault`;
                const res = await authFetch(url, {
                    method: editId ? 'PUT' : 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    const data = await res.json();
                    const saved = data.item;
                    const idx = state.vault.findIndex(v => v.id === saved.id);
                    if (idx >= 0) state.vault[idx] = saved;
                    else state.vault.unshift(saved);
                    saveLocalFallbackCache();
                    resetVaultForm();
                    renderVaultTable();
                    updateBadges();
                    showToast('상용서류함에 저장되었습니다.');
                    return;
                }
            } catch (err) {}
        }

        // 로컬 폴백
        const now = new Date().toISOString();
        const item = { ...payload, id: editId || generateUid('VLT'), updatedAt: now, createdAt: existing?.createdAt || now };
        const idx = state.vault.findIndex(v => v.id === item.id);
        if (idx >= 0) state.vault[idx] = item;
        else state.vault.unshift(item);
        saveLocalFallbackCache();
        resetVaultForm();
        renderVaultTable();
        updateBadges();
        showToast('로컬 임시모드로 상용서류함에 저장되었습니다.', 'info');
    }

    function resetVaultForm() {
        els.vaultEditId.value = '';
        els.vaultDocName.value = '';
        els.vaultCategory.value = '법인기본';
        els.vaultIssueDate.value = '';
        els.vaultValidityDays.value = '0';
        els.vaultMemo.value = '';
        els.vaultFileInput.value = '';
        els.vaultCurrentFileInfo.textContent = '';
        els.btnCancelVaultEdit.style.display = 'none';
    }

    // ── 모달 핸들러 (Vault Picker / File Preview / Preset Save / Company Settings) ──
    function openVaultPickerForRow(rowIdx) {
        const item = state.items[rowIdx];
        if (!item) return;
        state.vaultPickerTargetIdx = rowIdx;
        els.vaultPickerTargetInfo.textContent = `첨부 대상: ${rowIdx + 1}번 [ ${item.name || '미입력 서류'} ]`;

        if (state.vault.length === 0) {
            els.vaultPickerBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 24px; color: var(--slate-500);">상용서류함에 등록된 서류가 없습니다. [상용서류함 · 프리셋] 탭에서 먼저 등록해 주세요.</td></tr>`;
        } else {
            const normTarget = normalizeText(item.name);
            const sorted = [...state.vault].sort((a, b) => {
                const aMatch = normTarget && (normalizeText(a.docName).includes(normTarget) || normTarget.includes(normalizeText(a.docName)));
                const bMatch = normTarget && (normalizeText(b.docName).includes(normTarget) || normTarget.includes(normalizeText(b.docName)));
                return (bMatch ? 1 : 0) - (aMatch ? 1 : 0);
            });

            els.vaultPickerBody.innerHTML = sorted.map(v => {
                const val = computeValidityInfo(v.issueDate, v.validityDays);
                const valText = val ? val.label : '상시 유효';
                const valCls = val?.status === 'expired' ? 'pill-expired' : (val?.status === 'warn' ? 'pill-warn' : 'pill-hardcopy');
                return `
                    <tr>
                        <td><strong>${escapeHtml(v.docName)}</strong></td>
                        <td><span class="badge-tag">${escapeHtml(v.category || '기타')}</span></td>
                        <td><span class="status-mini-pill ${valCls}">${escapeHtml(valText)}</span></td>
                        <td style="font-size:11px;">${escapeHtml(v.originalName || '-')}</td>
                        <td style="text-align:center;">
                            <button type="button" class="btn-custom btn-primary-custom btn-xs" data-pick-vault="${escapeHtml(v.id)}">첨부</button>
                        </td>
                    </tr>
                `;
            }).join('');
        }
        els.vaultPickerModal.showModal();
    }

    async function openFilePreviewModal(att) {
        if (!att) return;
        els.filePreviewTitle.innerHTML = `<i class='bx bx-show text-primary'></i> ${escapeHtml(att.originalName || '첨부파일 미리보기')}`;
        els.filePreviewContainer.innerHTML = `<div style="padding:20px; color:var(--slate-600);">미리보기 로딩 중...</div>`;
        els.filePreviewModal.showModal();

        let viewUrl = att.url ? resolveUploadUrl(att.url) : '';
        if (!viewUrl && att.localBlobId) {
            const buf = await loadLocalBlob(att.localBlobId);
            if (buf) {
                const blob = new Blob([buf], { type: att.mimeType || 'application/pdf' });
                viewUrl = URL.createObjectURL(blob);
            }
        }
        if (!viewUrl) {
            els.filePreviewContainer.innerHTML = `<div style="padding:24px; color:var(--danger-color);">파일을 찾을 수 없습니다.</div>`;
            return;
        }
        els.btnOpenFileNewTab.href = viewUrl;

        if (isPdfFile(att)) {
            els.filePreviewContainer.innerHTML = `<iframe src="${escapeHtml(viewUrl)}" title="PDF 미리보기"></iframe>`;
        } else {
            els.filePreviewContainer.innerHTML = `<img src="${escapeHtml(viewUrl)}" alt="${escapeHtml(att.originalName || '이미지 미리보기')}">`;
        }
    }

    async function saveCurrentAsPreset(e) {
        e.preventDefault();
        const name = (els.newPresetName.value || '').trim();
        if (!name) return;
        const category = els.newPresetCategory.value || '기타';
        const items = state.items.map(it => ({
            name: it.name || '',
            required: it.required !== false,
            copies: parseInt(it.copies, 10) || 1,
            submitType: it.submitType || 'file_print',
            validityDays: parseInt(it.validityDays, 10) || 0,
            memo: it.memo || ''
        }));

        const payload = {
            name,
            category,
            purpose: (els.inputTitle.value || '').trim(),
            remarks: (els.inputRemarks.value || '').trim(),
            items
        };

        if (state.serverOnline) {
            try {
                const res = await authFetch(`${API_BASE}/templates`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    const data = await res.json();
                    state.templates.push(data.template);
                    saveLocalFallbackCache();
                    renderPresetSelect();
                    renderTemplateList();
                    els.presetSelect.value = data.template.id;
                    els.presetSaveModal.close();
                    showToast('현재 서류 목록이 새 프리셋으로 저장되었습니다.');
                    return;
                }
            } catch (err) {}
        }

        const tpl = { ...payload, id: generateUid('TPL'), isDefault: 0 };
        state.templates.push(tpl);
        saveLocalFallbackCache();
        renderPresetSelect();
        renderTemplateList();
        els.presetSelect.value = tpl.id;
        els.presetSaveModal.close();
        showToast('로컬 임시모드로 프리셋이 저장되었습니다.', 'info');
    }

    // 회사 설정 모달
    function loadCompanySettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_COMPANY);
            if (raw) state.company = { ...DEFAULT_COMPANY_INFO, ...JSON.parse(raw) };
        } catch (e) {}
    }

    function getSettingsSnapshot() {
        return JSON.stringify({
            nameKr: els.setCorpKr.value,
            nameEn: els.setCorpEn.value,
            bizNum: els.setBizNum.value,
            logoUrl: els.setLogoUrl.value,
            address: els.setAddress.value,
            tel: els.setTel.value,
            fax: els.setFax.value
        });
    }

    function openSettingsModal() {
        els.setCorpKr.value = state.company.nameKr;
        els.setCorpEn.value = state.company.nameEn;
        els.setBizNum.value = state.company.bizNum;
        els.setLogoUrl.value = state.company.logoUrl;
        els.setAddress.value = state.company.address;
        els.setTel.value = state.company.tel;
        els.setFax.value = state.company.fax;
        initialSettingsSnapshot = getSettingsSnapshot();
        els.settingsModal.showModal();
    }

    function requestCloseSettings() {
        if (getSettingsSnapshot() !== initialSettingsSnapshot) {
            if (!confirm('수정 중인 회사 정보가 저장되지 않았습니다. 창을 닫으시겠습니까?')) {
                return;
            }
        }
        els.settingsModal.close();
    }

    // ── 탭 전환 ──
    function switchTab(tab) {
        state.activeTab = tab;
        els.tabEditor.classList.toggle('active', tab === 'editor');
        els.tabArchive.classList.toggle('active', tab === 'archive');
        els.tabVault.classList.toggle('active', tab === 'vault');

        els.viewEditor.style.display = tab === 'editor' ? 'grid' : 'none';
        els.viewArchive.style.display = tab === 'archive' ? 'block' : 'none';
        els.viewVault.style.display = tab === 'vault' ? 'block' : 'none';

        if (tab === 'archive') renderArchiveTable();
        if (tab === 'vault') {
            renderVaultTable();
            renderTemplateList();
        }
    }

    // ── 이벤트 바인딩 ──
    function bindEvents() {
        els.tabEditor.addEventListener('click', () => switchTab('editor'));
        els.tabArchive.addEventListener('click', () => switchTab('archive'));
        els.tabVault.addEventListener('click', () => switchTab('vault'));

        els.btnNewPackage.addEventListener('click', () => {
            if (confirm('새 문서를 작성하시겠습니까? 현재 편집 화면은 기본 템플릿으로 초기화됩니다.')) {
                resetNewPackage();
            }
        });
        els.btnSavePackage.addEventListener('click', savePackageToServer);
        els.btnBuildMergedPdf.addEventListener('click', buildMergedPdfAndOpenModal);
        els.btnPrintCoverOnly.addEventListener('click', () => window.print());

        // 프리셋 불러오기 / 저장
        els.btnLoadPreset.addEventListener('click', () => {
            const tpl = state.templates.find(t => t.id === els.presetSelect.value);
            if (tpl) applyTemplateToEditor(tpl, true);
        });
        els.btnSaveAsPreset.addEventListener('click', () => {
            els.newPresetName.value = '';
            els.presetSaveModal.showModal();
        });
        els.presetSaveForm.addEventListener('submit', saveCurrentAsPreset);
        els.btnClosePresetSave.addEventListener('click', () => els.presetSaveModal.close());
        els.btnCancelPresetSave.addEventListener('click', () => els.presetSaveModal.close());

        // 기본 입력 실시간 프리뷰 반영
        const liveFields = [
            els.inputDocNo, els.inputStatus, els.inputDraftDate, els.inputSubmitDate,
            els.inputTitle, els.inputRecipient,
            els.inputAuthor, els.inputContact, els.inputRemarks
        ];
        liveFields.forEach(el => {
            if (!el) return;
            el.addEventListener('input', () => { renderPreview(); saveDraft(); });
            el.addEventListener('change', () => { renderPreview(); saveDraft(); });
        });
        els.inputSubmitDate.addEventListener('input', () => { submitDateManuallyEdited = true; });
        els.inputSubmitDate.addEventListener('change', () => { submitDateManuallyEdited = true; });
        els.inputDraftDate.addEventListener('change', () => {
            if (!submitDateManuallyEdited && els.inputDraftDate.value) {
                els.inputSubmitDate.value = addDaysToDateStr(els.inputDraftDate.value, 1);
                renderPreview();
                saveDraft();
            }
        });

        // 결재박스 및 출력 옵션 실시간 반영
        const optionControls = [
            els.chkShowApprovalBox, els.printScopeAll, els.printScopeSubmitOnly,
            els.optShowNumbering, els.optNumberingStyle, els.optStampPosition,
            els.optShowScanBadge, els.optShowSubPage, els.optSafeShrink, els.optIncludeDivider
        ];
        optionControls.forEach(el => {
            if (!el) return;
            el.addEventListener('change', () => { renderPreview(); saveDraft(); });
        });

        // 체크리스트 벌크 버튼
        els.btnAddDocItem.addEventListener('click', () => {
            state.items.push(createEmptyItem());
            renderChecklist();
            renderPreview();
            saveDraft();
        });
        els.btnCheckAllItems.addEventListener('click', () => {
            state.items.forEach(it => { it.prepared = true; });
            renderChecklist();
            renderPreview();
            saveDraft();
        });
        els.btnUncheckAllItems.addEventListener('click', () => {
            state.items.forEach(it => { it.prepared = false; });
            renderChecklist();
            renderPreview();
            saveDraft();
        });
        els.btnAutoMatchVault.addEventListener('click', autoMatchFromVault);

        // 일괄 드래그 앤 드롭 존
        els.batchDropZone.addEventListener('click', () => els.batchFileInput.click());
        els.batchDropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                els.batchFileInput.click();
            }
        });
        els.batchFileInput.addEventListener('change', async (e) => {
            if (e.target.files?.length) {
                await handleBatchFilesDrop(e.target.files);
                e.target.value = '';
            }
        });
        els.batchDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.batchDropZone.classList.add('drag-over');
        });
        els.batchDropZone.addEventListener('dragleave', () => {
            els.batchDropZone.classList.remove('drag-over');
        });
        els.batchDropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            els.batchDropZone.classList.remove('drag-over');
            if (e.dataTransfer?.files?.length) {
                await handleBatchFilesDrop(e.dataTransfer.files);
            }
        });

        // 체크리스트 위임 이벤트
        els.checklistContainer.addEventListener('input', (e) => {
            const row = e.target.getAttribute('data-row');
            const field = e.target.getAttribute('data-field');
            if (row === null || !field || !state.items[row]) return;
            const item = state.items[row];
            if (field === 'copies' || field === 'validityDays') {
                item[field] = parseInt(e.target.value, 10) || 0;
            } else {
                item[field] = e.target.value;
            }
            renderPreview();
            saveDraft();
        });

        els.checklistContainer.addEventListener('change', async (e) => {
            if (e.target.classList.contains('row-file-input')) {
                const rowIdx = parseInt(e.target.getAttribute('data-row'), 10);
                if (e.target.files?.length) {
                    await handleBatchFilesDrop(e.target.files, rowIdx);
                    e.target.value = '';
                }
                return;
            }

            const row = e.target.getAttribute('data-row');
            const field = e.target.getAttribute('data-field');
            if (row === null || !field || !state.items[row]) return;
            const item = state.items[row];

            if (field === 'prepared') {
                item.prepared = e.target.checked;
                renderChecklist();
            } else if (field === 'required') {
                item.required = e.target.value === 'true';
            } else {
                item[field] = e.target.value;
                if (field === 'issueDate' || field === 'validityDays' || field === 'submitType') {
                    renderChecklist();
                }
            }
            renderPreview();
            saveDraft();
        });

        els.checklistContainer.addEventListener('click', async (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.getAttribute('data-action');
            const rowIdx = parseInt(actionEl.getAttribute('data-row'), 10);
            const attIdx = parseInt(actionEl.getAttribute('data-att'), 10);
            const item = state.items[rowIdx];
            if (!item) return;

            if (action === 'move-up' && rowIdx > 0) {
                [state.items[rowIdx - 1], state.items[rowIdx]] = [state.items[rowIdx], state.items[rowIdx - 1]];
                renderChecklist(); renderPreview(); saveDraft();
            } else if (action === 'move-down' && rowIdx < state.items.length - 1) {
                [state.items[rowIdx + 1], state.items[rowIdx]] = [state.items[rowIdx], state.items[rowIdx + 1]];
                renderChecklist(); renderPreview(); saveDraft();
            } else if (action === 'delete-row') {
                state.items.splice(rowIdx, 1);
                renderChecklist(); renderPreview(); saveDraft();
            } else if (action === 'pick-file') {
                const card = actionEl.closest('.doc-item-card');
                card?.querySelector('.row-file-input')?.click();
            } else if (action === 'open-vault-picker') {
                openVaultPickerForRow(rowIdx);
            } else if (action === 'preview-file') {
                await openFilePreviewModal(item.attachments[attIdx]);
            } else if (action === 'remove-file') {
                item.attachments.splice(attIdx, 1);
                if (item.attachments.length === 0 && item.submitType === 'file_print') {
                    item.prepared = false;
                }
                renderChecklist(); renderPreview(); saveDraft();
            }
        });

        // 개별 행 드래그 앤 드롭 지원
        els.checklistContainer.addEventListener('dragover', (e) => {
            const card = e.target.closest('.doc-item-card');
            if (!card) return;
            e.preventDefault();
            card.classList.add('drag-over-row');
        });
        els.checklistContainer.addEventListener('dragleave', (e) => {
            const card = e.target.closest('.doc-item-card');
            if (card) card.classList.remove('drag-over-row');
        });
        els.checklistContainer.addEventListener('drop', async (e) => {
            const card = e.target.closest('.doc-item-card');
            if (!card) return;
            e.preventDefault();
            card.classList.remove('drag-over-row');
            const rowIdx = parseInt(card.getAttribute('data-row'), 10);
            if (e.dataTransfer?.files?.length && !isNaN(rowIdx)) {
                await handleBatchFilesDrop(e.dataTransfer.files, rowIdx);
            }
        });

        // 줌 컨트롤
        els.btnZoomOut.addEventListener('click', () => setZoom(state.currentZoom - 0.1));
        els.btnZoomIn.addEventListener('click', () => setZoom(state.currentZoom + 0.1));
        els.btnZoomFit.addEventListener('click', () => setZoom(0.75));
        els.btnZoom100.addEventListener('click', () => setZoom(1.0));

        // 보관함 필터 및 액션
        [els.archiveFilterKeyword, els.archiveFilterStatus, els.archiveFilterMonth].forEach(el => {
            el.addEventListener('input', renderArchiveTable);
            el.addEventListener('change', renderArchiveTable);
        });
        els.btnResetArchiveFilter.addEventListener('click', () => {
            els.archiveFilterKeyword.value = '';
            els.archiveFilterStatus.value = '';
            els.archiveFilterMonth.value = '';
            renderArchiveTable();
        });
        els.archiveSelectAll.addEventListener('change', (e) => {
            document.querySelectorAll('.archive-row-chk').forEach(chk => { chk.checked = e.target.checked; });
        });
        els.btnDeleteSelectedPackages.addEventListener('click', async () => {
            const ids = Array.from(document.querySelectorAll('.archive-row-chk:checked')).map(c => c.value);
            if (ids.length === 0) {
                showToast('삭제할 항목을 선택하세요.', 'warning');
                return;
            }
            if (!confirm(`선택한 ${ids.length}건의 이력을 삭제하시겠습니까?`)) return;
            await deletePackageIds(ids);
        });
        els.archiveTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-archive-action]');
            if (!btn) return;
            handleArchiveAction(btn.getAttribute('data-archive-action'), btn.getAttribute('data-id'));
        });

        // 상용서류함 & 프리셋 관리
        els.vaultForm.addEventListener('submit', saveVaultForm);
        els.btnCancelVaultEdit.addEventListener('click', resetVaultForm);
        els.vaultTableBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-vault-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-vault-action');
            const id = btn.getAttribute('data-id');
            const v = state.vault.find(x => x.id === id);
            if (!v) return;

            if (action === 'preview') {
                await openFilePreviewModal({
                    url: v.fileUrl,
                    localBlobId: v.localBlobId,
                    originalName: v.originalName || v.docName,
                    mimeType: v.mimeType
                });
            } else if (action === 'edit') {
                els.vaultEditId.value = v.id;
                els.vaultDocName.value = v.docName || '';
                els.vaultCategory.value = v.category || '법인기본';
                els.vaultIssueDate.value = v.issueDate || '';
                els.vaultValidityDays.value = v.validityDays || 0;
                els.vaultMemo.value = v.memo || '';
                els.vaultCurrentFileInfo.textContent = `기존 파일: ${v.originalName || '첨부됨'} (교체 시에만 새 파일 선택)`;
                els.btnCancelVaultEdit.style.display = 'inline-flex';
                els.vaultDocName.focus();
            } else if (action === 'delete') {
                if (!confirm(`[${v.docName}] 상용서류를 보관함에서 삭제하시겠습니까?`)) return;
                if (state.serverOnline) {
                    await authFetch(`${API_BASE}/vault/${id}`, { method: 'DELETE' }).catch(() => {});
                }
                state.vault = state.vault.filter(x => x.id !== id);
                saveLocalFallbackCache();
                renderVaultTable();
                updateBadges();
                showToast('상용서류가 삭제되었습니다.');
            }
        });

        els.templateListContainer.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-tpl-action]');
            if (!btn) return;
            const action = btn.getAttribute('data-tpl-action');
            const id = btn.getAttribute('data-id');
            const tpl = state.templates.find(t => t.id === id);
            if (!tpl) return;

            if (action === 'use') {
                applyTemplateToEditor(tpl, true);
                if (els.presetSelect) els.presetSelect.value = tpl.id;
                switchTab('editor');
                showToast(`[${tpl.name}] 목록을 불러왔습니다.`);
            } else if (action === 'delete') {
                if (!confirm(`[${tpl.name}] 프리셋을 삭제하시겠습니까?`)) return;
                if (state.serverOnline) {
                    await authFetch(`${API_BASE}/templates/${id}`, { method: 'DELETE' }).catch(() => {});
                }
                state.templates = state.templates.filter(t => t.id !== id);
                saveLocalFallbackCache();
                renderPresetSelect();
                renderTemplateList();
                showToast('프리셋이 삭제되었습니다.');
            }
        });

        // Vault Picker Modal
        els.btnCloseVaultPicker.addEventListener('click', () => els.vaultPickerModal.close());
        els.vaultPickerBody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pick-vault]');
            if (!btn) return;
            const vid = btn.getAttribute('data-pick-vault');
            const v = state.vault.find(x => x.id === vid);
            const rowIdx = state.vaultPickerTargetIdx;
            if (!v || rowIdx === null || !state.items[rowIdx]) return;

            const item = state.items[rowIdx];
            item.attachments.push({
                id: generateUid('VLTREF'),
                url: v.fileUrl || '',
                localBlobId: v.localBlobId || '',
                originalName: v.originalName || `${v.docName}.pdf`,
                mimeType: v.mimeType || 'application/pdf',
                size: v.fileSize || 0,
                fromVaultId: v.id
            });
            item.prepared = true;
            if (v.issueDate && !item.issueDate) item.issueDate = v.issueDate;
            if (v.validityDays && !item.validityDays) item.validityDays = v.validityDays;

            els.vaultPickerModal.close();
            renderChecklist();
            renderPreview();
            saveDraft();

            const val = computeValidityInfo(item.issueDate, item.validityDays);
            if (val && val.status === 'expired') {
                showToast(`첨부 완료 — ⚠️ 유효기간 확인 필요 (${val.label})`, 'warning');
            } else {
                showToast(`[${v.docName}] 상용서류를 첨부했습니다.`);
            }
        });

        // Merged PDF Modal
        els.btnCloseMergedPdf.addEventListener('click', () => els.mergedPdfModal.close());
        els.btnDownloadMergedPdf.addEventListener('click', () => {
            if (!state.mergedPdfBytes) return;
            const safeTitle = (els.inputTitle.value || els.inputDocNo.value || '문서발송패키지').replace(/[<>:"/\\|?*]/g, '_');
            downloadBlobBytes(state.mergedPdfBytes, `${safeTitle}_통합출력본.pdf`);
        });
        els.btnDownloadIndividualPdfs.addEventListener('click', () => {
            if (!state.individualPdfs || state.individualPdfs.length === 0) {
                showToast('저장할 개별 첨부 PDF가 없습니다.', 'info');
                return;
            }
            state.individualPdfs.forEach((entry, idx) => {
                setTimeout(() => downloadBlobBytes(entry.bytes, entry.filename), idx * 220);
            });
            showToast(`총 ${state.individualPdfs.length}개 넘버링 PDF 다운로드를 시작합니다.`);
        });
        els.btnPrintMergedPdf.addEventListener('click', () => {
            if (!state.mergedPdfBlobUrl) return;
            try {
                els.mergedPdfFrame.contentWindow?.focus();
                els.mergedPdfFrame.contentWindow?.print();
            } catch (e) {
                window.open(state.mergedPdfBlobUrl, '_blank');
            }
        });

        // File Preview Modal
        els.btnCloseFilePreview.addEventListener('click', () => els.filePreviewModal.close());

        // Settings Modal (closedby="none" + cancel dirty check)
        els.btnSettings.addEventListener('click', openSettingsModal);
        els.btnCloseSettings.addEventListener('click', requestCloseSettings);
        els.btnCancelSettings.addEventListener('click', requestCloseSettings);
        els.settingsModal.addEventListener('cancel', (e) => {
            if (getSettingsSnapshot() !== initialSettingsSnapshot) {
                e.preventDefault();
                requestCloseSettings();
            }
        });
        els.settingsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            state.company = {
                nameKr: els.setCorpKr.value.trim() || DEFAULT_COMPANY_INFO.nameKr,
                nameEn: els.setCorpEn.value.trim() || DEFAULT_COMPANY_INFO.nameEn,
                bizNum: els.setBizNum.value.trim() || DEFAULT_COMPANY_INFO.bizNum,
                logoUrl: els.setLogoUrl.value.trim() || DEFAULT_COMPANY_INFO.logoUrl,
                address: els.setAddress.value.trim() || DEFAULT_COMPANY_INFO.address,
                tel: els.setTel.value.trim() || DEFAULT_COMPANY_INFO.tel,
                fax: els.setFax.value.trim() || DEFAULT_COMPANY_INFO.fax
            };
            localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(state.company));
            els.settingsModal.close();
            renderPreview();
            showToast('회사 정보가 저장되었습니다.');
        });

        // Dialog returnValue reset & Safari closedby="any" light-dismiss fallback
        document.querySelectorAll('dialog.erp-dialog').forEach(dlg => {
            dlg.addEventListener('close', () => { dlg.returnValue = ''; });
        });
        if (!('closedBy' in HTMLDialogElement.prototype)) {
            const outside = (e, dialog) => {
                const r = dialog.getBoundingClientRect();
                return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
            };
            for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
                let pressedOutside = false;
                dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, dialog); });
                dialog.addEventListener('pointerup', (e) => {
                    if (pressedOutside && outside(e, dialog)) dialog.close();
                });
            }
        }

        // IME-safe Enter guard in text inputs
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.isComposing) return;
        });
    }

    // ── 초기화 ──
    async function init() {
        initElements();
        loadCompanySettings();
        setZoom(0.75);
        await Promise.all([
            detectCurrentUser(),
            loadPartnersDatalist(),
            loadServerData()
        ]);

        const restored = restoreDraft();
        if (!restored) {
            resetNewPackage();
        }
        bindEvents();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
