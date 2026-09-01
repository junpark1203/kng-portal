const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    db.run("ALTER TABLE logistics_inbound ADD COLUMN settlement_memo TEXT", (err) => console.log('added inbound settlement_memo', err ? err.message : 'ok'));
    db.run("ALTER TABLE logistics_outbound ADD COLUMN settlement_memo TEXT", (err) => console.log('added outbound settlement_memo', err ? err.message : 'ok'));
});
