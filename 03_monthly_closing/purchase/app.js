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
        
        // 초기 날짜 세팅 (전월 기본)
        this.applyDatePreset('전월');
        
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

        if (preset === '전월') {
            start = new Date(y, m - 1, 1);
            end = new Date(y, m, 0); // 전월 말일
        } else if (preset === '당월') {
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
            tbody.innerHTML = `<tr><td colspan="15" class="text-center py-5 text-muted">해당하는 내역이 없습니다.</td></tr>`;
            $('totalCount').innerText = 0;
            return;
        }
        
        $('totalCount').innerText = this.items.length;

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = this.items.map(r => {
            const supplyAmtOrig = (r.qty || 0) * (r.inbound_price || 0);
            const isZeroTax = !!r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            const vatOrig = isZeroTax ? 0 : Math.floor(supplyAmtOrig * 0.1);
            const totalOrig = supplyAmtOrig + vatOrig;
            let statusVal = r.settlement_status || '미정산';
            const directBadge = r.is_direct ? `<span class="badge bg-secondary ms-1">직출고</span>` : '';
            
            if (statusVal === '미정산') {
                const defaultTaxDate = r.date ? r.date.split('T')[0] : '';
                return `
                    <tr class="unsettled-row">
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted small bg-original text-center" style="border-bottom-width: 1px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">${r.supplier || ''}</td>
                        <td rowspan="2" class="align-middle fw-bold bg-original" style="max-width: 160px; font-size: 0.825rem; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.item)}">${r.item}${directBadge}</td>
                        <td rowspan="2" class="align-middle small bg-original" style="max-width: 80px; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.spec || '-')}">${r.spec || '-'}</td>
                        <td rowspan="2" class="align-middle small text-center bg-original" style="max-width: 60px; border-bottom-width: 1px;">${r.unit || '-'}</td>
                        
                        <td class="align-middle text-center bg-original text-muted fw-bold" style="font-size: 0.75rem;">입고</td>
                        <td class="align-middle bg-original small"><input type="text" class="text-center edit-input" value="${r.date.split('T')[0]}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${r.qty}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(r.inbound_price || 0).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(supplyAmtOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(vatOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small text-muted"></td>
                        
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <button class="btn btn-sm btn-primary w-100 fw-bold shadow-sm py-1" style="font-size: 0.75rem;" onclick="app.submitInlineSettlement(${r.id})">정산</button>
                        </td>
                    </tr>
                    <tr class="unsettled-row settle-input-row" data-id="${r.id}">
                        <td class="align-middle text-center bg-settle-input text-primary" style="border-left: 1px solid #dee2e6; font-size: 0.75rem;">정산</td>
                        <td class="align-middle bg-settle-input small">
                            <input type="date" class="inline-date edit-input text-center" value="${defaultTaxDate}">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-qty edit-input" value="${Number(r.qty).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, true)">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-price edit-input" value="${Number(r.inbound_price || 0).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, true)">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-supply-amt edit-input" value="${Number(supplyAmtOrig).toLocaleString()}" readonly tabindex="-1">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-vat edit-input" value="${(r.trade_type && r.trade_type !== '내수') ? 0 : Number(Math.floor((r.qty || 0) * (r.inbound_price || 0) * 0.1)).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, false)">
                        </td>
                        <td class="align-middle bg-settle-input small">
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-total-amt edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" readonly tabindex="-1">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="inline-memo edit-input" value="${r.settlement_memo || ''}" placeholder="정산 비고 입력">
                        </td>
                    </tr>
                `;
            } else {
                const supplyAmt = (r.settlement_qty || 0) * (r.settlement_price || 0);
                const isZeroTax = !!r.is_zero_tax || (r.trade_type && r.trade_type !== '내수'); // DB에 영세율 플래그가 남은 경우 하위 호환
                const vat = isZeroTax ? 0 : (r.settlement_vat !== undefined ? r.settlement_vat : Math.floor(supplyAmt * 0.1));
                const totalAmt = supplyAmt + vat;
                
                return `
                    <tr class="settled-row bg-settled-row">
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted small bg-original text-center" style="border-bottom-width: 1px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">${r.supplier || ''}</td>
                        <td rowspan="2" class="align-middle fw-bold bg-original" style="max-width: 160px; font-size: 0.825rem; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.item)}">${r.item}${directBadge}</td>
                        <td rowspan="2" class="align-middle small bg-original" style="max-width: 80px; word-break: keep-all; border-bottom-width: 1px;" title="${escapeAttr(r.spec || '-')}">${r.spec || '-'}</td>
                        <td rowspan="2" class="align-middle small text-center bg-original" style="max-width: 60px; border-bottom-width: 1px;">${r.unit || '-'}</td>
                        
                        <td class="align-middle text-center bg-original text-muted fw-bold" style="font-size: 0.75rem;">입고</td>
                        <td class="align-middle bg-original small"><input type="text" class="text-center edit-input" value="${r.date.split('T')[0]}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${r.qty}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(r.inbound_price || 0).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(supplyAmtOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(vatOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small text-muted"></td>
                        
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <span class="badge bg-success shadow-sm px-2 py-1">정산완료</span>
                        </td>
                    </tr>
                    <tr class="settled-row bg-settled-row settle-input-row" data-id="${r.id}">
                        <td class="align-middle text-center bg-settle-input text-success small fw-bold" style="border-left: 1px solid #dee2e6;">정산완료</td>
                        <td class="align-middle bg-settle-input text-center small text-dark">${r.date.split('T')[0]}</td>
                        <td class="align-middle bg-settle-input text-end small text-dark">${Number(r.settlement_qty).toLocaleString()}</td>
                        <td class="align-middle bg-settle-input text-end small text-dark">${Number(r.settlement_price).toLocaleString()}</td>
                        <td class="align-middle bg-settle-input text-end small text-dark">${Number(supplyAmt).toLocaleString()}</td>
                        <td class="align-middle bg-settle-input text-end small text-dark">${Number(vat).toLocaleString()}</td>
                        <td class="align-middle bg-settle-input text-end small fw-bold text-dark" style="color: #0f172a !important;">${Number(totalAmt).toLocaleString()}</td>
                        <td class="align-middle bg-settle-input small text-dark">${escapeAttr(r.settlement_memo || '')}</td>
                    </tr>
                `;
            }
        }).join('');
        
        // 초기 렌더링 후 모든 미정산 행에 대해 초기 계산 실행
        this.items.filter(r => (!r.settlement_status || r.settlement_status === '미정산')).forEach(r => {
            this.calcInline(r.id);
        });
        
        // 데이터가 렌더링 된 후 리사이저 이벤트 등록 (최초 1회만 등록되도록 내부에서 방어)
        this.makeTableResizable(document.getElementById('mainTable'));
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
    
    formatNumberInput: function(input) {
        let val = input.value.replace(/[^0-9-]/g, '');
        if (val === '' || val === '-') return;
        input.value = Number(val).toLocaleString();
    },
    
    makeTableResizable: function(table) {
        if (!table) return;
        const cols = table.querySelectorAll('th');
        [].forEach.call(cols, function(col) {
            if (col.querySelector('.resizer')) return; // 이미 있으면 추가 안함
            
            const resizer = document.createElement('div');
            resizer.classList.add('resizer');
            
            // set explicitly style width to allow resizing
            col.style.width = col.offsetWidth + 'px';
            
            col.appendChild(resizer);
            
            let x = 0;
            let w = 0;
            
            const mouseDownHandler = function(e) {
                x = e.clientX;
                w = col.offsetWidth;
                
                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
                resizer.classList.add('resizing');
            };
            
            const mouseMoveHandler = function(e) {
                const dx = e.clientX - x;
                col.style.width = `${w + dx}px`;
            };
            
            const mouseUpHandler = function() {
                resizer.classList.remove('resizing');
                document.removeEventListener('mousemove', mouseMoveHandler);
                document.removeEventListener('mouseup', mouseUpHandler);
            };
            
            resizer.addEventListener('mousedown', mouseDownHandler);
        });
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

    calcInline: function(id, autoCalcVat = false) {
        const container = document.querySelector(`tr.settle-input-row[data-id="${id}"]`);
        if(!container) return;
        const qtyStr = container.querySelector('.inline-qty').value.replace(/,/g, '');
        const priceStr = container.querySelector('.inline-price').value.replace(/,/g, '');
        const qty = parseFloat(qtyStr) || 0;
        const price = parseFloat(priceStr) || 0;
        const vatInput = container.querySelector('.inline-vat');
        
        const supplyAmt = qty * price;
        
        if (autoCalcVat) {
            vatInput.value = Math.floor(supplyAmt * 0.1).toLocaleString();
        }
        
        const vat = parseFloat(vatInput.value.replace(/,/g, '')) || 0;
        const total = supplyAmt + vat;
        
        const supplyAmtEl = container.querySelector('.inline-supply-amt');
        if (supplyAmtEl) supplyAmtEl.value = supplyAmt.toLocaleString();
        
        const totalAmtEl = container.querySelector('.inline-total-amt');
        if (totalAmtEl) totalAmtEl.value = total.toLocaleString();
    },
    
    applyBatchDate: function() {
        const d = $('batchSettleDate').value;
        if(!d) return alert('일괄 적용할 정산일자를 선택해주세요.');
        document.querySelectorAll('.row-chk:checked').forEach(el => {
            if(el.dataset.status === '미정산') {
                const container = el.closest('tr').nextElementSibling;
                const dateInput = container.querySelector('.inline-date');
                if(dateInput) dateInput.value = d;
            }
        });
    },

    submitInlineSettlement: async function(rowId) {
        const container = document.querySelector(`tr.settle-input-row[data-id="${rowId}"]`);
        if(!container) return;
        
        const taxDate = container.querySelector('.inline-date').value;
        const vat = parseFloat(container.querySelector('.inline-vat').value.replace(/,/g, '')) || 0;
        const isZeroTax = (vat === 0) ? 1 : 0;
        
        if(!taxDate) return alert('정산일자를 입력해주세요.');
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    items: [{
                        id: rowId,
                        tax_invoice_date: taxDate,
                        is_zero_tax: isZeroTax,
                        settlement_qty: parseFloat(container.querySelector('.inline-qty').value.replace(/,/g, '')),
                        settlement_price: parseFloat(container.querySelector('.inline-price').value.replace(/,/g, '')),
                        settlement_vat: vat,
                        settlement_memo: container.querySelector('.inline-memo').value
                    }]
                })
            });
            if (res.ok) {
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
        const items = [];
        
        checked.forEach(chk => {
            if(chk.dataset.status === '미정산') {
                const container = chk.closest('tr').nextElementSibling;
                const taxDate = container.querySelector('.inline-date').value;
                const vat = parseFloat(container.querySelector('.inline-vat').value.replace(/,/g, '')) || 0;
                const isZeroTax = (vat === 0) ? 1 : 0;
                
                items.push({
                    id: parseInt(chk.value),
                    tax_invoice_date: taxDate,
                    is_zero_tax: isZeroTax,
                    settlement_qty: parseFloat(container.querySelector('.inline-qty').value.replace(/,/g, '')),
                    settlement_price: parseFloat(container.querySelector('.inline-price').value.replace(/,/g, '')),
                    settlement_vat: vat,
                    settlement_memo: container.querySelector('.inline-memo').value
                });
            }
        });
        
        if(items.length === 0) return alert('선택된 미정산 내역이 없습니다.');
        
        if(items.some(u => !u.tax_invoice_date)) {
            return alert('정산일자가 입력되지 않은 항목이 있습니다.');
        }
        
        if(!confirm(`선택한 ${items.length}건을 일괄 정산완료 처리하시겠습니까?`)) return;
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ items }) // updates -> items
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
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, { // cancel URL 수정
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
            const isZeroTax = r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            const vat = isZeroTax ? 0 : Math.floor(total * 0.1);
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
