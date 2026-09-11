/**
 * 실시간 재고 현황 프론트엔드 로직 (ERP 고밀도 그리드 엔진 연동)
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
                        else { _authReady = null; res(null); }
                    }).catch(() => {
                        if (Date.now() - s < timeout) setTimeout(poll, 400);
                        else { _authReady = null; res(null); }
                    });
                } else if (Date.now() - s < timeout) { setTimeout(poll, 400); }
                else { _authReady = null; res(null); }
            } catch (e) {
                if (Date.now() - s < timeout) setTimeout(poll, 400);
                else { _authReady = null; res(null); }
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
    
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return res.json();
}

const $ = id => document.getElementById(id);
let inventoryData = [];

const app = {
    init: async function() {
        this.bindEvents();
        await this.loadInventory();
    },

    bindEvents: function() {
        const searchInput = $('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', this.handleSearch.bind(this));
        }
    },

    loadInventory: async function() {
        try {
            inventoryData = await authFetch(`${API_BASE}/inventory`);
            this.renderTable(inventoryData);
        } catch (e) {
            console.error(e);
            $('inventoryTbody').innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">데이터를 불러오는 중 오류가 발생했습니다.<br>${e.message}</td></tr>`;
        }
    },

    handleSearch: function(e) {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            this.renderTable(inventoryData);
            return;
        }

        const filtered = inventoryData.filter(row => {
            return (row.item && row.item.toLowerCase().includes(query)) || 
                   (row.spec && row.spec.toLowerCase().includes(query));
        });
        
        this.renderTable(filtered);
    },

    toggleLotRow: function(index) {
        const subRow = document.getElementById(`lotSubRow_${index}`);
        const icon = document.getElementById(`accIcon_${index}`);
        const mainRow = document.getElementById(`mainRow_${index}`);

        if (!subRow) return;

        const isHidden = subRow.classList.contains('d-none');
        if (isHidden) {
            subRow.classList.remove('d-none');
            if (icon) icon.classList.add('rotate-90');
            if (mainRow) mainRow.classList.add('row-expanded');
        } else {
            subRow.classList.add('d-none');
            if (icon) icon.classList.remove('rotate-90');
            if (mainRow) mainRow.classList.remove('row-expanded');
        }
    },

    renderTable: function(data) {
        const tbody = $('inventoryTbody');
        if (!tbody) return;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">재고 내역이 없습니다.</td></tr>`;
            if ($('skuCountBadge')) $('skuCountBadge').innerText = `관리 0 SKU`;
            if ($('totalQtyBadge')) $('totalQtyBadge').innerText = `총 재고: 0개`;
            if ($('inventoryTfoot')) $('inventoryTfoot').classList.add('d-none');
            return;
        }

        // 통계 집계
        const totalSku = data.length;
        const totalQty = data.reduce((acc, cur) => acc + (Number(cur.total_qty) || 0), 0);

        if ($('skuCountBadge')) $('skuCountBadge').innerText = `관리 ${totalSku.toLocaleString()} SKU`;
        if ($('totalQtyBadge')) $('totalQtyBadge').innerText = `총 재고: ${totalQty.toLocaleString()}개`;

        if ($('inventoryTfoot')) {
            $('inventoryTfoot').classList.remove('d-none');
            if ($('footSkuSummary')) $('footSkuSummary').innerText = `총 ${totalSku.toLocaleString()}개 품목`;
            if ($('footQtySummary')) $('footQtySummary').innerText = totalQty.toLocaleString();
        }

        const escapeAttr = (str) => {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        tbody.innerHTML = data.map((row, index) => {
            // Lot 상세 행 구성
            let lotRows = '';
            if (row.lots && row.lots.length > 0) {
                lotRows = row.lots.map(lot => `
                    <tr>
                        <td class="text-center text-muted">${lot.date || '-'}</td>
                        <td class="text-center">${lot.location_name || '-'}</td>
                        <td class="ps-2">${lot.supplier || '-'}</td>
                        <td class="text-end pe-2">${Number(lot.unit_price || 0).toLocaleString()} ₩</td>
                        <td class="text-end pe-2 fw-bold text-primary">${Number(lot.qty_remaining || 0).toLocaleString()}</td>
                        <td class="ps-2 text-muted">${escapeAttr(lot.note || '')}</td>
                    </tr>
                `).join('');
            }

            return `
                <!-- 메인 품목 행 (26px ERP 플랫 셀) -->
                <tr class="inventory-row" id="mainRow_${index}" onclick="app.toggleLotRow(${index})" title="클릭하여 Lot별 상세 입고 내역을 확인합니다">
                    <td class="text-center"><i class='bx bx-chevron-right accordion-icon' id="accIcon_${index}"></i></td>
                    <td class="row-index">${index + 1}</td>
                    <td class="ps-2 fw-bold text-dark text-truncate" title="${escapeAttr(row.item)}">${row.item}</td>
                    <td class="ps-2 text-secondary text-truncate" title="${escapeAttr(row.spec || '-')}">${row.spec || '-'}</td>
                    <td class="text-center text-secondary">${row.unit || '-'}</td>
                    <td class="text-end pe-3 fw-bold text-primary">${Number(row.total_qty || 0).toLocaleString()}</td>
                </tr>
                <!-- 상세 Lot 아코디언 행 -->
                <tr class="accordion-sub-row d-none" id="lotSubRow_${index}">
                    <td colspan="6" class="p-0 border-0">
                        <div class="lot-container-box">
                            <div class="d-flex align-items-center justify-content-between mb-1">
                                <div class="fw-bold text-secondary" style="font-size: 11.5px;">
                                    <i class='bx bx-history text-primary'></i> 입고일자별 잔여 내역 (Lot)
                                </div>
                                <div class="small text-muted" style="font-size: 11px;">
                                    ${row.lots ? row.lots.length : 0}개 Lot 보유
                                </div>
                            </div>
                            <table class="lot-sub-table shadow-sm">
                                <thead>
                                    <tr>
                                        <th style="width: 90px;">입고일자</th>
                                        <th style="width: 120px;">보관 위치</th>
                                        <th style="width: 130px;">매입처</th>
                                        <th style="width: 100px;" class="text-end">매입단가</th>
                                        <th style="width: 90px;" class="text-end">잔여수량</th>
                                        <th class="text-start ps-2">비고</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${lotRows || '<tr><td colspan="6" class="text-center py-2 text-muted">등록된 Lot 상세 정보가 없습니다.</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // ERP 그리드 리사이저 동기화
        if (window.ErpGridResizer) {
            window.ErpGridResizer.init('inventoryTable', { storageKey: 'kng_inventory_grid_widths' });
        }
    }
};

window.app = app;

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
