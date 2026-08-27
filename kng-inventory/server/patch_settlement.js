const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    db.run("ALTER TABLE logistics_inbound ADD COLUMN settlement_qty REAL", (err) => console.log('added inbound qty', err ? err.message : 'ok'));
    db.run("ALTER TABLE logistics_inbound ADD COLUMN settlement_price REAL", (err) => console.log('added inbound price', err ? err.message : 'ok'));
    db.run("ALTER TABLE logistics_outbound ADD COLUMN settlement_qty REAL", (err) => console.log('added outbound qty', err ? err.message : 'ok'));
    db.run("ALTER TABLE logistics_outbound ADD COLUMN settlement_price REAL", (err) => console.log('added outbound price', err ? err.message : 'ok'));
});
