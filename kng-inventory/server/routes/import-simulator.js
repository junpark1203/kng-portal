/**
 * ══════════════════════════════════════════════════════════════
 * Import Simulator API (/api/import-simulator/...)
 * 수입 원가 분해 및 판매가/마진 시뮬레이션 영구 보관 라우터
 * ══════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

// Promise 헬퍼 함수
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

// ─────────────────────────────────────────────────────────────
// DB 테이블 초기화
// ─────────────────────────────────────────────────────────────
function initImportSimulatorTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS import_simulations (
                    id TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    simDate TEXT DEFAULT '',
                    productName TEXT DEFAULT '',
                    currency TEXT DEFAULT 'USD',
                    fobPrice REAL DEFAULT 0,
                    exchangeRate REAL DEFAULT 0,
                    quantity INTEGER DEFAULT 0,
                    oceanFreight REAL DEFAULT 0,
                    customsFee REAL DEFAULT 0,
                    inlandFreight REAL DEFAULT 0,
                    otherCost REAL DEFAULT 0,
                    isFtaExempt INTEGER DEFAULT 1,
                    tariffRate REAL DEFAULT 0,
                    landedCost REAL DEFAULT 0,
                    channels TEXT DEFAULT '[]',
                    savings TEXT DEFAULT '{}',
                    remarks TEXT DEFAULT '',
                    authorEmail TEXT DEFAULT '',
                    authorName TEXT DEFAULT '',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('import_simulations 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('import_simulations 테이블 확인 완료');
                    resolve();
                }
            });
        });
    });
}

// ─────────────────────────────────────────────────────────────
// API 엔드포인트
// ─────────────────────────────────────────────────────────────

// 1. 전체 목록 조회
router.get('/', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM import_simulations ORDER BY updatedAt DESC, createdAt DESC');
        const result = rows.map(r => {
            try { r.channels = JSON.parse(r.channels || '[]'); } catch(e) { r.channels = []; }
            try { r.savings = JSON.parse(r.savings || '{}'); } catch(e) { r.savings = {}; }
            r.isFtaExempt = (r.isFtaExempt === 1 || r.isFtaExempt === true || r.isFtaExempt === '1');
            return r;
        });
        res.json(result);
    } catch (err) {
        console.error('시뮬레이션 목록 조회 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. 단일 상세 조회
router.get('/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM import_simulations WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '해당 시뮬레이션 데이터를 찾을 수 없습니다.' });

        try { row.channels = JSON.parse(row.channels || '[]'); } catch(e) { row.channels = []; }
        try { row.savings = JSON.parse(row.savings || '{}'); } catch(e) { row.savings = {}; }
        row.isFtaExempt = (row.isFtaExempt === 1 || row.isFtaExempt === true || row.isFtaExempt === '1');

        res.json(row);
    } catch (err) {
        console.error('시뮬레이션 상세 조회 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. 신규 저장 (Create)
router.post('/', async (req, res) => {
    try {
        const data = req.body;
        const now = new Date().toISOString();
        const id = data.id || `sim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const title = data.title || data.productName || '수입 시뮬레이션';
        const simDate = data.simDate || now.slice(0, 10);

        const channelsStr = typeof data.channels === 'string' ? data.channels : JSON.stringify(data.channels || []);
        const savingsStr = typeof data.savings === 'string' ? data.savings : JSON.stringify(data.savings || {});
        const isFtaExemptNum = data.isFtaExempt ? 1 : 0;

        await dbRun(`
            INSERT INTO import_simulations (
                id, title, simDate, productName, currency, fobPrice, exchangeRate, quantity,
                oceanFreight, customsFee, inlandFreight, otherCost, isFtaExempt, tariffRate,
                landedCost, channels, savings, remarks, authorEmail, authorName, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            id,
            title,
            simDate,
            data.productName || '',
            data.currency || 'USD',
            Number(data.fobPrice) || 0,
            Number(data.exchangeRate) || 0,
            Number(data.quantity) || 0,
            Number(data.oceanFreight) || 0,
            Number(data.customsFee) || 0,
            Number(data.inlandFreight) || 0,
            Number(data.otherCost) || 0,
            isFtaExemptNum,
            Number(data.tariffRate) || 0,
            Number(data.landedCost) || 0,
            channelsStr,
            savingsStr,
            data.remarks || '',
            data.authorEmail || '',
            data.authorName || '',
            now,
            now
        ]);

        res.status(201).json({ success: true, id, message: '시뮬레이션이 성공적으로 저장되었습니다.' });
    } catch (err) {
        console.error('시뮬레이션 신규 저장 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. 기존 시뮬레이션 수정 (Update)
router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const data = req.body;
        const now = new Date().toISOString();

        const channelsStr = typeof data.channels === 'string' ? data.channels : JSON.stringify(data.channels || []);
        const savingsStr = typeof data.savings === 'string' ? data.savings : JSON.stringify(data.savings || {});
        const isFtaExemptNum = data.isFtaExempt ? 1 : 0;
        const title = data.title || data.productName || '수입 시뮬레이션';

        const result = await dbRun(`
            UPDATE import_simulations SET
                title = ?,
                simDate = ?,
                productName = ?,
                currency = ?,
                fobPrice = ?,
                exchangeRate = ?,
                quantity = ?,
                oceanFreight = ?,
                customsFee = ?,
                inlandFreight = ?,
                otherCost = ?,
                isFtaExempt = ?,
                tariffRate = ?,
                landedCost = ?,
                channels = ?,
                savings = ?,
                remarks = ?,
                updatedAt = ?
            WHERE id = ?
        `, [
            title,
            data.simDate || now.slice(0, 10),
            data.productName || '',
            data.currency || 'USD',
            Number(data.fobPrice) || 0,
            Number(data.exchangeRate) || 0,
            Number(data.quantity) || 0,
            Number(data.oceanFreight) || 0,
            Number(data.customsFee) || 0,
            Number(data.inlandFreight) || 0,
            Number(data.otherCost) || 0,
            isFtaExemptNum,
            Number(data.tariffRate) || 0,
            Number(data.landedCost) || 0,
            channelsStr,
            savingsStr,
            data.remarks || '',
            now,
            id
        ]);

        if (result.changes === 0) {
            return res.status(404).json({ error: '수정할 대상을 찾을 수 없습니다.' });
        }

        res.json({ success: true, id, message: '시뮬레이션이 수정되었습니다.' });
    } catch (err) {
        console.error('시뮬레이션 수정 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// 5. 삭제 (Delete)
router.delete('/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM import_simulations WHERE id = ?', [req.params.id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: '삭제할 대상을 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '시뮬레이션이 삭제되었습니다.' });
    } catch (err) {
        console.error('시뮬레이션 삭제 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    initImportSimulatorTables,
    setDb
};
