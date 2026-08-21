const express = require('express');
const router = express.Router();
const authMiddleware = require('../auth-middleware');

module.exports = (database) => {

    router.get('/', authMiddleware.verifyToken, (req, res) => {
        const { partner, startDate, endDate } = req.query;
        
        if (!partner) {
            return res.status(400).json({ error: 'Partner is required' });
        }

        // 입고(매입) 데이터 조회
        const inSql = `
            SELECT '입고' as type, date, item, spec, unit, qty_initial as qty, unit_price as price, is_direct, note, id
            FROM logistics_inbound 
            WHERE supplier = ? AND date >= ? AND date <= ?
        `;
        
        // 출고(매출) 데이터 조회
        const outSql = `
            SELECT '출고' as type, date, item, spec, unit, qty, selling_price as price, is_direct, note, id
            FROM logistics_outbound
            WHERE destination = ? AND date >= ? AND date <= ?
        `;

        database.all(inSql, [partner, startDate, endDate], (err, inRows) => {
            if (err) return res.status(500).json({ error: err.message });
            
            database.all(outSql, [partner, startDate, endDate], (err2, outRows) => {
                if (err2) return res.status(500).json({ error: err2.message });
                
                // 합치고 날짜순 정렬
                const combined = [...inRows, ...outRows];
                combined.sort((a, b) => {
                    if (a.date === b.date) return a.id - b.id; // 같은 날짜면 id 순
                    return new Date(a.date) - new Date(b.date);
                });
                
                res.json(combined);
            });
        });
    });

    return router;
};
