const express = require('express');
const router = express.Router();
let _db;

// DB 설정 함수 (server.js에서 호출)
function setDb(dbInstance) {
    _db = dbInstance;
}

// 테이블 초기화 함수
function initLeaveRequestTables(db) {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS leave_requests (
                id TEXT PRIMARY KEY,
                department TEXT,
                rank TEXT,
                name TEXT,
                leaveStart TEXT,
                leaveEnd TEXT,
                leaveType TEXT,
                reason TEXT,
                submitDate TEXT,
                createdAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('leave_requests 테이블 생성 오류:', err.message);
                return reject(err);
            }
            console.log('leave_requests 테이블 확인 완료');
            resolve();
        });
    });
}

// 1. 전체 휴가원 목록 조회 (작성일 기준 내림차순)
router.get('/', (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    _db.all('SELECT * FROM leave_requests ORDER BY createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. 단일 휴가원 조회
router.get('/:id', (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    _db.get('SELECT * FROM leave_requests WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '휴가원을 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 3. 새 휴가원 작성
router.post('/', (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    const p = req.body;
    const id = 'LR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    
    const sql = `
        INSERT INTO leave_requests (id, department, rank, name, leaveStart, leaveEnd, leaveType, reason, submitDate, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        id, 
        p.department || '', 
        p.rank || '', 
        p.name || '', 
        p.leaveStart || '', 
        p.leaveEnd || '', 
        p.leaveType || '', 
        p.reason || '', 
        p.submitDate || '', 
        now
    ];
    
    _db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '휴가원 등록 성공', id: id });
    });
});

// 4. 기존 휴가원 수정
router.put('/:id', (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    const p = req.body;
    const sql = `
        UPDATE leave_requests SET 
            department = ?, rank = ?, name = ?, leaveStart = ?, leaveEnd = ?, leaveType = ?, reason = ?, submitDate = ?
        WHERE id = ?
    `;
    const params = [
        p.department || '', 
        p.rank || '', 
        p.name || '', 
        p.leaveStart || '', 
        p.leaveEnd || '', 
        p.leaveType || '', 
        p.reason || '', 
        p.submitDate || '', 
        req.params.id
    ];
    
    _db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '수정할 항목을 찾을 수 없습니다.' });
        res.json({ message: '휴가원 수정 완료' });
    });
});

// 5. 휴가원 삭제
router.delete('/:id', (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    _db.run('DELETE FROM leave_requests WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '삭제할 항목을 찾을 수 없습니다.' });
        res.json({ message: '휴가원 삭제 완료' });
    });
});

module.exports = {
    router,
    setDb,
    initLeaveRequestTables
};
