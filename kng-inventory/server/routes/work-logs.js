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

// HTML 변환 및 이미지 추출 헬퍼 함수
const stripHTMLAndExtractImages = (htmlStr) => {
    if (!htmlStr) return { text: '', images: [] };
    const images = [];
    const imgRegex = /<img[^>]+src="([^">]+)"/gi;
    let match;
    while ((match = imgRegex.exec(htmlStr)) !== null) {
        images.push(match[1]);
    }
    // 줄바꿈 태그 처리
    let text = htmlStr.replace(/<br\s*[\/]?>/gi, '\n');
    text = text.replace(/<\/p>\s*<p>/gi, '\n\n');
    text = text.replace(/<\/?p>/gi, '');
    // 나머지 HTML 태그 제거
    text = text.replace(/<[^>]*>?/gm, '');
    // 엔티티 변환
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { text: text.trim(), images };
};

// 기존 데이터 마이그레이션 함수
const migrateData = () => {
    db.all("PRAGMA table_info(work_logs)", [], (err, cols) => {
        if (err) return console.error('PRAGMA 에러:', err);
        const hasAttachedImages = cols.some(c => c.name === 'attachedImages');
        if (!hasAttachedImages) {
            console.log("attachedImages 컬럼 추가 중...");
            db.run("ALTER TABLE work_logs ADD COLUMN attachedImages TEXT DEFAULT '[]'", (err) => {
                if (err) return console.error('ALTER TABLE 에러:', err);
                console.log("데이터 마이그레이션(HTML 제거 및 이미지 추출) 시작...");
                db.all("SELECT id, todayTasks, nextTasks FROM work_logs", [], (err, rows) => {
                    if (err || !rows) return;
                    rows.forEach(row => {
                        const today = stripHTMLAndExtractImages(row.todayTasks);
                        const next = stripHTMLAndExtractImages(row.nextTasks);
                        const allImages = [...today.images, ...next.images];
                        
                        db.run(
                            "UPDATE work_logs SET todayTasks = ?, nextTasks = ?, attachedImages = ? WHERE id = ?",
                            [today.text, next.text, JSON.stringify(allImages), row.id],
                            (err) => {
                                if (err) console.error("마이그레이션 실패 id:", row.id, err);
                            }
                        );
                    });
                    console.log("업무일지 마이그레이션 완료.");
                });
            });
        }
    });
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
                attachedImages TEXT DEFAULT '[]',
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('work_logs 테이블 생성 오류:', err.message);
                reject(err);
            } else {
                console.log('work_logs 테이블 확인 완료');
                migrateData();
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
            id, date, department, company, authorId, authorName, logType, category, isDraft, todayTasks, nextTasks, attachedImages, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const params = [
        id, p.date || '', p.department || '', p.company || '', p.authorId || '', p.authorName || '', 
        p.logType || '', p.category || '', p.isDraft ? 1 : 0, p.todayTasks || '', p.nextTasks || '', p.attachedImages || '[]', now, now
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
            date = ?, department = ?, company = ?, authorId = ?, authorName = ?, logType = ?, category = ?, isDraft = ?, todayTasks = ?, nextTasks = ?, attachedImages = ?, updatedAt = ?
        WHERE id = ?
    `;
    
    const params = [
        p.date || '', p.department || '', p.company || '', p.authorId || '', p.authorName || '', 
        p.logType || '', p.category || '', p.isDraft ? 1 : 0, p.todayTasks || '', p.nextTasks || '', p.attachedImages || '[]', now, id
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
