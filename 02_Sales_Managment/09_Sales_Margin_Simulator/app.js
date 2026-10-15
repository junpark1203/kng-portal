/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이터 애플리케이션 컨트롤러
 * (Sales Cost & Margin Simulator Application Controller)
 * ══════════════════════════════════════════════════════════════
 */

import { SalesMarginEngine } from './margin-engine.js';

(function () {
    'use strict';

    // ── 1. 상수 및 스토리지 키 ──
    const STORAGE_KEY_CURRENT = 'kng_sales_simulator_current_v1';
    const STORAGE_KEY_ARCHIVE = 'kng_sales_simulator_archive_v1';

    // ── 2. 기본 시드 데이터 (실무 권장 샘플) ──
    const DEFAULT_SEED_DATA = {
        project: {
            title: '2026 하반기 안전조끼 및 보호구 정기 납품 건',
            customerName: '(주)일터루코리아',
            date: '2026-10-15',
            author: '주식회사 케앤지 영업본부'
        },
        vatMode: 'exclude', // 'exclude' (공급가액 전용) | 'include' (VAT 포함 표시)
        items: [
            { id: 'item_1', name: '형광 4포켓 메쉬 안전조끼', spec: 'Woven 형광노랑 L~3XL', qty: 2000, unitPrice: 4800 },
            { id: 'item_2', name: 'ABS 통기형 산업용 안전모', spec: '백색 4점식 턱끈', qty: 500, unitPrice: 6500 },
            { id: 'item_3', name: 'PU 코팅 정밀 안전장갑', spec: '그레이 13게이지', qty: 3000, unitPrice: 850 }
        ],
        financing: {
            isEnabled: true,
            periodDays: 60,
            annualRatePct: 5.0
        },
        costs: [
            { id: 'cost_1', name: '물류센터 왕복 화물 운송료', category: 'logistics', amount: 350000, isEnabled: true, isFixed: false },
            { id: 'cost_2', name: '임시 보관 창고료 (2개월분)', category: 'rent', amount: 500000, isEnabled: true, isFixed: true },
            { id: 'cost_3', name: '회사 로고 직조라벨 부착 및 소포장', category: 'packaging', amount: 280000, isEnabled: true, isFixed: false },
            { id: 'cost_4', name: '전자계약 및 지급보증보험 수수료', category: 'fee', amount: 150000, isEnabled: true, isFixed: false }
        ],
        channels: [
            { channelId: 'ch_1', channelName: '도매 / 대리점 정기공급', targetPrice: 3800 },
            { channelId: 'ch_2', channelName: '건설사 본사 직접 납품', targetPrice: 4500 },
            { channelId: 'ch_3', channelName: '기업 온라인 특판몰', targetPrice: 5200 },
            { channelId: 'ch_4', channelName: '공공조달 입찰 기준가', targetPrice: 4100 }
        ],
        targetMarginRate: 20,
        remarks: ''
    };

    // ── 3. 상태 관리 (State) ──
    const state = {
        data: JSON.parse(JSON.stringify(DEFAULT_SEED_DATA)),
        docId: null, // 저장된 문서 ID (신규 시 null)
        archive: []
    };

    // ── 4. DOM 요소 캐싱 ──
    const els = {};

    function initElements() {
        // 상단 툴바
        els.btnVatExclude = document.getElementById('btnVatExclude');
        els.btnVatInclude = document.getElementById('btnVatInclude');
        els.docStatusText = document.getElementById('docStatusText');
        els.btnNewDoc = document.getElementById('btnNewDoc');
        els.btnSaveDoc = document.getElementById('btnSaveDoc');
        els.btnOpenSavedModal = document.getElementById('btnOpenSavedModal');
        els.btnCopyReport = document.getElementById('btnCopyReport');
        els.btnExportCsv = document.getElementById('btnExportCsv');
        els.btnPrint = document.getElementById('btnPrint');

        // 프로젝트 정보
        els.inputProjectTitle = document.getElementById('inputProjectTitle');
        els.inputCustomerName = document.getElementById('inputCustomerName');
        els.btnLoadSample = document.getElementById('btnLoadSample');

        // 물품 대금
        els.tbodyGoods = document.getElementById('tbodyGoods');
        els.btnAddGoodsRow = document.getElementById('btnAddGoodsRow');
        els.sumGoodsQty = document.getElementById('sumGoodsQty');
        els.avgGoodsPrice = document.getElementById('avgGoodsPrice');
        els.sumGoodsSupply = document.getElementById('sumGoodsSupply');
        els.sumGoodsVat = document.getElementById('sumGoodsVat');

        // 금융 비용
        els.chkEnableFinancing = document.getElementById('chkEnableFinancing');
        els.inputPeriodDays = document.getElementById('inputPeriodDays');
        els.inputAnnualRate = document.getElementById('inputAnnualRate');
        els.dispFinancingTotal = document.getElementById('dispFinancingTotal');
        els.dispFinancingUnit = document.getElementById('dispFinancingUnit');

        // 부대비용
        els.tbodyCosts = document.getElementById('tbodyCosts');
        els.btnAddCostRow = document.getElementById('btnAddCostRow');
        els.sumCostsTotal = document.getElementById('sumCostsTotal');
        els.sumCostsUnit = document.getElementById('sumCostsUnit');

        // 의견 및 하단 버튼
        els.textRemarks = document.getElementById('textRemarks');
        els.btnAutoGenerateRemarks = document.getElementById('btnAutoGenerateRemarks');
        els.btnBottomSave = document.getElementById('btnBottomSave');
        els.btnBottomNew = document.getElementById('btnBottomNew');
        els.btnBottomList = document.getElementById('btnBottomList');

        // 우측 출력 요소
        els.displayStripTitle = document.getElementById('displayStripTitle');
        els.displayStripFormula = document.getElementById('displayStripFormula');
        els.displayUnitCost = document.getElementById('displayUnitCost');
        els.costBreakdownSummary = document.getElementById('costBreakdownSummary');
        els.costStackedBar = document.getElementById('costStackedBar');
        els.legGoodsVal = document.getElementById('legGoodsVal');
        els.legLogisticsVal = document.getElementById('legLogisticsVal');
        els.legRentVal = document.getElementById('legRentVal');
        els.legFinancingVal = document.getElementById('legFinancingVal');
        els.legEtcVal = document.getElementById('legEtcVal');

        // 마진 역산기
        els.inputTargetMarginRate = document.getElementById('inputTargetMarginRate');
        els.dispReversePrice = document.getElementById('dispReversePrice');

        // 채널 테이블
        els.tbodyChannels = document.getElementById('tbodyChannels');

        // 워터폴 차트
        els.waterfallChartContainer = document.getElementById('waterfallChartContainer');
        els.waterfallStandardText = document.getElementById('waterfallStandardText');

        // BEP 그리드
        els.bepUnitsText = document.getElementById('bepUnitsText');
        els.bepRevenueText = document.getElementById('bepRevenueText');
        els.bepContributionText = document.getElementById('bepContributionText');
        els.bepMarginRateText = document.getElementById('bepMarginRateText');

        // 시나리오 그리드
        els.scenarioGrid = document.getElementById('scenarioGrid');

        // 민감도 매트릭스
        els.theadSensitivity = document.getElementById('theadSensitivity');
        els.tbodySensitivity = document.getElementById('tbodySensitivity');

        // 모달
        els.savedModalOverlay = document.getElementById('savedModalOverlay');
        els.btnCloseSavedModal = document.getElementById('btnCloseSavedModal');
        els.tbodySavedDocs = document.getElementById('tbodySavedDocs');

        // 인쇄용
        els.printProjectTitle = document.getElementById('printProjectTitle');
        els.printDate = document.getElementById('printDate');
        els.printPeriod = document.getElementById('printPeriod');
    }

    // ── 5. 숫자 포맷팅 도우미 ──
    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString('ko-KR');
    }

    function formatCurrency(num) {
        return formatNumber(num) + '원';
    }

    // ── 6. UI 동기화 및 렌더링 ──

    // 6-1. 물품대금 행 렌더링
    function renderGoodsTable() {
        const isVatInclude = state.data.vatMode === 'include';
        document.querySelectorAll('.col-vat').forEach(el => {
            el.style.display = isVatInclude ? '' : 'none';
        });

        let html = '';
        state.data.items.forEach((item, idx) => {
            const supply = (item.qty || 0) * (item.unitPrice || 0);
            const vat = Math.round(supply * 0.1);

            html += `
                <tr data-index="${idx}">
                    <td>
                        <input type="text" class="erp-input item-name" value="${escapeHtml(item.name || '')}" placeholder="품목명 입력">
                    </td>
                    <td>
                        <input type="text" class="erp-input item-spec" value="${escapeHtml(item.spec || '')}" placeholder="규격/사양">
                    </td>
                    <td>
                        <input type="number" class="erp-input text-right item-qty" value="${item.qty || 0}" min="1" step="1">
                    </td>
                    <td>
                        <input type="number" class="erp-input text-right item-price" value="${item.unitPrice || 0}" min="0" step="10">
                    </td>
                    <td class="text-right item-supply" style="font-weight: 700; color: #0f172a;">
                        ${formatNumber(supply)}
                    </td>
                    <td class="col-vat text-right item-vat" style="${isVatInclude ? '' : 'display: none;'} color: #64748b;">
                        ${formatNumber(vat)}
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn-erp btn-sm btn-del-item" title="행 삭제" style="color: var(--erp-danger); border: none; padding: 0 4px;">
                            <i class="bx bx-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        els.tbodyGoods.innerHTML = html;
        bindGoodsTableEvents();
    }

    function bindGoodsTableEvents() {
        els.tbodyGoods.querySelectorAll('tr').forEach(tr => {
            const idx = parseInt(tr.dataset.index, 10);
            tr.querySelector('.item-name').addEventListener('input', e => {
                state.data.items[idx].name = e.target.value;
                autoSaveDraft();
            });
            tr.querySelector('.item-spec').addEventListener('input', e => {
                state.data.items[idx].spec = e.target.value;
                autoSaveDraft();
            });
            tr.querySelector('.item-qty').addEventListener('input', e => {
                state.data.items[idx].qty = Math.max(0, parseInt(e.target.value, 10) || 0);
                recalculate();
            });
            tr.querySelector('.item-price').addEventListener('input', e => {
                state.data.items[idx].unitPrice = Math.max(0, parseInt(e.target.value, 10) || 0);
                recalculate();
            });
            tr.querySelector('.btn-del-item').addEventListener('click', () => {
                if (state.data.items.length <= 1) {
                    alert('최소 1개 이상의 매입 품목이 필요합니다.');
                    return;
                }
                state.data.items.splice(idx, 1);
                renderGoodsTable();
                recalculate();
            });
        });
    }

    // 6-2. 부대비용 행 렌더링
    function renderCostsTable() {
        let html = '';
        state.data.costs.forEach((cost, idx) => {
            const catClass = `cat-${cost.category || 'etc'}`;
            const catLabel = getCategoryLabel(cost.category);

            html += `
                <tr data-index="${idx}" style="${cost.isEnabled ? '' : 'opacity: 0.55; background: #f8fafc;'}">
                    <td class="text-center">
                        <input type="checkbox" class="cost-toggle" ${cost.isEnabled ? 'checked' : ''} title="시뮬레이션 포함 여부 토글">
                    </td>
                    <td>
                        <select class="erp-select cost-category" style="font-weight: 600;">
                            <option value="logistics" ${cost.category === 'logistics' ? 'selected' : ''}>물류·운송비</option>
                            <option value="rent" ${cost.category === 'rent' ? 'selected' : ''}>임대·창고료</option>
                            <option value="packaging" ${cost.category === 'packaging' ? 'selected' : ''}>포장·자재비</option>
                            <option value="labor" ${cost.category === 'labor' ? 'selected' : ''}>인건·외주비</option>
                            <option value="fee" ${cost.category === 'fee' ? 'selected' : ''}>수수료·보험</option>
                            <option value="etc" ${cost.category === 'etc' ? 'selected' : ''}>기타 운영비</option>
                        </select>
                    </td>
                    <td>
                        <input type="text" class="erp-input cost-name" value="${escapeHtml(cost.name || '')}" placeholder="비용 항목명">
                    </td>
                    <td>
                        <input type="number" class="erp-input text-right cost-amount" value="${cost.amount || 0}" min="0" step="10000">
                    </td>
                    <td class="text-right cost-unit" style="font-weight: 600; color: #475569;">
                        -
                    </td>
                    <td class="text-center">
                        <button type="button" class="btn-erp btn-sm btn-del-cost" title="행 삭제" style="color: var(--erp-danger); border: none; padding: 0 4px;">
                            <i class="bx bx-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        els.tbodyCosts.innerHTML = html;
        bindCostsTableEvents();
    }

    function getCategoryLabel(cat) {
        const map = {
            logistics: '물류·운송',
            rent: '임대·창고',
            packaging: '포장·자재',
            labor: '인건·외주',
            fee: '수수료',
            etc: '기타'
        };
        return map[cat] || '기타';
    }

    function bindCostsTableEvents() {
        els.tbodyCosts.querySelectorAll('tr').forEach(tr => {
            const idx = parseInt(tr.dataset.index, 10);
            tr.querySelector('.cost-toggle').addEventListener('change', e => {
                state.data.costs[idx].isEnabled = e.target.checked;
                renderCostsTable();
                recalculate();
            });
            tr.querySelector('.cost-category').addEventListener('change', e => {
                state.data.costs[idx].category = e.target.value;
                recalculate();
            });
            tr.querySelector('.cost-name').addEventListener('input', e => {
                state.data.costs[idx].name = e.target.value;
                autoSaveDraft();
            });
            tr.querySelector('.cost-amount').addEventListener('input', e => {
                state.data.costs[idx].amount = Math.max(0, parseInt(e.target.value, 10) || 0);
                recalculate();
            });
            tr.querySelector('.btn-del-cost').addEventListener('click', () => {
                state.data.costs.splice(idx, 1);
                renderCostsTable();
                recalculate();
            });
        });
    }

    // ── 7. 종합 재계산 (Core Calculation Loop) ──
    function recalculate() {
        // 1. 물품대 산출
        const goodsResult = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.vatMode);

        els.sumGoodsQty.textContent = formatNumber(goodsResult.totalQty);
        els.avgGoodsPrice.textContent = formatNumber(goodsResult.avgUnitGoodsPrice);
        els.sumGoodsSupply.textContent = formatNumber(goodsResult.totalSupplyPrice);
        els.sumGoodsVat.textContent = formatNumber(goodsResult.totalVat);

        // 물품 각 행의 공급가액 실시간 업데이트
        els.tbodyGoods.querySelectorAll('tr').forEach((tr, idx) => {
            const item = goodsResult.items[idx];
            if (item) {
                const spCell = tr.querySelector('.item-supply');
                const vtCell = tr.querySelector('.item-vat');
                if (spCell) spCell.textContent = formatNumber(item.supplyPrice);
                if (vtCell) vtCell.textContent = formatNumber(item.vat);
            }
        });

        // 2. 부대비용 산출
        const totalQty = goodsResult.totalQty > 0 ? goodsResult.totalQty : 1;
        const otherResult = SalesMarginEngine.calculateOtherCosts(state.data.costs, totalQty);

        els.sumCostsTotal.textContent = formatNumber(otherResult.totalEnabledCosts);
        els.sumCostsUnit.textContent = formatNumber(otherResult.unitEnabledCost);

        // 부대비용 각 행의 개당 배부액 업데이트
        els.tbodyCosts.querySelectorAll('tr').forEach((tr, idx) => {
            const cost = otherResult.costs[idx];
            if (cost) {
                const uCell = tr.querySelector('.cost-unit');
                if (uCell) {
                    uCell.textContent = cost.isEnabled ? formatNumber(cost.unitAmount) : '-';
                }
            }
        });

        // 3. 금융비용 산출
        const isFinancingOn = els.chkEnableFinancing.checked;
        state.data.financing.isEnabled = isFinancingOn;
        state.data.financing.periodDays = Math.max(0, parseInt(els.inputPeriodDays.value, 10) || 0);
        state.data.financing.annualRatePct = Math.max(0, parseFloat(els.inputAnnualRate.value) || 0);

        const baseWorkingCapital = goodsResult.totalSupplyPrice + otherResult.totalEnabledCosts;
        const financingResult = SalesMarginEngine.calculateFinancingCost(
            baseWorkingCapital,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            totalQty,
            isFinancingOn
        );

        els.dispFinancingTotal.textContent = formatCurrency(financingResult.effectiveInterest);
        els.dispFinancingUnit.textContent = isFinancingOn
            ? `(개당 ${formatNumber(financingResult.unitFinancingCost)}원)`
            : '(원가 미산입)';

        // 4. 최종 종합원가 집계
        const totalSummary = SalesMarginEngine.calculateTotalCostSummary(goodsResult, otherResult, financingResult);

        els.displayStripTitle.textContent = state.data.project.title || '안전용품 정기 공급 프로젝트';
        els.displayStripFormula.textContent = `물품대 ${formatNumber(goodsResult.avgUnitGoodsPrice)}원 + 부대비 ${formatNumber(otherResult.unitEnabledCost)}원 + 금융비 ${formatNumber(financingResult.unitFinancingCost)}원 (자금회수 ${state.data.financing.periodDays}일)`;
        els.displayUnitCost.textContent = formatNumber(totalSummary.unitCost);

        // 원가 구성 바 갱신
        renderCostStackedBar(totalSummary.breakdownRatio, goodsResult, otherResult, financingResult);

        // 5. 마진 역산기 갱신
        const targetMargin = Math.max(1, Math.min(90, parseInt(els.inputTargetMarginRate.value, 10) || 20));
        const reversePrice = SalesMarginEngine.calculateReversePriceByMargin(totalSummary.unitCost, targetMargin);
        els.dispReversePrice.textContent = formatCurrency(reversePrice);

        // 6. 채널별 목표 판매가 테이블 갱신
        const channelResults = SalesMarginEngine.calculateChannelProfitability(state.data.channels, totalSummary.unitCost, totalQty);
        renderChannelsTable(channelResults);

        // 7. 워터폴 차트 갱신 (채널1 기준 또는 기본 판매가)
        const primaryChannel = channelResults[0] || { targetPrice: reversePrice };
        els.waterfallStandardText.textContent = `기준 판매가: ${primaryChannel.channelName || '기본채널'} (${formatNumber(primaryChannel.targetPrice)}원)`;
        const waterfallData = SalesMarginEngine.generateWaterfallData(primaryChannel.targetPrice, totalSummary, otherResult);
        renderWaterfallChart(waterfallData);

        // 8. 손익분기점 (BEP) 갱신
        const bepResult = SalesMarginEngine.calculateBEP(
            otherResult.fixedCosts,
            goodsResult.avgUnitGoodsPrice + otherResult.categoryTotals.logistics / totalQty + financingResult.unitFinancingCost,
            primaryChannel.targetPrice
        );
        els.bepUnitsText.textContent = formatNumber(bepResult.bepUnits);
        els.bepRevenueText.textContent = formatCurrency(bepResult.bepRevenue);
        els.bepContributionText.textContent = formatCurrency(bepResult.unitContribution);
        els.bepMarginRateText.textContent = `${bepResult.contributionMarginRate}%`;

        // 9. 비용 What-If 3대 시나리오 비교 갱신
        const scenarios = SalesMarginEngine.generateScenarioComparison(
            goodsResult,
            state.data.costs,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            primaryChannel.targetPrice
        );
        renderScenarioCards(scenarios);

        // 10. 2차원 민감도 매트릭스 갱신
        const sensitivity = SalesMarginEngine.calculateSensitivityMatrix(
            totalSummary.unitCost,
            primaryChannel.targetPrice,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            totalQty
        );
        renderSensitivityMatrix(sensitivity);

        // 인쇄용 헤더 동기화
        if (els.printProjectTitle) els.printProjectTitle.textContent = state.data.project.title;
        if (els.printDate) els.printDate.textContent = state.data.project.date;
        if (els.printPeriod) els.printPeriod.textContent = `${state.data.financing.periodDays}일 (연 ${state.data.financing.annualRatePct}%)`;

        autoSaveDraft();
    }

    // ── 8. 세부 시각화 렌더러들 ──

    // 8-1. 원가 구성 스택트 바
    function renderCostStackedBar(ratio, goods, others, financing) {
        els.costBreakdownSummary.textContent = `물품대 ${ratio.goods}% | 물류 ${ratio.logistics}% | 임대 ${ratio.rent}% | 금융 ${ratio.financing}% | 기타 ${ratio.etc}%`;

        els.costStackedBar.innerHTML = `
            <div class="cost-segment seg-goods" style="width: ${ratio.goods}%;" title="물품대: ${ratio.goods}%">물품대 ${ratio.goods}%</div>
            ${ratio.logistics > 0 ? `<div class="cost-segment seg-logistics" style="width: ${ratio.logistics}%;" title="물류비: ${ratio.logistics}%">물류 ${ratio.logistics}%</div>` : ''}
            ${ratio.rent > 0 ? `<div class="cost-segment seg-rent" style="width: ${ratio.rent}%;" title="임대료: ${ratio.rent}%">임대 ${ratio.rent}%</div>` : ''}
            ${ratio.financing > 0 ? `<div class="cost-segment seg-financing" style="width: ${ratio.financing}%;" title="금융비용: ${ratio.financing}%">금융 ${ratio.financing}%</div>` : ''}
            ${ratio.etc > 0 ? `<div class="cost-segment seg-etc" style="width: ${ratio.etc}%;" title="기타: ${ratio.etc}%">기타 ${ratio.etc}%</div>` : ''}
        `;

        els.legGoodsVal.textContent = formatCurrency(goods.avgUnitGoodsPrice);
        els.legLogisticsVal.textContent = formatCurrency(Math.round(others.categoryTotals.logistics / (goods.totalQty || 1)));
        els.legRentVal.textContent = formatCurrency(Math.round(others.categoryTotals.rent / (goods.totalQty || 1)));
        els.legFinancingVal.textContent = formatCurrency(financing.unitFinancingCost);
        els.legEtcVal.textContent = formatCurrency(Math.round((others.categoryTotals.packaging + others.categoryTotals.labor + others.categoryTotals.fee + others.categoryTotals.etc) / (goods.totalQty || 1)));
    }

    // 8-2. 채널별 테이블 렌더링
    function renderChannelsTable(channels) {
        let html = '';
        channels.forEach((ch, idx) => {
            const badgeClass = ch.isHealthy ? 'margin-healthy' : (ch.isWarning ? 'margin-warning' : 'margin-danger');
            const badgeText = ch.isHealthy ? '우수' : (ch.isWarning ? '주의' : '위험');

            html += `
                <tr data-index="${idx}">
                    <td>
                        <input type="text" class="erp-input ch-name" value="${escapeHtml(ch.channelName || '')}">
                    </td>
                    <td>
                        <input type="number" class="erp-input text-right ch-price" value="${ch.targetPrice}" step="100">
                    </td>
                    <td class="text-right" style="font-weight: 700; color: #0f172a;">
                        ${formatCurrency(ch.marginAmount)}
                    </td>
                    <td class="text-right" style="font-weight: 800; color: ${ch.marginRate >= 18 ? '#047857' : (ch.marginRate >= 10 ? '#b45309' : '#b91c1c')};">
                        ${ch.marginRate}%
                    </td>
                    <td class="text-right" style="color: #475569;">
                        ${ch.markupRate}%
                    </td>
                    <td class="text-right" style="font-weight: 600; font-size: 11px;">
                        ${formatNumber(ch.totalProfit)}원
                    </td>
                    <td class="text-center">
                        <span class="margin-badge ${badgeClass}">${badgeText}</span>
                    </td>
                </tr>
            `;
        });

        els.tbodyChannels.innerHTML = html;

        els.tbodyChannels.querySelectorAll('tr').forEach(tr => {
            const idx = parseInt(tr.dataset.index, 10);
            tr.querySelector('.ch-name').addEventListener('input', e => {
                state.data.channels[idx].channelName = e.target.value;
                autoSaveDraft();
            });
            tr.querySelector('.ch-price').addEventListener('input', e => {
                state.data.channels[idx].targetPrice = Math.max(0, parseInt(e.target.value, 10) || 0);
                recalculate();
            });
        });
    }

    // 8-3. SVG 기반 마진 워터폴 (Waterfall Bridge) 차트 렌더러
    function renderWaterfallChart(steps) {
        if (!steps || steps.length === 0) return;

        const container = els.waterfallChartContainer;
        const width = container.clientWidth || 540;
        const height = 180;
        const padTop = 30;
        const padBottom = 35;
        const padLeft = 40;
        const padRight = 20;

        const chartH = height - padTop - padBottom;
        const chartW = width - padLeft - padRight;

        // Y축 최대값
        const maxVal = Math.max(...steps.map(s => Math.max(s.runningTotal, s.amount, 0))) * 1.15 || 10000;
        const scaleY = val => chartH - (val / maxVal) * chartH;

        const colW = Math.min(48, Math.floor(chartW / steps.length) - 10);
        const colGap = Math.floor((chartW - colW * steps.length) / (steps.length - 1 || 1));

        let svgHtml = `
            <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; font-family: inherit;">
                <!-- Baseline -->
                <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="#cbd5e1" stroke-width="1.5" />
        `;

        let prevTopY = null;

        steps.forEach((step, idx) => {
            const x = padLeft + idx * (colW + colGap);
            let barH = 0;
            let barY = 0;

            if (step.type === 'start') {
                barH = (step.amount / maxVal) * chartH;
                barY = padTop + scaleY(step.amount);
                prevTopY = barY;
            } else if (step.type === 'drop') {
                const dropH = (step.amount / maxVal) * chartH;
                barH = Math.max(2, dropH);
                barY = prevTopY; // 떨어지기 시작하는 지점
                prevTopY = barY + barH; // 새 바닥
            } else if (step.type === 'end') {
                barH = Math.max(0, (step.amount / maxVal) * chartH);
                barY = padTop + scaleY(step.amount);
            }

            // Connecting dotted line from previous
            if (idx > 0) {
                const prevX = padLeft + (idx - 1) * (colW + colGap) + colW;
                svgHtml += `
                    <line x1="${prevX}" y1="${barY}" x2="${x}" y2="${barY}" stroke="#94a3b8" stroke-dasharray="2,2" stroke-width="1" />
                `;
            }

            // Bar Rect
            svgHtml += `
                <rect x="${x}" y="${barY}" width="${colW}" height="${barH}" rx="2" fill="${step.color}" opacity="0.9" />
            `;

            // Top Value Label
            const valLabelY = barY - 6;
            const prefix = step.delta < 0 ? '-' : '';
            svgHtml += `
                <text x="${x + colW / 2}" y="${valLabelY}" text-anchor="middle" font-size="10" font-weight="800" fill="#0f172a">
                    ${prefix}${formatNumber(step.amount)}
                </text>
            `;

            // Bottom Name Label
            svgHtml += `
                <text x="${x + colW / 2}" y="${padTop + chartH + 18}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#475569">
                    ${step.label.split(' ')[0]}
                </text>
            `;
        });

        svgHtml += `</svg>`;
        container.innerHTML = svgHtml;
    }

    // 8-4. 비용 What-If 시나리오 카드 렌더러
    function renderScenarioCards(scenarios) {
        let html = '';
        scenarios.forEach((sc, idx) => {
            const isDefault = sc.isDefault ? 'is-active' : '';
            html += `
                <div class="scenario-card ${isDefault}">
                    <span class="scenario-tag" style="background: ${sc.tagColor};">${sc.name}</span>
                    <div class="scenario-name">개당 ${formatCurrency(sc.unitCost)}</div>
                    <div class="scenario-desc">${sc.desc}</div>
                    <div class="scenario-values">
                        <div>
                            <span style="font-size: 9.5px; color: var(--erp-text-muted);">예상 마진율</span>
                            <div class="scenario-margin-val" style="color: ${sc.marginRate >= 18 ? '#047857' : '#b45309'};">${sc.marginRate}%</div>
                        </div>
                        <div style="text-align: right;">
                            <span style="font-size: 9.5px; color: var(--erp-text-muted);">총 소요원가</span>
                            <div class="scenario-cost-val">${formatNumber(sc.totalCost)}원</div>
                        </div>
                    </div>
                </div>
            `;
        });
        els.scenarioGrid.innerHTML = html;
    }

    // 8-5. 2차원 민감도 매트릭스 렌더러
    function renderSensitivityMatrix(data) {
        // Table Header
        let thHtml = `<th>판매단가 변동</th>`;
        data.daySteps.forEach(days => {
            thHtml += `<th>회수 ${days}일</th>`;
        });
        els.theadSensitivity.innerHTML = thHtml;

        // Table Body
        let tbHtml = '';
        data.matrix.forEach(row => {
            const sign = row.deltaPct > 0 ? `+${row.deltaPct}%` : (row.deltaPct === 0 ? '기준가' : `${row.deltaPct}%`);
            tbHtml += `<tr>`;
            tbHtml += `<td style="font-weight: 700; color: #334155; text-align: left; padding-left: 8px;">
                ${sign} (${formatNumber(row.price)}원)
            </td>`;

            row.cells.forEach(cell => {
                const cellClass = cell.isHealthy ? 'cell-healthy' : (cell.isWarning ? 'cell-warning' : 'cell-danger');
                tbHtml += `
                    <td class="heatmap-cell ${cellClass}" title="단가: ${formatNumber(cell.price)}원 | 회수: ${cell.days}일 | 마진: ${formatCurrency(cell.marginAmount)}">
                        ${cell.marginRate}%
                    </td>
                `;
            });
            tbHtml += `</tr>`;
        });
        els.tbodySensitivity.innerHTML = tbHtml;
    }

    // ── 9. 의견 자동완성 및 기안문 복사 ──
    function generateAutoRemarks() {
        const goods = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.vatMode);
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const others = SalesMarginEngine.calculateOtherCosts(state.data.costs, totalQty);
        const fin = SalesMarginEngine.calculateFinancingCost(
            goods.totalSupplyPrice + others.totalEnabledCosts,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            totalQty,
            state.data.financing.isEnabled
        );
        const summary = SalesMarginEngine.calculateTotalCostSummary(goods, others, fin);
        const channels = SalesMarginEngine.calculateChannelProfitability(state.data.channels, summary.unitCost, totalQty);
        const mainCh = channels[0] || {};

        const remarksText = `[영업 수주 및 원가 시뮬레이션 종합 검토의견]
1. 본 프로젝트의 총 매입 수량은 ${formatNumber(goods.totalQty)}개, 물품 매입총액은 ${formatCurrency(goods.totalSupplyPrice)}(평균 개당 ${formatCurrency(goods.avgUnitGoodsPrice)})입니다.
2. 부대비용 및 자금 회수기간(${state.data.financing.periodDays}일, 연이자율 ${state.data.financing.annualRatePct}%)에 따른 금융비용(${formatCurrency(fin.effectiveInterest)})을 산입한 최종 개당 종합원가는 ${formatCurrency(summary.unitCost)}으로 산출되었습니다.
3. 주요 판매채널(${mainCh.channelName || '대리점'})에 ${formatCurrency(mainCh.targetPrice || 0)}으로 공급 시, 개당 마진 ${formatCurrency(mainCh.marginAmount || 0)}(마진율 ${mainCh.marginRate || 0}%, 예상 총 영업익 ${formatCurrency(mainCh.totalProfit || 0)})을 안정적으로 확보할 수 있는 것으로 분석됩니다.
4. 원가 절감 또는 마진 방어를 위해 임대/창고료 및 자금 회수기일 단축을 통한 금융비용 최소화 방안을 함께 권고합니다.`;

        els.textRemarks.value = remarksText;
        state.data.remarks = remarksText;
        autoSaveDraft();
    }

    function copyReportToClipboard() {
        generateAutoRemarks();
        navigator.clipboard.writeText(els.textRemarks.value)
            .then(() => alert('결재 보고용 기안문 텍스트가 클립보드에 복사되었습니다.'))
            .catch(() => alert('클립보드 복사 권한이 없습니다. 텍스트 박스를 직접 복사해 주세요.'));
    }

    // ── 10. 엑셀(CSV) 다운로드 ──
    function exportToCsv() {
        const goods = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.vatMode);
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const others = SalesMarginEngine.calculateOtherCosts(state.data.costs, totalQty);
        const fin = SalesMarginEngine.calculateFinancingCost(
            goods.totalSupplyPrice + others.totalEnabledCosts,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            totalQty,
            state.data.financing.isEnabled
        );
        const summary = SalesMarginEngine.calculateTotalCostSummary(goods, others, fin);
        const channels = SalesMarginEngine.calculateChannelProfitability(state.data.channels, summary.unitCost, totalQty);

        let csv = '\uFEFF'; // UTF-8 BOM
        csv += `프로젝트,${state.data.project.title}\n`;
        csv += `고객사,${state.data.project.customerName}\n`;
        csv += `기준일자,${state.data.project.date}\n`;
        csv += `최종 개당원가,${summary.unitCost}원\n\n`;

        csv += `[1. 물품 대금 매입 내역]\n`;
        csv += `품목명,규격/사양,수량,단가(원),공급가액(원)\n`;
        state.data.items.forEach(it => {
            csv += `"${it.name}","${it.spec}",${it.qty},${it.unitPrice},${it.qty * it.unitPrice}\n`;
        });
        csv += `매입합계,,${goods.totalQty},,${goods.totalSupplyPrice}\n\n`;

        csv += `[2. 부대비용 및 금융비용]\n`;
        csv += `비용구분,항목명,총금액(원),개당배부(원),반영여부\n`;
        others.costs.forEach(c => {
            csv += `"${getCategoryLabel(c.category)}","${c.name}",${c.amount},${c.unitAmount},${c.isEnabled ? 'ON' : 'OFF'}\n`;
        });
        csv += `"금융비용","자금회수 ${state.data.financing.periodDays}일 (연 ${state.data.financing.annualRatePct}%)",${fin.effectiveInterest},${fin.unitFinancingCost},${fin.isEnabled ? 'ON' : 'OFF'}\n\n`;

        csv += `[3. 채널별 목표 판매가 및 마진]\n`;
        csv += `판매채널,목표판매가(원),개당마진(원),마진율(%),총영업이익(원)\n`;
        channels.forEach(ch => {
            csv += `"${ch.channelName}",${ch.targetPrice},${ch.marginAmount},${ch.marginRate}%,${ch.totalProfit}\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `원가마진시뮬레이션_${state.data.project.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── 11. 문서 저장 및 보관함 관리 ──
    function autoSaveDraft() {
        state.data.project.title = els.inputProjectTitle.value;
        state.data.project.customerName = els.inputCustomerName.value;
        state.data.remarks = els.textRemarks.value;
        localStorage.setItem(STORAGE_KEY_CURRENT, JSON.stringify(state.data));
    }

    function saveToArchive() {
        const goods = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.vatMode);
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const others = SalesMarginEngine.calculateOtherCosts(state.data.costs, totalQty);
        const fin = SalesMarginEngine.calculateFinancingCost(
            goods.totalSupplyPrice + others.totalEnabledCosts,
            state.data.financing.periodDays,
            state.data.financing.annualRatePct,
            totalQty,
            state.data.financing.isEnabled
        );
        const summary = SalesMarginEngine.calculateTotalCostSummary(goods, others, fin);

        const docId = state.docId || 'sim_' + Date.now();
        const docRecord = {
            id: docId,
            savedAt: new Date().toLocaleString('ko-KR'),
            data: JSON.parse(JSON.stringify(state.data)),
            summary: {
                title: state.data.project.title || '무제 시뮬레이션',
                customerName: state.data.project.customerName || '-',
                unitCost: summary.unitCost,
                totalCost: summary.totalCost
            }
        };

        const existingIdx = state.archive.findIndex(d => d.id === docId);
        if (existingIdx >= 0) {
            state.archive[existingIdx] = docRecord;
        } else {
            state.archive.unshift(docRecord);
        }

        state.docId = docId;
        localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(state.archive));
        els.docStatusText.textContent = `저장됨: ${docRecord.summary.title}`;
        alert('시뮬레이션이 성공적으로 저장되었습니다.');
    }

    function loadSavedArchive() {
        const raw = localStorage.getItem(STORAGE_KEY_ARCHIVE);
        if (raw) {
            try {
                state.archive = JSON.parse(raw);
            } catch (e) {
                state.archive = [];
            }
        }
    }

    function openSavedModal() {
        loadSavedArchive();
        let html = '';
        if (state.archive.length === 0) {
            html = `<tr><td colspan="5" class="text-center" style="padding: 20px; color: var(--erp-text-muted);">저장된 시뮬레이션 문서가 없습니다.</td></tr>`;
        } else {
            state.archive.forEach(item => {
                html += `
                    <tr>
                        <td style="font-weight: 700; color: #0f172a;">${escapeHtml(item.summary.title)}</td>
                        <td>${escapeHtml(item.summary.customerName)}</td>
                        <td class="text-right" style="font-weight: 700; color: var(--erp-primary);">${formatCurrency(item.summary.unitCost)}</td>
                        <td style="font-size: 11px; color: #64748b;">${item.savedAt}</td>
                        <td class="text-center">
                            <button type="button" class="btn-erp btn-sm" onclick="window.salesSimApp.loadDoc('${item.id}')">불러오기</button>
                            <button type="button" class="btn-erp btn-sm" style="color: var(--erp-danger);" onclick="window.salesSimApp.deleteDoc('${item.id}')">삭제</button>
                        </td>
                    </tr>
                `;
            });
        }
        els.tbodySavedDocs.innerHTML = html;
        els.savedModalOverlay.classList.add('active');
    }

    function closeSavedModal() {
        els.savedModalOverlay.classList.remove('active');
    }

    function loadDocById(id) {
        const target = state.archive.find(d => d.id === id);
        if (!target) return;
        state.data = JSON.parse(JSON.stringify(target.data));
        state.docId = target.id;
        populateDataToUI();
        closeSavedModal();
        recalculate();
        els.docStatusText.textContent = `불러옴: ${target.summary.title}`;
    }

    function deleteDocById(id) {
        if (!confirm('이 시뮬레이션 문서를 삭제하시겠습니까?')) return;
        state.archive = state.archive.filter(d => d.id !== id);
        localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(state.archive));
        openSavedModal();
    }

    function createNewDoc() {
        if (!confirm('작성 중인 내용을 비우고 새 시뮬레이션을 생성하시겠습니까?')) return;
        state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
        state.docId = null;
        state.data.items = [{ id: 'item_1', name: '', spec: '', qty: 1000, unitPrice: 0 }];
        state.data.costs = [{ id: 'cost_1', name: '운송료', category: 'logistics', amount: 0, isEnabled: true }];
        populateDataToUI();
        recalculate();
        els.docStatusText.textContent = '문서: 신규 시뮬레이션';
    }

    function populateDataToUI() {
        els.inputProjectTitle.value = state.data.project.title || '';
        els.inputCustomerName.value = state.data.project.customerName || '';
        els.chkEnableFinancing.checked = !!state.data.financing.isEnabled;
        els.inputPeriodDays.value = state.data.financing.periodDays || 60;
        els.inputAnnualRate.value = state.data.financing.annualRatePct || 5.0;
        els.inputTargetMarginRate.value = state.data.targetMarginRate || 20;
        els.textRemarks.value = state.data.remarks || '';

        // VAT 토글 버튼 동기화
        if (state.data.vatMode === 'include') {
            els.btnVatInclude.classList.add('active');
            els.btnVatExclude.classList.remove('active');
        } else {
            els.btnVatExclude.classList.add('active');
            els.btnVatInclude.classList.remove('active');
        }

        renderGoodsTable();
        renderCostsTable();
    }

    // ── 12. 헬퍼 메서드 및 전역 노출 ──
    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    window.salesSimApp = {
        setDays(days) {
            els.inputPeriodDays.value = days;
            recalculate();
        },
        setTargetMargin(margin) {
            els.inputTargetMarginRate.value = margin;
            recalculate();
        },
        loadDoc(id) {
            loadDocById(id);
        },
        deleteDoc(id) {
            deleteDocById(id);
        }
    };

    // ── 13. 이벤트 바인딩 ──
    function bindEvents() {
        // VAT 토글
        els.btnVatExclude.addEventListener('click', () => {
            state.data.vatMode = 'exclude';
            els.btnVatExclude.classList.add('active');
            els.btnVatInclude.classList.remove('active');
            renderGoodsTable();
            recalculate();
        });
        els.btnVatInclude.addEventListener('click', () => {
            state.data.vatMode = 'include';
            els.btnVatInclude.classList.add('active');
            els.btnVatExclude.classList.remove('active');
            renderGoodsTable();
            recalculate();
        });

        // 프로젝트 정보 인풋
        els.inputProjectTitle.addEventListener('input', e => {
            state.data.project.title = e.target.value;
            autoSaveDraft();
        });
        els.inputCustomerName.addEventListener('input', e => {
            state.data.project.customerName = e.target.value;
            autoSaveDraft();
        });

        // 샘플 불러오기
        els.btnLoadSample.addEventListener('click', () => {
            state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
            populateDataToUI();
            recalculate();
        });

        // 품목 및 비용 행 추가
        els.btnAddGoodsRow.addEventListener('click', () => {
            state.data.items.push({
                id: 'item_' + Date.now(),
                name: '',
                spec: '',
                qty: 1000,
                unitPrice: 0
            });
            renderGoodsTable();
            recalculate();
        });

        els.btnAddCostRow.addEventListener('click', () => {
            state.data.costs.push({
                id: 'cost_' + Date.now(),
                name: '추가 운영비',
                category: 'etc',
                amount: 100000,
                isEnabled: true
            });
            renderCostsTable();
            recalculate();
        });

        // 금융비용 변경
        els.chkEnableFinancing.addEventListener('change', recalculate);
        els.inputPeriodDays.addEventListener('input', recalculate);
        els.inputAnnualRate.addEventListener('input', recalculate);

        // 마진 역산 인풋
        els.inputTargetMarginRate.addEventListener('input', recalculate);

        // 의견 및 하단 버튼
        els.btnAutoGenerateRemarks.addEventListener('click', generateAutoRemarks);
        els.btnCopyReport.addEventListener('click', copyReportToClipboard);
        els.btnExportCsv.addEventListener('click', exportToCsv);
        els.btnPrint.addEventListener('click', () => window.print());

        // 저장 / 새로작성 / 보관함
        els.btnSaveDoc.addEventListener('click', saveToArchive);
        els.btnBottomSave.addEventListener('click', saveToArchive);
        els.btnNewDoc.addEventListener('click', createNewDoc);
        els.btnBottomNew.addEventListener('click', createNewDoc);
        els.btnOpenSavedModal.addEventListener('click', openSavedModal);
        els.btnBottomList.addEventListener('click', openSavedModal);
        els.btnCloseSavedModal.addEventListener('click', closeSavedModal);

        // 단축키 (F8 또는 Ctrl+S 저장)
        window.addEventListener('keydown', e => {
            if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
                e.preventDefault();
                saveToArchive();
            }
        });
    }

    // ── 14. 초기화 실행 ──
    function init() {
        initElements();
        loadSavedArchive();

        // 임시저장 데이터 로드 또는 기본 샘플 로드
        const savedDraft = localStorage.getItem(STORAGE_KEY_CURRENT);
        if (savedDraft) {
            try {
                state.data = Object.assign({}, DEFAULT_SEED_DATA, JSON.parse(savedDraft));
            } catch (e) {
                state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
            }
        }

        populateDataToUI();
        bindEvents();
        recalculate();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
