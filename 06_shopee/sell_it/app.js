document.addEventListener('DOMContentLoaded', async () => {

    /* --- 0. Bulk Actions Event Delegation (At Top for Safety) --- */
    document.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('row-checkbox')) {
            if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
            
            // Toggle highlight on row
            const row = e.target.closest('tr');
            if (row) {
                if (e.target.checked) {
                    row.style.backgroundColor = 'var(--surface-container-high)';
                } else {
                    row.style.backgroundColor = '';
                }
            }
        }
    });

    document.addEventListener('click', (e) => {
        const td = e.target.closest('.td-checkbox');
        if (td && e.target.tagName !== 'INPUT') {
            const cb = td.querySelector('.row-checkbox');
            if (cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // --- Bulk Action Logic Elements ---
    const checkAll = document.getElementById('check-all');
    const btnExportMarket = document.getElementById('btn-export-market');
    const exportMarketSelect = document.getElementById('export-market-select');

    window.updateBulkActionBar = function() {
        const bar = document.getElementById('bulk-action-bar');
        const countEl = document.getElementById('bulk-count');
        if (!bar || !countEl) return;

        const checkboxes = document.querySelectorAll('.row-checkbox');
        const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
        const count = checkedBoxes.length;

        countEl.innerText = count;

        if (count > 0) {
            bar.classList.add('active');
        } else {
            bar.classList.remove('active');
        }

        if (checkAll) {
            checkAll.checked = count > 0 && count === checkboxes.length;
            checkAll.indeterminate = count > 0 && count < checkboxes.length;
        }
    };

    if (checkAll) {
        checkAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
            if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
        });
    }

    if (btnExportMarket && exportMarketSelect) {
        btnExportMarket.addEventListener('click', async () => {
            const selectedMarket = exportMarketSelect.value;
            const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
            
            if (checkedBoxes.length === 0) return;

            // 선택된 상품의 ID를 수집
            const productIds = [];
            checkedBoxes.forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.productId) {
                    productIds.push(row.dataset.productId);
                }
            });

            try {
                const result = await api.exportToMarket(productIds, selectedMarket);
                
                // UI 업데이트: 배지 활성화
                checkedBoxes.forEach(cb => {
                    const row = cb.closest('tr');
                    const badge = row.querySelector(`.badge-market[data-market="${selectedMarket}"]`);
                    if (badge) badge.classList.add('active');
                    cb.checked = false;
                });

                if (typeof updateBulkActionBar === 'function') updateBulkActionBar();
                alert(`${productIds.length}개 상품이 ${selectedMarket.toUpperCase()} 마켓으로 전송되었습니다.`);
            } catch (err) {
                alert('마켓 전송 실패: ' + err.message);
            }
        });
    }

    /* --- 1. Global State & Data Store --- */

    // Render Price Calc Grid dynamically (API 기반)
    // ※ nav 클릭 핸들러 및 savedViewId 복원보다 먼저 정의되어야 함
    window.renderPriceCalcGrid = async function(marketCode) {
        const tbody = document.querySelector('#price-calc-table tbody');
        if (!tbody) return;
        
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> 로딩 중...</td></tr>';

        try {
            const exports = await api.getMarketExports(marketCode);
            tbody.innerHTML = '';

            if (exports.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-disabled); padding: 2rem;">이 마켓으로 전송된 상품이 없습니다. Product List에서 먼저 내보내기를 진행해주세요.</td></tr>`;
                return;
            }

            exports.forEach(item => {
                const tr = document.createElement('tr');
                tr.className = 'calc-row';
                tr.style.cursor = 'pointer';
                tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600;" class="prod-date">${item.date}</div>
                        <div class="body-sm text-secondary prod-mcode">${item.mcode}</div>
                    </td>
                    <td>
                        <div style="font-weight: 600;" class="prod-name-en">${item.nameEn}</div>
                        <div class="body-sm text-secondary prod-name-ko">${item.nameKo}</div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;" class="prod-price-krw">KRW ${Number(item.priceKrw).toLocaleString()}</div>
                    </td>
                    <td class="text-right">
                        <div>${item.rate}</div>
                        <div class="body-sm text-secondary prod-weight">${item.weight}g</div>
                    </td>
                    <td>
                        <div style="font-weight: 600; color: var(--secondary);">${item.exportDate}</div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            console.error('[PriceCalcGrid] 로드 실패:', err.message);
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--error); padding: 2rem;">데이터 로드 실패: ${err.message}</td></tr>`;
        }
    };

    /* --- 1. Sidebar Navigation (SPA Routing) --- */
    let currentMarketContext = 'sg'; // Default market context
    const navItems = document.querySelectorAll('.sidebar .nav-item');
    const viewSections = document.querySelectorAll('.view-section');
    const pageTitle = document.getElementById('page-title');
    const genericTitle = document.getElementById('generic-title');

    // Accordion for nav groups
    const navGroupTitles = document.querySelectorAll('.sidebar .nav-group-title');
    navGroupTitles.forEach(title => {
        title.addEventListener('click', () => {
            const navGroup = title.closest('.nav-group');
            if (navGroup) {
                navGroup.classList.toggle('expanded');
            }
        });
    });

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Remove active from all nav items
            navItems.forEach(nav => nav.classList.remove('active'));
            // Add active to clicked nav item
            item.classList.add('active');

            // Get target view id
            const viewId = item.getAttribute('data-view');
            
            // Save to localStorage for persistence
            localStorage.setItem('activeViewId', viewId);

            // Update Page Title Text
            const menuText = item.querySelector('a').innerText.trim();
            pageTitle.innerText = menuText;

            // Hide all views
            viewSections.forEach(section => {
                section.classList.remove('active');
            });

            // Handle Price Calculation views dynamically
            if (viewId.startsWith('price-calc-')) {
                const targetViewElement = document.getElementById('view-price-calc-container');
                const marketCode = viewId.split('-')[2];
                currentMarketContext = marketCode;
                document.getElementById('price-calc-title').innerText = `${marketCode.toUpperCase()} Market Details`;
                targetViewElement.classList.add('active');
                if (typeof window.renderPriceCalcGrid === 'function') {
                    window.renderPriceCalcGrid(marketCode);
                }
                if (typeof window.renderPresetSelector === 'function') window.renderPresetSelector();
                return;
            }

            // Handle Settings views dynamically
            if (viewId.startsWith('settings-')) {
                const targetViewElement = document.getElementById('view-settings');
                const marketCode = viewId.split('-')[1];
                currentMarketContext = marketCode;
                document.getElementById('settings-preset-form-title').innerText = `${marketCode.toUpperCase()} 새 프리셋 만들기`;
                document.getElementById('settings-promotion-form-title').innerText = `${marketCode.toUpperCase()} 새 프로모션 만들기`;
                document.getElementById('settings-shipping-form-title').innerText = `${marketCode.toUpperCase()} 새 배송비 요율 만들기`;
                targetViewElement.classList.add('active');
                if (typeof renderSettingsPresetTable === 'function') {
                    renderSettingsPresetTable();
                    if (typeof clearSettingsPresetForm === 'function') clearSettingsPresetForm();
                }
                if (typeof renderSettingsPromotionTable === 'function') {
                    renderSettingsPromotionTable();
                    if (typeof clearSettingsPromotionForm === 'function') clearSettingsPromotionForm();
                }
                if (typeof renderSettingsShippingTable === 'function') {
                    renderSettingsShippingTable();
                    if (typeof clearSettingsShippingForm === 'function') clearSettingsShippingForm();
                }
                return;
            }

            const targetViewId = 'view-' + viewId;
            const targetViewElement = document.getElementById(targetViewId);

            // Show target view if it exists, otherwise show generic view
            if (targetViewElement) {
                targetViewElement.classList.add('active');
            } else {
                const genericView = document.getElementById('view-generic');
                genericTitle.innerText = menuText + " Module";
                genericView.classList.add('active');
            }
        });
    });

    // Restore active view from localStorage on load
    const savedViewId = localStorage.getItem('activeViewId');
    if (savedViewId) {
        const targetNav = document.querySelector(`.sidebar .nav-item[data-view="${savedViewId}"]`);
        if (targetNav) {
            targetNav.click();
        }
    }


    /* --- 1.5. Settings Tabs Switching --- */
    const settingsTabs = document.querySelectorAll('#settings-tabs .tab');
    const settingsTabContents = document.querySelectorAll('.settings-tab-content');

    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            settingsTabs.forEach(t => t.classList.remove('active'));
            settingsTabContents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            
            const targetId = 'settings-tab-' + tab.getAttribute('data-settings-tab');
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });

    /* --- 2. Market Tabs Switching --- */
    const marketTabs = document.querySelectorAll('#market-tabs .tab');
    const currentMarketDisplay = document.getElementById('current-market-display');

    marketTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active from all tabs
            marketTabs.forEach(t => t.classList.remove('active'));
            
            // Add active to clicked tab
            tab.classList.add('active');

            // Update content display
            const marketName = tab.getAttribute('data-market');
            if(currentMarketDisplay) {
                currentMarketDisplay.innerText = marketName;
            }

            // TODO: Later, dispatch an event here so the calculator module
            // knows to re-render with the new market's JSON data.
        });
    });

    /* --- 3. Product Management Code Generator --- */
    /**
     * Generates a management code based on the given date string and sequence number.
     * Rule: Year(2 digits encoded) + Month(encoded) + Day(2 digits) + Sequence(3 digits)
     * Year encoding: 1-K, 2-C, 3-Y, 4-J, 5-E, 6-G, 7-B, 8-T, 9-U, 0-0
     * Month encoding: 1:J1, 2:F1, 3:M1, 4:A1, 5:M2, 6:J2, 7:J3, 8:A2, 9:S1, 10:O1, 11:N1, 12:D1
     */
    window.generateManagementCode = function(dateString, sequenceNumber) {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return null;

        // Year Mapping
        const yearMap = { '1': 'K', '2': 'C', '3': 'Y', '4': 'J', '5': 'E', '6': 'G', '7': 'B', '8': 'T', '9': 'U', '0': '0' };
        const year = date.getFullYear().toString();
        const lastTwoYear = year.slice(-2);
        const encodedYear = (yearMap[lastTwoYear[0]] || lastTwoYear[0]) + (yearMap[lastTwoYear[1]] || lastTwoYear[1]);

        // Month Mapping
        const monthMap = {
            1: 'J1', 2: 'F1', 3: 'M1', 4: 'A1', 5: 'M2', 6: 'J2',
            7: 'J3', 8: 'A2', 9: 'S1', 10: 'O1', 11: 'N1', 12: 'D1'
        };
        const encodedMonth = monthMap[date.getMonth() + 1];

        // Day and Sequence (Padded)
        const day = date.getDate().toString().padStart(2, '0');
        const seq = sequenceNumber.toString().padStart(3, '0');

        return `${encodedYear}${encodedMonth}-${day}-${seq}`;
    };

    /* --- 4. Product List & Drawer Logic --- */
    let productList = [];
    let marketExportsMap = {}; // { productId: [{marketCode, exportDate}] }

    // API에서 데이터 로드
    try {
        productList = await api.getProducts();
        marketExportsMap = await api.getAllMarketExports();
        console.log(`[INIT] ${productList.length}개 상품 로드 완료`);
    } catch (err) {
        console.error('[INIT] API 데이터 로드 실패:', err.message);
        productList = [];
        marketExportsMap = {};
    }

    function escapeHtmlAttr(str) {
        return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderProductListTable() {
        const tbody = document.querySelector('#view-product-list .data-table tbody');
        if (!tbody) return;

        if (productList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-disabled);">등록된 상품이 없습니다.</td></tr>';
            return;
        }

        // Sort by date descending (optional)
        // productList.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = productList.map(p => {
            let catEn1 = p.catEn;
            let catEn2 = '';
            if(p.catEn.includes(' > ')) {
                const parts = p.catEn.split(' > ');
                catEn1 = parts[0] + ' >';
                catEn2 = parts[1];
            }
            const priceUsd = (p.priceKrw / (p.rate || 1)).toFixed(2);

            // 마켓 전송 상태 확인 (API 데이터 기반)
            const exports = marketExportsMap[p.id] || [];
            const exportedMarkets = exports.map(e => e.marketCode);
            const marketCodes = ['sg','my','tw','th','ph','vn','br','mx'];
            const badgesHtml = marketCodes.map(code => {
                const isActive = exportedMarkets.includes(code) ? ' active' : '';
                return `<span class="badge-market${isActive}" data-market="${code}">${code.toUpperCase()}</span>`;
            }).join('\n                            ');

            return `
                <tr class="product-row" style="cursor: pointer;" data-mcode="${p.mcode}" data-product-id="${p.id}" data-rate-date="${p.rateDate || ''}">
                    <td style="text-align: center;" class="td-checkbox">
                        <input type="checkbox" class="row-checkbox">
                    </td>
                    <td>
                        <div style="font-weight: 600;" class="prod-date">${p.date}</div>
                        <div class="body-sm text-secondary prod-mcode">${p.mcode}</div>
                    </td>
                    <td data-cat-en="${escapeHtmlAttr(p.catEn)}" data-cat-ko="${escapeHtmlAttr(p.catKo)}">
                        <div class="prod-cat-en-1">${catEn1}</div>
                        <div class="prod-cat-en-2">${catEn2}</div>
                        <div class="body-sm text-secondary prod-cat-ko" style="margin-top: 4px;">${p.catKo}</div>
                    </td>
                    <td>
                        <div style="font-weight: 600;" class="prod-name-en">${p.nameEn}</div>
                        <div class="body-sm text-secondary prod-name-ko">${p.nameKo}</div>
                    </td>
                    <td>
                        <div class="market-badges">
                            <span class="badge-empty" style="color: var(--text-disabled); font-size: 0.875rem; padding: 4px;">-</span>
                            ${badgesHtml}
                        </div>
                    </td>
                    <td class="text-right">
                        <div style="font-weight: 600;" class="prod-price-krw">KRW ${Number(p.priceKrw).toLocaleString()}</div>
                        <div class="body-sm text-secondary prod-price-usd">USD ${priceUsd}</div>
                    </td>
                    <td class="text-right">
                        <div class="prod-rate">${p.rate}</div>
                        <div class="body-sm text-secondary prod-weight">${p.weight}g</div>
                    </td>
                    <td>
                        <div><a href="${p.link || '#'}" class="link-btn prod-link" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${p.link ? '링크' : '-'}</a></div>
                    </td>
                    <td>
                        <div class="body-sm text-secondary prod-note">${p.note || '-'}</div>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach row click events
        document.querySelectorAll('#view-product-list .product-row').forEach(row => {
            attachRowClickEvent(row);
        });
    }
    const btnAddProduct = document.getElementById('btn-add-product');
    const drawerOverlay = document.getElementById('add-product-overlay');
    const drawer = document.getElementById('add-product-drawer');
    const btnCloseDrawer = document.getElementById('btn-close-drawer');
    const btnCancelDrawer = document.getElementById('btn-cancel-drawer');
    const btnSaveProduct = document.getElementById('btn-save-product');
    const addProductForm = document.getElementById('add-product-form');
    
    // Inputs
    const inputDate = document.getElementById('input-date');
    const inputMcode = document.getElementById('input-mcode');
    const inputCategorySearch = document.getElementById('input-category-search');
    const inputCategoryEn = document.getElementById('input-category-en');
    const inputCategoryKo = document.getElementById('input-category-ko');
    const categoryAutocompleteList = document.getElementById('category-autocomplete-list');
    const inputNameKo = document.getElementById('input-name-ko');
    const inputNameEn = document.getElementById('input-name-en');
    const inputPriceKrw = document.getElementById('input-price-krw');
    const inputRate = document.getElementById('input-rate');
    const inputRateDate = document.getElementById('input-rate-date');
    const inputWeight = document.getElementById('input-weight');
    const inputLink = document.getElementById('input-link');
    const inputNote = document.getElementById('input-note');

    let currentEditingRow = null;
    let originalEditDate = null;
    let originalEditMcode = null;

    function updateMcodePreview() {
        const selectedDate = inputDate.value;
        if (!selectedDate) return;

        if (currentEditingRow && selectedDate === originalEditDate) {
            inputMcode.value = originalEditMcode;
            return;
        }

        let maxSeq = 0;
        productList.forEach(p => {
            if (p.mcode === originalEditMcode) return; // Skip currently editing
            if (p.date === selectedDate) {
                const parts = p.mcode.split('-');
                if (parts.length === 3) {
                    const seq = parseInt(parts[2], 10);
                    if (seq > maxSeq) maxSeq = seq;
                }
            }
        });

        const nextSeq = maxSeq + 1;
        inputMcode.value = window.generateManagementCode(selectedDate, nextSeq);
    }

    if (inputDate) {
        inputDate.addEventListener('change', updateMcodePreview);
    }

    function openDrawer(isEdit = false) {
        if (!isEdit) {
            addProductForm.reset();
            currentEditingRow = null;
            originalEditDate = null;
            originalEditMcode = null;
            
            const today = new Date().toISOString().split('T')[0];
            inputDate.value = today;
            updateMcodePreview();

            drawer.querySelector('.headline-md').innerText = 'Add New Product';
        } else {
            drawer.querySelector('.headline-md').innerText = 'Edit Product';
        }
        if(drawerOverlay && drawer) {
            drawerOverlay.classList.add('active');
            drawer.classList.add('active');
        }
    }

    function closeDrawer() {
        if(drawerOverlay && drawer) {
            drawerOverlay.classList.remove('active');
            drawer.classList.remove('active');
            addProductForm.reset();
            currentEditingRow = null;
            drawer.querySelector('.headline-md').innerText = 'Add New Product';
            categoryAutocompleteList.style.display = 'none';
        }
    }

    if (btnAddProduct) btnAddProduct.addEventListener('click', () => openDrawer(false));
    if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
    if (btnCancelDrawer) btnCancelDrawer.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', () => {
        closeDrawer();
        if (typeof closePriceCalcDrawer === 'function') closePriceCalcDrawer();
    });

    /* --- Autocomplete Logic --- */
    function renderAutocomplete(query) {
        if (!query) {
            categoryAutocompleteList.innerHTML = '';
            categoryAutocompleteList.classList.remove('active');
            categoryAutocompleteList.style.display = 'none';
            return;
        }

        const lowerQuery = query.toLowerCase();
        // Fallback to empty array if window.SHOPEE_CATEGORIES is not loaded
        const categories = window.SHOPEE_CATEGORIES || [];
        const filtered = categories.filter(cat => 
            cat.en.toLowerCase().includes(lowerQuery) || 
            cat.ko.includes(lowerQuery)
        );

        if (filtered.length === 0) {
            categoryAutocompleteList.innerHTML = '<li style="color:var(--text-disabled); cursor:default;">검색 결과가 없습니다.</li>';
        } else {
            categoryAutocompleteList.innerHTML = filtered.map(cat => `
                <li data-en="${cat.en}" data-ko="${cat.ko}">
                    <span class="cat-en">${cat.en}</span>
                    <span class="cat-ko">${cat.ko}</span>
                </li>
            `).join('');
        }
        categoryAutocompleteList.classList.add('active');
        categoryAutocompleteList.style.display = 'block';
    }

    if (inputCategorySearch) {
        inputCategorySearch.addEventListener('input', (e) => {
            inputCategoryEn.value = '';
            inputCategoryKo.value = '';
            renderAutocomplete(e.target.value);
        });

        // Hide list when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.autocomplete-container')) {
                categoryAutocompleteList.classList.remove('active');
                categoryAutocompleteList.style.display = 'none';
            }
        });

        // Select an item
        categoryAutocompleteList.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (!li || !li.dataset.en) return;

            const en = li.dataset.en;
            const ko = li.dataset.ko;

            inputCategorySearch.value = `${en} / ${ko}`;
            inputCategoryEn.value = en;
            inputCategoryKo.value = ko;
            
            categoryAutocompleteList.classList.remove('active');
            categoryAutocompleteList.style.display = 'none';
        });
    }

    // Form Submission (Save Product)
    if (btnSaveProduct) {
        btnSaveProduct.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!addProductForm.checkValidity()) {
                addProductForm.reportValidity();
                return;
            }

            const dateStr = inputDate.value;
            const mcodeStr = inputMcode.value;
            const catEn = inputCategoryEn.value;
            const catKo = inputCategoryKo.value;
            const catSearch = inputCategorySearch.value;
            const nameKo = inputNameKo.value;
            const nameEn = inputNameEn.value;
            const priceKrw = inputPriceKrw.value;
            const rate = inputRate.value;
            const rateDate = inputRateDate.value;
            const weight = inputWeight.value;
            const link = inputLink.value;
            const note = inputNote.value;

            if (!catEn) {
                alert("카테고리를 목록에서 올바르게 선택해주세요.");
                return;
            }

            // Duplicate Check (Array based)
            let isDuplicate = false;
            if (originalEditMcode !== mcodeStr) {
                if (productList.find(p => p.mcode === mcodeStr)) {
                    isDuplicate = true;
                }
            }

            if (isDuplicate) {
                alert(`오류: 관리코드(${mcodeStr})가 이미 존재합니다. 날짜를 변경하거나 새로고침해 주세요.`);
                return;
            }

            const productData = {
                date: dateStr,
                mcode: mcodeStr,
                catEn: catEn,
                catKo: catKo,
                nameKo: nameKo,
                nameEn: nameEn,
                priceKrw: parseInt(priceKrw, 10) || 0,
                rate: parseFloat(rate) || 1,
                rateDate: rateDate,
                weight: parseInt(weight, 10) || 0,
                link: link,
                note: note
            };

            try {
                if (currentEditingRow && originalEditMcode) {
                    // Update existing via API
                    const existing = productList.find(p => p.mcode === originalEditMcode);
                    if (existing && existing.id) {
                        await api.updateProduct(existing.id, productData);
                    }
                } else {
                    // Create new via API
                    await api.createProduct(productData);
                }

                // Reload from API
                productList = await api.getProducts();
                renderProductListTable();
                closeDrawer();
            } catch (err) {
                alert('저장 실패: ' + err.message);
            }
        });
    }

    // Row Click Logic for Editing
    function attachRowClickEvent(row) {
        row.addEventListener('click', (e) => {
            // Prevent drawer from opening if clicking a link or a checkbox
            if (e.target.closest('a') || e.target.closest('input[type="checkbox"]')) return;

            currentEditingRow = row;
            
            // Extract values safely
            const dateStr = row.querySelector('.prod-date').innerText;
            const mcodeStr = row.querySelector('.prod-mcode').innerText;
            const tdCat = row.querySelector('[data-cat-en]');
            const catEn = tdCat ? tdCat.dataset.catEn : (row.dataset.catEn || '');
            const catKo = tdCat ? tdCat.dataset.catKo : (row.dataset.catKo || '');
            const nameKo = row.querySelector('.prod-name-ko').innerText;
            const nameEn = row.querySelector('.prod-name-en').innerText;
            const priceKrwText = row.querySelector('.prod-price-krw').innerText;
            const rate = row.querySelector('.prod-rate').innerText;
            const weightText = row.querySelector('.prod-weight').innerText;
            const linkHref = row.querySelector('.prod-link').getAttribute('href');
            const note = row.querySelector('.prod-note').innerText;
            const rateDateStr = row.dataset.rateDate || '';

            // Populate form
            inputDate.value = dateStr;
            inputMcode.value = mcodeStr;
            inputCategoryEn.value = catEn;
            inputCategoryKo.value = catKo;
            inputCategorySearch.value = catEn && catKo ? `${catEn} / ${catKo}` : '';
            inputNameKo.value = nameKo;
            inputNameEn.value = nameEn;
            inputPriceKrw.value = priceKrwText.replace(/[^0-9]/g, '');
            inputRate.value = rate.replace(/,/g, '');
            inputRateDate.value = rateDateStr;
            inputWeight.value = weightText.replace(/[^0-9]/g, '');
            inputLink.value = linkHref === '#' ? '' : linkHref;
            inputNote.value = note === '-' ? '' : note;

            originalEditDate = dateStr;
            originalEditMcode = mcodeStr;

            openDrawer(true);
        });
    }

    // Attach to existing rows (Initial Render)
    renderProductListTable();

    /* --- 5. Price Calc Drawer Logic --- */
    const priceCalcDrawer = document.getElementById('price-calc-drawer');
    const btnCloseCalcDrawer = document.getElementById('btn-close-calc-drawer');
    const btnCancelCalcDrawer = document.getElementById('btn-cancel-calc-drawer');
    const btnSaveCalc = document.getElementById('btn-save-calc');

    function openPriceCalcDrawer() {
        drawerOverlay.classList.add('active');
        priceCalcDrawer.classList.add('active');
        calculateMargin(); // 초기 계산 1회 실행
    }
    
    function closePriceCalcDrawer() {
        drawerOverlay.classList.remove('active');
        priceCalcDrawer.classList.remove('active');
    }

    if(btnCloseCalcDrawer) btnCloseCalcDrawer.addEventListener('click', closePriceCalcDrawer);
    if(btnCancelCalcDrawer) btnCancelCalcDrawer.addEventListener('click', closePriceCalcDrawer);
    if(btnSaveCalc) btnSaveCalc.addEventListener('click', closePriceCalcDrawer);

    // Event Delegation for price-calc-table rows
    const priceCalcTableBody = document.querySelector('#price-calc-table tbody');
    if (priceCalcTableBody) {
        priceCalcTableBody.addEventListener('click', (e) => {
            try {
                const row = e.target.closest('tr');
                if (!row || row.querySelectorAll('td').length === 1 || row.querySelector('th')) return; // Ignore "No data" and header rows

                // Extract data safely
                const mcodeEl = row.querySelector('.prod-mcode');
                const nameEnEl = row.querySelector('.prod-name-en');
                const nameKoEl = row.querySelector('.prod-name-ko');
                const priceKrwEl = row.querySelector('.prod-price-krw') || row.querySelector('td:nth-child(3) div');

                const mcodeStr = mcodeEl ? mcodeEl.innerText : 'N/A';
                const nameEn = nameEnEl ? nameEnEl.innerText : '';
                const nameKo = nameKoEl ? nameKoEl.innerText : 'Unknown Product';
                const priceKrwText = priceKrwEl ? priceKrwEl.innerText : '0';

                const drawerMcode = document.getElementById('calc-drawer-mcode');
                if (drawerMcode) drawerMcode.innerText = mcodeStr;
                
                const drawerName = document.getElementById('calc-drawer-name');
                if (drawerName) drawerName.innerText = `${nameKo} / ${nameEn}`;
                
                const costKrw = priceKrwText.replace(/[^0-9]/g, '');
                const costInput = document.getElementById('calc-cost-krw');
                if (costInput) costInput.value = costKrw;

                // Extract Weight
                const weightEl = row.querySelector('.prod-weight');
                const weightG = document.getElementById('calc-weight-g');
                if (weightEl && weightG) {
                    const weightNum = weightEl.innerText.replace(/[^0-9]/g, '');
                    weightG.value = weightNum;
                }

                loadDefaultPresets();
                openPriceCalcDrawer();
            } catch (err) {
                console.error('Error opening price calc drawer:', err);
                alert('폼을 여는 중 문제가 발생했습니다: ' + err.message);
            }
        });
    }

    // Auto-calculate Margin logic (Dummy logic for now)
    function calculateMargin() {
        try {
            const costInput = document.getElementById('calc-cost-krw');
            const domShipInput = document.getElementById('calc-domestic-shipping');
            const packInput = document.getElementById('calc-packaging');
            
            const costKrw = costInput ? (parseFloat(costInput.value) || 0) : 0;
            const domShip = domShipInput ? (parseFloat(domShipInput.value) || 0) : 0;
            const pack = packInput ? (parseFloat(packInput.value) || 0) : 0;
            
            const commFee = parseFloat(document.getElementById('calc-commission-fee').value) || 0;
            const pgFee = parseFloat(document.getElementById('calc-pg-fee').value) || 0;
            const servFee = parseFloat(document.getElementById('calc-service-fee').value) || 0;
            const payoFee = parseFloat(document.getElementById('calc-payoneer-fee').value) || 0;
            const specFee = parseFloat(document.getElementById('calc-special-fee').value) || 0;
            
            const promoVoucher = parseFloat(document.getElementById('calc-promo-voucher').value) || 0;
            const promoFsp = parseFloat(document.getElementById('calc-promo-fsp').value) || 0;

            const totalFeePercent = commFee + pgFee + servFee + payoFee + specFee + promoVoucher + promoFsp;

            // Compute Shipping
            let shippingFee = 0;
            const shipSelector = document.getElementById('calc-shipping-preset');
            if (shipSelector && shipSelector.value) {
                const sp = shippingPresets.find(p => p.id === shipSelector.value);
                const weight = parseFloat(document.getElementById('calc-weight-g').value) || 0;
                if (sp && weight > 0) {
                    let totalShip = 0;
                    if (weight <= 50) totalShip = sp.settings.tier1Base;
                    else if (weight <= 1000) totalShip = sp.settings.tier1Base + (Math.ceil((weight-50)/10) * sp.settings.tier2Add);
                    else totalShip = sp.settings.tier3Base + (Math.ceil((weight-1000)/100) * sp.settings.tier3Add);
                    shippingFee = totalShip - sp.settings.rebate;
                    if(shippingFee < 0) shippingFee = 0;
                }
                const shipRateEl = document.getElementById('calc-shipping-rate');
                if (shipRateEl) shipRateEl.value = shippingFee.toFixed(2);
            } else {
                shippingFee = parseFloat(document.getElementById('calc-shipping-rate').value) || 0;
            }

            const totalKrw = costKrw + domShip + pack;
            const costSgd = (totalKrw / 1000) * 1.5; // Dummy exchange rate logic
            
            // Equation: FinalSellingPrice * (1 - TotalFeePercent/100) = costSgd + shippingFee
            // Wait, we have Target Margin!
            const targetMargin = parseFloat(document.getElementById('calc-target-margin').value) || 0;
            
            // Formula: FinalSellingPrice = (costSgd + shippingFee) / (1 - TotalFeePercent/100 - targetMargin/100)
            const denominator = 1 - (totalFeePercent / 100) - (targetMargin / 100);
            let estimatedSgd = 0;
            if (denominator > 0) {
                estimatedSgd = (costSgd + shippingFee) / denominator;
            }

            const finalPriceEl = document.getElementById('calc-final-price');
            if (finalPriceEl) {
                finalPriceEl.innerText = `SGD ${estimatedSgd.toFixed(2)}`;
            }

            // Update Absolute Fee amounts
            if(document.getElementById('amt-commission')) document.getElementById('amt-commission').innerText = `SGD ${(estimatedSgd * commFee / 100).toFixed(2)}`;
            if(document.getElementById('amt-pg')) document.getElementById('amt-pg').innerText = `SGD ${(estimatedSgd * pgFee / 100).toFixed(2)}`;
            if(document.getElementById('amt-service')) document.getElementById('amt-service').innerText = `SGD ${(estimatedSgd * servFee / 100).toFixed(2)}`;
            if(document.getElementById('amt-payoneer')) document.getElementById('amt-payoneer').innerText = `SGD ${(estimatedSgd * payoFee / 100).toFixed(2)}`;
            if(document.getElementById('amt-special')) document.getElementById('amt-special').innerText = `SGD ${(estimatedSgd * specFee / 100).toFixed(2)}`;
        } catch(e) {
            console.error('Margin calc error', e);
        }
    }

    // Listen to form changes to auto-recalculate
    document.getElementById('price-calc-form')?.addEventListener('input', calculateMargin);
    document.getElementById('calc-target-margin')?.addEventListener('input', calculateMargin);

    /* --- Preset Logic --- */
    let presets = [];
    let promotionPresets = [];
    let shippingPresets = [];

    // API에서 프리셋 로드
    try {
        presets = await api.getPresets();
        promotionPresets = await api.getPromotionPresets();
        shippingPresets = await api.getShippingPresets();
        console.log(`[INIT] 프리셋 로드: ${presets.length}개 수수료, ${promotionPresets.length}개 프로모션, ${shippingPresets.length}개 배송비`);
    } catch (err) {
        console.error('[INIT] 프리셋 로드 실패:', err.message);
    }

    const presetSelector = document.getElementById('preset-selector');
    const presetModalOverlay = document.getElementById('preset-modal-overlay');
    const presetModal = document.getElementById('preset-manage-modal');

    async function savePresetsToStorage() {
        // 서버에서 재로드 (개별 저장은 각 CRUD 함수에서 처리)
        try { presets = await api.getPresets(); } catch(e) { console.error(e); }
    }

    async function savePromotionPresetsToStorage() {
        try { promotionPresets = await api.getPromotionPresets(); } catch(e) { console.error(e); }
    }

    async function saveShippingPresetsToStorage() {
        try { shippingPresets = await api.getShippingPresets(); } catch(e) { console.error(e); }
    }

    function populateDrawerPresetSelectors() {
        // Fee Selector
        const feeSel = document.getElementById('calc-fee-preset');
        if (feeSel) {
            let html = '<option value="">-- 수수료 프리셋 --</option>';
            presets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            feeSel.innerHTML = html;
        }

        // Promotion Selector
        const promoSel = document.getElementById('calc-promotion-preset');
        if (promoSel) {
            let html = '<option value="">-- 프로모션 프리셋 --</option>';
            promotionPresets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            promoSel.innerHTML = html;
        }

        // Shipping Selector
        const shipSel = document.getElementById('calc-shipping-preset');
        if (shipSel) {
            let html = '<option value="">-- 배송비 프리셋 --</option>';
            shippingPresets.filter(p => p.market === currentMarketContext).forEach(p => {
                html += `<option value="${p.id}">${p.name} ${p.isDefault ? '(Default)' : ''}</option>`;
            });
            shipSel.innerHTML = html;
        }
    }

    // renderPresetSelector → populateDrawerPresetSelectors 별칭 등록
    // ※ 미정의 시 ReferenceError로 이후 코드 실행이 중단되는 버그 수정
    const renderPresetSelector = populateDrawerPresetSelectors;
    window.renderPresetSelector = renderPresetSelector;

    function applyFeePreset(presetId) {
        const p = presets.find(x => x.id === presetId);
        if (!p) return;
        const commissionEl = document.getElementById('calc-commission-fee');
        if(commissionEl) commissionEl.value = p.fees.commission;
        const pgEl = document.getElementById('calc-pg-fee');
        if(pgEl) pgEl.value = p.fees.pg;
        const serviceEl = document.getElementById('calc-service-fee');
        if(serviceEl) serviceEl.value = p.fees.service;
        const payoneerEl = document.getElementById('calc-payoneer-fee');
        if(payoneerEl) payoneerEl.value = p.fees.payoneer;
        const specialEl = document.getElementById('calc-special-fee');
        if(specialEl) specialEl.value = p.fees.special;
        calculateMargin();
    }

    function applyPromotionPreset(presetId) {
        const p = promotionPresets.find(x => x.id === presetId);
        if (!p) return;
        const voucherEl = document.getElementById('calc-promo-voucher');
        if(voucherEl) voucherEl.value = p.settings.voucher;
        const fspEl = document.getElementById('calc-promo-fsp');
        if(fspEl) fspEl.value = p.settings.fspCcb;
        const freeShipEl = document.getElementById('calc-promo-freeship');
        if(freeShipEl) freeShipEl.value = p.settings.freeShipThreshold;
        calculateMargin();
    }

    function applyShippingPreset() {
        calculateMargin(); // The calculation logic now natively reads from the selector
    }

    function loadDefaultPresets() {
        populateDrawerPresetSelectors();

        // Fee
        const feeDef = presets.find(p => p.market === currentMarketContext && p.isDefault);
        const feeSel = document.getElementById('calc-fee-preset');
        if (feeDef && feeSel) {
            feeSel.value = feeDef.id;
            applyFeePreset(feeDef.id);
        }

        // Promotion
        const promoDef = promotionPresets.find(p => p.market === currentMarketContext && p.isDefault);
        const promoSel = document.getElementById('calc-promotion-preset');
        if (promoDef && promoSel) {
            promoSel.value = promoDef.id;
            applyPromotionPreset(promoDef.id);
        }

        // Shipping
        const shipDef = shippingPresets.find(p => p.market === currentMarketContext && p.isDefault);
        const shipSel = document.getElementById('calc-shipping-preset');
        if (shipDef && shipSel) {
            shipSel.value = shipDef.id;
            applyShippingPreset();
        }
    }

    // Attach Event Listeners to Drawer Selectors
    document.getElementById('calc-fee-preset')?.addEventListener('change', (e) => {
        if(e.target.value) applyFeePreset(e.target.value);
    });
    document.getElementById('calc-promotion-preset')?.addEventListener('change', (e) => {
        if(e.target.value) applyPromotionPreset(e.target.value);
    });
    document.getElementById('calc-shipping-preset')?.addEventListener('change', (e) => {
        applyShippingPreset();
    });

    // Modal Logic
    function renderPresetTable() {
        const tbody = document.querySelector('#preset-table tbody');
        if (!tbody) return;
        
        if (presets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프리셋이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = presets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Com: ${p.fees.commission}% | PG: ${p.fees.pg}% | Serv: ${p.fees.service}%
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="default_preset" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="preset-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td>
                    <button class="btn-bulk btn-bulk-danger preset-delete-btn" data-id="${p.id}" style="padding: 4px 8px;"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.preset-default-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const id = e.target.value;
                presets.forEach(p => p.isDefault = (p.id === id));
                savePresetsToStorage();
                renderPresetSelector();
            });
        });

        document.querySelectorAll('.preset-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                presets = presets.filter(p => p.id !== id);
                if (presets.length > 0 && !presets.find(p => p.isDefault)) {
                    presets[0].isDefault = true;
                }
                savePresetsToStorage();
                renderPresetTable();
                renderPresetSelector();
                renderSettingsPresetTable(); // Settings 동기화
            });
        });
    }

    document.getElementById('btn-manage-presets')?.addEventListener('click', () => {
        renderPresetTable();
        if(presetModalOverlay && presetModal) {
            presetModalOverlay.classList.add('active');
            presetModal.classList.add('active');
        }
    });

    function closePresetModal() {
        if(presetModalOverlay && presetModal) {
            presetModalOverlay.classList.remove('active');
            presetModal.classList.remove('active');
        }
    }
    document.getElementById('btn-close-preset-modal')?.addEventListener('click', closePresetModal);
    presetModalOverlay?.addEventListener('click', closePresetModal);

    // Initial render
    renderPresetSelector();

    /* --- Settings Toggle Forms Logic --- */
    function toggleSettingsForm(type, show) {
        const form = document.getElementById(`form-container-${type}`);
        if (form) {
            form.style.display = show ? 'block' : 'none';
        }
    }
    
    document.getElementById('btn-toggle-fee-form')?.addEventListener('click', () => { clearSettingsPresetForm(); toggleSettingsForm('fee', true); });
    document.getElementById('btn-cancel-fee-form')?.addEventListener('click', () => toggleSettingsForm('fee', false));

    document.getElementById('btn-toggle-promotion-form')?.addEventListener('click', () => { clearSettingsPromotionForm(); toggleSettingsForm('promotion', true); });
    document.getElementById('btn-cancel-promotion-form')?.addEventListener('click', () => toggleSettingsForm('promotion', false));

    document.getElementById('btn-toggle-shipping-form')?.addEventListener('click', () => { clearSettingsShippingForm(); toggleSettingsForm('shipping', true); });
    document.getElementById('btn-cancel-shipping-form')?.addEventListener('click', () => toggleSettingsForm('shipping', false));

    /* --- Settings View Preset Logic --- */
    function renderSettingsPresetTable() {
        const tbody = document.querySelector('#settings-preset-table tbody');
        if (!tbody) return;
        
        const marketPresets = presets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프리셋이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Com: ${p.fees.commission}% | PG: ${p.fees.pg}% | Serv: ${p.fees.service}%
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_preset" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-preset-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-preset-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-preset-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-preset-default-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const id = e.target.value;
                presets.forEach(p => {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                    }
                });
                savePresetsToStorage();
                renderPresetSelector();
                renderSettingsPresetTable();
            });
        });

        document.querySelectorAll('.settings-preset-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = presets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-preset-id').value = p.id;
                    document.getElementById('settings-preset-name').value = p.name;
                    document.getElementById('settings-shopee-discount').value = p.fees.discount;
                    document.getElementById('settings-commission-fee').value = p.fees.commission;
                    document.getElementById('settings-pg-fee').value = p.fees.pg;
                    document.getElementById('settings-service-fee').value = p.fees.service;
                    document.getElementById('settings-payoneer-fee').value = p.fees.payoneer;
                    document.getElementById('settings-special-fee').value = p.fees.special;
                    document.getElementById('settings-preset-form-title').innerText = `${currentMarketContext.toUpperCase()} 프리셋 수정하기`;
                    toggleSettingsForm('fee', true);
                }
            });
        });

        document.querySelectorAll('.settings-preset-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(!confirm('정말로 이 프리셋을 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                presets = presets.filter(p => p.id !== id);
                
                const currentMarketPresets = presets.filter(p => p.market === currentMarketContext);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                }
                savePresetsToStorage();
                renderSettingsPresetTable();
                renderPresetSelector();
            });
        });
    }

    function clearSettingsPresetForm() {
        const form = document.getElementById('settings-preset-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-preset-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-preset-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 프리셋 만들기`;
    }

    document.getElementById('btn-settings-preset-clear')?.addEventListener('click', clearSettingsPresetForm);

    document.getElementById('btn-settings-preset-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-preset-id').value;
        const name = document.getElementById('settings-preset-name').value;
        if (!name) {
            alert('프리셋 이름을 입력해주세요.');
            return;
        }
        
        const newFees = {
            discount: parseFloat(document.getElementById('settings-shopee-discount').value) || 0,
            commission: parseFloat(document.getElementById('settings-commission-fee').value) || 0,
            pg: parseFloat(document.getElementById('settings-pg-fee').value) || 0,
            service: parseFloat(document.getElementById('settings-service-fee').value) || 0,
            payoneer: parseFloat(document.getElementById('settings-payoneer-fee').value) || 0,
            special: parseFloat(document.getElementById('settings-special-fee').value) || 0
        };

        if (id) {
            // Edit existing
            const p = presets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.fees = newFees;
            }
            alert('프리셋이 수정되었습니다.');
        } else {
            // Create new
            const marketPresets = presets.filter(p => p.market === currentMarketContext);
            presets.push({
                id: 'preset_' + Date.now(),
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                fees: newFees
            });
            alert(`${currentMarketContext.toUpperCase()} 새 프리셋이 저장되었습니다.`);
        }
        
        savePresetsToStorage();
        renderSettingsPresetTable();
        renderPresetSelector();
        clearSettingsPresetForm();
        toggleSettingsForm('fee', false);
    });

    // Call once on load
    renderSettingsPresetTable();
    if(typeof renderSettingsPromotionTable === 'function') renderSettingsPromotionTable();

    /* --- Settings View Promotion Logic --- */
    function renderSettingsPromotionTable() {
        const tbody = document.querySelector('#settings-promotion-table tbody');
        if (!tbody) return;
        
        const marketPresets = promotionPresets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 프로모션이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Voucher: ${p.settings.voucher}% | FSP+CCB: ${p.settings.fspCcb}% | FreeShip: SGD ${p.settings.freeShipThreshold}
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_promotion" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-promotion-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-promotion-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-promotion-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-promotion-default-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const id = e.target.value;
                promotionPresets.forEach(p => {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                    }
                });
                savePromotionPresetsToStorage();
                renderSettingsPromotionTable();
            });
        });

        document.querySelectorAll('.settings-promotion-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = promotionPresets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-promotion-id').value = p.id;
                    document.getElementById('settings-promotion-name').value = p.name;
                    document.getElementById('settings-promo-voucher').value = p.settings.voucher;
                    document.getElementById('settings-promo-fsp').value = p.settings.fspCcb;
                    document.getElementById('settings-promo-free-shipping').value = p.settings.freeShipThreshold;
                    document.getElementById('settings-promotion-form-title').innerText = `${currentMarketContext.toUpperCase()} 프로모션 수정하기`;
                    toggleSettingsForm('promotion', true);
                }
            });
        });

        document.querySelectorAll('.settings-promotion-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(!confirm('정말로 이 프로모션을 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                promotionPresets = promotionPresets.filter(p => p.id !== id);
                
                const currentMarketPresets = promotionPresets.filter(p => p.market === currentMarketContext);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                }
                savePromotionPresetsToStorage();
                renderSettingsPromotionTable();
            });
        });
    }

    function clearSettingsPromotionForm() {
        const form = document.getElementById('settings-promotion-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-promotion-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-promotion-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 프로모션 만들기`;
    }

    document.getElementById('btn-settings-promotion-clear')?.addEventListener('click', clearSettingsPromotionForm);

    document.getElementById('btn-settings-promotion-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-promotion-id').value;
        const name = document.getElementById('settings-promotion-name').value;
        if (!name) {
            alert('프로모션 이름을 입력해주세요.');
            return;
        }
        
        const newSettings = {
            voucher: parseFloat(document.getElementById('settings-promo-voucher').value) || 0,
            fspCcb: parseFloat(document.getElementById('settings-promo-fsp').value) || 0,
            freeShipThreshold: parseFloat(document.getElementById('settings-promo-free-shipping').value) || 0
        };

        if (id) {
            // Edit existing
            const p = promotionPresets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.settings = newSettings;
            }
            alert('프로모션이 수정되었습니다.');
        } else {
            // Create new
            const marketPresets = promotionPresets.filter(p => p.market === currentMarketContext);
            promotionPresets.push({
                id: 'promo_' + Date.now(),
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                settings: newSettings
            });
            alert(`${currentMarketContext.toUpperCase()} 새 프로모션이 저장되었습니다.`);
        }
        
        savePromotionPresetsToStorage();
        renderSettingsPromotionTable();
        clearSettingsPromotionForm();
        toggleSettingsForm('promotion', false);
    });

    /* --- Settings View Shipping Logic --- */
    function renderSettingsShippingTable() {
        const tbody = document.querySelector('#settings-shipping-table tbody');
        if (!tbody) return;
        
        const marketPresets = shippingPresets.filter(p => p.market === currentMarketContext);

        if (marketPresets.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-disabled);">저장된 배송비 요율이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = marketPresets.map(p => `
            <tr>
                <td><div style="font-weight: 600;">${p.name}</div></td>
                <td>
                    <div class="body-sm text-secondary">
                        Tier1: ${p.settings.tier1Base} | Tier2: +${p.settings.tier2Add}/10g | Tier3: ${p.settings.tier3Base} +${p.settings.tier3Add}/100g
                    </div>
                </td>
                <td style="text-align: center;">
                    <input type="radio" name="settings_default_shipping" value="${p.id}" ${p.isDefault ? 'checked' : ''} class="settings-shipping-default-radio" style="transform: scale(1.2); cursor: pointer;">
                </td>
                <td style="text-align: right;">
                    <div style="display: flex; justify-content: flex-end; gap: 8px;">
                        <button class="settings-shipping-edit-btn" data-id="${p.id}" style="background: none; border: none; color: var(--primary); cursor: pointer; padding: 4px;"><i class="fa-solid fa-pen"></i></button>
                        <button class="settings-shipping-delete-btn" data-id="${p.id}" style="background: none; border: none; color: var(--error); cursor: pointer; padding: 4px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Attach events
        document.querySelectorAll('.settings-shipping-default-radio').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const id = e.target.value;
                shippingPresets.forEach(p => {
                    if (p.market === currentMarketContext) {
                        p.isDefault = (p.id === id);
                    }
                });
                saveShippingPresetsToStorage();
                renderSettingsShippingTable();
            });
        });

        document.querySelectorAll('.settings-shipping-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                const p = shippingPresets.find(x => x.id === id);
                if(p) {
                    document.getElementById('settings-shipping-id').value = p.id;
                    document.getElementById('settings-shipping-name').value = p.name;
                    document.getElementById('settings-shipping-tier1-base').value = p.settings.tier1Base;
                    document.getElementById('settings-shipping-tier2-add').value = p.settings.tier2Add;
                    document.getElementById('settings-shipping-tier3-base').value = p.settings.tier3Base;
                    document.getElementById('settings-shipping-tier3-add').value = p.settings.tier3Add;
                    document.getElementById('settings-shipping-rebate').value = p.settings.rebate;
                    document.getElementById('settings-shipping-form-title').innerText = `${currentMarketContext.toUpperCase()} 배송비 요율 수정하기`;
                    calculateShippingTest();
                    toggleSettingsForm('shipping', true);
                }
            });
        });

        document.querySelectorAll('.settings-shipping-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(!confirm('정말로 이 배송비 요율을 삭제하시겠습니까?')) return;
                const id = e.currentTarget.getAttribute('data-id');
                shippingPresets = shippingPresets.filter(p => p.id !== id);
                
                const currentMarketPresets = shippingPresets.filter(p => p.market === currentMarketContext);
                if (currentMarketPresets.length > 0 && !currentMarketPresets.find(p => p.isDefault)) {
                    currentMarketPresets[0].isDefault = true;
                }
                saveShippingPresetsToStorage();
                renderSettingsShippingTable();
            });
        });
    }

    function clearSettingsShippingForm() {
        const form = document.getElementById('settings-shipping-form');
        if (form) form.reset();
        const idField = document.getElementById('settings-shipping-id');
        if (idField) idField.value = '';
        const titleEl = document.getElementById('settings-shipping-form-title');
        if (titleEl) titleEl.innerText = `${currentMarketContext.toUpperCase()} 새 배송비 요율 만들기`;
        calculateShippingTest();
    }

    document.getElementById('btn-settings-shipping-clear')?.addEventListener('click', clearSettingsShippingForm);

    document.getElementById('btn-settings-shipping-save')?.addEventListener('click', () => {
        const id = document.getElementById('settings-shipping-id').value;
        const name = document.getElementById('settings-shipping-name').value;
        if (!name) {
            alert('배송비 요율 이름을 입력해주세요.');
            return;
        }
        
        const newSettings = {
            tier1Base: parseFloat(document.getElementById('settings-shipping-tier1-base').value) || 0,
            tier2Add: parseFloat(document.getElementById('settings-shipping-tier2-add').value) || 0,
            tier3Base: parseFloat(document.getElementById('settings-shipping-tier3-base').value) || 0,
            tier3Add: parseFloat(document.getElementById('settings-shipping-tier3-add').value) || 0,
            rebate: parseFloat(document.getElementById('settings-shipping-rebate').value) || 0
        };

        if (id) {
            const p = shippingPresets.find(x => x.id === id);
            if (p) {
                p.name = name;
                p.settings = newSettings;
            }
            alert('배송비 요율이 수정되었습니다.');
        } else {
            const marketPresets = shippingPresets.filter(p => p.market === currentMarketContext);
            shippingPresets.push({
                id: 'ship_' + Date.now(),
                name: name,
                market: currentMarketContext,
                isDefault: marketPresets.length === 0,
                settings: newSettings
            });
            alert(`${currentMarketContext.toUpperCase()} 새 배송비 요율이 저장되었습니다.`);
        }
        
        saveShippingPresetsToStorage();
        renderSettingsShippingTable();
        clearSettingsShippingForm();
        toggleSettingsForm('shipping', false);
    });

    /* --- Shipping Rate Tester Logic --- */
    function calculateShippingTest() {
        const weightStr = document.getElementById('settings-shipping-test-weight')?.value;
        if (!weightStr) {
            document.getElementById('test-total-fee').innerText = `SGD 0.00`;
            document.getElementById('test-rebate').innerText = `- SGD 0.00`;
            document.getElementById('test-seller-borne').innerText = `SGD 0.00`;
            return;
        }

        const weight = parseFloat(weightStr) || 0;
        const tier1Base = parseFloat(document.getElementById('settings-shipping-tier1-base').value) || 0;
        const tier2Add = parseFloat(document.getElementById('settings-shipping-tier2-add').value) || 0;
        const tier3Base = parseFloat(document.getElementById('settings-shipping-tier3-base').value) || 0;
        const tier3Add = parseFloat(document.getElementById('settings-shipping-tier3-add').value) || 0;
        const rebate = parseFloat(document.getElementById('settings-shipping-rebate').value) || 0;

        let totalFee = 0;
        if (weight <= 0) {
            totalFee = 0;
        } else if (weight <= 50) {
            totalFee = tier1Base;
        } else if (weight <= 1000) {
            const extraWeight = weight - 50;
            const units = Math.ceil(extraWeight / 10);
            totalFee = tier1Base + (units * tier2Add);
        } else {
            const extraWeight = weight - 1000;
            const units = Math.ceil(extraWeight / 100);
            totalFee = tier3Base + (units * tier3Add);
        }

        document.getElementById('test-total-fee').innerText = `SGD ${totalFee.toFixed(2)}`;
        document.getElementById('test-rebate').innerText = `- SGD ${rebate.toFixed(2)}`;
        
        const sellerBorne = totalFee - rebate;
        document.getElementById('test-seller-borne').innerText = `SGD ${sellerBorne.toFixed(2)}`;
    }

    document.getElementById('settings-shipping-test-weight')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier1-base')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier2-add')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier3-base')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-tier3-add')?.addEventListener('input', calculateShippingTest);
    document.getElementById('settings-shipping-rebate')?.addEventListener('input', calculateShippingTest);
    
    // Initial Render
    if(typeof renderSettingsShippingTable === 'function') renderSettingsShippingTable();

    // ==========================================
    // MARKET ANALYSIS MODULE
    // ==========================================
    let maData = []; // cached market analysis items

    const MARKET_FLAGS = {
        sg: '🇸🇬', my: '🇲🇾', tw: '🇹🇼', th: '🇹🇭',
        ph: '🇵🇭', vn: '🇻🇳', br: '🇧🇷', mx: '🇲🇽'
    };

    // --- Shipping cost calculation using shipping_presets ---
    function calcSellerShipping(weight, market) {
        if (!weight || weight <= 0) return 0;
        // Find default shipping preset for the given market
        const preset = shippingPresets.find(p => p.market === market && p.isDefault);
        if (!preset || !preset.settings) return 0; // No preset yet for this country
        const s = preset.settings;
        let total = 0;
        if (weight <= 50) total = s.tier1Base || 0;
        else if (weight <= 1000) total = (s.tier1Base || 0) + (Math.ceil((weight - 50) / 10) * (s.tier2Add || 0));
        else total = (s.tier3Base || 0) + (Math.ceil((weight - 1000) / 100) * (s.tier3Add || 0));
        return Math.max(0, total - (s.rebate || 0));
    }

    // --- Load & Render Table ---
    async function loadMarketAnalysis() {
        const filter = document.getElementById('ma-market-filter')?.value || '';
        try {
            maData = await api.getMarketAnalysis(filter || undefined);
        } catch (err) {
            console.error('[MA] Load failed:', err);
            maData = [];
        }
        renderMATable();
    }

    function renderMATable() {
        const tbody = document.getElementById('ma-table-body');
        if (!tbody) return;

        if (maData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="ma-empty-state">
                <i class="fa-solid fa-magnifying-glass-chart"></i>
                <div>분석 데이터가 없습니다.<br>\"새 분석 추가\" 버튼을 눌러 시작하세요.</div>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = maData.map(item => {
            const flag = MARKET_FLAGS[item.market] || item.market;
            // Lowest domestic price (incl shipping)
            const cTotal = (item.coupangPrice || 0) + (item.coupangShipping || 0);
            const nTotal = (item.naverPrice || 0) + (item.naverShipping || 0);
            let lowestKrw = 0;
            if (cTotal > 0 && nTotal > 0) lowestKrw = Math.min(cTotal, nTotal);
            else lowestKrw = cTotal || nTotal || 0;

            const lowestStr = lowestKrw > 0 ? `₩${Number(lowestKrw).toLocaleString()}` : '-';

            // Simple margin indication (placeholder — can be refined)
            let marginStr = '-';
            let marginClass = 'margin-neutral';
            if (item.actualPrice > 0 && lowestKrw > 0) {
                // Very rough: diff between sell price and source cost converted
                marginStr = '분석 필요';
            }

            const imgHtml = item.imageUrl
                ? `<img src="${item.imageUrl}" class="ma-thumb" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="ma-thumb-placeholder" style="display:none"><i class="fa-solid fa-image"></i></div>`
                : `<div class="ma-thumb-placeholder"><i class="fa-solid fa-image"></i></div>`;

            return `<tr data-id="${item.id}">
                <td>${imgHtml}</td>
                <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.productName || ''}">${item.productName || '-'}</td>
                <td><span class="ma-country-badge">${flag} ${(item.market||'').toUpperCase()}</span></td>
                <td style="max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.storeName || '-'}</td>
                <td class="text-right" style="font-weight:600;">${item.actualPrice || '-'}</td>
                <td class="text-right">${lowestStr}</td>
                <td class="text-right"><span class="${marginClass}">${marginStr}</span></td>
                <td class="text-right">${item.monthlySales || '-'}</td>
                <td style="text-align:right;">
                    <button class="btn-secondary ma-edit-btn" data-id="${item.id}" style="padding:4px 10px;font-size:0.75rem;">상세</button>
                </td>
            </tr>`;
        }).join('');
    }

    // --- Drawer Management ---
    const maDrawer = document.getElementById('ma-drawer');
    const maOverlay = document.getElementById('ma-drawer-overlay');

    function openMADrawer(item) {
        if (!maDrawer) return;
        const isEdit = !!item;
        document.getElementById('ma-drawer-title').innerText = isEdit ? '분석 상세/수정' : '새 분석 추가';
        document.getElementById('ma-edit-id').value = isEdit ? item.id : '';
        document.getElementById('ma-market').value = isEdit ? (item.market || 'sg') : 'sg';
        document.getElementById('ma-category').value = isEdit ? (item.shopeeCategory || '') : '';
        document.getElementById('ma-product-name').value = isEdit ? (item.productName || '') : '';
        document.getElementById('ma-store-name').value = isEdit ? (item.storeName || '') : '';
        document.getElementById('ma-monthly-sales').value = isEdit ? (item.monthlySales || '') : '';
        document.getElementById('ma-listing-price').value = isEdit ? (item.listingPrice || '') : '';
        document.getElementById('ma-actual-price').value = isEdit ? (item.actualPrice || '') : '';
        document.getElementById('ma-weight').value = isEdit ? (item.weight || '') : '';
        document.getElementById('ma-seller-shipping').value = isEdit ? (item.sellerShipping || '') : '';
        document.getElementById('ma-shopee-url').value = isEdit ? (item.shopeeUrl || '') : '';
        document.getElementById('ma-coupang-price').value = isEdit ? (item.coupangPrice || '') : '';
        document.getElementById('ma-coupang-shipping').value = isEdit ? (item.coupangShipping || '') : '';
        document.getElementById('ma-naver-price').value = isEdit ? (item.naverPrice || '') : '';
        document.getElementById('ma-naver-shipping').value = isEdit ? (item.naverShipping || '') : '';
        document.getElementById('ma-coupang-url').value = isEdit ? (item.coupangUrl || '') : '';
        document.getElementById('ma-naver-url').value = isEdit ? (item.naverUrl || '') : '';
        document.getElementById('ma-note').value = isEdit ? (item.note || '') : '';
        document.getElementById('ma-image-url').value = '';

        // Image
        const imgTag = document.getElementById('ma-image-tag');
        const imgPlaceholder = document.getElementById('ma-image-placeholder');
        if (isEdit && item.imageUrl) {
            imgTag.src = item.imageUrl;
            imgTag.style.display = 'block';
            imgPlaceholder.style.display = 'none';
        } else {
            imgTag.src = '';
            imgTag.style.display = 'none';
            imgPlaceholder.style.display = 'flex';
        }

        // Delete button
        document.getElementById('ma-delete-btn').style.display = isEdit ? 'block' : 'none';

        maDrawer.classList.add('active');
        maOverlay.classList.add('active');
        updateMAMarginDisplay();
    }

    function closeMADrawer() {
        maDrawer?.classList.remove('active');
        maOverlay?.classList.remove('active');
    }

    // --- Auto-calc shipping when market or weight changes ---
    function autoCalcShipping() {
        const market = document.getElementById('ma-market')?.value || 'sg';
        const weight = parseInt(document.getElementById('ma-weight')?.value) || 0;
        const shipping = calcSellerShipping(weight, market);
        const el = document.getElementById('ma-seller-shipping');
        if (el) el.value = shipping > 0 ? shipping.toFixed(2) : '';
        updateMAMarginDisplay();
    }

    // --- Margin display ---
    function updateMAMarginDisplay() {
        const coupangPrice = parseFloat(document.getElementById('ma-coupang-price')?.value) || 0;
        const coupangShip = parseFloat(document.getElementById('ma-coupang-shipping')?.value) || 0;
        const naverPrice = parseFloat(document.getElementById('ma-naver-price')?.value) || 0;
        const naverShip = parseFloat(document.getElementById('ma-naver-shipping')?.value) || 0;

        const cTotal = coupangPrice + coupangShip;
        const nTotal = naverPrice + naverShip;
        let lowest = 0;
        let source = '';
        if (cTotal > 0 && nTotal > 0) {
            lowest = Math.min(cTotal, nTotal);
            source = cTotal <= nTotal ? '쿠팡' : '네이버';
        } else if (cTotal > 0) { lowest = cTotal; source = '쿠팡'; }
        else if (nTotal > 0) { lowest = nTotal; source = '네이버'; }

        const lowestEl = document.getElementById('ma-lowest-source');
        const marginEl = document.getElementById('ma-estimated-margin');

        if (lowest > 0) {
            lowestEl.innerText = `₩${Number(lowest).toLocaleString()} (${source})`;
        } else {
            lowestEl.innerText = '-';
        }

        const actualPrice = parseFloat(document.getElementById('ma-actual-price')?.value) || 0;
        const sellerShip = parseFloat(document.getElementById('ma-seller-shipping')?.value) || 0;

        if (actualPrice > 0 && lowest > 0) {
            // Very simplified margin estimation
            // Revenue: actualPrice (local currency)
            // Cost: lowest KRW → needs exchange rate conversion
            // For now show just cost comparison indicator
            marginEl.innerText = `소싱가 ₩${lowest.toLocaleString()} / 판매가 ${actualPrice}`;
            marginEl.style.color = '';
        } else {
            marginEl.innerText = '-';
            marginEl.style.color = '';
        }
    }

    // --- Save / Update ---
    async function saveMAItem() {
        const editId = document.getElementById('ma-edit-id')?.value;
        const data = {
            market: document.getElementById('ma-market')?.value || 'sg',
            shopeeCategory: document.getElementById('ma-category')?.value || '',
            productName: document.getElementById('ma-product-name')?.value || '',
            storeName: document.getElementById('ma-store-name')?.value || '',
            monthlySales: parseInt(document.getElementById('ma-monthly-sales')?.value) || 0,
            listingPrice: parseFloat(document.getElementById('ma-listing-price')?.value) || 0,
            actualPrice: parseFloat(document.getElementById('ma-actual-price')?.value) || 0,
            weight: parseInt(document.getElementById('ma-weight')?.value) || 0,
            sellerShipping: parseFloat(document.getElementById('ma-seller-shipping')?.value) || 0,
            shopeeUrl: document.getElementById('ma-shopee-url')?.value || '',
            coupangPrice: parseFloat(document.getElementById('ma-coupang-price')?.value) || 0,
            coupangShipping: parseFloat(document.getElementById('ma-coupang-shipping')?.value) || 0,
            naverPrice: parseFloat(document.getElementById('ma-naver-price')?.value) || 0,
            naverShipping: parseFloat(document.getElementById('ma-naver-shipping')?.value) || 0,
            coupangUrl: document.getElementById('ma-coupang-url')?.value || '',
            naverUrl: document.getElementById('ma-naver-url')?.value || '',
            note: document.getElementById('ma-note')?.value || '',
            imageUrl: document.getElementById('ma-image-tag')?.src || ''
        };
        // Don't save empty/blob image src
        if (data.imageUrl === '' || data.imageUrl === window.location.href) data.imageUrl = '';

        try {
            if (editId) {
                await api.updateMarketAnalysis(editId, data);
            } else {
                await api.createMarketAnalysis(data);
            }
            closeMADrawer();
            loadMarketAnalysis();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    }

    // --- Delete ---
    async function deleteMAItem() {
        const editId = document.getElementById('ma-edit-id')?.value;
        if (!editId) return;
        if (!confirm('이 분석 데이터를 삭제하시겠습니까?')) return;
        try {
            await api.deleteMarketAnalysis(editId);
            closeMADrawer();
            loadMarketAnalysis();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    }

    // --- Image upload handlers ---
    document.getElementById('ma-image-preview')?.addEventListener('click', () => {
        document.getElementById('ma-image-file')?.click();
    });

    document.getElementById('ma-image-file')?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const result = await api.uploadMarketAnalysisImage(file);
            const imgTag = document.getElementById('ma-image-tag');
            imgTag.src = result.url;
            imgTag.style.display = 'block';
            document.getElementById('ma-image-placeholder').style.display = 'none';
        } catch (err) {
            alert('이미지 업로드 실패: ' + err.message);
        }
        e.target.value = ''; // reset
    });

    document.getElementById('ma-image-url')?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = e.target.value.trim();
        if (!url) return;
        try {
            const result = await api.uploadMarketAnalysisImageUrl(url);
            const imgTag = document.getElementById('ma-image-tag');
            imgTag.src = result.url;
            imgTag.style.display = 'block';
            document.getElementById('ma-image-placeholder').style.display = 'none';
            e.target.value = '';
        } catch (err) {
            // Fallback: just use URL directly
            const imgTag = document.getElementById('ma-image-tag');
            imgTag.src = url;
            imgTag.style.display = 'block';
            document.getElementById('ma-image-placeholder').style.display = 'none';
            e.target.value = '';
        }
    });

    // --- Event Listeners ---
    document.getElementById('btn-add-ma')?.addEventListener('click', () => openMADrawer(null));
    document.getElementById('ma-drawer-close')?.addEventListener('click', closeMADrawer);
    document.getElementById('ma-drawer-overlay')?.addEventListener('click', closeMADrawer);
    document.getElementById('ma-save-btn')?.addEventListener('click', saveMAItem);
    document.getElementById('ma-delete-btn')?.addEventListener('click', deleteMAItem);
    document.getElementById('ma-market-filter')?.addEventListener('change', loadMarketAnalysis);

    // Auto-calc shipping on market or weight change
    document.getElementById('ma-market')?.addEventListener('change', autoCalcShipping);
    document.getElementById('ma-weight')?.addEventListener('input', autoCalcShipping);

    // Update margin display on domestic price changes
    ['ma-coupang-price', 'ma-coupang-shipping', 'ma-naver-price', 'ma-naver-shipping', 'ma-actual-price', 'ma-seller-shipping'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateMAMarginDisplay);
    });

    // Table row click → open drawer
    document.getElementById('ma-table-body')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.ma-edit-btn');
        const tr = e.target.closest('tr[data-id]');
        if (btn || tr) {
            const id = btn ? btn.getAttribute('data-id') : tr.getAttribute('data-id');
            const item = maData.find(d => d.id === id);
            if (item) openMADrawer(item);
        }
    });

    // Hook into nav: when market-analysis view becomes active, load data
    const origNavHandler = navItems;
    navItems.forEach(item => {
        const origHandler = item._maHandler;
        item.addEventListener('click', () => {
            const viewId = item.getAttribute('data-view');
            if (viewId === 'market-analysis') {
                loadMarketAnalysis();
            }
        });
    });

    // renderPriceCalcGrid는 nav 핸들러 이전으로 이동됨 (line ~105)
});
