/**
 * Invoice & Packing List API (/api/invoice-packing/...)
 * - 거래 문서 CRUD (Invoice + Packing List 통합)
 * - 거래처 템플릿 CRUD
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
function initInvoicePackingTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            // 거래 문서 테이블 (Invoice + Packing List 통합)
            database.run(`
                CREATE TABLE IF NOT EXISTS invoice_packing_docs (
                    id TEXT PRIMARY KEY,
                    invoiceNo TEXT DEFAULT '',
                    packingListNo TEXT DEFAULT '',
                    docDate TEXT DEFAULT '',
                    
                    shipper TEXT DEFAULT '{}',
                    consignee TEXT DEFAULT '{}',
                    notifyParty TEXT DEFAULT '{}',
                    
                    vessel TEXT DEFAULT '',
                    portOfLoading TEXT DEFAULT '',
                    portOfDischarge TEXT DEFAULT '',
                    finalDestination TEXT DEFAULT '',
                    paymentTerms TEXT DEFAULT '',
                    incoterms TEXT DEFAULT '',
                    currency TEXT DEFAULT 'USD',
                    countryOfOrigin TEXT DEFAULT '',
                    departureDate TEXT DEFAULT '',
                    
                    items TEXT DEFAULT '[]',
                    packingItems TEXT DEFAULT '[]',
                    remarks TEXT DEFAULT '',
                    
                    totalAmount REAL DEFAULT 0,
                    totalNetWeight REAL DEFAULT 0,
                    totalGrossWeight REAL DEFAULT 0,
                    totalMeasurement REAL DEFAULT 0,
                    totalQty REAL DEFAULT 0,
                    
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `);

            // 거래처 템플릿 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS invoice_packing_partners (
                    id TEXT PRIMARY KEY,
                    role TEXT DEFAULT 'shipper',
                    name TEXT DEFAULT '',
                    address TEXT DEFAULT '',
                    tel TEXT DEFAULT '',
                    fax TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    bankInfo TEXT DEFAULT '{}',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('invoice_packing 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    // 마이그레이션: 기존 테이블에 신규 컬럼 추가 (에러 무시)
                    database.run(`ALTER TABLE invoice_packing_docs ADD COLUMN countryOfOrigin TEXT DEFAULT ''`, () => {});
                    database.run(`ALTER TABLE invoice_packing_docs ADD COLUMN departureDate TEXT DEFAULT ''`, () => {});
                    database.run(`ALTER TABLE invoice_packing_docs ADD COLUMN packingItems TEXT DEFAULT '[]'`, () => {});

                    console.log('invoice_packing_docs / invoice_packing_partners 테이블 확인 및 마이그레이션 완료');
                    resolve();
                }
            });
        });
    });
}

// ════════════════════════════════════════
// 거래 문서 API
// ════════════════════════════════════════

// 전체 목록 조회
router.get('/documents', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM invoice_packing_docs ORDER BY createdAt DESC');
        const result = rows.map(r => {
            try { r.shipper = JSON.parse(r.shipper || '{}'); } catch(e) { r.shipper = {}; }
            try { r.consignee = JSON.parse(r.consignee || '{}'); } catch(e) { r.consignee = {}; }
            try { r.notifyParty = JSON.parse(r.notifyParty || '{}'); } catch(e) { r.notifyParty = {}; }
            try { r.items = JSON.parse(r.items || '[]'); } catch(e) { r.items = []; }
            try { r.packingItems = JSON.parse(r.packingItems || '[]'); } catch(e) { r.packingItems = []; }
            return r;
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단일 조회
router.get('/documents/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM invoice_packing_docs WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        try { row.shipper = JSON.parse(row.shipper || '{}'); } catch(e) { row.shipper = {}; }
        try { row.consignee = JSON.parse(row.consignee || '{}'); } catch(e) { row.consignee = {}; }
        try { row.notifyParty = JSON.parse(row.notifyParty || '{}'); } catch(e) { row.notifyParty = {}; }
        try { row.items = JSON.parse(row.items || '[]'); } catch(e) { row.items = []; }
        try { row.packingItems = JSON.parse(row.packingItems || '[]'); } catch(e) { row.packingItems = []; }
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 신규 생성
router.post('/documents', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('INVPL-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        const sql = `INSERT INTO invoice_packing_docs (
            id, invoiceNo, packingListNo, docDate,
            shipper, consignee, notifyParty,
            vessel, portOfLoading, portOfDischarge, finalDestination,
            paymentTerms, incoterms, currency, countryOfOrigin, departureDate,
            items, packingItems, remarks,
            totalAmount, totalNetWeight, totalGrossWeight, totalMeasurement, totalQty,
            createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id,
            p.invoiceNo || '',
            p.packingListNo || '',
            p.docDate || '',
            JSON.stringify(p.shipper || {}),
            JSON.stringify(p.consignee || {}),
            JSON.stringify(p.notifyParty || {}),
            p.vessel || '',
            p.portOfLoading || '',
            p.portOfDischarge || '',
            p.finalDestination || '',
            p.paymentTerms || '',
            p.incoterms || '',
            p.currency || 'USD',
            p.countryOfOrigin || '',
            p.departureDate || '',
            JSON.stringify(p.items || []),
            JSON.stringify(p.packingItems || []),
            p.remarks || '',
            p.totalAmount || 0,
            p.totalNetWeight || 0,
            p.totalGrossWeight || 0,
            p.totalMeasurement || 0,
            p.totalQty || 0,
            now, now
        ];
        await dbRun(sql, params);
        res.status(201).json({ message: '저장 성공', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수정
router.put('/documents/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        const now = new Date().toISOString();
        const sql = `UPDATE invoice_packing_docs SET
            invoiceNo=?, packingListNo=?, docDate=?,
            shipper=?, consignee=?, notifyParty=?,
            vessel=?, portOfLoading=?, portOfDischarge=?, finalDestination=?,
            paymentTerms=?, incoterms=?, currency=?, countryOfOrigin=?, departureDate=?,
            items=?, packingItems=?, remarks=?,
            totalAmount=?, totalNetWeight=?, totalGrossWeight=?, totalMeasurement=?, totalQty=?,
            updatedAt=?
        WHERE id=?`;
        const params = [
            p.invoiceNo || '',
            p.packingListNo || '',
            p.docDate || '',
            JSON.stringify(p.shipper || {}),
            JSON.stringify(p.consignee || {}),
            JSON.stringify(p.notifyParty || {}),
            p.vessel || '',
            p.portOfLoading || '',
            p.portOfDischarge || '',
            p.finalDestination || '',
            p.paymentTerms || '',
            p.incoterms || '',
            p.currency || 'USD',
            p.countryOfOrigin || '',
            p.departureDate || '',
            JSON.stringify(p.items || []),
            JSON.stringify(p.packingItems || []),
            p.remarks || '',
            p.totalAmount || 0,
            p.totalNetWeight || 0,
            p.totalGrossWeight || 0,
            p.totalMeasurement || 0,
            p.totalQty || 0,
            now, id
        ];
        const result = await dbRun(sql, params);
        if (result.changes === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 다중 삭제
router.post('/documents/delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
        }
        const placeholders = ids.map(() => '?').join(',');
        const result = await dbRun(`DELETE FROM invoice_packing_docs WHERE id IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// 거래처 템플릿 API
// ════════════════════════════════════════

// 목록 조회
router.get('/partners', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM invoice_packing_partners ORDER BY role, name');
        const result = rows.map(r => {
            try { r.bankInfo = JSON.parse(r.bankInfo || '{}'); } catch(e) { r.bankInfo = {}; }
            return r;
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 저장 (upsert)
router.post('/partners', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('PTR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO invoice_packing_partners (id, role, name, address, tel, fax, email, bankInfo, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                role = excluded.role,
                name = excluded.name,
                address = excluded.address,
                tel = excluded.tel,
                fax = excluded.fax,
                email = excluded.email,
                bankInfo = excluded.bankInfo,
                updatedAt = excluded.updatedAt
        `, [id, p.role || 'shipper', p.name || '', p.address || '', p.tel || '', p.fax || '', p.email || '', JSON.stringify(p.bankInfo || {}), now, now]);
        res.json({ message: '저장 성공', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 삭제
router.delete('/partners/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM invoice_packing_partners WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.setDb = setDb;
module.exports.initInvoicePackingTables = initInvoicePackingTables;
