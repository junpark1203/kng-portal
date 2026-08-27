const express = require('express');
const router = express.Router();
const authMiddleware = require('../auth-middleware');

module.exports = (database) => {

    router.get('/', authMiddleware.verifyToken, (req, res) => {
        const { partner, startDate, endDate, aggregateByBizNum } = req.query;
        
        if (!partner) {
            return res.status(400).json({ error: 'Partner is required' });
        }

        const fetchLedger = (partnersList) => {
            const placeholders = partnersList.map(() => '?').join(',');
            
            // 입고(매입) 데이터 조회
            const inSql = `
                SELECT '입고' as type, transaction_group_id, date, tax_invoice_date as settlement_date, item, spec, unit, 
                       COALESCE(settlement_qty, qty_initial) as qty, 
                       COALESCE(settlement_price, unit_price) as price, 
                       is_direct, note, id, supplier as site_name
                FROM logistics_inbound 
                WHERE supplier IN (${placeholders}) AND date >= ? AND date <= ? AND settlement_status = '정산완료'
            `;
            
            // 출고(매출) 데이터 조회
            const outSql = `
                SELECT '출고' as type, transaction_group_id, date, tax_invoice_date as settlement_date, item, spec, unit, 
                       COALESCE(settlement_qty, qty) as qty, 
                       COALESCE(settlement_price, selling_price) as price, 
                       is_direct, note, id, destination as site_name
                FROM logistics_outbound
                WHERE destination IN (${placeholders}) AND date >= ? AND date <= ? AND settlement_status = '정산완료'
            `;

            const inParams = [...partnersList, startDate, endDate];
            const outParams = [...partnersList, startDate, endDate];

            database.all(inSql, inParams, (err, inRows) => {
                if (err) return res.status(500).json({ error: err.message });
                
                database.all(outSql, outParams, (err2, outRows) => {
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
        };

        if (aggregateByBizNum === 'true') {
            // 해당 거래처의 사업자번호 조회
            database.get("SELECT business_number FROM partners WHERE name = ?", [partner], (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                
                let bizNum = row ? row.business_number : null;
                
                if (bizNum && bizNum.trim() !== '') {
                    // 특수문자 제거 후 비교 (정규화된 형태로 매칭)
                    const normalizedBizNum = bizNum.replace(/[^0-9]/g, '');
                    
                    database.all("SELECT name, business_number FROM partners", [], (err2, allPartners) => {
                        if (err2) return res.status(500).json({ error: err2.message });
                        
                        const matchedPartners = allPartners
                            .filter(p => p.business_number && p.business_number.replace(/[^0-9]/g, '') === normalizedBizNum)
                            .map(p => p.name);
                        
                        if (matchedPartners.length === 0) {
                            matchedPartners.push(partner); // 혹시 모르니 자기 자신 포함
                        }
                        fetchLedger(matchedPartners);
                    });
                } else {
                    // 사업자번호가 없는 경우 그냥 자기 자신만 조회
                    fetchLedger([partner]);
                }
            });
        } else {
            // 통합조회 체크 안함 -> 자기 자신만 조회
            fetchLedger([partner]);
        }
    });

    return router;
};
