import re
import os

with open('06_shopee/sell_it/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add state variables at top of module (after 'use strict')
globals_code = """
let currentMAImages = [];
let currentMAVideoUrl = '';

function renderMAImageGrid() {
    const grid = document.getElementById('ma-image-grid');
    const addBtn = document.getElementById('ma-image-add-btn');
    if(!grid || !addBtn) return;
    
    grid.innerHTML = '';
    currentMAImages.forEach((url, index) => {
        const div = document.createElement('div');
        div.style.aspectRatio = '1';
        div.style.position = 'relative';
        div.style.borderRadius = '8px';
        div.style.overflow = 'hidden';
        div.style.border = '1px solid var(--outline-variant)';
        
        const img = document.createElement('img');
        img.src = url;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        removeBtn.style.position = 'absolute';
        removeBtn.style.top = '4px';
        removeBtn.style.right = '4px';
        removeBtn.style.background = 'rgba(0,0,0,0.5)';
        removeBtn.style.color = '#fff';
        removeBtn.style.border = 'none';
        removeBtn.style.borderRadius = '50%';
        removeBtn.style.width = '24px';
        removeBtn.style.height = '24px';
        removeBtn.style.cursor = 'pointer';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            currentMAImages.splice(index, 1);
            renderMAImageGrid();
        };
        
        div.appendChild(img);
        div.appendChild(removeBtn);
        grid.appendChild(div);
    });
    
    if (currentMAImages.length < 9) {
        grid.appendChild(addBtn);
    }
}

function renderMAVideo() {
    const placeholder = document.getElementById('ma-video-placeholder');
    const videoTag = document.getElementById('ma-video-tag');
    const removeBtn = document.getElementById('ma-video-remove-btn');
    if(!placeholder) return;
    
    if (currentMAVideoUrl) {
        videoTag.src = currentMAVideoUrl;
        videoTag.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'block';
    } else {
        videoTag.src = '';
        videoTag.style.display = 'none';
        placeholder.style.display = 'inline-block';
        removeBtn.style.display = 'none';
    }
}
"""
content = re.sub(r"('use strict';)", r"\1\n" + globals_code, content)

# Modify renderMATable to use item.imageUrls[0] or item.imageUrl
render_ma_table_img = r"""<img src="${item.imageUrls ? (JSON.parse(item.imageUrls)[0] || '') : (item.imageUrl || '')}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:var(--surface-container-high);">"""
content = re.sub(r'<img src="\$\{item\.imageUrl \|\| \'\'\}" style="width:40px;height:40px;object-fit:cover;border-radius:6px;background:var\(--surface-container-high\);">', render_ma_table_img, content)

# Modify saveMAItem
save_original = """
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
"""

save_new = """
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
            coupangRocket: document.getElementById('ma-coupang-rocket')?.checked ? 1 : 0,
            naverPrice: parseFloat(document.getElementById('ma-naver-price')?.value) || 0,
            naverShipping: parseFloat(document.getElementById('ma-naver-shipping')?.value) || 0,
            coupangUrl: document.getElementById('ma-coupang-url')?.value || '',
            naverUrl: document.getElementById('ma-naver-url')?.value || '',
            note: document.getElementById('ma-note')?.value || '',
            imageUrls: currentMAImages,
            videoUrl: currentMAVideoUrl
        };
"""
content = content.replace(save_original.strip(), save_new.strip())

# Replace Image upload handlers
handlers_original = """
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
"""

handlers_new = """
    // --- Image/Video upload handlers ---
    document.getElementById('ma-image-add-btn')?.addEventListener('click', () => {
        document.getElementById('ma-image-file')?.click();
    });

    document.getElementById('ma-image-file')?.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        for(let i = 0; i < files.length; i++) {
            if (currentMAImages.length >= 9) {
                alert('이미지는 최대 9장까지만 업로드 가능합니다.');
                break;
            }
            try {
                const result = await api.uploadMarketAnalysisImage(files[i]);
                currentMAImages.push(result.url);
            } catch (err) {
                alert('이미지 업로드 실패: ' + err.message);
            }
        }
        renderMAImageGrid();
        e.target.value = ''; // reset
    });

    document.getElementById('ma-video-preview')?.addEventListener('click', () => {
        document.getElementById('ma-video-file')?.click();
    });

    document.getElementById('ma-video-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Validation
        if (file.size > 30 * 1024 * 1024) {
            alert('동영상 크기는 30MB를 초과할 수 없습니다.');
            e.target.value = '';
            return;
        }
        
        // Check duration using temp video element
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.onloadedmetadata = async function() {
            window.URL.revokeObjectURL(video.src);
            const duration = video.duration;
            if (duration < 10 || duration > 60) {
                alert(`동영상 길이는 10초에서 60초 사이여야 합니다. (현재: ${Math.round(duration)}초)`);
                e.target.value = '';
                return;
            }
            
            // Validation passed, upload
            try {
                const result = await api.uploadMarketAnalysisVideo(file);
                currentMAVideoUrl = result.url;
                renderMAVideo();
            } catch (err) {
                alert('동영상 업로드 실패: ' + err.message);
            }
            e.target.value = '';
        };
        video.src = URL.createObjectURL(file);
    });

    document.getElementById('ma-video-remove-btn')?.addEventListener('click', () => {
        currentMAVideoUrl = '';
        renderMAVideo();
    });
"""
content = content.replace(handlers_original.strip(), handlers_new.strip())

# Modify openMADrawer to populate images/videos
open_drawer_orig = """
    function openMADrawer(item = null) {
        document.getElementById('ma-drawer-overlay').classList.add('show');
        document.getElementById('ma-drawer').classList.add('show');

        if (item) {
            document.getElementById('ma-drawer-title').innerText = 'Edit Analysis';
            document.getElementById('ma-edit-id').value = item.id;
            
            const imgTag = document.getElementById('ma-image-tag');
            if (item.imageUrl) {
                imgTag.src = item.imageUrl;
                imgTag.style.display = 'block';
                document.getElementById('ma-image-placeholder').style.display = 'none';
            } else {
                imgTag.src = '';
                imgTag.style.display = 'none';
                document.getElementById('ma-image-placeholder').style.display = 'inline-block';
            }

            document.getElementById('ma-market').value = item.market || 'sg';
            document.getElementById('ma-category').value = item.shopeeCategory || '';
            document.getElementById('ma-product-name').value = item.productName || '';
            document.getElementById('ma-store-name').value = item.storeName || '';
            document.getElementById('ma-monthly-sales').value = item.monthlySales || '';
            document.getElementById('ma-listing-price').value = item.listingPrice || '';
            document.getElementById('ma-actual-price').value = item.actualPrice || '';
            document.getElementById('ma-weight').value = item.weight || '';
            document.getElementById('ma-seller-shipping').value = item.sellerShipping || '';
            document.getElementById('ma-shopee-url').value = item.shopeeUrl || '';
            
            document.getElementById('ma-coupang-price').value = item.coupangPrice || '';
            document.getElementById('ma-coupang-shipping').value = item.coupangShipping || '';
            document.getElementById('ma-naver-price').value = item.naverPrice || '';
            document.getElementById('ma-naver-shipping').value = item.naverShipping || '';
            document.getElementById('ma-coupang-url').value = item.coupangUrl || '';
            document.getElementById('ma-naver-url').value = item.naverUrl || '';
            document.getElementById('ma-note').value = item.note || '';
"""

open_drawer_new = """
    function openMADrawer(item = null) {
        document.getElementById('ma-drawer-overlay').classList.add('show');
        document.getElementById('ma-drawer').classList.add('show');

        if (item) {
            document.getElementById('ma-drawer-title').innerText = 'Edit Analysis';
            document.getElementById('ma-edit-id').value = item.id;
            
            if (item.imageUrls) {
                try { currentMAImages = JSON.parse(item.imageUrls); } catch(e) { currentMAImages = []; }
            } else if (item.imageUrl) {
                currentMAImages = [item.imageUrl];
            } else {
                currentMAImages = [];
            }
            renderMAImageGrid();

            currentMAVideoUrl = item.videoUrl || '';
            renderMAVideo();

            document.getElementById('ma-market').value = item.market || 'sg';
            document.getElementById('ma-category').value = item.shopeeCategory || '';
            document.getElementById('ma-product-name').value = item.productName || '';
            document.getElementById('ma-store-name').value = item.storeName || '';
            document.getElementById('ma-monthly-sales').value = item.monthlySales || '';
            document.getElementById('ma-listing-price').value = item.listingPrice || '';
            document.getElementById('ma-actual-price').value = item.actualPrice || '';
            document.getElementById('ma-weight').value = item.weight || '';
            document.getElementById('ma-seller-shipping').value = item.sellerShipping || '';
            document.getElementById('ma-shopee-url').value = item.shopeeUrl || '';
            
            document.getElementById('ma-coupang-price').value = item.coupangPrice || '';
            document.getElementById('ma-coupang-shipping').value = item.coupangShipping || '';
            const rocketCheck = document.getElementById('ma-coupang-rocket');
            if (rocketCheck) rocketCheck.checked = item.coupangRocket === 1;
            document.getElementById('ma-naver-price').value = item.naverPrice || '';
            document.getElementById('ma-naver-shipping').value = item.naverShipping || '';
            document.getElementById('ma-coupang-url').value = item.coupangUrl || '';
            document.getElementById('ma-naver-url').value = item.naverUrl || '';
            document.getElementById('ma-note').value = item.note || '';
"""
content = content.replace(open_drawer_orig.strip(), open_drawer_new.strip())

# Empty fields when no item
empty_orig = """
        } else {
            document.getElementById('ma-drawer-title').innerText = 'Add New';
            document.getElementById('ma-edit-id').value = '';
            
            const imgTag = document.getElementById('ma-image-tag');
            imgTag.src = '';
            imgTag.style.display = 'none';
            document.getElementById('ma-image-placeholder').style.display = 'inline-block';

            document.getElementById('ma-market').value = 'sg';
            document.getElementById('ma-category').value = '';
            document.getElementById('ma-product-name').value = '';
            document.getElementById('ma-store-name').value = '';
            document.getElementById('ma-monthly-sales').value = '';
            document.getElementById('ma-listing-price').value = '';
            document.getElementById('ma-actual-price').value = '';
            document.getElementById('ma-weight').value = '';
            document.getElementById('ma-seller-shipping').value = '';
            document.getElementById('ma-shopee-url').value = '';
            
            document.getElementById('ma-coupang-price').value = '';
            document.getElementById('ma-coupang-shipping').value = '';
            document.getElementById('ma-naver-price').value = '';
            document.getElementById('ma-naver-shipping').value = '';
            document.getElementById('ma-coupang-url').value = '';
            document.getElementById('ma-naver-url').value = '';
            document.getElementById('ma-note').value = '';
            
            document.getElementById('ma-delete-btn').style.display = 'none';
"""

empty_new = """
        } else {
            document.getElementById('ma-drawer-title').innerText = 'Add New';
            document.getElementById('ma-edit-id').value = '';
            
            currentMAImages = [];
            renderMAImageGrid();
            
            currentMAVideoUrl = '';
            renderMAVideo();

            document.getElementById('ma-market').value = 'sg';
            document.getElementById('ma-category').value = '';
            document.getElementById('ma-product-name').value = '';
            document.getElementById('ma-store-name').value = '';
            document.getElementById('ma-monthly-sales').value = '';
            document.getElementById('ma-listing-price').value = '';
            document.getElementById('ma-actual-price').value = '';
            document.getElementById('ma-weight').value = '';
            document.getElementById('ma-seller-shipping').value = '';
            document.getElementById('ma-shopee-url').value = '';
            
            document.getElementById('ma-coupang-price').value = '';
            document.getElementById('ma-coupang-shipping').value = '';
            const rocketCheck = document.getElementById('ma-coupang-rocket');
            if (rocketCheck) rocketCheck.checked = false;
            document.getElementById('ma-naver-price').value = '';
            document.getElementById('ma-naver-shipping').value = '';
            document.getElementById('ma-coupang-url').value = '';
            document.getElementById('ma-naver-url').value = '';
            document.getElementById('ma-note').value = '';
            
            document.getElementById('ma-delete-btn').style.display = 'none';
"""
content = content.replace(empty_orig.strip(), empty_new.strip())

with open('06_shopee/sell_it/app.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied to app.js")
