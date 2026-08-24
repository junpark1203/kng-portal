import sys

with open('routes/logistics.js', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find("router.post('/direct', (req, res) => {")
if idx == -1:
    print('Pattern not found')
    sys.exit(1)

routes_to_insert = """
// --- 직출고 엑셀 템플릿 다운로드 ---
router.get('/direct/template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('직출고 일괄등록');

        worksheet.columns = [
            { header: '거래일자 (YYYY-MM-DD)', key: 'date', width: 20 },
            { header: '매입처(공급처)', key: 'supplier', width: 20 },
            { header: '매출처(납품처)', key: 'destination', width: 20 },
            { header: '실출고처(현장명)', key: 'actual_destination', width: 25 },
            { header: '품목명', key: 'item', width: 20 },
            { header: '규격', key: 'spec', width: 15 },
            { header: '단위', key: 'unit', width: 10 },
            { header: '수량', key: 'qty', width: 10 },
            { header: '매입단가', key: 'in_price', width: 15 },
            { header: '매출단가', key: 'out_price', width: 15 },
            { header: '총 배송비', key: 'shipping_fee', width: 15 },
            { header: '배송비 부가세 포함(Y/N)', key: 'shipping_vat', width: 25 },
            { header: '비고', key: 'note', width: 30 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="direct_outbound_template.xlsx"');
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Error generating template:', err);
        res.status(500).json({ error: 'Failed to generate template' });
    }
});

// --- 직출고 엑셀 업로드 ---
router.post('/direct/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.worksheets[0];

        const rows = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header
            
            const getVal = (col) => {
                let v = row.getCell(col).value;
                if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
                if (v && typeof v === 'object' && v.text !== undefined) v = v.text;
                if (v instanceof Date) {
                    const offset = v.getTimezoneOffset() * 60000;
                    const localDate = new Date(v.getTime() - offset);
                    return localDate.toISOString().split('T')[0];
                }
                return v !== null && v !== undefined ? String(v).trim() : '';
            };

            const date = getVal(1);
            const supplier = getVal(2);
            const destination = getVal(3);
            const actual_destination = getVal(4);
            const item = getVal(5);
            const spec = getVal(6);
            const unit = getVal(7);
            const qty = parseFloat(getVal(8)) || 0;
            const in_price = parseFloat(getVal(9)) || 0;
            const out_price = parseFloat(getVal(10)) || 0;
            const shipping_fee = parseFloat(getVal(11)) || 0;
            const shipping_vat_raw = getVal(12).toUpperCase();
            const shipping_vat = (shipping_vat_raw === 'Y' || shipping_vat_raw === '1' || shipping_vat_raw === 'TRUE') ? 1 : 0;
            const note = getVal(13);

            if (!date || !supplier || !destination || !item || qty <= 0 || in_price < 0) {
                return; // Skip invalid rows
            }

            rows.push({
                date, supplier, destination, actual_destination, item, spec, unit, qty, in_price, out_price, shipping_fee, shipping_vat, note
            });
        });

        if (rows.length === 0) {
            return res.status(400).json({ error: 'No valid data found in excel' });
        }

        const grouped = {};
        for (const r of rows) {
            const key = \\|\|\|\|\|\|\\;
            if (!grouped[key]) {
                grouped[key] = {
                    date: r.date,
                    supplier: r.supplier,
                    destination: r.destination,
                    actual_destination: r.actual_destination,
                    shipping_fee: r.shipping_fee,
                    shipping_fee_vat_included: r.shipping_vat,
                    note: r.note,
                    items: []
                };
            }
            grouped[key].items.push({
                item: r.item,
                spec: r.spec,
                unit: r.unit,
                qty: r.qty,
                in_price: r.in_price,
                out_price: r.out_price
            });
        }

        const groups = Object.values(grouped);

        for (const g of groups) {
            await new Promise((resolve, reject) => {
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    let hasError = false;

                    const processItem = (idx) => {
                        if (hasError) return;
                        if (idx >= g.items.length) {
                            db.run("COMMIT", (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                            return;
                        }

                        const currentItem = g.items[idx];
                        db.run(\
                            INSERT INTO logistics_inbound (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, is_direct)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)
                        \, [g.date, g.supplier, currentItem.item, currentItem.spec, currentItem.unit, currentItem.qty, 0, currentItem.in_price, g.note], function(err) {
                            if (err) {
                                hasError = true;
                                db.run("ROLLBACK");
                                return reject(err);
                            }
                            const inboundId = this.lastID;

                            const itemShipping = idx === 0 ? g.shipping_fee : 0;
                            const itemShippingVat = idx === 0 ? g.shipping_fee_vat_included : 0;

                            db.run(\
                                INSERT INTO logistics_outbound (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, is_direct)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                            \, [g.date, g.destination, g.actual_destination, currentItem.item, currentItem.spec, currentItem.unit, currentItem.qty, currentItem.out_price, itemShipping, itemShippingVat, g.note], function(err) {
                                if (err) {
                                    hasError = true;
                                    db.run("ROLLBACK");
                                    return reject(err);
                                }
                                const outboundId = this.lastID;

                                db.run(\
                                    INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, qty)
                                    VALUES (?, ?, ?)
                                \, [outboundId, inboundId, currentItem.qty], function(err) {
                                    if (err) {
                                        hasError = true;
                                        db.run("ROLLBACK");
                                        return reject(err);
                                    }
                                    processItem(idx + 1);
                                });
                            });
                        });
                    };

                    processItem(0);
                });
            });
        }

        res.json({ success: true, count: rows.length });
    } catch (err) {
        console.error('Excel upload error:', err);
        res.status(500).json({ error: 'Failed to process excel file', details: err.message });
    }
});

"""

new_content = content[:idx] + routes_to_insert + content[idx:]

with open('routes/logistics.js', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Success')
