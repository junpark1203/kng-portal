let itemsData = [];
let categories = [];
let pendingImages = [];
let currentSearchTerm = '';
let currentCategoryFilter = '';
let selectedItemId = null;
let currentPDPImage = null;

const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000/api/mat-quotes' : 'https://kng.junparks.com/api/mat-quotes';

function getImgSrc(url) {
    if (!url) return '';
    if (url.startsWith('/api/mat-quotes')) {
        const base = API_BASE.replace('/api/mat-quotes', '');
        return base + url;
    }
    return url;
}

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
            <img src="${getImgSrc(url)}">
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
        let thumb = item.images && item.images.length > 0 ? item.images[0] : null;
        if(thumb) thumb = getImgSrc(thumb);
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

function openPDP(id) {
    selectedItemId = id;
    renderPDP(id);
    document.getElementById('pdpOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closePDP() {
    document.getElementById('pdpOverlay').classList.remove('active');
    document.body.style.overflow = '';
    selectedItemId = null;
}

function setPDPMainImage(src) {
    currentPDPImage = src;
    document.getElementById('pdpMainImage').style.backgroundImage = `url('${getImgSrc(src)}')`;
    // Update active thumb
    document.querySelectorAll('.pdp-gallery-thumbs img').forEach(el => {
        if(el.src === getImgSrc(src) || el.getAttribute('src') === src) el.classList.add('active');
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
    const bottomSec = document.getElementById('pdpBottomSection');
    
    // Setup Gallery
    if (item.images && item.images.length > 0) {
        if (!currentPDPImage || !item.images.includes(currentPDPImage)) {
            currentPDPImage = item.images[0];
        }
        galleryCol.innerHTML = `
            <div id="pdpMainImage" class="pdp-main-img" style="background-image: url('${getImgSrc(currentPDPImage)}');" onclick="openImgViewer('${currentPDPImage}')"></div>
            <div id="pdpGallery"></div>
        `;
        
        if (item.images.length > 1) {
            let galleryHtml = `<div class="pdp-gallery-thumbs">`;
            item.images.forEach(img => {
                const active = img === currentPDPImage ? 'active' : '';
                galleryHtml += `<img src="${getImgSrc(img)}" class="${active}" onclick="setPDPMainImage('${img}')">`;
            });
            galleryHtml += `</div>`;
            document.getElementById('pdpGallery').innerHTML = galleryHtml;
        }
    } else {
        galleryCol.innerHTML = `<div class="pdp-main-img-placeholder"><i class='bx bx-image'></i></div>`;
    }

    // Info Col (Top Right)
    const allSuppliers = Array.from(new Set(item.variants.flatMap(v => v.quotes.map(q => q.supplier)))).sort();
    let minPriceOverall = Infinity;
    let repSpec = '-';
    item.variants.forEach(v => {
        v.quotes.forEach(q => {
            const krwPrice = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350;
            if(krwPrice < minPriceOverall) {
                minPriceOverall = krwPrice;
                repSpec = v.spec;
            }
        });
    });
    if(minPriceOverall === Infinity) minPriceOverall = 0;

    infoCol.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">
            <h1 class="pdp-title" style="margin:0; font-size:24px; font-weight:700;">${item.itemName}</h1>
            <div style="color:var(--gray-400); font-size:24px; cursor:pointer;"><i class='bx bx-heart'></i></div>
        </div>
        
        <div class="pdp-meta-table" style="margin-bottom:24px; font-size:14px;">
            <div style="display:flex; padding:8px 0; border-bottom:1px solid var(--gray-100);">
                <div style="width:100px; color:var(--gray-500);">판매업체</div>
                <div style="font-weight:600; color:var(--primary);">${allSuppliers.length}개</div>
            </div>
            <div style="display:flex; padding:8px 0; border-bottom:1px solid var(--gray-100);">
                <div style="width:100px; color:var(--gray-500);">카테고리</div>
                <div>${item.category || '-'}</div>
            </div>
            <div style="display:flex; padding:8px 0; border-bottom:1px solid var(--gray-100);">
                <div style="width:100px; color:var(--gray-500);">대표규격</div>
                <div>${repSpec}</div>
            </div>
            <div style="display:flex; padding:8px 0; border-bottom:1px solid var(--gray-100);">
                <div style="width:100px; color:var(--gray-500);">대표단가</div>
                <div style="font-weight:700; font-size:16px; color:var(--gray-900);">${minPriceOverall > 0 ? formatCurrency(minPriceOverall) : '-'}</div>
            </div>
        </div>

        ${item.remarks ? `<div class="pdp-remarks" style="margin-bottom:24px; padding:12px; background:var(--gray-50); border-radius:8px; font-size:13px;">${item.remarks}</div>` : ''}
        
        ${item.customFields && item.customFields.length > 0 ? `
            <div class="pdp-custom-fields" style="margin-bottom: 24px;">
                <table style="width:100%; border-collapse:collapse; font-size:13px; border:1px solid var(--gray-200); border-radius:8px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    ${item.customFields.map((cf, idx) => `
                        <tr>
                            <td style="width:35%; padding:8px 12px; background:var(--gray-50); color:var(--gray-600); font-weight:600; border-bottom:${idx === item.customFields.length - 1 ? 'none' : '1px solid var(--gray-200)'}; border-right:1px solid var(--gray-200);">${cf.key}</td>
                            <td style="padding:8px 12px; color:var(--gray-800); border-bottom:${idx === item.customFields.length - 1 ? 'none' : '1px solid var(--gray-200)'};">${cf.val}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        ` : ''}
        
    `;
    
    // Bottom Section (Matrix Table)
    let matrixHtml = `
        <div class="pdp-section-title" style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-end;">
            <span style="font-size:18px; font-weight:700; color:var(--primary);">규격별 단가</span>
        </div>
    `;
    
    if (item.variants.length > 0) {
        matrixHtml += `
            <div style="overflow-x:auto; border-radius:8px; border:1px solid var(--gray-200);">
                <table style="width:100%; border-collapse:collapse; font-size:14px; text-align:center;">
                    <thead style="background:var(--gray-50); color:var(--gray-700); font-weight:600;">
                        <tr>
                            <th style="padding:12px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200);">규격</th>
                            <th style="padding:12px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200); width:80px;">단위</th>
                            ${allSuppliers.map(s => `<th style="padding:12px; border-bottom:1px solid var(--gray-200); min-width:120px;">${s}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${item.variants.map(v => {
                            let vMin = Infinity;
                            v.quotes.forEach(qq => {
                                const kp = qq.currency === 'KRW' ? qq.unitPrice : qq.unitPrice * 1350;
                                if(kp < vMin) vMin = kp;
                            });

                            return `
                                <tr>
                                    <td style="padding:12px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200); text-align:left; font-weight:600; color:var(--gray-800);">
                                        ${v.spec}

                                    </td>
                                    <td style="padding:12px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200); color:var(--gray-600);">${v.unit || '-'}</td>
                                    ${allSuppliers.map(s => {
                                        const q = v.quotes.find(quote => quote.supplier === s);
                                        if (q) {
                                            const qp = q.currency === 'KRW' ? q.unitPrice : q.unitPrice * 1350;
                                            const isVarLowest = (qp === vMin && v.quotes.length > 1);
                                            
                                            return `
                                            <td style="padding:12px; border-bottom:1px solid var(--gray-200); position:relative;">
                                                <div style="font-weight:${isVarLowest ? '700' : 'normal'}; color:${isVarLowest ? 'var(--red-600)' : 'var(--gray-800)'};">${formatCurrency(q.unitPrice, q.currency)}</div>

                                            </td>
                                            `;
                                        } else {
                                            return `<td style="padding:12px; border-bottom:1px solid var(--gray-200); color:var(--gray-300);">-</td>`;
                                        }
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        matrixHtml += '<div style="padding:40px;text-align:center;color:var(--gray-400);font-size:14px;background:#f8fafc;border-radius:12px;border:2px dashed var(--gray-200);">등록된 규격(옵션)이 없습니다.</div>';
    }
    bottomSec.innerHTML = matrixHtml;
}

// --- Dynamic Custom Fields ---
function addCustomFieldRow(key = '', val = '') {
    const list = document.getElementById('customFieldList');
    const rowId = 'cfRow_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const html = `
        <div id="${rowId}" style="display:flex; gap:6px; align-items:center;">
            <input type="text" class="cf-key" placeholder="속성명 (예: 재질)" value="${key}" style="flex:1; padding:6px 10px; border:1px solid var(--gray-300); border-radius:4px; font-size:12px;">
            <input type="text" class="cf-val" placeholder="내용 (예: 알루미늄)" value="${val}" style="flex:2; padding:6px 10px; border:1px solid var(--gray-300); border-radius:4px; font-size:12px;">
            <button type="button" class="btn btn-sm btn-icon" style="color:var(--gray-500); padding:4px;" onclick="document.getElementById('${rowId}').remove()"><i class='bx bx-x' style="font-size:18px;"></i></button>
        </div>
    `;
    list.insertAdjacentHTML('beforeend', html);
}

// --- Dynamic Initial Variants & Suppliers (Matrix) ---
let initialSupplierIds = [];

function addInitialSupplier(defaultName = '') {
    const colId = 'supp_' + Date.now() + Math.random().toString(36).substr(2, 5);
    initialSupplierIds.push(colId);

    const headerRow = document.getElementById('initialMatrixHeader');
    const th = document.createElement('th');
    th.className = 'matrix-supplier-col';
    th.style.padding = '8px';
    th.style.borderBottom = '1px solid var(--gray-200)';
    th.style.borderRight = '1px solid var(--gray-200)';
    th.dataset.colId = colId;
    th.innerHTML = `
        <div style="display:flex; align-items:center; background:#fff; border:1px solid var(--gray-300); border-radius:4px; padding:2px 4px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
            <input type="text" placeholder="판매사명" value="${defaultName}" class="initial-supplier-name" style="flex:1; width:100%; min-width:80px; border:none; outline:none; font-size:13px; font-weight:700; text-align:center; color:var(--primary);">
            <button type="button" class="btn btn-sm btn-icon" style="padding:2px; flex-shrink:0; color:var(--red-500); margin-left:4px;" onclick="removeInitialSupplier('${colId}')"><i class='bx bx-x' style="font-size:16px;"></i></button>
        </div>
    `;
    headerRow.insertBefore(th, headerRow.lastElementChild);

    document.querySelectorAll('#initialVariantList tr').forEach(tr => {
        const td = document.createElement('td');
        td.className = 'matrix-supplier-col';
        td.style.padding = '4px';
        td.style.borderBottom = '1px solid var(--gray-200)';
        td.style.borderRight = '1px solid var(--gray-200)';
        td.dataset.colId = colId;
        td.innerHTML = `<input type="number" class="initial-supplier-price" placeholder="단가(원)" style="width:100%; border:1px solid var(--gray-300); border-radius:4px; padding:6px; box-sizing:border-box; font-size:12px; text-align:right;">`;
        tr.insertBefore(td, tr.lastElementChild);
    });
}

function removeInitialSupplier(colId) {
    initialSupplierIds = initialSupplierIds.filter(id => id !== colId);
    document.querySelectorAll(`.matrix-supplier-col[data-col-id="${colId}"]`).forEach(el => el.remove());
}

function addInitialVariantRow(spec = '', unit = '') {
    const list = document.getElementById('initialVariantList');
    
    if (!unit && list.lastElementChild) {
        const lastUnitInput = list.lastElementChild.querySelector('.iv-unit');
        if (lastUnitInput && lastUnitInput.value.trim()) {
            unit = lastUnitInput.value.trim();
        }
    }

    const rowId = 'ivRow_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const tr = document.createElement('tr');
    tr.id = rowId;
    
    let html = `
        <td style="padding:4px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200);">
            <input type="text" class="iv-spec" placeholder="규격 입력" value="${spec}" style="width:100%; border:1px solid var(--gray-300); border-radius:4px; padding:6px; box-sizing:border-box; font-size:12px;" required>
        </td>
        <td style="padding:4px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200);">
            <div class="combo-box-wrapper" style="width:100%;">
                <input type="text" class="iv-unit" placeholder="단위" value="${unit}" style="width:100%; padding:6px 20px 6px 8px; border:1px solid var(--gray-300); border-radius:4px; font-size:12px; text-align:center;">
                <i class='bx bx-chevron-down combo-icon' style="right:4px;"></i>
                <select onchange="this.previousElementSibling.previousElementSibling.value = this.value; this.value=''" style="width:20px;">
                    <option value="">(선택)</option>
                    <option value="EA">EA</option><option value="SET">SET</option><option value="M">M</option>
                    <option value="KG">KG</option><option value="BOX">BOX</option><option value="ROLL">ROLL</option>
                </select>
            </div>
        </td>
    `;
    
    initialSupplierIds.forEach(colId => {
        html += `
        <td class="matrix-supplier-col" data-col-id="${colId}" style="padding:4px; border-bottom:1px solid var(--gray-200); border-right:1px solid var(--gray-200);">
            <input type="number" class="initial-supplier-price" placeholder="단가(원)" style="width:100%; border:1px solid var(--gray-300); border-radius:4px; padding:6px; box-sizing:border-box; font-size:12px; text-align:right;">
        </td>
        `;
    });
    
    html += `
        <td style="padding:4px; border-bottom:1px solid var(--gray-200);">
            <button type="button" class="btn btn-sm btn-icon" style="color:var(--red-500); background:#fff; border:1px solid var(--red-200);" onclick="document.getElementById('${rowId}').remove()"><i class='bx bx-trash'></i></button>
        </td>
    `;
    
    tr.innerHTML = html;
    list.appendChild(tr);
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

    document.getElementById('customFieldList').innerHTML = '';
    if (item && item.customFields) {
        item.customFields.forEach(cf => addCustomFieldRow(cf.key, cf.val));
    }

    document.getElementById('initialVariantList').innerHTML = '';
    initialSupplierIds = [];
    document.querySelectorAll('.matrix-supplier-col').forEach(el => el.remove());

    document.getElementById('itemInitialVariantsWrapper').style.display = 'block';

    if (item && item.variants && item.variants.length > 0) {
        const suppliers = new Set();
        item.variants.forEach(v => {
            v.quotes.forEach(q => suppliers.add(q.supplier));
        });
        const supplierArray = Array.from(suppliers).sort();
        
        if (supplierArray.length === 0) {
            addInitialSupplier('판매사 1');
            addInitialVariantRow();
        } else {
            supplierArray.forEach(s => addInitialSupplier(s));
            item.variants.forEach(v => {
                addInitialVariantRow(v.spec, v.unit);
                const trs = document.querySelectorAll('#initialVariantList tr');
                const tr = trs[trs.length - 1];
                
                v.quotes.forEach(q => {
                    const thIndex = supplierArray.indexOf(q.supplier);
                    const colId = initialSupplierIds[thIndex];
                    if (colId) {
                        const input = tr.querySelector(`td[data-col-id="${colId}"] input.initial-supplier-price`);
                        if (input) input.value = q.unitPrice;
                    }
                });
            });
        }
    } else {
        addInitialSupplier('판매사 1');
        addInitialVariantRow();
    }

    document.getElementById('itemModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeItemModal() {
    document.getElementById('itemModal').classList.remove('active');
    document.body.style.overflow = '';
}

async function saveItem() {
    const id = document.getElementById('itemId').value;
    const itemName = document.getElementById('itemItemName').value.trim();
    if (!itemName) return Swal.fire('경고', '품목명을 입력하세요.', 'warning');
    
    const customFields = [];
    document.querySelectorAll('#customFieldList > div').forEach(row => {
        const key = row.querySelector('.cf-key').value.trim();
        const val = row.querySelector('.cf-val').value.trim();
        if(key || val) customFields.push({ key, val });
    });

    const payload = {
        itemName,
        category: document.getElementById('itemCategory').value.trim(),
        remarks: document.getElementById('itemRemarks').value.trim(),
        images: pendingImages,
        customFields
    };

    try {
        let initialVariants = [];
        const item = !!id;
        
        const supplierNames = {};
        document.querySelectorAll('#initialMatrixHeader .matrix-supplier-col').forEach(th => {
            const colId = th.dataset.colId;
            const name = th.querySelector('.initial-supplier-name').value.trim();
            if(name) supplierNames[colId] = name;
        });
        
        document.querySelectorAll('#initialVariantList tr').forEach(tr => {
            const spec = tr.querySelector('.iv-spec').value.trim();
            const unit = tr.querySelector('.iv-unit').value.trim();
            if (spec) {
                const quotes = [];
                tr.querySelectorAll('.matrix-supplier-col').forEach(td => {
                    const colId = td.dataset.colId;
                    const price = td.querySelector('.initial-supplier-price').value.trim();
                    if (price && supplierNames[colId]) {
                        quotes.push({ supplier: supplierNames[colId], unitPrice: parseInt(price, 10) });
                    }
                });
                initialVariants.push({ spec, unit, quotes });
            }
        });

        let targetItemId = id;

        if (item) {
            // Update existing item basic details
            await authFetch(`${API_BASE}/${id}`, {
                method: 'PUT', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            // Wipe existing variants and quotes
            await authFetch(`${API_BASE}/${id}/variants-all`, {
                method: 'DELETE'
            });
        } else {
            // Create new item
            const res = await authFetch(`${API_BASE}`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(payload)
            });
            const newItem = await res.json();
            targetItemId = newItem.id;
        }

        // Post all variants and quotes
        for (let i = 0; i < initialVariants.length; i++) {
            const v = initialVariants[i];
            const vRes = await authFetch(`${API_BASE}/variants`, {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ itemId: targetItemId, spec: v.spec, unit: v.unit, sortOrder: i })
            });
            if(vRes.ok && v.quotes.length > 0) {
                const newVar = await vRes.json();
                for(const q of v.quotes) {
                    await authFetch(`${API_BASE}/quotes`, {
                        method: 'POST', headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ variantId: newVar.id, supplier: q.supplier, unitPrice: q.unitPrice })
                    });
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
    document.body.style.overflow = 'hidden';
}

function closeVariantModal() {
    document.getElementById('variantModal').classList.remove('active');
    document.body.style.overflow = '';
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
    document.body.style.overflow = 'hidden';
}

function closeQuoteModal() {
    document.getElementById('quoteModal').classList.remove('active');
    document.body.style.overflow = '';
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
    document.getElementById('imgViewerTarget').src = getImgSrc(src);
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}
function closeImgViewer(e) {
    const overlay = document.getElementById('imgViewerOverlay');
    if (e.target === overlay || e.target.classList.contains('bx-x') || e.target.classList.contains('modal-close')) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}
