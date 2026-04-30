const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 보안 헤더 (Cloudflare Tunnel 대응)
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS 설정
const allowedOrigins = [
    // Cloudflare Pages
    'https://kng-portal.pages.dev',
    /\.kng-portal\.pages\.dev$/,
    'https://kng-portal.junparks.com',
    // sell_it 전용 Pages (추후 설정)
    /sell-it.*\.pages\.dev$/,
    // API 서버 자체
    'https://shopee-api.junparks.com',
    // 로컬 개발
    'http://localhost:8090',
    'http://localhost:8788',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:8090',
    'http://127.0.0.1:8788',
    'http://127.0.0.1:3001'
];
app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        const isAllowed = allowedOrigins.some(function(allowed) {
            if (allowed instanceof RegExp) return allowed.test(origin);
            return allowed === origin;
        });
        if (isAllowed) return callback(null, true);
        callback(new Error('CORS 정책에 의해 차단됨: ' + origin));
    },
    credentials: true
}));

// JSON 바디 파싱
app.use(express.json({ limit: '10mb' }));

// API 접속 횟수 제한
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
    keyGenerator: function(req) {
        return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
    }
});
app.use('/api/', apiLimiter);

// 데이터 디렉터리 확인 및 생성
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 이미지 업로드 디렉터리 (NAS 볼륨 마운트 또는 로컬)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer 설정
const storage = multer.diskStorage({
    destination: function(req, file, cb) { cb(null, UPLOAD_DIR); },
    filename: function(req, file, cb) {
        const ts = Date.now();
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'MA-' + ts + ext);
    }
});
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        const allowed = /jpeg|jpg|png|gif|webp|bmp/;
        if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) return cb(null, true);
        cb(new Error('이미지 파일만 업로드 가능합니다.'));
    }
});

const videoUpload = multer({
    storage: storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        if (path.extname(file.originalname).toLowerCase() === '.mp4' && file.mimetype === 'video/mp4') {
            return cb(null, true);
        }
        cb(new Error('MP4 동영상 파일만 업로드 가능합니다. (최대 30MB)'));
    }
});


// 이미지 정적 서빙
app.use('/api/images', express.static(UPLOAD_DIR));

// SQLite DB 연결
const dbFile = path.join(dataDir, 'sell_it.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('DB 연결 오류:', err.message);
    } else {
        console.log('SQLite 데이터베이스 연결 완료:', dbFile);
        initDb();
    }
});

// ==========================================
// 테이블 생성
// ==========================================
function initDb() {
    db.serialize(() => {
        // 상품 목록
        db.run(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                date TEXT,
                mcode TEXT UNIQUE,
                catEn TEXT,
                catKo TEXT,
                nameEn TEXT,
                nameKo TEXT,
                priceKrw INTEGER DEFAULT 0,
                rate REAL DEFAULT 0,
                rateDate TEXT,
                weight INTEGER DEFAULT 0,
                link TEXT,
                note TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) console.error('products 테이블 생성 오류:', err.message);
            else console.log('products 테이블 확인 완료');
        });

        // 마켓 전송 기록
        db.run(`
            CREATE TABLE IF NOT EXISTS market_exports (
                id TEXT PRIMARY KEY,
                productId TEXT NOT NULL,
                marketCode TEXT NOT NULL,
                exportDate TEXT,
                createdAt TEXT,
                UNIQUE(productId, marketCode)
            )
        `, (err) => {
            if (err) console.error('market_exports 테이블 생성 오류:', err.message);
            else console.log('market_exports 테이블 확인 완료');
        });

        // 수수료 프리셋 (JSON blob)
        db.run(`
            CREATE TABLE IF NOT EXISTS presets (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) console.error('presets 테이블 생성 오류:', err.message);
            else console.log('presets 테이블 확인 완료');
        });

        // 프로모션 프리셋
        db.run(`
            CREATE TABLE IF NOT EXISTS promotion_presets (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) console.error('promotion_presets 테이블 생성 오류:', err.message);
            else console.log('promotion_presets 테이블 확인 완료');
        });

        // 배송비 프리셋
        db.run(`
            CREATE TABLE IF NOT EXISTS shipping_presets (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) console.error('shipping_presets 테이블 생성 오류:', err.message);
            else console.log('shipping_presets 테이블 확인 완료');
        });

        // Market Analysis (경쟁사 분석)
        db.run(`
            CREATE TABLE IF NOT EXISTS market_analysis (
            id TEXT PRIMARY KEY,
            market TEXT DEFAULT 'sg',
            exchangeRate REAL,
            shopeeCategory TEXT,
            productName TEXT,
                storeName TEXT,
                listingPrice REAL DEFAULT 0,
                actualPrice REAL DEFAULT 0,
                weight INTEGER DEFAULT 0,
                sellerShipping REAL DEFAULT 0,
                monthlySales INTEGER DEFAULT 0,
                coupangPrice REAL DEFAULT 0,
                coupangShipping REAL DEFAULT 0,
                naverPrice REAL DEFAULT 0,
                naverShipping REAL DEFAULT 0,
                shopeeUrl TEXT,
                coupangUrl TEXT,
                naverUrl TEXT,
                imageUrl TEXT,
                note TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) console.error('market_analysis 테이블 생성 오류:', err.message);
            else {
                console.log('market_analysis 테이블 확인 완료');
                const cols = [
                    "ALTER TABLE market_analysis ADD COLUMN imageUrls TEXT",
                    "ALTER TABLE market_analysis ADD COLUMN videoUrl TEXT",
                    "ALTER TABLE market_analysis ADD COLUMN coupangRocket INTEGER DEFAULT 0",
                    "ALTER TABLE market_analysis ADD COLUMN exchangeRate REAL"
                ];
                cols.forEach(sql => {
                    db.run(sql, (e) => {});
                });
            }
        });
    });
}

// ==========================================
// Products API
// ==========================================

// 전체 상품 조회
app.get('/api/products', (req, res) => {
    db.all('SELECT * FROM products ORDER BY date DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단일 상품 조회
app.get('/api/products/:id', (req, res) => {
    db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 상품 등록
app.post('/api/products', (req, res) => {
    const p = req.body;
    const id = p.id || ('P-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO products (id, date, mcode, catEn, catKo, nameEn, nameKo, priceKrw, rate, rateDate, weight, link, note, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.date||'', p.mcode||'', p.catEn||'', p.catKo||'', p.nameEn||'', p.nameKo||'',
                    p.priceKrw||0, p.rate||0, p.rateDate||'', p.weight||0, p.link||'', p.note||'', now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 상품 수정
app.put('/api/products/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE products SET date=?, mcode=?, catEn=?, catKo=?, nameEn=?, nameKo=?, priceKrw=?, rate=?, rateDate=?, weight=?, link=?, note=?, updatedAt=?
                 WHERE id=?`;
    const params = [p.date||'', p.mcode||'', p.catEn||'', p.catKo||'', p.nameEn||'', p.nameKo||'',
                    p.priceKrw||0, p.rate||0, p.rateDate||'', p.weight||0, p.link||'', p.note||'', now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 상품 삭제
app.delete('/api/products/:id', (req, res) => {
    db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        // 연관 market_exports도 삭제
        db.run('DELETE FROM market_exports WHERE productId = ?', [req.params.id]);
        res.json({ message: '삭제 성공' });
    });
});

// 상품 다중 삭제
app.post('/api/products/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM products WHERE id IN (${placeholders})`, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        // 연관 market_exports도 삭제
        db.run(`DELETE FROM market_exports WHERE productId IN (${placeholders})`, ids);
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// ==========================================
// Market Exports API
// ==========================================

// 특정 마켓의 전송 목록 (상품 정보 JOIN)
app.get('/api/market-exports', (req, res) => {
    const market = req.query.market;
    if (!market) {
        return res.status(400).json({ error: 'market 파라미터가 필요합니다.' });
    }
    const sql = `
        SELECT me.id as exportId, me.marketCode, me.exportDate, me.createdAt as exportCreatedAt,
               p.*
        FROM market_exports me
        JOIN products p ON me.productId = p.id
        WHERE me.marketCode = ?
        ORDER BY me.exportDate DESC
    `;
    db.all(sql, [market], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 특정 상품의 전송 마켓 목록
app.get('/api/market-exports/product/:productId', (req, res) => {
    db.all('SELECT * FROM market_exports WHERE productId = ?', [req.params.productId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 전체 상품의 마켓 전송 현황 (Product List에서 배지 표시용)
app.get('/api/market-exports/all', (req, res) => {
    db.all('SELECT * FROM market_exports', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // productId별로 그룹핑
        const grouped = {};
        rows.forEach(row => {
            if (!grouped[row.productId]) grouped[row.productId] = [];
            grouped[row.productId].push({ marketCode: row.marketCode, exportDate: row.exportDate });
        });
        res.json(grouped);
    });
});

// 마켓 전송 등록 (bulk - 여러 상품을 한 마켓으로)
app.post('/api/market-exports', (req, res) => {
    const { productIds, marketCode } = req.body;
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0 || !marketCode) {
        return res.status(400).json({ error: 'productIds 배열과 marketCode가 필요합니다.' });
    }

    const now = new Date().toISOString();
    const exportDate = now.split('T')[0];
    const sql = `INSERT OR REPLACE INTO market_exports (id, productId, marketCode, exportDate, createdAt)
                 VALUES (?, ?, ?, ?, ?)`;
    let inserted = 0;
    const stmt = db.prepare(sql);

    productIds.forEach(pid => {
        const id = `ME-${pid}-${marketCode}`;
        stmt.run([id, pid, marketCode, exportDate, now], function(err) {
            if (!err) inserted++;
        });
    });

    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '마켓 전송 완료', insertedCount: inserted, marketCode, exportDate });
    });
});

// 마켓 전송 취소 (단일)
app.delete('/api/market-exports/:id', (req, res) => {
    db.run('DELETE FROM market_exports WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '전송 기록을 찾을 수 없습니다.' });
        res.json({ message: '전송 취소 성공' });
    });
});

// ==========================================
// Presets API (수수료 프리셋 — JSON blob)
// ==========================================

app.get('/api/presets', (req, res) => {
    db.all('SELECT * FROM presets ORDER BY updatedAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // JSON blob을 파싱하여 반환
        const parsed = rows.map(r => {
            try { return { ...JSON.parse(r.data), _dbId: r.id }; }
            catch { return null; }
        }).filter(Boolean);
        res.json(parsed);
    });
});

app.post('/api/presets', (req, res) => {
    const data = req.body;
    const id = data.id || ('PR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    data.id = id;
    db.run('INSERT INTO presets (id, data, updatedAt) VALUES (?, ?, ?)',
        [id, JSON.stringify(data), now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id });
    });
});

app.put('/api/presets/:id', (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const now = new Date().toISOString();
    data.id = id;
    db.run('UPDATE presets SET data = ?, updatedAt = ? WHERE id = ?',
        [JSON.stringify(data), now, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

app.delete('/api/presets/:id', (req, res) => {
    db.run('DELETE FROM presets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// ==========================================
// Promotion Presets API
// ==========================================

app.get('/api/promotion-presets', (req, res) => {
    db.all('SELECT * FROM promotion_presets ORDER BY updatedAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(r => {
            try { return { ...JSON.parse(r.data), _dbId: r.id }; }
            catch { return null; }
        }).filter(Boolean);
        res.json(parsed);
    });
});

app.post('/api/promotion-presets', (req, res) => {
    const data = req.body;
    const id = data.id || ('PP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    data.id = id;
    db.run('INSERT INTO promotion_presets (id, data, updatedAt) VALUES (?, ?, ?)',
        [id, JSON.stringify(data), now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id });
    });
});

app.put('/api/promotion-presets/:id', (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const now = new Date().toISOString();
    data.id = id;
    db.run('UPDATE promotion_presets SET data = ?, updatedAt = ? WHERE id = ?',
        [JSON.stringify(data), now, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

app.delete('/api/promotion-presets/:id', (req, res) => {
    db.run('DELETE FROM promotion_presets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// ==========================================
// Shipping Presets API
// ==========================================

app.get('/api/shipping-presets', (req, res) => {
    db.all('SELECT * FROM shipping_presets ORDER BY updatedAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(r => {
            try { return { ...JSON.parse(r.data), _dbId: r.id }; }
            catch { return null; }
        }).filter(Boolean);
        res.json(parsed);
    });
});

app.post('/api/shipping-presets', (req, res) => {
    const data = req.body;
    const id = data.id || ('SP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    data.id = id;
    db.run('INSERT INTO shipping_presets (id, data, updatedAt) VALUES (?, ?, ?)',
        [id, JSON.stringify(data), now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id });
    });
});

app.put('/api/shipping-presets/:id', (req, res) => {
    const id = req.params.id;
    const data = req.body;
    const now = new Date().toISOString();
    data.id = id;
    db.run('UPDATE shipping_presets SET data = ?, updatedAt = ? WHERE id = ?',
        [JSON.stringify(data), now, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

app.delete('/api/shipping-presets/:id', (req, res) => {
    db.run('DELETE FROM shipping_presets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '프리셋을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// ==========================================
// Market Analysis API
// ==========================================

// 전체 조회 (필터: ?market=sg)
app.get('/api/market-analysis', (req, res) => {
    const market = req.query.market;
    let sql = 'SELECT * FROM market_analysis';
    let params = [];
    if (market) {
        sql += ' WHERE market = ?';
        params.push(market);
    }
    sql += ' ORDER BY createdAt DESC';
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단일 조회
app.get('/api/market-analysis/:id', (req, res) => {
    db.get('SELECT * FROM market_analysis WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '분석 데이터를 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 이미지 임시 파일명 규칙에 맞게 변경하는 헬퍼 함수
function processMarketAnalysisMediaSync(d) {
    const market = (d.market || 'XX').toUpperCase();
    const storeName = (d.storeName || 'Unknown').replace(/[^a-zA-Z0-9가-힣_]/g, '');
    
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateFormatted = `${yy}${mm}${dd}`;

    let maxSeq = 0;
    try {
        const files = fs.readdirSync(UPLOAD_DIR);
        const regex = new RegExp(`-${dateFormatted}-(\\d{3})-[0-9V]+\\.[a-zA-Z0-9]+$`);
        files.forEach(f => {
            const match = f.match(regex);
            if (match) {
                const seq = parseInt(match[1], 10);
                if (seq > maxSeq) maxSeq = seq;
            }
        });
    } catch (e) {}

    let needsRename = false;
    if (d.imageUrl && d.imageUrl.includes('/api/images/MA-')) needsRename = true;
    if (d.imageUrls && Array.isArray(d.imageUrls)) {
        d.imageUrls.forEach(url => { if (url && url.includes('/api/images/MA-')) needsRename = true; });
    }
    if (d.videoUrl && d.videoUrl.includes('/api/images/MA-')) needsRename = true;

    if (!needsRename) return;

    const dailySeq = String(maxSeq + 1).padStart(3, '0');
    
    const renameFile = (url, suffix) => {
        if (!url || !url.includes('/api/images/MA-')) return url;
        try {
            const oldFilename = url.split('/api/images/').pop();
            const oldPath = path.join(UPLOAD_DIR, oldFilename);
            if (!fs.existsSync(oldPath)) return url;
            
            const ext = path.extname(oldFilename);
            const newFilename = `${market}-${storeName}-${dateFormatted}-${dailySeq}-${suffix}${ext}`;
            const newPath = path.join(UPLOAD_DIR, newFilename);
            
            fs.renameSync(oldPath, newPath);
            return url.replace(oldFilename, newFilename);
        } catch (e) {
            return url;
        }
    };

    if (d.imageUrl) d.imageUrl = renameFile(d.imageUrl, '01');
    if (d.imageUrls && Array.isArray(d.imageUrls)) {
        d.imageUrls = d.imageUrls.map((url, idx) => renameFile(url, String(idx + 1).padStart(2, '0')));
    }
    if (d.videoUrl) d.videoUrl = renameFile(d.videoUrl, 'V01');
}



// 등록
app.post('/api/market-analysis', (req, res) => {
    const d = req.body;
    processMarketAnalysisMediaSync(d);
    const id = d.id || ('MA-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const imageUrlsStr = Array.isArray(d.imageUrls) ? JSON.stringify(d.imageUrls) : '[]';
    const coupangRocket = d.coupangRocket ? 1 : 0;
    
    const sql = `INSERT INTO market_analysis
        (id, market, shopeeCategory, productName, storeName, listingPrice, actualPrice,
         weight, sellerShipping, monthlySales, coupangPrice, coupangShipping, coupangRocket,
         naverPrice, naverShipping, shopeeUrl, coupangUrl, naverUrl, imageUrl, imageUrls, videoUrl, note, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const params = [
        id, d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, coupangRocket,
        d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', imageUrlsStr, d.videoUrl||'', d.note||'', now, now
    ];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 수정
app.put('/api/market-analysis/:id', (req, res) => {
    const id = req.params.id;
    const d = req.body;
    processMarketAnalysisMediaSync(d);
    const now = new Date().toISOString();
    const imageUrlsStr = Array.isArray(d.imageUrls) ? JSON.stringify(d.imageUrls) : '[]';
    const coupangRocket = d.coupangRocket ? 1 : 0;
    
    const sql = `UPDATE market_analysis SET
        market=?, shopeeCategory=?, productName=?, storeName=?, listingPrice=?, actualPrice=?,
        weight=?, sellerShipping=?, monthlySales=?, coupangPrice=?, coupangShipping=?, coupangRocket=?,
        naverPrice=?, naverShipping=?, shopeeUrl=?, coupangUrl=?, naverUrl=?, imageUrl=?, imageUrls=?, videoUrl=?, note=?, updatedAt=?
        WHERE id=?`;
    const params = [
        d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, coupangRocket,
        d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', imageUrlsStr, d.videoUrl||'', d.note||'', now, id
    ];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '분석 데이터를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 삭제
app.delete('/api/market-analysis/:id', (req, res) => {
    db.run('DELETE FROM market_analysis WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '분석 데이터를 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// 이미지 업로드 (파일)
app.post('/api/market-analysis/upload-image', upload.single('image'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '이미지 파일이 필요합니다.' });
        const filename = req.file.filename;
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        const url = imgBase + '/api/images/' + filename;
        res.json({ message: '업로드 성공', filename, url, size: req.file.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 동영상 업로드
app.post('/api/market-analysis/upload-video', videoUpload.single('video'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '동영상 파일이 없습니다.' });
        const filename = req.file.filename;
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        const url = imgBase + '/api/images/' + filename;
        res.json({ message: '업로드 성공', filename, url, size: req.file.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 이미지 업로드 (URL 다운로드)
app.post('/api/market-analysis/upload-image-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL이 필요합니다.' });
        const ext = path.extname(new URL(url).pathname).toLowerCase() || '.jpg';
        const filename = 'MA-' + Date.now() + ext;
        const filePath = path.join(UPLOAD_DIR, filename);
        const protocol = url.startsWith('https') ? require('https') : require('http');
        await new Promise((resolve, reject) => {
            const request = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    const rProto = response.headers.location.startsWith('https') ? require('https') : require('http');
                    rProto.get(response.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
                        const ws = fs.createWriteStream(filePath); r2.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
                    }).on('error', reject);
                    return;
                }
                if (response.statusCode !== 200) { reject(new Error('HTTP ' + response.statusCode)); return; }
                const ws = fs.createWriteStream(filePath); response.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(15000, () => { request.destroy(); reject(new Error('타임아웃')); });
        });
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        res.json({ message: '다운로드 성공', filename, url: imgBase + '/api/images/' + filename, size: fs.statSync(filePath).size });
    } catch (err) {
        res.status(500).json({ error: 'URL 다운로드 실패: ' + err.message });
    }
});

// 이미지 삭제

app.post('/api/market-analysis/upload-video-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required.' });
        const ext = '.mp4';
        const filename = 'MA-' + Date.now() + ext;
        const filePath = path.join(UPLOAD_DIR, filename);
        const protocol = url.startsWith('https') ? require('https') : require('http');
        await new Promise((resolve, reject) => {
            const request = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    const rProto = response.headers.location.startsWith('https') ? require('https') : require('http');
                    rProto.get(response.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
                        const ws = require('fs').createWriteStream(filePath); r2.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
                    }).on('error', reject);
                    return;
                }
                if (response.statusCode !== 200) { reject(new Error('HTTP ' + response.statusCode)); return; }
                const ws = require('fs').createWriteStream(filePath); response.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(15000, () => { request.destroy(); reject(new Error('Timeout')); });
        });
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        res.json({ message: 'Success', filename, url: imgBase + '/api/images/' + filename, size: require('fs').statSync(filePath).size });
    } catch (err) {
        res.status(500).json({ error: 'Video URL download failed: ' + err.message });
    }
});

app.delete('/api/images/:filename', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ message: '삭제 성공' });
    } else {
        res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
});

// ==========================================
// Health Check
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'sell-it-api', timestamp: new Date().toISOString() });
});

// 404 핸들러
app.use((req, res) => {
    res.status(404).json({ error: 'API 엔드포인트를 찾을 수 없습니다.' });
});

// 서버 실행
app.listen(PORT, () => {
    console.log(`Sell_it API Server is running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/products`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
});
