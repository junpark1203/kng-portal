const express = require('express');
const router = express.Router();
const { generateTradeRemittancePdf } = require('../services/trade-remittance-pdf');

let _db;

function setDb(dbInstance) {
    _db = dbInstance;
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

async function initTradeRemittanceTables(db) {
    _db = db;
    await dbRun(`
        CREATE TABLE IF NOT EXISTS trade_remittance_confirmations (
            id TEXT PRIMARY KEY,
            remittanceDate TEXT,
            currency TEXT DEFAULT 'USD',
            amount REAL DEFAULT 0,
            beneficiaryName TEXT,
            paymentMethodType TEXT DEFAULT '사전 송금방식',
            importPeriodType TEXT DEFAULT '1년 이내',
            tradeType TEXT DEFAULT '일반 수입',
            hsCode TEXT,
            lcOrContractNo TEXT,
            importDeclNo TEXT,
            priceTerms TEXT,
            tradePurpose TEXT,
            submitDate TEXT,
            status TEXT DEFAULT '결재요청',
            author TEXT,
            userEmail TEXT,
            expenseId TEXT,
            expenseTitle TEXT,
            remarks TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);
    console.log('[TradeRemittance] 테이블 초기화 완료');
}

// 1. 전체 목록 조회
router.get('/', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const rows = await dbAll(`SELECT * FROM trade_remittance_confirmations ORDER BY createdAt DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. 단건 조회
router.get('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const row = await dbGet(`SELECT * FROM trade_remittance_confirmations WHERE id = ?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: '확인서를 찾을 수 없습니다.' });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. 신규 작성
router.post('/', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });

    const p = req.body || {};
    const id = 'TR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    const cleanHsCode = String(p.hsCode || '').replace(/[^0-9]/g, '');
    const amountVal = parseFloat(String(p.amount || '0').replace(/,/g, '')) || 0;
    const userEmail = (p.userEmail || (req.user ? req.user.email : '') || '').trim();

    try {
        const sql = `
            INSERT INTO trade_remittance_confirmations (
                id, remittanceDate, currency, amount, beneficiaryName,
                paymentMethodType, importPeriodType, tradeType,
                hsCode, lcOrContractNo, importDeclNo, priceTerms, tradePurpose,
                submitDate, status, author, userEmail, expenseId, expenseTitle, remarks,
                createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            id,
            (p.remittanceDate || '').trim(),
            (p.currency || 'USD').trim().toUpperCase(),
            amountVal,
            (p.beneficiaryName || '').trim(),
            '사전 송금방식',
            '1년 이내',
            '일반 수입',
            cleanHsCode,
            (p.lcOrContractNo || '').trim(),
            (p.importDeclNo || '').trim(),
            (p.priceTerms || '').trim(),
            (p.tradePurpose || '').trim(),
            (p.submitDate || '').trim(),
            (p.status || '결재요청').trim(),
            (p.author || '').trim(),
            userEmail,
            (p.expenseId || '').trim(),
            (p.expenseTitle || '').trim(),
            (p.remarks || '').trim(),
            now,
            now
        ];

        await dbRun(sql, params);
        res.status(201).json({ message: '무역대금 송금 추가 확인서가 저장되었습니다.', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. 수정
router.put('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });

    const p = req.body || {};
    const now = new Date().toISOString();
    const cleanHsCode = String(p.hsCode || '').replace(/[^0-9]/g, '');
    const amountVal = parseFloat(String(p.amount || '0').replace(/,/g, '')) || 0;

    try {
        const prev = await dbGet(`SELECT * FROM trade_remittance_confirmations WHERE id = ?`, [req.params.id]);
        if (!prev) return res.status(404).json({ error: '수정할 문서를 찾을 수 없습니다.' });

        const sql = `
            UPDATE trade_remittance_confirmations SET
                remittanceDate = ?,
                currency = ?,
                amount = ?,
                beneficiaryName = ?,
                paymentMethodType = '사전 송금방식',
                importPeriodType = '1년 이내',
                tradeType = '일반 수입',
                hsCode = ?,
                lcOrContractNo = ?,
                importDeclNo = ?,
                priceTerms = ?,
                tradePurpose = ?,
                submitDate = ?,
                status = ?,
                author = ?,
                expenseId = ?,
                expenseTitle = ?,
                remarks = ?,
                updatedAt = ?
            WHERE id = ?
        `;
        const params = [
            (p.remittanceDate || '').trim(),
            (p.currency || 'USD').trim().toUpperCase(),
            amountVal,
            (p.beneficiaryName || '').trim(),
            cleanHsCode,
            (p.lcOrContractNo || '').trim(),
            (p.importDeclNo || '').trim(),
            (p.priceTerms || '').trim(),
            (p.tradePurpose || '').trim(),
            (p.submitDate || '').trim(),
            (p.status || prev.status || '결재요청').trim(),
            (p.author !== undefined ? p.author : (prev.author || '')).trim(),
            (p.expenseId !== undefined ? p.expenseId : (prev.expenseId || '')).trim(),
            (p.expenseTitle !== undefined ? p.expenseTitle : (prev.expenseTitle || '')).trim(),
            (p.remarks !== undefined ? p.remarks : (prev.remarks || '')).trim(),
            now,
            req.params.id
        ];

        await dbRun(sql, params);
        res.json({ message: '무역대금 송금 추가 확인서가 수정되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. 결재 상태 변경
router.put('/:id/status', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: '변경할 status 값이 필요합니다.' });

    const now = new Date().toISOString();
    try {
        const item = await dbGet(`SELECT id FROM trade_remittance_confirmations WHERE id = ?`, [req.params.id]);
        if (!item) return res.status(404).json({ error: '해당 확인서를 찾을 수 없습니다.' });

        await dbRun(
            `UPDATE trade_remittance_confirmations SET status = ?, updatedAt = ? WHERE id = ?`,
            [status, now, req.params.id]
        );
        res.json({ message: '결재 상태가 변경되었습니다.', status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. 단건 삭제
router.delete('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        await dbRun(`DELETE FROM trade_remittance_confirmations WHERE id = ?`, [req.params.id]);
        res.json({ message: '삭제 완료' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. 다중 선택 삭제
router.post('/delete', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 항목 ID 배열이 필요합니다.' });
    }
    try {
        const placeholders = ids.map(() => '?').join(',');
        await dbRun(`DELETE FROM trade_remittance_confirmations WHERE id IN (${placeholders})`, ids);
        res.json({ message: '선택 항목이 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. 1:1 정품 PDF 생성 및 응답
async function serveTradeRemittancePdf(data, res) {
    try {
        const pdfBuffer = await generateTradeRemittancePdf(data);
        const safeBeneficiary = String(data.beneficiaryName || '수취인').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
        const fileName = encodeURIComponent(`무역대금송금추가확인서_${safeBeneficiary}_${data.remittanceDate || data.submitDate || ''}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${fileName}`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.end(pdfBuffer);
    } catch (err) {
        console.error('[TradeRemittance PDF Error]:', err);
        return res.status(500).json({ error: 'PDF 생성에 실패했습니다.', details: err.message });
    }
}

router.get('/:id/pdf', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const row = await dbGet(`SELECT * FROM trade_remittance_confirmations WHERE id = ?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: '확인서를 찾을 수 없습니다.' });
        return serveTradeRemittancePdf(row, res);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

router.post('/preview-pdf', (req, res) => {
    return serveTradeRemittancePdf(req.body || {}, res);
});

module.exports = {
    router,
    setDb,
    initTradeRemittanceTables
};
