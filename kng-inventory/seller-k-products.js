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
// 유틸리티 함수
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
        statusEl.innerHTML = "<i class='bx bx-data'></i> NAS API 연결됨";
        statusEl.style.color = 'var(--success)';
    } else {
        statusEl.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 연결 중...";
        statusEl.style.color = 'var(--warning)';
    }
}

// ==========================================
// API 설정
// ==========================================
const API_BASE = 'https://kng.junparks.com/api/seller-k/products';

// ==========================================
// 앱 상태
// ==========================================
var products = [];
var filteredProducts = [];
var editingId = null;
var currentPage = 1;
var pageSize = 50;
var sortField = null;
var sortDirection = 'asc';

// ==========================================
// 데이터 로드
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
            showToast('데이터를 불러오는데 실패했습니다.', 'error');
            updateConnectionStatus(false);
            document.getElementById('skTableBody').innerHTML =
                '<tr><td colspan="16" style="text-align:center; padding:30px;">API 서버 연결 실패</td></tr>';
        });
}

// ==========================================
// 검색 필터링
// ==========================================
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

    // 정렬 적용
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

// 정렬용 값 가져오기 (계산 필드 포함)
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

// 정렬 아이콘 업데이트
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
// 계산 함수
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

function calcCommission(sellPrice, sellShipping, shippingBasis) {
    var effectiveShipping = sellShipping || 0;
    if (shippingBasis === '무료') {
        effectiveShipping = 0;
    }
    var baseExt = (sellPrice || 0) + effectiveShipping;
    var orderFee = Math.round(baseExt * 0.0363);
    var salesFee = Math.round((sellPrice || 0) * 0.03);
    // 수수료도 부가세 포함이므로, 정산이익 계산 기준 통일을 위해 VAT 제외
    return Math.round((orderFee + salesFee) / 1.1);
}

function calcBuyTotal(buyPrice, buyShipping, shippingBasis, shippingQty) {
    var effectiveShipping = buyShipping || 0;
    return (buyPrice || 0) + effectiveShipping;
}

function calcSellTotal(sellPrice, sellShipping, shippingBasis) {
    var effectiveShipping = sellShipping || 0;
    if (shippingBasis === '무료') {
        effectiveShipping = 0;
    }
    return (sellPrice || 0) + effectiveShipping;
}

function calcProfit(buyTotalVATExclusive, sellTotalVATInclusive, commission) {
    // 일괄등록(보수적) 방식: 순매출 - 공급가(부가세 제외 매입비) - 수수료
    var netSale = Math.round(sellTotalVATInclusive / 1.1);
    return netSale - buyTotalVATExclusive - commission;
}

function calcProfitRate(profit, sellTotalVATInclusive) {
    if (!sellTotalVATInclusive || sellTotalVATInclusive === 0) return 0;
    var netSale = Math.round(sellTotalVATInclusive / 1.1);
    if (netSale === 0) return 0;
    return (profit / netSale) * 100;
}

// ==========================================
// 테이블 렌더링
// ==========================================
function renderTable() {
    var tbody = document.getElementById('skTableBody');
    if (!tbody) return;

    // 총 상품 수 업데이트
    var countEl = document.getElementById('skTotalCount');
    if (countEl) countEl.textContent = products.length + '건';

    // 페이지네이션 계산
    var totalFiltered = filteredProducts.length;
    var effectivePageSize = (pageSize === 0) ? totalFiltered : pageSize;
    var totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(totalFiltered / effectivePageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * effectivePageSize;
    var endIdx = (pageSize === 0) ? totalFiltered : Math.min(startIdx + effectivePageSize, totalFiltered);
    var pageProducts = filteredProducts.slice(startIdx, endIdx);

    // 테이블 렌더링
    var html = '';

    if (filteredProducts.length === 0) {
        var emptyMsg = products.length === 0 ? '등록된 매입상품이 없습니다.' : '검색 결과가 없습니다.';
        html = '<tr><td colspan="16" style="text-align:center; padding:30px; color:var(--gray-500);">' + emptyMsg + '</td></tr>';
    } else {
        pageProducts.forEach(function(p) {
            var buyTotal = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var sellTotal = calcSellTotal(p.sellPrice, p.sellShipping, p.shippingBasis);
            var commission = calcCommission(p.sellPrice || 0, p.sellShipping || 0, p.shippingBasis);
            var profit = calcProfit(buyTotal, sellTotal, commission);
            var profitRate = calcProfitRate(profit, sellTotal);

            // 날짜 yy/mm/dd 포맷
            var shortDate = '';
            if (p.uploadDate) {
                var parts = p.uploadDate.split('-');
                if (parts.length === 3) shortDate = parts[0].slice(2) + '/' + parts[1] + '/' + parts[2];
                else shortDate = p.uploadDate;
            }

            // 매입운임 툴팁 (수량별이면 "N개당" 표시)
            var shippingTooltip = '';
            if (p.shippingBasis === '수량별') shippingTooltip = (p.shippingQty || 1) + '개당';
            else if (p.shippingBasis) shippingTooltip = p.shippingBasis;

            var profitClass = profit > 0 ? 'text-success' : (profit < 0 ? 'text-danger' : '');
            var badgeClass = profitRate > 20 ? 'badge-success' : 'badge-neutral';

            var sellPriceHtml = formatCurrency(p.sellPrice || 0);
            if (p.isLowestPrice) {
                sellPriceHtml += '<br><span style="font-size:9px; background:#fff3cd; color:#856404; padding:1px 3px; border-radius:3px; font-weight:600;">최저가</span>';
            }

            var nameHtml = '<strong>' + escapeHtml(p.name) + '</strong>';
            if (p.isSoldOut) {
                nameHtml += ' <span style="font-size:9px; background:#dc3545; color:#fff; padding:1px 3px; border-radius:3px; font-weight:600;">품절</span>';
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
                '<td class="col-num buy-col">' + formatCurrency(p.buyShipping || 0) + '</td>' +
                '<td class="col-num buy-col" style="font-weight:600;">' + formatCurrency(buyTotal) + '</td>' +
                '<td class="col-num sell-col">' + sellPriceHtml + '</td>' +
                '<td class="col-num sell-col">' + formatCurrency(p.sellShipping || 0) + '</td>' +
                '<td class="sell-col col-basis"' + (p.shippingBasis === '수량별' ? ' title="' + (p.shippingQty || 1) + '개당"' : '') + '><span class="shipping-basis-tag">' + escapeHtml(p.shippingBasis || '-') + '</span></td>' +
                '<td class="col-num sell-col" style="font-weight:600;">' + formatCurrency(sellTotal) + '</td>' +
                '<td class="col-num profit-col" style="color:var(--danger)">' + formatCurrency(commission) + '</td>' +
                '<td class="col-num profit-col ' + profitClass + '" style="font-weight:bold;">' + formatCurrency(profit) + '</td>' +
                '<td class="col-num profit-col"><span class="badge ' + badgeClass + '">' + profitRate.toFixed(1) + '%</span></td>' +
                '</tr>';
        });
    }

    tbody.innerHTML = html;

    // 행 클릭 시 수정 모달 띄우기
    document.querySelectorAll('.product-row').forEach(function(tr) {
        tr.addEventListener('click', function(e) {
            if (e.target.tagName === 'INPUT' || e.target.classList.contains('col-check') || e.target.closest('.col-check')) return;
            openModal(this.getAttribute('data-id'));
        });
    });

    // 페이지네이션 렌더링
    renderPagination(totalFiltered, totalPages, startIdx, endIdx);
}

// ==========================================
// 페이지네이션 렌더링
// ==========================================
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
    html += '<label for="pageSizeSelect">페이지당</label>';
    html += '<select id="pageSizeSelect" class="page-size-select">';
    var sizes = [
        { value: 50, label: '50개' },
        { value: 100, label: '100개' },
        { value: 150, label: '150개' },
        { value: 200, label: '200개' },
        { value: 0, label: '전체' }
    ];
    sizes.forEach(function(s) {
        var selected = (s.value === pageSize) ? ' selected' : '';
        html += '<option value="' + s.value + '"' + selected + '>' + s.label + '</option>';
    });
    html += '</select>';
    html += '</div>';
    html += '<span class="pagination-summary">총 <strong>' + totalFiltered + '</strong>건';
    if (totalFiltered !== products.length) {
        html += ' <span class="filtered-note">(검색결과, 전체 ' + products.length + '건)</span>';
    }
    if (pageSize !== 0 && totalFiltered > 0) {
        html += '  |  <strong>' + (startIdx + 1) + '</strong> – <strong>' + endIdx + '</strong>번째';
    }
    html += '</span>';
    html += '</div>';

    if (totalPages > 1) {
        html += '<div class="pagination-controls">';
        html += '<button class="page-btn" data-page="1"' + (currentPage === 1 ? ' disabled' : '') + ' title="처음"><i class="bx bx-chevrons-left"></i></button>';
        html += '<button class="page-btn" data-page="' + (currentPage - 1) + '"' + (currentPage === 1 ? ' disabled' : '') + ' title="이전"><i class="bx bx-chevron-left"></i></button>';

        var pages = getPageNumbers(currentPage, totalPages);
        pages.forEach(function(pg) {
            if (pg === '...') {
                html += '<span class="page-ellipsis">…</span>';
            } else {
                var activeClass = (pg === currentPage) ? ' active' : '';
                html += '<button class="page-btn page-num' + activeClass + '" data-page="' + pg + '">' + pg + '</button>';
            }
        });

        html += '<button class="page-btn" data-page="' + (currentPage + 1) + '"' + (currentPage === totalPages ? ' disabled' : '') + ' title="다음"><i class="bx bx-chevron-right"></i></button>';
        html += '<button class="page-btn" data-page="' + totalPages + '"' + (currentPage === totalPages ? ' disabled' : '') + ' title="끝"><i class="bx bx-chevrons-right"></i></button>';
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
// 모달 (추가/수정)
// ==========================================
function openModal(id) {
    var modal = document.getElementById('skModal');
    if (!modal) return;

    editingId = id;
    document.getElementById('skModalTitle').textContent = id ? '매입상품 수정' : '신규 매입상품 추가';
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
            document.getElementById('skShippingBasis').value = p.shippingBasis || '수량별';
            document.getElementById('skShippingQty').value = p.shippingQty || '1';
            document.getElementById('skSellPrice').value = p.sellPrice || '';
            document.getElementById('skSellShipping').value = p.sellShipping || '';
            document.getElementById('skIsLowestPrice').checked = (p.isLowestPrice === 1);
            if (document.getElementById('skIsSoldOut')) document.getElementById('skIsSoldOut').checked = (p.isSoldOut === 1);
            if (document.getElementById('skRemarks')) document.getElementById('skRemarks').value = p.remarks || '';
            if (document.getElementById('skTimestampDisplay')) {
                document.getElementById('skTimestampDisplay').innerHTML = '최초등록: ' + formatDateTime(p.createdAt) + ' &nbsp;|&nbsp; 최종수정: ' + formatDateTime(p.updatedAt);
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
                    .catch(function(err) { console.error('이력 로딩 실패:', err); });
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
    if (b === '수량별') {
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
    var sellTotal = calcSellTotal(sp, ss, base);
    var commission = calcCommission(sp, ss, base);
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
// 인증 (Firebase Auth)
// ==========================================
function setupAuth() {
    // 포털 전용: 인증은 포털(index.html)에서 처리하므로 바로 데이터 로드
    loadProducts();
}

// ==========================================
// 앱 시작
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    setupAuth();

    // 상품 추가 버튼
    document.getElementById('addProductBtn').addEventListener('click', function() {
        openModal(null);
    });

    // 모달 닫기
    document.getElementById('closeSkModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelSkBtn').addEventListener('click', closeModal);

    // 운임기준 변경
    document.getElementById('skShippingBasis').addEventListener('change', function() {
        toggleShippingQty();
        updateCalcPreview();
    });

    // 실시간 계산 미리보기
    ['skBuyPrice', 'skBuyShipping', 'skShippingQty', 'skSellPrice', 'skSellShipping'].forEach(function(id) {
        document.getElementById(id).addEventListener('input', updateCalcPreview);
    });

    // 단축키 설정 (Ctrl + S = 등록/저장)
    document.addEventListener('keydown', function(e) {
        var modal = document.getElementById('skModal');
        // 모달창이 열려있을 때만 작동 ('active' 클래스 확인)
        if (modal && modal.classList.contains('active')) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault(); // 브라우저 기본 웹 페이지 저장 창 방지
                document.getElementById('saveSkBtn').click(); // 강제 등록 버튼 클릭
            }
        }
    });

    // 폼 제출 (추가/수정)
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
                showToast('상품 정보가 수정되었습니다.', 'success');
                closeModal();
                loadProducts();
            })
            .catch(function(err) {
                showToast('수정 실패: ' + err.message, 'error');
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
                showToast('새 상품이 등록되었습니다.', 'success');
                closeModal();
                loadProducts();
            })
            .catch(function(err) {
                showToast('등록 실패: ' + err.message, 'error');
            });
        }
    });

    // 일괄 삭제
    document.getElementById('deleteSkBtn').addEventListener('click', function() {
        var checked = document.querySelectorAll('.sk-checkbox:checked');
        if (checked.length === 0) {
            showToast('삭제할 상품을 선택해주세요.', 'warning');
            return;
        }
        if (!confirm('선택한 ' + checked.length + '개 상품을 삭제하시겠습니까?')) return;

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
            showToast('삭제했습니다.', 'success');
            loadProducts();
        })
        .catch(function(err) {
            showToast('삭제 실패: ' + err.message, 'error');
        });
    });

    // 전체 선택 (현재 페이지만)
    document.getElementById('selectAllSk').addEventListener('change', function() {
        var checked = this.checked;
        document.querySelectorAll('.sk-checkbox').forEach(function(cb) {
            cb.checked = checked;
        });
    });

    // 정렬 헤더 클릭 이벤트
    document.querySelectorAll('.sortable').forEach(function(th) {
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

    // 검색 필터링 이벤트
    var searchInputEl = document.getElementById('skSearchInput');
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

    // 셀러K 아코디언 토글
    var t = document.getElementById('sellerKToggle');
    var g = document.getElementById('sellerKMenuGroup');
    if (t && g) {
        t.addEventListener('click', function(e) {
            e.preventDefault();
            g.classList.toggle('open');
        });
    }

    // 모바일 햄버거 메뉴
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

    // 엑셀 양식 다운로드
    document.getElementById('downloadTemplateBtn').addEventListener('click', function() {
        if (typeof XLSX === 'undefined') {
            showToast('엑셀 라이브러리가 로드되지 않았습니다. 새로고침 해주세요.', 'error');
            return;
        }
        var wb = XLSX.utils.book_new();
        var wsData = [
            ["매입처", "브랜드", "상품명", "컬러", "사이즈", "업로드일(YYYY-MM-DD)", "매입가(단가)", "매입운임", "운임기준(수량별/무료/조건부/유료)", "수량별기준(공란시1)", "판매가", "판매운임", "최저가설정(O/X)", "비고"],
            ["예시)동대문K", "K브랜드", "반팔티", "블랙", "Free", "", 15000, 3000, "수량별", 1, 25000, 3000, "X", "마감 좋음"]
        ];
        var ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = [{wpx:80},{wpx:100},{wpx:150},{wpx:60},{wpx:60},{wpx:130},{wpx:80},{wpx:80},{wpx:180},{wpx:120},{wpx:80},{wpx:80},{wpx:100},{wpx:150}];
        XLSX.utils.book_append_sheet(wb, ws, "상품양식");
        XLSX.writeFile(wb, "매입상품_일괄등록_양식.xlsx");
    });

    // 엑셀 업로드
    document.getElementById('bulkUploadBtn').addEventListener('click', function() {
        document.getElementById('bulkUploadFile').click();
    });

    document.getElementById('bulkUploadFile').addEventListener('change', function(e) {
        var file = e.target.files[0];
        if (!file) return;
        if (typeof XLSX === 'undefined') {
            showToast('엑셀 라이브러리가 로드되지 않았습니다.', 'error');
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
                    if (!row || row.length === 0 || !row[0] || String(row[0]).trim() === "예시)동대문K") continue;
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
                        shippingBasis: String(row[8] || '무료').trim(),
                        shippingQty: parseInt(row[9], 10) || 1,
                        sellPrice: parseInt(row[10], 10) || 0,
                        sellShipping: parseInt(row[11], 10) || 0,
                        isLowestPrice: (String(row[12] || 'X').trim().toUpperCase() === 'O') ? 1 : 0,
                        remarks: String(row[13] || '').trim()
                    };
                    if (p.name !== '') uploadProducts.push(p);
                }
                if (uploadProducts.length === 0) {
                    showToast('업로드할 유효한 상품 데이터가 없습니다.', 'warning');
                    e.target.value = '';
                    return;
                }
                if (!confirm(uploadProducts.length + '개의 상품을 엑셀로 일괄 등록하시겠습니까?')) {
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
                    showToast(result.count + '개 상품이 성공적으로 일괄 등록되었습니다.', 'success');
                    e.target.value = '';
                    loadProducts();
                })
                .catch(function(err) {
                    console.error("Bulk Upload Error:", err);
                    showToast('대량 등록 실패: ' + err.message, 'error');
                    e.target.value = '';
                });
            } catch (err) {
                console.error("Excel parsing error:", err);
                showToast('엑셀 파일 분해 중 오류가 발생했습니다.', 'error');
                e.target.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // 엑셀 내보내기
    document.getElementById('exportSkBtn').addEventListener('click', function() {
        if (typeof XLSX === 'undefined') {
            showToast('엑셀 라이브러리가 로드되지 않았습니다.', 'error');
            return;
        }
        if (products.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }
        var wsData = [
            ["업로드일", "매입처", "브랜드", "상품명", "컬러", "사이즈", "매입가", "매입운임", "운임기준", "매입합계", "판매가", "판매운임", "매출합계", "수수료", "정산이익", "수익률", "비고", "최종수정일"]
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
        XLSX.utils.book_append_sheet(wb, ws, "매입상품리스트");
        XLSX.writeFile(wb, "매입상품_리스트_" + new Date().toISOString().split('T')[0] + ".xlsx");
        showToast('엑셀 파일로 내보냈습니다.', 'success');
    });

    toggleShippingQty();
});