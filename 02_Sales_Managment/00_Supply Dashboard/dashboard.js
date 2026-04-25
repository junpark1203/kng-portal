/* =========================================================================
   공급 현황 대시보드 (dashboard.js) V2
   - 일반 자재 + 유류 자재 데이터 집계
   - 데이터 소스 필터 (전체/일반/유류)
   - 기준 토글 (금액/수량)
   - Chart.js 기반 4개 차트
   - 품목별/현장별 집계 테이블
   ========================================================================= */

const API_GENERAL = 'https://kng.junparks.com/api/supply-history';
const API_OIL     = 'https://kng.junparks.com/api/oil-supply-history';

let rawGeneral = [];
let rawOil = [];
let filtered = { general: [], oil: [] };
let activeSource = 'all'; // 'all' | 'general' | 'oil'
let activeMetric = 'amount'; // 'amount' | 'qty'
let activeAggTab = 'item'; // 'item' | 'site'
let aggSearchQuery = '';

const $ = id => document.getElementById(id);

// Chart instances
let chartTrend, chartCategory, chartSite, chartItem;

// Color palette
const COLORS = [
    '#4f6ef7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#a855f7'
];

const fmtW = n => '₩' + (n || 0).toLocaleString();
const fmtN = n => (n || 0).toLocaleString();

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    initPeriodChips();
    initDateRange();
    initSourceTabs();
    initMetricTabs();
    initAggTabs();
    initAggSearch();
    await loadAllData();
    applyFilter();
});

// ==========================================
// Period Chips
// ==========================================
function initPeriodChips() {
    document.querySelectorAll('.period-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const period = btn.dataset.period;
            const now = new Date();
            let start = '', end = '';

            if (period === 'month') {
                start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
                end = now.toISOString().split('T')[0];
            } else if (period === 'quarter') {
                const qm = Math.floor(now.getMonth() / 3) * 3;
                start = `${now.getFullYear()}-${String(qm+1).padStart(2,'0')}-01`;
                end = now.toISOString().split('T')[0];
            } else if (period === 'year') {
                start = `${now.getFullYear()}-01-01`;
                end = now.toISOString().split('T')[0];
            }

            $('filterStart').value = start;
            $('filterEnd').value = end;
            applyFilter();
        });
    });
}

function initDateRange() {
    $('filterStart').addEventListener('change', () => {
        clearPeriodChips();
        applyFilter();
    });
    $('filterEnd').addEventListener('change', () => {
        clearPeriodChips();
        applyFilter();
    });
}

function clearPeriodChips() {
    document.querySelectorAll('.period-chip').forEach(b => b.classList.remove('active'));
}

// ==========================================
// Source Tabs (전체/일반/유류)
// ==========================================
function initSourceTabs() {
    document.querySelectorAll('.source-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.source-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeSource = btn.dataset.source;
            applyFilter();
        });
    });
}

// ==========================================
// Metric Tabs (금액/수량)
// ==========================================
function initMetricTabs() {
    document.querySelectorAll('.metric-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.metric-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeMetric = btn.dataset.metric;
            applyFilter();
        });
    });
}

// ==========================================
// Aggregate Table Tabs & Search
// ==========================================
function initAggTabs() {
    document.querySelectorAll('.agg-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.agg-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeAggTab = btn.dataset.agg;
            renderAggTable();
        });
    });
}

function initAggSearch() {
    let timer;
    $('aggSearchInput').addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            aggSearchQuery = e.target.value.trim().toLowerCase();
            renderAggTable();
        }, 250);
    });
}

// ==========================================
// Data Loading
// ==========================================
async function loadAllData() {
    try {
        const [resG, resO] = await Promise.all([
            fetch(API_GENERAL), fetch(API_OIL)
        ]);
        if (resG.ok) rawGeneral = await resG.json();
        if (resO.ok) rawOil = await resO.json();
    } catch (e) {
        console.error('Data load error:', e);
    }
}

// ==========================================
// Combined filtered data helper
// ==========================================
function getCombined() {
    const list = [];
    if (activeSource === 'all' || activeSource === 'general') {
        filtered.general.forEach(d => list.push({
            date: d.supplyDate || '', site: d.site || '', item: d.item || '',
            qty: d.qty || 0, total: d.total || 0, category: d.category || '미분류',
            type: 'general'
        }));
    }
    if (activeSource === 'all' || activeSource === 'oil') {
        filtered.oil.forEach(d => list.push({
            date: d.date || '', site: d.site || '', item: d.item || '',
            qty: d.qty || 0, total: d.total || 0, category: d.category || '미분류',
            type: 'oil'
        }));
    }
    return list;
}

// ==========================================
// Filter
// ==========================================
function applyFilter() {
    const start = $('filterStart').value;
    const end = $('filterEnd').value;

    filtered.general = rawGeneral.filter(d => {
        const dt = d.supplyDate || '';
        if (start && dt < start) return false;
        if (end && dt > end) return false;
        return true;
    });
    filtered.oil = rawOil.filter(d => {
        const dt = d.date || '';
        if (start && dt < start) return false;
        if (end && dt > end) return false;
        return true;
    });

    // Period label
    if (start && end) {
        $('periodLabel').textContent = `${start} ~ ${end}`;
    } else if (start) {
        $('periodLabel').textContent = `${start} ~ 현재`;
    } else {
        $('periodLabel').textContent = '전체 기간';
    }

    updateKPI();
    renderTrendChart();
    renderCategoryChart();
    renderSiteChart();
    renderItemChart();
    renderAggTable();
}

// ==========================================
// KPI (with monthly averages)
// ==========================================
function updateKPI() {
    const combined = getCombined();
    let gAmt = 0, oAmt = 0, gCount = 0, oCount = 0;
    const sites = new Set(), items = new Set(), months = new Set();

    filtered.general.forEach(d => {
        if (activeSource === 'oil') return;
        gAmt += d.total || 0;
        gCount++;
        if (d.site) sites.add(d.site);
        if (d.item) items.add(d.item);
        const m = (d.supplyDate || '').substring(0, 7);
        if (m) months.add(m);
    });
    filtered.oil.forEach(d => {
        if (activeSource === 'general') return;
        oAmt += d.total || 0;
        oCount++;
        if (d.site) sites.add(d.site);
        if (d.item) items.add(d.item);
        const m = (d.date || '').substring(0, 7);
        if (m) months.add(m);
    });

    const total = gAmt + oAmt;
    const totalCount = gCount + oCount;
    const monthCount = months.size || 1;

    $('kpiTotalAmt').textContent = fmtW(total);
    $('kpiTotalSub').textContent = activeSource === 'all'
        ? `일반 ${fmtW(gAmt)} · 유류 ${fmtW(oAmt)}`
        : activeSource === 'general' ? '일반 자재만 표시 중' : '유류 자재만 표시 중';
    $('kpiTotalCount').textContent = fmtN(totalCount);
    $('kpiCountSub').textContent = activeSource === 'all'
        ? `일반 ${fmtN(gCount)} · 유류 ${fmtN(oCount)}`
        : `${fmtN(totalCount)}건`;
    $('kpiSiteCount').textContent = sites.size;
    $('kpiItemCount').textContent = items.size;

    // Monthly averages
    const avgAmt = Math.round(total / monthCount);
    const avgCount = Math.round(totalCount / monthCount);
    $('kpiAvgAmt').textContent = fmtW(avgAmt);
    $('kpiAvgAmtSub').textContent = `${monthCount}개월 기준`;
    $('kpiAvgCount').textContent = fmtN(avgCount);
    $('kpiAvgCountSub').textContent = `${monthCount}개월 기준`;
}

// ==========================================
// Chart: Monthly Trend
// ==========================================
function renderTrendChart() {
    const months = {};
    const combined = getCombined();
    const isQty = activeMetric === 'qty';
    const valKey = isQty ? 'qty' : 'total';

    if (activeSource === 'all') {
        filtered.general.forEach(d => {
            const m = (d.supplyDate || '').substring(0, 7);
            if (!m) return;
            if (!months[m]) months[m] = { general: 0, oil: 0 };
            months[m].general += d[valKey] || 0;
        });
        filtered.oil.forEach(d => {
            const m = (d.date || '').substring(0, 7);
            if (!m) return;
            if (!months[m]) months[m] = { general: 0, oil: 0 };
            months[m].oil += d[valKey] || 0;
        });
    } else {
        combined.forEach(d => {
            const m = d.date.substring(0, 7);
            if (!m) return;
            if (!months[m]) months[m] = { general: 0, oil: 0 };
            if (d.type === 'general') months[m].general += d[valKey];
            else months[m].oil += d[valKey];
        });
    }

    const labels = Object.keys(months).sort();
    const gData = labels.map(m => months[m].general);
    const oData = labels.map(m => months[m].oil);

    const datasets = [];
    if (activeSource !== 'oil') {
        datasets.push({
            label: '일반 자재', data: gData,
            backgroundColor: 'rgba(79, 110, 247, 0.7)', borderRadius: 4, barPercentage: 0.6
        });
    }
    if (activeSource !== 'general') {
        datasets.push({
            label: '유류 자재', data: oData,
            backgroundColor: 'rgba(16, 185, 129, 0.7)', borderRadius: 4, barPercentage: 0.6
        });
    }

    const tooltipFmt = isQty
        ? (ctx => `${ctx.dataset.label}: ${fmtN(ctx.raw)}개`)
        : (ctx => `${ctx.dataset.label}: ${fmtW(ctx.raw)}`);
    const tickFmt = isQty
        ? (v => v >= 1000 ? (v/1000).toFixed(0)+'K' : v)
        : (v => v >= 1000000 ? (v/1000000).toFixed(0)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v);

    if (chartTrend) chartTrend.destroy();
    chartTrend = new Chart($('chartTrend'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { font: { size: 11, family: 'Inter' }, usePointStyle: true, padding: 16 } },
                tooltip: { callbacks: { label: tooltipFmt } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' } } },
                y: {
                    beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: { font: { size: 10, family: 'Inter' }, callback: tickFmt }
                }
            }
        }
    });
}

// ==========================================
// Chart: Category Pie
// ==========================================
function renderCategoryChart() {
    const cats = {};
    const combined = getCombined();
    combined.forEach(d => {
        const key = d.category || '미분류';
        cats[key] = (cats[key] || 0) + d.total;
    });

    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartCategory) chartCategory.destroy();
    chartCategory = new Chart($('chartCategory'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length), borderWidth: 2, borderColor: '#fff' }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '55%',
            plugins: {
                legend: { position: 'right', labels: { font: { size: 10, family: 'Inter' }, padding: 10, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const pct = ((ctx.raw / data.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
                            return `${ctx.label}: ${fmtW(ctx.raw)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// Chart: Site Top 10
// ==========================================
function renderSiteChart() {
    const isQty = activeMetric === 'qty';
    const sites = {};
    getCombined().forEach(d => { sites[d.site || '미입력'] = (sites[d.site || '미입력'] || 0) + (isQty ? d.qty : d.total); });

    const sorted = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartSite) chartSite.destroy();
    chartSite = new Chart($('chartSite'), {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'cc'), borderRadius: 4, barPercentage: 0.65 }] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => isQty ? fmtN(ctx.raw) + '개' : fmtW(ctx.raw) } } },
            scales: {
                x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10, family: 'Inter' }, callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v } },
                y: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' } } }
            }
        }
    });
}

// ==========================================
// Chart: Item Top 10
// ==========================================
function renderItemChart() {
    const isQty = activeMetric === 'qty';
    const items = {};
    getCombined().forEach(d => { items[d.item || '미입력'] = (items[d.item || '미입력'] || 0) + (isQty ? d.qty : d.total); });

    const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartItem) chartItem.destroy();
    chartItem = new Chart($('chartItem'), {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'cc'), borderRadius: 4, barPercentage: 0.65 }] },
        options: {
            responsive: true, maintainAspectRatio: false, indexAxis: 'y',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => isQty ? fmtN(ctx.raw) + '개' : fmtW(ctx.raw) } } },
            scales: {
                x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { size: 10, family: 'Inter' }, callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v } },
                y: { grid: { display: false }, ticks: { font: { size: 10, family: 'Inter' } } }
            }
        }
    });
}

// ==========================================
// Aggregate Summary Table
// ==========================================
function renderAggTable() {
    const combined = getCombined();
    const map = {};
    const months = new Set();

    combined.forEach(d => {
        const key = activeAggTab === 'item' ? (d.item || '미입력') : (d.site || '미입력');
        const m = d.date.substring(0, 7);
        if (m) months.add(m);
        if (!map[key]) map[key] = { qty: 0, total: 0, count: 0 };
        map[key].qty += d.qty;
        map[key].total += d.total;
        map[key].count += 1;
    });

    const monthCount = months.size || 1;
    let entries = Object.entries(map).map(([name, v]) => ({
        name,
        qty: v.qty,
        total: v.total,
        count: v.count,
        avgQty: Math.round(v.qty / monthCount),
        avgAmt: Math.round(v.total / monthCount)
    }));

    // Search filter
    if (aggSearchQuery) {
        entries = entries.filter(e => e.name.toLowerCase().includes(aggSearchQuery));
    }

    // Sort by active metric
    const isQty = activeMetric === 'qty';
    entries.sort((a, b) => isQty ? b.qty - a.qty : b.total - a.total);

    const isItem = activeAggTab === 'item';
    const thead = $('aggThead');
    const tbody = $('aggTbody');

    thead.innerHTML = `<tr>
        <th class="agg-rank">#</th>
        <th class="agg-name">${isItem ? '품목명' : '현장명'}</th>
        <th class="agg-num">총 수량</th>
        <th class="agg-num">총 금액</th>
        <th class="agg-num">납품 횟수</th>
        <th class="agg-num">월평균 수량</th>
        <th class="agg-num">월평균 금액</th>
    </tr>`;

    if (entries.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--gray-400);">데이터가 없습니다.</td></tr>`;
    } else {
        const maxRows = 50;
        const display = entries.slice(0, maxRows);
        tbody.innerHTML = display.map((e, i) => `<tr>
            <td class="agg-rank">${i + 1}</td>
            <td class="agg-name">${e.name}</td>
            <td class="agg-num">${fmtN(e.qty)}</td>
            <td class="agg-num">${fmtW(e.total)}</td>
            <td class="agg-num">${fmtN(e.count)}회</td>
            <td class="agg-num">${fmtN(e.avgQty)}</td>
            <td class="agg-num">${fmtW(e.avgAmt)}</td>
        </tr>`).join('');
    }

    // Footer summary
    const totalQty = entries.reduce((s, e) => s + e.qty, 0);
    const totalAmt = entries.reduce((s, e) => s + e.total, 0);
    const totalCnt = entries.reduce((s, e) => s + e.count, 0);
    $('aggFooter').innerHTML = `
        <span>총 <strong>${fmtN(entries.length)}</strong>${isItem ? '개 품목' : '개 현장'}</span>
        <span>합계 수량: <strong>${fmtN(totalQty)}</strong></span>
        <span>합계 금액: <strong>${fmtW(totalAmt)}</strong></span>
        <span>총 납품: <strong>${fmtN(totalCnt)}회</strong></span>
    `;
}
