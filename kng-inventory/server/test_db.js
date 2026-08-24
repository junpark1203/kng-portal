const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./data/kng.db');
const sql = `SELECT * FROM (
    SELECT 'inbound' as type, i.id, i.date, i.supplier as party, NULL as actual_destination, i.item, i.spec, i.unit, 
    i.qty_initial as qty, i.unit_price as price, 0 as shipping_fee, i.note, i.created_at, i.is_direct 
    FROM logistics_inbound i 
    UNION ALL 
    SELECT 'outbound' as type, o.id, o.date, o.destination as party, o.actual_destination, o.item, o.spec, o.unit, 
    o.qty as qty, o.selling_price as price, o.shipping_fee, '' as note, o.created_at, o.is_direct 
    FROM logistics_outbound o
) ORDER BY date DESC, created_at DESC LIMIT 50 OFFSET 0`;

db.all(sql, (err, rows) => {
    if (err) console.error("Error:", err.message);
    else console.log("Rows fetched:", rows.length);
});
