/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 수입 원가 분해 및 마진 시뮬레이션 계산 엔진
 * (Import Sourcing & Margin Simulation Mathematical Engine)
 * ══════════════════════════════════════════════════════════════
 * 순수 함수(Pure Functions)로 설계되어 UI와 완전히 독립적으로 동작합니다.
 */

export const MarginEngine = {
    /**
     * 1. 개당 최종 입고원가 (Landed Cost) 산출
     * @param {Object} product - { fobForeignPrice, exchangeRate }
     * @param {Object} costs - { oceanFreight, customsFee, inlandFreight, otherCost, tariffRate, isFtaExempt }
     * @returns {Object}
     */
    calculateLandedCost(product, costs) {
        const fobPrice = Number(product.fobForeignPrice) || 0;
        const exRate = Number(product.exchangeRate) || 0;

        // 원화 물품대 = FOB 외화단가 × 환율
        const fobKrwPrice = Math.round(fobPrice * exRate);

        // 관세 계산 (FTA 적용 시 0% 무관세)
        const tariffRate = Number(costs.tariffRate) || 0;
        const tariffAmount = costs.isFtaExempt ? 0 : Math.round(fobKrwPrice * (tariffRate / 100));

        // 수입 부대비용 합계
        const oceanFreight = Number(costs.oceanFreight) || 0;
        const customsFee = Number(costs.customsFee) || 0;
        const inlandFreight = Number(costs.inlandFreight) || 0;
        const otherCost = Number(costs.otherCost) || 0;
        const logisticsTotal = oceanFreight + customsFee + inlandFreight + otherCost;

        // 최종 입고원가 = 원화 물품대 + 부대비용 + 관세
        const landedCost = fobKrwPrice + logisticsTotal + tariffAmount;

        // 구성 비중 (%)
        const safeTotal = landedCost > 0 ? landedCost : 1;
        const costRatio = {
            goods: Number(((fobKrwPrice / safeTotal) * 100).toFixed(1)),
            logistics: Number(((logisticsTotal / safeTotal) * 100).toFixed(1)),
            tariff: Number(((tariffAmount / safeTotal) * 100).toFixed(1)),
            ocean: Number(((oceanFreight / safeTotal) * 100).toFixed(1)),
            customs: Number(((customsFee / safeTotal) * 100).toFixed(1)),
            inland: Number(((inlandFreight / safeTotal) * 100).toFixed(1))
        };

        return {
            fobKrwPrice,
            logisticsTotal,
            tariffAmount,
            landedCost,
            costRatio
        };
    },

    /**
     * 2. 채널별 목표 판매가 및 마진 산출
     * @param {number} landedCost - 개당 최종 입고원가
     * @param {Array} channels - [{ channelId, channelName, targetPrice, isPrimary }]
     * @returns {Array}
     */
    calculateChannelMargins(landedCost, channels) {
        return channels.map(ch => {
            const targetPrice = Number(ch.targetPrice) || 0;
            const marginAmount = targetPrice - landedCost;
            const marginRate = targetPrice > 0 ? Number(((marginAmount / targetPrice) * 100).toFixed(1)) : 0;
            const markupRate = landedCost > 0 ? Number(((marginAmount / landedCost) * 100).toFixed(1)) : 0;
            const costRate = targetPrice > 0 ? Number(((landedCost / targetPrice) * 100).toFixed(1)) : 0;

            return {
                ...ch,
                targetPrice,
                landedCost,
                marginAmount,
                marginRate,
                markupRate,
                costRate
            };
        });
    },

    /**
     * 3. 환율 변동 2차원 민감도 매트릭스 생성
     * @param {Object} product
     * @param {Object} costs
     * @param {Array} channels
     * @param {Array} rateSteps - 기준환율 대비 증감 단계 (기본값: [-50, 0, 50])
     * @param {number} warningThreshold - 마진율 주의 기준 (%) (기본값: 15.0)
     * @param {number} dangerThreshold - 마진율 위험 기준 (%) (기본값: 10.0)
     * @returns {Object} { rates, matrix: [ { rate, channelResults: [...] } ] }
     */
    generateSensitivityMatrix(product, costs, channels, rateSteps = [-50, 0, 50], warningThreshold = 15.0, dangerThreshold = 10.0) {
        const baseRate = Number(product.exchangeRate) || 0;
        const rates = rateSteps.map(step => baseRate + step);

        const matrix = rates.map(rate => {
            const tempProduct = { ...product, exchangeRate: rate };
            const { landedCost } = MarginEngine.calculateLandedCost(tempProduct, costs);

            const channelResults = channels.map(ch => {
                const targetPrice = Number(ch.targetPrice) || 0;
                const marginAmount = targetPrice - landedCost;
                const marginRate = targetPrice > 0 ? Number(((marginAmount / targetPrice) * 100).toFixed(1)) : 0;
                const markupRate = landedCost > 0 ? Number(((marginAmount / landedCost) * 100).toFixed(1)) : 0;

                return {
                    channelId: ch.channelId,
                    channelName: ch.channelName,
                    targetPrice,
                    landedCost,
                    marginAmount,
                    marginRate,
                    markupRate,
                    isWarning: marginRate < warningThreshold && marginRate >= dangerThreshold,
                    isDanger: marginRate < dangerThreshold
                };
            });

            return {
                rate,
                landedCost,
                channelResults
            };
        });

        return { rates, matrix };
    },

    /**
     * 3-1. UI 테이블용 2차원 민감도 매트릭스 (채널별 행 x 환율 구간별 열)
     */
    calculateSensitivityMatrix(product, costs, channels, rateDeltas = [-100, -50, 0, 50, 100]) {
        const baseRate = Number(product.exchangeRate) || 0;
        const rateSteps = rateDeltas.map(d => baseRate + d);

        // 채널별로 각 환율 구간의 마진율/마진액 매핑
        const matrix = channels.map(ch => {
            const targetPrice = Number(ch.targetPrice) || 0;
            const rates = rateSteps.map(rate => {
                const tempProduct = { ...product, exchangeRate: rate };
                const { landedCost } = MarginEngine.calculateLandedCost(tempProduct, costs);
                const marginAmount = targetPrice - landedCost;
                const marginRate = targetPrice > 0 ? Number(((marginAmount / targetPrice) * 100).toFixed(1)) : 0;
                const markupRate = landedCost > 0 ? Number(((marginAmount / landedCost) * 100).toFixed(1)) : 0;

                return {
                    rate,
                    landedCost,
                    marginAmount,
                    marginRate,
                    markupRate
                };
            });

            return {
                channelId: ch.channelId,
                channelName: ch.channelName,
                isPrimary: !!ch.isPrimary,
                targetPrice,
                rates
            };
        });

        return { rateSteps, matrix };
    },

    /**
     * 4. 사내 기존 매입단가 대체 시 원가 절감 효과 분석
     * @param {number} landedCost
     * @param {number|Object} existingPriceOrSavingsObj
     * @param {number} [annualVolume]
     * @returns {Object}
     */
    calculateCostSavings(landedCost, existingPriceOrSavingsObj, annualVolume) {
        let existPrice = 0;
        let volume = 0;

        if (typeof existingPriceOrSavingsObj === 'object' && existingPriceOrSavingsObj !== null) {
            existPrice = Number(existingPriceOrSavingsObj.existingPurchasePrice) || 0;
            volume = Number(existingPriceOrSavingsObj.annualVolume) || 0;
        } else {
            existPrice = Number(existingPriceOrSavingsObj) || 0;
            volume = Number(annualVolume) || 0;
        }

        const savingPerUnit = existPrice - landedCost;
        const annualTotalSaving = savingPerUnit * volume;
        const savingRate = existPrice > 0 ? Number(((savingPerUnit / existPrice) * 100).toFixed(1)) : 0;

        return {
            existingPurchasePrice: existPrice,
            annualVolume: volume,
            savingPerUnit,
            annualTotalSaving,
            savingRate
        };
    },

    /**
     * 4-1. calculateCostSavings 별칭
     */
    calculateInternalSavings(landedCost, savingsObj, annualVolume) {
        return this.calculateCostSavings(landedCost, savingsObj, annualVolume);
    },

    /**
     * 5. 품의/기안문 복사용 정형 텍스트 보고서 생성 (이모지 없음)
     */
    generateReportText(data) {
        const { product, costs, landed, channels, savings, remarks } = data;
        const num = (v) => Number(v || 0).toLocaleString('ko-KR');

        const primaryChannel = channels.find(c => c.isPrimary) || channels[1] || channels[0];

        let text = `[수입 소싱 원가 분석 및 채널별 마진 시뮬레이션 보고서]\n`;
        text += `1. 품목 기본 정보\n`;
        text += `- 품목명: ${product.productName || '-'}\n`;
        text += `- FOB 외화단가: ${product.currency || 'USD'} ${product.fobForeignPrice}\n`;
        text += `- 기준 환율: ${num(product.exchangeRate)} 원 / ${product.currency || 'USD'}\n`;
        text += `- 원화 물품대: ${num(landed.fobKrwPrice)} 원\n`;
        text += `- 관세 조건: ${costs.isFtaExempt ? '한·중 FTA 원산지증명서(C/O) 적용 (0% 무관세)' : `기본 관세율 ${costs.tariffRate}% (${num(landed.tariffAmount)}원)`}\n\n`;

        text += `2. 개당 최종 입고원가 산출 (합계: ${num(landed.landedCost)} 원)\n`;
        text += `- FOB 원화물품대: ${num(landed.fobKrwPrice)} 원 (${landed.costRatio.goods}%)\n`;
        text += `- 해상운임/보험료: ${num(costs.oceanFreight)} 원 (${landed.costRatio.ocean}%)\n`;
        text += `- 통관/창고/하역: ${num(costs.customsFee)} 원 (${landed.costRatio.customs}%)\n`;
        text += `- 국내 내륙운송비: ${num(costs.inlandFreight)} 원 (${landed.costRatio.inland}%)\n`;
        text += `- 수입 관세: ${num(landed.tariffAmount)} 원 (${landed.costRatio.tariff}%)\n\n`;

        text += `3. 채널별 목표 판매가 및 수익성\n`;
        channels.forEach(ch => {
            const mark = ch.isPrimary ? ' [주력안]' : '';
            text += `- ${ch.channelName}${mark}: 판매가 ${num(ch.targetPrice)}원 | 마진 ${num(ch.marginAmount)}원 (마진율 ${ch.marginRate}%, 가산율 ${ch.markupRate}%)\n`;
        });
        text += `\n`;

        if (savings && savings.existingPurchasePrice > 0) {
            text += `4. 사내 기존 매입단가 대체 절감 효과\n`;
            text += `- 기존 매입단가: ${num(savings.existingPurchasePrice)} 원\n`;
            text += `- 당사 입고원가: ${num(landed.landedCost)} 원\n`;
            text += `- 개당 절감액: ${num(savings.savingPerUnit)} 원 (${savings.savingRate}% 인하)\n`;
            text += `- 연간 총 절감액: ${num(savings.annualTotalSaving)} 원 (연간 ${num(savings.annualVolume)}개 전량 대체 기준)\n\n`;
        }

        if (remarks) {
            text += `5. 종합 검토 의견\n${remarks}\n`;
        }

        return text;
    }
};
