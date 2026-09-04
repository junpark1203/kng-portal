const API_BASE = 'https://kng.junparks.com/api';

function numberToKorean(number) {
    if (number === 0) return '영';
    const han = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const danA = ['', '십', '백', '천'];
    const danG = ['', '만', '억', '조'];
    let result = '';
    let numStr = String(Math.abs(Math.round(number)));
    for (let i = 0; i < numStr.length; i++) {
        let str = '';
        let num = parseInt(numStr.charAt(numStr.length - 1 - i));
        if (num > 0) {
            str = han[num] + danA[i % 4];
        }
        if (i % 4 === 0) {
            let chunk = numStr.substr(Math.max(0, numStr.length - 1 - i - 3), 4);
            if (parseInt(chunk) > 0) {
                str += danG[Math.floor(i / 4)];
            }
        }
        result = str + result;
    }
    return (number < 0 ? '마이너스 ' : '') + result;
}

const $ = id => document.getElementById(id);

const app = {
    currentMonth: '',
    activeTab: 'sales', // 'sales' (매출/청구) | 'purchase' (매입/정산)
    allPartners: [],
    selectedPartner: null, // { name, company_name, business_number, ceo_name, address, ... }
    aggregateByBizNum: false,
    currentRows: [],
    modalPartnerList: [],
    partnerModalInstance: null,

    init: async function() {
        // 기본값: 전월
        this.setMonthPreset('prev');
        this.initNextMonthInput();
        await this.loadAllPartners();
        await this.loadData();
    },

    initNextMonthInput: function() {
        if (!this.currentMonth) return;
        const [y, m] = this.currentMonth.split('-').map(Number);
        let nextY = y;
        let nextM = m + 1;
        if (nextM > 12) {
            nextM = 1;
            nextY += 1;
        }
        const nextMonthStr = `${nextY}-${String(nextM).padStart(2, '0')}`;
        if ($('batchTargetMonth')) $('batchTargetMonth').value = nextMonthStr;
    },

    setMonthPreset: function(preset) {
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth() + 1; // 1-12

        if (preset === 'prev') {
            m -= 1;
            if (m === 0) {
                m = 12;
                y -= 1;
            }
        }
        this.currentMonth = `${y}-${String(m).padStart(2, '0')}`;
        if ($('targetMonth')) $('targetMonth').value = this.currentMonth;
        this.initNextMonthInput();
        this.loadData();
    },

    onMonthChange: function() {
        const val = $('targetMonth')?.value;
        if (val) {
            this.currentMonth = val;
            this.initNextMonthInput();
            this.loadData();
        }
    },

    changeMonth: function(delta) {
        if (!this.currentMonth) return;
        const [y, m] = this.currentMonth.split('-').map(Number);
        let date = new Date(y, m - 1 + delta, 1);
        let nextY = date.getFullYear();
        let nextM = String(date.getMonth() + 1).padStart(2, '0');
        this.currentMonth = `${nextY}-${nextM}`;
        if ($('targetMonth')) $('targetMonth').value = this.currentMonth;
        this.initNextMonthInput();
        this.loadData();
    },

    switchTab: function(tab) {
        this.activeTab = tab;
        const salesBtn = $('sales-tab');
        const purchaseBtn = $('purchase-tab');
        const colHeader = $('colPartnerHeader');
        const printBtnLabel = $('printBtnLabel');
        const kpiTotalLabel = $('kpiTotalLabel');

        if (tab === 'sales') {
            salesBtn?.classList.add('active');
            purchaseBtn?.classList.remove('active', 'purchase-tab');
            if (colHeader) colHeader.innerText = '매출처 (거래처명)';
            if (printBtnLabel) printBtnLabel.innerText = '청구서 인쇄';
            if (kpiTotalLabel) kpiTotalLabel.innerHTML = `청구합계: <span class="text-primary" id="kpiTotalAmt">0원</span>`;
        } else {
            salesBtn?.classList.remove('active');
            purchaseBtn?.classList.add('active', 'purchase-tab');
            if (colHeader) colHeader.innerText = '매입처 (공급자명)';
            if (printBtnLabel) printBtnLabel.innerText = '매입정산내역 인쇄';
            if (kpiTotalLabel) kpiTotalLabel.innerHTML = `매입합계: <span class="text-success" id="kpiTotalAmt">0원</span>`;
        }

        this.loadData();
    },

    onFilterChange: function() {
        this.loadData();
    },

    onBizAggChange: function() {
        this.aggregateByBizNum = $('aggregateBizChk')?.checked || false;
        this.loadData();
    },

    refreshCurrentView: function() {
        this.loadData();
    },

    // ── 1. 거래처 데이터 로드 및 자동완성 / 모달 ──
    loadAllPartners: async function() {
        try {
            const res = await window.authFetch(`${API_BASE}/partners`);
            if (res.ok) {
                this.allPartners = await res.json();
                this.modalPartnerList = [...this.allPartners];
            }
        } catch (e) {
            console.error('Failed to load partners:', e);
        }
    },

    onPartnerFocus: function() {
        const val = $('partnerSearchInput')?.value || '';
        this.renderAutocomplete(val);
    },

    onPartnerInput: function(val) {
        this.renderAutocomplete(val);
        const clearBtn = $('clearPartnerBtn');
        if (clearBtn) {
            if (val) clearBtn.classList.remove('d-none');
            else if (!this.selectedPartner) clearBtn.classList.add('d-none');
        }
    },

    renderAutocomplete: function(query) {
        const listEl = $('partnerAutocompleteList');
        if (!listEl) return;
        const kw = (query || '').trim().toLowerCase();

        let filtered = this.allPartners;
        if (kw) {
            filtered = this.allPartners.filter(p => {
                const name = (p.name || '').toLowerCase();
                const comp = (p.company_name || '').toLowerCase();
                const biz = (p.business_number || '').replace(/[^0-9]/g, '');
                const ceo = (p.ceo_name || '').toLowerCase();
                return name.includes(kw) || comp.includes(kw) || biz.includes(kw.replace(/[^0-9]/g, '')) || ceo.includes(kw);
            });
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="p-2 text-muted text-center small">일치하는 거래처가 없습니다.</div>`;
            listEl.style.display = 'block';
            return;
        }

        listEl.innerHTML = filtered.slice(0, 15).map(p => {
            const displayName = p.name || p.company_name;
            const biz = p.business_number ? ` (${p.business_number})` : '';
            const ceo = p.ceo_name ? ` · ${p.ceo_name}` : '';
            return `
                <div class="partner-autocomplete-item" onclick="app.selectPartnerByName('${displayName.replace(/'/g, "\\'")}')">
                    <strong>${displayName}</strong>${biz}<span class="text-muted small">${ceo}</span>
                </div>
            `;
        }).join('');
        listEl.style.display = 'block';
    },

    selectPartnerByName: function(name) {
        const partner = this.allPartners.find(p => p.name === name || p.company_name === name);
        if (partner) {
            this.selectPartner(partner);
        } else {
            this.selectPartner({ name: name, company_name: name });
        }
    },

    selectPartner: function(partner) {
        this.selectedPartner = partner;
        const listEl = $('partnerAutocompleteList');
        if (listEl) listEl.style.display = 'none';

        const searchInput = $('partnerSearchInput');
        if (searchInput) searchInput.value = partner.name || partner.company_name || '';

        const clearBtn = $('clearPartnerBtn');
        if (clearBtn) clearBtn.classList.remove('d-none');

        // 배너 정보 채우기
        const banner = $('selectedPartnerBanner');
        if (banner) {
            banner.classList.remove('d-none');
            $('bannerPartnerName').innerText = partner.company_name || partner.name || '-';
            $('bannerBizNo').innerText = partner.business_number || '-';
            $('bannerCeo').innerText = partner.ceo_name || '-';
            $('bannerAddress').innerText = partner.address || '-';
        }

        // 모달이 열려있다면 닫기
        if (this.partnerModalInstance) {
            this.partnerModalInstance.hide();
        }

        this.loadData();
    },

    clearSelectedPartner: function() {
        this.selectedPartner = null;
        const searchInput = $('partnerSearchInput');
        if (searchInput) searchInput.value = '';

        const clearBtn = $('clearPartnerBtn');
        if (clearBtn) clearBtn.classList.add('d-none');

        const banner = $('selectedPartnerBanner');
        if (banner) banner.classList.add('d-none');

        const listEl = $('partnerAutocompleteList');
        if (listEl) listEl.style.display = 'none';

        this.loadData();
    },

    openPartnerSelectModal: function() {
        const modalEl = $('partnerSelectModal');
        if (!modalEl) return;
        this.partnerModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        $('modalPartnerSearchInput').value = '';
        this.modalPartnerList = [...this.allPartners];
        this.renderModalPartnerTable();
        this.partnerModalInstance.show();
    },

    filterModalPartners: function() {
        const kw = ($('modalPartnerSearchInput')?.value || '').trim().toLowerCase();
        if (!kw) {
            this.modalPartnerList = [...this.allPartners];
        } else {
            this.modalPartnerList = this.allPartners.filter(p => {
                const name = (p.name || '').toLowerCase();
                const comp = (p.company_name || '').toLowerCase();
                const biz = (p.business_number || '').replace(/[^0-9]/g, '');
                const ceo = (p.ceo_name || '').toLowerCase();
                return name.includes(kw) || comp.includes(kw) || biz.includes(kw.replace(/[^0-9]/g, '')) || ceo.includes(kw);
            });
        }
        this.renderModalPartnerTable();
    },

    renderModalPartnerTable: function() {
        const tbody = $('modalPartnerTableBody');
        if (!tbody) return;

        if (this.modalPartnerList.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">등록된 거래처가 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.modalPartnerList.map((p, idx) => {
            const displayName = p.name || p.company_name;
            return `
                <tr style="cursor: pointer;" onclick="app.selectPartnerByName('${(p.name || p.company_name).replace(/'/g, "\\'")}')">
                    <td class="text-center text-muted">${idx + 1}</td>
                    <td class="fw-bold text-primary">${displayName}</td>
                    <td class="text-center font-monospace text-secondary">${p.business_number || '-'}</td>
                    <td class="text-center">${p.ceo_name || '-'}</td>
                    <td class="text-center"><span class="badge bg-light text-dark border">${p.type || '일반'}</span></td>
                    <td class="text-truncate text-muted small" style="max-width: 220px;" title="${p.address || ''}">${p.address || '-'}</td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary py-0 px-2" type="button">선택</button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // ── 2. 품목 데이터 로드 (월별 / 거래처별 정산완료 내역) ──
    loadData: async function() {
        const tbody = $('mainStatusTableBody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 데이터를 불러오는 중입니다...</td></tr>`;

        try {
            const isSales = this.activeTab === 'sales';
            const reqType = isSales ? 'outbound' : 'inbound';
            const accVal = $('accountFilter')?.value || '';

            // 1. 현재 탭 품목 목록 요청
            let url = `${API_BASE}/logistics/history?settlement_month=${encodeURIComponent(this.currentMonth)}&settlement_status=${encodeURIComponent('정산완료')}&type=${reqType}&include_direct=true&limit=1000`;
            if (accVal) url += `&settlement_account=${encodeURIComponent(accVal)}`;

            // 거래처 필터 조건
            let targetPartnerNames = [];
            if (this.selectedPartner) {
                const pName = this.selectedPartner.name || this.selectedPartner.company_name;
                targetPartnerNames.push(pName);

                if (this.aggregateByBizNum && this.selectedPartner.business_number) {
                    const bNum = this.selectedPartner.business_number.replace(/[^0-9]/g, '');
                    this.allPartners.forEach(p => {
                        if (p.business_number && p.business_number.replace(/[^0-9]/g, '') === bNum) {
                            if (p.name && !targetPartnerNames.includes(p.name)) targetPartnerNames.push(p.name);
                            if (p.company_name && !targetPartnerNames.includes(p.company_name)) targetPartnerNames.push(p.company_name);
                        }
                    });
                }
                url += `&searchParty=${encodeURIComponent(pName)}`;
            }

            const res = await window.authFetch(url);
            if (!res.ok) throw new Error('정산 내역을 불러오지 못했습니다.');
            const data = await res.json();
            let items = data.items || [];

            // 거래처 다중(동일 사업자번호) 필터링 보정
            if (this.selectedPartner && targetPartnerNames.length > 1) {
                items = items.filter(r => {
                    const party = isSales ? (r.destination || r.actual_destination) : r.supplier;
                    return targetPartnerNames.some(tn => (party || '').includes(tn));
                });
            }

            this.currentRows = items;
            this.renderTable();
            this.updateKpiSummary();

            // 2. 탭 배지(건수) 갱신 (전체/거래처별 요약 통계)
            this.fetchTabCounts();

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="17" class="text-center text-danger py-5">오류가 발생했습니다: ${err.message}</td></tr>`;
        }
    },

    fetchTabCounts: async function() {
        try {
            const accVal = $('accountFilter')?.value || '';
            let url = `${API_BASE}/ledger/monthly-summary?month=${encodeURIComponent(this.currentMonth)}`;
            if (accVal) url += `&settlement_account=${encodeURIComponent(accVal)}`;
            const res = await window.authFetch(url);
            if (res.ok) {
                const sumData = await res.json();
                const partners = sumData.partners || [];
                let sCount = 0;
                let pCount = 0;

                if (!this.selectedPartner) {
                    sCount = sumData.totals?.outbound?.count || 0;
                    pCount = sumData.totals?.inbound?.count || 0;
                } else {
                    const pName = this.selectedPartner.name || this.selectedPartner.company_name;
                    const matched = partners.filter(p => (p.partner || '').includes(pName));
                    matched.forEach(p => {
                        sCount += (p.outbound?.count || 0);
                        pCount += (p.inbound?.count || 0);
                    });
                }

                if ($('tabSalesBadge')) $('tabSalesBadge').innerText = `${sCount.toLocaleString()}건`;
                if ($('tabPurchaseBadge')) $('tabPurchaseBadge').innerText = `${pCount.toLocaleString()}건`;
            }
        } catch (e) {
            // 조용히 무시
        }
    },

    renderTable: function() {
        const tbody = $('mainStatusTableBody');
        const tfoot = $('mainStatusTableFoot');
        if (!tbody) return;

        // 헤더 체크박스 해제
        if ($('checkAllTable')) $('checkAllTable').checked = false;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = false;
        this.updateSelectedCountBadge();

        if (this.currentRows.length === 0) {
            const targetName = this.selectedPartner ? `[${this.selectedPartner.name || this.selectedPartner.company_name}] 거래처의 ` : '';
            tbody.innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted">${targetName}${this.currentMonth}에 확정된 정산 내역이 없습니다.</td></tr>`;
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        const isSales = this.activeTab === 'sales';
        let totalQty = 0;
        let totalSupply = 0;
        let totalVat = 0;
        let totalGrand = 0;

        tbody.innerHTML = this.currentRows.map((r, idx) => {
            const qty = Number(r.settlement_qty || r.qty || 0);
            const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
            const ship = Number(r.shipping_fee || 0);
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) {
                shipSupply = Math.round(ship / 1.1);
            }
            const supply = (qty * price) + shipSupply;

            let vat = 0;
            if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                vat = r.settlement_vat;
            } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) {
                    shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                }
                vat = itemVat + shipVat;
            }
            const grandTotal = supply + vat;

            totalQty += qty;
            totalSupply += supply;
            totalVat += vat;
            totalGrand += grandTotal;

            // 확정 상태 판별
            const occurMonth = r.date ? r.date.substring(0, 7) : '';
            const settleMonth = r.settlement_month || occurMonth;
            const isCarried = occurMonth && settleMonth && (occurMonth !== settleMonth);

            const statusBadge = isCarried
                ? `<span class="badge badge-carryover" title="원 발생월: ${occurMonth}에서 ${settleMonth}로 이월"><i class='bx bx-redo'></i> ${occurMonth.split('-')[1]}월 이월</span>`
                : `<span class="badge bg-light text-secondary border">당월확정</span>`;

            const partyName = isSales ? (r.destination || r.actual_destination || '-') : (r.supplier || '-');

            return `
                <tr>
                    <td class="text-center">
                        <input class="form-check-input item-chk" type="checkbox" value="${r.id}" data-date="${r.date}" data-month="${settleMonth}" onchange="app.onItemCheckChange()">
                    </td>
                    <td class="text-center text-muted small">${idx + 1}</td>
                    <td class="text-center small">${r.date ? r.date.split('T')[0] : '-'}</td>
                    <td class="text-center font-monospace small ${isSales ? 'text-primary' : 'text-success'} fw-semibold">${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'}</td>
                    <td class="text-start fw-bold text-dark text-truncate" style="max-width: 140px;" title="${partyName}">${partyName}</td>
                    <td class="text-center small"><span class="badge bg-light text-dark border">${r.settlement_account || '-'}</span></td>
                    <td class="text-start">
                        <strong>${r.item}</strong>
                        ${r.is_direct ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.68rem;">직출</span>` : ''}
                    </td>
                    <td class="text-center text-muted small">${r.spec || '-'}</td>
                    <td class="text-center text-muted small">${r.unit || '-'}</td>
                    <td class="text-end small">${qty.toLocaleString()}</td>
                    <td class="text-end small">${price.toLocaleString()}원</td>
                    <td class="text-end small">${supply.toLocaleString()}원</td>
                    <td class="text-end text-muted small">${vat.toLocaleString()}원</td>
                    <td class="text-end fw-bold text-dark small">${grandTotal.toLocaleString()}원</td>
                    <td class="text-center">${statusBadge}</td>
                    <td class="text-start small text-muted text-truncate" style="max-width: 110px;" title="${r.settlement_memo || ''}">${r.settlement_memo || '-'}</td>
                    <td class="text-center">
                        <button class="btn btn-outline-warning btn-sm py-0 px-1 fw-bold" style="font-size: 0.72rem;" onclick="app.carryOverSingle(${r.id})" title="익월로 1개월 이월">+1월</button>
                    </td>
                </tr>
            `;
        }).join('');

        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center">합 계 (총 ${this.currentRows.length.toLocaleString()}건)</td>
                    <td class="text-end">${totalQty.toLocaleString()}</td>
                    <td></td>
                    <td class="text-end">${totalSupply.toLocaleString()}원</td>
                    <td class="text-end">${totalVat.toLocaleString()}원</td>
                    <td class="text-end text-primary fs-6">${totalGrand.toLocaleString()}원</td>
                    <td colspan="3"></td>
                </tr>
            `;
        }
    },

    updateKpiSummary: function() {
        const isSales = this.activeTab === 'sales';
        let totalSupply = 0;
        let totalVat = 0;
        let totalGrand = 0;

        this.currentRows.forEach(r => {
            const qty = Number(r.settlement_qty || r.qty || 0);
            const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
            const ship = Number(r.shipping_fee || 0);
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) shipSupply = Math.round(ship / 1.1);
            const supply = (qty * price) + shipSupply;

            let vat = 0;
            if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                vat = r.settlement_vat;
            } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                vat = itemVat + shipVat;
            }

            totalSupply += supply;
            totalVat += vat;
            totalGrand += (supply + vat);
        });

        if ($('kpiSupplyAmt')) $('kpiSupplyAmt').innerText = `${totalSupply.toLocaleString()}원`;
        if ($('kpiVatAmt')) $('kpiVatAmt').innerText = `${totalVat.toLocaleString()}원`;
        if ($('kpiTotalAmt')) $('kpiTotalAmt').innerText = `${totalGrand.toLocaleString()}원`;
    },

    // ── 3. 체크박스 및 선택 관리 ──
    onCheckAllChange: function(checked) {
        document.querySelectorAll('.item-chk').forEach(chk => chk.checked = checked);
        if ($('checkAllTable')) $('checkAllTable').checked = checked;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = checked;
        this.updateSelectedCountBadge();
    },

    onItemCheckChange: function() {
        const total = document.querySelectorAll('.item-chk').length;
        const checked = document.querySelectorAll('.item-chk:checked').length;
        const isAll = total > 0 && total === checked;
        if ($('checkAllTable')) $('checkAllTable').checked = isAll;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = isAll;
        this.updateSelectedCountBadge();
    },

    updateSelectedCountBadge: function() {
        const count = document.querySelectorAll('.item-chk:checked').length;
        if ($('selectedCountBadge')) $('selectedCountBadge').innerText = `선택 ${count}건`;
    },

    // ── 4. 확정 및 이월 (Carryover) 실행 ──
    carryOverSelectedNextMonth: async function() {
        const checked = Array.from(document.querySelectorAll('.item-chk:checked')).map(el => parseInt(el.value));
        if (checked.length === 0) return alert('이월할 항목을 선택해주세요.');

        const [y, m] = this.currentMonth.split('-').map(Number);
        let nextY = y;
        let nextM = m + 1;
        if (nextM > 12) {
            nextM = 1;
            nextY += 1;
        }
        const nextMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;

        if (!confirm(`선택한 ${checked.length}건을 [${nextMonth}]로 이월하시겠습니까?\n이월된 건은 당월(${this.currentMonth})에서 제외되고 익월에 반영됩니다.`)) {
            return;
        }

        await this.executeUpdateMonth(checked, nextMonth);
    },

    changeSelectedMonth: async function() {
        const checked = Array.from(document.querySelectorAll('.item-chk:checked')).map(el => parseInt(el.value));
        if (checked.length === 0) return alert('확정월을 변경할 항목을 선택해주세요.');

        const targetMonth = $('batchTargetMonth')?.value;
        if (!targetMonth) return alert('변경할 확정월(YYYY-MM)을 선택해주세요.');

        if (!confirm(`선택한 ${checked.length}건의 확정월을 [${targetMonth}]로 변경하시겠습니까?`)) {
            return;
        }

        await this.executeUpdateMonth(checked, targetMonth);
    },

    carryOverSingle: async function(rowId) {
        const [y, m] = this.currentMonth.split('-').map(Number);
        let nextY = y;
        let nextM = m + 1;
        if (nextM > 12) {
            nextM = 1;
            nextY += 1;
        }
        const nextMonth = `${nextY}-${String(nextM).padStart(2, '0')}`;

        if (!confirm(`해당 1건을 다음 달 [${nextMonth}]로 이월하시겠습니까?`)) {
            return;
        }

        await this.executeUpdateMonth([rowId], nextMonth);
    },

    revertCarryOverSelected: async function() {
        const checkedBoxes = Array.from(document.querySelectorAll('.item-chk:checked'));
        if (checkedBoxes.length === 0) return alert('이월을 취소할 항목을 선택해주세요.');

        if (!confirm(`선택한 ${checkedBoxes.length}건을 원래 발생일자의 월로 되돌리시겠습니까?`)) {
            return;
        }

        const type = this.activeTab === 'sales' ? 'outbound' : 'inbound';
        let successCount = 0;

        for (const el of checkedBoxes) {
            const id = parseInt(el.value);
            const origDate = el.dataset.date || '';
            const origMonth = origDate ? origDate.substring(0, 7) : this.currentMonth;

            try {
                const res = await window.authFetch(`${API_BASE}/settlement/${type}`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'update_month',
                        ids: [id],
                        settlement_month: origMonth
                    })
                });
                if (res.ok) successCount++;
            } catch (e) {
                console.error(e);
            }
        }

        alert(`${successCount}건이 원래 발생월로 복구되었습니다.`);
        this.loadData();
    },

    executeUpdateMonth: async function(ids, newMonth) {
        const type = this.activeTab === 'sales' ? 'outbound' : 'inbound';
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/${type}`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'update_month',
                    ids: ids,
                    settlement_month: newMonth
                })
            });

            if (res.ok) {
                alert(`${ids.length}건의 확정월이 [${newMonth}]로 변경되었습니다.`);
                this.loadData();
            } else {
                const err = await res.json().catch(() => ({}));
                alert(err.error || '확정월 변경에 실패했습니다.');
            }
        } catch (e) {
            console.error(e);
            alert('오류가 발생했습니다.');
        }
    },

    // ── 5. 청구서 및 매입정산내역 인쇄 (A4 포맷) ──
    printInvoice: function() {
        if (this.currentRows.length === 0) {
            alert('인쇄할 품목 내역이 없습니다.');
            return;
        }

        const isSales = this.activeTab === 'sales';
        const [year, monthStr] = this.currentMonth.split('-');
        const monthNum = parseInt(monthStr, 10);

        // 거래처 지정 확인
        let partnerName = '';
        let partnerObj = null;

        if (this.selectedPartner) {
            partnerName = this.selectedPartner.company_name || this.selectedPartner.name;
            partnerObj = this.selectedPartner;
        } else {
            // 거래처가 선택되어 있지 않은 경우 첫 번째 행의 거래처명 또는 '전체'
            partnerName = isSales 
                ? (this.currentRows[0].destination || this.currentRows[0].actual_destination || '전체 거래처')
                : (this.currentRows[0].supplier || '전체 매입처');
            partnerObj = this.allPartners.find(p => p.name === partnerName || p.company_name === partnerName) || { name: partnerName };
        }

        // 1. 타이틀 설정
        const titleText = isSales 
            ? `${year}년 ${monthNum}월 청구서`
            : `${year}년 ${monthNum}월 매입정산내역`;
        
        $('printTitle').innerText = this.aggregateByBizNum ? `(사업자 통합) ${titleText}` : titleText;
        $('printBillingMonth').innerText = isSales 
            ? `청구월: ${year}년 ${monthStr}월`
            : `정산월: ${year}년 ${monthStr}월`;

        // 2. 회사 및 거래처 정보 세팅
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        const ourCompany = preset.bizName || '주식회사 케앤지';
        const ourCeo = preset.ceo || '윤종';
        const ourBizNo = preset.bizNo || '845-88-00551';
        const ourAddress = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        const ourBizType = preset.bizType || '도소매/임대업';
        const ourBizItem = preset.bizItem || '건설자재, 용품외';
        const stampImg = document.querySelector('.stamp');

        if (isSales) {
            // 매출 청구서: 공급자: 케앤지 + 직인 / 공급받는자: 거래처
            $('printPartnerName').innerText = partnerName;
            $('printBizNo').innerText = ourBizNo;
            $('printBizName').innerText = ourCompany;
            $('printCeo').innerText = ourCeo;
            $('printAddress').innerText = ourAddress;
            $('printBizType').innerText = ourBizType;
            $('printBizItem').innerText = ourBizItem;
            if (stampImg) stampImg.style.display = 'block';
        } else {
            // 매입 정산서: 공급자: 거래처 / 공급받는자: 케앤지
            $('printPartnerName').innerText = ourCompany;
            $('printBizNo').innerText = partnerObj.business_number || '';
            $('printBizName').innerText = partnerObj.company_name || partnerObj.name || partnerName;
            $('printCeo').innerText = partnerObj.ceo_name || '';
            $('printAddress').innerText = partnerObj.address || '';
            $('printBizType').innerText = '';
            $('printBizItem').innerText = '';
            if (stampImg) stampImg.style.display = 'none';
        }

        // 3. 품목 행 렌더링
        let sumGrand = 0;
        let sumSupply = 0;
        let sumVat = 0;
        let sumQty = 0;

        const tbody = $('printTableBody');
        tbody.innerHTML = this.currentRows.map(r => {
            const qty = Number(r.settlement_qty || r.qty || 0);
            const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
            const ship = Number(r.shipping_fee || 0);
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) shipSupply = Math.round(ship / 1.1);
            const supply = (qty * price) + shipSupply;

            let vat = 0;
            if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                vat = r.settlement_vat;
            } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                vat = itemVat + shipVat;
            }
            const grand = supply + vat;

            sumQty += qty;
            sumSupply += supply;
            sumVat += vat;
            sumGrand += grand;

            const dateStr = r.tax_invoice_date ? r.tax_invoice_date.split('T')[0].substring(5) : (r.date ? r.date.split('T')[0].substring(5) : '-');

            return `
                <tr>
                    <td>${dateStr}</td>
                    <td>${r.settlement_account || ''}</td>
                    <td class="text-start" style="padding-left: 4px !important;">${r.item}</td>
                    <td>${r.spec || ''}</td>
                    <td>${qty.toLocaleString()}</td>
                    <td>${r.unit || ''}</td>
                    <td style="text-align: right; padding-right: 4px !important;">${price.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px !important;">${supply.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px !important;">${vat.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px !important; font-weight: bold;">${grand.toLocaleString()}</td>
                    <td>${r.settlement_memo || ''}</td>
                </tr>
            `;
        }).join('');

        // 합계 표시
        $('printAmountKor').innerText = `합 계 금 액 : 금 ${numberToKorean(sumGrand)} 원 정`;
        $('printAmountNum').innerText = `(₩ ${sumGrand.toLocaleString()})`;

        const tfoot = $('printTableFoot');
        tfoot.innerHTML = `
            <tr style="font-weight: bold; background-color: #f9f9f9;">
                <td colspan="4">합 계</td>
                <td>${sumQty.toLocaleString()}</td>
                <td></td>
                <td></td>
                <td style="text-align: right; padding-right: 4px !important;">${sumSupply.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px !important;">${sumVat.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px !important;">${sumGrand.toLocaleString()}</td>
                <td></td>
            </tr>
        `;

        // 인쇄 실행
        window.print();
    },

    // ── 6. 엑셀 다운로드 ──
    downloadExcel: function() {
        if (this.currentRows.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const isSales = this.activeTab === 'sales';
        const partnerName = this.selectedPartner ? (this.selectedPartner.company_name || this.selectedPartner.name) : '전체';

        const excelData = this.currentRows.map((r, idx) => {
            const qty = Number(r.settlement_qty || r.qty || 0);
            const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
            const ship = Number(r.shipping_fee || 0);
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) shipSupply = Math.round(ship / 1.1);
            const supply = (qty * price) + shipSupply;

            let vat = 0;
            if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                vat = r.settlement_vat;
            } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                vat = itemVat + shipVat;
            }
            const grand = supply + vat;

            return {
                'No': idx + 1,
                '발생일자': r.date ? r.date.split('T')[0] : '',
                '정산일자': r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '',
                '거래처': isSales ? (r.destination || r.actual_destination || '') : (r.supplier || ''),
                '자재계정': r.settlement_account || '',
                '품목명': r.item || '',
                '규격': r.spec || '',
                '단위': r.unit || '',
                '수량': qty,
                '단가': price,
                '공급가액': supply,
                '세액': vat,
                '합계금액': grand,
                '확정월': r.settlement_month || (r.date ? r.date.substring(0, 7) : ''),
                '비고': r.settlement_memo || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, isSales ? '매출확정내역' : '매입확정내역');

        const fileName = `${this.currentMonth}_${partnerName}_${isSales ? '매출청구확정' : '매입확정'}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }
};

// 외부 클릭 시 자동완성 닫기
document.addEventListener('click', (e) => {
    const listEl = $('partnerAutocompleteList');
    const searchInput = $('partnerSearchInput');
    if (listEl && searchInput && !listEl.contains(e.target) && e.target !== searchInput) {
        listEl.style.display = 'none';
    }
});

// 초기 구동
window.addEventListener('DOMContentLoaded', () => {
    app.init();
});
