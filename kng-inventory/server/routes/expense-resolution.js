const express = require('express');
const router = express.Router();

let db;

// DB 주입
const setDb = (dbInstance) => {
    db = dbInstance;
};

// 테이블 초기화
const initExpenseResolutionTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        // 지출결의서 테이블
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS expense_resolutions (
                id TEXT PRIMARY KEY,
                createdDate TEXT,
                paymentDate TEXT,
                currency TEXT DEFAULT 'KRW',
                amount REAL DEFAULT 0,
                vatAmount REAL DEFAULT 0,
                vendorId TEXT,
                vendorName TEXT,
                representative TEXT,
                bizRegNumber TEXT,
                bankName TEXT,
                accountNumber TEXT,
                accountHolder TEXT,
                paymentMethod TEXT DEFAULT 'cash',
                title TEXT,
                taxInvoiceDate TEXT,
                content TEXT,
                personInCharge TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('expense_resolutions 테이블 생성 오류:', err.message);
                reject(err);
                return;
            }
            console.log('expense_resolutions 테이블 확인 완료');

            // 거래처 프리셋 테이블
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS vendor_presets (
                    id TEXT PRIMARY KEY,
                    vendorName TEXT,
                    representative TEXT,
                    bizRegNumber TEXT,
                    accounts TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err2) => {
                if (err2) {
                    console.error('vendor_presets 테이블 생성 오류:', err2.message);
                    reject(err2);
                } else {
                    console.log('vendor_presets 테이블 확인 완료');
                    resolve();
                }
            });
        });
    });
};

// ==========================================
// 거래처 프리셋 API (/:id 보다 먼저 선언)
// ==========================================

// 거래처 목록 조회
router.get('/vendors', (req, res) => {
    db.all('SELECT * FROM vendor_presets ORDER BY vendorName ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(row => {
            try { row.accounts = JSON.parse(row.accounts || '[]'); } catch(e) { row.accounts = []; }
            return row;
        });
        res.json(parsed);
    });
});

// 거래처 단건 조회
router.get('/vendors/:id', (req, res) => {
    db.get('SELECT * FROM vendor_presets WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        try { row.accounts = JSON.parse(row.accounts || '[]'); } catch(e) { row.accounts = []; }
        res.json(row);
    });
});

// 거래처 등록
router.post('/vendors', (req, res) => {
    const p = req.body;
    const id = p.id || ('VND-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const accountsJson = typeof p.accounts === 'string' ? p.accounts : JSON.stringify(p.accounts || []);
    const sql = `
        INSERT INTO vendor_presets (id, vendorName, representative, bizRegNumber, accounts, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [id, p.vendorName || '', p.representative || '', p.bizRegNumber || '', accountsJson, now, now];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '거래처 등록 성공', id: id });
    });
});

// 거래처 수정
router.put('/vendors/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const accountsJson = typeof p.accounts === 'string' ? p.accounts : JSON.stringify(p.accounts || []);
    const sql = `
        UPDATE vendor_presets SET vendorName=?, representative=?, bizRegNumber=?, accounts=?, updatedAt=?
        WHERE id=?
    `;
    const params = [p.vendorName || '', p.representative || '', p.bizRegNumber || '', accountsJson, now, id];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        res.json({ message: '거래처 수정 성공' });
    });
});

// 거래처 삭제
router.delete('/vendors/:id', (req, res) => {
    db.run('DELETE FROM vendor_presets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        res.json({ message: '거래처 삭제 성공' });
    });
});

// ==========================================
// 지출결의서 API
// ==========================================

// 전체 목록 조회
router.get('/', (req, res) => {
    db.all('SELECT * FROM expense_resolutions ORDER BY createdDate DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 다중 삭제 (/:id 보다 먼저 선언)
router.post('/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM expense_resolutions WHERE id IN (${placeholders})`;

    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// 단일 조회
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM expense_resolutions WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 등록
router.post('/', (req, res) => {
    const p = req.body;
    const id = p.id || ('EXP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `
        INSERT INTO expense_resolutions (
            id, createdDate, paymentDate, currency, amount, vatAmount,
            vendorId, vendorName, representative, bizRegNumber,
            bankName, accountNumber, accountHolder,
            paymentMethod, title, taxInvoiceDate, content, personInCharge,
            createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        id, p.createdDate || '', p.paymentDate || '', p.currency || 'KRW',
        p.amount || 0, p.vatAmount || 0,
        p.vendorId || '', p.vendorName || '', p.representative || '', p.bizRegNumber || '',
        p.bankName || '', p.accountNumber || '', p.accountHolder || '',
        p.paymentMethod || 'cash', p.title || '', p.taxInvoiceDate || '',
        p.content || '', p.personInCharge || '',
        now, now
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 수정
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `
        UPDATE expense_resolutions SET
            createdDate=?, paymentDate=?, currency=?, amount=?, vatAmount=?,
            vendorId=?, vendorName=?, representative=?, bizRegNumber=?,
            bankName=?, accountNumber=?, accountHolder=?,
            paymentMethod=?, title=?, taxInvoiceDate=?, content=?, personInCharge=?,
            updatedAt=?
        WHERE id=?
    `;
    const params = [
        p.createdDate || '', p.paymentDate || '', p.currency || 'KRW',
        p.amount || 0, p.vatAmount || 0,
        p.vendorId || '', p.vendorName || '', p.representative || '', p.bizRegNumber || '',
        p.bankName || '', p.accountNumber || '', p.accountHolder || '',
        p.paymentMethod || 'cash', p.title || '', p.taxInvoiceDate || '',
        p.content || '', p.personInCharge || '',
        now, id
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

module.exports = {
    router,
    setDb,
    initExpenseResolutionTables
};
