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
    
    init() {
        this.setupDatePresets();
        this.loadPartners();
        
        // Event Listeners
        document.getElementById('startDate').addEventListener('change', () => this.loadLedger());
        document.getElementById('endDate').addEventListener('change', () => this.loadLedger());
    },

    setupDatePresets() {
        const today = new Date();
        const setDateRange = (start, end) => {
            const formatLocal = (d) => {
                const offset = d.getTimezoneOffset() * 60000;
                return new Date(d.getTime() - offset).toISOString().split('T')[0];
            };
            document.getElementById('startDate').value = formatLocal(start);
            document.getElementById('endDate').value = formatLocal(end);
            this.loadLedger();
        };

        const presets = {
            '전월': () => {
                const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const end = new Date(today.getFullYear(), today.getMonth(), 0);
                setDateRange(start, end);
            },
            '당월': () => {
                const start = new Date(today.getFullYear(), today.getMonth(), 1);
                const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
                setDateRange(start, end);
            },
            '3개월': () => {
                const start = new Date(today.getFullYear(), today.getMonth() - 3, 1);
                setDateRange(start, today);
            },
            '6개월': () => {
                const start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
                setDateRange(start, today);
            },
            '전체': () => {
                const start = new Date(2000, 0, 1);
                setDateRange(start, today);
            }
        };

        document.querySelectorAll('input[name="datePreset"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    presets[e.target.value]();
                }
            });
        });

        // 초기값 전월 세팅
        presets['전월']();
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
        const partner = document.getElementById('partnerInput').value;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const aggregateByBizNum = document.getElementById('aggregateByBizNum').checked;
        const tbody = document.getElementById('ledgerTableBody');
        const tfoot = document.getElementById('ledgerTableFoot');

        if (!partner) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">조회할 거래처를 선택해주세요.</td></tr>`;
            tfoot.style.display = 'none';
            document.getElementById('printTitle').innerText = '매출/매입 정산내역';
            document.getElementById('printPeriod').innerText = '';
            return;
        }

        try {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">데이터를 불러오는 중입니다...</td></tr>`;
            
            const response = await window.authFetch(`${API_BASE}/ledger?partner=${encodeURIComponent(partner)}&startDate=${startDate}&endDate=${endDate}&aggregateByBizNum=${aggregateByBizNum}`);
            if (!response.ok) throw new Error('API Error');
            let res = await response.json();
            
            const ledgerType = document.querySelector('input[name="ledgerType"]:checked').value;
            if (ledgerType !== '전체') {
                res = res.filter(row => row.type === ledgerType);
            }
            
            if (res.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">해당 기간에 정산된 내역이 없습니다.</td></tr>`;
                tfoot.style.display = 'none';
            } else {
                let sumTotal = 0;
                let sumVat = 0;
                let sumGrand = 0;

                let html = res.map(row => {
                    const amount = row.qty * row.price;
                    const isZeroTax = row.is_zero_tax || (row.trade_type && row.trade_type !== '내수');
                    const vat = isZeroTax ? 0 : Math.floor(amount * 0.1);
                    const grand = amount + vat;

                    sumTotal += amount;
                    sumVat += vat;
                    sumGrand += grand;
                    
                    const isDirect = row.is_direct ? '<span class="badge bg-warning text-dark ms-1">직출고</span>' : '';
                    const siteBadge = aggregateByBizNum && row.site_name 
                        ? `<span class="badge border border-secondary text-secondary ms-1 fw-normal">${row.site_name}</span>` 
                        : '';

                    let dateStr = row.settlement_date ? row.settlement_date.split('T')[0] : '';
                    if (dateStr.length === 10) dateStr = dateStr.substring(5); // MM-DD

                    return `
                        <tr class="${row.is_direct ? 'direct-row' : ''}">
                            <td class="text-center">${dateStr}</td>
                            <td class="text-start wrap-cell">${row.item} ${isDirect}${siteBadge}</td>
                            <td class="text-center">${row.spec || ''}</td>
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
                html += `<tr class="empty-marker d-none d-print-table-row"><td colspan="9">[ 이 하 여 백 ]</td></tr>`;

                // 동적 빈 줄 채우기 (기본 20줄, 20줄 초과 시 최대 24줄까지 1페이지 수용, 그 이상은 2페이지 분할)
                const defaultFirstPage = 20;
                const maxFirstPage = 24;
                const rowsOtherPage = 32;
                let emptyRowsCount = 0;
                const totalRendered = res.length + 2; // Data + 이하 여백 + 합계
                
                if (totalRendered <= defaultFirstPage) {
                    emptyRowsCount = defaultFirstPage - totalRendered;
                } else if (totalRendered <= maxFirstPage) {
                    emptyRowsCount = maxFirstPage - totalRendered;
                } else {
                    const overflow = totalRendered - maxFirstPage;
                    const remainder = overflow % rowsOtherPage;
                    if (remainder > 0) {
                        emptyRowsCount = rowsOtherPage - remainder;
                    }
                }
                
                for (let i = 0; i < emptyRowsCount; i++) {
                    html += `<tr class="d-none d-print-table-row"><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`;
                }

                // 합계 행 추가
                html += `
                    <tr class="total-row">
                        <td colspan="6" style="text-align: center; letter-spacing: 5px;">[ 합 계 ]</td>
                        <td class="text-end">${sumTotal.toLocaleString()}</td>
                        <td class="text-end">${sumVat.toLocaleString()}</td>
                        <td></td>
                    </tr>
                `;
                
                tbody.innerHTML = html;
                tfoot.style.display = 'none';

                // 상단 금액 표시 (숫자 -> 한글 변환 적용)
                if(document.getElementById('printAmountKor')) {
                    document.getElementById('printAmountKor').innerText = `합 계 금 액 : 금 ${numberToKorean(sumGrand)} 원 정`;
                }
                if(document.getElementById('printAmountNum')) {
                    document.getElementById('printAmountNum').innerText = `(₩ ${sumGrand.toLocaleString()})`;
                }
            }

            // 프린트 헤더 세팅
            let displayTitle = '';
            if (ledgerType === '입고') displayTitle = '거래(매입)내역서';
            else if (ledgerType === '출고') displayTitle = '거래(공급)내역서';
            else displayTitle = '매출/매입 정산내역';
            
            document.getElementById('printTitle').innerText = aggregateByBizNum 
                ? `(사업자 통합) ${displayTitle}`
                : displayTitle;
            document.getElementById('printPeriod').innerText = `거래기간: ${startDate} ~ ${endDate}`;
            document.getElementById('printPartnerName').innerText = partner;

        } catch (error) {
            console.error('Failed to load ledger', error);
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
            tfoot.style.display = 'none';
        }
    },

    printLedger() {
        const ledgerType = document.querySelector('input[name="ledgerType"]:checked').value;
        if (ledgerType === '전체') {
            alert('인쇄를 진행하려면 매입장부 또는 매출장부를 선택해주세요.');
            return;
        }

        const partner = document.getElementById('partnerInput').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        
        document.getElementById('printPeriod').innerText = `거래기간: ${startDate} ~ ${endDate}`;
        document.getElementById('printPartnerName').innerText = partner;
        
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        document.getElementById('printBizNo').innerText = preset.bizNo || '845-88-00551';
        document.getElementById('printBizName').innerText = preset.bizName || '주식회사 케앤지';
        document.getElementById('printCeo').innerText = preset.ceo || '윤종';
        document.getElementById('printAddress').innerText = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        document.getElementById('printBizType').innerText = preset.bizType || '도소매/임대업';
        document.getElementById('printBizItem').innerText = preset.bizItem || '건설자재, 용품외';
        
        window.print();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
