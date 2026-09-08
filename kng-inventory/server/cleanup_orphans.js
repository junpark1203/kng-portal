/**
 * 직출고 연결 끊긴 고아(유령) 입고 데이터 조회 및 안전 삭제 스크립트
 * 
 * 사용법:
 *   1) 단순 조회 (Dry-run, 데이터 변경 없음):
 *      node cleanup_orphans.js
 * 
 *   2) 실제 삭제 실행:
 *      node cleanup_orphans.js --delete
 * 
 *   3) 특정 DB 파일 지정 시:
 *      node cleanup_orphans.js data/kng.db --delete
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const isDeleteMode = process.argv.includes('--delete');
let customDbPath = process.argv.find(arg => arg !== '--delete' && !arg.endsWith('cleanup_orphans.js') && !arg.endsWith('node'));

// 후보 DB 경로 탐색
const candidates = [
    customDbPath,
    path.join(__dirname, 'data', 'kng.db'),
    path.join(__dirname, 'data', 'logistics.db'),
    path.join(__dirname, 'data.db'),
    path.join(__dirname, 'logistics.db'),
    path.join(__dirname, 'inventory.db'),
    path.join(__dirname, 'database.sqlite')
].filter(Boolean);

let dbPath = null;
for (const p of candidates) {
    if (fs.existsSync(p)) {
        dbPath = p;
        break;
    }
}

if (!dbPath) {
    console.error('❌ SQLite 데이터베이스 파일을 찾을 수 없습니다.');
    console.error('후보 경로 확인 필요:', candidates);
    process.exit(1);
}

console.log('===========================================================');
console.log('🔍 직출고 연결 끊긴 고아 입고 데이터 점검 및 정리 도구');
console.log(`📁 대상 DB: ${path.resolve(dbPath)}`);
console.log(`⚙️  모드: ${isDeleteMode ? '🚨 [실제 삭제 모드 (--delete)]' : '👀 [조회 전용 (Dry-Run)]'}`);
console.log('===========================================================\n');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ DB 연결 실패:', err.message);
        process.exit(1);
    }
    runCleanup();
});

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function runCleanup() {
    try {
        // 1. 고아 직출고 입고 건 조회
        // 조건: logistics_inbound 중 is_direct = 1 이지만,
        //       연결된 출고(logistics_outbound)가 없거나 매핑(logistics_outbound_lots)이 끊어진 건
        const findSql = `
            SELECT 
                i.id,
                SUBSTR(i.date, 1, 10) as date,
                COALESCE(i.transaction_group_id, '-') as tx_id,
                i.supplier,
                i.item,
                COALESCE(i.spec, '-') as spec,
                i.qty_initial as qty,
                i.unit_price as price,
                (i.unit_price * i.qty_initial) as supply_amt,
                COALESCE(i.settlement_status, '미정산') as status,
                i.settlement_month
            FROM logistics_inbound i
            WHERE i.is_direct = 1
              AND NOT EXISTS (
                  SELECT 1 
                  FROM logistics_outbound_lots lol 
                  JOIN logistics_outbound o ON lol.outbound_id = o.id 
                  WHERE lol.inbound_id = i.id
              )
            ORDER BY i.date DESC, i.id DESC
        `;

        const orphanInbounds = await dbAll(findSql);

        // 2. 고아 매핑(Lot) 데이터 조회 (inbound 또는 outbound가 이미 없는데 매핑만 남아있는 경우)
        const orphanLots = await dbAll(`
            SELECT lol.id, lol.outbound_id, lol.inbound_id, lol.consumed_qty
            FROM logistics_outbound_lots lol
            WHERE NOT EXISTS (SELECT 1 FROM logistics_inbound i WHERE i.id = lol.inbound_id)
               OR NOT EXISTS (SELECT 1 FROM logistics_outbound o WHERE o.id = lol.outbound_id)
        `);

        console.log(`📊 점검 결과:`);
        console.log(` - 연결 끊긴 직출고 입고 데이터: ${orphanInbounds.length}건`);
        console.log(` - 끊어진 고아 Lot 매핑 데이터: ${orphanLots.length}건\n`);

        if (orphanInbounds.length === 0 && orphanLots.length === 0) {
            console.log('✅ 축하합니다! 현재 DB에 연결이 끊긴 고아 데이터가 없습니다.');
            db.close();
            return;
        }

        if (orphanInbounds.length > 0) {
            console.log('📋 [연결 끊긴 직출고 입고 목록 (매출처가 없는 유령 데이터)]:');
            console.table(orphanInbounds.map(r => ({
                'ID': r.id,
                '일자': r.date,
                '전표번호': r.tx_id,
                '입고처': r.supplier,
                '품명': r.item,
                '수량': r.qty,
                '단가': Number(r.price).toLocaleString(),
                '공급가액': Number(r.supply_amt).toLocaleString() + '원',
                '정산상태': r.status,
                '확정월': r.settlement_month || '-'
            })));
        }

        if (!isDeleteMode) {
            console.log('\n💡 [안내] 현재는 조회 전용 모드입니다. 데이터베이스가 변경되지 않았습니다.');
            console.log('👉 위의 고아 데이터를 실제로 삭제 정리하려면 아래 명령어를 실행하세요:');
            console.log(`   node ${path.basename(__filename)} --delete\n`);
            db.close();
            return;
        }

        // 실제 삭제 진행
        console.log('\n🚨 실제 삭제 처리를 시작합니다...');

        // 월간 확정건 처리 (force 옵션 지원)
        const isForceMode = process.argv.includes('--force');
        const targetInbounds = isForceMode ? orphanInbounds : orphanInbounds.filter(r => !r.settlement_month);
        const lockedInbounds = orphanInbounds.filter(r => !!r.settlement_month);

        if (lockedInbounds.length > 0) {
            if (!isForceMode) {
                console.warn(`⚠️ 경고: ${lockedInbounds.length}건은 월간현황에 이미 확정되어 있어 안전을 위해 삭제 대상에서 제외되었습니다.`);
                console.warn(`👉 확정 건까지 강제로 삭제하려면 --force 옵션을 함께 사용하세요: node cleanup_orphans.js --delete --force\n`);
            } else {
                console.warn(`🚨 알림: --force 옵션이 지정되어 월간 확정된 ${lockedInbounds.length}건을 포함하여 강제 삭제를 진행합니다.\n`);
            }
        }

        await dbRun("BEGIN TRANSACTION");

        let deletedInboundCount = 0;
        let deletedLotCount = 0;

        // 1) 대상 Inbound와 연결된 Lot 정리
        if (targetInbounds.length > 0) {
            const inIds = targetInbounds.map(r => r.id);
            const inPlaceholders = inIds.map(() => '?').join(',');

            await dbRun(`DELETE FROM logistics_outbound_lots WHERE inbound_id IN (${inPlaceholders})`, inIds);

            // Inbound 삭제
            const delRes = await dbRun(`DELETE FROM logistics_inbound WHERE id IN (${inPlaceholders})`, inIds);
            deletedInboundCount = delRes.changes || inIds.length;
        }

        // 2) 끊어진 고아 Lot 매핑 정리
        if (orphanLots.length > 0) {
            const lotIds = orphanLots.map(l => l.id);
            const lotPlaceholders = lotIds.map(() => '?').join(',');
            const delLotRes = await dbRun(`DELETE FROM logistics_outbound_lots WHERE id IN (${lotPlaceholders})`, lotIds);
            deletedLotCount = delLotRes.changes || lotIds.length;
        }

        await dbRun("COMMIT");

        console.log('\n🎉 정리 완료!');
        console.log(` - 삭제된 고아 직출고 입고 건: ${deletedInboundCount}건`);
        if (deletedLotCount > 0) console.log(` - 정리된 고아 Lot 매핑 건: ${deletedLotCount}건`);
        console.log('이제 매입정산 화면을 새로고침(Ctrl + F5)하시면 매출처 없는 유령 데이터가 사라집니다.\n');

        db.close();
    } catch (err) {
        try { await dbRun("ROLLBACK"); } catch (e) {}
        console.error('❌ 정리 작업 중 오류 발생:', err);
        db.close();
        process.exit(1);
    }
}
