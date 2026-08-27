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
            url.searchParams.append('type', 'outbound');
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
            const qtyTotal = (r.qty || 0) * (r.outbound_price || 0);
            let shipAmount = 0;
            if (r.shipping_fee > 0) {
                shipAmount = r.shipping_fee_vat_included === 1 
                             ? Math.round(r.shipping_fee / 1.1) 
                             : r.shipping_fee;
            }
            const total = qtyTotal + shipAmount;
            
            let itemDisplay = `<strong>${r.item}</strong>`;
            if (r.is_direct) itemDisplay += `<span class="badge bg-secondary ms-1">직</span>`;
            if (r.shipping_fee > 0) {
                const shipVatText = r.shipping_fee_vat_included === 1 ? '(부가세 포함)' : '(공급가 기준)';
                itemDisplay += `<div class="small text-muted mt-1">+ 배송비 ${r.shipping_fee.toLocaleString()}원 ${shipVatText}</div>`;
            }
            
            let statusHtml = '';
            let statusVal = r.settlement_status || '미정산';
            if (statusVal === '미정산') {
                statusHtml = `<span class="badge bg-warning text-dark">미정산</span>`;
            } else {
                statusHtml = `<div class="text-secondary small">${r.tax_invoice_date || ''}</div>
                              <span class="badge bg-success">정산완료</span>
                              ${r.is_zero_tax ? '<span class="badge bg-info ms-1">영세율</span>' : ''}`;
            }
            
            const directBadge = r.is_direct ? `<span class="badge bg-secondary ms-1">직출고</span>` : '';
            return `
            <tr>
                <td class="text-center">
                    <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" onchange="app.updateBatchButton()">
                </td>
                <td>${r.date}</td>
                <td>${r.destination || ''}</td>
                <td>${itemDisplay}</td>
                <td>${r.spec} / ${r.unit}</td>
                <td class="text-danger fw-bold">${r.qty}</td>
                <td>${Number(r.outbound_price || 0).toLocaleString()}</td>
                <td>${Number(total).toLocaleString()}</td>
                <td class="text-center">${statusHtml}</td>
            </tr>
            `;
        }).join('');
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
        
        $('batchSettleBtn').style.display = (hasUnsettled && !hasSettled) ? 'inline-block' : 'none';
        $('cancelSettleBtn').style.display = (!hasUnsettled && hasSettled) ? 'inline-block' : 'none';
        $('editSettleBtn').style.display = (!hasUnsettled && hasSettled) ? 'inline-block' : 'none';
    },

    // 정산 모달
    openSettlementModal: function(isEdit = false) {
        const selected = [];
        const targetStatus = isEdit ? '정산완료' : '미정산';
        document.querySelectorAll('.row-chk:checked').forEach(el => {
            if (el.dataset.status === targetStatus) {
                const id = parseInt(el.value);
                const rowData = this.items.find(r => r.id === id);
                if (rowData) selected.push(rowData);
            }
        });
        
        if (selected.length === 0) {
            return alert(`처리할 ${targetStatus} 내역을 선택해주세요.`);
        }
        
        this.isEditMode = isEdit;
        $('selectedCount').innerText = selected.length;
        $('taxDate').value = new Date().toISOString().split('T')[0];
        $('isZeroTax').checked = false;
        
        // 테이블 렌더링
        const tbody = document.getElementById('settleModalTableBody');
        if (tbody) {
            tbody.innerHTML = selected.map(r => {
                const qty = r.qty || 0;
                const price = r.selling_price || 0;
                const settleQty = r.settlement_qty ?? qty;
                const settlePrice = r.settlement_price ?? price;
                
                return `
                    <tr data-id="${r.id}">
                        <td class="text-truncate" style="max-width: 150px;" title="${r.item}">${r.item}</td>
                        <td class="text-end">${qty.toLocaleString()}</td>
                        <td class="text-end px-1">
                            <input type="number" class="form-control form-control-sm text-end settle-qty" value="${settleQty}">
                        </td>
                        <td class="text-end">${price.toLocaleString()}</td>
                        <td class="text-end px-1">
                            <input type="number" class="form-control form-control-sm text-end settle-price" value="${settlePrice}">
                        </td>
                    </tr>
                `;
            }).join('');
        }
        
        new bootstrap.Modal(document.getElementById('settleModal')).show();
    },
    
    editSettlement: function() {
        this.openSettlementModal(true);
    },
    
    cancelSettlement: async function() {
        const selected = [];
        document.querySelectorAll('.row-chk:checked').forEach(el => {
            if (el.dataset.status === '정산완료') selected.push(parseInt(el.value));
        });
        
        if (selected.length === 0) return alert('정산 취소할 내역을 선택해주세요.');
        if (!confirm(`선택한 ${selected.length}건의 정산을 취소(미정산으로 되돌림)하시겠습니까?`)) return;
        
        try {
            await window.authFetch(`${API_BASE}/settlement/outbound`, {
                method: 'POST',
                body: JSON.stringify({
                    ids: selected,
                    tax_invoice_date: null,
                    is_zero_tax: false
                })
            });
            alert('정산 취소 처리가 완료되었습니다.');
            this.loadData();
        } catch (err) {
            alert('정산 취소 실패: ' + err.message);
        }
    },

    submitSettlement: async function() {
        const itemsToSettle = [];
        const taxDate = $('taxDate').value;
        const isZeroTax = $('isZeroTax').checked;
        
        if (!taxDate) return alert('정산 일자를 입력해주세요.');
        
        document.querySelectorAll('#settleModalTableBody tr').forEach(tr => {
            const id = parseInt(tr.dataset.id);
            const sqty = parseFloat(tr.querySelector('.settle-qty').value) || 0;
            const sprice = parseFloat(tr.querySelector('.settle-price').value) || 0;
            
            itemsToSettle.push({
                id: id,
                settlement_qty: sqty,
                settlement_price: sprice,
                tax_invoice_date: taxDate,
                is_zero_tax: isZeroTax
            });
        });
        
        if (itemsToSettle.length === 0) return;
        
        try {
            await window.authFetch(`${API_BASE}/settlement/outbound`, {
                method: 'POST',
                body: JSON.stringify({
                    items: itemsToSettle
                })
            });
            alert(`정산 ${this.isEditMode ? '수정' : '처리'}가 완료되었습니다.`);
            bootstrap.Modal.getInstance(document.getElementById('settleModal')).hide();
            this.loadData();
        } catch (err) {
            alert('처리 실패: ' + err.message);
        }
    },
    
    // 거래내역서 출력
    
    downloadSelectedExcel: async function() {
        if (this.checkedIds.size === 0) {
            alert('엑셀로 다운로드할 항목을 선택해주세요.');
            return;
        }

        const selectedRows = this.items.filter(r => this.checkedIds.has(r.id));
        if (selectedRows.length === 0) return;

        try {
            const ExcelJS = window.ExcelJS;
            if (!ExcelJS) {
                alert('엑셀 라이브러리를 불러오지 못했습니다. 페이지를 새로고침 해주세요.');
                return;
            }
            
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('유류자재공급내역');

            worksheet.columns = [
                { header: '일자', key: 'date', width: 15 },
                { header: '매출처', key: 'destination', width: 25 },
                { header: '품명', key: 'item', width: 25 },
                { header: '규격', key: 'spec', width: 15 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '수량', key: 'qty', width: 15 },
                { header: '단가', key: 'price', width: 15 },
                { header: '금액(총액)', key: 'total', width: 15 },
                { header: '상태', key: 'status', width: 15 },
                { header: '정산일자', key: 'tax_date', width: 15 },
                { header: '비고', key: 'note', width: 30 }
            ];

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            selectedRows.forEach(r => {
                worksheet.addRow({
                    date: r.date ? r.date.split('T')[0] : '',
                    destination: r.destination,
                    item: r.item,
                    spec: r.spec,
                    unit: r.unit,
                    qty: r.qty,
                    price: r.selling_price,
                    total: r.selling_price * r.qty,
                    status: r.settlement_status,
                    tax_date: r.tax_date ? r.tax_date.split('T')[0] : '',
                    note: r.note || ''
                });
            });

            worksheet.getColumn('qty').numFmt = '#,##0.00';
            worksheet.getColumn('price').numFmt = '#,##0';
            worksheet.getColumn('total').numFmt = '#,##0';

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `유류자재공급내역_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (err) {
            console.error(err);
            alert('엑셀 다운로드 중 오류가 발생했습니다.');
        }
    },

    printSelected: function() {
        const checkedBoxes = document.querySelectorAll('.row-chk:checked');
        if (checkedBoxes.length === 0) return alert('출력할 내역을 선택해주세요.');
        
        const selectedIds = Array.from(checkedBoxes).map(el => parseInt(el.value));
        const selectedItems = this.items.filter(item => selectedIds.includes(item.id));
        
        let sumTotal = 0;
        let sumVat = 0;
        let sumGrand = 0;
        
        const rowsHtml = selectedItems.map((r, index) => {
            const qtyTotal = (r.qty || 0) * (r.outbound_price || 0);
            
            let shipAmount = 0;
            let shipVat = 0;
            
            if (r.shipping_fee > 0) {
                if (r.shipping_fee_vat_included === 1) {
                    shipAmount = Math.round(r.shipping_fee / 1.1);
                    shipVat = r.shipping_fee - shipAmount;
                } else {
                    shipAmount = r.shipping_fee;
                    shipVat = Math.floor(shipAmount * 0.1);
                }
            }
            
            const total = qtyTotal + shipAmount;
            const vat = r.is_zero_tax ? 0 : (Math.floor(qtyTotal * 0.1) + shipVat);
            const grand = total + vat;
            
            sumTotal += total;
            sumVat += vat;
            sumGrand += grand;
            
            let itemHtml = `<strong>${r.item}</strong>`;
            if (r.is_direct) itemHtml += ` <span class="badge bg-secondary">직</span>`;
            if (r.shipping_fee > 0) {
                itemHtml += ` <span class="text-muted" style="font-size:0.85em;">(+배송비)</span>`;
            }
            
            return `
            <tr>
                <td>${index + 1}</td>
                <td>${r.date}</td>
                <td>${r.tax_invoice_date || '-'}</td>
                <td>${r.destination || ''}</td>
                <td>${itemHtml}</td>
                <td class="text-right">${r.qty}</td>
                <td class="text-right">${Number(r.outbound_price || 0).toLocaleString()}</td>
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
