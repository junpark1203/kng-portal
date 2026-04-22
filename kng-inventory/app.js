import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-analytics.js";
import { 
    getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
    onSnapshot, runTransaction, writeBatch, query 
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

// Firebase 설정
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
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

// ==========================================
// Firestore 보안 경고
// ==========================================
console.warn(
    "[보안 알림] Firestore Security Rules를 반드시 설정하세요.\n" +
    "Firebase Console > Firestore > Rules 에서 인증된 사용자만 접근하도록 제한해야 합니다.\n" +
    "현재 API 키가 클라이언트에 노출되어 있으므로, Rules가 유일한 보안 장벽입니다."
);

// ==========================================
// 유틸리티 함수
// ==========================================
const formatCurrency = (number) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' }).format(number);

/** XSS 방지용 HTML 이스케이프 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** 토스트 알림 (alert 대체) */
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

/** Firebase 연결 상태 업데이트 */
function updateConnectionStatus(online) {
    var statusEl = document.getElementById('firebaseStatus');
    if (!statusEl) return;
    
    if (online) {
        statusEl.innerHTML = "<i class='bx bxl-firebase'></i> Firebase Online";
        statusEl.style.color = 'var(--success)';
    } else {
        statusEl.innerHTML = "<i class='bx bx-error-circle'></i> Offline";
        statusEl.style.color = 'var(--danger)';
    }
}

// 브라우저 온라인/오프라인 감지
window.addEventListener('online', function() { updateConnectionStatus(true); });
window.addEventListener('offline', function() { updateConnectionStatus(false); });

// ==========================================
// 초기 상품 데이터 (첫 DB 셋업용)
// ==========================================
var rawProducts = [
  { id: 'p1', brand: "K2 세이프티", name: "K2 세이프티 쿨 바라클라바 (블랙)", color: "블랙", size: "FREE", stock: 5, buyPrice: 9500, sellPrice: 12000 },
  { id: 'p2', brand: "K2 세이프티", name: "K2 세이프티 베이직 쿨토시", color: "화이트", size: "FREE", stock: 10, buyPrice: 3700, sellPrice: 4700 },
  { id: 'p3', brand: "K2 세이프티", name: "K2 세이프티 베이직 쿨토시", color: "블랙", size: "FREE", stock: 10, buyPrice: 3700, sellPrice: 4700 },
  { id: 'p4', brand: "K2 세이프티", name: "K2 세이프티 하이크 넥스카프", color: "화이트", size: "FREE", stock: 5, buyPrice: 7900, sellPrice: 10000 },
  { id: 'p5', brand: "K2 세이프티", name: "K2 세이프티 하이크 넥스카프", color: "다크네이비", size: "FREE", stock: 5, buyPrice: 7900, sellPrice: 10000 },
  { id: 'p6', brand: "K2 세이프티", name: "K2 세이프티 쿨토시", color: "블랙", size: "FREE", stock: 10, buyPrice: 7400, sellPrice: 9400 },
  { id: 'p7', brand: "K2 세이프티", name: "K2 세이프티 쿨토시", color: "화이트", size: "FREE", stock: 10, buyPrice: 7400, sellPrice: 9400 },
  { id: 'p8', brand: "K2 세이프티", name: "K2 세이프티 쿨토시", color: "차콜", size: "FREE", stock: 10, buyPrice: 7400, sellPrice: 9400 },
  { id: 'p9', brand: "K2 세이프티", name: "K2 세이프티 카일 차양 캡모자", color: "차콜", size: "FREE", stock: 2, buyPrice: 23100, sellPrice: 29000 },
  { id: 'p10', brand: "K2 세이프티", name: "K2 세이프티 카일 차양 캡모자", color: "라이트 그레이", size: "FREE", stock: 2, buyPrice: 23100, sellPrice: 29000 },
  { id: 'p11', brand: "K2 세이프티", name: "K2 세이프티 하이크 햇 모자 (베이지)", color: "베이지", size: "FREE", stock: 2, buyPrice: 16800, sellPrice: 21100 },
  { id: 'p12', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트(벨트형 2)(GR) 선풍기조끼 (그레이)", color: "그레이", size: "105", stock: 2, buyPrice: 107100, sellPrice: 134000 },
  { id: 'p13', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트(벨트형 2)(GR) 선풍기조끼 (그레이)", color: "그레이", size: "95", stock: 2, buyPrice: 107100, sellPrice: 134000 },
  { id: 'p14', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트(벨트형 2)(GR) 선풍기조끼 (그레이)", color: "그레이", size: "100", stock: 2, buyPrice: 107100, sellPrice: 134000 },
  { id: 'p15', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트(벨트형 2)(GR) 선풍기조끼 (그레이)", color: "그레이", size: "110", stock: 2, buyPrice: 107100, sellPrice: 134000 },
  { id: 'p16', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트(벨트형 2)(GR) 선풍기조끼 (그레이)", color: "그레이", size: "115", stock: 2, buyPrice: 107100, sellPrice: 134000 },
  { id: 'p17', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트3(CH) 선풍기조끼 (차콜그레이)", color: "차콜그레이", size: "95", stock: 2, buyPrice: 87200, sellPrice: 109100 },
  { id: 'p18', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트3(CH) 선풍기조끼 (차콜그레이)", color: "차콜그레이", size: "100", stock: 2, buyPrice: 87200, sellPrice: 109100 },
  { id: 'p19', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트3(CH) 선풍기조끼 (차콜그레이)", color: "차콜그레이", size: "110", stock: 2, buyPrice: 87200, sellPrice: 109100 },
  { id: 'p20', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트3(CH) 선풍기조끼 (차콜그레이)", color: "차콜그레이", size: "115", stock: 2, buyPrice: 87200, sellPrice: 109100 },
  { id: 'p21', brand: "K2 세이프티", name: "K2 세이프티 에어윈드베스트3(CH) 선풍기조끼 (차콜그레이)", color: "차콜그레이", size: "105", stock: 2, buyPrice: 87200, sellPrice: 109100 },
  { id: 'p22', brand: "K2 세이프티", name: "K2 세이프티 타공 멀티스카프 (이어홀)", color: "블랙", size: "FREE", stock: 5, buyPrice: 8930, sellPrice: 11300 },
  { id: 'p23', brand: "K2 세이프티", name: "K2 세이프티 타공 멀티스카프 (이어홀)", color: "블루", size: "FREE", stock: 5, buyPrice: 8930, sellPrice: 11300 }
];
var initialProducts = rawProducts.map(function(p) { return Object.assign({ supplier: "최가유통" }, p); });

// ==========================================
// App State 관리
// ==========================================
var products = [];
var transactions = [];
var totalRevenue = 0; 
var totalCost = 0; 
var editingRowId = null;
var viewWithVat = localStorage.getItem('viewWithVat') === 'true';
var invPage = 1;
var txPage = 1;
var PER_PAGE = 20;
var invSort = { col: 'id', asc: true };
var txSort = { col: 'timestamp', asc: false };

// ==========================================
// Firebase 초기화 (실시간 구독)
// ==========================================
async function initFirebase() {
    try {
        var metricsRef = doc(db, 'kng_data', 'metrics');
        var metricsSnap = await getDoc(metricsRef);
        
        if (!metricsSnap.exists()) {
            console.log("Firebase DB 초기 셋업 진행중...");
            var batch = writeBatch(db);
            
            var initialCost = initialProducts.reduce(function(sum, p) { return sum + (p.buyPrice * p.stock); }, 0);
            batch.set(metricsRef, { totalRevenue: 0, totalCost: initialCost });
            
            initialProducts.forEach(function(p) {
                batch.set(doc(db, 'kng_products', p.id), p);
            });
            
            await batch.commit();
            console.log("DB 초기 세팅 완료!");
        }

        // 실시간 수치 구독
        onSnapshot(metricsRef, function(docSnap) {
            updateConnectionStatus(true);
            if(docSnap.exists()) {
                var data = docSnap.data();
                totalRevenue = data.totalRevenue || 0;
                totalCost = data.totalCost || 0;
                updateDashboard();
            }
        }, function(error) {
            updateConnectionStatus(false);
            console.error('Metrics snapshot error:', error);
        });

        // 실시간 제품 구독
        onSnapshot(collection(db, 'kng_products'), function(snapshot) {
            updateConnectionStatus(true);
            var newProducts = [];
            snapshot.forEach(function(docSnap) { newProducts.push(docSnap.data()); });
            newProducts.sort(function(a, b) { return a.id.localeCompare(b.id, undefined, {numeric: true, sensitivity: 'base'}); });
            products = newProducts;
            renderTable();
            updateDashboard();
        }, function(error) {
            updateConnectionStatus(false);
            console.error('Products snapshot error:', error);
        });

        // 실시간 트랜잭션 구독
        onSnapshot(query(collection(db, 'kng_transactions')), function(snapshot) {
            var newTx = [];
            snapshot.forEach(function(docSnap) { newTx.push(Object.assign({ id: docSnap.id }, docSnap.data())); });
            newTx.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
            transactions = newTx;
            renderTransactionsTable();
        }, function(error) {
            console.error('Transactions snapshot error:', error);
        });
        
    } catch (e) {
        console.error("Firebase 초기화 에러:", e);
        updateConnectionStatus(false);
        showToast('DB 연동에 실패했습니다. (Firestore 권한 확인)', 'error');
    }
}

// ==========================================
// 인라인 수정 스크립트
// ==========================================
window.toggleEdit = function(id) {
    editingRowId = id;
    renderTable(); 
};

window.cancelEdit = function() {
    editingRowId = null;
    renderTable();
};

window.saveEdit = async function(id) {
    var btn = document.getElementById('btn-save-' + id);
    btn.innerHTML = '저장 중...';
    btn.disabled = true;

    try {
        var prodRef = doc(db, 'kng_products', id);
        await updateDoc(prodRef, {
            supplier: document.getElementById('edit-sp-' + id).value,
            brand: document.getElementById('edit-br-' + id).value,
            name: document.getElementById('edit-nm-' + id).value,
            color: document.getElementById('edit-cl-' + id).value,
            size: document.getElementById('edit-sz-' + id).value,
            buyPrice: parseInt(document.getElementById('edit-bp-' + id).value, 10),
            stock: parseInt(document.getElementById('edit-st-' + id).value, 10)
        });
        editingRowId = null;
        showToast('상품 정보가 수정되었습니다.', 'success');
    } catch(e) {
        showToast('수정 실패: ' + e, 'error');
    }
};

// ==========================================
// 부가세 표출 토글 UI
// ==========================================
function updateVatButtonUI(btn) {
    if (viewWithVat) {
        btn.innerHTML = "<i class='bx bx-check-double'></i> VAT 포함";
        btn.style.background = "#4f6ef7";
        btn.style.color = "#fff";
        btn.style.borderColor = "#4f6ef7";
    } else {
        btn.innerHTML = "<i class='bx bx-circle'></i> VAT 별도";
        btn.style.background = "";
        btn.style.color = "";
        btn.style.borderColor = "";
    }
}

// ==========================================
// 페이지네이션
// ==========================================
window.goInvPage = function(page) {
    invPage = page;
    renderTable(document.getElementById('searchInput').value);
};

window.goTxPage = function(page) {
    txPage = page;
    renderTransactionsTable();
};

function renderPagination(containerId, currentPage, totalItems, perPage, funcName) {
    var container = document.getElementById(containerId);
    if (!container) return;
    
    var totalPages = Math.ceil(totalItems / perPage);
    
    if (totalItems === 0) {
        container.innerHTML = '<span class="page-info">데이터 없음</span>';
        return;
    }
    
    if (totalPages <= 1) {
        container.innerHTML = '<span class="page-info">총 ' + totalItems + '건</span>';
        return;
    }
    
    var html = '<button class="page-btn" ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="' + funcName + '(' + (currentPage - 1) + ')">‹ 이전</button>';
    
    var startP = Math.max(1, currentPage - 2);
    var endP = Math.min(totalPages, startP + 4);
    if (endP - startP < 4) startP = Math.max(1, endP - 4);
    
    for (var i = startP; i <= endP; i++) {
        html += '<button class="page-btn ' + (i === currentPage ? 'active' : '') + '" onclick="' + funcName + '(' + i + ')">' + i + '</button>';
    }
    
    html += '<button class="page-btn" ' + (currentPage === totalPages ? 'disabled' : '') + ' onclick="' + funcName + '(' + (currentPage + 1) + ')">다음 ›</button>';
    html += '<span class="page-info">' + totalItems + '건 중 ' + ((currentPage-1)*perPage + 1) + '–' + Math.min(currentPage*perPage, totalItems) + '</span>';
    
    container.innerHTML = html;
}

// ==========================================
// 테이블 렌더링
// ==========================================
function renderTable(searchTerm) {
    if (!searchTerm) searchTerm = '';
    var tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = '';
    
    var filtered = products;
    // 글로벌 검색 (상단 검색바)
    if (searchTerm) {
        var term = searchTerm.toLowerCase();
        filtered = filtered.filter(function(p) {
            return p.name.toLowerCase().includes(term) || 
                p.color.toLowerCase().includes(term) ||
                p.brand.toLowerCase().includes(term) ||
                (p.supplier && p.supplier.toLowerCase().includes(term));
        });
    }
    
    // 재고 테이블 내 필드별 검색
    var invSearchEl = document.getElementById('invSearchInput');
    var invFieldEl = document.getElementById('invSearchField');
    if (invSearchEl && invFieldEl) {
        var invTerm = invSearchEl.value.trim().toLowerCase();
        var invField = invFieldEl.value;
        if (invTerm) {
            filtered = filtered.filter(function(p) {
                if (invField === 'all') {
                    return (p.supplier || '최가유통').toLowerCase().includes(invTerm) ||
                        p.brand.toLowerCase().includes(invTerm) ||
                        p.name.toLowerCase().includes(invTerm) ||
                        p.color.toLowerCase().includes(invTerm) ||
                        p.size.toLowerCase().includes(invTerm) ||
                        String(p.buyPrice).includes(invTerm) ||
                        String(p.stock).includes(invTerm);
                } else if (invField === 'supplier') {
                    return (p.supplier || '최가유통').toLowerCase().includes(invTerm);
                } else if (invField === 'brand') {
                    return p.brand.toLowerCase().includes(invTerm);
                } else if (invField === 'name') {
                    return p.name.toLowerCase().includes(invTerm);
                } else if (invField === 'color') {
                    return p.color.toLowerCase().includes(invTerm);
                } else if (invField === 'size') {
                    return p.size.toLowerCase().includes(invTerm);
                } else if (invField === 'buyPrice') {
                    return String(p.buyPrice).includes(invTerm);
                } else if (invField === 'stock') {
                    return String(p.stock).includes(invTerm);
                }
                return true;
            });
        }
    }

    filtered.sort(function(a, b) {
        var valA = a[invSort.col] || '';
        var valB = b[invSort.col] || '';
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        
        if (valA < valB) return invSort.asc ? -1 : 1;
        if (valA > valB) return invSort.asc ? 1 : -1;
        return 0;
    });

    var total = filtered.length;
    var totalPages = Math.ceil(total / PER_PAGE);
    if (invPage > totalPages) invPage = Math.max(1, totalPages);
    var start = (invPage - 1) * PER_PAGE;
    var paged = filtered.slice(start, start + PER_PAGE);
    
    paged.forEach(function(p) {
        var tr = document.createElement('tr');
        var sp = p.supplier || '최가유통';
        var checkboxHtml = '<td><input type="checkbox" class="inv-checkbox" value="' + escapeHtml(p.id) + '"></td>';
        
        var buyPriceDisplay = formatCurrency(p.buyPrice * (viewWithVat ? 1.1 : 1));

        if (editingRowId === p.id) {
            tr.innerHTML = checkboxHtml +
                '<td><input type="text" class="inline-input" id="edit-sp-' + escapeHtml(p.id) + '" value="' + escapeHtml(sp) + '"></td>' +
                '<td><input type="text" class="inline-input" id="edit-br-' + escapeHtml(p.id) + '" value="' + escapeHtml(p.brand) + '"></td>' +
                '<td><input type="text" class="inline-input" id="edit-nm-' + escapeHtml(p.id) + '" value="' + escapeHtml(p.name) + '"></td>' +
                '<td><input type="text" class="inline-input" id="edit-cl-' + escapeHtml(p.id) + '" value="' + escapeHtml(p.color) + '"></td>' +
                '<td><input type="text" class="inline-input" id="edit-sz-' + escapeHtml(p.id) + '" value="' + escapeHtml(p.size) + '"></td>' +
                '<td><input type="number" class="inline-input" id="edit-bp-' + escapeHtml(p.id) + '" value="' + p.buyPrice + '"></td>' +
                '<td><input type="number" class="inline-input" id="edit-st-' + escapeHtml(p.id) + '" value="' + p.stock + '"></td>' +
                '<td style="display:flex;gap:4px;">' +
                    '<button class="btn-action save" id="btn-save-' + escapeHtml(p.id) + '" onclick="saveEdit(\'' + escapeHtml(p.id) + '\')">저장</button>' +
                    '<button class="btn-action" onclick="cancelEdit()">취소</button>' +
                '</td>';
        } else {
            var badgeClass = p.stock <= 2 ? 'stock-badge low' : 'stock-badge';
            tr.innerHTML = checkboxHtml +
                '<td>' + escapeHtml(sp) + '</td>' +
                '<td>' + escapeHtml(p.brand) + '</td>' +
                '<td>' + escapeHtml(p.name) + '</td>' +
                '<td>' + escapeHtml(p.color) + '</td>' +
                '<td>' + escapeHtml(p.size) + '</td>' +
                '<td>' + buyPriceDisplay + '</td>' +
                '<td><span class="' + badgeClass + '">' + p.stock + '</span></td>' +
                '<td><button class="btn-action" onclick="toggleEdit(\'' + escapeHtml(p.id) + '\')"><i class="bx bx-edit-alt"></i> 수정</button></td>';
        }
        tbody.appendChild(tr);
    });

    renderPagination('invPagination', invPage, total, PER_PAGE, 'goInvPage');
}

function renderTransactionsTable() {
    var tbody = document.getElementById('transactionTableBody');
    tbody.innerHTML = '';

    // 입출고 내역 테이블 내 필드별 검색
    var filteredTx = transactions;
    var txSearchEl = document.getElementById('txSearchInput');
    var txFieldEl = document.getElementById('txSearchField');
    if (txSearchEl && txFieldEl) {
        var txTerm = txSearchEl.value.trim().toLowerCase();
        var txField = txFieldEl.value;
        if (txTerm) {
            filteredTx = filteredTx.filter(function(t) {
                if (txField === 'all') {
                    var dateStr = t.txDate || (t.timestamp ? t.timestamp.split('T')[0] : '');
                    var typeLabel = t.type === 'IN' ? '매입' : '출고';
                    return dateStr.includes(txTerm) ||
                        typeLabel.includes(txTerm) ||
                        t.type.toLowerCase().includes(txTerm) ||
                        (t.supplier || '').toLowerCase().includes(txTerm) ||
                        (t.productName || '').toLowerCase().includes(txTerm) ||
                        (t.brand || '').toLowerCase().includes(txTerm) ||
                        (t.color || '').toLowerCase().includes(txTerm) ||
                        (t.size || '').toLowerCase().includes(txTerm) ||
                        String(t.qty).includes(txTerm) ||
                        String(t.price).includes(txTerm) ||
                        (t.remarks || '').toLowerCase().includes(txTerm);
                } else if (txField === 'timestamp') {
                    var dateStr = t.txDate || (t.timestamp ? t.timestamp.split('T')[0] : '');
                    return dateStr.includes(txTerm);
                } else if (txField === 'type') {
                    var typeLabel = t.type === 'IN' ? '매입' : '출고';
                    return typeLabel.includes(txTerm) || t.type.toLowerCase().includes(txTerm);
                } else if (txField === 'supplier') {
                    return (t.supplier || '').toLowerCase().includes(txTerm);
                } else if (txField === 'productName') {
                    return (t.productName || '').toLowerCase().includes(txTerm) ||
                        (t.brand || '').toLowerCase().includes(txTerm) ||
                        (t.color || '').toLowerCase().includes(txTerm) ||
                        (t.size || '').toLowerCase().includes(txTerm);
                } else if (txField === 'qty') {
                    return String(t.qty).includes(txTerm);
                } else if (txField === 'price') {
                    return String(t.price).includes(txTerm);
                } else if (txField === 'remarks') {
                    return (t.remarks || '').toLowerCase().includes(txTerm);
                }
                return true;
            });
        }
    }

    var sortedTx = filteredTx.slice().sort(function(a, b) {
        var valA = a[txSort.col] || '';
        var valB = b[txSort.col] || '';
        
        if (txSort.col === 'timestamp' || txSort.col === 'date') {
             valA = new Date(valA).getTime() || 0;
             valB = new Date(valB).getTime() || 0;
        } else if (typeof valA === 'string') {
             valA = valA.toLowerCase();
             valB = valB.toLowerCase();
        }
        
        if (valA < valB) return txSort.asc ? -1 : 1;
        if (valA > valB) return txSort.asc ? 1 : -1;
        return 0;
    });

    var total = sortedTx.length;
    var totalPages = Math.ceil(total / PER_PAGE);
    if (txPage > totalPages) txPage = Math.max(1, totalPages);
    var start = (txPage - 1) * PER_PAGE;
    var paged = sortedTx.slice(start, start + PER_PAGE);
    
    paged.forEach(function(t) {
        var tr = document.createElement('tr');
        var badgeClass = t.type === 'IN' ? 'stock-badge' : 'stock-badge low';
        var typeLabel = t.type === 'IN' ? '매입' : '출고';
        var checkboxHtml = '<td><input type="checkbox" class="tx-checkbox" value="' + escapeHtml(t.id) + '"></td>';

        // 수정된 부가세 표출 로직 — 항상 순수 단가 * 1.1
        var displayPrice = t.price * (viewWithVat ? 1.1 : 1);
        
        var marginHtml = '-';
        if (t.type === 'OUT' && t.buyPrice) {
            var displayBuy = t.buyPrice * (viewWithVat ? 1.1 : 1);
            if (displayPrice > 0) {
                marginHtml = ((displayPrice - displayBuy) / displayPrice * 100).toFixed(1) + '%';
            } else {
                marginHtml = '0%';
            }
        }

        // 상품명에 컬러/사이즈 표시
        var productDisplay = escapeHtml(t.productName || '-');
        var details = [];
        if (t.color) details.push(escapeHtml(t.color));
        if (t.size) details.push(escapeHtml(t.size));
        if (details.length > 0) {
            productDisplay += ' <span class="tx-detail">(' + details.join(' / ') + ')</span>';
        }

        tr.innerHTML = checkboxHtml +
            '<td>' + escapeHtml(t.txDate || t.timestamp.split('T')[0]) + '</td>' +
            '<td style="text-align: center;"><span class="' + badgeClass + '">' + typeLabel + '</span></td>' +
            '<td>' + escapeHtml(t.supplier || '-') + '</td>' +
            '<td>' + productDisplay + '</td>' +
            '<td>' + t.qty + '</td>' +
            '<td>' + formatCurrency(displayPrice) + '</td>' +
            '<td>' + marginHtml + '</td>' +
            '<td>' + escapeHtml(t.remarks || '') + '</td>' +
            '<td><button class="btn-action" onclick="openTxEditModal(\'' + escapeHtml(t.id) + '\')"><i class="bx bx-edit-alt"></i> 수정</button></td>';
        tbody.appendChild(tr);
    });

    renderPagination('txPagination', txPage, total, PER_PAGE, 'goTxPage');
}

function updateDashboard() {
    var totalQty = products.reduce(function(sum, p) { return sum + p.stock; }, 0);
    var revenueDisplay = totalRevenue * (viewWithVat ? 1.1 : 1);
    var costDisplay = totalCost * (viewWithVat ? 1.1 : 1);
    
    document.getElementById('totalStockCount').textContent = totalQty.toLocaleString();
    document.getElementById('totalRevenue').textContent = formatCurrency(revenueDisplay);
    document.getElementById('totalCost').textContent = formatCurrency(costDisplay);
}

// ==========================================
// 입출고 폼 토글 로직 & 단가 합산
// ==========================================
var formFields = ['fSupplier', 'fBrand', 'fName', 'fColor', 'fSize'];
var outSearchContainer = document.getElementById('outboundSearchContainer');

function toggleFormMode(type) {
    var lblTxPrice = document.getElementById('lblTxPrice');
    var priceCalcRow = document.getElementById('priceCalcRow');
    var freightCalcCol = document.getElementById('freightCalcCol');
    var txPriceInput = document.getElementById('txPrice');

    if (type === 'IN') {
        if(lblTxPrice) lblTxPrice.textContent = '매입단가 (₩)';
        outSearchContainer.classList.add('hidden');
        document.getElementById('outSearchInput').value = '';
        formFields.forEach(function(id) {
            var el = document.getElementById(id);
            if(el) { el.readOnly = false; el.classList.remove('readonly-input'); }
        });
        // 매입 모드: 상품가/운임 표시, 단가는 자동계산 (readonly)
        if(priceCalcRow) priceCalcRow.classList.remove('hidden');
        if(freightCalcCol) freightCalcCol.classList.remove('hidden');
        var sellVatChip = document.getElementById('sellVatChipWrap');
        if(sellVatChip) sellVatChip.classList.add('hidden');
        var outBuyPriceCol = document.getElementById('outBuyPriceCol');
        if(outBuyPriceCol) outBuyPriceCol.classList.add('hidden');
        var outMarginCol = document.getElementById('outMarginCol');
        if(outMarginCol) outMarginCol.classList.add('hidden');
        if(txPriceInput) { 
            txPriceInput.readOnly = true; 
            txPriceInput.classList.add('readonly-input');
            txPriceInput.placeholder = '순수 단가 자동계산 됨';
        }
        document.getElementById('selectedProductId').value = '';
        document.getElementById('transactionForm').reset();
        document.getElementById('typeIn').checked = true;
        setTodayDate();
    } else {
        if(lblTxPrice) lblTxPrice.textContent = '매출단가 (₩)';
        outSearchContainer.classList.remove('hidden');
        formFields.forEach(function(id) {
            var el = document.getElementById(id);
            if(el) { el.readOnly = true; el.classList.add('readonly-input'); }
        });
        // 출고 모드: 상품가/운임 숨김, 단가는 직접 입력
        if(priceCalcRow) priceCalcRow.classList.add('hidden');
        if(freightCalcCol) freightCalcCol.classList.add('hidden');
        if(txPriceInput) { 
            txPriceInput.readOnly = false; 
            txPriceInput.classList.remove('readonly-input');
            txPriceInput.placeholder = '판매가 직접 입력';
        }
        var sellVatChip = document.getElementById('sellVatChipWrap');
        if(sellVatChip) sellVatChip.classList.remove('hidden');
        var outBuyPriceCol = document.getElementById('outBuyPriceCol');
        if(outBuyPriceCol) outBuyPriceCol.classList.remove('hidden');
        var outMarginCol = document.getElementById('outMarginCol');
        if(outMarginCol) outMarginCol.classList.remove('hidden');
        document.getElementById('transactionForm').reset();
        document.getElementById('typeOut').checked = true;
        setTodayDate();
        var sellVatCb = document.getElementById('txSellVat');
        if(sellVatCb) sellVatCb.checked = true;
    }
}

function updateTxPrice() {
    var baseRaw = parseInt(document.getElementById('txBasePrice').value, 10) || 0;
    var freightRaw = parseInt(document.getElementById('txFreight').value, 10) || 0;
    var pureBase = document.getElementById('txBaseVat').checked ? baseRaw : Math.round(baseRaw / 1.1);
    var pureFreight = document.getElementById('txFreightVat').checked ? freightRaw : Math.round(freightRaw / 1.1);
    document.getElementById('txPrice').value = pureBase + pureFreight;
}
// 출고 마진율 자동계산
function calcOutMargin() {
    var sellRaw = parseInt(document.getElementById('txPrice').value, 10) || 0;
    var buyRaw = parseInt(document.getElementById('outBuyPrice').value, 10) || 0;
    var marginDisplay = document.getElementById('outMarginRate');
    if (!marginDisplay) return;
    
    if (sellRaw <= 0 || buyRaw <= 0) {
        marginDisplay.value = '';
        marginDisplay.placeholder = '-';
        return;
    }
    
    // 순수가 변환: 매출단가 VAT포함 체크 시 순수가로
    var isSellVatIncl = document.getElementById('txSellVat') ? document.getElementById('txSellVat').checked : false;
    var pureSell = isSellVatIncl ? Math.round(sellRaw / 1.1) : sellRaw;
    // 매입단가는 항상 순수가로 저장되어 있음
    var pureBuy = buyRaw;
    
    var margin = ((pureSell - pureBuy) / pureSell * 100).toFixed(1);
    marginDisplay.value = margin + '%';
}

// 매출단가 입력 시 마진율 자동계산
document.getElementById('txPrice').addEventListener('input', calcOutMargin);
// VAT 칩 변경 시 마진율 재계산
document.getElementById('txSellVat').addEventListener('change', calcOutMargin);

document.getElementById('txBasePrice').addEventListener('input', updateTxPrice);
document.getElementById('txFreight').addEventListener('input', updateTxPrice);
document.getElementById('txBaseVat').addEventListener('change', updateTxPrice);
document.getElementById('txFreightVat').addEventListener('change', updateTxPrice);

document.querySelectorAll('input[name="txType"]').forEach(function(radio) {
    radio.addEventListener('change', function(e) { toggleFormMode(e.target.value); });
});

function setTodayDate() {
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
}

// ==========================================
// 공통 검색(Autocomplete) 기능
// ==========================================
var currentFocus = -1;

function addActive(x) {
    if (!x) return false;
    removeActive(x);
    if (currentFocus >= x.length) currentFocus = 0;
    if (currentFocus < 0) currentFocus = (x.length - 1);
    x[currentFocus].classList.add("autocomplete-active");
}

function removeActive(x) {
    for (var i = 0; i < x.length; i++) {
        x[i].classList.remove("autocomplete-active");
    }
}

function closeAllLists(elmnt, currentInputObj) {
    var x = document.getElementsByClassName("autocomplete-items");
    for (var i = 0; i < x.length; i++) {
        if (elmnt != x[i] && elmnt != currentInputObj) {
            x[i].parentNode.removeChild(x[i]);
        }
    }
}

document.addEventListener("click", function(e) {
    closeAllLists(e.target);
});

var formHierarchy = [
    {id: 'fSupplier', key: 'supplier'},
    {id: 'fBrand', key: 'brand'},
    {id: 'fName', key: 'name'},
    {id: 'fColor', key: 'color'},
    {id: 'fSize', key: 'size'}
];

function attachGenericAutocomplete(inputId, fieldKey) {
    var inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    
    function showItems(val) {
        closeAllLists(null, inputEl);
        currentFocus = -1;
        
        var a = document.createElement("DIV");
        a.setAttribute("id", inputEl.id + "autocomplete-list");
        a.setAttribute("class", "autocomplete-items");
        inputEl.parentNode.appendChild(a);
        
        var filterConditions = [];
        var currentIndex = formHierarchy.findIndex(function(item) { return item.id === inputId; });
        if (currentIndex > 0) {
            for (var i = 0; i < currentIndex; i++) {
                var prevId = formHierarchy[i].id;
                var prevKey = formHierarchy[i].key;
                var prevVal = document.getElementById(prevId).value.trim();
                if (prevVal) {
                    filterConditions.push({ key: prevKey, val: prevVal });
                }
            }
        }
        
        var seen = {};
        var uniqueValues = [];
        products.forEach(function(p) {
            var isMatch = true;
            for (var i = 0; i < filterConditions.length; i++) {
                var cond = filterConditions[i];
                var pVal = cond.key === 'supplier' ? (p.supplier || '최가유통') : p[cond.key];
                if ((pVal || '') !== cond.val) {
                    isMatch = false;
                    break;
                }
            }
            if (!isMatch) return;
            
            var v = fieldKey === 'supplier' ? (p.supplier || '최가유통') : p[fieldKey];
            if (v && !seen[v]) { seen[v] = true; uniqueValues.push(v); }
        });
        
        var searchTerms = (val || '').toLowerCase().split(' ');
        var count = 0;
        
        uniqueValues.forEach(function(itemVal) {
            var searchText = itemVal.toLowerCase();
            var matchesAll = !val || searchTerms.every(function(term) { return searchText.includes(term); });
            
            if (matchesAll) {
                count++;
                var b = document.createElement("DIV");
                b.textContent = itemVal;
                var hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.value = itemVal;
                b.appendChild(hiddenInput);
                b.addEventListener("click", function() {
                    inputEl.value = this.getElementsByTagName("input")[0].value;
                    var cIdx = formHierarchy.findIndex(function(item) { return item.id === inputId; });
                    if (cIdx !== -1) {
                        for(var idx = cIdx + 1; idx < formHierarchy.length; idx++) {
                            document.getElementById(formHierarchy[idx].id).value = '';
                        }
                    }
                    closeAllLists();
                });
                a.appendChild(b);
            }
        });
        
        if (count === 0) a.parentNode.removeChild(a);
    }

    inputEl.addEventListener("input", function() { 
        showItems(this.value); 
        var cIdx = formHierarchy.findIndex(function(item) { return item.id === inputId; });
        if (cIdx !== -1) {
            for(var idx = cIdx + 1; idx < formHierarchy.length; idx++) {
                document.getElementById(formHierarchy[idx].id).value = '';
            }
        }
    });
    
    inputEl.addEventListener("focus", function() {
        if(this.readOnly) return; 
        if (!document.getElementById(this.id + "autocomplete-list")) {
            showItems(this.value);
        }
    });

    inputEl.addEventListener("keydown", function(e) {
        var x = document.getElementById(this.id + "autocomplete-list");
        if (x) x = x.getElementsByTagName("div");
        if (e.keyCode == 40) { currentFocus++; addActive(x); }
        else if (e.keyCode == 38) { currentFocus--; addActive(x); }
        else if (e.keyCode == 13) { e.preventDefault(); if (currentFocus > -1 && x) x[currentFocus].click(); }
    });
}

attachGenericAutocomplete('fSupplier', 'supplier');
attachGenericAutocomplete('fBrand', 'brand');
attachGenericAutocomplete('fName', 'name');
attachGenericAutocomplete('fColor', 'color');
attachGenericAutocomplete('fSize', 'size');

// ==========================================
// 출고용 연관검색
// ==========================================
var outSearchInput = document.getElementById('outSearchInput');

outSearchInput.addEventListener("input", function() {
    var val = this.value;
    closeAllLists(null, this);
    if (!val) return;
    currentFocus = -1;
    
    var a = document.createElement("DIV");
    a.setAttribute("id", this.id + "autocomplete-list");
    a.setAttribute("class", "autocomplete-items");
    this.parentNode.appendChild(a);
    
    var searchTerms = val.toLowerCase().split(' ');
    
    products.forEach(function(p) {
        var searchText = ((p.supplier || '최가유통') + ' ' + p.brand + ' ' + p.name + ' ' + p.color + ' ' + p.size).toLowerCase();
        var matchesAll = searchTerms.every(function(term) { return searchText.includes(term); });
        
        if (matchesAll) {
            var b = document.createElement("DIV");
            var labelText = '[' + (p.supplier || '최가유통') + '] [' + p.brand + '] ' + p.name + ' - ' + p.color + ' (' + p.size + ') ';
            b.appendChild(document.createTextNode(labelText));
            var stockStrong = document.createElement('strong');
            stockStrong.textContent = '재고:' + p.stock;
            b.appendChild(stockStrong);
            var hiddenInput = document.createElement('input');
            hiddenInput.type = 'hidden';
            hiddenInput.value = p.id;
            b.appendChild(hiddenInput);

            b.addEventListener("click", function() {
                var selectedId = this.getElementsByTagName("input")[0].value;
                var sp = products.find(function(x) { return x.id === selectedId; });
                if (sp) {
                    outSearchInput.value = '[' + sp.brand + '] ' + sp.name;
                    document.getElementById('selectedProductId').value = sp.id;
                    document.getElementById('fSupplier').value = sp.supplier || '최가유통';
                    document.getElementById('fBrand').value = sp.brand;
                    document.getElementById('fName').value = sp.name;
                    document.getElementById('fColor').value = sp.color;
                    document.getElementById('fSize').value = sp.size;
                    document.getElementById('txPrice').value = sp.sellPrice;
                    // 매입단가 자동 표시 및 마진율 계산
                    document.getElementById('outBuyPrice').value = sp.buyPrice || 0;
                    calcOutMargin();
                }
                closeAllLists();
            });
            a.appendChild(b);
        }
    });
});

outSearchInput.addEventListener("keydown", function(e) {
    var x = document.getElementById(this.id + "autocomplete-list");
    if (x) x = x.getElementsByTagName("div");
    if (e.keyCode == 40) { currentFocus++; addActive(x); }
    else if (e.keyCode == 38) { currentFocus--; addActive(x); }
    else if (e.keyCode == 13) { e.preventDefault(); if (currentFocus > -1 && x) x[currentFocus].click(); }
});


// ==========================================
// 폼 서밋 핸들러
// ==========================================
document.getElementById('transactionForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    var qty = parseInt(document.getElementById('txQty').value, 10);
    var priceRaw = parseInt(document.getElementById('txPrice').value, 10);
    var baseRaw = parseInt(document.getElementById('txBasePrice').value, 10) || 0;
    var freightRaw = parseInt(document.getElementById('txFreight').value, 10) || 0;
    var isBaseVatExcluded = document.getElementById('txBaseVat').checked;
    var isFreightVatExcluded = document.getElementById('txFreightVat').checked;
    var isSellVatIncluded = document.getElementById('txSellVat') ? document.getElementById('txSellVat').checked : false;
    
    var basePrice = isBaseVatExcluded ? baseRaw : Math.round(baseRaw / 1.1);
    var freight = isFreightVatExcluded ? freightRaw : Math.round(freightRaw / 1.1);
    
    var txType = document.querySelector('input[name="txType"]:checked').value;
    var price;
    if (txType === 'OUT' && isSellVatIncluded) {
        price = Math.round(priceRaw / 1.1);
    } else {
        price = priceRaw;
    }
    
    // 출고 시 마진율 계산
    var outMarginRate = null;
    var outBuyPriceVal = parseInt(document.getElementById('outBuyPrice').value, 10) || 0;
    if (txType === 'OUT' && price > 0 && outBuyPriceVal > 0) {
        var pureSellForMargin = isSellVatIncluded ? Math.round(priceRaw / 1.1) : priceRaw;
        outMarginRate = parseFloat(((pureSellForMargin - outBuyPriceVal) / pureSellForMargin * 100).toFixed(1));
    }
    
    var txDate = document.getElementById('txDate').value;
    var remarks = document.getElementById('txRemarks').value.trim();
    var type = document.querySelector('input[name="txType"]:checked').value;
    var submitBtn = e.target.querySelector('button[type="submit"]');
    
    if (isNaN(qty) || isNaN(price) || !txDate) {
        showToast('필수 입력값을 확인해주세요.', 'warning');
        return;
    }

    var fSupplier = document.getElementById('fSupplier').value.trim();
    var fBrand = document.getElementById('fBrand').value.trim();
    var fName = document.getElementById('fName').value.trim();
    var fColor = document.getElementById('fColor').value.trim();
    var fSize = document.getElementById('fSize').value.trim();

    if (!fSupplier || !fBrand || !fName || !fColor || !fSize) {
        showToast('모든 상품 정보를 입력해주세요.', 'warning');
        return;
    }

    var originalBtnHTML = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 처리중...";
    
    try {
        await runTransaction(db, async function(transaction) {
            var metricsRef = doc(db, 'kng_data', 'metrics');
            var metricsSnap = await transaction.get(metricsRef);
            if (!metricsSnap.exists()) throw "데이터를 찾을 수 없습니다.";
            var metricsData = metricsSnap.data();

            var targetProductId;
            var currentStock = 0;
            var productName = fName;
            var buyPriceForLog = null;

            if (type === 'OUT') {
                targetProductId = document.getElementById('selectedProductId').value;
                if (!targetProductId) throw "출고할 상품을 검색하여 선택해주세요.";
                
                var prodRef = doc(db, 'kng_products', targetProductId);
                var prodSnap = await transaction.get(prodRef);
                if (!prodSnap.exists()) throw "상품이 존재하지 않습니다.";
                var prodData = prodSnap.data();
                
                if (prodData.stock < qty) throw "현재 재고보다 많은 수량을 출고할 수 없습니다.";
                
                currentStock = prodData.stock - qty;
                productName = prodData.name;
                buyPriceForLog = prodData.buyPrice;

                transaction.update(prodRef, { 
                    stock: currentStock,
                    sellPrice: price 
                });
                
                transaction.update(metricsRef, { 
                    totalRevenue: metricsData.totalRevenue + (qty * price)
                });
            } else if (type === 'IN') {
                var existingProduct = products.find(function(p) {
                    return (p.supplier || '최가유통') === fSupplier && 
                        p.brand === fBrand && 
                        p.name === fName && 
                        p.color === fColor && 
                        p.size === fSize;
                });

                if (existingProduct) {
                    targetProductId = existingProduct.id;
                    var prodRefExist = doc(db, 'kng_products', targetProductId);
                    currentStock = existingProduct.stock + qty;
                    transaction.update(prodRefExist, { 
                        stock: currentStock,
                        buyPrice: price 
                    });
                } else {
                    // Firestore 자동 생성 ID (충돌 방지)
                    var newProdRef = doc(collection(db, 'kng_products'));
                    targetProductId = newProdRef.id;
                    currentStock = qty;
                    transaction.set(newProdRef, {
                        id: targetProductId,
                        supplier: fSupplier,
                        brand: fBrand,
                        name: fName,
                        color: fColor,
                        size: fSize,
                        stock: qty,
                        buyPrice: price,
                        sellPrice: 0 
                    });
                }

                transaction.update(metricsRef, { 
                    totalCost: metricsData.totalCost + (qty * price)
                });
            }
            
            // 트랜잭션 로그 — 컬러/사이즈 포함
            var txLogRef = doc(collection(db, 'kng_transactions'));
            transaction.set(txLogRef, {
                productId: targetProductId,
                productName: productName,
                supplier: fSupplier,
                brand: fBrand,
                color: fColor,
                size: fSize,
                type: type,
                qty: qty,
                price: price,
                basePrice: basePrice,
                freight: freight,
                baseVatExcluded: isBaseVatExcluded,
                freightVatExcluded: isFreightVatExcluded,
                buyPrice: buyPriceForLog,
                margin: outMarginRate,
                txDate: txDate,
                remarks: remarks,
                timestamp: new Date().toISOString()
            });
        });
        
        var actionLabel = type === 'IN' ? '매입' : '출고';
        showToast(actionLabel + ' 내역이 정상 등록되었습니다.', 'success');
        toggleFormMode(type);
        
    } catch (error) {
        showToast("등록 실패: " + error, 'error');
        console.error(error);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHTML;
    }
});


// ==========================================
// 체크박스 전체선택 및 삭제 로직
// ==========================================
document.getElementById('selectAllInv').addEventListener('change', function(e) {
    document.querySelectorAll('.inv-checkbox').forEach(function(cb) { cb.checked = e.target.checked; });
});

document.getElementById('selectAllTx').addEventListener('change', function(e) {
    document.querySelectorAll('.tx-checkbox').forEach(function(cb) { cb.checked = e.target.checked; });
});

// 재고 현황 - 상품 일괄 삭제
document.getElementById('deleteInvBtn').addEventListener('click', async function() {
    var checked = document.querySelectorAll('.inv-checkbox:checked');
    if(checked.length === 0) { showToast('삭제할 상품 항목을 선택해주세요.', 'warning'); return; }
    if(!confirm('선택한 ' + checked.length + '개의 상품을 목록에서 완전히 삭제하시겠습니까?\n해당 상품들의 초기 매입 원가가 총 매입액에서 정산(차감)됩니다.\n(경고: 이 작업은 영구적입니다.)')) return;

    var btn = document.getElementById('deleteInvBtn');
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '삭제 중...';
    btn.disabled = true;

    try {
        await runTransaction(db, async function(transaction) {
            var metricsRef = doc(db, 'kng_data', 'metrics');
            var metricsSnap = await transaction.get(metricsRef);
            if (!metricsSnap.exists()) throw "데이터를 찾을 수 없습니다.";
            var metricsData = metricsSnap.data();

            var prodDocs = [];
            for (var cb of checked) {
                var prodRef = doc(db, 'kng_products', cb.value);
                var prodSnap = await transaction.get(prodRef);
                if (prodSnap.exists()) {
                    prodDocs.push({ ref: prodRef, data: prodSnap.data() });
                }
            }

            var costToRestore = 0;
            for (var item of prodDocs) {
                costToRestore += (item.data.stock * item.data.buyPrice);
                transaction.delete(item.ref);
            }

            transaction.update(metricsRef, { 
                totalCost: Math.max(0, (metricsData.totalCost || 0) - costToRestore)
            });
        });
        document.getElementById('selectAllInv').checked = false;
        showToast(checked.length + '개 상품이 삭제되었습니다.', 'success');
    } catch(e) {
        showToast('삭제 실패: ' + e, 'error');
        console.error(e);
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
});

// 입출고 내역 - 기록 일괄 삭제 및 정산 복구
document.getElementById('deleteTxBtn').addEventListener('click', async function() {
    var checked = document.querySelectorAll('.tx-checkbox:checked');
    if(checked.length === 0) { showToast('삭제할 내역을 하나 이상 선택해주세요.', 'warning'); return; }
    if(!confirm('선택한 ' + checked.length + '개의 내역을 삭제하시겠습니까?\n관련된 상품 재고량과 정산 금액(매출/매입액)이 롤백 복구됩니다.\n(경고: 이 작업은 영구적입니다.)')) return;

    var btn = document.getElementById('deleteTxBtn');
    var oldHtml = btn.innerHTML;
    btn.innerHTML = '삭제 중...';
    btn.disabled = true;

    try {
        await runTransaction(db, async function(transaction) {
            var metricsRef = doc(db, 'kng_data', 'metrics');
            var metricsSnap = await transaction.get(metricsRef);
            if (!metricsSnap.exists()) throw "데이터를 찾을 수 없습니다.";
            var metricsData = metricsSnap.data();
            
            var txDocs = [];
            var stockChanges = {}; 

            for (var cb of checked) {
                var txRef = doc(db, 'kng_transactions', cb.value);
                var txSnap = await transaction.get(txRef);
                if (txSnap.exists()) {
                    var t = txSnap.data();
                    txDocs.push({ ref: txRef, data: t });
                    
                    if(t.type === 'IN') {
                        if(t.productId) stockChanges[t.productId] = (stockChanges[t.productId] || 0) - t.qty;
                    } else if (t.type === 'OUT') {
                        if(t.productId) stockChanges[t.productId] = (stockChanges[t.productId] || 0) + t.qty;
                    }
                }
            }

            var prodDocs = [];
            for (var pid in stockChanges) {
                var prodRef = doc(db, 'kng_products', pid);
                var prodSnap = await transaction.get(prodRef);
                if(prodSnap.exists()) {
                    prodDocs.push({ ref: prodRef, data: prodSnap.data(), pid: pid });
                }
            }

            var revToRestore = 0;
            var costToRestore = 0;

            for (var item of txDocs) {
                var td = item.data;
                if(td.type === 'IN') costToRestore += (td.qty * td.price);
                else if (td.type === 'OUT') revToRestore += (td.qty * td.price);
                transaction.delete(item.ref);
            }

            for (var pItem of prodDocs) {
                var newStock = pItem.data.stock + stockChanges[pItem.pid];
                transaction.update(pItem.ref, { stock: Math.max(0, newStock) });
            }

            transaction.update(metricsRef, { 
                totalRevenue: Math.max(0, (metricsData.totalRevenue || 0) - revToRestore),
                totalCost: Math.max(0, (metricsData.totalCost || 0) - costToRestore)
            });
        });

        document.getElementById('selectAllTx').checked = false;
        showToast(checked.length + '개 내역이 삭제 및 정산 복구되었습니다.', 'success');
    } catch(e) {
        showToast('삭제 실패: ' + e, 'error');
        console.error(e);
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
});


// ==========================================
// 엑셀(CSV) 다운로드 — 부가세 반영
// ==========================================
function downloadCSV(data, filename) {
    if(!data || data.length === 0) { showToast('내보낼 데이터가 없습니다.', 'warning'); return; }
    var csvRows = [];
    var headers = Object.keys(data[0]);
    csvRows.push(headers.join(','));
    
    for (var row of data) {
        var values = headers.map(function(header) {
            var val = ('' + (row[header] || '')).replace(/"/g, '""');
            return '"' + val + '"';
        });
        csvRows.push(values.join(','));
    }
    
    var blob = new Blob(["\uFEFF" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var url = window.URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast(filename + ' 다운로드 완료', 'success');
}

document.getElementById('exportInventoryBtn').addEventListener('click', function() {
    var vatLabel = viewWithVat ? '(부가세포함)' : '(부가세별도)';
    var data = products.map(function(p) {
        var obj = {};
        obj["공급사"] = p.supplier || "최가유통";
        obj["브랜드"] = p.brand;
        obj["상품명"] = p.name;
        obj["컬러"] = p.color;
        obj["사이즈"] = p.size;
        obj["매입단가" + vatLabel] = Math.round(p.buyPrice * (viewWithVat ? 1.1 : 1));
        obj["매출단가" + vatLabel] = Math.round((p.sellPrice || 0) * (viewWithVat ? 1.1 : 1));
        obj["현재재고"] = p.stock;
        obj["재고금액(매입가)" + vatLabel] = Math.round(p.stock * p.buyPrice * (viewWithVat ? 1.1 : 1));
        return obj;
    });
    downloadCSV(data, '재고현황_' + new Date().toISOString().slice(0,10) + '.csv');
});

document.getElementById('exportTransactionsBtn').addEventListener('click', function() {
    var vatLabel = viewWithVat ? '(부가세포함)' : '(부가세별도)';
    var data = transactions.map(function(t) {
        var obj = {};
        obj["일자"] = t.txDate || t.timestamp.split('T')[0];
        obj["구분"] = t.type === 'IN' ? '매입(입고)' : '매출(출고)';
        obj["공급사"] = t.supplier || '-';
        obj["브랜드"] = t.brand || '-';
        obj["상품명"] = t.productName || '-';
        obj["컬러"] = t.color || '-';
        obj["사이즈"] = t.size || '-';
        obj["수량"] = t.qty;
        obj["단가" + vatLabel] = Math.round(t.price * (viewWithVat ? 1.1 : 1));
        obj["비고"] = t.remarks || '';
        return obj;
    });
    downloadCSV(data, '입출고내역_' + new Date().toISOString().slice(0,10) + '.csv');
});

// 검색 기능
document.getElementById('searchInput').addEventListener('input', function(e) {
    invPage = 1;
    renderTable(e.target.value);
});

// ==========================================
// 모바일 메뉴
// ==========================================
function closeMobileMenu() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// ==========================================
// 로그인 및 Auth 상태 추적
// ==========================================
function setupAuth() {
    var loginOverlay = document.getElementById('loginOverlay');
    var mainApp = document.getElementById('mainApp');
    var loginForm = document.getElementById('loginForm');
    var loginError = document.getElementById('loginError');
    var logoutBtn = document.getElementById('logoutBtn');
    
    // Auth Listener
    onAuthStateChanged(auth, function(user) {
        if (user) {
            // Logged in
            if (loginOverlay) loginOverlay.classList.add('hidden');
            if (mainApp) mainApp.classList.remove('hidden');
            initFirebase(); // Initialize bindings ONLY after login
        } else {
            // Logged out
            if (loginOverlay) loginOverlay.classList.remove('hidden');
            if (mainApp) mainApp.classList.add('hidden');
        }
    });

    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var btn = document.getElementById('loginBtn');
            var origText = btn.innerHTML;
            btn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 로그인 중...";
            btn.disabled = true;
            loginError.classList.add('hidden');

            var email = document.getElementById('loginEmail').value;
            var pass = document.getElementById('loginPassword').value;

            signInWithEmailAndPassword(auth, email, pass)
                .then(function() {
                    btn.innerHTML = origText;
                    btn.disabled = false;
                })
                .catch(function(err) {
                    btn.innerHTML = origText;
                    btn.disabled = false;
                    loginError.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
                    loginError.classList.remove('hidden');
                });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            signOut(auth).then(function() {
                location.reload();
            });
        });
    }
}

// ==========================================
// 앱 시작
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    setTodayDate();
    setupAuth();

    // 테이블 검색 이벤트
    var invSearchInput = document.getElementById('invSearchInput');
    var invSearchField = document.getElementById('invSearchField');
    if (invSearchInput) {
        invSearchInput.addEventListener('input', function() { invPage = 1; renderTable(); });
    }
    if (invSearchField) {
        invSearchField.addEventListener('change', function() { invPage = 1; renderTable(); });
    }
    var txSearchInput = document.getElementById('txSearchInput');
    var txSearchField = document.getElementById('txSearchField');
    if (txSearchInput) {
        txSearchInput.addEventListener('input', function() { txPage = 1; renderTransactionsTable(); });
    }
    if (txSearchField) {
        txSearchField.addEventListener('change', function() { txPage = 1; renderTransactionsTable(); });
    }

    // 테이블 정렬 이벤트
    document.querySelectorAll('#invSortHeaders .sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.getAttribute('data-sort');
            if (invSort.col === col) {
                invSort.asc = !invSort.asc;
            } else {
                invSort.col = col;
                invSort.asc = true;
            }
            document.querySelectorAll('#invSortHeaders .sortable').forEach(function(el) {
                el.classList.remove('active', 'asc');
                el.querySelector('i').className = 'bx bx-sort';
            });
            th.classList.add('active');
            if (invSort.asc) th.classList.add('asc');
            th.querySelector('i').className = invSort.asc ? 'bx bx-sort-up' : 'bx bx-sort-down';
            renderTable(document.getElementById('searchInput').value);
        });
    });

    document.querySelectorAll('#txSortHeaders .sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.getAttribute('data-sort');
            if (txSort.col === col) {
                txSort.asc = !txSort.asc;
            } else {
                txSort.col = col;
                txSort.asc = true;
            }
            document.querySelectorAll('#txSortHeaders .sortable').forEach(function(el) {
                el.classList.remove('active', 'asc');
                el.querySelector('i').className = 'bx bx-sort';
            });
            th.classList.add('active');
            if (txSort.asc) th.classList.add('asc');
            th.querySelector('i').className = txSort.asc ? 'bx bx-sort-up' : 'bx bx-sort-down';
            renderTransactionsTable();
        });
    });

    // 부가세 토글 (페이지 새로고침 없이)
    var globalVatBtn = document.getElementById('globalVatBtn');
    if (globalVatBtn) {
        updateVatButtonUI(globalVatBtn);
        
        globalVatBtn.addEventListener('click', function() {
            viewWithVat = !viewWithVat;
            localStorage.setItem('viewWithVat', String(viewWithVat));
            updateVatButtonUI(globalVatBtn);
            renderTable(document.getElementById('searchInput').value);
            renderTransactionsTable();
            updateDashboard();
            var sellVatCb = document.getElementById('txSellVat');
            if (sellVatCb) sellVatCb.checked = viewWithVat;
            showToast(viewWithVat ? '부가세 포함 표출로 전환' : '부가세 별도 표출로 전환', 'info');
        });
    }

    // ==========================================
    // 포털 사이드바 네비게이션 (internal + iframe)
    // ==========================================
    var iframeContainer = document.getElementById('iframeContainer');
    var appIframe = document.getElementById('appIframe');
    var internalPages = document.getElementById('internalPages');
    var topbarPageTitle = document.getElementById('topbarPageTitle');
    var searchWrap = document.getElementById('searchWrap');
    var globalVatBtn = document.getElementById('globalVatBtn');

    /** 내부 페이지 모드로 전환 — 선택한 섹션만 표시 */
    var internalSections = ['dashboard', 'forms', 'inventory', 'transactions'];

    function showInternalView(href, label) {
        // iframe 숨기고 내부 페이지 표시
        if (iframeContainer) iframeContainer.classList.add('hidden');
        if (appIframe) appIframe.src = 'about:blank';
        if (internalPages) internalPages.style.display = '';

        // 모든 내부 섹션 숨기기
        internalSections.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // 선택한 섹션만 표시
        var targetId = href.replace('#', '');
        var targetEl = document.getElementById(targetId);
        if (targetEl) targetEl.style.display = '';

        // dashboard 클릭 시 KPI strip도 함께 표시
        if (targetId === 'dashboard') {
            // dashboard는 kpi-strip이므로 바로 표시됨
        }

        // 검색바 / VAT 버튼: 재고 관련 페이지에서만 표시
        var showControls = ['forms', 'inventory', 'transactions'].indexOf(targetId) !== -1;
        if (searchWrap) searchWrap.style.display = showControls ? '' : 'none';
        if (globalVatBtn) globalVatBtn.style.display = showControls ? '' : 'none';

        // 페이지 타이틀 업데이트
        if (topbarPageTitle) topbarPageTitle.textContent = label || '요약정보';

        // 스크롤 맨 위로
        if (internalPages) internalPages.scrollTo({ top: 0, behavior: 'smooth' });
    }

    /** iframe 모드로 전환 */
    function showIframeView(src, label) {
        // 내부 페이지 숨기고 iframe 표시
        if (internalPages) internalPages.style.display = 'none';
        if (iframeContainer) iframeContainer.classList.remove('hidden');
        // embed 파라미터 추가 — 서브앱이 포털 내 임베드 모드를 감지할 수 있도록
        var embedSrc = src + (src.indexOf('?') === -1 ? '?embed=true' : '&embed=true');
        if (appIframe) appIframe.src = embedSrc;

        // 검색바 / VAT 버튼 숨김 (외부 앱에서는 불필요)
        if (searchWrap) searchWrap.style.display = 'none';
        if (globalVatBtn) globalVatBtn.style.display = 'none';

        // 페이지 타이틀 업데이트
        if (topbarPageTitle) topbarPageTitle.textContent = label || '';
    }

    // 모든 메뉴 링크에 클릭 핸들러 연결
    document.querySelectorAll('.menu a[data-nav]').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            var navType = link.getAttribute('data-nav');
            var href = link.getAttribute('href');
            var label = link.querySelector('span') ? link.querySelector('span').textContent : '';

            // active 상태 업데이트
            document.querySelectorAll('.menu a').forEach(function(a) { a.classList.remove('active'); });
            link.classList.add('active');

            if (navType === 'iframe') {
                showIframeView(href, label);
            } else {
                showInternalView(href, label);
            }

            closeMobileMenu();
        });
    });

    // 모바일 햄버거 메뉴
    var hamburgerBtn = document.getElementById('hamburgerBtn');
    var sidebarOverlay = document.getElementById('sidebarOverlay');
    var sidebar = document.getElementById('sidebar');

    if (hamburgerBtn && sidebar) {
        hamburgerBtn.addEventListener('click', function() {
            sidebar.classList.toggle('open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('active');
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeMobileMenu);
    }

    // 아코디언 메뉴 토글 (모든 menu-group에 범용 적용)
    document.querySelectorAll('.menu-group-toggle').forEach(function(toggle) {
        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            var group = toggle.closest('.menu-group');
            if (group) group.classList.toggle('open');
        });
    });
});

// ==========================================
// 트랜잭션 수정 팝업 기능
// ==========================================
window.openTxEditModal = async function(txId) {
    var t = transactions.find(function(item) { return item.id === txId; });
    if (!t) return;
    
    document.getElementById('eTxId').value = t.id;
    document.getElementById('eProductId').value = t.productId;
    document.getElementById('eTxDate').value = t.txDate || t.timestamp.split('T')[0];
    document.getElementById('eTxType').value = t.type === 'IN' ? '매입 (IN)' : '출고 (OUT)';
    document.getElementById('eSupplier').value = t.supplier || '';
    document.getElementById('eBrand').value = t.brand || '';
    document.getElementById('eName').value = t.productName || '';
    document.getElementById('eColor').value = t.color || '';
    document.getElementById('eSize').value = t.size || '';
    document.getElementById('eQty').value = t.qty || 0;
    document.getElementById('eBasePrice').value = t.basePrice || 0;
    document.getElementById('eFreight').value = t.freight || 0;
    document.getElementById('eBaseVat').checked = t.baseVatExcluded !== false;
    document.getElementById('eFreightVat').checked = t.freightVatExcluded !== false;
    
    var isOut = t.type === 'OUT';
    var eSellVat = document.getElementById('eSellVat');
    var eSellVatWrap = document.getElementById('eSellVatWrap');
    var eOutExtraRow = document.getElementById('eOutExtraRow');
    
    if (isOut) {
        document.getElementById('ePrice').value = t.price || 0;
        eSellVatWrap.classList.remove('hidden');
        eSellVat.checked = true; // default to true in form logic, adapt as needed
        eOutExtraRow.classList.remove('hidden');
        document.getElementById('eOutBuyPrice').value = t.buyPrice || 0;
        document.getElementById('eOutMarginRate').value = t.margin !== undefined && t.margin !== null ? t.margin + '%' : '-';
        document.getElementById('eLblTxPrice').textContent = '매출단가 (₩)';
    } else {
        document.getElementById('ePrice').value = t.price || 0;
        eSellVatWrap.classList.add('hidden');
        eOutExtraRow.classList.add('hidden');
        document.getElementById('eLblTxPrice').textContent = '매입단가 (₩)';
    }
    
    document.getElementById('eRemarks').value = t.remarks || '';
    
    document.getElementById('txEditModal').classList.add('active');
};

document.getElementById('closeTxEditModalBtn').addEventListener('click', closeTxEditModal);
document.getElementById('cancelTxEditBtn').addEventListener('click', closeTxEditModal);

function closeTxEditModal() {
    document.getElementById('txEditForm').reset();
    document.getElementById('txEditModal').classList.remove('active');
}

// 자동완성 붙이기 (모달)
attachGenericAutocomplete('eSupplier', 'supplier');
attachGenericAutocomplete('eBrand', 'brand');
attachGenericAutocomplete('eName', 'name');
attachGenericAutocomplete('eColor', 'color');
attachGenericAutocomplete('eSize', 'size');

function updateETxPrice() {
    var b = parseInt(document.getElementById('eBasePrice').value, 10) || 0;
    var f = parseInt(document.getElementById('eFreight').value, 10) || 0;
    var bv = document.getElementById('eBaseVat').checked;
    var fv = document.getElementById('eFreightVat').checked;
    var finalB = bv ? b : Math.round(b / 1.1);
    var finalF = fv ? f : Math.round(f / 1.1);
    document.getElementById('ePrice').value = finalB + finalF;
}

document.getElementById('eBasePrice').addEventListener('input', updateETxPrice);
document.getElementById('eFreight').addEventListener('input', updateETxPrice);
document.getElementById('eBaseVat').addEventListener('change', updateETxPrice);
document.getElementById('eFreightVat').addEventListener('change', updateETxPrice);

// 팝업 폼 제출(수정 처리)
document.getElementById('txEditForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    var txId = document.getElementById('eTxId').value;
    var origTx = transactions.find(function(t) { return t.id === txId; });
    if (!origTx) return;

    var newQty = parseInt(document.getElementById('eQty').value, 10);
    var newPriceRaw = parseInt(document.getElementById('ePrice').value, 10);
    var isSellVat = document.getElementById('eSellVat').checked;
    
    var type = origTx.type; // Read-only
    var newPrice = type === 'OUT' && isSellVat ? Math.round(newPriceRaw / 1.1) : newPriceRaw;
    
    var fSupplier = document.getElementById('eSupplier').value.trim();
    var fBrand = document.getElementById('eBrand').value.trim();
    var fName = document.getElementById('eName').value.trim();
    var fColor = document.getElementById('eColor').value.trim();
    var fSize = document.getElementById('eSize').value.trim();
    
    var submitBtn = document.getElementById('saveTxEditBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = "<i class='bx bx-loader-alt bx-spin'></i> 저장중...";
    
    try {
        await runTransaction(db, async function(transaction) {
            // ============================
            // PHASE 1: ALL READS FIRST
            // ============================
            var txRef = doc(db, 'kng_transactions', txId);
            var txSnap = await transaction.get(txRef);
            if (!txSnap.exists()) throw "트랜잭션을 찾을 수 없습니다.";
            
            var metricsRef = doc(db, 'kng_data', 'metrics');
            var metricsSnap = await transaction.get(metricsRef);
            var metricsData = metricsSnap.exists() ? metricsSnap.data() : { totalRevenue: 0, totalCost: 0 };
            
            var oldProdRef = doc(db, 'kng_products', origTx.productId);
            var oldProdSnap = await transaction.get(oldProdRef);
            
            // Determine new product and pre-read it
            var targetProd = null;
            var newProductId = origTx.productId;
            var newProdRef = null;
            var newProdSnap = null;
            var buyPriceForLog = null;
            var newProdName = fName;
            var isNewProduct = false;
            
            if (type === 'OUT') {
                targetProd = products.find(function(p) { return p.brand === fBrand && p.name === fName && p.color === fColor && p.size === fSize; });
                if (!targetProd) throw "변경된 정보와 일치하는 상품이 없습니다.";
                newProductId = targetProd.id;
                newProdName = targetProd.name;
                buyPriceForLog = targetProd.buyPrice;
                
                if (newProductId !== origTx.productId) {
                    newProdRef = doc(db, 'kng_products', newProductId);
                    newProdSnap = await transaction.get(newProdRef);
                }
            } else {
                targetProd = products.find(function(p) { return p.brand === fBrand && p.name === fName && p.color === fColor && p.size === fSize && p.supplier === fSupplier; });
                if (targetProd) {
                    newProductId = targetProd.id;
                    if (newProductId !== origTx.productId) {
                        newProdRef = doc(db, 'kng_products', newProductId);
                        newProdSnap = await transaction.get(newProdRef);
                    }
                } else {
                    isNewProduct = true;
                }
            }
            
            // ============================
            // PHASE 2: ALL WRITES AFTER
            // ============================
            
            // 1. REVERT old transaction metrics
            var revertRevenue = 0;
            var revertCost = 0;
            if (type === 'OUT') {
                revertRevenue = origTx.qty * origTx.price;
            } else {
                revertCost = origTx.qty * origTx.price;
            }
            
            // Revert old product stock
            var newOldStock = 0;
            if (oldProdSnap.exists()) {
                var oldProdData = oldProdSnap.data();
                newOldStock = oldProdData.stock + (type === 'OUT' ? origTx.qty : -origTx.qty);
                transaction.update(oldProdRef, { stock: newOldStock });
            }
            
            // 2. APPLY new transaction
            var applyRevenue = 0;
            var applyCost = 0;
            
            if (type === 'OUT') {
                applyRevenue = newQty * newPrice;
                
                // Use oldProdSnap if same product, otherwise use newProdSnap
                var prodSnapToUse = (newProductId === origTx.productId) ? oldProdSnap : newProdSnap;
                var prodRefToUse = (newProductId === origTx.productId) ? oldProdRef : newProdRef;
                
                if (prodSnapToUse && prodSnapToUse.exists()) {
                    var npData = prodSnapToUse.data();
                    var updatedStock = (newProductId === origTx.productId) ? (newOldStock - newQty) : (npData.stock - newQty);
                    if (updatedStock < 0) throw "출고 수량이 재고 수량을 초과합니다.";
                    transaction.update(prodRefToUse, { stock: updatedStock, sellPrice: newPrice });
                }
            } else {
                applyCost = newQty * newPrice;
                
                if (!isNewProduct) {
                    var prodSnapToUse = (newProductId === origTx.productId) ? oldProdSnap : newProdSnap;
                    var prodRefToUse = (newProductId === origTx.productId) ? oldProdRef : newProdRef;
                    
                    if (prodSnapToUse && prodSnapToUse.exists()) {
                        var npData = prodSnapToUse.data();
                        var updatedStock = (newProductId === origTx.productId) ? (newOldStock + newQty) : (npData.stock + newQty);
                        transaction.update(prodRefToUse, { stock: updatedStock, buyPrice: newPrice });
                    }
                } else {
                    var freshRef = doc(collection(db, 'kng_products'));
                    newProductId = freshRef.id;
                    transaction.set(freshRef, {
                        id: newProductId,
                        supplier: fSupplier,
                        brand: fBrand,
                        name: fName,
                        color: fColor,
                        size: fSize,
                        stock: newQty,
                        buyPrice: newPrice,
                        sellPrice: 0 
                    });
                }
            }
            
            var mRev = metricsData.totalRevenue - revertRevenue + applyRevenue;
            var mCost = metricsData.totalCost - revertCost + applyCost;
            transaction.update(metricsRef, { totalRevenue: mRev, totalCost: mCost });
            
            // 3. UPDATE transaction doc
            var outMarginRate = null;
            if (type === 'OUT' && newPrice > 0 && buyPriceForLog > 0) {
                 var pureSell = isSellVat ? Math.round(newPriceRaw / 1.1) : newPriceRaw;
                 outMarginRate = parseFloat(((pureSell - buyPriceForLog) / pureSell * 100).toFixed(1));
            } else if (type === 'OUT') {
                 outMarginRate = parseFloat(document.getElementById('eOutMarginRate').value) || 0;
            }
            
            transaction.update(txRef, {
                productId: newProductId,
                productName: newProdName,
                supplier: fSupplier,
                brand: fBrand,
                color: fColor,
                size: fSize,
                qty: newQty,
                price: newPrice,
                basePrice: parseInt(document.getElementById('eBasePrice').value, 10) || 0,
                freight: parseInt(document.getElementById('eFreight').value, 10) || 0,
                baseVatExcluded: document.getElementById('eBaseVat').checked,
                freightVatExcluded: document.getElementById('eFreightVat').checked,
                buyPrice: buyPriceForLog !== null ? buyPriceForLog : origTx.buyPrice,
                margin: outMarginRate,
                txDate: document.getElementById('eTxDate').value,
                remarks: document.getElementById('eRemarks').value.trim()
            });
        });
        
        showToast('내역 업데이트 완료', 'success');
        closeTxEditModal();
    } catch(err) {
        showToast('내역 갱신 실패: ' + err, 'error');
        console.error(err);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = "<i class='bx bx-save'></i> 내역 수정하기";
    }
});
