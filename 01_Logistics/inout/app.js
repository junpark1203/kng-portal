/**
 * 입출고 관리 프론트엔드 로직
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    window.parent.getAuthToken().then(t => {
                        if (t) { res(t); }
                        else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                        else { _authReady = Promise.resolve(null); res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = Promise.resolve(null); res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = Promise.resolve(null); res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = Promise.resolve(null); res(null); }
            }
        })();
    });
    return _authReady;
}

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    if (!token) {
        try { token = await waitForAuth(); } catch(e) {}
    }
    
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    options.headers['Content-Type'] = 'application/json';
    
    let res;
    try {
        res = await fetch(url, options);
    } catch (netErr) {
        throw new Error(`서버 통신 실패 (네트워크 또는 서버 응답 오류: ${netErr.message})`);
    }
    if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return res.json();
}

const $ = id => document.getElementById(id);
let locations = [];
let availableLots = []; // 출고 시 선택된 품목+규격의 잔여 Lot 목록

const app = {
    keyboardFocusedIndex: -1,

    init: async function() {
        this.bindEvents();
        await this.loadLocations();
        this.initTodayDates();
        this.setupInboundAutocomplete();
        this.setupOutboundAutocomplete();
        this.setupPartnerAutocomplete();
        this.loadCategories();
        this.loadItemSpecsMap();
        this.loadUnitPricesMap();
        const urlParams = new URLSearchParams(window.location.search);
        const searchParam = urlParams.get('search');
        if (searchParam) {
            if ($('historySearch')) $('historySearch').value = searchParam;
            if ($('mobileSearchInput')) $('mobileSearchInput').value = searchParam;
            if ($('clearSearchBtn')) $('clearSearchBtn').classList.remove('d-none');
            if ($('mobileClearSearchBtn')) $('mobileClearSearchBtn').classList.remove('d-none');
        }
        this.loadHistory();
        this.initKeyboardNav();
        this.bindGlobalModalShortcuts();
        this.initGridColumnResizing();
        this.initMobileUI();
    },

    bindGlobalModalShortcuts: function() {
        document.addEventListener('keydown', (e) => {
            const inModal = document.getElementById('inboundModal');
            const outModal = document.getElementById('outboundModal');
            const dirModal = document.getElementById('directModal');

            const isInOpen = inModal && inModal.classList.contains('show');
            const isOutOpen = outModal && outModal.classList.contains('show');
            const isDirOpen = dirModal && dirModal.classList.contains('show');

            if (!isInOpen && !isOutOpen && !isDirOpen) return;

            if (e.key === 'F3') {
                e.preventDefault();
                if (isInOpen) app.addInboundItemRow(true);
                else if (isOutOpen) app.addOutboundItemRow(true);
                else if (isDirOpen) app.addDirectItemRow(true);
            } else if (e.key === 'F8') {
                e.preventDefault();
                if (isInOpen) {
                    const submitBtn = document.querySelector('#inboundForm button[type="submit"]');
                    if (submitBtn) submitBtn.click();
                } else if (isOutOpen) {
                    const submitBtn = document.getElementById('btnOutboundSubmit');
                    if (submitBtn) submitBtn.click();
                } else if (isDirOpen) {
                    const submitBtn = document.querySelector('#directForm button[type="submit"]');
                    if (submitBtn) submitBtn.click();
                }
            }
        });
    },

    initGridColumnResizing: function() {
        const modalTableMap = {
            'inboundModal': 'inboundSheetTable',
            'outboundModal': 'outboundSheetTable',
            'directModal': 'directSheetTable'
        };

        Object.entries(modalTableMap).forEach(([modalId, tableId]) => {
            const modalEl = document.getElementById(modalId);
            if (modalEl) {
                modalEl.addEventListener('shown.bs.modal', () => {
                    setTimeout(() => this.setupTableColumnResizing(tableId), 50);
                });
            }
        });

        ['inboundSheetTable', 'outboundSheetTable', 'directSheetTable', 'historyTable'].forEach(id => {
            this.setupTableColumnResizing(id);
        });
    },

    setupTableColumnResizing: function(tableId) {
        const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
        if (!table) return;

        const thead = table.querySelector('thead');
        if (!thead) return;
        const headerRow = thead.querySelector('tr');
        if (!headerRow) return;
        const ths = Array.from(headerRow.querySelectorAll('th'));
        if (ths.length === 0) return;

        const isMainHistory = (table.id === 'historyTable');

        // 원본 너비 속성 보존
        ths.forEach(th => {
            if (!th.getAttribute('data-original-width')) {
                th.setAttribute('data-original-width', th.style.width || '');
            }
        });

        let colgroup = table.querySelector('colgroup');
        if (!colgroup) {
            colgroup = document.createElement('colgroup');
            ths.forEach(() => {
                const col = document.createElement('col');
                colgroup.appendChild(col);
            });
            table.insertBefore(colgroup, thead);
        }
        const cols = Array.from(colgroup.querySelectorAll('col'));

        const wrapper = table.closest('.erp-grid-wrapper') || table.closest('.erp-main-grid-wrapper');
        if (wrapper) {
            wrapper.style.overflowX = 'auto';
        }

        const saveTableWidths = () => {
            if (!isMainHistory) return;
            const widths = cols.map(c => parseFloat(c.style.width) || 0);
            try {
                localStorage.setItem('kng_history_col_widths', JSON.stringify(widths));
            } catch (err) {}
        };

        const loadSavedWidths = () => {
            if (!isMainHistory) return false;
            try {
                const raw = localStorage.getItem('kng_history_col_widths');
                if (raw) {
                    const widths = JSON.parse(raw);
                    if (Array.isArray(widths) && widths.length === cols.length) {
                        let totalW = 0;
                        widths.forEach((w, idx) => {
                            if (w > 0 && cols[idx]) {
                                cols[idx].style.width = w + 'px';
                                if (ths[idx]) ths[idx].style.width = w + 'px';
                                totalW += w;
                            }
                        });
                        if (totalW > 0) {
                            table.style.setProperty('width', totalW + 'px', 'important');
                            return true;
                        }
                    }
                }
            } catch (err) {}
            return false;
        };

        const syncColWidths = () => {
            if (table.offsetWidth <= 0) return;
            let totalW = 0;
            ths.forEach((th, idx) => {
                if (cols[idx]) {
                    const w = Math.round(th.getBoundingClientRect().width);
                    if (w > 0) {
                        cols[idx].style.width = w + 'px';
                        th.style.width = w + 'px';
                        totalW += w;
                    }
                }
            });
            if (totalW > 0) {
                table.style.setProperty('width', totalW + 'px', 'important');
            }
        };

        if (!loadSavedWidths()) {
            if (table.offsetWidth > 0) {
                syncColWidths();
            }
        }

        let measureCanvas = null;
        const measureTextWidth = (text, font) => {
            if (!measureCanvas) measureCanvas = document.createElement('canvas');
            const ctx = measureCanvas.getContext('2d');
            ctx.font = font || '12px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            return ctx.measureText(text).width;
        };

        ths.forEach((th, colIdx) => {
            if (colIdx >= ths.length - 1 && (th.textContent.trim() === 'DEL' || th.textContent.trim() === '관리')) return;

            th.style.position = 'sticky';
            th.style.top = '0';
            th.style.overflow = 'visible';

            let resizer = th.querySelector('.col-resizer');
            if (!resizer) {
                resizer = document.createElement('div');
                resizer.className = 'col-resizer';
                resizer.setAttribute('title', '드래그: 열 너비 조절 / 더블클릭: 내용 맞춤 자동 너비');
                th.appendChild(resizer);
            }

            // 정렬 클릭 이벤트 전파 차단
            resizer.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            let startX = 0;
            let startWidth = 0;
            let isDragging = false;

            const onMouseMove = (e) => {
                if (!isDragging) return;
                const diff = e.pageX - startX;
                const minW = colIdx === 0 ? 32 : 40;
                const newW = Math.max(minW, Math.round(startWidth + diff));
                if (cols[colIdx]) {
                    cols[colIdx].style.width = newW + 'px';
                }
                if (ths[colIdx]) {
                    ths[colIdx].style.width = newW + 'px';
                }
                let total = 0;
                cols.forEach(c => {
                    total += parseFloat(c.style.width) || 50;
                });
                table.style.setProperty('width', total + 'px', 'important');
            };

            const onMouseUp = () => {
                if (!isDragging) return;
                isDragging = false;
                resizer.classList.remove('is-resizing');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                saveTableWidths();
            };

            resizer.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                syncColWidths();
                startX = e.pageX;
                startWidth = th.getBoundingClientRect().width;
                isDragging = true;
                resizer.classList.add('is-resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            // 더블클릭 시 조회된 내용의 길이에 맞춰 자동 너비 맞춤 (Auto-Fit)
            resizer.ondblclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                syncColWidths();

                // 1. 헤더 텍스트 너비 측정
                const clone = th.cloneNode(true);
                const r = clone.querySelector('.col-resizer');
                if (r) r.remove();
                const headerText = clone.textContent.replace(/\s+/g, ' ').trim();
                const headerFont = 'bold 12px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                let maxW = measureTextWidth(headerText, headerFont) + 16;

                // 2. 본문 셀들의 텍스트 너비 측정
                const cellFont = '12px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
                const tbody = table.querySelector('tbody');
                if (tbody) {
                    const rows = tbody.querySelectorAll('tr');
                    rows.forEach(row => {
                        // 아코디언 서브 로우 및 안내용 colspan 행 제외
                        if (row.classList.contains('accordion-sub-row') || row.querySelector('td[colspan]')) return;
                        const cell = row.cells[colIdx];
                        if (!cell || cell.colSpan > 1) return;
                        let text = '';
                        const input = cell.querySelector('input');
                        const select = cell.querySelector('select');
                        const btn = cell.querySelector('button');

                        if (input && input.type !== 'checkbox') {
                            text = input.value || input.placeholder || '';
                        } else if (select) {
                            const opt = select.options[select.selectedIndex];
                            text = opt ? opt.text : (select.placeholder || '');
                        } else if (btn) {
                            text = btn.textContent.trim();
                        } else {
                            text = cell.innerText ? cell.innerText.replace(/\n/g, ' ').trim() : cell.textContent.trim();
                        }

                        if (text) {
                            let w = measureTextWidth(text, cellFont);
                            // 고유번호 열: 아코디언 화살표 아이콘 너비 반영
                            if (cell.querySelector('.accordion-icon')) {
                                w += 20;
                            }
                            // 배지 패딩 반영
                            if (cell.querySelector('.erp-badge')) {
                                w += 14;
                            }
                            // 관리 열: 버튼 최소폭 보장
                            if (cell.querySelectorAll('.btn-grid-action').length > 0) {
                                w = Math.max(w, 64);
                            }
                            if (w > maxW) maxW = w;
                        }
                    });
                }

                // 3. 패딩 + 여유 공간 포함 타겟 너비 계산
                const minW = colIdx === 0 ? 32 : 44;
                const targetW = Math.max(minW, Math.round(maxW + 20));

                if (cols[colIdx]) {
                    cols[colIdx].style.width = targetW + 'px';
                }
                if (ths[colIdx]) {
                    ths[colIdx].style.width = targetW + 'px';
                }

                let total = 0;
                cols.forEach(c => {
                    total += parseFloat(c.style.width) || 50;
                });
                table.style.setProperty('width', total + 'px', 'important');
                saveTableWidths();
            };
        });
    },

    autoFitAllHistoryColumns: function() {
        const table = document.getElementById('historyTable');
        if (!table) return;
        const thead = table.querySelector('thead');
        if (!thead) return;
        const resizers = thead.querySelectorAll('.col-resizer');
        resizers.forEach(r => {
            if (r.ondblclick) {
                r.ondblclick(new MouseEvent('dblclick', { bubbles: false, cancelable: true }));
            }
        });
        if (typeof showToast === 'function') {
            showToast('모든 열 너비가 데이터에 맞게 자동 조정되었습니다.', 'info');
        }
    },

    resetHistoryTableColumnWidths: function() {
        try {
            localStorage.removeItem('kng_history_col_widths');
        } catch (e) {}
        const table = document.getElementById('historyTable');
        if (!table) return;
        const colgroup = table.querySelector('colgroup');
        if (colgroup) colgroup.remove();
        table.style.width = '';
        const ths = table.querySelectorAll('thead th');
        ths.forEach(th => {
            const originalW = th.getAttribute('data-original-width');
            if (originalW) {
                th.style.width = originalW;
            }
        });
        this.setupTableColumnResizing('historyTable');
        if (typeof showToast === 'function') {
            showToast('열 너비가 기본값으로 초기화되었습니다.', 'info');
        }
    },

    bindGridKeyboardAndPaste: function(tr, type) {
        const inputs = Array.from(tr.querySelectorAll('.erp-cell-input:not([readonly]), .btn-lot'));

        inputs.forEach((inp) => {
            inp.addEventListener('keydown', (e) => {
                const activeSug = inp.parentElement ? inp.parentElement.querySelector('.autocomplete-suggestions') : tr.querySelector('.autocomplete-suggestions');
                if (e.key === 'Tab' || e.key === 'Escape') {
                    if (activeSug) activeSug.style.display = 'none';
                }
                if (activeSug && activeSug.style.display === 'block') {
                    if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') return;
                }

                if (e.key === 'Enter') {
                    e.preventDefault();
                    const curIdx = inputs.indexOf(inp);
                    if (curIdx < inputs.length - 1) {
                        const next = inputs[curIdx + 1];
                        if (next && !next.disabled) {
                            next.focus();
                            if (next.select) next.select();
                        } else if (curIdx + 2 < inputs.length) {
                            const nextNext = inputs[curIdx + 2];
                            if (nextNext && !nextNext.disabled) {
                                nextNext.focus();
                                if (nextNext.select) nextNext.select();
                            }
                        }
                    } else {
                        const nextRow = tr.nextElementSibling;
                        if (nextRow) {
                            const firstInp = nextRow.querySelector('.erp-cell-input');
                            if (firstInp) { firstInp.focus(); if (firstInp.select) firstInp.select(); }
                        } else {
                            if (type === 'inbound') app.addInboundItemRow(true);
                            else if (type === 'outbound') app.addOutboundItemRow(true);
                            else if (type === 'direct') app.addDirectItemRow(true);
                        }
                    }
                } else if (e.key === 'ArrowDown') {
                    if (sugBox && sugBox.style.display === 'block') return;
                    const nextRow = tr.nextElementSibling;
                    if (nextRow) {
                        const colClass = Array.from(inp.classList).find(c => c.startsWith('in-') || c.startsWith('out-') || c.startsWith('dir-') || c === 'btn-lot');
                        if (colClass) {
                            const target = nextRow.querySelector('.' + colClass);
                            if (target && !target.disabled) { target.focus(); if (target.select) target.select(); e.preventDefault(); }
                        }
                    }
                } else if (e.key === 'ArrowUp') {
                    if (sugBox && sugBox.style.display === 'block') return;
                    const prevRow = tr.previousElementSibling;
                    if (prevRow) {
                        const colClass = Array.from(inp.classList).find(c => c.startsWith('in-') || c.startsWith('out-') || c.startsWith('dir-') || c === 'btn-lot');
                        if (colClass) {
                            const target = prevRow.querySelector('.' + colClass);
                            if (target && !target.disabled) { target.focus(); if (target.select) target.select(); e.preventDefault(); }
                        }
                    }
                }
            });

            inp.addEventListener('paste', (e) => {
                app.handleGridPaste(e, tr, type);
            });
        });
    },

    handleGridPaste: function(e, startRow, type) {
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;
        const text = clipboardData.getData('text');
        if (!text || !text.includes('\t')) return;

        e.preventDefault();
        const lines = text.trim().split(/\r\n|\n|\r/);
        if (lines.length === 0) return;

        let currentRow = startRow;
        lines.forEach((line, idx) => {
            const cols = line.split('\t');
            if (idx > 0) {
                let nextRow = currentRow.nextElementSibling;
                if (!nextRow) {
                    if (type === 'inbound') app.addInboundItemRow();
                    else if (type === 'outbound') app.addOutboundItemRow();
                    else if (type === 'direct') app.addDirectItemRow();
                    nextRow = currentRow.nextElementSibling;
                }
                currentRow = nextRow;
            }
            if (!currentRow) return;

            if (type === 'inbound') {
                if (cols[0] !== undefined && currentRow.querySelector('.in-item')) currentRow.querySelector('.in-item').value = cols[0].trim();
                if (cols[1] !== undefined && currentRow.querySelector('.in-spec')) currentRow.querySelector('.in-spec').value = cols[1].trim();
                if (cols[2] !== undefined && currentRow.querySelector('.in-category')) currentRow.querySelector('.in-category').value = cols[2].trim();
                if (cols[3] !== undefined && currentRow.querySelector('.in-qty')) currentRow.querySelector('.in-qty').value = cols[3].trim().replace(/,/g, '');
                if (cols[4] !== undefined && currentRow.querySelector('.in-unit')) currentRow.querySelector('.in-unit').value = cols[4].trim();
                if (cols[5] !== undefined && currentRow.querySelector('.in-price')) currentRow.querySelector('.in-price').value = cols[5].trim().replace(/,/g, '');
                if (cols[6] !== undefined && currentRow.querySelector('.in-note')) currentRow.querySelector('.in-note').value = cols[6].trim();
            } else if (type === 'direct') {
                if (cols[0] !== undefined && currentRow.querySelector('.dir-item')) currentRow.querySelector('.dir-item').value = cols[0].trim();
                if (cols[1] !== undefined && currentRow.querySelector('.dir-spec')) currentRow.querySelector('.dir-spec').value = cols[1].trim();
                if (cols[2] !== undefined && currentRow.querySelector('.dir-category')) currentRow.querySelector('.dir-category').value = cols[2].trim();
                if (cols[3] !== undefined && currentRow.querySelector('.dir-qty')) currentRow.querySelector('.dir-qty').value = cols[3].trim().replace(/,/g, '');
                if (cols[4] !== undefined && currentRow.querySelector('.dir-unit')) currentRow.querySelector('.dir-unit').value = cols[4].trim();
                if (cols[5] !== undefined && currentRow.querySelector('.dir-in-price')) currentRow.querySelector('.dir-in-price').value = cols[5].trim().replace(/,/g, '');
                if (cols[6] !== undefined && currentRow.querySelector('.dir-out-price')) currentRow.querySelector('.dir-out-price').value = cols[6].trim().replace(/,/g, '');
                if (cols[7] !== undefined && currentRow.querySelector('.dir-note')) currentRow.querySelector('.dir-note').value = cols[7].trim();
            } else if (type === 'outbound') {
                if (cols[0] !== undefined && currentRow.querySelector('.out-item')) currentRow.querySelector('.out-item').value = cols[0].trim();
                if (cols[1] !== undefined && currentRow.querySelector('.out-category')) currentRow.querySelector('.out-category').value = cols[1].trim();
                if (cols[2] !== undefined && currentRow.querySelector('.out-qty')) currentRow.querySelector('.out-qty').value = cols[2].trim().replace(/,/g, '');
                if (cols[3] !== undefined && currentRow.querySelector('.out-price')) currentRow.querySelector('.out-price').value = cols[3].trim().replace(/,/g, '');
                if (cols[4] !== undefined && currentRow.querySelector('.out-note')) currentRow.querySelector('.out-note').value = cols[4].trim();
            }
        });

        if (type === 'inbound') app.updateInboundGridTotals();
        else if (type === 'outbound') app.updateOutboundGridTotals();
        else if (type === 'direct') app.updateDirectGridTotals();
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

            const mainRows = Array.from(document.querySelectorAll('#historyTbody tr.history-main-row'));
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
                    const chk = targetRow.querySelector('.history-checkbox');
                    if (chk && !chk.disabled) {
                        chk.checked = !chk.checked;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            } else if (e.key === 'Enter') {
                if (this.keyboardFocusedIndex >= 0 && this.keyboardFocusedIndex < mainRows.length) {
                    e.preventDefault();
                    const targetRow = mainRows[this.keyboardFocusedIndex];
                    const rowId = targetRow.id ? targetRow.id.replace('row_', '') : null;
                    const chk = targetRow.querySelector('.history-checkbox');
                    const rowType = chk ? chk.getAttribute('data-type') : 'inbound';
                    if (rowId) {
                        this.toggleAccordion(rowId, rowType);
                    }
                }
            }
        });

        // 마우스 클릭 시 해당 메인 행으로 포커스 인덱스 동기화
        const tbody = document.getElementById('historyTbody');
        if (tbody) {
            tbody.addEventListener('click', (e) => {
                const tr = e.target.closest('tr.history-main-row');
                if (!tr) return;
                const mainRows = Array.from(document.querySelectorAll('#historyTbody tr.history-main-row'));
                const clickedIdx = mainRows.indexOf(tr);
                if (clickedIdx !== -1) {
                    this.setKeyboardFocus(clickedIdx, mainRows, false);
                }
            });
        }
    },

    setKeyboardFocus: function(idx, rows, autoScroll = true) {
        if (!rows || rows.length === 0) return;
        this.keyboardFocusedIndex = Math.max(0, Math.min(idx, rows.length - 1));

        document.querySelectorAll('#historyTbody tr.keyboard-focused-row').forEach(el => el.classList.remove('keyboard-focused-row'));

        const targetRow = rows[this.keyboardFocusedIndex];
        if (targetRow) {
            targetRow.classList.add('keyboard-focused-row');
            if (autoScroll) {
                targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    },

    
    subSearchKeyword: '',
    categoryList: [],
    topCategories: ['유압유', '기어유', '그리스', '테일씰그리스', '절삭유', '작동유'],

    async loadCategories() {
        try {
            const res = await authFetch(`${API_BASE}/categories`);
            const rawList = Array.isArray(res) ? res : [];
            
            // 한글 가나다순 정렬 (ㄱ~ㅎ, A~Z, 0~9)
            this.categoryList = rawList
                .filter(c => c && c.trim())
                .map(c => c.trim())
                .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));

            const datalist = $('categoryDatalist');
            if (datalist) {
                datalist.innerHTML = this.categoryList.map(c => `<option value="${c}"></option>`).join('');
            }

            this.renderCategoryPills();
            this.setupCategoryAutocomplete();
        } catch (err) {
            console.error('Failed to load categories', err);
        }
    },

    enableDragToScroll: function(el) {
        if (!el || el._dragScrollEnabled) return;
        el._dragScrollEnabled = true;
        let isDown = false;
        let startX = 0;
        let scrollLeft = 0;
        let isDragging = false;

        el.addEventListener('mousedown', (e) => {
            isDown = true;
            isDragging = false;
            startX = e.pageX - el.offsetLeft;
            scrollLeft = el.scrollLeft;
        });

        window.addEventListener('mouseup', () => {
            if (isDown) {
                isDown = false;
                setTimeout(() => {
                    isDragging = false;
                    el.classList.remove('is-dragging');
                }, 50);
            }
        });

        el.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            const x = e.pageX - el.offsetLeft;
            const walk = (x - startX) * 1.5;
            if (Math.abs(walk) > 4) {
                isDragging = true;
                el.classList.add('is-dragging');
                e.preventDefault();
                el.scrollLeft = scrollLeft - walk;
            }
        });

        // Prevent firing click on pills if user was dragging horizontally
        el.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        // Vertical mouse wheel converts to smooth horizontal scroll
        el.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
                e.preventDefault();
                el.scrollLeft += (e.deltaY * 0.8);
            }
        }, { passive: false });
    },

    renderCategoryPills() {
        const pillsContainer = $('categoryPillsContainer');
        if (!pillsContainer) return;

        const currentCat = this.detailedFilters.category || '';
        const isAllActive = !currentCat;
        
        // ----------------------------------------
        // 1. 데스크톱용: 상위 6개 퀵 버튼 + 가나다순 전체 드롭다운
        // ----------------------------------------
        const topSet = new Set();
        const quickList = [];
        this.topCategories.forEach(c => {
            if (this.categoryList.includes(c)) {
                topSet.add(c);
                quickList.push(c);
            }
        });
        this.categoryList.forEach(c => {
            if (quickList.length < 6 && !topSet.has(c)) {
                topSet.add(c);
                quickList.push(c);
            }
        });

        let desktopHtml = `
            <div class="desktop-category-bar d-none d-md-flex align-items-center gap-2 flex-wrap w-100">
                <span class="text-secondary fw-semibold d-inline-flex align-items-center me-1" style="font-size:0.85rem;">
                    <i class='bx bx-purchase-tag-alt text-primary me-1'></i>분류:
                </span>
                <button type="button" class="btn btn-sm ${isAllActive ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3" onclick="app.filterByCategory('')">
                    전체보기
                </button>
        `;

        quickList.forEach(c => {
            const isActive = currentCat === c;
            desktopHtml += `
                <button type="button" class="btn btn-sm ${isActive ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3" onclick="app.filterByCategory('${c}')">
                    ${c}
                </button>
            `;
        });

        const isCustomSelected = currentCat && !topSet.has(currentCat);
        if (isCustomSelected) {
            desktopHtml += `
                <button type="button" class="btn btn-sm btn-primary text-white rounded-pill px-3 d-inline-flex align-items-center gap-1 shadow-sm fw-bold" onclick="app.filterByCategory('')" title="필터 해제">
                    <span>${currentCat}</span>
                    <i class='bx bx-x' style="font-size: 1.15rem;"></i>
                </button>
            `;
        }

        const dropdownBtnText = currentCat ? `분류: ${currentCat}` : `분류 전체 선택 / 검색 (${this.categoryList.length}개)`;
        const isDropdownHighlight = isCustomSelected;

        desktopHtml += `
                <div class="dropdown d-inline-block position-relative" id="categoryDropdownContainer">
                    <button type="button" class="btn btn-sm ${isDropdownHighlight ? 'btn-primary text-white fw-bold' : 'btn-outline-secondary'} rounded-pill dropdown-toggle px-3 d-inline-flex align-items-center gap-1 shadow-sm" data-bs-toggle="dropdown" aria-expanded="false" data-bs-auto-close="outside" id="btnCategoryDropdown">
                        <i class='bx bx-search-alt-2'></i>
                        <span>${dropdownBtnText}</span>
                    </button>
                    <div class="dropdown-menu shadow-lg p-2 border-0" style="min-width: 270px; max-width: 320px; z-index: 1080; border-radius: 10px;" id="categoryDropdownMenu">
                        <div class="p-1 mb-2 position-relative">
                            <input type="text" class="form-control form-control-sm ps-4" id="categoryDropdownSearchInput" placeholder="분류 검색 (가나다순)..." autocomplete="off" oninput="app.filterCategoryDropdownList(this.value)">
                            <i class='bx bx-search position-absolute top-50 start-0 translate-middle-y ms-3 text-muted' style="font-size:0.9rem;"></i>
                        </div>
                        <div class="list-group list-group-flush overflow-auto" id="categoryDropdownList" style="max-height: 240px;">
                            <button type="button" class="list-group-item list-group-item-action py-2 px-3 border-0 rounded text-start ${!currentCat ? 'active fw-bold' : ''}" onclick="app.filterByCategory(''); app.closeCategoryDropdown();" style="font-size:0.85rem;">
                                <i class='bx bx-check-circle me-1'></i> 전체보기
                            </button>
                            ${this.categoryList.map(c => {
                                const isItemActive = currentCat === c;
                                return `
                                    <button type="button" class="list-group-item list-group-item-action py-2 px-3 border-0 rounded text-start cat-drop-item ${isItemActive ? 'active fw-bold' : ''}" data-category="${c}" onclick="app.filterByCategory('${c}'); app.closeCategoryDropdown();" style="font-size:0.85rem;">
                                        <i class='bx bx-purchase-tag-alt text-secondary me-1'></i> ${c}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // ----------------------------------------
        // 2. 모바일용: 전체 카테고리 무제한 터치/드래그 가로 스와이프 칩 바
        // ----------------------------------------
        const mobileHtml = `
            <div class="mobile-cat-scroll-wrapper d-md-none w-100">
                <div class="category-pills-scroll-track" id="mobileCategoryScrollTrack">
                    <button type="button" class="btn btn-sm ${isAllActive ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3 flex-shrink-0" onclick="app.filterByCategory('')">
                        전체보기
                    </button>
                    ${this.categoryList.map(c => {
                        const isActive = currentCat === c;
                        return `
                            <button type="button" class="btn btn-sm ${isActive ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3 flex-shrink-0" onclick="app.filterByCategory('${c}')">
                                ${c}
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        pillsContainer.innerHTML = desktopHtml + mobileHtml;

        // 모바일 가로 스크롤 트랙에 마우스 드래그 & 휠 & 활성 버튼 자동 중앙 정렬 연결
        const scrollTrack = $('mobileCategoryScrollTrack');
        if (scrollTrack) {
            this.enableDragToScroll(scrollTrack);
            const activeBtn = scrollTrack.querySelector('.btn-primary');
            if (activeBtn) {
                setTimeout(() => {
                    activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                }, 60);
            }
        }
    },

    filterCategoryDropdownList(query) {
        const q = (query || '').trim().toLowerCase();
        const items = document.querySelectorAll('#categoryDropdownList .cat-drop-item');
        let visibleCount = 0;
        
        items.forEach(item => {
            const cat = (item.dataset.category || '').toLowerCase();
            if (!q || cat.includes(q)) {
                item.style.setProperty('display', 'block', 'important');
                visibleCount++;
            } else {
                item.style.setProperty('display', 'none', 'important');
            }
        });

        let noResultEl = $('categoryDropdownNoResult');
        if (visibleCount === 0 && q) {
            if (!noResultEl) {
                noResultEl = document.createElement('div');
                noResultEl.id = 'categoryDropdownNoResult';
                noResultEl.className = 'text-center py-3 text-muted';
                noResultEl.style.fontSize = '0.8rem';
                noResultEl.innerHTML = "<i class='bx bx-info-circle me-1'></i> 일치하는 분류가 없습니다.";
                const listEl = $('categoryDropdownList');
                if (listEl) listEl.appendChild(noResultEl);
            }
            noResultEl.style.display = 'block';
        } else if (noResultEl) {
            noResultEl.style.display = 'none';
        }
    },

    closeCategoryDropdown() {
        const btn = $('btnCategoryDropdown');
        if (btn) {
            const dropdown = bootstrap.Dropdown.getInstance(btn);
            if (dropdown) dropdown.hide();
        }
    },

    // ----------------------------------------
    // Autocomplete UI Helpers & Enhancements
    // ----------------------------------------
    escapeHtml: function(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    highlightMatch: function(text, query) {
        if (!text) return '';
        const safeText = this.escapeHtml(text);
        const q = (query || '').trim();
        if (!q) return safeText;
        const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedQ})`, 'gi');
        return safeText.replace(regex, '<mark>$1</mark>');
    },

    positionAutocomplete: function(input, sug) {
        if (!input || !sug) return;
        const rect = input.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < 220 && rect.top > 220) {
            sug.style.top = 'auto';
            sug.style.bottom = '100%';
            sug.style.marginTop = '0';
            sug.style.marginBottom = '2px';
        } else {
            sug.style.top = '100%';
            sug.style.bottom = 'auto';
            sug.style.marginTop = '2px';
            sug.style.marginBottom = '0';
        }
    },

    setupCategoryAutocomplete: function() {
        const inputs = document.querySelectorAll('.category-input, #in_category, #out_category, #dir_category, #bulkCategory, #edit_in_category, #edit_out_category, #edit_direct_category');
        
        inputs.forEach(input => {
            if (input.dataset.autocompleteAttached) return;
            input.dataset.autocompleteAttached = 'true';

            const container = input.parentElement;
            let sug = container.querySelector('.autocomplete-suggestions');
            if (!sug) {
                sug = document.createElement('div');
                sug.className = 'autocomplete-suggestions category-suggestions';
                sug.style.display = 'none';
                container.appendChild(sug);
            } else {
                sug.classList.add('category-suggestions');
            }

            const renderSuggestions = (query) => {
                const q = (query || '').trim().toLowerCase();
                const list = this.categoryList && this.categoryList.length > 0 
                    ? this.categoryList 
                    : ['유압유', '기어유', '그리스', '테일씰그리스', '절삭유', '작동유', '방청유', '엔진오일', '열매체유', '콤프레샤유', '세척유', '방전유', '안전용품', '기타'];
                
                const filtered = q ? list.filter(c => c.toLowerCase().includes(q)) : list;
                if (filtered.length === 0) {
                    sug.style.display = 'none';
                    return;
                }
                sug.innerHTML = filtered.map(c => {
                    return `<div class="autocomplete-suggestion d-flex align-items-center gap-1 text-nowrap" data-val="${this.escapeHtml(c)}"><i class='bx bx-purchase-tag-alt text-primary' style='font-size: 11px;'></i><span>${this.highlightMatch(c, q)}</span></div>`;
                }).join('');
                this.positionAutocomplete(input, sug);
                sug.style.display = 'block';

                sug.querySelectorAll('.autocomplete-suggestion').forEach(itemDiv => {
                    const selectCat = (e) => {
                        if (e) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        input.value = itemDiv.dataset.val || itemDiv.textContent.trim();
                        sug.style.display = 'none';
                        input.dispatchEvent(new Event('change'));
                    };
                    itemDiv.addEventListener('mousedown', selectCat);
                    itemDiv.addEventListener('click', selectCat);
                });
            };

            this.attachAutocompleteKeyboard(input, sug);

            input.addEventListener('focus', () => {
                renderSuggestions(input.value);
            });

            input.addEventListener('click', () => {
                renderSuggestions(input.value);
            });

            input.addEventListener('input', (e) => {
                renderSuggestions(e.target.value);
            });

            input.addEventListener('blur', () => {
                setTimeout(() => { sug.style.display = 'none'; }, 200);
            });
        });

        if (!this._globalCategoryClickListener) {
            this._globalCategoryClickListener = true;
            document.addEventListener('click', (e) => {
                if (!e.target.classList.contains('category-input') && !e.target.closest('.autocomplete-suggestions')) {
                    document.querySelectorAll('.category-input + .autocomplete-suggestions, .position-relative > .autocomplete-suggestions').forEach(s => {
                        s.style.display = 'none';
                    });
                }
            });
        }
    },

    // ----------------------------------------
    // 품목-규격 연동 및 추천 자동완성
    // ----------------------------------------
    itemSpecsMap: null,

    loadItemSpecsMap: async function(forceRefresh = false) {
        if (this.itemSpecsMap && !forceRefresh) return this.itemSpecsMap;
        try {
            const data = await authFetch(`${API_BASE}/items/specs-map`);
            this.itemSpecsMap = data || {};
            return this.itemSpecsMap;
        } catch (err) {
            console.error('Failed to load item specs map:', err);
            if (!this.itemSpecsMap) this.itemSpecsMap = {};
            return this.itemSpecsMap;
        }
    },

    // ----------------------------------------
    // 물류 단가표 연동 및 단가 자동완성
    // ----------------------------------------
    unitPricesMap: null,

    loadUnitPricesMap: async function(forceRefresh = false) {
        if (this.unitPricesMap && !forceRefresh) return this.unitPricesMap;
        try {
            const data = await authFetch(`${API_BASE}/unit-prices/map`);
            this.unitPricesMap = data || {};
            return this.unitPricesMap;
        } catch (err) {
            console.error('Failed to load unit prices map:', err);
            if (!this.unitPricesMap) this.unitPricesMap = {};
            return this.unitPricesMap;
        }
    },

    getUnitPriceInfo: function(item, spec, freightType = null) {
        if (!item || !this.unitPricesMap) return null;
        const itemTrim = (item || '').trim();
        const specTrim = (spec || '').trim();
        const baseKey = `${itemTrim}||${specTrim}`;
        if (freightType) {
            const fullKey = `${baseKey}||${(freightType || '').trim()}`;
            if (this.unitPricesMap[fullKey]) return this.unitPricesMap[fullKey];
        }
        return this.unitPricesMap[baseKey] || null;
    },

    autoFillPricesForRow: function(row, type, item, spec) {
        if (!item) return;
        const freightSelect = row.querySelector(type === 'inbound' ? '.in-freight-type' : (type === 'direct' ? '.dir-freight-type' : '.out-freight-type'));
        const curFreight = freightSelect ? freightSelect.value : null;

        // 1. 단가표 조회 (현재 선택된 운임조건 일치 항목 우선, 없으면 기본 항목)
        let priceInfo = this.getUnitPriceInfo(item, spec, curFreight) || this.getUnitPriceInfo(item, spec);

        const manuallySet = row.dataset.freightManuallySet === 'true';

        // 2. 사용자가 운임조건을 직접 변경하지 않은 경우: 단가표의 마스터 운임조건 또는 스마트 기본값 추천
        if (!manuallySet && freightSelect) {
            if (priceInfo && priceInfo.freight_type) {
                freightSelect.value = priceInfo.freight_type;
            } else if (type === 'direct') {
                const shippingFee = parseFloat($('dir_out_shipping') ? $('dir_out_shipping').value : 0) || 0;
                freightSelect.value = shippingFee > 0 ? '상차도' : '하차도';
            } else if (type === 'outbound') {
                const shippingFee = parseFloat($('out_shipping') ? $('out_shipping').value : 0) || 0;
                freightSelect.value = shippingFee > 0 ? '상차도' : '하차도';
            }
        }

        if (!priceInfo) return;

        const effectiveFreight = freightSelect ? freightSelect.value : (priceInfo.freight_type || '상차도');
        // 마스터에 등록된 운임조건과 현재 행의 운임조건이 불일치하는지 여부
        const isFreightMismatch = !!(priceInfo.freight_type && priceInfo.freight_type !== effectiveFreight);

        const applyWarningOrClear = (inputEl, masterType, rowType) => {
            if (!inputEl) return;
            if (isFreightMismatch) {
                inputEl.classList.add('price-warn-highlight');
                inputEl.title = `단가표 기준(${masterType})과 전표 운임조건(${rowType})이 다릅니다. 단가를 확인하세요.`;
                const clearWarn = () => {
                    inputEl.classList.remove('price-warn-highlight');
                    inputEl.removeAttribute('title');
                    inputEl.removeEventListener('input', clearWarn);
                };
                inputEl.addEventListener('input', clearWarn);
            } else {
                inputEl.classList.remove('price-warn-highlight');
                inputEl.removeAttribute('title');
            }
        };

        if (type === 'direct') {
            const inPriceInp = row.querySelector('.dir-in-price');
            const outPriceInp = row.querySelector('.dir-out-price');
            let updated = false;
            if (inPriceInp && (!inPriceInp.value || parseFloat(inPriceInp.value) === 0) && priceInfo.buy_price) {
                inPriceInp.value = priceInfo.buy_price;
                updated = true;
            }
            if (outPriceInp && (!outPriceInp.value || parseFloat(outPriceInp.value) === 0) && priceInfo.sell_price) {
                outPriceInp.value = priceInfo.sell_price;
                updated = true;
            }
            applyWarningOrClear(inPriceInp, priceInfo.freight_type, effectiveFreight);
            applyWarningOrClear(outPriceInp, priceInfo.freight_type, effectiveFreight);
            if (updated) {
                this.updateDirectGridTotals();
            }
        } else if (type === 'inbound') {
            const priceInp = row.querySelector('.in-price');
            if (priceInp && (!priceInp.value || parseFloat(priceInp.value) === 0) && priceInfo.buy_price) {
                priceInp.value = priceInfo.buy_price;
                this.updateInboundGridTotals();
            }
            applyWarningOrClear(priceInp, priceInfo.freight_type, effectiveFreight);
        } else if (type === 'outbound') {
            const priceInp = row.querySelector('.out-price');
            if (priceInp && (!priceInp.value || parseFloat(priceInp.value) === 0) && priceInfo.sell_price) {
                priceInp.value = priceInfo.sell_price;
                this.updateOutboundGridTotals();
            }
            applyWarningOrClear(priceInp, priceInfo.freight_type, effectiveFreight);
        }
    },

    handleItemSelectionAutoFill: function(row, type, itemName) {
        if (!itemName) return;
        const itemInfo = this.itemSpecsMap ? this.itemSpecsMap[itemName] : null;
        const specInput = row.querySelector(type === 'direct' ? '.dir-spec' : '.in-spec');
        const unitInput = row.querySelector(type === 'direct' ? '.dir-unit' : '.in-unit');
        const categoryInput = row.querySelector(type === 'direct' ? '.dir-category' : '.in-category');

        if (itemInfo) {
            // 분류/단위가 비어있다면 기본값 채움
            if (unitInput && (!unitInput.value || unitInput.value.trim() === '') && itemInfo.defaultUnit) {
                unitInput.value = itemInfo.defaultUnit;
            }
            if (categoryInput && (!categoryInput.value || categoryInput.value.trim() === '') && itemInfo.defaultCategory) {
                categoryInput.value = itemInfo.defaultCategory;
            }

            // 해당 품목에 과거 등록된 규격이 딱 1개뿐이고, 현재 규격 입력창이 비어있다면 자동 입력
            if (itemInfo.specs && itemInfo.specs.length === 1 && specInput && (!specInput.value || specInput.value.trim() === '')) {
                const singleSpec = itemInfo.specs[0];
                specInput.value = singleSpec;
                const detail = itemInfo.specDetails ? itemInfo.specDetails[singleSpec] : null;
                if (detail) {
                    if (unitInput && detail.unit) unitInput.value = detail.unit;
                    if (categoryInput && detail.category) categoryInput.value = detail.category;
                }
                specInput.dispatchEvent(new Event('change'));
                this.autoFillPricesForRow(row, type, itemName, singleSpec);
                return;
            }
        }

        // 이미 규격이 입력되어 있는 상태에서 품목명이 정해졌거나 변경된 경우 단가 채움
        if (specInput && specInput.value.trim()) {
            this.autoFillPricesForRow(row, type, itemName, specInput.value.trim());
        }
    },

    bindSpecAutocomplete: function(row, type) {
        const itemInput = row.querySelector(type === 'direct' ? '.dir-item' : '.in-item');
        const specInput = row.querySelector(type === 'direct' ? '.dir-spec' : '.in-spec');
        const unitInput = row.querySelector(type === 'direct' ? '.dir-unit' : '.in-unit');
        const categoryInput = row.querySelector(type === 'direct' ? '.dir-category' : '.in-category');
        if (!specInput) return;

        const specContainer = specInput.parentElement;
        let sug = specContainer.querySelector('.autocomplete-suggestions');
        if (!sug) {
            sug = document.createElement('div');
            sug.className = 'autocomplete-suggestions spec-suggestions';
            sug.style.display = 'none';
            specContainer.appendChild(sug);
        }

        const renderSuggestions = async (query = '') => {
            const currentItem = itemInput ? itemInput.value.trim() : '';
            if (!currentItem) {
                sug.style.display = 'none';
                return;
            }
            const map = await this.loadItemSpecsMap();
            const itemInfo = map ? map[currentItem] : null;
            const specs = itemInfo && itemInfo.specs ? itemInfo.specs : [];
            if (specs.length === 0) {
                sug.style.display = 'none';
                return;
            }

            const q = (query || '').trim().toLowerCase();
            const filtered = q ? specs.filter(s => s.toLowerCase().includes(q)) : specs;
            if (filtered.length === 0) {
                sug.style.display = 'none';
                return;
            }

            sug.innerHTML = filtered.map(spec => {
                const detail = itemInfo.specDetails ? itemInfo.specDetails[spec] : null;
                const unitBadge = detail && detail.unit 
                    ? `<span class="badge bg-secondary-subtle text-secondary border px-1 py-0 ms-1" style="font-size: 9.5px; font-weight: 500;">${this.escapeHtml(detail.unit)}</span>` 
                    : '';
                
                // 단가표 등록 기준단가 뱃지
                const priceInfo = this.getUnitPriceInfo(currentItem, spec);
                let priceBadge = '';
                if (priceInfo) {
                    if (type === 'direct') {
                        const parts = [];
                        if (priceInfo.buy_price) parts.push(`매입 ${Number(priceInfo.buy_price).toLocaleString()}원`);
                        if (priceInfo.sell_price) parts.push(`매출 ${Number(priceInfo.sell_price).toLocaleString()}원`);
                        if (parts.length) priceBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-1 py-0" style="font-size: 9.5px; font-weight: 500;"><i class='bx bx-won'></i> ${parts.join(' / ')}</span>`;
                    } else if (type === 'inbound' && priceInfo.buy_price) {
                        priceBadge = `<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-1 py-0" style="font-size: 9.5px; font-weight: 500;"><i class='bx bx-won'></i> 매입 ${Number(priceInfo.buy_price).toLocaleString()}원</span>`;
                    }
                }

                return `
                    <div class="autocomplete-suggestion d-flex justify-content-between align-items-center" data-spec="${this.escapeHtml(spec)}">
                        <div class="d-flex align-items-center gap-1 text-nowrap">
                            <i class='bx bx-purchase-tag text-primary' style='font-size: 11.5px;'></i>
                            <strong class="text-dark">${this.highlightMatch(spec, q)}</strong>
                            ${unitBadge}
                        </div>
                        <div class="d-flex align-items-center gap-1 ms-3 text-nowrap">
                            ${priceBadge}
                        </div>
                    </div>
                `;
            }).join('');
            this.positionAutocomplete(specInput, sug);
            sug.style.display = 'block';

            sug.querySelectorAll('.autocomplete-suggestion').forEach((itemDiv, idx) => {
                const specVal = filtered[idx];
                const detail = itemInfo.specDetails ? itemInfo.specDetails[specVal] : null;
                
                const selectFn = (e) => {
                    if (e) e.preventDefault();
                    specInput.value = specVal;
                    sug.style.display = 'none';
                    if (detail) {
                        if (unitInput && (!unitInput.value || unitInput.value.trim() === '') && detail.unit) {
                            unitInput.value = detail.unit;
                        }
                        if (categoryInput && (!categoryInput.value || categoryInput.value.trim() === '') && detail.category) {
                            categoryInput.value = detail.category;
                        }
                    }
                    specInput.dispatchEvent(new Event('change'));
                    this.autoFillPricesForRow(row, type, currentItem, specVal);
                };

                itemDiv.addEventListener('mousedown', selectFn);
                itemDiv.addEventListener('click', selectFn);
            });
        };

        specInput.addEventListener('focus', () => {
            renderSuggestions(specInput.value);
        });
        specInput.addEventListener('click', () => {
            renderSuggestions(specInput.value);
        });
        specInput.addEventListener('input', (e) => {
            renderSuggestions(e.target.value);
        });
        specInput.addEventListener('change', () => {
            const currentItem = itemInput ? itemInput.value.trim() : '';
            const currentSpec = specInput.value.trim();
            if (currentItem && currentSpec) {
                this.autoFillPricesForRow(row, type, currentItem, currentSpec);
            }
        });
        specInput.addEventListener('blur', () => {
            setTimeout(() => { 
                sug.style.display = 'none';
                const currentItem = itemInput ? itemInput.value.trim() : '';
                const currentSpec = specInput.value.trim();
                if (currentItem && currentSpec) {
                    this.autoFillPricesForRow(row, type, currentItem, currentSpec);
                }
            }, 180);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== specInput && !e.target.closest('.spec-suggestions')) {
                sug.style.display = 'none';
            }
        });

        this.attachAutocompleteKeyboard(specInput, sug);
    },

    filterByCategory(cat) {
        this.detailedFilters.category = cat || '';
        this.renderCategoryPills();
        this.resetPageAndLoadHistory();
        if($('inboundForm')) { $('inboundForm').dataset.mode = ''; $('inboundForm').dataset.txId = ''; }
        if($('outboundForm')) { $('outboundForm').dataset.mode = ''; $('outboundForm').dataset.txId = ''; }
        if($('directForm')) { $('directForm').dataset.mode = ''; $('directForm').dataset.txId = ''; }
    },

    bindEvents: function() {
        $('inboundForm').addEventListener('submit', this.handleInboundSubmit.bind(this));
        $('outboundForm').addEventListener('submit', this.handleOutboundSubmit.bind(this));
        $('directForm').addEventListener('submit', this.handleDirectSubmit.bind(this));
        const eif = $('editInboundForm');
        if (eif) eif.addEventListener('submit', this.submitEditInbound.bind(this));
        
        const eof = $('editOutboundForm');
        if (eof) eof.addEventListener('submit', this.submitEditOutbound.bind(this));
        
        const edf = $('editDirectForm');
        if (edf) edf.addEventListener('submit', this.submitEditDirectOutbound.bind(this));
        
        const beol = $('btnEditOutboundLot');
        if (beol) beol.addEventListener('click', this.openEditOutboundLotModal.bind(this));
        
        // Hide autocomplete when clicking outside or when focus shifts to another element
        document.addEventListener('click', (e) => {
            if (e.target.id !== 'in_item') {
                const s = $('in_item_suggestions');
                if(s) s.style.display = 'none';
            }
            if (e.target.id !== 'out_item') {
                const s = $('out_item_suggestions');
                if(s) s.style.display = 'none';
            }
        });

        // 포커스 이동(Tab, 마우스 클릭 등) 시 이전 셀의 모든 자동완성 창 닫기
        document.addEventListener('focusin', (e) => {
            document.querySelectorAll('.autocomplete-suggestions').forEach(s => {
                const parent = s.parentElement;
                if (parent && !parent.contains(e.target)) {
                    s.style.display = 'none';
                }
            });
        });

        // 모달 닫힘(취소/ESC/X클릭) 시 폼 데이터 자동 초기화 (미저장 잔여 데이터 잔존 방지)
        const outModal = $('outboundModal');
        if (outModal) {
            outModal.addEventListener('hidden.bs.modal', () => {
                this.resetOutboundModalForm();
            });
        }
        const inModal = $('inboundModal');
        if (inModal) {
            inModal.addEventListener('hidden.bs.modal', () => {
                this.resetInboundModalForm();
            });
        }
        const dirModal = $('directModal');
        if (dirModal) {
            dirModal.addEventListener('hidden.bs.modal', () => {
                this.resetDirectModalForm();
            });
        }

        // 중첩 모달(직출고/입고/출고 등 모달 위에 거래처 검색 모달이 닫힐 때) body 스크롤 및 활성 상태 보존
        const partnerModal = $('partnerSearchModal');
        if (partnerModal) {
            partnerModal.addEventListener('hidden.bs.modal', () => {
                if (document.querySelector('.modal.show')) {
                    document.body.classList.add('modal-open');
                }
            });
        }
    },

    // ----------------------------------------
    // History & Deletion (내역 및 삭제)
    // ----------------------------------------
    currentPage: 1,
    sortCol: 'date',
    sortDir: 'desc',
    detailedFilters: {
        startDate: '',
        endDate: '',
        category: ''
    },

    toggleSort: function(colName) {
        if (this.sortCol === colName) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortCol = colName;
            this.sortDir = 'desc';
        }
        
        document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');
        const icon = this.sortDir === 'asc' ? ' 🔼' : ' 🔽';
        const th = document.getElementById('th-' + colName);
        if (th) {
            th.querySelector('.sort-icon').innerHTML = icon;
        }

        this.resetPageAndLoadHistory();
    },

    openDetailedSearch: function() {
        const modalEl = document.getElementById('detailedSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    applyDetailedSearch: function() {
        this.detailedFilters.startDate = $('ds_start_date').value;
        this.detailedFilters.endDate = $('ds_end_date').value;
        this.detailedFilters.searchParty = $('ds_party').value.trim();
        this.detailedFilters.searchItem = $('ds_item').value.trim();
        this.detailedFilters.searchSpec = $('ds_spec').value.trim();

        const modalEl = document.getElementById('detailedSearchModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        this.resetPageAndLoadHistory();
    },

    resetDetailedSearch: function() {
        $('dsForm').reset();
        this.detailedFilters = {
            startDate: '', endDate: '', searchParty: '', searchItem: '', searchSpec: ''
        };
        this.resetPageAndLoadHistory();
    },

    resetPageAndLoadHistory: function() {
        this.currentPage = 1;
        this.loadHistory();
    },

    changeHistoryPage: function(page) {
        if (page < 1) return;
        this.currentPage = page;
        this.loadHistory();
        const grid = document.querySelector('.erp-main-grid-wrapper');
        if (grid) grid.scrollTop = 0;
    },

    currentDatePreset: 'all',

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

        if ($('searchStartDate')) $('searchStartDate').value = startDate;
        if ($('searchEndDate')) $('searchEndDate').value = endDate;

        this.updatePresetButtons(preset);
        this.resetPageAndLoadHistory();
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
        const start = $('searchStartDate') ? $('searchStartDate').value : '';
        const end = $('searchEndDate') ? $('searchEndDate').value : '';
        const detected = this.detectDatePreset(start, end);
        this.currentDatePreset = detected;
        this.updatePresetButtons(detected);
        this.resetPageAndLoadHistory();
    },

    onSearchInputKeyup: function(e) {
        const val = $('historySearch') ? $('historySearch').value : '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) {
            if (val.length > 0) {
                clearBtn.classList.remove('d-none');
            } else {
                clearBtn.classList.add('d-none');
            }
        }
        if (e.key === 'Enter') {
            this.resetPageAndLoadHistory();
        }
    },

    clearSearchInput: function() {
        if ($('historySearch')) {
            $('historySearch').value = '';
        }
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) {
            clearBtn.classList.add('d-none');
        }
        this.resetPageAndLoadHistory();
    },

    onSearchTargetChange: function() {
        if ($('historySearch') && $('historySearch').value.trim()) {
            this.resetPageAndLoadHistory();
        }
    },

    clearDateFilter: function() {
        this.setDatePreset('all');
    },

    clearTypeFilter: function() {
        const rAll = $('btnFilterAll');
        if (rAll) {
            rAll.checked = true;
            this.resetPageAndLoadHistory();
        }
    },

    resetSearch: function() {
        this.currentDatePreset = 'all';
        this.updatePresetButtons('all');
        if ($('searchStartDate')) $('searchStartDate').value = '';
        if ($('searchEndDate')) $('searchEndDate').value = '';
        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('historySearch')) $('historySearch').value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        const rAll = $('btnFilterAll');
        if (rAll) rAll.checked = true;
        this.detailedFilters.category = '';
        this.renderCategoryPills();
        this.subSearchKeyword = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        const clearSubBtn = $('clearSubSearchBtn');
        if (clearSubBtn) clearSubBtn.classList.add('d-none');
        const countBadge = $('subSearchCountBadge');
        if (countBadge) countBadge.classList.add('d-none');
        this.resetPageAndLoadHistory();
    },

    renderActiveFilterChips: function() {
        const container = $('activeFilterChipsContainer');
        if (!container) return;

        const typeFilter = document.querySelector('input[name="historyFilter"]:checked')?.value || 'all';
        const startDate = $('searchStartDate')?.value || '';
        const endDate = $('searchEndDate')?.value || '';
        const searchTarget = $('searchTarget')?.value || '';
        const searchKeyword = $('historySearch')?.value.trim() || '';
        const category = this.detailedFilters.category || '';

        let chips = [];

        // 1. 구분 필터
        if (typeFilter !== 'all') {
            const typeLabels = { inbound: '입고만', outbound: '출고만', direct: '직출고만' };
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal">구분:</span> <strong>${typeLabels[typeFilter] || typeFilter}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearTypeFilter()" title="해제"></i>
                </span>
            `);
        }

        // 2. 날짜 필터
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
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearDateFilter()" title="해제"></i>
                </span>
            `);
        }

        // 3. 분류 필터
        if (category) {
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-purchase-tag-alt'></i> 분류:</span> <strong>${category}</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.filterByCategory('')" title="해제"></i>
                </span>
            `);
        }

        // 4. 검색어 필터
        if (searchKeyword) {
            const targetLabels = {
                supplier: '매입처', destination: '매출처', item: '품목명', spec: '규격', note: '비고', tx_id: '고유번호'
            };
            const targetName = targetLabels[searchTarget] || '전체';
            chips.push(`
                <span class="badge rounded-pill bg-light text-dark border d-inline-flex align-items-center gap-1 py-1 px-2">
                    <span class="text-secondary fw-normal"><i class='bx bx-search'></i> ${targetName}:</span> <strong>"${searchKeyword}"</strong>
                    <i class='bx bx-x text-muted hover-dark ms-1' style="cursor:pointer; font-size:1rem;" onclick="app.clearSearchInput()" title="해제"></i>
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

    toggleMobileSummaryDetail: function() {
        const panel = $('mobileSummaryDetailPanel');
        const chevron = $('summaryChevronIcon');
        if (!panel) return;
        const isHidden = panel.classList.contains('d-none');
        if (isHidden) {
            panel.classList.remove('d-none');
            if (chevron) chevron.style.transform = 'rotate(180deg)';
        } else {
            panel.classList.add('d-none');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        }
    },

    formatCompactNum: function(num) {
        if (!num || isNaN(num)) return '0';
        const abs = Math.abs(num);
        if (abs >= 100000000) {
            return (num / 100000000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '억';
        }
        if (abs >= 10000) {
            return Math.round(num / 10000).toLocaleString() + '만';
        }
        return Number(num).toLocaleString();
    },

    renderSummaryStrip: function(summary, typeFilter) {
        const strip = $('historySummaryStrip');
        if (!strip) return;

        if (!summary) {
            strip.innerHTML = `<span class="text-muted">통계 집계 없음</span>`;
            return;
        }

        const totalCount = summary.totalCount || 0;
        const totalQty = summary.totalQty || 0;
        const inbound = summary.inbound || { supplyAmt: 0, vat: 0, totalAmt: 0 };
        const outbound = summary.outbound || { supplyAmt: 0, vat: 0, totalAmt: 0 };

        // 1. 데스크톱 전용 요약 HTML
        let amountHtml = '';
        if (typeFilter === 'inbound') {
            amountHtml = `
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span>매입공급가: <strong class="text-dark tabular-nums">${inbound.supplyAmt.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span>부가세: <strong class="text-secondary tabular-nums">${inbound.vat.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span class="erp-badge erp-badge-in" style="font-size: 11px;">매입합계: <strong>${inbound.totalAmt.toLocaleString()}</strong>원</span>
                </div>
            `;
        } else if (typeFilter === 'outbound') {
            amountHtml = `
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span>매출공급가: <strong class="text-dark tabular-nums">${outbound.supplyAmt.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span>부가세: <strong class="text-secondary tabular-nums">${outbound.vat.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span class="erp-badge erp-badge-out" style="font-size: 11px;">매출합계: <strong>${outbound.totalAmt.toLocaleString()}</strong>원</span>
                </div>
            `;
        } else if (typeFilter === 'direct') {
            const margin = outbound.totalAmt - inbound.totalAmt;
            amountHtml = `
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span>매입합계: <strong class="text-primary tabular-nums">${inbound.totalAmt.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span>매출합계: <strong class="text-danger tabular-nums">${outbound.totalAmt.toLocaleString()}원</strong></span>
                    <span class="text-muted">|</span>
                    <span class="erp-badge ${margin >= 0 ? 'erp-badge-in' : 'erp-badge-out'}" style="font-size: 11px;">
                        수익(마진): <strong>${margin.toLocaleString()}</strong>원
                    </span>
                </div>
            `;
        } else {
            // 전체 보기
            amountHtml = `
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span>매입: <strong class="text-primary tabular-nums">${inbound.totalAmt.toLocaleString()}원</strong> <span class="text-muted small">(${inbound.supplyAmt.toLocaleString()} + 세 ${inbound.vat.toLocaleString()})</span></span>
                    <span class="text-muted">|</span>
                    <span>매출: <strong class="text-danger tabular-nums">${outbound.totalAmt.toLocaleString()}원</strong> <span class="text-muted small">(${outbound.supplyAmt.toLocaleString()} + 세 ${outbound.vat.toLocaleString()})</span></span>
                </div>
            `;
        }

        const desktopHtml = `
            <div class="desktop-summary-content d-none d-md-flex align-items-center justify-content-between w-100 flex-wrap gap-2">
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span><strong>검색 결과</strong> <span class="badge bg-dark" style="font-size: 11px; padding: 2px 6px;">${totalCount.toLocaleString()}건</span></span>
                    ${typeFilter === 'all' ? `
                        <span class="erp-badge erp-badge-cat">입고 ${summary.inboundCount || 0}</span>
                        <span class="erp-badge erp-badge-cat">출고 ${summary.outboundCount || 0}</span>
                        <span class="erp-badge erp-badge-cat">직출고 ${summary.directCount || 0}</span>
                    ` : ''}
                    <span class="text-muted ms-1 me-1">|</span>
                    <span class="text-muted">총 수량:</span>
                    <strong class="text-dark tabular-nums">${totalQty.toLocaleString()}</strong>
                </div>
                ${amountHtml}
            </div>
        `;

        // 2. 모바일 전용 슬림 KPI 요약 HTML
        let mobileAmountKpi = '';
        if (typeFilter === 'inbound') {
            mobileAmountKpi = `<span class="text-muted small">매입</span> <strong class="text-success">${this.formatCompactNum(inbound.totalAmt)}</strong>`;
        } else if (typeFilter === 'outbound') {
            mobileAmountKpi = `<span class="text-muted small">매출</span> <strong class="text-danger">${this.formatCompactNum(outbound.totalAmt)}</strong>`;
        } else if (typeFilter === 'direct') {
            const margin = outbound.totalAmt - inbound.totalAmt;
            mobileAmountKpi = `<span class="text-muted small">마진</span> <strong class="${margin >= 0 ? 'text-primary' : 'text-danger'}">${this.formatCompactNum(margin)}</strong>`;
        } else {
            mobileAmountKpi = `<span class="text-muted small">매출</span> <strong class="text-danger">${this.formatCompactNum(outbound.totalAmt)}</strong> <small class="text-muted fw-normal">(매입 ${this.formatCompactNum(inbound.totalAmt)})</small>`;
        }

        const directMargin = outbound.totalAmt - inbound.totalAmt;

        const mobileHtml = `
            <div class="mobile-summary-wrapper d-md-none w-100">
                <div class="mobile-summary-pill-bar" onclick="app.toggleMobileSummaryDetail()">
                    <div class="mobile-summary-main-metrics">
                        <span class="mobile-kpi-item">
                            <i class='bx bx-bar-chart-alt-2 text-primary'></i>
                            <strong>${totalCount.toLocaleString()}</strong><small>건</small>
                        </span>
                        <span class="mobile-kpi-divider">·</span>
                        <span class="mobile-kpi-item">
                            <small class="text-muted">수량</small> <strong>${totalQty.toLocaleString()}</strong>
                        </span>
                        <span class="mobile-kpi-divider">|</span>
                        <span class="mobile-kpi-item">
                            ${mobileAmountKpi}
                        </span>
                    </div>
                    <button type="button" class="btn-toggle-summary-detail" aria-label="요약 상세 접기/펼치기">
                        <i class='bx bx-chevron-down' id="summaryChevronIcon"></i>
                    </button>
                </div>
                <div class="mobile-summary-detail-panel d-none" id="mobileSummaryDetailPanel">
                    <div class="detail-grid">
                        <div class="detail-box in-box">
                            <div class="detail-box-title text-success"><i class='bx bx-down-arrow-circle'></i> 입고 (${summary.inboundCount || 0}건)</div>
                            <div class="detail-row"><span>공급가</span> <strong>${inbound.supplyAmt.toLocaleString()}원</strong></div>
                            <div class="detail-row"><span>부가세</span> <strong>${inbound.vat.toLocaleString()}원</strong></div>
                            <div class="detail-row highlight"><span>합계</span> <strong class="text-success">${inbound.totalAmt.toLocaleString()}원</strong></div>
                        </div>
                        <div class="detail-box out-box">
                            <div class="detail-box-title text-danger"><i class='bx bx-up-arrow-circle'></i> 출고 (${summary.outboundCount || 0}건)</div>
                            <div class="detail-row"><span>공급가</span> <strong>${outbound.supplyAmt.toLocaleString()}원</strong></div>
                            <div class="detail-row"><span>부가세</span> <strong>${outbound.vat.toLocaleString()}원</strong></div>
                            <div class="detail-row highlight"><span>합계</span> <strong class="text-danger">${outbound.totalAmt.toLocaleString()}원</strong></div>
                        </div>
                    </div>
                    ${typeFilter === 'direct' || (summary.directCount && summary.directCount > 0) ? `
                        <div class="margin-box mt-2">
                            <span><i class='bx bx-git-compare'></i> 직출고 (${summary.directCount || 0}건) 마진:</span>
                            <strong class="${directMargin >= 0 ? 'text-primary' : 'text-danger'}">
                                ${directMargin.toLocaleString()}원
                            </strong>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        strip.innerHTML = desktopHtml + mobileHtml;
    },

    loadHistory: async function() {
        const typeFilter = document.querySelector('input[name="historyFilter"]:checked')?.value || 'all';
        const searchRaw = $('historySearch') ? $('historySearch').value.trim() : '';
        const limit = parseInt($('historyLimit')?.value) || 50;

        // Toggle clear search button
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) {
            if (searchRaw.length > 0) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }

        const params = new URLSearchParams({
            page: this.currentPage,
            limit: limit,
            type: typeFilter,
            search: searchRaw,
            sortCol: this.sortCol,
            sortDir: this.sortDir,
            startDate: $('searchStartDate')?.value || '',
            endDate: $('searchEndDate')?.value || '',
            category: this.detailedFilters.category || '',
            searchTarget: $('searchTarget')?.value || '',
            searchKeyword: searchRaw
        });
        if (this.subSearchKeyword) {
            params.append('subSearch', this.subSearchKeyword);
        }

        try {
            $('historyTbody').innerHTML = `<tr><td colspan="16" class="text-center text-muted">데이터를 불러오는 중입니다...</td></tr>`;
            
            const res = await authFetch(`${API_BASE}/history?${params.toString()}`);
            this.currentHistoryData = res.data;
            this.totalHistoryCount = res.total;
            this.renderFilteredHistoryTable();
            this.renderPagination(res.total, res.page, res.limit);
            this.renderSummaryStrip(res.summary, typeFilter);
            this.renderActiveFilterChips();
            this.updateSelectionSummary();
        } catch (err) {
            console.error('History load error:', err);
            $('historyTbody').innerHTML = `<tr><td colspan="16" class="text-center text-danger">내역을 불러오지 못했습니다.</td></tr>`;
        }
    },

    // ── 결과 내 재검색 (Sub-Search) 로직 ──
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
            this.resetPageAndLoadHistory();
        }, 350);
    },

    clearSubSearch: function() {
        const input = $('subSearchInput');
        if (input) input.value = '';
        if (this.subSearchTimer) clearTimeout(this.subSearchTimer);
        this.subSearchKeyword = '';
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.resetPageAndLoadHistory();
    },

    renderFilteredHistoryTable: function() {
        if (!this.currentHistoryData) return;

        const countBadge = $('subSearchCountBadge');
        if (countBadge) {
            if (this.subSearchKeyword) {
                countBadge.innerText = `재검색: ${this.totalHistoryCount !== undefined ? this.totalHistoryCount : this.currentHistoryData.length}건`;
                countBadge.classList.remove('d-none');
            } else {
                countBadge.classList.add('d-none');
            }
        }

        this.renderHistoryTable(this.currentHistoryData);
        this.updateSelectionSummary();
    },

    renderPagination: function(total, currentPage, limit) {
        const bottomUl = $('historyPagination');
        const topUl = $('topHistoryPagination');
        const topInfo = $('topPageInfoText');
        const bottomInfo = $('bottomPageInfoText');

        const ps = parseInt(limit, 10) || 50;
        const isAll = (ps >= 999999);
        const totalPages = isAll ? 1 : Math.max(1, Math.ceil((total || 0) / ps));
        const curPage = Math.min(Math.max(1, currentPage || 1), totalPages);
        this.currentPage = curPage;

        // 1. 상단 정보 배지 동기화
        if (topInfo) {
            topInfo.textContent = isAll ? `전체 (${(total || 0).toLocaleString()}건)` : `${curPage} / ${totalPages} 페이지`;
        }
        const mobBadge = $('mobileHeaderCountBadge');
        if (mobBadge) {
            mobBadge.textContent = `${(total || 0).toLocaleString()}건`;
        }

        // 2. 하단 상태 정보 동기화
        if (bottomInfo) {
            if (isAll || total === 0) {
                bottomInfo.textContent = `총 ${(total || 0).toLocaleString()}건 전체 표시`;
            } else {
                const startItem = (curPage - 1) * ps + 1;
                const endItem = Math.min(curPage * ps, total);
                bottomInfo.textContent = `총 ${(total || 0).toLocaleString()}건 중 ${startItem.toLocaleString()}~${endItem.toLocaleString()}건 (${curPage}/${totalPages} 페이지)`;
            }
        }

        // 3. 페이지네이션 버튼 HTML 생성 (0건 또는 1페이지여도 [ 1 ] 버튼 항상 유지)
        let html = '';

        // 처음(«) / 이전(‹) 버튼
        if (curPage > 1 && !isAll) {
            html += `<li class="page-item"><button type="button" class="page-link" onclick="app.changeHistoryPage(1)" title="첫 페이지">«</button></li>`;
            html += `<li class="page-item"><button type="button" class="page-link" onclick="app.changeHistoryPage(${curPage - 1})" title="이전 페이지">‹</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">«</span></li>`;
            html += `<li class="page-item disabled"><span class="page-link">‹</span></li>`;
        }

        // 5개 단위 번호 표시
        let startPage = Math.max(1, curPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }
        if (startPage < 1) startPage = 1;

        for (let i = startPage; i <= endPage; i++) {
            if (i === curPage) {
                html += `<li class="page-item active"><span class="page-link fw-bold">${i}</span></li>`;
            } else {
                html += `<li class="page-item"><button type="button" class="page-link" onclick="app.changeHistoryPage(${i})">${i}</button></li>`;
            }
        }

        // 다음(›) / 끝(») 버튼
        if (curPage < totalPages && !isAll) {
            html += `<li class="page-item"><button type="button" class="page-link" onclick="app.changeHistoryPage(${curPage + 1})" title="다음 페이지">›</button></li>`;
            html += `<li class="page-item"><button type="button" class="page-link" onclick="app.changeHistoryPage(${totalPages})" title="마지막 페이지">»</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">›</span></li>`;
            html += `<li class="page-item disabled"><span class="page-link">»</span></li>`;
        }

        if (bottomUl) bottomUl.innerHTML = html;
        if (topUl) topUl.innerHTML = html;
    },

    renderHistoryTable: function(data) {
        this.keyboardFocusedIndex = -1;
        const tbody = $('historyTbody');
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="16" class="text-center text-muted" style="height: 60px;">해당하는 내역이 없습니다.</td></tr>`;
            this.renderMobileCards(data);
            return;
        }

        tbody.innerHTML = data.map(r => {
            const isOut = r.type === 'outbound';
            let badge = isOut ? `<span class="erp-badge erp-badge-out">출고</span>` : `<span class="erp-badge erp-badge-in">입고</span>`;
            if (isOut && r.is_direct === 1) {
                badge = `<span class="erp-badge erp-badge-direct">직출고</span>`;
            }
            if (r.trade_type && r.trade_type !== '내수') {
                badge += ` <span class="erp-badge erp-badge-info">${r.trade_type}</span>`;
            }
            const delFn = isOut ? `app.deleteOutbound(${r.id})` : `app.deleteInbound(${r.id})`;
            const editFn = (r.type === '직출고' || r.is_direct === 1)
                ? `app.openEditDirectOutboundTx('${r.transaction_group_id || ''}', ${r.id})`
                : (isOut ? `app.openEditOutboundTx('${r.transaction_group_id || ''}', ${r.id})` : `app.openEditInboundTx('${r.transaction_group_id || ''}', ${r.id})`);
            
            const renderCell = (val, isNumber = false) => {
                if (val === null || val === undefined || val === '') return `<span class="text-muted">-</span>`;
                return isNumber ? Math.round(Number(val)).toLocaleString() : val;
            };

            let destHtml = '<span class="text-muted">-</span>';
            if (r.destination) {
                const hasActual = r.actual_destination && r.actual_destination.trim() && r.actual_destination.trim() !== r.destination.trim();
                destHtml = hasActual 
                    ? `<span>${r.destination}</span> <span class="text-secondary small" title="실출고처: ${r.actual_destination.trim()}">(실: ${r.actual_destination.trim()})</span>`
                    : `<span>${r.destination}</span>`;
            }

            const txIdDisplay = r.transaction_group_id || (r.is_direct === 1 ? `OUT-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}` : (isOut ? `OUT-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}` : `IN-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}`));
            const dateStr = (r.date || '').split('T')[0];

            let freightBadge = '';
            if (r.freight_type === '하차도') {
                freightBadge = ` <span class="badge-freight-in" title="운임: 하차도">하차도</span>`;
            } else if (r.freight_type === '상차도') {
                freightBadge = ` <span class="badge-freight-ex" title="운임: 상차도">상차도</span>`;
            }

            return `
            <tr id="row_${r.id}" class="history-main-row" style="cursor:pointer;" onclick="app.toggleAccordion(${r.id}, '${r.type}')" title="클릭하여 상세 전표 확인 (또는 Enter)">
                <td class="text-center d-print-none" onclick="event.stopPropagation()"><input type="checkbox" class="history-checkbox" value="${r.id}" data-type="${r.type}" onchange="app.syncCardSelection(${r.id}, this.checked)"></td>
                <td class="d-print-none user-select-none text-nowrap" style="font-size: 11.5px; color: #475569;">
                    <i class='bx bx-chevron-right me-1 accordion-icon text-muted' id="acc_icon_${r.id}" style="font-size: 0.85rem; vertical-align: middle;"></i>
                    <span>${txIdDisplay}</span>
                </td>
                <td class="text-center">${badge}</td>
                <td class="text-center"><span class="erp-badge erp-badge-cat">${r.category || '-'}</span></td>
                <td class="text-center tabular-nums">${dateStr}</td>
                <td title="${r.supplier || ''}">${renderCell(r.supplier)}</td>
                <td title="${r.destination || ''}">${destHtml}</td>
                <td title="${r.item || ''}"><strong class="text-dark">${r.item}</strong>${freightBadge}</td>
                <td class="text-center" title="${r.spec || ''}">${r.spec || '-'}</td>
                <td class="text-center">${r.unit || '-'}</td>
                <td class="text-end tabular-nums ${isOut ? 'text-danger fw-bold' : 'text-success fw-bold'}">${r.qty.toLocaleString()}</td>
                <td class="text-end tabular-nums text-secondary">${renderCell(r.inbound_price, true)}</td>
                <td class="text-end tabular-nums text-secondary">${renderCell(r.inbound_total, true)}</td>
                <td class="text-end tabular-nums text-dark">${renderCell(r.outbound_price, true)}</td>
                <td class="text-end tabular-nums fw-bold text-dark">${renderCell(r.outbound_total, true)}</td>
                <td class="text-center text-nowrap" onclick="event.stopPropagation()">
                    ${r.settlement_status === '정산완료' 
                        ? `<span class="badge bg-secondary" style="font-size: 10px; padding: 2px 4px;">정산완료</span>` 
                        : `<button class="btn-grid-action me-1" onclick="event.stopPropagation(); ${editFn}" title="수정"><i class='bx bx-edit'></i></button>
                           <button class="btn-grid-action btn-grid-action-danger" onclick="event.stopPropagation(); ${delFn}" title="삭제"><i class='bx bx-trash'></i></button>`
                    }
                </td>
            </tr>
            <tr id="accordion_row_${r.id}" class="accordion-sub-row d-none">
                <td colspan="16" class="p-0 border-0">
                    <div id="accordion_content_${r.id}" class="accordion-content-box">
                        <div class="text-center py-2 text-muted" style="font-size: 11.5px;"><i class='bx bx-loader-alt bx-spin me-1'></i> 상세 전표 내역을 불러오는 중입니다...</div>
                    </div>
                </td>
            </tr>
            `;
        }).join('');
        this.renderMobileCards(data);
    },

    toggleAccordion: async function(id, type) {
        const accRow = $(`accordion_row_${id}`);
        const accIcon = $(`acc_icon_${id}`);
        const mainRow = $(`row_${id}`);
        
        if (!accRow) return;

        const isOpening = accRow.classList.contains('d-none');

        if (!isOpening) {
            accRow.classList.add('d-none');
            if (accIcon) {
                accIcon.classList.remove('bx-chevron-down', 'text-primary');
                accIcon.classList.add('bx-chevron-right');
            }
            if (mainRow) mainRow.classList.remove('table-active');
            return;
        }

        // Open accordion
        accRow.classList.remove('d-none');
        if (accIcon) {
            accIcon.classList.remove('bx-chevron-right');
            accIcon.classList.add('bx-chevron-down', 'text-primary');
        }
        if (mainRow) mainRow.classList.add('table-active');

        const contentBox = $(`accordion_content_${id}`);
        if (!contentBox) return;

        contentBox.innerHTML = `<div class="p-4 text-center text-muted"><i class='bx bx-loader-alt bx-spin me-1'></i> 상세 전표 내역을 불러오는 중입니다...</div>`;

        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            
            const items = data.items || [data];
            const isDirect = type === 'outbound' && data.is_direct === 1;

            let badgeHtml = type === 'inbound' 
                ? '<span class="erp-badge erp-badge-in">입고</span>' 
                : '<span class="erp-badge erp-badge-out">출고</span>';
            if (isDirect) {
                badgeHtml = '<span class="erp-badge erp-badge-direct">직출고</span>';
            }

            const borderClass = isDirect ? 'border-direct' : (type === 'inbound' ? 'border-inbound' : 'border-outbound');
            contentBox.className = `accordion-content-box ${borderClass}`;

            // Partner Summary (Clean Key-Value, no decorative icons/emojis)
            let partnerSummary = '';
            if (isDirect) {
                partnerSummary = `
                    <span class="acc-meta-item"><span class="acc-meta-label">매입처</span> <strong class="acc-meta-val">${data.supplier || '-'}</strong></span>
                    <span class="acc-meta-divider">|</span>
                    <span class="acc-meta-item"><span class="acc-meta-label">매출처</span> <strong class="acc-meta-val text-primary">${data.destination || '-'}</strong></span>
                    ${data.actual_destination ? `<span class="acc-meta-divider">|</span><span class="acc-meta-item"><span class="acc-meta-label">실출고처</span> <strong class="acc-meta-val text-secondary">${data.actual_destination}</strong></span>` : ''}
                `;
            } else if (type === 'inbound') {
                partnerSummary = `
                    <span class="acc-meta-item"><span class="acc-meta-label">매입처</span> <strong class="acc-meta-val">${data.supplier || '-'}</strong></span>
                    <span class="acc-meta-divider">|</span>
                    <span class="acc-meta-item"><span class="acc-meta-label">창고</span> <strong class="acc-meta-val text-secondary">${data.location_name || '-'}</strong></span>
                `;
            } else {
                partnerSummary = `
                    <span class="acc-meta-item"><span class="acc-meta-label">매출처</span> <strong class="acc-meta-val text-primary">${data.destination || '-'}</strong></span>
                    ${data.actual_destination ? `<span class="acc-meta-divider">|</span><span class="acc-meta-item"><span class="acc-meta-label">실출고처</span> <strong class="acc-meta-val text-secondary">${data.actual_destination}</strong></span>` : ''}
                `;
            }

            // Extra info
            let extraInfo = '';
            if (data.shipping_fee && data.shipping_fee > 0) {
                const shipVat = data.shipping_fee_vat_included === 1 ? '(부가세 포함)' : '(공급가)';
                const shipLabel = type === 'inbound' ? '매입배송비' : '배송비';
                extraInfo += `<span class="acc-meta-divider">|</span><span class="acc-meta-item"><span class="acc-meta-label">${shipLabel}</span> <strong class="acc-meta-val tabular-nums">${data.shipping_fee.toLocaleString()}원</strong> <span class="text-secondary" style="font-size:10.5px;">${shipVat}</span></span> `;
            }
            if (data.category) {
                extraInfo += `<span class="erp-badge erp-badge-cat">${data.category}</span> `;
            }
            if (data.trade_type && data.trade_type !== '내수') {
                extraInfo += `<span class="erp-badge erp-badge-info">${data.trade_type}</span> `;
            }

            // Print & Action Buttons (Standard ERP Toolbar Style)
            let printBtns = '';
            if (type === 'inbound') {
                printBtns = `
                    <button type="button" class="btn-acc-secondary" onclick="event.stopPropagation(); app.printDirectStatement(${data.id}, 'inbound', 'inbound_receipt')">
                        입고내역서
                    </button>
                `;
            } else {
                printBtns = `
                    <button type="button" class="btn-acc-primary" onclick="event.stopPropagation(); app.printDirectStatement(${data.id}, 'outbound', 'transaction_statement')">
                        거래명세서
                    </button>
                    <button type="button" class="btn-acc-secondary" onclick="event.stopPropagation(); app.printDirectStatement(${data.id}, 'outbound', 'outbound_receipt')">
                        출고내역서
                    </button>
                `;
                if (isDirect) {
                    printBtns += `
                        <button type="button" class="btn-acc-secondary" onclick="event.stopPropagation(); app.printDirectStatement(${data.id}, 'outbound', 'inbound_receipt')">
                            입고내역서
                        </button>
                    `;
                }
            }

            const editTxFn = isDirect 
                ? `app.openEditDirectOutboundTx('${data.transaction_group_id || ''}', ${data.id})` 
                : (type === 'outbound' ? `app.openEditOutboundTx('${data.transaction_group_id || ''}', ${data.id})` : `app.openEditInboundTx('${data.transaction_group_id || ''}', ${data.id})`);

            let editBtn = `
                <button type="button" class="btn-acc-secondary" onclick="event.stopPropagation(); ${editTxFn}" title="전표 수정">
                    전표 수정
                </button>
            `;

            // Table Rows
            let totalQty = 0;
            let totalInboundAmt = 0;
            let totalOutboundAmt = 0;

            let rowsHtml = items.map((item, idx) => {
                const itemQty = type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const inPrice = item.unit_price !== undefined ? item.unit_price : (item.inbound_price || 0);
                const outPrice = item.selling_price !== undefined ? item.selling_price : (item.outbound_price || 0);
                
                const inAmt = Math.round(inPrice * itemQty);
                const outAmt = Math.round(outPrice * itemQty);

                totalQty += itemQty;
                totalInboundAmt += inAmt;
                totalOutboundAmt += outAmt;

                let lotInfoHtml = '';
                if (type === 'outbound' && !isDirect && item.consumed_lots && item.consumed_lots.length > 0) {
                    const lotsBadges = item.consumed_lots.map(l => 
                        `<span class="acc-lot-chip me-1 tabular-nums">
                            ${l.inbound_date} 입고 (${l.supplier || '-'}) <strong class="text-danger">-${l.consumed_qty}</strong>
                         </span>`
                    ).join('');
                    lotInfoHtml = `
                        <div class="mt-1 text-muted" style="font-size:11px;">
                            <span class="acc-meta-label me-1">차감 Lot:</span>${lotsBadges}
                        </div>
                    `;
                }

                const catBadge = item.category ? `<span class="erp-badge erp-badge-cat ms-1">${item.category}</span>` : '';
                const fBadge = item.freight_type ? `<span class="${item.freight_type === '하차도' ? 'badge-freight-in' : 'badge-freight-ex'} ms-1">${item.freight_type}</span>` : '';

                if (isDirect) {
                    return `
                        <tr>
                            <td class="text-center row-index">${idx + 1}</td>
                            <td>
                                <span class="fw-semibold text-dark">${item.item}</span>
                                ${catBadge}
                                ${fBadge}
                            </td>
                            <td class="text-center">${item.spec || '-'}</td>
                            <td class="text-center">${item.unit || '-'}</td>
                            <td class="text-end fw-bold tabular-nums">${itemQty.toLocaleString()}</td>
                            <td class="text-end text-muted tabular-nums">${inPrice ? inPrice.toLocaleString() + '원' : '-'}</td>
                            <td class="text-end text-muted tabular-nums">${inAmt ? inAmt.toLocaleString() + '원' : '-'}</td>
                            <td class="text-end fw-bold text-dark tabular-nums">${outPrice ? outPrice.toLocaleString() + '원' : '-'}</td>
                            <td class="text-end fw-bold text-danger tabular-nums">${outAmt ? outAmt.toLocaleString() + '원' : '-'}</td>
                        </tr>
                    `;
                } else if (type === 'inbound') {
                    return `
                        <tr>
                            <td class="text-center row-index">${idx + 1}</td>
                            <td>
                                <span class="fw-semibold text-dark">${item.item}</span>
                                ${catBadge}
                                ${fBadge}
                            </td>
                            <td class="text-center">${item.spec || '-'}</td>
                            <td class="text-center">${item.unit || '-'}</td>
                            <td class="text-end fw-bold text-success tabular-nums">${itemQty.toLocaleString()}</td>
                            <td class="text-end text-dark tabular-nums">${inPrice.toLocaleString()}원</td>
                            <td class="text-end fw-bold text-success tabular-nums">${inAmt.toLocaleString()}원</td>
                            <td class="text-center">${item.location_name || '-'}</td>
                        </tr>
                    `;
                } else {
                    return `
                        <tr>
                            <td class="text-center row-index">${idx + 1}</td>
                            <td>
                                <span class="fw-semibold text-dark">${item.item}</span>
                                ${catBadge}
                                ${fBadge}
                                ${lotInfoHtml}
                            </td>
                            <td class="text-center">${item.spec || '-'}</td>
                            <td class="text-center">${item.unit || '-'}</td>
                            <td class="text-end fw-bold text-danger tabular-nums">${itemQty.toLocaleString()}</td>
                            <td class="text-end text-dark tabular-nums">${outPrice.toLocaleString()}원</td>
                            <td class="text-end fw-bold text-danger tabular-nums">${outAmt.toLocaleString()}원</td>
                        </tr>
                    `;
                }
            }).join('');

            // Headers and Summary
            let tableHeaderHtml = '';
            let tableSummaryHtml = '';

            if (isDirect) {
                tableHeaderHtml = `
                    <tr>
                        <th class="th-no" style="width: 36px;">#</th>
                        <th>품명</th>
                        <th style="width: 120px;">규격</th>
                        <th style="width: 60px;">단위</th>
                        <th style="width: 80px;" class="text-end">수량</th>
                        <th style="width: 105px;" class="text-end">매입단가</th>
                        <th style="width: 115px;" class="text-end">매입금액</th>
                        <th style="width: 105px;" class="text-end">매출단가</th>
                        <th style="width: 115px;" class="text-end">매출금액</th>
                    </tr>
                `;
                tableSummaryHtml = `
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-center fw-bold">합계 (${items.length}개 품목)</td>
                            <td class="text-end fw-bold text-primary tabular-nums">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end fw-bold text-muted tabular-nums">${totalInboundAmt.toLocaleString()}원</td>
                            <td></td>
                            <td class="text-end fw-bold text-danger tabular-nums">${totalOutboundAmt.toLocaleString()}원</td>
                        </tr>
                    </tfoot>
                `;
            } else if (type === 'inbound') {
                tableHeaderHtml = `
                    <tr>
                        <th class="th-no" style="width: 36px;">#</th>
                        <th>품명</th>
                        <th style="width: 130px;">규격</th>
                        <th style="width: 70px;">단위</th>
                        <th style="width: 90px;" class="text-end">수량</th>
                        <th style="width: 115px;" class="text-end">단가</th>
                        <th style="width: 125px;" class="text-end">총액</th>
                        <th style="width: 110px;">창고위치</th>
                    </tr>
                `;
                tableSummaryHtml = `
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-center fw-bold">합계 (${items.length}개 품목)</td>
                            <td class="text-end fw-bold text-success tabular-nums">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end fw-bold text-success tabular-nums">${totalInboundAmt.toLocaleString()}원</td>
                            <td></td>
                        </tr>
                    </tfoot>
                `;
            } else {
                tableHeaderHtml = `
                    <tr>
                        <th class="th-no" style="width: 36px;">#</th>
                        <th>품명</th>
                        <th style="width: 130px;">규격</th>
                        <th style="width: 70px;">단위</th>
                        <th style="width: 90px;" class="text-end">수량</th>
                        <th style="width: 115px;" class="text-end">단가</th>
                        <th style="width: 125px;" class="text-end">총액</th>
                    </tr>
                `;
                tableSummaryHtml = `
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-center fw-bold">합계 (${items.length}개 품목)</td>
                            <td class="text-end fw-bold text-danger tabular-nums">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end fw-bold text-danger tabular-nums">${totalOutboundAmt.toLocaleString()}원</td>
                        </tr>
                    </tfoot>
                `;
            }

            const txIdDisplay = data.transaction_group_id || (data.is_direct === 1 ? `OUT-${(data.date || '').split('T')[0].replace(/-/g,'')}-${String(data.id).padStart(4, '0')}` : (type === 'outbound' ? `OUT-${(data.date || '').split('T')[0].replace(/-/g,'')}-${String(data.id).padStart(4, '0')}` : `IN-${(data.date || '').split('T')[0].replace(/-/g,'')}-${String(data.id).padStart(4, '0')}`));

            contentBox.innerHTML = `
                <div class="acc-header-strip">
                    <div class="d-flex align-items-center gap-2 flex-wrap">
                        ${badgeHtml}
                        <span class="erp-badge-code tabular-nums">${txIdDisplay}</span>
                        <span class="acc-meta-divider">|</span>
                        <span class="acc-meta-item"><span class="acc-meta-label">일자</span> <strong class="acc-meta-val tabular-nums">${data.date.split('T')[0]}</strong></span>
                        <span class="acc-meta-divider">|</span>
                        ${partnerSummary}
                        ${extraInfo}
                    </div>
                    <div class="d-flex align-items-center gap-1">
                        ${printBtns}
                        ${editBtn}
                        <button type="button" class="btn-acc-secondary" onclick="event.stopPropagation(); app.toggleAccordion(${id}, '${type}')" title="접기">
                            <i class='bx bx-chevron-up me-1'></i>접기
                        </button>
                    </div>
                </div>

                ${data.note ? `<div class="acc-note-box"><strong class="acc-meta-label me-1">비고:</strong><span>${data.note}</span></div>` : ''}

                <div class="erp-grid-wrapper mt-1">
                    <table class="erp-sheet-table mb-0" style="font-size: 11.5px;">
                        <thead>
                            ${tableHeaderHtml}
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                        ${items.length > 1 ? tableSummaryHtml : ''}
                    </table>
                </div>
            `;

        } catch (err) {
            contentBox.innerHTML = `<div class="text-center py-3 text-danger"><i class='bx bx-error me-1'></i>상세 내역을 불러오는데 실패했습니다: ${err.message}</div>`;
        }
    },

    toggleSelectAllHistory() {
        const isChecked = $('selectAllHistory').checked;
        document.querySelectorAll('.history-checkbox').forEach(cb => {
            cb.checked = isChecked;
        });
        this.updateSelectionSummary();
    },

    clearHistorySelection() {
        const selectAll = $('selectAllHistory');
        if (selectAll) selectAll.checked = false;
        document.querySelectorAll('.history-checkbox').forEach(cb => {
            cb.checked = false;
        });
        this.updateSelectionSummary();
    },

    updateSelectionSummary() {
        const checked = Array.from(document.querySelectorAll('.history-checkbox:checked'));
        const allBoxes = document.querySelectorAll('.history-checkbox');
        const selectAll = $('selectAllHistory');
        if (selectAll) {
            selectAll.checked = allBoxes.length > 0 && checked.length === allBoxes.length;
        }

        if ($('bottomSelectedCount')) {
            $('bottomSelectedCount').textContent = checked.length;
        }

        const bar = $('floatingSelectionBar');
        if (!bar) return;

        if (checked.length === 0) {
            bar.classList.remove('show');
            return;
        }

        let totalQty = 0;
        let totalInbound = 0;
        let totalOutbound = 0;

        checked.forEach(cb => {
            const id = parseInt(cb.value, 10);
            const type = cb.dataset.type;
            const r = (this.currentHistoryData || []).find(item => item.id === id && item.type === type);
            if (r) {
                totalQty += Number(r.qty || 0);
                totalInbound += Number(r.inbound_total || 0);
                totalOutbound += Number(r.outbound_total || 0);
            }
        });

        const countEl = $('floatSelectedCount');
        const qtyEl = $('floatSelectedQty');
        const inTotalEl = $('floatInboundTotal');
        const outTotalEl = $('floatOutboundTotal');
        const inBox = $('floatInboundBox');
        const outBox = $('floatOutboundBox');

        if (countEl) countEl.innerText = checked.length.toLocaleString();
        if (qtyEl) qtyEl.innerText = totalQty.toLocaleString();
        if (inTotalEl) inTotalEl.innerText = Math.round(totalInbound).toLocaleString() + '원';
        if (outTotalEl) outTotalEl.innerText = Math.round(totalOutbound).toLocaleString() + '원';

        if (inBox && outBox) {
            if (totalInbound > 0 && totalOutbound === 0) {
                inBox.style.display = 'flex';
                outBox.style.display = 'none';
            } else if (totalOutbound > 0 && totalInbound === 0) {
                inBox.style.display = 'none';
                outBox.style.display = 'flex';
            } else {
                inBox.style.display = 'flex';
                outBox.style.display = 'flex';
            }
        }

        bar.classList.add('show');
    },

    openBulkUpdateModal() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        if (checkboxes.length === 0) {
            alert('일괄 수정할 항목을 체크해주세요.');
            return;
        }
        $('bulkUpdateCount').innerText = checkboxes.length;
        $('bulkUpdateForm').reset();
        
        const modalEl = document.getElementById('bulkUpdateModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    async submitBulkUpdate() {
        const checkboxes = document.querySelectorAll('.history-checkbox:checked');
        const inboundIds = [];
        const outboundIds = [];
        
        checkboxes.forEach(cb => {
            if (cb.dataset.type === 'inbound') inboundIds.push(cb.value);
            else outboundIds.push(cb.value);
        });

        const supplier = $('bulkSupplier').value.trim();
        const destination = $('bulkDestination').value.trim();
        const category = $('bulkCategory').value.trim();

        if (!supplier && !destination && !category) {
            alert('변경할 항목을 하나 이상 입력해주세요.');
            return;
        }

        try {
            await authFetch(`${API_BASE}/bulk-update`, {
                method: 'PUT',
                body: JSON.stringify({ inboundIds, outboundIds, supplier, destination, category })
            });
            alert('일괄 수정이 완료되었습니다.');
            
            const modalEl = document.getElementById('bulkUpdateModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            
            this.resetPageAndLoadHistory();
            this.loadCategories();
        } catch (err) {
            alert('일괄 수정 실패: ' + err.message);
        }
    },

    deleteSelectedHistory: async function() {
        const checked = Array.from(document.querySelectorAll('.history-checkbox:checked'));
        if (checked.length === 0) return alert('삭제할 항목을 선택하세요.');
        if (!confirm(`선택한 ${checked.length}개의 내역을 일괄 삭제하시겠습니까?\n(출고 내역 삭제 시 입고 잔여수량이 복구되며, 직출고의 경우 입출고 모두 함께 삭제됩니다.)`)) return;
        
        const inboundIds = [];
        const outboundIds = [];
        checked.forEach(cb => {
            const id = parseInt(cb.value, 10);
            if (cb.dataset.type === 'inbound') inboundIds.push(id);
            else if (cb.dataset.type === 'outbound') outboundIds.push(id);
        });

        const btn = document.querySelector('button[onclick="app.deleteSelectedHistory()"]');
        const origBtnHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 삭제 중...`;
        }

        try {
            const res = await authFetch(`${API_BASE}/bulk-delete`, {
                method: 'POST',
                body: JSON.stringify({ inboundIds, outboundIds })
            });
            alert(res.message || `선택한 ${checked.length}건의 내역이 성공적으로 삭제되었습니다.`);
            $('selectAllHistory').checked = false;
            this.resetPageAndLoadHistory();
        } catch (err) {
            alert('일괄 삭제 실패: ' + err.message);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = origBtnHtml;
            }
        }
    },

    printSelectedHistory: function() {
        const checked = Array.from(document.querySelectorAll('.history-checkbox:checked'));
        if (checked.length === 0) {
            alert('출력할 내역을 선택해주세요.');
            return;
        }

        if (!this.currentHistoryData) return;

        const selectedItems = checked.map(cb => {
            const id = parseInt(cb.value);
            const type = cb.dataset.type;
            return this.currentHistoryData.find(r => r.id === id && r.type === type);
        }).filter(item => item !== undefined);

        if (selectedItems.length === 0) return;

        let tableRows = '';
        let totalAmount = 0;
        
        selectedItems.forEach(item => {
            const isOut = item.type === 'outbound';
            const qty = item.qty || 0;
            const price = isOut ? (item.outbound_price || 0) : (item.inbound_price || 0);
            const amount = isOut ? (item.outbound_total || 0) : (item.inbound_total || 0);
            totalAmount += amount;
            
            const partner = isOut ? (item.destination || '') : (item.supplier || '');
            const typeText = isOut ? '출고' : '입고';
            
            tableRows += `
                <tr>
                    <td class="text-center">${item.date ? item.date.split('T')[0] : ''}</td>
                    <td class="text-center">${typeText}</td>
                    <td>${item.item || ''}</td>
                    <td>${item.spec || ''}</td>
                    <td class="text-center">${item.unit || ''}</td>
                    <td class="text-end">${qty.toLocaleString()}</td>
                    <td class="text-end">${price.toLocaleString()}</td>
                    <td class="text-end">${amount.toLocaleString()}</td>
                    <td>${partner}</td>
                </tr>
            `;
        });

        const printHtml = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>거래명세서</title>
                <style>
                    body { font-family: 'Malgun Gothic', sans-serif; padding: 20px; font-size: 12px; }
                    .header { text-align: center; margin-bottom: 20px; }
                    .header h2 { margin: 0; font-size: 24px; text-decoration: underline; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { border: 1px solid #000; padding: 5px 8px; }
                    th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
                    .text-center { text-align: center; }
                    .text-end { text-align: right; }
                    .total-row td { font-weight: bold; background-color: #f2f2f2; }
                    @media print {
                        @page { size: A4; margin: 1cm; }
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h2>거래명세서</h2>
                    <div style="text-align: right; margin-top: 10px;">출력일시: ${new Date().toLocaleString('ko-KR')}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 12%">일자</th>
                            <th style="width: 8%">구분</th>
                            <th style="width: 20%">품목</th>
                            <th style="width: 12%">규격</th>
                            <th style="width: 8%">단위</th>
                            <th style="width: 10%">수량</th>
                            <th style="width: 10%">단가</th>
                            <th style="width: 12%">금액</th>
                            <th style="width: 18%">거래처</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                        <tr class="total-row">
                            <td colspan="7" class="text-end">합계</td>
                            <td class="text-end">${totalAmount.toLocaleString()}</td>
                            <td></td>
                        </tr>
                    </tbody>
                </table>
            </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        if (printWindow) {
            printWindow.document.write(printHtml);
            printWindow.document.close();
            // Wait for styles to be applied
            setTimeout(() => {
                printWindow.focus();
                printWindow.print();
            }, 250);
        }
    },

    deleteInbound: async function(id) {
        if (!confirm('이 입고 내역을 정말 삭제하시겠습니까? (이미 출고된 내역은 삭제할 수 없습니다)')) return;
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, { method: 'DELETE' });
            alert('입고 내역이 삭제되었습니다.');
            this.loadHistory();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    deleteOutbound: async function(id) {
        if (!confirm('이 출고 내역을 정말 삭제하시겠습니까? (차감되었던 입고 재고가 다시 복구됩니다)')) return;
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, { method: 'DELETE' });
            alert('출고 내역이 삭제되고 재고가 복구되었습니다.');
            this.loadHistory();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    initTodayDates: function() {
        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
        $('in_date').value = today;
        $('out_date').value = today;
    },

    // ----------------------------------------
    // Locations (위치 관리)
    // ----------------------------------------
    loadLocations: async function() {
        try {
            locations = await authFetch(`${API_BASE}/locations`);
            const sel = $('in_location');
            sel.innerHTML = '<option value="">선택하세요</option>';
            locations.forEach(loc => {
                sel.innerHTML += `<option value="${loc.id}">${loc.name}</option>`;
            });
            this.renderLocationsModal();
        } catch (e) {
            console.error(e);
        }
    },

    renderLocationsModal: function() {
        const ul = $('locationList');
        ul.innerHTML = locations.map(loc => `
            <li>
                <span><i class='bx bx-map-pin text-muted'></i> ${loc.name}</span>
            </li>
        `).join('');
    },

    openLocationsModal: function() {
        const modalEl = $('locationsModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    addLocation: async function() {
        const input = $('newLocationInput');
        const name = input.value.trim();
        if (!name) return alert('이름을 입력하세요');
        try {
            await authFetch(`${API_BASE}/locations`, { method: 'POST', body: JSON.stringify({ name }) });
            input.value = '';
            await this.loadLocations();
        } catch (e) {
            alert('오류: ' + e.message);
        }
    },

    // ----------------------------------------
    // Partner Autocomplete & Quick Modal
    // ----------------------------------------
    partnersCache: [],
    
    setupPartnerAutocomplete: async function() {
        try {
            const CORE_API = API_BASE.replace('/logistics', '');
            const res = await authFetch(`${CORE_API}/partners`);
            this.partnersCache = res;
        } catch (e) {
            console.error('Failed to load partners', e);
        }
        // 거래처 자동완성은 이제 Partner Search Modal 로 이관됨
    },

    openPartnerSearchModal: function(targetInputId) {
        if (!this.partnersCache || this.partnersCache.length === 0) {
            this.setupPartnerAutocomplete().then(() => this.showPartnerSearchModal(targetInputId));
        } else {
            this.showPartnerSearchModal(targetInputId);
        }
    },

    partnerSearchActiveIndex: 0,

    showPartnerSearchModal: function(targetInputId) {
        const inputEl = $(targetInputId);
        if (!inputEl) return;
        
        $('partnerSearchTargetInput').value = targetInputId;
        const searchVal = inputEl.value.trim();
        const searchInput = $('partnerSearchInput');
        if (searchInput) searchInput.value = searchVal;
        
        this.partnerSearchActiveIndex = 0;
        this.filterPartnerSearch();

        const modalEl = $('partnerSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl, { focus: false, backdrop: true });
        modal.show();
        
        if (!modalEl._partnerKeydownBound) {
            modalEl.addEventListener('keydown', (e) => app.handlePartnerSearchKeydown(e));
            modalEl._partnerKeydownBound = true;
        }

        // 포커스 이동 & 텍스트 전체 선택 (바로 타이핑 또는 방향키/Enter 선택 가능)
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
        setTimeout(() => {
            if (searchInput && document.activeElement !== searchInput) {
                searchInput.focus();
                searchInput.select();
            }
        }, 50);
    },

    filterPartnerSearch: function() {
        const inputEl = $('partnerSearchInput');
        const val = inputEl ? inputEl.value.trim().toLowerCase() : '';
        const listContainer = $('partnerSearchList');
        if (!listContainer) return;
        
        let matches = this.partnersCache || [];
        if (val) {
            matches = matches.filter(p => 
                (p.name && p.name.toLowerCase().includes(val)) || 
                (p.company_name && p.company_name.toLowerCase().includes(val))
            );
        }
        
        this.partnerSearchActiveIndex = 0;

        if (matches.length === 0) {
            listContainer.innerHTML = `<div class="list-group-item text-center text-muted py-4">검색된 거래처가 없습니다.</div>`;
            return;
        }

        listContainer.innerHTML = matches.map((m, idx) => {
            const isFirst = (idx === 0);
            const safeName = this.escapeHtml(m.name);
            const safeCompany = m.company_name ? this.escapeHtml(m.company_name) : '';
            return `
                <button type="button" 
                        class="list-group-item list-group-item-action py-2 partner-search-item ${isFirst ? 'active' : ''}" 
                        data-index="${idx}"
                        data-name="${safeName}"
                        onclick="app.selectPartner('${safeName}')">
                    <div class="d-flex justify-content-between align-items-center">
                        <div class="fw-bold">${safeName}</div>
                        <span class="badge-select-hint">Enter 선택</span>
                    </div>
                    ${safeCompany ? `<div style="font-size: 0.8rem;" class="text-muted">${safeCompany}</div>` : ''}
                </button>
            `;
        }).join('');

        // 마우스 호버 시 활성 인덱스 동기화
        listContainer.querySelectorAll('.partner-search-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const idx = parseInt(item.dataset.index, 10);
                if (!isNaN(idx)) this.setPartnerSearchActiveIndex(idx);
            });
        });
    },

    setPartnerSearchActiveIndex: function(idx) {
        const items = document.querySelectorAll('#partnerSearchList .partner-search-item');
        if (!items || items.length === 0) return;

        if (idx < 0) idx = 0;
        if (idx >= items.length) idx = items.length - 1;
        this.partnerSearchActiveIndex = idx;

        items.forEach((item, i) => {
            if (i === idx) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('active');
            }
        });
    },

    handlePartnerSearchKeydown: function(e) {
        const items = document.querySelectorAll('#partnerSearchList .partner-search-item');

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            if (items.length > 0) {
                this.setPartnerSearchActiveIndex(this.partnerSearchActiveIndex + 1);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (items.length > 0) {
                this.setPartnerSearchActiveIndex(this.partnerSearchActiveIndex - 1);
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (items && items.length > 0) {
                const activeItem = items[this.partnerSearchActiveIndex] || items[0];
                if (activeItem && activeItem.dataset.name) {
                    this.selectPartner(activeItem.dataset.name);
                }
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const modalEl = $('partnerSearchModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
            const targetId = $('partnerSearchTargetInput')?.value;
            setTimeout(() => {
                if (document.querySelector('.modal.show')) {
                    document.body.classList.add('modal-open');
                }
                if (targetId && $(targetId)) $(targetId).focus();
            }, 50);
        }
    },

    selectPartner: function(name) {
        const targetId = $('partnerSearchTargetInput')?.value;
        if (targetId && $(targetId)) {
            $(targetId).value = name;
            $(targetId).dispatchEvent(new Event('input', { bubbles: true }));
            $(targetId).dispatchEvent(new Event('change', { bubbles: true }));
        }
        const modalEl = $('partnerSearchModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        // 선택 완료 후 원래 입력창으로 포커스 복원 및 상위 모달(직출고/입고/출고 등) 상태 완벽 보존
        setTimeout(() => {
            if (document.querySelector('.modal.show')) {
                document.body.classList.add('modal-open');
            }
            if (targetId && $(targetId)) {
                $(targetId).focus();
            }
        }, 50);
    },


    // ----------------------------------------
    // Inbound (입고)
    // ----------------------------------------
    addInboundItemRow: function(autoFocus = false) {
        const container = $('inboundItemsContainer');
        const rowId = 'in_row_' + Date.now() + Math.floor(Math.random() * 1000);
        const rowHtml = `
            <tr class="inbound-item-row" id="${rowId}">
                <td class="text-center text-muted row-index fw-semibold" style="user-select: none; text-align: center !important; vertical-align: middle !important; padding: 0 !important; line-height: 26px !important;"></td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input in-item" placeholder="품목명 입력/선택" autocomplete="off" required>
                        <div class="autocomplete-suggestions item-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input in-spec" placeholder="규격" autocomplete="off" required>
                        <div class="autocomplete-suggestions spec-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td class="text-center">
                    <select class="erp-cell-select in-freight-type">
                        <option value="상차도" selected>상차도</option>
                        <option value="하차도">하차도</option>
                    </select>
                </td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input in-category category-input" placeholder="분류" autocomplete="off">
                        <div class="autocomplete-suggestions category-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <input type="number" class="erp-cell-input in-qty text-end" placeholder="0" step="0.01" required>
                </td>
                <td>
                    <input type="text" class="erp-cell-input in-unit text-center" placeholder="단위" required>
                </td>
                <td>
                    <input type="number" class="erp-cell-input in-price text-end" placeholder="0" min="0" step="1" required>
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input in-supply text-end bg-readonly" placeholder="0원" readonly tabindex="-1">
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input in-vat text-end bg-readonly text-muted" placeholder="0원" readonly tabindex="-1">
                </td>
                <td>
                    <input type="text" class="erp-cell-input in-note" placeholder="적요/비고">
                </td>
                <td class="text-center">
                    <button type="button" class="btn-row-del" onclick="app.removeInboundItemRow('${rowId}')" title="항목 삭제">
                        <i class='bx bx-x'></i>
                    </button>
                </td>
            </tr>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        // 새로 추가된 행의 품목 입력칸에 자동완성 이벤트 연결
        const newRow = $(rowId);
        const input = newRow.querySelector('.in-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        if (sug) sug.classList.add('item-suggestions');

        const freightSelect = newRow.querySelector('.in-freight-type');
        if (freightSelect) {
            freightSelect.addEventListener('change', () => {
                newRow.dataset.freightManuallySet = 'true';
                this.autoFillPricesForRow(newRow, 'inbound', newRow.querySelector('.in-item').value.trim(), newRow.querySelector('.in-spec').value.trim());
            });
        }
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const map = await this.loadItemSpecsMap();
                let items = Object.keys(map || {});
                if (items.length === 0) {
                    items = await authFetch(`${API_BASE}/items/all`);
                }
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => {
                        const itemInfo = map ? map[m] : null;
                        const specCount = itemInfo && itemInfo.specs ? itemInfo.specs.length : 0;
                        const countBadge = specCount > 0 
                            ? `<span class="badge bg-light text-secondary border px-1 py-0 ms-auto" style="font-size: 9.5px; font-weight: 500;">규격 ${specCount}종</span>` 
                            : '';
                        const catBadge = itemInfo && itemInfo.defaultCategory 
                            ? `<span class="badge bg-secondary-subtle text-secondary px-1 py-0 ms-1" style="font-size: 9.5px;">${this.escapeHtml(itemInfo.defaultCategory)}</span>` 
                            : '';
                        return `
                            <div class="autocomplete-suggestion d-flex justify-content-between align-items-center" data-val="${this.escapeHtml(m)}">
                                <div class="d-flex align-items-center gap-1 text-nowrap">
                                    <i class='bx bx-cube text-primary' style='font-size: 11.5px;'></i>
                                    <span>${this.highlightMatch(m, val)}</span>
                                    ${catBadge}
                                </div>
                                ${countBadge}
                            </div>
                        `;
                    }).join('');
                    this.positionAutocomplete(input, sug);
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        const selectItem = (e) => {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                            input.value = div.dataset.val || div.innerText.trim();
                            sug.style.display = 'none';
                            input.dispatchEvent(new Event('change'));
                            this.handleItemSelectionAutoFill(newRow, 'inbound', input.value.trim());
                        };
                        div.addEventListener('mousedown', selectItem);
                        div.addEventListener('click', selectItem);
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        input.addEventListener('change', () => {
            const val = input.value.trim();
            if (val) {
                this.handleItemSelectionAutoFill(newRow, 'inbound', val);
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => { sug.style.display = 'none'; }, 150);
        });

        // 외부 클릭 시 자동완성 닫기 처리
        document.addEventListener('click', (e) => {
            if (e.target !== input && !e.target.closest('.autocomplete-suggestions')) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        this.bindSpecAutocomplete(newRow, 'inbound');
        this.setupCategoryAutocomplete();

        const qtyInp = newRow.querySelector('.in-qty');
        const priceInp = newRow.querySelector('.in-price');
        const updateCalc = () => this.updateInboundGridTotals();
        qtyInp.addEventListener('input', updateCalc);
        priceInp.addEventListener('input', updateCalc);

        // ERP 그리드 키보드 이동 및 엑셀 붙여넣기 바인딩
        this.bindGridKeyboardAndPaste(newRow, 'inbound');

        this.updateInboundGridTotals();

        if (autoFocus && input) {
            setTimeout(() => {
                input.focus();
                if (input.select) input.select();
            }, 10);
        }

        return rowId;
    },

    removeInboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
        this.updateInboundGridTotals();
    },

    removeLastInboundRow: function() {
        const container = $('inboundItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.inbound-item-row');
        if (rows.length > 1) {
            rows[rows.length - 1].remove();
            this.updateInboundGridTotals();
        }
    },

    updateInboundGridTotals: function() {
        const container = $('inboundItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.inbound-item-row');
        let totalQty = 0;
        let totalSupply = 0;
        let totalVat = 0;

        rows.forEach((r, idx) => {
            const indexEl = r.querySelector('.row-index');
            if (indexEl) indexEl.innerText = idx + 1;

            const q = parseFloat(r.querySelector('.in-qty')?.value) || 0;
            const p = parseFloat(r.querySelector('.in-price')?.value) || 0;
            const s = Math.round(q * p);
            const v = Math.round(s * 0.1);

            const supplyEl = r.querySelector('.in-supply');
            const vatEl = r.querySelector('.in-vat');
            if (supplyEl) supplyEl.value = s ? s.toLocaleString() + '원' : '';
            if (vatEl) vatEl.value = v ? v.toLocaleString() + '원' : '';

            totalQty += q;
            totalSupply += s;
            totalVat += v;
        });

        const grandTotal = totalSupply + totalVat;
        if ($('in_total_qty')) $('in_total_qty').innerText = totalQty ? totalQty.toLocaleString() : '0';
        if ($('in_total_supply')) $('in_total_supply').innerText = totalSupply.toLocaleString() + '원';
        if ($('in_total_vat')) $('in_total_vat').innerText = totalVat.toLocaleString() + '원';
        if ($('in_summary_supply')) $('in_summary_supply').innerText = totalSupply.toLocaleString() + '원';
        if ($('in_summary_vat')) $('in_summary_vat').innerText = totalVat.toLocaleString() + '원';
        if ($('in_grand_total')) $('in_grand_total').innerText = grandTotal.toLocaleString();
        if ($('in_row_count')) $('in_row_count').innerText = rows.length + '건';
    },

    setupInboundAutocomplete: function() {
        // 초기화 시 기본으로 1개 행 추가
        this.addInboundItemRow();
    },

    handleInboundSubmit: async function(e) {
        e.preventDefault();
        
        const rows = $('inboundItemsContainer').querySelectorAll('.inbound-item-row');
        if (rows.length === 0) return alert('입고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;
        const docNote = $('in_note') ? $('in_note').value.trim() : '';

        rows.forEach((row) => {
            const item = row.querySelector('.in-item').value.trim();
            const spec = row.querySelector('.in-spec').value.trim();
            const unit = row.querySelector('.in-unit').value.trim();
            const qtyStr = row.querySelector('.in-qty').value.trim();
            const priceStr = row.querySelector('.in-price').value.trim();
            const qty = parseFloat(qtyStr);
            const unit_price = parseFloat(priceStr);
            const category = row.querySelector('.in-category') ? row.querySelector('.in-category').value.trim() : '';
            const rowNote = row.querySelector('.in-note') ? row.querySelector('.in-note').value.trim() : '';
            const note = rowNote || docNote;
            const trade_type = $('in_trade_type') ? $('in_trade_type').value : '내수';

            const freight_type = row.querySelector('.in-freight-type') ? row.querySelector('.in-freight-type').value : '상차도';

            // 완전히 빈 행은 무시
            if (!item && !spec && !unit && !qtyStr && !priceStr && !rowNote) {
                return;
            }

            if (!item || !spec || !unit || isNaN(qty) || isNaN(unit_price)) {
                hasError = true;
            } else {
                items.push({ id: row.dataset.dbId, item, spec, unit, qty, unit_price, note, trade_type, category, freight_type, freight_region: '' });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');
        if (items.length === 0) return alert('입력된 품목이 없습니다. 최소 1개 이상의 품목을 입력해주세요.');

        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            items: items
        };

        const mode = $('inboundForm').dataset.mode;
        const txId = $('inboundForm').dataset.txId;
        const confirmMsg = mode === 'edit' ? `총 ${items.length}건의 품목으로 입고 내역을 수정하시겠습니까?` : `총 ${items.length}건의 품목을 입고하시겠습니까?`;
        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/inbound/tx/${txId}`, { method: 'PUT', body: JSON.stringify(payload) });
                    $('inboundForm').dataset.mode = '';
                    $('inboundForm').dataset.txId = '';
                } else {
                    await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                }
                alert('입고 완료되었습니다.');
                this.resetInboundModalForm();
                this.loadItemSpecsMap(true);
                this.loadUnitPricesMap(true);
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('입고 실패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Utility: Autocomplete Keyboard Navigation
    // ----------------------------------------
    attachAutocompleteKeyboard: function(input, sugBox) {
        let currentFocus = -1;
        input.addEventListener('keydown', function(e) {
            if (sugBox.style.display === 'none') return;
            const items = sugBox.querySelectorAll('.autocomplete-suggestion');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                currentFocus++;
                if (currentFocus >= items.length) currentFocus = 0;
                setActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                currentFocus--;
                if (currentFocus < 0) currentFocus = items.length - 1;
                setActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentFocus > -1) {
                    items[currentFocus].click();
                }
                sugBox.style.display = 'none';
            } else if (e.key === 'Escape' || e.key === 'Tab') {
                sugBox.style.display = 'none';
                currentFocus = -1;
            }
        });

        input.addEventListener('input', () => { currentFocus = -1; });

        function setActive(items) {
            items.forEach(item => item.classList.remove('active-suggestion'));
            items[currentFocus].classList.add('active-suggestion');
            // Auto scroll (optional, simple logic)
            items[currentFocus].scrollIntoView({ block: 'nearest' });
        }
    },

    // ----------------------------------------
    // Direct Shipment (직출고)
    // ----------------------------------------
    addDirectItemRow: function(autoFocus = false) {
        const container = $('directItemsContainer');
        const rowId = 'dir_row_' + Date.now() + Math.floor(Math.random() * 1000);

        const rowHtml = `
            <tr class="direct-item-row" id="${rowId}">
                <td class="text-center text-muted row-index fw-semibold" style="user-select: none; text-align: center !important; vertical-align: middle !important; padding: 0 !important; line-height: 26px !important;"></td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input dir-item" placeholder="품목명 입력/선택" autocomplete="off" required>
                        <div class="autocomplete-suggestions item-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input dir-spec" placeholder="규격" autocomplete="off">
                        <div class="autocomplete-suggestions spec-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td class="text-center">
                    <select class="erp-cell-select dir-freight-type">
                        <option value="하차도" selected>하차도</option>
                        <option value="상차도">상차도</option>
                    </select>
                </td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input dir-category category-input" placeholder="분류" autocomplete="off">
                        <div class="autocomplete-suggestions category-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <input type="number" class="erp-cell-input dir-qty text-end" placeholder="0" step="0.01" required>
                </td>
                <td>
                    <input type="text" class="erp-cell-input dir-unit text-center" placeholder="단위">
                </td>
                <td>
                    <input type="number" class="erp-cell-input dir-in-price text-end" placeholder="0" min="0" step="1">
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input dir-in-supply text-end bg-readonly text-primary fw-bold" placeholder="0원" readonly tabindex="-1">
                </td>
                <td>
                    <input type="number" class="erp-cell-input dir-out-price text-end" placeholder="0" min="0" step="1">
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input dir-out-supply text-end bg-readonly text-danger fw-bold" placeholder="0원" readonly tabindex="-1">
                </td>
                <td>
                    <input type="text" class="erp-cell-input dir-note" placeholder="적요/비고">
                </td>
                <td class="text-center">
                    <button type="button" class="btn-row-del" onclick="app.removeDirectItemRow('${rowId}')" title="행 삭제 (Delete)">
                        <i class='bx bx-x'></i>
                    </button>
                </td>
            </tr>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        const newRow = $(rowId);
        const input = newRow.querySelector('.dir-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        if (sug) sug.classList.add('item-suggestions');

        const freightSelect = newRow.querySelector('.dir-freight-type');
        if (freightSelect) {
            const outShippingFee = parseFloat($('dir_out_shipping') ? $('dir_out_shipping').value : 0) || 0;
            const inShippingFee = parseFloat($('dir_in_shipping') ? $('dir_in_shipping').value : 0) || 0;
            freightSelect.value = (outShippingFee > 0 || inShippingFee > 0) ? '상차도' : '하차도';

            freightSelect.addEventListener('change', () => {
                newRow.dataset.freightManuallySet = 'true';
                this.autoFillPricesForRow(newRow, 'direct', newRow.querySelector('.dir-item').value.trim(), newRow.querySelector('.dir-spec').value.trim());
            });
        }
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const map = await this.loadItemSpecsMap();
                let items = Object.keys(map || {});
                if (items.length === 0) {
                    items = await authFetch(`${API_BASE}/items/all`);
                }
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => {
                        const itemInfo = map ? map[m] : null;
                        const specCount = itemInfo && itemInfo.specs ? itemInfo.specs.length : 0;
                        const countBadge = specCount > 0 
                            ? `<span class="badge bg-light text-secondary border px-1 py-0 ms-auto" style="font-size: 9.5px; font-weight: 500;">규격 ${specCount}종</span>` 
                            : '';
                        const catBadge = itemInfo && itemInfo.defaultCategory 
                            ? `<span class="badge bg-secondary-subtle text-secondary px-1 py-0 ms-1" style="font-size: 9.5px;">${this.escapeHtml(itemInfo.defaultCategory)}</span>` 
                            : '';
                        return `
                            <div class="autocomplete-suggestion d-flex justify-content-between align-items-center" data-val="${this.escapeHtml(m)}">
                                <div class="d-flex align-items-center gap-1 text-nowrap">
                                    <i class='bx bx-cube text-primary' style='font-size: 11.5px;'></i>
                                    <span>${this.highlightMatch(m, val)}</span>
                                    ${catBadge}
                                </div>
                                ${countBadge}
                            </div>
                        `;
                    }).join('');
                    this.positionAutocomplete(input, sug);
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        const selectItem = (e) => {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                            input.value = div.dataset.val || div.innerText.trim();
                            sug.style.display = 'none';
                            input.dispatchEvent(new Event('change'));
                            this.handleItemSelectionAutoFill(newRow, 'direct', input.value.trim());
                        };
                        div.addEventListener('mousedown', selectItem);
                        div.addEventListener('click', selectItem);
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        input.addEventListener('change', () => {
            const val = input.value.trim();
            if (val) {
                this.handleItemSelectionAutoFill(newRow, 'direct', val);
            }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => { sug.style.display = 'none'; }, 150);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input && !e.target.closest('.autocomplete-suggestions')) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        this.bindSpecAutocomplete(newRow, 'direct');
        this.setupCategoryAutocomplete();

        const qtyInp = newRow.querySelector('.dir-qty');
        const inPriceInp = newRow.querySelector('.dir-in-price');
        const outPriceInp = newRow.querySelector('.dir-out-price');
        const updateCalc = () => this.updateDirectGridTotals();
        qtyInp.addEventListener('input', updateCalc);
        inPriceInp.addEventListener('input', updateCalc);
        outPriceInp.addEventListener('input', updateCalc);

        // ERP 그리드 키보드 이동 및 엑셀 붙여넣기 바인딩
        this.bindGridKeyboardAndPaste(newRow, 'direct');

        this.updateDirectGridTotals();

        if (autoFocus && input) {
            setTimeout(() => {
                input.focus();
                if (input.select) input.select();
            }, 10);
        }

        return rowId;
    },

    removeDirectItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
        this.updateDirectGridTotals();
    },

    removeLastDirectRow: function() {
        const container = $('directItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.direct-item-row');
        if (rows.length > 1) {
            rows[rows.length - 1].remove();
            this.updateDirectGridTotals();
        }
    },

    updateDirectGridTotals: function() {
        const container = $('directItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.direct-item-row');
        let totalQty = 0;
        let totalInSupply = 0;
        let totalOutSupply = 0;

        rows.forEach((r, idx) => {
            const indexEl = r.querySelector('.row-index');
            if (indexEl) indexEl.innerText = idx + 1;

            const q = parseFloat(r.querySelector('.dir-qty')?.value) || 0;
            const inP = parseFloat(r.querySelector('.dir-in-price')?.value) || 0;
            const outP = parseFloat(r.querySelector('.dir-out-price')?.value) || 0;
            const inS = Math.round(q * inP);
            const outS = Math.round(q * outP);

            const inSupplyEl = r.querySelector('.dir-in-supply');
            const outSupplyEl = r.querySelector('.dir-out-supply');
            if (inSupplyEl) inSupplyEl.value = inS ? inS.toLocaleString() + '원' : '';
            if (outSupplyEl) outSupplyEl.value = outS ? outS.toLocaleString() + '원' : '';

            totalQty += q;
            totalInSupply += inS;
            totalOutSupply += outS;
        });

        const inShipping = parseFloat($('dir_in_shipping')?.value) || 0;
        const outShipping = parseFloat($('dir_out_shipping')?.value) || 0;
        const inShippingVat = $('dir_in_shipping_vat')?.checked ? 0 : Math.round(inShipping * 0.1);
        const outShippingVat = $('dir_out_shipping_vat')?.checked ? 0 : Math.round(outShipping * 0.1);

        // 배송비 변경 시 수동 변경되지 않은 행들의 운임조건 기본값 동적 추천
        const hasDirectFreight = (inShipping > 0 || outShipping > 0);
        rows.forEach(r => {
            if (!r.dataset.freightManuallySet) {
                const sel = r.querySelector('.dir-freight-type');
                if (sel) sel.value = hasDirectFreight ? '상차도' : '하차도';
            }
        });

        const grandInTotal = totalInSupply + Math.round(totalInSupply * 0.1) + inShipping + inShippingVat;
        const grandOutTotal = totalOutSupply + Math.round(totalOutSupply * 0.1) + outShipping + outShippingVat;

        if ($('dir_total_qty')) $('dir_total_qty').innerText = totalQty ? totalQty.toLocaleString() : '0';
        if ($('dir_total_in_supply')) $('dir_total_in_supply').innerText = totalInSupply.toLocaleString() + '원';
        if ($('dir_total_out_supply')) $('dir_total_out_supply').innerText = totalOutSupply.toLocaleString() + '원';
        if ($('dir_grand_in_total')) $('dir_grand_in_total').innerText = grandInTotal.toLocaleString();
        if ($('dir_grand_out_total')) $('dir_grand_out_total').innerText = grandOutTotal.toLocaleString();
        if ($('dir_row_count')) $('dir_row_count').innerText = rows.length + '건';
    },

    handleDirectSubmit: async function(e) {
        e.preventDefault();
        
        const rows = $('directItemsContainer').querySelectorAll('.direct-item-row');
        if (rows.length === 0) return alert('직출고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        const date = $('dir_date').value;
        const supplier = $('dir_supplier').value.trim();
        const destination = $('dir_destination').value.trim();
        const actual_destination = $('dir_actual_destination') ? $('dir_actual_destination').value.trim() : '';
        
        if (!supplier || !destination) {
            return alert('매입처와 매출처를 모두 입력해주세요.');
        }

        const docInShippingFee = parseFloat($('dir_in_shipping') ? $('dir_in_shipping').value : 0) || 0;
        const docInShippingFeeVatIncluded = $('dir_in_shipping_vat') && $('dir_in_shipping_vat').checked ? 1 : 0;
        const docOutShippingFee = parseFloat($('dir_out_shipping') ? $('dir_out_shipping').value : 0) || 0;
        const docOutShippingFeeVatIncluded = $('dir_out_shipping_vat') && $('dir_out_shipping_vat').checked ? 1 : 0;
        const docNote = $('dir_note') ? $('dir_note').value.trim() : '';

        const hasDirectFreight = (docInShippingFee > 0 || docOutShippingFee > 0);
        const productFreightType = hasDirectFreight ? '상차도' : '하차도';

        rows.forEach((row, idx) => {
            const item = row.querySelector('.dir-item').value.trim();
            const spec = row.querySelector('.dir-spec').value.trim();
            const unit = row.querySelector('.dir-unit') ? row.querySelector('.dir-unit').value.trim() : '';
            const qtyVal = row.querySelector('.dir-qty') ? row.querySelector('.dir-qty').value.trim() : '';
            const qty = parseFloat(qtyVal);
            const inPriceVal = row.querySelector('.dir-in-price') ? row.querySelector('.dir-in-price').value.trim() : '';
            const in_price = inPriceVal !== '' ? (parseFloat(inPriceVal) || 0) : 0;
            const outPriceVal = row.querySelector('.dir-out-price') ? row.querySelector('.dir-out-price').value.trim() : '';
            const out_price = outPriceVal !== '' ? (parseFloat(outPriceVal) || 0) : 0;
            const category = row.querySelector('.dir-category') ? row.querySelector('.dir-category').value.trim() : '';
            // 배송비는 전표 하단에 독립 품목 행으로 생성되므로 제품 행에는 0 설정 (중복 방지)
            const in_shipping_fee = 0;
            const in_shipping_fee_vat_included = 0;
            const shipping_fee = 0;
            const shipping_fee_vat_included = 0;
            const rowNote = row.querySelector('.dir-note') ? row.querySelector('.dir-note').value.trim() : '';
            const note = rowNote || docNote;
            const trade_type = $('dir_trade_type') ? $('dir_trade_type').value : '내수';
            const freight_type = row.querySelector('.dir-freight-type') ? row.querySelector('.dir-freight-type').value : productFreightType;

            // 완전히 빈 행은 무시
            if (!item && !spec && !unit && !qtyVal && !inPriceVal && !outPriceVal && !rowNote) {
                return;
            }

            if (!item || isNaN(qty)) {
                hasError = true;
            } else {
                items.push({ 
                    id: row.dataset.dbId, item, spec: spec || '', unit: unit || '', qty, 
                    unit_price: in_price, inbound_price: in_price,
                    selling_price: out_price, outbound_price: out_price, 
                    in_shipping_fee, in_shipping_fee_vat_included,
                    shipping_fee, shipping_fee_vat_included, 
                    freight_type, freight_region: actual_destination || destination || '',
                    note, trade_type, category 
                });
            }
        });

        if (hasError) return alert('공급 품목 내역의 품목명과 수량을 올바르게 입력해주세요.');
        if (items.length === 0) return alert('입력된 품목이 없습니다. 최소 1개 이상의 품목을 입력해주세요.');

        // 배송비가 0보다 큰 경우 독립된 '운반비' 품목 행 자동 추가 (기존 목록에 없을 때만)
        if (hasDirectFreight && !items.some(i => (i.item || '').trim() === '운반비' || (i.item || '').trim() === '배송비')) {
            items.push({
                item: '운반비',
                spec: '',
                unit: '건',
                qty: 1,
                unit_price: docInShippingFee,
                inbound_price: docInShippingFee,
                selling_price: docOutShippingFee,
                outbound_price: docOutShippingFee,
                in_shipping_fee: 0,
                in_shipping_fee_vat_included: 0,
                shipping_fee: 0,
                shipping_fee_vat_included: 0,
                freight_type: '상차도',
                freight_region: actual_destination || destination || '',
                note: docNote || '운반비',
                trade_type: $('dir_trade_type') ? $('dir_trade_type').value : '내수',
                category: '운반비'
            });
        }

        const payload = {
            date: date,
            supplier: supplier,
            destination: destination,
            actual_destination: actual_destination,
            items: items
        };

        const mode = $('directForm').dataset.mode;
        const txId = $('directForm').dataset.txId;
        const confirmMsg = mode === 'edit'
            ? `총 ${items.length}건의 품목으로 직출고 내역을 수정하시겠습니까?`
            : `총 ${items.length}건의 품목을 직출고로 동시 처리하시겠습니까? (입고/출고 장부에 동시 반영됨)`;

        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/direct/tx/${encodeURIComponent(txId)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    $('directForm').dataset.mode = '';
                    $('directForm').dataset.txId = '';
                    alert('직출고 수정이 완료되었습니다.');
                } else {
                    await authFetch(`${API_BASE}/direct`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    alert('직출고 처리가 완료되었습니다.');
                }
                
                this.resetDirectModalForm();
                this.loadItemSpecsMap(true);
                this.loadUnitPricesMap(true);
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('직출고 처리 실패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Outbound (출고)
    // ----------------------------------------
    outboundRows: {}, // rowId -> { availableLots: [], consumedLots: [] }
    currentLotModalRowId: null,

    setupOutboundAutocomplete: function() {
        // 초기 1행
        this.addOutboundItemRow();
    },

    addOutboundItemRow: function(autoFocus = false) {
        const container = $('outboundItemsContainer');
        const rowId = 'out_row_' + Date.now() + Math.floor(Math.random() * 1000);
        this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };

        const rowHtml = `
            <tr class="outbound-item-row" id="${rowId}">
                <td class="text-center text-muted row-index fw-semibold" style="user-select: none; text-align: center !important; vertical-align: middle !important; padding: 0 !important; line-height: 26px !important;"></td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input out-item" placeholder="품목명 입력/선택" autocomplete="off" required>
                        <div class="autocomplete-suggestions item-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <select class="erp-cell-input out-spec" disabled required onchange="app.handleOutboundSpecChange('${rowId}', this)">
                        <option value="">품목 먼저 선택</option>
                    </select>
                </td>
                <td class="text-center">
                    <select class="erp-cell-select out-freight-type">
                        <option value="상차도" selected>상차도</option>
                        <option value="하차도">하차도</option>
                    </select>
                </td>
                <td>
                    <div class="position-relative w-100 h-100 d-flex align-items-center">
                        <input type="text" class="erp-cell-input out-category category-input" placeholder="분류" autocomplete="off">
                        <div class="autocomplete-suggestions category-suggestions" style="display:none;"></div>
                    </div>
                </td>
                <td>
                    <input type="number" class="erp-cell-input out-qty text-end" placeholder="0" step="0.01" disabled required onchange="app.handleOutboundQtyChange('${rowId}')" onkeyup="app.handleOutboundQtyChange('${rowId}')">
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input out-unit text-center bg-readonly" placeholder="단위" readonly tabindex="-1">
                </td>
                <td class="text-center p-0">
                    <button type="button" class="btn btn-outline-primary cell-btn-lot btn-lot w-100" onclick="app.openLotModal('${rowId}')" disabled>
                        <i class='bx bx-check-shield'></i> Lot설정
                    </button>
                </td>
                <td>
                    <input type="number" class="erp-cell-input out-price text-end" placeholder="0" min="0" step="1" required>
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input out-supply text-end bg-readonly" placeholder="0원" readonly tabindex="-1">
                </td>
                <td class="td-readonly">
                    <input type="text" class="erp-cell-input out-vat text-end bg-readonly text-muted" placeholder="0원" readonly tabindex="-1">
                </td>
                <td>
                    <input type="text" class="erp-cell-input out-note" placeholder="적요/비고">
                </td>
                <td class="text-center">
                    <button type="button" class="btn-row-del" onclick="app.removeOutboundItemRow('${rowId}')" title="행 삭제 (Delete)">
                        <i class='bx bx-x'></i>
                    </button>
                </td>
            </tr>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);

        const newRow = $(rowId);
        const input = newRow.querySelector('.out-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        if (sug) sug.classList.add('item-suggestions');

        const freightSelect = newRow.querySelector('.out-freight-type');
        if (freightSelect) {
            const outShippingFee = parseFloat($('out_shipping') ? $('out_shipping').value : 0) || 0;
            if (outShippingFee > 0) freightSelect.value = '상차도';

            freightSelect.addEventListener('change', () => {
                newRow.dataset.freightManuallySet = 'true';
                const itemName = newRow.querySelector('.out-item').value.trim();
                const specName = newRow.querySelector('.out-spec').value.trim();
                this.autoFillPricesForRow(newRow, 'outbound', itemName, specName);
            });
        }
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            const specSel = newRow.querySelector('.out-spec');
            const qtyInput = newRow.querySelector('.out-qty');
            const unitInput = newRow.querySelector('.out-unit');
            const lotBtn = newRow.querySelector('.btn-lot');

            specSel.innerHTML = '<option value="">품목을 선택하세요</option>';
            specSel.disabled = true;
            qtyInput.disabled = true;
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();

            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/inventory/items`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `
                        <div class="autocomplete-suggestion d-flex align-items-center gap-1 text-nowrap" data-val="${this.escapeHtml(m)}">
                            <i class='bx bx-cube text-primary' style='font-size: 11.5px;'></i>
                            <span>${this.highlightMatch(m, val)}</span>
                        </div>
                    `).join('');
                    this.positionAutocomplete(input, sug);
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        const selectOutItem = (e) => {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                            const chosen = div.dataset.val || div.innerText.trim();
                            input.value = chosen;
                            sug.style.display = 'none';
                            this.loadOutboundSpecsForRow(rowId, chosen);
                        };
                        div.addEventListener('mousedown', selectOutItem);
                        div.addEventListener('click', selectOutItem);
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        input.addEventListener('blur', () => {
            setTimeout(() => { sug.style.display = 'none'; }, 150);
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input && !e.target.closest('.autocomplete-suggestions')) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
        this.setupCategoryAutocomplete();

        const priceInp = newRow.querySelector('.out-price');
        priceInp.addEventListener('input', () => this.updateOutboundGridTotals());

        // ERP 그리드 키보드 이동 및 엑셀 붙여넣기 바인딩
        this.bindGridKeyboardAndPaste(newRow, 'outbound');

        this.updateOutboundGridTotals();

        if (autoFocus && input) {
            setTimeout(() => {
                input.focus();
                if (input.select) input.select();
            }, 10);
        }

        return rowId;
    },

    removeOutboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
        delete this.outboundRows[rowId];
        this.validateAllOutboundLots();
        this.updateOutboundGridTotals();
    },

    removeLastOutboundRow: function() {
        const container = $('outboundItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.outbound-item-row');
        if (rows.length > 1) {
            const lastRow = rows[rows.length - 1];
            this.removeOutboundItemRow(lastRow.id);
        }
    },

    updateOutboundGridTotals: function() {
        const container = $('outboundItemsContainer');
        if (!container) return;
        const rows = container.querySelectorAll('.outbound-item-row');
        let totalQty = 0;
        let totalSupply = 0;
        let totalVat = 0;

        rows.forEach((r, idx) => {
            const indexEl = r.querySelector('.row-index');
            if (indexEl) indexEl.innerText = idx + 1;

            const q = parseFloat(r.querySelector('.out-qty')?.value) || 0;
            const p = parseFloat(r.querySelector('.out-price')?.value) || 0;
            const s = Math.round(q * p);
            const v = Math.round(s * 0.1);

            const supplyEl = r.querySelector('.out-supply');
            const vatEl = r.querySelector('.out-vat');
            if (supplyEl) supplyEl.value = s ? s.toLocaleString() + '원' : '';
            if (vatEl) vatEl.value = v ? v.toLocaleString() + '원' : '';

            totalQty += q;
            totalSupply += s;
            totalVat += v;
        });

        const shipping = parseFloat($('out_shipping')?.value) || 0;
        const shippingVat = $('out_shipping_vat')?.checked ? 0 : Math.round(shipping * 0.1);
        const grandTotal = totalSupply + totalVat + shipping + shippingVat;

        rows.forEach(r => {
            if (!r.dataset.freightManuallySet) {
                const sel = r.querySelector('.out-freight-type');
                if (sel) sel.value = shipping > 0 ? '상차도' : '하차도';
            }
        });

        if ($('out_total_qty')) $('out_total_qty').innerText = totalQty ? totalQty.toLocaleString() : '0';
        if ($('out_total_supply')) $('out_total_supply').innerText = totalSupply.toLocaleString() + '원';
        if ($('out_total_vat')) $('out_total_vat').innerText = totalVat.toLocaleString() + '원';
        if ($('out_summary_supply')) $('out_summary_supply').innerText = totalSupply.toLocaleString() + '원';
        if ($('out_summary_vat')) $('out_summary_vat').innerText = totalVat.toLocaleString() + '원';
        if ($('out_grand_total')) $('out_grand_total').innerText = grandTotal.toLocaleString();
        if ($('out_row_count')) $('out_row_count').innerText = rows.length + '건';
    },

    loadOutboundSpecsForRow: async function(rowId, itemName) {
        try {
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(itemName)}`);
            const specMap = {};
            lots.forEach(l => {
                if (!specMap[l.spec]) specMap[l.spec] = { unit: l.unit, total: 0, lots: [] };
                specMap[l.spec].total += l.qty_remaining;
                specMap[l.spec].lots.push(l);
            });

            const row = $(rowId);
            const sel = row.querySelector('.out-spec');
            sel.innerHTML = '<option value="">규격을 선택하세요</option>';
            
            for (const [spec, data] of Object.entries(specMap)) {
                sel.innerHTML += `<option value="${spec}" data-lots='${JSON.stringify(data.lots)}' data-unit="${data.unit}">[잔여 ${data.total}${data.unit}] ${spec}</option>`;
            }
            sel.disabled = false;
        } catch (e) {
            console.error(e);
            alert('규격을 불러오는데 실패했습니다.');
        }
    },

    handleOutboundSpecChange: function(rowId, selectEl) {
        const selectedOpt = selectEl.options[selectEl.selectedIndex];
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        const unitInput = row.querySelector('.out-unit');
        const lotBtn = row.querySelector('.btn-lot');

        if (!selectEl.value || !selectedOpt) {
            qtyInput.disabled = true;
            qtyInput.value = '';
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();
            return;
        }
        
        const unit = selectedOpt.getAttribute('data-unit') || '';
        let lots = [];
        try {
            lots = JSON.parse(selectedOpt.getAttribute('data-lots') || '[]');
        } catch (e) {
            console.error('Failed to parse lots:', e);
        }
        
        unitInput.value = unit;
        qtyInput.disabled = false;
        qtyInput.value = '';
        lotBtn.disabled = false;
        
        this.outboundRows[rowId].availableLots = lots;
        this.outboundRows[rowId].consumedLots = [];
        this.validateAllOutboundLots();

        const itemInput = row.querySelector('.out-item');
        const itemName = itemInput ? itemInput.value.trim() : '';
        if (itemName && selectEl.value) {
            this.autoFillPricesForRow(row, 'outbound', itemName, selectEl.value);
        }
    },

    handleOutboundQtyChange: function(rowId) {
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        let totalOutQty = parseFloat(qtyInput.value) || 0;
        
        const rData = this.outboundRows[rowId];
        rData.consumedLots = []; // reset

        // FIFO Auto distribute
        rData.availableLots.forEach((lot) => {
            if (totalOutQty <= 0) return;
            let take = 0;
            if (totalOutQty >= lot.qty_remaining) {
                take = lot.qty_remaining;
                totalOutQty -= lot.qty_remaining;
            } else {
                take = totalOutQty;
                totalOutQty = 0;
            }
            if (take > 0) {
                rData.consumedLots.push({ inbound_id: lot.id, consumed_qty: take });
            }
        });
        
        this.validateAllOutboundLots();
        this.updateOutboundGridTotals();
    },

    openLotModal: function(rowId) {
        this.currentLotModalRowId = rowId;
        const row = $(rowId);
        const itemName = row.querySelector('.out-item').value;
        const specName = row.querySelector('.out-spec').value;
        const targetQty = parseFloat(row.querySelector('.out-qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.outboundRows[rowId];
        
        // Render table
        const tbody = $('lotModalTbody');
        if (!rData.availableLots || rData.availableLots.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><i class='bx bx-info-circle me-1'></i>현재 가용한 입고 Lot가 없습니다.</td></tr>`;
        } else {
            tbody.innerHTML = rData.availableLots.map(lot => {
                const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
                const val = consumed ? consumed.consumed_qty : 0;
                return `
                <tr>
                    <td>${lot.date || '-'}</td>
                    <td>${lot.location_name || '-'}</td>
                    <td>${lot.supplier || '-'}</td>
                    <td>${(lot.unit_price || 0).toLocaleString()}원</td>
                    <td><strong>${lot.qty_remaining}</strong></td>
                    <td>
                        <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                               data-id="${lot.id}"
                               min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                               onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                    </td>
                </tr>
                `;
            }).join('');
        }
        
        this.validateLotModalSum();
        const modalEl = $('lotModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        
        // lotModal이 다른 모달(editOutboundModal 등) 위에 뜰 때 배경(backdrop) z-index 보정
        modalEl.addEventListener('shown.bs.modal', function () {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            if (backdrops.length > 1) {
                // 마지막(가장 위에 있는) backdrop의 z-index를 조정
                backdrops[backdrops.length - 1].style.zIndex = '1069';
            }
        }, { once: true });
        
        modal.show();
    },

    validateLotModalSum: function() {
        let sum = 0;
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            sum += parseFloat(inp.value) || 0;
        });
        $('lotModalCurQty').innerText = sum;
        
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        const err = $('lotModalErrorMsg');
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (isMatch || targetQty === 0) {
            err.style.display = 'none';
        } else {
            err.style.display = 'block';
        }
    },

    saveLotModal: function() {
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        let sum = 0;
        const tempConsumed = [];
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            const val = parseFloat(inp.value) || 0;
            sum += val;
            if (val > 0) {
                tempConsumed.push({ inbound_id: parseInt(inp.getAttribute('data-id')), consumed_qty: val });
            }
        });
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (!isMatch && targetQty > 0) {
            alert('차감량 합계가 총 출고 수량과 일치하지 않습니다.');
            return;
        }
        
        if (this.currentLotModalRowId === 'editOutbound') {
            this.editOutboundState.consumedLots = tempConsumed;
            $('editOutboundErrorMsg').style.display = 'none';
        } else {
            this.outboundRows[this.currentLotModalRowId].consumedLots = tempConsumed;
            this.validateAllOutboundLots();
        }
        
        const modal = bootstrap.Modal.getInstance($('lotModal'));
        modal.hide();
    },

    validateAllOutboundLots: function() {
        const rows = $('outboundItemsContainer').querySelectorAll('.outbound-item-row');
        let allValid = true;
        let hasItems = false;
        
        rows.forEach(row => {
            const rowId = row.id;
            const item = row.querySelector('.out-item')?.value.trim();
            const qty = parseFloat(row.querySelector('.out-qty')?.value) || 0;
            const rData = this.outboundRows[rowId];
            
            // 빈 행(품목과 수량 모두 미입력)은 유효성 검사 건너뜀
            if (!item && qty === 0) {
                return;
            }
            
            if (qty > 0 && rData) {
                hasItems = true;
                let sum = 0;
                rData.consumedLots.forEach(c => sum += c.consumed_qty);
                const isMatch = Math.abs(sum - qty) < 0.0001;
                
                const btn = row.querySelector('.btn-lot');
                if (isMatch) {
                    btn.classList.remove('btn-outline-danger', 'btn-danger');
                    btn.classList.add('btn-outline-primary');
                    btn.innerHTML = 'Lot 확인됨 <i class="bx bx-check"></i>';
                } else {
                    btn.classList.remove('btn-outline-primary', 'btn-success');
                    btn.classList.add('btn-outline-danger');
                    btn.innerHTML = 'Lot 재설정 필요 <i class="bx bx-error"></i>';
                    allValid = false;
                }
            } else if (qty <= 0) {
                allValid = false;
            }
        });
        
        if (rows.length === 0) allValid = false;

        const btnSubmit = $('btnOutboundSubmit');
        const errMsg = $('outErrorMsg');
        
        if (allValid && hasItems) {
            btnSubmit.disabled = false;
            if (errMsg) errMsg.style.display = 'none';
        } else {
            btnSubmit.disabled = true;
            if (errMsg) {
                if (hasItems) errMsg.style.display = 'block';
                else errMsg.style.display = 'none';
            }
        }
    },

    handleOutboundSubmit: async function(e) {
        e.preventDefault();
        const rows = $('outboundItemsContainer').querySelectorAll('.outbound-item-row');
        if (rows.length === 0) return alert('출고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        const docShippingFee = parseFloat($('out_shipping').value) || 0;
        const docNote = $('out_note').value.trim();

        rows.forEach((row, idx) => {
            const rowId = row.id;
            const item = row.querySelector('.out-item').value.trim();
            const spec = row.querySelector('.out-spec').value.trim();
            const unit = row.querySelector('.out-unit').value.trim();
            const qtyStr = row.querySelector('.out-qty').value.trim();
            const priceStr = row.querySelector('.out-price').value.trim();
            const qty = parseFloat(qtyStr);
            const selling_price = parseFloat(priceStr);
            const category = row.querySelector('.out-category') ? row.querySelector('.out-category').value.trim() : '';
            const shipping_fee = idx === 0 ? docShippingFee : 0;
            const shipping_fee_vat_included = idx === 0 ? ($('out_shipping_vat').checked ? 1 : 0) : 0;
            const rowNote = row.querySelector('.out-note') ? row.querySelector('.out-note').value.trim() : '';
            const note = rowNote || docNote;
            const trade_type = $('out_trade_type') ? $('out_trade_type').value : '내수';
            const consumed_lots = this.outboundRows[rowId] ? this.outboundRows[rowId].consumedLots : [];
            const freight_type = row.querySelector('.out-freight-type') ? row.querySelector('.out-freight-type').value : (docShippingFee > 0 ? '상차도' : '하차도');

            // 완전히 빈 행은 무시
            if (!item && !spec && !qtyStr && !priceStr && !rowNote) {
                return;
            }

            if (!item || !spec || isNaN(qty) || isNaN(selling_price)) {
                hasError = true;
            } else {
                items.push({ 
                    id: row.dataset.dbId, item, spec, unit, qty, selling_price, 
                    shipping_fee, shipping_fee_vat_included, note, consumed_lots, trade_type, category,
                    freight_type, freight_region: $('out_actual_destination') ? $('out_actual_destination').value.trim() : ''
                });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');
        if (items.length === 0) return alert('입력된 품목이 없습니다. 최소 1개 이상의 품목을 입력해주세요.');

        const payload = {
            date: $('out_date').value,
            destination: $('out_destination').value,
            actual_destination: $('out_actual_destination') ? $('out_actual_destination').value.trim() : '',
            items: items
        };

        const mode = $('outboundForm').dataset.mode;
        const txId = $('outboundForm').dataset.txId;
        const confirmMsg = mode === 'edit' ? `총 ${items.length}건의 품목으로 출고 내역을 수정하시겠습니까?` : `총 ${items.length}건의 품목을 출고하시겠습니까?`;
        if (confirm(confirmMsg)) {
            try {
                if (mode === 'edit') {
                    await authFetch(`${API_BASE}/outbound/tx/${txId}`, { method: 'PUT', body: JSON.stringify(payload) });
                    $('outboundForm').dataset.mode = '';
                    $('outboundForm').dataset.txId = '';
                } else {
                    await authFetch(`${API_BASE}/outbound`, { method: 'POST', body: JSON.stringify(payload) });
                }
                alert(mode === 'edit' ? '출고 전표가 성공적으로 수정되었습니다.' : '출고 완료되었습니다.');
                this.resetOutboundModalForm();
                this.loadUnitPricesMap(true);
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('출고 실패: ' + err.message);
            }
        }
    },
    
    // ==========================================
    // Drawer & Detail & Print Logic
    // ==========================================
    openExcelMenuModal: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    closeExcelMenuAndOpenDirect: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        setTimeout(() => app.openDirectExcelModal(), 300);
    },

    downloadExcelTemplate: async function() {
        try {
            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(API_BASE + '/direct/template', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error || 'HTTP error ' + res.status);
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = '직출고_엑셀일괄등록_양식.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            alert('템플릿 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    },

    openDirectExcelModal: function() {
        const modalEl = document.getElementById('directExcelModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        if ($('directExcelFile')) $('directExcelFile').value = '';
        app.selectedTargetYear = null;
        app.cachedDirectExcelFile = null;
        modal.show();
    },

    uploadDirectExcel: async function(targetYearOverride) {
        const fileInput = $('directExcelFile');
        const file = (fileInput && fileInput.files && fileInput.files[0]) || app.cachedDirectExcelFile;
        if (!file) {
            alert('업로드할 엑셀 파일을 선택해주세요.');
            return;
        }
        
        const effectiveYear = targetYearOverride || app.selectedTargetYear || '';
        const formData = new FormData();
        formData.append('file', file);
        if (effectiveYear) {
            formData.append('target_year', effectiveYear);
        }
        
        const btn = document.querySelector('#directExcelModal .btn-warning');
        try {
            // Show loading state
            if (btn) {
                btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> 데이터 분석 및 검증 중...';
                btn.disabled = true;
            }

            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(`${API_BASE}/direct/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();

                // 1. 연도 누락 확인 모달 띄우기
                if (data.needsYear) {
                    app.cachedDirectExcelFile = file;

                    // 감지된 날짜 샘플 표시
                    const samplesEl = $('directYearSamples');
                    if (samplesEl) {
                        const sampleList = data.sampleDates || [];
                        samplesEl.innerText = sampleList.length > 0 ? sampleList.join(', ') : '월-일 형식 감지됨';
                    }

                    // 기본 연도 지정
                    const yearInput = $('directTargetYearInput');
                    if (yearInput) {
                        yearInput.value = data.defaultYear || new Date().getFullYear();
                    }

                    // 직출고 업로드 모달 숨기기
                    const excelModalEl = document.getElementById('directExcelModal');
                    const excelModal = bootstrap.Modal.getInstance(excelModalEl);
                    if (excelModal) excelModal.hide();

                    // 연도 확인 모달 띄우기
                    const yearModalEl = document.getElementById('directYearModal');
                    let yearModal = bootstrap.Modal.getInstance(yearModalEl);
                    if (!yearModal) yearModal = new bootstrap.Modal(yearModalEl);
                    yearModal.show();
                    return;
                }

                // 2. 중복 의심 건 발견 시 -> 스마트 중복 처리 모달 띄우기
                if (data.hasDuplicates) {
                    app.cachedDirectExcelFile = file;

                    // 1. 매입처별 중복 건수 배지 렌더링
                    const badgesContainer = $('dupSupplierBadges');
                    if (badgesContainer) {
                        badgesContainer.innerHTML = '';
                        if (data.supplierCounts && Object.keys(data.supplierCounts).length > 0) {
                            for (const [sup, count] of Object.entries(data.supplierCounts)) {
                                const badge = document.createElement('span');
                                badge.className = 'badge bg-white text-dark border shadow-sm px-3 py-2 fs-7';
                                badge.innerHTML = `<span class="fw-normal text-muted">${sup}:</span> <strong class="text-danger ms-1">${count.toLocaleString()}건</strong>`;
                                badgesContainer.appendChild(badge);
                            }
                        } else {
                            badgesContainer.innerHTML = '<span class="text-muted small">집계 내역 없음</span>';
                        }
                    }

                    // 2. 건수 요약 표시
                    if ($('dupTotalCount')) $('dupTotalCount').innerText = (data.totalCount || 0).toLocaleString();
                    if ($('dupCount')) $('dupCount').innerText = (data.duplicateCount || 0).toLocaleString();
                    if ($('dupNewCount')) $('dupNewCount').innerText = (data.newCount || 0).toLocaleString();

                    // 3. 중복 상세 테이블 렌더링
                    const tbody = $('dupTableBody');
                    if (tbody) {
                        tbody.innerHTML = '';
                        (data.duplicates || []).forEach(r => {
                            const tr = document.createElement('tr');
                            tr.className = 'text-nowrap';
                            tr.innerHTML = `
                                <td><span class="badge bg-secondary text-white">${r.rowNumber}행</span></td>
                                <td>${r.date || ''}</td>
                                <td class="text-start">${r.supplier || ''}</td>
                                <td class="text-start">${r.destination || ''}</td>
                                <td class="text-start fw-bold">${r.item || ''}</td>
                                <td>${r.spec || '-'}</td>
                                <td class="text-end">${Number(r.qty || 0).toLocaleString()}</td>
                                <td class="text-end">${Number(r.in_price || 0).toLocaleString()}원</td>
                                <td class="text-end">${Number(r.out_price || 0).toLocaleString()}원</td>
                            `;
                            tbody.appendChild(tr);
                        });
                    }

                    // 4. 모달 전환
                    const excelModalEl = document.getElementById('directExcelModal');
                    const excelModal = bootstrap.Modal.getInstance(excelModalEl);
                    if (excelModal) excelModal.hide();

                    const dupModal = new bootstrap.Modal(document.getElementById('directDuplicateModal'));
                    dupModal.show();
                    return;
                }

                let msg = `총 ${data.count}건의 엑셀 데이터가 성공적으로 일괄 등록되었습니다.`;
                if (data.skippedCount) {
                    msg += `\n(중복 제외: ${data.skippedCount}건)`;
                }
                alert(msg);
                
                const modalEl = document.getElementById('directExcelModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();

                app.selectedTargetYear = null;
                app.cachedDirectExcelFile = null;
                if ($('directExcelFile')) $('directExcelFile').value = '';
                
                app.resetPageAndLoadHistory();
            } else {
                let errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    errText = errJson.error || errJson.details || errText;
                } catch(e) {}
                alert(`업로드 실패:\n${errText}`);
            }
        } catch (err) {
            alert(`업로드 중 오류 발생: ${err.message}`);
        } finally {
            // Reset loading state
            if (btn) {
                btn.innerHTML = "<i class='bx bx-upload'></i> 업로드 및 일괄 등록";
                btn.disabled = false;
            }
        }
    },

    proceedDirectWithYear: function() {
        const yearInput = $('directTargetYearInput');
        const yearVal = yearInput ? yearInput.value.trim() : '';
        if (!yearVal || !/^\d{4}$/.test(yearVal)) {
            alert('올바른 4자리 연도를 입력해주세요. (예: 2026)');
            if (yearInput) yearInput.focus();
            return;
        }

        app.selectedTargetYear = yearVal;

        const yearModalEl = document.getElementById('directYearModal');
        const yearModal = bootstrap.Modal.getInstance(yearModalEl);
        if (yearModal) yearModal.hide();

        const excelModalEl = document.getElementById('directExcelModal');
        let excelModal = bootstrap.Modal.getInstance(excelModalEl);
        if (!excelModal) excelModal = new bootstrap.Modal(excelModalEl);
        excelModal.show();

        setTimeout(() => {
            app.uploadDirectExcel(yearVal);
        }, 300);
    },

    proceedDirectDuplicate: async function(action) {
        const file = app.cachedDirectExcelFile || ($('directExcelFile') && $('directExcelFile').files[0]);
        if (!file) {
            alert('업로드할 파일 정보가 없습니다. 파일을 다시 선택해주세요.');
            return;
        }

        const confirmText = action === 'skip_duplicates' 
            ? '중복된 항목을 제외하고 신규 건만 등록하시겠습니까?'
            : '중복 의심 항목을 포함하여 엑셀 전체를 등록하시겠습니까?';
        
        if (!confirm(confirmText)) return;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('duplicate_action', action);
        if (app.selectedTargetYear) {
            formData.append('target_year', app.selectedTargetYear);
        }

        const dupModalEl = document.getElementById('directDuplicateModal');
        const footerBtns = dupModalEl ? dupModalEl.querySelectorAll('button') : [];
        footerBtns.forEach(b => b.disabled = true);

        try {
            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(`${API_BASE}/direct/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                let msg = '성공적으로 등록되었습니다.';
                if (data.count !== undefined) {
                    msg = `총 ${data.count}건이 성공적으로 등록되었습니다.`;
                }
                if (data.skippedCount) {
                    msg += `\n(중복 제외 건너뜀: ${data.skippedCount}건)`;
                }
                alert(msg);

                const dupModal = bootstrap.Modal.getInstance(dupModalEl);
                if (dupModal) dupModal.hide();

                const excelModalEl = document.getElementById('directExcelModal');
                const excelModal = bootstrap.Modal.getInstance(excelModalEl);
                if (excelModal) excelModal.hide();

                if ($('directExcelFile')) $('directExcelFile').value = '';
                app.cachedDirectExcelFile = null;
                app.selectedTargetYear = null;

                app.resetPageAndLoadHistory();
            } else {
                let errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    errText = errJson.error || errJson.details || errText;
                } catch(e) {}
                alert(`등록 실패:\n${errText}`);
            }
        } catch (err) {
            alert(`등록 처리 중 오류 발생: ${err.message}`);
        } finally {
            footerBtns.forEach(b => b.disabled = false);
        }
    },

    resetInboundModalForm: function() {
        const form = $('inboundForm');
        if (form) {
            form.reset();
            form.dataset.mode = '';
            form.dataset.txId = '';
        }
        const container = $('inboundItemsContainer');
        if (container) {
            container.innerHTML = '';
        }
        for (let i = 0; i < 1; i++) {
            this.addInboundItemRow(i === 0);
        }
        this.initTodayDates();
        const title = document.querySelector('#inboundModal .erp-window-title, #inboundModal .modal-title');
        if (title) title.innerHTML = "입고 전표 등록";
        const badge = document.querySelector('#inboundModalBadge, #inboundModal .modal-header .badge');
        if (badge) {
            badge.className = 'badge bg-secondary-subtle text-light border border-secondary ms-1';
            badge.textContent = '신규전표';
        }
        const submitBtn = document.querySelector('#inboundForm button[type=\"submit\"]');
        if (submitBtn) submitBtn.textContent = "입고 처리";
        if ($('in_trade_type')) $('in_trade_type').value = '내수';
    },

    resetOutboundModalForm: function() {
        const form = $('outboundForm');
        if (form) {
            form.reset();
            form.dataset.mode = '';
            form.dataset.txId = '';
        }
        const container = $('outboundItemsContainer');
        if (container) {
            container.innerHTML = '';
        }
        this.outboundRows = {};
        this.currentLotModalRowId = null;
        for (let i = 0; i < 1; i++) {
            this.addOutboundItemRow(i === 0);
        }
        this.initTodayDates();
        if ($('btnOutboundSubmit')) $('btnOutboundSubmit').disabled = true;
        if ($('outErrorMsg')) $('outErrorMsg').style.display = 'none';
        const title = document.querySelector('#outboundModal .erp-window-title, #outboundModal .modal-title');
        if (title) title.innerHTML = "출고 전표 등록";
        const badge = document.querySelector('#outboundModalBadge, #outboundModal .modal-header .badge');
        if (badge) {
            badge.className = 'badge bg-secondary-subtle text-light border border-secondary ms-1';
            badge.textContent = '신규전표';
        }
        const submitBtn = document.querySelector('#outboundForm button[type=\"submit\"]');
        if (submitBtn) submitBtn.textContent = "출고 처리";
        if ($('out_shipping')) $('out_shipping').value = 0;
        if ($('out_shipping_vat')) $('out_shipping_vat').checked = false;
        if ($('out_trade_type')) $('out_trade_type').value = '내수';
    },

    resetDirectModalForm: function() {
        const form = $('directForm');
        if (form) {
            form.reset();
            form.dataset.mode = '';
            form.dataset.txId = '';
        }
        const container = $('directItemsContainer');
        if (container) {
            container.innerHTML = '';
        }
        for (let i = 0; i < 1; i++) {
            this.addDirectItemRow(i === 0);
        }
        this.initTodayDates();
        const title = document.querySelector('#directModal .erp-window-title, #directModal .modal-title');
        if (title) title.innerHTML = "직출고 전표 등록";
        const badge = document.querySelector('#directModalBadge, #directModal .modal-header .badge');
        if (badge) {
            badge.className = 'badge bg-secondary-subtle text-light border border-secondary ms-1';
            badge.textContent = '입출고 동시';
        }
        const submitBtn = document.querySelector('#directForm button[type=\"submit\"]');
        if (submitBtn) submitBtn.textContent = "직출고 동시 처리";
        if ($('dir_in_shipping')) $('dir_in_shipping').value = 0;
        if ($('dir_in_shipping_vat')) $('dir_in_shipping_vat').checked = false;
        if ($('dir_out_shipping')) $('dir_out_shipping').value = 0;
        if ($('dir_out_shipping_vat')) $('dir_out_shipping_vat').checked = false;
        if ($('dir_trade_type')) $('dir_trade_type').value = '내수';
    },

    openDrawer: function(mode, data = null) {
        if (mode === 'inbound_create' || mode === 'direct_create') {
            this.loadItemSpecsMap();
        }
        if (mode === 'inbound_create') {
            const modalEl = document.getElementById('inboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            if ($('inboundForm').dataset.mode !== 'edit') {
                this.resetInboundModalForm();
            } else {
                const title = document.querySelector('#inboundModal .erp-window-title, #inboundModal .modal-title');
                if (title) title.textContent = "입고 전표 수정";
                const submitBtn = document.querySelector('#inboundForm button[type="submit"]');
                if (submitBtn) submitBtn.textContent = "입고 수정";
                const badge = document.querySelector('#inboundModalBadge, #inboundModal .modal-header .badge');
                if (badge) {
                    badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                    badge.textContent = '전표 수정';
                }
            }
            modal.show();
        } else if (mode === 'outbound_create') {
            const modalEl = document.getElementById('outboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            if ($('outboundForm').dataset.mode !== 'edit') {
                this.resetOutboundModalForm();
            } else {
                const title = document.querySelector('#outboundModal .erp-window-title, #outboundModal .modal-title');
                if (title) title.textContent = "출고 전표 수정";
                const submitBtn = document.querySelector('#outboundForm button[type="submit"]');
                if (submitBtn) submitBtn.textContent = "출고 수정";
                const badge = document.querySelector('#outboundModalBadge, #outboundModal .modal-header .badge');
                if (badge) {
                    badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                    badge.textContent = '전표 수정';
                }
            }
            modal.show();
        } else if (mode === 'direct_create') {
            const modalEl = document.getElementById('directModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            if ($('directForm').dataset.mode !== 'edit') {
                this.resetDirectModalForm();
            } else {
                const title = document.querySelector('#directModal .erp-window-title, #directModal .modal-title');
                if (title) title.textContent = "직출고 전표 수정";
                const submitBtn = document.querySelector('#directForm button[type="submit"]');
                if (submitBtn) submitBtn.textContent = "직출고 수정";
                const badge = document.querySelector('#directModalBadge, #directModal .modal-header .badge');
                if (badge) {
                    badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                    badge.textContent = '전표 수정';
                }
            }
            modal.show();
            if ($('directItemsContainer').children.length === 0) {
                for (let i = 0; i < 1; i++) {
                    this.addDirectItemRow(i === 0);
                }
            }
        } else if (mode === 'detail') {
            const typeStr = data.type === 'inbound' ? '입고' : '출고';
            $('detailModalTitle').innerHTML = `<i class='bx bx-file'></i> ${typeStr} 상세 내역`;
            const modalEl = document.getElementById('detailModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            this.renderDrawerDetail(data.id, data.type);
        }
    },
    
    
    openEditInboundTx: async function(txId, singleId = null) {
        try {
            let items = null;
            if (txId && txId !== 'null' && txId !== 'undefined') {
                try {
                    items = await authFetch(`${API_BASE}/history/inbound/tx/${encodeURIComponent(txId)}`);
                } catch(e) { console.warn('TX fetch error, trying single fallback', e); }
            }
            if ((!items || items.length === 0) && singleId) {
                const single = await authFetch(`${API_BASE}/history/inbound/${singleId}`);
                if (single) items = single.items || [single];
            }
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            $('inboundForm').dataset.mode = 'edit';
            $('inboundForm').dataset.txId = txId || (items[0] && items[0].transaction_group_id) || '';
            $('inboundItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('in_date').value = first.date ? first.date.split('T')[0] : '';
            $('in_supplier').value = first.supplier || '';
            $('in_location').value = first.location_id || '';
            $('in_note').value = first.note || '';
            if ($('in_trade_type')) $('in_trade_type').value = first.trade_type || '내수';
            if ($('in_category')) $('in_category').value = first.category || '';

            const title = document.querySelector('#inboundModal .erp-window-title, #inboundModal .modal-title');
            if (title) title.innerHTML = "입고 전표 수정";
            const badge = document.querySelector('#inboundModalBadge, #inboundModal .modal-header .badge');
            if (badge) {
                badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                badge.textContent = '전표 수정';
            }
            const submitBtn = document.querySelector('#inboundForm button[type="submit"]');
            if (submitBtn) submitBtn.textContent = "입고 수정";

            items.forEach(item => {
                const rowId = this.addInboundItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.in-item').value = item.item;
                newRow.querySelector('.in-spec').value = item.spec || '';
                newRow.querySelector('.in-unit').value = item.unit || '';
                newRow.querySelector('.in-qty').value = item.qty_initial;
                newRow.querySelector('.in-price').value = item.unit_price || 0;
                if (newRow.querySelector('.in-category')) newRow.querySelector('.in-category').value = item.category || '';
                if (newRow.querySelector('.in-freight-type')) {
                    newRow.querySelector('.in-freight-type').value = item.freight_type || '상차도';
                    newRow.dataset.freightManuallySet = 'true';
                }
                
                const consumed = item.qty_initial - item.qty_remaining;
                if (consumed > 0) {
                    newRow.querySelector('.in-qty').min = consumed;
                    const delBtn = newRow.querySelector('.btn-outline-danger');
                    if(delBtn) delBtn.disabled = true;
                }
            });
            this.updateInboundGridTotals();
            this.openDrawer('inbound_create');
        } catch(err) { alert(err.message); }
    },

    openEditOutboundTx: async function(txId, singleId = null) {
        try {
            let items = null;
            if (txId && txId !== 'null' && txId !== 'undefined') {
                try {
                    items = await authFetch(`${API_BASE}/history/outbound/tx/${encodeURIComponent(txId)}`);
                } catch(e) { console.warn('TX fetch error, trying single fallback', e); }
            }
            if ((!items || items.length === 0) && singleId) {
                const single = await authFetch(`${API_BASE}/history/outbound/${singleId}`);
                if (single) items = single.items || [single];
            }
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            $('outboundForm').dataset.mode = 'edit';
            $('outboundForm').dataset.txId = txId || (items[0] && items[0].transaction_group_id) || '';
            $('outboundItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('out_date').value = first.date ? first.date.split('T')[0] : '';
            $('out_destination').value = first.destination || '';
            $('out_actual_destination').value = first.actual_destination || '';
            $('out_note').value = first.note || '';
            if ($('out_trade_type')) $('out_trade_type').value = first.trade_type || '내수';
            if ($('out_shipping')) $('out_shipping').value = first.shipping_fee || 0;
            if ($('out_shipping_vat')) $('out_shipping_vat').checked = first.shipping_fee_vat_included === 1;

            const title = document.querySelector('#outboundModal .erp-window-title, #outboundModal .modal-title');
            if (title) title.innerHTML = "출고 전표 수정";
            const badge = document.querySelector('#outboundModalBadge, #outboundModal .modal-header .badge');
            if (badge) {
                badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                badge.textContent = '전표 수정';
            }
            const submitBtn = document.querySelector('#outboundForm button[type="submit"]');
            if (submitBtn) submitBtn.textContent = "출고 수정";

            for (let item of items) {
                const rowId = this.addOutboundItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.out-item').value = item.item;
                
                // 해당 품목의 백엔드 재고 Lot 정보 조회
                let lots = [];
                try {
                    lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(item.item)}`);
                } catch(e) {
                    console.error('Failed to fetch inventory for item:', item.item, e);
                }

                // 기존 할당된 consumed_lots
                const consumedLots = (item.consumed_lots || []).map(l => ({
                    inbound_id: parseInt(l.inbound_id, 10),
                    consumed_qty: parseFloat(l.consumed_qty) || 0
                }));

                // 자기 자신이 이미 차감했던 양을 복원하여 가용 수량 계산
                const specMap = {};
                (lots || []).forEach(l => {
                    const cloneLot = { ...l };
                    const consumed = consumedLots.find(c => c.inbound_id === cloneLot.id);
                    if (consumed) {
                        cloneLot.qty_remaining += consumed.consumed_qty;
                    }
                    if (!specMap[cloneLot.spec]) {
                        specMap[cloneLot.spec] = { unit: cloneLot.unit, total: 0, lots: [] };
                    }
                    specMap[cloneLot.spec].total += cloneLot.qty_remaining;
                    specMap[cloneLot.spec].lots.push(cloneLot);
                });

                const specSel = newRow.querySelector('.out-spec');
                specSel.innerHTML = '<option value="">규격을 선택하세요</option>';
                for (const [spec, data] of Object.entries(specMap)) {
                    const isSel = spec === item.spec ? 'selected' : '';
                    specSel.innerHTML += `<option value="${spec}" data-lots='${JSON.stringify(data.lots)}' data-unit="${data.unit}" ${isSel}>[잔여 ${data.total}${data.unit}] ${spec}</option>`;
                }
                if (!specMap[item.spec]) {
                    specSel.innerHTML += `<option value="${item.spec || ''}" selected>${item.spec || '규격 없음'}</option>`;
                }
                specSel.disabled = false;

                newRow.querySelector('.out-unit').value = item.unit || '';
                const qtyInput = newRow.querySelector('.out-qty');
                qtyInput.value = item.qty;
                qtyInput.disabled = false;
                
                newRow.querySelector('.out-price').value = item.selling_price || 0;
                if (newRow.querySelector('.out-category')) newRow.querySelector('.out-category').value = item.category || '';
                if (newRow.querySelector('.out-freight-type')) {
                    newRow.querySelector('.out-freight-type').value = item.freight_type || '상차도';
                    newRow.dataset.freightManuallySet = 'true';
                }

                // 해당 규격에 매칭되는 Lot 목록 확보
                let specLots = [];
                if (specMap[item.spec]) {
                    specLots = specMap[item.spec].lots;
                } else if (lots && lots.length > 0) {
                    specLots = lots.filter(l => l.spec === item.spec);
                }

                // 기존 로트 매핑이 비어있던 레거시 출고 건(또는 미할당 건)의 경우 선입선출 자동 배정
                let finalConsumed = consumedLots.filter(c => c.consumed_qty > 0);
                if (finalConsumed.length === 0 && specLots.length > 0) {
                    let remQty = parseFloat(item.qty) || 0;
                    finalConsumed = [];
                    specLots.forEach(lot => {
                        if (remQty <= 0) return;
                        const take = Math.min(remQty, lot.qty_remaining);
                        if (take > 0) {
                            finalConsumed.push({ inbound_id: lot.id, consumed_qty: take });
                            remQty -= take;
                        }
                    });
                }

                this.outboundRows[rowId] = {
                    consumedLots: finalConsumed,
                    availableLots: specLots
                };

                const lotBtn = newRow.querySelector('.btn-lot');
                if (lotBtn) {
                    lotBtn.disabled = false;
                }
            }
            this.validateAllOutboundLots();
            this.updateOutboundGridTotals();
            this.openDrawer('outbound_create');
        } catch(err) { alert(err.message); }
    },

    openEditDirectOutboundTx: async function(txId, singleId = null) {
        try {
            let items = null;
            if (txId && txId !== 'null' && txId !== 'undefined') {
                try {
                    items = await authFetch(`${API_BASE}/history/direct/tx/${encodeURIComponent(txId)}`);
                } catch(e) { console.warn('TX fetch error, trying single fallback', e); }
            }
            if ((!items || items.length === 0) && singleId) {
                const single = await authFetch(`${API_BASE}/history/outbound/${singleId}`);
                if (single) items = single.items || [single];
            }
            if (!items || items.length === 0) return alert('데이터를 불러올 수 없습니다.');
            
            const normTxId = txId && txId.startsWith('IN-') ? txId.replace('IN-', 'OUT-') : (txId || (items[0] && items[0].transaction_group_id) || '');
            $('directForm').dataset.mode = 'edit';
            $('directForm').dataset.txId = normTxId || txId;
            $('directItemsContainer').innerHTML = '';
            
            const first = items[0];
            $('dir_date').value = first.date ? first.date.split('T')[0] : '';
            $('dir_supplier').value = first.supplier || '';
            $('dir_destination').value = first.destination || '';
            if ($('dir_actual_destination')) $('dir_actual_destination').value = first.actual_destination || '';
            if ($('dir_note')) $('dir_note').value = first.note || '';
            if ($('dir_trade_type')) $('dir_trade_type').value = first.trade_type || '내수';
            
            // 운반비 품목 감지 (하이브리드 지원: 신규 운반비 품목 행 vs 과거 헤더 배송비)
            const detectedFreightItem = items.find(i => (i.item || '').trim() === '운반비' || (i.item || '').trim() === '배송비');
            if (detectedFreightItem) {
                if ($('dir_in_shipping')) $('dir_in_shipping').value = detectedFreightItem.inbound_price !== undefined ? detectedFreightItem.inbound_price : (detectedFreightItem.unit_price || 0);
                if ($('dir_out_shipping')) $('dir_out_shipping').value = detectedFreightItem.selling_price !== undefined ? detectedFreightItem.selling_price : (detectedFreightItem.outbound_price || 0);
                if ($('dir_in_shipping_vat')) $('dir_in_shipping_vat').checked = false;
                if ($('dir_out_shipping_vat')) $('dir_out_shipping_vat').checked = false;
            } else {
                if ($('dir_in_shipping')) $('dir_in_shipping').value = first.in_shipping_fee || 0;
                if ($('dir_in_shipping_vat')) $('dir_in_shipping_vat').checked = first.in_shipping_vat === 1;
                if ($('dir_out_shipping')) $('dir_out_shipping').value = first.shipping_fee || 0;
                if ($('dir_out_shipping_vat')) $('dir_out_shipping_vat').checked = first.shipping_fee_vat_included === 1;
            }

            // 운반비 행은 품목 그리드에 중복 추가되지 않도록 제외하고 실제 제품 품목만 렌더링
            const productItems = items.filter(i => (i.item || '').trim() !== '운반비' && (i.item || '').trim() !== '배송비');

            productItems.forEach(item => {
                const rowId = this.addDirectItemRow();
                const newRow = $(rowId);
                newRow.dataset.dbId = item.id;
                newRow.querySelector('.dir-item').value = item.item || '';
                newRow.querySelector('.dir-spec').value = item.spec || '';
                newRow.querySelector('.dir-unit').value = item.unit || '';
                newRow.querySelector('.dir-qty').value = item.qty || 0;
                newRow.querySelector('.dir-in-price').value = item.inbound_price !== undefined ? item.inbound_price : (item.unit_price || 0);
                newRow.querySelector('.dir-out-price').value = item.selling_price !== undefined ? item.selling_price : (item.outbound_price || 0);
                if (newRow.querySelector('.dir-category')) newRow.querySelector('.dir-category').value = item.category || '';
                if (newRow.querySelector('.dir-freight-type')) {
                    newRow.querySelector('.dir-freight-type').value = item.freight_type || '하차도';
                    newRow.dataset.freightManuallySet = 'true';
                }
            });
            this.updateDirectGridTotals();

            const title = document.querySelector('#directModal .erp-window-title, #directModal .modal-title');
            if (title) title.innerHTML = "직출고 전표 수정";
            const badge = document.querySelector('#directModalBadge, #directModal .modal-header .badge');
            if (badge) {
                badge.className = 'badge bg-warning text-dark border border-warning ms-1';
                badge.textContent = '전표 수정';
            }
            const submitBtn = document.querySelector('#directForm button[type=\"submit\"]');
            if (submitBtn) submitBtn.textContent = "직출고 수정";

            this.openDrawer('direct_create');
        } catch(err) { alert(err.message); }
    },
    closeDrawer: function() {
        const modals = ['inboundModal', 'outboundModal', 'directModal', 'detailModal'];
        modals.forEach(id => {
            const modalEl = document.getElementById(id);
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
        });
        $('btnFilterAll').checked = true;
        this.resetPageAndLoadHistory();
    },

    renderDrawerDetail: async function(id, type) {
        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            this.currentHistoryDetail = data;
            
            const items = data.items || [data];
            
            let badgeHtml = type === 'inbound' ? '<span class="badge bg-success">입고</span>' : '<span class="badge bg-danger">출고</span>';
            if (type === 'outbound' && data.is_direct === 1) {
                badgeHtml = '<span class="badge bg-warning text-dark">직출고</span>';
            }
            
            const metaClass = type === 'inbound' ? 'inbound' : 'outbound';
            const extraLabel = type === 'inbound' ? '창고위치' : '배송비';
            const shipVatLabel = data.shipping_fee_vat_included === 1 ? '(부가세 포함)' : '(공급가 기준)';
            const extraValue = type === 'inbound' 
                ? (data.location_name || '-')
                : (data.shipping_fee ? data.shipping_fee.toLocaleString() + '원 ' + shipVatLabel : '-');
            
            let metaBarHtml = '';
            if (type === 'outbound' && data.is_direct === 1) {
                metaBarHtml = `
                <div class="drawer-meta-bar ${metaClass} flex-column align-items-start gap-2">
                    <div class="d-flex w-100 justify-content-between flex-wrap gap-2">
                        <div class="d-flex align-items-center gap-3 flex-wrap">
                            <div class="drawer-meta-item">${badgeHtml}</div>
                            <div class="drawer-meta-item">
                                <span class="drawer-meta-label"><i class='bx bx-calendar'></i> 일자</span>
                                <span class="drawer-meta-value">${data.date}</span>
                            </div>
                        </div>
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-info-circle'></i> ${extraLabel}</span>
                            <span class="drawer-meta-value">${extraValue}</span>
                        </div>
                    </div>
                    <hr class="w-100 my-1 border-secondary opacity-25">
                    <div class="d-flex w-100 flex-wrap gap-4">
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-buildings'></i> 매입처(공급)</span>
                            <span class="drawer-meta-value fw-bold text-dark">${data.supplier || '-'}</span>
                        </div>
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-store-alt'></i> 매출처(납품)</span>
                            <span class="drawer-meta-value fw-bold text-primary">${data.destination}</span>
                        </div>
                        ${data.actual_destination ? `
                        <div class="drawer-meta-item">
                            <span class="drawer-meta-label"><i class='bx bx-map'></i> 실출고처</span>
                            <span class="drawer-meta-value text-dark">${data.actual_destination}</span>
                        </div>
                        ` : ''}
                    </div>
                </div>
                `;
            } else {
                const partnerLabel = type === 'inbound' ? '매입처' : '출고처';
                const partnerValue = type === 'inbound' ? data.supplier : data.destination;
                const partnerHtml = `
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-buildings'></i> ${partnerLabel}</span>
                        <span class="drawer-meta-value">${partnerValue}</span>
                    </div>
                `;
                
                let actualDestHtml = '';
                if (type === 'outbound' && data.actual_destination) {
                    actualDestHtml = `
                        <div class="drawer-meta-item ms-3">
                            <span class="drawer-meta-label"><i class='bx bx-map'></i> 실출고처</span>
                            <span class="drawer-meta-value">${data.actual_destination}</span>
                        </div>
                    `;
                }

                metaBarHtml = `
                <div class="drawer-meta-bar ${metaClass}">
                    <div class="drawer-meta-item">
                        ${badgeHtml}
                    </div>
                    <div class="drawer-meta-item ms-2">
                        <span class="drawer-meta-label"><i class='bx bx-calendar'></i> 일자</span>
                        <span class="drawer-meta-value">${data.date}</span>
                    </div>
                    ${partnerHtml}
                    ${actualDestHtml}
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-info-circle'></i> ${extraLabel}</span>
                        <span class="drawer-meta-value">${extraValue}</span>
                    </div>
                </div>
                `;
            }

            let html = `
            <div class="w-100">
                ${metaBarHtml}
                ${data.note ? `<div class="mt-2 mb-3 px-3 py-2 bg-light rounded text-muted" style="font-size:0.85rem;"><i class='bx bx-message-square-detail'></i> <strong>비고:</strong> ${data.note}</div>` : ''}
                
                <table class="table table-bordered drawer-items-table align-middle mb-0">
                    <thead>
                        <tr>
                            <th class="text-center" style="width: 5%">#</th>
                            <th class="text-center" style="width: 35%">품명 / 규격</th>
                            <th class="text-center" style="width: 10%">단위</th>
                            <th class="text-center" style="width: 10%">수량</th>
                            <th class="text-center" style="width: 20%">단가</th>
                            <th class="text-center" style="width: 20%">총액</th>
                        </tr>
                    </thead>
                    <tbody>`;

            let totalQty = 0;
            let totalAmount = 0;

            items.forEach((item, idx) => {
                const itemQty = type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const itemPrice = type === 'inbound' ? item.unit_price : item.selling_price;
                const amount = itemQty * itemPrice;
                
                totalQty += itemQty;
                totalAmount += amount;
                
                html += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td><span class="fw-bold text-primary">${item.item}</span> <span class="text-secondary">/ ${item.spec}</span></td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-end fw-bold">${itemQty.toLocaleString()}</td>
                            <td class="text-end">${itemPrice.toLocaleString()}원</td>
                            <td class="text-end fw-bold text-danger">${amount.toLocaleString()}원</td>
                        </tr>`;
                
                if (type === 'outbound') {
                    let lotsHtml = '';
                    if (item.consumed_lots && item.consumed_lots.length > 0) {
                        lotsHtml = item.consumed_lots.map(l => 
                            `<span class="badge bg-white text-dark border me-1" style="font-weight:normal; font-size:0.7rem;">${l.inbound_date} 입고 (${l.supplier}) <span class="text-danger fw-bold ms-1">-${l.consumed_qty}</span></span>`
                        ).join('');
                        html += `
                        <tr class="sub-row">
                            <td></td>
                            <td colspan="5"><i class='bx bx-layer'></i> 차감: ${lotsHtml}</td>
                        </tr>`;
                    }
                }
            });
            
            if (items.length > 1) {
                html += `
                        <tr class="total-row">
                            <td colspan="3" class="text-center">합계</td>
                            <td class="text-end text-primary">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end text-danger">${totalAmount.toLocaleString()}원</td>
                        </tr>`;
            }
            
            html += `
                    </tbody>
                </table>
            </div>`;
                
            if (type === 'inbound') {
                $('printOptInbound').classList.remove('d-none');
                $('printOptInboundLabel').classList.remove('d-none');
                $('printOptInbound').checked = true;
                $('printOptOutbound').classList.add('d-none');
                $('printOptOutboundLabel').classList.add('d-none');
                $('printOptTrans').classList.add('d-none');
                $('printOptTransLabel').classList.add('d-none');
            } else {
                $('printOptOutbound').classList.remove('d-none');
                $('printOptOutboundLabel').classList.remove('d-none');
                $('printOptTrans').classList.remove('d-none');
                $('printOptTransLabel').classList.remove('d-none');
                $('printOptTrans').checked = true;
                
                if (data.is_direct === 1) {
                    $('printOptInbound').classList.remove('d-none');
                    $('printOptInboundLabel').classList.remove('d-none');
                } else {
                    $('printOptInbound').classList.add('d-none');
                    $('printOptInboundLabel').classList.add('d-none');
                }
            }
            
            html += `</div>`;
            $('drawerDetailContent').innerHTML = html;
            
        } catch (err) {
            alert('상세 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    openCompanyPresetModal: function() {
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        $('preset_bizNo').value = preset.bizNo || '845-88-00551';
        $('preset_bizName').value = preset.bizName || '주식회사 케앤지';
        $('preset_ceo').value = preset.ceo || '윤종';
        $('preset_address').value = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        $('preset_bizType').value = preset.bizType || '도소매/임대업';
        $('preset_bizItem').value = preset.bizItem || '건설자재, 용품외';
        
        new bootstrap.Modal(document.getElementById('companyPresetModal')).show();
    },
    
    saveCompanyPreset: function() {
        const preset = {
            bizNo: $('preset_bizNo').value,
            bizName: $('preset_bizName').value,
            ceo: $('preset_ceo').value,
            address: $('preset_address').value,
            bizType: $('preset_bizType').value,
            bizItem: $('preset_bizItem').value
        };
        localStorage.setItem('kng_company_preset', JSON.stringify(preset));
        bootstrap.Modal.getInstance(document.getElementById('companyPresetModal')).hide();
        alert('기본값이 저장되었습니다.');
    },
    
    printDirectStatement: async function(id, type, printType) {
        let printWindow = null;
        try {
            // 브라우저 팝업 차단 및 about:blank 방지: 사용자 클릭 이벤트 컨텍스트에서 새 창 선제 오픈
            printWindow = window.open('', '_blank');
            if (printWindow) {
                printWindow.document.open();
                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html lang="ko">
                    <head>
                        <meta charset="UTF-8">
                        <title>인쇄 문서 로딩 중</title>
                        <style>
                            body {
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                height: 80vh;
                                margin: 0;
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                color: #495057;
                            }
                            .loader {
                                border: 3px solid #f3f3f3;
                                border-top: 3px solid #2b579a;
                                border-radius: 50%;
                                width: 32px;
                                height: 32px;
                                animation: spin 1s linear infinite;
                                margin-bottom: 14px;
                            }
                            @keyframes spin {
                                0% { transform: rotate(0deg); }
                                100% { transform: rotate(360deg); }
                            }
                        </style>
                    </head>
                    <body>
                        <div class="loader"></div>
                        <div>인쇄 데이터를 불러오는 중입니다... 잠시만 기다려주세요.</div>
                    </body>
                    </html>
                `);
                printWindow.document.close();
            }

            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            this.currentHistoryDetail = data;
            this.printHistoryDetail(printType, data, printWindow);
        } catch (err) {
            if (printWindow && !printWindow.closed) {
                printWindow.close();
            }
            alert('인쇄 데이터를 가져오지 못했습니다: ' + err.message);
        }
    },

    printHistoryDetail: function(customPrintType = null, customData = null, targetWindow = null) {
        const data = customData || this.currentHistoryDetail;
        if (!data) {
            alert('인쇄할 데이터가 없습니다.');
            if (targetWindow && !targetWindow.closed) targetWindow.close();
            return;
        }
        
        let printType = customPrintType;
        if (!printType) {
            const checkedRadio = document.querySelector('input[name="printType"]:checked');
            printType = checkedRadio ? checkedRadio.value : (data.type === 'inbound' ? 'inbound_receipt' : 'transaction_statement');
        }

        // 인쇄 타입 매핑 정규화 (오타 및 호환성 완벽 보장)
        if (printType === 'outbound_statement' || printType === 'outbound') {
            printType = 'outbound_receipt';
        } else if (printType === 'inbound_statement' || printType === 'inbound') {
            printType = 'inbound_receipt';
        } else if (printType === 'transaction' || printType === 'statement') {
            printType = 'transaction_statement';
        }

        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        const bizNo = preset.bizNo || '845-88-00551';
        const bizName = preset.bizName || '주식회사 케앤지';
        const ceo = preset.ceo || '윤종';
        const address = preset.address || '서울시 강동구 구천면로 159, 1층 2호, 3호';
        const bizType = preset.bizType || '도소매/임대업';
        const bizItem = preset.bizItem || '건설자재, 용품외';

        let printWindow = targetWindow;
        if (!printWindow || printWindow.closed) {
            printWindow = window.open('', '_blank');
        }
        if (!printWindow) {
            alert('팝업 차단이 활성화되어 있어 인쇄 창을 열 수 없습니다. 브라우저 설정에서 팝업을 허용해주세요.');
            return;
        }

        function numberToKorean(number) {
            const inputNumber = parseInt(number, 10);
            if (isNaN(inputNumber) || inputNumber === 0) return "영";
            const hanA = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
            const danA = ["", "십", "백", "천"];
            const danG = ["", "만", "억", "조"];
            let result = "";
            let numStr = inputNumber.toString();
            let length = numStr.length;
            for (let i = 0; i < length; i++) {
                let n = parseInt(numStr.charAt(i));
                let pos = length - i - 1;
                if (n > 0) result += hanA[n] + danA[pos % 4];
                if (pos % 4 === 0 && pos > 0) {
                    let chunk = numStr.substring(Math.max(0, i - 3), i + 1);
                    if (parseInt(chunk) > 0) result += danG[pos / 4];
                }
            }
            return result;
        }

        const items = (data.items && data.items.length > 0) ? data.items : [data];
        const recipientName = data.destination || data.party || data.actual_destination || data.supplier || '-';

        // 공급자 정보 표 (정산장부 표준 380px)
        const supplierHeaderTitle = (printType === 'inbound_receipt') ? '공급받는자' : '공급자';
        const supplierHtml = `
            <table class="supplier-table">
                <tr>
                    <th rowspan="4" class="vertical-th">${supplierHeaderTitle}</th>
                    <th style="width: 55px;">등록번호</th>
                    <td colspan="3">${bizNo}</td>
                </tr>
                <tr>
                    <th>상 호</th>
                    <td style="width: 110px;">${bizName}</td>
                    <th style="width: 45px;">대표자</th>
                    <td class="stamp-cell" style="width: 70px;">${ceo} <img src="../../assets/images/stamp.png" class="stamp" alt="직인" onerror="this.style.display='none'"></td>
                </tr>
                <tr>
                    <th>주 소</th>
                    <td colspan="3" class="address-cell">${address}</td>
                </tr>
                <tr>
                    <th>업 태</th>
                    <td>${bizType}</td>
                    <th>종 목</th>
                    <td>${bizItem}</td>
                </tr>
            </table>`;

        // 공통 A4 Portrait 스타일
        let htmlContent = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>${printType === 'transaction_statement' ? '거래명세서' : (printType === 'inbound_receipt' ? '입고내역서' : '출고내역서')}</title>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css">
                <style>
                    * { box-sizing: border-box; }
                    @page {
                        size: A4 portrait;
                        margin: 12mm 10mm 15mm 10mm;
                    }
                    html, body {
                        height: auto !important;
                        min-height: auto !important;
                        background: #ffffff !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: visible !important;
                        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
                        color: #000000;
                        font-size: 11px;
                        line-height: 1.25;
                        -webkit-font-smoothing: antialiased;
                    }
                    .print-wrapper {
                        width: 100%;
                        max-width: 100%;
                        margin: 0 auto;
                        background: #ffffff;
                        padding: 0;
                    }

                    /* ── 정산장부 동일 상단 헤더 ── */
                    .header-container {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 6px;
                        align-items: flex-end;
                        width: 100%;
                    }
                    .header-left {
                        flex: 1;
                        text-align: center;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                    }
                    .title-box {
                        padding-bottom: 4px;
                        margin-bottom: 8px;
                    }
                    .title-box h1 {
                        margin: 0;
                        font-size: 26px;
                        letter-spacing: 4px;
                        font-weight: 800;
                        white-space: nowrap;
                        color: #000000;
                    }
                    .recipient-box {
                        margin-bottom: 8px;
                    }
                    .recipient-name {
                        font-size: 18px;
                        font-weight: bold;
                        color: #000000;
                    }
                    .date-info {
                        font-size: 12px;
                        color: #333333;
                    }

                    /* ── 정산장부 동일 공급자 표 ── */
                    .supplier-table {
                        border-collapse: collapse;
                        border: 2px solid black;
                        width: 380px;
                        font-size: 11px;
                        margin-left: auto;
                    }
                    .supplier-table th, .supplier-table td {
                        border: 1px solid black;
                        padding: 3px 4px;
                        text-align: center;
                        height: 24px;
                        white-space: nowrap;
                    }
                    .supplier-table th {
                        background-color: #f9f9f9 !important;
                        font-weight: bold;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        color: #000000;
                    }
                    .vertical-th {
                        width: 22px;
                        writing-mode: vertical-lr;
                        letter-spacing: 6px;
                        padding-top: 6px !important;
                        text-align: center;
                    }
                    .stamp-cell {
                        position: relative;
                    }
                    .stamp {
                        position: absolute;
                        right: 2px;
                        top: 50%;
                        transform: translateY(-50%);
                        width: 40px;
                        height: 40px;
                        opacity: 0.9;
                        mix-blend-mode: multiply;
                    }
                    .address-cell {
                        white-space: normal !important;
                        text-align: left !important;
                        padding-left: 6px !important;
                        font-size: 10px;
                        line-height: 1.2;
                    }

                    /* ── 금액 및 요약 박스 ── */
                    .amount-box, .summary-box {
                        border: 2px solid black;
                        padding: 6px 12px;
                        margin-bottom: 8px;
                        display: flex;
                        justify-content: space-between;
                        font-size: 13px;
                        font-weight: bold;
                        background: #ffffff;
                    }

                    /* ── 메인 데이터 표 (정산장부 회계 시트 그리드) ── */
                    .sheet-table {
                        width: 100% !important;
                        border-collapse: collapse !important;
                        font-size: 11px !important;
                        margin-bottom: 6px !important;
                        table-layout: fixed !important;
                        border-top: 2px solid #000000 !important;
                        border-bottom: 2px solid #000000 !important;
                        page-break-inside: auto !important;
                    }
                    .sheet-table thead {
                        display: table-header-group !important;
                    }
                    .sheet-table tbody tr {
                        page-break-inside: avoid !important;
                        break-inside: avoid !important;
                    }
                    .sheet-table th {
                        border-top: none !important;
                        border-left: none !important;
                        border-bottom: 1.5px solid #000000 !important;
                        border-right: 1px solid #cccccc !important;
                        background-color: #f9f9f9 !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                        font-weight: bold !important;
                        color: #000000 !important;
                        text-align: center !important;
                        vertical-align: middle !important;
                        height: 26px !important;
                        padding: 3px 4px !important;
                    }
                    .sheet-table th:last-child, .sheet-table td:last-child {
                        border-right: none !important;
                    }
                    .sheet-table td {
                        border-left: none !important;
                        border-top: none !important;
                        border-right: 1px solid #cccccc !important;
                        border-bottom: 1px solid #aaaaaa !important;
                        padding: 3px 4px !important;
                        text-align: center;
                        vertical-align: middle;
                        height: 26px !important;
                        line-height: 1.25;
                    }
                    .sheet-table td.text-start {
                        text-align: left !important;
                        padding-left: 6px !important;
                        white-space: normal !important;
                        word-break: break-all !important;
                    }
                    .sheet-table td.text-end {
                        text-align: right !important;
                        padding-right: 6px !important;
                        font-variant-numeric: tabular-nums;
                    }
                    .sheet-table td.spec-cell {
                        text-align: center !important;
                        font-size: 10px !important;
                        letter-spacing: -0.3px !important;
                        white-space: normal !important;
                        word-break: break-all !important;
                    }

                    /* 합계행 */
                    .sheet-table tr.total-row td {
                        border-top: 2px solid #000000 !important;
                        border-bottom: none !important;
                        background-color: #f9f9f9 !important;
                        font-weight: bold !important;
                        font-size: 11px !important;
                        padding: 4px 4px !important;
                        height: 28px !important;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }

                    .meta-info-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 11px;
                        color: #333333;
                        margin-top: 4px;
                        padding: 2px 2px;
                    }

                    /* 물류 검수/인수 확인 영역 */
                    .signature-box {
                        margin-top: 14px;
                        text-align: right;
                        font-size: 12px;
                        font-weight: bold;
                        padding-right: 10px;
                        letter-spacing: 0.5px;
                    }

                    @media print {
                        body { padding: 0 !important; margin: 0 !important; }
                        .print-wrapper { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
                    }
                </style>
            </head>
            <body>
            <div class="print-wrapper">`;

        // =========================================================================
        // 1. 거래명세서 (정산장부 회계 시트 양식 100% 동기화, 헤더 "거래명세서", 인수자 서명 제외)
        // =========================================================================
        if (printType === 'transaction_statement') {
            let totalAmount = 0;
            let totalVat = 0;
            let totalSum = 0;
            let itemRowsHtml = "";

            items.forEach((item, idx) => {
                const itemQty = (item.qty != null && !isNaN(item.qty)) ? Number(item.qty) : (Number(item.qty_initial) || 0);
                const price = (item.selling_price != null && !isNaN(item.selling_price)) 
                    ? Number(item.selling_price) 
                    : ((item.price != null && !isNaN(item.price)) ? Number(item.price) : (Number(item.unit_price) || 0));

                const amount = Math.round(itemQty * price);
                const isVatFree = item.tax_type === '면세' || item.vat_free === 1 || item.is_tax_free === 1;
                const vat = isVatFree ? 0 : Math.floor(amount * 0.1);
                const total = amount + vat;

                totalAmount += amount;
                totalVat += vat;
                totalSum += total;

                itemRowsHtml += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td class="text-start">${item.item || '-'}</td>
                        <td class="spec-cell">${item.spec || '-'}</td>
                        <td>${item.unit || 'EA'}</td>
                        <td class="text-end">${itemQty.toLocaleString()}</td>
                        <td class="text-end">${price.toLocaleString()}</td>
                        <td class="text-end">${amount.toLocaleString()}</td>
                        <td class="text-end">${vat.toLocaleString()}</td>
                        <td class="text-end fw-bold">${total.toLocaleString()}</td>
                    </tr>`;
            });

            // 배송비가 등록되어 있는 경우 행 추가 (단, items 내에 이미 운반비/배송비 품목이 포함되어 있는 경우는 2중 출력 방지)
            const hasFreightItemInList = items.some(i => (i.item || '').trim() === '운반비' || (i.item || '').trim() === '배송비');
            if (!hasFreightItemInList && data.shipping_fee && Number(data.shipping_fee) > 0) {
                const shipFeeNum = Number(data.shipping_fee);
                const isVatIncluded = data.shipping_fee_vat_included === 1;
                let shipAmount, shipVat, shipTotal;
                if (isVatIncluded) {
                    shipTotal = shipFeeNum;
                    shipAmount = Math.round(shipTotal / 1.1);
                    shipVat = shipTotal - shipAmount;
                } else {
                    shipAmount = shipFeeNum;
                    shipVat = Math.floor(shipAmount * 0.1);
                    shipTotal = shipAmount + shipVat;
                }

                totalAmount += shipAmount;
                totalVat += shipVat;
                totalSum += shipTotal;

                itemRowsHtml += `
                    <tr>
                        <td>${items.length + 1}</td>
                        <td class="text-start">배송비</td>
                        <td class="spec-cell">-</td>
                        <td>건</td>
                        <td class="text-end">1</td>
                        <td class="text-end">${shipAmount.toLocaleString()}</td>
                        <td class="text-end">${shipAmount.toLocaleString()}</td>
                        <td class="text-end">${shipVat.toLocaleString()}</td>
                        <td class="text-end fw-bold">${shipTotal.toLocaleString()}</td>
                    </tr>`;
            }

            // 빈 행 채우기 (기본 14행으로 A4 용지 밸런스 유지)
            const currentCount = items.length + (!hasFreightItemInList && data.shipping_fee && Number(data.shipping_fee) > 0 ? 1 : 0);
            const emptyRowsCount = Math.max(0, 14 - currentCount);
            let emptyRowsHtml = "";
            for (let i = 0; i < emptyRowsCount; i++) {
                emptyRowsHtml += `
                    <tr>
                        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>`;
            }

            htmlContent += `
                <!-- 헤더 영역 -->
                <div class="header-container">
                    <div class="header-left">
                        <div class="title-box">
                            <h1 id="printTitle">거 래 명 세 서</h1>
                        </div>
                        <div class="recipient-box">
                            <span class="recipient-name">${recipientName}</span> 貴中
                        </div>
                        <div class="date-info">
                            거래일자 : ${data.date || ''}
                        </div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>

                <!-- 금액란 (정산장부 듀얼 금액 표기) -->
                <div class="amount-box">
                    <span>합 계 금 액 : 금 ${numberToKorean(totalSum)} 원 정</span>
                    <span>(₩ ${totalSum.toLocaleString()})</span>
                </div>

                <!-- 품목 상세 테이블 (정산장부 9개 컬럼 양식) -->
                <table class="sheet-table">
                    <thead>
                        <tr>
                            <th style="width: 5%;">순번</th>
                            <th style="width: 25%;">품목명</th>
                            <th style="width: 15%;">규격</th>
                            <th style="width: 5%;">단위</th>
                            <th style="width: 6%;">수량</th>
                            <th style="width: 10%;">단가</th>
                            <th style="width: 11%;">공급가액</th>
                            <th style="width: 10%;">세액</th>
                            <th style="width: 13%;">합계</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        ${emptyRowsHtml}
                        <tr class="total-row">
                            <td colspan="6" style="text-align: center;">[   합       계   ]</td>
                            <td class="text-end">${totalAmount.toLocaleString()}</td>
                            <td class="text-end">${totalVat.toLocaleString()}</td>
                            <td class="text-end" style="font-weight: 800;">${totalSum.toLocaleString()}</td>
                        </tr>
                    </tbody>
                </table>

                <!-- 하단 비고 -->
                <div class="meta-info-row">
                    <div>${data.note ? '<strong>비고:</strong> ' + data.note : ''}</div>
                </div>
            `;

        // =========================================================================
        // 2. 입고내역서 (물류 실물 검수 특화 전표)
        // =========================================================================
        } else if (printType === 'inbound_receipt') {
            let totalQty = 0;
            let itemRowsHtml = "";

            items.forEach((item, idx) => {
                const itemQty = (item.qty != null && !isNaN(item.qty)) ? Number(item.qty) : (Number(item.qty_initial) || 0);
                totalQty += itemQty;
                const locName = item.location_name || data.location_name || '-';
                const tradeType = item.trade_type || data.trade_type || '내수';

                itemRowsHtml += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td class="text-start">${item.item || '-'}</td>
                        <td class="spec-cell">${item.spec || '-'}</td>
                        <td>${item.unit || 'EA'}</td>
                        <td class="text-end fw-bold">${itemQty.toLocaleString()}</td>
                        <td>${locName}</td>
                        <td>${tradeType}</td>
                        <td>정상입고</td>
                    </tr>`;
            });

            const emptyRowsCount = Math.max(0, 14 - items.length);
            let emptyRowsHtml = "";
            for (let i = 0; i < emptyRowsCount; i++) {
                emptyRowsHtml += `
                    <tr>
                        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>`;
            }

            htmlContent += `
                <!-- 헤더 영역 -->
                <div class="header-container">
                    <div class="header-left">
                        <div class="title-box">
                            <h1 id="printTitle">입 고 내 역 서</h1>
                        </div>
                        <div class="recipient-box">
                            <span class="recipient-name">${data.supplier || recipientName}</span> 貴中
                        </div>
                        <div class="date-info">
                            입고일자 : ${data.date || ''}
                        </div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>

                <!-- 물류 요약 박스 -->
                <div class="summary-box">
                    <span>총 입고 품목 : ${items.length} 종</span>
                    <span>총 입고 수량 : ${totalQty.toLocaleString()} EA</span>
                </div>

                <!-- 물류 실물 검수 테이블 -->
                <table class="sheet-table">
                    <thead>
                        <tr>
                            <th style="width: 5%;">순번</th>
                            <th style="width: 28%;">품목명</th>
                            <th style="width: 16%;">규격</th>
                            <th style="width: 6%;">단위</th>
                            <th style="width: 9%;">입고수량</th>
                            <th style="width: 16%;">입고창고</th>
                            <th style="width: 8%;">구분</th>
                            <th style="width: 12%;">검수확인</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        ${emptyRowsHtml}
                        <tr class="total-row">
                            <td colspan="4" style="text-align: center;">[   합       계   ]</td>
                            <td class="text-end" style="font-weight: 800;">${totalQty.toLocaleString()}</td>
                            <td colspan="3"></td>
                        </tr>
                    </tbody>
                </table>

                <div class="meta-info-row">
                    <div>${data.note ? '<strong>비고:</strong> ' + data.note : ''}</div>
                </div>

                <div class="signature-box">
                    입고 검수자 : _____________________ (서명/인)
                </div>
            `;

        // =========================================================================
        // 3. 출고내역서 (물류 실물 인수증 특화 전표)
        // =========================================================================
        } else {
            let totalQty = 0;
            let itemRowsHtml = "";

            const hasFreightItemInReceipt = items.some(i => (i.item || '').trim() === '운반비' || (i.item || '').trim() === '배송비');
            const showHeaderShip = !hasFreightItemInReceipt && data.shipping_fee && Number(data.shipping_fee) > 0;

            items.forEach((item, idx) => {
                const itemQty = (item.qty != null && !isNaN(item.qty)) ? Number(item.qty) : (Number(item.qty_initial) || 0);
                totalQty += itemQty;

                let lotsInfo = (item.consumed_lots && item.consumed_lots.length > 0) 
                    ? item.consumed_lots.map(l => l.location_name || l.lot_number || '').filter(Boolean).join(', ') 
                    : (item.location_name || data.location_name || '-');

                itemRowsHtml += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td class="text-start">${item.item || '-'}</td>
                        <td class="spec-cell">${item.spec || '-'}</td>
                        <td>${item.unit || 'EA'}</td>
                        <td class="text-end fw-bold">${itemQty.toLocaleString()}</td>
                        <td class="spec-cell">${lotsInfo}</td>
                        <td>${idx === 0 && showHeaderShip ? Number(data.shipping_fee).toLocaleString() + '원' : '-'}</td>
                        <td>출고완료</td>
                    </tr>`;
            });

            const emptyRowsCount = Math.max(0, 14 - items.length);
            let emptyRowsHtml = "";
            for (let i = 0; i < emptyRowsCount; i++) {
                emptyRowsHtml += `
                    <tr>
                        <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>`;
            }

            const shipSummary = showHeaderShip
                ? ` | 배송비 : ${Number(data.shipping_fee).toLocaleString()}원 (${data.shipping_fee_vat_included === 1 ? 'VAT포함' : '별도'})`
                : '';

            htmlContent += `
                <!-- 헤더 영역 -->
                <div class="header-container">
                    <div class="header-left">
                        <div class="title-box">
                            <h1 id="printTitle">출 고 내 역 서</h1>
                        </div>
                        <div class="recipient-box">
                            <span class="recipient-name">${recipientName}</span> 貴中
                        </div>
                        <div class="date-info">
                            출고일자 : ${data.date || ''}
                            ${data.actual_destination ? `<br><span style="font-size:11px;color:#555;">실출고지 : ${data.actual_destination}</span>` : ''}
                        </div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>

                <!-- 물류 요약 박스 -->
                <div class="summary-box">
                    <span>총 출고 품목 : ${items.length} 종</span>
                    <span>총 출고 수량 : ${totalQty.toLocaleString()} EA${shipSummary}</span>
                </div>

                <!-- 물류 실물 출고 테이블 -->
                <table class="sheet-table">
                    <thead>
                        <tr>
                            <th style="width: 5%;">순번</th>
                            <th style="width: 27%;">품목명</th>
                            <th style="width: 15%;">규격</th>
                            <th style="width: 5%;">단위</th>
                            <th style="width: 9%;">출고수량</th>
                            <th style="width: 17%;">출고창고/로트</th>
                            <th style="width: 11%;">배송비</th>
                            <th style="width: 11%;">상태</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        ${emptyRowsHtml}
                        <tr class="total-row">
                            <td colspan="4" style="text-align: center;">[   합       계   ]</td>
                            <td class="text-end" style="font-weight: 800;">${totalQty.toLocaleString()}</td>
                            <td colspan="3"></td>
                        </tr>
                    </tbody>
                </table>

                <div class="meta-info-row">
                    <div>${data.note ? '<strong>비고:</strong> ' + data.note : ''}</div>
                </div>

                <!-- 물류 실물 인수자 서명란 -->
                <div class="signature-box">
                    위 물품을 정히 영수(인수)함. &nbsp;&nbsp;&nbsp;&nbsp; 인수자 : _____________________ (서명/인)
                </div>
            `;
        }

        htmlContent += `
            </div>
            <script>
                window.addEventListener('afterprint', function() {
                    window.close();
                });
                function doPrint() {
                    setTimeout(function() {
                        window.focus();
                        window.print();
                    }, 250);
                }
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    doPrint();
                } else {
                    window.addEventListener('DOMContentLoaded', doPrint);
                    window.addEventListener('load', doPrint);
                }
            </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    },

    // ----------------------------------------
    // Edit Logic (수정 로직)
    // ----------------------------------------
    openEditInbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/inbound/${id}`);
            
            $('editInboundId').value = data.id;
            $('edit_in_date').value = data.date;
            $('edit_in_supplier').value = data.supplier;
            $('edit_in_location').innerHTML = locations.map(l => `<option value="${l.id}" ${l.id === data.location_id ? 'selected' : ''}>${l.name}</option>`).join('');
            
            $('edit_in_item').value = data.item;
            $('edit_in_spec').value = data.spec;
            $('edit_in_unit').value = data.unit;
            $('edit_in_qty').value = data.qty_initial;
            $('edit_in_price').value = data.unit_price;
            $('edit_in_note').value = data.note || '';
            if ($('edit_in_category')) $('edit_in_category').value = data.category || '';
            if ($('edit_in_trade_type')) $('edit_in_trade_type').value = data.trade_type || '내수';
            if ($('edit_in_freight_type')) $('edit_in_freight_type').value = data.freight_type || '상차도';
            
            const consumed = data.qty_initial - data.qty_remaining;
            if (consumed > 0) {
                $('editInboundWarning').classList.remove('d-none');
                $('editInboundMinQty').innerText = consumed;
                $('edit_in_qty').min = consumed;
                $('edit_in_item').disabled = true;
                $('edit_in_item').readOnly = true;
                $('edit_in_item').classList.add('bg-light', 'text-muted');
                $('edit_in_spec').disabled = true;
                $('edit_in_spec').readOnly = true;
                $('edit_in_spec').classList.add('bg-light', 'text-muted');
                $('edit_in_unit').disabled = true;
                $('edit_in_unit').readOnly = true;
                $('edit_in_unit').classList.add('bg-light', 'text-muted');
            } else {
                $('editInboundWarning').classList.add('d-none');
                $('edit_in_qty').min = 0.01;
                $('edit_in_item').disabled = false;
                $('edit_in_item').readOnly = false;
                $('edit_in_item').classList.remove('bg-light', 'text-muted');
                $('edit_in_spec').disabled = false;
                $('edit_in_spec').readOnly = false;
                $('edit_in_spec').classList.remove('bg-light', 'text-muted');
                $('edit_in_unit').disabled = false;
                $('edit_in_unit').readOnly = false;
                $('edit_in_unit').classList.remove('bg-light', 'text-muted');
            }
            
            let modal = bootstrap.Modal.getInstance($('editInboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editInboundModal'));
            modal.show();
        } catch(err) {
            alert('입고 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    submitEditInbound: async function(e) {
        e.preventDefault();
        const id = $('editInboundId').value;
        const payload = {
            date: $('edit_in_date').value,
            supplier: $('edit_in_supplier').value,
            location_id: $('edit_in_location').value,
            item: $('edit_in_item').value,
            spec: $('edit_in_spec').value,
            unit: $('edit_in_unit').value,
            qty: parseFloat($('edit_in_qty').value),
            unit_price: parseFloat($('edit_in_price').value),
            note: $('edit_in_note').value,
            trade_type: $('edit_in_trade_type') ? $('edit_in_trade_type').value : '내수',
            category: $('edit_in_category') ? $('edit_in_category').value.trim() : '',
            freight_type: $('edit_in_freight_type') ? $('edit_in_freight_type').value : '상차도',
            freight_region: ''
        };
        
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('입고 내역이 수정되었습니다.');
            bootstrap.Modal.getInstance($('editInboundModal')).hide();
            this.loadHistory();
            if ($('detailModal') && $('detailModal').classList.contains('show')) {
                this.renderDrawerDetail(id, 'inbound');
            }
        } catch(err) {
            alert('수정 실패: ' + err.message);
        }
    },
    
    editOutboundState: { availableLots: [], consumedLots: [] },
    
    
    openEditDirectOutbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/outbound/${id}`);
            const item = data.items ? (data.items.find(i => i.id == id) || data) : data;
            
            $('editDirectId').value = item.id;
            $('edit_direct_date').value = item.date;
            $('edit_direct_supplier').value = item.supplier || '';
            $('edit_direct_destination').value = item.actual_destination || item.destination || item.party || '';
            if ($('edit_direct_in_shipping')) $('edit_direct_in_shipping').value = item.in_shipping_fee || 0;
            if ($('edit_direct_in_shipping_vat')) $('edit_direct_in_shipping_vat').checked = (item.in_shipping_fee_vat_included === 1 || item.in_shipping_vat === 1);
            if ($('edit_direct_out_shipping')) $('edit_direct_out_shipping').value = item.shipping_fee || 0;
            if ($('edit_direct_out_shipping_vat')) $('edit_direct_out_shipping_vat').checked = item.shipping_fee_vat_included === 1;
            $('edit_direct_note').value = item.note || '';
            if ($('edit_direct_trade_type')) $('edit_direct_trade_type').value = item.trade_type || '내수';
            if ($('edit_direct_category')) $('edit_direct_category').value = item.category || '';
            if ($('edit_direct_freight_type')) $('edit_direct_freight_type').value = item.freight_type || '하차도';
            
            $('edit_direct_item').value = item.item;
            $('edit_direct_spec').value = item.spec || '';
            $('edit_direct_unit').value = item.unit || '';
            $('edit_direct_qty').value = item.qty;
            $('edit_direct_inbound_price').value = item.inbound_price || 0;
            $('edit_direct_outbound_price').value = item.selling_price || item.price || 0;
            
            const modalEl = document.getElementById('editDirectModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
        } catch(err) {
            console.error(err);
            alert('직출고 데이터를 불러오는 중 오류가 발생했습니다.');
        }
    },

    submitEditDirectOutbound: async function(e) {
        e.preventDefault();
        const id = $('editDirectId').value;
        const payload = {
            date: $('edit_direct_date').value,
            supplier: $('edit_direct_supplier').value,
            destination: $('edit_direct_destination').value,
            actual_destination: $('edit_direct_destination').value,
            qty: parseFloat($('edit_direct_qty').value) || 0,
            inbound_price: parseFloat($('edit_direct_inbound_price').value) || 0,
            selling_price: parseFloat($('edit_direct_outbound_price').value) || 0,
            in_shipping_fee: parseFloat($('edit_direct_in_shipping') ? $('edit_direct_in_shipping').value : 0) || 0,
            in_shipping_fee_vat_included: ($('edit_direct_in_shipping_vat') && $('edit_direct_in_shipping_vat').checked) ? 1 : 0,
            shipping_fee: parseFloat($('edit_direct_out_shipping') ? $('edit_direct_out_shipping').value : 0) || 0,
            shipping_fee_vat_included: ($('edit_direct_out_shipping_vat') && $('edit_direct_out_shipping_vat').checked) ? 1 : 0,
            note: $('edit_direct_note').value,
            trade_type: $('edit_direct_trade_type') ? $('edit_direct_trade_type').value : '내수',
            category: $('edit_direct_category') ? $('edit_direct_category').value.trim() : '',
            freight_type: $('edit_direct_freight_type') ? $('edit_direct_freight_type').value : '하차도',
            freight_region: ''
        };

        try {
            await authFetch(`${API_BASE}/direct/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const modalEl = document.getElementById('editDirectModal');
            bootstrap.Modal.getInstance(modalEl).hide();
            this.resetPageAndLoadHistory();
            showAlert('직출고 내역이 수정되었습니다.');
        } catch(err) {
            console.error(err);
            alert('수정 실패: ' + err.message);
        }
    },

    openEditOutbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/outbound/${id}`);
            const item = data.items ? (data.items.find(i => i.id == id) || data) : data;
            
            $('editOutboundId').value = item.id;
            $('edit_out_date').value = item.date;
            $('edit_out_destination').value = item.destination || item.party;
            $('edit_out_shipping').value = item.shipping_fee || 0;
            $('edit_out_shipping_vat').checked = item.shipping_fee_vat_included === 1;
            $('edit_out_note').value = item.note || '';
            if ($('edit_out_trade_type')) $('edit_out_trade_type').value = item.trade_type || '내수';
            if ($('edit_out_category')) $('edit_out_category').value = item.category || '';
            if ($('edit_out_freight_type')) $('edit_out_freight_type').value = item.freight_type || '상차도';
            
            $('edit_out_item').value = item.item;
            $('edit_out_spec').value = item.spec || '';
            $('edit_out_unit').value = item.unit || '';
            $('edit_out_qty').value = item.qty;
            $('edit_out_price').value = item.selling_price || item.price;
            
            // 기존 할당된 Lot 정보 저장
            this.editOutboundState.consumedLots = (item.consumed_lots || []).map(l => ({
                inbound_id: l.inbound_id,
                consumed_qty: l.consumed_qty
            }));
            
            // 품목에 해당하는 전체 사용 가능 재고(Lot)를 백엔드에서 조회
            // 주의: 자기 자신이 차감했던 재고량도 복구된 상태로 계산해야 하므로 백엔드에서 받은 잔여량 + 내가 차감했던 양
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(item.item)}`);
            
            // 현재 차감된 lot들의 수량을 잔여량에 더해서 가상의 "수정 전 초기 상태" 잔여량을 만듬
            this.editOutboundState.availableLots = lots.map(lot => {
                const consumed = this.editOutboundState.consumedLots.find(c => c.inbound_id === lot.id);
                if (consumed) {
                    lot.qty_remaining += consumed.consumed_qty;
                }
                return lot;
            });
            
            let modal = bootstrap.Modal.getInstance($('editOutboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editOutboundModal'));
            modal.show();
            
            // 오류 메시지 리셋
            $('editOutboundErrorMsg').style.display = 'none';
        } catch(err) {
            alert('출고 내역을 불러오는데 실패했습니다: ' + err.message);
        }
    },
    
    openEditOutboundLotModal: function() {
        this.currentLotModalRowId = 'editOutbound';
        const itemName = $('edit_out_item').value;
        const specName = $('edit_out_spec').value;
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.editOutboundState;
        
        const tbody = $('lotModalTbody');
        tbody.innerHTML = rData.availableLots.map(lot => {
            const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
            const val = consumed ? consumed.consumed_qty : 0;
            return `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                           data-id="${lot.id}"
                           min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                           onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                </td>
            </tr>
            `;
        }).join('');
        
        this.validateLotModalSum();
        
        let modal = bootstrap.Modal.getInstance($('lotModal'));
        if (!modal) modal = new bootstrap.Modal($('lotModal'));
        modal.show();
    },
    
    submitEditOutbound: async function(e) {
        e.preventDefault();
        
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        const sumLots = this.editOutboundState.consumedLots.reduce((acc, cur) => acc + cur.consumed_qty, 0);
        
        if (Math.abs(sumLots - targetQty) > 0.0001) {
            $('editOutboundErrorMsg').style.display = 'block';
            return;
        }
        
        const id = $('editOutboundId').value;
        const payload = {
            date: $('edit_out_date').value,
            destination: $('edit_out_destination').value,
            item: $('edit_out_item').value,
            spec: $('edit_out_spec').value,
            unit: $('edit_out_unit').value,
            qty: targetQty,
            selling_price: parseFloat($('edit_out_price').value) || 0,
            shipping_fee: parseFloat($('edit_out_shipping').value) || 0,
            shipping_fee_vat_included: $('edit_out_shipping_vat').checked ? 1 : 0,
            trade_type: $('edit_out_trade_type') ? $('edit_out_trade_type').value : '내수',
            category: $('edit_out_category') ? $('edit_out_category').value.trim() : '',
            freight_type: $('edit_out_freight_type') ? $('edit_out_freight_type').value : '상차도',
            freight_region: '',
            note: $('edit_out_note').value,
            consumed_lots: this.editOutboundState.consumedLots
        };
        
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('출고 내역이 수정되었습니다.');
            bootstrap.Modal.getInstance($('editOutboundModal')).hide();
            this.loadHistory();
            if ($('detailModal') && $('detailModal').classList.contains('show')) {
                this.renderDrawerDetail(id, 'outbound');
            }
        } catch(err) {
            alert('수정 실패: ' + err.message);
        }
    },

    // ══════════════════════════════════════════════════════════════
    // 모바일 특화 반응형 UI / UX 컨트롤러 (Mobile Specialized UI/UX)
    // ══════════════════════════════════════════════════════════════
    currentViewMode: 'card', // 'card' 또는 'table'
    isMobileFabOpen: false,
    isMobileFilterOpen: false,

    initMobileUI: function() {
        const isMobile = window.innerWidth <= 768;
        const savedMode = localStorage.getItem('kng_inout_view_mode');
        this.currentViewMode = savedMode || (isMobile ? 'card' : 'table');
        this.applyViewMode();

        window.addEventListener('resize', () => {
            this.applyViewMode();
        });

        // 모바일 검색창 Enter 키 이벤트
        const mobSearch = $('mobileSearchInput');
        if (mobSearch) {
            mobSearch.addEventListener('input', (e) => {
                const clearBtn = $('mobileClearSearchBtn');
                if (clearBtn) {
                    if (e.target.value) clearBtn.classList.remove('d-none');
                    else clearBtn.classList.add('d-none');
                }
            });
        }

        // 초기 모바일 필터 값 동기화
        this.updateMobileFilterFromDesktop();
    },

    setViewMode: function(mode) {
        this.currentViewMode = mode;
        localStorage.setItem('kng_inout_view_mode', mode);
        this.applyViewMode();
    },

    applyViewMode: function() {
        const isMobile = window.innerWidth <= 768;
        const savedMode = localStorage.getItem('kng_inout_view_mode');
        const mode = this.currentViewMode || savedMode || (isMobile ? 'card' : 'table');

        const cardsContainer = $('historyCardsContainer');
        const tableWrapper = document.querySelector('.erp-main-grid-wrapper');
        const btnCard = $('btnViewCard');
        const btnTable = $('btnViewTable');

        if (mode === 'card') {
            if (cardsContainer) cardsContainer.style.display = 'block';
            if (tableWrapper) tableWrapper.classList.add('mobile-hidden-table');
            if (btnCard) btnCard.classList.add('active');
            if (btnTable) btnTable.classList.remove('active');
        } else {
            if (cardsContainer) cardsContainer.style.display = 'none';
            if (tableWrapper) tableWrapper.classList.remove('mobile-hidden-table');
            if (btnCard) btnCard.classList.remove('active');
            if (btnTable) btnTable.classList.add('active');
        }
    },

    renderMobileCards: function(data) {
        const container = $('historyCardsContainer');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="mobile-empty-state">
                    <i class='bx bx-file-blank fs-1 text-muted mb-2'></i>
                    <div class="fw-bold text-dark fs-6">조회된 입출고 내역이 없습니다</div>
                    <div class="text-muted small mt-1">상단 필터나 검색 조건을 변경해 보세요.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = data.map(r => {
            const isOut = r.type === 'outbound';
            const isDirect = (r.type === '직출고' || r.is_direct === 1);

            let badge = isOut ? `<span class="erp-badge erp-badge-out">출고</span>` : `<span class="erp-badge erp-badge-in">입고</span>`;
            if (isDirect) {
                badge = `<span class="erp-badge erp-badge-direct">직출고</span>`;
            }
            if (r.trade_type && r.trade_type !== '내수') {
                badge += ` <span class="erp-badge erp-badge-info">${r.trade_type}</span>`;
            }

            const txIdDisplay = r.transaction_group_id || (isDirect ? `OUT-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}` : (isOut ? `OUT-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}` : `IN-${(r.date || '').split('T')[0].replace(/-/g,'')}-${String(r.id).padStart(4, '0')}`));
            const dateStr = (r.date || '').split('T')[0];

            let freightBadge = '';
            if (r.freight_type === '하차도') {
                freightBadge = ` <span class="badge-freight-in" title="운임: 하차도">하차도</span>`;
            } else if (r.freight_type === '상차도') {
                freightBadge = ` <span class="badge-freight-ex" title="운임: 상차도">상차도</span>`;
            }

            const delFn = isOut ? `app.deleteOutbound(${r.id})` : `app.deleteInbound(${r.id})`;
            const editFn = isDirect
                ? `app.openEditDirectOutboundTx('${r.transaction_group_id || ''}', ${r.id})`
                : (isOut ? `app.openEditOutboundTx('${r.transaction_group_id || ''}', ${r.id})` : `app.openEditInboundTx('${r.transaction_group_id || ''}', ${r.id})`);

            let partnerHtml = '';
            if (isDirect) {
                partnerHtml = `
                    <div class="mobile-partner-flow">
                        <span class="partner-point"><span class="partner-label">매입</span> <strong>${r.supplier || '-'}</strong></span>
                        <i class='bx bx-right-arrow-alt flow-arrow'></i>
                        <span class="partner-point"><span class="partner-label">매출</span> <strong class="text-primary">${r.destination || '-'}</strong></span>
                    </div>
                `;
            } else if (isOut) {
                partnerHtml = `
                    <div class="mobile-partner-single">
                        <span class="partner-label">매출처</span>
                        <strong class="text-dark">${r.destination || '-'}</strong>
                        ${r.actual_destination && r.actual_destination.trim() !== (r.destination || '').trim() ? `<span class="text-secondary small ms-1">(실: ${r.actual_destination.trim()})</span>` : ''}
                    </div>
                `;
            } else {
                partnerHtml = `
                    <div class="mobile-partner-single">
                        <span class="partner-label">매입처</span>
                        <strong class="text-dark">${r.supplier || '-'}</strong>
                    </div>
                `;
            }

            const qtyDisplay = (r.qty || 0).toLocaleString();
            const priceDisplay = isOut ? (r.outbound_price ? Math.round(Number(r.outbound_price)).toLocaleString() : '-') : (r.inbound_price ? Math.round(Number(r.inbound_price)).toLocaleString() : '-');
            const totalDisplay = isOut ? (r.outbound_total ? Math.round(Number(r.outbound_total)).toLocaleString() : '0') : (r.inbound_total ? Math.round(Number(r.inbound_total)).toLocaleString() : '0');

            return `
            <div class="mobile-tx-card" id="mobile_card_${r.id}">
                <div class="mobile-tx-card-header">
                    <div class="d-flex align-items-center gap-2 min-w-0" style="overflow: hidden;">
                        <input type="checkbox" class="form-check-input history-checkbox m-0 flex-shrink-0" value="${r.id}" data-type="${r.type}" onchange="app.syncCardSelection(${r.id}, this.checked)">
                        ${badge}
                        <span class="mobile-tx-date text-truncate"><i class='bx bx-calendar me-1'></i>${dateStr}</span>
                    </div>
                    <span class="mobile-tx-id">${txIdDisplay}</span>
                </div>

                <div class="mobile-tx-card-body" onclick="app.toggleMobileCardAccordion(${r.id}, '${r.type}')">
                    <div class="mobile-tx-item-title">
                        <span class="item-name">${r.item || '-'}</span>
                        ${freightBadge}
                    </div>

                    <div class="mobile-tx-meta-chips">
                        ${r.spec ? `<span class="mobile-chip spec-chip"><i class='bx bx-ruler'></i> ${r.spec}</span>` : ''}
                        ${r.category ? `<span class="mobile-chip cat-chip">${r.category}</span>` : ''}
                        ${r.unit ? `<span class="mobile-chip unit-chip">${r.unit}</span>` : ''}
                    </div>

                    <div class="mobile-tx-partner-wrap">
                        ${partnerHtml}
                    </div>

                    <div class="mobile-tx-stats-grid">
                        <div class="mobile-stat-box">
                            <span class="mobile-stat-label">수량</span>
                            <span class="mobile-stat-val ${isOut ? 'text-danger' : 'text-success'}">${qtyDisplay} <small class="fw-normal text-muted">${r.unit || ''}</small></span>
                        </div>
                        <div class="mobile-stat-box">
                            <span class="mobile-stat-label">${isOut ? '매출단가' : '매입단가'}</span>
                            <span class="mobile-stat-val text-muted">${priceDisplay}원</span>
                        </div>
                        <div class="mobile-stat-box mobile-stat-highlight">
                            <span class="mobile-stat-label">${isOut ? '매출합계' : '매입합계'}</span>
                            <span class="mobile-stat-val text-primary fw-bold">${totalDisplay}원</span>
                        </div>
                    </div>
                </div>

                <div class="mobile-tx-card-footer">
                    <button type="button" class="btn-mobile-acc" onclick="app.toggleMobileCardAccordion(${r.id}, '${r.type}')" id="mobile_acc_btn_${r.id}">
                        <i class='bx bx-chevron-down' id="mobile_acc_icon_${r.id}"></i> 상세 전표
                    </button>
                    <div class="mobile-tx-actions">
                        ${r.settlement_status === '정산완료'
                            ? `<span class="badge bg-secondary px-2 py-1">정산완료</span>`
                            : `<button type="button" class="btn btn-sm btn-outline-primary mobile-act-btn me-1" onclick="event.stopPropagation(); ${editFn}">
                                   <i class='bx bx-edit'></i> 수정
                               </button>
                               <button type="button" class="btn btn-sm btn-outline-danger mobile-act-btn" onclick="event.stopPropagation(); ${delFn}">
                                   <i class='bx bx-trash'></i> 삭제
                               </button>`
                        }
                    </div>
                </div>

                <div id="mobile_accordion_${r.id}" class="mobile-card-accordion-content d-none">
                    <div class="p-3 text-center text-muted" style="font-size: 12px;">
                        <i class='bx bx-loader-alt bx-spin me-1'></i> 상세 전표 내역을 불러오는 중입니다...
                    </div>
                </div>
            </div>
            `;
        }).join('');
    },

    syncCardSelection: function(id, isChecked) {
        const tableCb = document.querySelector(`#row_${id} .history-checkbox`);
        if (tableCb && tableCb.checked !== isChecked) {
            tableCb.checked = isChecked;
        }
        const cardCb = document.querySelector(`#mobile_card_${id} .history-checkbox`);
        if (cardCb && cardCb.checked !== isChecked) {
            cardCb.checked = isChecked;
        }
        this.updateSelectionSummary();
    },

    toggleMobileCardAccordion: async function(id, type) {
        const accBox = $(`mobile_accordion_${id}`);
        const accIcon = $(`mobile_acc_icon_${id}`);
        const card = $(`mobile_card_${id}`);
        if (!accBox) return;

        const isOpening = accBox.classList.contains('d-none');
        if (!isOpening) {
            accBox.classList.add('d-none');
            if (accIcon) accIcon.className = 'bx bx-chevron-down';
            if (card) card.classList.remove('card-expanded');
            return;
        }

        accBox.classList.remove('d-none');
        if (accIcon) accIcon.className = 'bx bx-chevron-up text-primary';
        if (card) card.classList.add('card-expanded');

        accBox.innerHTML = `<div class="p-3 text-center text-muted" style="font-size: 12px;"><i class='bx bx-loader-alt bx-spin me-1'></i> 상세 전표 내역을 불러오는 중입니다...</div>`;

        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            const items = data.items || [data];
            const isDirect = (type === 'outbound' && data.is_direct === 1) || type === '직출고';

            let itemsHtml = items.map((item, idx) => {
                const itemQty = type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const inPrice = item.unit_price !== undefined ? item.unit_price : (item.inbound_price || 0);
                const outPrice = item.selling_price !== undefined ? item.selling_price : (item.outbound_price || 0);
                const inAmt = Math.round(inPrice * itemQty);
                const outAmt = Math.round(outPrice * itemQty);

                let lotsHtml = '';
                if (type === 'outbound' && !isDirect && item.consumed_lots && item.consumed_lots.length > 0) {
                    lotsHtml = `
                        <div class="mobile-lot-box mt-1">
                            <small class="text-muted fw-bold">차감 Lot:</small>
                            ${item.consumed_lots.map(l => `<span class="badge bg-light text-dark border me-1">${l.inbound_date} (${l.supplier || '-'}) -${l.consumed_qty}</span>`).join('')}
                        </div>
                    `;
                }

                return `
                <div class="mobile-sub-item-card">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <strong class="text-dark">${idx + 1}. ${item.item}</strong>
                        <span class="badge bg-primary bg-opacity-10 text-primary">${itemQty.toLocaleString()} ${item.unit || ''}</span>
                    </div>
                    <div class="text-muted small mb-1">
                        <span>규격: ${item.spec || '-'}</span> | <span>분류: ${item.category || '-'}</span>
                    </div>
                    <div class="d-flex justify-content-between small">
                        <span class="text-secondary">${isDirect || type === 'inbound' ? `매입단가: ${inPrice.toLocaleString()}원` : ''}</span>
                        <strong class="${isDirect || type === 'outbound' ? 'text-danger' : 'text-primary'}">${isDirect || type === 'outbound' ? `매출: ${outAmt.toLocaleString()}원` : `매입: ${inAmt.toLocaleString()}원`}</strong>
                    </div>
                    ${lotsHtml}
                    ${item.note ? `<div class="text-muted small mt-1 bg-light p-1 rounded">비고: ${item.note}</div>` : ''}
                </div>
                `;
            }).join('');

            accBox.innerHTML = `
                <div class="mobile-acc-inner p-3 bg-light rounded-bottom">
                    <div class="d-flex justify-content-between align-items-center mb-2 pb-2 border-bottom">
                        <span class="fw-bold small text-dark"><i class='bx bx-list-check me-1 text-primary'></i> 전표 품목 리스트 (${items.length}건)</span>
                        <span class="small text-muted">${data.transaction_group_id || ''}</span>
                    </div>
                    <div class="mobile-sub-items-wrap">
                        ${itemsHtml}
                    </div>
                    ${data.note ? `<div class="alert alert-light border mt-2 py-1 px-2 mb-0 small"><i class='bx bx-note me-1'></i>전표 비고: ${data.note}</div>` : ''}
                </div>
            `;
        } catch(err) {
            console.error('Mobile accordion error:', err);
            accBox.innerHTML = `<div class="p-3 text-center text-danger small">상세 정보를 불러올 수 없습니다.</div>`;
        }
    },

    toggleMobileFilter: function(force) {
        const drawer = $('mobileFilterDrawer');
        const backdrop = $('mobileFilterBackdrop');
        const dot = $('mobileFilterDot');
        if (!drawer) return;

        this.isMobileFilterOpen = (force !== undefined) ? force : !this.isMobileFilterOpen;
        if (this.isMobileFilterOpen) {
            drawer.classList.add('open');
            if (backdrop) backdrop.classList.remove('d-none');
            this.updateMobileFilterFromDesktop();
        } else {
            drawer.classList.remove('open');
            if (backdrop) backdrop.classList.add('d-none');
        }

        // 활성 필터 인디케이터 도트 표시 여부
        if (dot) {
            const hasActiveFilter = Boolean($('searchStartDate')?.value || $('searchEndDate')?.value || $('searchTarget')?.value || (this.currentDatePreset && this.currentDatePreset !== 'all'));
            if (hasActiveFilter) dot.classList.remove('d-none');
            else dot.classList.add('d-none');
        }
    },

    toggleMobileFab: function(force) {
        const menu = $('mobileFabMenu');
        const mainBtn = $('mobileFabMainBtn');
        const backdrop = $('mobileFabBackdrop');
        if (!menu || !mainBtn) return;

        this.isMobileFabOpen = (force !== undefined) ? force : !this.isMobileFabOpen;
        if (this.isMobileFabOpen) {
            menu.classList.add('open');
            mainBtn.classList.add('active');
            if (backdrop) backdrop.classList.remove('d-none');
        } else {
            menu.classList.remove('open');
            mainBtn.classList.remove('active');
            if (backdrop) backdrop.classList.add('d-none');
        }
    },

    setMobileTypeFilter: function(type) {
        document.querySelectorAll('.mobile-type-tab').forEach(t => {
            if (t.dataset.type === type) t.classList.add('active');
            else t.classList.remove('active');
        });

        const targetRadioMap = {
            'all': 'btnFilterAll',
            'inbound': 'btnFilterIn',
            'outbound': 'btnFilterOut',
            'direct': 'btnFilterDirect'
        };
        const radioId = targetRadioMap[type];
        if (radioId && $(radioId)) {
            $(radioId).checked = true;
            this.resetPageAndLoadHistory();
        }
    },

    submitMobileSearch: function() {
        const input = $('mobileSearchInput');
        const kw = input ? input.value.trim() : '';
        if ($('historySearch')) {
            $('historySearch').value = kw;
        }
        this.resetPageAndLoadHistory();
    },

    clearMobileSearch: function() {
        const input = $('mobileSearchInput');
        if (input) input.value = '';
        const clearBtn = $('mobileClearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        if ($('historySearch')) $('historySearch').value = '';
        this.resetPageAndLoadHistory();
    },

    updateMobileDateInputs: function() {
        if ($('mobileStartDate') && $('searchStartDate')) {
            $('mobileStartDate').value = $('searchStartDate').value;
        }
        if ($('mobileEndDate') && $('searchEndDate')) {
            $('mobileEndDate').value = $('searchEndDate').value;
        }
        // 프리셋 칩 액티브 동기화
        document.querySelectorAll('.mobile-preset-chip').forEach(btn => {
            btn.classList.toggle('active', btn.textContent.trim() === this.getPresetLabel(this.currentDatePreset));
            btn.classList.toggle('btn-primary', btn.textContent.trim() === this.getPresetLabel(this.currentDatePreset));
            btn.classList.toggle('btn-outline-secondary', btn.textContent.trim() !== this.getPresetLabel(this.currentDatePreset));
        });
    },

    getPresetLabel: function(preset) {
        const map = { 'all': '전체', 'thisMonth': '당월', 'prevMonth': '전월', 'thisYear': '금년도', 'prevYear': '전년도' };
        return map[preset] || '전체';
    },

    updateMobileFilterFromDesktop: function() {
        this.updateMobileDateInputs();
        if ($('mobileSearchTarget') && $('searchTarget')) {
            $('mobileSearchTarget').value = $('searchTarget').value;
        }
        if ($('mobileLimitSelect') && $('historyLimit')) {
            $('mobileLimitSelect').value = $('historyLimit').value;
        }
        if ($('mobileSearchInput') && $('historySearch')) {
            $('mobileSearchInput').value = $('historySearch').value;
            const clearBtn = $('mobileClearSearchBtn');
            if (clearBtn) {
                if ($('historySearch').value) clearBtn.classList.remove('d-none');
                else clearBtn.classList.add('d-none');
            }
        }
    },

    syncMobileDatesToDesktop: function() {
        if ($('searchStartDate') && $('mobileStartDate')) {
            $('searchStartDate').value = $('mobileStartDate').value;
        }
        if ($('searchEndDate') && $('mobileEndDate')) {
            $('searchEndDate').value = $('mobileEndDate').value;
        }
    },

    syncMobileTargetToDesktop: function() {
        if ($('searchTarget') && $('mobileSearchTarget')) {
            $('searchTarget').value = $('mobileSearchTarget').value;
        }
    },

    syncMobileLimitToDesktop: function() {
        if ($('historyLimit') && $('mobileLimitSelect')) {
            $('historyLimit').value = $('mobileLimitSelect').value;
        }
    }
};

window.app = app;

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

