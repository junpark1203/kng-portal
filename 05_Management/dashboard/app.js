/* ════════════════════════════════════════════
   K&G 관리자 대시보드 — App Logic
   ════════════════════════════════════════════ */

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api'
    : 'https://kng.junparks.com/api';

// ── Auth 헬퍼 ──
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
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
}


// ── WMO Weather Code → 아이콘/설명 매핑 ──
const WMO_MAP = {
    0:  { icon: '☀️', desc: '맑음' },
    1:  { icon: '🌤️', desc: '대체로 맑음' },
    2:  { icon: '⛅', desc: '구름 조금' },
    3:  { icon: '☁️', desc: '흐림' },
    45: { icon: '🌫️', desc: '안개' },
    48: { icon: '🌫️', desc: '짙은 안개' },
    51: { icon: '🌦️', desc: '이슬비' },
    53: { icon: '🌦️', desc: '이슬비' },
    55: { icon: '🌦️', desc: '이슬비' },
    56: { icon: '🌧️', desc: '빙결 이슬비' },
    57: { icon: '🌧️', desc: '빙결 이슬비' },
    61: { icon: '🌧️', desc: '약한 비' },
    63: { icon: '🌧️', desc: '비' },
    65: { icon: '🌧️', desc: '강한 비' },
    66: { icon: '🌧️', desc: '빙결 비' },
    67: { icon: '🌧️', desc: '빙결 비' },
    71: { icon: '🌨️', desc: '약한 눈' },
    73: { icon: '🌨️', desc: '눈' },
    75: { icon: '🌨️', desc: '강한 눈' },
    77: { icon: '🌨️', desc: '싸라기눈' },
    80: { icon: '🌦️', desc: '소나기' },
    81: { icon: '🌧️', desc: '소나기' },
    82: { icon: '🌧️', desc: '강한 소나기' },
    85: { icon: '🌨️', desc: '눈 소나기' },
    86: { icon: '🌨️', desc: '눈 소나기' },
    95: { icon: '⛈️', desc: '뇌우' },
    96: { icon: '⛈️', desc: '뇌우 (우박)' },
    99: { icon: '⛈️', desc: '뇌우 (강한 우박)' },
};

function getWeatherInfo(code) {
    return WMO_MAP[code] || { icon: '🌡️', desc: '알 수 없음' };
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];


// ── DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {
    updateTimestamp();
    loadAll();

    document.getElementById('refreshBtn').addEventListener('click', () => {
        const btn = document.getElementById('refreshBtn');
        btn.querySelector('i').style.animation = 'spin 0.5s linear';
        setTimeout(() => btn.querySelector('i').style.animation = '', 500);
        loadAll();
    });

    // 이벤트 모달 처리
    const modal = document.getElementById('eventModal');
    document.getElementById('addEventBtn').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('closeEventModal').addEventListener('click', () => modal.classList.add('hidden'));

    const allDayCheckbox = document.getElementById('eventAllDay');
    const startTimeInput = document.getElementById('eventStartTime');
    const endTimeInput = document.getElementById('eventEndTime');
    const startDateInput = document.getElementById('eventStartDate');
    const endDateInput = document.getElementById('eventEndDate');

    allDayCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            startTimeInput.style.display = 'none';
            endTimeInput.style.display = 'none';
            startTimeInput.required = false;
            endTimeInput.required = false;
        } else {
            startTimeInput.style.display = 'block';
            endTimeInput.style.display = 'block';
            startTimeInput.required = true;
            endTimeInput.required = true;
        }
    });

    startDateInput.addEventListener('change', (e) => {
        if (!endDateInput.value) {
            endDateInput.value = e.target.value;
        }
    });

    document.getElementById('eventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const summary = document.getElementById('eventSummary').value;
        const isAllDay = document.getElementById('eventAllDay').checked;
        const startDate = document.getElementById('eventStartDate').value;
        const endDate = document.getElementById('eventEndDate').value;
        const startTime = document.getElementById('eventStartTime').value;
        const endTime = document.getElementById('eventEndTime').value;

        let startPayload, endPayload;

        if (isAllDay) {
            const endD = new Date(endDate);
            endD.setDate(endD.getDate() + 1);
            const endStr = endD.toISOString().split('T')[0];

            startPayload = { date: startDate };
            endPayload = { date: endStr };
        } else {
            // Local timezone is applied when creating Date objects
            const startDt = new Date(`${startDate}T${startTime}:00`);
            const endDt = new Date(`${endDate}T${endTime}:00`);
            
            // Format dateTime for Google Calendar
            const formatToRFC3339 = (date) => {
                const pad = (n) => (n < 10 ? '0' + n : n);
                const offset = -date.getTimezoneOffset();
                const sign = offset >= 0 ? '+' : '-';
                const offHours = pad(Math.floor(Math.abs(offset) / 60));
                const offMinutes = pad(Math.abs(offset) % 60);
                
                return date.getFullYear() +
                    '-' + pad(date.getMonth() + 1) +
                    '-' + pad(date.getDate()) +
                    'T' + pad(date.getHours()) +
                    ':' + pad(date.getMinutes()) +
                    ':' + pad(date.getSeconds()) +
                    sign + offHours + ':' + offMinutes;
            };

            startPayload = { dateTime: formatToRFC3339(startDt), timeZone: 'Asia/Seoul' };
            endPayload = { dateTime: formatToRFC3339(endDt), timeZone: 'Asia/Seoul' };
        }

        try {
            const res = await authFetch(`${API_BASE}/calendar/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary,
                    start: startPayload,
                    end: endPayload
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

function loadAll() {
    updateTimestamp();
    loadExchangeData();
    loadWeather();
    loadCalendarEvents();
    loadDashboardData();
    loadMarketIndices();
}

async function loadMarketIndices() {
    const container = document.getElementById('customMarketWidget');
    if (!container) return;

    try {
        const res = await authFetch(`${API_BASE}/dashboard/market-indices`);
        if (!res.ok) {
            let errMsg = 'API 오류';
            try {
                const errData = await res.json();
                if (errData.error) errMsg = errData.error;
            } catch (e) {}
            throw new Error(errMsg);
        }
        const data = await res.json();

        container.innerHTML = '';
        data.forEach(idx => {
            if (!idx.price) return;
            const isUp = idx.change > 0;
            const colorClass = isUp ? 'up' : (idx.change < 0 ? 'down' : '');
            const icon = isUp ? "<i class='bx bx-caret-up'></i>" : (idx.change < 0 ? "<i class='bx bx-caret-down'></i>" : "");
            
            const html = `
                <div class="market-index-item">
                    <div class="market-index-name">${idx.name}</div>
                    <div class="market-index-data">
                        <span class="market-index-price">${idx.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                        <span class="market-index-change ${colorClass}">
                            ${icon} ${idx.changePercent > 0 ? '+' : ''}${idx.changePercent.toFixed(2)}%
                        </span>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
        });
    } catch (err) {
        console.error('증시 데이터 로딩 실패:', err);
        container.innerHTML = `<div class="market-error">${err.message || '데이터를 불러올 수 없습니다.'}</div>`;
    }
}

function updateTimestamp() {
    const el = document.getElementById('headerTimestamp');
    if (el) {
        const now = new Date();
        el.textContent = new Intl.DateTimeFormat('ko-KR', {
            month: 'long', day: 'numeric', weekday: 'short',
            hour: '2-digit', minute: '2-digit'
        }).format(now);
    }
}


/* ════════════════════════════════
   환율 데이터 (Frankfurter API — 프론트엔드 직접 호출)
   ════════════════════════════════ */
async function loadExchangeData() {
    const container = document.getElementById('exchangeGrid');
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        if (!res.ok) throw new Error('환율 API 오류');
        const data = await res.json();

        const usdToKrw = data.rates.KRW;

        const rates = [
            { currency: 'USD', name: '미국 달러', rate: usdToKrw,                                     flag: '🇺🇸', unit: '1 USD' },
            { currency: 'EUR', name: '유로',     rate: usdToKrw / data.rates.EUR,                     flag: '🇪🇺', unit: '1 EUR' },
            { currency: 'JPY', name: '일본 엔',   rate: (usdToKrw / data.rates.JPY) * 100,            flag: '🇯🇵', unit: '100 JPY' },
            { currency: 'CNY', name: '중국 위안',  rate: usdToKrw / data.rates.CNY,                    flag: '🇨🇳', unit: '1 CNY' },
        ];

        container.innerHTML = rates.map(r => `
            <div class="exchange-item">
                <span class="fx-flag">${r.flag}</span>
                <span class="fx-label">${r.currency}/KRW</span>
                <span class="fx-rate">₩${formatNumber(r.rate, 2)}</span>
                <span class="fx-sub">${r.unit}</span>
            </div>
        `).join('');
    } catch (err) {
        console.error('환율 오류:', err);
        container.innerHTML = `
            <div class="exchange-item" style="grid-column: 1 / -1; padding: 16px;">
                <span class="fx-label" style="color: var(--text-tertiary);">환율 정보를 불러올 수 없습니다</span>
            </div>
        `;
    }
}


/* ════════════════════════════════
   날씨 (오늘 + 주간 예보)
   ════════════════════════════════ */
async function loadWeather() {
    const container = document.getElementById('weatherWidget');
    try {
        const res = await fetch(
            'https://api.open-meteo.com/v1/forecast' +
            '?latitude=37.5665&longitude=126.9780' +
            '&current_weather=true' +
            '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
            '&timezone=Asia/Seoul' +
            '&forecast_days=7'
        );
        if (!res.ok) throw new Error('날씨 API 오류');
        const data = await res.json();
        const current = data.current_weather;
        const daily = data.daily;

        // 오늘 날씨
        const todayInfo = getWeatherInfo(current.weathercode);
        const todayMax = Math.round(daily.temperature_2m_max[0]);
        const todayMin = Math.round(daily.temperature_2m_min[0]);
        const todayPrecip = daily.precipitation_probability_max[0] ?? 0;

        // 주간 예보
        let weeklyHtml = '';
        const todayStr = new Date().toISOString().split('T')[0];
        for (let i = 0; i < daily.time.length; i++) {
            const d = new Date(daily.time[i] + 'T00:00:00');
            const dayName = DAY_NAMES[d.getDay()];
            const info = getWeatherInfo(daily.weather_code[i]);
            const max = Math.round(daily.temperature_2m_max[i]);
            const min = Math.round(daily.temperature_2m_min[i]);
            const isToday = daily.time[i] === todayStr;

            weeklyHtml += `
                <div class="weather-day ${isToday ? 'today' : ''}">
                    <span class="weather-day-label">${isToday ? '오늘' : dayName}</span>
                    <span class="weather-day-icon">${info.icon}</span>
                    <span class="weather-day-temp">${max}°</span>
                    <span class="weather-day-temp-min">${min}°</span>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="weather-today">
                <div class="weather-icon">${todayInfo.icon}</div>
                <div class="weather-main">
                    <div class="weather-temp">${Math.round(current.temperature)}°C</div>
                    <div class="weather-desc">${todayInfo.desc}</div>
                    <div class="weather-meta">
                        <span><i class='bx bx-up-arrow-alt'></i>${todayMax}° / <i class='bx bx-down-arrow-alt'></i>${todayMin}°</span>
                        <span><i class='bx bx-droplet'></i>${todayPrecip}%</span>
                    </div>
                </div>
            </div>
            <div class="weather-weekly">${weeklyHtml}</div>
        `;
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><i class='bx bx-cloud-drizzle'></i> 날씨 정보를 불러올 수 없습니다.</div>`;
    }
}


/* ════════════════════════════════
   대시보드 데이터 (결재, 인보이스, 재고, 셀러K, 업무일지)
   ════════════════════════════════ */
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
        const errorHtml = `<div class="error-state"><i class='bx bx-error'></i> 데이터를 불러오지 못했습니다.</div>`;
        ['approvalWidget', 'invoiceWidget', 'lowStockWidget', 'recentSellerKWidget', 'workLogWidget'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el.querySelector('.skeleton-loader')) el.innerHTML = errorHtml;
        });
    }
}


/* ════════════════════════════════
   캘린더 이벤트
   ════════════════════════════════ */
async function loadCalendarEvents() {
    const container = document.getElementById('calendarWidget');
    try {
        const res = await authFetch(`${API_BASE}/calendar/events`);
        if (!res.ok) throw new Error('일정 불러오기 실패');
        const events = await res.json();

        if (events.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="bx bx-calendar-x"></i> 이번 달 일정이 없습니다.</div>';
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        container.innerHTML = events.map(ev => {
            let dateStr = '';
            let eventDateStr = '';
            if (ev.start.dateTime) {
                const d = new Date(ev.start.dateTime);
                eventDateStr = d.toISOString().split('T')[0];
                dateStr = new Intl.DateTimeFormat('ko-KR', {
                    month: 'numeric', day: 'numeric', weekday: 'short',
                    hour: 'numeric', minute: '2-digit'
                }).format(d);
            } else if (ev.start.date) {
                eventDateStr = ev.start.date;
                const d = new Date(ev.start.date);
                dateStr = new Intl.DateTimeFormat('ko-KR', {
                    month: 'numeric', day: 'numeric', weekday: 'short'
                }).format(d) + ' (종일)';
            }

            let extra = '';
            if (eventDateStr === todayStr) extra = 'today-event';
            else if (eventDateStr === tomorrowStr) extra = 'tomorrow-event';

            return `
                <div class="event-item ${extra}">
                    <span class="event-dot"></span>
                    <span class="event-date">${dateStr}</span>
                    <span class="event-title">${ev.summary}</span>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<div class="error-state"><i class='bx bx-error'></i> ${err.message}</div>`;
    }
}


/* ════════════════════════════════
   결재 대기함
   ════════════════════════════════ */
function renderApprovals(expenses, exhibitions) {
    const container = document.getElementById('approvalWidget');
    let html = '';

    if (expenses.length === 0 && exhibitions.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bx bx-check-circle"></i> 대기 중인 결재 문서가 없습니다.</div>';
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
        const amtText = Number(doc.amount || 0).toLocaleString(undefined, {
            minimumFractionDigits: (doc.currency === 'KRW' || !doc.currency) ? 0 : 2
        });

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
                    <span>기안: ${doc.personInCharge || '-'}</span>
                    <span>${curSym} ${amtText}</span>
                    <span>${doc.createdAt.split('T')[0]}</span>
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
                    <span>방문: ${doc.visitDate || '-'}</span>
                    <span>${doc.createdAt.split('T')[0]}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}


/* ════════════════════════════════
   인보이스
   ════════════════════════════════ */
function renderInvoices(invoices) {
    const container = document.getElementById('invoiceWidget');
    if (invoices.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bx bx-file"></i> 진행 중인 인보이스가 없습니다.</div>';
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
                <span>${inv.docDate || inv.createdAt.split('T')[0]}</span>
                <span>${inv.shipper?.name || '-'}</span>
            </div>
        </div>
    `).join('');
}


/* ════════════════════════════════
   업무일지
   ════════════════════════════════ */
function renderWorkLog(log) {
    const container = document.getElementById('workLogWidget');
    if (!log) {
        container.innerHTML = '<div class="empty-state"><i class="bx bx-notepad"></i> 최근 작성된 업무일지가 없습니다.</div>';
        return;
    }

    const stripHtml = (html) => {
        let tmp = document.createElement("DIV");
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || "";
    };

    const parseTasks = (taskData) => {
        if (!taskData) return [];
        try {
            if (taskData.trim().startsWith('[')) {
                return JSON.parse(taskData);
            }
        } catch(e) {}
        const text = stripHtml(taskData);
        return text.split('\n').filter(t => t.trim()).map(t => ({ content: t.trim() }));
    };

    const tasks = parseTasks(log.todayTasks);
    const next = parseTasks(log.nextTasks);

    const tasksHtml = tasks.length > 0
        ? tasks.map(t => `<li><i class='bx bx-check' style="color: var(--success); margin-right: 4px;"></i>${t.content}</li>`).join('')
        : '<li style="color: var(--text-tertiary);">진행한 업무가 없습니다.</li>';

    const nextHtml = next.length > 0
        ? next.map(t => `<li><i class='bx bx-right-arrow-alt' style="color: var(--accent); margin-right: 4px;"></i>${t.content}</li>`).join('')
        : '<li style="color: var(--text-tertiary);">예정된 업무가 없습니다.</li>';

    container.innerHTML = `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">작성일: ${log.date}</span>
            </div>
            <div style="font-size: 13px; margin-top: 4px;">
                <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">[금일 진행 업무]</div>
                <ul style="list-style:none; padding:0; margin: 0 0 12px 0; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                    ${tasksHtml}
                </ul>
                <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;">[명일 예정 업무]</div>
                <ul style="list-style:none; padding:0; margin: 0; color: var(--text-secondary); display: flex; flex-direction: column; gap: 4px;">
                    ${nextHtml}
                </ul>
            </div>
        </div>
    `;
}


/* ════════════════════════════════
   재고 경고
   ════════════════════════════════ */
function renderLowStock(products) {
    const container = document.getElementById('lowStockWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bx bx-check-shield"></i> 안전재고 미달 품목이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name} (${p.color}, ${p.size})</span>
                <span class="badge danger">재고: ${p.stock}</span>
            </div>
            <div class="item-meta">
                <span>${p.supplier}</span>
                <span>${p.brand}</span>
            </div>
        </div>
    `).join('');
}


/* ════════════════════════════════
   셀러K 매입 변동
   ════════════════════════════════ */
function renderRecentSellerK(products) {
    const container = document.getElementById('recentSellerKWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state"><i class="bx bx-store"></i> 최근 5일 이내 변동 내역이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name}</span>
                <span class="badge info">${p.updatedAt.split('T')[0]}</span>
            </div>
            <div class="item-meta">
                <span>${p.color} / ${p.size}</span>
            </div>
        </div>
    `).join('');
}


/* ════════════════════════════════
   상태 업데이트
   ════════════════════════════════ */
async function updateStatus(apiEndpoint, id, newStatus) {
    try {
        const res = await authFetch(`${API_BASE}/${apiEndpoint}/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('상태 변경 실패');
        if (newStatus === '결재완료' || newStatus === '결재보류' || newStatus === '완료') {
            loadDashboardData();
        }
    } catch (err) {
        alert(err.message);
        loadDashboardData();
    }
}


/* ════════════════════════════════
   유틸리티
   ════════════════════════════════ */
function formatNumber(num, decimals = 2) {
    if (num == null || isNaN(num)) return '—';
    return Number(num).toLocaleString('ko-KR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}
