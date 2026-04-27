/* ========================================
   SmartStore — Option Builder v2
   Toggle, Dynamic Rows, Combination Table,
   Inline Edit, Bulk Apply
   ======================================== */

var optionEnabled = false;
var optionCombinations = []; // [{values:['블랙','M'], price:0, stock:0}, ...]

function initOptionBuilder() {
    var btnOn = document.getElementById('btnOptionOn');
    var btnOff = document.getElementById('btnOptionOff');

    if (btnOn) btnOn.addEventListener('click', function() {
        optionEnabled = true;
        btnOn.classList.add('active');
        btnOff.classList.remove('active');
        document.getElementById('optionBuilderSection').classList.remove('hidden');
        document.getElementById('noOptionSection').classList.add('hidden');
        if (document.getElementById('optionRows').children.length === 0) addOptionRow();
    });

    if (btnOff) btnOff.addEventListener('click', function() {
        optionEnabled = false;
        btnOff.classList.add('active');
        btnOn.classList.remove('active');
        document.getElementById('optionBuilderSection').classList.add('hidden');
        document.getElementById('noOptionSection').classList.remove('hidden');
    });

    var applyBtn = document.getElementById('btnApplyOptions');
    if (applyBtn) applyBtn.addEventListener('click', applyOptionCombinations);

    var bulkStockBtn = document.getElementById('btnBulkStock');
    if (bulkStockBtn) bulkStockBtn.addEventListener('click', function() {
        var val = parseInt(document.getElementById('bulkStock').value) || 0;
        optionCombinations.forEach(function(c) { c.stock = val; });
        renderOptionTable();
    });

    var bulkPriceBtn = document.getElementById('btnBulkPrice');
    if (bulkPriceBtn) bulkPriceBtn.addEventListener('click', function() {
        var val = parseInt(document.getElementById('bulkPrice').value) || 0;
        optionCombinations.forEach(function(c) { c.price = val; });
        renderOptionTable();
    });
}

function addOptionRow() {
    var container = document.getElementById('optionRows');
    var count = container.querySelectorAll('.option-row').length;

    // Add labels if first row
    if (count === 0) {
        var labels = document.createElement('div');
        labels.className = 'option-row-labels';
        labels.innerHTML = '<span>옵션명</span><span>옵션값 (콤마로 구분)</span>';
        container.appendChild(labels);
    }

    var row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = '<input type="text" class="option-name-input" placeholder="옵션명 (예: 컬러)">' +
        '<input type="text" class="option-values-input" placeholder="옵션값을 콤마(,)로 구분하여 입력">' +
        '<button class="btn-icon btn-add-inline" title="새 옵션 추가"><i class="bx bx-plus"></i></button>' +
        '<button class="btn-icon btn-remove-inline" title="삭제" tabindex="-1"><i class="bx bx-x"></i></button>';
    container.appendChild(row);

    // 새 옵션 추가 이벤트 (엔터 및 클릭)
    row.querySelector('.btn-add-inline').addEventListener('click', function(e) {
        e.preventDefault();
        if (container.querySelectorAll('.option-row').length < 3) {
            addOptionRow();
            var rows = container.querySelectorAll('.option-row');
            if(rows.length > 0) {
                rows[rows.length-1].querySelector('.option-name-input').focus();
            }
        }
    });

    // 삭제 이벤트
    row.querySelector('.btn-remove-inline').addEventListener('click', function(e) {
        e.preventDefault();
        row.remove();
        var remaining = container.querySelectorAll('.option-row');
        if (remaining.length === 0) {
            var labelsEl = container.querySelector('.option-row-labels');
            if (labelsEl) labelsEl.remove();
        }
        updateInlineAddButtons();
    });

    updateInlineAddButtons();
}

function updateInlineAddButtons() {
    var container = document.getElementById('optionRows');
    var rows = container.querySelectorAll('.option-row');
    var addBtns = container.querySelectorAll('.btn-add-inline');
    if (rows.length >= 3) {
        addBtns.forEach(function(btn) { btn.classList.add('hidden'); });
    } else {
        addBtns.forEach(function(btn) { btn.classList.remove('hidden'); });
    }
}

function applyOptionCombinations() {
    var rows = document.querySelectorAll('#optionRows .option-row');
    var optionNames = [];
    var optionValues = [];

    rows.forEach(function(row) {
        var name = row.querySelector('.option-name-input').value.trim();
        var vals = row.querySelector('.option-values-input').value.trim();
        if (name && vals) {
            optionNames.push(name);
            var valArr = vals.split(',').map(function(v) { return v.trim(); }).filter(Boolean);

            // Sort if 가나다순
            var sort = document.getElementById('fldOptionSort').value;
            if (sort === '가나다순') valArr.sort();

            optionValues.push(valArr);
        }
    });

    if (optionNames.length === 0) {
        showToast('옵션명과 옵션값을 입력해주세요.', 'warning');
        return;
    }

    // Generate Cartesian product
    var combinations = cartesianProduct(optionValues);
    optionCombinations = combinations.map(function(combo) {
        var vals = Array.isArray(combo) ? combo : [combo];
        // Preserve existing values if option matches
        var existing = findExistingCombo(vals);
        return {
            values: vals,
            price: existing ? existing.price : 0,
            stock: existing ? existing.stock : 0
        };
    });

    // Store option metadata
    if (currentProduct) {
        currentProduct.optionType = '조합형';
        currentProduct.optionNames = optionNames;
        currentProduct.optionValues = optionValues;
    }

    renderOptionTable();
    document.getElementById('optionTableWrap').classList.remove('hidden');
    document.getElementById('optionCombCount').textContent = optionCombinations.length;
    showToast(optionCombinations.length + '개 옵션 조합이 생성되었습니다.', 'success');
}

function findExistingCombo(vals) {
    return optionCombinations.find(function(c) {
        return c.values.join('|') === vals.join('|');
    });
}

function cartesianProduct(arrays) {
    if (arrays.length === 0) return [];
    if (arrays.length === 1) return arrays[0].map(function(v) { return [v]; });
    return arrays.reduce(function(acc, arr) {
        var result = [];
        acc.forEach(function(a) {
            arr.forEach(function(b) {
                result.push((Array.isArray(a) ? a : [a]).concat(b));
            });
        });
        return result;
    });
}

function renderOptionTable() {
    if (!currentProduct || !currentProduct.optionNames) return;
    var names = currentProduct.optionNames;
    var thead = document.getElementById('optionCombHead');
    var tbody = document.getElementById('optionCombBody');

    // Header
    var headerHtml = '<tr>';
    names.forEach(function(n) { headerHtml += '<th>' + n + '</th>'; });
    headerHtml += '<th>옵션가 (+원)</th><th>재고수량</th></tr>';
    thead.innerHTML = headerHtml;

    // Body
    var bodyHtml = '';
    optionCombinations.forEach(function(combo, idx) {
        bodyHtml += '<tr>';
        combo.values.forEach(function(v) {
            bodyHtml += '<td>' + v + '</td>';
        });
        bodyHtml += '<td class="editable" data-idx="' + idx + '" data-field="price">' +
            (combo.price > 0 ? '+' + formatCurrency(combo.price) : '0') + '</td>';
        bodyHtml += '<td class="editable" data-idx="' + idx + '" data-field="stock">' +
            formatCurrency(combo.stock) + '</td>';
        bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;

    // Inline edit - double click
    tbody.querySelectorAll('td.editable').forEach(function(td) {
        td.addEventListener('dblclick', function() {
            startInlineEdit(td);
        });
    });

    document.getElementById('optionCombCount').textContent = optionCombinations.length;
}

function startInlineEdit(td) {
    if (td.querySelector('input')) return; // already editing
    var idx = parseInt(td.dataset.idx);
    var field = td.dataset.field;
    var currentVal = optionCombinations[idx][field];

    var input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = currentVal;
    td.textContent = '';
    td.appendChild(input);
    input.focus();
    input.select();

    function commit() {
        var newVal = parseInt(input.value) || 0;
        optionCombinations[idx][field] = newVal;
        if (field === 'price') {
            td.textContent = newVal > 0 ? '+' + formatCurrency(newVal) : '0';
        } else {
            td.textContent = formatCurrency(newVal);
        }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { commit(); input.blur(); }
        if (e.key === 'Escape') {
            if (field === 'price') {
                td.textContent = currentVal > 0 ? '+' + formatCurrency(currentVal) : '0';
            } else {
                td.textContent = formatCurrency(currentVal);
            }
        }
    });
}

// Collect option data for product save
function collectOptionData() {
    if (!optionEnabled) {
        return {
            optionType: '',
            optionNames: [],
            optionValues: [],
            combinations: [],
            stock: parseInt(document.getElementById('fldNoOptionStock').value) || 0
        };
    }
    return {
        optionType: '조합형',
        optionNames: currentProduct ? (currentProduct.optionNames || []) : [],
        optionValues: currentProduct ? (currentProduct.optionValues || []) : [],
        combinations: optionCombinations,
        stock: 0
    };
}

// Restore option state from loaded product
function restoreOptionState(product) {
    if (product.optionType && product.optionNames && product.optionNames.length > 0) {
        optionEnabled = true;
        document.getElementById('btnOptionOn').classList.add('active');
        document.getElementById('btnOptionOff').classList.remove('active');
        document.getElementById('optionBuilderSection').classList.remove('hidden');
        document.getElementById('noOptionSection').classList.add('hidden');

        // Rebuild option rows
        var container = document.getElementById('optionRows');
        container.innerHTML = '';
        product.optionNames.forEach(function(name, i) {
            addOptionRow();
            var rows = container.querySelectorAll('.option-row');
            var lastRow = rows[rows.length - 1];
            lastRow.querySelector('.option-name-input').value = name;
            lastRow.querySelector('.option-values-input').value = (product.optionValues[i] || []).join(',');
        });

        if (product.combinations && product.combinations.length > 0) {
            optionCombinations = product.combinations;
            renderOptionTable();
            document.getElementById('optionTableWrap').classList.remove('hidden');
        }
    } else {
        optionEnabled = false;
        document.getElementById('btnOptionOff').classList.add('active');
        document.getElementById('btnOptionOn').classList.remove('active');
        document.getElementById('optionBuilderSection').classList.add('hidden');
        document.getElementById('noOptionSection').classList.remove('hidden');
        document.getElementById('fldNoOptionStock').value = product.stock || 0;
    }
}
