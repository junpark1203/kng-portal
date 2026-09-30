/**
 * KNG ERP 견적서 관리 (Quotation) 프론트엔드 엔진
 * - 견적 바구니(Quote Cart) 연동 (본사 재고 / 셀러K / 입출고 내역 품목 담기)
 * - 품목별 고해상도 사진 첨부 (파일 업로드 & Ctrl+V 붙여넣기 지원)
 * - 정규 A4 인쇄 / PDF 최적화 및 대표 직인 도장 날인
 * - 과거 견적서 이력 보관함 & 복사 재발행(Re-Quote) 지원
 */

// --- 서버 URL 및 API 설정 ---
const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://kng.junparks.com';

const API_BASE = `${SERVER_URL}/api/quotations`;
const API_BASE_HQ = `${SERVER_URL}/api/hq`;
const API_BASE_SELLER_K = `${SERVER_URL}/api/seller-k/products`;

// --- authFetch 래퍼 (KNG ERP 표준 - 부모 창 토큰 연동) ---
async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 3) {
                await new Promise(r => setTimeout(r, 150));
                token = await window.parent.getAuthToken();
                retries++;
            }
        }
    } catch (e) {}

    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }

    const targetUrl = (url.startsWith('/api/')) ? `${SERVER_URL}${url}` : url;
    return fetch(targetUrl, options);
}

// ==========================================
// 유틸리티
// ==========================================
function fmtWon(n) {
    return '₩' + new Intl.NumberFormat('ko-KR').format(Math.round(n || 0));
}

function fmtNum(n) {
    return new Intl.NumberFormat('ko-KR').format(n || 0);
}

function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${escHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// 한글 금액 변환기 (예: 13,500,000 -> 일천삼백오십만원정)
function numberToKorean(number) {
    const num = Math.round(Number(number) || 0);
    if (num === 0) return '일금 영원정';

    const units = ['', '만', '억', '조'];
    const smallUnits = ['', '십', '백', '천'];
    const digits = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];

    let result = '';
    let unitIdx = 0;
    let temp = num;

    while (temp > 0) {
        const part = temp % 10000;
        if (part > 0) {
            let partStr = '';
            let p = part;
            for (let i = 0; i < 4; i++) {
                const d = p % 10;
                if (d > 0) {
                    partStr = digits[d] + smallUnits[i] + partStr;
                }
                p = Math.floor(p / 10);
            }
            result = partStr + units[unitIdx] + ' ' + result;
        }
        temp = Math.floor(temp / 10000);
        unitIdx++;
    }

    return '일금 ' + result.trim() + '원정';
}

// ==========================================
// 애플리케이션 메인 엔진
// ==========================================
const app = {
    currentView: 'list', // 'list' | 'editor'
    quotations: [],
    currentQuote: null,
    editingItemIndexForImage: null,
    savedSnapshot: null,
    isDirty: false,

    // 공급자 기본 설정 (거래명세서 표준 100% 일치)
    supplierSettings: {
        name: '주식회사 케이엔지',
        bizNum: '845-88-00551',
        ceo: '윤종',
        address: '서울시 강동구 구천면로 159, 1층 2호, 3호',
        bizType: '도소매/임대업',
        bizItem: '건설자재, 용품외',
        tel: '031-987-1203',
        email: 'contact@junparks.com',
        bank: '기업은행 123-456789-01-012 (예금주: 주식회사 케이엔지)',
        sealUrl: '../../assets/images/stamp.png'
    },

    // 품목 불러오기 모달 캐시
    importData: {
        source: 'hq',
        items: []
    },

    init: function() {
        this.loadSupplierSettings();
        this.checkQuoteCart();
        this.fetchQuotations();
        this.setupKeyboardShortcuts();
        this.setupImageDropzone();
        this.setupUnsavedChangesProtection();

        // 윈도우 포커스 시 견적 바구니 갱신 체크
        window.addEventListener('focus', () => {
            this.checkQuoteCart();
        });
    },

    // ── 미저장 변경사항 보호 엔진 ──
    setupUnsavedChangesProtection: function() {
        const editorView = document.getElementById('quotationEditorView');
        if (editorView) {
            editorView.addEventListener('input', () => { this.isDirty = true; });
            editorView.addEventListener('change', () => { this.isDirty = true; });
        }

        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges()) {
                e.preventDefault();
                e.returnValue = '작성 중이거나 변경된 견적서가 저장되지 않았습니다. 페이지를 벗어나시겠습니까?';
                return e.returnValue;
            }
        });

        window.hasUnsavedChanges = () => this.hasUnsavedChanges();
    },

    getFormSnapshot: function() {
        const getVal = (id) => document.getElementById(id)?.value?.trim() || '';
        const items = (this.currentQuote?.items || []).map(it => ({
            name: it.product_name || '',
            spec: it.spec || '',
            qty: Number(it.qty) || 0,
            unit: it.unit || '',
            price: Number(it.unit_price) || 0,
            remarks: it.remarks || '',
            img: it.image_url || ''
        }));

        const rows = document.querySelectorAll('#quoteItemsTbody tr[data-index]');
        rows.forEach(tr => {
            const idx = parseInt(tr.dataset.index, 10);
            if (items[idx]) {
                const nameEl = tr.querySelector('input[placeholder*="품목명"]');
                const specEl = tr.querySelector('input[placeholder*="규격"]');
                const qtyEl = tr.querySelector('input[type="number"]');
                const unitEl = tr.querySelector('input[style*="width:45px"]') || tr.querySelectorAll('input[type="text"]')[2];
                const priceEl = tr.querySelector('input.text-end.fw-bold.text-primary') || tr.querySelectorAll('input[type="number"]')[1];
                const remarksEl = tr.querySelector('input[placeholder*="비고"]');

                if (nameEl) items[idx].name = nameEl.value.trim();
                if (specEl) items[idx].spec = specEl.value.trim();
                if (qtyEl) items[idx].qty = Number(qtyEl.value) || 0;
                if (unitEl) items[idx].unit = unitEl.value.trim();
                if (priceEl) items[idx].price = Number(priceEl.value) || 0;
                if (remarksEl) items[idx].remarks = remarksEl.value.trim();
            }
        });

        return JSON.stringify({
            id: document.getElementById('quoteId')?.value?.trim() || '',
            custName: getVal('custName'),
            custAttn: getVal('custAttn'),
            custTel: getVal('custTel'),
            custEmail: getVal('custEmail'),
            projectName: getVal('projectName'),
            issueDate: getVal('issueDate'),
            validUntil: getVal('validUntil'),
            deliveryDate: getVal('deliveryDate'),
            deliveryPlace: getVal('deliveryPlace'),
            paymentTerms: getVal('paymentTerms'),
            status: getVal('quoteStatus'),
            vatType: getVal('vatTypeSelect'),
            notes: getVal('notesInstructions'),
            showImages: document.getElementById('optShowImages')?.checked ? 1 : 0,
            includeSeal: document.getElementById('optIncludeSeal')?.checked ? 1 : 0,
            items: items
        });
    },

    hasUnsavedChanges: function() {
        if (this.currentView !== 'editor') return false;
        if (!this.savedSnapshot) return false;

        const currentSnapStr = this.getFormSnapshot();
        if (currentSnapStr === this.savedSnapshot) return false;

        try {
            const snap = JSON.parse(currentSnapStr);
            if (!snap.id && !snap.custName && snap.items.length === 0) {
                return false;
            }
        } catch(e) {}

        return true;
    },

    // ── 공급자 설정 로드 & 반영 ──
    loadSupplierSettings: function() {
        try {
            const saved = localStorage.getItem('kng_quote_supplier_settings');
            if (saved) {
                this.supplierSettings = Object.assign({}, this.supplierSettings, JSON.parse(saved));
            }
        } catch(e) {}
        this.applySupplierDisplay();
    },

    applySupplierDisplay: function() {
        const s = this.supplierSettings;
        if (document.getElementById('dispSupplierName')) document.getElementById('dispSupplierName').textContent = s.name;
        if (document.getElementById('dispSupplierBizNum')) document.getElementById('dispSupplierBizNum').textContent = s.bizNum;
        if (document.getElementById('dispSupplierCeo')) document.getElementById('dispSupplierCeo').textContent = s.ceo;
        if (document.getElementById('dispSupplierAddress')) document.getElementById('dispSupplierAddress').textContent = s.address;
        if (document.getElementById('dispSupplierTel')) document.getElementById('dispSupplierTel').textContent = s.tel;
        if (document.getElementById('dispSupplierEmail')) document.getElementById('dispSupplierEmail').textContent = s.email;
        if (document.getElementById('dispSupplierBank')) document.getElementById('dispSupplierBank').textContent = s.bank;
        if (document.getElementById('dispSupplierStamp') && s.sealUrl) {
            document.getElementById('dispSupplierStamp').src = s.sealUrl;
        }
    },

    // ── 뷰 모드 전환 ──
    switchView: function(view, force = false) {
        if (view === 'list') {
            if (!force && this.currentView === 'editor' && this.hasUnsavedChanges()) {
                if (!confirm('작성 중이거나 변경된 견적서가 저장되지 않았습니다.\n목록으로 이동하시겠습니까? (저장하지 않은 내용은 사라집니다)')) {
                    return;
                }
            }
        }

        this.currentView = view;
        const listView = document.getElementById('quotationListView');
        const editorView = document.getElementById('quotationEditorView');
        const btnList = document.getElementById('btnViewList');
        const btnEditor = document.getElementById('btnViewEditor');
        const editorActions = document.getElementById('editorActionBtns');
        const listActions = document.getElementById('listActionBtns');

        if (view === 'list') {
            listView.classList.remove('d-none');
            editorView.classList.add('d-none');
            btnList.classList.add('active');
            btnEditor.classList.remove('active');
            editorActions.classList.add('d-none');
            listActions.classList.remove('d-none');
            this.fetchQuotations();
        } else {
            listView.classList.add('d-none');
            editorView.classList.remove('d-none');
            btnList.classList.remove('active');
            btnEditor.classList.add('active');
            editorActions.classList.remove('d-none');
            listActions.classList.add('d-none');
            if (!this.currentQuote) {
                this.initNewQuotation(true);
            }
        }
    },

    // ── 견적 바구니 (Quote Cart) 감지 & 배지 갱신 ──
    checkQuoteCart: function() {
        try {
            const raw = localStorage.getItem('kng_quote_cart');
            const cartItems = raw ? JSON.parse(raw) : [];
            const badgeBtn = document.getElementById('btnQuoteCartBadge');
            const badgeCount = document.getElementById('cartCountBadge');

            if (cartItems.length > 0) {
                if (badgeBtn) badgeBtn.classList.remove('d-none');
                if (badgeCount) badgeCount.textContent = cartItems.length;
            } else {
                if (badgeBtn) badgeBtn.classList.add('d-none');
            }
        } catch(e) {}
    },

    // 바구니에 담긴 품목으로 새 견적서 열기
    loadFromCartAndEdit: function() {
        try {
            const raw = localStorage.getItem('kng_quote_cart');
            const cartItems = raw ? JSON.parse(raw) : [];
            if (cartItems.length === 0) {
                showToast('견적 바구니가 비어 있습니다.', 'warning');
                return;
            }

            this.initNewQuotation();
            this.currentQuote.items = cartItems.map((item, idx) => ({
                id: 'qi_' + Date.now() + '_' + idx,
                seq: idx + 1,
                source_module: item.source_module || 'cart',
                source_id: item.source_id || '',
                product_name: item.product_name || '',
                spec: item.spec || '',
                color: item.color || '',
                unit: item.unit || 'EA',
                qty: Number(item.qty) || 1,
                cost_price: Number(item.cost_price) || 0,
                unit_price: Number(item.unit_price) || 0,
                supply_price: (Number(item.qty) || 1) * (Number(item.unit_price) || 0),
                vat: 0,
                total_price: (Number(item.qty) || 1) * (Number(item.unit_price) || 0),
                image_url: item.image_url || '',
                remarks: item.remarks || ''
            }));

            // 바구니 비우기
            localStorage.removeItem('kng_quote_cart');
            this.checkQuoteCart();

            this.switchView('editor');
            this.renderEditorItems();
            this.recalcTotals();
            showToast(`${cartItems.length}개 품목을 견적서에 성공적으로 불러왔습니다!`, 'success');
        } catch(e) {
            showToast('바구니 품목 불러오기 실패: ' + e.message, 'error');
        }
    },

    // ── 신규 견적서 폼 초기화 ──
    initNewQuotation: function(force = false) {
        if (!force && this.hasUnsavedChanges()) {
            if (!confirm('현재 작성 중이거나 변경된 내용이 저장되지 않았습니다.\n입력 내용을 비우고 새로 작성하시겠습니까?')) {
                return;
            }
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const validDate = new Date();
        validDate.setDate(validDate.getDate() + 15);
        const validStr = validDate.toISOString().split('T')[0];

        this.currentQuote = {
            id: '',
            quote_number: '',
            issue_date: todayStr,
            valid_until: validStr,
            customer_name: '',
            customer_attn: '',
            customer_tel: '',
            customer_email: '',
            project_name: '',
            delivery_date: '발주 후 3일 이내',
            delivery_place: '지정 장소 도착도',
            payment_terms: '납품 후 익월 말일 현금결제',
            include_seal: 1,
            show_images: 1,
            vat_type: 'exclusive',
            total_supply_price: 0,
            total_vat: 0,
            total_amount: 0,
            notes_instructions: '1. 상기 견적금액은 부가세(VAT) 별도 기준입니다.\n2. 견적 유효기간은 견적일로부터 15일간 유효합니다.\n3. 사양 및 수량 변경 시 견적단가가 변동될 수 있습니다.',
            status: '작성중',
            items: []
        };

        this.bindEditorFields();
        this.renderEditorItems();
        this.recalcTotals();

        // 초기 스냅샷 기록 (신규 상태)
        this.savedSnapshot = this.getFormSnapshot();
        this.isDirty = false;
    },

    bindEditorFields: function() {
        const q = this.currentQuote;
        document.getElementById('quoteId').value = q.id || '';
        document.getElementById('badgeQuoteNumber').textContent = q.quote_number || '신규 자동 채번';
        document.getElementById('custName').value = q.customer_name || '';
        document.getElementById('custAttn').value = q.customer_attn || '';
        document.getElementById('custTel').value = q.customer_tel || '';
        document.getElementById('custEmail').value = q.customer_email || '';
        document.getElementById('projectName').value = q.project_name || '';
        document.getElementById('issueDate').value = q.issue_date || '';
        document.getElementById('validUntil').value = q.valid_until || '';
        document.getElementById('deliveryDate').value = q.delivery_date || '';
        document.getElementById('deliveryPlace').value = q.delivery_place || '';
        document.getElementById('paymentTerms').value = q.payment_terms || '';
        document.getElementById('quoteStatus').value = q.status || '작성중';
        document.getElementById('vatTypeSelect').value = q.vat_type || 'exclusive';
        document.getElementById('notesInstructions').value = q.notes_instructions || '';
        document.getElementById('optShowImages').checked = (q.show_images !== 0);
        document.getElementById('optIncludeSeal').checked = (q.include_seal !== 0);
        this.toggleImageColumn(q.show_images !== 0);
    },

    // ── 견적서 보관함 목록 조회 (API 및 로컬 보관함 동기화) ──
    fetchQuotations: function() {
        // [무한로딩 방지] 서버 응답 전 로컬 캐시를 0초 만에 즉시 렌더링
        let cachedQuotes = [];
        try {
            cachedQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
        } catch(e) {}
        if (cachedQuotes.length > 0 || this.quotations.length === 0) {
            this.quotations = cachedQuotes;
            this.renderQuoteList();
            const badge = document.getElementById('quoteTotalCountBadge');
            const summary = document.getElementById('listSummaryText');
            if (badge) badge.textContent = this.quotations.length;
            if (summary) summary.textContent = `총 ${this.quotations.length}건 조회됨`;
        }

        const keyword = document.getElementById('searchKeyword')?.value.trim().toLowerCase() || '';
        const startDate = document.getElementById('filterStartDate')?.value || '';
        const endDate = document.getElementById('filterEndDate')?.value || '';
        const status = document.querySelector('#statusFilterGroup .erp-filter-chip.active')?.getAttribute('data-status') || document.querySelector('#statusFilterGroup .erp-filter-chip.active')?.dataset?.status || 'all';

        let url = `${API_BASE}?`;
        if (keyword) url += `keyword=${encodeURIComponent(keyword)}&`;
        if (status && status !== 'all') url += `status=${encodeURIComponent(status)}&`;
        if (startDate) url += `startDate=${startDate}&`;
        if (endDate) url += `endDate=${endDate}&`;

        authFetch(url)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(data => {
                this.quotations = Array.isArray(data) ? data : [];
                // 서버 정상 응답 시 로컬 캐시 갱신
                try {
                    localStorage.setItem('kng_quotations_cache', JSON.stringify(this.quotations));
                } catch(e) {}
                this.renderQuoteList();
                document.getElementById('quoteTotalCountBadge').textContent = this.quotations.length;
                document.getElementById('listSummaryText').textContent = `총 ${this.quotations.length}건 조회됨`;
            })
            .catch(err => {
                console.warn('견적서 서버 조회 불가, 로컬 캐시 및 보관함 조회:', err);
                let localQuotes = [];
                try {
                    localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
                } catch(e) {}

                // 필터링 적용
                if (keyword || status !== 'all' || startDate || endDate) {
                    localQuotes = localQuotes.filter(q => {
                        if (status !== 'all' && q.status !== status) return false;
                        if (startDate && q.issue_date && q.issue_date < startDate) return false;
                        if (endDate && q.issue_date && q.issue_date > endDate) return false;
                        if (keyword) {
                            const match = (q.customer_name || '').toLowerCase().includes(keyword) ||
                                          (q.project_name || '').toLowerCase().includes(keyword) ||
                                          (q.quote_number || '').toLowerCase().includes(keyword);
                            if (!match) return false;
                        }
                        return true;
                    });
                }

                this.quotations = localQuotes;
                this.renderQuoteList();
                document.getElementById('quoteTotalCountBadge').textContent = this.quotations.length;
                document.getElementById('listSummaryText').textContent = `총 ${this.quotations.length}건 조회됨`;
            });
    },

    renderQuoteList: function() {
        const tbody = document.getElementById('quoteListTbody');
        if (!tbody) return;

        if (this.quotations.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">
                <i class='bx bx-folder-open fs-3 text-secondary'></i>
                <div class="mt-2 fw-semibold" style="font-size: 13px;">등록된 견적서가 없습니다.</div>
                <div class="small text-muted mt-1">상단 <button type="button" class="btn-erp btn-erp-primary py-0 px-2" style="height:22px; font-size:10.5px;" onclick="app.openNewEditor()"><i class='bx bx-plus-circle'></i> 신규 견적 작성</button> 버튼을 눌러 첫 견적서를 작성해보세요.</div>
            </td></tr>`;
            return;
        }

        const rows = this.quotations.map((q, idx) => {
            const statusBadge = q.status === '수주확정' ? 'bg-success' : (q.status === '제출완료' ? 'bg-primary' : 'bg-secondary');
            const summary = q.project_name || (q.first_item_name ? (q.item_count > 1 ? `${q.first_item_name} 외 ${q.item_count - 1}건` : q.first_item_name) : '-');

            return `
                <tr class="cursor-pointer" onclick="app.loadQuotationDetail('${escHtml(q.id)}')">
                    <td class="text-center text-muted" onclick="event.stopPropagation()">${idx + 1}</td>
                    <td class="text-center fw-bold text-primary">${escHtml(q.quote_number)}</td>
                    <td class="text-center text-muted">${escHtml(q.issue_date || '-')}</td>
                    <td class="text-start ps-2 fw-semibold" title="${escHtml(q.customer_name)}">${escHtml(q.customer_name || '-')}</td>
                    <td class="text-start ps-2" title="${escHtml(summary)}">${escHtml(summary)}</td>
                    <td class="text-center">${fmtNum(q.item_count || (q.items ? q.items.length : 0))}개</td>
                    <td class="text-end pe-2 fw-bold text-dark">${fmtWon(q.total_amount)}</td>
                    <td class="text-center"><span class="badge ${statusBadge}">${escHtml(q.status || '작성중')}</span></td>
                    <td class="text-center text-muted">${escHtml(q.author || '관리자')}</td>
                    <td class="text-center no-print" onclick="event.stopPropagation()">
                        <div class="d-flex justify-content-center gap-1">
                            <button type="button" class="btn-erp" style="height:20px; font-size:10px; padding:0 5px;" onclick="app.loadQuotationDetail('${escHtml(q.id)}')" title="상세보기 / 수정">
                                <i class='bx bx-edit-alt'></i> 수정
                            </button>
                            <button type="button" class="btn-erp" style="height:20px; font-size:10px; padding:0 5px;" onclick="app.duplicateQuotation('${escHtml(q.id)}')" title="복사하여 재견적 작성">
                                <i class='bx bx-copy'></i> 복사
                            </button>
                            <button type="button" class="btn-erp" style="height:20px; font-size:10px; padding:0 5px;" onclick="app.printQuotationById('${escHtml(q.id)}')" title="A4 인쇄 / PDF">
                                <i class='bx bx-printer'></i> 인쇄
                            </button>
                            <button type="button" class="btn-erp btn-erp-danger" style="height:20px; font-size:10px; padding:0 4px;" onclick="app.deleteQuotation('${escHtml(q.id)}')" title="삭제">
                                <i class='bx bx-trash'></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.join('');
    },

    // ── 견적서 상세 로드 ──
    loadQuotationDetail: function(id) {
        if (this.currentView === 'editor' && this.hasUnsavedChanges()) {
            if (!confirm('현재 작성 중이거나 변경된 견적서가 저장되지 않았습니다.\n저장하지 않고 다른 견적서를 불러오시겠습니까?')) {
                return;
            }
        }

        showToast('견적서 상세를 불러오는 중입니다...', 'info');
        authFetch(`${API_BASE}/${id}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(quote => {
                this.currentQuote = quote;
                this.bindEditorFields();
                this.renderEditorItems();
                this.recalcTotals();
                this.switchView('editor', true);
                this.savedSnapshot = this.getFormSnapshot();
                this.isDirty = false;
            })
            .catch(err => {
                console.warn('서버 상세 조회 실패, 로컬 조회 시도:', err);
                let localQuotes = [];
                try {
                    localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
                } catch(e) {}
                const found = localQuotes.find(q => String(q.id) === String(id));
                if (found) {
                    this.currentQuote = found;
                    this.bindEditorFields();
                    this.renderEditorItems();
                    this.recalcTotals();
                    this.switchView('editor', true);
                    this.savedSnapshot = this.getFormSnapshot();
                    this.isDirty = false;
                } else {
                    showToast('견적서 정보를 불러오지 못했습니다: ' + err.message, 'error');
                }
            });
    },

    // ── 과거 견적서 복사하여 재견적 작성 (Re-Quote) ──
    duplicateQuotation: function(id) {
        if (this.currentView === 'editor' && this.hasUnsavedChanges()) {
            if (!confirm('현재 작성 중이거나 변경된 견적서가 저장되지 않았습니다.\n저장하지 않고 과거 견적서를 복사하여 새로 작성하시겠습니까?')) {
                return;
            }
        }

        const proceedWithQuote = (quote) => {
            const todayStr = new Date().toISOString().split('T')[0];
            const validDate = new Date();
            validDate.setDate(validDate.getDate() + 15);

            this.currentQuote = Object.assign({}, quote, {
                id: '', // 새 견적 ID로 생성
                quote_number: '', // 새 번호 자동 채번
                issue_date: todayStr,
                valid_until: validDate.toISOString().split('T')[0],
                status: '작성중',
                items: (quote.items || []).map((it, idx) => Object.assign({}, it, {
                    id: 'qi_' + Date.now() + '_' + idx,
                    quote_id: ''
                }))
            });

            this.bindEditorFields();
            this.renderEditorItems();
            this.recalcTotals();
            this.switchView('editor');
            showToast('과거 견적서가 복사되었습니다. 단가/수량 수정 후 저장하세요.', 'info');
        };

        authFetch(`${API_BASE}/${id}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(proceedWithQuote)
            .catch(err => {
                let localQuotes = [];
                try {
                    localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
                } catch(e) {}
                const found = localQuotes.find(q => String(q.id) === String(id));
                if (found) proceedWithQuote(found);
                else showToast('복사 실패: ' + err.message, 'error');
            });
    },

    // ── 견적서 삭제 ──
    deleteQuotation: function(id) {
        if (!confirm('이 견적서를 삭제하시겠습니까? 삭제 후에는 복구할 수 없습니다.')) return;

        // 로컬 보관함에서 우선 삭제
        try {
            let localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
            localQuotes = localQuotes.filter(q => String(q.id) !== String(id));
            localStorage.setItem('kng_quotations_cache', JSON.stringify(localQuotes));
            localStorage.setItem('kng_quotations_local', JSON.stringify(localQuotes));
        } catch(e) {}

        authFetch(`${API_BASE}/${id}`, { method: 'DELETE' })
            .then(() => {
                showToast('견적서가 삭제되었습니다.', 'success');
                this.fetchQuotations();
            })
            .catch(err => {
                showToast('견적서가 로컬에서 삭제되었습니다.', 'info');
                this.fetchQuotations();
            });
    },

    // ── 품목 그리드 렌더링 ──
    renderEditorItems: function() {
        const tbody = document.getElementById('quoteItemsTbody');
        if (!tbody) return;

        const items = this.currentQuote.items || [];
        document.getElementById('itemCountBadge').textContent = `${items.length}개 품목`;

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="text-center py-4 text-muted">등록된 품목이 없습니다. 상단 [불러오기] 또는 [직접 추가] 버튼을 클릭하세요.</td></tr>`;
            return;
        }

        const rows = items.map((it, idx) => {
            const hasImg = !!it.image_url;
            const thumbHtml = hasImg
                ? `<img src="${escHtml(it.image_url)}" class="quote-item-thumb-img" alt="사진">`
                : `<div class="quote-item-thumb-empty"><i class='bx bx-camera'></i><span>사진</span></div>`;

            return `
                <tr data-index="${idx}">
                    <td class="text-center text-muted" style="font-size:10.5px;">${idx + 1}</td>
                    <!-- 사진 썸네일 [클릭 시 업로드/변경] -->
                    <td class="col-item-img text-center p-1">
                        <div class="quote-item-thumb-box" onclick="app.openImageModal(${idx})" title="클릭: 사진 추가/변경 또는 클립보드 붙여넣기">
                            ${thumbHtml}
                        </div>
                    </td>
                    <!-- 품목명 -->
                    <td>
                        <input type="text" class="form-control form-control-sm border-0 bg-transparent fw-semibold" value="${escHtml(it.product_name)}" placeholder="품목명 입력" oninput="app.updateItemField(${idx}, 'product_name', this.value)">
                    </td>
                    <!-- 규격 -->
                    <td>
                        <input type="text" class="form-control form-control-sm border-0 bg-transparent text-center" value="${escHtml(it.spec)}" placeholder="규격/사양" oninput="app.updateItemField(${idx}, 'spec', this.value)">
                    </td>
                    <!-- 수량 -->
                    <td>
                        <input type="number" class="form-control form-control-sm border-0 bg-transparent text-center fw-bold" min="1" value="${it.qty || 1}" oninput="app.updateItemField(${idx}, 'qty', this.value)">
                    </td>
                    <!-- 단위 -->
                    <td>
                        <input type="text" class="form-control form-control-sm border-0 bg-transparent text-center" value="${escHtml(it.unit || 'EA')}" style="width:45px;" oninput="app.updateItemField(${idx}, 'unit', this.value)">
                    </td>
                    <!-- 참고원가 (화면 전용) -->
                    <td class="col-cost text-end pe-2 text-muted" style="font-size:11px;">
                        ${fmtWon(it.cost_price || 0)}
                    </td>
                    <!-- 제안단가 -->
                    <td>
                        <input type="number" class="form-control form-control-sm border-0 bg-transparent text-end fw-bold text-primary" min="0" value="${it.unit_price || 0}" oninput="app.updateItemField(${idx}, 'unit_price', this.value)">
                    </td>
                    <!-- 공급가액 -->
                    <td class="text-end pe-2 fw-semibold" id="cellSupply_${idx}">${fmtWon(it.supply_price || 0)}</td>
                    <!-- 세액 -->
                    <td class="text-end pe-2 text-dark" id="cellVat_${idx}">${(this.currentQuote?.vat_type === 'exclusive') ? '별도' : fmtWon(it.vat || 0)}</td>
                    <!-- 합계 -->
                    <td class="text-end pe-2 fw-bold text-dark" id="cellTotal_${idx}">${fmtWon(it.total_price || 0)}</td>
                    <!-- 비고 -->
                    <td>
                        <input type="text" class="form-control form-control-sm border-0 bg-transparent" value="${escHtml(it.remarks || '')}" placeholder="비고 입력" oninput="app.updateItemField(${idx}, 'remarks', this.value)">
                    </td>
                    <!-- 삭제 -->
                    <td class="text-center no-print">
                        <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.removeRow(${idx})" title="삭제">
                            <i class='bx bx-x fs-5'></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = rows.join('');
    },

    // ── 품목 필드 인라인 갱신 및 금액 자동계산 ──
    updateItemField: function(idx, field, val) {
        if (!this.currentQuote.items[idx]) return;
        const it = this.currentQuote.items[idx];

        if (field === 'qty' || field === 'unit_price') {
            it[field] = Number(val) || 0;
            const vatType = document.getElementById('vatTypeSelect')?.value || 'exclusive';
            const qty = Number(it.qty) || 0;
            const price = Number(it.unit_price) || 0;
            const baseAmount = Math.round(qty * price);

            if (vatType === 'exclusive') {
                // [부가세 별도]: 합계금액에 부가세를 가산하지 않음 (단가 합계 그대로)
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            } else if (vatType === 'inclusive') {
                // [부가세 포함]: 단가 합계에 부가세 10%를 더함
                it.supply_price = baseAmount;
                it.vat = Math.round(baseAmount * 0.1);
                it.total_price = it.supply_price + it.vat;
            } else {
                // [영세 / 면세]: 부가세 0원
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            }

            // 셀 실시간 반영
            const cellS = document.getElementById(`cellSupply_${idx}`);
            const cellV = document.getElementById(`cellVat_${idx}`);
            const cellT = document.getElementById(`cellTotal_${idx}`);
            if (cellS) cellS.textContent = fmtWon(it.supply_price);
            if (cellV) cellV.textContent = (vatType === 'exclusive') ? '별도' : fmtWon(it.vat);
            if (cellT) cellT.textContent = fmtWon(it.total_price);

            this.recalcTotals();
        } else {
            it[field] = val;
        }
    },

    // ── 총 견적금액 및 한글 금액 재계산 ──
    recalcTotals: function() {
        const items = this.currentQuote.items || [];
        const vatType = document.getElementById('vatTypeSelect')?.value || 'exclusive';
        this.currentQuote.vat_type = vatType;

        let sumSupply = 0;
        let sumVat = 0;
        let sumTotal = 0;

        items.forEach((it, idx) => {
            const qty = Number(it.qty) || 0;
            const price = Number(it.unit_price) || 0;
            const baseAmount = Math.round(qty * price);

            if (vatType === 'exclusive') {
                // 부가세 별도: 부가세가 빠진 금액이 합계
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            } else if (vatType === 'inclusive') {
                // 부가세 포함: 부가세 10%가 더해진 금액이 합계
                it.supply_price = baseAmount;
                it.vat = Math.round(baseAmount * 0.1);
                it.total_price = it.supply_price + it.vat;
            } else {
                // 영세 / 면세
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            }

            // [DOM 셀 즉시 반영 - 과세 구분 변경 시에도 품목 테이블 각 행 즉각 동기화]
            const cellS = document.getElementById(`cellSupply_${idx}`);
            const cellV = document.getElementById(`cellVat_${idx}`);
            const cellT = document.getElementById(`cellTotal_${idx}`);
            if (cellS) cellS.textContent = fmtWon(it.supply_price);
            if (cellV) cellV.textContent = (vatType === 'exclusive') ? '별도' : fmtWon(it.vat);
            if (cellT) cellT.textContent = fmtWon(it.total_price);

            sumSupply += it.supply_price;
            sumVat += it.vat;
            sumTotal += it.total_price;
        });

        this.currentQuote.total_supply_price = sumSupply;
        this.currentQuote.total_vat = sumVat;
        this.currentQuote.total_amount = sumTotal;

        const elSupply = document.getElementById('sumSupplyPrice');
        const elVat = document.getElementById('sumVat');
        const elTotal = document.getElementById('sumTotalAmount');
        const elKorean = document.getElementById('amountKoreanText');

        if (elSupply) elSupply.textContent = fmtWon(sumSupply);
        if (elVat) elVat.textContent = (vatType === 'exclusive') ? '별도 (0원)' : fmtWon(sumVat);
        if (elTotal) elTotal.textContent = fmtWon(sumTotal);

        if (elKorean) {
            let label = '';
            if (vatType === 'exclusive') {
                label = `합계: ${fmtNum(sumTotal)}원 (부가세 별도)`;
            } else if (vatType === 'inclusive') {
                label = `합계: ${fmtNum(sumTotal)}원 (부가세 10% 포함)`;
            } else {
                label = `합계: ${fmtNum(sumTotal)}원 (영세 / 면세)`;
            }
            elKorean.textContent = label;
        }

        // 하단 기본 특기사항의 VAT 안내 문구 자동 연동
        const notesEl = document.getElementById('notesInstructions');
        if (notesEl && notesEl.value) {
            let currentNotes = notesEl.value;
            const targetLine = (vatType === 'exclusive')
                ? '1. 상기 견적금액은 부가세(VAT) 별도 기준입니다.'
                : ((vatType === 'inclusive')
                    ? '1. 상기 견적금액은 부가세(VAT) 포함 기준입니다.'
                    : '1. 상기 견적금액은 영세/면세 기준입니다.');

            if (/1\.\s*상기\s*견적금액은\s*[^.\n]+기준입니다\./.test(currentNotes)) {
                currentNotes = currentNotes.replace(/1\.\s*상기\s*견적금액은\s*[^.\n]+기준입니다\./, targetLine);
                notesEl.value = currentNotes;
                this.currentQuote.notes_instructions = currentNotes;
            }
        }
    },

    // ── 수기 행 추가 ──
    addManualRow: function() {
        if (!this.currentQuote) this.initNewQuotation();
        const nextSeq = (this.currentQuote.items.length || 0) + 1;
        this.currentQuote.items.push({
            id: 'qi_' + Date.now() + '_' + nextSeq,
            seq: nextSeq,
            source_module: 'manual',
            product_name: '',
            spec: '',
            color: '',
            unit: 'EA',
            qty: 1,
            cost_price: 0,
            unit_price: 0,
            supply_price: 0,
            vat: 0,
            total_price: 0,
            image_url: '',
            remarks: ''
        });
        this.renderEditorItems();
        this.recalcTotals();
    },

    // 행 삭제
    removeRow: function(idx) {
        this.currentQuote.items.splice(idx, 1);
        this.renderEditorItems();
        this.recalcTotals();
    },

    // 사진 컬럼 토글
    toggleImageColumn: function(show) {
        document.querySelectorAll('.col-item-img').forEach(el => {
            el.style.display = show ? '' : 'none';
        });
    },

    // ═══════════════════════════════════════════════════════════════
    // 품목별 사진 첨부 & 클립보드 붙여넣기 (Ctrl + V)
    // ═══════════════════════════════════════════════════════════════
    openImageModal: function(idx) {
        this.editingItemIndexForImage = idx;
        const it = this.currentQuote.items[idx];
        const modal = document.getElementById('imageUploadModal');
        const preview = document.getElementById('modalPreviewImg');
        const previewWrap = document.getElementById('imagePreviewContainer');
        const emptyPrompt = document.getElementById('imageEmptyPrompt');
        const urlInput = document.getElementById('modalImageUrlInput');

        urlInput.value = it.image_url || '';
        if (it.image_url) {
            preview.src = it.image_url;
            previewWrap.classList.remove('d-none');
            emptyPrompt.classList.add('d-none');
        } else {
            preview.src = '';
            previewWrap.classList.add('d-none');
            emptyPrompt.classList.remove('d-none');
        }

        modal.style.display = 'block';
    },

    closeImageModal: function() {
        const modal = document.getElementById('imageUploadModal');
        if (modal) modal.style.display = 'none';
        this.editingItemIndexForImage = null;
    },

    setupImageDropzone: function() {
        const dropzone = document.getElementById('imageDropzone');
        if (!dropzone) return;

        dropzone.addEventListener('click', () => {
            document.getElementById('modalFileInput').click();
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.uploadImageFile(e.dataTransfer.files[0]);
            }
        });

        // 클립보드 붙여넣기 (Ctrl + V) 이벤트
        window.addEventListener('paste', (e) => {
            const modal = document.getElementById('imageUploadModal');
            if (modal && modal.style.display === 'block') {
                if (e.clipboardData && e.clipboardData.items) {
                    for (let i = 0; i < e.clipboardData.items.length; i++) {
                        const item = e.clipboardData.items[i];
                        if (item.type.indexOf('image') !== -1) {
                            const blob = item.getAsFile();
                            this.uploadImageFile(blob);
                            break;
                        }
                    }
                }
            }
        });
    },

    handleModalFileSelect: function(e) {
        if (e.target.files && e.target.files[0]) {
            this.uploadImageFile(e.target.files[0]);
        }
    },

    uploadImageFile: function(file) {
        const formData = new FormData();
        formData.append('image', file);
        showToast('사진을 등록하는 중입니다...', 'info');

        authFetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(result => {
            if (result.url) {
                let fullUrl = result.url;
                if (!fullUrl.startsWith('http') && !fullUrl.startsWith('data:')) {
                    const host = (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:')
                        ? 'http://localhost:3000'
                        : 'https://kng.junparks.com';
                    fullUrl = host + fullUrl;
                }
                document.getElementById('modalImageUrlInput').value = fullUrl;
                document.getElementById('modalPreviewImg').src = fullUrl;
                document.getElementById('imagePreviewContainer').classList.remove('d-none');
                document.getElementById('imageEmptyPrompt').classList.add('d-none');
                showToast('사진이 등록되었습니다!', 'success');
            } else {
                throw new Error(result.error || '업로드 실패');
            }
        })
        .catch(err => {
            console.warn('서버 업로드 실패, 로컬 이미지(Base64)로 대체:', err);
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result;
                document.getElementById('modalImageUrlInput').value = base64;
                document.getElementById('modalPreviewImg').src = base64;
                document.getElementById('imagePreviewContainer').classList.remove('d-none');
                document.getElementById('imageEmptyPrompt').classList.add('d-none');
                showToast('로컬 사진으로 등록되었습니다.', 'success');
            };
            reader.readAsDataURL(file);
        });
    },

    applyModalImage: function() {
        if (this.editingItemIndexForImage === null) return;
        const url = document.getElementById('modalImageUrlInput').value.trim();
        this.currentQuote.items[this.editingItemIndexForImage].image_url = url;
        this.renderEditorItems();
        this.closeImageModal();
    },

    removeCurrentImage: function() {
        if (this.editingItemIndexForImage === null) return;
        this.currentQuote.items[this.editingItemIndexForImage].image_url = '';
        this.renderEditorItems();
        this.closeImageModal();
        showToast('사진이 삭제되었습니다.', 'info');
    },

    // ═══════════════════════════════════════════════════════════════
    // 외부 모듈 품목 불러오기 팝업 (본사 재고 / 셀러K / 입출고)
    // ═══════════════════════════════════════════════════════════════
    openItemImportModal: function(source = 'hq') {
        const modal = document.getElementById('itemImportModal');
        modal.style.display = 'block';
        this.switchImportSource(source);
    },

    closeItemImportModal: function() {
        document.getElementById('itemImportModal').style.display = 'none';
    },

    switchImportSource: function(source) {
        this.importData.source = source;
        document.querySelectorAll('#importSourceTabs .nav-link').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.source === source);
        });

        const tbody = document.getElementById('importItemsTbody');
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 데이터를 조회하는 중...</td></tr>`;

        let url = '';
        if (source === 'hq') url = `${API_BASE_HQ}/products`;
        else if (source === 'seller-k') url = API_BASE_SELLER_K;
        else if (source === 'tx') url = `${API_BASE_HQ}/transactions`;

        authFetch(url)
            .then(res => res.json())
            .then(data => {
                this.importData.items = (data || []).map(p => ({
                    id: p.id,
                    supplier: p.supplier || '',
                    brand: p.brand || '',
                    name: p.name || p.product_name || '',
                    color: p.color || '',
                    size: p.size || p.spec || '',
                    buyPrice: p.buyPrice || p.price || 0,
                    sellPrice: p.sellPrice || p.discountPrice || p.buyPrice || 0,
                    stock: p.stock !== undefined ? p.stock : (p.isSoldOut ? 0 : 99),
                    image_url: p.image_url || p.imageUrl || '',
                    checked: false
                }));
                this.renderImportTable();
            })
            .catch(err => {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger"><i class='bx bx-error'></i> 데이터를 불러오지 못했습니다 (${err.message})</td></tr>`;
            });
    },

    renderImportTable: function() {
        const tbody = document.getElementById('importItemsTbody');
        const kw = document.getElementById('importSearchInput')?.value.trim().toLowerCase() || '';

        const filtered = this.importData.items.filter(it => {
            if (!kw) return true;
            return (it.name.toLowerCase().indexOf(kw) !== -1 ||
                    it.brand.toLowerCase().indexOf(kw) !== -1 ||
                    it.supplier.toLowerCase().indexOf(kw) !== -1 ||
                    it.color.toLowerCase().indexOf(kw) !== -1 ||
                    it.size.toLowerCase().indexOf(kw) !== -1);
        });

        document.getElementById('importCountBadge').textContent = `조회 ${filtered.length}건`;

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">일치하는 품목이 없습니다.</td></tr>`;
            return;
        }

        const rows = filtered.map((it, idx) => `
            <tr>
                <td class="text-center">
                    <input type="checkbox" class="form-check-input m-0 import-item-check" data-id="${escHtml(it.id)}" ${it.checked ? 'checked' : ''} onchange="app.onImportCheckChange('${escHtml(it.id)}', this.checked)">
                </td>
                <td class="text-center">${escHtml(it.supplier || '-')}</td>
                <td class="text-center">${escHtml(it.brand || '-')}</td>
                <td class="text-start ps-2 fw-semibold">${escHtml(it.name)}</td>
                <td class="text-center">${escHtml(it.color || '-')}</td>
                <td class="text-center">${escHtml(it.size || '-')}</td>
                <td class="text-end pe-2 text-muted">${fmtWon(it.buyPrice)}</td>
                <td class="text-end pe-2 fw-bold text-primary">${fmtWon(it.sellPrice)}</td>
                <td class="text-center">${fmtNum(it.stock)}</td>
            </tr>
        `);

        tbody.innerHTML = rows.join('');
        this.updateImportSelectedCount();
    },

    onImportCheckChange: function(id, checked) {
        const item = this.importData.items.find(i => String(i.id) === String(id));
        if (item) item.checked = checked;
        this.updateImportSelectedCount();
    },

    toggleImportSelectAll: function(checked) {
        this.importData.items.forEach(i => i.checked = checked);
        document.querySelectorAll('.import-item-check').forEach(cb => cb.checked = checked);
        this.updateImportSelectedCount();
    },

    updateImportSelectedCount: function() {
        const count = this.importData.items.filter(i => i.checked).length;
        document.getElementById('importSelectedInfo').textContent = `선택된 품목: ${count}개`;
        document.getElementById('importAddCount').textContent = count;
    },

    filterImportItems: function() {
        this.renderImportTable();
    },

    // 모달에서 선택한 품목을 견적서에 추가
    applyImportedItems: function() {
        const selected = this.importData.items.filter(i => i.checked);
        if (selected.length === 0) {
            showToast('추가할 품목을 선택해주세요.', 'warning');
            return;
        }

        const vatType = document.getElementById('vatTypeSelect')?.value || 'exclusive';
        const startSeq = (this.currentQuote.items.length || 0) + 1;

        selected.forEach((p, idx) => {
            const qty = 1;
            const price = Number(p.sellPrice) || Number(p.buyPrice) || 0;
            let supply = 0, vat = 0, total = 0;

            const baseAmount = qty * price;
            if (vatType === 'exclusive') {
                supply = baseAmount;
                vat = 0;
                total = baseAmount;
            } else if (vatType === 'inclusive') {
                supply = baseAmount;
                vat = Math.round(baseAmount * 0.1);
                total = supply + vat;
            } else {
                supply = baseAmount;
                vat = 0;
                total = baseAmount;
            }

            this.currentQuote.items.push({
                id: 'qi_' + Date.now() + '_' + (startSeq + idx),
                seq: startSeq + idx,
                source_module: this.importData.source,
                source_id: p.id,
                product_name: p.name,
                spec: [p.brand, p.size].filter(Boolean).join(' / '),
                color: p.color || '',
                unit: 'EA',
                qty: qty,
                cost_price: Number(p.buyPrice) || 0,
                unit_price: price,
                supply_price: supply,
                vat: vat,
                total_price: total,
                image_url: p.image_url || '',
                remarks: p.supplier ? `[공급사: ${p.supplier}]` : ''
            });
        });

        this.closeItemImportModal();
        this.renderEditorItems();
        this.recalcTotals();
        showToast(`${selected.length}개 품목이 견적서에 추가되었습니다!`, 'success');
    },

    loadItemsFromCartModal: function() {
        this.loadFromCartAndEdit();
    },

    // ═══════════════════════════════════════════════════════════════
    // 견적서 저장 (API 호출)
    // ═══════════════════════════════════════════════════════════════
    saveQuotation: function() {
        const custName = document.getElementById('custName').value.trim();
        // 0. 테이블 DOM의 최신 입력값 동기화
        const itemRows = document.querySelectorAll('#quoteItemsTbody tr[data-index]');
        if (itemRows.length > 0 && Array.isArray(this.currentQuote?.items)) {
            itemRows.forEach(tr => {
                const idx = parseInt(tr.dataset.index, 10);
                const item = this.currentQuote.items[idx];
                if (!item) return;

                const nameEl = tr.querySelector('input[placeholder*="품목명"]');
                const specEl = tr.querySelector('input[placeholder*="규격"]');
                const qtyEl = tr.querySelector('input[type="number"]');
                const unitEl = tr.querySelector('input[style*="width:45px"]') || tr.querySelectorAll('input[type="text"]')[2];
                const priceEl = tr.querySelector('input.text-end.fw-bold.text-primary') || tr.querySelectorAll('input[type="number"]')[1];
                const remarksEl = tr.querySelector('input[placeholder*="비고"]');

                if (nameEl && nameEl.value.trim()) item.product_name = nameEl.value.trim();
                if (specEl) item.spec = specEl.value.trim();
                if (qtyEl) item.qty = Number(qtyEl.value) || 1;
                if (unitEl && unitEl.value.trim()) item.unit = unitEl.value.trim();
                if (priceEl) item.unit_price = Number(priceEl.value) || 0;
                if (remarksEl) item.remarks = remarksEl.value.trim();
            });
            this.recalcTotals();
        }

        if (!custName) {
            showToast('수신처(거래처명)를 입력해주세요.', 'warning');
            document.getElementById('custName').focus();
            return;
        }

        const items = this.currentQuote.items || [];
        if (items.length === 0) {
            showToast('견적 품목을 최소 하나 이상 추가해주세요. (직접 추가 또는 불러오기)', 'warning');
            return;
        }

        // 품목명 필수 체크
        for (let i = 0; i < items.length; i++) {
            if (!items[i].product_name || !items[i].product_name.trim()) {
                showToast(`${i + 1}번째 품목의 품목명을 입력해주세요.`, 'warning');
                return;
            }
        }

        const existingId = document.getElementById('quoteId')?.value.trim() || this.currentQuote.id;
        const isUpdate = Boolean(existingId);

        const payload = Object.assign({}, this.currentQuote, {
            id: existingId || '',
            customer_name: custName,
            customer_attn: document.getElementById('custAttn').value.trim(),
            customer_tel: document.getElementById('custTel').value.trim(),
            customer_email: document.getElementById('custEmail').value.trim(),
            project_name: document.getElementById('projectName').value.trim(),
            issue_date: document.getElementById('issueDate').value,
            valid_until: document.getElementById('validUntil').value,
            delivery_date: document.getElementById('deliveryDate').value.trim(),
            delivery_place: document.getElementById('deliveryPlace').value.trim(),
            payment_terms: document.getElementById('paymentTerms').value.trim(),
            status: document.getElementById('quoteStatus').value,
            vat_type: document.getElementById('vatTypeSelect').value,
            notes_instructions: document.getElementById('notesInstructions').value.trim(),
            show_images: document.getElementById('optShowImages').checked ? 1 : 0,
            include_seal: document.getElementById('optIncludeSeal').checked ? 1 : 0,
            supplier_name: this.supplierSettings.name,
            supplier_biz_num: this.supplierSettings.bizNum,
            supplier_ceo: this.supplierSettings.ceo,
            supplier_address: this.supplierSettings.address,
            supplier_tel: this.supplierSettings.tel,
            supplier_email: this.supplierSettings.email,
            supplier_bank: this.supplierSettings.bank
        });

        // 로컬 보관용 임시 ID 및 번호
        const localBackupId = existingId || ('qt_' + Date.now());
        const localBackupQuoteNumber = payload.quote_number || ('Q-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + String(Math.floor(Math.random() * 900) + 100));

        // 1. 로컬스토리지 즉시 백업 저장 (무중단 보존)
        try {
            const localPayload = Object.assign({}, payload, {
                id: localBackupId,
                quote_number: localBackupQuoteNumber
            });
            let localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
            const exIdx = localQuotes.findIndex(q => String(q.id) === String(localBackupId));
            if (exIdx >= 0) localQuotes[exIdx] = localPayload;
            else localQuotes.unshift(localPayload);
            localStorage.setItem('kng_quotations_cache', JSON.stringify(localQuotes));
            localStorage.setItem('kng_quotations_local', JSON.stringify(localQuotes));
        } catch(e) {}

        const method = isUpdate ? 'PUT' : 'POST';
        const url = isUpdate ? `${API_BASE}/${existingId}` : API_BASE;

        showToast('견적서를 저장하는 중입니다...', 'info');

        authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(result => {
            const savedId = result.id || localBackupId;
            const savedNumber = result.quote_number || localBackupQuoteNumber;

            payload.id = savedId;
            payload.quote_number = savedNumber;
            this.currentQuote = payload;
            document.getElementById('quoteId').value = savedId;
            document.getElementById('badgeQuoteNumber').textContent = savedNumber;

            // 로컬스토리지 최종 동기화
            try {
                let localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || '[]');
                const exIdx = localQuotes.findIndex(q => String(q.id) === String(localBackupId) || String(q.id) === String(savedId));
                if (exIdx >= 0) localQuotes[exIdx] = payload;
                else localQuotes.unshift(payload);
                localStorage.setItem('kng_quotations_cache', JSON.stringify(localQuotes));
            } catch(e) {}

            showToast(`견적서가 안전하게 저장되었습니다! (${savedNumber})`, 'success');
            this.savedSnapshot = this.getFormSnapshot();
            this.isDirty = false;
            this.fetchQuotations();

            // 0.8초 후 견적서 보관함 목록 탭으로 자동 전환하여 저장된 내역 확인
            setTimeout(() => {
                this.switchView('list', true);
            }, 800);
        })
        .catch(err => {
            console.warn('서버 저장 실패, 로컬 보관함에 보존됨:', err);
            payload.id = localBackupId;
            payload.quote_number = localBackupQuoteNumber;
            this.currentQuote = payload;
            document.getElementById('quoteId').value = localBackupId;
            document.getElementById('badgeQuoteNumber').textContent = localBackupQuoteNumber;

            showToast(`로컬 보관함에 안전하게 저장되었습니다! (${localBackupQuoteNumber})`, 'success');
            this.savedSnapshot = this.getFormSnapshot();
            this.isDirty = false;
            this.fetchQuotations();

            // 0.8초 후 견적서 보관함 목록 탭으로 자동 전환
            setTimeout(() => {
                this.switchView('list', true);
            }, 800);
        });
    },

    // ═══════════════════════════════════════════════════════════════
    // 정규 A4 견적서 인쇄 / PDF 렌더링 [사용자 요구사항 완벽 반영]
    // ═══════════════════════════════════════════════════════════════
    printCurrentQuotation: function() {
        if (!this.currentQuote) return;
        this.renderPrintArea(this.currentQuote);
        setTimeout(() => {
            window.print();
        }, 100);
    },

    // ═══════════════════════════════════════════════════════════════
    // A4 인쇄 / PDF 출력 옵션 모달 및 거래명세서 표준 서식 렌더링
    // ═══════════════════════════════════════════════════════════════
    targetQuoteForPrint: null,

    openPrintOptionsModal: function(quote) {
        this.targetQuoteForPrint = quote || this.currentQuote;
        if (!this.targetQuoteForPrint) {
            showToast('인쇄할 견적서 데이터가 없습니다.', 'warning');
            return;
        }

        let lastOpt = {};
        try {
            lastOpt = JSON.parse(localStorage.getItem('kng_last_print_options') || '{}');
        } catch(e) {}

        const title = lastOpt.title || '견  적  서';
        const titleInput = document.getElementById('printCustomTitle');
        if (titleInput) {
            titleInput.value = title;
            titleInput.oninput = (e) => {
                this.updateNotesOptionLabel(e.target.value);
            };
        }
        this.updateNotesOptionLabel(title);

        document.querySelectorAll('#printPresetChips .print-preset-chip').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.trim() === title.replace(/\s+/g, ''));
        });

        const priceMode = lastOpt.priceMode || 'all';
        const radio = document.querySelector(`input[name="printPriceMode"][value="${priceMode}"]`);
        if (radio) radio.checked = true;

        if (document.getElementById('printOptIncludeRecipient')) {
            document.getElementById('printOptIncludeRecipient').checked = (lastOpt.includeRecipient !== false);
        }
        if (document.getElementById('printOptIncludeSupplier')) {
            document.getElementById('printOptIncludeSupplier').checked = (lastOpt.includeSupplier !== false);
            this.togglePrintSupplierOption(lastOpt.includeSupplier !== false);
        }
        if (document.getElementById('printOptShowImages')) {
            document.getElementById('printOptShowImages').checked = (lastOpt.showImages !== false);
        }
        if (document.getElementById('printOptIncludeSeal')) {
            document.getElementById('printOptIncludeSeal').checked = (lastOpt.includeSeal !== false);
        }
        if (document.getElementById('printOptIncludeNotes')) {
            document.getElementById('printOptIncludeNotes').checked = (lastOpt.includeNotes !== false);
        }

        const modal = document.getElementById('printOptionsModal');
        if (modal) modal.style.display = 'block';
    },

    togglePrintSupplierOption: function(enabled) {
        const sealInput = document.getElementById('printOptIncludeSeal');
        const sealWrap = document.getElementById('wrapPrintOptIncludeSeal');
        if (sealInput) {
            sealInput.disabled = !enabled;
        }
        if (sealWrap) {
            sealWrap.style.opacity = enabled ? '1' : '0.4';
            sealWrap.style.pointerEvents = enabled ? 'auto' : 'none';
        }
    },

    closePrintOptionsModal: function() {
        const modal = document.getElementById('printOptionsModal');
        if (modal) modal.style.display = 'none';
    },

    selectPrintTitlePreset: function(title) {
        if (document.getElementById('printCustomTitle')) {
            document.getElementById('printCustomTitle').value = title;
        }
        document.querySelectorAll('#printPresetChips .print-preset-chip').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.trim() === title.replace(/\s+/g, ''));
        });
        this.updateNotesOptionLabel(title);
    },

    updateNotesOptionLabel: function(title) {
        const lbl = document.getElementById('lblPrintOptNotes');
        if (!lbl) return;
        const isQuote = (title || '').replace(/\s+/g, '').includes('견적');
        lbl.textContent = isQuote
            ? '하단 [특기사항 및 납품조건] 영역 포함'
            : '하단 [특기사항] 영역 포함 (납품조건 메타 제외)';
    },

    executePrintWithOptions: function() {
        const q = this.targetQuoteForPrint || this.currentQuote;
        if (!q) return;

        const title = document.getElementById('printCustomTitle')?.value.trim() || '견  적  서';
        const priceMode = document.querySelector('input[name="printPriceMode"]:checked')?.value || 'all';
        const includeRecipient = document.getElementById('printOptIncludeRecipient')?.checked !== false;
        const includeSupplier = document.getElementById('printOptIncludeSupplier')?.checked !== false;
        const showImages = document.getElementById('printOptShowImages')?.checked !== false;
        const includeSeal = includeSupplier && (document.getElementById('printOptIncludeSeal')?.checked !== false);
        const includeNotes = document.getElementById('printOptIncludeNotes')?.checked !== false;

        const options = {
            title: title,
            priceMode: priceMode,
            includeRecipient: includeRecipient,
            includeSupplier: includeSupplier,
            showImages: showImages,
            includeSeal: includeSeal,
            includeNotes: includeNotes
        };

        try {
            localStorage.setItem('kng_last_print_options', JSON.stringify(options));
        } catch(e) {}

        this.closePrintOptionsModal();

        this.renderPrintArea(q, options);
        setTimeout(() => {
            window.print();
        }, 150);
    },

    printCurrentQuotation: function() {
        if (!this.currentQuote) return;
        this.openPrintOptionsModal(this.currentQuote);
    },

    printQuotationById: function(id) {
        showToast('인쇄 데이터를 준비하는 중입니다...', 'info');
        authFetch(`${API_BASE}/${id}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(quote => {
                this.openPrintOptionsModal(quote);
            })
            .catch(err => {
                let localQuotes = [];
                try {
                    localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
                } catch(e) {}
                const found = localQuotes.find(q => String(q.id) === String(id));
                if (found) {
                    this.openPrintOptionsModal(found);
                } else {
                    showToast('인쇄 데이터 조회 실패: ' + err.message, 'error');
                }
            });
    },

    renderPrintArea: function(q, options = {}) {
        const printArea = document.getElementById('printArea');
        if (!printArea) return;

        const s = this.supplierSettings;
        const title = options.title || '견  적  서';
        const priceMode = options.priceMode || 'all'; // 'all' | 'unit' | 'none'
        const includeRecipient = (typeof options.includeRecipient === 'boolean') ? options.includeRecipient : true;
        const includeSupplier = (typeof options.includeSupplier === 'boolean') ? options.includeSupplier : true;
        const showImg = (typeof options.showImages === 'boolean') ? options.showImages : (q.show_images !== 0);
        const includeSeal = includeSupplier && ((typeof options.includeSeal === 'boolean') ? options.includeSeal : (q.include_seal !== 0));
        const includeNotes = (typeof options.includeNotes === 'boolean') ? options.includeNotes : true;
        const items = q.items || [];

        // 일자 및 건명 라벨 (견적서 계열은 '견적일자', 그 외 제안서/명세서/리스트/단가표 등은 '작성일자')
        const isQuote = title.replace(/\s+/g, '').includes('견적');
        const dateLabel = isQuote ? '견적일자' : '작성일자';
        const projectLabel = isQuote ? '견적건명' : '건명';

        // 직인 이미지 HTML
        const sealHtml = (includeSeal && s.sealUrl)
            ? `<img src="${s.sealUrl}" class="stamp" alt="직인" onerror="this.style.display='none'">`
            : '';

        // 금액란 HTML [사용자 요청: 합 계 금 액 : ₩ 3,410,880]
        let amountBoxHtml = '';
        if (priceMode !== 'none') {
            amountBoxHtml = `
                <div class="amount-box">
                    <span>합 계 금 액 : ₩ ${fmtNum(q.total_amount)}</span>
                </div>
            `;
        }

        // 품목 테이블 행 HTML
        const itemRowsHtml = items.map((it, idx) => {
            const imgCell = showImg
                ? `<td class="text-center p-1" style="width: 50px;">
                     ${it.image_url ? `<img src="${escHtml(it.image_url)}" class="a4-item-img" alt="사진">` : '<span style="color:#ccc; font-size:9px;">-</span>'}
                   </td>`
                : '';

            let priceCells = '';
            const vatText = (q.vat_type === 'exclusive') ? '별도' : fmtWon(it.vat);
            if (priceMode === 'all') {
                priceCells = `
                    <td class="text-end pe-2">${fmtWon(it.unit_price)}</td>
                    <td class="text-end pe-2">${fmtWon(it.supply_price)}</td>
                    <td class="text-end pe-2" style="color: #111;">${vatText}</td>
                `;
            } else if (priceMode === 'unit') {
                priceCells = `
                    <td class="text-end pe-2 fw-bold">${fmtWon(it.unit_price)}</td>
                `;
            }

            return `
                <tr>
                    <td class="text-center" style="width: 32px;">${idx + 1}</td>
                    ${imgCell}
                    <td class="text-start ps-2 fw-semibold">${escHtml(it.product_name)}</td>
                    <td class="text-center" style="font-size: 8.5pt;">${escHtml(it.spec || '-')}</td>
                    <td class="text-center">${fmtNum(it.qty)}</td>
                    <td class="text-center">${escHtml(it.unit || 'EA')}</td>
                    ${priceCells}
                    <td class="text-start ps-2" style="font-size: 8pt;">${escHtml(it.remarks || '')}</td>
                </tr>
            `;
        }).join('');

        // 품목 테이블 헤더 및 푸터 구성
        let priceHeaders = '';
        let tfootHtml = '';
        if (priceMode === 'all') {
            priceHeaders = `
                <th style="width: 75px;">단가</th>
                <th style="width: 85px;">공급가액</th>
                <th style="width: 70px;">세액</th>
            `;
            const leadCols = showImg ? 7 : 6;
            const tfootVat = (q.vat_type === 'exclusive') ? '별도 (0원)' : fmtWon(q.total_vat);
            tfootHtml = `
                <tfoot>
                    <tr>
                        <th colspan="${leadCols}" class="text-center" style="font-size: 9pt; background: #f8fafc; letter-spacing: 2px;">합계</th>
                        <td class="text-end pe-2" style="font-weight: bold; background: #f8fafc;">${fmtWon(q.total_supply_price)}</td>
                        <td class="text-end pe-2" style="font-weight: bold; background: #f8fafc; color: #111;">${tfootVat}</td>
                        <td class="text-center" style="font-size: 8pt; color: #888; background: #f8fafc;">-</td>
                    </tr>
                </tfoot>
            `;
        } else if (priceMode === 'unit') {
            priceHeaders = `<th style="width: 85px;">단가</th>`;
        }

        // 하단 특기사항 영역 [사용자 요청: 견적서가 아닐 때는 납품조건 메타정보(작성일자, 유효기간, 납기일, 납품장소, 결제조건) 제외]
        let notesHtml = '';
        if (includeNotes) {
            if (isQuote) {
                // [견적서]: 특기사항 및 납품조건 타이틀 + 메타 정보 바(견적일자, 유효기간, 납기, 장소, 결제조건) + 메모 본문
                notesHtml = `
                    <div class="a4-footer-notes" style="margin-top: 10px; border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt;">
                        <div class="a4-footer-notes-title fw-bold mb-1">[ 특기사항 및 납품조건 ]</div>
                        <div class="a4-notes-meta" style="display: flex; gap: 16px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px dashed #cbd5e1; font-size: 8.5pt; flex-wrap: wrap;">
                            <span>• <b>견적일자</b>: ${escHtml(q.issue_date || '-')}</span>
                            <span>• <b>유효기간</b>: ${escHtml(q.valid_until || '견적일로부터 15일간')}</span>
                            ${q.delivery_date ? `<span>• <b>납기일</b>: ${escHtml(q.delivery_date)}</span>` : ''}
                            ${q.delivery_place ? `<span>• <b>납품장소</b>: ${escHtml(q.delivery_place)}</span>` : ''}
                            ${q.payment_terms ? `<span>• <b>결제조건</b>: ${escHtml(q.payment_terms)}</span>` : ''}
                        </div>
                        <div style="white-space: pre-wrap; line-height: 1.45;">${escHtml(q.notes_instructions || '특기사항 없음')}</div>
                    </div>
                `;
            } else {
                // [견적서 외(제안 리스트, 단가표, 거래명세서 등)]: 작성일자/유효기간/납기일/납품장소/결제조건 메타 제외, 순수 메모 본문만 깔끔하게 출력
                notesHtml = `
                    <div class="a4-footer-notes" style="margin-top: 10px; border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt;">
                        <div class="a4-footer-notes-title fw-bold mb-1">[ 특기사항 ]</div>
                        <div style="white-space: pre-wrap; line-height: 1.45;">${escHtml(q.notes_instructions || '특기사항 없음')}</div>
                    </div>
                `;
            }
        }

        // 수신처 정보 블록 (선택 여부에 따라 출력)
        const recipientHtml = includeRecipient ? `
            <div class="recipient-box">
                <span class="recipient-name">${escHtml(q.customer_name || '거래처')}</span> 貴中
            </div>
        ` : '';

        // 일자 및 건명 블록
        const dateInfoHtml = `
            <div class="date-info">
                ${dateLabel} : ${escHtml(q.issue_date || '-')}
                ${q.project_name ? `&nbsp;&nbsp;|&nbsp;&nbsp;${projectLabel} : <b>${escHtml(q.project_name)}</b>` : ''}
            </div>
        `;

        // 상단 헤더 컨테이너 HTML (공급자 포함 여부에 따른 레이아웃 분기)
        let headerContainerHtml = '';
        if (includeSupplier) {
            // [공급자 포함]: 기존 좌측(제목/수신처/일자) + 우측(4행 공급자 테이블)
            headerContainerHtml = `
                <div class="header-container">
                    <div class="header-left">
                        <div class="title-box">
                            <h1 id="printTitle">${escHtml(title)}</h1>
                        </div>
                        ${recipientHtml}
                        ${dateInfoHtml}
                    </div>
                    <div class="header-right">
                        <table class="supplier-table">
                            <tr>
                                <th rowspan="4" class="vertical-th">공<br>급<br>자</th>
                                <th style="width: 55px;">등록번호</th>
                                <td colspan="3">${escHtml(s.bizNum || '845-88-00551')}</td>
                            </tr>
                            <tr>
                                <th>상 호</th>
                                <td style="width: 110px;">${escHtml(s.name || '주식회사 케이엔지')}</td>
                                <th style="width: 45px;">대표자</th>
                                <td class="stamp-cell" style="width: 70px;">
                                    ${escHtml(s.ceo || '윤종')}
                                    ${sealHtml}
                                </td>
                            </tr>
                            <tr>
                                <th>주 소</th>
                                <td colspan="3" class="address-cell">${escHtml(s.address || '서울시 강동구 구천면로 159, 1층 2호, 3호')}</td>
                            </tr>
                            <tr>
                                <th>업 태</th>
                                <td>${escHtml(s.bizType || '도소매/임대업')}</td>
                                <th>종 목</th>
                                <td>${escHtml(s.bizItem || '건설자재, 용품외')}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;
        } else {
            // [공급자 미포함]: 제목 및 수신처/일자 중앙 정렬 레이아웃 (간단한 제안 리스트/단가표 전용)
            headerContainerHtml = `
                <div class="header-container no-supplier">
                    <div class="title-box">
                        <h1 id="printTitle">${escHtml(title)}</h1>
                    </div>
                    ${recipientHtml}
                    ${dateInfoHtml}
                </div>
            `;
        }

        const html = `
            <div class="a4-quote-page">
                <!-- 1. 상단 헤더 컨테이너 (공급자/수신처 옵션에 따른 가변 레이아웃) -->
                ${headerContainerHtml}

                <!-- 2. 금액란 (사용자 요청: 합 계 금 액 : ₩ 3,410,880) -->
                ${amountBoxHtml}

                <!-- 3. 견적 품목 테이블 -->
                <table class="a4-items-table" style="width: 100%; border-collapse: collapse; border-top: 2px solid #000; border-bottom: 2px solid #000;">
                    <thead>
                        <tr>
                            <th style="width: 32px;">No.</th>
                            ${showImg ? '<th style="width: 50px;">사진</th>' : ''}
                            <th>품목명 및 사양</th>
                            <th style="width: 90px;">규격</th>
                            <th style="width: 45px;">수량</th>
                            <th style="width: 40px;">단위</th>
                            ${priceHeaders}
                            <th style="width: 80px;">비고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                    </tbody>
                    ${tfootHtml}
                </table>

                <!-- 4. 하단 특기사항 및 납품조건 -->
                ${notesHtml}
            </div>
        `;

        printArea.innerHTML = html;
    },

    // ── 엑셀 다운로드 ──
    exportCurrentExcel: function() {
        if (!this.currentQuote || !this.currentQuote.items) return;
        const q = this.currentQuote;
        const data = [
            ["견적번호", q.quote_number || '', "견적일자", q.issue_date || ''],
            ["수신처", q.customer_name || '', "담당자", q.customer_attn || ''],
            ["건명", q.project_name || '', "총금액", q.total_amount || 0],
            [],
            ["No.", "품목명", "규격", "수량", "단위", "단가", "공급가액", "세액", "합계", "비고"]
        ];

        q.items.forEach((it, idx) => {
            data.push([
                idx + 1, it.product_name, it.spec, it.qty, it.unit,
                it.unit_price, it.supply_price, it.vat, it.total_price, it.remarks
            ]);
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "견적서");
        XLSX.writeFile(wb, `견적서_${q.customer_name || '고객사'}_${q.issue_date || ''}.xlsx`);
    },

    exportListExcel: function() {
        if (!this.quotations || this.quotations.length === 0) {
            showToast('내보낼 견적서가 없습니다.', 'warning');
            return;
        }

        const data = [
            ["No.", "견적번호", "견적일자", "수신처(거래처)", "건명/품목요약", "품목수", "총금액", "상태", "작성자"]
        ];

        this.quotations.forEach((q, idx) => {
            data.push([
                idx + 1, q.quote_number, q.issue_date, q.customer_name,
                q.project_name || q.first_item_name || '', q.item_count || 0,
                q.total_amount, q.status, q.author
            ]);
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, "견적서목록");
        XLSX.writeFile(wb, `견적서목록_${new Date().toISOString().slice(0, 10)}.xlsx`);
    },

    // ── 공급자 설정 모달 ──
    openSupplierSettingsModal: function() {
        const s = this.supplierSettings;
        document.getElementById('setSupplierName').value = s.name;
        document.getElementById('setSupplierBizNum').value = s.bizNum;
        document.getElementById('setSupplierCeo').value = s.ceo;
        document.getElementById('setSupplierAddress').value = s.address;
        document.getElementById('setSupplierTel').value = s.tel;
        document.getElementById('setSupplierEmail').value = s.email;
        document.getElementById('setSupplierBank').value = s.bank;
        document.getElementById('setSealPreview').src = s.sealUrl || '../../assets/images/stamp.png';
        document.getElementById('supplierSettingsModal').style.display = 'block';
    },

    closeSupplierSettingsModal: function() {
        document.getElementById('supplierSettingsModal').style.display = 'none';
    },

    handleSealUpload: function(e) {
        if (!e.target.files || !e.target.files[0]) return;
        const file = e.target.files[0];
        const formData = new FormData();
        formData.append('image', file);

        authFetch('/api/quotations/upload', {
            method: 'POST',
            body: formData
        })
        .then(res => res.json())
        .then(res => {
            if (res.url) {
                this.supplierSettings.sealUrl = res.url;
                document.getElementById('setSealPreview').src = res.url;
                showToast('도장 이미지가 업로드되었습니다.', 'success');
            }
        })
        .catch(err => showToast('도장 업로드 실패: ' + err.message, 'error'));
    },

    saveSupplierSettings: function() {
        this.supplierSettings.name = document.getElementById('setSupplierName').value.trim();
        this.supplierSettings.bizNum = document.getElementById('setSupplierBizNum').value.trim();
        this.supplierSettings.ceo = document.getElementById('setSupplierCeo').value.trim();
        this.supplierSettings.address = document.getElementById('setSupplierAddress').value.trim();
        this.supplierSettings.tel = document.getElementById('setSupplierTel').value.trim();
        this.supplierSettings.email = document.getElementById('setSupplierEmail').value.trim();
        this.supplierSettings.bank = document.getElementById('setSupplierBank').value.trim();

        localStorage.setItem('kng_quote_supplier_settings', JSON.stringify(this.supplierSettings));
        this.applySupplierDisplay();
        this.closeSupplierSettingsModal();
        showToast('공급자 정보가 저장되었습니다.', 'success');
    },

    // ── 단축키 바인딩 (F2 신규, F8 저장, ESC 닫기) ──
    setupKeyboardShortcuts: function() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F2') {
                e.preventDefault();
                this.openNewEditor();
            } else if (e.key === 'F8') {
                if (this.currentView === 'editor') {
                    e.preventDefault();
                    this.saveQuotation();
                }
            } else if (e.key === 'Escape') {
                this.closeImageModal();
                this.closeItemImportModal();
                this.closeSupplierSettingsModal();
            }
        });
    },

    // ── 보관함 검색 초기화 ──
    resetFilters: function() {
        document.getElementById('searchKeyword').value = '';
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.querySelectorAll('#statusFilterGroup .erp-filter-chip').forEach(c => c.classList.remove('active'));
        document.querySelector('#statusFilterGroup [data-status="all"]')?.classList.add('active');
        this.fetchQuotations();
    },

    setStatusFilter: function(status) {
        document.querySelectorAll('#statusFilterGroup .erp-filter-chip').forEach(c => c.classList.toggle('active', c.dataset.status === status));
        this.fetchQuotations();
    },

    openNewEditor: function() {
        if (this.currentView === 'editor' && this.hasUnsavedChanges()) {
            if (!confirm('현재 작성 중이거나 변경된 견적서가 저장되지 않았습니다.\n새 견적서를 작성하시겠습니까?')) {
                return;
            }
        }
        this.switchView('editor', true);
        this.initNewQuotation(true);
    }
};

window.app = app;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}
