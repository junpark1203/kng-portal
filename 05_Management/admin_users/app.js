// ─────────────────────────────────────────────────────────────
// K&G PORTAL - 계정 및 권한 관리 (Admin Users Controller)
// ─────────────────────────────────────────────────────────────

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isLocal ? 'http://localhost:3000/api/admin' : 'https://kng.junparks.com/api/admin';

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
    } catch (e) {}

    if (!options.headers) options.headers = {};
    if (token && !options.headers['Authorization']) {
        options.headers['Authorization'] = 'Bearer ' + token;
    }
    if (options.body && typeof options.body === 'string' && !options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
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

const ALL_MENU_KEYS = [
    'dashboard', 'seller_k', 'shopee', 'logistics', 'hq',
    'trade', 'sales', 'management', 'forms', 'closing', 'temp'
];

const MENU_LABELS = {
    dashboard: '대시보드',
    seller_k: '셀러K',
    shopee: 'Shopee',
    logistics: '영업관리',
    hq: '본사매입',
    trade: '해외영업/무역',
    sales: '(구)영업관리',
    management: '관리업무',
    forms: '양식관리',
    closing: '정산/거래처',
    temp: '임시폴더'
};

document.addEventListener('DOMContentLoaded', () => {
    let allUsers = [];

    const els = {
        userTableBody: document.getElementById('userTableBody'),
        btnRefresh: document.getElementById('btnRefresh'),
        btnNewUser: document.getElementById('btnNewUser'),
        btnExportExcel: document.getElementById('btnExportExcel'),

        // Filters
        filterRole: document.getElementById('filterRole'),
        filterStatus: document.getElementById('filterStatus'),
        searchKeyword: document.getElementById('searchKeyword'),
        btnResetFilter: document.getElementById('btnResetFilter'),

        // KPIs
        kpiTotalUsers: document.getElementById('kpiTotalUsers'),
        kpiAdminCount: document.getElementById('kpiAdminCount'),
        kpiUserCount: document.getElementById('kpiUserCount'),
        kpiTotalLeaveDays: document.getElementById('kpiTotalLeaveDays'),

        // Modal
        modal: document.getElementById('userEditModal'),
        modalTitle: document.getElementById('modalTitle'),
        btnCloseModal: document.getElementById('btnCloseModal'),
        btnCancelModal: document.getElementById('btnCancelModal'),
        btnSaveUser: document.getElementById('btnSaveUser'),
        formMode: document.getElementById('formMode'),

        // Form Fields
        fEmail: document.getElementById('fEmail'),
        fName: document.getElementById('fName'),
        fDepartment: document.getElementById('fDepartment'),
        fRank: document.getElementById('fRank'),
        fRole: document.getElementById('fRole'),
        fStatus: document.getElementById('fStatus'),
        fLeaveDays: document.getElementById('fLeaveDays'),
        fHireDate: document.getElementById('fHireDate'),
        fMemo: document.getElementById('fMemo'),
        chkAllPerms: document.getElementById('chkAllPerms'),
        permGrid: document.getElementById('permGrid')
    };

    // ─────────────────────────────────────────────────────────
    // 1. 데이터 로드 및 렌더링
    // ─────────────────────────────────────────────────────────
    async function loadUsers() {
        try {
            els.userTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 25px; color: var(--text-muted);"><i class='bx bx-loader-alt bx-spin'></i> 계정 목록 로딩 중...</td></tr>`;
            const res = await authFetch(`${API_URL}/users`);
            if (!res.ok) throw new Error('계정 목록을 불러오지 못했습니다.');
            allUsers = await res.json();
            renderTable();
            renderKpis();
        } catch (err) {
            console.error(err);
            els.userTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--danger); padding: 30px;">계정 목록을 불러오지 못했습니다: ${err.message}</td></tr>`;
        }
    }

    function renderKpis() {
        const total = allUsers.length;
        const admins = allUsers.filter(u => u.role === 'admin').length;
        const users = allUsers.filter(u => u.role !== 'admin' && u.status === 'active').length;
        const totalLeave = allUsers.reduce((sum, u) => sum + (Number(u.leaveDays) || 0), 0);

        els.kpiTotalUsers.innerHTML = `${total} <small>명</small>`;
        els.kpiAdminCount.innerHTML = `${admins} <small>명</small>`;
        els.kpiUserCount.innerHTML = `${users} <small>명</small>`;
        els.kpiTotalLeaveDays.innerHTML = `${totalLeave.toFixed(1)} <small>일</small>`;
    }

    function renderTable() {
        const role = els.filterRole.value;
        const status = els.filterStatus.value;
        const keyword = els.searchKeyword.value.trim().toLowerCase();

        const filtered = allUsers.filter(u => {
            if (role && u.role !== role) return false;
            if (status && u.status !== status) return false;
            if (keyword) {
                const target = `${u.email} ${u.name} ${u.department} ${u.rank}`.toLowerCase();
                if (!target.includes(keyword)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            els.userTableBody.innerHTML = `<tr><td colspan="10" class="empty-state"><i class='bx bx-user-x'></i>일치하는 사용자 계정이 없습니다.</td></tr>`;
            return;
        }

        const getStatusBadge = (s) => s === 'active' 
            ? '<span class="badge badge-active"><i class="bx bx-check"></i> 정상</span>'
            : '<span class="badge badge-inactive"><i class="bx bx-block"></i> 중지</span>';

        const getRoleBadge = (r) => {
            if (r === 'admin') return '<span class="badge badge-admin"><i class="bx bx-shield-quarter"></i> 슈퍼관리자</span>';
            if (r === 'manager') return '<span class="badge badge-manager"><i class="bx bx-user-check"></i> 매니저</span>';
            return '<span class="badge badge-user"><i class="bx bx-user"></i> 일반사원</span>';
        };

        const renderPermPills = (perms) => {
            if (!perms || perms.includes('all')) {
                return '<span class="perm-pill all"><i class="bx bx-check-double"></i> 전체 권한 (All)</span>';
            }
            if (perms.length === 0) {
                return '<span class="perm-pill" style="color:var(--danger);">접근 권한 없음</span>';
            }
            return perms.map(p => `<span class="perm-pill">${MENU_LABELS[p] || p}</span>`).join('');
        };

        els.userTableBody.innerHTML = filtered.map(u => {
            const leave = Number(u.leaveDays || 0).toFixed(1);
            return `
                <tr data-email="${u.email}">
                    <td style="text-align: center;">${getStatusBadge(u.status)}</td>
                    <td style="font-family: monospace; font-size: 11.5px; font-weight: 500;">${u.email}</td>
                    <td style="font-weight: 700; color: #0f172a;">${u.name || '-'}</td>
                    <td>${u.department || '주식회사 케앤지'}</td>
                    <td>${u.rank || '사원'}</td>
                    <td style="text-align: center;">${getRoleBadge(u.role)}</td>
                    <td style="text-align: center; font-weight: 700; color: var(--primary);">${leave}일</td>
                    <td>${renderPermPills(u.menuPermissions)}</td>
                    <td style="text-align: center; color: var(--text-muted);">${u.hireDate || '-'}</td>
                    <td style="text-align: center;">
                        <button type="button" class="btn-icon btn-edit" data-email="${u.email}" title="계정 및 권한 수정"><i class='bx bx-edit'></i></button>
                        ${u.email !== 'jpark120325@gmail.com' ? `<button type="button" class="btn-icon btn-delete" data-email="${u.email}" title="계정 삭제" style="color: var(--danger);"><i class='bx bx-trash'></i></button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    // ─────────────────────────────────────────────────────────
    // 2. 모달 열기 및 저장/삭제
    // ─────────────────────────────────────────────────────────
    function openModal(mode = 'create', email = null) {
        els.formMode.value = mode;

        // 체크박스 초기화
        const checkBoxes = els.permGrid.querySelectorAll('.menu-perm-chk');
        checkBoxes.forEach(cb => cb.checked = false);
        els.chkAllPerms.checked = false;

        if (mode === 'edit' && email) {
            const user = allUsers.find(u => u.email === email);
            if (!user) return;

            els.modalTitle.innerHTML = `<i class='bx bx-edit'></i> 사용자 정보 및 권한 수정 (${user.name})`;
            els.fEmail.value = user.email;
            els.fEmail.readOnly = true;
            els.fEmail.style.backgroundColor = '#f1f5f9';

            els.fName.value = user.name || '';
            els.fDepartment.value = user.department || '주식회사 케앤지';
            els.fRank.value = user.rank || '사원';
            els.fRole.value = user.role || 'user';
            els.fStatus.value = user.status || 'active';
            els.fLeaveDays.value = Number(user.leaveDays || 15.0);
            els.fHireDate.value = user.hireDate || '';
            els.fMemo.value = user.memo || '';

            const perms = user.menuPermissions || ['all'];
            if (perms.includes('all')) {
                els.chkAllPerms.checked = true;
                checkBoxes.forEach(cb => cb.checked = true);
            } else {
                perms.forEach(p => {
                    const chk = els.permGrid.querySelector(`.menu-perm-chk[value="${p}"]`);
                    if (chk) chk.checked = true;
                });
            }
        } else {
            // 신규 등록
            els.modalTitle.innerHTML = `<i class='bx bx-user-plus'></i> 새 사용자 계정 등록`;
            els.fEmail.value = '';
            els.fEmail.readOnly = false;
            els.fEmail.style.backgroundColor = '#ffffff';

            els.fName.value = '';
            els.fDepartment.value = '주식회사 케앤지';
            els.fRank.value = '사원';
            els.fRole.value = 'user';
            els.fStatus.value = 'active';
            els.fLeaveDays.value = '15.0';
            els.fHireDate.value = new Date().toISOString().split('T')[0];
            els.fMemo.value = '';

            // 기본값: 전체 권한
            els.chkAllPerms.checked = true;
            checkBoxes.forEach(cb => cb.checked = true);
        }

        els.modal.classList.add('active');
    }

    function closeModal() {
        els.modal.classList.remove('active');
    }

    // 전체 권한 토글
    els.chkAllPerms.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        const checkBoxes = els.permGrid.querySelectorAll('.menu-perm-chk');
        checkBoxes.forEach(cb => cb.checked = isChecked);
    });

    els.permGrid.addEventListener('change', () => {
        const checkBoxes = Array.from(els.permGrid.querySelectorAll('.menu-perm-chk'));
        const allChecked = checkBoxes.every(cb => cb.checked);
        els.chkAllPerms.checked = allChecked;
    });

    // 저장 핸들러
    async function handleSave() {
        const mode = els.formMode.value;
        const email = els.fEmail.value.trim().toLowerCase();
        const name = els.fName.value.trim();

        if (!email || !name) {
            Swal.fire('입력 오류', '이메일(계정 ID)과 사원명은 필수 항목입니다.', 'warning');
            return;
        }

        let perms = [];
        if (els.chkAllPerms.checked) {
            perms = ['all'];
        } else {
            const checkBoxes = Array.from(els.permGrid.querySelectorAll('.menu-perm-chk:checked'));
            perms = checkBoxes.map(cb => cb.value);
            if (perms.length === 0) perms = ['dashboard']; // 최소 대시보드는 허용
        }

        const payload = {
            email,
            name,
            department: els.fDepartment.value.trim(),
            rank: els.fRank.value.trim(),
            role: els.fRole.value,
            status: els.fStatus.value,
            leaveDays: parseFloat(els.fLeaveDays.value) || 15.0,
            hireDate: els.fHireDate.value,
            memo: els.fMemo.value.trim(),
            menuPermissions: perms
        };

        try {
            els.btnSaveUser.disabled = true;
            els.btnSaveUser.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> 저장 중...`;

            const url = mode === 'create' ? `${API_URL}/users` : `${API_URL}/users/${encodeURIComponent(email)}`;
            const method = mode === 'create' ? 'POST' : 'PUT';

            const res = await authFetch(url, {
                method,
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');

            showToast(data.message || '저장되었습니다.', 'success');
            closeModal();
            loadUsers();
        } catch (err) {
            Swal.fire('저장 실패', err.message, 'error');
        } finally {
            els.btnSaveUser.disabled = false;
            els.btnSaveUser.innerHTML = `<i class='bx bx-check'></i> 저장하기`;
        }
    }

    // 삭제 핸들러
    async function handleDelete(email) {
        const user = allUsers.find(u => u.email === email);
        const userName = user ? user.name : email;

        const confirm = await Swal.fire({
            title: '사용자 삭제',
            html: `정말로 <b>[${userName} (${email})]</b> 계정을 삭제하시겠습니까?<br><small style="color:var(--danger);">연차 대장 및 시스템 접근 권한이 함께 제거됩니다.</small>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        });

        if (!confirm.isConfirmed) return;

        try {
            const res = await authFetch(`${API_URL}/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '삭제 실패');

            showToast('사용자가 삭제되었습니다.', 'success');
            loadUsers();
        } catch (err) {
            Swal.fire('삭제 실패', err.message, 'error');
        }
    }

    // ─────────────────────────────────────────────────────────
    // 3. 이벤트 리스너 바인딩
    // ─────────────────────────────────────────────────────────
    els.btnRefresh.addEventListener('click', loadUsers);
    els.btnNewUser.addEventListener('click', () => openModal('create'));
    els.btnCloseModal.addEventListener('click', closeModal);
    els.btnCancelModal.addEventListener('click', closeModal);
    els.btnSaveUser.addEventListener('click', handleSave);

    els.filterRole.addEventListener('change', renderTable);
    els.filterStatus.addEventListener('change', renderTable);
    els.searchKeyword.addEventListener('input', renderTable);
    els.btnResetFilter.addEventListener('click', () => {
        els.filterRole.value = '';
        els.filterStatus.value = '';
        els.searchKeyword.value = '';
        renderTable();
    });

    els.userTableBody.addEventListener('click', (e) => {
        const btnEdit = e.target.closest('.btn-edit');
        if (btnEdit) {
            const email = btnEdit.getAttribute('data-email');
            openModal('edit', email);
            return;
        }

        const btnDel = e.target.closest('.btn-delete');
        if (btnDel) {
            const email = btnDel.getAttribute('data-email');
            handleDelete(email);
            return;
        }
    });

    // 엑셀 내보내기 (CSV)
    els.btnExportExcel.addEventListener('click', () => {
        if (allUsers.length === 0) {
            showToast('내보낼 데이터가 없습니다.', 'warning');
            return;
        }
        let csv = '\uFEFF상태,이메일,사원명,소속부서,직급,시스템권한,기준연차(일),입사일자,메모\n';
        allUsers.forEach(u => {
            const p = (u.menuPermissions || ['all']).join('|');
            csv += `"${u.status === 'active' ? '정상' : '중지'}","${u.email}","${u.name || ''}","${u.department || ''}","${u.rank || ''}","${u.role}","${u.leaveDays || 15}","${u.hireDate || ''}","${(u.memo || '').replace(/"/g, '""')}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `KNG_사원계정및권한목록_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // 초기 로드
    loadUsers();
});
