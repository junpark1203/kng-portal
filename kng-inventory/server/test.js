const sqlite3 = require('sqlite3').verbose(); 
const db = new sqlite3.Database('./data/kng.db'); 
db.serialize(() => {
    db.run("DROP TABLE IF EXISTS supply_history");
    db.run(`
        CREATE TABLE supply_history (
            id TEXT PRIMARY KEY,
            supplyDate TEXT,
            site TEXT,
            supplier TEXT,
            manufacturer TEXT,
            item TEXT,
            qty INTEGER,
            price INTEGER,
            total INTEGER,
            category TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `, (err) => {
        if (err) console.error("CREATE ERROR:", err);
        else console.log("supply_history table successfully recreated.");
    });
});
