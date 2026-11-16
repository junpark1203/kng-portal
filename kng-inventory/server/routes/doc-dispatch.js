const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

let _db;

function setDb(dbInstance) {
    _db = dbInstance;
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!_db) return reject(new Error('DB not initialized'));
        _db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!_db) return reject(new Error('DB not initialized'));
        _db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!_db) return reject(new Error('DB not initialized'));
        _db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function safeJsonParse(str, fallback) {
    if (typeof str !== 'string') return str ?? fallback;
    try {
        return JSON.parse(str);
    } catch (e) {
        return fallback;
    }
}

const DEFAULT_TEMPLATES = [
    {
        id: 'TPL-BANK-OPEN',
        name: '[금융/은행] 은행 법인 계좌 개설 구비서류 (8종)',
        category: '금융/은행',
        purpose: '법인 신규 계좌 개설 및 인터넷뱅킹 신청',
        remarks: '※ 원본 제출 서류는 스캔본을 서버에 첨부 보관하며, 현장 방문 시 실물 원본 및 인감을 지참합니다.',
        isDefault: 1,
        items: [
            { name: '은행거래신청서', required: true, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '법인인감 날인 필' },
            { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 제출 가능' },
            { name: '법인인감증명서', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '발급일로부터 3개월 이내 원본' },
            { name: '위임장', required: true, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '대리인 방문 시 법인인감 날인' },
            { name: '사용인감계', required: false, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '사용인감 등록 시 제출' },
            { name: '법인등기부등본', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '말소사항 포함(제출용) 원본' },
            { name: '대표자 신분증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 첨부' },
            { name: '수임인 신분증', required: true, copies: 1, submitType: 'original_hardcopy', validityDays: 0, memo: '방문 대리인 실물 신분증 지참' }
        ]
    },
    {
        id: 'TPL-BID-PARTNER',
        name: '[입찰/계약] 거래처 등록 및 입찰 참가 구비서류 (6종)',
        category: '입찰/계약',
        purpose: '신규 거래처 등록 및 입찰·계약 서류 제출',
        remarks: '※ 국세·지방세 완납증명서 유효기간(30일) 및 법인인감증명서(3개월)를 반드시 확인하세요.',
        isDefault: 0,
        items: [
            { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '사본 1부' },
            { name: '통장사본', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '법인명의 입금 계좌' },
            { name: '법인인감증명서', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '최근 3개월 이내 발급본' },
            { name: '사용인감계', required: false, copies: 1, submitType: 'original_scan', validityDays: 0, memo: '계약 시 사용인감 날인용' },
            { name: '국세·지방세 완납증명서', required: true, copies: 1, submitType: 'file_print', validityDays: 30, memo: '유효기간 30일 이내' },
            { name: '법인등기부등본', required: true, copies: 1, submitType: 'original_scan', validityDays: 90, memo: '말소사항 포함' }
        ]
    },
    {
        id: 'TPL-TRADE-FX',
        name: '[무역/외환] 외국환은행 송금 및 통관 구비서류 (5종)',
        category: '무역/외환',
        purpose: '무역대금 외화송금 및 수입통관 증빙 제출',
        remarks: '※ 송금 신청 금액과 인보이스(CI) 금액·통화 일치 여부를 사전 대조하세요.',
        isDefault: 0,
        items: [
            { name: '무역대금 송금 추가 확인서', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '은행 제출 양식' },
            { name: '인보이스 (Commercial Invoice)', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '서명·직인 확인' },
            { name: '팩킹리스트 (Packing List)', required: false, copies: 1, submitType: 'file_print', validityDays: 0, memo: '선적 상세' },
            { name: '수입신고필증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '관세청 발급본' },
            { name: '사업자등록증', required: true, copies: 1, submitType: 'file_print', validityDays: 0, memo: '상용서류함 연동' }
        ]
    }
];

async function initDocDispatchTables(dbInstance) {
    _db = dbInstance;

    await dbRun(`
        CREATE TABLE IF NOT EXISTS doc_dispatch_packages (
            id TEXT PRIMARY KEY,
            docNo TEXT,
            coverTitle TEXT,
            title TEXT,
            recipient TEXT,
            purpose TEXT,
            submitDate TEXT,
            submitMethod TEXT DEFAULT '방문제출',
            author TEXT,
            contact TEXT,
            status TEXT DEFAULT '준비중',
            itemsJson TEXT DEFAULT '[]',
            printOptionsJson TEXT DEFAULT '{}',
            remarks TEXT DEFAULT '',
            userEmail TEXT DEFAULT '',
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS doc_dispatch_templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT DEFAULT '기타',
            purpose TEXT DEFAULT '',
            itemsJson TEXT DEFAULT '[]',
            remarks TEXT DEFAULT '',
            isDefault INTEGER DEFAULT 0,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS doc_dispatch_vault (
            id TEXT PRIMARY KEY,
            docName TEXT NOT NULL,
            category TEXT DEFAULT '법인기본',
            issueDate TEXT DEFAULT '',
            validityDays INTEGER DEFAULT 0,
            fileUrl TEXT DEFAULT '',
            originalName TEXT DEFAULT '',
            mimeType TEXT DEFAULT '',
            fileSize INTEGER DEFAULT 0,
            memo TEXT DEFAULT '',
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    // 마이그레이션 (혹시 누락 컬럼이 있을 경우 대비)
    try { await dbRun(`ALTER TABLE doc_dispatch_packages ADD COLUMN coverTitle TEXT DEFAULT ''`); } catch (e) {}
    try { await dbRun(`ALTER TABLE doc_dispatch_packages ADD COLUMN userEmail TEXT DEFAULT ''`); } catch (e) {}

    // 기본 프리셋 시딩
    const row = await dbGet(`SELECT COUNT(*) AS cnt FROM doc_dispatch_templates`);
    if (!row || row.cnt === 0) {
        const now = new Date().toISOString();
        for (const tpl of DEFAULT_TEMPLATES) {
            await dbRun(
                `INSERT INTO doc_dispatch_templates (id, name, category, purpose, itemsJson, remarks, isDefault, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    tpl.id,
                    tpl.name,
                    tpl.category,
                    tpl.purpose,
                    JSON.stringify(tpl.items),
                    tpl.remarks,
                    tpl.isDefault ? 1 : 0,
                    now,
                    now
                ]
            );
        }
        console.log('[DocDispatch] 기본 서류 프리셋 3종 시딩 완료');
    }

    console.log('[DocDispatch] 테이블 초기화 완료');
}

// ─────────────────────────────────────────────────────────────
// 파일 업로드 설정 (Multer)
// ─────────────────────────────────────────────────────────────
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const DOC_DISPATCH_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'doc-dispatch');
if (!fs.existsSync(DOC_DISPATCH_UPLOAD_DIR)) {
    fs.mkdirSync(DOC_DISPATCH_UPLOAD_DIR, { recursive: true });
}

function decodeOriginalName(rawName) {
    if (!rawName) return 'document';
    try {
        // Multer/Busboy latin1 -> utf8 디코딩
        return Buffer.from(rawName, 'latin1').toString('utf8');
    } catch (e) {
        return rawName;
    }
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        if (!fs.existsSync(DOC_DISPATCH_UPLOAD_DIR)) {
            fs.mkdirSync(DOC_DISPATCH_UPLOAD_DIR, { recursive: true });
        }
        cb(null, DOC_DISPATCH_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const decoded = decodeOriginalName(file.originalname);
        const ext = path.extname(decoded).toLowerCase();
        const base = path.basename(decoded, ext)
            .replace(/[<>:"/\\|?*%#\x00-\x1f]/g, '_')
            .trim()
            .slice(0, 80) || 'doc';
        const unique = Date.now() + '-' + crypto.randomBytes(3).toString('hex');
        cb(null, `${unique}-${base}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const decoded = decodeOriginalName(file.originalname);
        const ext = path.extname(decoded).toLowerCase();
        const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];
        if (allowedExts.includes(ext)) {
            return cb(null, true);
        }
        cb(new Error('PDF 또는 이미지 파일(JPG, PNG, WEBP, GIF, BMP)만 업로드할 수 있습니다.'));
    }
});

// 다중 파일 업로드
router.post('/upload', (req, res) => {
    upload.array('files', 20)(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
        try {
            const now = new Date().toISOString();
            const uploadedFiles = (req.files || []).map((file) => {
                const originalName = decodeOriginalName(file.originalname);
                return {
                    id: 'FIL-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
                    url: `/api/doc-dispatch/uploads/${encodeURIComponent(file.filename)}`,
                    filename: file.filename,
                    originalName,
                    mimeType: file.mimetype || '',
                    size: file.size || 0,
                    uploadedAt: now
                };
            });
            res.json({ success: true, files: uploadedFiles });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
});

// ─────────────────────────────────────────────────────────────
// 1. 발송/제출 패키지 API (doc_dispatch_packages)
// ─────────────────────────────────────────────────────────────
router.get('/packages', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT * FROM doc_dispatch_packages ORDER BY updatedAt DESC, createdAt DESC`);
        const formatted = rows.map(r => ({
            ...r,
            items: safeJsonParse(r.itemsJson, []),
            printOptions: safeJsonParse(r.printOptionsJson, {})
        }));
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/packages/:id', async (req, res) => {
    try {
        const row = await dbGet(`SELECT * FROM doc_dispatch_packages WHERE id = ?`, [req.params.id]);
        if (!row) return res.status(404).json({ error: '제출 패키지 내역을 찾을 수 없습니다.' });
        res.json({
            ...row,
            items: safeJsonParse(row.itemsJson, []),
            printOptions: safeJsonParse(row.printOptionsJson, {})
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/packages', async (req, res) => {
    const p = req.body || {};
    const id = p.id || ('DPK-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    const now = new Date().toISOString();
    const itemsJson = typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []);
    const printOptionsJson = typeof p.printOptions === 'string' ? p.printOptions : JSON.stringify(p.printOptions || {});
    const userEmail = (p.userEmail || (req.user ? req.user.email : '') || '').trim();

    try {
        await dbRun(
            `INSERT INTO doc_dispatch_packages (
                id, docNo, coverTitle, title, recipient, purpose, submitDate, submitMethod,
                author, contact, status, itemsJson, printOptionsJson, remarks, userEmail, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                (p.docNo || '').trim(),
                (p.coverTitle || '').trim(),
                (p.title || '').trim(),
                (p.recipient || '').trim(),
                (p.purpose || '').trim(),
                (p.submitDate || '').trim(),
                (p.submitMethod || '방문제출').trim(),
                (p.author || '').trim(),
                (p.contact || '').trim(),
                (p.status || '준비중').trim(),
                itemsJson,
                printOptionsJson,
                (p.remarks || '').trim(),
                userEmail,
                now,
                now
            ]
        );
        const created = await dbGet(`SELECT * FROM doc_dispatch_packages WHERE id = ?`, [id]);
        res.status(201).json({
            message: '문서 발송 패키지가 서버에 저장되었습니다.',
            package: {
                ...created,
                items: safeJsonParse(created.itemsJson, []),
                printOptions: safeJsonParse(created.printOptionsJson, {})
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/packages/:id', async (req, res) => {
    const id = req.params.id;
    const p = req.body || {};
    const now = new Date().toISOString();
    const itemsJson = typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []);
    const printOptionsJson = typeof p.printOptions === 'string' ? p.printOptions : JSON.stringify(p.printOptions || {});

    try {
        const result = await dbRun(
            `UPDATE doc_dispatch_packages SET
                docNo = ?, coverTitle = ?, title = ?, recipient = ?, purpose = ?,
                submitDate = ?, submitMethod = ?, author = ?, contact = ?, status = ?,
                itemsJson = ?, printOptionsJson = ?, remarks = ?, updatedAt = ?
             WHERE id = ?`,
            [
                (p.docNo || '').trim(),
                (p.coverTitle || '').trim(),
                (p.title || '').trim(),
                (p.recipient || '').trim(),
                (p.purpose || '').trim(),
                (p.submitDate || '').trim(),
                (p.submitMethod || '방문제출').trim(),
                (p.author || '').trim(),
                (p.contact || '').trim(),
                (p.status || '준비중').trim(),
                itemsJson,
                printOptionsJson,
                (p.remarks || '').trim(),
                now,
                id
            ]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: '수정할 문서를 찾을 수 없습니다.' });
        }
        const updated = await dbGet(`SELECT * FROM doc_dispatch_packages WHERE id = ?`, [id]);
        res.json({
            message: '문서 발송 패키지가 수정되었습니다.',
            package: {
                ...updated,
                items: safeJsonParse(updated.itemsJson, []),
                printOptions: safeJsonParse(updated.printOptionsJson, {})
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/packages/:id', async (req, res) => {
    try {
        const result = await dbRun(`DELETE FROM doc_dispatch_packages WHERE id = ?`, [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        res.json({ message: '삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/packages/delete', async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: '삭제할 항목을 선택하세요.' });
    try {
        const placeholders = ids.map(() => '?').join(',');
        const result = await dbRun(`DELETE FROM doc_dispatch_packages WHERE id IN (${placeholders})`, ids);
        res.json({ message: '선택 항목이 삭제되었습니다.', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 2. 필요서류 프리셋 (템플릿) API (doc_dispatch_templates)
// ─────────────────────────────────────────────────────────────
router.get('/templates', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT * FROM doc_dispatch_templates ORDER BY isDefault DESC, updatedAt DESC, name ASC`);
        res.json(rows.map(r => ({
            ...r,
            items: safeJsonParse(r.itemsJson, [])
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/templates', async (req, res) => {
    const p = req.body || {};
    if (!p.name || !String(p.name).trim()) {
        return res.status(400).json({ error: '프리셋 이름을 입력하세요.' });
    }
    const id = p.id || ('TPL-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    const now = new Date().toISOString();
    const itemsJson = typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []);

    try {
        await dbRun(
            `INSERT INTO doc_dispatch_templates (id, name, category, purpose, itemsJson, remarks, isDefault, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                String(p.name).trim(),
                (p.category || '기타').trim(),
                (p.purpose || '').trim(),
                itemsJson,
                (p.remarks || '').trim(),
                p.isDefault ? 1 : 0,
                now,
                now
            ]
        );
        const created = await dbGet(`SELECT * FROM doc_dispatch_templates WHERE id = ?`, [id]);
        res.status(201).json({
            message: '프리셋이 저장되었습니다.',
            template: { ...created, items: safeJsonParse(created.itemsJson, []) }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/templates/:id', async (req, res) => {
    const id = req.params.id;
    const p = req.body || {};
    const now = new Date().toISOString();
    const itemsJson = typeof p.items === 'string' ? p.items : JSON.stringify(p.items || []);

    try {
        const result = await dbRun(
            `UPDATE doc_dispatch_templates SET name = ?, category = ?, purpose = ?, itemsJson = ?, remarks = ?, updatedAt = ? WHERE id = ?`,
            [
                String(p.name || '').trim(),
                (p.category || '기타').trim(),
                (p.purpose || '').trim(),
                itemsJson,
                (p.remarks || '').trim(),
                now,
                id
            ]
        );
        if (result.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        const updated = await dbGet(`SELECT * FROM doc_dispatch_templates WHERE id = ?`, [id]);
        res.json({
            message: '프리셋이 수정되었습니다.',
            template: { ...updated, items: safeJsonParse(updated.itemsJson, []) }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/templates/:id', async (req, res) => {
    try {
        const result = await dbRun(`DELETE FROM doc_dispatch_templates WHERE id = ?`, [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '프리셋이 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 3. 상용 법인서류 보관함 (Master Vault) API (doc_dispatch_vault)
// ─────────────────────────────────────────────────────────────
router.get('/vault', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT * FROM doc_dispatch_vault ORDER BY updatedAt DESC, docName ASC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/vault', async (req, res) => {
    const p = req.body || {};
    if (!p.docName || !String(p.docName).trim()) {
        return res.status(400).json({ error: '상용 서류명을 입력하세요.' });
    }
    const id = p.id || ('VLT-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
    const now = new Date().toISOString();

    try {
        await dbRun(
            `INSERT INTO doc_dispatch_vault (
                id, docName, category, issueDate, validityDays, fileUrl, originalName, mimeType, fileSize, memo, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                String(p.docName).trim(),
                (p.category || '법인기본').trim(),
                (p.issueDate || '').trim(),
                parseInt(p.validityDays, 10) || 0,
                (p.fileUrl || '').trim(),
                (p.originalName || '').trim(),
                (p.mimeType || '').trim(),
                parseInt(p.fileSize, 10) || 0,
                (p.memo || '').trim(),
                now,
                now
            ]
        );
        const created = await dbGet(`SELECT * FROM doc_dispatch_vault WHERE id = ?`, [id]);
        res.status(201).json({ message: '상용서류함에 등록되었습니다.', item: created });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/vault/:id', async (req, res) => {
    const id = req.params.id;
    const p = req.body || {};
    const now = new Date().toISOString();

    try {
        const result = await dbRun(
            `UPDATE doc_dispatch_vault SET
                docName = ?, category = ?, issueDate = ?, validityDays = ?,
                fileUrl = ?, originalName = ?, mimeType = ?, fileSize = ?, memo = ?, updatedAt = ?
             WHERE id = ?`,
            [
                String(p.docName || '').trim(),
                (p.category || '법인기본').trim(),
                (p.issueDate || '').trim(),
                parseInt(p.validityDays, 10) || 0,
                (p.fileUrl || '').trim(),
                (p.originalName || '').trim(),
                (p.mimeType || '').trim(),
                parseInt(p.fileSize, 10) || 0,
                (p.memo || '').trim(),
                now,
                id
            ]
        );
        if (result.changes === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다.' });
        const updated = await dbGet(`SELECT * FROM doc_dispatch_vault WHERE id = ?`, [id]);
        res.json({ message: '상용서류 정보가 수정되었습니다.', item: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/vault/:id', async (req, res) => {
    try {
        const result = await dbRun(`DELETE FROM doc_dispatch_vault WHERE id = ?`, [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다.' });
        res.json({ message: '상용서류함에서 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    setDb,
    initDocDispatchTables
};
