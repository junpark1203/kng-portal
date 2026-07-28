const express = require('express');
const router = express.Router();

let db;

const setDb = (dbInstance) => {
    db = dbInstance;
};

// DB 조회 헬퍼
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
}

router.get('/summary', async (req, res) => {
    try {
        // 1. 진행중인 지출결의서
        const pendingExpenses = await dbAll(`
            SELECT id, title, amount, status, createdAt, personInCharge 
            FROM expense_resolutions 
            WHERE status NOT IN ('결재보류', '결재완료')
            ORDER BY createdAt DESC
        `);

        // 2. 진행중인 전시회 참관 보고서
        const pendingExhibitions = await dbAll(`
            SELECT id, exhibitionName, visitDate, status, createdAt 
            FROM exhibition_reports 
            WHERE status NOT IN ('결재보류', '결재완료')
            ORDER BY createdAt DESC
        `);

        // 3. 진행중인 인보이스/팩킹리스트
        const pendingInvoices = await dbAll(`
            SELECT id, invoiceNo, docDate, shipper, consignee, status, createdAt 
            FROM invoice_packing_docs 
            WHERE status != '완료'
            ORDER BY createdAt DESC
        `);

        // 4. 안전재고 미달 상품 (재고 5 이하)
        const lowStockHqProducts = await dbAll(`
            SELECT id, supplier, brand, name, color, size, stock 
            FROM hq_products 
            WHERE stock <= 5
            ORDER BY stock ASC
            LIMIT 10
        `);

        // 5. 셀러K 최근 수정 항목 (5일 이내)
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
        const recentSellerKProducts = await dbAll(`
            SELECT id, supplier, brand, name, color, size, updatedAt 
            FROM seller_k_products 
            WHERE updatedAt >= ?
            ORDER BY updatedAt DESC
            LIMIT 15
        `, [fiveDaysAgo.toISOString()]);

        res.json({
            pendingExpenses,
            pendingExhibitions,
            pendingInvoices: pendingInvoices.map(inv => {
                try { inv.shipper = JSON.parse(inv.shipper || '{}'); } catch(e) { inv.shipper = {}; }
                try { inv.consignee = JSON.parse(inv.consignee || '{}'); } catch(e) { inv.consignee = {}; }
                return inv;
            }),
            lowStockHqProducts,
            recentSellerKProducts
        });
    } catch (err) {
        console.error('대시보드 에러:', err);
        res.status(500).json({ error: '대시보드 데이터를 불러오는데 실패했습니다.' });
    }
});

module.exports = { router, setDb };
