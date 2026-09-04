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
    currentMonth: '', // '' = 전체기간, 'YYYY-MM' = 특정 기준월
    tradeTypeFilter: 'all', // 'all' (전체) | 'outbound' (매출) | 'inbound' (매입)
    confirmFilter: 'all', // 'all' | 'unconfirmed' | 'confirmed'
    allPartners: [],
    recentPartners: [],
    selectedPartner: null, // { name, company_name, business_number, ceo_name, address, ... }
    aggregateByBizNum: false,
    currentRows: [],
    modalPartnerList: [],
    partnerModalInstance: null,
    activeAutocompleteIndex: -1,

    init: async function() {
        // 1. 기본 확정 대상월 설정 (전월 기준)
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth(); // 전월 1-12
        if (m === 0) { m = 12; y -= 1; }
        const prevMonthStr = `${y}-${String(m).padStart(2, '0')}`;
        
        // 기준월 기본값: 전체기간 (빈 문자열)
        this.currentMonth = '';
        if ($('batchTargetMonth')) $('batchTargetMonth').value = prevMonthStr;
        if ($('targetMonth')) $('targetMonth').value = '';
        this.updateMonthPresetButtons();

        // 2. 거래처 및 최근 거래처 로드
        this.loadRecentPartners();
        this.renderQuickPartnerChips();
        await this.loadAllPartners();

        // 3. 초기 상태는 거래처 미선택 (Empty State 표시)
        this.renderEmptyState();
    },

    loadRecentPartners: function() {
        try {
            const saved = localStorage.getItem('kng_recent_partners');
            if (saved) {
                this.recentPartners = JSON.parse(saved);
            } else {
                this.recentPartners = ['광림상사', '행복안전', '포에버'];
            }
        } catch (e) {
            this.recentPartners = ['광림상사', '행복안전', '포에버'];
        }
    },

    saveRecentPartner: function(partnerName) {
        if (!partnerName) return;
        this.recentPartners = [partnerName, ...this.recentPartners.filter(p => p !== partnerName)].slice(0, 6);
        try {
            localStorage.setItem('kng_recent_partners', JSON.stringify(this.recentPartners));
        } catch (e) {}
        this.renderQuickPartnerChips();
    },

    renderQuickPartnerChips: function() {
        const container = $('quickPartnerChips');
        if (!container) return;
        if (this.recentPartners.length === 0) {
            container.innerHTML = '<span class="text-muted small">최근 내역 없음</span>';
            return;
        }
        container.innerHTML = this.recentPartners.map(p => `
            <span class="partner-chip shadow-sm" onclick="app.selectPartnerByName('${p.replace(/'/g, "\\'")}')" title="${p} 바로 조회">
                ${p}
            </span>
        `).join('');
    },

    renderEmptyState: function() {
        const emptyBox = $('emptyPartnerState');
        const workArea = $('partnerWorkArea');
        const banner = $('selectedPartnerBanner');
        const clearBtn = $('clearPartnerBtn');

        if (emptyBox) emptyBox.classList.remove('d-none');
        if (workArea) workArea.classList.add('d-none');
        if (banner) banner.classList.add('d-none');
        if (clearBtn) clearBtn.classList.add('d-none');
    },

    // ── 기간/월 프리셋 관리 ──
    setMonthAll: function() {
        this.currentMonth = '';
        if ($('targetMonth')) $('targetMonth').value = '';
        this.updateMonthPresetButtons();
        if (this.selectedPartner) this.loadData();
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
        if ($('batchTargetMonth')) $('batchTargetMonth').value = this.currentMonth;
        this.updateMonthPresetButtons();
        if (this.selectedPartner) this.loadData();
    },

    onMonthChange: function() {
        const val = $('targetMonth')?.value;
        this.currentMonth = val || '';
        if (val && $('batchTargetMonth')) $('batchTargetMonth').value = val;
        this.updateMonthPresetButtons();
        if (this.selectedPartner) this.loadData();
    },

    changeMonth: function(delta) {
        let baseDate = new Date();
        if (this.currentMonth) {
            const [y, m] = this.currentMonth.split('-').map(Number);
            baseDate = new Date(y, m - 1 + delta, 1);
        }
        let nextY = baseDate.getFullYear();
        let nextM = String(baseDate.getMonth() + 1).padStart(2, '0');
        this.currentMonth = `${nextY}-${nextM}`;
        if ($('targetMonth')) $('targetMonth').value = this.currentMonth;
        if ($('batchTargetMonth')) $('batchTargetMonth').value = this.currentMonth;
        this.updateMonthPresetButtons();
        if (this.selectedPartner) this.loadData();
    },

    updateMonthPresetButtons: function() {
        const btnAll = $('btnMonthAll');
        const btnPrev = $('btnMonthPrev');
        const btnCurrent = $('btnMonthCurrent');
        if (!btnAll) return;

        btnAll.className = !this.currentMonth ? 'btn btn-primary py-0 text-white fw-bold' : 'btn btn-outline-secondary py-0';

        const now = new Date();
        const curM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        let prevY = now.getFullYear();
        let prevM = now.getMonth();
        if (prevM === 0) { prevM = 12; prevY -= 1; }
        const prevMStr = `${prevY}-${String(prevM).padStart(2, '0')}`;

        if (btnPrev) btnPrev.className = (this.currentMonth === prevMStr) ? 'btn btn-primary py-0 text-white fw-bold' : 'btn btn-outline-secondary py-0';
        if (btnCurrent) btnCurrent.className = (this.currentMonth === curM) ? 'btn btn-primary py-0 text-white fw-bold' : 'btn btn-outline-secondary py-0';
    },

    // ── 거래구분 (전체 / 매출건만 / 매입건만) 필터 ──
    setTradeTypeFilter: function(type) {
        this.tradeTypeFilter = type;
        const btnAll = $('tradeTypeAll');
        const btnSales = $('tradeTypeSales');
        const btnPurchase = $('tradeTypePurchase');

        if (btnAll) btnAll.className = (type === 'all') ? 'btn btn-primary text-white fw-bold' : 'btn btn-outline-secondary fw-bold';
        if (btnSales) btnSales.className = (type === 'outbound') ? 'btn btn-primary text-white fw-bold' : 'btn btn-outline-primary fw-bold';
        if (btnPurchase) btnPurchase.className = (type === 'inbound') ? 'btn btn-success text-white fw-bold' : 'btn btn-outline-success fw-bold';

        this.renderTable();
        this.updateKpiSummary();
    },

    // ── 확정상태 (전체 / 미확정 / 확정완료) 필터 ──
    setConfirmFilter: function(filter) {
        this.confirmFilter = filter;
        const allBtn = $('filterStatusAll');
        const unconfBtn = $('filterStatusUnconfirmed');
        const confBtn = $('filterStatusConfirmed');

        if (allBtn) allBtn.className = filter === 'all' ? 'btn btn-primary text-white fw-bold' : 'btn btn-outline-secondary fw-bold';
        if (unconfBtn) unconfBtn.className = filter === 'unconfirmed' ? 'btn btn-warning text-dark fw-bold' : 'btn btn-outline-warning text-dark fw-bold';
        if (confBtn) confBtn.className = filter === 'confirmed' ? 'btn btn-success text-white fw-bold' : 'btn btn-outline-success fw-bold';

        this.renderTable();
        this.updateKpiSummary();
    },

    onFilterChange: function() {
        if (this.selectedPartner) this.loadData();
    },

    onBizAggChange: function() {
        this.aggregateByBizNum = $('aggregateBizChk')?.checked || false;
        if (this.selectedPartner) this.loadData();
    },

    refreshCurrentView: function() {
        if (this.selectedPartner) this.loadData();
    },

    // ── 1. 거래처 데이터 로드 및 자동완성 / 키보드 탐색 / 모달 ──
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

    matchPartner: function(p, query) {
        const kw = (query || '').trim().toLowerCase();
        if (!kw) return true;
        const name = (p.name || '').toLowerCase();
        const comp = (p.company_name || '').toLowerCase();
        const ceo = (p.ceo_name || '').toLowerCase();

        // 1. 상호명, 거래처명, 대표자명 일치
        if (name.includes(kw) || comp.includes(kw) || ceo.includes(kw)) {
            return true;
        }

        // 2. 사업자번호 검색: 검색어에 숫자가 2자리 이상 포함되어 있을 때만 숫자 매칭
        const kwDigits = kw.replace(/[^0-9]/g, '');
        if (kwDigits.length >= 2) {
            const biz = (p.business_number || '').replace(/[^0-9]/g, '');
            if (biz.includes(kwDigits)) return true;
        } else if (p.business_number && p.business_number.toLowerCase().includes(kw)) {
            return true;
        }

        return false;
    },

    onPartnerFocus: function() {
        const val = $('partnerSearchInput')?.value || '';
        this.renderAutocomplete(val);
    },

    onPartnerInput: function(val) {
        this.activeAutocompleteIndex = -1;
        this.renderAutocomplete(val);
        const clearBtn = $('clearPartnerBtn');
        if (clearBtn) {
            if (val) clearBtn.classList.remove('d-none');
            else if (!this.selectedPartner) clearBtn.classList.add('d-none');
        }
    },

    handlePartnerKeydown: function(e) {
        const listEl = $('partnerAutocompleteList');
        const items = listEl ? listEl.querySelectorAll('.partner-autocomplete-item') : [];

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (items.length > 0) {
                this.activeAutocompleteIndex = (this.activeAutocompleteIndex + 1) % items.length;
                this.highlightAutocompleteItem(items);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (items.length > 0) {
                this.activeAutocompleteIndex = (this.activeAutocompleteIndex - 1 + items.length) % items.length;
                this.highlightAutocompleteItem(items);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.activeAutocompleteIndex >= 0 && items[this.activeAutocompleteIndex]) {
                items[this.activeAutocompleteIndex].click();
                return;
            }

            const kw = ($('partnerSearchInput')?.value || '').trim().toLowerCase();
            if (!kw) {
                this.openPartnerSelectModal();
                return;
            }

            // 1. 정확 일치 검사
            const exact = this.allPartners.find(p => 
                (p.name && p.name.toLowerCase() === kw) || 
                (p.company_name && p.company_name.toLowerCase() === kw)
            );
            if (exact) {
                this.selectPartner(exact);
                return;
            }

            // 2. 부분 일치 검색
            const matched = this.allPartners.filter(p => this.matchPartner(p, kw));

            if (matched.length === 1) {
                this.selectPartner(matched[0]);
            } else {
                // 여러 개 매칭되거나 없는 경우 검색 모달을 즉시 띄움
                this.openPartnerSelectModal(kw);
            }
        } else if (e.key === 'Escape') {
            if (listEl) listEl.style.display = 'none';
        }
    },

    highlightAutocompleteItem: function(items) {
        items.forEach((item, idx) => {
            if (idx === this.activeAutocompleteIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    },

    renderAutocomplete: function(query) {
        const listEl = $('partnerAutocompleteList');
        if (!listEl) return;
        const kw = (query || '').trim().toLowerCase();

        let filtered = this.allPartners;
        if (kw) {
            filtered = this.allPartners.filter(p => this.matchPartner(p, kw));
        }

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="p-2 text-muted text-center small">일치하는 거래처가 없습니다. [Enter]를 누르면 거래처 찾기가 열립니다.</div>`;
            listEl.style.display = 'block';
            return;
        }

        listEl.innerHTML = filtered.slice(0, 15).map((p, idx) => {
            const displayName = p.name || p.company_name;
            const biz = p.business_number ? ` (${p.business_number})` : '';
            const ceo = p.ceo_name ? ` · ${p.ceo_name}` : '';
            return `
                <div class="partner-autocomplete-item ${idx === this.activeAutocompleteIndex ? 'active' : ''}" onclick="app.selectPartnerByName('${displayName.replace(/'/g, "\\'")}')">
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
        const pName = partner.company_name || partner.name || '';
        this.saveRecentPartner(pName);

        const listEl = $('partnerAutocompleteList');
        if (listEl) listEl.style.display = 'none';

        const searchInput = $('partnerSearchInput');
        if (searchInput) searchInput.value = pName;

        const clearBtn = $('clearPartnerBtn');
        if (clearBtn) clearBtn.classList.remove('d-none');

        // 배너 정보 채우기
        const banner = $('selectedPartnerBanner');
        if (banner) {
            banner.classList.remove('d-none');
            $('bannerPartnerName').innerText = pName || '-';
            $('bannerBizNo').innerText = partner.business_number || '-';
            $('bannerCeo').innerText = partner.ceo_name || '-';
            $('bannerAddress').innerText = partner.address || '-';
        }

        // Empty state 숨기고 작업 영역 노출
        const emptyBox = $('emptyPartnerState');
        const workArea = $('partnerWorkArea');
        if (emptyBox) emptyBox.classList.add('d-none');
        if (workArea) workArea.classList.remove('d-none');

        // 모달이 열려있다면 닫기
        if (this.partnerModalInstance) {
            this.partnerModalInstance.hide();
        }

        this.loadData();
    },

    clearSelectedPartner: function() {
        this.selectedPartner = null;
        this.currentRows = [];

        const searchInput = $('partnerSearchInput');
        if (searchInput) searchInput.value = '';

        this.renderEmptyState();
    },

    openPartnerSelectModal: function(prefillKeyword = '') {
        const modalEl = $('partnerSelectModal');
        if (!modalEl) return;
        this.partnerModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
        
        const searchInput = $('modalPartnerSearchInput');
        if (searchInput) {
            searchInput.value = prefillKeyword || ($('partnerSearchInput')?.value || '');
        }
        this.filterModalPartners();
        this.partnerModalInstance.show();

        setTimeout(() => {
            if (searchInput) searchInput.focus();
        }, 400);
    },

    filterModalPartners: function() {
        const kw = ($('modalPartnerSearchInput')?.value || '').trim().toLowerCase();
        if (!kw) {
            this.modalPartnerList = [...this.allPartners];
        } else {
            this.modalPartnerList = this.allPartners.filter(p => this.matchPartner(p, kw));
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
                    <td class="text-center text-secondary">${p.business_number || '-'}</td>
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

    // ── 2. 품목 데이터 로드 (거래처 중심 + 매출/매입 통합) ──
    loadData: async function() {
        if (!this.selectedPartner) {
            this.renderEmptyState();
            return;
        }

        const tbody = $('mainStatusTableBody');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="16" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> [${this.selectedPartner.company_name || this.selectedPartner.name}] 거래처의 정산 내역을 불러오는 중입니다...</td></tr>`;

        try {
            const accVal = $('accountFilter')?.value || '';
            const pName = this.selectedPartner.name || this.selectedPartner.company_name;

            // 1. type=all 요청으로 매출(outbound)과 매입(inbound)을 단일 쿼리로 모두 수집
            let url = `${API_BASE}/logistics/history?type=all&settlement_status=${encodeURIComponent('정산완료')}&include_direct=true&limit=2000&sortCol=date&sortDir=asc&searchParty=${encodeURIComponent(pName)}`;
            
            // 기준월이 지정되어 있는 경우에만 settlement_month 필터 적용 (전체기간이면 파라미터 제외)
            if (this.currentMonth) {
                url += `&settlement_month=${encodeURIComponent(this.currentMonth)}`;
            }
            if (accVal) {
                url += `&settlement_account=${encodeURIComponent(accVal)}`;
            }

            // 동일 사업자번호 통합 조회 처리
            let targetPartnerNames = [pName];
            if (this.aggregateByBizNum && this.selectedPartner.business_number) {
                const bNum = this.selectedPartner.business_number.replace(/[^0-9]/g, '');
                this.allPartners.forEach(p => {
                    if (p.business_number && p.business_number.replace(/[^0-9]/g, '') === bNum) {
                        if (p.name && !targetPartnerNames.includes(p.name)) targetPartnerNames.push(p.name);
                        if (p.company_name && !targetPartnerNames.includes(p.company_name)) targetPartnerNames.push(p.company_name);
                    }
                });
            }

            const res = await window.authFetch(url);
            if (!res.ok) throw new Error('정산 내역을 불러오지 못했습니다.');
            const data = await res.json();
            let items = data.data || data.items || (Array.isArray(data) ? data : []);

            // 거래처 정확 매칭 필터링:
            // - 매출(outbound): 납품처(destination/actual_destination)가 선택 거래처인 건만
            // - 매입(inbound): 공급처(supplier)가 선택 거래처인 건만
            // (직출고로 타처에 납품된 출고건이 원공급처의 매출로 오인되지 않도록 엄격 분리)
            items = items.filter(r => {
                const party = (r.type === 'outbound') ? (r.destination || r.actual_destination) : r.supplier;
                return targetPartnerNames.some(tn => (party || '').includes(tn));
            });

            // 가장 오래된 일자가 가장 위에 오도록(오름차순 / ASC) 정렬
            items.sort((a, b) => {
                const dateA = a.date || a.tax_invoice_date || '';
                const dateB = b.date || b.tax_invoice_date || '';
                if (dateA === dateB) return (a.id || 0) - (b.id || 0);
                return dateA.localeCompare(dateB);
            });

            this.currentRows = items;
            this.updateFilterCounts();
            this.renderTable();
            this.updateKpiSummary();

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="16" class="text-center text-danger py-5">오류가 발생했습니다: ${err.message}</td></tr>`;
        }
    },

    updateFilterCounts: function() {
        const rows = this.currentRows || [];
        
        // 거래구분 건수
        const allTradeCount = rows.length;
        const salesCount = rows.filter(r => r.type === 'outbound').length;
        const purchaseCount = rows.filter(r => r.type === 'inbound').length;

        if ($('badgeTradeAll')) $('badgeTradeAll').innerText = allTradeCount.toLocaleString();
        if ($('badgeTradeSales')) $('badgeTradeSales').innerText = salesCount.toLocaleString();
        if ($('badgeTradePurchase')) $('badgeTradePurchase').innerText = purchaseCount.toLocaleString();

        // 현재 tradeTypeFilter가 적용된 기준에서의 확정/미확정 건수
        let tradeFiltered = rows;
        if (this.tradeTypeFilter === 'outbound') tradeFiltered = rows.filter(r => r.type === 'outbound');
        else if (this.tradeTypeFilter === 'inbound') tradeFiltered = rows.filter(r => r.type === 'inbound');

        const allCount = tradeFiltered.length;
        const unconfCount = tradeFiltered.filter(r => !r.settlement_month).length;
        const confCount = tradeFiltered.filter(r => !!r.settlement_month).length;

        if ($('badgeFilterAll')) $('badgeFilterAll').innerText = allCount.toLocaleString();
        if ($('badgeFilterUnconfirmed')) $('badgeFilterUnconfirmed').innerText = unconfCount.toLocaleString();
        if ($('badgeFilterConfirmed')) $('badgeFilterConfirmed').innerText = confCount.toLocaleString();
    },

    getFilteredRows: function() {
        if (!this.currentRows) return [];
        let list = this.currentRows;

        // 1. 거래구분 필터
        if (this.tradeTypeFilter === 'outbound') {
            list = list.filter(r => r.type === 'outbound');
        } else if (this.tradeTypeFilter === 'inbound') {
            list = list.filter(r => r.type === 'inbound');
        }

        // 2. 확정상태 필터
        if (this.confirmFilter === 'unconfirmed') {
            list = list.filter(r => !r.settlement_month);
        } else if (this.confirmFilter === 'confirmed') {
            list = list.filter(r => !!r.settlement_month);
        }

        return list;
    },

    renderTable: function() {
        const tbody = $('mainStatusTableBody');
        const tfoot = $('mainStatusTableFoot');
        if (!tbody) return;

        // 헤더 체크박스 초기화
        if ($('checkAllTable')) $('checkAllTable').checked = false;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = false;
        this.updateSelectedCountBadge();

        const rows = this.getFilteredRows();

        if (rows.length === 0) {
            let msg = '';
            if (this.confirmFilter === 'unconfirmed') msg = '미확정된 정산 내역이 없습니다.';
            else if (this.confirmFilter === 'confirmed') msg = '확정 완료된 정산 내역이 없습니다.';
            else msg = `${this.currentMonth ? '[' + this.currentMonth + ']에 ' : ''}등록된 정산 내역이 없습니다.`;

            const targetName = this.selectedPartner ? `[${this.selectedPartner.company_name || this.selectedPartner.name}] 거래처의 ` : '';
            tbody.innerHTML = `<tr><td colspan="16" class="text-center py-5 text-muted">${targetName}${msg}</td></tr>`;
            if (tfoot) tfoot.innerHTML = '';
            return;
        }

        // 품목별 정수화 및 누적 차분 부가세 배분 로직 적용 (소수점 제거 및 합계 100% 일치 보장)
        const { items, totalQty, totalSupply, totalVat, totalGrand } = this.computeAmounts(rows);

        tbody.innerHTML = items.map((item, idx) => {
            const { r, isSales, qty, price, supply, vat, grand } = item;

            // 확정 상태 판별
            const isConfirmed = !!r.settlement_month;
            const statusBadge = isConfirmed
                ? `<span class="badge badge-confirmed" title="확정월: ${r.settlement_month}"><i class='bx bx-check-circle'></i> ${r.settlement_month} 확정</span>`
                : `<span class="badge badge-unconfirmed" title="아직 확정되지 않은 정산 건입니다"><i class='bx bx-time-five'></i> 미확정</span>`;

            // 구분 배지 (매출 vs 매입)
            const typeBadge = isSales
                ? `<span class="badge badge-sales"><i class='bx bx-export'></i> 매출</span>`
                : `<span class="badge badge-purchase"><i class='bx bx-import'></i> 매입</span>`;

            // 상대처 명 (매출: 납품처/현장, 매입: 매입처)
            const partyName = isSales ? (r.destination || r.actual_destination || '-') : (r.supplier || '-');

            return `
                <tr>
                    <td class="text-center">
                        <input class="form-check-input item-chk" type="checkbox" value="${r.id}" data-type="${r.type}" data-confirmed="${isConfirmed ? '1' : '0'}" onchange="app.onItemCheckChange()">
                    </td>
                    <td class="text-center text-muted small">${idx + 1}</td>
                    <td class="text-center text-nowrap">${typeBadge}</td>
                    <td class="text-center small text-nowrap ${isSales ? 'text-primary' : 'text-success'} fw-semibold">${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'}</td>
                    <td class="text-start fw-bold text-dark text-truncate" style="max-width: 135px;" title="${partyName}">${partyName}</td>
                    <td class="text-center small text-nowrap"><span class="badge bg-light text-dark border">${r.settlement_account || '-'}</span></td>
                    <td class="text-start">
                        <strong>${r.item}</strong>
                        ${r.is_direct ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.68rem;">직출</span>` : ''}
                    </td>
                    <td class="text-center text-muted small">${r.spec || '-'}</td>
                    <td class="text-center text-muted small text-nowrap">${r.unit || '-'}</td>
                    <td class="text-end small text-nowrap">${qty.toLocaleString()}</td>
                    <td class="text-end small text-nowrap">${price.toLocaleString()}원</td>
                    <td class="text-end small text-nowrap">${supply.toLocaleString()}원</td>
                    <td class="text-end text-muted small text-nowrap">${vat.toLocaleString()}원</td>
                    <td class="text-end fw-bold text-nowrap ${isSales ? 'text-primary' : 'text-success'} small">${grand.toLocaleString()}원</td>
                    <td class="text-center text-nowrap">${statusBadge}</td>
                    <td class="text-start small text-muted text-truncate" style="max-width: 120px;" title="${r.settlement_memo || ''}">${r.settlement_memo || '-'}</td>
                </tr>
            `;
        }).join('');

        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center">합 계 (총 ${rows.length.toLocaleString()}건)</td>
                    <td class="text-end text-nowrap">${totalQty.toLocaleString()}</td>
                    <td></td>
                    <td class="text-end text-nowrap">${totalSupply.toLocaleString()}원</td>
                    <td class="text-end text-nowrap">${totalVat.toLocaleString()}원</td>
                    <td class="text-end text-dark fw-bold text-nowrap">${totalGrand.toLocaleString()}원</td>
                    <td colspan="2"></td>
                </tr>
            `;
        }
    },

    // ── 금액 계산 공통 헬퍼: 품목 정수화 및 누적 차분 부가세 배분 (합계 일치 보장) ──
    computeAmounts: function(rows) {
        if (!rows || rows.length === 0) {
            return { items: [], totalQty: 0, totalSupply: 0, totalVat: 0, totalGrand: 0 };
        }

        let totalQty = 0;
        let totalSupply = 0;

        // 1단계: 품목별 정수 공급가액 산출 (소수점 반올림)
        const initial = rows.map(r => {
            const isSales = (r.type === 'outbound');
            const qty = Number(r.settlement_qty || r.qty || 0);
            const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
            const ship = Number(r.shipping_fee || 0);
            const shipVatInc = (r.shipping_fee_vat_included === 1);

            let shipSupply = ship;
            if (ship > 0 && shipVatInc) shipSupply = Math.round(ship / 1.1);

            const supply = Math.round(qty * price) + shipSupply;
            totalQty += qty;
            totalSupply += supply;

            const isTaxFree = !!r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            return { r, isSales, qty, price, ship, shipSupply, shipVatInc, supply, isTaxFree };
        });

        // 2단계: 누적 차분 방식 부가세 배분 (국세청 전자세금계산서 표준)
        let accumTaxableSupply = 0;
        let accumVat = 0;
        let totalVat = 0;
        let totalGrand = 0;

        const items = initial.map(item => {
            const { r, supply, isTaxFree } = item;
            let vat = 0;

            if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                vat = Math.round(Number(r.settlement_vat));
                accumVat += vat;
                if (!isTaxFree) accumTaxableSupply += supply;
            } else if (!isTaxFree) {
                accumTaxableSupply += supply;
                const targetAccumVat = Math.floor(accumTaxableSupply * 0.1);
                vat = Math.max(0, targetAccumVat - accumVat);
                accumVat = Math.max(accumVat, targetAccumVat);
            }

            const grand = supply + vat;
            totalVat += vat;
            totalGrand += grand;

            return {
                ...item,
                vat,
                grand
            };
        });

        return { items, totalQty, totalSupply, totalVat, totalGrand };
    },

    updateKpiSummary: function() {
        const rows = this.getFilteredRows();
        const salesRows = rows.filter(r => r.type === 'outbound');
        const purchaseRows = rows.filter(r => r.type === 'inbound');

        const salesCalc = this.computeAmounts(salesRows);
        const purchaseCalc = this.computeAmounts(purchaseRows);

        const salesGrand = salesCalc.totalGrand;
        const purchaseGrand = purchaseCalc.totalGrand;

        const salesBox = $('kpiSalesBox');
        const purchaseBox = $('kpiPurchaseBox');
        const salesAmt = $('kpiSalesAmt');
        const purchaseAmt = $('kpiPurchaseAmt');
        const totalLabel = $('kpiTotalLabel');
        const totalAmt = $('kpiTotalAmt');

        if (this.tradeTypeFilter === 'outbound') {
            if (salesBox) salesBox.classList.remove('d-none');
            if (purchaseBox) purchaseBox.classList.add('d-none');
            if (salesAmt) salesAmt.innerText = `${salesGrand.toLocaleString()}원`;
            if (totalLabel) totalLabel.innerHTML = `청구합계: <span class="text-primary">${salesGrand.toLocaleString()}원</span>`;
        } else if (this.tradeTypeFilter === 'inbound') {
            if (salesBox) salesBox.classList.add('d-none');
            if (purchaseBox) purchaseBox.classList.remove('d-none');
            if (purchaseAmt) purchaseAmt.innerText = `${purchaseGrand.toLocaleString()}원`;
            if (totalLabel) totalLabel.innerHTML = `매입합계: <span class="text-success">${purchaseGrand.toLocaleString()}원</span>`;
        } else {
            // 전체보기
            if (salesBox) salesBox.classList.remove('d-none');
            if (purchaseBox) purchaseBox.classList.remove('d-none');
            if (salesAmt) salesAmt.innerText = `${salesGrand.toLocaleString()}원`;
            if (purchaseAmt) purchaseAmt.innerText = `${purchaseGrand.toLocaleString()}원`;
            const netDiff = salesGrand - purchaseGrand;
            if (totalLabel) totalLabel.innerHTML = `순청구(차액): <span class="${netDiff >= 0 ? 'text-primary' : 'text-danger'} fw-bold">${netDiff.toLocaleString()}원</span>`;
        }
    },

    // ── 3. 체크박스 및 선택 관리 ──
    onCheckAllChange: function(checked) {
        document.querySelectorAll('.item-chk').forEach(chk => chk.checked = checked);
        if ($('checkAllTable')) $('checkAllTable').checked = checked;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = checked;
        this.updateSelectedCountBadge();
    },

    toggleCheckAllRows: function(checked) {
        document.querySelectorAll('.item-chk').forEach(chk => chk.checked = checked);
        if ($('checkAllTable')) $('checkAllTable').checked = checked;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = checked;
        this.updateSelectedCountBadge();
    },

    checkAllUnconfirmed: function() {
        document.querySelectorAll('.item-chk').forEach(chk => {
            chk.checked = (chk.dataset.confirmed === '0');
        });
        this.onItemCheckChange();
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
        const checkedBoxes = Array.from(document.querySelectorAll('.item-chk:checked'));
        const count = checkedBoxes.length;
        if ($('selectedCountBadge')) $('selectedCountBadge').innerText = `선택 ${count}건`;

        let sum = 0;
        checkedBoxes.forEach(chk => {
            const id = parseInt(chk.value);
            const r = this.currentRows.find(x => x.id === id);
            if (r) {
                const isSales = (r.type === 'outbound');
                const qty = Number(r.settlement_qty || r.qty || 0);
                const price = Number(r.settlement_price || (isSales ? r.outbound_price : r.inbound_price) || 0);
                const ship = Number(r.shipping_fee || 0);
                const shipVatInc = r.shipping_fee_vat_included === 1;
                let shipSupply = (ship > 0 && shipVatInc) ? Math.round(ship / 1.1) : ship;
                const supply = (qty * price) + shipSupply;
                let vat = 0;
                if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                    vat = r.settlement_vat;
                } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                    const itemVat = Math.floor(qty * price * 0.1);
                    let shipVat = (ship > 0) ? (shipVatInc ? (ship - shipSupply) : Math.floor(ship * 0.1)) : 0;
                    vat = itemVat + shipVat;
                }
                sum += (supply + vat);
            }
        });

        const sumBadge = $('selectedSumBadge');
        if (sumBadge) {
            if (count > 0) {
                sumBadge.innerText = `선택 합계: ${sum.toLocaleString()}원`;
                sumBadge.classList.remove('d-none');
            } else {
                sumBadge.classList.add('d-none');
            }
        }
    },

    // ── 4. 확정 및 확정취소(미확정 전환) 실행 ──
    confirmSelectedMonth: async function() {
        const checkedBoxes = Array.from(document.querySelectorAll('.item-chk:checked'));
        if (checkedBoxes.length === 0) return alert('확정할 항목을 선택해주세요.');

        const targetMonth = $('batchTargetMonth')?.value || this.currentMonth;
        if (!targetMonth) return alert('확정 대상월(YYYY-MM)을 선택해주세요.');

        if (!confirm(`선택한 ${checkedBoxes.length}건을 [${targetMonth}]로 확정하시겠습니까?`)) {
            return;
        }

        const outboundIds = checkedBoxes.filter(chk => chk.dataset.type === 'outbound').map(chk => parseInt(chk.value));
        const inboundIds = checkedBoxes.filter(chk => chk.dataset.type === 'inbound').map(chk => parseInt(chk.value));

        try {
            const promises = [];
            if (outboundIds.length > 0) {
                promises.push(window.authFetch(`${API_BASE}/logistics/settlement/outbound`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'update_month',
                        ids: outboundIds,
                        settlement_month: targetMonth
                    })
                }));
            }
            if (inboundIds.length > 0) {
                promises.push(window.authFetch(`${API_BASE}/logistics/settlement/inbound`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'update_month',
                        ids: inboundIds,
                        settlement_month: targetMonth
                    })
                }));
            }

            const responses = await Promise.all(promises);
            for (let res of responses) {
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '확정 처리에 실패했습니다.');
                }
            }

            alert(`${checkedBoxes.length}건이 [${targetMonth}]로 확정되었습니다.`);
            this.loadData();
        } catch (err) {
            console.error(err);
            alert(`오류: ${err.message}`);
        }
    },

    cancelConfirmationSelected: async function() {
        const checkedBoxes = Array.from(document.querySelectorAll('.item-chk:checked'));
        if (checkedBoxes.length === 0) return alert('확정을 취소할 항목을 선택해주세요.');

        if (!confirm(`선택한 ${checkedBoxes.length}건의 확정을 취소하고 [미확정] 상태로 되돌리시겠습니까?`)) {
            return;
        }

        const outboundIds = checkedBoxes.filter(chk => chk.dataset.type === 'outbound').map(chk => parseInt(chk.value));
        const inboundIds = checkedBoxes.filter(chk => chk.dataset.type === 'inbound').map(chk => parseInt(chk.value));

        try {
            const promises = [];
            if (outboundIds.length > 0) {
                promises.push(window.authFetch(`${API_BASE}/logistics/settlement/outbound`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'update_month',
                        ids: outboundIds,
                        settlement_month: '' // 미확정
                    })
                }));
            }
            if (inboundIds.length > 0) {
                promises.push(window.authFetch(`${API_BASE}/logistics/settlement/inbound`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        action: 'update_month',
                        ids: inboundIds,
                        settlement_month: '' // 미확정
                    })
                }));
            }

            const responses = await Promise.all(promises);
            for (let res of responses) {
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '확정 취소 처리에 실패했습니다.');
                }
            }

            alert(`${checkedBoxes.length}건이 미확정 상태로 변경되었습니다.`);
            this.loadData();
        } catch (err) {
            console.error(err);
            alert(`오류: ${err.message}`);
        }
    },

    // ── 5. 청구서 및 매입정산내역 인쇄 (A4 포맷) ──
    printInvoice: function() {
        if (this.tradeTypeFilter === 'outbound') {
            this.printInvoiceWithType('outbound');
        } else if (this.tradeTypeFilter === 'inbound') {
            this.printInvoiceWithType('inbound');
        } else {
            // 전체보기 상태인 경우 매출건/매입건 존재 여부 확인
            const rows = this.getFilteredRows();
            const hasSales = rows.some(r => r.type === 'outbound');
            const hasPurchases = rows.some(r => r.type === 'inbound');

            if (hasSales && !hasPurchases) {
                this.printInvoiceWithType('outbound');
            } else if (!hasSales && hasPurchases) {
                this.printInvoiceWithType('inbound');
            } else if (hasSales && hasPurchases) {
                if (confirm('현재 매출건과 매입건이 모두 조회되어 있습니다.\n\n[확인]을 누르면 "매출 청구서"를 인쇄하고,\n[취소]를 누르면 "매입정산내역"을 인쇄합니다.')) {
                    this.printInvoiceWithType('outbound');
                } else {
                    this.printInvoiceWithType('inbound');
                }
            } else {
                alert('인쇄할 품목 내역이 없습니다.');
            }
        }
    },

    printInvoiceWithType: function(type) {
        let rowsToPrint = this.getFilteredRows().filter(r => r.type === type);
        if (rowsToPrint.length === 0) {
            alert(`인쇄할 ${type === 'outbound' ? '매출 청구' : '매입정산'} 내역이 없습니다.`);
            return;
        }

        const isSales = (type === 'outbound');
        const partnerName = this.selectedPartner ? (this.selectedPartner.company_name || this.selectedPartner.name) : '거래처';
        const partnerObj = this.selectedPartner || { name: partnerName };

        // 기간 및 타이틀 설정
        let periodStr = this.currentMonth ? `${this.currentMonth.split('-')[0]}년 ${parseInt(this.currentMonth.split('-')[1], 10)}월` : '전체';
        const titleText = isSales ? `${periodStr} 청구서` : `${periodStr} 매입정산내역`;

        $('printTitle').innerText = this.aggregateByBizNum ? `(사업자 통합) ${titleText}` : titleText;
        $('printBillingMonth').innerText = isSales ? `청구월: ${periodStr}` : `정산월: ${periodStr}`;

        // 회사 및 거래처 정보 세팅
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

        // 품목 행 렌더링 (computeAmounts 공통 헬퍼로 정수화 및 누적 차분 부가세 배분 적용)
        const { items, totalQty, totalSupply, totalVat, totalGrand } = this.computeAmounts(rowsToPrint);

        const tbody = $('printTableBody');
        tbody.innerHTML = items.map(item => {
            const { r, qty, price, supply, vat, grand } = item;
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
        $('printAmountKor').innerText = `합 계 금 액 : 금 ${numberToKorean(totalGrand)} 원 정`;
        $('printAmountNum').innerText = `(₩ ${totalGrand.toLocaleString()})`;

        const tfoot = $('printTableFoot');
        tfoot.innerHTML = `
            <tr style="font-weight: bold; background-color: #f9f9f9;">
                <td colspan="4">합 계</td>
                <td>${totalQty.toLocaleString()}</td>
                <td></td>
                <td></td>
                <td style="text-align: right; padding-right: 4px !important;">${totalSupply.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px !important;">${totalVat.toLocaleString()}</td>
                <td style="text-align: right; padding-right: 4px !important;">${totalGrand.toLocaleString()}</td>
                <td></td>
            </tr>
        `;

        window.print();
    },

    // ── 6. 엑셀 다운로드 ──
    downloadExcel: function() {
        const exportRows = this.getFilteredRows();
        if (exportRows.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const partnerName = this.selectedPartner ? (this.selectedPartner.company_name || this.selectedPartner.name) : '전체';
        const { items } = this.computeAmounts(exportRows);

        const excelData = items.map((item, idx) => {
            const { r, isSales, qty, price, supply, vat, grand } = item;

            return {
                'No': idx + 1,
                '구분': isSales ? '매출' : '매입',
                '발생일자': r.date ? r.date.split('T')[0] : '',
                '정산일자': r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '',
                '상대처/납품처': isSales ? (r.destination || r.actual_destination || '') : (r.supplier || ''),
                '자재계정': r.settlement_account || '',
                '품목명': r.item || '',
                '규격': r.spec || '',
                '단위': r.unit || '',
                '수량': qty,
                '단가': price,
                '공급가액': supply,
                '세액': vat,
                '합계금액': grand,
                '확정상태': r.settlement_month ? `${r.settlement_month} 확정` : '미확정',
                '비고': r.settlement_memo || ''
            };
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '월간현황정산내역');

        const tradeLabel = (this.tradeTypeFilter === 'outbound') ? '_매출' : ((this.tradeTypeFilter === 'inbound') ? '_매입' : '_통합');
        const monthLabel = this.currentMonth || '전체기간';
        const fileName = `${monthLabel}_${partnerName}${tradeLabel}_정산현황.xlsx`;
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
