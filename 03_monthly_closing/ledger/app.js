const API_BASE = 'https://kng.junparks.com/api';

function numberToKorean(number) {
    if (number === 0) return '영';
    const han = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const danA = ['', '십', '백', '천'];
    const danG = ['', '만', '억', '조'];
    let result = '';
    let numStr = String(number);
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
    return result;
}

const app = {
    partners: [],
    currentDatePreset: 'prevMonth',
    rawRows: [],
    
    init() {
        this.loadPartners();
        
        // 날짜 직접 변경 이벤트
        document.getElementById('startDate').addEventListener('change', () => this.onDateInputChange());
        document.getElementById('endDate').addEventListener('change', () => this.onDateInputChange());

        // 초기 날짜 세팅 (전월 기본)
        this.setDatePreset('prevMonth');
    },

    setDatePreset: function(preset) {
        this.currentDatePreset = preset;
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1; // 1-12

        let startDate = '';
        let endDate = '';

        if (preset === 'thisMonth') {
            const lastDay = new Date(year, month, 0).getDate();
            startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else if (preset === 'prevMonth') {
            let prevYear = year;
            let prevMonth = month - 1;
            if (prevMonth === 0) {
                prevMonth = 12;
                prevYear -= 1;
            }
            const lastDay = new Date(prevYear, prevMonth, 0).getDate();
            startDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
            endDate = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        } else if (preset === 'thisYear') {
            startDate = `${year}-01-01`;
            endDate = `${year}-12-31`;
        } else if (preset === 'prevYear') {
            startDate = `${year - 1}-01-01`;
            endDate = `${year - 1}-12-31`;
        } else if (preset === 'all') {
            startDate = '2000-01-01';
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            endDate = `${y}-${m}-${d}`;
        }

        if (document.getElementById('startDate')) document.getElementById('startDate').value = startDate;
        if (document.getElementById('endDate')) document.getElementById('endDate').value = endDate;

        this.updatePresetButtons(preset);

        const partner = document.getElementById('partnerInput') ? document.getElementById('partnerInput').value.trim() : '';
        if (partner) {
            this.loadLedger();
        }
    },

    updatePresetButtons: function(activePreset) {
        ['prevMonth', 'thisMonth', 'prevYear', 'thisYear', 'all'].forEach(p => {
            const btn = document.getElementById(`btnPreset_${p}`);
            if (btn) {
                if (p === activePreset) {
                    btn.className = 'btn btn-sm btn-primary active text-white fw-bold text-nowrap';
                } else {
                    btn.className = 'btn btn-sm btn-outline-secondary text-nowrap';
                }
            }
        });
    },

    detectDatePreset: function(start, end) {
        if (!start && !end) return 'all';
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const pad = n => String(n).padStart(2, '0');

        // 당월
        const thisMonthLastDay = new Date(year, month, 0).getDate();
        if (start === `${year}-${pad(month)}-01` && end === `${year}-${pad(month)}-${pad(thisMonthLastDay)}`) {
            return 'thisMonth';
        }

        // 전월
        let prevYear = year;
        let prevMonth = month - 1;
        if (prevMonth === 0) {
            prevMonth = 12;
            prevYear -= 1;
        }
        const prevMonthLastDay = new Date(prevYear, prevMonth, 0).getDate();
        if (start === `${prevYear}-${pad(prevMonth)}-01` && end === `${prevYear}-${pad(prevMonth)}-${pad(prevMonthLastDay)}`) {
            return 'prevMonth';
        }

        // 금년도
        if (start === `${year}-01-01` && end === `${year}-12-31`) {
            return 'thisYear';
        }

        // 전년도
        if (start === `${year - 1}-01-01` && end === `${year - 1}-12-31`) {
            return 'prevYear';
        }

        // 전체 (2000-01-01 ~ 오늘)
        const todayStr = `${year}-${pad(month)}-${pad(now.getDate())}`;
        if (start === '2000-01-01' && (end === todayStr || !end)) {
            return 'all';
        }

        return '';
    },

    onDateInputChange: function() {
        const start = document.getElementById('startDate')?.value || '';
        const end = document.getElementById('endDate')?.value || '';
        const detected = this.detectDatePreset(start, end);
        this.currentDatePreset = detected;
        this.updatePresetButtons(detected);
        const partner = document.getElementById('partnerInput') ? document.getElementById('partnerInput').value.trim() : '';
        if (partner) {
            this.loadLedger();
        }
    },

    async loadPartners() {
        try {
            const res = await window.authFetch(`${API_BASE}/partners`);
            if (res.ok) {
                this.partners = await res.json();
            }
        } catch (error) {
            console.error('Failed to load partners', error);
        }
    },
    openPartnerSearchModal: function(targetInputId) {
        if (!this.partners || this.partners.length === 0) {
            this.loadPartners().then(() => this.showPartnerSearchModal(targetInputId));
        } else {
            this.showPartnerSearchModal(targetInputId);
        }
    },

    showPartnerSearchModal: function(targetInputId) {
        const inputEl = document.getElementById(targetInputId);
        if (!inputEl) return;
        
        document.getElementById('partnerSearchTargetInput').value = targetInputId;
        const searchVal = inputEl.value.trim();
        document.getElementById('partnerSearchInput').value = searchVal;
        
        this.filterPartnerSearch();

        const modalEl = document.getElementById('partnerSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
        
        // 포커스 이동
        setTimeout(() => document.getElementById('partnerSearchInput').focus(), 500);
    },

    filterPartnerSearch: function() {
        const val = document.getElementById('partnerSearchInput').value.trim().toLowerCase();
        const listContainer = document.getElementById('partnerSearchList');
        
        let matches = this.partners;
        if (val) {
            matches = matches.filter(p => 
                (p.name && p.name.toLowerCase().includes(val)) || 
                (p.company_name && p.company_name.toLowerCase().includes(val))
            );
        }
        
        if (matches.length === 0) {
            listContainer.innerHTML = `<div class="list-group-item text-center text-muted py-4">검색된 거래처가 없습니다.</div>`;
            return;
        }
        
        listContainer.innerHTML = matches.map(m => {
            return `
                <button type="button" class="list-group-item list-group-item-action py-2" onclick="app.selectPartner('${m.name}')">
                    <div class="fw-bold">${m.name}</div>
                    ${m.company_name ? `<div style="font-size: 0.8rem;" class="text-muted">${m.company_name}</div>` : ''}
                </button>
            `;
        }).join('');
    },

    selectPartner: function(name) {
        const targetId = document.getElementById('partnerSearchTargetInput').value;
        if (targetId && document.getElementById(targetId)) {
            document.getElementById(targetId).value = name;
        }
        const modal = bootstrap.Modal.getInstance(document.getElementById('partnerSearchModal'));
        if (modal) modal.hide();
        
        // 선택 후 자동 조회
        if (targetId === 'partnerInput') {
            this.loadLedger();
        }
    },

    async loadLedger() {
        const partner = document.getElementById('partnerInput').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const aggregateByBizNum = document.getElementById('aggregateByBizNum').checked;
        const accountFilter = document.getElementById('accountFilter')?.value || '';
        const tbody = document.getElementById('ledgerTableBody');
        const tfoot = document.getElementById('ledgerTableFoot');
        const summaryStrip = document.getElementById('ledgerSummaryStrip');
        const searchContainer = document.getElementById('ledgerInlineSearchContainer');

        if (!partner) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">조회할 거래처를 선택해주세요.</td></tr>`;
            tfoot.style.display = 'none';
            if (summaryStrip) summaryStrip.classList.add('d-none');
            if (searchContainer) searchContainer.classList.add('d-none');
            document.getElementById('printTitle').innerText = '매출/매입 정산내역';
            document.getElementById('printPeriod').innerText = '';
            return;
        }

        try {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 데이터를 불러오는 중입니다...</td></tr>`;
            
            let url = `${API_BASE}/ledger?partner=${encodeURIComponent(partner)}&startDate=${startDate}&endDate=${endDate}&aggregateByBizNum=${aggregateByBizNum}`;
            if (accountFilter) {
                url += `&settlement_account=${encodeURIComponent(accountFilter)}`;
            }

            const response = await window.authFetch(url);
            if (!response.ok) throw new Error('API Error');
            let res = await response.json();
            
            const ledgerType = document.querySelector('input[name="ledgerType"]:checked').value;
            if (ledgerType !== '전체') {
                res = res.filter(row => row.type === ledgerType);
            }

            this.rawRows = res || [];

            if (searchContainer) {
                searchContainer.classList.remove('d-none');
                const partnerInfoEl = document.getElementById('ledgerPartnerInfo');
                if (partnerInfoEl) {
                    const accLabel = accountFilter ? ` | 계정: <strong>${accountFilter}</strong>` : '';
                    partnerInfoEl.innerHTML = `거래처: <strong>${partner}</strong>${accLabel} | 전체 <strong>${this.rawRows.length}</strong>건`;
                }
            }

            this.filterLedgerRows();

        } catch (err) {
            console.error('Ledger error:', err);
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-danger">데이터 로드에 실패했습니다.</td></tr>`;
            if (summaryStrip) summaryStrip.classList.add('d-none');
            if (searchContainer) searchContainer.classList.add('d-none');
        }
    },

    filterLedgerRows: function() {
        const filterVal = document.getElementById('ledgerFilterInput') ? document.getElementById('ledgerFilterInput').value.trim() : '';
        const clearBtn = document.getElementById('clearLedgerFilterBtn');
        if (clearBtn) {
            if (filterVal.length > 0) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }

        let filtered = this.rawRows;
        if (filterVal) {
            const tokens = filterVal.split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
            filtered = this.rawRows.filter(row => {
                const combined = [
                    row.item || '',
                    row.spec || '',
                    row.unit || '',
                    row.settlement_account || '',
                    row.settlement_memo || '',
                    row.site_name || ''
                ].join(' ').toLowerCase();
                return tokens.every(token => combined.includes(token));
            });
        }

        this.renderLedgerTable(filtered);
    },

    clearLedgerFilter: function() {
        if (document.getElementById('ledgerFilterInput')) {
            document.getElementById('ledgerFilterInput').value = '';
        }
        const clearBtn = document.getElementById('clearLedgerFilterBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.filterLedgerRows();
    },

    renderLedgerTable: function(res) {
        const tbody = document.getElementById('ledgerTableBody');
        const tfoot = document.getElementById('ledgerTableFoot');
        const summaryStrip = document.getElementById('ledgerSummaryStrip');
        const partner = document.getElementById('partnerInput').value.trim();
        const aggregateByBizNum = document.getElementById('aggregateByBizNum').checked;
        const ledgerType = document.querySelector('input[name="ledgerType"]:checked').value;
        const accountFilter = document.getElementById('accountFilter')?.value || '';

        if (res.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">해당 조건에 부합하는 정산 내역이 없습니다.</td></tr>`;
            tfoot.style.display = 'none';
            if (summaryStrip) summaryStrip.classList.add('d-none');
            return;
        }

        let sumTotal = 0;
        let sumVat = 0;
        let sumGrand = 0;
        let sumQty = 0;

        // 계정별 통계 집계
        const accountStats = {
            '안전자재-일반': { count: 0, supplyAmt: 0 },
            '안전자재-환경': { count: 0, supplyAmt: 0 },
            '잡자재': { count: 0, supplyAmt: 0 },
            '기타자재': { count: 0, supplyAmt: 0 },
            '쇼핑몰': { count: 0, supplyAmt: 0 },
            '미분류': { count: 0, supplyAmt: 0 }
        };

        let html = res.map(row => {
            let shipAmount = 0;
            if (row.shipping_fee > 0) {
                shipAmount = row.shipping_fee_vat_included === 1 ? Math.round(row.shipping_fee / 1.1) : row.shipping_fee;
            }
            const amount = (row.qty * row.price) + shipAmount;
            const isZeroTax = row.is_zero_tax || (row.trade_type && row.trade_type !== '내수');
            let vat = 0;
            if (!isZeroTax) {
                if (row.settlement_vat !== undefined && row.settlement_vat !== null) {
                    vat = row.settlement_vat;
                } else {
                    const itemVat = Math.floor(row.qty * row.price * 0.1);
                    let shipVat = 0;
                    if (row.shipping_fee > 0) {
                        shipVat = row.shipping_fee_vat_included === 1 ? (row.shipping_fee - shipAmount) : Math.floor(shipAmount * 0.1);
                    }
                    vat = itemVat + shipVat;
                }
            }
            const grand = amount + vat;

            sumQty += (Number(row.qty) || 0);
            sumTotal += amount;
            sumVat += vat;
            sumGrand += grand;

            const accKey = row.settlement_account || '미분류';
            if (accountStats[accKey]) {
                accountStats[accKey].count++;
                accountStats[accKey].supplyAmt += amount;
            }
            
            const isDirect = row.is_direct ? '<span class="badge bg-warning text-dark ms-1 d-print-none">직출고</span>' : '';
            const siteBadge = aggregateByBizNum && row.site_name 
                ? `<span class="badge border border-secondary text-secondary ms-1 fw-normal">${row.site_name}</span>` 
                : '';
            const shipBadge = row.shipping_fee > 0 
                ? `<span class="badge bg-light text-secondary border ms-1 d-print-none">배송비 ${row.shipping_fee.toLocaleString()}</span>` 
                : '';

            let dateStr = row.settlement_date ? row.settlement_date.split('T')[0] : '';
            if (dateStr.length === 10) dateStr = dateStr.substring(5); // MM-DD

            let accountDisplay = row.settlement_account || '-';
            if (row.settlement_account === '안전자재-일반') accountDisplay = '안전(일반)';
            else if (row.settlement_account === '안전자재-환경') accountDisplay = '안전(환경)';

            return `
                <tr class="${row.is_direct ? 'direct-row' : ''}">
                    <td class="text-center">${dateStr}</td>
                    <td class="text-center fw-bold" style="font-size: 0.78rem;">${accountDisplay}</td>
                    <td class="text-start wrap-cell">${row.item} ${isDirect}${siteBadge}${shipBadge}</td>
                    <td class="text-center spec-cell wrap-cell">${row.spec || ''}</td>
                    <td class="text-end">${row.qty.toLocaleString()}</td>
                    <td class="text-center">${row.unit || ''}</td>
                    <td class="text-end">${row.price.toLocaleString()}</td>
                    <td class="text-end">${amount.toLocaleString()}</td>
                    <td class="text-end">${vat.toLocaleString()}</td>
                    <td class="text-start wrap-cell">${row.settlement_memo ? row.settlement_memo.replace(/"/g, '&quot;') : ''}</td>
                </tr>
            `;
        }).join('');

        // [ 이하 여백 ] 추가 (화면에서는 숨김, 인쇄 시에만 표시)
        html += `<tr class="empty-marker d-none d-print-table-row"><td colspan="10">[ 이 하 여 백 ]</td></tr>`;

        // 동적 빈 줄 채우기:
        // 단일 페이지(총 행수 20개 미만) 서식 완성 시에만 20행까지 빈칸을 채움.
        // 다중 페이지(20행 초과)일 때는 인쇄 시 마지막 페이지 하단 여백 확보 및 불필요한 빈 페이지(page 6 등) 방지를 위해 빈 줄을 채우지 않음.
        const defaultFirstPage = 20;
        let emptyRowsCount = 0;
        const totalRendered = res.length + 2;
        
        if (totalRendered < defaultFirstPage) {
            emptyRowsCount = defaultFirstPage - totalRendered;
        }
        
        for (let i = 0; i < emptyRowsCount; i++) {
            html += `<tr class="d-none d-print-table-row"><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
        }

        // 합계 행 추가 (앞 7칸이 일자~단가)
        html += `
            <tr class="total-row">
                <td colspan="7" class="text-center fw-bold">[ 합 계 ]</td>
                <td class="text-end fw-bold">${sumTotal.toLocaleString()}</td>
                <td class="text-end fw-bold">${sumVat.toLocaleString()}</td>
                <td class="text-center">&nbsp;</td>
            </tr>
        `;
        
        tbody.innerHTML = html;
        tfoot.style.display = 'none';

        // 실거래 요약 스트립 렌더링 (2단 구조: 상단 총괄, 하단 계정별 브레이크다운)
        if (summaryStrip) {
            const badgeTypeClass = ledgerType === '출고' ? 'bg-danger' : (ledgerType === '입고' ? 'bg-primary' : 'bg-secondary');
            summaryStrip.innerHTML = `
                <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pb-2 border-bottom">
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        <span class="text-secondary"><strong>거래처 실거래 요약</strong></span>
                        <span class="badge ${badgeTypeClass} px-2 py-1">${partner} (${res.length}건)</span>
                        ${accountFilter ? `<span class="badge bg-secondary px-2 py-1">${accountFilter}</span>` : ''}
                        <span class="text-muted ms-1 me-1">|</span>
                        <span class="text-muted">총 수량:</span>
                        <strong class="text-dark">${sumQty.toLocaleString()}</strong>
                    </div>
                    <div class="d-flex align-items-center gap-3 flex-wrap">
                        <div><span class="text-muted">공급가액:</span> <strong class="text-dark">${sumTotal.toLocaleString()}원</strong></div>
                        <div><span class="text-muted">부가세:</span> <strong class="text-secondary">${sumVat.toLocaleString()}원</strong></div>
                        <div class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1" style="font-size:0.85rem;">
                            합계금액: <strong class="fs-6">${sumGrand.toLocaleString()}</strong>원
                        </div>
                    </div>
                </div>
                <div class="d-flex align-items-center gap-2 flex-wrap" style="font-size: 0.79rem;">
                    <span class="text-secondary fw-bold me-1">계정별 집계:</span>
                    <span class="badge bg-primary text-white px-2 py-1 shadow-sm">
                        안전자재 통합: <strong>${(accountStats['안전자재-일반'].count + accountStats['안전자재-환경'].count)}건</strong> (${(accountStats['안전자재-일반'].supplyAmt + accountStats['안전자재-환경'].supplyAmt).toLocaleString()}원)
                    </span>
                    <span class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1">
                        안전(일반): <strong>${accountStats['안전자재-일반'].count}건</strong> (${accountStats['안전자재-일반'].supplyAmt.toLocaleString()}원)
                    </span>
                    <span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1">
                        안전(환경): <strong>${accountStats['안전자재-환경'].count}건</strong> (${accountStats['안전자재-환경'].supplyAmt.toLocaleString()}원)
                    </span>
                    <span class="text-muted mx-1">|</span>
                    <span class="badge bg-warning bg-opacity-10 text-dark border border-warning px-2 py-1">
                        잡자재: <strong>${accountStats['잡자재'].count}건</strong> (${accountStats['잡자재'].supplyAmt.toLocaleString()}원)
                    </span>
                    <span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary px-2 py-1">
                        기타자재: <strong>${accountStats['기타자재'].count}건</strong> (${accountStats['기타자재'].supplyAmt.toLocaleString()}원)
                    </span>
                    <span class="badge bg-info bg-opacity-10 text-info border border-info px-2 py-1">
                        쇼핑몰: <strong>${accountStats['쇼핑몰'].count}건</strong> (${accountStats['쇼핑몰'].supplyAmt.toLocaleString()}원)
                    </span>
                    ${accountStats['미분류'].count > 0 ? `
                    <span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-2 py-1">
                        미분류: <strong>${accountStats['미분류'].count}건</strong>
                    </span>
                    ` : ''}
                </div>
            `;
            summaryStrip.classList.remove('d-none');
            summaryStrip.classList.add('d-flex');
        }

        // 상단 금액 표시 (숫자 -> 한글 변환 적용)
        if(document.getElementById('printAmountKor')) {
            document.getElementById('printAmountKor').innerText = `합 계 금 액 : 금 ${numberToKorean(sumGrand)} 원 정`;
        }
        if(document.getElementById('printAmountNum')) {
            document.getElementById('printAmountNum').innerText = `(₩ ${sumGrand.toLocaleString()})`;
        }

        // 프린트 헤더 세팅 (자재계정 필터 선택 시 제목에 명시 [안전자재-일반] 등)
        let displayTitle = '';
        if (ledgerType === '입고') displayTitle = '거래(매입)내역서';
        else if (ledgerType === '출고') displayTitle = '거래(공급)내역서';
        else displayTitle = '매출/매입 정산내역';

        let accountSuffix = '';
        if (accountFilter) {
            accountSuffix = ` [${accountFilter}]`;
        }
        
        document.getElementById('printTitle').innerText = aggregateByBizNum 
            ? `(사업자 통합) ${displayTitle}${accountSuffix}`
            : `${displayTitle}${accountSuffix}`;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        document.getElementById('printPeriod').innerText = `거래기간: ${startDate} ~ ${endDate}`;
        
        // 공급자 및 수신처(귀중) 세팅
        this.setupPrintSupplierInfo(ledgerType, partner);
    },

    async setupPrintSupplierInfo(ledgerType, partner) {
        if (!this.partners || this.partners.length === 0) {
            await this.loadPartners();
        }
        const partnerObj = (this.partners || []).find(p => p.name === partner || p.company_name === partner);
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        const ourCompany = preset.bizName || '주식회사 케앤지';
        const ourCeo = preset.ceo || '윤종';
        const ourBizNo = preset.bizNo || '845-88-00551';
        const ourAddress = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        const ourBizType = preset.bizType || '도소매/임대업';
        const ourBizItem = preset.bizItem || '건설자재, 용품외';
        const stampImg = document.querySelector('.stamp');

        if (ledgerType === '입고') {
            // [매입장부]: 우리가 매입함
            // 공급받는자(수신처): (주)케앤지 貴中
            // 공급자: 매입처(partner) 정보
            document.getElementById('printPartnerName').innerText = ourCompany;
            document.getElementById('printBizNo').innerText = partnerObj?.business_number || '';
            document.getElementById('printBizName').innerText = partnerObj?.company_name || partnerObj?.name || partner;
            document.getElementById('printCeo').innerText = partnerObj?.ceo_name || '';
            document.getElementById('printAddress').innerText = partnerObj?.address || '';
            document.getElementById('printBizType').innerText = '';
            document.getElementById('printBizItem').innerText = '';
            if (stampImg) stampImg.style.display = 'none';
        } else {
            // [매출장부 / 전체]: 우리가 공급함
            // 공급받는자(수신처): [거래처명] 貴中
            // 공급자: 주식회사 케앤지 정보
            document.getElementById('printPartnerName').innerText = partner;
            document.getElementById('printBizNo').innerText = ourBizNo;
            document.getElementById('printBizName').innerText = ourCompany;
            document.getElementById('printCeo').innerText = ourCeo;
            document.getElementById('printAddress').innerText = ourAddress;
            document.getElementById('printBizType').innerText = ourBizType;
            document.getElementById('printBizItem').innerText = ourBizItem;
            if (stampImg) stampImg.style.display = 'block';
        }
    },

    async printLedger() {
        const ledgerType = document.querySelector('input[name="ledgerType"]:checked').value;
        if (ledgerType === '전체') {
            alert('인쇄를 진행하려면 매입장부 또는 매출장부를 선택해주세요.');
            return;
        }

        const partner = document.getElementById('partnerInput').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const aggregateByBizNum = document.getElementById('aggregateByBizNum').checked;
        const accountFilter = document.getElementById('accountFilter')?.value || '';
        
        let displayTitle = '';
        if (ledgerType === '입고') displayTitle = '거래(매입)내역서';
        else if (ledgerType === '출고') displayTitle = '거래(공급)내역서';
        else displayTitle = '매출/매입 정산내역';

        let accountSuffix = '';
        if (accountFilter) {
            accountSuffix = ` [${accountFilter}]`;
        }
        
        document.getElementById('printTitle').innerText = aggregateByBizNum 
            ? `(사업자 통합) ${displayTitle}${accountSuffix}`
            : `${displayTitle}${accountSuffix}`;

        document.getElementById('printPeriod').innerText = `거래기간: ${startDate} ~ ${endDate}`;
        
        await this.setupPrintSupplierInfo(ledgerType, partner);
        
        window.print();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
