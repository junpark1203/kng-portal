const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    console.log('--- Starting migration: settlement_month ---');
    
    // 1. logistics_inbound에 settlement_month 컬럼 추가
    db.run("ALTER TABLE logistics_inbound ADD COLUMN settlement_month TEXT DEFAULT ''", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('logistics_inbound: settlement_month column already exists.');
            } else {
                console.error('Error adding settlement_month to inbound:', err.message);
            }
        } else {
            console.log('Added settlement_month to logistics_inbound successfully.');
        }
    });

    // 2. logistics_outbound에 settlement_month 컬럼 추가
    db.run("ALTER TABLE logistics_outbound ADD COLUMN settlement_month TEXT DEFAULT ''", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('logistics_outbound: settlement_month column already exists.');
            } else {
                console.error('Error adding settlement_month to outbound:', err.message);
            }
        } else {
            console.log('Added settlement_month to logistics_outbound successfully.');
        }
    });

    // 3. 기존 '정산완료' 데이터에 대해 tax_invoice_date 또는 date 기준으로 settlement_month 초기화
    db.run(`
        UPDATE logistics_inbound 
        SET settlement_month = SUBSTR(COALESCE(NULLIF(tax_invoice_date, ''), date), 1, 7)
        WHERE (settlement_month IS NULL OR settlement_month = '')
          AND settlement_status = '정산완료'
    `, function(err) {
        if (err) console.error('Error migrating inbound settlement_month:', err.message);
        else console.log(`Migrated ${this.changes} rows in logistics_inbound.`);
    });

    db.run(`
        UPDATE logistics_outbound 
        SET settlement_month = SUBSTR(COALESCE(NULLIF(tax_invoice_date, ''), date), 1, 7)
        WHERE (settlement_month IS NULL OR settlement_month = '')
          AND settlement_status = '정산완료'
    `, function(err) {
        if (err) console.error('Error migrating outbound settlement_month:', err.message);
        else console.log(`Migrated ${this.changes} rows in logistics_outbound.`);
    });
});

db.close(() => {
    console.log('--- Migration completed ---');
});
