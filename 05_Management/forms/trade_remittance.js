const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocal ? 'http://localhost:3000/api/trade-remittance' : 'https://kng.junparks.com/api/trade-remittance';
const PARTNERS_API_URL = 'https://kng.junparks.com/api/partners';
const EXPENSE_API_URL = 'https://kng.junparks.com/api/expense-resolution';
const LOCAL_CACHE_KEY = 'kngTradeRemittanceRecords_v1';
const PREFILL_STORAGE_KEY = 'kngTradeRemittancePrefill';

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) {
                await new Promise(r => setTimeout(r, 400));
                token = await window.parent.getAuthToken();
                retries++;
            }
        }
    } catch (e) {}

    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2600,
    timerProgressBar: true
});

function showToast(title, icon = 'success') {
    Toast.fire({ icon, title });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatAmountDisplay(amount, currency = 'USD') {
    const num = parseFloat(String(amount ?? '0').replace(/,/g, ''));
    if (isNaN(num)) return '0';
    const curr = String(currency || 'USD').toUpperCase();
    if (curr === 'KRW' || curr === 'JPY') {
        return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCurrencySymbol(curr) {
    switch (String(curr || '').toUpperCase()) {
        case 'USD': return '$';
        case 'CNY':
        case 'JPY': return '¥';
        case 'EUR': return '€';
        case 'GBP': return '£';
        case 'KRW': return '₩';
        default: return '';
    }
}

// ─────────────────────────────────────────────────────────────
// 클라이언트 사이드 1:1 정품 PDF 생성 엔진 (백엔드와 100% 동일한 좌표/폰트 매핑)
// ─────────────────────────────────────────────────────────────
let cachedTemplateBytes = null;
let cachedFontBytes = null;

async function generateClientSidePdfBlob(data = {}) {
    if (!window.PDFLib || !window.fontkit) {
        throw new Error('PDF 라이브러리가 로드되지 않았습니다.');
    }
    const { PDFDocument, rgb } = window.PDFLib;

    if (!cachedTemplateBytes) {
        const tplRes = await fetch('./trade_remittance_bg.pdf');
        if (!tplRes.ok) throw new Error('배경 양식 PDF를 불러올 수 없습니다.');
        cachedTemplateBytes = await tplRes.arrayBuffer();
    }
    if (!cachedFontBytes) {
        const fontRes = await fetch('./Templates/NanumGothic.ttf');
        if (!fontRes.ok) throw new Error('한글 폰트를 불러올 수 없습니다.');
        cachedFontBytes = await fontRes.arrayBuffer();
    }

    const pdfDoc = await PDFDocument.load(cachedTemplateBytes);
    pdfDoc.registerFontkit(window.fontkit);
    const customFont = await pdfDoc.embedFont(cachedFontBytes);
    const firstPage = pdfDoc.getPages()[0];
    const height = firstPage.getHeight(); // 1754

    function drawFittedCellText(text, opts) {
        const str = String(text || '').trim();
        if (!str) return;
        const {
            xMin, xMax, pyCenterY,
            maxFontSize = 17, minFontSize = 9,
            align = 'center', paddingX = 6
        } = opts;
        const availWidth = Math.max(20, (xMax - xMin) - paddingX * 2);
        let fontSize = maxFontSize;
        while (fontSize > minFontSize) {
            if (customFont.widthOfTextAtSize(str, fontSize) <= availWidth) break;
            fontSize -= 0.5;
        }
        const finalWidth = customFont.widthOfTextAtSize(str, fontSize);
        let x = xMin + paddingX;
        if (align === 'center') {
            x = xMin + ((xMax - xMin) - finalWidth) / 2;
            if (x < xMin + 4) x = xMin + 4;
        } else if (align === 'right') {
            x = xMax - paddingX - finalWidth;
            if (x < xMin + 4) x = xMin + 4;
        }
        const capOffset = fontSize * 0.34;
        const y = height - (pyCenterY + capOffset);
        firstPage.drawText(str, { x, y, size: fontSize, font: customFont, color: rgb(0, 0, 0) });
    }

    const remittanceDate = String(data.remittanceDate || '').trim();
    const currency = String(data.currency || 'USD').trim().toUpperCase();
    const amountFormatted = formatAmountDisplay(data.amount, currency);
    const beneficiaryName = String(data.beneficiaryName || '').trim();
    const hsCode = String(data.hsCode || '').replace(/[^0-9]/g, '');
    const lcOrContractNo = String(data.lcOrContractNo || '').trim();
    const importDeclNo = String(data.importDeclNo || '').trim();
    const priceTerms = String(data.priceTerms || '').trim();
    const tradePurpose = String(data.tradePurpose || '').trim();

    // 1) 상단 [대상건] 표
    const topRowCenterY = 333;
    drawFittedCellText(remittanceDate, { xMin: 251, xMax: 408, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 11 });
    drawFittedCellText(currency, { xMin: 408, xMax: 496, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 11 });
    drawFittedCellText(amountFormatted, { xMin: 496, xMax: 687, pyCenterY: topRowCenterY, maxFontSize: 17, minFontSize: 10, paddingX: 8 });
    drawFittedCellText(beneficiaryName, { xMin: 687, xMax: 1085, pyCenterY: topRowCenterY, maxFontSize: 16, minFontSize: 9, paddingX: 10 });

    // 2) 하단 [3. 수출입 물품 정보] 표
    const bottomRowCenterY = 1365;
    drawFittedCellText(hsCode, { xMin: 152, xMax: 340, pyCenterY: bottomRowCenterY, maxFontSize: 17, minFontSize: 10 });
    drawFittedCellText(lcOrContractNo, { xMin: 340, xMax: 543, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 9 });
    drawFittedCellText(importDeclNo, { xMin: 543, xMax: 789, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 9 });
    drawFittedCellText(priceTerms, { xMin: 789, xMax: 899, pyCenterY: bottomRowCenterY, maxFontSize: 17, minFontSize: 10 });
    drawFittedCellText(tradePurpose, { xMin: 899, xMax: 1085, pyCenterY: bottomRowCenterY, maxFontSize: 16, minFontSize: 10 });

    // 3) 하단 작성일자 (20   년   월   일)
    const submitStr = String(data.submitDate || '').trim();
    if (submitStr) {
        const parts = submitStr.split('-').map(Number);
        if (parts.length >= 3 && !isNaN(parts[0])) {
            const yy = String(parts[0]).slice(-2);
            const mm = String(parts[1]).padStart(2, '0');
            const dd = String(parts[2]).padStart(2, '0');
            const dateCenterY = 1546.5;
            drawFittedCellText(yy, { xMin: 517, xMax: 547, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'left', paddingX: 1 });
            drawFittedCellText(mm, { xMin: 571, xMax: 609, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2 });
            drawFittedCellText(dd, { xMin: 629, xMax: 665, pyCenterY: dateCenterY, maxFontSize: 21, minFontSize: 16, align: 'center', paddingX: 2 });
        }
    }

    const pdfBytes = await pdfDoc.save();
    return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ─────────────────────────────────────────────────────────────
// 메인 컨트롤러
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let allDocuments = [];
    let allVendors = [];
    let allExpenses = [];
    let currentEditId = null;

    function getCurrentUser() {
        let email = '';
        let name = '';
        try {
            email = (window.parent && window.parent.localStorage && window.parent.localStorage.getItem('kngCurrentUserEmail')) || localStorage.getItem('kngCurrentUserEmail') || '';
            name = (window.parent && window.parent.localStorage && window.parent.localStorage.getItem('kngCurrentUser')) || localStorage.getItem('kngCurrentUser') || '';
        } catch (e) {
            email = localStorage.getItem('kngCurrentUserEmail') || '';
            name = localStorage.getItem('kngCurrentUser') || '';
        }
        return { email, name };
    }

    function readLocalCache() {
        try {
            return JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }

    function writeLocalCache(list) {
        try {
            localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    const els = {
        docListBody: document.getElementById('docListBody'),
        selectAll: document.getElementById('selectAll'),
        btnNewDoc: document.getElementById('btnNewDoc'),
        btnDeleteSelected: document.getElementById('btnDeleteSelected'),
        btnGoExpense: document.getElementById('btnGoExpense'),
        btnExportExcel: document.getElementById('btnExportExcel'),

        // Filters
        filterStatus: document.getElementById('filterStatus'),
        filterCurrency: document.getElementById('filterCurrency'),
        filterKeyword: document.getElementById('filterKeyword'),
        btnResetFilter: document.getElementById('btnResetFilter'),

        // KPIs
        kpiTotalCount: document.getElementById('kpiTotalCount'),
        kpiCurrentMonthLabel: document.getElementById('kpiCurrentMonthLabel'),
        kpiMonthCount: document.getElementById('kpiMonthCount'),
        kpiUsdTotal: document.getElementById('kpiUsdTotal'),
        kpiOtherCount: document.getElementById('kpiOtherCount'),

        // Modal
        modal: document.getElementById('remittanceModal'),
        modalTitle: document.getElementById('modalTitle'),
        btnCloseModal: document.getElementById('btnCloseModal'),
        btnSaveDoc: document.getElementById('btnSaveDoc'),
        btnPrintPdf: document.getElementById('btnPrintPdf'),

        // Prefill Banner
        prefillBanner: document.getElementById('prefillBanner'),
        prefillBannerText: document.getElementById('prefillBannerText'),
        btnClearLink: document.getElementById('btnClearLink'),

        // Form Inputs
        fExpenseId: document.getElementById('fExpenseId'),
        fExpenseTitle: document.getElementById('fExpenseTitle'),
        fRemittanceDate: document.getElementById('fRemittanceDate'),
        fCurrency: document.getElementById('fCurrency'),
        fAmount: document.getElementById('fAmount'),
        fBeneficiaryName: document.getElementById('fBeneficiaryName'),
        vendorSuggestions: document.getElementById('vendorSuggestions'),
        highAmountWarning: document.getElementById('highAmountWarning'),
        fHsCode: document.getElementById('fHsCode'),
        fLcOrContractNo: document.getElementById('fLcOrContractNo'),
        fImportDeclNo: document.getElementById('fImportDeclNo'),
        fPriceTerms: document.getElementById('fPriceTerms'),
        fTradePurpose: document.getElementById('fTradePurpose'),
        fSubmitDate: document.getElementById('fSubmitDate'),
        fStatus: document.getElementById('fStatus'),
        fRemarks: document.getElementById('fRemarks'),
        priceTermsChips: document.getElementById('priceTermsChips'),
        tradePurposeChips: document.getElementById('tradePurposeChips'),

        // Expense Picker Modal
        btnOpenExpensePickerTop: document.getElementById('btnOpenExpensePickerTop'),
        btnOpenExpensePickerModal: document.getElementById('btnOpenExpensePickerModal'),
        expensePickerModal: document.getElementById('expensePickerModal'),
        btnCloseExpensePicker: document.getElementById('btnCloseExpensePicker'),
        btnCancelExpensePicker: document.getElementById('btnCancelExpensePicker'),
        pickerSearchInput: document.getElementById('pickerSearchInput'),
        pickerForeignOnly: document.getElementById('pickerForeignOnly'),
        expensePickerBody: document.getElementById('expensePickerBody')
    };

    // ─────────────────────────────────────────────────────────
    // 1. 거래처 자동완성 목록 로드 (수취인명 입력 편의)
    // ─────────────────────────────────────────────────────────
    async function loadVendorSuggestions() {
        try {
            const res = await authFetch(PARTNERS_API_URL);
            if (!res.ok) return;
            const vendors = await res.json();
            allVendors = Array.isArray(vendors) ? vendors : [];
            const names = new Set();
            allVendors.forEach(v => {
                if (v.companyNameEn) names.add(v.companyNameEn.trim());
                if (v.vendorName) names.add(v.vendorName.trim());
                if (v.companyName) names.add(v.companyName.trim());
                if (Array.isArray(v.accounts)) {
                    v.accounts.forEach(acc => {
                        if (acc.accountHolder) names.add(acc.accountHolder.trim());
                    });
                }
            });
            els.vendorSuggestions.innerHTML = Array.from(names)
                .filter(Boolean)
                .map(n => `<option value="${escapeHtml(n)}">`)
                .join('');
        } catch (e) {}
    }

    function resolveBeneficiaryFromExpense(exp) {
        if (!exp) return '';
        const vId = exp.vendorId ? String(exp.vendorId) : '';
        const vName = (exp.vendorName || '').trim().toLowerCase();
        const matchedVendor = allVendors.find(v =>
            (vId && (String(v.id) === vId || (Array.isArray(v.aliasIds) && v.aliasIds.includes(vId)))) ||
            (vName && (
                (v.vendorName && v.vendorName.trim().toLowerCase() === vName) ||
                (v.companyName && v.companyName.trim().toLowerCase() === vName) ||
                (v.companyNameEn && v.companyNameEn.trim().toLowerCase() === vName)
            ))
        );
        return (matchedVendor && matchedVendor.companyNameEn) || exp.accountHolder || exp.vendorName || '';
    }

    // ─────────────────────────────────────────────────────────
    // 2. 전체 확인서 목록 로드 및 KPI/테이블 렌더링
    // ─────────────────────────────────────────────────────────
    async function loadDocuments() {
        try {
            const res = await authFetch(API_URL);
            if (res.ok) {
                const serverDocs = await res.json();
                // 로컬 캐시에만 있는 미동기화 항목이 있으면 병합
                const localDocs = readLocalCache();
                const serverIds = new Set(serverDocs.map(d => d.id));
                const unsynced = localDocs.filter(d => d._localOnly && !serverIds.has(d.id));
                for (const doc of unsynced) {
                    try {
                        const syncRes = await authFetch(API_URL, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(doc)
                        });
                        if (syncRes.ok) delete doc._localOnly;
                    } catch (e) {}
                }
                const refreshed = await authFetch(API_URL);
                allDocuments = refreshed.ok ? await refreshed.json() : serverDocs;
                writeLocalCache(allDocuments);
            } else {
                allDocuments = readLocalCache();
            }
        } catch (err) {
            console.warn('서버 목록 조회 실패, 로컬 캐시 사용:', err);
            allDocuments = readLocalCache();
        }
        renderKpis();
        renderTable();
    }

    function renderKpis() {
        const now = new Date();
        const ymPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        els.kpiCurrentMonthLabel.textContent = `${now.getMonth() + 1}월`;

        let monthCount = 0;
        let usdTotal = 0;
        let otherCount = 0;

        allDocuments.forEach(doc => {
            const rDate = doc.remittanceDate || doc.submitDate || '';
            if (rDate.startsWith(ymPrefix)) monthCount++;
            const curr = String(doc.currency || 'USD').toUpperCase();
            const amt = parseFloat(String(doc.amount || 0).replace(/,/g, '')) || 0;
            if (curr === 'USD') {
                usdTotal += amt;
            } else {
                otherCount++;
            }
        });

        els.kpiTotalCount.innerHTML = `${allDocuments.length} <small>건</small>`;
        els.kpiMonthCount.innerHTML = `${monthCount} <small>건</small>`;
        els.kpiUsdTotal.textContent = `$ ${formatAmountDisplay(usdTotal, 'USD')}`;
        els.kpiOtherCount.innerHTML = `${otherCount} <small>건</small>`;
    }

    function renderTable() {
        const statusFilter = els.filterStatus.value;
        const currFilter = els.filterCurrency.value;
        const kw = els.filterKeyword.value.trim().toLowerCase();

        const filtered = allDocuments.filter(doc => {
            if (statusFilter && doc.status !== statusFilter) return false;
            if (currFilter && String(doc.currency || '').toUpperCase() !== currFilter) return false;
            if (kw) {
                const hay = [
                    doc.beneficiaryName,
                    doc.hsCode,
                    doc.lcOrContractNo,
                    doc.importDeclNo,
                    doc.priceTerms,
                    doc.tradePurpose,
                    doc.remarks,
                    doc.expenseTitle
                ].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(kw)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            els.docListBody.innerHTML = `<tr><td colspan="13" class="empty-state"><i class='bx bx-folder-open'></i>조건에 일치하는 무역대금 송금 추가 확인서가 없습니다.</td></tr>`;
            return;
        }

        els.docListBody.innerHTML = filtered.map(doc => {
            const curr = String(doc.currency || 'USD').toUpperCase();
            const sym = getCurrencySymbol(curr);
            const amtStr = formatAmountDisplay(doc.amount, curr);
            const linkedBadge = doc.expenseId
                ? `<span class="badge badge-linked" title="연동 지출결의서: ${escapeHtml(doc.expenseTitle || doc.expenseId)}"><i class='bx bx-link'></i>지출연동</span>`
                : '';

            return `
                <tr data-id="${escapeHtml(doc.id)}">
                    <td style="text-align: center;"><input type="checkbox" class="row-check" value="${escapeHtml(doc.id)}"></td>
                    <td>
                        <select class="erp-select status-change-select" data-id="${escapeHtml(doc.id)}" style="height: 24px; font-size: 11px; padding: 0 4px;">
                            <option value="임시작성" ${doc.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                            <option value="결재요청" ${doc.status === '결재요청' ? 'selected' : ''}>결재요청</option>
                            <option value="결재진행중" ${doc.status === '결재진행중' ? 'selected' : ''}>결재진행중</option>
                            <option value="결재완료" ${doc.status === '결재완료' ? 'selected' : ''}>결재완료</option>
                            <option value="결재보류" ${doc.status === '결재보류' ? 'selected' : ''}>결재보류</option>
                        </select>
                    </td>
                    <td style="font-weight: 600;">${escapeHtml(doc.remittanceDate || '-')}</td>
                    <td style="text-align: center;"><span class="badge badge-curr">${escapeHtml(curr)}</span></td>
                    <td style="text-align: right; font-weight: 700; color: var(--primary);">${sym} ${escapeHtml(amtStr)}</td>
                    <td title="${escapeHtml(doc.beneficiaryName || '')}">
                        <strong>${escapeHtml(doc.beneficiaryName || '-')}</strong>
                        ${linkedBadge}
                    </td>
                    <td style="font-family: monospace; font-weight: 600;">${escapeHtml(doc.hsCode || '-')}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(doc.lcOrContractNo || '-')}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(doc.importDeclNo || '-')}</td>
                    <td style="text-align: center;"><span class="badge badge-terms">${escapeHtml(doc.priceTerms || '-')}</span></td>
                    <td>${escapeHtml(doc.tradePurpose || '-')}</td>
                    <td style="color: var(--text-muted);">${escapeHtml(doc.submitDate || '-')}</td>
                    <td style="text-align: center;">
                        <button type="button" class="btn-icon btn-pdf" data-id="${escapeHtml(doc.id)}" title="정품 1:1 PDF 인쇄/다운로드" style="color: var(--success);"><i class='bx bx-printer'></i></button>
                        <button type="button" class="btn-icon btn-copy" data-id="${escapeHtml(doc.id)}" title="이 내역 복사하여 새로 작성"><i class='bx bx-copy'></i></button>
                        <button type="button" class="btn-icon btn-edit" data-id="${escapeHtml(doc.id)}" title="수정"><i class='bx bx-edit-alt'></i></button>
                        <button type="button" class="btn-icon btn-delete" data-id="${escapeHtml(doc.id)}" title="삭제" style="color: var(--danger);"><i class='bx bx-trash'></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ─────────────────────────────────────────────────────────
    // 3. 입력 폼 유틸리티 (칩 동기화, 고액 안내, HS CODE 숫자 제한)
    // ─────────────────────────────────────────────────────────
    function syncQuickChips() {
        const ptVal = els.fPriceTerms.value.trim().toUpperCase();
        els.priceTermsChips.querySelectorAll('.quick-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val.toUpperCase() === ptVal);
        });

        const tpVal = els.fTradePurpose.value.trim();
        els.tradePurposeChips.querySelectorAll('.quick-chip').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === tpVal);
        });
    }

    function checkHighAmountWarning() {
        const curr = els.fCurrency.value;
        const amt = parseFloat(String(els.fAmount.value || '0').replace(/,/g, '')) || 0;
        const isHighUsd = (curr === 'USD' && amt > 100000) || (curr === 'EUR' && amt > 92000) || (curr === 'CNY' && amt > 700000);
        els.highAmountWarning.classList.toggle('show', isHighUsd);
    }

    // H.S. CODE 숫자만 입력 유도
    els.fHsCode.addEventListener('input', () => {
        const raw = els.fHsCode.value;
        const digitsOnly = raw.replace(/[^0-9]/g, '');
        if (raw !== digitsOnly) {
            els.fHsCode.value = digitsOnly;
            showToast('H.S. CODE는 숫자만 입력할 수 있습니다.', 'info');
        }
    });

    // 송금액 입력 포맷팅 (숫자, 소수점, 콤마만 허용)
    els.fAmount.addEventListener('input', () => {
        const clean = els.fAmount.value.replace(/[^0-9.]/g, '');
        const parts = clean.split('.');
        const intPart = parts[0] ? Number(parts[0]).toLocaleString('en-US') : '';
        els.fAmount.value = parts.length > 1 ? `${intPart}.${parts[1].slice(0, 2)}` : intPart;
        checkHighAmountWarning();
    });

    els.fCurrency.addEventListener('change', checkHighAmountWarning);
    els.fPriceTerms.addEventListener('input', syncQuickChips);
    els.fTradePurpose.addEventListener('input', syncQuickChips);

    els.priceTermsChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.quick-chip');
        if (!chip) return;
        els.fPriceTerms.value = chip.dataset.val;
        syncQuickChips();
    });

    els.tradePurposeChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.quick-chip');
        if (!chip) return;
        els.fTradePurpose.value = chip.dataset.val;
        syncQuickChips();
    });

    els.btnClearLink.addEventListener('click', () => {
        els.fExpenseId.value = '';
        els.fExpenseTitle.value = '';
        els.prefillBanner.style.display = 'none';
    });

    // ─────────────────────────────────────────────────────────
    // 4. 모달 열기 / 복사 / 지출결의서 프리필 적용 / 저장
    // ─────────────────────────────────────────────────────────
    let initialRemittanceSnapshot = '';

    function getRemittanceSnapshot() {
        return JSON.stringify({
            expenseId: els.fExpenseId?.value || '',
            expenseTitle: els.fExpenseTitle?.value || '',
            remittanceDate: els.fRemittanceDate?.value || '',
            currency: els.fCurrency?.value || '',
            amount: els.fAmount?.value || '',
            beneficiaryName: els.fBeneficiaryName?.value || '',
            hsCode: els.fHsCode?.value || '',
            lcOrContractNo: els.fLcOrContractNo?.value || '',
            importDeclNo: els.fImportDeclNo?.value || '',
            priceTerms: els.fPriceTerms?.value || '',
            tradePurpose: els.fTradePurpose?.value || '',
            submitDate: els.fSubmitDate?.value || '',
            status: els.fStatus?.value || '',
            remarks: els.fRemarks?.value || ''
        });
    }

    function isRemittanceModalDirty() {
        if (!els.modal || !els.modal.classList.contains('active')) return false;
        return getRemittanceSnapshot() !== initialRemittanceSnapshot;
    }

    function openModal(id = null, copyFromId = null, prefillData = null) {
        currentEditId = id;
        const today = new Date().toISOString().split('T')[0];

        if (id) {
            const doc = allDocuments.find(d => d.id === id);
            if (!doc) return;
            els.modalTitle.innerHTML = `<i class='bx bx-edit'></i> 무역대금 송금 추가 확인서 수정`;
            els.fExpenseId.value = doc.expenseId || '';
            els.fExpenseTitle.value = doc.expenseTitle || '';
            els.fRemittanceDate.value = doc.remittanceDate || today;
            els.fCurrency.value = doc.currency || 'USD';
            els.fAmount.value = formatAmountDisplay(doc.amount, doc.currency);
            els.fBeneficiaryName.value = doc.beneficiaryName || '';
            els.fHsCode.value = String(doc.hsCode || '').replace(/[^0-9]/g, '');
            els.fLcOrContractNo.value = doc.lcOrContractNo || '';
            els.fImportDeclNo.value = doc.importDeclNo || '';
            els.fPriceTerms.value = doc.priceTerms || 'FOB';
            els.fTradePurpose.value = doc.tradePurpose || '판매용';
            els.fSubmitDate.value = doc.submitDate || today;
            els.fStatus.value = doc.status || '결재요청';
            els.fRemarks.value = doc.remarks || '';

            if (doc.expenseId) {
                els.prefillBanner.style.display = 'flex';
                els.prefillBannerText.textContent = `연동된 지출결의서: ${doc.expenseTitle || doc.expenseId}`;
            } else {
                els.prefillBanner.style.display = 'none';
            }
        } else if (copyFromId) {
            const doc = allDocuments.find(d => d.id === copyFromId);
            if (!doc) return;
            currentEditId = null;
            els.modalTitle.innerHTML = `<i class='bx bx-copy'></i> 무역대금 송금 추가 확인서 작성 (복사됨)`;
            els.fExpenseId.value = '';
            els.fExpenseTitle.value = '';
            els.prefillBanner.style.display = 'none';
            els.fRemittanceDate.value = today;
            els.fCurrency.value = doc.currency || 'USD';
            els.fAmount.value = formatAmountDisplay(doc.amount, doc.currency);
            els.fBeneficiaryName.value = doc.beneficiaryName || '';
            els.fHsCode.value = String(doc.hsCode || '').replace(/[^0-9]/g, '');
            els.fLcOrContractNo.value = doc.lcOrContractNo || '';
            els.fImportDeclNo.value = doc.importDeclNo || '';
            els.fPriceTerms.value = doc.priceTerms || 'FOB';
            els.fTradePurpose.value = doc.tradePurpose || '판매용';
            els.fSubmitDate.value = today;
            els.fStatus.value = '결재요청';
            els.fRemarks.value = doc.remarks || '';
        } else if (prefillData) {
            currentEditId = null;
            els.modalTitle.innerHTML = `<i class='bx bx-link'></i> 무역대금 송금 추가 확인서 작성 (지출결의서 연동)`;
            els.fExpenseId.value = prefillData.expenseId || '';
            els.fExpenseTitle.value = prefillData.title || '';
            els.fRemittanceDate.value = prefillData.remittanceDate || today;
            els.fCurrency.value = prefillData.currency || 'USD';
            els.fAmount.value = prefillData.amount ? formatAmountDisplay(prefillData.amount, prefillData.currency) : '';
            els.fBeneficiaryName.value = prefillData.beneficiaryName || '';
            els.fHsCode.value = String(prefillData.hsCode || '').replace(/[^0-9]/g, '');
            els.fLcOrContractNo.value = prefillData.lcOrContractNo || '';
            els.fImportDeclNo.value = prefillData.importDeclNo || '';
            els.fPriceTerms.value = prefillData.priceTerms || 'FOB';
            els.fTradePurpose.value = prefillData.tradePurpose || '판매용';
            els.fSubmitDate.value = prefillData.submitDate || today;
            els.fStatus.value = '결재요청';
            els.fRemarks.value = prefillData.title ? `[지출결의서 연동] ${prefillData.title}` : '';

            els.prefillBanner.style.display = 'flex';
            els.prefillBannerText.textContent = `지출결의서 [${prefillData.title || '외화 송금'}]의 신청일·통화·송금액·수취인명이 자동 입력되었습니다.`;
        } else {
            currentEditId = null;
            els.modalTitle.innerHTML = `<i class='bx bx-plus-circle'></i> 새 무역대금 송금 추가 확인서 작성`;
            els.fExpenseId.value = '';
            els.fExpenseTitle.value = '';
            els.prefillBanner.style.display = 'none';
            els.fRemittanceDate.value = today;
            els.fCurrency.value = 'USD';
            els.fAmount.value = '';
            els.fBeneficiaryName.value = '';
            els.fHsCode.value = '';
            els.fLcOrContractNo.value = '';
            els.fImportDeclNo.value = '';
            els.fPriceTerms.value = 'FOB';
            els.fTradePurpose.value = '판매용';
            els.fSubmitDate.value = today;
            els.fStatus.value = '결재요청';
            els.fRemarks.value = '';
        }

        syncQuickChips();
        checkHighAmountWarning();
        els.modal.classList.add('active');
        initialRemittanceSnapshot = (copyFromId || prefillData) ? '' : getRemittanceSnapshot();

        if (prefillData) {
            setTimeout(() => els.fHsCode.focus(), 150);
        }
    }

    function closeModal(force = false) {
        if (force !== true && isRemittanceModalDirty()) {
            if (!confirm('작성/수정 중인 송금 추가 확인서 내용이 있습니다.\n저장하지 않고 닫으시겠습니까?')) {
                return;
            }
        }
        els.modal.classList.remove('active');
        currentEditId = null;
        initialRemittanceSnapshot = '';
    }

    function collectFormPayload() {
        const user = getCurrentUser();
        const rawAmt = String(els.fAmount.value || '').replace(/,/g, '').trim();
        const amountNum = parseFloat(rawAmt);

        return {
            userEmail: user.email,
            author: user.name,
            expenseId: els.fExpenseId.value.trim(),
            expenseTitle: els.fExpenseTitle.value.trim(),
            remittanceDate: els.fRemittanceDate.value.trim(),
            currency: els.fCurrency.value.trim().toUpperCase(),
            amount: isNaN(amountNum) ? 0 : amountNum,
            beneficiaryName: els.fBeneficiaryName.value.trim(),
            paymentMethodType: '사전 송금방식',
            importPeriodType: '1년 이내',
            tradeType: '일반 수입',
            hsCode: els.fHsCode.value.replace(/[^0-9]/g, ''),
            lcOrContractNo: els.fLcOrContractNo.value.trim(),
            importDeclNo: els.fImportDeclNo.value.trim(),
            priceTerms: els.fPriceTerms.value.trim(),
            tradePurpose: els.fTradePurpose.value.trim(),
            submitDate: els.fSubmitDate.value.trim(),
            status: els.fStatus.value,
            remarks: els.fRemarks.value.trim()
        };
    }

    function validatePayload(payload) {
        if (!payload.remittanceDate) {
            showToast('송금신청일을 선택해 주세요.', 'warning');
            els.fRemittanceDate.focus();
            return false;
        }
        if (!payload.amount || payload.amount <= 0) {
            showToast('송금액을 입력해 주세요.', 'warning');
            els.fAmount.focus();
            return false;
        }
        if (!payload.beneficiaryName) {
            showToast('수취인명을 입력해 주세요.', 'warning');
            els.fBeneficiaryName.focus();
            return false;
        }
        if (!payload.hsCode) {
            showToast('H.S. CODE(숫자)를 입력해 주세요.', 'warning');
            els.fHsCode.focus();
            return false;
        }
        if (!payload.priceTerms) {
            showToast('가격조건(예: FOB, CIF)을 입력해 주세요.', 'warning');
            els.fPriceTerms.focus();
            return false;
        }
        if (!payload.tradePurpose) {
            showToast('수출입용도(예: 판매용)를 입력해 주세요.', 'warning');
            els.fTradePurpose.focus();
            return false;
        }
        if (!payload.submitDate) {
            showToast('작성일자를 선택해 주세요.', 'warning');
            els.fSubmitDate.focus();
            return false;
        }
        return true;
    }

    async function saveDocument() {
        const payload = collectFormPayload();
        if (!validatePayload(payload)) return;

        const isEdit = !!currentEditId;
        const url = isEdit ? `${API_URL}/${currentEditId}` : API_URL;
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                showToast(isEdit ? '확인서가 수정되었습니다.' : '확인서가 서버에 저장되었습니다.', 'success');
                closeModal(true);
                await loadDocuments();
                return;
            }
            throw new Error('Server status ' + res.status);
        } catch (err) {
            // 서버 재시작 전이라도 데이터 유실 없이 즉시 저장되도록 로컬 캐시 동기화 지원
            const now = new Date().toISOString();
            const cache = readLocalCache();
            if (isEdit) {
                const idx = cache.findIndex(d => d.id === currentEditId);
                if (idx !== -1) {
                    cache[idx] = { ...cache[idx], ...payload, updatedAt: now, _localOnly: true };
                }
            } else {
                const newDoc = {
                    id: 'TR-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
                    ...payload,
                    createdAt: now,
                    updatedAt: now,
                    _localOnly: true
                };
                cache.unshift(newDoc);
            }
            writeLocalCache(cache);
            allDocuments = cache;
            showToast(isEdit ? '확인서가 수정되었습니다.' : '확인서가 저장되었습니다.', 'success');
            closeModal(true);
            renderKpis();
            renderTable();
        }
    }

    // ─────────────────────────────────────────────────────────
    // 5. 원본 1:1 정품 PDF 인쇄 및 미리보기
    // ─────────────────────────────────────────────────────────
    async function openPdfForData(dataObj, savedId = null) {
        const newWin = window.open('about:blank', '_blank');
        if (newWin) {
            newWin.document.write('<div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#333;"><p style="font-size:18px;font-weight:600;">무역대금 송금 추가 확인서 1:1 정품 PDF 생성 중...</p><p style="color:#666;">잠시만 기다려주세요.</p></div>');
        }

        try {
            showToast('1:1 정품 PDF 생성 중...', 'info');
            let blob = null;

            // 1차: 백엔드 서버 PDF 생성 호출
            try {
                const res = savedId
                    ? await authFetch(`${API_URL}/${savedId}/pdf`)
                    : await authFetch(`${API_URL}/preview-pdf`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(dataObj)
                    });
                if (res.ok) {
                    blob = await res.blob();
                }
            } catch (serverErr) {
                console.warn('서버 PDF 엔드포인트 호출 실패, 클라이언트 PDF 엔진 사용:', serverErr);
            }

            // 2차: 클라이언트 1:1 PDF 엔진 Fallback
            if (!blob) {
                blob = await generateClientSidePdfBlob(dataObj);
            }

            const blobUrl = URL.createObjectURL(blob);
            if (newWin) newWin.location.href = blobUrl;
            else window.open(blobUrl, '_blank');
        } catch (err) {
            console.error(err);
            if (newWin) newWin.close();
            showToast('PDF 생성 중 오류가 발생했습니다: ' + err.message, 'error');
        }
    }

    async function handlePrintFromModal() {
        const payload = collectFormPayload();
        if (!validatePayload(payload)) return;
        await openPdfForData(payload, null);
    }

    // ─────────────────────────────────────────────────────────
    // 6. 상태 변경 / 삭제 / 엑셀 내보내기
    // ─────────────────────────────────────────────────────────
    async function changeStatus(id, status) {
        try {
            const res = await authFetch(`${API_URL}/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            });
            if (!res.ok) throw new Error('Status update failed');
        } catch (e) {
            const cache = readLocalCache();
            const item = cache.find(d => d.id === id);
            if (item) {
                item.status = status;
                writeLocalCache(cache);
            }
        }
        showToast(`결재 상태가 [${status}]으로 변경되었습니다.`, 'success');
        loadDocuments();
    }

    function deleteDocument(id) {
        Swal.fire({
            title: '확인서를 삭제하시겠습니까?',
            text: '삭제된 문서는 복구할 수 없습니다.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        }).then(async (result) => {
            if (!result.isConfirmed) return;
            try {
                await authFetch(`${API_URL}/${id}`, { method: 'DELETE' });
            } catch (e) {}
            const cache = readLocalCache().filter(d => d.id !== id);
            writeLocalCache(cache);
            showToast('삭제되었습니다.', 'success');
            loadDocuments();
        });
    }

    function deleteSelectedDocuments() {
        const checked = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.value);
        if (checked.length === 0) {
            showToast('삭제할 항목을 선택해 주세요.', 'warning');
            return;
        }
        Swal.fire({
            title: `선택한 ${checked.length}개 확인서를 삭제하시겠습니까?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        }).then(async (result) => {
            if (!result.isConfirmed) return;
            try {
                await authFetch(`${API_URL}/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: checked })
                });
            } catch (e) {}
            const idSet = new Set(checked);
            const cache = readLocalCache().filter(d => !idSet.has(d.id));
            writeLocalCache(cache);
            els.selectAll.checked = false;
            showToast(`${checked.length}개 항목이 삭제되었습니다.`, 'success');
            loadDocuments();
        });
    }

    function exportToExcel() {
        if (allDocuments.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }
        let csv = '\uFEFF결재상태,송금신청일,통화,송금액,수취인명,대금결제방식,대응수입예정일,무역거래형태,H.S. CODE,L/C 또는 계약서 번호,수출입신고번호,가격조건,수출입용도,작성일자,비고\n';
        allDocuments.forEach(d => {
            const row = [
                d.status || '',
                d.remittanceDate || '',
                d.currency || 'USD',
                d.amount || 0,
                `"${String(d.beneficiaryName || '').replace(/"/g, '""')}"`,
                '사전 송금방식',
                '1년 이내',
                '일반 수입',
                `="${String(d.hsCode || '')}"`,
                `"${String(d.lcOrContractNo || '').replace(/"/g, '""')}"`,
                `"${String(d.importDeclNo || '').replace(/"/g, '""')}"`,
                d.priceTerms || '',
                `"${String(d.tradePurpose || '').replace(/"/g, '""')}"`,
                d.submitDate || '',
                `"${String(d.remarks || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `무역대금_송금_추가_확인서_대장_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }

    // ─────────────────────────────────────────────────────────
    // 7. 지출결의서 바로가기 및 프리필(Pre-fill) 수신
    // ─────────────────────────────────────────────────────────
    function navigateToExpenseModule() {
        const targetUrl = './05_Management/forms/expense.html';
        if (window.parent && window.parent !== window) {
            try {
                if (typeof window.parent.openPortalTab === 'function') {
                    window.parent.openPortalTab(targetUrl, '지출결의서', 'bx bx-wallet', 'iframe');
                    return;
                }
            } catch (e) {
                console.warn('openPortalTab 호출 중 예외 발생, postMessage로 폴백:', e);
            }
            try {
                window.parent.postMessage({
                    type: 'KNG_PORTAL_OPEN_TAB',
                    url: targetUrl,
                    title: '지출결의서',
                    icon: 'bx bx-wallet',
                    navType: 'iframe'
                }, '*');
            } catch (e) {}
            return;
        }
        window.location.href = 'expense.html';
    }

    function consumePendingPrefill() {
        try {
            const raw = localStorage.getItem(PREFILL_STORAGE_KEY);
            if (!raw) return;
            localStorage.removeItem(PREFILL_STORAGE_KEY);
            const data = JSON.parse(raw);
            if (data && typeof data === 'object') {
                openModal(null, null, data);
            }
        } catch (e) {
            console.error('Prefill 파싱 오류:', e);
        }
    }

    // ─────────────────────────────────────────────────────────
    // 7-2. 기작성 지출결의서 불러오기 팝업 로직
    // ─────────────────────────────────────────────────────────
    async function openExpensePicker() {
        els.expensePickerModal.classList.add('active');
        els.expensePickerBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text-muted);">지출결의서 목록을 불러오는 중...</td></tr>`;
        try {
            const res = await authFetch(EXPENSE_API_URL);
            if (!res.ok) throw new Error('지출결의서 목록 조회 실패');
            const list = await res.json();
            allExpenses = Array.isArray(list) ? list : [];
            renderExpensePickerTable();
        } catch (err) {
            console.error(err);
            els.expensePickerBody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--danger);">지출결의서 목록을 불러오지 못했습니다.</td></tr>`;
        }
    }

    function closeExpensePicker() {
        els.expensePickerModal.classList.remove('active');
    }

    function renderExpensePickerTable() {
        const foreignOnly = els.pickerForeignOnly.checked;
        const kw = els.pickerSearchInput.value.trim().toLowerCase();

        const filtered = allExpenses.filter(exp => {
            const curr = String(exp.currency || 'KRW').toUpperCase();
            if (foreignOnly && curr === 'KRW') return false;
            if (kw) {
                const hay = [
                    exp.title,
                    exp.vendorName,
                    exp.accountHolder,
                    exp.personInCharge,
                    exp.currency,
                    exp.paymentDate,
                    exp.createdDate
                ].filter(Boolean).join(' ').toLowerCase();
                if (!hay.includes(kw)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            els.expensePickerBody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class='bx bx-search-alt'></i>조건에 일치하는 지출결의서가 없습니다.${foreignOnly ? ' (원화 포함 전체를 보려면 우측 상단 체크를 해제하세요)' : ''}</td></tr>`;
            return;
        }

        els.expensePickerBody.innerHTML = filtered.map(exp => {
            const curr = String(exp.currency || 'KRW').toUpperCase();
            const sym = getCurrencySymbol(curr);
            const amtStr = formatAmountDisplay(exp.amount, curr);
            const beneficiary = resolveBeneficiaryFromExpense(exp) || exp.vendorName || '-';
            const existingDoc = allDocuments.find(d => String(d.expenseId) === String(exp.id));

            const statusBadge = existingDoc
                ? `<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;"><i class='bx bx-check'></i> 작성완료</span>`
                : `<span class="badge" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;">미작성</span>`;

            return `
                <tr data-exp-id="${escapeHtml(exp.id)}">
                    <td style="font-weight: 600;">${escapeHtml(exp.paymentDate || exp.createdDate || '-')}</td>
                    <td title="${escapeHtml(exp.title || '')}"><strong>${escapeHtml(exp.title || '-')}</strong></td>
                    <td title="${escapeHtml(beneficiary)}">${escapeHtml(beneficiary)}</td>
                    <td style="text-align: center;"><span class="badge badge-curr">${escapeHtml(curr)}</span></td>
                    <td style="text-align: right; font-weight: 700; color: var(--primary);">${sym} ${escapeHtml(amtStr)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="text-align: center;">
                        <button type="button" class="btn btn-primary btn-pick-expense" data-exp-id="${escapeHtml(exp.id)}" style="height: 24px; padding: 0 8px; font-size: 11px;">
                            <i class='bx bx-check'></i> 불러오기
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function handleSelectExpenseFromPicker(expId) {
        const exp = allExpenses.find(e => String(e.id) === String(expId));
        if (!exp) return;

        const existingDoc = allDocuments.find(d => String(d.expenseId) === String(exp.id));
        const beneficiary = resolveBeneficiaryFromExpense(exp);
        const curr = String(exp.currency || 'USD').toUpperCase();
        const prefillData = {
            expenseId: String(exp.id),
            title: exp.title || '',
            remittanceDate: exp.paymentDate || exp.createdDate || new Date().toISOString().split('T')[0],
            currency: curr === 'KRW' ? 'USD' : curr,
            amount: exp.amount || 0,
            beneficiaryName: beneficiary,
            submitDate: exp.createdDate || new Date().toISOString().split('T')[0]
        };

        closeExpensePicker();

        // 이미 해당 지출결의서로 작성된 확인서가 있고, 현재 다른 문서를 수정 중이 아니라면 안내
        if (existingDoc && !currentEditId) {
            Swal.fire({
                title: '이미 작성된 송금확인서가 있습니다',
                text: '이 지출결의서로 작성된 기존 송금확인서를 열까요, 아니면 값만 불러와 새로 작성할까요?',
                icon: 'question',
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: '기존 확인서 열기(수정)',
                denyButtonText: '새 확인서로 값만 불러오기',
                cancelButtonText: '취소'
            }).then(result => {
                if (result.isConfirmed) {
                    openModal(existingDoc.id);
                } else if (result.isDenied) {
                    applyPrefillToOpenOrNewModal(prefillData);
                }
            });
            return;
        }

        applyPrefillToOpenOrNewModal(prefillData);
    }

    function applyPrefillToOpenOrNewModal(prefillData) {
        if (els.modal.classList.contains('active')) {
            // 현재 모달이 열려있는 상태에서 지출결의서를 불러온 경우 기존 입력값 유지하며 해당 폼에 값 반영
            els.fExpenseId.value = prefillData.expenseId || '';
            els.fExpenseTitle.value = prefillData.title || '';
            els.fRemittanceDate.value = prefillData.remittanceDate || els.fRemittanceDate.value;
            els.fCurrency.value = prefillData.currency || els.fCurrency.value;
            els.fAmount.value = formatAmountDisplay(prefillData.amount, prefillData.currency);
            els.fBeneficiaryName.value = prefillData.beneficiaryName || els.fBeneficiaryName.value;
            els.fSubmitDate.value = prefillData.submitDate || els.fSubmitDate.value;
            if (!els.fRemarks.value) {
                els.fRemarks.value = prefillData.title ? `[지출결의서 연동] ${prefillData.title}` : '';
            }
            els.prefillBanner.style.display = 'flex';
            els.prefillBannerText.textContent = `지출결의서 [${prefillData.title || '외화 송금'}]의 신청일·통화·송금액·수취인명이 반영되었습니다.`;
            checkHighAmountWarning();
            showToast('지출결의서 정보를 불러왔습니다.', 'success');
        } else {
            openModal(null, null, prefillData);
            showToast('지출결의서 정보를 불러왔습니다.', 'success');
        }
    }

    // 외부(포털 부모창 또는 지출결의서 탭)에서 호출 가능하도록 전역 등록
    window.checkTradeRemittancePrefill = consumePendingPrefill;
    window.onPortalTabActivated = consumePendingPrefill;
    window.addEventListener('storage', (e) => {
        if (e.key === PREFILL_STORAGE_KEY && e.newValue) {
            consumePendingPrefill();
        }
    });
    window.addEventListener('focus', consumePendingPrefill);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) consumePendingPrefill();
    });

    // ─────────────────────────────────────────────────────────
    // 8. 이벤트 바인딩
    // ─────────────────────────────────────────────────────────
    els.btnNewDoc.addEventListener('click', () => openModal());
    els.btnCloseModal.addEventListener('click', () => closeModal(false));
    els.btnSaveDoc.addEventListener('click', saveDocument);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (els.expensePickerModal && els.expensePickerModal.classList.contains('active')) {
                e.preventDefault();
                closeExpensePicker();
            } else if (els.modal && els.modal.classList.contains('active')) {
                e.preventDefault();
                closeModal(false);
            }
        }
    });

    window.hasUnsavedChanges = function() {
        return isRemittanceModalDirty();
    };

    window.addEventListener('beforeunload', (e) => {
        if (window.hasUnsavedChanges && window.hasUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    els.btnPrintPdf.addEventListener('click', handlePrintFromModal);
    els.btnDeleteSelected.addEventListener('click', deleteSelectedDocuments);
    els.btnExportExcel.addEventListener('click', exportToExcel);
    els.btnGoExpense.addEventListener('click', navigateToExpenseModule);

    if (els.btnOpenExpensePickerTop) els.btnOpenExpensePickerTop.addEventListener('click', openExpensePicker);
    if (els.btnOpenExpensePickerModal) els.btnOpenExpensePickerModal.addEventListener('click', openExpensePicker);
    if (els.btnCloseExpensePicker) els.btnCloseExpensePicker.addEventListener('click', closeExpensePicker);
    if (els.btnCancelExpensePicker) els.btnCancelExpensePicker.addEventListener('click', closeExpensePicker);
    if (els.pickerSearchInput) els.pickerSearchInput.addEventListener('input', renderExpensePickerTable);
    if (els.pickerForeignOnly) els.pickerForeignOnly.addEventListener('change', renderExpensePickerTable);
    if (els.expensePickerBody) {
        els.expensePickerBody.addEventListener('click', (e) => {
            const btnPick = e.target.closest('.btn-pick-expense');
            if (btnPick) {
                handleSelectExpenseFromPicker(btnPick.dataset.expId);
            }
        });
    }

    els.filterStatus.addEventListener('change', renderTable);
    els.filterCurrency.addEventListener('change', renderTable);
    els.filterKeyword.addEventListener('input', renderTable);
    els.btnResetFilter.addEventListener('click', () => {
        els.filterStatus.value = '';
        els.filterCurrency.value = '';
        els.filterKeyword.value = '';
        renderTable();
    });

    els.selectAll.addEventListener('change', function() {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = this.checked);
    });

    els.docListBody.addEventListener('click', (e) => {
        const btnPdf = e.target.closest('.btn-pdf');
        const btnCopy = e.target.closest('.btn-copy');
        const btnEdit = e.target.closest('.btn-edit');
        const btnDelete = e.target.closest('.btn-delete');

        if (btnPdf) {
            const doc = allDocuments.find(d => d.id === btnPdf.dataset.id);
            if (doc) openPdfForData(doc, doc.id);
        } else if (btnCopy) {
            openModal(null, btnCopy.dataset.id);
        } else if (btnEdit) {
            openModal(btnEdit.dataset.id);
        } else if (btnDelete) {
            deleteDocument(btnDelete.dataset.id);
        }
    });

    els.docListBody.addEventListener('change', (e) => {
        const statusSelect = e.target.closest('.status-change-select');
        if (statusSelect) {
            changeStatus(statusSelect.dataset.id, statusSelect.value);
        }
    });

    // 초기 실행
    loadVendorSuggestions();
    loadDocuments().then(() => {
        consumePendingPrefill();
    });
});
