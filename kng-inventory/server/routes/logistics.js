/**
 * 통합 물류 재고 관리 API (/api/logistics/...)
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const ExcelJS = require('exceljs');

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
                    // 테이블이 이미 존재할 수 있으므로 컬럼 추가 시도 (에러 무시)
                    const addColsInbound = [
                        "ALTER TABLE logistics_inbound ADD COLUMN note TEXT",
                        "ALTER TABLE logistics_inbound ADD COLUMN is_direct INTEGER DEFAULT 0",
                        "ALTER TABLE logistics_inbound ADD COLUMN category TEXT",
                        "ALTER TABLE logistics_inbound ADD COLUMN settlement_status TEXT DEFAULT '미정산'",
                        "ALTER TABLE logistics_inbound ADD COLUMN tax_invoice_date TEXT",
                        "ALTER TABLE logistics_inbound ADD COLUMN is_zero_tax INTEGER DEFAULT 0",
                        "ALTER TABLE logistics_inbound ADD COLUMN transaction_group_id TEXT",
                        "ALTER TABLE logistics_inbound ADD COLUMN settlement_qty REAL",
                        "ALTER TABLE logistics_inbound ADD COLUMN settlement_price REAL",
                        "ALTER TABLE logistics_inbound ADD COLUMN settlement_memo TEXT",
                        "ALTER TABLE logistics_inbound ADD COLUMN trade_type TEXT DEFAULT '내수'"
                    ];
                    database.serialize(() => {
                        addColsInbound.forEach(sql => database.run(sql, () => {}));
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
            `, (err) => {
                if (!err) {
                    const addColsOutbound = [
                        "ALTER TABLE logistics_outbound ADD COLUMN note TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN is_direct INTEGER DEFAULT 0",
                        "ALTER TABLE logistics_outbound ADD COLUMN actual_destination TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN shipping_fee_vat_included INTEGER DEFAULT 0",
                        "ALTER TABLE logistics_outbound ADD COLUMN category TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN settlement_status TEXT DEFAULT '미정산'",
                        "ALTER TABLE logistics_outbound ADD COLUMN tax_invoice_date TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN is_zero_tax INTEGER DEFAULT 0",
                        "ALTER TABLE logistics_outbound ADD COLUMN transaction_group_id TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN settlement_qty REAL",
                        "ALTER TABLE logistics_outbound ADD COLUMN settlement_price REAL",
                        "ALTER TABLE logistics_outbound ADD COLUMN settlement_memo TEXT",
                        "ALTER TABLE logistics_outbound ADD COLUMN trade_type TEXT DEFAULT '내수'"
                    ];
                    database.serialize(() => {
                        addColsOutbound.forEach(sql => database.run(sql, () => {}));
                    });
                }
            });

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
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_created ON logistics_outbound(created_at DESC)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_inbound_is_direct ON logistics_inbound(is_direct)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_is_direct ON logistics_outbound(is_direct)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_lots_outbound ON logistics_outbound_lots(outbound_id)`);
                database.run(`CREATE INDEX IF NOT EXISTS idx_outbound_lots_inbound ON logistics_outbound_lots(inbound_id)`, (err2) => {
                    if (err2) reject(err2);
                    else {
                        // 미부여된 고유번호(transaction_group_id) 자동 백필
                        database.all(`SELECT id, date FROM logistics_inbound WHERE transaction_group_id IS NULL OR transaction_group_id = '' ORDER BY date ASC, id ASC`, [], (errIn, inRows) => {
                            if (!errIn && inRows && inRows.length > 0) {
                                const inStmt = database.prepare(`UPDATE logistics_inbound SET transaction_group_id = ? WHERE id = ?`);
                                inRows.forEach((r, idx) => {
                                    const dateStr = (r.date || '').substring(0, 10).replace(/-/g, '') || '20260101';
                                    const txId = `IN-${dateStr}-${String(idx + 1).padStart(4, '0')}`;
                                    inStmt.run(txId, r.id);
                                });
                                inStmt.finalize();
                            }
                        });

                        database.all(`SELECT id, date FROM logistics_outbound WHERE transaction_group_id IS NULL OR transaction_group_id = '' ORDER BY date ASC, id ASC`, [], (errOut, outRows) => {
                            if (!errOut && outRows && outRows.length > 0) {
                                const outStmt = database.prepare(`UPDATE logistics_outbound SET transaction_group_id = ? WHERE id = ?`);
                                outRows.forEach((r, idx) => {
                                    const dateStr = (r.date || '').substring(0, 10).replace(/-/g, '') || '20260101';
                                    const txId = `OUT-${dateStr}-${String(idx + 1).padStart(4, '0')}`;
                                    outStmt.run(txId, r.id);
                                });
                                outStmt.finalize();
                            }
                        });

                        resolve();
                    }
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


// --- Bulk Update (일괄 수정) ---
router.put('/bulk-update', (req, res) => {
    const { inboundIds, outboundIds, supplier, destination, category } = req.body;
    
    if ((!inboundIds || inboundIds.length === 0) && (!outboundIds || outboundIds.length === 0)) {
        return res.status(400).json({ error: 'No items selected' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let hasError = false;

        const updateInboundSql = [];
        const updateInboundParams = [];
        if (supplier) { updateInboundSql.push('supplier = ?'); updateInboundParams.push(supplier); }
        if (category) { updateInboundSql.push('category = ?'); updateInboundParams.push(category); }
        
        if (inboundIds && inboundIds.length > 0 && updateInboundSql.length > 0) {
            const placeholders = inboundIds.map(() => '?').join(',');
            const sql = `UPDATE logistics_inbound SET ${updateInboundSql.join(', ')} WHERE id IN (${placeholders})`;
            db.run(sql, [...updateInboundParams, ...inboundIds], (err) => {
                if (err) hasError = true;
            });
        }

        const updateOutboundSql = [];
        const updateOutboundParams = [];
        if (destination) { updateOutboundSql.push('destination = ?'); updateOutboundParams.push(destination); }
        if (category) { updateOutboundSql.push('category = ?'); updateOutboundParams.push(category); }
        
        if (outboundIds && outboundIds.length > 0 && updateOutboundSql.length > 0) {
            const placeholders = outboundIds.map(() => '?').join(',');
            const sql = `UPDATE logistics_outbound SET ${updateOutboundSql.join(', ')} WHERE id IN (${placeholders})`;
            db.run(sql, [...updateOutboundParams, ...outboundIds], (err) => {
                if (err) hasError = true;
            });
        }

        db.run("SELECT 1", function() {
            if (hasError) {
                db.run("ROLLBACK");
                res.status(500).json({ error: "Bulk update failed" });
            } else {
                db.run("COMMIT", (err2) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    res.json({ message: 'Bulk update success' });
                });
            }
        });
    });
});


// --- Categories API ---
router.get('/categories', (req, res) => {
    const defaults = [
        '유압유', '기어유', '그리스', '테일씰그리스', '절삭유', '작동유', 
        '방청유', '엔진오일', '열매체유', '콤프레샤유', '세척유', '방전유', 
        '안전용품', '기타'
    ];
    const sql = `
        SELECT DISTINCT category FROM logistics_inbound WHERE category IS NOT NULL AND category != ''
        UNION
        SELECT DISTINCT category FROM logistics_outbound WHERE category IS NOT NULL AND category != ''
        UNION
        SELECT DISTINCT category FROM unit_prices_v2 WHERE category IS NOT NULL AND category != ''
        UNION
        SELECT DISTINCT category FROM supply_history WHERE category IS NOT NULL AND category != '' AND category != '미분류'
        UNION
        SELECT DISTINCT category FROM oil_supply_history WHERE category IS NOT NULL AND category != ''
    `;
    db.all(sql, [], (err, rows) => {
        const dbCats = (rows || []).map(r => r.category).filter(c => c && c.trim());
        const set = new Set([...defaults, ...dbCats]);
        const result = Array.from(set).filter(c => c && c.trim());
        res.json(result);
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
        const dateStr = (date || '').substring(0, 10).replace(/-/g, '');
        const txGroupId = `IN-${dateStr}-${Date.now().toString().slice(-6)}`;

        db.run("BEGIN TRANSACTION");
        const sql = `
            INSERT INTO logistics_inbound 
            (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, category, transaction_group_id, trade_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const stmt = db.prepare(sql);
        
        let hasError = false;
        let errorMsg = '';
        
        try {
            for (let i of items) {
                stmt.run(date, supplier, i.item, i.spec, i.unit, i.qty, i.qty, i.unit_price, location_id, i.note || '', i.category || '', txGroupId, i.trade_type || '내수');
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
    const { date, destination, actual_destination, items } = req.body;
    
    // 검증
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const dateStr = (date || '').substring(0, 10).replace(/-/g, '');
        const txGroupId = `OUT-${dateStr}-${Date.now().toString().slice(-6)}`;
        
        let hasError = false;
        
        const outSql = `
            INSERT INTO logistics_outbound 
            (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, category, transaction_group_id, trade_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            stmtOut.run(date, destination, actual_destination || '', i.item, i.spec, i.unit, i.qty, i.selling_price, i.shipping_fee || 0, i.shipping_fee_vat_included || 0, i.note || '', i.category || '', txGroupId, i.trade_type || '내수', function(err) {
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
                    res.status(201).json({ message: 'Outbound success' });
                });
            }
        });
    });
});

// --- History (입출고 전체 내역) ---
router.get('/history', (req, res) => {
    let { 
        page = 1, limit = 50, type = 'all', search = '',
        sortCol = 'date', sortDir = 'desc',
        startDate = '', endDate = '',
        searchParty = '', searchItem = '', searchSpec = '', searchTarget = '', searchKeyword = '', category = '',
        include_direct = 'false'
    } = req.query;

    page = parseInt(page, 10) || 1;
    limit = parseInt(limit, 10) || 50;
    const offset = (page - 1) * limit;

    const validSortCols = ['type', 'date', 'supplier', 'destination', 'item', 'spec', 'unit', 'qty', 'inbound_price', 'outbound_price', 'inbound_total', 'outbound_total', 'category'];
    const safeSortCol = validSortCols.includes(sortCol) ? sortCol : 'date';
    const safeSortDir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    let whereClauses = [];
    let params = [];

    if (type === 'inbound') {
        whereClauses.push("type = 'inbound'");
        if (include_direct !== 'true') {
            whereClauses.push("is_direct = 0");
        }
    } else if (type === 'outbound') {
        whereClauses.push("type = 'outbound'");
        if (include_direct !== 'true') {
            whereClauses.push("is_direct = 0");
        }
    }

    // Detailed search filters
    if (startDate) {
        whereClauses.push("date >= ?");
        params.push(startDate);
    }
    if (endDate) {
        whereClauses.push("date <= ?");
        params.push(endDate);
    }
    
    
    if (type === 'direct') {
        whereClauses.push("is_direct = 1");
    }

    if (category) {
        whereClauses.push("category = ?");
        params.push(category);
    }
    
    if (searchTarget && searchKeyword) {
        const kw = `%${searchKeyword.trim()}%`;
        switch(searchTarget) {
            case 'supplier':
                whereClauses.push("supplier LIKE ?"); params.push(kw); break;
            case 'destination':
                whereClauses.push("destination LIKE ?"); params.push(kw); break;
            case 'item':
                whereClauses.push("item LIKE ?"); params.push(kw); break;
            case 'spec':
                whereClauses.push("spec LIKE ?"); params.push(kw); break;
            case 'note':
                whereClauses.push("note LIKE ?"); params.push(kw); break;
            case 'category':
                whereClauses.push("category LIKE ?"); params.push(kw); break;
            default:
                whereClauses.push("(supplier LIKE ? OR destination LIKE ? OR item LIKE ? OR spec LIKE ? OR note LIKE ? OR category LIKE ?)");
                params.push(kw, kw, kw, kw, kw, kw);
                break;
        }
    }


    // General search (from the main search bar) (Kept for compatibility if used)
    const searchTerms = search.trim().split(/\s+/).filter(Boolean);
    if (searchTerms.length > 0) {
        searchTerms.forEach(term => {
            whereClauses.push(`(date LIKE ? OR supplier LIKE ? OR destination LIKE ? OR item LIKE ? OR spec LIKE ? OR note LIKE ? OR category LIKE ?)`);
            const likeTerm = `%${term}%`;
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
        });
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const baseSql = `
        WITH combined AS (
            SELECT 
                'inbound' as type, i.id, i.date, 
                i.supplier as supplier, NULL as destination, 
                NULL as actual_destination, i.item, i.spec, i.unit, i.category, 
                i.qty_initial as qty, 
                i.unit_price as inbound_price, NULL as outbound_price,
                (i.unit_price * i.qty_initial) as inbound_total, NULL as outbound_total,
                0 as shipping_fee, 0 as shipping_fee_vat_included, i.note, i.created_at,
                i.is_direct, i.settlement_status, i.tax_invoice_date, i.is_zero_tax,
                i.transaction_group_id, i.settlement_qty, i.settlement_price, i.settlement_memo, i.trade_type
            FROM logistics_inbound i
            ${type === 'inbound' ? '' : 'WHERE i.is_direct = 0'}
            UNION ALL
            SELECT 
                'outbound' as type, o.id, o.date, 
                CASE WHEN o.is_direct = 1 THEN di.supplier ELSE NULL END as supplier, 
                o.destination as destination, 
                o.actual_destination, o.item, o.spec, o.unit, o.category, 
                o.qty as qty, 
                CASE WHEN o.is_direct = 1 THEN di.unit_price ELSE NULL END as inbound_price, 
                o.selling_price as outbound_price, 
                CASE WHEN o.is_direct = 1 THEN (di.unit_price * o.qty) ELSE NULL END as inbound_total,
                (o.selling_price * o.qty) as outbound_total,
                o.shipping_fee, o.shipping_fee_vat_included, o.note, o.created_at,
                o.is_direct, o.settlement_status, o.tax_invoice_date, o.is_zero_tax,
                o.transaction_group_id, o.settlement_qty, o.settlement_price, o.settlement_memo, o.trade_type
            FROM logistics_outbound o
            LEFT JOIN logistics_outbound_lots dl ON o.is_direct = 1 AND dl.outbound_id = o.id
            LEFT JOIN logistics_inbound di ON dl.inbound_id = di.id
        )
        SELECT * FROM combined
        ${whereStr}
    `;

    const countSql = `SELECT COUNT(*) as total FROM (${baseSql})`;
    const dataSql = `
        ${baseSql}
        ORDER BY ${safeSortCol} ${safeSortDir}, created_at DESC
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

// --- 상세 내역 조회 (모달용) ---
router.get('/history/inbound/:id', (req, res) => {
    const id = req.params.id;
    const sql = `
        SELECT i.*, l.name as location_name
        FROM logistics_inbound i
        LEFT JOIN logistics_locations l ON i.location_id = l.id
        WHERE i.id = ?
    `;
    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Record not found' });
        
        row.type = 'inbound';
        
        const groupSql = row.transaction_group_id 
            ? `SELECT i.*, l.name as location_name FROM logistics_inbound i LEFT JOIN logistics_locations l ON i.location_id = l.id WHERE i.transaction_group_id = ? ORDER BY i.id ASC`
            : `SELECT i.*, l.name as location_name FROM logistics_inbound i LEFT JOIN logistics_locations l ON i.location_id = l.id WHERE i.date = ? AND i.supplier = ? AND i.created_at = ? ORDER BY i.id ASC`;
        const groupParams = row.transaction_group_id ? [row.transaction_group_id] : [row.date, row.supplier, row.created_at];

        db.all(groupSql, groupParams, (err2, items) => {
            if (err2) return res.status(500).json({ error: err2.message });
            row.items = items;
            res.json(row);
        });
    });
});

router.get('/history/outbound/:id', (req, res) => {
    const id = req.params.id;
    const sql = `SELECT * FROM logistics_outbound WHERE id = ?`;
    db.get(sql, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Record not found' });
        
        row.type = 'outbound';
        
        const groupSql = row.transaction_group_id
            ? `SELECT * FROM logistics_outbound WHERE transaction_group_id = ? ORDER BY id ASC`
            : `SELECT * FROM logistics_outbound WHERE date = ? AND destination = ? AND created_at = ? ORDER BY id ASC`;
        const groupParams = row.transaction_group_id ? [row.transaction_group_id] : [row.date, row.destination, row.created_at];

        db.all(groupSql, groupParams, (err2, items) => {
            if (err2) return res.status(500).json({ error: err2.message });
            
            const itemIds = items.map(i => i.id);
            if (itemIds.length === 0) {
                row.items = [];
                return res.json(row);
            }
            
            const placeholders = itemIds.map(() => '?').join(',');
            const lotsSql = `
                SELECT l.outbound_id, l.inbound_id, l.consumed_qty, i.supplier, i.date as inbound_date, loc.name as location_name, i.unit_price
                FROM logistics_outbound_lots l
                JOIN logistics_inbound i ON l.inbound_id = i.id
                LEFT JOIN logistics_locations loc ON i.location_id = loc.id
                WHERE l.outbound_id IN (${placeholders})
            `;
            db.all(lotsSql, itemIds, (err3, lots) => {
                if (err3) return res.status(500).json({ error: err3.message });
                
                items.forEach(item => {
                    const itemLots = lots.filter(l => l.outbound_id === item.id);
                    item.consumed_lots = itemLots;
                    if (row.is_direct === 1 && itemLots.length > 0) {
                        item.supplier = itemLots[0].supplier;
                        item.inbound_price = itemLots[0].unit_price;
                    }
                });
                
                if (row.is_direct === 1 && lots.length > 0) {
                    row.supplier = lots[0].supplier;
                    row.inbound_price = lots[0].unit_price;
                }
                
                row.items = items;
                res.json(row);
            });
        });
    });
});

// --- Direct (직출고) ---
// --- 직출고 엑셀 템플릿 다운로드 ---
router.get('/direct/template', async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('직출고 일괄등록');

        worksheet.columns = [
            { header: '일자 (YYYY-MM-DD)', key: 'date', width: 15 },
            { header: '매입처', key: 'supplier', width: 20 },
            { header: '매출처', key: 'destination', width: 20 },
            { header: '실도착지', key: 'actual_destination', width: 20 },
            { header: '분류', key: 'category', width: 15 },
            { header: '품목명', key: 'item', width: 30 },
            { header: '규격', key: 'spec', width: 20 },
            { header: '단위', key: 'unit', width: 10 },
            { header: '수량', key: 'qty', width: 15 },
            { header: '매입단가', key: 'in_price', width: 15 },
            { header: '매출단가', key: 'out_price', width: 15 },
            { header: '운반비 (매출)', key: 'shipping_fee', width: 15 },
            { header: '운반비 부가세포함(Y/N)', key: 'shipping_vat', width: 15 },
            { header: '비고', key: 'note', width: 25 },
            { header: '구분(내수/수출)', key: 'trade_type', width: 15 }
        ];

        // Header style
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
            
            // Get values safely
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
            const category = getVal(5);
            const item = getVal(6);
            const spec = getVal(7);
            const unit = getVal(8);
            const qty = parseFloat(getVal(9)) || 0;
            const in_price = parseFloat(getVal(10)) || 0;
            const out_price = parseFloat(getVal(11)) || 0;
            const shipping_fee = parseFloat(getVal(12)) || 0;
            const shipping_vat_raw = getVal(13).toUpperCase();
            const shipping_vat = (shipping_vat_raw === 'Y' || shipping_vat_raw === '1' || shipping_vat_raw === 'TRUE') ? 1 : 0;
            const note = getVal(14);
            const trade_type = getVal(15) || '내수';

            if (!date || !supplier || !destination || !item || qty === 0 || in_price < 0) {
                return; // Skip invalid rows
            }

            rows.push({
                date, supplier, destination, actual_destination, category, item, spec, unit, qty, in_price, out_price, shipping_fee, shipping_vat, note, trade_type
            });
        });

        if (rows.length === 0) {
            return res.status(400).json({ error: 'No valid data found in excel' });
        }

        // --- VALIDATION BLOCK (Strategy B) ---
        const partners = await new Promise((resolve, reject) => {
            db.all("SELECT name, company_name FROM partners", [], (err, pRows) => {
                if (err) reject(err);
                else resolve(pRows || []);
            });
        });
        
        const validNames = new Set();
        partners.forEach(p => {
            if (p.name) validNames.add(p.name);
            if (p.company_name) validNames.add(p.company_name);
        });

        const invalidPartners = new Set();
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (!validNames.has(r.supplier)) invalidPartners.add(`(줄 ${i+2}) ${r.supplier}`);
            if (!validNames.has(r.destination)) invalidPartners.add(`(줄 ${i+2}) ${r.destination}`);
        }

        if (invalidPartners.size > 0) {
            const errList = Array.from(invalidPartners).join(', ');
            return res.status(400).json({ 
                error: `다음 텍스트가 등록된 거래처명과 일치하지 않습니다. 공식 명칭을 쓰거나 거래처 관리에 먼저 등록해주세요: ${errList}`
            });
        }
        // ------------------------

        // Group rows by date + supplier + destination + actual_destination + shipping_fee + shipping_vat + note + trade_type
        const grouped = {};
        for (const r of rows) {
            const key = `${r.date}|${r.supplier}|${r.destination}|${r.actual_destination}|${r.shipping_fee}|${r.shipping_vat}|${r.note}|${r.trade_type}`;
            if (!grouped[key]) {
                grouped[key] = {
                    date: r.date,
                    supplier: r.supplier,
                    destination: r.destination,
                    actual_destination: r.actual_destination,
                    shipping_fee: r.shipping_fee,
                    shipping_fee_vat_included: r.shipping_vat,
                    note: r.note,
                    trade_type: r.trade_type || '내수',
                    items: []
                };
            }
            grouped[key].items.push({
                item: r.item,
                spec: r.spec,
                unit: r.unit,
                qty: r.qty,
                category: r.category,
                in_price: r.in_price,
                out_price: r.out_price
            });
        }

        const groups = Object.values(grouped);

        // Process each group inside a transaction sequentially
        let groupSeq = 0;
        for (const g of groups) {
            groupSeq++;
            const dateStr = (g.date || '').substring(0, 10).replace(/-/g, '');
            const timeStr = Date.now().toString().slice(-4);
            const randSuffix = String(groupSeq).padStart(3, '0') + Math.floor(10 + Math.random() * 90);
            const txInGroupId = `IN-${dateStr}-${timeStr}${randSuffix}`;
            const txOutGroupId = `OUT-${dateStr}-${timeStr}${randSuffix}`;

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
                        // 1. Insert Inbound
                        db.run(`
                            INSERT INTO logistics_inbound (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, is_direct, category, transaction_group_id, trade_type)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)
                        `, [g.date, g.supplier, currentItem.item, currentItem.spec, currentItem.unit, currentItem.qty, 0, currentItem.in_price, g.note, currentItem.category || '', txInGroupId, g.trade_type || '내수'], function(err) {
                            if (err) {
                                hasError = true;
                                db.run("ROLLBACK");
                                return reject(err);
                            }
                            const inboundId = this.lastID;

                            // 2. Insert Outbound
                            // Add shipping fee only for the first item of the group to avoid duplication
                            const itemShipping = idx === 0 ? g.shipping_fee : 0;
                            const itemShippingVat = idx === 0 ? g.shipping_fee_vat_included : 0;

                            db.run(`
                                INSERT INTO logistics_outbound (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, is_direct, category, transaction_group_id, trade_type)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                            `, [g.date, g.destination, g.actual_destination || '', currentItem.item, currentItem.spec, currentItem.unit, currentItem.qty, currentItem.out_price, itemShipping, itemShippingVat, g.note, currentItem.category || '', txOutGroupId, g.trade_type || '내수'], function(err) {
                                if (err) {
                                    hasError = true;
                                    db.run("ROLLBACK");
                                    return reject(err);
                                }
                                const outboundId = this.lastID;

                                // 3. Link them in lots
                                db.run(`
                                    INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty)
                                    VALUES (?, ?, ?)
                                `, [outboundId, inboundId, currentItem.qty], function(err) {
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

router.post('/direct', (req, res) => {
    const { date, supplier, destination, actual_destination, items } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        let hasError = false;
        
        const dateStr = (date || '').substring(0, 10).replace(/-/g, '');
        const timeStr = Date.now().toString().slice(-6);
        const txInGroupId = `IN-${dateStr}-${timeStr}`;
        const txOutGroupId = `OUT-${dateStr}-${timeStr}`;
        
        const inSql = `
            INSERT INTO logistics_inbound 
            (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, is_direct, category, transaction_group_id, trade_type)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 1, ?, ?, ?)
        `;
        
        const outSql = `
            INSERT INTO logistics_outbound 
            (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, is_direct, category, transaction_group_id, trade_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `;
        
        // 3. Mapping insert
        const lotsSql = `INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`;
        
        const stmtIn = db.prepare(inSql);
        const stmtOut = db.prepare(outSql);
        const stmtLots = db.prepare(lotsSql);

        for (let i of items) {
            // Because of db.serialize, these callbacks will execute in order.
            stmtIn.run(date, supplier, i.item, i.spec, i.unit, i.qty, i.unit_price, i.note || '', i.category || '', txInGroupId, i.trade_type || '내수', function(errIn) {
                if (errIn) { hasError = true; return; }
                const inboundId = this.lastID;
                
                stmtOut.run(date, destination, actual_destination || '', i.item, i.spec, i.unit, i.qty, i.selling_price, i.shipping_fee || 0, i.shipping_fee_vat_included || 0, i.note || '', i.category || '', txOutGroupId, i.trade_type || '내수', function(errOut) {
                    if (errOut) { hasError = true; return; }
                    const outboundId = this.lastID;
                    
                    stmtLots.run(outboundId, inboundId, i.qty, function(errLots) {
                        if (errLots) hasError = true;
                    });
                });
            });
        }
        
        // Statements finalize barrier
        db.run("SELECT 1", function() {
            stmtIn.finalize();
            stmtOut.finalize();
            stmtLots.finalize();
            
            if (hasError) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: "Direct shipment transaction failed" });
            } else {
                db.run("COMMIT", (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.status(201).json({ message: 'Direct shipment success' });
                });
            }
        });
    });
});

// --- 정산 상태 업데이트 ---
router.post('/settlement/:type', (req, res) => {
    const type = req.params.type;
    const { items, ids, tax_invoice_date, is_zero_tax } = req.body;
    
    const table = type === 'inbound' ? 'logistics_inbound' : (type === 'outbound' ? 'logistics_outbound' : null);
    if (!table) return res.status(400).json({ error: 'Invalid type' });

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let hasError = false;

        if (items && Array.isArray(items)) {
            // 개별 정산 (수량, 단가, 비고 포함)
            const stmt = db.prepare(`UPDATE ${table} SET settlement_status = '정산완료', tax_invoice_date = ?, is_zero_tax = ?, settlement_qty = ?, settlement_price = ?, settlement_memo = ? WHERE id = ?`);
            for (let i of items) {
                stmt.run(i.tax_invoice_date, i.is_zero_tax ? 1 : 0, i.settlement_qty, i.settlement_price, i.settlement_memo || '', i.id, function(e) { if(e) hasError = true; });
            }
            stmt.finalize();
        } else if (ids && Array.isArray(ids)) {
            // 단순 상태 변경 (정산 취소 등)
            const status = tax_invoice_date ? '정산완료' : '미정산';
            const placeholders = ids.map(() => '?').join(',');
            const sql = `UPDATE ${table} SET settlement_status = ?, tax_invoice_date = ?, is_zero_tax = ? WHERE id IN (${placeholders})`;
            db.run(sql, [status, tax_invoice_date || null, is_zero_tax ? 1 : 0, ...ids], function(err) {
                if(err) hasError = true;
            });
        } else {
             db.run("ROLLBACK");
             return res.status(400).json({ error: 'Invalid payload' });
        }

        db.run("SELECT 1", function() {
            if (hasError) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: 'Settlement update failed' });
            } else {
                db.run("COMMIT");
                res.json({ message: 'Settlement updated' });
            }
        });
    });
});

// --- Inbound Update (입고 내역 수정) ---
router.put('/direct/:id', (req, res) => {
    const id = req.params.id; // This is the outbound_id
    const { date, supplier, destination, actual_destination, qty, inbound_price, selling_price, shipping_fee, shipping_fee_vat_included, note, category, trade_type } = req.body;
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        // Find the mapped inbound lot
        db.get(`SELECT inbound_id FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], (err, lot) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }
            if (!lot) {
                db.run("ROLLBACK");
                return res.status(404).json({ error: 'Direct outbound mapping not found' });
            }
            
            const inboundId = lot.inbound_id;
            let hasError = false;

            // 1. Update Inbound
            const inSql = `
                UPDATE logistics_inbound
                SET date = ?, supplier = ?, qty_initial = ?, unit_price = ?, note = ?, category = ?, trade_type = ?
                WHERE id = ?
            `;
            db.run(inSql, [date, supplier, qty, inbound_price, note || '', category || '', trade_type || '내수', inboundId], function(e) { if(e) hasError = true; });

            // 2. Update Outbound
            const outSql = `
                UPDATE logistics_outbound
                SET date = ?, destination = ?, actual_destination = ?, qty = ?, selling_price = ?, shipping_fee = ?, shipping_fee_vat_included = ?, note = ?, category = ?, trade_type = ?
                WHERE id = ?
            `;
            db.run(outSql, [date, destination, actual_destination || '', qty, selling_price, shipping_fee, shipping_fee_vat_included || 0, note || '', category || '', trade_type || '내수', id], function(e) { if(e) hasError = true; });

            // 3. Update Lots
            const lotSql = `UPDATE logistics_outbound_lots SET consumed_qty = ? WHERE outbound_id = ? AND inbound_id = ?`;
            db.run(lotSql, [qty, id, inboundId], function(e) { if(e) hasError = true; });

            db.run("SELECT 1", function() {
                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: 'Failed to update direct outbound' });
                }
                db.run("COMMIT", (errCommit) => {
                    if (errCommit) return res.status(500).json({ error: errCommit.message });
                    res.json({ success: true });
                });
            });
        });
    });
});

router.put('/inbound/:id', (req, res) => {
    const id = req.params.id;
    const { date, supplier, item, spec, unit, qty, unit_price, location_id, note, trade_type, category } = req.body;
    
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
            
            const consumed = row.qty_initial - row.qty_remaining;
            
            if (qty < consumed) {
                db.run("ROLLBACK");
                return res.status(400).json({ error: `이미 출고 차감된 수량(${consumed})보다 적게 수정할 수 없습니다.` });
            }
            
            const new_qty_remaining = qty - consumed;
            
            let finalItem = item;
            let finalSpec = spec;
            let finalUnit = unit;
            
            const updateSql = `
                UPDATE logistics_inbound 
                SET date = ?, supplier = ?, item = ?, spec = ?, unit = ?, 
                    qty_initial = ?, qty_remaining = ?, unit_price = ?, location_id = ?, note = ?, trade_type = ?, category = ?
                WHERE id = ?
            `;
            
            db.run(updateSql, [date, supplier, finalItem, finalSpec, finalUnit, qty, new_qty_remaining, unit_price, location_id, note || '', trade_type || '내수', category || '', id], function(err2) {
                if (err2) {
                    db.run("ROLLBACK");
                    return res.status(500).json({ error: err2.message });
                }
                
                db.run("COMMIT", (err3) => {
                    if (err3) return res.status(500).json({ error: err3.message });
                    res.json({ message: 'Updated successfully' });
                });
            });
        });
    });
});

// --- Outbound Update (출고 내역 수정) ---
router.put('/outbound/:id', (req, res) => {
    const id = req.params.id;
    const { date, destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, consumed_lots, trade_type, category } = req.body;
    
    if (!consumed_lots || !Array.isArray(consumed_lots)) {
        return res.status(400).json({ error: 'consumed_lots are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        // 1. 기존 출고로 차감되었던 재고 복구
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
                    return res.status(500).json({ error: 'Failed to restore old inbound inventory' });
                }
                
                // 2. 기존 매핑(lots) 삭제
                db.run(`DELETE FROM logistics_outbound_lots WHERE outbound_id = ?`, [id], function(err3) {
                    if (err3) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: err3.message });
                    }
                    
                    // 3. 출고 테이블 업데이트
                    const outUpdateSql = `
                        UPDATE logistics_outbound 
                        SET date = ?, destination = ?, actual_destination = ?, item = ?, spec = ?, unit = ?, 
                            qty = ?, selling_price = ?, shipping_fee = ?, shipping_fee_vat_included = ?, note = ?, trade_type = ?, category = ?
                        WHERE id = ?
                    `;
                    db.run(outUpdateSql, [date, destination, req.body.actual_destination || '', item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included || 0, note || '', trade_type || '내수', category || '', id], function(err4) {
                        if (err4) {
                            db.run("ROLLBACK");
                            return res.status(500).json({ error: err4.message });
                        }
                        
                        // 4. 새로운 매핑(lots) 삽입 및 재고 차감
                        const lotsSql = `INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`;
                        const updateInboundSql = `UPDATE logistics_inbound SET qty_remaining = qty_remaining - ? WHERE id = ?`;
                        
                        const stmtLots = db.prepare(lotsSql);
                        const stmtUpdate = db.prepare(updateInboundSql);
                        
                        for (let lot of consumed_lots) {
                            stmtLots.run(id, lot.inbound_id, lot.consumed_qty, function(e) { if(e) hasError = true; });
                            stmtUpdate.run(lot.consumed_qty, lot.inbound_id, function(e) { if(e) hasError = true; });
                        }
                        
                        db.run("SELECT 1", function() {
                            stmtLots.finalize();
                            stmtUpdate.finalize();
                            
                            if (hasError) {
                                db.run("ROLLBACK");
                                return res.status(500).json({ error: "Failed to apply new consumed lots" });
                            } else {
                                db.run("COMMIT", (err5) => {
                                    if (err5) return res.status(500).json({ error: err5.message });
                                    res.json({ message: 'Outbound updated successfully' });
                                });
                            }
                        });
                    });
                });
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
                
                db.run(`DELETE FROM logistics_inbound WHERE is_direct = 1 AND qty_remaining = qty_initial`, function(errClean) {
                    // Ignore errors for cleanup, or log them
                    if (errClean) console.error("Error cleaning up direct inbound:", errClean);

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
});

router.get('/migrate-partners', async (req, res) => {
    try {
        const partners = await new Promise((resolve, reject) => {
            db.all("SELECT id, name, company_name FROM partners", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        if (partners.length === 0) {
            return res.json({ message: 'No partners found in the database. Migration skipped.' });
        }

        const findMatchingPartner = (textName) => {
            if (!textName) return null;
            textName = textName.trim();
            let match = partners.find(p => p.name === textName || p.company_name === textName);
            if (match) return match.name;
            match = partners.find(p => p.name.includes(textName) || (p.company_name && p.company_name.includes(textName)));
            if (match) return match.name;
            match = partners.find(p => textName.includes(p.name) || (p.company_name && textName.includes(p.company_name)));
            if (match) return match.name;
            return null;
        };

        const inboundRows = await new Promise((resolve) => {
            db.all("SELECT id, supplier FROM logistics_inbound", [], (err, rows) => resolve(rows || []));
        });

        let inboundUpdated = 0;
        for (const row of inboundRows) {
            const matchedName = findMatchingPartner(row.supplier);
            if (matchedName && matchedName !== row.supplier) {
                await new Promise((resolve) => db.run("UPDATE logistics_inbound SET supplier = ? WHERE id = ?", [matchedName, row.id], resolve));
                inboundUpdated++;
            }
        }

        const outboundRows = await new Promise((resolve) => {
            db.all("SELECT id, destination FROM logistics_outbound", [], (err, rows) => resolve(rows || []));
        });

        let outboundUpdated = 0;
        for (const row of outboundRows) {
            const matchedName = findMatchingPartner(row.destination);
            if (matchedName && matchedName !== row.destination) {
                await new Promise((resolve) => db.run("UPDATE logistics_outbound SET destination = ? WHERE id = ?", [matchedName, row.id], resolve));
                outboundUpdated++;
            }
        }

        res.json({ 
            success: true, 
            message: '마이그레이션이 성공적으로 완료되었습니다.', 
            inboundUpdated, 
            outboundUpdated 
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/migrate-tx-ids', async (req, res) => {
    try {
        const updateRecords = (tableName, partnerCol, prefix) => {
            return new Promise((resolve, reject) => {
                db.all(`SELECT id, date, ${partnerCol} as partner, transaction_group_id FROM ${tableName} ORDER BY date ASC, id ASC`, [], (err, rows) => {
                    if (err) return reject(err);
                    if (!rows || rows.length === 0) return resolve(0);

                    const counters = {};
                    const groupIds = {};
                    const updateStmt = db.prepare(`UPDATE ${tableName} SET transaction_group_id = ? WHERE id = ?`);
                    
                    let updatedCount = 0;

                    db.serialize(() => {
                        db.run("BEGIN TRANSACTION");
                        rows.forEach(row => {
                            if (row.transaction_group_id) return;
                            const dateStr = (row.date || '').substring(0, 10).replace(/-/g, '');
                            if (!dateStr) return;

                            const groupKey = `${dateStr}_${row.partner}`;
                            let txId = groupIds[groupKey];

                            if (!txId) {
                                if (!counters[dateStr]) counters[dateStr] = 0;
                                counters[dateStr]++;
                                const seq = String(counters[dateStr]).padStart(3, '0');
                                txId = `${prefix}-${dateStr}-${seq}`;
                                groupIds[groupKey] = txId;
                            }

                            updateStmt.run(txId, row.id);
                            updatedCount++;
                        });
                        updateStmt.finalize();
                        db.run("COMMIT", (err) => {
                            if (err) reject(err);
                            else resolve(updatedCount);
                        });
                    });
                });
            });
        };

        const inCount = await updateRecords('logistics_inbound', 'supplier', 'IN');
        const outCount = await updateRecords('logistics_outbound', 'destination', 'OUT');

        res.json({ success: true, message: 'Transaction ID 백필 완료', inCount, outCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// --- Transaction Group GET APIs ---
router.get('/history/inbound/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    const sql = `
        SELECT i.*, l.name as location_name
        FROM logistics_inbound i
        LEFT JOIN logistics_locations l ON i.location_id = l.id
        WHERE i.transaction_group_id = ?
        ORDER BY i.id ASC
    `;
    db.all(sql, [txId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.get('/history/outbound/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    const sql = `
        SELECT o.*,
            (SELECT json_group_array(json_object('inbound_id', inbound_id, 'consumed_qty', consumed_qty)) 
             FROM logistics_outbound_lots WHERE outbound_id = o.id) as consumed_lots
        FROM logistics_outbound o
        WHERE o.transaction_group_id = ?
        ORDER BY o.id ASC
    `;
    db.all(sql, [txId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(r => {
            if (r.consumed_lots) r.consumed_lots = JSON.parse(r.consumed_lots);
        });
        res.json(rows);
    });
});

router.get('/history/direct/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    // Direct requires fetching inbound_price too
    const sql = `
        SELECT o.*, i.unit_price as inbound_price, i.supplier as supplier
        FROM logistics_outbound o
        JOIN logistics_outbound_lots l ON o.id = l.outbound_id
        JOIN logistics_inbound i ON l.inbound_id = i.id
        WHERE o.transaction_group_id = ?
        ORDER BY o.id ASC
    `;
    db.all(sql, [txId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- Transaction Group PUT APIs ---
router.put('/inbound/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    const { date, supplier, location_id, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let hasError = false;
        let errorMsg = null;

        db.all("SELECT id, qty_initial, qty_remaining FROM logistics_inbound WHERE transaction_group_id = ?", [txId], (err, existingRows) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            const existingIds = existingRows.map(r => r.id);
            const payloadIds = items.filter(i => i.id).map(i => parseInt(i.id));
            const idsToDelete = existingIds.filter(id => !payloadIds.includes(id));

            for (let id of idsToDelete) {
                const row = existingRows.find(r => r.id === id);
                if (row.qty_initial > row.qty_remaining) {
                    db.run("ROLLBACK");
                    return res.status(400).json({ error: '이미 사용(출고)된 입고 내역은 삭제할 수 없습니다.' });
                }
            }

            if (idsToDelete.length > 0) {
                const placeholders = idsToDelete.map(() => '?').join(',');
                db.run(`DELETE FROM logistics_inbound WHERE id IN (${placeholders})`, idsToDelete, function(e) {
                    if(e) { hasError = true; errorMsg = e.message; }
                });
            }

            const commonDate = date;
            const commonSupplier = supplier;

            const updateSql = `UPDATE logistics_inbound SET date = ?, supplier = ?, item = ?, spec = ?, unit = ?, qty_initial = ?, qty_remaining = ?, unit_price = ?, location_id = ?, note = ?, trade_type = ?, category = ? WHERE id = ?`;
            const insertSql = `INSERT INTO logistics_inbound (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, category, transaction_group_id, trade_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const stmtUpdate = db.prepare(updateSql);
            const stmtInsert = db.prepare(insertSql);

            for (let i of items) {
                const cat = i.category || '';
                if (i.id) {
                    const row = existingRows.find(r => r.id === parseInt(i.id));
                    if (!row) continue;
                    
                    const consumed = row.qty_initial - row.qty_remaining;
                    if (parseFloat(i.qty) < consumed) {
                        hasError = true;
                        errorMsg = `이미 출고 차감된 수량(${consumed})보다 적게 수정할 수 없습니다.`;
                        break;
                    }
                    const new_qty_remaining = parseFloat(i.qty) - consumed;

                    stmtUpdate.run(commonDate, commonSupplier, i.item, i.spec, i.unit, parseFloat(i.qty), new_qty_remaining, parseFloat(i.unit_price) || 0, location_id, i.note || '', i.trade_type || '내수', cat, parseInt(i.id), function(e) {
                        if(e) { hasError = true; errorMsg = e.message; }
                    });
                } else {
                    stmtInsert.run(commonDate, commonSupplier, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.qty), parseFloat(i.unit_price) || 0, location_id, i.note || '', cat, txId, i.trade_type || '내수', function(e) {
                        if(e) { hasError = true; errorMsg = e.message; }
                    });
                }
            }

            db.run("SELECT 1", function() {
                stmtUpdate.finalize();
                stmtInsert.finalize();

                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(400).json({ error: errorMsg || 'Update failed' });
                }
                
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });
                    res.json({ success: true, message: 'Inbound transaction updated' });
                });
            });
        });
    });
});

router.put('/outbound/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    const { date, destination, actual_destination, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let hasError = false;
        let errorMsg = null;

        db.all("SELECT id FROM logistics_outbound WHERE transaction_group_id = ?", [txId], (err, existingRows) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            const existingIds = existingRows.map(r => r.id);
            const payloadIds = items.filter(i => i.id).map(i => parseInt(i.id));
            const idsToDelete = existingIds.filter(id => !payloadIds.includes(id));

            if (idsToDelete.length > 0) {
                const placeholders = idsToDelete.map(() => '?').join(',');
                db.all(`SELECT outbound_id, inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id IN (${placeholders})`, idsToDelete, (err2, oldLots) => {
                    if(err2) { hasError = true; errorMsg = err2.message; return; }
                    
                    const stmtRestore = db.prepare(`UPDATE logistics_inbound SET qty_remaining = qty_remaining + ? WHERE id = ?`);
                    oldLots.forEach(lot => {
                        stmtRestore.run(lot.consumed_qty, lot.inbound_id);
                    });
                    stmtRestore.finalize();

                    db.run(`DELETE FROM logistics_outbound_lots WHERE outbound_id IN (${placeholders})`, idsToDelete);
                    db.run(`DELETE FROM logistics_outbound WHERE id IN (${placeholders})`, idsToDelete);
                });
            }

            const commonDate = date;
            const commonDest = destination;
            const commonActualDest = actual_destination || '';

            const updateSql = `UPDATE logistics_outbound SET date = ?, destination = ?, actual_destination = ?, item = ?, spec = ?, unit = ?, qty = ?, selling_price = ?, shipping_fee = ?, shipping_fee_vat_included = ?, note = ?, trade_type = ?, category = ? WHERE id = ?`;
            const insertSql = `INSERT INTO logistics_outbound (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, category, transaction_group_id, trade_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

            const stmtUpdate = db.prepare(updateSql);
            const stmtInsert = db.prepare(insertSql);
            
            const stmtRestoreLots = db.prepare(`UPDATE logistics_inbound SET qty_remaining = qty_remaining + ? WHERE id = ?`);
            const stmtDeleteLots = db.prepare(`DELETE FROM logistics_outbound_lots WHERE outbound_id = ?`);
            const stmtConsumeLots = db.prepare(`UPDATE logistics_inbound SET qty_remaining = qty_remaining - ? WHERE id = ?`);
            const stmtInsertLots = db.prepare(`INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`);

            for (let i of items) {
                const cat = i.category || '';
                if (i.id) {
                    const oId = parseInt(i.id);
                    stmtUpdate.run(commonDate, commonDest, commonActualDest, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.selling_price) || 0, parseFloat(i.shipping_fee) || 0, i.shipping_fee_vat_included ? 1 : 0, i.note || '', i.trade_type || '내수', cat, oId, function(e) {
                        if(e) { hasError = true; errorMsg = e.message; }
                    });

                    db.all(`SELECT inbound_id, consumed_qty FROM logistics_outbound_lots WHERE outbound_id = ?`, [oId], (errL, oldLots) => {
                        if(oldLots) {
                            oldLots.forEach(l => stmtRestoreLots.run(l.consumed_qty, l.inbound_id));
                            stmtDeleteLots.run(oId);
                            if (i.consumed_lots) {
                                i.consumed_lots.forEach(lot => {
                                    stmtConsumeLots.run(lot.consumed_qty, lot.inbound_id);
                                    stmtInsertLots.run(oId, lot.inbound_id, lot.consumed_qty);
                                });
                            }
                        }
                    });
                } else {
                    stmtInsert.run(commonDate, commonDest, commonActualDest, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.selling_price) || 0, parseFloat(i.shipping_fee) || 0, i.shipping_fee_vat_included ? 1 : 0, i.note || '', cat, txId, i.trade_type || '내수', function(e) {
                        if(e) { hasError = true; errorMsg = e.message; return; }
                        const newId = this.lastID;
                        if (i.consumed_lots) {
                            i.consumed_lots.forEach(lot => {
                                stmtConsumeLots.run(lot.consumed_qty, lot.inbound_id);
                                stmtInsertLots.run(newId, lot.inbound_id, lot.consumed_qty);
                            });
                        }
                    });
                }
            }

            db.run("SELECT 1", function() {
                stmtUpdate.finalize(); stmtInsert.finalize();
                stmtRestoreLots.finalize(); stmtDeleteLots.finalize();
                stmtConsumeLots.finalize(); stmtInsertLots.finalize();

                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(400).json({ error: errorMsg || 'Update failed' });
                }
                
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });
                    res.json({ success: true, message: 'Outbound transaction updated' });
                });
            });
        });
    });
});

router.put('/direct/tx/:tx_id', (req, res) => {
    const txId = req.params.tx_id;
    const { date, supplier, destination, actual_destination, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required' });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let hasError = false;
        let errorMsg = null;

        db.all("SELECT id FROM logistics_outbound WHERE transaction_group_id = ?", [txId], (err, existingRows) => {
            if (err) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: err.message });
            }

            const existingIds = existingRows.map(r => r.id);
            const payloadIds = items.filter(i => i.id).map(i => parseInt(i.id));
            const idsToDelete = existingIds.filter(id => !payloadIds.includes(id));

            if (idsToDelete.length > 0) {
                const placeholders = idsToDelete.map(() => '?').join(',');
                db.all(`SELECT outbound_id, inbound_id FROM logistics_outbound_lots WHERE outbound_id IN (${placeholders})`, idsToDelete, (err2, oldLots) => {
                    if(err2) { hasError = true; errorMsg = err2.message; return; }
                    
                    const inboundIdsToDelete = oldLots.map(l => l.inbound_id);
                    db.run(`DELETE FROM logistics_outbound_lots WHERE outbound_id IN (${placeholders})`, idsToDelete);
                    db.run(`DELETE FROM logistics_outbound WHERE id IN (${placeholders})`, idsToDelete);
                    if (inboundIdsToDelete.length > 0) {
                        const inPlaceholders = inboundIdsToDelete.map(() => '?').join(',');
                        db.run(`DELETE FROM logistics_inbound WHERE id IN (${inPlaceholders})`, inboundIdsToDelete);
                    }
                });
            }

            const commonDate = date;
            const commonSupplier = supplier;
            const commonDest = destination;
            const commonActualDest = actual_destination || '';
            const txInGroupId = txId.replace('OUT', 'IN');

            const updateInSql = `UPDATE logistics_inbound SET date = ?, supplier = ?, item = ?, spec = ?, unit = ?, qty_initial = ?, unit_price = ?, note = ?, trade_type = ?, category = ? WHERE id = ?`;
            const updateOutSql = `UPDATE logistics_outbound SET date = ?, destination = ?, actual_destination = ?, item = ?, spec = ?, unit = ?, qty = ?, selling_price = ?, shipping_fee = ?, shipping_fee_vat_included = ?, note = ?, trade_type = ?, category = ? WHERE id = ?`;
            const updateLotSql = `UPDATE logistics_outbound_lots SET consumed_qty = ? WHERE outbound_id = ? AND inbound_id = ?`;

            const insertInSql = `INSERT INTO logistics_inbound (date, supplier, item, spec, unit, qty_initial, qty_remaining, unit_price, location_id, note, is_direct, category, transaction_group_id, trade_type) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, 1, ?, ?, ?)`;
            const insertOutSql = `INSERT INTO logistics_outbound (date, destination, actual_destination, item, spec, unit, qty, selling_price, shipping_fee, shipping_fee_vat_included, note, is_direct, category, transaction_group_id, trade_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`;
            const insertLotSql = `INSERT INTO logistics_outbound_lots (outbound_id, inbound_id, consumed_qty) VALUES (?, ?, ?)`;

            const stmtUpIn = db.prepare(updateInSql);
            const stmtUpOut = db.prepare(updateOutSql);
            const stmtUpLot = db.prepare(updateLotSql);

            const stmtInIn = db.prepare(insertInSql);
            const stmtInOut = db.prepare(insertOutSql);
            const stmtInLot = db.prepare(insertLotSql);

            for (let i of items) {
                const cat = i.category || '';
                if (i.id) {
                    const oId = parseInt(i.id);
                    db.get(`SELECT inbound_id FROM logistics_outbound_lots WHERE outbound_id = ?`, [oId], (errL, lotRow) => {
                        if (lotRow) {
                            stmtUpIn.run(commonDate, commonSupplier, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.inbound_price) || 0, i.note || '', i.trade_type || '내수', cat, lotRow.inbound_id);
                            stmtUpOut.run(commonDate, commonDest, commonActualDest, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.selling_price) || 0, parseFloat(i.shipping_fee) || 0, i.shipping_fee_vat_included ? 1 : 0, i.note || '', i.trade_type || '내수', cat, oId);
                            stmtUpLot.run(parseFloat(i.qty), oId, lotRow.inbound_id);
                        }
                    });
                } else {
                    stmtInIn.run(commonDate, commonSupplier, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.inbound_price) || 0, i.note || '', cat, txInGroupId, i.trade_type || '내수', function(e1) {
                        if (e1) { hasError = true; return; }
                        const newInId = this.lastID;
                        stmtInOut.run(commonDate, commonDest, commonActualDest, i.item, i.spec, i.unit, parseFloat(i.qty), parseFloat(i.selling_price) || 0, parseFloat(i.shipping_fee) || 0, i.shipping_fee_vat_included ? 1 : 0, i.note || '', cat, txId, i.trade_type || '내수', function(e2) {
                            if (e2) { hasError = true; return; }
                            const newOutId = this.lastID;
                            stmtInLot.run(newOutId, newInId, parseFloat(i.qty));
                        });
                    });
                }
            }

            db.run("SELECT 1", function() {
                stmtUpIn.finalize(); stmtUpOut.finalize(); stmtUpLot.finalize();
                stmtInIn.finalize(); stmtInOut.finalize(); stmtInLot.finalize();

                if (hasError) {
                    db.run("ROLLBACK");
                    return res.status(400).json({ error: errorMsg || 'Update failed' });
                }
                
                db.run("COMMIT", (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });
                    res.json({ success: true, message: 'Direct transaction updated' });
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
