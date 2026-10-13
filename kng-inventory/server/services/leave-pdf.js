const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const KOR_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateWithDay(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = dateStr.split('-').map(Number);
        if (parts.length < 3 || isNaN(parts[0])) return dateStr;
        const [year, month, day] = parts;
        const dt = new Date(year, month - 1, day);
        const dayKor = KOR_DAYS[dt.getDay()];
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        return `${year}. ${mm}. ${dd}.(${dayKor})`;
    } catch (e) {
        return dateStr;
    }
}

function formatSubmitDate(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = dateStr.split('-').map(Number);
        if (parts.length < 3 || isNaN(parts[0])) return dateStr;
        const [year, month, day] = parts;
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        return `${year}.  ${mm}.   ${dd}.`;
    } catch (e) {
        return dateStr;
    }
}

/**
 * 휴가원 데이터 객체를 받아 1:1 정품 오버레이 PDF 버퍼(Uint8Array / Buffer)를 생성하여 반환합니다.
 * @param {Object} data 
 * @returns {Promise<Buffer>}
 */
async function generateLeavePdf(data = {}) {
    // 1. 템플릿 경로 탐색 (assets 내부 우선, 없을 시 fallback)
    const templateCandidates = [
        path.join(__dirname, '..', 'assets', 'templates', '휴가원_빈양식_템플릿.pdf'),
        path.join(__dirname, '..', '..', '..', '05_Management', 'forms', 'Templates', '휴가원_빈양식_템플릿.pdf')
    ];
    let templatePath = templateCandidates.find(p => fs.existsSync(p));
    if (!templatePath) {
        throw new Error('휴가원 빈양식 템플릿 PDF를 찾을 수 없습니다.');
    }

    // 2. 한글 폰트 경로 탐색 (assets 내부 우선, 시스템 폰트 fallback)
    const fontCandidates = [
        path.join(__dirname, '..', 'assets', 'fonts', 'NanumGothic.ttf'),
        'C:/Windows/Fonts/NanumGothic.ttf',
        'C:/Windows/Fonts/malgun.ttf'
    ];
    let fontPath = fontCandidates.find(p => fs.existsSync(p));
    if (!fontPath) {
        throw new Error('한글 폰트(TTF)를 찾을 수 없습니다.');
    }

    const templateBytes = fs.readFileSync(templatePath);
    const fontBytes = fs.readFileSync(fontPath);

    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);

    const customFont = await pdfDoc.embedFont(fontBytes);
    const firstPage = pdfDoc.getPages()[0];
    const height = firstPage.getHeight();

    // 데이터 가공
    const department = data.department || '주식회사 케앤지';
    const rank = data.rank || '';
    const name = data.name || '';
    const leaveType = data.leaveType || '';
    const reason = data.reason || '';

    // 기간 포맷팅
    let period = '';
    const s1 = formatDateWithDay(data.leaveStart);
    const s2 = formatDateWithDay(data.leaveEnd);
    if (s1 && s2) {
        period = `${s1} ~ ${s2}`;
    } else if (s1) {
        period = s1;
    }
    if (leaveType) {
        period += period ? `, (${leaveType})` : `(${leaveType})`;
    }

    // 신청일자
    const submitDate = formatSubmitDate(data.submitDate);

    // 서명란 성명 (글자 사이 공백 삽입)
    const signName = name ? name.split('').join(' ') : '';

    // 폰트 스타일
    const fontSize = 11;
    const color = rgb(0, 0, 0);

    // 좌표 매핑 (좌상단 PyMuPDF 좌표 y -> pdf-lib y: height - y)
    const fields = [
        { text: department, x: 148, py_y: 206 },
        { text: rank, x: 148, py_y: 230 },
        { text: name, x: 148, py_y: 255 },
        { text: period, x: 148, py_y: 401 },
        { text: reason, x: 148, py_y: 425 },
        { text: submitDate, x: 443, py_y: 474 },
        { text: signName, x: 455, py_y: 528 },
    ];

    for (const f of fields) {
        if (f.text) {
            firstPage.drawText(f.text, {
                x: f.x,
                y: height - f.py_y,
                size: fontSize,
                font: customFont,
                color: color
            });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

module.exports = {
    generateLeavePdf
};
