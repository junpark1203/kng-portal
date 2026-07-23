const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let db;

// DB 주입
const setDb = (dbInstance) => {
    db = dbInstance;
};

// 테이블 초기화
const initWorkLogsTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS work_logs (
                id TEXT PRIMARY KEY,
                date TEXT,
                department TEXT,
                company TEXT,
                authorId TEXT,
                authorName TEXT,
                logType TEXT,
                category TEXT,
                isDraft INTEGER DEFAULT 0,
                todayTasks TEXT,
                nextTasks TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('work_logs 테이블 생성 오류:', err.message);
                reject(err);
            } else {
                console.log('work_logs 테이블 확인 완료');
                resolve();
            }
        });
    });
};

// Multer 파일 업로드 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'work-logs');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// 이미지 업로드 API (TinyMCE 용)
router.post('/upload-image', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '업로드된 파일이 없습니다.' });
        }
        const fileUrl = `/api/work-logs/uploads/${req.file.filename}`;
        res.json({ location: fileUrl }); // TinyMCE expects { location: 'url' }
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: '파일 업로드 중 오류가 발생했습니다.' });
    }
});

// 전체 목록 조회 (조건 검색 포함)
router.get('/', (req, res) => {
    db.all('SELECT * FROM work_logs ORDER BY date DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단일 조회
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM work_logs WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 업무일지 등록
router.post('/', (req, res) => {
    const p = req.body;
    const id = p.id || ('WL-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `
        INSERT INTO work_logs (
            id, date, department, company, authorId, authorName, logType, category, isDraft, todayTasks, nextTasks, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        id, p.date || '', p.department || '', p.company || '', p.authorId || '', p.authorName || '', 
        p.logType || '', p.category || '', p.isDraft ? 1 : 0, p.todayTasks || '', p.nextTasks || '', now, now
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 업무일지 수정
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `
        UPDATE work_logs SET
            date = ?, department = ?, company = ?, authorId = ?, authorName = ?, logType = ?, category = ?, isDraft = ?, todayTasks = ?, nextTasks = ?, updatedAt = ?
        WHERE id = ?
    `;
    
    const params = [
        p.date || '', p.department || '', p.company || '', p.authorId || '', p.authorName || '', 
        p.logType || '', p.category || '', p.isDraft ? 1 : 0, p.todayTasks || '', p.nextTasks || '', now, id
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

// 다중 삭제
router.post('/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM work_logs WHERE id IN (${placeholders})`;
    
    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

module.exports = {
    router,
    setDb,
    initWorkLogsTables
};
