let itemsData = [];
let categories = [];
let pendingImages = [];
let currentSearchTerm = '';
let currentCategoryFilter = '';

const API_BASE = '/api/mat-quotes';

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
        renderList();
    });
    document.getElementById('searchClear').addEventListener('click', () => {
        searchInput.value = '';
        currentSearchTerm = '';
        renderList();
    });

    // Category Dropdown logic (fuzzy search)
    const catInput = document.getElementById('itemCategory');
    const catDropdown = document.getElementById('categoryDropdown');
    
    catInput.addEventListener('input', () => {
        const val = catInput.value.trim().toLowerCase();
        if (!val) {
            catDropdown.style.display = 'none';
            return;
        }
        // fuzzy match: includes
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
        updateKPIs();
        renderList();
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
            body: formData,
            headers: {} // let browser set multipart boundary
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
    let html = `<span class="drawer-cat-chip ${currentCategoryFilter === '' ? 'active' : ''}" onclick="setCategoryFilter('')">전체</span>`;
    categories.forEach(cat => {
        html += `<span class="drawer-cat-chip ${currentCategoryFilter === cat ? 'active' : ''}" onclick="setCategoryFilter('${cat}')">${cat}</span>`;
    });
    container.innerHTML = html;
}

function setCategoryFilter(cat) {
    currentCategoryFilter = cat;
    renderCategoryFilters();
    renderList();
}

function updateKPIs() {
    document.getElementById('kpiTotalItems').textContent = itemsData.length;
    let quoteCount = 0;
    itemsData.forEach(item => {
        item.variants.forEach(v => quoteCount += v.quotes.length);
    });
    document.getElementById('kpiTotalQuotes').textContent = quoteCount;
}

function formatCurrency(amount, currency = 'KRW') {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: currency }).format(amount);
}

function renderList() {
    const container = document.getElementById('matList');
    
    let filtered = itemsData;
    if (currentCategoryFilter) {
        filtered = filtered.filter(item => item.category === currentCategoryFilter);
    }
    if (currentSearchTerm) {
        const term = currentSearchTerm.toLowerCase();
        filtered = filtered.filter(item => {
            if (item.itemName.toLowerCase().includes(term)) return true;
            if (item.category.toLowerCase().includes(term)) return true;
            // search in variants/quotes
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
        container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--gray-400);">검색 결과가 없습니다.</div>`;
        return;
    }

    container.innerHTML = filtered.map(item => {
        const thumb = item.images && item.images.length > 0 ? item.images[0] : null;
        
        return `
        <div class="mat-card">
            <div class="mat-header">
                ${thumb 
                    ? `<img src="${thumb}" class="mat-img" onclick="openImgViewer('${thumb}')">` 
                    : `<div class="mat-img-placeholder"><i class='bx bx-image'></i></div>`
                }
                <div class="mat-info">
                    ${item.category ? `<div class="mat-cat-badge">${item.category}</div>` : ''}
                    <h3>${item.itemName}</h3>
                    ${item.remarks ? `<div class="mat-remarks">${item.remarks}</div>` : ''}
                </div>
                <div class="mat-actions">
                    <button class="btn btn-sm btn-outline" onclick="editItem('${item.id}')"><i class='bx bx-edit'></i> 수정</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteItem('${item.id}')"><i class='bx bx-trash'></i></button>
                </div>
            </div>
            <div class="mat-body">
                ${item.variants.length > 0 ? item.variants.map(v => renderVariant(v)).join('') : '<div style="padding:16px;text-align:center;color:var(--gray-400);font-size:13px;">등록된 규격이 없습니다.</div>'}
                <button class="btn-add-variant" onclick="openVariantModal('${item.id}')"><i class='bx bx-plus'></i> 이 품목에 새로운 규격 추가</button>
            </div>
        </div>
        `;
    }).join('');
}

function renderVariant(variant) {
    // Find lowest price
    let minPrice = Infinity;
    variant.quotes.forEach(q => {
        // Here we could add currency conversion if necessary, but assuming KRW for lowest price highlighting usually
        // For simplicity, we just compare raw unitPrice if currency is same, else ignore for 'min' calculation or assume KRW
        const krwPrice = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350; // dummy conversion for now
        if (krwPrice < minPrice) minPrice = krwPrice;
    });

    let quotesHtml = '';
    if (variant.quotes.length > 0) {
        quotesHtml = `
            <table class="quote-table">
                <thead>
                    <tr>
                        <th style="width:25%;">공급업체</th>
                        <th style="width:20%; text-align:right;">단가</th>
                        <th style="width:15%;">견적일</th>
                        <th style="width:30%;">비고/조건</th>
                        <th style="width:10%;">관리</th>
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
                                ${isLowest ? '<span class="badge-lowest">최저가</span>' : ''}
                                ${q.isSelected ? '<span class="badge-selected"><i class="bx bx-check"></i> 채택</span>' : ''}
                            </td>
                            <td class="col-price">${formatCurrency(q.unitPrice, q.currency)}</td>
                            <td>${q.quoteDate}</td>
                            <td><span style="color:var(--gray-600); font-size:11px;">${q.remarks}</span></td>
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
        <div class="variant-block">
            <div class="variant-header">
                <div class="variant-title"><i class='bx bx-check-square'></i> ${variant.spec} <span class="variant-unit">(${variant.unit})</span></div>
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-sm btn-outline" style="padding:4px 8px; font-size:11px;" onclick="editVariant('${variant.id}')"><i class='bx bx-edit'></i></button>
                    <button class="btn btn-sm btn-outline" style="padding:4px 8px; font-size:11px;" onclick="openQuoteModal('${variant.id}')"><i class='bx bx-plus'></i> 견적 추가</button>
                </div>
            </div>
            ${quotesHtml}
        </div>
    `;
}

// --- Item Modals ---
function openItemModal(item = null) {
    document.getElementById('itemModalTitle').textContent = item ? '품목 수정' : '품목 등록';
    document.getElementById('itemId').value = item ? item.id : '';
    document.getElementById('itemItemName').value = item ? item.itemName : '';
    document.getElementById('itemCategory').value = item ? item.category : '';
    document.getElementById('itemRemarks').value = item ? item.remarks : '';
    document.getElementById('itemImgUrl').value = '';
    
    pendingImages = item ? [...item.images] : [];
    renderPreviewImages();
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
            await authFetch(`${API_BASE}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
        }
        closeItemModal();
        await loadCategories();
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

async function deleteItem(id) {
    if(!confirm('이 품목과 포함된 모든 규격/견적을 삭제하시겠습니까?')) return;
    try {
        await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        await loadItems();
    } catch(err) {
        Swal.fire('실패', err.message, 'error');
    }
}

// --- Variant Modals ---
function openVariantModal(itemId, variant = null) {
    document.getElementById('variantModalTitle').textContent = variant ? '규격 수정' : '규격 추가';
    document.getElementById('variantId').value = variant ? variant.id : '';
    document.getElementById('variantItemId').value = itemId;
    document.getElementById('variantSpec').value = variant ? variant.spec : '';
    document.getElementById('variantUnit').value = variant ? variant.unit : '';
    
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
    document.getElementById('quoteModalTitle').textContent = quote ? '견적 수정' : '견적 추가';
    document.getElementById('quoteId').value = quote ? quote.id : '';
    document.getElementById('quoteVariantId').value = variantId;
    document.getElementById('quoteSupplier').value = quote ? quote.supplier : '';
    document.getElementById('quoteUnitPrice').value = quote ? quote.unitPrice : '';
    document.getElementById('quoteCurrency').value = quote ? quote.currency : 'KRW';
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('quoteDate').value = quote ? quote.quoteDate : today;
    document.getElementById('quoteRemarks').value = quote ? quote.remarks : '';
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
