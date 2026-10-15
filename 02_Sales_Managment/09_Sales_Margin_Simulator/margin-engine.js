/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이션 수학 엔진
 * (Sales & Distribution Cost-Margin Simulation Engine)
 * ══════════════════════════════════════════════════════════════
 * - 물품 대금 매입 산출 (공급가액 및 VAT 선택)
 * - 매입 원가 시나리오 1, 2, 3 (비용 항목 및 금융비용 조합)
 * - 판매가 시나리오 1, 2, 3 (목표 판매단가 or 마진율 역산)
 * - 매입 × 판매 시나리오 경우의 수 교차 분석 (Cross-Scenario Matrix)
 * - 워터폴 브릿지 (Price Waterfall Bridge) 및 손익분기점 (BEP)
 */

export const SalesMarginEngine = {
    /**
     * 1. 물품 대금 (Direct COGS) 산출
     * @param {Array} items - [{ id, name, spec, qty, unitPrice }]
     * @param {boolean} includeVat - 부가세(VAT 10%)를 원가에 산입할지 여부
     * @returns {Object}
     */
    calculateGoodsCost(items = [], includeVat = false) {
        let totalQty = 0;
        let totalSupplyPrice = 0;
        let totalVat = 0;

        const calculatedItems = items.map(item => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
            const supplyPrice = Math.round(qty * unitPrice);
            const vat = Math.round(supplyPrice * 0.1);

            totalQty += qty;
            totalSupplyPrice += supplyPrice;
            totalVat += vat;

            return {
                ...item,
                qty,
                unitPrice,
                supplyPrice,
                vat,
                totalWithVat: supplyPrice + vat
            };
        });

        // 실제 매입 투입 기준액 (부가세 포함 여부 반영)
        const effectiveBase = includeVat ? (totalSupplyPrice + totalVat) : totalSupplyPrice;
        const avgUnitGoodsPrice = totalQty > 0 ? Math.round(effectiveBase / totalQty) : 0;

        return {
            items: calculatedItems,
            totalQty,
            totalSupplyPrice,
            totalVat,
            totalWithVat: totalSupplyPrice + totalVat,
            effectiveBase,
            avgUnitGoodsPrice,
            includeVat
        };
    },

    /**
     * 2. 단일 매입 시나리오에 대한 원가 산출
     * @param {Object} goods - calculateGoodsCost 결과
     * @param {Array} costsPool - 등록된 부대비용 전체 목록 [{ id, name, category, amount, isFixed }]
     * @param {Object} scenarioConfig - { id, name, includedCostIds: [], includeFinancing: bool, periodDays, annualRatePct }
     * @returns {Object}
     */
    evaluateCostScenario(goods, costsPool = [], scenarioConfig = {}) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const includedIds = new Set(scenarioConfig.includedCostIds || []);

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

        costsPool.forEach(c => {
            const isIncluded = includedIds.has(c.id);
            const amount = Math.max(0, Number(c.amount) || 0);
            const unitAmount = Math.round(amount / totalQty);
            const cat = c.category || 'etc';

            if (isIncluded) {
                totalOverhead += amount;
                if (c.isFixed) fixedCosts += amount;
                else variableCosts += amount;

                if (categoryBreakdown.hasOwnProperty(cat)) {
                    categoryBreakdown[cat] += amount;
                } else {
                    categoryBreakdown.etc += amount;
                }

                activeCosts.push({
                    ...c,
                    amount,
                    unitAmount
                });
            }
        });

        // 금융비용 계산
        const includeFinancing = scenarioConfig.includeFinancing !== false;
        const periodDays = Math.max(0, Number(scenarioConfig.periodDays) || 0);
        const annualRatePct = Math.max(0, Number(scenarioConfig.annualRatePct) || 0);

        let financingInterest = 0;
        if (includeFinancing && periodDays > 0 && annualRatePct > 0) {
            const capitalBase = goods.effectiveBase + totalOverhead;
            financingInterest = Math.round(capitalBase * (annualRatePct / 100) * (periodDays / 365));
        }
        const unitFinancing = Math.round(financingInterest / totalQty);

        // 총 소요원가
        const totalCost = goods.effectiveBase + totalOverhead + financingInterest;
        const unitCost = Math.round(totalCost / totalQty);

        return {
            id: scenarioConfig.id,
            name: scenarioConfig.name,
            totalQty,
            goodsTotal: goods.effectiveBase,
            unitGoodsCost: goods.avgUnitGoodsPrice,
            totalOverhead,
            unitOverhead: Math.round(totalOverhead / totalQty),
            activeCosts,
            categoryBreakdown,
            includeFinancing,
            periodDays,
            annualRatePct,
            financingInterest,
            unitFinancing,
            fixedCosts,
            variableCosts,
            totalCost,
            unitCost
        };
    },

    /**
     * 3. 목표 마진율 기준 필요 판매단가 역산 (Reverse Pricing)
     */
    calculateReversePrice(unitCost = 0, targetMarginRate = 20) {
        if (targetMarginRate >= 100) return 0;
        const rateDecimal = Math.max(0, targetMarginRate) / 100;
        return Math.round(unitCost / (1 - rateDecimal));
    },

    /**
     * 4. [핵심] 매입 시나리오 1, 2, 3 × 판매 시나리오 1, 2, 3 경우의 수 교차 분석 (3×3 Matrix)
     * @param {Object} goods - calculateGoodsCost 결과
     * @param {Array} costsPool - 전체 부대비용 풀
     * @param {Array} costScenarios - [Config1, Config2, Config3]
     * @param {Array} salesScenarios - [Sales1, Sales2, Sales3] ({ id, name, targetPrice })
     * @returns {Object}
     */
    calculateCrossMatrix(goods, costsPool, costScenarios = [], salesScenarios = []) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;

        // 1. 매입 시나리오들 평가
        const evaluatedCosts = costScenarios.map(sc => this.evaluateCostScenario(goods, costsPool, sc));

        // 2. 판매 시나리오들 평가
        const evaluatedSales = salesScenarios.map(s => ({
            ...s,
            targetPrice: Math.max(0, Number(s.targetPrice) || 0)
        }));

        // 3. 교차 매트릭스 생성 (3×3 = 9 Cells)
        const matrix = evaluatedCosts.map(cSc => {
            const rowCells = evaluatedSales.map(sSc => {
                const marginAmount = sSc.targetPrice - cSc.unitCost;
                const marginRate = sSc.targetPrice > 0 ? Number(((marginAmount / sSc.targetPrice) * 100).toFixed(1)) : 0;
                const markupRate = cSc.unitCost > 0 ? Number(((marginAmount / cSc.unitCost) * 100).toFixed(1)) : 0;
                const totalRevenue = Math.round(sSc.targetPrice * totalQty);
                const totalProfit = Math.round(marginAmount * totalQty);

                // 손익분기점 (BEP)
                const unitContribution = sSc.targetPrice - (cSc.unitGoodsCost + (cSc.categoryBreakdown.logistics / totalQty) + cSc.unitFinancing);
                let bepUnits = 0;
                if (cSc.fixedCosts > 0 && unitContribution > 0) {
                    bepUnits = Math.ceil(cSc.fixedCosts / unitContribution);
                }

                return {
                    costScenarioId: cSc.id,
                    costScenarioName: cSc.name,
                    unitCost: cSc.unitCost,
                    totalCost: cSc.totalCost,
                    salesScenarioId: sSc.id,
                    salesScenarioName: sSc.name,
                    targetPrice: sSc.targetPrice,
                    marginAmount,
                    marginRate,
                    markupRate,
                    totalRevenue,
                    totalProfit,
                    bepUnits,
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
     * 5. 선택된 조합(매입 시나리오 i + 판매 시나리오 j)에 대한 워터폴 브릿지 생성
     */
    generateWaterfallData(cSc, targetPrice) {
        const steps = [];
        let running = targetPrice;

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
        running -= cSc.unitGoodsCost;
        steps.push({
            id: 'goods',
            label: '물품 매입비',
            amount: cSc.unitGoodsCost,
            delta: -cSc.unitGoodsCost,
            type: 'drop',
            color: '#ef4444'
        });

        // 3. 부대비용 항목별 차감
        const totalQty = cSc.totalQty || 1;
        const unitLogistics = Math.round(cSc.categoryBreakdown.logistics / totalQty);
        const unitRent = Math.round(cSc.categoryBreakdown.rent / totalQty);
        const unitOthers = cSc.unitOverhead - unitLogistics - unitRent;

        if (unitLogistics > 0) {
            running -= unitLogistics;
            steps.push({
                id: 'logistics',
                label: '물류·운송비',
                amount: unitLogistics,
                delta: -unitLogistics,
                type: 'drop',
                color: '#f97316'
            });
        }

        if (unitRent > 0) {
            running -= unitRent;
            steps.push({
                id: 'rent',
                label: '임대·창고료',
                amount: unitRent,
                delta: -unitRent,
                type: 'drop',
                color: '#eab308'
            });
        }

        if (cSc.unitFinancing > 0) {
            running -= cSc.unitFinancing;
            steps.push({
                id: 'financing',
                label: '금융이자',
                amount: cSc.unitFinancing,
                delta: -cSc.unitFinancing,
                type: 'drop',
                color: '#8b5cf6'
            });
        }

        if (unitOthers > 0) {
            running -= unitOthers;
            steps.push({
                id: 'others',
                label: '기타운영비',
                amount: unitOthers,
                delta: -unitOthers,
                type: 'drop',
                color: '#64748b'
            });
        }

        // 최종 마진
        const marginRate = targetPrice > 0 ? Number(((running / targetPrice) * 100).toFixed(1)) : 0;
        steps.push({
            id: 'profit',
            label: `최종 마진 (${marginRate}%)`,
            amount: running,
            delta: running,
            type: 'end',
            color: running >= 0 ? '#10b981' : '#dc2626'
        });

        return steps;
    }
};
