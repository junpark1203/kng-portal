const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('c:/DEV/KNG WEBPAGE_20260505/kng-inventory/server/data/kng.db');
const type = 'inbound';
const baseSql = `
    WITH combined AS (
        SELECT 
            'inbound' as type, i.id, i.date, 
            i.supplier as supplier, NULL as destination, 
            NULL as actual_destination, i.item, i.spec, i.unit, 
            i.qty_initial as qty, 
            i.unit_price as inbound_price, NULL as outbound_price,
            (i.unit_price * i.qty_initial) as inbound_total, NULL as outbound_total,
            0 as shipping_fee, 0 as shipping_fee_vat_included, i.note, i.created_at,
            i.is_direct, i.settlement_status, i.tax_invoice_date, i.is_zero_tax
        FROM logistics_inbound i
        ${type === 'inbound' ? '' : 'WHERE i.is_direct = 0'}
        UNION ALL
        SELECT 
            'outbound' as type, o.id, o.date, 
            CASE WHEN o.is_direct = 1 THEN di.supplier ELSE NULL END as supplier, 
            o.destination as destination, 
            o.actual_destination, o.item, o.spec, o.unit, 
            o.qty as qty, 
            CASE WHEN o.is_direct = 1 THEN di.unit_price ELSE NULL END as inbound_price, 
            o.selling_price as outbound_price, 
            CASE WHEN o.is_direct = 1 THEN (di.unit_price * o.qty) ELSE NULL END as inbound_total,
            (o.selling_price * o.qty) as outbound_total,
            o.shipping_fee, o.shipping_fee_vat_included, o.note, o.created_at,
            o.is_direct, o.settlement_status, o.tax_invoice_date, o.is_zero_tax
        FROM logistics_outbound o
        LEFT JOIN logistics_outbound_lots dl ON o.is_direct = 1 AND dl.outbound_id = o.id
        LEFT JOIN logistics_inbound di ON dl.inbound_id = di.id
    )
    SELECT * FROM combined
    WHERE type = 'inbound' AND is_direct = 1
`;
db.all(baseSql, [], (err, rows) => {
    if(err) console.error(err);
    else console.log(rows.length + ' direct inbounds found.');
});
