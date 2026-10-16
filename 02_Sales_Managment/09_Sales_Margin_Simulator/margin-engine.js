/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이션 수학 엔진 v2.0
 * (Sales & Distribution Cost-Margin Simulation Engine)
 * ══════════════════════════════════════════════════════════════
 * - 프로젝트 공통 조건: 사업(보관)기간(일/개월), 대금회수(여신) 추가일, 연 이자율
 * - 물품 대금 및 물류 포장 규격 산출: EA/BOX, BOX/PLT, 개별중량(kg) 기반
 *   총 박스수, 박스중량, 총 파레트수, 파레트중량, 총 출고중량(kg/ton) 자동 계산
 * - 매입 원가 시나리오 (1~5개 가변):
 *   산출기준(1회고정비 / 월기간비 / EA당 / BOX당 / PLT당 / 변동총액) 자동 연동 및
 *   시나리오별 개별 금액 오버라이드(Override), 시나리오별 금융이자 일수 오버라이드 지원
 * - 판매가 시나리오 (1~5개 가변):
 *   자유 명칭 설정, 단일 목표판가 및 매입 시나리오별 개별 판가 오버라이드 / 마진율 역산 지원
 * - 매입(M) × 판매(N) 전체 경우의 수 교차 분석 매트릭스 및 전 조합 워터폴·BEP·품목별 권장단가 산출
 */

export const SalesMarginEngine = {
    /**
     * 1. 물품 대금 (Direct COGS) 및 물류·포장 규격(BOX, PLT, 중량) 산출
     * @param {Array} items - [{ id, name, spec, qty, unitPrice, unitWeightKg, eaPerBox, boxPerPlt }]
     * @param {boolean} includeVat - 부가세(VAT 10%)를 원가에 산입할지 여부
     * @returns {Object}
     */
    calculateGoodsCost(items = [], includeVat = false) {
        let totalQty = 0;
        let totalSupplyPrice = 0;
        let totalVat = 0;
        let totalBoxes = 0;
        let totalPlts = 0;
        let totalWeightKg = 0;

        const calculatedItems = items.map(item => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
            const supplyPrice = Math.round(qty * unitPrice);
            const vat = Math.round(supplyPrice * 0.1);

            // 물류 포장단위 및 중량 계산
            const unitWeightKg = Math.max(0, Number(item.unitWeightKg) || 0);
            const eaPerBox = Math.max(0, Math.floor(Number(item.eaPerBox) || 0));
            const boxPerPlt = Math.max(0, Math.floor(Number(item.boxPerPlt) || 0));

            const boxCount = eaPerBox > 0 && qty > 0 ? Math.ceil(qty / eaPerBox) : 0;
            const boxWeightKg = eaPerBox > 0 ? Number((unitWeightKg * eaPerBox).toFixed(2)) : 0;
            const pltCount = boxPerPlt > 0 && boxCount > 0 ? Math.ceil(boxCount / boxPerPlt) : 0;
            const pltWeightKg = boxPerPlt > 0 ? Number((boxWeightKg * boxPerPlt).toFixed(1)) : 0;
            const itemTotalWeightKg = Number((qty * unitWeightKg).toFixed(1));

            totalQty += qty;
            totalSupplyPrice += supplyPrice;
            totalVat += vat;
            totalBoxes += boxCount;
            totalPlts += pltCount;
            totalWeightKg += itemTotalWeightKg;

            return {
                ...item,
                qty,
                unitPrice,
                supplyPrice,
                vat,
                totalWithVat: supplyPrice + vat,
                unitWeightKg,
                eaPerBox,
                boxPerPlt,
                boxCount,
                boxWeightKg,
                pltCount,
                pltWeightKg,
                itemTotalWeightKg
            };
        });

        // 실제 매입 투입 기준액 (부가세 포함 여부 반영)
        const effectiveBase = includeVat ? (totalSupplyPrice + totalVat) : totalSupplyPrice;
        const avgUnitGoodsPrice = totalQty > 0 ? Math.round(effectiveBase / totalQty) : 0;
        const avgBoxWeightKg = totalBoxes > 0 ? Number((totalWeightKg / totalBoxes).toFixed(1)) : 0;
        const avgPltWeightKg = totalPlts > 0 ? Number((totalWeightKg / totalPlts).toFixed(1)) : 0;
        const totalWeightTon = Number((totalWeightKg / 1000).toFixed(2));

        return {
            items: calculatedItems,
            totalQty,
            totalSupplyPrice,
            totalVat,
            totalWithVat: totalSupplyPrice + totalVat,
            effectiveBase,
            avgUnitGoodsPrice,
            includeVat,
            totalBoxes,
            totalPlts,
            totalWeightKg: Number(totalWeightKg.toFixed(1)),
            totalWeightTon,
            avgBoxWeightKg,
            avgPltWeightKg
        };
    },

    /**
     * 부대비용 항목의 산출기준(calcType)에 따른 기본 총 소요금액 및 고정/변동 성격 판별
     * calcType 종류:
     * - 'fixed_once'   : 1회성 고정 총액 (고정비 - BEP 분자)
     * - 'period_month' : 월 단위 기간비 = unitRate * 사업개월수 (고정비 - BEP 분자)
     * - 'per_ea'       : 개당 변동비 = unitRate * 총수량(EA) (변동비)
     * - 'per_box'      : 박스당 변동비 = unitRate * 총박스(BOX) (변동비)
     * - 'per_plt'      : 파레트당 변동비 = unitRate * 총파레트(PLT) (변동비)
     * - 'var_total'    : 변동비 총액 직접입력 (변동비 - 하위 호환용)
     */
    computeBaseCostItem(costItem, goods, projectMeta = {}) {
        const calcType = costItem.calcType || (costItem.isFixed ? 'fixed_once' : 'var_total');
        const rawRate = Math.max(0, Number(costItem.unitRate !== undefined ? costItem.unitRate : costItem.amount) || 0);

        const projectDays = Math.max(0, Number(projectMeta.projectDays ?? 30) || 0);
        const projectMonths = Number((projectDays / 30).toFixed(2));

        let computedAmount = 0;
        let isFixed = false;
        let formulaDesc = '';

        switch (calcType) {
            case 'fixed_once':
                computedAmount = Math.round(rawRate);
                isFixed = true;
                formulaDesc = `1회 고정 (${computedAmount.toLocaleString()}원)`;
                break;
            case 'period_month':
                computedAmount = Math.round(rawRate * projectMonths);
                isFixed = true;
                formulaDesc = `월 ${rawRate.toLocaleString()}원 × ${projectMonths}개월(${projectDays}일)`;
                break;
            case 'per_ea':
                computedAmount = Math.round(rawRate * (goods.totalQty || 0));
                isFixed = false;
                formulaDesc = `개당 ${rawRate.toLocaleString()}원 × ${(goods.totalQty || 0).toLocaleString()}EA`;
                break;
            case 'per_box':
                computedAmount = Math.round(rawRate * (goods.totalBoxes || 0));
                isFixed = false;
                formulaDesc = `박스당 ${rawRate.toLocaleString()}원 × ${(goods.totalBoxes || 0).toLocaleString()}BOX`;
                break;
            case 'per_plt':
                computedAmount = Math.round(rawRate * (goods.totalPlts || 0));
                isFixed = false;
                formulaDesc = `PLT당 ${rawRate.toLocaleString()}원 × ${(goods.totalPlts || 0).toLocaleString()}PLT`;
                break;
            case 'var_total':
            default:
                computedAmount = Math.round(rawRate);
                isFixed = false;
                formulaDesc = `변동 총액 (${computedAmount.toLocaleString()}원)`;
                break;
        }

        return {
            calcType,
            unitRate: rawRate,
            baseAmount: computedAmount,
            isFixed,
            formulaDesc
        };
    },

    /**
     * 2. 단일 매입 시나리오에 대한 원가 산출 (시나리오별 개별 금액 오버라이드 및 기간 오버라이드 지원)
     * @param {Object} goods - calculateGoodsCost 결과
     * @param {Array} costsPool - 등록된 부대비용 전체 목록
     * @param {Object} scenarioConfig - { id, name, desc, includedCostIds: [], costOverrides: { [costId]: number }, includeFinancing: bool, financingDaysOverride: number|null, projectDaysOverride: number|null }
     * @param {Object} projectMeta - { projectDays, creditDays, annualRatePct }
     * @returns {Object}
     */
    evaluateCostScenario(goods, costsPool = [], scenarioConfig = {}, projectMeta = {}) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const includedIds = new Set(scenarioConfig.includedCostIds || []);
        const costOverrides = scenarioConfig.costOverrides || {};

        // 시나리오별 사업(보관)일수 오버라이드 지원
        const effectiveProjectDays = (scenarioConfig.projectDaysOverride !== undefined && scenarioConfig.projectDaysOverride !== null && scenarioConfig.projectDaysOverride !== '')
            ? Math.max(0, Number(scenarioConfig.projectDaysOverride) || 0)
            : Math.max(0, Number(projectMeta.projectDays ?? 30) || 0);

        const creditDays = Math.max(0, Number(projectMeta.creditDays ?? 30) || 0);
        const defaultFinancingDays = effectiveProjectDays + creditDays;

        // 시나리오별 금융이자 적용일수 (오버라이드가 있으면 사용, 없으면 사업기간 + 여신기간)
        const effectiveFinancingDays = (scenarioConfig.financingDaysOverride !== undefined && scenarioConfig.financingDaysOverride !== null && scenarioConfig.financingDaysOverride !== '')
            ? Math.max(0, Number(scenarioConfig.financingDaysOverride) || 0)
            : (scenarioConfig.periodDays !== undefined && projectMeta.projectDays === undefined
                ? Math.max(0, Number(scenarioConfig.periodDays) || 0)
                : defaultFinancingDays);

        const annualRatePct = Math.max(0, Number(projectMeta.annualRatePct ?? scenarioConfig.annualRatePct ?? 5.0) || 0);

        let totalOverhead = 0;
        let fixedCosts = 0;
        let variableCosts = 0;

        const categoryBreakdown = {
            logistics: 0,
            rent: 0,
            packaging: 0,
            labor: 0,
            fee: 0,
            etc: 0
        };

        const activeCosts = [];
        const evaluatedPoolForScenario = [];

        costsPool.forEach(c => {
            const isIncluded = includedIds.has(c.id);
            const baseComputed = this.computeBaseCostItem(c, goods, {
                ...projectMeta,
                projectDays: effectiveProjectDays
            });

            const hasOverride = costOverrides[c.id] !== undefined && costOverrides[c.id] !== null && costOverrides[c.id] !== '';
            const effectiveAmount = hasOverride ? Math.max(0, Math.round(Number(costOverrides[c.id]) || 0)) : baseComputed.baseAmount;
            const unitAmount = Math.round(effectiveAmount / totalQty);
            const cat = c.category || 'etc';

            const itemDetail = {
                ...c,
                ...baseComputed,
                isIncluded,
                hasOverride,
                overrideAmount: hasOverride ? effectiveAmount : null,
                amount: isIncluded ? effectiveAmount : 0,
                effectiveAmount,
                unitAmount
            };

            evaluatedPoolForScenario.push(itemDetail);

            if (isIncluded) {
                totalOverhead += effectiveAmount;
                if (baseComputed.isFixed) fixedCosts += effectiveAmount;
                else variableCosts += effectiveAmount;

                if (categoryBreakdown.hasOwnProperty(cat)) {
                    categoryBreakdown[cat] += effectiveAmount;
                } else {
                    categoryBreakdown.etc += effectiveAmount;
                }

                activeCosts.push(itemDetail);
            }
        });

        // 금융비용 계산
        const includeFinancing = scenarioConfig.includeFinancing !== false;
        let financingInterest = 0;
        const capitalBase = goods.effectiveBase + totalOverhead;
        const potentialFinancingInterest = (effectiveFinancingDays > 0 && annualRatePct > 0)
            ? Math.round(capitalBase * (annualRatePct / 100) * (effectiveFinancingDays / 365))
            : 0;

        if (includeFinancing) {
            financingInterest = potentialFinancingInterest;
        }
        const unitFinancing = Math.round(financingInterest / totalQty);
        const potentialUnitFinancing = Math.round(potentialFinancingInterest / totalQty);

        // 총 소요원가
        const totalCost = goods.effectiveBase + totalOverhead + financingInterest;
        const unitCost = Math.round(totalCost / totalQty);
        const unitVariableCost = Math.round((goods.effectiveBase + variableCosts + financingInterest) / totalQty);
        const unitFixedCost = Math.round(fixedCosts / totalQty);

        return {
            id: scenarioConfig.id,
            name: scenarioConfig.name,
            desc: scenarioConfig.desc || '',
            totalQty,
            goodsTotal: goods.effectiveBase,
            unitGoodsCost: goods.avgUnitGoodsPrice,
            totalOverhead,
            unitOverhead: Math.round(totalOverhead / totalQty),
            activeCosts,
            evaluatedPoolForScenario,
            categoryBreakdown,
            includeFinancing,
            effectiveProjectDays,
            defaultFinancingDays,
            periodDays: effectiveFinancingDays,
            hasFinancingDaysOverride: scenarioConfig.financingDaysOverride !== undefined && scenarioConfig.financingDaysOverride !== null && scenarioConfig.financingDaysOverride !== '',
            annualRatePct,
            financingInterest,
            potentialFinancingInterest,
            unitFinancing,
            potentialUnitFinancing,
            fixedCosts,
            variableCosts,
            unitVariableCost,
            unitFixedCost,
            totalCost,
            unitCost
        };
    },

    /**
     * 3. 목표 마진율 기준 필요 판매단가 역산 (Reverse Pricing)
     * 판매단가 = 원가 / (1 - 목표마진율)
     */
    calculateReversePrice(unitCost = 0, targetMarginRate = 20) {
        const rate = Number(targetMarginRate);
        if (isNaN(rate) || rate >= 100) return 0;
        const rateDecimal = Math.max(-99, rate) / 100;
        return Math.round(unitCost / (1 - rateDecimal));
    },

    /**
     * 4. [핵심] 매입 시나리오 (1~5) × 판매 시나리오 (1~5) 경우의 수 교차 분석 (M×N Matrix)
     * 판매 시나리오가 매입 시나리오별 개별 판가 오버라이드(priceOverridesByCostId)를 가진 경우 이를 반영함.
     */
    calculateCrossMatrix(goods, costsPool, costScenarios = [], salesScenarios = [], projectMeta = {}) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;

        // 1. 매입 시나리오들 평가 (1~5개)
        const evaluatedCosts = costScenarios.map(sc => this.evaluateCostScenario(goods, costsPool, sc, projectMeta));

        // 2. 판매 시나리오들 평가 (1~5개)
        const evaluatedSales = salesScenarios.map(s => ({
            ...s,
            targetPrice: Math.max(0, Number(s.targetPrice) || 0),
            priceOverrides: s.priceOverrides || {}
        }));

        // 3. 교차 매트릭스 생성 (M × N Cells)
        const matrix = evaluatedCosts.map((cSc, costIdx) => {
            const rowCells = evaluatedSales.map((sSc, salesIdx) => {
                // 해당 매입 시나리오에 대해 개별 지정된 판가가 있으면 우선 적용, 없으면 기본 targetPrice 사용
                const hasCustomPrice = sSc.priceOverrides && sSc.priceOverrides[cSc.id] !== undefined && sSc.priceOverrides[cSc.id] !== null && sSc.priceOverrides[cSc.id] !== '';
                const effectiveTargetPrice = hasCustomPrice
                    ? Math.max(0, Math.round(Number(sSc.priceOverrides[cSc.id]) || 0))
                    : sSc.targetPrice;

                const totalRevenue = Math.round(effectiveTargetPrice * totalQty);
                const totalProfit = totalRevenue - cSc.totalCost;
                const marginAmount = effectiveTargetPrice - cSc.unitCost;
                const marginRate = totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;
                const markupRate = cSc.totalCost > 0 ? Number(((totalProfit / cSc.totalCost) * 100).toFixed(1)) : 0;

                // 손익분기점 (BEP) 정밀 계산:
                // 개당 변동비 = (물품대 + 부대비용 중 변동비 합계 + 금융이자) / 총수량
                const exactUnitVariable = (cSc.goodsTotal + cSc.variableCosts + cSc.financingInterest) / totalQty;
                const unitContribution = Math.round(effectiveTargetPrice - exactUnitVariable);
                const exactContribution = effectiveTargetPrice - exactUnitVariable;
                const contributionRate = effectiveTargetPrice > 0 ? Number(((exactContribution / effectiveTargetPrice) * 100).toFixed(1)) : 0;

                let bepUnits = 0;
                let bepStatus = 'immediate'; // 'normal' | 'immediate' | 'impossible'

                if (exactContribution <= 0) {
                    bepUnits = -1;
                    bepStatus = 'impossible';
                } else if (cSc.fixedCosts > 0) {
                    bepUnits = Math.ceil(cSc.fixedCosts / exactContribution);
                    bepStatus = 'normal';
                } else {
                    bepUnits = 0;
                    bepStatus = 'immediate';
                }

                // 이 조합에 대한 품목별 배부원가 및 권장 납품단가
                const itemized = this.calculateItemizedAllocation(goods, cSc, { targetPrice: effectiveTargetPrice });

                // 이 조합에 대한 워터폴 스텝
                const waterfallSteps = this.generateWaterfallData(cSc, effectiveTargetPrice);

                return {
                    costIdx,
                    salesIdx,
                    comboCode: `${costIdx + 1}×${String.fromCharCode(65 + salesIdx)}`,
                    costScenarioId: cSc.id,
                    costScenarioName: cSc.name,
                    unitCost: cSc.unitCost,
                    totalCost: cSc.totalCost,
                    fixedCosts: cSc.fixedCosts,
                    variableCosts: cSc.variableCosts,
                    unitVariableCost: cSc.unitVariableCost,
                    unitFixedCost: cSc.unitFixedCost,
                    salesScenarioId: sSc.id,
                    salesScenarioName: sSc.name,
                    salesScenarioMemo: sSc.memo || '',
                    targetPrice: effectiveTargetPrice,
                    baseTargetPrice: sSc.targetPrice,
                    hasCustomPrice,
                    marginAmount,
                    marginRate,
                    markupRate,
                    totalRevenue,
                    totalProfit,
                    unitContribution,
                    contributionRate,
                    bepUnits,
                    bepRevenue: bepUnits > 0 ? Math.round(bepUnits * effectiveTargetPrice) : (bepStatus === 'immediate' ? effectiveTargetPrice : 0),
                    bepStatus,
                    itemized,
                    waterfallSteps,
                    isHealthy: marginRate >= 18.0,
                    isWarning: marginRate >= 10.0 && marginRate < 18.0,
                    isDanger: marginRate < 10.0
                };
            });

            return {
                costScenario: cSc,
                cells: rowCells
            };
        });

        return {
            evaluatedCosts,
            evaluatedSales,
            matrix
        };
    },

    /**
     * 5. 다품목 개별 품목의 배부원가 및 선택 시나리오 기준 권장 판매단가 산출
     */
    calculateItemizedAllocation(goods, cSc, sSc) {
        if (!goods || !goods.items) return [];
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const baseSupplyTotal = goods.totalSupplyPrice || 0;
        const costMultiplier = baseSupplyTotal > 0 && cSc ? (cSc.totalCost / baseSupplyTotal) : 1;
        const targetPrice = sSc ? (sSc.targetPrice || 0) : 0;
        const priceMultiplier = cSc && cSc.totalCost > 0 && sSc ? ((targetPrice * totalQty) / cSc.totalCost) : 1;

        return goods.items.map(item => {
            const allocatedUnitCost = Math.round(item.unitPrice * costMultiplier);
            const recommendedUnitPrice = Math.round(allocatedUnitCost * priceMultiplier);
            const itemMargin = recommendedUnitPrice - allocatedUnitCost;
            return {
                ...item,
                allocatedUnitCost,
                recommendedUnitPrice,
                itemMargin
            };
        });
    },

    /**
     * 6. 조합(매입 시나리오 cSc + 목표 판매단가 targetPrice)에 대한 워터폴 브릿지 생성
     */
    generateWaterfallData(cSc, targetPrice) {
        const steps = [];
        const totalQty = cSc.totalQty || 1;

        // 1. 판매가 시작
        steps.push({
            id: 'revenue',
            label: '판매단가',
            amount: targetPrice,
            delta: targetPrice,
            type: 'start',
            color: '#2563eb'
        });

        // 2. 물품대 차감
        steps.push({
            id: 'goods',
            label: '물품매입',
            amount: cSc.unitGoodsCost,
            delta: -cSc.unitGoodsCost,
            type: 'drop',
            color: '#ef4444'
        });

        // 3. 부대비용 항목별 차감
        const unitLogistics = Math.round(cSc.categoryBreakdown.logistics / totalQty);
        const unitRent = Math.round(cSc.categoryBreakdown.rent / totalQty);
        const unitPackaging = Math.round(cSc.categoryBreakdown.packaging / totalQty);
        const unitOthers = Math.max(0, cSc.unitOverhead - unitLogistics - unitRent - unitPackaging);

        if (unitLogistics > 0) {
            steps.push({
                id: 'logistics',
                label: '물류·운송',
                amount: unitLogistics,
                delta: -unitLogistics,
                type: 'drop',
                color: '#f97316'
            });
        }

        if (unitRent > 0) {
            steps.push({
                id: 'rent',
                label: '임대·창고',
                amount: unitRent,
                delta: -unitRent,
                type: 'drop',
                color: '#eab308'
            });
        }

        if (unitPackaging > 0) {
            steps.push({
                id: 'packaging',
                label: '포장·라벨',
                amount: unitPackaging,
                delta: -unitPackaging,
                type: 'drop',
                color: '#06b6d4'
            });
        }

        if (unitOthers > 0) {
            steps.push({
                id: 'others',
                label: '기타부대',
                amount: unitOthers,
                delta: -unitOthers,
                type: 'drop',
                color: '#64748b'
            });
        }

        if (cSc.unitFinancing > 0) {
            steps.push({
                id: 'financing',
                label: '금융이자',
                amount: cSc.unitFinancing,
                delta: -cSc.unitFinancing,
                type: 'drop',
                color: '#8b5cf6'
            });
        }

        // 최종 마진
        const finalMargin = targetPrice - cSc.unitCost;
        const totalRevenue = Math.round(targetPrice * totalQty);
        const totalProfit = totalRevenue - cSc.totalCost;
        const marginRate = totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;

        steps.push({
            id: 'profit',
            label: `마진(${marginRate}%)`,
            amount: finalMargin,
            delta: finalMargin,
            type: 'end',
            color: finalMargin >= 0 ? '#10b981' : '#dc2626'
        });

        return steps;
    }
};
