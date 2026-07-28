const express = require('express');
const router = express.Router();
// const { google } = require('googleapis');
// const path = require('path');
// const fs = require('fs');

// 구글 서비스 계정 키 파일 경로 (추후 키 발급 후 사용)
// const KEYFILEPATH = path.join(__dirname, '..', 'google-calendar-key.json');
// const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// const CALENDAR_ID = 'primary'; // 또는 특정 공유 캘린더 ID

// 1. 달력 일정 조회 (Mock)
router.get('/events', async (req, res) => {
    try {
        // TODO: 구글 서비스 계정 연동 후 실제 코드 활성화 (npm install googleapis 필요)
        /*
        if (!fs.existsSync(KEYFILEPATH)) {
            return res.status(500).json({ error: '구글 캘린더 키 파일이 없습니다.' });
        }
        const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
        const calendar = google.calendar({ version: 'v3', auth });
        
        // 이달의 일정 가져오기
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
        
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: startOfMonth,
            timeMax: endOfMonth,
            singleEvents: true,
            orderBy: 'startTime',
        });
        res.json(response.data.items);
        */
        
        // Mock 데이터 반환 (현재 월 15일에 임시 일정)
        const now = new Date();
        const mockDate = new Date(now.getFullYear(), now.getMonth(), 15).toISOString().split('T')[0];
        
        res.json([
            {
                id: 'mock1',
                summary: '💡 구글 캘린더 연동 대기중 (테스트 일정)',
                start: { date: mockDate },
                end: { date: mockDate }
            }
        ]);
    } catch (error) {
        console.error('Calendar API 에러:', error);
        res.status(500).json({ error: '일정을 불러오는데 실패했습니다.' });
    }
});

// 2. 새 일정 등록 (Mock)
router.post('/events', async (req, res) => {
    try {
        // TODO: 일정 생성 코드
        /*
        const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
        const calendar = google.calendar({ version: 'v3', auth });
        
        const event = {
            summary: req.body.summary,
            start: req.body.start, // { date: 'YYYY-MM-DD' } 또는 { dateTime: '...' }
            end: req.body.end
        };
        
        const response = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event,
        });
        res.status(201).json(response.data);
        */
        
        console.log('새 일정 등록 요청:', req.body);
        res.status(201).json({ message: '일정 등록 성공 (Mock)' });
    } catch (error) {
        console.error('일정 등록 실패:', error);
        res.status(500).json({ error: '일정 등록에 실패했습니다.' });
    }
});

module.exports = router;
