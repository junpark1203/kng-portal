const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

let db;

// DB 주입
const setDb = (dbInstance) => {
    db = dbInstance;
};

// 업로드 디렉토리 설정
const getUploadDir = () => {
    const uploadBase = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
    const poUploadDir = path.join(uploadBase, 'purchase-orders');
    if (!fs.existsSync(poUploadDir)) {
        fs.mkdirSync(poUploadDir, { recursive: true });
    }
    return poUploadDir;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, getUploadDir());
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'po-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 테이블 초기화
const initPurchaseOrderTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        // 발주서 마스터 테이블
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS purchase_orders (
                id TEXT PRIMARY KEY,
                po_number TEXT UNIQUE NOT NULL,
                issue_date TEXT,
                references_text TEXT,
                validity_date TEXT,
                buyer_name TEXT,
                buyer_address TEXT,
                buyer_attn TEXT,
                buyer_tel TEXT,
                buyer_email TEXT,
                seller_name TEXT,
                seller_address TEXT,
                seller_attn TEXT,
                seller_tel TEXT,
                seller_email TEXT,
                payment_terms TEXT,
                loading_port TEXT,
                discharging_port TEXT,
                delivery_terms TEXT,
                country_of_origin TEXT,
                delivery_date TEXT,
                shipment_spec TEXT,
                currency TEXT DEFAULT 'USD',
                amount_in_words TEXT,
                total_amount REAL DEFAULT 0,
                total_qty REAL DEFAULT 0,
                total_pkg_qty TEXT,
                notes_instructions TEXT,
                drawing_image_url TEXT,
                include_seal INTEGER DEFAULT 1,
                status TEXT DEFAULT '작성중',
                created_at TEXT,
                updated_at TEXT
            )
        `, (err) => {
            if (err) {
                console.error('purchase_orders 테이블 생성 오류:', err.message);
                reject(err);
                return;
            }

            // 발주서 품목 상세 테이블
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS purchase_order_items (
                    id TEXT PRIMARY KEY,
                    po_id TEXT NOT NULL,
                    seq INTEGER DEFAULT 1,
                    product_name TEXT,
                    hs_code TEXT,
                    packaging_unit TEXT,
                    unit_price REAL DEFAULT 0,
                    order_qty REAL DEFAULT 0,
                    unit TEXT DEFAULT 'KG',
                    total_price REAL DEFAULT 0,
                    packaging_qty TEXT,
                    FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
                )
            `, (err2) => {
                if (err2) {
                    console.error('purchase_order_items 테이블 생성 오류:', err2.message);
                    reject(err2);
                    return;
                }

                // 발주서 설정 테이블 (직인, 서명, 기본 바이어 정보)
                dbInstance.run(`
                    CREATE TABLE IF NOT EXISTS purchase_order_settings (
                        key TEXT PRIMARY KEY,
                        value TEXT,
                        updated_at TEXT
                    )
                `, (err3) => {
                    if (err3) {
                        console.error('purchase_order_settings 테이블 생성 오류:', err3.message);
                        reject(err3);
                        return;
                    }
                    console.log('purchase_order 관련 테이블 확인 완료');
                    resolve();
                });
            });
        });
    });
};

// -------------------------------------------------------------
// REST API 엔드포인트
// -------------------------------------------------------------

// 1. 발주서 목록 조회
router.get('/', (req, res) => {
    const { keyword, status, startDate, endDate } = req.query;
    let query = `
        SELECT p.*, 
            (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = p.id) as item_count,
            (SELECT product_name FROM purchase_order_items WHERE po_id = p.id ORDER BY seq ASC LIMIT 1) as first_item_name
        FROM purchase_orders p
        WHERE 1=1
    `;
    const params = [];

    if (keyword) {
        query += ` AND (p.po_number LIKE ? OR p.seller_name LIKE ? OR p.buyer_name LIKE ? OR p.references_text LIKE ?)`;
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw, kw);
    }
    if (status && status !== '전체') {
        query += ` AND p.status = ?`;
        params.push(status);
    }
    if (startDate) {
        query += ` AND p.issue_date >= ?`;
        params.push(startDate);
    }
    if (endDate) {
        query += ` AND p.issue_date <= ?`;
        params.push(endDate);
    }

    query += ` ORDER BY p.issue_date DESC, p.created_at DESC`;

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows || []);
    });
});

// 2. 발주서 단건 상세 조회 (품목 포함)
router.get('/:id', (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM purchase_orders WHERE id = ? OR po_number = ?`, [id, id], (err, po) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!po) {
            return res.status(404).json({ error: '발주서를 찾을 수 없습니다.' });
        }

        db.all(`SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY seq ASC`, [po.id], (err2, items) => {
            if (err2) {
                return res.status(500).json({ error: err2.message });
            }
            po.items = items || [];
            res.json(po);
        });
    });
});

// 3. 발주서 신규 등록
router.post('/', (req, res) => {
    const {
        po_number,
        issue_date,
        references_text,
        validity_date,
        buyer_name,
        buyer_address,
        buyer_attn,
        buyer_tel,
        buyer_email,
        seller_name,
        seller_address,
        seller_attn,
        seller_tel,
        seller_email,
        payment_terms,
        loading_port,
        discharging_port,
        delivery_terms,
        country_of_origin,
        delivery_date,
        shipment_spec,
        currency,
        amount_in_words,
        total_amount,
        total_qty,
        total_pkg_qty,
        notes_instructions,
        drawing_image_url,
        include_seal,
        status,
        items
    } = req.body;

    if (!po_number || !po_number.trim()) {
        return res.status(400).json({ error: '발주서 번호(PO Number)는 필수 입력 사항입니다.' });
    }

    const poId = 'po_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const now = new Date().toISOString();

    const insertPoQuery = `
        INSERT INTO purchase_orders (
            id, po_number, issue_date, references_text, validity_date,
            buyer_name, buyer_address, buyer_attn, buyer_tel, buyer_email,
            seller_name, seller_address, seller_attn, seller_tel, seller_email,
            payment_terms, loading_port, discharging_port, delivery_terms,
            country_of_origin, delivery_date, shipment_spec, currency, amount_in_words,
            total_amount, total_qty, total_pkg_qty, notes_instructions, drawing_image_url,
            include_seal, status, created_at, updated_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?
        )
    `;

    const poParams = [
        poId,
        po_number.trim(),
        issue_date || '',
        references_text || '',
        validity_date || '',
        buyer_name || '',
        buyer_address || '',
        buyer_attn || '',
        buyer_tel || '',
        buyer_email || '',
        seller_name || '',
        seller_address || '',
        seller_attn || '',
        seller_tel || '',
        seller_email || '',
        payment_terms || '',
        loading_port || '',
        discharging_port || '',
        delivery_terms || '',
        country_of_origin || '',
        delivery_date || '',
        shipment_spec || '',
        currency || 'USD',
        amount_in_words || '',
        Number(total_amount) || 0,
        Number(total_qty) || 0,
        total_pkg_qty || '',
        notes_instructions || '',
        drawing_image_url || '',
        include_seal !== undefined ? Number(include_seal) : 1,
        status || '작성중',
        now,
        now
    ];

    db.run(insertPoQuery, poParams, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: '이미 사용 중인 발주서 번호(PO Number)입니다.' });
            }
            return res.status(500).json({ error: err.message });
        }

        // 품목 일괄 등록
        if (Array.isArray(items) && items.length > 0) {
            const stmt = db.prepare(`
                INSERT INTO purchase_order_items (
                    id, po_id, seq, product_name, hs_code, packaging_unit,
                    unit_price, order_qty, unit, total_price, packaging_qty
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            items.forEach((item, idx) => {
                const itemId = 'poi_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 5);
                stmt.run(
                    itemId,
                    poId,
                    idx + 1,
                    item.product_name || '',
                    item.hs_code || '',
                    item.packaging_unit || '',
                    Number(item.unit_price) || 0,
                    Number(item.order_qty) || 0,
                    item.unit || 'KG',
                    Number(item.total_price) || 0,
                    item.packaging_qty || ''
                );
            });

            stmt.finalize((err2) => {
                if (err2) console.error('품목 저장 중 오류:', err2.message);
                res.status(201).json({ id: poId, message: '발주서가 성공적으로 등록되었습니다.' });
            });
        } else {
            res.status(201).json({ id: poId, message: '발주서가 성공적으로 등록되었습니다.' });
        }
    });
});

// 4. 발주서 수정
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const {
        po_number,
        issue_date,
        references_text,
        validity_date,
        buyer_name,
        buyer_address,
        buyer_attn,
        buyer_tel,
        buyer_email,
        seller_name,
        seller_address,
        seller_attn,
        seller_tel,
        seller_email,
        payment_terms,
        loading_port,
        discharging_port,
        delivery_terms,
        country_of_origin,
        delivery_date,
        shipment_spec,
        currency,
        amount_in_words,
        total_amount,
        total_qty,
        total_pkg_qty,
        notes_instructions,
        drawing_image_url,
        include_seal,
        status,
        items
    } = req.body;

    const now = new Date().toISOString();

    const updateQuery = `
        UPDATE purchase_orders SET
            po_number = ?, issue_date = ?, references_text = ?, validity_date = ?,
            buyer_name = ?, buyer_address = ?, buyer_attn = ?, buyer_tel = ?, buyer_email = ?,
            seller_name = ?, seller_address = ?, seller_attn = ?, seller_tel = ?, seller_email = ?,
            payment_terms = ?, loading_port = ?, discharging_port = ?, delivery_terms = ?,
            country_of_origin = ?, delivery_date = ?, shipment_spec = ?, currency = ?, amount_in_words = ?,
            total_amount = ?, total_qty = ?, total_pkg_qty = ?, notes_instructions = ?, drawing_image_url = ?,
            include_seal = ?, status = ?, updated_at = ?
        WHERE id = ?
    `;

    const params = [
        po_number ? po_number.trim() : '',
        issue_date || '',
        references_text || '',
        validity_date || '',
        buyer_name || '',
        buyer_address || '',
        buyer_attn || '',
        buyer_tel || '',
        buyer_email || '',
        seller_name || '',
        seller_address || '',
        seller_attn || '',
        seller_tel || '',
        seller_email || '',
        payment_terms || '',
        loading_port || '',
        discharging_port || '',
        delivery_terms || '',
        country_of_origin || '',
        delivery_date || '',
        shipment_spec || '',
        currency || 'USD',
        amount_in_words || '',
        Number(total_amount) || 0,
        Number(total_qty) || 0,
        total_pkg_qty || '',
        notes_instructions || '',
        drawing_image_url || '',
        include_seal !== undefined ? Number(include_seal) : 1,
        status || '작성중',
        now,
        id
    ];

    db.run(updateQuery, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: '이미 사용 중인 발주서 번호(PO Number)입니다.' });
            }
            return res.status(500).json({ error: err.message });
        }

        // 기존 품목 삭제 후 재등록
        db.run(`DELETE FROM purchase_order_items WHERE po_id = ?`, [id], (err2) => {
            if (err2) console.error('기존 품목 삭제 실패:', err2.message);

            if (Array.isArray(items) && items.length > 0) {
                const stmt = db.prepare(`
                    INSERT INTO purchase_order_items (
                        id, po_id, seq, product_name, hs_code, packaging_unit,
                        unit_price, order_qty, unit, total_price, packaging_qty
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                items.forEach((item, idx) => {
                    const itemId = 'poi_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 5);
                    stmt.run(
                        itemId,
                        id,
                        idx + 1,
                        item.product_name || '',
                        item.hs_code || '',
                        item.packaging_unit || '',
                        Number(item.unit_price) || 0,
                        Number(item.order_qty) || 0,
                        item.unit || 'KG',
                        Number(item.total_price) || 0,
                        item.packaging_qty || ''
                    );
                });

                stmt.finalize((err3) => {
                    if (err3) console.error('품목 재등록 중 오류:', err3.message);
                    res.json({ message: '발주서가 성공적으로 수정되었습니다.' });
                });
            } else {
                res.json({ message: '발주서가 성공적으로 수정되었습니다.' });
            }
        });
    });
});

// 5. 발주서 삭제
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM purchase_orders WHERE id = ?`, [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        db.run(`DELETE FROM purchase_order_items WHERE po_id = ?`, [id], () => {});
        res.json({ message: '발주서가 성공적으로 삭제되었습니다.' });
    });
});

// 6. 도면/직인/사인 파일 업로드
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '업로드할 파일이 없습니다.' });
    }
    const fileUrl = `/api/purchase-orders/uploads/${req.file.filename}`;
    res.json({
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
    });
});

// 7. 발주서 설정 조회 (직인, 서명, 기본 바이어 정보)
router.get('/config/settings', (req, res) => {
    db.all(`SELECT * FROM purchase_order_settings`, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        const settings = {};
        (rows || []).forEach(r => {
            try {
                settings[r.key] = JSON.parse(r.value);
            } catch (e) {
                settings[r.key] = r.value;
            }
        });
        res.json(settings);
    });
});

// 8. 발주서 설정 저장
router.post('/config/settings', (req, res) => {
    const settings = req.body;
    const now = new Date().toISOString();
    const stmt = db.prepare(`
        INSERT INTO purchase_order_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    Object.keys(settings).forEach(key => {
        const valStr = typeof settings[key] === 'object' ? JSON.stringify(settings[key]) : String(settings[key]);
        stmt.run(key, valStr, now);
    });

    stmt.finalize((err) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: '설정이 성공적으로 저장되었습니다.' });
    });
});

module.exports = {
    router,
    initPurchaseOrderTables,
    setDb
};
