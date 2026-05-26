/**
 * 본사 매입 현황 API (/api/hq/...)
 * - 상품 마스터 CRUD
 * - 입출고 내역 CRUD (재고 자동 증감 + 메트릭 갱신)
 * - KPI 메트릭 조회
 * - 자동완성 지원
 */
const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

/** DB 테이블 초기화 */
function initHqTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            // 상품 마스터
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_products (
                    id TEXT PRIMARY KEY,
                    supplier TEXT DEFAULT '최가유통',
                    brand TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL DEFAULT '',
                    color TEXT NOT NULL DEFAULT '',
                    size TEXT NOT NULL DEFAULT '',
                    stock INTEGER DEFAULT 0,
                    buyPrice INTEGER DEFAULT 0,
                    sellPrice INTEGER DEFAULT 0,
                    createdAt TEXT DEFAULT (datetime('now')),
                    updatedAt TEXT DEFAULT (datetime('now'))
                )
            `);

            // 입출고 내역
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_transactions (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL CHECK(type IN ('IN', 'OUT')),
                    txDate TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    productId TEXT,
                    supplier TEXT,
                    brand TEXT,
                    productName TEXT,
                    color TEXT,
                    size TEXT,
                    qty INTEGER NOT NULL DEFAULT 0,
                    price INTEGER NOT NULL DEFAULT 0,
                    buyPrice INTEGER DEFAULT 0,
                    basePrice INTEGER DEFAULT 0,
                    freight INTEGER DEFAULT 0,
                    remarks TEXT,
                    batchId TEXT,
                    createdAt TEXT DEFAULT (datetime('now'))
                )
            `);

            // 집계 메트릭 (KPI)
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_metrics (
                    key TEXT PRIMARY KEY,
                    value REAL DEFAULT 0
                )
            `);

            // 기본 메트릭 삽입 (이미 있으면 무시)
            database.run(`INSERT OR IGNORE INTO hq_metrics (key, value) VALUES ('totalRevenue', 0)`);
            database.run(`INSERT OR IGNORE INTO hq_metrics (key, value) VALUES ('totalCost', 0)`, () => {
                // ALTER TABLE to add batchId if missing
                database.run(`ALTER TABLE hq_transactions ADD COLUMN batchId TEXT`, (err) => {
                    // Ignore error if column already exists
                    console.log('hq_products / hq_transactions / hq_metrics 테이블 확인 완료');
                });
            });

            // 라벨 데이터 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_labels (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL DEFAULT '',
                    productName TEXT DEFAULT '',
                    manufacturer TEXT DEFAULT '',
                    price TEXT DEFAULT '',
                    origin TEXT DEFAULT '',
                    spec TEXT DEFAULT '',
                    barcode TEXT DEFAULT '',
                    memo TEXT DEFAULT '',
                    logoBase64 TEXT DEFAULT '',
                    extraFields TEXT DEFAULT '[]',
                    layout TEXT DEFAULT '{}',
                    createdAt TEXT DEFAULT (datetime('now')),
                    updatedAt TEXT DEFAULT (datetime('now'))
                )
            `, () => {
                // layout 컬럼 추가 (기존 DB 호환)
                database.run(`ALTER TABLE hq_labels ADD COLUMN layout TEXT DEFAULT '{}'`, () => {});
            });

            // 로고 템플릿 테이블 (제조사별 로고 저장)
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_logo_templates (
                    id TEXT PRIMARY KEY,
                    manufacturer TEXT NOT NULL DEFAULT '',
                    logoBase64 TEXT DEFAULT '',
                    createdAt TEXT DEFAULT (datetime('now')),
                    updatedAt TEXT DEFAULT (datetime('now'))
                )
            `);

            // 라벨 용지 규격 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS hq_label_specs (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL DEFAULT '',
                    paperWidth REAL DEFAULT 210,
                    paperHeight REAL DEFAULT 297,
                    labelWidth REAL DEFAULT 63.5,
                    labelHeight REAL DEFAULT 38.1,
                    cols INTEGER DEFAULT 3,
                    rows INTEGER DEFAULT 7,
                    marginTop REAL DEFAULT 15,
                    marginBottom REAL DEFAULT 15,
                    marginLeft REAL DEFAULT 7,
                    marginRight REAL DEFAULT 7,
                    gapX REAL DEFAULT 2,
                    gapY REAL DEFAULT 0,
                    isDefault INTEGER DEFAULT 0,
                    createdAt TEXT DEFAULT (datetime('now')),
                    updatedAt TEXT DEFAULT (datetime('now'))
                )
            `, () => {
                // labelWidth/labelHeight 컬럼 추가 (기존 DB 호환)
                database.run(`ALTER TABLE hq_label_specs ADD COLUMN labelWidth REAL DEFAULT 63.5`, () => {});
                database.run(`ALTER TABLE hq_label_specs ADD COLUMN labelHeight REAL DEFAULT 38.1`, () => {});
                // 기본 라벨 규격 시딩
                const defaultSpecs = [
                    { id: 'LS-21', name: '21칸 (63.5×38.1mm)', labelWidth: 63.5, labelHeight: 38.1, marginTop: 15, marginBottom: 15, marginLeft: 7, marginRight: 7, gapX: 2.5, gapY: 0 },
                    { id: 'LS-24', name: '24칸 (63.5×33.9mm)', labelWidth: 63.5, labelHeight: 33.9, marginTop: 8.5, marginBottom: 8.5, marginLeft: 7, marginRight: 7, gapX: 2.5, gapY: 0 },
                    { id: 'LS-40', name: '40칸 (48.5×25.4mm)', labelWidth: 48.5, labelHeight: 25.4, marginTop: 22, marginBottom: 22, marginLeft: 5, marginRight: 5, gapX: 2, gapY: 0 },
                    { id: 'LS-65', name: '65칸 (38.1×21.2mm)', labelWidth: 38.1, labelHeight: 21.2, marginTop: 11, marginBottom: 11, marginLeft: 4.6, marginRight: 4.6, gapX: 2.5, gapY: 0 }
                ];
                const now = new Date().toISOString();
                defaultSpecs.forEach(s => {
                    database.run(`INSERT OR IGNORE INTO hq_label_specs (id, name, labelWidth, labelHeight, paperWidth, paperHeight, cols, rows, marginTop, marginBottom, marginLeft, marginRight, gapX, gapY, isDefault, createdAt, updatedAt)
                                  VALUES (?, ?, ?, ?, 210, 297, 0, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                        [s.id, s.name, s.labelWidth, s.labelHeight, s.marginTop, s.marginBottom, s.marginLeft, s.marginRight, s.gapX, s.gapY, now, now]);
                });
                console.log('hq_labels / hq_label_specs / hq_logo_templates 테이블 확인 완료');
                resolve();
            });
        });
    });
}

// ==========================================
// 상품 API
// ==========================================

// 전체 상품 목록
router.get('/products', (req, res) => {
    db.all('SELECT * FROM hq_products ORDER BY supplier, brand, name', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단일 상품 조회
router.get('/products/:id', (req, res) => {
    db.get('SELECT * FROM hq_products WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 상품 등록
router.post('/products', (req, res) => {
    const p = req.body;
    const id = p.id || ('HQP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO hq_products (id, supplier, brand, name, color, size, stock, buyPrice, sellPrice, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.supplier||'', p.brand||'', p.name||'', p.color||'', p.size||'', p.stock||0, p.buyPrice||0, p.sellPrice||0, now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id });
    });
});

// 상품 수정
router.put('/products/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE hq_products SET supplier=?, brand=?, name=?, color=?, size=?, stock=?, buyPrice=?, sellPrice=?, updatedAt=? WHERE id=?`;
    const params = [p.supplier||'', p.brand||'', p.name||'', p.color||'', p.size||'', p.stock||0, p.buyPrice||0, p.sellPrice||0, now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 상품 삭제 (다중)
router.post('/products/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM hq_products WHERE id IN (${placeholders})`, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// ==========================================
// 입출고 내역 API
// ==========================================

// 내역 목록 (쿼리 필터 지원)
router.get('/transactions', (req, res) => {
    let sql = 'SELECT * FROM hq_transactions WHERE 1=1';
    const params = [];

    if (req.query.type) {
        sql += ' AND type = ?';
        params.push(req.query.type);
    }
    if (req.query.startDate) {
        sql += ' AND txDate >= ?';
        params.push(req.query.startDate);
    }
    if (req.query.endDate) {
        sql += ' AND txDate <= ?';
        params.push(req.query.endDate);
    }

    sql += ' ORDER BY txDate DESC, timestamp DESC';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 입출고 등록 (재고 자동 증감 + 메트릭 갱신)
router.post('/transactions', (req, res) => {
    const t = req.body;
    const id = t.id || ('HQT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    
    // Check negative stock for OUT
    if (t.type === 'OUT' && t.productId) {
        db.get('SELECT stock, name FROM hq_products WHERE id = ?', [t.productId], (err, prod) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!prod) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
            if (prod.stock - (t.qty || 0) < 0) {
                return res.status(400).json({ error: `재고 부족: ${prod.name} (현재 재고: ${prod.stock}, 출고 요청: ${t.qty})` });
            }
            insertTx();
        });
    } else {
        insertTx();
    }

    function insertTx() {
        const sql = `INSERT INTO hq_transactions (id, type, txDate, timestamp, productId, supplier, brand, productName, color, size, qty, price, buyPrice, basePrice, freight, remarks, batchId, createdAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id, t.type, t.txDate||'', now,
            t.productId||'', t.supplier||'', t.brand||'', t.productName||'',
            t.color||'', t.size||'', t.qty||0, t.price||0,
            t.buyPrice||0, t.basePrice||0, t.freight||0,
            t.remarks||'', t.batchId||null, now
        ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });

        const qty = t.qty || 0;
        const price = t.price || 0;
        const totalAmount = qty * price;

        // 재고 증감
        if (t.productId) {
            const stockDelta = t.type === 'IN' ? qty : -qty;
            db.run('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?',
                [stockDelta, now, t.productId]);
        }

        // 메트릭 갱신
        if (t.type === 'IN') {
            db.run('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [totalAmount, 'totalCost']);
        } else {
            db.run('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [totalAmount, 'totalRevenue']);
        }

        res.status(201).json({ message: '등록 성공', id });
    });
    }
});

// 일괄 입출고 등록 (다중 항목)
router.post('/transactions/bulk', async (req, res) => {
    const items = req.body.items;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '데이터가 없습니다.' });

    const batchId = 'BATCH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();

    const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
    const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));

    try {
        await dbRun('BEGIN TRANSACTION', []);

        for (const t of items) {
            const qty = t.qty || 0;
            const price = t.price || 0;
            const totalAmount = qty * price;
            const productId = t.productId || '';
            const type = t.type;

            if (type === 'OUT' && productId) {
                const prod = await dbGet('SELECT stock, name FROM hq_products WHERE id = ?', [productId]);
                if (!prod) throw new Error(`등록되지 않은 상품입니다: ${t.productName}`);
                if (prod.stock - qty < 0) {
                    throw new Error(`재고 부족: ${prod.name} (현재 재고: ${prod.stock}, 요청: ${qty})`);
                }
            }

            const id = t.id || ('HQT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));

            const sql = `INSERT INTO hq_transactions (id, type, txDate, timestamp, productId, supplier, brand, productName, color, size, qty, price, buyPrice, basePrice, freight, remarks, batchId, createdAt)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                id, type, t.txDate||'', now,
                productId, t.supplier||'', t.brand||'', t.productName||'',
                t.color||'', t.size||'', qty, price,
                t.buyPrice||0, t.basePrice||0, t.freight||0,
                t.remarks||'', batchId, now
            ];

            await dbRun(sql, params);

            if (productId) {
                const stockDelta = type === 'IN' ? qty : -qty;
                await dbRun('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [stockDelta, now, productId]);
            }

            if (type === 'IN') {
                await dbRun('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [totalAmount, 'totalCost']);
            } else {
                await dbRun('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [totalAmount, 'totalRevenue']);
            }
        }

        await dbRun('COMMIT', []);
        res.status(201).json({ message: '일괄 등록 성공', batchId, count: items.length });

    } catch (error) {
        await dbRun('ROLLBACK', []);
        res.status(400).json({ error: error.message });
    }
});

// 입출고 내역 수정
router.put('/transactions/:id', (req, res) => {
    const id = req.params.id;
    const t = req.body;
    const now = new Date().toISOString();

    // 기존 내역 조회 (메트릭 롤백용)
    db.get('SELECT * FROM hq_transactions WHERE id = ?', [id], (err, old) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!old) return res.status(404).json({ error: '내역을 찾을 수 없습니다.' });

        const sql = `UPDATE hq_transactions SET type=?, txDate=?, supplier=?, brand=?, productName=?, color=?, size=?, qty=?, price=?, buyPrice=?, basePrice=?, freight=?, remarks=? WHERE id=?`;
        const params = [
            t.type||old.type, t.txDate||old.txDate, t.supplier||'', t.brand||'', t.productName||'',
            t.color||'', t.size||'', t.qty||0, t.price||0,
            t.buyPrice||0, t.basePrice||0, t.freight||0,
            t.remarks||'', id
        ];

        db.run(sql, params, function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            if (this.changes === 0) return res.status(404).json({ error: '내역을 찾을 수 없습니다.' });

            // 재고 롤백 & 재적용
            if (old.productId) {
                const oldDelta = old.type === 'IN' ? -old.qty : old.qty;
                db.run('UPDATE hq_products SET stock = stock + ? WHERE id = ?', [oldDelta, old.productId]);
            }
            const productId = t.productId || old.productId;
            if (productId) {
                const newDelta = (t.type||old.type) === 'IN' ? (t.qty||0) : -(t.qty||0);
                db.run('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [newDelta, now, productId]);
            }

            // 메트릭 롤백 & 재적용
            const oldTotal = old.qty * old.price;
            const newTotal = (t.qty||0) * (t.price||0);
            if (old.type === 'IN') {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [oldTotal, 'totalCost']);
            } else {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [oldTotal, 'totalRevenue']);
            }
            if ((t.type||old.type) === 'IN') {
                db.run('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [newTotal, 'totalCost']);
            } else {
                db.run('UPDATE hq_metrics SET value = value + ? WHERE key = ?', [newTotal, 'totalRevenue']);
            }

            res.json({ message: '수정 성공' });
        });
    });
});

// 입출고 내역 삭제 (재고 롤백 + 메트릭 롤백)
router.post('/transactions/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }

    const placeholders = ids.map(() => '?').join(',');
    // 삭제 전 데이터 조회 (롤백용)
    db.all(`SELECT * FROM hq_transactions WHERE id IN (${placeholders})`, ids, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const now = new Date().toISOString();
        rows.forEach(old => {
            // 재고 롤백
            if (old.productId) {
                const rollback = old.type === 'IN' ? -old.qty : old.qty;
                db.run('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [rollback, now, old.productId]);
            }
            // 메트릭 롤백
            const total = old.qty * old.price;
            if (old.type === 'IN') {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [total, 'totalCost']);
            } else {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [total, 'totalRevenue']);
            }
        });

        db.run(`DELETE FROM hq_transactions WHERE id IN (${placeholders})`, ids, function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: '삭제 성공', deletedCount: this.changes });
        });
    });
});

// ==========================================
// KPI 메트릭
// ==========================================
router.get('/metrics', (req, res) => {
    db.all('SELECT * FROM hq_metrics', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const result = {};
        rows.forEach(r => { result[r.key] = r.value; });
        res.json(result);
    });
});

// ==========================================
// 자동완성
// ==========================================
router.get('/autocomplete/:field', (req, res) => {
    const field = req.params.field;
    const allowed = ['supplier', 'brand', 'name', 'color', 'size'];
    if (!allowed.includes(field)) {
        return res.status(400).json({ error: '허용되지 않는 필드입니다.' });
    }
    const sql = `SELECT DISTINCT ${field} as value FROM hq_products WHERE ${field} IS NOT NULL AND ${field} != '' ORDER BY ${field}`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.value));
    });
});

// ==========================================
// 마이그레이션 (Firebase → SQLite)
// ==========================================
router.post('/migrate', (req, res) => {
    const { products, transactions, metrics } = req.body;
    const now = new Date().toISOString();
    let pCount = 0, tCount = 0;

    db.serialize(() => {
        // 상품 마이그레이션
        if (products && Array.isArray(products)) {
            const pStmt = db.prepare(`INSERT OR REPLACE INTO hq_products (id, supplier, brand, name, color, size, stock, buyPrice, sellPrice, createdAt, updatedAt)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            products.forEach(p => {
                pStmt.run([p.id, p.supplier||'최가유통', p.brand||'', p.name||'', p.color||'', p.size||'', p.stock||0, p.buyPrice||0, p.sellPrice||0, now, now], function(err) {
                    if (!err && this.changes > 0) pCount++;
                });
            });
            pStmt.finalize();
        }

        // 트랜잭션 마이그레이션
        if (transactions && Array.isArray(transactions)) {
            const tStmt = db.prepare(`INSERT OR REPLACE INTO hq_transactions (id, type, txDate, timestamp, productId, supplier, brand, productName, color, size, qty, price, buyPrice, basePrice, freight, remarks, createdAt)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            transactions.forEach(t => {
                const txDate = t.txDate || (t.timestamp ? t.timestamp.split('T')[0] : '');
                tStmt.run([t.id, t.type||'IN', txDate, t.timestamp||now, t.productId||'', t.supplier||'', t.brand||'', t.productName||'', t.color||'', t.size||'', t.qty||0, t.price||0, t.buyPrice||0, t.basePrice||0, t.freight||0, t.remarks||'', now], function(err) {
                    if (!err && this.changes > 0) tCount++;
                });
            });
            tStmt.finalize();
        }

        // 메트릭 마이그레이션
        if (metrics) {
            if (metrics.totalRevenue !== undefined) {
                db.run('UPDATE hq_metrics SET value = ? WHERE key = ?', [metrics.totalRevenue, 'totalRevenue']);
            }
            if (metrics.totalCost !== undefined) {
                db.run('UPDATE hq_metrics SET value = ? WHERE key = ?', [metrics.totalCost, 'totalCost']);
            }
        }

        // finalize 후 응답 (약간의 딜레이)
        setTimeout(() => {
            res.json({
                message: 'Firebase → SQLite 마이그레이션 완료',
                products: pCount,
                transactions: tCount,
                metrics: metrics ? 'updated' : 'skipped'
            });
        }, 500);
    });
});

// ==========================================
// 라벨 API
// ==========================================

// 라벨 목록 조회
router.get('/labels', (req, res) => {
    db.all('SELECT * FROM hq_labels ORDER BY updatedAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 라벨 단일 조회
router.get('/labels/:id', (req, res) => {
    db.get('SELECT * FROM hq_labels WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '라벨을 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 라벨 등록
router.post('/labels', (req, res) => {
    const p = req.body;
    const id = p.id || ('LBL-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO hq_labels (id, name, productName, manufacturer, price, origin, spec, barcode, memo, logoBase64, extraFields, layout, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.name||'', p.productName||'', p.manufacturer||'', p.price||'', p.origin||'', p.spec||'', p.barcode||'', p.memo||'', p.logoBase64||'', JSON.stringify(p.extraFields||[]), JSON.stringify(p.layout||{}), now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '저장 성공', id });
    });
});

// 라벨 수정
router.put('/labels/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE hq_labels SET name=?, productName=?, manufacturer=?, price=?, origin=?, spec=?, barcode=?, memo=?, logoBase64=?, extraFields=?, layout=?, updatedAt=? WHERE id=?`;
    const params = [p.name||'', p.productName||'', p.manufacturer||'', p.price||'', p.origin||'', p.spec||'', p.barcode||'', p.memo||'', p.logoBase64||'', JSON.stringify(p.extraFields||[]), JSON.stringify(p.layout||{}), now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '라벨을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 라벨 삭제 (다중)
router.post('/labels/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM hq_labels WHERE id IN (${placeholders})`, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// ==========================================
// 라벨 용지 규격 API
// ==========================================

// 규격 목록 조회
router.get('/label-specs', (req, res) => {
    db.all('SELECT * FROM hq_label_specs ORDER BY isDefault DESC, name', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 규격 등록
router.post('/label-specs', (req, res) => {
    const p = req.body;
    const id = p.id || ('LS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO hq_label_specs (id, name, labelWidth, labelHeight, paperWidth, paperHeight, cols, rows, marginTop, marginBottom, marginLeft, marginRight, gapX, gapY, isDefault, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?)`;
    const params = [id, p.name||'', p.labelWidth||63.5, p.labelHeight||38.1, p.paperWidth||210, p.paperHeight||297, p.marginTop||15, p.marginBottom||15, p.marginLeft||7, p.marginRight||7, p.gapX||2, p.gapY||0, now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id });
    });
});

// 규격 수정
router.put('/label-specs/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE hq_label_specs SET name=?, labelWidth=?, labelHeight=?, paperWidth=?, paperHeight=?, marginTop=?, marginBottom=?, marginLeft=?, marginRight=?, gapX=?, gapY=?, updatedAt=? WHERE id=?`;
    const params = [p.name||'', p.labelWidth||63.5, p.labelHeight||38.1, p.paperWidth||210, p.paperHeight||297, p.marginTop||15, p.marginBottom||15, p.marginLeft||7, p.marginRight||7, p.gapX||2, p.gapY||0, now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '규격을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 규격 삭제 (기본 규격은 삭제 불가)
router.delete('/label-specs/:id', (req, res) => {
    db.get('SELECT isDefault FROM hq_label_specs WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '규격을 찾을 수 없습니다.' });
        if (row.isDefault) return res.status(400).json({ error: '기본 규격은 삭제할 수 없습니다.' });
        db.run('DELETE FROM hq_label_specs WHERE id = ?', [req.params.id], function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: '삭제 성공' });
        });
    });
});

// ==========================================
// 로고 템플릿 API
// ==========================================

router.get('/logo-templates', (req, res) => {
    db.all('SELECT * FROM hq_logo_templates ORDER BY manufacturer', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/logo-templates', (req, res) => {
    const p = req.body;
    const id = p.id || ('LT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    db.run(`INSERT OR REPLACE INTO hq_logo_templates (id, manufacturer, logoBase64, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
        [id, p.manufacturer||'', p.logoBase64||'', now, now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '저장 성공', id });
    });
});

router.delete('/logo-templates/:id', (req, res) => {
    db.run('DELETE FROM hq_logo_templates WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

module.exports = router;
module.exports.setDb = setDb;
module.exports.initHqTables = initHqTables;
