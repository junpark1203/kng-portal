const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/sell_it.db');
db.run("UPDATE market_exports SET exchangeRate = 1.0 / exchangeRate WHERE exchangeRate > 1", function(err) {
    if (err) console.error(err);
    else console.log('Updated ' + this.changes + ' rows');
});
