const express = require('express');
const router = express.Router();

let db = null;

function setDb(database) {
    db = database;
}

// ── Promise Helpers ──
function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => {
            if (err) reject(err); else resolve(rows || []);
        });
    });
}

function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params || [], (err, row) => {
            if (err) reject(err); else resolve(row);
        });
    });
}

function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params || [], function (err) {
            if (err) reject(err); else resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

// ── 공새로 수수료 계산 공식 (노션 1-2. 거래수수료 정책 100% 준수) ──
function calcGongsaeroFee(settlementPrice) {
    const sPrice = Math.round(Number(settlementPrice) || 0);
    if (sPrice > 16) {
        return Math.floor(sPrice * 0.06); // 16원 초과: 6% 계산 후 소수점 절삭
    } else if (sPrice >= 1) {
        return 1; // 1원~16원: 최소 수수료 1원
    }
    return 0;
}

// ── DB 테이블 초기화 ──
function initGongsaeroBiddingTables(database) {
    return new Promise((resolve, reject) => {
        const targetDb = database || db;
        if (!targetDb) return resolve();

        targetDb.serialize(() => {
            // 1. 공고 마스터 테이블
            targetDb.run(`
                CREATE TABLE IF NOT EXISTS gongsaero_bids (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    client_name TEXT,
                    bid_type TEXT DEFAULT '공개 입찰',
                    urgency TEXT DEFAULT '일반',
                    issue_date TEXT,
                    bid_deadline TEXT,
                    delivery_deadline TEXT,
                    delivery_address TEXT,
                    delivery_condition TEXT DEFAULT '하차도',
                    delivery_method TEXT DEFAULT '직접배송',
                    shipping_included INTEGER DEFAULT 1,
                    estimated_shipping_fee INTEGER DEFAULT 0,
                    author_info TEXT,
                    manager_info TEXT,
                    status TEXT DEFAULT '입찰중',
                    total_buy_cost INTEGER DEFAULT 0,
                    total_settlement INTEGER DEFAULT 0,
                    total_fee INTEGER DEFAULT 0,
                    total_delivery_amount INTEGER DEFAULT 0,
                    total_profit INTEGER DEFAULT 0,
                    profit_rate REAL DEFAULT 0,
                    remarks TEXT,
                    created_at TEXT,
                    updated_at TEXT
                )
            `, (err) => {
                if (err) console.error('gongsaero_bids table error:', err.message);
            });

            // 2. 투찰 품목 테이블
            targetDb.run(`
                CREATE TABLE IF NOT EXISTS gongsaero_bid_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bid_id TEXT NOT NULL,
                    item_no INTEGER,
                    item_name TEXT NOT NULL,
                    spec TEXT,
                    unit TEXT,
                    qty REAL DEFAULT 0,
                    origin_brand TEXT,
                    item_note TEXT,
                    buy_price INTEGER DEFAULT 0,
                    margin_rate REAL DEFAULT 0,
                    settlement_price INTEGER DEFAULT 0,
                    gongsaero_fee INTEGER DEFAULT 0,
                    delivery_price INTEGER DEFAULT 0,
                    total_buy_cost INTEGER DEFAULT 0,
                    total_settlement_price INTEGER DEFAULT 0,
                    total_delivery_price INTEGER DEFAULT 0,
                    item_profit INTEGER DEFAULT 0,
                    created_at TEXT,
                    FOREIGN KEY(bid_id) REFERENCES gongsaero_bids(id) ON DELETE CASCADE
                )
            `, (err) => {
                if (err) console.error('gongsaero_bid_items table error:', err.message);
            });

            // 인덱스 생성
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_gs_items_name ON gongsaero_bid_items(item_name)`);
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_gs_items_bid_id ON gongsaero_bid_items(bid_id)`);
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_gs_bids_status ON gongsaero_bids(status)`);
            targetDb.run(`CREATE INDEX IF NOT EXISTS idx_gs_bids_deadline ON gongsaero_bids(bid_deadline)`);

            // 공고 테이블이 비어있을 경우 예시 공고 1건 자동 시드 (사용자 업로드 캡처 기반)
            targetDb.get('SELECT COUNT(*) as cnt FROM gongsaero_bids', [], (cntErr, row) => {
                if (!cntErr && row && row.cnt === 0) {
                    const seedBidId = 'GS-BID-20260904-001';
                    const now = new Date().toISOString();
                    const seedItems = [
                        { no: 1, name: 'PP로프', spec: '8mm', unit: '롤', qty: 10, buy: 13500, margin: 15 },
                        { no: 2, name: 'PP로프', spec: '16mm', unit: '롤', qty: 5, buy: 32000, margin: 15 },
                        { no: 3, name: '톤마대', spec: '500KG', unit: 'EA', qty: 40, buy: 4200, margin: 15 },
                        { no: 4, name: '케이블타이', spec: '300mm', unit: '롤', qty: 5, buy: 5500, margin: 15 },
                        { no: 5, name: '이중코팅장갑', spec: '팡이중', unit: 'EA', qty: 50, buy: 650, margin: 20 },
                        { no: 6, name: '안코팅장갑', spec: '-', unit: 'EA', qty: 100, buy: 450, margin: 20 },
                        { no: 7, name: '황동 어스 클램프 바이스 집게', spec: '300A', unit: 'EA', qty: 2, buy: 8500, margin: 18 },
                        { no: 8, name: 'PVC전기절연테이프', spec: '-', unit: 'EA', qty: 10, buy: 350, margin: 25 },
                        { no: 9, name: '페인트락카', spec: '적색', unit: 'EA', qty: 24, buy: 1800, margin: 18 },
                        { no: 10, name: '페인트락카', spec: '청색', unit: 'EA', qty: 24, buy: 1800, margin: 18 },
                        { no: 11, name: '페인트락카', spec: '흰색', unit: 'EA', qty: 24, buy: 1800, margin: 18 },
                        { no: 12, name: '천막(일반)', spec: '10 X 10 m', unit: 'EA', qty: 5, buy: 45000, margin: 15 },
                        { no: 13, name: '고압분무기 건', spec: '-', unit: 'EA', qty: 2, buy: 18500, margin: 15 }
                    ];

                    let totalBuy = 0, totalSettlement = 0, totalFee = 0, totalDelivery = 0, totalProfit = 0;
                    const processed = seedItems.map(it => {
                        const settlement = Math.round(it.buy * (1 + it.margin / 100));
                        const fee = calcGongsaeroFee(settlement);
                        const delivery = settlement + fee;
                        const buyCost = it.buy * it.qty;
                        const sCost = settlement * it.qty;
                        const dCost = delivery * it.qty;
                        const profit = (settlement - it.buy) * it.qty;

                        totalBuy += buyCost;
                        totalSettlement += sCost;
                        totalFee += (fee * it.qty);
                        totalDelivery += dCost;
                        totalProfit += profit;

                        return { ...it, settlement, fee, delivery, buyCost, sCost, dCost, profit };
                    });

                    const profitRate = totalBuy > 0 ? Number(((totalProfit / totalBuy) * 100).toFixed(1)) : 0;

                    targetDb.run(`
                        INSERT OR IGNORE INTO gongsaero_bids (
                            id, title, client_name, bid_type, urgency, issue_date, bid_deadline,
                            delivery_deadline, delivery_address, delivery_condition, delivery_method,
                            shipping_included, estimated_shipping_fee, author_info, manager_info,
                            status, total_buy_cost, total_settlement, total_fee, total_delivery_amount,
                            total_profit, profit_rate, remarks, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        seedBidId, '[(주)범양이앤씨] 청담 1,2교 확장 구조물 공사 | 일회성 입찰', '(주)범양이앤씨', '일회성 입찰', '긴급',
                        '2026-09-04 10:45:41', '2026-09-04 16:00:18', '2026-09-07 11:00:00',
                        '서울 송파구 잠실동 1-1, 내비 종료시 직진 / 담당자 연락', '하차도', '납품업체 직접배송',
                        1, 70000, '나종수 주임(010-8006-6945)', '김도현 차장(010-3135-4130)',
                        '입찰중', totalBuy, totalSettlement, totalFee, totalDelivery, totalProfit, profitRate,
                        '입찰공고 캡처 기반 샘플 등록 데이터 (PP로프, 마대 등 13품목)', now, now
                    ], (bErr) => {
                        if (!bErr) {
                            processed.forEach(p => {
                                targetDb.run(`
                                    INSERT OR IGNORE INTO gongsaero_bid_items (
                                        bid_id, item_no, item_name, spec, unit, qty, buy_price, margin_rate,
                                        settlement_price, gongsaero_fee, delivery_price, total_buy_cost,
                                        total_settlement_price, total_delivery_price, item_profit, created_at
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                `, [
                                    seedBidId, p.no, p.name, p.spec, p.unit, p.qty, p.buy, p.margin,
                                    p.settlement, p.fee, p.delivery, p.buyCost, p.sCost, p.dCost, p.profit, now
                                ]);
                            });
                            console.log('공새로 입찰공고 샘플 데이터(범양이앤씨 13품목) 시드 완료');
                        }
                    });
                }
            });

            resolve();
        });
    });
}

// ──────────────────────────────────────────────
// API 라우트
// ──────────────────────────────────────────────

// 1. 공고 목록 조회 (검색, 상태필터, 정렬)
router.get('/bids', async (req, res) => {
    try {
        const { status, query, sort } = req.query;
        let whereClauses = [];
        let params = [];

        if (status && status !== 'all') {
            whereClauses.push('b.status = ?');
            params.push(status);
        }

        if (query && query.trim()) {
            const q = `%${query.trim()}%`;
            // 공고명, 발주처, 주소 뿐만 아니라 소속된 품목명/규격까지 검색!
            whereClauses.push(`(
                b.title LIKE ? OR 
                b.client_name LIKE ? OR 
                b.delivery_address LIKE ? OR
                EXISTS (SELECT 1 FROM gongsaero_bid_items i WHERE i.bid_id = b.id AND (i.item_name LIKE ? OR i.spec LIKE ?))
            )`);
            params.push(q, q, q, q, q);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        
        let orderBy = 'ORDER BY b.created_at DESC';
        if (sort === 'deadline_asc') {
            orderBy = 'ORDER BY b.bid_deadline ASC';
        } else if (sort === 'amount_desc') {
            orderBy = 'ORDER BY b.total_delivery_amount DESC';
        } else if (sort === 'profit_desc') {
            orderBy = 'ORDER BY b.total_profit DESC';
        }

        const sql = `
            SELECT b.*, 
                   (SELECT COUNT(*) FROM gongsaero_bid_items WHERE bid_id = b.id) as item_count,
                   (SELECT GROUP_CONCAT(item_name, ', ') FROM (SELECT item_name FROM gongsaero_bid_items WHERE bid_id = b.id LIMIT 3)) as sample_items
            FROM gongsaero_bids b
            ${whereSql}
            ${orderBy}
        `;

        const bids = await dbAll(sql, params);

        // 통계 요약 (KPI)
        const statsSql = `
            SELECT 
                COUNT(*) as total_count,
                SUM(CASE WHEN status = '입찰중' THEN 1 ELSE 0 END) as bidding_count,
                SUM(CASE WHEN status = '낙찰' THEN 1 ELSE 0 END) as won_count,
                SUM(CASE WHEN status = '미선정' THEN 1 ELSE 0 END) as lost_count,
                SUM(CASE WHEN status = '낙찰' THEN total_delivery_amount ELSE 0 END) as won_amount,
                SUM(CASE WHEN status = '낙찰' THEN total_profit ELSE 0 END) as won_profit,
                AVG(CASE WHEN status = '낙찰' AND profit_rate > 0 THEN profit_rate ELSE NULL END) as avg_won_margin
            FROM gongsaero_bids
        `;
        const stats = await dbGet(statsSql, []) || {};

        res.json({ success: true, bids, stats });
    } catch (err) {
        console.error('Error fetching bids:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. 단일 공고 상세 조회 (공고정보 + 품목 전체)
router.get('/bids/:id', async (req, res) => {
    try {
        const bid = await dbGet('SELECT * FROM gongsaero_bids WHERE id = ?', [req.params.id]);
        if (!bid) {
            return res.status(404).json({ error: '해당 공고를 찾을 수 없습니다.' });
        }

        const items = await dbAll(
            'SELECT * FROM gongsaero_bid_items WHERE bid_id = ? ORDER BY item_no ASC, id ASC',
            [req.params.id]
        );

        res.json({ success: true, bid, items });
    } catch (err) {
        console.error('Error fetching bid detail:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. 품목별 투찰 히스토리 전용 검색 (핵심 차별화 기능)
router.get('/items/history', async (req, res) => {
    try {
        const { query, limit = 100 } = req.query;
        let whereClauses = [];
        let params = [];

        if (query && query.trim()) {
            const q = `%${query.trim()}%`;
            whereClauses.push('(i.item_name LIKE ? OR i.spec LIKE ?)');
            params.push(q, q);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const sql = `
            SELECT i.*, 
                   b.title as bid_title,
                   b.client_name,
                   b.status as bid_status,
                   b.issue_date,
                   b.bid_deadline,
                   b.delivery_deadline,
                   b.delivery_address,
                   b.delivery_condition
            FROM gongsaero_bid_items i
            JOIN gongsaero_bids b ON i.bid_id = b.id
            ${whereSql}
            ORDER BY b.created_at DESC, i.id ASC
            LIMIT ?
        `;
        params.push(Number(limit) || 100);

        const items = await dbAll(sql, params);
        res.json({ success: true, count: items.length, items });
    } catch (err) {
        console.error('Error searching item history:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. 신규 공고 및 투찰 품목 등록
router.post('/bids', async (req, res) => {
    const {
        title, client_name, bid_type, urgency, issue_date, bid_deadline,
        delivery_deadline, delivery_address, delivery_condition, delivery_method,
        shipping_included, estimated_shipping_fee, author_info, manager_info,
        status, remarks, items
    } = req.body;

    if (!title || !title.trim()) {
        return res.status(400).json({ error: '공고/공사명을 입력해주세요.' });
    }

    const now = new Date().toISOString();
    const datePart = now.substring(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(100 + Math.random() * 900);
    const bidId = `GS-BID-${datePart}-${randSuffix}`;

    // 품목 계산 및 합계 산출
    const parsedItems = Array.isArray(items) ? items : [];
    let totalBuyCost = 0;
    let totalSettlement = 0;
    let totalFee = 0;
    let totalDeliveryAmount = 0;
    let totalProfit = 0;

    const processedItems = parsedItems.map((item, idx) => {
        const qty = parseFloat(item.qty) || 0;
        const buyPrice = Math.round(parseFloat(item.buy_price) || 0);
        const marginRate = parseFloat(item.margin_rate) || 0;
        
        // 정산단가 = 매입단가 * (1 + 마진율/100) (또는 직접 입력된 settlement_price)
        let settlementPrice = Math.round(parseFloat(item.settlement_price) || 0);
        if (!settlementPrice && buyPrice > 0) {
            settlementPrice = Math.round(buyPrice * (1 + marginRate / 100));
        }

        // 공새로 수수료 및 납품단가 계산
        const fee = calcGongsaeroFee(settlementPrice);
        const deliveryPrice = settlementPrice + fee;

        const itemBuyCost = buyPrice * qty;
        const itemSettlement = settlementPrice * qty;
        const itemDelivery = deliveryPrice * qty;
        const itemProfit = (settlementPrice - buyPrice) * qty;

        totalBuyCost += itemBuyCost;
        totalSettlement += itemSettlement;
        totalFee += (fee * qty);
        totalDeliveryAmount += itemDelivery;
        totalProfit += itemProfit;

        return {
            bid_id: bidId,
            item_no: item.item_no || (idx + 1),
            item_name: item.item_name || '',
            spec: item.spec || '',
            unit: item.unit || 'EA',
            qty: qty,
            origin_brand: item.origin_brand || '',
            item_note: item.item_note || '',
            buy_price: buyPrice,
            margin_rate: marginRate,
            settlement_price: settlementPrice,
            gongsaero_fee: fee,
            delivery_price: deliveryPrice,
            total_buy_cost: itemBuyCost,
            total_settlement_price: itemSettlement,
            total_delivery_price: itemDelivery,
            item_profit: itemProfit,
            created_at: now
        };
    });

    const profitRate = totalBuyCost > 0 ? Number(((totalProfit / totalBuyCost) * 100).toFixed(2)) : 0;

    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            let hasErr = false;

            const bidSql = `
                INSERT INTO gongsaero_bids (
                    id, title, client_name, bid_type, urgency, issue_date, bid_deadline,
                    delivery_deadline, delivery_address, delivery_condition, delivery_method,
                    shipping_included, estimated_shipping_fee, author_info, manager_info,
                    status, total_buy_cost, total_settlement, total_fee, total_delivery_amount,
                    total_profit, profit_rate, remarks, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const bidParams = [
                bidId, title.trim(), client_name || '', bid_type || '공개 입찰', urgency || '일반',
                issue_date || '', bid_deadline || '', delivery_deadline || '', delivery_address || '',
                delivery_condition || '하차도', delivery_method || '직접배송',
                shipping_included !== undefined ? Number(shipping_included) : 1,
                Number(estimated_shipping_fee) || 0,
                author_info || '', manager_info || '', status || '입찰중',
                totalBuyCost, totalSettlement, totalFee, totalDeliveryAmount, totalProfit, profitRate,
                remarks || '', now, now
            ];

            db.run(bidSql, bidParams, function(err) {
                if (err) {
                    hasErr = true;
                    db.run('ROLLBACK');
                    return reject(err);
                }

                if (processedItems.length === 0) {
                    db.run('COMMIT');
                    return resolve();
                }

                const itemSql = `
                    INSERT INTO gongsaero_bid_items (
                        bid_id, item_no, item_name, spec, unit, qty, origin_brand, item_note,
                        buy_price, margin_rate, settlement_price, gongsaero_fee, delivery_price,
                        total_buy_cost, total_settlement_price, total_delivery_price, item_profit, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                let completed = 0;
                for (const it of processedItems) {
                    db.run(itemSql, [
                        it.bid_id, it.item_no, it.item_name, it.spec, it.unit, it.qty,
                        it.origin_brand, it.item_note, it.buy_price, it.margin_rate,
                        it.settlement_price, it.gongsaero_fee, it.delivery_price,
                        it.total_buy_cost, it.total_settlement_price, it.total_delivery_price,
                        it.item_profit, it.created_at
                    ], (iErr) => {
                        if (iErr && !hasErr) {
                            hasErr = true;
                            db.run('ROLLBACK');
                            return reject(iErr);
                        }
                        completed++;
                        if (completed === processedItems.length && !hasErr) {
                            db.run('COMMIT');
                            resolve();
                        }
                    });
                }
            });
        });
    }).catch(err => {
        return res.status(500).json({ error: '등록 실패: ' + err.message });
    });

    res.status(201).json({ success: true, bidId, message: '입찰공고가 등록되었습니다.' });
});

// 5. 공고 및 투찰 품목 수정
router.put('/bids/:id', async (req, res) => {
    const bidId = req.params.id;
    const {
        title, client_name, bid_type, urgency, issue_date, bid_deadline,
        delivery_deadline, delivery_address, delivery_condition, delivery_method,
        shipping_included, estimated_shipping_fee, author_info, manager_info,
        status, remarks, items
    } = req.body;

    const existing = await dbGet('SELECT id FROM gongsaero_bids WHERE id = ?', [bidId]);
    if (!existing) {
        return res.status(404).json({ error: '수정할 공고를 찾을 수 없습니다.' });
    }

    const now = new Date().toISOString();
    const parsedItems = Array.isArray(items) ? items : [];
    let totalBuyCost = 0;
    let totalSettlement = 0;
    let totalFee = 0;
    let totalDeliveryAmount = 0;
    let totalProfit = 0;

    const processedItems = parsedItems.map((item, idx) => {
        const qty = parseFloat(item.qty) || 0;
        const buyPrice = Math.round(parseFloat(item.buy_price) || 0);
        const marginRate = parseFloat(item.margin_rate) || 0;
        
        let settlementPrice = Math.round(parseFloat(item.settlement_price) || 0);
        if (!settlementPrice && buyPrice > 0) {
            settlementPrice = Math.round(buyPrice * (1 + marginRate / 100));
        }

        const fee = calcGongsaeroFee(settlementPrice);
        const deliveryPrice = settlementPrice + fee;

        const itemBuyCost = buyPrice * qty;
        const itemSettlement = settlementPrice * qty;
        const itemDelivery = deliveryPrice * qty;
        const itemProfit = (settlementPrice - buyPrice) * qty;

        totalBuyCost += itemBuyCost;
        totalSettlement += itemSettlement;
        totalFee += (fee * qty);
        totalDeliveryAmount += itemDelivery;
        totalProfit += itemProfit;

        return {
            bid_id: bidId,
            item_no: item.item_no || (idx + 1),
            item_name: item.item_name || '',
            spec: item.spec || '',
            unit: item.unit || 'EA',
            qty: qty,
            origin_brand: item.origin_brand || '',
            item_note: item.item_note || '',
            buy_price: buyPrice,
            margin_rate: marginRate,
            settlement_price: settlementPrice,
            gongsaero_fee: fee,
            delivery_price: deliveryPrice,
            total_buy_cost: itemBuyCost,
            total_settlement_price: itemSettlement,
            total_delivery_price: itemDelivery,
            item_profit: itemProfit,
            created_at: now
        };
    });

    const profitRate = totalBuyCost > 0 ? Number(((totalProfit / totalBuyCost) * 100).toFixed(2)) : 0;

    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            let hasErr = false;

            const updateSql = `
                UPDATE gongsaero_bids SET
                    title = ?, client_name = ?, bid_type = ?, urgency = ?, issue_date = ?,
                    bid_deadline = ?, delivery_deadline = ?, delivery_address = ?, delivery_condition = ?,
                    delivery_method = ?, shipping_included = ?, estimated_shipping_fee = ?,
                    author_info = ?, manager_info = ?, status = ?, total_buy_cost = ?,
                    total_settlement = ?, total_fee = ?, total_delivery_amount = ?,
                    total_profit = ?, profit_rate = ?, remarks = ?, updated_at = ?
                WHERE id = ?
            `;
            const updateParams = [
                title.trim(), client_name || '', bid_type || '공개 입찰', urgency || '일반',
                issue_date || '', bid_deadline || '', delivery_deadline || '', delivery_address || '',
                delivery_condition || '하차도', delivery_method || '직접배송',
                shipping_included !== undefined ? Number(shipping_included) : 1,
                Number(estimated_shipping_fee) || 0,
                author_info || '', manager_info || '', status || '입찰중',
                totalBuyCost, totalSettlement, totalFee, totalDeliveryAmount, totalProfit, profitRate,
                remarks || '', now, bidId
            ];

            db.run(updateSql, updateParams, function(uErr) {
                if (uErr) {
                    hasErr = true;
                    db.run('ROLLBACK');
                    return reject(uErr);
                }

                // 기존 품목 교체
                db.run('DELETE FROM gongsaero_bid_items WHERE bid_id = ?', [bidId], (dErr) => {
                    if (dErr) {
                        hasErr = true;
                        db.run('ROLLBACK');
                        return reject(dErr);
                    }

                    if (processedItems.length === 0) {
                        db.run('COMMIT');
                        return resolve();
                    }

                    const itemSql = `
                        INSERT INTO gongsaero_bid_items (
                            bid_id, item_no, item_name, spec, unit, qty, origin_brand, item_note,
                            buy_price, margin_rate, settlement_price, gongsaero_fee, delivery_price,
                            total_buy_cost, total_settlement_price, total_delivery_price, item_profit, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    let completed = 0;
                    for (const it of processedItems) {
                        db.run(itemSql, [
                            it.bid_id, it.item_no, it.item_name, it.spec, it.unit, it.qty,
                            it.origin_brand, it.item_note, it.buy_price, it.margin_rate,
                            it.settlement_price, it.gongsaero_fee, it.delivery_price,
                            it.total_buy_cost, it.total_settlement_price, it.total_delivery_price,
                            it.item_profit, it.created_at
                        ], (iErr) => {
                            if (iErr && !hasErr) {
                                hasErr = true;
                                db.run('ROLLBACK');
                                return reject(iErr);
                            }
                            completed++;
                            if (completed === processedItems.length && !hasErr) {
                                db.run('COMMIT');
                                resolve();
                            }
                        });
                    }
                });
            });
        });
    }).catch(err => {
        return res.status(500).json({ error: '수정 실패: ' + err.message });
    });

    res.json({ success: true, message: '공고가 성공적으로 수정되었습니다.' });
});

// 6. 공고 상태 변경 API (입찰중 / 낙찰 / 미선정 / 입찰포기)
router.patch('/bids/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!status) {
        return res.status(400).json({ error: '변경할 상태값을 입력해주세요.' });
    }
    try {
        const now = new Date().toISOString();
        const result = await dbRun(
            'UPDATE gongsaero_bids SET status = ?, updated_at = ? WHERE id = ?',
            [status, now, req.params.id]
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: '해당 공고를 찾을 수 없습니다.' });
        }
        res.json({ success: true, status, message: `공고 상태가 '${status}'(으)로 변경되었습니다.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. 공고 삭제 API
router.delete('/bids/:id', async (req, res) => {
    try {
        await dbRun('DELETE FROM gongsaero_bid_items WHERE bid_id = ?', [req.params.id]);
        const result = await dbRun('DELETE FROM gongsaero_bids WHERE id = ?', [req.params.id]);
        if (result.changes === 0) {
            return res.status(404).json({ error: '해당 공고를 찾을 수 없습니다.' });
        }
        res.json({ success: true, message: '공고 및 관련 품목이 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    initGongsaeroBiddingTables,
    setDb
};
