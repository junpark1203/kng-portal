/**
 * 실시간 재고 현황 프론트엔드 로직
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/logistics'
    : 'https://kng.junparks.com/api/logistics';

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch(e) { console.warn("Failed to get auth token from parent", e); }
    
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
        $('searchInput').addEventListener('input', this.handleSearch.bind(this));
    },

    loadInventory: async function() {
        try {
            inventoryData = await authFetch(`${API_BASE}/inventory`);
            this.renderTable(inventoryData);
        } catch (e) {
            console.error(e);
            $('inventoryTbody').innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">데이터를 불러오는 중 오류가 발생했습니다.<br>${e.message}</td></tr>`;
        }
    },

    handleSearch: function(e) {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
            this.renderTable(inventoryData);
            return;
        }

        const filtered = inventoryData.filter(row => {
            return row.item.toLowerCase().includes(query) || 
                   row.spec.toLowerCase().includes(query);
        });
        
        this.renderTable(filtered);
    },

    renderTable: function(data) {
        const tbody = $('inventoryTbody');
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">재고 내역이 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map((row, index) => {
            const accordionId = `collapseLot_${index}`;
            
            // Lot 내역 테이블 생성
            let lotRows = '';
            if (row.lots && row.lots.length > 0) {
                lotRows = row.lots.map(lot => `
                    <tr>
                        <td>${lot.date}</td>
                        <td>${lot.location_name || '-'}</td>
                        <td>${lot.supplier}</td>
                        <td class="text-end">${lot.unit_price.toLocaleString()} ₩</td>
                        <td class="fw-bold text-primary">${lot.qty_remaining}</td>
                    </tr>
                `).join('');
            }

            return `
                <!-- 메인 품목 행 -->
                <tr data-bs-toggle="collapse" data-bs-target="#${accordionId}" style="cursor: pointer;">
                    <td class="text-center text-muted"><i class='bx bx-chevron-down'></i></td>
                    <td class="fw-bold">${row.item}</td>
                    <td>${row.spec}</td>
                    <td>${row.unit}</td>
                    <td class="text-end pe-4"><span class="badge bg-primary badge-qty">${row.total_qty}</span></td>
                </tr>
                <!-- 상세 Lot 아코디언 -->
                <tr class="collapse" id="${accordionId}">
                    <td colspan="5" class="p-0 border-0">
                        <div class="bg-light p-3 border-bottom shadow-inner">
                            <h6 class="mb-2 text-muted fw-bold" style="font-size: 0.85rem;"><i class='bx bx-history'></i> 입고일자별 잔여 내역 (Lot)</h6>
                            <div class="table-responsive">
                                <table class="table table-sm table-bordered bg-white lot-detail-table mb-0">
                                    <thead>
                                        <tr>
                                            <th>입고일자</th>
                                            <th>재고 위치</th>
                                            <th>매입처</th>
                                            <th>매입단가</th>
                                            <th>잔여 수량</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${lotRows}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
