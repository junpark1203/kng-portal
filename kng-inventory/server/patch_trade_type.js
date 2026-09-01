const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    db.run("ALTER TABLE logistics_inbound ADD COLUMN trade_type TEXT DEFAULT '내수'", (err) => console.log('added inbound trade_type', err ? err.message : 'ok'));
    db.run("ALTER TABLE logistics_outbound ADD COLUMN trade_type TEXT DEFAULT '내수'", (err) => console.log('added outbound trade_type', err ? err.message : 'ok'));
});
