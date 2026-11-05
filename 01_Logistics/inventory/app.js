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

                // 4. 매입처 요약 및 재고자산 금액(매입원가 기준) 계산
                const supplierNames = [...new Set(lots.map(l => l.supplier).filter(Boolean))];
                const totalQty = Number(row.total_qty) || 0;
                const stockAmount = Math.round(lots.reduce((sum, l) => {
                    const q = Number(l.qty_remaining) || 0;
                    const p = Number(l.unit_price) || 0;
                    return sum + (q * p);
                }, 0));
                const avgUnitPrice = totalQty > 0
                    ? Math.round(stockAmount / totalQty)
                    : (lots.length > 0 ? Math.round(Number(lots[lots.length - 1].unit_price) || 0) : 0);

                return {
                    ...row,
                    category: category,
                    latest_date: latestDate,
                    location_summary: locationSummary,
                    locations: locNames,
                    suppliers: supplierNames,
                    lot_count: lots.length,
                    avg_unit_price: avgUnitPrice,
                    stock_amount: stockAmount
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
        const modalEl = document.getElementById('printInventoryModal');
        if (!modalEl) {
            this.executePrintInventory();
            return;
        }

        const updateModalSummary = () => {
            const excludeZero = $('printExcludeZero') ? $('printExcludeZero').checked : true;
            const list = (this.currentFilteredData || []).filter(r => !excludeZero || Number(r.total_qty || 0) > 0);
            const totalQty = list.reduce((acc, cur) => acc + (Number(cur.total_qty) || 0), 0);
            const totalAmt = list.reduce((acc, cur) => acc + (Number(cur.stock_amount) || 0), 0);
            const summaryEl = $('printTargetSummaryText');
            if (summaryEl) {
                summaryEl.innerHTML = `출력 대상: <strong>총 ${list.length.toLocaleString()}개 품목</strong> (수량 합계: <strong>${totalQty.toLocaleString()}</strong> / 재고금액: <strong>${totalAmt.toLocaleString()}원</strong>)`;
            }
        };

        const excludeZeroChk = $('printExcludeZero');
        if (excludeZeroChk && !excludeZeroChk._boundSummary) {
            excludeZeroChk.addEventListener('change', updateModalSummary);
            excludeZeroChk._boundSummary = true;
        }

        updateModalSummary();

        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    executePrintInventory: function() {
        const docTitle = ($('printDocTitle') && $('printDocTitle').value.trim()) ? $('printDocTitle').value.trim() : '실시간 재고 현황표';
        const detailMode = (document.querySelector('input[name="printDetailMode"]:checked')?.value) || 'summary';
        const includePrice = $('printIncludePrice') ? $('printIncludePrice').checked : true;
        const includeCheckCol = $('printIncludeCheckCol') ? $('printIncludeCheckCol').checked : true;
        const excludeZero = $('printExcludeZero') ? $('printExcludeZero').checked : true;
        const includeSignBox = $('printIncludeSignBox') ? $('printIncludeSignBox').checked : true;

        const rowsData = (this.currentFilteredData || []).filter(r => !excludeZero || Number(r.total_qty || 0) > 0);
        if (rowsData.length === 0) {
            alert('출력할 재고 내역이 없습니다.');
            return;
        }

        const modalEl = document.getElementById('printInventoryModal');
        if (modalEl) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
        }

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('팝업 차단이 활성화되어 있어 인쇄 창을 열 수 없습니다. 브라우저 설정에서 팝업을 허용해주세요.');
            return;
        }

        const escapeHtml = (str) => {
            if (str === null || str === undefined) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timestampStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        // 필터 설명 조합
        const filterParts = [];
        filterParts.push(`자재분류: ${this.activeCategory || '전체'}`);
        if (this.searchKeyword) {
            const targetMap = { item: '품목명', spec: '규격', location: '보관위치', supplier: '매입처' };
            const targetLabel = targetMap[this.searchTarget] || '전체';
            filterParts.push(`검색(${targetLabel}): "${this.searchKeyword}"`);
        }
        if (this.subSearchKeyword) {
            filterParts.push(`결과내 재검색: "${this.subSearchKeyword}"`);
        }
        filterParts.push(detailMode === 'lots' ? '양식: Lot별 상세 포함' : '양식: 품목별 요약');

        // 전체 집계
        const totalSku = rowsData.length;
        let grandTotalQty = 0;
        let grandTotalAmt = 0;
        const warehouseSet = new Set();

        rowsData.forEach(r => {
            grandTotalQty += Number(r.total_qty || 0);
            grandTotalAmt += Number(r.stock_amount || 0);
            (r.locations || []).forEach(loc => warehouseSet.add(loc));
        });

        // 컬럼 구성 계산
        let colCount = 7; // No, 분류, 품목명, 규격, 단위, 보관위치, 최종입고일, 현재고수량 -> 기본 8개
        colCount = 8;
        if (includePrice) colCount += 2; // 평균단가, 재고금액
        if (includeCheckCol) colCount += 1; // 실사수량 / 비고

        // 본문 행 생성
        let tbodyHtml = '';
        rowsData.forEach((row, idx) => {
            const qty = Number(row.total_qty || 0);
            const avgPrice = Number(row.avg_unit_price || 0);
            const stockAmt = Number(row.stock_amount || 0);
            const allLocations = (row.locations && row.locations.length > 0)
                ? row.locations.join(', ')
                : (row.location_summary || '-');

            tbodyHtml += `
                <tr class="main-item-row ${detailMode === 'lots' ? 'has-lots-parent' : ''}">
                    <td class="text-center col-no">${idx + 1}</td>
                    <td class="text-center col-cat">${escapeHtml(row.category || '-')}</td>
                    <td class="text-start col-item fw-bold">${escapeHtml(row.item || '-')}</td>
                    <td class="text-start col-spec">${escapeHtml(row.spec || '-')}</td>
                    <td class="text-center col-unit">${escapeHtml(row.unit || '-')}</td>
                    <td class="text-start col-loc">${escapeHtml(allLocations)}</td>
                    <td class="text-center col-date">${escapeHtml(row.latest_date || '-')}</td>
                    <td class="text-end col-qty fw-bold">${qty.toLocaleString()}</td>
                    ${includePrice ? `
                        <td class="text-end col-price">${avgPrice > 0 ? avgPrice.toLocaleString() : '-'}</td>
                        <td class="text-end col-amt fw-bold">${stockAmt > 0 ? stockAmt.toLocaleString() : '0'}</td>
                    ` : ''}
                    ${includeCheckCol ? `<td class="col-check"></td>` : ''}
                </tr>
            `;

            if (detailMode === 'lots' && row.lots && row.lots.length > 0) {
                const activeLots = row.lots.filter(l => !excludeZero || Number(l.qty_remaining || 0) > 0);
                activeLots.forEach((lot, lIdx) => {
                    const lQty = Number(lot.qty_remaining || 0);
                    const lPrice = Number(lot.unit_price || 0);
                    const lAmt = Math.round(lQty * lPrice);
                    const lotDesc = `└ [Lot ${lIdx + 1}] 매입처: ${escapeHtml(lot.supplier || '-')}${lot.note ? ` · 비고: ${escapeHtml(lot.note)}` : ''}`;

                    tbodyHtml += `
                        <tr class="lot-detail-row">
                            <td class="text-center text-muted">-</td>
                            <td class="text-center text-muted" style="font-size: 9px;">Lot상세</td>
                            <td colspan="2" class="text-start ps-2 text-muted" style="font-size: 9.5px;">${lotDesc}</td>
                            <td class="text-center text-muted">${escapeHtml(row.unit || '-')}</td>
                            <td class="text-start text-muted">${escapeHtml(lot.location_name || '-')}</td>
                            <td class="text-center text-muted">${escapeHtml(lot.date || '-')}</td>
                            <td class="text-end text-dark">${lQty.toLocaleString()}</td>
                            ${includePrice ? `
                                <td class="text-end text-muted">${lPrice > 0 ? lPrice.toLocaleString() : '-'}</td>
                                <td class="text-end text-muted">${lAmt > 0 ? lAmt.toLocaleString() : '0'}</td>
                            ` : ''}
                            ${includeCheckCol ? `<td class="col-check"></td>` : ''}
                        </tr>
                    `;
                });
            }
        });

        const signBoxHtml = includeSignBox ? `
            <table class="sign-table">
                <tr>
                    <th rowspan="2" class="sign-label">확<br>인</th>
                    <th>담 당</th>
                    <th>검 토</th>
                    <th>승 인</th>
                </tr>
                <tr>
                    <td class="sign-space"></td>
                    <td class="sign-space"></td>
                    <td class="sign-space"></td>
                </tr>
            </table>
        ` : '';

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>${escapeHtml(docTitle)} (${timestampStr})</title>
                <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css">
                <style>
                    * { box-sizing: border-box; }
                    @page {
                        size: A4 portrait;
                        margin: 10mm 9mm 12mm 9mm;
                    }
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: #ffffff;
                        color: #0f172a;
                        font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
                        font-size: 10px;
                        line-height: 1.3;
                        -webkit-print-color-adjust: exact;
                        print-color-adjust: exact;
                    }
                    .print-page {
                        width: 100%;
                        max-width: 100%;
                        margin: 0 auto;
                    }

                    /* 상단 화면용 툴바 (인쇄 시 숨김) */
                    .screen-toolbar {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: #1e293b;
                        color: #ffffff;
                        padding: 8px 16px;
                        margin-bottom: 14px;
                        border-radius: 6px;
                    }
                    .screen-toolbar button {
                        background: #2563eb;
                        color: #ffffff;
                        border: none;
                        padding: 6px 14px;
                        border-radius: 4px;
                        font-weight: 700;
                        font-size: 12px;
                        cursor: pointer;
                    }
                    .screen-toolbar button.btn-close-win {
                        background: #475569;
                        margin-left: 6px;
                    }
                    @media print {
                        .screen-toolbar { display: none !important; }
                    }

                    /* 문서 헤더 */
                    .doc-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-end;
                        border-bottom: 2px solid #0f172a;
                        padding-bottom: 8px;
                        margin-bottom: 8px;
                    }
                    .doc-title-area {
                        flex: 1;
                    }
                    .doc-title {
                        font-size: 21px;
                        font-weight: 800;
                        letter-spacing: 2px;
                        margin: 0 0 6px 0;
                        color: #000000;
                    }
                    .doc-meta {
                        font-size: 10.5px;
                        color: #334155;
                        line-height: 1.45;
                    }
                    .doc-meta strong {
                        color: #0f172a;
                    }

                    /* 결재란 */
                    .sign-table {
                        border-collapse: collapse;
                        border: 1.5px solid #0f172a;
                        font-size: 10px;
                        margin-left: 12px;
                    }
                    .sign-table th, .sign-table td {
                        border: 1px solid #334155;
                        text-align: center;
                        vertical-align: middle;
                    }
                    .sign-table th {
                        background: #f1f5f9;
                        font-weight: 700;
                        height: 18px;
                        width: 52px;
                    }
                    .sign-table .sign-label {
                        width: 22px;
                        padding: 2px;
                    }
                    .sign-table .sign-space {
                        height: 38px;
                        width: 52px;
                    }

                    /* 상단 KPI 요약 바 */
                    .summary-strip {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        border: 1.5px solid #0f172a;
                        background: #f8fafc;
                        padding: 6px 12px;
                        margin-bottom: 8px;
                        font-size: 11px;
                    }
                    .summary-item {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .summary-label {
                        color: #475569;
                        font-weight: 600;
                    }
                    .summary-val {
                        color: #0f172a;
                        font-weight: 800;
                        font-variant-numeric: tabular-nums;
                        font-size: 12px;
                    }
                    .summary-val.highlight {
                        color: #1d4ed8;
                    }

                    /* 본문 테이블 */
                    .inv-print-table {
                        width: 100%;
                        border-collapse: collapse;
                        border: 1.5px solid #0f172a;
                        table-layout: auto;
                    }
                    .inv-print-table thead {
                        display: table-header-group;
                    }
                    .inv-print-table tfoot {
                        display: table-row-group;
                    }
                    .inv-print-table tr {
                        page-break-inside: avoid;
                    }
                    .inv-print-table th {
                        background: #e2e8f0;
                        color: #0f172a;
                        font-weight: 800;
                        font-size: 10px;
                        padding: 5px 4px;
                        border: 1px solid #475569;
                        text-align: center;
                        vertical-align: middle;
                        white-space: nowrap;
                    }
                    .inv-print-table td {
                        padding: 4px 5px;
                        border: 1px solid #94a3b8;
                        font-size: 10px;
                        vertical-align: middle;
                        word-break: keep-all;
                        overflow-wrap: break-word;
                    }
                    .inv-print-table .main-item-row.has-lots-parent td {
                        background: #f8fafc;
                        border-top: 1.2px solid #475569;
                    }
                    .inv-print-table .lot-detail-row td {
                        background: #ffffff;
                        border-top: 1px dashed #cbd5e1;
                        padding-top: 2.5px;
                        padding-bottom: 2.5px;
                    }
                    .inv-print-table .total-row td {
                        background: #f1f5f9;
                        border-top: 1.5px solid #0f172a;
                        border-bottom: 1.5px solid #0f172a;
                        font-weight: 800;
                        font-size: 10.5px;
                        padding: 6px 5px;
                    }

                    /* 정렬 및 컬럼별 폭 가이드 */
                    .text-center { text-align: center !important; }
                    .text-start  { text-align: left !important; }
                    .text-end    { text-align: right !important; font-variant-numeric: tabular-nums; }
                    .text-muted  { color: #64748b !important; }
                    .text-dark   { color: #0f172a !important; }
                    .fw-bold     { font-weight: 700 !important; }
                    .ps-2        { padding-left: 10px !important; }

                    .col-no    { width: 28px; white-space: nowrap; }
                    .col-cat   { width: 62px; white-space: nowrap; }
                    .col-item  { min-width: 130px; }
                    .col-spec  { min-width: 90px; }
                    .col-unit  { width: 38px; white-space: nowrap; }
                    .col-loc   { width: 78px; }
                    .col-date  { width: 68px; white-space: nowrap; font-variant-numeric: tabular-nums; }
                    .col-qty   { width: 64px; white-space: nowrap; }
                    .col-price { width: 68px; white-space: nowrap; }
                    .col-amt   { width: 82px; white-space: nowrap; }
                    .col-check { width: 82px; }
                </style>
            </head>
            <body>
                <div class="screen-toolbar">
                    <div>
                        <strong>${escapeHtml(docTitle)}</strong> · 총 ${totalSku.toLocaleString()}개 품목 (A4 세로 최적화 양식)
                    </div>
                    <div>
                        <button type="button" onclick="window.print()">인쇄하기 (Ctrl+P)</button>
                        <button type="button" class="btn-close-win" onclick="window.close()">창 닫기</button>
                    </div>
                </div>

                <div class="print-page">
                    <!-- 상단 문서 헤더 -->
                    <div class="doc-header">
                        <div class="doc-title-area">
                            <h1 class="doc-title">${escapeHtml(docTitle)}</h1>
                            <div class="doc-meta">
                                <div><strong>출력 기준일시:</strong> ${timestampStr} 기준</div>
                                <div><strong>조회 조건:</strong> ${escapeHtml(filterParts.join('  |  '))}</div>
                            </div>
                        </div>
                        ${signBoxHtml}
                    </div>

                    <!-- 상단 핵심 요약 박스 -->
                    <div class="summary-strip">
                        <div class="summary-item">
                            <span class="summary-label">총 관리 품목:</span>
                            <span class="summary-val">${totalSku.toLocaleString()} 종 (SKU)</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">보관 창고:</span>
                            <span class="summary-val">${warehouseSet.size > 0 ? warehouseSet.size + ' 개소' : '-'}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">총 재고 수량:</span>
                            <span class="summary-val highlight">${grandTotalQty.toLocaleString()}</span>
                        </div>
                        ${includePrice ? `
                            <div class="summary-item">
                                <span class="summary-label">총 재고 자산금액(매입가 기준):</span>
                                <span class="summary-val highlight">₩ ${grandTotalAmt.toLocaleString()} 원</span>
                            </div>
                        ` : ''}
                    </div>

                    <!-- 본문 재고 현황 테이블 -->
                    <table class="inv-print-table">
                        <thead>
                            <tr>
                                <th class="col-no">No.</th>
                                <th class="col-cat">분류</th>
                                <th class="col-item">품목명</th>
                                <th class="col-spec">규격</th>
                                <th class="col-unit">단위</th>
                                <th class="col-loc">보관 위치</th>
                                <th class="col-date">최종입고일</th>
                                <th class="col-qty">현재고 수량</th>
                                ${includePrice ? `
                                    <th class="col-price">평균단가</th>
                                    <th class="col-amt">재고금액</th>
                                ` : ''}
                                ${includeCheckCol ? `<th class="col-check">실사수량 / 비고</th>` : ''}
                            </tr>
                        </thead>
                        <tbody>
                            ${tbodyHtml}
                            <tr class="total-row">
                                <td colspan="7" class="text-center">[ 합 계 : 총 ${totalSku.toLocaleString()}개 품목 ]</td>
                                <td class="text-end">${grandTotalQty.toLocaleString()}</td>
                                ${includePrice ? `
                                    <td></td>
                                    <td class="text-end">${grandTotalAmt.toLocaleString()}</td>
                                ` : ''}
                                ${includeCheckCol ? `<td></td>` : ''}
                            </tr>
                        </tbody>
                    </table>
                </div>

                <script>
                    window.addEventListener('afterprint', function() {
                        window.close();
                    });
                    function triggerPrint() {
                        setTimeout(function() {
                            window.focus();
                            window.print();
                        }, 250);
                    }
                    if (document.readyState === 'complete') {
                        triggerPrint();
                    } else {
                        window.addEventListener('load', triggerPrint);
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    }
};

window.app = app;

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
