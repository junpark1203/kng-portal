// ========================================
// SmartStore Mass Upload — Storage Layer
// Cache-First API Client
// 읽기 = 동기(캐시), 쓰기 = async(서버+캐시)
// ========================================

var STORAGE_API = 'https://kng.junparks.com/api/mass-upload';
var IMG_BASE_URL = 'https://ss-upload-img.junparks.com';

// ── 로컬 개발 감지 ──
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    STORAGE_API = 'http://127.0.0.1:3000/api/mass-upload';
}

var Storage = {
    // ── 인메모리 캐시 ──
    _cache: {
        products: [],
        presets: [],
        addresses: [],
        exportCart: [],
        settings: {}
    },

    _initialized: false,

    // ════════════════════════════════════════
    // 초기화: 서버에서 데이터 로드 → 캐시
    // ════════════════════════════════════════
    init: function() {
        var self = this;
        return Promise.all([
            fetch(STORAGE_API + '/products').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/presets').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/addresses').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/export-cart').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/settings/defaults').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/settings/cat_favorites').then(function(r) { return r.json(); }),
            fetch(STORAGE_API + '/settings/margin_presets').then(function(r) { return r.json(); }).catch(function() { return { value: null }; }),
            fetch(STORAGE_API + '/settings/notice_images').then(function(r) { return r.json(); }).catch(function() { return { value: null }; }),
            fetch(STORAGE_API + '/settings/consent_images').then(function(r) { return r.json(); }).catch(function() { return { value: null }; })
        ]).then(function(results) {
            self._cache.products = results[0] || [];
            self._cache.presets = results[1] || [];
            self._cache.addresses = results[2] || [];
            self._cache.exportCart = results[3] || [];
            self._cache.settings.defaults = (results[4] && results[4].value) ? results[4].value : self._defaultValues();
            self._cache.settings.cat_favorites = (results[5] && results[5].value) ? results[5].value : [];
            self._cache.settings.margin_presets = (results[6] && results[6].value) ? results[6].value : self._defaultMarginPresets();
            self._cache.settings.notice_images = (results[7] && results[7].value) ? results[7].value : [];
            self._cache.settings.consent_images = (results[8] && results[8].value) ? results[8].value : [];
            self._initialized = true;
            console.log('[Storage] 서버 데이터 로드 완료 — 상품:', self._cache.products.length,
                '프리셋:', self._cache.presets.length, '주소:', self._cache.addresses.length);
        }).catch(function(err) {
            console.error('[Storage] 서버 연결 실패, 로컬 폴백:', err);
            // 서버 연결 실패 시 localStorage 폴백
            self._fallbackToLocal();
            self._initialized = true;
        });
    },

    // ── localStorage 폴백 (서버 장애 시) ──
    _fallbackToLocal: function() {
        try { this._cache.products = JSON.parse(localStorage.getItem('kng_mass_products')) || []; } catch(e) { this._cache.products = []; }
        try { this._cache.presets = JSON.parse(localStorage.getItem('kng_mass_shipping_presets')) || this._defaultShippingPresets(); } catch(e) { this._cache.presets = this._defaultShippingPresets(); }
        try { this._cache.addresses = JSON.parse(localStorage.getItem('kng_mass_addresses')) || this._defaultAddresses(); } catch(e) { this._cache.addresses = this._defaultAddresses(); }
        try { this._cache.exportCart = JSON.parse(localStorage.getItem('kng_mass_export_cart')) || []; } catch(e) { this._cache.exportCart = []; }
        try { this._cache.settings.defaults = JSON.parse(localStorage.getItem('kng_mass_defaults')) || this._defaultValues(); } catch(e) { this._cache.settings.defaults = this._defaultValues(); }
        try { this._cache.settings.cat_favorites = JSON.parse(localStorage.getItem('kng_mass_cat_favorites')) || []; } catch(e) { this._cache.settings.cat_favorites = []; }
        try { this._cache.settings.notice_images = JSON.parse(localStorage.getItem('kng_mass_notice_images')) || []; } catch(e) { this._cache.settings.notice_images = []; }
        try { this._cache.settings.consent_images = JSON.parse(localStorage.getItem('kng_mass_consent_images')) || []; } catch(e) { this._cache.settings.consent_images = []; }
    },

    // ════════════════════════════════════════
    // Products — 읽기 (동기, 캐시에서)
    // ════════════════════════════════════════
    getProducts: function() {
        return this._cache.products;
    },

    getProduct: function(id) {
        return this._cache.products.find(function(p) { return p.id === id; }) || null;
    },

    // ── Products — 쓰기 (async, 서버+캐시) ──
    saveProduct: function(product) {
        var self = this;
        var idx = self._cache.products.findIndex(function(p) { return p.id === product.id; });
        if (idx !== -1) {
            self._cache.products[idx] = product;
        } else {
            self._cache.products.push(product);
        }
        return fetch(STORAGE_API + '/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        }).then(function(r) { return r.json(); }).then(function(res) {
            return product;
        }).catch(function(err) {
            console.error('[Storage] saveProduct 실패:', err);
            throw err;
        });
    },

    saveProducts: function(products) {
        this._cache.products = products;
        var promises = products.map(function(p) {
            return fetch(STORAGE_API + '/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
        });
        return Promise.all(promises);
    },

    addProduct: function(product) {
        return this.saveProduct(product);
    },

    updateProduct: function(id, updates) {
        var product = this.getProduct(id);
        if (!product) return Promise.resolve(null);
        var updated = Object.assign({}, product, updates, { updatedAt: new Date().toISOString() });
        return this.saveProduct(updated);
    },

    deleteProduct: function(id) {
        this._cache.products = this._cache.products.filter(function(p) { return p.id !== id; });
        return fetch(STORAGE_API + '/products/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [id] })
        }).then(function(r) { return r.json(); });
    },

    deleteProducts: function(ids) {
        this._cache.products = this._cache.products.filter(function(p) { return !ids.includes(p.id); });
        return fetch(STORAGE_API + '/products/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        }).then(function(r) { return r.json(); });
    },

    // ════════════════════════════════════════
    // Presets: Shipping
    // ════════════════════════════════════════
    getShippingPresets: function() {
        var presets = this._cache.presets;
        return (presets && presets.length > 0) ? presets : this._defaultShippingPresets();
    },

    saveShippingPresets: function(presets) {
        this._cache.presets = presets;
        var promises = presets.map(function(p) {
            return fetch(STORAGE_API + '/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p)
            });
        });
        return Promise.all(promises);
    },

    savePreset: function(preset) {
        var idx = this._cache.presets.findIndex(function(p) { return p.id === preset.id; });
        if (idx !== -1) {
            this._cache.presets[idx] = preset;
        } else {
            this._cache.presets.push(preset);
        }
        return fetch(STORAGE_API + '/presets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(preset)
        }).then(function(r) { return r.json(); });
    },

    deletePreset: function(id) {
        this._cache.presets = this._cache.presets.filter(function(p) { return p.id !== id; });
        return fetch(STORAGE_API + '/presets/' + id, {
            method: 'DELETE'
        }).then(function(r) { return r.json(); });
    },

    _defaultShippingPresets: function() {
        return [{
            id: 'default',
            name: '기본 배송 설정',
            templateCode: '',
            isDefault: true,
            method: '택배, 소포, 등기',
            courierCode: 'CJGLS',
            feeType: '유료',
            fee: 3000,
            payMethod: '선결제',
            freeCondition: 0,
            qty: 1,
            section2Qty: '',
            section3Qty: '',
            section3Fee: '',
            addFee: '',
            returnFee: 3000,
            exchangeFee: 6000
        }];
    },

    // ════════════════════════════════════════
    // Presets: Addresses
    // ════════════════════════════════════════
    getAddresses: function() {
        var addrs = this._cache.addresses;
        return (addrs && addrs.length > 0) ? addrs : this._defaultAddresses();
    },

    saveAddresses: function(addresses) {
        this._cache.addresses = addresses;
        var promises = addresses.map(function(a) {
            return fetch(STORAGE_API + '/addresses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(a)
            });
        });
        return Promise.all(promises);
    },

    saveAddress: function(address) {
        var idx = this._cache.addresses.findIndex(function(a) { return a.id === address.id; });
        if (idx !== -1) {
            this._cache.addresses[idx] = address;
        } else {
            this._cache.addresses.push(address);
        }
        return fetch(STORAGE_API + '/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(address)
        }).then(function(r) { return r.json(); });
    },

    deleteAddress: function(id) {
        this._cache.addresses = this._cache.addresses.filter(function(a) { return a.id !== id; });
        return fetch(STORAGE_API + '/addresses/' + id, {
            method: 'DELETE'
        }).then(function(r) { return r.json(); });
    },

    _defaultAddresses: function() {
        return [{
            id: 'default',
            name: '기본 주소',
            address: '서울시 강서구 양천로67길 32, 102동 304호',
            isDefault: true,
            useForShipping: true,
            useForReturn: true
        }];
    },

    // ════════════════════════════════════════
    // Category Favorites
    // ════════════════════════════════════════
    getCategoryFavorites: function() {
        return this._cache.settings.cat_favorites || [];
    },

    saveCategoryFavorites: function(favs) {
        this._cache.settings.cat_favorites = favs;
        return fetch(STORAGE_API + '/settings/cat_favorites', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: favs })
        });
    },

    // ════════════════════════════════════════
    // Margin Presets
    // ════════════════════════════════════════
    getMarginPresets: function() {
        return this._cache.settings.margin_presets || this._defaultMarginPresets();
    },

    saveMarginPresets: function(presets) {
        this._cache.settings.margin_presets = presets;
        return fetch(STORAGE_API + '/settings/margin_presets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: presets })
        });
    },

    _defaultMarginPresets: function() {
        return [
            { id: 'margin_default', name: '기본 마진 (1,000원~2,000원)', type: '원', minTarget: 1000, maxTarget: 2000 },
            { id: 'margin_1', name: '안전화 목표 마진 (15%~20%)', type: '%', minTarget: 15, maxTarget: 20 }
        ];
    },

    // ════════════════════════════════════════
    // Default Values
    // ════════════════════════════════════════
    getDefaults: function() {
        return this._cache.settings.defaults || this._defaultValues();
    },

    saveDefaults: function(defaults) {
        this._cache.settings.defaults = defaults;
        return fetch(STORAGE_API + '/settings/defaults', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: defaults })
        });
    },

    _defaultValues: function() {
        return {
            productStatus: '신상품',
            origin: '0001',
            originName: '국내산',
            vat: '과세상품',
            minorPurchase: 'Y',
            asPhone: '',
            asGuide: ''
        };
    },

    // ════════════════════════════════════════
    // Images — 서버 업로드 기반
    // ════════════════════════════════════════
    uploadImage: function(file, productCode, type, index) {
        var formData = new FormData();
        var ext = file.name.split('.').pop().toLowerCase();
        var autoName;
        if (type === 'main') {
            autoName = productCode + '_main.' + ext;
        } else if (type === 'add') {
            autoName = productCode + '_add' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'detail') {
            autoName = productCode + '_detail' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'notice') {
            autoName = 'notice_' + Date.now() + '_' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'consent') {
            autoName = 'consent_' + Date.now() + '_' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else {
            autoName = productCode + '_img.' + ext;
        }
        // body 필드를 먼저 append (multer가 filename 시점에 사용)
        formData.append('autoName', autoName);
        // 파일은 마지막에 append
        formData.append('image', file);
        return fetch(STORAGE_API + '/images/upload', {
            method: 'POST',
            body: formData
        }).then(function(r) { return r.json(); }).then(function(res) {
            return {
                filename: res.filename,
                url: res.url,
                autoName: res.filename
            };
        });
    },

    deleteImage: function(filename) {
        return fetch(STORAGE_API + '/images/' + encodeURIComponent(filename), {
            method: 'DELETE'
        }).then(function(r) { return r.json(); });
    },

    uploadImageFromUrl: function(url, productCode, type, index) {
        var urlPath = '';
        try { urlPath = new URL(url).pathname; } catch(e) {}
        var ext = (urlPath.split('.').pop() || 'jpg').toLowerCase();
        if (['jpg','jpeg','png','gif','webp','bmp'].indexOf(ext) === -1) ext = 'jpg';
        var autoName;
        if (type === 'main') {
            autoName = productCode + '_main.' + ext;
        } else if (type === 'add') {
            autoName = productCode + '_add' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'detail') {
            autoName = productCode + '_detail' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'notice') {
            autoName = 'notice_' + Date.now() + '_' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else if (type === 'consent') {
            autoName = 'consent_' + Date.now() + '_' + String((index || 0) + 1).padStart(2, '0') + '.' + ext;
        } else {
            autoName = productCode + '_img.' + ext;
        }
        return fetch(STORAGE_API + '/images/upload-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url, autoName: autoName })
        }).then(function(r) {
            if (!r.ok) return r.json().then(function(e) { throw new Error(e.error); });
            return r.json();
        }).then(function(res) {
            return {
                filename: res.filename,
                url: res.url,
                autoName: res.filename
            };
        });
    },

    // 이미지 메타데이터 (메모리 관리 — 상품 data JSON에 포함)
    getProductImages: function(productId) {
        var product = this.getProduct(productId);
        if (product && product._images) return product._images;
        return { main: null, additional: [], detail: [] };
    },

    saveProductImages: function(productId, images) {
        var product = this.getProduct(productId);
        if (product) {
            product._images = images;
            return this.saveProduct(product);
        }
        return Promise.resolve();
    },

    deleteProductImages: function(productId) {
        // 이미지 메타 삭제 (실제 파일은 서버에서 별도 관리)
        var product = this.getProduct(productId);
        if (product) {
            product._images = { main: null, additional: [], detail: [] };
        }
        return Promise.resolve();
    },

    // ════════════════════════════════════════
    // Sequential counter (서버 기반)
    // ════════════════════════════════════════
    getTodaySequence: function() {
        // 동기 메서드 유지 — 캐시에서 반환 (정확하지 않을 수 있음)
        return 0;
    },

    incrementTodaySequence: function() {
        // async 버전 사용 권장 → generateProductCode에서 호출
        return fetch(STORAGE_API + '/sequence/next', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }).then(function(r) { return r.json(); }).then(function(res) {
            return res.seq;
        });
    },

    // ════════════════════════════════════════
    // Export Cart (서버 기반)
    // ════════════════════════════════════════
    getExportCart: function() {
        return this._cache.exportCart || [];
    },

    saveExportCart: function(cart) {
        this._cache.exportCart = cart;
        // 서버는 별도 동기화 (addToExportCart 등에서 처리)
    },

    addToExportCart: function(ids) {
        var self = this;
        var numAdded = 0;
        ids.forEach(function(id) {
            if (!self._cache.exportCart.includes(id)) {
                self._cache.exportCart.push(id);
                numAdded++;
            }
        });
        fetch(STORAGE_API + '/export-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        }).catch(function(err) { console.error('[Storage] addToExportCart 실패:', err); });
        return numAdded;
    },

    removeFromExportCart: function(ids) {
        this._cache.exportCart = this._cache.exportCart.filter(function(id) { return !ids.includes(id); });
        fetch(STORAGE_API + '/export-cart/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        }).catch(function(err) { console.error('[Storage] removeFromExportCart 실패:', err); });
    },

    clearExportCart: function() {
        this._cache.exportCart = [];
        fetch(STORAGE_API + '/export-cart', {
            method: 'DELETE'
        }).catch(function(err) { console.error('[Storage] clearExportCart 실패:', err); });
    },

    // ════════════════════════════════════════
    // Migration (localStorage → 서버 1회성)
    // ════════════════════════════════════════
    needsMigration: function() {
        return !!(localStorage.getItem('kng_mass_products'));
    },

    migrateToServer: function() {
        var data = {};
        try { data.products = JSON.parse(localStorage.getItem('kng_mass_products')) || []; } catch(e) { data.products = []; }
        try { data.presets = JSON.parse(localStorage.getItem('kng_mass_shipping_presets')); } catch(e) {}
        try { data.addresses = JSON.parse(localStorage.getItem('kng_mass_addresses')); } catch(e) {}
        try { data.settings = { defaults: JSON.parse(localStorage.getItem('kng_mass_defaults')), cat_favorites: JSON.parse(localStorage.getItem('kng_mass_cat_favorites')) }; } catch(e) {}
        try { data.exportCart = JSON.parse(localStorage.getItem('kng_mass_export_cart')); } catch(e) {}

        return fetch(STORAGE_API + '/migrate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).then(function(r) { return r.json(); }).then(function(result) {
            // 마이그레이션 성공 후 localStorage 정리
            var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('kng_mass_'); });
            keys.forEach(function(k) { localStorage.removeItem(k); });
            console.log('[Migration] 완료:', result);
            return result;
        });
    },

    // ════════════════════════════════════════
    // Footer Images (Notice / Consent)
    // ════════════════════════════════════════
    getNoticeImages: function() {
        return this._cache.settings.notice_images || [];
    },
    saveNoticeImages: function(images) {
        this._cache.settings.notice_images = images;
        localStorage.setItem('kng_mass_notice_images', JSON.stringify(images));
        return fetch(STORAGE_API + '/settings/notice_images', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: images })
        });
    },

    getConsentImages: function() {
        return this._cache.settings.consent_images || [];
    },
    saveConsentImages: function(images) {
        this._cache.settings.consent_images = images;
        localStorage.setItem('kng_mass_consent_images', JSON.stringify(images));
        return fetch(STORAGE_API + '/settings/consent_images', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: images })
        });
    }
};

window.Storage = Storage;
