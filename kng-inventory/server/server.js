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
// 보안 헤더 및 프록시 설정 (Cloudflare Tunnel 대응)
app.set('trust proxy', 1);
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
    'https://kng-portal.junparks.com', // Cloudflare Tunnel 커스텀 도메인
    // Mass Upload 프론트엔드
    'https://seller-k-mass-upload.pages.dev',
    /\.seller-k-mass-upload\.pages\.dev$/,  // preview 배포
    /kng-mass-upload\.pages\.dev$/,
    /\.kng-mass-upload\.pages\.dev$/,
    // API 서버 자체 (같은 도메인에서의 요청)
    'https://kng.junparks.com',
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
    max: 5000, // 넉넉하게 늘려서 정상 사용 차단 방지
    message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
    keyGenerator: function(req) {
        // Cloudflare를 거쳐 올 경우 실제 접속자 IP를 식별
        return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.ip;
    }
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

    // 유류소모품 단가 테이블 (레거시 - 마이그레이션 소스용 유지)
    db.run(`
        CREATE TABLE IF NOT EXISTS unit_prices (
            id TEXT PRIMARY KEY,
            co TEXT, mfr TEXT, item TEXT, spec TEXT,
            price TEXT, sellPrice TEXT, history TEXT, note TEXT,
            createdAt TEXT, updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('unit_prices 테이블 생성 오류:', err.message);
        else {
            console.log('unit_prices (legacy) 테이블 확인 완료');
            db.run('ALTER TABLE unit_prices ADD COLUMN sellPrice TEXT', () => {});
        }
    });

    // 유류소모품 단가 테이블 V2 (신규 스키마)
    db.run(`
        CREATE TABLE IF NOT EXISTS unit_prices_v2 (
            id TEXT PRIMARY KEY,
            itemName TEXT,
            spec TEXT,
            category TEXT,
            manufacturer TEXT,
            supplier TEXT,
            currency TEXT DEFAULT 'KRW',
            buyPrice INTEGER DEFAULT 0,
            logistics INTEGER DEFAULT 0,
            landedCost INTEGER DEFAULT 0,
            sellPrice INTEGER DEFAULT 0,
            prevBuyPrice INTEGER DEFAULT 0,
            prevSellPrice INTEGER DEFAULT 0,
            history TEXT,
            note TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('unit_prices_v2 테이블 생성 오류:', err.message);
        else console.log('unit_prices_v2 테이블 확인 완료');
    });

    // 자재 공급 내역 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS supply_history (
            id TEXT PRIMARY KEY,
            supplyDate TEXT,
            site TEXT,
            item TEXT,
            qty INTEGER,
            price INTEGER,
            total INTEGER,
            category TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('supply_history 테이블 생성 오류:', err.message);
        else console.log('supply_history 테이블 확인 완료');
    });

    // 유류 자재 공급 내역 테이블
    db.run(`
        CREATE TABLE IF NOT EXISTS oil_supply_history (
            id TEXT PRIMARY KEY,
            date TEXT,
            site TEXT,
            supplier TEXT,
            manufacturer TEXT,
            category TEXT,
            item TEXT,
            spec TEXT,
            totalQty TEXT,
            qty INTEGER,
            price INTEGER,
            total INTEGER,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error('oil_supply_history 테이블 생성 오류:', err.message);
        else console.log('oil_supply_history 테이블 확인 완료');
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

// 5. 상품 대량 등록 (엑셀 업로드 및 일괄등록 연동용)
app.post('/api/seller-k/products/bulk', (req, res) => {
    const { products } = req.body;
    if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: '등록할 상품 배열이 필요합니다.' });
    }
    
    const now = new Date().toISOString();
    const sql = `
        INSERT OR IGNORE INTO seller_k_products (
            id, supplier, brand, name, color, size, uploadDate, 
            buyPrice, buyShipping, shippingBasis, shippingQty, sellPrice, sellShipping, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    let inserted = 0;
    const stmt = db.prepare(sql);
    
    products.forEach((p, i) => {
        const id = p.id || ('SK-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6) + i);
        stmt.run([
            id, p.supplier || '', p.brand || '', p.name || '', p.color || '', p.size || '', p.uploadDate || '',
            p.buyPrice || 0, p.buyShipping || 0, p.shippingBasis || '수량별', p.shippingQty || 1, 
            p.sellPrice || 0, p.sellShipping || 0, now, now
        ], function(err) {
            if (!err && this.changes > 0) inserted++;
        });
    });
    
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '대량 등록 성공', insertedCount: inserted });
    });
});

// ==========================================
// 유류소모품 단가 API (V2)
// ==========================================

// 전체 목록 조회
app.get('/api/unit-prices', (req, res) => {
    db.all('SELECT * FROM unit_prices_v2 ORDER BY supplier, manufacturer, itemName', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단가 등록
app.post('/api/unit-prices', (req, res) => {
    const p = req.body;
    const id = p.id || ('UP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const landedCost = (p.buyPrice || 0) + (p.logistics || 0);
    const sql = `INSERT INTO unit_prices_v2 (id, itemName, spec, category, manufacturer, supplier, currency, buyPrice, logistics, landedCost, sellPrice, prevBuyPrice, prevSellPrice, history, note, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.itemName||'', p.spec||'', p.category||'', p.manufacturer||'', p.supplier||'', p.currency||'KRW', p.buyPrice||0, p.logistics||0, landedCost, p.sellPrice||0, 0, 0, p.history||'', p.note||'', now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 단가 수정 (이력 자동 추가 + 이전 단가 보존)
app.put('/api/unit-prices/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    db.get('SELECT * FROM unit_prices_v2 WHERE id = ?', [id], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });

        const newBuyPrice = p.buyPrice || 0;
        const newSellPrice = p.sellPrice || 0;
        const newLogistics = p.logistics || 0;
        const newLandedCost = newBuyPrice + newLogistics;
        let history = existing.history || '';
        let prevBuy = existing.prevBuyPrice || 0;
        let prevSell = existing.prevSellPrice || 0;

        // 가격 변경 시 이력 자동 추가
        if (existing.buyPrice !== newBuyPrice || existing.sellPrice !== newSellPrice) {
            const dateStr = now.split('T')[0];
            const cur = p.currency || existing.currency || 'KRW';
            const sym = cur === 'KRW' ? '₩' : cur === 'USD' ? '$' : cur === 'JPY' ? '¥' : cur + ' ';
            const entry = dateStr + ': 매입 ' + sym + newBuyPrice.toLocaleString() + ' / 매출 ' + sym + newSellPrice.toLocaleString();
            history = entry + (history ? '\n' + history : '');
            prevBuy = existing.buyPrice;
            prevSell = existing.sellPrice;
        }

        const sql = `UPDATE unit_prices_v2 SET itemName=?, spec=?, category=?, manufacturer=?, supplier=?, currency=?, buyPrice=?, logistics=?, landedCost=?, sellPrice=?, prevBuyPrice=?, prevSellPrice=?, history=?, note=?, updatedAt=? WHERE id=?`;
        const params = [p.itemName||'', p.spec||'', p.category||'', p.manufacturer||'', p.supplier||'', p.currency||'KRW', newBuyPrice, newLogistics, newLandedCost, newSellPrice, prevBuy, prevSell, history, p.note||'', now, id];
        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
            res.json({ message: '수정 성공' });
        });
    });
});

// 단가 삭제
app.delete('/api/unit-prices/:id', (req, res) => {
    db.run('DELETE FROM unit_prices_v2 WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// 일괄 등록
app.post('/api/unit-prices/bulk', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: '배열이 필요합니다.' });
    const now = new Date().toISOString();
    const sql = `INSERT OR IGNORE INTO unit_prices_v2 (id, itemName, spec, category, manufacturer, supplier, currency, buyPrice, logistics, landedCost, sellPrice, prevBuyPrice, prevSellPrice, history, note, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let inserted = 0;
    const stmt = db.prepare(sql);
    items.forEach((p, i) => {
        const id = p.id || ('UP-' + Date.now() + '-' + i);
        const lc = (p.buyPrice||0) + (p.logistics||0);
        stmt.run([id, p.itemName||'', p.spec||'', p.category||'', p.manufacturer||'', p.supplier||'', p.currency||'KRW', p.buyPrice||0, p.logistics||0, lc, p.sellPrice||0, 0, 0, p.history||'', p.note||'', now, now], function(err) {
            if (!err && this.changes > 0) inserted++;
        });
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '일괄 등록 완료', insertedCount: inserted, totalCount: items.length });
    });
});

// V1 → V2 마이그레이션 (기존 unit_prices → unit_prices_v2)
app.post('/api/unit-prices/migrate-v2', (req, res) => {
    db.all('SELECT * FROM unit_prices', [], (err, oldRows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!oldRows || oldRows.length === 0) return res.json({ message: '마이그레이션할 데이터 없음', count: 0 });

        const now = new Date().toISOString();
        const sql = `INSERT OR IGNORE INTO unit_prices_v2 (id, itemName, spec, category, manufacturer, supplier, currency, buyPrice, logistics, landedCost, sellPrice, prevBuyPrice, prevSellPrice, history, note, createdAt, updatedAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        let migrated = 0;
        const stmt = db.prepare(sql);

        oldRows.forEach(old => {
            // TEXT 가격 → INTEGER 변환
            const parsePriceText = (txt) => {
                if (!txt || txt === '-') return 0;
                return parseInt(String(txt).replace(/[^0-9]/g, '')) || 0;
            };
            // 비고에서 카테고리 추출
            const noteText = old.note || '';
            let category = '';
            if (noteText.includes('유압유')) category = '유압유';
            else if (noteText.includes('기어유')) category = '기어유';
            else if (noteText.includes('그리스') || noteText.includes('Grease')) category = '그리스';
            else if (noteText.includes('테일씰')) category = '테일씰그리스';

            const buyPrice = parsePriceText(old.price);
            const sellPrice = parsePriceText(old.sellPrice);

            stmt.run([
                old.id,
                old.item || '',      // item → itemName
                old.spec || '',
                category,
                old.mfr || '',       // mfr → manufacturer
                old.co || '',        // co → supplier
                'KRW',
                buyPrice,
                0,                   // logistics
                buyPrice,            // landedCost = buyPrice (부대비용 없음)
                sellPrice,
                0, 0,                // prevBuyPrice, prevSellPrice
                old.history || '',
                old.note || '',
                old.createdAt || now,
                old.updatedAt || now
            ], function(err) {
                if (!err && this.changes > 0) migrated++;
            });
        });

        stmt.finalize((err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'V1→V2 마이그레이션 완료', migrated: migrated, total: oldRows.length });
        });
    });
});

// ==========================================
// 4. 자재 공급 내역 API (/api/supply-history)
// ==========================================
// 목록 조회
app.get('/api/supply-history', (req, res) => {
    db.all('SELECT * FROM supply_history ORDER BY supplyDate DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 신규 등록
app.post('/api/supply-history', (req, res) => {
    const p = req.body;
    const id = p.id || ('SH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO supply_history (id, supplyDate, site, item, qty, price, total, category, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.supplyDate||'', p.site||'', p.item||'', p.qty||0, p.price||0, p.total||0, p.category||'미분류', now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 단일 수정
app.put('/api/supply-history/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE supply_history SET supplyDate=?, site=?, item=?, qty=?, price=?, total=?, category=?, updatedAt=? WHERE id=?`;
    const params = [p.supplyDate||'', p.site||'', p.item||'', p.qty||0, p.price||0, p.total||0, p.category||'미분류', now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 다중 선택 삭제
app.post('/api/supply-history/delete', (req, res) => {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '삭제할 ID 목록이 필요합니다.' });
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM supply_history WHERE id IN (${placeholders})`;
    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// 일괄 카테고리 수정
app.post('/api/supply-history/update-category', (req, res) => {
    const { ids, category } = req.body;
    if (!Array.isArray(ids) || ids.length === 0 || !category) return res.status(400).json({ error: '데이터가 올바르지 않습니다.' });
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    const sql = `UPDATE supply_history SET category=?, updatedAt=? WHERE id IN (${placeholders})`;
    db.run(sql, [category, now, ...ids], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '수정 완료', updatedCount: this.changes });
    });
});

// 일괄 등록 (마이그레이션용)
app.post('/api/supply-history/bulk', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: '배열이 필요합니다.' });
    const now = new Date().toISOString();
    const sql = `INSERT OR IGNORE INTO supply_history (id, supplyDate, site, item, qty, price, total, category, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let inserted = 0;
    const stmt = db.prepare(sql);
    items.forEach((p, i) => {
        const id = p.id || ('SH-MIG-' + String(i).padStart(4, '0'));
        stmt.run([id, p.supplyDate||'', p.site||'', p.item||'', p.qty||0, p.price||0, p.total||0, p.category||'미분류', now, now], function(err) {
            if (!err && this.changes > 0) inserted++;
        });
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '일괄 등록 완료', insertedCount: inserted, totalCount: items.length });
    });
});

// ==========================================
// 5. 유류 자재 공급 내역 API (/api/oil-supply-history)
// ==========================================
// 목록 조회
app.get('/api/oil-supply-history', (req, res) => {
    db.all('SELECT * FROM oil_supply_history ORDER BY date DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 신규 등록
app.post('/api/oil-supply-history', (req, res) => {
    const p = req.body;
    const id = p.id || ('OSH-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO oil_supply_history (id, date, site, supplier, manufacturer, category, item, spec, totalQty, qty, price, total, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.date||'', p.site||'', p.supplier||'', p.manufacturer||'', p.category||'', p.item||'', p.spec||'', p.totalQty||'', p.qty||0, p.price||0, p.total||0, now, now];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 단일 수정
app.put('/api/oil-supply-history/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `UPDATE oil_supply_history SET date=?, site=?, supplier=?, manufacturer=?, category=?, item=?, spec=?, totalQty=?, qty=?, price=?, total=?, updatedAt=? WHERE id=?`;
    const params = [p.date||'', p.site||'', p.supplier||'', p.manufacturer||'', p.category||'', p.item||'', p.spec||'', p.totalQty||'', p.qty||0, p.price||0, p.total||0, now, id];
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 다중 선택 삭제
app.post('/api/oil-supply-history/delete', (req, res) => {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '삭제할 ID 목록이 필요합니다.' });
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM oil_supply_history WHERE id IN (${placeholders})`;
    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// 일괄 등록 (마이그레이션 및 엑셀 업로드용)
app.post('/api/oil-supply-history/bulk', (req, res) => {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: '배열이 필요합니다.' });
    const now = new Date().toISOString();
    const sql = `INSERT OR IGNORE INTO oil_supply_history (id, date, site, supplier, manufacturer, category, item, spec, totalQty, qty, price, total, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let inserted = 0;
    const stmt = db.prepare(sql);
    items.forEach((p, i) => {
        const id = p.id || ('OSH-MIG-' + String(i).padStart(4, '0'));
        stmt.run([id, p.date||'', p.site||'', p.supplier||'', p.manufacturer||'', p.category||'', p.item||'', p.spec||'', p.totalQty||'', p.qty||0, p.price||0, p.total||0, now, now], function(err) {
            if (!err && this.changes > 0) inserted++;
        });
    });
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '일괄 등록 완료', insertedCount: inserted, totalCount: items.length });
    });
});

// 다중 삭제 (단가표 V2)
app.post('/api/unit-prices/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    db.run(`DELETE FROM unit_prices_v2 WHERE id IN (${placeholders})`, ids, function(err) {
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
