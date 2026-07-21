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
                    database.run("ALTER TABLE site_consumables ADD COLUMN category TEXT", () => {
                        // Add new fields for sites
                        database.run("ALTER TABLE sites ADD COLUMN tbmMachine TEXT", () => {
                            database.run("ALTER TABLE sites ADD COLUMN tunnelInnerDiameter TEXT", () => {
                                database.run("ALTER TABLE sites ADD COLUMN tunnelLength TEXT", () => {
                                     // Add subCategory for consumables
                                    database.run("ALTER TABLE site_consumables ADD COLUMN subCategory TEXT", () => {
                                        // Add opQuantity for consumables
                                        database.run("ALTER TABLE site_consumables ADD COLUMN opQuantity TEXT", () => {
                                            // Add drawingNumber and uniqueNumber
                                            database.run("ALTER TABLE site_consumables ADD COLUMN drawingNumber TEXT", () => {
                                                database.run("ALTER TABLE site_consumables ADD COLUMN uniqueNumber TEXT", () => {
                                                    console.log('현장별 소모품(sites, site_consumables, site_consumable_files) 테이블 확인 완료');
                                                    resolve();
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
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
    
    const sql = `INSERT INTO sites (id, name, tbmMachine, tunnelInnerDiameter, tunnelLength, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.name || '', p.tbmMachine || '', p.tunnelInnerDiameter || '', p.tunnelLength || '', now, now];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '현장 등록 성공', id });
    });
});

router.put('/sites/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    
    const sql = `UPDATE sites SET name=?, tbmMachine=?, tunnelInnerDiameter=?, tunnelLength=?, updatedAt=? WHERE id=?`;
    const params = [p.name || '', p.tbmMachine || '', p.tunnelInnerDiameter || '', p.tunnelLength || '', now, id];
    
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
router.get('/all-consumables', (req, res) => {
    const sql = `
        SELECT c.*, s.name as siteName 
        FROM site_consumables c 
        LEFT JOIN sites s ON c.siteId = s.id 
        ORDER BY s.name ASC, c.category ASC, c.name ASC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        if (rows.length === 0) return res.json([]);

        // 모든 소모품의 파일 정보를 가져오기 위해 전체 파일 목록 조회
        db.all(`SELECT id, consumableId, fileName, originalName FROM site_consumable_files ORDER BY uploadedAt DESC`, [], (err, files) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const fileMap = {};
            files.forEach(f => {
                if(!fileMap[f.consumableId]) fileMap[f.consumableId] = [];
                fileMap[f.consumableId].push(f);
            });
            
            rows.forEach(c => {
                c.files = fileMap[c.id] || [];
                c.fileCount = c.files.length;
            });
            
            res.json(rows);
        });
    });
});

router.post('/all-consumables/export', async (req, res) => {
    try {
        const ExcelJS = require('exceljs');
        const { ids, isGroupedView } = req.body;
        if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids 배열이 필요합니다.' });

        const sql = `
            SELECT c.*, s.name as siteName 
            FROM site_consumables c 
            LEFT JOIN sites s ON c.siteId = s.id 
            ORDER BY s.name ASC, c.category ASC, c.name ASC
        `;
        
        let rows = [];
        if (ids.length > 0) {
            const allRows = await new Promise((resolve, reject) => {
                db.all(sql, [], (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            });
            const idMap = new Map();
            allRows.forEach(r => idMap.set(r.id, r));
            rows = ids.map(id => idMap.get(id)).filter(Boolean);
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('전체 현장 현황');

        if (isGroupedView) {
            worksheet.columns = [
                { header: '식별번호(도면/고유)', key: 'identifier', width: 25 },
                { header: '품명', key: 'name', width: 30 },
                { header: '규격', key: 'specification', width: 30 },
                { header: '투입 현장', key: 'siteNames', width: 40 },
                { header: '총 운용수량', key: 'totalQuantity', width: 15 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '비고', key: 'remarks', width: 30 }
            ];

            const groupedMap = new Map();
            const ungroupedList = [];

            rows.forEach(c => {
                let key = c.drawingNumber ? c.drawingNumber : (c.uniqueNumber ? c.uniqueNumber : null);
                if (key) {
                    if (!groupedMap.has(key)) {
                        groupedMap.set(key, { ...c, totalQuantity: 0, sites: new Set() });
                    }
                    const group = groupedMap.get(key);
                    const qty = parseFloat(c.opQuantity);
                    group.totalQuantity += (isNaN(qty) ? 0 : qty);
                    if (c.siteName) group.sites.add(c.siteName);
                } else {
                    ungroupedList.push(c);
                }
            });

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
            worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

            groupedMap.forEach((g, key) => {
                worksheet.addRow({
                    identifier: key,
                    name: g.name || '-',
                    specification: g.specification || '-',
                    siteNames: Array.from(g.sites).join(', '),
                    totalQuantity: g.totalQuantity,
                    unit: g.unit || '-',
                    remarks: g.remarks || '-'
                });
            });
            ungroupedList.forEach(c => {
                worksheet.addRow({
                    identifier: '-',
                    name: c.name || '-',
                    specification: c.specification || '-',
                    siteNames: c.siteName || '-',
                    totalQuantity: c.opQuantity || '',
                    unit: c.unit || '-',
                    remarks: c.remarks || '-'
                });
            });
        } else {
            worksheet.columns = [
                { header: '현장명', key: 'siteName', width: 25 },
                { header: '도면번호', key: 'drawingNumber', width: 20 },
                { header: '고유번호', key: 'uniqueNumber', width: 20 },
                { header: '구분(상위)', key: 'category', width: 20 },
                { header: '구분(하위)', key: 'subCategory', width: 20 },
                { header: '품명', key: 'name', width: 30 },
                { header: '규격', key: 'specification', width: 30 },
                { header: '운용수량', key: 'opQuantity', width: 12 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '비고', key: 'remarks', width: 30 }
            ];

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
            worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

            rows.forEach(r => {
                worksheet.addRow({
                    siteName: r.siteName || '-',
                    drawingNumber: r.drawingNumber || '-',
                    uniqueNumber: r.uniqueNumber || '-',
                    category: r.category || '-',
                    subCategory: r.subCategory || '-',
                    name: r.name || '-',
                    specification: r.specification || '-',
                    opQuantity: r.opQuantity || '',
                    unit: r.unit || '-',
                    remarks: r.remarks || '-'
                });
            });
        }
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="site_consumables_dashboard.xlsx"');
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('Excel Export Error:', e);
        res.status(500).json({ error: '엑셀 파일 생성 중 오류가 발생했습니다.' });
    }
});

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
    
    const sql = `INSERT INTO site_consumables (id, siteId, category, subCategory, name, specification, opQuantity, unit, remarks, drawingNumber, uniqueNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const params = [id, p.siteId, p.category || '', p.subCategory || '', p.name || '', p.specification || '', p.opQuantity || '', p.unit || '', p.remarks || '', p.drawingNumber || '', p.uniqueNumber || '', now, now];
    
    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '소모품 등록 성공', id });
    });
});

router.put('/consumables/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    
    const sql = `UPDATE site_consumables SET category=?, subCategory=?, name=?, specification=?, opQuantity=?, unit=?, remarks=?, drawingNumber=?, uniqueNumber=?, updatedAt=? WHERE id=?`;
    const params = [p.category || '', p.subCategory || '', p.name || '', p.specification || '', p.opQuantity || '', p.unit || '', p.remarks || '', p.drawingNumber || '', p.uniqueNumber || '', now, id];
    
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

router.post('/consumables/:id/copy', (req, res) => {
    const originalId = req.params.id;
    
    // 1. 원본 소모품 정보 조회
    db.get('SELECT * FROM site_consumables WHERE id = ?', [originalId], (err, original) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!original) return res.status(404).json({ error: '원본 소모품을 찾을 수 없습니다.' });
        
        // 2. 새 소모품 데이터 복제 저장
        const newId = 'CONS-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
        const now = new Date().toISOString();
        const newName = original.name + ' - 복사본';
        
        const sql = `INSERT INTO site_consumables (id, siteId, category, subCategory, name, specification, opQuantity, unit, remarks, drawingNumber, uniqueNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const params = [newId, original.siteId, original.category || '', original.subCategory || '', newName, original.specification || '', original.opQuantity || '', original.unit || '', original.remarks || '', original.drawingNumber || '', original.uniqueNumber || '', now, now];
        
        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ error: err.message });
            
            // 3. 원본에 첨부된 파일(도면) 조회
            db.all('SELECT * FROM site_consumable_files WHERE consumableId = ?', [originalId], (err, files) => {
                if (err) return res.status(500).json({ error: err.message });
                if (!files || files.length === 0) {
                    return res.status(201).json({ message: '소모품 복사 완료 (첨부파일 없음)', id: newId });
                }
                
                // 4. 물리적 파일 복사 및 DB 레코드 추가
                let completed = 0;
                let hasError = false;
                
                files.forEach(f => {
                    if (hasError) return;
                    
                    const oldPath = path.join(SITE_CONSUMABLES_DIR, f.fileName);
                    const newFileName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(f.originalName);
                    const newPath = path.join(SITE_CONSUMABLES_DIR, newFileName);
                    
                    try {
                        if (fs.existsSync(oldPath)) {
                            fs.copyFileSync(oldPath, newPath);
                            
                            const fileId = 'CFILE-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
                            db.run(`INSERT INTO site_consumable_files (id, consumableId, originalName, fileName, fileType, fileSize, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                                [fileId, newId, f.originalName, newFileName, f.fileType, f.fileSize, now], (err) => {
                                    if (err) { hasError = true; return res.status(500).json({ error: err.message }); }
                                    completed++;
                                    if (completed === files.length && !hasError) {
                                        res.status(201).json({ message: '소모품 및 첨부 도면 복사 완료', id: newId });
                                    }
                            });
                        } else {
                            completed++;
                            if (completed === files.length && !hasError) {
                                res.status(201).json({ message: '소모품 복사 완료 (일부 파일 유실)', id: newId });
                            }
                        }
                    } catch (e) {
                        if(!hasError) {
                            hasError = true;
                            res.status(500).json({ error: '파일 복사 중 오류: ' + e.message });
                        }
                    }
                });
            });
        });
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
