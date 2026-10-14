const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocal ? 'http://localhost:3000/api/leave-request' : 'https://kng.junparks.com/api/leave-request';

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) { 
                await new Promise(r => setTimeout(r, 400)); 
                token = await window.parent.getAuthToken(); 
                retries++; 
            }
        }
    } catch(e) {}
    
    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, options);
}

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 2500,
    timerProgressBar: true
});

function showToast(title, icon = 'success') {
    Toast.fire({ icon, title });
}

// ─────────────────────────────────────────────────────────────
// 메인 컨트롤러
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    let allLeaveRequests = [];
    let currentEditId = null;
    let myAllowance = null;

    // 현재 로그인된 유저 계정 정보 감지
    function getCurrentUser() {
        const email = localStorage.getItem('kngCurrentUserEmail') || '';
        const name = localStorage.getItem('kngCurrentUser') || '';
        return { email, name };
    }

    const els = {
        leaveListBody: document.getElementById('leaveListBody'),
        selectAll: document.getElementById('selectAll'),
        btnNewLeave: document.getElementById('btnNewLeave'),
        btnDeleteSelected: document.getElementById('btnDeleteSelected'),
        btnOpenAllowanceModal: document.getElementById('btnOpenAllowanceModal'),
        btnExportExcel: document.getElementById('btnExportExcel'),

        // Filters
        filterStatus: document.getElementById('filterStatus'),
        filterType: document.getElementById('filterType'),
        filterKeyword: document.getElementById('filterKeyword'),
        btnResetFilter: document.getElementById('btnResetFilter'),

        // KPI
        kpiUserLabel: document.getElementById('kpiUserLabel'),
        kpiRemainDays: document.getElementById('kpiRemainDays'),
        kpiProgressBar: document.getElementById('kpiProgressBar'),
        kpiPendingCount: document.getElementById('kpiPendingCount'),
        kpiApprovedDays: document.getElementById('kpiApprovedDays'),
        kpiTodayCount: document.getElementById('kpiTodayCount'),
        kpiTodayNames: document.getElementById('kpiTodayNames'),

        // Edit Modal
        modal: document.getElementById('leaveEditModal'),
        editTitle: document.getElementById('editViewTitle'),
        btnCloseEdit: document.getElementById('btnCloseEdit'),
        btnSaveLeave: document.getElementById('btnSaveLeave'),
        btnPrintLeave: document.getElementById('btnPrintLeave'),

        // Form Fields
        fDepartment: document.getElementById('fDepartment'),
        fRank: document.getElementById('fRank'),
        fName: document.getElementById('fName'),
        fLeaveType: document.getElementById('fLeaveType'),
        fLeaveStart: document.getElementById('fLeaveStart'),
        fLeaveEnd: document.getElementById('fLeaveEnd'),
        fDaysCount: document.getElementById('fDaysCount'),
        fSubmitDate: document.getElementById('fSubmitDate'),
        fStatus: document.getElementById('fStatus'),
        fReason: document.getElementById('fReason'),
        calcDaysDisplay: document.getElementById('calcDaysDisplay'),

        // Form Notice
        formNoticeUser: document.getElementById('formNoticeUser'),
        formNoticeTotal: document.getElementById('formNoticeTotal'),
        formNoticeUsed: document.getElementById('formNoticeUsed'),
        formNoticeRemain: document.getElementById('formNoticeRemain'),

        // Allowance Modal
        allowanceModal: document.getElementById('allowanceModal'),
        allowanceTableBody: document.getElementById('allowanceTableBody'),
        btnCloseAllowance: document.getElementById('btnCloseAllowance'),
        btnDoneAllowance: document.getElementById('btnDoneAllowance'),
        newAllowEmail: document.getElementById('newAllowEmail'),
        newAllowName: document.getElementById('newAllowName'),
        newAllowDept: document.getElementById('newAllowDept'),
        newAllowDays: document.getElementById('newAllowDays'),
        btnAddAllowance: document.getElementById('btnAddAllowance')
    };

    // ─────────────────────────────────────────────────────────
    // 1. 평일 일수 자동 계산 로직 (주말 토/일 제외)
    // ─────────────────────────────────────────────────────────
    function computeBusinessDays(startStr, endStr, leaveType) {
        if (!startStr) return 1.0;
        if (!endStr) endStr = startStr;

        // 경조휴가, 공가 등 별도 유급휴가는 연차에서 차감되지 않으므로 기본 0일
        if (leaveType === '경조휴가' || leaveType === '공가') {
            return 0.0;
        }

        if (leaveType && leaveType.includes('반차')) {
            return 0.5;
        }

        const d1 = new Date(startStr);
        const d2 = new Date(endStr);
        if (d1 > d2) return 1.0;

        let businessDays = 0;
        let cur = new Date(d1);

        while (cur <= d2) {
            const dayOfWeek = cur.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0=일, 6=토
                businessDays++;
            }
            cur.setDate(cur.getDate() + 1);
        }

        return businessDays;
    }

    function updateCalculatedDays() {
        const start = els.fLeaveStart.value;
        const end = els.fLeaveEnd.value;
        const type = els.fLeaveType.value;

        const days = computeBusinessDays(start, end, type);
        els.fDaysCount.value = days;
        if (days === 0 && (type === '경조휴가' || type === '공가')) {
            els.calcDaysDisplay.textContent = `0.0 일 (연차 미차감)`;
        } else {
            els.calcDaysDisplay.textContent = `${days} 일`;
        }
    }

    // ─────────────────────────────────────────────────────────
    // 2. 내 연차 요약 및 KPI 카드 갱신
    // ─────────────────────────────────────────────────────────
    async function loadMySummary() {
        const user = getCurrentUser();
        try {
            const res = await authFetch(`${API_URL}/my-summary?email=${encodeURIComponent(user.email)}`);
            if (res.ok) {
                myAllowance = await res.json();
                renderKpis();
            }
        } catch (e) {
            console.error('내 연차 요약 로드 실패:', e);
        }
    }

    function renderKpis() {
        const user = getCurrentUser();
        const userName = user.name || (myAllowance ? myAllowance.userName : '나');
        els.kpiUserLabel.textContent = `${userName} 님의 잔여 연차`;

        if (myAllowance) {
            const total = myAllowance.totalDays || 15;
            const remain = myAllowance.remainDays || 0;
            const used = myAllowance.usedDays || 0;
            els.kpiRemainDays.innerHTML = `${remain.toFixed(1)} <small>/ ${total.toFixed(1)}일</small>`;
            const pct = Math.min(100, Math.max(0, (used / total) * 100));
            els.kpiProgressBar.style.width = `${pct}%`;

            // 모달 내부 안내 박스 동기화
            els.formNoticeUser.textContent = `${userName} 님`;
            els.formNoticeTotal.textContent = total.toFixed(1);
            els.formNoticeUsed.textContent = used.toFixed(1);
            els.formNoticeRemain.textContent = `${remain.toFixed(1)}일`;
        }

        // 전체 목록 기반 KPI 집계
        let pendingCount = 0;
        let approvedDays = 0;
        const todayStr = new Date().toISOString().split('T')[0];
        const todayVacationers = [];

        allLeaveRequests.forEach(item => {
            const days = (item.daysCount !== undefined && item.daysCount !== null && item.daysCount !== '') ? Number(item.daysCount) : 1.0;
            if (item.status === '결재요청' || item.status === '결재진행중') {
                pendingCount++;
            }
            if (item.status === '결재완료') {
                approvedDays += days;
                // 오늘 휴가 중인지 판별
                const start = item.leaveStart || '';
                const end = item.leaveEnd || start;
                if (start <= todayStr && todayStr <= end) {
                    todayVacationers.push(item.name);
                }
            }
        });

        els.kpiPendingCount.innerHTML = `${pendingCount} <small>건</small>`;
        els.kpiApprovedDays.innerHTML = `${approvedDays.toFixed(1)} <small>일</small>`;
        els.kpiTodayCount.innerHTML = `${todayVacationers.length} <small>명</small>`;
        els.kpiTodayNames.textContent = todayVacationers.length > 0 
            ? todayVacationers.join(', ') + ' 휴가중' 
            : '금일 휴가자 없음';
    }

    // ─────────────────────────────────────────────────────────
    // 3. 전체 휴가원 목록 로드 및 테이블 렌더링
    // ─────────────────────────────────────────────────────────
    async function loadLeaveRequests() {
        try {
            const res = await authFetch(API_URL);
            if (!res.ok) throw new Error('목록 조회 실패');
            allLeaveRequests = await res.json();
            renderTable();
            renderKpis();
        } catch (err) {
            console.error(err);
            els.leaveListBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--danger); padding: 30px;">목록을 불러오지 못했습니다.</td></tr>`;
        }
    }

    function renderTable() {
        const filterStatus = els.filterStatus.value;
        const filterType = els.filterType.value;
        const keyword = els.filterKeyword.value.trim().toLowerCase();

        const filtered = allLeaveRequests.filter(item => {
            if (filterStatus && item.status !== filterStatus) return false;
            if (filterType && !(item.leaveType || '').includes(filterType)) return false;
            if (keyword) {
                const target = `${item.name || ''} ${item.department || ''} ${item.reason || ''}`.toLowerCase();
                if (!target.includes(keyword)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            els.leaveListBody.innerHTML = `<tr><td colspan="10" class="empty-state"><i class='bx bx-folder-open'></i>조건에 일치하는 휴가원 내역이 없습니다.</td></tr>`;
            return;
        }

        const getStatusBadge = (status) => {
            switch(status) {
                case '결재완료': return '<span class="badge badge-approved"><i class="bx bx-check"></i> 결재완료</span>';
                case '결재요청': return '<span class="badge badge-pending"><i class="bx bx-time"></i> 결재요청</span>';
                case '결재진행중': return '<span class="badge badge-pending"><i class="bx bx-loader"></i> 진행중</span>';
                case '임시작성': return '<span class="badge badge-draft">임시작성</span>';
                case '결재보류': return '<span class="badge badge-hold">결재보류</span>';
                default: return `<span class="badge badge-hold">${status || '미정'}</span>`;
            }
        };

        const getTypeBadge = (type) => {
            if (!type) return '-';
            if (type.includes('반차')) return `<span class="badge badge-type-half">${type}</span>`;
            return `<span class="badge badge-type-annual">${type}</span>`;
        };

        els.leaveListBody.innerHTML = filtered.map(item => {
            const period = item.leaveStart === item.leaveEnd ? (item.leaveStart || '-') : `${item.leaveStart} ~ ${item.leaveEnd}`;
            const days = (item.daysCount !== undefined && item.daysCount !== null && item.daysCount !== '') ? Number(item.daysCount) : 1.0;
            const daysText = days === 0 
                ? `<span style="color:#059669; font-weight:700;">0일</span> <small style="color:var(--text-muted); font-size:10px;">(연차미차감)</small>` 
                : `<span style="font-weight: 700; color: var(--primary);">${days}일</span>`;
            return `
                <tr data-id="${item.id}">
                    <td style="text-align: center;"><input type="checkbox" class="row-check" value="${item.id}"></td>
                    <td>
                        <select class="erp-select status-change-select" data-id="${item.id}" style="height: 24px; font-size: 11px; padding: 0 4px;">
                            <option value="임시작성" ${item.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                            <option value="결재요청" ${item.status === '결재요청' ? 'selected' : ''}>결재요청</option>
                            <option value="결재진행중" ${item.status === '결재진행중' ? 'selected' : ''}>결재진행중</option>
                            <option value="결재완료" ${item.status === '결재완료' ? 'selected' : ''}>결재완료</option>
                            <option value="결재보류" ${item.status === '결재보류' ? 'selected' : ''}>결재보류</option>
                        </select>
                    </td>
                    <td>${getTypeBadge(item.leaveType)}</td>
                    <td style="font-weight: 600;">${item.name || '-'}</td>
                    <td style="color: var(--text-muted);">${item.department || '-'} / ${item.rank || '-'}</td>
                    <td>${period}</td>
                    <td style="text-align: center;">${daysText}</td>
                    <td style="color: var(--text-muted);">${item.submitDate || (item.createdAt || '').split('T')[0] || '-'}</td>
                    <td title="${item.reason || ''}">${item.reason || '-'}</td>
                    <td style="text-align: center;">
                        <button type="button" class="btn-icon btn-pdf" data-id="${item.id}" title="정품 1:1 PDF 인쇄/다운로드" style="color: var(--success);"><i class='bx bx-printer'></i></button>
                        <button type="button" class="btn-icon btn-edit" data-id="${item.id}" title="수정"><i class='bx bx-edit-alt'></i></button>
                        <button type="button" class="btn-icon btn-delete" data-id="${item.id}" title="삭제" style="color: var(--danger);"><i class='bx bx-trash'></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ─────────────────────────────────────────────────────────
    // 4. 모달 열기 / 저장 / 상태 변경
    // ─────────────────────────────────────────────────────────
    function openModal(id = null) {
        currentEditId = id;
        const user = getCurrentUser();

        if (id) {
            // 수정 모드
            els.editTitle.innerHTML = `<i class='bx bx-edit'></i> 휴가원 수정`;
            const item = allLeaveRequests.find(i => i.id === id);
            if (!item) return;

            const daysVal = (item.daysCount !== undefined && item.daysCount !== null && item.daysCount !== '') ? Number(item.daysCount) : 1.0;
            els.fDepartment.value = item.department || '';
            els.fRank.value = item.rank || '';
            els.fName.value = item.name || '';
            els.fLeaveType.value = item.leaveType || '연차';
            els.fLeaveStart.value = item.leaveStart || '';
            els.fLeaveEnd.value = item.leaveEnd || '';
            els.fDaysCount.value = daysVal;
            if (daysVal === 0) {
                els.calcDaysDisplay.textContent = `0.0 일 (연차 미차감)`;
            } else {
                els.calcDaysDisplay.textContent = `${daysVal} 일`;
            }
            els.fSubmitDate.value = item.submitDate || '';
            els.fStatus.value = item.status || '결재요청';
            els.fReason.value = item.reason || '';
        } else {
            // 신규 작성 모드
            els.editTitle.innerHTML = `<i class='bx bx-plus-circle'></i> 새 휴가원 신청`;
            const today = new Date().toISOString().split('T')[0];

            els.fDepartment.value = (myAllowance && myAllowance.department) || '주식회사 케앤지';
            els.fRank.value = '차장';
            els.fName.value = user.name || (myAllowance && myAllowance.userName) || '';
            els.fLeaveType.value = '연차';
            els.fLeaveStart.value = today;
            els.fLeaveEnd.value = today;
            els.fSubmitDate.value = today;
            els.fStatus.value = '결재요청';
            els.fReason.value = '';
            updateCalculatedDays();
        }

        els.modal.classList.add('active');
    }

    function closeModal() {
        els.modal.classList.remove('active');
        currentEditId = null;
    }

    async function saveLeave() {
        const user = getCurrentUser();
        const rawDays = els.fDaysCount.value.trim();
        const daysVal = (rawDays !== '' && !isNaN(Number(rawDays))) ? Number(rawDays) : 1.0;

        const payload = {
            userEmail: user.email,
            department: els.fDepartment.value.trim(),
            rank: els.fRank.value.trim(),
            name: els.fName.value.trim(),
            leaveType: els.fLeaveType.value,
            leaveStart: els.fLeaveStart.value,
            leaveEnd: els.fLeaveEnd.value,
            daysCount: daysVal,
            submitDate: els.fSubmitDate.value,
            status: els.fStatus.value,
            reason: els.fReason.value.trim()
        };

        if (!payload.name) {
            showToast('성명을 입력해 주세요.', 'warning');
            els.fName.focus();
            return;
        }
        if (!payload.leaveStart || !payload.leaveEnd) {
            showToast('휴가 기간을 선택해 주세요.', 'warning');
            return;
        }

        const isEdit = !!currentEditId;
        const url = isEdit ? `${API_URL}/${currentEditId}` : API_URL;
        const method = isEdit ? 'PUT' : 'POST';

        try {
            const res = await authFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) throw new Error('저장 실패');

            showToast(isEdit ? '휴가원이 수정되었습니다.' : '휴가원이 신청(상신)되었습니다.', 'success');
            closeModal();
            loadLeaveRequests();
            loadMySummary();
        } catch (err) {
            console.error(err);
            showToast('저장 중 오류가 발생했습니다.', 'error');
        }
    }

    // 목록에서 결재 상태 셀렉트 박스 즉시 변경
    async function changeItemStatus(id, newStatus) {
        try {
            const res = await authFetch(`${API_URL}/${id}/status`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            if (!res.ok) throw new Error('상태 변경 실패');

            showToast(`결재 상태가 [${newStatus}]으로 변경되었습니다.`, 'success');
            loadLeaveRequests();
            loadMySummary();
        } catch (err) {
            console.error(err);
            showToast('상태 변경에 실패했습니다.', 'error');
            loadLeaveRequests();
        }
    }

    // ─────────────────────────────────────────────────────────
    // 5. 원본 1:1 정품 PDF 인쇄 및 미리보기
    // ─────────────────────────────────────────────────────────
    async function openSavedLeavePdf(id) {
        if (!id) return;
        const newWin = window.open('about:blank', '_blank');
        if (newWin) {
            newWin.document.write('<div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#333;"><p style="font-size:18px;font-weight:600;">휴가원 1:1 정품 PDF 생성 중...</p><p style="color:#666;">잠시만 기다려주세요.</p></div>');
        }

        try {
            showToast('정품 PDF 생성 중...', 'info');
            const res = await authFetch(`${API_URL}/${id}/pdf`);
            if (!res.ok) throw new Error('PDF 생성 실패');
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            if (newWin) newWin.location.href = blobUrl;
            else window.open(blobUrl, '_blank');
        } catch (err) {
            console.error(err);
            if (newWin) newWin.close();
            showToast('PDF 생성 중 오류가 발생했습니다.', 'error');
        }
    }

    async function printLeave() {
        if (currentEditId) {
            return openSavedLeavePdf(currentEditId);
        } else {
            // 저장 전 미리보기
            const rawDays = els.fDaysCount.value.trim();
            const daysVal = (rawDays !== '' && !isNaN(Number(rawDays))) ? Number(rawDays) : 1.0;
            const payload = {
                department: els.fDepartment.value.trim(),
                rank: els.fRank.value.trim(),
                name: els.fName.value.trim(),
                leaveStart: els.fLeaveStart.value,
                leaveEnd: els.fLeaveEnd.value,
                leaveType: els.fLeaveType.value,
                daysCount: daysVal,
                submitDate: els.fSubmitDate.value,
                reason: els.fReason.value.trim()
            };
            if (!payload.name) {
                showToast('성명을 입력해 주세요.', 'warning');
                return;
            }

            const newWin = window.open('about:blank', '_blank');
            if (newWin) {
                newWin.document.write('<div style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;color:#333;"><p style="font-size:18px;font-weight:600;">휴가원 1:1 정품 PDF 생성 중...</p><p style="color:#666;">잠시만 기다려주세요.</p></div>');
            }

            try {
                showToast('정품 PDF 생성 중...', 'info');
                const res = await authFetch(`${API_URL}/preview-pdf`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error('PDF 생성 실패');
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);
                if (newWin) newWin.location.href = blobUrl;
                else window.open(blobUrl, '_blank');
            } catch (err) {
                console.error(err);
                if (newWin) newWin.close();
                showToast('PDF 생성 중 오류가 발생했습니다.', 'error');
            }
        }
    }

    // ─────────────────────────────────────────────────────────
    // 6. 삭제 로직
    // ─────────────────────────────────────────────────────────
    function deleteItem(id) {
        Swal.fire({
            title: '삭제하시겠습니까?',
            text: '승인된 휴가원일 경우 연동된 캘린더 일정도 함께 삭제됩니다.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        }).then(async (result) => {
            if (result.isConfirmed) {
                try {
                    const res = await authFetch(`${API_URL}/${id}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('삭제 실패');
                    showToast('삭제되었습니다.', 'success');
                    loadLeaveRequests();
                    loadMySummary();
                } catch (e) {
                    showToast('삭제 실패', 'error');
                }
            }
        });
    }

    function deleteSelected() {
        const checked = document.querySelectorAll('.row-check:checked');
        if (checked.length === 0) {
            showToast('삭제할 항목을 선택해주세요.', 'warning');
            return;
        }

        Swal.fire({
            title: `${checked.length}개 항목을 삭제하시겠습니까?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        }).then(async (result) => {
            if (result.isConfirmed) {
                let deletedCount = 0;
                for (const cb of checked) {
                    try {
                        const res = await authFetch(`${API_URL}/${cb.value}`, { method: 'DELETE' });
                        if (res.ok) deletedCount++;
                    } catch (e) {}
                }
                showToast(`${deletedCount}개 항목이 삭제되었습니다.`, 'success');
                els.selectAll.checked = false;
                loadLeaveRequests();
                loadMySummary();
            }
        });
    }

    // ─────────────────────────────────────────────────────────
    // 7. 직원별 연차 기준 설정 팝업 로직
    // ─────────────────────────────────────────────────────────
    async function loadAllowances() {
        try {
            const res = await authFetch(`${API_URL}/allowances`);
            if (!res.ok) throw new Error('연차 대장 로드 실패');
            const list = await res.json();

            if (list.length === 0) {
                els.allowanceTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">등록된 직원 연차가 없습니다.</td></tr>`;
                return;
            }

            els.allowanceTableBody.innerHTML = list.map(item => `
                <tr data-email="${item.userEmail}">
                    <td>${item.userEmail}</td>
                    <td><input type="text" class="erp-input edit-name" value="${item.userName || ''}" style="width: 100%;"></td>
                    <td><input type="text" class="erp-input edit-dept" value="${item.department || ''}" style="width: 100%;"></td>
                    <td><input type="number" step="0.5" class="erp-input edit-days" value="${item.totalDays || 15.0}" style="width: 100%; text-align: center;"></td>
                    <td style="text-align: center;">
                        <button type="button" class="btn btn-outline btn-save-allow" data-email="${item.userEmail}" style="height: 24px; padding: 0 6px; font-size: 11px;">저장</button>
                    </td>
                </tr>
            `).join('');
        } catch (err) {
            console.error(err);
        }
    }

    async function saveSingleAllowance(userEmail, row) {
        const userName = row.querySelector('.edit-name').value.trim();
        const department = row.querySelector('.edit-dept').value.trim();
        const totalDays = Number(row.querySelector('.edit-days').value) || 15.0;

        try {
            const res = await authFetch(`${API_URL}/allowances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userEmail, userName, department, totalDays, year: 2026 })
            });
            if (!res.ok) throw new Error('저장 실패');
            showToast(`${userName || userEmail} 연차 설정이 저장되었습니다.`, 'success');
            loadMySummary();
        } catch (e) {
            showToast('저장 실패', 'error');
        }
    }

    async function addNewAllowance() {
        const userEmail = els.newAllowEmail.value.trim();
        const userName = els.newAllowName.value.trim();
        const department = els.newAllowDept.value.trim();
        const totalDays = Number(els.newAllowDays.value) || 15.0;

        if (!userEmail) {
            showToast('계정 이메일을 입력해 주세요.', 'warning');
            return;
        }

        try {
            const res = await authFetch(`${API_URL}/allowances`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userEmail, userName, department, totalDays, year: 2026 })
            });
            if (!res.ok) throw new Error('등록 실패');

            showToast('직원 연차가 등록되었습니다.', 'success');
            els.newAllowEmail.value = '';
            els.newAllowName.value = '';
            loadAllowances();
            loadMySummary();
        } catch (e) {
            showToast('등록 실패', 'error');
        }
    }

    // ─────────────────────────────────────────────────────────
    // 8. 엑셀 내보내기 (CSV)
    // ─────────────────────────────────────────────────────────
    function exportToExcel() {
        if (allLeaveRequests.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }

        let csv = '\uFEFF결재상태,구분,신청자,소속,직급,시작일,종료일,사용일수,신청일자,사유\n';
        allLeaveRequests.forEach(i => {
            const days = (i.daysCount !== undefined && i.daysCount !== null && i.daysCount !== '') ? Number(i.daysCount) : 1.0;
            const row = [
                i.status || '',
                i.leaveType || '',
                i.name || '',
                i.department || '',
                i.rank || '',
                i.leaveStart || '',
                i.leaveEnd || '',
                days,
                i.submitDate || '',
                `"${(i.reason || '').replace(/"/g, '""')}"`
            ];
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `휴가원_관리대장_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }

    // ─────────────────────────────────────────────────────────
    // 이벤트 바인딩
    // ─────────────────────────────────────────────────────────
    els.btnNewLeave.addEventListener('click', () => openModal());
    els.btnCloseEdit.addEventListener('click', closeModal);
    els.btnSaveLeave.addEventListener('click', saveLeave);
    els.btnPrintLeave.addEventListener('click', printLeave);
    els.btnDeleteSelected.addEventListener('click', deleteSelected);
    els.btnExportExcel.addEventListener('click', exportToExcel);

    // 날짜 및 구분 변경 시 실시간 일수 자동 계산
    els.fLeaveStart.addEventListener('change', updateCalculatedDays);
    els.fLeaveEnd.addEventListener('change', updateCalculatedDays);
    els.fLeaveType.addEventListener('change', updateCalculatedDays);

    // 사용자가 직접 일수를 0 또는 원하는 숫자로 입력할 때 실시간 반영
    els.fDaysCount.addEventListener('input', () => {
        const val = els.fDaysCount.value.trim();
        const num = (val !== '' && !isNaN(Number(val))) ? Number(val) : 0;
        if (num === 0) {
            els.calcDaysDisplay.textContent = `0.0 일 (연차 미차감)`;
        } else {
            els.calcDaysDisplay.textContent = `${num} 일`;
        }
    });

    // 필터 이벤트
    els.filterStatus.addEventListener('change', renderTable);
    els.filterType.addEventListener('change', renderTable);
    els.filterKeyword.addEventListener('input', renderTable);
    els.btnResetFilter.addEventListener('click', () => {
        els.filterStatus.value = '';
        els.filterType.value = '';
        els.filterKeyword.value = '';
        renderTable();
    });

    // 전체 선택 체크박스
    els.selectAll.addEventListener('change', function() {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = this.checked);
    });

    // 테이블 행 클릭 (상태 변경, PDF 인쇄, 수정, 삭제)
    els.leaveListBody.addEventListener('click', (e) => {
        const btnPdf = e.target.closest('.btn-pdf');
        const btnEdit = e.target.closest('.btn-edit');
        const btnDelete = e.target.closest('.btn-delete');

        if (btnPdf) {
            openSavedLeavePdf(btnPdf.dataset.id);
        } else if (btnEdit) {
            openModal(btnEdit.dataset.id);
        } else if (btnDelete) {
            deleteItem(btnDelete.dataset.id);
        }
    });

    els.leaveListBody.addEventListener('change', (e) => {
        const statusSelect = e.target.closest('.status-change-select');
        if (statusSelect) {
            changeItemStatus(statusSelect.dataset.id, statusSelect.value);
        }
    });

    // 연차 설정 모달 이벤트
    els.btnOpenAllowanceModal.addEventListener('click', () => {
        loadAllowances();
        els.allowanceModal.classList.add('active');
    });
    els.btnCloseAllowance.addEventListener('click', () => els.allowanceModal.classList.remove('active'));
    els.btnDoneAllowance.addEventListener('click', () => els.allowanceModal.classList.remove('active'));
    els.btnAddAllowance.addEventListener('click', addNewAllowance);

    els.allowanceTableBody.addEventListener('click', (e) => {
        const btnSave = e.target.closest('.btn-save-allow');
        if (btnSave) {
            const email = btnSave.dataset.email;
            const row = btnSave.closest('tr');
            saveSingleAllowance(email, row);
        }
    });

    // ─────────────────────────────────────────────────────────
    // 초기 로딩
    // ─────────────────────────────────────────────────────────
    loadMySummary();
    loadLeaveRequests();
});
