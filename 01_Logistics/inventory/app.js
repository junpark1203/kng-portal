/**
 * 실시간 재고 현황 프론트엔드 모듈 (Inventory ECOUNT ERP Engine)
 * - ECOUNT ERP 고밀도 디자인 시스템 및 10개 최적 컬럼 지원
 * - 모바일 특화 반응형 카드 뷰 (Mobile Card List ↔ ERP Table View 듀얼 모드)
 * - 가로 스와이프 카테고리 칩 바 (터치 제스처 + 마우스 드래그 & 휠 스크롤)
 * - 실시간 Lot별 상세 입고 내역 아코디언 서브테이블 & 모바일 미니카드
 * - 스마트 다중 교집합(AND) 검색 및 결과 내 2차 재검색
 * - 모바일 하단 슬라이드업 필터 바텀시트 (Bottom Sheet)
 * - 실시간 엑셀 다운로드 (SheetJS) 및 A4 인쇄 서식 지원
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
    allCategories: [],
    activeCategory: '',
    searchTarget: '',
    searchKeyword: '',
    subSearchKeyword: '',
    stockFilter: 'all', // 'all' | 'in_stock' | 'out_of_stock'
    currentViewMode: 'card',
    expandedIndices: new Set(),
    searchDebounceTimer: null,

    init: async function() {
        this.initViewMode();
        this.bindEvents();
        await this.loadInventory();
    },

    initViewMode: function() {
        const isMobile = window.innerWidth <= 768;
        const savedMode = localStorage.getItem('kng_inventory_view_mode');
        this.currentViewMode = savedMode || (isMobile ? 'card' : 'table');
        this.applyViewMode();
    },

    setViewMode: function(mode) {
        this.currentViewMode = mode;
        localStorage.setItem('kng_inventory_view_mode', mode);
        this.applyViewMode();
    },

    applyViewMode: function() {
        const isMobile = window.innerWidth <= 768;
        const savedMode = localStorage.getItem('kng_inventory_view_mode');
        const mode = this.currentViewMode || savedMode || (isMobile ? 'card' : 'table');

        const cardsContainer = $('inventoryCardsContainer');
        const tableWrapper = $('inventoryGridWrapper');
        const btnCard = $('btnViewCard');
        const btnTable = $('btnViewTable');

        if (mode === 'card') {
            if (cardsContainer) cardsContainer.classList.remove('mobile-hidden-cards');
            if (tableWrapper) tableWrapper.classList.add('mobile-hidden-table');
            if (btnCard) btnCard.classList.add('active');
            if (btnTable) btnTable.classList.remove('active');
        } else {
            if (cardsContainer) cardsContainer.classList.add('mobile-hidden-cards');
            if (tableWrapper) tableWrapper.classList.remove('mobile-hidden-table');
            if (btnCard) btnCard.classList.remove('active');
            if (btnTable) btnTable.classList.add('active');
        }
    },

    bindEvents: function() {
        // 데스크톱 검색창 실시간 검색 바인딩
        const historySearch = $('historySearch');
        if (historySearch) {
            historySearch.addEventListener('input', (e) => {
                const val = e.target.value;
                const clearBtn = $('clearSearchBtn');
                if (clearBtn) {
                    if (val.length > 0) clearBtn.classList.remove('d-none');
                    else clearBtn.classList.add('d-none');
                }
                clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchKeyword = val.trim();
                    if ($('mobileSearchInput')) $('mobileSearchInput').value = this.searchKeyword;
                    this.applyFilterAndRender();
                }, 150);
            });
        }

        // 창 크기 변경 시 뷰 모드 자동 적용
        window.addEventListener('resize', () => {
            this.applyViewMode();
        });
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

        el.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);

        el.addEventListener('wheel', (e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
                e.preventDefault();
                el.scrollLeft += (e.deltaY * 0.8);
            }
        }, { passive: false });
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

            // 전체 카테고리 목록 추출 (가나다순 정렬)
            const rawCats = [...new Set(this.inventoryData.map(r => r.category).filter(Boolean))];
            this.allCategories = rawCats.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));

            // 모바일 필터 드로어 카테고리 셀렉트 옵션 채우기
            const drawerCatSelect = $('mobileFilterCategory');
            if (drawerCatSelect) {
                drawerCatSelect.innerHTML = `<option value="">전체 분류</option>` + 
                    this.allCategories.map(c => `<option value="${c}">${c}</option>`).join('');
            }

            this.renderCategoryChips();
            this.applyFilterAndRender();
        } catch (e) {
            console.error(e);
            $('inventoryTbody').innerHTML = `<tr><td colspan="10" class="text-center text-danger py-4">데이터를 불러오는 중 오류가 발생했습니다.<br>${e.message}</td></tr>`;
            if ($('inventoryCardsContainer')) {
                $('inventoryCardsContainer').innerHTML = `<div class="p-4 text-center text-danger">재고 데이터를 불러오는 중 오류가 발생했습니다.<br>${e.message}</div>`;
            }
        }
    },

    renderCategoryChips: function() {
        // 1. 데스크톱 자재분류 탭 그룹 갱신
        const desktopGroup = $('categoryTabGroup');
        if (desktopGroup) {
            desktopGroup.innerHTML = `
                <button type="button" class="erp-tab-btn ${!this.activeCategory ? 'active' : ''}" data-category="" onclick="app.setCategoryFilter('')">전체</button>
                ${this.allCategories.map(c => `
                    <button type="button" class="erp-tab-btn ${this.activeCategory === c ? 'active' : ''}" data-category="${c}" onclick="app.setCategoryFilter('${c}')">${c}</button>
                `).join('')}
            `;
        }

        // 2. 모바일 가로 스와이프 칩 트랙 갱신
        const mobileTrack = $('mobileCategoryScrollTrack');
        if (mobileTrack) {
            mobileTrack.innerHTML = `
                <button type="button" class="btn btn-sm ${!this.activeCategory ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3 flex-shrink-0" onclick="app.setCategoryFilter('')">
                    전체보기
                </button>
                ${this.allCategories.map(c => `
                    <button type="button" class="btn btn-sm ${this.activeCategory === c ? 'btn-primary text-white shadow-sm fw-bold' : 'btn-outline-secondary'} rounded-pill px-3 flex-shrink-0" onclick="app.setCategoryFilter('${c}')">
                        ${c}
                    </button>
                `).join('')}
            `;
            this.enableDragToScroll(mobileTrack);
            const activeBtn = mobileTrack.querySelector('.btn-primary');
            if (activeBtn) {
                setTimeout(() => {
                    activeBtn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                }, 60);
            }
        }
    },

    setCategoryFilter: function(category) {
        this.activeCategory = category || '';
        
        // 탭 UI 활성화 클래스 동기화
        const tabBtns = document.querySelectorAll('#categoryTabGroup .erp-tab-btn');
        tabBtns.forEach(btn => {
            const cat = btn.getAttribute('data-category') || '';
            if (cat === this.activeCategory) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        // 모바일 칩 바 UI 동기화
        const mobileBtns = document.querySelectorAll('#mobileCategoryScrollTrack .btn');
        mobileBtns.forEach(btn => {
            const text = btn.innerText.trim();
            const isMatch = (!this.activeCategory && text === '전체보기') || (text === this.activeCategory);
            if (isMatch) {
                btn.className = 'btn btn-sm btn-primary text-white shadow-sm fw-bold rounded-pill px-3 flex-shrink-0';
                btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
            } else {
                btn.className = 'btn btn-sm btn-outline-secondary rounded-pill px-3 flex-shrink-0';
            }
        });

        if ($('mobileFilterCategory')) {
            $('mobileFilterCategory').value = this.activeCategory;
        }

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
        if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
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
        if ($('mobileSearchInput')) $('mobileSearchInput').value = this.searchKeyword;
        this.applyFilterAndRender();
    },

    resetSearch: function() {
        this.activeCategory = '';
        this.searchTarget = '';
        this.searchKeyword = '';
        this.subSearchKeyword = '';
        this.stockFilter = 'all';

        if ($('searchTarget')) $('searchTarget').value = '';
        if ($('historySearch')) $('historySearch').value = '';
        if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
        if ($('subSearchInput')) $('subSearchInput').value = '';
        
        const clearBtn = $('clearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        const clearSubBtn = $('clearSubSearchBtn');
        if (clearSubBtn) clearSubBtn.classList.add('d-none');
        const mobileClearBtn = $('mobileClearSearchBtn');
        if (mobileClearBtn) mobileClearBtn.classList.add('d-none');

        this.renderCategoryChips();
        this.applyFilterAndRender();
    },

    submitMobileSearch: function() {
        const input = $('mobileSearchInput');
        const val = input ? input.value.trim() : '';
        this.searchKeyword = val;
        if ($('historySearch')) $('historySearch').value = val;
        
        const clearBtn = $('mobileClearSearchBtn');
        if (clearBtn) {
            if (val.length > 0) clearBtn.classList.remove('d-none');
            else clearBtn.classList.add('d-none');
        }
        this.applyFilterAndRender();
    },

    clearMobileSearch: function() {
        const input = $('mobileSearchInput');
        if (input) input.value = '';
        if ($('historySearch')) $('historySearch').value = '';
        const clearBtn = $('mobileClearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');
        this.searchKeyword = '';
        this.applyFilterAndRender();
    },

    toggleMobileFilter: function() {
        const drawer = $('mobileFilterDrawer');
        const backdrop = $('mobileFilterBackdrop');
        if (!drawer) return;
        const isOpen = drawer.classList.contains('open');
        if (isOpen) {
            drawer.classList.remove('open');
            if (backdrop) backdrop.classList.add('d-none');
        } else {
            drawer.classList.add('open');
            if (backdrop) backdrop.classList.remove('d-none');
        }
    },

    applyMobileDrawerFilter: function() {
        const catSelect = $('mobileFilterCategory');
        const stockSelect = $('mobileFilterStock');
        const targetSelect = $('mobileFilterTarget');

        if (catSelect) this.activeCategory = catSelect.value;
        if (stockSelect) this.stockFilter = stockSelect.value;
        if (targetSelect) this.searchTarget = targetSelect.value;

        // 필터 활성화 도트 표시
        const hasCustom = !!this.activeCategory || (this.stockFilter !== 'all') || !!this.searchTarget;
        const dot = $('mobileFilterDot');
        if (dot) {
            if (hasCustom) dot.classList.remove('d-none');
            else dot.classList.add('d-none');
        }

        this.renderCategoryChips();
        this.applyFilterAndRender();
        this.toggleMobileFilter();
    },

    resetMobileDrawerFilter: function() {
        this.activeCategory = '';
        this.stockFilter = 'all';
        this.searchTarget = '';
        this.searchKeyword = '';

        if ($('mobileFilterCategory')) $('mobileFilterCategory').value = '';
        if ($('mobileFilterStock')) $('mobileFilterStock').value = 'all';
        if ($('mobileFilterTarget')) $('mobileFilterTarget').value = '';
        if ($('mobileSearchInput')) $('mobileSearchInput').value = '';
        if ($('historySearch')) $('historySearch').value = '';

        const dot = $('mobileFilterDot');
        if (dot) dot.classList.add('d-none');
        const clearBtn = $('mobileClearSearchBtn');
        if (clearBtn) clearBtn.classList.add('d-none');

        this.renderCategoryChips();
        this.applyFilterAndRender();
        this.toggleMobileFilter();
    },

    applyFilterAndRender: function() {
        let result = this.inventoryData;

        // 1. 자재 분류 필터링
        if (this.activeCategory) {
            result = result.filter(r => (r.category || '').includes(this.activeCategory));
        }

        // 2. 재고 보유 상태 필터
        if (this.stockFilter === 'in_stock') {
            result = result.filter(r => Number(r.total_qty || 0) > 0);
        } else if (this.stockFilter === 'out_of_stock') {
            result = result.filter(r => Number(r.total_qty || 0) <= 0);
        }

        // 3. 스마트 다중 검색 (공백 구분 AND 교집합 검색)
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

        // 4. 결과 내 재검색 (2차 보조 필터)
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
        this.renderMobileCards(result);
        this.updateSummary(result);
    },

    getCategoryPillHtml: function(cat) {
        if (!cat || cat === '-') return '<span class="text-muted">-</span>';
        let cls = 'cat-general';
        if (cat.includes('안전')) cls = 'cat-safety';
        else if (cat.includes('토목')) cls = 'cat-civil';
        else if (cat.includes('보양')) cls = 'cat-protect';
        else if (cat.includes('소모')) cls = 'cat-consum';
        else if (cat.includes('유압') || cat.includes('기어') || cat.includes('오일')) cls = 'cat-safety';
        return `<span class="category-pill ${cls}">${cat}</span>`;
    },

    updateSummary: function(data) {
        const totalSku = data ? data.length : 0;
        const totalQty = data ? data.reduce((acc, cur) => acc + (Number(cur.total_qty) || 0), 0) : 0;

        // 데스크톱 상단 뱃지 갱신
        if ($('skuCountBadge')) $('skuCountBadge').innerText = `관리 ${totalSku.toLocaleString()} SKU`;
        if ($('totalQtyBadge')) $('totalQtyBadge').innerText = `총 재고: ${totalQty.toLocaleString()}개`;

        // 모바일 헤더 뱃지 및 KPI 바 갱신
        if ($('mobileHeaderSkuBadge')) $('mobileHeaderSkuBadge').innerText = `${totalSku.toLocaleString()} SKU`;
        if ($('mobileKpiSku')) $('mobileKpiSku').innerText = totalSku.toLocaleString();
        if ($('mobileKpiQty')) $('mobileKpiQty').innerText = totalQty.toLocaleString();
        if ($('mobileKpiFilteredText')) {
            let desc = this.activeCategory || '전체 품목';
            if (this.searchKeyword) desc += ` · "${this.searchKeyword}"`;
            $('mobileKpiFilteredText').innerText = desc;
        }

        // 데스크톱 그리드 하단 합계 요약
        if ($('inventoryTfoot')) {
            if (totalSku > 0) {
                $('inventoryTfoot').classList.remove('d-none');
                if ($('footSkuSummary')) $('footSkuSummary').innerText = `총 ${totalSku.toLocaleString()}개 품목`;
                if ($('footQtySummary')) $('footQtySummary').innerText = totalQty.toLocaleString();
            } else {
                $('inventoryTfoot').classList.add('d-none');
            }
        }
    },

    toggleLotRow: function(index) {
        const isExpanded = this.expandedIndices.has(index);

        if (isExpanded) {
            this.expandedIndices.delete(index);
        } else {
            this.expandedIndices.add(index);
        }

        // 1. 데스크톱 테이블 행 상태 동기화
        const subRow = document.getElementById(`lotSubRow_${index}`);
        const icon = document.getElementById(`accIcon_${index}`);
        const mainRow = document.getElementById(`mainRow_${index}`);
        if (subRow) {
            if (isExpanded) {
                subRow.classList.add('d-none');
                if (icon) icon.classList.remove('rotate-90');
                if (mainRow) mainRow.classList.remove('row-expanded');
            } else {
                subRow.classList.remove('d-none');
                if (icon) icon.classList.add('rotate-90');
                if (mainRow) mainRow.classList.add('row-expanded');
            }
        }

        // 2. 모바일 카드 아코디언 상태 동기화
        const cardAcc = document.getElementById(`mobileLotAccordion_${index}`);
        const cardIcon = document.getElementById(`mobile_acc_icon_${index}`);
        const cardBox = document.getElementById(`inv_card_${index}`);
        if (cardAcc) {
            if (isExpanded) {
                cardAcc.classList.add('d-none');
                if (cardIcon) cardIcon.classList.remove('rotate-180');
                if (cardBox) cardBox.classList.remove('card-expanded');
            } else {
                cardAcc.classList.remove('d-none');
                if (cardIcon) cardIcon.classList.add('rotate-180');
                if (cardBox) cardBox.classList.add('card-expanded');
            }
        }
    },

    renderTable: function(data) {
        const tbody = $('inventoryTbody');
        if (!tbody) return;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-5 text-muted">일치하는 재고 내역이 없습니다.</td></tr>`;
            return;
        }

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = data.map((row, index) => {
            const isExpanded = this.expandedIndices.has(index);

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

        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('inventoryTable', { storageKey: 'kng_inventory_grid_widths_v2' });
        }
    },

    renderMobileCards: function(data) {
        const container = $('inventoryCardsContainer');
        if (!container) return;

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="mobile-empty-state">
                    <i class='bx bx-box fs-1 text-muted mb-2'></i>
                    <div class="fw-bold text-dark fs-6">조회된 재고 품목이 없습니다</div>
                    <div class="text-muted small mt-1">상단 카테고리 칩이나 검색 조건을 변경해 보세요.</div>
                </div>
            `;
            return;
        }

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        container.innerHTML = data.map((row, index) => {
            const isExpanded = this.expandedIndices.has(index);
            const totalQty = Number(row.total_qty || 0);
            const isZero = totalQty <= 0;

            let lotHtml = '';
            if (row.lots && row.lots.length > 0) {
                lotHtml = row.lots.map(lot => `
                    <div class="mobile-lot-item">
                        <div class="d-flex align-items-center justify-content-between mb-1">
                            <span class="lot-date"><i class='bx bx-calendar me-1'></i>${lot.date || '-'}</span>
                            <span class="lot-qty ${Number(lot.qty_remaining || 0) > 0 ? 'text-primary' : 'text-muted'} fw-bold">
                                잔여 ${Number(lot.qty_remaining || 0).toLocaleString()} ${row.unit || ''}
                            </span>
                        </div>
                        <div class="d-flex align-items-center justify-content-between text-muted small">
                            <span><i class='bx bx-store-alt me-1'></i>${escapeAttr(lot.supplier || '-')}</span>
                            <span>단가: <strong>${Number(lot.unit_price || 0).toLocaleString()}원</strong></span>
                        </div>
                        <div class="d-flex align-items-center justify-content-between text-muted small mt-1">
                            <span><i class='bx bx-map-pin me-1'></i>${escapeAttr(lot.location_name || '-')}</span>
                            ${lot.note ? `<span class="text-truncate ms-2" style="max-width: 140px;">비고: ${escapeAttr(lot.note)}</span>` : ''}
                        </div>
                    </div>
                `).join('');
            } else {
                lotHtml = `<div class="p-3 text-center text-muted small">등록된 Lot 상세 입고 내역이 없습니다.</div>`;
            }

            return `
                <div class="mobile-inv-card ${isExpanded ? 'card-expanded' : ''}" id="inv_card_${index}">
                    <div class="mobile-inv-card-header">
                        <div class="d-flex align-items-center gap-1 min-w-0" style="overflow: hidden;">
                            ${this.getCategoryPillHtml(row.category)}
                            <span class="mobile-inv-loc-chip text-truncate" title="${escapeAttr(row.location_summary)}">
                                <i class='bx bx-map-pin'></i> ${row.location_summary}
                            </span>
                        </div>
                        <div class="mobile-inv-qty-badge ${isZero ? 'qty-zero' : ''}">
                            <span class="qty-num">${totalQty.toLocaleString()}</span>
                            <span class="qty-unit">${row.unit || '개'}</span>
                        </div>
                    </div>

                    <div class="mobile-inv-card-body" onclick="app.toggleLotRow(${index})">
                        <div class="mobile-inv-title text-truncate" title="${escapeAttr(row.item)}">
                            ${row.item}
                        </div>
                        <div class="mobile-inv-meta-row">
                            ${row.spec && row.spec !== '-' ? `<span class="mobile-chip spec-chip"><i class='bx bx-ruler'></i> ${row.spec}</span>` : ''}
                            <span class="mobile-chip lot-chip"><i class='bx bx-layer'></i> Lot ${row.lot_count}건</span>
                            <span class="mobile-chip date-chip"><i class='bx bx-time-five'></i> 입고: ${row.latest_date}</span>
                        </div>
                    </div>

                    <div class="mobile-inv-card-footer">
                        <button type="button" class="btn-inv-acc" onclick="app.toggleLotRow(${index})" id="mobile_acc_btn_${index}">
                            <i class='bx bx-chevron-down ${isExpanded ? 'rotate-180' : ''}' id="mobile_acc_icon_${index}"></i>
                            <span>Lot 상세 (${row.lot_count}건)</span>
                        </button>
                        <a href="../inout/index.html?search=${encodeURIComponent(row.item)}" class="btn-inv-inout-link" title="입출고 전표 관리 바로가기">
                            <i class='bx bx-transfer'></i> 입출고 내역
                        </a>
                    </div>

                    <div class="mobile-lot-accordion-content ${isExpanded ? '' : 'd-none'}" id="mobileLotAccordion_${index}">
                        <div class="mobile-lot-header">
                            <span class="fw-bold"><i class='bx bx-history text-primary'></i> 입고일자별 잔여 Lot 목록</span>
                            <span class="text-muted small">총 ${row.lot_count}건</span>
                        </div>
                        <div class="mobile-lot-list">
                            ${lotHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
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
