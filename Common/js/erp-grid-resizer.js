/**
 * ═══════════════════════════════════════════════════════════════
 * KNG ERP High-Density Grid Column Resizer & Auto-Fit Engine
 * ═══════════════════════════════════════════════════════════════
 */

(function(window) {
    'use strict';

    let measureCanvas = null;
    function measureTextWidth(text, font) {
        if (!measureCanvas) {
            measureCanvas = document.createElement('canvas');
        }
        const ctx = measureCanvas.getContext('2d');
        ctx.font = font || '12px "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        return ctx.measureText(text).width;
    }

    const ErpGridResizer = {
        instances: {},

        init: function(tableId, options = {}) {
            const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
            if (!table) return null;

            const actualId = table.id || ('grid_' + Math.random().toString(36).substr(2, 9));
            table.id = actualId;

            const storageKey = options.storageKey || `kng_grid_${actualId}_widths`;
            const wrapper = table.closest('.erp-grid-wrapper') || table.parentElement;

            const thead = table.querySelector('thead');
            if (!thead) return null;

            const headerRow = thead.rows[0];
            if (!headerRow) return null;

            const ths = Array.from(headerRow.cells);
            if (ths.length === 0) return null;

            // 원본 너비 속성 캐싱
            ths.forEach(th => {
                if (!th.hasAttribute('data-original-width')) {
                    const inlineW = th.style.width || th.getAttribute('width');
                    th.setAttribute('data-original-width', inlineW || (th.getBoundingClientRect().width + 'px'));
                }
            });

            // 1. colgroup 생성 또는 재구성
            let colgroup = table.querySelector('colgroup');
            if (!colgroup) {
                colgroup = document.createElement('colgroup');
                ths.forEach(() => {
                    colgroup.appendChild(document.createElement('col'));
                });
                table.insertBefore(colgroup, table.firstChild);
            } else {
                while (colgroup.children.length < ths.length) {
                    colgroup.appendChild(document.createElement('col'));
                }
                while (colgroup.children.length > ths.length) {
                    colgroup.removeChild(colgroup.lastChild);
                }
            }
            const cols = Array.from(colgroup.querySelectorAll('col'));

            // 2. 저장된 너비 복원
            const loadSavedWidths = () => {
                try {
                    const saved = localStorage.getItem(storageKey);
                    if (saved) {
                        const widths = JSON.parse(saved);
                        if (Array.isArray(widths) && widths.length === ths.length) {
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

            const saveTableWidths = () => {
                try {
                    const widths = cols.map((c, idx) => {
                        const w = parseFloat(c.style.width) || ths[idx].getBoundingClientRect().width;
                        return Math.round(w);
                    });
                    localStorage.setItem(storageKey, JSON.stringify(widths));
                } catch (err) {}
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

            // 3. 열별 리사이저 핸들러 생성 및 이벤트 바인딩
            ths.forEach((th, colIdx) => {
                // 마지막 관리/삭제 버튼 열 예외 처리 가능
                if (options.ignoreLastCol && colIdx === ths.length - 1) return;

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

                // 부모 th의 클릭 이벤트(정렬 등) 전파 차단
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
                    const minW = colIdx === 0 ? 32 : (options.minColWidth || 40);
                    const newW = Math.max(minW, Math.round(startWidth + diff));

                    if (cols[colIdx]) cols[colIdx].style.width = newW + 'px';
                    if (ths[colIdx]) ths[colIdx].style.width = newW + 'px';

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

                // 더블클릭 시 데이터 길이에 맞춰 자동 너비 맞춤 (Auto-Fit)
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
                            // 아코디언 서브 로우 및 colspan 행 예외 처리
                            if (row.classList.contains('accordion-sub-row') || 
                                row.classList.contains('collapse') || 
                                row.querySelector('td[colspan]')) return;

                            // 2행 구조(정산 화면 등)인 경우 colIdx 맵핑 안전 조회
                            const cell = row.cells[colIdx];
                            if (!cell || cell.colSpan > 1) return;

                            let text = '';
                            const input = cell.querySelector('input');
                            const select = cell.querySelector('select');
                            const btn = cell.querySelector('button');

                            if (input && input.type !== 'checkbox' && input.type !== 'radio') {
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
                                if (cell.querySelector('.accordion-icon')) w += 20;
                                if (cell.querySelector('.badge')) w += 16;
                                if (w > maxW) maxW = w;
                            }
                        });
                    }

                    // 3. 패딩 + 여유 공간 포함 타겟 너비 계산
                    const minW = colIdx === 0 ? 32 : (options.minColWidth || 44);
                    const targetW = Math.max(minW, Math.round(maxW + (options.extraPadding || 20)));

                    if (cols[colIdx]) cols[colIdx].style.width = targetW + 'px';
                    if (ths[colIdx]) ths[colIdx].style.width = targetW + 'px';

                    let total = 0;
                    cols.forEach(c => {
                        total += parseFloat(c.style.width) || 50;
                    });
                    table.style.setProperty('width', total + 'px', 'important');
                    saveTableWidths();
                };
            });

            const instance = {
                table,
                storageKey,
                autoFitAll: function() {
                    const resizers = thead.querySelectorAll('.col-resizer');
                    resizers.forEach(r => {
                        if (r.ondblclick) {
                            r.ondblclick(new MouseEvent('dblclick', { bubbles: false, cancelable: true }));
                        }
                    });
                },
                resetWidths: function() {
                    try {
                        localStorage.removeItem(storageKey);
                    } catch (e) {}
                    if (colgroup) colgroup.remove();
                    table.style.width = '';
                    ths.forEach(th => {
                        const originalW = th.getAttribute('data-original-width');
                        if (originalW) th.style.width = originalW;
                    });
                    ErpGridResizer.init(actualId, options);
                }
            };

            ErpGridResizer.instances[actualId] = instance;
            return instance;
        },

        autoFitAll: function(tableId) {
            const inst = ErpGridResizer.instances[tableId];
            if (inst) {
                inst.autoFitAll();
            } else {
                const table = document.getElementById(tableId);
                if (table) {
                    const thead = table.querySelector('thead');
                    if (thead) {
                        thead.querySelectorAll('.col-resizer').forEach(r => {
                            if (r.ondblclick) r.ondblclick(new MouseEvent('dblclick', { bubbles: false, cancelable: true }));
                        });
                    }
                }
            }
        },

        resetWidths: function(tableId) {
            const inst = ErpGridResizer.instances[tableId];
            if (inst) {
                inst.resetWidths();
            } else {
                const table = document.getElementById(tableId);
                if (table) {
                    const storageKey = `kng_grid_${tableId}_widths`;
                    try { localStorage.removeItem(storageKey); } catch (e) {}
                    const colgroup = table.querySelector('colgroup');
                    if (colgroup) colgroup.remove();
                    table.style.width = '';
                    ErpGridResizer.init(tableId);
                }
            }
        }
    };

    window.ErpGridResizer = ErpGridResizer;

})(window);
