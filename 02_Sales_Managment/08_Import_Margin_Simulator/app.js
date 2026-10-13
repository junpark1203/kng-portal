/**
 * ══════════════════════════════════════════════════════════════
 * K&G Portal - 수입 원가 분해 및 마진 시뮬레이터 Controller (app.js)
 * ══════════════════════════════════════════════════════════════
 * - ECOUNT ERP 단가표 테마 고밀도 UI 컨트롤
 * - 실시간 입력 반응형 렌더링
 * - 백엔드 SQLite DB 저장/수정/삭제/불러오기 완전 연동 (/api/import-simulator)
 * - 로컬스토리지 자동 Fallback 지원 (네트워크 단절 시에도 데이터 보존)
 * - 오픈 환율 API 및 포워더 견적 API 연동
 * - 이모지 완전 배제 (Boxicons 전용)
 */

import { MarginEngine } from './margin-engine.js';

// ─────────────────────────────────────────────────────────────
// 1. 상태 관리 (State)
// ─────────────────────────────────────────────────────────────
let currentSimulationId = null;
let currentSimulationTitle = '형광 안전조끼 OEM';

const state = {
    product: {
        productName: '형광 안전조끼 OEM',
        currency: 'USD',
        fobForeignPrice: 4.90,
        exchangeRate: 1350.0,
        quantity: 3000
    },
    costs: {
        oceanFreight: 135,
        customsFee: 108,
        inlandFreight: 135,
        otherCost: 0,
        isFtaExempt: true,
        tariffRate: 13.0
    },
    channels: [
        { channelId: 'ch_a', channelName: '채널A (대량 납품/도매)', targetPrice: 8000, isPrimary: false },
        { channelId: 'ch_b', channelName: '채널B (표준 대리점/B2B)', targetPrice: 9000, isPrimary: true },
        { channelId: 'ch_c', channelName: '채널C (소량 직납/소매)', targetPrice: 10000, isPrimary: false }
    ],
    savings: {
        existingPurchasePrice: 8433,
        annualVolume: 3000
    },
    remarks: '한·중 FTA 원산지증명서(C/O) 적용을 통해 기본관세 13%를 면세 처리하여 입고원가 6,993원을 달성함.\n채널B(표준 대리점/B2B 9,000원) 판매 시 22.3%의 안정적 마진율을 확보하며, 환율이 1,450원까지 상승하더라도 16.9% 수준의 이익 방어가 가능함.\n사내 기존 매입단가(8,433원) 대체 시 연간 4,320,000원의 구매 원가 절감 효과 발생.',
    forwarderQuotes: [],
    selectedQuoteId: null,
    isForwarderApplied: false,
    savedSimulations: []
};

// 기본 초기값 스냅샷
const DEFAULT_STATE = JSON.parse(JSON.stringify(state));

// API 및 서버 설정
const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://localhost:3000' : 'https://kng.junparks.com';
const API_SIMULATOR = '/api/import-simulator';
const LOCAL_STORAGE_KEY = 'kng_import_simulations_backup';

// ─────────────────────────────────────────────────────────────
// 2. 유틸리티 함수 (이모지 없음)
// ─────────────────────────────────────────────────────────────
const num = (v, decimals = 0) => {
    return Number(v || 0).toLocaleString('ko-KR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
};

function showToast(message, isError = false) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.style.cssText = `
        background: ${isError ? '#ef4444' : '#0f172a'};
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 2px;
        font-size: 11.5px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: opacity 0.3s;
        border-left: 3px solid ${isError ? '#f87171' : '#38bdf8'};
    `;
    const iconClass = isError ? 'bx-error-circle' : 'bx-check-circle';
    toast.innerHTML = `<i class='bx ${iconClass}' style='font-size: 14px;'></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 2800);
}

async function getToken() {
    try {
        if (window.parent && typeof window.parent.getAuthToken === 'function') {
            let token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 6) {
                await new Promise(r => setTimeout(r, 300));
                token = await window.parent.getAuthToken();
                retries++;
            }
            return token || '';
        }
    } catch (e) {
        console.warn('Parent auth token not accessible');
    }
    return '';
}

async function authFetch(url, opts = {}) {
    const token = await getToken();
    opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(SERVER_URL + url, opts);
    if (!res.ok) {
        let errMsg = res.statusText;
        try { const errObj = await res.json(); errMsg = errObj.error || errMsg; } catch (e) {}
        throw new Error(errMsg);
    }
    return res.json();
}

function updateDocStatusBadge() {
    const badgeEl = document.getElementById('docStatusBadge');
    const textEl = document.getElementById('docStatusText');
    if (!badgeEl || !textEl) return;

    if (currentSimulationId) {
        textEl.textContent = `문서: ${currentSimulationTitle || '저장됨'}`;
        badgeEl.style.background = '#eff6ff';
        badgeEl.style.borderColor = '#93c5fd';
        badgeEl.style.color = '#1d4ed8';
    } else {
        textEl.textContent = `문서: 신규 작성`;
        badgeEl.style.background = '#f1f5f9';
        badgeEl.style.borderColor = '#cbd5e1';
        badgeEl.style.color = '#334155';
    }
}

// ─────────────────────────────────────────────────────────────
// 3. UI 바인딩 및 이벤트 리스너 등록
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    attachEventListeners();
    fetchRealtimeExchangeRate(); // 실시간 환율 자동 호출
    recalculateAndRender();
    updateDocStatusBadge();
});

function initElements() {
    const today = new Date().toISOString().slice(0, 10);
    const printDateEl = document.getElementById('printDate');
    if (printDateEl) printDateEl.textContent = today;

    // 초기 검토 의견 스마트 템플릿 세팅
    const textarea = document.getElementById('textRemarks');
    if (textarea && !textarea.value.trim()) {
        const smartText = generateSmartRemarks();
        textarea.value = smartText;
        state.remarks = smartText;
    }
}

function attachEventListeners() {
    // 1) 기본정보 인풋
    const inputProduct = document.getElementById('inputProductName');
    const inputFob = document.getElementById('inputFobPrice');
    const selectCurrency = document.getElementById('selectCurrency');
    const inputRate = document.getElementById('inputExchangeRate');
    const inputQty = document.getElementById('inputQuantity');

    inputProduct.addEventListener('input', (e) => {
        state.product.productName = e.target.value.trim();
        currentSimulationTitle = state.product.productName;
        updateDocStatusBadge();
        recalculateAndRender();
    });

    inputFob.addEventListener('input', (e) => {
        state.product.fobForeignPrice = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    selectCurrency.addEventListener('change', (e) => {
        state.product.currency = e.target.value;
        const unitEl = document.getElementById('unitCurrency');
        if (unitEl) unitEl.textContent = e.target.value;
        fetchRealtimeExchangeRate(e.target.value);
    });

    inputRate.addEventListener('input', (e) => {
        state.product.exchangeRate = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    inputQty.addEventListener('input', (e) => {
        state.product.quantity = parseInt(e.target.value, 10) || 1;
        recalculateAndRender();
    });

    // 2) 부대비용 인풋
    const inputOcean = document.getElementById('inputOceanFreight');
    const inputCustoms = document.getElementById('inputCustomsFee');
    const inputInland = document.getElementById('inputInlandFreight');
    const inputOther = document.getElementById('inputOtherCost');
    const checkFta = document.getElementById('checkFtaExempt');
    const inputTariff = document.getElementById('inputTariffRate');

    inputOcean.addEventListener('input', (e) => {
        state.costs.oceanFreight = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    inputCustoms.addEventListener('input', (e) => {
        state.costs.customsFee = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    inputInland.addEventListener('input', (e) => {
        state.costs.inlandFreight = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    inputOther.addEventListener('input', (e) => {
        state.costs.otherCost = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    checkFta.addEventListener('change', (e) => {
        state.costs.isFtaExempt = e.target.checked;
        const rowTariff = document.getElementById('rowTariffRate');
        const badgeFta = document.getElementById('badgeFtaStatus');
        if (rowTariff) rowTariff.style.display = e.target.checked ? 'none' : 'table-row';
        if (badgeFta) {
            badgeFta.textContent = e.target.checked ? 'FTA 0%' : '기본관세';
            badgeFta.style.background = e.target.checked ? 'var(--erp-success-bg)' : 'var(--erp-warning-bg)';
            badgeFta.style.color = e.target.checked ? '#065f46' : '#92400e';
            badgeFta.style.borderColor = e.target.checked ? 'var(--erp-success-border)' : 'var(--erp-warning-border)';
        }
        recalculateAndRender();
    });

    inputTariff.addEventListener('input', (e) => {
        state.costs.tariffRate = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    // 3) 사내 대체 인풋
    const inputExistPrice = document.getElementById('inputExistingPrice');
    const inputAnnualVol = document.getElementById('inputAnnualVolume');

    inputExistPrice.addEventListener('input', (e) => {
        state.savings.existingPurchasePrice = parseFloat(e.target.value) || 0;
        recalculateAndRender();
    });

    inputAnnualVol.addEventListener('input', (e) => {
        state.savings.annualVolume = parseInt(e.target.value, 10) || 0;
        recalculateAndRender();
    });

    // 4) 의견 및 비고
    const textRemarks = document.getElementById('textRemarks');
    if (textRemarks) {
        state.remarks = textRemarks.value;
        textRemarks.addEventListener('input', (e) => {
            state.remarks = e.target.value;
        });
    }

    // 5) 기본값 복원 버튼
    const btnReset = document.getElementById('btnResetDefault');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (confirm('기본 시뮬레이션 파라미터(형광 안전조끼 OEM 실무 데이터)로 복원하시겠습니까?')) {
                resetToDefault();
            }
        });
    }

    // 6) 환율 갱신 버튼
    const btnRefreshRate = document.getElementById('btnRefreshRate');
    if (btnRefreshRate) {
        btnRefreshRate.addEventListener('click', () => {
            fetchRealtimeExchangeRate(state.product.currency, true);
        });
    }

    // 7) 새로 작성 / 저장 / 목록 불러오기 버튼
    const btnNew = document.getElementById('btnNewSimulation');
    if (btnNew) btnNew.addEventListener('click', handleNewSimulation);

    const btnSave = document.getElementById('btnSaveSimulation');
    if (btnSave) btnSave.addEventListener('click', handleSaveSimulation);

    const btnOpenList = document.getElementById('btnOpenSavedList');
    if (btnOpenList) btnOpenList.addEventListener('click', openSavedListModal);

    const btnCloseList = document.getElementById('btnCloseSimulationListModal');
    if (btnCloseList) btnCloseList.addEventListener('click', closeSavedListModal);

    const btnCancelList = document.getElementById('btnCancelSimulationListModal');
    if (btnCancelList) btnCancelList.addEventListener('click', closeSavedListModal);

    const btnRefreshList = document.getElementById('btnRefreshSavedList');
    if (btnRefreshList) btnRefreshList.addEventListener('click', loadSavedSimulations);

    // 하단 대형 액션 바 버튼 연결
    const btnBottomSave = document.getElementById('btnBottomSave');
    if (btnBottomSave) btnBottomSave.addEventListener('click', handleSaveSimulation);

    const btnBottomNew = document.getElementById('btnBottomNew');
    if (btnBottomNew) btnBottomNew.addEventListener('click', handleNewSimulation);

    const btnBottomList = document.getElementById('btnBottomList');
    if (btnBottomList) btnBottomList.addEventListener('click', openSavedListModal);

    // 8) 검토의견 수치 자동반영 버튼
    const btnAutoRemarks = document.getElementById('btnAutoGenerateRemarks');
    if (btnAutoRemarks) {
        btnAutoRemarks.addEventListener('click', () => {
            const smartText = generateSmartRemarks();
            const textarea = document.getElementById('textRemarks');
            if (textarea) {
                textarea.value = smartText;
                state.remarks = smartText;
                showToast('현재 시뮬레이션 계산 수치로 검토의견이 갱신되었습니다.');
            }
        });
    }

    // 9) 기타 액션 버튼들
    document.getElementById('btnOpenQuotationModal').addEventListener('click', openForwarderModal);
    document.getElementById('btnCloseForwarderModal').addEventListener('click', closeForwarderModal);
    document.getElementById('btnCancelForwarderModal').addEventListener('click', closeForwarderModal);
    document.getElementById('btnApplyForwarderQuote').addEventListener('click', applySelectedForwarderQuote);

    document.getElementById('btnCopyReport').addEventListener('click', copyReportToClipboard);
    document.getElementById('btnExportCsv').addEventListener('click', exportToCsv);
    document.getElementById('btnPrint').addEventListener('click', () => window.print());

    // 10) 전역 키보드 단축키 지원 (F8 / Ctrl+S: 저장, F4: 목록)
    window.addEventListener('keydown', (e) => {
        // F8 또는 Ctrl+S: 저장
        if (e.key === 'F8' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')) {
            e.preventDefault();
            handleSaveSimulation();
        }
        // F4: 목록 열기
        if (e.key === 'F4') {
            e.preventDefault();
            openSavedListModal();
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 4. 핵심 계산 및 UI 렌더링 파이프라인
// ─────────────────────────────────────────────────────────────
function recalculateAndRender() {
    const landed = MarginEngine.calculateLandedCost(state.product, state.costs);
    const calculatedChannels = MarginEngine.calculateChannelMargins(landed.landedCost, state.channels);
    const sensitivity = MarginEngine.calculateSensitivityMatrix(state.product, state.costs, state.channels);
    const savings = MarginEngine.calculateInternalSavings(landed.landedCost, state.savings);

    renderLandedSummary(landed);
    renderCostBar(landed);
    renderChannelTable(calculatedChannels, landed.landedCost);
    renderSensitivityTable(sensitivity);
    renderRoiSummary(savings, landed.landedCost);
    renderPrintHeader();
}

function renderLandedSummary(landed) {
    document.getElementById('displayLandedTitle').textContent = state.product.productName || '품목 미지정';
    document.getElementById('displayLandedCost').textContent = num(landed.landedCost);

    const ftaText = state.costs.isFtaExempt ? 'FTA 0% 무관세' : `기본관세 ${state.costs.tariffRate}% (${num(landed.tariffAmount)}원)`;
    document.getElementById('displayLandedFormula').textContent = 
        `FOB 원화 ${num(landed.fobKrwPrice)}원 + 부대비용 ${num(landed.logisticsTotal)}원 + 관세 ${ftaText}`;

    const logisticsSubtotalEl = document.getElementById('textLogisticsSubtotal');
    if (logisticsSubtotalEl) {
        logisticsSubtotalEl.textContent = `${num(landed.logisticsTotal)} 원`;
    }
}

function renderCostBar(landed) {
    const r = landed.costRatio;
    const barGoods = document.getElementById('barGoods');
    const barOcean = document.getElementById('barOcean');
    const barCustoms = document.getElementById('barCustoms');
    const barInland = document.getElementById('barInland');
    const barTariff = document.getElementById('barTariff');

    if (barGoods) {
        barGoods.style.width = `${r.goods}%`;
        barGoods.textContent = r.goods >= 8 ? `FOB ${r.goods}%` : '';
        barGoods.title = `FOB 물품대: ${num(landed.fobKrwPrice)}원 (${r.goods}%)`;
    }
    if (barOcean) {
        barOcean.style.width = `${r.ocean}%`;
        barOcean.textContent = r.ocean >= 6 ? `해상 ${r.ocean}%` : '';
        barOcean.title = `해상운임: ${num(state.costs.oceanFreight)}원 (${r.ocean}%)`;
    }
    if (barCustoms) {
        barCustoms.style.width = `${r.customs}%`;
        barCustoms.textContent = r.customs >= 6 ? `통관 ${r.customs}%` : '';
        barCustoms.title = `통관·하역: ${num(state.costs.customsFee)}원 (${r.customs}%)`;
    }
    if (barInland) {
        barInland.style.width = `${r.inland}%`;
        barInland.textContent = r.inland >= 6 ? `내륙 ${r.inland}%` : '';
        barInland.title = `내륙운송: ${num(state.costs.inlandFreight)}원 (${r.inland}%)`;
    }
    if (barTariff) {
        if (!state.costs.isFtaExempt && landed.tariffAmount > 0) {
            barTariff.style.display = 'flex';
            barTariff.style.width = `${r.tariff}%`;
            barTariff.textContent = r.tariff >= 6 ? `관세 ${r.tariff}%` : '';
            barTariff.title = `관세: ${num(landed.tariffAmount)}원 (${r.tariff}%)`;
        } else {
            barTariff.style.display = 'none';
        }
    }

    const summaryEl = document.getElementById('costBreakdownSummary');
    if (summaryEl) {
        summaryEl.textContent = `FOB 물품대 ${r.goods}% | 부대비용 ${r.logistics}% ${!state.costs.isFtaExempt ? `| 관세 ${r.tariff}%` : ''}`;
    }

    document.getElementById('legGoodsVal').textContent = `${num(landed.fobKrwPrice)}원`;
    document.getElementById('legOceanVal').textContent = `${num(state.costs.oceanFreight)}원`;
    document.getElementById('legCustomsVal').textContent = `${num(state.costs.customsFee)}원`;
    document.getElementById('legInlandVal').textContent = `${num(state.costs.inlandFreight)}원`;

    const legTariffItem = document.getElementById('legTariffItem');
    if (legTariffItem) {
        if (!state.costs.isFtaExempt && landed.tariffAmount > 0) {
            legTariffItem.style.display = 'inline-flex';
            document.getElementById('legTariffVal').textContent = `${num(landed.tariffAmount)}원`;
        } else {
            legTariffItem.style.display = 'none';
        }
    }
}

function renderChannelTable(channels, landedCost) {
    const tbody = document.querySelector('#tableChannels tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    channels.forEach((ch, idx) => {
        const tr = document.createElement('tr');
        if (ch.isPrimary) tr.className = 'primary-row';

        const rateClass = ch.marginRate >= 20 ? 'rate-high' :
                         ch.marginRate >= 15 ? 'rate-mid' :
                         ch.marginRate >= 10 ? 'rate-low' : 'rate-danger';

        const clampedRate = Math.max(0, Math.min(100, ch.marginRate));

        tr.innerHTML = `
            <td class="text-left" style="font-weight: 600;">
                ${ch.channelName}
                ${ch.isPrimary ? '<span class="primary-badge">주력안</span>' : ''}
            </td>
            <td class="text-right">
                <input type="number" class="erp-input text-right ch-price-input" 
                       data-idx="${idx}" step="100" value="${ch.targetPrice}" 
                       style="font-weight: 700; width: 85px;">
            </td>
            <td class="text-right ${rateClass}" style="font-weight: 700;">
                ${num(ch.marginAmount)}원
            </td>
            <td>
                <div class="margin-meter-cell">
                    <span class="margin-meter-track">
                        <span class="margin-meter-fill" style="width: ${clampedRate}%; background: ${
                            ch.marginRate >= 20 ? '#10b981' : ch.marginRate >= 15 ? '#2563eb' : ch.marginRate >= 10 ? '#f59e0b' : '#ef4444'
                        };"></span>
                    </span>
                    <span class="margin-rate-num ${rateClass}">${ch.marginRate}%</span>
                </div>
            </td>
            <td class="text-right" style="color: var(--erp-text-muted);">
                +${ch.markupRate}%
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.ch-price-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            const val = parseFloat(e.target.value) || 0;
            state.channels[idx].targetPrice = val;
            recalculateAndRender();
        });
    });
}

function renderSensitivityTable(sensitivity) {
    const { rateSteps, matrix } = sensitivity;

    if (rateSteps.length === 5) {
        document.getElementById('thRateMinus100').textContent = `${num(rateSteps[0])}원 (-100)`;
        document.getElementById('thRateMinus50').textContent = `${num(rateSteps[1])}원 (-50)`;
        document.getElementById('thRateBase').textContent = `${num(rateSteps[2])}원 (기준)`;
        document.getElementById('thRatePlus50').textContent = `${num(rateSteps[3])}원 (+50)`;
        document.getElementById('thRatePlus100').textContent = `${num(rateSteps[4])}원 (+100)`;
    }

    const tbody = document.querySelector('#tableSensitivity tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    matrix.forEach(row => {
        const tr = document.createElement('tr');
        if (row.isPrimary) tr.className = 'primary-row';

        let html = `
            <td class="text-left" style="font-weight: 600;">
                ${row.channelName}
                ${row.isPrimary ? '<span class="primary-badge">주력</span>' : ''}
            </td>
        `;

        row.rates.forEach((cell, idx) => {
            const heatClass = cell.marginRate >= 20 ? 'heat-safe' :
                              cell.marginRate >= 15 ? 'heat-fair' :
                              cell.marginRate >= 10 ? 'heat-warn' : 'heat-crit';
            const isBase = idx === 2 ? 'base-rate-col' : '';

            html += `
                <td class="heat-cell ${heatClass} ${isBase}">
                    <span class="heat-rate">${cell.marginRate}%</span>
                    <span class="heat-amt">(${num(cell.marginAmount)}원)</span>
                </td>
            `;
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
    });
}

/**
 * 4-1. 현재 계산된 수치 기준 스마트 검토의견 텍스트 생성
 */
function generateSmartRemarks() {
    const landed = MarginEngine.calculateLandedCost(state.product, state.costs);
    const channels = MarginEngine.calculateChannelMargins(landed.landedCost, state.channels);
    const savings = MarginEngine.calculateInternalSavings(landed.landedCost, state.savings);
    const primaryCh = channels.find(c => c.isPrimary) || channels[1] || channels[0];

    const ftaPart = state.costs.isFtaExempt 
        ? `한·중 FTA 원산지증명서(C/O) 적용을 통해 기본관세 ${state.costs.tariffRate}%를 전액 면세 처리하여 개당 최종 입고원가 ${num(landed.landedCost)}원을 달성함.`
        : `기본관세 ${state.costs.tariffRate}%(${num(landed.tariffAmount)}원)를 반영하여 개당 최종 입고원가 ${num(landed.landedCost)}원을 산출함.`;

    const channelPart = primaryCh 
        ? `${primaryCh.channelName}(판매가 ${num(primaryCh.targetPrice)}원) 기준 ${primaryCh.marginRate}%(개당 ${num(primaryCh.marginAmount)}원)의 안정적인 영업이익률 확보가 가능함.`
        : '';

    let savingPart = '';
    if (savings && savings.existingPurchasePrice > 0) {
        savingPart = `사내 기존 매입단가(${num(savings.existingPurchasePrice)}원) 대비 개당 ${num(savings.savingPerUnit)}원(${savings.savingRate}%) 절감되며, 연간 ${num(savings.annualVolume)}개 전량 대체 시 연간 ${num(savings.annualTotalSaving)}원의 확정 구매원가 절감 효과 발생.`;
    }

    return `${ftaPart}\n${channelPart}\n${savingPart}`.trim();
}

function renderRoiSummary(savings, landedCost) {
    document.getElementById('roiExistPrice').textContent = `${num(savings.existingPurchasePrice)} 원`;
    document.getElementById('roiLandedCost').textContent = `${num(landedCost)} 원`;
    document.getElementById('roiSavingPerUnit').textContent = `${num(savings.savingPerUnit)} 원 (${savings.savingRate}%)`;
    document.getElementById('roiAnnualTotalSaving').textContent = `${num(savings.annualTotalSaving)} 원`;
}

function renderPrintHeader() {
    const printProd = document.getElementById('printProductName');
    const printExRate = document.getElementById('printExchangeRate');
    if (printProd) printProd.textContent = state.product.productName || '수입 제품';
    if (printExRate) printExRate.textContent = `${num(state.product.exchangeRate)} (${state.product.currency})`;
}

// ─────────────────────────────────────────────────────────────
// 5. 새로 작성, 저장, 목록 불러오기, 삭제 (백엔드 DB 연동)
// ─────────────────────────────────────────────────────────────

// 5-1. 신규 작성 (초기화)
function handleNewSimulation() {
    if (confirm('현재 작성 중인 내용을 비우고, 새로운 품목의 시뮬레이션을 작성하시겠습니까?')) {
        currentSimulationId = null;
        currentSimulationTitle = '신규 수입 품목';

        // 빈 상태로 세팅
        state.product.productName = '';
        state.product.fobForeignPrice = 0;
        state.product.quantity = 1000;
        state.costs.oceanFreight = 0;
        state.costs.customsFee = 0;
        state.costs.inlandFreight = 0;
        state.costs.otherCost = 0;
        state.costs.isFtaExempt = true;
        state.costs.tariffRate = 13.0;

        state.channels = [
            { channelId: 'ch_a', channelName: '채널A (대량 납품/도매)', targetPrice: 0, isPrimary: false },
            { channelId: 'ch_b', channelName: '채널B (표준 대리점/B2B)', targetPrice: 0, isPrimary: true },
            { channelId: 'ch_c', channelName: '채널C (소량 직납/소매)', targetPrice: 0, isPrimary: false }
        ];

        state.savings.existingPurchasePrice = 0;
        state.savings.annualVolume = 1000;
        state.remarks = '';
        state.isForwarderApplied = false;

        syncFormInputs();
        updateDocStatusBadge();
        recalculateAndRender();
        showToast('새 시뮬레이션 작성을 시작합니다.');
    }
}

// 5-2. 서버 DB에 저장하기 (신규 생성 또는 기존 수정)
async function handleSaveSimulation() {
    const productName = (state.product.productName || '').trim();
    if (!productName) {
        showToast('품목명을 입력해 주세요.', true);
        document.getElementById('inputProductName').focus();
        return;
    }

    const landed = MarginEngine.calculateLandedCost(state.product, state.costs);
    const today = new Date().toISOString().slice(0, 10);

    const payload = {
        title: productName,
        simDate: today,
        productName: state.product.productName,
        currency: state.product.currency,
        fobPrice: state.product.fobForeignPrice,
        exchangeRate: state.product.exchangeRate,
        quantity: state.product.quantity,
        oceanFreight: state.costs.oceanFreight,
        customsFee: state.costs.customsFee,
        inlandFreight: state.costs.inlandFreight,
        otherCost: state.costs.otherCost,
        isFtaExempt: state.costs.isFtaExempt,
        tariffRate: state.costs.tariffRate,
        landedCost: landed.landedCost,
        channels: state.channels,
        savings: state.savings,
        remarks: state.remarks,
        authorName: '소싱담당'
    };

    try {
        let resData;
        if (currentSimulationId) {
            // 수정 (PUT)
            resData = await authFetch(`${API_SIMULATOR}/${currentSimulationId}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            showToast(`'${productName}' 시뮬레이션이 서버에 수정 저장되었습니다.`);
        } else {
            // 신규 저장 (POST)
            resData = await authFetch(API_SIMULATOR, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            currentSimulationId = resData.id;
            showToast(`'${productName}' 시뮬레이션이 서버에 새로 저장되었습니다.`);
        }

        currentSimulationTitle = productName;
        updateDocStatusBadge();

        // 로컬 백업 동시 갱신
        saveToLocalStorageBackup(payload, currentSimulationId);

    } catch (err) {
        console.warn('서버 저장 실패, 로컬스토리지 백업 저장 진행:', err);
        // 서버 에러 시 로컬스토리지에 저장하여 작업 유실 방지
        const backupId = currentSimulationId || `local_sim_${Date.now()}`;
        currentSimulationId = backupId;
        currentSimulationTitle = productName;
        saveToLocalStorageBackup(payload, backupId);
        updateDocStatusBadge();
        showToast(`서버 접속 불가로 브라우저 로컬 저장소에 안전하게 보관되었습니다.`);
    }
}

// 로컬스토리지 백업 함수
function saveToLocalStorageBackup(data, id) {
    try {
        let list = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
        const existingIdx = list.findIndex(item => item.id === id);
        const record = { ...data, id, updatedAt: new Date().toISOString() };
        if (existingIdx >= 0) {
            list[existingIdx] = record;
        } else {
            list.unshift(record);
        }
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        console.error('LocalStorage 저장 실패:', e);
    }
}

// 5-3. 저장된 시뮬레이션 목록 모달 열기
async function openSavedListModal() {
    const modal = document.getElementById('simulationListModal');
    if (modal) modal.classList.add('active');
    await loadSavedSimulations();
}

function closeSavedListModal() {
    const modal = document.getElementById('simulationListModal');
    if (modal) modal.classList.remove('active');
}

// 5-4. 저장 목록 조회 (서버 우선 + 로컬 병합)
async function loadSavedSimulations() {
    const tbody = document.getElementById('tbodySavedSimulations');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 20px;">저장된 시뮬레이션 목록을 조회 중입니다...</td></tr>`;

    let serverList = [];
    try {
        serverList = await authFetch(API_SIMULATOR);
    } catch (err) {
        console.warn('서버 목록 조회 실패, 로컬 백업 확인:', err);
    }

    let localList = [];
    try {
        localList = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    } catch (e) {}

    // 서버 목록과 로컬 목록 병합 (id 기준 중복 제거)
    const combinedMap = new Map();
    (serverList || []).forEach(item => combinedMap.set(item.id, item));
    (localList || []).forEach(item => {
        if (!combinedMap.has(item.id)) combinedMap.set(item.id, item);
    });

    state.savedSimulations = Array.from(combinedMap.values());
    renderSavedSimulationsTable(state.savedSimulations);
}

function renderSavedSimulationsTable(list) {
    const tbody = document.getElementById('tbodySavedSimulations');
    if (!tbody) return;

    if (!list || list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 25px; color: var(--erp-text-muted);">저장된 수입 시뮬레이션 내역이 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    list.forEach(sim => {
        const tr = document.createElement('tr');
        if (sim.id === currentSimulationId) {
            tr.style.backgroundColor = '#eff6ff';
        }

        // 주력 채널 마진율 계산
        let primaryMarginRateStr = '-';
        if (sim.channels && Array.isArray(sim.channels) && sim.channels.length > 0) {
            const primaryCh = sim.channels.find(c => c.isPrimary) || sim.channels[1] || sim.channels[0];
            if (primaryCh && primaryCh.targetPrice > 0 && sim.landedCost > 0) {
                const margin = primaryCh.targetPrice - sim.landedCost;
                const rate = ((margin / primaryCh.targetPrice) * 100).toFixed(1);
                primaryMarginRateStr = `${rate}% (${num(margin)}원)`;
            }
        }

        tr.innerHTML = `
            <td class="text-center">${sim.simDate || sim.createdAt?.slice(0, 10) || '-'}</td>
            <td class="text-left" style="font-weight: 700; color: #0f172a;">
                ${sim.title || sim.productName || '무제'}
                ${sim.id === currentSimulationId ? '<span class="primary-badge">현재 열람중</span>' : ''}
            </td>
            <td class="text-right">${sim.currency || 'USD'} ${num(sim.fobPrice, 2)}</td>
            <td class="text-right">${num(sim.exchangeRate, 1)}원</td>
            <td class="text-right" style="font-weight: 700; color: #0284c7;">${num(sim.landedCost)}원</td>
            <td class="text-center" style="font-weight: 600;">${primaryMarginRateStr}</td>
            <td class="text-center">
                <button type="button" class="btn-erp btn-primary btn-load-sim" data-id="${sim.id}" style="height: 20px; font-size: 10px; padding: 0 6px;">
                    <i class="bx bx-check"></i> 불러오기
                </button>
                <button type="button" class="btn-erp btn-delete-sim" data-id="${sim.id}" data-name="${sim.title || sim.productName}" style="height: 20px; font-size: 10px; padding: 0 5px; color: #dc2626;">
                    <i class="bx bx-trash"></i>
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // 불러오기 이벤트 연결
    tbody.querySelectorAll('.btn-load-sim').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            loadSimulationById(id);
        });
    });

    // 삭제 이벤트 연결
    tbody.querySelectorAll('.btn-delete-sim').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const name = e.currentTarget.dataset.name;
            deleteSimulationById(id, name);
        });
    });
}

// 5-5. ID로 시뮬레이션 불러오기
async function loadSimulationById(id) {
    let simData = state.savedSimulations.find(s => s.id === id);

    // 서버 단일 조회 시도
    try {
        const fetched = await authFetch(`${API_SIMULATOR}/${id}`);
        if (fetched) simData = fetched;
    } catch (err) {
        console.warn('서버 상세 조회 실패, 캐시 데이터 활용:', err);
    }

    if (!simData) {
        showToast('시뮬레이션 데이터를 찾을 수 없습니다.', true);
        return;
    }

    currentSimulationId = simData.id;
    currentSimulationTitle = simData.title || simData.productName;

    // 상태 바인딩
    state.product.productName = simData.productName || '';
    state.product.currency = simData.currency || 'USD';
    state.product.fobForeignPrice = Number(simData.fobPrice) || 0;
    state.product.exchangeRate = Number(simData.exchangeRate) || 1350.0;
    state.product.quantity = Number(simData.quantity) || 1000;

    state.costs.oceanFreight = Number(simData.oceanFreight) || 0;
    state.costs.customsFee = Number(simData.customsFee) || 0;
    state.costs.inlandFreight = Number(simData.inlandFreight) || 0;
    state.costs.otherCost = Number(simData.otherCost) || 0;
    state.costs.isFtaExempt = !!simData.isFtaExempt;
    state.costs.tariffRate = Number(simData.tariffRate) || 13.0;

    if (simData.channels && Array.isArray(simData.channels) && simData.channels.length > 0) {
        state.channels = simData.channels;
    }
    if (simData.savings && typeof simData.savings === 'object') {
        state.savings = simData.savings;
    }
    state.remarks = simData.remarks || '';

    // 인풋 폼 동기화
    syncFormInputs();
    updateDocStatusBadge();
    closeSavedListModal();
    recalculateAndRender();
    showToast(`'${currentSimulationTitle}' 시뮬레이션을 불러왔습니다.`);
}

// 5-6. 시뮬레이션 삭제
async function deleteSimulationById(id, name) {
    if (!confirm(`'${name || '해당'}' 시뮬레이션을 정말 삭제하시겠습니까?`)) return;

    try {
        await authFetch(`${API_SIMULATOR}/${id}`, { method: 'DELETE' });
    } catch (err) {
        console.warn('서버 삭제 실패:', err);
    }

    // 로컬 백업에서도 삭제
    try {
        let list = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
        list = list.filter(item => item.id !== id);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}

    // 만약 현재 열린 문서가 삭제된 문서라면 초기화
    if (currentSimulationId === id) {
        currentSimulationId = null;
        currentSimulationTitle = '신규 작성';
        updateDocStatusBadge();
    }

    showToast(`시뮬레이션이 삭제되었습니다.`);
    await loadSavedSimulations();
}

// 인풋 폼 필드와 상태 동기화 헬퍼
function syncFormInputs() {
    document.getElementById('inputProductName').value = state.product.productName;
    document.getElementById('inputFobPrice').value = state.product.fobForeignPrice;
    document.getElementById('selectCurrency').value = state.product.currency;
    document.getElementById('unitCurrency').textContent = state.product.currency;
    document.getElementById('inputExchangeRate').value = state.product.exchangeRate;
    document.getElementById('inputQuantity').value = state.product.quantity;

    document.getElementById('inputOceanFreight').value = state.costs.oceanFreight;
    document.getElementById('inputCustomsFee').value = state.costs.customsFee;
    document.getElementById('inputInlandFreight').value = state.costs.inlandFreight;
    document.getElementById('inputOtherCost').value = state.costs.otherCost;

    const checkFta = document.getElementById('checkFtaExempt');
    checkFta.checked = state.costs.isFtaExempt;
    const rowTariff = document.getElementById('rowTariffRate');
    const badgeFta = document.getElementById('badgeFtaStatus');
    if (rowTariff) rowTariff.style.display = state.costs.isFtaExempt ? 'none' : 'table-row';
    if (badgeFta) {
        badgeFta.textContent = state.costs.isFtaExempt ? 'FTA 0%' : '기본관세';
        badgeFta.style.background = state.costs.isFtaExempt ? 'var(--erp-success-bg)' : 'var(--erp-warning-bg)';
        badgeFta.style.color = state.costs.isFtaExempt ? '#065f46' : '#92400e';
    }
    document.getElementById('inputTariffRate').value = state.costs.tariffRate;

    document.getElementById('inputExistingPrice').value = state.savings.existingPurchasePrice;
    document.getElementById('inputAnnualVolume').value = state.savings.annualVolume;
    document.getElementById('textRemarks').value = state.remarks;

    const badge = document.getElementById('forwarderAppliedBadge');
    if (badge) badge.style.display = state.isForwarderApplied ? 'inline-flex' : 'none';
}

// ─────────────────────────────────────────────────────────────
// 6. 실시간 환율 조회 (오픈 환율 API & Fallback)
// ─────────────────────────────────────────────────────────────
async function fetchRealtimeExchangeRate(currency = 'USD', isManual = false) {
    const rateTextEl = document.getElementById('currentRateText');
    const rateTimeEl = document.getElementById('rateTimeText');

    try {
        if (rateTimeEl) rateTimeEl.textContent = '(조회중...)';
        
        const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
        if (!res.ok) throw new Error('환율 API 응답 오류');
        const data = await res.json();

        if (data && data.rates && data.rates.KRW) {
            const liveKrwRate = Number(data.rates.KRW.toFixed(1));
            state.product.exchangeRate = liveKrwRate;

            if (rateTextEl) rateTextEl.textContent = num(liveKrwRate, 1);
            if (rateTimeEl) {
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                rateTimeEl.textContent = `(${timeStr} 실시간)`;
            }

            const inputRate = document.getElementById('inputExchangeRate');
            if (inputRate) inputRate.value = liveKrwRate;

            // 신규 작성 상태일 경우 검토 의견도 실시간 환율 수치로 자연스럽게 동기화
            if (!currentSimulationId) {
                const textarea = document.getElementById('textRemarks');
                if (textarea) {
                    const smartText = generateSmartRemarks();
                    textarea.value = smartText;
                    state.remarks = smartText;
                }
            }

            recalculateAndRender();
            if (isManual) showToast(`실시간 환율 (${currency} 1 = ${num(liveKrwRate, 1)}원) 갱신 완료`);
            return;
        }
    } catch (err) {
        console.warn('실시간 환율 API 조회 실패, 기본/기존값 유지:', err.message);
        if (rateTimeEl) rateTimeEl.textContent = '(기준환율)';
        if (isManual) showToast('실시간 환율 조회가 원활하지 않아 기존 설정값을 유지합니다.', true);
    }
}

// ─────────────────────────────────────────────────────────────
// 7. 포워더 견적 불러오기 모달 및 자동 채우기 연동
// ─────────────────────────────────────────────────────────────
async function openForwarderModal() {
    const modal = document.getElementById('forwarderModal');
    modal.classList.add('active');
    const tbody = document.getElementById('tbodyForwarderQuotes');
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 15px;">견적 목록 조회 중...</td></tr>`;

    try {
        const quotes = await authFetch('/api/forwarder-quotation');
        state.forwarderQuotes = quotes || [];
        renderForwarderQuotesList(state.forwarderQuotes);
    } catch (err) {
        console.error('포워더 견적 조회 실패:', err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 15px; color: var(--erp-danger);">견적 목록을 불러올 수 없습니다: ${err.message}</td></tr>`;
    }
}

function closeForwarderModal() {
    const modal = document.getElementById('forwarderModal');
    modal.classList.remove('active');
}

function renderForwarderQuotesList(quotes) {
    const tbody = document.getElementById('tbodyForwarderQuotes');
    if (!quotes || quotes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 15px; color: var(--erp-text-muted);">등록된 포워더 견적 내역이 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    quotes.forEach((q, idx) => {
        const tr = document.createElement('tr');
        
        let forwarderName = '-';
        let totalCostKrw = 0;
        if (q.forwarders && q.forwarders.length > 0) {
            const f = q.forwarders[0];
            forwarderName = f.name || f.company || `포워더 1`;
            totalCostKrw = f.totalKrw || 0;
        }

        const isChecked = idx === 0 ? 'checked' : '';
        if (idx === 0) state.selectedQuoteId = q.id;

        tr.innerHTML = `
            <td class="text-center">
                <input type="radio" name="radioForwarderQuote" value="${q.id}" ${isChecked}>
            </td>
            <td class="text-center">${q.quoteDate || q.createdAt?.slice(0, 10) || '-'}</td>
            <td class="text-left" style="font-weight: 600;">${q.title || '수입 물류 견적'}</td>
            <td class="text-center">${q.shipmentType || 'FCL'} (${q.containerType || '20ft'})</td>
            <td class="text-center">${forwarderName}</td>
            <td class="text-right" style="font-weight: 700; color: #0284c7;">${num(totalCostKrw)}원</td>
        `;

        tr.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const radio = tr.querySelector('input[type="radio"]');
                if (radio) radio.checked = true;
            }
            state.selectedQuoteId = q.id;
        });

        tbody.appendChild(tr);
    });

    tbody.querySelectorAll('input[name="radioForwarderQuote"]').forEach(r => {
        r.addEventListener('change', (e) => {
            state.selectedQuoteId = e.target.value;
        });
    });
}

function applySelectedForwarderQuote() {
    if (!state.selectedQuoteId) {
        showToast('적용할 포워더 견적서를 선택하세요.', true);
        return;
    }

    const quote = state.forwarderQuotes.find(q => q.id === state.selectedQuoteId);
    if (!quote) {
        showToast('선택된 견적 정보를 찾을 수 없습니다.', true);
        return;
    }

    const qty = state.product.quantity > 0 ? state.product.quantity : 3000;

    let oceanTotal = 0;
    let customsTotal = 0;
    let inlandTotal = 0;
    let otherTotal = 0;

    if (quote.forwarders && quote.forwarders.length > 0) {
        const f = quote.forwarders[0];
        if (f.costs && Array.isArray(f.costs)) {
            f.costs.forEach(c => {
                const amount = Number(c.amountKrw || c.totalKrw || c.amount || 0);
                const key = String(c.key || c.label || '').toUpperCase();
                if (key.includes('OF') || key.includes('OCEAN') || key.includes('해상')) {
                    oceanTotal += amount;
                } else if (key.includes('INLAND') || key.includes('TRUCK') || key.includes('내륙') || key.includes('운송')) {
                    inlandTotal += amount;
                } else if (key.includes('CUSTOMS') || key.includes('THC') || key.includes('CY') || key.includes('통관') || key.includes('하역')) {
                    customsTotal += amount;
                } else {
                    otherTotal += amount;
                }
            });
        }

        const totalKrw = f.totalKrw || (oceanTotal + customsTotal + inlandTotal + otherTotal);
        if (oceanTotal === 0 && inlandTotal === 0 && totalKrw > 0) {
            oceanTotal = Math.round(totalKrw * 0.40);
            customsTotal = Math.round(totalKrw * 0.30);
            inlandTotal = Math.round(totalKrw * 0.30);
        }
    }

    const perOcean = Math.round(oceanTotal / qty);
    const perCustoms = Math.round(customsTotal / qty);
    const perInland = Math.round(inlandTotal / qty);
    const perOther = Math.round(otherTotal / qty);

    state.costs.oceanFreight = perOcean || state.costs.oceanFreight;
    state.costs.customsFee = perCustoms || state.costs.customsFee;
    state.costs.inlandFreight = perInland || state.costs.inlandFreight;
    state.costs.otherCost = perOther;
    state.isForwarderApplied = true;

    document.getElementById('inputOceanFreight').value = state.costs.oceanFreight;
    document.getElementById('inputCustomsFee').value = state.costs.customsFee;
    document.getElementById('inputInlandFreight').value = state.costs.inlandFreight;
    document.getElementById('inputOtherCost').value = state.costs.otherCost;

    const badge = document.getElementById('forwarderAppliedBadge');
    if (badge) badge.style.display = 'inline-flex';

    closeForwarderModal();
    recalculateAndRender();
    showToast(`'${quote.title || '선택 견적'}' 부대비용이 개당 배부되어 적용되었습니다.`);
}

// ─────────────────────────────────────────────────────────────
// 8. 기안문 복사 & CSV 엑셀 다운로드
// ─────────────────────────────────────────────────────────────
async function copyReportToClipboard() {
    const landed = MarginEngine.calculateLandedCost(state.product, state.costs);
    const calculatedChannels = MarginEngine.calculateChannelMargins(landed.landedCost, state.channels);
    const savings = MarginEngine.calculateInternalSavings(landed.landedCost, state.savings);

    const reportText = MarginEngine.generateReportText({
        product: state.product,
        costs: state.costs,
        landed,
        channels: calculatedChannels,
        savings,
        remarks: state.remarks
    });

    try {
        await navigator.clipboard.writeText(reportText);
        showToast('기안문 텍스트가 클립보드에 복사되었습니다.');
    } catch (e) {
        const textarea = document.createElement('textarea');
        textarea.value = reportText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('기안문 텍스트가 클립보드에 복사되었습니다.');
    }
}

function exportToCsv() {
    const landed = MarginEngine.calculateLandedCost(state.product, state.costs);
    const calculatedChannels = MarginEngine.calculateChannelMargins(landed.landedCost, state.channels);
    const savings = MarginEngine.calculateInternalSavings(landed.landedCost, state.savings);

    let csvContent = '\uFEFF';
    csvContent += `수입 소싱 원가 분석 및 채널별 마진 시뮬레이션 보고서\n\n`;

    csvContent += `[1. 품목 기본정보]\n`;
    csvContent += `품목명,${state.product.productName}\n`;
    csvContent += `FOB 단가,${state.product.fobForeignPrice} ${state.product.currency}\n`;
    csvContent += `기준 환율,${state.product.exchangeRate} 원\n`;
    csvContent += `원화 물품대,${landed.fobKrwPrice} 원\n`;
    csvContent += `선적 수량,${state.product.quantity} PCS\n`;
    csvContent += `한중 FTA 면세 적용,${state.costs.isFtaExempt ? '적용 (0%)' : `미적용 (${state.costs.tariffRate}%)`}\n\n`;

    csvContent += `[2. 원가 분해 (개당)]\n`;
    csvContent += `구분,금액(원),비중(%)\n`;
    csvContent += `FOB 물품대,${landed.fobKrwPrice},${landed.costRatio.goods}%\n`;
    csvContent += `해상운임/보험,${state.costs.oceanFreight},${landed.costRatio.ocean}%\n`;
    csvContent += `통관/창고/하역,${state.costs.customsFee},${landed.costRatio.customs}%\n`;
    csvContent += `국내 내륙운송,${state.costs.inlandFreight},${landed.costRatio.inland}%\n`;
    csvContent += `관세,${landed.tariffAmount},${landed.costRatio.tariff}%\n`;
    csvContent += `최종 입고원가,${landed.landedCost},100%\n\n`;

    csvContent += `[3. 채널별 목표 판매가 및 수익성]\n`;
    csvContent += `판매 채널,목표 판매가(원),마진액(원),마진율(%),원가가산율(%)\n`;
    calculatedChannels.forEach(c => {
        csvContent += `${c.channelName},${c.targetPrice},${c.marginAmount},${c.marginRate}%,${c.markupRate}%\n`;
    });
    csvContent += `\n`;

    if (savings && savings.existingPurchasePrice > 0) {
        csvContent += `[4. 사내 원가 절감 효과]\n`;
        csvContent += `기존 매입단가,${savings.existingPurchasePrice} 원\n`;
        csvContent += `당사 입고원가,${landed.landedCost} 원\n`;
        csvContent += `개당 절감액,${savings.savingPerUnit} 원 (${savings.savingRate}%)\n`;
        csvContent += `연간 총 절감액,${savings.annualTotalSaving} 원 (${savings.annualVolume}개 전량 대체)\n\n`;
    }

    if (state.remarks) {
        csvContent += `[5. 종합 검토의견]\n`;
        csvContent += `"${state.remarks.replace(/"/g, '""')}"\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeName = (state.product.productName || 'import_simulator').replace(/[^a-zA-Z0-9가-힣_]/g, '_');
    link.download = `${safeName}_마진시뮬레이션_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('시뮬레이션 내역이 CSV(엑셀) 파일로 다운로드되었습니다.');
}

function resetToDefault() {
    const d = JSON.parse(JSON.stringify(DEFAULT_STATE));
    currentSimulationId = null;
    currentSimulationTitle = d.product.productName;

    Object.assign(state.product, d.product);
    Object.assign(state.costs, d.costs);
    state.channels = JSON.parse(JSON.stringify(d.channels));
    Object.assign(state.savings, d.savings);
    state.remarks = d.remarks;
    state.isForwarderApplied = false;

    syncFormInputs();
    updateDocStatusBadge();
    recalculateAndRender();
    showToast('기본 형광 안전조끼 OEM 파라미터로 초기화되었습니다.');
}
