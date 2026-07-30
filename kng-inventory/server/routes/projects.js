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
const initProjectsTables = (dbInstance) => {
    setDb(dbInstance);
    return new Promise((resolve, reject) => {
        dbInstance.serialize(() => {
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    category TEXT,
                    manager TEXT,
                    status TEXT DEFAULT '진행중',
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) console.error('projects 테이블 생성 오류:', err.message);
            });

            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS project_logs (
                    id TEXT PRIMARY KEY,
                    projectId TEXT NOT NULL,
                    content TEXT,
                    logType TEXT DEFAULT 'info',
                    attachments TEXT DEFAULT '[]',
                    createdAt TEXT,
                    FOREIGN KEY (projectId) REFERENCES projects(id)
                )
            `, (err) => {
                if (err) {
                    console.error('project_logs 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    });
};

// 파일 업로드 (Multer 설정)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'projects');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
    }
});
const upload = multer({ storage: storage });

// API: 첨부파일 업로드 엔드포인트
router.post('/upload', upload.array('files', 10), (req, res) => {
    try {
        const filePaths = req.files.map(file => `/api/projects/uploads/${file.filename}`);
        res.json({ success: true, filePaths });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET: 프로젝트 목록 조회
router.get('/', (req, res) => {
    db.all(`SELECT * FROM projects ORDER BY createdAt DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

// POST: 새 프로젝트 생성
router.post('/', (req, res) => {
    const { id, title, category, manager, status, createdAt } = req.body;
    db.run(`
        INSERT INTO projects (id, title, category, manager, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, title, category, manager, status || '진행중', createdAt, createdAt], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: '프로젝트가 생성되었습니다.' });
    });
});

// PUT: 프로젝트 마스터 수정
router.put('/:id', (req, res) => {
    const { title, category, manager, status, updatedAt } = req.body;
    db.run(`
        UPDATE projects SET title = ?, category = ?, manager = ?, status = ?, updatedAt = ? WHERE id = ?
    `, [title, category, manager, status, updatedAt, req.params.id], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
    });
});

// DELETE: 프로젝트 마스터 삭제 (관련 로그도 함께 삭제)
router.delete('/:id', (req, res) => {
    db.all(`SELECT attachments FROM project_logs WHERE projectId = ?`, [req.params.id], (err, rows) => {
        if (!err && rows) {
            rows.forEach(row => {
                if(row.attachments) {
                    try {
                        const atts = JSON.parse(row.attachments);
                        atts.forEach(fileUrl => {
                            const filename = fileUrl.split('/').pop();
                            const filePath = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'projects', filename);
                            if (fs.existsSync(filePath)) {
                                fs.unlinkSync(filePath);
                            }
                        });
                    } catch(e) { console.error("File deletion error", e); }
                }
            });
        }
        
        db.serialize(() => {
            db.run(`DELETE FROM project_logs WHERE projectId = ?`, [req.params.id], (err) => {
                if (err) console.error("로그 삭제 에러", err);
            });
            db.run(`DELETE FROM projects WHERE id = ?`, [req.params.id], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true });
            });
        });
    });
});

// GET: 특정 프로젝트의 로그 목록 조회
router.get('/:projectId/logs', (req, res) => {
    db.all(`SELECT * FROM project_logs WHERE projectId = ? ORDER BY createdAt ASC`, [req.params.projectId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows });
    });
});

// POST: 타임라인 로그 등록
router.post('/:projectId/logs', (req, res) => {
    const { id, content, logType, attachments, createdAt } = req.body;
    const projectId = req.params.projectId;
    db.run(`
        INSERT INTO project_logs (id, projectId, content, logType, attachments, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [id, projectId, content, logType, JSON.stringify(attachments || []), createdAt], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        // Update project updatedAt
        db.run(`UPDATE projects SET updatedAt = ? WHERE id = ?`, [createdAt, projectId]);
        
        res.json({ success: true });
    });
});

// PUT: 타임라인 로그 수정
router.put('/:projectId/logs/:logId', (req, res) => {
    const { content, logType, attachments, createdAt } = req.body;
    const logId = req.params.logId;
    const projectId = req.params.projectId;

    db.get(`SELECT attachments FROM project_logs WHERE id = ? AND projectId = ?`, [logId, projectId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (row && row.attachments) {
            try {
                const oldAtts = JSON.parse(row.attachments);
                const newAtts = attachments || [];
                // 삭제된 파일 찾기: 기존에는 있었는데, 새 목록에는 없는 파일
                oldAtts.forEach(fileUrl => {
                    if (!newAtts.includes(fileUrl)) {
                        const filename = fileUrl.split('/').pop();
                        const filePath = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'projects', filename);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    }
                });
            } catch (e) { console.error("File deletion error during update", e); }
        }

        db.run(`
            UPDATE project_logs 
            SET content = ?, logType = ?, attachments = ?, createdAt = ? 
            WHERE id = ? AND projectId = ?
        `, [content, logType, JSON.stringify(attachments || []), createdAt, logId, projectId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            
            // Update project updatedAt
            db.run(`UPDATE projects SET updatedAt = ? WHERE id = ?`, [createdAt, projectId]);
            
            res.json({ success: true });
        });
    });
});

// DELETE: 타임라인 로그 삭제
router.delete('/:projectId/logs/:logId', (req, res) => {
    db.get(`SELECT attachments FROM project_logs WHERE id = ? AND projectId = ?`, [req.params.logId, req.params.projectId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (row && row.attachments) {
            try {
                const atts = JSON.parse(row.attachments);
                atts.forEach(fileUrl => {
                    const filename = fileUrl.split('/').pop();
                    const filePath = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'projects', filename);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });
            } catch(e) { console.error("File deletion error", e); }
        }
        
        db.run(`DELETE FROM project_logs WHERE id = ? AND projectId = ?`, [req.params.logId, req.params.projectId], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
    });
});

module.exports = {
    router,
    initProjectsTables
};
