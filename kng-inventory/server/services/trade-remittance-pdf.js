const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

/**
 * 날짜 문자열(YYYY-MM-DD)을 'YYYY. MM. DD.' 형식으로 변환
 */
function formatRemittanceDate(dateStr) {
    if (!dateStr) return '';
    try {
        const clean = String(dateStr).trim();
        const parts = clean.split('-').map(Number);
        if (parts.length < 3 || isNaN(parts[0])) return clean;
        const [year, month, day] = parts;
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        return `${year}-${mm}-${dd}`;
    } catch (e) {
        return String(dateStr);
    }
}

/**
 * 송금액 포맷팅 (통화별 천단위 콤마 및 소수점 처리)
 */
function formatRemittanceAmount(amount, currency = 'USD') {
    if (amount === undefined || amount === null || amount === '') return '';
    const num = Number(String(amount).replace(/,/g, ''));
    if (isNaN(num)) return String(amount);
    const curr = String(currency || 'USD').toUpperCase();
    // KRW, JPY는 소수점 없이, 외화(USD, CNY, EUR 등)는 입력된 소수점 보존하되 기본 포맷 적용
    const hasDecimal = String(amount).includes('.');
    if (curr === 'KRW' || curr === 'JPY') {
        return num.toLocaleString('en-US', {
            minimumFractionDigits: hasDecimal ? 2 : 0,
            maximumFractionDigits: 2
        });
    }
    return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

/**
 * 작성일자를 연(2자리)/월/일로 분리
 */
function parseSubmitDateParts(dateStr) {
    if (!dateStr) return { yy: '', mm: '', dd: '' };
    try {
        const parts = String(dateStr).trim().split('-').map(Number);
        if (parts.length < 3 || isNaN(parts[0])) return { yy: '', mm: '', dd: '' };
        const [year, month, day] = parts;
        const yy = String(year).slice(-2);
        const mm = String(month).padStart(2, '0');
        const dd = String(day).padStart(2, '0');
        return { yy, mm, dd };
    } catch (e) {
        return { yy: '', mm: '', dd: '' };
    }
}

/**
 * 셀 영역(xMin ~ xMax, py_yCenter) 안에 텍스트를 글자 크기 자동 조절(Auto-fit)하여 그리기
 */
function drawFittedCellText(page, font, text, options) {
    const str = String(text || '').trim();
    if (!str) return;

    const {
        xMin,
        xMax,
        pyCenterY,
        pageHeight,
        maxFontSize = 18,
        minFontSize = 10,
        align = 'center',
        paddingX = 10,
        color = rgb(0, 0, 0)
    } = options;

    const availWidth = Math.max(20, (xMax - xMin) - paddingX * 2);
    let fontSize = maxFontSize;

    while (fontSize > minFontSize) {
        const textWidth = font.widthOfTextAtSize(str, fontSize);
        if (textWidth <= availWidth) break;
        fontSize -= 0.5;
    }

    const finalWidth = font.widthOfTextAtSize(str, fontSize);
    let x = xMin + paddingX;
    if (align === 'center') {
        x = xMin + ((xMax - xMin) - finalWidth) / 2;
        if (x < xMin + 4) x = xMin + 4;
    } else if (align === 'right') {
        x = xMax - paddingX - finalWidth;
        if (x < xMin + 4) x = xMin + 4;
    }

    // 수직 중앙 정렬 (폰트 높이 보정)
    const capOffset = fontSize * 0.34;
    const y = pageHeight - (pyCenterY + capOffset);

    page.drawText(str, {
        x,
        y,
        size: fontSize,
        font,
        color
    });
}

/**
 * 무역대금 송금 추가 확인서 데이터 객체를 받아 1:1 정품 오버레이 PDF 버퍼를 생성하여 반환합니다.
 * @param {Object} data
 * @returns {Promise<Buffer>}
 */
async function generateTradeRemittancePdf(data = {}) {
    // 1. 템플릿 경로 탐색
    const templateCandidates = [
        path.join(__dirname, '..', 'assets', 'templates', '무역대금_송금_추가_확인서_템플릿.pdf'),
        path.join(__dirname, '..', '..', '..', '05_Management', 'forms', 'Templates', '무역대금_송금_추가_확인서_템플릿.pdf'),
        path.join(__dirname, '..', '..', '..', '05_Management', 'forms', 'trade_remittance_bg.pdf')
    ];
    const templatePath = templateCandidates.find(p => fs.existsSync(p));
    if (!templatePath) {
        throw new Error('무역대금 송금 추가 확인서 빈양식 템플릿 PDF를 찾을 수 없습니다.');
    }

    // 2. 한글 폰트 경로 탐색
    const fontCandidates = [
        path.join(__dirname, '..', 'assets', 'fonts', 'NanumGothic.ttf'),
        'C:/Windows/Fonts/NanumGothic.ttf',
        'C:/Windows/Fonts/malgun.ttf'
    ];
    const fontPath = fontCandidates.find(p => fs.existsSync(p));
    if (!fontPath) {
        throw new Error('한글 폰트(TTF)를 찾을 수 없습니다.');
    }

    const templateBytes = fs.readFileSync(templatePath);
    const fontBytes = fs.readFileSync(fontPath);

    const pdfDoc = await PDFDocument.load(templateBytes);
    pdfDoc.registerFontkit(fontkit);

    const customFont = await pdfDoc.embedFont(fontBytes);
    const firstPage = pdfDoc.getPages()[0];
    const height = firstPage.getHeight(); // 1754

    // 입력값 준비
    const remittanceDate = formatRemittanceDate(data.remittanceDate);
    const currency = String(data.currency || 'USD').trim().toUpperCase();
    const amountFormatted = formatRemittanceAmount(data.amount, currency);
    const beneficiaryName = String(data.beneficiaryName || '').trim();

    const hsCode = String(data.hsCode || '').replace(/[^0-9]/g, '');
    const lcOrContractNo = String(data.lcOrContractNo || '').trim();
    const importDeclNo = String(data.importDeclNo || '').trim();
    const priceTerms = String(data.priceTerms || '').trim();
    const tradePurpose = String(data.tradePurpose || '').trim();

    const { yy, mm, dd } = parseSubmitDateParts(data.submitDate);

    // ── 1) 상단 [대상건] 테이블 (py_y: 314 ~ 351, center: 332.5) ──
    const topRowCenterY = 333;
    drawFittedCellText(firstPage, customFont, remittanceDate, {
        xMin: 251, xMax: 408, pyCenterY: topRowCenterY, pageHeight: height,
        maxFontSize: 17, minFontSize: 11, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, currency, {
        xMin: 408, xMax: 496, pyCenterY: topRowCenterY, pageHeight: height,
        maxFontSize: 17, minFontSize: 11, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, amountFormatted, {
        xMin: 496, xMax: 687, pyCenterY: topRowCenterY, pageHeight: height,
        maxFontSize: 17, minFontSize: 10, align: 'center', paddingX: 8
    });
    drawFittedCellText(firstPage, customFont, beneficiaryName, {
        xMin: 687, xMax: 1085, pyCenterY: topRowCenterY, pageHeight: height,
        maxFontSize: 16, minFontSize: 9, align: 'center', paddingX: 10
    });

    // ── 2) 하단 [3. 수출입 물품 정보] 테이블 (py_y: 1347 ~ 1382, center: 1364.5) ──
    const bottomRowCenterY = 1365;
    drawFittedCellText(firstPage, customFont, hsCode, {
        xMin: 152, xMax: 340, pyCenterY: bottomRowCenterY, pageHeight: height,
        maxFontSize: 17, minFontSize: 10, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, lcOrContractNo, {
        xMin: 340, xMax: 543, pyCenterY: bottomRowCenterY, pageHeight: height,
        maxFontSize: 16, minFontSize: 9, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, importDeclNo, {
        xMin: 543, xMax: 789, pyCenterY: bottomRowCenterY, pageHeight: height,
        maxFontSize: 16, minFontSize: 9, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, priceTerms, {
        xMin: 789, xMax: 899, pyCenterY: bottomRowCenterY, pageHeight: height,
        maxFontSize: 17, minFontSize: 10, align: 'center', paddingX: 6
    });
    drawFittedCellText(firstPage, customFont, tradePurpose, {
        xMin: 899, xMax: 1085, pyCenterY: bottomRowCenterY, pageHeight: height,
        maxFontSize: 16, minFontSize: 10, align: 'center', paddingX: 6
    });

    // ── 3) 하단 작성일자 (20   년   월   일, baseline py_y: 1553) ──
    const dateCenterY = 1546.5;
    if (yy) {
        // '20' (x: 490~517) 바로 우측에 자연스럽게 이어지도록 배치
        drawFittedCellText(firstPage, customFont, yy, {
            xMin: 517, xMax: 547, pyCenterY: dateCenterY, pageHeight: height,
            maxFontSize: 21, minFontSize: 16, align: 'left', paddingX: 1
        });
    }
    if (mm) {
        // '년'(551~571)과 '월'(609~629) 사이 중앙
        drawFittedCellText(firstPage, customFont, mm, {
            xMin: 571, xMax: 609, pyCenterY: dateCenterY, pageHeight: height,
            maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2
        });
    }
    if (dd) {
        // '월'(609~629)과 '일'(665~685) 사이 중앙
        drawFittedCellText(firstPage, customFont, dd, {
            xMin: 629, xMax: 665, pyCenterY: dateCenterY, pageHeight: height,
            maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2
        });
    }

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

module.exports = {
    generateTradeRemittancePdf
};
