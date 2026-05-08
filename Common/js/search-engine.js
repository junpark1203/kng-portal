/**
 * Common Search & Pagination Engine
 * 
 * Provides reusable logic for multi-condition search (AND/OR),
 * highlighting, filter chips, and pagination UI across various modules.
 */

const KngSearchEngine = (function() {
    // --- Helpers ---
    function escapeRegex(s) { 
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
    }

    function highlightText(text, queries) {
        if (!text || !queries || queries.length === 0) return text;
        let result = String(text);
        queries.forEach(q => {
            if (!q) return;
            const regex = new RegExp(`(${escapeRegex(q)})`, 'gi');
            result = result.replace(regex, '<mark class="si-highlight">$1</mark>');
        });
        return result;
    }

    /**
     * @param {Object} item - Data row
     * @param {string} field - Search field
     * @param {string} query - Search text
     * @param {Array<string>} defaultAllFields - Fields to search when field is 'all'
     */
    function matchesCondition(item, field, query, defaultAllFields) {
        if (!query) return true;
        const q = query.toLowerCase();
        if (field === 'all') {
            const fields = defaultAllFields || Object.keys(item);
            return fields.some(f => {
                const val = item[f];
                return val && String(val).toLowerCase().includes(q);
            });
        }
        const val = item[field];
        return val && String(val).toLowerCase().includes(q);
    }

    function matchesGroupConditions(group, filters, isGrouped, defaultAllFields) {
        if (!filters || filters.length === 0) return true;
        const items = (isGrouped && group.isVirtualParent) ? group.children : [group];
        // Check if ANY item in the group matches the filter chain
        return items.some(item => {
            let result = matchesCondition(item, filters[0].field, filters[0].query, defaultAllFields);
            for (let i = 1; i < filters.length; i++) {
                const f = filters[i];
                const match = matchesCondition(item, f.field, f.query, defaultAllFields);
                if (f.logic === 'AND') result = result && match;
                else result = result || match;
            }
            return result;
        });
    }

    function paginateData(dataArray, page, pageSize) {
        if (pageSize <= 0) return { pageData: dataArray, totalItems: dataArray.length, totalPages: 1, currentPage: 1 };
        const totalItems = dataArray.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const safePage = Math.min(Math.max(1, page), totalPages);
        const start = (safePage - 1) * pageSize;
        const end = start + pageSize;
        return { pageData: dataArray.slice(start, end), totalItems, totalPages, currentPage: safePage };
    }

    function renderPaginationHTML(containerId, totalItems, totalPages, currentPage, pageSize, onPageChange, onPageSizeChange) {
        const container = document.getElementById(containerId);
        if (!container) return;
        if (totalItems === 0) { container.innerHTML = ''; return; }
        const startItem = (currentPage - 1) * pageSize + 1;
        const endItem = Math.min(currentPage * pageSize, totalItems);

        let pagesHtml = '';
        pagesHtml += `<button class="si-page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;
        const maxVisible = 5;
        let startP = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endP = Math.min(totalPages, startP + maxVisible - 1);
        if (endP - startP < maxVisible - 1) startP = Math.max(1, endP - maxVisible + 1);
        if (startP > 1) { pagesHtml += `<button class="si-page-btn" data-page="1">1</button>`; if (startP > 2) pagesHtml += `<span class="si-page-ellipsis">…</span>`; }
        for (let p = startP; p <= endP; p++) {
            pagesHtml += `<button class="si-page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
        }
        if (endP < totalPages) { if (endP < totalPages - 1) pagesHtml += `<span class="si-page-ellipsis">…</span>`; pagesHtml += `<button class="si-page-btn" data-page="${totalPages}">${totalPages}</button>`; }
        pagesHtml += `<button class="si-page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;

        container.innerHTML = `
            <div class="si-pagination-info">전체 <strong>${totalItems}</strong>건 중 <strong>${startItem}-${endItem}</strong>건 표시</div>
            <div class="si-pagination-pages">${pagesHtml}</div>
            <div class="si-pagination-size">페이지당 <select class="si-page-size-select">
                ${[10,30,50,100,0].map(s => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s === 0 ? '전체' : s}</option>`).join('')}
            </select>건</div>
        `;

        container.querySelectorAll('.si-page-btn:not(:disabled)').forEach(btn => {
            btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page)));
        });
        container.querySelector('.si-page-size-select')?.addEventListener('change', (e) => {
            onPageSizeChange(parseInt(e.target.value));
        });
    }

    // --- Search Bar Logic ---
    function getConditionsFromBar(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return [];
        const rows = container.querySelectorAll('.si-condition-row');
        const conditions = [];
        rows.forEach((row, idx) => {
            const field = row.querySelector('[data-role="field"]')?.value || 'all';
            const query = row.querySelector('[data-role="query"]')?.value?.trim() || '';
            const logicBtn = row.querySelector('.si-logic-toggle');
            const logic = idx === 0 ? 'AND' : (logicBtn?.textContent || 'AND');
            if (query) conditions.push({ field, query, logic });
        });
        return conditions;
    }

    function addConditionRow(containerId, fieldOptions, onSearchExecute) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'si-condition-row';
        const optionsHtml = fieldOptions.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
        row.innerHTML = `
            <button type="button" class="si-logic-toggle">AND</button>
            <select class="si-field-select" data-role="field">${optionsHtml}</select>
            <input type="text" class="si-search-input" data-role="query" placeholder="검색어 입력...">
            <button type="button" class="si-btn-remove-row"><i class="fa-solid fa-xmark"></i></button>
        `;
        row.querySelector('.si-logic-toggle').addEventListener('click', (e) => {
            e.target.textContent = e.target.textContent === 'AND' ? 'OR' : 'AND';
        });
        row.querySelector('.si-btn-remove-row').addEventListener('click', () => row.remove());
        // Enter key triggers search
        row.querySelector('.si-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (onSearchExecute) onSearchExecute();
                else container.closest('.si-search-bar')?.querySelector('.si-btn-search')?.click();
            }
        });
        container.appendChild(row);
    }

    function renderFilterChips(chipsContainerId, filters, labels, onRemove) {
        const container = document.getElementById(chipsContainerId);
        if (!container) return;
        if (!filters || filters.length === 0) { container.innerHTML = ''; return; }
        let html = '';
        filters.forEach((f, idx) => {
            if (idx > 0) html += `<span class="si-chip-logic">${f.logic}</span>`;
            html += `<span class="si-chip">${labels[f.field] || f.field}: ${f.query} <button class="si-chip-remove" data-idx="${idx}"><i class="fa-solid fa-xmark"></i></button></span>`;
        });
        container.innerHTML = html;
        container.querySelectorAll('.si-chip-remove').forEach(btn => {
            btn.addEventListener('click', () => onRemove(parseInt(btn.dataset.idx)));
        });
    }

    return {
        escapeRegex,
        highlightText,
        matchesCondition,
        matchesGroupConditions,
        paginateData,
        renderPaginationHTML,
        getConditionsFromBar,
        addConditionRow,
        renderFilterChips
    };
})();
