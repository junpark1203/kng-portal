// ========================================
// SmartStore Mass Upload — DB 초기화
// 기존 kng.db에 mu_ prefix 테이블 추가
// ========================================

function initMassUploadTables(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 상품 테이블 — data 컬럼에 전체 상품 JSON 저장
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_products (
                    id TEXT PRIMARY KEY,
                    code TEXT UNIQUE,
                    data TEXT NOT NULL,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `);

            // 배송 프리셋
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_presets (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updatedAt TEXT
                )
            `);

            // 주소
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_addresses (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updatedAt TEXT
                )
            `);

            // 설정값 (key-value)
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
            `);

            // 시퀀스 카운터 (날짜별)
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_sequences (
                    dateKey TEXT PRIMARY KEY,
                    seq INTEGER DEFAULT 0
                )
            `);

            // 엑스포트 카트
            db.run(`
                CREATE TABLE IF NOT EXISTS mu_export_cart (
                    productId TEXT PRIMARY KEY
                )
            `, (err) => {
                if (err) {
                    console.error('mu_ 테이블 생성 오류:', err.message);
                    reject(err);
                } else {
                    console.log('mass_upload 테이블 초기화 완료');
                    resolve();
                }
            });
        });
    });
}

module.exports = { initMassUploadTables };
