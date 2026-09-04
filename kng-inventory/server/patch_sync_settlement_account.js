const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'kng.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Failed to open database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database:', dbPath);
});

db.serialize(() => {
    console.log('--- 1:1 매칭(직송/로트 연결) 건의 계정과목(settlement_account) 상호 동기화 시작 ---');

    // 1. 매입(inbound)에 계정이 있고 매출(outbound)에 없거나 비어있는 경우 동기화
    db.run(`
        UPDATE logistics_outbound
        SET settlement_account = (
            SELECT i.settlement_account
            FROM logistics_outbound_lots lol
            JOIN logistics_inbound i ON lol.inbound_id = i.id
            WHERE lol.outbound_id = logistics_outbound.id
              AND i.settlement_account IS NOT NULL 
              AND i.settlement_account != ''
            LIMIT 1
        )
        WHERE (settlement_account IS NULL OR settlement_account = '')
          AND EXISTS (
            SELECT 1 
            FROM logistics_outbound_lots lol
            JOIN logistics_inbound i ON lol.inbound_id = i.id
            WHERE lol.outbound_id = logistics_outbound.id
              AND i.settlement_account IS NOT NULL 
              AND i.settlement_account != ''
          )
    `, function(err) {
        if (err) {
            console.error('Error syncing inbound -> outbound accounts:', err.message);
        } else {
            console.log(`[매입 -> 매출 동기화 완료]: ${this.changes}건 업데이트됨`);
        }
    });

    // 2. 매출(outbound)에 계정이 있고 매입(inbound)에 없거나 비어있는 경우 동기화
    db.run(`
        UPDATE logistics_inbound
        SET settlement_account = (
            SELECT o.settlement_account
            FROM logistics_outbound_lots lol
            JOIN logistics_outbound o ON lol.outbound_id = o.id
            WHERE lol.inbound_id = logistics_inbound.id
              AND o.settlement_account IS NOT NULL 
              AND o.settlement_account != ''
            LIMIT 1
        )
        WHERE (settlement_account IS NULL OR settlement_account = '')
          AND EXISTS (
            SELECT 1 
            FROM logistics_outbound_lots lol
            JOIN logistics_outbound o ON lol.outbound_id = o.id
            WHERE lol.inbound_id = logistics_inbound.id
              AND o.settlement_account IS NOT NULL 
              AND o.settlement_account != ''
          )
    `, function(err) {
        if (err) {
            console.error('Error syncing outbound -> inbound accounts:', err.message);
        } else {
            console.log(`[매출 -> 매입 동기화 완료]: ${this.changes}건 업데이트됨`);
        }
    });

    // 3. 둘 다 있지만 서로 불일치하는 경우, 최신 정산된 값 기준으로 통일
    db.run(`
        UPDATE logistics_outbound
        SET settlement_account = (
            SELECT i.settlement_account
            FROM logistics_outbound_lots lol
            JOIN logistics_inbound i ON lol.inbound_id = i.id
            WHERE lol.outbound_id = logistics_outbound.id
              AND i.settlement_account IS NOT NULL 
              AND i.settlement_account != ''
            LIMIT 1
        )
        WHERE settlement_account IS NOT NULL 
          AND settlement_account != ''
          AND EXISTS (
            SELECT 1 
            FROM logistics_outbound_lots lol
            JOIN logistics_inbound i ON lol.inbound_id = i.id
            WHERE lol.outbound_id = logistics_outbound.id
              AND i.settlement_account IS NOT NULL 
              AND i.settlement_account != ''
              AND i.settlement_account != logistics_outbound.settlement_account
          )
    `, function(err) {
        if (err) {
            console.error('Error unifying mismatched accounts:', err.message);
        } else {
            console.log(`[불일치 계정 일치 완료]: ${this.changes}건 동기화됨`);
        }
        db.close(() => {
            console.log('Database connection closed.');
        });
    });
});
