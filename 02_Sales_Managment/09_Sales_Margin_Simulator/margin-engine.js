/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 영업관리 원가·마진 시뮬레이션 수학 엔진
 * (Sales & Distribution Cost-Margin Simulation Engine)
 * ══════════════════════════════════════════════════════════════
 * 순수 함수(Pure Functions)로 설계되어 UI 프레임워크와 독립적으로 동작하며,
 * 물품대금 멀티 행 계산, 운전자본 금융비용, 비용 What-If 토글,
 * 손익분기점(BEP), 마진 역산, 워터폴 브릿지, 민감도 매트릭스를 처리합니다.
 */

export const SalesMarginEngine = {
    /**
     * 1. 물품 대금 (Direct COGS) 산출
     * @param {Array} items - [{ id, name, spec, qty, unitPrice }]
     * @param {string} vatMode - 'exclude' (공급가액 전용) | 'include' (부가세 10% 포함)
     * @returns {Object}
     */
    calculateGoodsCost(items = [], vatMode = 'exclude') {
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

        const totalWithVat = totalSupplyPrice + totalVat;
        const avgUnitGoodsPrice = totalQty > 0 ? Math.round(totalSupplyPrice / totalQty) : 0;
        const avgUnitGoodsWithVat = totalQty > 0 ? Math.round(totalWithVat / totalQty) : 0;

        return {
            items: calculatedItems,
            totalQty,
            totalSupplyPrice,
            totalVat,
            totalWithVat,
            avgUnitGoodsPrice,
            avgUnitGoodsWithVat,
            vatMode
        };
    },

    /**
     * 2. 부대비용 및 운영비 (Overhead & Operating Costs) 산출 및 What-If 시뮬레이션
     * @param {Array} costs - [{ id, name, category, amount, isEnabled, isFixed }]
     * @param {number} totalQty - 기준 총 수량
     * @returns {Object}
     */
    calculateOtherCosts(costs = [], totalQty = 1) {
        let totalAllCosts = 0;
        let totalEnabledCosts = 0;
        let fixedCosts = 0;
        let variableCosts = 0;

        const categoryTotals = {
            rent: 0,        // 임대/창고료
            logistics: 0,   // 물류/운송비
            labor: 0,       // 인건/외주비
            packaging: 0,   // 포장/자재비
            fee: 0,         // 영업/결제수수료
            etc: 0          // 기타비용
        };

        const calculatedCosts = costs.map(c => {
            const amount = Math.max(0, Number(c.amount) || 0);
            const isEnabled = c.isEnabled !== false;
            const category = c.category || 'etc';
            const isFixed = !!c.isFixed;

            totalAllCosts += amount;

            if (isEnabled) {
                totalEnabledCosts += amount;
                if (categoryTotals.hasOwnProperty(category)) {
                    categoryTotals[category] += amount;
                } else {
                    categoryTotals.etc += amount;
                }

                if (isFixed) {
                    fixedCosts += amount;
                } else {
                    variableCosts += amount;
                }
            }

            const unitAmount = totalQty > 0 ? Math.round(amount / totalQty) : 0;

            return {
                ...c,
                amount,
                isEnabled,
                unitAmount
            };
        });

        const unitEnabledCost = totalQty > 0 ? Math.round(totalEnabledCosts / totalQty) : 0;

        return {
            costs: calculatedCosts,
            totalAllCosts,
            totalEnabledCosts,
            unitEnabledCost,
            fixedCosts,
            variableCosts,
            categoryTotals
        };
    },

    /**
     * 3. 운전자본 금융비용 (Working Capital Financing Cost) 산출
     * @param {number} baseAmount - 투입 자본 기준 (물품대 + 부대비용)
     * @param {number} periodDays - 자금 회수 기간 (DSO, 일수)
     * @param {number} annualRatePct - 적용 연이자율 (%)
     * @param {number} totalQty - 기준 총 수량
     * @param {boolean} isEnabled - 금융비용 산입 여부 토글
     * @returns {Object}
     */
    calculateFinancingCost(baseAmount = 0, periodDays = 60, annualRatePct = 5.0, totalQty = 1, isEnabled = true) {
        const safeBase = Math.max(0, Number(baseAmount) || 0);
        const safeDays = Math.max(0, Number(periodDays) || 0);
        const safeRate = Math.max(0, Number(annualRatePct) || 0);

        // 일할 계산 공식: Base × (연이자율 / 100) × (회수기간 / 365)
        const rawInterest = safeBase * (safeRate / 100) * (safeDays / 365);
        const totalInterest = Math.round(rawInterest);
        const effectiveInterest = isEnabled ? totalInterest : 0;
        const unitFinancingCost = (isEnabled && totalQty > 0) ? Math.round(effectiveInterest / totalQty) : 0;

        return {
            baseAmount: safeBase,
            periodDays: safeDays,
            annualRatePct: safeRate,
            totalInterest,
            effectiveInterest,
            unitFinancingCost,
            isEnabled
        };
    },

    /**
     * 4. 종합 최종 투입원가 (Total Delivered / Landed Cost) 집계
     * @param {Object} goods - calculateGoodsCost 결과
     * @param {Object} otherCosts - calculateOtherCosts 결과
     * @param {Object} financing - calculateFinancingCost 결과
     * @returns {Object}
     */
    calculateTotalCostSummary(goods, otherCosts, financing) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;
        const goodsTotal = goods.totalSupplyPrice || 0;
        const otherTotal = otherCosts.totalEnabledCosts || 0;
        const financingTotal = financing.effectiveInterest || 0;

        const totalCost = goodsTotal + otherTotal + financingTotal;
        const unitCost = Math.round(totalCost / totalQty);

        // 원가 구성비 (%)
        const safeTotal = totalCost > 0 ? totalCost : 1;
        const breakdownRatio = {
            goods: Number(((goodsTotal / safeTotal) * 100).toFixed(1)),
            logistics: Number(((otherCosts.categoryTotals.logistics / safeTotal) * 100).toFixed(1)),
            rent: Number(((otherCosts.categoryTotals.rent / safeTotal) * 100).toFixed(1)),
            financing: Number(((financingTotal / safeTotal) * 100).toFixed(1)),
            labor: Number(((otherCosts.categoryTotals.labor / safeTotal) * 100).toFixed(1)),
            fee: Number(((otherCosts.categoryTotals.fee / safeTotal) * 100).toFixed(1)),
            etc: Number((((otherCosts.categoryTotals.packaging + otherCosts.categoryTotals.etc) / safeTotal) * 100).toFixed(1))
        };

        return {
            totalQty: goods.totalQty,
            goodsTotal,
            otherTotal,
            financingTotal,
            totalCost,
            unitCost,
            breakdownRatio
        };
    },

    /**
     * 5. 채널별 목표 판매가 및 수익성/마진 분석
     * @param {Array} channels - [{ channelId, channelName, targetPrice, note }]
     * @param {number} unitCost - 개당 최종 종합원가
     * @param {number} totalQty - 기준 총 수량
     * @returns {Array}
     */
    calculateChannelProfitability(channels = [], unitCost = 0, totalQty = 1) {
        return channels.map(ch => {
            const targetPrice = Math.max(0, Number(ch.targetPrice) || 0);
            const marginAmount = targetPrice - unitCost;
            const marginRate = targetPrice > 0 ? Number(((marginAmount / targetPrice) * 100).toFixed(1)) : 0;
            const markupRate = unitCost > 0 ? Number(((marginAmount / unitCost) * 100).toFixed(1)) : 0;
            const costRate = targetPrice > 0 ? Number(((unitCost / targetPrice) * 100).toFixed(1)) : 0;

            const totalRevenue = Math.round(targetPrice * totalQty);
            const totalProfit = Math.round(marginAmount * totalQty);

            return {
                ...ch,
                targetPrice,
                unitCost,
                marginAmount,
                marginRate,
                markupRate,
                costRate,
                totalRevenue,
                totalProfit,
                isDanger: marginRate < 10.0,
                isWarning: marginRate >= 10.0 && marginRate < 18.0,
                isHealthy: marginRate >= 18.0
            };
        });
    },

    /**
     * 6. 목표 마진율 기준 필요 판매단가 역산 (Reverse Pricing)
     * @param {number} unitCost - 개당 원가
     * @param {number} targetMarginRate - 목표 마진율 (%)
     * @returns {number}
     */
    calculateReversePriceByMargin(unitCost = 0, targetMarginRate = 20) {
        if (targetMarginRate >= 100) return 0;
        const rateDecimal = Math.max(0, targetMarginRate) / 100;
        return Math.round(unitCost / (1 - rateDecimal));
    },

    /**
     * 7. 마크업률(Markup %) 기준 판매단가 산출
     * @param {number} unitCost - 개당 원가
     * @param {number} markupRate - 마크업률 (%)
     * @returns {number}
     */
    calculatePriceByMarkup(unitCost = 0, markupRate = 25) {
        const rateDecimal = Math.max(0, markupRate) / 100;
        return Math.round(unitCost * (1 + rateDecimal));
    },

    /**
     * 8. 금융비용 고려 손익분기점 (Financing-Adjusted BEP) 산출
     * @param {number} fixedCosts - 총 고정비 (임대료, 일반관리비 등)
     * @param {number} variableCostPerUnit - 개당 변동비 (물품대 + 운송/포장비 + 개당 금융비용)
     * @param {number} sellingPrice - 판매 단가
     * @returns {Object}
     */
    calculateBEP(fixedCosts = 0, variableCostPerUnit = 0, sellingPrice = 0) {
        const unitContribution = sellingPrice - variableCostPerUnit; // 개당 공헌이익
        const contributionMarginRate = sellingPrice > 0 ? (unitContribution / sellingPrice) : 0;

        let bepUnits = 0;
        let bepRevenue = 0;

        if (unitContribution > 0) {
            bepUnits = Math.ceil(fixedCosts / unitContribution);
            bepRevenue = bepUnits * sellingPrice;
        }

        return {
            fixedCosts,
            variableCostPerUnit,
            sellingPrice,
            unitContribution,
            contributionMarginRate: Number((contributionMarginRate * 100).toFixed(1)),
            bepUnits,
            bepRevenue,
            isFeasible: unitContribution > 0
        };
    },

    /**
     * 9. 글로벌 표준 마진 워터폴 (Price Waterfall Bridge) 데이터셋 생성
     * @param {number} sellingPrice - 목표 판매가
     * @param {Object} totalSummary - calculateTotalCostSummary 결과
     * @param {Object} otherSummary - calculateOtherCosts 결과
     * @returns {Array} [{ label, value, type: 'start'|'drop'|'end', runningTotal }]
     */
    generateWaterfallData(sellingPrice, totalSummary, otherSummary) {
        const totalQty = totalSummary.totalQty > 0 ? totalSummary.totalQty : 1;
        const unitGoods = Math.round(totalSummary.goodsTotal / totalQty);
        const unitLogistics = Math.round(otherSummary.categoryTotals.logistics / totalQty);
        const unitRent = Math.round(otherSummary.categoryTotals.rent / totalQty);
        const unitFinancing = Math.round(totalSummary.financingTotal / totalQty);
        const unitOthers = Math.round((otherSummary.categoryTotals.labor + otherSummary.categoryTotals.fee + otherSummary.categoryTotals.packaging + otherSummary.categoryTotals.etc) / totalQty);

        let running = sellingPrice;
        const steps = [];

        // 1. 총 판매가
        steps.push({
            id: 'revenue',
            label: '목표 판매가',
            amount: sellingPrice,
            delta: sellingPrice,
            runningTotal: running,
            type: 'start',
            color: '#2563eb'
        });

        // 2. 물품 매입비 차감
        running -= unitGoods;
        steps.push({
            id: 'goods',
            label: '물품 매입비',
            amount: unitGoods,
            delta: -unitGoods,
            runningTotal: running,
            type: 'drop',
            color: '#ef4444'
        });

        // 3. 물류/운송비 차감
        if (unitLogistics > 0) {
            running -= unitLogistics;
            steps.push({
                id: 'logistics',
                label: '물류·운송비',
                amount: unitLogistics,
                delta: -unitLogistics,
                runningTotal: running,
                type: 'drop',
                color: '#f97316'
            });
        }

        // 4. 임대/창고료 차감
        if (unitRent > 0) {
            running -= unitRent;
            steps.push({
                id: 'rent',
                label: '임대·창고료',
                amount: unitRent,
                delta: -unitRent,
                runningTotal: running,
                type: 'drop',
                color: '#eab308'
            });
        }

        // 5. 금융 이자비용 차감
        if (unitFinancing > 0) {
            running -= unitFinancing;
            steps.push({
                id: 'financing',
                label: '금융 이자비',
                amount: unitFinancing,
                delta: -unitFinancing,
                runningTotal: running,
                type: 'drop',
                color: '#8b5cf6'
            });
        }

        // 6. 기타 부대비용 차감
        if (unitOthers > 0) {
            running -= unitOthers;
            steps.push({
                id: 'others',
                label: '기타 운영비',
                amount: unitOthers,
                delta: -unitOthers,
                runningTotal: running,
                type: 'drop',
                color: '#64748b'
            });
        }

        // 7. 최종 실현 마진 (Pocket Profit)
        const pocketMarginRate = sellingPrice > 0 ? Number(((running / sellingPrice) * 100).toFixed(1)) : 0;
        steps.push({
            id: 'profit',
            label: `최종 마진 (${pocketMarginRate}%)`,
            amount: running,
            delta: running,
            runningTotal: running,
            type: 'end',
            color: running >= 0 ? '#10b981' : '#dc2626'
        });

        return steps;
    },

    /**
     * 10. 2차원 민감도 매트릭스 (Sensitivity Heatmap: 판매가 변동 × 자금회수기간)
     * @param {number} unitCost - 기준 원가
     * @param {number} basePrice - 기준 판매가
     * @param {number} baseDays - 기준 회수기간
     * @param {number} annualRatePct - 연이자율
     * @param {number} totalQty - 수량
     * @param {Array} priceDeltas - 판매가 증감율 예: [-10, -5, 0, 5, 10]
     * @param {Array} daySteps - 회수기간 일수 예: [30, 60, 90, 120]
     * @returns {Object}
     */
    calculateSensitivityMatrix(unitCost, basePrice, baseDays, annualRatePct, totalQty, priceDeltas = [-10, -5, 0, 5, 10], daySteps = [30, 60, 90, 120]) {
        const prices = priceDeltas.map(d => ({
            deltaPct: d,
            price: Math.round(basePrice * (1 + d / 100))
        }));

        const matrix = prices.map(pObj => {
            const rowCells = daySteps.map(days => {
                // 회수기간에 따른 금융비용 차이 계산
                const baseFinancing = unitCost * (annualRatePct / 100) * (days / 365);
                const adjustedCost = Math.round(unitCost + baseFinancing);
                const marginAmount = pObj.price - adjustedCost;
                const marginRate = pObj.price > 0 ? Number(((marginAmount / pObj.price) * 100).toFixed(1)) : 0;

                return {
                    days,
                    price: pObj.price,
                    deltaPct: pObj.deltaPct,
                    adjustedCost,
                    marginAmount,
                    marginRate,
                    isDanger: marginRate < 10.0,
                    isWarning: marginRate >= 10.0 && marginRate < 18.0,
                    isHealthy: marginRate >= 18.0
                };
            });

            return {
                price: pObj.price,
                deltaPct: pObj.deltaPct,
                cells: rowCells
            };
        });

        return { daySteps, matrix };
    },

    /**
     * 11. 비용 What-If 시나리오 3대 비교 (최소 vs 표준 vs 풀비용)
     * @param {Object} goods - calculateGoodsCost 결과
     * @param {Array} rawCosts - 부대비용 원본 배열
     * @param {number} baseDays - 회수기간
     * @param {number} annualRate - 이자율
     * @param {number} targetPrice - 기준 판매가
     * @returns {Array} [ScenarioA, ScenarioB, ScenarioC]
     */
    generateScenarioComparison(goods, rawCosts = [], baseDays = 60, annualRate = 5.0, targetPrice = 0) {
        const totalQty = goods.totalQty > 0 ? goods.totalQty : 1;

        // 시나리오 A: 최소비용 (물품대 + 필수물류비만, 임대료 및 금융비용 100% 제외)
        const costsA = rawCosts.map(c => ({
            ...c,
            isEnabled: c.category === 'logistics' || c.category === 'packaging'
        }));
        const otherA = this.calculateOtherCosts(costsA, totalQty);
        const finA = this.calculateFinancingCost(goods.totalSupplyPrice, 0, 0, totalQty, false);
        const summaryA = this.calculateTotalCostSummary(goods, otherA, finA);
        const marginA = targetPrice - summaryA.unitCost;
        const rateA = targetPrice > 0 ? Number(((marginA / targetPrice) * 100).toFixed(1)) : 0;

        // 시나리오 B: 표준비용 (물품대 + 일반 부대비용 + 금융비용 포함, 임대료 제외)
        const costsB = rawCosts.map(c => ({
            ...c,
            isEnabled: c.category !== 'rent'
        }));
        const otherB = this.calculateOtherCosts(costsB, totalQty);
        const finB = this.calculateFinancingCost(goods.totalSupplyPrice + otherB.totalEnabledCosts, baseDays, annualRate, totalQty, true);
        const summaryB = this.calculateTotalCostSummary(goods, otherB, finB);
        const marginB = targetPrice - summaryB.unitCost;
        const rateB = targetPrice > 0 ? Number(((marginB / targetPrice) * 100).toFixed(1)) : 0;

        // 시나리오 C: 풀부담비용 (물품대 + 임대료/창고비 + 금융비용 + 모든 부대비 전액 산입)
        const costsC = rawCosts.map(c => ({
            ...c,
            isEnabled: true
        }));
        const otherC = this.calculateOtherCosts(costsC, totalQty);
        const finC = this.calculateFinancingCost(goods.totalSupplyPrice + otherC.totalEnabledCosts, baseDays, annualRate, totalQty, true);
        const summaryC = this.calculateTotalCostSummary(goods, otherC, finC);
        const marginC = targetPrice - summaryC.unitCost;
        const rateC = targetPrice > 0 ? Number(((marginC / targetPrice) * 100).toFixed(1)) : 0;

        return [
            {
                name: '최소 원가 시나리오',
                desc: '임대료·금융비용 미산입 (직접 매입·물류비만 반영)',
                unitCost: summaryA.unitCost,
                totalCost: summaryA.totalCost,
                marginAmount: marginA,
                marginRate: rateA,
                tagColor: '#10b981'
            },
            {
                name: '표준 운영 시나리오',
                desc: '자금회수 이자비용 반영 (일반 도매 납품 기준)',
                unitCost: summaryB.unitCost,
                totalCost: summaryB.totalCost,
                marginAmount: marginB,
                marginRate: rateB,
                tagColor: '#2563eb',
                isDefault: true
            },
            {
                name: '풀부담 보수적 시나리오',
                desc: '창고임대료·관리비·금융비 전액 산입 (완전 원가)',
                unitCost: summaryC.unitCost,
                totalCost: summaryC.totalCost,
                marginAmount: marginC,
                marginRate: rateC,
                tagColor: '#8b5cf6'
            }
        ];
    }
};
