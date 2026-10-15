/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이터 애플리케이션 컨트롤러
 * (Sales Cost & Margin Simulator Application Controller)
 * ══════════════════════════════════════════════════════════════
 * - 1열 탑다운(Top-to-Bottom) 워크플로우 제어
 * - Step 1: 물품대금 매입 내역, 부가세(VAT) 토글 및 선택조합 기준 품목별 권장판가 자동 배부
 *           (In-Place DOM 업데이트로 포커스 소실 없이 다자리수 연속 입력 보장)
 * - Step 2: 부대비용 마스터 인라인 편집기 + 매입 시나리오 1, 2, 3 설정
 * - Step 3: 판매가 시나리오 1, 2, 3 설정 (기준원가 선택 및 프리셋/직접입력 마진율 역산)
 * - Step 4: 매입 × 판매 시나리오 3×3 교차 분석표 (총 9가지 경우의 수)
 * - Step 5: 선택 조합 심층 분석 (적자/흑자 대응 마진 워터폴 SVG & 정밀 손익분기점 BEP)
 * - Step 6: 종합 검토 의견 기안문 자동생성, 클립보드 복사, 엑셀(CSV), 보관함 모달, A4 인쇄
 */

import { SalesMarginEngine } from './margin-engine.js';

(function () {
    'use strict';

    // ── 1. 상수 및 스토리지 키 ──
    const STORAGE_KEY_ARCHIVE = 'kng_sales_sim_archive_v2';

    const COST_CATEGORIES = [
        { value: 'logistics', label: '물류·운송비' },
        { value: 'rent', label: '임대·창고료' },
        { value: 'packaging', label: '포장·라벨비' },
        { value: 'labor', label: '작업·인건비' },
        { value: 'fee', label: '수수료·보험' },
        { value: 'etc', label: '기타부대비' }
    ];

    // ── 2. 기본 시드 데이터 (실무 권장 샘플) ──
    // 가중평균 매입단가(2,800원) 대비 위험(<10%)·주의(10~18%)·안전(≥18%) 구간이 골고루 분포되도록 구성
    const DEFAULT_SEED_DATA = {
        docTitle: '2026 하반기 안전조끼 납품 원가·마진 타당성 검토',
        includeVat: false,
        benchmarkCostMode: '1', // 'selected' | '0' | '1' | '2'
        items: [
            { id: 'item_1', name: '형광 4포켓 메쉬 안전조끼', spec: 'Woven 형광노랑 L~3XL', qty: 2000, unitPrice: 4800 },
            { id: 'item_2', name: 'ABS 통기형 산업용 안전모', spec: '백색 4점식 턱끈', qty: 500, unitPrice: 6500 },
            { id: 'item_3', name: 'PU 코팅 정밀 안전장갑', spec: '그레이 13게이지', qty: 3000, unitPrice: 850 }
        ],
        costsPool: [
            { id: 'cost_1', name: '물류센터 왕복 화물 운송료', category: 'logistics', amount: 350000, isFixed: false },
            { id: 'cost_2', name: '임시 보관 창고 임대료 (2개월)', category: 'rent', amount: 500000, isFixed: true },
            { id: 'cost_3', name: '회사 로고 라벨 부착 및 소포장', category: 'packaging', amount: 280000, isFixed: false },
            { id: 'cost_4', name: '전자계약 및 지급보증보험 수수료', category: 'fee', amount: 150000, isFixed: false }
        ],
        financing: {
            periodDays: 60,
            annualRatePct: 5.0
        },
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
        salesScenarios: [
            { id: 's1', name: '시나리오 A: 도매 최저가', targetPrice: 3350, memo: '대리점/도매 납품가' },
            { id: 's2', name: '시나리오 B: 본사 표준목표가', targetPrice: 3800, memo: '건설사 직접 납품가' },
            { id: 's3', name: '시나리오 C: 권장 소비자가', targetPrice: 4400, memo: '온라인 소매/특판가' }
        ],
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
        calculated: null
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
        els.avgRecommendedPrice = document.getElementById('avgRecommendedPrice');

        // Step 2: 부대비용 풀 & 매입 시나리오
        els.inputPeriodDays = document.getElementById('inputPeriodDays');
        els.inputAnnualRate = document.getElementById('inputAnnualRate');
        els.btnToggleCostPool = document.getElementById('btnToggleCostPool');
        els.btnAddCostItem = document.getElementById('btnAddCostItem');
        els.costPoolEditorWrap = document.getElementById('costPoolEditorWrap');
        els.dispCostPoolSummary = document.getElementById('dispCostPoolSummary');
        els.tbodyCostsPool = document.getElementById('tbodyCostsPool');
        els.costScenariosContainer = document.getElementById('costScenariosContainer');

        // Step 3: 판매가 시나리오
        els.selectBenchmarkCost = document.getElementById('selectBenchmarkCost');
        els.salesScenariosContainer = document.getElementById('salesScenariosContainer');

        // Step 4: 3×3 교차 분석 매트릭스
        els.tableCrossMatrix = document.getElementById('tableCrossMatrix');
        els.trMatrixHeader = document.getElementById('trMatrixHeader');
        els.tbodyCrossMatrix = document.getElementById('tbodyCrossMatrix');

        // Step 5: 선택 조합 심층 분석 (워터폴 & BEP)
        els.dispSelectedComboTitle = document.getElementById('dispSelectedComboTitle');
        els.waterfallSvgContainer = document.getElementById('waterfallSvgContainer');
        els.dispUnitVariableCost = document.getElementById('dispUnitVariableCost');
        els.dispUnitContribution = document.getElementById('dispUnitContribution');
        els.dispFixedCosts = document.getElementById('dispFixedCosts');
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
        num: n => Math.round(Number(n) || 0).toLocaleString('ko-KR'),
        won: n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`,
        pct: (n, d = 1) => `${(Number(n) || 0).toFixed(d)}%`,
        uid: (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        esc: str => String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

    /**
     * 상태(state.data)와 상단/전역 입력 필드들의 DOM 값을 동기화
     */
    function syncGlobalInputsFromState() {
        if (!state.data.financing) {
            state.data.financing = { periodDays: 60, annualRatePct: 5.0 };
        }
        if (!state.data.selectedCrossIndex) {
            state.data.selectedCrossIndex = { costIdx: 1, salesIdx: 1 };
        }
        if (!state.data.benchmarkCostMode) {
            state.data.benchmarkCostMode = '1';
        }

        if (els.inputDocTitle) els.inputDocTitle.value = state.data.docTitle || '';
        if (els.chkIncludeVat) els.chkIncludeVat.checked = !!state.data.includeVat;
        if (els.inputPeriodDays) els.inputPeriodDays.value = state.data.financing.periodDays ?? 60;
        if (els.inputAnnualRate) els.inputAnnualRate.value = state.data.financing.annualRatePct ?? 5.0;
        if (els.selectBenchmarkCost) els.selectBenchmarkCost.value = state.data.benchmarkCostMode;
        if (els.textRemarks) els.textRemarks.value = state.data.remarks || '';
    }

    /**
     * Step 3에서 사용할 역산·비교 기준 매입 시나리오 객체 반환
     */
    function getBenchmarkCostScenario(evaluatedCosts = []) {
        const mode = state.data.benchmarkCostMode || '1';
        let idx = 1;
        if (mode === 'selected') {
            idx = state.data.selectedCrossIndex?.costIdx ?? 1;
        } else {
            idx = Number(mode);
            if (isNaN(idx) || idx < 0 || idx >= evaluatedCosts.length) idx = 1;
        }
        const sc = evaluatedCosts[idx] || evaluatedCosts[0] || { unitCost: 0, name: '기준원가' };
        const shortLabel = `시나리오 ${idx + 1} 원가`;
        return { sc, idx, shortLabel };
    }

    // ── 6. 데이터 계산 및 렌더링 파이프라인 ──
    /**
     * @param {Object} options
     * @param {boolean} options.rebuildGoods - 물품 테이블 DOM 완전 재빌드 여부
     * @param {boolean} options.rebuildCostPool - 부대비용 마스터 테이블 DOM 완전 재빌드 여부
     * @param {boolean} options.rebuildScenarios - 시나리오 카드 DOM 완전 재빌드 여부
     */
    function recalculateAll({ rebuildGoods = false, rebuildCostPool = false, rebuildScenarios = false } = {}) {
        // 1. 물품대 산출
        const goodsResult = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.includeVat);

        // 금융이자 파라미터 동기화
        const periodDays = Math.max(0, Number(state.data.financing?.periodDays) || 0);
        const annualRatePct = Math.max(0, Number(state.data.financing?.annualRatePct) || 0);

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

        // 선택된 조합의 품목별 배부원가 및 권장판가 산출
        const { costIdx, salesIdx } = state.data.selectedCrossIndex;
        const activeCostSc = matrixResult.evaluatedCosts[costIdx] || matrixResult.evaluatedCosts[0];
        const activeSalesSc = matrixResult.evaluatedSales[salesIdx] || matrixResult.evaluatedSales[0];
        const itemizedAllocation = SalesMarginEngine.calculateItemizedAllocation(goodsResult, activeCostSc, activeSalesSc);

        // 캐시 저장
        state.calculated = {
            goods: goodsResult,
            matrix: matrixResult,
            itemized: itemizedAllocation
        };

        // 3. Step 1: 물품대 렌더링 (재빌드 or In-place 텍스트 업데이트)
        if (rebuildGoods) {
            buildGoodsTableDOM(goodsResult, itemizedAllocation);
        } else {
            updateGoodsTableValues(goodsResult, itemizedAllocation);
        }

        // 4. Step 2 상단: 부대비용 마스터 편집표 렌더링 (재빌드 or In-place 업데이트)
        if (rebuildCostPool) {
            buildCostPoolTableDOM(goodsResult);
        } else {
            updateCostPoolTableValues(goodsResult);
        }

        // 5. Step 2 & 3: 시나리오 카드 렌더링 (재빌드 or In-place 텍스트 업데이트)
        if (rebuildScenarios) {
            buildCostScenariosDOM(goodsResult, matrixResult.evaluatedCosts);
            buildSalesScenariosDOM(goodsResult, matrixResult.evaluatedCosts, state.data.salesScenarios);
        } else {
            updateCostScenariosValues(goodsResult, matrixResult.evaluatedCosts);
            updateSalesScenariosValues(goodsResult, matrixResult.evaluatedCosts, state.data.salesScenarios);
        }

        // 6. Step 4: 3×3 매트릭스 렌더링
        renderCrossMatrix(matrixResult);

        // 7. Step 5: 선택 조합 상세 (워터폴 & BEP)
        renderSelectedComboDetail();

        // 8. 인쇄 메타데이터 동기화
        updatePrintMeta();
    }

    // ── Step 1 DOM 완전 빌드: 물품 대금 ──
    function buildGoodsTableDOM(goods, itemized = []) {
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
            const alloc = itemized[index] || { allocatedUnitCost: item.unitPrice, recommendedUnitPrice: item.unitPrice };
            const tr = document.createElement('tr');
            tr.dataset.idx = index;
            tr.innerHTML = `
                <td>
                    <input type="text" class="erp-input item-name" data-idx="${index}" value="${fmt.esc(item.name)}" placeholder="품목명">
                </td>
                <td>
                    <input type="text" class="erp-input item-spec" data-idx="${index}" value="${fmt.esc(item.spec)}" placeholder="규격/사양">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-qty" data-idx="${index}" value="${item.qty !== undefined ? item.qty : 0}" min="0">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-price" data-idx="${index}" value="${item.unitPrice !== undefined ? item.unitPrice : 0}" min="0" step="50">
                </td>
                <td class="text-right col-supply" style="font-weight: 700; color: #1e293b;">
                    ${fmt.num(item.supplyPrice)}
                </td>
                <td class="col-vat text-right col-vat-val" style="${showVat ? '' : 'display: none;'}; color: #64748b;">
                    ${fmt.num(item.vat)}
                </td>
                <td class="text-right col-recommended" style="background: #f8fbff; font-size: 11px;">
                    <span style="color: #64748b;">${fmt.num(alloc.allocatedUnitCost)}원</span>
                    <span style="color: #94a3b8; margin: 0 2px;">→</span>
                    <strong style="color: #1d4ed8; font-size: 12px;">${fmt.won(alloc.recommendedUnitPrice)}</strong>
                </td>
                <td class="text-center no-print">
                    <button type="button" class="btn-erp btn-sm btn-remove-item" data-idx="${index}" title="품목 삭제" style="padding: 2px 6px; color: #ef4444;">
                        <i class="bx bx-trash"></i>
                    </button>
                </td>
            `;
            els.tbodyGoods.appendChild(tr);
        });

        updateGoodsFooter(goods);
    }

    // ── Step 1 In-place 값만 업데이트 (포커스 유지 핵심!) ──
    function updateGoodsTableValues(goods, itemized = []) {
        if (!els.tbodyGoods) return;

        const rows = els.tbodyGoods.querySelectorAll('tr');
        goods.items.forEach((item, index) => {
            const tr = rows[index];
            if (!tr) return;

            const supplyTd = tr.querySelector('.col-supply');
            if (supplyTd) supplyTd.innerText = fmt.num(item.supplyPrice);

            const vatTd = tr.querySelector('.col-vat-val');
            if (vatTd) vatTd.innerText = fmt.num(item.vat);

            const recTd = tr.querySelector('.col-recommended');
            const alloc = itemized[index];
            if (recTd && alloc) {
                recTd.innerHTML = `
                    <span style="color: #64748b;">${fmt.num(alloc.allocatedUnitCost)}원</span>
                    <span style="color: #94a3b8; margin: 0 2px;">→</span>
                    <strong style="color: #1d4ed8; font-size: 12px;">${fmt.won(alloc.recommendedUnitPrice)}</strong>
                `;
            }
        });

        updateGoodsFooter(goods);
    }

    function updateGoodsFooter(goods) {
        if (els.sumGoodsQty) els.sumGoodsQty.innerText = `${fmt.num(goods.totalQty)}개`;
        if (els.avgGoodsPrice) els.avgGoodsPrice.innerText = fmt.won(goods.avgUnitGoodsPrice);
        if (els.sumGoodsSupply) els.sumGoodsSupply.innerText = fmt.won(goods.totalSupplyPrice);
        if (els.sumGoodsVat) els.sumGoodsVat.innerText = fmt.won(goods.totalVat);

        if (els.avgRecommendedPrice && state.calculated) {
            const { costIdx, salesIdx } = state.data.selectedCrossIndex;
            const cSc = state.calculated.matrix.evaluatedCosts[costIdx];
            const sSc = state.calculated.matrix.evaluatedSales[salesIdx];
            if (cSc && sSc) {
                els.avgRecommendedPrice.innerHTML = `<span style="color:#64748b; font-weight:600;">${fmt.num(cSc.unitCost)}원</span> → <strong>${fmt.won(sSc.targetPrice)}</strong>`;
            }
        }
    }

    // ── Step 2 상단: 부대비용 마스터 인라인 편집 테이블 빌드 ──
    function buildCostPoolTableDOM(goods) {
        if (!els.tbodyCostsPool) return;
        els.tbodyCostsPool.innerHTML = '';

        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;

        if (state.data.costsPool.length === 0) {
            els.tbodyCostsPool.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center" style="padding: 14px; color: #94a3b8;">
                        등록된 부대비용 항목이 없습니다. 우측 상단 <strong>[+ 부대비용 항목 추가]</strong> 버튼을 눌러 추가하세요.
                    </td>
                </tr>
            `;
        } else {
            state.data.costsPool.forEach((cost, idx) => {
                const unitAmt = Math.round((Number(cost.amount) || 0) / totalQty);
                const tr = document.createElement('tr');
                tr.dataset.costIdx = idx;
                tr.dataset.costId = cost.id;

                const catOptions = COST_CATEGORIES.map(c =>
                    `<option value="${c.value}" ${cost.category === c.value ? 'selected' : ''}>${c.label}</option>`
                ).join('');

                tr.innerHTML = `
                    <td>
                        <input type="text" class="erp-input cost-name-input" data-cost-idx="${idx}" value="${fmt.esc(cost.name)}" placeholder="비용 항목명 입력">
                    </td>
                    <td>
                        <select class="erp-input cost-cat-select" data-cost-idx="${idx}">
                            ${catOptions}
                        </select>
                    </td>
                    <td>
                        <select class="erp-input cost-fixed-select" data-cost-idx="${idx}" style="font-weight: 700; color: ${cost.isFixed ? '#d97706' : '#0284c7'};">
                            <option value="false" ${!cost.isFixed ? 'selected' : ''}>변동비 (수량비례)</option>
                            <option value="true" ${cost.isFixed ? 'selected' : ''}>고정비 (BEP 고정원가)</option>
                        </select>
                    </td>
                    <td>
                        <input type="number" class="erp-input text-right cost-amount-input" data-cost-idx="${idx}" value="${cost.amount !== undefined ? cost.amount : 0}" min="0" step="10000">
                    </td>
                    <td class="text-right cost-pool-unit-td" style="color: #475569; font-weight: 600;">
                        +${fmt.won(unitAmt)}/개
                    </td>
                    <td class="text-center no-print">
                        <button type="button" class="btn-erp btn-sm btn-apply-cost-all" data-cost-id="${cost.id}" title="시나리오 1·2·3 모두에 이 비용 체크 반영" style="padding: 2px 6px; font-size: 10.5px;">
                            전체반영
                        </button>
                    </td>
                    <td class="text-center no-print">
                        <button type="button" class="btn-erp btn-sm btn-remove-cost" data-cost-idx="${idx}" title="부대비용 항목 삭제" style="padding: 2px 6px; color: #ef4444;">
                            <i class="bx bx-trash"></i>
                        </button>
                    </td>
                `;
                els.tbodyCostsPool.appendChild(tr);
            });
        }

        updateCostPoolSummary(goods);
    }

    // ── Step 2 상단: 부대비용 마스터 인라인 값만 업데이트 (타이핑 중 포커스 유지!) ──
    function updateCostPoolTableValues(goods) {
        if (!els.tbodyCostsPool) return;
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const rows = els.tbodyCostsPool.querySelectorAll('tr[data-cost-idx]');

        state.data.costsPool.forEach((cost, idx) => {
            const tr = rows[idx];
            if (!tr) return;
            const unitTd = tr.querySelector('.cost-pool-unit-td');
            if (unitTd) {
                const unitAmt = Math.round((Number(cost.amount) || 0) / totalQty);
                unitTd.innerText = `+${fmt.won(unitAmt)}/개`;
            }
            const fixedSelect = tr.querySelector('.cost-fixed-select');
            if (fixedSelect) {
                fixedSelect.style.color = cost.isFixed ? '#d97706' : '#0284c7';
            }
        });

        updateCostPoolSummary(goods);
    }

    function updateCostPoolSummary(goods) {
        if (!els.dispCostPoolSummary) return;
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const totalPoolAmt = state.data.costsPool.reduce((acc, c) => acc + (Math.max(0, Number(c.amount) || 0)), 0);
        const fixedPoolAmt = state.data.costsPool.reduce((acc, c) => acc + (c.isFixed ? (Math.max(0, Number(c.amount) || 0)) : 0), 0);
        const unitPoolAmt = Math.round(totalPoolAmt / totalQty);

        els.dispCostPoolSummary.innerHTML = `
            등록 <strong>${state.data.costsPool.length}건</strong> ·
            전체 합계 <strong>${fmt.won(totalPoolAmt)}</strong> (개당 +${fmt.won(unitPoolAmt)} / 고정비 ${fmt.won(fixedPoolAmt)})
        `;
    }

    // ── Step 2 DOM 완전 빌드: 매입 원가 시나리오 1, 2, 3 ──
    function buildCostScenariosDOM(goods, evaluatedCosts) {
        if (!els.costScenariosContainer) return;
        els.costScenariosContainer.innerHTML = '';

        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const periodDays = Number(state.data.financing.periodDays) || 0;
        const annualRate = Number(state.data.financing.annualRatePct) || 0;

        evaluatedCosts.forEach((sc, scIdx) => {
            const rawSc = state.data.costScenarios[scIdx];
            const includedSet = new Set(rawSc.includedCostIds || []);

            const card = document.createElement('div');
            card.className = `sc-card ${scIdx === state.data.selectedCrossIndex.costIdx ? 'active' : ''}`;
            card.dataset.scIdx = scIdx;

            const costCheckboxesHtml = state.data.costsPool.length > 0
                ? state.data.costsPool.map(cost => {
                    const isChecked = includedSet.has(cost.id);
                    const unitAmt = Math.round((Number(cost.amount) || 0) / totalQty);
                    return `
                        <label class="sc-cost-checkbox" data-cost-id="${cost.id}" title="${cost.isFixed ? '고정비 (BEP 고정원가)' : '변동비 (수량비례)'} · 총 ${fmt.won(cost.amount)}">
                            <input type="checkbox" class="chk-cost-toggle" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" ${isChecked ? 'checked' : ''}>
                            <span class="sc-cost-name-text" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${fmt.esc(cost.name || '미지정 비용')} ${cost.isFixed ? '<small style="color:#d97706; font-weight:700;">(고정)</small>' : ''}
                            </span>
                            <strong class="cost-unit-amt" style="color: ${isChecked ? '#1e293b' : '#94a3b8'}; font-size: 11px;">+${fmt.won(unitAmt)}</strong>
                        </label>
                    `;
                }).join('')
                : `<div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 11px;">등록된 부대비용이 없습니다.</div>`;

            const estCapitalBase = goods.effectiveBase + sc.totalOverhead;
            const estFinInterest = Math.round(estCapitalBase * (annualRate / 100) * (periodDays / 365));
            const estUnitInterest = Math.round(estFinInterest / totalQty);
            const isFinChecked = rawSc.includeFinancing !== false;

            card.innerHTML = `
                <div class="sc-card-header" style="flex-direction: column; align-items: stretch;">
                    <input type="text" class="erp-input sc-name-input" data-sc-idx="${scIdx}" value="${fmt.esc(rawSc.name)}" style="font-weight: 700; width: 100%;">
                    <div style="font-size: 11px; color: var(--erp-text-muted); margin-top: 3px;">
                        ${fmt.esc(rawSc.desc || '')}
                    </div>
                </div>

                <div class="sc-card-body">
                    <div class="sc-price-row">
                        <span>기본 물품대:</span>
                        <strong class="sc-base-goods-val">${fmt.won(goods.avgUnitGoodsPrice)}/개</strong>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; margin: 8px 0 4px 0;">
                        <span style="font-size: 11px; font-weight: 700; color: #475569;">
                            반영 부대비용 선택 (<span class="sc-included-count">${sc.activeCosts.length}</span>/${state.data.costsPool.length}개):
                        </span>
                        <span class="no-print" style="display: inline-flex; gap: 3px;">
                            <button type="button" class="btn-erp btn-sm btn-sc-select-all" data-sc-idx="${scIdx}" style="height: 19px; font-size: 10px; padding: 0 5px;">전체선택</button>
                            <button type="button" class="btn-erp btn-sm btn-sc-clear-all" data-sc-idx="${scIdx}" style="height: 19px; font-size: 10px; padding: 0 5px;">해제</button>
                        </span>
                    </div>
                    <div class="sc-cost-list" style="max-height: 145px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; border: 1px solid #f1f5f9; padding: 4px; border-radius: 3px; background: #fafafa;">
                        ${costCheckboxesHtml}
                    </div>

                    <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed #e2e8f0;">
                        <label class="sc-cost-checkbox sc-fin-label" style="color: ${isFinChecked ? '#6b21a8' : '#64748b'}; font-weight: 700; background: ${isFinChecked ? 'var(--erp-purple-bg)' : '#f8fafc'}; border-color: ${isFinChecked ? '#ddd6fe' : '#e2e8f0'};">
                            <input type="checkbox" class="chk-financing-toggle" data-sc-idx="${scIdx}" ${isFinChecked ? 'checked' : ''}>
                            <span class="sc-fin-title" style="flex: 1;">금융이자 반영 (${periodDays}일 · ${annualRate}%)</span>
                            <strong class="sc-fin-amt">${isFinChecked ? `+${fmt.won(estUnitInterest)}` : `미반영 (${fmt.won(estUnitInterest)})`}</strong>
                        </label>
                    </div>

                    <div class="sc-total-box" style="margin-top: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; text-align: right;">
                        <div style="font-size: 10.5px; color: #64748b;">이 시나리오의 총 소요 매입원가</div>
                        <div style="font-size: 16px; font-weight: 800; color: #1e293b;" class="sc-unit-cost-text">
                            ${fmt.won(sc.unitCost)} <span style="font-size: 11px; font-weight: 500; color: #64748b;">/개</span>
                        </div>
                        <div style="font-size: 10.5px; color: #94a3b8;" class="sc-total-cost-text">(총 ${fmt.won(sc.totalCost)} · 부대+이자 ${fmt.won(sc.totalOverhead + sc.financingInterest)})</div>
                    </div>
                </div>
            `;

            els.costScenariosContainer.appendChild(card);
        });
    }

    // ── Step 2 In-place 값만 업데이트 ──
    function updateCostScenariosValues(goods, evaluatedCosts) {
        if (!els.costScenariosContainer) return;
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const periodDays = Number(state.data.financing.periodDays) || 0;
        const annualRate = Number(state.data.financing.annualRatePct) || 0;

        const cards = els.costScenariosContainer.querySelectorAll('.sc-card');
        evaluatedCosts.forEach((sc, scIdx) => {
            const card = cards[scIdx];
            if (!card) return;
            const rawSc = state.data.costScenarios[scIdx];
            const includedSet = new Set(rawSc.includedCostIds || []);

            // 기본 물품대
            const baseGoodsEl = card.querySelector('.sc-base-goods-val');
            if (baseGoodsEl) baseGoodsEl.innerText = `${fmt.won(goods.avgUnitGoodsPrice)}/개`;

            // 선택 개수 갱신
            const countEl = card.querySelector('.sc-included-count');
            if (countEl) countEl.innerText = sc.activeCosts.length;

            // 개별 부대비용 명칭·성격·단가 갱신
            state.data.costsPool.forEach(cost => {
                const label = card.querySelector(`.sc-cost-checkbox[data-cost-id="${cost.id}"]`);
                if (label) {
                    const isChecked = includedSet.has(cost.id);
                    const nameSpan = label.querySelector('.sc-cost-name-text');
                    if (nameSpan) {
                        nameSpan.innerHTML = `${fmt.esc(cost.name || '미지정 비용')} ${cost.isFixed ? '<small style="color:#d97706; font-weight:700;">(고정)</small>' : ''}`;
                    }
                    const unitAmtEl = label.querySelector('.cost-unit-amt');
                    if (unitAmtEl) {
                        unitAmtEl.innerText = `+${fmt.won(Math.round((Number(cost.amount) || 0) / totalQty))}`;
                        unitAmtEl.style.color = isChecked ? '#1e293b' : '#94a3b8';
                    }
                }
            });

            // 금융이자 단가 및 활성 스타일 갱신
            const estCapitalBase = goods.effectiveBase + sc.totalOverhead;
            const estFinInterest = Math.round(estCapitalBase * (annualRate / 100) * (periodDays / 365));
            const estUnitInterest = Math.round(estFinInterest / totalQty);
            const isFinChecked = rawSc.includeFinancing !== false;

            const finLabel = card.querySelector('.sc-fin-label');
            if (finLabel) {
                finLabel.style.color = isFinChecked ? '#6b21a8' : '#64748b';
                finLabel.style.background = isFinChecked ? 'var(--erp-purple-bg)' : '#f8fafc';
                finLabel.style.borderColor = isFinChecked ? '#ddd6fe' : '#e2e8f0';
            }
            const finTitleEl = card.querySelector('.sc-fin-title');
            if (finTitleEl) finTitleEl.innerText = `금융이자 반영 (${periodDays}일 · ${annualRate}%)`;

            const finAmtEl = card.querySelector('.sc-fin-amt');
            if (finAmtEl) {
                finAmtEl.innerText = isFinChecked ? `+${fmt.won(estUnitInterest)}` : `미반영 (${fmt.won(estUnitInterest)})`;
            }

            // 총원가 갱신
            const unitCostEl = card.querySelector('.sc-unit-cost-text');
            if (unitCostEl) unitCostEl.innerHTML = `${fmt.won(sc.unitCost)} <span style="font-size: 11px; font-weight: 500; color: #64748b;">/개</span>`;

            const totalCostEl = card.querySelector('.sc-total-cost-text');
            if (totalCostEl) totalCostEl.innerText = `(총 ${fmt.won(sc.totalCost)} · 부대+이자 ${fmt.won(sc.totalOverhead + sc.financingInterest)})`;
        });
    }

    // ── Step 3 DOM 완전 빌드: 판매가 시나리오 1, 2, 3 ──
    function buildSalesScenariosDOM(goods, evaluatedCosts, salesScenarios) {
        if (!els.salesScenariosContainer) return;
        els.salesScenariosContainer.innerHTML = '';

        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const { sc: benchSc, shortLabel } = getBenchmarkCostScenario(evaluatedCosts);
        const benchmarkUnitCost = benchSc.unitCost || 0;

        salesScenarios.forEach((sSc, sIdx) => {
            const card = document.createElement('div');
            card.className = `sales-card ${sIdx === state.data.selectedCrossIndex.salesIdx ? 'active' : ''}`;
            card.dataset.sIdx = sIdx;

            const totalRev = Math.round(sSc.targetPrice * totalQty);
            const totalProf = totalRev - (benchSc.totalCost || 0);
            const marginAmt = sSc.targetPrice - benchmarkUnitCost;
            const marginRate = totalRev > 0 ? ((totalProf / totalRev) * 100).toFixed(1) : '0.0';
            const markupRate = benchSc.totalCost > 0 ? ((totalProf / benchSc.totalCost) * 100).toFixed(1) : '0.0';

            card.innerHTML = `
                <div class="sales-card-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <input type="text" class="erp-input sales-name-input" data-s-idx="${sIdx}" value="${fmt.esc(sSc.name)}" style="font-weight: 700; width: 65%;">
                    <span style="font-size: 10.5px; color: #64748b;">${fmt.esc(sSc.memo || '')}</span>
                </div>

                <div class="sales-card-body">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                        <span style="font-size: 11px; font-weight: 700; color: #475569;">목표 판매단가(평균):</span>
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                            <input type="number" class="erp-input text-right sales-price-input" data-s-idx="${sIdx}" value="${sSc.targetPrice}" step="50" min="0" style="width: 120px; font-weight: 800; font-size: 14px; color: var(--erp-primary);">
                            <span style="font-size: 12px; font-weight: 700;">원</span>
                        </div>
                    </div>

                    <div class="no-print" style="font-size: 10.5px; color: #64748b; margin-bottom: 4px;">
                        목표 마진율 기준 판매가 역산 (<span class="sales-bench-label">${shortLabel}</span> 기준):
                    </div>
                    <div class="no-print" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-bottom: 8px;">
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="12" title="마진 12% 역산">12%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="15" title="마진 15% 역산">15%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="20" title="마진 20% 역산">20%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="25" title="마진 25% 역산">25%</button>
                        <button type="button" class="btn-erp btn-sm btn-reverse-calc" data-s-idx="${sIdx}" data-margin="30" title="마진 30% 역산">30%</button>
                        <div style="display: inline-flex; align-items: center; gap: 2px; margin-left: auto;">
                            <input type="number" class="erp-input text-right custom-margin-input" data-s-idx="${sIdx}" placeholder="직접%" step="0.5" min="-50" max="95" style="width: 56px; height: 22px; font-size: 11px; padding: 1px 4px;">
                            <button type="button" class="btn-erp btn-sm btn-custom-reverse" data-s-idx="${sIdx}" title="직접 입력한 마진율(%)로 판매단가 역산">역산</button>
                        </div>
                    </div>

                    <div style="font-size: 11px; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; display: flex; flex-direction: column; gap: 3px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: #64748b;" class="sales-bench-title">${shortLabel} 대비 개당마진:</span>
                            <strong class="sales-benchmark-margin" style="color: ${Number(marginRate) >= 18 ? '#047857' : Number(marginRate) >= 10 ? '#d97706' : '#dc2626'};">
                                ${fmt.won(marginAmt)} (${marginRate}%)
                            </strong>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #64748b;">
                            <span>예상 총매출: <strong class="sales-total-rev" style="color:#334155;">${fmt.won(totalRev)}</strong></span>
                            <span>원가대비 마크업: <strong class="sales-markup-rate">${markupRate}%</strong></span>
                        </div>
                    </div>
                </div>
            `;

            els.salesScenariosContainer.appendChild(card);
        });
    }

    // ── Step 3 In-place 값만 업데이트 ──
    function updateSalesScenariosValues(goods, evaluatedCosts, salesScenarios) {
        if (!els.salesScenariosContainer) return;
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const { sc: benchSc, shortLabel } = getBenchmarkCostScenario(evaluatedCosts);
        const benchmarkUnitCost = benchSc.unitCost || 0;

        const cards = els.salesScenariosContainer.querySelectorAll('.sales-card');
        salesScenarios.forEach((sSc, sIdx) => {
            const card = cards[sIdx];
            if (!card) return;

            const totalRev = Math.round(sSc.targetPrice * totalQty);
            const totalProf = totalRev - (benchSc.totalCost || 0);
            const marginAmt = sSc.targetPrice - benchmarkUnitCost;
            const marginRate = totalRev > 0 ? ((totalProf / totalRev) * 100).toFixed(1) : '0.0';
            const markupRate = benchSc.totalCost > 0 ? ((totalProf / benchSc.totalCost) * 100).toFixed(1) : '0.0';

            const benchLabelEl = card.querySelector('.sales-bench-label');
            if (benchLabelEl) benchLabelEl.innerText = shortLabel;

            const benchTitleEl = card.querySelector('.sales-bench-title');
            if (benchTitleEl) benchTitleEl.innerText = `${shortLabel} 대비 개당마진:`;

            const marginEl = card.querySelector('.sales-benchmark-margin');
            if (marginEl) {
                marginEl.innerText = `${fmt.won(marginAmt)} (${marginRate}%)`;
                marginEl.style.color = Number(marginRate) >= 18 ? '#047857' : Number(marginRate) >= 10 ? '#d97706' : '#dc2626';
            }

            const revEl = card.querySelector('.sales-total-rev');
            if (revEl) revEl.innerText = fmt.won(totalRev);

            const markupEl = card.querySelector('.sales-markup-rate');
            if (markupEl) markupEl.innerText = `${markupRate}%`;
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
                    <div style="font-size: 12px; font-weight: 800;">${fmt.esc(sSc.name)}</div>
                    <div style="font-size: 13px; font-weight: 700; color: #38bdf8;">${fmt.won(sSc.targetPrice)}/개</div>
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

            bodyHtml += `
                <td style="background: ${isSelectedRow ? '#eff6ff' : '#f8fafc'}; border-right: 2px solid #cbd5e1;">
                    <div style="font-weight: 800; font-size: 12px; color: #1e293b;">${fmt.esc(cSc.name)}</div>
                    <div style="font-size: 11px; color: #64748b; margin-top: 2px;">
                        개당 원가: <strong style="font-size: 13px; color: #0f172a;">${fmt.won(cSc.unitCost)}</strong>
                    </div>
                    <div style="font-size: 10px; color: #94a3b8;">
                        (물품대 ${fmt.num(cSc.unitGoodsCost)} + 부대·이자 ${fmt.num(cSc.unitOverhead + cSc.unitFinancing)})
                    </div>
                </td>
            `;

            row.cells.forEach((cell, salesIdx) => {
                const isSelectedCell = (costIdx === state.data.selectedCrossIndex.costIdx && salesIdx === state.data.selectedCrossIndex.salesIdx);

                let badgeClass = 'badge-healthy';
                let badgeText = '안전 마진';
                let marginColor = '#047857';

                if (cell.isDanger) {
                    badgeClass = 'badge-danger';
                    badgeText = cell.marginAmount < 0 ? '적자 (역마진)' : '마진 위험';
                    marginColor = '#dc2626';
                } else if (cell.isWarning) {
                    badgeClass = 'badge-warning';
                    badgeText = '적정 주의';
                    marginColor = '#d97706';
                }

                let bepText = '';
                if (cell.bepStatus === 'impossible') {
                    bepText = `<span style="color:#dc2626; font-weight:700;">달성 불가 (역마진)</span>`;
                } else if (cell.bepStatus === 'immediate') {
                    bepText = `1개 이상 (고정비 없음)`;
                } else {
                    bepText = `${fmt.num(cell.bepUnits)}개 (고정비 ${fmt.num(cell.fixedCosts)}원)`;
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
                            예상 총영업익: <strong style="color: ${cell.totalProfit < 0 ? '#dc2626' : '#0f172a'};">${fmt.won(cell.totalProfit)}</strong>
                        </div>
                        <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">
                            BEP 최소수량: ${bepText}
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
        const cell = state.calculated.matrix.matrix[costIdx]?.cells[salesIdx];

        if (!cSc || !sSc || !cell) return;

        // 타이틀 표시
        els.dispSelectedComboTitle.innerText = `${cSc.name} (원가 ${fmt.won(cSc.unitCost)}) × ${sSc.name} (판가 ${fmt.won(sSc.targetPrice)})`;

        // 1. BEP 메트릭 렌더링
        const totalQty = cSc.totalQty || 1;
        const unitContribution = cell.unitContribution;
        const contributionRate = sSc.targetPrice > 0 ? ((unitContribution / sSc.targetPrice) * 100).toFixed(1) : '0.0';

        if (els.dispUnitVariableCost) {
            els.dispUnitVariableCost.innerText = fmt.won(cSc.unitVariableCost);
        }
        if (els.dispUnitContribution) {
            els.dispUnitContribution.innerText = fmt.won(unitContribution);
            els.dispUnitContribution.style.color = unitContribution > 0 ? 'var(--erp-primary)' : '#dc2626';
        }
        if (els.dispFixedCosts) {
            els.dispFixedCosts.innerText = fmt.won(cSc.fixedCosts);
        }

        if (els.dispBepUnits && els.dispBepRevenue) {
            if (cell.bepStatus === 'impossible') {
                els.dispBepUnits.innerText = '달성 불가 (역마진)';
                els.dispBepUnits.style.color = '#dc2626';
                els.dispBepRevenue.innerText = '산출 불가 (판가 ≤ 변동비)';
                els.dispBepRevenue.style.color = '#dc2626';
            } else if (cell.bepStatus === 'immediate') {
                els.dispBepUnits.innerText = '1개 이상 (즉시 흑자)';
                els.dispBepUnits.style.color = '#047857';
                els.dispBepRevenue.innerText = fmt.won(sSc.targetPrice);
                els.dispBepRevenue.style.color = '#0f172a';
            } else {
                const pctOfOrder = ((cell.bepUnits / totalQty) * 100).toFixed(1);
                els.dispBepUnits.innerText = `${fmt.num(cell.bepUnits)}개 이상 (수주량의 ${pctOfOrder}%)`;
                els.dispBepUnits.style.color = cell.bepUnits > totalQty ? '#d97706' : '#0f172a';
                els.dispBepRevenue.innerText = fmt.won(cell.bepUnits * sSc.targetPrice);
                els.dispBepRevenue.style.color = '#0f172a';
            }
        }

        if (els.dispContributionRate) {
            els.dispContributionRate.innerText = `${contributionRate}%`;
            els.dispContributionRate.style.color = Number(contributionRate) > 0 ? '#047857' : '#dc2626';
        }

        // 2. 워터폴 브릿지 SVG 렌더링
        renderWaterfallSvg(cSc, sSc.targetPrice);
    }

    // ── 워터폴 브릿지 SVG 차트 렌더링 (적자/음수 구간 완벽 대응) ──
    function renderWaterfallSvg(cSc, targetPrice) {
        if (!els.waterfallSvgContainer) return;
        const steps = SalesMarginEngine.generateWaterfallData(cSc, targetPrice);

        const width = Math.max(els.waterfallSvgContainer.clientWidth || 620, 420);
        const height = 195;
        const margin = { top: 24, right: 24, bottom: 38, left: 48 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        // 각 막대의 시작값(from)과 종료값(to) 사전 계산
        let running = 0;
        let highestVal = Math.max(targetPrice, cSc.unitCost, 100);
        let lowestVal = 0;

        const barGeoms = steps.map(st => {
            let fromVal = 0;
            let toVal = 0;
            if (st.type === 'start') {
                fromVal = 0;
                toVal = st.amount;
                running = st.amount;
            } else if (st.type === 'drop') {
                fromVal = running;
                toVal = running - st.amount;
                running = toVal;
            } else if (st.type === 'end') {
                fromVal = 0;
                toVal = st.amount;
            }
            highestVal = Math.max(highestVal, fromVal, toVal);
            lowestVal = Math.min(lowestVal, fromVal, toVal);
            return { ...st, fromVal, toVal };
        });

        const domainMax = highestVal * 1.12;
        const domainMin = lowestVal < 0 ? lowestVal * 1.2 : 0;
        const domainSpan = Math.max(domainMax - domainMin, 1);

        const valToY = val => margin.top + Math.round(((domainMax - val) / domainSpan) * plotHeight);
        const zeroY = valToY(0);

        const barWidth = Math.min(50, Math.floor(plotWidth / (steps.length * 1.45)));
        const colGap = Math.floor(plotWidth / steps.length);

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
                    <linearGradient id="wfRedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#ef4444" />
                        <stop offset="100%" stop-color="#b91c1c" />
                    </linearGradient>
                </defs>
                <!-- 0원 기준선 -->
                <line x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="${lowestVal < 0 ? '3,3' : 'none'}" />
                <text x="${margin.left - 6}" y="${zeroY + 3}" text-anchor="end" font-size="9.5" fill="#64748b">0</text>
        `;

        barGeoms.forEach((st, idx) => {
            const x = margin.left + (idx * colGap) + Math.floor((colGap - barWidth) / 2);
            const y1 = valToY(st.fromVal);
            const y2 = valToY(st.toVal);
            const barY = Math.min(y1, y2);
            const barH = Math.max(3, Math.abs(y2 - y1));

            let fill = st.color;
            if (st.type === 'start') fill = 'url(#wfBlueGrad)';
            else if (st.type === 'end') fill = st.amount >= 0 ? 'url(#wfGreenGrad)' : 'url(#wfRedGrad)';

            // 이전 막대와 연결선(Connector Line) 표시
            if (idx > 0 && st.type !== 'end') {
                const prevX = margin.left + ((idx - 1) * colGap) + Math.floor((colGap - barWidth) / 2) + barWidth;
                svgContent += `
                    <line x1="${prevX}" y1="${y1}" x2="${x}" y2="${y1}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,2" />
                `;
            }

            const labelText = st.type === 'drop' ? `-${fmt.num(st.amount)}` : fmt.num(st.amount);
            const textY = (st.type === 'end' && st.amount < 0) ? Math.min(height - 22, barY + barH + 11) : Math.max(12, barY - 5);
            const textColor = (st.type === 'end' && st.amount < 0) ? '#dc2626' : '#1e293b';

            svgContent += `
                <rect x="${x}" y="${barY}" width="${barWidth}" height="${barH}" rx="3" fill="${fill}" />
                <text x="${x + barWidth / 2}" y="${textY}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${textColor}">
                    ${labelText}
                </text>
                <text x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#475569" font-weight="600">
                    ${fmt.esc(st.label)}
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
        const itemized = state.calculated.itemized || [];
        const { costIdx, salesIdx } = state.data.selectedCrossIndex;
        const selectedCell = matrix.matrix[costIdx]?.cells[salesIdx] || matrix.matrix[0].cells[0];

        let maxMarginCell = null;
        let minMarginCell = null;

        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                if (!maxMarginCell || c.marginRate > maxMarginCell.marginRate) maxMarginCell = c;
                if (!minMarginCell || c.marginRate < minMarginCell.marginRate) minMarginCell = c;
            });
        });

        const itemLines = itemized.map((it, i) =>
            `   ${i + 1}) ${it.name || '품목'} (${it.spec || '-'}) : 수량 ${fmt.num(it.qty)}개 / 매입단가 ${fmt.won(it.unitPrice)} → 선택조합 배부원가 ${fmt.won(it.allocatedUnitCost)} / 권장 납품단가 ${fmt.won(it.recommendedUnitPrice)}`
        ).join('\n');

        let bepDesc = '';
        if (selectedCell.bepStatus === 'impossible') {
            bepDesc = '달성 불가 (현재 판매단가가 개당 변동비 이하인 역마진 구간으로 판가 상향 필수)';
        } else if (selectedCell.bepStatus === 'immediate') {
            bepDesc = '1개 이상 수주 시 즉시 흑자 달성 (반영 고정비 없음)';
        } else {
            bepDesc = `${fmt.num(selectedCell.bepUnits)}개 이상 수주 시 흑자 전환 (반영 고정비 ${fmt.won(selectedCell.fixedCosts)} / 최소매출 ${fmt.won(selectedCell.bepUnits * selectedCell.targetPrice)})`;
        }

        const text = `[기안문] ${title}

1. 검토 목적 및 개요
 - 본 검토는 ${title} 건에 대하여 매입 원가 3대 시나리오와 판매가 3대 시나리오를 교차 분석(총 9가지 경우의 수)하여, 적정 수주 가능 단가 및 한계 손익을 사전 확정하고자 함.

2. 기본 매입 현황 및 선택 조합 기준 품목별 권장 납품단가
 - 총 매입수량: ${fmt.num(goods.totalQty)}개 / 총 공급가액: ${fmt.won(goods.totalSupplyPrice)} (가중평균 매입단가 ${fmt.won(goods.avgUnitGoodsPrice)})
 - 부가세(VAT 10%) 원가 산입 여부: ${state.data.includeVat ? '포함 산정' : '미포함(공급가액 기준)'}
 - 운전자본 금융이자율: 연 ${state.data.financing.annualRatePct}% (자금회수기간 ${state.data.financing.periodDays}일 기준)
 - 품목별 상세 내역 (${selectedCell.costScenarioName} × ${selectedCell.salesScenarioName} 적용 시):
${itemLines}

3. 3×3 시나리오 교차 분석 (9가지 경우의 수 요약)
 - [최대 이익 시나리오] ${maxMarginCell.costScenarioName} × ${maxMarginCell.salesScenarioName}
   : 평균 판가 ${fmt.won(maxMarginCell.targetPrice)} / 개당 마진 ${fmt.won(maxMarginCell.marginAmount)} (마진율 ${maxMarginCell.marginRate}%) / 총 영업이익 ${fmt.won(maxMarginCell.totalProfit)}
 - [최저/보수 시나리오] ${minMarginCell.costScenarioName} × ${minMarginCell.salesScenarioName}
   : 평균 판가 ${fmt.won(minMarginCell.targetPrice)} / 개당 마진 ${fmt.won(minMarginCell.marginAmount)} (마진율 ${minMarginCell.marginRate}%) / 총 영업이익 ${fmt.won(minMarginCell.totalProfit)}

4. [선택/권장안] ${selectedCell.costScenarioName} × ${selectedCell.salesScenarioName}
 - 목표 평균 판매단가: ${fmt.won(selectedCell.targetPrice)} (예상 총매출액 ${fmt.won(selectedCell.totalRevenue)})
 - 개당 총 소요원가: ${fmt.won(selectedCell.unitCost)} (예상 총원가 ${fmt.won(selectedCell.totalCost)})
 - 개당 영업마진: ${fmt.won(selectedCell.marginAmount)} (마진율 ${selectedCell.marginRate}% / 원가대비 마크업 ${selectedCell.markupRate}%)
 - 총 예상 수주 영업이익: ${fmt.won(selectedCell.totalProfit)}
 - 손익분기점(BEP): ${bepDesc}

5. 종합 검토 의견
 - 본 건은 [${selectedCell.salesScenarioName}] 이상으로 수주를 추진할 것을 권고하며, 원가 리스크 방어를 위해 부대비용 및 자금회수기일(${state.data.financing.periodDays}일) 준수 관리가 요구됨.`;

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
                recalculateAll({ rebuildGoods: true, rebuildCostPool: false, rebuildScenarios: false });
                showToast(`부가세 원가 산입: ${state.data.includeVat ? '포함(10%)' : '미포함(공급가액)'}`);
            });
        }

        // 금융이자 일수 및 연이율 변경 (In-place 값 업데이트)
        if (els.inputPeriodDays) {
            els.inputPeriodDays.addEventListener('input', e => {
                state.data.financing.periodDays = Math.max(0, Number(e.target.value) || 0);
                recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
            });
        }
        if (els.inputAnnualRate) {
            els.inputAnnualRate.addEventListener('input', e => {
                state.data.financing.annualRatePct = Math.max(0, Number(e.target.value) || 0);
                recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
            });
        }

        // 매입 품목 추가
        if (els.btnAddGoodsRow) {
            els.btnAddGoodsRow.addEventListener('click', () => {
                state.data.items.push({
                    id: fmt.uid('item'),
                    name: '',
                    spec: '',
                    qty: 1000,
                    unitPrice: 2000
                });
                recalculateAll({ rebuildGoods: true, rebuildCostPool: false, rebuildScenarios: false });
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
                    state.data.items[idx].qty = target.value === '' ? 0 : Number(target.value);
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                } else if (target.classList.contains('item-price')) {
                    state.data.items[idx].unitPrice = target.value === '' ? 0 : Number(target.value);
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
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
                recalculateAll({ rebuildGoods: true, rebuildCostPool: false, rebuildScenarios: false });
            });
        }

        // Step 2: 부대비용 편집표 접기/펼치기
        if (els.btnToggleCostPool && els.costPoolEditorWrap) {
            els.btnToggleCostPool.addEventListener('click', () => {
                els.costPoolEditorWrap.classList.toggle('collapsed');
            });
        }

        // Step 2: 부대비용 항목 신규 추가 버튼 (인라인 행 즉시 추가 및 포커스)
        if (els.btnAddCostItem) {
            els.btnAddCostItem.addEventListener('click', () => {
                if (els.costPoolEditorWrap) {
                    els.costPoolEditorWrap.classList.remove('collapsed');
                }
                const newCostId = fmt.uid('cost');
                state.data.costsPool.push({
                    id: newCostId,
                    name: '신규 부대비용 항목',
                    category: 'etc',
                    amount: 200000,
                    isFixed: false
                });

                // 기본으로 시나리오 2, 3에 반영
                if (state.data.costScenarios[1]) {
                    state.data.costScenarios[1].includedCostIds.push(newCostId);
                }
                if (state.data.costScenarios[2]) {
                    state.data.costScenarios[2].includedCostIds.push(newCostId);
                }

                recalculateAll({ rebuildGoods: false, rebuildCostPool: true, rebuildScenarios: true });

                // 새로 추가된 행의 항목명 인풋에 즉시 포커스 & 선택
                if (els.tbodyCostsPool) {
                    const inputs = els.tbodyCostsPool.querySelectorAll('.cost-name-input');
                    const lastInput = inputs[inputs.length - 1];
                    if (lastInput) {
                        lastInput.focus();
                        lastInput.select();
                    }
                }
                showToast('새 부대비용 항목이 추가되었습니다. 금액과 분류를 바로 수정하세요.', 'success');
            });
        }

        // Step 2 상단: 부대비용 마스터 인라인 테이블 이벤트 (포커스 소실 없는 실시간 업데이트)
        if (els.tbodyCostsPool) {
            els.tbodyCostsPool.addEventListener('input', e => {
                const target = e.target;
                const idx = Number(target.dataset.costIdx);
                if (isNaN(idx) || !state.data.costsPool[idx]) return;

                if (target.classList.contains('cost-name-input')) {
                    state.data.costsPool[idx].name = target.value;
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                } else if (target.classList.contains('cost-amount-input')) {
                    state.data.costsPool[idx].amount = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                }
            });

            els.tbodyCostsPool.addEventListener('change', e => {
                const target = e.target;
                const idx = Number(target.dataset.costIdx);
                if (isNaN(idx) || !state.data.costsPool[idx]) return;

                if (target.classList.contains('cost-cat-select')) {
                    state.data.costsPool[idx].category = target.value;
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                } else if (target.classList.contains('cost-fixed-select')) {
                    state.data.costsPool[idx].isFixed = target.value === 'true';
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                }
            });

            els.tbodyCostsPool.addEventListener('click', e => {
                const applyAllBtn = e.target.closest('.btn-apply-cost-all');
                if (applyAllBtn) {
                    const costId = applyAllBtn.dataset.costId;
                    state.data.costScenarios.forEach(sc => {
                        const set = new Set(sc.includedCostIds || []);
                        set.add(costId);
                        sc.includedCostIds = Array.from(set);
                    });
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: true });
                    showToast('해당 비용을 시나리오 1·2·3 모두에 반영했습니다.');
                    return;
                }

                const removeBtn = e.target.closest('.btn-remove-cost');
                if (removeBtn) {
                    const idx = Number(removeBtn.dataset.costIdx);
                    const removed = state.data.costsPool[idx];
                    if (!removed) return;
                    state.data.costsPool.splice(idx, 1);
                    state.data.costScenarios.forEach(sc => {
                        sc.includedCostIds = (sc.includedCostIds || []).filter(id => id !== removed.id);
                    });
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: true, rebuildScenarios: true });
                    showToast(`'${removed.name}' 항목이 삭제되었습니다.`);
                }
            });
        }

        // Step 2: 매입 시나리오 카드 이벤트 (비용 체크박스, 금융이자 토글, 전체선택/해제, 명칭 변경)
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
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                } else if (target.classList.contains('chk-financing-toggle')) {
                    sc.includeFinancing = target.checked;
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                }
            });

            els.costScenariosContainer.addEventListener('click', e => {
                const selectAllBtn = e.target.closest('.btn-sc-select-all');
                if (selectAllBtn) {
                    const scIdx = Number(selectAllBtn.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].includedCostIds = state.data.costsPool.map(c => c.id);
                        recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: true });
                    }
                    return;
                }

                const clearAllBtn = e.target.closest('.btn-sc-clear-all');
                if (clearAllBtn) {
                    const scIdx = Number(clearAllBtn.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].includedCostIds = [];
                        recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: true });
                    }
                }
            });

            els.costScenariosContainer.addEventListener('input', e => {
                const target = e.target;
                const scIdx = Number(target.dataset.scIdx);
                if (target.classList.contains('sc-name-input') && state.data.costScenarios[scIdx]) {
                    state.data.costScenarios[scIdx].name = target.value;
                    state.calculated.matrix.evaluatedCosts[scIdx].name = target.value;
                    renderCrossMatrix(state.calculated.matrix);
                    renderSelectedComboDetail();
                }
            });
        }

        // Step 3: 역산 및 마진비교 기준원가 선택 변경
        if (els.selectBenchmarkCost) {
            els.selectBenchmarkCost.addEventListener('change', e => {
                state.data.benchmarkCostMode = e.target.value;
                recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
            });
        }

        // Step 3: 판매가 시나리오 카드 이벤트 (판가 입력, 명칭 변경, 마진역산 버튼 & 커스텀 마진 역산)
        if (els.salesScenariosContainer) {
            els.salesScenariosContainer.addEventListener('input', e => {
                const target = e.target;
                const sIdx = Number(target.dataset.sIdx);
                if (isNaN(sIdx) || !state.data.salesScenarios[sIdx]) return;

                if (target.classList.contains('sales-price-input')) {
                    state.data.salesScenarios[sIdx].targetPrice = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
                } else if (target.classList.contains('sales-name-input')) {
                    state.data.salesScenarios[sIdx].name = target.value;
                    state.calculated.matrix.evaluatedSales[sIdx].name = target.value;
                    renderCrossMatrix(state.calculated.matrix);
                    renderSelectedComboDetail();
                }
            });

            els.salesScenariosContainer.addEventListener('click', e => {
                const presetBtn = e.target.closest('.btn-reverse-calc');
                if (presetBtn) {
                    const sIdx = Number(presetBtn.dataset.sIdx);
                    const targetMargin = Number(presetBtn.dataset.margin) || 20;
                    applyReverseMarginToSalesScenario(sIdx, targetMargin, presetBtn.closest('.sales-card'));
                    return;
                }

                const customBtn = e.target.closest('.btn-custom-reverse');
                if (customBtn) {
                    const sIdx = Number(customBtn.dataset.sIdx);
                    const card = customBtn.closest('.sales-card');
                    const input = card ? card.querySelector('.custom-margin-input') : null;
                    if (!input || input.value === '') {
                        showToast('역산할 목표 마진율(%)을 입력하세요.', 'warning');
                        if (input) input.focus();
                        return;
                    }
                    const targetMargin = Number(input.value);
                    if (isNaN(targetMargin) || targetMargin >= 100) {
                        showToast('마진율은 100% 미만의 숫자로 입력해 주세요.', 'warning');
                        return;
                    }
                    applyReverseMarginToSalesScenario(sIdx, targetMargin, card);
                }
            });

            els.salesScenariosContainer.addEventListener('keydown', e => {
                if (e.key === 'Enter' && e.target.classList.contains('custom-margin-input')) {
                    e.preventDefault();
                    const sIdx = Number(e.target.dataset.sIdx);
                    const card = e.target.closest('.sales-card');
                    const targetMargin = Number(e.target.value);
                    if (!isNaN(targetMargin) && e.target.value !== '' && targetMargin < 100) {
                        applyReverseMarginToSalesScenario(sIdx, targetMargin, card);
                    }
                }
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

                recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });

                // 카드 활성 테두리 갱신
                if (els.costScenariosContainer) {
                    els.costScenariosContainer.querySelectorAll('.sc-card').forEach((c, i) => {
                        c.classList.toggle('active', i === costIdx);
                    });
                }
                if (els.salesScenariosContainer) {
                    els.salesScenariosContainer.querySelectorAll('.sales-card').forEach((c, i) => {
                        c.classList.toggle('active', i === salesIdx);
                    });
                }

                showToast(`매입 시나리오 ${costIdx + 1} × 판매 시나리오 ${String.fromCharCode(65 + salesIdx)} 조합이 선택되었습니다.`);
            });
        }

        // Step 6: 종합의견 텍스트 수동 입력 시 상태 동기화 및 자동작성 버튼
        if (els.textRemarks) {
            els.textRemarks.addEventListener('input', e => {
                state.data.remarks = e.target.value;
            });
        }

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
                if (els.textRemarks && !els.textRemarks.value.trim()) {
                    const autoText = generateRemarksText();
                    els.textRemarks.value = autoText;
                    state.data.remarks = autoText;
                }
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
                if (els.textRemarks && !els.textRemarks.value.trim()) {
                    const autoText = generateRemarksText();
                    els.textRemarks.value = autoText;
                    state.data.remarks = autoText;
                }
                updatePrintMeta();
                window.print();
            });
        }

        // 상단 액션 툴바: 새로 작성
        if (els.btnNewDoc) {
            els.btnNewDoc.addEventListener('click', () => {
                if (!confirm('새 문서를 작성하시겠습니까? 현재 작성 중인 내용은 초기화됩니다.')) return;
                state.docId = null;
                state.data = {
                    docTitle: '신규 원가·마진 시뮬레이션',
                    includeVat: false,
                    benchmarkCostMode: '1',
                    items: [
                        { id: fmt.uid('item'), name: '', spec: '', qty: 1000, unitPrice: 0 }
                    ],
                    costsPool: [
                        { id: 'cost_1', name: '화물 운송비', category: 'logistics', amount: 0, isFixed: false },
                        { id: 'cost_2', name: '창고 보관·임대료', category: 'rent', amount: 0, isFixed: true }
                    ],
                    financing: { periodDays: 60, annualRatePct: 5.0 },
                    costScenarios: [
                        { id: 'c1', name: '시나리오 1: 최소 매입원가', desc: '기본 물품대', includedCostIds: [], includeFinancing: false },
                        { id: 'c2', name: '시나리오 2: 표준 실무원가', desc: '물품대 + 운송비 + 금융이자', includedCostIds: ['cost_1'], includeFinancing: true },
                        { id: 'c3', name: '시나리오 3: 풀부담 보수원가', desc: '전체 비용 반영', includedCostIds: ['cost_1', 'cost_2'], includeFinancing: true }
                    ],
                    salesScenarios: [
                        { id: 's1', name: '시나리오 A: 도매 최저가', targetPrice: 0, memo: '대리점/도매가' },
                        { id: 's2', name: '시나리오 B: 본사 표준목표가', targetPrice: 0, memo: '표준 납품가' },
                        { id: 's3', name: '시나리오 C: 권장 소비자가', targetPrice: 0, memo: '소매/특판가' }
                    ],
                    selectedCrossIndex: { costIdx: 1, salesIdx: 1 },
                    remarks: ''
                };
                syncGlobalInputsFromState();
                recalculateAll({ rebuildGoods: true, rebuildCostPool: true, rebuildScenarios: true });
                showToast('새 문서 양식이 준비되었습니다.');
            });
        }

        // 상단 액션 툴바: 샘플 복원
        if (els.btnLoadSample) {
            els.btnLoadSample.addEventListener('click', () => {
                if (!confirm('실무 샘플 데이터를 다시 불러오시겠습니까?')) return;
                state.docId = null;
                state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
                syncGlobalInputsFromState();
                recalculateAll({ rebuildGoods: true, rebuildCostPool: true, rebuildScenarios: true });
                const autoText = generateRemarksText();
                if (els.textRemarks) {
                    els.textRemarks.value = autoText;
                    state.data.remarks = autoText;
                }
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

        // 단축키 (F8 저장, Ctrl+S 저장, Escape 모달 닫기)
        window.addEventListener('keydown', e => {
            if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
                e.preventDefault();
                saveCurrentDoc();
            } else if (e.key === 'Escape' && els.savedModalOverlay && els.savedModalOverlay.classList.contains('active')) {
                closeArchiveModal();
            }
        });

        // 윈도우 리사이즈 시 워터폴 재렌더링
        window.addEventListener('resize', () => {
            if (state.calculated) {
                renderSelectedComboDetail();
            }
        });
    }

    function applyReverseMarginToSalesScenario(sIdx, targetMargin, cardEl) {
        if (!state.calculated || !state.data.salesScenarios[sIdx]) return;
        const { sc: benchSc, shortLabel } = getBenchmarkCostScenario(state.calculated.matrix.evaluatedCosts);
        const benchmarkUnitCost = benchSc.unitCost || 0;
        const reversePrice = SalesMarginEngine.calculateReversePrice(benchmarkUnitCost, targetMargin);

        state.data.salesScenarios[sIdx].targetPrice = reversePrice;

        if (cardEl) {
            const priceInput = cardEl.querySelector('.sales-price-input');
            if (priceInput) priceInput.value = reversePrice;
        }

        recalculateAll({ rebuildGoods: false, rebuildCostPool: false, rebuildScenarios: false });
        showToast(`시나리오 ${String.fromCharCode(65 + sIdx)} 판가가 ${shortLabel}(${fmt.won(benchmarkUnitCost)}) 대비 마진 ${targetMargin}% 기준(${fmt.won(reversePrice)})으로 역산되었습니다.`);
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
            if (els.textRemarks) {
                state.data.remarks = els.textRemarks.value;
            }
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
                const avgPrice = item.data.items
                    ? Math.round(item.data.items.reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.unitPrice) || 0)), 0) / (item.data.items.reduce((s, it) => s + (Number(it.qty) || 0), 0) || 1))
                    : 0;

                tr.innerHTML = `
                    <td><strong>${fmt.esc(item.title)}</strong></td>
                    <td class="text-center" style="color: #64748b;">${fmt.esc(item.savedAtFormatted)}</td>
                    <td class="text-right">${fmt.won(avgPrice)}</td>
                    <td class="text-center">
                        <button type="button" class="btn-erp btn-sm btn-load-saved" data-id="${item.id}" style="padding: 2px 6px;">열기</button>
                        <button type="button" class="btn-erp btn-sm btn-delete-saved" data-id="${item.id}" style="padding: 2px 6px; color: #ef4444; margin-left: 4px;">삭제</button>
                    </td>
                `;
                els.tbodySavedDocs.appendChild(tr);
            });

            els.tbodySavedDocs.querySelectorAll('.btn-load-saved').forEach(b => {
                b.addEventListener('click', () => {
                    const id = b.dataset.id;
                    const found = archive.find(a => a.id === id);
                    if (found) {
                        state.data = JSON.parse(JSON.stringify(found.data));
                        state.docId = found.id;
                        syncGlobalInputsFromState();
                        recalculateAll({ rebuildGoods: true, rebuildCostPool: true, rebuildScenarios: true });
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
                    if (state.docId === id) state.docId = null;
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

    // ── 9. CSV 엑셀 내보내기 (전 항목 포함) ──
    function exportToCsv() {
        if (!state.calculated) return;
        const title = (state.data.docTitle || 'Sales_Simulator').replace(/[\s/\\:]+/g, '_');
        const matrix = state.calculated.matrix;
        const goods = state.calculated.goods;
        const itemized = state.calculated.itemized || [];

        let csv = '\uFEFF';
        csv += `[K&G 원가·마진 시뮬레이션 보고서 - 내부검토용]\r\n`;
        csv += `검토 건명,"${(state.data.docTitle || '').replace(/"/g, '""')}"\r\n`;
        csv += `검토 일자,${new Date().toISOString().split('T')[0]}\r\n`;
        csv += `부가세 원가 산입,${state.data.includeVat ? '포함(10%)' : '미포함(공급가액 기준)'}\r\n`;
        csv += `금융이자 조건,회수기간 ${state.data.financing.periodDays}일 / 연 ${state.data.financing.annualRatePct}%\r\n\r\n`;

        csv += `[1. 물품 대금 매입 내역 및 선택조합 권장 납품단가]\r\n`;
        csv += `품목명,규격,수량,매입단가,공급가액,부가세,선택조합 배부원가,선택조합 권장판가\r\n`;
        goods.items.forEach((it, idx) => {
            const alloc = itemized[idx] || { allocatedUnitCost: it.unitPrice, recommendedUnitPrice: it.unitPrice };
            csv += `"${(it.name || '').replace(/"/g, '""')}","${(it.spec || '').replace(/"/g, '""')}",${it.qty},${it.unitPrice},${it.supplyPrice},${it.vat},${alloc.allocatedUnitCost},${alloc.recommendedUnitPrice}\r\n`;
        });
        csv += `합계/평균,,${goods.totalQty},${goods.avgUnitGoodsPrice},${goods.totalSupplyPrice},${goods.totalVat},,\r\n\r\n`;

        csv += `[2. 부대비용 마스터 내역]\r\n`;
        csv += `항목명,분류,비용성격,총 소요금액(원),개당 부담액(원)\r\n`;
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        state.data.costsPool.forEach(c => {
            const catLabel = (COST_CATEGORIES.find(cat => cat.value === c.category) || { label: '기타' }).label;
            csv += `"${(c.name || '').replace(/"/g, '""')}",${catLabel},${c.isFixed ? '고정비' : '변동비'},${c.amount},${Math.round((Number(c.amount) || 0) / totalQty)}\r\n`;
        });
        csv += `\r\n`;

        csv += `[3. 매입 시나리오별 원가 구성]\r\n`;
        csv += `매입 시나리오명,기본 물품대(개당),부대비용(개당),금융이자(개당),개당 총원가,총 소요원가 합계,고정비 합계,변동비 합계\r\n`;
        matrix.evaluatedCosts.forEach(cSc => {
            csv += `"${(cSc.name || '').replace(/"/g, '""')}",${cSc.unitGoodsCost},${cSc.unitOverhead},${cSc.unitFinancing},${cSc.unitCost},${cSc.totalCost},${cSc.fixedCosts},${cSc.variableCosts}\r\n`;
        });
        csv += `\r\n`;

        csv += `[4. 3×3 시나리오 교차 분석 매트릭스 (9가지 조합)]\r\n`;
        csv += `매입 시나리오,개당 원가,판매 시나리오,목표 판매단가,개당 마진,마진율(%),원가대비 마크업(%),총 예상 매출액,총 예상 영업이익,BEP 최소수량\r\n`;
        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                const bepStr = c.bepStatus === 'impossible' ? '달성불가(역마진)' : (c.bepStatus === 'immediate' ? '1(즉시흑자)' : c.bepUnits);
                csv += `"${(c.costScenarioName || '').replace(/"/g, '""')}",${c.unitCost},"${(c.salesScenarioName || '').replace(/"/g, '""')}",${c.targetPrice},${c.marginAmount},${c.marginRate}%,${c.markupRate}%,${c.totalRevenue},${c.totalProfit},${bepStr}\r\n`;
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
        syncGlobalInputsFromState();
        bindEvents();
        recalculateAll({ rebuildGoods: true, rebuildCostPool: true, rebuildScenarios: true });

        // 초기 기안문 자동 세팅
        if (els.textRemarks && !state.data.remarks) {
            const initialRemarks = generateRemarksText();
            els.textRemarks.value = initialRemarks;
            state.data.remarks = initialRemarks;
        }
    });

})();
