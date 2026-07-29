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
            SELECT id, title, amount, currency, status, createdAt, personInCharge 
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

        // 6. 나의 최근 업무일지 (어제 작성분 등 가장 최근 제출된 문서)
        const authorId = req.user ? (req.user.email || req.user.uid) : null;
        let yesterdayLog = null;
        if (authorId) {
            const logs = await dbAll(`
                SELECT id, date, todayTasks, nextTasks, createdAt 
                FROM work_logs 
                WHERE authorId = ? AND isDraft = 0 
                ORDER BY date DESC 
                LIMIT 1
            `, [authorId]);
            if (logs.length > 0) {
                yesterdayLog = logs[0];
            }
        }

        res.json({
            pendingExpenses,
            pendingExhibitions,
            pendingInvoices: pendingInvoices.map(inv => {
                try { inv.shipper = JSON.parse(inv.shipper || '{}'); } catch(e) { inv.shipper = {}; }
                try { inv.consignee = JSON.parse(inv.consignee || '{}'); } catch(e) { inv.consignee = {}; }
                return inv;
            }),
            lowStockHqProducts,
            recentSellerKProducts,
            yesterdayLog
        });
    } catch (err) {
        console.error('대시보드 에러:', err);
        res.status(500).json({ error: '대시보드 데이터를 불러오는데 실패했습니다.' });
    }
});

// 증시 데이터 조회 (Yahoo Finance API)
router.get('/market-indices', async (req, res) => {
    try {
        const symbols = ['^KS11', '^KQ11', '^DJI', '^IXIC', '^GSPC', '^N225', '000001.SS'];
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`;
        
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Yahoo Finance API 에러: ${response.status}`);
        }
        
        const data = await response.json();
        
        const nameMap = {
            '^KS11': '코스피',
            '^KQ11': '코스닥',
            '^DJI': '다우존스',
            '^IXIC': '나스닥',
            '^GSPC': 'S&P 500',
            '^N225': '닛케이 225',
            '000001.SS': '상해종합'
        };

        const indices = data.quoteResponse.result.map(q => ({
            symbol: q.symbol,
            price: q.regularMarketPrice,
            change: q.regularMarketChange,
            changePercent: q.regularMarketChangePercent,
            name: nameMap[q.symbol] || q.symbol
        }));
        
        // 정렬 순서를 nameMap 순서와 동일하게 보장
        const sortedIndices = symbols.map(sym => indices.find(i => i.symbol === sym)).filter(Boolean);
        
        res.json(sortedIndices);
    } catch (err) {
        console.error('증시 API 에러:', err);
        res.status(500).json({ error: '증시 데이터를 불러오는데 실패했습니다.' });
    }
});

module.exports = { router, setDb };
