/* ========================================
   SmartStore Mass Upload — App Features
   Image, Options, Products, Export,
   Presets, Addresses, Save/Draft
   ======================================== */

// ════════════════════════════════════════
// IMAGE MANAGER
// ════════════════════════════════════════
function initImageManager() {
    var mainInput = document.getElementById('mainImageInput');
    var addInput = document.getElementById('addImageInput');
    var detailInput = document.getElementById('detailImageInput');
    if (mainInput) mainInput.addEventListener('change', function (e) {
        if (e.target.files[0]) handleMainImage(e.target.files[0]);
    });
    if (addInput) addInput.addEventListener('change', function (e) { handleAdditionalImages(e.target.files); });
    if (detailInput) detailInput.addEventListener('change', function (e) { handleDetailImages(e.target.files); });

    // URL 버튼 이벤트
    var btnMainUrl = document.getElementById('btnMainImageUrl');
    var btnAddUrl = document.getElementById('btnAddImageUrl');
    var btnDetailUrl = document.getElementById('btnDetailImageUrl');
    if (btnMainUrl) btnMainUrl.addEventListener('click', function() {
        showUrlInputModal('대표 이미지 URL', false, function(urls) { handleMainImageUrl(urls[0]); });
    });
    if (btnAddUrl) btnAddUrl.addEventListener('click', function() {
        showUrlInputModal('추가 이미지 URL (한 줄에 하나씩)', true, function(urls) { handleAdditionalImageUrls(urls); });
    });
    if (btnDetailUrl) btnDetailUrl.addEventListener('click', function() {
        showUrlInputModal('상세설명 이미지 URL (한 줄에 하나씩)', true, function(urls) { handleDetailImageUrls(urls); });
    });
}

// ── URL 입력 모달 ──
function showUrlInputModal(title, multiline, callback) {
    var overlay = document.createElement('div');
    overlay.className = 'url-modal-overlay';
    overlay.innerHTML =
        '<div class="url-modal">' +
        '  <div class="url-modal-title">' + title + '</div>' +
        (multiline
            ? '  <textarea class="url-modal-input" rows="6" placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg"></textarea>'
            : '  <input type="text" class="url-modal-input" placeholder="https://example.com/image.jpg">') +
        '  <div class="url-modal-actions">' +
        '    <button class="btn-outline btn-sm url-modal-cancel">취소</button>' +
        '    <button class="btn-primary btn-sm url-modal-confirm">확인</button>' +
        '  </div>' +
        '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('.url-modal-input');
    input.focus();

    overlay.querySelector('.url-modal-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('.url-modal-confirm').addEventListener('click', function() {
        var value = input.value.trim();
        if (!value) { overlay.remove(); return; }
        var urls = value.split('\n').map(function(u) { return u.trim(); }).filter(function(u) { return u.length > 0; });
        overlay.remove();
        if (urls.length > 0) callback(urls);
    });
}

// ── URL 이미지 핸들러 ──
function handleMainImageUrl(url) {
    showToast('URL에서 이미지 다운로드 중...', 'info');
    ensureProductCode().then(function(code) {
        return Storage.uploadImageFromUrl(url, code, 'main', 0);
    }).then(function(result) {
        currentImages.main = { name: result.filename, url: result.url, autoName: result.autoName, filename: result.filename };
        renderImagePreviews();
        showToast('이미지 다운로드 완료!', 'success');
    }).catch(function(err) {
        showToast('URL 이미지 다운로드 실패: ' + err.message, 'error');
    });
}

function handleAdditionalImageUrls(urls) {
    showToast(urls.length + '개 이미지 다운로드 중...', 'info');
    ensureProductCode().then(function(code) {
        var promises = [];
        urls.forEach(function(url, i) {
            if (currentImages.additional.length + i < 9) {
                promises.push(Storage.uploadImageFromUrl(url, code, 'add', currentImages.additional.length + i));
            }
        });
        return Promise.all(promises);
    }).then(function(results) {
        results.forEach(function(result) {
            currentImages.additional.push({ name: result.filename, url: result.url, autoName: result.autoName, filename: result.filename });
        });
        renderImagePreviews();
        showToast(results.length + '개 이미지 다운로드 완료!', 'success');
    }).catch(function(err) {
        showToast('URL 이미지 다운로드 실패: ' + err.message, 'error');
    });
}

function handleDetailImageUrls(urls) {
    showToast(urls.length + '개 이미지 다운로드 중...', 'info');
    ensureProductCode().then(function(code) {
        var promises = urls.map(function(url, i) {
            return Storage.uploadImageFromUrl(url, code, 'detail', currentImages.detail.length + i);
        });
        return Promise.all(promises);
    }).then(function(results) {
        results.forEach(function(result) {
            currentImages.detail.push({ name: result.filename, url: result.url, autoName: result.autoName, filename: result.filename });
        });
        renderImagePreviews();
        showToast(results.length + '개 이미지 다운로드 완료!', 'success');
    }).catch(function(err) {
        showToast('URL 이미지 다운로드 실패: ' + err.message, 'error');
    });
}

function handleMainImage(file) {
    ensureProductCode().then(function(code) {
        return Storage.uploadImage(file, code, 'main', 0);
    }).then(function(result) {
        currentImages.main = { name: file.name, url: result.url, autoName: result.autoName, filename: result.filename };
        renderImagePreviews();
    }).catch(function(err) {
        showToast('이미지 업로드 실패: ' + err.message, 'error');
    });
}

function handleAdditionalImages(files) {
    ensureProductCode().then(function(code) {
        var promises = [];
        for (var i = 0; i < files.length && currentImages.additional.length + i < 9; i++) {
            (function (f, idx) {
                promises.push(Storage.uploadImage(f, code, 'add', currentImages.additional.length + idx));
            })(files[i], i);
        }
        return Promise.all(promises);
    }).then(function(imgs) {
        imgs.forEach(function(result) {
            currentImages.additional.push({ name: result.filename, url: result.url, autoName: result.autoName, filename: result.filename });
        });
        renderImagePreviews();
    }).catch(function(err) {
        showToast('이미지 업로드 실패: ' + err.message, 'error');
    });
}

function handleDetailImages(files) {
    ensureProductCode().then(function(code) {
        var promises = [];
        for (var i = 0; i < files.length; i++) {
            (function (f, idx) {
                promises.push(Storage.uploadImage(f, code, 'detail', currentImages.detail.length + idx));
            })(files[i], i);
        }
        return Promise.all(promises);
    }).then(function(imgs) {
        imgs.forEach(function(result) {
            currentImages.detail.push({ name: result.filename, url: result.url, autoName: result.autoName, filename: result.filename });
        });
        renderImagePreviews();
    }).catch(function(err) {
        showToast('이미지 업로드 실패: ' + err.message, 'error');
    });
}

function renderImagePreviews() {
    var mainArea = document.getElementById('mainImageArea');
    if (mainArea && currentImages.main) {
        var imgSrc = currentImages.main.url || currentImages.main.dataUrl || '';
        mainArea.innerHTML = '<div class="main-image-info">' +
            '<div class="main-image-box"><img src="' + imgSrc + '" alt="대표이미지"></div>' +
            '<div><div class="file-name">' + (currentImages.main.name || currentImages.main.filename || '') + '</div>' +
            '<div class="auto-name">' + (currentImages.main.autoName || '') + '</div></div>' +
            '<button class="btn-outline btn-sm" onclick="removeMainImage()" style="margin-left:auto;"><i class="bx bx-trash"></i> 삭제</button></div>';
    } else if (mainArea) {
        mainArea.innerHTML = '<div class="image-upload-zone" id="mainImageUpload"><i class="bx bx-cloud-upload"></i><span>클릭 또는 드래그</span>' +
            '<input type="file" accept="image/*" id="mainImageInput"></div>';
        var ni = document.getElementById('mainImageInput');
        if (ni) ni.addEventListener('change', function (e) { if (e.target.files[0]) handleMainImage(e.target.files[0]); });
    }
    var addGrid = document.getElementById('addImageGrid');
    if (addGrid) {
        var ah = '';
        if (currentImages.additional.length < 9) {
            ah += '<div class="image-upload-small" id="addImageUpload"><i class="bx bx-cloud-upload"></i><span>클릭 또는 드래그하여 추가</span>' +
                '<input type="file" accept="image/*" multiple id="addImageInput"></div>';
        }
        if (currentImages.additional.length > 0) {
            ah += '<div class="image-thumb-row">';
            currentImages.additional.forEach(function (img, idx) {
                var thumbSrc = img.url || img.dataUrl || '';
                ah += '<div class="image-thumb"><img src="' + thumbSrc + '"><div class="image-thumb-overlay">' +
                    '<button class="delete-btn" onclick="removeAdditionalImage(' + idx + ')"><i class="bx bx-trash"></i></button></div>' +
                    '<div class="image-thumb-name">' + (img.autoName || '') + '</div></div>';
            });
            ah += '</div>';
        }
        addGrid.innerHTML = ah;
        var ai = document.getElementById('addImageInput');
        if (ai) ai.addEventListener('change', function (e) { handleAdditionalImages(e.target.files); });
        document.getElementById('addImageCount').textContent = currentImages.additional.length + '/9';
    }
    var detailGrid = document.getElementById('detailImageGrid');
    if (detailGrid) {
        var dh = '';
        dh += '<div class="image-upload-small" id="detailImageUpload"><i class="bx bx-cloud-upload"></i><span>클릭 또는 드래그하여 추가</span>' +
            '<input type="file" accept="image/*" multiple id="detailImageInput"></div>';
        if (currentImages.detail.length > 0) {
            dh += '<div class="image-thumb-row">';
            currentImages.detail.forEach(function (img, idx) {
                var thumbSrc = img.url || img.dataUrl || '';
                dh += '<div class="image-thumb"><img src="' + thumbSrc + '"><div class="image-thumb-overlay">' +
                    '<button class="delete-btn" onclick="removeDetailImage(' + idx + ')"><i class="bx bx-trash"></i></button></div>' +
                    '<div class="image-thumb-name">' + (img.autoName || '') + '</div></div>';
            });
            dh += '</div>';
        }
        detailGrid.innerHTML = dh;
        var di = document.getElementById('detailImageInput');
        if (di) di.addEventListener('change', function (e) { handleDetailImages(e.target.files); });
        document.getElementById('detailImageCount').textContent = currentImages.detail.length + '장';
    }
}

function removeMainImage() { currentImages.main = null; renderImagePreviews(); }
function removeAdditionalImage(idx) { currentImages.additional.splice(idx, 1); renderImagePreviews(); }
function removeDetailImage(idx) { currentImages.detail.splice(idx, 1); renderImagePreviews(); }

// Option builder functions in option-builder.js

// ════════════════════════════════════════
// SAVE / DRAFT
// ════════════════════════════════════════
function saveProduct() {
    [1, 2, 3, 4, 5].forEach(function(s) { collectStepData(s); });
    if (!currentProduct.productName) { showToast('스토어 상품명을 입력하세요.', 'warning'); goToStep(1); return; }
    if (!currentProduct.categoryId) { showToast('카테고리를 선택하세요.', 'warning'); goToStep(1); return; }
    if (!currentProduct.salePrice) { showToast('판매가를 입력하세요.', 'warning'); goToStep(2); return; }

    currentProduct.updatedAt = new Date().toISOString();
    currentProduct._images = currentImages;

    ensureProductCode().then(function() {
        return Storage.saveProduct(currentProduct);
    }).then(function() {
        showToast('상품이 저장되었습니다!', 'success');
        refreshProductList();
        _isDirty = false;
        location.hash = 'products';
    }).catch(function(err) {
        showToast('저장 실패: ' + err.message, 'error');
    });
}

function saveDraft() {
    [1, 2, 3, 4, 5].forEach(function(s) { collectStepData(s); });
    currentProduct.updatedAt = new Date().toISOString();
    currentProduct.isDraft = true;
    currentProduct._images = currentImages;

    ensureProductCode().then(function() {
        return Storage.saveProduct(currentProduct);
    }).then(function() {
        showToast('임시저장 완료!', 'info');
        refreshProductList();
        _isDirty = false;
        location.hash = 'products';
    }).catch(function(err) {
        showToast('저장 실패: ' + err.message, 'error');
    });
}

// ════════════════════════════════════════
// PRODUCT LIST
// ════════════════════════════════════════
function initProductList() {
    var checkAll = document.getElementById('checkAll');
    if (checkAll) checkAll.addEventListener('change', function () {
        document.querySelectorAll('.product-row-check').forEach(function (cb) { cb.checked = checkAll.checked; });
    });
    var delBtn = document.getElementById('btnDeleteSelected');
    if (delBtn) delBtn.addEventListener('click', deleteSelectedProducts);
    var exportInvBtn = document.getElementById('btnExportToInventory');
    if (exportInvBtn) exportInvBtn.addEventListener('click', exportToInventory);
    refreshProductList();
}

function refreshProductList() {
    var products = Storage.getProducts();
    var tbody = document.getElementById('productTableBody');
    var empty = document.getElementById('emptyProducts');
    var badge = document.getElementById('productCountBadge');
    if (badge) badge.textContent = '등록 상품: ' + products.length + '건';
    if (!tbody) return;
    if (products.length === 0) {
        tbody.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    // 관리번호 역순 정렬 (최신 등록 상품이 상단)
    products.sort(function(a, b) { return (b.code || '').localeCompare(a.code || ''); });
    var html = '';
    products.forEach(function (p) {
        var stock = p.stock || 0;
        if (p.combinations && p.combinations.length > 0) {
            stock = p.combinations.reduce(function (s, c) { return s + (c.stock || 0); }, 0);
        }
        html += '<tr class="hoverable" onclick="editProduct(\'' + p.id + '\')" style="border-bottom:1px solid var(--surface-container-high); cursor:pointer;">' +
            '<td style="text-align:center;"><input type="checkbox" class="product-row-check" data-id="' + p.id + '" style="margin:0;" onclick="event.stopPropagation();"></td>' +
            '<td style="font-family:\'Inter\',sans-serif;font-size:12px;color:var(--gray-500);font-weight:500;">' + p.code + '</td>' +
            '<td style="font-weight:600;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (p.productName || p.internalName || '-') + '</td>' +
            '<td style="font-size:11.5px;color:var(--gray-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (p.categoryName || '-') + '">' + (p.categoryName || '-') + '</td>' +
            '<td style="text-align:right;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:600;">' + formatCurrency(p.salePrice) + '</td>' +
            '<td style="text-align:right;font-family:\'Inter\',sans-serif;font-size:13px;">' + stock + '</td>' +
            '<td style="text-align:center;"><span class="badge ' + (p.isDraft ? 'badge-gray' : 'badge-primary') + '">' + (p.isDraft ? '임시' : '완료') + '</span></td>' +
            '<td style="text-align:center;font-size:11.5px;font-family:\'Inter\',sans-serif;color:var(--gray-500);">' + (p.createdAt ? p.createdAt.slice(0, 10).replace(/-/g, '.') : '-') + '</td>' +
            '<td style="text-align:center;"><i class="bx bx-edit" style="font-size:16px;color:var(--gray-400);"></i></td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
}

function editProduct(id) {
    var p = Storage.getProducts().find(function (pr) { return pr.id === id; });
    if (!p) return;
    
    _isDirty = false;
    _isEditing = true;  // handleRoute에서 startNewProduct 방지
    _editMode = true;   // 편집 모드 플래그 (수정완료 버튼 표시용)
    currentProduct = p;
    currentImages = p._images || { main: null, additional: [], detail: [] };
    populateForm(); // Added the missing data restoration call
    renderImagePreviews();
    window.location.hash = 'register';

    // Enable click-to-nav for wizard steps when editing
    document.querySelectorAll('.wizard-step').forEach(function (s) {
        s.classList.add('clickable');
    });

    // 수정완료 버튼 표시
    document.querySelectorAll('.btn-edit-save').forEach(function(btn) {
        btn.classList.remove('hidden');
    });

    goToStep(1);
    
    // Automatically bring the user to the top of the wizard to ensure smooth UX
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteSelectedProducts() {
    var checks = document.querySelectorAll('.product-row-check:checked');
    if (checks.length === 0) { showToast('삭제할 상품을 선택하세요.', 'warning'); return; }
    if (!confirm(checks.length + '개 상품을 삭제하시겠습니까?')) return;
    var ids = Array.from(checks).map(function(cb) { return cb.dataset.id; });
    Storage.deleteProducts(ids).then(function() {
        showToast(ids.length + '개 상품이 삭제되었습니다.', 'success');
        refreshProductList();
    }).catch(function(err) {
        showToast('삭제 실패: ' + err.message, 'error');
    });
}

// ════════════════════════════════════════
// EXPORT (Cart System)
// ════════════════════════════════════════
function initExport() {
    var excelBtn = document.getElementById('btnDownloadExcel');
    var zipBtn = document.getElementById('btnDownloadZip');
    if (excelBtn) excelBtn.addEventListener('click', downloadExcel);
    if (zipBtn) zipBtn.addEventListener('click', downloadZip);
    
    var btnAddCart = document.getElementById('btnAddExportCart');
    if (btnAddCart) btnAddCart.addEventListener('click', addSelectedToCart);
    
    var btnRemove = document.getElementById('btnRemoveFromCart');
    if (btnRemove) btnRemove.addEventListener('click', removeSelectedFromCart);
    
    var btnClear = document.getElementById('btnClearCart');
    if (btnClear) btnClear.addEventListener('click', clearExportCart);
    
    var checkAllCart = document.getElementById('checkAllCart');
    if (checkAllCart) {
        checkAllCart.addEventListener('change', function () {
            var cbs = document.querySelectorAll('.cart-row-check');
            cbs.forEach(function (cb) { cb.checked = checkAllCart.checked; });
            updateExportSummary();
        });
    }
}

function addSelectedToCart() {
    var checks = document.querySelectorAll('.product-row-check:checked');
    if (checks.length === 0) { showToast('출력 대기열에 추가할 상품을 체크하세요.', 'warning'); return; }
    var ids = Array.from(checks).map(function(cb) { return cb.dataset.id; });
    var addedCount = Storage.addToExportCart(ids);
    
    if (addedCount > 0) {
        showToast(addedCount + '개 상품이 엑셀 출력 대기열에 지정되었습니다.', 'success');
        checks.forEach(function (cb) { cb.checked = false; });
        var checkAll = document.getElementById('checkAll');
        if (checkAll) checkAll.checked = false;
        
        // Auto navigate or alert to go there
        setTimeout(function() { location.hash = 'export'; }, 600);
    } else {
        showToast('선택하신 상품이 이미 대기열에 존재합니다.', 'info');
    }
}

function renderExportCart() {
    var ids = Storage.getExportCart();
    var allProducts = Storage.getProducts();
    
    var tbody = document.getElementById('exportCartTableBody');
    var empty = document.getElementById('emptyCart');
    var tableWrap = document.getElementById('exportCartTable').parentElement;
    
    // Filter down products that are actually in the cart, in case some were deleted from main list
    var mapped = ids.map(function(id) {
        return allProducts.find(function(p) { return p.id === id; });
    }).filter(Boolean);
    
    // Sync storage if items were deleted elsewhere
    if (mapped.length !== ids.length) {
        Storage.saveExportCart(mapped.map(function(p) { return p.id; }));
    }
    
    if (!tbody) return;
    if (mapped.length === 0) {
        tbody.innerHTML = '';
        tableWrap.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        updateExportSummary();
        return;
    }
    
    tableWrap.style.display = 'block';
    if (empty) empty.style.display = 'none';
    
    var html = '';
    mapped.forEach(function(p) {
        html += '<tr style="border-bottom:1px solid var(--surface-container-high);">' +
            '<td style="text-align:center;"><input type="checkbox" class="cart-row-check" data-id="' + p.id + '" style="margin:0;" checked></td>' +
            '<td style="font-family:\'Inter\',sans-serif;font-size:12px;color:var(--gray-500);font-weight:500;">' + p.code + '</td>' +
            '<td style="font-weight:600;color:var(--gray-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (p.productName || p.internalName || '-') + '</td>' +
            '<td style="font-size:11.5px;color:var(--gray-500);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + (p.categoryName || '-') + '">' + (p.categoryName || '-') + '</td>' +
            '<td style="text-align:right;font-family:\'Inter\',sans-serif;font-size:13px;font-weight:600;">' + formatCurrency(p.salePrice) + '</td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
    
    // Add listeners to individual checkboxes to update summary
    document.querySelectorAll('.cart-row-check').forEach(function(el) {
        el.addEventListener('change', updateExportSummary);
    });
    // Check main header
    var checkAll = document.getElementById('checkAllCart');
    if (checkAll) checkAll.checked = true;
    
    updateExportSummary();
}

function removeSelectedFromCart() {
    var checks = document.querySelectorAll('.cart-row-check:checked');
    if (checks.length === 0) { showToast('대기열에서 제외할 항목을 체크해주세요.', 'warning'); return; }
    
    var ids = Array.from(checks).map(function(cb) { return cb.dataset.id; });
    Storage.removeFromExportCart(ids);
    showToast(ids.length + '개 상품이 엑셀 출력 대기열에서 제외되었습니다.', 'info');
    renderExportCart();
}

function clearExportCart() {
    if (!confirm('엑셀 출력 대기열을 전체 초기화하시겠습니까?')) return;
    Storage.clearExportCart();
    showToast('대기열이 비워졌습니다.', 'info');
    renderExportCart();
}

function downloadExcel() {
    var checkedBoxes = document.querySelectorAll('.cart-row-check:checked');
    if (checkedBoxes.length === 0) { showToast('대기열에서 엑셀 파일로 추출할 항목을 체크해주세요.', 'warning'); return; }

    var selectedIds = Array.from(checkedBoxes).map(function(cb) { return cb.dataset.id; });
    var allProducts = Storage.getProducts();
    var products = allProducts.filter(function(p) { return selectedIds.includes(p.id); });

    if (products.length === 0) { showToast('등록된 상품이 없습니다.', 'warning'); return; }

    showToast('엑셀 생성 중...', 'info');

    try {
        // ── Load official template from embedded base64 (no network request needed) ──
        var wb = XLSX.read(SMARTSTORE_TEMPLATE_B64, { type: 'base64', cellStyles: true });
        var ws = wb.Sheets[wb.SheetNames[0]]; // '일괄등록' sheet

        // ── Apply xlsx-js-style compatible styles to header rows ──
        // Group definitions: [startCol, endCol, row1Color(dark), row2Color(light), row1FontColor]
        var groupStyles = [
            { s: 0,  e: 24, dark: 'FFC000', light: 'FFF2CC', fontColor: '000000' }, // 상품 기본정보 (gold)
            { s: 25, e: 33, dark: '70AD47', light: 'E2F0D9', fontColor: 'FFFFFF' }, // 상품 주요정보 (green)
            { s: 34, e: 49, dark: 'ED7D31', light: 'FBE5D6', fontColor: 'FFFFFF' }, // 배송정보 (orange)
            { s: 50, e: 54, dark: '5B9BD5', light: 'DEEBF7', fontColor: 'FFFFFF' }, // 상품정보제공고시 (blue)
            { s: 55, e: 58, dark: 'A5A5A5', light: 'EDEDED', fontColor: 'FFFFFF' }, // A/S, 특이사항 (gray)
            { s: 59, e: 75, dark: '4472C4', light: 'DAE3F3', fontColor: 'FFFFFF' }, // 할인/혜택정보 (dark blue)
            { s: 76, e: 92, dark: '002060', light: 'D9E6FF', fontColor: 'FFFFFF' }, // 기타 정보 (navy)
        ];
        var thinBorder = { style: 'thin', color: { rgb: 'BBBBBB' } };
        var borderAll = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

        groupStyles.forEach(function(g) {
            for (var c = g.s; c <= g.e; c++) {
                // Row 1: Group headers (dark color, bold, white/black font, centered)
                var r1Ref = XLSX.utils.encode_cell({ r: 0, c: c });
                if (!ws[r1Ref]) ws[r1Ref] = { v: '', t: 's' };
                ws[r1Ref].s = {
                    font: { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: g.fontColor } },
                    fill: { patternType: 'solid', fgColor: { rgb: g.dark } },
                    alignment: { horizontal: 'center', vertical: 'center' },
                    border: borderAll
                };

                // Row 2: Column headers (light color, bold, black font, centered)
                var r2Ref = XLSX.utils.encode_cell({ r: 1, c: c });
                if (!ws[r2Ref]) ws[r2Ref] = { v: '', t: 's' };
                ws[r2Ref].s = {
                    font: { name: '맑은 고딕', sz: 10, bold: true, color: { rgb: '000000' } },
                    fill: { patternType: 'solid', fgColor: { rgb: g.light } },
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                    border: borderAll
                };
            }
        });

        // ── Write product data starting at row 3 (0-indexed row 2) ──
            var noticeImgs = Storage.getNoticeImages();
            var consentImgs = Storage.getConsentImages();

            products.forEach(function(p, pIdx) {
                var rowIdx = pIdx + 2; // row 3 = index 2 (row 1=group headers, row 2=column headers)
                var images = p._images || { main: null, additional: [], detail: [] };
                var addImgs = images.additional || [];
                var detailImgs = images.detail || [];
                var detailUrls = detailImgs.map(function(img) { var _u = img.url || img.autoName; return _u ? '<img src="' + _u + '">' : ''; }).join('');
                
                var nImg = noticeImgs.find(function(n) { return n.id === p.noticeImageId; });
                if (nImg && (nImg.url || nImg.autoName)) {
                    detailUrls += '<img src="' + (nImg.url || nImg.autoName) + '">';
                }
                
                var cImg = consentImgs.find(function(c) { return c.id === p.consentImageId; });
                if (cImg && (cImg.url || cImg.autoName)) {
                    detailUrls += '<img src="' + (cImg.url || cImg.autoName) + '">';
                }
                var presets = Storage.getShippingPresets();
                var sp = presets.find(function(pr) { return pr.id === p.shippingPresetId; }) || presets[0] || {};

                var optType = p.optionType || '';
                var optNames = '';
                var optValues = '';
                var optPrices = '';
                var optStocks = '';
                var stockVal = p.stock || 0;

                if (p.optionNames && p.optionNames.length > 0 && p.combinations && p.combinations.length > 0) {
                    optNames = p.optionNames.join('\n');
                    optValues = p.optionValues.map(function(vals) { return vals.join(','); }).join('\n');
                    optPrices = p.combinations.map(function(c) { return c.price; }).join(',');
                    optStocks = p.combinations.map(function(c) { return c.stock; }).join(',');
                    stockVal = p.combinations.reduce(function(sum, c) { return sum + c.stock; }, 0);
                }

                // Build 93-column row array matching official template A~CO
                // A=0: 판매자 상품코드 ~ CO=92: 사이즈 모델명
                var row = new Array(93);
                for (var i = 0; i < 93; i++) row[i] = '';

                // ── 상품 기본정보 (A~Y, cols 0~24) ──
                row[0]  = p.code || '';                             // A: 판매자 상품코드
                row[1]  = p.categoryId || '';                       // B: 카테고리코드
                row[2]  = p.productName || '';                      // C: 상품명
                row[3]  = p.productStatus || '신상품';               // D: 상품상태
                row[4]  = p.salePrice || '';                        // E: 판매가
                row[5]  = p.unitPriceRequired ? 'Y' : '';            // F: 단위가격 사용여부
                row[6]  = p.displayVolume || '';                      // G: 표시용량
                row[7]  = p.displayUnit || '';                        // H: 표시단위
                row[8]  = p.totalVolume || '';                        // I: 총용량
                row[9]  = p.vat || '과세상품';                       // J: 부가세
                row[10] = '';                                       // K: 관부가세
                row[11] = stockVal;                                 // L: 재고수량
                row[12] = optType;                                  // M: 옵션형태
                row[13] = optNames;                                 // N: 옵션명
                row[14] = optValues;                                // O: 옵션값
                row[15] = optPrices;                                // P: 옵션가
                row[16] = optStocks;                                // Q: 옵션 재고수량
                row[17] = '';                                       // R: 직접입력 옵션
                row[18] = '';                                       // S: 추가상품명
                row[19] = '';                                       // T: 추가상품값
                row[20] = '';                                       // U: 추가상품가
                row[21] = '';                                       // V: 추가상품 재고수량
                row[22] = images.main ? (images.main.url || images.main.autoName) : '';  // W: 대표이미지 (URL)
                // X: 추가이미지 — URL로 출력
                var addImgUrls = addImgs.map(function(img) { return img.url || img.autoName; });
                row[23] = addImgUrls.join('\n');                    // X: 추가이미지
                row[24] = detailUrls;                               // Y: 상세설명

                // ── 상품 주요정보 (Z~AH, cols 25~33) ──
                row[25] = p.brand || '';                            // Z: 브랜드
                row[26] = p.manufacturer || '';                     // AA: 제조사
                row[27] = p.mfgDate || '';                          // AB: 제조일자
                row[28] = '';                                       // AC: 유효일자
                row[29] = p.originCode || '';                       // AD: 원산지코드
                row[30] = '';                                       // AE: 수입사
                row[31] = '';                                       // AF: 복수원산지여부
                row[32] = '';                                       // AG: 원산지 직접입력
                row[33] = p.minorPurchase || 'Y';                   // AH: 미성년자 구매

                // ── 배송정보 (AI~AX, cols 34~49) ──
                row[34] = sp.templateCode || '';                    // AI: 배송비 템플릿코드
                row[35] = sp.method || '';                          // AJ: 배송방법
                row[36] = sp.courierCode || '';                     // AK: 택배사코드
                row[37] = sp.feeType || '';                         // AL: 배송비유형
                row[38] = sp.fee === '' ? '' : (sp.fee || '');      // AM: 기본배송비
                row[39] = sp.payMethod || '';                       // AN: 배송비 결제방식
                row[40] = sp.freeCondition === '' ? '' : (sp.freeCondition || ''); // AO: 조건부무료-상품판매가 합계
                row[41] = sp.qty === '' ? '' : (sp.qty || '');      // AP: 수량별부과-수량
                row[42] = sp.section2Qty || '';                     // AQ: 구간별-2구간수량
                row[43] = sp.section3Qty || '';                     // AR: 구간별-3구간수량
                row[44] = sp.section3Fee || '';                     // AS: 구간별-3구간배송비
                row[45] = sp.addFee || '';                          // AT: 구간별-추가배송비
                row[46] = sp.returnFee || '';                       // AU: 반품배송비
                row[47] = sp.exchangeFee || '';                     // AV: 교환배송비
                row[48] = '';                                       // AW: 지역별 차등 배송비
                row[49] = '';                                       // AX: 별도설치비

                // ── 상품정보제공고시 (AY~BC, cols 50~54) ──
                row[50] = '';                                       // AY: 상품정보제공고시 템플릿코드
                row[51] = p.noticeName || '';                       // AZ: 상품정보제공고시 품명
                row[52] = p.noticeModel || '';                      // BA: 상품정보제공고시 모델명
                row[53] = p.noticeCert || '';                       // BB: 상품정보제공고시 인증허가사항
                row[54] = p.noticeMaker || '';                      // BC: 상품정보제공고시 제조사

                // ── A/S, 특이사항 (BD~BG, cols 55~58) ──
                row[55] = '';                                       // BD: A/S 템플릿코드
                row[56] = p.asPhone || '';                          // BE: A/S 전화번호
                row[57] = p.asGuide || '';                          // BF: A/S 안내
                row[58] = '';                                       // BG: 판매자특이사항

                // ── 할인/혜택정보 (BH~BX, cols 59~75) ── (미사용, 모두 빈칸)
                // row[59]~row[75] 이미 ''로 초기화됨

                // ── 기타 정보 (BY~CO, cols 76~92) ── (미사용, 모두 빈칸)
                // row[76]~row[92] 이미 ''로 초기화됨

                // Write row cells into the worksheet
                for (var c = 0; c < 93; c++) {
                    var cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: c });
                    if (row[c] !== '' && row[c] !== null && row[c] !== undefined) {
                        ws[cellRef] = { v: row[c], t: typeof row[c] === 'number' ? 'n' : 's' };
                    }
                }

                // 옵션명(N, col13) / 옵션값(O, col14) — wrapText로 셀 내 줄바꿈 표시
                var optNameRef = XLSX.utils.encode_cell({ r: rowIdx, c: 13 });
                var optValRef = XLSX.utils.encode_cell({ r: rowIdx, c: 14 });
                if (ws[optNameRef]) ws[optNameRef].s = { alignment: { wrapText: true, vertical: 'top' } };
                if (ws[optValRef]) ws[optValRef].s = { alignment: { wrapText: true, vertical: 'top' } };

                // 추가이미지(X, col23) / 상세설명(Y, col24) — wrapText
                var addImgRef = XLSX.utils.encode_cell({ r: rowIdx, c: 23 });
                var detailRef = XLSX.utils.encode_cell({ r: rowIdx, c: 24 });
                if (ws[addImgRef]) ws[addImgRef].s = { alignment: { wrapText: true, vertical: 'top' } };
                if (ws[detailRef]) ws[detailRef].s = { alignment: { wrapText: true, vertical: 'top' } };

                // 원산지코드(AD, col29) — 텍스트 서식 강제 (앞자리 0 유지)
                var originRef = XLSX.utils.encode_cell({ r: rowIdx, c: 29 });
                if (ws[originRef]) { ws[originRef].t = 's'; ws[originRef].z = '@'; }
            });

            // Update the sheet range to include new data rows
            var lastRow = products.length + 1; // +1 because data starts at row 3 (index 2), header rows = 0,1
            ws['!ref'] = 'A1:CO' + (lastRow + 1);

            // ── 행 높이 자동 조절 + 위쪽 맞춤 일괄 적용 ──
            var rowHeights = [
                { hpt: 30 },  // 1행: 그룹 헤더
                { hpt: 40 }   // 2행: 컬럼 헤더
            ];
            for (var ri = 2; ri < lastRow + 1; ri++) {
                var maxLines = 1;
                for (var ci = 0; ci < 93; ci++) {
                    var ref = XLSX.utils.encode_cell({ r: ri, c: ci });
                    if (ws[ref]) {
                        // 위쪽 맞춤 일괄 적용 (기존 스타일 병합)
                        var existingStyle = ws[ref].s || {};
                        var existingAlign = existingStyle.alignment || {};
                        ws[ref].s = Object.assign({}, existingStyle, {
                            alignment: Object.assign({}, existingAlign, { vertical: 'top' })
                        });
                        // 줄바꿈 수 계산
                        if (ws[ref].v) {
                            var val = String(ws[ref].v);
                            var lines = val.split('\n').length;
                            if (lines > maxLines) maxLines = lines;
                        }
                    }
                }
                rowHeights.push({ hpt: Math.max(18, maxLines * 15) });
            }
            ws['!rows'] = rowHeights;

            // Write and download
            XLSX.writeFile(wb, 'smartstore_upload_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.xlsx');
            showToast('엑셀이 다운로드되었습니다!', 'success');
        } catch (e) {
        console.error('Excel generation error:', e);
        showToast('엑셀 생성 중 오류: ' + e.message, 'error');
    }
}

function downloadZip() {
    var checkedBoxes = document.querySelectorAll('.cart-row-check:checked');
    if (checkedBoxes.length === 0) { showToast('대기열에서 ZIP 이미지로 추출할 항목을 체크해주세요.', 'warning'); return; }
    
    var selectedIds = Array.from(checkedBoxes).map(function(cb) { return cb.dataset.id; });
    var allProducts = Storage.getProducts();
    var products = allProducts.filter(function(p) { return selectedIds.includes(p.id); });
    
    if (products.length === 0) { showToast('등록된 상품이 없습니다.', 'warning'); return; }
    var zip = new JSZip();
    var imgFolder = zip.folder('images');
    var fetchPromises = [];
    
    products.forEach(function (p) {
        var images = p._images || { main: null, additional: [], detail: [] };
        if (images.main && images.main.url) {
            fetchPromises.push(
                fetch(images.main.url).then(function(r) { return r.blob(); }).then(function(blob) {
                    imgFolder.file(images.main.autoName || images.main.filename, blob);
                }).catch(function(err) { console.error('이미지 다운로드 실패:', err); })
            );
        }
        (images.additional || []).forEach(function (img) {
            if (img.url) {
                fetchPromises.push(
                    fetch(img.url).then(function(r) { return r.blob(); }).then(function(blob) {
                        imgFolder.file(img.autoName || img.filename, blob);
                    }).catch(function(err) { console.error('이미지 다운로드 실패:', err); })
                );
            }
        });
        (images.detail || []).forEach(function (img) {
            if (img.url) {
                fetchPromises.push(
                    fetch(img.url).then(function(r) { return r.blob(); }).then(function(blob) {
                        imgFolder.file(img.autoName || img.filename, blob);
                    }).catch(function(err) { console.error('이미지 다운로드 실패:', err); })
                );
            }
        });
    });
    
    if (fetchPromises.length === 0) { showToast('이미지가 없습니다.', 'warning'); return; }
    
    showToast('이미지 다운로드 중...', 'info');
    Promise.all(fetchPromises).then(function() {
        return zip.generateAsync({ type: 'blob' });
    }).then(function (content) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'smartstore_images_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.zip';
        a.click();
        showToast('ZIP 다운로드 완료!', 'success');
    });
}

// ════════════════════════════════════════
// PRESETS
// ════════════════════════════════════════
var _editingPresetId = null;

function resetPresetForm() {
    _editingPresetId = null;
    document.getElementById('fldPresetName').value = '';
    document.getElementById('fldPresetShippingAddress').value = '';
    document.getElementById('fldPresetReturnAddress').value = '';
    document.getElementById('fldPresetTemplateCode').value = '';
    document.getElementById('fldPresetMethod').value = '택배, 소포, 등기';
    document.getElementById('fldPresetFeeType').value = '유료';
    document.getElementById('fldPresetCourierSearch').value = '';
    document.getElementById('fldPresetCourierCode').value = '';
    document.getElementById('fldPresetCourierSearch').removeAttribute('readonly');
    
    var btnClear = document.getElementById('btnCourierClear');
    if(btnClear) btnClear.style.display = 'none';

    document.getElementById('fldPresetFee').value = '';
    document.getElementById('fldPresetPayMethod').value = '선결제';
    document.getElementById('fldPresetFreeCondition').value = '';
    document.getElementById('fldPresetQuantity').value = '';
    document.getElementById('fldPresetSection2Qty').value = '';
    document.getElementById('fldPresetSection3Qty').value = '';
    document.getElementById('fldPresetSection3Fee').value = '';
    document.getElementById('fldPresetAddFee').value = '';
    document.getElementById('fldPresetReturnFee').value = '';
    document.getElementById('fldPresetExchangeFee').value = '';
    
    var e = new Event('change');
    document.getElementById('fldPresetFeeType').dispatchEvent(e);
}

function populatePresetForm(presetId) {
    var form = document.getElementById('presetForm');
    
    if (_editingPresetId === presetId) {
        form.classList.add('hidden');
        document.getElementById('pagePresets').insertBefore(form, document.getElementById('presetList'));
        _editingPresetId = null;
        var iconStr = document.getElementById('chevron_' + presetId);
        if(iconStr) { iconStr.classList.remove('bx-chevron-up'); iconStr.classList.add('bx-chevron-down'); }
        return;
    }

    document.querySelectorAll('.preset-card .bx-chevron-up').forEach(function(ico) {
        ico.classList.remove('bx-chevron-up');
        ico.classList.add('bx-chevron-down');
    });

    var presets = Storage.getShippingPresets();
    var p = presets.find(function(x) { return x.id === presetId; });
    if (!p) return;

    _editingPresetId = p.id;
    document.getElementById('fldPresetName').value = p.name || '';
    document.getElementById('fldPresetShippingAddress').value = p.shippingAddressId || '';
    document.getElementById('fldPresetReturnAddress').value = p.returnAddressId || '';
    document.getElementById('fldPresetTemplateCode').value = p.templateCode || '';
    document.getElementById('fldPresetMethod').value = p.method || '택배, 소포, 등기';
    document.getElementById('fldPresetFeeType').value = p.feeType || '유료';
    
    var courierSearchInput = document.getElementById('fldPresetCourierSearch');
    var courierCodeInput = document.getElementById('fldPresetCourierCode');
    if (p.courierCode) {
        var allData = typeof DELIVERY_DATA !== 'undefined' ? DELIVERY_DATA : [];
        var cData = allData.find(function(d) { return d.code === p.courierCode; });
        if (cData) courierSearchInput.value = cData.name + ' (' + cData.code + ')';
        else courierSearchInput.value = p.courierCode;
        courierCodeInput.value = p.courierCode;
        document.getElementById('btnCourierClear').style.display = 'block';
        courierSearchInput.setAttribute('readonly', 'readonly');
    } else {
        courierSearchInput.value = '';
        courierCodeInput.value = '';
        document.getElementById('btnCourierClear').style.display = 'none';
        courierSearchInput.removeAttribute('readonly');
    }
    
    document.getElementById('fldPresetFee').value = p.fee || '';
    document.getElementById('fldPresetPayMethod').value = p.payMethod || '선결제';
    document.getElementById('fldPresetFreeCondition').value = p.freeCondition || '';
    document.getElementById('fldPresetQuantity').value = p.qty || '';
    document.getElementById('fldPresetSection2Qty').value = p.section2Qty || '';
    document.getElementById('fldPresetSection3Qty').value = p.section3Qty || '';
    document.getElementById('fldPresetSection3Fee').value = p.section3Fee || '';
    document.getElementById('fldPresetAddFee').value = p.addFee || '';
    document.getElementById('fldPresetReturnFee').value = p.returnFee || '';
    document.getElementById('fldPresetExchangeFee').value = p.exchangeFee || '';

    var e = new Event('change');
    document.getElementById('fldPresetFeeType').dispatchEvent(e);
    
    var form = document.getElementById('presetForm');
    var container = document.getElementById('formContainer_' + presetId);
    if (container) {
        container.appendChild(form);
        form.style.marginTop = '0';
        form.style.padding = '0 16px 16px 16px';
        form.style.borderTop = '1px solid var(--border-color)';
        form.style.paddingTop = '16px';
    }
    
    form.classList.remove('hidden');
    
    var icon = document.getElementById('chevron_' + presetId);
    if (icon) {
        icon.classList.remove('bx-chevron-down');
        icon.classList.add('bx-chevron-up');
    }
}

function initPresets() {
    var addBtn = document.getElementById('btnAddPreset');
    var saveBtn = document.getElementById('btnSavePreset');
    var cancelBtn = document.getElementById('btnCancelPreset');
    if (addBtn) addBtn.addEventListener('click', function () {
        var form = document.getElementById('presetForm');
        document.getElementById('pagePresets').insertBefore(form, document.getElementById('presetList'));
        
        resetPresetForm();
        form.classList.remove('hidden');
        form.style.marginTop = '16px';
        form.style.padding = '0';
        form.style.borderTop = 'none';
        
        document.querySelectorAll('.preset-card .bx-chevron-up').forEach(function(icon) {
            icon.classList.remove('bx-chevron-up');
            icon.classList.add('bx-chevron-down');
        });
    });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { document.getElementById('presetForm').classList.add('hidden'); _editingPresetId = null; });
    if (saveBtn) saveBtn.addEventListener('click', savePreset);

    // Fee Type Toggle
    var feeTypeSel = document.getElementById('fldPresetFeeType');
    if (feeTypeSel) {
        feeTypeSel.addEventListener('change', function () {
            var val = this.value;
            // Hide all conditionals
            document.querySelectorAll('.fee-condition').forEach(function (el) { el.classList.add('hidden'); });
            // Show base fee for non-free
            if (val !== '무료') {
                document.querySelectorAll('.conditional-base').forEach(function (el) { el.classList.remove('hidden'); });
            }
            if (val === '조건부 무료') {
                document.querySelectorAll('.conditional-condition-free').forEach(function (el) { el.classList.remove('hidden'); });
            } else if (val === '수량별') {
                document.querySelectorAll('.conditional-quantity').forEach(function (el) { el.classList.remove('hidden'); });
            } else if (val === '구간별') {
                document.querySelectorAll('.conditional-section').forEach(function (el) { el.classList.remove('hidden'); });
            }
        });
    }

    // Courier Autocomplete
    var courierSearch = document.getElementById('fldPresetCourierSearch');
    var courierCode = document.getElementById('fldPresetCourierCode');
    var courierDropdown = document.getElementById('presetCourierDropdown');
    var courierResults = document.getElementById('presetCourierResults');
    var courierClear = document.getElementById('btnCourierClear');

    if (courierSearch) {
        var courierHighlightIdx = -1;
        
        function getCourierItems() {
            return Array.prototype.slice.call(courierResults.querySelectorAll('.category-item'));
        }
        
        function setCourierHighlight(idx) {
            var items = getCourierItems();
            items.forEach(function (el, i) {
                if (i === idx) el.classList.add('kb-active');
                else el.classList.remove('kb-active');
            });
            courierHighlightIdx = idx;
            if (idx >= 0 && items[idx]) {
                items[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }

        function renderCourierDropdown(term) {
            courierHighlightIdx = -1;
            var matches;
            var allData = typeof DELIVERY_DATA !== 'undefined' ? DELIVERY_DATA : [];
            if (!term) {
                matches = allData.slice(0, 50); // Show top 50 if empty
            } else {
                matches = allData.filter(function (d) {
                    return d.name.toLowerCase().includes(term);
                });
            }
            if (matches.length > 0) {
                var html = '';
                matches.forEach(function (m) {
                    html += '<div class="category-item" data-code="' + m.code + '" data-name="' + m.name + '">' + m.name + ' <span style="font-size:10px;color:var(--gray-400);">(' + m.code + ')</span></div>';
                });
                courierResults.innerHTML = html;
                courierDropdown.classList.remove('hidden');
                courierDropdown.classList.add('active');

                courierResults.querySelectorAll('.category-item').forEach(function (item) {
                    item.addEventListener('click', function () {
                        courierSearch.value = this.dataset.name + ' (' + this.dataset.code + ')';
                        courierCode.value = this.dataset.code;
                        courierDropdown.classList.remove('active');
                        courierDropdown.classList.add('hidden');
                        courierClear.style.display = 'block';
                        courierSearch.setAttribute('readonly', 'readonly');
                    });
                });
            } else {
                courierResults.innerHTML = '<div style="padding:10px;text-align:center;color:var(--gray-400);font-size:12px;">검색 결과가 없습니다.</div>';
                courierDropdown.classList.remove('hidden');
                courierDropdown.classList.add('active');
            }
        }

        courierSearch.addEventListener('focus', function () {
            var term = this.value.trim().toLowerCase();
            renderCourierDropdown(term);
        });

        courierSearch.addEventListener('input', function () {
            var term = this.value.trim().toLowerCase();
            renderCourierDropdown(term);
        });

        courierSearch.addEventListener('keydown', function(e) {
            var items = getCourierItems();
            if (!items.length) return;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                var next = courierHighlightIdx + 1;
                if (next >= items.length) next = 0;
                setCourierHighlight(next);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                var prev = courierHighlightIdx - 1;
                if (prev < 0) prev = items.length - 1;
                setCourierHighlight(prev);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (courierHighlightIdx >= 0 && courierHighlightIdx < items.length) {
                    var item = items[courierHighlightIdx];
                    courierSearch.value = item.dataset.name + ' (' + item.dataset.code + ')';
                    courierCode.value = item.dataset.code;
                    courierDropdown.classList.remove('active');
                    courierDropdown.classList.add('hidden');
                    courierClear.style.display = 'block';
                    courierSearch.setAttribute('readonly', 'readonly');
                    courierHighlightIdx = -1;
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                courierDropdown.classList.remove('active');
                courierDropdown.classList.add('hidden');
                courierHighlightIdx = -1;
                courierSearch.blur();
            }
        });

        courierClear.addEventListener('click', function () {
            courierSearch.value = '';
            courierCode.value = '';
            courierSearch.removeAttribute('readonly');
            this.style.display = 'none';
            courierSearch.focus();
        });

        document.addEventListener('click', function (e) {
            if (!courierDropdown) return;
            if (!courierDropdown.contains(e.target) && e.target !== courierSearch) {
                courierDropdown.classList.remove('active');
                courierDropdown.classList.add('hidden');
            }
        });
    }

    renderPresetList();
}

function savePreset() {
    var name = document.getElementById('fldPresetName').value.trim();
    var courier = document.getElementById('fldPresetCourierCode').value;
    var feeType = document.getElementById('fldPresetFeeType').value;
    var method = document.getElementById('fldPresetMethod').value;

    if (!name) { showToast('프리셋명을 입력하세요.', 'warning'); return; }
    if (method === '택배, 소포, 등기' && !courier) { showToast('택배사를 검색하여 선택하세요.', 'warning'); return; }

    var preset = {
        id: 'preset_' + Date.now(),
        name: name,
        templateCode: document.getElementById('fldPresetTemplateCode').value.trim(),
        method: method,
        courierCode: courier,
        feeType: feeType,
        fee: parseInt(document.getElementById('fldPresetFee').value) || 0,
        payMethod: document.getElementById('fldPresetPayMethod').value,
        freeCondition: parseInt(document.getElementById('fldPresetFreeCondition').value) || 0,
        qty: parseInt(document.getElementById('fldPresetQuantity').value) || 1,
        section2Qty: document.getElementById('fldPresetSection2Qty').value.trim(),
        section3Qty: document.getElementById('fldPresetSection3Qty').value.trim(),
        section3Fee: document.getElementById('fldPresetSection3Fee').value.trim(),
        addFee: document.getElementById('fldPresetAddFee').value.trim(),
        returnFee: parseInt(document.getElementById('fldPresetReturnFee').value) || 0,
        exchangeFee: parseInt(document.getElementById('fldPresetExchangeFee').value) || 0,
        shippingAddressId: document.getElementById('fldPresetShippingAddress').value,
        returnAddressId: document.getElementById('fldPresetReturnAddress').value
    };

    // Fee Type Constraints
    if (feeType === '무료') {
        preset.fee = ''; preset.payMethod = ''; preset.freeCondition = ''; preset.qty = ''; preset.section2Qty = ''; preset.section3Qty = ''; preset.section3Fee = ''; preset.addFee = '';
    } else if (feeType === '유료') {
        preset.freeCondition = ''; preset.qty = ''; preset.section2Qty = ''; preset.section3Qty = ''; preset.section3Fee = ''; preset.addFee = '';
    } else if (feeType === '조건부 무료') {
        preset.qty = ''; preset.section2Qty = ''; preset.section3Qty = ''; preset.section3Fee = ''; preset.addFee = '';
    } else if (feeType === '수량별') {
        preset.freeCondition = ''; preset.section2Qty = ''; preset.section3Qty = ''; preset.section3Fee = ''; preset.addFee = '';
    } else if (feeType === '구간별') {
        preset.freeCondition = ''; preset.qty = '';
        // 구간별 유효성 검증
        if (!preset.section2Qty) { showToast('구간별-2구간수량을 입력하세요.', 'warning'); return; }
        if (!preset.addFee || parseInt(preset.addFee) < 10) { showToast('구간별-추가배송비를 10원 이상 입력하세요.', 'warning'); return; }
        if (preset.section3Qty) {
            if (parseInt(preset.section3Qty) <= parseInt(preset.section2Qty)) {
                showToast('3구간수량은 2구간수량(' + preset.section2Qty + ')보다 커야 합니다.', 'warning'); return;
            }
            if (!preset.section3Fee || parseInt(preset.section3Fee) < 10) {
                showToast('3구간배송비를 10원 이상 입력하세요.', 'warning'); return;
            }
        } else {
            preset.section3Fee = '';
        }
    }

    var presets = Storage.getShippingPresets();
    if (_editingPresetId) {
        var idx = presets.findIndex(function(x) { return x.id === _editingPresetId; });
        if (idx >= 0) {
            preset.id = _editingPresetId;
            presets[idx] = preset;
        } else {
            presets.push(preset);
        }
    } else {
        presets.push(preset);
    }
    
    Storage.savePreset(preset).then(function() {
        showToast(_editingPresetId ? '프리셋이 수정되었습니다.' : '프리셋이 저장되었습니다.', 'success');
        document.getElementById('presetForm').classList.add('hidden');
        _editingPresetId = null;
        renderPresetList();
    }).catch(function(err) {
        showToast('프리셋 저장 실패: ' + err.message, 'error');
    });
}

function renderPresetList() {
    var list = document.getElementById('presetList');
    if (!list) return;

    var form = document.getElementById('presetForm');
    if (form) {
        document.getElementById('pagePresets').insertBefore(form, document.getElementById('presetList'));
        form.classList.add('hidden');
    }

    var presets = Storage.getShippingPresets();
    if (presets.length === 0) { list.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">등록된 프리셋이 없습니다.</p>'; return; }
    var html = '';
    presets.forEach(function (p) {
        html += '<div class="preset-card hoverable" onclick="populatePresetForm(\'' + p.id + '\')" style="cursor:pointer; margin-bottom:8px;background:var(--surface-container);border-radius:8px; overflow:hidden;">' +
            '<div style="padding:16px;display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>' + p.name + '</strong> <span style="font-size:12px;color:var(--gray-400); margin-left:8px;">' + p.feeType + (p.fee ? ' / ' + formatCurrency(p.fee) + '원' : '') + '</span></div>' +
            '<div><button class="btn-icon btn-sm" onclick="event.stopPropagation(); deletePreset(\'' + p.id + '\')" style="margin-right:12px;"><i class="bx bx-trash"></i></button>' +
            '<i class="bx bx-chevron-down" id="chevron_' + p.id + '" style="font-size:24px; color:var(--gray-400); vertical-align:middle;"></i></div>' +
            '</div><div id="formContainer_' + p.id + '"></div></div>';
    });
    list.innerHTML = html;
    populatePresetDropdown();
}

function deletePreset(id) {
    Storage.deletePreset(id).then(function() {
        showToast('프리셋이 삭제되었습니다.', 'info');
        renderPresetList();
    }).catch(function(err) {
        showToast('삭제 실패: ' + err.message, 'error');
    });
}

function populatePresetDropdown() {
    var sel = document.getElementById('fldShippingPreset');
    if (!sel) return;
    var presets = Storage.getShippingPresets();
    sel.innerHTML = '<option value="">프리셋 선택</option>';
    presets.forEach(function (p) {
        sel.innerHTML += '<option value="' + p.id + '">' + p.name + '</option>';
    });
}

// ════════════════════════════════════════
// ADDRESSES
// ════════════════════════════════════════
function initAddresses() {
    var addBtn = document.getElementById('btnAddAddress');
    var saveBtn = document.getElementById('btnSaveAddress');
    var cancelBtn = document.getElementById('btnCancelAddress');
    if (addBtn) addBtn.addEventListener('click', function () { document.getElementById('addressForm').classList.remove('hidden'); });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { document.getElementById('addressForm').classList.add('hidden'); });
    if (saveBtn) saveBtn.addEventListener('click', saveAddress);
    renderAddressList();
}

function saveAddress() {
    var addr = {
        id: 'addr_' + Date.now(),
        name: document.getElementById('fldAddrName').value.trim(),
        address: document.getElementById('fldAddrAddress').value.trim(),
        phone: document.getElementById('fldAddrPhone').value.trim()
    };
    if (!addr.name || !addr.address) { showToast('주소 이름과 주소를 입력하세요.', 'warning'); return; }
    Storage.saveAddress(addr).then(function() {
        showToast('주소가 저장되었습니다.', 'success');
        document.getElementById('addressForm').classList.add('hidden');
        renderAddressList();
    }).catch(function(err) {
        showToast('주소 저장 실패: ' + err.message, 'error');
    });
}

function renderAddressList() {
    var list = document.getElementById('addressList');
    if (!list) return;
    var addresses = Storage.getAddresses();
    if (addresses.length === 0) { list.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">등록된 주소가 없습니다.</p>'; return; }
    var html = '';
    addresses.forEach(function (a) {
        html += '<div class="address-card" style="padding:12px;margin-bottom:8px;background:var(--surface-container);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>' + a.name + '</strong><div style="font-size:11px;color:var(--gray-400);">' + a.address + (a.phone ? ' / ' + a.phone : '') + '</div></div>' +
            '<button class="btn-icon btn-sm" onclick="deleteAddress(\'' + a.id + '\')"><i class="bx bx-trash"></i></button></div>';
    });
    list.innerHTML = html;
    populateAddressDropdowns();
}

function deleteAddress(id) {
    Storage.deleteAddress(id).then(function() {
        showToast('주소가 삭제되었습니다.', 'info');
        renderAddressList();
    }).catch(function(err) {
        showToast('삭제 실패: ' + err.message, 'error');
    });
}

function populateAddressDropdowns() {
    var addresses = Storage.getAddresses();
    ['fldShippingAddress', 'fldReturnAddress', 'fldPresetShippingAddress', 'fldPresetReturnAddress'].forEach(function (selId) {
        var sel = document.getElementById(selId);
        if (!sel) return;
        sel.innerHTML = '<option value="">주소 선택</option>';
        addresses.forEach(function (a) {
            sel.innerHTML += '<option value="' + a.id + '">' + a.name + ' — ' + a.address + '</option>';
        });
    });
}

// ════════════════════════════════════════
// PRESET SUMMARY CARD & ADDRESS MAPPING (Step 2)
// ════════════════════════════════════════
function applyPresetAddresses(presetId) {
    if (!presetId) return;
    var presets = Storage.getShippingPresets();
    var sp = presets.find(function(p) { return p.id === presetId; });
    if (!sp) return;
    
    if (sp.shippingAddressId) {
        var shipSel = document.getElementById('fldShippingAddress');
        if (shipSel) shipSel.value = sp.shippingAddressId;
    }
    if (sp.returnAddressId) {
        var retSel = document.getElementById('fldReturnAddress');
        if (retSel) retSel.value = sp.returnAddressId;
    }
}

function renderPresetSummary(presetId) {
    var wrap = document.getElementById('presetSummaryWrap');
    var card = document.getElementById('presetSummaryCard');
    if (!wrap || !card) return;

    if (!presetId) {
        wrap.style.display = 'none';
        card.innerHTML = '';
        return;
    }

    var presets = Storage.getShippingPresets();
    var sp = presets.find(function(p) { return p.id === presetId; });
    if (!sp) {
        wrap.style.display = 'none';
        card.innerHTML = '';
        return;
    }

    // Resolve courier name from code
    var courierName = sp.courierCode || '-';
    if (typeof DELIVERY_DATA !== 'undefined' && sp.courierCode) {
        var match = DELIVERY_DATA.find(function(d) { return d.code === sp.courierCode; });
        if (match) courierName = match.name + ' (' + match.code + ')';
    }

    var feeDesc = sp.feeType || '-';
    if (sp.feeType === '무료') {
        feeDesc = '무료';
    } else if (sp.feeType === '유료') {
        feeDesc = '유료 — ' + formatCurrency(sp.fee) + '원';
    } else if (sp.feeType === '조건부 무료') {
        feeDesc = '조건부 무료 — 기본 ' + formatCurrency(sp.fee) + '원 / ' + formatCurrency(sp.freeCondition) + '원 이상 무료';
    } else if (sp.feeType === '수량별') {
        feeDesc = '수량별 — ' + formatCurrency(sp.fee) + '원 / ' + sp.qty + '개마다 부과';
    } else if (sp.feeType === '구간별') {
        feeDesc = '구간별 — 기본 ' + formatCurrency(sp.fee) + '원';
        if (sp.section2Qty) feeDesc += ' / ~' + sp.section2Qty + '개 기본';
        if (sp.section3Qty) feeDesc += ' / ~' + sp.section3Qty + '개 +' + formatCurrency(sp.section3Fee) + '원';
        feeDesc += ' / 초과 +' + formatCurrency(sp.addFee) + '원';
    }

    var payDesc = sp.payMethod || '-';
    if (sp.feeType === '무료') payDesc = '-';

    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">' +
        '<i class="bx bx-package" style="font-size:16px;color:var(--primary);"></i>' +
        '<span style="font-size:13px;font-weight:700;color:var(--on-surface);">' + sp.name + '</span>' +
        '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--primary-container);color:var(--on-primary-container);font-weight:600;">' + sp.feeType + '</span>' +
        '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px;">';
    html += '<div><span style="color:var(--gray-400);">배송방법</span> <span style="font-weight:600;color:var(--on-surface);">' + (sp.method || '-') + '</span></div>';
    html += '<div><span style="color:var(--gray-400);">택배사</span> <span style="font-weight:600;color:var(--on-surface);">' + courierName + '</span></div>';
    html += '<div style="grid-column:1/-1;"><span style="color:var(--gray-400);">배송비</span> <span style="font-weight:600;color:var(--on-surface);">' + feeDesc + '</span></div>';
    if (sp.feeType !== '무료') {
        html += '<div><span style="color:var(--gray-400);">결제방식</span> <span style="font-weight:600;color:var(--on-surface);">' + payDesc + '</span></div>';
    }
    html += '<div><span style="color:var(--gray-400);">반품배송비</span> <span style="font-weight:600;color:var(--on-surface);">' + formatCurrency(sp.returnFee) + '원</span></div>';
    html += '<div><span style="color:var(--gray-400);">교환배송비</span> <span style="font-weight:600;color:var(--on-surface);">' + formatCurrency(sp.exchangeFee) + '원</span></div>';
    html += '</div>';

    card.innerHTML = html;
    wrap.style.display = 'block';
}

// ════════════════════════════════════════
// MARGIN PRESETS
// ════════════════════════════════════════
var _editingMarginPresetId = null;

function initMarginPresets() {
    var addBtn = document.getElementById('btnAddMarginPreset');
    var saveBtn = document.getElementById('btnSaveMarginPreset');
    var cancelBtn = document.getElementById('btnCancelMarginPreset');
    
    if (addBtn) addBtn.addEventListener('click', function() {
        var form = document.getElementById('marginPresetForm');
        document.getElementById('pageMarginPresets').insertBefore(form, document.getElementById('marginPresetList'));
        
        resetMarginPresetForm();
        form.classList.remove('hidden');
        form.style.marginTop = '16px';
        form.style.padding = '0';
        form.style.borderTop = 'none';
        
        document.querySelectorAll('.margin-preset-card .bx-chevron-up').forEach(function(icon) {
            icon.classList.remove('bx-chevron-up');
            icon.classList.add('bx-chevron-down');
        });
    });
    
    if (cancelBtn) cancelBtn.addEventListener('click', function() {
        document.getElementById('marginPresetForm').classList.add('hidden');
        _editingMarginPresetId = null;
    });
    
    if (saveBtn) saveBtn.addEventListener('click', saveMarginPreset);

    renderMarginPresetList();
    populateMarginPresetDropdown();
}

function resetMarginPresetForm() {
    _editingMarginPresetId = null;
    document.getElementById('fldMarginPresetName').value = '';
    document.getElementById('fldMarginPresetType').value = '원';
    document.getElementById('fldMarginPresetMin').value = '';
    document.getElementById('fldMarginPresetMax').value = '';
}

function populateMarginPresetForm(presetId) {
    var form = document.getElementById('marginPresetForm');
    
    if (_editingMarginPresetId === presetId) {
        form.classList.add('hidden');
        document.getElementById('pageMarginPresets').insertBefore(form, document.getElementById('marginPresetList'));
        _editingMarginPresetId = null;
        var iconStr = document.getElementById('margin_chevron_' + presetId);
        if(iconStr) { iconStr.classList.remove('bx-chevron-up'); iconStr.classList.add('bx-chevron-down'); }
        return;
    }

    document.querySelectorAll('.margin-preset-card .bx-chevron-up').forEach(function(ico) {
        ico.classList.remove('bx-chevron-up');
        ico.classList.add('bx-chevron-down');
    });

    var presets = Storage.getMarginPresets();
    var p = presets.find(function(x) { return x.id === presetId; });
    if (!p) return;

    _editingMarginPresetId = p.id;
    document.getElementById('fldMarginPresetName').value = p.name || '';
    document.getElementById('fldMarginPresetType').value = p.type || '원';
    document.getElementById('fldMarginPresetMin').value = p.minTarget || '';
    document.getElementById('fldMarginPresetMax').value = p.maxTarget || '';

    var container = document.getElementById('marginFormContainer_' + presetId);
    if (container) {
        container.appendChild(form);
        form.style.marginTop = '0';
        form.style.padding = '0 16px 16px 16px';
        form.style.borderTop = '1px solid var(--border-color)';
        form.style.paddingTop = '16px';
    }
    
    form.classList.remove('hidden');
    
    var icon = document.getElementById('margin_chevron_' + presetId);
    if (icon) {
        icon.classList.remove('bx-chevron-down');
        icon.classList.add('bx-chevron-up');
    }
}

function saveMarginPreset() {
    var name = document.getElementById('fldMarginPresetName').value.trim();
    var type = document.getElementById('fldMarginPresetType').value;
    var minTarget = parseInt(document.getElementById('fldMarginPresetMin').value);
    var maxTarget = parseInt(document.getElementById('fldMarginPresetMax').value);

    if (!name) { showToast('마진 프리셋명을 입력하세요.', 'warning'); return; }
    if (isNaN(minTarget)) { showToast('최소 목표(값)를 입력하세요.', 'warning'); return; }

    var preset = {
        id: _editingMarginPresetId || ('margin_' + Date.now()),
        name: name,
        type: type,
        minTarget: minTarget,
        maxTarget: isNaN(maxTarget) ? null : maxTarget
    };

    Storage.saveMarginPresets(Storage.getMarginPresets().filter(function(p) { return p.id !== preset.id; }).concat(preset))
        .then(function() {
            showToast('마진 프리셋이 저장되었습니다.', 'success');
            var form = document.getElementById('marginPresetForm');
            document.getElementById('pageMarginPresets').insertBefore(form, document.getElementById('marginPresetList'));
            form.classList.add('hidden');
            _editingMarginPresetId = null;
            renderMarginPresetList();
            populateMarginPresetDropdown();
        });
}

function deleteMarginPreset(id) {
    if(!confirm('선택한 마진 프리셋을 삭제하시겠습니까?')) return;
    Storage.saveMarginPresets(Storage.getMarginPresets().filter(function(p) { return p.id !== id; }))
        .then(function() {
            showToast('삭제되었습니다.', 'info');
            renderMarginPresetList();
            populateMarginPresetDropdown();
        });
}

function renderMarginPresetList() {
    var list = document.getElementById('marginPresetList');
    if (!list) return;

    var form = document.getElementById('marginPresetForm');
    if (form) {
        document.getElementById('pageMarginPresets').insertBefore(form, document.getElementById('marginPresetList'));
        form.classList.add('hidden');
    }

    var presets = Storage.getMarginPresets();
    if (presets.length === 0) { list.innerHTML = '<p style="color:var(--gray-400);font-size:13px;">등록된 마진 프리셋이 없습니다.</p>'; return; }
    
    var html = '';
    presets.forEach(function (p) {
        html += '<div class="margin-preset-card hoverable" onclick="populateMarginPresetForm(\'' + p.id + '\')" style="cursor:pointer; margin-bottom:8px;background:var(--surface-container);border-radius:8px; overflow:hidden;">' +
            '<div style="padding:16px;display:flex;justify-content:space-between;align-items:center;">' +
            '<div><strong>' + p.name + '</strong> <span style="font-size:12px;color:var(--gray-400); margin-left:8px;">최소 ' + p.minTarget + p.type + (p.maxTarget ? ' ~ 최대 ' + p.maxTarget + p.type : '') + '</span></div>' +
            '<div>';
            
        // prevent deleting defaults if we want, but let's allow it for margins
        html += '<button class="btn-icon btn-sm" onclick="event.stopPropagation(); deleteMarginPreset(\'' + p.id + '\')" style="margin-right:12px;"><i class="bx bx-trash"></i></button>';
        
        html += '<i class="bx bx-chevron-down" id="margin_chevron_' + p.id + '" style="font-size:24px; color:var(--gray-400); vertical-align:middle;"></i></div>' +
            '</div><div id="marginFormContainer_' + p.id + '"></div></div>';
    });
    list.innerHTML = html;
}

function populateMarginPresetDropdown() {
    var sel = document.getElementById('fldMarginPreset');
    if (!sel) return;
    
    // Remember currently selected
    var currentVal = sel.value;
    
    sel.innerHTML = '<option value="">마진 프리셋 선택</option>';
    var presets = Storage.getMarginPresets();
    presets.forEach(function(p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    
    if (presets.find(function(p){return p.id === currentVal;})) {
        sel.value = currentVal;
    } else if (presets.length > 0) {
        // default select the first one if empty
        sel.value = presets[0].id;
    }
}

// ════════════════════════════════════════
// FOOTER IMAGES (NOTICE / CONSENT)
// ════════════════════════════════════════
function initFooterImages() {
    var noticeInput = document.getElementById('noticeLibInput');
    var consentInput = document.getElementById('consentLibInput');
    
    if (noticeInput) noticeInput.addEventListener('change', function(e) { 
        handleFooterImageUpload(e.target.files, 'notice'); 
        e.target.value = '';
    });
    if (consentInput) consentInput.addEventListener('change', function(e) { 
        handleFooterImageUpload(e.target.files, 'consent'); 
        e.target.value = '';
    });
    
    function bindDrop(gridId, type) {
        var grid = document.getElementById(gridId);
        if (!grid) return;
        grid.addEventListener('dragover', function(e) { 
            e.preventDefault(); 
            e.stopPropagation(); 
            grid.style.background = 'var(--surface-container-high)'; 
        });
        grid.addEventListener('dragleave', function(e) { 
            e.preventDefault(); 
            e.stopPropagation(); 
            grid.style.background = ''; 
        });
        grid.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            grid.style.background = '';
            if (e.dataTransfer && e.dataTransfer.files) {
                handleFooterImageUpload(e.dataTransfer.files, type);
            }
        });
    }
    
    bindDrop('noticeLibGrid', 'notice');
    bindDrop('consentLibGrid', 'consent');
    
    renderFooterGalleries();
    renderFooterImagePreviews();
}

function handleFooterImageUpload(files, type) {
    if (!files || files.length === 0) return;
    var promises = [];
    for (var i = 0; i < files.length; i++) {
        promises.push(Storage.uploadImage(files[i], 'library', type, i));
    }
    Promise.all(promises).then(function(results) {
        var list = type === 'notice' ? Storage.getNoticeImages() : Storage.getConsentImages();
        var isEmpty = list.length === 0;
        var idPrefix = type + '_' + Date.now() + '_';
        results.forEach(function(r, idx) {
            list.push({
                id: idPrefix + idx,
                filename: r.filename,
                url: r.url,
                autoName: r.autoName,
                isDefault: (isEmpty && idx === 0) // 창고가 완전히 비어있을 때 첫 이미지만 자동 기본값
            });
        });
        if (type === 'notice') Storage.saveNoticeImages(list);
        else Storage.saveConsentImages(list);
        
        renderFooterGalleries();
        renderFooterImagePreviews();
        showToast('이미지 ' + results.length + '장 업로드 완료', 'success');
    }).catch(function(err) {
        showToast('업로드 실패: ' + err.message, 'error');
    });
}

function renderFooterGalleries() {
    _renderCategoryGallery('noticeLibGrid', Storage.getNoticeImages(), 'notice');
    _renderCategoryGallery('consentLibGrid', Storage.getConsentImages(), 'consent');
}

function _renderCategoryGallery(gridId, images, type) {
    var grid = document.getElementById(gridId);
    if (!grid) return;
    
    // 기존 프리뷰 카드들 삭제
    grid.querySelectorAll('.gallery-card').forEach(function(el) { el.remove(); });
    
    var uploadBox = grid.querySelector('.image-upload-small');
    
    images.forEach(function(img) {
        var card = document.createElement('div');
        card.className = 'gallery-card';
        card.style.backgroundImage = 'url("' + (img.url || img.autoName) + '")';
        
        // Star Button
        var starBtn = document.createElement('button');
        starBtn.className = 'gallery-star-btn' + (img.isDefault ? ' active' : '');
        starBtn.innerHTML = img.isDefault ? "<i class='bx bxs-star'></i>" : "<i class='bx bx-star'></i>";
        starBtn.title = img.isDefault ? '기본값 설정됨' : '기본값으로 설정';
        starBtn.onclick = function() {
            images.forEach(function(i) { i.isDefault = false; });
            img.isDefault = true;
            if(type === 'notice') Storage.saveNoticeImages(images);
            else Storage.saveConsentImages(images);
            renderFooterGalleries();
            renderFooterImagePreviews();
        };
        
        // Trash Button
        var trashBtn = document.createElement('button');
        trashBtn.className = 'gallery-trash-btn';
        trashBtn.innerHTML = "<i class='bx bx-trash'></i>";
        trashBtn.onclick = function() {
            if(confirm('이 이미지를 삭제하시겠습니까?')) {
                var newList = images.filter(function(i) { return i.id !== img.id; });
                if(type === 'notice') Storage.saveNoticeImages(newList);
                else Storage.saveConsentImages(newList);
                renderFooterGalleries();
                renderFooterImagePreviews();
            }
        };
        
        // Filename label
        var nameLabel = document.createElement('span');
        nameLabel.className = 'gallery-card-name';
        nameLabel.textContent = img.filename || '';
        
        card.appendChild(starBtn);
        card.appendChild(trashBtn);
        card.appendChild(nameLabel);
        grid.insertBefore(card, uploadBox);
    });
}

function renderFooterImagePreviews() {
    var noticeSel = document.getElementById('fldNoticeImageId');
    var consentSel = document.getElementById('fldConsentImageId');
    var noticePreview = document.getElementById('noticeImagePreview');
    var consentPreview = document.getElementById('consentImagePreview');
    
    // Notice
    if (noticeSel) {
        var notices = Storage.getNoticeImages();
        var currentNoticeVal = noticeSel.value;
        noticeSel.innerHTML = '<option value="">(없음) 공지사항 미적용</option>';
        notices.forEach(function(n) {
            var opt = document.createElement('option');
            opt.value = n.id;
            opt.textContent = (n.isDefault ? '[기본] ' : '') + n.filename;
            noticeSel.appendChild(opt);
        });
        if (currentNoticeVal) noticeSel.value = currentNoticeVal;

        var activeNotice = notices.find(function(n) { return n.id === noticeSel.value; });
        if (activeNotice) {
            noticePreview.style.backgroundImage = 'url("' + (activeNotice.url || activeNotice.autoName) + '")';
            noticePreview.style.display = 'block';
        } else {
            noticePreview.style.display = 'none';
        }
    }
    
    // Consent
    if (consentSel) {
        var consents = Storage.getConsentImages();
        var currentConsentVal = consentSel.value;
        consentSel.innerHTML = '<option value="">(없음) 동의서 미적용</option>';
        consents.forEach(function(c) {
            var opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = (c.isDefault ? '[기본] ' : '') + c.filename;
            consentSel.appendChild(opt);
        });
        if (currentConsentVal) consentSel.value = currentConsentVal;

        var activeConsent = consents.find(function(c) { return c.id === consentSel.value; });
        if (activeConsent) {
            consentPreview.style.backgroundImage = 'url("' + (activeConsent.url || activeConsent.autoName) + '")';
            consentPreview.style.display = 'block';
        } else {
            consentPreview.style.display = 'none';
        }
    }
}

function exportToInventory() {
    var checks = document.querySelectorAll('.product-row-check:checked');
    if (checks.length === 0) {
        showToast('내보낼 상품을 선택하세요.', 'warning');
        return;
    }
    
    var supplier = prompt('해당 상품의 매입처를 적어주세요\n(빈칸으로 두시면 \'미지정\'으로 들어갑니다)', '');
    if (supplier === null) return; // User cancelled
    if (!supplier.trim()) supplier = '미지정';
    
    var allProducts = Storage.getProducts();
    var idsToExport = Array.from(checks).map(function(cb) { return cb.dataset.id; });
    
    var exportPayload = [];
    var todayStr = new Date().toISOString().split('T')[0];
    
    allProducts.forEach(function(p) {
        if (idsToExport.indexOf(p.id) !== -1) {
            exportPayload.push({
                supplier: supplier,
                brand: p.brand || '',
                name: p.internalName || p.productName || '',
                color: '', // 옵션 매핑 제거 (빈칸 처리)
                size: '',  // 옵션 매핑 제거 (빈칸 처리)
                uploadDate: todayStr,
                buyPrice: p.buyPrice || 0,
                buyShipping: p.buyShippingFee || 0,
                shippingBasis: p.deliveryFeeType || '수량별',
                shippingQty: p.shippingQty || 1,
                sellPrice: p.salePrice || 0,
                sellShipping: p.saleShippingFee || 0, // deliveryFee -> saleShippingFee 로 수정
                isLowestPrice: p.isLowestPrice ? 1 : 0,
                isSoldOut: 0,
                remarks: ''
            });
        }
    });
    
    if (exportPayload.length === 0) return;
    
    fetch('https://kng.junparks.com/api/seller-k/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: exportPayload })
    })
    .then(function(res) {
        if (!res.ok) throw new Error('서버 응답 오류');
        return res.json();
    })
    .then(function(result) {
        showToast(exportPayload.length + '건 매입 상품 목록으로 내보내기 성공!', 'success');
        checks.forEach(function(cb) { cb.checked = false; });
        var checkAll = document.getElementById('checkAll');
        if (checkAll) checkAll.checked = false;
    })
    .catch(function(err) {
        console.error(err);
        showToast('내보내기 실패: ' + err.message, 'error');
    });
}