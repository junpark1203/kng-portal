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
    const { productName, buyPrice, buyShipping, salePrice, saleShipping, marginAmount, marginRate, commission } = req.body;
    
    if (!productName) {
        return res.status(400).json({ error: 'Product name is required' });
    }

    const query = `
        INSERT INTO margin_calculator_history (productName, buyPrice, buyShipping, salePrice, saleShipping, marginAmount, marginRate, commission)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [productName, buyPrice, buyShipping, salePrice, saleShipping, marginAmount, marginRate, commission];

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
