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

// 계정 이메일 -> 표시 이름(작성자명) 고정값 매핑
const USER_NAME_MAP = {
    'jpark120325@gmail.com': '박준용',
    // 필요 시 아래에 '이메일': '작성자명' 을 추가하세요
};

router.get('/summary', async (req, res) => {
    try {
        const userEmail = req.user ? req.user.email : null;
        const authorName = userEmail ? (USER_NAME_MAP[userEmail] || userEmail) : null;

        // 1. 진행중인 지출결의서 (본인 작성분만 필터링)
        let pendingExpenses = [];
        if (authorName) {
            pendingExpenses = await dbAll(`
                SELECT id, title, amount, currency, status, createdAt, personInCharge 
                FROM expense_resolutions 
                WHERE status NOT IN ('결재보류', '결재완료') AND (personInCharge = ? OR personInCharge = ?)
                ORDER BY createdAt DESC
            `, [userEmail, authorName]);
        }

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
        let yesterdayLog = null;
        if (userEmail) {
            const logs = await dbAll(`
                SELECT id, date, todayTasks, nextTasks, createdAt 
                FROM work_logs 
                WHERE (authorId = ? OR authorId = ?) AND isDraft = 0 
                ORDER BY date DESC 
                LIMIT 1
            `, [userEmail, authorName]);
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
        
        const results = await Promise.all(symbols.map(async (sym) => {
            const res = await fetch('https://query2.finance.yahoo.com/v8/finance/chart/' + sym);
            if (!res.ok) throw new Error('API Error for ' + sym);
            const data = await res.json();
            const meta = data.chart.result[0].meta;
            const change = meta.regularMarketPrice - meta.chartPreviousClose;
            return {
                symbol: sym,
                price: meta.regularMarketPrice,
                change: change,
                changePercent: (change / meta.chartPreviousClose) * 100
            };
        }));
        
        const nameMap = {
            '^KS11': '코스피',
            '^KQ11': '코스닥',
            '^DJI': '다우존스',
            '^IXIC': '나스닥',
            '^GSPC': 'S&P 500',
            '^N225': '닛케이 225',
            '000001.SS': '상해종합'
        };

        const indices = results.map(q => ({
            symbol: q.symbol,
            price: q.price,
            change: q.change,
            changePercent: q.changePercent,
            name: nameMap[q.symbol] || q.symbol
        }));
        
        // 정렬 순서를 nameMap 순서와 동일하게 보장
        const sortedIndices = symbols.map(sym => indices.find(i => i.symbol === sym)).filter(Boolean);
        
        res.json(sortedIndices);
    } catch (err) {
        console.error('증시 API 에러:', err);
        res.status(500).json({ error: '증시 데이터를 불러오는데 실패했습니다. 사유: ' + err.message });
    }
});

module.exports = { router, setDb };
