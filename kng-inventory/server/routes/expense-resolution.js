const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const path = require('path');

let db;

// DB 주입
const setDb = (dbInstance) => {
    db = dbInstance;
};

// 테이블 초기화
const initExpenseResolutionTables = (dbInstance) => {
    return new Promise((resolve, reject) => {
        // 지출결의서 테이블
        dbInstance.run(`
            CREATE TABLE IF NOT EXISTS expense_resolutions (
                id TEXT PRIMARY KEY,
                createdDate TEXT,
                paymentDate TEXT,
                currency TEXT DEFAULT 'KRW',
                amount REAL DEFAULT 0,
                vatAmount REAL DEFAULT 0,
                vendorId TEXT,
                vendorName TEXT,
                representative TEXT,
                bizRegNumber TEXT,
                bankName TEXT,
                accountNumber TEXT,
                accountHolder TEXT,
                paymentMethod TEXT DEFAULT 'cash',
                title TEXT,
                taxInvoiceDate TEXT,
                content TEXT,
                personInCharge TEXT,
                createdAt TEXT,
                updatedAt TEXT
            )
        `, (err) => {
            if (err) {
                console.error('expense_resolutions 테이블 생성 오류:', err.message);
                reject(err);
                return;
            }
            console.log('expense_resolutions 테이블 확인 완료');

            // 거래처 프리셋 테이블
            dbInstance.run(`
                CREATE TABLE IF NOT EXISTS vendor_presets (
                    id TEXT PRIMARY KEY,
                    vendorName TEXT,
                    representative TEXT,
                    bizRegNumber TEXT,
                    accounts TEXT,
                    createdAt TEXT,
                    updatedAt TEXT
                )
            `, (err2) => {
                if (err2) {
                    console.error('vendor_presets 테이블 생성 오류:', err2.message);
                    reject(err2);
                } else {
                    console.log('vendor_presets 테이블 확인 완료');
                    resolve();
                }
            });
        });
    });
};

// ==========================================
// 거래처 프리셋 API (/:id 보다 먼저 선언)
// ==========================================

// 거래처 목록 조회
router.get('/vendors', (req, res) => {
    db.all('SELECT * FROM vendor_presets ORDER BY vendorName ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const parsed = rows.map(row => {
            try { row.accounts = JSON.parse(row.accounts || '[]'); } catch(e) { row.accounts = []; }
            return row;
        });
        res.json(parsed);
    });
});

// 거래처 단건 조회
router.get('/vendors/:id', (req, res) => {
    db.get('SELECT * FROM vendor_presets WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        try { row.accounts = JSON.parse(row.accounts || '[]'); } catch(e) { row.accounts = []; }
        res.json(row);
    });
});

// 거래처 등록
router.post('/vendors', (req, res) => {
    const p = req.body;
    const id = p.id || ('VND-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const accountsJson = typeof p.accounts === 'string' ? p.accounts : JSON.stringify(p.accounts || []);
    const sql = `
        INSERT INTO vendor_presets (id, vendorName, representative, bizRegNumber, accounts, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [id, p.vendorName || '', p.representative || '', p.bizRegNumber || '', accountsJson, now, now];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '거래처 등록 성공', id: id });
    });
});

// 거래처 수정
router.put('/vendors/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const accountsJson = typeof p.accounts === 'string' ? p.accounts : JSON.stringify(p.accounts || []);
    const sql = `
        UPDATE vendor_presets SET vendorName=?, representative=?, bizRegNumber=?, accounts=?, updatedAt=?
        WHERE id=?
    `;
    const params = [p.vendorName || '', p.representative || '', p.bizRegNumber || '', accountsJson, now, id];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        res.json({ message: '거래처 수정 성공' });
    });
});

// 거래처 삭제
router.delete('/vendors/:id', (req, res) => {
    db.run('DELETE FROM vendor_presets WHERE id = ?', [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
        res.json({ message: '거래처 삭제 성공' });
    });
});

// ==========================================
// 지출결의서 API
// ==========================================

// 전체 목록 조회
router.get('/', (req, res) => {
    db.all('SELECT * FROM expense_resolutions ORDER BY createdDate DESC, createdAt DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 다중 삭제 (/:id 보다 먼저 선언)
router.post('/delete', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '삭제할 ID 배열이 필요합니다.' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const sql = `DELETE FROM expense_resolutions WHERE id IN (${placeholders})`;

    db.run(sql, ids, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '삭제 성공', deletedCount: this.changes });
    });
});

// 단일 조회
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM expense_resolutions WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다.' });
        res.json(row);
    });
});

// 등록
router.post('/', (req, res) => {
    const p = req.body;
    const id = p.id || ('EXP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `
        INSERT INTO expense_resolutions (
            id, createdDate, paymentDate, currency, amount, vatAmount,
            vendorId, vendorName, representative, bizRegNumber,
            bankName, accountNumber, accountHolder,
            paymentMethod, title, taxInvoiceDate, content, personInCharge,
            createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
        id, p.createdDate || '', p.paymentDate || '', p.currency || 'KRW',
        p.amount || 0, p.vatAmount || 0,
        p.vendorId || '', p.vendorName || '', p.representative || '', p.bizRegNumber || '',
        p.bankName || '', p.accountNumber || '', p.accountHolder || '',
        p.paymentMethod || 'cash', p.title || '', p.taxInvoiceDate || '',
        p.content || '', p.personInCharge || '',
        now, now
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: '등록 성공', id: id });
    });
});

// 수정
router.put('/:id', (req, res) => {
    const id = req.params.id;
    const p = req.body;
    const now = new Date().toISOString();
    const sql = `
        UPDATE expense_resolutions SET
            createdDate=?, paymentDate=?, currency=?, amount=?, vatAmount=?,
            vendorId=?, vendorName=?, representative=?, bizRegNumber=?,
            bankName=?, accountNumber=?, accountHolder=?,
            paymentMethod=?, title=?, taxInvoiceDate=?, content=?, personInCharge=?,
            updatedAt=?
        WHERE id=?
    `;
    const params = [
        p.createdDate || '', p.paymentDate || '', p.currency || 'KRW',
        p.amount || 0, p.vatAmount || 0,
        p.vendorId || '', p.vendorName || '', p.representative || '', p.bizRegNumber || '',
        p.bankName || '', p.accountNumber || '', p.accountHolder || '',
        p.paymentMethod || 'cash', p.title || '', p.taxInvoiceDate || '',
        p.content || '', p.personInCharge || '',
        now, id
    ];

    db.run(sql, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다.' });
        res.json({ message: '수정 성공' });
    });
});

function numberToKorean(number) {
    const koreanNumbers = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
    const units = ['', '십', '백', '천'];
    const bigUnits = ['', '만', '억', '조', '경'];

    if (number === 0) return '영';

    let numStr = number.toString();
    let isNegative = false;
    if (numStr.startsWith('-')) {
        isNegative = true;
        numStr = numStr.substring(1);
    }
    
    const parts = numStr.split('.');
    let intPartStr = parts[0];
    const decPartStr = parts[1];

    let result = '';
    let unitCount = 0;

    for (let i = intPartStr.length - 1; i >= 0; i -= 4) {
        let chunk = intPartStr.substring(Math.max(0, i - 3), i + 1);
        let chunkStr = '';
        for (let j = 0; j < chunk.length; j++) {
            let digit = parseInt(chunk[j]);
            if (digit !== 0) {
                chunkStr += koreanNumbers[digit] + units[chunk.length - 1 - j];
            }
        }
        if (chunkStr !== '') {
            result = chunkStr + bigUnits[unitCount] + result;
        }
        unitCount++;
    }

    if (isNegative) {
        result = '마이너스 ' + result;
    }
    
    let decResult = '';
    if (decPartStr && parseInt(decPartStr) !== 0) {
        decResult = '점';
        for(let i=0; i<decPartStr.length; i++) {
            decResult += (decPartStr[i] === '0' ? '영' : koreanNumbers[parseInt(decPartStr[i])]);
        }
    }
    
    return result + decResult;
}

// 엑셀 다운로드 API
router.post('/export-excel', async (req, res) => {
    try {
        const data = req.body;
        const templatePath = path.join(__dirname, '../templates/expense_template.xlsx');
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(templatePath);
        
        const sheet = workbook.worksheets[0];

        // Format dates
        const createdDate = data.createdDate ? new Date(data.createdDate) : new Date();
        const createdStr = `${createdDate.getFullYear()}년 ${String(createdDate.getMonth() + 1).padStart(2, '0')}월 ${String(createdDate.getDate()).padStart(2, '0')}일`;
        
        const paymentDate = data.paymentDate ? new Date(data.paymentDate) : null;
        const payStr = paymentDate ? `${String(paymentDate.getMonth() + 1).padStart(2, '0')}/${String(paymentDate.getDate()).padStart(2, '0')}` : '';

        const taxDate = data.taxInvoiceDate ? new Date(data.taxInvoiceDate) : null;
        const taxStr = taxDate ? `${taxDate.getFullYear()}-${String(taxDate.getMonth() + 1).padStart(2, '0')}-${String(taxDate.getDate()).padStart(2, '0')}` : '';

        // Format amount
        const isForeign = ['USD', 'CNY', 'EUR', 'JPY'].includes(data.currency);
        let amount = parseFloat(data.amount) || 0;
        let vat = parseFloat(data.vatAmount) || 0;
        let total = amount + (isForeign ? 0 : vat);

        let amtStr = amount.toLocaleString(undefined, { minimumFractionDigits: isForeign ? 2 : 0 });
        let totalStr = total.toLocaleString(undefined, { minimumFractionDigits: isForeign ? 2 : 0 });
        let vatStr = vat.toLocaleString();

        let koreanAmt = '';
        const curr = data.currency;
        if (curr === 'KRW') {
            koreanAmt = `일금 ${numberToKorean(amount)} 원정`;
        } else if (curr === 'USD') {
            koreanAmt = `美貨 ${numberToKorean(amount)} 달러`;
        } else if (curr === 'CNY') {
            koreanAmt = `中貨 ${numberToKorean(amount)} 원元`;
        } else if (curr === 'EUR') {
            koreanAmt = `유로 ${numberToKorean(amount)} 유로`;
        } else if (curr === 'JPY') {
            koreanAmt = `日貨 ${numberToKorean(amount)} 엔`;
        }

        // Map data to cells
        const cleanTitle = (data.title || '').replace(/[\t\r]/g, '');

        const mapping = {
            'I1': createdStr,
            'B4': koreanAmt,
            'H4': curr + amtStr + ' ≠',
            'B5': data.bankName || '',
            'D5': data.accountNumber || '',
            'I5': data.accountHolder || '',
            'C6': payStr,
            'C7': data.paymentMethod === 'cash' ? 'O' : '',
            'C8': data.paymentMethod !== 'cash' ? 'O' : '',
            'C13': data.personInCharge || '',
            'C15': data.vendorName || '',
            'F15': data.representative || '',
            'H15': '사업자\n등록번호',
            'I15': data.bizRegNumber || '',
            'A9': '결\n\n\n\n\n재',
            'C16': cleanTitle,
            'A18': taxStr,
            'E18': curr + amtStr + ' ≠',
            'E19': isForeign ? '≠' : (vatStr + ' ≠'),
            'E20': curr + totalStr + ' ≠'
        };

        for (const [cellRef, value] of Object.entries(mapping)) {
            const cell = sheet.getCell(cellRef);
            cell.value = value;
            // 구글 시트 찌꺼기 채우기 서식 초기화 (정렬 설정은 유지)
            if (typeof value === 'string') {
                cell.numFmt = '@';
            }
        }

        // '결 재', '사업자 등록번호' 라벨 및 값 텍스트가 줄바꿈되도록 wrapText 명시적 허용
        sheet.getCell('A9').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'ltr' };
        sheet.getCell('H15').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        sheet.getCell('I15').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

        // 멀티라인 내용 처리 (C21 ~ C25에 분배하고 템플릿의 기존 예시 텍스트는 지움)
        const cleanContent = (data.content || '').replace(/[\t\r]/g, '');
        const contentLines = cleanContent.split(/\n/);
        for (let i = 0; i < 5; i++) {
            const cell = sheet.getCell(`C${21 + i}`);
            cell.value = contentLines[i] || ''; // 텍스트가 없으면 빈 문자열로 덮어씌워 템플릿 찌꺼기 제거
            cell.numFmt = '@'; // 구글 시트에서 가져온 찌꺼기 채우기 서식 무효화
        }

        const dateStr = createdDate.getFullYear() + String(createdDate.getMonth() + 1).padStart(2, '0') + String(createdDate.getDate()).padStart(2, '0');
        const amountStrForFile = isForeign ? amount.toFixed(2) : amount.toString();
        const filename = `지출결의서_${dateStr}_${curr}${amountStrForFile}.xlsx`;

        // 행 높이 명시적 지정
        sheet.getRow(1).height = 20;
        sheet.getRow(2).height = 20;
        sheet.getRow(3).height = 10;
        for (let r = 4; r <= 13; r++) sheet.getRow(r).height = 30;
        sheet.getRow(14).height = 10;
        for (let r = 15; r <= 28; r++) sheet.getRow(r).height = 30;

        // 열 너비 명시적 지정 (엑셀 표시 너비 오차 보정을 위해 +0.71 추가)
        const colWidths = {
            'A': 7.63, 'B': 8.25, 'C': 12.5, 'D': 9.25, 'E': 7.25,
            'F': 5.75, 'G': 7.5, 'H': 7.63, 'I': 4.38, 'J': 10.38
        };
        for (const [col, width] of Object.entries(colWidths)) {
            sheet.getColumn(col).width = width + 0.71;
        }

        // 전체 폰트 사이즈 10pt 일괄 적용
        sheet.eachRow({ includeEmpty: true }, (row) => {
            row.eachCell({ includeEmpty: true }, (cell) => {
                const currentFont = cell.font || { name: '맑은 고딕' };
                cell.font = { ...currentFont, size: 10 };
            });
        });

        // 특수 지정 폰트 사이즈 덮어쓰기
        // 문서 제목 (A1) 24pt
        const titleFont = sheet.getCell('A1').font || { name: '맑은 고딕' };
        sheet.getCell('A1').font = { ...titleFont, size: 24 };

        // 금액 텍스트 영역 16pt
        ['A18', 'E18', 'E19', 'E20'].forEach(ref => {
            const f = sheet.getCell(ref).font || { name: '맑은 고딕' };
            sheet.getCell(ref).font = { ...f, size: 16 };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}`);
        
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Excel Export Error:', err);
        res.status(500).json({ error: '엑셀 파일 생성 중 오류가 발생했습니다.' });
    }
});

module.exports = {
    router,
    setDb,
    initExpenseResolutionTables
};
