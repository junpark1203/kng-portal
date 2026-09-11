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
    partners: [],
    keyboardFocusedIndex: -1,

    init: function() {
        // 체크박스 헤더
        $('checkAllHeader').addEventListener('change', this.onCheckAllHeaderChange.bind(this));
        
        // 정렬 헤더 UI 초기화 (오름차순 화살표)
        this.updateSortHeaderUI();

        // 날짜 자동보정 리스너 등록
        this.attachDateAutoCorrection($('startDate'));
        this.attachDateAutoCorrection($('endDate'));

        // 초기 날짜 세팅 (전월 기본)
        this.setDatePreset('prevMonth');

        // 등록 거래처 목록 비동기 로드
        this.loadPartners();

        // 키보드 방향키 이동 및 스페이스바 선택 리스너 등록
        this.initKeyboardNav();
    },

    initKeyboardNav: function() {
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            const tag = activeEl ? activeEl.tagName.toLowerCase() : '';
            const isEditable = activeEl && (
                activeEl.isContentEditable ||
                tag === 'textarea' ||
                tag === 'select' ||
                (tag === 'input' && activeEl.type !== 'checkbox' && activeEl.type !== 'radio')
            );
            if (isEditable) return;
            if (document.querySelector('.modal.show')) return;

            const mainRows = Array.from(document.querySelectorAll('#dataTableBody tr:not(.settle-input-row)'));
            if (mainRows.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                let nextIdx = this.keyboardFocusedIndex + 1;
                if (this.keyboardFocusedIndex === -1 || nextIdx >= mainRows.length) {
                    nextIdx = (this.keyboardFocusedIndex === -1) ? 0 : mainRows.length - 1;
                }
                this.setKeyboardFocus(nextIdx, mainRows);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                let prevIdx = this.keyboardFocusedIndex - 1;
                if (prevIdx < 0) prevIdx = 0;
                this.setKeyboardFocus(prevIdx, mainRows);
            } else if (e.key === ' ' || e.code === 'Space') {
                if (this.keyboardFocusedIndex >= 0 && this.keyboardFocusedIndex < mainRows.length) {
                    e.preventDefault();
                    const targetRow = mainRows[this.keyboardFocusedIndex];
                    const chk = targetRow.querySelector('.row-chk');
                    if (chk && !chk.disabled) {
                        chk.checked = !chk.checked;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            }
        });

        // 마우스 클릭 시 해당 행으로 포커스 인덱스 동기화
        const tbody = document.getElementById('dataTableBody');
        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const tr = e.target.closest('tr');
                if (!tr) return;
                const mainTr = tr.classList.contains('settle-input-row') ? tr.previousElementSibling : tr;
                const mainRows = Array.from(document.querySelectorAll('#dataTableBody tr:not(.settle-input-row)'));
                const clickedIdx = mainRows.indexOf(mainTr);
                if (clickedIdx !== -1) {
                    this.setKeyboardFocus(clickedIdx, mainRows, false);
                }
            });
        }
    },

    setKeyboardFocus: function(idx, rows, autoScroll = true) {
        if (!rows || rows.length === 0) return;
        this.keyboardFocusedIndex = Math.max(0, Math.min(idx, rows.length - 1));

        document.querySelectorAll('#dataTableBody tr.keyboard-focused-row').forEach(el => el.classList.remove('keyboard-focused-row'));
        document.querySelectorAll('#dataTableBody tr.keyboard-focused-subrow').forEach(el => el.classList.remove('keyboard-focused-subrow'));

        const targetRow = rows[this.keyboardFocusedIndex];
        if (targetRow) {
            targetRow.classList.add('keyboard-focused-row');
            const subRow = targetRow.nextElementSibling;
            if (subRow && subRow.classList.contains('settle-input-row')) {
                subRow.classList.add('keyboard-focused-subrow');
            }
            if (autoScroll) {
                targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
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
                    this.onDateInputChange();
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
                    this.onDateInputChange();
                    return val;
                }
            }
        }
        return inputEl.value || '';
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
        const startEl = $('startDate');
        const endEl = $('endDate');

        // 입력 중이거나 불완전한 상태에서는 조회를 실행하지 않고 사용자 입력을 기다림
        if ((startEl && startEl.validity && startEl.validity.badInput) ||
            (endEl && endEl.validity && endEl.validity.badInput)) {
            return;
        }

        const start = startEl ? startEl.value : '';
        const end = endEl ? endEl.value : '';
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
        } else if (key === 'partner') {
            if ($('partnerInput')) $('partnerInput').value = '';
            this.resetPageAndLoadData();
        }
    },

    loadPartners: async function() {
        try {
            const res = await window.authFetch('https://kng.junparks.com/api/partners');
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
        setTimeout(() => document.getElementById('partnerSearchInput').focus(), 400);
    },

    filterPartnerSearch: function() {
        const val = document.getElementById('partnerSearchInput').value.trim().toLowerCase();
        const listContainer = document.getElementById('partnerSearchList');
        
        let matches = this.partners || [];
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
        this.resetPageAndLoadData();
    },

    selectFirstPartnerMatch: function() {
        const firstBtn = document.querySelector('#partnerSearchList button');
        if (firstBtn) {
            firstBtn.click();
        }
    },

    filterByAccount: function(accountName) {
        const select = $('accountFilter');
        if (!select) return;
        if (select.value === accountName) {
            // 이미 선택된 계정이면 토글(전체 해제)
            select.value = '';
        } else {
            select.value = accountName;
        }
        this.resetPageAndLoadData();
    },

    // 자재계정이 선택된 상태에서 기간/검색조건이 변경되었을 때, 전체 계정 모수 집계를 1회 조회하여 캐싱
    fetchBaseSummary: async function(baseKey, startDate, endDate, statusVal, partnerVal, searchTarget, searchKeyword) {
        try {
            const url = new URL(`${API_BASE}/history`);
            url.searchParams.append('type', 'outbound');
            url.searchParams.append('include_direct', 'true');
            url.searchParams.append('limit', '1');
            if (statusVal && statusVal !== '전체보기') url.searchParams.append('settlement_status', statusVal);
            if (partnerVal) url.searchParams.append('partner', partnerVal);
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (searchTarget) url.searchParams.append('searchTarget', searchTarget);
            if (searchKeyword) url.searchParams.append('searchKeyword', searchKeyword);
            if (this.subSearchKeyword) url.searchParams.append('subSearch', this.subSearchKeyword);

            const res = await window.authFetch(url.toString());
            if (res.ok) {
                const resJson = await res.json();
                if (resJson.summary) {
                    this.baseSummary = resJson.summary;
                    this.baseSummaryKey = baseKey;
                    if (this.currentSummary) {
                        this.renderSummaryStrip(this.currentSummary);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to fetch base summary:', e);
        }
    },

    resetSearch: function() {
        this.currentDatePreset = 'all';
        this.updatePresetButtons('all');
        if ($('startDate')) $('startDate').value = '';
        if ($('endDate')) $('endDate').value = '';
        if ($('accountFilter')) $('accountFilter').value = '';
        if ($('partnerInput')) $('partnerInput').value = '';
        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('searchInput')) $('searchInput').value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        if ($('statusFilter')) $('statusFilter').value = '미정산';
        this.subSearchKeyword = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        const clearSubBtn = $('clearSubSearchBtn');
        if (clearSubBtn) clearSubBtn.classList.add('d-none');
        const countBadge = $('subSearchCountBadge');
        if (countBadge) countBadge.classList.add('d-none');
        this.baseSummary = null;
        this.baseSummaryKey = '';
        this.resetPageAndLoadData();
    },

    resetPageAndLoadData: function() {
        this.currentPage = 1;
        this.loadData();
    },

    loadData: async function() {
        try {
            const startEl = $('startDate');
            const endEl = $('endDate');
            if (startEl && startEl.validity && startEl.validity.badInput) this.checkAndCorrectDate(startEl);
            if (endEl && endEl.validity && endEl.validity.badInput) this.checkAndCorrectDate(endEl);

            const startDate = startEl?.value || '';
            const endDate = endEl?.value || '';
            const partnerVal = $('partnerInput')?.value.trim() || '';
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
            url.searchParams.append('type', 'outbound');
            url.searchParams.append('include_direct', 'true');
            url.searchParams.append('page', this.currentPage);
            url.searchParams.append('limit', this.limit);
            
            if (statusVal && statusVal !== '전체보기') {
                url.searchParams.append('settlement_status', statusVal);
            }
            if (accountVal) {
                url.searchParams.append('settlement_account', accountVal);
            }
            if (partnerVal) {
                url.searchParams.append('partner', partnerVal);
            }
            if (startDate) url.searchParams.append('startDate', startDate);
            if (endDate) url.searchParams.append('endDate', endDate);
            if (searchTarget) url.searchParams.append('searchTarget', searchTarget);
            if (searchKeyword) url.searchParams.append('searchKeyword', searchKeyword);
            if (this.subSearchKeyword) url.searchParams.append('subSearch', this.subSearchKeyword);
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

            // 전체 계정 모수(베이스 서머리) 동기화
            const currentBaseKey = `${startDate}|${endDate}|${statusVal}|${partnerVal}|${searchTarget}|${searchKeyword}|${this.subSearchKeyword || ''}`;
            if (!accountVal) {
                // 자재계정 필터가 없는 전체 조회의 경우 이번 결과가 바로 베이스 모수
                this.baseSummary = result.summary;
                this.baseSummaryKey = currentBaseKey;
            } else if (!this.baseSummary || this.baseSummaryKey !== currentBaseKey) {
                // 계정 필터가 적용된 상태에서 기간/검색조건이 바뀌었을 경우 전체 모수를 백그라운드 1회 조회
                this.fetchBaseSummary(currentBaseKey, startDate, endDate, statusVal, partnerVal, searchTarget, searchKeyword);
            }
            
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
            console.error('Sales data load error:', err);
            $('dataTableBody').innerHTML = `<tr><td colspan="17" class="text-center text-danger py-5">데이터 로드에 실패했습니다. (${err.message || '네트워크/서버 오류'})</td></tr>`;
        }
    },

    renderActiveFilterChips: function() {
        const container = $('activeFilterChipsContainer');
        if (!container) return;

        const statusVal = $('statusFilter')?.value || '미정산';
        const accountVal = $('accountFilter')?.value || '';
        const partnerVal = $('partnerInput')?.value.trim() || '';
        const startDate = $('startDate')?.value || '';
        const endDate = $('endDate')?.value || '';
        const searchTarget = $('searchTarget')?.value || '';
        const searchKeyword = $('searchInput')?.value.trim() || '';

        let chips = [];

        // 1. 거래처(매출처) 필터
        if (partnerVal) {
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-building'></i> 매출처:</span> <strong>${partnerVal}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('partner')" title="해제"></i>
                </span>
            `);
        }

        // 2. 상태 필터
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
                destination: '매출처', item: '품목명', spec: '규격', note: '비고', tx_id: '고유번호'
            };
            const targetName = targetLabels[searchTarget] || '전체';
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-search'></i> ${targetName}:</span> <strong>"${searchKeyword}"</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearFilter('search')" title="해제"></i>
                </span>
            `);
        }

        // 5. 결과 내 재검색 필터
        if (this.subSearchKeyword) {
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-filter'></i> 재검색:</span> <strong>"${this.subSearchKeyword}"</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearSubSearch()" title="해제"></i>
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
        const strip = $('salesSummaryStrip');
        if (!strip) return;

        if (!summary) {
            strip.innerHTML = `<span class="text-muted">통계 집계 없음</span>`;
            return;
        }

        const totalCount = summary.totalCount || 0;
        const totalQty = summary.totalQty || 0;
        const outbound = summary.outbound || { supplyAmt: 0, vat: 0, totalAmt: 0 };

        const currentAcc = $('accountFilter')?.value || '';

        // 계정별 집계(모수)는 현재 조회조건(기간/상태/검색어)의 전체 베이스 서머리가 있으면 그것을 유지하여 표시
        const breakdownSummary = (currentAcc && this.baseSummary) ? this.baseSummary : summary;
        const b = breakdownSummary.breakdown || {};
        const safeGen = b.safetyGeneral || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const safeEnv = b.safetyEnv || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const misc = b.misc || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const etc = b.etc || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const mall = b.mall || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const unclass = b.unclassified || { count: 0, qty: 0, supplyAmt: 0, totalAmt: 0 };
        const safeTotalCount = (safeGen.count || 0) + (safeEnv.count || 0);
        const safeTotalSupply = (safeGen.supplyAmt || 0) + (safeEnv.supplyAmt || 0);

        // 기준 전체 건수 (자재계정 필터가 걸려있을 때 전체 모수)
        const baseTotalCount = (this.baseSummary && this.baseSummary.totalCount) ? this.baseSummary.totalCount : totalCount;

        const getChipProps = (accKey, label) => {
            const isActive = (currentAcc === accKey);
            const activeClass = isActive ? ' active-account-chip' : '';
            const icon = isActive ? `<i class='bx bx-check fw-bold'></i> ` : '';
            const title = isActive ? `현재 [${label}] 필터링 중 (클릭 시 전체 보기로 해제)` : `클릭하여 [${label}] 내역만 조회`;
            return { isActive, activeClass, icon, title };
        };

        const pSafeTotal = getChipProps('안전자재', '안전자재 통합');
        const pSafeGen = getChipProps('안전자재-일반', '안전(일반)');
        const pSafeEnv = getChipProps('안전자재-환경', '안전(환경)');
        const pMisc = getChipProps('잡자재', '잡자재');
        const pEtc = getChipProps('기타자재', '기타자재');
        const pMall = getChipProps('쇼핑몰', '쇼핑몰');
        const pUnclass = getChipProps('미분류', '미분류');

        strip.innerHTML = `
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 pb-2 border-bottom">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span class="text-secondary"><strong>검색 결과</strong></span>
                    <span class="badge bg-dark px-2 py-1">${totalCount.toLocaleString()}건</span>
                    <span class="text-muted small">총 수량: <strong>${totalQty.toLocaleString()}</strong></span>
                    ${currentAcc ? `
                    <span class="badge bg-primary bg-opacity-10 text-primary border border-primary px-2 py-1 d-inline-flex align-items-center gap-1" style="font-size:0.78rem;">
                        <i class='bx bx-filter-alt'></i> [${currentAcc}] 필터링 중
                    </span>
                    <span class="text-muted small ms-1">(조건 전체 <strong>${baseTotalCount.toLocaleString()}건</strong> 중)</span>
                    <button class="btn btn-link btn-sm text-danger p-0 ms-1 text-decoration-none" onclick="app.clearFilter('account')" style="font-size:0.78rem;" title="자재계정 필터 해제">
                        <i class='bx bx-x-circle'></i> 전체보기
                    </button>
                    ` : ''}
                </div>
                <div class="d-flex align-items-center gap-3 flex-wrap">
                    <div><span class="text-muted">매출 공급가:</span> <strong class="text-dark">${outbound.supplyAmt.toLocaleString()}원</strong></div>
                    <div><span class="text-muted">부가세:</span> <strong class="text-secondary">${outbound.vat.toLocaleString()}원</strong></div>
                    <div class="badge bg-danger bg-opacity-10 text-danger border border-danger px-2 py-1" style="font-size:0.85rem;">
                        매출 합계: <strong class="fs-6">${outbound.totalAmt.toLocaleString()}</strong>원
                    </div>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2 flex-wrap pt-2" style="font-size: 0.85rem;">
                <span class="text-secondary fw-bold me-1"><i class='bx bx-category-alt'></i> 계정별 집계:</span>
                <span class="badge ${pSafeTotal.isActive ? 'bg-primary text-white' : 'bg-primary text-white'} account-stat-chip${pSafeTotal.activeClass} d-inline-flex align-items-center gap-1 shadow-sm"
                      onclick="app.filterByAccount('안전자재')" title="${pSafeTotal.title}">
                    ${pSafeTotal.icon}안전자재 통합: <strong>${safeTotalCount}건</strong> (${safeTotalSupply.toLocaleString()}원)
                </span>
                <span class="badge ${pSafeGen.isActive ? 'bg-primary text-white' : 'bg-primary bg-opacity-10 text-primary border border-primary'} account-stat-chip${pSafeGen.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('안전자재-일반')" title="${pSafeGen.title}">
                    ${pSafeGen.icon}안전(일반): <strong>${safeGen.count}건</strong> (${safeGen.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge ${pSafeEnv.isActive ? 'bg-success text-white' : 'bg-success bg-opacity-10 text-success border border-success'} account-stat-chip${pSafeEnv.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('안전자재-환경')" title="${pSafeEnv.title}">
                    ${pSafeEnv.icon}안전(환경): <strong>${safeEnv.count}건</strong> (${safeEnv.supplyAmt.toLocaleString()}원)
                </span>
                <span class="text-muted mx-1 opacity-50">|</span>
                <span class="badge ${pMisc.isActive ? 'bg-warning text-dark' : 'bg-warning bg-opacity-10 text-dark border border-warning'} account-stat-chip${pMisc.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('잡자재')" title="${pMisc.title}">
                    ${pMisc.icon}잡자재: <strong>${misc.count}건</strong> (${misc.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge ${pEtc.isActive ? 'bg-secondary text-white' : 'bg-secondary bg-opacity-10 text-secondary border border-secondary'} account-stat-chip${pEtc.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('기타자재')" title="${pEtc.title}">
                    ${pEtc.icon}기타자재: <strong>${etc.count}건</strong> (${etc.supplyAmt.toLocaleString()}원)
                </span>
                <span class="badge ${pMall.isActive ? 'bg-info text-dark' : 'bg-info bg-opacity-10 text-info border border-info'} account-stat-chip${pMall.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('쇼핑몰')" title="${pMall.title}">
                    ${pMall.icon}쇼핑몰: <strong>${mall.count}건</strong> (${mall.supplyAmt.toLocaleString()}원)
                </span>
                ${unclass.count > 0 ? `
                <span class="badge ${pUnclass.isActive ? 'bg-danger text-white' : 'bg-danger bg-opacity-10 text-danger border border-danger'} account-stat-chip${pUnclass.activeClass} d-inline-flex align-items-center gap-1"
                      onclick="app.filterByAccount('미분류')" title="${pUnclass.title}">
                    ${pUnclass.icon}미분류: <strong>${unclass.count}건</strong> (계정 지정 필요)
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
            } else if (col === 'outbound_price') {
                valA = Number(a.settlement_price ?? a.outbound_price) || 0;
                valB = Number(b.settlement_price ?? b.outbound_price) || 0;
            } else if (col === 'outbound_total') {
                const priceA = Number(a.settlement_price ?? a.outbound_price) || 0;
                const qtyA = Number(a.settlement_qty ?? a.qty) || 0;
                valA = priceA * qtyA;
                const priceB = Number(b.settlement_price ?? b.outbound_price) || 0;
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

    subSearchTimer: null,
    onSubSearchInput: function(val) {
        this.subSearchKeyword = (val || '').trim();
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) {
            if (this.subSearchKeyword) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        if (this.subSearchTimer) clearTimeout(this.subSearchTimer);
        this.subSearchTimer = setTimeout(() => {
            this.resetPageAndLoadData();
        }, 350);
    },

    clearSubSearch: function() {
        const input = $('subSearchInput');
        if (input) input.value = '';
        if (this.subSearchTimer) clearTimeout(this.subSearchTimer);
        this.subSearchKeyword = '';
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.resetPageAndLoadData();
    },

    renderFilteredTable: function() {
        const countBadge = $('subSearchCountBadge');
        if (countBadge) {
            if (this.subSearchKeyword) {
                countBadge.innerText = `재검색: ${this.totalItems}건`;
                countBadge.classList.remove('d-none');
            } else {
                countBadge.classList.add('d-none');
            }
        }
        
        this.renderTable(this.items);
    },

    renderTable: function(data) {
        this.keyboardFocusedIndex = -1;
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
            const qtyTotal = Math.round((r.qty || 0) * (r.outbound_price || 0));
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
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" data-confirmed="false" data-account="${r.settlement_account || ''}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted bg-original text-center" style="border-bottom-width: 1px; font-size: 0.73rem; color: #64748b; letter-spacing: -0.2px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.destination || '')}">${r.destination || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">
                            ${r.supplier ? `<span class="text-success fw-semibold" style="font-size: 0.8rem;">${escapeAttr(r.supplier)}</span>` : `<span class="text-muted small">-</span>`}
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
                        
                        <td class="align-middle text-center bg-original text-muted fw-bold" style="font-size: 0.75rem;">출고</td>
                        <td class="align-middle bg-original small"><input type="text" class="text-center edit-input" value="${r.date.split('T')[0]}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${r.qty}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(r.outbound_price || 0).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(supplyAmtOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(vatOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small text-muted"></td>
                        
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            <button class="btn btn-sm btn-primary w-100 fw-bold shadow-sm py-1" style="font-size: 0.75rem;" onclick="app.submitInlineSettlement(${r.id})">정산</button>
                        </td>
                    </tr>
                    <tr class="unsettled-row settle-input-row" data-id="${r.id}" data-shipamt="${shipAmount}" data-shipfee="${r.shipping_fee}" data-shipvatinc="${r.shipping_fee_vat_included}">
                        <td class="align-middle text-center bg-settle-input text-primary" style="border-left: 1px solid #dee2e6; font-size: 0.75rem;">정산</td>
                        <td class="align-middle bg-settle-input small">
                            <input type="date" class="inline-date edit-input text-center" value="${defaultTaxDate}">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-qty edit-input" value="${Number(r.qty).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, true)">
                        </td>
                        <td class="align-middle bg-settle-input small">
                            <input type="text" class="text-end inline-price edit-input" value="${Number(r.outbound_price || 0).toLocaleString()}" oninput="app.formatNumberInput(this); app.calcInline(${r.id}, true)">
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
                const isConfirmed = !!(r.settlement_month && String(r.settlement_month).trim());
                const supplyAmt = Math.round((r.settlement_qty || 0) * (r.settlement_price || 0)) + shipAmount;
                let vat = 0;
                
                if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                    vat = Math.round(Number(r.settlement_vat));
                } else if (r.is_zero_tax || (r.trade_type && r.trade_type !== '내수')) {
                    vat = 0;
                } else {
                    const itemVat = Math.floor(Math.round((r.settlement_qty || 0) * (r.settlement_price || 0)) * 0.1);
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
                            <input class="form-check-input row-chk" type="checkbox" value="${r.id}" data-status="${statusVal}" data-confirmed="${isConfirmed ? 'true' : 'false'}" data-settle-month="${r.settlement_month || ''}" data-account="${r.settlement_account || ''}" onchange="app.updateBatchButton()">
                        </td>
                        <td rowspan="2" class="align-middle text-muted bg-original text-center" style="border-bottom-width: 1px; font-size: 0.73rem; color: #64748b; letter-spacing: -0.2px;">${r.transaction_group_id || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.destination || '')}">${r.destination || ''}</td>
                        <td rowspan="2" class="align-middle bg-original" style="max-width: 110px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.supplier || '')}">
                            ${r.supplier ? `<span class="text-success fw-semibold" style="font-size: 0.8rem;">${escapeAttr(r.supplier)}</span>` : `<span class="text-muted small">-</span>`}
                        </td>
                        <td rowspan="2" class="align-middle fw-bold bg-original" style="max-width: 160px; font-size: 0.825rem; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.item)}">${itemDisplay}</td>
                        <td rowspan="2" class="align-middle small bg-original" style="max-width: 90px; word-break: break-all; overflow-wrap: anywhere; border-bottom-width: 1px;" title="${escapeAttr(r.spec || '-')}">${r.spec || '-'}</td>
                        <td rowspan="2" class="align-middle small text-center bg-original" style="max-width: 50px; border-bottom-width: 1px;">${r.unit || '-'}</td>
                        <td rowspan="2" class="align-middle text-center bg-original p-1" style="max-width: 125px; border-bottom-width: 1px;">
                            ${accountBadge}
                            ${isConfirmed ? `<div class="mt-1"><span class="badge bg-secondary bg-opacity-25 text-secondary border border-secondary px-1 py-0" style="font-size:0.7rem;"><i class='bx bxs-lock-alt'></i> 잠김</span></div>` : ''}
                        </td>
                        
                        <td class="align-middle text-center bg-original text-muted fw-bold" style="font-size: 0.75rem;">출고</td>
                        <td class="align-middle bg-original small"><input type="text" class="text-center edit-input" value="${r.date.split('T')[0]}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${r.qty}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(r.outbound_price || 0).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(supplyAmtOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input" value="${Number(vatOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small"><input type="text" class="text-end edit-input fw-bold" value="${Number(totalOrig).toLocaleString()}" disabled></td>
                        <td class="align-middle bg-original small text-muted"></td>
                        
                        <td rowspan="2" class="text-center align-middle bg-original" style="border-bottom-width: 1px;">
                            ${isConfirmed ? `
                                <span class="badge bg-dark bg-opacity-75 text-white border border-secondary shadow-sm px-2 py-1 d-inline-flex align-items-center gap-1" title="월간현황에서 확정 완료된 건으로 정산 취소가 잠겨있습니다.">
                                    <i class='bx bxs-lock-alt text-warning'></i> ${r.settlement_month} 확정
                                </span>
                            ` : `
                                <span class="badge bg-success shadow-sm px-2 py-1">정산완료</span>
                            `}
                        </td>
                    </tr>
                    <tr class="settled-row bg-settled-row settle-input-row" data-id="${r.id}" data-shipamt="${shipAmount}" data-shipfee="${r.shipping_fee}" data-shipvatinc="${r.shipping_fee_vat_included}">
                        <td class="align-middle text-center bg-settle-input ${isConfirmed ? 'text-secondary' : 'text-success'} small fw-bold" style="border-left: 1px solid #dee2e6;">
                            ${isConfirmed ? `<i class='bx bxs-lock-alt text-secondary'></i> 확정완료` : `정산완료`}
                        </td>
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
        
        // 데이터가 렌더링 된 후 ERP 시트 리사이저 이벤트 등록
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('mainTable', { storageKey: 'kng_sales_grid_widths' });
        }
    },

    updatePagination: function() {
        const isAll = this.limit >= 999999;
        if (isAll) {
            $('pageInfo').innerText = `1 - ${this.totalItems} (총 ${this.totalItems}건 전체)`;
            $('pagination').innerHTML = '';
            return;
        }
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
        let selectedQty = 0;
        let selectedSum = 0;
        let selectedVat = 0;
        
        checkedBoxes.forEach(el => {
            if (el.dataset.status === '미정산') hasUnsettled = true;
            if (el.dataset.status === '정산완료') hasSettled = true;

            const rowId = el.value;
            const inputRow = document.querySelector(`tr.settle-input-row[data-id="${rowId}"]`);
            let rowQty = null;
            let rowSupply = null;
            let rowVat = null;

            if (inputRow) {
                // 수량
                const qtyInput = inputRow.querySelector('.inline-qty');
                if (qtyInput && qtyInput.value !== undefined && qtyInput.value !== '') {
                    rowQty = parseFloat(qtyInput.value.replace(/,/g, '')) || 0;
                } else {
                    const qtyCell = inputRow.querySelector('td:nth-child(3)');
                    if (qtyCell) {
                        rowQty = parseFloat(qtyCell.innerText.replace(/,/g, '')) || 0;
                    }
                }

                // 공급가
                const supplyInput = inputRow.querySelector('.inline-supply-amt');
                if (supplyInput && supplyInput.value !== undefined && supplyInput.value !== '') {
                    rowSupply = parseFloat(supplyInput.value.replace(/,/g, '')) || 0;
                } else {
                    const supplyCell = inputRow.querySelector('td:nth-child(5)');
                    if (supplyCell) {
                        rowSupply = parseFloat(supplyCell.innerText.replace(/,/g, '')) || 0;
                    }
                }

                // 부가세
                const vatInput = inputRow.querySelector('.inline-vat');
                if (vatInput && vatInput.value !== undefined && vatInput.value !== '') {
                    rowVat = parseFloat(vatInput.value.replace(/,/g, '')) || 0;
                } else {
                    const vatCell = inputRow.querySelector('td:nth-child(6)');
                    if (vatCell) {
                        rowVat = parseFloat(vatCell.innerText.replace(/,/g, '')) || 0;
                    }
                }
            }

            const r = (this.items || []).find(item => item.id == rowId);
            if (rowQty === null) {
                rowQty = Number(r ? (r.settlement_qty ?? r.qty ?? 0) : 0);
            }
            if (rowSupply === null) {
                if (r) {
                    const shipAmount = r.shipping_fee > 0 ? (r.shipping_fee_vat_included === 1 ? Math.round(r.shipping_fee / 1.1) : r.shipping_fee) : 0;
                    const q = Number(r.settlement_qty ?? r.qty ?? 0);
                    const p = Number(r.settlement_price ?? r.outbound_price ?? 0);
                    rowSupply = Math.round(q * p) + shipAmount;
                } else {
                    rowSupply = 0;
                }
            }
            if (rowVat === null) {
                if (r) {
                    if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                        rowVat = Math.round(Number(r.settlement_vat));
                    } else if (r.is_zero_tax || (r.trade_type && r.trade_type !== '내수')) {
                        rowVat = 0;
                    } else {
                        const shipAmount = r.shipping_fee > 0 ? (r.shipping_fee_vat_included === 1 ? Math.round(r.shipping_fee / 1.1) : r.shipping_fee) : 0;
                        const itemVat = Math.floor(Math.round((r.settlement_qty || r.qty || 0) * (r.settlement_price || r.outbound_price || 0)) * 0.1);
                        let shipVat = 0;
                        if (r.shipping_fee > 0) {
                            shipVat = r.shipping_fee_vat_included === 1 ? (r.shipping_fee - shipAmount) : Math.floor(shipAmount * 0.1);
                        }
                        rowVat = itemVat + shipVat;
                    }
                } else {
                    rowVat = 0;
                }
            }

            selectedQty += rowQty;
            selectedSum += rowSupply;
            selectedVat += rowVat;
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
                sumBadge.innerText = `선택 합계(공급가): ${Math.round(selectedSum).toLocaleString()}원`;
                sumBadge.title = '선택된 항목들의 공급가액 합계 (VAT 별도)';
                sumBadge.classList.remove('d-none');
            } else {
                sumBadge.classList.add('d-none');
            }
        }

        // 플로팅 선택 요약 바 갱신
        const floatBar = $('floatingSalesBar');
        if (floatBar) {
            if (checkedBoxes.length > 0) {
                const countEl = $('floatSalesCount');
                if (countEl) countEl.innerText = checkedBoxes.length;

                const qtyEl = $('floatSalesQty');
                if (qtyEl) qtyEl.innerText = Math.round(selectedQty).toLocaleString();

                const supplyEl = $('floatSalesSupply');
                if (supplyEl) supplyEl.innerText = `${Math.round(selectedSum).toLocaleString()}원`;

                const vatEl = $('floatSalesVat');
                if (vatEl) vatEl.innerText = `${Math.round(selectedVat).toLocaleString()}원`;

                const grandEl = $('floatSalesGrand');
                if (grandEl) grandEl.innerText = `${Math.round(selectedSum + selectedVat).toLocaleString()}원`;

                const floatBatchBtn = $('floatSalesBatchBtn');
                if (floatBatchBtn) floatBatchBtn.style.display = hasUnsettled ? 'inline-flex' : 'none';

                const floatCancelBtn = $('floatSalesCancelBtn');
                if (floatCancelBtn) floatCancelBtn.style.display = hasSettled ? 'inline-flex' : 'none';

                floatBar.classList.add('show');
            } else {
                floatBar.classList.remove('show');
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

        // 월간확정 잠금 검사
        const confirmedChecked = checkedBoxes.filter(chk => chk.dataset.confirmed === 'true');
        if (confirmedChecked.length > 0) {
            return alert(`선택된 항목 중 월간 확정이 완료되어 잠긴 항목이 ${confirmedChecked.length}건 포함되어 있습니다.\n확정된 항목은 자재계정을 변경할 수 없습니다.\n(월간현황 메뉴에서 확정 해제 후 변경 가능합니다.)`);
        }

        const ids = [];
        checkedBoxes.forEach(chk => {
            const tr = chk.closest('tr');
            const select = tr ? tr.querySelector('.inline-account') : null;
            if (select) select.value = accountVal;
            chk.dataset.account = accountVal;
            ids.push(parseInt(chk.value));
        });

        try {
            const res = await window.authFetch(`${API_BASE}/settlement/outbound`, {
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
        const item = this.items.find(it => it.id == rowId);
        if (item && item.settlement_month && String(item.settlement_month).trim()) {
            alert(`[${item.settlement_month}] 월간 확정이 완료되어 자재계정을 변경할 수 없습니다.\n월간현황 메뉴에서 확정을 해제한 후 변경해주세요.`);
            selectEl.value = item.settlement_account || '';
            return;
        }

        const accountVal = selectEl.value;
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/outbound`, {
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
            url.searchParams.append('type', 'outbound');
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
        
        const itemSupplyAmt = Math.round(qty * price);
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

        this.updateBatchButton();
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
        const item = this.items.find(it => it.id == rowId);
        if (item && item.settlement_month && String(item.settlement_month).trim()) {
            return alert(`[${item.settlement_month}] 월간 확정이 완료되어 정산 내역을 수정할 수 없습니다.\n월간현황 메뉴에서 확정을 해제한 후 진행해주세요.`);
        }

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
            const res = await window.authFetch(`${API_BASE}/settlement/outbound`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    items: [{
                        id: rowId,
                        settlement_account: accountVal,
                        tax_invoice_date: taxDate,
                        settlement_month: '',
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
                    settlement_month: '',
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
            const res = await window.authFetch(`${API_BASE}/settlement/outbound`, {
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
        const checked = Array.from(document.querySelectorAll('.row-chk:checked'));
        const confirmedItems = checked.filter(el => el.dataset.confirmed === 'true');
        if (confirmedItems.length > 0) {
            const months = [...new Set(confirmedItems.map(el => el.dataset.settleMonth).filter(Boolean))].join(', ');
            return alert(`선택한 항목 중 이미 [${months}] 월간 확정이 완료된 내역이 ${confirmedItems.length}건 포함되어 있습니다.\n\n월간 확정된 내역은 정산을 취소할 수 없습니다.\n취소가 꼭 필요하시다면 먼저 [월간현황] 메뉴에서 해당 월의 확정을 해제해주세요.`);
        }

        const ids = [];
        checked.forEach(el => {
            if(el.dataset.status === '정산완료') {
                ids.push(parseInt(el.value));
            }
        });
        
        if(ids.length === 0) return alert('취소할 정산완료 내역이 선택되지 않았습니다.');
        if(!confirm(`선택한 ${ids.length}건을 정산 취소하시겠습니까?\n(다시 미정산 상태로 돌아가며 정산일자는 초기화됩니다.)`)) return;
        
        try {
            const res = await window.authFetch(`${API_BASE}/settlement/outbound`, { // cancel URL 수정
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
    
    downloadSelectedExcel: async function() {
        const checkedBoxes = document.querySelectorAll('.row-chk:checked');
        if (checkedBoxes.length === 0) {
            alert('엑셀로 다운로드할 항목을 선택해주세요.');
            return;
        }

        const selectedIds = Array.from(checkedBoxes).map(el => parseInt(el.value));
        const selectedRows = this.items.filter(r => selectedIds.includes(r.id));
        if (selectedRows.length === 0) return;

        try {
            const ExcelJS = window.ExcelJS;
            if (!ExcelJS) {
                alert('엑셀 라이브러리를 불러오지 못했습니다. 페이지를 새로고침 해주세요.');
                return;
            }
            
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('매출정산내역');

            worksheet.columns = [
                { header: '출고일자', key: 'date', width: 15 },
                { header: '정산일자', key: 'tax_date', width: 15 },
                { header: '상태', key: 'status', width: 12 },
                { header: '매출처', key: 'destination', width: 25 },
                { header: '품명', key: 'item', width: 25 },
                { header: '규격', key: 'spec', width: 15 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '자재계정', key: 'account', width: 15 },
                { header: '정산(출고)수량', key: 'qty', width: 15 },
                { header: '정산(출고)단가', key: 'price', width: 15 },
                { header: '배송비', key: 'ship', width: 15 },
                { header: '공급가액', key: 'supply', width: 15 },
                { header: '부가세', key: 'vat', width: 15 },
                { header: '합계금액', key: 'total', width: 15 }
            ];

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

            selectedRows.forEach(r => {
                const isSettled = r.settlement_status === '정산완료';
                const qty = isSettled ? (r.settlement_qty || 0) : (r.qty || 0);
                const price = isSettled ? (r.settlement_price || 0) : (r.outbound_price || 0);
                
                let shipAmount = 0;
                if (r.shipping_fee > 0) {
                    shipAmount = r.shipping_fee_vat_included === 1 ? Math.round(r.shipping_fee / 1.1) : r.shipping_fee;
                }
                
                const itemSupply = Math.round(qty * price);
                const supplyAmt = itemSupply + shipAmount;
                
                let vat = 0;
                if (r.settlement_vat !== undefined && r.settlement_vat !== null) {
                    vat = Math.round(Number(r.settlement_vat));
                } else if (!r.is_zero_tax && (!r.trade_type || r.trade_type === '내수')) {
                    const itemVat = Math.floor(itemSupply * 0.1);
                    let shipVat = 0;
                    if (r.shipping_fee > 0) {
                        shipVat = r.shipping_fee_vat_included === 1 ? r.shipping_fee - shipAmount : Math.floor(shipAmount * 0.1);
                    }
                    vat = itemVat + shipVat;
                }
                
                const totalAmt = supplyAmt + vat;

                worksheet.addRow({
                    date: r.date ? r.date.split('T')[0] : '',
                    tax_date: r.tax_invoice_date ? r.tax_invoice_date.split('T')[0] : '',
                    status: r.settlement_status || '미정산',
                    destination: r.destination,
                    item: r.item + (r.is_direct ? ' (직출고)' : ''),
                    spec: r.spec,
                    unit: r.unit,
                    account: r.settlement_account || '',
                    qty: qty,
                    price: price,
                    ship: r.shipping_fee || 0,
                    supply: supplyAmt,
                    vat: vat,
                    total: totalAmt
                });
            });

            worksheet.getColumn('qty').numFmt = '#,##0.00';
            worksheet.getColumn('price').numFmt = '#,##0';
            worksheet.getColumn('ship').numFmt = '#,##0';
            worksheet.getColumn('supply').numFmt = '#,##0';
            worksheet.getColumn('vat').numFmt = '#,##0';
            worksheet.getColumn('total').numFmt = '#,##0';

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `매출정산내역_${new Date().toISOString().split('T')[0]}.xlsx`;
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
            const isSettled = r.settlement_status === '정산완료';
            const qty = isSettled ? (r.settlement_qty || 0) : (r.qty || 0);
            const price = isSettled ? (r.settlement_price || 0) : (r.outbound_price || 0);
            
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
            
            const total = Math.round(qty * price) + shipAmount;
            const isZeroTax = r.is_zero_tax || (r.trade_type && r.trade_type !== '내수');
            let vat = 0;
            if (!isZeroTax) {
                const itemVat = Math.floor(Math.round(qty * price) * 0.1);
                vat = (isSettled && r.settlement_vat !== undefined && r.settlement_vat !== null) 
                    ? Math.round(Number(r.settlement_vat)) 
                    : (itemVat + shipVat);
            }
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
                <td>출고</td>
                <td>${r.date ? r.date.split('T')[0] : ''}</td>
                <td>${r.destination || ''}</td>
                <td>${r.settlement_account || '-'}</td>
                <td>${itemHtml}</td>
                <td>${r.spec || ''} ${r.unit ? '/ ' + r.unit : ''}</td>
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
                                <h2 style="margin: 0; font-size: 24px; font-weight: bold; border-bottom: 2px solid #000; padding-bottom: 10px; display: inline-block;">거래내역서 (매출)</h2>
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
