/* ========================================
   SmartStore Mass Upload — Utility Functions
   ======================================== */

function generateProductCode() {
    var today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return Storage.incrementTodaySequence().then(function(seq) {
        return 'KNG-' + today + '-' + String(seq).padStart(3, '0');
    });
}

function generateImageName(productCode, type, index, ext) {
    if (index === undefined) index = 0;
    if (!ext) ext = 'jpg';
    switch (type) {
        case 'main':
            return productCode + '_main.' + ext;
        case 'add':
            return productCode + '_add' + String(index + 1).padStart(2, '0') + '.' + ext;
        case 'detail':
            return productCode + '_detail' + String(index + 1).padStart(2, '0') + '.' + ext;
        default:
            return productCode + '_img.' + ext;
    }
}

function getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
}

function formatCurrency(num) {
    if (num == null || isNaN(num)) return '0';
    return Number(num).toLocaleString('ko-KR');
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    var d = new Date(dateStr);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateShort(dateStr) {
    if (!dateStr) return '-';
    var d = new Date(dateStr);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return m + '.' + day;
}

function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function showToast(message, type) {
    if (!type) type = 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;

    var iconMap = {
        success: 'bx-check-circle',
        error: 'bx-error-circle',
        warning: 'bx-error',
        info: 'bx-info-circle'
    };

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = "<i class='bx " + (iconMap[type] || iconMap.info) + "'></i><span>" + message + "</span>";
    container.appendChild(toast);

    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
}

function debounce(fn, delay) {
    if (!delay) delay = 300;
    var timer;
    return function() {
        var args = arguments;
        var ctx = this;
        clearTimeout(timer);
        timer = setTimeout(function() { fn.apply(ctx, args); }, delay);
    };
}

function getProductStatus(product) {
    var errors = [];
    if (!product.categoryId) errors.push('카테고리 미선택');
    if (!product.productName) errors.push('상품명 미입력');
    if (!product.salePrice || product.salePrice <= 0) errors.push('판매가 미설정');
    if (!product.stock && product.stock !== 0) errors.push('재고수량 미입력');
    if (!product.originCode) errors.push('원산지 미선택');

    var images = Storage.getProductImages(product.id);
    if (!images.main) errors.push('대표이미지 없음');
    if (!images.detail || images.detail.length === 0) errors.push('상세이미지 없음');

    if (errors.length > 0) return { status: 'incomplete', errors: errors };
    return { status: 'complete', errors: [] };
}

function fileToDataUrl(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(e) { resolve(e.target.result); };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var raw = atob(parts[1]);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function createEmptyProduct() {
    var defaults = Storage.getDefaults();
    var defaultNotice = Storage.getNoticeImages().find(function(i) { return i.isDefault; });
    var defaultConsent = Storage.getConsentImages().find(function(i) { return i.isDefault; });
    
    return {
        id: uuid(),
        code: generateProductCode(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        categoryId: '',
        categoryName: '',
        internalName: '',
        productName: '',
        productStatus: defaults.productStatus || '신상품',
        salePrice: 0,
        buyPrice: 0,
        stock: 0,
        vat: defaults.vat || '과세상품',
        optionType: '',
        optionNames: [],
        optionValues: [],
        combinations: [],
        options: [],
        directInputOptions: [],
        additionalProducts: [],
        brand: '',
        manufacturer: '',
        mfgDate: '',
        originCode: '03',
        originName: '상세설명에 표시',
        minorPurchase: defaults.minorPurchase || 'Y',
        noticeName: '상세설명에 표시',
        noticeModel: '상세설명에 표시',
        noticeCert: '상세설명에 표시',
        noticeMaker: '상세설명에 표시',
        shippingPresetId: 'default',
        shippingAddressId: 'default',
        returnAddressId: 'default',
        asPhone: defaults.asPhone || '',
        asGuide: defaults.asGuide || '',
        discount: {},
        unitPriceRequired: false,
        displayVolume: '',
        displayUnit: '',
        totalVolume: '',
        noticeImageId: defaultNotice ? defaultNotice.id : '',
        consentImageId: defaultConsent ? defaultConsent.id : '',
        remarks: ''
    };
}
