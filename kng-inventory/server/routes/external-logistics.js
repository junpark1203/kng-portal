const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

module.exports = (database) => {
    // 1. 테이블 및 인덱스 초기화
    database.serialize(() => {
        database.run(`
            CREATE TABLE IF NOT EXISTS external_logistics (
                id TEXT PRIMARY KEY,
                voucher_id TEXT DEFAULT '',
                category TEXT DEFAULT '일반자재',
                date TEXT NOT NULL,
                supplier TEXT NOT NULL,
                destination TEXT NOT NULL,
                item TEXT NOT NULL,
                spec TEXT NOT NULL,
                unit TEXT DEFAULT 'EA',
                qty REAL NOT NULL DEFAULT 0,
                unit_price REAL NOT NULL DEFAULT 0,
                supply_amount REAL NOT NULL DEFAULT 0,
                vat REAL NOT NULL DEFAULT 0,
                total_amount REAL NOT NULL DEFAULT 0,
                memo TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 기존 테이블에 voucher_id 컬럼이 없을 경우 대비 안전한 마이그레이션
        database.run(`ALTER TABLE external_logistics ADD COLUMN voucher_id TEXT DEFAULT ''`, () => {});

        // 인덱스 생성
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_date ON external_logistics(date DESC)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_supplier ON external_logistics(supplier)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_destination ON external_logistics(destination)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_item ON external_logistics(item)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_spec ON external_logistics(spec)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_category ON external_logistics(category)`);
        database.run(`CREATE INDEX IF NOT EXISTS idx_ext_voucher ON external_logistics(voucher_id)`);
    });

    // Helper functions for Promise-based DB operations
    const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
        database.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });

    const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

    const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    // 고유 ID 생성 (EXT-YYYYMMDD-XXXX)
    async function generateExtId(dateStr, offset = 0) {
        const cleanDate = (dateStr || new Date().toISOString().substring(0, 10)).replace(/-/g, '');
        const prefix = `EXT-${cleanDate}-`;
        const row = await dbGet(`SELECT id FROM external_logistics WHERE id LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);
        let nextSeq = 1;
        if (row && row.id) {
            const parts = row.id.split('-');
            if (parts.length === 3) {
                const curSeq = parseInt(parts[2], 10);
                if (!isNaN(curSeq)) nextSeq = curSeq + 1;
            }
        }
        return `${prefix}${String(nextSeq + offset).padStart(4, '0')}`;
    }

    // 전표 고유 ID 생성 (EXT-V-YYYYMMDD-XXXX)
    async function generateVoucherId(dateStr) {
        const cleanDate = (dateStr || new Date().toISOString().substring(0, 10)).replace(/-/g, '');
        const prefix = `EXT-V-${cleanDate}-`;
        const row = await dbGet(`SELECT voucher_id FROM external_logistics WHERE voucher_id LIKE ? ORDER BY voucher_id DESC LIMIT 1`, [`${prefix}%`]);
        let nextSeq = 1;
        if (row && row.voucher_id) {
            const parts = row.voucher_id.split('-');
            if (parts.length >= 4) {
                const curSeq = parseInt(parts[3], 10);
                if (!isNaN(curSeq)) nextSeq = curSeq + 1;
            }
        }
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    }

    // --- 1. 품목명 자동완성 추천 목록 ---
    router.get('/suggestions/items', async (req, res) => {
        try {
            const query = (req.query.q || '').trim();
            const hasInbound = await dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name='logistics_inbound'`);
            
            let sql = `
                SELECT DISTINCT item FROM (
                    SELECT item FROM external_logistics
                    ${hasInbound ? 'UNION SELECT item FROM logistics_inbound' : ''}
                ) WHERE item IS NOT NULL AND item != ''
            `;
            let params = [];
            if (query) {
                sql += ` AND item LIKE ?`;
                params.push(`%${query}%`);
            }
            sql += ` ORDER BY item ASC LIMIT 50`;
            const rows = await dbAll(sql, params);
            res.json(rows.map(r => r.item));
        } catch (err) {
            console.error('Item suggestions error:', err);
            res.status(500).json({ error: '품목 추천 목록 조회 실패' });
        }
    });

    // --- 2. 규격 자동완성 추천 목록 (특정 품목 기준 우선) ---
    router.get('/suggestions/specs', async (req, res) => {
        try {
            const item = (req.query.item || '').trim();
            const query = (req.query.q || '').trim();
            const hasInbound = await dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name='logistics_inbound'`);

            let sql = `
                SELECT DISTINCT spec FROM (
                    SELECT spec, item FROM external_logistics
                    ${hasInbound ? 'UNION SELECT spec, item FROM logistics_inbound' : ''}
                ) WHERE spec IS NOT NULL AND spec != ''
            `;
            let params = [];
            if (item) {
                sql += ` AND item = ?`;
                params.push(item);
            }
            if (query) {
                sql += ` AND spec LIKE ?`;
                params.push(`%${query}%`);
            }
            sql += ` ORDER BY spec ASC LIMIT 50`;
            const rows = await dbAll(sql, params);
            res.json(rows.map(r => r.spec));
        } catch (err) {
            console.error('Spec suggestions error:', err);
            res.status(500).json({ error: '규격 추천 목록 조회 실패' });
        }
    });

    // --- 3. 목록 조회 (검색, 필터링, 정렬, 페이징, 합계 요약) ---
    router.get('/', async (req, res) => {
        try {
            let {
                page = 1,
                limit = 50,
                sortCol = 'date',
                sortDir = 'desc',
                startDate = '',
                endDate = '',
                category = '',
                supplier = '',
                destination = '',
                item = '',
                spec = '',
                keyword = ''
            } = req.query;

            page = parseInt(page, 10) || 1;
            limit = (limit === 'all' || parseInt(limit, 10) >= 999999) ? 999999 : (parseInt(limit, 10) || 50);
            const offset = (page - 1) * limit;

            const validSortCols = ['id', 'date', 'category', 'supplier', 'destination', 'item', 'spec', 'unit', 'qty', 'unit_price', 'supply_amount', 'vat', 'total_amount', 'created_at'];
            const safeSortCol = validSortCols.includes(sortCol) ? sortCol : 'date';
            const safeSortDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

            let whereClauses = [];
            let params = [];

            if (startDate) {
                whereClauses.push("date >= ?");
                params.push(startDate);
            }
            if (endDate) {
                whereClauses.push("date <= ?");
                params.push(endDate);
            }
            if (category && category !== '전체') {
                whereClauses.push("category = ?");
                params.push(category);
            }
            if (supplier) {
                whereClauses.push("supplier LIKE ?");
                params.push(`%${supplier.trim()}%`);
            }
            if (destination) {
                whereClauses.push("destination LIKE ?");
                params.push(`%${destination.trim()}%`);
            }
            if (item) {
                whereClauses.push("item LIKE ?");
                params.push(`%${item.trim()}%`);
            }
            if (spec) {
                whereClauses.push("spec LIKE ?");
                params.push(`%${spec.trim()}%`);
            }

            if (keyword && keyword.trim()) {
                const tokens = keyword.trim().split(/\s+/).filter(Boolean);
                tokens.forEach(token => {
                    const kw = `%${token}%`;
                    whereClauses.push("(supplier LIKE ? OR destination LIKE ? OR item LIKE ? OR spec LIKE ? OR memo LIKE ? OR category LIKE ? OR id LIKE ? OR voucher_id LIKE ?)");
                    params.push(kw, kw, kw, kw, kw, kw, kw, kw);
                });
            }

            const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

            // 1) 요약 통계 쿼리 (현재 필터 조건에 부합하는 전체 합계)
            const summarySql = `
                SELECT 
                    COUNT(*) as total_count,
                    COALESCE(SUM(qty), 0) as sum_qty,
                    COALESCE(SUM(supply_amount), 0) as sum_supply_amount,
                    COALESCE(SUM(vat), 0) as sum_vat,
                    COALESCE(SUM(total_amount), 0) as sum_total_amount,
                    CASE WHEN SUM(qty) > 0 THEN ROUND(SUM(supply_amount) / SUM(qty), 1) ELSE 0 END as avg_unit_price
                FROM external_logistics
                ${whereStr}
            `;
            const summary = await dbGet(summarySql, params);

            // 2) 실제 데이터 목록 쿼리
            let listSql = `
                SELECT * FROM external_logistics
                ${whereStr}
                ORDER BY ${safeSortCol} ${safeSortDir}, id DESC
            `;
            if (limit < 999999) {
                listSql += ` LIMIT ? OFFSET ?`;
                params.push(limit, offset);
            }

            const rows = await dbAll(listSql, params);

            res.json({
                data: rows,
                pagination: {
                    page,
                    limit,
                    total: summary ? summary.total_count : 0,
                    totalPages: summary && summary.total_count > 0 ? Math.ceil(summary.total_count / limit) : 1
                },
                summary: {
                    totalCount: summary ? summary.total_count : 0,
                    totalQty: summary ? summary.sum_qty : 0,
                    totalSupplyAmount: summary ? summary.sum_supply_amount : 0,
                    totalVat: summary ? summary.sum_vat : 0,
                    totalAmount: summary ? summary.sum_total_amount : 0,
                    avgUnitPrice: summary ? summary.avg_unit_price : 0
                }
            });
        } catch (err) {
            console.error('Get external logistics error:', err);
            res.status(500).json({ error: '외부입출내역 조회 중 오류가 발생했습니다.' });
        }
    });

    // --- 4. 통계 대시보드 데이터 (규격별 랭킹 & 시각화 집계) ---
    router.get('/statistics', async (req, res) => {
        try {
            const {
                startDate = '',
                endDate = '',
                category = '',
                item = '',
                spec = '',
                keyword = ''
            } = req.query;

            let whereClauses = [];
            let params = [];

            if (startDate) {
                whereClauses.push("date >= ?");
                params.push(startDate);
            }
            if (endDate) {
                whereClauses.push("date <= ?");
                params.push(endDate);
            }
            if (category && category !== '전체') {
                whereClauses.push("category = ?");
                params.push(category);
            }
            if (item) {
                whereClauses.push("item LIKE ?");
                params.push(`%${item.trim()}%`);
            }
            if (spec) {
                whereClauses.push("spec LIKE ?");
                params.push(`%${spec.trim()}%`);
            }
            if (keyword && keyword.trim()) {
                const tokens = keyword.trim().split(/\s+/).filter(Boolean);
                tokens.forEach(token => {
                    const kw = `%${token}%`;
                    whereClauses.push("(supplier LIKE ? OR destination LIKE ? OR item LIKE ? OR spec LIKE ? OR memo LIKE ? OR category LIKE ?)");
                    params.push(kw, kw, kw, kw, kw, kw);
                });
            }

            const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

            // 1) 전체 KPI
            const kpiSql = `
                SELECT 
                    COUNT(*) as total_records,
                    COUNT(DISTINCT item) as total_items,
                    COUNT(DISTINCT spec) as total_specs,
                    COUNT(DISTINCT destination) as total_sites,
                    COALESCE(SUM(qty), 0) as total_qty,
                    COALESCE(SUM(supply_amount), 0) as total_supply_amount,
                    COALESCE(SUM(vat), 0) as total_vat,
                    COALESCE(SUM(total_amount), 0) as total_amount,
                    CASE WHEN SUM(qty) > 0 THEN ROUND(SUM(supply_amount) / SUM(qty), 1) ELSE 0 END as avg_unit_price
                FROM external_logistics
                ${whereStr}
            `;
            const kpi = await dbGet(kpiSql, params);

            // 2) 품목명 + 규격별 세부 집계 (수량 기준 내림차순 정렬)
            const specSql = `
                SELECT 
                    item,
                    spec,
                    unit,
                    COUNT(*) as record_count,
                    COALESCE(SUM(qty), 0) as sum_qty,
                    COALESCE(SUM(supply_amount), 0) as sum_supply_amount,
                    COALESCE(SUM(vat), 0) as sum_vat,
                    COALESCE(SUM(total_amount), 0) as sum_total_amount,
                    ROUND(AVG(unit_price), 1) as avg_price,
                    MIN(unit_price) as min_price,
                    MAX(unit_price) as max_price,
                    MAX(date) as last_date,
                    (
                        SELECT GROUP_CONCAT(DISTINCT destination)
                        FROM external_logistics sub
                        WHERE sub.item = external_logistics.item AND sub.spec = external_logistics.spec
                    ) as destinations_concat,
                    (
                        SELECT GROUP_CONCAT(DISTINCT supplier)
                        FROM external_logistics sub
                        WHERE sub.item = external_logistics.item AND sub.spec = external_logistics.spec
                    ) as suppliers_concat
                FROM external_logistics
                ${whereStr}
                GROUP BY item, spec, unit
                ORDER BY sum_qty DESC, sum_supply_amount DESC
            `;
            const specRows = await dbAll(specSql, params);

            const totalQty = kpi ? (kpi.total_qty || 0) : 0;
            const specStatistics = specRows.map((row, idx) => ({
                rank: idx + 1,
                item: row.item,
                spec: row.spec,
                unit: row.unit || 'EA',
                recordCount: row.record_count,
                totalQty: row.sum_qty,
                qtyShare: totalQty > 0 ? parseFloat(((row.sum_qty / totalQty) * 100).toFixed(1)) : 0,
                totalSupplyAmount: row.sum_supply_amount,
                totalVat: row.sum_vat,
                totalAmount: row.sum_total_amount,
                avgPrice: row.avg_price,
                minPrice: row.min_price,
                maxPrice: row.max_price,
                lastDate: row.last_date,
                destinations: (row.destinations_concat || '').split(',').filter(Boolean).slice(0, 3).join(', '),
                suppliers: (row.suppliers_concat || '').split(',').filter(Boolean).slice(0, 3).join(', ')
            }));

            // 3) 월별 공급 추이 (차트 시각화용)
            const monthlySql = `
                SELECT 
                    SUBSTR(date, 1, 7) as month_str,
                    COUNT(*) as count,
                    COALESCE(SUM(qty), 0) as month_qty,
                    COALESCE(SUM(supply_amount), 0) as month_supply_amount
                FROM external_logistics
                ${whereStr}
                GROUP BY SUBSTR(date, 1, 7)
                ORDER BY month_str ASC
                LIMIT 24
            `;
            const monthlyRows = await dbAll(monthlySql, params);

            res.json({
                kpi: kpi || {},
                specStatistics,
                monthlyTrends: monthlyRows
            });
        } catch (err) {
            console.error('Get statistics error:', err);
            res.status(500).json({ error: '통계 대시보드 데이터 산출 중 오류가 발생했습니다.' });
        }
    });

    // --- 4-1. 최근 거래 단가/규격 스마트 메모리 조회 ---
    router.get('/recent-price', async (req, res) => {
        try {
            const { item, spec = '', supplier = '', destination = '' } = req.query;
            if (!item) {
                return res.json({ found: false });
            }
            let sql = `SELECT unit, spec, unit_price, vat, date, supplier, destination FROM external_logistics WHERE item = ?`;
            let params = [item.trim()];
            if (spec) {
                sql += ` AND spec = ?`;
                params.push(spec.trim());
            }
            if (supplier) {
                sql += ` AND supplier = ?`;
                params.push(supplier.trim());
            } else if (destination) {
                sql += ` AND destination = ?`;
                params.push(destination.trim());
            }
            sql += ` ORDER BY date DESC, id DESC LIMIT 1`;
            let row = await dbGet(sql, params);
            if (!row && spec) {
                // 특정 거래처 매칭 실패 시 품목 기준 전체 최신 조회
                row = await dbGet(`SELECT unit, spec, unit_price, vat, date, supplier, destination FROM external_logistics WHERE item = ? ORDER BY date DESC, id DESC LIMIT 1`, [item.trim()]);
            }
            if (row) {
                res.json({ found: true, ...row });
            } else {
                res.json({ found: false });
            }
        } catch (err) {
            console.error('Recent price error:', err);
            res.status(500).json({ error: '최근 단가 조회 오류' });
        }
    });

    // --- 4-2. 전표 다건 일괄 등록 (Batch Voucher Transaction) ---
    router.post('/batch', async (req, res) => {
        try {
            const {
                date,
                category = '일반자재',
                supplier,
                destination,
                memo = '',
                items = []
            } = req.body;

            if (!date || !supplier || !destination) {
                return res.status(400).json({ error: '전표일자, 공급처, 출고처는 필수 입력 항목입니다.' });
            }

            const validItems = (Array.isArray(items) ? items : []).filter(it => it && (it.item || '').trim() && (parseFloat(it.qty) > 0 || parseFloat(it.unit_price) > 0));

            if (validItems.length === 0) {
                return res.status(400).json({ error: '최소 1개 이상의 유효한 품목 내역이 입력되어야 합니다.' });
            }

            const voucherId = await generateVoucherId(date);
            const cleanDate = (date || new Date().toISOString().substring(0, 10)).replace(/-/g, '');
            const prefix = `EXT-${cleanDate}-`;
            const maxRow = await dbGet(`SELECT id FROM external_logistics WHERE id LIKE ? ORDER BY id DESC LIMIT 1`, [`${prefix}%`]);
            let baseSeq = 1;
            if (maxRow && maxRow.id) {
                const parts = maxRow.id.split('-');
                if (parts.length === 3) {
                    const curSeq = parseInt(parts[2], 10);
                    if (!isNaN(curSeq)) baseSeq = curSeq + 1;
                }
            }

            await dbRun('BEGIN TRANSACTION');
            try {
                for (let i = 0; i < validItems.length; i++) {
                    const it = validItems[i];
                    const itemId = `${prefix}${String(baseSeq + i).padStart(4, '0')}`;
                    const numQty = parseFloat(it.qty) || 0;
                    const numPrice = parseFloat(it.unit_price) || 0;
                    const numSupply = it.supply_amount !== undefined && it.supply_amount !== null ? parseFloat(it.supply_amount) : Math.round(numQty * numPrice);
                    const numVat = it.vat !== undefined && it.vat !== null ? parseFloat(it.vat) : Math.round(numSupply * 0.1);
                    const numTotal = it.total_amount !== undefined && it.total_amount !== null ? parseFloat(it.total_amount) : (numSupply + numVat);

                    const sql = `
                        INSERT INTO external_logistics (
                            id, voucher_id, category, date, supplier, destination, item, spec, unit,
                            qty, unit_price, supply_amount, vat, total_amount, memo,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `;
                    await dbRun(sql, [
                        itemId, voucherId, (it.category || category || '일반자재').trim(), date,
                        supplier.trim(), destination.trim(), (it.item || '').trim(), (it.spec || '').trim(),
                        (it.unit || 'EA').trim(), numQty, numPrice, numSupply, numVat, numTotal,
                        (it.memo || memo || '').trim()
                    ]);
                }
                await dbRun('COMMIT');
                res.status(201).json({
                    message: `전표가 성공적으로 저장되었습니다. (전표번호: ${voucherId}, 총 ${validItems.length}개 품목)`,
                    voucher_id: voucherId,
                    count: validItems.length
                });
            } catch (txErr) {
                await dbRun('ROLLBACK');
                throw txErr;
            }
        } catch (err) {
            console.error('Batch voucher create error:', err);
            res.status(500).json({ error: '전표 저장 중 오류가 발생했습니다: ' + err.message });
        }
    });

    // --- 5. 단건 신규 등록 ---
    router.post('/', async (req, res) => {
        try {
            const {
                date,
                category = '일반자재',
                supplier,
                destination,
                item,
                spec,
                unit = 'EA',
                qty,
                unit_price = 0,
                supply_amount,
                vat,
                total_amount,
                memo = ''
            } = req.body;

            if (!date || !supplier || !destination || !item || !spec || qty === undefined || qty === null) {
                return res.status(400).json({ error: '일자, 공급처, 출고처, 품목명, 규격, 수량은 필수 항목입니다.' });
            }

            const numQty = parseFloat(qty) || 0;
            const numPrice = parseFloat(unit_price) || 0;
            const numSupply = supply_amount !== undefined && supply_amount !== null ? parseFloat(supply_amount) : Math.round(numQty * numPrice);
            const numVat = vat !== undefined && vat !== null ? parseFloat(vat) : Math.round(numSupply * 0.1);
            const numTotal = total_amount !== undefined && total_amount !== null ? parseFloat(total_amount) : (numSupply + numVat);

            const newId = await generateExtId(date);

            const sql = `
                INSERT INTO external_logistics (
                    id, category, date, supplier, destination, item, spec, unit,
                    qty, unit_price, supply_amount, vat, total_amount, memo,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;

            await dbRun(sql, [
                newId, category || '일반자재', date, supplier.trim(), destination.trim(),
                item.trim(), spec.trim(), unit || 'EA',
                numQty, numPrice, numSupply, numVat, numTotal, (memo || '').trim()
            ]);

            res.status(201).json({ message: '외부입출내역이 정상 등록되었습니다.', id: newId });
        } catch (err) {
            console.error('Create external logistics error:', err);
            res.status(500).json({ error: '등록 처리 중 오류가 발생했습니다.' });
        }
    });

    // --- 6. 단건 수정 ---
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const {
                date,
                category = '일반자재',
                supplier,
                destination,
                item,
                spec,
                unit = 'EA',
                qty,
                unit_price = 0,
                supply_amount,
                vat,
                total_amount,
                memo = ''
            } = req.body;

            if (!date || !supplier || !destination || !item || !spec || qty === undefined || qty === null) {
                return res.status(400).json({ error: '일자, 공급처, 출고처, 품목명, 규격, 수량은 필수 항목입니다.' });
            }

            const numQty = parseFloat(qty) || 0;
            const numPrice = parseFloat(unit_price) || 0;
            const numSupply = supply_amount !== undefined && supply_amount !== null ? parseFloat(supply_amount) : Math.round(numQty * numPrice);
            const numVat = vat !== undefined && vat !== null ? parseFloat(vat) : Math.round(numSupply * 0.1);
            const numTotal = total_amount !== undefined && total_amount !== null ? parseFloat(total_amount) : (numSupply + numVat);

            const sql = `
                UPDATE external_logistics SET 
                    date = ?, category = ?, supplier = ?, destination = ?,
                    item = ?, spec = ?, unit = ?, qty = ?, unit_price = ?,
                    supply_amount = ?, vat = ?, total_amount = ?, memo = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;

            const result = await dbRun(sql, [
                date, category || '일반자재', supplier.trim(), destination.trim(),
                item.trim(), spec.trim(), unit || 'EA',
                numQty, numPrice, numSupply, numVat, numTotal, (memo || '').trim(),
                id
            ]);

            if (result.changes === 0) {
                return res.status(404).json({ error: '해당 내역을 찾을 수 없습니다.' });
            }

            res.json({ message: '내역이 성공적으로 수정되었습니다.' });
        } catch (err) {
            console.error('Update external logistics error:', err);
            res.status(500).json({ error: '수정 처리 중 오류가 발생했습니다.' });
        }
    });

    // --- 7. 단건 삭제 ---
    router.delete('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const result = await dbRun(`DELETE FROM external_logistics WHERE id = ?`, [id]);
            if (result.changes === 0) {
                return res.status(404).json({ error: '해당 내역을 찾을 수 없습니다.' });
            }
            res.json({ message: '내역이 삭제되었습니다.' });
        } catch (err) {
            console.error('Delete external logistics error:', err);
            res.status(500).json({ error: '삭제 처리 중 오류가 발생했습니다.' });
        }
    });

    // --- 8. 선택 일괄 삭제 ---
    router.post('/batch-delete', async (req, res) => {
        try {
            const { ids } = req.body;
            if (!ids || !Array.isArray(ids) || ids.length === 0) {
                return res.status(400).json({ error: '삭제할 대상 ID 목록이 올바르지 않습니다.' });
            }

            const placeholders = ids.map(() => '?').join(',');
            const result = await dbRun(`DELETE FROM external_logistics WHERE id IN (${placeholders})`, ids);
            res.json({ message: `총 ${result.changes}건의 내역이 일괄 삭제되었습니다.` });
        } catch (err) {
            console.error('Batch delete error:', err);
            res.status(500).json({ error: '일괄 삭제 처리 중 오류가 발생했습니다.' });
        }
    });

    // --- 8-1. 메인 그리드 인라인 퀵 편집 (Direct Inline Edit) ---
    router.patch('/:id/inline', async (req, res) => {
        try {
            const { id } = req.params;
            const { field, value } = req.body;

            const row = await dbGet(`SELECT * FROM external_logistics WHERE id = ?`, [id]);
            if (!row) {
                return res.status(404).json({ error: '수정할 항목을 찾을 수 없습니다.' });
            }

            const allowedFields = ['date', 'category', 'supplier', 'destination', 'item', 'spec', 'unit', 'qty', 'unit_price', 'memo', 'vat'];
            if (!allowedFields.includes(field)) {
                return res.status(400).json({ error: '수정할 수 없는 항목입니다.' });
            }

            let newQty = row.qty;
            let newPrice = row.unit_price;
            let newVat = row.vat;
            let newSupply = row.supply_amount;
            let newTotal = row.total_amount;

            if (field === 'qty') {
                newQty = parseFloat(value) || 0;
                newSupply = Math.round(newQty * newPrice);
                newVat = Math.round(newSupply * 0.1);
                newTotal = newSupply + newVat;
            } else if (field === 'unit_price') {
                newPrice = parseFloat(value) || 0;
                newSupply = Math.round(newQty * newPrice);
                newVat = Math.round(newSupply * 0.1);
                newTotal = newSupply + newVat;
            } else if (field === 'vat') {
                newVat = parseFloat(value) || 0;
                newTotal = newSupply + newVat;
            }

            let updateSql = `
                UPDATE external_logistics SET
                    ${field} = ?,
                    qty = ?,
                    unit_price = ?,
                    supply_amount = ?,
                    vat = ?,
                    total_amount = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `;
            await dbRun(updateSql, [value, newQty, newPrice, newSupply, newVat, newTotal, id]);

            const updatedRow = await dbGet(`SELECT * FROM external_logistics WHERE id = ?`, [id]);
            res.json({ message: '정상 수정되었습니다.', record: updatedRow });
        } catch (err) {
            console.error('Inline update error:', err);
            res.status(500).json({ error: '인라인 수정 중 오류가 발생했습니다: ' + err.message });
        }
    });

    // --- 8-2. 전표 단위 일괄 삭제 ---
    router.delete('/voucher/:voucher_id', async (req, res) => {
        try {
            const { voucher_id } = req.params;
            const result = await dbRun(`DELETE FROM external_logistics WHERE voucher_id = ?`, [voucher_id]);
            res.json({ message: '해당 전표의 모든 내역이 삭제되었습니다.', voucher_id, deletedCount: result.changes });
        } catch (err) {
            console.error('Delete voucher error:', err);
            res.status(500).json({ error: '전표 삭제 중 오류가 발생했습니다.' });
        }
    });

    // --- 9. 엑셀 등록 템플릿 다운로드 (ExcelJS) ---
    router.get('/template', async (req, res) => {
        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('외부입출_업로드양식');

            worksheet.columns = [
                { header: '일자 (YYYY-MM-DD)', key: 'date', width: 18 },
                { header: '분류', key: 'category', width: 15 },
                { header: '공급처', key: 'supplier', width: 22 },
                { header: '출고처(현장명)', key: 'destination', width: 25 },
                { header: '품목명', key: 'item', width: 25 },
                { header: '규격', key: 'spec', width: 20 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '수량', key: 'qty', width: 14 },
                { header: '납품단가', key: 'unit_price', width: 16 },
                { header: '비고', key: 'memo', width: 30 }
            ];

            // 헤더 스타일
            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            // 샘플 데이터
            worksheet.addRow({
                date: '2026-09-14',
                category: '안전자재',
                supplier: '양지유화',
                destination: '김포복합현장',
                item: '부직포',
                spec: '2m x 50m',
                unit: '롤',
                qty: 500,
                unit_price: 14500,
                memo: '경쟁사 납품건 참고'
            });
            worksheet.addRow({
                date: '2026-09-14',
                category: '안전자재',
                supplier: '대한산업',
                destination: '인천물류센터',
                item: '부직포',
                spec: '1m x 50m',
                unit: '롤',
                qty: 200,
                unit_price: 8200,
                memo: '시장 단가 파악'
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="external_logistics_template.xlsx"');

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            console.error('Download template error:', err);
            res.status(500).json({ error: '엑셀 양식 생성 실패: ' + err.message });
        }
    });

    // --- 10. 엑셀 일괄 업로드 (ExcelJS) ---
    router.post('/upload', upload.single('file'), async (req, res) => {
        try {
            if (!req.file || !req.file.buffer) {
                return res.status(400).json({ error: '엑셀 파일이 업로드되지 않았습니다.' });
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(req.file.buffer);
            const worksheet = workbook.worksheets[0];

            if (!worksheet) {
                return res.status(400).json({ error: '유효한 시트를 찾을 수 없습니다.' });
            }

            let headerMap = {};
            let successCount = 0;
            let errorCount = 0;

            const rowsToInsert = [];

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) {
                    row.eachCell((cell, colNumber) => {
                        const text = String(cell.value || '').trim();
                        if (text.includes('일자')) headerMap.date = colNumber;
                        else if (text.includes('분류')) headerMap.category = colNumber;
                        else if (text.includes('공급처') || text.includes('매입처')) headerMap.supplier = colNumber;
                        else if (text.includes('출고처') || text.includes('현장명') || text.includes('매출처')) headerMap.destination = colNumber;
                        else if (text.includes('품목명')) headerMap.item = colNumber;
                        else if (text.includes('규격')) headerMap.spec = colNumber;
                        else if (text.includes('단위')) headerMap.unit = colNumber;
                        else if (text.includes('수량')) headerMap.qty = colNumber;
                        else if (text.includes('단가')) headerMap.unit_price = colNumber;
                        else if (text.includes('비고')) headerMap.memo = colNumber;
                    });
                } else {
                    const rawDate = headerMap.date ? row.getCell(headerMap.date).value : '';
                    const rawCat = headerMap.category ? row.getCell(headerMap.category).value : '일반자재';
                    const rawSupp = headerMap.supplier ? row.getCell(headerMap.supplier).value : '';
                    const rawDest = headerMap.destination ? row.getCell(headerMap.destination).value : '';
                    const rawItem = headerMap.item ? row.getCell(headerMap.item).value : '';
                    const rawSpec = headerMap.spec ? row.getCell(headerMap.spec).value : '';
                    const rawUnit = headerMap.unit ? row.getCell(headerMap.unit).value : 'EA';
                    const rawQty = headerMap.qty ? row.getCell(headerMap.qty).value : 0;
                    const rawPrice = headerMap.unit_price ? row.getCell(headerMap.unit_price).value : 0;
                    const rawMemo = headerMap.memo ? row.getCell(headerMap.memo).value : '';

                    if (!rawDate || !rawSupp || !rawDest || !rawItem || !rawSpec) {
                        errorCount++;
                        return;
                    }

                    let dateStr = '';
                    if (rawDate instanceof Date) {
                        dateStr = rawDate.toISOString().substring(0, 10);
                    } else if (typeof rawDate === 'object' && rawDate.text) {
                        dateStr = String(rawDate.text).trim().replace(/\./g, '-').substring(0, 10);
                    } else {
                        dateStr = String(rawDate).trim().replace(/\./g, '-').substring(0, 10);
                    }

                    const numQty = parseFloat(rawQty) || 0;
                    const numPrice = parseFloat(rawPrice) || 0;
                    const numSupply = Math.round(numQty * numPrice);
                    const numVat = Math.round(numSupply * 0.1);
                    const numTotal = numSupply + numVat;

                    rowsToInsert.push({
                        date: dateStr,
                        category: rawCat ? String(rawCat).trim() : '일반자재',
                        supplier: String(rawSupp).trim(),
                        destination: String(rawDest).trim(),
                        item: String(rawItem).trim(),
                        spec: String(rawSpec).trim(),
                        unit: rawUnit ? String(rawUnit).trim() : 'EA',
                        qty: numQty,
                        unit_price: numPrice,
                        supply_amount: numSupply,
                        vat: numVat,
                        total_amount: numTotal,
                        memo: rawMemo ? String(rawMemo).trim() : ''
                    });
                }
            });

            for (let item of rowsToInsert) {
                const newId = await generateExtId(item.date);
                const sql = `
                    INSERT INTO external_logistics (
                        id, category, date, supplier, destination, item, spec, unit,
                        qty, unit_price, supply_amount, vat, total_amount, memo,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
                await dbRun(sql, [
                    newId, item.category, item.date, item.supplier, item.destination,
                    item.item, item.spec, item.unit, item.qty, item.unit_price,
                    item.supply_amount, item.vat, item.total_amount, item.memo
                ]);
                successCount++;
            }

            res.json({
                message: `엑셀 일괄 업로드 완료 (성공: ${successCount}건, 실패/제외: ${errorCount}건)`,
                successCount,
                errorCount
            });
        } catch (err) {
            console.error('Excel upload error:', err);
            res.status(500).json({ error: '엑셀 데이터 처리 중 오류가 발생했습니다: ' + err.message });
        }
    });

    // --- 11. 현재 내역 엑셀 내보내기 (ExcelJS) ---
    router.get('/export', async (req, res) => {
        try {
            const { startDate = '', endDate = '', category = '', supplier = '', destination = '', item = '', spec = '', keyword = '' } = req.query;
            let whereClauses = [];
            let params = [];

            if (startDate) { whereClauses.push("date >= ?"); params.push(startDate); }
            if (endDate) { whereClauses.push("date <= ?"); params.push(endDate); }
            if (category && category !== '전체') { whereClauses.push("category = ?"); params.push(category); }
            if (supplier) { whereClauses.push("supplier LIKE ?"); params.push(`%${supplier.trim()}%`); }
            if (destination) { whereClauses.push("destination LIKE ?"); params.push(`%${destination.trim()}%`); }
            if (item) { whereClauses.push("item LIKE ?"); params.push(`%${item.trim()}%`); }
            if (spec) { whereClauses.push("spec LIKE ?"); params.push(`%${spec.trim()}%`); }
            if (keyword && keyword.trim()) {
                const tokens = keyword.trim().split(/\s+/).filter(Boolean);
                tokens.forEach(token => {
                    const kw = `%${token}%`;
                    whereClauses.push("(supplier LIKE ? OR destination LIKE ? OR item LIKE ? OR spec LIKE ? OR memo LIKE ? OR category LIKE ?)");
                    params.push(kw, kw, kw, kw, kw, kw);
                });
            }

            const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            const sql = `SELECT * FROM external_logistics ${whereStr} ORDER BY date DESC, id DESC`;
            const rows = await dbAll(sql, params);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('외부입출내역');

            worksheet.columns = [
                { header: '고유식별자', key: 'id', width: 20 },
                { header: '일자', key: 'date', width: 14 },
                { header: '분류', key: 'category', width: 14 },
                { header: '공급처', key: 'supplier', width: 22 },
                { header: '출고처(현장명)', key: 'destination', width: 24 },
                { header: '품목명', key: 'item', width: 22 },
                { header: '규격', key: 'spec', width: 18 },
                { header: '단위', key: 'unit', width: 10 },
                { header: '수량', key: 'qty', width: 14 },
                { header: '납품단가', key: 'unit_price', width: 16 },
                { header: '공급가액', key: 'supply_amount', width: 18 },
                { header: '부가세', key: 'vat', width: 14 },
                { header: '합계금액', key: 'total_amount', width: 18 },
                { header: '비고', key: 'memo', width: 30 }
            ];

            worksheet.getRow(1).font = { bold: true };
            worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };

            rows.forEach(r => {
                worksheet.addRow({
                    id: r.id,
                    date: r.date,
                    category: r.category,
                    supplier: r.supplier,
                    destination: r.destination,
                    item: r.item,
                    spec: r.spec,
                    unit: r.unit,
                    qty: r.qty,
                    unit_price: r.unit_price,
                    supply_amount: r.supply_amount,
                    vat: r.vat,
                    total_amount: r.total_amount,
                    memo: r.memo
                });
            });

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="external_logistics_export.xlsx"');

            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            console.error('Export error:', err);
            res.status(500).json({ error: '엑셀 내보내기 실패: ' + err.message });
        }
    });

    return router;
};
