/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이터 애플리케이션 컨트롤러
 * (Sales Cost & Margin Simulator Application Controller)
 * ══════════════════════════════════════════════════════════════
 * - 1열 탑다운(Top-to-Bottom) 워크플로우 제어
 * - Step 1: 물품대금 매입 내역 및 부가세(VAT) 원가 산입 토글
 * - Step 2: 매입 시나리오 1, 2, 3 설정 (부대비용 풀 및 금융이자 체크)
 * - Step 3: 판매가 시나리오 1, 2, 3 설정 (판매단가 및 마진율 역산)
 * - Step 4: 매입 × 판매 시나리오 3×3 교차 분석표 (총 9가지 경우의 수)
 * - Step 5: 선택 조합 심층 분석 (마진 워터폴 차트 SVG & 손익분기점 BEP)
 * - Step 6: 종합 검토 의견 기안문 자동생성, 클립보드 복사, 엑셀, 보관함, 인쇄
 */

import { SalesMarginEngine } from './margin-engine.js';

(function () {
    'use strict';

    // ── 1. 상수 및 스토리지 키 ──
    const STORAGE_KEY_CURRENT = 'kng_sales_sim_current_v2';
    const STORAGE_KEY_ARCHIVE = 'kng_sales_sim_archive_v2';

    // ── 2. 기본 시드 데이터 (실무 권장 샘플) ──
    const DEFAULT_SEED_DATA = {
        docTitle: '2026 하반기 안전조끼 납품 원가·마진 타당성 검토',
        includeVat: false, // 부가세 10% 원가 산입 여부
        items: [
            { id: 'item_1', name: '형광 4포켓 메쉬 안전조끼', spec: 'Woven 형광노랑 L~3XL', qty: 2000, unitPrice: 4800 },
            { id: 'item_2', name: 'ABS 통기형 산업용 안전모', spec: '백색 4점식 턱끈', qty: 500, unitPrice: 6500 },
            { id: 'item_3', name: 'PU 코팅 정밀 안전장갑', spec: '그레이 13게이지', qty: 3000, unitPrice: 850 }
        ],
        // 부대비용 풀 (사용자가 항목을 추가하거나 시나리오별로 선택 가능)
        costsPool: [
            { id: 'cost_1', name: '물류센터 왕복 화물 운송료', category: 'logistics', amount: 350000, isFixed: false },
            { id: 'cost_2', name: '임시 보관 창고 임대료 (2개월)', category: 'rent', amount: 500000, isFixed: true },
            { id: 'cost_3', name: '회사 로고 라벨 부착 및 소포장', category: 'packaging', amount: 280000, isFixed: false },
            { id: 'cost_4', name: '전자계약 및 지급보증보험 수수료', category: 'fee', amount: 150000, isFixed: false }
        ],
        // 금융이자 기본 설정
        financing: {
            periodDays: 60,
            annualRatePct: 5.0
        },
        // Step 2: 매입 시나리오 1, 2, 3
        costScenarios: [
            {
                id: 'c1',
                name: '시나리오 1: 최소 매입원가',
                desc: '기본 물품대 + 필수 운송비만 반영',
                includedCostIds: ['cost_1'],
                includeFinancing: false
            },
            {
                id: 'c2',
                name: '시나리오 2: 표준 실무원가',
                desc: '물품대 + 운송비 + 라벨포장비 + 금융이자',
                includedCostIds: ['cost_1', 'cost_3'],
                includeFinancing: true
            },
            {
                id: 'c3',
                name: '시나리오 3: 풀부담 보수원가',
                desc: '전체 부대비용(창고임대료 포함) + 금융이자 반영',
                includedCostIds: ['cost_1', 'cost_2', 'cost_3', 'cost_4'],
                includeFinancing: true
            }
        ],
        // Step 3: 판매가 시나리오 1, 2, 3
        salesScenarios: [
            { id: 's1', name: '시나리오 A: 도매 최저가', targetPrice: 5500, memo: '대리점/도매 납품가' },
            { id: 's2', name: '시나리오 B: 본사 표준목표가', targetPrice: 6500, memo: '건설사 직접 납품가' },
            { id: 's3', name: '시나리오 C: 권장 소비자가', targetPrice: 7800, memo: '온라인 소매/특판가' }
        ],
        // 현재 선택된 셀 인덱스 (기본: 매입 2 × 판매 B -> [1, 1])
        selectedCrossIndex: {
            costIdx: 1,
            salesIdx: 1
        },
        remarks: ''
    };

    // ── 3. 상태 관리 (State) ──
    const state = {
        data: JSON.parse(JSON.stringify(DEFAULT_SEED_DATA)),
        docId: null,
        archive: [],
        calculated: null // 최신 계산 결과 캐시
    };

    // ── 4. DOM 요소 캐싱 ──
    const els = {};

    function initElements() {
        // 상단 툴바
        els.inputDocTitle = document.getElementById('inputDocTitle');
        els.btnLoadSample = document.getElementById('btnLoadSample');
        els.btnNewDoc = document.getElementById('btnNewDoc');
        els.btnSaveDoc = document.getElementById('btnSaveDoc');
        els.btnOpenSavedModal = document.getElementById('btnOpenSavedModal');
        els.btnCopyReport = document.getElementById('btnCopyReport');
        els.btnExportCsv = document.getElementById('btnExportCsv');
        els.btnPrint = document.getElementById('btnPrint');

        // Step 1: 물품대금
        els.chkIncludeVat = document.getElementById('chkIncludeVat');
        els.btnAddGoodsRow = document.getElementById('btnAddGoodsRow');
        els.tbodyGoods = document.getElementById('tbodyGoods');
        els.sumGoodsQty = document.getElementById('sumGoodsQty');
        els.avgGoodsPrice = document.getElementById('avgGoodsPrice');
        els.sumGoodsSupply = document.getElementById('sumGoodsSupply');
        els.sumGoodsVat = document.getElementById('sumGoodsVat');

        // Step 2: 매입 시나리오
        els.inputPeriodDays = document.getElementById('inputPeriodDays');
        els.inputAnnualRate = document.getElementById('inputAnnualRate');
        els.btnAddCostItem = document.getElementById('btnAddCostItem');
        els.costScenariosContainer = document.getElementById('costScenariosContainer');

        // Step 3: 판매가 시나리오
        els.salesScenariosContainer = document.getElementById('salesScenariosContainer');

        // Step 4: 3×3 교차 분석 매트릭스
        els.tableCrossMatrix = document.getElementById('tableCrossMatrix');
        els.trMatrixHeader = document.getElementById('trMatrixHeader');
        els.tbodyCrossMatrix = document.getElementById('tbodyCrossMatrix');

        // Step 5: 선택 조합 심층 분석 (워터폴 & BEP)
        els.dispSelectedComboTitle = document.getElementById('dispSelectedComboTitle');
        els.waterfallSvgContainer = document.getElementById('waterfallSvgContainer');
        els.dispUnitContribution = document.getElementById('dispUnitContribution');
        els.dispBepUnits = document.getElementById('dispBepUnits');
        els.dispBepRevenue = document.getElementById('dispBepRevenue');
        els.dispContributionRate = document.getElementById('dispContributionRate');

        // Step 6: 종합 검토의견 기안문
        els.btnAutoRemarks = document.getElementById('btnAutoRemarks');
        els.textRemarks = document.getElementById('textRemarks');

        // 인쇄 헤더
        els.printProjectTitle = document.getElementById('printProjectTitle');
        els.printDate = document.getElementById('printDate');

        // 보관함 모달
        els.savedModalOverlay = document.getElementById('savedModalOverlay');
        els.btnCloseSavedModal = document.getElementById('btnCloseSavedModal');
        els.tbodySavedDocs = document.getElementById('tbodySavedDocs');
    }

    // ── 5. 유틸리티 함수 ──
    const fmt = {
        num: n => (Number(n) || 0).toLocaleString('ko-KR'),
        won: n => `${(Number(n) || 0).toLocaleString('ko-KR')}원`,
        pct: (n, d = 1) => `${(Number(n) || 0).toFixed(d)}%`,
        uid: (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
    };

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = 'erp-toast';
        toast.style.position = 'fixed';
        toast.style.bottom = '24px';
        toast.style.right = '24px';
        toast.style.zIndex = '99999';
        toast.style.padding = '10px 16px';
        toast.style.borderRadius = '4px';
        toast.style.fontSize = '12px';
        toast.style.fontWeight = '600';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        toast.style.color = '#ffffff';
        toast.style.backgroundColor = type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#1e293b';
        toast.innerText = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    // ── 6. 데이터 계산 및 렌더링 파이프라인 ──
    function recalculateAll() {
        // 1. 물품대 산출
        const goodsResult = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.includeVat);

        // 금융이자 파라미터 동기화
        const periodDays = Math.max(0, Number(state.data.financing.periodDays) || 0);
        const annualRatePct = Math.max(0, Number(state.data.financing.annualRatePct) || 0);

        const preparedCostScenarios = state.data.costScenarios.map(sc => ({
            ...sc,
            periodDays,
            annualRatePct
        }));

        // 2. 3×3 교차 분석 매트릭스 계산
        const matrixResult = SalesMarginEngine.calculateCrossMatrix(
            goodsResult,
            state.data.costsPool,
            preparedCostScenarios,
            state.data.salesScenarios
        );

        // 캐시 저장
        state.calculated = {
            goods: goodsResult,
            matrix: matrixResult
        };

        // 3. UI 렌더링
        renderGoodsTable(goodsResult);
        renderCostScenarios(goodsResult, matrixResult.evaluatedCosts);
        renderSalesScenarios(matrixResult.evaluatedCosts, state.data.salesScenarios);
        renderCrossMatrix(matrixResult);
        renderSelectedComboDetail();
        updatePrintMeta();
    }

    // ── Step 1 렌더링: 물품 대금 ──
    function renderGoodsTable(goods) {
        if (!els.tbodyGoods) return;
        els.tbodyGoods.innerHTML = '';

        const showVat = state.data.includeVat;

        // VAT 헤더/푸터 열 토글
        document.querySelectorAll('.col-vat').forEach(el => {
            el.style.display = showVat ? '' : 'none';
        });

        if (els.chkIncludeVat) {
            els.chkIncludeVat.checked = showVat;
        }

        goods.items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <input type="text" class="erp-input item-name" data-idx="${index}" value="${item.name || ''}" placeholder="품목명">
                </td>
                <td>
                    <input type="text" class="erp-input item-spec" data-idx="${index}" value="${item.spec || ''}" placeholder="규격/사양">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-qty" data-idx="${index}" value="${item.qty || 0}" min="0">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-price" data-idx="${index}" value="${item.unitPrice || 0}" min="0" step="50">
                </td>
                <td class="text-right" style="font-weight: 700; color: #1e293b;">
                    ${fmt.num(item.supplyPrice)}
                </td>
                <td class="col-vat text-right" style="${showVat ? '' : 'display: none;'}; color: #64748b;">
                    ${fmt.num(item.vat)}
                </td>
                <td class="text-center">
                    <button type="button" class="btn-erp btn-sm btn-remove-item" data-idx="${index}" title="삭제" style="padding: 2px 6px; color: #ef4444;">
                        <i class="bx bx-trash"></i>
                    </button>
                </td>
            `;
            els.tbodyGoods.appendChild(tr);
        });

        // 푸터 합계
        if (els.sumGoodsQty) els.sumGoodsQty.innerText = `${fmt.num(goods.totalQty)}개`;
        if (els.avgGoodsPrice) els.avgGoodsPrice.innerText = fmt.won(goods.avgUnitGoodsPrice);
        if (els.sumGoodsSupply) els.sumGoodsSupply.innerText = fmt.won(goods.totalSupplyPrice);
        if (els.sumGoodsVat) els.sumGoodsVat.innerText = fmt.won(goods.totalVat);
    }

    // ── Step 2 렌더링: 매입 원가 시나리오 1, 2, 3 ──
    function renderCostScenarios(goods, evaluatedCosts) {
        if (!els.costScenariosContainer) return;
        els.costScenariosContainer.innerHTML = '';

        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const periodDays = Number(state.data.financing.periodDays) || 60;
        const annualRate = Number(state.data.financing.annualRatePct) || 5.0;

        evaluatedCosts.forEach((sc, scIdx) => {
            const rawSc = state.data.costScenarios[scIdx];
            const includedSet = new Set(rawSc.includedCostIds || []);

            // 카드 엘리먼트 생성
            const card = document.createElement('div');
            card.className = `sc-card ${scIdx === state.data.selectedCrossIndex.costIdx ? 'active' : ''}`;
            card.dataset.scIdx = scIdx;

            // 부대비용 체크박스 리스트 생성
            const costCheckboxesHtml = state.data.costsPool.map(cost => {
                const isChecked = includedSet.has(cost.id);
                const unitAmt = Math.round(cost.amount / totalQty);
                return `
                    <label class="sc-cost-checkbox" title="${cost.isFixed ? '고정비' : '변동비'}">
                        <input type="checkbox" class="chk-cost-toggle" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" ${isChecked ? 'checked' : ''}>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${cost.name} ${cost.isFixed ? '<small style="color:#d97706;">(고정)</small>' : ''}
                        </span>
                        <strong style="color: #475569; font-size: 11px;">+${fmt.won(unitAmt)}</strong>
                    </label>
                `;
            }).join('');

            // 금융이자 예상 개당 금액
            const estCapitalBase = goods.effectiveBase + sc.totalOverhead;
            const estFinInterest = Math.round(estCapitalBase * (annualRate / 100) * (periodDays / 365));
            const estUnitInterest = Math.round(estFinInterest / totalQty);

            card.innerHTML = `
                <div class="sc-card-header">
                    <input type="text" class="erp-input sc-name-input" data-sc-idx="${scIdx}" value="${rawSc.name}" style="font-weight: 700; width: 100%;">
                    <div style="font-size: 11px; color: var(--erp-text-muted); margin-top: 3px;">
                        ${rawSc.desc || ''}
                    </div>
                </div>

                <div class="sc-card-body">
                    <!-- 기본 물품대 -->
                    <div class="sc-price-row">
                        <span>기본 물품대:</span>
                        <strong>${fmt.won(goods.avgUnitGoodsPrice)}/개</strong>
                    </div>

                    <!-- 부대비용 항목 체크박스 영역 -->
                    <div style="font-size: 11px; font-weight: 700; color: #475569; margin: 8px 0 4px 0;">
                        반영 부대비용 선택 (${includedSet.size}/${state.data.costsPool.length}개):
                    </div>
                    <div class="sc-cost-list" style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; border: 1px solid #f1f5f9; padding: 4px; border-radius: 3px; background: #fafafa;">
                        ${costCheckboxesHtml}
                    </div>

                    <!-- 금융비용 반영 여부 -->
                    <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #e2e8f0;">
                        <label class="sc-cost-checkbox" style="color: #6b21a8; font-weight: 700; background: var(--erp-purple-bg); border-color: #ddd6fe;">
                            <input type="checkbox" class="chk-financing-toggle" data-sc-idx="${scIdx}" ${rawSc.includeFinancing ? 'checked' : ''}>
                            <span>금융이자 반영 (${periodDays}일 · ${annualRate}%)</span>
                            <strong>+${fmt.won(estUnitInterest)}</strong>
                        </label>
                    </div>

                    <!-- 최종 원가 합계 박스 -->
                    <div class="sc-total-box" style="margin-top: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; text-align: right;">
                        <div style="font-size: 10.5px; color: #64748b;">이 시나리오의 총 소요 매입원가</div>
                        <div style="font-size: 16px; font-weight: 800; color: #1e293b;">
                            ${fmt.won(sc.unitCost)} <span style="font-size: 11px; font-weight: 500; color: #64748b;">/개</span>
                        </div>
                        <div style="font-size: 10.5px; color: #94a3b8;">(총 ${fmt.won(sc.totalCost)})</div>
                    </div>
                </div>
            `;

            els.costScenariosContainer.appendChild(card);
        });
    }

    // ── Step 3 렌더링: 판매가 시나리오 1, 2, 3 ──
    function renderSalesScenarios(evaluatedCosts, salesScenarios) {
        if (!els.salesScenariosContainer) return;
        els.salesScenariosContainer.innerHTML = '';

        // 기준 원가 (매입 시나리오 2 [표준실무원가] 우선, 없으면 0번)
        const benchmarkUnitCost = (evaluatedCosts[1] || evaluatedCosts[0] || {}).unitCost || 0;

        salesScenarios.forEach((sSc, sIdx) => {
            const card = document.createElement('div');
            card.className = `sales-card ${sIdx === state.data.selectedCrossIndex.salesIdx ? 'active' : ''}`;
            card.dataset.sIdx = sIdx;

            const marginAmt = sSc.targetPrice - benchmarkUnitCost;
            const marginRate = sSc.targetPrice > 0 ? ((marginAmt / sSc.targetPrice) * 100).toFixed(1) : '0.0';

            card.innerHTML = `
                <div class="sales-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <input type="text" class="erp-input sales-name-input" data-s-idx="${sIdx}" value="${sSc.name}" style="font-weight: 700; width: 65%;">
                    <span style="font-size: 10.5px; color: #64748b;">${sSc.memo || ''}</span>
                </div>

                <div class="sales-card-body">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                        <span style="font-size: 11px; font-weight: 700; color: #475569;">목표 판매단가:</span>
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                            <input type="number" class="erp-input text-right sales-price-input" data-s-idx="${sIdx}" value="${sSc.targetPrice}" step="100" min="0" style="width: 120px; font-weight: 800; font-size: 14px; color: var(--erp-primary);">
                            <span style="font-size: 12px; font-weight: 700;">원</span>
                        </div>
                    </div>

                    <!-- 표준원가(시나리오2) 대비 마진율 퀵 역산 버튼 -->
                    <div style="font-size: 10.5px; color: #64748b; margin-bottom: 4px;">목표 마진율 기준 판매가 역산:</div>
                    <div style="display: flex; gap: 4px; margin-bottom: 8px;">
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="15" title="마진 15% 역산">15%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="20" title="마진 20% 역산">20%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="25" title="마진 25% 역산">25%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="30" title="마진 30% 역산">30%</button>
                    </div>

                    <div style="font-size: 11px; padding: 4px 8px; background: #f8fafc; border-radius: 3px; display: flex; justify-content: space-between;">
                        <span style="color: #64748b;">표준원가 대비 마진:</span>
                        <strong style="color: ${Number(marginRate) >= 18 ? '#047857' : Number(marginRate) >= 10 ? '#d97706' : '#dc2626'};">
                            ${fmt.won(marginAmt)} (${marginRate}%)
                        </strong>
                    </div>
                </div>
            `;

            els.salesScenariosContainer.appendChild(card);
        });
    }

    // ── Step 4 렌더링: [핵심] 매입 × 판매 3×3 교차 매트릭스 ──
    function renderCrossMatrix(matrixResult) {
        if (!els.trMatrixHeader || !els.tbodyCrossMatrix) return;

        const evaluatedSales = matrixResult.evaluatedSales;
        const matrix = matrixResult.matrix;

        // 1. 헤더 행 렌더링
        let headerHtml = `
            <th style="width: 22%; background: #0f172a; color: #e2e8f0; font-size: 11px;">
                매입 시나리오 (원가) ＼ 판매 시나리오 (판가)
            </th>
        `;

        evaluatedSales.forEach((sSc, sIdx) => {
            const isSelectedCol = sIdx === state.data.selectedCrossIndex.salesIdx;
            headerHtml += `
                <th style="width: 26%; background: ${isSelectedCol ? '#1e3a8a' : '#1e293b'}; color: #ffffff; text-align: center;">
                    <div style="font-size: 12px; font-weight: 800;">${sSc.name}</div>
                    <div style="font-size: 13px; font-weight: 700; color: #38bdf8;">${fmt.won(sSc.targetPrice)}</div>
                </th>
            `;
        });
        els.trMatrixHeader.innerHTML = headerHtml;

        // 2. 바디 3행 렌더링 (각 행은 매입 시나리오 1, 2, 3)
        let bodyHtml = '';

        matrix.forEach((row, costIdx) => {
            const cSc = row.costScenario;
            const isSelectedRow = costIdx === state.data.selectedCrossIndex.costIdx;

            bodyHtml += `<tr>`;

            // 좌측 헤더 (매입 시나리오 요약)
            bodyHtml += `
                <td style="background: ${isSelectedRow ? '#eff6ff' : '#f8fafc'}; border-right: 2px solid #cbd5e1;">
                    <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${cSc.name}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                        개당 원가: <strong style="font-size: 13px; color: #0f172a;">${fmt.won(cSc.unitCost)}</strong>
                    </div>
                    <div style="font-size: 10px; color: #94a3b8;">
                        (물품대 ${fmt.num(cSc.unitGoodsCost)} + 부대 ${fmt.num(cSc.unitOverhead + cSc.unitFinancing)})
                    </div>
                </td>
            `;

            // 3개의 셀 (각 판매 시나리오와의 조합)
            row.cells.forEach((cell, salesIdx) => {
                const isSelectedCell = (costIdx === state.data.selectedCrossIndex.costIdx && salesIdx === state.data.selectedCrossIndex.salesIdx);

                // 마진 상태별 스타일
                let badgeClass = 'badge-healthy';
                let badgeText = '안전 마진';
                let marginColor = '#047857';

                if (cell.isDanger) {
                    badgeClass = 'badge-danger';
                    badgeText = '마진 위험';
                    marginColor = '#dc2626';
                } else if (cell.isWarning) {
                    badgeClass = 'badge-warning';
                    badgeText = '적정 주의';
                    marginColor = '#d97706';
                }

                bodyHtml += `
                    <td class="matrix-cell ${isSelectedCell ? 'selected' : ''}" data-cost-idx="${costIdx}" data-sales-idx="${salesIdx}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span class="matrix-badge ${badgeClass}">${badgeText}</span>
                            <span style="font-size: 10px; color: #94a3b8;">조합 [${costIdx + 1} × ${String.fromCharCode(65 + salesIdx)}]</span>
                        </div>
                        <div class="matrix-cell-margin" style="color: ${marginColor};">
                            ${fmt.won(cell.marginAmount)} <span style="font-size: 13px; font-weight: 800;">(${cell.marginRate}%)</span>
                        </div>
                        <div class="matrix-cell-profit">
                            예상 총영업익: <strong>${fmt.won(cell.totalProfit)}</strong>
                        </div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">
                            BEP 최소수량: ${cell.bepUnits > 0 ? fmt.num(cell.bepUnits) + '개' : '0개 (고정비 없음)'}
                        </div>
                    </td>
                `;
            });

            bodyHtml += `</tr>`;
        });

        els.tbodyCrossMatrix.innerHTML = bodyHtml;
    }

    // ── Step 5 렌더링: 선택 조합 심층 분석 (워터폴 SVG & BEP) ──
    function renderSelectedComboDetail() {
        if (!state.calculated || !els.dispSelectedComboTitle) return;

        const { costIdx, salesIdx } = state.data.selectedCrossIndex;
        const cSc = state.calculated.matrix.evaluatedCosts[costIdx];
        const sSc = state.calculated.matrix.evaluatedSales[salesIdx];
        const cell = state.calculated.matrix.matrix[costIdx].cells[salesIdx];

        if (!cSc || !sSc || !cell) return;

        // 타이틀 표시
        els.dispSelectedComboTitle.innerText = `${cSc.name} (원가 ${fmt.won(cSc.unitCost)}) × ${sSc.name} (판가 ${fmt.won(sSc.targetPrice)})`;

        // 1. BEP 메트릭 렌더링
        const totalQty = cSc.totalQty || 1;
        const unitContribution = sSc.targetPrice - (cSc.unitGoodsCost + (cSc.categoryBreakdown.logistics / totalQty) + cSc.unitFinancing);
        const contributionRate = sSc.targetPrice > 0 ? ((unitContribution / sSc.targetPrice) * 100).toFixed(1) : 0;
        const bepRevenue = cell.bepUnits * sSc.targetPrice;

        if (els.dispUnitContribution) els.dispUnitContribution.innerText = fmt.won(unitContribution);
        if (els.dispBepUnits) {
            els.dispBepUnits.innerText = cell.bepUnits > 0 ? `${fmt.num(cell.bepUnits)}개 이상` : '0개 (즉시 흑자)';
        }
        if (els.dispBepRevenue) els.dispBepRevenue.innerText = fmt.won(bepRevenue);
        if (els.dispContributionRate) els.dispContributionRate.innerText = `${contributionRate}%`;

        // 2. 워터폴 브릿지 SVG 렌더링
        renderWaterfallSvg(cSc, sSc.targetPrice);
    }

    // ── 워터폴 브릿지 SVG 차트 렌더링 ──
    function renderWaterfallSvg(cSc, targetPrice) {
        if (!els.waterfallSvgContainer) return;
        const steps = SalesMarginEngine.generateWaterfallData(cSc, targetPrice);

        const width = els.waterfallSvgContainer.clientWidth || 600;
        const height = 180;
        const margin = { top: 20, right: 30, bottom: 40, left: 60 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        const maxVal = Math.max(targetPrice * 1.08, 1000);
        const barWidth = Math.min(48, Math.floor(plotWidth / (steps.length * 1.4)));
        const colGap = Math.floor(plotWidth / steps.length);

        let runningVal = 0;
        let svgContent = `
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: inherit;">
                <defs>
                    <linearGradient id="wfBlueGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#3b82f6" />
                        <stop offset="100%" stop-color="#1d4ed8" />
                    </linearGradient>
                    <linearGradient id="wfGreenGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#10b981" />
                        <stop offset="100%" stop-color="#047857" />
                    </linearGradient>
                </defs>
                <!-- Baseline -->
                <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#cbd5e1" stroke-width="1.5" />
        `;

        steps.forEach((st, idx) => {
            const x = margin.left + (idx * colGap) + Math.floor((colGap - barWidth) / 2);
            let barY = 0;
            let barH = 0;

            if (st.type === 'start') {
                runningVal = st.amount;
                barH = Math.max(4, Math.round((runningVal / maxVal) * plotHeight));
                barY = margin.top + plotHeight - barH;
            } else if (st.type === 'drop') {
                const dropAmt = st.amount;
                const prevVal = runningVal;
                runningVal -= dropAmt;
                const topVal = Math.max(prevVal, runningVal);
                barY = margin.top + plotHeight - Math.round((topVal / maxVal) * plotHeight);
                barH = Math.max(3, Math.round((dropAmt / maxVal) * plotHeight));
            } else if (st.type === 'end') {
                const finalAmt = Math.max(0, st.amount);
                barH = Math.max(4, Math.round((finalAmt / maxVal) * plotHeight));
                barY = margin.top + plotHeight - barH;
            }

            const fill = st.type === 'start' ? 'url(#wfBlueGrad)' : st.type === 'end' ? 'url(#wfGreenGrad)' : st.color;

            svgContent += `
                <!-- Bar -->
                <rect x="${x}" y="${barY}" width="${barWidth}" height="${barH}" rx="3" fill="${fill}" />
                <!-- Value Label -->
                <text x="${x + barWidth / 2}" y="${barY - 5}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#1e293b">
                    ${fmt.num(st.amount)}
                </text>
                <!-- Step Label -->
                <text x="${x + barWidth / 2}" y="${margin.top + plotHeight + 16}" text-anchor="middle" font-size="10" fill="#64748b" font-weight="600">
                    ${st.label}
                </text>
            `;
        });

        svgContent += `</svg>`;
        els.waterfallSvgContainer.innerHTML = svgContent;
    }

    // ── 인쇄 메타데이터 동기화 ──
    function updatePrintMeta() {
        if (els.printProjectTitle) els.printProjectTitle.innerText = state.data.docTitle || '영업 수주 원가·마진 시뮬레이션';
        if (els.printDate) els.printDate.innerText = new Date().toISOString().split('T')[0];
    }

    // ── Step 6: 종합 기안문 자동 생성 ──
    function generateRemarksText() {
        if (!state.calculated) return '';

        const title = state.data.docTitle || '영업 수주 원가·마진 시뮬레이션';
        const goods = state.calculated.goods;
        const matrix = state.calculated.matrix;
        const { costIdx, salesIdx } = state.data.selectedCrossIndex;
        const selectedCell = matrix.matrix[costIdx].cells[salesIdx];

        // 9가지 경우의 수 중 최고/최저 마진 찾기
        let maxMarginCell = null;
        let minMarginCell = null;

        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                if (!maxMarginCell || c.marginRate > maxMarginCell.marginRate) maxMarginCell = c;
                if (!minMarginCell || c.marginRate < minMarginCell.marginRate) minMarginCell = c;
            });
        });

        const text = `[기안문] ${title}

1. 검토 목적 및 개요
 - 본 검토는 ${title} 건에 대하여 매입 원가 3대 시나리오와 판매가 3대 시나리오를 교차 분석(총 9가지 경우의 수)하여, 적정 수주 가능 단가 및 한계 손익을 사전 확정하고자 함.

2. 기본 매입 및 물품대 현황
 - 총 매입수량: ${fmt.num(goods.totalQty)}개
 - 기본 매입 공급가액: ${fmt.won(goods.totalSupplyPrice)} (개당 평균 ${fmt.won(goods.avgUnitGoodsPrice)})
 - 부가세(VAT 10%) 원가 산입 여부: ${state.data.includeVat ? '포함 산정' : '미포함(공급가액 기준)'}
 - 운전자본 금융이자율: 연 ${state.data.financing.annualRatePct}% (회수기간 ${state.data.financing.periodDays}일 기준)

3. 3×3 시나리오 교차 분석 (9가지 경우의 수 요약)
 - [최대 이익 시나리오] ${maxMarginCell.costScenarioName} × ${maxMarginCell.salesScenarioName}
   : 판매단가 ${fmt.won(maxMarginCell.targetPrice)} / 개당 마진 ${fmt.won(maxMarginCell.marginAmount)} (마진율 ${maxMarginCell.marginRate}%)
   : 총 예상 영업이익 ${fmt.won(maxMarginCell.totalProfit)}
 - [최저/보수 시나리오] ${minMarginCell.costScenarioName} × ${minMarginCell.salesScenarioName}
   : 판매단가 ${fmt.won(minMarginCell.targetPrice)} / 개당 마진 ${fmt.won(minMarginCell.marginAmount)} (마진율 ${minMarginCell.marginRate}%)
   : 총 예상 영업이익 ${fmt.won(minMarginCell.totalProfit)}

4. [선택/권장안] ${selectedCell.costScenarioName} × ${selectedCell.salesScenarioName}
 - 목표 판매단가: ${fmt.won(selectedCell.targetPrice)}
 - 개당 총 소요원가: ${fmt.won(selectedCell.unitCost)}
 - 개당 영업마진: ${fmt.won(selectedCell.marginAmount)} (마진율 ${selectedCell.marginRate}%)
 - 총 예상 수주 영업이익: ${fmt.won(selectedCell.totalProfit)}
 - 손익분기점(BEP): ${selectedCell.bepUnits > 0 ? fmt.num(selectedCell.bepUnits) + '개 이상 수주 시 흑자 달성' : '즉시 흑자 구간'}

5. 종합 검토 의견
 - 본 건은 시나리오 B(표준목표가) 이상으로 수주를 추진할 것을 권고하며, 최소 매입원가 시나리오 1 방어 시 20% 이상의 안정적 영업마진 확보가 가능함.`;

        return text;
    }

    // ── 7. 이벤트 바인딩 ──
    function bindEvents() {
        // 검토 건명 변경
        if (els.inputDocTitle) {
            els.inputDocTitle.addEventListener('input', e => {
                state.data.docTitle = e.target.value;
                updatePrintMeta();
            });
        }

        // 부가세 포함/미포함 토글
        if (els.chkIncludeVat) {
            els.chkIncludeVat.addEventListener('change', e => {
                state.data.includeVat = e.target.checked;
                recalculateAll();
                showToast(`부가세 원가 산입: ${state.data.includeVat ? '포함(10%)' : '미포함(공급가액)'}`);
            });
        }

        // 금융이자 일수 및 연이율 변경
        if (els.inputPeriodDays) {
            els.inputPeriodDays.addEventListener('input', e => {
                state.data.financing.periodDays = Math.max(0, Number(e.target.value) || 0);
                recalculateAll();
            });
        }
        if (els.inputAnnualRate) {
            els.inputAnnualRate.addEventListener('input', e => {
                state.data.financing.annualRatePct = Math.max(0, Number(e.target.value) || 0);
                recalculateAll();
            });
        }

        // 매입 품목 추가
        if (els.btnAddGoodsRow) {
            els.btnAddGoodsRow.addEventListener('click', () => {
                state.data.items.push({
                    id: fmt.uid('item'),
                    name: '신규 품목',
                    spec: '표준 규격',
                    qty: 1000,
                    unitPrice: 2000
                });
                recalculateAll();
            });
        }

        // 매입 품목 테이블 인풋 및 삭제 위임
        if (els.tbodyGoods) {
            els.tbodyGoods.addEventListener('input', e => {
                const target = e.target;
                const idx = Number(target.dataset.idx);
                if (isNaN(idx) || !state.data.items[idx]) return;

                if (target.classList.contains('item-name')) {
                    state.data.items[idx].name = target.value;
                } else if (target.classList.contains('item-spec')) {
                    state.data.items[idx].spec = target.value;
                } else if (target.classList.contains('item-qty')) {
                    state.data.items[idx].qty = Math.max(0, Number(target.value) || 0);
                    recalculateAll();
                } else if (target.classList.contains('item-price')) {
                    state.data.items[idx].unitPrice = Math.max(0, Number(target.value) || 0);
                    recalculateAll();
                }
            });

            els.tbodyGoods.addEventListener('click', e => {
                const btn = e.target.closest('.btn-remove-item');
                if (!btn) return;
                const idx = Number(btn.dataset.idx);
                if (state.data.items.length <= 1) {
                    showToast('최소 1개 이상의 품목이 필요합니다.', 'warning');
                    return;
                }
                state.data.items.splice(idx, 1);
                recalculateAll();
            });
        }

        // 부대비용 항목 신규 추가 버튼
        if (els.btnAddCostItem) {
            els.btnAddCostItem.addEventListener('click', () => {
                const name = prompt('새로 추가할 부대비용 항목명을 입력하세요 (예: 팔레트 포장비, 인증검사비):', '추가 부대비용');
                if (!name || !name.trim()) return;
                const amtStr = prompt(`'${name}'의 총 소요 예상 금액을 입력하세요 (원):`, '200000');
                const amount = Math.max(0, Number(amtStr) || 0);

                const newCostId = fmt.uid('cost');
                state.data.costsPool.push({
                    id: newCostId,
                    name: name.trim(),
                    category: 'etc',
                    amount: amount,
                    isFixed: false
                });

                // 시나리오 3(풀부담)에 자동 체크 반영
                state.data.costScenarios[2].includedCostIds.push(newCostId);

                recalculateAll();
                showToast(`'${name.trim()}' 부대비용이 추가되었습니다.`, 'success');
            });
        }

        // Step 2: 매입 시나리오 카드 이벤트 (비용 체크박스, 금융이자 토글, 명칭 변경)
        if (els.costScenariosContainer) {
            els.costScenariosContainer.addEventListener('change', e => {
                const target = e.target;
                const scIdx = Number(target.dataset.scIdx);
                if (isNaN(scIdx) || !state.data.costScenarios[scIdx]) return;

                const sc = state.data.costScenarios[scIdx];

                if (target.classList.contains('chk-cost-toggle')) {
                    const costId = target.dataset.costId;
                    const set = new Set(sc.includedCostIds || []);
                    if (target.checked) set.add(costId);
                    else set.delete(costId);
                    sc.includedCostIds = Array.from(set);
                    recalculateAll();
                } else if (target.classList.contains('chk-financing-toggle')) {
                    sc.includeFinancing = target.checked;
                    recalculateAll();
                }
            });

            els.costScenariosContainer.addEventListener('input', e => {
                const target = e.target;
                const scIdx = Number(target.dataset.scIdx);
                if (target.classList.contains('sc-name-input') && state.data.costScenarios[scIdx]) {
                    state.data.costScenarios[scIdx].name = target.value;
                    renderCrossMatrix(state.calculated.matrix);
                    renderSelectedComboDetail();
                }
            });
        }

        // Step 3: 판매가 시나리오 카드 이벤트 (판가 입력, 명칭 변경, 마진역산 버튼)
        if (els.salesScenariosContainer) {
            els.salesScenariosContainer.addEventListener('input', e => {
                const target = e.target;
                const sIdx = Number(target.dataset.sIdx);
                if (isNaN(sIdx) || !state.data.salesScenarios[sIdx]) return;

                if (target.classList.contains('sales-price-input')) {
                    state.data.salesScenarios[sIdx].targetPrice = Math.max(0, Number(target.value) || 0);
                    recalculateAll();
                } else if (target.classList.contains('sales-name-input')) {
                    state.data.salesScenarios[sIdx].name = target.value;
                    renderCrossMatrix(state.calculated.matrix);
                    renderSelectedComboDetail();
                }
            });

            els.salesScenariosContainer.addEventListener('click', e => {
                const btn = e.target.closest('.btn-reverse-calc');
                if (!btn) return;
                const sIdx = Number(btn.dataset.sIdx);
                const targetMargin = Number(btn.dataset.margin) || 20;

                // 기준 원가: 매입 시나리오 2 [표준실무원가]
                const benchmarkUnitCost = (state.calculated.matrix.evaluatedCosts[1] || state.calculated.matrix.evaluatedCosts[0] || {}).unitCost || 0;
                const reversePrice = SalesMarginEngine.calculateReversePrice(benchmarkUnitCost, targetMargin);

                state.data.salesScenarios[sIdx].targetPrice = reversePrice;
                recalculateAll();
                showToast(`시나리오 ${String.fromCharCode(65 + sIdx)} 목표 판가가 마진 ${targetMargin}% 기준(${fmt.won(reversePrice)})으로 역산되었습니다.`);
            });
        }

        // Step 4: 매트릭스 셀 클릭 인터랙션
        if (els.tbodyCrossMatrix) {
            els.tbodyCrossMatrix.addEventListener('click', e => {
                const cell = e.target.closest('.matrix-cell');
                if (!cell) return;
                const costIdx = Number(cell.dataset.costIdx);
                const salesIdx = Number(cell.dataset.salesIdx);
                if (isNaN(costIdx) || isNaN(salesIdx)) return;

                state.data.selectedCrossIndex = { costIdx, salesIdx };
                renderCostScenarios(state.calculated.goods, state.calculated.matrix.evaluatedCosts);
                renderSalesScenarios(state.calculated.matrix.evaluatedCosts, state.data.salesScenarios);
                renderCrossMatrix(state.calculated.matrix);
                renderSelectedComboDetail();

                // 모바일/작은 화면에서 스크롤 부드럽게
                showToast(`매입 시나리오 ${costIdx + 1} × 판매 시나리오 ${String.fromCharCode(65 + salesIdx)} 조합이 선택되었습니다.`);
            });
        }

        // Step 6: 종합의견 자동작성 버튼
        if (els.btnAutoRemarks) {
            els.btnAutoRemarks.addEventListener('click', () => {
                const text = generateRemarksText();
                if (els.textRemarks) {
                    els.textRemarks.value = text;
                    state.data.remarks = text;
                }
                showToast('9가지 시나리오 분석 결과 종합 기안문이 작성되었습니다.', 'success');
            });
        }

        // 상단 액션 툴바: 기안문 복사
        if (els.btnCopyReport) {
            els.btnCopyReport.addEventListener('click', () => {
                const text = (els.textRemarks && els.textRemarks.value.trim()) ? els.textRemarks.value : generateRemarksText();
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(() => {
                        showToast('기안문 전문이 클립보드에 복사되었습니다.', 'success');
                    }).catch(() => {
                        fallbackCopy(text);
                    });
                } else {
                    fallbackCopy(text);
                }
            });
        }

        // 상단 액션 툴바: CSV 엑셀 다운로드
        if (els.btnExportCsv) {
            els.btnExportCsv.addEventListener('click', exportToCsv);
        }

        // 상단 액션 툴바: 인쇄 / PDF
        if (els.btnPrint) {
            els.btnPrint.addEventListener('click', () => {
                updatePrintMeta();
                window.print();
            });
        }

        // 상단 액션 툴바: 새로 작성
        if (els.btnNewDoc) {
            els.btnNewDoc.addEventListener('click', () => {
                if (!confirm('새 문서를 작성하시겠습니까? 현재 작성 중인 내용은 초기화됩니다.')) return;
                state.data = {
                    docTitle: '신규 원가·마진 시뮬레이션',
                    includeVat: false,
                    items: [
                        { id: fmt.uid('item'), name: '', spec: '', qty: 1000, unitPrice: 0 }
                    ],
                    costsPool: [
                        { id: 'cost_1', name: '운송비', category: 'logistics', amount: 0, isFixed: false },
                        { id: 'cost_2', name: '임대료', category: 'rent', amount: 0, isFixed: true }
                    ],
                    financing: { periodDays: 60, annualRatePct: 5.0 },
                    costScenarios: [
                        { id: 'c1', name: '시나리오 1: 최소 매입원가', desc: '기본 물품대', includedCostIds: [], includeFinancing: false },
                        { id: 'c2', name: '시나리오 2: 표준 실무원가', desc: '물품대 + 운송비 + 금융이자', includedCostIds: ['cost_1'], includeFinancing: true },
                        { id: 'c3', name: '시나리오 3: 풀부담 보수원가', desc: '전체 비용 반영', includedCostIds: ['cost_1', 'cost_2'], includeFinancing: true }
                    ],
                    salesScenarios: [
                        { id: 's1', name: '시나리오 A: 도매 최저가', targetPrice: 0, memo: '' },
                        { id: 's2', name: '시나리오 B: 본사 표준목표가', targetPrice: 0, memo: '' },
                        { id: 's3', name: '시나리오 C: 권장 소비자가', targetPrice: 0, memo: '' }
                    ],
                    selectedCrossIndex: { costIdx: 1, salesIdx: 1 },
                    remarks: ''
                };
                if (els.inputDocTitle) els.inputDocTitle.value = state.data.docTitle;
                recalculateAll();
                showToast('새 문서 양식이 준비되었습니다.');
            });
        }

        // 상단 액션 툴바: 샘플 복원
        if (els.btnLoadSample) {
            els.btnLoadSample.addEventListener('click', () => {
                if (!confirm('실무 샘플 데이터를 다시 불러오시겠습니까?')) return;
                state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
                if (els.inputDocTitle) els.inputDocTitle.value = state.data.docTitle;
                recalculateAll();
                showToast('실무 샘플 데이터가 성공적으로 복원되었습니다.', 'success');
            });
        }

        // 상단 액션 툴바: 저장하기 (F8 또는 Ctrl+S)
        if (els.btnSaveDoc) {
            els.btnSaveDoc.addEventListener('click', saveCurrentDoc);
        }

        // 보관함 모달 열기/닫기
        if (els.btnOpenSavedModal) {
            els.btnOpenSavedModal.addEventListener('click', openArchiveModal);
        }
        if (els.btnCloseSavedModal) {
            els.btnCloseSavedModal.addEventListener('click', closeArchiveModal);
        }
        if (els.savedModalOverlay) {
            els.savedModalOverlay.addEventListener('click', e => {
                if (e.target === els.savedModalOverlay) closeArchiveModal();
            });
        }

        // 단축키 (F8 저장, Ctrl+S 저장)
        window.addEventListener('keydown', e => {
            if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key === 's')) {
                e.preventDefault();
                saveCurrentDoc();
            }
        });

        // 윈도우 리사이즈 시 워터폴 재렌더링
        window.addEventListener('resize', () => {
            if (state.calculated) {
                renderSelectedComboDetail();
            }
        });
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('기안문 전문이 클립보드에 복사되었습니다.', 'success');
    }

    // ── 8. 저장 및 보관함 기능 (LocalStorage) ──
    function saveCurrentDoc() {
        try {
            const archive = getArchive();
            const now = new Date();
            const saveItem = {
                id: state.docId || fmt.uid('doc'),
                title: state.data.docTitle || '무제 시뮬레이션',
                savedAt: now.toISOString(),
                savedAtFormatted: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
                data: JSON.parse(JSON.stringify(state.data))
            };

            const existingIdx = archive.findIndex(item => item.id === saveItem.id);
            if (existingIdx >= 0) {
                archive[existingIdx] = saveItem;
            } else {
                archive.unshift(saveItem);
            }

            state.docId = saveItem.id;
            localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(archive.slice(0, 30)));
            showToast(`'${saveItem.title}' 건이 보관함에 저장되었습니다.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('저장 중 오류가 발생했습니다.', 'warning');
        }
    }

    function getArchive() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_ARCHIVE);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function openArchiveModal() {
        const archive = getArchive();
        if (!els.tbodySavedDocs) return;
        els.tbodySavedDocs.innerHTML = '';

        if (archive.length === 0) {
            els.tbodySavedDocs.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center" style="padding: 24px; color: #94a3b8;">
                        저장된 시뮬레이션 문서가 없습니다. (상단 '저장하기' 버튼을 눌러 보관하세요)
                    </td>
                </tr>
            `;
        } else {
            archive.forEach(item => {
                const tr = document.createElement('tr');
                const avgPrice = item.data.items ? Math.round(item.data.items.reduce((s, it) => s + (it.qty * it.unitPrice), 0) / (item.data.items.reduce((s, it) => s + it.qty, 0) || 1)) : 0;

                tr.innerHTML = `
                    <td><strong>${item.title}</strong></td>
                    <td style="color: #64748b;">${item.savedAtFormatted}</td>
                    <td class="text-right">${fmt.won(avgPrice)}</td>
                    <td class="text-center">
                        <button type="button" class="btn-erp btn-sm btn-load-saved" data-id="${item.id}" style="padding: 2px 6px;">열기</button>
                        <button type="button" class="btn-erp btn-sm btn-delete-saved" data-id="${item.id}" style="padding: 2px 6px; color: #ef4444; margin-left: 4px;">삭제</button>
                    </td>
                `;
                els.tbodySavedDocs.appendChild(tr);
            });

            // 모달 내 버튼 위임
            els.tbodySavedDocs.querySelectorAll('.btn-load-saved').forEach(b => {
                b.addEventListener('click', () => {
                    const id = b.dataset.id;
                    const found = archive.find(a => a.id === id);
                    if (found) {
                        state.data = JSON.parse(JSON.stringify(found.data));
                        state.docId = found.id;
                        if (els.inputDocTitle) els.inputDocTitle.value = state.data.docTitle;
                        recalculateAll();
                        closeArchiveModal();
                        showToast(`'${found.title}' 문서를 불러왔습니다.`, 'success');
                    }
                });
            });

            els.tbodySavedDocs.querySelectorAll('.btn-delete-saved').forEach(b => {
                b.addEventListener('click', () => {
                    const id = b.dataset.id;
                    if (!confirm('이 저장 문서를 삭제하시겠습니까?')) return;
                    const newArchive = archive.filter(a => a.id !== id);
                    localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(newArchive));
                    openArchiveModal();
                    showToast('삭제되었습니다.');
                });
            });
        }

        if (els.savedModalOverlay) els.savedModalOverlay.classList.add('active');
    }

    function closeArchiveModal() {
        if (els.savedModalOverlay) els.savedModalOverlay.classList.remove('active');
    }

    // ── 9. CSV 엑셀 내보내기 ──
    function exportToCsv() {
        if (!state.calculated) return;
        const title = (state.data.docTitle || 'Sales_Simulator').replace(/[\s/\\:]+/g, '_');
        const matrix = state.calculated.matrix;
        const goods = state.calculated.goods;

        let csv = '\uFEFF'; // UTF-8 BOM
        csv += `[K&G 원가·마진 시뮬레이션 보고서 - 내부검토용]\r\n`;
        csv += `검토 건명,${state.data.docTitle || ''}\r\n`;
        csv += `검토 일자,${new Date().toISOString().split('T')[0]}\r\n\r\n`;

        // 1. 물품대 내역
        csv += `[1. 물품 대금 매입 내역]\r\n`;
        csv += `품목명,규격,수량,매입단가,공급가액,부가세\r\n`;
        goods.items.forEach(it => {
            csv += `"${it.name}","${it.spec}",${it.qty},${it.unitPrice},${it.supplyPrice},${it.vat}\r\n`;
        });
        csv += `합계,,${goods.totalQty},${goods.avgUnitGoodsPrice},${goods.totalSupplyPrice},${goods.totalVat}\r\n\r\n`;

        // 2. 3×3 매트릭스
        csv += `[2. 3×3 시나리오 교차 분석 매트릭스]\r\n`;
        csv += `매입 시나리오,개당 원가,판매 시나리오,목표 판매단가,개당 마진,마진율(%),총 예상 영업이익,BEP수량\r\n`;
        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                csv += `"${c.costScenarioName}",${c.unitCost},"${c.salesScenarioName}",${c.targetPrice},${c.marginAmount},${c.marginRate}%,${c.totalProfit},${c.bepUnits}\r\n`;
            });
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('엑셀(CSV) 파일이 다운로드되었습니다.', 'success');
    }

    // ── 10. 초기화 실행 ──
    document.addEventListener('DOMContentLoaded', () => {
        initElements();
        bindEvents();
        recalculateAll();
    });

})();
