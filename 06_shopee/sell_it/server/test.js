const sqlite3 = require('sqlite3');
const path = require('path');
const dbFile = path.join(__dirname, 'data', 'sell_it.db');
const db = new sqlite3.Database(dbFile);
db.all("SELECT * FROM market_exports WHERE marketCode='global'", (err, rows) => {
    if (err) console.error("ERROR:", err.message);
    else console.log(JSON.stringify(rows, null, 2));
});
