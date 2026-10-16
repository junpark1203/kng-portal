/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이터 v2.0 애플리케이션 컨트롤러
 * (Sales Cost & Margin Simulator Application Controller)
 * ══════════════════════════════════════════════════════════════
 * - Step 1: 프로젝트 공통 조건(사업기간·결제여신일·연이자율) + 물품 매입 및
 *           포장단위(EA/BOX, BOX/PLT, 개별중량 kg) 기반 출고 박스/파레트/중량 자동 산출
 * - Step 2: 매입 원가 시나리오 (최소 1개 ~ 최대 5개 가변)
 *           산출기준(1회고정비 / 월기간비 / EA비례 / BOX비례 / PLT비례 / 변동총액) 자동 연동 +
 *           통합 비교 시트에서 시나리오별 체크(ON/OFF) 및 개별 금액·이자일수 직접 오버라이드 지원
 * - Step 3: 판매가 시나리오 (최소 1개 ~ 최대 5개 가변)
 *           명칭 자유 입력 + 드롭다운 없이 카드 내 전 매입시나리오 동시 마진 비교 &
 *           매입 시나리오별 개별 판가 지정 / 목표 마진율 역산 지원
 * - Step 4: 매입(M) × 판매(N) 경우의 수 교차 분석 매트릭스 (최대 5×5 = 25가지 조합)
 * - Step 5: 전체 조합 심층 분석 전수 펼침 (모든 조합의 워터폴 SVG + BEP + 품목별 권장단가)
 * - Step 6: 종합 검토 의견 기안문 자동생성, 클립보드 복사, 엑셀(CSV), 보관함 모달, A4 인쇄
 */

import { SalesMarginEngine } from './margin-engine.js';

(function () {
    'use strict';

    // ── 1. 상수 및 스토리지 키 ──
    const STORAGE_KEY_ARCHIVE = 'kng_sales_sim_archive_v2';
    const MIN_SCENARIOS = 1;
    const MAX_SCENARIOS = 5;

    const COST_CATEGORIES = [
        { value: 'logistics', label: '물류·운송비' },
        { value: 'rent', label: '임대·창고료' },
        { value: 'packaging', label: '포장·라벨비' },
        { value: 'labor', label: '작업·인건비' },
        { value: 'fee', label: '수수료·보험' },
        { value: 'etc', label: '기타부대비' }
    ];

    const COST_CALC_TYPES = [
        { value: 'fixed_once', label: '1회 고정비 (총액 고정 · BEP고정)', isFixed: true, unitLabel: '원(1회)' },
        { value: 'period_month', label: '월 기간비 (×사업개월 · BEP고정)', isFixed: true, unitLabel: '원/월' },
        { value: 'per_ea', label: '수량 비례 (×총 EA · 변동비)', isFixed: false, unitLabel: '원/EA' },
        { value: 'per_box', label: '박스 비례 (×총 BOX · 변동비)', isFixed: false, unitLabel: '원/BOX' },
        { value: 'per_plt', label: '파레트 비례 (×총 PLT · 변동비)', isFixed: false, unitLabel: '원/PLT' },
        { value: 'var_total', label: '변동비 총액 직접입력 (변동비)', isFixed: false, unitLabel: '원(총액)' }
    ];

    // ── 2. 기본 시드 데이터 (실무 권장 샘플) ──
    const DEFAULT_SEED_DATA = {
        docTitle: '2026 하반기 안전보호구 납품 원가·마진·물류 타당성 검토',
        includeVat: false,
        projectMeta: {
            projectDays: 60,     // 사업(보관)기간 60일 (= 2.0개월)
            creditDays: 0,       // 납품 후 결제여신 추가일
            annualRatePct: 5.0   // 연 이자율 5.0%
        },
        items: [
            {
                id: 'item_1',
                name: '형광 4포켓 메쉬 안전조끼',
                spec: 'Woven 형광노랑 L~3XL',
                qty: 2000,
                unitPrice: 4800,
                unitWeightKg: 0.25,
                eaPerBox: 50,
                boxPerPlt: 20
            },
            {
                id: 'item_2',
                name: 'ABS 통기형 산업용 안전모',
                spec: '백색 4점식 턱끈',
                qty: 500,
                unitPrice: 6500,
                unitWeightKg: 0.42,
                eaPerBox: 25,
                boxPerPlt: 10
            },
            {
                id: 'item_3',
                name: 'PU 코팅 정밀 안전장갑',
                spec: '그레이 13게이지',
                qty: 3000,
                unitPrice: 850,
                unitWeightKg: 0.06,
                eaPerBox: 100,
                boxPerPlt: 30
            }
        ],
        costsPool: [
            {
                id: 'cost_1',
                name: '물류센터 왕복 화물 운송료',
                category: 'logistics',
                calcType: 'fixed_once',
                unitRate: 350000
            },
            {
                id: 'cost_2',
                name: '임시 보관 창고 임대·보관료',
                category: 'rent',
                calcType: 'period_month',
                unitRate: 250000 // 월 25만원 × 2.0개월(60일) = 기본 50만원
            },
            {
                id: 'cost_3',
                name: '회사 로고 라벨 부착 및 검수비',
                category: 'packaging',
                calcType: 'per_ea',
                unitRate: 50 // 개당 50원 × 5,500개 = 기본 275,000원
            },
            {
                id: 'cost_4',
                name: '출고 카톤박스 포장·파레트 작업비',
                category: 'packaging',
                calcType: 'per_box',
                unitRate: 1800 // 박스당 1,800원 × 90박스 = 기본 162,000원
            }
        ],
        costScenarios: [
            {
                id: 'c1',
                name: '매입 1: 직납 최소원가',
                desc: '기본 물품대 + 필수 화물운송비만 반영',
                includedCostIds: ['cost_1'],
                costOverrides: {},
                includeFinancing: false,
                financingDaysOverride: ''
            },
            {
                id: 'c2',
                name: '매입 2: 표준 실무원가',
                desc: '물품대 + 운송·라벨·박스작업 + 60일 이자',
                includedCostIds: ['cost_1', 'cost_3', 'cost_4'],
                costOverrides: {},
                includeFinancing: true,
                financingDaysOverride: ''
            },
            {
                id: 'c3',
                name: '매입 3: 장기보관 보수원가',
                desc: '전 항목 반영 + 독차증액(45만) + 90일 이자',
                includedCostIds: ['cost_1', 'cost_2', 'cost_3', 'cost_4'],
                costOverrides: { cost_1: 450000 },
                includeFinancing: true,
                financingDaysOverride: 90
            }
        ],
        salesScenarios: [
            {
                id: 's1',
                name: '판매 A: 대리점 공급가',
                memo: '대량 도매/유통 채널',
                targetPrice: 3350,
                priceOverrides: {}
            },
            {
                id: 's2',
                name: '판매 B: 본사 표준납품가',
                memo: '건설·산업체 직납 기준',
                targetPrice: 3800,
                priceOverrides: {}
            },
            {
                id: 's3',
                name: '판매 C: 특판/소매 권장가',
                memo: '온라인·소량 발주처 기준',
                targetPrice: 4400,
                priceOverrides: {}
            }
        ],
        selectedCrossIndex: {
            costIdx: 1,
            salesIdx: 1
        },
        deepDiveFilter: 'all',
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

        // Step 1: 공통 프로젝트 조건 & 물품/물류
        els.chkIncludeVat = document.getElementById('chkIncludeVat');
        els.btnAddGoodsRow = document.getElementById('btnAddGoodsRow');
        els.inputProjectDays = document.getElementById('inputProjectDays');
        els.dispProjectMonths = document.getElementById('dispProjectMonths');
        els.inputCreditDays = document.getElementById('inputCreditDays');
        els.dispDefaultFinDays = document.getElementById('dispDefaultFinDays');
        els.inputAnnualRate = document.getElementById('inputAnnualRate');

        els.tbodyGoods = document.getElementById('tbodyGoods');
        els.sumGoodsQty = document.getElementById('sumGoodsQty');
        els.avgGoodsPrice = document.getElementById('avgGoodsPrice');
        els.sumGoodsSupply = document.getElementById('sumGoodsSupply');
        els.sumGoodsVat = document.getElementById('sumGoodsVat');
        els.sumTotalWeight = document.getElementById('sumTotalWeight');
        els.sumTotalBoxes = document.getElementById('sumTotalBoxes');
        els.sumTotalPlts = document.getElementById('sumTotalPlts');
        els.avgRecommendedPrice = document.getElementById('avgRecommendedPrice');
        els.logisticsSummaryBar = document.getElementById('logisticsSummaryBar');

        // Step 2: 통합 매입 원가 시나리오 비교 & 오버라이드 테이블
        els.dispCostScCount = document.getElementById('dispCostScCount');
        els.btnAddCostItem = document.getElementById('btnAddCostItem');
        els.btnAddCostScenario = document.getElementById('btnAddCostScenario');
        els.tableCostScenarioMatrix = document.getElementById('tableCostScenarioMatrix');
        els.theadCostScenarioMatrix = document.getElementById('theadCostScenarioMatrix');
        els.tbodyCostScenarioMatrix = document.getElementById('tbodyCostScenarioMatrix');
        els.tfootCostScenarioMatrix = document.getElementById('tfootCostScenarioMatrix');

        // Step 3: 판매가 시나리오
        els.dispSalesScCount = document.getElementById('dispSalesScCount');
        els.btnAddSalesScenario = document.getElementById('btnAddSalesScenario');
        els.salesScenariosContainer = document.getElementById('salesScenariosContainer');

        // Step 4: M×N 교차 분석 매트릭스
        els.dispMatrixDimTitle = document.getElementById('dispMatrixDimTitle');
        els.tableCrossMatrix = document.getElementById('tableCrossMatrix');
        els.trMatrixHeader = document.getElementById('trMatrixHeader');
        els.tbodyCrossMatrix = document.getElementById('tbodyCrossMatrix');

        // Step 5: 전 조합 심층 분석
        els.dispAllDeepDiveCount = document.getElementById('dispAllDeepDiveCount');
        els.selectDeepDiveFilter = document.getElementById('selectDeepDiveFilter');
        els.allCombosDeepDiveContainer = document.getElementById('allCombosDeepDiveContainer');

        // Step 6: 종합 검토의견 기안문
        els.btnAutoRemarks = document.getElementById('btnAutoRemarks');
        els.textRemarks = document.getElementById('textRemarks');

        // 인쇄 헤더
        els.printProjectTitle = document.getElementById('printProjectTitle');
        els.printDate = document.getElementById('printDate');
        els.printPeriodMeta = document.getElementById('printPeriodMeta');
        els.printMatrixMeta = document.getElementById('printMatrixMeta');

        // 보관함 모달
        els.savedModalOverlay = document.getElementById('savedModalOverlay');
        els.btnCloseSavedModal = document.getElementById('btnCloseSavedModal');
        els.tbodySavedDocs = document.getElementById('tbodySavedDocs');
    }

    // ── 5. 유틸리티 & 구버전 문서 마이그레이션 ──
    const fmt = {
        num: n => Math.round(Number(n) || 0).toLocaleString('ko-KR'),
        dec: (n, d = 1) => Number(Number(n) || 0).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: d }),
        won: n => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`,
        pct: (n, d = 1) => `${(Number(n) || 0).toFixed(d)}%`,
        uid: (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        esc: str => String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        alphaCode: idx => String.fromCharCode(65 + idx)
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
        }, 2300);
    }

    /**
     * 구버전(v1) 저장 데이터를 v2 데이터 구조로 안전하게 정규화
     */
    function normalizeLoadedData(raw) {
        const d = JSON.parse(JSON.stringify(raw || DEFAULT_SEED_DATA));

        if (!d.projectMeta) {
            const legacyDays = d.financing?.periodDays ?? 60;
            const legacyRate = d.financing?.annualRatePct ?? 5.0;
            d.projectMeta = {
                projectDays: legacyDays,
                creditDays: 0,
                annualRatePct: legacyRate
            };
        }

        if (!Array.isArray(d.items) || d.items.length === 0) {
            d.items = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA.items));
        } else {
            d.items = d.items.map(it => ({
                id: it.id || fmt.uid('item'),
                name: it.name ?? '',
                spec: it.spec ?? '',
                qty: Number(it.qty ?? 0),
                unitPrice: Number(it.unitPrice ?? 0),
                unitWeightKg: Number(it.unitWeightKg ?? 0.2),
                eaPerBox: Number(it.eaPerBox ?? 50),
                boxPerPlt: Number(it.boxPerPlt ?? 20)
            }));
        }

        if (!Array.isArray(d.costsPool)) {
            d.costsPool = [];
        } else {
            d.costsPool = d.costsPool.map(c => ({
                id: c.id || fmt.uid('cost'),
                name: c.name ?? '부대비용',
                category: c.category || 'etc',
                calcType: c.calcType || (c.isFixed ? 'fixed_once' : 'var_total'),
                unitRate: c.unitRate !== undefined ? Number(c.unitRate) : Number(c.amount || 0)
            }));
        }

        if (!Array.isArray(d.costScenarios) || d.costScenarios.length === 0) {
            d.costScenarios = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA.costScenarios));
        } else {
            d.costScenarios = d.costScenarios.slice(0, MAX_SCENARIOS).map(sc => ({
                id: sc.id || fmt.uid('c'),
                name: sc.name || '매입 시나리오',
                desc: sc.desc || '',
                includedCostIds: Array.isArray(sc.includedCostIds) ? sc.includedCostIds : [],
                costOverrides: sc.costOverrides || {},
                includeFinancing: sc.includeFinancing !== false,
                financingDaysOverride: sc.financingDaysOverride ?? ''
            }));
        }

        if (!Array.isArray(d.salesScenarios) || d.salesScenarios.length === 0) {
            d.salesScenarios = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA.salesScenarios));
        } else {
            d.salesScenarios = d.salesScenarios.slice(0, MAX_SCENARIOS).map(s => ({
                id: s.id || fmt.uid('s'),
                name: s.name || '판매 시나리오',
                memo: s.memo || '',
                targetPrice: Number(s.targetPrice || 0),
                priceOverrides: s.priceOverrides || {}
            }));
        }

        if (!d.selectedCrossIndex) {
            d.selectedCrossIndex = { costIdx: 0, salesIdx: 0 };
        }
        clampSelectedCrossIndex(d);

        if (!d.deepDiveFilter) d.deepDiveFilter = 'all';
        return d;
    }

    function clampSelectedCrossIndex(d = state.data) {
        const maxC = Math.max(0, (d.costScenarios?.length || 1) - 1);
        const maxS = Math.max(0, (d.salesScenarios?.length || 1) - 1);
        if (d.selectedCrossIndex.costIdx > maxC) d.selectedCrossIndex.costIdx = maxC;
        if (d.selectedCrossIndex.costIdx < 0) d.selectedCrossIndex.costIdx = 0;
        if (d.selectedCrossIndex.salesIdx > maxS) d.selectedCrossIndex.salesIdx = maxS;
        if (d.selectedCrossIndex.salesIdx < 0) d.selectedCrossIndex.salesIdx = 0;
    }

    function syncGlobalInputsFromState() {
        state.data = normalizeLoadedData(state.data);
        const pm = state.data.projectMeta;

        if (els.inputDocTitle) els.inputDocTitle.value = state.data.docTitle || '';
        if (els.chkIncludeVat) els.chkIncludeVat.checked = !!state.data.includeVat;
        if (els.inputProjectDays) els.inputProjectDays.value = pm.projectDays ?? 60;
        if (els.inputCreditDays) els.inputCreditDays.value = pm.creditDays ?? 0;
        if (els.inputAnnualRate) els.inputAnnualRate.value = pm.annualRatePct ?? 5.0;
        if (els.textRemarks) els.textRemarks.value = state.data.remarks || '';

        updateProjectMetaBadges();
    }

    function updateProjectMetaBadges() {
        const pm = state.data.projectMeta;
        const pDays = Math.max(0, Number(pm.projectDays) || 0);
        const cDays = Math.max(0, Number(pm.creditDays) || 0);
        const months = (pDays / 30).toFixed(1);
        const totalFinDays = pDays + cDays;

        if (els.dispProjectMonths) {
            els.dispProjectMonths.innerText = `(= ${months}개월 · 창고/월기간비 연동)`;
        }
        if (els.dispDefaultFinDays) {
            els.dispDefaultFinDays.innerText = `${totalFinDays}일`;
        }
    }

    // ── 6. 데이터 계산 및 렌더링 파이프라인 ──
    /**
     * @param {Object} options
     * @param {boolean} options.rebuildGoods - Step 1 물품 테이블 DOM 완전 재빌드 여부
     * @param {boolean} options.rebuildCostMatrix - Step 2 매입 시나리오 비교시트 DOM 완전 재빌드 여부
     * @param {boolean} options.rebuildSalesCards - Step 3 판매 시나리오 카드 DOM 완전 재빌드 여부
     */
    function recalculateAll({ rebuildGoods = false, rebuildCostMatrix = false, rebuildSalesCards = false } = {}) {
        clampSelectedCrossIndex();
        updateProjectMetaBadges();

        // 1. 물품대 및 물류·포장 규격 산출
        const goodsResult = SalesMarginEngine.calculateGoodsCost(state.data.items, state.data.includeVat);

        // 2. M×N 교차 분석 매트릭스 산출
        const matrixResult = SalesMarginEngine.calculateCrossMatrix(
            goodsResult,
            state.data.costsPool,
            state.data.costScenarios,
            state.data.salesScenarios,
            state.data.projectMeta
        );

        // 대표(선택) 조합의 품목별 배부원가 및 권장판가
        const { costIdx, salesIdx } = state.data.selectedCrossIndex;
        const activeCell = matrixResult.matrix[costIdx]?.cells[salesIdx] || matrixResult.matrix[0]?.cells[0];
        const itemizedAllocation = activeCell ? activeCell.itemized : [];

        state.calculated = {
            goods: goodsResult,
            matrix: matrixResult,
            itemized: itemizedAllocation,
            activeCell
        };

        // 3. Step 1 렌더링 (포커스 유지를 위한 In-place 업데이트 지원)
        if (rebuildGoods) {
            buildGoodsTableDOM(goodsResult, itemizedAllocation);
        } else {
            updateGoodsTableValues(goodsResult, itemizedAllocation);
        }
        renderLogisticsSummaryBar(goodsResult);

        // 4. Step 2: 통합 매입 원가 시나리오 비교 시트 렌더링
        if (rebuildCostMatrix) {
            buildCostScenarioMatrixDOM(goodsResult, matrixResult.evaluatedCosts);
        } else {
            updateCostScenarioMatrixValues(goodsResult, matrixResult.evaluatedCosts);
        }

        // 5. Step 3: 판매가 시나리오 카드 렌더링
        if (rebuildSalesCards) {
            buildSalesScenariosDOM(goodsResult, matrixResult);
        } else {
            updateSalesScenariosValues(goodsResult, matrixResult);
        }

        // 6. Step 4: M×N 교차 분석표 렌더링
        renderCrossMatrix(matrixResult);

        // 7. Step 5: 전 조합 심층 분석 (모두 펼침) 렌더링
        syncDeepDiveFilterOptions(matrixResult.evaluatedCosts);
        renderAllCombosDeepDive(matrixResult);

        // 8. 인쇄 메타데이터 동기화
        updatePrintMeta();
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 1: 물품 매입 & 포장단위(EA/BOX, BOX/PLT, 중량) 렌더링
    // ══════════════════════════════════════════════════════════════
    function buildGoodsTableDOM(goods, itemized = []) {
        if (!els.tbodyGoods) return;
        els.tbodyGoods.innerHTML = '';

        const showVat = state.data.includeVat;
        document.querySelectorAll('.col-vat').forEach(el => {
            el.style.display = showVat ? '' : 'none';
        });
        if (els.chkIncludeVat) els.chkIncludeVat.checked = showVat;

        goods.items.forEach((item, index) => {
            const alloc = itemized[index] || { allocatedUnitCost: item.unitPrice, recommendedUnitPrice: item.unitPrice };
            const isHeavyBox = item.boxWeightKg >= 20;

            const tr = document.createElement('tr');
            tr.dataset.idx = index;
            tr.innerHTML = `
                <td>
                    <input type="text" class="erp-input item-name" data-idx="${index}" value="${fmt.esc(item.name)}" placeholder="품목명 입력">
                </td>
                <td>
                    <input type="text" class="erp-input item-spec" data-idx="${index}" value="${fmt.esc(item.spec)}" placeholder="규격/사양">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-qty" data-idx="${index}" value="${item.qty}" min="0" step="10">
                </td>
                <td>
                    <input type="number" class="erp-input text-right item-price" data-idx="${index}" value="${item.unitPrice}" min="0" step="50">
                </td>
                <td class="text-right col-supply" style="font-weight: 700; color: #1e293b;">
                    ${fmt.num(item.supplyPrice)}
                </td>
                <td class="col-vat text-right col-vat-val" style="${showVat ? '' : 'display: none;'}; color: #64748b;">
                    ${fmt.num(item.vat)}
                </td>
                <td style="background: #fafffc;">
                    <input type="number" class="erp-input text-right item-weight" data-idx="${index}" value="${item.unitWeightKg}" min="0" step="0.05" title="개당 중량(kg)">
                    <div class="pkg-calc-caption item-total-weight-cap" style="margin-top: 2px; background: #f8fafc; color: #475569; border-color: #e2e8f0;">
                        <span>총중량</span>
                        <strong>${fmt.dec(item.itemTotalWeightKg, 1)}kg</strong>
                    </div>
                </td>
                <td style="background: #fafffc;">
                    <div style="display: flex; align-items: center; gap: 3px;">
                        <input type="number" class="erp-input text-right item-eabox" data-idx="${index}" value="${item.eaPerBox}" min="1" step="5" title="1박스당 입수량(EA/BOX)">
                        <span style="font-size: 10px; color: #64748b; white-space: nowrap;">EA/곽</span>
                    </div>
                    <div class="pkg-calc-caption item-box-cap ${isHeavyBox ? 'heavy-warn' : ''}">
                        <span>${fmt.num(item.boxCount)} BOX</span>
                        <strong>${fmt.dec(item.boxWeightKg, 1)}kg/곽</strong>
                    </div>
                </td>
                <td style="background: #fafffc;">
                    <div style="display: flex; align-items: center; gap: 3px;">
                        <input type="number" class="erp-input text-right item-boxplt" data-idx="${index}" value="${item.boxPerPlt}" min="1" step="5" title="1파레트당 적재 박스수(BOX/PLT)">
                        <span style="font-size: 10px; color: #64748b; white-space: nowrap;">BOX/P</span>
                    </div>
                    <div class="pkg-calc-caption item-plt-cap">
                        <span>${fmt.num(item.pltCount)} PLT</span>
                        <strong>${fmt.dec(item.pltWeightKg, 0)}kg/P</strong>
                    </div>
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

            const weightCap = tr.querySelector('.item-total-weight-cap');
            if (weightCap) {
                weightCap.innerHTML = `<span>총중량</span><strong>${fmt.dec(item.itemTotalWeightKg, 1)}kg</strong>`;
            }

            const boxCap = tr.querySelector('.item-box-cap');
            if (boxCap) {
                const isHeavyBox = item.boxWeightKg >= 20;
                boxCap.classList.toggle('heavy-warn', isHeavyBox);
                boxCap.innerHTML = `<span>${fmt.num(item.boxCount)} BOX</span><strong>${fmt.dec(item.boxWeightKg, 1)}kg/곽</strong>`;
            }

            const pltCap = tr.querySelector('.item-plt-cap');
            if (pltCap) {
                pltCap.innerHTML = `<span>${fmt.num(item.pltCount)} PLT</span><strong>${fmt.dec(item.pltWeightKg, 0)}kg/P</strong>`;
            }

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
        if (els.sumGoodsQty) els.sumGoodsQty.innerText = `${fmt.num(goods.totalQty)} EA`;
        if (els.avgGoodsPrice) els.avgGoodsPrice.innerText = fmt.won(goods.avgUnitGoodsPrice);
        if (els.sumGoodsSupply) els.sumGoodsSupply.innerText = fmt.won(goods.totalSupplyPrice);
        if (els.sumGoodsVat) els.sumGoodsVat.innerText = fmt.won(goods.totalVat);
        if (els.sumTotalWeight) els.sumTotalWeight.innerText = `${fmt.dec(goods.totalWeightKg, 1)} kg (${goods.totalWeightTon}t)`;
        if (els.sumTotalBoxes) els.sumTotalBoxes.innerText = `총 ${fmt.num(goods.totalBoxes)} BOX (평균 ${fmt.dec(goods.avgBoxWeightKg, 1)}kg)`;
        if (els.sumTotalPlts) els.sumTotalPlts.innerText = `총 ${fmt.num(goods.totalPlts)} PLT (평균 ${fmt.dec(goods.avgPltWeightKg, 0)}kg)`;

        if (els.avgRecommendedPrice && state.calculated?.activeCell) {
            const cell = state.calculated.activeCell;
            els.avgRecommendedPrice.innerHTML = `
                <span style="font-size:10px; color:#475569;">[${cell.comboCode}]</span>
                <span style="color:#64748b; font-weight:600;">${fmt.num(cell.unitCost)}원</span> →
                <strong>${fmt.won(cell.targetPrice)}</strong>
            `;
        }
    }

    function renderLogisticsSummaryBar(goods) {
        if (!els.logisticsSummaryBar) return;
        const pm = state.data.projectMeta;
        const pDays = Math.max(0, Number(pm.projectDays) || 0);
        const months = (pDays / 30).toFixed(1);

        els.logisticsSummaryBar.innerHTML = `
            <div class="logistics-metrics-wrap">
                <span class="logi-metric-pill">
                    <i class="bx bx-package" style="color:#15803d; font-size:15px;"></i>
                    <span>출고 물류 자동 집계:</span>
                </span>
                <span class="logi-metric-pill">총 수량 <strong>${fmt.num(goods.totalQty)} EA</strong></span>
                <span style="color:#cbd5e1;">|</span>
                <span class="logi-metric-pill">포장① 총 박스 <strong>${fmt.num(goods.totalBoxes)} BOX</strong> <small style="color:#64748b;">(박스당 평균 ${fmt.dec(goods.avgBoxWeightKg, 1)}kg)</small></span>
                <span style="color:#cbd5e1;">|</span>
                <span class="logi-metric-pill">포장② 총 파레트 <strong>${fmt.num(goods.totalPlts)} PLT</strong> <small style="color:#64748b;">(PLT당 평균 ${fmt.dec(goods.avgPltWeightKg, 0)}kg)</small></span>
                <span style="color:#cbd5e1;">|</span>
                <span class="logi-metric-pill">총 출고중량 <strong>${fmt.dec(goods.totalWeightKg, 1)} kg (${goods.totalWeightTon} ton)</strong></span>
            </div>
            <div style="font-size: 11px; color: #0369a1; font-weight: 600;">
                <i class="bx bx-link"></i> 아래 2번 부대비용의 <strong>[×EA / ×BOX / ×PLT / ×${months}개월]</strong> 산출식에 실시간 자동 연동됨
            </div>
        `;
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 2: 통합 매입 원가 시나리오 비교 & 오버라이드 시트 (1~5개 가변)
    // ══════════════════════════════════════════════════════════════
    function buildCostScenarioMatrixDOM(goods, evaluatedCosts) {
        if (!els.theadCostScenarioMatrix || !els.tbodyCostScenarioMatrix || !els.tfootCostScenarioMatrix) return;

        const scCount = state.data.costScenarios.length;
        if (els.dispCostScCount) els.dispCostScCount.innerText = scCount;

        // 1. THEAD 빌드
        let theadHtml = `
            <tr>
                <th style="width: 17%; text-align: left; padding-left: 10px;">부대비용 항목명 / 분류</th>
                <th style="width: 16%;">비용 성격 &amp; 산출 기준 (연동 공식)</th>
                <th style="width: 13%;">기준 단가 → 기본 총액</th>
        `;

        evaluatedCosts.forEach((sc, scIdx) => {
            const rawSc = state.data.costScenarios[scIdx];
            const isSelected = scIdx === state.data.selectedCrossIndex.costIdx;
            const canDelete = scCount > MIN_SCENARIOS;

            theadHtml += `
                <th class="cost-sc-th ${isSelected ? 'active-sc' : ''}" data-sc-idx="${scIdx}">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 4px; margin-bottom: 4px;">
                        <span style="background: #38bdf8; color: #0f172a; font-size: 10px; font-weight: 800; padding: 1px 6px; border-radius: 2px;">
                            매입 시나리오 ${scIdx + 1}
                        </span>
                        <div class="no-print" style="display: inline-flex; gap: 3px; align-items: center;">
                            <button type="button" class="btn-erp btn-xs btn-sc-select-all" data-sc-idx="${scIdx}" title="모든 부대비용 체크">전체선택</button>
                            <button type="button" class="btn-erp btn-xs btn-sc-clear-all" data-sc-idx="${scIdx}" title="모든 부대비용 해제">해제</button>
                            ${canDelete ? `<button type="button" class="btn-erp btn-xs btn-remove-cost-sc" data-sc-idx="${scIdx}" title="이 매입 시나리오 삭제" style="color:#ef4444; font-weight:800;">&times;</button>` : ''}
                        </div>
                    </div>
                    <input type="text" class="erp-input sc-name-input" data-sc-idx="${scIdx}" value="${fmt.esc(rawSc.name)}" placeholder="시나리오 명칭" style="font-weight: 800; font-size: 11.5px; height: 24px; margin-bottom: 3px; color: #0f172a;">
                    <input type="text" class="erp-input sc-desc-input" data-sc-idx="${scIdx}" value="${fmt.esc(rawSc.desc || '')}" placeholder="시나리오 조건 메모" style="font-size: 10.5px; height: 21px; background: #f8fafc; color: #475569;">
                </th>
            `;
        });

        theadHtml += `<th class="no-print" style="width: 36px;">삭제</th></tr>`;
        els.theadCostScenarioMatrix.innerHTML = theadHtml;

        // 2. TBODY 빌드 (부대비용 행들 + 금융이자 전용 행)
        let tbodyHtml = '';

        if (state.data.costsPool.length === 0) {
            tbodyHtml += `
                <tr>
                    <td colspan="${4 + scCount}" class="text-center" style="padding: 16px; color: #94a3b8;">
                        등록된 부대비용 항목이 없습니다. 우측 상단 <strong>[+ 부대비용 항목 추가]</strong> 버튼을 눌러 추가하세요.
                    </td>
                </tr>
            `;
        } else {
            state.data.costsPool.forEach((cost, costIdx) => {
                const baseInfo = SalesMarginEngine.computeBaseCostItem(cost, goods, state.data.projectMeta);
                const catOptions = COST_CATEGORIES.map(c =>
                    `<option value="${c.value}" ${cost.category === c.value ? 'selected' : ''}>${c.label}</option>`
                ).join('');
                const calcOptions = COST_CALC_TYPES.map(ct =>
                    `<option value="${ct.value}" ${baseInfo.calcType === ct.value ? 'selected' : ''}>${ct.label}</option>`
                ).join('');
                const calcTypeMeta = COST_CALC_TYPES.find(ct => ct.value === baseInfo.calcType) || COST_CALC_TYPES[0];

                tbodyHtml += `
                    <tr data-cost-idx="${costIdx}" data-cost-id="${cost.id}">
                        <td style="vertical-align: top;">
                            <input type="text" class="erp-input cost-name-input" data-cost-idx="${costIdx}" value="${fmt.esc(cost.name)}" placeholder="항목명 입력" style="font-weight: 700; margin-bottom: 3px;">
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <select class="erp-input cost-cat-select" data-cost-idx="${costIdx}" style="height: 21px; font-size: 10.5px; padding: 0 4px;">
                                    ${catOptions}
                                </select>
                                <button type="button" class="btn-erp btn-xs btn-apply-cost-all no-print" data-cost-id="${cost.id}" title="모든 매입 시나리오에 체크 반영">전체반영</button>
                            </div>
                        </td>
                        <td style="vertical-align: top;">
                            <select class="erp-input cost-calctype-select" data-cost-idx="${costIdx}" style="font-weight: 700; color: ${baseInfo.isFixed ? '#b45309' : '#0369a1'}; margin-bottom: 3px;">
                                ${calcOptions}
                            </select>
                            <div class="cost-formula-desc" style="font-size: 10px; color: #64748b;">
                                ${fmt.esc(baseInfo.formulaDesc)}
                            </div>
                        </td>
                        <td style="vertical-align: top; background: #f8fafc;">
                            <div style="display: flex; align-items: center; gap: 3px; margin-bottom: 3px;">
                                <input type="number" class="erp-input text-right cost-rate-input" data-cost-idx="${costIdx}" value="${baseInfo.unitRate}" min="0" step="100" style="font-weight: 700;">
                                <span class="cost-rate-unit-label" style="font-size: 10px; color: #475569; white-space: nowrap;">${calcTypeMeta.unitLabel}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; font-size: 10.5px; color: #334155;">
                                <span>기본산출:</span>
                                <strong class="cost-base-total-val">${fmt.won(baseInfo.baseAmount)}</strong>
                            </div>
                        </td>
                `;

                // 시나리오별 셀 (ON/OFF 체크 + 해당 시나리오 금액 직접 수정 input)
                evaluatedCosts.forEach((sc, scIdx) => {
                    const scItem = sc.evaluatedPoolForScenario[costIdx];
                    const isChecked = scItem.isIncluded;
                    const hasOverride = scItem.hasOverride;
                    const dispAmount = scItem.effectiveAmount;

                    tbodyHtml += `
                        <td class="sc-cost-cell ${!isChecked ? 'sc-cell-disabled' : ''}" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" style="vertical-align: top; background: ${hasOverride && isChecked ? '#fffbeb' : '#ffffff'};">
                            <div class="sc-cell-wrap">
                                <div class="sc-cell-top">
                                    <input type="checkbox" class="chk-cost-toggle" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" ${isChecked ? 'checked' : ''} title="이 시나리오에 비용 반영 여부">
                                    <input type="number" class="erp-input text-right sc-override-input" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" value="${dispAmount}" min="0" step="10000" ${!isChecked ? 'disabled' : ''} title="직접 숫자를 수정하면 이 시나리오에만 다른 금액이 적용됩니다." style="height: 23px; font-weight: ${hasOverride ? '800' : '600'}; color: ${hasOverride ? '#b45309' : '#1e293b'};">
                                </div>
                                <div class="sc-cell-bottom">
                                    <span class="sc-cell-unit-text">${isChecked ? `개당 +${fmt.won(scItem.unitAmount)}` : '미반영 (0원)'}</span>
                                    <span class="sc-override-slot">
                                        ${hasOverride ? `<span class="sc-override-badge btn-reset-override no-print" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" title="기본 연동 금액(${fmt.won(baseInfo.baseAmount)})으로 복원">개별값 ↺</span>` : ''}
                                    </span>
                                </div>
                            </div>
                        </td>
                    `;
                });

                tbodyHtml += `
                        <td class="text-center no-print">
                            <button type="button" class="btn-erp btn-sm btn-remove-cost" data-cost-idx="${costIdx}" title="부대비용 항목 삭제" style="padding: 2px 6px; color: #ef4444;">
                                <i class="bx bx-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            });
        }

        // 금융이자 설정 전용 행 추가 (사업기간+여신일 연동 및 시나리오별 일수 개별 설정 가능)
        const pm = state.data.projectMeta;
        const defaultFinDays = (Number(pm.projectDays) || 0) + (Number(pm.creditDays) || 0);

        tbodyHtml += `
            <tr class="tr-financing-row" style="background: #faf5ff; border-top: 2px solid #ddd6fe;">
                <td style="font-weight: 800; color: #6b21a8; padding-left: 10px;">
                    <i class="bx bx-dollar-circle"></i> 운전자본 금융이자
                    <div style="font-size: 10px; font-weight: 500; color: #7e22ce;">(물품대 + 반영부대비용) × 이자율</div>
                </td>
                <td style="font-size: 11px; color: #6b21a8;">
                    <strong>기간 비례 (일수 연동 · 변동원가)</strong>
                    <div class="fin-base-desc" style="font-size: 10px; color: #7e22ce;">
                        기본: 사업 ${pm.projectDays}일 + 여신 ${pm.creditDays}일 = ${defaultFinDays}일
                    </div>
                </td>
                <td style="font-size: 11px; color: #6b21a8; background: #f3e8ff;">
                    <div>연 이자율: <strong class="fin-rate-disp">${pm.annualRatePct}%</strong></div>
                    <div style="font-size: 10px; color: #7e22ce;">시나리오별 일수 변경 가능</div>
                </td>
        `;

        evaluatedCosts.forEach((sc, scIdx) => {
            const rawSc = state.data.costScenarios[scIdx];
            const isFinChecked = sc.includeFinancing;
            const hasDaysOverride = sc.hasFinancingDaysOverride;

            tbodyHtml += `
                <td class="sc-fin-cell" data-sc-idx="${scIdx}" style="background: ${isFinChecked ? '#faf5ff' : '#f8fafc'}; vertical-align: top;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 3px;">
                        <label style="display: inline-flex; align-items: center; gap: 4px; font-weight: 700; font-size: 11px; color: ${isFinChecked ? '#6b21a8' : '#64748b'}; cursor: pointer;">
                            <input type="checkbox" class="chk-financing-toggle" data-sc-idx="${scIdx}" ${isFinChecked ? 'checked' : ''}>
                            <span>이자 반영</span>
                        </label>
                        <div style="display: inline-flex; align-items: center; gap: 2px;">
                            <input type="number" class="erp-input text-right sc-fin-days-input" data-sc-idx="${scIdx}" value="${sc.periodDays}" min="0" step="15" ${!isFinChecked ? 'disabled' : ''} title="이 시나리오의 자금묶임(이자산정) 일수. 비우거나 초기화하면 상단 기본일수(${defaultFinDays}일)와 자동 연동됩니다." style="width: 54px; height: 21px; font-size: 11px; font-weight: 700; color: ${hasDaysOverride ? '#b45309' : '#6b21a8'};">
                            <span style="font-size: 10.5px; color: #6b21a8;">일</span>
                            <span class="sc-fin-reset-slot">
                                ${hasDaysOverride ? `<span class="sc-override-badge btn-reset-fin-days no-print" data-sc-idx="${scIdx}" title="기본 일수(${defaultFinDays}일) 연동으로 복원">↺</span>` : ''}
                            </span>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px;">
                        <span class="sc-fin-total-text" style="color: ${isFinChecked ? '#6b21a8' : '#94a3b8'}; font-weight: 700;">
                            ${isFinChecked ? `총 ${fmt.won(sc.financingInterest)}` : `미반영 (${fmt.won(sc.potentialFinancingInterest)})`}
                        </span>
                        <strong class="sc-fin-unit-text" style="color: ${isFinChecked ? '#581c87' : '#94a3b8'};">
                            ${isFinChecked ? `+${fmt.won(sc.unitFinancing)}/개` : '0원/개'}
                        </strong>
                    </div>
                </td>
            `;
        });

        tbodyHtml += `<td class="no-print" style="background: #faf5ff;"></td></tr>`;
        els.tbodyCostScenarioMatrix.innerHTML = tbodyHtml;

        // 3. TFOOT 빌드 (시나리오별 원가 총괄 요약)
        buildCostScenarioMatrixFooter(goods, evaluatedCosts);
    }

    function buildCostScenarioMatrixFooter(goods, evaluatedCosts) {
        if (!els.tfootCostScenarioMatrix) return;

        let tfootHtml = `
            <tr style="background: #f8fafc;">
                <td colspan="3" class="text-right" style="color: #475569; padding-right: 12px;">
                    ① 기본 물품 매입원가 (개당 가중평균) + ② 부대비용·이자 합계
                </td>
        `;

        evaluatedCosts.forEach((sc, scIdx) => {
            tfootHtml += `
                <td class="sc-foot-sub" data-sc-idx="${scIdx}" style="text-align: right; font-size: 11px; color: #334155;">
                    <div>물품대: <strong>${fmt.won(sc.unitGoodsCost)}/개</strong> <span style="color:#64748b;">(부대+이자 +${fmt.won(sc.unitOverhead + sc.unitFinancing)})</span></div>
                    <div style="font-size: 10px; color: #64748b;">고정비 ${fmt.won(sc.fixedCosts)} / 변동비+이자 ${fmt.won(sc.variableCosts + sc.financingInterest)}</div>
                </td>
            `;
        });
        tfootHtml += `<td class="no-print"></td></tr>`;

        tfootHtml += `
            <tr style="background: #eff6ff; border-top: 2px solid #93c5fd;">
                <td colspan="3" class="text-right" style="color: #1e3a8a; font-size: 12px; font-weight: 800; padding-right: 12px;">
                    ★ 시나리오별 최종 개당 총원가 (총 소요 매입원가)
                </td>
        `;

        evaluatedCosts.forEach((sc, scIdx) => {
            tfootHtml += `
                <td class="sc-foot-total" data-sc-idx="${scIdx}" style="text-align: right; background: #eff6ff;">
                    <div style="font-size: 15.5px; font-weight: 900; color: #1e3a8a;">
                        ${fmt.won(sc.unitCost)} <span style="font-size: 11px; font-weight: 600; color: #475569;">/개</span>
                    </div>
                    <div style="font-size: 10.5px; color: #1d4ed8; font-weight: 700;">
                        총원가 합계: ${fmt.won(sc.totalCost)}
                    </div>
                </td>
            `;
        });
        tfootHtml += `<td class="no-print" style="background: #eff6ff;"></td></tr>`;

        els.tfootCostScenarioMatrix.innerHTML = tfootHtml;
    }

    /**
     * Step 2 In-place 값 업데이트 (인풋 타이핑 중 포커스 완벽 유지!)
     */
    function updateCostScenarioMatrixValues(goods, evaluatedCosts) {
        if (!els.tbodyCostScenarioMatrix) return;

        // 부대비용 각 행 업데이트
        state.data.costsPool.forEach((cost, costIdx) => {
            const tr = els.tbodyCostScenarioMatrix.querySelector(`tr[data-cost-idx="${costIdx}"]`);
            if (!tr) return;

            const baseInfo = SalesMarginEngine.computeBaseCostItem(cost, goods, state.data.projectMeta);
            const calcTypeMeta = COST_CALC_TYPES.find(ct => ct.value === baseInfo.calcType) || COST_CALC_TYPES[0];

            const selectCalc = tr.querySelector('.cost-calctype-select');
            if (selectCalc) {
                selectCalc.style.color = baseInfo.isFixed ? '#b45309' : '#0369a1';
            }

            const formulaEl = tr.querySelector('.cost-formula-desc');
            if (formulaEl) formulaEl.innerText = baseInfo.formulaDesc;

            const unitLabelEl = tr.querySelector('.cost-rate-unit-label');
            if (unitLabelEl) unitLabelEl.innerText = calcTypeMeta.unitLabel;

            const baseTotalEl = tr.querySelector('.cost-base-total-val');
            if (baseTotalEl) baseTotalEl.innerText = fmt.won(baseInfo.baseAmount);

            evaluatedCosts.forEach((sc, scIdx) => {
                const scItem = sc.evaluatedPoolForScenario[costIdx];
                if (!scItem) return;
                const cell = tr.querySelector(`.sc-cost-cell[data-sc-idx="${scIdx}"]`);
                if (!cell) return;

                const isChecked = scItem.isIncluded;
                const hasOverride = scItem.hasOverride;

                cell.classList.toggle('sc-cell-disabled', !isChecked);
                cell.style.background = (hasOverride && isChecked) ? '#fffbeb' : '#ffffff';

                const ovInput = cell.querySelector('.sc-override-input');
                if (ovInput) {
                    ovInput.disabled = !isChecked;
                    // 현재 포커스된 인풋이 아닐 때만 value 동기화
                    if (document.activeElement !== ovInput) {
                        ovInput.value = scItem.effectiveAmount;
                    }
                    ovInput.style.fontWeight = hasOverride ? '800' : '600';
                    ovInput.style.color = hasOverride ? '#b45309' : '#1e293b';
                }

                const unitText = cell.querySelector('.sc-cell-unit-text');
                if (unitText) {
                    unitText.innerText = isChecked ? `개당 +${fmt.won(scItem.unitAmount)}` : '미반영 (0원)';
                }

                const ovSlot = cell.querySelector('.sc-override-slot');
                if (ovSlot) {
                    ovSlot.innerHTML = hasOverride
                        ? `<span class="sc-override-badge btn-reset-override no-print" data-sc-idx="${scIdx}" data-cost-id="${cost.id}" title="기본 연동 금액(${fmt.won(baseInfo.baseAmount)})으로 복원">개별값 ↺</span>`
                        : '';
                }
            });
        });

        // 금융이자 행 업데이트
        const pm = state.data.projectMeta;
        const defaultFinDays = (Number(pm.projectDays) || 0) + (Number(pm.creditDays) || 0);
        const finRow = els.tbodyCostScenarioMatrix.querySelector('.tr-financing-row');
        if (finRow) {
            const finBaseDesc = finRow.querySelector('.fin-base-desc');
            if (finBaseDesc) {
                finBaseDesc.innerText = `기본: 사업 ${pm.projectDays}일 + 여신 ${pm.creditDays}일 = ${defaultFinDays}일`;
            }
            const finRateDisp = finRow.querySelector('.fin-rate-disp');
            if (finRateDisp) finRateDisp.innerText = `${pm.annualRatePct}%`;

            evaluatedCosts.forEach((sc, scIdx) => {
                const finCell = finRow.querySelector(`.sc-fin-cell[data-sc-idx="${scIdx}"]`);
                if (!finCell) return;

                const isFinChecked = sc.includeFinancing;
                const hasDaysOverride = sc.hasFinancingDaysOverride;

                finCell.style.background = isFinChecked ? '#faf5ff' : '#f8fafc';

                const daysInput = finCell.querySelector('.sc-fin-days-input');
                if (daysInput) {
                    daysInput.disabled = !isFinChecked;
                    if (document.activeElement !== daysInput) {
                        daysInput.value = sc.periodDays;
                    }
                    daysInput.style.color = hasDaysOverride ? '#b45309' : '#6b21a8';
                }

                const resetSlot = finCell.querySelector('.sc-fin-reset-slot');
                if (resetSlot) {
                    resetSlot.innerHTML = hasDaysOverride
                        ? `<span class="sc-override-badge btn-reset-fin-days no-print" data-sc-idx="${scIdx}" title="기본 일수(${defaultFinDays}일) 연동으로 복원">↺</span>`
                        : '';
                }

                const totalText = finCell.querySelector('.sc-fin-total-text');
                if (totalText) {
                    totalText.style.color = isFinChecked ? '#6b21a8' : '#94a3b8';
                    totalText.innerText = isFinChecked
                        ? `총 ${fmt.won(sc.financingInterest)}`
                        : `미반영 (${fmt.won(sc.potentialFinancingInterest)})`;
                }

                const unitText = finCell.querySelector('.sc-fin-unit-text');
                if (unitText) {
                    unitText.style.color = isFinChecked ? '#581c87' : '#94a3b8';
                    unitText.innerText = isFinChecked ? `+${fmt.won(sc.unitFinancing)}/개` : '0원/개';
                }
            });
        }

        // 푸터 업데이트
        buildCostScenarioMatrixFooter(goods, evaluatedCosts);
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 3: 판매가 시나리오 설정 (1~5개 가변 · 전 매입시나리오 동시 비교 & 역산)
    // ══════════════════════════════════════════════════════════════
    function buildSalesScenariosDOM(goods, matrixResult) {
        if (!els.salesScenariosContainer) return;
        els.salesScenariosContainer.innerHTML = '';

        const salesScenarios = state.data.salesScenarios;
        const evaluatedCosts = matrixResult.evaluatedCosts;
        const salesCount = salesScenarios.length;
        if (els.dispSalesScCount) els.dispSalesScCount.innerText = salesCount;

        salesScenarios.forEach((sSc, sIdx) => {
            const isSelectedSales = sIdx === state.data.selectedCrossIndex.salesIdx;
            const canDelete = salesCount > MIN_SCENARIOS;

            const card = document.createElement('div');
            card.className = `sales-card ${isSelectedSales ? 'active' : ''}`;
            card.dataset.sIdx = sIdx;

            let rowsHtml = '';
            evaluatedCosts.forEach((cSc, cIdx) => {
                const cell = matrixResult.matrix[cIdx]?.cells[sIdx];
                if (!cell) return;

                const hasCustomPrice = cell.hasCustomPrice;
                const marginColor = cell.isHealthy ? '#047857' : cell.isWarning ? '#d97706' : '#dc2626';

                rowsHtml += `
                    <tr class="sales-cost-row" data-cost-idx="${cIdx}" data-cost-id="${cSc.id}" style="background: ${hasCustomPrice ? '#fffbeb' : '#ffffff'};">
                        <td style="font-weight: 700; color: #1e293b;">
                            <div>${fmt.esc(cSc.name)}</div>
                            <div style="font-size: 10px; color: #64748b;">원가 <strong class="sub-cost-unit">${fmt.won(cSc.unitCost)}</strong>/개</div>
                        </td>
                        <td style="text-align: right;">
                            <div style="display: inline-flex; align-items: center; gap: 2px;">
                                <input type="number" class="erp-input text-right sales-cell-price-input" data-s-idx="${sIdx}" data-cost-id="${cSc.id}" value="${cell.targetPrice}" min="0" step="50" title="직접 수정하거나 우측 역산 버튼을 누르면 이 매입 시나리오에 맞춘 개별 판매단가가 설정됩니다." style="width: 82px; height: 22px; font-weight: ${hasCustomPrice ? '800' : '600'}; color: ${hasCustomPrice ? '#b45309' : '#1e40af'};">
                                <span style="font-size: 10px;">원</span>
                            </div>
                            <div class="sales-cell-override-slot" style="text-align: right; margin-top: 1px;">
                                ${hasCustomPrice ? `<span class="sc-override-badge btn-reset-sales-override no-print" data-s-idx="${sIdx}" data-cost-id="${cSc.id}" title="상단 기본 판매단가(${fmt.won(sSc.targetPrice)}) 연동으로 복원">개별판가 ↺</span>` : `<span style="font-size:9.5px; color:#94a3b8;">기본연동</span>`}
                            </div>
                        </td>
                        <td class="text-right sales-cell-margin-td">
                            <div class="sub-margin-val" style="font-weight: 800; color: ${marginColor};">
                                ${fmt.won(cell.marginAmount)} (${cell.marginRate}%)
                            </div>
                            <div class="sub-profit-val" style="font-size: 10px; color: #475569;">
                                총이익 ${fmt.won(cell.totalProfit)}
                            </div>
                        </td>
                        <td class="text-center no-print">
                            <div style="display: inline-flex; gap: 2px; flex-wrap: wrap; justify-content: center;">
                                <button type="button" class="btn-erp btn-xs btn-row-reverse" data-s-idx="${sIdx}" data-cost-idx="${cIdx}" data-margin="15" title="${fmt.esc(cSc.name)} 원가 기준 15% 마진 판매가 적용">15%</button>
                                <button type="button" class="btn-erp btn-xs btn-row-reverse" data-s-idx="${sIdx}" data-cost-idx="${cIdx}" data-margin="20" title="${fmt.esc(cSc.name)} 원가 기준 20% 마진 판매가 적용">20%</button>
                                <button type="button" class="btn-erp btn-xs btn-row-reverse" data-s-idx="${sIdx}" data-cost-idx="${cIdx}" data-margin="25" title="${fmt.esc(cSc.name)} 원가 기준 25% 마진 판매가 적용">25%</button>
                                <button type="button" class="btn-erp btn-xs btn-row-reverse" data-s-idx="${sIdx}" data-cost-idx="${cIdx}" data-margin="30" title="${fmt.esc(cSc.name)} 원가 기준 30% 마진 판매가 적용">30%</button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
                    <span style="background: #0284c7; color: #ffffff; font-size: 10.5px; font-weight: 800; padding: 2px 7px; border-radius: 3px; white-space: nowrap;">
                        판매 ${fmt.alphaCode(sIdx)}
                    </span>
                    <input type="text" class="erp-input sales-name-input" data-s-idx="${sIdx}" value="${fmt.esc(sSc.name)}" placeholder="판매 시나리오 명칭 입력" style="font-weight: 800; font-size: 12px; flex: 1;">
                    <input type="text" class="erp-input sales-memo-input" data-s-idx="${sIdx}" value="${fmt.esc(sSc.memo || '')}" placeholder="타겟 거래처/채널 메모" style="width: 125px; font-size: 11px; color: #475569; background: #f8fafc;">
                    ${canDelete ? `<button type="button" class="btn-erp btn-xs btn-remove-sales-sc no-print" data-s-idx="${sIdx}" title="이 판매 시나리오 삭제" style="color: #ef4444; font-weight: 800;">&times;</button>` : ''}
                </div>

                <!-- 기본 목표 판매단가 및 전체 매입시나리오 일괄 마진율 역산 바 -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 3px; padding: 6px 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <div style="display: inline-flex; align-items: center; gap: 5px;">
                        <span style="font-size: 11px; font-weight: 700; color: #334155;">공통(기본) 판매단가:</span>
                        <input type="number" class="erp-input text-right sales-price-input" data-s-idx="${sIdx}" value="${sSc.targetPrice}" step="50" min="0" style="width: 100px; font-weight: 800; font-size: 13.5px; color: var(--erp-primary);">
                        <span style="font-size: 11.5px; font-weight: 700;">원/개</span>
                    </div>
                    <div class="no-print" style="display: inline-flex; align-items: center; gap: 3px;">
                        <span style="font-size: 10px; color: #64748b;">매입별 일괄역산:</span>
                        <input type="number" class="erp-input text-right custom-margin-input" data-s-idx="${sIdx}" placeholder="마진%" step="1" min="-50" max="95" style="width: 52px; height: 21px; font-size: 10.5px; padding: 1px 4px;">
                        <button type="button" class="btn-erp btn-xs btn-apply-margin-per-cost" data-s-idx="${sIdx}" title="입력한 목표 마진율(%)을 아래 모든 매입 시나리오 원가에 각각 적용하여 매입별 맞춤 판매단가를 산출합니다." style="background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe;">매입별 맞춤역산</button>
                    </div>
                </div>

                <!-- 드롭다운 없이 모든 매입 시나리오(1~5)를 한눈에 비교 & 개별 설정하는 내장 테이블 -->
                <table class="sales-cost-subtable">
                    <thead>
                        <tr>
                            <th style="width: 30%;">매입 시나리오 (원가)</th>
                            <th style="width: 24%;">적용 판매단가</th>
                            <th style="width: 26%;">개당 마진 / 총이익</th>
                            <th class="no-print" style="width: 20%;">원가기준 빠른역산</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            `;

            els.salesScenariosContainer.appendChild(card);
        });
    }

    function updateSalesScenariosValues(goods, matrixResult) {
        if (!els.salesScenariosContainer) return;
        const cards = els.salesScenariosContainer.querySelectorAll('.sales-card');
        const evaluatedCosts = matrixResult.evaluatedCosts;

        state.data.salesScenarios.forEach((sSc, sIdx) => {
            const card = cards[sIdx];
            if (!card) return;

            const basePriceInput = card.querySelector('.sales-price-input');
            if (basePriceInput && document.activeElement !== basePriceInput) {
                basePriceInput.value = sSc.targetPrice;
            }

            evaluatedCosts.forEach((cSc, cIdx) => {
                const cell = matrixResult.matrix[cIdx]?.cells[sIdx];
                const row = card.querySelector(`.sales-cost-row[data-cost-idx="${cIdx}"]`);
                if (!cell || !row) return;

                const hasCustomPrice = cell.hasCustomPrice;
                const marginColor = cell.isHealthy ? '#047857' : cell.isWarning ? '#d97706' : '#dc2626';

                row.style.background = hasCustomPrice ? '#fffbeb' : '#ffffff';

                const subCostUnit = row.querySelector('.sub-cost-unit');
                if (subCostUnit) subCostUnit.innerText = fmt.won(cSc.unitCost);

                const cellPriceInput = row.querySelector('.sales-cell-price-input');
                if (cellPriceInput) {
                    if (document.activeElement !== cellPriceInput) {
                        cellPriceInput.value = cell.targetPrice;
                    }
                    cellPriceInput.style.fontWeight = hasCustomPrice ? '800' : '600';
                    cellPriceInput.style.color = hasCustomPrice ? '#b45309' : '#1e40af';
                }

                const ovSlot = row.querySelector('.sales-cell-override-slot');
                if (ovSlot) {
                    ovSlot.innerHTML = hasCustomPrice
                        ? `<span class="sc-override-badge btn-reset-sales-override no-print" data-s-idx="${sIdx}" data-cost-id="${cSc.id}" title="상단 기본 판매단가(${fmt.won(sSc.targetPrice)}) 연동으로 복원">개별판가 ↺</span>`
                        : `<span style="font-size:9.5px; color:#94a3b8;">기본연동</span>`;
                }

                const marginVal = row.querySelector('.sub-margin-val');
                if (marginVal) {
                    marginVal.style.color = marginColor;
                    marginVal.innerText = `${fmt.won(cell.marginAmount)} (${cell.marginRate}%)`;
                }

                const profitVal = row.querySelector('.sub-profit-val');
                if (profitVal) {
                    profitVal.innerText = `총이익 ${fmt.won(cell.totalProfit)}`;
                }
            });
        });
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 4: 매입(M) × 판매(N) 경우의 수 교차 분석 매트릭스
    // ══════════════════════════════════════════════════════════════
    function renderCrossMatrix(matrixResult) {
        if (!els.trMatrixHeader || !els.tbodyCrossMatrix) return;

        const evaluatedCosts = matrixResult.evaluatedCosts;
        const evaluatedSales = matrixResult.evaluatedSales;
        const matrix = matrixResult.matrix;
        const totalCombos = evaluatedCosts.length * evaluatedSales.length;

        if (els.dispMatrixDimTitle) {
            els.dispMatrixDimTitle.innerText = `${evaluatedCosts.length}×${evaluatedSales.length} = 총 ${totalCombos}가지 조합`;
        }

        // 1. 헤더 행 렌더링
        let headerHtml = `
            <th style="width: 18%; background: #0f172a; color: #e2e8f0; font-size: 11px;">
                매입 시나리오 (원가) ＼ 판매 시나리오 (판가)
            </th>
        `;

        evaluatedSales.forEach((sSc, sIdx) => {
            const isSelectedCol = sIdx === state.data.selectedCrossIndex.salesIdx;
            headerHtml += `
                <th style="background: ${isSelectedCol ? '#1e3a8a' : '#1e293b'}; color: #ffffff; text-align: center;">
                    <div style="font-size: 12px; font-weight: 800;">[${fmt.alphaCode(sIdx)}] ${fmt.esc(sSc.name)}</div>
                    <div style="font-size: 12px; font-weight: 700; color: #38bdf8;">기본 ${fmt.won(sSc.targetPrice)}/개</div>
                </th>
            `;
        });
        els.trMatrixHeader.innerHTML = headerHtml;

        // 2. 바디 행 렌더링 (M × N)
        let bodyHtml = '';

        matrix.forEach((row, costIdx) => {
            const cSc = row.costScenario;
            const isSelectedRow = costIdx === state.data.selectedCrossIndex.costIdx;

            bodyHtml += `<tr>`;
            bodyHtml += `
                <td style="background: ${isSelectedRow ? '#eff6ff' : '#f8fafc'}; border-right: 2px solid #cbd5e1; padding: 8px 10px;">
                    <div style="font-weight: 800; font-size: 12px; color: #1e293b;">[${costIdx + 1}] ${fmt.esc(cSc.name)}</div>
                    <div style="font-size: 11px; color: #475569; margin-top: 2px;">
                        개당 원가: <strong style="font-size: 13px; color: #0f172a;">${fmt.won(cSc.unitCost)}</strong>
                    </div>
                    <div style="font-size: 10px; color: #64748b;">
                        물품 ${fmt.num(cSc.unitGoodsCost)} + 부대·이자 ${fmt.num(cSc.unitOverhead + cSc.unitFinancing)}
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
                    bepText = `1개 이상 (고정비 0원)`;
                } else {
                    bepText = `${fmt.num(cell.bepUnits)}개 (고정비 ${fmt.num(cell.fixedCosts)}원)`;
                }

                bodyHtml += `
                    <td class="matrix-cell ${isSelectedCell ? 'selected' : ''}" data-cost-idx="${costIdx}" data-sales-idx="${salesIdx}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                            <span class="matrix-badge ${badgeClass}">${badgeText}</span>
                            <span style="font-size: 10px; font-weight: 700; color: ${isSelectedCell ? '#1d4ed8' : '#64748b'};">
                                ${isSelectedCell ? '★ 대표채택안 ' : ''}[${cell.comboCode}] 판가 ${fmt.won(cell.targetPrice)}
                            </span>
                        </div>
                        <div class="matrix-cell-margin" style="color: ${marginColor};">
                            ${fmt.won(cell.marginAmount)} <span style="font-size: 13px; font-weight: 800;">(${cell.marginRate}%)</span>
                        </div>
                        <div class="matrix-cell-profit">
                            예상 총영업익: <strong style="color: ${cell.totalProfit < 0 ? '#dc2626' : '#0f172a'};">${fmt.won(cell.totalProfit)}</strong>
                        </div>
                        <div style="font-size: 10px; color: #64748b; margin-top: 2px;">
                            BEP: ${bepText}
                        </div>
                    </td>
                `;
            });

            bodyHtml += `</tr>`;
        });

        els.tbodyCrossMatrix.innerHTML = bodyHtml;
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 5: 전 시나리오 조합 심층 분석 (전수 펼침 — 워터폴 + BEP + 품목배부)
    // ══════════════════════════════════════════════════════════════
    function syncDeepDiveFilterOptions(evaluatedCosts) {
        if (!els.selectDeepDiveFilter) return;
        const currentVal = state.data.deepDiveFilter || 'all';
        let html = `<option value="all" ${currentVal === 'all' ? 'selected' : ''}>전체 매입 시나리오 모두 펼침 (${evaluatedCosts.length}개 그룹)</option>`;
        evaluatedCosts.forEach((cSc, idx) => {
            html += `<option value="${idx}" ${String(currentVal) === String(idx) ? 'selected' : ''}>[${idx + 1}] ${fmt.esc(cSc.name)} 조합만 보기</option>`;
        });
        els.selectDeepDiveFilter.innerHTML = html;
    }

    function renderAllCombosDeepDive(matrixResult) {
        if (!els.allCombosDeepDiveContainer) return;

        const evaluatedCosts = matrixResult.evaluatedCosts;
        const evaluatedSales = matrixResult.evaluatedSales;
        const totalCombos = evaluatedCosts.length * evaluatedSales.length;

        if (els.dispAllDeepDiveCount) {
            els.dispAllDeepDiveCount.innerText = `총 ${totalCombos}개 조합 전수 분석`;
        }

        const filterVal = state.data.deepDiveFilter || 'all';
        let containerHtml = '';

        matrixResult.matrix.forEach((row, costIdx) => {
            if (filterVal !== 'all' && String(costIdx) !== String(filterVal)) return;

            const cSc = row.costScenario;
            let cardsHtml = '';

            row.cells.forEach((cell, salesIdx) => {
                const isSelected = (costIdx === state.data.selectedCrossIndex.costIdx && salesIdx === state.data.selectedCrossIndex.salesIdx);

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

                let bepUnitsText = '';
                let bepRevText = '';
                if (cell.bepStatus === 'impossible') {
                    bepUnitsText = `<span style="color:#dc2626;">달성 불가 (역마진)</span>`;
                    bepRevText = `<span style="color:#dc2626;">산출 불가</span>`;
                } else if (cell.bepStatus === 'immediate') {
                    bepUnitsText = `<span style="color:#047857;">1개 이상 (즉시 흑자)</span>`;
                    bepRevText = fmt.won(cell.targetPrice);
                } else {
                    const pctOfOrder = ((cell.bepUnits / (cSc.totalQty || 1)) * 100).toFixed(1);
                    bepUnitsText = `${fmt.num(cell.bepUnits)} EA (수주량의 ${pctOfOrder}%)`;
                    bepRevText = fmt.won(cell.bepRevenue);
                }

                const svgHtml = buildWaterfallSvgString(cSc, cell.targetPrice, `${costIdx}_${salesIdx}`);

                const itemizedRowsHtml = (cell.itemized || []).map(it => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 1.5px 0; border-bottom: 1px dotted #dbeafe;">
                        <span style="color: #334155; font-weight: 600;">· ${fmt.esc(it.name || '품목')} <small style="color:#64748b;">(${fmt.num(it.qty)}EA · 매입 ${fmt.num(it.unitPrice)}원)</small></span>
                        <span>
                            <span style="color:#64748b;">배부원가 ${fmt.num(it.allocatedUnitCost)}원</span> →
                            <strong style="color:#1d4ed8;">권장판가 ${fmt.won(it.recommendedUnitPrice)}</strong>
                        </span>
                    </div>
                `).join('');

                cardsHtml += `
                    <div class="combo-deep-card ${isSelected ? 'is-selected-combo' : ''}" id="deepCard_${costIdx}_${salesIdx}">
                        <div class="combo-deep-card-header">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <span style="background: #0f172a; color: #38bdf8; font-size: 10.5px; font-weight: 800; padding: 2px 6px; border-radius: 3px;">
                                    조합 ${cell.comboCode}
                                </span>
                                <strong style="font-size: 12.5px; color: #0f172a;">${fmt.esc(cell.salesScenarioName)}</strong>
                                <span class="matrix-badge ${badgeClass}">${badgeText}</span>
                            </div>
                            <button type="button" class="btn-erp btn-xs btn-pick-representative no-print ${isSelected ? 'btn-primary' : ''}" data-cost-idx="${costIdx}" data-sales-idx="${salesIdx}" title="이 조합을 Step 1 품목별 권장판가 및 Step 6 기안문의 대표 채택안으로 설정합니다.">
                                ${isSelected ? '★ 현재 대표채택안' : '☆ 대표안으로 지정'}
                            </button>
                        </div>

                        <!-- 핵심 손익 요약 배너 -->
                        <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; padding: 5px 8px; border-radius: 3px; border: 1px solid #e2e8f0; font-size: 11px;">
                            <span>적용 판가: <strong style="color:#1e40af; font-size:12.5px;">${fmt.won(cell.targetPrice)}/개</strong></span>
                            <span>개당 마진: <strong style="color:${marginColor}; font-size:12.5px;">${fmt.won(cell.marginAmount)} (${cell.marginRate}%)</strong></span>
                            <span>총 영업이익: <strong style="color:${cell.totalProfit < 0 ? '#dc2626' : '#0f172a'}; font-size:12.5px;">${fmt.won(cell.totalProfit)}</strong></span>
                        </div>

                        <!-- 개당 마진 워터폴 브릿지 SVG -->
                        <div class="combo-wf-box">
                            <div style="display: flex; justify-content: space-between; font-size: 10px; color: #64748b; margin-bottom: 2px;">
                                <span style="font-weight: 700; color: #475569;"><i class="bx bx-bar-chart"></i> 개당 마진 워터폴 브릿지 (판매단가 → 원가 차감 → 최종마진)</span>
                                <span>단위: 원/EA</span>
                            </div>
                            ${svgHtml}
                        </div>

                        <!-- 손익분기점 (BEP) 및 수익성 지표 그리드 -->
                        <div class="combo-bep-grid">
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">개당 변동비 (물품+변동+이자):</span>
                                <strong>${fmt.won(cell.unitVariableCost)}</strong>
                            </div>
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">개당 공헌이익 (공헌이익률):</span>
                                <strong style="color:${cell.unitContribution > 0 ? '#0284c7' : '#dc2626'};">${fmt.won(cell.unitContribution)} (${cell.contributionRate}%)</strong>
                            </div>
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">시나리오 반영 총 고정비:</span>
                                <strong style="color:#b45309;">${fmt.won(cell.fixedCosts)}</strong>
                            </div>
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">원가대비 마크업 / 총매출:</span>
                                <strong>${cell.markupRate}% / ${fmt.won(cell.totalRevenue)}</strong>
                            </div>
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">손익분기 수량 (BEP):</span>
                                <strong>${bepUnitsText}</strong>
                            </div>
                            <div class="combo-bep-item">
                                <span style="color:#64748b;">손익분기 최소매출액:</span>
                                <strong>${bepRevText}</strong>
                            </div>
                        </div>

                        <!-- 품목별 배부원가 및 권장 납품단가 -->
                        <div class="combo-itemized-box">
                            <div style="font-weight: 700; color: #1e40af; margin-bottom: 3px;">
                                <i class="bx bx-Purchase-tag-alt"></i> 이 조합 적용 시 품목별 배부원가 → 권장 납품단가
                            </div>
                            ${itemizedRowsHtml}
                        </div>
                    </div>
                `;
            });

            containerHtml += `
                <div class="deep-dive-group-panel">
                    <div class="deep-dive-group-header">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span style="background: #38bdf8; color: #0f172a; font-weight: 800; font-size: 11px; padding: 2px 8px; border-radius: 3px;">
                                매입 그룹 ${costIdx + 1}
                            </span>
                            <strong style="font-size: 13px;">${fmt.esc(cSc.name)}</strong>
                            <span style="font-size: 11px; color: #cbd5e1;">(${fmt.esc(cSc.desc || '조건 설정')})</span>
                        </div>
                        <div style="font-size: 11.5px; color: #e2e8f0; display: flex; gap: 12px; flex-wrap: wrap;">
                            <span>개당 총원가: <strong style="color:#38bdf8; font-size:13px;">${fmt.won(cSc.unitCost)}/개</strong> (총 ${fmt.won(cSc.totalCost)})</span>
                            <span>|</span>
                            <span>물품대 ${fmt.won(cSc.unitGoodsCost)} + 부대비용 ${fmt.won(cSc.unitOverhead)} + 금융이자(${cSc.periodDays}일) ${fmt.won(cSc.unitFinancing)}</span>
                        </div>
                    </div>
                    <div class="deep-dive-cards-grid">
                        ${cardsHtml}
                    </div>
                </div>
            `;
        });

        els.allCombosDeepDiveContainer.innerHTML = containerHtml;
    }

    /**
     * 개별 조합 카드용 SVG 워터폴 브릿지 문자열 생성 (다중 SVG 동시 렌더링 지원)
     */
    function buildWaterfallSvgString(cSc, targetPrice, uidSuffix = '0') {
        const steps = SalesMarginEngine.generateWaterfallData(cSc, targetPrice);

        const width = 460;
        const height = 155;
        const margin = { top: 20, right: 14, bottom: 28, left: 42 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

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

        const domainMax = highestVal * 1.15;
        const domainMin = lowestVal < 0 ? lowestVal * 1.25 : 0;
        const domainSpan = Math.max(domainMax - domainMin, 1);

        const valToY = val => margin.top + Math.round(((domainMax - val) / domainSpan) * plotHeight);
        const zeroY = valToY(0);

        const barWidth = Math.min(42, Math.floor(plotWidth / (steps.length * 1.4)));
        const colGap = Math.floor(plotWidth / steps.length);

        let svg = `
            <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: inherit; display: block;">
                <line x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="${lowestVal < 0 ? '3,3' : 'none'}" />
                <text x="${margin.left - 5}" y="${zeroY + 3}" text-anchor="end" font-size="9" fill="#64748b">0</text>
        `;

        barGeoms.forEach((st, idx) => {
            const x = margin.left + (idx * colGap) + Math.floor((colGap - barWidth) / 2);
            const y1 = valToY(st.fromVal);
            const y2 = valToY(st.toVal);
            const barY = Math.min(y1, y2);
            const barH = Math.max(3, Math.abs(y2 - y1));

            let fill = st.color;
            if (st.type === 'start') fill = '#2563eb';
            else if (st.type === 'end') fill = st.amount >= 0 ? '#10b981' : '#dc2626';

            if (idx > 0 && st.type !== 'end') {
                const prevX = margin.left + ((idx - 1) * colGap) + Math.floor((colGap - barWidth) / 2) + barWidth;
                svg += `<line x1="${prevX}" y1="${y1}" x2="${x}" y2="${y1}" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="2,2" />`;
            }

            const labelText = st.type === 'drop' ? `-${fmt.num(st.amount)}` : fmt.num(st.amount);
            const textY = (st.type === 'end' && st.amount < 0) ? Math.min(height - 16, barY + barH + 10) : Math.max(11, barY - 4);
            const textColor = (st.type === 'end' && st.amount < 0) ? '#dc2626' : '#1e293b';

            svg += `
                <rect x="${x}" y="${barY}" width="${barWidth}" height="${barH}" rx="2.5" fill="${fill}" />
                <text x="${x + barWidth / 2}" y="${textY}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${textColor}">${labelText}</text>
                <text x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="9" fill="#475569" font-weight="600">${fmt.esc(st.label)}</text>
            `;
        });

        svg += `</svg>`;
        return svg;
    }

    // ── 인쇄 메타데이터 동기화 ──
    function updatePrintMeta() {
        const pm = state.data.projectMeta;
        const totalFin = (Number(pm.projectDays) || 0) + (Number(pm.creditDays) || 0);
        const cLen = state.data.costScenarios.length;
        const sLen = state.data.salesScenarios.length;

        if (els.printProjectTitle) els.printProjectTitle.innerText = state.data.docTitle || '영업 수주 원가·마진 시뮬레이션';
        if (els.printDate) els.printDate.innerText = new Date().toISOString().split('T')[0];
        if (els.printPeriodMeta) els.printPeriodMeta.innerText = `사업 ${pm.projectDays}일 + 여신 ${pm.creditDays}일 (이자 ${totalFin}일 · 연 ${pm.annualRatePct}%)`;
        if (els.printMatrixMeta) els.printMatrixMeta.innerText = `${cLen}×${sLen} 시나리오 교차 분석 (총 ${cLen * sLen}조합)`;
    }

    // ── Step 6: 종합 기안문 자동 생성 ──
    function generateRemarksText() {
        if (!state.calculated) return '';

        const title = state.data.docTitle || '영업 수주 원가·마진 시뮬레이션';
        const goods = state.calculated.goods;
        const matrix = state.calculated.matrix;
        const pm = state.data.projectMeta;
        const selectedCell = state.calculated.activeCell || matrix.matrix[0]?.cells[0];
        const itemized = selectedCell?.itemized || [];

        const cCount = matrix.evaluatedCosts.length;
        const sCount = matrix.evaluatedSales.length;
        const totalCombos = cCount * sCount;

        let maxMarginCell = null;
        let minMarginCell = null;

        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                if (!maxMarginCell || c.marginRate > maxMarginCell.marginRate) maxMarginCell = c;
                if (!minMarginCell || c.marginRate < minMarginCell.marginRate) minMarginCell = c;
            });
        });

        const itemLines = itemized.map((it, i) => {
            const gItem = goods.items[i] || it;
            return `   ${i + 1}) ${it.name || '품목'} (${it.spec || '-'}) : ${fmt.num(it.qty)}EA (${fmt.num(gItem.boxCount)}BOX / ${fmt.num(gItem.pltCount)}PLT / 총 ${fmt.dec(gItem.itemTotalWeightKg, 1)}kg) | 매입 ${fmt.won(it.unitPrice)} → 배부원가 ${fmt.won(it.allocatedUnitCost)} / 권장판가 ${fmt.won(it.recommendedUnitPrice)}`;
        }).join('\n');

        let bepDesc = '';
        if (selectedCell.bepStatus === 'impossible') {
            bepDesc = '달성 불가 (현재 판매단가가 개당 변동비 이하인 역마진 구간으로 판가 상향 필수)';
        } else if (selectedCell.bepStatus === 'immediate') {
            bepDesc = '1개 이상 수주 시 즉시 흑자 달성 (반영 고정비 없음)';
        } else {
            bepDesc = `${fmt.num(selectedCell.bepUnits)}EA 이상 수주 시 흑자 전환 (반영 고정비 ${fmt.won(selectedCell.fixedCosts)} / 최소매출 ${fmt.won(selectedCell.bepRevenue)})`;
        }

        const totalFinDays = (Number(pm.projectDays) || 0) + (Number(pm.creditDays) || 0);

        return `[기안문] ${title}

1. 검토 목적 및 프로젝트 기본 조건
 - 본 검토는 ${title} 건에 대하여 매입 원가 ${cCount}개 시나리오와 판매가 ${sCount}개 시나리오를 교차 분석(총 ${totalCombos}가지 경우의 수)하여 적정 수주 단가 및 물류·손익 타당성을 확정하고자 함.
 - 사업(보관)기간: ${pm.projectDays}일 (${(pm.projectDays / 30).toFixed(1)}개월) / 대금결제 여신: +${pm.creditDays}일 (기본 금융이자 산정 ${totalFinDays}일 · 연 ${pm.annualRatePct}%)
 - 출고 물류 총괄: 총 수량 ${fmt.num(goods.totalQty)} EA / 총 ${fmt.num(goods.totalBoxes)} BOX (평균 ${fmt.dec(goods.avgBoxWeightKg, 1)}kg/BOX) / 총 ${fmt.num(goods.totalPlts)} PLT (평균 ${fmt.dec(goods.avgPltWeightKg, 0)}kg/PLT) / 총 출고중량 ${fmt.dec(goods.totalWeightKg, 1)}kg (${goods.totalWeightTon}톤)

2. 품목별 매입·물류 내역 및 대표 채택안([${selectedCell.comboCode}]) 기준 권장 납품단가
 - 총 매입 공급가액: ${fmt.won(goods.totalSupplyPrice)} (가중평균 매입단가 ${fmt.won(goods.avgUnitGoodsPrice)} / 부가세 원가산입: ${state.data.includeVat ? '포함' : '미포함'})
${itemLines}

3. ${cCount}×${sCount} 시나리오 교차 분석 요약 (총 ${totalCombos}가지 경우의 수)
 - [최대 이익 조합] [${maxMarginCell.comboCode}] ${maxMarginCell.costScenarioName} × ${maxMarginCell.salesScenarioName}
   : 판가 ${fmt.won(maxMarginCell.targetPrice)} / 개당 마진 ${fmt.won(maxMarginCell.marginAmount)} (${maxMarginCell.marginRate}%) / 총 영업이익 ${fmt.won(maxMarginCell.totalProfit)}
 - [최저 보수 조합] [${minMarginCell.comboCode}] ${minMarginCell.costScenarioName} × ${minMarginCell.salesScenarioName}
   : 판가 ${fmt.won(minMarginCell.targetPrice)} / 개당 마진 ${fmt.won(minMarginCell.marginAmount)} (${minMarginCell.marginRate}%) / 총 영업이익 ${fmt.won(minMarginCell.totalProfit)}

4. [대표 채택/권장안] [${selectedCell.comboCode}] ${selectedCell.costScenarioName} × ${selectedCell.salesScenarioName}
 - 목표 판매단가: ${fmt.won(selectedCell.targetPrice)}/개 (예상 총매출액 ${fmt.won(selectedCell.totalRevenue)})
 - 개당 총 소요원가: ${fmt.won(selectedCell.unitCost)}/개 (예상 총원가 ${fmt.won(selectedCell.totalCost)})
 - 개당 영업마진: ${fmt.won(selectedCell.marginAmount)} (마진율 ${selectedCell.marginRate}% / 원가대비 마크업 ${selectedCell.markupRate}%)
 - 총 예상 수주 영업이익: ${fmt.won(selectedCell.totalProfit)}
 - 손익분기점(BEP): ${bepDesc}

5. 종합 검토 의견
 - 본 건은 [${selectedCell.salesScenarioName}] 이상 조건으로 수주를 추진함이 타당하며, 출고 물량(${fmt.num(goods.totalBoxes)}BOX / ${fmt.num(goods.totalPlts)}PLT) 및 사업·자금회수 일정(${totalFinDays}일) 준수 관리가 요구됨.`;
    }

    // ── 7. 이벤트 바인딩 ──
    function bindEvents() {
        // 검토 건명
        if (els.inputDocTitle) {
            els.inputDocTitle.addEventListener('input', e => {
                state.data.docTitle = e.target.value;
                updatePrintMeta();
            });
        }

        // 부가세 포함 토글
        if (els.chkIncludeVat) {
            els.chkIncludeVat.addEventListener('change', e => {
                state.data.includeVat = e.target.checked;
                recalculateAll({ rebuildGoods: true, rebuildCostMatrix: false, rebuildSalesCards: false });
                showToast(`부가세 원가 산입: ${state.data.includeVat ? '포함(10%)' : '미포함(공급가액)'}`);
            });
        }

        // Step 1 상단: 사업(보관)기간, 결제여신 추가일, 연 이자율 변경
        if (els.inputProjectDays) {
            els.inputProjectDays.addEventListener('input', e => {
                state.data.projectMeta.projectDays = Math.max(0, Number(e.target.value) || 0);
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
            });
        }
        if (els.inputCreditDays) {
            els.inputCreditDays.addEventListener('input', e => {
                state.data.projectMeta.creditDays = Math.max(0, Number(e.target.value) || 0);
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
            });
        }
        if (els.inputAnnualRate) {
            els.inputAnnualRate.addEventListener('input', e => {
                state.data.projectMeta.annualRatePct = Math.max(0, Number(e.target.value) || 0);
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
            });
        }

        // Step 1: 매입 품목 추가
        if (els.btnAddGoodsRow) {
            els.btnAddGoodsRow.addEventListener('click', () => {
                state.data.items.push({
                    id: fmt.uid('item'),
                    name: '',
                    spec: '',
                    qty: 1000,
                    unitPrice: 2500,
                    unitWeightKg: 0.2,
                    eaPerBox: 50,
                    boxPerPlt: 20
                });
                recalculateAll({ rebuildGoods: true, rebuildCostMatrix: false, rebuildSalesCards: false });
            });
        }

        // Step 1: 품목 테이블 인풋 & 삭제 위임
        if (els.tbodyGoods) {
            els.tbodyGoods.addEventListener('input', e => {
                const target = e.target;
                const idx = Number(target.dataset.idx);
                if (isNaN(idx) || !state.data.items[idx]) return;
                const item = state.data.items[idx];

                if (target.classList.contains('item-name')) {
                    item.name = target.value;
                    renderAllCombosDeepDive(state.calculated.matrix);
                } else if (target.classList.contains('item-spec')) {
                    item.spec = target.value;
                } else if (target.classList.contains('item-qty')) {
                    item.qty = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('item-price')) {
                    item.unitPrice = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('item-weight')) {
                    item.unitWeightKg = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('item-eabox')) {
                    item.eaPerBox = target.value === '' ? 0 : Math.max(0, Math.floor(Number(target.value) || 0));
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('item-boxplt')) {
                    item.boxPerPlt = target.value === '' ? 0 : Math.max(0, Math.floor(Number(target.value) || 0));
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
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
                recalculateAll({ rebuildGoods: true, rebuildCostMatrix: false, rebuildSalesCards: false });
            });
        }

        // Step 2: 부대비용 항목 추가
        if (els.btnAddCostItem) {
            els.btnAddCostItem.addEventListener('click', () => {
                const newCostId = fmt.uid('cost');
                state.data.costsPool.push({
                    id: newCostId,
                    name: '신규 부대비용 항목',
                    category: 'etc',
                    calcType: 'fixed_once',
                    unitRate: 150000
                });

                // 기본적으로 2번째 이후 시나리오에 체크 반영
                state.data.costScenarios.forEach((sc, i) => {
                    if (i >= 1 || state.data.costScenarios.length === 1) {
                        sc.includedCostIds.push(newCostId);
                    }
                });

                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: false });
                showToast('새 부대비용 항목이 추가되었습니다.', 'success');
            });
        }

        // Step 2: 매입 시나리오 추가 (최대 5개)
        if (els.btnAddCostScenario) {
            els.btnAddCostScenario.addEventListener('click', () => {
                if (state.data.costScenarios.length >= MAX_SCENARIOS) {
                    showToast(`매입 시나리오는 최대 ${MAX_SCENARIOS}개까지만 설정할 수 있습니다.`, 'warning');
                    return;
                }
                const nextNum = state.data.costScenarios.length + 1;
                const lastSc = state.data.costScenarios[state.data.costScenarios.length - 1];
                state.data.costScenarios.push({
                    id: fmt.uid('c'),
                    name: `매입 ${nextNum}: 추가 원가안`,
                    desc: '조건별 비교 시나리오',
                    includedCostIds: lastSc ? [...lastSc.includedCostIds] : state.data.costsPool.map(c => c.id),
                    costOverrides: {},
                    includeFinancing: true,
                    financingDaysOverride: ''
                });
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: true });
                showToast(`매입 시나리오 ${nextNum}번이 추가되었습니다.`, 'success');
            });
        }

        // Step 2: 통합 매입 원가 시나리오 테이블 이벤트 위임
        if (els.tableCostScenarioMatrix) {
            els.tableCostScenarioMatrix.addEventListener('input', e => {
                const target = e.target;

                // 시나리오 명칭 / 설명 변경
                if (target.classList.contains('sc-name-input')) {
                    const scIdx = Number(target.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].name = target.value;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: true });
                    }
                    return;
                }
                if (target.classList.contains('sc-desc-input')) {
                    const scIdx = Number(target.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].desc = target.value;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                // 부대비용 마스터 항목명 / 기준단가 입력
                if (target.classList.contains('cost-name-input')) {
                    const costIdx = Number(target.dataset.costIdx);
                    if (state.data.costsPool[costIdx]) {
                        state.data.costsPool[costIdx].name = target.value;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }
                if (target.classList.contains('cost-rate-input')) {
                    const costIdx = Number(target.dataset.costIdx);
                    if (state.data.costsPool[costIdx]) {
                        state.data.costsPool[costIdx].unitRate = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                // 시나리오별 개별 금액 오버라이드 입력
                if (target.classList.contains('sc-override-input')) {
                    const scIdx = Number(target.dataset.scIdx);
                    const costId = target.dataset.costId;
                    const sc = state.data.costScenarios[scIdx];
                    if (sc && costId) {
                        if (!sc.costOverrides) sc.costOverrides = {};
                        sc.costOverrides[costId] = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                // 시나리오별 금융이자 산정일수 오버라이드 입력
                if (target.classList.contains('sc-fin-days-input')) {
                    const scIdx = Number(target.dataset.scIdx);
                    const sc = state.data.costScenarios[scIdx];
                    if (sc) {
                        sc.financingDaysOverride = target.value === '' ? '' : Math.max(0, Number(target.value) || 0);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                }
            });

            els.tableCostScenarioMatrix.addEventListener('change', e => {
                const target = e.target;

                if (target.classList.contains('cost-cat-select')) {
                    const costIdx = Number(target.dataset.costIdx);
                    if (state.data.costsPool[costIdx]) {
                        state.data.costsPool[costIdx].category = target.value;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                if (target.classList.contains('cost-calctype-select')) {
                    const costIdx = Number(target.dataset.costIdx);
                    if (state.data.costsPool[costIdx]) {
                        state.data.costsPool[costIdx].calcType = target.value;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                if (target.classList.contains('chk-cost-toggle')) {
                    const scIdx = Number(target.dataset.scIdx);
                    const costId = target.dataset.costId;
                    const sc = state.data.costScenarios[scIdx];
                    if (sc && costId) {
                        const set = new Set(sc.includedCostIds || []);
                        if (target.checked) set.add(costId);
                        else set.delete(costId);
                        sc.includedCostIds = Array.from(set);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                    return;
                }

                if (target.classList.contains('chk-financing-toggle')) {
                    const scIdx = Number(target.dataset.scIdx);
                    const sc = state.data.costScenarios[scIdx];
                    if (sc) {
                        sc.includeFinancing = target.checked;
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                }
            });

            els.tableCostScenarioMatrix.addEventListener('click', e => {
                // 매입 시나리오 삭제
                const removeScBtn = e.target.closest('.btn-remove-cost-sc');
                if (removeScBtn) {
                    const scIdx = Number(removeScBtn.dataset.scIdx);
                    if (state.data.costScenarios.length <= MIN_SCENARIOS) {
                        showToast('최소 1개 이상의 매입 시나리오가 필요합니다.', 'warning');
                        return;
                    }
                    const removed = state.data.costScenarios.splice(scIdx, 1)[0];
                    clampSelectedCrossIndex();
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: true });
                    showToast(`'${removed.name}' 시나리오가 삭제되었습니다.`);
                    return;
                }

                // 시나리오 전체선택 / 해제
                const selAllBtn = e.target.closest('.btn-sc-select-all');
                if (selAllBtn) {
                    const scIdx = Number(selAllBtn.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].includedCostIds = state.data.costsPool.map(c => c.id);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: false });
                    }
                    return;
                }
                const clrAllBtn = e.target.closest('.btn-sc-clear-all');
                if (clrAllBtn) {
                    const scIdx = Number(clrAllBtn.dataset.scIdx);
                    if (state.data.costScenarios[scIdx]) {
                        state.data.costScenarios[scIdx].includedCostIds = [];
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: false });
                    }
                    return;
                }

                // 특정 부대비용 전체 시나리오 반영
                const applyAllBtn = e.target.closest('.btn-apply-cost-all');
                if (applyAllBtn) {
                    const costId = applyAllBtn.dataset.costId;
                    state.data.costScenarios.forEach(sc => {
                        const set = new Set(sc.includedCostIds || []);
                        set.add(costId);
                        sc.includedCostIds = Array.from(set);
                    });
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: false });
                    showToast('해당 비용을 모든 매입 시나리오에 체크 반영했습니다.');
                    return;
                }

                // 개별 금액 오버라이드 초기화 (기본 산출값 복원)
                const resetOvBtn = e.target.closest('.btn-reset-override');
                if (resetOvBtn) {
                    const scIdx = Number(resetOvBtn.dataset.scIdx);
                    const costId = resetOvBtn.dataset.costId;
                    const sc = state.data.costScenarios[scIdx];
                    if (sc && sc.costOverrides) {
                        delete sc.costOverrides[costId];
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                        showToast('기본 산출 금액 연동으로 복원되었습니다.');
                    }
                    return;
                }

                // 금융이자 일수 오버라이드 초기화
                const resetFinBtn = e.target.closest('.btn-reset-fin-days');
                if (resetFinBtn) {
                    const scIdx = Number(resetFinBtn.dataset.scIdx);
                    const sc = state.data.costScenarios[scIdx];
                    if (sc) {
                        sc.financingDaysOverride = '';
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                        showToast('기본 금융이자 산정일(사업+여신일) 연동으로 복원되었습니다.');
                    }
                    return;
                }

                // 부대비용 항목 삭제
                const removeCostBtn = e.target.closest('.btn-remove-cost');
                if (removeCostBtn) {
                    const costIdx = Number(removeCostBtn.dataset.costIdx);
                    const removed = state.data.costsPool[costIdx];
                    if (!removed) return;
                    state.data.costsPool.splice(costIdx, 1);
                    state.data.costScenarios.forEach(sc => {
                        sc.includedCostIds = (sc.includedCostIds || []).filter(id => id !== removed.id);
                        if (sc.costOverrides) delete sc.costOverrides[removed.id];
                    });
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: true, rebuildSalesCards: false });
                    showToast(`'${removed.name}' 항목이 삭제되었습니다.`);
                }
            });
        }

        // Step 3: 판매 시나리오 추가 (최대 5개)
        if (els.btnAddSalesScenario) {
            els.btnAddSalesScenario.addEventListener('click', () => {
                if (state.data.salesScenarios.length >= MAX_SCENARIOS) {
                    showToast(`판매 시나리오는 최대 ${MAX_SCENARIOS}개까지만 설정할 수 있습니다.`, 'warning');
                    return;
                }
                const nextIdx = state.data.salesScenarios.length;
                const code = fmt.alphaCode(nextIdx);
                const lastSales = state.data.salesScenarios[nextIdx - 1];
                state.data.salesScenarios.push({
                    id: fmt.uid('s'),
                    name: `판매 ${code}: 신규 판가안`,
                    memo: '비교 채널/거래처',
                    targetPrice: lastSales ? Math.round(lastSales.targetPrice * 1.1) : 4000,
                    priceOverrides: {}
                });
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: true });
                showToast(`판매 시나리오 ${code}가 추가되었습니다.`, 'success');
            });
        }

        // Step 3: 판매 시나리오 카드 이벤트 위임
        if (els.salesScenariosContainer) {
            els.salesScenariosContainer.addEventListener('input', e => {
                const target = e.target;
                const sIdx = Number(target.dataset.sIdx);
                if (isNaN(sIdx) || !state.data.salesScenarios[sIdx]) return;
                const sSc = state.data.salesScenarios[sIdx];

                if (target.classList.contains('sales-name-input')) {
                    sSc.name = target.value;
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('sales-memo-input')) {
                    sSc.memo = target.value;
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('sales-price-input')) {
                    sSc.targetPrice = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                } else if (target.classList.contains('sales-cell-price-input')) {
                    const costId = target.dataset.costId;
                    if (costId) {
                        if (!sSc.priceOverrides) sSc.priceOverrides = {};
                        sSc.priceOverrides[costId] = target.value === '' ? 0 : Math.max(0, Number(target.value) || 0);
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                    }
                }
            });

            els.salesScenariosContainer.addEventListener('click', e => {
                // 판매 시나리오 삭제
                const removeSalesBtn = e.target.closest('.btn-remove-sales-sc');
                if (removeSalesBtn) {
                    const sIdx = Number(removeSalesBtn.dataset.sIdx);
                    if (state.data.salesScenarios.length <= MIN_SCENARIOS) {
                        showToast('최소 1개 이상의 판매 시나리오가 필요합니다.', 'warning');
                        return;
                    }
                    const removed = state.data.salesScenarios.splice(sIdx, 1)[0];
                    clampSelectedCrossIndex();
                    recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: true });
                    showToast(`'${removed.name}' 시나리오가 삭제되었습니다.`);
                    return;
                }

                // 특정 매입 시나리오 행의 빠른 역산 버튼 (15%, 20%, 25%, 30%)
                const rowRevBtn = e.target.closest('.btn-row-reverse');
                if (rowRevBtn) {
                    const sIdx = Number(rowRevBtn.dataset.sIdx);
                    const cIdx = Number(rowRevBtn.dataset.costIdx);
                    const marginPct = Number(rowRevBtn.dataset.margin) || 20;
                    const cSc = state.calculated?.matrix?.evaluatedCosts[cIdx];
                    const sSc = state.data.salesScenarios[sIdx];
                    if (cSc && sSc) {
                        const revPrice = SalesMarginEngine.calculateReversePrice(cSc.unitCost, marginPct);
                        //もし 다른 개별 판가가 없다면 공통 판가로 적용해주고, 이미 개별판가를 쓰고 있거나 사용자가 원할 때 반영
                        sSc.targetPrice = revPrice;
                        if (sSc.priceOverrides && sSc.priceOverrides[cSc.id] !== undefined) {
                            sSc.priceOverrides[cSc.id] = revPrice;
                        }
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                        showToast(`${cSc.name}(${fmt.won(cSc.unitCost)}) 기준 ${marginPct}% 마진 역산단가(${fmt.won(revPrice)})가 적용되었습니다.`);
                    }
                    return;
                }

                // 매입별 일괄 맞춤 마진율 역산 버튼
                const perCostBtn = e.target.closest('.btn-apply-margin-per-cost');
                if (perCostBtn) {
                    const sIdx = Number(perCostBtn.dataset.sIdx);
                    const card = perCostBtn.closest('.sales-card');
                    const input = card ? card.querySelector('.custom-margin-input') : null;
                    if (!input || input.value === '') {
                        showToast('적용할 목표 마진율(%)을 입력해 주세요.', 'warning');
                        if (input) input.focus();
                        return;
                    }
                    const marginPct = Number(input.value);
                    if (isNaN(marginPct) || marginPct >= 100) {
                        showToast('마진율은 100% 미만의 숫자로 입력해 주세요.', 'warning');
                        return;
                    }
                    const sSc = state.data.salesScenarios[sIdx];
                    const evaluatedCosts = state.calculated?.matrix?.evaluatedCosts || [];
                    if (sSc && evaluatedCosts.length > 0) {
                        if (!sSc.priceOverrides) sSc.priceOverrides = {};
                        evaluatedCosts.forEach((cSc, idx) => {
                            const revPrice = SalesMarginEngine.calculateReversePrice(cSc.unitCost, marginPct);
                            sSc.priceOverrides[cSc.id] = revPrice;
                            if (idx === 0) sSc.targetPrice = revPrice;
                        });
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                        showToast(`모든 매입 시나리오별로 마진 ${marginPct}% 맞춤 판매단가가 역산 적용되었습니다.`, 'success');
                    }
                    return;
                }

                // 개별 판가 오버라이드 초기화
                const resetSalesOvBtn = e.target.closest('.btn-reset-sales-override');
                if (resetSalesOvBtn) {
                    const sIdx = Number(resetSalesOvBtn.dataset.sIdx);
                    const costId = resetSalesOvBtn.dataset.costId;
                    const sSc = state.data.salesScenarios[sIdx];
                    if (sSc && sSc.priceOverrides) {
                        delete sSc.priceOverrides[costId];
                        recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                        showToast('상단 공통 판매단가 연동으로 복원되었습니다.');
                    }
                }
            });
        }

        // Step 4: 교차 매트릭스 셀 클릭 → 대표 채택안 지정
        if (els.tbodyCrossMatrix) {
            els.tbodyCrossMatrix.addEventListener('click', e => {
                const cell = e.target.closest('.matrix-cell');
                if (!cell) return;
                const costIdx = Number(cell.dataset.costIdx);
                const salesIdx = Number(cell.dataset.salesIdx);
                if (isNaN(costIdx) || isNaN(salesIdx)) return;

                state.data.selectedCrossIndex = { costIdx, salesIdx };
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });

                showToast(`조합 [${costIdx + 1}×${fmt.alphaCode(salesIdx)}]가 대표 채택안(품목별 권장판가 & 기안문 기준)으로 지정되었습니다.`);
            });
        }

        // Step 5: 매입 시나리오 필터 및 각 카드에서 대표안 지정 버튼
        if (els.selectDeepDiveFilter) {
            els.selectDeepDiveFilter.addEventListener('change', e => {
                state.data.deepDiveFilter = e.target.value;
                if (state.calculated) {
                    renderAllCombosDeepDive(state.calculated.matrix);
                }
            });
        }

        if (els.allCombosDeepDiveContainer) {
            els.allCombosDeepDiveContainer.addEventListener('click', e => {
                const pickBtn = e.target.closest('.btn-pick-representative');
                if (!pickBtn) return;
                const costIdx = Number(pickBtn.dataset.costIdx);
                const salesIdx = Number(pickBtn.dataset.salesIdx);
                if (isNaN(costIdx) || isNaN(salesIdx)) return;

                state.data.selectedCrossIndex = { costIdx, salesIdx };
                recalculateAll({ rebuildGoods: false, rebuildCostMatrix: false, rebuildSalesCards: false });
                showToast(`조합 [${costIdx + 1}×${fmt.alphaCode(salesIdx)}]가 대표 채택안으로 설정되었습니다.`, 'success');
            });
        }

        // Step 6: 기안문 수동 입력 및 자동갱신
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
                showToast('시나리오 분석 결과 종합 기안문이 갱신되었습니다.', 'success');
            });
        }

        // 상단 툴바: 기안문 복사, 엑셀, 인쇄, 새로작성, 샘플복원, 저장, 보관함
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
                    }).catch(() => fallbackCopy(text));
                } else {
                    fallbackCopy(text);
                }
            });
        }

        if (els.btnExportCsv) {
            els.btnExportCsv.addEventListener('click', exportToCsv);
        }

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

        if (els.btnNewDoc) {
            els.btnNewDoc.addEventListener('click', () => {
                if (!confirm('새 문서를 작성하시겠습니까? 현재 작성 중인 내용은 초기화됩니다.')) return;
                state.docId = null;
                state.data = normalizeLoadedData({
                    docTitle: '신규 원가·마진·물류 시뮬레이션',
                    includeVat: false,
                    projectMeta: { projectDays: 30, creditDays: 30, annualRatePct: 5.0 },
                    items: [
                        { id: fmt.uid('item'), name: '', spec: '', qty: 1000, unitPrice: 0, unitWeightKg: 0.2, eaPerBox: 50, boxPerPlt: 20 }
                    ],
                    costsPool: [
                        { id: 'cost_1', name: '화물 운송비', category: 'logistics', calcType: 'fixed_once', unitRate: 0 },
                        { id: 'cost_2', name: '창고 보관·임대료', category: 'rent', calcType: 'period_month', unitRate: 0 }
                    ],
                    costScenarios: [
                        { id: 'c1', name: '매입 1: 기본안', desc: '기본 물품대', includedCostIds: [], costOverrides: {}, includeFinancing: false, financingDaysOverride: '' },
                        { id: 'c2', name: '매입 2: 표준안', desc: '운송비 + 이자 반영', includedCostIds: ['cost_1'], costOverrides: {}, includeFinancing: true, financingDaysOverride: '' }
                    ],
                    salesScenarios: [
                        { id: 's1', name: '판매 A: 1차 제안가', memo: '기본 납품처', targetPrice: 0, priceOverrides: {} },
                        { id: 's2', name: '판매 B: 2차 목표가', memo: '표준 납품처', targetPrice: 0, priceOverrides: {} }
                    ],
                    selectedCrossIndex: { costIdx: 0, salesIdx: 0 },
                    remarks: ''
                });
                syncGlobalInputsFromState();
                recalculateAll({ rebuildGoods: true, rebuildCostMatrix: true, rebuildSalesCards: true });
                showToast('새 문서 양식이 준비되었습니다.');
            });
        }

        if (els.btnLoadSample) {
            els.btnLoadSample.addEventListener('click', () => {
                if (!confirm('실무 샘플 데이터를 다시 불러오시겠습니까?')) return;
                state.docId = null;
                state.data = JSON.parse(JSON.stringify(DEFAULT_SEED_DATA));
                syncGlobalInputsFromState();
                recalculateAll({ rebuildGoods: true, rebuildCostMatrix: true, rebuildSalesCards: true });
                const autoText = generateRemarksText();
                if (els.textRemarks) {
                    els.textRemarks.value = autoText;
                    state.data.remarks = autoText;
                }
                showToast('실무 샘플 데이터가 복원되었습니다.', 'success');
            });
        }

        if (els.btnSaveDoc) els.btnSaveDoc.addEventListener('click', saveCurrentDoc);
        if (els.btnOpenSavedModal) els.btnOpenSavedModal.addEventListener('click', openArchiveModal);
        if (els.btnCloseSavedModal) els.btnCloseSavedModal.addEventListener('click', closeArchiveModal);
        if (els.savedModalOverlay) {
            els.savedModalOverlay.addEventListener('click', e => {
                if (e.target === els.savedModalOverlay) closeArchiveModal();
            });
        }

        window.addEventListener('keydown', e => {
            if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
                e.preventDefault();
                saveCurrentDoc();
            } else if (e.key === 'Escape' && els.savedModalOverlay && els.savedModalOverlay.classList.contains('active')) {
                closeArchiveModal();
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
            if (els.textRemarks) state.data.remarks = els.textRemarks.value;
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
            if (existingIdx >= 0) archive[existingIdx] = saveItem;
            else archive.unshift(saveItem);

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
                        state.data = normalizeLoadedData(found.data);
                        state.docId = found.id;
                        syncGlobalInputsFromState();
                        recalculateAll({ rebuildGoods: true, rebuildCostMatrix: true, rebuildSalesCards: true });
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

    // ── 9. CSV 엑셀 내보내기 (물류 규격 및 전 시나리오 포함) ──
    function exportToCsv() {
        if (!state.calculated) return;
        const title = (state.data.docTitle || 'Sales_Simulator').replace(/[\s/\\:]+/g, '_');
        const matrix = state.calculated.matrix;
        const goods = state.calculated.goods;
        const itemized = state.calculated.itemized || [];
        const pm = state.data.projectMeta;

        let csv = '\uFEFF';
        csv += `[K&G 원가·마진·물류 시뮬레이션 보고서 v2.0]\r\n`;
        csv += `검토 건명,"${(state.data.docTitle || '').replace(/"/g, '""')}"\r\n`;
        csv += `검토 일자,${new Date().toISOString().split('T')[0]}\r\n`;
        csv += `사업(보관)기간,${pm.projectDays}일 (${(pm.projectDays / 30).toFixed(1)}개월)\r\n`;
        csv += `납품후 결제여신,+${pm.creditDays}일 (기본 금융이자 산정 ${Number(pm.projectDays) + Number(pm.creditDays)}일 / 연 ${pm.annualRatePct}%)\r\n`;
        csv += `부가세 원가 산입,${state.data.includeVat ? '포함(10%)' : '미포함(공급가액 기준)'}\r\n\r\n`;

        csv += `[1. 물품 매입 내역 및 물류 포장 규격 (EA/BOX, BOX/PLT, 중량)]\r\n`;
        csv += `품목명,규격,수량(EA),매입단가,공급가액,부가세,개별중량(kg),입수량(EA/BOX),총박스(BOX),1박스중량(kg),적재량(BOX/PLT),총파레트(PLT),1파레트중량(kg),품목총중량(kg),대표조합 배부원가,대표조합 권장판가\r\n`;
        goods.items.forEach((it, idx) => {
            const alloc = itemized[idx] || { allocatedUnitCost: it.unitPrice, recommendedUnitPrice: it.unitPrice };
            csv += `"${(it.name || '').replace(/"/g, '""')}","${(it.spec || '').replace(/"/g, '""')}",${it.qty},${it.unitPrice},${it.supplyPrice},${it.vat},${it.unitWeightKg},${it.eaPerBox},${it.boxCount},${it.boxWeightKg},${it.boxPerPlt},${it.pltCount},${it.pltWeightKg},${it.itemTotalWeightKg},${alloc.allocatedUnitCost},${alloc.recommendedUnitPrice}\r\n`;
        });
        csv += `합계/평균,,${goods.totalQty},${goods.avgUnitGoodsPrice},${goods.totalSupplyPrice},${goods.totalVat},,,${goods.totalBoxes},${goods.avgBoxWeightKg},,${goods.totalPlts},${goods.avgPltWeightKg},${goods.totalWeightKg},,\r\n\r\n`;

        csv += `[2. 매입 시나리오별 원가 구성 비교]\r\n`;
        csv += `매입 시나리오명,조건설명,기본 물품대(개당),부대비용(개당),금융이자일수,금융이자(개당),개당 총원가,총 소요원가 합계,고정비 합계,변동비 합계\r\n`;
        matrix.evaluatedCosts.forEach(cSc => {
            csv += `"${(cSc.name || '').replace(/"/g, '""')}","${(cSc.desc || '').replace(/"/g, '""')}",${cSc.unitGoodsCost},${cSc.unitOverhead},${cSc.periodDays}일,${cSc.unitFinancing},${cSc.unitCost},${cSc.totalCost},${cSc.fixedCosts},${cSc.variableCosts}\r\n`;
        });
        csv += `\r\n`;

        csv += `[3. 매입×판매 전체 시나리오 교차 분석 매트릭스]\r\n`;
        csv += `조합코드,매입 시나리오,개당 원가,판매 시나리오,적용 판매단가,개당 마진,마진율(%),원가대비 마크업(%),총 예상 매출액,총 예상 영업이익,BEP 최소수량(EA),BEP 최소매출액\r\n`;
        matrix.matrix.forEach(row => {
            row.cells.forEach(c => {
                const bepStr = c.bepStatus === 'impossible' ? '달성불가(역마진)' : (c.bepStatus === 'immediate' ? '1(즉시흑자)' : c.bepUnits);
                csv += `"${c.comboCode}","${(c.costScenarioName || '').replace(/"/g, '""')}",${c.unitCost},"${(c.salesScenarioName || '').replace(/"/g, '""')}",${c.targetPrice},${c.marginAmount},${c.marginRate}%,${c.markupRate}%,${c.totalRevenue},${c.totalProfit},${bepStr},${c.bepRevenue}\r\n`;
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
        recalculateAll({ rebuildGoods: true, rebuildCostMatrix: true, rebuildSalesCards: true });

        if (els.textRemarks && !state.data.remarks) {
            const initialRemarks = generateRemarksText();
            els.textRemarks.value = initialRemarks;
            state.data.remarks = initialRemarks;
        }
    });

})();
