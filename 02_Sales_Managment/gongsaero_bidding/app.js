/**
 * ══════════════════════════════════════════════════════════════
 * K&G PORTAL - 공새로 입찰관리 FRONTEND LOGIC (ECOUNT ERP STYLE)
 * ══════════════════════════════════════════════════════════════
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/gongsaero-bidding'
    : 'https://kng.junparks.com/api/gongsaero-bidding';

let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    window.parent.getAuthToken().then(t => {
                        if (t) { res(t); }
                        else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                        else { _authReady = Promise.resolve(null); res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = Promise.resolve(null); res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = Promise.resolve(null); res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = Promise.resolve(null); res(null); }
            }
        })();
    });
    return _authReady;
}

async function getAuthToken() {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    if (!token) {
        try { token = await waitForAuth(); } catch(e) {}
    }
    if (!token) token = localStorage.getItem('token');
    return token;
}

// ── 공새로 수수료 공식 (정산단가 -> 수수료) ──
function calcGongsaeroFee(settlementPrice) {
    const sPrice = Math.round(Number(settlementPrice) || 0);
    if (sPrice > 16) {
        return Math.floor(sPrice * 0.06); // 16원 초과: 6% 계산 후 소수점 절삭
    } else if (sPrice >= 1) {
        return 1; // 1원~16원: 최소 수수료 1원
    }
    return 0;
}

// ── 납품단가(낙찰가)로부터 정산단가 및 수수료 역산 (What-If 시뮬레이션용) ──
function calcSettlementFromDelivery(deliveryPrice) {
    const dPrice = Math.round(Number(deliveryPrice) || 0);
    if (dPrice > 17) {
        const settlementPrice = Math.ceil(dPrice / 1.06);
        const fee = dPrice - settlementPrice;
        return { settlementPrice, fee };
    } else if (dPrice >= 1) {
        return { settlementPrice: Math.max(0, dPrice - 1), fee: 1 };
    }
    return { settlementPrice: 0, fee: 0 };
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function resolveAttachmentUrl(attOrUrl) {
    if (!attOrUrl) return '';
    if (typeof attOrUrl === 'object') {
        if (attOrUrl.previewUrl) return attOrUrl.previewUrl;
        return resolveAttachmentUrl(attOrUrl.url || attOrUrl.filename || '');
    }
    const url = String(attOrUrl);
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    const serverOrigin = API_BASE.replace(/\/api\/gongsaero-bidding$/, '');
    if (url.startsWith('/')) {
        return serverOrigin + url;
    }
    return `${API_BASE}/uploads/${encodeURIComponent(url)}`;
}

function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatAttachmentLabel(att, fallbackIdx = 0) {
    if (!att) return `사진 ${fallbackIdx + 1}`;
    const itemTag = att.targetItemNo
        ? `[품목 ${att.targetItemNo}${att.targetItemName ? ': ' + att.targetItemName : ''}]`
        : '';
    const cap = (att.caption || '').trim();
    if (itemTag && cap) return `${itemTag} ${cap}`;
    if (itemTag) return itemTag;
    if (cap) return cap;
    return att.originalName || att.filename || `사진 ${fallbackIdx + 1}`;
}

async function loadAttachmentImageForExcel(att) {
    let blob = null;
    if (att && att.isNew && att.file instanceof Blob) {
        blob = att.file;
    } else {
        const url = resolveAttachmentUrl(att);
        if (!url) throw new Error('이미지 경로가 없습니다.');
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
        blob = await res.blob();
    }

    const objUrl = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('이미지 디코딩 실패'));
            el.src = objUrl;
        });

        const natW = img.naturalWidth || 640;
        const natH = img.naturalHeight || 420;
        const mime = (blob.type || att.mimeType || '').toLowerCase();
        const lowerName = (att.originalName || att.filename || '').toLowerCase();

        let extension = 'png';
        let buffer = null;

        if (mime === 'image/png' || lowerName.endsWith('.png')) {
            extension = 'png';
            buffer = await blob.arrayBuffer();
        } else if (mime === 'image/jpeg' || mime === 'image/jpg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
            extension = 'jpeg';
            buffer = await blob.arrayBuffer();
        } else if (mime === 'image/gif' || lowerName.endsWith('.gif')) {
            extension = 'gif';
            buffer = await blob.arrayBuffer();
        } else {
            // WebP/BMP 등 엑셀 비호환 포맷은 원본 해상도 그대로 무손실 PNG 변환하여 삽입
            const canvas = document.createElement('canvas');
            canvas.width = natW;
            canvas.height = natH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, natW, natH);
            const pngBlob = await new Promise((resolve, reject) => {
                canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png');
            });
            extension = 'png';
            buffer = await pngBlob.arrayBuffer();
        }

        return { buffer, extension, natW, natH };
    } finally {
        URL.revokeObjectURL(objUrl);
    }
}

// ── What-If 가상 마진 및 전략 진단 산출 엔진 ──
function calcWhatIfMetrics(ourBid, winningBid, buyCost, shippingFee, status = '미선정') {
    if (status === '유찰') {
        return {
            diff: 0,
            diffPercent: '0.0',
            simSettlement: 0,
            simFee: 0,
            simProfit: 0,
            simMarginRate: 0,
            badgeClass: 'low',
            diagText: '유찰 (입찰 무효)',
            diagClass: 'bg-secondary text-white',
            strategyText: '유찰 처리 (낙찰가 없음)'
        };
    }

    const ourTotal = Number(ourBid) || 0;
    const winTotal = Number(winningBid) || 0;
    const totalBuy = Number(buyCost) || 0;
    const shipFee = Number(shippingFee) || 0;

    const diff = ourTotal - winTotal;
    const diffPercent = ourTotal > 0 ? ((diff / ourTotal) * 100).toFixed(1) : '0.0';

    const { settlementPrice: simSettlement, fee: simFee } = calcSettlementFromDelivery(winTotal);
    const simProfit = simSettlement - totalBuy - shipFee;
    const simMarginRate = totalBuy > 0 ? Number(((simProfit / totalBuy) * 100).toFixed(1)) : 0;

    let badgeClass = 'mid';
    let diagText = '분석 완료';
    let diagClass = 'bg-primary text-white';
    let strategyText = '정상 투찰 구간';

    if (winTotal <= 0) {
        return {
            diff: 0,
            diffPercent: '0.0',
            simSettlement: 0,
            simFee: 0,
            simProfit: 0,
            simMarginRate: 0,
            badgeClass: 'low',
            diagText: '낙찰가 미입력',
            diagClass: 'bg-secondary text-white',
            strategyText: '결과 입력 대기'
        };
    }

    if (simProfit < 0) {
        badgeClass = 'deficit';
        diagText = '🚨 경쟁사 출혈·역마진 의심 (손실 방어)';
        diagClass = 'bg-danger text-white';
        strategyText = '적자 수주 방어 성공 (무리한 저가경쟁 회피)';
    } else if (status === '낙찰' && simMarginRate >= 15) {
        badgeClass = 'high';
        diagText = '🟢 고마진 우수 수주 성공';
        diagClass = 'bg-success text-white';
        strategyText = '우수 수익성 확보';
    } else if (status === '낙찰') {
        badgeClass = 'mid';
        diagText = '🔵 적정 마진 수주 성공';
        diagClass = 'bg-primary text-white';
        strategyText = '목표 마진 달성';
    } else if (diff > 0 && simMarginRate >= 8) {
        badgeClass = 'mid';
        diagText = '🟡 근소차 패찰 (마진 여력 보유)';
        diagClass = 'bg-warning text-dark';
        strategyText = '차기 입찰 시 3~5% 공격적 단가 조정 검토';
    } else if (diff > 0) {
        badgeClass = 'low';
        diagText = '⚪ 원가 및 단가 초경쟁 구간';
        diagClass = 'bg-secondary text-white';
        strategyText = '제조사 매입단가 인하 협상 필요';
    }

    return {
        diff,
        diffPercent,
        simSettlement,
        simFee,
        simProfit,
        simMarginRate,
        badgeClass,
        diagText,
        diagClass,
        strategyText
    };
}

// ──────────────────────────────────────────────
// 메인 APP 객체
// ──────────────────────────────────────────────
const app = {
    currentView: 'bids', // 'bids' or 'items'
    bidsData: [],
    rawBidsData: [],
    itemsHistoryData: [],
    modalInstance: null,
    quickResultModalInstance: null,
    printPreviewModalInstance: null,
    searchDebounceTimer: null,
    currentDatePreset: 'all',
    selectedBidIds: new Set(),
    currentPrintData: [],
    modalAttachments: [],
    lightboxPhotos: [],
    lightboxIndex: 0,
    lightboxZoomOriginal: false,
    isSavingBid: false,
    _rowUidSeq: 0,

    init: async function() {
        const modalEl = document.getElementById('bidModal');
        if (modalEl) this.modalInstance = new bootstrap.Modal(modalEl);

        const qrModalEl = document.getElementById('quickResultModal');
        if (qrModalEl) this.quickResultModalInstance = new bootstrap.Modal(qrModalEl);

        const printModalEl = document.getElementById('printPreviewModal');
        if (printModalEl) this.printPreviewModalInstance = new bootstrap.Modal(printModalEl);

        this.initPhotoEvents();
        await this.loadBids();
    },

    initPhotoEvents: function() {
        const dropzone = document.getElementById('bidPhotoDropzone');
        if (dropzone) {
            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over');
            });
            dropzone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
            });
            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.appendPendingPhotos(e.dataTransfer.files);
                }
            });
        }

        // Ctrl+V 클립보드 캡처 이미지 붙여넣기 (일반 텍스트/엑셀 셀 붙여넣기와 충돌 방지)
        document.addEventListener('paste', (e) => {
            const bidModalEl = document.getElementById('bidModal');
            if (!bidModalEl || !bidModalEl.classList.contains('show')) return;
            const lightboxEl = document.getElementById('photoLightboxOverlay');
            if (lightboxEl && lightboxEl.style.display !== 'none') return;

            const cb = e.clipboardData;
            if (!cb || !cb.items) return;

            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            const isTypingField = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
            const hasPlainText = Array.from(cb.types || []).includes('text/plain');

            // 인풋 칸 안에서 일반 텍스트(또는 엑셀 셀)를 붙여넣을 때는 기본 텍스트 붙여넣기 허용
            if (isTypingField && hasPlainText) return;

            const imageFiles = [];
            for (const item of cb.items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) {
                        const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
                        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
                        const namedFile = (!file.name || file.name === 'image.png')
                            ? new File([file], `캡처_${stamp}.${ext}`, { type: file.type })
                            : file;
                        imageFiles.push(namedFile);
                    }
                }
            }

            if (imageFiles.length > 0) {
                e.preventDefault();
                this.appendPendingPhotos(imageFiles);
            }
        });

        // 라이트박스 키보드 단축키 (ESC / 좌우 화살표)
        document.addEventListener('keydown', (e) => {
            const lightboxEl = document.getElementById('photoLightboxOverlay');
            if (!lightboxEl || lightboxEl.style.display === 'none') return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeLightbox();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.stepLightbox(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.stepLightbox(1);
            }
        }, true);
    },

    switchView: function(viewName) {
        this.currentView = viewName;
        const tabBidsBtn = document.getElementById('tabBidsBtn');
        const tabItemsBtn = document.getElementById('tabItemsBtn');
        const viewBids = document.getElementById('viewBids');
        const viewItems = document.getElementById('viewItems');

        if (viewName === 'bids') {
            tabBidsBtn.classList.add('active');
            tabItemsBtn.classList.remove('active');
            viewBids.style.display = 'block';
            viewItems.style.display = 'none';
            this.loadBids();
        } else {
            tabItemsBtn.classList.add('active');
            tabBidsBtn.classList.remove('active');
            viewBids.style.display = 'none';
            viewItems.style.display = 'block';
            const query = document.getElementById('globalSearchInput').value.trim();
            this.loadItemHistory(query);
        }
    },

    setDatePreset: function(preset, btnEl) {
        this.currentDatePreset = preset;
        document.querySelectorAll('#datePresetGroup .date-preset-btn').forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');
        this.filterAndRenderBids();
    },

    handleSearchInput: function(event) {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
            const query = event.target.value.trim();
            if (this.currentView === 'bids') {
                this.loadBids();
            } else {
                this.loadItemHistory(query);
            }
        }, 300);
    },

    // ── 공고 목록 로드 ──
    loadBids: async function() {
        const query = document.getElementById('globalSearchInput').value.trim();
        const status = document.getElementById('statusFilter').value;
        const sort = document.getElementById('sortFilter').value;

        const tbody = document.getElementById('bidsTableBody');
        tbody.innerHTML = `
            <tr>
                <td colspan="15" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary mb-2"></div>
                    <div>데이터를 불러오는 중입니다...</div>
                </td>
            </tr>
        `;

        try {
            const token = await getAuthToken();
            const url = new URL(`${API_BASE}/bids`);
            if (status && status !== 'all') url.searchParams.append('status', status);
            if (query) url.searchParams.append('query', query);
            if (sort) url.searchParams.append('sort', sort);

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('데이터 조회 실패');

            const data = await res.json();
            this.rawBidsData = data.bids || [];
            const validIds = new Set(this.rawBidsData.map(b => b.id));
            this.selectedBidIds.forEach(id => {
                if (!validIds.has(id)) this.selectedBidIds.delete(id);
            });
            this.renderKPIs(data.stats || {});
            this.filterAndRenderBids();
        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle fs-4'></i><br>
                        데이터를 불러오는 중 오류가 발생했습니다: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    filterAndRenderBids: function() {
        let filtered = [...this.rawBidsData];
        const now = new Date();

        if (this.currentDatePreset === 'today') {
            const todayStr = now.toISOString().slice(0, 10);
            filtered = filtered.filter(b => (b.bid_deadline || '').startsWith(todayStr) || (b.created_at || '').startsWith(todayStr));
        } else if (this.currentDatePreset === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            filtered = filtered.filter(b => new Date(b.created_at || b.bid_deadline) >= weekAgo);
        } else if (this.currentDatePreset === 'month') {
            const currentMonth = now.toISOString().slice(0, 7);
            filtered = filtered.filter(b => (b.bid_deadline || '').startsWith(currentMonth) || (b.created_at || '').startsWith(currentMonth));
        } else if (this.currentDatePreset === 'prev_month') {
            const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const prevMonthStr = prev.toISOString().slice(0, 7);
            filtered = filtered.filter(b => (b.bid_deadline || '').startsWith(prevMonthStr) || (b.created_at || '').startsWith(prevMonthStr));
        }

        this.bidsData = filtered;
        const query = document.getElementById('globalSearchInput').value.trim();
        this.renderBidsTable(this.bidsData, query);
        this.syncSelectionUI();

        document.getElementById('badgeBidsCount').innerText = this.bidsData.length;
        const summaryEl = document.getElementById('filterResultSummary');
        if (summaryEl) summaryEl.innerText = `총 ${this.bidsData.length}건 조회됨`;
    },

    toggleSelectAllBids: function(checked) {
        if (checked) {
            this.bidsData.forEach(b => this.selectedBidIds.add(b.id));
        } else {
            this.bidsData.forEach(b => this.selectedBidIds.delete(b.id));
        }
        document.querySelectorAll('#bidsTableBody .bid-row-check').forEach(chk => {
            chk.checked = checked;
            const tr = chk.closest('tr');
            if (tr) tr.classList.toggle('row-checked', checked);
        });
        this.syncSelectionUI();
    },

    toggleBidSelection: function(bidId, checked) {
        if (checked) {
            this.selectedBidIds.add(bidId);
        } else {
            this.selectedBidIds.delete(bidId);
        }
        const chk = document.querySelector(`#bidsTableBody .bid-row-check[data-bid-id="${bidId}"]`);
        if (chk) {
            const tr = chk.closest('tr');
            if (tr) tr.classList.toggle('row-checked', checked);
        }
        this.syncSelectionUI();
    },

    syncSelectionUI: function() {
        const chkAll = document.getElementById('chkSelectAllBids');
        if (chkAll) {
            const total = this.bidsData.length;
            const checkedInView = this.bidsData.filter(b => this.selectedBidIds.has(b.id)).length;
            chkAll.checked = total > 0 && checkedInView === total;
            chkAll.indeterminate = checkedInView > 0 && checkedInView < total;
        }
        const badgeEl = document.getElementById('badgeSelectedPrintCount');
        if (badgeEl) {
            const count = this.selectedBidIds.size;
            badgeEl.innerText = count;
            badgeEl.style.display = count > 0 ? 'inline-block' : 'none';
        }
        const excelBadgeEl = document.getElementById('badgeSelectedExcelCount');
        if (excelBadgeEl) {
            const count = this.selectedBidIds.size;
            excelBadgeEl.innerText = count;
            excelBadgeEl.style.display = count > 0 ? 'inline-block' : 'none';
        }
    },

    renderKPIs: function(stats) {
        document.getElementById('kpiBiddingCount').innerHTML = `${Number(stats.bidding_count || 0)}건`;
        document.getElementById('kpiWonCount').innerHTML = `${Number(stats.won_count || 0)}건`;
        document.getElementById('kpiWonAmount').innerText = `${Number(stats.won_amount || 0).toLocaleString()}원`;
        document.getElementById('kpiAvgMargin').innerText = `${Number(stats.avg_won_margin || 0).toFixed(1)}%`;
        document.getElementById('kpiWonProfit').innerText = `${Number(stats.won_profit || 0).toLocaleString()}원`;
    },

    renderBidsTable: function(bids, highlightQuery = '') {
        const tbody = document.getElementById('bidsTableBody');
        if (!bids || bids.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-5 text-muted">
                        <i class='bx bx-folder-open fs-2 text-secondary'></i>
                        <div class="mt-2 fw-bold">등록된 입찰 공고가 없습니다</div>
                        <div class="small text-muted mt-1">상단의 '+ 새 입찰공고 등록' 버튼을 눌러 새로운 공고를 등록해보세요.</div>
                    </td>
                </tr>
            `;
            return;
        }

        const now = new Date();
        tbody.innerHTML = '';

        bids.forEach((b, idx) => {
            const tr = document.createElement('tr');
            const isChecked = this.selectedBidIds.has(b.id);
            if (b.status === '낙찰') tr.classList.add('row-won');
            else if (b.status === '미선정') tr.classList.add('row-lost');
            else if (b.status === '유찰') tr.classList.add('row-failed');
            if (isChecked) tr.classList.add('row-checked');

            // 상태 배지 클래스
            let statusClass = 'bidding';
            if (b.status === '낙찰') statusClass = 'won';
            else if (b.status === '미선정') statusClass = 'lost';
            else if (b.status === '유찰') statusClass = 'failed';
            else if (b.status === '입찰포기') statusClass = 'abandoned';

            // 마감시간 카운트다운
            let deadlineHtml = '-';
            if (b.bid_deadline) {
                const deadlineDate = new Date(b.bid_deadline);
                const diffMs = deadlineDate - now;
                const formattedDate = b.bid_deadline.replace('T', ' ').substring(5, 16);
                
                if (diffMs > 0) {
                    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                    let remainStr = diffHours > 24 
                        ? `D-${Math.ceil(diffHours / 24)}` 
                        : `${diffHours}h 남음`;
                    deadlineHtml = `<div>${formattedDate}</div><span class="badge bg-warning-subtle text-warning border" style="font-size:9.5px; padding:1px 4px;">${remainStr}</span>`;
                } else {
                    deadlineHtml = `<div>${formattedDate}</div><span class="badge bg-secondary-subtle text-secondary border" style="font-size:9.5px; padding:1px 4px;">마감</span>`;
                }
            }

            // 하이라이트 함수
            const hl = (txt) => {
                if (!highlightQuery || !txt) return txt || '';
                const re = new RegExp(`(${highlightQuery})`, 'gi');
                return String(txt).replace(re, `<mark style="background:#fef08a; padding:0 2px;">$1</mark>`);
            };

            const urgencyBadge = b.urgency === '긴급' 
                ? `<span class="badge bg-danger text-white me-1" style="font-size:9.5px; padding:1px 4px;">긴급</span>` 
                : '';

            // ── What-If 및 최종 낙찰가 계산 ──
            const winAmount = Number(b.winning_bid_amount) || 0;
            const whatIf = calcWhatIfMetrics(b.total_delivery_amount, winAmount, b.total_buy_cost, b.estimated_shipping_fee, b.status);

            let winningColHtml = '';
            let whatIfColHtml = '';

            if (b.status === '유찰') {
                const notePreview = b.result_note
                    ? `<div class="text-muted text-truncate" style="font-size: 9.5px; max-width: 165px;" title="${escapeHtml(b.result_note)}">${escapeHtml(b.result_note)}</div>`
                    : '';
                winningColHtml = `
                    <div class="cell-bid-compare">
                        <span class="text-secondary fw-semibold" style="font-size: 11px;">유찰 (낙찰가 없음)</span>
                        ${notePreview}
                    </div>
                `;
                whatIfColHtml = `<div class="text-center text-muted" style="font-size:10px;">해당없음</div>`;
            } else if (winAmount > 0) {
                const diffBadge = whatIf.diff > 0
                    ? `<span class="badge-diff-plus">+${Number(whatIf.diff).toLocaleString()}원 (+${whatIf.diffPercent}%)</span>`
                    : (whatIf.diff < 0 
                        ? `<span class="badge-diff-minus">${Number(whatIf.diff).toLocaleString()}원 (${whatIf.diffPercent}%)</span>`
                        : `<span class="badge bg-success-subtle text-success border" style="font-size:9.5px;">동일금액</span>`);

                winningColHtml = `
                    <div class="cell-bid-compare">
                        <span class="winning-amount-label">${winAmount.toLocaleString()}원</span>
                        <div class="d-flex align-items-center gap-1 mt-1">
                            ${diffBadge}
                            <span class="text-secondary" style="font-size:9.5px;">(${b.winning_company || (b.status === '낙찰' ? '당사' : '타사')})</span>
                        </div>
                    </div>
                `;

                whatIfColHtml = `
                    <div class="text-end">
                        <span class="badge-whatif-margin ${whatIf.badgeClass}">${whatIf.simMarginRate}%</span>
                        <div class="text-muted" style="font-size: 9.5px; margin-top: 1px;">순익: ${Number(whatIf.simProfit).toLocaleString()}원</div>
                    </div>
                `;
            } else if (b.status === '낙찰' || b.status === '미선정') {
                winningColHtml = `
                    <div class="text-end">
                        <button type="button" class="btn-erp btn-erp-xs btn-erp-warning" onclick="app.openQuickResultModal('${b.id}')">
                            <i class='bx bx-edit-alt'></i> 낙찰가 입력
                        </button>
                    </div>
                `;
                whatIfColHtml = `<div class="text-center text-muted" style="font-size:10px;">결과 대기</div>`;
            } else {
                winningColHtml = `<div class="text-center text-muted">-</div>`;
                whatIfColHtml = `<div class="text-center text-muted">-</div>`;
            }

            tr.innerHTML = `
                <td class="text-center">
                    <input type="checkbox" class="form-check-input erp-grid-check bid-row-check" data-bid-id="${escapeHtml(b.id)}" ${isChecked ? 'checked' : ''} onchange="app.toggleBidSelection('${escapeHtml(b.id)}', this.checked)">
                </td>
                <td class="text-center text-muted fw-bold">${idx + 1}</td>
                <td>
                    <span class="status-pill ${statusClass}">
                        ${b.status || '입찰중'}
                    </span>
                </td>
                <td>
                    <div class="fw-bold">
                        ${urgencyBadge}
                        <a href="javascript:app.openEditBidModal('${b.id}')" class="text-dark text-decoration-none" title="공고 상세 수정">
                            ${hl(b.title)}
                        </a>
                        ${(b.attachment_count || 0) > 0 ? `<span class="badge-photo-count" onclick="app.openBidGalleryFromList('${escapeHtml(b.id)}')" title="첨부 사진 ${b.attachment_count}장 원본 보기"><i class='bx bx-image'></i> ${b.attachment_count}</span>` : ''}
                    </div>
                    <div class="text-muted mt-1" style="font-size: 10.5px;">
                        <span class="badge bg-light text-dark border me-1">${b.bid_type || '공개'}</span>
                        <i class='bx bx-map text-secondary'></i> ${hl(b.delivery_address || '주소 미지정')}
                    </div>
                </td>
                <td><span class="fw-semibold">${hl(b.client_name || '-')}</span></td>
                <td>${deadlineHtml}</td>
                <td>
                    <span class="badge bg-light text-secondary border" style="font-size: 10px;">${b.delivery_condition || '하차도'}</span>
                    <span class="text-muted" style="font-size: 10px;">${b.shipping_included ? '운반비포함' : '운반비별도'}</span>
                </td>
                <td class="text-center"><span class="badge bg-primary-subtle text-primary border">${b.item_count || 0}</span></td>
                <td class="text-end text-secondary fw-semibold">${Number(b.total_buy_cost || 0).toLocaleString()}원</td>
                <td class="text-end fw-bold text-primary">${Number(b.total_delivery_amount || 0).toLocaleString()}원</td>
                <td class="text-end">${winningColHtml}</td>
                <td class="text-end">${whatIfColHtml}</td>
                <td class="text-end fw-bold text-success">${Number(b.total_profit || 0).toLocaleString()}원</td>
                <td class="text-end fw-bold">
                    <span class="text-${b.profit_rate >= 15 ? 'success' : (b.profit_rate >= 10 ? 'primary' : 'warning')}">
                        ${Number(b.profit_rate || 0).toFixed(1)}%
                    </span>
                </td>
                <td class="text-center">
                    <div class="dropdown">
                        <button class="btn-erp btn-erp-xs dropdown-toggle" type="button" data-bs-toggle="dropdown">
                            관리
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end shadow-sm" style="font-size: 11.5px;">
                            <li><a class="dropdown-item text-primary fw-bold" href="javascript:app.openQuickResultModal('${b.id}')"><i class='bx bx-trophy'></i> 결과(낙찰가) 등록</a></li>
                            <li><a class="dropdown-item" href="javascript:app.openEditBidModal('${b.id}')"><i class='bx bx-edit'></i> 전표 상세 수정</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><h6 class="dropdown-header py-0" style="font-size: 10px;">상태 빠른 변경</h6></li>
                            <li><a class="dropdown-item text-success" href="javascript:app.quickChangeStatus('${b.id}', '낙찰')"><i class='bx bx-check-circle'></i> 낙찰 (수주 성공)</a></li>
                            <li><a class="dropdown-item text-muted" href="javascript:app.quickChangeStatus('${b.id}', '미선정')"><i class='bx bx-x-circle'></i> 미선정 (탈락)</a></li>
                            <li><a class="dropdown-item" style="color: #6d28d9;" href="javascript:app.quickChangeStatus('${b.id}', '유찰')"><i class='bx bx-minus-circle'></i> 유찰 (입찰 무효)</a></li>
                            <li><a class="dropdown-item text-warning" href="javascript:app.quickChangeStatus('${b.id}', '입찰중')"><i class='bx bx-time'></i> 입찰중 (진행 복원)</a></li>
                            <li><a class="dropdown-item text-danger" href="javascript:app.quickChangeStatus('${b.id}', '입찰포기')"><i class='bx bx-block'></i> 입찰포기</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><a class="dropdown-item text-danger" href="javascript:app.deleteBid('${b.id}')"><i class='bx bx-trash'></i> 공고 삭제</a></li>
                        </ul>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    },

    // ── 품목별 투찰 이력 검색 로드 ──
    loadItemHistory: async function(query = '') {
        const tbody = document.getElementById('itemsHistoryTableBody');
        tbody.innerHTML = `
            <tr>
                <td colspan="13" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary mb-2"></div>
                    <div>품목 투찰 이력을 검색하는 중입니다...</div>
                </td>
            </tr>
        `;

        try {
            const token = await getAuthToken();
            const url = new URL(`${API_BASE}/items/history`);
            if (query) url.searchParams.append('query', query);

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('품목 이력 조회 실패');

            const data = await res.json();
            this.itemsHistoryData = data.items || [];
            document.getElementById('itemHistoryCount').innerText = `${this.itemsHistoryData.length}건 조회됨`;

            if (this.itemsHistoryData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="13" class="text-center py-5 text-muted">
                            <i class='bx bx-search-alt fs-2 text-secondary'></i><br>
                            ${query ? `'${query}'에 대한 품목 투찰 이력이 없습니다.` : '등록된 품목 투찰 데이터가 없습니다.'}
                        </td>
                    </tr>
                `;
                return;
            }

            const hl = (txt) => {
                if (!query || !txt) return txt || '';
                const re = new RegExp(`(${query})`, 'gi');
                return String(txt).replace(re, `<mark style="background:#fef08a; padding:0 2px;">$1</mark>`);
            };

            tbody.innerHTML = '';
            this.itemsHistoryData.forEach(item => {
                const tr = document.createElement('tr');
                let statusBadge = '<span class="status-pill bidding">진행</span>';
                if (item.bid_status === '낙찰') {
                    statusBadge = '<span class="status-pill won">낙찰</span>';
                } else if (item.bid_status === '미선정') {
                    statusBadge = '<span class="status-pill lost">미선정</span>';
                } else if (item.bid_status === '유찰') {
                    statusBadge = '<span class="status-pill failed">유찰</span>';
                } else if (item.bid_status === '입찰포기') {
                    statusBadge = '<span class="status-pill abandoned">입찰포기</span>';
                }

                tr.innerHTML = `
                    <td>${(item.issue_date || item.created_at || '').substring(0, 10)}</td>
                    <td>${statusBadge}</td>
                    <td class="fw-bold">${hl(item.item_name)}</td>
                    <td>${hl(item.spec || '-')}</td>
                    <td class="text-center">${item.unit || 'EA'}</td>
                    <td class="text-end fw-semibold">${Number(item.qty || 0).toLocaleString()}</td>
                    <td class="text-end text-secondary">${Number(item.buy_price || 0).toLocaleString()}원</td>
                    <td class="text-end">${Number(item.margin_rate || 0).toFixed(1)}%</td>
                    <td class="text-end">${Number(item.settlement_price || 0).toLocaleString()}원</td>
                    <td class="text-end text-danger">${Number(item.gongsaero_fee || 0).toLocaleString()}원</td>
                    <td class="text-end fw-bold text-primary">${Number(item.delivery_price || 0).toLocaleString()}원</td>
                    <td class="text-end text-success fw-bold">${Number(item.item_profit || 0).toLocaleString()}원</td>
                    <td><a href="javascript:app.openEditBidModal('${item.bid_id}')" class="text-dark text-decoration-none">${hl(item.bid_title)}</a></td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="13" class="text-center py-4 text-danger">
                        오류 발생: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    // ── [신규] 입찰 결과 빠른 입력 모달 열기 ──
    openQuickResultModal: function(bidId, presetStatus = null) {
        const bid = this.rawBidsData.find(b => b.id === bidId);
        if (!bid) return;

        document.getElementById('qrBidId').value = bid.id;
        document.getElementById('qrBidTitle').innerText = bid.title || '-';
        document.getElementById('qrClientName').innerText = bid.client_name || '-';
        document.getElementById('qrOurBidAmount').value = bid.total_delivery_amount || 0;
        document.getElementById('qrOurBidAmountLabel').innerText = `${Number(bid.total_delivery_amount || 0).toLocaleString()}원`;
        document.getElementById('qrTotalBuyCost').value = bid.total_buy_cost || 0;
        document.getElementById('qrShippingFee').value = bid.estimated_shipping_fee || 0;

        const targetStatus = presetStatus || ((bid.status === '입찰중' || !bid.status) ? '낙찰' : bid.status);
        document.getElementById('qrStatus').value = targetStatus;
        document.getElementById('qrWinningCompany').value = bid.winning_company || (targetStatus === '낙찰' ? '당사(K&G)' : '');
        document.getElementById('qrWinningBidAmount').value = bid.winning_bid_amount > 0 ? bid.winning_bid_amount : (bid.total_delivery_amount || '');
        document.getElementById('qrResultNote').value = bid.result_note || '';

        this.syncQuickResultStatusUI(Boolean(presetStatus));
        if (this.quickResultModalInstance) this.quickResultModalInstance.show();
    },

    syncQuickResultStatusUI: function(autoFillOnSwitch = false) {
        const status = document.getElementById('qrStatus').value;
        const winCompanyEl = document.getElementById('qrWinningCompany');
        const winAmountEl = document.getElementById('qrWinningBidAmount');
        const copyBtn = document.getElementById('qrCopyOurBidBtn');

        if (status === '유찰') {
            winAmountEl.value = '';
            winAmountEl.disabled = true;
            winAmountEl.placeholder = '유찰 건은 입력 불가';
            if (copyBtn) copyBtn.disabled = true;

            winCompanyEl.value = '';
            winCompanyEl.disabled = true;
            winCompanyEl.placeholder = '유찰 (해당없음)';
        } else {
            winAmountEl.disabled = false;
            winAmountEl.placeholder = '예: 3650000';
            if (copyBtn) copyBtn.disabled = false;

            winCompanyEl.disabled = false;
            winCompanyEl.placeholder = '예: 당사(K&G) 또는 경쟁사명';

            if (autoFillOnSwitch) {
                if (status === '낙찰' && (!winCompanyEl.value || winCompanyEl.value === '타사')) {
                    winCompanyEl.value = '당사(K&G)';
                    winAmountEl.value = document.getElementById('qrOurBidAmount').value || 0;
                } else if (status === '미선정' && winCompanyEl.value === '당사(K&G)') {
                    winCompanyEl.value = '';
                }
            }
        }
        this.calcQuickResultSimulation();
    },

    handleQuickResultStatusChange: function() {
        this.syncQuickResultStatusUI(true);
    },

    copyOurBidToWinning: function() {
        if (document.getElementById('qrStatus').value === '유찰') return;
        const ourBid = document.getElementById('qrOurBidAmount').value || 0;
        document.getElementById('qrWinningBidAmount').value = ourBid;
        this.calcQuickResultSimulation();
    },

    // ── 실시간 What-If 시뮬레이션 계산 (Quick Result Modal) ──
    calcQuickResultSimulation: function() {
        const ourBid = parseFloat(document.getElementById('qrOurBidAmount').value) || 0;
        const winningBid = parseFloat(document.getElementById('qrWinningBidAmount').value) || 0;
        const buyCost = parseFloat(document.getElementById('qrTotalBuyCost').value) || 0;
        const shippingFee = parseFloat(document.getElementById('qrShippingFee').value) || 0;
        const status = document.getElementById('qrStatus').value;

        const diffEl = document.getElementById('qrDiffAmount');
        const diffPercentEl = document.getElementById('qrDiffPercent');
        const simSettlementEl = document.getElementById('qrSimSettlement');
        const simFeeEl = document.getElementById('qrSimFee');
        const simProfitEl = document.getElementById('qrSimProfit');
        const simMarginEl = document.getElementById('qrSimMarginRate');
        const diagBadge = document.getElementById('qrDiagnosisBadge');

        if (status === '유찰') {
            diffEl.innerText = '-';
            diffEl.style.color = '#64748b';
            diffPercentEl.innerText = '(유찰)';
            simSettlementEl.innerText = '-';
            simFeeEl.innerText = '수수료: -';
            simProfitEl.innerText = '-';
            simProfitEl.style.color = '#64748b';
            simMarginEl.innerText = '-';
            simMarginEl.style.color = '#64748b';
            diagBadge.className = 'badge text-white';
            diagBadge.style.backgroundColor = '#6d28d9';
            diagBadge.innerText = '유찰 처리 (낙찰가 없음)';
            return;
        }

        diagBadge.style.backgroundColor = '';
        const metrics = calcWhatIfMetrics(ourBid, winningBid, buyCost, shippingFee, status);

        if (metrics.diff > 0) {
            diffEl.innerText = `+${Number(metrics.diff).toLocaleString()}원`;
            diffEl.style.color = '#dc2626';
            diffPercentEl.innerText = `(+${metrics.diffPercent}% 비쌈)`;
        } else if (metrics.diff < 0) {
            diffEl.innerText = `${Number(metrics.diff).toLocaleString()}원`;
            diffEl.style.color = '#059669';
            diffPercentEl.innerText = `(${metrics.diffPercent}% 저렴)`;
        } else {
            diffEl.innerText = `0원`;
            diffEl.style.color = '#0f172a';
            diffPercentEl.innerText = `(동일 금액)`;
        }

        simSettlementEl.innerText = `${Number(metrics.simSettlement).toLocaleString()}원`;
        simFeeEl.innerText = `수수료: ${Number(metrics.simFee).toLocaleString()}원`;

        simProfitEl.innerText = `${Number(metrics.simProfit).toLocaleString()}원`;
        simMarginEl.innerText = `${metrics.simMarginRate}%`;

        if (metrics.simProfit < 0) {
            simProfitEl.style.color = '#dc2626';
            simMarginEl.style.color = '#dc2626';
        } else {
            simProfitEl.style.color = '#059669';
            simMarginEl.style.color = '#059669';
        }

        diagBadge.className = `badge ${metrics.diagClass}`;
        diagBadge.innerText = metrics.diagText;
    },

    // ── 입찰 결과 빠른 저장 ──
    saveQuickResult: async function() {
        const bidId = document.getElementById('qrBidId').value;
        const status = document.getElementById('qrStatus').value;
        const winning_bid_amount = status === '유찰' ? 0 : (parseFloat(document.getElementById('qrWinningBidAmount').value) || 0);
        const winning_company = status === '유찰' ? '' : document.getElementById('qrWinningCompany').value.trim();
        const result_note = document.getElementById('qrResultNote').value.trim();

        try {
            const token = await getAuthToken();
            const res = await fetch(`${API_BASE}/bids/${bidId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    status,
                    winning_bid_amount,
                    winning_company,
                    result_note
                })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '저장 실패');
            }

            if (this.quickResultModalInstance) this.quickResultModalInstance.hide();
            await this.loadBids();
        } catch (err) {
            alert('결과 저장 중 오류: ' + err.message);
        }
    },

    // ── 공고 등록 모달 열기 ──
    openNewBidModal: function() {
        document.getElementById('modalTitle').innerText = '새 입찰공고 등록 및 투찰 전표 작성';
        document.getElementById('editBidId').value = '';
        document.getElementById('formTitle').value = '';
        document.getElementById('formClientName').value = '';
        document.getElementById('formBidType').value = '공개 입찰';
        document.getElementById('formUrgency').value = '일반';
        document.getElementById('formIssueDate').value = new Date().toISOString().slice(0, 16);
        document.getElementById('formBidDeadline').value = '';
        document.getElementById('formDeliveryDeadline').value = '';
        document.getElementById('formStatus').value = '입찰중';
        document.getElementById('formDeliveryAddress').value = '';
        document.getElementById('formDeliveryCondition').value = '하차도';
        document.getElementById('formShippingIncluded').value = '1';
        document.getElementById('formManagerInfo').value = '';
        document.getElementById('formEstimatedShippingFee').value = '';
        document.getElementById('formRemarks').value = '';

        document.getElementById('formWinningBidAmount').value = '';
        document.getElementById('formWinningCompany').value = '';
        document.getElementById('formResultNote').value = '';

        document.getElementById('itemsInputTbody').innerHTML = '';
        this.clearModalAttachments();
        this.renderModalAttachments();
        this.addItemRow(); // 기본 1행
        this.handleModalStatusChange();

        if (this.modalInstance) this.modalInstance.show();
    },

    // ── 공고 상세/수정 모달 열기 ──
    openEditBidModal: async function(bidId) {
        try {
            const token = await getAuthToken();
            const res = await fetch(`${API_BASE}/bids/${bidId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('공고 조회 실패');

            const data = await res.json();
            const bid = data.bid;
            const items = data.items || [];

            document.getElementById('modalTitle').innerText = `공고 수정 및 투찰 전표 (${bid.id})`;
            document.getElementById('editBidId').value = bid.id;
            document.getElementById('formTitle').value = bid.title || '';
            document.getElementById('formClientName').value = bid.client_name || '';
            document.getElementById('formBidType').value = bid.bid_type || '공개 입찰';
            document.getElementById('formUrgency').value = bid.urgency || '일반';
            document.getElementById('formIssueDate').value = (bid.issue_date || '').slice(0, 16);
            document.getElementById('formBidDeadline').value = (bid.bid_deadline || '').slice(0, 16);
            document.getElementById('formDeliveryDeadline').value = (bid.delivery_deadline || '').slice(0, 16);
            document.getElementById('formStatus').value = bid.status || '입찰중';
            document.getElementById('formDeliveryAddress').value = bid.delivery_address || '';
            document.getElementById('formDeliveryCondition').value = bid.delivery_condition || '하차도';
            document.getElementById('formShippingIncluded').value = bid.shipping_included !== undefined ? String(bid.shipping_included) : '1';
            document.getElementById('formManagerInfo').value = bid.manager_info || '';
            document.getElementById('formEstimatedShippingFee').value = bid.estimated_shipping_fee || '';
            document.getElementById('formRemarks').value = bid.remarks || '';

            document.getElementById('formWinningBidAmount').value = bid.winning_bid_amount > 0 ? bid.winning_bid_amount : '';
            document.getElementById('formWinningCompany').value = bid.winning_company || '';
            document.getElementById('formResultNote').value = bid.result_note || '';

            const tbody = document.getElementById('itemsInputTbody');
            tbody.innerHTML = '';
            if (items.length > 0) {
                items.forEach((it, idx) => this.addItemRow(it, idx + 1));
            } else {
                this.addItemRow();
            }

            this.clearModalAttachments();
            const domRows = Array.from(document.querySelectorAll('#itemsInputTbody tr'));
            this.modalAttachments = Array.isArray(bid.attachments)
                ? bid.attachments.map(att => {
                    let rowUid = '';
                    const itemNo = Number(att.targetItemNo) || 0;
                    if (itemNo >= 1 && itemNo <= domRows.length) {
                        rowUid = domRows[itemNo - 1].dataset.rowUid || '';
                    } else if (att.targetItemName) {
                        const matched = domRows.find(r => r.querySelector('.item-name')?.value.trim() === att.targetItemName);
                        if (matched) rowUid = matched.dataset.rowUid || '';
                    }
                    return {
                        ...att,
                        rowUid,
                        targetItemNo: itemNo || null,
                        targetItemName: att.targetItemName || '',
                        caption: att.caption || '',
                        isNew: false
                    };
                })
                : [];
            this.renderModalAttachments();

            this.handleModalStatusChange();
            if (this.modalInstance) this.modalInstance.show();
        } catch (err) {
            alert('공고 정보를 불러오는 중 오류: ' + err.message);
        }
    },

    // ── 모달 상태 변경 시 What-If 패널 표시 토글 ──
    handleModalStatusChange: function() {
        const status = document.getElementById('formStatus').value;
        const panel = document.getElementById('modalResultPanel');
        const winAmountEl = document.getElementById('formWinningBidAmount');
        const winCompanyEl = document.getElementById('formWinningCompany');
        const copyBtn = document.getElementById('formCopyOurBidBtn');

        panel.classList.remove('lost-mode', 'failed-mode');

        if (status === '낙찰' || status === '미선정' || status === '유찰') {
            panel.style.display = 'block';
            if (status === '유찰') {
                panel.classList.add('failed-mode');
                winAmountEl.value = '';
                winAmountEl.disabled = true;
                winAmountEl.placeholder = '유찰 불가';
                if (copyBtn) copyBtn.disabled = true;

                winCompanyEl.value = '';
                winCompanyEl.disabled = true;
                winCompanyEl.placeholder = '유찰 (해당없음)';
            } else {
                winAmountEl.disabled = false;
                winAmountEl.placeholder = '0';
                if (copyBtn) copyBtn.disabled = false;

                winCompanyEl.disabled = false;
                winCompanyEl.placeholder = '당사(K&G) or 타사명';

                if (status === '낙찰') {
                    if (!winCompanyEl.value) {
                        winCompanyEl.value = '당사(K&G)';
                    }
                } else {
                    panel.classList.add('lost-mode');
                }
            }
            this.calcModalWhatIfSimulation();
        } else {
            winAmountEl.disabled = false;
            if (copyBtn) copyBtn.disabled = false;
            winCompanyEl.disabled = false;
            panel.style.display = 'none';
        }
    },

    copyOurBidToModalWinning: function() {
        if (document.getElementById('formStatus').value === '유찰') return;
        let totalDelivery = 0;
        document.querySelectorAll('#itemsInputTbody tr').forEach(tr => {
            const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const delivery = parseFloat(tr.querySelector('.item-delivery').value) || 0;
            totalDelivery += (delivery * qty);
        });
        document.getElementById('formWinningBidAmount').value = Math.round(totalDelivery);
        this.calcModalWhatIfSimulation();
    },

    // ── 실시간 What-If 시뮬레이션 계산 (Edit Modal) ──
    calcModalWhatIfSimulation: function() {
        let totalBuy = 0;
        let totalDelivery = 0;
        document.querySelectorAll('#itemsInputTbody tr').forEach(tr => {
            const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const buy = parseFloat(tr.querySelector('.item-buy').value) || 0;
            const delivery = parseFloat(tr.querySelector('.item-delivery').value) || 0;
            totalBuy += (buy * qty);
            totalDelivery += (delivery * qty);
        });

        const winningBid = parseFloat(document.getElementById('formWinningBidAmount').value) || 0;
        const shippingFee = parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0;
        const status = document.getElementById('formStatus').value;

        const diffEl = document.getElementById('modalSimDiff');
        const diffSubEl = document.getElementById('modalSimDiffSub');
        const settlementEl = document.getElementById('modalSimSettlement');
        const feeEl = document.getElementById('modalSimFee');
        const profitEl = document.getElementById('modalSimProfit');
        const marginEl = document.getElementById('modalSimMarginRate');
        const strategyEl = document.getElementById('modalSimStrategy');
        const strategySubEl = document.getElementById('modalSimStrategySub');
        const diagTag = document.getElementById('modalDiagTag');

        if (status === '유찰') {
            diffEl.innerText = '-';
            diffEl.style.color = '#64748b';
            diffSubEl.innerText = '유찰 (낙찰가 없음)';
            settlementEl.innerText = '-';
            feeEl.innerText = '수수료(6%): -';
            profitEl.innerText = '-';
            profitEl.style.color = '#64748b';
            marginEl.innerText = '가상 마진율: -';
            marginEl.style.color = '#64748b';
            strategyEl.innerText = '유찰 처리 (낙찰업체 없음)';
            strategySubEl.innerText = '결과 사유/메모에 유찰 사유를 기록하세요';
            diagTag.className = 'badge text-white';
            diagTag.style.backgroundColor = '#6d28d9';
            diagTag.innerText = '유찰 (낙찰가 입력 불가)';
            return;
        }

        diagTag.style.backgroundColor = '';
        const metrics = calcWhatIfMetrics(totalDelivery, winningBid, totalBuy, shippingFee, status);

        if (metrics.diff > 0) {
            diffEl.innerText = `+${Number(metrics.diff).toLocaleString()}원`;
            diffEl.style.color = '#dc2626';
            diffSubEl.innerText = `당사가 +${metrics.diffPercent}% 비쌈`;
        } else if (metrics.diff < 0) {
            diffEl.innerText = `${Number(metrics.diff).toLocaleString()}원`;
            diffEl.style.color = '#059669';
            diffSubEl.innerText = `당사가 ${metrics.diffPercent}% 저렴`;
        } else {
            diffEl.innerText = `0원`;
            diffEl.style.color = '#0f172a';
            diffSubEl.innerText = `당사 투찰가와 일치`;
        }

        settlementEl.innerText = `${Number(metrics.simSettlement).toLocaleString()}원`;
        feeEl.innerText = `수수료(6%): ${Number(metrics.simFee).toLocaleString()}원`;

        profitEl.innerText = `${Number(metrics.simProfit).toLocaleString()}원`;
        marginEl.innerText = `가상 마진율: ${metrics.simMarginRate}%`;

        if (metrics.simProfit < 0) {
            profitEl.style.color = '#dc2626';
            marginEl.style.color = '#dc2626';
        } else {
            profitEl.style.color = '#059669';
            marginEl.style.color = '#059669';
        }

        strategyEl.innerText = metrics.strategyText;
        strategySubEl.innerText = metrics.diagText;
        diagTag.className = `badge ${metrics.diagClass}`;
        diagTag.innerText = metrics.diagText;
    },

    // ── 품목 행 추가 ──
    addItemRow: function(data = {}, rowNumber = null) {
        const tbody = document.getElementById('itemsInputTbody');
        const no = rowNumber || (tbody.children.length + 1);
        const tr = document.createElement('tr');
        tr.dataset.itemNo = no;
        tr.dataset.rowUid = data._rowUid || `ROW-${++this._rowUidSeq}`;

        const qty = data.qty !== undefined ? data.qty : 1;
        const buyPrice = data.buy_price || 0;
        const marginRate = data.margin_rate !== undefined ? data.margin_rate : 15;

        let settlementPrice = data.settlement_price || Math.round(buyPrice * (1 + marginRate / 100));
        let deliveryPrice = data.delivery_price || (settlementPrice + calcGongsaeroFee(settlementPrice));
        let fee = data.delivery_price ? Math.max(0, deliveryPrice - settlementPrice) : calcGongsaeroFee(settlementPrice);
        let profit = (settlementPrice - buyPrice) * qty;

        tr.innerHTML = `
            <td class="text-center fw-bold text-muted row-num">${no}</td>
            <td><input type="text" class="item-name form-control" value="${escapeHtml(data.item_name || '')}" placeholder="품목명" oninput="app.refreshPhotoItemSelectOptions()" required></td>
            <td><input type="text" class="item-spec form-control" value="${escapeHtml(data.spec || '')}" placeholder="규격" oninput="app.refreshPhotoItemSelectOptions()"></td>
            <td><input type="text" class="item-unit form-control text-center" value="${escapeHtml(data.unit || 'EA')}"></td>
            <td><input type="number" class="item-qty form-control text-end" value="${qty}" min="0" step="any" oninput="app.recalcRow(this)"></td>
            <td><input type="number" class="item-buy form-control text-end" value="${buyPrice}" min="0" oninput="app.recalcRow(this, 'buy')"></td>
            <td><input type="number" class="item-margin form-control text-end" value="${marginRate}" step="0.5" oninput="app.recalcRow(this, 'margin')"></td>
            <td class="bg-light"><input type="number" class="item-settlement form-control text-end" value="${settlementPrice}" min="0" oninput="app.recalcRow(this, 'settlement')"></td>
            <td class="bg-light"><input type="number" class="item-fee form-control text-end text-danger" value="${fee}" readonly></td>
            <td class="bg-light"><input type="number" class="item-delivery form-control text-end text-primary fw-bold" value="${deliveryPrice}" min="0" oninput="app.recalcRow(this, 'delivery')"></td>
            <td class="text-end fw-bold item-profit-cell text-success bg-light">${Number(profit).toLocaleString()}원</td>
            <td><input type="text" class="item-note form-control" value="${escapeHtml(data.item_note || data.origin_brand || '')}" placeholder="비고"></td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-link text-danger p-0 lh-1" onclick="app.removeItemRow(this)" title="행 삭제">
                    <i class='bx bx-x' style="font-size: 15px; line-height: 1;"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
        this.refreshPhotoItemSelectOptions();
        this.updateSummaryMetrics();
    },

    removeItemRow: function(btn) {
        const tr = btn.closest('tr');
        const removedUid = tr ? tr.dataset.rowUid : '';
        tr.remove();
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        rows.forEach((r, idx) => {
            r.querySelector('.row-num').innerText = idx + 1;
            r.dataset.itemNo = idx + 1;
        });
        if (removedUid && Array.isArray(this.modalAttachments)) {
            this.modalAttachments.forEach(att => {
                if (att.rowUid === removedUid) {
                    att.rowUid = '';
                    att.targetItemNo = null;
                }
            });
        }
        this.syncAttachmentTargetsFromRows();
        this.refreshPhotoItemSelectOptions();
        this.updateSummaryMetrics();
    },

    // ── 실시간 단가 재계산 엔진 ──
    recalcRow: function(element, trigger = 'generic') {
        const tr = element.closest('tr');
        const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
        const buyInput = tr.querySelector('.item-buy');
        const marginInput = tr.querySelector('.item-margin');
        const settlementInput = tr.querySelector('.item-settlement');
        const feeInput = tr.querySelector('.item-fee');
        const deliveryInput = tr.querySelector('.item-delivery');
        const profitCell = tr.querySelector('.item-profit-cell');

        let buyPrice = parseFloat(buyInput.value) || 0;
        let marginRate = parseFloat(marginInput.value) || 0;
        let settlementPrice = parseFloat(settlementInput.value) || 0;
        let deliveryPrice = parseFloat(deliveryInput.value) || 0;

        if (trigger === 'buy' || trigger === 'margin') {
            settlementPrice = Math.round(buyPrice * (1 + marginRate / 100));
            settlementInput.value = settlementPrice;
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        } else if (trigger === 'settlement') {
            if (buyPrice > 0) {
                marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                marginInput.value = marginRate;
            }
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        } else if (trigger === 'delivery') {
            const { settlementPrice: sPrice, fee } = calcSettlementFromDelivery(deliveryPrice);
            settlementPrice = sPrice;
            settlementInput.value = settlementPrice;
            feeInput.value = fee;
            if (buyPrice > 0) {
                marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                marginInput.value = marginRate;
            }
        } else {
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        }

        const profit = (settlementPrice - buyPrice) * qty;
        profitCell.innerText = `${Number(profit).toLocaleString()}원`;

        this.updateSummaryMetrics();
        this.calcModalWhatIfSimulation();
    },

    // ── 모달 하단 요약 매트릭 업데이트 ──
    updateSummaryMetrics: function() {
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        let totalBuy = 0;
        let totalSettlement = 0;
        let totalFee = 0;
        let totalDelivery = 0;
        let totalProfit = 0;

        rows.forEach(tr => {
            const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const buy = parseFloat(tr.querySelector('.item-buy').value) || 0;
            const settlement = parseFloat(tr.querySelector('.item-settlement').value) || 0;
            const fee = parseFloat(tr.querySelector('.item-fee').value) || 0;
            const delivery = parseFloat(tr.querySelector('.item-delivery').value) || 0;

            totalBuy += (buy * qty);
            totalSettlement += (settlement * qty);
            totalFee += (fee * qty);
            totalDelivery += (delivery * qty);
            totalProfit += ((settlement - buy) * qty);
        });

        const shippingFee = parseFloat(document.getElementById('formEstimatedShippingFee')?.value) || 0;
        const shippingIncluded = document.getElementById('formShippingIncluded')?.value === '1';
        
        let netProfit = totalProfit;
        if (shippingIncluded && !this.shippingDistributed && shippingFee > 0) {
            netProfit = totalProfit - shippingFee;
        }

        const profitRate = totalBuy > 0 ? ((netProfit / totalBuy) * 100).toFixed(1) : '0.0';

        document.getElementById('sumBuyCost').innerText = `${Number(totalBuy).toLocaleString()}원`;
        document.getElementById('sumGongsaeroFee').innerText = `${Number(totalFee).toLocaleString()}원`;
        document.getElementById('sumSettlementAmount').innerText = `${Number(totalSettlement).toLocaleString()}원`;
        document.getElementById('sumDeliveryTotal').innerText = `${Number(totalDelivery).toLocaleString()}원`;
        
        const profitEl = document.getElementById('sumProfitAndRate');
        if (profitEl) {
            profitEl.innerText = `${Number(netProfit).toLocaleString()}원 (${profitRate}%)`;
            if (netProfit < 0) {
                profitEl.style.color = '#f87171';
            } else {
                profitEl.style.color = '#4ade80';
            }
        }
    },

    // ── 용차비 품목 안분 ──
    distributeShippingFee: function() {
        const shippingFee = parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0;
        if (shippingFee <= 0) {
            alert('안분할 예상 용차비를 먼저 입력해주세요.');
            return;
        }

        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) return;

        let totalQty = 0;
        rows.forEach(r => totalQty += (parseFloat(r.querySelector('.item-qty').value) || 0));

        if (totalQty <= 0) {
            alert('품목 수량이 0보다 커야 안분할 수 있습니다.');
            return;
        }

        if (!confirm(`총 용차비 ${shippingFee.toLocaleString()}원을 전체 수량(${totalQty}개) 비율로 각 품목 매입가에 배분하시겠습니까?`)) {
            return;
        }

        const feePerUnit = shippingFee / totalQty;
        rows.forEach(r => {
            const buyInput = r.querySelector('.item-buy');
            const currentBuy = parseFloat(buyInput.value) || 0;
            buyInput.value = Math.round(currentBuy + feePerUnit);
            this.recalcRow(buyInput, 'buy');
        });

        this.shippingDistributed = true;
        this.updateSummaryMetrics();
        alert('용차비가 각 품목 매입단가에 정상 안분되었습니다.');
    },

    // ── 13종 품목 샘플 일괄 불러오기 ──
    addSampleTenderItems: function() {
        const samples = [
            { item_name: 'PP로프', spec: '8mm', unit: '롤', qty: 10, buy_price: 13500, margin_rate: 15 },
            { item_name: 'PP로프', spec: '16mm', unit: '롤', qty: 5, buy_price: 32000, margin_rate: 15 },
            { item_name: '톤마대', spec: '500KG', unit: 'EA', qty: 40, buy_price: 4200, margin_rate: 15 },
            { item_name: '케이블타이', spec: '300mm', unit: '롤', qty: 5, buy_price: 5500, margin_rate: 15 },
            { item_name: '이중코팅장갑', spec: '팡이중', unit: 'EA', qty: 50, buy_price: 650, margin_rate: 20 },
            { item_name: '안코팅장갑', spec: '-', unit: 'EA', qty: 100, buy_price: 450, margin_rate: 20 },
            { item_name: '황동 어스 클램프 바이스 집게', spec: '300A', unit: 'EA', qty: 2, buy_price: 8500, margin_rate: 18 },
            { item_name: 'PVC전기절연테이프', spec: '-', unit: 'EA', qty: 10, buy_price: 350, margin_rate: 25 },
            { item_name: '페인트락카', spec: '적색', unit: 'EA', qty: 24, buy_price: 1800, margin_rate: 18 },
            { item_name: '페인트락카', spec: '청색', unit: 'EA', qty: 24, buy_price: 1800, margin_rate: 18 },
            { item_name: '페인트락카', spec: '흰색', unit: 'EA', qty: 24, buy_price: 1800, margin_rate: 18 },
            { item_name: '천막(일반)', spec: '10 X 10 m', unit: 'EA', qty: 5, buy_price: 45000, margin_rate: 15 },
            { item_name: '고압분무기 건', spec: '-', unit: 'EA', qty: 2, buy_price: 18500, margin_rate: 15 }
        ];

        const tbody = document.getElementById('itemsInputTbody');
        tbody.innerHTML = '';
        samples.forEach((s, idx) => {
            this.addItemRow(s, idx + 1);
        });

        if (!document.getElementById('formTitle').value) {
            document.getElementById('formTitle').value = '[(주)범양이앤씨] 청담 1,2교 확장 구조물 공사 | 일회성 입찰';
            document.getElementById('formClientName').value = '(주)범양이앤씨';
            document.getElementById('formUrgency').value = '긴급';
            document.getElementById('formDeliveryAddress').value = '서울 송파구 잠실동 1-1, 내비 종료시 직진 / 담당자 연락';
            document.getElementById('formDeliveryCondition').value = '하차도';
            document.getElementById('formManagerInfo').value = '작성자: 나종수 주임 / 김도현 차장';
            document.getElementById('formEstimatedShippingFee').value = '70000';
        }
    },

    // ── 첨부 사진 관리 및 라이트박스 뷰어 ──
    clearModalAttachments: function() {
        if (Array.isArray(this.modalAttachments)) {
            this.modalAttachments.forEach(att => {
                if (att && att.previewUrl) {
                    try { URL.revokeObjectURL(att.previewUrl); } catch (e) {}
                }
            });
        }
        this.modalAttachments = [];
        const fileInput = document.getElementById('bidPhotoInput');
        if (fileInput) fileInput.value = '';
    },

    handlePhotoInputChange: function(event) {
        const files = event.target.files;
        if (files && files.length > 0) {
            this.appendPendingPhotos(files);
        }
        event.target.value = '';
    },

    appendPendingPhotos: function(fileList) {
        const maxBytes = 50 * 1024 * 1024;
        const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.avif', '.svg'];
        let added = 0;

        Array.from(fileList).forEach((file) => {
            const lowerName = (file.name || '').toLowerCase();
            const hasAllowedExt = allowedExts.some(ext => lowerName.endsWith(ext));
            if (!(file.type && file.type.startsWith('image/')) && !hasAllowedExt) {
                alert(`'${file.name}' 파일은 이미지 형식이 아니므로 제외되었습니다.`);
                return;
            }
            if (file.size > maxBytes) {
                alert(`'${file.name}' 파일 크기가 50MB를 초과하여 첨부할 수 없습니다.`);
                return;
            }

            const tempId = `TEMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            this.modalAttachments.push({
                id: tempId,
                file,
                previewUrl: URL.createObjectURL(file),
                originalName: file.name || 'image.png',
                mimeType: file.type || 'image/jpeg',
                size: file.size || 0,
                rowUid: '',
                targetItemNo: null,
                targetItemName: '',
                caption: '',
                isNew: true
            });
            added++;
        });

        if (added > 0) {
            const bidModalEl = document.getElementById('bidModal');
            if (bidModalEl) bidModalEl._userEdited = true;
            this.renderModalAttachments();
        }
    },

    removeModalAttachment: function(attId) {
        const idx = this.modalAttachments.findIndex(a => a.id === attId);
        if (idx === -1) return;
        const target = this.modalAttachments[idx];
        const prevRowUid = target.rowUid || '';
        if (target && target.previewUrl) {
            try { URL.revokeObjectURL(target.previewUrl); } catch (e) {}
        }
        this.modalAttachments.splice(idx, 1);
        if (prevRowUid) {
            this.syncRowAttachmentNote(prevRowUid);
        }
        const bidModalEl = document.getElementById('bidModal');
        if (bidModalEl) bidModalEl._userEdited = true;
        this.renderModalAttachments();
    },

    getModalItemRowChoices: function() {
        const rows = Array.from(document.querySelectorAll('#itemsInputTbody tr'));
        return rows.map((tr, idx) => {
            const uid = tr.dataset.rowUid || '';
            const name = tr.querySelector('.item-name')?.value.trim() || '(품목명 미입력)';
            const spec = tr.querySelector('.item-spec')?.value.trim() || '';
            return {
                uid,
                no: idx + 1,
                name,
                spec,
                label: `[품목 ${idx + 1}] ${name}${spec ? ` (${spec})` : ''}`
            };
        });
    },

    refreshPhotoItemSelectOptions: function() {
        const stripEl = document.getElementById('modalPhotoStrip');
        if (!stripEl || this.modalAttachments.length === 0) return;
        const choices = this.getModalItemRowChoices();

        stripEl.querySelectorAll('.bid-photo-item-select').forEach(sel => {
            const attId = sel.dataset.attId;
            const att = this.modalAttachments.find(a => a.id === attId);
            const currentUid = att ? (att.rowUid || '') : sel.value;

            sel.innerHTML = `<option value="">📌 공고 공통 (전체 참고)</option>` +
                choices.map(c => `<option value="${escapeHtml(c.uid)}" ${c.uid === currentUid ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
        });
    },

    handlePhotoItemSelectChange: function(attId, newRowUid) {
        const att = this.modalAttachments.find(a => a.id === attId);
        if (!att) return;
        const prevRowUid = att.rowUid || '';
        att.rowUid = newRowUid || '';

        this.syncAttachmentTargetsFromRows();
        if (prevRowUid && prevRowUid !== att.rowUid) {
            this.syncRowAttachmentNote(prevRowUid);
        }
        if (att.rowUid) {
            this.syncRowAttachmentNote(att.rowUid);
        }

        const bidModalEl = document.getElementById('bidModal');
        if (bidModalEl) bidModalEl._userEdited = true;
    },

    handlePhotoCaptionInput: function(attId, value) {
        const att = this.modalAttachments.find(a => a.id === attId);
        if (!att) return;
        att.caption = value;
        const bidModalEl = document.getElementById('bidModal');
        if (bidModalEl) bidModalEl._userEdited = true;
    },

    syncRowAttachmentNote: function(rowUid) {
        if (!rowUid) return;
        const tr = document.querySelector(`#itemsInputTbody tr[data-row-uid="${rowUid}"]`);
        if (!tr) return;
        const noteInput = tr.querySelector('.item-note');
        if (!noteInput) return;

        const linkedCount = this.modalAttachments.filter(a => a.rowUid === rowUid).length;
        const cur = noteInput.value.trim();

        if (linkedCount > 0) {
            if (!cur) {
                noteInput.value = '첨부파일 참고';
            } else if (!cur.includes('첨부')) {
                noteInput.value = `${cur} (첨부파일 참고)`;
            }
        } else {
            if (cur === '첨부파일 참고') {
                noteInput.value = '';
            } else if (cur.endsWith('(첨부파일 참고)')) {
                noteInput.value = cur.slice(0, -'(첨부파일 참고)'.length).trim();
            }
        }
    },

    syncAttachmentTargetsFromRows: function() {
        const rows = Array.from(document.querySelectorAll('#itemsInputTbody tr'));
        const rowMap = new Map();
        rows.forEach((tr, idx) => {
            const uid = tr.dataset.rowUid || '';
            if (uid) {
                rowMap.set(uid, {
                    tr,
                    no: idx + 1,
                    name: tr.querySelector('.item-name')?.value.trim() || '',
                    spec: tr.querySelector('.item-spec')?.value.trim() || ''
                });
            }
        });

        this.modalAttachments.forEach(att => {
            if (att.rowUid && rowMap.has(att.rowUid)) {
                const info = rowMap.get(att.rowUid);
                att.targetItemNo = info.no;
                att.targetItemName = info.name;
                this.syncRowAttachmentNote(att.rowUid);
            } else {
                att.rowUid = '';
                att.targetItemNo = null;
                att.targetItemName = '';
            }
        });
    },

    renderModalAttachments: function() {
        const stripEl = document.getElementById('modalPhotoStrip');
        const badgeEl = document.getElementById('modalPhotoCountBadge');
        const count = this.modalAttachments.length;

        if (badgeEl) {
            badgeEl.innerText = `${count}장`;
            badgeEl.className = count > 0
                ? 'badge bg-primary text-white'
                : 'badge bg-secondary-subtle text-secondary border';
        }
        if (!stripEl) return;

        if (count === 0) {
            stripEl.style.display = 'none';
            stripEl.innerHTML = '';
            return;
        }

        const choices = this.getModalItemRowChoices();
        stripEl.style.display = 'flex';
        stripEl.innerHTML = this.modalAttachments.map((att, idx) => {
            const imgSrc = resolveAttachmentUrl(att);
            const name = att.originalName || att.filename || `사진 ${idx + 1}`;
            const sizeText = formatFileSize(att.size);
            const tooltip = sizeText ? `클릭하여 확대 보기: ${name} (${sizeText})` : `클릭하여 확대 보기: ${name}`;
            const currentUid = att.rowUid || '';
            const selectOptions = `<option value="">📌 공고 공통 (전체 참고)</option>` +
                choices.map(c => `<option value="${escapeHtml(c.uid)}" ${c.uid === currentUid ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');

            return `
                <div class="bid-photo-card">
                    <div class="bid-photo-thumb-wrap" onclick="app.openModalPhotoLightbox(${idx})" title="${escapeHtml(tooltip)}">
                        ${att.isNew ? '<span class="bid-photo-badge-new">신규</span>' : ''}
                        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(name)}" loading="lazy">
                    </div>
                    <div class="bid-photo-controls">
                        <div class="bid-photo-top-row">
                            <select class="bid-photo-item-select" data-att-id="${escapeHtml(att.id)}" onchange="app.handlePhotoItemSelectChange('${escapeHtml(att.id)}', this.value)" title="이 사진이 해당하는 품목을 선택하면 해당 품목 비고에 '첨부파일 참고'가 자동 입력됩니다">
                                ${selectOptions}
                            </select>
                            <button type="button" class="bid-photo-remove-btn" onclick="app.removeModalAttachment('${escapeHtml(att.id)}')" title="첨부 취소/삭제">
                                <i class='bx bx-x'></i>
                            </button>
                        </div>
                        <input type="text" class="bid-photo-caption-input" value="${escapeHtml(att.caption || '')}" placeholder="품목/사진 설명 입력 (선택)" oninput="app.handlePhotoCaptionInput('${escapeHtml(att.id)}', this.value)">
                    </div>
                </div>
            `;
        }).join('');
    },

    openModalPhotoLightbox: function(index = 0) {
        if (!this.modalAttachments || this.modalAttachments.length === 0) return;
        this.syncAttachmentTargetsFromRows();
        this.openLightbox(this.modalAttachments, index);
    },

    openBidGalleryFromList: function(bidId) {
        const bid = this.rawBidsData.find(b => b.id === bidId);
        if (!bid || !Array.isArray(bid.attachments) || bid.attachments.length === 0) return;
        this.openLightbox(bid.attachments, 0);
    },

    openLightbox: function(photos, startIndex = 0) {
        if (!Array.isArray(photos) || photos.length === 0) return;
        this.lightboxPhotos = photos;
        this.lightboxIndex = Math.max(0, Math.min(startIndex, photos.length - 1));
        this.lightboxZoomOriginal = false;

        const overlay = document.getElementById('photoLightboxOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
            this.renderLightboxSlide();
        }
    },

    renderLightboxSlide: function() {
        const total = this.lightboxPhotos.length;
        if (total === 0) return;
        const current = this.lightboxPhotos[this.lightboxIndex];
        const imgSrc = resolveAttachmentUrl(current);
        const rawFileName = current.originalName || current.filename || `사진_${this.lightboxIndex + 1}.png`;
        const displayLabel = formatAttachmentLabel(current, this.lightboxIndex);
        const sizeStr = formatFileSize(current.size);

        const imgEl = document.getElementById('lightboxImageEl');
        const stageEl = document.getElementById('photoLightboxStage');
        const idxBadge = document.getElementById('lightboxIndexBadge');
        const nameEl = document.getElementById('lightboxFileName');
        const sizeEl = document.getElementById('lightboxFileSize');
        const dlBtn = document.getElementById('btnLightboxDownload');
        const zoomBtn = document.getElementById('btnLightboxZoomToggle');
        const prevBtn = document.getElementById('btnLightboxPrev');
        const nextBtn = document.getElementById('btnLightboxNext');

        if (imgEl) imgEl.src = imgSrc;
        if (stageEl) stageEl.classList.toggle('zoom-original', this.lightboxZoomOriginal);
        if (idxBadge) idxBadge.innerText = `${this.lightboxIndex + 1} / ${total}`;
        if (nameEl) nameEl.innerText = displayLabel;
        if (sizeEl) sizeEl.innerText = sizeStr ? `(${sizeStr})` : '';
        if (dlBtn) {
            dlBtn.href = imgSrc;
            dlBtn.setAttribute('download', rawFileName);
        }
        if (zoomBtn) {
            zoomBtn.innerHTML = this.lightboxZoomOriginal
                ? `<i class='bx bx-zoom-out'></i> 화면 맞춤`
                : `<i class='bx bx-zoom-in'></i> 1:1 원본 크기`;
        }
        if (prevBtn) prevBtn.style.display = total > 1 ? 'flex' : 'none';
        if (nextBtn) nextBtn.style.display = total > 1 ? 'flex' : 'none';
    },

    stepLightbox: function(delta) {
        const total = this.lightboxPhotos.length;
        if (total <= 1) return;
        this.lightboxIndex = (this.lightboxIndex + delta + total) % total;
        this.lightboxZoomOriginal = false;
        this.renderLightboxSlide();
    },

    toggleLightboxZoom: function() {
        this.lightboxZoomOriginal = !this.lightboxZoomOriginal;
        this.renderLightboxSlide();
    },

    closeLightbox: function() {
        const overlay = document.getElementById('photoLightboxOverlay');
        const imgEl = document.getElementById('lightboxImageEl');
        if (overlay) overlay.style.display = 'none';
        if (imgEl) imgEl.src = '';
        this.lightboxPhotos = [];
    },

    handleLightboxBackdropClick: function(event) {
        if (event.target.id === 'photoLightboxOverlay' || event.target.id === 'photoLightboxStage') {
            this.closeLightbox();
        }
    },

    // ── 공고 저장 (POST / PUT + 지연 원본 사진 업로드) ──
    saveBid: async function() {
        if (this.isSavingBid) return;
        this.syncAttachmentTargetsFromRows();
        const bidId = document.getElementById('editBidId').value;
        const title = document.getElementById('formTitle').value.trim();
        if (!title) {
            alert('공고/공사명을 입력해주세요.');
            document.getElementById('formTitle').focus();
            return;
        }

        const items = [];
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) {
            alert('최소 1개 이상의 투찰 품목을 추가해주세요.');
            return;
        }

        let hasItemError = false;
        rows.forEach((r, idx) => {
            const name = r.querySelector('.item-name').value.trim();
            if (!name) hasItemError = true;

            items.push({
                item_no: idx + 1,
                item_name: name,
                spec: r.querySelector('.item-spec').value.trim(),
                unit: r.querySelector('.item-unit').value.trim(),
                qty: parseFloat(r.querySelector('.item-qty').value) || 0,
                buy_price: parseFloat(r.querySelector('.item-buy').value) || 0,
                margin_rate: parseFloat(r.querySelector('.item-margin').value) || 0,
                settlement_price: parseFloat(r.querySelector('.item-settlement').value) || 0,
                delivery_price: parseFloat(r.querySelector('.item-delivery').value) || 0,
                item_note: r.querySelector('.item-note').value.trim()
            });
        });

        if (hasItemError) {
            alert('모든 품목의 이름을 입력해주세요.');
            return;
        }

        const status = document.getElementById('formStatus').value;
        const saveBtn = document.getElementById('btnSaveBidModal');
        const origBtnHtml = saveBtn ? saveBtn.innerHTML : '';
        this.isSavingBid = true;
        if (saveBtn) saveBtn.disabled = true;

        let uploadedNewFiles = [];
        try {
            const token = await getAuthToken();
            const pendingPhotos = this.modalAttachments.filter(a => a.isNew && a.file);

            if (pendingPhotos.length > 0) {
                if (saveBtn) {
                    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 사진 업로드 중 (${pendingPhotos.length}장)...`;
                }
                const formData = new FormData();
                pendingPhotos.forEach(p => {
                    formData.append('files', p.file, p.originalName || p.file.name || 'image.png');
                });

                const uploadRes = await fetch(`${API_BASE}/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                if (!uploadRes.ok) {
                    let errMsg = '첨부 사진 업로드에 실패했습니다.';
                    try {
                        const errJson = await uploadRes.json();
                        if (errJson.error) errMsg = errJson.error;
                    } catch (e) {}
                    throw new Error(errMsg);
                }
                const uploadData = await uploadRes.json();
                uploadedNewFiles = Array.isArray(uploadData.files) ? uploadData.files : [];
                if (uploadedNewFiles.length !== pendingPhotos.length) {
                    throw new Error('일부 사진 업로드가 누락되었습니다. 다시 시도해주세요.');
                }
            }

            if (saveBtn) {
                saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 전표 저장 중...`;
            }

            let newIdx = 0;
            const finalAttachments = this.modalAttachments.map(att => {
                if (att.isNew) {
                    const uploaded = uploadedNewFiles[newIdx++];
                    return uploaded ? {
                        ...uploaded,
                        targetItemNo: att.targetItemNo || null,
                        targetItemName: att.targetItemName || '',
                        caption: (att.caption || '').trim()
                    } : null;
                }
                const { isNew, previewUrl, file, rowUid, ...cleanAtt } = att;
                return {
                    ...cleanAtt,
                    targetItemNo: att.targetItemNo || null,
                    targetItemName: att.targetItemName || '',
                    caption: (att.caption || '').trim()
                };
            }).filter(Boolean);

            const payload = {
                title,
                client_name: document.getElementById('formClientName').value.trim(),
                bid_type: document.getElementById('formBidType').value,
                urgency: document.getElementById('formUrgency').value,
                issue_date: document.getElementById('formIssueDate').value,
                bid_deadline: document.getElementById('formBidDeadline').value,
                delivery_deadline: document.getElementById('formDeliveryDeadline').value,
                status,
                delivery_address: document.getElementById('formDeliveryAddress').value.trim(),
                delivery_condition: document.getElementById('formDeliveryCondition').value,
                shipping_included: document.getElementById('formShippingIncluded').value,
                manager_info: document.getElementById('formManagerInfo').value.trim(),
                estimated_shipping_fee: parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0,
                winning_bid_amount: status === '유찰' ? 0 : (parseFloat(document.getElementById('formWinningBidAmount').value) || 0),
                winning_company: status === '유찰' ? '' : document.getElementById('formWinningCompany').value.trim(),
                result_note: document.getElementById('formResultNote').value.trim(),
                remarks: document.getElementById('formRemarks').value.trim(),
                attachments: finalAttachments,
                items
            };

            const method = bidId ? 'PUT' : 'POST';
            const url = bidId ? `${API_BASE}/bids/${bidId}` : `${API_BASE}/bids`;

            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || '저장에 실패했습니다.');
            }

            // 성공 후 업로드된 임시 파일은 이제 DB에 귀속되었으므로 롤백 목록 비움
            uploadedNewFiles = [];
            this.clearModalAttachments();
            const bidModalEl = document.getElementById('bidModal');
            if (bidModalEl) bidModalEl._isForceHiding = true;
            if (this.modalInstance) this.modalInstance.hide();
            await this.loadBids();
        } catch (err) {
            if (uploadedNewFiles.length > 0) {
                try {
                    const token = await getAuthToken();
                    await fetch(`${API_BASE}/uploads/cleanup`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ files: uploadedNewFiles })
                    });
                } catch (cleanupErr) {}
            }
            alert(err.message);
        } finally {
            this.isSavingBid = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origBtnHtml;
            }
        }
    },

    // ── 빠른 상태 변경 ──
    quickChangeStatus: async function(bidId, status) {
        if (status === '낙찰' || status === '미선정' || status === '유찰') {
            this.openQuickResultModal(bidId, status);
            return;
        }

        try {
            const token = await getAuthToken();
            const res = await fetch(`${API_BASE}/bids/${bidId}/status`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error('상태 변경 실패');
            this.loadBids();
        } catch (err) {
            alert(err.message);
        }
    },

    // ── 공고 삭제 ──
    deleteBid: async function(bidId) {
        if (!confirm('이 입찰 공고와 소속된 모든 투찰 품목을 삭제하시겠습니까?')) return;

        try {
            const token = await getAuthToken();
            const res = await fetch(`${API_BASE}/bids/${bidId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('삭제 실패');
            this.selectedBidIds.delete(bidId);
            this.loadBids();
        } catch (err) {
            alert(err.message);
        }
    },

    // ── 공새로 사이트 투찰용 납품단가 일괄 복사 ──
    copyDeliveryPricesToClipboard: function() {
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) {
            alert('복사할 품목이 없습니다.');
            return;
        }

        const lines = [];
        rows.forEach(r => {
            const deliveryPrice = r.querySelector('.item-delivery').value || 0;
            lines.push(`${deliveryPrice}`);
        });

        const textToCopy = lines.join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            alert(`총 ${lines.length}개 품목의 '납품단가'가 클립보드에 복사되었습니다!\n공새로 투찰창에 순서대로 붙여넣으실 수 있습니다.`);
        }).catch(() => {
            prompt('아래 단가 텍스트를 복사(Ctrl+C)하세요:', textToCopy);
        });
    },

    // ── 단건/다중 공고 공통: 양방향 자동계산 + 시트잠금(2833) + 2번 시트(첨부사진) 엑셀 생성 엔진 ──
    generateProtectedTenderWorkbook: async function(records, progressBtn = null) {
        if (typeof ExcelJS === 'undefined') {
            throw new Error('ExcelJS 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        }
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('다운로드할 공고 데이터가 없습니다.');
        }

        const wb = new ExcelJS.Workbook();
        wb.creator = 'K&G Portal - 공새로 입찰관리';
        wb.created = new Date();

        const ws = wb.addWorksheet('투찰단가_산출표', {
            views: [{ state: 'frozen', ySplit: 3 }]
        });

        ws.columns = [
            { key: 'no', width: 6 },
            { key: 'name', width: 28 },
            { key: 'spec', width: 18 },
            { key: 'unit', width: 8 },
            { key: 'qty', width: 10 },
            { key: 'buy', width: 15 },
            { key: 'marginInput', width: 16 },
            { key: 'directDelivery', width: 18 },
            { key: 'settlement', width: 15 },
            { key: 'fee', width: 14 },
            { key: 'finalDelivery', width: 16 },
            { key: 'finalMargin', width: 14 },
            { key: 'totalDelivery', width: 17 },
            { key: 'profit', width: 16 },
            { key: 'note', width: 24 },
            { key: 'bidId', width: 18, hidden: true }
        ];

        const thinBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        // 전체 첨부사진 수집
        const allPhotoEntries = [];
        records.forEach((rec, bIdx) => {
            const bid = rec.bid || {};
            const items = Array.isArray(rec.items) ? rec.items : [];
            const specByNo = {};
            items.forEach((it, idx) => {
                specByNo[(it.item_no || (idx + 1))] = (it.spec || '').trim();
            });
            const atts = Array.isArray(bid.attachments) ? bid.attachments : [];
            atts.forEach(att => {
                allPhotoEntries.push({
                    bidIdx: bIdx + 1,
                    totalBids: records.length,
                    bidId: bid.id || '',
                    bidTitle: bid.title || '-',
                    att,
                    itemSpec: att.targetItemNo ? (specByNo[Number(att.targetItemNo)] || '') : ''
                });
            });
        });

        // 1행: 타이틀 배너
        ws.mergeCells('A1:O1');
        const titleCell = ws.getCell('A1');
        titleCell.value = records.length > 1
            ? `공새로 입찰관리 — 담당자 매입원가 및 투찰단가 산출서 (선택 공고 ${records.length}건 통합)`
            : `공새로 입찰관리 — 담당자 매입원가 및 투찰단가 산출서`;
        titleCell.font = { name: '맑은 고딕', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        ws.getRow(1).height = 28;

        // 2행: 작성 안내 배너 + 우측 고정 6% 공새로 수수료율 잠금 셀($O$2)
        ws.mergeCells('A2:M2');
        const guideCell = ws.getCell('A2');
        const photoGuideSuffix = allPhotoEntries.length > 0
            ? `  |  📎 첨부사진 총 ${allPhotoEntries.length}장 → 하단 [첨부사진] 시트 탭을 확인하세요!`
            : '';
        guideCell.value = `💡 작성 방법: 노란색·하늘색 칸만 입력 가능합니다. ① [K&G 매입가 + 희망마진(%)]을 적으면 최종 투찰단가가 자동 산출되며, ② [직접지정 투찰단가(하늘색)]에 금액을 적으면 해당 단가가 우선 적용되어 최종 마진율이 자동 역산됩니다.${photoGuideSuffix}`;
        guideCell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF1E3A8A' } };
        guideCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
        guideCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };

        ws.getCell('N2').value = '공새로 수수료율 🔒';
        ws.getCell('N2').font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF991B1B' } };
        ws.getCell('N2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        ws.getCell('N2').alignment = { vertical: 'middle', horizontal: 'center' };

        ws.getCell('O2').value = 0.06;
        ws.getCell('O2').numFmt = '0.0%';
        ws.getCell('O2').font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FFDC2626' } };
        ws.getCell('O2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
        ws.getCell('O2').alignment = { vertical: 'middle', horizontal: 'right' };

        for (let c = 1; c <= 15; c++) {
            ws.getRow(2).getCell(c).border = thinBorder;
        }
        ws.getRow(2).height = 24;

        // 3행: 고정 컬럼 헤더 (스크롤 시 상단 고정)
        const headers = [
            'No',
            '품목명 🔒',
            '규격 🔒',
            '단위 🔒',
            '수량 🔒',
            '✏️ K&G 매입가',
            '✏️ 희망마진(%)',
            '✏️ 직접지정 투찰단가',
            '정산단가(자동)',
            '수수료 6% 🔒',
            '최종 투찰단가',
            '최종 마진율(%)',
            '최종 납품합계',
            '예상 순이익',
            '✏️ 비고',
            '공고ID'
        ];
        const headerRow = ws.getRow(3);
        headerRow.height = 26;
        headers.forEach((hText, idx) => {
            const colNum = idx + 1;
            const cell = headerRow.getCell(colNum);
            cell.value = hText;
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'medium', color: { argb: 'FF475569' } },
                bottom: { style: 'medium', color: { argb: 'FF475569' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };

            if (colNum === 6 || colNum === 7) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF08A' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF854D0E' } };
            } else if (colNum === 8) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBAE6FD' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF075985' } };
            } else if (colNum === 10) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FFB91C1C' } };
            } else if (colNum === 11) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF1E40AF' } };
            } else if (colNum === 15) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF334155' } };
            } else {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF334155' } };
            }
        });

        const unlockedItemRowNums = [];
        const subtotalRowNums = [];
        let curRow = 4;

        let grandQtyInit = 0;
        let grandBuyInit = 0;
        let grandSettlementInit = 0;
        let grandFeeInit = 0;
        let grandDeliveryInit = 0;
        let grandProfitInit = 0;

        records.forEach((rec, bIdx) => {
            const bid = rec.bid || {};
            const items = Array.isArray(rec.items) ? rec.items : [];
            const bidAttachments = Array.isArray(bid.attachments) ? bid.attachments : [];
            const hasGeneralBidPhoto = bidAttachments.some(a => !Number(a.targetItemNo));

            const bidDeadline = String(bid.bid_deadline || '').replace('T', ' ').slice(0, 16) || '-';
            const deliveryDeadline = String(bid.delivery_deadline || '').replace('T', ' ').slice(0, 16) || '-';
            const deliveryCondition = bid.delivery_condition || '하차도';
            const shippingIncluded = Number(bid.shipping_included ?? 1) === 1;
            const shippingFee = Number(bid.estimated_shipping_fee) || 0;

            // 공고 섹션 헤더 바 1: 공고명 / 발주처 / 마감일 / 첨부사진 수
            const secRow1 = curRow++;
            ws.mergeCells(`A${secRow1}:O${secRow1}`);
            const secCell1 = ws.getCell(`A${secRow1}`);
            const photoTag = bidAttachments.length > 0 ? `   |   🖼️ 첨부사진 ${bidAttachments.length}장 (첨부사진 시트 참고)` : '';
            const idDisplay = bid.id ? ` (${bid.id})` : '';
            secCell1.value = `📌 [공고 ${bIdx + 1}] ${bid.title || '-'}${idDisplay}   |   발주처: ${bid.client_name || '-'}   |   투찰마감: ${bidDeadline}   |   인도조건: ${deliveryCondition}(${shippingIncluded ? '단가포함' : '별도청구'})${photoTag}`;
            secCell1.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            secCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
            secCell1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            ws.getRow(secRow1).getCell(16).value = bid.id || '';
            ws.getRow(secRow1).height = 23;

            // 공고 섹션 헤더 바 2: 납품주소 / 납품기한 / 용차비 / 비고
            const secRow2 = curRow++;
            ws.mergeCells(`A${secRow2}:O${secRow2}`);
            const secCell2 = ws.getCell(`A${secRow2}`);
            const extraMemo = [bid.manager_info, bid.remarks].filter(Boolean).join(' / ');
            secCell2.value = `📍 납품주소: ${bid.delivery_address || '-'}   |   납품기한: ${deliveryDeadline}   |   예상용차비: ${shippingFee.toLocaleString()}원${extraMemo ? `   |   담당/메모: ${extraMemo}` : ''}`;
            secCell2.font = { name: '맑은 고딕', size: 9, bold: true, color: { argb: 'FF334155' } };
            secCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
            secCell2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            for (let c = 1; c <= 15; c++) {
                ws.getRow(secRow2).getCell(c).border = thinBorder;
            }
            ws.getRow(secRow2).height = 19;

            const itemStartRow = curRow;
            let sumQtyInit = 0;
            let sumBuyTotalInit = 0;
            let sumSettlementTotalInit = 0;
            let sumFeeTotalInit = 0;
            let sumDeliveryTotalInit = 0;
            let sumProfitTotalInit = 0;

            const effectiveItems = items.length > 0 ? items : [{ item_no: 1, item_name: '(등록된 품목 없음)', spec: '', unit: 'EA', qty: 0, buy_price: 0, margin_rate: 15 }];

            effectiveItems.forEach((it, idx) => {
                const rNum = curRow++;
                unlockedItemRowNums.push(rNum);
                const row = ws.getRow(rNum);
                row.height = 22;

                const itemNo = it.item_no || (idx + 1);
                const itemName = String(it.item_name || '').trim();
                const spec = String(it.spec || '').trim();
                const unit = String(it.unit || 'EA').trim() || 'EA';
                const qty = Number(it.qty) || 0;
                const buyPrice = Math.round(Number(it.buy_price) || 0);
                const marginRate = it.margin_rate !== undefined && it.margin_rate !== null ? Number(it.margin_rate) : 15;
                const currentSettlement = Math.round(Number(it.settlement_price) || 0);
                const currentDelivery = Math.round(Number(it.delivery_price) || 0);
                let note = String(it.item_note || it.origin_brand || '').trim();

                // 품목별 연결 사진 또는 공고 공통 사진이 있으면 비고에 '첨부파일 참고' 자동 표기
                const hasLinkedPhoto = hasGeneralBidPhoto || bidAttachments.some(a => Number(a.targetItemNo) === itemNo);
                if (hasLinkedPhoto) {
                    if (!note) note = '첨부파일 참고';
                    else if (!note.includes('첨부')) note = `${note} (첨부파일 참고)`;
                }

                const mode1Settlement = buyPrice > 0 ? Math.round(buyPrice * (1 + marginRate / 100)) : 0;
                const mode1Delivery = mode1Settlement + calcGongsaeroFee(mode1Settlement);
                const hasCustomDirectDelivery = currentDelivery > 0 && currentDelivery !== mode1Delivery && (buyPrice === 0 || currentSettlement !== mode1Settlement);

                const initDirectDelivery = hasCustomDirectDelivery ? currentDelivery : null;
                let initSettlement = 0;
                let initFee = 0;
                let initFinalDelivery = 0;
                if (initDirectDelivery && initDirectDelivery > 0) {
                    const rev = calcSettlementFromDelivery(initDirectDelivery);
                    initSettlement = rev.settlementPrice;
                    initFee = rev.fee;
                    initFinalDelivery = initDirectDelivery;
                } else {
                    initSettlement = mode1Settlement;
                    initFee = calcGongsaeroFee(initSettlement);
                    initFinalDelivery = initSettlement + initFee;
                }
                const initFinalMargin = buyPrice > 0
                    ? Number(((initSettlement - buyPrice) / buyPrice * 100).toFixed(1))
                    : (initDirectDelivery ? 0 : marginRate);
                const initTotalDelivery = initFinalDelivery * qty;
                const initProfit = (initSettlement - buyPrice) * qty;

                sumQtyInit += qty;
                sumBuyTotalInit += (buyPrice * qty);
                sumSettlementTotalInit += (initSettlement * qty);
                sumFeeTotalInit += (initFee * qty);
                sumDeliveryTotalInit += initTotalDelivery;
                sumProfitTotalInit += initProfit;

                row.getCell(1).value = itemNo;
                row.getCell(2).value = itemName;
                row.getCell(3).value = spec;
                row.getCell(4).value = unit;
                row.getCell(5).value = qty;

                row.getCell(6).value = buyPrice > 0 ? buyPrice : null;
                row.getCell(7).value = marginRate;
                row.getCell(8).value = initDirectDelivery;

                // 양방향 자동계산 수식 ($O$2 = 6.0% 공새로 고정 수수료 셀)
                row.getCell(9).value = {
                    formula: `IF(AND(ISNUMBER(H${rNum}),H${rNum}>0),IF(ROUND(H${rNum},0)>17,ROUNDUP(ROUND(H${rNum},0)/(1+$O$2),0),IF(ROUND(H${rNum},0)>=1,MAX(0,ROUND(H${rNum},0)-1),0)),IF(AND(ISNUMBER(F${rNum}),F${rNum}>0),ROUND(F${rNum}*(1+IF(ISNUMBER(G${rNum}),G${rNum},0)/100),0),0))`,
                    result: initSettlement
                };
                row.getCell(10).value = {
                    formula: `IF(AND(ISNUMBER(H${rNum}),H${rNum}>0),MAX(0,ROUND(H${rNum},0)-I${rNum}),IF(I${rNum}>16,ROUNDDOWN(I${rNum}*$O$2,0),IF(I${rNum}>=1,1,0)))`,
                    result: initFee
                };
                row.getCell(11).value = {
                    formula: `IF(AND(ISNUMBER(H${rNum}),H${rNum}>0),ROUND(H${rNum},0),I${rNum}+J${rNum})`,
                    result: initFinalDelivery
                };
                row.getCell(12).value = {
                    formula: `IF(AND(ISNUMBER(F${rNum}),F${rNum}>0),ROUND((I${rNum}-F${rNum})/F${rNum}*100,1),IF(AND(ISNUMBER(G${rNum}),NOT(AND(ISNUMBER(H${rNum}),H${rNum}>0))),G${rNum},0))`,
                    result: initFinalMargin
                };
                row.getCell(13).value = {
                    formula: `K${rNum}*E${rNum}`,
                    result: initTotalDelivery
                };
                row.getCell(14).value = {
                    formula: `IF(OR(AND(ISNUMBER(F${rNum}),F${rNum}>0),I${rNum}>0),(I${rNum}-IF(ISNUMBER(F${rNum}),F${rNum},0))*E${rNum},0)`,
                    result: initProfit
                };

                row.getCell(15).value = note;
                row.getCell(16).value = bid.id || '';

                for (let c = 1; c <= 15; c++) {
                    const cell = row.getCell(c);
                    cell.border = thinBorder;
                    cell.font = { name: '맑은 고딕', size: 9.5, color: { argb: 'FF1E293B' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                }

                row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
                row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(2).alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell(2).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(3).alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
                row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(5).numFmt = '#,##0.##';
                row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

                row.getCell(6).numFmt = '#,##0';
                row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFCE8' } };
                row.getCell(6).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0F172A' } };

                row.getCell(7).numFmt = '0.0';
                row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEFCE8' } };
                row.getCell(7).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF854D0E' } };

                row.getCell(8).numFmt = '#,##0';
                row.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
                row.getCell(8).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF0369A1' } };

                row.getCell(9).numFmt = '#,##0';
                row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

                row.getCell(10).numFmt = '#,##0';
                row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF2F2' } };
                row.getCell(10).font = { name: '맑은 고딕', size: 9.5, color: { argb: 'FFDC2626' } };

                row.getCell(11).numFmt = '#,##0';
                row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
                row.getCell(11).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };

                row.getCell(12).numFmt = '0.0"%"';
                row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(12).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF334155' } };

                row.getCell(13).numFmt = '#,##0';
                row.getCell(13).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                row.getCell(13).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };

                row.getCell(14).numFmt = '#,##0;[Red]-#,##0;0';
                row.getCell(14).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0FDF4' } };
                row.getCell(14).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF059669' } };

                row.getCell(15).alignment = { vertical: 'middle', horizontal: 'left' };
            });

            const itemEndRow = curRow - 1;
            const subRowIdx = curRow++;
            subtotalRowNums.push(subRowIdx);
            const subRow = ws.getRow(subRowIdx);
            subRow.height = 24;

            ws.mergeCells(`A${subRowIdx}:D${subRowIdx}`);
            subRow.getCell(1).value = records.length > 1
                ? `소 계 — [공고 ${bIdx + 1}] (${effectiveItems.length}개 품목)`
                : `총 합 계 (${effectiveItems.length}개 품목)`;
            subRow.getCell(5).value = { formula: `SUM(E${itemStartRow}:E${itemEndRow})`, result: sumQtyInit };
            subRow.getCell(6).value = { formula: `SUMPRODUCT(E${itemStartRow}:E${itemEndRow},F${itemStartRow}:F${itemEndRow})`, result: sumBuyTotalInit };
            subRow.getCell(7).value = '-';
            subRow.getCell(8).value = '-';
            subRow.getCell(9).value = { formula: `SUMPRODUCT(E${itemStartRow}:E${itemEndRow},I${itemStartRow}:I${itemEndRow})`, result: sumSettlementTotalInit };
            subRow.getCell(10).value = { formula: `SUMPRODUCT(E${itemStartRow}:E${itemEndRow},J${itemStartRow}:J${itemEndRow})`, result: sumFeeTotalInit };
            subRow.getCell(11).value = '-';
            subRow.getCell(12).value = {
                formula: `IF(F${subRowIdx}>0,ROUND(N${subRowIdx}/F${subRowIdx}*100,1),0)`,
                result: sumBuyTotalInit > 0 ? Number(((sumProfitTotalInit / sumBuyTotalInit) * 100).toFixed(1)) : 0
            };
            subRow.getCell(13).value = { formula: `SUM(M${itemStartRow}:M${itemEndRow})`, result: sumDeliveryTotalInit };
            subRow.getCell(14).value = { formula: `SUM(N${itemStartRow}:N${itemEndRow})`, result: sumProfitTotalInit };
            subRow.getCell(15).value = '';

            for (let c = 1; c <= 15; c++) {
                const cell = subRow.getCell(c);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FF64748B' } },
                    bottom: { style: 'medium', color: { argb: 'FF475569' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
            subRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
            subRow.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
            subRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
            subRow.getCell(11).alignment = { vertical: 'middle', horizontal: 'center' };
            subRow.getCell(5).numFmt = '#,##0.##';
            subRow.getCell(6).numFmt = '#,##0';
            subRow.getCell(9).numFmt = '#,##0';
            subRow.getCell(10).numFmt = '#,##0';
            subRow.getCell(10).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
            subRow.getCell(12).numFmt = '0.0"%"';
            subRow.getCell(13).numFmt = '#,##0';
            subRow.getCell(13).font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FF1D4ED8' } };
            subRow.getCell(14).numFmt = '#,##0;[Red]-#,##0;0';
            subRow.getCell(14).font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF059669' } };

            grandQtyInit += sumQtyInit;
            grandBuyInit += sumBuyTotalInit;
            grandSettlementInit += sumSettlementTotalInit;
            grandFeeInit += sumFeeTotalInit;
            grandDeliveryInit += sumDeliveryTotalInit;
            grandProfitInit += sumProfitTotalInit;

            if (bIdx < records.length - 1) {
                ws.getRow(curRow++).height = 10;
            }
        });

        // 다중 공고인 경우 최하단 전체 총합계 행 추가
        if (records.length > 1 && subtotalRowNums.length > 0) {
            ws.getRow(curRow++).height = 6;
            const gRowIdx = curRow++;
            const gRow = ws.getRow(gRowIdx);
            gRow.height = 26;

            const sumExpr = (colLetter) => subtotalRowNums.map(r => `${colLetter}${r}`).join('+');
            ws.mergeCells(`A${gRowIdx}:D${gRowIdx}`);
            gRow.getCell(1).value = `총 합 계 (선택 공고 ${records.length}건 전체)`;
            gRow.getCell(5).value = { formula: sumExpr('E'), result: grandQtyInit };
            gRow.getCell(6).value = { formula: sumExpr('F'), result: grandBuyInit };
            gRow.getCell(7).value = '-';
            gRow.getCell(8).value = '-';
            gRow.getCell(9).value = { formula: sumExpr('I'), result: grandSettlementInit };
            gRow.getCell(10).value = { formula: sumExpr('J'), result: grandFeeInit };
            gRow.getCell(11).value = '-';
            gRow.getCell(12).value = {
                formula: `IF(F${gRowIdx}>0,ROUND(N${gRowIdx}/F${gRowIdx}*100,1),0)`,
                result: grandBuyInit > 0 ? Number(((grandProfitInit / grandBuyInit) * 100).toFixed(1)) : 0
            };
            gRow.getCell(13).value = { formula: sumExpr('M'), result: grandDeliveryInit };
            gRow.getCell(14).value = { formula: sumExpr('N'), result: grandProfitInit };
            gRow.getCell(15).value = '';

            for (let c = 1; c <= 15; c++) {
                const cell = gRow.getCell(c);
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCBD5E1' } };
                cell.font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF0F172A' } };
                cell.border = {
                    top: { style: 'medium', color: { argb: 'FF1E293B' } },
                    bottom: { style: 'double', color: { argb: 'FF0F172A' } },
                    left: { style: 'thin', color: { argb: 'FF94A3B8' } },
                    right: { style: 'thin', color: { argb: 'FF94A3B8' } }
                };
                cell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
            gRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
            gRow.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
            gRow.getCell(8).alignment = { vertical: 'middle', horizontal: 'center' };
            gRow.getCell(11).alignment = { vertical: 'middle', horizontal: 'center' };
            gRow.getCell(5).numFmt = '#,##0.##';
            gRow.getCell(6).numFmt = '#,##0';
            gRow.getCell(9).numFmt = '#,##0';
            gRow.getCell(10).numFmt = '#,##0';
            gRow.getCell(10).font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FFDC2626' } };
            gRow.getCell(12).numFmt = '0.0"%"';
            gRow.getCell(13).numFmt = '#,##0';
            gRow.getCell(13).font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF1D4ED8' } };
            gRow.getCell(14).numFmt = '#,##0;[Red]-#,##0;0';
            gRow.getCell(14).font = { name: '맑은 고딕', size: 10.5, bold: true, color: { argb: 'FF059669' } };
        }

        // 시트 전체 기본 잠금 후, 품목 데이터 행의 입력 허용 4개 열(F, G, H, O)만 잠금 해제
        const maxRowIdx = curRow - 1;
        for (let r = 1; r <= maxRowIdx; r++) {
            const rowObj = ws.getRow(r);
            for (let c = 1; c <= 16; c++) {
                rowObj.getCell(c).protection = { locked: true };
            }
        }
        unlockedItemRowNums.forEach(r => {
            const rowObj = ws.getRow(r);
            rowObj.getCell(6).protection = { locked: false };  // K&G 매입가
            rowObj.getCell(7).protection = { locked: false };  // 희망마진(%)
            rowObj.getCell(8).protection = { locked: false };  // 직접지정 투찰단가
            rowObj.getCell(15).protection = { locked: false }; // 비고
        });

        await ws.protect('2833', {
            selectLockedCells: true,
            selectUnlockedCells: true,
            formatCells: false,
            formatColumns: false,
            formatRows: false,
            insertColumns: false,
            insertRows: false,
            insertHyperlinks: false,
            deleteColumns: false,
            deleteRows: false,
            sort: false,
            autoFilter: false,
            pivotTables: false
        });

        // ── 2번 시트: 첨부사진 (선택된 공고들 중 첨부사진이 1장이라도 있으면 자동 생성) ──
        if (allPhotoEntries.length > 0) {
            if (progressBtn) {
                progressBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 첨부사진 시트 생성 중 (${allPhotoEntries.length}장)...`;
            }

            const wsPhotos = wb.addWorksheet('첨부사진', {
                views: [{ state: 'frozen', ySplit: 2 }]
            });
            wsPhotos.columns = [
                { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
                { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }
            ];

            wsPhotos.mergeCells('A1:H1');
            const pTitle = wsPhotos.getCell('A1');
            pTitle.value = '공새로 입찰관리 — 공고·품목별 첨부 사진 및 사양 참고자료';
            pTitle.font = { name: '맑은 고딕', size: 12.5, bold: true, color: { argb: 'FFFFFFFF' } };
            pTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
            pTitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            wsPhotos.getRow(1).height = 26;

            wsPhotos.mergeCells('A2:H2');
            const pSub = wsPhotos.getCell('A2');
            pSub.value = `대상 공고: ${records.length}건   |   총 첨부 사진: ${allPhotoEntries.length}장 (각 사진 상단의 소속 공고 및 대상 품목을 확인하세요)`;
            pSub.font = { name: '맑은 고딕', size: 9.5, bold: true, color: { argb: 'FF1E3A8A' } };
            pSub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
            pSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            pSub.border = thinBorder;
            wsPhotos.getRow(2).height = 20;

            let pRow = 4;
            for (let i = 0; i < allPhotoEntries.length; i++) {
                const entry = allPhotoEntries[i];
                const att = entry.att;
                const itemNo = Number(att.targetItemNo) || 0;
                const itemName = (att.targetItemName || '').trim();
                const cap = (att.caption || '').trim();
                const origName = att.originalName || att.filename || `사진_${i + 1}`;

                const bidPrefix = entry.totalBids > 1
                    ? `[공고 ${entry.bidIdx}: ${entry.bidTitle}]  ▶  `
                    : '';

                let headerLabel = `📷 [사진 ${i + 1}] ${bidPrefix}`;
                if (itemNo > 0) {
                    headerLabel += `대상 품목: [No.${itemNo}] ${itemName}${entry.itemSpec ? ` (${entry.itemSpec})` : ''}`;
                    if (cap) headerLabel += `  —  ${cap}`;
                } else if (cap) {
                    headerLabel += `설명: ${cap}`;
                } else {
                    headerLabel += `공고 공통 참고 사진 (${origName})`;
                }

                wsPhotos.mergeCells(`A${pRow}:H${pRow}`);
                const hdrCell = wsPhotos.getCell(`A${pRow}`);
                hdrCell.value = headerLabel;
                hdrCell.font = {
                    name: '맑은 고딕',
                    size: 10,
                    bold: true,
                    color: { argb: itemNo > 0 ? 'FF1E3A8A' : 'FF1E293B' }
                };
                hdrCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: itemNo > 0 ? 'FFDBEAFE' : 'FFF1F5F9' }
                };
                hdrCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                for (let c = 1; c <= 8; c++) {
                    wsPhotos.getRow(pRow).getCell(c).border = thinBorder;
                }
                wsPhotos.getRow(pRow).height = 23;

                try {
                    const imgData = await loadAttachmentImageForExcel(att);
                    const maxW = 660;
                    const maxH = 440;
                    const scale = Math.min(1, maxW / imgData.natW, maxH / imgData.natH);
                    const dispW = Math.max(120, Math.round(imgData.natW * scale));
                    const dispH = Math.max(90, Math.round(imgData.natH * scale));

                    const rowPt = 20;
                    const spanRows = Math.max(5, Math.ceil((dispH + 20) / 26));
                    const imgStartRow = pRow + 1;
                    const imgEndRow = imgStartRow + spanRows - 1;

                    for (let r = imgStartRow; r <= imgEndRow; r++) {
                        wsPhotos.getRow(r).height = rowPt;
                        for (let c = 1; c <= 8; c++) {
                            const cObj = wsPhotos.getRow(r).getCell(c);
                            cObj.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                            cObj.border = {
                                top: r === imgStartRow ? thinBorder.top : undefined,
                                bottom: r === imgEndRow ? thinBorder.bottom : undefined,
                                left: c === 1 ? thinBorder.left : undefined,
                                right: c === 8 ? thinBorder.right : undefined
                            };
                        }
                    }

                    const imgId = wb.addImage({
                        buffer: imgData.buffer,
                        extension: imgData.extension
                    });
                    wsPhotos.addImage(imgId, {
                        tl: { col: 0.25, row: (imgStartRow - 1) + 0.25 },
                        ext: { width: dispW, height: dispH },
                        editAs: 'oneCell'
                    });

                    pRow = imgEndRow + 2;
                } catch (imgErr) {
                    const errRow = pRow + 1;
                    wsPhotos.mergeCells(`A${errRow}:H${errRow}`);
                    const errCell = wsPhotos.getCell(`A${errRow}`);
                    errCell.value = `이미지를 불러오지 못했습니다 (${origName}): ${imgErr.message}`;
                    errCell.font = { name: '맑은 고딕', size: 9.5, color: { argb: 'FFDC2626' } };
                    errCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                    for (let c = 1; c <= 8; c++) {
                        wsPhotos.getRow(errRow).getCell(c).border = thinBorder;
                    }
                    wsPhotos.getRow(errRow).height = 24;
                    pRow = errRow + 2;
                }
            }

            for (let r = 1; r <= pRow; r++) {
                for (let c = 1; c <= 8; c++) {
                    wsPhotos.getRow(r).getCell(c).protection = { locked: true };
                }
            }
            await wsPhotos.protect('2833', {
                selectLockedCells: true,
                selectUnlockedCells: true,
                editObjects: false
            });
        }

        return wb.xlsx.writeBuffer();
    },

    triggerExcelBufferDownload: function(buffer, fileName) {
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    },

    // ── 모달 내부 단건 엑셀 다운로드 ──
    downloadTenderExcel: async function() {
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) {
            alert('다운로드할 품목이 없습니다.');
            return;
        }

        this.syncAttachmentTargetsFromRows();
        const title = document.getElementById('formTitle').value.trim() || '공새로_입찰_투찰서';
        const items = [];
        rows.forEach((tr, idx) => {
            items.push({
                item_no: idx + 1,
                item_name: tr.querySelector('.item-name').value.trim(),
                spec: tr.querySelector('.item-spec').value.trim(),
                unit: tr.querySelector('.item-unit').value.trim() || 'EA',
                qty: parseFloat(tr.querySelector('.item-qty').value) || 0,
                buy_price: parseFloat(tr.querySelector('.item-buy').value) || 0,
                margin_rate: parseFloat(tr.querySelector('.item-margin').value) || 0,
                settlement_price: parseFloat(tr.querySelector('.item-settlement').value) || 0,
                delivery_price: parseFloat(tr.querySelector('.item-delivery').value) || 0,
                item_note: tr.querySelector('.item-note').value.trim()
            });
        });

        const bid = {
            id: document.getElementById('editBidId').value || '',
            title,
            client_name: document.getElementById('formClientName').value.trim(),
            bid_deadline: document.getElementById('formBidDeadline').value,
            delivery_deadline: document.getElementById('formDeliveryDeadline').value,
            delivery_address: document.getElementById('formDeliveryAddress').value.trim(),
            delivery_condition: document.getElementById('formDeliveryCondition').value || '하차도',
            shipping_included: Number(document.getElementById('formShippingIncluded').value ?? 1),
            estimated_shipping_fee: parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0,
            manager_info: document.getElementById('formManagerInfo').value.trim(),
            remarks: document.getElementById('formRemarks').value.trim(),
            attachments: this.modalAttachments
        };

        const btn = document.getElementById('btnDownloadTenderExcel');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 엑셀 생성 중...`;
        }

        try {
            const buffer = await this.generateProtectedTenderWorkbook([{ bid, items }], btn);
            const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '공새로_입찰_투찰서';
            this.triggerExcelBufferDownload(buffer, `${safeTitle}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } catch (err) {
            alert('엑셀 파일 생성 중 오류가 발생했습니다: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    },

    // ── 엑셀 시트 파싱 공통 헬퍼 (단건 모달 반영 & 다중 공고 일괄 반영 공용) ──
    parseTenderExcelBuffer: function(arrayBuf) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
        }

        const wb = XLSX.read(arrayBuf, { type: 'array' });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) throw new Error('엑셀 시트를 찾을 수 없습니다.');

        const ws = wb.Sheets[firstSheetName];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!matrix || matrix.length === 0) throw new Error('비어있는 엑셀 파일입니다.');

        let headerRowIdx = -1;
        for (let i = 0; i < Math.min(matrix.length, 20); i++) {
            const rowStrs = (matrix[i] || []).map(v => String(v || '').replace(/\s+/g, ''));
            if (rowStrs.some(s => s.includes('품목명'))) {
                headerRowIdx = i;
                break;
            }
        }
        if (headerRowIdx === -1) {
            throw new Error("'품목명' 헤더가 포함된 투찰단가 산출표를 찾을 수 없습니다.");
        }

        const rawHeaders = (matrix[headerRowIdx] || []).map(v => String(v || '').trim());
        const findCol = (keywords, excludeKeywords = []) => {
            return rawHeaders.findIndex(h => {
                const norm = h.replace(/\s+/g, '');
                if (excludeKeywords.some(ex => norm.includes(ex))) return false;
                return keywords.some(kw => norm.includes(kw));
            });
        };

        const colName = findCol(['품목명']);
        const colSpec = findCol(['규격']);
        const colUnit = findCol(['단위']);
        const colQty = findCol(['수량']);
        const colBuy = findCol(['매입가', '매입단가', '매입원가']);
        const colMarginInput = findCol(['희망마진', '목표마진'], ['최종']);
        const colLegacyMargin = colMarginInput !== -1 ? colMarginInput : findCol(['마진율'], ['최종']);
        const colDirectDelivery = findCol(['직접지정투찰단가', '직접투찰단가']);
        const colFinalDelivery = findCol(['최종투찰단가', '납품단가'], ['직접', '합계']);
        const colNote = findCol(['비고']);
        const colBidId = findCol(['공고ID']);

        const parseNum = (val) => {
            if (val === null || val === undefined || val === '' || val === '-') return 0;
            if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
            const cleaned = String(val).replace(/[,원%\s]/g, '');
            const num = parseFloat(cleaned);
            return Number.isFinite(num) ? num : 0;
        };

        let activeSectionBidId = '';
        const parsedRows = [];

        for (let r = headerRowIdx + 1; r < matrix.length; r++) {
            const row = matrix[r] || [];
            const cell0 = String(row[0] || '').trim();
            const cell0Norm = cell0.replace(/\s+/g, '');

            // 공고 섹션 헤더 행 감지 (예: 📌 [공고 1] ... (GS-BID-20261124-442))
            if (cell0.startsWith('📌') || cell0Norm.startsWith('[공고')) {
                const hiddenId = colBidId !== -1 ? String(row[colBidId] || '').trim() : '';
                if (hiddenId) {
                    activeSectionBidId = hiddenId;
                } else {
                    const idMatch = cell0.match(/(GS-BID-[0-9A-Za-z-]+)/);
                    activeSectionBidId = idMatch ? idMatch[1] : '';
                }
                continue;
            }
            // 서브 메타 행 / 소계 / 총합계 행 건너뛰기
            if (
                cell0.startsWith('📍') ||
                cell0Norm.startsWith('소계') ||
                cell0Norm.startsWith('합계') ||
                cell0Norm.startsWith('총합계')
            ) {
                continue;
            }

            const nameStr = colName !== -1 ? String(row[colName] || '').trim() : '';
            if (!nameStr || nameStr === '(등록된 품목 없음)') continue;

            const rowBidId = (colBidId !== -1 && String(row[colBidId] || '').trim())
                ? String(row[colBidId]).trim()
                : activeSectionBidId;

            const specStr = colSpec !== -1 ? String(row[colSpec] || '').trim() : '';
            const unitStr = colUnit !== -1 ? String(row[colUnit] || '').trim() || 'EA' : 'EA';
            const qty = colQty !== -1 ? (parseNum(row[colQty]) || 1) : 1;
            const buyPrice = colBuy !== -1 ? Math.round(parseNum(row[colBuy])) : 0;
            const noteStr = colNote !== -1 ? String(row[colNote] || '').trim() : '';

            const directDeliveryVal = colDirectDelivery !== -1 ? Math.round(parseNum(row[colDirectDelivery])) : 0;
            const marginInputVal = colLegacyMargin !== -1 ? parseNum(row[colLegacyMargin]) : 15;
            const finalDeliveryVal = colFinalDelivery !== -1 ? Math.round(parseNum(row[colFinalDelivery])) : 0;

            let settlementPrice = 0;
            let deliveryPrice = 0;
            let marginRate = marginInputVal;

            if (directDeliveryVal > 0) {
                const rev = calcSettlementFromDelivery(directDeliveryVal);
                settlementPrice = rev.settlementPrice;
                deliveryPrice = directDeliveryVal;
                if (buyPrice > 0) {
                    marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                }
            } else if (colDirectDelivery === -1 && finalDeliveryVal > 0 && buyPrice > 0) {
                const m1Settlement = Math.round(buyPrice * (1 + marginInputVal / 100));
                const m1Delivery = m1Settlement + calcGongsaeroFee(m1Settlement);
                if (finalDeliveryVal !== m1Delivery) {
                    const rev = calcSettlementFromDelivery(finalDeliveryVal);
                    settlementPrice = rev.settlementPrice;
                    deliveryPrice = finalDeliveryVal;
                    marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                } else {
                    settlementPrice = m1Settlement;
                    deliveryPrice = m1Delivery;
                }
            } else {
                settlementPrice = buyPrice > 0 ? Math.round(buyPrice * (1 + marginRate / 100)) : 0;
                const fee = calcGongsaeroFee(settlementPrice);
                deliveryPrice = settlementPrice + fee;
            }

            parsedRows.push({
                bidId: rowBidId,
                item_name: nameStr,
                spec: specStr,
                unit: unitStr,
                qty,
                buy_price: buyPrice,
                margin_rate: marginRate,
                settlement_price: settlementPrice,
                delivery_price: deliveryPrice,
                item_note: noteStr
            });
        }

        return { matrix, headerRowIdx, parsedRows };
    },

    // ── 모달 내부: 작성된 엑셀 파일을 현재 전표에 자동 반영 ──
    importTenderExcel: async function(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;

        try {
            const arrayBuf = await file.arrayBuffer();
            const { matrix, headerRowIdx, parsedRows } = this.parseTenderExcelBuffer(arrayBuf);
            if (parsedRows.length === 0) {
                throw new Error('반영할 품목 데이터가 없습니다.');
            }

            const currentEditBidId = document.getElementById('editBidId').value.trim();
            let targetItems = parsedRows;
            if (currentEditBidId && parsedRows.some(r => r.bidId === currentEditBidId)) {
                targetItems = parsedRows.filter(r => r.bidId === currentEditBidId);
            }

            if (!document.getElementById('formTitle').value.trim()) {
                for (let i = 0; i < headerRowIdx; i++) {
                    const row = matrix[i] || [];
                    const labelA = String(row[0] || '').replace(/\s+/g, '');
                    if (labelA.includes('공고명') && row[2]) {
                        document.getElementById('formTitle').value = String(row[2]).trim();
                    }
                }
            }

            const tbody = document.getElementById('itemsInputTbody');
            tbody.innerHTML = '';
            targetItems.forEach((it, idx) => {
                this.addItemRow(it, idx + 1);
            });

            if (this.modalAttachments.length > 0) {
                const newRows = Array.from(document.querySelectorAll('#itemsInputTbody tr'));
                this.modalAttachments.forEach(att => {
                    const itemNo = Number(att.targetItemNo) || 0;
                    if (itemNo >= 1 && itemNo <= newRows.length) {
                        att.rowUid = newRows[itemNo - 1].dataset.rowUid || '';
                    } else if (att.targetItemName) {
                        const matched = newRows.find(r => r.querySelector('.item-name')?.value.trim() === att.targetItemName);
                        att.rowUid = matched ? (matched.dataset.rowUid || '') : '';
                    }
                });
                this.syncAttachmentTargetsFromRows();
                this.renderModalAttachments();
            }

            const bidModalEl = document.getElementById('bidModal');
            if (bidModalEl) bidModalEl._userEdited = true;
            this.updateSummaryMetrics();
            this.calcModalWhatIfSimulation();

            alert(`엑셀에서 총 ${targetItems.length}개 품목의 매입가·마진·투찰단가 내역을 반영했습니다.\n내용 확인 후 '공고 및 투찰서 저장' 버튼을 눌러 저장해주세요.`);
        } catch (err) {
            alert('엑셀 불러오기 오류: ' + err.message);
        }
    },

    // ── 메인 화면 상단: 담당 직원이 작성한 다중(또는 단건) 공고 엑셀 일괄 DB 반영 ──
    importBulkTenderExcel: async function(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;

        const btn = document.getElementById('btnImportBulkExcel');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 단가 일괄 반영 중...`;
        }

        try {
            const arrayBuf = await file.arrayBuffer();
            const { parsedRows } = this.parseTenderExcelBuffer(arrayBuf);
            if (parsedRows.length === 0) {
                throw new Error('반영할 품목 데이터가 없습니다.');
            }

            const itemsByBidId = new Map();
            parsedRows.forEach(row => {
                if (!row.bidId) return;
                if (!itemsByBidId.has(row.bidId)) itemsByBidId.set(row.bidId, []);
                itemsByBidId.get(row.bidId).push(row);
            });

            if (itemsByBidId.size === 0) {
                throw new Error('엑셀에서 공고번호(GS-BID-...) 정보를 찾을 수 없습니다. 개별 공고의 수정 화면 안에서 [작성된 엑셀 반영] 버튼을 이용해주세요.');
            }

            const token = await getAuthToken();
            let updatedBidCount = 0;
            let updatedItemCount = 0;

            for (const [bidId, newItems] of itemsByBidId.entries()) {
                const detailRes = await fetch(`${API_BASE}/bids/${encodeURIComponent(bidId)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!detailRes.ok) continue;
                const detailData = await detailRes.json();
                const bid = detailData.bid;
                if (!bid) continue;

                const payload = {
                    title: bid.title,
                    client_name: bid.client_name || '',
                    bid_type: bid.bid_type || '공개 입찰',
                    urgency: bid.urgency || '일반',
                    issue_date: bid.issue_date || '',
                    bid_deadline: bid.bid_deadline || '',
                    delivery_deadline: bid.delivery_deadline || '',
                    status: bid.status || '입찰중',
                    delivery_address: bid.delivery_address || '',
                    delivery_condition: bid.delivery_condition || '하차도',
                    shipping_included: bid.shipping_included ?? 1,
                    manager_info: bid.manager_info || '',
                    estimated_shipping_fee: Number(bid.estimated_shipping_fee) || 0,
                    winning_bid_amount: Number(bid.winning_bid_amount) || 0,
                    winning_company: bid.winning_company || '',
                    result_note: bid.result_note || '',
                    remarks: bid.remarks || '',
                    attachments: Array.isArray(bid.attachments) ? bid.attachments : [],
                    items: newItems.map((it, idx) => ({
                        item_no: idx + 1,
                        item_name: it.item_name,
                        spec: it.spec,
                        unit: it.unit,
                        qty: it.qty,
                        buy_price: it.buy_price,
                        margin_rate: it.margin_rate,
                        settlement_price: it.settlement_price,
                        delivery_price: it.delivery_price,
                        item_note: it.item_note
                    }))
                };

                const putRes = await fetch(`${API_BASE}/bids/${encodeURIComponent(bidId)}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                if (!putRes.ok) {
                    const errJson = await putRes.json().catch(() => ({}));
                    throw new Error(errJson.error || `공고(${bidId}) 저장 실패`);
                }
                updatedBidCount++;
                updatedItemCount += newItems.length;
            }

            await this.loadBids();
            alert(`총 ${updatedBidCount}건의 공고(${updatedItemCount}개 품목)에 담당자 매입가·마진·투찰단가가 일괄 반영되었습니다!`);
        } catch (err) {
            alert('엑셀 일괄 반영 오류: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
            }
        }
    },

    // ── 상단 [선택 엑셀저장] 버튼 (체크된 공고들을 담당자 배포용 양식 엑셀로 다운로드) ──
    exportToExcel: async function() {
        if (this.currentView === 'items') {
            if (typeof XLSX === 'undefined') {
                alert('Excel 라이브러리를 불러오는 중입니다.');
                return;
            }
            if (this.itemsHistoryData.length === 0) {
                alert('내보낼 품목 데이터가 없습니다.');
                return;
            }

            const excelRows = this.itemsHistoryData.map(i => ({
                '공고일자': i.issue_date || i.created_at,
                '공고명': i.bid_title,
                '발주처': i.client_name,
                '상태': i.bid_status,
                '품목명': i.item_name,
                '규격': i.spec,
                '단위': i.unit,
                '수량': i.qty,
                'K&G 매입가': i.buy_price,
                '마진율(%)': i.margin_rate,
                '희망 정산단가': i.settlement_price,
                '수수료(6%)': i.gongsaero_fee,
                '납품단가': i.delivery_price,
                '순이익': i.item_profit
            }));

            const ws = XLSX.utils.json_to_sheet(excelRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '품목투찰이력');
            XLSX.writeFile(wb, `공새로_품목투찰이력_${new Date().toISOString().slice(0,10)}.xlsx`);
            return;
        }

        // 공고별 관리 뷰: 체크박스로 선택한 공고들을 상세 품목 + 양방향 수식 + 2833 잠금 + 첨부사진 시트로 다운로드
        if (this.selectedBidIds.size === 0) {
            alert('엑셀로 다운로드할 입찰 공고를 좌측 체크박스에서 먼저 선택해주세요.\n(목록 맨 위 체크박스를 누르면 전체 선택이 가능합니다.)');
            return;
        }

        const orderedIds = [];
        this.bidsData.forEach(b => {
            if (this.selectedBidIds.has(b.id)) orderedIds.push(b.id);
        });
        this.rawBidsData.forEach(b => {
            if (this.selectedBidIds.has(b.id) && !orderedIds.includes(b.id)) orderedIds.push(b.id);
        });
        this.selectedBidIds.forEach(id => {
            if (!orderedIds.includes(id)) orderedIds.push(id);
        });

        const btn = document.getElementById('btnExportSelectedExcel');
        const origHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 공고 조회 중 (${orderedIds.length}건)...`;
        }

        try {
            const token = await getAuthToken();
            const records = await Promise.all(orderedIds.map(async (id) => {
                const res = await fetch(`${API_BASE}/bids/${encodeURIComponent(id)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(`공고(${id}) 상세 조회 실패`);
                const data = await res.json();
                return { bid: data.bid, items: data.items || [] };
            }));

            const buffer = await this.generateProtectedTenderWorkbook(records, btn);
            const dateStr = new Date().toISOString().slice(0, 10);
            let fileName = `공새로_투찰단가산출서_${dateStr}.xlsx`;
            if (records.length === 1) {
                const safeTitle = (records[0].bid?.title || '공새로_투찰서').replace(/[\\/:*?"<>|]/g, '_').trim();
                fileName = `${safeTitle}_${dateStr}.xlsx`;
            } else {
                const firstTitle = (records[0].bid?.title || '공새로_입찰').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 24);
                fileName = `${firstTitle}_외${records.length - 1}건_투찰단가산출서_${dateStr}.xlsx`;
            }

            this.triggerExcelBufferDownload(buffer, fileName);
        } catch (err) {
            alert('선택 공고 엑셀 다운로드 오류: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origHtml;
                this.syncSelectionUI();
            }
        }
    },

    // ── 선택 공고 일괄 인쇄 미리보기 ──
    openPrintPreviewForSelected: async function() {
        if (this.selectedBidIds.size === 0) {
            alert('출력할 입찰 공고를 좌측 체크박스에서 먼저 선택해주세요.');
            return;
        }

        const orderedIds = [];
        this.bidsData.forEach(b => {
            if (this.selectedBidIds.has(b.id)) orderedIds.push(b.id);
        });
        this.rawBidsData.forEach(b => {
            if (this.selectedBidIds.has(b.id) && !orderedIds.includes(b.id)) orderedIds.push(b.id);
        });
        this.selectedBidIds.forEach(id => {
            if (!orderedIds.includes(id)) orderedIds.push(id);
        });

        const container = document.getElementById('printPreviewContainer');
        const statusTextEl = document.getElementById('printPreviewStatusText');
        if (container) {
            container.innerHTML = `
                <div class="bg-white p-5 rounded text-center text-muted">
                    <div class="spinner-border spinner-border-sm text-primary mb-2"></div>
                    <div>선택된 ${orderedIds.length}건의 공고 및 품목 데이터를 불러오는 중입니다...</div>
                </div>
            `;
        }
        if (statusTextEl) {
            statusTextEl.innerText = `선택된 ${orderedIds.length}건 조회 중...`;
        }

        if (this.printPreviewModalInstance) {
            this.printPreviewModalInstance.show();
        }

        try {
            const token = await getAuthToken();
            const results = await Promise.all(orderedIds.map(async (id) => {
                const res = await fetch(`${API_BASE}/bids/${encodeURIComponent(id)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error(`공고(${id}) 상세 조회 실패`);
                const data = await res.json();
                return { bid: data.bid, items: data.items || [] };
            }));

            this.currentPrintData = results;
            this.renderPrintPreview();
        } catch (err) {
            this.currentPrintData = [];
            if (container) {
                container.innerHTML = `
                    <div class="bg-white p-4 rounded text-center text-danger">
                        <i class='bx bx-error-circle fs-3'></i>
                        <div class="mt-2 fw-bold">인쇄 데이터를 불러오는 중 오류가 발생했습니다.</div>
                        <div class="small mt-1">${escapeHtml(err.message)}</div>
                    </div>
                `;
            }
            if (statusTextEl) {
                statusTextEl.innerText = '데이터 조회 오류';
            }
        }
    },

    // ── 현재 상세 모달 공고 단건 인쇄 미리보기 ──
    printCurrentModalBid: function() {
        this.syncAttachmentTargetsFromRows();
        const status = document.getElementById('formStatus').value;
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        const items = [];
        let totalBuyCost = 0;
        let totalSettlement = 0;
        let totalFee = 0;
        let totalDeliveryAmount = 0;
        let totalProfit = 0;

        rows.forEach((r, idx) => {
            const qty = parseFloat(r.querySelector('.item-qty').value) || 0;
            const buyPrice = Math.round(parseFloat(r.querySelector('.item-buy').value) || 0);
            const marginRate = parseFloat(r.querySelector('.item-margin').value) || 0;
            const settlementPrice = Math.round(parseFloat(r.querySelector('.item-settlement').value) || 0);
            const fee = Math.round(parseFloat(r.querySelector('.item-fee').value) || calcGongsaeroFee(settlementPrice));
            const deliveryPrice = Math.round(parseFloat(r.querySelector('.item-delivery').value) || (settlementPrice + fee));

            const itemBuy = buyPrice * qty;
            const itemSettlement = settlementPrice * qty;
            const itemFee = fee * qty;
            const itemDelivery = deliveryPrice * qty;
            const itemProfit = (settlementPrice - buyPrice) * qty;

            totalBuyCost += itemBuy;
            totalSettlement += itemSettlement;
            totalFee += itemFee;
            totalDeliveryAmount += itemDelivery;
            totalProfit += itemProfit;

            items.push({
                item_no: idx + 1,
                item_name: r.querySelector('.item-name').value.trim() || '-',
                spec: r.querySelector('.item-spec').value.trim(),
                unit: r.querySelector('.item-unit').value.trim() || 'EA',
                qty,
                buy_price: buyPrice,
                margin_rate: marginRate,
                settlement_price: settlementPrice,
                gongsaero_fee: fee,
                delivery_price: deliveryPrice,
                total_buy_cost: itemBuy,
                total_settlement_price: itemSettlement,
                total_delivery_price: itemDelivery,
                item_profit: itemProfit,
                item_note: r.querySelector('.item-note').value.trim()
            });
        });

        const profitRate = totalBuyCost > 0 ? Number(((totalProfit / totalBuyCost) * 100).toFixed(2)) : 0;
        const bid = {
            id: document.getElementById('editBidId').value || '작성중 전표',
            title: document.getElementById('formTitle').value.trim() || '(공고명 미입력)',
            client_name: document.getElementById('formClientName').value.trim(),
            bid_type: document.getElementById('formBidType').value,
            urgency: document.getElementById('formUrgency').value,
            issue_date: document.getElementById('formIssueDate').value,
            bid_deadline: document.getElementById('formBidDeadline').value,
            delivery_deadline: document.getElementById('formDeliveryDeadline').value,
            status,
            delivery_address: document.getElementById('formDeliveryAddress').value.trim(),
            delivery_condition: document.getElementById('formDeliveryCondition').value,
            shipping_included: Number(document.getElementById('formShippingIncluded').value),
            manager_info: document.getElementById('formManagerInfo').value.trim(),
            estimated_shipping_fee: parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0,
            winning_bid_amount: status === '유찰' ? 0 : (parseFloat(document.getElementById('formWinningBidAmount').value) || 0),
            winning_company: status === '유찰' ? '' : document.getElementById('formWinningCompany').value.trim(),
            result_note: document.getElementById('formResultNote').value.trim(),
            remarks: document.getElementById('formRemarks').value.trim(),
            attachments: this.modalAttachments.map(att => ({
                ...att,
                url: resolveAttachmentUrl(att)
            })),
            total_buy_cost: totalBuyCost,
            total_settlement: totalSettlement,
            total_fee: totalFee,
            total_delivery_amount: totalDeliveryAmount,
            total_profit: totalProfit,
            profit_rate: profitRate
        };

        this.currentPrintData = [{ bid, items }];
        this.renderPrintPreview();
        if (this.printPreviewModalInstance) {
            this.printPreviewModalInstance.show();
        }
    },

    renderPrintPreview: function() {
        const container = document.getElementById('printPreviewContainer');
        const statusTextEl = document.getElementById('printPreviewStatusText');
        if (!container) return;

        if (!this.currentPrintData || this.currentPrintData.length === 0) {
            container.innerHTML = `<div class="bg-white p-4 rounded text-center text-muted">출력할 공고 데이터가 없습니다.</div>`;
            if (statusTextEl) statusTextEl.innerText = '출력할 공고 없음';
            return;
        }

        const pageBreak = Boolean(document.getElementById('optPrintPageBreak')?.checked);
        const hideCost = Boolean(document.getElementById('optPrintHideCost')?.checked);
        const showPhotos = Boolean(document.getElementById('optPrintShowPhotos')?.checked);

        container.innerHTML = this.buildPrintReportHtml(this.currentPrintData, { pageBreak, hideCost, showPhotos });

        if (statusTextEl) {
            const optsDesc = [];
            if (pageBreak) optsDesc.push('공고별 페이지 분리');
            if (hideCost) optsDesc.push('원가·마진 숨김');
            if (showPhotos) optsDesc.push('첨부 사진 포함');
            statusTextEl.innerText = `총 ${this.currentPrintData.length}건 인쇄 준비 완료${optsDesc.length ? ` (${optsDesc.join(', ')})` : ''}`;
        }
    },

    buildPrintReportHtml: function(records, opts = {}) {
        const pageBreak = Boolean(opts.pageBreak);
        const hideCost = Boolean(opts.hideCost);
        const showPhotos = Boolean(opts.showPhotos);
        const nowStr = new Date().toLocaleString('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });

        const statusCounts = { 낙찰: 0, 미선정: 0, 유찰: 0, 입찰중: 0, 입찰포기: 0 };
        let sumBuyCost = 0;
        let sumOurDelivery = 0;
        let sumProfit = 0;
        let sumWinningAmount = 0;
        let winningInputCount = 0;

        records.forEach(({ bid }) => {
            const st = bid.status || '입찰중';
            statusCounts[st] = (statusCounts[st] || 0) + 1;
            sumBuyCost += Number(bid.total_buy_cost) || 0;
            sumOurDelivery += Number(bid.total_delivery_amount) || 0;
            sumProfit += Number(bid.total_profit) || 0;
            if (st !== '유찰' && (Number(bid.winning_bid_amount) || 0) > 0) {
                sumWinningAmount += Number(bid.winning_bid_amount);
                winningInputCount++;
            }
        });

        const statusBreakdown = Object.entries(statusCounts)
            .filter(([, cnt]) => cnt > 0)
            .map(([st, cnt]) => `${st} ${cnt}`)
            .join(' · ');

        let summaryHtml = '';
        if (records.length >= 2) {
            summaryHtml = `
                <div class="gs-print-summary-bar">
                    <div class="gs-print-summary-item">
                        <span class="gs-print-summary-label">선택 공고 현황 (${records.length}건)</span>
                        <span class="gs-print-summary-val" style="font-size: 11px;">${escapeHtml(statusBreakdown || '-')}</span>
                    </div>
                    ${hideCost ? '' : `
                    <div class="gs-print-summary-item">
                        <span class="gs-print-summary-label">총 매입원가 합계</span>
                        <span class="gs-print-summary-val">${Math.round(sumBuyCost).toLocaleString()}원</span>
                    </div>`}
                    <div class="gs-print-summary-item">
                        <span class="gs-print-summary-label">당사 투찰총액 합계</span>
                        <span class="gs-print-summary-val" style="color: #1d4ed8;">${Math.round(sumOurDelivery).toLocaleString()}원</span>
                    </div>
                    ${hideCost ? '' : `
                    <div class="gs-print-summary-item">
                        <span class="gs-print-summary-label">예상 순이익 합계</span>
                        <span class="gs-print-summary-val" style="color: #059669;">${Math.round(sumProfit).toLocaleString()}원</span>
                    </div>`}
                    <div class="gs-print-summary-item">
                        <span class="gs-print-summary-label">최종 낙찰가 합계 (${winningInputCount}건 입력)</span>
                        <span class="gs-print-summary-val">${Math.round(sumWinningAmount).toLocaleString()}원</span>
                    </div>
                </div>
            `;
        }

        const formatDt = (val) => {
            if (!val) return '-';
            return String(val).replace('T', ' ').slice(0, 16);
        };

        const cardsHtml = records.map(({ bid, items }, idx) => {
            const st = bid.status || '입찰중';
            let statusCls = 'bidding';
            if (st === '낙찰') statusCls = 'won';
            else if (st === '미선정') statusCls = 'lost';
            else if (st === '유찰') statusCls = 'failed';
            else if (st === '입찰포기') statusCls = 'abandoned';

            const totalBuy = Number(bid.total_buy_cost) || 0;
            const totalFee = Number(bid.total_fee) || 0;
            const totalSettlement = Number(bid.total_settlement) || 0;
            const totalDelivery = Number(bid.total_delivery_amount) || 0;
            const totalProfit = Number(bid.total_profit) || 0;
            const profitRate = Number(bid.profit_rate || 0).toFixed(1);
            const shippingFee = Number(bid.estimated_shipping_fee) || 0;
            const winAmount = st === '유찰' ? 0 : (Number(bid.winning_bid_amount) || 0);
            const whatIf = calcWhatIfMetrics(totalDelivery, winAmount, totalBuy, shippingFee, st);

            let winningSummaryHtml = '<span style="color:#64748b;">개찰 대기</span>';
            let whatIfSummaryHtml = '<span style="color:#64748b;">-</span>';

            if (st === '유찰') {
                winningSummaryHtml = `<span style="color:#5b21b6;">유찰 (낙찰가 없음)</span>`;
                whatIfSummaryHtml = `<span style="color:#64748b;">해당없음</span>`;
            } else if (winAmount > 0) {
                const diffStr = whatIf.diff > 0
                    ? `<span style="color:#b91c1c; font-size:10px;">(+${Number(whatIf.diff).toLocaleString()}원 / +${whatIf.diffPercent}%)</span>`
                    : (whatIf.diff < 0
                        ? `<span style="color:#15803d; font-size:10px;">(${Number(whatIf.diff).toLocaleString()}원 / ${whatIf.diffPercent}%)</span>`
                        : `<span style="color:#0f172a; font-size:10px;">(동일)</span>`);
                const companyLabel = bid.winning_company ? ` · ${escapeHtml(bid.winning_company)}` : '';
                winningSummaryHtml = `${winAmount.toLocaleString()}원 ${diffStr}<div style="font-size:9.5px; color:#475569; font-weight:500;">낙찰사${companyLabel || (st === '낙찰' ? ': 당사' : ': 미입력')}</div>`;
                const simColor = whatIf.simProfit < 0 ? '#dc2626' : '#059669';
                whatIfSummaryHtml = `<span style="color:${simColor};">${Number(whatIf.simProfit).toLocaleString()}원 (${whatIf.simMarginRate}%)</span>`;
            } else if (st === '낙찰' || st === '미선정') {
                winningSummaryHtml = `<span style="color:#94a3b8;">낙찰가 미입력</span>`;
            }

            const compareSectionHtml = hideCost
                ? `
                    <table class="gs-print-compare-table">
                        <thead>
                            <tr>
                                <th>당사 투찰총액</th>
                                <th>최종 낙찰가 / 차액</th>
                                <th>낙찰업체</th>
                                <th>예상 용차비</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="color:#1d4ed8;">${Math.round(totalDelivery).toLocaleString()}원</td>
                                <td>${winningSummaryHtml}</td>
                                <td style="text-align:center;">${st === '유찰' ? '유찰 (해당없음)' : escapeHtml(bid.winning_company || '-')}</td>
                                <td>${shippingFee > 0 ? `${shippingFee.toLocaleString()}원` : '-'}</td>
                            </tr>
                        </tbody>
                    </table>
                `
                : `
                    <table class="gs-print-compare-table">
                        <thead>
                            <tr>
                                <th>총 매입원가</th>
                                <th>공새로 수수료(6%)</th>
                                <th>희망 정산금액</th>
                                <th>당사 투찰총액</th>
                                <th>예상 순이익 (마진율)</th>
                                <th>최종 낙찰가 / 차액</th>
                                <th>가상 마진 (What-If)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>${Math.round(totalBuy).toLocaleString()}원</td>
                                <td style="color:#dc2626;">${Math.round(totalFee).toLocaleString()}원</td>
                                <td>${Math.round(totalSettlement).toLocaleString()}원</td>
                                <td style="color:#1d4ed8;">${Math.round(totalDelivery).toLocaleString()}원</td>
                                <td style="color:#059669;">${Math.round(totalProfit).toLocaleString()}원 (${profitRate}%)</td>
                                <td>${winningSummaryHtml}</td>
                                <td>${whatIfSummaryHtml}</td>
                            </tr>
                        </tbody>
                    </table>
                `;

            let sumItemBuy = 0;
            let sumItemFee = 0;
            let sumItemDelivery = 0;
            let sumItemProfit = 0;

            const itemRowsHtml = items.length > 0
                ? items.map((it, iIdx) => {
                    const qty = Number(it.qty) || 0;
                    const buy = Number(it.buy_price) || 0;
                    const margin = Number(it.margin_rate) || 0;
                    const settlement = Number(it.settlement_price) || 0;
                    const fee = Number(it.gongsaero_fee ?? calcGongsaeroFee(settlement)) || 0;
                    const delivery = Number(it.delivery_price || (settlement + fee)) || 0;
                    const itemBuyTotal = Number(it.total_buy_cost ?? (buy * qty)) || 0;
                    const itemDeliveryTotal = Number(it.total_delivery_price ?? (delivery * qty)) || 0;
                    const itemProfit = Number(it.item_profit ?? ((settlement - buy) * qty)) || 0;

                    sumItemBuy += itemBuyTotal;
                    sumItemFee += (fee * qty);
                    sumItemDelivery += itemDeliveryTotal;
                    sumItemProfit += itemProfit;

                    if (hideCost) {
                        return `
                            <tr>
                                <td style="text-align:center;">${it.item_no || (iIdx + 1)}</td>
                                <td style="font-weight:600;">${escapeHtml(it.item_name)}</td>
                                <td>${escapeHtml(it.spec || '-')}</td>
                                <td style="text-align:center;">${escapeHtml(it.unit || 'EA')}</td>
                                <td style="text-align:right;">${qty.toLocaleString()}</td>
                                <td style="text-align:right; font-weight:700; color:#1d4ed8;">${Math.round(delivery).toLocaleString()}원</td>
                                <td style="text-align:right; font-weight:700;">${Math.round(itemDeliveryTotal).toLocaleString()}원</td>
                                <td>${escapeHtml(it.item_note || it.origin_brand || '')}</td>
                            </tr>
                        `;
                    }
                    return `
                        <tr>
                            <td style="text-align:center;">${it.item_no || (iIdx + 1)}</td>
                            <td style="font-weight:600;">${escapeHtml(it.item_name)}</td>
                            <td>${escapeHtml(it.spec || '-')}</td>
                            <td style="text-align:center;">${escapeHtml(it.unit || 'EA')}</td>
                            <td style="text-align:right;">${qty.toLocaleString()}</td>
                            <td style="text-align:right;">${Math.round(buy).toLocaleString()}</td>
                            <td style="text-align:right;">${margin.toFixed(1)}%</td>
                            <td style="text-align:right;">${Math.round(settlement).toLocaleString()}</td>
                            <td style="text-align:right; color:#dc2626;">${Math.round(fee).toLocaleString()}</td>
                            <td style="text-align:right; font-weight:700; color:#1d4ed8;">${Math.round(delivery).toLocaleString()}</td>
                            <td style="text-align:right; font-weight:700;">${Math.round(itemDeliveryTotal).toLocaleString()}</td>
                            <td style="text-align:right; font-weight:700; color:#059669;">${Math.round(itemProfit).toLocaleString()}</td>
                            <td>${escapeHtml(it.item_note || it.origin_brand || '')}</td>
                        </tr>
                    `;
                }).join('')
                : `<tr><td colspan="${hideCost ? 8 : 13}" style="text-align:center; color:#64748b; padding:10px;">등록된 품목이 없습니다.</td></tr>`;

            const itemsTableHtml = hideCost
                ? `
                    <table class="gs-print-items-table">
                        <thead>
                            <tr>
                                <th style="width:30px;">No</th>
                                <th>품목명</th>
                                <th style="width:16%;">규격</th>
                                <th style="width:45px;">단위</th>
                                <th style="width:60px;">수량</th>
                                <th style="width:95px;">납품단가(투찰가)</th>
                                <th style="width:105px;">납품합계</th>
                                <th style="width:14%;">비고</th>
                            </tr>
                        </thead>
                        <tbody>${itemRowsHtml}</tbody>
                        <tfoot>
                            <tr>
                                <td colspan="6" style="text-align:center;">합 계 (${items.length}개 품목)</td>
                                <td style="text-align:right; color:#1d4ed8;">${Math.round(sumItemDelivery).toLocaleString()}원</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                `
                : `
                    <table class="gs-print-items-table">
                        <thead>
                            <tr>
                                <th style="width:28px;">No</th>
                                <th>품목명</th>
                                <th style="width:12%;">규격</th>
                                <th style="width:42px;">단위</th>
                                <th style="width:52px;">수량</th>
                                <th style="width:74px;">매입가</th>
                                <th style="width:54px;">마진율</th>
                                <th style="width:74px;">정산단가</th>
                                <th style="width:64px;">수수료(6%)</th>
                                <th style="width:76px;">납품단가</th>
                                <th style="width:86px;">납품합계</th>
                                <th style="width:78px;">순이익</th>
                                <th style="width:10%;">비고</th>
                            </tr>
                        </thead>
                        <tbody>${itemRowsHtml}</tbody>
                        <tfoot>
                            <tr>
                                <td colspan="5" style="text-align:center;">소 계 (${items.length}개 품목)</td>
                                <td style="text-align:right;">${Math.round(sumItemBuy).toLocaleString()}원</td>
                                <td></td>
                                <td></td>
                                <td style="text-align:right; color:#dc2626;">${Math.round(sumItemFee).toLocaleString()}원</td>
                                <td></td>
                                <td style="text-align:right; color:#1d4ed8;">${Math.round(sumItemDelivery).toLocaleString()}원</td>
                                <td style="text-align:right; color:#059669;">${Math.round(sumItemProfit).toLocaleString()}원</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                `;

            const resultNoteHtml = bid.result_note
                ? `<div style="margin-top:5px; padding:4px 8px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:3px; font-size:10px; color:#334155;"><strong>결과/유찰 메모:</strong> ${escapeHtml(bid.result_note)}</div>`
                : '';

            const bidPhotos = Array.isArray(bid.attachments) ? bid.attachments : [];
            const hasPhotosRendered = showPhotos && bidPhotos.length > 0;
            const photosSectionHtml = hasPhotosRendered
                ? `
                    <div class="gs-print-photos-section">
                        <div class="gs-print-photos-title">첨부 사진 (${bidPhotos.length}장)</div>
                        <div class="gs-print-photos-grid">
                            ${bidPhotos.map((att, pIdx) => {
                                const src = resolveAttachmentUrl(att);
                                const label = formatAttachmentLabel(att, pIdx);
                                return `
                                    <div class="gs-print-photo-box">
                                        <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}">
                                        <div class="gs-print-photo-caption">[사진 ${pIdx + 1}] ${escapeHtml(label)}</div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `
                : '';

            return `
                <section class="gs-print-bid-card ${pageBreak ? 'page-break' : ''} ${hasPhotosRendered ? 'has-photos' : ''}">
                    <div class="gs-print-card-header">
                        <div class="gs-print-card-title">
                            [${idx + 1}] ${escapeHtml(bid.title || '-')}
                            <span class="gs-print-card-id">(${escapeHtml(bid.id || '')})</span>
                        </div>
                        <span class="gs-print-status-badge ${statusCls}">${escapeHtml(st)}</span>
                    </div>
                    <div class="gs-print-card-body">
                        <table class="gs-print-meta-table">
                            <tr>
                                <th>발주처</th>
                                <td style="width:24%;">${escapeHtml(bid.client_name || '-')}</td>
                                <th>입찰형태 / 긴급</th>
                                <td style="width:20%;">${escapeHtml(bid.bid_type || '공개 입찰')} / ${escapeHtml(bid.urgency || '일반')}</td>
                                <th>발행일시</th>
                                <td>${escapeHtml(formatDt(bid.issue_date))}</td>
                            </tr>
                            <tr>
                                <th>투찰 마감</th>
                                <td>${escapeHtml(formatDt(bid.bid_deadline))}</td>
                                <th>납품 기한</th>
                                <td>${escapeHtml(formatDt(bid.delivery_deadline))}</td>
                                <th>인도 / 배송비</th>
                                <td>${escapeHtml(bid.delivery_condition || '하차도')} (${Number(bid.shipping_included) ? '단가포함' : '별도청구'})</td>
                            </tr>
                            <tr>
                                <th>납품 주소</th>
                                <td colspan="3">${escapeHtml(bid.delivery_address || '-')}</td>
                                <th>예상 용차비</th>
                                <td>${shippingFee > 0 ? `${shippingFee.toLocaleString()}원` : '0원'}</td>
                            </tr>
                            <tr>
                                <th>담당자 정보</th>
                                <td>${escapeHtml(bid.manager_info || '-')}</td>
                                <th>공고 비고</th>
                                <td colspan="3">${escapeHtml(bid.remarks || '-')}</td>
                            </tr>
                        </table>
                        ${compareSectionHtml}
                        ${resultNoteHtml}
                        ${itemsTableHtml}
                        ${photosSectionHtml}
                    </div>
                </section>
            `;
        }).join('');

        return `
            <div class="gs-print-doc">
                <div class="gs-print-doc-header">
                    <h1 class="gs-print-doc-title">공새로 입찰관리 - 공고별 투찰 및 입찰결과 내역서</h1>
                    <div class="gs-print-doc-meta">
                        <div>출력일시: ${escapeHtml(nowStr)}</div>
                        <div>대상 공고: 총 <strong>${records.length}</strong>건</div>
                    </div>
                </div>
                ${summaryHtml}
                ${cardsHtml}
            </div>
        `;
    },

    getPrintReportCss: function() {
        return `
            @page { size: A4 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body {
                margin: 0;
                padding: 0;
                font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Inter', Arial, sans-serif;
                color: #0f172a;
                font-size: 10.5px;
                line-height: 1.35;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .gs-print-doc { width: 100%; }
            .gs-print-doc-header {
                display: flex;
                justify-content: space-between;
                align-items: flex-end;
                border-bottom: 2px solid #0f172a;
                padding-bottom: 6px;
                margin-bottom: 12px;
            }
            .gs-print-doc-title { font-size: 16px; font-weight: 800; margin: 0; }
            .gs-print-doc-meta { text-align: right; font-size: 9.5px; color: #475569; }
            .gs-print-summary-bar {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                gap: 8px;
                background: #f8fafc;
                border: 1px solid #cbd5e1;
                border-radius: 4px;
                padding: 8px 10px;
                margin-bottom: 12px;
            }
            .gs-print-summary-item { display: flex; flex-direction: column; }
            .gs-print-summary-label { font-size: 9px; color: #64748b; font-weight: 600; }
            .gs-print-summary-val { font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
            .gs-print-bid-card {
                border: 1px solid #94a3b8;
                border-radius: 4px;
                margin-bottom: 14px;
                overflow: hidden;
                break-inside: avoid;
                page-break-inside: avoid;
            }
            .gs-print-bid-card.has-photos {
                break-inside: auto;
                page-break-inside: auto;
            }
            .gs-print-bid-card.page-break:not(:last-child) {
                break-after: page;
                page-break-after: always;
            }
            .gs-print-card-header {
                background: #0f172a;
                color: #ffffff;
                padding: 5px 10px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
            }
            .gs-print-card-title { font-size: 11.5px; font-weight: 700; }
            .gs-print-card-id { font-size: 9.5px; color: #cbd5e1; font-weight: 500; }
            .gs-print-status-badge {
                display: inline-block;
                padding: 1px 7px;
                border-radius: 10px;
                font-size: 9.5px;
                font-weight: 700;
                white-space: nowrap;
            }
            .gs-print-status-badge.won { background: #dcfce7; color: #166534; }
            .gs-print-status-badge.lost { background: #f1f5f9; color: #334155; }
            .gs-print-status-badge.bidding { background: #fef3c7; color: #92400e; }
            .gs-print-status-badge.failed { background: #ede9fe; color: #5b21b6; }
            .gs-print-status-badge.abandoned { background: #fee2e2; color: #991b1b; }
            .gs-print-card-body { padding: 7px 9px 9px 9px; }
            .gs-print-meta-table,
            .gs-print-compare-table,
            .gs-print-items-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 9.5px;
                font-variant-numeric: tabular-nums;
            }
            .gs-print-meta-table th,
            .gs-print-meta-table td {
                border: 1px solid #cbd5e1;
                padding: 3px 6px;
            }
            .gs-print-meta-table th {
                background: #f8fafc;
                color: #334155;
                font-weight: 700;
                width: 11%;
                text-align: center;
                white-space: nowrap;
            }
            .gs-print-compare-table { margin-top: 5px; }
            .gs-print-compare-table th,
            .gs-print-compare-table td {
                border: 1px solid #cbd5e1;
                padding: 4px 6px;
            }
            .gs-print-compare-table th {
                background: #f1f5f9;
                color: #1e293b;
                font-weight: 700;
                text-align: center;
                font-size: 9px;
            }
            .gs-print-compare-table td {
                text-align: right;
                font-weight: 700;
                font-size: 10.5px;
            }
            .gs-print-items-table { margin-top: 5px; }
            .gs-print-items-table th,
            .gs-print-items-table td {
                border: 1px solid #cbd5e1;
                padding: 3px 5px;
            }
            .gs-print-items-table thead th {
                background: #f8fafc;
                color: #334155;
                font-weight: 700;
                text-align: center;
                white-space: nowrap;
            }
            .gs-print-items-table tfoot td {
                background: #f1f5f9;
                font-weight: 700;
                color: #0f172a;
            }
            .gs-print-photos-section {
                margin-top: 8px;
                border-top: 1px dashed #cbd5e1;
                padding-top: 6px;
            }
            .gs-print-photos-title {
                font-size: 9.5px;
                font-weight: 700;
                color: #334155;
                margin-bottom: 5px;
            }
            .gs-print-photos-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
            }
            .gs-print-photo-box {
                border: 1px solid #cbd5e1;
                border-radius: 3px;
                padding: 4px;
                background: #ffffff;
                display: flex;
                flex-direction: column;
                align-items: center;
                break-inside: avoid;
                page-break-inside: avoid;
            }
            .gs-print-photo-box img {
                max-width: 100%;
                max-height: 240px;
                object-fit: contain;
                display: block;
            }
            .gs-print-photo-caption {
                margin-top: 3px;
                font-size: 8.5px;
                color: #64748b;
                width: 100%;
                text-align: center;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        `;
    },

    executePrintReport: function() {
        if (!this.currentPrintData || this.currentPrintData.length === 0) {
            alert('인쇄할 공고 내역이 없습니다.');
            return;
        }

        const pageBreak = Boolean(document.getElementById('optPrintPageBreak')?.checked);
        const hideCost = Boolean(document.getElementById('optPrintHideCost')?.checked);
        const showPhotos = Boolean(document.getElementById('optPrintShowPhotos')?.checked);
        const reportHtml = this.buildPrintReportHtml(this.currentPrintData, { pageBreak, hideCost, showPhotos });

        const frame = document.getElementById('printFrame');
        if (!frame || !frame.contentWindow) {
            window.print();
            return;
        }

        const frameDoc = frame.contentDocument || frame.contentWindow.document;
        frameDoc.open();
        frameDoc.write(`<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>공새로 입찰관리 출력</title>
<style>${this.getPrintReportCss()}</style>
</head>
<body>${reportHtml}</body>
</html>`);
        frameDoc.close();

        const imgs = Array.from(frameDoc.querySelectorAll('img'));
        const triggerPrint = () => {
            setTimeout(() => {
                frame.contentWindow.focus();
                frame.contentWindow.print();
            }, 80);
        };

        if (imgs.length === 0) {
            triggerPrint();
            return;
        }

        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            triggerPrint();
        };

        const waitAll = Promise.all(imgs.map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
            });
        }));

        waitAll.then(done);
        setTimeout(done, 6000);
    }
};

// Start on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(el => {
        el.setAttribute('data-bs-backdrop', 'static');
        el.setAttribute('data-bs-keyboard', 'false');
    });
    app.init();

    function getModalSnapshot(modalEl) {
        if (!modalEl) return '';
        const vals = [];
        modalEl.querySelectorAll('input, select, textarea').forEach(el => {
            if (el.type === 'button' || el.type === 'submit' || el.type === 'reset' || el.type === 'file') return;
            vals.push(`${el.id || el.name || el.className}:${el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value}`);
        });
        if (modalEl.id === 'bidModal' && Array.isArray(app.modalAttachments)) {
            vals.push(`attachments:${app.modalAttachments.map(a => `${a.id}:${a.rowUid || ''}:${a.caption || ''}`).join(',')}`);
        }
        return vals.join('|');
    }
    function isModalDirty(modalEl) {
        if (!modalEl || !modalEl.classList.contains('show') || modalEl.id === 'printPreviewModal') return false;
        return modalEl._initialSnapshot !== undefined && getModalSnapshot(modalEl) !== modalEl._initialSnapshot;
    }
    document.addEventListener('show.bs.modal', (e) => {
        const modalEl = e.target;
        if (!modalEl) return;
        modalEl.setAttribute('data-bs-backdrop', 'static');
        modalEl.setAttribute('data-bs-keyboard', 'false');
        const inst = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal.getInstance(modalEl) : null;
        if (inst && inst._config) {
            inst._config.backdrop = 'static';
            inst._config.keyboard = false;
        }
    });
    document.addEventListener('shown.bs.modal', (e) => {
        const modalEl = e.target;
        if (modalEl) {
            modalEl._isForceHiding = false;
            modalEl._confirmingHide = false;
            modalEl._initialSnapshot = getModalSnapshot(modalEl);
            setTimeout(() => {
                if (modalEl.classList.contains('show') && !modalEl._userEdited) {
                    modalEl._initialSnapshot = getModalSnapshot(modalEl);
                }
            }, 80);
            modalEl._userEdited = false;
        }
    });
    document.addEventListener('hidden.bs.modal', (e) => {
        const modalEl = e.target;
        if (modalEl) {
            modalEl._isForceHiding = false;
            modalEl._confirmingHide = false;
            if (modalEl.id === 'bidModal') {
                app.clearModalAttachments();
            }
        }
        if (document.querySelector('.modal.show')) {
            document.body.classList.add('modal-open');
        }
    });
    document.addEventListener('input', (e) => {
        const modalEl = e.target.closest && e.target.closest('.modal.show');
        if (modalEl) modalEl._userEdited = true;
    }, true);
    document.addEventListener('change', (e) => {
        const modalEl = e.target.closest && e.target.closest('.modal.show');
        if (modalEl) modalEl._userEdited = true;
    }, true);
    document.addEventListener('hidePrevented.bs.modal', (e) => {
        const modalEl = e.target;
        if (!modalEl) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (modalEl._confirmingHide || modalEl._isForceHiding) return;
        if (isModalDirty(modalEl)) {
            modalEl._confirmingHide = true;
            const ok = confirm('작성 또는 수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?');
            setTimeout(() => { modalEl._confirmingHide = false; }, 400);
            if (!ok) return;
        }
        modalEl._isForceHiding = true;
        const inst = window.bootstrap && window.bootstrap.Modal ? window.bootstrap.Modal.getOrCreateInstance(modalEl) : null;
        if (inst) inst.hide();
    });
    document.addEventListener('click', (e) => {
        const dismissBtn = e.target.closest('[data-bs-dismiss="modal"], .btn-close');
        if (!dismissBtn) return;
        const modalEl = dismissBtn.closest('.modal');
        if (!modalEl) return;
        if (modalEl._confirmingHide) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }
        if (!modalEl._isForceHiding && isModalDirty(modalEl)) {
            modalEl._confirmingHide = true;
            const ok = confirm('작성 또는 수정 중인 내용이 있습니다. 저장하지 않고 닫으시겠습니까?');
            setTimeout(() => { modalEl._confirmingHide = false; }, 400);
            if (!ok) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            modalEl._isForceHiding = true;
        }
    }, true);

    window.hasUnsavedChanges = () => {
        return Array.from(document.querySelectorAll('.modal.show')).some(m => isModalDirty(m));
    };
    window.addEventListener('beforeunload', (e) => {
        if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
});
