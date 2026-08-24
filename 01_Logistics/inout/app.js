/**
 * ?�출�?관�??�론?�엔??로직
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
let availableLots = []; // 출고 ???�택???�목+규격???�여 Lot 목록

const app = {
    init: async function() {
        this.bindEvents();
        await this.loadLocations();
        this.initTodayDates();
        this.setupInboundAutocomplete();
        this.setupOutboundAutocomplete();
        this.setupPartnerAutocomplete();
        this.loadHistory();
    },

    bindEvents: function() {
        $('inboundForm').addEventListener('submit', this.handleInboundSubmit.bind(this));
        $('outboundForm').addEventListener('submit', this.handleOutboundSubmit.bind(this));
        $('directForm').addEventListener('submit', this.handleDirectSubmit.bind(this));
        $('editInboundForm').addEventListener('submit', this.submitEditInbound.bind(this));
        $('editOutboundForm').addEventListener('submit', this.submitEditOutbound.bind(this));
        $('btnEditOutboundLot').addEventListener('click', this.openEditOutboundLotModal.bind(this));
        
        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (e.target.id !== 'in_item') {
                const s = $('in_item_suggestions');
                if(s) s.style.display = 'none';
            }
            if (e.target.id !== 'out_item') {
                const s = $('out_item_suggestions');
                if(s) s.style.display = 'none';
            }
        });
    },

    // ----------------------------------------
    // History & Deletion (?�역 �???��)
    // ----------------------------------------
    currentPage: 1,
    sortCol: 'date',
    sortDir: 'desc',
    detailedFilters: {
        startDate: '',
        endDate: '',
        searchParty: '',
        searchItem: '',
        searchSpec: ''
    },

    toggleSort: function(colName) {
        if (this.sortCol === colName) {
            this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortCol = colName;
            this.sortDir = 'desc';
        }
        
        document.querySelectorAll('.sort-icon').forEach(el => el.innerHTML = '');
        const icon = this.sortDir === 'asc' ? ' ?��' : ' ?��';
        const th = document.getElementById('th-' + colName);
        if (th) {
            th.querySelector('.sort-icon').innerHTML = icon;
        }

        this.resetPageAndLoadHistory();
    },

    openDetailedSearch: function() {
        const modalEl = document.getElementById('detailedSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    applyDetailedSearch: function() {
        this.detailedFilters.startDate = $('ds_start_date').value;
        this.detailedFilters.endDate = $('ds_end_date').value;
        this.detailedFilters.searchParty = $('ds_party').value.trim();
        this.detailedFilters.searchItem = $('ds_item').value.trim();
        this.detailedFilters.searchSpec = $('ds_spec').value.trim();

        const modalEl = document.getElementById('detailedSearchModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        this.resetPageAndLoadHistory();
    },

    resetDetailedSearch: function() {
        $('dsForm').reset();
        this.detailedFilters = {
            startDate: '', endDate: '', searchParty: '', searchItem: '', searchSpec: ''
        };
        this.resetPageAndLoadHistory();
    },

    resetPageAndLoadHistory: function() {
        this.currentPage = 1;
        this.loadHistory();
    },

    changeHistoryPage: function(page) {
        this.currentPage = page;
        this.loadHistory();
    },

    loadHistory: async function() {
        const typeFilter = document.querySelector('input[name="historyFilter"]:checked').value;
        const searchRaw = $('historySearch').value.trim();
        const limit = parseInt($('historyLimit').value) || 50;

        const params = new URLSearchParams({
            page: this.currentPage,
            limit: limit,
            type: typeFilter,
            search: searchRaw,
            sortCol: this.sortCol,
            sortDir: this.sortDir,
            startDate: this.detailedFilters.startDate,
            endDate: this.detailedFilters.endDate,
            searchParty: this.detailedFilters.searchParty,
            searchItem: this.detailedFilters.searchItem,
            searchSpec: this.detailedFilters.searchSpec
        });

        try {
            $('historyTbody').innerHTML = `<tr><td colspan="9" class="text-center text-muted">?�이?��? 불러?�는 중입?�다...</td></tr>`;
            
            const res = await authFetch(`${API_BASE}/history?${params.toString()}`);
            this.renderHistoryTable(res.data);
            this.renderPagination(res.total, res.page, res.limit);
        } catch (err) {
            console.error('History load error:', err);
            $('historyTbody').innerHTML = `<tr><td colspan="9" class="text-center text-danger">?�역??불러?��? 못했?�니??</td></tr>`;
        }
    },

    renderPagination: function(total, currentPage, limit) {
        const totalPages = Math.ceil(total / limit) || 1;
        const ul = $('historyPagination');
        
        let html = '';
        
        // Prev button
        if (currentPage > 1) {
            html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${currentPage - 1})">?�전</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">?�전</span></li>`;
        }

        // Display up to 5 page numbers around the current page
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
            startPage = Math.max(1, endPage - 4);
        }

        for (let i = startPage; i <= endPage; i++) {
            if (i === currentPage) {
                html += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
            } else {
                html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${i})">${i}</button></li>`;
            }
        }

        // Next button
        if (currentPage < totalPages) {
            html += `<li class="page-item"><button class="page-link" onclick="app.changeHistoryPage(${currentPage + 1})">?�음</button></li>`;
        } else {
            html += `<li class="page-item disabled"><span class="page-link">?�음</span></li>`;
        }

        ul.innerHTML = html;
    },

    renderHistoryTable: function(data) {
        const tbody = $('historyTbody');
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">?�당?�는 ?�역???�습?�다.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.map(r => {
            const isOut = r.type === 'outbound';
            const badge = isOut ? `<span class="badge bg-danger">출고</span>` : `<span class="badge bg-success">?�고</span>`;
            const delFn = isOut ? `app.deleteOutbound(${r.id})` : `app.deleteInbound(${r.id})`;
            const editFn = isOut ? `app.openEditOutbound(${r.id})` : `app.openEditInbound(${r.id})`;
            return `
            <tr style="cursor:pointer;" class="inbound-item-row" onclick="app.openDrawer('detail', {id: ${r.id}, type: '${r.type}'})">
                <td>${badge}</td>
                <td>${r.date}</td>
                <td>${r.party}</td>
                <td><strong>${r.item}</strong></td>
                <td>${r.spec}</td>
                <td>${r.unit}</td>
                <td class="${isOut ? 'text-danger fw-bold' : 'text-success fw-bold'}">${r.qty}</td>
                <td>${r.price.toLocaleString()}</td>
                <td class="text-center text-nowrap">
                    <button class="btn btn-sm btn-outline-secondary py-0 px-2 me-1" onclick="event.stopPropagation(); ${editFn}" title="?�정"><i class='bx bx-edit'></i></button>
                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="event.stopPropagation(); ${delFn}" title="??��"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
            `;
        }).join('');
    },

    deleteInbound: async function(id) {
        if (!confirm('???�고 ?�역???�말 ??��?�시겠습?�까? (?��? 출고???�역?� ??��?????�습?�다)')) return;
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, { method: 'DELETE' });
            alert('?�고 ?�역????��?�었?�니??');
            this.loadHistory();
        } catch (err) {
            alert('??�� ?�패: ' + err.message);
        }
    },

    deleteOutbound: async function(id) {
        if (!confirm('??출고 ?�역???�말 ??��?�시겠습?�까? (차감?�었???�고 ?�고가 ?�시 복구?�니??')) return;
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, { method: 'DELETE' });
            alert('출고 ?�역????��?�고 ?�고가 복구?�었?�니??');
            this.loadHistory();
        } catch (err) {
            alert('??�� ?�패: ' + err.message);
        }
    },

    initTodayDates: function() {
        const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');
        $('in_date').value = today;
        $('out_date').value = today;
    },

    // ----------------------------------------
    // Locations (?�치 관�?
    // ----------------------------------------
    loadLocations: async function() {
        try {
            locations = await authFetch(`${API_BASE}/locations`);
            const sel = $('in_location');
            sel.innerHTML = '<option value="">?�택?�세??/option>';
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
        const modalEl = $('locationsModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    addLocation: async function() {
        const input = $('newLocationInput');
        const name = input.value.trim();
        if (!name) return alert('?�름???�력?�세??);
        try {
            await authFetch(`${API_BASE}/locations`, { method: 'POST', body: JSON.stringify({ name }) });
            input.value = '';
            await this.loadLocations();
        } catch (e) {
            alert('?�류: ' + e.message);
        }
    },

    // ----------------------------------------
    // Partner Autocomplete & Quick Modal
    // ----------------------------------------
    partnersCache: [],
    
    setupPartnerAutocomplete: async function() {
        try {
            const CORE_API = API_BASE.replace('/logistics', '');
            const res = await authFetch(`${CORE_API}/partners`);
            this.partnersCache = res;
        } catch (e) {
            console.error('Failed to load partners', e);
        }
        // 거래�??�동?�성?� ?�제 Partner Search Modal �??��???    },

    openPartnerSearchModal: function(targetInputId) {
        if (!this.partnersCache || this.partnersCache.length === 0) {
            this.setupPartnerAutocomplete().then(() => this.showPartnerSearchModal(targetInputId));
        } else {
            this.showPartnerSearchModal(targetInputId);
        }
    },

    showPartnerSearchModal: function(targetInputId) {
        const inputEl = $(targetInputId);
        if (!inputEl) return;
        
        $('partnerSearchTargetInput').value = targetInputId;
        const searchVal = inputEl.value.trim();
        $('partnerSearchInput').value = searchVal;
        
        this.filterPartnerSearch();

        const modalEl = $('partnerSearchModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
        
        // ?�커???�동
        setTimeout(() => $('partnerSearchInput').focus(), 500);
    },

    filterPartnerSearch: function() {
        const val = $('partnerSearchInput').value.trim().toLowerCase();
        const listContainer = $('partnerSearchList');
        
        let matches = this.partnersCache;
        if (val) {
            matches = matches.filter(p => 
                (p.name && p.name.toLowerCase().includes(val)) || 
                (p.company_name && p.company_name.toLowerCase().includes(val))
            );
        }
        
        if (matches.length === 0) {
            listContainer.innerHTML = `<div class="list-group-item text-center text-muted py-4">검?�된 거래처�? ?�습?�다.</div>`;
            return;
        }

        listContainer.innerHTML = matches.map(m => {
            const displayText = m.company_name ? `${m.name} / <small class="text-muted">${m.company_name}</small>` : m.name;
            return `
                <button type="button" class="list-group-item list-group-item-action py-2" onclick="app.selectPartner('${m.name}')">
                    <div class="fw-bold">${m.name}</div>
                    ${m.company_name ? `<div style="font-size: 0.8rem;" class="text-muted">${m.company_name}</div>` : ''}
                </button>
            `;
        }).join('');
    },

    selectPartner: function(name) {
        const targetId = $('partnerSearchTargetInput').value;
        if (targetId && $(targetId)) {
            $(targetId).value = name;
        }
        const modal = bootstrap.Modal.getInstance($('partnerSearchModal'));
        if (modal) modal.hide();
    },


    // ----------------------------------------
    // Inbound (?�고)
    // ----------------------------------------
    addInboundItemRow: function() {
        const container = $('inboundItemsContainer');
        const rowId = 'in_row_' + Date.now();
        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light inbound-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-6 position-relative">
                        <input type="text" class="form-control form-control-sm in-item" placeholder="?�목�? autocomplete="off" required>
                        <div class="autocomplete-suggestions" style="display:none;"></div>
                    </div>
                    <div class="col-6">
                        <input type="text" class="form-control form-control-sm in-spec" placeholder="규격" required>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-5">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm in-qty" placeholder="?�량"  step="0.01" required>
                            <input type="text" class="form-control form-control-sm in-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="?�위" required>
                        </div>
                    </div>
                    <div class="col-5">
                        <input type="number" class="form-control form-control-sm in-price" placeholder="?�고?��?" min="0" step="1" required>
                    </div>
                    <div class="col-2 d-flex justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-danger w-100" onclick="app.removeInboundItemRow('${rowId}')"><i class='bx bx-trash'></i> ??��</button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        // ?�로 추�????�의 ?�목 ?�력칸에 ?�동?�성 ?�벤???�결
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

        // ?��? ?�릭 ???�동?�성 ?�기 처리
        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
    },

    removeInboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
    },

    setupInboundAutocomplete: function() {
        // 초기????기본?�로 1�???추�?
        this.addInboundItemRow();
    },

    handleInboundSubmit: async function(e) {
        e.preventDefault();
        
        const rows = document.querySelectorAll('.inbound-item-row');
        if (rows.length === 0) return alert('?�고???�목??추�??�세??');

        const items = [];
        let hasError = false;

        const docNote = $('in_note').value.trim();

        rows.forEach(row => {
            const item = row.querySelector('.in-item').value.trim();
            const spec = row.querySelector('.in-spec').value.trim();
            const unit = row.querySelector('.in-unit').value.trim();
            const qty = parseFloat(row.querySelector('.in-qty').value);
            const unit_price = parseFloat(row.querySelector('.in-price').value);
            const note = docNote;

            if (!item || !spec || !unit || isNaN(qty) || isNaN(unit_price)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, unit_price, note });
            }
        });

        if (hasError) return alert('?�목 ?�역??�?값이 ?�거???�바르�? ?�습?�다.');

        const payload = {
            date: $('in_date').value,
            supplier: $('in_supplier').value,
            location_id: $('in_location').value,
            items: items
        };

        if (confirm(`�?${items.length}건의 ?�목???�고?�시겠습?�까?`)) {
            try {
                await authFetch(`${API_BASE}/inbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('?�고 ?�료?�었?�니??');
                $('inboundForm').reset();
                $('inboundItemsContainer').innerHTML = '';
                this.addInboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('?�고 ?�패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Utility: Autocomplete Keyboard Navigation
    // ----------------------------------------
    attachAutocompleteKeyboard: function(input, sugBox) {
        let currentFocus = -1;
        input.addEventListener('keydown', function(e) {
            if (sugBox.style.display === 'none') return;
            const items = sugBox.querySelectorAll('.autocomplete-suggestion');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                currentFocus++;
                if (currentFocus >= items.length) currentFocus = 0;
                setActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                currentFocus--;
                if (currentFocus < 0) currentFocus = items.length - 1;
                setActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (currentFocus > -1) {
                    items[currentFocus].click();
                }
            }
        });

        input.addEventListener('input', () => { currentFocus = -1; });

        function setActive(items) {
            items.forEach(item => item.classList.remove('active-suggestion'));
            items[currentFocus].classList.add('active-suggestion');
            // Auto scroll (optional, simple logic)
            items[currentFocus].scrollIntoView({ block: 'nearest' });
        }
    },

    // ----------------------------------------
    // Direct Shipment (직출�?
    // ----------------------------------------
    addDirectItemRow: function() {
        const container = $('directItemsContainer');
        const rowId = 'dir_row_' + Date.now() + Math.floor(Math.random() * 1000);

        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light direct-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-7 position-relative">
                        <input type="text" class="form-control form-control-sm dir-item" placeholder="?�목�? autocomplete="off" required>
                        <div class="autocomplete-suggestions" style="display:none;"></div>
                    </div>
                    <div class="col-5">
                        <input type="text" class="form-control form-control-sm dir-spec" placeholder="규격" required>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-4">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm dir-qty" placeholder="?�량"  step="0.01" required>
                            <input type="text" class="form-control form-control-sm dir-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="?�위" required>
                        </div>
                    </div>
                    <div class="col-3">
                        <input type="number" class="form-control form-control-sm dir-in-price" placeholder="매입?��?" min="0" step="1" required>
                    </div>
                    <div class="col-4">
                        <input type="number" class="form-control form-control-sm dir-out-price" placeholder="매출?��?" min="0" step="1" required>
                    </div>
                    <div class="col-1 text-end">
                        <button type="button" class="btn btn-sm btn-outline-danger w-100 px-1" onclick="app.removeDirectItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);
        
        const newRow = $(rowId);
        const input = newRow.querySelector('.dir-item');
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

        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
    },

    removeDirectItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
    },

    handleDirectSubmit: async function(e) {
        e.preventDefault();
        
        const rows = document.querySelectorAll('.direct-item-row');
        if (rows.length === 0) return alert('직출고할 ?�목??추�??�세??');

        const items = [];
        let hasError = false;

        const date = $('dir_date').value;
        const supplier = $('dir_supplier').value.trim();
        const destination = $('dir_destination').value.trim();
        const actual_destination = $('dir_actual_destination') ? $('dir_actual_destination').value.trim() : '';
        
        if (!supplier || !destination) {
            return alert('매입처�? 매출처�? 모두 ?�력?�주?�요.');
        }

        const docShippingFee = parseFloat($('dir_shipping') ? $('dir_shipping').value : 0) || 0;
        const docShippingFeeVatIncluded = $('dir_shipping_vat') && $('dir_shipping_vat').checked ? 1 : 0;
        const docNote = $('dir_note') ? $('dir_note').value.trim() : '';

        rows.forEach((row, idx) => {
            const item = row.querySelector('.dir-item').value.trim();
            const spec = row.querySelector('.dir-spec').value.trim();
            const unit = row.querySelector('.dir-unit').value.trim();
            const qty = parseFloat(row.querySelector('.dir-qty').value);
            const in_price = parseFloat(row.querySelector('.dir-in-price').value);
            const out_price = parseFloat(row.querySelector('.dir-out-price').value);
            const shipping_fee = idx === 0 ? docShippingFee : 0;
            const shipping_fee_vat_included = idx === 0 ? docShippingFeeVatIncluded : 0;
            const note = docNote;

            if (!item || !spec || !unit || isNaN(qty) || isNaN(in_price) || isNaN(out_price)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, unit_price: in_price, selling_price: out_price, shipping_fee, shipping_fee_vat_included, note });
            }
        });

        if (hasError) return alert('?�목 ?�역??�?값이 ?�거???�바르�? ?�습?�다.');

        const payload = {
            date: date,
            supplier: supplier,
            destination: destination,
            actual_destination: actual_destination,
            items: items
        };

        if (confirm(`�?${items.length}건의 ?�목??직출고로 ?�시 처리?�시겠습?�까? (?�고/출고 ?��????�시 반영??`)) {
            try {
                const res = await authFetch('${API_BASE}/logistics/direct', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                alert('직출�?처리가 ?�료?�었?�니??');
                this.closeDrawer();
                $('btnFilterAll').checked = true;
                this.resetPageAndLoadHistory();
            } catch (err) {
                alert('직출�??�패: ' + err.message);
            }
        }
    },

    // ----------------------------------------
    // Outbound (출고)
    // ----------------------------------------
    outboundRows: {}, // rowId -> { availableLots: [], consumedLots: [] }
    currentLotModalRowId: null,

    setupOutboundAutocomplete: function() {
        // 초기 1??        this.addOutboundItemRow();
    },

    addOutboundItemRow: function() {
        const container = $('outboundItemsContainer');
        const rowId = 'out_row_' + Date.now() + Math.floor(Math.random() * 1000);
        this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };

        const rowHtml = `
            <div class="p-2 mb-2 border rounded bg-light outbound-item-row" id="${rowId}">
                <div class="row g-2 mb-2 align-items-center">
                    <div class="col-6 position-relative">
                        <input type="text" class="form-control form-control-sm out-item" placeholder="?�목�? autocomplete="off" required>
                        <div class="autocomplete-suggestions"></div>
                    </div>
                    <div class="col-6">
                        <select class="form-select form-select-sm out-spec" disabled required onchange="app.handleOutboundSpecChange('${rowId}', this)">
                            <option value="">?�목 먼�? ?�택</option>
                        </select>
                    </div>
                </div>
                <div class="row g-2 align-items-center">
                    <div class="col-5">
                        <div class="d-flex gap-1">
                            <input type="number" class="form-control form-control-sm out-qty" placeholder="출고 ?�량"  step="0.01" disabled required onchange="app.handleOutboundQtyChange('${rowId}')" onkeyup="app.handleOutboundQtyChange('${rowId}')">
                            <input type="text" class="form-control form-control-sm out-unit bg-white text-center" style="max-width: 60px; padding: 0.25rem;" placeholder="?�위" readonly>
                        </div>
                    </div>
                    <div class="col-4">
                        <input type="number" class="form-control form-control-sm out-price" placeholder="?��?" min="0" step="1" required>
                    </div>
                    <div class="col-3 d-flex gap-1 justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-primary btn-lot flex-grow-1" onclick="app.openLotModal('${rowId}')" disabled>Lot ?�정</button>
                        <button type="button" class="btn btn-sm btn-outline-danger px-2" onclick="app.removeOutboundItemRow('${rowId}')"><i class='bx bx-trash'></i></button>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowHtml);

        const newRow = $(rowId);
        const input = newRow.querySelector('.out-item');
        const sug = newRow.querySelector('.autocomplete-suggestions');
        
        input.addEventListener('input', async (e) => {
            const val = e.target.value.trim();
            const specSel = newRow.querySelector('.out-spec');
            const qtyInput = newRow.querySelector('.out-qty');
            const unitInput = newRow.querySelector('.out-unit');
            const lotBtn = newRow.querySelector('.btn-lot');

            specSel.innerHTML = '<option value="">?�목???�택?�세??/option>';
            specSel.disabled = true;
            qtyInput.disabled = true;
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();

            if (val.length < 1) { sug.style.display = 'none'; return; }
            try {
                const items = await authFetch(`${API_BASE}/inventory/items`);
                const matches = items.filter(i => i.toLowerCase().includes(val.toLowerCase()));
                if (matches.length > 0) {
                    sug.innerHTML = matches.map(m => `<div class="autocomplete-suggestion">${m}</div>`).join('');
                    sug.style.display = 'block';
                    
                    sug.querySelectorAll('.autocomplete-suggestion').forEach(div => {
                        div.addEventListener('click', () => {
                            input.value = div.innerText;
                            sug.style.display = 'none';
                            this.loadOutboundSpecsForRow(rowId, div.innerText);
                        });
                    });
                } else {
                    sug.style.display = 'none';
                }
            } catch (err) { console.error(err); }
        });

        document.addEventListener('click', (e) => {
            if (e.target !== input) sug.style.display = 'none';
        });

        this.attachAutocompleteKeyboard(input, sug);
    },

    removeOutboundItemRow: function(rowId) {
        const row = $(rowId);
        if (row) row.remove();
        delete this.outboundRows[rowId];
        this.validateAllOutboundLots();
    },

    loadOutboundSpecsForRow: async function(rowId, itemName) {
        try {
            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(itemName)}`);
            const specMap = {};
            lots.forEach(l => {
                if (!specMap[l.spec]) specMap[l.spec] = { unit: l.unit, total: 0, lots: [] };
                specMap[l.spec].total += l.qty_remaining;
                specMap[l.spec].lots.push(l);
            });

            const row = $(rowId);
            const sel = row.querySelector('.out-spec');
            sel.innerHTML = '<option value="">규격???�택?�세??/option>';
            
            for (const [spec, data] of Object.entries(specMap)) {
                sel.innerHTML += `<option value="${spec}" data-lots='${JSON.stringify(data.lots)}' data-unit="${data.unit}">[?�여 ${data.total}${data.unit}] ${spec}</option>`;
            }
            sel.disabled = false;
        } catch (e) {
            console.error(e);
            alert('규격??불러?�는???�패?�습?�다.');
        }
    },

    handleOutboundSpecChange: function(rowId, sel) {
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        const unitInput = row.querySelector('.out-unit');
        const lotBtn = row.querySelector('.btn-lot');

        if (!sel.value) {
            qtyInput.disabled = true;
            qtyInput.value = '';
            unitInput.value = '';
            lotBtn.disabled = true;
            this.outboundRows[rowId] = { availableLots: [], consumedLots: [] };
            this.validateAllOutboundLots();
            return;
        }
        
        const option = sel.options[sel.selectedIndex];
        const unit = option.getAttribute('data-unit');
        const lots = JSON.parse(option.getAttribute('data-lots'));
        
        unitInput.value = unit;
        qtyInput.disabled = false;
        qtyInput.value = '';
        lotBtn.disabled = false;
        
        this.outboundRows[rowId].availableLots = lots;
        this.outboundRows[rowId].consumedLots = [];
        this.validateAllOutboundLots();
    },

    handleOutboundQtyChange: function(rowId) {
        const row = $(rowId);
        const qtyInput = row.querySelector('.out-qty');
        let totalOutQty = parseFloat(qtyInput.value) || 0;
        
        const rData = this.outboundRows[rowId];
        rData.consumedLots = []; // reset

        // FIFO Auto distribute
        rData.availableLots.forEach((lot) => {
            if (totalOutQty <= 0) return;
            let take = 0;
            if (totalOutQty >= lot.qty_remaining) {
                take = lot.qty_remaining;
                totalOutQty -= lot.qty_remaining;
            } else {
                take = totalOutQty;
                totalOutQty = 0;
            }
            if (take > 0) {
                rData.consumedLots.push({ inbound_id: lot.id, consumed_qty: take });
            }
        });
        
        this.validateAllOutboundLots();
    },

    openLotModal: function(rowId) {
        this.currentLotModalRowId = rowId;
        const row = $(rowId);
        const itemName = row.querySelector('.out-item').value;
        const specName = row.querySelector('.out-spec').value;
        const targetQty = parseFloat(row.querySelector('.out-qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.outboundRows[rowId];
        
        // Render table
        const tbody = $('lotModalTbody');
        tbody.innerHTML = rData.availableLots.map(lot => {
            const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
            const val = consumed ? consumed.consumed_qty : 0;
            return `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                           data-id="${lot.id}"
                           min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                           onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                </td>
            </tr>
            `;
        }).join('');
        
        this.validateLotModalSum();
        const modalEl = $('lotModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        
        // lotModal???�른 모달(editOutboundModal ?? ?�에 ????배경(backdrop) z-index 보정
        modalEl.addEventListener('shown.bs.modal', function () {
            const backdrops = document.querySelectorAll('.modal-backdrop');
            if (backdrops.length > 1) {
                // 마�?�?가???�에 ?�는) backdrop??z-index�?조정
                backdrops[backdrops.length - 1].style.zIndex = '1069';
            }
        }, { once: true });
        
        modal.show();
    },

    validateLotModalSum: function() {
        let sum = 0;
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            sum += parseFloat(inp.value) || 0;
        });
        $('lotModalCurQty').innerText = sum;
        
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        const err = $('lotModalErrorMsg');
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (isMatch || targetQty === 0) {
            err.style.display = 'none';
        } else {
            err.style.display = 'block';
        }
    },

    saveLotModal: function() {
        const targetQty = parseFloat($('lotModalReqQty').innerText) || 0;
        let sum = 0;
        const tempConsumed = [];
        document.querySelectorAll('.lot-qty-modal-input').forEach(inp => {
            const val = parseFloat(inp.value) || 0;
            sum += val;
            if (val > 0) {
                tempConsumed.push({ inbound_id: parseInt(inp.getAttribute('data-id')), consumed_qty: val });
            }
        });
        
        const isMatch = Math.abs(sum - targetQty) < 0.0001 && targetQty > 0;
        if (!isMatch && targetQty > 0) {
            alert('차감???�계가 �?출고 ?�량�??�치?��? ?�습?�다.');
            return;
        }
        
        if (this.currentLotModalRowId === 'editOutbound') {
            this.editOutboundState.consumedLots = tempConsumed;
            $('editOutboundErrorMsg').style.display = 'none';
        } else {
            this.outboundRows[this.currentLotModalRowId].consumedLots = tempConsumed;
            this.validateAllOutboundLots();
        }
        
        const modal = bootstrap.Modal.getInstance($('lotModal'));
        modal.hide();
    },

    validateAllOutboundLots: function() {
        const rows = document.querySelectorAll('.outbound-item-row');
        let allValid = true;
        let hasItems = false;
        
        rows.forEach(row => {
            const rowId = row.id;
            const qty = parseFloat(row.querySelector('.out-qty').value) || 0;
            const rData = this.outboundRows[rowId];
            
            if (qty > 0 && rData) {
                hasItems = true;
                let sum = 0;
                rData.consumedLots.forEach(c => sum += c.consumed_qty);
                const isMatch = Math.abs(sum - qty) < 0.0001;
                
                const btn = row.querySelector('.btn-lot');
                if (isMatch) {
                    btn.classList.remove('btn-outline-danger');
                    btn.classList.add('btn-outline-primary');
                    btn.innerHTML = 'Lot ?�인??<i class="bx bx-check"></i>';
                } else {
                    btn.classList.remove('btn-outline-primary');
                    btn.classList.add('btn-outline-danger');
                    btn.innerHTML = 'Lot ?�설???�요 <i class="bx bx-error"></i>';
                    allValid = false;
                }
            } else if (qty <= 0) {
                allValid = false;
            }
        });
        
        if (rows.length === 0) allValid = false;

        const btnSubmit = $('btnOutboundSubmit');
        const errMsg = $('outErrorMsg');
        
        if (allValid && hasItems) {
            btnSubmit.disabled = false;
            errMsg.style.display = 'none';
        } else {
            btnSubmit.disabled = true;
            if (hasItems) errMsg.style.display = 'block';
            else errMsg.style.display = 'none';
        }
    },

    handleOutboundSubmit: async function(e) {
        e.preventDefault();
        const rows = document.querySelectorAll('.outbound-item-row');
        if (rows.length === 0) return alert('출고???�목??추�??�세??');

        const items = [];
        let hasError = false;

        const docShippingFee = parseFloat($('out_shipping').value) || 0;
        const docNote = $('out_note').value.trim();

        rows.forEach(row => {
            const rowId = row.id;
            const item = row.querySelector('.out-item').value.trim();
            const spec = row.querySelector('.out-spec').value.trim();
            const unit = row.querySelector('.out-unit').value.trim();
            const qty = parseFloat(row.querySelector('.out-qty').value);
            const selling_price = parseFloat(row.querySelector('.out-price').value);
            const shipping_fee = idx === 0 ? docShippingFee : 0;
            const shipping_fee_vat_included = idx === 0 ? ($('out_shipping_vat').checked ? 1 : 0) : 0;
            const note = docNote;
            const consumed_lots = this.outboundRows[rowId].consumedLots;

            if (!item || !spec || isNaN(qty) || isNaN(selling_price)) {
                hasError = true;
            } else {
                items.push({ item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, consumed_lots });
            }
        });

        if (hasError) return alert('?�목 ?�역??�?값이 ?�거???�바르�? ?�습?�다.');

        const payload = {
            date: $('out_date').value,
            destination: $('out_destination').value,
            actual_destination: $('out_actual_destination') ? $('out_actual_destination').value.trim() : '',
            items: items
        };

        if (confirm(`�?${items.length}건의 ?�목??출고?�시겠습?�까?`)) {
            try {
                await authFetch(`${API_BASE}/outbound`, { method: 'POST', body: JSON.stringify(payload) });
                alert('출고 ?�료?�었?�니??');
                $('outboundForm').reset();
                $('outboundItemsContainer').innerHTML = '';
                this.outboundRows = {};
                this.addOutboundItemRow();
                this.initTodayDates();
                
                // Update history tables
                this.loadHistory();
                this.closeDrawer();
            } catch (err) {
                alert('출고 ?�패: ' + err.message);
            }
        }
    },
    
    // ==========================================
    // Drawer & Detail & Print Logic
    // ==========================================
    openExcelMenuModal: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    closeExcelMenuAndOpenDirect: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        setTimeout(() => app.openDirectExcelModal(), 300);
    },

    openDirectExcelModal: function() {
        const modalEl = document.getElementById('directExcelModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        $('directExcelFile').value = '';
        modal.show();
    },

    uploadDirectExcel: async function() {
        const fileInput = $('directExcelFile');
        if (!fileInput.files || fileInput.files.length === 0) {
            alert('?�로?�할 ?��? ?�일???�택?�주?�요.');
            return;
        }
        
        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            // Show loading state
            const btn = event.currentTarget || document.querySelector('#directExcelModal .btn-warning');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ?�로??�?..';
            btn.disabled = true;

            const res = await fetch(`${API_BASE}/outbound/direct/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                alert(`�?${data.count}건의 ?��? ?�이?��? ?�공?�으�??�괄 ?�록?�었?�니??`);
                
                const modalEl = document.getElementById('directExcelModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
                
                app.resetPageAndLoadHistory();
            } else {
                let errText = await res.text();
                try {
                    const errJson = JSON.parse(errText);
                    errText = errJson.error || errJson.details || errText;
                } catch(e) {}
                alert(`?�로???�패: ${errText}`);
            }
        } catch (err) {
            alert(`?�로??�??�류 발생: ${err.message}`);
        } finally {
            // Reset loading state
            const btn = document.querySelector('#directExcelModal .btn-warning');
            if (btn) {
                btn.innerHTML = "<i class='bx bx-upload'></i> ?�로??�??�괄 ?�록";
                btn.disabled = false;
            }
        }
    },

    openDrawer: function(mode, data = null) {
        if (mode === 'inbound_create') {
            const modalEl = document.getElementById('inboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            if ($('inboundItemsContainer').children.length === 0) {
                this.addInboundItemRow();
            }
        } else if (mode === 'outbound_create') {
            const modalEl = document.getElementById('outboundModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            if ($('outboundItemsContainer').children.length === 0) {
                this.addOutboundItemRow();
            }
        } else if (mode === 'direct_create') {
            const modalEl = document.getElementById('directModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            if ($('directItemsContainer').children.length === 0) {
                this.addDirectItemRow();
            }
        } else if (mode === 'detail') {
            const typeStr = data.type === 'inbound' ? '?�고' : '출고';
            $('detailModalTitle').innerHTML = `<i class='bx bx-file'></i> ${typeStr} ?�세 ?�역`;
            const modalEl = document.getElementById('detailModal');
            let modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
            this.renderDrawerDetail(data.id, data.type);
        }
    },
    
    closeDrawer: function() {
        const modals = ['inboundModal', 'outboundModal', 'directModal', 'detailModal'];
        modals.forEach(id => {
            const modalEl = document.getElementById(id);
            if (modalEl) {
                const modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            }
        });
        $('btnFilterAll').checked = true;
        this.resetPageAndLoadHistory();
    },

    renderDrawerDetail: async function(id, type) {
        try {
            const data = await authFetch(`${API_BASE}/history/${type}/${id}`);
            if (type === 'inbound') {
                data.qty = data.qty_initial;
            }
            this.currentHistoryDetail = data;
            
            const items = data.items || [data];
            
            const badgeHtml = type === 'inbound' ? '<span class="badge bg-success">?�고</span>' : '<span class="badge bg-danger">출고</span>';
            const metaClass = type === 'inbound' ? 'inbound' : 'outbound';
            const partnerLabel = type === 'inbound' ? '매입�? : '출고�?;
            const partnerValue = type === 'inbound' ? data.supplier : data.destination;
            const extraLabel = type === 'inbound' ? '창고?�치' : '배송�?;
            const shipVatLabel = data.shipping_fee_vat_included === 1 ? '(부가???�함)' : '(공급가 기�?)';
            const extraValue = type === 'inbound' 
                ? (data.location_name || '-')
                : (data.shipping_fee ? data.shipping_fee.toLocaleString() + '??' + shipVatLabel : '-');
            
            let actualDestHtml = '';
            if (type === 'outbound' && data.actual_destination) {
                actualDestHtml = `
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-map'></i> ?�출고처</span>
                        <span class="drawer-meta-value">${data.actual_destination}</span>
                    </div>
                `;
            }
            
            let html = `
            <div style="max-width: 1000px; margin: 0;">
                <div class="drawer-meta-bar ${metaClass}">
                    <div class="drawer-meta-item">
                        ${badgeHtml}
                    </div>
                    <div class="drawer-meta-item ms-2">
                        <span class="drawer-meta-label"><i class='bx bx-calendar'></i> ?�자</span>
                        <span class="drawer-meta-value">${data.date}</span>
                    </div>
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-buildings'></i> ${partnerLabel}</span>
                        <span class="drawer-meta-value">${partnerValue}</span>
                    </div>
                    ${actualDestHtml}
                    <div class="drawer-meta-item ms-3">
                        <span class="drawer-meta-label"><i class='bx bx-info-circle'></i> ${extraLabel}</span>
                        <span class="drawer-meta-value">${extraValue}</span>
                    </div>
                </div>
                ${data.note ? `<div class="mt-2 mb-3 px-3 py-2 bg-light rounded text-muted" style="font-size:0.85rem;"><i class='bx bx-message-square-detail'></i> <strong>비고:</strong> ${data.note}</div>` : ''}
                
                <table class="table table-bordered drawer-items-table align-middle mb-0">
                    <thead>
                        <tr>
                            <th class="text-center" style="width: 5%">#</th>
                            <th class="text-center" style="width: 35%">?�명 / 규격</th>
                            <th class="text-center" style="width: 10%">?�위</th>
                            <th class="text-center" style="width: 10%">?�량</th>
                            <th class="text-center" style="width: 20%">?��?</th>
                            <th class="text-center" style="width: 20%">총액</th>
                        </tr>
                    </thead>
                    <tbody>`;

            let totalQty = 0;
            let totalAmount = 0;

            items.forEach((item, idx) => {
                const itemQty = type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const itemPrice = type === 'inbound' ? item.unit_price : item.selling_price;
                const amount = itemQty * itemPrice;
                
                totalQty += itemQty;
                totalAmount += amount;
                
                html += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td><span class="fw-bold text-primary">${item.item}</span> <span class="text-secondary">/ ${item.spec}</span></td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-end fw-bold">${itemQty.toLocaleString()}</td>
                            <td class="text-end">${itemPrice.toLocaleString()}??/td>
                            <td class="text-end fw-bold text-danger">${amount.toLocaleString()}??/td>
                        </tr>`;
                
                if (type === 'outbound') {
                    let lotsHtml = '';
                    if (item.consumed_lots && item.consumed_lots.length > 0) {
                        lotsHtml = item.consumed_lots.map(l => 
                            `<span class="badge bg-white text-dark border me-1" style="font-weight:normal; font-size:0.7rem;">${l.inbound_date} ?�고 (${l.supplier}) <span class="text-danger fw-bold ms-1">-${l.consumed_qty}</span></span>`
                        ).join('');
                        html += `
                        <tr class="sub-row">
                            <td></td>
                            <td colspan="5"><i class='bx bx-layer'></i> 차감: ${lotsHtml}</td>
                        </tr>`;
                    }
                }
            });
            
            if (items.length > 1) {
                html += `
                        <tr class="total-row">
                            <td colspan="3" class="text-center">?�계</td>
                            <td class="text-end text-primary">${totalQty.toLocaleString()}</td>
                            <td></td>
                            <td class="text-end text-danger">${totalAmount.toLocaleString()}??/td>
                        </tr>`;
            }
            
            html += `
                    </tbody>
                </table>
            </div>`;
                
            if (type === 'inbound') {
                $('printOptInbound').classList.remove('d-none');
                $('printOptInboundLabel').classList.remove('d-none');
                $('printOptInbound').checked = true;
                $('printOptOutbound').classList.add('d-none');
                $('printOptOutboundLabel').classList.add('d-none');
                $('printOptTrans').classList.add('d-none');
                $('printOptTransLabel').classList.add('d-none');
            } else {
                $('printOptInbound').classList.add('d-none');
                $('printOptInboundLabel').classList.add('d-none');
                $('printOptOutbound').classList.remove('d-none');
                $('printOptOutboundLabel').classList.remove('d-none');
                $('printOptTrans').classList.remove('d-none');
                $('printOptTransLabel').classList.remove('d-none');
                $('printOptTrans').checked = true;
            }
            
            html += `</div>`;
            $('drawerDetailContent').innerHTML = html;
            
        } catch (err) {
            alert('?�세 ?�역??불러?�는???�패?�습?�다: ' + err.message);
        }
    },
    
    openCompanyPresetModal: function() {
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        $('preset_bizNo').value = preset.bizNo || '845-88-00551';
        $('preset_bizName').value = preset.bizName || '주식?�사 케?��?';
        $('preset_ceo').value = preset.ceo || '?�종';
        $('preset_address').value = preset.address || '?�울??강동�?구천면로 159, 1�?2?? 3??;
        $('preset_bizType').value = preset.bizType || '?�소�??��???;
        $('preset_bizItem').value = preset.bizItem || '건설?�재, ?�품??;
        
        new bootstrap.Modal(document.getElementById('companyPresetModal')).show();
    },
    
    saveCompanyPreset: function() {
        const preset = {
            bizNo: $('preset_bizNo').value,
            bizName: $('preset_bizName').value,
            ceo: $('preset_ceo').value,
            address: $('preset_address').value,
            bizType: $('preset_bizType').value,
            bizItem: $('preset_bizItem').value
        };
        localStorage.setItem('kng_company_preset', JSON.stringify(preset));
        bootstrap.Modal.getInstance(document.getElementById('companyPresetModal')).hide();
        alert('기본값이 ?�?�되?�습?�다.');
    },
    
    printHistoryDetail: function() {
        if (!this.currentHistoryDetail) return;
        
        const data = this.currentHistoryDetail;
        const printType = document.querySelector('input[name="printType"]:checked').value;
        const preset = JSON.parse(localStorage.getItem('kng_company_preset') || '{}');
        
        // Defaults if preset not set
        const bizNo = preset.bizNo || '845-88-00551';
        const bizName = preset.bizName || '주식?�사 케?��?';
        const ceo = preset.ceo || '?�종';
        const address = preset.address || '?�울??강동�?구천면로 159, 1�?2?? 3??;
        const bizType = preset.bizType || '?�소�??��???;
        const bizItem = preset.bizItem || '건설?�재, ?�품??;
        
        let printWindow = window.open('', '_blank');
        let htmlContent = `
            <html>
            <head>
                <title>?�쇄</title>
                <link href="https://fonts.googleapis.com/css2?family=Pretendard:wght@400;500;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Pretendard', 'Malgun Gothic', sans-serif; padding: 20px; color:#333; }
                    /* Common Styles */
                    * { box-sizing: border-box; }
                    @page { size: A4; margin: 15mm; }
                    .print-wrapper { max-width: 800px; margin: 0 auto; background: #fff; padding: 0; color:#212529; }
                    
                    /* Hybrid Header Styles */
                    .hybrid-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 15px; }
                    .header-left { flex: 1; padding-bottom: 5px; text-align: center; }
                    .title { font-size: 34px; font-weight: 700; color: #212529; margin: 0 0 25px 0; letter-spacing: 12px; text-decoration: underline; text-underline-offset: 8px; padding-left: 12px; }
                    .date-text { font-size: 15px; color: #495057; margin-bottom: 25px; text-align: center; }
                    .recipient-text { font-size: 18px; text-align: left; margin-left: 20px; }
                    .header-right { width: 420px; }
                    
                    .supplier-table { width: 100%; border-collapse: collapse; font-size: 13px; border: 2px solid #212529; }
                    .supplier-table th, .supplier-table td { border: 1px solid #dee2e6; padding: 6px 8px; }
                    .supplier-table th { background-color: #f8f9fa; color: #495057; text-align: center; font-weight: 600; }
                    .supplier-table td { color: #212529; }
                    .supplier-th { width: 30px; writing-mode: vertical-rl; text-orientation: upright; letter-spacing: 5px; padding: 10px 5px !important; }
                    .stamp-cell { position: relative; }
                    .stamp { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); width: 45px; height: 45px; opacity: 0.85; mix-blend-mode: multiply; }
                    
                    .amount-bar { display: flex; border: 2px solid #212529; border-bottom: none; align-items: stretch; font-size: 16px; }
                    .amount-label { width: 120px; background-color: #f8f9fa; display: flex; align-items: center; justify-content: center; font-weight: 600; border-right: 1px solid #dee2e6; letter-spacing: 10px; padding: 12px 0; }
                    .amount-ko { flex: 1; display: flex; align-items: center; justify-content: center; font-weight: 600; letter-spacing: 1px; }
                    .amount-num { width: 150px; display: flex; align-items: center; justify-content: flex-end; padding-right: 20px; font-weight: 700; font-size: 17px; }
                    
                    .hybrid-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 13px; border: 2px solid #212529; }
                    .hybrid-table th, .hybrid-table td { border: 1px solid #dee2e6; padding: 8px 6px; }
                    .hybrid-table th { background-color: #f8f9fa; font-weight: 600; color: #495057; text-align: center; border-bottom: 2px solid #212529; }
                    .hybrid-table td { height: 32px; }
                    .footer-row { background-color: #e9ecef; border-top: 2px solid #212529 !important; }
                    .footer-row td { color: #212529; padding: 10px 6px; font-size: 14px; }
                    .text-center { text-align: center !important; }
                    .text-right { text-align: right !important; }
                    
                    .signature-area { margin-top: 40px; text-align: right; font-size: 16px; font-weight: 600; }
                    
                    @media print {
                        body { padding: 0; margin: 0; }
                        .print-wrapper { max-width: 100%; width: 100%; padding: 0 !important; margin: 0; }
                        .supplier-table th, .amount-label, .hybrid-table th, .footer-row { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    }
                </style>
            </head>
            <body>
            <div class="print-wrapper">`;
            
        // 공통 공급???�보 HTML
        const supplierHtml = `
            <table class="supplier-table">
                <tr>
                    <th rowspan="4" class="supplier-th">공급??/th>
                    <th style="width: 25%">?�록번호</th>
                    <td colspan="3">${bizNo}</td>
                </tr>
                <tr>
                    <th>?�호</th>
                    <td style="width: 35%">${bizName}</td>
                    <th style="width: 15%">?�?�자</th>
                    <td class="stamp-cell">${ceo} <img src="../../assets/images/stamp.png" class="stamp" alt="직인" onerror="this.style.display='none'"></td>
                </tr>
                <tr>
                    <th>주소</th>
                    <td colspan="3">${address}</td>
                </tr>
                <tr>
                    <th>?�태</th>
                    <td>${bizType}</td>
                    <th>종목</th>
                    <td>${bizItem}</td>
                </tr>
            </table>`;
            
        const items = data.items || [data];
        
        if (printType === 'transaction_statement') {
            function numberToKorean(number) {
                const inputNumber = parseInt(number, 10);
                const hanA = ["", "??, "??, "??, "??, "??, "??, "�?, "??, "�?];
                const danA = ["", "??, "�?, "�?];
                const danG = ["", "�?, "??, "�?];
                let result = "";
                let numStr = inputNumber.toString();
                let length = numStr.length;
                for (let i = 0; i < length; i++) {
                    let n = parseInt(numStr.charAt(i));
                    let pos = length - i - 1;
                    if (n > 0) result += hanA[n] + danA[pos % 4];
                    if (pos % 4 === 0 && pos > 0) {
                        let chunk = numStr.substring(Math.max(0, i - 3), i + 1);
                        if (parseInt(chunk) > 0) result += danG[pos / 4];
                    }
                }
                return result + " ?�정";
            }
            
            let totalAmount = 0;
            let totalVat = 0;
            let totalSum = 0;
            let itemRowsHtml = "";
            
            items.forEach((item, idx) => {
                const itemQty = data.type === 'inbound' ? (item.qty_initial || item.qty) : item.qty;
                const price = data.type === 'inbound' ? item.unit_price : item.selling_price;
                const amount = price * itemQty;
                const vat = Math.floor(amount * 0.1);
                const total = amount + vat;
                
                totalAmount += amount;
                totalVat += vat;
                totalSum += total;
                
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${itemQty.toLocaleString()}</td>
                            <td class="text-right">${price.toLocaleString()}</td>
                            <td class="text-right">${amount.toLocaleString()}</td>
                            <td class="text-right">${vat.toLocaleString()}</td>
                            <td class="text-right">${total.toLocaleString()}</td>
                        </tr>`;
            });
            
            if (data.shipping_fee && data.shipping_fee > 0) {
                const isVatIncluded = data.shipping_fee_vat_included === 1;
                let shipAmount, shipVat, shipTotal;
                
                if (isVatIncluded) {
                    shipTotal = data.shipping_fee;
                    shipAmount = Math.round(shipTotal / 1.1);
                    shipVat = shipTotal - shipAmount;
                } else {
                    shipAmount = data.shipping_fee;
                    shipVat = Math.floor(shipAmount * 0.1);
                    shipTotal = shipAmount + shipVat;
                }
                
                totalAmount += shipAmount;
                totalVat += shipVat;
                totalSum += shipTotal;
                
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${items.length + 1}</td>
                            <td>배송�?/td>
                            <td class="text-center"></td>
                            <td class="text-center">�?/td>
                            <td class="text-right">1</td>
                            <td class="text-right">${shipAmount.toLocaleString()}</td>
                            <td class="text-right">${shipAmount.toLocaleString()}</td>
                            <td class="text-right">${shipVat.toLocaleString()}</td>
                            <td class="text-right">${shipTotal.toLocaleString()}</td>
                        </tr>`;
                
                // Add an empty item to items length so emptyRowsCount calculation is correct
                items.push({});
            }
            
            const koTotalAmount = numberToKorean(totalSum);
            const emptyRowsCount = Math.max(0, 12 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">�???�?????/h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.destination}</strong> 귀??/div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <div class="amount-bar">
                    <div class="amount-label">�???/div>
                    <div class="amount-ko">${koTotalAmount}</div>
                    <div class="amount-num">??${totalSum.toLocaleString()}</div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">?�번</th>
                            <th style="width: 25%">?�명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 8%">?�위</th>
                            <th style="width: 8%">?�량</th>
                            <th style="width: 10%">?��?</th>
                            <th style="width: 12%">금액</th>
                            <th style="width: 10%">부가??/th>
                            <th style="width: 12%">?�계금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- ?�하?�백 -</td>
                            <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                    <tfoot>
                        <tr class="footer-row">
                            <td colspan="6" class="text-center"><strong>�?/strong></td>
                            <td class="text-right"><strong>${totalAmount.toLocaleString()}</strong></td>
                            <td class="text-right"><strong>${totalVat.toLocaleString()}</strong></td>
                            <td class="text-right"><strong>${totalSum.toLocaleString()}</strong></td>
                        </tr>
                    </tfoot>
                </table>
                
                <div style="font-size:13px; color:#495057; text-align:right;">
                    ${data.note ? '비고: ' + data.note : ''}
                </div>
            `;
        } else if (printType === 'inbound_receipt') {
            let itemRowsHtml = "";
            items.forEach((item, idx) => {
                const itemQty = item.qty_initial || item.qty;
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${itemQty.toLocaleString()}</td>
                            <td class="text-center">${item.location_name || '-'}</td>
                            <td class="text-center">${item.note || ''}</td>
                        </tr>`;
            });
            const emptyRowsCount = Math.max(0, 13 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">??�???????/h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.supplier}</strong> 귀??/div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">?�번</th>
                            <th style="width: 30%">?�명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 10%">?�위</th>
                            <th style="width: 10%">?�량</th>
                            <th style="width: 15%">?�고창고</th>
                            <th style="width: 15%">비고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- ?�하?�백 -</td>
                            <td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                </table>
            `;
        } else if (printType === 'outbound_receipt') {
            let itemRowsHtml = "";
            items.forEach((item, idx) => {
                let lotsInfo = (item.consumed_lots || []).map(l => `${l.location_name}`).join(', ');
                itemRowsHtml += `
                        <tr>
                            <td class="text-center">${idx + 1}</td>
                            <td>${item.item}</td>
                            <td class="text-center">${item.spec}</td>
                            <td class="text-center">${item.unit}</td>
                            <td class="text-right">${item.qty.toLocaleString()}</td>
                            <td class="text-right">${item.shipping_fee.toLocaleString()}</td>
                            <td class="text-center">${lotsInfo}</td>
                        </tr>`;
            });
            const emptyRowsCount = Math.max(0, 13 - items.length);
            const emptyRows = Array(emptyRowsCount).fill('<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
            
            htmlContent += `
                <div class="hybrid-header">
                    <div class="header-left">
                        <h1 class="title">�?�???????/h1>
                        <div class="date-text">${data.date}</div>
                        <div class="recipient-text"><strong>${data.destination}</strong> 귀??/div>
                    </div>
                    <div class="header-right">
                        ${supplierHtml}
                    </div>
                </div>
                
                <table class="hybrid-table">
                    <thead>
                        <tr>
                            <th style="width: 5%">?�번</th>
                            <th style="width: 30%">?�명</th>
                            <th style="width: 15%">규격</th>
                            <th style="width: 10%">?�위</th>
                            <th style="width: 10%">?�량</th>
                            <th style="width: 15%">배송�?/th>
                            <th style="width: 15%">출고창고</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemRowsHtml}
                        <tr>
                            <td class="text-center"></td>
                            <td class="text-center">- ?�하?�백 -</td>
                            <td></td><td></td><td></td><td></td><td></td>
                        </tr>
                        ${emptyRows}
                    </tbody>
                </table>
                <div class="signature-area">
                    ?�수???�명 : _____________________ (??
                </div>
            `;
        }
        
        htmlContent += `
            </div>
            <script>
                window.onload = function() { window.print(); window.close(); }
            </script>
            </body>
            </html>
        `;
        
        printWindow.document.write(htmlContent);
        printWindow.document.close();
    },

    // ----------------------------------------
    // Edit Logic (?�정 로직)
    // ----------------------------------------
    openEditInbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/inbound/${id}`);
            
            $('editInboundId').value = data.id;
            $('edit_in_date').value = data.date;
            $('edit_in_supplier').value = data.supplier;
            $('edit_in_location').innerHTML = locations.map(l => `<option value="${l.id}" ${l.id === data.location_id ? 'selected' : ''}>${l.name}</option>`).join('');
            
            $('edit_in_item').value = data.item;
            $('edit_in_spec').value = data.spec;
            $('edit_in_unit').value = data.unit;
            $('edit_in_qty').value = data.qty_initial;
            $('edit_in_price').value = data.unit_price;
            $('edit_in_note').value = data.note || '';
            
            const consumed = data.qty_initial - data.qty_remaining;
            if (consumed > 0) {
                $('editInboundWarning').classList.remove('d-none');
                $('editInboundMinQty').innerText = consumed;
                $('edit_in_qty').min = consumed;
                $('edit_in_item').disabled = true;
                $('edit_in_item').readOnly = true;
                $('edit_in_item').classList.add('bg-light', 'text-muted');
                $('edit_in_spec').disabled = true;
                $('edit_in_spec').readOnly = true;
                $('edit_in_spec').classList.add('bg-light', 'text-muted');
                $('edit_in_unit').disabled = true;
                $('edit_in_unit').readOnly = true;
                $('edit_in_unit').classList.add('bg-light', 'text-muted');
            } else {
                $('editInboundWarning').classList.add('d-none');
                $('edit_in_qty').min = 0.01;
                $('edit_in_item').disabled = false;
                $('edit_in_item').readOnly = false;
                $('edit_in_item').classList.remove('bg-light', 'text-muted');
                $('edit_in_spec').disabled = false;
                $('edit_in_spec').readOnly = false;
                $('edit_in_spec').classList.remove('bg-light', 'text-muted');
                $('edit_in_unit').disabled = false;
                $('edit_in_unit').readOnly = false;
                $('edit_in_unit').classList.remove('bg-light', 'text-muted');
            }
            
            let modal = bootstrap.Modal.getInstance($('editInboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editInboundModal'));
            modal.show();
        } catch(err) {
            alert('?�고 ?�역??불러?�는???�패?�습?�다: ' + err.message);
        }
    },
    
    submitEditInbound: async function(e) {
        e.preventDefault();
        const id = $('editInboundId').value;
        const payload = {
            date: $('edit_in_date').value,
            supplier: $('edit_in_supplier').value,
            location_id: $('edit_in_location').value,
            item: $('edit_in_item').value,
            spec: $('edit_in_spec').value,
            unit: $('edit_in_unit').value,
            qty: parseFloat($('edit_in_qty').value),
            unit_price: parseFloat($('edit_in_price').value),
            note: $('edit_in_note').value
        };
        
        try {
            await authFetch(`${API_BASE}/inbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('?�고 ?�역???�정?�었?�니??');
            bootstrap.Modal.getInstance($('editInboundModal')).hide();
            this.loadHistory();
            if ($('drawerDetail').classList.contains('show') || !$('drawerDetail').classList.contains('d-none')) {
                this.renderDrawerDetail(id, 'inbound');
            }
        } catch(err) {
            alert('?�정 ?�패: ' + err.message);
        }
    },
    
    editOutboundState: { availableLots: [], consumedLots: [] },
    
    openEditOutbound: async function(id) {
        try {
            const data = await authFetch(`${API_BASE}/history/outbound/${id}`);
            const item = data.items ? (data.items.find(i => i.id == id) || data) : data;
            
            $('editOutboundId').value = item.id;
            $('edit_out_date').value = item.date;
            $('edit_out_destination').value = item.destination || item.party;
            $('edit_out_shipping').value = item.shipping_fee || 0;
            $('edit_out_shipping_vat').checked = item.shipping_fee_vat_included === 1;
            $('edit_out_note').value = item.note || '';
            
            $('edit_out_item').value = item.item;
            $('edit_out_spec').value = item.spec || '';
            $('edit_out_unit').value = item.unit || '';
            $('edit_out_qty').value = item.qty;
            $('edit_out_price').value = item.selling_price || item.price;
            
            // 기존 ?�당??Lot ?�보 ?�??            this.editOutboundState.consumedLots = (item.consumed_lots || []).map(l => ({
                inbound_id: l.inbound_id,
                consumed_qty: l.consumed_qty
            }));
            
            // ?�목???�당?�는 ?�체 ?�용 가???�고(Lot)�?백엔?�에??조회
            // 주의: ?�기 ?�신??차감?�던 ?�고?�도 복구???�태�?계산?�야 ?��?�?백엔?�에??받�? ?�여??+ ?��? 차감?�던 ??            const lots = await authFetch(`${API_BASE}/inventory/item/${encodeURIComponent(item.item)}`);
            
            // ?�재 차감??lot?�의 ?�량???�여?�에 ?�해??가?�의 "?�정 ??초기 ?�태" ?�여?�을 만듬
            this.editOutboundState.availableLots = lots.map(lot => {
                const consumed = this.editOutboundState.consumedLots.find(c => c.inbound_id === lot.id);
                if (consumed) {
                    lot.qty_remaining += consumed.consumed_qty;
                }
                return lot;
            });
            
            let modal = bootstrap.Modal.getInstance($('editOutboundModal'));
            if (!modal) modal = new bootstrap.Modal($('editOutboundModal'));
            modal.show();
            
            // ?�류 메시지 리셋
            $('editOutboundErrorMsg').style.display = 'none';
        } catch(err) {
            alert('출고 ?�역??불러?�는???�패?�습?�다: ' + err.message);
        }
    },
    
    openEditOutboundLotModal: function() {
        this.currentLotModalRowId = 'editOutbound';
        const itemName = $('edit_out_item').value;
        const specName = $('edit_out_spec').value;
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        
        $('lotModalItemTitle').innerText = `[${itemName} / ${specName}]`;
        $('lotModalReqQty').innerText = targetQty;
        
        const rData = this.editOutboundState;
        
        const tbody = $('lotModalTbody');
        tbody.innerHTML = rData.availableLots.map(lot => {
            const consumed = rData.consumedLots.find(c => c.inbound_id === lot.id);
            const val = consumed ? consumed.consumed_qty : 0;
            return `
            <tr>
                <td>${lot.date}</td>
                <td>${lot.location_name || '-'}</td>
                <td>${lot.supplier}</td>
                <td>${lot.unit_price.toLocaleString()}</td>
                <td><strong>${lot.qty_remaining}</strong></td>
                <td>
                    <input type="number" class="form-control form-control-sm lot-qty-modal-input mx-auto" 
                           data-id="${lot.id}"
                           min="0" max="${lot.qty_remaining}" step="0.01" value="${val}"
                           onchange="app.validateLotModalSum()" onkeyup="app.validateLotModalSum()">
                </td>
            </tr>
            `;
        }).join('');
        
        this.validateLotModalSum();
        
        let modal = bootstrap.Modal.getInstance($('lotModal'));
        if (!modal) modal = new bootstrap.Modal($('lotModal'));
        modal.show();
    },
    
    submitEditOutbound: async function(e) {
        e.preventDefault();
        
        const targetQty = parseFloat($('edit_out_qty').value) || 0;
        const sumLots = this.editOutboundState.consumedLots.reduce((acc, cur) => acc + cur.consumed_qty, 0);
        
        if (Math.abs(sumLots - targetQty) > 0.0001) {
            $('editOutboundErrorMsg').style.display = 'block';
            return;
        }
        
        const id = $('editOutboundId').value;
        const payload = {
            date: $('edit_out_date').value,
            destination: $('edit_out_destination').value,
            item: $('edit_out_item').value,
            spec: $('edit_out_spec').value,
            unit: $('edit_out_unit').value,
            qty: targetQty,
            selling_price: parseFloat($('edit_out_price').value) || 0,
            shipping_fee: parseFloat($('edit_out_shipping').value) || 0,
            note: $('edit_out_note').value,
            consumed_lots: this.editOutboundState.consumedLots
        };
        
        try {
            await authFetch(`${API_BASE}/outbound/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            alert('출고 ?�역???�정?�었?�니??');
            bootstrap.Modal.getInstance($('editOutboundModal')).hide();
            this.loadHistory();
            if ($('drawerDetail').classList.contains('show') || !$('drawerDetail').classList.contains('d-none')) {
                this.renderDrawerDetail(id, 'outbound');
            }
        } catch(err) {
            alert('?�정 ?�패: ' + err.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

