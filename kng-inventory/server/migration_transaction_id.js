const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/kng.db');

db.serialize(() => {
    // 1. 컬럼 추가
    db.run("ALTER TABLE logistics_inbound ADD COLUMN transaction_group_id TEXT", (err) => {
        if (err) console.log("inbound transaction_group_id column already exists or error: ", err.message);
        else console.log("Added transaction_group_id to logistics_inbound");
    });
    db.run("ALTER TABLE logistics_outbound ADD COLUMN transaction_group_id TEXT", (err) => {
        if (err) console.log("outbound transaction_group_id column already exists or error: ", err.message);
        else console.log("Added transaction_group_id to logistics_outbound");
    });

    // 2. 백필 로직
    const updateRecords = (tableName, partnerCol, prefix) => {
        db.all(`SELECT id, date, ${partnerCol} as partner FROM ${tableName} ORDER BY date ASC, id ASC`, [], (err, rows) => {
            if (err) {
                console.error(`Error reading ${tableName}:`, err.message);
                return;
            }

            // date 별로 counter 유지
            const counters = {};
            // date+partner 묶음별로 ID 캐싱
            const groupIds = {};

            const updateStmt = db.prepare(`UPDATE ${tableName} SET transaction_group_id = ? WHERE id = ?`);

            db.serialize(() => {
                db.run("BEGIN TRANSACTION");
                rows.forEach(row => {
                    const dateStr = (row.date || '').substring(0, 10).replace(/-/g, ''); // YYYYMMDD
                    if (!dateStr) return; // skip if no date

                    const groupKey = `${dateStr}_${row.partner}`;
                    let txId = groupIds[groupKey];

                    if (!txId) {
                        // 새 그룹이면 카운터 증가 및 ID 발급
                        if (!counters[dateStr]) counters[dateStr] = 0;
                        counters[dateStr]++;
                        const seq = String(counters[dateStr]).padStart(3, '0');
                        txId = `${prefix}-${dateStr}-${seq}`;
                        groupIds[groupKey] = txId;
                    }

                    updateStmt.run(txId, row.id);
                });
                updateStmt.finalize();
                db.run("COMMIT", (err) => {
                    if (err) console.error(`Error committing ${tableName}:`, err.message);
                    else console.log(`Backfilled transaction_group_id for ${tableName}`);
                });
            });
        });
    };

    // 입출고 백필 실행
    setTimeout(() => {
        updateRecords('logistics_inbound', 'supplier', 'IN');
        updateRecords('logistics_outbound', 'destination', 'OUT');
    }, 1000);
});
