/**
 * 통합 물류 재고 관리 API (/api/logistics/...)
 */
const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

/** DB 테이블 초기화 */
function initLogisticsTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            // 1. 재고 위치 관리 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS logistics_locations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 기본 위치 3가지 자동 추가
            database.get("SELECT COUNT(*) as count FROM logistics_locations", (err, row) => {
                if (!err && row.count === 0) {
                    const defaultLocations = ['본사', '위탁(직출)', '양지유화(김포)'];
                    const stmt = database.prepare("INSERT INTO logistics_locations (name) VALUES (?)");
                    defaultLocations.forEach(loc => stmt.run(loc));
                    stmt.finalize();
                }
            });

            // 2. 입고 내역 테이블 (Lot 기반)
            database.run(`
                CREATE TABLE IF NOT EXISTS logistics_inbound (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    supplier TEXT NOT NULL,
                    item TEXT NOT NULL,
                    spec TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    qty_initial REAL NOT NULL,
                    qty_remaining REAL NOT NULL,
                    unit_price REAL NOT NULL,
                    location_id INTEGER,
                    note TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (location_id) REFERENCES logistics_locations(id)
                )
            `, (err) => {
                if (!err) {
                    // 테이블이 이미 존재할 수 있으므로 note 컬럼 추가 시도
                    database.run("ALTER TABLE logistics_inbound ADD COLUMN note TEXT", (err2) => {
                        // 중복 컬럼 에러는 무시
                    });
                }
            });

            // 3. 출고 내역 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS logistics_outbound (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    item TEXT NOT NULL,
                    spec TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    qty REAL NOT NULL,
                    selling_price REAL NOT NULL,
                    shipping_fee REAL NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 4. 출고-입고 맵핑 테이블 (어떤 출고가 어떤 입고 Lot들을 얼마나 차감했는지)
            database.run(`
                CREATE TABLE IF NOT EXISTS logistics_outbound_lots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    outbound_id INTEGER NOT NULL,
                    inbound_id INTEGER NOT NULL,
                    consumed_qty REAL NOT NULL,
                    FOREIGN KEY (outbound_id) REFERENCES logistics_outbound(id),
                    FOREIGN KEY (inbound_id) REFERENCES logistics_inbound(id)
                )
            `, (err) => {
                if (err) return reject(err);
                
                // 인덱스 추가 (조회 성능 최적화)
                database.run(`CREATE INDEX IF NOT EXISTS idx_inbound_date ON logistics_inbound(date DESC)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_inbound_created ON logistics_inbound(created_at DESC)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_date ON logistics_outbound(date DESC)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_created ON logistics_outbound(created_at DESC)`, (err2) => {
                    if (err2) reject(err2);
                    else resolve();
                });
            });
        });
    });
}

// ==========================================
// API 엔드포인트
// ==========================================

// --- Locations ---
router.get('/locations', (req, res) => {
    db.all(`SELECT * FROM logistics_locations WHERE is_active = 1 ORDER BY id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/locations', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Location name is required' });
    db.run(`INSERT INTO logistics_locations (name) VALUES (?)`, [name], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, name, is_active: 1 });
    });
});

// --- Inventory (실시간 재고) ---
// 품목+규격+단위별 잔여 수량 합계 및 Lot 상세
router.get('/inventory', (req, res) => {
    const sql = `
        SELECT 
            i.item, i.spec, i.unit,
            SUM(i.qty_remaining) as total_qty
        FROM logistics_inbound i
        WHERE i.qty_remaining > 0
        GROUP BY i.item, i.spec, i.unit
        ORDER BY i.item, i.spec
    `;
    db.all(sql, [], (err, summaryRows) => {
        if (err) return res.status(500).json({ error: err.message });

        // 상세 Lot 내역도 함께 가져옴
        const detailsSql = `
            SELECT 
                i.id, i.date, i.supplier, i.item, i.spec, i.unit, 
                i.qty_initial, i.qty_remaining, i.unit_price, 
                i.note, l.name as location_name
            FROM logistics_inbound i
            LEFT JOIN logistics_locations l ON i.location_id = l.id
            WHERE i.qty_remaining > 0
            ORDER BY i.item, i.spec, i.date ASC
        `;
        db.all(detailsSql, [], (err2, detailRows) => {
            if (err2) return res.status(500).json({ error: err2.message });

            // 품목별로 상세 내역 묶어주기
            const inventory = summaryRows.map(row => {
                row.lots = detailRows.filter(d => d.item === row.item && d.spec === row.spec && d.unit === row.unit);
                return row;
            });
            res.json(inventory);
        });
    });
});

// 출고 시 '특정 품목'의 가용 규격 및 해당 Lot 정보 불러오기 용도
router.get('/inventory/item/:itemName', (req, res) => {
    const itemName = req.params.itemName;
    const sql = `
        SELECT 
            i.id, i.date, i.supplier, i.item, i.spec, i.unit, 
            i.qty_initial, i.qty_remaining, i.unit_price, 
            i.note, l.name as location_name
        FROM logistics_inbound i
        LEFT JOIN logistics_locations l ON i.location_id = l.id
        WHERE i.item = ? AND i.qty_remaining > 0
        ORDER BY i.spec, i.date ASC
    `;
    db.all(sql, [itemName], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 모든 가용(재고가 있는) 품목 이름 목록 (출고 시 자동완성용)
router.get('/inventory/items', (req, res) => {
    const sql = `SELECT DISTINCT item FROM logistics_inbound WHERE qty_remaining > 0 ORDER BY item`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.item));
    });
});

// 전체 품목 이름 목록 (입고 시 자동완성용 - 재고가 0이어도 표시)
router.get('/items/all', (req, res) => {
    const sql = `SELECT DISTINCT item FROM logistics_inbound ORDER BY item`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.item));
    });
});

// --- Inbound (입고) ---
router.post('/inbound', (req, res) => {
    const { date, supplier, location_id, items } = req.body;
    // items = [{item, spec, unit, qty, unit_price, note}, ...]
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const sql = `
            INSERT INTO logistics_inbound 
            (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const stmt = db.prepare(sql);
        
        let hasError = false;
        let errorMsg = '';
        
        try {
            for (let i of items) {
                stmt.run(date, supplier, i.item, i.spec, i.unit, i.qty, i.qty, i.unit_price, location_id, i.note || '');
            }
        } catch (e) {
            hasError = true;
            errorMsg = e.message;
        } finally {
            stmt.finalize();
        }

        if (hasError) {
            db.run("ROLLBACK");
            return res.status(500).json({ error: errorMsg });
        } else {
            db.run("COMMIT", (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ message: 'Inbound success' });
            });
        }
    });
});

// --- Outbound (출고) ---
router.post('/outbound', (req, res) => {
    const { date, destination, items } = req.body;
    
    // 검증
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        let hasError = false;
        
        const outSql = `
            INSERT INTO logistics_outbound 
            (date, destination, item, spec, unit, qty, selling_price, shipping_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const lotsSql = `INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`;
        const updateInboundSql = `UPDATE logistics_inbound SET qty_remaining = qty_remaining - ? WHERE id = ?`;
        
        const stmtOut = db.prepare(outSql);
        const stmtLots = db.prepare(lotsSql);
        const stmtUpdate = db.prepare(updateInboundSql);

        for (let i of items) {
            if (!i.consumed_lots || i.consumed_lots.length === 0) {
                hasError = true;
                continue;
            }
            stmtOut.run(date, destination, i.item, i.spec, i.unit, i.qty, i.selling_price, i.shipping_fee, function(err) {
                if (err) {
                    hasError = true;
                    return;
                }
                const outboundId = this.lastID;
                for (let lot of i.consumed_lots) {
                    stmtLots.run(outboundId, lot.inbound_id, lot.consumed_qty, function(e) { if(e) hasError = true; });
                    stmtUpdate.run(lot.consumed_qty, lot.inbound_id, function(e) { if(e) hasError = true; });
                }
            });
        }
        
        // Statements finalize barrier
        db.run("SELECT 1", function() {
            stmtOut.finalize();
            stmtLots.finalize();
            stmtUpdate.finalize();
            
            if (hasError) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Outbound transaction failed" });
            } else {
                db.run("COMMIT", (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.status(201).json({ message: 'Outbound success', id: outboundId });
                });
            }
        });
    });
});

// --- History (입출고 전체 내역) ---
router.get('/history', (req, res) => {
    let { page = 1, limit = 50, type = 'all', search = '' } = req.query;
    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 50;
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (type === 'inbound') {
        whereClauses.push("type = 'inbound'");
    } else if (type === 'outbound') {
        whereClauses.push("type = 'outbound'");
    }

    const searchTerms = search.trim().split(/\s+/).filter(Boolean);
    if (searchTerms.length > 0) {
        searchTerms.forEach(term => {
            whereClauses.push(`(date LIKE ? OR party LIKE ? OR item LIKE ? OR spec LIKE ? OR note LIKE ?)`);
            const likeTerm = `%${term}%`;
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
        });
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const baseSql = `
        WITH combined AS (
            SELECT 
                'inbound' as type, i.id, i.date, i.supplier as party, i.item, i.spec, i.unit, 
                i.qty_initial as qty, i.unit_price as price, 0 as shipping_fee, i.note, i.created_at
            FROM logistics_inbound i
            UNION ALL
            SELECT 
                'outbound' as type, o.id, o.date, o.destination as party, o.item, o.spec, o.unit, 
                o.qty as qty, o.selling_price as price, o.shipping_fee, '' as note, o.created_at
            FROM logistics_outbound o
        )
        SELECT * FROM combined
        ${whereStr}
    `;

    const countSql = `SELECT COUNT(*) as total FROM (${baseSql})`;
    const dataSql = `
        ${baseSql}
        ORDER BY date DESC, created_at DESC
        LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const total = row.total;

        db.all(dataSql, [...params, limit, offset], (err2, rows) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json({
                data: rows,
                total,
                page,
                limit
            });
        });
    });
});

// --- Inbound Delete (입고 내역 삭제) ---
router.delete('/inbound/:id', (req, res) => {
    const id = req.params.id;
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        db.get(`SELECT qty_initial, qty_remaining FROM logistics_inbound WHERE id = ?`, [id], (err, row) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                db.run("ROLLBACK");
                return res.status(404).json({ error: 'Record not found' });
            }
            
            if (row.qty_initial !== row.qty_remaining) {
                db.run("ROLLBACK");
                return res.status(400).json({ error: '이미 출고 차감된 내역이 존재하여 삭제할 수 없습니다. 연결된 출고 내역을 먼저 삭제해주세요.' });
            }
            
            db.run(`DELETE FROM logistics_inbound WHERE id = ?`, [id], function(err2) {
                if (err2) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err2.message });
                }
                db.run("COMMIT", (err3) => {
                    if (err3) return res.status(500).json({ error: err3.message });
                    res.json({ message: 'Deleted successfully' });
                });
            });
        });
    });
});

// --- Outbound Delete (출고 내역 삭제 및 재고 복구) ---
router.delete('/outbound/:id', (req, res) => {
    const id = req.params.id;
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lots) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }
            
            const stmtRestore = db.prepare(`UPDATE logistics_inbound SET qty_remaining = qty_remaining + ? WHERE id = ?`);
            let hasError = false;
            
            for (let lot of lots) {
                stmtRestore.run(lot.consumed_qty, lot.inbound_id, function(err2) {
                    if (err2) hasError = true;
                });
            }
            
            db.run("SELECT 1", function() {
                stmtRestore.finalize();
                
                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: 'Failed to restore inbound inventory' });
                }
                
                db.run(`DELETE FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], function(err3) {
                    if (err3) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err3.message });
                    }
                    
                    db.run(`DELETE FROM logistics_outbound WHERE id = ?`, [id], function(err4) {
                        if (err4) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: err4.message });
                        }
                        
                        db.run("COMMIT", (err5) => {
                            if (err5) return res.status(500).json({ error: err5.message });
                            res.json({ message: 'Deleted and inventory restored successfully' });
                        });
                    });
                });
            });
        });
    });
});

module.exports = {
    router,
    initLogisticsTables,
    setDb
};
