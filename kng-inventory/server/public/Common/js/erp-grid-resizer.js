/**
 * ═══════════════════════════════════════════════════════════════
 * KNG ERP High-Density Grid Column Resizer & Auto-Fit Engine (V2)
 * - 단일 행 헤더 및 2단(Multi-row) 그룹 헤더 완벽 지원
 * - 마우스 드래그 실시간 열 너비 조절 & 엑셀식 세로 가이드라인
 * - localStorage 사용자 설정 너비 영구 저장 및 자동 복원
 * - 더블 클릭 시 데이터 길이 기준 스마트 자동 맞춤(Auto-Fit)
 * - 전역 함수(window.ErpGridResizer, window.setupErpGridResizer) 100% 호환
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
        ctx.font = font || '12px "Pretendard", "Noto Sans KR", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        return ctx.measureText(text).width;
    }

    // 2단 헤더를 포함하여 각 열의 실제 최하위 말단(Leaf) <th> 셀들을 순서대로 추출
    function getLeafHeaderCells(thead) {
        const rows = Array.from(thead.rows);
        if (rows.length === 0) return [];
        if (rows.length === 1) return Array.from(rows[0].cells);

        const leafThs = [];
        const firstRowCells = Array.from(rows[0].cells);
        const secondRowCells = Array.from(rows[1].cells);

        let secondRowIdx = 0;
        firstRowCells.forEach(cell => {
            const colSpan = parseInt(cell.getAttribute('colspan') || cell.colSpan, 10) || 1;
            if (colSpan > 1) {
                for (let i = 0; i < colSpan; i++) {
                    if (secondRowCells[secondRowIdx]) {
                        leafThs.push(secondRowCells[secondRowIdx]);
                        secondRowIdx++;
                    }
                }
            } else {
                leafThs.push(cell);
            }
        });

        // 혹시 2행에 남은 셀이 있다면 추가
        while (secondRowIdx < secondRowCells.length) {
            leafThs.push(secondRowCells[secondRowIdx]);
            secondRowIdx++;
        }

        return leafThs;
    }

    const ErpGridResizer = {
        instances: {},

        init: function(tableId, options = {}) {
            const table = typeof tableId === 'string' ? document.getElementById(tableId) : tableId;
            if (!table) return null;

            const actualId = table.id || ('grid_' + Math.random().toString(36).substr(2, 9));
            table.id = actualId;

            const storageKey = options.storageKey || `kng_grid_${actualId}_widths`;
            const thead = table.querySelector('thead');
            if (!thead) return null;

            const ths = getLeafHeaderCells(thead);
            if (ths.length === 0) return null;

            // 1. colgroup 생성 또는 재구성 (말단 th 개수와 1:1 동기화)
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

            // 2. 원본 너비 속성 캐싱
            ths.forEach((th, idx) => {
                if (!th.hasAttribute('data-original-width')) {
                    const colW = cols[idx] && cols[idx].style.width;
                    const inlineW = th.style.width || th.getAttribute('width') || colW;
                    th.setAttribute('data-original-width', inlineW || (th.getBoundingClientRect().width + 'px'));
                }
            });

            // 3. 저장된 너비 복원
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
                        const w = parseFloat(c.style.width) || (ths[idx] ? ths[idx].getBoundingClientRect().width : 80);
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

            // 저장된 너비가 없으면 현재 너비로 초기 동기화
            if (!loadSavedWidths()) {
                if (table.offsetWidth > 0) {
                    syncColWidths();
                }
            }

            // 4. 열별 리사이저 핸들러 생성 및 이벤트 바인딩
            ths.forEach((th, colIdx) => {
                if (options.ignoreLastCol && colIdx === ths.length - 1) return;

                th.style.position = 'relative';
                th.style.overflow = 'visible';

                let resizer = th.querySelector('.col-resizer');
                if (!resizer) {
                    resizer = document.createElement('div');
                    resizer.className = 'col-resizer';
                    resizer.setAttribute('title', '드래그: 열 너비 직접 조절 / 더블클릭: 자동 너비 맞춤');
                    th.appendChild(resizer);
                }

                // 헤더 클릭 이벤트(정렬 등) 전파 방지
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
                    const minW = colIdx === 0 ? 28 : (options.minColWidth || 36);
                    const newW = Math.max(minW, Math.round(startWidth + diff));

                    if (cols[colIdx]) cols[colIdx].style.width = newW + 'px';
                    if (ths[colIdx]) ths[colIdx].style.width = newW + 'px';

                    let total = 0;
                    cols.forEach(c => {
                        total += parseFloat(c.style.width) || 60;
                    });
                    table.style.setProperty('width', total + 'px', 'important');
                };

                const onMouseUp = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    resizer.classList.remove('is-resizing');
                    document.body.classList.remove('erp-resizing');
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
                    document.body.classList.add('erp-resizing');
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
                    const headerFont = 'bold 11.5px "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    let maxW = measureTextWidth(headerText, headerFont) + 16;

                    // 2. 본문 셀 텍스트 너비 측정
                    const cellFont = '11.5px "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                    const tbody = table.querySelector('tbody');
                    if (tbody) {
                        const rows = tbody.querySelectorAll('tr');
                        rows.forEach(row => {
                            if (row.classList.contains('loading-row') || row.querySelector('td[colspan]')) return;

                            const cell = row.cells[colIdx];
                            if (!cell || cell.colSpan > 1) return;

                            let text = cell.innerText ? cell.innerText.replace(/\n/g, ' ').trim() : cell.textContent.trim();
                            if (text) {
                                const w = measureTextWidth(text, cellFont);
                                if (w > maxW) maxW = w;
                            }
                        });
                    }

                    // 3. 여유 패딩 포함 타겟 너비
                    const minW = colIdx === 0 ? 28 : (options.minColWidth || 40);
                    const targetW = Math.max(minW, Math.round(maxW + 16));

                    if (cols[colIdx]) cols[colIdx].style.width = targetW + 'px';
                    if (ths[colIdx]) ths[colIdx].style.width = targetW + 'px';

                    let total = 0;
                    cols.forEach(c => {
                        total += parseFloat(c.style.width) || 60;
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

        sync: function(tableId, options) {
            return this.init(tableId, options);
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

    // 전역 노출 및 호환성 래퍼 함수 바인딩
    window.ErpGridResizer = ErpGridResizer;
    window.setupErpGridResizer = function(tableId, options) {
        return ErpGridResizer.init(tableId, options);
    };
    window.resetErpGridColumnWidths = function(tableId) {
        return ErpGridResizer.resetWidths(tableId);
    };
    window.autoFitErpGridColumns = function(tableId) {
        return ErpGridResizer.autoFitAll(tableId);
    };

})(window);
