/* =========================================================================
   공급 현황 대시보드 (dashboard.js)
   - 일반 자재 + 유류 자재 데이터 집계
   - Chart.js 기반 4개 차트
   ========================================================================= */

const API_GENERAL = 'https://kng.junparks.com/api/supply-history';
const API_OIL     = 'https://kng.junparks.com/api/oil-supply-history';

let rawGeneral = [];
let rawOil = [];
let filtered = { general: [], oil: [] };

const $ = id => document.getElementById(id);

// Chart instances
let chartTrend, chartCategory, chartSite, chartItem;

// Color palette
const COLORS = [
    '#4f6ef7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#a855f7'
];

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    initPeriodChips();
    initDateRange();
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
}

// ==========================================
// KPI
// ==========================================
function updateKPI() {
    let gAmt = 0, oAmt = 0;
    const sites = new Set(), items = new Set();

    filtered.general.forEach(d => {
        gAmt += d.total || 0;
        if (d.site) sites.add(d.site);
        if (d.item) items.add(d.item);
    });
    filtered.oil.forEach(d => {
        oAmt += d.total || 0;
        if (d.site) sites.add(d.site);
        if (d.item) items.add(d.item);
    });

    const total = gAmt + oAmt;
    $('kpiTotalAmt').textContent = '₩' + total.toLocaleString();
    $('kpiTotalSub').textContent = `일반 ₩${gAmt.toLocaleString()} · 유류 ₩${oAmt.toLocaleString()}`;
    $('kpiTotalCount').textContent = (filtered.general.length + filtered.oil.length).toLocaleString();
    $('kpiCountSub').textContent = `일반 ${filtered.general.length} · 유류 ${filtered.oil.length}`;
    $('kpiSiteCount').textContent = sites.size;
    $('kpiItemCount').textContent = items.size;
}

// ==========================================
// Chart: Monthly Trend
// ==========================================
function renderTrendChart() {
    const months = {};

    filtered.general.forEach(d => {
        const m = (d.supplyDate || '').substring(0, 7);
        if (!m) return;
        if (!months[m]) months[m] = { general: 0, oil: 0 };
        months[m].general += d.total || 0;
    });
    filtered.oil.forEach(d => {
        const m = (d.date || '').substring(0, 7);
        if (!m) return;
        if (!months[m]) months[m] = { general: 0, oil: 0 };
        months[m].oil += d.total || 0;
    });

    const labels = Object.keys(months).sort();
    const gData = labels.map(m => months[m].general);
    const oData = labels.map(m => months[m].oil);

    if (chartTrend) chartTrend.destroy();
    chartTrend = new Chart($('chartTrend'), {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '일반 자재',
                    data: gData,
                    backgroundColor: 'rgba(79, 110, 247, 0.7)',
                    borderRadius: 4,
                    barPercentage: 0.6
                },
                {
                    label: '유류 자재',
                    data: oData,
                    backgroundColor: 'rgba(16, 185, 129, 0.7)',
                    borderRadius: 4,
                    barPercentage: 0.6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { font: { size: 11, family: 'Inter' }, usePointStyle: true, padding: 16 }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ₩${ctx.raw.toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10, family: 'Inter' } }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: {
                        font: { size: 10, family: 'Inter' },
                        callback: v => v >= 1000000 ? (v/1000000).toFixed(0) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v
                    }
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
    const addCat = (cat, amt) => {
        const key = cat || '미분류';
        cats[key] = (cats[key] || 0) + amt;
    };
    filtered.general.forEach(d => addCat(d.category, d.total || 0));
    filtered.oil.forEach(d => addCat(d.category, d.total || 0));

    const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartCategory) chartCategory.destroy();
    chartCategory = new Chart($('chartCategory'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: COLORS.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: { font: { size: 10, family: 'Inter' }, padding: 10, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const pct = ((ctx.raw / data.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
                            return `${ctx.label}: ₩${ctx.raw.toLocaleString()} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ==========================================
// Chart: Site Top 10 (Horizontal Bar)
// ==========================================
function renderSiteChart() {
    const sites = {};
    filtered.general.forEach(d => { sites[d.site || '미입력'] = (sites[d.site || '미입력'] || 0) + (d.total || 0); });
    filtered.oil.forEach(d => { sites[d.site || '미입력'] = (sites[d.site || '미입력'] || 0) + (d.total || 0); });

    const sorted = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartSite) chartSite.destroy();
    chartSite = new Chart($('chartSite'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'cc'),
                borderRadius: 4,
                barPercentage: 0.65
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => `₩${ctx.raw.toLocaleString()}` }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: {
                        font: { size: 10, family: 'Inter' },
                        callback: v => v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 10, family: 'Inter' } }
                }
            }
        }
    });
}

// ==========================================
// Chart: Item Top 10 (Horizontal Bar)
// ==========================================
function renderItemChart() {
    const items = {};
    filtered.general.forEach(d => { items[d.item || '미입력'] = (items[d.item || '미입력'] || 0) + (d.total || 0); });
    filtered.oil.forEach(d => { items[d.item || '미입력'] = (items[d.item || '미입력'] || 0) + (d.total || 0); });

    const sorted = Object.entries(items).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);

    if (chartItem) chartItem.destroy();
    chartItem = new Chart($('chartItem'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: COLORS.slice(0, labels.length).map(c => c + 'cc'),
                borderRadius: 4,
                barPercentage: 0.65
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => `₩${ctx.raw.toLocaleString()}` }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: 'rgba(0,0,0,0.04)' },
                    ticks: {
                        font: { size: 10, family: 'Inter' },
                        callback: v => v >= 1000000 ? (v/1000000).toFixed(1) + 'M' : v >= 1000 ? (v/1000).toFixed(0) + 'K' : v
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 10, family: 'Inter' } }
                }
            }
        }
    });
}
