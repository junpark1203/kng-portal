const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

let db;

// DB 주입
const setDb = (dbInstance) => {
    db = dbInstance;
};

// 테이블 초기화
const initExhibitionReportTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS exhibition_reports (
                id TEXT PRIMARY KEY,
                exhibitionName TEXT,
                visitDate TEXT,
                booths TEXT, -- JSON Array of booth visits
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('exhibition_reports 테이블 생성 오류:', err.message);
                reject(err);
            } else {
                console.log('exhibition_reports 테이블 확인 완료');
                resolve();
            }
        });
    });
};

// Multer 파일 업로드 설정
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'exhibition-reports');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // 한글 파일명 깨짐 방지 처리
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// 사진 다중 업로드 (최대 5장)
router.post('/upload', upload.array('photos', 5), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '업로드된 파일이 없습니다.' });
        }
        const fileUrls = req.files.map(file => `/api/exhibition-report/uploads/${file.filename}`);
        res.json({ message: '업로드 성공', urls: fileUrls });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: '파일 업로드 중 오류가 발생했습니다.' });
    }
});

// 이미지 프록시 (Mixed Content 해결)
router.get('/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL is required');

    const client = targetUrl.startsWith('https') ? https : http;
    
    client.get(targetUrl, (proxyRes) => {
        if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
            // 간단한 리다이렉트 처리
            const redirectUrl = proxyRes.headers.location;
            const redirectClient = redirectUrl.startsWith('https') ? https : http;
            redirectClient.get(redirectUrl, (redirectRes) => {
                res.writeHead(redirectRes.statusCode, redirectRes.headers);
                redirectRes.pipe(res);
            }).on('error', (err) => {
                res.status(500).send(err.message);
            });
            return;
        }
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    }).on('error', (err) => {
        res.status(500).send(err.message);
    });
});

// 전체 목록 조회
router.get('/', (req, res) => {
    db.all('SELECT * FROM exhibition_reports ORDER BY visitDate DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Parse JSON for frontend
        const parsedRows = rows.map(row => {
            try {
                row.booths = JSON.parse(row.booths || '[]');
            } catch (e) {
                row.booths = [];
            }
            return row;
        });
        
        res.json(parsedRows);
    });
});

// 단일 조회
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM exhibition_reports WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '보고서를 찾을 수 없습니다.' });
        
        try {
            row.booths = JSON.parse(row.booths || '[]');
        } catch (e) {
            row.booths = [];
        }
        
        res.json(row);
    });
});

// 보고서 생성
router.post('/', (req, res) => {
    const p = req.body;
    const id = p.id || ('EXREP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `
        INSERT INTO exhibition_reports (
            id, exhibitionName, visitDate, booths, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const boothsJson = typeof p.booths === 'string' ? p.booths : JSON.stringify(p.booths || []);
    
    const params = [
        id, p.exhibitionName || '', p.visitDate || '', boothsJson, now, now
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 보고서 수정
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `
        UPDATE exhibition_reports SET
            exhibitionName = ?, visitDate = ?, booths = ?, updatedAt = ?
        WHERE id = ?
    `;
    
    const boothsJson = typeof p.booths === 'string' ? p.booths : JSON.stringify(p.booths || []);
    
    const params = [
        p.exhibitionName || '', p.visitDate || '', boothsJson, now, id
    ];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '보고서를 찾을 수 없습니다.' });
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
    const sql = `DELETE FROM exhibition_reports WHERE id IN (${placeholders})`;
    
    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

module.exports = {
    router,
    setDb,
    initExhibitionReportTables
};
