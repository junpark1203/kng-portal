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
    typeFilter: 'all', // 'all', 'sales', 'purchase'
    rawPartners: [],
    allPartnersList: [],
    selectedPartner: null,
    selectedType: 'all',
    detailRows: [],
    aggregateByBizNum: false,

    init: async function() {
        // 기본값: 전월 설정
        this.setMonthPreset('prev');
        await this.loadAllPartners();
        await this.loadMonthlySummary();
    },

    loadAllPartners: async function() {
        try {
            const res = await window.authFetch(`${API_BASE}/partners`);
            if (res.ok) {
                this.allPartnersList = await res.json();
            }
        } catch (e) {
            console.error('Failed to load partners:', e);
        }
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
        this.loadMonthlySummary();
    },

    onMonthChange: function() {
        const val = $('targetMonth')?.value;
        if (val) {
            this.currentMonth = val;
            this.closeDetail();
            this.loadMonthlySummary();
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
        this.closeDetail();
        this.loadMonthlySummary();
    },

    setTypeFilter: function(type) {
        this.typeFilter = type;
        const group = $('typeFilterGroup');
        if (group) {
            group.querySelectorAll('button').forEach(btn => {
                if (btn.dataset.type === type) {
                    btn.className = 'btn btn-primary active';
                } else {
                    btn.className = 'btn btn-outline-secondary';
                }
            });
        }
        this.filterTableRows();
    },

    loadMonthlySummary: async function() {
        const month = this.currentMonth || $('targetMonth')?.value;
        if (!month) return;

        const tbody = $('monthlySummaryTableBody');
        tbody.innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 월간 현황 데이터를 불러오는 중입니다...</td></tr>`;

        try {
            const accVal = $('accountFilter')?.value || '';
            let url = `${API_BASE}/ledger/monthly-summary?month=${encodeURIComponent(month)}`;
            if (accVal) url += `&settlement_account=${encodeURIComponent(accVal)}`;

            const res = await window.authFetch(url);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `서버 오류 (${res.status})`);
            }

            const data = await res.json();
            this.rawPartners = data.partners || [];

            // 상단 KPI 카드 갱신
            this.renderKpiCards(data.totals || {});

            // 거래처별 요약 테이블 렌더링
            this.filterTableRows();

        } catch (err) {
            console.error('Failed to load monthly summary:', err);
            tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger py-5">데이터를 불러오지 못했습니다: ${err.message}</td></tr>`;
        }
    },

    renderKpiCards: function(totals) {
        const sales = totals.outbound || { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0 };
        const purchase = totals.inbound || { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0 };
        const marginSupply = totals.marginSupply || 0;
        const marginTotal = totals.marginTotal || 0;

        // 1. 매출
        if ($('kpiSalesCount')) $('kpiSalesCount').innerText = `${sales.count.toLocaleString()}건`;
        if ($('kpiSalesTotal')) $('kpiSalesTotal').innerText = `${sales.totalAmt.toLocaleString()}원`;
        if ($('kpiSalesSub')) {
            $('kpiSalesSub').innerText = `공급가: ${sales.supplyAmt.toLocaleString()}원 | 부가세: ${sales.vatAmt.toLocaleString()}원 | 수량: ${sales.qty.toLocaleString()}`;
        }

        // 2. 매입
        if ($('kpiPurchaseCount')) $('kpiPurchaseCount').innerText = `${purchase.count.toLocaleString()}건`;
        if ($('kpiPurchaseTotal')) $('kpiPurchaseTotal').innerText = `${purchase.totalAmt.toLocaleString()}원`;
        if ($('kpiPurchaseSub')) {
            $('kpiPurchaseSub').innerText = `공급가: ${purchase.supplyAmt.toLocaleString()}원 | 부가세: ${purchase.vatAmt.toLocaleString()}원 | 수량: ${purchase.qty.toLocaleString()}`;
        }

        // 3. 차액(마진)
        if ($('kpiMarginTotal')) {
            const isPlus = marginTotal >= 0;
            $('kpiMarginTotal').innerText = `${isPlus ? '+' : ''}${marginTotal.toLocaleString()}원`;
            $('kpiMarginTotal').className = `h4 fw-bold mb-1 ${isPlus ? 'text-primary' : 'text-danger'}`;
        }
        if ($('kpiMarginSub')) {
            const rate = sales.supplyAmt > 0 ? ((marginSupply / sales.supplyAmt) * 100).toFixed(1) : '0.0';
            $('kpiMarginSub').innerText = `공급가 차액: ${marginSupply.toLocaleString()}원 (마진율: ${rate}%)`;
        }
    },

    filterTableRows: function() {
        const kw = ($('partnerSearchInput')?.value || '').trim().toLowerCase();
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) {
            if (kw) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }

        let filtered = this.rawPartners.filter(p => {
            // 1. 구분 필터
            if (this.typeFilter === 'sales' && p.outbound.count === 0) return false;
            if (this.typeFilter === 'purchase' && p.inbound.count === 0) return false;

            // 2. 검색어 필터 (거래처명, 사업자번호, 대표자)
            if (kw) {
                const partnerName = (p.partner || '').toLowerCase();
                const bizNo = (p.business_number || '').replace(/[^0-9]/g, '');
                const ceo = (p.ceo_name || '').toLowerCase();
                const matchName = partnerName.includes(kw);
                const matchBiz = bizNo.includes(kw.replace(/[^0-9]/g, ''));
                const matchCeo = ceo.includes(kw);
                if (!matchName && !matchBiz && !matchCeo) return false;
            }
            return true;
        });

        // 정렬: 합계 금액 큰 순서
        filtered.sort((a, b) => {
            const sumA = (a.outbound.totalAmt || 0) + (a.inbound.totalAmt || 0);
            const sumB = (b.outbound.totalAmt || 0) + (b.inbound.totalAmt || 0);
            return sumB - sumA;
        });

        this.renderPartnerTable(filtered);
    },

    clearSearch: function() {
        if ($('partnerSearchInput')) $('partnerSearchInput').value = '';
        this.filterTableRows();
    },

    renderPartnerTable: function(partners) {
        const tbody = $('monthlySummaryTableBody');
        const badge = $('tableRowCountBadge');
        if (badge) badge.innerText = `${partners.length}개 거래처`;

        if (partners.length === 0) {
            tbody.innerHTML = `<tr><td colspan="11" class="text-center py-5 text-muted">해당 정산월(${this.currentMonth})에 조건에 맞는 청구/정산 내역이 없습니다.</td></tr>`;
            return;
        }

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = partners.map((p, idx) => {
            const hasSales = p.outbound.count > 0;
            const hasPurchase = p.inbound.count > 0;

            let typeBadge = '';
            let primaryType = 'sales';
            if (hasSales && hasPurchase) {
                typeBadge = `<span class="badge bg-purple bg-opacity-10 text-purple border border-purple px-2 py-1">매출/매입</span>`;
                primaryType = p.outbound.totalAmt >= p.inbound.totalAmt ? 'sales' : 'purchase';
            } else if (hasSales) {
                typeBadge = `<span class="badge badge-sales px-2 py-1">매출(청구)</span>`;
                primaryType = 'sales';
            } else {
                typeBadge = `<span class="badge badge-purchase px-2 py-1">매입(정산)</span>`;
                primaryType = 'purchase';
            }

            // 표시용 건수, 수량, 공급가, 세액, 합계
            const targetData = (this.typeFilter === 'purchase') ? p.inbound : (this.typeFilter === 'sales' ? p.outbound : {
                count: p.outbound.count + p.inbound.count,
                qty: p.outbound.qty + p.inbound.qty,
                supplyAmt: p.outbound.supplyAmt + p.inbound.supplyAmt,
                vatAmt: p.outbound.vatAmt + p.inbound.vatAmt,
                totalAmt: p.outbound.totalAmt + p.inbound.totalAmt
            });

            // 자재계정 태그
            const acc = (this.typeFilter === 'purchase') ? p.inbound.accounts : p.outbound.accounts;
            const accTags = [];
            if (acc.safetyGeneral || acc.safetyEnv) {
                accTags.push(`<span class="badge bg-primary bg-opacity-10 text-primary border border-primary px-1" style="font-size:0.7rem;">안전 ${((acc.safetyGeneral||0)+(acc.safetyEnv||0))}</span>`);
            }
            if (acc.misc) accTags.push(`<span class="badge bg-warning bg-opacity-10 text-dark border border-warning px-1" style="font-size:0.7rem;">잡자재 ${acc.misc}</span>`);
            if (acc.etc) accTags.push(`<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary px-1" style="font-size:0.7rem;">기타 ${acc.etc}</span>`);
            if (acc.mall) accTags.push(`<span class="badge bg-info bg-opacity-10 text-info border border-info px-1" style="font-size:0.7rem;">쇼핑몰 ${acc.mall}</span>`);

            return `
                <tr class="clickable-row ${this.selectedPartner?.partner === p.partner ? 'table-active' : ''}" onclick="app.selectPartner('${escapeAttr(p.partner)}', '${primaryType}')">
                    <td class="text-center text-muted small">${idx + 1}</td>
                    <td class="text-start fw-bold text-dark">
                        ${p.partner}
                        ${p.ceo_name ? `<span class="text-muted fw-normal small ms-1">(${p.ceo_name})</span>` : ''}
                    </td>
                    <td class="text-center font-monospace text-secondary small">${p.business_number || '-'}</td>
                    <td class="text-center">${typeBadge}</td>
                    <td class="text-center">${targetData.count.toLocaleString()}건</td>
                    <td class="text-center">${targetData.qty.toLocaleString()}</td>
                    <td class="text-end">${targetData.supplyAmt.toLocaleString()}원</td>
                    <td class="text-end text-muted small">${targetData.vatAmt.toLocaleString()}원</td>
                    <td class="text-end fw-bold text-primary">${targetData.totalAmt.toLocaleString()}원</td>
                    <td class="text-center">
                        <div class="d-flex gap-1 justify-content-center flex-wrap">
                            ${accTags.length > 0 ? accTags.join('') : '<span class="text-muted small">-</span>'}
                        </div>
                    </td>
                    <td class="text-center" onclick="event.stopPropagation()">
                        <button class="btn btn-sm btn-outline-primary py-0 px-2 fw-bold" style="font-size: 0.76rem;" onclick="app.selectPartner('${escapeAttr(p.partner)}', '${primaryType}')">
                            <i class='bx bx-file'></i> 청구서 / 상세
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    selectPartner: async function(partnerName, type = 'sales') {
        const partnerObj = this.rawPartners.find(p => p.partner === partnerName);
        this.selectedPartner = partnerObj || { partner: partnerName, business_number: '', ceo_name: '' };
        this.selectedType = type;

        // 헤더 및 모달 정보 세팅
        if ($('detailPartnerTitle')) $('detailPartnerTitle').innerText = `${partnerName} 상세 내역`;
        if ($('detailMonthBadge')) $('detailMonthBadge').innerText = `${this.currentMonth} 청구/정산분`;
        if ($('detailPartnerTypeBadge')) {
            $('detailPartnerTypeBadge').innerText = type === 'purchase' ? '매입정산' : '매출청구';
            $('detailPartnerTypeBadge').className = type === 'purchase' ? 'badge bg-success text-white' : 'badge bg-white text-primary';
        }
        if ($('printBtnText')) {
            $('printBtnText').innerText = type === 'purchase' ? '매입정산내역 인쇄' : '청구서 인쇄';
        }

        const meta = this.allPartnersList.find(p => p.name === partnerName || p.company_name === partnerName);
        if ($('detailCeoName')) $('detailCeoName').innerText = meta?.ceo_name || this.selectedPartner.ceo_name || '-';
        if ($('detailBizNum')) $('detailBizNum').innerText = meta?.business_number || this.selectedPartner.business_number || '-';

        // 상세 행 로드
        await this.loadPartnerDetailRows();

        // Level 2 영역 노출 및 부드러운 스크롤
        const card = $('partnerDetailCard');
        if (card) {
            card.classList.remove('d-none');
            card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        this.filterTableRows(); // 선택 행 active 하이라이트 반영
    },

    onDetailBizAggChange: function() {
        this.aggregateByBizNum = $('detailAggregateBizChk')?.checked || false;
        this.loadPartnerDetailRows();
    },

    loadPartnerDetailRows: async function() {
        if (!this.selectedPartner) return;
        const partnerName = this.selectedPartner.partner;
        const tbody = $('detailTableBody');
        tbody.innerHTML = `<tr><td colspan="13" class="text-center py-4 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 세부 품목 내역을 조회 중입니다...</td></tr>`;

        try {
            const accVal = $('accountFilter')?.value || '';
            let url = `${API_BASE}/ledger?partner=${encodeURIComponent(partnerName)}&settlementMonth=${encodeURIComponent(this.currentMonth)}`;
            if (this.aggregateByBizNum) url += '&aggregateByBizNum=true';
            if (accVal) url += `&settlement_account=${encodeURIComponent(accVal)}`;

            const res = await window.authFetch(url);
            if (!res.ok) throw new Error('상세 내역을 불러오지 못했습니다.');
            
            const rows = await res.json();
            // 현재 타입 필터 (매입/매출) 적용
            this.detailRows = rows.filter(r => {
                if (this.selectedType === 'purchase') return r.type === '입고';
                if (this.selectedType === 'sales') return r.type === '출고';
                return true;
            });

            this.renderDetailTable();

        } catch (err) {
            console.error('Failed to load detail rows:', err);
            tbody.innerHTML = `<tr><td colspan="13" class="text-center text-danger py-4">${err.message}</td></tr>`;
        }
    },

    renderDetailTable: function() {
        const tbody = $('detailTableBody');
        if (!this.detailRows || this.detailRows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="13" class="text-center py-4 text-muted">해당 거래처의 ${this.currentMonth} 상세 내역이 없습니다.</td></tr>`;
            this.updateDetailTotals(0, 0, 0, 0);
            return;
        }

        let sumSupply = 0;
        let sumVat = 0;
        let sumTotal = 0;
        let sumQty = 0;

        tbody.innerHTML = this.detailRows.map((r, idx) => {
            const qty = Number(r.qty) || 0;
            const price = Number(r.price) || 0;
            const ship = Number(r.shipping_fee) || 0;
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) {
                shipSupply = Math.round(ship / 1.1);
            }
            const supply = (qty * price) + shipSupply;
            
            let vat = 0;
            if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) {
                    shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                }
                vat = itemVat + shipVat;
            }
            const total = supply + vat;

            sumQty += qty;
            sumSupply += supply;
            sumVat += vat;
            sumTotal += total;

            // 이월 뱃지: 원래 발생일(r.date)의 YYYY-MM과 정산월(r.settlement_month)이 다를 때
            const occurMonth = r.date ? r.date.substring(0, 7) : '';
            const isCarriedOver = r.settlement_month && occurMonth && (r.settlement_month !== occurMonth);

            const carryBadge = isCarriedOver 
                ? `<span class="badge badge-carryover ms-1" title="원 발생월: ${occurMonth}에서 ${r.settlement_month}로 이월"><i class='bx bx-redo'></i> ${occurMonth.split('-')[1]}월 건 이월</span>` 
                : '';

            const directBadge = r.is_direct 
                ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size: 0.7rem;">직출</span>` 
                : '';

            const relativeBadge = r.relative_partner 
                ? `<span class="badge bg-light text-muted border ms-1" style="font-size: 0.7rem;">${r.relative_partner}</span>` 
                : '';

            return `
                <tr>
                    <td class="text-center text-muted">${idx + 1}</td>
                    <td class="text-center">${r.date ? r.date.split('T')[0] : '-'}</td>
                    <td class="text-center text-primary font-monospace">${r.settlement_date ? r.settlement_date.split('T')[0] : '-'}</td>
                    <td class="text-center fw-bold small">${r.settlement_account || '-'}</td>
                    <td class="text-start">
                        <strong>${r.item}</strong>
                        ${carryBadge}${directBadge}${relativeBadge}
                    </td>
                    <td class="text-center text-muted small">${r.spec || '-'}</td>
                    <td class="text-center text-muted small">${r.unit || '-'}</td>
                    <td class="text-end">${qty.toLocaleString()}</td>
                    <td class="text-end">${price.toLocaleString()}원</td>
                    <td class="text-end">${supply.toLocaleString()}원</td>
                    <td class="text-end text-muted small">${vat.toLocaleString()}원</td>
                    <td class="text-end fw-bold text-dark">${total.toLocaleString()}원</td>
                    <td class="text-start small text-muted">${r.settlement_memo || r.note || ''}</td>
                </tr>
            `;
        }).join('');

        this.updateDetailTotals(this.detailRows.length, sumSupply, sumVat, sumTotal);
    },

    updateDetailTotals: function(count, supply, vat, total) {
        if ($('detailTotalCount')) $('detailTotalCount').innerText = `${count}건`;
        if ($('detailSupplyAmt')) $('detailSupplyAmt').innerText = `${supply.toLocaleString()}원`;
        if ($('detailVatAmt')) $('detailVatAmt').innerText = `${vat.toLocaleString()}원`;
        if ($('detailGrandTotal')) $('detailGrandTotal').innerText = `${total.toLocaleString()}원`;
    },

    closeDetail: function() {
        this.selectedPartner = null;
        this.detailRows = [];
        const card = $('partnerDetailCard');
        if (card) card.classList.add('d-none');
        this.filterTableRows();
    },

    // ── 인쇄 시스템: 2026년 O월 청구서 / 매입정산내역 ──
    printInvoice: async function() {
        if (!this.selectedPartner || this.detailRows.length === 0) {
            alert('인쇄할 품목 내역이 없습니다.');
            return;
        }

        const partnerName = this.selectedPartner.partner;
        const [year, monthStr] = this.currentMonth.split('-');
        const monthNum = parseInt(monthStr, 10);
        const isPurchase = this.selectedType === 'purchase';

        // 1. 타이틀 설정 (사용자 지정: 매출은 'O월 청구서', 매입은 'O월 매입정산내역')
        const titleText = isPurchase 
            ? `${year}년 ${monthNum}월 매입정산내역`
            : `${year}년 ${monthNum}월 청구서`;
        
        $('printTitle').innerText = this.aggregateByBizNum ? `(사업자 통합) ${titleText}` : titleText;
        $('printBillingMonth').innerText = isPurchase 
            ? `정산월: ${year}년 ${monthStr}월`
            : `청구월: ${year}년 ${monthStr}월`;

        // 2. 회사 및 거래처 정보 세팅
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        const ourCompany = preset.bizName || '주식회사 케앤지';
        const ourCeo = preset.ceo || '윤종';
        const ourBizNo = preset.bizNo || '845-88-00551';
        const ourAddress = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        const ourBizType = preset.bizType || '도소매/임대업';
        const ourBizItem = preset.bizItem || '건설자재, 용품외';
        const stampImg = document.querySelector('.stamp');

        const partnerObj = this.allPartnersList.find(p => p.name === partnerName || p.company_name === partnerName) || this.selectedPartner;

        if (isPurchase) {
            // 매입정산서: 우리가 매입자 -> 공급받는자: 주식회사 케앤지, 공급자: 매입처
            $('printPartnerName').innerText = ourCompany;
            $('printBizNo').innerText = partnerObj.business_number || '';
            $('printBizName').innerText = partnerObj.company_name || partnerObj.name || partnerName;
            $('printCeo').innerText = partnerObj.ceo_name || '';
            $('printAddress').innerText = partnerObj.address || '';
            $('printBizType').innerText = '';
            $('printBizItem').innerText = '';
            if (stampImg) stampImg.style.display = 'none';
        } else {
            // 매출청구서: 우리가 공급자 -> 공급받는자: 거래처 귀중, 공급자: 주식회사 케앤지
            $('printPartnerName').innerText = partnerName;
            $('printBizNo').innerText = ourBizNo;
            $('printBizName').innerText = ourCompany;
            $('printCeo').innerText = ourCeo;
            $('printAddress').innerText = ourAddress;
            $('printBizType').innerText = ourBizType;
            $('printBizItem').innerText = ourBizItem;
            if (stampImg) stampImg.style.display = 'block';
        }

        // 3. 품목 행 및 금액 계산
        let sumGrand = 0;
        let sumSupply = 0;
        let sumVat = 0;
        let sumQty = 0;
        const accountStats = {
            '안전자재-일반': { count: 0, supply: 0 },
            '안전자재-환경': { count: 0, supply: 0 },
            '잡자재': { count: 0, supply: 0 },
            '기타자재': { count: 0, supply: 0 },
            '쇼핑몰': { count: 0, supply: 0 },
            '미분류': { count: 0, supply: 0 }
        };

        const printTbody = $('printTableBody');
        printTbody.innerHTML = this.detailRows.map(r => {
            const qty = Number(r.qty) || 0;
            const price = Number(r.price) || 0;
            const ship = Number(r.shipping_fee) || 0;
            const shipVatInc = r.shipping_fee_vat_included === 1;

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) shipSupply = Math.round(ship / 1.1);
            const supply = (qty * price) + shipSupply;

            let vat = 0;
            if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (ship > 0) shipVat = shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1);
                vat = itemVat + shipVat;
            }
            const total = supply + vat;

            sumQty += qty;
            sumSupply += supply;
            sumVat += vat;
            sumGrand += total;

            // 계정별 통계
            const accKey = r.settlement_account || '미분류';
            if (accountStats[accKey]) {
                accountStats[accKey].count++;
                accountStats[accKey].supply += supply;
            } else {
                accountStats['미분류'].count++;
                accountStats['미분류'].supply += supply;
            }

            // 날짜 포맷 (MM-DD)
            let dateStr = r.settlement_date ? r.settlement_date.split('T')[0] : (r.date ? r.date.split('T')[0] : '');
            if (dateStr.length === 10) dateStr = dateStr.substring(5);

            // 이월 뱃지 (인쇄용)
            const occurMonth = r.date ? r.date.substring(0, 7) : '';
            const isCarriedOver = r.settlement_month && occurMonth && (r.settlement_month !== occurMonth);
            const carryText = isCarriedOver ? ` [${occurMonth.split('-')[1]}월 건 이월]` : '';

            return `
                <tr>
                    <td style="text-align: center;">${dateStr}</td>
                    <td style="text-align: center; font-weight: 500;">${r.settlement_account || ''}</td>
                    <td style="text-align: left; padding-left: 5px;">${r.item}${carryText}</td>
                    <td style="text-align: center;">${r.spec || ''}</td>
                    <td style="text-align: right; padding-right: 4px;">${qty.toLocaleString()}</td>
                    <td style="text-align: center;">${r.unit || ''}</td>
                    <td style="text-align: right; padding-right: 4px;">${price.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px;">${supply.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px;">${vat.toLocaleString()}</td>
                    <td style="text-align: right; padding-right: 4px; font-weight: bold;">${total.toLocaleString()}</td>
                    <td style="text-align: left; padding-left: 4px;">${r.settlement_memo || r.note || ''}</td>
                </tr>
            `;
        }).join('');

        // 4. 금액 한글 표기 및 숫자 표기
        $('printAmountKor').innerText = `합 계 금 액 : 금 ${numberToKorean(sumGrand)} 원 정`;
        $('printAmountNum').innerText = `(₩ ${sumGrand.toLocaleString()})`;

        // 5. 바닥글 소계 및 계정별 요약
        const printTfoot = $('printTableFoot');
        const safeTotalCount = accountStats['안전자재-일반'].count + accountStats['안전자재-환경'].count;
        const safeTotalSupply = accountStats['안전자재-일반'].supply + accountStats['안전자재-환경'].supply;

        printTfoot.innerHTML = `
            <tr style="font-weight: bold; background-color: #f9f9f9; border-top: 1.5px solid #000;">
                <td colspan="4" style="text-align: center;">[ 총 계 ]</td>
                <td style="text-align: right; padding-right: 4px;">${sumQty.toLocaleString()}</td>
                <td></td>
                <td></td>
                <td style="text-align: right; padding-right: 4px;">${sumSupply.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px;">${sumVat.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px;">${sumGrand.toLocaleString()}</td>
                <td></td>
            </tr>
            <tr style="font-size: 10px; background-color: #fafafa; border-bottom: 2px solid #000;">
                <td colspan="11" style="text-align: left; padding: 4px 8px;">
                    <strong>[자재계정 소계]</strong>
                    안전자재 통합: <strong>${safeTotalCount}건</strong> (${safeTotalSupply.toLocaleString()}원) |
                    잡자재: <strong>${accountStats['잡자재'].count}건</strong> (${accountStats['잡자재'].supply.toLocaleString()}원) |
                    기타: <strong>${accountStats['기타자재'].count}건</strong> (${accountStats['기타자재'].supply.toLocaleString()}원) |
                    쇼핑몰: <strong>${accountStats['쇼핑몰'].count}건</strong> (${accountStats['쇼핑몰'].supply.toLocaleString()}원)
                </td>
            </tr>
        `;

        // 6. 브라우저 인쇄 실행
        window.print();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
