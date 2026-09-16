/**
 * 물류 단가표 (Unit Prices) 프론트엔드 로직
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

let _authReady = null;
function waitForAuth(timeout = 8000) {
    if (_authReady) return _authReady;
    _authReady = new Promise((res) => {
        const s = Date.now();
        (function poll() {
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    window.parent.getAuthToken().then(t => {
                        if (t) { res(t); }
                        else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                        else { _authReady = Promise.resolve(null); res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = Promise.resolve(null); res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = Promise.resolve(null); res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = Promise.resolve(null); res(null); }
            }
        })();
    });
    return _authReady;
}

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) {}
    if (!token) {
        try { token = await waitForAuth(); } catch(e) {}
    }
    
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    options.headers['Content-Type'] = 'application/json';
    
    let res;
    try {
        res = await fetch(url, options);
    } catch (netErr) {
        throw new Error(`서버 통신 실패: ${netErr.message}`);
    }
    if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return res.json();
}

const $ = id => document.getElementById(id);

const app = {
    priceList: [],
    filteredList: [],
    itemSpecsMap: null,
    selectedCategory: '',
    searchQuery: '',
    unitPriceModalInstance: null,
    historyModalInstance: null,

    init: async function() {
        this.unitPriceModalInstance = new bootstrap.Modal($('unitPriceModal'));
        this.historyModalInstance = new bootstrap.Modal($('historyModal'));

        this.bindSearchEvents();
        await this.loadItemSpecsMap();
        await this.loadPrices();
        this.setupModalAutocomplete();
    },

    loadItemSpecsMap: async function() {
        try {
            this.itemSpecsMap = await authFetch(`${API_BASE}/items/specs-map`);
        } catch(e) {
            console.warn('Failed to load itemSpecsMap:', e);
            this.itemSpecsMap = {};
        }
    },

    loadPrices: async function() {
        try {
            const data = await authFetch(`${API_BASE}/unit-prices`);
            this.priceList = data || [];
            this.renderCategoryTabs();
            this.applyFiltersAndRender();
        } catch (err) {
            console.error(err);
            $('priceTableBody').innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-4 text-danger">
                        <i class='bx bx-error-circle me-1'></i> 단가 데이터를 불러오지 못했습니다: ${err.message}
                    </td>
                </tr>
            `;
        }
    },

    bindSearchEvents: function() {
        const searchInp = $('searchInput');
        let timer = null;
        searchInp.addEventListener('input', (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.applyFiltersAndRender();
            }, 200);
        });
    },

    renderCategoryTabs: function() {
        const container = $('categoryTabGroup');
        const categories = new Set();
        this.priceList.forEach(p => {
            if (p.category && p.category.trim()) categories.add(p.category.trim());
        });

        let html = `<button type="button" class="erp-tab-btn ${this.selectedCategory === '' ? 'active' : ''}" data-category="" onclick="app.setCategoryFilter('')">전체</button>`;
        categories.forEach(cat => {
            html += `<button type="button" class="erp-tab-btn ${this.selectedCategory === cat ? 'active' : ''}" data-category="${cat}" onclick="app.setCategoryFilter('${cat}')">${cat}</button>`;
        });
        container.innerHTML = html;
    },

    setCategoryFilter: function(cat) {
        this.selectedCategory = cat;
        const btns = $('categoryTabGroup').querySelectorAll('.erp-tab-btn');
        btns.forEach(b => {
            b.classList.toggle('active', b.getAttribute('data-category') === cat);
        });
        this.applyFiltersAndRender();
    },

    applyFiltersAndRender: function() {
        const marginMode = $('marginFilter') ? $('marginFilter').value : 'all';

        this.filteredList = this.priceList.filter(item => {
            // 카테고리 필터
            if (this.selectedCategory && item.category !== this.selectedCategory) return false;

            // 검색어 필터
            if (this.searchQuery) {
                const q = this.searchQuery;
                const match = (item.item || '').toLowerCase().includes(q) ||
                              (item.spec || '').toLowerCase().includes(q) ||
                              (item.category || '').toLowerCase().includes(q) ||
                              (item.default_supplier || '').toLowerCase().includes(q) ||
                              (item.default_destination || '').toLowerCase().includes(q) ||
                              (item.note || '').toLowerCase().includes(q);
                if (!match) return false;
            }

            // 마진 필터
            if (marginMode !== 'all') {
                const buy = item.buy_price || 0;
                const sell = item.sell_price || 0;
                const marginRate = sell > 0 ? ((sell - buy) / sell) * 100 : 0;
                if (marginMode === 'high' && marginRate < 20) return false;
                if (marginMode === 'mid' && (marginRate < 10 || marginRate >= 20)) return false;
                if (marginMode === 'low' && (marginRate < 0 || marginRate >= 10)) return false;
                if (marginMode === 'loss' && marginRate >= 0) return false;
            }

            return true;
        });

        this.render();
    },

    render: function() {
        // 상단 통계
        $('itemCountBadge').innerText = `관리 ${this.priceList.length} 품목`;
        $('filterResultCount').innerText = `조회결과 ${this.filteredList.length}건`;

        let totalMargin = 0;
        let validSellCount = 0;
        this.priceList.forEach(p => {
            const b = p.buy_price || 0;
            const s = p.sell_price || 0;
            if (s > 0) {
                totalMargin += ((s - b) / s) * 100;
                validSellCount++;
            }
        });
        const avgMargin = validSellCount > 0 ? (totalMargin / validSellCount).toFixed(1) : 0;
        $('avgMarginBadge').innerText = `평균 마진율: ${avgMargin}%`;

        const tbody = $('priceTableBody');
        if (this.filteredList.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="15" class="text-center py-5 text-muted">
                        <i class='bx bx-info-circle fs-4 mb-2'></i><br>
                        등록되거나 조회된 단가 데이터가 없습니다.
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        this.filteredList.forEach((r, idx) => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const marginAmt = sell - buy;
            const marginRate = sell > 0 ? (marginAmt / sell) * 100 : 0;

            let marginBadgeCls = 'margin-mid';
            if (marginRate >= 20) marginBadgeCls = 'margin-high';
            else if (marginRate < 0) marginBadgeCls = 'margin-loss';
            else if (marginRate < 10) marginBadgeCls = 'margin-low';

            let histCount = 0;
            try { histCount = JSON.parse(r.history || '[]').length; } catch(e){}

            const updatedDate = r.updated_at ? r.updated_at.substring(0, 10) : '-';

            html += `
                <tr data-id="${r.id}">
                    <td class="text-center text-muted fw-semibold">${idx + 1}</td>
                    <td><span class="badge bg-light text-secondary border">${r.category || '-'}</span></td>
                    <td class="fw-bold text-dark">${r.item}</td>
                    <td>${r.spec || '<span class="text-muted">-</span>'}</td>
                    <td class="text-center text-muted">${r.unit || '-'}</td>
                    <td class="text-end fw-bold text-primary">${buy > 0 ? buy.toLocaleString() + '원' : '-'}</td>
                    <td class="text-end fw-bold text-danger">${sell > 0 ? sell.toLocaleString() + '원' : '-'}</td>
                    <td class="text-end ${marginAmt < 0 ? 'text-danger' : 'text-success'} fw-semibold">
                        ${sell > 0 ? (marginAmt >= 0 ? '+' : '') + marginAmt.toLocaleString() + '원' : '-'}
                    </td>
                    <td class="text-center">
                        ${sell > 0 ? `<span class="margin-badge ${marginBadgeCls}">${marginRate.toFixed(1)}%</span>` : '-'}
                    </td>
                    <td class="text-truncate" style="max-width: 140px;" title="${r.default_supplier || ''}">${r.default_supplier || '-'}</td>
                    <td class="text-truncate" style="max-width: 140px;" title="${r.default_destination || ''}">${r.default_destination || '-'}</td>
                    <td class="text-center">
                        <button type="button" class="btn-hist" onclick="app.openHistoryModal(${r.id})" title="단가 변경 이력 확인">
                            <i class='bx bx-history'></i> 이력 (${histCount})
                        </button>
                    </td>
                    <td class="text-center text-muted" style="font-size:11px;">${updatedDate}</td>
                    <td class="text-truncate text-muted" style="max-width: 180px;" title="${r.note || ''}">${r.note || '-'}</td>
                    <td class="text-center">
                        <button type="button" class="btn-table-action" onclick="app.openEditModal(${r.id})" title="수정">
                            <i class='bx bx-edit text-primary'></i>
                        </button>
                        <button type="button" class="btn-table-action btn-del" onclick="app.deletePrice(${r.id})" title="삭제">
                            <i class='bx bx-trash text-danger'></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    },

    openCreateModal: function() {
        $('priceForm').reset();
        $('editPriceId').value = '';
        $('modalTitle').innerHTML = "<i class='bx bx-plus text-primary'></i> 신규 기준 단가 등록";
        $('inpEffectiveDate').value = new Date().toISOString().split('T')[0];
        $('modalMarginBadge').innerText = '0.0%';
        $('modalMarginBadge').className = 'badge bg-secondary fs-6 mt-1';
        this.unitPriceModalInstance.show();
        setTimeout(() => $('inpItem').focus(), 250);
    },

    openEditModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('editPriceId').value = item.id;
        $('modalTitle').innerHTML = "<i class='bx bx-edit text-warning'></i> 기준 단가 수정";
        $('inpItem').value = item.item || '';
        $('inpSpec').value = item.spec || '';
        $('inpCategory').value = item.category || '';
        $('inpUnit').value = item.unit || '';
        $('inpBuyPrice').value = item.buy_price || '';
        $('inpSellPrice').value = item.sell_price || '';
        $('inpSupplier').value = item.default_supplier || '';
        $('inpDestination').value = item.default_destination || '';
        $('inpNote').value = item.note || '';
        $('inpEffectiveDate').value = new Date().toISOString().split('T')[0];

        this.calcModalMargin();
        this.unitPriceModalInstance.show();
        setTimeout(() => $('inpBuyPrice').focus(), 250);
    },

    calcModalMargin: function() {
        const buy = parseFloat($('inpBuyPrice').value) || 0;
        const sell = parseFloat($('inpSellPrice').value) || 0;
        const badge = $('modalMarginBadge');
        if (sell > 0) {
            const margin = ((sell - buy) / sell) * 100;
            badge.innerText = `${margin.toFixed(1)}%`;
            if (margin >= 20) badge.className = 'badge bg-success fs-6 mt-1';
            else if (margin < 0) badge.className = 'badge bg-danger fs-6 mt-1';
            else badge.className = 'badge bg-primary fs-6 mt-1';
        } else {
            badge.innerText = '0.0%';
            badge.className = 'badge bg-secondary fs-6 mt-1';
        }
    },

    handleSavePrice: async function(e) {
        e.preventDefault();
        const id = $('editPriceId').value;
        const payload = {
            item: $('inpItem').value.trim(),
            spec: $('inpSpec').value.trim(),
            category: $('inpCategory').value.trim(),
            unit: $('inpUnit').value.trim(),
            buy_price: parseFloat($('inpBuyPrice').value) || 0,
            sell_price: parseFloat($('inpSellPrice').value) || 0,
            default_supplier: $('inpSupplier').value.trim(),
            default_destination: $('inpDestination').value.trim(),
            note: $('inpNote').value.trim(),
            effective_date: $('inpEffectiveDate').value
        };

        if (!payload.item) return alert('품목명을 입력하세요.');

        try {
            if (id) {
                await authFetch(`${API_BASE}/unit-prices/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify(payload)
                });
                alert('단가 정보가 수정되었습니다.');
            } else {
                await authFetch(`${API_BASE}/unit-prices`, {
                    method: 'POST',
                    body: JSON.stringify(payload)
                });
                alert('신규 단가가 등록되었습니다.');
            }
            this.unitPriceModalInstance.hide();
            await this.loadPrices();
        } catch (err) {
            alert('저장 실패: ' + err.message);
        }
    },

    deletePrice: async function(id) {
        const item = this.priceList.find(p => p.id === id);
        const name = item ? `[${item.item} ${item.spec}]` : '선택한 항목';
        if (!confirm(`${name}의 기준 단가 정보를 삭제하시겠습니까?\n(삭제 시 시계열 이력도 함께 삭제됩니다)`)) return;

        try {
            await authFetch(`${API_BASE}/unit-prices/${id}`, { method: 'DELETE' });
            alert('삭제되었습니다.');
            await this.loadPrices();
        } catch (err) {
            alert('삭제 실패: ' + err.message);
        }
    },

    openHistoryModal: function(id) {
        const item = this.priceList.find(p => p.id === id);
        if (!item) return;

        $('histCategoryBadge').innerText = item.category || '기타';
        $('histItemTitle').innerText = item.item;
        $('histSpecTitle').innerText = item.spec ? `(${item.spec})` : '';
        $('histCurrentBuy').innerText = `매입 ${(item.buy_price || 0).toLocaleString()}원`;
        $('histCurrentSell').innerText = `매출 ${(item.sell_price || 0).toLocaleString()}원`;

        let list = [];
        try { list = JSON.parse(item.history || '[]'); } catch(e){ list = []; }

        const tbody = $('histTableBody');
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">등록된 단가 변동 이력이 없습니다.</td></tr>`;
        } else {
            let html = '';
            list.forEach(h => {
                const buy = h.buy_price || 0;
                const prevBuy = h.prev_buy_price || 0;
                const buyDiff = prevBuy > 0 ? (buy - prevBuy) : 0;
                let buyDiffHtml = '';
                if (buyDiff > 0) buyDiffHtml = ` <span class="diff-up">(+${buyDiff.toLocaleString()}원)</span>`;
                else if (buyDiff < 0) buyDiffHtml = ` <span class="diff-down">(${buyDiff.toLocaleString()}원)</span>`;

                const sell = h.sell_price || 0;
                const prevSell = h.prev_sell_price || 0;
                const sellDiff = prevSell > 0 ? (sell - prevSell) : 0;
                let sellDiffHtml = '';
                if (sellDiff > 0) sellDiffHtml = ` <span class="diff-up">(+${sellDiff.toLocaleString()}원)</span>`;
                else if (sellDiff < 0) sellDiffHtml = ` <span class="diff-down">(${sellDiff.toLocaleString()}원)</span>`;

                let srcCls = 'source-manual';
                let srcName = '수동 등록';
                if (h.source === 'direct') { srcCls = 'source-direct'; srcName = '직출고'; }
                else if (h.source === 'inbound') { srcCls = 'source-inbound'; srcName = '입고'; }
                else if (h.source === 'outbound') { srcCls = 'source-outbound'; srcName = '출고'; }

                html += `
                    <tr>
                        <td class="text-muted">${h.date || '-'}</td>
                        <td class="text-center"><span class="source-badge ${srcCls}">${srcName}</span></td>
                        <td class="text-end fw-bold text-primary">${buy.toLocaleString()}원${buyDiffHtml}</td>
                        <td class="text-end fw-bold text-danger">${sell.toLocaleString()}원${sellDiffHtml}</td>
                        <td class="text-truncate" style="max-width: 140px;" title="${h.partner || ''}">${h.partner || '-'}</td>
                        <td class="text-muted text-truncate" style="max-width: 180px;" title="${h.note || ''}">${h.note || '-'}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        this.historyModalInstance.show();
    },

    populateFromHistory: async function() {
        if (!confirm('기존 입출고 및 직출고 장부의 거래 내역을 분석하여 품목별 최근 단가를 단가표로 자동 반영하시겠습니까?\n\n(이미 등록된 단가가 있을 경우 최근 단가로 갱신되고 변경 이력이 추가됩니다)')) return;

        try {
            const res = await authFetch(`${API_BASE}/unit-prices/populate-from-history`, { method: 'POST' });
            alert(res.message || '장부 단가 반영이 완료되었습니다.');
            await this.loadPrices();
            await this.loadItemSpecsMap();
        } catch (err) {
            alert('반영 실패: ' + err.message);
        }
    },

    exportExcel: function() {
        if (this.filteredList.length === 0) return alert('내보낼 데이터가 없습니다.');

        let csv = '\uFEFF'; // UTF-8 BOM
        csv += 'No,분류,품목명,규격,단위,기준매입단가,기준매출단가,마진액,마진율,기본매입처,기본매출처,최종변경일,비고\n';

        this.filteredList.forEach((r, idx) => {
            const buy = r.buy_price || 0;
            const sell = r.sell_price || 0;
            const margin = sell - buy;
            const rate = sell > 0 ? ((margin / sell) * 100).toFixed(1) + '%' : '0%';
            const updated = r.updated_at ? r.updated_at.substring(0, 10) : '';

            const row = [
                idx + 1,
                `"${(r.category || '').replace(/"/g, '""')}"`,
                `"${(r.item || '').replace(/"/g, '""')}"`,
                `"${(r.spec || '').replace(/"/g, '""')}"`,
                `"${(r.unit || '').replace(/"/g, '""')}"`,
                buy,
                sell,
                margin,
                `"${rate}"`,
                `"${(r.default_supplier || '').replace(/"/g, '""')}"`,
                `"${(r.default_destination || '').replace(/"/g, '""')}"`,
                `"${updated}"`,
                `"${(r.note || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `물류단가표_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    },

    setupModalAutocomplete: function() {
        const itemInp = $('inpItem');
        const specInp = $('inpSpec');
        const itemSug = $('itemSuggestions');
        const specSug = $('specSuggestions');

        // 품목명 입력 시 자동완성
        itemInp.addEventListener('input', () => {
            const val = itemInp.value.trim().toLowerCase();
            if (!val || !this.itemSpecsMap) {
                itemSug.style.display = 'none';
                return;
            }
            const keys = Object.keys(this.itemSpecsMap);
            const matches = keys.filter(k => k.toLowerCase().includes(val));
            if (matches.length === 0) {
                itemSug.style.display = 'none';
                return;
            }

            itemSug.innerHTML = matches.slice(0, 10).map(m => `
                <div class="autocomplete-suggestion">${m}</div>
            `).join('');
            itemSug.style.display = 'block';

            itemSug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    itemInp.value = div.innerText.trim();
                    itemSug.style.display = 'none';
                    this.onItemChangedInModal(itemInp.value);
                });
            });
        });

        itemInp.addEventListener('blur', () => {
            setTimeout(() => { itemSug.style.display = 'none'; }, 180);
        });

        // 규격 추천 드롭다운
        const showSpecSug = () => {
            const currentItem = itemInp.value.trim();
            if (!currentItem || !this.itemSpecsMap) {
                specSug.style.display = 'none';
                return;
            }
            const info = this.itemSpecsMap[currentItem];
            const specs = info && info.specs ? info.specs : [];
            if (specs.length === 0) {
                specSug.style.display = 'none';
                return;
            }

            const val = specInp.value.trim().toLowerCase();
            const filtered = val ? specs.filter(s => s.toLowerCase().includes(val)) : specs;
            if (filtered.length === 0) {
                specSug.style.display = 'none';
                return;
            }

            specSug.innerHTML = filtered.map(s => `
                <div class="autocomplete-suggestion d-flex justify-content-between">
                    <span>${s}</span>
                </div>
            `).join('');
            specSug.style.display = 'block';

            specSug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    specInp.value = div.innerText.trim();
                    specSug.style.display = 'none';
                });
            });
        };

        specInp.addEventListener('focus', showSpecSug);
        specInp.addEventListener('input', showSpecSug);
        specInp.addEventListener('blur', () => {
            setTimeout(() => { specSug.style.display = 'none'; }, 180);
        });
    },

    onItemChangedInModal: function(itemName) {
        if (!this.itemSpecsMap || !this.itemSpecsMap[itemName]) return;
        const info = this.itemSpecsMap[itemName];

        if (!$('inpCategory').value && info.defaultCategory) {
            $('inpCategory').value = info.defaultCategory;
        }
        if (!$('inpUnit').value && info.defaultUnit) {
            $('inpUnit').value = info.defaultUnit;
        }

        if (info.specs && info.specs.length === 1 && !$('inpSpec').value) {
            $('inpSpec').value = info.specs[0];
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
