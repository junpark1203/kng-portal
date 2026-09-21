// 05_Management/forms/purchase_order.js

// --- 서버 URL 및 API 설정 ---
const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://kng.junparks.com';

const API_BASE = `${SERVER_URL}/api/purchase-orders`;

// 상대 경로 URL(/api/...)을 전체 URL로 변환하는 헬퍼
function resolveUrl(url) {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
        return url;
    }
    if (url.startsWith('/api/')) {
        return `${SERVER_URL}${url}`;
    }
    return url;
}

// 안전한 JSON 파싱 헬퍼 (Unexpected token '<' 에러 방지 및 친절한 안내)
async function parseJsonResponse(res) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const text = await res.text();
        if (text.includes('<!DOCTYPE') || text.includes('<html') || text.trim().startsWith('<')) {
            throw new Error(`API 서버 연결 실패 (${res.status}): 백엔드 서버가 아직 최신 버전으로 재배포(재시작)되지 않았거나 엔드포인트를 찾을 수 없습니다.`);
        }
        throw new Error(`서버 응답 형식 오류 (${res.status}): ${text.slice(0, 100)}`);
    }
    return res.json();
}

// --- authFetch 래퍼 ---
async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 5) {
                await new Promise(r => setTimeout(r, 200));
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

const app = {
    poList: [],
    currentPo: null,
    settings: {
        seal_url: '../../assets/images/stamp.png',
        sign_url: '',
        ceo_name: 'CEO / Youn, Jong'
    },
    drawingFile: null,
    drawingUrl: '',
    currentPrintPo: null,

    init: async function() {
        await this.loadSettings();
        await this.loadPurchaseOrders();
        this.setupDragAndDrop();
    },

    // -------------------------------------------------------------
    // 1. 설정 및 기본값 로드
    // -------------------------------------------------------------
    loadSettings: async function() {
        try {
            const res = await authFetch(`${API_BASE}/config/settings`);
            if (res.ok) {
                const data = await parseJsonResponse(res);
                if (data.seal_url) this.settings.seal_url = data.seal_url;
                if (data.sign_url) this.settings.sign_url = data.sign_url;
                if (data.ceo_name) this.settings.ceo_name = data.ceo_name;
            }
        } catch (e) {
            console.warn('설정을 불러오지 못했습니다. 기본값을 사용합니다.', e);
        }
    },

    openSettingsModal: function() {
        document.getElementById('settingSealImg').src = resolveUrl(this.settings.seal_url || '../../assets/images/stamp.png');
        const signImg = document.getElementById('settingSignImg');
        const signEmptyText = document.getElementById('settingSignEmptyText');
        if (this.settings.sign_url) {
            signImg.src = resolveUrl(this.settings.sign_url);
            signImg.style.display = 'block';
            signEmptyText.style.display = 'none';
        } else {
            signImg.style.display = 'none';
            signEmptyText.style.display = 'block';
        }
        document.getElementById('settingCeoName').value = this.settings.ceo_name || 'CEO / Youn, Jong';
        new bootstrap.Modal(document.getElementById('settingsModal')).show();
    },

    uploadSealFile: async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await parseJsonResponse(res);
            if (data.url) {
                this.settings.seal_url = data.url;
                document.getElementById('settingSealImg').src = resolveUrl(data.url);
            }
        } catch (err) {
            alert('직인 파일 업로드 실패: ' + err.message);
        }
    },

    uploadSignFile: async function(event) {
        const file = event.target.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await authFetch(`${API_BASE}/upload`, {
                method: 'POST',
                body: formData
            });
            const data = await parseJsonResponse(res);
            if (data.url) {
                this.settings.sign_url = data.url;
                const signImg = document.getElementById('settingSignImg');
                signImg.src = resolveUrl(data.url);
                signImg.style.display = 'block';
                document.getElementById('settingSignEmptyText').style.display = 'none';
            }
        } catch (err) {
            alert('서명 파일 업로드 실패: ' + err.message);
        }
    },

    saveSettings: async function() {
        this.settings.ceo_name = document.getElementById('settingCeoName').value.trim() || 'CEO / Youn, Jong';
        try {
            const res = await authFetch(`${API_BASE}/config/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.settings)
            });
            if (res.ok) {
                bootstrap.Modal.getInstance(document.getElementById('settingsModal')).hide();
                alert('직인 및 서명 설정이 저장되었습니다.');
            } else {
                alert('설정 저장에 실패했습니다.');
            }
        } catch (err) {
            alert('오류 발생: ' + err.message);
        }
    },

    // -------------------------------------------------------------
    // 2. 발주서 목록 조회 및 KPI 통계
    // -------------------------------------------------------------
    loadPurchaseOrders: async function() {
        const keyword = document.getElementById('searchKeyword').value.trim();
        const status = document.getElementById('filterStatus').value;
        const startDate = document.getElementById('filterStartDate').value;
        const endDate = document.getElementById('filterEndDate').value;

        const params = new URLSearchParams();
        if (keyword) params.append('keyword', keyword);
        if (status && status !== '전체') params.append('status', status);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);

        try {
            const res = await authFetch(`${API_BASE}?${params.toString()}`);
            if (!res.ok) {
                const errData = await parseJsonResponse(res).catch(() => null);
                throw new Error(errData?.error || `목록을 불러오지 못했습니다. (HTTP ${res.status})`);
            }
            const data = await parseJsonResponse(res);
            this.poList = data || [];
            this.renderPoList();
            this.updateKpiStats();
        } catch (err) {
            document.getElementById('poTableBody').innerHTML = `
                <tr><td colspan="10" class="text-center py-4 text-danger">
                    <i class='bx bx-error-circle fs-3'></i><br>${err.message}
                </td></tr>
            `;
        }
    },

    onSearch: function(e) {
        e.preventDefault();
        this.loadPurchaseOrders();
    },

    resetFilters: function() {
        document.getElementById('searchKeyword').value = '';
        document.getElementById('filterStatus').value = '전체';
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        this.loadPurchaseOrders();
    },

    renderPoList: function() {
        const tbody = document.getElementById('poTableBody');
        if (!this.poList || this.poList.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="10" class="text-center py-5 text-muted">
                    <i class='bx bx-file-blank fs-2 mb-2'></i><br>등록된 발주서가 없습니다. 새 발주서를 작성해보세요!
                </td></tr>
            `;
            return;
        }

        let html = '';
        this.poList.forEach((po, idx) => {
            let statusBadgeClass = 'badge-draft';
            if (po.status === '발주완료') statusBadgeClass = 'badge-issued';
            else if (po.status === '선적진행') statusBadgeClass = 'badge-shipped';
            else if (po.status === '입고완료') statusBadgeClass = 'badge-completed';

            const formattedAmount = (po.total_amount != null) 
                ? (po.currency === 'USD' ? '$' + Number(po.total_amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : Number(po.total_amount).toLocaleString() + ' ' + po.currency)
                : '-';

            const representativeItem = po.first_item_name 
                ? (po.first_item_name + (po.item_count > 1 ? ` 외 ${po.item_count - 1}건` : '')) 
                : '-';

            html += `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td>
                        <a href="javascript:void(0)" class="po-link" onclick="app.openEditModal('${po.id}')">
                            ${po.po_number}
                        </a>
                    </td>
                    <td class="text-center">${po.issue_date || '-'}</td>
                    <td class="text-center">${po.validity_date || '-'}</td>
                    <td><strong>${po.seller_name || '-'}</strong></td>
                    <td>${representativeItem}</td>
                    <td class="text-center"><span class="badge bg-light text-dark border">${po.currency || 'USD'}</span></td>
                    <td class="text-end fw-bold text-primary">${formattedAmount}</td>
                    <td class="text-center"><span class="badge-status ${statusBadgeClass}">${po.status || '작성중'}</span></td>
                    <td class="text-center">
                        <div class="d-inline-flex gap-1">
                            <button type="button" class="btn-action btn-action-primary" onclick="app.preparePrint('${po.id}')" title="인쇄 및 PDF">
                                <i class='bx bx-printer'></i> 인쇄
                            </button>
                            <button type="button" class="btn-action" onclick="app.openEditModal('${po.id}')" title="수정">
                                <i class='bx bx-edit'></i>
                            </button>
                            <button type="button" class="btn-action" onclick="app.duplicatePo('${po.id}')" title="복사하여 새로 작성">
                                <i class='bx bx-copy'></i>
                            </button>
                            <button type="button" class="btn-action text-danger" onclick="app.deletePo('${po.id}', '${po.po_number}')" title="삭제">
                                <i class='bx bx-trash'></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        });
        tbody.innerHTML = html;
    },

    updateKpiStats: function() {
        const totalCount = this.poList.length;
        document.getElementById('kpiTotalCount').innerText = `${totalCount.toLocaleString()} 건`;

        const now = new Date();
        const curYearMonth = now.toISOString().slice(0, 7);
        const thisMonthCount = this.poList.filter(p => p.issue_date && p.issue_date.startsWith(curYearMonth)).length;
        document.getElementById('kpiThisMonthCount').innerText = `이번 달: ${thisMonthCount} 건`;

        let totalUsd = 0;
        let activeCount = 0;
        let completedCount = 0;

        this.poList.forEach(p => {
            if (p.currency === 'USD') {
                totalUsd += Number(p.total_amount) || 0;
            }
            if (p.status === '발주완료' || p.status === '선적진행') {
                activeCount++;
            } else if (p.status === '입고완료') {
                completedCount++;
            }
        });

        document.getElementById('kpiTotalUsd').innerText = `$${totalUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const approxKrw = Math.round(totalUsd * 1350);
        document.getElementById('kpiTotalKrw').innerText = `원화 환산 약 ${approxKrw.toLocaleString()} 원 (환율 1,350 기준)`;

        document.getElementById('kpiActiveCount').innerText = `${activeCount} 건`;
        document.getElementById('kpiCompletedCount').innerText = `${completedCount} 건`;
    },

    // -------------------------------------------------------------
    // 3. 발주서 작성/수정 모달 로직
    // -------------------------------------------------------------
    openCreateModal: function() {
        this.currentPo = null;
        document.getElementById('poModalTitle').innerHTML = "<i class='bx bx-plus-circle text-primary'></i> 신규 발주서 작성 (New Purchase Order)";
        document.getElementById('poId').value = '';
        
        // 날짜 기본값: 오늘
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('formIssueDate').value = today;
        document.getElementById('formValidityDate').value = '';
        document.getElementById('formReferences').value = '';
        document.getElementById('formStatus').value = '작성중';

        // 발주번호 추천 생성 (사용자가 자유롭게 수정 가능)
        this.generateRecommendPoNumber();

        // 바이어 기본값
        this.loadBuyerPreset();

        // 셀러 및 무역조건 초기화
        document.getElementById('formSellerName').value = '';
        document.getElementById('formSellerAddress').value = '';
        document.getElementById('formSellerAttn').value = '';
        document.getElementById('formSellerTel').value = '';
        document.getElementById('formSellerEmail').value = '';

        document.getElementById('formPaymentTerms').value = '30% T/T in advance, 70% within 15 business days after the delivery is completed';
        document.getElementById('formDeliveryTerms').value = 'CIF Incheon';
        document.getElementById('formCountryOfOrigin').value = 'China';
        document.getElementById('formLoadingPort').value = 'Any port in China';
        document.getElementById('formDischargingPort').value = 'Incheon, S.Korea';
        document.getElementById('formDeliveryDate').value = 'Within 15 days after the advance payment';
        document.getElementById('formShipmentSpec').value = '1 x 20ft FCL';

        document.getElementById('formCurrency').value = 'USD';
        document.getElementById('formNotes').value = '';
        this.removeDrawingImage();
        document.getElementById('formIncludeSeal').checked = true;

        // 품목 기본 2행 생성
        document.getElementById('itemsTableBody').innerHTML = '';
        this.addItemRow({ product_name: '', hs_code: '', packaging_unit: '25 kg/drum', order_qty: 0, unit: 'KG', unit_price: 0, packaging_qty: '' });
        this.addItemRow({ product_name: '', hs_code: '', packaging_unit: '25 kg/drum', order_qty: 0, unit: 'KG', unit_price: 0, packaging_qty: '' });
        this.recalculateTotals();

        new bootstrap.Modal(document.getElementById('poFormModal')).show();
    },

    openEditModal: async function(id) {
        try {
            const res = await authFetch(`${API_BASE}/${id}`);
            if (!res.ok) {
                const errData = await parseJsonResponse(res).catch(() => null);
                throw new Error(errData?.error || '발주서 데이터를 가져오지 못했습니다.');
            }
            const po = await parseJsonResponse(res);
            this.currentPo = po;

            document.getElementById('poModalTitle').innerHTML = `<i class='bx bx-edit-alt text-primary'></i> 발주서 수정 (${po.po_number})`;
            document.getElementById('poId').value = po.id;
            document.getElementById('formPoNumber').value = po.po_number || '';
            document.getElementById('formIssueDate').value = po.issue_date || '';
            document.getElementById('formValidityDate').value = po.validity_date || '';
            document.getElementById('formReferences').value = po.references_text || '';
            document.getElementById('formStatus').value = po.status || '작성중';

            document.getElementById('formBuyerName').value = po.buyer_name || '';
            document.getElementById('formBuyerAddress').value = po.buyer_address || '';
            document.getElementById('formBuyerAttn').value = po.buyer_attn || '';
            document.getElementById('formBuyerTel').value = po.buyer_tel || '';
            document.getElementById('formBuyerEmail').value = po.buyer_email || '';

            document.getElementById('formSellerName').value = po.seller_name || '';
            document.getElementById('formSellerAddress').value = po.seller_address || '';
            document.getElementById('formSellerAttn').value = po.seller_attn || '';
            document.getElementById('formSellerTel').value = po.seller_tel || '';
            document.getElementById('formSellerEmail').value = po.seller_email || '';

            document.getElementById('formPaymentTerms').value = po.payment_terms || '';
            document.getElementById('formDeliveryTerms').value = po.delivery_terms || '';
            document.getElementById('formCountryOfOrigin').value = po.country_of_origin || '';
            document.getElementById('formLoadingPort').value = po.loading_port || '';
            document.getElementById('formDischargingPort').value = po.discharging_port || '';
            document.getElementById('formDeliveryDate').value = po.delivery_date || '';
            document.getElementById('formShipmentSpec').value = po.shipment_spec || '';

            document.getElementById('formCurrency').value = po.currency || 'USD';
            document.getElementById('formNotes').value = po.notes_instructions || '';
            document.getElementById('formIncludeSeal').checked = po.include_seal === 1;

            if (po.drawing_image_url) {
                this.setDrawingPreview(po.drawing_image_url);
            } else {
                this.removeDrawingImage();
            }

            // 품목 렌더링
            document.getElementById('itemsTableBody').innerHTML = '';
            if (po.items && po.items.length > 0) {
                po.items.forEach(item => this.addItemRow(item));
            } else {
                this.addItemRow();
            }
            this.recalculateTotals();

            new bootstrap.Modal(document.getElementById('poFormModal')).show();
        } catch (err) {
            alert('발주서 로드 실패: ' + err.message);
        }
    },

    duplicatePo: async function(id) {
        try {
            const res = await authFetch(`${API_BASE}/${id}`);
            if (!res.ok) {
                const errData = await parseJsonResponse(res).catch(() => null);
                throw new Error(errData?.error || '발주서 데이터를 가져오지 못했습니다.');
            }
            const po = await parseJsonResponse(res);
            
            this.openCreateModal();
            // 데이터 복사
            document.getElementById('formReferences').value = po.references_text || '';
            document.getElementById('formSellerName').value = po.seller_name || '';
            document.getElementById('formSellerAddress').value = po.seller_address || '';
            document.getElementById('formSellerAttn').value = po.seller_attn || '';
            document.getElementById('formSellerTel').value = po.seller_tel || '';
            document.getElementById('formSellerEmail').value = po.seller_email || '';

            document.getElementById('formPaymentTerms').value = po.payment_terms || '';
            document.getElementById('formDeliveryTerms').value = po.delivery_terms || '';
            document.getElementById('formCountryOfOrigin').value = po.country_of_origin || '';
            document.getElementById('formLoadingPort').value = po.loading_port || '';
            document.getElementById('formDischargingPort').value = po.discharging_port || '';
            document.getElementById('formDeliveryDate').value = po.delivery_date || '';
            document.getElementById('formShipmentSpec').value = po.shipment_spec || '';

            document.getElementById('formCurrency').value = po.currency || 'USD';
            document.getElementById('formNotes').value = po.notes_instructions || '';
            if (po.drawing_image_url) {
                this.setDrawingPreview(po.drawing_image_url);
            }

            document.getElementById('itemsTableBody').innerHTML = '';
            if (po.items && po.items.length > 0) {
                po.items.forEach(item => this.addItemRow(item));
            } else {
                this.addItemRow();
            }
            this.recalculateTotals();
        } catch (err) {
            alert('복사 실패: ' + err.message);
        }
    },

    deletePo: async function(id, poNumber) {
        if (!confirm(`발주서 [${poNumber}]를 정말 삭제하시겠습니까?`)) return;
        try {
            const res = await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
            if (res.ok) {
                alert('발주서가 삭제되었습니다.');
                this.loadPurchaseOrders();
            } else {
                const errData = await parseJsonResponse(res).catch(() => null);
                alert('삭제 실패: ' + (errData?.error || '오류가 발생했습니다.'));
            }
        } catch (err) {
            alert('오류 발생: ' + err.message);
        }
    },

    loadBuyerPreset: function() {
        document.getElementById('formBuyerName').value = 'K&G CO., LTD.';
        document.getElementById('formBuyerAddress').value = '#2302, 87, Ogeum-ro, Songpa-gu, Seoul, Republic of Korea';
        document.getElementById('formBuyerAttn').value = 'Joon Park';
        document.getElementById('formBuyerTel').value = '+82-10-5949-5249';
        document.getElementById('formBuyerEmail').value = 'jpark120325@gmail.com';
    },

    generateRecommendPoNumber: function() {
        const year = new Date().getFullYear().toString().slice(-2);
        const count = this.poList.length + 1;
        const seq = String(count).padStart(3, '0');
        document.getElementById('formPoNumber').value = `KNG${year}-PO${seq}`;
    },

    // -------------------------------------------------------------
    // 4. 품목 그리드 동적 행 관리 및 계산
    // -------------------------------------------------------------
    addItemRow: function(data = null) {
        const tbody = document.getElementById('itemsTableBody');
        const rowCount = tbody.querySelectorAll('tr').length;
        const seq = rowCount + 1;

        const pName = data ? (data.product_name || '') : '';
        const hsCode = data ? (data.hs_code || '') : '';
        const pkgUnit = data ? (data.packaging_unit || '25 kg/drum') : '25 kg/drum';
        const orderQty = data ? (data.order_qty || 0) : 0;
        const unit = data ? (data.unit || 'KG') : 'KG';
        const unitPrice = data ? (data.unit_price || 0) : 0;
        const totalPrice = data ? (data.total_price || (orderQty * unitPrice)) : 0;
        const pkgQty = data ? (data.packaging_qty || '') : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="text-center seq-cell">${seq}</td>
            <td><input type="text" class="item-name" value="${pName}" placeholder="예: Tail Grease (1st filling) PA" required></td>
            <td><input type="text" class="item-hs" value="${hsCode}" placeholder="6자리 (예: 2710.19)" maxlength="10"></td>
            <td><input type="text" class="item-pkg-unit" value="${pkgUnit}" placeholder="25 kg/drum"></td>
            <td><input type="number" class="item-qty text-end" value="${orderQty}" step="any" min="0" oninput="app.onRowValueChange(this)" required></td>
            <td>
                <select class="item-unit" onchange="app.recalculateTotals()">
                    <option value="KG" ${unit === 'KG' ? 'selected' : ''}>KG</option>
                    <option value="TON" ${unit === 'TON' ? 'selected' : ''}>TON</option>
                    <option value="EA" ${unit === 'EA' ? 'selected' : ''}>EA</option>
                    <option value="M3" ${unit === 'M3' ? 'selected' : ''}>M3</option>
                    <option value="SET" ${unit === 'SET' ? 'selected' : ''}>SET</option>
                </select>
            </td>
            <td><input type="number" class="item-price text-end" value="${unitPrice}" step="any" min="0" oninput="app.onRowValueChange(this)" required></td>
            <td><input type="number" class="item-total text-end bg-light fw-bold" value="${totalPrice}" readonly></td>
            <td><input type="text" class="item-pkg-qty" value="${pkgQty}" placeholder="예: 36 drums (1 PALLETS)"></td>
            <td class="text-center">
                <button type="button" class="btn btn-link text-danger p-0" onclick="app.removeItemRow(this)" title="행 삭제">
                    <i class='bx bx-x fs-5'></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
        this.recalculateTotals();
    },

    removeItemRow: function(btn) {
        const tbody = document.getElementById('itemsTableBody');
        if (tbody.querySelectorAll('tr').length <= 1) {
            alert('최소 1개의 품목 행이 필요합니다.');
            return;
        }
        btn.closest('tr').remove();
        // 번호 재정렬
        tbody.querySelectorAll('tr').forEach((tr, i) => {
            tr.querySelector('.seq-cell').innerText = i + 1;
        });
        this.recalculateTotals();
    },

    onRowValueChange: function(input) {
        const tr = input.closest('tr');
        const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.item-price').value) || 0;
        const total = Math.round(qty * price * 100) / 100;
        tr.querySelector('.item-total').value = total;
        this.recalculateTotals();
    },

    recalculateTotals: function() {
        const rows = document.querySelectorAll('#itemsTableBody tr');
        let totalQty = 0;
        let totalPrice = 0;
        let units = new Set();

        rows.forEach(tr => {
            const q = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const p = parseFloat(tr.querySelector('.item-price').value) || 0;
            const u = tr.querySelector('.item-unit').value || 'KG';
            totalQty += q;
            totalPrice += Math.round(q * p * 100) / 100;
            units.add(u);
        });

        const currency = document.getElementById('formCurrency').value || 'USD';
        document.getElementById('gridTotalQty').innerText = totalQty.toLocaleString();
        document.getElementById('gridUnitLabel').innerText = Array.from(units).join(', ') || 'KG';

        const currSymbol = currency === 'USD' ? '$' : (currency === 'EUR' ? '€' : (currency === 'KRW' ? '₩' : currency + ' '));
        document.getElementById('gridTotalPrice').innerText = `${currSymbol}${totalPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

        // 영문 금액 표기 업데이트
        const words = this.numberToEnglishWords(totalPrice, currency);
        document.getElementById('formAmountInWords').innerText = words;
    },

    // -------------------------------------------------------------
    // 5. 영문 금액 문자 변환기 (Amount in Words)
    // -------------------------------------------------------------
    numberToEnglishWords: function(amount, currency = 'USD') {
        if (!amount || isNaN(amount) || amount === 0) return "Say Zero Dollars Only";

        const th = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
        const dg = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
        const tn = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
        const tw = ['Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

        function toWords(s) {
            s = s.toString();
            s = s.replace(/[\, ]/g, '');
            if (s != parseFloat(s)) return '';
            let x = s.indexOf('.');
            if (x == -1) x = s.length;
            if (x > 15) return 'too big';
            let n = s.split('');
            let str = '';
            let sk = 0;
            for (let i = 0; i < x; i++) {
                if ((x - i) % 3 == 2) {
                    if (n[i] == '1') {
                        str += tn[Number(n[i + 1])] + ' ';
                        i++;
                        sk = 1;
                    } else if (n[i] != 0) {
                        str += tw[n[i] - 2] + ' ';
                        sk = 1;
                    }
                } else if (n[i] != 0) {
                    str += dg[n[i]] + ' ';
                    if ((x - i) % 3 == 0) str += 'Hundred ';
                    sk = 1;
                }
                if ((x - i) % 3 == 1) {
                    if (sk) str += th[(x - i - 1) / 3] + ' ';
                    sk = 0;
                }
            }
            return str.trim();
        }

        const intPart = Math.floor(amount);
        const decPart = Math.round((amount - intPart) * 100);

        let currencyWord = "US Dollars";
        let subWord = "Cents";
        if (currency === 'EUR') { currencyWord = "Euros"; subWord = "Cents"; }
        else if (currency === 'KRW') { currencyWord = "Korean Won"; subWord = ""; }
        else if (currency === 'CNY') { currencyWord = "Chinese Yuan"; subWord = "Fen"; }
        else if (currency === 'JPY') { currencyWord = "Japanese Yen"; subWord = ""; }

        let result = `Say ${currencyWord} ${toWords(intPart)}`;
        if (decPart > 0 && subWord) {
            result += ` and ${toWords(decPart)} ${subWord}`;
        }
        result += " Only";
        return result;
    },

    // -------------------------------------------------------------
    // 6. 특약사항 프리셋 문구 삽입
    // -------------------------------------------------------------
    insertShippingDocsPreset: function() {
        const text = `Required Shipping Documents:
- Commercial Invoice (3 copies)
- Packing List (3 copies)
- Clean on Board Ocean Bill of Lading (3 original & 3 non-negotiable copies)
- Certificate of Origin (Korea-China FTA C/O)
- Certificate of Analysis (COA) / Mill Test Certificate
- Material Safety Data Sheet (MSDS)`;

        const notes = document.getElementById('formNotes');
        notes.value = notes.value ? (notes.value + '\n\n' + text) : text;
    },

    insertTailGreaseNotesPreset: function() {
        const text = `1. All 25kg drums must be packaged according to the specifications in the drawing below.
2. Tail Grease must be packaged separately by intended use (PA for 1st Filling & TMT-100 for 2nd Filling).
   1) Tail Grease - PA for 1st Filling must be packaged on a single (1) pallet.
   2) Labels for PA(1st Filling) and TMT-100(2nd Filling) must be of different colors and clearly indicate the intended use to ensure they are clearly distinguishable by sight.
3. All other terms of this Purchase Order shall be subject to the Sales Agreement dated June 30, 2025.`;

        const notes = document.getElementById('formNotes');
        notes.value = notes.value ? (notes.value + '\n\n' + text) : text;
    },

    // -------------------------------------------------------------
    // 7. 도면 첨부 이미지 드래그&드롭 및 업로드
    // -------------------------------------------------------------
    setupDragAndDrop: function() {
        const zone = document.getElementById('drawingDropZone');
        if (!zone) return;
        ['dragenter', 'dragover'].forEach(name => {
            zone.addEventListener(name, (e) => { e.preventDefault(); zone.style.borderColor = 'var(--primary-color)'; });
        });
        ['dragleave', 'drop'].forEach(name => {
            zone.addEventListener(name, (e) => { e.preventDefault(); zone.style.borderColor = '#cbd5e1'; });
        });
        zone.addEventListener('drop', (e) => {
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.uploadDrawingFile(e.dataTransfer.files[0]);
            }
        });
    },

    onDrawingFileSelected: function(e) {
        if (e.target.files && e.target.files[0]) {
            this.uploadDrawingFile(e.target.files[0]);
        }
    },

    uploadDrawingFile: async function(file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await authFetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
            const data = await parseJsonResponse(res);
            if (data.url) {
                this.setDrawingPreview(data.url);
            }
        } catch (err) {
            alert('도면 업로드 실패: ' + err.message);
        }
    },

    setDrawingPreview: function(url) {
        this.drawingUrl = url;
        document.getElementById('drawingPreviewImg').src = resolveUrl(url);
        document.getElementById('drawingImgWrap').classList.remove('d-none');
        document.getElementById('drawingEmptyNotice').classList.add('d-none');
    },

    removeDrawingImage: function() {
        this.drawingUrl = '';
        document.getElementById('drawingPreviewImg').src = '';
        document.getElementById('drawingImgWrap').classList.add('d-none');
        document.getElementById('drawingEmptyNotice').classList.remove('d-none');
        document.getElementById('drawingFileInput').value = '';
    },

    // -------------------------------------------------------------
    // 8. 발주서 저장 (신규 등록 및 수정)
    // -------------------------------------------------------------
    savePurchaseOrder: async function() {
        const poNumber = document.getElementById('formPoNumber').value.trim();
        if (!poNumber) {
            alert('발주서 번호(PO Number)를 입력해주세요.');
            document.getElementById('formPoNumber').focus();
            return;
        }

        const sellerName = document.getElementById('formSellerName').value.trim();
        if (!sellerName) {
            alert('공급처(Seller Company Name)를 입력해주세요.');
            document.getElementById('formSellerName').focus();
            return;
        }

        const items = [];
        let hasItemError = false;
        document.querySelectorAll('#itemsTableBody tr').forEach((tr, idx) => {
            const pName = tr.querySelector('.item-name').value.trim();
            const hs = tr.querySelector('.item-hs').value.trim();
            const pUnit = tr.querySelector('.item-pkg-unit').value.trim();
            const qty = parseFloat(tr.querySelector('.item-qty').value) || 0;
            const unit = tr.querySelector('.item-unit').value;
            const price = parseFloat(tr.querySelector('.item-price').value) || 0;
            const total = parseFloat(tr.querySelector('.item-total').value) || 0;
            const pkgQty = tr.querySelector('.item-pkg-qty').value.trim();

            if (!pName) {
                hasItemError = true;
                return;
            }
            items.push({
                seq: idx + 1,
                product_name: pName,
                hs_code: hs,
                packaging_unit: pUnit,
                order_qty: qty,
                unit: unit,
                unit_price: price,
                total_price: total,
                packaging_qty: pkgQty
            });
        });

        if (hasItemError || items.length === 0) {
            alert('최소 1개 이상의 품목명을 정확히 입력해주세요.');
            return;
        }

        let totalQty = 0;
        let totalPrice = 0;
        items.forEach(it => {
            totalQty += it.order_qty;
            totalPrice += it.total_price;
        });

        const currency = document.getElementById('formCurrency').value || 'USD';
        const amountWords = this.numberToEnglishWords(totalPrice, currency);

        const payload = {
            po_number: poNumber,
            issue_date: document.getElementById('formIssueDate').value,
            references_text: document.getElementById('formReferences').value.trim(),
            validity_date: document.getElementById('formValidityDate').value,
            buyer_name: document.getElementById('formBuyerName').value.trim(),
            buyer_address: document.getElementById('formBuyerAddress').value.trim(),
            buyer_attn: document.getElementById('formBuyerAttn').value.trim(),
            buyer_tel: document.getElementById('formBuyerTel').value.trim(),
            buyer_email: document.getElementById('formBuyerEmail').value.trim(),
            seller_name: sellerName,
            seller_address: document.getElementById('formSellerAddress').value.trim(),
            seller_attn: document.getElementById('formSellerAttn').value.trim(),
            seller_tel: document.getElementById('formSellerTel').value.trim(),
            seller_email: document.getElementById('formSellerEmail').value.trim(),
            payment_terms: document.getElementById('formPaymentTerms').value.trim(),
            loading_port: document.getElementById('formLoadingPort').value.trim(),
            discharging_port: document.getElementById('formDischargingPort').value.trim(),
            delivery_terms: document.getElementById('formDeliveryTerms').value.trim(),
            country_of_origin: document.getElementById('formCountryOfOrigin').value.trim(),
            delivery_date: document.getElementById('formDeliveryDate').value.trim(),
            shipment_spec: document.getElementById('formShipmentSpec').value.trim(),
            currency: currency,
            amount_in_words: amountWords,
            total_amount: totalPrice,
            total_qty: totalQty,
            total_pkg_qty: '',
            notes_instructions: document.getElementById('formNotes').value.trim(),
            drawing_image_url: this.drawingUrl || '',
            include_seal: document.getElementById('formIncludeSeal').checked ? 1 : 0,
            status: document.getElementById('formStatus').value,
            items: items
        };

        const poId = document.getElementById('poId').value;
        const isEdit = !!poId;
        const url = isEdit ? `${API_BASE}/${poId}` : API_BASE;
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await authFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const resData = await parseJsonResponse(res).catch(e => ({ error: e.message }));
            if (!res.ok) {
                alert('저장 실패: ' + (resData.error || '오류가 발생했습니다.'));
                return;
            }
            alert(isEdit ? '발주서가 수정되었습니다.' : '신규 발주서가 저장되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('poFormModal')).hide();
            this.loadPurchaseOrders();
        } catch (err) {
            alert('저장 중 네트워크 오류: ' + err.message);
        }
    },

    // -------------------------------------------------------------
    // 9. 인쇄 및 PDF 내보내기 로직 (첨부 PDF와 100% 동일한 A4 규격)
    // -------------------------------------------------------------
    preparePrint: async function(id) {
        try {
            const res = await authFetch(`${API_BASE}/${id}`);
            if (!res.ok) {
                const errData = await parseJsonResponse(res).catch(() => null);
                throw new Error(errData?.error || '발주서 데이터를 가져오지 못했습니다.');
            }
            const po = await parseJsonResponse(res);
            this.currentPrintPo = po;

            // 직인 포함 여부 기본 체크 설정
            document.getElementById('printOptSeal').checked = po.include_seal === 1;
            new bootstrap.Modal(document.getElementById('printOptionModal')).show();
        } catch (err) {
            alert('인쇄 준비 실패: ' + err.message);
        }
    },

    executePrint: function() {
        const po = this.currentPrintPo;
        if (!po) return;

        const includeSeal = document.getElementById('printOptSeal').checked;
        bootstrap.Modal.getInstance(document.getElementById('printOptionModal')).hide();

        const container = document.getElementById('printContainer');
        container.innerHTML = this.generatePrintHtml(po, includeSeal);

        setTimeout(() => {
            window.print();
        }, 200);
    },

    generatePrintHtml: function(po, includeSeal) {
        const items = po.items || [];
        const currency = po.currency || 'USD';
        const currSymbol = currency === 'USD' ? '$' : (currency === 'EUR' ? '€' : (currency === 'KRW' ? '₩' : currency + ' '));

        let itemsRowsHtml = '';
        items.forEach((item, idx) => {
            const hsDisplay = item.hs_code ? `<br><span style="font-size: 8.5px; color: #555;">(HS: ${item.hs_code})</span>` : '';
            const formattedPrice = (item.unit_price != null) ? `${currSymbol}${Number(item.unit_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}/${item.unit || 'KG'}` : '-';
            const formattedTotal = (item.total_price != null) ? `${currSymbol}${Number(item.total_price).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-';
            const orderQtyStr = Number(item.order_qty).toLocaleString();

            itemsRowsHtml += `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td class="text-left"><strong>${item.product_name || '-'}</strong>${hsDisplay}</td>
                    <td class="text-center">${item.packaging_unit || '-'}</td>
                    <td class="text-center">${formattedPrice}</td>
                    <td class="text-right">${orderQtyStr}</td>
                    <td class="text-center">${item.unit || 'KG'}</td>
                    <td class="text-right fw-bold">${formattedTotal}</td>
                    <td class="text-center">${item.packaging_qty || '-'}</td>
                </tr>
            `;
        });

        // 빈 행 채우기 (첨부 PDF와 동일한 레이아웃 밸런스 유지: 최소 3행)
        const emptyRowsCount = Math.max(0, 3 - items.length);
        for (let i = 0; i < emptyRowsCount; i++) {
            itemsRowsHtml += `
                <tr>
                    <td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                </tr>
            `;
        }

        const totalQtyStr = Number(po.total_qty || 0).toLocaleString();
        const totalAmountStr = `${currSymbol}${Number(po.total_amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        const mainUnit = items[0] ? (items[0].unit || 'KG') : 'KG';

        // 도면 이미지 HTML
        let drawingHtml = '';
        if (po.drawing_image_url) {
            drawingHtml = `
                <div class="po-drawing-wrap">
                    <img src="${resolveUrl(po.drawing_image_url)}" alt="Specification Drawing">
                </div>
            `;
        }

        // 직인/사인 날인 HTML
        let stampHtml = '';
        if (includeSeal && this.settings.seal_url) {
            stampHtml = `<img src="${resolveUrl(this.settings.seal_url)}" class="po-stamp-img" alt="직인">`;
        }
        if (includeSeal && this.settings.sign_url) {
            stampHtml += `<img src="${resolveUrl(this.settings.sign_url)}" class="po-stamp-img" style="opacity: 0.95;" alt="서명">`;
        }

        return `
            <div class="po-print-sheet">
                <div class="po-main-border-box">
                    <h1 class="po-print-title">Purchase Order</h1>

                    <!-- 상단 헤더 메타 테이블 -->
                    <table class="po-meta-table">
                        <tr>
                            <th>PO Number</th>
                            <td><strong>${po.po_number || ''}</strong></td>
                            <th>References</th>
                            <td>${po.references_text || ''}</td>
                        </tr>
                        <tr>
                            <th>Issue Date</th>
                            <td>${po.issue_date || ''}</td>
                            <th>Validity Date</th>
                            <td>${po.validity_date || ''}</td>
                        </tr>
                    </table>

                    <!-- Buyer & Seller 테이블 -->
                    <table class="po-parties-table">
                        <thead>
                            <tr>
                                <th>Official Distributor (Buyer)</th>
                                <th>Manufacturer (Seller)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>
                                    <strong>${po.buyer_name || 'K&G CO., LTD.'}</strong><br>
                                    ${po.buyer_address || ''}<br>
                                    ${po.buyer_attn ? 'ATTN: ' + po.buyer_attn + '<br>' : ''}
                                    ${po.buyer_tel ? 'Tel: ' + po.buyer_tel + '<br>' : ''}
                                    ${po.buyer_email ? 'E-mail: ' + po.buyer_email : ''}
                                </td>
                                <td>
                                    <strong>${po.seller_name || ''}</strong><br>
                                    ${po.seller_address || ''}<br>
                                    ${po.seller_attn ? 'ATTN: ' + po.seller_attn + '<br>' : ''}
                                    ${po.seller_tel ? 'Tel: ' + po.seller_tel + '<br>' : ''}
                                    ${po.seller_email ? 'E-mail: ' + po.seller_email : ''}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- 무역 조건 테이블 -->
                    <table class="po-terms-table">
                        <tr>
                            <th style="width: 20%;">Terms of Payment</th>
                            <td style="width: 80%;" colspan="3">${po.payment_terms || '-'}</td>
                        </tr>
                        <tr>
                            <th style="width: 20%;">Loading Port</th>
                            <td style="width: 30%;">${po.loading_port || '-'}</td>
                            <th style="width: 20%;">Discharging Port</th>
                            <td style="width: 30%;">${po.discharging_port || '-'}</td>
                        </tr>
                        <tr>
                            <th>Terms of Delivery</th>
                            <td>${po.delivery_terms || '-'}</td>
                            <th>Country of Origin</th>
                            <td>${po.country_of_origin || '-'}</td>
                        </tr>
                        <tr>
                            <th>Delivery Date</th>
                            <td>${po.delivery_date || '-'}</td>
                            <th>Shipment Spec</th>
                            <td>${po.shipment_spec || '-'}</td>
                        </tr>
                    </table>

                    <!-- 품목 테이블 -->
                    <table class="po-products-table">
                        <thead>
                            <tr>
                                <th style="width: 5%;">No</th>
                                <th style="width: 26%;">Product</th>
                                <th style="width: 14%;">Packaging Unit</th>
                                <th style="width: 13%;">Unit Price</th>
                                <th style="width: 10%;">Order Q'ty</th>
                                <th style="width: 6%;">Unit</th>
                                <th style="width: 12%;">Total Price</th>
                                <th style="width: 14%;">Packaging Q'ty</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${itemsRowsHtml}
                            <tr class="po-total-row">
                                <td colspan="4" class="text-center">Total</td>
                                <td class="text-right">${totalQtyStr}</td>
                                <td class="text-center">${mainUnit}</td>
                                <td class="text-right">${totalAmountStr}</td>
                                <td class="text-center">${po.total_pkg_qty || ''}</td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- 영문 총금액 표기행 -->
                    <div class="po-amount-words-row">
                        Amount in Words: <span style="font-weight: 800;">${po.amount_in_words || ''}</span>
                    </div>

                    <!-- 특약사항 및 지시사항 -->
                    <div class="po-notes-section">
                        <div class="po-notes-title">Notes or Special Instructions</div>
                        ${drawingHtml}
                        <div style="white-space: pre-line;">${po.notes_instructions || 'All other terms of this Purchase Order shall be subject to the Sales Agreement.'}</div>
                    </div>

                    <!-- 공식 서명란 (Buyer 단독 서명) -->
                    <table class="po-signature-table">
                        <tr>
                            <td style="width: 55%; border: none;"></td>
                            <td style="width: 45%; padding: 0;">
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <th style="border: 1px solid #000; padding: 4px 6px;">Official Distributor (Buyer)</th>
                                    </tr>
                                    <tr>
                                        <td style="border: 1px solid #000; padding: 6px 8px;">
                                            <strong>${po.buyer_name || 'K&G CO., LTD.'}</strong>
                                            <div class="po-stamp-box">
                                                ${stampHtml}
                                            </div>
                                            <div style="font-weight: bold; border-top: 1px solid #000; padding-top: 4px;">
                                                ${this.settings.ceo_name || 'CEO / Youn, Jong'}
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </div>
            </div>
        `;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
