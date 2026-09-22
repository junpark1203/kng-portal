// 03_monthly_closing/partners/app.js

const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://kng.junparks.com';

const API_BASE = `${SERVER_URL}/api`;

const app = {
    data: [],
    currentFilterTab: 'ALL',
    currentLimit: 50,
    modal: null,

    init() {
        const modalEl = document.getElementById('partnerModal');
        if (modalEl) {
            this.modal = new bootstrap.Modal(modalEl);
        }
        this.loadData();
    },

    async loadData() {
        try {
            const res = await window.authFetch(`${API_BASE}/partners`);
            if (!res.ok) throw new Error('API Error');
            const result = await res.json();
            this.data = Array.isArray(result) ? result : (result.partners || []);
            this.updateTabCounts();
            this.renderTable();
        } catch (error) {
            console.error('Failed to load partners:', error);
            if (window.Swal) {
                Swal.fire('오류', '거래처 데이터를 불러오는 중 오류가 발생했습니다.', 'error');
            }
        }
    },

    // 탭별 건수 뱃지 계산 및 업데이트
    updateTabCounts() {
        const total = this.data.length;
        const purchase = this.data.filter(p => p.type === '매입처').length;
        const sales = this.data.filter(p => p.type === '매출처').length;
        const overseas = this.data.filter(p => 
            p.company_name_en || p.address_en || p.manager_en || p.phone_en || p.email_en || p.type === '해외/무역'
        ).length;
        const etc = this.data.filter(p => p.type !== '매입처' && p.type !== '매출처').length;

        const setBadge = (id, count) => {
            const el = document.getElementById(id);
            if (el) el.innerText = count;
        };

        setBadge('badgeCountAll', total);
        setBadge('badgeCountPurchase', purchase);
        setBadge('badgeCountSales', sales);
        setBadge('badgeCountOverseas', overseas);
        setBadge('badgeCountEtc', etc);
    },

    onTabChange(tabValue) {
        this.currentFilterTab = tabValue;
        this.renderTable();
    },

    onSearchInput(val) {
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) {
            clearBtn.style.display = val ? 'inline-block' : 'none';
        }
        this.renderTable();
    },

    clearSearch() {
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) clearBtn.style.display = 'none';
        this.renderTable();
    },

    onChangeLimit(limitVal) {
        this.currentLimit = limitVal === 'all' ? 'all' : parseInt(limitVal, 10);
        this.renderTable();
    },

    resetFilters() {
        this.currentFilterTab = 'ALL';
        const tabAll = document.getElementById('tabAll');
        if (tabAll) tabAll.checked = true;

        const targetSelect = document.getElementById('searchTargetSelect');
        if (targetSelect) targetSelect.value = 'ALL';

        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) clearBtn.style.display = 'none';

        const limitSelect = document.getElementById('limitSelect');
        if (limitSelect) limitSelect.value = '50';
        this.currentLimit = 50;

        this.renderTable();
    },

    getFilteredData() {
        let filtered = [...this.data];

        // 1) 유형 탭 필터링
        if (this.currentFilterTab === 'OVERSEAS') {
            filtered = filtered.filter(p => 
                p.company_name_en || p.address_en || p.manager_en || p.phone_en || p.email_en || p.type === '해외/무역'
            );
        } else if (this.currentFilterTab === '기타') {
            filtered = filtered.filter(p => p.type !== '매입처' && p.type !== '매출처');
        } else if (this.currentFilterTab !== 'ALL') {
            filtered = filtered.filter(p => p.type === this.currentFilterTab);
        }

        // 2) 검색어 다중 AND 검색
        const searchInputEl = document.getElementById('searchInput');
        const searchTargetEl = document.getElementById('searchTargetSelect');
        const rawSearch = searchInputEl ? searchInputEl.value.trim() : '';
        const target = searchTargetEl ? searchTargetEl.value : 'ALL';

        if (rawSearch) {
            const terms = rawSearch.toLowerCase().split(/\s+/).filter(Boolean);

            filtered = filtered.filter(p => {
                const getFieldValue = (field) => {
                    switch (field) {
                        case 'name':
                            return `${p.name || ''} ${p.company_name || ''}`;
                        case 'company_name_en':
                            return p.company_name_en || '';
                        case 'ceo_name':
                            return `${p.ceo_name || ''} ${p.ceoName || ''}`;
                        case 'business_number':
                            return p.business_number || '';
                        case 'address':
                            return `${p.address || ''} ${p.address_en || ''}`;
                        case 'manager':
                            return `${p.manager1_name || ''} ${p.manager2_name || ''} ${p.manager_en || ''}`;
                        case 'phone':
                            return `${p.phone || ''} ${p.fax || ''} ${p.manager1_phone || ''} ${p.manager1_email || ''} ${p.phone_en || ''} ${p.email_en || ''}`;
                        case 'note':
                            return p.note || '';
                        case 'ALL':
                        default:
                            return [
                                p.name, p.company_name, p.company_name_en, p.ceo_name, p.ceoName,
                                p.business_number, p.address, p.address_en, p.bank_name, p.account_number,
                                p.phone, p.fax, p.phone_en, p.email_en, p.manager1_name, p.manager1_phone,
                                p.manager1_email, p.manager2_name, p.manager2_phone, p.manager2_email,
                                p.manager_en, p.note
                            ].filter(Boolean).join(' ');
                    }
                };

                const targetText = getFieldValue(target).toLowerCase();
                return terms.every(term => targetText.includes(term));
            });
        }

        return filtered;
    },

    renderTable() {
        const tbody = document.getElementById('partnersTableBody');
        if (!tbody) return;

        const filtered = this.getFilteredData();

        // 상단 건수 뱃지 갱신
        const countBadge = document.getElementById('totalCountBadge');
        if (countBadge) {
            const isFiltered = filtered.length !== this.data.length;
            countBadge.innerHTML = isFiltered 
                ? `총 <strong>${filtered.length}</strong>개 <span class="text-secondary fw-normal">(${this.data.length}개 중)</span>`
                : `총 <strong>${filtered.length}</strong>개 거래처`;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted"><i class='bx bx-search-alt-2 fs-2 d-block mb-2 text-secondary'></i>일치하는 거래처 데이터가 없습니다.</td></tr>`;
            return;
        }

        // 개수 제한 적용
        const displayList = (this.currentLimit === 'all') 
            ? filtered 
            : filtered.slice(0, this.currentLimit);

        tbody.innerHTML = displayList.map((p, index) => {
            // 뱃지 클래스
            let badgeClass = 'badge-type-etc';
            let badgeText = p.type || '기타';

            if (p.type === '매입처') {
                badgeClass = 'badge-type-purchase';
                badgeText = '매입처';
            } else if (p.type === '매출처') {
                badgeClass = 'badge-type-sales';
                badgeText = '매출처';
            } else if (p.type === 'ALL' || !p.type) {
                badgeClass = 'badge-type-common';
                badgeText = '공통';
            } else if (p.company_name_en) {
                badgeClass = 'badge-type-overseas';
                badgeText = p.type || '해외';
            }

            // 상호명 영역
            const korTitle = p.name || '-';
            const compTitle = p.company_name && p.company_name !== p.name 
                ? `<div class="text-secondary text-truncate" style="max-width:210px; font-size:10.5px;">${p.company_name}</div>` 
                : '';
            const engTitle = p.company_name_en 
                ? `<div class="text-primary text-truncate" style="max-width:210px; font-size:10.5px;"><i class='bx bx-globe'></i> ${p.company_name_en}</div>` 
                : '';

            // 사업자 / 대표자
            const bNum = p.business_number ? `<div class="font-monospace text-secondary" style="font-size:10.5px;">${p.business_number}</div>` : '';
            const ceo = p.ceo_name || p.ceoName ? `<div>${p.ceo_name || p.ceoName}</div>` : '';
            const bizCeoHtml = (ceo || bNum) ? `${ceo}${bNum}` : '<span class="text-muted small">-</span>';

            // 사업장 주소 (국문 / 영문)
            const korAddr = p.address ? `<div class="text-truncate text-dark" style="max-width:210px;" title="${p.address}"><i class='bx bx-map-pin text-muted'></i> ${p.address}</div>` : '';
            const engAddr = p.address_en ? `<div class="text-truncate text-muted" style="max-width:210px; font-size:10px;" title="${p.address_en}"><i class='bx bx-globe text-primary'></i> ${p.address_en}</div>` : '';
            const addressHtml = (korAddr || engAddr) ? `${korAddr}${engAddr}` : '<span class="text-muted small">-</span>';

            // 국내 대표 연락처 (전화 / 팩스)
            const mainPhone = p.phone ? `<div><i class='bx bx-phone text-muted'></i> ${p.phone}</div>` : '';
            const mainFax = p.fax ? `<div class="text-muted small" style="font-size:10.5px;">FAX: ${p.fax}</div>` : '';
            const contactHtml = (mainPhone || mainFax) ? `${mainPhone}${mainFax}` : '<span class="text-muted small">-</span>';

            // 결제 계좌정보
            const bankName = p.bank_name ? `<div class="fw-semibold text-dark">${p.bank_name}</div>` : '';
            const accNum = p.account_number ? `<div class="font-monospace text-success small" style="font-size:10.5px;">${p.account_number}</div>` : '';
            const accHolder = p.account_holder ? `<div class="text-muted small" style="font-size:10px;">(${p.account_holder})</div>` : '';
            const bankHtml = (bankName || accNum) ? `${bankName}${accNum}${accHolder}` : '<span class="text-muted small">-</span>';

            // 담당자 (국문 / 영문 ATTN)
            const mgr1 = p.manager1_name 
                ? `<div><strong>${p.manager1_name}</strong> ${p.manager1_phone ? `<span class="text-secondary small">(${p.manager1_phone})</span>` : ''}</div>` 
                : '';
            const mgr1Mail = p.manager1_email ? `<div class="text-muted small text-truncate" style="max-width:145px; font-size:10px;">${p.manager1_email}</div>` : '';
            const mgrEn = p.manager_en ? `<div class="text-primary small" style="font-size:10.5px;"><i class='bx bx-user-pin'></i> ATTN: ${p.manager_en}</div>` : '';
            const managerHtml = (mgr1 || mgr1Mail || mgrEn) ? `${mgr1}${mgr1Mail}${mgrEn}` : '<span class="text-muted small">-</span>';

            // 영문 무역 정보 (Tel / Email)
            const enTel = p.phone_en ? `<div><i class='bx bx-phone-call text-primary'></i> ${p.phone_en}</div>` : '';
            const enEmail = p.email_en ? `<div class="text-muted text-truncate" style="max-width:155px; font-size:10px;"><i class='bx bx-envelope'></i> ${p.email_en}</div>` : '';
            const tradeHtml = (enTel || enEmail) ? `${enTel}${enEmail}` : '<span class="text-muted small">-</span>';

            // 비고
            const noteHtml = p.note ? `<div class="text-muted small text-truncate" style="max-width:120px;" title="${p.note}">${p.note}</div>` : '<span class="text-muted small">-</span>';

            return `
                <tr onclick="app.openEditModal('${p.id}')" title="클릭 시 '${p.name}' 거래처 상세/수정">
                    <td class="text-center font-monospace text-muted" style="font-size: 10.5px;">${index + 1}</td>
                    <td class="text-center">
                        <span class="badge-type ${badgeClass}">${badgeText}</span>
                    </td>
                    <td>
                        <div class="fw-bold text-dark text-truncate" style="max-width: 210px;">${korTitle}</div>
                        ${compTitle}
                        ${engTitle}
                    </td>
                    <td>
                        ${bizCeoHtml}
                    </td>
                    <td>
                        ${addressHtml}
                    </td>
                    <td>
                        ${contactHtml}
                    </td>
                    <td>
                        ${bankHtml}
                    </td>
                    <td>
                        ${managerHtml}
                    </td>
                    <td>
                        ${tradeHtml}
                    </td>
                    <td>
                        ${noteHtml}
                    </td>
                    <td class="text-center" style="white-space: nowrap;">
                        <div class="action-btn-group">
                            <button type="button" class="btn btn-outline-primary btn-sm fw-semibold" 
                                onclick="event.stopPropagation(); app.openEditModal('${p.id}')">
                                수정
                            </button>
                            <button type="button" class="btn btn-outline-danger btn-sm fw-semibold" 
                                onclick="event.stopPropagation(); app.deletePartner('${p.id}')">
                                삭제
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // ── 실시간 중복/유사 거래처 감지 기능 ──
    onCheckDuplicate() {
        const alertEl = document.getElementById('duplicatePartnerAlert');
        if (!alertEl) return;

        const nameInput = document.getElementById('partnerName');
        const compInput = document.getElementById('companyName');
        const currentId = document.getElementById('partnerId').value;

        const typedName = (nameInput ? nameInput.value : '').trim().toLowerCase();
        const typedComp = (compInput ? compInput.value : '').trim().toLowerCase();

        // 1글자 이상 입력되었을 때 기존 등록 목록과 비교
        if (!typedName && !typedComp) {
            alertEl.style.display = 'none';
            alertEl.innerHTML = '';
            return;
        }

        const matches = this.data.filter(p => {
            // 현재 수정 중인 본인 거래처는 제외
            if (currentId && String(p.id) === String(currentId)) return false;

            const pName = (p.name || '').toLowerCase();
            const pComp = (p.company_name || '').toLowerCase();

            const matchName = typedName && (pName.includes(typedName) || pComp.includes(typedName));
            const matchComp = typedComp && (pName.includes(typedComp) || pComp.includes(typedComp));

            return matchName || matchComp;
        });

        if (matches.length === 0) {
            alertEl.style.display = 'none';
            alertEl.innerHTML = '';
            return;
        }

        // 완전 일치 여부 체크
        const isExactMatch = matches.some(p => {
            const pName = (p.name || '').toLowerCase();
            const pComp = (p.company_name || '').toLowerCase();
            return (typedName && (pName === typedName || pComp === typedName)) ||
                   (typedComp && (pName === typedComp || pComp === typedComp));
        });

        alertEl.style.display = 'block';
        alertEl.innerHTML = `
            <div class="duplicate-alert-box">
                <div class="d-flex align-items-center justify-content-between mb-1">
                    <span class="fw-bold ${isExactMatch ? 'text-danger' : 'text-warning-emphasis'}">
                        <i class='bx ${isExactMatch ? 'bx-error-circle' : 'bx-info-circle'}'></i>
                        ${isExactMatch ? '주의: 동일한 거래처명 또는 사업자명이 이미 등록되어 있습니다!' : `유사한 등록 거래처 감지 (${matches.length}건)`}
                    </span>
                    <span class="text-muted" style="font-size: 10px;">칩 클릭 시 기존 거래처 정보 열람</span>
                </div>
                <div class="d-flex flex-wrap gap-1 mt-1">
                    ${matches.slice(0, 6).map(m => `
                        <span class="duplicate-chip" onclick="app.openEditModal('${m.id}')" title="클릭 시 '${m.name}' 정보 확인">
                            <strong>${m.name}</strong> 
                            ${m.company_name && m.company_name !== m.name ? `<span class="text-secondary">(${m.company_name})</span>` : ''}
                            ${m.business_number ? `<span class="badge bg-light text-secondary border font-monospace" style="font-size:10px;">${m.business_number}</span>` : ''}
                            <i class='bx bx-link-external text-primary'></i>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    },

    openAddModal() {
        const form = document.getElementById('partnerForm');
        if (form) form.reset();
        
        document.getElementById('partnerId').value = '';
        document.getElementById('companyNameEn').value = '';
        document.getElementById('addressEn').value = '';
        document.getElementById('managerEn').value = '';
        document.getElementById('phoneEn').value = '';
        document.getElementById('emailEn').value = '';
        
        const alertEl = document.getElementById('duplicatePartnerAlert');
        if (alertEl) {
            alertEl.style.display = 'none';
            alertEl.innerHTML = '';
        }

        document.getElementById('modalTitle').innerHTML = "<i class='bx bx-building text-primary'></i> 새 거래처 등록";
        if (this.modal) this.modal.show();
    },

    openEditModal(id) {
        const partner = this.data.find(p => String(p.id) === String(id));
        if (!partner) return;

        document.getElementById('partnerId').value = partner.id;
        document.getElementById('partnerName').value = partner.name || '';
        document.getElementById('companyName').value = partner.company_name || '';
        document.getElementById('ceoName').value = partner.ceo_name || partner.ceoName || '';
        document.getElementById('businessNumber').value = partner.business_number || '';
        document.getElementById('address').value = partner.address || '';
        document.getElementById('partnerType').value = partner.type || 'ALL';
        
        document.getElementById('bankName').value = partner.bank_name || '';
        document.getElementById('accountNumber').value = partner.account_number || '';
        document.getElementById('accountHolder').value = partner.account_holder || '';
        
        document.getElementById('phone').value = partner.phone || '';
        document.getElementById('fax').value = partner.fax || '';
        
        document.getElementById('manager1Name').value = partner.manager1_name || '';
        document.getElementById('manager1Phone').value = partner.manager1_phone || '';
        document.getElementById('manager1Email').value = partner.manager1_email || '';
        
        document.getElementById('manager2Name').value = partner.manager2_name || '';
        document.getElementById('manager2Phone').value = partner.manager2_phone || '';
        document.getElementById('manager2Email').value = partner.manager2_email || '';
        
        document.getElementById('companyNameEn').value = partner.company_name_en || '';
        document.getElementById('addressEn').value = partner.address_en || '';
        document.getElementById('managerEn').value = partner.manager_en || '';
        document.getElementById('phoneEn').value = partner.phone_en || '';
        document.getElementById('emailEn').value = partner.email_en || '';

        document.getElementById('partnerNote').value = partner.note || '';
        
        const alertEl = document.getElementById('duplicatePartnerAlert');
        if (alertEl) {
            alertEl.style.display = 'none';
            alertEl.innerHTML = '';
        }

        document.getElementById('modalTitle').innerHTML = `<i class='bx bx-edit-alt text-primary'></i> 거래처 수정 (${partner.name})`;
        if (this.modal) this.modal.show();
    },

    async savePartner() {
        const id = document.getElementById('partnerId').value;
        const name = document.getElementById('partnerName').value.trim();
        const company_name = document.getElementById('companyName').value.trim();
        const ceo_name = document.getElementById('ceoName').value.trim();
        const business_number = document.getElementById('businessNumber').value.trim();
        const address = document.getElementById('address').value.trim();
        const type = document.getElementById('partnerType').value;
        
        const bank_name = document.getElementById('bankName').value.trim();
        const account_number = document.getElementById('accountNumber').value.trim();
        const account_holder = document.getElementById('accountHolder').value.trim();
        
        const phone = document.getElementById('phone').value.trim();
        const fax = document.getElementById('fax').value.trim();
        
        const manager1_name = document.getElementById('manager1Name').value.trim();
        const manager1_phone = document.getElementById('manager1Phone').value.trim();
        const manager1_email = document.getElementById('manager1Email').value.trim();
        
        const manager2_name = document.getElementById('manager2Name').value.trim();
        const manager2_phone = document.getElementById('manager2Phone').value.trim();
        const manager2_email = document.getElementById('manager2Email').value.trim();
        
        const company_name_en = document.getElementById('companyNameEn').value.trim();
        const address_en = document.getElementById('addressEn').value.trim();
        const manager_en = document.getElementById('managerEn').value.trim();
        const phone_en = document.getElementById('phoneEn').value.trim();
        const email_en = document.getElementById('emailEn').value.trim();

        const note = document.getElementById('partnerNote').value.trim();

        if (!name || !company_name) {
            return Swal.fire('알림', '거래처명과 사업자명을 모두 입력해주세요.', 'warning');
        }

        const payload = { 
            name, company_name, ceo_name, business_number, address, type,
            bank_name, account_number, account_holder,
            phone, fax,
            manager1_name, manager1_phone, manager1_email,
            manager2_name, manager2_phone, manager2_email,
            company_name_en, address_en, manager_en,
            phone_en, email_en,
            note 
        };

        try {
            if (id) {
                // 수정 - Optimistic In-memory update
                const pIndex = this.data.findIndex(p => String(p.id) === String(id));
                if (pIndex !== -1) {
                    this.data[pIndex] = { ...this.data[pIndex], ...payload };
                }

                const res = await window.authFetch(`${API_BASE}/partners/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '저장 중 오류가 발생했습니다.');
                }
                Swal.fire({ title: '저장 완료', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            } else {
                // 등록
                const res = await window.authFetch(`${API_BASE}/partners`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '등록 중 오류가 발생했습니다.');
                }
                const newPartner = await res.json().catch(() => null);
                if (newPartner && newPartner.id) {
                    this.data.push({ ...payload, id: newPartner.id });
                }
                Swal.fire({ title: '등록 완료', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            }
            if (this.modal) this.modal.hide();
            await this.loadData();
        } catch (error) {
            console.error(error);
            Swal.fire('오류', error.message || '저장 중 오류가 발생했습니다.', 'error');
        }
    },

    async deletePartner(id) {
        const partner = this.data.find(p => String(p.id) === String(id));
        if (!partner) return;

        const result = await Swal.fire({
            title: '삭제 확인',
            html: `정말 <strong>${partner.name}</strong> 거래처를 삭제하시겠습니까?<br><span class="text-danger small">주의: 장부나 물류 기록에 연동된 경우 문제가 발생할 수 있습니다.</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소',
            confirmButtonColor: '#dc3545'
        });

        if (result.isConfirmed) {
            try {
                const res = await window.authFetch(`${API_BASE}/partners/${id}`, {
                    method: 'DELETE'
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '삭제 중 오류가 발생했습니다.');
                }
                Swal.fire({ title: '삭제됨', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                this.loadData();
            } catch (error) {
                console.error(error);
                Swal.fire('오류', error.message || '삭제 중 오류가 발생했습니다.', 'error');
            }
        }
    },

    // 엑셀 다운로드 기능 (SheetJS)
    exportExcel() {
        const filtered = this.getFilteredData();
        if (filtered.length === 0) {
            return Swal.fire('알림', '다운로드할 거래처 데이터가 없습니다.', 'info');
        }

        const excelRows = filtered.map((p, index) => ({
            'No': index + 1,
            '유형': p.type || '공통',
            '거래처명': p.name || '',
            '사업자명(공식상호)': p.company_name || '',
            '영문상호명': p.company_name_en || '',
            '사업자등록번호': p.business_number || '',
            '대표자': p.ceo_name || p.ceoName || '',
            '국문주소': p.address || '',
            '은행명': p.bank_name || '',
            '계좌번호': p.account_number || '',
            '예금주': p.account_holder || '',
            '대표전화': p.phone || '',
            '팩스': p.fax || '',
            '담당자1_성명': p.manager1_name || '',
            '담당자1_연락처': p.manager1_phone || '',
            '담당자1_이메일': p.manager1_email || '',
            '담당자2_성명': p.manager2_name || '',
            '담당자2_연락처': p.manager2_phone || '',
            '담당자2_이메일': p.manager2_email || '',
            '영문담당자(ATTN)': p.manager_en || '',
            '영문전화번호(Tel)': p.phone_en || '',
            '영문이메일': p.email_en || '',
            '영문사업장주소': p.address_en || '',
            '비고': p.note || ''
        }));

        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const filename = `KNG_거래처목록_${today}.xlsx`;

        if (window.XLSX) {
            const worksheet = XLSX.utils.json_to_sheet(excelRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, '거래처목록');
            XLSX.writeFile(workbook, filename);
        } else {
            // Fallback CSV
            const headers = Object.keys(excelRows[0]);
            const csvContent = '\uFEFF' + [
                headers.join(','),
                ...excelRows.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
            ].join('\r\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.setAttribute('download', `KNG_거래처목록_${today}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
