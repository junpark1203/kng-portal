const API_BASE = 'https://kng.junparks.com/api/logistics';

const $ = id => document.getElementById(id);

const app = {
    currentStatus: '미정산', // 기본: 미정산
    currentDatePreset: 'prevMonth',
    currentPage: 1,
    limit: 50,
    items: [],
    totalItems: 0,
    currentSummary: null,
    currentSortCol: 'date',
    currentSortDir: 'asc',
    subSearchKeyword: '',

    init: function() {
        // 체크박스 헤더
        $('checkAllHeader').addEventListener('change', this.onCheckAllHeaderChange.bind(this));
        
        // 정렬 헤더 UI 초기화 (오름차순 화살표)
        this.updateSortHeaderUI();

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
            startDate = '';
            endDate = '';
        }

        if ($('startDate')) $('startDate').value = startDate;
        if ($('endDate')) $('endDate').value = endDate;

        this.updatePresetButtons(preset);
        this.resetPageAndLoadData();
    },

    updatePresetButtons: function(activePreset) {
        ['prevMonth', 'thisMonth', 'prevYear', 'thisYear', 'all'].forEach(p => {
            const btn = $(`btnPreset_${p}`);
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

        return '';
    },

    onDateInputChange: function() {
        const start = $('startDate') ? $('startDate').value : '';
        const end = $('endDate') ? $('endDate').value : '';
        const detected = this.detectDatePreset(start, end);
        this.currentDatePreset = detected;
        this.updatePresetButtons(detected);
        this.resetPageAndLoadData();
    },

    onSearchInputKeyup: function(e) {
        const val = $('searchInput') ? $('searchInput').value : '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) {
            if (val.length > 0) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        if (e.key === 'Enter') {
            this.resetPageAndLoadData();
        }
    },

    clearSearchInput: function() {
        if ($('searchInput')) $('searchInput').value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.resetPageAndLoadData();
    },

    onSearchTargetChange: function() {
        if ($('searchInput') && $('searchInput').value.trim()) {
            this.resetPageAndLoadData();
        }
    },

    clearFilter: function(key) {
        if (key === 'date') {
            this.setDatePreset('all');
        } else if (key === 'search') {
            this.clearSearchInput();
        } else if (key === 'status') {
            if ($('statusFilter')) $('statusFilter').value = '전체보기';
            this.resetPageAndLoadData();
        } else if (key === 'account') {
            if ($('accountFilter')) $('accountFilter').value = '';
            this.resetPageAndLoadData();
        }
    },

    resetSearch: function() {
        this.currentDatePreset = 'all';
        this.updatePresetButtons('all');
        if ($('startDate')) $('startDate').value = '';
        if ($('endDate')) $('endDate').value = '';
        if ($('accountFilter')) $('accountFilter').value = '';
        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('searchInput')) $('searchInput').value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        if ($('statusFilter')) $('statusFilter').value = '미정산';
        this.resetPageAndLoadData();
    },

    resetPageAndLoadData: function() {
        this.currentPage = 1;
        this.loadData();
    },

    loadData: async function() {
        try {
            const startDate = $('startDate')?.value || '';
            const endDate = $('endDate')?.value || '';
            const searchKeyword = $('searchInput') ? $('searchInput').value.trim() : '';
            const searchTarget = $('searchTarget')?.value || '';
            const statusVal = $('statusFilter')?.value || '미정산';
            const accountVal = $('accountFilter')?.value || '';
            this.currentStatus = statusVal;
            this.limit = parseInt($('limitSelect')?.value, 10) || 50;

            const clearBtn = $('clearSearchBtn');
            if (clearBtn) {
                if (searchKeyword.length > 0) clearBtn.classList.remove('d-none');
                else clearBtn.classList.add('d-none');
            }

            const url = new URL(`${API_BASE}/history`);
            url.searchParams.append('type', 'inbound');
            url.searchParams.append('include_direct', 'true');
            url.searchParams.append('page', this.currentPage);
            url.searchParams.append('limit', this.limit);
            
            if (statusVal && statusVal !== '전체보기') {
                url.searchParams.append('settlement_status', statusVal);
            }
            if (accountVal) {
                url.searchParams.append('settlement_account', accountVal);
            }
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (searchTarget) url.searchParams.append('searchTarget', searchTarget);
            if (searchKeyword) url.searchParams.append('searchKeyword', searchKeyword);
            if (this.currentSortCol) url.searchParams.append('sortCol', this.currentSortCol);
            if (this.currentSortDir) url.searchParams.append('sortDir', this.currentSortDir);

            $('dataTableBody').innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> 데이터를 불러오는 중입니다...</td></tr>`;

            const res = await window.authFetch(url.toString());
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `서버 응답 오류 (${res.status})`);
            }
            const result = await res.json();
            
            this.items = result.data || [];
            this.totalItems = result.total || 0;
            this.currentSummary = result.summary || null;
            
            // 화면 렌더링
            this.updateSortHeaderUI();
            this.renderFilteredTable();
            this.updatePagination();
            this.renderSummaryStrip(result.summary);
            this.renderActiveFilterChips();
            
            // UI 초기화
            $('checkAllHeader').checked = false;
            this.updateBatchButton();
            
        } catch (err) {
            console.error('Purchase data load error:', err);
            $('dataTableBody').innerHTML = `<tr><td colspan="17" class="text-center text-danger py-5">데이터 로드에 실패했습니다. (${err.message || '네트워크/서버 오류'})</td></tr>`;
        }
    },

    renderActiveFilterChips: function() {
        const container = $('activeFilterChipsContainer');
        if (!container) return;

        const statusVal = $('statusFilter')?.value || '미정산';
        const accountVal = $('accountFilter')?.value || '';
        const startDate = $('startDate')?.value || '';
        const endDate = $('endDate')?.value || '';
        const searchTarget = $('searchTarget')?.value || '';
        const searchKeyword = $('searchInput')?.value.trim() || '';

        let chips = [];

        // 1. 상태 필터
        if (statusVal && statusVal !== '전체보기') {
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal">상태:</span> <strong>${statusVal}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('status')" title="해제"></i>
                </span>
            `);
        }

        // 2. 자재계정 필터
        if (accountVal) {
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-category'></i> 계정:</span> <strong>${accountVal}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('account')" title="해제"></i>
                </span>
            `);
        }

        // 3. 날짜 필터
        if (startDate || endDate) {
            let dateLabel = '';
            if (this.currentDatePreset && this.currentDatePreset !== 'all') {
                const presetLabels = { prevMonth: '전월', thisMonth: '당월', prevYear: '전년도', thisYear: '금년도' };
                dateLabel = `${presetLabels[this.currentDatePreset]} (${startDate} ~ ${endDate})`;
            } else {
                dateLabel = `${startDate || '~'} ~ ${endDate || '~'}`;
            }
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-calendar'></i> 기간:</span> <strong>${dateLabel}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('date')" title="해제"></i>
                </span>
            `);
        }

        // 4. 검색어 필터
        if (searchKeyword) {
            const targetLabels = {
                supplier: '매입처', item: '품목명', spec: '규격', note: '비고', tx_id: '고유번호'
            };
            const targetName = targetLabels[searchTarget] || '전체';
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-search'></i> ${targetName}:</span> <strong>"${searchKeyword}"</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('search')" title="해제"></i>
                </span>
            `);
        }

        if (chips.length > 0) {
            container.innerHTML = `
                <span class="text-secondary me-1"><i class='bx bx-filter-alt'></i> <strong>활성 조건:</strong></span>
                ${chips.join('')}
                <button class="btn btn-link btn-sm text-danger p-0 ms-2 text-decoration-none" onclick="app.resetSearch()" style="font-size:0.78rem;">
                    <i class='bx bx-reset'></i> 전체 초기화
                </button>
            `;
            container.classList.remove('d-none');
        } else {
            container.innerHTML = '';
            container.classList.add('d-none');
        }
    },

    renderSummaryStrip: function(summary) {
        const strip = $('purchaseSummaryStrip');
        if (!strip) return;

        if (!summary) {
            strip.innerHTML = `<span class="text-muted">통계 집계 없음</span>`;
            return;
        }

        const totalCount = summary.totalCount || 0;
        const totalQty = summary.totalQty || 0;
        const inbound = summary.inbound || { supplyAmt: 0, vat: 0, totalAmt: 0 };
        const b = summary.breakdown || {};
        const safeGen = b.safetyGeneral || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const safeEnv = b.safetyEnv || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const misc = b.misc || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const etc = b.etc || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const mall = b.mall || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const unclass = b.unclassified || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const safeTotalCount = (safeGen.count || 0) + (safeEnv.count || 0);
        const safeTotalSupply = (safeGen.supplyAmt || 0) + (safeEnv.supplyAmt || 0);

        strip.innerHTML = `
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pb-2 border-bottom">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span class="text-secondary"><strong>검색 결과</strong></span>
                    <span class="badge bg-dark px-2 py-1">${totalCount.toLocaleString()}건</span>
                    <span class="text-muted ms-1 me-1">|</span>
                    <span class="text-muted">총 수량:</span>
                    <strong class="text-dark">${totalQty.toLocaleString()}</strong>
                </div>
                <div class="d-flex align-items-center gap-3 flex-wrap">
                    <div><span class="text-muted">매입 공급가:</span> <strong class="text-dark">${inbound.supplyAmt.toLocaleString()}원</strong></div>
                    <div><span class="text-muted">부가세:</span> <strong class="text-secondary">${inbound.vat.toLocaleString()}원</strong></div>
                    <div class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1" style="font-size:0.85rem;">
                        매입 합계: <strong class="fs-6">${inbound.totalAmt.toLocaleString()}</strong>원
                    </div>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap" style="font-size: 0.79rem;">
                <span class="text-secondary fw-bold me-1">계정별 집계:</span>
                <span class="badge bg-primary text-white px-2 py-1 d-inline-flex align-items-center gap-1 shadow-sm">
                    안전자재 통합: <strong>${safeTotalCount}건</strong> (${safeTotalSupply.toLocaleString()}원)
                </span>
                <span class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1 d-inline-flex align-items-center gap-1">
                    안전(일반): <strong>${safeGen.count}건</strong> (${safeGen.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1 d-inline-flex align-items-center gap-1">
                    안전(환경): <strong>${safeEnv.count}건</strong> (${safeEnv.supplyAmt.toLocaleString()}원)
                </span>
                <span class="text-muted mx-1">|</span>
                <span class="badge bg-warning bg-opacity-10 text-dark border border-warning px-2 py-1 d-inline-flex align-items-center gap-1">
                    잡자재: <strong>${misc.count}건</strong> (${misc.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary px-2 py-1 d-inline-flex align-items-center gap-1">
                    기타자재: <strong>${etc.count}건</strong> (${etc.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge bg-info bg-opacity-10 text-info border border-info px-2 py-1 d-inline-flex align-items-center gap-1">
                    쇼핑몰: <strong>${mall.count}건</strong> (${mall.supplyAmt.toLocaleString()}원)
                </span>
                ${unclass.count > 0 ? `
                <span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-2 py-1 d-inline-flex align-items-center gap-1">
                    미분류: <strong>${unclass.count}건</strong> (계정 지정 필요)
                </span>
                ` : ''}
            </div>
        `;
    },

    handleSort: function(col) {
        if (this.currentSortCol === col) {
            this.currentSortDir = this.currentSortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSortCol = col;
            this.currentSortDir = 'asc';
        }
        this.updateSortHeaderUI();
        this.sortItems();
        this.renderFilteredTable();
    },

    updateSortHeaderUI: function() {
        document.querySelectorAll('#mainTable thead th.sortable').forEach(th => {
            const col = th.dataset.col;
            const icon = th.querySelector('.sort-icon');
            if (col === this.currentSortCol) {
                th.classList.add('active-sort');
                if (icon) {
                    icon.className = `bx bx-sort-${this.currentSortDir === 'asc' ? 'up' : 'down'} sort-icon`;
                }
            } else {
                th.classList.remove('active-sort');
                if (icon) {
                    icon.className = 'bx bx-sort sort-icon';
                }
            }
        });
    },

    sortItems: function() {
        const col = this.currentSortCol;
        const dir = this.currentSortDir === 'asc' ? 1 : -1;
        
        this.items.sort((a, b) => {
            let valA, valB;
            if (col === 'qty') {
                valA = Number(a.settlement_qty ?? a.qty) || 0;
                valB = Number(b.settlement_qty ?? b.qty) || 0;
            } else if (col === 'inbound_price') {
                valA = Number(a.settlement_price ?? a.inbound_price) || 0;
                valB = Number(b.settlement_price ?? b.inbound_price) || 0;
            } else if (col === 'inbound_total') {
                const priceA = Number(a.settlement_price ?? a.inbound_price) || 0;
                const qtyA = Number(a.settlement_qty ?? a.qty) || 0;
                valA = priceA * qtyA;
                const priceB = Number(b.settlement_price ?? b.inbound_price) || 0;
                const qtyB = Number(b.settlement_qty ?? b.qty) || 0;
                valB = priceB * qtyB;
            } else {
                valA = (a[col] || '').toString().toLowerCase();
                valB = (b[col] || '').toString().toLowerCase();
            }
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
    },

    onSubSearchInput: function(val) {
        this.subSearchKeyword = (val || '').trim().toLowerCase();
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) {
            if (this.subSearchKeyword) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        this.renderFilteredTable();
    },

    clearSubSearch: function() {
        const input = $('subSearchInput');
        if (input) input.value = '';
        this.onSubSearchInput('');
    },

    renderFilteredTable: function() {
        let displayList = this.items;
        if (this.subSearchKeyword) {
            const kw = this.subSearchKeyword;
            displayList = this.items.filter(r => {
                return (
                    (r.transaction_group_id && r.transaction_group_id.toLowerCase().includes(kw)) ||
                    (r.supplier && r.supplier.toLowerCase().includes(kw)) ||
                    (r.destination && r.destination.toLowerCase().includes(kw)) ||
                    (r.item && r.item.toLowerCase().includes(kw)) ||
                    (r.spec && r.spec.toLowerCase().includes(kw)) ||
                    (r.settlement_account && r.settlement_account.toLowerCase().includes(kw)) ||
                    (r.settlement_memo && r.settlement_memo.toLowerCase().includes(kw)) ||
                    (r.date && r.date.toLowerCase().includes(kw)) ||
                    (r.tax_invoice_date && r.tax_invoice_date.toLowerCase().includes(kw))
                );
            });
        }
        
        const countBadge = $('subSearchCountBadge');
        if (countBadge) {
            if (this.subSearchKeyword) {
                countBadge.innerText = `필터 결과: ${displayList.length}건`;
                countBadge.classList.remove('d-none');
            } else {
                countBadge.classList.add('d-none');
            }
        }
        
        this.renderTable(displayList);
    },

    renderTable: function(data) {
        const itemsToRender = data || this.items;
        const tbody = $('dataTableBody');
        if (itemsToRender.length === 0) {
            tbody.innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted">해당하는 내역이 없습니다.</td></tr>`;
            $('totalCount').innerText = 0;
            return;
        }
        
        $('totalCount').innerText = itemsToRender.length;

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = itemsToRender.map(r => {
            const qtyTotal = (r.qty || 0) * (r.inbound_price || 0);
            let shipAmount = 0;
            if (r.shipping_fee > 0) {
                shipAmount = r.shipping_fee_vat_included === 1 
                             ? Math.round(r.shipping_fee / 1.1) 
                             : r.shipping_fee;
            }
            const supplyAmtOrig = qtyTotal + shipAmount;
            const isZeroTax = !!r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            let vatOrig = 0;
            if (!isZeroTax) {
                const itemVat = Math.floor(qtyTotal * 0.1);
                let shipVat = 0;
                if (r.shipping_fee > 0) {
                    shipVat = r.shipping_fee_vat_included === 1 ? (r.shipping_fee - shipAmount) : Math.floor(shipAmount * 0.1);
                }
                vatOrig = itemVat + shipVat;
            }
            const totalOrig = supplyAmtOrig + vatOrig;
            
            let itemDisplay = `<strong>${r.item}</strong>`;
            if (r.is_direct) itemDisplay += `<span class="badge bg-secondary ms-1">직출고</span>`;
            if (r.shipping_fee > 0) {
                const shipVatText = r.shipping_fee_vat_included === 1 ? '(부가세 포함)' : '(공급가 기준)';
                itemDisplay += `<div class="small text-muted mt-1">+ 배송비 ${r.shipping_fee.toLocaleString()}원 ${shipVatText}</div>`;
            }
            
            let statusVal = r.settlement_status || '미정산';

            let accountBadge = `<span class="badge bg-light text-muted border px-2 py-1" style="font-size: 0.77rem;">-</span>`;
            if (r.settlement_account === '안전자재-일반') {
                accountBadge = `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1" style="font-size: 0.77rem;">안전(일반)</span>`;
            } else if (r.settlement_account === '안전자재-환경') {
                accountBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1" style="font-size: 0.77rem;">안전(환경)</span>`;
            } else if (r.settlement_account === '잡자재') {
                accountBadge = `<span class="badge bg-warning bg-opacity-10 text-dark border border-warning px-2 py-1" style="font-size: 0.77rem;">잡자재</span>`;
            } else if (r.settlement_account === '기타자재') {
                accountBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary px-2 py-1" style="font-size: 0.77rem;">기타자재</span>`;
            } else if (r.settlement_account === '쇼핑몰') {
                accountBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info px-2 py-1" style="font-size: 0.77rem;">쇼핑몰</span>`;
            }
            
            if (statusVal === '미정산') {
                const defaultTaxDate = r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : (r.date ? r.date.split('T')[0] : '');
                const defaultSettleMonth = r.settlement_month || (defaultTaxDate ? defaultTaxDate.substring(0, 7) : '');
                return `
                    <tr class="unsettled-row">
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" data-account="${r.settlement_account || ''}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted bg-original text-center" style="border-bottom-width: 1px; font-size: 0.73rem; color: #64748b; letter-spacing: -0.2px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">${r.supplier || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.destination || '')}">
                            ${r.destination ? `<span class="text-primary fw-semibold" style="font-size: 0.8rem;">${escapeAttr(r.destination)}</span>` : `<span class="text-muted small">-</span>`}
                        </td>
                        <td rowspan="2" class="align-middle fw-bold bg-original" style="max-width: 160px; font-size: 0.825rem; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.item)}">${itemDisplay}</td>
                        <td rowspan="2" class="align-middle small bg-original" style="max-width: 90px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.spec || '-')}">${r.spec || '-'}</td>
                        <td rowspan="2" class="align-middle small text-center bg-original" style="max-width: 50px; border-bottom-width: 1px;">${r.unit || '-'}</td>
                        <td rowspan="2" class="align-middle text-center bg-original p-1" style="max-width: 125px; border-bottom-width: 1px;">
                            <select class="form-select form-select-sm inline-account fw-bold border-secondary-subtle shadow-sm" style="font-size: 0.78rem; height: 28px !important; padding: 2px 4px !important;" onchange="app.changeInlineAccount(${r.id}, this)">
                                <option value="">-- 계정 선택 --</option>
                                <optgroup label="안전자재">
                                    <option value="안전자재-일반" ${r.settlement_account==='안전자재-일반'?'selected':''}>안전(일반)</option>
                                    <option value="안전자재-환경" ${r.settlement_account==='안전자재-환경'?'selected':''}>안전(환경)</option>
                                </optgroup>
                                <option value="잡자재" ${r.settlement_account==='잡자재'?'selected':''}>잡자재</option>
                                <option value="기타자재" ${r.settlement_account==='기타자재'?'selected':''}>기타자재</option>
                                <option value="쇼핑몰" ${r.settlement_account==='쇼핑몰'?'selected':''}>쇼핑몰</option>
                            </select>
                        </td>
                        
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
                    <tr class="unsettled-row settle-input-row" data-id="${r.id}" data-shipamt="${shipAmount}" data-shipfee="${r.shipping_fee || 0}" data-shipvatinc="${r.shipping_fee_vat_included || 0}">
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
                            <input type="text" class="text-end inline-vat edit-input" value="${Number(vatOrig).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, false)">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-total-amt edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" readonly tabindex="-1">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="inline-memo edit-input" value="${r.settlement_memo || ''}" placeholder="정산 비고 입력">
                        </td>
                    </tr>
                `;
            } else {
                const supplyAmt = (r.settlement_qty || 0) * (r.settlement_price || 0) + shipAmount;
                let vat = 0;
                
                if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                    vat = r.settlement_vat;
                } else if (r.is_zero_tax || (r.trade_type && r.trade_type !== '내수')) {
                    vat = 0;
                } else {
                    const itemVat = Math.floor((r.settlement_qty || 0) * (r.settlement_price || 0) * 0.1);
                    let shipVat = 0;
                    if (r.shipping_fee > 0) {
                        shipVat = r.shipping_fee_vat_included === 1 
                                  ? r.shipping_fee - shipAmount 
                                  : Math.floor(shipAmount * 0.1);
                    }
                    vat = itemVat + shipVat;
                }
                const totalAmt = supplyAmt + vat;
                
                return `
                    <tr class="settled-row bg-settled-row">
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" data-account="${r.settlement_account || ''}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted bg-original text-center" style="border-bottom-width: 1px; font-size: 0.73rem; color: #64748b; letter-spacing: -0.2px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">${r.supplier || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.destination || '')}">
                            ${r.destination ? `<span class="text-primary fw-semibold" style="font-size: 0.8rem;">${escapeAttr(r.destination)}</span>` : `<span class="text-muted small">-</span>`}
                        </td>
                        <td rowspan="2" class="align-middle fw-bold bg-original" style="max-width: 160px; font-size: 0.825rem; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.item)}">${itemDisplay}</td>
                        <td rowspan="2" class="align-middle small bg-original" style="max-width: 90px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.spec || '-')}">${r.spec || '-'}</td>
                        <td rowspan="2" class="align-middle small text-center bg-original" style="max-width: 50px; border-bottom-width: 1px;">${r.unit || '-'}</td>
                        <td rowspan="2" class="align-middle text-center bg-original p-1" style="max-width: 125px; border-bottom-width: 1px;">
                            ${accountBadge}
                        </td>
                        
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
                    <tr class="settled-row bg-settled-row settle-input-row" data-id="${r.id}" data-shipamt="${shipAmount}" data-shipfee="${r.shipping_fee || 0}" data-shipvatinc="${r.shipping_fee_vat_included || 0}">
                        <td class="align-middle text-center bg-settle-input text-success small fw-bold" style="border-left: 1px solid #dee2e6;">정산완료</td>
                        <td class="align-middle bg-settle-input text-center small text-dark">${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : r.date.split('T')[0]}</td>
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
        itemsToRender.filter(r => (!r.settlement_status || r.settlement_status === '미정산')).forEach(r => {
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
        let selectedSum = 0;
        
        checkedBoxes.forEach(el => {
            if (el.dataset.status === '미정산') hasUnsettled = true;
            if (el.dataset.status === '정산완료') hasSettled = true;

            const rowId = el.value;
            const inputRow = document.querySelector(`tr.settle-input-row[data-id="${rowId}"]`);
            if (inputRow) {
                const totalInput = inputRow.querySelector('.inline-total-amt');
                if (totalInput && totalInput.value) {
                    selectedSum += parseFloat(totalInput.value.replace(/,/g, '')) || 0;
                } else {
                    const totalCell = inputRow.querySelector('td:nth-child(7)');
                    if (totalCell) {
                        selectedSum += parseFloat(totalCell.innerText.replace(/,/g, '')) || 0;
                    }
                }
            }
        });
        
        $('batchSettleBtn').style.display = hasUnsettled ? 'inline-block' : 'none';
        $('batchDateContainer').style.display = hasUnsettled ? 'flex' : 'none';
        $('batchAccountContainer').style.display = checkedBoxes.length > 0 ? 'flex' : 'none';
        $('cancelSettleBtn').style.display = hasSettled ? 'inline-block' : 'none';
        
        const allChecks = document.querySelectorAll('.row-chk');
        $('checkAllHeader').checked = allChecks.length > 0 && checkedBoxes.length === allChecks.length;

        // 선택 카운트 및 합계 뱃지 갱신
        const countBadge = $('selectedCountBadge');
        if (countBadge) countBadge.innerText = `선택 ${checkedBoxes.length}건`;

        const sumBadge = $('selectedSumBadge');
        if (sumBadge) {
            if (checkedBoxes.length > 0) {
                sumBadge.innerText = `선택 합계: ${Math.round(selectedSum).toLocaleString()}원`;
                sumBadge.classList.remove('d-none');
            } else {
                sumBadge.classList.add('d-none');
            }
        }
    },

    checkAllUnclassified: function() {
        let count = 0;
        document.querySelectorAll('.row-chk').forEach(el => {
            const acc = el.dataset.account;
            if (!acc || acc === '') {
                el.checked = true;
                count++;
            } else {
                el.checked = false;
            }
        });
        $('checkAllHeader').checked = false;
        this.updateBatchButton();
        if (count === 0) alert('현재 목록에 미분류 항목이 없습니다.');
    },

    applyBatchAccount: async function() {
        const accountVal = $('batchAccountSelect')?.value;
        if (!accountVal) return alert('일괄 적용할 자재계정을 선택해주세요.');

        const checkedBoxes = Array.from(document.querySelectorAll('.row-chk:checked'));
        if (checkedBoxes.length === 0) return alert('자재계정을 적용할 대상을 먼저 선택해주세요.');

        const ids = [];
        checkedBoxes.forEach(chk => {
            const tr = chk.closest('tr');
            const select = tr ? tr.querySelector('.inline-account') : null;
            if (select) select.value = accountVal;
            chk.dataset.account = accountVal;
            ids.push(parseInt(chk.value));
        });

        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'update_account',
                    ids: ids,
                    settlement_account: accountVal
                })
            });
            if (res.ok) {
                this.loadData();
            } else {
                alert('자재계정 일괄 변경에 실패했습니다.');
            }
        } catch (err) {
            console.error(err);
            alert('자재계정 변경 중 오류가 발생했습니다.');
        }
    },

    showToast: function(msg) {
        let toast = document.getElementById('accountToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'accountToast';
            toast.style.cssText = 'position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: #f8fafc; padding: 8px 16px; border-radius: 6px; font-size: 0.82rem; font-weight: 600; box-shadow: 0 4px 12px rgba(0,0,0,0.18); z-index: 9999; transition: opacity 0.25s ease, transform 0.25s ease; opacity: 0; transform: translateY(10px); pointer-events: none;';
            document.body.appendChild(toast);
        }
        toast.innerText = msg;
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
        }, 1800);
    },

    changeInlineAccount: async function(rowId, selectEl) {
        const accountVal = selectEl.value;
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    action: 'update_account',
                    ids: [rowId],
                    settlement_account: accountVal
                })
            });
            if (res.ok) {
                const chk = document.querySelector(`input.row-chk[value="${rowId}"]`);
                if (chk) chk.dataset.account = accountVal;
                
                const item = this.items.find(it => it.id == rowId);
                if (item) item.settlement_account = accountVal;

                selectEl.classList.remove('border-secondary-subtle');
                selectEl.classList.add('border-success');
                setTimeout(() => {
                    selectEl.classList.remove('border-success');
                    selectEl.classList.add('border-secondary-subtle');
                }, 1200);

                this.showToast(accountVal ? `자재계정이 '${accountVal}'(으)로 자동 저장되었습니다.` : '자재계정 분류가 해제되었습니다.');
                this.refreshSummaryOnly();
            } else {
                alert('자재계정 자동 저장에 실패했습니다.');
            }
        } catch (err) {
            console.error('changeInlineAccount error:', err);
        }
    },

    refreshSummaryOnly: async function() {
        try {
            const startDate = $('startDate')?.value || '';
            const endDate = $('endDate')?.value || '';
            const searchKeyword = $('searchInput') ? $('searchInput').value.trim() : '';
            const searchTarget = $('searchTarget')?.value || '';
            const statusVal = $('statusFilter')?.value || '미정산';
            const accountVal = $('accountFilter')?.value || '';

            const url = new URL(`${API_BASE}/history`);
            url.searchParams.append('type', 'inbound');
            url.searchParams.append('page', 1);
            url.searchParams.append('limit', 1);
            if (statusVal && statusVal !== '전체보기') url.searchParams.append('settlement_status', statusVal);
            if (accountVal) url.searchParams.append('settlement_account', accountVal);
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (searchTarget) url.searchParams.append('searchTarget', searchTarget);
            if (searchKeyword) url.searchParams.append('searchKeyword', searchKeyword);

            const res = await window.authFetch(url.toString());
            const result = await res.json();
            if (result && result.summary) {
                this.renderSummaryStrip(result.summary);
            }
        } catch (e) {
            console.error('refreshSummaryOnly error:', e);
        }
    },

    calcInline: function(id, autoCalcVat = false) {
        const container = document.querySelector(`tr.settle-input-row[data-id="${id}"]`);
        if(!container) return;
        const qtyStr = container.querySelector('.inline-qty').value.replace(/,/g, '');
        const priceStr = container.querySelector('.inline-price').value.replace(/,/g, '');
        const qty = parseFloat(qtyStr) || 0;
        const price = parseFloat(priceStr) || 0;
        const vatInput = container.querySelector('.inline-vat');
        
        const shipAmount = parseFloat(container.dataset.shipamt) || 0;
        const shipFee = parseFloat(container.dataset.shipfee) || 0;
        const shipVatInc = parseInt(container.dataset.shipvatinc) || 0;

        const itemSupplyAmt = qty * price;
        const supplyAmt = itemSupplyAmt + shipAmount;
        
        if (autoCalcVat) {
            let itemVat = Math.floor(itemSupplyAmt * 0.1);
            let shipVat = 0;
            if (shipFee > 0) {
                shipVat = shipVatInc === 1 ? shipFee - shipAmount : Math.floor(shipAmount * 0.1);
            }
            
            // 내수가 아니면 VAT 0원
            const rowData = this.items.find(item => item.id == id);
            if (rowData && rowData.trade_type && rowData.trade_type !== '내수') {
                itemVat = 0;
                shipVat = 0;
            }
            vatInput.value = (itemVat + shipVat).toLocaleString();
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
                if(dateInput) {
                    dateInput.value = d;
                }
            }
        });
    },

    submitInlineSettlement: async function(rowId) {
        const tr = document.querySelector(`input.row-chk[value="${rowId}"]`)?.closest('tr');
        const container = document.querySelector(`tr.settle-input-row[data-id="${rowId}"]`);
        if(!container || !tr) return;
        
        const accountSelect = tr.querySelector('.inline-account');
        const accountVal = accountSelect ? accountSelect.value : '';
        if (!accountVal) {
            alert('정산 처리를 위해 먼저 자재계정(안전자재 / 잡자재 등)을 선택해주세요.');
            if (accountSelect) {
                accountSelect.focus();
                accountSelect.classList.add('border-danger', 'bg-danger-subtle');
                setTimeout(() => accountSelect.classList.remove('border-danger', 'bg-danger-subtle'), 2000);
            }
            return;
        }

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
                        settlement_account: accountVal,
                        tax_invoice_date: taxDate,
                        settlement_month: taxDate.substring(0, 7),
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
                const errJson = await res.json().catch(() => ({}));
                alert(errJson.error || '정산 처리에 실패했습니다.');
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
                const tr = chk.closest('tr');
                const accountSelect = tr ? tr.querySelector('.inline-account') : null;
                const accountVal = accountSelect ? accountSelect.value : '';
                const container = tr ? tr.nextElementSibling : null;
                if (!container) return;

                const taxDate = container.querySelector('.inline-date').value;
                const vat = parseFloat(container.querySelector('.inline-vat').value.replace(/,/g, '')) || 0;
                const isZeroTax = (vat === 0) ? 1 : 0;
                
                items.push({
                    id: parseInt(chk.value),
                    settlement_account: accountVal,
                    tax_invoice_date: taxDate,
                    settlement_month: taxDate ? taxDate.substring(0, 7) : '',
                    is_zero_tax: isZeroTax,
                    settlement_qty: parseFloat(container.querySelector('.inline-qty').value.replace(/,/g, '')),
                    settlement_price: parseFloat(container.querySelector('.inline-price').value.replace(/,/g, '')),
                    settlement_vat: vat,
                    settlement_memo: container.querySelector('.inline-memo').value
                });
            }
        });
        
        if(items.length === 0) return alert('선택된 미정산 내역이 없습니다.');
        
        if(items.some(u => !u.settlement_account)) {
            return alert('자재계정(안전자재 / 잡자재 등)이 선택되지 않은 항목이 있습니다.\n먼저 자재계정을 선택해주세요.');
        }

        if(items.some(u => !u.tax_invoice_date)) {
            return alert('정산일자가 입력되지 않은 항목이 있습니다.');
        }
        
        if(!confirm(`선택한 ${items.length}건을 일괄 정산완료 처리하시겠습니까?`)) return;
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ items })
            });
            if (res.ok) {
                this.loadData();
            } else {
                const errJson = await res.json().catch(() => ({}));
                alert(errJson.error || '일괄 정산 처리에 실패했습니다.');
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
            const res = await window.authFetch(`${API_BASE}/settlement/inbound`, {
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
        
        let sumTotal = 0;
        let sumVat = 0;
        let sumGrand = 0;
        
        const rowsHtml = selectedItems.map((r, index) => {
            const isSettled = r.settlement_status === '정산완료';
            const qty = isSettled ? (r.settlement_qty || 0) : (r.qty || 0);
            const price = isSettled ? (r.settlement_price || 0) : (r.inbound_price || 0);
            
            let shipAmount = 0;
            if (r.shipping_fee > 0) {
                shipAmount = r.shipping_fee_vat_included === 1 ? Math.round(r.shipping_fee / 1.1) : r.shipping_fee;
            }
            const total = qty * price + shipAmount;
            const isZeroTax = r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            let vat = 0;
            if (!isZeroTax) {
                const itemVat = Math.floor(qty * price * 0.1);
                let shipVat = 0;
                if (r.shipping_fee > 0) {
                    shipVat = r.shipping_fee_vat_included === 1 ? (r.shipping_fee - shipAmount) : Math.floor(shipAmount * 0.1);
                }
                vat = (isSettled && r.settlement_vat !== undefined && r.settlement_vat !== null) ? r.settlement_vat : (itemVat + shipVat);
            }
            const grand = total + vat;
            
            sumTotal += total;
            sumVat += vat;
            sumGrand += grand;
            
            return `
            <tr>
                <td>${index + 1}</td>
                <td>입고</td>
                <td>${r.date ? r.date.split('T')[0] : ''}</td>
                <td>${r.supplier || ''}</td>
                <td>${r.settlement_account || '-'}</td>
                <td>${r.item}</td>
                <td>${r.spec || ''} / ${r.unit || ''}</td>
                <td class="text-right">${qty.toLocaleString()}</td>
                <td class="text-right">${Number(price).toLocaleString()}</td>
                <td class="text-right">${Number(total).toLocaleString()}</td>
                <td class="text-right">${Number(vat).toLocaleString()}</td>
                <td class="text-right fw-bold">${Number(grand).toLocaleString()}</td>
                <td>${r.memo || ''}</td>
            </tr>
            `;
        }).join('');
        
        const printHtml = `
            <table class="print-table" style="width:100%; border:none;">
                <thead>
                    <tr>
                        <td colspan="13" style="border:none; padding: 15mm 0 15px 0;">
                            <div class="print-header" style="text-align:center; margin-bottom:0;">
                                <h2 style="margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 10px; display: inline-block;">거래내역서 (매입)</h2>
                                <div style="text-align:right; font-size:12px; margin-top:10px;">출력일시: ${new Date().toLocaleString()}</div>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <th style="width:40px;">No.</th>
                        <th>구분</th>
                        <th>발생일자</th>
                        <th>거래처</th>
                        <th>자재계정</th>
                        <th>품명</th>
                        <th>규격/단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>공급가액</th>
                        <th>부가세</th>
                        <th>합계금액</th>
                        <th>비고</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tbody style="border-top: 2px solid #000;">
                    <tr>
                        <td colspan="9" style="border: 2px solid #000; background-color: #f8f9fa; font-weight: bold; text-align: center; font-size: 14px; letter-spacing: 5px;">[ 합 계 ]</td>
                        <td class="text-right" style="background-color:#f8f9fa; font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumTotal).toLocaleString()}</td>
                        <td class="text-right" style="background-color:#f8f9fa; font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumVat).toLocaleString()}</td>
                        <td class="text-right" style="background-color:#e9ecef; font-weight:bold; border: 2px solid #000; font-size:14px; padding:10px;">${Number(sumGrand).toLocaleString()}</td>
                        <td style="border: 2px solid #000; background-color: #f8f9fa;"></td>
                    </tr>
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="13" style="border:none; height: 15mm; padding: 0;"></td>
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

