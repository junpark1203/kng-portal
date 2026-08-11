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
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (location_id) REFERENCES logistics_locations(id)
                )
            `);

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
                if (err) reject(err);
                else resolve();
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
                l.name as location_name
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
            l.name as location_name
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
    const { date, supplier, item, spec, unit, qty, unit_price, location_id } = req.body;
    const sql = `
        INSERT INTO logistics_inbound 
        (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [date, supplier, item, spec, unit, qty, qty, unit_price, location_id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: 'Inbound success', id: this.lastID });
    });
});

// --- Outbound (출고) ---
router.post('/outbound', (req, res) => {
    const { date, destination, item, spec, unit, qty, selling_price, shipping_fee, consumed_lots } = req.body;
    // consumed_lots = [ { inbound_id, consumed_qty }, ... ]
    
    // 검증
    if (!consumed_lots || !Array.isArray(consumed_lots) || consumed_lots.length === 0) {
        return res.status(400).json({ error: 'Consumed lots are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        // 1. 출고 내역 기록
        const outSql = `
            INSERT INTO logistics_outbound 
            (date, destination, item, spec, unit, qty, selling_price, shipping_fee)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.run(outSql, [date, destination, item, spec, unit, qty, selling_price, shipping_fee], function(err) {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }
            const outboundId = this.lastID;
            
            // 2. 각 Lot 차감 및 맵핑 테이블 기록
            const lotsSql = `INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`;
            const updateInboundSql = `UPDATE logistics_inbound SET qty_remaining = qty_remaining - ? WHERE id = ?`;
            
            const stmtLots = db.prepare(lotsSql);
            const stmtUpdate = db.prepare(updateInboundSql);
            
            let hasError = false;
            let errorMsg = '';
            
            // Promise 기반 순차 처리 (에러 핸들링 용이성)
            // 간단하게 동기적 흉내를 내기 위해 즉시 호출
            try {
                for (let lot of consumed_lots) {
                    stmtLots.run(outboundId, lot.inbound_id, lot.consumed_qty);
                    stmtUpdate.run(lot.consumed_qty, lot.inbound_id);
                }
            } catch (e) {
                hasError = true;
                errorMsg = e.message;
            } finally {
                stmtLots.finalize();
                stmtUpdate.finalize();
            }

            if (hasError) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: errorMsg });
            } else {
                db.run("COMMIT", (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.status(201).json({ message: 'Outbound success', id: outboundId });
                });
            }
        });
    });
});

module.exports = {
    router,
    initLogisticsTables,
    setDb
};
