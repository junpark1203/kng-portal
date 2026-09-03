const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    db.run("ALTER TABLE logistics_inbound ADD COLUMN settlement_account TEXT DEFAULT ''", (err) => {
        console.log('Added settlement_account to logistics_inbound:', err ? err.message : 'OK');
    });
    db.run("ALTER TABLE logistics_outbound ADD COLUMN settlement_account TEXT DEFAULT ''", (err) => {
        console.log('Added settlement_account to logistics_outbound:', err ? err.message : 'OK');
    });
});
