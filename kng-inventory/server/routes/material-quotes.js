const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// ── 파일 업로드 설정 ──
const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? path.join(process.env.UPLOAD_DIR, 'mat-quotes')
    : path.join(__dirname, '..', 'uploads', 'mat-quotes');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const ts = Date.now();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9가-힣._-]/g, '_');
        cb(null, 'mq-' + ts + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
    fileFilter: function (req, file, cb) {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        if (ext) return cb(null, true);
        cb(new Error('허용되지 않는 파일 형식입니다. (이미지 파일만 허용)'));
    }
});

// 정적 파일 서빙 (다운로드용)
router.use('/uploads', express.static(UPLOAD_DIR));

// DB 초기화
function initMaterialQuotesTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS mat_quote_items (
                    id TEXT PRIMARY KEY,
                    itemName TEXT DEFAULT '',
                    category TEXT DEFAULT '',
                    images TEXT DEFAULT '[]',
                    remarks TEXT DEFAULT '',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `);
            database.run(`
                CREATE TABLE IF NOT EXISTS mat_quote_variants (
                    id TEXT PRIMARY KEY,
                    itemId TEXT NOT NULL,
                    spec TEXT DEFAULT '',
                    unit TEXT DEFAULT '',
                    sortOrder INTEGER DEFAULT 0,
                    createdAt TEXT,
                    FOREIGN KEY(itemId) REFERENCES mat_quote_items(id) ON DELETE CASCADE
                )
            `);
            database.run(`
                CREATE TABLE IF NOT EXISTS mat_quote_supplier_quotes (
                    id TEXT PRIMARY KEY,
                    variantId TEXT NOT NULL,
                    supplier TEXT DEFAULT '',
                    unitPrice INTEGER DEFAULT 0,
                    currency TEXT DEFAULT 'KRW',
                    quoteDate TEXT DEFAULT '',
                    remarks TEXT DEFAULT '',
                    isSelected INTEGER DEFAULT 0,
                    createdAt TEXT,
                    FOREIGN KEY(variantId) REFERENCES mat_quote_variants(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('mat_quote 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('mat_quote 테이블 확인 완료');
                    resolve();
                }
            });
        });
    });
}

// ── API 엔드포인트 ──

// 전체 데이터 조회 (Items + Variants + Quotes)
router.get('/', async (req, res) => {
    try {
        const items = await dbAll('SELECT * FROM mat_quote_items ORDER BY createdAt DESC');
        const variants = await dbAll('SELECT * FROM mat_quote_variants ORDER BY sortOrder ASC, createdAt ASC');
        const quotes = await dbAll('SELECT * FROM mat_quote_supplier_quotes ORDER BY createdAt ASC');

        // 트리 구조로 조립
        const itemsMap = {};
        items.forEach(item => {
            try { item.images = JSON.parse(item.images); } catch (e) { item.images = []; }
            item.variants = [];
            itemsMap[item.id] = item;
        });

        const variantsMap = {};
        variants.forEach(variant => {
            variant.quotes = [];
            variantsMap[variant.id] = variant;
            if (itemsMap[variant.itemId]) {
                itemsMap[variant.itemId].variants.push(variant);
            }
        });

        quotes.forEach(quote => {
            if (variantsMap[quote.variantId]) {
                variantsMap[quote.variantId].quotes.push(quote);
            }
        });

        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 기존 카테고리 목록 가져오기 (자동완성 용도)
router.get('/categories', async (req, res) => {
    try {
        const rows = await dbAll('SELECT DISTINCT category FROM mat_quote_items WHERE category IS NOT NULL AND category != "" ORDER BY category ASC');
        const categories = rows.map(r => r.category);
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Items ──
router.post('/', async (req, res) => {
    try {
        const p = req.body;
        const id = 'MQI-' + Date.now();
        const now = new Date().toISOString();
        const imagesStr = JSON.stringify(p.images || []);
        
        const sql = `INSERT INTO mat_quote_items (id, itemName, category, images, remarks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await dbRun(sql, [id, p.itemName || '', p.category || '', imagesStr, p.remarks || '', now, now]);
        
        // Return created item
        res.status(201).json({ id, itemName: p.itemName, category: p.category, images: p.images || [], remarks: p.remarks, createdAt: now, updatedAt: now, variants: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        const now = new Date().toISOString();
        const imagesStr = JSON.stringify(p.images || []);

        const sql = `UPDATE mat_quote_items SET itemName = ?, category = ?, images = ?, remarks = ?, updatedAt = ? WHERE id = ?`;
        const result = await dbRun(sql, [p.itemName || '', p.category || '', imagesStr, p.remarks || '', now, id]);

        if (result.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const variants = await dbAll('SELECT id FROM mat_quote_variants WHERE itemId = ?', [id]);
        for (let v of variants) {
            await dbRun('DELETE FROM mat_quote_supplier_quotes WHERE variantId = ?', [v.id]);
        }
        await dbRun('DELETE FROM mat_quote_variants WHERE itemId = ?', [id]);
        
        const result = await dbRun('DELETE FROM mat_quote_items WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Variants ──
router.post('/variants', async (req, res) => {
    try {
        const p = req.body;
        if (!p.itemId) return res.status(400).json({ error: 'itemId is required' });
        
        const id = 'MQV-' + Date.now() + Math.floor(Math.random()*1000);
        const now = new Date().toISOString();
        
        const sql = `INSERT INTO mat_quote_variants (id, itemId, spec, unit, sortOrder, createdAt) VALUES (?, ?, ?, ?, ?, ?)`;
        await dbRun(sql, [id, p.itemId, p.spec || '', p.unit || '', p.sortOrder || 0, now]);
        
        res.status(201).json({ id, itemId: p.itemId, spec: p.spec, unit: p.unit, sortOrder: p.sortOrder, createdAt: now, quotes: [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/variants/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        
        const sql = `UPDATE mat_quote_variants SET spec = ?, unit = ?, sortOrder = ? WHERE id = ?`;
        const result = await dbRun(sql, [p.spec || '', p.unit || '', p.sortOrder || 0, id]);
        
        if (result.changes === 0) return res.status(404).json({ error: '규격을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/variants/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await dbRun('DELETE FROM mat_quote_supplier_quotes WHERE variantId = ?', [id]);
        const result = await dbRun('DELETE FROM mat_quote_variants WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: '규격을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── Quotes ──
router.post('/quotes', async (req, res) => {
    try {
        const p = req.body;
        if (!p.variantId) return res.status(400).json({ error: 'variantId is required' });
        
        const id = 'MQQ-' + Date.now() + Math.floor(Math.random()*1000);
        const now = new Date().toISOString();
        
        const sql = `INSERT INTO mat_quote_supplier_quotes (id, variantId, supplier, unitPrice, currency, quoteDate, remarks, isSelected, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await dbRun(sql, [id, p.variantId, p.supplier || '', p.unitPrice || 0, p.currency || 'KRW', p.quoteDate || '', p.remarks || '', p.isSelected ? 1 : 0, now]);
        
        res.status(201).json({ id, variantId: p.variantId, supplier: p.supplier, unitPrice: p.unitPrice, currency: p.currency, quoteDate: p.quoteDate, remarks: p.remarks, isSelected: p.isSelected ? 1 : 0, createdAt: now });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/quotes/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const p = req.body;
        
        const sql = `UPDATE mat_quote_supplier_quotes SET supplier = ?, unitPrice = ?, currency = ?, quoteDate = ?, remarks = ?, isSelected = ? WHERE id = ?`;
        const result = await dbRun(sql, [p.supplier || '', p.unitPrice || 0, p.currency || 'KRW', p.quoteDate || '', p.remarks || '', p.isSelected ? 1 : 0, id]);
        
        if (result.changes === 0) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/quotes/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const result = await dbRun('DELETE FROM mat_quote_supplier_quotes WHERE id = ?', [id]);
        if (result.changes === 0) return res.status(404).json({ error: '견적을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 파일 업로드 (멀티) ──
router.post('/files/upload', upload.array('files', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '업로드된 파일이 없습니다.' });
        }
        const fileUrls = req.files.map(f => `/api/mat-quotes/uploads/${f.filename}`);
        res.json({ urls: fileUrls });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/files/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = path.join(UPLOAD_DIR, filename);
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
        res.json({ message: '파일 삭제 완료' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── URL을 통한 이미지 업로드 ──
router.post('/files/upload-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        // Node 18+ has native fetch, no need for node-fetch
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.startsWith('image/')) {
            throw new Error('URL does not point to a valid image');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const ts = Date.now();
        // 간단한 확장자 추출 (기본 jpg)
        let ext = '.jpg';
        if (contentType.includes('png')) ext = '.png';
        else if (contentType.includes('gif')) ext = '.gif';
        else if (contentType.includes('webp')) ext = '.webp';

        const filename = 'mq-' + ts + '-url' + ext;
        const filepath = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(filepath, buffer);

        res.json({ urls: [`/api/mat-quotes/uploads/${filename}`] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = {
    router,
    initMaterialQuotesTables,
    setDb
};
