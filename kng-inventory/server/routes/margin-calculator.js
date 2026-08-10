const express = require('express');
const router = express.Router();

let db;

function setDb(database) {
    db = database;
}

function initMarginCalculatorTables(database) {
    db = database;
    return new Promise((resolve, reject) => {
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS margin_calculator_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                productName TEXT NOT NULL,
                buyPrice INTEGER NOT NULL,
                buyShipping INTEGER NOT NULL,
                salePrice INTEGER NOT NULL,
                saleShipping INTEGER NOT NULL,
                marginAmount INTEGER NOT NULL,
                marginRate REAL NOT NULL,
                commission INTEGER NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;
        db.run(createTableQuery, (err) => {
            if (err) {
                console.error('Error creating margin_calculator_history table:', err.message);
                reject(err);
            } else {
                // Add new columns for load feature if they don't exist
                const alterQueries = [
                    'ALTER TABLE margin_calculator_history ADD COLUMN extraCost INTEGER DEFAULT 0',
                    'ALTER TABLE margin_calculator_history ADD COLUMN buyPriceVat INTEGER DEFAULT 0',
                    'ALTER TABLE margin_calculator_history ADD COLUMN buyShippingVat INTEGER DEFAULT 0',
                    'ALTER TABLE margin_calculator_history ADD COLUMN extraCostVat INTEGER DEFAULT 0',
                    'ALTER TABLE margin_calculator_history ADD COLUMN saleVatIncluded INTEGER DEFAULT 1'
                ];
                alterQueries.forEach(q => {
                    db.run(q, (alterErr) => { /* Ignore errors as column might already exist */ });
                });

                console.log('margin_calculator_history table ready.');
                resolve();
            }
        });
    });
}

// GET: 저장된 전체 목록 조회
router.get('/', (req, res) => {
    const query = `SELECT * FROM margin_calculator_history ORDER BY createdAt DESC`;
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to fetch history' });
        }
        res.json(rows);
    });
});

// POST: 새로운 계산 내역 저장
router.post('/', (req, res) => {
    const { 
        productName, buyPrice, buyShipping, extraCost, 
        buyPriceVat, buyShippingVat, extraCostVat, 
        salePrice, saleShipping, saleVatIncluded, 
        marginAmount, marginRate, commission 
    } = req.body;
    
    if (!productName) {
        return res.status(400).json({ error: 'Product name is required' });
    }

    const query = `
        INSERT INTO margin_calculator_history 
        (productName, buyPrice, buyShipping, extraCost, buyPriceVat, buyShippingVat, extraCostVat, salePrice, saleShipping, saleVatIncluded, marginAmount, marginRate, commission)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        productName, buyPrice, buyShipping, extraCost || 0, 
        buyPriceVat || 0, buyShippingVat || 0, extraCostVat || 0, 
        salePrice, saleShipping, saleVatIncluded === undefined ? 1 : saleVatIncluded, 
        marginAmount, marginRate, commission
    ];

    db.run(query, params, function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to save history' });
        }
        res.status(201).json({ id: this.lastID });
    });
});

// DELETE: 특정 내역 삭제
router.delete('/:id', (req, res) => {
    const id = req.params.id;
    const query = `DELETE FROM margin_calculator_history WHERE id = ?`;
    
    db.run(query, [id], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to delete history' });
        }
        res.json({ deleted: this.changes });
    });
});

module.exports = { router, initMarginCalculatorTables, setDb };
