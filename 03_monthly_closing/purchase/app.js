const API_BASE = 'https://kng.junparks.com/api/logistics';

const $ = id => document.getElementById(id);

const app = {
    currentStatus: '미정산', // 기본: 미정산
    currentPage: 1,
    limit: 50,
    items: [],
    totalItems: 0,

    init: function() {
        // 이벤트 리스너 등록
        $('statusFilter').addEventListener('change', (e) => {
            this.currentStatus = e.target.value;
            this.currentPage = 1;
            this.loadData();
        });
        
        $('limitSelect').addEventListener('change', (e) => {
            this.limit = parseInt(e.target.value, 10);
            this.currentPage = 1;
            this.loadData();
        });
        
        $('searchInput').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') { this.currentPage = 1; this.loadData(); }
        });
        
        // 날짜 프리셋 이벤트
        document.querySelectorAll('.date-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.applyDatePreset(e.target.dataset.preset);
                this.currentPage = 1;
                this.loadData();
            });
        });
        
        // 직접 날짜 변경 시 프리셋 액티브 해제
        const clearPreset = () => {
            document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
        };
        $('startDate').addEventListener('change', clearPreset);
        $('endDate').addEventListener('change', clearPreset);
        
        // 체크박스 헤더
        $('checkAllHeader').addEventListener('change', this.onCheckAllHeaderChange.bind(this));
        
        // 초기 날짜 세팅 (당월)
        this.applyDatePreset('당월');
        
        // 데이터 로드
        this.loadData();
    },

    applyDatePreset: function(preset) {
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth();
        const d = today.getDate();
        
        let start, end;
        
        const formatDate = (date) => {
            const yy = date.getFullYear();
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const dd = String(date.getDate()).padStart(2, '0');
            return `${yy}-${mm}-${dd}`;
        };

        if (preset === '당월') {
            start = new Date(y, m, 1);
            end = new Date(y, m + 1, 0); // 말일
        } else if (preset === '3개월') {
            start = new Date(y, m - 3, d);
            end = today;
        } else if (preset === '6개월') {
            start = new Date(y, m - 6, d);
            end = today;
        } else if (preset === '전체') {
            $('startDate').value = '';
            $('endDate').value = '';
            return;
        }
        
        if (start && end) {
            $('startDate').value = formatDate(start);
            $('endDate').value = formatDate(end);
        }
    },
    
    resetAdvancedSearch: function() {
        $('searchParty').value = '';
        $('searchItem').value = '';
        $('searchSpec').value = '';
        this.loadData();
    },

    loadData: async function() {
        try {
            const startDate = $('startDate').value;
            const endDate = $('endDate').value;
            const search = $('searchInput').value.trim();
            const searchParty = $('searchParty').value.trim();
            const searchItem = $('searchItem').value.trim();
            const searchSpec = $('searchSpec').value.trim();

            const url = new URL(`${API_BASE}/history`);
            url.searchParams.append('type', 'inbound');
            url.searchParams.append('include_direct', 'true');
            url.searchParams.append('page', this.currentPage);
            url.searchParams.append('limit', this.limit);
            
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (search) url.searchParams.append('search', search);
            if (searchParty) url.searchParams.append('searchParty', searchParty);
            if (searchItem) url.searchParams.append('searchItem', searchItem);
            if (searchSpec) url.searchParams.append('searchSpec', searchSpec);

            const res = await window.authFetch(url.toString());
            const result = await res.json();
            
            let allData = result.data || [];
            
            // 상태 필터링 (클라이언트 단 - API가 상태 필터를 미지원할 수 있으므로 넉넉히 가져와서 필터링, 단 페이징 이슈 주의)
            // 백엔드가 상태 필터를 받지 않으므로, 사실 이상적으로는 백엔드에 맡겨야함.
            // 하지만 당장 화면 레벨에서 걸러주는 것이 기존 방식임.
            const filteredData = allData.filter(r => 
                this.currentStatus === '전체보기' ||
                (this.currentStatus === '미정산' && (!r.settlement_status || r.settlement_status === '미정산')) ||
                (this.currentStatus === '정산완료' && r.settlement_status === '정산완료')
            );
            
            this.items = filteredData;
            this.totalItems = result.total; // 백엔드 토탈
            
            // 화면 렌더링
            this.renderTable();
            this.updatePagination();
            
            // UI 초기화
            $('checkAllHeader').checked = false;
            this.updateBatchButton();
            
        } catch (err) {
            console.error(err);
            $('dataTableBody').innerHTML = `<tr><td colspan="9" class="text-center text-danger">데이터 로드 실패</td></tr>`;
        }
    },

    renderTable: function() {
        const tbody = $('dataTableBody');
        if (this.items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">해당하는 내역이 없습니다.</td></tr>`;
            $('totalCount').innerText = 0;
            return;
        }
        
        $('totalCount').innerText = this.items.length; // 현재 필터링된 개수 (정확한 전체는 아님)

        tbody.innerHTML = this.items.map(r => {
            const originalTotal = (r.qty || 0) * (r.inbound_price || 0);
            
            let statusVal = r.settlement_status || '미정산';
            const directBadge = r.is_direct ? `<span class="badge bg-secondary ms-1">직출고</span>` : '';
            
            if (statusVal === '미정산') {
                const defaultTaxDate = r.date ? r.date.split('T')[0] : '';
                return `
                <tr data-id="${r.id}" class="unsettled-row">
                    <td class="text-center align-middle">
                        <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" onchange="app.updateBatchButton()">
                    </td>
                    <td class="align-middle px-2">
                        <div class="original-data">${r.date.split('T')[0]}</div>
                        <input type="date" class="form-control form-control-sm inline-date edit-input" value="${defaultTaxDate}">
                    </td>
                    <td class="align-middle text-truncate" style="max-width: 120px;" title="${r.supplier || ''}">${r.supplier || ''}</td>
                    <td class="align-middle text-truncate" style="max-width: 150px;">
                        <div><strong>${r.item}</strong>${directBadge}</div>
                        <div class="text-muted small mt-1" title="${r.spec} / ${r.unit}">${r.spec} / ${r.unit}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${r.qty}</div>
                        <input type="number" class="form-control form-control-sm text-end inline-qty edit-input" value="${r.qty}" oninput="app.calcInline(${r.id})">
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${Number(r.inbound_price || 0).toLocaleString()}</div>
                        <input type="number" class="form-control form-control-sm text-end inline-price edit-input" value="${r.inbound_price || 0}" oninput="app.calcInline(${r.id})">
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${Number(originalTotal).toLocaleString()}</div>
                        <div class="text-primary fw-bold inline-supply-amt mt-2">0</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="form-check form-switch d-flex justify-content-end align-items-center gap-1 mb-1 p-0">
                            <input class="form-check-input m-0 inline-zero-tax" type="checkbox" role="switch" style="cursor: pointer;" onchange="app.calcInline(${r.id})">
                            <label class="form-check-label small text-muted" style="font-size: 0.75rem;">영세율</label>
                        </div>
                        <div class="text-primary inline-vat">0</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div style="height: 1.4rem;"></div> <!-- Spacing to align with total -->
                        <div class="text-primary fw-bold inline-total-amt">0</div>
                    </td>
                    <td class="text-center align-middle">
                        <div class="mb-1"><span class="badge bg-warning text-dark">미정산</span></div>
                        <button class="btn btn-sm btn-primary py-0 px-2 fw-bold" onclick="app.submitInlineSettlement(${r.id})">정산</button>
                    </td>
                </tr>
                `;
            } else {
                const supplyAmt = (r.settlement_qty || 0) * (r.settlement_price || 0);
                const vat = r.is_zero_tax ? 0 : Math.floor(supplyAmt * 0.1);
                const totalAmt = supplyAmt + vat;
                
                return `
                <tr data-id="${r.id}">
                    <td class="text-center align-middle">
                        <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" onchange="app.updateBatchButton()">
                    </td>
                    <td class="align-middle px-2">
                        <div class="original-data">${r.date.split('T')[0]}</div>
                        <div class="text-primary fw-bold mt-2" style="font-size: 0.95rem;">${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'}</div>
                    </td>
                    <td class="align-middle text-truncate" style="max-width: 120px;" title="${r.supplier || ''}">${r.supplier || ''}</td>
                    <td class="align-middle text-truncate" style="max-width: 150px;">
                        <div><strong>${r.item}</strong>${directBadge}</div>
                        <div class="text-muted small mt-1" title="${r.spec} / ${r.unit}">${r.spec} / ${r.unit}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${r.qty}</div>
                        <div class="text-primary fw-bold mt-2" style="font-size: 0.95rem;">${r.settlement_qty}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${Number(r.inbound_price || 0).toLocaleString()}</div>
                        <div class="text-primary fw-bold mt-2" style="font-size: 0.95rem;">${Number(r.settlement_price || 0).toLocaleString()}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div class="original-data">${Number(originalTotal).toLocaleString()}</div>
                        <div class="text-primary fw-bold mt-2" style="font-size: 0.95rem;">${Number(supplyAmt).toLocaleString()}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div style="height: 1.2rem;"></div>
                        <div class="text-primary fw-bold" style="font-size: 0.95rem;">${Number(vat).toLocaleString()}</div>
                    </td>
                    <td class="text-end align-middle px-2">
                        <div style="height: 1.2rem;"></div>
                        <div class="text-primary fw-bold" style="font-size: 0.95rem;">${Number(totalAmt).toLocaleString()}</div>
                    </td>
                    <td class="text-center align-middle">
                        <div class="mb-1">
                            <span class="badge bg-success">정산완료</span>
                            ${r.is_zero_tax ? '<span class="badge bg-info ms-1">영세율</span>' : ''}
                        </div>
                    </td>
                </tr>
                `;
            }
        }).join('');
        
        // 초기 렌더링 후 모든 미정산 행에 대해 초기 계산 실행
        this.items.filter(r => (!r.settlement_status || r.settlement_status === '미정산')).forEach(r => {
            this.calcInline(r.id);
        });
    },

    updatePagination: function() {
        // 간단한 페이징 처리
        const totalPages = Math.ceil(this.totalItems / this.limit) || 1;
        const pageInfo = `${(this.currentPage - 1) * this.limit + 1} - ${Math.min(this.currentPage * this.limit, this.totalItems)} (총 ${this.totalItems}건)`;
        $('pageInfo').innerText = pageInfo;
        
        let paginationHtml = '';
        paginationHtml += `<button class="btn btn-sm btn-outline-secondary" ${this.currentPage === 1 ? 'disabled' : ''} onclick="app.goToPage(${this.currentPage - 1})">&laquo; 이전</button>`;
        paginationHtml += `<button class="btn btn-sm btn-outline-secondary" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="app.goToPage(${this.currentPage + 1})">다음 &raquo;</button>`;
        $('pagination').innerHTML = paginationHtml;
    },
    
    goToPage: function(p) {
        this.currentPage = p;
        this.loadData();
    },

    // 체크박스 기능들
    onCheckAllHeaderChange: function() {
        const checked = $('checkAllHeader').checked;
        document.querySelectorAll('.row-chk').forEach(el => el.checked = checked);
        this.updateBatchButton();
    },
    
    toggleCheckAllRows: function(forceCheck) {
        $('checkAllHeader').checked = forceCheck;
        document.querySelectorAll('.row-chk').forEach(el => el.checked = forceCheck);
        this.updateBatchButton();
    },
    
    checkAllUnsettled: function() {
        let hasUnsettled = false;
        document.querySelectorAll('.row-chk').forEach(el => {
            if (el.dataset.status === '미정산') {
                el.checked = true;
                hasUnsettled = true;
            } else {
                el.checked = false;
            }
        });
        $('checkAllHeader').checked = false;
        this.updateBatchButton();
        if (!hasUnsettled) alert('현재 목록에 미정산 항목이 없습니다.');
    },
    
    updateBatchButton: function() {
        const checkedBoxes = document.querySelectorAll('.row-chk:checked');
        let hasUnsettled = false;
        let hasSettled = false;
        
        checkedBoxes.forEach(el => {
            if (el.dataset.status === '미정산') hasUnsettled = true;
            if (el.dataset.status === '정산완료') hasSettled = true;
        });
        
        $('batchSettleBtn').style.display = hasUnsettled ? 'inline-block' : 'none';
        $('batchDateContainer').style.display = hasUnsettled ? 'flex' : 'none';
        $('cancelSettleBtn').style.display = hasSettled ? 'inline-block' : 'none';
        
        const allChecks = document.querySelectorAll('.row-chk');
        $('checkAllHeader').checked = allChecks.length > 0 && checkedBoxes.length === allChecks.length;
    },

    calcInline: function(id) {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if(!tr) return;
        const qty = parseFloat(tr.querySelector('.inline-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.inline-price').value) || 0;
        const isZeroTax = tr.querySelector('.inline-zero-tax').checked;
        
        const supplyAmt = qty * price;
        const vat = isZeroTax ? 0 : Math.floor(supplyAmt * 0.1);
        const total = supplyAmt + vat;
        
        tr.querySelector('.inline-supply-amt').innerText = supplyAmt.toLocaleString();
        tr.querySelector('.inline-vat').innerText = vat.toLocaleString();
        tr.querySelector('.inline-total-amt').innerText = total.toLocaleString();
    },
    
    applyBatchDate: function() {
        const d = $('batchSettleDate').value;
        if(!d) return alert('일괄 적용할 정산일자를 선택해주세요.');
        document.querySelectorAll('.row-chk:checked').forEach(el => {
            if(el.dataset.status === '미정산') {
                const tr = el.closest('tr');
                const dateInput = tr.querySelector('.inline-date');
                if(dateInput) dateInput.value = d;
            }
        });
    },

    submitInlineSettlement: async function(id) {
        const tr = document.querySelector(`tr[data-id="${id}"]`);
        if(!tr) return;
        
        const taxDate = tr.querySelector('.inline-date').value;
        const qty = parseFloat(tr.querySelector('.inline-qty').value) || 0;
        const price = parseFloat(tr.querySelector('.inline-price').value) || 0;
        const isZeroTax = tr.querySelector('.inline-zero-tax').checked;
        
        if(!taxDate) return alert('정산일자를 입력해주세요.');
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    updates: [{
                        id: id,
                        tax_invoice_date: taxDate,
                        settlement_qty: qty,
                        settlement_price: price,
                        is_zero_tax: isZeroTax ? 1 : 0
                    }]
                })
            });
            if (res.ok) {
                // 부분 리로드 대신 화면 전체 리로드 (페이징 유지)
                this.loadData();
            } else {
                alert('정산 처리에 실패했습니다.');
            }
        } catch(err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        }
    },
    
    submitBatchSettlement: async function() {
        const checked = document.querySelectorAll('.row-chk:checked');
        const updates = [];
        
        checked.forEach(el => {
            if(el.dataset.status === '미정산') {
                const id = parseInt(el.value);
                const tr = el.closest('tr');
                const taxDate = tr.querySelector('.inline-date').value;
                const qty = parseFloat(tr.querySelector('.inline-qty').value) || 0;
                const price = parseFloat(tr.querySelector('.inline-price').value) || 0;
                const isZeroTax = tr.querySelector('.inline-zero-tax').checked;
                
                updates.push({
                    id: id,
                    tax_invoice_date: taxDate,
                    settlement_qty: qty,
                    settlement_price: price,
                    is_zero_tax: isZeroTax ? 1 : 0
                });
            }
        });
        
        if(updates.length === 0) return alert('선택된 미정산 내역이 없습니다.');
        
        if(updates.some(u => !u.tax_invoice_date)) {
            return alert('정산일자가 입력되지 않은 항목이 있습니다.');
        }
        
        if(!confirm(`선택한 ${updates.length}건을 일괄 정산완료 처리하시겠습니까?`)) return;
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ updates })
            });
            if (res.ok) {
                this.loadData();
            } else {
                alert('일괄 정산 처리에 실패했습니다.');
            }
        } catch(err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        }
    },
    
    cancelSettlementBatch: async function() {
        const checked = document.querySelectorAll('.row-chk:checked');
        const ids = [];
        checked.forEach(el => {
            if(el.dataset.status === '정산완료') {
                ids.push(parseInt(el.value));
            }
        });
        
        if(ids.length === 0) return alert('취소할 정산완료 내역이 선택되지 않았습니다.');
        if(!confirm(`선택한 ${ids.length}건을 정산 취소하시겠습니까?\n(다시 미정산 상태로 돌아가며 정산일자는 초기화됩니다.)`)) return;
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound/cancel`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ ids })
            });
            if (res.ok) {
                this.loadData();
            } else {
                alert('취소 처리에 실패했습니다.');
            }
        } catch(err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        }
    },

    // 거래내역서 출력
    printSelected: function() {
        const checkedBoxes = document.querySelectorAll('.row-chk:checked');
        if (checkedBoxes.length === 0) return alert('출력할 내역을 선택해주세요.');
        
        const selectedIds = Array.from(checkedBoxes).map(el => parseInt(el.value));
        const selectedItems = this.items.filter(item => selectedIds.includes(item.id));
        
        // Group by Party? Let's just print all in one statement for simplicity, or we could group by party if needed. 
        // User just said "선택내역 거래내역서(원장) 출력", so we print exactly what is selected.
        
        let sumTotal = 0;
        let sumVat = 0;
        let sumGrand = 0;
        
        const rowsHtml = selectedItems.map((r, index) => {
            const isSettled = r.settlement_status === '정산완료';
            const qty = isSettled ? (r.settlement_qty || 0) : (r.qty || 0);
            const price = isSettled ? (r.settlement_price || 0) : (r.inbound_price || 0);
            
            const total = qty * price;
            const vat = r.is_zero_tax ? 0 : Math.floor(total * 0.1);
            const grand = total + vat;
            
            sumTotal += total;
            sumVat += vat;
            sumGrand += grand;
            
            return `
            <tr>
                <td>${index + 1}</td>
                <td>${r.date ? r.date.split('T')[0] : ''}</td>
                <td>${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'}</td>
                <td>${r.supplier || ''}</td>
                <td>${r.item}</td>
                <td>${r.spec} / ${r.unit}</td>
                <td class="text-right">${qty.toLocaleString()}</td>
                <td class="text-right">${Number(price).toLocaleString()}</td>
                <td class="text-right">${Number(total).toLocaleString()}</td>
                <td class="text-right">${Number(vat).toLocaleString()}</td>
                <td class="text-right fw-bold">${Number(grand).toLocaleString()}</td>
            </tr>
            `;
        }).join('');
        
        const printHtml = `
            <table class="print-table" style="width:100%; border:none;">
                <thead>
                    <tr>
                        <td colspan="11" style="border:none; padding: 15mm 0 15px 0;">
                            <div class="print-header" style="text-align:center; margin-bottom:0;">
                                <h2 style="margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 10px; display: inline-block;">거래내역서</h2>
                                <div style="text-align:right; font-size:12px; margin-top:10px;">출력일시: ${new Date().toLocaleString()}</div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <th style="width:40px;">No.</th>
                        <th>발생일자</th>
                        <th>정산일자</th>
                        <th>거래처</th>
                        <th>품명</th>
                        <th>규격/단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>공급가액</th>
                        <th>부가세</th>
                        <th>합계금액</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tbody style="border-top: 2px solid #000;">
                    <tr>
                        <td colspan="5" style="border: 2px solid #000; background-color: #f8f9fa; font-weight: bold; text-align: center; font-size: 14px; letter-spacing: 5px;">[ 합 계 ]</td>
                        <td style="background-color:#f8f9fa; font-weight:bold; border: 2px solid #000; text-align:center; font-size:14px; padding:10px;">총 공급가액</td>
                        <td class="text-right" style="font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumTotal).toLocaleString()} 원</td>
                        <td style="background-color:#f8f9fa; font-weight:bold; border: 2px solid #000; text-align:center; font-size:14px; padding:10px;">총 부가세</td>
                        <td class="text-right" style="font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumVat).toLocaleString()} 원</td>
                        <td style="background-color:#e9ecef; font-weight:bold; border: 2px solid #000; text-align:center; font-size:14px; padding:10px;">총 합계금액</td>
                        <td class="text-right" style="font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumGrand).toLocaleString()} 원</td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="11" style="border:none; height: 15mm; padding: 0;"></td>
                    </tr>
                </tfoot>
            </table>
        `;
        
        $('printContainer').innerHTML = printHtml;
        
        setTimeout(() => {
            window.print();
        }, 300);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
