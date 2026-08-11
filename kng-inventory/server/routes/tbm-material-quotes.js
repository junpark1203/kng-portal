const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

function initMaterialQuotesTables(database) {
    return new Promise((resolve, reject) => {
        database.serialize(() => {
            database.run(`
                CREATE TABLE IF NOT EXISTS tbm_quote_documents (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    status TEXT,
                    data TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
}

function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params || [], function (err) {
            if (err) reject(err); else resolve(this);
        });
    });
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Get all documents (list)
router.get('/', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT id, title, status, createdAt, updatedAt FROM tbm_quote_documents ORDER BY createdAt DESC`);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// Get a single document
router.get('/:id', async (req, res) => {
    try {
        const rows = await dbAll(`SELECT * FROM tbm_quote_documents WHERE id = ?`, [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Document not found' });
        
        const doc = rows[0];
        const dataObj = JSON.parse(doc.data || '{}');
        
        res.json({
            id: doc.id,
            title: doc.title,
            status: doc.status,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            suppliers: dataObj.suppliers || [],
            items: dataObj.items || []
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch document' });
    }
});

// Create a new document
router.post('/', async (req, res) => {
    try {
        const { title, status, suppliers, items } = req.body;
        const id = 'tq_' + generateId();
        const now = new Date().toISOString();
        const dataStr = JSON.stringify({ suppliers, items });
        
        await dbRun(
            `INSERT INTO tbm_quote_documents (id, title, status, data, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, title, status, dataStr, now, now]
        );
        
        res.json({ id, message: 'Saved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save document' });
    }
});

// Update a document
router.put('/:id', async (req, res) => {
    try {
        const { title, status, suppliers, items } = req.body;
        const now = new Date().toISOString();
        const dataStr = JSON.stringify({ suppliers, items });
        
        await dbRun(
            `UPDATE tbm_quote_documents SET title = ?, status = ?, data = ?, updatedAt = ? WHERE id = ?`,
            [title, status, dataStr, now, req.params.id]
        );
        
        res.json({ message: 'Updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update document' });
    }
});

// Delete a document
router.delete('/:id', async (req, res) => {
    try {
        await dbRun(`DELETE FROM tbm_quote_documents WHERE id = ?`, [req.params.id]);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

module.exports = { router, setDb, initMaterialQuotesTables };
