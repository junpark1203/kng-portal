/**
 * TBM 자재 규격 API (/api/tbm/...)
 * - 자재 규격 CRUD
 * - 필드 프리셋 관리 (분류별 동적 필드)
 * - 파일 업로드/다운로드/삭제
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

// ── 파일 업로드 설정 ──
const TBM_UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.join(process.env.UPLOAD_DIR, 'tbm')
    : path.join(__dirname, '..', 'uploads', 'tbm');

if (!fs.existsSync(TBM_UPLOAD_DIR)) {
    fs.mkdirSync(TBM_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, TBM_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // 타임스탬프 + 원본 파일명 (한글 파일명 보존)
        const ts = Date.now();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
        cb(null, 'tbm-' + ts + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
    fileFilter: function (req, file, cb) {
        const allowed = /jpeg|jpg|png|gif|webp|bmp|pdf|xlsx|xls|csv|doc|docx|ppt|pptx|zip|rar|7z|dwg|dxf/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        if (ext) return cb(null, true);
        cb(new Error('허용되지 않는 파일 형식입니다. (PDF, Excel, 이미지, CAD, 압축파일 등 허용)'));
    }
});

// 정적 파일 서빙 (다운로드용)
router.use('/uploads', express.static(TBM_UPLOAD_DIR));

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
function initTbmTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            // 자재 규격 테이블
            database.run(`
                CREATE TABLE IF NOT EXISTS tbm_materials (
                    id TEXT PRIMARY KEY,
                    site TEXT DEFAULT '',
                    equipment TEXT DEFAULT '',
                    category TEXT DEFAULT '',
                    itemName TEXT DEFAULT '',
                    spec TEXT DEFAULT '',
                    unit TEXT DEFAULT 'EA',
                    qty INTEGER DEFAULT 0,
                    price INTEGER DEFAULT 0,
                    total INTEGER DEFAULT 0,
                    manufacturer TEXT DEFAULT '',
                    remarks TEXT DEFAULT '',
                    customFields TEXT DEFAULT '{}',
                    files TEXT DEFAULT '[]',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `);

            // 신규 컬럼 추가 (기존 DB 호환)
            database.run('ALTER TABLE tbm_materials ADD COLUMN sourceType TEXT DEFAULT "domestic"', () => {});
            database.run('ALTER TABLE tbm_materials ADD COLUMN quoteDate TEXT DEFAULT ""', () => {});
            database.run('ALTER TABLE tbm_materials ADD COLUMN perUnitBasis INTEGER DEFAULT 0', () => {});
            database.run('ALTER TABLE tbm_materials ADD COLUMN incoterms TEXT DEFAULT "[]"', () => {});
            database.run('ALTER TABLE tbm_materials ADD COLUMN customFieldNotes TEXT DEFAULT "{}"', () => {});

            // 필드 프리셋 테이블 (분류별 커스텀 필드 정의)
            database.run(`
                CREATE TABLE IF NOT EXISTS tbm_field_presets (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('tbm_ 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('tbm_materials / tbm_field_presets 테이블 확인 완료');
                    resolve();
                }
            });
        });
    });
}

// ════════════════════════════════════════
// 자재 규격 API
// ════════════════════════════════════════

// 전체 목록 조회
router.get('/materials', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM tbm_materials ORDER BY createdAt DESC');
        // JSON 파싱
        const result = rows.map(r => {
            try { r.customFields = JSON.parse(r.customFields || '{}'); } catch(e) { r.customFields = {}; }
            try { r.customFieldNotes = JSON.parse(r.customFieldNotes || '{}'); } catch(e) { r.customFieldNotes = {}; }
            try { r.files = JSON.parse(r.files || '[]'); } catch(e) { r.files = []; }
            try { r.incoterms = JSON.parse(r.incoterms || '[]'); } catch(e) { r.incoterms = []; }
            return r;
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단일 조회
router.get('/materials/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM tbm_materials WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '자재를 찾을 수 없습니다.' });
        try { row.customFields = JSON.parse(row.customFields || '{}'); } catch(e) { row.customFields = {}; }
        try { row.customFieldNotes = JSON.parse(row.customFieldNotes || '{}'); } catch(e) { row.customFieldNotes = {}; }
        try { row.files = JSON.parse(row.files || '[]'); } catch(e) { row.files = []; }
        try { row.incoterms = JSON.parse(row.incoterms || '[]'); } catch(e) { row.incoterms = []; }
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 신규 등록
router.post('/materials', async (req, res) => {
    try {
        const p = req.body;
        const id = p.id || ('TBM-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
        const now = new Date().toISOString();
        const qty = p.qty || 0;
        const price = p.price || 0;
        const total = qty * price;
        const sql = `INSERT INTO tbm_materials (id, site, equipment, category, itemName, spec, unit, qty, price, total, manufacturer, remarks, customFields, customFieldNotes, files, sourceType, quoteDate, perUnitBasis, incoterms, createdAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [
            id, p.site||'', p.equipment||'', p.category||'', p.itemName||'',
            p.spec||'', p.unit||'EA', qty, price, total,
            p.manufacturer||'', p.remarks||'',
            JSON.stringify(p.customFields || {}),
            JSON.stringify(p.customFieldNotes || {}),
            JSON.stringify(p.files || []),
            p.sourceType || 'domestic',
            p.quoteDate || '',
            p.perUnitBasis || 0,
            JSON.stringify(p.incoterms || []),
            now, now
        ];
        await dbRun(sql, params);
        res.status(201).json({ message: '등록 성공', id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수정
router.put('/materials/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        const now = new Date().toISOString();
        const qty = p.qty || 0;
        const price = p.price || 0;
        const total = qty * price;
        const sql = `UPDATE tbm_materials SET site=?, equipment=?, category=?, itemName=?, spec=?, unit=?, qty=?, price=?, total=?, manufacturer=?, remarks=?, customFields=?, customFieldNotes=?, files=?, sourceType=?, quoteDate=?, perUnitBasis=?, incoterms=?, updatedAt=? WHERE id=?`;
        const params = [
            p.site||'', p.equipment||'', p.category||'', p.itemName||'',
            p.spec||'', p.unit||'EA', qty, price, total,
            p.manufacturer||'', p.remarks||'',
            JSON.stringify(p.customFields || {}),
            JSON.stringify(p.customFieldNotes || {}),
            JSON.stringify(p.files || []),
            p.sourceType || 'domestic',
            p.quoteDate || '',
            p.perUnitBasis || 0,
            JSON.stringify(p.incoterms || []),
            now, id
        ];
        const result = await dbRun(sql, params);
        if (result.changes === 0) return res.status(404).json({ error: '자재를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 다중 삭제
router.post('/materials/delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
        }

        // 삭제 전 첨부파일도 함께 제거
        const placeholders = ids.map(() => '?').join(',');
        const rows = await dbAll(`SELECT files FROM tbm_materials WHERE id IN (${placeholders})`, ids);
        rows.forEach(row => {
            try {
                const files = JSON.parse(row.files || '[]');
                files.forEach(f => {
                    const filePath = path.join(TBM_UPLOAD_DIR, f.filename);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                });
            } catch(e) {}
        });

        const result = await dbRun(`DELETE FROM tbm_materials WHERE id IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// 필드 프리셋 API
// ════════════════════════════════════════

// 프리셋 목록 조회
router.get('/presets', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM tbm_field_presets ORDER BY updatedAt DESC');
        res.json(rows.map(r => {
            try { return { ...JSON.parse(r.data), id: r.id }; }
            catch(e) { return { id: r.id, category: '', fields: [] }; }
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 프리셋 저장 (upsert)
router.post('/presets', async (req, res) => {
    try {
        const p = req.body;
        if (!p.id) return res.status(400).json({ error: 'id 필수' });
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO tbm_field_presets (id, data, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `, [p.id, JSON.stringify(p), now]);
        res.json({ message: '저장 성공', id: p.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 프리셋 삭제
router.delete('/presets/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM tbm_field_presets WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// 파일 업로드 API
// ════════════════════════════════════════

// 파일 업로드 (다중)
router.post('/files/upload', upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '파일이 필요합니다.' });
        }
        const baseUrl = `${req.protocol}://${req.get('host')}/api/tbm/uploads`;
        const results = req.files.map(f => ({
            filename: f.filename,
            originalName: f.originalname,
            url: baseUrl + '/' + f.filename,
            size: f.size,
            mimetype: f.mimetype
        }));
        res.json({ message: '업로드 성공', files: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 파일 삭제
router.delete('/files/:filename', (req, res) => {
    try {
        const filePath = path.join(TBM_UPLOAD_DIR, req.params.filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ message: '삭제 성공' });
        } else {
            res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.setDb = setDb;
module.exports.initTbmTables = initTbmTables;
