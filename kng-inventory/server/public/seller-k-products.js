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
const API_BASE = '/api/seller-k/products';

// ==========================================
// 앱 상태
// ==========================================
var products = [];
var editingId = null;

// ==========================================
// 데이터 로드
// ==========================================
function loadProducts() {
    updateConnectionStatus(false);
    fetch(API_BASE)
        .then(function(res) { return res.json(); })
        .then(function(data) {
            products = data || [];
            renderTable();
            updateConnectionStatus(true);
        })
        .catch(function(err) {
            console.error('API Error:', err);
            showToast('데이터를 불러오는데 실패했습니다.', 'error');
            updateConnectionStatus(false);
            document.getElementById('skTableBody').innerHTML =
                '<tr><td colspan="17" style="text-align:center; padding:30px;">API 서버 연결 실패</td></tr>';
        });
}

// ==========================================
// 계산 함수
// ==========================================
function generateId() {
    return 'sk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
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
    if (!buyPrice) buyPrice = 0;
    if (!buyShipping) buyShipping = 0;
    var finalShipping = 0;
    if (shippingBasis === '조건부' || shippingBasis === '유료' || shippingBasis === '무료') {
        finalShipping = buyShipping; // 매입 운임은 무료여도 그대로 둠
    } else {
        // 수량별
        var sq = parseInt(shippingQty, 10);
        if (isNaN(sq) || sq < 1) sq = 1;
        finalShipping = Math.round(buyShipping / sq);
    }
    return buyPrice + finalShipping;
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

    var totalBuy = 0;
    var totalSell = 0;
    var totalProfit = 0;
    var html = '';

    if (products.length === 0) {
        html = '<tr><td colspan="17" style="text-align:center; padding:30px; color:var(--gray-500);">등록된 매입상품이 없습니다.</td></tr>';
    } else {
        products.forEach(function(p) {
            var buyTotal = calcBuyTotal(p.buyPrice, p.buyShipping, p.shippingBasis, p.shippingQty);
            var sellTotal = calcSellTotal(p.sellPrice, p.sellShipping, p.shippingBasis);
            var commission = calcCommission(p.sellPrice || 0, p.sellShipping || 0, p.shippingBasis);
            var profit = calcProfit(buyTotal, sellTotal, commission);
            var profitRate = calcProfitRate(profit, sellTotal);
            totalBuy += buyTotal;
            totalSell += sellTotal;
            totalProfit += profit;

            var shippingBasisLabel = p.shippingBasis || '';
            if (p.shippingBasis === '수량별') shippingBasisLabel += ' (' + (p.shippingQty || 1) + '개당)';

            var profitClass = profit > 0 ? 'text-success' : (profit < 0 ? 'text-danger' : '');
            var badgeClass = profitRate > 20 ? 'badge-success' : 'badge-neutral';

            html += '<tr>' +
                '<td class="col-check"><input type="checkbox" class="sk-checkbox" value="' + escapeHtml(p.id) + '"></td>' +
                '<td>' + escapeHtml(p.supplier) + '</td>' +
                '<td>' + escapeHtml(p.brand) + '</td>' +
                '<td><strong>' + escapeHtml(p.name) + '</strong></td>' +
                '<td>' + escapeHtml(p.color) + '</td>' +
                '<td>' + escapeHtml(p.size) + '</td>' +
                '<td>' + escapeHtml(p.uploadDate) + '</td>' +
                '<td class="col-num buy-col">' + formatCurrency(p.buyPrice) + '</td>' +
                '<td class="col-num buy-col">' + formatCurrency(p.buyShipping || 0) + '</td>' +
                '<td class="buy-col" style="text-align:center; font-size:12px;">' + escapeHtml(shippingBasisLabel) + '</td>' +
                '<td class="col-num buy-col" style="font-weight:600;">' + formatCurrency(buyTotal) + '</td>' +
                '<td class="col-num sell-col">' + formatCurrency(p.sellPrice || 0) + '</td>' +
                '<td class="col-num sell-col">' + formatCurrency(p.sellShipping || 0) + '</td>' +
                '<td class="col-num sell-col" style="font-weight:600;">' + formatCurrency(sellTotal) + '</td>' +
                '<td class="col-num profit-col" style="color:var(--danger)">' + formatCurrency(commission) + '</td>' +
                '<td class="col-num profit-col ' + profitClass + '" style="font-weight:bold;">' + formatCurrency(profit) + '</td>' +
                '<td class="col-num profit-col"><span class="badge ' + badgeClass + '">' + profitRate.toFixed(1) + '%</span></td>' +
                '<td class="col-action"><button class="btn-icon edit-btn" data-id="' + escapeHtml(p.id) + '"><i class="bx bx-edit-alt"></i></button></td>' +
                '</tr>';
        });
    }

    tbody.innerHTML = html;

    // KPI 업데이트
    var countEl = document.getElementById('skTotalCount');
    var buyEl = document.getElementById('skTotalBuy');
    var sellEl = document.getElementById('skTotalSell');
    var profitEl = document.getElementById('skTotalProfit');
    if (countEl) countEl.textContent = products.length;
    if (buyEl) buyEl.textContent = formatCurrency(totalBuy);
    if (sellEl) sellEl.textContent = formatCurrency(totalSell);
    if (profitEl) profitEl.textContent = formatCurrency(totalProfit);

    // 수정 버튼 이벤트 바인딩
    document.querySelectorAll('.edit-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            openModal(this.getAttribute('data-id'));
        });
    });
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
            toggleShippingQty();
            updateCalcPreview();
        }
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

    // 매입 금액 미리보기
    var buyTotalEl = document.getElementById('skBuyTotal');
    if (buyTotalEl) buyTotalEl.value = formatCurrency(buyTotal);

    // 매출 금액 미리보기
    var sellTotalEl = document.getElementById('skSellTotal');
    if (sellTotalEl) sellTotalEl.value = formatCurrency(sellTotal);

    // 정산 미리보기
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
    var mainApp = document.getElementById('mainApp');
    var logoutBtn = document.getElementById('logoutBtn');

    onAuthStateChanged(auth, function(user) {
        if (user) {
            if (mainApp) mainApp.classList.remove('hidden');
            loadProducts();
        } else {
            window.location.href = 'index.html';
        }
    });

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            signOut(auth).then(function() {
                window.location.href = 'index.html';
            });
        });
    }
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
            sellShipping: parseInt(document.getElementById('skSellShipping').value, 10) || 0
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

    // 전체 선택
    document.getElementById('selectAllSk').addEventListener('change', function() {
        var checked = this.checked;
        document.querySelectorAll('.sk-checkbox').forEach(function(cb) {
            cb.checked = checked;
        });
    });

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

    toggleShippingQty();
});
