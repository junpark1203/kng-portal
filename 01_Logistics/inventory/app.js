/**
 * 실시간 재고 현황 프론트엔드 모듈 (Inventory ECOUNT ERP Engine)
 * - ECOUNT ERP 고밀도 디자인 시스템 및 10개 최적 컬럼 지원
 * - 스마트 다중 교집합(AND) 검색 및 결과 내 2차 재검색
 * - 자재 분류 퀵 필터 탭 (전체/안전자재/토목자재/보양재/소모품/일반자재)
 * - Lot별 상세 아코디언 서브테이블
 * - 실시간 엑셀 다운로드 (SheetJS) 및 A4 인쇄 서식 지원
 * - ERP 그리드 열 너비 마우스 드래그 조절 & 자동맞춤
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

// ── Auth 헬퍼 ──
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
                        else { _authReady = null; res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = null; res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = null; res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = null; res(null); }
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
    if (!token) {
        try { token = localStorage.getItem('kng_token') || sessionStorage.getItem('kng_token'); } catch(e) {}
    }
    
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    options.headers['Content-Type'] = 'application/json';
    
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return res.json();
}

const $ = id => document.getElementById(id);

const app = {
    inventoryData: [],
    currentFilteredData: [],
    activeCategory: '',
    searchTarget: '',
    searchKeyword: '',
    subSearchKeyword: '',
    expandedIndices: new Set(),
    searchDebounceTimer: null,

    init: async function() {
        this.bindEvents();
        await this.loadInventory();
    },

    bindEvents: function() {
        const historySearch = $('historySearch');
        if (historySearch) {
            historySearch.addEventListener('input', (e) => {
                const val = e.target.value;
                const clearBtn = $('clearSearchBtn');
                if (clearBtn) {
                    if (val.length > 0) clearBtn.classList.remove('d-none');
                    else clearBtn.classList.add('d-none');
                }
                // 실시간 반응형 검색 (디바운스 150ms)
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchKeyword = val.trim();
                    this.applyFilterAndRender();
                }, 150);
            });
        }
    },

    loadInventory: async function() {
        try {
            const rawData = await authFetch(`${API_BASE}/inventory`);
            
            // 데이터 보강 (Category, Latest Date, Location Summary, Lot Count)
            this.inventoryData = (rawData || []).map(row => {
                const lots = row.lots || [];
                
                // 1. 카테고리 추출 (직접 category 우선, 없으면 lot 내부 탐색, 없으면 기본값)
                let category = row.category;
                if (!category) {
                    const foundCat = lots.find(l => l.category && l.category.trim());
                    category = foundCat ? foundCat.category.trim() : '일반자재';
                }

                // 2. 최종 입고일자 추출
                let latestDate = row.latest_date;
                if (!latestDate && lots.length > 0) {
                    const dates = lots.map(l => l.date).filter(Boolean).sort();
                    latestDate = dates[dates.length - 1] || '-';
                }
                if (!latestDate) latestDate = '-';

                // 3. 보관 위치 요약
                const locNames = [...new Set(lots.map(l => l.location_name).filter(Boolean))];
                let locationSummary = '-';
                if (locNames.length === 1) {
                    locationSummary = locNames[0];
                } else if (locNames.length > 1) {
                    locationSummary = `${locNames[0]} 외 ${locNames.length - 1}곳`;
                }

                return {
                    ...row,
                    category: category,
                    latest_date: latestDate,
                    location_summary: locationSummary,
                    locations: locNames,
                    lot_count: lots.length
                };
            });

            this.applyFilterAndRender();
        } catch (e) {
            console.error(e);
            $('inventoryTbody').innerHTML = `<tr><td colspan="10" class="text-center text-danger py-4">데이터를 불러오는 중 오류가 발생했습니다.<br>${e.message}</td></tr>`;
        }
    },

    setCategoryFilter: function(category) {
        this.activeCategory = category || '';
        
        // 탭 UI 활성화 클래스 갱신
        const tabBtns = document.querySelectorAll('#categoryTabGroup .erp-tab-btn');
        tabBtns.forEach(btn => {
            const cat = btn.getAttribute('data-category') || '';
            if (cat === this.activeCategory) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        this.applyFilterAndRender();
    },

    onSearchTargetChange: function() {
        this.searchTarget = $('searchTarget') ? $('searchTarget').value : '';
        if (this.searchKeyword) {
            this.applyFilterAndRender();
        }
    },

    onSearchInputKeyup: function(e) {
        if (e.key === 'Enter') {
            clearTimeout(this.searchDebounceTimer);
            this.search();
        }
    },

    clearSearchInput: function() {
        const input = $('historySearch');
        if (input) input.value = '';
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.searchKeyword = '';
        this.applyFilterAndRender();
    },

    onSubSearchInput: function(val) {
        this.subSearchKeyword = (val || '').trim();
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) {
            if (this.subSearchKeyword.length > 0) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        this.applyFilterAndRender();
    },

    clearSubSearch: function() {
        const input = $('subSearchInput');
        if (input) input.value = '';
        const clearBtn = $('clearSubSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.subSearchKeyword = '';
        this.applyFilterAndRender();
    },

    search: function() {
        const input = $('historySearch');
        this.searchKeyword = input ? input.value.trim() : '';
        this.applyFilterAndRender();
    },

    resetSearch: function() {
        this.activeCategory = '';
        this.searchTarget = '';
        this.searchKeyword = '';
        this.subSearchKeyword = '';

        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('historySearch')) $('historySearch').value = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        const clearSubBtn = $('clearSubSearchBtn');
        if (clearSubBtn) clearSubBtn.classList.add('d-none');

        // 자재분류 탭 초기화
        const tabBtns = document.querySelectorAll('#categoryTabGroup .erp-tab-btn');
        tabBtns.forEach(btn => {
            if ((btn.getAttribute('data-category') || '') === '') btn.classList.add('active');
            else btn.classList.remove('active');
        });

        this.applyFilterAndRender();
    },

    applyFilterAndRender: function() {
        let result = this.inventoryData;

        // 1. 자재 분류 필터링
        if (this.activeCategory) {
            result = result.filter(r => (r.category || '').includes(this.activeCategory));
        }

        // 2. 스마트 다중 검색 (공백 구분 AND 교집합 검색)
        if (this.searchKeyword) {
            const tokens = this.searchKeyword.toLowerCase().split(/\s+/).filter(Boolean);
            result = result.filter(row => {
                return tokens.every(token => {
                    if (this.searchTarget === 'item') {
                        return (row.item || '').toLowerCase().includes(token);
                    } else if (this.searchTarget === 'spec') {
                        return (row.spec || '').toLowerCase().includes(token);
                    } else if (this.searchTarget === 'location') {
                        return (row.location_summary || '').toLowerCase().includes(token) ||
                               (row.lots && row.lots.some(l => (l.location_name || '').toLowerCase().includes(token)));
                    } else if (this.searchTarget === 'supplier') {
                        return row.lots && row.lots.some(l => (l.supplier || '').toLowerCase().includes(token));
                    } else {
                        // 전체 대상 검색
                        const inItem = (row.item || '').toLowerCase().includes(token);
                        const inSpec = (row.spec || '').toLowerCase().includes(token);
                        const inUnit = (row.unit || '').toLowerCase().includes(token);
                        const inCat = (row.category || '').toLowerCase().includes(token);
                        const inLoc = (row.location_summary || '').toLowerCase().includes(token);
                        const inLots = row.lots && row.lots.some(l => 
                            (l.supplier || '').toLowerCase().includes(token) ||
                            (l.location_name || '').toLowerCase().includes(token) ||
                            (l.note || '').toLowerCase().includes(token)
                        );
                        return inItem || inSpec || inUnit || inCat || inLoc || inLots;
                    }
                });
            });
        }

        // 3. 결과 내 재검색 (2차 보조 필터)
        if (this.subSearchKeyword) {
            const subToken = this.subSearchKeyword.toLowerCase();
            result = result.filter(row => {
                const inItem = (row.item || '').toLowerCase().includes(subToken);
                const inSpec = (row.spec || '').toLowerCase().includes(subToken);
                const inLoc = (row.location_summary || '').toLowerCase().includes(subToken);
                const inUnit = (row.unit || '').toLowerCase().includes(subToken);
                return inItem || inSpec || inLoc || inUnit;
            });
        }

        this.currentFilteredData = result;
        this.renderTable(result);
    },

    getCategoryPillHtml: function(cat) {
        if (!cat || cat === '-') return '<span class="text-muted">-</span>';
        let cls = 'cat-general';
        if (cat.includes('안전')) cls = 'cat-safety';
        else if (cat.includes('토목')) cls = 'cat-civil';
        else if (cat.includes('보양')) cls = 'cat-protect';
        else if (cat.includes('소모')) cls = 'cat-consum';
        return `<span class="category-pill ${cls}">${cat}</span>`;
    },

    toggleLotRow: function(index) {
        const subRow = document.getElementById(`lotSubRow_${index}`);
        const icon = document.getElementById(`accIcon_${index}`);
        const mainRow = document.getElementById(`mainRow_${index}`);

        if (!subRow) return;

        const isHidden = subRow.classList.contains('d-none');
        if (isHidden) {
            subRow.classList.remove('d-none');
            if (icon) icon.classList.add('rotate-90');
            if (mainRow) mainRow.classList.add('row-expanded');
            this.expandedIndices.add(index);
        } else {
            subRow.classList.add('d-none');
            if (icon) icon.classList.remove('rotate-90');
            if (mainRow) mainRow.classList.remove('row-expanded');
            this.expandedIndices.delete(index);
        }
    },

    renderTable: function(data) {
        const tbody = $('inventoryTbody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">일치하는 재고 내역이 없습니다.</td></tr>`;
            if ($('skuCountBadge')) $('skuCountBadge').innerText = `관리 0 SKU`;
            if ($('totalQtyBadge')) $('totalQtyBadge').innerText = `총 재고: 0개`;
            if ($('inventoryTfoot')) $('inventoryTfoot').classList.add('d-none');
            return;
        }

        // 통계 집계
        const totalSku = data.length;
        const totalQty = data.reduce((acc, cur) => acc + (Number(cur.total_qty) || 0), 0);

        if ($('skuCountBadge')) $('skuCountBadge').innerText = `관리 ${totalSku.toLocaleString()} SKU`;
        if ($('totalQtyBadge')) $('totalQtyBadge').innerText = `총 재고: ${totalQty.toLocaleString()}개`;

        if ($('inventoryTfoot')) {
            $('inventoryTfoot').classList.remove('d-none');
            if ($('footSkuSummary')) $('footSkuSummary').innerText = `총 ${totalSku.toLocaleString()}개 품목`;
            if ($('footQtySummary')) $('footQtySummary').innerText = totalQty.toLocaleString();
        }

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = data.map((row, index) => {
            const isExpanded = this.expandedIndices.has(index);

            // Lot 상세 행 구성
            let lotRows = '';
            if (row.lots && row.lots.length > 0) {
                lotRows = row.lots.map(lot => `
                    <tr>
                        <td class="text-center text-muted" style="width: 85px;">${lot.date || '-'}</td>
                        <td class="text-start ps-2" style="width: 120px;">${escapeAttr(lot.location_name || '-')}</td>
                        <td class="text-start ps-2" style="width: 140px;">${escapeAttr(lot.supplier || '-')}</td>
                        <td class="text-end pe-2" style="width: 100px;">${Number(lot.unit_price || 0).toLocaleString()} ₩</td>
                        <td class="text-end pe-2 fw-bold text-primary" style="width: 90px;">${Number(lot.qty_remaining || 0).toLocaleString()}</td>
                        <td class="text-start ps-2 text-muted">${escapeAttr(lot.note || '')}</td>
                    </tr>
                `).join('');
            }

            return `
                <!-- 메인 품목 행 (10개 컬럼 ERP 시트 규격) -->
                <tr class="inventory-row ${isExpanded ? 'row-expanded' : ''}" id="mainRow_${index}" onclick="app.toggleLotRow(${index})" title="클릭하여 Lot별 상세 입고 내역을 확인합니다">
                    <td class="text-center td-toggle"><i class='bx bx-chevron-right accordion-icon ${isExpanded ? 'rotate-90' : ''}' id="accIcon_${index}"></i></td>
                    <td class="row-index">${index + 1}</td>
                    <td class="text-center">${this.getCategoryPillHtml(row.category)}</td>
                    <td class="ps-2 fw-bold text-dark text-truncate" title="${escapeAttr(row.item)}">${row.item}</td>
                    <td class="ps-2 text-secondary text-truncate" title="${escapeAttr(row.spec || '-')}">${row.spec || '-'}</td>
                    <td class="text-center text-secondary">${row.unit || '-'}</td>
                    <td class="ps-2 text-secondary text-truncate" title="${escapeAttr(row.location_summary)}">${row.location_summary}</td>
                    <td class="text-center"><span class="badge bg-light text-secondary border px-1">${row.lot_count}건</span></td>
                    <td class="text-center text-muted">${row.latest_date || '-'}</td>
                    <td class="td-qty pe-3">${Number(row.total_qty || 0).toLocaleString()}</td>
                </tr>
                <!-- 상세 Lot 아코디언 행 -->
                <tr class="accordion-sub-row ${isExpanded ? '' : 'd-none'}" id="lotSubRow_${index}">
                    <td colspan="10" class="p-0 border-0">
                        <div class="lot-container-box">
                            <div class="d-flex align-items-center justify-content-between mb-1">
                                <div class="fw-bold text-secondary" style="font-size: 11px;">
                                    <i class='bx bx-history text-primary'></i> 입고일자별 잔여 내역 (Lot 관리)
                                </div>
                                <div class="small text-muted" style="font-size: 10.5px;">
                                    총 ${row.lots ? row.lots.length : 0}개 Lot 보유 (잔여합계: ${Number(row.total_qty || 0).toLocaleString()} ${row.unit || ''})
                                </div>
                            </div>
                            <table class="lot-sub-table shadow-sm">
                                <thead>
                                    <tr>
                                        <th style="width: 85px;">입고일자</th>
                                        <th style="width: 120px;" class="text-start ps-2">보관 위치</th>
                                        <th style="width: 140px;" class="text-start ps-2">매입처</th>
                                        <th style="width: 100px;" class="text-end pe-2">매입단가</th>
                                        <th style="width: 90px;" class="text-end pe-2">잔여수량</th>
                                        <th class="text-start ps-2">비고</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${lotRows || '<tr><td colspan="6" class="text-center py-2 text-muted">등록된 Lot 상세 내역이 없습니다.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // ERP 그리드 리사이저 초기화/동기화
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('inventoryTable', { storageKey: 'kng_inventory_grid_widths_v2' });
        }
    },

    exportExcel: function() {
        if (!this.currentFilteredData || this.currentFilteredData.length === 0) {
            alert('내보낼 재고 데이터가 없습니다.');
            return;
        }

        if (typeof XLSX === 'undefined') {
            alert('엑셀 생성 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
            return;
        }

        const headers = ['No.', '자재분류', '품목명', '규격', '단위', '보관 위치', 'Lot 수', '최종 입고일', '총 재고수량'];
        const rows = this.currentFilteredData.map((row, idx) => [
            idx + 1,
            row.category || '-',
            row.item || '',
            row.spec || '-',
            row.unit || '-',
            row.location_summary || '-',
            row.lot_count || 0,
            row.latest_date || '-',
            Number(row.total_qty || 0)
        ]);

        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws['!cols'] = [
            { wch: 6 },  // No
            { wch: 12 }, // 자재분류
            { wch: 28 }, // 품목명
            { wch: 18 }, // 규격
            { wch: 8 },  // 단위
            { wch: 16 }, // 보관 위치
            { wch: 8 },  // Lot 수
            { wch: 12 }, // 최종 입고일
            { wch: 14 }  // 총 재고수량
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '실시간재고');

        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        XLSX.writeFile(wb, `KNG_통합물류_실시간재고_${y}${m}${d}.xlsx`);
    },

    printPage: function() {
        window.print();
    }
};

window.app = app;

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
