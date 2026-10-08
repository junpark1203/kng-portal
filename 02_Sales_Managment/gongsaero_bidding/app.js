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

// ── What-If 가상 마진 및 전략 진단 산출 엔진 ──
function calcWhatIfMetrics(ourBid, winningBid, buyCost, shippingFee, status = '미선정') {
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
    searchDebounceTimer: null,
    currentDatePreset: 'all',

    init: async function() {
        const modalEl = document.getElementById('bidModal');
        if (modalEl) this.modalInstance = new bootstrap.Modal(modalEl);

        const qrModalEl = document.getElementById('quickResultModal');
        if (qrModalEl) this.quickResultModalInstance = new bootstrap.Modal(qrModalEl);

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
                <td colspan="14" class="text-center py-4 text-muted">
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
            this.renderKPIs(data.stats || {});
            this.filterAndRenderBids();
        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="14" class="text-center py-4 text-danger">
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

        document.getElementById('badgeBidsCount').innerText = this.bidsData.length;
        const summaryEl = document.getElementById('filterResultSummary');
        if (summaryEl) summaryEl.innerText = `총 ${this.bidsData.length}건 조회됨`;
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
                    <td colspan="14" class="text-center py-5 text-muted">
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
            if (b.status === '낙찰') tr.classList.add('row-won');
            else if (b.status === '미선정') tr.classList.add('row-lost');

            // 상태 배지 클래스
            let statusClass = 'bidding';
            if (b.status === '낙찰') statusClass = 'won';
            else if (b.status === '미선정') statusClass = 'lost';
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

            if (winAmount > 0) {
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
                let statusBadge = item.bid_status === '낙찰'
                    ? '<span class="status-pill won">낙찰</span>'
                    : (item.bid_status === '미선정'
                        ? '<span class="status-pill lost">미선정</span>'
                        : '<span class="status-pill bidding">진행</span>');

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
    openQuickResultModal: function(bidId) {
        const bid = this.rawBidsData.find(b => b.id === bidId);
        if (!bid) return;

        document.getElementById('qrBidId').value = bid.id;
        document.getElementById('qrBidTitle').innerText = bid.title || '-';
        document.getElementById('qrClientName').innerText = bid.client_name || '-';
        document.getElementById('qrOurBidAmount').value = bid.total_delivery_amount || 0;
        document.getElementById('qrOurBidAmountLabel').innerText = `${Number(bid.total_delivery_amount || 0).toLocaleString()}원`;
        document.getElementById('qrTotalBuyCost').value = bid.total_buy_cost || 0;
        document.getElementById('qrShippingFee').value = bid.estimated_shipping_fee || 0;

        document.getElementById('qrStatus').value = (bid.status === '입찰중' || !bid.status) ? '낙찰' : bid.status;
        document.getElementById('qrWinningCompany').value = bid.winning_company || (bid.status === '낙찰' ? '당사(K&G)' : '');
        document.getElementById('qrWinningBidAmount').value = bid.winning_bid_amount > 0 ? bid.winning_bid_amount : (bid.total_delivery_amount || '');
        document.getElementById('qrResultNote').value = bid.result_note || '';

        this.calcQuickResultSimulation();
        if (this.quickResultModalInstance) this.quickResultModalInstance.show();
    },

    handleQuickResultStatusChange: function() {
        const status = document.getElementById('qrStatus').value;
        const winCompanyEl = document.getElementById('qrWinningCompany');
        if (status === '낙찰' && (!winCompanyEl.value || winCompanyEl.value === '타사')) {
            winCompanyEl.value = '당사(K&G)';
            this.copyOurBidToWinning();
        } else if (status === '미선정' && winCompanyEl.value === '당사(K&G)') {
            winCompanyEl.value = '';
        }
        this.calcQuickResultSimulation();
    },

    copyOurBidToWinning: function() {
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

        const metrics = calcWhatIfMetrics(ourBid, winningBid, buyCost, shippingFee, status);

        const diffEl = document.getElementById('qrDiffAmount');
        const diffPercentEl = document.getElementById('qrDiffPercent');
        const simSettlementEl = document.getElementById('qrSimSettlement');
        const simFeeEl = document.getElementById('qrSimFee');
        const simProfitEl = document.getElementById('qrSimProfit');
        const simMarginEl = document.getElementById('qrSimMarginRate');
        const diagBadge = document.getElementById('qrDiagnosisBadge');

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
        const winning_bid_amount = parseFloat(document.getElementById('qrWinningBidAmount').value) || 0;
        const winning_company = document.getElementById('qrWinningCompany').value.trim();
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
        if (status === '낙찰' || status === '미선정') {
            panel.style.display = 'block';
            if (status === '낙찰') {
                panel.classList.remove('lost-mode');
                if (!document.getElementById('formWinningCompany').value) {
                    document.getElementById('formWinningCompany').value = '당사(K&G)';
                }
            } else {
                panel.classList.add('lost-mode');
            }
            this.calcModalWhatIfSimulation();
        } else {
            panel.style.display = 'none';
        }
    },

    copyOurBidToModalWinning: function() {
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

        const metrics = calcWhatIfMetrics(totalDelivery, winningBid, totalBuy, shippingFee, status);

        const diffEl = document.getElementById('modalSimDiff');
        const diffSubEl = document.getElementById('modalSimDiffSub');
        const settlementEl = document.getElementById('modalSimSettlement');
        const feeEl = document.getElementById('modalSimFee');
        const profitEl = document.getElementById('modalSimProfit');
        const marginEl = document.getElementById('modalSimMarginRate');
        const strategyEl = document.getElementById('modalSimStrategy');
        const strategySubEl = document.getElementById('modalSimStrategySub');
        const diagTag = document.getElementById('modalDiagTag');

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
            <td><input type="number" class="item-settlement form-control text-end bg-light" value="${settlementPrice}" min="0" oninput="app.recalcRow(this, 'settlement')"></td>
            <td><input type="number" class="item-fee form-control text-end text-danger bg-light" value="${fee}" readonly></td>
            <td><input type="number" class="item-delivery form-control text-end text-primary fw-bold bg-light" value="${deliveryPrice}" min="0" oninput="app.recalcRow(this, 'delivery')"></td>
            <td class="text-end fw-bold item-profit-cell text-success">${Number(profit).toLocaleString()}원</td>
            <td><input type="text" class="item-note form-control" value="${data.item_note || data.origin_brand || ''}" placeholder="비고"></td>
            <td class="text-center">
                <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.removeItemRow(this)" title="행 삭제">
                    <i class='bx bx-x fs-5'></i>
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

        const payload = {
            title,
            client_name: document.getElementById('formClientName').value.trim(),
            bid_type: document.getElementById('formBidType').value,
            urgency: document.getElementById('formUrgency').value,
            issue_date: document.getElementById('formIssueDate').value,
            bid_deadline: document.getElementById('formBidDeadline').value,
            delivery_deadline: document.getElementById('formDeliveryDeadline').value,
            status: document.getElementById('formStatus').value,
            delivery_address: document.getElementById('formDeliveryAddress').value.trim(),
            delivery_condition: document.getElementById('formDeliveryCondition').value,
            shipping_included: document.getElementById('formShippingIncluded').value,
            manager_info: document.getElementById('formManagerInfo').value.trim(),
            estimated_shipping_fee: parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0,
            winning_bid_amount: parseFloat(document.getElementById('formWinningBidAmount').value) || 0,
            winning_company: document.getElementById('formWinningCompany').value.trim(),
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
        if (status === '낙찰' || status === '미선정') {
            this.openQuickResultModal(bidId);
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
    }
};

// Start on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
