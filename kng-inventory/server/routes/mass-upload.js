// ========================================
// SmartStore Mass Upload — API 라우트
// 기존 kng-inventory Express 서버에 마운트
// ========================================

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// ── Multer 설정: NAS 이미지 폴더에 직접 저장 ──
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// uploads 디렉터리가 없으면 생성
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // 프론트엔드가 보낸 autoName 우선 사용 (관리번호_타입.확장자)
        // 예: KNG-20260420-001_main.jpg
        if (req.body.autoName) {
            cb(null, req.body.autoName);
        } else {
            // 폴백: 타임스탬프 + 원본 파일명
            const ts = Date.now();
            cb(null, ts + '_' + file.originalname);
        }
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: function (req, file, cb) {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
});

// DB 인스턴스는 server.js에서 주입
let db;

// 정적 파일 라우팅 추가
router.use('/uploads', express.static(UPLOAD_DIR));

function setDb(database) {
    db = database;
}

// ════════════════════════════════════════
// HELPER: Promise wrapper for sqlite3
// ════════════════════════════════════════
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
// PRODUCTS API
// ════════════════════════════════════════

// 전체 목록
router.get('/products', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM mu_products ORDER BY updatedAt DESC');
        const products = rows.map(r => {
            const data = JSON.parse(r.data);
            data.id = r.id;
            data.code = r.code;
            return data;
        });
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 단일 조회
router.get('/products/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM mu_products WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        const data = JSON.parse(row.data);
        data.id = row.id;
        data.code = row.code;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 등록/수정 (upsert)
router.post('/products', async (req, res) => {
    try {
        const p = req.body;
        if (!p.id) return res.status(400).json({ error: 'id 필수' });
        const now = new Date().toISOString();
        const dataStr = JSON.stringify(p);

        await dbRun(`
            INSERT INTO mu_products (id, code, data, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                code = excluded.code,
                data = excluded.data,
                updatedAt = excluded.updatedAt
        `, [p.id, p.code || '', dataStr, p.createdAt || now, now]);

        res.json({ message: '저장 성공', id: p.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 다중 삭제
router.post('/products/delete', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
        }
        const placeholders = ids.map(() => '?').join(',');
        const result = await dbRun(`DELETE FROM mu_products WHERE id IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: result.changes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// PRESETS API
// ════════════════════════════════════════

router.get('/presets', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM mu_presets ORDER BY updatedAt DESC');
        res.json(rows.map(r => ({ ...JSON.parse(r.data), id: r.id })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/presets', async (req, res) => {
    try {
        const p = req.body;
        if (!p.id) return res.status(400).json({ error: 'id 필수' });
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO mu_presets (id, data, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `, [p.id, JSON.stringify(p), now]);
        res.json({ message: '저장 성공', id: p.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/presets/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM mu_presets WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// ADDRESSES API
// ════════════════════════════════════════

router.get('/addresses', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM mu_addresses ORDER BY updatedAt DESC');
        res.json(rows.map(r => ({ ...JSON.parse(r.data), id: r.id })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/addresses', async (req, res) => {
    try {
        const a = req.body;
        if (!a.id) return res.status(400).json({ error: 'id 필수' });
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO mu_addresses (id, data, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
        `, [a.id, JSON.stringify(a), now]);
        res.json({ message: '저장 성공', id: a.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/addresses/:id', async (req, res) => {
    try {
        const result = await dbRun('DELETE FROM mu_addresses WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: '주소를 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// IMAGES API
// ════════════════════════════════════════

// 이미지 업로드 (단일)
router.post('/images/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
        const filename = req.file.filename;
        const baseUrl = `${req.protocol}://${req.get('host')}/api/mass-upload/uploads`;
        const url = baseUrl + '/' + filename;
        res.json({
            message: '업로드 성공',
            filename: filename,
            autoName: filename,
            url: url,
            size: req.file.size
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 이미지 다중 업로드
router.post('/images/upload-multiple', upload.array('images', 20), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
        }
        const baseUrl = `${req.protocol}://${req.get('host')}/api/mass-upload/uploads`;
        const results = req.files.map(f => ({
            filename: f.filename,
            url: baseUrl + '/' + f.filename,
            size: f.size
        }));
        res.json({ message: '업로드 성공', files: results });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 이미지 삭제
router.delete('/images/:filename', (req, res) => {
    try {
        const filePath = path.join(UPLOAD_DIR, req.params.filename);
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

// URL에서 이미지 다운로드 → 서버에 저장
router.post('/images/upload-url', async (req, res) => {
    try {
        const { url, autoName } = req.body;
        if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });

        const ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';
        const filename = autoName || ('url_' + Date.now() + ext);
        const filePath = path.join(UPLOAD_DIR, filename);

        // Node.js 내장 모듈로 다운로드
        const protocol = url.startsWith('https') ? require('https') : require('http');
        await new Promise((resolve, reject) => {
            const request = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
                // 리다이렉트 처리
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    const redirectProto = response.headers.location.startsWith('https') ? require('https') : require('http');
                    redirectProto.get(response.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
                        const fileStream = fs.createWriteStream(filePath);
                        res2.pipe(fileStream);
                        fileStream.on('finish', () => { fileStream.close(); resolve(); });
                        fileStream.on('error', reject);
                    }).on('error', reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject(new Error('다운로드 실패: HTTP ' + response.statusCode));
                    return;
                }
                const fileStream = fs.createWriteStream(filePath);
                response.pipe(fileStream);
                fileStream.on('finish', () => { fileStream.close(); resolve(); });
                fileStream.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(15000, () => { request.destroy(); reject(new Error('다운로드 타임아웃 (15초)')); });
        });

        const stats = fs.statSync(filePath);
        const baseUrl = `${req.protocol}://${req.get('host')}/api/mass-upload/uploads`;
        res.json({
            message: '다운로드 성공',
            filename: filename,
            autoName: filename,
            url: baseUrl + '/' + filename,
            size: stats.size
        });
    } catch (err) {
        res.status(500).json({ error: 'URL 다운로드 실패: ' + err.message });
    }
});

// ════════════════════════════════════════
// SETTINGS API
// ════════════════════════════════════════

router.get('/settings/:key', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM mu_settings WHERE key = ?', [req.params.key]);
        if (!row) return res.json({ key: req.params.key, value: null });
        res.json({ key: row.key, value: JSON.parse(row.value) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/settings/:key', async (req, res) => {
    try {
        const { value } = req.body;
        await dbRun(`
            INSERT INTO mu_settings (key, value)
            VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, [req.params.key, JSON.stringify(value)]);
        res.json({ message: '저장 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// SEQUENCE API (관리번호 생성)
// ════════════════════════════════════════

router.post('/sequence/next', async (req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        await dbRun(`
            INSERT INTO mu_sequences (dateKey, seq)
            VALUES (?, 1)
            ON CONFLICT(dateKey) DO UPDATE SET seq = seq + 1
        `, [today]);
        const row = await dbGet('SELECT seq FROM mu_sequences WHERE dateKey = ?', [today]);
        res.json({ dateKey: today, seq: row.seq });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// EXPORT CART API
// ════════════════════════════════════════

router.get('/export-cart', async (req, res) => {
    try {
        const rows = await dbAll('SELECT productId FROM mu_export_cart');
        res.json(rows.map(r => r.productId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/export-cart', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 배열 필수' });
        let added = 0;
        for (const id of ids) {
            try {
                await dbRun('INSERT OR IGNORE INTO mu_export_cart (productId) VALUES (?)', [id]);
                added++;
            } catch (e) { /* 중복 무시 */ }
        }
        res.json({ message: '추가 성공', added });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/export-cart/remove', async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids 배열 필수' });
        const placeholders = ids.map(() => '?').join(',');
        await dbRun(`DELETE FROM mu_export_cart WHERE productId IN (${placeholders})`, ids);
        res.json({ message: '제거 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/export-cart', async (req, res) => {
    try {
        await dbRun('DELETE FROM mu_export_cart');
        res.json({ message: '전체 비우기 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ════════════════════════════════════════
// MIGRATION API (localStorage → 서버 1회성)
// ════════════════════════════════════════

router.post('/migrate', async (req, res) => {
    try {
        const { products, presets, addresses, settings, exportCart } = req.body;
        let counts = { products: 0, presets: 0, addresses: 0, settings: 0 };
        const now = new Date().toISOString();

        // 상품
        if (products && Array.isArray(products)) {
            for (const p of products) {
                await dbRun(`
                    INSERT OR REPLACE INTO mu_products (id, code, data, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?)
                `, [p.id, p.code || '', JSON.stringify(p), p.createdAt || now, p.updatedAt || now]);
                counts.products++;
            }
        }

        // 프리셋
        if (presets && Array.isArray(presets)) {
            for (const p of presets) {
                await dbRun(`
                    INSERT OR REPLACE INTO mu_presets (id, data, updatedAt)
                    VALUES (?, ?, ?)
                `, [p.id, JSON.stringify(p), now]);
                counts.presets++;
            }
        }

        // 주소
        if (addresses && Array.isArray(addresses)) {
            for (const a of addresses) {
                await dbRun(`
                    INSERT OR REPLACE INTO mu_addresses (id, data, updatedAt)
                    VALUES (?, ?, ?)
                `, [a.id, JSON.stringify(a), now]);
                counts.addresses++;
            }
        }

        // 설정값
        if (settings && typeof settings === 'object') {
            for (const [key, value] of Object.entries(settings)) {
                await dbRun(`
                    INSERT OR REPLACE INTO mu_settings (key, value)
                    VALUES (?, ?)
                `, [key, JSON.stringify(value)]);
                counts.settings++;
            }
        }

        // 엑스포트 카트
        if (exportCart && Array.isArray(exportCart)) {
            for (const id of exportCart) {
                await dbRun('INSERT OR IGNORE INTO mu_export_cart (productId) VALUES (?)', [id]);
            }
        }

        res.json({ message: '마이그레이션 성공', counts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.setDb = setDb;
