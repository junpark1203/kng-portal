const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let db;

// DB 주입
const setDb = (database) => {
    db = database;
};

// DB 초기화
const initReportBuilderTables = (database) => {
    return new Promise((resolve, reject) => {
        const sql = `
            CREATE TABLE IF NOT EXISTS report_documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content_json TEXT NOT NULL,
                createdAt TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            )
        `;
        database.run(sql, (err) => {
            if (err) {
                console.error('report_documents 테이블 생성 실패:', err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// 업로드 설정
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
const REPORT_BUILDER_UPLOAD_DIR = path.join(UPLOAD_DIR, 'report-builder');
if (!fs.existsSync(REPORT_BUILDER_UPLOAD_DIR)) fs.mkdirSync(REPORT_BUILDER_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, REPORT_BUILDER_UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, 'report-' + uniqueSuffix + ext);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// 이미지 업로드 API
router.post('/upload', upload.single('image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: '이미지가 첨부되지 않았습니다.' });
        }
        // 업로드된 파일 URL 반환
        const fileUrl = `/api/report-builder/uploads/${req.file.filename}`;
        res.json({ url: fileUrl });
    } catch (err) {
        console.error('이미지 업로드 에러:', err);
        res.status(500).json({ error: '서버 업로드 에러' });
    }
});

// 보고서 리스트 조회
router.get('/', (req, res) => {
    const sql = `SELECT id, title, createdAt, updatedAt FROM report_documents ORDER BY updatedAt DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 단일 보고서 조회
router.get('/:id', (req, res) => {
    const sql = `SELECT * FROM report_documents WHERE id = ?`;
    db.get(sql, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 보고서 생성
router.post('/', (req, res) => {
    const { title, content_json } = req.body;
    const id = 'RPT-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    
    const sql = `INSERT INTO report_documents (id, title, content_json, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`;
    db.run(sql, [id, title || '제목 없는 보고서', content_json || '[]', now, now], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id, title, createdAt: now, updatedAt: now });
    });
});

// 보고서 수정
router.put('/:id', (req, res) => {
    const { title, content_json } = req.body;
    const now = new Date().toISOString();
    
    const sql = `UPDATE report_documents SET title = ?, content_json = ?, updatedAt = ? WHERE id = ?`;
    db.run(sql, [title, content_json, now, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '수정할 문서를 찾을 수 없습니다.' });
        res.json({ success: true, updatedAt: now });
    });
});

// 보고서 삭제
router.delete('/:id', (req, res) => {
    const sql = `DELETE FROM report_documents WHERE id = ?`;
    db.run(sql, [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '삭제할 문서를 찾을 수 없습니다.' });
        res.json({ success: true });
    });
});

module.exports = {
    router,
    setDb,
    initReportBuilderTables
};
