const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
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
