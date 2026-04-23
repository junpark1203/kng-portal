import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDqdzlXTddvoBYWaVbTM7_ERO_rUGWjIgE",
    authDomain: "kng-inventory.firebaseapp.com",
    projectId: "kng-inventory",
    storageBucket: "kng-inventory.firebasestorage.app",
    messagingSenderId: "647181899026",
    appId: "1:647181899026:web:7cd3b62a7a10771b204fcb",
    measurementId: "G-5VYMDB59XD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// ==========================================
// ?†Ìã∏Î¶¨Ìã∞ ?®Ïàò
// ==========================================
var formatCurrency = function(n) {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n);
};

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type) {
    if (!type) type = 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var icons = {
        success: 'bx-check-circle',
        error: 'bx-error-circle',
        warning: 'bx-error',
        info: 'bx-info-circle'
    };
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = "<i class='bx " + (icons[type] || icons.info) + "'></i> <span>" + escapeHtml(message) + "</span>";
    container.appendChild(toast);
    setTimeout(function() {
        toast.classList.add('fade-out');
        setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
}

function updateConnectionStatus(online) {
    var statusEl = document.getElementById('firebaseStatus');
    if (!statusEl) return;
    if (online) {
        statusEl.innerHTML = "<i class='bx bx-data'></i> NAS API ?∞Í≤∞??;
        statusEl.style.color = 'var(--success)';
    } else {
        statusEl.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> ?∞Í≤∞ Ï§?..";
        statusEl.style.color = 'var(--warning)';
    }
}

// ==========================================
// API ?§Ï†ï
// ==========================================
const API_BASE = 'https://kng.junparks.com/api/seller-k/products';

// ==========================================
// ???ÅÌÉú
// ==========================================
var products = [];
var filteredProducts = [];
var editingId = null;
var currentPage = 1;
var pageSize = 50;
var sortField = null;
var sortDirection = 'asc';

// ==========================================
// ?∞Ïù¥??Î°úÎìú
// ==========================================
function loadProducts() {
    updateConnectionStatus(false);
    fetch(API_BASE)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            products = data || [];
            applyFilterAndRender();
            updateConnectionStatus(true);
        })
        .catch(function(err) {
            console.error('API Error:', err);
            showToast('?∞Ïù¥?∞Î? Î∂àÎü¨?§Îäî???§Ìå®?àÏäµ?àÎã§.', 'error');
            updateConnectionStatus(false);
            document.getElementById('skTableBody').innerHTML =
                '<tr><td colspan="15" style="text-align:center; padding:30px;">API ?úÎ≤Ñ ?∞Í≤∞ ?§Ìå®</td></tr>';
        });
}

// ==========================================
// Í≤Ä???ÑÌÑ∞Îß?// ==========================================
function applyFilterAndRender() {
    var searchField = document.getElementById('skSearchField');
    var searchInput = document.getElementById('skSearchInput');
    var field = searchField ? searchField.value : 'all';
    var keyword = searchInput ? searchInput.value.trim().toLowerCase() : '';

    if (!keyword) {
        filteredProducts = products.slice();
    } else {
        filteredProducts = products.filter(function(p) {
            if (field === 'all') {
                return (p.supplier || '').toLowerCase().indexOf(keyword) !== -1 ||
                       (p.brand || '').toLowerCase().indexOf(keyword) !== -1 ||
                       (p.name || '').toLowerCase().indexOf(keyword) !== -1 ||
                       (p.color || '').toLowerCase().indexOf(keyword) !== -1 ||
                       (p.size || '').toLowerCase().indexOf(keyword) !== -1 ||
                       (p.remarks || '').toLowerCase().indexOf(keyword) !== -1;
            }
            return (p[field] || '').toLowerCase().indexOf(keyword) !== -1;
        });
    }

    // ?ïÎ†¨ ?ÅÏö©
    if (sortField) {
        filteredProducts.sort(function(a, b) {
            var valA = getSortValue(a, sortField);
            var valB = getSortValue(b, sortField);
            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            }
            var strA = String(valA || '').toLowerCase();
            var strB = String(valB || '').toLowerCase();
            if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
            if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderTable();
}

// ?ïÎ†¨??Í∞?Í∞Ä?∏Ïò§Í∏?(Í≥ÑÏÇ∞ ?ÑÎìú ?¨Ìï®)
function getSortValue(p, field) {
    switch (field) {
        case 'buyTotal':
            return calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
        case 'sellTotal':
            return calcSellTotal(p.sellPrice, p.sellShipping);
        case 'commission':
            return calcCommission(p.sellPrice || 0, p.sellShipping || 0);
        case 'profit': {
            var bt = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var st = calcSellTotal(p.sellPrice, p.sellShipping);
            var cm = calcCommission(p.sellPrice || 0, p.sellShipping || 0);
            return calcProfit(bt, st, cm);
        }
        case 'profitRate': {
            var bt2 = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var st2 = calcSellTotal(p.sellPrice, p.sellShipping);
            var cm2 = calcCommission(p.sellPrice || 0, p.sellShipping || 0);
            var pf = calcProfit(bt2, st2, cm2);
            return calcProfitRate(pf, st2);
        }
        case 'buyPrice': return p.buyPrice || 0;
        case 'buyShipping': return p.buyShipping || 0;
        case 'sellPrice': return p.sellPrice || 0;
        case 'sellShipping': return p.sellShipping || 0;
        default:
            return p[field] || '';
    }
}

// ?ïÎ†¨ ?ÑÏù¥ÏΩ??ÖÎç∞?¥Ìä∏
function updateSortIcons() {
    document.querySelectorAll('.sortable').forEach(function(th) {
        var icon = th.querySelector('i');
        if (!icon) return;
        var field = th.getAttribute('data-sort');
        if (field === sortField) {
            icon.className = sortDirection === 'asc' ? 'bx bx-sort-up' : 'bx bx-sort-down';
            th.classList.add('sort-active');
        } else {
            icon.className = 'bx bx-sort';
            th.classList.remove('sort-active');
        }
    });
}

// ==========================================
// Í≥ÑÏÇ∞ ?®Ïàò
// ==========================================
function generateId() {
    return 'sk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    var h = String(d.getHours()).padStart(2, '0');
    var min = String(d.getMinutes()).padStart(2, '0');
    return y + '-' + m + '-' + day + ' ' + h + ':' + min;
}

function calcCommission(sellPrice, sellShipping) {
    var baseExt = sellPrice + sellShipping;
    var orderFee = Math.round(baseExt * 0.0363);
    var salesFee = Math.round(sellPrice * 0.03);
    return orderFee + salesFee;
}

function calcBuyTotal(buyPrice, buyShipping, shippingBasis, shippingQty) {
    var effectiveShipping = buyShipping || 0;
    if (shippingBasis === 'Î¨¥Î£å') {
        effectiveShipping = 0;
    }
    return (buyPrice || 0) + effectiveShipping;
}

function calcSellTotal(sellPrice, sellShipping) {
    return (sellPrice || 0) + (sellShipping || 0);
}

function calcProfit(buyTotalVATExclusive, sellTotalVATInclusive, commission) {
    var buyTotalVATInclusive = Math.round(buyTotalVATExclusive * 1.1);
    return sellTotalVATInclusive - buyTotalVATInclusive - commission;
}

function calcProfitRate(profit, sellTotal) {
    if (!sellTotal || sellTotal === 0) return 0;
    return (profit / sellTotal) * 100;
}

// ==========================================
// ?åÏù¥Î∏??åÎçîÎß?// ==========================================
function renderTable() {
    var tbody = document.getElementById('skTableBody');
    if (!tbody) return;

    // Ï¥??ÅÌíà ???ÖÎç∞?¥Ìä∏
    var countEl = document.getElementById('skTotalCount');
    if (countEl) countEl.textContent = products.length + 'Í±?;

    // ?òÏù¥ÏßÄ?§Ïù¥??Í≥ÑÏÇ∞
    var totalFiltered = filteredProducts.length;
    var effectivePageSize = (pageSize === 0) ? totalFiltered : pageSize;
    var totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(totalFiltered / effectivePageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * effectivePageSize;
    var endIdx = (pageSize === 0) ? totalFiltered : Math.min(startIdx + effectivePageSize, totalFiltered);
    var pageProducts = filteredProducts.slice(startIdx, endIdx);

    // ?åÏù¥Î∏??åÎçîÎß?    var html = '';

    if (filteredProducts.length === 0) {
        var emptyMsg = products.length === 0 ? '?±Î°ù??Îß§ÏûÖ?ÅÌíà???ÜÏäµ?àÎã§.' : 'Í≤Ä??Í≤∞Í≥ºÍ∞Ä ?ÜÏäµ?àÎã§.';
        html = '<tr><td colspan="15" style="text-align:center; padding:30px; color:var(--gray-500);">' + emptyMsg + '</td></tr>';
    } else {
        pageProducts.forEach(function(p) {
            var buyTotal = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var sellTotal = calcSellTotal(p.sellPrice, p.sellShipping);
            var commission = calcCommission(p.sellPrice || 0, p.sellShipping || 0);
            var profit = calcProfit(buyTotal, sellTotal, commission);
            var profitRate = calcProfitRate(profit, sellTotal);

            // ?†Ïßú yy/mm/dd ?¨Îß∑
            var shortDate = '';
            if (p.uploadDate) {
                var parts = p.uploadDate.split('-');
                if (parts.length === 3) shortDate = parts[0].slice(2) + '/' + parts[1] + '/' + parts[2];
                else shortDate = p.uploadDate;
            }

            // Îß§ÏûÖ?¥ÏûÑ ?¥ÌåÅ (?òÎüâÎ≥ÑÏù¥Î©?"NÍ∞úÎãπ" ?úÏãú)
            var shippingTooltip = '';
            if (p.shippingBasis === '?òÎüâÎ≥?) shippingTooltip = (p.shippingQty || 1) + 'Í∞úÎãπ';
            else if (p.shippingBasis) shippingTooltip = p.shippingBasis;

            var profitClass = profit > 0 ? 'text-success' : (profit < 0 ? 'text-danger' : '');
            var badgeClass = profitRate > 20 ? 'badge-success' : 'badge-neutral';

            var sellPriceHtml = formatCurrency(p.sellPrice || 0);
            if (p.isLowestPrice) {
                sellPriceHtml += '<br><span style="font-size:9px; background:#fff3cd; color:#856404; padding:1px 3px; border-radius:3px; font-weight:600;">ÏµúÏ?Í∞Ä</span>';
            }

            var nameHtml = '<strong>' + escapeHtml(p.name) + '</strong>';
            if (p.isSoldOut) {
                nameHtml += ' <span style="font-size:9px; background:#dc3545; color:#fff; padding:1px 3px; border-radius:3px; font-weight:600;">?àÏ†à</span>';
            }
            var trStyle = p.isSoldOut ? 'opacity:0.6; background-color:#fbfbfb; cursor:pointer;' : 'cursor:pointer;';

            html += '<tr class="product-row" data-id="' + escapeHtml(p.id) + '" style="' + trStyle + '">' +
                '<td class="col-check"><input type="checkbox" class="sk-checkbox" value="' + escapeHtml(p.id) + '"></td>' +
                '<td class="col-date">' + shortDate + '</td>' +
                '<td class="col-supplier">' + escapeHtml(p.supplier) + '</td>' +
                '<td class="col-brand">' + escapeHtml(p.brand) + '</td>' +
                '<td class="col-name">' + nameHtml + '</td>' +
                '<td class="col-color">' + escapeHtml(p.color) + '</td>' +
                '<td class="col-num buy-col">' + formatCurrency(p.buyPrice) + '</td>' +
                '<td class="col-num buy-col"' + (shippingTooltip ? ' title="' + escapeHtml(shippingTooltip) + '"' : '') + '>' + formatCurrency(p.buyShipping || 0) + '</td>' +
                '<td class="col-num buy-col" style="font-weight:600;">' + formatCurrency(buyTotal) + '</td>' +
                '<td class="col-num sell-col">' + sellPriceHtml + '</td>' +
                '<td class="col-num sell-col">' + formatCurrency(p.sellShipping || 0) + '</td>' +
                '<td class="col-num sell-col" style="font-weight:600;">' + formatCurrency(sellTotal) + '</td>' +
                '<td class="col-num profit-col" style="color:var(--danger)">' + formatCurrency(commission) + '</td>' +
                '<td class="col-num profit-col ' + profitClass + '" style="font-weight:bold;">' + formatCurrency(profit) + '</td>' +
                '<td class="col-num profit-col"><span class="badge ' + badgeClass + '">' + profitRate.toFixed(1) + '%</span></td>' +
                '</tr>';
        });
    }

    tbody.innerHTML = html;

    // ???¥Î¶≠ ???òÏ†ï Î™®Îã¨ ?ÑÏö∞Í∏?    document.querySelectorAll('.product-row').forEach(function(tr) {
        tr.addEventListener('click', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('col-check') || e.target.closest('.col-check')) return;
            openModal(this.getAttribute('data-id'));
        });
    });

    // ?òÏù¥ÏßÄ?§Ïù¥???åÎçîÎß?    renderPagination(totalFiltered, totalPages, startIdx, endIdx);
}

// ==========================================
// ?òÏù¥ÏßÄ?§Ïù¥???åÎçîÎß?// ==========================================
function renderPagination(totalFiltered, totalPages, startIdx, endIdx) {
    var container = document.getElementById('skPagination');
    if (!container) return;

    if (totalFiltered === 0) {
        container.innerHTML = '';
        return;
    }

    var html = '<div class="pagination-bar">';

    html += '<div class="pagination-info">';
    html += '<div class="page-size-wrap">';
    html += '<label for="pageSizeSelect">?òÏù¥ÏßÄ??/label>';
    html += '<select id="pageSizeSelect" class="page-size-select">';
    var sizes = [
        { value: 50, label: '50Í∞? },
        { value: 100, label: '100Í∞? },
        { value: 150, label: '150Í∞? },
        { value: 200, label: '200Í∞? },
        { value: 0, label: '?ÑÏ≤¥' }
    ];
    sizes.forEach(function(s) {
        var selected = (s.value === pageSize) ? ' selected' : '';
        html += '<option value="' + s.value + '"' + selected + '>' + s.label + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<span class="pagination-summary">Ï¥?<strong>' + totalFiltered + '</strong>Í±?;
    if (totalFiltered !== products.length) {
        html += ' <span class="filtered-note">(Í≤Ä?âÍ≤∞Í≥? ?ÑÏ≤¥ ' + products.length + 'Í±?</span>';
    }
    if (pageSize !== 0 && totalFiltered > 0) {
        html += '  |  <strong>' + (startIdx + 1) + '</strong> ??<strong>' + endIdx + '</strong>Î≤àÏß∏';
    }
    html += '</span>';
    html += '</div>';

    if (totalPages > 1) {
        html += '<div class="pagination-controls">';
        html += '<button class="page-btn" data-page="1"' + (currentPage === 1 ? ' disabled' : '') + ' title="Ï≤òÏùå"><i class="bx bx-chevrons-left"></i></button>';
        html += '<button class="page-btn" data-page="' + (currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + ' title="?¥Ï†Ñ"><i class="bx bx-chevron-left"></i></button>';

        var pages = getPageNumbers(currentPage, totalPages);
        pages.forEach(function(pg) {
            if (pg === '...') {
                html += '<span class="page-ellipsis">??/span>';
            } else {
                var activeClass = (pg === currentPage) ? ' active' : '';
                html += '<button class="page-btn page-num' + activeClass + '" data-page="' + pg + '">' + pg + '</button>';
            }
        });

        html += '<button class="page-btn" data-page="' + (currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + ' title="?§Ïùå"><i class="bx bx-chevron-right"></i></button>';
        html += '<button class="page-btn" data-page="' + totalPages + '"' + (currentPage === totalPages ? ' disabled' : '') + ' title="??><i class="bx bx-chevrons-right"></i></button>';
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    var sizeSelect = document.getElementById('pageSizeSelect');
    if (sizeSelect) {
        sizeSelect.addEventListener('change', function() {
            pageSize = parseInt(this.value, 10);
            currentPage = 1;
            renderTable();
        });
    }

    container.querySelectorAll('.page-btn[data-page]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (this.disabled) return;
            var pg = parseInt(this.getAttribute('data-page'), 10);
            if (pg >= 1 && pg <= totalPages) {
                currentPage = pg;
                renderTable();
                var tableEl = document.getElementById('skTable');
                if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

function getPageNumbers(current, total) {
    if (total <= 7) {
        var arr = [];
        for (var i = 1; i <= total; i++) arr.push(i);
        return arr;
    }
    var pages = [];
    pages.push(1);
    if (current > 4) pages.push('...');
    var start = Math.max(2, current - 2);
    var end = Math.min(total - 1, current + 2);
    for (var j = start; j <= end; j++) pages.push(j);
    if (current < total - 3) pages.push('...');
    pages.push(total);
    return pages;
}

// ==========================================
// Î™®Îã¨ (Ï∂îÍ?/?òÏ†ï)
// ==========================================
function openModal(id) {
    var modal = document.getElementById('skModal');
    if (!modal) return;

    editingId = id;
    document.getElementById('skModalTitle').textContent = id ? 'Îß§ÏûÖ?ÅÌíà ?òÏ†ï' : '?†Í∑ú Îß§ÏûÖ?ÅÌíà Ï∂îÍ?';
    document.getElementById('skForm').reset();
    document.getElementById('skUploadDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('skShippingQty').value = "1";
    toggleShippingQty();
    updateCalcPreview();

    if (id) {
        var p = products.find(function(i) { return i.id === id; });
        if (p) {
            document.getElementById('skSupplier').value = p.supplier || '';
            document.getElementById('skBrand').value = p.brand || '';
            document.getElementById('skName').value = p.name || '';
            document.getElementById('skColor').value = p.color || '';
            document.getElementById('skSize').value = p.size || '';
            document.getElementById('skUploadDate').value = p.uploadDate || '';
            document.getElementById('skBuyPrice').value = p.buyPrice || '';
            document.getElementById('skBuyShipping').value = p.buyShipping || '';
            document.getElementById('skShippingBasis').value = p.shippingBasis || '?òÎüâÎ≥?;
            document.getElementById('skShippingQty').value = p.shippingQty || '1';
            document.getElementById('skSellPrice').value = p.sellPrice || '';
            document.getElementById('skSellShipping').value = p.sellShipping || '';
            document.getElementById('skIsLowestPrice').checked = (p.isLowestPrice === 1);
            if (document.getElementById('skIsSoldOut')) document.getElementById('skIsSoldOut').checked = (p.isSoldOut === 1);
            if (document.getElementById('skRemarks')) document.getElementById('skRemarks').value = p.remarks || '';
            if (document.getElementById('skTimestampDisplay')) {
                document.getElementById('skTimestampDisplay').innerHTML = 'ÏµúÏ¥à?±Î°ù: ' + formatDateTime(p.createdAt) + ' &nbsp;|&nbsp; ÏµúÏ¢Ö?òÏ†ï: ' + formatDateTime(p.updatedAt);
            }
            if (document.getElementById('skLogsContainer')) {
                document.getElementById('skLogsContainer').style.display = 'none';
                document.getElementById('skLogsList').innerHTML = '';
                fetch(API_BASE + '/' + id + '/logs')
                    .then(function(res) { return res.json(); })
                    .then(function(logs) {
                        if (logs && logs.length > 0) {
                            var logHtml = '';
                            logs.forEach(function(l) {
                                logHtml += '<li style="margin-bottom:6px; line-height:1.4;"><strong>' + formatDateTime(l.createdAt) + '</strong> (' + escapeHtml(l.summary) + ')<br><span style="color:#888;">' + escapeHtml(l.logText) + '</span></li>';
                            });
                            document.getElementById('skLogsList').innerHTML = logHtml;
                            document.getElementById('skLogsContainer').style.display = 'block';
                        }
                    })
                    .catch(function(err) { console.error('?¥Î†• Î°úÎî© ?§Ìå®:', err); });
            }
            toggleShippingQty();
            updateCalcPreview();
        }
    } else {
        if (document.getElementById('skTimestampDisplay')) document.getElementById('skTimestampDisplay').innerHTML = '';
        if (document.getElementById('skLogsContainer')) document.getElementById('skLogsContainer').style.display = 'none';
    }

    modal.classList.add('active');
}

function closeModal() {
    var modal = document.getElementById('skModal');
    if (modal) modal.classList.remove('active');
    editingId = null;
}

function toggleShippingQty() {
    var b = document.getElementById('skShippingBasis').value;
    var wrap = document.getElementById('shippingQtyWrap');
    if (!wrap) return;
    if (b === '?òÎüâÎ≥?) {
        wrap.classList.remove('hidden');
    } else {
        wrap.classList.add('hidden');
    }
}

function updateCalcPreview() {
    var bp = parseInt(document.getElementById('skBuyPrice').value, 10) || 0;
    var bs = parseInt(document.getElementById('skBuyShipping').value, 10) || 0;
    var base = document.getElementById('skShippingBasis').value;
    var qty = parseInt(document.getElementById('skShippingQty').value, 10) || 1;
    var sp = parseInt(document.getElementById('skSellPrice').value, 10) || 0;
    var ss = parseInt(document.getElementById('skSellShipping').value, 10) || 0;

    var buyTotal = calcBuyTotal(bp, bs, base, qty);
    var sellTotal = calcSellTotal(sp, ss);
    var commission = calcCommission(sp, ss);
    var profit = calcProfit(buyTotal, sellTotal, commission);
    var profitRate = calcProfitRate(profit, sellTotal);

    var buyTotalEl = document.getElementById('skBuyTotal');
    if (buyTotalEl) buyTotalEl.value = formatCurrency(buyTotal);

    var sellTotalEl = document.getElementById('skSellTotal');
    if (sellTotalEl) sellTotalEl.value = formatCurrency(sellTotal);

    var commEl = document.getElementById('skPreviewCommission');
    if (commEl) commEl.value = formatCurrency(commission);

    var profitEl = document.getElementById('skPreviewProfit');
    if (profitEl) {
        profitEl.value = formatCurrency(profit);
        profitEl.className = 'calc-preview ' + (profit > 0 ? 'text-success' : (profit < 0 ? 'text-danger' : ''));
    }

    var rateEl = document.getElementById('skPreviewRate');
    if (rateEl) rateEl.value = profitRate.toFixed(1) + '%';
}

// ==========================================
// ?∏Ï¶ù (Firebase Auth)
// ==========================================
function setupAuth() {
    // ?¨ÌÑ∏ ?ÑÏö©: ?∏Ï¶ù?Ä ?¨ÌÑ∏(index.html)?êÏÑú Ï≤òÎ¶¨?òÎ?Î°?Î∞îÎ°ú ?∞Ïù¥??Î°úÎìú
    loadProducts();
}

// ==========================================
// ???úÏûë
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    setupAuth();

    // ?ÅÌíà Ï∂îÍ? Î≤ÑÌäº
    document.getElementById('addProductBtn').addEventListener('click', function() {
        openModal(null);
    });

    // Î™®Îã¨ ?´Í∏∞
    document.getElementById('closeSkModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelSkBtn').addEventListener('click', closeModal);

    // ?¥ÏûÑÍ∏∞Ï? Î≥ÄÍ≤?    document.getElementById('skShippingBasis').addEventListener('change', function() {
        toggleShippingQty();
        updateCalcPreview();
    });

    // ?§ÏãúÍ∞?Í≥ÑÏÇ∞ ÎØ∏Î¶¨Î≥¥Í∏∞
    ['skBuyPrice', 'skBuyShipping', 'skShippingQty', 'skSellPrice', 'skSellShipping'].forEach(function(id) {
        document.getElementById(id).addEventListener('input', updateCalcPreview);
    });

    // ???úÏ∂ú (Ï∂îÍ?/?òÏ†ï)
    document.getElementById('skForm').addEventListener('submit', function(e) {
        e.preventDefault();

        var data = {
            supplier: document.getElementById('skSupplier').value.trim(),
            brand: document.getElementById('skBrand').value.trim(),
            name: document.getElementById('skName').value.trim(),
            color: document.getElementById('skColor').value.trim(),
            size: document.getElementById('skSize').value.trim(),
            uploadDate: document.getElementById('skUploadDate').value,
            buyPrice: parseInt(document.getElementById('skBuyPrice').value, 10) || 0,
            buyShipping: parseInt(document.getElementById('skBuyShipping').value, 10) || 0,
            shippingBasis: document.getElementById('skShippingBasis').value,
            shippingQty: parseInt(document.getElementById('skShippingQty').value, 10) || 1,
            sellPrice: parseInt(document.getElementById('skSellPrice').value, 10) || 0,
            sellShipping: parseInt(document.getElementById('skSellShipping').value, 10) || 0,
            isLowestPrice: document.getElementById('skIsLowestPrice').checked ? 1 : 0,
            isSoldOut: (document.getElementById('skIsSoldOut') && document.getElementById('skIsSoldOut').checked) ? 1 : 0,
            remarks: document.getElementById('skRemarks') ? document.getElementById('skRemarks').value.trim() : ''
        };

        if (editingId) {
            data.id = editingId;
            fetch(API_BASE + '/' + editingId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            .then(function(res) { return res.json(); })
            .then(function() {
                showToast('?ÅÌíà ?ïÎ≥¥Í∞Ä ?òÏ†ï?òÏóà?µÎãà??', 'success');
                closeModal();
                loadProducts();
            })
            .catch(function(err) {
                showToast('?òÏ†ï ?§Ìå®: ' + err.message, 'error');
            });
        } else {
            data.id = generateId();
            fetch(API_BASE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            })
            .then(function(res) { return res.json(); })
            .then(function() {
                showToast('???ÅÌíà???±Î°ù?òÏóà?µÎãà??', 'success');
                closeModal();
                loadProducts();
            })
            .catch(function(err) {
                showToast('?±Î°ù ?§Ìå®: ' + err.message, 'error');
            });
        }
    });

    // ?ºÍ¥Ñ ??†ú
    document.getElementById('deleteSkBtn').addEventListener('click', function() {
        var checked = document.querySelectorAll('.sk-checkbox:checked');
        if (checked.length === 0) {
            showToast('??†ú???ÅÌíà???†ÌÉù?¥Ï£º?∏Ïöî.', 'warning');
            return;
        }
        if (!confirm('?†ÌÉù??' + checked.length + 'Í∞??ÅÌíà????†ú?òÏãúÍ≤†Ïäµ?àÍπå?')) return;

        var idsToDelete = [];
        checked.forEach(function(cb) { idsToDelete.push(cb.value); });

        fetch(API_BASE + '/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: idsToDelete })
        })
        .then(function(res) { return res.json(); })
        .then(function() {
            document.getElementById('selectAllSk').checked = false;
            showToast('??†ú?àÏäµ?àÎã§.', 'success');
            loadProducts();
        })
        .catch(function(err) {
            showToast('??†ú ?§Ìå®: ' + err.message, 'error');
        });
    });

    // ?ÑÏ≤¥ ?†ÌÉù (?ÑÏû¨ ?òÏù¥ÏßÄÎß?
    document.getElementById('selectAllSk').addEventListener('change', function() {
        var checked = this.checked;
        document.querySelectorAll('.sk-checkbox').forEach(function(cb) {
            cb.checked = checked;
        });
    });

    // ?ïÎ†¨ ?§Îçî ?¥Î¶≠ ?¥Î≤§??    document.querySelectorAll('.sortable').forEach(function(th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function() {
            var field = this.getAttribute('data-sort');
            if (!field) return;
            if (sortField === field) {
                sortDirection = (sortDirection === 'asc') ? 'desc' : 'asc';
            } else {
                sortField = field;
                sortDirection = 'asc';
            }
            currentPage = 1;
            applyFilterAndRender();
            updateSortIcons();
        });
    });

    // Í≤Ä???ÑÌÑ∞Îß??¥Î≤§??    var searchInputEl = document.getElementById('skSearchInput');
    var searchFieldEl = document.getElementById('skSearchField');
    var searchTimer = null;
    if (searchInputEl) {
        searchInputEl.addEventListener('input', function() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() {
                currentPage = 1;
                applyFilterAndRender();
            }, 300);
        });
    }
    if (searchFieldEl) {
        searchFieldEl.addEventListener('change', function() {
            currentPage = 1;
            applyFilterAndRender();
        });
    }

    // ?Ä?¨K ?ÑÏΩî?îÏñ∏ ?†Í?
    var t = document.getElementById('sellerKToggle');
    var g = document.getElementById('sellerKMenuGroup');
    if (t && g) {
        t.addEventListener('click', function(e) {
            e.preventDefault();
            g.classList.toggle('open');
        });
    }

    // Î™®Î∞î???ÑÎ≤ÑÍ±?Î©îÎâ¥
    var h = document.getElementById('hamburgerBtn');
    var s = document.getElementById('sidebar');
    var o = document.getElementById('sidebarOverlay');
    if (h && s) {
        h.addEventListener('click', function() {
            s.classList.toggle('open');
            if (o) o.classList.toggle('active');
        });
    }
    if (o) {
        o.addEventListener('click', function() {
            s.classList.remove('open');
            o.classList.remove('active');
        });
    }

    // ?ëÏ? ?ëÏãù ?§Ïö¥Î°úÎìú
    document.getElementById('downloadTemplateBtn').addEventListener('click', function() {
        if (typeof XLSX === 'undefined') {
            showToast('?ëÏ? ?ºÏù¥Î∏åÎü¨Î¶¨Í? Î°úÎìú?òÏ? ?äÏïò?µÎãà?? ?àÎ°úÍ≥†Ïπ® ?¥Ï£º?∏Ïöî.', 'error');
            return;
        }
        var wb = XLSX.utils.book_new();
        var wsData = [
            ["Îß§ÏûÖÏ≤?, "Î∏åÎûú??, "?ÅÌíàÎ™?, "Ïª¨Îü¨", "?¨Ïù¥Ï¶?, "?ÖÎ°ú?úÏùº(YYYY-MM-DD)", "Îß§ÏûÖÍ∞Ä(?®Í?)", "Îß§ÏûÖ?¥ÏûÑ", "?¥ÏûÑÍ∏∞Ï?(?òÎüâÎ≥?Î¨¥Î£å/Ï°∞Í±¥Î∂Ä/?†Î£å)", "?òÎüâÎ≥ÑÍ∏∞Ï§Ä(Í≥µÎ???)", "?êÎß§Í∞Ä", "?êÎß§?¥ÏûÑ", "ÏµúÏ?Í∞Ä?§Ï†ï(O/X)", "ÎπÑÍ≥†"],
            ["?àÏãú)?ôÎ?Î¨∏K", "KÎ∏åÎûú??, "Î∞òÌåî??, "Î∏îÎûô", "Free", "", 15000, 3000, "?òÎüâÎ≥?, 1, 25000, 3000, "X", "ÎßàÍ∞ê Ï¢ãÏùå"]
        ];
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{wpx:80},{wpx:100},{wpx:150},{wpx:60},{wpx:60},{wpx:130},{wpx:80},{wpx:80},{wpx:180},{wpx:120},{wpx:80},{wpx:80},{wpx:100},{wpx:150}];
        XLSX.utils.book_append_sheet(wb, ws, "?ÅÌíà?ëÏãù");
        XLSX.writeFile(wb, "Îß§ÏûÖ?ÅÌíà_?ºÍ¥Ñ?±Î°ù_?ëÏãù.xlsx");
    });

    // ?ëÏ? ?ÖÎ°ú??    document.getElementById('bulkUploadBtn').addEventListener('click', function() {
        document.getElementById('bulkUploadFile').click();
    });

    document.getElementById('bulkUploadFile').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (typeof XLSX === 'undefined') {
            showToast('?ëÏ? ?ºÏù¥Î∏åÎü¨Î¶¨Í? Î°úÎìú?òÏ? ?äÏïò?µÎãà??', 'error');
            e.target.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function(evt) {
            try {
                var data = new Uint8Array(evt.target.result);
                var workbook = XLSX.read(data, {type: 'array'});
                var firstSheetName = workbook.SheetNames[0];
                var worksheet = workbook.Sheets[firstSheetName];
                var rows = XLSX.utils.sheet_to_json(worksheet, {header: 1});
                var uploadProducts = [];
                for (var i = 1; i < rows.length; i++) {
                    var row = rows[i];
                    if (!row || row.length === 0 || !row[0] || String(row[0]).trim() === "?àÏãú)?ôÎ?Î¨∏K") continue;
                    var p = {
                        id: generateId() + '_' + i,
                        supplier: String(row[0] || '').trim(),
                        brand: String(row[1] || '').trim(),
                        name: String(row[2] || '').trim(),
                        color: String(row[3] || '').trim(),
                        size: String(row[4] || '').trim(),
                        uploadDate: (row[5] ? String(row[5]).trim() : ""),
                        buyPrice: parseInt(row[6], 10) || 0,
                        buyShipping: parseInt(row[7], 10) || 0,
                        shippingBasis: String(row[8] || 'Î¨¥Î£å').trim(),
                        shippingQty: parseInt(row[9], 10) || 1,
                        sellPrice: parseInt(row[10], 10) || 0,
                        sellShipping: parseInt(row[11], 10) || 0,
                        isLowestPrice: (String(row[12] || 'X').trim().toUpperCase() === 'O') ? 1 : 0,
                        remarks: String(row[13] || '').trim()
                    };
                    if (p.name !== '') uploadProducts.push(p);
                }
                if (uploadProducts.length === 0) {
                    showToast('?ÖÎ°ú?úÌï† ?†Ìö®???ÅÌíà ?∞Ïù¥?∞Í? ?ÜÏäµ?àÎã§.', 'warning');
                    e.target.value = '';
                    return;
                }
                if (!confirm(uploadProducts.length + 'Í∞úÏùò ?ÅÌíà???ëÏ?Î°??ºÍ¥Ñ ?±Î°ù?òÏãúÍ≤†Ïäµ?àÍπå?')) {
                    e.target.value = '';
                    return;
                }
                fetch(API_BASE + '/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ products: uploadProducts })
                })
                .then(function(res) { return res.json(); })
                .then(function(result) {
                    if (result.error) throw new Error(result.error);
                    showToast(result.count + 'Í∞??ÅÌíà???±Í≥µ?ÅÏúºÎ°??ºÍ¥Ñ ?±Î°ù?òÏóà?µÎãà??', 'success');
                    e.target.value = '';
                    loadProducts();
                })
                .catch(function(err) {
                    console.error("Bulk Upload Error:", err);
                    showToast('?Ä???±Î°ù ?§Ìå®: ' + err.message, 'error');
                    e.target.value = '';
                });
            } catch (err) {
                console.error("Excel parsing error:", err);
                showToast('?ëÏ? ?åÏùº Î∂ÑÌï¥ Ï§??§Î•òÍ∞Ä Î∞úÏÉù?àÏäµ?àÎã§.', 'error');
                e.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // ?ëÏ? ?¥Î≥¥?¥Í∏∞
    document.getElementById('exportSkBtn').addEventListener('click', function() {
        if (typeof XLSX === 'undefined') {
            showToast('?ëÏ? ?ºÏù¥Î∏åÎü¨Î¶¨Í? Î°úÎìú?òÏ? ?äÏïò?µÎãà??', 'error');
            return;
        }
        if (products.length === 0) {
            showToast('?¥Î≥¥???∞Ïù¥?∞Í? ?ÜÏäµ?àÎã§.', 'warning');
            return;
        }
        var wsData = [
            ["?ÖÎ°ú?úÏùº", "Îß§ÏûÖÏ≤?, "Î∏åÎûú??, "?ÅÌíàÎ™?, "Ïª¨Îü¨", "?¨Ïù¥Ï¶?, "Îß§ÏûÖÍ∞Ä", "Îß§ÏûÖ?¥ÏûÑ", "?¥ÏûÑÍ∏∞Ï?", "Îß§ÏûÖ?©Í≥Ñ", "?êÎß§Í∞Ä", "?êÎß§?¥ÏûÑ", "Îß§Ï∂ú?©Í≥Ñ", "?òÏàòÎ£?, "?ïÏÇ∞?¥Ïùµ", "?òÏùµÎ•?, "ÎπÑÍ≥†", "ÏµúÏ¢Ö?òÏ†ï??]
        ];
        products.forEach(function(p) {
            var buyTotal = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var sellTotal = calcSellTotal(p.sellPrice, p.sellShipping);
            var commission = calcCommission(p.sellPrice || 0, p.sellShipping || 0);
            var profit = calcProfit(buyTotal, sellTotal, commission);
            var profitRate = calcProfitRate(profit, sellTotal);
            wsData.push([
                p.uploadDate || '', p.supplier || '', p.brand || '', p.name || '',
                p.color || '', p.size || '', p.buyPrice || 0, p.buyShipping || 0,
                p.shippingBasis || '', buyTotal, p.sellPrice || 0, p.sellShipping || 0,
                sellTotal, commission, profit, profitRate.toFixed(1) + '%',
                p.remarks || '', formatDateTime(p.updatedAt)
            ]);
        });
        var wb = XLSX.utils.book_new();
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, "Îß§ÏûÖ?ÅÌíàÎ¶¨Ïä§??);
        XLSX.writeFile(wb, "Îß§ÏûÖ?ÅÌíà_Î¶¨Ïä§??" + new Date().toISOString().split('T')[0] + ".xlsx");
        showToast('?ëÏ? ?åÏùºÎ°??¥Î≥¥?àÏäµ?àÎã§.', 'success');
    });

    toggleShippingQty();
});