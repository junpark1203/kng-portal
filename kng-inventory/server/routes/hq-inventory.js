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

/** 안전한 컬럼 추가 헬퍼 — 컬럼이 없을 때만 ALTER TABLE 실행 */
function addColumnIfNotExists(database, table, column, colDef) {
    return new Promise((resolve) => {
        database.all(`PRAGMA table_info(${table})`, [], (err, cols) => {
            if (err || !cols) { resolve(); return; }
            const exists = cols.some(c => c.name === column);
            if (exists) { resolve(); return; }
            database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`, () => resolve());
        });
    });
}

/** DB 테이블 초기화 */
function initHqTables(database) {
    return new Promise(async (resolve, reject) => {
        // 1) 테이블 생성 (serialize로 순차 실행)
        await new Promise((res) => {
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
                        basePrice INTEGER DEFAULT 0,
                        freight INTEGER DEFAULT 0,
                        onlinePrice INTEGER DEFAULT 0,
                        onlineShipping INTEGER DEFAULT 0,
                        onlineVatIncluded INTEGER DEFAULT 1,
                        sellPrice INTEGER DEFAULT 0,
                        sellVatIncluded INTEGER DEFAULT 1,
                        discountPrice INTEGER DEFAULT 0,
                        createdAt TEXT DEFAULT (datetime('now')),
                        updatedAt TEXT DEFAULT (datetime('now'))
                    )
                `);
                
                // 마이그레이션: 기존 DB에 discountPrice 컬럼이 없을 경우 추가
                database.run('ALTER TABLE hq_products ADD COLUMN discountPrice INTEGER DEFAULT 0', () => {});

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
                        onlinePrice INTEGER DEFAULT 0,
                        onlineShipping INTEGER DEFAULT 0,
                        onlineVatIncluded INTEGER DEFAULT 1,
                        sellPrice INTEGER DEFAULT 0,
                        sellVatIncluded INTEGER DEFAULT 1,
                        outVatIncluded INTEGER DEFAULT 1,
                        rawOutPrice INTEGER DEFAULT 0,
                        marginAmount INTEGER DEFAULT 0,
                        marginRate REAL DEFAULT 0,
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
                database.run(`INSERT OR IGNORE INTO hq_metrics (key, value) VALUES ('totalRevenue', 0)`);
                database.run(`INSERT OR IGNORE INTO hq_metrics (key, value) VALUES ('totalCost', 0)`);

                // 라벨 데이터 테이블
                database.run(`
                    CREATE TABLE IF NOT EXISTS hq_labels (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL DEFAULT '',
                        labelSpecId TEXT DEFAULT '',
                        productName TEXT DEFAULT '',
                        color TEXT DEFAULT '',
                        size TEXT DEFAULT '',
                        manufacturer TEXT DEFAULT '',
                        price TEXT DEFAULT '',
                        origin TEXT DEFAULT '',
                        spec TEXT DEFAULT '',
                        barcode TEXT DEFAULT '',
                        memo TEXT DEFAULT '',
                        logoBase64 TEXT DEFAULT '',
                        memoImageBase64 TEXT DEFAULT '',
                        extraFields TEXT DEFAULT '[]',
                        layout TEXT DEFAULT '{}',
                        createdAt TEXT DEFAULT (datetime('now')),
                        updatedAt TEXT DEFAULT (datetime('now'))
                    )
                `);

                // 로고 템플릿 테이블
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
                `);

                // 기본 라벨 규격 시딩
                const now = new Date().toISOString();
                const defaultSpecs = [
                    { id: 'LS-21', name: '21칸 (63.5×38.1mm)', labelWidth: 63.5, labelHeight: 38.1, marginTop: 15, marginBottom: 15, marginLeft: 7, marginRight: 7, gapX: 2.5, gapY: 0 },
                    { id: 'LS-24', name: '24칸 (63.5×33.9mm)', labelWidth: 63.5, labelHeight: 33.9, marginTop: 8.5, marginBottom: 8.5, marginLeft: 7, marginRight: 7, gapX: 2.5, gapY: 0 },
                    { id: 'LS-40', name: '40칸 (48.5×25.4mm)', labelWidth: 48.5, labelHeight: 25.4, marginTop: 22, marginBottom: 22, marginLeft: 5, marginRight: 5, gapX: 2, gapY: 0 },
                    { id: 'LS-65', name: '65칸 (38.1×21.2mm)', labelWidth: 38.1, labelHeight: 21.2, marginTop: 11, marginBottom: 11, marginLeft: 4.6, marginRight: 4.6, gapX: 2.5, gapY: 0 }
                ];
                defaultSpecs.forEach(s => {
                    database.run(`INSERT OR IGNORE INTO hq_label_specs (id, name, labelWidth, labelHeight, paperWidth, paperHeight, cols, rows, marginTop, marginBottom, marginLeft, marginRight, gapX, gapY, isDefault, createdAt, updatedAt)
                                  VALUES (?, ?, ?, ?, 210, 297, 0, 0, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
                        [s.id, s.name, s.labelWidth, s.labelHeight, s.marginTop, s.marginBottom, s.marginLeft, s.marginRight, s.gapX, s.gapY, now, now]);
                });

                database.get("SELECT 1", () => {
                    console.log('hq_products / hq_transactions / hq_metrics 테이블 확인 완료');
                    res();
                });
            });
        });

        // 2) 기존 DB 호환 — 누락 컬럼을 안전하게 추가 (PRAGMA 확인 후 ALTER)
        await addColumnIfNotExists(database, 'hq_products', 'discountPrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_products', 'basePrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_products', 'freight', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_products', 'onlinePrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_products', 'onlineShipping', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_products', 'onlineVatIncluded', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists(database, 'hq_products', 'sellVatIncluded', 'INTEGER DEFAULT 1');

        await addColumnIfNotExists(database, 'hq_transactions', 'batchId', 'TEXT');
        await addColumnIfNotExists(database, 'hq_transactions', 'onlinePrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_transactions', 'onlineShipping', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_transactions', 'onlineVatIncluded', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists(database, 'hq_transactions', 'sellPrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_transactions', 'sellVatIncluded', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists(database, 'hq_transactions', 'outVatIncluded', 'INTEGER DEFAULT 1');
        await addColumnIfNotExists(database, 'hq_transactions', 'rawOutPrice', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_transactions', 'marginAmount', 'INTEGER DEFAULT 0');
        await addColumnIfNotExists(database, 'hq_transactions', 'marginRate', 'REAL DEFAULT 0');

        await addColumnIfNotExists(database, 'hq_labels', 'layout', "TEXT DEFAULT '{}'");
        await addColumnIfNotExists(database, 'hq_labels', 'memoImageBase64', "TEXT DEFAULT ''");
        await addColumnIfNotExists(database, 'hq_labels', 'color', "TEXT DEFAULT ''");
        await addColumnIfNotExists(database, 'hq_labels', 'size', "TEXT DEFAULT ''");
        await addColumnIfNotExists(database, 'hq_labels', 'labelSpecId', "TEXT DEFAULT ''");
        await addColumnIfNotExists(database, 'hq_label_specs', 'labelWidth', 'REAL DEFAULT 63.5');
        await addColumnIfNotExists(database, 'hq_label_specs', 'labelHeight', 'REAL DEFAULT 38.1');

        // 3) 기존 데이터 무손실 승계 및 출고 원가/마진 자동 보정 (Backfill)
        await new Promise((res) => {
            database.serialize(() => {
                // 기존 할인판매가(discountPrice)만 입력되어 있던 상품은 적정판매가(sellPrice)로 자동 승계
                database.run(`
                    UPDATE hq_products
                    SET sellPrice = discountPrice
                    WHERE (sellPrice IS NULL OR sellPrice = 0) AND discountPrice > 0
                `, () => {});

                // 과거 출고(OUT) 내역 중 buyPrice가 0인 건에 대해 상품 마스터의 buyPrice 자동 매칭
                database.run(`
                    UPDATE hq_transactions
                    SET buyPrice = (
                        SELECT p.buyPrice FROM hq_products p WHERE p.id = hq_transactions.productId
                    )
                    WHERE type = 'OUT'
                      AND (buyPrice IS NULL OR buyPrice = 0)
                      AND productId IS NOT NULL AND productId != ''
                      AND EXISTS (SELECT 1 FROM hq_products p WHERE p.id = hq_transactions.productId AND p.buyPrice > 0)
                `, () => {});

                // 과거 출고(OUT) 내역 중 marginAmount가 비어있는 건에 대해 실현 마진 자동 계산
                database.run(`
                    UPDATE hq_transactions
                    SET marginAmount = (price - COALESCE(buyPrice, 0)),
                        marginRate = ROUND(CAST(price - COALESCE(buyPrice, 0) AS REAL) * 100.0 / price, 1)
                    WHERE type = 'OUT'
                      AND price > 0
                      AND (marginAmount IS NULL OR marginAmount = 0)
                      AND COALESCE(buyPrice, 0) > 0
                `, () => res());
            });
        });

        console.log('hq_labels / hq_label_specs / hq_logo_templates 및 고도화 컬럼 확인 완료');
        resolve();
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
    const onlineVatIncluded = p.onlineVatIncluded !== undefined ? (p.onlineVatIncluded ? 1 : 0) : 1;
    const sellVatIncluded = p.sellVatIncluded !== undefined ? (p.sellVatIncluded ? 1 : 0) : 1;
    const sql = `INSERT INTO hq_products (
                    id, supplier, brand, name, color, size, stock,
                    buyPrice, basePrice, freight,
                    onlinePrice, onlineShipping, onlineVatIncluded,
                    sellPrice, sellVatIncluded, discountPrice,
                    createdAt, updatedAt
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [
        id, p.supplier||'최가유통', p.brand||'', p.name||'', p.color||'', p.size||'', p.stock||0,
        p.buyPrice||0, p.basePrice||0, p.freight||0,
        p.onlinePrice||0, p.onlineShipping||0, onlineVatIncluded,
        p.sellPrice||0, sellVatIncluded, p.discountPrice||0,
        now, now
    ];
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
    db.get('SELECT * FROM hq_products WHERE id = ?', [id], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });

        const onlineVatIncluded = p.onlineVatIncluded !== undefined ? (p.onlineVatIncluded ? 1 : 0) : (existing.onlineVatIncluded ?? 1);
        const sellVatIncluded = p.sellVatIncluded !== undefined ? (p.sellVatIncluded ? 1 : 0) : (existing.sellVatIncluded ?? 1);

        const sql = `UPDATE hq_products SET
                        supplier=?, brand=?, name=?, color=?, size=?, stock=?,
                        buyPrice=?, basePrice=?, freight=?,
                        onlinePrice=?, onlineShipping=?, onlineVatIncluded=?,
                        sellPrice=?, sellVatIncluded=?, discountPrice=?,
                        updatedAt=?
                     WHERE id=?`;
        const params = [
            p.supplier !== undefined ? p.supplier : (existing.supplier || '최가유통'),
            p.brand !== undefined ? p.brand : (existing.brand || ''),
            p.name !== undefined ? p.name : (existing.name || ''),
            p.color !== undefined ? p.color : (existing.color || ''),
            p.size !== undefined ? p.size : (existing.size || ''),
            p.stock !== undefined ? p.stock : (existing.stock || 0),
            p.buyPrice !== undefined ? p.buyPrice : (existing.buyPrice || 0),
            p.basePrice !== undefined ? p.basePrice : (existing.basePrice || 0),
            p.freight !== undefined ? p.freight : (existing.freight || 0),
            p.onlinePrice !== undefined ? p.onlinePrice : (existing.onlinePrice || 0),
            p.onlineShipping !== undefined ? p.onlineShipping : (existing.onlineShipping || 0),
            onlineVatIncluded,
            p.sellPrice !== undefined ? p.sellPrice : (existing.sellPrice || 0),
            sellVatIncluded,
            p.discountPrice !== undefined ? p.discountPrice : (existing.discountPrice || 0),
            now, id
        ];
        db.run(sql, params, function(err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({ message: '수정 성공' });
        });
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

// 입출고 등록 (재고 자동 증감 + 상품마스터 단가 동기화 + 메트릭 갱신)
router.post('/transactions', (req, res) => {
    const t = req.body;
    const id = t.id || ('HQT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    
    // Check negative stock for OUT
    if (t.type === 'OUT' && t.productId) {
        db.get('SELECT stock, name, buyPrice, sellPrice FROM hq_products WHERE id = ?', [t.productId], (err, prod) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!prod) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
            if (prod.stock - (t.qty || 0) < 0) {
                return res.status(400).json({ error: `재고 부족: ${prod.name} (현재 재고: ${prod.stock}, 출고 요청: ${t.qty})` });
            }
            insertTx(prod);
        });
    } else {
        insertTx(null);
    }

    function insertTx(prod) {
        const qty = Number(t.qty) || 0;
        const price = Number(t.price) || 0;
        const buyPrice = Number(t.buyPrice || (prod && prod.buyPrice) || (t.type === 'IN' ? price : 0));
        const basePrice = Number(t.basePrice) || 0;
        const freight = Number(t.freight) || 0;
        const onlinePrice = Number(t.onlinePrice) || 0;
        const onlineShipping = Number(t.onlineShipping) || 0;
        const onlineVatIncluded = t.onlineVatIncluded !== undefined ? (t.onlineVatIncluded ? 1 : 0) : 1;
        const sellPrice = Number(t.sellPrice || (prod && prod.sellPrice) || 0);
        const sellVatIncluded = t.sellVatIncluded !== undefined ? (t.sellVatIncluded ? 1 : 0) : 1;
        const outVatIncluded = t.outVatIncluded !== undefined ? (t.outVatIncluded ? 1 : 0) : 1;
        const rawOutPrice = Number(t.rawOutPrice || price);

        let marginAmount = t.marginAmount !== undefined ? Number(t.marginAmount) : 0;
        let marginRate = t.marginRate !== undefined ? Number(t.marginRate) : 0;
        if (t.type === 'OUT' && price > 0) {
            marginAmount = price - buyPrice;
            marginRate = Math.round(((price - buyPrice) / price) * 1000) / 10;
        }

        const sql = `INSERT INTO hq_transactions (
                        id, type, txDate, timestamp, productId, supplier, brand, productName, color, size,
                        qty, price, buyPrice, basePrice, freight,
                        onlinePrice, onlineShipping, onlineVatIncluded,
                        sellPrice, sellVatIncluded, outVatIncluded, rawOutPrice,
                        marginAmount, marginRate,
                        remarks, batchId, createdAt
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id, t.type, t.txDate||'', now,
            t.productId||'', t.supplier||'', t.brand||'', t.productName||'',
            t.color||'', t.size||'', qty, price,
            buyPrice, basePrice, freight,
            onlinePrice, onlineShipping, onlineVatIncluded,
            sellPrice, sellVatIncluded, outVatIncluded, rawOutPrice,
            marginAmount, marginRate,
            t.remarks||'', t.batchId||null, now
        ];

        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ error: err.message });

            const totalAmount = qty * price;

            // 재고 증감 및 입고 시 상품 마스터 가격 갱신
            if (t.productId) {
                const stockDelta = t.type === 'IN' ? qty : -qty;
                if (t.type === 'IN') {
                    db.run(`UPDATE hq_products SET
                                stock = stock + ?,
                                buyPrice = CASE WHEN ? > 0 THEN ? ELSE buyPrice END,
                                basePrice = CASE WHEN ? > 0 THEN ? ELSE basePrice END,
                                freight = CASE WHEN ? >= 0 AND ? > 0 THEN ? ELSE freight END,
                                onlinePrice = CASE WHEN ? > 0 THEN ? ELSE onlinePrice END,
                                onlineShipping = CASE WHEN ? > 0 OR ? > 0 THEN ? ELSE onlineShipping END,
                                onlineVatIncluded = ?,
                                sellPrice = CASE WHEN ? > 0 THEN ? ELSE sellPrice END,
                                sellVatIncluded = ?,
                                updatedAt = ?
                            WHERE id = ?`,
                        [
                            stockDelta,
                            price, price,
                            basePrice, basePrice,
                            freight, price, freight,
                            onlinePrice, onlinePrice,
                            onlinePrice, onlineShipping, onlineShipping,
                            onlineVatIncluded,
                            sellPrice, sellPrice,
                            sellVatIncluded,
                            now, t.productId
                        ]);
                } else {
                    db.run('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?',
                        [stockDelta, now, t.productId]);
                }
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
            const qty = Number(t.qty) || 0;
            const price = Number(t.price) || 0;
            const totalAmount = qty * price;
            const productId = t.productId || '';
            const type = t.type;

            let prod = null;
            if (productId) {
                prod = await dbGet('SELECT * FROM hq_products WHERE id = ?', [productId]);
            }

            if (type === 'OUT' && productId) {
                if (!prod) throw new Error(`등록되지 않은 상품입니다: ${t.productName}`);
                if (prod.stock - qty < 0) {
                    throw new Error(`재고 부족: ${prod.name} (현재 재고: ${prod.stock}, 요청: ${qty})`);
                }
            }

            const buyPrice = Number(t.buyPrice || (prod && prod.buyPrice) || (type === 'IN' ? price : 0));
            const basePrice = Number(t.basePrice) || 0;
            const freight = Number(t.freight) || 0;
            const onlinePrice = Number(t.onlinePrice) || 0;
            const onlineShipping = Number(t.onlineShipping) || 0;
            const onlineVatIncluded = t.onlineVatIncluded !== undefined ? (t.onlineVatIncluded ? 1 : 0) : 1;
            const sellPrice = Number(t.sellPrice || (prod && prod.sellPrice) || 0);
            const sellVatIncluded = t.sellVatIncluded !== undefined ? (t.sellVatIncluded ? 1 : 0) : 1;
            const outVatIncluded = t.outVatIncluded !== undefined ? (t.outVatIncluded ? 1 : 0) : 1;
            const rawOutPrice = Number(t.rawOutPrice || price);

            let marginAmount = t.marginAmount !== undefined ? Number(t.marginAmount) : 0;
            let marginRate = t.marginRate !== undefined ? Number(t.marginRate) : 0;
            if (type === 'OUT' && price > 0) {
                marginAmount = price - buyPrice;
                marginRate = Math.round(((price - buyPrice) / price) * 1000) / 10;
            }

            const id = t.id || ('HQT-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));

            const sql = `INSERT INTO hq_transactions (
                            id, type, txDate, timestamp, productId, supplier, brand, productName, color, size,
                            qty, price, buyPrice, basePrice, freight,
                            onlinePrice, onlineShipping, onlineVatIncluded,
                            sellPrice, sellVatIncluded, outVatIncluded, rawOutPrice,
                            marginAmount, marginRate,
                            remarks, batchId, createdAt
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            const params = [
                id, type, t.txDate||'', now,
                productId, t.supplier||'', t.brand||'', t.productName||'',
                t.color||'', t.size||'', qty, price,
                buyPrice, basePrice, freight,
                onlinePrice, onlineShipping, onlineVatIncluded,
                sellPrice, sellVatIncluded, outVatIncluded, rawOutPrice,
                marginAmount, marginRate,
                t.remarks||'', batchId, now
            ];

            await dbRun(sql, params);

            if (productId) {
                const stockDelta = type === 'IN' ? qty : -qty;
                if (type === 'IN') {
                    await dbRun(`UPDATE hq_products SET
                                    stock = stock + ?,
                                    buyPrice = CASE WHEN ? > 0 THEN ? ELSE buyPrice END,
                                    basePrice = CASE WHEN ? > 0 THEN ? ELSE basePrice END,
                                    freight = CASE WHEN ? >= 0 AND ? > 0 THEN ? ELSE freight END,
                                    onlinePrice = CASE WHEN ? > 0 THEN ? ELSE onlinePrice END,
                                    onlineShipping = CASE WHEN ? > 0 OR ? > 0 THEN ? ELSE onlineShipping END,
                                    onlineVatIncluded = ?,
                                    sellPrice = CASE WHEN ? > 0 THEN ? ELSE sellPrice END,
                                    sellVatIncluded = ?,
                                    updatedAt = ?
                                WHERE id = ?`,
                        [
                            stockDelta,
                            price, price,
                            basePrice, basePrice,
                            freight, price, freight,
                            onlinePrice, onlinePrice,
                            onlinePrice, onlineShipping, onlineShipping,
                            onlineVatIncluded,
                            sellPrice, sellPrice,
                            sellVatIncluded,
                            now, productId
                        ]);
                } else {
                    await dbRun('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [stockDelta, now, productId]);
                }
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

        const type = t.type || old.type;
        const qty = Number(t.qty !== undefined ? t.qty : old.qty) || 0;
        const price = Number(t.price !== undefined ? t.price : old.price) || 0;
        const buyPrice = Number(t.buyPrice !== undefined ? t.buyPrice : (old.buyPrice || (type === 'IN' ? price : 0))) || 0;
        const basePrice = Number(t.basePrice !== undefined ? t.basePrice : old.basePrice) || 0;
        const freight = Number(t.freight !== undefined ? t.freight : old.freight) || 0;
        const onlinePrice = Number(t.onlinePrice !== undefined ? t.onlinePrice : old.onlinePrice) || 0;
        const onlineShipping = Number(t.onlineShipping !== undefined ? t.onlineShipping : old.onlineShipping) || 0;
        const sellPrice = Number(t.sellPrice !== undefined ? t.sellPrice : old.sellPrice) || 0;
        const rawOutPrice = Number(t.rawOutPrice !== undefined ? t.rawOutPrice : (old.rawOutPrice || price)) || 0;

        let marginAmount = t.marginAmount !== undefined ? Number(t.marginAmount) : (old.marginAmount || 0);
        let marginRate = t.marginRate !== undefined ? Number(t.marginRate) : (old.marginRate || 0);
        if (type === 'OUT' && price > 0) {
            marginAmount = price - buyPrice;
            marginRate = Math.round(((price - buyPrice) / price) * 1000) / 10;
        }

        const sql = `UPDATE hq_transactions SET
                        type=?, txDate=?, supplier=?, brand=?, productName=?, color=?, size=?,
                        qty=?, price=?, buyPrice=?, basePrice=?, freight=?,
                        onlinePrice=?, onlineShipping=?, sellPrice=?, rawOutPrice=?,
                        marginAmount=?, marginRate=?, remarks=?
                     WHERE id=?`;
        const params = [
            type, t.txDate||old.txDate, t.supplier||'', t.brand||'', t.productName||'',
            t.color||'', t.size||'', qty, price,
            buyPrice, basePrice, freight,
            onlinePrice, onlineShipping, sellPrice, rawOutPrice,
            marginAmount, marginRate,
            t.remarks !== undefined ? t.remarks : (old.remarks || ''), id
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
                const newDelta = type === 'IN' ? qty : -qty;
                if (type === 'IN') {
                    db.run(`UPDATE hq_products SET
                                stock = stock + ?,
                                buyPrice = CASE WHEN ? > 0 THEN ? ELSE buyPrice END,
                                basePrice = CASE WHEN ? > 0 THEN ? ELSE basePrice END,
                                freight = CASE WHEN ? >= 0 AND ? > 0 THEN ? ELSE freight END,
                                onlinePrice = CASE WHEN ? > 0 THEN ? ELSE onlinePrice END,
                                onlineShipping = CASE WHEN ? > 0 OR ? > 0 THEN ? ELSE onlineShipping END,
                                sellPrice = CASE WHEN ? > 0 THEN ? ELSE sellPrice END,
                                updatedAt = ?
                            WHERE id = ?`,
                        [
                            newDelta,
                            price, price,
                            basePrice, basePrice,
                            freight, price, freight,
                            onlinePrice, onlinePrice,
                            onlinePrice, onlineShipping, onlineShipping,
                            sellPrice, sellPrice,
                            now, productId
                        ]);
                } else {
                    db.run('UPDATE hq_products SET stock = stock + ?, updatedAt = ? WHERE id = ?', [newDelta, now, productId]);
                }
            }

            // 메트릭 롤백 & 재적용
            const oldTotal = old.qty * old.price;
            const newTotal = qty * price;
            if (old.type === 'IN') {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [oldTotal, 'totalCost']);
            } else {
                db.run('UPDATE hq_metrics SET value = value - ? WHERE key = ?', [oldTotal, 'totalRevenue']);
            }
            if (type === 'IN') {
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
            const pStmt = db.prepare(`INSERT OR REPLACE INTO hq_products (id, supplier, brand, name, color, size, stock, buyPrice, sellPrice, discountPrice, createdAt, updatedAt)
                                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            products.forEach(p => {
                pStmt.run([p.id, p.supplier||'최가유통', p.brand||'', p.name||'', p.color||'', p.size||'', p.stock||0, p.buyPrice||0, p.sellPrice||0, p.discountPrice||0, now, now], function(err) {
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
    const sql = `INSERT INTO hq_labels (id, name, labelSpecId, productName, color, size, manufacturer, price, origin, spec, barcode, memo, logoBase64, memoImageBase64, extraFields, layout, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.name||'', p.labelSpecId||'', p.productName||'', p.color||'', p.size||'', p.manufacturer||'', p.price||'', p.origin||'', p.spec||'', p.barcode||'', p.memo||'', p.logoBase64||'', p.memoImageBase64||'', JSON.stringify(p.extraFields||[]), JSON.stringify(p.layout||{}), now, now];
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
    const sql = `UPDATE hq_labels SET name=?, labelSpecId=?, productName=?, color=?, size=?, manufacturer=?, price=?, origin=?, spec=?, barcode=?, memo=?, logoBase64=?, memoImageBase64=?, extraFields=?, layout=?, updatedAt=? WHERE id=?`;
    const params = [p.name||'', p.labelSpecId||'', p.productName||'', p.color||'', p.size||'', p.manufacturer||'', p.price||'', p.origin||'', p.spec||'', p.barcode||'', p.memo||'', p.logoBase64||'', p.memoImageBase64||'', JSON.stringify(p.extraFields||[]), JSON.stringify(p.layout||{}), now, id];
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
