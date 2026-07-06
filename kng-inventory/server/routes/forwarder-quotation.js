/**
 * Forwarder Quotation API (/api/forwarder-quotation/...)
 * - 다중 포워더 견적 관리
 */
const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

// ── Promise 헬퍼 ──
function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
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

// ════════════════════════════════════════
// DB 초기화
// ════════════════════════════════════════
function initForwarderQuotationTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS forwarder_quotations (
                    id TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    quoteDate TEXT DEFAULT '',
                    status TEXT DEFAULT 'draft',
                    containerType TEXT DEFAULT '20ft',
                    containerQty INTEGER DEFAULT 1,
                    exchangeRates TEXT DEFAULT '{}',
                    incoterms TEXT DEFAULT '["EXW"]',
                    items TEXT DEFAULT '[]',
                    forwarders TEXT DEFAULT '[]',
                    remarks TEXT DEFAULT '',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('forwarder_quotations 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    // 마이그레이션: 누락된 컬럼 추가
                    const columns = [
                        'shipmentType TEXT DEFAULT "FCL"',
                        'dimUnit TEXT DEFAULT "cm"',
                        'otherCosts TEXT DEFAULT "[]"'
                    ];
                    let completed = 0;
                    columns.forEach(col => {
                        const colName = col.split(' ')[0];
                        database.run(`ALTER TABLE forwarder_quotations ADD COLUMN ${colName} TEXT`, (e) => {
                            // Column might already exist, ignore error
                            completed++;
                            if (completed === columns.length) {
                                console.log('forwarder_quotations 테이블 확인 및 마이그레이션 완료');
                                resolve();
                            }
                        });
                    });
                }
            });
        });
    });
}

// ════════════════════════════════════════
// API 엔드포인트
// ════════════════════════════════════════

// 전체 목록 조회
router.get('/', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM forwarder_quotations ORDER BY createdAt DESC');
        const result = rows.map(r => {
            try { r.exchangeRates = JSON.parse(r.exchangeRates || '{}'); } catch(e) { r.exchangeRates = {}; }
            try { r.incoterms = JSON.parse(r.incoterms || '[]'); } catch(e) { r.incoterms = []; }
            try { r.items = JSON.parse(r.items || '[]'); } catch(e) { r.items = []; }
            try { r.forwarders = JSON.parse(r.forwarders || '[]'); } catch(e) { r.forwarders = []; }
            return r;
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단일 조회
router.get('/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM forwarder_quotations WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' });
        
        try { row.exchangeRates = JSON.parse(row.exchangeRates || '{}'); } catch(e) { row.exchangeRates = {}; }
        try { row.incoterms = JSON.parse(row.incoterms || '[]'); } catch(e) { row.incoterms = []; }
        try { row.items = JSON.parse(row.items || '[]'); } catch(e) { row.items = []; }
        try { row.forwarders = JSON.parse(row.forwarders || '[]'); } catch(e) { row.forwarders = []; }
        try { row.otherCosts = JSON.parse(row.otherCosts || '[]'); } catch(e) { row.otherCosts = []; }
        row.shipmentType = row.shipmentType || 'FCL';
        row.dimUnit = row.dimUnit || 'cm';
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 신규 생성
router.post('/', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('FQ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        const sql = `INSERT INTO forwarder_quotations (
            id, title, quoteDate, status, containerType, containerQty,
            exchangeRates, incoterms, items, forwarders, remarks,
            shipmentType, dimUnit, otherCosts,
            createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id,
            p.title || '',
            p.quoteDate || '',
            p.status || 'draft',
            p.containerType || '20ft',
            p.containerQty || 1,
            JSON.stringify(p.exchangeRates || {}),
            JSON.stringify(p.incoterms || []),
            JSON.stringify(p.items || []),
            JSON.stringify(p.forwarders || []),
            p.remarks || '',
            p.shipmentType || 'FCL',
            p.dimUnit || 'cm',
            JSON.stringify(p.otherCosts || []),
            now, now
        ];
        await dbRun(sql, params);
        res.status(201).json({ message: '저장 성공', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수정
router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        const now = new Date().toISOString();
        const sql = `UPDATE forwarder_quotations SET
            title=?, quoteDate=?, status=?, containerType=?, containerQty=?,
            exchangeRates=?, incoterms=?, items=?, forwarders=?, remarks=?,
            shipmentType=?, dimUnit=?, otherCosts=?,
            updatedAt=?
        WHERE id=?`;
        const params = [
            p.title || '',
            p.quoteDate || '',
            p.status || 'draft',
            p.containerType || '20ft',
            p.containerQty || 1,
            JSON.stringify(p.exchangeRates || {}),
            JSON.stringify(p.incoterms || []),
            JSON.stringify(p.items || []),
            JSON.stringify(p.forwarders || []),
            p.remarks || '',
            p.shipmentType || 'FCL',
            p.dimUnit || 'cm',
            JSON.stringify(p.otherCosts || []),
            now, id
        ];
        const result = await dbRun(sql, params);
        if (result.changes === 0) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 다중 삭제
router.post('/delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
        }
        const placeholders = ids.map(() => '?').join(',');
        const result = await dbRun(`DELETE FROM forwarder_quotations WHERE id IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.setDb = setDb;
module.exports.initForwarderQuotationTables = initForwarderQuotationTables;
