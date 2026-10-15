/**
 * ═══════════════════════════════════════════════════════════════
 * K&G Official Document & Business Letter Controller
 * 주식회사 케앤지 공식 공문 / 업무협조전 작성기 스크립트
 * ═══════════════════════════════════════════════════════════════
 */

(function () {
    'use strict';

    // ── 1. 기본 회사 정보 (사용자 지정 공식 정보) ──
    const DEFAULT_COMPANY_INFO = {
        nameKr: '주식회사 케앤지',
        nameEn: 'K&G Co., LTD.',
        address: '서울시 강동구 구천면로 159, 1층 2호, 3호',
        tel: '02-2038-0160',
        fax: '02-2038-0162',
        email: 'contact@junparks.com',
        bizNum: '845-88-00551',
        logoUrl: '../../assets/images/logo.png',
        stampUrl: '../../assets/images/stamp.png'
    };

    // 로컬 스토리지 키
    const STORAGE_KEY_ARCHIVE = 'kng_official_doc_archive_v1';
    const STORAGE_KEY_SENDER = 'kng_official_doc_sender_preset_v1';
    const STORAGE_KEY_DRAFT = 'kng_official_doc_current_draft_v1';
    const STORAGE_KEY_COMPANY = 'kng_official_doc_company_settings_v1';

    // ── 2. 기본 프리셋 템플릿 목록 ──
    const PRESETS = {
        sample_request: {
            name: '[기본] 샘플 송부 및 조끼 제작 견적 의뢰서',
            docTitle: '샘플 송부 안내 및 조끼 제작 견적 의뢰서',
            to: '(주)일터루코리아 고영종 실장님',
            cc: '(주)일터루코리아 고병삼 대표님',
            subject: '안전조끼 샘플 송부 및 OEM 제작 견적 의뢰의 건 ((주)행복한안전 이한우 대표님 소개 건)',
            body: `1. 귀사의 무궁한 발전을 기원합니다.

2. 본 건은 (주)행복한안전 이한우 대표님의 소개로 고병삼 대표님과 유선 통화 후, 고영종 실장님 앞으로 검토용 조끼 샘플(1벌)을 동봉하여 송부드리는 건입니다.

3. 당사에서 기획 중인 조끼의 제작 사양 및 의뢰 내역을 아래와 같이 전달드리오니, 동봉된 샘플을 바탕으로 제작 가능 여부 및 단가 검토를 부탁드립니다.


                         - 아   래 (제작 의뢰 사양) -

■ 1. 예상 발주 수량 및 견적 요청 구간
  • 의뢰 수량 : 1,000 pcs 또는 2,000 pcs (두 가지 수량 구간별 단가 비교 요청)
  • 사이즈별 수량 배분 :
    - 2,000장 기준 : M(200장) / L(450장) / XL(450장) / 2XL(450장) / 3XL(450장)
    - 1,000장 기준 : M(100장) / L(225장) / XL(225장) / 2XL(225장) / 3XL(225장)

■ 2. 원단 및 색상 사양 (중요)
  • 원단 조직 : 메쉬(Mesh) 및 주머니 원단 모두 반드시 '직조(Woven) 방식' 원단 사용
                (※ 편직물/Knitted 방식 원단 사용 불가)
  • 원단 색상 : 형광 색상
    - 동봉된 샘플은 '형광 노랑'이나 '형광 그린'으로 변경 가능함.
    - 특히 단가 절감 및 원활한 원단 수급을 위해, 현재 (주)일터루코리아에서 
      생산 중인 기존 조끼의 원단/컬러(Woven 조건 충족 시)를 동일하게 적용하는 
      방안도 적극 고려 중이오니 유리한 조건으로 제안 부탁드립니다.

■ 3. 라벨(Label) 부착 사양
  • 브랜드 라벨 : 직조 라벨(Woven Label) / 조끼 안쪽 상단 중앙 부착
  • 케어 라벨   : 인쇄 라벨(Printed Label) / 조끼 안쪽 왼쪽 옆구리 봉제선 부착
    (※ 라벨 도안은 발주 확정 시 당사에서 데이터 파일로 전달 예정)

■ 4. 확인 및 회신 요청 사항
  1) 수량 구간별 제작 단가 (1,000 pcs 기준 단가 / 2,000 pcs 기준 단가)
  2) 일터루코리아 기존 생산 원단/컬러 적용 시 단가 차이 여부
  3) 발주 확정 후 국내 납품까지 예상 제작 소요 기간 (Lead Time)

■ 5. 샘플 보관 및 반환 요청
  • 동봉해 드린 조끼는 당사 보관용 기준 샘플이므로, 원단 절개나 봉제 해체 등 
    원형 훼손 없이 검토 및 보관해 주시기를 부탁드립니다.
  • 견적 산출 및 검토가 완료된 후에는 동봉된 명함의 주소지로 샘플을 
    반환(택배 발송)해 주시면 감사하겠습니다.`,
            attachments: `* 첨부물 : 검토용 조끼 실물 샘플 1벌, 당사 명함 1매.
* 샘플 확인 후 궁금하신 사항은 명함에 기재된 연락처로 편히 연락 주시기 바랍니다. 바쁘신 중에 세심히 검토해 주셔서 감사합니다.`,
            includeStamp: false
        },
        cooperation_request: {
            name: '[업무협조] 납품 일정 및 현장 실사 협조 요청의 건',
            docTitle: '업 무 협 조 전',
            to: '협력업체 대표이사 귀하',
            cc: '생산관리팀장, 품질보증팀장',
            subject: '안전용품 공급 납기 준수 및 사전 품질 실사 협조의 건',
            body: `1. 귀사의 일익 번창하심을 진심으로 기원합니다.

2. 당사에서 추진 중인 주요 납품 프로젝트와 관련하여, 최종 납품 기일의 안정적 확보를 위해 아래와 같이 사전 품질 실사 및 생산 일정을 공유드리오니 적극적인 업무 협조를 부탁드립니다.


                         - 아   래 -

■ 1. 대상 프로젝트 및 품목
  • 프로젝트명 : 2026 하반기 안전물품 정기 조달 건
  • 주요 품목 : 안전모, 안전조끼, 안전화 일체

■ 2. 협조 요청 사항
  • 완제품 중간 검수 일정 : 2026년 [  ]월 [  ]일 (당사 품질관리 담당자 현장 방문)
  • 최종 패킹 및 출하 예정일 : 2026년 [  ]월 [  ]일
  • 납품처 도착도 지정 창고 : 경기도 파주시 조리읍 당사 물류센터

■ 3. 회신 기한 및 제출 서류
  • 사전 생산 일정표 및 공정 검사 성적서 1부 제출 요망
  • 회신 기한 : 2026년 [  ]월 [  ]일 17:00까지`,
            attachments: `* 첨부물 : 1. 발주 명세서 사본 1부.\n          2. 당사 검수 기준 가이드 1부.`,
            includeStamp: false
        },
        price_notice: {
            name: '[안내문] 단가 조정 및 2026년 공급 조건 안내의 건',
            docTitle: '공 급 가 격 변 동 안 내 문',
            to: '거래처 구매담당자 귀하',
            cc: '영업본부장',
            subject: '2026년 원부자재 인상에 따른 공급 단가 조정 안내의 건',
            body: `1. 평소 각별한 신뢰와 성원을 보내주시는 귀사에 깊은 감사를 드립니다.

2. 주지하시는 바와 같이 최근 글로벌 원자재 가격 급등 및 원단 직조 공임 인상으로 인하여, 당사에서도 내부적인 원가 절감 노력만으로는 기존 납품 단가를 유지하기 어려운 한계에 직면하게 되었습니다.

3. 이에 부득이하게 일부 품목의 공급 단가를 다음과 같이 조정 적용하게 되었음을 안내드리오니, 귀사의 깊은 혜량과 양해를 부탁드립니다.


                         - 아   래 -

■ 1. 단가 조정 적용 일자 : 2026년 [  ]월 1일 출하분부터
■ 2. 조정 대상 품목 및 인상률
  • 전 품목 평균 인상률 : 약 [  ]% 수준
  • 세부 품목별 조정 단가표 : 첨부 견적 명세서 참조
■ 3. 기계약 건의 처리
  • 기존 확정 발주분 및 [  ]월 말일까지 접수된 발주 건은 기존 공급가 그대로 적용됩니다.`,
            attachments: `* 첨부물 : 2026년 개정 공급 단가표 1부.`,
            includeStamp: false
        },
        payment_request: {
            name: '[확인/청구] 거래사실 확인 및 정산 대금 청구의 건',
            docTitle: '거 래 사 실 확 인 및 대 금 청 구 서',
            to: '거래처 자금/회계팀 담당자 귀하',
            cc: '대표이사 귀하',
            subject: '납품 완료에 따른 미지급 거래대금 정산 및 입금 협조의 건',
            body: `1. 귀사의 무궁한 발전을 기원합니다.

2. 당사가 귀사에 정식 납품 완료한 물품에 대하여 세금계산서 발행 및 검수가 완료되었으나, 약정된 결제 기일이 경과하여 현재까지 미입금 상태로 확인되고 있습니다.

3. 당사의 원활한 자금 운영 및 지속적인 거래 관계 유지를 위하여, 아래 미지급 대금을 조속히 확인하시어 지정 입금 계좌로 결제해 주시기를 정중히 요청드립니다.


                         - 아   래 -

■ 1. 납품 내역 및 청구 금액
  • 전자세금계산서 승인번호 : [ 세금계산서 승인번호 ]
  • 세금계산서 발행일자 : 2026년 [  ]월 [  ]일
  • 총 청구 금액 : 금 [           ]원정 (VAT 포함)

■ 2. 입금 지정 계좌
  • 거래은행 : 기업은행 123-456789-01-012
  • 예금주 : 주식회사 케앤지`,
            attachments: `* 첨부물 : 1. 납품확인서 사본 1부.\n          2. 전자세금계산서 사본 1부.`,
            includeStamp: true
        },
        blank: {
            name: '[자유 서식] 빈 공문 양식',
            docTitle: '공   문   서',
            to: '수신처 입력',
            cc: '',
            subject: '공문 제목을 입력해 주세요.',
            body: `1. 귀사의 무궁한 발전을 기원합니다.

2. [본문 내용을 작성해 주세요.]


                         - 아   래 -

■ 1. 세부 사항 입력
  • 항목 : 내용`,
            attachments: `* 첨부물 : 관련 서류 1부.`,
            includeStamp: false
        }
    };

    // ── 3. 앱 상태 관리 ──
    const state = {
        activeTab: 'editor', // 'editor' | 'archive'
        company: Object.assign({}, DEFAULT_COMPANY_INFO),
        currentUser: { name: '', email: '', rank: '과장', department: '주식회사 케앤지' },
        currentDoc: {
            id: null,
            docTitle: '',
            to: '',
            cc: '',
            fromText: '',
            docDate: '',
            subject: '',
            body: '',
            attachments: '',
            signText: '',
            includeStamp: false,
            createdAt: ''
        },
        archiveList: []
    };

    // ── 4. DOM 요소 캐싱 ──
    let els = {};

    function initElements() {
        els = {
            // Tabs
            tabEditor: document.getElementById('tabEditor'),
            tabArchive: document.getElementById('tabArchive'),
            viewEditor: document.getElementById('viewEditor'),
            viewArchive: document.getElementById('viewArchive'),
            archiveCountBadge: document.getElementById('archiveCountBadge'),

            // Actions
            btnNewDoc: document.getElementById('btnNewDoc'),
            btnSaveDoc: document.getElementById('btnSaveDoc'),
            btnPrint: document.getElementById('btnPrint'),
            btnSettings: document.getElementById('btnSettings'),
            presetSelect: document.getElementById('presetSelect'),

            // Form Inputs
            inputDocTitle: document.getElementById('inputDocTitle'),
            inputTo: document.getElementById('inputTo'),
            inputCc: document.getElementById('inputCc'),
            inputFromText: document.getElementById('inputFromText'),
            inputDocDate: document.getElementById('inputDocDate'),
            inputSubject: document.getElementById('inputSubject'),
            inputBody: document.getElementById('inputBody'),
            inputAttachments: document.getElementById('inputAttachments'),
            inputSignText: document.getElementById('inputSignText'),
            chkIncludeStamp: document.getElementById('chkIncludeStamp'),
            btnSaveSenderPreset: document.getElementById('btnSaveSenderPreset'),
            userBadgeName: document.getElementById('userBadgeName'),

            // Quick Format Buttons
            btnQuickBelow: document.getElementById('btnQuickBelow'),
            btnQuickSection: document.getElementById('btnQuickSection'),
            btnQuickBullet: document.getElementById('btnQuickBullet'),
            btnQuickAttach: document.getElementById('btnQuickAttach'),
            btnQuickGreeting: document.getElementById('btnQuickGreeting'),

            // Live A4 Preview Elements
            prevCorpKr: document.getElementById('prevCorpKr'),
            prevCorpEn: document.getElementById('prevCorpEn'),
            prevAddress: document.getElementById('prevAddress'),
            prevTel: document.getElementById('prevTel'),
            prevFax: document.getElementById('prevFax'),
            prevEmail: document.getElementById('prevEmail'),
            prevLogoImg: document.getElementById('prevLogoImg'),
            prevLogoFallback: document.getElementById('prevLogoFallback'),

            prevDocTitle: document.getElementById('prevDocTitle'),
            prevTo: document.getElementById('prevTo'),
            prevCcRow: document.getElementById('prevCcRow'),
            prevCc: document.getElementById('prevCc'),
            prevFrom: document.getElementById('prevFrom'),
            prevDate: document.getElementById('prevDate'),
            prevSubject: document.getElementById('prevSubject'),
            prevBody: document.getElementById('prevBody'),
            prevAttachBox: document.getElementById('prevAttachBox'),
            prevAttachContent: document.getElementById('prevAttachContent'),
            prevSignText: document.getElementById('prevSignText'),
            prevSealImg: document.getElementById('prevSealImg'),
            prevFooterInfo: document.getElementById('prevFooterInfo'),

            // Archive
            archiveTableBody: document.getElementById('archiveTableBody'),
            archiveSearchInput: document.getElementById('archiveSearchInput'),

            // Settings Modal
            settingsModal: document.getElementById('settingsModal'),
            btnCloseSettings: document.getElementById('btnCloseSettings'),
            btnCancelSettings: document.getElementById('btnCancelSettings'),
            btnSaveSettings: document.getElementById('btnSaveSettings'),
            setCorpKr: document.getElementById('setCorpKr'),
            setCorpEn: document.getElementById('setCorpEn'),
            setAddress: document.getElementById('setAddress'),
            setTel: document.getElementById('setTel'),
            setFax: document.getElementById('setFax'),
            setEmail: document.getElementById('setEmail'),
            setLogoUrl: document.getElementById('setLogoUrl')
        };
    }

    // ── 5. 로그인 계정 감지 및 발신자 프로필 동기화 ──
    async function detectCurrentUser() {
        let name = '';
        let email = '';

        try {
            if (window.parent && window.parent.localStorage) {
                name = window.parent.localStorage.getItem('kngCurrentUser') || '';
                email = window.parent.localStorage.getItem('kngCurrentUserEmail') || '';
            }
        } catch (e) {}

        if (!name) name = localStorage.getItem('kngCurrentUser') || '';
        if (!email) email = localStorage.getItem('kngCurrentUserEmail') || '';

        state.currentUser.name = name || '담당자';
        state.currentUser.email = email || state.company.email;

        // 직급 및 부서 감지 시도 (admin_users API or portal_users)
        try {
            const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const apiUrl = isLocal ? 'http://localhost:3000/api/admin/users' : 'https://kng.junparks.com/api/admin/users';
            let token = null;
            if (window.parent && window.parent.getAuthToken) {
                token = await window.parent.getAuthToken();
            }
            if (token) {
                const res = await fetch(apiUrl, {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (res.ok) {
                    const users = await res.json();
                    const matched = users.find(u => (u.email && u.email.toLowerCase() === email.toLowerCase()) || u.name === name);
                    if (matched) {
                        if (matched.rank) state.currentUser.rank = matched.rank;
                        if (matched.department) state.currentUser.department = matched.department;
                    }
                }
            }
        } catch (err) {
            // 실패 시 기본값 유지
        }

        if (els.userBadgeName) {
            els.userBadgeName.textContent = `${state.currentUser.name} ${state.currentUser.rank}`;
        }
    }

    // ── 6. 발신자 및 서명 기본 생성 규칙 ──
    function buildDefaultSenderStrings() {
        const savedSender = localStorage.getItem(STORAGE_KEY_SENDER);
        if (savedSender) {
            try {
                const parsed = JSON.parse(savedSender);
                return parsed;
            } catch (e) {}
        }

        const nameWithRank = state.currentUser.name ? `${state.currentUser.name} ${state.currentUser.rank}` : '담당자';
        const fromText = `${state.company.nameKr} ${nameWithRank} (${state.company.tel} / ${state.currentUser.email || state.company.email})`;
        const signText = `${state.company.nameKr} ${nameWithRank} 배상`;

        return { fromText, signText };
    }

    // ── 7. 오늘 날짜 포맷 (한국어 표준) ──
    function getTodayFormatted() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        return `${year}년 ${month}월 ${day}일`;
    }

    // ── 8. 템플릿 로드 함수 ──
    function loadPreset(presetKey) {
        const p = PRESETS[presetKey];
        if (!p) return;

        const senders = buildDefaultSenderStrings();

        els.inputDocTitle.value = p.docTitle;
        els.inputTo.value = p.to;
        els.inputCc.value = p.cc;
        els.inputFromText.value = senders.fromText;
        els.inputDocDate.value = getTodayFormatted();
        els.inputSubject.value = p.subject;
        els.inputBody.value = p.body;
        els.inputAttachments.value = p.attachments;
        els.inputSignText.value = senders.signText;
        els.chkIncludeStamp.checked = !!p.includeStamp;

        state.currentDoc.id = null; // 신규 문서로 취급
        renderPreview();
    }

    // ── 9. 실시간 A4 미리보기 렌더링 ──
    function renderPreview() {
        // Form Data Sync
        const docTitle = els.inputDocTitle.value.trim() || '공 문 서';
        const to = els.inputTo.value.trim();
        const cc = els.inputCc.value.trim();
        const from = els.inputFromText.value.trim();
        const date = els.inputDocDate.value.trim();
        const subject = els.inputSubject.value.trim();
        const body = els.inputBody.value;
        const attach = els.inputAttachments.value.trim();
        const sign = els.inputSignText.value.trim();
        const stamp = els.chkIncludeStamp.checked;

        // Company Info Header
        els.prevCorpKr.textContent = state.company.nameKr;
        els.prevCorpEn.textContent = state.company.nameEn;
        els.prevAddress.textContent = state.company.address;
        els.prevTel.textContent = `TEL: ${state.company.tel}`;
        els.prevFax.textContent = `FAX: ${state.company.fax}`;
        els.prevEmail.textContent = `E-MAIL: ${state.company.email}`;

        // Header Logo Test
        if (state.company.logoUrl) {
            els.prevLogoImg.src = state.company.logoUrl;
            els.prevLogoImg.style.display = 'block';
            els.prevLogoFallback.style.display = 'none';
        } else {
            els.prevLogoImg.style.display = 'none';
            els.prevLogoFallback.style.display = 'inline-block';
        }

        // Meta Values
        els.prevDocTitle.textContent = docTitle;
        els.prevTo.textContent = to || '(수신처 미입력)';

        if (cc) {
            els.prevCcRow.style.display = 'table-row';
            els.prevCc.textContent = cc;
        } else {
            els.prevCcRow.style.display = 'none';
        }

        els.prevFrom.textContent = from || '(발신자 미입력)';
        els.prevDate.textContent = date || getTodayFormatted();
        els.prevSubject.textContent = subject || '(공문 제목을 입력해 주세요)';

        // Body Content
        els.prevBody.textContent = body;

        // Attachments Box
        if (attach) {
            els.prevAttachBox.style.display = 'block';
            els.prevAttachContent.textContent = attach;
        } else {
            els.prevAttachBox.style.display = 'none';
        }

        // Closing Sign-off
        els.prevSignText.textContent = sign || `${state.company.nameKr} 배상`;

        // Seal Image
        if (stamp) {
            els.prevSealImg.src = state.company.stampUrl;
            els.prevSealImg.style.display = 'block';
        } else {
            els.prevSealImg.style.display = 'none';
        }

        // Footer Info
        els.prevFooterInfo.textContent = `${state.company.nameKr} | 사업자등록번호: ${state.company.bizNum} | ${state.company.address}`;

        // Save Temporary Draft
        saveDraft();
    }

    // ── 10. 자동 임시저장 (Auto Draft) ──
    function saveDraft() {
        const draft = {
            docTitle: els.inputDocTitle.value,
            to: els.inputTo.value,
            cc: els.inputCc.value,
            fromText: els.inputFromText.value,
            docDate: els.inputDocDate.value,
            subject: els.inputSubject.value,
            body: els.inputBody.value,
            attachments: els.inputAttachments.value,
            signText: els.inputSignText.value,
            includeStamp: els.chkIncludeStamp.checked,
            updatedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(STORAGE_KEY_DRAFT, JSON.stringify(draft));
        } catch (e) {}
    }

    function restoreDraft() {
        const raw = localStorage.getItem(STORAGE_KEY_DRAFT);
        if (raw) {
            try {
                const d = JSON.parse(raw);
                els.inputDocTitle.value = d.docTitle || '';
                els.inputTo.value = d.to || '';
                els.inputCc.value = d.cc || '';
                els.inputFromText.value = d.fromText || '';
                els.inputDocDate.value = d.docDate || getTodayFormatted();
                els.inputSubject.value = d.subject || '';
                els.inputBody.value = d.body || '';
                els.inputAttachments.value = d.attachments || '';
                els.inputSignText.value = d.signText || '';
                els.chkIncludeStamp.checked = !!d.includeStamp;
                renderPreview();
                return true;
            } catch (e) {}
        }
        return false;
    }

    // ── 11. 문서 보관함 (Archive) 저장 및 관리 ──
    function loadArchive() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_ARCHIVE);
            state.archiveList = raw ? JSON.parse(raw) : [];
        } catch (e) {
            state.archiveList = [];
        }
        updateArchiveBadge();
        renderArchiveTable();
    }

    function updateArchiveBadge() {
        if (els.archiveCountBadge) {
            els.archiveCountBadge.textContent = state.archiveList.length;
        }
    }

    function saveCurrentDocToArchive() {
        const subject = els.inputSubject.value.trim();
        if (!subject) {
            alert('공문 제목을 입력한 후 저장해 주세요.');
            els.inputSubject.focus();
            return;
        }

        const now = new Date();
        const dateCode = now.getFullYear().toString() + (now.getMonth() + 1).toString().padStart(2, '0');
        const docNo = `KNG-${dateCode}-${(state.archiveList.length + 1).toString().padStart(3, '0')}`;

        const docRecord = {
            id: state.currentDoc.id || 'doc_' + Date.now(),
            docNo: docNo,
            docTitle: els.inputDocTitle.value.trim(),
            to: els.inputTo.value.trim(),
            cc: els.inputCc.value.trim(),
            fromText: els.inputFromText.value.trim(),
            docDate: els.inputDocDate.value.trim(),
            subject: subject,
            body: els.inputBody.value,
            attachments: els.inputAttachments.value.trim(),
            signText: els.inputSignText.value.trim(),
            includeStamp: els.chkIncludeStamp.checked,
            savedAt: now.toLocaleString('ko-KR')
        };

        const existingIndex = state.archiveList.findIndex(item => item.id === docRecord.id);
        if (existingIndex >= 0) {
            state.archiveList[existingIndex] = docRecord;
        } else {
            state.archiveList.unshift(docRecord);
        }

        state.currentDoc.id = docRecord.id;
        localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(state.archiveList));
        updateArchiveBadge();
        renderArchiveTable();

        alert('공문이 보관함에 안전하게 저장되었습니다.');
    }

    function renderArchiveTable() {
        if (!els.archiveTableBody) return;

        const keyword = (els.archiveSearchInput ? els.archiveSearchInput.value.trim().toLowerCase() : '');
        const filtered = state.archiveList.filter(item => {
            if (!keyword) return true;
            return (item.subject && item.subject.toLowerCase().includes(keyword)) ||
                   (item.to && item.to.toLowerCase().includes(keyword)) ||
                   (item.fromText && item.fromText.toLowerCase().includes(keyword)) ||
                   (item.docDate && item.docDate.includes(keyword));
        });

        if (filtered.length === 0) {
            els.archiveTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--slate-500); padding: 40px 10px;">보관된 공문이 없습니다. [새 공문 작성]에서 문서를 작성하고 저장해 보세요.</td></tr>`;
            return;
        }

        let html = '';
        filtered.forEach((item, idx) => {
            html += `
                <tr>
                    <td style="font-weight: 700; color: var(--slate-700);">${item.docNo || '-'}</td>
                    <td style="color: var(--slate-600);">${item.docDate || '-'}</td>
                    <td><span class="badge-tag">${escapeHtml(item.to || '-')}</span></td>
                    <td style="font-weight: 600; color: var(--slate-900); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${escapeHtml(item.subject || '(무제)')}
                    </td>
                    <td style="color: var(--slate-600); font-size: 11.5px;">${escapeHtml(item.fromText ? item.fromText.split('(')[0].trim() : '-')}</td>
                    <td style="color: var(--slate-500); font-size: 11px;">${item.savedAt || '-'}</td>
                    <td>
                        <button type="button" class="btn-custom btn-outline-custom" style="padding: 3px 8px; font-size: 11.5px;" onclick="window.officialDocApp.loadDocFromArchive('${item.id}')">
                            <i class='bx bx-edit'></i> 열기
                        </button>
                        <button type="button" class="btn-custom btn-outline-custom" style="padding: 3px 8px; font-size: 11.5px; color: var(--danger-color);" onclick="window.officialDocApp.deleteDocFromArchive('${item.id}')">
                            <i class='bx bx-trash'></i>
                        </button>
                    </td>
                </tr>
            `;
        });
        els.archiveTableBody.innerHTML = html;
    }

    function loadDocFromArchive(id) {
        const item = state.archiveList.find(d => d.id === id);
        if (!item) return;

        els.inputDocTitle.value = item.docTitle || '공문서';
        els.inputTo.value = item.to || '';
        els.inputCc.value = item.cc || '';
        els.inputFromText.value = item.fromText || '';
        els.inputDocDate.value = item.docDate || '';
        els.inputSubject.value = item.subject || '';
        els.inputBody.value = item.body || '';
        els.inputAttachments.value = item.attachments || '';
        els.inputSignText.value = item.signText || '';
        els.chkIncludeStamp.checked = !!item.includeStamp;

        state.currentDoc.id = item.id;
        renderPreview();
        switchTab('editor');
    }

    function deleteDocFromArchive(id) {
        if (!confirm('정말 이 공문 기록을 삭제하시겠습니까?')) return;
        state.archiveList = state.archiveList.filter(d => d.id !== id);
        localStorage.setItem(STORAGE_KEY_ARCHIVE, JSON.stringify(state.archiveList));
        updateArchiveBadge();
        renderArchiveTable();
    }

    // ── 12. 탭 전환 ──
    function switchTab(tabName) {
        state.activeTab = tabName;
        if (tabName === 'editor') {
            els.tabEditor.classList.add('active');
            els.tabArchive.classList.remove('active');
            els.viewEditor.style.display = 'grid';
            els.viewArchive.style.display = 'none';
        } else {
            els.tabEditor.classList.remove('active');
            els.tabArchive.classList.add('active');
            els.viewEditor.style.display = 'none';
            els.viewArchive.style.display = 'block';
            renderArchiveTable();
        }
    }

    // ── 13. 본문 퀵 인서트 도우미 ──
    function insertToBody(textToInsert) {
        const textarea = els.inputBody;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        textarea.value = val.substring(0, start) + textToInsert + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
        textarea.focus();
        renderPreview();
    }

    // ── 14. 회사 기본 정보 설정 모달 ──
    function loadCompanySettings() {
        const saved = localStorage.getItem(STORAGE_KEY_COMPANY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                state.company = Object.assign({}, DEFAULT_COMPANY_INFO, parsed);
            } catch (e) {}
        }
    }

    function openSettingsModal() {
        els.setCorpKr.value = state.company.nameKr;
        els.setCorpEn.value = state.company.nameEn;
        els.setAddress.value = state.company.address;
        els.setTel.value = state.company.tel;
        els.setFax.value = state.company.fax;
        els.setEmail.value = state.company.email;
        els.setLogoUrl.value = state.company.logoUrl;
        els.settingsModal.classList.add('active');
    }

    function closeSettingsModal() {
        els.settingsModal.classList.remove('active');
    }

    function saveCompanySettings() {
        state.company.nameKr = els.setCorpKr.value.trim() || DEFAULT_COMPANY_INFO.nameKr;
        state.company.nameEn = els.setCorpEn.value.trim() || DEFAULT_COMPANY_INFO.nameEn;
        state.company.address = els.setAddress.value.trim() || DEFAULT_COMPANY_INFO.address;
        state.company.tel = els.setTel.value.trim() || DEFAULT_COMPANY_INFO.tel;
        state.company.fax = els.setFax.value.trim() || DEFAULT_COMPANY_INFO.fax;
        state.company.email = els.setEmail.value.trim() || DEFAULT_COMPANY_INFO.email;
        state.company.logoUrl = els.setLogoUrl.value.trim();

        localStorage.setItem(STORAGE_KEY_COMPANY, JSON.stringify(state.company));
        closeSettingsModal();
        renderPreview();
        alert('회사 기본 정보가 저장되었습니다.');
    }

    // ── 15. 발신자 프로필 영구 저장 ──
    function saveSenderPreset() {
        const profile = {
            fromText: els.inputFromText.value.trim(),
            signText: els.inputSignText.value.trim()
        };
        localStorage.setItem(STORAGE_KEY_SENDER, JSON.stringify(profile));
        alert('현재 입력된 [발신인] 및 [하단 서명] 정보가 기본 프로필로 저장되었습니다.\n다음 새 공문 작성 시 이 정보가 자동으로 반영됩니다.');
    }

    // ── 16. 유틸리티 ──
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── 17. 이벤트 바인딩 ──
    function bindEvents() {
        // Tab switching
        els.tabEditor.addEventListener('click', () => switchTab('editor'));
        els.tabArchive.addEventListener('click', () => switchTab('archive'));

        // Preset dropdown
        els.presetSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                if (confirm('선택하신 템플릿으로 작성 내용을 교체하시겠습니까?')) {
                    loadPreset(e.target.value);
                }
            }
        });

        // Form live input listeners
        const liveInputs = [
            els.inputDocTitle, els.inputTo, els.inputCc, els.inputFromText,
            els.inputDocDate, els.inputSubject, els.inputBody, els.inputAttachments,
            els.inputSignText
        ];
        liveInputs.forEach(input => {
            input.addEventListener('input', renderPreview);
        });

        els.chkIncludeStamp.addEventListener('change', renderPreview);

        // Quick Format Buttons
        els.btnQuickBelow.addEventListener('click', () => insertToBody('\n\n                         - 아   래 -\n\n'));
        els.btnQuickSection.addEventListener('click', () => insertToBody('\n■ 1. 항목 제목\n  • 세부 내용 : '));
        els.btnQuickBullet.addEventListener('click', () => insertToBody('\n  • '));
        els.btnQuickAttach.addEventListener('click', () => {
            els.inputAttachments.value = (els.inputAttachments.value ? els.inputAttachments.value + '\n' : '') + '* 첨부물 : 1. 관련 증빙 서류 1부.';
            renderPreview();
        });
        els.btnQuickGreeting.addEventListener('click', () => insertToBody('귀사의 일익 번창하심을 기원합니다.\n\n'));

        // Toolbar Action Buttons
        els.btnNewDoc.addEventListener('click', () => {
            if (confirm('새 공문을 작성하시겠습니까? 현재 작성 중인 미저장 내용은 초기화됩니다.')) {
                loadPreset('sample_request');
                els.presetSelect.value = 'sample_request';
            }
        });

        els.btnSaveDoc.addEventListener('click', saveCurrentDocToArchive);
        els.btnPrint.addEventListener('click', () => window.print());
        els.btnSaveSenderPreset.addEventListener('click', saveSenderPreset);

        // Settings Modal
        els.btnSettings.addEventListener('click', openSettingsModal);
        els.btnCloseSettings.addEventListener('click', closeSettingsModal);
        els.btnCancelSettings.addEventListener('click', closeSettingsModal);
        els.btnSaveSettings.addEventListener('click', saveCompanySettings);

        // Archive search
        if (els.archiveSearchInput) {
            els.archiveSearchInput.addEventListener('input', renderArchiveTable);
        }

        // Image error fallback
        els.prevLogoImg.addEventListener('error', () => {
            els.prevLogoImg.style.display = 'none';
            els.prevLogoFallback.style.display = 'inline-block';
        });
    }

    // ── 18. 초기화 실행 ──
    async function init() {
        initElements();
        loadCompanySettings();
        await detectCurrentUser();
        loadArchive();

        // 임시저장 내용이 없으면 기본 1호 템플릿 로드
        const restored = restoreDraft();
        if (!restored) {
            loadPreset('sample_request');
        }

        bindEvents();
    }

    // 전역 노출 (인라인 onclick용)
    window.officialDocApp = {
        loadDocFromArchive,
        deleteDocFromArchive
    };

    document.addEventListener('DOMContentLoaded', init);
})();
