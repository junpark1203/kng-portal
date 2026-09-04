const express = require('express');
const router = express.Router();
const authMiddleware = require('../auth-middleware');

module.exports = (database) => {

    // 1. 단일(또는 사업자통합) 거래처 원장 상세 조회
    router.get('/', authMiddleware.verifyToken, (req, res) => {
        const { partner, startDate, endDate, aggregateByBizNum, settlement_account, settlementMonth } = req.query;
        
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

            // 날짜 조건: settlementMonth가 있으면 정산월 기준, 없으면 startDate ~ endDate 기간 기준
            let inDateClause = '';
            let outDateClause = '';
            let inDateParams = [];
            let outDateParams = [];

            if (settlementMonth && settlementMonth.trim()) {
                const sMonth = settlementMonth.trim();
                inDateClause = " AND COALESCE(NULLIF(i.settlement_month, ''), SUBSTR(COALESCE(i.tax_invoice_date, i.date), 1, 7)) = ?";
                outDateClause = " AND COALESCE(NULLIF(o.settlement_month, ''), SUBSTR(COALESCE(o.tax_invoice_date, o.date), 1, 7)) = ?";
                inDateParams = [sMonth];
                outDateParams = [sMonth];
            } else {
                inDateClause = " AND i.tax_invoice_date >= ? AND i.tax_invoice_date <= ?";
                outDateClause = " AND o.tax_invoice_date >= ? AND o.tax_invoice_date <= ?";
                inDateParams = [startDate || '2000-01-01', endDate || '2099-12-31'];
                outDateParams = [startDate || '2000-01-01', endDate || '2099-12-31'];
            }

            // 입고(매입) 데이터 조회
            const inSql = `
                SELECT '입고' as type, i.transaction_group_id, i.date, i.tax_invoice_date as settlement_date, i.item, i.spec, i.unit, 
                       COALESCE(i.settlement_qty, i.qty_initial) as qty, 
                       COALESCE(i.settlement_price, i.unit_price) as price, 
                       COALESCE(i.settlement_account, '') as settlement_account,
                       COALESCE(i.settlement_month, SUBSTR(COALESCE(i.tax_invoice_date, i.date), 1, 7)) as settlement_month,
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
                WHERE i.supplier IN (${placeholders}) AND i.settlement_status = '정산완료'
                ${inDateClause}
                ${accountWhere ? accountWhere.replace(/settlement_account/g, 'i.settlement_account') : ''}
            `;
            
            // 출고(매출) 데이터 조회
            const outSql = `
                SELECT '출고' as type, o.transaction_group_id, o.date, o.tax_invoice_date as settlement_date, o.item, o.spec, o.unit, 
                       COALESCE(o.settlement_qty, o.qty) as qty, 
                       COALESCE(o.settlement_price, o.selling_price) as price, 
                       COALESCE(o.settlement_account, '') as settlement_account,
                       COALESCE(o.settlement_month, SUBSTR(COALESCE(o.tax_invoice_date, o.date), 1, 7)) as settlement_month,
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
                WHERE o.destination IN (${placeholders}) AND o.settlement_status = '정산완료'
                ${outDateClause}
                ${accountWhere ? accountWhere.replace(/settlement_account/g, 'o.settlement_account') : ''}
            `;

            const inParams = [...partnersList, ...inDateParams, ...inAccountParams];
            const outParams = [...partnersList, ...outDateParams, ...outAccountParams];

            database.all(inSql, inParams, (err, inRows) => {
                if (err) return res.status(500).json({ error: err.message });
                
                database.all(outSql, outParams, (err2, outRows) => {
                    if (err2) return res.status(500).json({ error: err2.message });
                    
                    // 합치고 날짜순 정렬
                    const combined = [...inRows, ...outRows];
                    combined.sort((a, b) => {
                        const dateA = a.settlement_date || a.date;
                        const dateB = b.settlement_date || b.date;
                        if (dateA === dateB) return a.id - b.id;
                        return new Date(dateA) - new Date(dateB);
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

    // 2. 월간현황 대시보드 요약 (특정 월의 전체 거래처별 매입/매출 집계)
    router.get('/monthly-summary', authMiddleware.verifyToken, (req, res) => {
        const { month, settlement_account } = req.query;

        if (!month) {
            return res.status(400).json({ error: 'month (YYYY-MM) is required' });
        }

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

        // 해당 월의 매입 건 집계 (거래처별)
        const inSql = `
            SELECT i.supplier as partner,
                   COUNT(*) as count,
                   COALESCE(SUM(COALESCE(i.settlement_qty, i.qty_initial)), 0) as total_qty,
                   COALESCE(SUM(
                       (COALESCE(i.settlement_qty, i.qty_initial) * COALESCE(i.settlement_price, i.unit_price)) +
                       CASE 
                           WHEN i.shipping_fee > 0 AND i.shipping_fee_vat_included = 1 THEN ROUND(i.shipping_fee / 1.1)
                           WHEN i.shipping_fee > 0 THEN i.shipping_fee
                           ELSE 0
                       END
                   ), 0) as supply_amt,
                   COALESCE(SUM(
                       CASE 
                           WHEN i.is_zero_tax = 1 OR (i.trade_type IS NOT NULL AND i.trade_type != '내수') THEN 0
                           ELSE 
                               ROUND((COALESCE(i.settlement_qty, i.qty_initial) * COALESCE(i.settlement_price, i.unit_price)) * 0.1) +
                               CASE 
                                   WHEN i.shipping_fee > 0 AND i.shipping_fee_vat_included = 1 THEN (i.shipping_fee - ROUND(i.shipping_fee / 1.1))
                                   WHEN i.shipping_fee > 0 THEN ROUND(i.shipping_fee * 0.1)
                                   ELSE 0
                               END
                       END
                   ), 0) as vat_amt,
                   COALESCE(SUM(CASE WHEN i.settlement_account = '안전자재-일반' THEN 1 ELSE 0 END), 0) as acc_safe_gen,
                   COALESCE(SUM(CASE WHEN i.settlement_account = '안전자재-환경' THEN 1 ELSE 0 END), 0) as acc_safe_env,
                   COALESCE(SUM(CASE WHEN i.settlement_account = '잡자재' THEN 1 ELSE 0 END), 0) as acc_misc,
                   COALESCE(SUM(CASE WHEN i.settlement_account = '기타자재' THEN 1 ELSE 0 END), 0) as acc_etc,
                   COALESCE(SUM(CASE WHEN i.settlement_account = '쇼핑몰' THEN 1 ELSE 0 END), 0) as acc_mall,
                   COALESCE(SUM(CASE WHEN i.settlement_account IS NULL OR i.settlement_account = '' THEN 1 ELSE 0 END), 0) as acc_unclass
            FROM logistics_inbound i
            WHERE i.settlement_status = '정산완료'
              AND COALESCE(NULLIF(i.settlement_month, ''), SUBSTR(COALESCE(i.tax_invoice_date, i.date), 1, 7)) = ?
              ${accountWhere ? accountWhere.replace(/settlement_account/g, 'i.settlement_account') : ''}
            GROUP BY i.supplier
        `;

        // 해당 월의 매출 건 집계 (거래처별)
        const outSql = `
            SELECT o.destination as partner,
                   COUNT(*) as count,
                   COALESCE(SUM(COALESCE(o.settlement_qty, o.qty)), 0) as total_qty,
                   COALESCE(SUM(
                       (COALESCE(o.settlement_qty, o.qty) * COALESCE(o.settlement_price, o.selling_price)) +
                       CASE 
                           WHEN o.shipping_fee > 0 AND o.shipping_fee_vat_included = 1 THEN ROUND(o.shipping_fee / 1.1)
                           WHEN o.shipping_fee > 0 THEN o.shipping_fee
                           ELSE 0
                       END
                   ), 0) as supply_amt,
                   COALESCE(SUM(
                       CASE 
                           WHEN o.is_zero_tax = 1 OR (o.trade_type IS NOT NULL AND o.trade_type != '내수') THEN 0
                           ELSE 
                               ROUND((COALESCE(o.settlement_qty, o.qty) * COALESCE(o.settlement_price, o.selling_price)) * 0.1) +
                               CASE 
                                   WHEN o.shipping_fee > 0 AND o.shipping_fee_vat_included = 1 THEN (o.shipping_fee - ROUND(o.shipping_fee / 1.1))
                                   WHEN o.shipping_fee > 0 THEN ROUND(o.shipping_fee * 0.1)
                                   ELSE 0
                               END
                       END
                   ), 0) as vat_amt,
                   COALESCE(SUM(CASE WHEN o.settlement_account = '안전자재-일반' THEN 1 ELSE 0 END), 0) as acc_safe_gen,
                   COALESCE(SUM(CASE WHEN o.settlement_account = '안전자재-환경' THEN 1 ELSE 0 END), 0) as acc_safe_env,
                   COALESCE(SUM(CASE WHEN o.settlement_account = '잡자재' THEN 1 ELSE 0 END), 0) as acc_misc,
                   COALESCE(SUM(CASE WHEN o.settlement_account = '기타자재' THEN 1 ELSE 0 END), 0) as acc_etc,
                   COALESCE(SUM(CASE WHEN o.settlement_account = '쇼핑몰' THEN 1 ELSE 0 END), 0) as acc_mall,
                   COALESCE(SUM(CASE WHEN o.settlement_account IS NULL OR o.settlement_account = '' THEN 1 ELSE 0 END), 0) as acc_unclass
            FROM logistics_outbound o
            WHERE o.settlement_status = '정산완료'
              AND COALESCE(NULLIF(o.settlement_month, ''), SUBSTR(COALESCE(o.tax_invoice_date, o.date), 1, 7)) = ?
              ${accountWhere ? accountWhere.replace(/settlement_account/g, 'o.settlement_account') : ''}
            GROUP BY o.destination
        `;

        database.all("SELECT name, business_number, ceo_name FROM partners", [], (errP, partnersList) => {
            if (errP) return res.status(500).json({ error: errP.message });
            
            const partnerMeta = {};
            (partnersList || []).forEach(p => {
                partnerMeta[p.name] = p;
            });

            database.all(inSql, [month, ...inAccountParams], (errIn, inRows) => {
                if (errIn) return res.status(500).json({ error: errIn.message });

                database.all(outSql, [month, ...outAccountParams], (errOut, outRows) => {
                    if (errOut) return res.status(500).json({ error: errOut.message });

                    // 매입/매출 통합 파트너 맵 생성
                    const partnerMap = {};

                    // 매입(입고) 처리
                    (inRows || []).forEach(r => {
                        if (!r.partner) return;
                        if (!partnerMap[r.partner]) {
                            const meta = partnerMeta[r.partner] || {};
                            partnerMap[r.partner] = {
                                partner: r.partner,
                                business_number: meta.business_number || '',
                                ceo_name: meta.ceo_name || '',
                                inbound: { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0, accounts: {} },
                                outbound: { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0, accounts: {} },
                            };
                        }
                        const total = (r.supply_amt || 0) + (r.vat_amt || 0);
                        partnerMap[r.partner].inbound = {
                            count: r.count || 0,
                            qty: r.total_qty || 0,
                            supplyAmt: Math.round(r.supply_amt || 0),
                            vatAmt: Math.round(r.vat_amt || 0),
                            totalAmt: Math.round(total),
                            accounts: {
                                safetyGeneral: r.acc_safe_gen || 0,
                                safetyEnv: r.acc_safe_env || 0,
                                misc: r.acc_misc || 0,
                                etc: r.acc_etc || 0,
                                mall: r.acc_mall || 0,
                                unclassified: r.acc_unclass || 0
                            }
                        };
                    });

                    // 매출(출고) 처리
                    (outRows || []).forEach(r => {
                        if (!r.partner) return;
                        if (!partnerMap[r.partner]) {
                            const meta = partnerMeta[r.partner] || {};
                            partnerMap[r.partner] = {
                                partner: r.partner,
                                business_number: meta.business_number || '',
                                ceo_name: meta.ceo_name || '',
                                inbound: { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0, accounts: {} },
                                outbound: { count: 0, qty: 0, supplyAmt: 0, vatAmt: 0, totalAmt: 0, accounts: {} },
                            };
                        }
                        const total = (r.supply_amt || 0) + (r.vat_amt || 0);
                        partnerMap[r.partner].outbound = {
                            count: r.count || 0,
                            qty: r.total_qty || 0,
                            supplyAmt: Math.round(r.supply_amt || 0),
                            vatAmt: Math.round(r.vat_amt || 0),
                            totalAmt: Math.round(total),
                            accounts: {
                                safetyGeneral: r.acc_safe_gen || 0,
                                safetyEnv: r.acc_safe_env || 0,
                                misc: r.acc_misc || 0,
                                etc: r.acc_etc || 0,
                                mall: r.acc_mall || 0,
                                unclassified: r.acc_unclass || 0
                            }
                        };
                    });

                    const partnerSummaries = Object.values(partnerMap);

                    // 전체 월간 KPI 집계
                    let totalInCount = 0, totalInQty = 0, totalInSupply = 0, totalInVat = 0;
                    let totalOutCount = 0, totalOutQty = 0, totalOutSupply = 0, totalOutVat = 0;

                    partnerSummaries.forEach(p => {
                        totalInCount += p.inbound.count;
                        totalInQty += p.inbound.qty;
                        totalInSupply += p.inbound.supplyAmt;
                        totalInVat += p.inbound.vatAmt;

                        totalOutCount += p.outbound.count;
                        totalOutQty += p.outbound.qty;
                        totalOutSupply += p.outbound.supplyAmt;
                        totalOutVat += p.outbound.vatAmt;
                    });

                    res.json({
                        month,
                        totals: {
                            inbound: {
                                count: totalInCount,
                                qty: totalInQty,
                                supplyAmt: totalInSupply,
                                vatAmt: totalInVat,
                                totalAmt: totalInSupply + totalInVat
                            },
                            outbound: {
                                count: totalOutCount,
                                qty: totalOutQty,
                                supplyAmt: totalOutSupply,
                                vatAmt: totalOutVat,
                                totalAmt: totalOutSupply + totalOutVat
                            },
                            marginSupply: totalOutSupply - totalInSupply,
                            marginTotal: (totalOutSupply + totalOutVat) - (totalInSupply + totalInVat)
                        },
                        partners: partnerSummaries
                    });
                });
            });
        });
    });

    return router;
};
