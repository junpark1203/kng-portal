const sqlite3 = require('sqlite3'); 
const db = new sqlite3.Database('./data/kng.db'); 
db.all("SELECT '입고' as type, date, item, spec, unit, qty_initial as qty, unit_price as price, is_direct, note, id FROM logistics_inbound LIMIT 1", (err, rows) => { 
    console.log('IN ERR:', err ? err.message : null); 
    console.log('IN ROWS:', rows); 
}); 
db.all("SELECT '출고' as type, date, item, spec, unit, qty, selling_price as price, is_direct, note, id FROM logistics_outbound LIMIT 1", (err, rows) => { 
    console.log('OUT ERR:', err ? err.message : null); 
    console.log('OUT ROWS:', rows); 
});
