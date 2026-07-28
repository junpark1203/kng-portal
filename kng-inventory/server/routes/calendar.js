const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// 구글 서비스 계정 키 파일 경로
const KEYFILEPATH = path.join(__dirname, '..', 'google-calendar-key.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_ID = 'jpark120325@gmail.com'; 

// 1. 달력 일정 조회
router.get('/events', async (req, res) => {
    try {
        if (!fs.existsSync(KEYFILEPATH)) {
            return res.status(500).json({ error: '구글 캘린더 키 파일이 없습니다.' });
        }
        const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
        const calendar = google.calendar({ version: 'v3', auth });
        
        // 이달의 일정 가져오기
        const now = new Date();
        // 한 달 전부터 두 달 후까지 여유있게 가져오기
        const startOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
        
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: startOfMonth,
            timeMax: endOfMonth,
            singleEvents: true,
            orderBy: 'startTime',
        });
        res.json(response.data.items || []);
    } catch (error) {
        console.error('Calendar API 에러:', error);
        res.status(500).json({ error: '일정을 불러오는데 실패했습니다.' });
    }
});

// 2. 새 일정 등록
router.post('/events', async (req, res) => {
    try {
        if (!fs.existsSync(KEYFILEPATH)) {
            return res.status(500).json({ error: '구글 캘린더 키 파일이 없습니다.' });
        }
        const auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
        const calendar = google.calendar({ version: 'v3', auth });
        
        const event = {
            summary: req.body.summary,
            start: req.body.start, // { date: 'YYYY-MM-DD' }
            end: req.body.end
        };
        
        const response = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event,
        });
        res.status(201).json(response.data);
    } catch (error) {
        console.error('일정 등록 실패:', error);
        res.status(500).json({ error: '일정 등록에 실패했습니다.' });
    }
});

module.exports = router;
