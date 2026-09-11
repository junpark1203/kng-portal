/**
 * 현장별 매출내역서 (임시) - 프론트엔드 로직
 * PDF 파싱 (PDF.js) + 미리보기 편집 + 서버 저장 및 검색 그리드
 */

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000/api/site-sales-statements'
    : 'https://kng.junparks.com/api/site-sales-statements';

const $ = (id) => document.getElementById(id);

// 전역 브라우저 기본 동작(파일 드롭 시 새 탭 열림) 즉시 원천 방지
const preventDragDefault = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
    }
};

['dragenter', 'dragover', 'dragleave'].forEach(eventName => {
    window.addEventListener(eventName, preventDragDefault, false);
    document.addEventListener(eventName, preventDragDefault, false);
});

// 전역 drop: 브라우저 파일 열림 방지 및 PDF 드롭 시 즉시 파싱 처리
window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (files && files.length > 0) {
        const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (pdfFiles.length > 0) {
            if (window.app) {
                if (window.app.currentTab !== 'upload') {
                    window.app.switchTab('upload');
                }
                window.app.handleFilesSelected(files);
            }
        }
    }
}, false);

document.addEventListener('drop', (e) => {
    e.preventDefault();
}, false);

// ── 인증 및 Fetch 헬퍼 ──
async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent !== window && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
        }
    } catch (e) {}

    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    options.headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(url, options);
    } catch (netErr) {
        throw new Error(`서버 통신 실패: ${netErr.message}`);
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP error ${res.status}`);
    }
    return await res.json();
}

// ── 로컬 스토리지 Fallback 지원 ──
const LOCAL_STORAGE_KEY = 'kng_site_sales_statements_records';
function getLocalRecords() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch(e) {
        return [];
    }
}
function saveLocalRecords(records) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
}

const app = {
    currentTab: 'history',
    historyItems: [],
    parsedItems: [],
    selectedIds: new Set(),
    sitesList: [],

    init() {
        this.initDatePresets();
        this.bindDropzone();
        this.loadSites();
        this.search();
    },

    // ── 탭 전환 ──
    switchTab(tab) {
        this.currentTab = tab;
        const histBtn = $('tabHistoryBtn');
        const uploadBtn = $('tabUploadBtn');
        const histView = $('tabHistoryView');
        const uploadView = $('tabUploadView');

        if (tab === 'history') {
            histBtn.classList.add('active');
            uploadBtn.classList.remove('active');
            histView.style.display = 'block';
            uploadView.style.display = 'none';
            this.search();
        } else {
            uploadBtn.classList.add('active');
            histBtn.classList.remove('active');
            uploadView.style.display = 'block';
            histView.style.display = 'none';
        }
    },

    // ── 일자 프리셋 ──
    initDatePresets() {
        this.setDatePreset('thisMonth');
    },

    setDatePreset(type) {
        const now = new Date();
        let start = '';
        let end = '';

        const y = now.getFullYear();
        const m = now.getMonth(); // 0-based

        const formatD = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (type === 'all') {
            start = '';
            end = '';
        } else if (type === 'thisMonth') {
            start = formatD(new Date(y, m, 1));
            end = formatD(new Date(y, m + 1, 0));
        } else if (type === 'lastMonth') {
            start = formatD(new Date(y, m - 1, 1));
            end = formatD(new Date(y, m, 0));
        } else if (type === 'thisYear') {
            start = `${y}-01-01`;
            end = `${y}-12-31`;
        }

        $('filterStartDate').value = start;
        $('filterEndDate').value = end;

        // 버튼 활성화 토글
        const btns = $('datePresetGroup').querySelectorAll('.preset-btn');
        btns.forEach(b => b.classList.remove('active'));
        if (event && event.target && event.target.classList.contains('preset-btn')) {
            event.target.classList.add('active');
        }

        if (this.currentTab === 'history') {
            this.search();
        }
    },

    // ── 현장명 목록 불러오기 ──
    async loadSites() {
        try {
            const sites = await authFetch(`${API_BASE}/sites`);
            this.sitesList = sites || [];
        } catch (err) {
            const records = getLocalRecords();
            this.sitesList = Array.from(new Set(records.map(r => r.site_name).filter(Boolean))).sort();
        }
        const sel = $('filterSite');
        sel.innerHTML = '<option value="">전체 현장</option>';
        this.sitesList.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            sel.appendChild(opt);
        });
    },

    // ── 내역 검색 ──
    async search() {
        const startDate = $('filterStartDate').value;
        const endDate = $('filterEndDate').value;
        const site = $('filterSite').value;
        const keyword = $('filterKeyword').value.trim();

        const tbody = $('historyTableBody');
        tbody.innerHTML = `<tr><td colspan="15" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>데이터를 조회하는 중입니다...</td></tr>`;

        let res;
        try {
            const params = new URLSearchParams();
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            if (site) params.append('site', site);
            if (keyword) params.append('keyword', keyword);
            params.append('limit', '500');

            res = await authFetch(`${API_BASE}?${params.toString()}`);
        } catch (err) {
            let list = getLocalRecords();
            if (startDate) list = list.filter(i => i.date >= startDate);
            if (endDate) list = list.filter(i => i.date <= endDate);
            if (site) list = list.filter(i => i.site_name === site);
            if (keyword) {
                const kw = keyword.toLowerCase();
                list = list.filter(i => 
                    (i.item_name && i.item_name.toLowerCase().includes(kw)) ||
                    (i.supplier && i.supplier.toLowerCase().includes(kw)) ||
                    (i.file_name && i.file_name.toLowerCase().includes(kw)) ||
                    (i.site_name && i.site_name.toLowerCase().includes(kw))
                );
            }
            const summary = list.reduce((acc, cur) => {
                acc.totalQty += Number(cur.qty) || 0;
                acc.totalSupplyAmount += Number(cur.supply_amount) || 0;
                acc.totalVatAmount += Number(cur.vat_amount) || 0;
                acc.totalAmount += Number(cur.total_amount) || 0;
                return acc;
            }, { totalQty: 0, totalSupplyAmount: 0, totalVatAmount: 0, totalAmount: 0 });

            res = {
                totalCount: list.length,
                summary,
                items: list
            };
        }

        try {
            this.historyItems = res.items || [];
            this.selectedIds.clear();
            this.updateBatchDeleteButton();

            // 상단 카운트 및 KPI 갱신
            $('tabHistoryCount').textContent = res.totalCount || 0;
            $('kpiCount').textContent = (res.totalCount || 0).toLocaleString();
            $('kpiQty').textContent = (res.summary.totalQty || 0).toLocaleString();
            $('kpiSupplyAmt').textContent = (res.summary.totalSupplyAmount || 0).toLocaleString() + '원';
            $('kpiTotalAmt').textContent = (res.summary.totalAmount || 0).toLocaleString() + '원';

            // 하단 푸터 합계
            $('footTotalQty').textContent = (res.summary.totalQty || 0).toLocaleString();
            $('footTotalSupply').textContent = (res.summary.totalSupplyAmount || 0).toLocaleString() + '원';
            $('footTotalVat').textContent = (res.summary.totalVatAmount || 0).toLocaleString() + '원';
            $('footTotalAmount').textContent = (res.summary.totalAmount || 0).toLocaleString() + '원';

            this.renderHistoryTable();
        } catch (renderErr) {
            tbody.innerHTML = `<tr><td colspan="15" class="text-center py-4 text-danger"><i class='bx bx-error me-1'></i>렌더링 실패: ${renderErr.message}</td></tr>`;
        }
    },

    resetSearch() {
        this.setDatePreset('thisMonth');
        $('filterSite').value = '';
        $('filterKeyword').value = '';
        this.search();
    },

    // ── 내역 테이블 렌더링 ──
    renderHistoryTable() {
        const tbody = $('historyTableBody');
        if (this.historyItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="15" class="text-center py-5 text-muted"><i class='bx bx-info-circle me-1'></i>등록된 현장별 매출내역이 없습니다. [PDF 업로드 & 파싱] 탭에서 등록해 보세요.</td></tr>`;
            $('selectAllCheckbox').checked = false;
            return;
        }

        tbody.innerHTML = this.historyItems.map((item, idx) => {
            const isChecked = this.selectedIds.has(item.id);
            const qtyStr = Number(item.qty).toLocaleString();
            const priceStr = item.unit_price ? Number(item.unit_price).toLocaleString() + '원' : '-';
            const supplyStr = item.supply_amount ? Number(item.supply_amount).toLocaleString() + '원' : '-';
            const vatStr = item.vat_amount ? Number(item.vat_amount).toLocaleString() + '원' : '-';
            const totalStr = item.total_amount ? Number(item.total_amount).toLocaleString() + '원' : '-';

            return `
                <tr id="row_${item.id}">
                    <td class="text-center"><input type="checkbox" class="row-checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} onchange="app.toggleSelectRow(${item.id}, this.checked)"></td>
                    <td class="text-center text-muted">${idx + 1}</td>
                    <td class="text-center tabular-nums">${item.date || '-'}</td>
                    <td title="${item.site_name || ''}">
                        <span class="badge-site">${item.site_name || '-'}</span>
                    </td>
                    <td title="${item.supplier || ''}">
                        <span class="badge-supplier">${item.supplier || '-'}</span>
                    </td>
                    <td title="${item.item_name}"><strong class="text-dark">${item.item_name}</strong></td>
                    <td class="text-center" title="${item.spec || ''}">${item.spec || '-'}</td>
                    <td class="text-center">${item.unit || '-'}</td>
                    <td class="text-end fw-bold tabular-nums text-primary">${qtyStr}</td>
                    <td class="text-end tabular-nums text-muted">${priceStr}</td>
                    <td class="text-end tabular-nums text-dark">${supplyStr}</td>
                    <td class="text-end tabular-nums text-muted">${vatStr}</td>
                    <td class="text-end fw-bold tabular-nums text-danger">${totalStr}</td>
                    <td class="text-muted" title="${item.file_name || ''}" style="font-size:11px;">
                        ${item.file_name || '-'}
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn btn-sm btn-link text-danger p-0 text-decoration-none" onclick="app.deleteOne(${item.id})" title="삭제">
                            <i class='bx bx-trash'></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    },

    // ── 체크박스 및 선택 삭제 ──
    toggleSelectAll(cb) {
        const checked = cb.checked;
        this.selectedIds.clear();
        if (checked) {
            this.historyItems.forEach(i => this.selectedIds.add(i.id));
        }
        document.querySelectorAll('.row-checkbox').forEach(c => c.checked = checked);
        this.updateBatchDeleteButton();
    },

    toggleSelectRow(id, checked) {
        if (checked) this.selectedIds.add(id);
        else this.selectedIds.delete(id);
        this.updateBatchDeleteButton();
    },

    updateBatchDeleteButton() {
        const btn = $('btnBatchDelete');
        const countSpan = $('selectedCount');
        const count = this.selectedIds.size;
        countSpan.textContent = count;
        btn.style.display = count > 0 ? 'inline-flex' : 'none';
    },

    async deleteOne(id) {
        if (!confirm('해당 내역을 삭제하시겠습니까?')) return;
        try {
            await authFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
        } catch (err) {}
        let list = getLocalRecords().filter(r => r.id !== id);
        saveLocalRecords(list);
        this.search();
        this.loadSites();
    },

    async deleteSelected() {
        const ids = Array.from(this.selectedIds);
        if (ids.length === 0) return;
        if (!confirm(`선택한 ${ids.length}건의 내역을 일괄 삭제하시겠습니까?`)) return;

        try {
            await authFetch(`${API_BASE}/batch-delete`, {
                method: 'POST',
                body: JSON.stringify({ ids })
            });
        } catch (err) {}
        const set = new Set(ids);
        let list = getLocalRecords().filter(r => !set.has(r.id));
        saveLocalRecords(list);
        alert(`${ids.length}건이 성공적으로 삭제되었습니다.`);
        this.search();
        this.loadSites();
    },

    // ── 엑셀 다운로드 (CSV / TSV 지원) ──
    exportExcel() {
        if (this.historyItems.length === 0) {
            alert('다운로드할 데이터가 없습니다.');
            return;
        }

        const headers = ['거래일자', '현장명', '공급처', '품명', '규격', '단위', '수량', '단가', '공급가액', '부가세', '합계금액', '파일명'];
        const rows = this.historyItems.map(i => [
            i.date || '',
            i.site_name || '',
            i.supplier || '',
            i.item_name || '',
            i.spec || '',
            i.unit || '',
            i.qty || 0,
            i.unit_price || 0,
            i.supply_amount || 0,
            i.vat_amount || 0,
            i.total_amount || 0,
            i.file_name || ''
        ]);

        const csvContent = '\uFEFF' + [headers, ...rows].map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',')).join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date().toISOString().split('T')[0];
        a.href = url;
        a.download = `현장별_매출내역서_${today}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // ══════════════════════════════════════════════════════
    // ── 2. PDF 드래그 & 드롭 및 파싱 엔진 ──
    // ══════════════════════════════════════════════════════

    bindDropzone() {
        const dropzone = $('pdfDropzone');

        if (dropzone) {
            ['dragenter', 'dragover'].forEach(eventName => {
                dropzone.addEventListener(eventName, (e) => {
                    preventDragDefault(e);
                    dropzone.classList.add('dragover');
                });
            });

            ['dragleave', 'drop'].forEach(eventName => {
                dropzone.addEventListener(eventName, () => {
                    dropzone.classList.remove('dragover');
                });
            });
        }
    },

    async handleFilesSelected(files) {
        if (!files || files.length === 0) return;
        const pdfFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (pdfFiles.length === 0) {
            alert('PDF 파일(*.pdf)만 선택 가능합니다.');
            return;
        }

        const progressBox = $('parseProgressBox');
        const statusText = $('parseStatusText');
        progressBox.style.display = 'block';

        let totalParsedRows = [];

        try {
            for (let i = 0; i < pdfFiles.length; i++) {
                const file = pdfFiles[i];
                statusText.textContent = `[${i + 1}/${pdfFiles.length}] "${file.name}" 분석 중...`;
                const fileItems = await this.parsePdfFile(file);
                totalParsedRows = totalParsedRows.concat(fileItems);
            }

            if (totalParsedRows.length === 0) {
                alert('선택한 PDF 파일에서 품목 내역을 추출하지 못했습니다.\n서식을 확인해 주세요.');
                progressBox.style.display = 'none';
                return;
            }

            // 기존 파싱 목록에 병합
            this.parsedItems = this.parsedItems.concat(totalParsedRows);
            this.renderPreviewTable();
            $('previewSection').style.display = 'block';

        } catch (err) {
            alert(`PDF 파싱 중 오류 발생: ${err.message}`);
            console.error('PDF Parse Error:', err);
        } finally {
            progressBox.style.display = 'none';
            $('pdfFileInput').value = '';
        }
    },

    /**
     * 단일 PDF 파일을 파싱하여 품목 배열 반환
     */
    async parsePdfFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let detectedDate = '';
        let detectedSite = '';
        let detectedSupplier = '';
        let detectedClient = '';
        const items = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            // 텍스트 아이템들을 Y좌표(위->아래), X좌표(좌->우)로 정렬하여 라인별 그룹핑
            const lines = this.groupTextItemsIntoLines(textContent.items);

            // 1) 문서 메타데이터 탐색 (일자, 현장명, 공급자 등)
            for (const line of lines) {
                const lineStr = line.map(i => i.str).join(' ').trim();

                // 거래일자 탐색: e.g. "2026년 6월 30일" or "2026-06-30" or "2026.06.30"
                if (!detectedDate) {
                    const dateMatch = lineStr.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/) 
                        || lineStr.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
                    if (dateMatch) {
                        const y = dateMatch[1];
                        const m = String(dateMatch[2]).padStart(2, '0');
                        const d = String(dateMatch[3]).padStart(2, '0');
                        detectedDate = `${y}-${m}-${d}`;
                    }
                }

                // 현장명 탐색: e.g. "GTX-B공구 현장 ㈜케이엔글로벌 귀하"
                if (!detectedSite) {
                    if (lineStr.includes('현장')) {
                        // "현장" 포함 구문 추출
                        const siteMatch = lineStr.match(/([^\s]+(?:공구|지구|현장|사업소)?\s*현장)/) || lineStr.match(/(.*?현장)/);
                        if (siteMatch) {
                            detectedSite = siteMatch[1].trim();
                        }
                    } else if (lineStr.includes('귀하')) {
                        // 귀하 앞 텍스트 추출
                        const toMatch = lineStr.match(/(.*?)(?:귀하)/);
                        if (toMatch && toMatch[1].trim()) {
                            detectedSite = toMatch[1].trim();
                        }
                    }
                }

                // 공급자/상호 탐색: e.g. "상호 주식회사 케앤지" or "주식회사 케앤지"
                if (!detectedSupplier) {
                    if (lineStr.includes('케앤지') || lineStr.includes('케이앤지')) {
                        detectedSupplier = '주식회사 케앤지';
                    } else if (lineStr.includes('상호')) {
                        const m = lineStr.match(/상호\s*[:：]?\s*([^\s,]+(?:\s+[^\s,]+)?)/);
                        if (m && m[1]) detectedSupplier = m[1].trim();
                    }
                }

                // 공급받는자
                if (!detectedClient && lineStr.includes('케이엔글로벌')) {
                    detectedClient = '㈜케이엔글로벌';
                }
            }

            // 기본값 보정
            if (!detectedSupplier) detectedSupplier = '주식회사 케앤지';

            // 2) 품목 테이블 행 탐색
            // 테이블 헤더 라인 인덱스 찾기
            let tableStartIndex = -1;
            let tableEndIndex = lines.length;

            for (let idx = 0; idx < lines.length; idx++) {
                const lineStr = lines[idx].map(i => i.str).join(' ');
                if ((lineStr.includes('품명') || lineStr.includes('품 명')) && 
                    (lineStr.includes('수량') || lineStr.includes('단가') || lineStr.includes('순번'))) {
                    tableStartIndex = idx;
                    break;
                }
            }

            if (tableStartIndex !== -1) {
                for (let idx = tableStartIndex + 1; idx < lines.length; idx++) {
                    const lineStr = lines[idx].map(i => i.str).join(' ');
                    // 합계/계 행을 만나면 테이블 종료
                    if (lineStr.startsWith('계') || lineStr.includes('합계') || lineStr.includes('소계') || lineStr.includes('총액')) {
                        tableEndIndex = idx;
                        break;
                    }
                }

                // 품목 행 분석
                for (let idx = tableStartIndex + 1; idx < tableEndIndex; idx++) {
                    const lineItems = lines[idx];
                    const rowParsed = this.parseTableRow(lineItems);
                    if (rowParsed && rowParsed.itemName) {
                        items.push({
                            file_name: file.name,
                            date: detectedDate || new Date().toISOString().split('T')[0],
                            site_name: detectedSite || '현장 미정',
                            client_name: detectedClient || '㈜케이엔글로벌',
                            supplier: detectedSupplier || '주식회사 케앤지',
                            supplier_biz_no: '845-88-00551',
                            item_name: rowParsed.itemName,
                            spec: rowParsed.spec || '',
                            unit: rowParsed.unit || 'ea',
                            qty: rowParsed.qty || 1,
                            unit_price: rowParsed.unitPrice || 0,
                            supply_amount: rowParsed.supplyAmount || 0,
                            vat_amount: rowParsed.vatAmount || 0,
                            total_amount: rowParsed.totalAmount || 0
                        });
                    }
                }
            }
        }

        return items;
    },

    /**
     * PDF 텍스트 아이템들을 시각적 라인별로 그룹핑
     */
    groupTextItemsIntoLines(rawItems) {
        // Y좌표 내림차순(위->아래), X좌표 오름차순(좌->우)
        const sorted = rawItems.filter(i => i.str && i.str.trim()).sort((a, b) => {
            const yA = a.transform[5];
            const yB = b.transform[5];
            if (Math.abs(yB - yA) > 3.5) {
                return yB - yA;
            }
            return a.transform[4] - b.transform[4];
        });

        const lines = [];
        let currentLine = [];
        let lastY = null;

        for (const it of sorted) {
            const y = it.transform[5];
            if (lastY === null || Math.abs(y - lastY) <= 3.5) {
                currentLine.push(it);
                lastY = y;
            } else {
                if (currentLine.length > 0) lines.push(currentLine);
                currentLine = [it];
                lastY = y;
            }
        }
        if (currentLine.length > 0) lines.push(currentLine);
        return lines;
    },

    /**
     * 테이블 1행에서 품명, 규격, 단위, 수량, 단가, 금액 추출
     */
    parseTableRow(lineItems) {
        const rawTokens = lineItems.map(i => i.str.trim()).filter(Boolean);
        if (rawTokens.length < 2) return null;

        const fullStr = rawTokens.join(' ');
        if (fullStr.includes('품명') || fullStr.includes('규격') || fullStr.includes('수량')) return null;

        // 끝에서부터 숫자(콤마 포함) 추출
        // 표준 컬럼: [순번] [품명] [규격] [단위] [수량] [단가] [공급가액] [부가세] [합계금액]
        const numberRegex = /^[0-9,]+$/;
        const numberTokens = [];
        let textTokens = [];

        // 뒤에서부터 숫자인 토큰들을 수집
        let i = rawTokens.length - 1;
        while (i >= 0 && numberRegex.test(rawTokens[i].replace(/,/g, ''))) {
            numberTokens.unshift(Number(rawTokens[i].replace(/,/g, '')));
            i--;
        }
        textTokens = rawTokens.slice(0, i + 1);

        // 첫 번째 토큰이 순번 숫자일 경우 제거
        if (textTokens.length > 0 && /^\d+$/.test(textTokens[0])) {
            textTokens.shift();
        }

        if (textTokens.length === 0) return null;

        // 단위 추출 (textTokens의 마지막 단어가 일반 단위일 경우)
        const commonUnits = ['ea', 'EA', '개', '식', 'm', 'M', 'box', 'BOX', 'kg', 'KG', '롤', 'set', 'SET', '포', '대'];
        let unit = 'ea';
        if (textTokens.length > 1 && commonUnits.includes(textTokens[textTokens.length - 1].toLowerCase())) {
            unit = textTokens.pop();
        }

        // 품명 및 규격 분리
        const itemName = textTokens[0] || '품목';
        const spec = textTokens.slice(1).join(' ') || '';

        // 숫자 매핑
        // numberTokens가 [수량, 단가, 공급가액, 부가세, 합계금액] 형태인 경우
        let qty = 1;
        let unitPrice = 0;
        let supplyAmount = 0;
        let vatAmount = 0;
        let totalAmount = 0;

        if (numberTokens.length >= 5) {
            qty = numberTokens[0];
            unitPrice = numberTokens[1];
            supplyAmount = numberTokens[2];
            vatAmount = numberTokens[3];
            totalAmount = numberTokens[4];
        } else if (numberTokens.length === 4) {
            // [수량, 단가, 공급가액, 합계금액]
            qty = numberTokens[0];
            unitPrice = numberTokens[1];
            supplyAmount = numberTokens[2];
            totalAmount = numberTokens[3];
            vatAmount = totalAmount - supplyAmount;
        } else if (numberTokens.length === 3) {
            // [수량, 단가, 합계금액]
            qty = numberTokens[0];
            unitPrice = numberTokens[1];
            totalAmount = numberTokens[2];
            supplyAmount = Math.round(totalAmount / 1.1);
            vatAmount = totalAmount - supplyAmount;
        } else if (numberTokens.length === 2) {
            qty = numberTokens[0];
            unitPrice = numberTokens[1];
            supplyAmount = qty * unitPrice;
            vatAmount = Math.round(supplyAmount * 0.1);
            totalAmount = supplyAmount + vatAmount;
        } else if (numberTokens.length === 1) {
            totalAmount = numberTokens[0];
            supplyAmount = Math.round(totalAmount / 1.1);
            vatAmount = totalAmount - supplyAmount;
        }

        return {
            itemName,
            spec,
            unit,
            qty,
            unitPrice,
            supplyAmount,
            vatAmount,
            totalAmount
        };
    },

    // ── 프리뷰 편집 그리드 렌더링 ──
    renderPreviewTable() {
        const tbody = $('previewTableBody');
        $('previewCount').textContent = this.parsedItems.length;
        $('previewSaveCount').textContent = this.parsedItems.length;

        if (this.parsedItems.length === 0) {
            tbody.innerHTML = `<tr><td colspan="14" class="text-center py-4 text-muted">파싱된 품목이 없습니다.</td></tr>`;
            this.updatePreviewTotals();
            return;
        }

        tbody.innerHTML = this.parsedItems.map((item, idx) => {
            return `
                <tr id="preview_row_${idx}">
                    <td class="text-center text-muted">${idx + 1}</td>
                    <td><input type="date" class="preview-cell-input tabular-nums" value="${item.date}" onchange="app.updatePreviewField(${idx}, 'date', this.value)"></td>
                    <td><input type="text" class="preview-cell-input" value="${item.site_name}" onchange="app.updatePreviewField(${idx}, 'site_name', this.value)"></td>
                    <td><input type="text" class="preview-cell-input" value="${item.supplier}" onchange="app.updatePreviewField(${idx}, 'supplier', this.value)"></td>
                    <td><input type="text" class="preview-cell-input fw-semibold" value="${item.item_name}" onchange="app.updatePreviewField(${idx}, 'item_name', this.value)"></td>
                    <td><input type="text" class="preview-cell-input text-center" value="${item.spec}" placeholder="-" onchange="app.updatePreviewField(${idx}, 'spec', this.value)"></td>
                    <td><input type="text" class="preview-cell-input text-center" value="${item.unit}" onchange="app.updatePreviewField(${idx}, 'unit', this.value)"></td>
                    <td><input type="number" class="preview-cell-input text-end tabular-nums fw-bold text-primary" value="${item.qty}" onchange="app.updatePreviewQtyOrPrice(${idx}, 'qty', this.value)"></td>
                    <td><input type="number" class="preview-cell-input text-end tabular-nums" value="${item.unit_price}" onchange="app.updatePreviewQtyOrPrice(${idx}, 'unit_price', this.value)"></td>
                    <td><input type="number" class="preview-cell-input text-end tabular-nums text-dark" value="${item.supply_amount}" onchange="app.updatePreviewField(${idx}, 'supply_amount', this.value)"></td>
                    <td><input type="number" class="preview-cell-input text-end tabular-nums text-muted" value="${item.vat_amount}" onchange="app.updatePreviewField(${idx}, 'vat_amount', this.value)"></td>
                    <td><input type="number" class="preview-cell-input text-end tabular-nums fw-bold text-danger" value="${item.total_amount}" onchange="app.updatePreviewField(${idx}, 'total_amount', this.value)"></td>
                    <td class="text-muted" title="${item.file_name}" style="font-size:11px;">
                        ${item.file_name}
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="app.deletePreviewRow(${idx})" title="삭제">
                            <i class='bx bx-x'></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        this.updatePreviewTotals();
    },

    updatePreviewField(idx, field, value) {
        if (!this.parsedItems[idx]) return;
        this.parsedItems[idx][field] = value;
        this.updatePreviewTotals();
    },

    updatePreviewQtyOrPrice(idx, field, value) {
        if (!this.parsedItems[idx]) return;
        this.parsedItems[idx][field] = Number(value) || 0;
        
        // 공급가액, 부가세, 합계금액 자동 계산
        const qty = Number(this.parsedItems[idx].qty) || 0;
        const price = Number(this.parsedItems[idx].unit_price) || 0;
        const supply = Math.round(qty * price);
        const vat = Math.round(supply * 0.1);
        const total = supply + vat;

        this.parsedItems[idx].supply_amount = supply;
        this.parsedItems[idx].vat_amount = vat;
        this.parsedItems[idx].total_amount = total;

        // UI 인풋 값 갱신
        const row = $(`preview_row_${idx}`);
        if (row) {
            const inputs = row.querySelectorAll('input');
            // index 7: qty, 8: price, 9: supply, 10: vat, 11: total
            if (inputs[9]) inputs[9].value = supply;
            if (inputs[10]) inputs[10].value = vat;
            if (inputs[11]) inputs[11].value = total;
        }

        this.updatePreviewTotals();
    },

    updatePreviewTotals() {
        let totalQty = 0;
        let totalSupply = 0;
        let totalVat = 0;
        let totalAmount = 0;

        this.parsedItems.forEach(i => {
            totalQty += Number(i.qty) || 0;
            totalSupply += Number(i.supply_amount) || 0;
            totalVat += Number(i.vat_amount) || 0;
            totalAmount += Number(i.total_amount) || 0;
        });

        $('previewTotalQty').textContent = totalQty.toLocaleString();
        $('previewTotalSupply').textContent = totalSupply.toLocaleString() + '원';
        $('previewTotalVat').textContent = totalVat.toLocaleString() + '원';
        $('previewTotalAmount').textContent = totalAmount.toLocaleString() + '원';
    },

    deletePreviewRow(idx) {
        this.parsedItems.splice(idx, 1);
        this.renderPreviewTable();
    },

    addEmptyPreviewRow() {
        const today = new Date().toISOString().split('T')[0];
        this.parsedItems.push({
            file_name: '직접추가',
            date: today,
            site_name: this.sitesList[0] || 'GTX-B공구 현장',
            client_name: '㈜케이엔글로벌',
            supplier: '주식회사 케앤지',
            supplier_biz_no: '845-88-00551',
            item_name: '신규 품목',
            spec: '',
            unit: 'ea',
            qty: 1,
            unit_price: 0,
            supply_amount: 0,
            vat_amount: 0,
            total_amount: 0
        });
        this.renderPreviewTable();
    },

    clearPreview() {
        if (!confirm('미리보기 목록을 모두 비우시겠습니까?')) return;
        this.parsedItems = [];
        this.renderPreviewTable();
        $('previewSection').style.display = 'none';
    },

    // ── 서버에 일괄 저장 ──
    async savePreviewToServer() {
        if (this.parsedItems.length === 0) {
            alert('저장할 내역이 없습니다.');
            return;
        }

        // 유효성 검사 (품명 및 날짜 체크)
        for (let idx = 0; idx < this.parsedItems.length; idx++) {
            const item = this.parsedItems[idx];
            if (!item.item_name || !item.item_name.trim()) {
                alert(`${idx + 1}번째 행의 품명이 비어 있습니다.`);
                return;
            }
            if (!item.date) {
                alert(`${idx + 1}번째 행의 거래일자가 비어 있습니다.`);
                return;
            }
        }

        const btn = $('btnSaveToServer');
        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> 저장 중...`;

        try {
            await authFetch(API_BASE, {
                method: 'POST',
                body: JSON.stringify({ items: this.parsedItems })
            });
        } catch (err) {}

        // 로컬 스토리지에도 최신 레코드 동기화
        const existing = getLocalRecords();
        const startId = existing.length > 0 ? Math.max(...existing.map(e => Number(e.id) || 0)) + 1 : 1;
        const newRecords = this.parsedItems.map((item, i) => ({
            ...item,
            id: item.id || (startId + i),
            created_at: new Date().toISOString()
        }));
        saveLocalRecords([...newRecords, ...existing]);

        alert(`${this.parsedItems.length}건이 성공적으로 저장되었습니다!`);
        this.parsedItems = [];
        this.renderPreviewTable();
        $('previewSection').style.display = 'none';

        // 사이트 목록 갱신 및 내역 탭으로 이동
        await this.loadSites();
        this.switchTab('history');
        btn.disabled = false;
        btn.innerHTML = `<i class='bx bx-save'></i> 서버에 일괄 저장 (<span id="previewSaveCount">0</span>건)`;
    }
};

window.app = app;

window.addEventListener('DOMContentLoaded', () => {
    app.init();
});
