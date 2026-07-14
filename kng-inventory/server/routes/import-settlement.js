/**
 * Import Settlement API (/api/import-settlement/...)
 * - 실수입비용 정산 데이터 관리
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
function initImportSettlementTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS import_settlements (
                    id TEXT PRIMARY KEY,
                    quotationId TEXT,
                    quotationSnapshot TEXT DEFAULT '{}',
                    title TEXT DEFAULT '',
                    settlementDate TEXT DEFAULT '',
                    paidRates TEXT DEFAULT '{}',
                    actualCosts TEXT DEFAULT '[]',
                    status TEXT DEFAULT 'draft',
                    remarks TEXT DEFAULT '',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('import_settlements 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('import_settlements 테이블 확인 및 마이그레이션 완료');
                    resolve();
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
        const rows = await dbAll('SELECT id, quotationId, title, settlementDate, status, createdAt, updatedAt FROM import_settlements ORDER BY createdAt DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단일 조회
router.get('/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM import_settlements WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '정산 문서를 찾을 수 없습니다.' });
        
        try { row.quotationSnapshot = JSON.parse(row.quotationSnapshot || '{}'); } catch(e) { row.quotationSnapshot = {}; }
        try { row.paidRates = JSON.parse(row.paidRates || '{}'); } catch(e) { row.paidRates = {}; }
        try { row.actualCosts = JSON.parse(row.actualCosts || '[]'); } catch(e) { row.actualCosts = []; }
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 신규 생성
router.post('/', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('IS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        const sql = `INSERT INTO import_settlements (
            id, quotationId, quotationSnapshot, title, settlementDate, paidRates, actualCosts, status, remarks, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id,
            p.quotationId || '',
            JSON.stringify(p.quotationSnapshot || {}),
            p.title || '',
            p.settlementDate || '',
            JSON.stringify(p.paidRates || {}),
            JSON.stringify(p.actualCosts || []),
            p.status || 'draft',
            p.remarks || '',
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
        const sql = `UPDATE import_settlements SET
            quotationId=?, quotationSnapshot=?, title=?, settlementDate=?, paidRates=?, actualCosts=?, status=?, remarks=?, updatedAt=?
        WHERE id=?`;
        const params = [
            p.quotationId || '',
            JSON.stringify(p.quotationSnapshot || {}),
            p.title || '',
            p.settlementDate || '',
            JSON.stringify(p.paidRates || {}),
            JSON.stringify(p.actualCosts || []),
            p.status || 'draft',
            p.remarks || '',
            now, id
        ];
        const result = await dbRun(sql, params);
        if (result.changes === 0) return res.status(404).json({ error: '정산 문서를 찾을 수 없습니다.' });
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
        const result = await dbRun(`DELETE FROM import_settlements WHERE id IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.setDb = setDb;
module.exports.initImportSettlementTables = initImportSettlementTables;
