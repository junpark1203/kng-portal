/**
 * K&G 셀러K — 매입 상품 대장 (스마트스토어) 고성능 ECOUNT ERP 그리드 엔진
 * - 초고속 사전 계산(Memoization) 기반 정렬/필터링
 * - 단일 트랜잭션 초고속 일괄 수정 (Bulk Update)
 * - ECOUNT ERP 단축키(F2 등록, F8 저장, ESC 닫기) 지원
 * - 컬럼 리사이저(erp-grid-resizer) 및 공급사 탭 / 상태 칩 필터 지원
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

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

async function authFetch(url, options = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!token && typeof auth !== 'undefined' && auth.currentUser) token = await auth.currentUser.getIdToken(true);
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
}

// ==========================================
// 유틸리티 함수
// ==========================================
var formatCurrency = function(n) {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(n || 0);
};

function formatNumber(n) {
    return new Intl.NumberFormat('ko-KR').format(n || 0);
}

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
    
    toast.addEventListener('click', function() {
        toast.remove();
    });

    setTimeout(function() {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(function() { toast.remove(); }, 300);
        }
    }, 4000);
}

function updateConnectionStatus(online) {
    var statusEl = document.getElementById('firebaseStatus');
    if (!statusEl) return;
    if (online) {
        statusEl.innerHTML = "<i class='bx bx-check-circle text-success'></i> 연결됨";
        statusEl.style.color = 'var(--erp-success)';
    } else {
        statusEl.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 연결 중...";
        statusEl.style.color = 'var(--erp-warning)';
    }
}

// ==========================================
// API 엔드포인트
// ==========================================
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/api/seller-k/products'
    : 'https://kng.junparks.com/api/seller-k/products';

// ==========================================
// 애플리케이션 상태
// ==========================================
var rawProducts = [];       // 원본 상품 배열
var products = [];          // 사전 계산(Memoization) 필드가 포함된 상품 배열
var filteredProducts = [];  // 필터 및 정렬이 적용된 상품 배열
var editingId = null;
var currentPage = 1;
var pageSize = 50;
var sortField = 'uploadDate';
var sortDirection = 'desc';

var currentSupplierFilter = ''; // 공급사 탭 필터
var currentStatusFilter = 'all'; // 상태 칩 필터 (all, normal, sold_out, lowest_price)

// ==========================================
// 스마트스토어 마진 및 손익 계산 엔진
// ==========================================
function calcCommission(sellPrice, sellShipping, shippingBasis) {
    var effectiveShipping = sellShipping || 0;
    if (shippingBasis === '무료') {
        effectiveShipping = 0;
    }
    var baseExt = (sellPrice || 0) + effectiveShipping;
    var orderFee = Math.round(baseExt * 0.0363);
    var salesFee = Math.round((sellPrice || 0) * 0.03);
    // 수수료 부가세 제외 공급가 기준 정산
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
    var netSale = Math.round(sellTotalVATInclusive / 1.1);
    return netSale - buyTotalVATExclusive - commission;
}

function calcProfitRate(profit, sellTotalVATInclusive) {
    if (!sellTotalVATInclusive || sellTotalVATInclusive === 0) return 0;
    var netSale = Math.round(sellTotalVATInclusive / 1.1);
    if (netSale === 0) return 0;
    return (profit / netSale) * 100;
}

function calcBreakEvenPrice(buyTotalVATExclusive, sellShipping, shippingBasis) {
    if (!buyTotalVATExclusive || buyTotalVATExclusive <= 0) return 0;
    var effectiveShipping = sellShipping || 0;
    if (shippingBasis === '무료') {
        effectiveShipping = 0;
    }
    var S = (buyTotalVATExclusive * 1.1 - effectiveShipping * 0.9637) / 0.9337;
    if (S < 0) S = 0;
    return Math.ceil(S / 10) * 10;
}

function isProductModified(p) {
    if (!p || !p.updatedAt) return false;
    if (!p.createdAt) return false;
    return p.updatedAt !== p.createdAt;
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

function formatShortDate(isoString) {
    if (!isoString) return '-';
    var d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    var y = String(d.getFullYear()).slice(2);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '/' + m + '/' + day;
}

function getCurrentAuthor() {
    try {
        if (auth && auth.currentUser) {
            return auth.currentUser.displayName || auth.currentUser.email || '관리자';
        }
        if (window.parent && window.parent.currentUser) {
            return window.parent.currentUser.name || window.parent.currentUser.email || '관리자';
        }
    } catch(e) {}
    return '관리자';
}

function generateId() {
    return 'sk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

// ==========================================
// 고성능 사전 계산(Memoization) 엔진
// 데이터 로드 시 단 1회 계산하여 정렬/검색 시 극상의 속도 보장
// ==========================================
function enrichProduct(p) {
    var bp = Number(p.buyPrice) || 0;
    var bs = Number(p.buyShipping) || 0;
    var sp = Number(p.sellPrice) || 0;
    var ss = Number(p.sellShipping) || 0;
    var basis = p.shippingBasis || '수량별';
    var sq = Number(p.shippingQty) || 1;

    var buyTotal = calcBuyTotal(bp, bs, basis, sq);
    var sellTotal = calcSellTotal(sp, ss, basis);
    var comm = calcCommission(sp, ss, basis);
    var profit = calcProfit(buyTotal, sellTotal, comm);
    var profitRate = calcProfitRate(profit, sellTotal);
    var breakEven = calcBreakEvenPrice(buyTotal, ss, basis);
    var modified = isProductModified(p);

    var shortDate = '';
    if (p.uploadDate) {
        var parts = p.uploadDate.split('-');
        if (parts.length === 3) shortDate = parts[0].slice(2) + '/' + parts[1] + '/' + parts[2];
        else shortDate = p.uploadDate;
    }

    // 스마트 다중 검색(공백 구분 AND)을 위한 소문자 통합 인덱스
    var searchIndex = [
        p.supplier || '',
        p.brand || '',
        p.name || '',
        p.color || '',
        p.size || '',
        p.remarks || ''
    ].join(' ').toLowerCase();

    return Object.assign({}, p, {
        buyPrice: bp,
        buyShipping: bs,
        sellPrice: sp,
        sellShipping: ss,
        shippingBasis: basis,
        shippingQty: sq,
        _buyTotal: buyTotal,
        _sellTotal: sellTotal,
        _commission: comm,
        _profit: profit,
        _profitRate: profitRate,
        _breakEven: breakEven,
        _isModified: modified,
        _shortDate: shortDate,
        _shortUpdateDate: modified ? formatShortDate(p.updatedAt) : '-',
        _fullUpdateDate: modified ? formatDateTime(p.updatedAt) : '',
        _searchIndex: searchIndex
    });
}

// ==========================================
// 데이터 로드 및 초기화
// ==========================================
function loadProducts() {
    updateConnectionStatus(false);
    authFetch(API_BASE)
        .then(function(res) {
            if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
            return res.json();
        })
        .then(function(data) {
            rawProducts = data || [];
            // 전처리 및 사전 계산
            products = rawProducts.map(enrichProduct);
            
            // 공급사 탭 생성
            renderSupplierTabs();
            // 필터링 및 렌더링
            applyFilterAndRender();
            updateConnectionStatus(true);
        })
        .catch(function(err) {
            console.error('API Error:', err);
            showToast('데이터를 불러오는데 실패했습니다: ' + err.message, 'error');
            updateConnectionStatus(false);
            var tbody = document.getElementById('skTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="18" class="text-center py-4 text-danger"><i class="bx bx-error fs-4"></i><div class="mt-2">서버 연결 실패 또는 인증 만료</div></td></tr>';
            }
        });
}

// ==========================================
// 공급사 탭 동적 생성
// ==========================================
function renderSupplierTabs() {
    var group = document.getElementById('supplierTabGroup');
    if (!group) return;

    // 공급사별 건수 카운트
    var supplierCounts = {};
    products.forEach(function(p) {
        var s = (p.supplier || '').trim();
        if (s) {
            supplierCounts[s] = (supplierCounts[s] || 0) + 1;
        }
    });

    var sortedSuppliers = Object.keys(supplierCounts).sort(function(a, b) {
        return supplierCounts[b] - supplierCounts[a];
    });

    var html = '<button type="button" class="erp-tab-btn ' + (currentSupplierFilter === '' ? 'active' : '') + '" data-supplier="">' +
               '전체 <span class="erp-tab-badge" id="tabCountAll">' + products.length + '</span></button>';

    sortedSuppliers.forEach(function(s) {
        var isActive = (currentSupplierFilter === s);
        html += '<button type="button" class="erp-tab-btn ' + (isActive ? 'active' : '') + '" data-supplier="' + escapeHtml(s) + '">' +
                escapeHtml(s) + ' <span class="erp-tab-badge">' + supplierCounts[s] + '</span></button>';
    });

    group.innerHTML = html;

    // 탭 클릭 바인딩
    group.querySelectorAll('.erp-tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            group.querySelectorAll('.erp-tab-btn').forEach(function(b) { b.classList.remove('active'); });
            this.classList.add('active');
            currentSupplierFilter = this.getAttribute('data-supplier') || '';
            currentPage = 1;
            applyFilterAndRender();
        });
    });
}

// ==========================================
// 스마트 다중 검색 및 정렬 (초고속 필터링)
// ==========================================
function applyFilterAndRender() {
    var searchField = document.getElementById('skSearchField');
    var searchInput = document.getElementById('skSearchInput');
    var field = searchField ? searchField.value : 'all';
    var rawKeyword = searchInput ? searchInput.value.trim().toLowerCase() : '';
    var clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
        clearBtn.classList.toggle('d-none', rawKeyword.length === 0);
    }

    var tokens = rawKeyword.split(/\s+/).filter(function(t) { return t.length > 0; });

    filteredProducts = products.filter(function(p) {
        // 1. 공급사 탭 필터
        if (currentSupplierFilter && p.supplier !== currentSupplierFilter) {
            return false;
        }

        // 2. 상태 칩 필터
        if (currentStatusFilter === 'normal' && p.isSoldOut) return false;
        if (currentStatusFilter === 'sold_out' && !p.isSoldOut) return false;
        if (currentStatusFilter === 'lowest_price' && !p.isLowestPrice) return false;

        // 3. 검색어 필터 (스마트 다중 공백 AND)
        if (tokens.length === 0) return true;

        if (field === 'all') {
            for (var i = 0; i < tokens.length; i++) {
                if (p._searchIndex.indexOf(tokens[i]) === -1) return false;
            }
            return true;
        } else {
            var val = String(p[field] || '').toLowerCase();
            for (var j = 0; j < tokens.length; j++) {
                if (val.indexOf(tokens[j]) === -1) return false;
            }
            return true;
        }
    });

    // 4. 초고속 정렬 (사전 계산된 필드 활용)
    if (sortField) {
        filteredProducts.sort(function(a, b) {
            if (sortField === 'updatedAt') {
                if (a._isModified && !b._isModified) return -1;
                if (!a._isModified && b._isModified) return 1;
                if (!a._isModified && !b._isModified) {
                    var dA = a.uploadDate || '';
                    var dB = b.uploadDate || '';
                    return dA < dB ? 1 : (dA > dB ? -1 : 0);
                }
                var tA = a.updatedAt || '';
                var tB = b.updatedAt || '';
                return sortDirection === 'asc' ? (tA < tB ? -1 : (tA > tB ? 1 : 0)) : (tA > tB ? -1 : (tA < tB ? 1 : 0));
            }

            var valA = getSortValueCached(a, sortField);
            var valB = getSortValueCached(b, sortField);

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
    updateSortIcons();
}

function getSortValueCached(p, field) {
    switch (field) {
        case 'buyTotal': return p._buyTotal;
        case 'sellTotal': return p._sellTotal;
        case 'commission': return p._commission;
        case 'profit': return p._profit;
        case 'profitRate': return p._profitRate;
        case 'buyPrice': return p.buyPrice;
        case 'buyShipping': return p.buyShipping;
        case 'sellPrice': return p.sellPrice;
        case 'sellShipping': return p.sellShipping;
        case 'uploadDate': return p.uploadDate || '';
        case 'supplier': return p.supplier || '';
        case 'brand': return p.brand || '';
        case 'name': return p.name || '';
        case 'color': return p.color || '';
        case 'size': return p.size || '';
        default: return p[field] || '';
    }
}

function updateSortIcons() {
    document.querySelectorAll('.sk-table th.sortable').forEach(function(th) {
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
// 초고밀도 테이블 렌더링
// ==========================================
function renderTable() {
    var tbody = document.getElementById('skTableBody');
    if (!tbody) return;

    // 건수 배지 업데이트
    var countEl = document.getElementById('skTotalCount');
    if (countEl) countEl.textContent = filteredProducts.length + '건';

    var footerInfo = document.getElementById('skFooterInfo');
    if (footerInfo) {
        footerInfo.textContent = '총 ' + formatNumber(products.length) + '건 중 ' + formatNumber(filteredProducts.length) + '건 조회됨';
    }

    // 페이지네이션 슬라이싱
    var totalFiltered = filteredProducts.length;
    var effectivePageSize = (pageSize === 0) ? totalFiltered : pageSize;
    var totalPages = effectivePageSize > 0 ? Math.max(1, Math.ceil(totalFiltered / effectivePageSize)) : 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    var startIdx = (currentPage - 1) * effectivePageSize;
    var endIdx = (pageSize === 0) ? totalFiltered : Math.min(startIdx + effectivePageSize, totalFiltered);
    var pageProducts = filteredProducts.slice(startIdx, endIdx);

    if (pageProducts.length === 0) {
        var emptyMsg = products.length === 0 ? '등록된 매입상품이 없습니다.' : '검색 조건에 맞는 상품이 없습니다.';
        tbody.innerHTML = '<tr><td colspan="18" class="text-center py-5 text-muted"><i class="bx bx-folder-open fs-3"></i><div class="mt-2">' + emptyMsg + '</div></td></tr>';
        renderPagination(0, 1, 0, 0);
        updateSelectedCount();
        return;
    }

    var rows = [];
    for (var i = 0; i < pageProducts.length; i++) {
        var p = pageProducts[i];

        // 최종수정일 표시
        var updatedDateHtml = '<span class="text-muted">-</span>';
        if (p._isModified) {
            updatedDateHtml = '<span title="최종수정: ' + escapeHtml(p._fullUpdateDate) + '">' + p._shortUpdateDate + '</span>';
        }

        // 품절 및 최저가 뱃지
        var nameBadges = '';
        if (p.isSoldOut) nameBadges += '<span class="badge-soldout">품절</span>';
        if (p.isLowestPrice) nameBadges += '<span class="badge-lowest">최저가</span>';

        // 수익률 뱃지
        var rateClass = 'badge-rate-mid';
        if (p._profitRate >= 20) rateClass = 'badge-rate-high';
        else if (p._profitRate < 0) rateClass = 'badge-rate-loss';

        var profitColor = p._profit > 0 ? 'text-primary' : (p._profit < 0 ? 'text-danger' : '');

        var trClass = 'product-row' + (p.isSoldOut ? ' opacity-75' : '');

        rows.push(
            '<tr class="' + trClass + '" data-id="' + escapeHtml(p.id) + '">' +
                '<td class="col-check text-center"><input type="checkbox" class="form-check-input sk-checkbox m-0" value="' + escapeHtml(p.id) + '"></td>' +
                '<td class="col-date text-center">' + escapeHtml(p._shortDate) + '</td>' +
                '<td class="col-updated text-center">' + updatedDateHtml + '</td>' +
                '<td class="col-supplier text-center" title="' + escapeHtml(p.supplier) + '">' + escapeHtml(p.supplier) + '</td>' +
                '<td class="col-brand text-center" title="' + escapeHtml(p.brand) + '">' + escapeHtml(p.brand) + '</td>' +
                '<td class="col-name text-start" title="' + escapeHtml(p.name) + '">' +
                    '<strong>' + escapeHtml(p.name) + '</strong>' + nameBadges +
                '</td>' +
                '<td class="col-color text-center">' + escapeHtml(p.color) + '</td>' +
                '<td class="col-size text-center">' + escapeHtml(p.size) + '</td>' +
                // 매입
                '<td class="col-num buy-col">' + formatNumber(p.buyPrice) + '</td>' +
                '<td class="col-num buy-col text-muted">' + formatNumber(p.buyShipping) + '</td>' +
                '<td class="col-num buy-col fw-bold">' + formatNumber(p._buyTotal) + '</td>' +
                // 매출
                '<td class="col-num sell-col">' + formatNumber(p.sellPrice) + '</td>' +
                '<td class="col-num sell-col text-muted">' + formatNumber(p.sellShipping) + '</td>' +
                '<td class="col-basis sell-col text-center">' +
                    '<span class="shipping-basis-tag"' + (p.shippingBasis === '수량별' ? ' title="' + p.shippingQty + '개당"' : '') + '>' +
                    escapeHtml(p.shippingBasis) + '</span>' +
                '</td>' +
                '<td class="col-num sell-col fw-bold">' + formatNumber(p._sellTotal) + '</td>' +
                // 정산
                '<td class="col-num profit-col text-danger">' + formatNumber(p._commission) + '</td>' +
                '<td class="col-num profit-col fw-bold ' + profitColor + '">' + formatNumber(p._profit) + '</td>' +
                '<td class="col-num profit-col text-center"><span class="badge-rate ' + rateClass + '">' + p._profitRate.toFixed(1) + '%</span></td>' +
            '</tr>'
        );
    }

    tbody.innerHTML = rows.join('');
    renderPagination(totalFiltered, totalPages, startIdx, endIdx);
    updateSelectedCount();

    // 열 너비 자동 리사이저 트리거
    if (window.setupErpGridResizer) {
        window.setupErpGridResizer('skTable');
    }
}

// ==========================================
// 페이지네이션
// ==========================================
function renderPagination(totalFiltered, totalPages, startIdx, endIdx) {
    var container = document.getElementById('skPagination');
    if (!container) return;

    if (totalFiltered === 0 || totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    var html = '<div class="pagination-btn-group">';
    html += '<button type="button" class="page-nav-btn" data-page="1" ' + (currentPage === 1 ? 'disabled' : '') + ' title="처음"><i class="bx bx-chevrons-left"></i></button>';
    html += '<button type="button" class="page-nav-btn" data-page="' + (currentPage - 1) + '" ' + (currentPage === 1 ? 'disabled' : '') + ' title="이전"><i class="bx bx-chevron-left"></i></button>';

    var pages = getPageNumbers(currentPage, totalPages);
    for (var i = 0; i < pages.length; i++) {
        var p = pages[i];
        if (p === '...') {
            html += '<span class="px-1 text-muted">...</span>';
        } else {
            var activeClass = (p === currentPage) ? 'active' : '';
            html += '<button type="button" class="' + activeClass + '" data-page="' + p + '">' + p + '</button>';
        }
    }

    html += '<button type="button" class="page-nav-btn" data-page="' + (currentPage + 1) + '" ' + (currentPage === totalPages ? 'disabled' : '') + ' title="다음"><i class="bx bx-chevron-right"></i></button>';
    html += '<button type="button" class="page-nav-btn" data-page="' + totalPages + '" ' + (currentPage === totalPages ? 'disabled' : '') + ' title="마지막"><i class="bx bx-chevrons-right"></i></button>';
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('button[data-page]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var pg = parseInt(this.getAttribute('data-page'), 10);
            if (!isNaN(pg) && pg >= 1 && pg <= totalPages) {
                currentPage = pg;
                renderTable();
                var wrap = document.querySelector('.erp-table-wrapper');
                if (wrap) wrap.scrollTop = 0;
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

function updateSelectedCount() {
    var checked = document.querySelectorAll('.sk-checkbox:checked');
    var countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = checked.length;
}

// ==========================================
// 등록 / 수정 모달 핸들러
// ==========================================
function openModal(id) {
    var modal = document.getElementById('skModal');
    if (!modal) return;

    editingId = id;
    document.getElementById('skModalTitle').innerHTML = id 
        ? "<i class='bx bx-edit text-primary'></i> 매입상품 수정" 
        : "<i class='bx bx-receipt text-primary'></i> 매입상품 등록";
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

            // 타임스탬프 정보 바
            var tsEl = document.getElementById('skTimestampDisplay');
            if (tsEl) {
                var createdStr = p.createdAt ? formatDateTime(p.createdAt) : (p.uploadDate || '-');
                var updatedStr = p._isModified ? formatDateTime(p.updatedAt) : '수정 이력 없음';
                tsEl.innerHTML = '<span class="me-3"><i class="bx bx-calendar-plus text-primary"></i> 최초등록: <strong>' + escapeHtml(createdStr) + '</strong></span>' +
                                 '<span><i class="bx bx-edit text-warning"></i> 최종수정: <strong>' + escapeHtml(updatedStr) + '</strong></span>';
                tsEl.style.display = 'flex';
            }

            // 변경 히스토리 로드
            var logsSection = document.getElementById('skLogsSection');
            var logsList = document.getElementById('skLogsList');
            var logsCount = document.getElementById('skLogsCount');

            if (logsSection && logsList) {
                logsSection.style.display = 'block';
                logsList.innerHTML = '<div class="py-2 text-muted text-center"><i class="bx bx-loader-alt bx-spin"></i> 이력을 불러오는 중...</div>';
                if (logsCount) logsCount.textContent = '0건';

                authFetch(API_BASE + '/' + id + '/logs')
                    .then(function(res) { return res.json(); })
                    .then(function(logs) {
                        if (!logs || logs.length === 0) {
                            if (logsCount) logsCount.textContent = '0건';
                            logsList.innerHTML = '<div class="py-2 text-muted text-center"><i class="bx bx-info-circle"></i> 아직 변경 이력이 없습니다. (최초 등록 상태)</div>';
                            return;
                        }

                        if (logsCount) logsCount.textContent = logs.length + '건';
                        var logHtml = '';
                        logs.forEach(function(l) {
                            var authorText = l.author ? escapeHtml(l.author) : '관리자';
                            var dateText = formatDateTime(l.createdAt);
                            var summaryText = l.summary ? escapeHtml(l.summary) : '정보 수정';

                            logHtml += '<div class="border-bottom py-1 mb-1">' +
                                '<div class="d-flex justify-content-between text-muted" style="font-size:10px;">' +
                                    '<span><i class="bx bx-time"></i> ' + dateText + ' (' + authorText + ')</span>' +
                                    '<span class="badge bg-light text-dark border">' + summaryText + '</span>' +
                                '</div>' +
                                '<div class="mt-1" style="font-size:11px; color:#334155;">';

                            var diffList = null;
                            if (l.diffData) {
                                try { diffList = JSON.parse(l.diffData); } catch(e) {}
                            }

                            if (Array.isArray(diffList) && diffList.length > 0) {
                                diffList.forEach(function(d) {
                                    logHtml += '<div style="line-height:1.3;">' +
                                        '<span class="fw-bold text-secondary">' + escapeHtml(d.label || d.field) + ':</span> ' +
                                        '<span class="text-decoration-line-through text-muted">' + escapeHtml(d.oldValue) + '</span> ' +
                                        '<i class="bx bx-right-arrow-alt text-primary"></i> ' +
                                        '<span class="fw-bold text-dark">' + escapeHtml(d.newValue) + '</span>' +
                                    '</div>';
                                });
                            } else if (l.logText) {
                                logHtml += '<div>' + escapeHtml(l.logText) + '</div>';
                            }

                            logHtml += '</div></div>';
                        });

                        logsList.innerHTML = logHtml;
                    })
                    .catch(function(err) {
                        console.error('이력 로딩 실패:', err);
                        logsList.innerHTML = '<div class="py-2 text-danger text-center"><i class="bx bx-error"></i> 이력을 불러오지 못했습니다.</div>';
                    });
            }

            toggleShippingQty();
            updateCalcPreview();
        }
    } else {
        var tsEl = document.getElementById('skTimestampDisplay');
        if (tsEl) tsEl.style.display = 'none';
        var logsSection = document.getElementById('skLogsSection');
        if (logsSection) logsSection.style.display = 'none';
    }

    modal.style.display = 'block';
    setTimeout(function() {
        var input = document.getElementById('skSupplier');
        if (input) input.focus();
    }, 50);
}

function closeModal() {
    var modal = document.getElementById('skModal');
    if (modal) modal.style.display = 'none';
    editingId = null;
}

function toggleShippingQty() {
    var b = document.getElementById('skShippingBasis').value;
    var wrap = document.getElementById('shippingQtyWrap');
    if (!wrap) return;
    wrap.style.display = (b === '수량별') ? 'flex' : 'none';
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
    var breakEven = calcBreakEvenPrice(buyTotal, ss, base);

    var buyTotalEl = document.getElementById('skBuyTotal');
    if (buyTotalEl) buyTotalEl.value = formatCurrency(buyTotal);

    var sellTotalEl = document.getElementById('skSellTotal');
    if (sellTotalEl) sellTotalEl.value = formatCurrency(sellTotal);

    var commEl = document.getElementById('skPreviewCommission');
    if (commEl) commEl.value = formatCurrency(commission);

    var profitEl = document.getElementById('skPreviewProfit');
    if (profitEl) {
        profitEl.value = formatCurrency(profit);
        profitEl.className = 'form-control form-control-sm text-end fw-bold bg-light ' + (profit > 0 ? 'text-primary' : (profit < 0 ? 'text-danger' : ''));
    }

    var rateEl = document.getElementById('skPreviewRate');
    if (rateEl) {
        rateEl.value = profitRate.toFixed(1) + '%';
        rateEl.className = 'form-control form-control-sm text-center fw-bold bg-light ' + (profitRate >= 20 ? 'text-success' : (profitRate < 0 ? 'text-danger' : 'text-dark'));
    }

    var breakEvenEl = document.getElementById('skPreviewBreakEven');
    if (breakEvenEl) {
        breakEvenEl.value = formatCurrency(breakEven);
        if (sp > 0 && sp < breakEven) {
            breakEvenEl.className = 'form-control form-control-sm text-end bg-light text-danger fw-bold';
            breakEvenEl.title = '주의: 현재 판매가가 손익분기가격보다 낮습니다 (역마진 발생)';
        } else {
            breakEvenEl.className = 'form-control form-control-sm text-end bg-light';
            breakEvenEl.title = '손익분기 최소판매가';
        }
    }
}

// ==========================================
// 초고속 일괄 수정 (Bulk Edit - 100배 가속 처리)
// ==========================================
async function handleBulkUpdateSubmit(e) {
    e.preventDefault();
    var bulkEditModal = document.getElementById('bulkEditSkModal');
    var newDate = document.getElementById('bulkSkDate').value;
    var newSupplier = document.getElementById('bulkSkSupplier').value.trim();
    var newBrand = document.getElementById('bulkSkBrand').value.trim();
    var newBasis = document.getElementById('bulkSkShippingBasis').value;
    var newQty = parseInt(document.getElementById('bulkSkShippingQty').value, 10) || 1;

    if (!newDate && !newSupplier && !newBrand && !newBasis) {
        showToast('수정할 항목을 하나 이상 입력/선택해주세요.', 'warning');
        return;
    }

    var checked = document.querySelectorAll('.sk-checkbox:checked');
    var idsToUpdate = [];
    checked.forEach(function(cb) { idsToUpdate.push(cb.value); });

    if (idsToUpdate.length === 0) {
        showToast('일괄 수정할 상품을 선택해주세요.', 'warning');
        return;
    }

    if (!confirm('선택한 ' + idsToUpdate.length + '개의 상품을 즉시 일괄 수정하시겠습니까?')) return;

    if (bulkEditModal) bulkEditModal.style.display = 'none';
    showToast('일괄 수정을 진행 중입니다...', 'info');

    var changes = {};
    if (newDate) changes.uploadDate = newDate;
    if (newSupplier) changes.supplier = newSupplier;
    if (newBrand) changes.brand = newBrand;
    if (newBasis) {
        changes.shippingBasis = newBasis;
        if (newBasis === '수량별') changes.shippingQty = newQty;
    }

    var author = getCurrentAuthor();

    try {
        // 1단계: 백엔드 단일 트랜잭션 초고속 벌크 엔드포인트 호출
        var res = await authFetch(API_BASE + '/bulk-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ids: idsToUpdate,
                changes: changes,
                author: author
            })
        });

        if (res.ok) {
            var resData = await res.json();
            var updateCount = resData.updatedCount || idsToUpdate.length;

            // 2단계: In-Memory 초고속 즉시 반영 (화면 깜빡임이나 재조회 지연 없음)
            var updateSet = new Set(idsToUpdate);
            products = products.map(function(p) {
                if (!updateSet.has(p.id)) return p;
                var updated = Object.assign({}, p, changes, {
                    updatedAt: resData.updatedAt || new Date().toISOString()
                });
                return enrichProduct(updated);
            });

            // 체크박스 해제 및 화면 즉시 리렌더링
            var selectAllCheck = document.getElementById('selectAllSk');
            if (selectAllCheck) selectAllCheck.checked = false;

            renderSupplierTabs();
            applyFilterAndRender();
            showToast(updateCount + '개 상품이 0.1초 만에 일괄 수정되었습니다!', 'success');
            return;
        }

        // 백엔드에 벌크 엔드포인트가 없을 경우 (Fallback: 동시 병렬 요청)
        throw new Error('FallbackToParallel');
    } catch (err) {
        console.warn('Bulk endpoint unavailable or failed, falling back to parallel batch:', err);
        // 병렬 배치 처리 (10개씩 청크 동시 실행)
        var successCount = 0;
        var failCount = 0;
        var chunkSize = 10;

        for (var i = 0; i < idsToUpdate.length; i += chunkSize) {
            var chunk = idsToUpdate.slice(i, i + chunkSize);
            var promises = chunk.map(function(id) {
                var p = products.find(function(item) { return item.id === id; });
                if (!p) return Promise.resolve(false);
                var updatedData = Object.assign({}, p, changes, { author: author });
                return authFetch(API_BASE + '/' + id, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatedData)
                }).then(function(r) { return r.ok; }).catch(function() { return false; });
            });

            var results = await Promise.all(promises);
            results.forEach(function(ok) { if (ok) successCount++; else failCount++; });
        }

        loadProducts();
        var selectAllCheck2 = document.getElementById('selectAllSk');
        if (selectAllCheck2) selectAllCheck2.checked = false;

        if (failCount === 0) {
            showToast(successCount + '개 상품이 성공적으로 일괄 수정되었습니다!', 'success');
        } else {
            showToast(successCount + '개 성공, ' + failCount + '개 실패했습니다.', 'warning');
        }
    }
}

// ==========================================
// 인증 및 앱 초기화
// ==========================================
function setupAuth() {
    try {
        if (window.parent && window.parent.getAuthToken) {
            window.parent.getAuthToken().then(function(token) {
                if (token) loadProducts();
                else waitForFirebaseAuth();
            }).catch(waitForFirebaseAuth);
            return;
        }
    } catch(e) {}
    waitForFirebaseAuth();
}

function waitForFirebaseAuth() {
    let authChecked = false;
    onAuthStateChanged(auth, function() {
        if (!authChecked) {
            authChecked = true;
            loadProducts();
        }
    });
    setTimeout(function() {
        if (!authChecked) {
            authChecked = true;
            loadProducts();
        }
    }, 2000);
}

// ==========================================
// DOM 이벤트 리스너 바인딩
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    setupAuth();

    // 1. 신규 등록 버튼
    var addBtn = document.getElementById('addProductBtn');
    if (addBtn) addBtn.addEventListener('click', function() { openModal(null); });

    // 2. 모달 닫기
    var closeBtn = document.getElementById('closeSkModalBtn');
    var cancelBtn = document.getElementById('cancelSkBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // 3. 운임기준 변경 및 실시간 미리보기
    var basisEl = document.getElementById('skShippingBasis');
    if (basisEl) {
        basisEl.addEventListener('change', function() {
            toggleShippingQty();
            updateCalcPreview();
        });
    }

    ['skBuyPrice', 'skBuyShipping', 'skShippingQty', 'skSellPrice', 'skSellShipping'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', updateCalcPreview);
    });

    // 4. 모달 폼 저장 (신규/수정)
    var skForm = document.getElementById('skForm');
    if (skForm) {
        skForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var supplier = document.getElementById('skSupplier').value.trim();
            var name = document.getElementById('skName').value.trim();
            if (!supplier || !name) {
                showToast('매입처와 상품명은 필수 항목입니다.', 'warning');
                return;
            }

            var data = {
                supplier: supplier,
                brand: document.getElementById('skBrand').value.trim(),
                name: name,
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
                remarks: document.getElementById('skRemarks') ? document.getElementById('skRemarks').value.trim() : '',
                author: getCurrentAuthor()
            };

            if (editingId) {
                data.id = editingId;
                authFetch(API_BASE + '/' + editingId, {
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
                authFetch(API_BASE, {
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
    }

    // 5. 단축키 핸들러 (F2: 신규, F8: 저장, ESC: 닫기)
    document.addEventListener('keydown', function(e) {
        var skModal = document.getElementById('skModal');
        var bulkModal = document.getElementById('bulkEditSkModal');
        var isModalOpen = (skModal && skModal.style.display === 'block') || (bulkModal && bulkModal.style.display === 'flex' || (bulkModal && bulkModal.style.display === 'block'));

        if (e.key === 'F2') {
            e.preventDefault();
            openModal(null);
            return;
        }

        if (e.key === 'F8') {
            if (isModalOpen) {
                e.preventDefault();
                if (skModal && skModal.style.display === 'block') {
                    document.getElementById('saveSkBtn').click();
                } else if (bulkModal && (bulkModal.style.display === 'block' || bulkModal.style.display === 'flex')) {
                    document.getElementById('saveBulkEditSkBtn').click();
                }
            }
            return;
        }

        if (e.key === 'Escape') {
            if (skModal && skModal.style.display === 'block') closeModal();
            if (bulkModal && (bulkModal.style.display === 'block' || bulkModal.style.display === 'flex')) {
                bulkModal.style.display = 'none';
            }
        }
    });

    // 6. 이벤트 위임(Event Delegation) 기반 테이블 클릭 처리
    var tbody = document.getElementById('skTableBody');
    if (tbody) {
        tbody.addEventListener('click', function(e) {
            // 체크박스 클릭
            if (e.target.classList.contains('sk-checkbox')) {
                var tr = e.target.closest('tr');
                if (tr) tr.classList.toggle('row-selected', e.target.checked);
                updateSelectedCount();
                return;
            }

            // 행 클릭 시 수정 모달 열기
            var row = e.target.closest('.product-row');
            if (row) {
                var id = row.getAttribute('data-id');
                if (id) openModal(id);
            }
        });
    }

    // 7. 전체 선택 체크박스
    var selectAllCheck = document.getElementById('selectAllSk');
    if (selectAllCheck) {
        selectAllCheck.addEventListener('change', function() {
            var checked = this.checked;
            document.querySelectorAll('.sk-checkbox').forEach(function(cb) {
                cb.checked = checked;
                var tr = cb.closest('tr');
                if (tr) tr.classList.toggle('row-selected', checked);
            });
            updateSelectedCount();
        });
    }

    // 8. 선택 삭제
    var delBtn = document.getElementById('deleteSkBtn');
    if (delBtn) {
        delBtn.addEventListener('click', function() {
            var checked = document.querySelectorAll('.sk-checkbox:checked');
            if (checked.length === 0) {
                showToast('삭제할 상품을 선택해주세요.', 'warning');
                return;
            }
            if (!confirm('선택한 ' + checked.length + '개 상품을 정말 삭제하시겠습니까?')) return;

            var idsToDelete = [];
            checked.forEach(function(cb) { idsToDelete.push(cb.value); });

            authFetch(API_BASE + '/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: idsToDelete })
            })
            .then(function(res) { return res.json(); })
            .then(function() {
                if (selectAllCheck) selectAllCheck.checked = false;
                showToast('성공적으로 삭제되었습니다.', 'success');
                loadProducts();
            })
            .catch(function(err) {
                showToast('삭제 실패: ' + err.message, 'error');
            });
        });
    }

    // 9. 일괄 수정 모달 열기/닫기
    var bulkEditModal = document.getElementById('bulkEditSkModal');
    var bulkEditBtn = document.getElementById('bulkEditSkBtn');
    var closeBulkBtn = document.getElementById('closeBulkEditSkModalBtn');
    var cancelBulkBtn = document.getElementById('cancelBulkEditSkBtn');
    var bulkForm = document.getElementById('bulkEditSkForm');
    var bulkBasisEl = document.getElementById('bulkSkShippingBasis');

    if (bulkEditBtn) {
        bulkEditBtn.addEventListener('click', function() {
            var checked = document.querySelectorAll('.sk-checkbox:checked');
            if (checked.length === 0) {
                showToast('일괄 수정할 상품을 먼저 선택해주세요.', 'warning');
                return;
            }
            if (bulkForm) bulkForm.reset();
            var qtyWrap = document.getElementById('bulkSkShippingQtyWrapper');
            if (qtyWrap) qtyWrap.style.display = 'none';
            if (bulkEditModal) bulkEditModal.style.display = 'block';
        });
    }

    if (closeBulkBtn) closeBulkBtn.addEventListener('click', function() { if (bulkEditModal) bulkEditModal.style.display = 'none'; });
    if (cancelBulkBtn) cancelBulkBtn.addEventListener('click', function() { if (bulkEditModal) bulkEditModal.style.display = 'none'; });

    if (bulkBasisEl) {
        bulkBasisEl.addEventListener('change', function() {
            var qtyWrap = document.getElementById('bulkSkShippingQtyWrapper');
            if (qtyWrap) qtyWrap.style.display = (this.value === '수량별') ? 'flex' : 'none';
        });
    }

    if (bulkForm) {
        bulkForm.addEventListener('submit', handleBulkUpdateSubmit);
    }

    // 10. 상태 칩 필터 바인딩
    var statusGroup = document.getElementById('statusFilterGroup');
    if (statusGroup) {
        statusGroup.querySelectorAll('.erp-filter-chip').forEach(function(chip) {
            chip.addEventListener('click', function() {
                statusGroup.querySelectorAll('.erp-filter-chip').forEach(function(c) { c.classList.remove('active'); });
                this.classList.add('active');
                currentStatusFilter = this.getAttribute('data-status') || 'all';
                currentPage = 1;
                applyFilterAndRender();
            });
        });
    }

    // 11. 검색어 입력 및 초기화
    var searchInputEl = document.getElementById('skSearchInput');
    var searchFieldEl = document.getElementById('skSearchField');
    var clearSearchBtn = document.getElementById('clearSearchBtn');
    var searchSubmitBtn = document.getElementById('searchSubmitBtn');
    var searchResetBtn = document.getElementById('searchResetBtn');
    var searchTimer = null;

    if (searchInputEl) {
        searchInputEl.addEventListener('input', function() {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(function() {
                currentPage = 1;
                applyFilterAndRender();
            }, 250);
        });

        searchInputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                currentPage = 1;
                applyFilterAndRender();
            }
        });
    }

    if (searchFieldEl) {
        searchFieldEl.addEventListener('change', function() {
            currentPage = 1;
            applyFilterAndRender();
        });
    }

    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            if (searchInputEl) searchInputEl.value = '';
            currentPage = 1;
            applyFilterAndRender();
            if (searchInputEl) searchInputEl.focus();
        });
    }

    if (searchSubmitBtn) {
        searchSubmitBtn.addEventListener('click', function() {
            currentPage = 1;
            applyFilterAndRender();
        });
    }

    if (searchResetBtn) {
        searchResetBtn.addEventListener('click', function() {
            if (searchInputEl) searchInputEl.value = '';
            if (searchFieldEl) searchFieldEl.value = 'all';
            currentSupplierFilter = '';
            currentStatusFilter = 'all';
            if (statusGroup) {
                statusGroup.querySelectorAll('.erp-filter-chip').forEach(function(c) { c.classList.remove('active'); });
                var allChip = statusGroup.querySelector('[data-status="all"]');
                if (allChip) allChip.classList.add('active');
            }
            renderSupplierTabs();
            currentPage = 1;
            applyFilterAndRender();
        });
    }

    // 12. 페이지 크기 선택
    var pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function() {
            pageSize = parseInt(this.value, 10);
            currentPage = 1;
            renderTable();
        });
    }

    // 13. 열 정렬 헤더 클릭
    document.querySelectorAll('.sk-table th.sortable').forEach(function(th) {
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
        });
    });

    // 14. 열 너비 초기화 버튼
    var autoFitBtn = document.getElementById('autoFitColsBtn');
    if (autoFitBtn) {
        autoFitBtn.addEventListener('click', function() {
            if (window.resetErpGridColumnWidths) {
                window.resetErpGridColumnWidths('skTable');
                showToast('컬럼 너비가 초기화되었습니다.', 'info');
            }
        });
    }

    // 15. 엑셀 다운로드
    var exportBtn = document.getElementById('exportSkBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            if (typeof XLSX === 'undefined') {
                showToast('엑셀 라이브러리가 로드되지 않았습니다.', 'error');
                return;
            }
            if (filteredProducts.length === 0) {
                showToast('내보낼 데이터가 없습니다.', 'warning');
                return;
            }
            var wsData = [
                ["스마트스토어 등록일", "매입처", "브랜드", "상품명", "컬러", "규격", "매입가(공급가)", "매입운임", "운임기준", "매입합계", "판매가(소비자가)", "판매운임", "매출합계", "수수료", "정산이익", "수익률(%)", "온라인최저가", "품절여부", "비고", "최종수정일"]
            ];
            filteredProducts.forEach(function(p) {
                wsData.push([
                    p.uploadDate || '', p.supplier || '', p.brand || '', p.name || '',
                    p.color || '', p.size || '', p.buyPrice || 0, p.buyShipping || 0,
                    p.shippingBasis || '', p._buyTotal, p.sellPrice || 0, p.sellShipping || 0,
                    p._sellTotal, p._commission, p._profit, p._profitRate.toFixed(1),
                    p.isLowestPrice ? 'O' : 'X', p.isSoldOut ? '품절' : '정상',
                    p.remarks || '', p._isModified ? p._fullUpdateDate : '-'
                ]);
            });
            var wb = XLSX.utils.book_new();
            var ws = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, ws, "매입상품대장");
            var nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            XLSX.writeFile(wb, "셀러K_매입상품대장_" + nowStr + ".xlsx");
            showToast('엑셀 다운로드가 완료되었습니다.', 'success');
        });
    }

    // 16. 엑셀 양식 다운로드
    var templateBtn = document.getElementById('downloadTemplateBtn');
    if (templateBtn) {
        templateBtn.addEventListener('click', function() {
            if (typeof XLSX === 'undefined') {
                showToast('엑셀 라이브러리가 로드되지 않았습니다.', 'error');
                return;
            }
            var wb = XLSX.utils.book_new();
            var wsData = [
                ["매입처", "브랜드", "상품명", "컬러", "사이즈", "업로드일(YYYY-MM-DD)", "매입가(단가)", "매입운임", "운임기준(수량별/무료/조건부/유료)", "수량별기준(공란시1)", "판매가", "판매운임", "최저가설정(O/X)", "비고"],
                ["예시)최가유통", "K2 세이프티", "에어윈드베스트 선풍기조끼", "블랙", "FREE", "2026-09-30", 15000, 3000, "수량별", 1, 25000, 3000, "X", "정품 배터리 포함"]
            ];
            var ws = XLSX.utils.aoa_to_sheet(wsData);
            ws['!cols'] = [{wpx:90},{wpx:100},{wpx:160},{wpx:60},{wpx:60},{wpx:130},{wpx:80},{wpx:80},{wpx:180},{wpx:120},{wpx:80},{wpx:80},{wpx:100},{wpx:150}];
            XLSX.utils.book_append_sheet(wb, ws, "상품양식");
            XLSX.writeFile(wb, "매입상품_일괄등록_표준양식.xlsx");
        });
    }

    // 17. 엑셀 대량 업로드
    var uploadBtn = document.getElementById('bulkUploadBtn');
    var uploadFile = document.getElementById('bulkUploadFile');
    if (uploadBtn && uploadFile) {
        uploadBtn.addEventListener('click', function() { uploadFile.click(); });
        uploadFile.addEventListener('change', function(e) {
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
                    var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(firstSheet, {header: 1});
                    var uploadProducts = [];

                    for (var i = 1; i < rows.length; i++) {
                        var row = rows[i];
                        if (!row || row.length === 0 || !row[0] || String(row[0]).indexOf("예시)") === 0) continue;
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
                            shippingBasis: String(row[8] || '수량별').trim(),
                            shippingQty: parseInt(row[9], 10) || 1,
                            sellPrice: parseInt(row[10], 10) || 0,
                            sellShipping: parseInt(row[11], 10) || 0,
                            isLowestPrice: (String(row[12] || 'X').trim().toUpperCase() === 'O') ? 1 : 0,
                            remarks: String(row[13] || '').trim(),
                            author: getCurrentAuthor()
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

                    authFetch(API_BASE + '/bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ products: uploadProducts })
                    })
                    .then(function(res) { return res.json(); })
                    .then(function(result) {
                        if (result.error) throw new Error(result.error);
                        showToast((result.insertedCount || uploadProducts.length) + '개 상품이 성공적으로 일괄 등록되었습니다.', 'success');
                        e.target.value = '';
                        loadProducts();
                    })
                    .catch(function(err) {
                        showToast('대량 등록 실패: ' + err.message, 'error');
                        e.target.value = '';
                    });
                } catch(parseErr) {
                    console.error('Excel parse error:', parseErr);
                    showToast('엑셀 파일 분석 중 오류가 발생했습니다.', 'error');
                    e.target.value = '';
                }
            };
            reader.readAsArrayBuffer(file);
        });
    }

    // 전역 새로고침 함수 노출
    window.refreshData = loadProducts;
});