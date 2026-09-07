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

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const $ = id => document.getElementById(id);

const app = {
    dateType: 'settlement', // 'settlement' (정산일자) | 'transaction' (입출고일자) | 'confirmed_month' (확정월)
    startDate: '', // 'YYYY-MM-DD'
    endDate: '', // 'YYYY-MM-DD'
    confirmedMonth: '', // 'YYYY-MM'
    currentMonth: '', // 레거시 호환
    tradeTypeFilter: 'all', // 'all' (전체) | 'outbound' (매출) | 'inbound' (매입)
    confirmFilter: 'all', // 'all' | 'unconfirmed' | 'confirmed'
    directPartnerFilter: '', // 직출 연계처 필터 ('' = 전체, '__GENERAL__' = 일반/본사창고, 또는 특정 연계처명)
    subSearchKeyword: '', // 결과 내 검색어 (연계처, 품목명, 규격, 비고 등)
    subSearchTimer: null,
    allPartners: [],
    recentPartners: [],
    selectedPartner: null, // { name, company_name, business_number, ceo_name, address, ... }
    aggregateByBizNum: false,
    currentRows: [],
    modalPartnerList: [],
    partnerModalInstance: null,
    activeAutocompleteIndex: -1,

    formatDate: function(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    },

    getPeriodLabel: function() {
        if (this.dateType === 'confirmed_month') {
            return this.confirmedMonth ? `${this.confirmedMonth} 확정월` : '전체 확정월';
        }
        if (this.startDate && this.endDate) {
            if (this.startDate === this.endDate) return this.startDate;
            return `${this.startDate} ~ ${this.endDate}`;
        }
        if (this.startDate) return `${this.startDate} ~`;
        if (this.endDate) return `~ ${this.endDate}`;
        return '전체기간';
    },

    init: async function() {
        // 1. 기본 일자 설정 (정산일자 기본, 전체기간)
        this.dateType = 'settlement';
        this.startDate = '';
        this.endDate = '';
        if ($('dateTypeSelect')) $('dateTypeSelect').value = 'settlement';
        if ($('startDate')) $('startDate').value = '';
        if ($('endDate')) $('endDate').value = '';
        this.updateDatePresetUI();

        // 날짜 자동보정 리스너 등록
        this.attachDateAutoCorrection($('startDate'));
        this.attachDateAutoCorrection($('endDate'));

        // 확정 대상월 및 확정월 기본값 (전월)
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth(); // 전월 1-12
        if (m === 0) { m = 12; y -= 1; }
        const prevMonthStr = `${y}-${String(m).padStart(2, '0')}`;
        this.confirmedMonth = prevMonthStr;
        if ($('targetMonth')) $('targetMonth').value = prevMonthStr;
        if ($('batchTargetMonth')) $('batchTargetMonth').value = prevMonthStr;
        this.updateConfirmedMonthPresetUI();

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

    showToast: function(msg) {
        let toast = document.getElementById('monthlyToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'monthlyToast';
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

    attachDateAutoCorrection: function(inputEl) {
        if (!inputEl) return;
        inputEl._typedDigits = '';
        inputEl._lastValidValue = inputEl.value || '';

        inputEl.addEventListener('focus', () => {
            inputEl._typedDigits = '';
            if (inputEl.value) inputEl._lastValidValue = inputEl.value;
        });

        inputEl.addEventListener('keydown', (e) => {
            if (e.key >= '0' && e.key <= '9') {
                inputEl._typedDigits = (inputEl._typedDigits || '') + e.key;
                clearTimeout(inputEl._typedTimer);
                inputEl._typedTimer = setTimeout(() => { inputEl._typedDigits = ''; }, 4000);
            } else if (e.key === 'Backspace') {
                inputEl._typedDigits = (inputEl._typedDigits || '').slice(0, -1);
            }
        });

        inputEl.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
            const match = text.match(/(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/);
            if (match) {
                e.preventDefault();
                const y = parseInt(match[1], 10);
                const m = parseInt(match[2], 10);
                const d = parseInt(match[3], 10);
                if (m >= 1 && m <= 12) {
                    const maxDay = new Date(y, m, 0).getDate();
                    const clamped = Math.min(d, maxDay);
                    const pad = n => String(n).padStart(2, '0');
                    const val = `${y}-${pad(m)}-${pad(clamped)}`;
                    inputEl.value = val;
                    inputEl._lastValidValue = val;
                    inputEl._typedDigits = '';
                    if (d > maxDay) {
                        this.showToast(`${y}년 ${m}월은 ${maxDay}일까지 있으므로 ${val}로 자동 보정되었습니다.`);
                    }
                    this.onDateRangeChange();
                }
            }
        });

        inputEl.addEventListener('blur', () => {
            this.checkAndCorrectDate(inputEl);
        });
    },

    checkAndCorrectDate: function(inputEl) {
        if (!inputEl) return '';
        if (inputEl.value) {
            inputEl._lastValidValue = inputEl.value;
            return inputEl.value;
        }
        if (inputEl.validity && inputEl.validity.badInput) {
            const raw = (inputEl._typedDigits || '').replace(/\D/g, '');
            let y, m, d;
            if (raw.length >= 8) {
                const maybeY = parseInt(raw.slice(0, 4), 10);
                if (maybeY >= 1900 && maybeY <= 2100) {
                    y = maybeY;
                    m = parseInt(raw.slice(4, 6), 10);
                    d = parseInt(raw.slice(6, 8), 10);
                }
            } else if (inputEl._lastValidValue) {
                const parts = inputEl._lastValidValue.split('-');
                if (parts.length === 3) {
                    y = parseInt(parts[0], 10);
                    m = parseInt(parts[1], 10);
                    d = raw.length >= 2 ? parseInt(raw.slice(-2), 10) : 31;
                }
            }
            if (y && m && m >= 1 && m <= 12) {
                const maxDay = new Date(y, m, 0).getDate();
                if (d && d > maxDay) {
                    const pad = n => String(n).padStart(2, '0');
                    const val = `${y}-${pad(m)}-${pad(maxDay)}`;
                    inputEl.value = val;
                    inputEl._lastValidValue = val;
                    inputEl._typedDigits = '';
                    this.showToast(`${y}년 ${m}월은 ${maxDay}일까지 있으므로 ${val}로 자동 보정되었습니다.`);
                    this.onDateRangeChange();
                    return val;
                }
            }
        }
        return inputEl.value || '';
    },

    // ── 기간/일자 기준 관리 ──
    onDateTypeChange: function() {
        this.dateType = $('dateTypeSelect')?.value || 'settlement';
        const isMonthMode = (this.dateType === 'confirmed_month');
        
        const rangeCtrl = $('dateRangeControl');
        const monthCtrl = $('monthPickerControl');
        if (rangeCtrl && monthCtrl) {
            if (isMonthMode) {
                rangeCtrl.classList.add('d-none');
                rangeCtrl.classList.remove('d-flex');
                monthCtrl.classList.remove('d-none');
                monthCtrl.classList.add('d-flex');
            } else {
                monthCtrl.classList.add('d-none');
                monthCtrl.classList.remove('d-flex');
                rangeCtrl.classList.remove('d-none');
                rangeCtrl.classList.add('d-flex');
            }
        }
        if (this.selectedPartner) this.loadData();
    },

    onDateRangeChange: function() {
        const startEl = $('startDate');
        const endEl = $('endDate');

        // 입력 중이거나 불완전한 상태에서는 조회를 실행하지 않고 사용자 입력을 기다림
        if ((startEl && startEl.validity && startEl.validity.badInput) ||
            (endEl && endEl.validity && endEl.validity.badInput)) {
            return;
        }

        this.startDate = startEl?.value || '';
        this.endDate = endEl?.value || '';
        this.updateDatePresetUI();
        if (this.selectedPartner) this.loadData();
    },

    setDatePreset: function(preset) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth(); // 0-11
        if (preset === 'prev') {
            const firstDay = new Date(y, m - 1, 1);
            const lastDay = new Date(y, m, 0);
            this.startDate = this.formatDate(firstDay);
            this.endDate = this.formatDate(lastDay);
            if ($('batchTargetMonth')) $('batchTargetMonth').value = this.startDate.substring(0, 7);
        } else if (preset === 'current') {
            const firstDay = new Date(y, m, 1);
            const lastDay = new Date(y, m + 1, 0);
            this.startDate = this.formatDate(firstDay);
            this.endDate = this.formatDate(lastDay);
            if ($('batchTargetMonth')) $('batchTargetMonth').value = this.startDate.substring(0, 7);
        } else {
            // 'all'
            this.startDate = '';
            this.endDate = '';
        }
        if ($('startDate')) $('startDate').value = this.startDate;
        if ($('endDate')) $('endDate').value = this.endDate;
        this.updateDatePresetUI();
        if (this.selectedPartner) this.loadData();
    },

    updateDatePresetUI: function() {
        const btnPrev = $('btnPresetPrev');
        const btnCurrent = $('btnPresetCurrent');
        const btnAll = $('btnPresetAll');
        if (!btnPrev || !btnCurrent || !btnAll) return;

        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        const prevStart = this.formatDate(new Date(y, m - 1, 1));
        const prevEnd = this.formatDate(new Date(y, m, 0));
        const curStart = this.formatDate(new Date(y, m, 1));
        const curEnd = this.formatDate(new Date(y, m + 1, 0));

        const isAll = !this.startDate && !this.endDate;
        const isPrev = (this.startDate === prevStart && this.endDate === prevEnd);
        const isCur = (this.startDate === curStart && this.endDate === curEnd);

        btnAll.className = isAll ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
        btnPrev.className = isPrev ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
        btnCurrent.className = isCur ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
    },

    onConfirmedMonthChange: function() {
        this.confirmedMonth = $('targetMonth')?.value || '';
        if (this.confirmedMonth && $('batchTargetMonth')) {
            $('batchTargetMonth').value = this.confirmedMonth;
        }
        this.updateConfirmedMonthPresetUI();
        if (this.selectedPartner) this.loadData();
    },

    changeConfirmedMonth: function(delta) {
        let baseDate = new Date();
        if (this.confirmedMonth) {
            const [y, m] = this.confirmedMonth.split('-').map(Number);
            baseDate = new Date(y, m - 1 + delta, 1);
        }
        const nextY = baseDate.getFullYear();
        const nextM = String(baseDate.getMonth() + 1).padStart(2, '0');
        this.confirmedMonth = `${nextY}-${nextM}`;
        if ($('targetMonth')) $('targetMonth').value = this.confirmedMonth;
        if ($('batchTargetMonth')) $('batchTargetMonth').value = this.confirmedMonth;
        this.updateConfirmedMonthPresetUI();
        if (this.selectedPartner) this.loadData();
    },

    setConfirmedMonthPreset: function(preset) {
        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth(); // 0-11
        if (preset === 'prev') {
            let prevY = y;
            let prevM = m;
            if (prevM === 0) { prevM = 12; prevY -= 1; }
            this.confirmedMonth = `${prevY}-${String(prevM).padStart(2, '0')}`;
        } else if (preset === 'current') {
            this.confirmedMonth = `${y}-${String(m + 1).padStart(2, '0')}`;
        } else {
            // 'all'
            this.confirmedMonth = '';
        }
        if ($('targetMonth')) $('targetMonth').value = this.confirmedMonth;
        if (this.confirmedMonth && $('batchTargetMonth')) $('batchTargetMonth').value = this.confirmedMonth;
        this.updateConfirmedMonthPresetUI();
        if (this.selectedPartner) this.loadData();
    },

    updateConfirmedMonthPresetUI: function() {
        const btnPrev = $('btnMonthPresetPrev');
        const btnCurrent = $('btnMonthPresetCurrent');
        const btnAll = $('btnMonthPresetAll');
        if (!btnPrev || !btnCurrent || !btnAll) return;

        const now = new Date();
        let y = now.getFullYear();
        let m = now.getMonth();
        let prevY = y;
        let prevM = m;
        if (prevM === 0) { prevM = 12; prevY -= 1; }
        const prevStr = `${prevY}-${String(prevM).padStart(2, '0')}`;
        const curStr = `${y}-${String(m + 1).padStart(2, '0')}`;

        btnAll.className = !this.confirmedMonth ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
        btnPrev.className = (this.confirmedMonth === prevStr) ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
        btnCurrent.className = (this.confirmedMonth === curStr) ? 'btn btn-primary py-0 px-2 text-white fw-bold' : 'btn btn-outline-secondary py-0 px-2';
    },

    // 레거시 호환 메소드 유지
    setMonthAll: function() { this.setDatePreset('all'); },
    setMonthPreset: function(p) { this.setDatePreset(p); },
    updateMonthPresetButtons: function() { this.updateDatePresetUI(); },

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
        this.renderTable();
        this.updateKpiSummary();
        this.updateSubSearchCountBadge();
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

        // 직출 연계처 필터 및 결과 내 검색어 초기화
        this.directPartnerFilter = '';
        this.subSearchKeyword = '';
        if ($('directPartnerFilter')) $('directPartnerFilter').value = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
        if ($('subSearchCountBadge')) $('subSearchCountBadge').classList.add('d-none');

        this.loadData();
    },

    clearSelectedPartner: function() {
        this.selectedPartner = null;
        this.currentRows = [];

        this.directPartnerFilter = '';
        this.subSearchKeyword = '';
        if ($('directPartnerFilter')) $('directPartnerFilter').innerHTML = '<option value="">전체 연계처</option>';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
        if ($('subSearchCountBadge')) $('subSearchCountBadge').classList.add('d-none');

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
        tbody.innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted"><i class='bx bx-loader-alt bx-spin'></i> [${this.selectedPartner.company_name || this.selectedPartner.name}] 거래처의 정산 내역을 불러오는 중입니다...</td></tr>`;

        try {
            const pName = this.selectedPartner.name || this.selectedPartner.company_name;

            const startEl = $('startDate');
            const endEl = $('endDate');
            if (this.dateType !== 'confirmed_month') {
                if (startEl && startEl.validity && startEl.validity.badInput) this.checkAndCorrectDate(startEl);
                if (endEl && endEl.validity && endEl.validity.badInput) this.checkAndCorrectDate(endEl);
                this.startDate = startEl?.value || '';
                this.endDate = endEl?.value || '';
            }

            // 1. type=all 요청으로 매출(outbound)과 매입(inbound)을 단일 쿼리로 모두 수집
            const sortField = (this.dateType === 'transaction') ? 'date' : ((this.dateType === 'confirmed_month') ? 'settlement_month' : 'tax_invoice_date');
            let url = `${API_BASE}/logistics/history?type=all&settlement_status=${encodeURIComponent('정산완료')}&include_direct=true&limit=2000&sortCol=${sortField}&sortDir=asc&searchParty=${encodeURIComponent(pName)}`;
            
            if (this.dateType === 'confirmed_month') {
                url += `&dateType=confirmed_month`;
                if (this.confirmedMonth) {
                    url += `&settlement_month=${encodeURIComponent(this.confirmedMonth)}`;
                }
            } else {
                if (this.startDate) {
                    url += `&startDate=${encodeURIComponent(this.startDate)}`;
                }
                if (this.endDate) {
                    url += `&endDate=${encodeURIComponent(this.endDate)}`;
                }
                if (this.dateType) {
                    url += `&dateType=${encodeURIComponent(this.dateType)}`;
                }
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

            // 가장 오래된 일자가 가장 위에 오도록(오름차순 / ASC) 정렬 (선택한 일자/확정월 기준 우선 정렬)
            items.sort((a, b) => {
                let dateA, dateB;
                if (this.dateType === 'transaction') {
                    dateA = a.date || a.tax_invoice_date || '';
                    dateB = b.date || b.tax_invoice_date || '';
                } else if (this.dateType === 'confirmed_month') {
                    dateA = (a.settlement_month || '9999-99') + (a.tax_invoice_date || a.date || '');
                    dateB = (b.settlement_month || '9999-99') + (b.tax_invoice_date || b.date || '');
                } else {
                    dateA = a.tax_invoice_date || a.date || '';
                    dateB = b.tax_invoice_date || b.date || '';
                }
                if (dateA === dateB) return (a.id || 0) - (b.id || 0);
                return dateA.localeCompare(dateB);
            });

            this.currentRows = items;
            this.updateDirectPartnerFilterOptions();
            this.updateFilterCounts();
            this.renderTable();
            this.updateKpiSummary();
            this.updateSubSearchCountBadge();

        } catch (err) {
            console.error(err);
            tbody.innerHTML = `<tr><td colspan="17" class="text-center text-danger py-5">오류가 발생했습니다: ${err.message}</td></tr>`;
        }
    },

    // ── 직출 연계처(매출처/매입처) 드롭다운 옵션 자동 구성 ──
    updateDirectPartnerFilterOptions: function() {
        const selectEl = $('directPartnerFilter');
        if (!selectEl) return;

        const rows = this.currentRows || [];
        const partnerCounts = {};
        let directCount = 0;
        let generalCount = 0;

        rows.forEach(r => {
            if (r.is_direct) {
                directCount++;
                const counterpart = (r.type === 'inbound')
                    ? (r.destination || r.actual_destination || '')
                    : (r.supplier || '');
                const name = counterpart ? counterpart.trim() : '(미지정)';
                partnerCounts[name] = (partnerCounts[name] || 0) + 1;
            } else {
                generalCount++;
            }
        });

        const currentVal = this.directPartnerFilter || '';
        let html = `<option value="">전체 연계처 (총 ${rows.length}건)</option>`;

        const sortedPartners = Object.keys(partnerCounts).sort((a, b) => partnerCounts[b] - partnerCounts[a]);
        if (sortedPartners.length > 0) {
            html += `<optgroup label="직출 연계처 (${directCount}건)">`;
            sortedPartners.forEach(p => {
                html += `<option value="${escapeAttr(p)}" ${currentVal === p ? 'selected' : ''}>${escapeHtml(p)} (${partnerCounts[p]}건)</option>`;
            });
            html += `</optgroup>`;
        }
        if (generalCount > 0) {
            html += `<optgroup label="기타">`;
            html += `<option value="__GENERAL__" ${currentVal === '__GENERAL__' ? 'selected' : ''}>일반/본사창고 (${generalCount}건)</option>`;
            html += `</optgroup>`;
        }

        selectEl.innerHTML = html;
        selectEl.value = currentVal;
    },

    onDirectPartnerFilterChange: function(val) {
        this.directPartnerFilter = val || '';
        this.renderTable();
        this.updateKpiSummary();
        this.updateSubSearchCountBadge();
    },

    filterByDirectPartner: function(name) {
        if (!name || name === '-') return;
        this.directPartnerFilter = name;
        const selectEl = $('directPartnerFilter');
        if (selectEl) selectEl.value = name;
        this.renderTable();
        this.updateKpiSummary();
        this.updateSubSearchCountBadge();
    },

    // ── 결과 내 실시간 다중 검색 (스마트 교집합) 핸들러 ──
    onSubSearchInput: function(val) {
        this.subSearchKeyword = val || '';
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) {
            if (this.subSearchKeyword.trim()) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        if (this.subSearchTimer) clearTimeout(this.subSearchTimer);
        this.subSearchTimer = setTimeout(() => {
            this.renderTable();
            this.updateKpiSummary();
            this.updateSubSearchCountBadge();
        }, 150);
    },

    clearSubSearch: function() {
        this.subSearchKeyword = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        if ($('clearSubSearchBtn')) $('clearSubSearchBtn').classList.add('d-none');
        this.renderTable();
        this.updateKpiSummary();
        this.updateSubSearchCountBadge();
    },

    updateSubSearchCountBadge: function() {
        const badge = $('subSearchCountBadge');
        if (!badge) return;
        const kw = (this.subSearchKeyword || '').trim();
        const dp = (this.directPartnerFilter || '').trim();
        if (kw || dp) {
            const count = this.getFilteredRows().length;
            badge.innerText = `필터 결과: ${count}건`;
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
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

        // 3. 직출 연계처(매출처/매입처) 드롭다운 필터
        if (this.directPartnerFilter) {
            const target = this.directPartnerFilter;
            if (target === '__GENERAL__') {
                list = list.filter(r => !r.is_direct);
            } else {
                list = list.filter(r => {
                    if (!r.is_direct) return false;
                    const counterpart = (r.type === 'inbound')
                        ? (r.destination || r.actual_destination || '')
                        : (r.supplier || '');
                    return counterpart === target || counterpart.includes(target);
                });
            }
        }

        // 4. 결과 내 실시간 스마트 다중 검색 (교집합 AND)
        if (this.subSearchKeyword && this.subSearchKeyword.trim()) {
            const tokens = this.subSearchKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
            list = list.filter(r => {
                const isSales = (r.type === 'outbound');
                const party = isSales ? (r.destination || r.actual_destination || '') : (r.supplier || '');
                const directParty = isSales ? (r.supplier || '') : (r.destination || r.actual_destination || '');
                const text = [
                    party,
                    directParty,
                    r.item || '',
                    r.spec || '',
                    r.unit || '',
                    r.settlement_account || '',
                    r.settlement_memo || '',
                    r.tax_invoice_date || '',
                    r.date || '',
                    r.is_direct ? '직출 직출고' : ''
                ].join(' ').toLowerCase();

                return tokens.every(t => text.includes(t));
            });
        }

        // 5. 자재계정 필터
        const acc = $('accountFilter')?.value || '';
        if (acc) {
            if (acc === '안전자재_전체' || acc === '안전자재') {
                list = list.filter(r => (r.settlement_account || '').startsWith('안전자재'));
            } else if (acc === '미분류') {
                list = list.filter(r => !r.settlement_account);
            } else {
                list = list.filter(r => r.settlement_account === acc);
            }
        }

        return list;
    },

    renderTable: function() {
        const tbody = $('mainStatusTableBody');
        const tfoot = $('mainStatusTableFoot');
        if (!tbody) return;

        // 일자 헤더 텍스트 갱신 (정산일자 vs 입출고일자 vs 확정월)
        if ($('colDateHeader')) {
            $('colDateHeader').innerText = (this.dateType === 'confirmed_month') ? '확정월' : ((this.dateType === 'transaction') ? '입출고일자' : '정산일자');
        }

        // 헤더 체크박스 초기화
        if ($('checkAllTable')) $('checkAllTable').checked = false;
        if ($('tableHeaderCheck')) $('tableHeaderCheck').checked = false;
        this.updateSelectedCountBadge();

        const rows = this.getFilteredRows();

        if (rows.length === 0) {
            let msg = '';
            if (this.directPartnerFilter || this.subSearchKeyword) msg = '검색/필터 조건과 일치하는 정산 내역이 없습니다.';
            else if (this.confirmFilter === 'unconfirmed') msg = '미확정된 정산 내역이 없습니다.';
            else if (this.confirmFilter === 'confirmed') msg = '확정 완료된 정산 내역이 없습니다.';
            else {
                const dateTypeTitle = (this.dateType === 'confirmed_month') ? '확정월' : ((this.dateType === 'transaction') ? '입출고일' : '정산일');
                const periodText = this.getPeriodLabel();
                msg = (periodText !== '전체기간' && periodText !== '전체 확정월') ? `[${dateTypeTitle} ${periodText}] 기간에 등록된 정산 내역이 없습니다.` : '등록된 정산 내역이 없습니다.';
            }

            const targetName = this.selectedPartner ? `[${this.selectedPartner.company_name || this.selectedPartner.name}] 거래처의 ` : '';
            tbody.innerHTML = `<tr><td colspan="17" class="text-center py-5 text-muted">${targetName}${msg}</td></tr>`;
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

            // 직출 연계처 명 (매입: 납품/매출처, 매출: 원공급/매입처)
            let directPartnerHtml = '<span class="text-muted small">-</span>';
            if (r.is_direct) {
                if (isSales) {
                    const supp = r.supplier || '-';
                    directPartnerHtml = `<span class="text-success fw-semibold text-truncate d-inline-block" style="max-width:130px; font-size:0.8rem; cursor:pointer;" title="직출 원공급(매입)처: ${escapeAttr(supp)} (클릭하여 필터)" onclick="app.filterByDirectPartner('${escapeAttr(supp)}')"><i class='bx bx-left-arrow-alt'></i> ${escapeHtml(supp)}</span>`;
                } else {
                    const dest = r.destination || r.actual_destination || '-';
                    directPartnerHtml = `<span class="text-primary fw-semibold text-truncate d-inline-block" style="max-width:130px; font-size:0.8rem; cursor:pointer;" title="직출 납품(매출)처: ${escapeAttr(dest)} (클릭하여 필터)" onclick="app.filterByDirectPartner('${escapeAttr(dest)}')"><i class='bx bx-right-arrow-alt'></i> ${escapeHtml(dest)}</span>`;
                }
            }

            let rowDate = '-';
            let dateTooltip = '';
            if (this.dateType === 'confirmed_month') {
                rowDate = r.settlement_month ? `${r.settlement_month}` : '미확정';
                dateTooltip = `확정월: ${r.settlement_month || '미확정'} | 정산일: ${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'} | 입출고일: ${r.date ? r.date.split('T')[0] : '-'}`;
            } else if (this.dateType === 'transaction') {
                rowDate = r.date ? r.date.split('T')[0] : (r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-');
                dateTooltip = `입출고일: ${r.date ? r.date.split('T')[0] : '-'} | 정산일: ${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'}`;
            } else {
                rowDate = r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : (r.date ? r.date.split('T')[0] : '-');
                dateTooltip = `정산일: ${r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '-'} | 입출고일: ${r.date ? r.date.split('T')[0] : '-'}`;
            }

            return `
                <tr>
                    <td class="text-center">
                        <input class="form-check-input item-chk" type="checkbox" value="${r.id}" data-type="${r.type}" data-confirmed="${isConfirmed ? '1' : '0'}" onchange="app.onItemCheckChange()">
                    </td>
                    <td class="text-center text-muted small">${idx + 1}</td>
                    <td class="text-center text-nowrap">${typeBadge}</td>
                    <td class="text-center small text-nowrap ${isSales ? 'text-primary' : 'text-success'} fw-semibold" title="${dateTooltip}">
                        ${this.dateType === 'confirmed_month' ? `<span class="badge ${r.settlement_month ? 'bg-light text-primary border' : 'bg-warning bg-opacity-10 text-warning-emphasis border border-warning'}">${rowDate}</span>` : rowDate}
                    </td>
                    <td class="text-start fw-bold text-dark text-truncate" style="max-width: 130px;" title="${escapeAttr(partyName)}">${escapeHtml(partyName)}</td>
                    <td class="text-start text-truncate" style="max-width: 130px;">${directPartnerHtml}</td>
                    <td class="text-center small text-nowrap"><span class="badge bg-light text-dark border">${escapeHtml(r.settlement_account || '-')}</span></td>
                    <td class="text-start">
                        <strong>${escapeHtml(r.item)}</strong>
                        ${r.is_direct ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.68rem;">직출</span>` : ''}
                    </td>
                    <td class="text-center text-muted small">${escapeHtml(r.spec || '-')}</td>
                    <td class="text-center text-muted small text-nowrap">${escapeHtml(r.unit || '-')}</td>
                    <td class="text-end small text-nowrap">${qty.toLocaleString()}</td>
                    <td class="text-end small text-nowrap">${price.toLocaleString()}원</td>
                    <td class="text-end small text-nowrap">${supply.toLocaleString()}원</td>
                    <td class="text-end text-muted small text-nowrap">${vat.toLocaleString()}원</td>
                    <td class="text-end fw-bold text-nowrap ${isSales ? 'text-primary' : 'text-success'} small">${grand.toLocaleString()}원</td>
                    <td class="text-center text-nowrap">${statusBadge}</td>
                    <td class="text-start small text-muted text-truncate" style="max-width: 120px;" title="${escapeAttr(r.settlement_memo || '')}">${escapeHtml(r.settlement_memo || '-')}</td>
                </tr>
            `;
        }).join('');

        if (tfoot) {
            tfoot.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center">합 계 (총 ${rows.length.toLocaleString()}건)</td>
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

        // 1. 매출(청구) 카드 업데이트
        if ($('kpiSalesCount')) $('kpiSalesCount').innerText = `(${salesRows.length.toLocaleString()}건)`;
        if ($('kpiSalesGrand')) $('kpiSalesGrand').innerText = `${salesCalc.totalGrand.toLocaleString()}원`;
        if ($('kpiSalesSupply')) $('kpiSalesSupply').innerText = `${salesCalc.totalSupply.toLocaleString()}원`;
        if ($('kpiSalesVat')) $('kpiSalesVat').innerText = `${salesCalc.totalVat.toLocaleString()}원`;

        // 2. 매입 카드 업데이트
        if ($('kpiPurchaseCount')) $('kpiPurchaseCount').innerText = `(${purchaseRows.length.toLocaleString()}건)`;
        if ($('kpiPurchaseGrand')) $('kpiPurchaseGrand').innerText = `${purchaseCalc.totalGrand.toLocaleString()}원`;
        if ($('kpiPurchaseSupply')) $('kpiPurchaseSupply').innerText = `${purchaseCalc.totalSupply.toLocaleString()}원`;
        if ($('kpiPurchaseVat')) $('kpiPurchaseVat').innerText = `${purchaseCalc.totalVat.toLocaleString()}원`;

        // 3. 거래구분 필터(전체 / 매출건만 / 매입건만)에 따른 카드 가시성 및 그리드 폭 조정
        const salesCol = $('kpiSalesCardCol');
        const purchaseCol = $('kpiPurchaseCardCol');

        if (this.tradeTypeFilter === 'outbound') {
            if (salesCol) {
                salesCol.classList.remove('d-none', 'col-md-6');
                salesCol.classList.add('col-12');
            }
            if (purchaseCol) purchaseCol.classList.add('d-none');
        } else if (this.tradeTypeFilter === 'inbound') {
            if (salesCol) salesCol.classList.add('d-none');
            if (purchaseCol) {
                purchaseCol.classList.remove('d-none', 'col-md-6');
                purchaseCol.classList.add('col-12');
            }
        } else {
            // 전체보기 ('all')
            if (salesCol) {
                salesCol.classList.remove('d-none', 'col-12');
                salesCol.classList.add('col-md-6');
            }
            if (purchaseCol) {
                purchaseCol.classList.remove('d-none', 'col-12');
                purchaseCol.classList.add('col-md-6');
            }
        }

        // 4. 계정과목별 집계 요약 스트립 갱신
        this.renderAccountSummary();
    },

    // ── 계정과목별 집계 계산 및 인터랙티브 칩 렌더링 ──
    renderAccountSummary: function() {
        const container = $('accountSummaryChips');
        const totalContainer = $('accountSummaryTotal');
        if (!container) return;

        // 기준 데이터: 거래구분(매출/매입) 및 확정상태(전체/미확정/확정완료) 필터가 적용된 행들
        let baseRows = this.currentRows || [];
        if (this.tradeTypeFilter === 'outbound') baseRows = baseRows.filter(r => r.type === 'outbound');
        else if (this.tradeTypeFilter === 'inbound') baseRows = baseRows.filter(r => r.type === 'inbound');

        if (this.confirmFilter === 'unconfirmed') baseRows = baseRows.filter(r => !r.settlement_month);
        else if (this.confirmFilter === 'confirmed') baseRows = baseRows.filter(r => !!r.settlement_month);

        if (this.directPartnerFilter) {
            const target = this.directPartnerFilter;
            if (target === '__GENERAL__') {
                baseRows = baseRows.filter(r => !r.is_direct);
            } else {
                baseRows = baseRows.filter(r => {
                    if (!r.is_direct) return false;
                    const counterpart = (r.type === 'inbound')
                        ? (r.destination || r.actual_destination || '')
                        : (r.supplier || '');
                    return counterpart === target || counterpart.includes(target);
                });
            }
        }

        if (this.subSearchKeyword && this.subSearchKeyword.trim()) {
            const tokens = this.subSearchKeyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
            baseRows = baseRows.filter(r => {
                const isSales = (r.type === 'outbound');
                const party = isSales ? (r.destination || r.actual_destination || '') : (r.supplier || '');
                const directParty = isSales ? (r.supplier || '') : (r.destination || r.actual_destination || '');
                const text = [
                    party,
                    directParty,
                    r.item || '',
                    r.spec || '',
                    r.unit || '',
                    r.settlement_account || '',
                    r.settlement_memo || '',
                    r.tax_invoice_date || '',
                    r.date || '',
                    r.is_direct ? '직출 직출고' : ''
                ].join(' ').toLowerCase();
                return tokens.every(t => text.includes(t));
            });
        }

        if (baseRows.length === 0) {
            container.innerHTML = `
                <span class="text-secondary fw-bold me-1 text-nowrap d-inline-flex align-items-center gap-1" style="font-size: 0.84rem;">
                    <i class='bx bx-category-alt text-primary'></i> 계정별 집계 <span class="badge bg-secondary-subtle text-secondary border fw-normal ms-1" style="font-size:0.72rem;">공급가 기준 (VAT 별도)</span>:
                </span>
                <span class="text-muted small">해당 조건의 집계 데이터가 없습니다.</span>
            `;
            if (totalContainer) totalContainer.innerHTML = '';
            return;
        }

        // 각 계정별 행 분류
        const rowsSafeGen = baseRows.filter(r => r.settlement_account === '안전자재-일반');
        const rowsSafeEnv = baseRows.filter(r => r.settlement_account === '안전자재-환경');
        const rowsSafeTotal = baseRows.filter(r => (r.settlement_account || '').startsWith('안전자재'));
        const rowsMisc = baseRows.filter(r => r.settlement_account === '잡자재');
        const rowsEtc = baseRows.filter(r => r.settlement_account === '기타자재');
        const rowsMall = baseRows.filter(r => r.settlement_account === '쇼핑몰');
        const rowsUnclass = baseRows.filter(r => !r.settlement_account);

        const calcSafeGen = this.computeAmounts(rowsSafeGen);
        const calcSafeEnv = this.computeAmounts(rowsSafeEnv);
        const calcSafeTotal = this.computeAmounts(rowsSafeTotal);
        const calcMisc = this.computeAmounts(rowsMisc);
        const calcEtc = this.computeAmounts(rowsEtc);
        const calcMall = this.computeAmounts(rowsMall);
        const calcUnclass = this.computeAmounts(rowsUnclass);
        const calcBaseTotal = this.computeAmounts(baseRows);

        const currentAcc = $('accountFilter')?.value || '';

        const getChip = (accKey, label, calc, badgeStyle) => {
            const isActive = (currentAcc === accKey || (accKey === '안전자재_전체' && currentAcc === '안전자재'));
            const count = calc.items.length;
            const grand = calc.totalGrand;
            const supply = calc.totalSupply;
            const vat = calc.totalVat;
            
            const activeClass = isActive ? ' active-account-chip' : '';
            const checkIcon = isActive ? `<i class='bx bx-check fw-bold'></i> ` : '';
            const title = `[${label} 공급가 기준 집계]\n· 공급가액: ${supply.toLocaleString()}원 (VAT 별도)\n· 부가세액: ${vat.toLocaleString()}원\n· 총 합계금: ${grand.toLocaleString()}원\n(클릭 시 필터 적용/해제)`;

            const opacityClass = (count === 0 && !isActive) ? ' opacity-50' : '';
            const cls = isActive ? 'bg-primary text-white' : badgeStyle;

            return `
                <span class="badge ${cls} account-stat-chip${activeClass}${opacityClass} d-inline-flex align-items-center gap-1 shadow-sm"
                      onclick="app.filterByAccount('${accKey}')" title="${escapeAttr(title)}">
                    ${checkIcon}${label} <strong>${count}건</strong> · ${supply.toLocaleString()}원
                </span>
            `;
        };

        const periodPrefix = (this.dateType === 'confirmed_month')
            ? `<span class="badge bg-dark bg-opacity-10 text-dark border me-1">${this.confirmedMonth ? this.confirmedMonth + ' 확정' : '전체 확정'}</span>`
            : '';

        const filterResetBtn = currentAcc
            ? `<button class="btn btn-link btn-sm text-danger p-0 ms-1 text-decoration-none" onclick="app.filterByAccount('')" style="font-size:0.78rem;" title="계정 필터 해제"><i class='bx bx-x-circle'></i> 전체보기</button>`
            : '';

        container.innerHTML = `
            <span class="text-secondary fw-bold me-1 text-nowrap d-inline-flex align-items-center gap-1" style="font-size: 0.84rem;">
                <i class='bx bx-category-alt text-primary'></i> ${periodPrefix}계정별 집계 <span class="badge bg-secondary-subtle text-secondary border fw-normal py-1 px-1 ms-1" style="font-size:0.72rem;" title="모든 계정 금액은 부가가치세(VAT)가 제외된 공급가액 기준입니다.">공급가 기준 (VAT 별도)</span>:
            </span>
            ${getChip('안전자재_전체', '안전자재 통합', calcSafeTotal, 'bg-primary text-white')}
            ${getChip('안전자재-일반', '안전(일반)', calcSafeGen, 'bg-primary bg-opacity-10 text-primary border border-primary')}
            ${getChip('안전자재-환경', '안전(환경)', calcSafeEnv, 'bg-success bg-opacity-10 text-success border border-success')}
            <span class="text-muted mx-1 opacity-50">|</span>
            ${getChip('잡자재', '잡자재', calcMisc, 'bg-warning bg-opacity-10 text-dark border border-warning')}
            ${getChip('기타자재', '기타자재', calcEtc, 'bg-secondary bg-opacity-10 text-secondary border border-secondary')}
            ${getChip('쇼핑몰', '쇼핑몰', calcMall, 'bg-info bg-opacity-10 text-info border border-info')}
            ${getChip('미분류', '미분류', calcUnclass, (calcUnclass.items.length > 0 ? 'bg-danger bg-opacity-10 text-danger border border-danger' : 'bg-light text-muted border'))}
            ${filterResetBtn}
        `;

        if (totalContainer) {
            totalContainer.innerHTML = `
                <span>계정 총 공급가: <strong class="text-dark fw-bold">${calcBaseTotal.totalSupply.toLocaleString()}원</strong> <span class="text-muted" style="font-size:0.78rem;">(VAT 별도, ${calcBaseTotal.items.length}건)</span></span>
            `;
        }
    },

    filterByAccount: function(accountKey) {
        const selectEl = $('accountFilter');
        const currentVal = selectEl ? selectEl.value : '';

        let targetVal = accountKey;
        if (accountKey === '안전자재' || accountKey === '안전자재_전체') {
            targetVal = '안전자재_전체';
        }

        // 이미 선택된 항목을 다시 누르면 전체보기로 해제
        if (currentVal === targetVal || (currentVal === '안전자재' && targetVal === '안전자재_전체')) {
            targetVal = '';
        }

        if (selectEl) selectEl.value = targetVal;
        this.onFilterChange();
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
        let periodStr = this.getPeriodLabel();
        const dateTypeTitle = (this.dateType === 'confirmed_month') ? '확정월' : ((this.dateType === 'transaction') ? '입출고일' : '정산일');
        const titleText = isSales ? `${periodStr} 청구서` : `${periodStr} 매입정산내역`;

        $('printTitle').innerText = this.aggregateByBizNum ? `(사업자 통합) ${titleText}` : titleText;
        $('printBillingMonth').innerText = isSales ? `청구기간(${dateTypeTitle}): ${periodStr}` : `정산기간(${dateTypeTitle}): ${periodStr}`;

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

            // 직출 연계처 (매입: 매출처, 매출: 매입처)
            let directParty = '-';
            if (r.is_direct) {
                directParty = isSales ? (r.supplier || '-') : (r.destination || r.actual_destination || '-');
            }

            return {
                'No': idx + 1,
                '구분': isSales ? '매출' : '매입',
                '발생일자': r.date ? r.date.split('T')[0] : '',
                '정산일자': r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '',
                '상대처/납품처': isSales ? (r.destination || r.actual_destination || '') : (r.supplier || ''),
                '직출 연계처': directParty,
                '자재계정': r.settlement_account || '',
                '품목명': r.item + (r.is_direct ? ' (직출)' : ''),
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
        const filterSuffix = this.directPartnerFilter ? `_${this.directPartnerFilter}` : (this.subSearchKeyword ? `_검색(${this.subSearchKeyword.trim()})` : '');
        const dateTypeLabel = (this.dateType === 'confirmed_month') ? '확정월' : ((this.dateType === 'transaction') ? '입출고일' : '정산일');
        const periodLabel = this.getPeriodLabel().replace(/\s+/g, '');
        const fileName = `${dateTypeLabel}_${periodLabel}_${partnerName}${tradeLabel}${filterSuffix}_정산현황.xlsx`;
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
