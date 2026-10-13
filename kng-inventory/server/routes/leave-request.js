const express = require('express');
const router = express.Router();
const { generateLeavePdf } = require('../services/leave-pdf');
const { registerLeaveToGoogleCalendar, removeLeaveFromGoogleCalendar } = require('../services/google-calendar');

let _db;

// DB 설정 함수 (server.js에서 호출)
function setDb(dbInstance) {
    _db = dbInstance;
}

// DB Promise 헬퍼
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.run(sql, params, function(err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

// 테이블 초기화 및 스키마 마이그레이션 함수
async function initLeaveRequestTables(db) {
    _db = db;
    // 1. 휴가원 신청 내역 테이블
    await dbRun(`
        CREATE TABLE IF NOT EXISTS leave_requests (
            id TEXT PRIMARY KEY,
            userEmail TEXT,
            department TEXT,
            rank TEXT,
            name TEXT,
            leaveStart TEXT,
            leaveEnd TEXT,
            leaveType TEXT,
            daysCount REAL DEFAULT 1.0,
            status TEXT DEFAULT '결재요청',
            reason TEXT,
            submitDate TEXT,
            googleEventId TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    // 컬럼 마이그레이션 (기존 테이블 호환)
    const cols = await dbAll(`PRAGMA table_info(leave_requests)`);
    const colNames = cols.map(c => c.name);

    if (!colNames.includes('userEmail')) {
        await dbRun(`ALTER TABLE leave_requests ADD COLUMN userEmail TEXT`);
    }
    if (!colNames.includes('daysCount')) {
        await dbRun(`ALTER TABLE leave_requests ADD COLUMN daysCount REAL DEFAULT 1.0`);
    }
    if (!colNames.includes('status')) {
        await dbRun(`ALTER TABLE leave_requests ADD COLUMN status TEXT DEFAULT '결재요청'`);
    }
    if (!colNames.includes('updatedAt')) {
        await dbRun(`ALTER TABLE leave_requests ADD COLUMN updatedAt TEXT`);
    }
    if (!colNames.includes('googleEventId')) {
        await dbRun(`ALTER TABLE leave_requests ADD COLUMN googleEventId TEXT`);
    }

    // 2. 계정별 연차 대장(기준 부여일수) 테이블
    await dbRun(`
        CREATE TABLE IF NOT EXISTS leave_allowances (
            userEmail TEXT PRIMARY KEY,
            userName TEXT,
            department TEXT,
            totalDays REAL DEFAULT 15.0,
            year INTEGER DEFAULT 2026,
            updatedAt TEXT
        )
    `);

    // 기본 계정 시드 (박준영 차장: 13.0일)
    await dbRun(`
        INSERT OR IGNORE INTO leave_allowances (userEmail, userName, department, totalDays, year, updatedAt)
        VALUES ('jpark120325@gmail.com', '박준영', '주식회사 케앤지', 13.0, 2026, datetime('now', 'localtime'))
    `);

    console.log('[LeaveRequest] 테이블 및 스키마 마이그레이션 완료');
}

// ─────────────────────────────────────────────────────────────
// 1. 계정별 연차 대장 (기준일수) API
// ─────────────────────────────────────────────────────────────

// 1-1. 전체 직원 기준 연차 목록 조회 (설정 팝업용)
router.get('/allowances', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const rows = await dbAll(`SELECT * FROM leave_allowances ORDER BY userName ASC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1-2. 직원 기준 연차 설정 등록/수정
router.post('/allowances', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const { userEmail, userName, department, totalDays, year } = req.body;
    if (!userEmail) return res.status(400).json({ error: '계정 이메일(userEmail)은 필수입니다.' });

    const targetYear = Number(year) || new Date().getFullYear();
    const days = Number(totalDays) || 15.0;
    const now = new Date().toISOString();

    try {
        await dbRun(`
            INSERT INTO leave_allowances (userEmail, userName, department, totalDays, year, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(userEmail) DO UPDATE SET
                userName = excluded.userName,
                department = excluded.department,
                totalDays = excluded.totalDays,
                year = excluded.year,
                updatedAt = excluded.updatedAt
        `, [userEmail.trim(), (userName || '').trim(), (department || '').trim(), days, targetYear, now]);

        res.json({ message: '기준 연차가 저장되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 1-3. 내 연차 요약 정보 조회 (로그인 계정 기준 실시간 계산)
router.get('/my-summary', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const userEmail = (req.query.email || (req.user ? req.user.email : null) || '').trim();
    const currentYear = Number(req.query.year) || new Date().getFullYear();

    try {
        // 기준 연차 정보 조회
        let allowance = null;
        if (userEmail) {
            allowance = await dbGet(`SELECT * FROM leave_allowances WHERE userEmail = ? AND year = ?`, [userEmail, currentYear]);
            if (!allowance) {
                allowance = await dbGet(`SELECT * FROM leave_allowances WHERE userEmail = ?`, [userEmail]);
            }
        }

        const totalDays = allowance ? Number(allowance.totalDays) : 15.0;
        const userName = allowance ? allowance.userName : '';
        const department = allowance ? allowance.department : '주식회사 케앤지';

        // 올해 사용한 연차 계산 (결재보류/반려 건 제외)
        // userEmail 또는 userName으로 매칭
        const yearPrefix = `${currentYear}%`;
        const leaves = await dbAll(`
            SELECT daysCount, status, leaveType, leaveStart
            FROM leave_requests
            WHERE (leaveStart LIKE ? OR submitDate LIKE ?)
              AND (userEmail = ? OR (userEmail IS NULL AND name = ?))
        `, [yearPrefix, yearPrefix, userEmail, userName]);

        let usedDays = 0;
        let approvedDays = 0;
        let pendingDays = 0;

        leaves.forEach(l => {
            const count = Number(l.daysCount) || 1.0;
            if (l.status === '결재완료') {
                approvedDays += count;
                usedDays += count;
            } else if (l.status === '결재요청' || l.status === '결재진행중') {
                pendingDays += count;
                usedDays += count; // 신청 중인 건도 잔여 계산 시 차감 표시
            }
        });

        const remainDays = Math.max(0, Number((totalDays - usedDays).toFixed(2)));

        res.json({
            userEmail,
            userName,
            department,
            currentYear,
            totalDays,
            usedDays: Number(usedDays.toFixed(2)),
            approvedDays: Number(approvedDays.toFixed(2)),
            pendingDays: Number(pendingDays.toFixed(2)),
            remainDays
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 2. 휴가원 신청 내역 CRUD API
// ─────────────────────────────────────────────────────────────

// 2-1. 전체 휴가원 목록 조회 (검색 및 필터 지원)
router.get('/', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const rows = await dbAll(`SELECT * FROM leave_requests ORDER BY createdAt DESC`);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-2. 단일 휴가원 조회
router.get('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const row = await dbGet('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '휴가원을 찾을 수 없습니다.' });
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-3. 새 휴가원 작성
router.post('/', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    const p = req.body;
    const id = 'LR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const now = new Date().toISOString();
    const status = p.status || '결재요청';
    const daysCount = Number(p.daysCount) || 1.0;
    const userEmail = (p.userEmail || (req.user ? req.user.email : '') || '').trim();

    try {
        const sql = `
            INSERT INTO leave_requests (
                id, userEmail, department, rank, name, leaveStart, leaveEnd, leaveType, daysCount, status, reason, submitDate, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const params = [
            id,
            userEmail,
            p.department || '주식회사 케앤지',
            p.rank || '',
            p.name || '',
            p.leaveStart || '',
            p.leaveEnd || '',
            p.leaveType || '연차',
            daysCount,
            status,
            p.reason || '',
            p.submitDate || '',
            now,
            now
        ];

        await dbRun(sql, params);

        // 만약 최초 등록부터 결재완료 상태라면 캘린더 등록
        if (status === '결재완료') {
            const leaveDoc = { ...p, id, daysCount };
            registerLeaveToGoogleCalendar(leaveDoc).then(async (eventId) => {
                if (eventId) {
                    await dbRun(`UPDATE leave_requests SET googleEventId = ? WHERE id = ?`, [eventId, id]);
                }
            }).catch(e => console.error(e));
        }

        res.status(201).json({ message: '휴가원 등록 성공', id: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-4. 기존 휴가원 수정
router.put('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    const p = req.body;
    const now = new Date().toISOString();
    const daysCount = Number(p.daysCount) || 1.0;

    try {
        const prev = await dbGet('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
        if (!prev) return res.status(404).json({ error: '수정할 항목을 찾을 수 없습니다.' });

        const sql = `
            UPDATE leave_requests SET 
                department = ?, rank = ?, name = ?, leaveStart = ?, leaveEnd = ?, leaveType = ?, daysCount = ?, reason = ?, submitDate = ?, updatedAt = ?
            WHERE id = ?
        `;
        const params = [
            p.department || '', 
            p.rank || '', 
            p.name || '', 
            p.leaveStart || '', 
            p.leaveEnd || '', 
            p.leaveType || '', 
            daysCount,
            p.reason || '', 
            p.submitDate || '', 
            now,
            req.params.id
        ];
        
        await dbRun(sql, params);
        res.json({ message: '휴가원 수정 완료' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-5. 결재 상태 변경 API (대시보드 결재대기함 및 목록에서 호출)
router.put('/:id/status', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: '변경할 status 값이 필요합니다.' });

    const now = new Date().toISOString();

    try {
        const item = await dbGet('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: '해당 휴가원을 찾을 수 없습니다.' });

        const prevStatus = item.status;
        let googleEventId = item.googleEventId;

        // 1) 상태가 '결재완료'로 변경될 때 ➔ 구글 캘린더 등록
        if (status === '결재완료' && prevStatus !== '결재완료') {
            const eventId = await registerLeaveToGoogleCalendar(item);
            if (eventId) googleEventId = eventId;
        } 
        // 2) '결재완료'에서 '결재보류'/'임시작성' 등으로 반려/취소될 때 ➔ 구글 캘린더에서 삭제
        else if (status !== '결재완료' && prevStatus === '결재완료' && googleEventId) {
            await removeLeaveFromGoogleCalendar(googleEventId);
            googleEventId = null;
        }

        await dbRun(`
            UPDATE leave_requests 
            SET status = ?, googleEventId = ?, updatedAt = ? 
            WHERE id = ?
        `, [status, googleEventId, now, req.params.id]);

        res.json({ message: '휴가원 상태가 변경되었습니다.', status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2-6. 휴가원 삭제
router.delete('/:id', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    
    try {
        const item = await dbGet('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: '삭제할 항목을 찾을 수 없습니다.' });

        // 캘린더 이벤트가 연동되어 있다면 캘린더에서도 함께 삭제
        if (item.googleEventId) {
            await removeLeaveFromGoogleCalendar(item.googleEventId);
        }

        await dbRun('DELETE FROM leave_requests WHERE id = ?', [req.params.id]);
        res.json({ message: '휴가원 삭제 완료' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// 3. 휴가원 원본 1:1 정품 PDF 생성 및 출력
// ─────────────────────────────────────────────────────────────

async function serveLeavePdf(data, res) {
    try {
        const pdfBuffer = await generateLeavePdf(data);
        const fileName = encodeURIComponent(`휴가원_${data.name || '신청'}_${data.submitDate || ''}.pdf`);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"; filename*=UTF-8''${fileName}`);
        res.setHeader('Content-Length', pdfBuffer.length);
        return res.end(pdfBuffer);
    } catch (err) {
        console.error('PDF generation error:', err);
        return res.status(500).json({ error: 'PDF 생성에 실패했습니다.', details: err.message });
    }
}

router.get('/:id/pdf', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const row = await dbGet('SELECT * FROM leave_requests WHERE id = ?', [req.params.id]);
        if (!row) return res.status(404).json({ error: '휴가원을 찾을 수 없습니다.' });
        serveLeavePdf(row, res);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/preview-pdf', (req, res) => {
    serveLeavePdf(req.body, res);
});

module.exports = {
    router,
    setDb,
    initLeaveRequestTables
};
