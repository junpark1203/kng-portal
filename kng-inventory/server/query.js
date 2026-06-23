const sqlite3 = require('./node_modules/sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

db.all("SELECT * FROM hq_transactions WHERE type='OUT' AND txDate='2026-05-18'", (err, rows) => {
    if (err) console.error(err);
    else console.log(JSON.stringify(rows, null, 2));
});
