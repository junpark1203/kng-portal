const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const KEYFILEPATH = path.join(__dirname, '..', 'google-calendar-key.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const CALENDAR_ID = 'jpark120325@gmail.com';

function getCalendarClient() {
    let auth;
    if (process.env.GOOGLE_CALENDAR_CREDENTIALS_BASE64) {
        const decoded = Buffer.from(process.env.GOOGLE_CALENDAR_CREDENTIALS_BASE64, 'base64').toString('utf8');
        auth = new google.auth.GoogleAuth({ credentials: JSON.parse(decoded), scopes: SCOPES });
    } else if (fs.existsSync(KEYFILEPATH)) {
        auth = new google.auth.GoogleAuth({ keyFile: KEYFILEPATH, scopes: SCOPES });
    } else {
        return null;
    }
    return google.calendar({ version: 'v3', auth });
}

function getNextDay(dateStr) {
    if (!dateStr) return dateStr;
    try {
        const d = new Date(dateStr);
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
    } catch (e) {
        return dateStr;
    }
}

/**
 * 승인된 휴가 일정을 구글 캘린더에 종일(All-day) 이벤트로 자동 등록합니다.
 * @param {Object} leaveDoc 
 * @returns {Promise<string|null>} 생성된 구글 캘린더 이벤트 ID
 */
async function registerLeaveToGoogleCalendar(leaveDoc) {
    try {
        const calendar = getCalendarClient();
        if (!calendar) {
            console.warn('[GoogleCalendar] 구글 캘린더 인증 설정이 없어 일정 등록을 건너뜁니다.');
            return null;
        }

        const start = leaveDoc.leaveStart;
        const end = getNextDay(leaveDoc.leaveEnd || leaveDoc.leaveStart);

        const summary = `[휴가] ${leaveDoc.name || '직원'} (${leaveDoc.leaveType || '연차'})`;
        const description = `소속: ${leaveDoc.department || '주식회사 케앤지'}\n직급: ${leaveDoc.rank || ''}\n성명: ${leaveDoc.name || ''}\n사유: ${leaveDoc.reason || '-'}\n사용일수: ${leaveDoc.daysCount || 1}일\n(KNG 포털 휴가원 결재완료 자동 연동)`;

        const event = {
            summary,
            description,
            start: { date: start },
            end: { date: end },
            transparency: 'transparent' // 바쁨 표시 대신 '휴가' 표시
        };

        const res = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event
        });

        console.log(`[GoogleCalendar] 휴가 일정 등록 성공: ${summary} (${res.data.id})`);
        return res.data.id;
    } catch (err) {
        console.error('[GoogleCalendar] 휴가 일정 등록 실패:', err.message);
        return null;
    }
}

/**
 * 캘린더에 등록된 휴가 일정을 삭제합니다.
 * @param {string} eventId 
 */
async function removeLeaveFromGoogleCalendar(eventId) {
    if (!eventId) return;
    try {
        const calendar = getCalendarClient();
        if (!calendar) return;
        await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: eventId
        });
        console.log(`[GoogleCalendar] 휴가 일정 삭제 완료 (${eventId})`);
    } catch (err) {
        console.warn(`[GoogleCalendar] 휴가 일정 삭제 실패 또는 이미 삭제됨: ${err.message}`);
    }
}

module.exports = {
    registerLeaveToGoogleCalendar,
    removeLeaveFromGoogleCalendar
};
