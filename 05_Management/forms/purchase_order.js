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
    filteredPoList: [],
    partnersList: [],
    currentPo: null,
    currentStatusFilter: '전체',
    currentDatePreset: 'all',
    currentLimit: 50,
    settings: {
        seal_url: '../../assets/images/stamp.png',
        eng_sign_url: '',
        sign_url: '',
        ceo_name: 'CEO / Youn, Jong'
    },
    drawingFile: null,
    drawingUrl: '',
    currentPrintPo: null,

    init: async function() {
        await this.loadSettings();
        await this.loadPartners();
        await this.loadPurchaseOrders();
        this.setupDragAndDrop();
    },

    // -------------------------------------------------------------
    // 0. 거래처 프리셋 연동 (03_monthly_closing/partners API 연동)
    // -------------------------------------------------------------
    loadPartners: async function() {
        try {
            const res = await authFetch('/api/partners');
            if (res.ok) {
                const data = await parseJsonResponse(res);
                this.partnersList = Array.isArray(data) ? data : (data.partners || []);
                this.populateSellerPartnerSelect();
            }
        } catch (e) {
            console.warn('거래처 목록을 불러오지 못했습니다:', e);
        }
    },

    populateSellerPartnerSelect: function() {
        const select = document.getElementById('sellerPartnerSelect');
        if (!select) return;
        let html = '<option value="">-- [선택] 등록된 거래처에서 불러오기 --</option>';
        if (this.partnersList && this.partnersList.length > 0) {
            this.partnersList.forEach(p => {
                const korName = p.company_name || p.name || '';
                const engName = p.company_name_en ? ` (${p.company_name_en})` : '';
                html += `<option value="${p.id}">${korName}${engName}</option>`;
            });
        }
        select.innerHTML = html;
    },

    onSelectSellerPartner: function(partnerId) {
        if (!partnerId) return;
        const p = this.partnersList.find(x => String(x.id) === String(partnerId));
        if (!p) return;

        // 영문 필드 우선 적용 (없으면 국문 fallback)
        const companyName = p.company_name_en || p.company_name || p.name || '';
        const address = p.address_en || p.address || '';
        const attn = p.manager_en || p.manager1_name || p.manager || '';
        const tel = p.manager1_phone || p.phone || '';
        const email = p.manager1_email || p.email || '';

        if (companyName) document.getElementById('formSellerName').value = companyName;
        if (address) document.getElementById('formSellerAddress').value = address;
        if (attn) document.getElementById('formSellerAttn').value = attn;
        if (tel) document.getElementById('formSellerTel').value = tel;
        if (email) document.getElementById('formSellerEmail').value = email;
    },

    // -------------------------------------------------------------
    // 1. 설정 및 기본값 로드
    // -------------------------------------------------------------
    loadSettings: async function() {
        try {
            const res = await authFetch(`${API_BASE}/config/settings`);
            if (res.ok) {
                const data = await parseJsonResponse(res);
                if (data.seal_url !== undefined) this.settings.seal_url = data.seal_url;
                if (data.eng_sign_url !== undefined) this.settings.eng_sign_url = data.eng_sign_url;
                if (data.sign_url !== undefined) this.settings.sign_url = data.sign_url;
                if (data.ceo_name !== undefined) this.settings.ceo_name = data.ceo_name;
            }
        } catch (e) {
            console.warn('설정을 불러오지 못했습니다. 기본값을 사용합니다.', e);
        }
    },

    openSettingsModal: function() {
        // 1. 회사 대표 직인 (도장)
        const sealImg = document.getElementById('settingSealImg');
        const sealEmptyText = document.getElementById('settingSealEmptyText');
        if (this.settings.seal_url) {
            sealImg.src = resolveUrl(this.settings.seal_url);
            sealImg.style.display = 'block';
            if (sealEmptyText) sealEmptyText.classList.add('d-none');
        } else {
            sealImg.src = '';
            sealImg.style.display = 'none';
            if (sealEmptyText) sealEmptyText.classList.remove('d-none');
        }

        // 2. 영문 자필 서명 (English Handwritten Signature 이미지)
        const engSignImg = document.getElementById('settingEngSignImg');
        const engSignEmptyText = document.getElementById('settingEngSignEmptyText');
        if (this.settings.eng_sign_url) {
            engSignImg.src = resolveUrl(this.settings.eng_sign_url);
            engSignImg.style.display = 'block';
            if (engSignEmptyText) engSignEmptyText.style.display = 'none';
        } else {
            engSignImg.src = '';
            engSignImg.style.display = 'none';
            if (engSignEmptyText) engSignEmptyText.style.display = 'block';
        }

        // 3. 대표자 자필 사인 (Handwritten Sign 이미지)
        const signImg = document.getElementById('settingSignImg');
        const signEmptyText = document.getElementById('settingSignEmptyText');
        if (this.settings.sign_url) {
            signImg.src = resolveUrl(this.settings.sign_url);
            signImg.style.display = 'block';
            if (signEmptyText) signEmptyText.style.display = 'none';
        } else {
            signImg.src = '';
            signImg.style.display = 'none';
            if (signEmptyText) signEmptyText.style.display = 'block';
        }

        // 4. 대표자 영문 성명/직함 텍스트
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
                const sealImg = document.getElementById('settingSealImg');
                sealImg.src = resolveUrl(data.url);
                sealImg.style.display = 'block';
                const emptyText = document.getElementById('settingSealEmptyText');
                if (emptyText) emptyText.classList.add('d-none');
            }
        } catch (err) {
            alert('직인 파일 업로드 실패: ' + err.message);
        }
    },

    removeSealPreset: function() {
        if (!confirm('등록된 회사 직인 이미지를 삭제하시겠습니까?')) return;
        this.settings.seal_url = '';
        const sealImg = document.getElementById('settingSealImg');
        sealImg.src = '';
        sealImg.style.display = 'none';
        const emptyText = document.getElementById('settingSealEmptyText');
        if (emptyText) emptyText.classList.remove('d-none');
        document.getElementById('sealFileInput').value = '';
    },

    uploadEngSignFile: async function(event) {
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
                this.settings.eng_sign_url = data.url;
                const engSignImg = document.getElementById('settingEngSignImg');
                engSignImg.src = resolveUrl(data.url);
                engSignImg.style.display = 'block';
                const emptyText = document.getElementById('settingEngSignEmptyText');
                if (emptyText) emptyText.style.display = 'none';
            }
        } catch (err) {
            alert('영문 자필 서명 업로드 실패: ' + err.message);
        }
    },

    removeEngSignPreset: function() {
        if (!confirm('등록된 영문 자필 서명 이미지를 삭제하시겠습니까?')) return;
        this.settings.eng_sign_url = '';
        const engSignImg = document.getElementById('settingEngSignImg');
        engSignImg.src = '';
        engSignImg.style.display = 'none';
        const emptyText = document.getElementById('settingEngSignEmptyText');
        if (emptyText) emptyText.style.display = 'block';
        document.getElementById('engSignFileInput').value = '';
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
                const emptyText = document.getElementById('settingSignEmptyText');
                if (emptyText) emptyText.style.display = 'none';
            }
        } catch (err) {
            alert('자필 사인 파일 업로드 실패: ' + err.message);
        }
    },

    removeSignPreset: function() {
        if (!confirm('등록된 대표자 자필 사인 이미지를 삭제하시겠습니까?')) return;
        this.settings.sign_url = '';
        const signImg = document.getElementById('settingSignImg');
        signImg.src = '';
        signImg.style.display = 'none';
        const emptyText = document.getElementById('settingSignEmptyText');
        if (emptyText) emptyText.style.display = 'block';
        document.getElementById('signFileInput').value = '';
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
                alert('대표자 직인 및 서명/사인 설정이 저장되었습니다.');
            } else {
                alert('설정 저장에 실패했습니다.');
            }
        } catch (err) {
            alert('오류 발생: ' + err.message);
        }
    },

    // -------------------------------------------------------------
    // 2. 발주서 목록 조회 및 ECOUNT ERP 필터링 시스템
    // -------------------------------------------------------------
    loadPurchaseOrders: async function() {
        try {
            const res = await authFetch(API_BASE);
            if (!res.ok) {
                const errData = await parseJsonResponse(res).catch(() => null);
                throw new Error(errData?.error || `목록을 불러오지 못했습니다. (HTTP ${res.status})`);
            }
            const data = await parseJsonResponse(res);
            this.poList = data || [];
            this.applyFilters();
        } catch (err) {
            document.getElementById('poTableBody').innerHTML = `
                <tr><td colspan="10" class="text-center py-4 text-danger">
                    <i class='bx bx-error-circle fs-3'></i><br>${err.message}
                </td></tr>
            `;
        }
    },

    onStatusFilterChange: function(status) {
        this.currentStatusFilter = status;
        this.applyFilters();
    },

    setDatePreset: function(preset) {
        this.currentDatePreset = preset;
        const group = document.getElementById('datePresetGroup');
        if (group) {
            group.querySelectorAll('.btn').forEach(btn => {
                btn.className = 'btn btn-outline-secondary text-nowrap';
            });
            const targetBtn = document.getElementById(`btnPreset_${preset}`);
            if (targetBtn) {
                targetBtn.className = 'btn btn-primary text-white fw-bold text-nowrap';
            }
        }

        const now = new Date();
        const startInput = document.getElementById('filterStartDate');
        const endInput = document.getElementById('filterEndDate');

        const formatDate = (d) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        if (preset === 'thisMonth') {
            const start = new Date(now.getFullYear(), now.getMonth(), 1);
            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            startInput.value = formatDate(start);
            endInput.value = formatDate(end);
        } else if (preset === 'prevMonth') {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            startInput.value = formatDate(start);
            endInput.value = formatDate(end);
        } else if (preset === 'thisYear') {
            const start = new Date(now.getFullYear(), 0, 1);
            const end = new Date(now.getFullYear(), 11, 31);
            startInput.value = formatDate(start);
            endInput.value = formatDate(end);
        } else if (preset === 'all') {
            startInput.value = '';
            endInput.value = '';
        }

        this.applyFilters();
    },

    onDateInputChange: function() {
        const group = document.getElementById('datePresetGroup');
        if (group) {
            group.querySelectorAll('.btn').forEach(btn => {
                btn.className = 'btn btn-outline-secondary text-nowrap';
            });
        }
        this.applyFilters();
    },

    onSearchTargetChange: function() {
        this.applyFilters();
    },

    onSearchInputKeyup: function(e) {
        const val = (document.getElementById('searchKeyword').value || '').trim();
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            clearBtn.classList.toggle('d-none', !val);
        }
        if (e.key === 'Enter') {
            this.applyFilters();
        }
    },

    clearSearchInput: function() {
        const input = document.getElementById('searchKeyword');
        if (input) input.value = '';
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.applyFilters();
    },

    onLimitChange: function() {
        const limitVal = parseInt(document.getElementById('pageLimit').value, 10) || 50;
        this.currentLimit = limitVal;
        this.applyFilters();
    },

    applyFilters: function() {
        const keyword = (document.getElementById('searchKeyword') ? document.getElementById('searchKeyword').value : '').trim().toLowerCase();
        const searchTarget = document.getElementById('searchTarget') ? document.getElementById('searchTarget').value : '';
        const startDate = document.getElementById('filterStartDate') ? document.getElementById('filterStartDate').value : '';
        const endDate = document.getElementById('filterEndDate') ? document.getElementById('filterEndDate').value : '';
        const status = this.currentStatusFilter || '전체';

        // 단어별 분리 (교집합 다중 검색 지원)
        const words = keyword ? keyword.split(/\s+/).filter(Boolean) : [];

        let filtered = this.poList.filter(po => {
            // 1. 상태 필터
            if (status !== '전체' && po.status !== status) {
                return false;
            }

            // 2. 날짜 범위 필터 (issue_date 기준)
            if (startDate && po.issue_date && po.issue_date < startDate) {
                return false;
            }
            if (endDate && po.issue_date && po.issue_date > endDate) {
                return false;
            }

            // 3. 다중 키워드 교집합 검색
            if (words.length > 0) {
                let targetText = '';
                if (searchTarget === 'po_number') {
                    targetText = `${po.po_number || ''}`;
                } else if (searchTarget === 'seller') {
                    targetText = `${po.seller_name || ''} ${po.seller_attn || ''} ${po.seller_email || ''}`;
                } else if (searchTarget === 'item') {
                    targetText = `${po.first_item_name || ''}`;
                } else if (searchTarget === 'references') {
                    targetText = `${po.references_text || ''}`;
                } else if (searchTarget === 'notes') {
                    targetText = `${po.notes_instructions || ''}`;
                } else {
                    // 전체 대상
                    targetText = `${po.po_number || ''} ${po.seller_name || ''} ${po.first_item_name || ''} ${po.references_text || ''} ${po.notes_instructions || ''} ${po.buyer_name || ''}`;
                }
                targetText = targetText.toLowerCase();

                const matchesAll = words.every(word => targetText.includes(word));
                if (!matchesAll) return false;
            }

            return true;
        });

        this.filteredPoList = filtered;

        // 개수 뱃지 갱신
        const badge = document.getElementById('filterCountBadge');
        if (badge) {
            badge.innerText = `총 ${filtered.length.toLocaleString()}건`;
        }

        // 페이지 리미트 적용 후 렌더링
        const displayList = filtered.slice(0, this.currentLimit);
        this.renderPoList(displayList);
    },

    resetFilters: function() {
        const input = document.getElementById('searchKeyword');
        if (input) input.value = '';
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');

        const target = document.getElementById('searchTarget');
        if (target) target.value = '';

        const radioAll = document.getElementById('btnFilterAll');
        if (radioAll) radioAll.checked = true;
        this.currentStatusFilter = '전체';

        this.setDatePreset('all');
    },

    exportExcel: function() {
        const list = (this.filteredPoList && this.filteredPoList.length > 0) ? this.filteredPoList : this.poList;
        if (!list || list.length === 0) {
            alert('내보낼 발주서 데이터가 없습니다.');
            return;
        }

        const headers = [
            'No', '발주번호(PO No.)', '발행일자', '유효일자', '공급처(Seller)', 
            '대표 품목', '품목수', '통화', '총 금액', '진행상태', '참조계약', '인도조건', '결제조건', '비고'
        ];

        const rows = list.map((po, idx) => [
            idx + 1,
            po.po_number || '',
            po.issue_date || '',
            po.validity_date || '',
            po.seller_name || '',
            po.first_item_name || '',
            po.item_count || 1,
            po.currency || 'USD',
            po.total_amount != null ? Number(po.total_amount) : 0,
            po.status || '작성중',
            po.references_text || '',
            po.delivery_terms || '',
            po.payment_terms || '',
            po.notes_instructions || ''
        ]);

        if (typeof XLSX !== 'undefined') {
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            ws['!cols'] = [
                { wch: 6 },  // No
                { wch: 18 }, // 발주번호
                { wch: 12 }, // 발행일자
                { wch: 12 }, // 유효일자
                { wch: 26 }, // 공급처
                { wch: 30 }, // 대표 품목
                { wch: 8 },  // 품목수
                { wch: 8 },  // 통화
                { wch: 14 }, // 총 금액
                { wch: 10 }, // 진행상태
                { wch: 20 }, // 참조계약
                { wch: 16 }, // 인도조건
                { wch: 30 }, // 결제조건
                { wch: 40 }  // 비고
            ];
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '발주서목록');
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            XLSX.writeFile(wb, `발주서목록_${today}.xlsx`);
        } else {
            // CSV Fallback (UTF-8 BOM 포함)
            let csvContent = '\uFEFF' + headers.join(',') + '\n';
            rows.forEach(r => {
                const escaped = r.map(cell => {
                    const str = String(cell == null ? '' : cell).replace(/"/g, '""');
                    return `"${str}"`;
                });
                csvContent += escaped.join(',') + '\n';
            });
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            a.download = `발주서목록_${today}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    },

    renderPoList: function(listToRender = null) {
        const tbody = document.getElementById('poTableBody');
        const list = listToRender || this.filteredPoList || this.poList;

        if (!list || list.length === 0) {
            tbody.innerHTML = `
                <tr><td colspan="10" class="text-center py-5 text-muted">
                    <i class='bx bx-file-blank fs-2 mb-2'></i><br>조회된 발주서가 없습니다.
                </td></tr>
            `;
            return;
        }

        let html = '';
        list.forEach((po, idx) => {
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
                    <td class="text-center" style="white-space: nowrap;">
                        <div class="d-inline-flex gap-1 align-items-center" style="white-space: nowrap;">
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

    // -------------------------------------------------------------
    // 3. 발주서 작성/수정 모달 로직
    // -------------------------------------------------------------
    onIssueDateChange: function() {
        const issueDateVal = document.getElementById('formIssueDate').value;
        if (!issueDateVal) return;
        const d = new Date(issueDateVal);
        if (isNaN(d.getTime())) return;
        d.setDate(d.getDate() + 7);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        document.getElementById('formValidityDate').value = `${yyyy}-${mm}-${dd}`;
    },

    openCreateModal: function() {
        this.currentPo = null;
        document.getElementById('poModalTitle').innerHTML = "<i class='bx bx-plus-circle text-primary'></i> 신규 발주서 작성 (New Purchase Order)";
        document.getElementById('poId').value = '';
        
        // 날짜 기본값: 오늘 & 유효일자 = 오늘 + 7일
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('formIssueDate').value = today;
        this.onIssueDateChange();
        
        document.getElementById('formReferences').value = '';
        document.getElementById('formStatus').value = '작성중';

        // 발주번호 추천 생성 (KNG-OO-YYMM-#### 포맷)
        this.generateRecommendPoNumber();

        // 바이어 기본값
        this.loadBuyerPreset();

        // 거래처 드롭다운 초기화
        const partnerSelect = document.getElementById('sellerPartnerSelect');
        if (partnerSelect) partnerSelect.value = '';

        // 셀러 및 무역조건 초기화 (예시 텍스트가 value로 남아있지 않도록 모두 공란 처리, 플레이스홀더 안내)
        document.getElementById('formSellerName').value = '';
        document.getElementById('formSellerAddress').value = '';
        document.getElementById('formSellerAttn').value = '';
        document.getElementById('formSellerTel').value = '';
        document.getElementById('formSellerEmail').value = '';

        document.getElementById('formPaymentTerms').value = '';
        document.getElementById('formDeliveryTerms').value = '';
        document.getElementById('formCountryOfOrigin').value = '';
        document.getElementById('formLoadingPort').value = '';
        document.getElementById('formDischargingPort').value = '';
        document.getElementById('formDeliveryDate').value = '';
        document.getElementById('formShipmentSpec').value = '';

        document.getElementById('formCurrency').value = 'USD';
        document.getElementById('formNotes').value = '';
        this.removeDrawingImage();
        document.getElementById('formIncludeSeal').checked = true;

        // 품목 기본 1행 생성 (공란 상태로 플레이스홀더 표시)
        document.getElementById('itemsTableBody').innerHTML = '';
        this.addItemRow({ product_name: '', hs_code: '', packaging_unit: '', order_qty: 0, unit: 'KG', unit_price: 0, packaging_qty: '' });
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
            
            const partnerSelect = document.getElementById('sellerPartnerSelect');
            if (partnerSelect) partnerSelect.value = '';

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

            document.getElementById('poModalTitle').innerHTML = `<i class='bx bx-copy text-primary'></i> 발주서 복사 등록 (${po.po_number} 기반)`;

            // 1. Buyer 정보 복사 (기존 발주서에 입력된 정보 그대로 반영)
            if (po.buyer_name) document.getElementById('formBuyerName').value = po.buyer_name;
            if (po.buyer_address) document.getElementById('formBuyerAddress').value = po.buyer_address;
            if (po.buyer_attn) document.getElementById('formBuyerAttn').value = po.buyer_attn;
            if (po.buyer_tel) document.getElementById('formBuyerTel').value = po.buyer_tel;
            if (po.buyer_email) document.getElementById('formBuyerEmail').value = po.buyer_email;

            // 2. References & Dates
            document.getElementById('formReferences').value = po.references_text || '';
            if (po.validity_date) document.getElementById('formValidityDate').value = po.validity_date;

            // 3. Seller 정보 복사
            document.getElementById('formSellerName').value = po.seller_name || '';
            document.getElementById('formSellerAddress').value = po.seller_address || '';
            document.getElementById('formSellerAttn').value = po.seller_attn || '';
            document.getElementById('formSellerTel').value = po.seller_tel || '';
            document.getElementById('formSellerEmail').value = po.seller_email || '';

            // 4. 무역 조건 복사
            document.getElementById('formPaymentTerms').value = po.payment_terms || '';
            document.getElementById('formDeliveryTerms').value = po.delivery_terms || '';
            document.getElementById('formCountryOfOrigin').value = po.country_of_origin || '';
            document.getElementById('formLoadingPort').value = po.loading_port || '';
            document.getElementById('formDischargingPort').value = po.discharging_port || '';
            document.getElementById('formDeliveryDate').value = po.delivery_date || '';
            document.getElementById('formShipmentSpec').value = po.shipment_spec || '';

            // 5. 통화, 특약, 직인옵션, 도면 복사
            document.getElementById('formCurrency').value = po.currency || 'USD';
            document.getElementById('formNotes').value = po.notes_instructions || '';
            document.getElementById('formIncludeSeal').checked = po.include_seal === 1;
            if (po.drawing_image_url) {
                this.setDrawingPreview(po.drawing_image_url);
            } else {
                this.removeDrawingImage();
            }

            // 6. 품목 상세 복사
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
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const count = this.poList.length + 1;
        const seq = String(count).padStart(4, '0');
        document.getElementById('formPoNumber').value = `KNG-OO-${yy}${mm}-${seq}`;
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
        const pkgUnit = data ? (data.packaging_unit || '') : '';
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

            // 대표자 성명 텍스트 표시
            const ceoText = this.settings.ceo_name ? `(${this.settings.ceo_name})` : '';
            const ceoLabel = document.getElementById('printOptCeoNameText');
            if (ceoLabel) ceoLabel.innerText = ceoText;

            // 기본 프리셋 설정
            if (this.settings.eng_sign_url && this.settings.seal_url) {
                this.setPrintPreset('eng_seal'); // 영문 서명 + 직인 (공식 무역) 기본
            } else if (this.settings.eng_sign_url && this.settings.sign_url) {
                this.setPrintPreset('eng_sign'); // 서명 + 사인
            } else if (this.settings.eng_sign_url) {
                this.setPrintPreset('eng_only'); // 영문 서명 단독
            } else if (this.settings.seal_url) {
                this.setPrintPreset('seal_only'); // 도장 단독
            } else {
                this.setPrintPreset('all');
            }

            new bootstrap.Modal(document.getElementById('printOptionModal')).show();
        } catch (err) {
            alert('인쇄 준비 실패: ' + err.message);
        }
    },

    setPrintPreset: function(type) {
        const optEngSign = document.getElementById('printOptEngSign');
        const optSign = document.getElementById('printOptSign');
        const optSeal = document.getElementById('printOptSeal');
        const optName = document.getElementById('printOptName');
        if (!optEngSign || !optSign || !optSeal || !optName) return;

        if (type === 'all') {
            optEngSign.checked = !!this.settings.eng_sign_url;
            optSign.checked = !!this.settings.sign_url;
            optSeal.checked = !!this.settings.seal_url;
            optName.checked = true;
        } else if (type === 'eng_seal') {
            // 영문 서명 + 직인 (공식 무역)
            optEngSign.checked = !!this.settings.eng_sign_url;
            optSign.checked = false;
            optSeal.checked = !!this.settings.seal_url;
            optName.checked = true;
        } else if (type === 'eng_sign') {
            // 영문 서명 + 사인 (글로벌)
            optEngSign.checked = !!this.settings.eng_sign_url;
            optSign.checked = !!this.settings.sign_url;
            optSeal.checked = false;
            optName.checked = true;
        } else if (type === 'eng_only') {
            // 영문 서명 단독
            optEngSign.checked = !!this.settings.eng_sign_url;
            optSign.checked = false;
            optSeal.checked = false;
            optName.checked = true;
        } else if (type === 'seal_only') {
            // 도장 단독
            optEngSign.checked = false;
            optSign.checked = false;
            optSeal.checked = !!this.settings.seal_url;
            optName.checked = true;
        } else if (type === 'blank') {
            // 수기용 (공란)
            optEngSign.checked = false;
            optSign.checked = false;
            optSeal.checked = false;
            optName.checked = false;
        }
    },

    onPrintOptionChange: function() {
        // 개별 옵션 변경 시 필요에 따라 처리
    },

    executePrint: function() {
        const po = this.currentPrintPo;
        if (!po) return;

        const includeEngSign = document.getElementById('printOptEngSign') ? document.getElementById('printOptEngSign').checked : true;
        const includeSign = document.getElementById('printOptSign') ? document.getElementById('printOptSign').checked : false;
        const includeSeal = document.getElementById('printOptSeal') ? document.getElementById('printOptSeal').checked : true;
        const includeName = document.getElementById('printOptName') ? document.getElementById('printOptName').checked : true;

        bootstrap.Modal.getInstance(document.getElementById('printOptionModal')).hide();

        const container = document.getElementById('printContainer');
        container.innerHTML = this.generatePrintHtml(po, { includeEngSign, includeSign, includeSeal, includeName });

        setTimeout(() => {
            window.print();
        }, 200);
    },

    generatePrintHtml: function(po, printOpts = {}) {
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

        // --- 스마트 날인(영문서명 / 자필사인 / 직인도장 / 영문성명) 레이아웃 생성 ---
        const includeName = printOpts.includeName !== false;
        const hasEngSign = !!printOpts.includeEngSign && !!this.settings.eng_sign_url;
        const hasSign = !!printOpts.includeSign && !!this.settings.sign_url;
        const hasSeal = !!printOpts.includeSeal && !!this.settings.seal_url;

        let buyerStampHtml = '';

        if (hasEngSign && hasSign && hasSeal) {
            // [영문 서명 + 자필 사인 + 직인 도장 모두 선택]
            // 사인은 서명 위 상단, 영문 서명은 가장 아래, 도장은 서명 우측 끝에 30% 오버랩 날인
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.sign_url)}" class="po-sign-top" alt="자필사인">
                <img src="${resolveUrl(this.settings.eng_sign_url)}" class="po-eng-sign-bottom" alt="영문서명">
                <img src="${resolveUrl(this.settings.seal_url)}" class="po-seal-overlap" alt="직인">
            `;
        } else if (hasEngSign && hasSeal) {
            // [영문 서명 + 직인 도장 (공식 무역 표준)]
            // 영문 서명은 가장 아래, 도장은 서명 우측 끝부분에 30% 걸쳐 날인
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.eng_sign_url)}" class="po-eng-sign-bottom" alt="영문서명">
                <img src="${resolveUrl(this.settings.seal_url)}" class="po-seal-overlap" alt="직인">
            `;
        } else if (hasEngSign && hasSign) {
            // [영문 서명 + 자필 사인 (글로벌 표준)]
            // 서명은 아래, 사인은 서명 위에 위치
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.sign_url)}" class="po-sign-top" alt="자필사인">
                <img src="${resolveUrl(this.settings.eng_sign_url)}" class="po-eng-sign-bottom" alt="영문서명">
            `;
        } else if (hasSign && hasSeal) {
            // [자필 사인 + 직인 도장]
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.sign_url)}" class="po-sign-top" style="top: 10px; left: 16px;" alt="자필사인">
                <img src="${resolveUrl(this.settings.seal_url)}" class="po-seal-overlap" alt="직인">
            `;
        } else if (hasEngSign) {
            // [영문 서명 단독: 칸 중앙 배치]
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.eng_sign_url)}" class="po-eng-sign-center" alt="영문서명">
            `;
        } else if (hasSign) {
            // [자필 사인 단독: 칸 중앙 배치]
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.sign_url)}" class="po-sign-center" alt="자필사인">
            `;
        } else if (hasSeal) {
            // [회사 직인 단독: 칸 중앙 배치]
            buyerStampHtml = `
                <img src="${resolveUrl(this.settings.seal_url)}" class="po-seal-center" alt="직인">
            `;
        }

        // 하단 영문 성명 텍스트 및 날짜 행
        const ceoNameText = includeName ? (this.settings.ceo_name || 'CEO / Youn, Jong') : '&nbsp;';
        const buyerFooterHtml = `
            <div class="po-sign-footer">
                <span class="po-ceo-name" style="${includeName ? '' : 'visibility: hidden;'}">${ceoNameText}</span>
                <span class="po-sign-date">Date: ${po.issue_date || ''}</span>
            </div>
        `;

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
                            <tr class="po-amount-words-row">
                                <td colspan="8">
                                    Amount in Words: <span style="font-weight: 800;">${po.amount_in_words || ''}</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- 특약사항 및 지시사항 -->
                    <div class="po-notes-section">
                        <div class="po-notes-title">Notes or Special Instructions</div>
                        ${drawingHtml}
                        <div style="white-space: pre-line;">${po.notes_instructions || 'All other terms of this Purchase Order shall be subject to the Sales Agreement.'}</div>
                    </div>

                    <!-- 공식 서명란 (발주자 Buyer 왼쪽, 공급자 Seller 오른쪽) -->
                    <table class="po-signature-table">
                        <thead>
                            <tr>
                                <th style="width: 50%;">Issued & Confirmed by: Official Distributor (Buyer)</th>
                                <th style="width: 50%;">Accepted & Confirmed by: Manufacturer (Seller)</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="width: 50%; vertical-align: top; position: relative;">
                                    <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">
                                        ${po.buyer_name || 'K&G CO., LTD.'}
                                    </div>
                                    <div class="po-stamp-box">
                                        ${buyerStampHtml}
                                    </div>
                                    ${buyerFooterHtml}
                                </td>
                                <td style="width: 50%; vertical-align: top; position: relative;">
                                    <div style="font-size: 11px; font-weight: bold; margin-bottom: 2px;">
                                        ${po.seller_name || 'Manufacturer / Supplier'}
                                    </div>
                                    <div class="po-stamp-box">
                                    </div>
                                    <div class="po-sign-footer">
                                        <span>&nbsp;</span>
                                        <span class="po-sign-date">Date: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
