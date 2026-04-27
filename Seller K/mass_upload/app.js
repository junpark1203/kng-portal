/* ========================================
   SmartStore Mass Upload — Core App
   Wizard, Navigation, Validation,
   Category Search, Data, Preview
   ======================================== */

var currentStep = 1;
var currentProduct = null;
var currentImages = { main: null, additional: [], detail: [] };

// ════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    // 먼저 마이그레이션 체크, 그 다음 서버 데이터 로드
    var migrationPromise = Promise.resolve();
    if (Storage.needsMigration()) {
        if (confirm('기존 브라우저에 저장된 데이터가 감지되었습니다.\n서버로 이전하시겠습니까?\n\n(이전 후에는 브라우저 데이터가 삭제됩니다)')) {
            migrationPromise = Storage.migrateToServer().then(function(result) {
                console.log('[Migration] 완료:', result);
                showToast('데이터가 서버로 이전되었습니다! (' + (result.counts.products || 0) + '개 상품)', 'success');
            }).catch(function(err) {
                console.error('[Migration] 실패:', err);
                showToast('마이그레이션 실패: ' + err.message, 'error');
            });
        }
    }

    migrationPromise.then(function() {
        return Storage.init();
    }).then(function() {
        // ── 원산지 코드 마이그레이션 (0000 → 03) ──
        var products = Storage.getProducts();
        var toFix = products.filter(function(p) { return p.originCode === '0000' || !p.originCode; });
        if (toFix.length > 0) {
            console.log('[Migration] 원산지 코드 수정 대상:', toFix.length, '건');
            var fixPromises = toFix.map(function(p) {
                p.originCode = '03';
                p.originName = '상세설명에 표시';
                return Storage.saveProduct(p);
            });
            Promise.all(fixPromises).then(function() {
                showToast('원산지 코드 ' + toFix.length + '건 자동 수정 완료 (03: 상세설명에 표시)', 'success');
                console.log('[Migration] 원산지 코드 수정 완료');
            }).catch(function(err) {
                console.error('[Migration] 원산지 수정 실패:', err);
            });
        }

        initRouter();
        initSidebar();
        initWizard();
        initStep1Extras();
        initCategorySearch();
        initOriginSearch();
        initImageManager();
        initOptionBuilder();
        initProductList();
        initExport();
        initPresets();
        initMarginPresets();
        initAddresses();
        initFooterImages();
        // startNewProduct()는 handleRoute() → #register 진입 시 자동 호출
        updateConnectionStatus(true);
    }).catch(function(err) {
        console.error('[App] 초기화 실패:', err);
        // 폴백으로라도 앱 초기화
        initRouter();
        initSidebar();
        initWizard();
        initStep1Extras();
        initCategorySearch();
        initOriginSearch();
        initImageManager();
        initOptionBuilder();
        initProductList();
        initExport();
        initPresets();
        initMarginPresets();
        initAddresses();
        initFooterImages();
        // startNewProduct()는 handleRoute() → #register 진입 시 자동 호출
        updateConnectionStatus(false);
    });
});

function updateConnectionStatus(online) {
    // 포털 전용 — 상태 표시 생략
    console.log('[App] 서버 연결 상태:', online ? '연결됨' : '오프라인');
}

// ════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════
var _lastHash = location.hash.replace('#', '') || 'register';
var _isDirty = false;
var _isEditing = false;  // 편집 모드 플래그 (true면 startNewProduct 호출 안 함)
var _editMode = false;   // 편집 모드 지속 플래그 (수정완료 버튼 표시용)
var _ignoreHashChange = false;

function initRouter() {
    window.addEventListener('hashchange', function() {
        if (_ignoreHashChange) {
            _ignoreHashChange = false;
            return;
        }

        var newHash = location.hash.replace('#', '') || 'register';

        if (_lastHash === 'register' && newHash !== 'register' && _isDirty) {
            if (!confirm('변경된 내용이 있습니다. 저장하지 않고 이동하시겠습니까?')) {
                _ignoreHashChange = true;
                location.hash = 'register';
                return;
            } else {
                _isDirty = false;
            }
        }

        _lastHash = newHash;
        handleRoute();
    });
    handleRoute();

    var regPage = document.getElementById('pageRegister');
    if (regPage) {
        regPage.addEventListener('input', function() { _isDirty = true; });
        regPage.addEventListener('change', function() { _isDirty = true; });
    }

    var btnCancelEdit = document.getElementById('btnCancelEdit');
    if (btnCancelEdit) {
        btnCancelEdit.addEventListener('click', function() {
            location.hash = 'products';
        });
    }

    // "상품등록" 탭 클릭 시: 같은 해시(register→register)에서도 새 상품 폼 전환
    var registerLink = document.querySelector('#portalTabs a[href="#register"]') || document.querySelector('.menu a[href="#register"]');
    if (registerLink) {
        registerLink.addEventListener('click', function(e) {
            var currentHash = location.hash.replace('#', '') || 'register';
            if (currentHash === 'register') {
                e.preventDefault();
                if (_isDirty) {
                    if (!confirm('변경된 내용이 있습니다. 저장하지 않고 새 상품을 등록하시겠습니까?')) {
                        return;
                    }
                }
                _isEditing = false;
                startNewProduct();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }
}

function handleRoute() {
    var hash = location.hash.replace('#', '') || 'register';
    var pages = {register:'pageRegister', products:'pageProducts', export:'pageExport', presets:'pagePresets', marginPresets:'pageMarginPresets', addresses:'pageAddresses', footerImages:'pageFooterImages'};
    var titles = {register:'상품 등록/수정', products:'상품 목록', export:'엑셀 생성', presets:'배송 프리셋', marginPresets:'마진 프리셋', addresses:'주소록', footerImages:'안내 이미지'};
    Object.values(pages).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    var pageId = pages[hash];
    if (pageId) {
        var el = document.getElementById(pageId);
        if (el) el.classList.add('active');
    }
    var topbarEl = document.getElementById('topbarTitle');
    if (topbarEl) topbarEl.textContent = titles[hash] || '상품 등록';
    
    var btnCancel = document.getElementById('btnCancelEdit');
    if (btnCancel) {
        if (hash === 'register') btnCancel.classList.remove('hidden');
        else btnCancel.classList.add('hidden');
    }

    // 탭 네비게이션 active 상태 업데이트 (portal-tabs 또는 .menu)
    var tabSelector = document.getElementById('portalTabs') ? '#portalTabs a' : '.menu a';
    document.querySelectorAll(tabSelector).forEach(function(a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + hash);
    });
    if (hash === 'products') refreshProductList();
    if (hash === 'export') {
        if (typeof renderExportCart === 'function') renderExportCart();
        else updateExportSummary();
    }
    // register 진입 시: 편집 모드가 아니면 새 상품 폼 초기화
    if (hash === 'register' && !_isEditing) {
        startNewProduct();
    }
    _isEditing = false;  // 플래그 리셋
}

function updateExportSummary() {
    var checkedBoxes = document.querySelectorAll('.cart-row-check:checked');
    var el1 = document.getElementById('exportProductCount');
    var el2 = document.getElementById('exportImageCount');
    if (el1) el1.textContent = checkedBoxes.length;
    
    if (el2) {
        var imgCount = 0;
        checkedBoxes.forEach(function(cb) {
            var imgs = Storage.getProductImages(cb.dataset.id);
            if (imgs.main) imgCount++;
            imgCount += (imgs.additional || []).length;
            imgCount += (imgs.detail || []).length;
        });
        el2.textContent = imgCount;
    }
}

// ════════════════════════════════════════
// SIDEBAR (포털 전용 — 탭 네비게이션으로 대체됨)
// ════════════════════════════════════════
function initSidebar() {
    // 사이드바 제거됨 — 탭 네비게이션은 hashchange로 자동 동작
}

// ════════════════════════════════════════
// WIZARD
// ════════════════════════════════════════
function initWizard() {
    document.getElementById('btnNext1').addEventListener('click', function() { if (validateStep(1)) { collectStepData(1); goToStep(2); } });
    document.getElementById('btnPrev2').addEventListener('click', function() { collectStepData(2); goToStep(1); });
    document.getElementById('btnNext2').addEventListener('click', function() { if (validateStep(2)) { collectStepData(2); goToStep(3); } });
    document.getElementById('btnPrev3').addEventListener('click', function() { collectStepData(3); goToStep(2); });
    document.getElementById('btnNext3').addEventListener('click', function() { collectStepData(3); goToStep(4); });
    document.getElementById('btnPrev4').addEventListener('click', function() { goToStep(3); });
    document.getElementById('btnNext4').addEventListener('click', function() { goToStep(5); });
    document.getElementById('btnPrev5').addEventListener('click', function() { goToStep(4); });
    document.getElementById('btnNext5').addEventListener('click', function() { collectStepData(5); goToStep(6); renderPreview(); });
    document.getElementById('btnPrev6').addEventListener('click', function() { goToStep(5); });
    document.getElementById('btnSave').addEventListener('click', saveProduct);
    document.getElementById('btnDraft').addEventListener('click', saveDraft);

    // Clickable wizard steps (for edit mode)
    document.querySelectorAll('.wizard-step').forEach(function(step) {
        step.addEventListener('click', function() {
            if (!this.classList.contains('clickable')) return;
            var targetStep = parseInt(this.dataset.step);
            collectStepData(currentStep); // Save current progress before jumping
            if (targetStep === 6) renderPreview();
            goToStep(targetStep);
        });
    });
}

function goToStep(n) {
    currentStep = n;
    document.querySelectorAll('.step-panel').forEach(function(p) { p.classList.remove('active'); });
    var panel = document.getElementById('step' + n);
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.wizard-step').forEach(function(s) {
        var stepNum = parseInt(s.dataset.step);
        s.classList.remove('active', 'completed');
        if (stepNum < n) s.classList.add('completed');
        if (stepNum === n) s.classList.add('active');
    });
}

// ── 관리번호 lazy 생성 (Promise 캐시) ──
var _codePromise = null;

function ensureProductCode() {
    // 이미 코드가 있으면 즉시 반환
    if (currentProduct.code) return Promise.resolve(currentProduct.code);
    // 이미 생성 중이면 같은 Promise 반환 (중복 API 호출 방지)
    if (_codePromise) return _codePromise;
    _codePromise = generateProductCode().then(function(code) {
        currentProduct.code = code;
        document.getElementById('fldCode').value = code;
        document.getElementById('fldCode').style.color = 'var(--on-surface)';
        _codePromise = null;
        return code;
    }).catch(function(err) {
        _codePromise = null;
        var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        var fallback = 'KNG-' + today + '-000';
        currentProduct.code = fallback;
        document.getElementById('fldCode').value = fallback;
        console.error('[App] 관리번호 생성 실패, 폴백:', err);
        return fallback;
    });
    return _codePromise;
}

function startNewProduct() {
    _isDirty = false;
    _editMode = false;  // 신규 등록 모드
    _codePromise = null;  // 코드 생성 캐시 리셋
    currentImages = { main: null, additional: [], detail: [] };
    currentProduct = createEmptyProduct();
    currentProduct.code = '';

    populateForm();

    selectOrigin('03', '상세설명에 표시');

    // 신규 등록 시 위자드 스텝 클릭 비활성화
    document.querySelectorAll('.wizard-step').forEach(function(s) {
        s.classList.remove('clickable');
    });

    // 수정완료 버튼 숨김
    document.querySelectorAll('.btn-edit-save').forEach(function(btn) {
        btn.classList.add('hidden');
    });

    goToStep(1);
}

// 편집 모드에서 수정완료 버튼 클릭 시 호출
function saveFromEditMode() {
    // 모든 스텝 데이터 수집 후 저장
    [1, 2, 3, 4, 5].forEach(function(s) { collectStepData(s); });
    if (!currentProduct.productName) { showToast('스토어 상품명을 입력하세요.', 'warning'); goToStep(1); return; }
    if (!currentProduct.categoryId) { showToast('카테고리를 선택하세요.', 'warning'); goToStep(1); return; }
    if (!currentProduct.salePrice) { showToast('판매가를 입력하세요.', 'warning'); goToStep(2); return; }

    currentProduct.updatedAt = new Date().toISOString();
    currentProduct._images = currentImages;

    ensureProductCode().then(function() {
        return Storage.saveProduct(currentProduct);
    }).then(function() {
        showToast('상품이 수정되었습니다!', 'success');
        refreshProductList();
        _isDirty = false;
        _editMode = false;
        location.hash = 'products';
    }).catch(function(err) {
        showToast('저장 실패: ' + err.message, 'error');
    });
}

// ════════════════════════════════════════
// STEP 1 EXTRAS
// ════════════════════════════════════════
// 스토어 상품명 수동 편집 감지 플래그
var _storeNameManuallyEdited = false;
var _lastSyncedInternalName = '';

function initStep1Extras() {
    // Character counter for store product name
    var nameInput = document.getElementById('fldProductName');
    var nameCounter = document.getElementById('nameCounter');
    if (nameInput && nameCounter) {
        nameInput.addEventListener('input', function() {
            var len = nameInput.value.length;
            nameCounter.textContent = len + '/100';
            nameCounter.style.color = len >= 96 ? 'var(--danger)' : len >= 81 ? '#d97706' : 'var(--gray-400)';
        });
    }

    // 실제 상품명 → 스토어 상품명 자동 동기화
    var internalInput = document.getElementById('fldInternalName');
    if (internalInput && nameInput) {
        internalInput.addEventListener('input', function() {
            var internalVal = internalInput.value;
            // 스토어 상품명이 비어있거나, 이전 동기화 값과 동일하거나, 이전 동기화 값으로 시작하면 동기화
            var storeVal = nameInput.value;
            if (!_storeNameManuallyEdited || storeVal === '' || storeVal === _lastSyncedInternalName) {
                nameInput.value = internalVal;
                _lastSyncedInternalName = internalVal;
                _storeNameManuallyEdited = false;
                // 카운터 업데이트
                if (nameCounter) {
                    var len = internalVal.length;
                    nameCounter.textContent = len + '/100';
                    nameCounter.style.color = len >= 96 ? 'var(--danger)' : len >= 81 ? '#d97706' : 'var(--gray-400)';
                }
            }
        });

        // 사용자가 스토어 상품명을 직접 수정하면 수동 편집 플래그 ON
        nameInput.addEventListener('input', function() {
            // 현재 값이 동기화 값과 다르면 사용자가 수정한 것
            if (nameInput.value !== _lastSyncedInternalName) {
                _storeNameManuallyEdited = true;
            }
        });
    }

    // VAT checkbox sync
    var vatSelect = document.getElementById('fldVat');
    var vatCheckbox = document.getElementById('fldVatIncluded');
    if (vatSelect && vatCheckbox) {
        vatSelect.addEventListener('change', function() {
            vatCheckbox.checked = (vatSelect.value === '과세상품');
            updateMarginDisplay();
            calculateRecommendedPrice();
        });
    }

    // Margin calculator
    var saleInput = document.getElementById('fldSalePrice');
    var buyInput = document.getElementById('fldBuyPrice');
    var saleShipInput = document.getElementById('fldSaleShippingFee');
    var buyShipInput = document.getElementById('fldBuyShippingFee');
    if (saleInput && buyInput) {
        saleInput.addEventListener('input', updateMarginDisplay);
        buyInput.addEventListener('input', function() {
            calculateRecommendedPrice();
            updateMarginDisplay();
        });
    }
    if (saleShipInput) saleShipInput.addEventListener('input', function() {
        calculateRecommendedPrice();
        updateMarginDisplay();
    });
    if (buyShipInput) buyShipInput.addEventListener('input', function() {
        calculateRecommendedPrice();
        updateMarginDisplay();
    });

    // Stock field color change
    var stockInput = document.getElementById('fldStock');
    if (stockInput) {
        stockInput.addEventListener('input', function() {
            stockInput.style.color = stockInput.value ? 'var(--on-surface)' : 'var(--gray-400)';
        });
    }
}

function calculateRecommendedPrice() {
    var presetId = document.getElementById('fldMarginPreset').value;
    var labelEl = document.getElementById('recommendedPriceLabel');
    if (!presetId || !labelEl) {
        if (labelEl) labelEl.style.display = 'none';
        return;
    }
    
    var presets = Storage.getMarginPresets();
    var p = presets.find(function(x) { return x.id === presetId; });
    if (!p) {
        labelEl.style.display = 'none';
        return;
    }
    
    var buyPrice = parseInt(document.getElementById('fldBuyPrice').value) || 0;
    var buyShip = parseInt(document.getElementById('fldBuyShippingFee').value) || 0;
    var saleShip = parseInt(document.getElementById('fldSaleShippingFee').value) || 0;
    
    var totalCost = buyPrice + buyShip;
    var vatType = document.getElementById('fldVat') ? document.getElementById('fldVat').value : '과세상품';
    var isTaxable = (vatType === '과세상품');
    var taxDivider = isTaxable ? 1.1 : 1.0;
    
    function calcPrice(target, type) {
        // 목표 마진을 얻기 위한 수식
        // 수익 = (판매가+판매배송비)/taxDivider - (매입가+매입배송비)
        // 원(KRW): (판매가+판매배송비) = (목표 + 총원가) * taxDivider
        // 퍼센트(%): 수익 = ((판매가+판매배송비)/taxDivider) * (목표%/100)
        // -> 목표금액(원) = ((판매가+판매배송비)/taxDivider) * (목표%/100)
        // -> (판매가+판매배송비)/taxDivider - 총원가 = ((판매가+판매배송비)/taxDivider) * (목표%/100)
        // -> ((판매가+판매배송비)/taxDivider) * (1 - 목표%/100) = 총원가
        // -> (판매가+판매배송비) = (총원가 / (1 - 목표%/100)) * taxDivider
        
        var targetTotalSale = 0;
        if (type === '원') {
            targetTotalSale = (totalCost + target) * taxDivider;
        } else if (type === '%') {
            if (target >= 100) target = 99; // 마진율 100% 이상은 불가능하므로 보정
            targetTotalSale = (totalCost / (1 - (target/100))) * taxDivider;
        }
        
        var recommendedSalePrice = targetTotalSale - saleShip;
        
        // 100원 단위 올림(Math.ceil)
        // ex) 15312 -> 15400
        return Math.ceil(recommendedSalePrice / 100) * 100;
    }
    
    var minSale = calcPrice(p.minTarget, p.type);
    
    var text = '💡 추천: ' + formatCurrency(minSale) + '원';
    if (p.maxTarget != null) {
        var maxSale = calcPrice(p.maxTarget, p.type);
        text += ' ~ ' + formatCurrency(maxSale) + '원';
    }
    
    labelEl.textContent = text;
    labelEl.style.display = 'inline';
    
    // 사용자가 프리셋을 고르거나 원가를 입력할 때, 판매가가 비어있거나 기존 추천가와 동일했다면 자동 갱신
    var saleInput = document.getElementById('fldSalePrice');
    if (saleInput && (!saleInput.value || saleInput.value === '0' || parseInt(saleInput.value) === window._lastRecommendedSalePrice)) {
        saleInput.value = minSale;
        window._lastRecommendedSalePrice = minSale;
        // 판매가 자동 갱신 후 마진 표시도 즉시 반영
        updateMarginDisplay();
    }
}

function updateMarginDisplay() {
    var salePrice = parseInt(document.getElementById('fldSalePrice').value) || 0;
    var buyPrice = parseInt(document.getElementById('fldBuyPrice').value) || 0;
    var saleShip = parseInt(document.getElementById('fldSaleShippingFee').value) || 0;
    var buyShip = parseInt(document.getElementById('fldBuyShippingFee').value) || 0;
    var wrap = document.getElementById('marginDisplayWrap');
    var amountEl = document.getElementById('marginAmount');
    var rateEl = document.getElementById('marginRate');
    if (!wrap || !amountEl || !rateEl) return;
    if (salePrice > 0 && buyPrice > 0) {
        wrap.style.display = 'block';
        var vatType = document.getElementById('fldVat').value;
        var totalSale = salePrice + saleShip;
        var totalBuy = buyPrice + buyShip;
        var netSale = (vatType === '과세상품') ? Math.round(totalSale / 1.1) : totalSale;
        var margin = netSale - totalBuy;
        var marginRate = ((margin / netSale) * 100).toFixed(1);
        amountEl.textContent = formatCurrency(margin) + '원';
        amountEl.style.color = margin >= 0 ? 'var(--primary)' : 'var(--danger)';
        rateEl.textContent = marginRate + '%';
        rateEl.style.color = margin >= 0 ? 'var(--primary)' : 'var(--danger)';
    } else {
        wrap.style.display = 'none';
    }
}

// ════════════════════════════════════════
// VALIDATION
// ════════════════════════════════════════
function validateStep(step) {
    if (step === 1) {
        var catId = document.getElementById('fldCategoryId').value;
        var name = document.getElementById('fldProductName').value.trim();
        if (!catId) { showToast('카테고리를 선택해주세요.', 'warning'); return false; }
        if (!name) { showToast('상품명을 입력해주세요.', 'warning'); return false; }
    } else if (step === 2) {
        var price = parseInt(document.getElementById('fldSalePrice').value);
        if (!price || price <= 0) { showToast('판매가를 입력해주세요.', 'warning'); return false; }
    }
    return true;
}

// ════════════════════════════════════════
// DATA COLLECTION
// ════════════════════════════════════════
function collectStepData(step) {
    if (!currentProduct) return;
    if (step === 1) {
        currentProduct.categoryId = document.getElementById('fldCategoryId').value;
        currentProduct.categoryName = document.getElementById('categoryPath').textContent || '';
        currentProduct.productStatus = document.getElementById('fldStatus').value;
        currentProduct.internalName = document.getElementById('fldInternalName').value.trim();
        currentProduct.productName = document.getElementById('fldProductName').value.trim();
        currentProduct.totalVolume = document.getElementById('fldTotalVolume').value;
    } else if (step === 2) {
        currentProduct.salePrice = parseInt(document.getElementById('fldSalePrice').value) || 0;
        currentProduct.buyPrice = parseInt(document.getElementById('fldBuyPrice').value) || 0;
        currentProduct.saleShippingFee = parseInt(document.getElementById('fldSaleShippingFee').value) || 0;
        currentProduct.buyShippingFee = parseInt(document.getElementById('fldBuyShippingFee').value) || 0;
        currentProduct.stock = parseInt(document.getElementById('fldStock').value) || 0;
        currentProduct.vat = document.getElementById('fldVat').value;
        currentProduct.minorPurchase = document.getElementById('fldMinorPurchase').value;
        currentProduct.shippingPresetId = document.getElementById('fldShippingPreset').value;
        currentProduct.shippingAddressId = document.getElementById('fldShippingAddress').value;
        currentProduct.returnAddressId = document.getElementById('fldReturnAddress').value;
        currentProduct.asPhone = document.getElementById('fldAsPhone').value.trim();
        currentProduct.asGuide = document.getElementById('fldAsGuide').value.trim();
        var lowestPriceCb = document.getElementById('fldLowestPrice');
        currentProduct.isLowestPrice = lowestPriceCb ? lowestPriceCb.checked : false;
    } else if (step === 3) {
        var optData = collectOptionData();
        currentProduct.optionType = optData.optionType;
        currentProduct.optionNames = optData.optionNames;
        currentProduct.optionValues = optData.optionValues;
        currentProduct.combinations = optData.combinations;
        if (!optionEnabled) currentProduct.stock = optData.stock;
    } else if (step === 4) {
        var nEl = document.getElementById('fldNoticeImageId');
        var cEl = document.getElementById('fldConsentImageId');
        if (nEl) currentProduct.noticeImageId = nEl.value;
        if (cEl) currentProduct.consentImageId = cEl.value;
    } else if (step === 5) {
        currentProduct.brand = document.getElementById('fldBrand').value.trim();
        currentProduct.manufacturer = document.getElementById('fldManufacturer').value.trim();
        currentProduct.originCode = document.getElementById('fldOriginCode').value;
        currentProduct.originName = document.getElementById('originPath').textContent || '';
        currentProduct.mfgDate = document.getElementById('fldMfgDate').value;
        currentProduct.summary = document.getElementById('fldSummary').value.trim();
        currentProduct.tags = document.getElementById('fldTags').value.trim();
        currentProduct.noticeName = document.getElementById('fldNotice_name').value.trim();
        currentProduct.noticeModel = document.getElementById('fldNotice_model').value.trim();
        currentProduct.noticeCert = document.getElementById('fldNotice_cert').value.trim();
        currentProduct.noticeMaker = document.getElementById('fldNotice_maker').value.trim();
    }
}

// ════════════════════════════════════════
// POPULATE FORM
// ════════════════════════════════════════
function populateForm() {
    if (!currentProduct) return;
    var codeField = document.getElementById('fldCode');
    if (currentProduct.code) {
        codeField.value = currentProduct.code;
        codeField.style.color = 'var(--on-surface)';
    } else {
        codeField.value = '저장 시 자동 생성';
        codeField.style.color = 'var(--gray-400)';
    }
    document.getElementById('fldStatus').value = currentProduct.productStatus || '신상품';
    document.getElementById('fldInternalName').value = currentProduct.internalName || '';
    document.getElementById('fldProductName').value = currentProduct.productName || '';
    document.getElementById('fldSalePrice').value = currentProduct.salePrice || 0;
    document.getElementById('fldBuyPrice').value = currentProduct.buyPrice || 0;
    document.getElementById('fldSaleShippingFee').value = currentProduct.saleShippingFee || 0;
    document.getElementById('fldBuyShippingFee').value = currentProduct.buyShippingFee || 0;
    document.getElementById('fldStock').value = currentProduct.stock || '';
    if (currentProduct.stock && currentProduct.stock > 0) {
        document.getElementById('fldStock').style.color = 'var(--on-surface)';
    } else {
        document.getElementById('fldStock').style.color = 'var(--gray-400)';
    }
    document.getElementById('fldVat').value = currentProduct.vat || '과세상품';
    document.getElementById('fldMinorPurchase').value = currentProduct.minorPurchase || 'Y';
    // Sync VAT checkbox and margin display
    var vatCb = document.getElementById('fldVatIncluded');
    if (vatCb) vatCb.checked = (currentProduct.vat === '과세상품' || !currentProduct.vat);
    var nameCounter = document.getElementById('nameCounter');
    if (nameCounter) {
        var len = (currentProduct.productName || '').length;
        nameCounter.textContent = len + '/100';
        nameCounter.style.color = len >= 96 ? 'var(--danger)' : len >= 81 ? '#d97706' : 'var(--gray-400)';
    }
    updateMarginDisplay();
    // Restore option state
    restoreOptionState(currentProduct);
    document.getElementById('fldBrand').value = currentProduct.brand || '';
    document.getElementById('fldManufacturer').value = currentProduct.manufacturer || '';
    // Origin
    var originSel = document.getElementById('originSelected');
    if (currentProduct.originCode && currentProduct.originName) {
        document.getElementById('fldOriginCode').value = currentProduct.originCode;
        document.getElementById('originPath').textContent = currentProduct.originName;
        originSel.classList.remove('hidden');
    } else {
        originSel.classList.add('hidden');
        document.getElementById('fldOriginCode').value = '';
    }
    document.getElementById('fldMfgDate').value = currentProduct.mfgDate || '';
    document.getElementById('fldSummary').value = currentProduct.summary || '';
    document.getElementById('fldTags').value = currentProduct.tags || '';
    document.getElementById('fldNotice_name').value = currentProduct.noticeName || '';
    document.getElementById('fldNotice_model').value = currentProduct.noticeModel || '';
    document.getElementById('fldNotice_cert').value = currentProduct.noticeCert || '';
    document.getElementById('fldNotice_maker').value = currentProduct.noticeMaker || '';
    // Category
    var catSel = document.getElementById('categorySelected');
    if (currentProduct.categoryId && currentProduct.categoryName) {
        document.getElementById('fldCategoryId').value = currentProduct.categoryId;
        document.getElementById('categoryPath').textContent = currentProduct.categoryName;
        catSel.classList.remove('hidden');
        checkUnitPriceCategory(currentProduct.categoryId);
    } else {
        catSel.classList.add('hidden');
        document.getElementById('fldCategoryId').value = '';
        checkUnitPriceCategory('');
    }
    if (currentProduct.totalVolume) document.getElementById('fldTotalVolume').value = currentProduct.totalVolume;
    renderImagePreviews();
    
    document.getElementById('fldNoticeImageId').value = currentProduct.noticeImageId || '';
    document.getElementById('fldConsentImageId').value = currentProduct.consentImageId || '';
    if (typeof renderFooterImagePreviews === 'function') renderFooterImagePreviews();
    
    // Step 2: Restore shipping preset & address selections
    var presetSel = document.getElementById('fldShippingPreset');
    if (presetSel && currentProduct.shippingPresetId) {
        presetSel.value = currentProduct.shippingPresetId;
        if (typeof renderPresetSummary === 'function') renderPresetSummary(currentProduct.shippingPresetId);
    }
    var shipAddrSel = document.getElementById('fldShippingAddress');
    if (shipAddrSel && currentProduct.shippingAddressId) shipAddrSel.value = currentProduct.shippingAddressId;
    var retAddrSel = document.getElementById('fldReturnAddress');
    if (retAddrSel && currentProduct.returnAddressId) retAddrSel.value = currentProduct.returnAddressId;
    // AS info
    var asPhoneEl = document.getElementById('fldAsPhone');
    if (asPhoneEl) asPhoneEl.value = currentProduct.asPhone || '02-2038-0160';
    var asGuideEl = document.getElementById('fldAsGuide');
    if (asGuideEl) asGuideEl.value = currentProduct.asGuide || '상품상세 참조';
    // 온라인 최저가
    var lowestPriceCb = document.getElementById('fldLowestPrice');
    if (lowestPriceCb) lowestPriceCb.checked = !!currentProduct.isLowestPrice;
    // 동기화 플래그 초기화
    _storeNameManuallyEdited = !!(currentProduct.productName && currentProduct.internalName && currentProduct.productName !== currentProduct.internalName);
    _lastSyncedInternalName = currentProduct.internalName || '';
}

// ════════════════════════════════════════
// CATEGORY SEARCH
// ════════════════════════════════════════
// Keyboard-navigable index for category dropdown
var _catHighlightIdx = -1;

function _getCategoryItems() {
    var dropdown = document.getElementById('categoryDropdown');
    if (!dropdown) return [];
    return Array.prototype.slice.call(dropdown.querySelectorAll('.category-item'));
}

function _setCategoryHighlight(idx) {
    var items = _getCategoryItems();
    // Remove previous highlight
    items.forEach(function(el) { el.classList.remove('kb-active'); });
    if (idx < 0 || idx >= items.length) { _catHighlightIdx = -1; return; }
    _catHighlightIdx = idx;
    items[idx].classList.add('kb-active');
    // Scroll into view within the dropdown
    var resultsContainer = items[idx].closest('.category-results') || items[idx].closest('.category-recent');
    if (!resultsContainer) resultsContainer = items[idx].parentElement;
    var parent = document.getElementById('categoryDropdown');
    if (parent) {
        var itemTop = items[idx].offsetTop;
        var itemBottom = itemTop + items[idx].offsetHeight;
        var scrollTop = parent.scrollTop;
        var viewBottom = scrollTop + parent.clientHeight;
        if (itemBottom > viewBottom) parent.scrollTop = itemBottom - parent.clientHeight;
        if (itemTop < scrollTop) parent.scrollTop = itemTop;
    }
}

function initCategorySearch() {
    var input = document.getElementById('fldCategorySearch');
    var dropdown = document.getElementById('categoryDropdown');
    var clearBtn = document.getElementById('btnClearCategory');
    if (!input) return;
    input.addEventListener('focus', function() {
        dropdown.classList.remove('hidden');
        dropdown.classList.add('active');
        _catHighlightIdx = -1;
        if (!input.value.trim()) renderCategoryList(CATEGORY_DATA.slice(0, 50));
    });
    input.addEventListener('input', debounce(function() {
        _catHighlightIdx = -1;
        var q = input.value.trim().toLowerCase();
        if (q.length < 1) { renderCategoryList(CATEGORY_DATA.slice(0, 50)); return; }
        var results = CATEGORY_DATA.filter(function(c) {
            var full = (c.l1 + ' ' + c.l2 + ' ' + c.l3 + ' ' + c.l4).toLowerCase();
            return full.indexOf(q) >= 0;
        }).slice(0, 80);
        renderCategoryList(results);
    }, 200));
    // Keyboard navigation (Arrow Down/Up, Enter, Escape)
    input.addEventListener('keydown', function(e) {
        var items = _getCategoryItems();
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = _catHighlightIdx + 1;
            if (next >= items.length) next = 0; // wrap around
            _setCategoryHighlight(next);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = _catHighlightIdx - 1;
            if (prev < 0) prev = items.length - 1; // wrap around
            _setCategoryHighlight(prev);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (_catHighlightIdx >= 0 && _catHighlightIdx < items.length) {
                var item = items[_catHighlightIdx];
                selectCategory(item.dataset.id, item.dataset.path);
                _catHighlightIdx = -1;
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dropdown.classList.remove('active');
            dropdown.classList.add('hidden');
            _catHighlightIdx = -1;
            input.blur();
        }
    });
    document.addEventListener('click', function(e) {
        var container = document.getElementById('categorySearchContainer');
        if (container && !container.contains(e.target)) {
            dropdown.classList.remove('active');
            dropdown.classList.add('hidden');
            _catHighlightIdx = -1;
        }
    });
    if (clearBtn) clearBtn.addEventListener('click', function() {
        document.getElementById('fldCategoryId').value = '';
        document.getElementById('categorySelected').classList.add('hidden');
        input.value = '';
        if (currentProduct) { currentProduct.categoryId = ''; currentProduct.categoryName = ''; }
        checkUnitPriceCategory('');
    });
    renderCategoryFavorites();
}

function renderCategoryList(items) {
    var list = document.getElementById('categoryResults');
    if (!list) return;
    if (items.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);font-size:12px;">검색 결과가 없습니다.</div>';
        return;
    }
    var html = '';
    items.forEach(function(cat) {
        var path = [cat.l1, cat.l2, cat.l3, cat.l4].filter(Boolean).join(' > ');
        html += '<div class="category-item" data-id="' + cat.id + '" data-path="' + path.replace(/"/g, '&quot;') + '">';
        html += '<span>' + path + '</span><span class="cat-code">' + cat.id + '</span></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.category-item').forEach(function(item) {
        item.addEventListener('click', function() { selectCategory(item.dataset.id, item.dataset.path); });
    });
}

function selectCategory(id, path) {
    document.getElementById('fldCategoryId').value = id;
    document.getElementById('categoryPath').textContent = path;
    document.getElementById('categorySelected').classList.remove('hidden');
    document.getElementById('categoryDropdown').classList.remove('active');
    document.getElementById('categoryDropdown').classList.add('hidden');
    document.getElementById('fldCategorySearch').value = '';
    if (currentProduct) { currentProduct.categoryId = id; currentProduct.categoryName = path; }
    checkUnitPriceCategory(id);
    var favs = Storage.getCategoryFavorites();
    if (!favs.find(function(f) { return f.id === id; })) {
        favs.unshift({ id: id, path: path });
        if (favs.length > 10) favs = favs.slice(0, 10);
        Storage.saveCategoryFavorites(favs);
        renderCategoryFavorites();
    }
}

function checkUnitPriceCategory(categoryId) {
    var alertWrap = document.getElementById('unitPriceAlertWrap');
    var volumeWrap = document.getElementById('unitPriceTotalVolumeWrap');
    var infoEl = document.getElementById('unitPriceInfo');
    var helpEl = document.getElementById('totalVolumeHelp');
    if (!alertWrap || !volumeWrap) return;

    if (categoryId && typeof UNIT_PRICE_CATEGORIES !== 'undefined' && UNIT_PRICE_CATEGORIES[categoryId]) {
        var info = UNIT_PRICE_CATEGORIES[categoryId];
        alertWrap.classList.remove('hidden');
        volumeWrap.classList.remove('hidden');
        infoEl.textContent = '표시용량: ' + info.v + ' / 표시단위: ' + info.u;
        helpEl.textContent = '단위: ' + info.u + ' (예: 500' + info.u + '이면 500 입력)';
        if (currentProduct) {
            currentProduct.displayVolume = info.v;
            currentProduct.displayUnit = info.u;
            currentProduct.unitPriceRequired = true;
        }
    } else {
        alertWrap.classList.add('hidden');
        volumeWrap.classList.add('hidden');
        document.getElementById('fldTotalVolume').value = '';
        if (currentProduct) {
            currentProduct.displayVolume = '';
            currentProduct.displayUnit = '';
            currentProduct.totalVolume = '';
            currentProduct.unitPriceRequired = false;
        }
    }
}

function renderCategoryFavorites() {
    var wrap = document.getElementById('categoryRecent');
    if (!wrap) return;
    var favs = Storage.getCategoryFavorites();
    if (favs.length === 0) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';
    var html = '<div class="category-section-label">최근 선택 카테고리</div>';
    favs.forEach(function(f) {
        html += '<div class="category-item" data-id="' + f.id + '" data-path="' + (f.path || '').replace(/"/g, '&quot;') + '">';
        html += '<span>' + (f.path || f.id) + '</span><span class="cat-code">' + f.id + '</span></div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.category-item').forEach(function(item) {
        item.addEventListener('click', function() { selectCategory(item.dataset.id, item.dataset.path); });
    });
}

// ════════════════════════════════════════
// PREVIEW
// ════════════════════════════════════════
function renderPreview() {
    var el = document.getElementById('previewContent');
    if (!el || !currentProduct) return;
    var p = currentProduct;
    var displayStock = p.stock || 0;
    if (p.combinations && p.combinations.length > 0) {
        displayStock = p.combinations.reduce(function(sum, combo) { return sum + (combo.stock || 0); }, 0);
    }
    
    var html = '<div style="padding:20px;">';
    html += '<h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">' + (p.productName || '(상품명 미입력)') + '</h3>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">';
    html += '<div><span style="color:var(--gray-400);">카테고리:</span> ' + (p.categoryName || '-') + '</div>';
    html += '<div><span style="color:var(--gray-400);">판매가:</span> ' + formatCurrency(p.salePrice) + '원</div>';
    html += '<div><span style="color:var(--gray-400);">재고:</span> ' + displayStock + '</div>';
    html += '<div><span style="color:var(--gray-400);">부가세:</span> ' + (p.vat || '-') + '</div>';
    html += '<div><span style="color:var(--gray-400);">브랜드:</span> ' + (p.brand || '-') + '</div>';
    html += '<div><span style="color:var(--gray-400);">제조사:</span> ' + (p.manufacturer || '-') + '</div>';
    if (p.optionType) {
        html += '<div style="grid-column:1/-1;"><span style="color:var(--gray-400);">옵션:</span> ' + p.optionType;
        if (p.combinations && p.combinations.length > 0) html += ' (' + p.combinations.length + '개 조합)';
        html += '</div>';
    }
    html += '</div></div>';
    el.innerHTML = html;
}

// ════════════════════════════════════════
// ORIGIN SEARCH
// ════════════════════════════════════════
var _originHighlightIdx = -1;

// Quick-access origin shortcuts
var ORIGIN_QUICK_LIST = [
    { code: '00', name: '국산', path: '국산' },
    { code: '0200037', name: '중국', path: '수입 > 아시아 > 중국' },
    { code: '0200014', name: '베트남', path: '수입 > 아시아 > 베트남' },
    { code: '0200036', name: '일본', path: '수입 > 아시아 > 일본' },
    { code: '0200002', name: '대만', path: '수입 > 아시아 > 대만' },
    { code: '0200034', name: '인도네시아', path: '수입 > 아시아 > 인도네시아' },
    { code: '0200044', name: '태국', path: '수입 > 아시아 > 태국' },
    { code: '0204000', name: '미국', path: '수입 > 북미 > 미국' },
    { code: '0201005', name: '독일', path: '수입 > 유럽 > 독일' },
    { code: '03', name: '상세설명에 표시', path: '상세설명에 표시' },
    { code: '04', name: '직접입력', path: '직접입력' }
];

function _getOriginItems() {
    var dropdown = document.getElementById('originDropdown');
    if (!dropdown) return [];
    return Array.prototype.slice.call(dropdown.querySelectorAll('.category-item'));
}

function _setOriginHighlight(idx) {
    var items = _getOriginItems();
    items.forEach(function(el) { el.classList.remove('kb-active'); });
    if (idx < 0 || idx >= items.length) { _originHighlightIdx = -1; return; }
    _originHighlightIdx = idx;
    items[idx].classList.add('kb-active');
    var parent = document.getElementById('originDropdown');
    if (parent) {
        var itemTop = items[idx].offsetTop;
        var itemBottom = itemTop + items[idx].offsetHeight;
        var scrollTop = parent.scrollTop;
        var viewBottom = scrollTop + parent.clientHeight;
        if (itemBottom > viewBottom) parent.scrollTop = itemBottom - parent.clientHeight;
        if (itemTop < scrollTop) parent.scrollTop = itemTop;
    }
}

function initOriginSearch() {
    var input = document.getElementById('fldOriginSearch');
    var dropdown = document.getElementById('originDropdown');
    var clearBtn = document.getElementById('btnClearOrigin');
    if (!input) return;

    input.addEventListener('focus', function() {
        dropdown.classList.remove('hidden');
        dropdown.classList.add('active');
        _originHighlightIdx = -1;
        if (!input.value.trim()) renderOriginList(ORIGIN_DATA.filter(function(o) { return o.level <= 2; }));
    });

    input.addEventListener('input', debounce(function() {
        _originHighlightIdx = -1;
        var q = input.value.trim().toLowerCase();
        if (q.length < 1) {
            renderOriginList(ORIGIN_DATA.filter(function(o) { return o.level <= 2; }));
            return;
        }
        var results = ORIGIN_DATA.filter(function(o) {
            return o.name.toLowerCase().indexOf(q) >= 0 || o.path.toLowerCase().indexOf(q) >= 0 || o.code.indexOf(q) >= 0;
        }).slice(0, 60);
        renderOriginList(results);
    }, 200));

    // Keyboard navigation
    input.addEventListener('keydown', function(e) {
        var items = _getOriginItems();
        if (!items.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            var next = _originHighlightIdx + 1;
            if (next >= items.length) next = 0;
            _setOriginHighlight(next);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            var prev = _originHighlightIdx - 1;
            if (prev < 0) prev = items.length - 1;
            _setOriginHighlight(prev);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (_originHighlightIdx >= 0 && _originHighlightIdx < items.length) {
                var item = items[_originHighlightIdx];
                selectOrigin(item.dataset.id, item.dataset.path);
                _originHighlightIdx = -1;
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            dropdown.classList.remove('active');
            dropdown.classList.add('hidden');
            _originHighlightIdx = -1;
            input.blur();
        }
    });

    document.addEventListener('click', function(e) {
        var container = document.getElementById('originSearchContainer');
        if (container && !container.contains(e.target)) {
            dropdown.classList.remove('active');
            dropdown.classList.add('hidden');
            _originHighlightIdx = -1;
        }
    });

    if (clearBtn) clearBtn.addEventListener('click', function() {
        document.getElementById('fldOriginCode').value = '';
        document.getElementById('originSelected').classList.add('hidden');
        input.value = '';
        if (currentProduct) { currentProduct.originCode = ''; currentProduct.originName = ''; }
    });

    renderOriginQuick();
}

function renderOriginQuick() {
    var wrap = document.getElementById('originQuick');
    if (!wrap) return;
    var html = '<div class="category-section-label">자주 사용</div>';
    ORIGIN_QUICK_LIST.forEach(function(o) {
        html += '<div class="category-item" data-id="' + o.code + '" data-path="' + o.path.replace(/"/g, '&quot;') + '">';
        html += '<span>' + o.path + '</span><span class="cat-code">' + o.code + '</span></div>';
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.category-item').forEach(function(item) {
        item.addEventListener('click', function() { selectOrigin(item.dataset.id, item.dataset.path); });
    });
}

function renderOriginList(items) {
    var list = document.getElementById('originResults');
    if (!list) return;
    if (items.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--gray-400);font-size:12px;">검색 결과가 없습니다.</div>';
        return;
    }
    var html = '';
    items.forEach(function(o) {
        var indent = o.level === 1 ? 'font-weight:700;' : o.level === 2 ? 'padding-left:20px;' : 'padding-left:36px;font-size:11px;';
        html += '<div class="category-item" data-id="' + o.code + '" data-path="' + o.path.replace(/"/g, '&quot;') + '" style="' + indent + '">';
        html += '<span>' + o.path + '</span><span class="cat-code">' + o.code + '</span></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.category-item').forEach(function(item) {
        item.addEventListener('click', function() { selectOrigin(item.dataset.id, item.dataset.path); });
    });
}

function selectOrigin(code, path) {
    document.getElementById('fldOriginCode').value = code;
    document.getElementById('originPath').textContent = path;
    document.getElementById('originSelected').classList.remove('hidden');
    document.getElementById('originDropdown').classList.remove('active');
    document.getElementById('originDropdown').classList.add('hidden');
    document.getElementById('fldOriginSearch').value = '';
    if (currentProduct) { currentProduct.originCode = code; currentProduct.originName = path; }
}