/**
 * 입출고 관리 프론트엔드 로직
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
    setupInboundAutocomplete: function() {
        const input = $('in_item');
        const sug = $('in_item_suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                // 입고는 모든 품목 검색
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
    },

    handleInboundSubmit: async function(e) {
        e.preventDefault();
        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            item: $('in_item').value.trim(),
            spec: $('in_spec').value.trim(),
            unit: $('in_unit').value.trim(),
            qty: parseFloat($('in_qty').value),
            unit_price: parseFloat($('in_unit_price').value)
        };

        if (confirm(`[${payload.item}] ${payload.qty}${payload.unit} 입고하시겠습니까?`)) {
            try {
                await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('입고 완료되었습니다.');
                $('inboundForm').reset();
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
