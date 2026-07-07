const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

let db;

// Multer Storage Configuration for Contract Files
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const CONTRACT_UPLOAD_DIR = path.join(UPLOAD_DIR, 'contracts');

if (!fs.existsSync(CONTRACT_UPLOAD_DIR)) {
    fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, CONTRACT_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // preserve original filename but add timestamp to prevent collision
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        const safeName = name.replace(/[^a-zA-Z0-9가-힣_-]/g, '_'); // Replace spaces and special chars
        cb(null, `${safeName}_${Date.now()}${ext}`);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * Initialize Tables
 */
async function initContractManagementTables(database) {
    db = database;
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // contracts table
            db.run(`
                CREATE TABLE IF NOT EXISTS contracts (
                    id TEXT PRIMARY KEY,
                    contractNo TEXT UNIQUE,
                    title TEXT,
                    buyer TEXT,
                    seller TEXT,
                    type TEXT,
                    amount INTEGER DEFAULT 0,
                    currency TEXT DEFAULT 'KRW',
                    effectiveDate TEXT,
                    paymentTerms TEXT,
                    pic TEXT,
                    remarks TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('contracts 테이블 생성 오류:', err);
                    return reject(err);
                }
            });

            // contract_files table
            db.run(`
                CREATE TABLE IF NOT EXISTS contract_files (
                    id TEXT PRIMARY KEY,
                    contractId TEXT,
                    fileName TEXT,
                    fileType TEXT,
                    versionLabel TEXT,
                    filePath TEXT,
                    fileSize INTEGER,
                    uploadedAt TEXT,
                    FOREIGN KEY (contractId) REFERENCES contracts(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('contract_files 테이블 생성 오류:', err);
                    return reject(err);
                }
                console.log('Contract Management 테이블 확인 완료');
                resolve();
            });
        });
    });
}

function setDb(database) {
    db = database;
}

// ----------------------------------------------------
// Contracts CRUD
// ----------------------------------------------------

// Get all contracts
router.get('/', (req, res) => {
    db.all(`
        SELECT c.*, 
        (SELECT COUNT(*) FROM contract_files cf WHERE cf.contractId = c.id) as fileCount
        FROM contracts c 
        ORDER BY c.createdAt DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get next contract number (KNG-YYMM-XXX)
router.get('/next-no', (req, res) => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const prefix = `KNG-${yy}${mm}-`;

    db.get('SELECT contractNo FROM contracts WHERE contractNo LIKE ? ORDER BY contractNo DESC LIMIT 1', [prefix + '%'], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        
        let nextNum = 1;
        if (row && row.contractNo) {
            const parts = row.contractNo.split('-');
            if (parts.length === 3) {
                const seq = parseInt(parts[2], 10);
                if (!isNaN(seq)) {
                    nextNum = seq + 1;
                }
            }
        }
        
        const nextContractNo = prefix + String(nextNum).padStart(3, '0');
        res.json({ nextNo: nextContractNo });
    });
});

// Get single contract with its files
router.get('/:id', (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM contracts WHERE id = ?', [id], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: '계약 건을 찾을 수 없습니다.' });

        db.all('SELECT * FROM contract_files WHERE contractId = ? ORDER BY uploadedAt DESC', [id], (err, files) => {
            if (err) return res.status(500).json({ error: err.message });
            contract.files = files || [];
            res.json(contract);
        });
    });
});

// Create new contract
router.post('/', (req, res) => {
    const p = req.body;
    const id = 'CTR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    
    // KST Time (UTC+9)
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset).toISOString().replace('Z', '+09:00');

    const sql = `
        INSERT INTO contracts (
            id, contractNo, title, buyer, seller, type, amount, currency, effectiveDate, paymentTerms, pic, remarks, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        id, p.contractNo || '', p.title || '', p.buyer || '', p.seller || '', p.type || '',
        p.amount || 0, p.currency || 'KRW', p.effectiveDate || '', p.paymentTerms || '',
        p.pic || '', p.remarks || '', kstDate, kstDate
    ];

    db.run(sql, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed: contracts.contractNo')) {
                return res.status(400).json({ error: '이미 존재하는 계약번호입니다.' });
            }
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ message: '계약 등록 성공', id: id, contractNo: p.contractNo, createdAt: kstDate });
    });
});

// Update contract
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    
    // KST Time
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset).toISOString().replace('Z', '+09:00');

    const sql = `
        UPDATE contracts SET 
            contractNo=?, title=?, buyer=?, seller=?, type=?, amount=?, currency=?, 
            effectiveDate=?, paymentTerms=?, pic=?, remarks=?, updatedAt=?
        WHERE id=?
    `;
    const params = [
        p.contractNo || '', p.title || '', p.buyer || '', p.seller || '', p.type || '',
        p.amount || 0, p.currency || 'KRW', p.effectiveDate || '', p.paymentTerms || '',
        p.pic || '', p.remarks || '', kstDate, id
    ];

    db.run(sql, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed: contracts.contractNo')) {
                return res.status(400).json({ error: '이미 존재하는 계약번호입니다.' });
            }
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ error: '수정할 계약건을 찾을 수 없습니다.' });
        res.json({ message: '수정 성공', updatedAt: kstDate });
    });
});

// Delete contract (and files logic)
router.delete('/:id', (req, res) => {
    const id = req.params.id;
    
    // 1. Get associated files to delete them from disk
    db.all('SELECT filePath FROM contract_files WHERE contractId = ?', [id], (err, files) => {
        if (!err && files && files.length > 0) {
            files.forEach(f => {
                const fullPath = path.join(CONTRACT_UPLOAD_DIR, f.filePath);
                if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                }
            });
        }
        
        // 2. Delete contract (Cascade will delete DB rows in contract_files if enabled, but let's delete manually to be safe)
        db.run('DELETE FROM contract_files WHERE contractId = ?', [id], () => {
            db.run('DELETE FROM contracts WHERE id = ?', [id], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: '계약건을 찾을 수 없습니다.' });
                res.json({ message: '삭제 성공' });
            });
        });
    });
});

// ----------------------------------------------------
// Contract Files
// ----------------------------------------------------

// Upload file to contract
router.post('/:id/files', upload.single('file'), (req, res) => {
    const contractId = req.params.id;
    if (!req.file) return res.status(400).json({ error: '파일이 전송되지 않았습니다.' });
    
    const versionLabel = req.body.versionLabel || '미지정';
    const fileId = 'CF-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    
    // KST Time
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstDate = new Date(now.getTime() + kstOffset).toISOString().replace('Z', '+09:00');

    const ext = path.extname(req.file.originalname).toLowerCase();
    const sql = `
        INSERT INTO contract_files (id, contractId, fileName, fileType, versionLabel, filePath, fileSize, uploadedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        fileId, 
        contractId, 
        req.file.originalname, 
        ext, 
        versionLabel, 
        req.file.filename, 
        req.file.size, 
        kstDate
    ];

    db.run(sql, params, function(err) {
        if (err) {
            fs.unlinkSync(req.file.path); // remove uploaded file on db error
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ 
            message: '파일 업로드 성공', 
            file: {
                id: fileId,
                fileName: req.file.originalname,
                versionLabel: versionLabel,
                filePath: req.file.filename,
                uploadedAt: kstDate
            }
        });
    });
});

// Delete specific file
router.delete('/:contractId/files/:fileId', (req, res) => {
    const { contractId, fileId } = req.params;
    
    db.get('SELECT filePath FROM contract_files WHERE id = ? AND contractId = ?', [fileId, contractId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

        const fullPath = path.join(CONTRACT_UPLOAD_DIR, row.filePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
        }

        db.run('DELETE FROM contract_files WHERE id = ?', [fileId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: '파일 삭제 완료' });
        });
    });
});

module.exports = router;
module.exports.initContractManagementTables = initContractManagementTables;
module.exports.setDb = setDb;
