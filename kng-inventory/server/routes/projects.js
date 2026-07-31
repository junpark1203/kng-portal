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
                    return reject(err);
                }
                
                dbInstance.run(`
                    CREATE TABLE IF NOT EXISTS project_log_comments (
                        id TEXT PRIMARY KEY,
                        logId TEXT NOT NULL,
                        parentId TEXT,
                        authorName TEXT,
                        authorEmail TEXT,
                        content TEXT,
                        createdAt TEXT,
                        FOREIGN KEY (logId) REFERENCES project_logs(id),
                        FOREIGN KEY (parentId) REFERENCES project_log_comments(id)
                    )
                `, (err2) => {
                    if (err2) {
                        console.error('project_log_comments 테이블 생성 오류:', err2.message);
                        return reject(err2);
                    }
                    resolve();
                });
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
router.post('/upload', upload.array('files', 50), (req, res) => {
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

// GET: 특정 프로젝트의 로그 목록 조회 (댓글 포함)
router.get('/:projectId/logs', (req, res) => {
    db.all(`SELECT * FROM project_logs WHERE projectId = ? ORDER BY createdAt ASC`, [req.params.projectId], (err, logs) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        if (logs.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const logIds = logs.map(l => l.id);
        const placeholders = logIds.map(() => '?').join(',');
        
        db.all(`SELECT * FROM project_log_comments WHERE logId IN (${placeholders}) ORDER BY createdAt ASC`, logIds, (err2, comments) => {
            if (err2) return res.status(500).json({ success: false, error: err2.message });
            
            // 각 로그 객체에 comments 배열 추가
            logs.forEach(log => {
                log.comments = comments.filter(c => c.logId === log.id);
            });
            
            res.json({ success: true, data: logs });
        });
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
router.delete('/:projectId/logs/:id', (req, res) => {
    db.all(`SELECT attachments FROM project_logs WHERE id = ?`, [req.params.id], (err, rows) => {
        if (!err && rows && rows.length > 0) {
            try {
                const atts = JSON.parse(rows[0].attachments);
                atts.forEach(fileUrl => {
                    const filename = fileUrl.split('/').pop();
                    const filePath = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'), 'projects', filename);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                });
            } catch(e) {}
        }
        
        db.serialize(() => {
            db.run(`DELETE FROM project_log_comments WHERE logId = ?`, [req.params.id]);
            db.run(`DELETE FROM project_logs WHERE id = ? AND projectId = ?`, [req.params.id, req.params.projectId], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true });
            });
        });
    });
});

// POST: 댓글 및 대댓글 추가
router.post('/:projectId/logs/:logId/comments', (req, res) => {
    const { id, parentId, content, createdAt } = req.body;
    const logId = req.params.logId;
    
    // 이메일에서 유저 정보 추출
    let authorName = req.user && req.user.name ? req.user.name : null;
    let authorEmail = req.user && req.user.email ? req.user.email : null;
    
    if (!authorName && authorEmail) {
        authorName = authorEmail.split('@')[0];
    }
    if (!authorName) authorName = 'Anonymous';

    db.run(`
        INSERT INTO project_log_comments (id, logId, parentId, authorName, authorEmail, content, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, logId, parentId || null, authorName, authorEmail, content, createdAt || new Date().toISOString()], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, message: '댓글이 추가되었습니다.', authorName, authorEmail });
    });
});

// DELETE: 댓글 삭제
router.delete('/:projectId/logs/:logId/comments/:commentId', (req, res) => {
    const commentId = req.params.commentId;
    const authorEmail = req.user && req.user.email ? req.user.email : null;

    db.get(`SELECT authorEmail FROM project_log_comments WHERE id = ?`, [commentId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        if (!row) return res.status(404).json({ success: false, error: '댓글을 찾을 수 없습니다.' });

        // 작성자 본인인지 확인 (이메일 비교)
        if (row.authorEmail && row.authorEmail !== authorEmail) {
            return res.status(403).json({ success: false, error: '본인이 작성한 댓글만 삭제할 수 있습니다.' });
        }

        // 해당 댓글 및 모든 하위 대댓글 삭제
        db.serialize(() => {
            db.run(`DELETE FROM project_log_comments WHERE parentId = ?`, [commentId]); // 하위 대댓글 삭제
            db.run(`DELETE FROM project_log_comments WHERE id = ?`, [commentId], function(err2) {
                if (err2) return res.status(500).json({ success: false, error: err2.message });
                res.json({ success: true, message: '댓글이 삭제되었습니다.' });
            });
        });
    });
});

module.exports = {
    router,
    initProjectsTables
};
