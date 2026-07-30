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
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
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

// 보고서 복사 (사진 파일 물리적 복제 포함)
router.post('/copy', (req, res) => {
    let { title, content_json } = req.body;
    const id = 'RPT-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
    const now = new Date().toISOString();
    
    try {
        const content = JSON.parse(content_json || '{}');
        const uploadDir = path.join(__dirname, '..', 'uploads', 'report-builder');
        
        // 이미지 타입 컬럼 ID 찾기
        const imageColumns = (content.columns || []).filter(c => c.type === 'image').map(c => c.id);
        
        // 각 행을 순회하며 물리적 파일 복사 및 URL 변경
        if (content.rows && imageColumns.length > 0) {
            content.rows.forEach(row => {
                imageColumns.forEach(colId => {
                    const urls = row[colId];
                    if (Array.isArray(urls)) {
                        row[colId] = urls.map(url => {
                            if (url && url.includes('/api/report-builder/uploads/')) {
                                const oldFilename = url.split('/').pop();
                                const oldFilePath = path.join(uploadDir, oldFilename);
                                
                                if (fs.existsSync(oldFilePath)) {
                                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                                    const ext = path.extname(oldFilename) || '.jpg';
                                    const newFilename = 'report-copy-' + uniqueSuffix + ext;
                                    const newFilePath = path.join(uploadDir, newFilename);
                                    
                                    fs.copyFileSync(oldFilePath, newFilePath);
                                    return `/api/report-builder/uploads/${newFilename}`;
                                }
                            }
                            return url;
                        });
                    }
                });
            });
        }
        
        const newContentJson = JSON.stringify(content);
        const copyTitle = title ? `[복사본] ${title}` : '제목 없는 보고서';
        
        const sql = `INSERT INTO report_documents (id, title, content_json, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [id, copyTitle, newContentJson, now, now], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.status(201).json({ id, title: copyTitle, createdAt: now, updatedAt: now });
        });
        
    } catch (err) {
        console.error('보고서 복사 오류:', err);
        res.status(500).json({ error: '보고서 복사 처리 중 오류가 발생했습니다.' });
    }
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

// 특정 파일(사진) 삭제
router.delete('/file', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        // url에서 파일명만 추출 (예: /api/report-builder/uploads/1234.jpg -> 1234.jpg)
        const filename = url.split('/').pop();
        const uploadDir = path.join(__dirname, '..', 'uploads', 'report-builder');
        const filePath = path.join(uploadDir, filename);

        // 보안: 상위 폴더 접근 차단
        if (filePath.startsWith(uploadDir) && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return res.json({ success: true, message: 'File deleted' });
        }
        res.status(404).json({ error: 'File not found' });
    } catch (err) {
        console.error('파일 삭제 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    setDb,
    initReportBuilderTables
};
