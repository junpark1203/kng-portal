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
    const quoteUploadDir = path.join(uploadBase, 'quotations');
    if (!fs.existsSync(quoteUploadDir)) {
        fs.mkdirSync(quoteUploadDir, { recursive: true });
    }
    return quoteUploadDir;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, getUploadDir());
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, 'item-' + uniqueSuffix + ext);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 테이블 초기화
const initQuotationTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        // 1. 견적서 마스터 테이블
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS quotations (
                id TEXT PRIMARY KEY,
                quote_number TEXT UNIQUE NOT NULL,
                issue_date TEXT,
                valid_until TEXT,
                customer_name TEXT,
                customer_attn TEXT,
                customer_tel TEXT,
                customer_email TEXT,
                project_name TEXT,
                delivery_date TEXT,
                delivery_place TEXT,
                payment_terms TEXT,
                supplier_name TEXT DEFAULT '주식회사 케이엔지',
                supplier_biz_num TEXT DEFAULT '687-87-03314',
                supplier_ceo TEXT DEFAULT '박 준',
                supplier_address TEXT DEFAULT '경기도 김포시 통진읍 율마로 402-14',
                supplier_tel TEXT DEFAULT '031-987-1203',
                supplier_email TEXT DEFAULT 'contact@junparks.com',
                supplier_bank TEXT DEFAULT '기업은행 123-456789-01-012 (예금주: 주식회사 케이엔지)',
                include_seal INTEGER DEFAULT 1,
                show_images INTEGER DEFAULT 1,
                vat_type TEXT DEFAULT 'inclusive',
                total_supply_price REAL DEFAULT 0,
                total_vat REAL DEFAULT 0,
                total_amount REAL DEFAULT 0,
                notes_instructions TEXT,
                status TEXT DEFAULT '작성중',
                created_at TEXT,
                updated_at TEXT,
                author TEXT
            )
        `, (err) => {
            if (err) {
                console.error('quotations 테이블 생성 오류:', err.message);
                reject(err);
                return;
            }

            // 2. 견적서 품목 상세 테이블 (사진 image_url 포함)
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS quotation_items (
                    id TEXT PRIMARY KEY,
                    quote_id TEXT NOT NULL,
                    seq INTEGER DEFAULT 1,
                    source_module TEXT,
                    source_id TEXT,
                    product_name TEXT,
                    spec TEXT,
                    color TEXT,
                    unit TEXT DEFAULT 'EA',
                    qty REAL DEFAULT 1,
                    cost_price REAL DEFAULT 0,
                    unit_price REAL DEFAULT 0,
                    supply_price REAL DEFAULT 0,
                    vat REAL DEFAULT 0,
                    total_price REAL DEFAULT 0,
                    image_url TEXT,
                    remarks TEXT,
                    FOREIGN KEY (quote_id) REFERENCES quotations (id) ON DELETE CASCADE
                )
            `, (itemErr) => {
                if (itemErr) {
                    console.error('quotation_items 테이블 생성 오류:', itemErr.message);
                    reject(itemErr);
                    return;
                }
                resolve();
            });
        });
    });
};

// 견적번호 자동 채번 함수 (예: QT-20260930-001)
const generateQuoteNumber = () => {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const prefix = `QT-${yyyy}${mm}${dd}-`;

        db.all(`SELECT quote_number FROM quotations WHERE quote_number LIKE ? ORDER BY quote_number DESC LIMIT 1`, [`${prefix}%`], (err, rows) => {
            if (err) return reject(err);
            let nextSeq = 1;
            if (rows && rows.length > 0 && rows[0].quote_number) {
                const parts = rows[0].quote_number.split('-');
                if (parts.length === 3) {
                    const lastSeq = parseInt(parts[2], 10);
                    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
                }
            }
            resolve(`${prefix}${String(nextSeq).padStart(3, '0')}`);
        });
    });
};

// ── 1. 품목 사진 업로드 API ──
router.post('/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '업로드할 이미지 파일이 없습니다.' });
    }
    const publicUrl = `/api/quotations/uploads/${req.file.filename}`;
    res.json({
        message: '사진 업로드 성공',
        filename: req.file.filename,
        url: publicUrl
    });
});

// ── 2. 견적서 목록 조회 (검색 및 페이징) ──
router.get('/', (req, res) => {
    const { keyword, status, startDate, endDate } = req.query;
    let sql = `
        SELECT q.*, 
               (SELECT COUNT(*) FROM quotation_items WHERE quote_id = q.id) as item_count,
               (SELECT product_name FROM quotation_items WHERE quote_id = q.id ORDER BY seq ASC LIMIT 1) as first_item_name
        FROM quotations q 
        WHERE 1=1
    `;
    const params = [];

    if (keyword) {
        sql += ` AND (q.quote_number LIKE ? OR q.customer_name LIKE ? OR q.project_name LIKE ? OR q.author LIKE ?)`;
        const kw = `%${keyword}%`;
        params.push(kw, kw, kw, kw);
    }

    if (status && status !== 'all') {
        sql += ` AND q.status = ?`;
        params.push(status);
    }

    if (startDate) {
        sql += ` AND q.issue_date >= ?`;
        params.push(startDate);
    }

    if (endDate) {
        sql += ` AND q.issue_date <= ?`;
        params.push(endDate);
    }

    sql += ` ORDER BY q.created_at DESC, q.issue_date DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// ── 3. 견적서 단건 상세 조회 (마스터 + 품목 목록) ──
router.get('/:id', (req, res) => {
    const { id } = req.params;

    db.get(`SELECT * FROM quotations WHERE id = ? OR quote_number = ?`, [id, id], (err, quote) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!quote) return res.status(404).json({ error: '견적서를 찾을 수 없습니다.' });

        db.all(`SELECT * FROM quotation_items WHERE quote_id = ? ORDER BY seq ASC`, [quote.id], (itemErr, items) => {
            if (itemErr) return res.status(500).json({ error: itemErr.message });
            quote.items = items || [];
            res.json(quote);
        });
    });
});

// ── 4. 신규 견적서 생성 ──
router.post('/', async (req, res) => {
    try {
        const body = req.body;
        const quoteId = body.id || ('qt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));
        const quoteNumber = body.quote_number || await generateQuoteNumber();
        const now = new Date().toISOString();

        const insertMasterSql = `
            INSERT INTO quotations (
                id, quote_number, issue_date, valid_until, customer_name, customer_attn, customer_tel, customer_email,
                project_name, delivery_date, delivery_place, payment_terms,
                supplier_name, supplier_biz_num, supplier_ceo, supplier_address, supplier_tel, supplier_email, supplier_bank,
                include_seal, show_images, vat_type, total_supply_price, total_vat, total_amount, notes_instructions,
                status, created_at, updated_at, author
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const masterParams = [
            quoteId,
            quoteNumber,
            body.issue_date || now.split('T')[0],
            body.valid_until || '',
            body.customer_name || '',
            body.customer_attn || '',
            body.customer_tel || '',
            body.customer_email || '',
            body.project_name || '',
            body.delivery_date || '',
            body.delivery_place || '',
            body.payment_terms || '',
            body.supplier_name || '주식회사 케이엔지',
            body.supplier_biz_num || '687-87-03314',
            body.supplier_ceo || '박 준',
            body.supplier_address || '경기도 김포시 통진읍 율마로 402-14',
            body.supplier_tel || '031-987-1203',
            body.supplier_email || 'contact@junparks.com',
            body.supplier_bank || '기업은행 123-456789-01-012 (예금주: 주식회사 케이엔지)',
            body.include_seal !== undefined ? (body.include_seal ? 1 : 0) : 1,
            body.show_images !== undefined ? (body.show_images ? 1 : 0) : 1,
            body.vat_type || 'inclusive',
            Number(body.total_supply_price) || 0,
            Number(body.total_vat) || 0,
            Number(body.total_amount) || 0,
            body.notes_instructions || '',
            body.status || '작성중',
            now,
            now,
            body.author || req.user?.name || req.user?.email || '관리자'
        ];

        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(insertMasterSql, masterParams, function(mErr) {
                if (mErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: '견적서 저장 오류: ' + mErr.message });
                }

                const items = Array.isArray(body.items) ? body.items : [];
                if (items.length === 0) {
                    db.run('COMMIT', (cErr) => {
                        if (cErr) return res.status(500).json({ error: cErr.message });
                        return res.status(201).json({ message: '견적서 저장 성공', id: quoteId, quote_number: quoteNumber });
                    });
                    return;
                }

                const insertItemSql = `
                    INSERT INTO quotation_items (
                        id, quote_id, seq, source_module, source_id, product_name, spec, color, unit, qty,
                        cost_price, unit_price, supply_price, vat, total_price, image_url, remarks
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const stmt = db.prepare(insertItemSql);

                items.forEach((item, index) => {
                    const itemId = item.id || ('qi_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substring(2, 6));
                    stmt.run([
                        itemId,
                        quoteId,
                        index + 1,
                        item.source_module || 'manual',
                        item.source_id || '',
                        item.product_name || '',
                        item.spec || '',
                        item.color || '',
                        item.unit || 'EA',
                        Number(item.qty) || 1,
                        Number(item.cost_price) || 0,
                        Number(item.unit_price) || 0,
                        Number(item.supply_price) || 0,
                        Number(item.vat) || 0,
                        Number(item.total_price) || 0,
                        item.image_url || '',
                        item.remarks || ''
                    ]);
                });

                stmt.finalize((fErr) => {
                    if (fErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: '품목 저장 오류: ' + fErr.message });
                    }
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                        res.status(201).json({
                            message: '견적서 저장 성공',
                            id: quoteId,
                            quote_number: quoteNumber,
                            item_count: items.length
                        });
                    });
                });
            });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ── 5. 견적서 수정 ──
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const body = req.body;
    const now = new Date().toISOString();

    const updateMasterSql = `
        UPDATE quotations SET
            issue_date = ?, valid_until = ?, customer_name = ?, customer_attn = ?, customer_tel = ?, customer_email = ?,
            project_name = ?, delivery_date = ?, delivery_place = ?, payment_terms = ?,
            supplier_name = ?, supplier_biz_num = ?, supplier_ceo = ?, supplier_address = ?, supplier_tel = ?, supplier_email = ?, supplier_bank = ?,
            include_seal = ?, show_images = ?, vat_type = ?, total_supply_price = ?, total_vat = ?, total_amount = ?, notes_instructions = ?,
            status = ?, updated_at = ?, author = ?
        WHERE id = ?
    `;

    const masterParams = [
        body.issue_date || '',
        body.valid_until || '',
        body.customer_name || '',
        body.customer_attn || '',
        body.customer_tel || '',
        body.customer_email || '',
        body.project_name || '',
        body.delivery_date || '',
        body.delivery_place || '',
        body.payment_terms || '',
        body.supplier_name || '주식회사 케이엔지',
        body.supplier_biz_num || '687-87-03314',
        body.supplier_ceo || '박 준',
        body.supplier_address || '경기도 김포시 통진읍 율마로 402-14',
        body.supplier_tel || '031-987-1203',
        body.supplier_email || 'contact@junparks.com',
        body.supplier_bank || '',
        body.include_seal !== undefined ? (body.include_seal ? 1 : 0) : 1,
        body.show_images !== undefined ? (body.show_images ? 1 : 0) : 1,
        body.vat_type || 'inclusive',
        Number(body.total_supply_price) || 0,
        Number(body.total_vat) || 0,
        Number(body.total_amount) || 0,
        body.notes_instructions || '',
        body.status || '작성중',
        now,
        body.author || req.user?.name || req.user?.email || '관리자',
        id
    ];

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(updateMasterSql, masterParams, function(mErr) {
            if (mErr) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: '견적서 수정 실패: ' + mErr.message });
            }

            // 기존 품목 교체
            db.run(`DELETE FROM quotation_items WHERE quote_id = ?`, [id], (delErr) => {
                if (delErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: delErr.message });
                }

                const items = Array.isArray(body.items) ? body.items : [];
                if (items.length === 0) {
                    db.run('COMMIT', (cErr) => {
                        if (cErr) return res.status(500).json({ error: cErr.message });
                        return res.json({ message: '견적서 수정 완료', id });
                    });
                    return;
                }

                const insertItemSql = `
                    INSERT INTO quotation_items (
                        id, quote_id, seq, source_module, source_id, product_name, spec, color, unit, qty,
                        cost_price, unit_price, supply_price, vat, total_price, image_url, remarks
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const stmt = db.prepare(insertItemSql);

                items.forEach((item, index) => {
                    const itemId = item.id || ('qi_' + Date.now() + '_' + index + '_' + Math.random().toString(36).substring(2, 6));
                    stmt.run([
                        itemId,
                        id,
                        index + 1,
                        item.source_module || 'manual',
                        item.source_id || '',
                        item.product_name || '',
                        item.spec || '',
                        item.color || '',
                        item.unit || 'EA',
                        Number(item.qty) || 1,
                        Number(item.cost_price) || 0,
                        Number(item.unit_price) || 0,
                        Number(item.supply_price) || 0,
                        Number(item.vat) || 0,
                        Number(item.total_price) || 0,
                        item.image_url || '',
                        item.remarks || ''
                    ]);
                });

                stmt.finalize((fErr) => {
                    if (fErr) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: fErr.message });
                    }
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                        res.json({ message: '견적서 수정 완료', id, item_count: items.length });
                    });
                });
            });
        });
    });
});

// ── 6. 견적서 삭제 ──
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`DELETE FROM quotation_items WHERE quote_id = ?`, [id], () => {});
        db.run(`DELETE FROM quotations WHERE id = ?`, [id], function(err) {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
            }
            db.run('COMMIT', () => {
                res.json({ message: '견적서 삭제 완료', id });
            });
        });
    });
});

module.exports = {
    router,
    setDb,
    initQuotationTables
};
