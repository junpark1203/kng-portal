let itemsData = [];
let categories = [];
let pendingImages = [];
let currentSearchTerm = '';
let currentCategoryFilter = '';
let selectedItemId = null;

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000/api/mat-quotes' : 'https://kng.junparks.com/api/mat-quotes';

// --- Auth Fetch ---
async function authFetch(url, opts = {}, _retries = 3) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!opts.headers) opts.headers = {};
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, opts);
    if (!res.ok && res.status === 401 && _retries > 0) {
        await new Promise(r => setTimeout(r, 800));
        return authFetch(url, opts, _retries - 1);
    }
    if (!res.ok) {
        let errStr = res.statusText;
        try { const errObj = await res.json(); errStr = errObj.error || errStr; } catch(e){}
        throw new Error(errStr);
    }
    return res;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const user = await kngAuth.verifyToken();
        if (user && user.name) {
            document.getElementById('currentUser').textContent = user.name;
        }
    } catch (error) {
        console.error('Auth error:', error);
    }
    
    await loadCategories();
    await loadItems();
    setupEventListeners();
});

function setupEventListeners() {
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value;
        renderGrid();
    });

    // Category Dropdown
    const catInput = document.getElementById('itemCategory');
    const catDropdown = document.getElementById('categoryDropdown');
    
    catInput.addEventListener('input', () => {
        const val = catInput.value.trim().toLowerCase();
        if (!val) {
            catDropdown.style.display = 'none';
            return;
        }
        const matched = categories.filter(c => c.toLowerCase().includes(val));
        if (matched.length > 0) {
            catDropdown.innerHTML = matched.map(c => `<div class="cat-dropdown-item" style="padding: 8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid #eee;" onclick="selectCategory('${c}')">${c}</div>`).join('');
            catDropdown.style.display = 'block';
        } else {
            catDropdown.style.display = 'none';
        }
    });

    catInput.addEventListener('blur', () => {
        setTimeout(() => catDropdown.style.display = 'none', 200);
    });

    // Drag and drop for images
    const dropzone = document.getElementById('itemDropzone');
    const fileInput = document.getElementById('itemFileInput');
    
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });

    // Clipboard paste event for images
    window.addEventListener('paste', (e) => {
        const modal = document.getElementById('itemModal');
        if (modal && modal.classList.contains('active')) {
            const items = e.clipboardData.items;
            const files = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    files.push(items[i].getAsFile());
                }
            }
            if (files.length > 0) {
                e.preventDefault();
                handleFiles(files);
            }
        }
    });
}

function selectCategory(cat) {
    document.getElementById('itemCategory').value = cat;
    document.getElementById('categoryDropdown').style.display = 'none';
}

// --- API Calls ---
async function loadCategories() {
    try {
        const res = await authFetch(`${API_BASE}/categories`);
        categories = await res.json();
        renderCategoryFilters();
    } catch (err) {
        console.error('Failed to load categories', err);
    }
}

async function loadItems() {
    try {
        const res = await authFetch(`${API_BASE}`);
        itemsData = await res.json();
        renderGrid();
        
        // If PDP is already open, refresh its content
        if (selectedItemId && document.getElementById('pdpOverlay').classList.contains('active')) {
            renderPDP(selectedItemId);
        }
    } catch (err) {
        console.error('Failed to load items', err);
        Swal.fire('에러', '데이터를 불러오는 중 오류가 발생했습니다.', 'error');
    }
}

// --- Image Handling ---
async function handleFiles(files) {
    const formData = new FormData();
    for(let i=0; i<files.length; i++) {
        formData.append('files', files[i]);
    }
    try {
        const res = await authFetch(`${API_BASE}/files/upload`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if(data.urls) {
            pendingImages.push(...data.urls);
            renderPreviewImages();
        }
    } catch(err) {
        Swal.fire('업로드 실패', err.message, 'error');
    }
}

async function uploadImgUrl() {
    const urlInput = document.getElementById('itemImgUrl');
    const url = urlInput.value.trim();
    if(!url) return;
    
    try {
        const res = await authFetch(`${API_BASE}/files/upload-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if(data.urls) {
            pendingImages.push(...data.urls);
            renderPreviewImages();
            urlInput.value = '';
        }
    } catch(err) {
        Swal.fire('URL 업로드 실패', err.message, 'error');
    }
}

function renderPreviewImages() {
    const container = document.getElementById('itemImgPreview');
    container.innerHTML = pendingImages.map((url, idx) => `
        <div class="img-preview-item">
            <img src="${url}">
            <button class="btn-remove" onclick="removeImage(${idx})"><i class='bx bx-x'></i></button>
        </div>
    `).join('');
}

function removeImage(idx) {
    pendingImages.splice(idx, 1);
    renderPreviewImages();
}

// --- UI Rendering ---
function renderCategoryFilters() {
    const container = document.getElementById('categoryFilters');
    let html = `<span class="cat-chip ${currentCategoryFilter === '' ? 'active' : ''}" onclick="setCategoryFilter('')">전체</span>`;
    categories.forEach(cat => {
        html += `<span class="cat-chip ${currentCategoryFilter === cat ? 'active' : ''}" onclick="setCategoryFilter('${cat}')">${cat}</span>`;
    });
    container.innerHTML = html;
}

function setCategoryFilter(cat) {
    currentCategoryFilter = cat;
    renderCategoryFilters();
    renderGrid();
}

function formatCurrency(amount, currency = 'KRW') {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: currency }).format(amount);
}

function getLowestPriceString(item) {
    let minKrw = Infinity;
    item.variants.forEach(v => {
        v.quotes.forEach(q => {
            const krwPrice = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350;
            if (krwPrice < minKrw) minKrw = krwPrice;
        });
    });
    
    if (minKrw === Infinity) return '<span style="color:var(--gray-400);font-size:14px;font-weight:600;">견적 없음</span>';
    return `<small>최저</small> ${formatCurrency(minKrw, 'KRW')} <small>~</small>`;
}

function renderGrid() {
    const container = document.getElementById('matGrid');
    
    let filtered = itemsData;
    if (currentCategoryFilter) {
        filtered = filtered.filter(item => item.category === currentCategoryFilter);
    }
    if (currentSearchTerm) {
        const term = currentSearchTerm.toLowerCase();
        filtered = filtered.filter(item => {
            if (item.itemName.toLowerCase().includes(term)) return true;
            if (item.category && item.category.toLowerCase().includes(term)) return true;
            let matchedInNested = false;
            for(let v of item.variants) {
                if(v.spec.toLowerCase().includes(term)) matchedInNested = true;
                for(let q of v.quotes) {
                    if(q.supplier.toLowerCase().includes(term)) matchedInNested = true;
                }
            }
            return matchedInNested;
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state"><i class='bx bx-search'></i><p>등록된 상품이 없거나 검색 결과가 없습니다.</p></div>`;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const thumb = item.images && item.images.length > 0 ? item.images[0] : null;
        const totalQuotes = item.variants.reduce((sum, v) => sum + v.quotes.length, 0);
        
        return `
        <div class="mat-card" onclick="openPDP('${item.id}')">
            <div class="mat-card-img-wrapper">
                ${thumb 
                    ? `<img src="${thumb}" loading="lazy" alt="${item.itemName}">` 
                    : `<div class="mat-card-placeholder"><i class='bx bx-image'></i></div>`
                }
            </div>
            <div class="mat-card-body">
                <div class="mat-card-cat">${item.category || '미분류'}</div>
                <div class="mat-card-title">${item.itemName}</div>
                <div class="mat-card-meta">
                    <span>규격 ${item.variants.length}개</span>
                    <span>견적 ${totalQuotes}건</span>
                </div>
                <div class="mat-card-price">
                    ${getLowestPriceString(item)}
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// --- PDP (Product Detail Page) ---
let currentPDPImage = null;

function openPDP(id) {
    selectedItemId = id;
    renderPDP(id);
    document.getElementById('pdpOverlay').classList.add('active');
}

function closePDP() {
    document.getElementById('pdpOverlay').classList.remove('active');
    selectedItemId = null;
}

function setPDPMainImage(src) {
    currentPDPImage = src;
    const imgEl = document.getElementById('pdpMainImgEl');
    if(imgEl) {
        imgEl.src = src;
    }
    // Update active thumb
    document.querySelectorAll('.pdp-thumb-list img').forEach(el => {
        if(el.src === src || el.getAttribute('src') === src) el.classList.add('active');
        else el.classList.remove('active');
    });
}

function renderPDP(id) {
    const item = itemsData.find(i => i.id === id);
    if (!item) {
        closePDP();
        return;
    }

    const galleryCol = document.getElementById('pdpGalleryCol');
    const infoCol = document.getElementById('pdpInfoCol');
    
    // Setup Gallery
    let galleryHtml = '';
    if (item.images && item.images.length > 0) {
        if (!currentPDPImage || !item.images.includes(currentPDPImage)) {
            currentPDPImage = item.images[0];
        }
        galleryHtml += `
            <img id="pdpMainImgEl" src="${currentPDPImage}" class="pdp-main-img" onclick="openImgViewer(this.src)">
        `;
        if (item.images.length > 1) {
            galleryHtml += `<div class="pdp-thumb-list">`;
            item.images.forEach(img => {
                const active = img === currentPDPImage ? 'active' : '';
                galleryHtml += `<img src="${img}" class="${active}" onclick="setPDPMainImage('${img}')">`;
            });
            galleryHtml += `</div>`;
        }
    } else {
        galleryHtml += `<div class="pdp-main-img-placeholder"><i class='bx bx-image'></i></div>`;
    }
    galleryCol.innerHTML = galleryHtml;

    // Setup Info & Variants
    let variantsHtml = item.variants.length > 0 
        ? item.variants.map(v => renderPDPVariant(v)).join('') 
        : '<div style="padding:40px;text-align:center;color:var(--gray-400);font-size:14px;background:#f8fafc;border-radius:12px;border:2px dashed var(--gray-200);margin-bottom:24px;">등록된 규격(옵션)이 없습니다.</div>';

    infoCol.innerHTML = `
        ${item.category ? `<span class="pdp-cat">${item.category}</span>` : ''}
        <h1 class="pdp-title">${item.itemName}</h1>
        
        ${item.remarks ? `<div class="pdp-remarks">${item.remarks}</div>` : ''}
        
        <div class="pdp-section-title">
            <span>규격 및 견적 단가</span>
            <button class="btn btn-primary btn-sm" onclick="openVariantModal('${item.id}')"><i class='bx bx-plus'></i> 규격 추가</button>
        </div>
        
        ${variantsHtml}
    `;
}

function renderPDPVariant(variant) {
    let minPrice = Infinity;
    variant.quotes.forEach(q => {
        const krwPrice = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350;
        if (krwPrice < minPrice) minPrice = krwPrice;
    });

    let quotesHtml = '';
    if (variant.quotes.length > 0) {
        quotesHtml = `
            <table class="quote-table">
                <thead>
                    <tr>
                        <th style="width:25%;">공급업체</th>
                        <th style="width:25%; text-align:right;">단가</th>
                        <th style="width:35%;">비고 / 조건</th>
                        <th style="width:15%; text-align:right;">관리</th>
                    </tr>
                </thead>
                <tbody>
                    ${variant.quotes.map(q => {
                        const krwPrice = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350;
                        const isLowest = krwPrice === minPrice && minPrice !== Infinity && variant.quotes.length > 1;
                        return `
                        <tr class="${isLowest ? 'lowest-price' : ''}">
                            <td>
                                <strong>${q.supplier}</strong>
                                ${isLowest ? '<span class="badge-crown"><i class="bx bxs-crown"></i> 최저가</span>' : ''}
                                ${q.isSelected ? '<span class="badge-selected"><i class="bx bx-check"></i> 채택</span>' : ''}
                            </td>
                            <td class="col-price">${formatCurrency(q.unitPrice, q.currency)}</td>
                            <td><span style="color:var(--gray-500); font-size:12px;">${q.remarks || '-'}</span></td>
                            <td class="col-actions">
                                <button class="btn btn-sm btn-icon" onclick="editQuote('${q.id}')"><i class='bx bx-edit'></i></button>
                                <button class="btn btn-sm btn-icon" style="color:var(--red-500);" onclick="deleteQuote('${q.id}')"><i class='bx bx-trash'></i></button>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    return `
        <div class="pdp-variant-block">
            <div class="pdp-variant-header">
                <div class="pdp-variant-title">${variant.spec} <span style="font-size:13px; color:var(--gray-500); font-weight:normal;">${variant.unit ? '('+variant.unit+')' : ''}</span></div>
                <div>
                    <button class="btn btn-sm btn-outline" style="padding:4px 8px;" onclick="editVariant('${variant.id}')"><i class='bx bx-edit'></i> 수정</button>
                </div>
            </div>
            ${quotesHtml}
            <button class="btn-add-quote-full" onclick="openQuoteModal('${variant.id}')"><i class='bx bx-plus'></i> 이 규격에 새 견적 추가</button>
        </div>
    `;
}

// --- Dynamic Initial Variants ---
function addInitialVariantRow(spec = '', unit = '') {
    const list = document.getElementById('initialVariantList');
    const rowId = 'ivRow_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const html = `
        <div id="${rowId}" style="display:flex; gap:8px; align-items:center;">
            <input type="text" class="iv-spec" placeholder="규격/옵션명 (필수)" value="${spec}" style="flex:2; padding:8px 12px; border:1px solid var(--gray-300); border-radius:6px; font-size:13px;" required>
            <div class="combo-box-wrapper" style="flex:1;">
                <input type="text" class="iv-unit" placeholder="단위" value="${unit}" style="width:100%; padding:8px 24px 8px 12px; border:1px solid var(--gray-300); border-radius:6px; font-size:13px;">
                <i class='bx bx-chevron-down combo-icon' style="right:8px;"></i>
                <select onchange="this.previousElementSibling.previousElementSibling.value = this.value; this.value=''" style="width:24px;">
                    <option value="">(선택)</option>
                    <option value="EA">EA</option><option value="SET">SET</option><option value="M">M</option>
                    <option value="KG">KG</option><option value="BOX">BOX</option><option value="ROLL">ROLL</option>
                </select>
            </div>
            <button type="button" class="btn btn-sm btn-icon" style="color:var(--red-500); border:1px solid var(--red-200); background:#fff;" onclick="document.getElementById('${rowId}').remove()"><i class='bx bx-trash'></i></button>
        </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
}

// --- Item Modals ---
function editItem(id) {
    const item = itemsData.find(i => i.id === id);
    if(item) openItemModal(item);
}

function openItemModal(item = null) {
    document.getElementById('itemModalTitle').textContent = item ? '품목 수정' : '새 품목 등록';
    document.getElementById('itemId').value = item ? item.id : '';
    document.getElementById('itemItemName').value = item ? item.itemName : '';
    document.getElementById('itemCategory').value = item ? (item.category || '') : '';
    document.getElementById('itemRemarks').value = item ? (item.remarks || '') : '';
    document.getElementById('itemImgUrl').value = '';
    
    pendingImages = item && item.images ? [...item.images] : [];
    renderPreviewImages();

    document.getElementById('initialVariantList').innerHTML = '';
    if (item) {
        document.getElementById('itemInitialVariantsWrapper').style.display = 'none'; // 수정 시에는 개별 탭에서 수정
    } else {
        document.getElementById('itemInitialVariantsWrapper').style.display = 'block';
        addInitialVariantRow(); // Add one default empty row
    }

    document.getElementById('itemModal').classList.add('active');
}

function closeItemModal() {
    document.getElementById('itemModal').classList.remove('active');
}

async function saveItem() {
    const id = document.getElementById('itemId').value;
    const itemName = document.getElementById('itemItemName').value.trim();
    if (!itemName) return Swal.fire('경고', '품목명을 입력하세요.', 'warning');
    
    const payload = {
        itemName,
        category: document.getElementById('itemCategory').value.trim(),
        remarks: document.getElementById('itemRemarks').value.trim(),
        images: pendingImages
    };

    try {
        if (id) {
            await authFetch(`${API_BASE}/${id}`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        } else {
            const res = await authFetch(`${API_BASE}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const newItem = await res.json();
            if (newItem && newItem.id) {
                selectedItemId = newItem.id;
                
                // Add initial variants sequentially
                const ivSpecs = document.querySelectorAll('#initialVariantList .iv-spec');
                const ivUnits = document.querySelectorAll('#initialVariantList .iv-unit');
                for (let i = 0; i < ivSpecs.length; i++) {
                    const s = ivSpecs[i].value.trim();
                    const u = ivUnits[i].value.trim();
                    if (s) {
                        await authFetch(`${API_BASE}/variants`, {
                            method: 'POST', headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ itemId: newItem.id, spec: s, unit: u })
                        }).catch(e => console.error("Variant save error:", e));
                    }
                }
            }
        }
        closeItemModal();
        await loadCategories();
        await loadItems();
        if(!id && selectedItemId) openPDP(selectedItemId);
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

async function deleteItem(id) {
    if(!confirm('이 품목과 포함된 모든 규격/견적을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        if (selectedItemId === id) {
            closePDP();
        }
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

// --- Variant Modals ---
function openVariantModal(itemId, variant = null) {
    document.getElementById('variantModalTitle').textContent = variant ? '규격 수정' : '새 규격(옵션) 추가';
    document.getElementById('variantId').value = variant ? variant.id : '';
    document.getElementById('variantItemId').value = itemId;
    document.getElementById('variantSpec').value = variant ? variant.spec : '';
    document.getElementById('variantUnit').value = variant ? (variant.unit || '') : '';
    
    document.getElementById('variantModal').classList.add('active');
}

function closeVariantModal() {
    document.getElementById('variantModal').classList.remove('active');
}

async function saveVariant() {
    const id = document.getElementById('variantId').value;
    const spec = document.getElementById('variantSpec').value.trim();
    if (!spec) return Swal.fire('경고', '규격/모델을 입력하세요.', 'warning');

    const payload = {
        itemId: document.getElementById('variantItemId').value,
        spec,
        unit: document.getElementById('variantUnit').value.trim()
    };

    try {
        if (id) {
            await authFetch(`${API_BASE}/variants/${id}`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        } else {
            await authFetch(`${API_BASE}/variants`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        }
        closeVariantModal();
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

function editVariant(id) {
    let target = null;
    let itemId = null;
    itemsData.forEach(item => {
        item.variants.forEach(v => { if (v.id === id) { target = v; itemId = item.id; } });
    });
    if(target) openVariantModal(itemId, target);
}

// --- Quote Modals ---
function openQuoteModal(variantId, quote = null) {
    document.getElementById('quoteModalTitle').textContent = quote ? '견적 수정' : '새 견적 추가';
    document.getElementById('quoteId').value = quote ? quote.id : '';
    document.getElementById('quoteVariantId').value = variantId;
    document.getElementById('quoteSupplier').value = quote ? quote.supplier : '';
    document.getElementById('quoteUnitPrice').value = quote ? quote.unitPrice : '';
    document.getElementById('quoteCurrency').value = quote ? quote.currency : 'KRW';
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('quoteDate').value = quote ? quote.quoteDate : today;
    document.getElementById('quoteRemarks').value = quote ? (quote.remarks || '') : '';
    document.getElementById('quoteIsSelected').checked = quote ? quote.isSelected === 1 : false;
    
    document.getElementById('quoteModal').classList.add('active');
}

function closeQuoteModal() {
    document.getElementById('quoteModal').classList.remove('active');
}

async function saveQuote() {
    const id = document.getElementById('quoteId').value;
    const supplier = document.getElementById('quoteSupplier').value.trim();
    if (!supplier) return Swal.fire('경고', '공급업체명을 입력하세요.', 'warning');
    const unitPrice = document.getElementById('quoteUnitPrice').value;
    if (unitPrice === '') return Swal.fire('경고', '단가를 입력하세요.', 'warning');

    const payload = {
        variantId: document.getElementById('quoteVariantId').value,
        supplier,
        unitPrice: Number(unitPrice),
        currency: document.getElementById('quoteCurrency').value,
        quoteDate: document.getElementById('quoteDate').value,
        remarks: document.getElementById('quoteRemarks').value.trim(),
        isSelected: document.getElementById('quoteIsSelected').checked
    };

    try {
        if (id) {
            await authFetch(`${API_BASE}/quotes/${id}`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        } else {
            await authFetch(`${API_BASE}/quotes`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        }
        closeQuoteModal();
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

function editQuote(id) {
    let target = null;
    let varId = null;
    itemsData.forEach(item => {
        item.variants.forEach(v => { 
            v.quotes.forEach(q => { if(q.id === id) { target = q; varId = v.id; } })
        });
    });
    if(target) openQuoteModal(varId, target);
}

async function deleteQuote(id) {
    if(!confirm('이 견적을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`${API_BASE}/quotes/${id}`, { method: 'DELETE' });
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

// --- Img Viewer ---
function openImgViewer(src) {
    const overlay = document.getElementById('imgViewerOverlay');
    document.getElementById('imgViewerTarget').src = src;
    overlay.classList.add('active');
}
function closeImgViewer(e) {
    const overlay = document.getElementById('imgViewerOverlay');
    if (e.target === overlay || e.target.classList.contains('bx-x') || e.target.classList.contains('modal-close')) {
        overlay.classList.remove('active');
    }
}
