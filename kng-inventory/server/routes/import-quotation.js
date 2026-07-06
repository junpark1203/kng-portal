const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

let dbRun, dbAll, dbGet;

function setDbFunctions(run, all, get) {
    dbRun = run;
    dbAll = all;
    dbGet = get;
}

function initImportQuotationTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS import_quotations (
                    id TEXT PRIMARY KEY,
                    title TEXT DEFAULT '',
                    quoteDate TEXT DEFAULT '',
                    validity TEXT DEFAULT '',
                    status TEXT DEFAULT 'draft',
                    supplierName TEXT DEFAULT '',
                    supplierContact TEXT DEFAULT '',
                    incoterms TEXT DEFAULT 'FOB',
                    paymentTerms TEXT DEFAULT '',
                    leadTime TEXT DEFAULT '',
                    pol TEXT DEFAULT '',
                    pod TEXT DEFAULT '',
                    exchangeRates TEXT DEFAULT '{}',
                    currency TEXT DEFAULT 'USD',
                    items TEXT DEFAULT '[]',
                    remarks TEXT DEFAULT '',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('import_quotations 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('import_quotations 테이블 생성 성공');
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
        const rows = await dbAll('SELECT * FROM import_quotations ORDER BY createdAt DESC');
        const result = rows.map(r => {
            try { r.exchangeRates = JSON.parse(r.exchangeRates || '{}'); } catch(e) { r.exchangeRates = {}; }
            try { r.items = JSON.parse(r.items || '[]'); } catch(e) { r.items = []; }
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
        const row = await dbGet('SELECT * FROM import_quotations WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' });
        
        try { row.exchangeRates = JSON.parse(row.exchangeRates || '{}'); } catch(e) { row.exchangeRates = {}; }
        try { row.items = JSON.parse(row.items || '[]'); } catch(e) { row.items = []; }
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 신규 생성
router.post('/', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('IQ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        const sql = `INSERT INTO import_quotations (
            id, title, quoteDate, validity, status, supplierName, supplierContact,
            incoterms, paymentTerms, leadTime, pol, pod,
            exchangeRates, currency, items, remarks,
            createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id,
            p.title || '',
            p.quoteDate || '',
            p.validity || '',
            p.status || 'draft',
            p.supplierName || '',
            p.supplierContact || '',
            p.incoterms || 'FOB',
            p.paymentTerms || '',
            p.leadTime || '',
            p.pol || '',
            p.pod || '',
            JSON.stringify(p.exchangeRates || {}),
            p.currency || 'USD',
            JSON.stringify(p.items || []),
            p.remarks || '',
            now, now
        ];
        await dbRun(sql, params);
        res.status(201).json({ message: '저장 성공', id });
    } catch (err) {
        console.error('Save error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 수정
router.put('/:id', async (req, res) => {
    try {
        const p = req.body;
        const id = req.params.id;
        const now = new Date().toISOString();
        
        const sql = `UPDATE import_quotations SET
            title=?, quoteDate=?, validity=?, status=?, supplierName=?, supplierContact=?,
            incoterms=?, paymentTerms=?, leadTime=?, pol=?, pod=?,
            exchangeRates=?, currency=?, items=?, remarks=?,
            updatedAt=?
        WHERE id=?`;
        const params = [
            p.title || '',
            p.quoteDate || '',
            p.validity || '',
            p.status || 'draft',
            p.supplierName || '',
            p.supplierContact || '',
            p.incoterms || 'FOB',
            p.paymentTerms || '',
            p.leadTime || '',
            p.pol || '',
            p.pod || '',
            JSON.stringify(p.exchangeRates || {}),
            p.currency || 'USD',
            JSON.stringify(p.items || []),
            p.remarks || '',
            now, id
        ];
        const result = await dbRun(sql, params);
        if (result.changes === 0) return res.status(404).json({ error: '수정할 견적을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 삭제 다중
router.delete('/', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
        }
        
        const placeholders = ids.map(() => '?').join(',');
        const sql = `DELETE FROM import_quotations WHERE id IN (${placeholders})`;
        const result = await dbRun(sql, ids);
        
        res.json({ message: `${result.changes}개 삭제 완료` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    setDbFunctions,
    initImportQuotationTables
};
