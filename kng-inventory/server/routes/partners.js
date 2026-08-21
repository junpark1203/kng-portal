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
    });

    // 2. 전체 조회
    router.get('/', authMiddleware, (req, res) => {
        database.all("SELECT * FROM partners ORDER BY name ASC", [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    // 3. 단일 등록
    router.post('/', authMiddleware, (req, res) => {
        const { name, type, contact, note } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });

        const stmt = database.prepare("INSERT INTO partners (name, type, contact, note) VALUES (?, ?, ?, ?)");
        stmt.run([name, type || 'ALL', contact || '', note || ''], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: '이미 등록된 거래처 이름입니다.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id: this.lastID, name, type, contact, note });
        });
        stmt.finalize();
    });

    // 4. 단일 수정
    router.put('/:id', authMiddleware, (req, res) => {
        const { name, type, contact, note } = req.body;
        const id = req.params.id;

        const stmt = database.prepare("UPDATE partners SET name = ?, type = ?, contact = ?, note = ? WHERE id = ?");
        stmt.run([name, type || 'ALL', contact || '', note || '', id], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: '이미 등록된 거래처 이름입니다.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ id, name, type, contact, note });
        });
        stmt.finalize();
    });

    // 5. 단일 삭제
    router.delete('/:id', authMiddleware, (req, res) => {
        const id = req.params.id;
        
        database.run("DELETE FROM partners WHERE id = ?", [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, deletedID: id });
        });
    });

    return router;
};
