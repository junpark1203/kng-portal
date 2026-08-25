const fs = require('fs');
let content = fs.readFileSync('kng-inventory/server/routes/logistics.js', 'utf8');

// 1. Add settlement fields to /history query
content = content.replace(
  'i.is_direct\r\n            FROM logistics_inbound i\r\n            WHERE i.is_direct = 0',
  'i.is_direct, i.settlement_status, i.tax_invoice_date, i.is_zero_tax\r\n            FROM logistics_inbound i\r\n            WHERE i.is_direct = 0'
);
content = content.replace(
  'o.is_direct\r\n            FROM logistics_outbound o',
  'o.is_direct, o.settlement_status, o.tax_invoice_date, o.is_zero_tax\r\n            FROM logistics_outbound o'
);
content = content.replace(
  'i.is_direct\n            FROM logistics_inbound i\n            WHERE i.is_direct = 0',
  'i.is_direct, i.settlement_status, i.tax_invoice_date, i.is_zero_tax\n            FROM logistics_inbound i\n            WHERE i.is_direct = 0'
);
content = content.replace(
  'o.is_direct\n            FROM logistics_outbound o',
  'o.is_direct, o.settlement_status, o.tax_invoice_date, o.is_zero_tax\n            FROM logistics_outbound o'
);

// 2. PUT /inbound/:id
content = content.replace(
  'db.get(`SELECT qty_initial, qty_remaining FROM logistics_inbound WHERE id = ?`, [id], (err, row) => {',
  'db.get(`SELECT qty_initial, qty_remaining, settlement_status FROM logistics_inbound WHERE id = ?`, [id], (err, row) => {\n            if (row && row.settlement_status === \'정산완료\') {\n                db.run("ROLLBACK");\n                return res.status(400).json({ error: \'이미 정산이 완료된 건은 수정할 수 없습니다.\' });\n            }'
);

// 3. PUT /outbound/:id
content = content.replace(
  '// 1. 기존 출고로 차감되었던 재고 복구\r\n        db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {',
  'db.get(`SELECT settlement_status FROM logistics_outbound WHERE id = ?`, [id], (err0, row0) => {\n            if (row0 && row0.settlement_status === \'정산완료\') {\n                db.run("ROLLBACK");\n                return res.status(400).json({ error: \'이미 정산이 완료된 건은 수정할 수 없습니다.\' });\n            }\n            // 1. 기존 출고로 차감되었던 재고 복구\r\n            db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {'
);
content = content.replace(
  '// 1. 기존 출고로 차감되었던 재고 복구\n        db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {',
  'db.get(`SELECT settlement_status FROM logistics_outbound WHERE id = ?`, [id], (err0, row0) => {\n            if (row0 && row0.settlement_status === \'정산완료\') {\n                db.run("ROLLBACK");\n                return res.status(400).json({ error: \'이미 정산이 완료된 건은 수정할 수 없습니다.\' });\n            }\n            // 1. 기존 출고로 차감되었던 재고 복구\n            db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {'
);
// fix brackets for PUT /outbound
content = content.replace(
  '                                    res.json({ message: \'Outbound updated successfully\' });\r\n                                });\r\n                            }\r\n                        });\r\n                    });\r\n                });\r\n            });\r\n        });\r\n    });\r\n});',
  '                                    res.json({ message: \'Outbound updated successfully\' });\r\n                                });\r\n                            }\r\n                        });\r\n                    });\r\n                });\r\n            });\r\n        });\r\n        });\r\n    });\r\n});'
);
content = content.replace(
  '                                    res.json({ message: \'Outbound updated successfully\' });\n                                });\n                            }\n                        });\n                    });\n                });\n            });\n        });\n    });\n});',
  '                                    res.json({ message: \'Outbound updated successfully\' });\n                                });\n                            }\n                        });\n                    });\n                });\n            });\n        });\n        });\n    });\n});'
);

// 4. DELETE /inbound/:id
content = content.replace(
  'if (row.qty_initial !== row.qty_remaining) {',
  'if (row.settlement_status === \'정산완료\') {\n                db.run("ROLLBACK");\n                return res.status(400).json({ error: \'이미 정산이 완료된 건은 삭제할 수 없습니다.\' });\n            }\n            \n            if (row.qty_initial !== row.qty_remaining) {'
);
content = content.replace(
  'db.get(`SELECT qty_initial, qty_remaining FROM logistics_inbound WHERE id = ?`, [id], (err, row) => {',
  'db.get(`SELECT qty_initial, qty_remaining, settlement_status FROM logistics_inbound WHERE id = ?`, [id], (err, row) => {'
);

// 5. DELETE /outbound/:id
content = content.replace(
  '        db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {',
  '        db.get(`SELECT settlement_status FROM logistics_outbound WHERE id = ?`, [id], (err0, row0) => {\n            if (row0 && row0.settlement_status === \'정산완료\') {\n                db.run("ROLLBACK");\n                return res.status(400).json({ error: \'이미 정산이 완료된 건은 삭제할 수 없습니다.\' });\n            }\n            db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {'
);
content = content.replace(
  '                                res.json({ message: \'Deleted and inventory restored successfully\' });\r\n                            });\r\n                        });\r\n                    });\r\n                });\r\n            });\r\n        });\r\n    });\r\n});',
  '                                res.json({ message: \'Deleted and inventory restored successfully\' });\r\n                            });\r\n                        });\r\n                    });\r\n                });\r\n            });\r\n        });\r\n        });\r\n    });\r\n});'
);
content = content.replace(
  '                                res.json({ message: \'Deleted and inventory restored successfully\' });\n                            });\n                        });\n                    });\n                });\n            });\n        });\n    });\n});',
  '                                res.json({ message: \'Deleted and inventory restored successfully\' });\n                            });\n                        });\n                    });\n                });\n            });\n        });\n        });\n    });\n});'
);


fs.writeFileSync('kng-inventory/server/routes/logistics.js', content, 'utf8');
