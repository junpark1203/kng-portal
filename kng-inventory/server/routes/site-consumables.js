const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let db;
function setDb(database) {
    db = database;
}

// Multer setup for file uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const SITE_CONSUMABLES_DIR = path.join(UPLOAD_DIR, 'site-consumables');
if (!fs.existsSync(SITE_CONSUMABLES_DIR)) {
    fs.mkdirSync(SITE_CONSUMABLES_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, SITE_CONSUMABLES_DIR);
    },
    filename: function (req, file, cb) {
        // Fix encoding for Korean filenames (latin1 to utf8)
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        // Safe filename with timestamp, allowing Korean and spaces
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_가-힣\s]/g, '_');
        cb(null, Date.now() + '-' + safeName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

function initSiteConsumablesTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS sites (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    address TEXT,
                    remarks TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `);
            database.run(`
                CREATE TABLE IF NOT EXISTS site_consumables (
                    id TEXT PRIMARY KEY,
                    siteId TEXT NOT NULL,
                    name TEXT NOT NULL,
                    specification TEXT,
                    unit TEXT,
                    remarks TEXT,
                    createdAt TEXT,
                    updatedAt TEXT,
                    FOREIGN KEY (siteId) REFERENCES sites(id) ON DELETE CASCADE
                )
            `);
            database.run(`
                CREATE TABLE IF NOT EXISTS site_consumable_files (
                    id TEXT PRIMARY KEY,
                    consumableId TEXT NOT NULL,
                    fileName TEXT NOT NULL,
                    originalName TEXT NOT NULL,
                    fileType TEXT,
                    fileSize INTEGER,
                    uploadedAt TEXT,
                    FOREIGN KEY (consumableId) REFERENCES site_consumables(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('현장별 소모품 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    // Migrate: Add category column if not exists
                    database.run("ALTER TABLE site_consumables ADD COLUMN category TEXT", (alterErr) => {
                        // ignore error as it likely means column already exists
                        console.log('현장별 소모품(sites, site_consumables, site_consumable_files) 테이블 확인 완료');
                        resolve();
                    });
                }
            });
        });
    });
}

// ==========================================
// Sites CRUD
// ==========================================
router.get('/sites', (req, res) => {
    db.all('SELECT * FROM sites ORDER BY createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/sites', (req, res) => {
    const p = req.body;
    const id = p.id || ('SITE-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    
    const sql = `INSERT INTO sites (id, name, address, remarks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`;
    const params = [id, p.name || '', p.address || '', p.remarks || '', now, now];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '현장 등록 성공', id });
    });
});

router.put('/sites/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    
    const sql = `UPDATE sites SET name=?, address=?, remarks=?, updatedAt=? WHERE id=?`;
    const params = [p.name || '', p.address || '', p.remarks || '', now, id];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '현장을 찾을 수 없습니다.' });
        res.json({ message: '현장 수정 성공' });
    });
});

router.delete('/sites/:id', (req, res) => {
    db.run('DELETE FROM sites WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '현장을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// ==========================================
// Site Consumables CRUD
// ==========================================
router.get('/consumables/:siteId', (req, res) => {
    db.all('SELECT * FROM site_consumables WHERE siteId = ? ORDER BY createdAt DESC', [req.params.siteId], (err, consumables) => {
        if (err) return res.status(500).json({ error: err.message });
        if (consumables.length === 0) return res.json([]);
        
        const consumableIds = consumables.map(c => c.id);
        const placeholders = consumableIds.map(() => '?').join(',');
        db.all(`SELECT id, consumableId, fileName, originalName FROM site_consumable_files WHERE consumableId IN (${placeholders}) ORDER BY uploadedAt DESC`, consumableIds, (err, files) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const fileMap = {};
            files.forEach(f => {
                if(!fileMap[f.consumableId]) fileMap[f.consumableId] = [];
                fileMap[f.consumableId].push(f);
            });
            
            consumables.forEach(c => {
                c.files = fileMap[c.id] || [];
                c.fileCount = c.files.length;
            });
            
            res.json(consumables);
        });
    });
});

router.post('/consumables', (req, res) => {
    const p = req.body;
    if (!p.siteId) return res.status(400).json({ error: 'siteId가 필요합니다.' });
    
    const id = p.id || ('CONS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    
    const sql = `INSERT INTO site_consumables (id, siteId, category, name, specification, unit, remarks, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.siteId, p.category || '', p.name || '', p.specification || '', p.unit || '', p.remarks || '', now, now];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '소모품 등록 성공', id });
    });
});

router.put('/consumables/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    
    const sql = `UPDATE site_consumables SET category=?, name=?, specification=?, unit=?, remarks=?, updatedAt=? WHERE id=?`;
    const params = [p.category || '', p.name || '', p.specification || '', p.unit || '', p.remarks || '', now, id];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '소모품을 찾을 수 없습니다.' });
        res.json({ message: '소모품 수정 성공' });
    });
});

router.delete('/consumables/:id', (req, res) => {
    db.run('DELETE FROM site_consumables WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '소모품을 찾을 수 없습니다.' });
        res.json({ message: '삭제 성공' });
    });
});

// ==========================================
// Consumable Files
// ==========================================
router.get('/files/:consumableId', (req, res) => {
    db.all('SELECT * FROM site_consumable_files WHERE consumableId = ? ORDER BY uploadedAt DESC', [req.params.consumableId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/files/:consumableId', upload.array('files', 10), (req, res) => {
    const consumableId = req.params.consumableId;
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '업로드된 파일이 없습니다.' });
    }
    
    const now = new Date().toISOString();
    let inserted = 0;
    
    const stmt = db.prepare(`
        INSERT INTO site_consumable_files (id, consumableId, fileName, originalName, fileType, fileSize, uploadedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    req.files.forEach((file, i) => {
        const fileId = 'CFILE-' + Date.now() + '-' + i;
        stmt.run([fileId, consumableId, file.filename, file.originalname, file.mimetype, file.size, now], function(err) {
            if (!err) inserted++;
        });
    });
    
    stmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '파일 업로드 성공', count: inserted });
    });
});

router.delete('/files/:fileId', (req, res) => {
    const fileId = req.params.fileId;
    
    db.get('SELECT fileName FROM site_consumable_files WHERE id = ?', [fileId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
        
        const filePath = path.join(SITE_CONSUMABLES_DIR, row.fileName);
        
        db.run('DELETE FROM site_consumable_files WHERE id = ?', [fileId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // Delete physical file
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            res.json({ message: '파일 삭제 성공' });
        });
    });
});

module.exports = {
    router,
    setDb,
    initSiteConsumablesTables
};
