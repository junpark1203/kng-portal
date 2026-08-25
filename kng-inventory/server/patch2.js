const fs = require('fs');
let code = fs.readFileSync('routes/logistics.js', 'utf8');

// 1. GET /history
code = code.replace(
    /i\.is_direct\n            FROM logistics_inbound i/g,
    'i.is_direct, i.settlement_status, i.tax_invoice_date, i.is_zero_tax\n            FROM logistics_inbound i'
);
code = code.replace(
    /o\.is_direct\n            FROM logistics_outbound o/g,
    'o.is_direct, o.settlement_status, o.tax_invoice_date, o.is_zero_tax\n            FROM logistics_outbound o'
);

// 2. PUT /inbound/:id
code = code.replace(
    /db\.get\(\`SELECT qty_initial, qty_remaining FROM logistics_inbound WHERE id = \?\`, \[id\], \(err, row\) => \{\n            if \(err\)/,
    `db.get(\`SELECT qty_initial, qty_remaining, settlement_status FROM logistics_inbound WHERE id = ?\`, [id], (err, row) => {
            if (row && row.settlement_status === '정산완료') {
                db.run("ROLLBACK");
                return res.status(400).json({ error: '이미 정산이 완료된 건은 수정할 수 없습니다.' });
            }
            if (err)`
);

// 3. DELETE /inbound/:id
code = code.replace(
    /db\.get\(\`SELECT qty_initial, qty_remaining FROM logistics_inbound WHERE id = \?\`, \[id\], \(err, row\) => \{\n            if \(err\)/,
    `db.get(\`SELECT qty_initial, qty_remaining, settlement_status FROM logistics_inbound WHERE id = ?\`, [id], (err, row) => {
            if (row && row.settlement_status === '정산완료') {
                db.run("ROLLBACK");
                return res.status(400).json({ error: '이미 정산이 완료된 건은 삭제할 수 없습니다.' });
            }
            if (err)`
);

// 4. PUT /outbound/:id
code = code.replace(
    /\/\/ 1\. 기존 출고로 차감되었던 재고 복구\n        db\.all\(\`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = \?\`, \[id\], \(err, lots\) => \{/,
    `db.get(\`SELECT settlement_status FROM logistics_outbound WHERE id = ?\`, [id], (err0, row0) => {
            if (row0 && row0.settlement_status === '정산완료') {
                db.run("ROLLBACK");
                return res.status(400).json({ error: '이미 정산이 완료된 건은 수정할 수 없습니다.' });
            }
            // 1. 기존 출고로 차감되었던 재고 복구
            db.all(\`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?\`, [id], (err, lots) => {`
);

// 5. DELETE /outbound/:id
code = code.replace(
    /\/\/ 1\. 기존 출고로 차감되었던 재고 복구 \(입고내역의 qty_remaining 증가\)\n        db\.all\(\`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = \?\`, \[id\], \(err, lots\) => \{/,
    `db.get(\`SELECT settlement_status FROM logistics_outbound WHERE id = ?\`, [id], (err0, row0) => {
            if (row0 && row0.settlement_status === '정산완료') {
                db.run("ROLLBACK");
                return res.status(400).json({ error: '이미 정산이 완료된 건은 삭제할 수 없습니다.' });
            }
            // 1. 기존 출고로 차감되었던 재고 복구 (입고내역의 qty_remaining 증가)
            db.all(\`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?\`, [id], (err, lots) => {`
);

// We need to add an extra '});' at the end of PUT and DELETE for outbound because of the nested db.get.
// Since we have multiple transactions, we can just replace the end of these blocks.
// PUT /outbound/:id ends around line 964.
// DELETE /outbound/:id ends around line 1056.
// Let's just find the end of the transaction blocks.

code = code.replace(
    /                \}\);\n            \}\);\n        \}\);\n    \}\);\n\}\);\n\n\/\/ --- Inbound Delete/g,
    `                });
            });
        });
        });
    });
});

// --- Inbound Delete`
);

code = code.replace(
    /                \}\);\n            \}\);\n        \}\);\n    \}\);\n\}\);\n\nmodule\.exports/g,
    `                });
            });
        });
        });
    });
});

module.exports`
);

fs.writeFileSync('routes/logistics.js', code);
