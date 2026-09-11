const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

// ── Promise Helpers ──
function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => {
            if (err) reject(err); else resolve(rows || []);
        });
    });
}

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params || [], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
}

function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params || [], function (err) {
            if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

// ── DB 테이블 초기화 ──
function initSiteSalesStatementTables(database) {
    return new Promise((resolve, reject) => {
        const targetDb = database || db;
        if (!targetDb) return resolve();

        targetDb.serialize(() => {
            targetDb.run(`
                CREATE TABLE IF NOT EXISTS site_sales_statements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT,
                    file_name TEXT,
                    date TEXT,
                    site_name TEXT,
                    client_name TEXT,
                    supplier TEXT,
                    supplier_biz_no TEXT,
                    item_name TEXT NOT NULL,
                    spec TEXT,
                    unit TEXT,
                    qty REAL NOT NULL DEFAULT 0,
                    unit_price REAL NOT NULL DEFAULT 0,
                    supply_amount REAL DEFAULT 0,
                    vat_amount REAL DEFAULT 0,
                    total_amount REAL DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) return reject(err);
            });

            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_sss_site ON site_sales_statements(site_name);`, () => {});
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_sss_date ON site_sales_statements(date);`, () => {});
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_sss_item ON site_sales_statements(item_name);`, () => {});
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_sss_supplier ON site_sales_statements(supplier);`, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    });
}

// ── 1. 등록된 현장명 목록 조회 ──
router.get('/sites', async (req, res) => {
    try {
        const rows = await dbAll(`
            SELECT DISTINCT site_name 
            FROM site_sales_statements 
            WHERE site_name IS NOT NULL AND TRIM(site_name) != '' 
            ORDER BY site_name ASC
        `);
        res.json(rows.map(r => r.site_name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 2. 내역 목록 검색 및 통계 조회 ──
router.get('/', async (req, res) => {
    try {
        const {
            startDate,
            endDate,
            site,
            supplier,
            keyword,
            page = 1,
            limit = 100
        } = req.query;

        const whereClauses = [];
        const params = [];

        if (startDate) {
            whereClauses.push(`date >= ?`);
            params.push(startDate);
        }
        if (endDate) {
            whereClauses.push(`date <= ?`);
            params.push(endDate);
        }
        if (site && site.trim()) {
            whereClauses.push(`site_name = ?`);
            params.push(site.trim());
        }
        if (supplier && supplier.trim()) {
            whereClauses.push(`supplier LIKE ?`);
            params.push(`%${supplier.trim()}%`);
        }
        if (keyword && keyword.trim()) {
            whereClauses.push(`(item_name LIKE ? OR spec LIKE ? OR site_name LIKE ? OR supplier LIKE ? OR file_name LIKE ?)`);
            const kw = `%${keyword.trim()}%`;
            params.push(kw, kw, kw, kw, kw);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // 전체 건수 및 합계 집계
        const summarySql = `
            SELECT 
                COUNT(*) as count,
                COALESCE(SUM(qty), 0) as totalQty,
                COALESCE(SUM(supply_amount), 0) as totalSupplyAmount,
                COALESCE(SUM(vat_amount), 0) as totalVatAmount,
                COALESCE(SUM(total_amount), 0) as totalAmount
            FROM site_sales_statements
            ${whereSql}
        `;
        const summary = await dbGet(summarySql, params);

        // 페이징 목록 조회
        const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const listSql = `
            SELECT *
            FROM site_sales_statements
            ${whereSql}
            ORDER BY date DESC, id DESC
            LIMIT ? OFFSET ?
        `;
        const items = await dbAll(listSql, [...params, parseInt(limit, 10), offset]);

        res.json({
            items,
            totalCount: summary.count || 0,
            summary: {
                totalQty: summary.totalQty || 0,
                totalSupplyAmount: summary.totalSupplyAmount || 0,
                totalVatAmount: summary.totalVatAmount || 0,
                totalAmount: summary.totalAmount || 0
            },
            page: parseInt(page, 10),
            limit: parseInt(limit, 10)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 3. 파싱 데이터 일괄 등록 (Batch Insert) ──
router.post('/', async (req, res) => {
    try {
        const rawItems = Array.isArray(req.body) ? req.body : (req.body.items || []);
        if (!rawItems || rawItems.length === 0) {
            return res.status(400).json({ error: '등록할 데이터가 없습니다.' });
        }

        const batchId = 'BATCH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7).toUpperCase();
        let insertedCount = 0;

        await new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                const stmt = db.prepare(`
                    INSERT INTO site_sales_statements (
                        batch_id, file_name, date, site_name, client_name,
                        supplier, supplier_biz_no, item_name, spec, unit,
                        qty, unit_price, supply_amount, vat_amount, total_amount, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
                `);

                for (const item of rawItems) {
                    const qty = Number(item.qty) || 0;
                    const unitPrice = Number(item.unit_price) || 0;
                    const supplyAmount = item.supply_amount !== undefined && item.supply_amount !== null 
                        ? Number(item.supply_amount) 
                        : Math.round(qty * unitPrice);
                    const vatAmount = item.vat_amount !== undefined && item.vat_amount !== null 
                        ? Number(item.vat_amount) 
                        : Math.round(supplyAmount * 0.1);
                    const totalAmount = item.total_amount !== undefined && item.total_amount !== null 
                        ? Number(item.total_amount) 
                        : (supplyAmount + vatAmount);

                    stmt.run([
                        item.batch_id || batchId,
                        item.file_name || '',
                        item.date || '',
                        item.site_name || '',
                        item.client_name || '',
                        item.supplier || '',
                        item.supplier_biz_no || '',
                        item.item_name || '',
                        item.spec || '',
                        item.unit || '',
                        qty,
                        unitPrice,
                        supplyAmount,
                        vatAmount,
                        totalAmount
                    ], (err) => {
                        if (err) console.error('Insert error:', err);
                        else insertedCount++;
                    });
                }

                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return reject(err);
                    }
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return reject(commitErr);
                        resolve();
                    });
                });
            });
        });

        res.json({
            success: true,
            batchId,
            insertedCount,
            message: `${insertedCount}건의 현장별 매출내역이 성공적으로 저장되었습니다.`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 4. 단일 항목 삭제 ──
router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await dbRun('DELETE FROM site_sales_statements WHERE id = ?', [id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: '삭제할 항목을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '항목이 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 5. 선택 항목 일괄 삭제 ──
router.post('/batch-delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 목록이 없습니다.' });
        }
        const placeholders = ids.map(() => '?').join(',');
        const result = await dbRun(`DELETE FROM site_sales_statements WHERE id IN (${placeholders})`, ids);
        res.json({ success: true, deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    setDb,
    initSiteSalesStatementTables
};
