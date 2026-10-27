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
// ── 마진 계산 엔진 (방식 A: 매출총이익률 Gross Margin) ──
// 마진율(%) = ((제안단가 - 매입가) / 제안단가) * 100
// 역산 제안단가 = 매입가 / (1 - (마진율 / 100))
// ==========================================
function calcGrossMargin(costPrice, unitPrice) {
    const cost = Number(costPrice) || 0;
    const unit = Number(unitPrice) || 0;
    if (unit <= 0) {
        return { rate: 0, amount: 0 };
    }
    const amount = unit - cost;
    const rate = Math.round(((unit - cost) / unit) * 1000) / 10; // 소수점 1자리 반올림
    return { rate, amount };
}

function calcUnitFromGrossMargin(costPrice, marginRate) {
    const cost = Number(costPrice) || 0;
    let rate = Number(marginRate) || 0;
    if (rate >= 100) rate = 99.9; // 100% 이상일 때 나눗셈 0 방지
    if (rate <= -900) rate = -900;
    const factor = 1 - (rate / 100);
    if (factor <= 0) return cost;
    return Math.round(cost / factor);
}

// ── 품목 이미지 / 다중 썸네일 / 상세페이지 헬퍼 ──
function cleanImgUrl(url) {
    if (!url) return '';
    return String(url).split('#kng_media=')[0];
}

function extractItemMedia(it) {
    if (!it) return { thumbs: [], details: [], catalogFile: '' };
    let thumbs = Array.isArray(it.thumbnail_images) ? it.thumbnail_images.slice() : [];
    let details = Array.isArray(it.detail_images) ? it.detail_images.slice() : [];
    let catalogFile = '';

    if (typeof it.thumbnail_images === 'string' && it.thumbnail_images.trim().startsWith('[')) {
        try { thumbs = JSON.parse(it.thumbnail_images); } catch (e) {}
    }
    if (typeof it.detail_images === 'string' && it.detail_images.trim().startsWith('[')) {
        try { details = JSON.parse(it.detail_images); } catch (e) {}
    }

    if (it.image_url && String(it.image_url).includes('#kng_media=')) {
        try {
            const hashPart = String(it.image_url).split('#kng_media=')[1];
            const decoded = JSON.parse(decodeURIComponent(hashPart));
            if (thumbs.length === 0 && Array.isArray(decoded.t)) thumbs = decoded.t;
            if (details.length === 0 && Array.isArray(decoded.d)) details = decoded.d;
            if (decoded.c) catalogFile = decoded.c;
        } catch (e) {}
    }

    const baseImg = cleanImgUrl(it.image_url);
    thumbs = thumbs.map(cleanImgUrl).filter(Boolean);
    details = details.map(cleanImgUrl).filter(Boolean);

    if (thumbs.length === 0 && baseImg) {
        thumbs = [baseImg];
    }

    return { thumbs, details, catalogFile };
}

function syncItemMediaFields(it, catalogFile = '') {
    if (!it) return;
    const media = extractItemMedia(it);
    it.thumbnail_images = media.thumbs;
    it.detail_images = media.details;
    const mainImg = media.thumbs[0] || '';

    // Base64가 아닌 서버 URL 위주일 때는 image_url 뒤에 #kng_media 해시를 붙여 구버전 DB에서도 다중 사진이 100% 보존되게 처리
    const hasHeavyDataUri = media.thumbs.some(u => u.startsWith('data:')) || media.details.some(u => u.startsWith('data:'));
    if (!hasHeavyDataUri && (media.thumbs.length > 1 || media.details.length > 0 || catalogFile || media.catalogFile)) {
        const metaPayload = {
            t: media.thumbs,
            d: media.details
        };
        if (catalogFile || media.catalogFile) {
            metaPayload.c = catalogFile || media.catalogFile;
        }
        const baseForHash = mainImg || (media.details[0] || '');
        it.image_url = baseForHash ? `${baseForHash}#kng_media=${encodeURIComponent(JSON.stringify(metaPayload))}` : '';
    } else {
        it.image_url = mainImg;
    }
}

// ==========================================
// 애플리케이션 메인 엔진
// ==========================================
const app = {
    currentView: 'list', // 'list' | 'editor'
    quotations: [],
    currentQuote: null,
    editingItemIndexForImage: null,
    pasteTargetMode: 'thumb', // 'thumb' | 'detail'
    modalMediaState: {
        thumbs: [],
        details: []
    },
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
        this.checkShortUrlRoute();
        this.getCatalogHtmlTemplate();

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
            cost: Number(it.cost_price) || 0,
            price: Number(it.unit_price) || 0,
            remarks: it.remarks || '',
            internal_remarks: it.internal_remarks || '',
            img: it.image_url || '',
            thumbs: it.thumbnail_images || [],
            details: it.detail_images || []
        }));

        const rows = document.querySelectorAll('#quoteItemsTbody tr[data-index]');
        rows.forEach(tr => {
            const idx = parseInt(tr.dataset.index, 10);
            if (items[idx]) {
                const nameEl = tr.querySelector('input[placeholder*="품목명"]');
                const specEl = tr.querySelector('input[placeholder*="규격"]');
                const qtyEl = tr.querySelector('input[type="number"]');
                const unitEl = tr.querySelector('input[style*="width:45px"]') || tr.querySelectorAll('input[type="text"]')[2];
                const costEl = tr.querySelector('.cost-price-input');
                const priceEl = tr.querySelector('input.text-end.fw-bold.text-primary') || tr.querySelectorAll('input[type="number"]')[1];
                const remarksEl = tr.querySelector('input[placeholder*="비고"]');

                if (nameEl) items[idx].name = nameEl.value.trim();
                if (specEl) items[idx].spec = specEl.value.trim();
                if (qtyEl) items[idx].qty = Number(qtyEl.value) || 0;
                if (unitEl) items[idx].unit = unitEl.value.trim();
                if (costEl) items[idx].cost = Number(String(costEl.value).replace(/[^0-9.-]/g, '')) || 0;
                if (priceEl) items[idx].price = Number(String(priceEl.value).replace(/[^0-9.-]/g, '')) || 0;
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
            includeSeal: (this.currentQuote?.include_seal !== undefined) ? this.currentQuote.include_seal : 1,
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

    // ── 공급자 설정 로드 & 서버 동기화 (모든 PC 공통 유지) ──
    sanitizeLegacySupplier: function(obj) {
        if (!obj) return obj;
        if (obj.bizNum === '687-87-03314' || obj.ceo === '박 준' || obj.ceo === '박준') {
            obj.bizNum = '845-88-00551';
            obj.ceo = '윤종';
            obj.address = '서울시 강동구 구천면로 159, 1층 2호, 3호';
        }
        return obj;
    },

    loadSupplierSettings: function() {
        try {
            const saved = localStorage.getItem('kng_quote_supplier_settings');
            if (saved) {
                const parsed = this.sanitizeLegacySupplier(JSON.parse(saved));
                this.supplierSettings = Object.assign({}, this.supplierSettings, parsed);
                localStorage.setItem('kng_quote_supplier_settings', JSON.stringify(this.supplierSettings));
            }
        } catch(e) {}
        this.applySupplierDisplay();

        // 서버 중앙 공급자 설정 조회하여 모든 PC 간 자동 동기화
        authFetch(`${API_BASE}/settings/supplier`)
            .then(res => res.ok ? res.json() : null)
            .then(serverSettings => {
                if (serverSettings && serverSettings.name) {
                    const clean = this.sanitizeLegacySupplier(serverSettings);
                    this.supplierSettings = Object.assign({}, this.supplierSettings, clean);
                    try {
                        localStorage.setItem('kng_quote_supplier_settings', JSON.stringify(this.supplierSettings));
                    } catch (e) {}
                    this.applySupplierDisplay();
                }
            })
            .catch(() => {});
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
            vat_type: 'inclusive',
            total_supply_price: 0,
            total_vat: 0,
            total_amount: 0,
            notes_instructions: '1. 상기 견적금액은 부가세(VAT) 포함 기준입니다.\n2. 견적 유효기간은 견적일로부터 15일간 유효합니다.\n3. 사양 및 수량 변경 시 견적단가가 변동될 수 있습니다.',
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
        document.getElementById('vatTypeSelect').value = q.vat_type || 'inclusive';
        document.getElementById('notesInstructions').value = q.notes_instructions || '';
        if (document.getElementById('optShowImages')) document.getElementById('optShowImages').checked = (q.show_images !== 0);
        if (document.getElementById('optIncludeSeal')) document.getElementById('optIncludeSeal').checked = (q.include_seal !== 0);
        this.toggleImageColumn(q.show_images !== 0);

        // 서버에 저장된 견적서의 공급자 정보가 있으면 우선 반영
        if (q.supplier_name && q.supplier_biz_num && q.supplier_biz_num !== '687-87-03314') {
            this.supplierSettings = Object.assign({}, this.supplierSettings, {
                name: q.supplier_name,
                bizNum: q.supplier_biz_num,
                ceo: q.supplier_ceo || this.supplierSettings.ceo,
                address: q.supplier_address || this.supplierSettings.address,
                tel: q.supplier_tel || this.supplierSettings.tel,
                email: q.supplier_email || this.supplierSettings.email,
                bank: q.supplier_bank || this.supplierSettings.bank
            });
            this.applySupplierDisplay();
        }
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
                // 가장 최근 저장된 서버 견적서의 공급자 정보로 다른 PC 간 동기화 보조
                const latestWithSupplier = this.quotations.find(q => q.supplier_name && q.supplier_biz_num && q.supplier_biz_num !== '687-87-03314');
                if (latestWithSupplier) {
                    this.supplierSettings = Object.assign({}, this.supplierSettings, {
                        name: latestWithSupplier.supplier_name,
                        bizNum: latestWithSupplier.supplier_biz_num,
                        ceo: latestWithSupplier.supplier_ceo || this.supplierSettings.ceo,
                        address: latestWithSupplier.supplier_address || this.supplierSettings.address,
                        tel: latestWithSupplier.supplier_tel || this.supplierSettings.tel,
                        email: latestWithSupplier.supplier_email || this.supplierSettings.email,
                        bank: latestWithSupplier.supplier_bank || this.supplierSettings.bank
                    });
                    try {
                        localStorage.setItem('kng_quote_supplier_settings', JSON.stringify(this.supplierSettings));
                    } catch (e) {}
                    this.applySupplierDisplay();
                }
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
                            <button type="button" class="btn-erp" style="height:20px; font-size:10px; padding:0 5px;" onclick="app.openQrPreviewById('${escHtml(q.id)}')" title="QR 코드 및 모바일 제품 상세페이지 보기">
                                <i class='bx bx-qr-scan text-primary'></i> QR
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
            tbody.innerHTML = `<tr><td colspan="14" class="text-center py-4 text-muted">등록된 품목이 없습니다. 상단 [불러오기] 또는 [직접 추가] 버튼을 클릭하세요.</td></tr>`;
            return;
        }

        const rows = items.map((it, idx) => {
            const media = extractItemMedia(it);
            const mainThumb = media.thumbs[0] || cleanImgUrl(it.image_url);
            const hasImg = !!mainThumb;
            let badgeHtml = '';
            if (media.details.length > 0) {
                badgeHtml = `<span class="quote-item-thumb-badge has-detail">상세 ${media.details.length}</span>`;
            } else if (media.thumbs.length > 1) {
                badgeHtml = `<span class="quote-item-thumb-badge">+${media.thumbs.length - 1}장</span>`;
            }
            const thumbHtml = hasImg
                ? `<img src="${escHtml(mainThumb)}" class="quote-item-thumb-img" alt="사진">${badgeHtml}`
                : `<div class="quote-item-thumb-empty"><i class='bx bx-camera'></i><span>사진/상세</span></div>${badgeHtml}`;

            // 방식 A: 매출총이익률 마진 계산
            const margin = calcGrossMargin(it.cost_price, it.unit_price);
            const qty = Number(it.qty) || 1;
            const totalMarginAmt = margin.amount * qty;

            return `
                <tr data-index="${idx}">
                    <td class="text-center text-muted" style="font-size:10.5px;">${idx + 1}</td>
                    <!-- 사진 썸네일 [클릭 시 업로드/변경] -->
                    <td class="col-item-img text-center p-1">
                        <div class="quote-item-thumb-box" onclick="app.openImageModal(${idx})" title="클릭: 제품 사진(슬라이드) 및 상세페이지(스크롤) 이미지 등록 (사진 ${media.thumbs.length}장 / 상세 ${media.details.length}장)">
                            ${thumbHtml}
                        </div>
                    </td>
                    <!-- 품목명 -->
                    <td>
                        <input type="text" data-col-field="product_name" class="form-control form-control-sm border-0 bg-transparent fw-semibold" value="${escHtml(it.product_name)}" placeholder="품목명 입력" oninput="app.updateItemField(${idx}, 'product_name', this.value)">
                    </td>
                    <!-- 규격 -->
                    <td>
                        <input type="text" data-col-field="spec" class="form-control form-control-sm border-0 bg-transparent text-center" value="${escHtml(it.spec)}" placeholder="규격/사양" onfocus="this.select()" oninput="app.updateItemField(${idx}, 'spec', this.value)">
                    </td>
                    <!-- 수량 -->
                    <td class="px-1">
                        <input type="number" data-col-field="qty" class="form-control form-control-sm border-0 bg-transparent text-center fw-bold qty-input px-0" min="1" value="${it.qty || 1}" onfocus="this.select()" oninput="app.updateItemField(${idx}, 'qty', this.value)">
                    </td>
                    <!-- 단위 -->
                    <td class="px-1">
                        <input type="text" data-col-field="unit" class="form-control form-control-sm border-0 bg-transparent text-center px-0" value="${escHtml(it.unit || 'EA')}" style="width:45px; margin:0 auto;" onfocus="this.select()" oninput="app.updateItemField(${idx}, 'unit', this.value)">
                    </td>
                    <!-- 매입가 (수정 가능 - 원가) -->
                    <td class="col-cost">
                        <input type="text"
                               data-col-field="cost_price"
                               inputmode="numeric"
                               class="form-control form-control-sm border-0 bg-transparent text-end pe-2 cost-price-input"
                               value="${fmtWon(it.cost_price || 0)}"
                               data-cost-idx="${idx}"
                               title="실제 매입단가(원가) - 마진 계산의 기준값"
                               oninput="app.formatCostInput(this, ${idx})"
                               onfocus="this.select()"
                               onblur="app.formatCostBlur(this, ${idx})">
                    </td>
                    <!-- 제안단가 (원화기호 ₩ 및 3자리 콤마 포맷팅) -->
                    <td>
                        <input type="text"
                               data-col-field="unit_price"
                               inputmode="numeric"
                               class="form-control form-control-sm border-0 bg-transparent text-end fw-bold text-primary pe-2"
                               value="${fmtWon(it.unit_price || 0)}"
                               data-idx="${idx}"
                               oninput="app.formatPriceInput(this, ${idx})"
                               onfocus="this.select()"
                               onblur="app.formatPriceBlur(this, ${idx})">
                    </td>
                    <!-- 공급가액 -->
                    <td class="text-end pe-2 fw-semibold" id="cellSupply_${idx}">${fmtWon(it.supply_price || 0)}</td>
                    <!-- 세액 -->
                    <td class="text-end pe-2 text-dark" id="cellVat_${idx}">${(this.currentQuote?.vat_type === 'exclusive') ? '별도' : fmtWon(it.vat || 0)}</td>
                    <!-- 합계 -->
                    <td class="text-end pe-2 fw-bold text-dark" id="cellTotal_${idx}">${fmtWon(it.total_price || 0)}</td>
                    <!-- 마진율(마진액) 2단 복합 셀 [가로공간 최적화 & 양방향 역산] -->
                    <td class="text-center p-1">
                        <div class="margin-compact-cell">
                            <div class="margin-rate-input-wrap">
                                <input type="number"
                                       data-col-field="margin_rate"
                                       step="0.1"
                                       class="margin-rate-input"
                                       id="inputMarginRate_${idx}"
                                       value="${margin.rate}"
                                       title="마진율(%) 입력 시 제안단가가 자동 역산됩니다 (매출총이익률 기준)"
                                       onfocus="this.select()"
                                       oninput="app.updateItemMarginRate(${idx}, this.value)">
                                <span class="margin-rate-unit">%</span>
                            </div>
                            <div class="margin-amount-disp" id="cellMarginAmt_${idx}" title="단가당 마진: ${fmtWon(margin.amount)} / 총 마진: ${fmtWon(totalMarginAmt)}">
                                ${fmtWon(margin.amount)}
                            </div>
                        </div>
                    </td>
                    <!-- 비고 (외부 발송용 + 사내 검토용 2단 분리 입력) -->
                    <td class="p-1">
                        <div class="remarks-compact-cell">
                            <input type="text"
                                   data-col-field="remarks"
                                   class="form-control form-control-sm ext-remarks-input"
                                   value="${escHtml(it.remarks || '')}"
                                   placeholder="외부 비고"
                                   title="고객 발송용 견적서에 인쇄되는 공식 비고"
                                   oninput="app.updateItemField(${idx}, 'remarks', this.value)">
                            <div class="internal-remarks-wrap" title="사내 검토용 전용 비고 (외부 발송 견적서에는 절대 비공개)">
                                <i class='bx bx-lock-alt' title="사내 전용"></i>
                                <input type="text"
                                       data-col-field="internal_remarks"
                                       class="int-remarks-input"
                                       value="${escHtml(it.internal_remarks || '')}"
                                       placeholder="사내 비고 (내부 전용)"
                                       oninput="app.updateItemField(${idx}, 'internal_remarks', this.value)">
                            </div>
                        </div>
                    </td>
                    <!-- 관리 (복사 / 삭제) -->
                    <td class="text-center no-print p-0">
                        <div class="d-flex justify-content-center align-items-center gap-1">
                            <button type="button" class="btn btn-sm btn-link text-primary p-0" onclick="app.duplicateRow(${idx})" title="이 품목 복사하여 추가 (사진·단가·규격 동일 복제)">
                                <i class='bx bx-copy fs-6'></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.removeRow(${idx})" title="삭제">
                                <i class='bx bx-x fs-5'></i>
                            </button>
                        </div>
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
            const rawNum = (typeof val === 'string') ? Number(val.replace(/[^0-9.-]/g, '')) : Number(val);
            it[field] = isNaN(rawNum) ? 0 : rawNum;
            const vatType = document.getElementById('vatTypeSelect')?.value || 'inclusive';
            const qty = Number(it.qty) || 0;
            const price = Number(it.unit_price) || 0;
            const baseAmount = Math.round(qty * price);

            if (vatType === 'exclusive') {
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            } else if (vatType === 'inclusive') {
                it.supply_price = baseAmount;
                it.vat = Math.round(baseAmount * 0.1);
                it.total_price = it.supply_price + it.vat;
            } else {
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

            // 마진 표시 동기화
            this.syncItemMarginDisplay(idx);
            this.recalcTotals();
        } else {
            it[field] = val;
        }
    },

    // ── 매입가(원가) 입력 실시간 포맷팅 ──
    formatCostInput: function(el, idx) {
        const rawDigits = el.value.replace(/[^0-9]/g, '');
        const num = rawDigits ? parseInt(rawDigits, 10) : 0;

        if (this.currentQuote?.items && this.currentQuote.items[idx]) {
            this.currentQuote.items[idx].cost_price = num;
            this.syncItemMarginDisplay(idx);
            this.recalcTotals();
        }

        if (rawDigits === '') {
            el.value = '₩';
            try { el.setSelectionRange(1, 1); } catch(e) {}
        } else {
            const prevVal = el.value;
            const curEnd = el.selectionEnd || prevVal.length;
            const digitsRight = prevVal.slice(curEnd).replace(/[^0-9]/g, '').length;
            const formatted = fmtWon(num);
            el.value = formatted;

            let newPos = formatted.length;
            let counted = 0;
            for (let i = formatted.length - 1; i >= 0; i--) {
                if (/\d/.test(formatted[i])) {
                    counted++;
                    if (counted === digitsRight) {
                        newPos = i;
                        break;
                    }
                }
            }
            if (newPos < 1) newPos = 1;
            try { el.setSelectionRange(newPos, newPos); } catch(e) {}
        }
    },

    formatCostBlur: function(el, idx) {
        const rawDigits = el.value.replace(/[^0-9]/g, '');
        const num = rawDigits ? parseInt(rawDigits, 10) : 0;
        el.value = fmtWon(num);
        if (this.currentQuote?.items && this.currentQuote.items[idx]) {
            this.currentQuote.items[idx].cost_price = num;
            this.syncItemMarginDisplay(idx);
            this.recalcTotals();
        }
    },

    // ── 제안 단가 입력 실시간 포맷팅 (원화 ₩ 기호 및 3자리 콤마) ──
    formatPriceInput: function(el, idx) {
        const rawDigits = el.value.replace(/[^0-9]/g, '');
        const num = rawDigits ? parseInt(rawDigits, 10) : 0;

        // 품목 데이터 모델 및 금액 실시간 연동
        if (this.currentQuote?.items && this.currentQuote.items[idx]) {
            this.updateItemField(idx, 'unit_price', num);
        }

        if (rawDigits === '') {
            el.value = '₩';
            try { el.setSelectionRange(1, 1); } catch(e) {}
        } else {
            const prevVal = el.value;
            const curEnd = el.selectionEnd || prevVal.length;
            const digitsRight = prevVal.slice(curEnd).replace(/[^0-9]/g, '').length;

            const formatted = fmtWon(num);
            el.value = formatted;

            let newPos = formatted.length;
            let counted = 0;
            for (let i = formatted.length - 1; i >= 0; i--) {
                if (/\d/.test(formatted[i])) {
                    counted++;
                    if (counted === digitsRight) {
                        newPos = i;
                        break;
                    }
                }
            }
            if (newPos < 1) newPos = 1;
            try { el.setSelectionRange(newPos, newPos); } catch(e) {}
        }
    },

    formatPriceBlur: function(el, idx) {
        const rawDigits = el.value.replace(/[^0-9]/g, '');
        const num = rawDigits ? parseInt(rawDigits, 10) : 0;
        el.value = fmtWon(num);
        if (this.currentQuote?.items && this.currentQuote.items[idx]) {
            this.updateItemField(idx, 'unit_price', num);
        }
    },

    // ── 마진율 입력 시 제안단가 역산 및 실시간 연동 (방식 A: 매출총이익률) ──
    updateItemMarginRate: function(idx, rateVal) {
        if (!this.currentQuote?.items || !this.currentQuote.items[idx]) return;
        const it = this.currentQuote.items[idx];
        const rateNum = parseFloat(rateVal) || 0;

        // 역산: 제안단가 = 매입가 / (1 - (마진율 / 100))
        const newUnitPrice = calcUnitFromGrossMargin(it.cost_price, rateNum);
        it.unit_price = newUnitPrice;

        // 제안단가 인풋 DOM 갱신
        const tr = document.querySelector(`#quoteItemsTbody tr[data-index="${idx}"]`);
        if (tr) {
            const priceInput = tr.querySelector(`input[data-idx="${idx}"]`);
            if (priceInput) priceInput.value = fmtWon(newUnitPrice);
        }

        // 수량 및 과세구분에 따른 금액 재계산
        const vatType = document.getElementById('vatTypeSelect')?.value || 'inclusive';
        const qty = Number(it.qty) || 0;
        const baseAmount = Math.round(qty * newUnitPrice);

        if (vatType === 'exclusive') {
            it.supply_price = baseAmount;
            it.vat = 0;
            it.total_price = baseAmount;
        } else if (vatType === 'inclusive') {
            it.supply_price = baseAmount;
            it.vat = Math.round(baseAmount * 0.1);
            it.total_price = it.supply_price + it.vat;
        } else {
            it.supply_price = baseAmount;
            it.vat = 0;
            it.total_price = baseAmount;
        }

        const cellS = document.getElementById(`cellSupply_${idx}`);
        const cellV = document.getElementById(`cellVat_${idx}`);
        const cellT = document.getElementById(`cellTotal_${idx}`);
        if (cellS) cellS.textContent = fmtWon(it.supply_price);
        if (cellV) cellV.textContent = (vatType === 'exclusive') ? '별도' : fmtWon(it.vat);
        if (cellT) cellT.textContent = fmtWon(it.total_price);

        // 마진액 라벨 동기화
        const marginAmt = newUnitPrice - (Number(it.cost_price) || 0);
        const amtDiv = document.getElementById(`cellMarginAmt_${idx}`);
        if (amtDiv) {
            amtDiv.textContent = fmtWon(marginAmt);
            amtDiv.title = `단가당 마진: ${fmtWon(marginAmt)} / 총 마진: ${fmtWon(marginAmt * qty)}`;
        }

        this.recalcTotals();
    },

    // ── 특정 행의 마진 표시 동기화 (단가/매입가/수량 변경 시 호출) ──
    syncItemMarginDisplay: function(idx) {
        if (!this.currentQuote?.items || !this.currentQuote.items[idx]) return;
        const it = this.currentQuote.items[idx];
        const margin = calcGrossMargin(it.cost_price, it.unit_price);
        const qty = Number(it.qty) || 1;

        const rateInp = document.getElementById(`inputMarginRate_${idx}`);
        const amtDiv = document.getElementById(`cellMarginAmt_${idx}`);

        if (rateInp && document.activeElement !== rateInp) {
            rateInp.value = margin.rate;
        }
        if (amtDiv) {
            amtDiv.textContent = fmtWon(margin.amount);
            amtDiv.title = `단가당 마진: ${fmtWon(margin.amount)} / 총 마진: ${fmtWon(margin.amount * qty)}`;
        }
    },

    // ── 총 견적금액 및 실시간 마진 지표 재계산 ──
    recalcTotals: function() {
        const items = this.currentQuote.items || [];
        const vatType = document.getElementById('vatTypeSelect')?.value || 'inclusive';
        this.currentQuote.vat_type = vatType;

        let sumCost = 0;
        let sumSupply = 0;
        let sumVat = 0;
        let sumTotal = 0;

        items.forEach((it, idx) => {
            const qty = Number(it.qty) || 0;
            const price = Number(it.unit_price) || 0;
            const cost = Number(it.cost_price) || 0;
            const baseAmount = Math.round(qty * price);

            if (vatType === 'exclusive') {
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            } else if (vatType === 'inclusive') {
                it.supply_price = baseAmount;
                it.vat = Math.round(baseAmount * 0.1);
                it.total_price = it.supply_price + it.vat;
            } else {
                it.supply_price = baseAmount;
                it.vat = 0;
                it.total_price = baseAmount;
            }

            // 셀 DOM 동기화
            const cellS = document.getElementById(`cellSupply_${idx}`);
            const cellV = document.getElementById(`cellVat_${idx}`);
            const cellT = document.getElementById(`cellTotal_${idx}`);
            if (cellS) cellS.textContent = fmtWon(it.supply_price);
            if (cellV) cellV.textContent = (vatType === 'exclusive') ? '별도' : fmtWon(it.vat);
            if (cellT) cellT.textContent = fmtWon(it.total_price);

            sumCost += (cost * qty);
            sumSupply += it.supply_price;
            sumVat += it.vat;
            sumTotal += it.total_price;
        });

        this.currentQuote.total_cost_price = sumCost;
        this.currentQuote.total_supply_price = sumSupply;
        this.currentQuote.total_vat = sumVat;
        this.currentQuote.total_amount = sumTotal;

        // 마진 집계 (매출총이익률: (공급가합 - 매입원가합) / 공급가합)
        const sumMargin = sumSupply - sumCost;
        const avgMarginRate = sumSupply > 0 ? (Math.round((sumMargin / sumSupply) * 1000) / 10) : 0;
        this.currentQuote.total_margin_amount = sumMargin;
        this.currentQuote.avg_margin_rate = avgMarginRate;

        // 상단 요약 리본 엘리먼트 갱신
        const elCost = document.getElementById('sumCostPrice');
        const elMarginAmt = document.getElementById('sumMarginAmount');
        const elMarginRate = document.getElementById('sumMarginRate');
        const elSupply = document.getElementById('sumSupplyPrice');
        const elVat = document.getElementById('sumVat');
        const elTotal = document.getElementById('sumTotalAmount');
        const elKorean = document.getElementById('amountKoreanText');

        if (elCost) elCost.textContent = fmtWon(sumCost);
        if (elMarginAmt) elMarginAmt.textContent = fmtWon(sumMargin);
        if (elMarginRate) elMarginRate.textContent = `${avgMarginRate.toFixed(1)}%`;
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
            remarks: '',
            internal_remarks: ''
        });
        this.renderEditorItems();
        this.recalcTotals();
    },

    // ── 특정 행의 현재 DOM 입력값을 아이템 데이터 모델에 즉시 동기화 ──
    syncRowFromDOM: function(idx) {
        if (!this.currentQuote?.items || !this.currentQuote.items[idx]) return;
        const it = this.currentQuote.items[idx];
        const tr = document.querySelector(`#quoteItemsTbody tr[data-index="${idx}"]`);
        if (!tr) return;

        const nameEl = tr.querySelector('input[placeholder*="품목명"]');
        const specEl = tr.querySelector('input[placeholder*="규격"]');
        const qtyEl = tr.querySelector('input[type="number"]');
        const unitEl = tr.querySelector('input[style*="width:45px"]') || tr.querySelectorAll('input[type="text"]')[2];
        const costEl = tr.querySelector('.cost-price-input');
        const priceEl = tr.querySelector('input.text-end.fw-bold.text-primary') || tr.querySelectorAll('input[type="number"]')[1];
        const extRemarksEl = tr.querySelector('.ext-remarks-input') || tr.querySelector('input[placeholder*="비고"]');
        const intRemarksEl = tr.querySelector('.int-remarks-input');

        if (nameEl && nameEl.value.trim()) it.product_name = nameEl.value.trim();
        if (specEl) it.spec = specEl.value.trim();
        if (qtyEl) it.qty = Number(qtyEl.value) || 1;
        if (unitEl && unitEl.value.trim()) it.unit = unitEl.value.trim();
        if (costEl) it.cost_price = Number(String(costEl.value).replace(/[^0-9.-]/g, '')) || 0;
        if (priceEl) it.unit_price = Number(String(priceEl.value).replace(/[^0-9.-]/g, '')) || 0;
        if (extRemarksEl) it.remarks = extRemarksEl.value.trim();
        if (intRemarksEl) it.internal_remarks = intRemarksEl.value.trim();
    },

    // ── 품목 행 복제 (사진, 품목명, 규격, 단가 등 동일 내용으로 바로 다음 행 추가) ──
    duplicateRow: function(idx) {
        if (!this.currentQuote?.items || !this.currentQuote.items[idx]) return;
        this.syncRowFromDOM(idx);
        const src = this.currentQuote.items[idx];

        // 깊은 복제 (사진, 매입가, 단가, 규격, 단위, 비고 등 일체 유지)
        const cloned = Object.assign({}, src, {
            id: 'qi_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            seq: idx + 2
        });

        // 원본 품목 바로 다음 위치에 삽입하여 편리하게 수정할 수 있도록 지원
        this.currentQuote.items.splice(idx + 1, 0, cloned);
        this.currentQuote.items.forEach((it, i) => { it.seq = i + 1; });

        this.renderEditorItems();
        this.recalcTotals();
        this.isDirty = true;
        showToast(`[${src.product_name || '품목'}] 복제되었습니다. 규격/단가를 수정하세요.`, 'success');
    },

    // 행 삭제
    removeRow: function(idx) {
        this.currentQuote.items.splice(idx, 1);
        this.currentQuote.items.forEach((it, i) => { it.seq = i + 1; });
        this.renderEditorItems();
        this.recalcTotals();
        this.isDirty = true;
    },

    // 사진 컬럼 토글
    toggleImageColumn: function(show) {
        document.querySelectorAll('.col-item-img').forEach(el => {
            el.style.display = show ? '' : 'none';
        });
    },

    // ═══════════════════════════════════════════════════════════════
    // 품목별 다중 사진(슬라이드) & 상세페이지(스크롤) 첨부 및 클립보드 붙여넣기
    // ═══════════════════════════════════════════════════════════════
    openImageModal: function(idx) {
        this.editingItemIndexForImage = idx;
        this.syncRowFromDOM(idx);
        const it = this.currentQuote.items[idx];
        const modal = document.getElementById('imageUploadModal');
        const media = extractItemMedia(it);

        this.modalMediaState = {
            thumbs: media.thumbs.slice(),
            details: media.details.slice()
        };

        const titleBadge = document.getElementById('imageModalItemTitle');
        if (titleBadge) {
            titleBadge.textContent = `품목 #${idx + 1}: ${it.product_name || '미입력 품목'}`;
        }

        const thumbUrlInp = document.getElementById('modalImageUrlInput');
        const detailUrlInp = document.getElementById('modalDetailUrlInput');
        if (thumbUrlInp) thumbUrlInp.value = '';
        if (detailUrlInp) detailUrlInp.value = '';

        this.renderModalMediaLists();
        modal.style.display = 'block';
    },

    closeImageModal: function() {
        const modal = document.getElementById('imageUploadModal');
        if (modal) modal.style.display = 'none';
        this.editingItemIndexForImage = null;
    },

    renderModalMediaLists: function() {
        const thumbs = this.modalMediaState.thumbs || [];
        const details = this.modalMediaState.details || [];

        const thumbBadge = document.getElementById('badgeThumbCount');
        const detailBadge = document.getElementById('badgeDetailCount');
        if (thumbBadge) thumbBadge.textContent = `${thumbs.length}장`;
        if (detailBadge) detailBadge.textContent = `${details.length}장`;

        const thumbListEl = document.getElementById('modalThumbList');
        if (thumbListEl) {
            if (thumbs.length === 0) {
                thumbListEl.innerHTML = `<div class="text-center text-muted py-4" style="grid-column: 1 / -1; font-size: 11px;">등록된 제품 사진이 없습니다.<br>위 영역을 클릭하거나 파일을 드래그하세요.</div>`;
            } else {
                thumbListEl.innerHTML = thumbs.map((url, i) => `
                    <div class="media-thumb-card ${i === 0 ? 'is-main' : ''}">
                        ${i === 0 ? `<span class="media-thumb-badge">대표</span>` : `<span class="media-thumb-badge" style="background:#64748b;">#${i + 1}</span>`}
                        <img src="${escHtml(url)}" alt="썸네일 ${i + 1}">
                        <div class="media-card-actions">
                            <div class="d-flex gap-1">
                                <button type="button" class="media-ctrl-btn" onclick="app.moveModalMedia('thumb', ${i}, -1)" ${i === 0 ? 'disabled' : ''} title="앞으로 이동">◀</button>
                                <button type="button" class="media-ctrl-btn" onclick="app.moveModalMedia('thumb', ${i}, 1)" ${i === thumbs.length - 1 ? 'disabled' : ''} title="뒤로 이동">▶</button>
                            </div>
                            <button type="button" class="media-ctrl-btn danger" onclick="app.removeModalMedia('thumb', ${i})" title="삭제">✕</button>
                        </div>
                    </div>
                `).join('');
            }
        }

        const detailListEl = document.getElementById('modalDetailList');
        if (detailListEl) {
            if (details.length === 0) {
                detailListEl.innerHTML = `<div class="text-center text-muted py-4" style="font-size: 11px;">등록된 상세페이지 이미지가 없습니다.<br>위 영역을 클릭하거나 상세 이미지를 드래그하세요.</div>`;
            } else {
                detailListEl.innerHTML = details.map((url, i) => {
                    const shortName = url.startsWith('data:') ? '로컬 이미지 데이터' : (url.split('/').pop() || url);
                    return `
                        <div class="media-detail-row">
                            <span class="media-detail-seq">#${i + 1}</span>
                            <img src="${escHtml(url)}" alt="상세 ${i + 1}">
                            <div class="media-detail-info" title="${escHtml(shortName)}">${escHtml(shortName)}</div>
                            <div class="d-flex gap-1">
                                <button type="button" class="media-ctrl-btn" onclick="app.moveModalMedia('detail', ${i}, -1)" ${i === 0 ? 'disabled' : ''} title="위로 이동">▲</button>
                                <button type="button" class="media-ctrl-btn" onclick="app.moveModalMedia('detail', ${i}, 1)" ${i === details.length - 1 ? 'disabled' : ''} title="아래로 이동">▼</button>
                                <button type="button" class="media-ctrl-btn danger" onclick="app.removeModalMedia('detail', ${i})" title="삭제">✕</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    },

    moveModalMedia: function(target, idx, dir) {
        const arr = target === 'detail' ? this.modalMediaState.details : this.modalMediaState.thumbs;
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= arr.length) return;
        const temp = arr[idx];
        arr[idx] = arr[newIdx];
        arr[newIdx] = temp;
        this.renderModalMediaLists();
    },

    removeModalMedia: function(target, idx) {
        const arr = target === 'detail' ? this.modalMediaState.details : this.modalMediaState.thumbs;
        arr.splice(idx, 1);
        this.renderModalMediaLists();
    },

    addUrlToModalMedia: function(target) {
        const inpId = target === 'detail' ? 'modalDetailUrlInput' : 'modalImageUrlInput';
        const inp = document.getElementById(inpId);
        if (!inp || !inp.value.trim()) return;
        const url = inp.value.trim();
        if (target === 'detail') {
            this.modalMediaState.details.push(url);
        } else {
            this.modalMediaState.thumbs.push(url);
        }
        inp.value = '';
        this.renderModalMediaLists();
    },

    setupImageDropzone: function() {
        const bindZone = (zoneId, targetType) => {
            const dz = document.getElementById(zoneId);
            if (!dz) return;
            dz.addEventListener('dragover', (e) => {
                e.preventDefault();
                dz.classList.add('dragover');
            });
            dz.addEventListener('dragleave', () => {
                dz.classList.remove('dragover');
            });
            dz.addEventListener('drop', (e) => {
                e.preventDefault();
                dz.classList.remove('dragover');
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    this.uploadMultipleFiles(Array.from(e.dataTransfer.files), targetType);
                }
            });
        };

        bindZone('thumbDropzone', 'thumb');
        bindZone('detailDropzone', 'detail');

        // 클립보드 붙여넣기 (Ctrl + V) 이벤트
        window.addEventListener('paste', (e) => {
            const modal = document.getElementById('imageUploadModal');
            if (modal && modal.style.display === 'block') {
                if (e.clipboardData && e.clipboardData.items) {
                    const files = [];
                    for (let i = 0; i < e.clipboardData.items.length; i++) {
                        const item = e.clipboardData.items[i];
                        if (item.type.indexOf('image') !== -1) {
                            const blob = item.getAsFile();
                            if (blob) files.push(blob);
                        }
                    }
                    if (files.length > 0) {
                        this.uploadMultipleFiles(files, this.pasteTargetMode || 'thumb');
                    }
                }
            }
        });
    },

    handleMultiImageSelect: function(e, targetType = 'thumb') {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            this.uploadMultipleFiles(files, targetType);
            e.target.value = '';
        }
    },

    uploadSingleFilePromise: function(file) {
        return new Promise((resolve) => {
            const formData = new FormData();
            formData.append('image', file);

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
                    resolve(fullUrl);
                } else {
                    throw new Error('업로드 실패');
                }
            })
            .catch(() => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve(ev.target.result);
                reader.onerror = () => resolve('');
                reader.readAsDataURL(file);
            });
        });
    },

    uploadMultipleFiles: async function(files, targetType = 'thumb') {
        if (!files || files.length === 0) return;
        showToast(`${files.length}장의 이미지를 업로드하는 중입니다...`, 'info');
        for (const file of files) {
            const uploadedUrl = await this.uploadSingleFilePromise(file);
            if (uploadedUrl) {
                if (targetType === 'detail') {
                    this.modalMediaState.details.push(uploadedUrl);
                } else {
                    this.modalMediaState.thumbs.push(uploadedUrl);
                }
                this.renderModalMediaLists();
            }
        }
        showToast(`${files.length}장의 이미지가 추가되었습니다!`, 'success');
    },

    applyModalImage: function() {
        if (this.editingItemIndexForImage === null) return;
        // URL 입력창에 미추가 상태로 남아있는 텍스트가 있으면 함께 반영
        this.addUrlToModalMedia('thumb');
        this.addUrlToModalMedia('detail');

        const it = this.currentQuote.items[this.editingItemIndexForImage];
        if (it) {
            it.thumbnail_images = this.modalMediaState.thumbs.slice();
            it.detail_images = this.modalMediaState.details.slice();
            syncItemMediaFields(it, this.currentQuote.catalog_url || '');
            this.isDirty = true;
        }
        this.renderEditorItems();
        this.closeImageModal();
        showToast('품목 사진 및 상세페이지가 적용되었습니다.', 'success');
    },

    removeCurrentImage: function() {
        if (this.editingItemIndexForImage === null) return;
        this.modalMediaState.thumbs = [];
        this.modalMediaState.details = [];
        this.renderModalMediaLists();
        const it = this.currentQuote.items[this.editingItemIndexForImage];
        if (it) {
            it.image_url = '';
            it.thumbnail_images = [];
            it.detail_images = [];
            this.isDirty = true;
        }
        this.renderEditorItems();
        this.closeImageModal();
        showToast('해당 품목의 사진 및 상세 이미지가 초기화되었습니다.', 'info');
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

        const vatType = document.getElementById('vatTypeSelect')?.value || 'inclusive';
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
    // 표준 견적번호 자동 채번 엔진 (QT-YYYYMMDD-001 형식으로 완전 단일화)
    // ═══════════════════════════════════════════════════════════════
    generateStandardQuoteNumber: function() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const prefix = `QT-${yyyy}${mm}${dd}-`;

        let nextSeq = 1;
        try {
            const localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
            const todayQuotes = localQuotes.filter(q => q.quote_number && String(q.quote_number).startsWith(prefix));
            if (todayQuotes.length > 0) {
                todayQuotes.sort((a, b) => String(b.quote_number || '').localeCompare(String(a.quote_number || '')));
                const parts = String(todayQuotes[0].quote_number).split('-');
                if (parts.length === 3) {
                    const lastSeq = parseInt(parts[2], 10);
                    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
                }
            }
        } catch(e) {}

        return `${prefix}${String(nextSeq).padStart(3, '0')}`;
    },

    // ═══════════════════════════════════════════════════════════════
    // 공개용 QR 카탈로그 스냅샷 업로드 & QR 코드 생성 엔진
    // ═══════════════════════════════════════════════════════════════
    extractCatalogFileFromQuote: function(q) {
        if (!q) return '';
        if (q.catalog_url) return q.catalog_url.replace(/^\/api\/quotations\/uploads\//, '');
        if (Array.isArray(q.items)) {
            for (const it of q.items) {
                const m = extractItemMedia(it);
                if (m.catalogFile) return m.catalogFile;
            }
        }
        return '';
    },

    buildPublicCatalogObject: function(q) {
        const s = this.supplierSettings;
        return {
            id: q.id || '',
            quote_number: q.quote_number || '',
            issue_date: q.issue_date || '',
            valid_until: q.valid_until || '',
            customer_name: q.customer_name || '',
            project_name: q.project_name || '',
            delivery_date: q.delivery_date || '',
            delivery_place: q.delivery_place || '',
            supplier_name: q.supplier_name || s.name || '주식회사 케이엔지',
            supplier_tel: q.supplier_tel || s.tel || '031-987-1203',
            supplier_email: q.supplier_email || s.email || 'contact@junparks.com',
            items: (q.items || []).map((it, idx) => {
                const media = extractItemMedia(it);
                return {
                    seq: idx + 1,
                    product_name: it.product_name || '',
                    spec: it.spec || '',
                    color: it.color || '',
                    unit: it.unit || 'EA',
                    qty: Number(it.qty) || 1,
                    image_url: media.thumbs[0] || cleanImgUrl(it.image_url) || '',
                    thumbnail_images: media.thumbs,
                    detail_images: media.details,
                    remarks: it.remarks || ''
                };
            })
        };
    },

    _catalogHtmlTemplate: null,
    shortUrlRouteReady: false,

    getCatalogHtmlTemplate: async function() {
        if (this._catalogHtmlTemplate) return this._catalogHtmlTemplate;
        try {
            const res = await fetch('./quote-catalog.html?v=' + Date.now());
            if (res.ok) {
                this._catalogHtmlTemplate = await res.text();
                return this._catalogHtmlTemplate;
            }
        } catch (e) {}
        return null;
    },

    checkShortUrlRoute: function() {
        fetch(`${SERVER_URL}/q/_ping`, { method: 'HEAD' })
            .then(res => { this.shortUrlRouteReady = res.ok; })
            .catch(() => { this.shortUrlRouteReady = false; });
    },

    uploadPublicCatalogSnapshot: async function(q) {
        try {
            const publicObj = this.buildPublicCatalogObject(q);
            const safeJson = JSON.stringify(publicObj).replace(/<\//g, '<\\/');
            const tpl = await this.getCatalogHtmlTemplate();

            let blob;
            let uploadName;
            if (tpl && tpl.includes('</head>')) {
                const injectedHtml = tpl.replace(
                    '</head>',
                    `<script>window.__EMBEDDED_QUOTE__ = ${safeJson};</script>\n</head>`
                );
                blob = new Blob([injectedHtml], { type: 'text/html;charset=utf-8' });
                uploadName = 'catalog.html';
            } else {
                blob = new Blob([safeJson], { type: 'application/json' });
                uploadName = 'catalog.json';
            }

            const formData = new FormData();
            formData.append('image', blob, uploadName);

            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) return '';
            const data = await res.json();
            if (data && data.filename) {
                q.catalog_url = data.filename;
                if (Array.isArray(q.items) && q.items.length > 0) {
                    syncItemMediaFields(q.items[0], data.filename);
                }
                return data.filename;
            }
        } catch (e) {
            console.warn('카탈로그 스냅샷 업로드 생략:', e);
        }
        return '';
    },

    getQuoteCatalogUrl: function(q, forLocalPreview = false) {
        const docNo = (q && (q.quote_number || q.id)) ? (q.quote_number || q.id) : this.generateStandardQuoteNumber();
        const catFile = this.extractCatalogFileFromQuote(q);

        if (catFile) {
            const cleanFile = catFile.replace(/^\/api\/quotations\/uploads\//, '');
            const shortCode = cleanFile.replace(/^item-/, '').replace(/\.(html|json)$/i, '');
            if (this.shortUrlRouteReady) {
                return `${SERVER_URL}/q/${encodeURIComponent(shortCode)}`;
            }
            if (cleanFile.toLowerCase().endsWith('.html')) {
                return `${SERVER_URL}/api/quotations/uploads/${encodeURIComponent(cleanFile)}`;
            }
            return `${SERVER_URL}/q/${encodeURIComponent(shortCode)}`;
        }

        return `${SERVER_URL}/q/${encodeURIComponent(docNo)}`;
    },

    generateQrSvgTag: function(url) {
        if (!url) return '';
        try {
            if (typeof window.qrcode === 'function') {
                const qr = window.qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                return qr.createSvgTag({ cellSize: 2, margin: 1, scalable: true });
            }
        } catch (e) {
            console.warn('QR SVG 생성 오류:', e);
        }
        return `<img src="https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=2&data=${encodeURIComponent(url)}" alt="QR">`;
    },

    syncCurrentEditorToQuoteObj: function() {
        if (!this.currentQuote) return null;
        const itemRows = document.querySelectorAll('#quoteItemsTbody tr[data-index]');
        if (itemRows.length > 0 && Array.isArray(this.currentQuote.items)) {
            itemRows.forEach(tr => {
                const idx = parseInt(tr.dataset.index, 10);
                this.syncRowFromDOM(idx);
            });
            this.recalcTotals();
        }
        this.currentQuote.customer_name = document.getElementById('custName')?.value.trim() || this.currentQuote.customer_name || '';
        this.currentQuote.project_name = document.getElementById('projectName')?.value.trim() || this.currentQuote.project_name || '';
        this.currentQuote.issue_date = document.getElementById('issueDate')?.value || this.currentQuote.issue_date || '';
        this.currentQuote.valid_until = document.getElementById('validUntil')?.value || this.currentQuote.valid_until || '';
        return this.currentQuote;
    },

    targetQuoteForQr: null,

    openQrPreviewModal: async function(quoteObj = null) {
        const q = quoteObj || this.syncCurrentEditorToQuoteObj();
        if (!q || !Array.isArray(q.items) || q.items.length === 0) {
            showToast('먼저 견적 품목을 1개 이상 추가해주세요.', 'warning');
            return;
        }
        if (!q.quote_number) {
            q.quote_number = this.generateStandardQuoteNumber();
        }
        this.targetQuoteForQr = q;

        // 로컬 미리보기 세션 저장
        try {
            localStorage.setItem('kng_qr_preview_quote', JSON.stringify(this.buildPublicCatalogObject(q)));
        } catch (e) {}

        // 서버 단독 HTML 카탈로그 스냅샷 업로드하여 포털 주소 완전 은폐 및 외부 즉시 열람 지원
        const existingCatFile = this.extractCatalogFileFromQuote(q);
        if (!existingCatFile || !existingCatFile.toLowerCase().endsWith('.html') || !quoteObj) {
            await this.uploadPublicCatalogSnapshot(q);
        }

        const qrUrl = this.getQuoteCatalogUrl(q, false);
        const svgContainer = document.getElementById('qrModalSvgContainer');
        if (svgContainer) {
            svgContainer.innerHTML = this.generateQrSvgTag(qrUrl);
        }

        const titleEl = document.getElementById('qrModalQuoteTitle');
        if (titleEl) {
            titleEl.textContent = `${q.customer_name || '고객사'} 귀중 (${q.quote_number})`;
        }

        let withPhotoCount = 0;
        let withDetailCount = 0;
        (q.items || []).forEach(it => {
            const m = extractItemMedia(it);
            if (m.thumbs.length > 0) withPhotoCount++;
            if (m.details.length > 0) withDetailCount++;
        });

        const summaryEl = document.getElementById('qrModalMediaSummary');
        if (summaryEl) {
            summaryEl.textContent = `총 ${q.items.length}개 품목 (제품사진 ${withPhotoCount}건 / 상세페이지 ${withDetailCount}건 등록됨)`;
        }

        const linkInp = document.getElementById('qrModalLinkInput');
        if (linkInp) linkInp.value = qrUrl;

        const modal = document.getElementById('qrPreviewModal');
        if (modal) modal.style.display = 'block';
    },

    openQrPreviewById: function(id) {
        authFetch(`${API_BASE}/${id}`)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then(quote => {
                this.openQrPreviewModal(quote);
            })
            .catch(() => {
                let localQuotes = [];
                try {
                    localQuotes = JSON.parse(localStorage.getItem('kng_quotations_cache') || localStorage.getItem('kng_quotations_local') || '[]');
                } catch(e) {}
                const found = localQuotes.find(q => String(q.id) === String(id));
                if (found) this.openQrPreviewModal(found);
                else showToast('견적서 정보를 찾을 수 없습니다.', 'error');
            });
    },

    closeQrPreviewModal: function() {
        const modal = document.getElementById('qrPreviewModal');
        if (modal) modal.style.display = 'none';
    },

    copyQrCatalogLink: function() {
        const inp = document.getElementById('qrModalLinkInput');
        if (!inp || !inp.value) return;
        navigator.clipboard.writeText(inp.value)
            .then(() => showToast('QR 제품 상세 카탈로그 링크가 복사되었습니다!', 'success'))
            .catch(() => {
                inp.select();
                document.execCommand('copy');
                showToast('링크가 복사되었습니다!', 'success');
            });
    },

    openMobileCatalogPreview: async function() {
        const q = this.targetQuoteForQr || this.syncCurrentEditorToQuoteObj();
        if (!q) return;
        try {
            localStorage.setItem('kng_qr_preview_quote', JSON.stringify(this.buildPublicCatalogObject(q)));
        } catch (e) {}
        if (!this.extractCatalogFileFromQuote(q)) {
            await this.uploadPublicCatalogSnapshot(q);
        }
        const previewUrl = this.getQuoteCatalogUrl(q, false);
        window.open(previewUrl, '_blank', 'width=480,height=860,scrollbars=yes,resizable=yes');
    },

    // ═══════════════════════════════════════════════════════════════
    // 견적서 저장 (API 호출)
    // ═══════════════════════════════════════════════════════════════
    saveQuotation: async function() {
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
                const costEl = tr.querySelector('.cost-price-input');
                const priceEl = tr.querySelector('input.text-end.fw-bold.text-primary') || tr.querySelectorAll('input[type="number"]')[1];
                const remarksEl = tr.querySelector('input[placeholder*="비고"]');

                if (nameEl && nameEl.value.trim()) item.product_name = nameEl.value.trim();
                if (specEl) item.spec = specEl.value.trim();
                if (qtyEl) item.qty = Number(qtyEl.value) || 1;
                if (unitEl && unitEl.value.trim()) item.unit = unitEl.value.trim();
                if (costEl) item.cost_price = Number(String(costEl.value).replace(/[^0-9.-]/g, '')) || 0;
                if (priceEl) item.unit_price = Number(String(priceEl.value).replace(/[^0-9.-]/g, '')) || 0;
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

        // 로컬 보관용 임시 ID 및 정규 표준 견적번호 채번 (QT-YYYYMMDD-001)
        const localBackupId = existingId || ('qt_' + Date.now());
        const localBackupQuoteNumber = this.currentQuote.quote_number || this.generateStandardQuoteNumber();

        const payload = Object.assign({}, this.currentQuote, {
            id: existingId || '',
            quote_number: localBackupQuoteNumber,
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
            show_images: document.getElementById('optShowImages')?.checked ? 1 : 0,
            include_seal: (this.currentQuote?.include_seal !== undefined) ? this.currentQuote.include_seal : 1,
            supplier_name: this.supplierSettings.name,
            supplier_biz_num: this.supplierSettings.bizNum,
            supplier_ceo: this.supplierSettings.ceo,
            supplier_address: this.supplierSettings.address,
            supplier_tel: this.supplierSettings.tel,
            supplier_email: this.supplierSettings.email,
            supplier_bank: this.supplierSettings.bank
        });

        showToast('견적서 및 QR 상세 카탈로그를 서버에 저장하는 중입니다...', 'info');

        // QR 모바일 카탈로그 정적 스냅샷 파일 서버 업로드 및 품목 미디어 해시 동기화
        const uploadedCatalogFile = await this.uploadPublicCatalogSnapshot(payload);
        payload.items.forEach((it, idx) => {
            syncItemMediaFields(it, idx === 0 ? uploadedCatalogFile : '');
        });

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

        // 1. 출력 구분 (external | both | internal)
        const targetMode = lastOpt.targetMode || 'external';
        const targetRadio = document.querySelector(`input[name="printTargetMode"][value="${targetMode}"]`);
        if (targetRadio) targetRadio.checked = true;
        this.handlePrintTargetChange(targetMode);

        // 2. 문서 대제목
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

        // 3. 금액 표시 모드
        const priceMode = lastOpt.priceMode || 'all';
        const radio = document.querySelector(`input[name="printPriceMode"][value="${priceMode}"]`);
        if (radio) radio.checked = true;

        // 4. 출력 세부 옵션
        if (document.getElementById('printOptWatermark')) {
            document.getElementById('printOptWatermark').checked = (lastOpt.includeWatermark !== false);
        }
        if (document.getElementById('printOptIncludeRecipient')) {
            document.getElementById('printOptIncludeRecipient').checked = (lastOpt.includeRecipient !== false);
        }
        if (document.getElementById('printOptIncludeSupplier')) {
            document.getElementById('printOptIncludeSupplier').checked = (lastOpt.includeSupplier !== false);
            this.togglePrintSupplierOption(lastOpt.includeSupplier !== false);
        }
        if (document.getElementById('printOptShowQr')) {
            document.getElementById('printOptShowQr').checked = (lastOpt.showQr !== false);
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

    // ── 인쇄 대상(출력 구분) 변경 시 안내 및 하위 옵션 가시성 처리 ──
    handlePrintTargetChange: function(mode) {
        const noticeEl = document.getElementById('printTargetNotice');
        const wrapWatermark = document.getElementById('wrapPrintOptWatermark');

        if (mode === 'both') {
            if (noticeEl) {
                noticeEl.innerHTML = `<i class='bx bx-check-double text-primary'></i> <b>내부+외부 모두 인쇄</b>: 1페이지는 사내 검토용(원가/마진/워터마크 포함), 2페이지는 외부 발송용(공식 견적서)으로 자동 분리 인쇄됩니다.`;
            }
            if (wrapWatermark) wrapWatermark.style.opacity = '1';
        } else if (mode === 'internal') {
            if (noticeEl) {
                noticeEl.innerHTML = `<i class='bx bx-shield-quarter text-warning'></i> <b>내부 검토용만 인쇄</b>: 매입단가, 마진액, 마진율 및 사내 검토용 워터마크가 포함된 1장의 사내 품의서입니다.`;
            }
            if (wrapWatermark) wrapWatermark.style.opacity = '1';
        } else {
            // external
            if (noticeEl) {
                noticeEl.innerHTML = `<i class='bx bx-send text-primary'></i> <b>외부 발송용만 인쇄</b>: 매입원가와 마진이 철저히 비공개된 고객 전달용 공식 견적서 1장입니다.`;
            }
            if (wrapWatermark) wrapWatermark.style.opacity = '0.4';
        }
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

    executePrintWithOptions: async function() {
        const q = this.targetQuoteForPrint || this.currentQuote;
        if (!q) return;

        const targetMode = document.querySelector('input[name="printTargetMode"]:checked')?.value || 'external';
        const title = document.getElementById('printCustomTitle')?.value.trim() || '견  적  서';
        const priceMode = document.querySelector('input[name="printPriceMode"]:checked')?.value || 'all';
        const includeWatermark = document.getElementById('printOptWatermark')?.checked !== false;
        const includeRecipient = document.getElementById('printOptIncludeRecipient')?.checked !== false;
        const includeSupplier = document.getElementById('printOptIncludeSupplier')?.checked !== false;
        const showQr = document.getElementById('printOptShowQr')?.checked !== false;
        const showImages = document.getElementById('printOptShowImages')?.checked !== false;
        const includeSeal = includeSupplier && (document.getElementById('printOptIncludeSeal')?.checked !== false);
        const includeNotes = document.getElementById('printOptIncludeNotes')?.checked !== false;

        const options = {
            targetMode: targetMode,
            title: title,
            priceMode: priceMode,
            includeWatermark: includeWatermark,
            includeRecipient: includeRecipient,
            includeSupplier: includeSupplier,
            showQr: showQr,
            showImages: showImages,
            includeSeal: includeSeal,
            includeNotes: includeNotes
        };

        try {
            localStorage.setItem('kng_last_print_options', JSON.stringify(options));
        } catch(e) {}

        this.closePrintOptionsModal();

        const existingCatFile = this.extractCatalogFileFromQuote(q);
        if (showQr && (!existingCatFile || !existingCatFile.toLowerCase().endsWith('.html') || this.currentView === 'editor')) {
            await this.uploadPublicCatalogSnapshot(q);
        }

        this.renderPrintArea(q, options);
        setTimeout(() => {
            window.print();
        }, 150);
    },

    printCurrentQuotation: function() {
        if (!this.currentQuote) return;
        this.syncCurrentEditorToQuoteObj();
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

    // ── A4 우측 상단 QR 코드 박스 HTML 생성 헬퍼 (PDF 클릭 이동 & 스마트폰 QR 스캔 겸용) ──
    buildA4QrBoxHtml: function(q, showQr, isFloating = false) {
        if (!showQr) return '';
        const qrUrl = this.getQuoteCatalogUrl(q, false);
        const svgTag = this.generateQrSvgTag(qrUrl);
        if (!svgTag) return '';
        return `
            <a href="${escHtml(qrUrl)}" target="_blank" rel="noopener noreferrer" class="a4-qr-box ${isFloating ? 'a4-qr-box-floating' : ''}" title="클릭하거나 스마트폰으로 QR 스캔 시 제품 상세페이지로 이동합니다">
                <span class="a4-qr-pdf-hitarea">████████</span>
                <div class="a4-qr-svg-wrap">${svgTag}</div>
                <div class="a4-qr-caption">QR 스캔 / 클릭<br><span class="a4-qr-link-label">제품 상세보기</span></div>
            </a>
        `;
    },

    // ── 외부 발송용 정규 견적서 페이지 생성기 (원가/마진 비공개) ──
    generateExternalQuotePage: function(q, options, s) {
        const title = options.title || '견  적  서';
        const priceMode = options.priceMode || 'all';
        const includeRecipient = (typeof options.includeRecipient === 'boolean') ? options.includeRecipient : true;
        const includeSupplier = (typeof options.includeSupplier === 'boolean') ? options.includeSupplier : true;
        const showQr = (typeof options.showQr === 'boolean') ? options.showQr : (q.show_qr !== 0);
        const showImg = (typeof options.showImages === 'boolean') ? options.showImages : (q.show_images !== 0);
        const includeSeal = includeSupplier && ((typeof options.includeSeal === 'boolean') ? options.includeSeal : (q.include_seal !== 0));
        const includeNotes = (typeof options.includeNotes === 'boolean') ? options.includeNotes : true;
        const items = q.items || [];

        const isQuote = title.replace(/\s+/g, '').includes('견적');
        const dateLabel = isQuote ? '견적일자' : '작성일자';
        const projectLabel = isQuote ? '견적건명' : '건명';

        const sealHtml = (includeSeal && s.sealUrl)
            ? `<img src="${s.sealUrl}" class="stamp" alt="직인" onerror="this.style.display='none'">`
            : '';

        let amountBoxHtml = '';
        if (priceMode !== 'none') {
            amountBoxHtml = `
                <div class="amount-box">
                    <span>합 계 금 액 : ₩ ${fmtNum(q.total_amount)}</span>
                </div>
            `;
        }

        const itemRowsHtml = items.map((it, idx) => {
            const media = extractItemMedia(it);
            const mainThumb = media.thumbs[0] || cleanImgUrl(it.image_url);
            const imgCell = showImg
                ? `<td class="text-center" style="padding: 2px; overflow: hidden;">
                     ${mainThumb ? `<img src="${escHtml(mainThumb)}" class="a4-item-img" alt="사진">` : '<span style="color:#ccc; font-size:9px;">-</span>'}
                   </td>`
                : '';

            let priceCells = '';
            const vatText = (q.vat_type === 'exclusive') ? '별도' : fmtWon(it.vat);
            if (priceMode === 'all') {
                priceCells = `
                    <td class="cell-money">${fmtWon(it.unit_price)}</td>
                    <td class="cell-money fw-semibold">${fmtWon(it.supply_price)}</td>
                    <td class="cell-money" style="color: #111;">${vatText}</td>
                `;
            } else if (priceMode === 'unit') {
                priceCells = `
                    <td class="cell-money fw-bold">${fmtWon(it.unit_price)}</td>
                `;
            }

            return `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    ${imgCell}
                    <td class="cell-product-name fw-semibold">${escHtml(it.product_name)}</td>
                    <td class="text-center" style="font-size: 8pt;">${escHtml(it.spec || '-')}</td>
                    <td class="text-center fw-semibold" style="white-space: nowrap;">${fmtNum(it.qty)}</td>
                    <td class="text-center" style="white-space: nowrap;">${escHtml(it.unit || 'EA')}</td>
                    ${priceCells}
                    <td class="cell-remarks">${escHtml(it.remarks || '')}</td>
                </tr>
            `;
        }).join('');

        let priceHeaders = '';
        let tfootHtml = '';
        if (priceMode === 'all') {
            priceHeaders = `
                <th>단가</th>
                <th>공급가액</th>
                <th>세액</th>
            `;
            const leadCols = showImg ? 7 : 6;
            const tfootVat = (q.vat_type === 'exclusive') ? '별도 (0원)' : fmtWon(q.total_vat);
            tfootHtml = `
                <tfoot>
                    <tr>
                        <th colspan="${leadCols}" class="text-center" style="font-size: 9pt; background: #f8fafc; letter-spacing: 2px;">합계</th>
                        <td class="cell-money" style="font-weight: bold; background: #f8fafc;">${fmtWon(q.total_supply_price)}</td>
                        <td class="cell-money" style="font-weight: bold; background: #f8fafc; color: #111;">${tfootVat}</td>
                        <td class="text-center" style="font-size: 8pt; color: #888; background: #f8fafc;">-</td>
                    </tr>
                </tfoot>
            `;
        } else if (priceMode === 'unit') {
            priceHeaders = `<th>단가</th>`;
        }

        let notesHtml = '';
        if (includeNotes) {
            if (isQuote) {
                notesHtml = `
                    <div class="a4-footer-notes" style="margin-top: 10px; border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt;">
                        <div class="a4-footer-notes-title fw-bold mb-1">[ 특기사항 및 납품조건 ]</div>
                        <div class="a4-notes-meta" style="display: flex; gap: 16px; margin-bottom: 6px; padding-bottom: 5px; border-bottom: 1px dashed #cbd5e1; font-size: 8.5pt; flex-wrap: wrap;">
                            <span>• <b>유효기간</b>: ${escHtml(q.valid_until || '견적일로부터 15일간')}</span>
                            ${q.delivery_date ? `<span>• <b>납기일</b>: ${escHtml(q.delivery_date)}</span>` : ''}
                            ${q.delivery_place ? `<span>• <b>납품장소</b>: ${escHtml(q.delivery_place)}</span>` : ''}
                            ${q.payment_terms ? `<span>• <b>결제조건</b>: ${escHtml(q.payment_terms)}</span>` : ''}
                        </div>
                        <div style="white-space: pre-wrap; line-height: 1.45;">${escHtml(q.notes_instructions || '특기사항 없음')}</div>
                    </div>
                `;
            } else {
                notesHtml = `
                    <div class="a4-footer-notes" style="margin-top: 10px; border: 1px solid #000; padding: 8px 10px; font-size: 8.5pt;">
                        <div class="a4-footer-notes-title fw-bold mb-1">[ 특기사항 ]</div>
                        <div style="white-space: pre-wrap; line-height: 1.45;">${escHtml(q.notes_instructions || '특기사항 없음')}</div>
                    </div>
                `;
            }
        }

        const recipientHtml = includeRecipient ? `
            <div class="recipient-box">
                <span class="recipient-name">${escHtml(q.customer_name || '거래처')}</span> 貴中
            </div>
        ` : '';

        const dateInfoHtml = `
            <div class="date-info">
                ${dateLabel} : ${escHtml(q.issue_date || '-')}
                ${q.project_name ? `&nbsp;&nbsp;|&nbsp;&nbsp;${projectLabel} : <b>${escHtml(q.project_name)}</b>` : ''}
            </div>
        `;

        const docNo = q.quote_number || this.generateStandardQuoteNumber();
        q.quote_number = docNo;

        let headerContainerHtml = '';
        if (includeSupplier) {
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
                        ${this.buildA4QrBoxHtml(q, showQr, false)}
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
            headerContainerHtml = `
                <div class="header-container no-supplier">
                    <div class="title-box">
                        <h1 id="printTitle">${escHtml(title)}</h1>
                    </div>
                    ${recipientHtml}
                    ${dateInfoHtml}
                    ${this.buildA4QrBoxHtml(q, showQr, true)}
                </div>
            `;
        }

        return `
            <div class="a4-quote-page external-quote-page">
                <!-- 0. 최상단 우측 견적번호 (QT-YYYYMMDD-001 단독 우측 정렬) -->
                <div class="a4-quote-doc-bar">
                    <span class="a4-quote-doc-no">${escHtml(docNo)}</span>
                </div>

                <!-- 1. 상단 헤더 컨테이너 -->
                ${headerContainerHtml}

                <!-- 2. 금액란 -->
                ${amountBoxHtml}

                <!-- 3. 견적 품목 테이블 (100% 가로 전폭 분배) -->
                <table class="a4-items-table" style="width: 100%; border-collapse: collapse; border-top: 2px solid #000; border-bottom: 2px solid #000;">
                    ${showImg ? (priceMode === 'all' ? `
                    <colgroup>
                        <col style="width: 3.8%;">  <!-- No -->
                        <col style="width: 7.2%;">  <!-- 사진 -->
                        <col style="width: 25%;">   <!-- 품목명 및 사양 -->
                        <col style="width: 9.5%;">  <!-- 규격 -->
                        <col style="width: 5.5%;">  <!-- 수량 -->
                        <col style="width: 4.5%;">  <!-- 단위 -->
                        <col style="width: 11%;">   <!-- 단가 -->
                        <col style="width: 13%;">   <!-- 공급가액 -->
                        <col style="width: 11%;">   <!-- 세액 -->
                        <col style="width: 9.5%;">  <!-- 비고 -->
                    </colgroup>
                    ` : `
                    <colgroup>
                        <col style="width: 4.5%;"> <!-- No -->
                        <col style="width: 7.5%;"> <!-- 사진 -->
                        <col style="width: 37%;">  <!-- 품목명 및 사양 -->
                        <col style="width: 14%;">  <!-- 규격 -->
                        <col style="width: 6.5%;"> <!-- 수량 -->
                        <col style="width: 5.5%;"> <!-- 단위 -->
                        ${priceMode === 'unit' ? '<col style="width: 13%;">' : ''}
                        <col style="width: 12%;">  <!-- 비고 -->
                    </colgroup>
                    `) : (priceMode === 'all' ? `
                    <colgroup>
                        <col style="width: 4%;">    <!-- No -->
                        <col style="width: 30.5%;"> <!-- 품목명 및 사양 -->
                        <col style="width: 10.5%;"> <!-- 규격 -->
                        <col style="width: 6%;">    <!-- 수량 -->
                        <col style="width: 5%;">    <!-- 단위 -->
                        <col style="width: 11.5%;"> <!-- 단가 -->
                        <col style="width: 13%;">   <!-- 공급가액 -->
                        <col style="width: 10.5%;"> <!-- 세액 -->
                        <col style="width: 9%;">    <!-- 비고 -->
                    </colgroup>
                    ` : `
                    <colgroup>
                        <col style="width: 5%;">   <!-- No -->
                        <col style="width: 44%;">  <!-- 품목명 및 사양 -->
                        <col style="width: 17%;">  <!-- 규격 -->
                        <col style="width: 7%;">   <!-- 수량 -->
                        <col style="width: 7%;">   <!-- 단위 -->
                        ${priceMode === 'unit' ? '<col style="width: 14%;">' : ''}
                        <col style="width: 12%;">  <!-- 비고 -->
                    </colgroup>
                    `)}
                    <thead>
                        <tr>
                            <th>No.</th>
                            ${showImg ? '<th>사진</th>' : ''}
                            <th class="text-start ps-2">품목명 및 사양</th>
                            <th>규격</th>
                            <th>수량</th>
                            <th>단위</th>
                            ${priceHeaders}
                            <th>비고</th>
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
    },

    // ── 내부 검토용 견적서 페이지 생성기 (원가/마진/워터마크/동일 공급자 정보 포함) ──
    generateInternalReviewPage: function(q, options, s) {
        const title = options.title || '견  적  서';
        const includeRecipient = (typeof options.includeRecipient === 'boolean') ? options.includeRecipient : true;
        const includeSupplier = (typeof options.includeSupplier === 'boolean') ? options.includeSupplier : true;
        const showImg = (typeof options.showImages === 'boolean') ? options.showImages : (q.show_images !== 0);
        const showQr = (typeof options.showQr === 'boolean') ? options.showQr : (q.show_qr !== 0);
        const includeSeal = includeSupplier && ((typeof options.includeSeal === 'boolean') ? options.includeSeal : (q.include_seal !== 0));
        const includeWatermark = (typeof options.includeWatermark === 'boolean') ? options.includeWatermark : true;
        const includeNotes = (typeof options.includeNotes === 'boolean') ? options.includeNotes : true;
        const items = q.items || [];

        const isQuote = title.replace(/\s+/g, '').includes('견적');
        const dateLabel = isQuote ? '견적일자' : '작성일자';
        const projectLabel = isQuote ? '견적건명' : '건명';

        // 워터마크 HTML (테두리 없는 깔끔한 사내 검토용 문구)
        const watermarkHtml = includeWatermark
            ? `<div class="watermark-internal-review">사내 검토용 / 외부 발송금지</div>`
            : '';

        // 공급자 직인 HTML
        const sealHtml = (includeSeal && s.sealUrl)
            ? `<img src="${s.sealUrl}" class="stamp" alt="직인" onerror="this.style.display='none'">`
            : '';

        const recipientHtml = includeRecipient ? `
            <div class="recipient-box">
                <span class="recipient-name">${escHtml(q.customer_name || '거래처')}</span> 貴中
            </div>
        ` : '';

        const dateInfoHtml = `
            <div class="date-info">
                ${dateLabel} : ${escHtml(q.issue_date || '-')}
                ${q.project_name ? `&nbsp;&nbsp;|&nbsp;&nbsp;${projectLabel} : <b>${escHtml(q.project_name)}</b>` : ''}
            </div>
        `;

        // 상단 헤더 컨테이너 (외부 발송용과 완벽히 동일한 공급자 정보 테이블 규격)
        let headerContainerHtml = '';
        if (includeSupplier) {
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
                        ${this.buildA4QrBoxHtml(q, showQr, false)}
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
            headerContainerHtml = `
                <div class="header-container no-supplier position-relative">
                    ${this.buildA4QrBoxHtml(q, showQr, true)}
                    <div class="title-box">
                        <h1 id="printTitle">${escHtml(title)}</h1>
                    </div>
                    ${recipientHtml}
                    ${dateInfoHtml}
                </div>
            `;
        }

        // 품목별 마진 집계 계산
        let sumCost = 0;
        let sumSupply = 0;
        let sumMargin = 0;

        const itemRowsHtml = items.map((it, idx) => {
            const qty = Number(it.qty) || 1;
            const cost = Number(it.cost_price) || 0;
            const unit = Number(it.unit_price) || 0;
            const supply = it.supply_price || (qty * unit);
            const totalCost = cost * qty;
            const margin = calcGrossMargin(cost, unit);
            const totalMargin = (unit - cost) * qty;

            sumCost += totalCost;
            sumSupply += supply;
            sumMargin += totalMargin;

            const media = extractItemMedia(it);
            const cleanThumb = media.thumbs[0] || cleanImgUrl(it.image_url);
            const imgCell = showImg
                ? `<td class="text-center" style="padding: 2px; overflow: hidden;">
                     ${cleanThumb ? `<img src="${escHtml(cleanThumb)}" class="a4-item-img" alt="사진">` : '<span style="color:#ccc; font-size:9px;">-</span>'}
                   </td>`
                : '';

            return `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    ${imgCell}
                    <td class="cell-product-name fw-semibold">${escHtml(it.product_name)}</td>
                    <td class="text-center" style="font-size: 7.5pt;">${escHtml(it.spec || '-')}</td>
                    <td class="text-center fw-semibold" style="white-space: nowrap;">${fmtNum(qty)}</td>
                    <td class="text-center" style="white-space: nowrap;">${escHtml(it.unit || 'EA')}</td>
                    <td class="cell-money text-muted">${fmtWon(cost)}</td>
                    <td class="cell-money">${fmtWon(unit)}</td>
                    <td class="cell-money fw-semibold">${fmtWon(supply)}</td>
                    <td class="cell-money text-success fw-bold">${fmtWon(totalMargin)}</td>
                    <td class="text-center fw-bold ${margin.rate < 15 ? 'text-danger' : 'text-primary'}" style="white-space: nowrap;">${margin.rate.toFixed(1)}%</td>
                    <td class="cell-remarks">${escHtml(it.internal_remarks || '')}</td>
                </tr>
            `;
        }).join('');

        const avgMarginRate = sumSupply > 0 ? (Math.round((sumMargin / sumSupply) * 1000) / 10) : 0;
        const leadCols = showImg ? 6 : 5;
        const docNo = q.quote_number || this.generateStandardQuoteNumber();

        // 12개 열 가로 100% 전폭 완벽 분배 (고액 합계·마진 금액 칸 침범 원천 차단)
        const internalColgroupHtml = showImg ? `
            <colgroup>
                <col style="width: 3.5%;">  <!-- No -->
                <col style="width: 6.5%;">  <!-- 사진 -->
                <col style="width: 17%;">   <!-- 품목명 및 사양 -->
                <col style="width: 6.5%;">  <!-- 규격 -->
                <col style="width: 5.5%;">  <!-- 수량 -->
                <col style="width: 4%;">    <!-- 단위 -->
                <col style="width: 10.5%;"> <!-- 매입가 -->
                <col style="width: 10%;">   <!-- 제안단가 -->
                <col style="width: 11.5%;"> <!-- 공급가액 -->
                <col style="width: 11%;">   <!-- 마진액(총) -->
                <col style="width: 5.5%;">  <!-- 마진율 -->
                <col style="width: 8.5%;">  <!-- 내부 비고 -->
            </colgroup>
        ` : `
            <colgroup>
                <col style="width: 4%;">    <!-- No -->
                <col style="width: 21.5%;"> <!-- 품목명 및 사양 -->
                <col style="width: 7%;">    <!-- 규격 -->
                <col style="width: 5.5%;">  <!-- 수량 -->
                <col style="width: 4%;">    <!-- 단위 -->
                <col style="width: 11%;">   <!-- 매입가 -->
                <col style="width: 10.5%;"> <!-- 제안단가 -->
                <col style="width: 12%;">   <!-- 공급가액 -->
                <col style="width: 11.5%;"> <!-- 마진액(총) -->
                <col style="width: 5.5%;">  <!-- 마진율 -->
                <col style="width: 7.5%;">  <!-- 내부 비고 -->
            </colgroup>
        `;

        return `
            <div class="a4-quote-page internal-review-page position-relative">
                <!-- 0. 최상단 우측 견적번호 (QT-YYYYMMDD-001 단독 우측 정렬) -->
                <div class="a4-quote-doc-bar">
                    <span class="a4-quote-doc-no">${escHtml(docNo)}</span>
                </div>

                <!-- 0. 사내 검토용 워터마크 -->
                ${watermarkHtml}

                <!-- 1. 상단 헤더 컨테이너 (외부 발송용과 동일한 대제목 및 공급자 정보 표) -->
                ${headerContainerHtml}

                <!-- 2. 핵심 마진 분석 요약 리본 박스 (5열 균등 분할 그리드 - 줄바꿈/겹침 방지) -->
                <div class="internal-margin-summary">
                    <div class="internal-margin-summary-item">
                        <span class="label">총 매입원가</span>
                        <span class="value">${fmtWon(sumCost)}</span>
                    </div>
                    <div class="internal-margin-summary-item">
                        <span class="label">총 공급가액</span>
                        <span class="value text-primary">${fmtWon(sumSupply)}</span>
                    </div>
                    <div class="internal-margin-summary-item">
                        <span class="label">총 마진액</span>
                        <span class="value text-success">${fmtWon(sumMargin)}</span>
                    </div>
                    <div class="internal-margin-summary-item">
                        <span class="label">평균 마진율(매출총이익률)</span>
                        <span class="value ${avgMarginRate < 15 ? 'text-danger' : 'text-primary'}">${avgMarginRate.toFixed(1)}%</span>
                    </div>
                    <div class="internal-margin-summary-item">
                        <span class="label">총 견적금액(VAT포함)</span>
                        <span class="value">${fmtWon(q.total_amount)}</span>
                    </div>
                </div>

                <!-- 3. 원가/마진 상세 견적 품목 테이블 (내부 전용 100% 가로 전폭 분배) -->
                <table class="a4-items-table internal-table" style="width: 100%; border-collapse: collapse; border-top: 2px solid #000; border-bottom: 2px solid #000;">
                    ${internalColgroupHtml}
                    <thead>
                        <tr>
                            <th>No.</th>
                            ${showImg ? '<th>사진</th>' : ''}
                            <th class="text-start ps-2">품목명 및 사양</th>
                            <th>규격</th>
                            <th>수량</th>
                            <th>단위</th>
                            <th>매입가</th>
                            <th>제안단가</th>
                            <th>공급가액</th>
                            <th>마진액(총)</th>
                            <th>마진율</th>
                            <th>내부 비고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th colspan="${leadCols}" class="text-center" style="letter-spacing: 2px;">합 계</th>
                            <td class="cell-money text-muted fw-bold">${fmtWon(sumCost)}</td>
                            <td class="text-center text-muted" style="font-size: 7.5pt;">-</td>
                            <td class="cell-money fw-bold">${fmtWon(sumSupply)}</td>
                            <td class="cell-money text-success fw-bold">${fmtWon(sumMargin)}</td>
                            <td class="text-center fw-bold ${avgMarginRate < 15 ? 'text-danger' : 'text-primary'}">${avgMarginRate.toFixed(1)}%</td>
                            <td class="text-center text-muted" style="font-size: 7.5pt;">-</td>
                        </tr>
                    </tfoot>
                </table>

                <!-- 4. 하단 사내 검토 의견 및 특기사항 -->
                ${includeNotes ? `
                    <div class="a4-footer-notes" style="margin-top: 8px; border: 1px solid #333; padding: 6px 10px; font-size: 8pt;">
                        <div class="a4-footer-notes-title fw-bold mb-1" style="color: #0f172a;">[ 사내 검토 및 거래 조건 ]</div>
                        <div class="a4-notes-meta" style="display: flex; gap: 14px; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px dashed #cbd5e1; font-size: 8pt; flex-wrap: wrap;">
                            <span>• <b>납기일</b>: ${escHtml(q.delivery_date || '발주 후 3일 이내')}</span>
                            <span>• <b>납품장소</b>: ${escHtml(q.delivery_place || '지정 장소')}</span>
                            <span>• <b>결제조건</b>: ${escHtml(q.payment_terms || '현금결제')}</span>
                            <span>• <b>과세구분</b>: ${q.vat_type === 'exclusive' ? '부가세 별도' : (q.vat_type === 'inclusive' ? '부가세 포함' : '영세/면세')}</span>
                        </div>
                        <div style="white-space: pre-wrap; line-height: 1.4;">${escHtml(q.notes_instructions || '특기사항 없음')}</div>
                    </div>
                ` : ''}
            </div>
        `;
    },

    // ── 통합 인쇄 영역 렌더링 (외부 발송용 / 내부+외부 / 내부 검토용) ──
    renderPrintArea: function(q, options = {}) {
        const printArea = document.getElementById('printArea');
        if (!printArea) return;

        const s = this.supplierSettings;
        const targetMode = options.targetMode || 'external';

        let html = '';
        if (targetMode === 'both') {
            // 1페이지: 내부 검토용 결재 서식 + 2페이지: 외부 발송용 고객 견적서
            html = this.generateInternalReviewPage(q, options, s) + this.generateExternalQuotePage(q, options, s);
        } else if (targetMode === 'internal') {
            // 내부 검토용만 1장
            html = this.generateInternalReviewPage(q, options, s);
        } else {
            // 외부 발송용만 1장 (기본)
            html = this.generateExternalQuotePage(q, options, s);
        }

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

        // 서버에도 동기화 저장하여 다른 PC로 로그인해도 동일한 공급자 정보 유지
        authFetch(`${API_BASE}/settings/supplier`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.supplierSettings)
        }).catch(() => {});

        showToast('공급자 정보가 서버 및 브라우저에 저장되었습니다.', 'success');
    },

    // ── 단축키 바인딩 (F2 신규, F8 저장, ESC 닫기, 품목표 Tab/Enter 세로 이동) ──
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
                this.closeQrPreviewModal();
                this.closePrintOptionsModal();
                this.closeItemImportModal();
                this.closeSupplierSettingsModal();
            } else if ((e.key === 'Tab' || e.key === 'Enter') && !e.isComposing) {
                const inputEl = e.target?.closest?.('#quoteItemsTbody input[data-col-field]');
                if (!inputEl) return;
                const tr = inputEl.closest('tr[data-index]');
                if (!tr) return;

                const rowIdx = parseInt(tr.dataset.index, 10);
                const colField = inputEl.dataset.colField;
                const allRows = document.querySelectorAll('#quoteItemsTbody tr[data-index]');
                const totalRows = allRows.length;
                if (isNaN(rowIdx) || totalRows === 0) return;

                const colOrder = ['product_name', 'spec', 'qty', 'unit', 'cost_price', 'unit_price', 'margin_rate', 'remarks', 'internal_remarks'];
                const colIdx = colOrder.indexOf(colField);

                const focusTarget = (targetInp) => {
                    if (!targetInp) return false;
                    e.preventDefault();
                    targetInp.focus();
                    try { targetInp.select(); } catch (err) {}
                    return true;
                };

                if (e.key === 'Enter') {
                    if (rowIdx + 1 < totalRows) {
                        const nextRowInp = allRows[rowIdx + 1].querySelector(`input[data-col-field="${colField}"]`);
                        focusTarget(nextRowInp);
                    } else {
                        e.preventDefault();
                        inputEl.blur();
                    }
                } else if (e.key === 'Tab' && !e.shiftKey) {
                    // Tab: 같은 열의 다음 행(아래 칸)으로 이동 -> 마지막 행이면 오른쪽 다음 열의 첫 번째 행으로 이동
                    if (rowIdx + 1 < totalRows) {
                        const nextRowInp = allRows[rowIdx + 1].querySelector(`input[data-col-field="${colField}"]`);
                        if (focusTarget(nextRowInp)) return;
                    } else if (colIdx >= 0 && colIdx + 1 < colOrder.length) {
                        const nextColField = colOrder[colIdx + 1];
                        const firstRowNextColInp = allRows[0]?.querySelector(`input[data-col-field="${nextColField}"]`);
                        if (focusTarget(firstRowNextColInp)) return;
                    }
                } else if (e.key === 'Tab' && e.shiftKey) {
                    // Shift + Tab: 같은 열의 이전 행(위 칸)으로 이동 -> 첫 번째 행이면 왼쪽 이전 열의 마지막 행으로 이동
                    if (rowIdx - 1 >= 0) {
                        const prevRowInp = allRows[rowIdx - 1].querySelector(`input[data-col-field="${colField}"]`);
                        if (focusTarget(prevRowInp)) return;
                    } else if (colIdx > 0) {
                        const prevColField = colOrder[colIdx - 1];
                        const lastRowPrevColInp = allRows[totalRows - 1]?.querySelector(`input[data-col-field="${prevColField}"]`);
                        if (focusTarget(lastRowPrevColInp)) return;
                    }
                }
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
