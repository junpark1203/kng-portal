/**
 * sell_it API Client Module
 * localStorage를 대체하여 백엔드 API와 통신합니다.
 */
(function() {
    'use strict';

    const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3000/api'
        : 'https://shopee-api.junparks.com/api';

    async function request(path, options = {}) {
        const url = `${API_BASE}${path}`;
        const defaultHeaders = { 'Content-Type': 'application/json' };
        const config = {
            cache: 'no-store',
            ...options,
            headers: { ...defaultHeaders, ...options.headers }
        };

        try {
            const res = await fetch(url, config);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: res.statusText }));
                throw new Error(errData.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            console.error(`[API] ${options.method || 'GET'} ${path} failed:`, err.message);
            throw err;
        }
    }

    window.api = {
        // ==========================================
        // Products
        // ==========================================
        async getProducts() {
            return request(`/products?_t=${Date.now()}`);
        },

        async getProduct(id) {
            return request(`/products/${id}`);
        },

        async createProduct(data) {
            return request('/products', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async updateProduct(id, data) {
            return request(`/products/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async deleteProduct(id) {
            return request(`/products/${id}`, { method: 'DELETE' });
        },

        async deleteProducts(ids) {
            return request('/products/delete', {
                method: 'POST',
                body: JSON.stringify({ ids })
            });
        },

        // ==========================================
        // Market Exports
        // ==========================================
        async getMarketExports(marketCode) {
            return request(`/market-exports?market=${marketCode}&_t=${Date.now()}`);
        },

        async getAllMarketExports() {
            return request(`/market-exports/all?_t=${Date.now()}`);
        },

        async exportToMarket(productIds, marketCode) {
            return request('/market-exports', {
                method: 'POST',
                body: JSON.stringify({ productIds, marketCode })
            });
        },

        async cancelMarketExport(id) {
            return request(`/market-exports/${id}`, { method: 'DELETE' });
        },

        // ==========================================
        // Presets (수수료)
        // ==========================================
        async getPresets() {
            return request(`/presets?_t=${Date.now()}`);
        },

        async createPreset(data) {
            return request('/presets', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async updatePreset(id, data) {
            return request(`/presets/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async deletePreset(id) {
            return request(`/presets/${id}`, { method: 'DELETE' });
        },

        // ==========================================
        // Promotion Presets
        // ==========================================
        async getPromotionPresets() {
            return request('/promotion-presets');
        },

        async createPromotionPreset(data) {
            return request('/promotion-presets', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async updatePromotionPreset(id, data) {
            return request(`/promotion-presets/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async deletePromotionPreset(id) {
            return request(`/promotion-presets/${id}`, { method: 'DELETE' });
        },

        // ==========================================
        // Shipping Presets
        // ==========================================
        async getShippingPresets() {
            return request('/shipping-presets');
        },

        async createShippingPreset(data) {
            return request('/shipping-presets', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async updateShippingPreset(id, data) {
            return request(`/shipping-presets/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async deleteShippingPreset(id) {
            return request(`/shipping-presets/${id}`, { method: 'DELETE' });
        },

        // ==========================================
        // Market Analysis
        // ==========================================
        async getMarketAnalysis(market) {
            const query = market ? `?market=${market}&_t=${Date.now()}` : `?_t=${Date.now()}`;
            return request(`/market-analysis${query}`);
        },

        async getMarketAnalysisById(id) {
            return request(`/market-analysis/${id}?_t=${Date.now()}`);
        },

        async createMarketAnalysis(data) {
            return request('/market-analysis', {
                method: 'POST',
                body: JSON.stringify(data)
            });
        },

        async updateMarketAnalysis(id, data) {
            return request(`/market-analysis/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
        },

        async deleteMarketAnalysis(id) {
            return request(`/market-analysis/${id}`, { method: 'DELETE' });
        },

        async uploadMarketAnalysisImage(file) {
            const formData = new FormData();
            formData.append('image', file);
            const url = `${API_BASE}/market-analysis/upload-image`;
            const res = await fetch(url, { method: 'POST', body: formData });
            if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
            return res.json();
        },

        async uploadMarketAnalysisImageUrl(imageUrl) {
            return request('/market-analysis/upload-image-url', {
                method: 'POST',
                body: JSON.stringify({ url: imageUrl })
            });
        },

        // ==========================================
        // Health Check
        // ==========================================
        async health() {
            return request('/health');
        }
    };

    console.log('[API] Client initialized. Base URL:', API_BASE);
})();
