const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Mass Upload 모듈
const massUploadRoutes = require('./routes/mass-upload');
const { initMassUploadTables } = require('./db-mass-upload');

const app = express();
const PORT = process.env.PORT || 3000;

// 보안 헤더
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS 설정 — Cloudflare Pages 도메인 허용
const allowedOrigins = [
    'https://kng-inventory.pages.dev',
    /\.kng-inventory\.pages\.dev$/,   // preview 배포 (*.kng-inventory.pages.dev)
    // KNG 통합 포털
    'https://kng-portal.pages.dev',
    /\.kng-portal\.pages\.dev$/,      // preview 배포 (*.kng-portal.pages.dev)
    // Mass Upload 프론트엔드
    'https://seller-k-mass-upload.pages.dev',
    /\.seller-k-mass-upload\.pages\.dev$/,  // preview 배포
    /kng-mass-upload\.pages\.dev$/,
    /\.kng-mass-upload\.pages\.dev$/,
    'http://localhost:8788',            // 로컬 개발용
    'http://localhost:3000',
    'http://localhost:8090',            // mass_upload dev-server
    'http://127.0.0.1:8788',
    'http://127.0.0.1:8090'
];
app.use(cors({
    origin: function(origin, callback) {
        // API 직접 호출(origin 없음) 또는 허용 목록 체크
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

// API 접속 횟수 제한 (IP당 15분에 100회)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }
});
app.use('/api/', apiLimiter);

// 데이터 디렉터리 확인 및 생성
// NAS에서 볼륨으로 마운트될 디렉터리입니다.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

// SQLite DB 연결 설정
const dbFile = path.join(dataDir, 'kng.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) {
        console.error('DB 연결 오류:', err.message);
    } else {
        console.log('SQLite 데이터베이스 연결 완료:', dbFile);
        initDb();
        // Mass Upload 테이블 초기화 + 라우트에 DB 주입
        initMassUploadTables(db).then(() => {
            massUploadRoutes.setDb(db);
            console.log('mass_upload API 준비 완료');
        });
    }
});

// 테이블 생성 (앱 최초 실행 시)
function initDb() {
    db.run(`
        CREATE TABLE IF NOT EXISTS seller_k_products (
            id TEXT PRIMARY KEY,
            supplier TEXT,
            brand TEXT,
            name TEXT,
            color TEXT,
            size TEXT,
            uploadDate TEXT,
            buyPrice INTEGER DEFAULT 0,
            buyShipping INTEGER DEFAULT 0,
            shippingBasis TEXT,
            shippingQty INTEGER DEFAULT 1,
            sellPrice INTEGER DEFAULT 0,
            sellShipping INTEGER DEFAULT 0,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('테이블 생성 오류:', err.message);
        else console.log('seller_k_products 테이블 확인 완료');
    });

    // 유류소모품 단가 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS unit_prices (
            id TEXT PRIMARY KEY,
            co TEXT,
            mfr TEXT,
            item TEXT,
            spec TEXT,
            price TEXT,
            history TEXT,
            note TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('unit_prices 테이블 생성 오류:', err.message);
        else console.log('unit_prices 테이블 확인 완료');
    });
}

// ----------------------------------------------------
// API 엔드포인트
// ----------------------------------------------------

// 1. 전체 목록 조회
app.get('/api/seller-k/products', (req, res) => {
    db.all('SELECT * FROM seller_k_products ORDER BY uploadDate DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. 단일 매입상품 등록
app.post('/api/seller-k/products', (req, res) => {
    const p = req.body;
    const sql = `
        INSERT INTO seller_k_products (
            id, supplier, brand, name, color, size, uploadDate, 
            buyPrice, buyShipping, shippingBasis, shippingQty, sellPrice, sellShipping, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        p.id, p.supplier || '', p.brand || '', p.name || '', p.color || '', p.size || '', p.uploadDate || '',
        p.buyPrice || 0, p.buyShipping || 0, p.shippingBasis || '수량별', p.shippingQty || 1, 
        p.sellPrice || 0, p.sellShipping || 0, p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString()
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: p.id });
    });
});

// 3. 단일 매입상품 수정
app.put('/api/seller-k/products/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const sql = `
        UPDATE seller_k_products SET
            supplier = ?, brand = ?, name = ?, color = ?, size = ?, uploadDate = ?,
            buyPrice = ?, buyShipping = ?, shippingBasis = ?, shippingQty = ?, 
            sellPrice = ?, sellShipping = ?, updatedAt = ?
        WHERE id = ?
    `;
    const params = [
        p.supplier || '', p.brand || '', p.name || '', p.color || '', p.size || '', p.uploadDate || '',
        p.buyPrice || 0, p.buyShipping || 0, p.shippingBasis || '수량별', p.shippingQty || 1, 
        p.sellPrice || 0, p.sellShipping || 0, new Date().toISOString(), id
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '상품을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 4. 상품 다중 삭제
app.post('/api/seller-k/products/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM seller_k_products WHERE id IN (${placeholders})`;
    
    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// ==========================================
// 유류소모품 단가 API
// ==========================================

// 전체 목록 조회
app.get('/api/unit-prices', (req, res) => {
    db.all('SELECT * FROM unit_prices ORDER BY co, mfr, item', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단가 등록
app.post('/api/unit-prices', (req, res) => {
    const p = req.body;
    const id = p.id || ('UP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO unit_prices (id, co, mfr, item, spec, price, history, note, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.co||'', p.mfr||'', p.item||'', p.spec||'', p.price||'', p.history||'', p.note||'', now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 단가 수정 (이력 자동 추가)
app.put('/api/unit-prices/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    // 먼저 기존 데이터 조회 → 가격 변경 시 이력 자동 추가
    db.get('SELECT * FROM unit_prices WHERE id = ?', [id], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });

        let history = p.history || existing.history || '';
        // 가격이 변경되었으면 이력에 자동 추가
        if (existing.price !== p.price && p.price) {
            const dateStr = now.split('T')[0];
            const newEntry = dateStr + ': ' + p.price;
            history = newEntry + (history ? '\n' + history : '');
        }

        const sql = `UPDATE unit_prices SET co=?, mfr=?, item=?, spec=?, price=?, history=?, note=?, updatedAt=? WHERE id=?`;
        const params = [p.co||'', p.mfr||'', p.item||'', p.spec||'', p.price||'', history, p.note||'', now, id];
        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
            res.json({ message: '수정 성공' });
        });
    });
});

// 단가 삭제
app.delete('/api/unit-prices/:id', (req, res) => {
    db.run('DELETE FROM unit_prices WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// 일괄 등록 (마이그레이션용)
app.post('/api/unit-prices/bulk', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: '배열이 필요합니다.' });
    const now = new Date().toISOString();
    const sql = `INSERT OR IGNORE INTO unit_prices (id, co, mfr, item, spec, price, history, note, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let inserted = 0;
    const stmt = db.prepare(sql);
    items.forEach((p, i) => {
        const id = p.id || ('UP-MIG-' + String(i).padStart(3, '0'));
        stmt.run([id, p.co||'', p.mfr||'', p.item||'', p.spec||'', p.price||'', p.history||'', p.note||'', now, now], function(err) {
            if (!err && this.changes > 0) inserted++;
        });
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '일괄 등록 완료', insertedCount: inserted, totalCount: items.length });
    });
});

// 다중 삭제
app.post('/api/unit-prices/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM unit_prices WHERE id IN (${placeholders})`, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// ==========================================
// Mass Upload API 라우트 마운트
// ==========================================
app.use('/api/mass-upload', massUploadRoutes);

// ==========================================
// API 상태 확인 엔드포인트
// ==========================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 알 수 없는 경로 → 404
app.use((req, res) => {
    res.status(404).json({ error: 'API 엔드포인트를 찾을 수 없습니다.' });
});

// 서버 실행
app.listen(PORT, () => {
    console.log(`K&G API Server is running on port ${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/seller-k/products`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
});
