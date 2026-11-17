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

    init: async function() {
        const modalEl = document.getElementById('bidModal');
        if (modalEl) this.modalInstance = new bootstrap.Modal(modalEl);

        const qrModalEl = document.getElementById('quickResultModal');
        if (qrModalEl) this.quickResultModalInstance = new bootstrap.Modal(qrModalEl);

        const printModalEl = document.getElementById('printPreviewModal');
        if (printModalEl) this.printPreviewModalInstance = new bootstrap.Modal(printModalEl);

        await this.loadBids();
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

        const qty = data.qty !== undefined ? data.qty : 1;
        const buyPrice = data.buy_price || 0;
        const marginRate = data.margin_rate !== undefined ? data.margin_rate : 15;

        let settlementPrice = data.settlement_price || Math.round(buyPrice * (1 + marginRate / 100));
        let fee = calcGongsaeroFee(settlementPrice);
        let deliveryPrice = data.delivery_price || (settlementPrice + fee);
        let profit = (settlementPrice - buyPrice) * qty;

        tr.innerHTML = `
            <td class="text-center fw-bold text-muted row-num">${no}</td>
            <td><input type="text" class="item-name form-control" value="${data.item_name || ''}" placeholder="품목명" required></td>
            <td><input type="text" class="item-spec form-control" value="${data.spec || ''}" placeholder="규격"></td>
            <td><input type="text" class="item-unit form-control text-center" value="${data.unit || 'EA'}"></td>
            <td><input type="number" class="item-qty form-control text-end" value="${qty}" min="0" step="any" oninput="app.recalcRow(this)"></td>
            <td><input type="number" class="item-buy form-control text-end" value="${buyPrice}" min="0" oninput="app.recalcRow(this, 'buy')"></td>
            <td><input type="number" class="item-margin form-control text-end" value="${marginRate}" step="0.5" oninput="app.recalcRow(this, 'margin')"></td>
            <td class="bg-light"><input type="number" class="item-settlement form-control text-end" value="${settlementPrice}" min="0" oninput="app.recalcRow(this, 'settlement')"></td>
            <td class="bg-light"><input type="number" class="item-fee form-control text-end text-danger" value="${fee}" readonly></td>
            <td class="bg-light"><input type="number" class="item-delivery form-control text-end text-primary fw-bold" value="${deliveryPrice}" min="0" oninput="app.recalcRow(this, 'delivery')"></td>
            <td class="text-end fw-bold item-profit-cell text-success bg-light">${Number(profit).toLocaleString()}원</td>
            <td><input type="text" class="item-note form-control" value="${data.item_note || data.origin_brand || ''}" placeholder="비고"></td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-link text-danger p-0 lh-1" onclick="app.removeItemRow(this)" title="행 삭제">
                    <i class='bx bx-x' style="font-size: 15px; line-height: 1;"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
        this.updateSummaryMetrics();
    },

    removeItemRow: function(btn) {
        const tr = btn.closest('tr');
        tr.remove();
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        rows.forEach((r, idx) => {
            r.querySelector('.row-num').innerText = idx + 1;
            r.dataset.itemNo = idx + 1;
        });
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

    // ── 공고 저장 (POST / PUT) ──
    saveBid: async function() {
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
            items
        };

        try {
            const token = await getAuthToken();
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

            if (this.modalInstance) this.modalInstance.hide();
            await this.loadBids();
        } catch (err) {
            alert(err.message);
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

    // ── 견적서 엑셀 다운로드 ──
    downloadTenderExcel: function() {
        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        const title = document.getElementById('formTitle').value.trim() || '공새로_입찰_투찰서';
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) {
            alert('다운로드할 품목이 없습니다.');
            return;
        }

        const data = [
            ['공사/공고명', title],
            ['발주처', document.getElementById('formClientName').value || ''],
            ['납품주소', document.getElementById('formDeliveryAddress').value || ''],
            ['인도조건', document.getElementById('formDeliveryCondition').value || ''],
            [],
            ['No', '품목명', '규격', '단위', '수량', 'K&G 매입가', '마진율(%)', '정산단가', '수수료(6%)', '납품단가', '순이익', '비고']
        ];

        rows.forEach((r, idx) => {
            data.push([
                idx + 1,
                r.querySelector('.item-name').value,
                r.querySelector('.item-spec').value,
                r.querySelector('.item-unit').value,
                parseFloat(r.querySelector('.item-qty').value) || 0,
                parseFloat(r.querySelector('.item-buy').value) || 0,
                parseFloat(r.querySelector('.item-margin').value) || 0,
                parseFloat(r.querySelector('.item-settlement').value) || 0,
                parseFloat(r.querySelector('.item-fee').value) || 0,
                parseFloat(r.querySelector('.item-delivery').value) || 0,
                (parseFloat(r.querySelector('.item-settlement').value) - parseFloat(r.querySelector('.item-buy').value)) * (parseFloat(r.querySelector('.item-qty').value) || 0),
                r.querySelector('.item-note').value
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '투찰내역');
        XLSX.writeFile(wb, `${title}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    },

    // ── 공고 목록 엑셀 저장 ──
    exportToExcel: function() {
        if (typeof XLSX === 'undefined') {
            alert('Excel 라이브러리를 불러오는 중입니다.');
            return;
        }

        if (this.currentView === 'bids') {
            if (this.bidsData.length === 0) {
                alert('내보낼 공고 데이터가 없습니다.');
                return;
            }

            const excelRows = this.bidsData.map(b => {
                const whatIf = calcWhatIfMetrics(b.total_delivery_amount, b.winning_bid_amount, b.total_buy_cost, b.estimated_shipping_fee, b.status);
                return {
                    '공고번호': b.id,
                    '공고/공사명': b.title,
                    '발주처': b.client_name,
                    '상태': b.status,
                    '투찰마감일': b.bid_deadline,
                    '인도조건': b.delivery_condition,
                    '총 매입원가': b.total_buy_cost,
                    '당사 투찰금액': b.total_delivery_amount,
                    '최종 낙찰가': b.winning_bid_amount || 0,
                    '낙찰사': b.winning_company || '',
                    '차액(당사-낙찰)': whatIf.diff,
                    '차액율(%)': whatIf.diffPercent,
                    '가상 마진율(%)': whatIf.simMarginRate,
                    '가상 순이익': whatIf.simProfit,
                    '예상 순이익': b.total_profit,
                    '마진율(%)': b.profit_rate,
                    '결과메모': b.result_note || ''
                };
            });

            const ws = XLSX.utils.json_to_sheet(excelRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '입찰공고목록');
            XLSX.writeFile(wb, `공새로_입찰공고목록_${new Date().toISOString().slice(0,10)}.xlsx`);
        } else {
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

        container.innerHTML = this.buildPrintReportHtml(this.currentPrintData, { pageBreak, hideCost });

        if (statusTextEl) {
            const optsDesc = [];
            if (pageBreak) optsDesc.push('공고별 페이지 분리');
            if (hideCost) optsDesc.push('원가·마진 숨김');
            statusTextEl.innerText = `총 ${this.currentPrintData.length}건 인쇄 준비 완료${optsDesc.length ? ` (${optsDesc.join(', ')})` : ''}`;
        }
    },

    buildPrintReportHtml: function(records, opts = {}) {
        const pageBreak = Boolean(opts.pageBreak);
        const hideCost = Boolean(opts.hideCost);
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

            return `
                <section class="gs-print-bid-card ${pageBreak ? 'page-break' : ''}">
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
        `;
    },

    executePrintReport: function() {
        if (!this.currentPrintData || this.currentPrintData.length === 0) {
            alert('인쇄할 공고 내역이 없습니다.');
            return;
        }

        const pageBreak = Boolean(document.getElementById('optPrintPageBreak')?.checked);
        const hideCost = Boolean(document.getElementById('optPrintHideCost')?.checked);
        const reportHtml = this.buildPrintReportHtml(this.currentPrintData, { pageBreak, hideCost });

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

        setTimeout(() => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
        }, 120);
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
