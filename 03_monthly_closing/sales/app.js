const API_BASE = 'https://kng.junparks.com/api/logistics';

const $ = id => document.getElementById(id);

const app = {
    currentTab: '미정산',
    currentPage: 1,
    limit: 50,
    items: [],

    init: function() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        $('filterMonth').value = `${now.getFullYear()}-${month}`;
        
        $('filterMonth').addEventListener('change', () => { this.currentPage = 1; this.loadData(); });
        $('searchInput').addEventListener('input', () => { this.currentPage = 1; this.loadData(); });
        
        this.loadData();
    },

    setTab: function(tabName) {
        this.currentTab = tabName;
        this.currentPage = 1;
        $('checkAll').checked = false;
        
        if (tabName === '미정산') {
            $('actionButtons').style.display = 'block';
            $('colStatusOrDate').innerText = '상태';
        } else {
            $('actionButtons').style.display = 'none';
            $('colStatusOrDate').innerText = '정산일자';
        }
        
        this.loadData();
    },

    loadData: async function() {
        try {
            const filterMonth = $('filterMonth').value;
            let startDate = '';
            let endDate = '';
            if (filterMonth) {
                startDate = `${filterMonth}-01`;
                // Last day of month
                const [y, m] = filterMonth.split('-');
                const lastDay = new Date(y, m, 0).getDate();
                endDate = `${filterMonth}-${lastDay}`;
            }

            const search = $('searchInput').value.trim();
            const url = new URL(`${API_BASE}/history`);
            url.searchParams.append('type', 'outbound');
            url.searchParams.append('page', this.currentPage);
            url.searchParams.append('limit', this.limit);
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (search) url.searchParams.append('search', search);

            const res = await window.authFetch(url.toString());
            const data = await res.json();
            
            // Filter by tab
            const filteredData = data.data.filter(r => 
                (this.currentTab === '미정산' && (!r.settlement_status || r.settlement_status === '미정산')) ||
                (this.currentTab === '정산완료' && r.settlement_status === '정산완료')
            );
            
            this.items = filteredData;
            this.renderTable();
            
            // local count display update
            if (this.currentTab === '미정산') {
                $('pendingCount').innerText = filteredData.length;
            } else {
                $('completedCount').innerText = filteredData.length;
            }
            
        } catch (err) {
            console.error(err);
            $('dataTableBody').innerHTML = `<tr><td colspan="9" class="text-center text-danger">데이터 로드 실패</td></tr>`;
        }
    },

    renderTable: function() {
        const tbody = $('dataTableBody');
        if (this.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">해당하는 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = this.items.map(r => {
            const isPending = this.currentTab === '미정산';
            const total = r.qty * r.price;
            let statusHtml = '';
            if (isPending) {
                statusHtml = `<span class="badge bg-warning text-dark">미정산</span>`;
            } else {
                statusHtml = `<div class="text-secondary small">${r.tax_invoice_date || ''}</div>
                              <span class="badge bg-success">정산완료</span>
                              ${r.is_zero_tax ? '<span class="badge bg-info ms-1">영세율</span>' : ''}`;
            }
            
            return `
            <tr>
                <td class="text-center">
                    ${isPending ? `<input class="form-check-input row-chk" type="checkbox" value="${r.id}">` : '-'}
                </td>
                <td>${r.date}</td>
                <td>${r.party}</td>
                <td><strong>${r.item}</strong></td>
                <td>${r.spec} / ${r.unit}</td>
                <td class="text-danger fw-bold">${r.qty}</td>
                <td>${r.price.toLocaleString()}</td>
                <td>${total.toLocaleString()}</td>
                <td class="text-center">${statusHtml}</td>
            </tr>
            `;
        }).join('');
    },

    toggleCheckAll: function() {
        const checked = $('checkAll').checked;
        document.querySelectorAll('.row-chk').forEach(el => el.checked = checked);
    },

    openSettlementModal: function() {
        const selected = Array.from(document.querySelectorAll('.row-chk:checked')).map(el => el.value);
        if (selected.length === 0) {
            return alert('정산할 내역을 선택해주세요.');
        }
        $('selectedCount').innerText = selected.length;
        $('taxDate').value = new Date().toISOString().split('T')[0];
        $('isZeroTax').checked = false;
        new bootstrap.Modal(document.getElementById('settleModal')).show();
    },

    submitSettlement: async function() {
        const selected = Array.from(document.querySelectorAll('.row-chk:checked')).map(el => parseInt(el.value));
        const taxDate = $('taxDate').value;
        const isZeroTax = $('isZeroTax').checked;
        
        if (!taxDate) return alert('정산 일자를 입력해주세요.');
        
        try {
            await window.authFetch(`${API_BASE}/settlement/outbound`, {
                method: 'POST',
                body: JSON.stringify({
                    ids: selected,
                    tax_invoice_date: taxDate,
                    is_zero_tax: isZeroTax
                })
            });
            alert('정산 처리가 완료되었습니다.');
            bootstrap.Modal.getInstance(document.getElementById('settleModal')).hide();
            $('checkAll').checked = false;
            this.loadData();
        } catch (err) {
            alert('정산 처리 실패: ' + err.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
