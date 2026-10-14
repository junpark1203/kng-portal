const express = require('express');
const router = express.Router();

let _db;

function setDb(dbInstance) {
    _db = dbInstance;
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        _db.run(sql, params, function (err) {
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

// ─────────────────────────────────────────────────────────────
// DB 테이블 초기화 및 마이그레이션
// ─────────────────────────────────────────────────────────────
async function initAdminUsersTables(db) {
    _db = db;

    // 1. 포털 통합 사용자 & 권한 테이블
    await dbRun(`
        CREATE TABLE IF NOT EXISTS portal_users (
            email TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            department TEXT DEFAULT '주식회사 케앤지',
            rank TEXT DEFAULT '사원',
            role TEXT DEFAULT 'user',
            leaveDays REAL DEFAULT 15.0,
            hireDate TEXT,
            status TEXT DEFAULT 'active',
            menuPermissions TEXT DEFAULT '["all"]',
            memo TEXT,
            createdAt TEXT,
            updatedAt TEXT
        )
    `);

    // 2. 기본 계정 시드 (박준영 차장 - 슈퍼관리자)
    const existing = await dbGet(`SELECT email FROM portal_users WHERE email = 'jpark120325@gmail.com'`);
    if (!existing) {
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO portal_users (email, name, department, rank, role, leaveDays, hireDate, status, menuPermissions, memo, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'jpark120325@gmail.com',
            '박준영',
            '주식회사 케앤지',
            '차장',
            'admin',
            13.0,
            '2021-01-01',
            'active',
            JSON.stringify(['all']),
            '시스템 슈퍼 관리자',
            now,
            now
        ]);
        console.log('[AdminUsers] 슈퍼관리자 기본 계정 시드 완료 (jpark120325@gmail.com)');
    }

    // 2-2. 기본 계정 시드 (케앤지 대표 계정: zpdoswl@naver.com)
    const existingCeo = await dbGet(`SELECT email FROM portal_users WHERE email = 'zpdoswl@naver.com'`);
    if (!existingCeo) {
        const now = new Date().toISOString();
        await dbRun(`
            INSERT INTO portal_users (email, name, department, rank, role, leaveDays, hireDate, status, menuPermissions, memo, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            'zpdoswl@naver.com',
            '윤종',
            '주식회사 케앤지',
            '대표이사',
            'admin',
            15.0,
            '2020-01-01',
            'active',
            JSON.stringify(['all']),
            '주식회사 케앤지 대표 계정',
            now,
            now
        ]);
        console.log('[AdminUsers] 대표 계정 기본 시드 완료 (zpdoswl@naver.com)');
    }

    // 3. 기존 leave_allowances 테이블이 있으면 데이터 마이그레이션 동기화
    try {
        const allowances = await dbAll(`SELECT * FROM leave_allowances`);
        for (const a of allowances) {
            const user = await dbGet(`SELECT email FROM portal_users WHERE email = ?`, [a.userEmail]);
            if (!user && a.userEmail) {
                const now = new Date().toISOString();
                await dbRun(`
                    INSERT OR IGNORE INTO portal_users (email, name, department, rank, role, leaveDays, status, menuPermissions, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    a.userEmail,
                    a.userName || a.userEmail.split('@')[0],
                    a.department || '주식회사 케앤지',
                    '사원',
                    'user',
                    a.totalDays || 15.0,
                    'active',
                    JSON.stringify(['all']),
                    now,
                    now
                ]);
            }
        }
    } catch (e) {
        // leave_allowances 테이블이 없으면 무시
    }

    console.log('[AdminUsers] 포털 통합 사용자 및 권한 테이블 준비 완료');
}

// ─────────────────────────────────────────────────────────────
// API 엔드포인트
// ─────────────────────────────────────────────────────────────

// [공통] 현재 로그인한 사용자 본인의 프로필 및 권한 조회
router.get('/my-profile', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const userEmail = req.user ? req.user.email : (req.query.email || '');

    if (!userEmail) {
        return res.status(401).json({ error: '인증 정보가 없습니다.' });
    }

    try {
        let user = await dbGet(`SELECT * FROM portal_users WHERE email = ?`, [userEmail]);
        if (!user) {
            // 미등록 계정이면 기본 프로필 반환 (관리자 여부는 jpark, zpdoswl 이메일 기반 기본 허용)
            const isAdmin = userEmail === 'jpark120325@gmail.com' || userEmail === 'zpdoswl@naver.com';
            user = {
                email: userEmail,
                name: userEmail.split('@')[0],
                department: '주식회사 케앤지',
                rank: '사원',
                role: isAdmin ? 'admin' : 'user',
                leaveDays: 15.0,
                status: 'active',
                menuPermissions: JSON.stringify(['all'])
            };
        }

        try {
            user.menuPermissions = JSON.parse(user.menuPermissions || '["all"]');
        } catch (e) {
            user.menuPermissions = ['all'];
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [관리자 전용] 전체 사용자 계정 및 권한 목록 조회
router.get('/users', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const rows = await dbAll(`SELECT * FROM portal_users ORDER BY role = 'admin' DESC, name ASC`);
        const formatted = rows.map(r => {
            let perms = ['all'];
            try { perms = JSON.parse(r.menuPermissions || '["all"]'); } catch (e) {}
            return { ...r, menuPermissions: perms };
        });
        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [관리자 전용] 특정 사용자 상세 조회
router.get('/users/:email', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    try {
        const user = await dbGet(`SELECT * FROM portal_users WHERE email = ?`, [req.params.email]);
        if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
        try {
            user.menuPermissions = JSON.parse(user.menuPermissions || '["all"]');
        } catch (e) {
            user.menuPermissions = ['all'];
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [관리자 전용] 신규 사용자 계정 등록
router.post('/users', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const { email, name, department, rank, role, leaveDays, hireDate, status, menuPermissions, memo } = req.body;

    if (!email || !name) {
        return res.status(400).json({ error: '이메일(계정 ID)과 사원명은 필수 항목입니다.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanDept = (department || '주식회사 케앤지').trim();
    const cleanRank = (rank || '사원').trim();
    const cleanRole = role === 'admin' ? 'admin' : (role === 'manager' ? 'manager' : 'user');
    const cleanLeaveDays = Number(leaveDays) || 15.0;
    const cleanStatus = status === 'inactive' ? 'inactive' : 'active';
    const cleanPerms = Array.isArray(menuPermissions) ? JSON.stringify(menuPermissions) : (typeof menuPermissions === 'string' ? menuPermissions : '["all"]');
    const now = new Date().toISOString();

    try {
        // 이미 등록된 이메일 체크
        const existing = await dbGet(`SELECT email FROM portal_users WHERE email = ?`, [cleanEmail]);
        if (existing) {
            return res.status(409).json({ error: '이미 등록된 계정 이메일입니다.' });
        }

        await dbRun(`
            INSERT INTO portal_users (email, name, department, rank, role, leaveDays, hireDate, status, menuPermissions, memo, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            cleanEmail, cleanName, cleanDept, cleanRank, cleanRole,
            cleanLeaveDays, hireDate || '', cleanStatus, cleanPerms, memo || '',
            now, now
        ]);

        // 휴가원 연차 대장(leave_allowances) 동시 동기화
        try {
            await dbRun(`
                INSERT INTO leave_allowances (userEmail, userName, department, totalDays, year, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(userEmail) DO UPDATE SET
                    userName = excluded.userName,
                    department = excluded.department,
                    totalDays = excluded.totalDays,
                    updatedAt = excluded.updatedAt
            `, [cleanEmail, cleanName, cleanDept, cleanLeaveDays, new Date().getFullYear(), now]);
        } catch (e) {
            console.warn('leave_allowances 동기화 경고:', e.message);
        }

        res.status(201).json({ message: '신규 사용자가 등록되었습니다.', email: cleanEmail });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [관리자 전용] 사용자 정보 및 권한 수정
router.put('/users/:email', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const targetEmail = req.params.email.trim().toLowerCase();
    const { name, department, rank, role, leaveDays, hireDate, status, menuPermissions, memo } = req.body;

    if (!name) {
        return res.status(400).json({ error: '사원명은 필수 항목입니다.' });
    }

    const cleanName = name.trim();
    const cleanDept = (department || '주식회사 케앤지').trim();
    const cleanRank = (rank || '사원').trim();
    const cleanRole = role === 'admin' ? 'admin' : (role === 'manager' ? 'manager' : 'user');
    const cleanLeaveDays = Number(leaveDays) || 15.0;
    const cleanStatus = status === 'inactive' ? 'inactive' : 'active';
    const cleanPerms = Array.isArray(menuPermissions) ? JSON.stringify(menuPermissions) : (typeof menuPermissions === 'string' ? menuPermissions : '["all"]');
    const now = new Date().toISOString();

    try {
        const result = await dbRun(`
            UPDATE portal_users SET
                name = ?,
                department = ?,
                rank = ?,
                role = ?,
                leaveDays = ?,
                hireDate = ?,
                status = ?,
                menuPermissions = ?,
                memo = ?,
                updatedAt = ?
            WHERE email = ?
        `, [
            cleanName, cleanDept, cleanRank, cleanRole,
            cleanLeaveDays, hireDate || '', cleanStatus, cleanPerms, memo || '',
            now, targetEmail
        ]);

        if (result.changes === 0) {
            return res.status(404).json({ error: '수정할 사용자를 찾을 수 없습니다.' });
        }

        // 휴가원 연차 대장(leave_allowances) 동시 동기화
        try {
            await dbRun(`
                INSERT INTO leave_allowances (userEmail, userName, department, totalDays, year, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(userEmail) DO UPDATE SET
                    userName = excluded.userName,
                    department = excluded.department,
                    totalDays = excluded.totalDays,
                    updatedAt = excluded.updatedAt
            `, [targetEmail, cleanName, cleanDept, cleanLeaveDays, new Date().getFullYear(), now]);
        } catch (e) {
            console.warn('leave_allowances 동기화 경고:', e.message);
        }

        res.json({ message: '사용자 정보 및 권한이 업데이트되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// [관리자 전용] 사용자 계정 삭제
router.delete('/users/:email', async (req, res) => {
    if (!_db) return res.status(500).json({ error: 'DB not initialized' });
    const targetEmail = req.params.email.trim().toLowerCase();

    // 슈퍼관리자 본인 계정 보호
    if (targetEmail === 'jpark120325@gmail.com') {
        return res.status(400).json({ error: '최고 슈퍼 관리자 계정은 삭제할 수 없습니다.' });
    }

    try {
        const result = await dbRun(`DELETE FROM portal_users WHERE email = ?`, [targetEmail]);
        if (result.changes === 0) {
            return res.status(404).json({ error: '삭제할 사용자를 찾을 수 없습니다.' });
        }

        // leave_allowances 에서도 삭제
        try {
            await dbRun(`DELETE FROM leave_allowances WHERE userEmail = ?`, [targetEmail]);
        } catch (e) {}

        res.json({ message: '사용자가 삭제되었습니다.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = {
    router,
    initAdminUsersTables,
    setDb
};
