/**
 * 입출고 관리 프론트엔드 로직
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
let locations = [];
let availableLots = []; // 출고 시 선택된 품목+규격의 잔여 Lot 목록

const app = {
    init: async function() {
        this.bindEvents();
        await this.loadLocations();
        this.initTodayDates();
        this.setupInboundAutocomplete();
        this.setupOutboundAutocomplete();
    },

    bindEvents: function() {
        $('inboundForm').addEventListener('submit', this.handleInboundSubmit.bind(this));
        $('outboundForm').addEventListener('submit', this.handleOutboundSubmit.bind(this));
        
        $('out_spec').addEventListener('change', this.handleOutboundSpecChange.bind(this));
        $('out_qty').addEventListener('input', this.handleOutboundQtyChange.bind(this));
        
        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.id !== 'in_item') $('in_item_suggestions').style.display = 'none';
            if (e.target.id !== 'out_item') $('out_item_suggestions').style.display = 'none';
        });
    },

    initTodayDates: function() {
        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
        $('in_date').value = today;
        $('out_date').value = today;
    },

    // ----------------------------------------
    // Locations (위치 관리)
    // ----------------------------------------
    loadLocations: async function() {
        try {
            locations = await authFetch(`${API_BASE}/locations`);
            const sel = $('in_location');
            sel.innerHTML = '<option value="">선택하세요</option>';
            locations.forEach(loc => {
                sel.innerHTML += `<option value="${loc.id}">${loc.name}</option>`;
            });
            this.renderLocationsModal();
        } catch (e) {
            console.error(e);
        }
    },

    renderLocationsModal: function() {
        const ul = $('locationList');
        ul.innerHTML = locations.map(loc => `
            <li>
                <span><i class='bx bx-map-pin text-muted'></i> ${loc.name}</span>
            </li>
        `).join('');
    },

    openLocationsModal: function() {
        new bootstrap.Modal($('locationsModal')).show();
    },

    addLocation: async function() {
        const input = $('newLocationInput');
        const name = input.value.trim();
        if (!name) return alert('이름을 입력하세요');
        try {
            await authFetch(`${API_BASE}/locations`, { method: 'POST', body: JSON.stringify({ name }) });
            input.value = '';
            await this.loadLocations();
        } catch (e) {
            alert('오류: ' + e.message);
        }
    },

    // ----------------------------------------
    // Inbound (입고)
    // ----------------------------------------
    addInboundItemRow: function() {
        const container = $('inboundItemsContainer');
        const rowId = 'in_row_' + Date.now();
        const rowHtml = `
            <div class="row g-2 mb-2 align-items-center inbound-item-row" id="${rowId}">
                <div class="col-md-2 position-relative">
                    <input type="text" class="form-control form-control-sm in-item" placeholder="품목명" autocomplete="off" required>
                    <div class="autocomplete-suggestions" style="display:none;"></div>
                </div>
                <div class="col-md-2">
                    <input type="text" class="form-control form-control-sm in-spec" placeholder="규격" required>
                </div>
                <div class="col-md-1">
                    <input type="text" class="form-control form-control-sm in-unit" placeholder="단위" required>
                </div>
                <div class="col-md-1">
                    <input type="number" class="form-control form-control-sm in-qty" placeholder="수량" min="0.01" step="0.01" required>
                </div>
                <div class="col-md-2">
                    <input type="number" class="form-control form-control-sm in-price" placeholder="매입단가" min="0" step="1" required>
                </div>
                <div class="col-md-3">
                    <input type="text" class="form-control form-control-sm in-note" placeholder="비고">
                </div>
                <div class="col-md-1 text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="app.removeInboundItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        // 새로 추가된 행의 품목 입력칸에 자동완성 이벤트 연결
        const newRow = $(rowId);
        const input = newRow.querySelector('.in-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/items/all`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        // 외부 클릭 시 자동완성 닫기 처리
        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });
    },

    removeInboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
    },

    setupInboundAutocomplete: function() {
        // 초기화 시 기본으로 1개 행 추가
        this.addInboundItemRow();
    },

    handleInboundSubmit: async function(e) {
        e.preventDefault();
        
        const rows = document.querySelectorAll('.inbound-item-row');
        if (rows.length === 0) return alert('입고할 품목을 추가하세요.');

        const items = [];
        let hasError = false;

        rows.forEach(row => {
            const item = row.querySelector('.in-item').value.trim();
            const spec = row.querySelector('.in-spec').value.trim();
            const unit = row.querySelector('.in-unit').value.trim();
            const qty = parseFloat(row.querySelector('.in-qty').value);
            const unit_price = parseFloat(row.querySelector('.in-price').value);
            const note = row.querySelector('.in-note').value.trim();

            if (!item || !spec || !unit || isNaN(qty) || isNaN(unit_price)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, unit_price, note });
            }
        });

        if (hasError) return alert('품목 내역에 빈 값이 있거나 올바르지 않습니다.');

        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            items: items
        };

        if (confirm(`총 ${items.length}건의 품목을 입고하시겠습니까?`)) {
            try {
                await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('입고 완료되었습니다.');
                $('inboundForm').reset();
                $('inboundItemsContainer').innerHTML = '';
                this.addInboundItemRow();
                this.initTodayDates();
            } catch (err) {
                alert('입고 실패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Outbound (출고)
    // ----------------------------------------
    setupOutboundAutocomplete: function() {
        const input = $('out_item');
        const sug = $('out_item_suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            $('out_spec').innerHTML = '<option value="">품목을 선택하세요</option>';
            $('out_spec').disabled = true;
            $('out_qty').disabled = true;
            $('lotDeductionSection').style.display = 'none';

            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                // 출고는 잔여 재고가 있는 품목만 검색
                const items = await authFetch(`${API_BASE}/inventory/items`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                            this.loadOutboundSpecs(div.innerText);
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });
    },

    loadOutboundSpecs: async function(itemName) {
        try {
            // 선택한 품목의 모든 재고 Lot을 불러옴
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(itemName)}`);
            // 규격별로 그룹화
            const specMap = {};
            lots.forEach(l => {
                if (!specMap[l.spec]) specMap[l.spec] = { unit: l.unit, total: 0, lots: [] };
                specMap[l.spec].total += l.qty_remaining;
                specMap[l.spec].lots.push(l);
            });

            const sel = $('out_spec');
            sel.innerHTML = '<option value="">규격을 선택하세요</option>';
            
            for (const [spec, data] of Object.entries(specMap)) {
                // json에 lot 데이터를 문자열로 담아둠
                sel.innerHTML += `<option value="${spec}" data-lots='${JSON.stringify(data.lots)}' data-unit="${data.unit}">[잔여 ${data.total}${data.unit}] ${spec}</option>`;
            }
            
            sel.disabled = false;
        } catch (e) {
            console.error(e);
            alert('규격을 불러오는데 실패했습니다.');
        }
    },

    handleOutboundSpecChange: function(e) {
        const sel = e.target;
        if (!sel.value) {
            $('out_qty').disabled = true;
            $('lotDeductionSection').style.display = 'none';
            return;
        }
        
        const option = sel.options[sel.selectedIndex];
        availableLots = JSON.parse(option.getAttribute('data-lots')); // 해당 규격의 가용 로트 목록 (오래된 순)
        
        $('out_qty').disabled = false;
        $('out_qty').value = '';
        $('lotDeductionSection').style.display = 'block';
        this.renderLotTable();
    },

    // 총 출고 수량 입력 시, FIFO 방식으로 각 Lot에 차감 추천량 배분
    handleOutboundQtyChange: function() {
        let totalOutQty = parseFloat($('out_qty').value) || 0;
        
        // 각 Lot의 input 값을 FIFO로 자동 채움
        availableLots.forEach((lot, idx) => {
            const input = $(`lot_deduct_${lot.id}`);
            if (!input) return;
            
            if (totalOutQty <= 0) {
                input.value = 0;
            } else if (totalOutQty >= lot.qty_remaining) {
                input.value = lot.qty_remaining;
                totalOutQty -= lot.qty_remaining;
            } else {
                input.value = totalOutQty;
                totalOutQty = 0;
            }
        });
        
        this.validateLotSum();
    },

    renderLotTable: function() {
        const tbody = $('lotTbody');
        tbody.innerHTML = availableLots.map(lot => `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-input mx-auto" 
                           id="lot_deduct_${lot.id}" 
                           min="0" max="${lot.qty_remaining}" step="0.01" value="0"
                           onchange="app.validateLotSum()" onkeyup="app.validateLotSum()">
                </td>
            </tr>
        `).join('');
        this.validateLotSum();
    },

    // 사용자가 개별 차감량을 수동으로 만졌을 때, 총합과 맞는지 검증
    validateLotSum: function() {
        let sum = 0;
        availableLots.forEach(lot => {
            const val = parseFloat($(`lot_deduct_${lot.id}`).value) || 0;
            sum += val;
        });
        
        const targetQty = parseFloat($('out_qty').value) || 0;
        const btn = $('btnOutboundSubmit');
        const err = $('lotErrorMsg');
        
        // 부동소수점 오차 방지
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        
        if (isMatch) {
            btn.disabled = false;
            err.style.display = 'none';
        } else {
            btn.disabled = true;
            if (targetQty > 0) err.style.display = 'block';
            else err.style.display = 'none';
        }
    },

    handleOutboundSubmit: async function(e) {
        e.preventDefault();
        
        // 차감할 로트 배열 수집
        const consumed_lots = [];
        availableLots.forEach(lot => {
            const val = parseFloat($(`lot_deduct_${lot.id}`).value) || 0;
            if (val > 0) {
                consumed_lots.push({
                    inbound_id: lot.id,
                    consumed_qty: val
                });
            }
        });

        const selSpec = $('out_spec').options[$('out_spec').selectedIndex];

        const payload = {
            date: $('out_date').value,
            destination: $('out_destination').value,
            item: $('out_item').value.trim(),
            spec: $('out_spec').value,
            unit: selSpec.getAttribute('data-unit'),
            qty: parseFloat($('out_qty').value),
            selling_price: parseFloat($('out_selling_price').value),
            shipping_fee: parseFloat($('out_shipping_fee').value),
            consumed_lots: consumed_lots
        };

        if (confirm(`[${payload.item}] ${payload.qty}${payload.unit} 출고 처리하시겠습니까? (차감 Lot 수: ${consumed_lots.length}개)`)) {
            try {
                await authFetch(`${API_BASE}/outbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('출고 완료되었습니다.');
                $('outboundForm').reset();
                this.initTodayDates();
                
                // UI 초기화
                $('out_spec').innerHTML = '<option value="">품목을 선택하세요</option>';
                $('out_spec').disabled = true;
                $('out_qty').disabled = true;
                $('lotDeductionSection').style.display = 'none';
                
            } catch (err) {
                alert('출고 실패: ' + err.message);
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
