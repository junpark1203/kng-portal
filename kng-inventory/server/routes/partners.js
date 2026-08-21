const express = require('express');
const router = express.Router();
const authMiddleware = require('../auth-middleware');

module.exports = (database) => {

    // 1. 테이블 초기화
    database.serialize(() => {
        database.run(`
            CREATE TABLE IF NOT EXISTS partners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                type TEXT DEFAULT 'ALL', 
                contact TEXT DEFAULT '',
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // 컬럼 추가 (기존 테이블 마이그레이션용)
        const columns = [
            'company_name TEXT', 'ceo_name TEXT', 'business_number TEXT', 'address TEXT',
            'bank_name TEXT', 'account_number TEXT', 'account_holder TEXT',
            'phone TEXT', 'fax TEXT',
            'manager1_name TEXT', 'manager1_phone TEXT', 'manager1_email TEXT',
            'manager2_name TEXT', 'manager2_phone TEXT', 'manager2_email TEXT'
        ];
        columns.forEach(col => {
            const colName = col.split(' ')[0];
            database.run(`ALTER TABLE partners ADD COLUMN ${col}`, function(err) {
                // 이미 컬럼이 존재하면 무시
            });
        });
    });

    // 2. 전체 조회
    router.get('/', authMiddleware.verifyToken, (req, res) => {
        database.all("SELECT * FROM partners ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // 3. 단일 등록
    router.post('/', authMiddleware.verifyToken, (req, res) => {
        const { 
            name, company_name, ceo_name, business_number, address,
            bank_name, account_number, account_holder,
            phone, fax,
            manager1_name, manager1_phone, manager1_email,
            manager2_name, manager2_phone, manager2_email,
            type, contact, note 
        } = req.body;
        
        if (!name || !company_name) return res.status(400).json({ error: '거래처명과 사업자명은 필수입니다.' });

        const stmt = database.prepare(`
            INSERT INTO partners (
                name, company_name, ceo_name, business_number, address,
                bank_name, account_number, account_holder,
                phone, fax,
                manager1_name, manager1_phone, manager1_email,
                manager2_name, manager2_phone, manager2_email,
                type, contact, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run([
            name, company_name, ceo_name || '', business_number || '', address || '',
            bank_name || '', account_number || '', account_holder || '',
            phone || '', fax || '',
            manager1_name || '', manager1_phone || '', manager1_email || '',
            manager2_name || '', manager2_phone || '', manager2_email || '',
            type || 'ALL', contact || '', note || ''
        ], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: '이미 등록된 거래처 이름입니다.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, name, company_name });
        });
        stmt.finalize();
    });

    // 4. 단일 수정
    router.put('/:id', authMiddleware.verifyToken, (req, res) => {
        const { 
            name, company_name, ceo_name, business_number, address,
            bank_name, account_number, account_holder,
            phone, fax,
            manager1_name, manager1_phone, manager1_email,
            manager2_name, manager2_phone, manager2_email,
            type, contact, note 
        } = req.body;
        const id = req.params.id;

        if (!name || !company_name) return res.status(400).json({ error: '거래처명과 사업자명은 필수입니다.' });

        const stmt = database.prepare(`
            UPDATE partners SET 
                name = ?, company_name = ?, ceo_name = ?, business_number = ?, address = ?,
                bank_name = ?, account_number = ?, account_holder = ?,
                phone = ?, fax = ?,
                manager1_name = ?, manager1_phone = ?, manager1_email = ?,
                manager2_name = ?, manager2_phone = ?, manager2_email = ?,
                type = ?, contact = ?, note = ?
            WHERE id = ?
        `);
        
        stmt.run([
            name, company_name, ceo_name || '', business_number || '', address || '',
            bank_name || '', account_number || '', account_holder || '',
            phone || '', fax || '',
            manager1_name || '', manager1_phone || '', manager1_email || '',
            manager2_name || '', manager2_phone || '', manager2_email || '',
            type || 'ALL', contact || '', note || '',
            id
        ], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: '이미 등록된 거래처 이름입니다.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id, name, company_name });
        });
        stmt.finalize();
    });

    // 5. 단일 삭제
    router.delete('/:id', authMiddleware.verifyToken, (req, res) => {
        const id = req.params.id;
        
        database.run("DELETE FROM partners WHERE id = ?", [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, deletedID: id });
        });
    });

    return router;
};
