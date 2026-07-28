const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : 'https://kng.junparks.com/api';

let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent.getAuthToken) {
                    window.parent.getAuthToken().then(t => {
                        if (t) { res(t); }
                        else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                        else { _authReady = null; res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = null; res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = null; res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = null; res(null); }
            }
        })();
    });
    return _authReady;
}

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    
    if (!token) {
        try { token = await waitForAuth(); } catch(e) {}
    }
    
    if (!options.headers) options.headers = {};
    if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
    loadCalendarEvents();
    loadWeather();

    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadDashboardData();
        loadCalendarEvents();
        loadWeather();
    });

    // 이벤트 모달 처리
    const modal = document.getElementById('eventModal');
    document.getElementById('addEventBtn').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('closeEventModal').addEventListener('click', () => modal.classList.add('hidden'));
    
    document.getElementById('eventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const summary = document.getElementById('eventSummary').value;
        const start = document.getElementById('eventStart').value;
        const end = document.getElementById('eventEnd').value;
        
        try {
            const res = await authFetch(`${API_BASE}/calendar/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary,
                    start: { date: start },
                    end: { date: end }
                })
            });
            if (!res.ok) throw new Error('일정 등록 실패');
            alert('일정이 등록되었습니다.');
            modal.classList.add('hidden');
            document.getElementById('eventForm').reset();
            loadCalendarEvents();
        } catch (err) {
            alert(err.message);
        }
    });
});

async function loadDashboardData() {
    try {
        const res = await authFetch(`${API_BASE}/dashboard/summary`);
        if (!res.ok) throw new Error('데이터 불러오기 실패');
        const data = await res.json();
        
        renderApprovals(data.pendingExpenses, data.pendingExhibitions);
        renderInvoices(data.pendingInvoices);
        renderLowStock(data.lowStockHqProducts);
        renderRecentSellerK(data.recentSellerKProducts);
        renderWorkLog(data.yesterdayLog);
    } catch (err) {
        console.error(err);
        const errorHtml = `<div class="empty-state" style="color: #ef4444;"><i class='bx bx-error'></i> 데이터를 불러오지 못했습니다. (서버 연결 실패)</div>`;
        document.querySelectorAll('.widget-content:not(#calendarWidget):not(#weatherWidget)').forEach(el => {
            // TradingView 뷰어 등은 건드리지 않기 위해 loading 클래스가 있는 곳만 덮어씌움
            if (el.querySelector('.loading')) {
                el.innerHTML = errorHtml;
            }
        });
    }
}

async function loadWeather() {
    const container = document.getElementById('weatherWidget');
    try {
        // 서울 날씨 좌표: 위도 37.5665, 경도 126.9780 (Open-Meteo 무료 API)
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current_weather=true');
        if (!res.ok) throw new Error('날씨 API 오류');
        const data = await res.json();
        const current = data.current_weather;
        
        container.innerHTML = `
            <div class="list-item" style="display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <div style="font-size: 32px; font-weight: 700; color: var(--primary-color);">
                        ${current.temperature}°C
                    </div>
                    <div style="color: var(--text-muted); font-size: 14px;">풍속: ${current.windspeed} km/h</div>
                </div>
                <i class='bx bx-sun' style="font-size: 48px; color: #f59e0b;"></i>
            </div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="empty-state">날씨 정보를 불러올 수 없습니다.</div>`;
    }
}

async function loadCalendarEvents() {
    const container = document.getElementById('calendarWidget');
    try {
        const res = await authFetch(`${API_BASE}/calendar/events`);
        if (!res.ok) throw new Error('일정 불러오기 실패');
        const events = await res.json();
        
        if (events.length === 0) {
            container.innerHTML = '<div class="empty-state">이번 달 일정이 없습니다.</div>';
            return;
        }
        
        container.innerHTML = events.map(ev => `
            <div class="event-item">
                <div class="event-date">${ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : '')}</div>
                <div class="event-title">${ev.summary}</div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:red">${err.message}</div>`;
    }
}

function renderApprovals(expenses, exhibitions) {
    const container = document.getElementById('approvalWidget');
    let html = '';
    
    if (expenses.length === 0 && exhibitions.length === 0) {
        container.innerHTML = '<div class="empty-state">대기 중인 결재 문서가 없습니다.</div>';
        return;
    }

    expenses.forEach(doc => {
        const getCurrencySymbol = (c) => {
            if (c === 'USD') return '$';
            if (c === 'EUR') return '€';
            if (c === 'JPY') return '¥';
            if (c === 'CNY') return '¥';
            return '₩';
        };
        const curSym = getCurrencySymbol(doc.currency);
        const amtText = Number(doc.amount || 0).toLocaleString(undefined, { minimumFractionDigits: (doc.currency === 'KRW' || !doc.currency) ? 0 : 2 });
        
        html += `
            <div class="list-item">
                <div class="item-header">
                    <span class="item-title">[지출결의] ${doc.title || '제목없음'}</span>
                    <select class="status-select" onchange="updateStatus('expense-resolution', '${doc.id}', this.value)">
                        <option value="임시작성" ${doc.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                        <option value="결재대기" ${doc.status === '결재대기' ? 'selected' : ''}>결재대기</option>
                        <option value="결재상신" ${doc.status === '결재상신' ? 'selected' : ''}>결재상신</option>
                        <option value="결재보류">결재보류</option>
                        <option value="결재완료">결재완료</option>
                    </select>
                </div>
                <div class="item-meta">
                    기안자: ${doc.personInCharge || '-'} | 금액: ${curSym} ${amtText} | 작성일: ${doc.createdAt.split('T')[0]}
                </div>
            </div>
        `;
    });

    exhibitions.forEach(doc => {
        html += `
            <div class="list-item">
                <div class="item-header">
                    <span class="item-title">[참관보고] ${doc.exhibitionName || '전시회명 없음'}</span>
                    <select class="status-select" onchange="updateStatus('exhibition-report', '${doc.id}', this.value)">
                        <option value="임시작성" ${doc.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                        <option value="결재대기" ${doc.status === '결재대기' ? 'selected' : ''}>결재대기</option>
                        <option value="결재상신" ${doc.status === '결재상신' ? 'selected' : ''}>결재상신</option>
                        <option value="결재보류">결재보류</option>
                        <option value="결재완료">결재완료</option>
                    </select>
                </div>
                <div class="item-meta">
                    방문일: ${doc.visitDate || '-'} | 작성일: ${doc.createdAt.split('T')[0]}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderInvoices(invoices) {
    const container = document.getElementById('invoiceWidget');
    if (invoices.length === 0) {
        container.innerHTML = '<div class="empty-state">진행 중인 인보이스가 없습니다.</div>';
        return;
    }

    container.innerHTML = invoices.map(inv => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${inv.invoiceNo || 'No Invoice No'}</span>
                <select class="status-select" onchange="updateStatus('invoice-packing/documents', '${inv.id}', this.value)">
                    <option value="진행중" ${inv.status === '진행중' ? 'selected' : ''}>진행중</option>
                    <option value="보류" ${inv.status === '보류' ? 'selected' : ''}>보류</option>
                    <option value="완료">완료</option>
                </select>
            </div>
            <div class="item-meta">
                작성일: ${inv.docDate || inv.createdAt.split('T')[0]} | Shipper: ${inv.shipper?.name || '-'}
            </div>
        </div>
    `).join('');
}

function renderWorkLog(log) {
    const container = document.getElementById('workLogWidget');
    if (!log) {
        container.innerHTML = '<div class="empty-state">최근 작성된 업무일지가 없습니다.</div>';
        return;
    }

    // JSON 배열 파싱 시도 (금일 진행 업무)
    let tasks = [];
    try { tasks = JSON.parse(log.todayTasks || '[]'); } catch(e) {}
    
    // JSON 배열 파싱 시도 (명일 예정 업무)
    let next = [];
    try { next = JSON.parse(log.nextTasks || '[]'); } catch(e) {}

    const tasksHtml = tasks.length > 0 
        ? tasks.map(t => `<li><i class='bx bx-check'></i> ${t.content}</li>`).join('') 
        : '<li>진행한 업무가 없습니다.</li>';
        
    const nextHtml = next.length > 0 
        ? next.map(t => `<li><i class='bx bx-right-arrow-alt'></i> ${t.content}</li>`).join('') 
        : '<li>예정된 업무가 없습니다.</li>';

    container.innerHTML = `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">작성일자: ${log.date}</span>
            </div>
            <div style="font-size: 13px; margin-top: 8px;">
                <strong>[금일 진행 업무]</strong>
                <ul style="list-style:none; padding:0; margin: 4px 0 12px 0; color: var(--text-muted);">
                    ${tasksHtml}
                </ul>
                <strong>[명일 예정 업무]</strong>
                <ul style="list-style:none; padding:0; margin: 4px 0 0 0; color: var(--text-muted);">
                    ${nextHtml}
                </ul>
            </div>
        </div>
    `;
}

function renderLowStock(products) {
    const container = document.getElementById('lowStockWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">안전재고 미달 품목이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name} (${p.color}, ${p.size})</span>
                <span class="badge danger">재고: ${p.stock}</span>
            </div>
            <div class="item-meta">공급사: ${p.supplier} | 브랜드: ${p.brand}</div>
        </div>
    `).join('');
}

function renderRecentSellerK(products) {
    const container = document.getElementById('recentSellerKWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">최근 5일 이내 변동 내역이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name}</span>
                <span class="badge">수정일: ${p.updatedAt.split('T')[0]}</span>
            </div>
            <div class="item-meta">옵션: ${p.color} / ${p.size}</div>
        </div>
    `).join('');
}

async function updateStatus(apiEndpoint, id, newStatus) {
    try {
        const res = await authFetch(`${API_BASE}/${apiEndpoint}/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('상태 변경 실패');
        
        // 보류나 완료 등 화면에서 사라져야 할 상태면 목록 새로고침
        if (newStatus === '결재완료' || newStatus === '결재보류' || newStatus === '완료') {
            loadDashboardData();
        }
    } catch (err) {
        alert(err.message);
        loadDashboardData(); // 롤백
    }
}
