const API_BASE = 'https://kng.junparks.com/api';

const app = {
    partners: [],
    
    init() {
        this.setupDatePresets();
        this.loadPartners();
        
        // Event Listeners
        document.getElementById('partnerInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.loadLedger();
            }
        });
        document.getElementById('startDate').addEventListener('change', () => this.loadLedger());
        document.getElementById('endDate').addEventListener('change', () => this.loadLedger());
    },

    setupDatePresets() {
        const today = new Date();
        const setDateRange = (start, end) => {
            document.getElementById('startDate').value = start.toISOString().split('T')[0];
            document.getElementById('endDate').value = end.toISOString().split('T')[0];
            this.loadLedger();
        };

        const presets = {
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

        document.querySelectorAll('.date-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                presets[e.target.dataset.preset]();
            });
        });

        // 초기값 당월 세팅
        presets['당월']();
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
    
    
    

    

    

    async loadLedger() {
        const partner = document.getElementById('partnerInput').value.trim();
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const tbody = document.getElementById('ledgerTableBody');
        const tfoot = document.getElementById('ledgerTableFoot');

        if (!partner) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">조회할 거래처를 선택해주세요.</td></tr>`;
            tfoot.style.display = 'none';
            document.getElementById('printTitle').innerText = '판매장부';
            document.getElementById('printPeriod').innerText = '';
            return;
        }

        try {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">데이터를 불러오는 중입니다...</td></tr>`;
            
            const response = await window.authFetch(`${API_BASE}/ledger?partner=${encodeURIComponent(partner)}&startDate=${startDate}&endDate=${endDate}`);
            if (!response.ok) throw new Error('API Error');
            const res = await response.json();
            
            if (res.length === 0) {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-muted">해당 기간에 거래 내역이 없습니다.</td></tr>`;
                tfoot.style.display = 'none';
            } else {
                let sumQty = 0;
                let sumAmount = 0;

                tbody.innerHTML = res.map(row => {
                    const amount = row.qty * row.price;
                    sumQty += row.qty;
                    sumAmount += amount;
                    
                    const isDirect = row.is_direct ? '<span class="badge bg-warning text-dark ms-1">직출고</span>' : '';
                    const typeBadge = row.type === '입고' 
                        ? `<span class="badge bg-danger bg-opacity-75">입고(매입)</span>`
                        : `<span class="badge bg-primary bg-opacity-75">출고(매출)</span>`;

                    return `
                        <tr class="${row.is_direct ? 'direct-row' : ''}">
                            <td class="text-center">${row.date.split('T')[0]}</td>
                            <td class="text-center">${typeBadge}</td>
                            <td class="fw-bold">${row.item} ${isDirect}</td>
                            <td>${row.spec || ''}</td>
                            <td class="text-center">${row.unit || ''}</td>
                            <td class="text-end">${row.qty.toLocaleString()}</td>
                            <td class="text-end">${row.price.toLocaleString()}</td>
                            <td class="text-end fw-bold">${amount.toLocaleString()}</td>
                            <td class="text-muted small">${row.note || ''}</td>
                        </tr>
                    `;
                }).join('');

                document.getElementById('sumQty').innerText = sumQty.toLocaleString();
                document.getElementById('sumAmount').innerText = sumAmount.toLocaleString();
                tfoot.style.display = 'table-footer-group';
            }

            // 프린트 헤더 세팅
            document.getElementById('printTitle').innerText = `${partner} 거래원장 (판매장부)`;
            document.getElementById('printPeriod').innerText = `조회기간: ${startDate} ~ ${endDate}`;

        } catch (error) {
            console.error('Failed to load ledger', error);
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-5 text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
            tfoot.style.display = 'none';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
