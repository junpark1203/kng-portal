/**
 * 공새로 입찰관리 프론트엔드 로직
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

// ── 공새로 수수료 공식 (노션 1-2. 거래수수료 100% 반영) ──
function calcGongsaeroFee(settlementPrice) {
    const sPrice = Math.round(Number(settlementPrice) || 0);
    if (sPrice > 16) {
        return Math.floor(sPrice * 0.06); // 16원 초과: 6% 계산 후 소수점 절삭
    } else if (sPrice >= 1) {
        return 1; // 1원~16원: 최소 수수료 1원
    }
    return 0;
}

// 납품단가로부터 역산 (경우 2)
function calcSettlementFromDelivery(deliveryPrice) {
    const dPrice = Math.round(Number(deliveryPrice) || 0);
    if (dPrice > 17) {
        const settlementPrice = Math.ceil(dPrice / 1.06);
        const fee = dPrice - settlementPrice;
        return { settlementPrice, fee };
    } else if (dPrice >= 1) {
        return { settlementPrice: dPrice - 1, fee: 1 };
    }
    return { settlementPrice: 0, fee: 0 };
}

// ──────────────────────────────────────────────
// 메인 APP 객체
// ──────────────────────────────────────────────
const app = {
    currentView: 'bids', // 'bids' or 'items'
    bidsData: [],
    itemsHistoryData: [],
    modalInstance: null,
    searchDebounceTimer: null,

    init: async function() {
        this.modalInstance = new bootstrap.Modal(document.getElementById('bidModal'));
        await this.loadBids();
    },

    switchView: function(viewName) {
        this.currentView = viewName;
        const tabBidsBtn = document.getElementById('tabBidsBtn');
        const tabItemsBtn = document.getElementById('tabItemsBtn');
        const viewBids = document.getElementById('viewBids');
        const viewItems = document.getElementById('viewItems');
        const statusFilterGroup = document.getElementById('statusFilterGroup');

        if (viewName === 'bids') {
            tabBidsBtn.classList.add('active');
            tabItemsBtn.classList.remove('active');
            viewBids.style.display = 'block';
            viewItems.style.display = 'none';
            statusFilterGroup.style.display = 'flex';
            this.loadBids();
        } else {
            tabItemsBtn.classList.add('active');
            tabBidsBtn.classList.remove('active');
            viewBids.style.display = 'none';
            viewItems.style.display = 'block';
            statusFilterGroup.style.display = 'none';
            const query = document.getElementById('globalSearchInput').value.trim();
            this.loadItemHistory(query);
        }
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
                <td colspan="11" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm text-primary mb-2"></div>
                    <div>데이터를 불러오는 중입니다...</div>
                </td>
            </tr>
        `;

        try {
            const token = await getAuthToken();
            const url = new URL(`${API_BASE}/bids`);
            if (status) url.searchParams.append('status', status);
            if (query) url.searchParams.append('query', query);
            if (sort) url.searchParams.append('sort', sort);

            const res = await fetch(url.toString(), {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('데이터 조회 실패');

            const data = await res.json();
            this.bidsData = data.bids || [];
            
            this.renderBidsTable(this.bidsData, query);
            this.renderKPIs(data.stats || {});
            document.getElementById('badgeBidsCount').innerText = this.bidsData.length;
        } catch (err) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle fs-4'></i><br>
                        데이터를 불러오는 중 오류가 발생했습니다: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    renderKPIs: function(stats) {
        document.getElementById('kpiBiddingCount').innerHTML = `${Number(stats.bidding_count || 0)}<span class="fs-6 fw-normal text-muted ms-1">건</span>`;
        document.getElementById('kpiWonCount').innerHTML = `${Number(stats.won_count || 0)}<span class="fs-6 fw-normal text-muted ms-1">건</span>`;
        document.getElementById('kpiWonAmount').innerText = `누적 수주: ${Number(stats.won_amount || 0).toLocaleString()}원`;
        document.getElementById('kpiAvgMargin').innerText = `${Number(stats.avg_won_margin || 0).toFixed(1)}%`;
        document.getElementById('kpiWonProfit').innerText = `${Number(stats.won_profit || 0).toLocaleString()}원`;
    },

    renderBidsTable: function(bids, highlightQuery = '') {
        const tbody = document.getElementById('bidsTableBody');
        if (!bids || bids.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11">
                        <div class="empty-state">
                            <i class='bx bx-folder-open'></i>
                            <h3>등록된 입찰 공고가 없습니다</h3>
                            <p>우측 상단의 '+ 새 입찰공고 등록' 버튼을 눌러 공고 및 투찰 품목을 등록해 보세요.</p>
                            <button class="btn btn-sm btn-primary" onclick="app.openNewBidModal()">
                                <i class='bx bx-plus-circle'></i> 새 입찰공고 등록하기
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const now = new Date();
        tbody.innerHTML = '';

        bids.forEach(b => {
            const tr = document.createElement('tr');
            
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
                const formattedDate = b.bid_deadline.replace('T', ' ').substring(0, 16);
                
                if (diffMs > 0) {
                    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                    let remainStr = diffHours > 24 
                        ? `D-${Math.ceil(diffHours / 24)}` 
                        : `${diffHours}시간 ${diffMinutes}분 남음`;
                    deadlineHtml = `<div>${formattedDate}</div><span class="countdown-badge mt-1"><i class='bx bx-time'></i> ${remainStr}</span>`;
                } else {
                    deadlineHtml = `<div>${formattedDate}</div><span class="badge bg-secondary-subtle text-secondary border mt-1">마감됨</span>`;
                }
            }

            // 하이라이트 함수
            const hl = (txt) => {
                if (!highlightQuery || !txt) return txt || '';
                const re = new RegExp(`(${highlightQuery})`, 'gi');
                return String(txt).replace(re, `<span class="highlight-match">$1</span>`);
            };

            const urgencyBadge = b.urgency === '긴급' 
                ? `<span class="urgency-badge me-1">긴급</span>` 
                : '';

            tr.innerHTML = `
                <td>
                    <span class="status-badge ${statusClass}">
                        ${b.status || '입찰중'}
                    </span>
                </td>
                <td>
                    <div class="fw-bold fs-6">
                        ${urgencyBadge}
                        <a href="javascript:app.openEditBidModal('${b.id}')" class="text-dark text-decoration-none text-hover-primary">
                            ${hl(b.title)}
                        </a>
                    </div>
                    <div class="small text-muted mt-1">
                        <span class="badge bg-light text-dark border me-1">${b.bid_type || '공개 입찰'}</span>
                        <i class='bx bx-map text-secondary'></i> ${hl(b.delivery_address || '주소 미지정')}
                    </div>
                    ${b.sample_items ? `<div class="small text-secondary mt-1">품목: ${hl(b.sample_items)}...</div>` : ''}
                </td>
                <td>
                    <span class="fw-semibold">${hl(b.client_name || '-')}</span>
                </td>
                <td>${deadlineHtml}</td>
                <td>
                    <span class="badge bg-light text-secondary border">${b.delivery_condition || '하차도'}</span>
                    <div class="small text-muted mt-1">${b.shipping_included ? '배송비 포함' : '배송비 별도'}</div>
                </td>
                <td class="text-center">
                    <span class="badge bg-primary-subtle text-primary border">${b.item_count || 0}개</span>
                </td>
                <td class="text-end fw-semibold text-secondary">
                    ${Number(b.total_buy_cost || 0).toLocaleString()}원
                </td>
                <td class="text-end fw-bold text-primary fs-6">
                    ${Number(b.total_delivery_amount || 0).toLocaleString()}원
                </td>
                <td class="text-end fw-bold text-success">
                    ${Number(b.total_profit || 0).toLocaleString()}원
                </td>
                <td class="text-end fw-bold">
                    <span class="text-${b.profit_rate >= 15 ? 'success' : (b.profit_rate >= 10 ? 'primary' : 'warning')}">
                        ${Number(b.profit_rate || 0).toFixed(1)}%
                    </span>
                </td>
                <td class="text-center">
                    <div class="dropdown">
                        <button class="btn btn-sm btn-light border dropdown-toggle" type="button" data-bs-toggle="dropdown">
                            관리
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end shadow-sm">
                            <li><a class="dropdown-item" href="javascript:app.openEditBidModal('${b.id}')"><i class='bx bx-edit'></i> 상세/수정</a></li>
                            <li><hr class="dropdown-divider"></li>
                            <li><h6 class="dropdown-header">상태 변경</h6></li>
                            <li><a class="dropdown-item text-success" href="javascript:app.quickChangeStatus('${b.id}', '낙찰')"><i class='bx bx-check-circle'></i> 낙찰 (성공)</a></li>
                            <li><a class="dropdown-item text-muted" href="javascript:app.quickChangeStatus('${b.id}', '미선정')"><i class='bx bx-x-circle'></i> 미선정 (탈락)</a></li>
                            <li><a class="dropdown-item text-warning" href="javascript:app.quickChangeStatus('${b.id}', '입찰중')"><i class='bx bx-time'></i> 입찰중 (복원)</a></li>
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

    // ── 품목별 투찰 이력 검색 로드 (핵심 기능) ──
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
                return String(txt).replace(re, `<span class="highlight-match">$1</span>`);
            };

            tbody.innerHTML = '';
            this.itemsHistoryData.forEach(item => {
                const tr = document.createElement('tr');

                let statusClass = 'bidding';
                if (item.bid_status === '낙찰') statusClass = 'won';
                else if (item.bid_status === '미선정') statusClass = 'lost';
                else if (item.bid_status === '입찰포기') statusClass = 'abandoned';

                const dateStr = (item.issue_date || '').substring(0, 10) || (item.created_at || '').substring(0, 10);

                tr.innerHTML = `
                    <td class="text-muted small">${dateStr}</td>
                    <td><span class="status-badge ${statusClass}">${item.bid_status || '입찰중'}</span></td>
                    <td class="fw-bold">${hl(item.item_name)}</td>
                    <td>${hl(item.spec || '-')}</td>
                    <td class="text-center">${item.unit || 'EA'}</td>
                    <td class="text-end fw-semibold">${Number(item.qty || 0).toLocaleString()}</td>
                    <td class="text-end fw-semibold text-secondary">${Number(item.buy_price || 0).toLocaleString()}원</td>
                    <td class="text-end fw-bold text-muted">${Number(item.margin_rate || 0).toFixed(1)}%</td>
                    <td class="text-end">${Number(item.settlement_price || 0).toLocaleString()}원</td>
                    <td class="text-end text-danger fw-semibold">${Number(item.gongsaero_fee || 0).toLocaleString()}원</td>
                    <td class="text-end fw-bold text-primary fs-6">${Number(item.delivery_price || 0).toLocaleString()}원</td>
                    <td class="text-end fw-bold text-success">${Number(item.item_profit || 0).toLocaleString()}원</td>
                    <td>
                        <a href="javascript:app.openEditBidModal('${item.bid_id}')" class="text-dark text-decoration-none">
                            <i class='bx bx-link-external text-primary'></i> ${hl(item.bid_title)}
                        </a>
                        <div class="small text-muted">${item.client_name || ''}</div>
                    </td>
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

    // ── 공고 모달 열기 (신규) ──
    openNewBidModal: function() {
        document.getElementById('modalTitle').innerText = '새 입찰공고 등록 및 투찰서 작성';
        document.getElementById('modalBidIdBadge').innerText = 'NEW';
        document.getElementById('editBidId').value = '';

        // Form reset
        document.getElementById('formTitle').value = '';
        document.getElementById('formClientName').value = '';
        document.getElementById('formBidType').value = '공개 입찰';
        document.getElementById('formUrgency').value = '일반';
        
        // 날짜 기본값 설정 (오늘 및 마감시간)
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        document.getElementById('formIssueDate').value = now.toISOString().slice(0, 16);
        document.getElementById('formBidDeadline').value = tomorrow.toISOString().slice(0, 16);
        document.getElementById('formDeliveryDeadline').value = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString().slice(0, 16);
        
        document.getElementById('formStatus').value = '입찰중';
        document.getElementById('formDeliveryAddress').value = '';
        document.getElementById('formDeliveryCondition').value = '하차도';
        document.getElementById('formDeliveryMethod').value = '납품업체 직접배송';
        document.getElementById('formShippingIncluded').value = '1';
        document.getElementById('formEstimatedShippingFee').value = '';
        document.getElementById('formManagerInfo').value = '';
        document.getElementById('formRemarks').value = '';

        // 품목 테이블 초기화
        const tbody = document.getElementById('itemsInputTbody');
        tbody.innerHTML = '';
        this.addItemRow(); // 기본 1행 추가

        this.updateSummaryMetrics();
        this.modalInstance.show();
    },

    // ── 공고 모달 열기 (수정) ──
    openEditBidModal: async function(bidId) {
        document.getElementById('modalTitle').innerText = '입찰공고 상세 및 투찰서 수정';
        document.getElementById('modalBidIdBadge').innerText = bidId;
        document.getElementById('editBidId').value = bidId;

        try {
            const token = await getAuthToken();
            const res = await fetch(`${API_BASE}/bids/${bidId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('공고 상세정보를 불러올 수 없습니다.');

            const { bid, items } = await res.json();

            // Populate form
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
            document.getElementById('formDeliveryMethod').value = bid.delivery_method || '납품업체 직접배송';
            document.getElementById('formShippingIncluded').value = bid.shipping_included !== undefined ? String(bid.shipping_included) : '1';
            document.getElementById('formEstimatedShippingFee').value = bid.estimated_shipping_fee || '';
            document.getElementById('formManagerInfo').value = bid.manager_info || bid.author_info || '';
            document.getElementById('formRemarks').value = bid.remarks || '';

            // Populate items
            const tbody = document.getElementById('itemsInputTbody');
            tbody.innerHTML = '';

            if (items && items.length > 0) {
                items.forEach((item, idx) => {
                    this.addItemRow(item, idx + 1);
                });
            } else {
                this.addItemRow();
            }

            this.updateSummaryMetrics();
            this.modalInstance.show();
        } catch (err) {
            alert(err.message);
        }
    },

    // ── 품목 행 추가 ──
    addItemRow: function(data = {}, rowNo = null) {
        const tbody = document.getElementById('itemsInputTbody');
        const count = tbody.querySelectorAll('tr').length + 1;
        const no = rowNo || count;

        const tr = document.createElement('tr');
        tr.dataset.itemNo = no;

        const qty = data.qty || 1;
        const buyPrice = data.buy_price || 0;
        const marginRate = data.margin_rate !== undefined ? data.margin_rate : 15;
        
        // 정산단가 및 수수료, 납품단가 계산
        let settlementPrice = data.settlement_price || Math.round(buyPrice * (1 + marginRate / 100));
        let fee = calcGongsaeroFee(settlementPrice);
        let deliveryPrice = data.delivery_price || (settlementPrice + fee);
        let profit = (settlementPrice - buyPrice) * qty;

        tr.innerHTML = `
            <td class="text-center fw-bold text-muted row-num">${no}</td>
            <td><input type="text" class="item-name" value="${data.item_name || ''}" placeholder="품목명 입력" required></td>
            <td><input type="text" class="item-spec" value="${data.spec || ''}" placeholder="규격"></td>
            <td><input type="text" class="item-unit text-center" value="${data.unit || 'EA'}" placeholder="단위"></td>
            <td><input type="number" class="item-qty text-end" value="${qty}" min="0" step="any" oninput="app.recalcRow(this)"></td>
            <td><input type="number" class="item-buy text-end" value="${buyPrice}" min="0" placeholder="매입단가" oninput="app.recalcRow(this, 'buy')"></td>
            <td><input type="number" class="item-margin text-end" value="${marginRate}" step="0.5" placeholder="%" oninput="app.recalcRow(this, 'margin')"></td>
            <td><input type="number" class="item-settlement text-end cell-calc" value="${settlementPrice}" min="0" oninput="app.recalcRow(this, 'settlement')"></td>
            <td><input type="number" class="item-fee text-end cell-fee" value="${fee}" readonly title="공새로 6% 수수료(자동산출)"></td>
            <td><input type="number" class="item-delivery text-end cell-highlight" value="${deliveryPrice}" min="0" oninput="app.recalcRow(this, 'delivery')"></td>
            <td class="text-end fw-bold item-profit-cell text-success">${Number(profit).toLocaleString()}원</td>
            <td><input type="text" class="item-note" value="${data.item_note || data.origin_brand || ''}" placeholder="비고"></td>
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
        // 행 번호 재정렬
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        rows.forEach((r, idx) => {
            r.querySelector('.row-num').innerText = idx + 1;
            r.dataset.itemNo = idx + 1;
        });
        this.updateSummaryMetrics();
    },

    // ── 실시간 단가 재계산 엔진 (상호 연동) ──
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
            // 매입가 or 마진율 변경 시 -> 정산단가 -> 수수료 -> 납품단가 자동 도출
            settlementPrice = Math.round(buyPrice * (1 + marginRate / 100));
            settlementInput.value = settlementPrice;
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        } else if (trigger === 'settlement') {
            // 정산단가 직접 변경 시 -> 마진율 역산 -> 수수료 -> 납품단가
            if (buyPrice > 0) {
                marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                marginInput.value = marginRate;
            }
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        } else if (trigger === 'delivery') {
            // 납품단가 직접 변경 시 -> 경우 2 (역산 공식) 적용!
            const { settlementPrice: sPrice, fee } = calcSettlementFromDelivery(deliveryPrice);
            settlementPrice = sPrice;
            settlementInput.value = settlementPrice;
            feeInput.value = fee;
            if (buyPrice > 0) {
                marginRate = Number(((settlementPrice - buyPrice) / buyPrice * 100).toFixed(1));
                marginInput.value = marginRate;
            }
        } else {
            // 수량 변경 등
            const fee = calcGongsaeroFee(settlementPrice);
            feeInput.value = fee;
            deliveryInput.value = settlementPrice + fee;
        }

        const profit = (settlementPrice - buyPrice) * qty;
        profitCell.innerText = `${Number(profit).toLocaleString()}원`;

        this.updateSummaryMetrics();
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

        // 예상 용차비 차감 고려
        const shippingFee = parseFloat(document.getElementById('formEstimatedShippingFee').value) || 0;
        const netProfit = totalProfit - shippingFee;
        const profitRate = totalBuy > 0 ? ((netProfit / totalBuy) * 100).toFixed(1) : '0.0';

        document.getElementById('sumBuyCost').innerText = `${Number(totalBuy).toLocaleString()}원`;
        document.getElementById('sumGongsaeroFee').innerText = `${Number(totalFee).toLocaleString()}원`;
        document.getElementById('sumSettlementAmount').innerText = `${Number(totalSettlement).toLocaleString()}원`;
        document.getElementById('sumDeliveryTotal').innerText = `${Number(totalDelivery).toLocaleString()}원`;
        document.getElementById('sumProfitAndRate').innerText = `${Number(netProfit).toLocaleString()}원 (${profitRate}%)`;
    },

    // ── 배송비/용차비 품목별 수량비율 안분 분배 ──
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
            alert('품목의 수량이 0보다 커야 안분할 수 있습니다.');
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

        alert('용차비가 각 품목의 매입단가에 정상 안분되었습니다.');
    },

    // ── 캡처 예시 13종 품목 샘플 일괄 불러오기 ──
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

        // 캡처 기본 정보도 세팅
        if (!document.getElementById('formTitle').value) {
            document.getElementById('formTitle').value = '[(주)범양이앤씨] 청담 1,2교 확장 구조물 공사 | 일회성 입찰';
            document.getElementById('formClientName').value = '(주)범양이앤씨';
            document.getElementById('formUrgency').value = '긴급';
            document.getElementById('formDeliveryAddress').value = '서울 송파구 잠실동 1-1, 내비 종료시 직진 / 담당자 연락';
            document.getElementById('formDeliveryCondition').value = '하차도';
            document.getElementById('formDeliveryMethod').value = '납품업체 직접배송';
            document.getElementById('formManagerInfo').value = '작성자: 나종수 주임(010-8006-6945) / 김도현 차장(010-3135-4130)';
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
                unit: r.querySelector('.item-unit').value.trim() || 'EA',
                qty: parseFloat(r.querySelector('.item-qty').value) || 0,
                buy_price: parseFloat(r.querySelector('.item-buy').value) || 0,
                margin_rate: parseFloat(r.querySelector('.item-margin').value) || 0,
                settlement_price: parseFloat(r.querySelector('.item-settlement').value) || 0,
                item_note: r.querySelector('.item-note').value.trim()
            });
        });

        if (hasItemError) {
            alert('품목명이 비어 있는 행이 있습니다. 모든 품목명을 입력해주세요.');
            return;
        }

        const payload = {
            title: title,
            client_name: document.getElementById('formClientName').value.trim(),
            bid_type: document.getElementById('formBidType').value,
            urgency: document.getElementById('formUrgency').value,
            issue_date: document.getElementById('formIssueDate').value,
            bid_deadline: document.getElementById('formBidDeadline').value,
            delivery_deadline: document.getElementById('formDeliveryDeadline').value,
            status: document.getElementById('formStatus').value,
            delivery_address: document.getElementById('formDeliveryAddress').value.trim(),
            delivery_condition: document.getElementById('formDeliveryCondition').value,
            delivery_method: document.getElementById('formDeliveryMethod').value,
            shipping_included: document.getElementById('formShippingIncluded').value,
            estimated_shipping_fee: document.getElementById('formEstimatedShippingFee').value,
            manager_info: document.getElementById('formManagerInfo').value.trim(),
            remarks: document.getElementById('formRemarks').value.trim(),
            items: items
        };

        try {
            const token = await getAuthToken();
            const url = bidId ? `${API_BASE}/bids/${bidId}` : `${API_BASE}/bids`;
            const method = bidId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method: method,
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

            alert(bidId ? '공고가 성공적으로 수정되었습니다.' : '새 입찰공고가 성공적으로 등록되었습니다.');
            this.modalInstance.hide();
            await this.loadBids();
        } catch (err) {
            alert(err.message);
        }
    },

    // ── 빠른 상태 변경 ──
    quickChangeStatus: async function(bidId, status) {
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
            alert('공고가 삭제되었습니다.');
            this.loadBids();
        } catch (err) {
            alert(err.message);
        }
    },

    // ── 공새로 사이트 투찰용 고객사 납품단가 일괄 클립보드 복사 ──
    copyDeliveryPricesToClipboard: function() {
        const rows = document.querySelectorAll('#itemsInputTbody tr');
        if (rows.length === 0) {
            alert('복사할 품목이 없습니다.');
            return;
        }

        const lines = [];
        rows.forEach(r => {
            const name = r.querySelector('.item-name').value.trim();
            const deliveryPrice = r.querySelector('.item-delivery').value || 0;
            lines.push(`${deliveryPrice}`);
        });

        const textToCopy = lines.join('\n');
        navigator.clipboard.writeText(textToCopy).then(() => {
            alert(`총 ${lines.length}개 품목의 '고객사 납품단가'가 클립보드에 복사되었습니다!\n공새로 투찰창에 순서대로 붙여넣으실 수 있습니다.`);
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
            ['No', '품목명', '규격', '단위', '수량', '우리의 매입가', '마진율(%)', '정산단가', '공새로 수수료(6%)', '고객사 납품단가', '품목 순이익', '비고']
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

            const excelRows = this.bidsData.map(b => ({
                '공고번호': b.id,
                '공고/공사명': b.title,
                '발주처': b.client_name,
                '상태': b.status,
                '긴급여부': b.urgency,
                '투찰마감일': b.bid_deadline,
                '납품기한': b.delivery_deadline,
                '인도조건': b.delivery_condition,
                '납품주소': b.delivery_address,
                '총 매입원가': b.total_buy_cost,
                '총 정산금액': b.total_settlement,
                '총 공새로수수료': b.total_fee,
                '고객사 납품총액': b.total_delivery_amount,
                '예상 순이익': b.total_profit,
                '마진율(%)': b.profit_rate
            }));

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
                '우리의 매입가': i.buy_price,
                '마진율(%)': i.margin_rate,
                '희망 정산단가': i.settlement_price,
                '공새로 수수료': i.gongsaero_fee,
                '고객사 납품단가': i.delivery_price,
                '품목 순이익': i.item_profit
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
