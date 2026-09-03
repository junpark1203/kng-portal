const express = require('express');
const router = express.Router();
const authMiddleware = require('../auth-middleware');

module.exports = (database) => {

    router.get('/', authMiddleware.verifyToken, (req, res) => {
        const { partner, startDate, endDate, aggregateByBizNum, settlement_account } = req.query;
        
        if (!partner) {
            return res.status(400).json({ error: 'Partner is required' });
        }

        const fetchLedger = (partnersList) => {
            const placeholders = partnersList.map(() => '?').join(',');
            
            let accountWhere = '';
            const inAccountParams = [];
            const outAccountParams = [];

            if (settlement_account && settlement_account !== '전체' && settlement_account !== '전체보기') {
                if (settlement_account === '안전자재' || settlement_account === '안전자재_전체') {
                    accountWhere = " AND (settlement_account LIKE '안전자재%')";
                } else if (settlement_account === '미분류') {
                    accountWhere = " AND (settlement_account IS NULL OR settlement_account = '')";
                } else {
                    accountWhere = " AND settlement_account = ?";
                    inAccountParams.push(settlement_account);
                    outAccountParams.push(settlement_account);
                }
            }

            // 입고(매입) 데이터 조회
            const inSql = `
                SELECT '입고' as type, i.transaction_group_id, i.date, i.tax_invoice_date as settlement_date, i.item, i.spec, i.unit, 
                       COALESCE(i.settlement_qty, i.qty_initial) as qty, 
                       COALESCE(i.settlement_price, i.unit_price) as price, 
                       COALESCE(i.settlement_account, '') as settlement_account,
                       i.is_direct, i.note, i.id, i.supplier as site_name,
                       i.supplier,
                       CASE 
                           WHEN i.is_direct = 1 THEN do.destination 
                           ELSE (SELECT GROUP_CONCAT(DISTINCT o_sub.destination) 
                                 FROM logistics_outbound_lots lol 
                                 JOIN logistics_outbound o_sub ON lol.outbound_id = o_sub.id 
                                 WHERE lol.inbound_id = i.id) 
                       END as relative_partner,
                       i.shipping_fee, i.shipping_fee_vat_included, i.settlement_memo
                FROM logistics_inbound i
                LEFT JOIN logistics_outbound_lots dl ON i.is_direct = 1 AND dl.inbound_id = i.id
                LEFT JOIN logistics_outbound do ON dl.outbound_id = do.id
                WHERE i.supplier IN (${placeholders}) AND i.tax_invoice_date >= ? AND i.tax_invoice_date <= ? AND i.settlement_status = '정산완료'
                ${accountWhere ? accountWhere.replace(/settlement_account/g, 'i.settlement_account') : ''}
            `;
            
            // 출고(매출) 데이터 조회
            const outSql = `
                SELECT '출고' as type, o.transaction_group_id, o.date, o.tax_invoice_date as settlement_date, o.item, o.spec, o.unit, 
                       COALESCE(o.settlement_qty, o.qty) as qty, 
                       COALESCE(o.settlement_price, o.selling_price) as price, 
                       COALESCE(o.settlement_account, '') as settlement_account,
                       o.is_direct, o.note, o.id, o.destination as site_name,
                       o.destination,
                       CASE 
                           WHEN o.is_direct = 1 THEN di.supplier 
                           ELSE (SELECT GROUP_CONCAT(DISTINCT i_sub.supplier) 
                                 FROM logistics_outbound_lots lol 
                                 JOIN logistics_inbound i_sub ON lol.inbound_id = i_sub.id 
                                 WHERE lol.outbound_id = o.id) 
                       END as relative_partner,
                       o.shipping_fee, o.shipping_fee_vat_included, o.settlement_memo
                FROM logistics_outbound o
                LEFT JOIN logistics_outbound_lots dl ON o.is_direct = 1 AND dl.outbound_id = o.id
                LEFT JOIN logistics_inbound di ON dl.inbound_id = di.id
                WHERE o.destination IN (${placeholders}) AND o.tax_invoice_date >= ? AND o.tax_invoice_date <= ? AND o.settlement_status = '정산완료'
                ${accountWhere ? accountWhere.replace(/settlement_account/g, 'o.settlement_account') : ''}
            `;

            const inParams = [...partnersList, startDate, endDate, ...inAccountParams];
            const outParams = [...partnersList, startDate, endDate, ...outAccountParams];

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
