const fs = require('fs');

// ========== PATCH app.js ==========
let app = fs.readFileSync('app.js', 'utf8');

// 1. Fix default VAT chip to always checked (true) in OUT mode, not linked to viewWithVat
app = app.replace(
  "if(sellVatCb) sellVatCb.checked = viewWithVat;\n    }\n}",
  "if(sellVatCb) sellVatCb.checked = true;\n    }\n}"
);
app = app.replace(
  "if(sellVatCb) sellVatCb.checked = viewWithVat;\r\n    }\r\n}",
  "if(sellVatCb) sellVatCb.checked = true;\r\n    }\r\n}"
);


// 2. In OUT toggleFormMode, also show outBuyPriceCol/outMarginCol and hide them in IN mode
// IN mode: hide the OUT-only fields
app = app.replace(
  "var sellVatChip = document.getElementById('sellVatChipWrap');\r\n        if(sellVatChip) sellVatChip.classList.add('hidden');",
  "var sellVatChip = document.getElementById('sellVatChipWrap');\r\n        if(sellVatChip) sellVatChip.classList.add('hidden');\r\n        var outBuyPriceCol = document.getElementById('outBuyPriceCol');\r\n        if(outBuyPriceCol) outBuyPriceCol.classList.add('hidden');\r\n        var outMarginCol = document.getElementById('outMarginCol');\r\n        if(outMarginCol) outMarginCol.classList.add('hidden');"
);

// OUT mode: show the OUT-only fields
app = app.replace(
  "var sellVatChip = document.getElementById('sellVatChipWrap');\r\n        if(sellVatChip) sellVatChip.classList.remove('hidden');",
  "var sellVatChip = document.getElementById('sellVatChipWrap');\r\n        if(sellVatChip) sellVatChip.classList.remove('hidden');\r\n        var outBuyPriceCol = document.getElementById('outBuyPriceCol');\r\n        if(outBuyPriceCol) outBuyPriceCol.classList.remove('hidden');\r\n        var outMarginCol = document.getElementById('outMarginCol');\r\n        if(outMarginCol) outMarginCol.classList.remove('hidden');"
);

// 3. In outbound product selection, also fill buyPrice and trigger margin calc
app = app.replace(
  "document.getElementById('txPrice').value = sp.sellPrice;\r\n                }\r\n                closeAllLists();",
  "document.getElementById('txPrice').value = sp.sellPrice;\r\n                    // \uB9E4\uC785\uB2E8\uAC00 \uC790\uB3D9 \uD45C\uC2DC \uBC0F \uB9C8\uC9C4\uC728 \uACC4\uC0B0\r\n                    document.getElementById('outBuyPrice').value = sp.buyPrice || 0;\r\n                    calcOutMargin();\r\n                }\r\n                closeAllLists();"
);

// 4. Add calcOutMargin function and txPrice listener after updateTxPrice function
app = app.replace(
  "document.getElementById('txBasePrice').addEventListener('input', updateTxPrice);",
  `// \uCD9C\uACE0 \uB9C8\uC9C4\uC728 \uC790\uB3D9\uACC4\uC0B0
function calcOutMargin() {
    var sellRaw = parseInt(document.getElementById('txPrice').value, 10) || 0;
    var buyRaw = parseInt(document.getElementById('outBuyPrice').value, 10) || 0;
    var marginDisplay = document.getElementById('outMarginRate');
    if (!marginDisplay) return;
    
    if (sellRaw <= 0 || buyRaw <= 0) {
        marginDisplay.value = '';
        marginDisplay.placeholder = '-';
        return;
    }
    
    // \uC21C\uC218\uAC00 \uBCC0\uD658: \uB9E4\uCD9C\uB2E8\uAC00 VAT\uD3EC\uD568 \uCCB4\uD06C \uC2DC \uC21C\uC218\uAC00\uB85C
    var isSellVatIncl = document.getElementById('txSellVat') ? document.getElementById('txSellVat').checked : false;
    var pureSell = isSellVatIncl ? Math.round(sellRaw / 1.1) : sellRaw;
    // \uB9E4\uC785\uB2E8\uAC00\uB294 \uD56D\uC0C1 \uC21C\uC218\uAC00\uB85C \uC800\uC7A5\uB418\uC5B4 \uC788\uC74C
    var pureBuy = buyRaw;
    
    var margin = ((pureSell - pureBuy) / pureSell * 100).toFixed(1);
    marginDisplay.value = margin + '%';
}

// \uB9E4\uCD9C\uB2E8\uAC00 \uC785\uB825 \uC2DC \uB9C8\uC9C4\uC728 \uC790\uB3D9\uACC4\uC0B0
document.getElementById('txPrice').addEventListener('input', calcOutMargin);
// VAT \uCE69 \uBCC0\uACBD \uC2DC \uB9C8\uC9C4\uC728 \uC7AC\uACC4\uC0B0
document.getElementById('txSellVat').addEventListener('change', calcOutMargin);

document.getElementById('txBasePrice').addEventListener('input', updateTxPrice);`
);

// 5. In form submit, calculate and save margin for OUT transactions
// First, add margin calculation before txDate
app = app.replace(
  "    var txDate = document.getElementById('txDate').value;\r\n    var remarks = document.getElementById('txRemarks').value.trim();\r\n    var type = document.querySelector('input[name=\"txType\"]:checked').value;",
  "    // \uCD9C\uACE0 \uC2DC \uB9C8\uC9C4\uC728 \uACC4\uC0B0\r\n    var outMarginRate = null;\r\n    var outBuyPriceVal = parseInt(document.getElementById('outBuyPrice').value, 10) || 0;\r\n    if (txType === 'OUT' && price > 0 && outBuyPriceVal > 0) {\r\n        var pureSellForMargin = isSellVatIncluded ? Math.round(Math.round(priceRaw / 1.1)) : price;\r\n        outMarginRate = parseFloat(((pureSellForMargin - outBuyPriceVal) / pureSellForMargin * 100).toFixed(1));\r\n    }\r\n    \r\n    var txDate = document.getElementById('txDate').value;\r\n    var remarks = document.getElementById('txRemarks').value.trim();\r\n    var type = document.querySelector('input[name=\"txType\"]:checked').value;"
);

// 6. Add margin to transaction log
app = app.replace(
  "                buyPrice: buyPriceForLog,\r\n                txDate: txDate,",
  "                buyPrice: buyPriceForLog,\r\n                margin: outMarginRate,\r\n                txDate: txDate,"
);

fs.writeFileSync('app.js', app, 'utf8');

// ========== PATCH index.html ==========
let html = fs.readFileSync('index.html', 'utf8');


const targetToReplace = \`<label class="vat-chip hidden" id="sellVatChipWrap"><input type="checkbox" id="txSellVat" checked><span>VAT\uD3EC\uD568</span></label></div></div>\r\n                            </div>\`;
const replacementHTML = \`<label class="vat-chip hidden" id="sellVatChipWrap"><input type="checkbox" id="txSellVat" checked><span>VAT\uD3EC\uD568</span></label></div></div>\r\n                                <div class="fg hidden" id="outBuyPriceCol"><label for="outBuyPrice">\uB9E4\uC785\uB2E8\uAC00</label><input type="number" id="outBuyPrice" readonly class="readonly-input" placeholder="\uC0C1\uD488 \uC120\uD0DD \uC2DC \uC790\uB3D9\uD45C\uC2DC"></div>\r\n                                <div class="fg hidden" id="outMarginCol"><label for="outMarginRate">\uB9C8\uC9C4\uC728</label><input type="text" id="outMarginRate" readonly class="readonly-input" placeholder="-"></div>\r\n                            </div>\`;


// Add outBuyPriceCol and outMarginCol to Row 3 (after the txPrice div, before closing </div> of fr-row3)
html = html.replace(targetToReplace, replacementHTML);

// Fallback in case line endings are different
if(html.indexOf("outBuyPriceCol") === -1) {
  html = html.replace(
    /<label class="vat-chip hidden" id="sellVatChipWrap"><input type="checkbox" id="txSellVat" checked><span>VAT\uD3EC\uD568<\/span><\/label><\/div><\/div>\r?\n\s*<\/div>/,
    `<label class="vat-chip hidden" id="sellVatChipWrap"><input type="checkbox" id="txSellVat" checked><span>VAT\uD3EC\uD568</span></label></div></div>
                                  <div class="fg hidden" id="outBuyPriceCol"><label for="outBuyPrice">\uB9E4\uC785\uB2E8\uAC00</label><input type="number" id="outBuyPrice" readonly class="readonly-input" placeholder="\uC0C1\uD488 \uC120\uD0DD \uC2DC \uC790\uB3D9\uD45C\uC2DC"></div>
                                  <div class="fg hidden" id="outMarginCol"><label for="outMarginRate">\uB9C8\uC9C4\uC728</label><input type="text" id="outMarginRate" readonly class="readonly-input" placeholder="-"></div>
                              </div>`
  );
}

fs.writeFileSync('index.html', html, 'utf8');

// Verify
const appResult = fs.readFileSync('app.js', 'utf8');
const htmlResult = fs.readFileSync('index.html', 'utf8');
const appLines = appResult.split('\\n').length;
const htmlLines = htmlResult.split('\\n').length;
const marginMatches = (appResult.match(/outMarginRate|calcOutMargin|outBuyPrice/g) || []).length;
console.log(\`app.js: \${appLines} lines, margin refs: \${marginMatches}\`);
console.log(\`index.html: \${htmlLines} lines\`);
console.log(\`outBuyPriceCol in html: \${htmlResult.includes('outBuyPriceCol')}\`);
