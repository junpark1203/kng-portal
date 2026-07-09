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

// ── KST Helper ──
function getKSTDate() {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    return new Date(now.getTime() + kstOffset).toISOString().replace('Z', '+09:00');
}

/**
 * Initialize Tables — v2 (계약 품목 + 상태/만료일/Incoterms 확장)
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
                    amount REAL DEFAULT 0,
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
            });

            // contract_items table (v2 — 계약 품목)
            db.run(`
                CREATE TABLE IF NOT EXISTS contract_items (
                    id TEXT PRIMARY KEY,
                    contractId TEXT,
                    itemName TEXT,
                    specification TEXT,
                    quantity REAL DEFAULT 0,
                    unit TEXT DEFAULT 'EA',
                    unitPrice REAL DEFAULT 0,
                    amount REAL DEFAULT 0,
                    currency TEXT DEFAULT '',
                    prices TEXT DEFAULT '[]',
                    hsCode TEXT,
                    remarks TEXT,
                    sortOrder INTEGER DEFAULT 0,
                    FOREIGN KEY (contractId) REFERENCES contracts(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) {
                    console.error('contract_items 테이블 생성 오류:', err);
                }
            });

            // Add columns if they don't exist (safe migration)
            const migrations = [
                "ALTER TABLE contracts ADD COLUMN buyerRole TEXT DEFAULT 'Party A'",
                "ALTER TABLE contracts ADD COLUMN sellerRole TEXT DEFAULT 'Party B'",
                "ALTER TABLE contracts ADD COLUMN status TEXT DEFAULT '초안'",
                "ALTER TABLE contracts ADD COLUMN expiryDate TEXT DEFAULT ''",
                "ALTER TABLE contracts ADD COLUMN autoRenewal INTEGER DEFAULT 0",
                "ALTER TABLE contracts ADD COLUMN incoterms TEXT DEFAULT ''",
                "ALTER TABLE contract_items ADD COLUMN currency TEXT DEFAULT ''",
                "ALTER TABLE contract_items ADD COLUMN prices TEXT DEFAULT '[]'"
            ];

            let completed = 0;
            migrations.forEach(sql => {
                db.run(sql, () => {
                    completed++;
                    if (completed === migrations.length) {
                        console.log('Contract Management v2 테이블 확인 완료');
                        resolve();
                    }
                });
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

// Get all contracts (with file count AND item count + multi-currency totals)
router.get('/', (req, res) => {
    db.all(`
        SELECT c.*, 
        (SELECT COUNT(*) FROM contract_files cf WHERE cf.contractId = c.id) as fileCount,
        (SELECT COUNT(*) FROM contract_items ci WHERE ci.contractId = c.id) as itemCount
        FROM contracts c 
        ORDER BY c.createdAt DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.all(`SELECT contractId, currency, amount, prices FROM contract_items`, [], (err, itemTotals) => {
            if (err) return res.status(500).json({ error: err.message });
            
            const totalsMap = {};
            itemTotals.forEach(it => {
                if (!totalsMap[it.contractId]) totalsMap[it.contractId] = {};
                
                let parsedPrices = [];
                try {
                    parsedPrices = JSON.parse(it.prices || '[]');
                } catch(e) {}
                
                if (parsedPrices.length === 0 && it.currency) {
                    parsedPrices.push({ currency: it.currency, amount: it.amount });
                }
                
                parsedPrices.forEach(p => {
                    const cur = p.currency || 'KRW';
                    totalsMap[it.contractId][cur] = (totalsMap[it.contractId][cur] || 0) + (parseFloat(p.amount) || 0);
                });
            });
            
            rows.forEach(r => {
                r.multiTotals = totalsMap[r.id] || {};
            });
            res.json(rows);
        });
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

// Get single contract with its files AND items
router.get('/:id', (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM contracts WHERE id = ?', [id], (err, contract) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!contract) return res.status(404).json({ error: '계약 건을 찾을 수 없습니다.' });

        db.all('SELECT * FROM contract_files WHERE contractId = ? ORDER BY uploadedAt DESC', [id], (err, files) => {
            if (err) return res.status(500).json({ error: err.message });
            contract.files = files || [];

            db.all('SELECT * FROM contract_items WHERE contractId = ? ORDER BY sortOrder ASC, rowid ASC', [id], (err, items) => {
                if (err) return res.status(500).json({ error: err.message });
                contract.items = items || [];
                res.json(contract);
            });
        });
    });
});

// Create new contract (with items)
router.post('/', (req, res) => {
    const p = req.body;
    const id = 'CTR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const kstDate = getKSTDate();

    // Calculate total from items
    const items = p.items || [];
    const totalAmount = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

    const sql = `
        INSERT INTO contracts (
            id, contractNo, title, buyerRole, buyer, sellerRole, seller, type, 
            status, amount, currency, effectiveDate, expiryDate, autoRenewal,
            paymentTerms, incoterms, pic, remarks, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        id, p.contractNo || '', p.title || '', 
        p.buyerRole || 'Party A', p.buyer || '', 
        p.sellerRole || 'Party B', p.seller || '', 
        p.type || '기타', p.status || '초안',
        totalAmount, p.currency || 'KRW', 
        p.effectiveDate || '', p.expiryDate || '', 
        p.autoRenewal ? 1 : 0,
        p.paymentTerms || '', p.incoterms || '',
        p.pic || '', p.remarks || '', kstDate, kstDate
    ];

    db.run(sql, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed: contracts.contractNo')) {
                return res.status(400).json({ error: '이미 존재하는 계약번호입니다.' });
            }
            return res.status(500).json({ error: err.message });
        }

        // Insert items
        if (items.length > 0) {
            const itemSql = `INSERT INTO contract_items (id, contractId, itemName, specification, quantity, unit, unitPrice, amount, currency, prices, hsCode, remarks, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            items.forEach((it, idx) => {
                const itemId = 'CI-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
                const pricesJson = JSON.stringify(it.prices || []);
                const firstPrice = (it.prices && it.prices.length > 0) ? it.prices[0] : {};
                db.run(itemSql, [
                    itemId, id, it.itemName || '', it.specification || '',
                    parseFloat(it.quantity) || 0, it.unit || 'EA',
                    parseFloat(firstPrice.price) || 0, parseFloat(firstPrice.amount) || 0,
                    firstPrice.currency || '', pricesJson,
                    it.hsCode || '', it.remarks || '', idx
                ]);
            });
        }

        res.status(201).json({ message: '계약 등록 성공', id: id, contractNo: p.contractNo, createdAt: kstDate });
    });
});

// Update contract (with items — delete-then-insert strategy)
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const kstDate = getKSTDate();

    const items = p.items || [];
    const totalAmount = items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);

    const sql = `
        UPDATE contracts SET 
            contractNo=?, title=?, buyerRole=?, buyer=?, sellerRole=?, seller=?, type=?, 
            status=?, amount=?, currency=?, effectiveDate=?, expiryDate=?, autoRenewal=?,
            paymentTerms=?, incoterms=?, pic=?, remarks=?, updatedAt=?
        WHERE id=?
    `;
    const params = [
        p.contractNo || '', p.title || '', 
        p.buyerRole || 'Party A', p.buyer || '', 
        p.sellerRole || 'Party B', p.seller || '', 
        p.type || '기타', p.status || '초안',
        totalAmount, p.currency || 'KRW', 
        p.effectiveDate || '', p.expiryDate || '', 
        p.autoRenewal ? 1 : 0,
        p.paymentTerms || '', p.incoterms || '',
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

        // Re-insert items (delete old → insert new)
        db.run('DELETE FROM contract_items WHERE contractId = ?', [id], () => {
            if (items.length > 0) {
                const itemSql = `INSERT INTO contract_items (id, contractId, itemName, specification, quantity, unit, unitPrice, amount, currency, prices, hsCode, remarks, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
                items.forEach((it, idx) => {
                    const itemId = 'CI-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6) + idx;
                    const pricesJson = JSON.stringify(it.prices || []);
                    const firstPrice = (it.prices && it.prices.length > 0) ? it.prices[0] : {};
                    db.run(itemSql, [
                        itemId, id, it.itemName || '', it.specification || '',
                        parseFloat(it.quantity) || 0, it.unit || 'EA',
                        parseFloat(firstPrice.price) || 0, parseFloat(firstPrice.amount) || 0,
                        firstPrice.currency || '', pricesJson,
                        it.hsCode || '', it.remarks || '', idx
                    ]);
                });
            }
            res.json({ message: '수정 성공', updatedAt: kstDate });
        });
    });
});

// Delete contract (and files + items)
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
        
        // 2. Delete items, files, and contract
        db.run('DELETE FROM contract_items WHERE contractId = ?', [id], () => {
            db.run('DELETE FROM contract_files WHERE contractId = ?', [id], () => {
                db.run('DELETE FROM contracts WHERE id = ?', [id], function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: '계약건을 찾을 수 없습니다.' });
                    res.json({ message: '삭제 성공' });
                });
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
    const kstDate = getKSTDate();

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
                fileSize: req.file.size,
                fileType: ext,
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
