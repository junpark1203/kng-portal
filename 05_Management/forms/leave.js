const API_URL = 'https://kng.junparks.com/api/leave-request';

async function authFetch(url, options = {}) {
    let token = null;
    try {
        if (window.parent && window.parent.getAuthToken) {
            token = await window.parent.getAuthToken();
            let retries = 0;
            while (!token && retries < 10) { 
                await new Promise(r => setTimeout(r, 500)); 
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

document.addEventListener('DOMContentLoaded', () => {
    let leaveRequests = [];
    let currentEditId = null;

    const els = {
        listView: document.getElementById('listView'),
        leaveListBody: document.getElementById('leaveListBody'),
        btnNewLeave: document.getElementById('btnNewLeave'),
        btnDeleteSelected: document.getElementById('btnDeleteSelected'),
        selectAll: document.getElementById('selectAll'),
        
        modal: document.getElementById('leaveEditModal'),
        btnSave: document.getElementById('btnSaveLeave'),
        btnPrint: document.getElementById('btnPrintLeave'),
        btnClose: document.getElementById('btnCloseEdit'),
        form: document.getElementById('leaveForm'),
        
        // Form inputs
        fDepartment: document.getElementById('fDepartment'),
        fRank: document.getElementById('fRank'),
        fName: document.getElementById('fName'),
        fLeaveStart: document.getElementById('fLeaveStart'),
        fLeaveEnd: document.getElementById('fLeaveEnd'),
        fLeaveType: document.getElementById('fLeaveType'),
        fSubmitDate: document.getElementById('fSubmitDate'),
        fReason: document.getElementById('fReason'),
        
        // Print preview fields
        pRank: document.getElementById('pRank'),
        pName: document.getElementById('pName'),
        pPeriod: document.getElementById('pPeriod'),
        pReason: document.getElementById('pReason'),
        pDate: document.getElementById('pDate'),
        pSignName: document.getElementById('pSignName'),
        
        printPreviewClone: document.getElementById('printPreviewClone'),
        printArea: document.getElementById('printArea')
    };

    // 데이터 로드
    function loadLeaveRequests() {
        els.leaveListBody.innerHTML = '<tr class="loading-row"><td colspan="8"><div class="skeleton"></div></td></tr>';
        authFetch(API_URL)
            .then(res => res.json())
            .then(data => {
                leaveRequests = data;
                renderList();
            })
            .catch(err => {
                console.error(err);
                els.leaveListBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">데이터를 불러오는 중 오류가 발생했습니다.</td></tr>`;
            });
    }

    function renderList() {
        if (leaveRequests.length === 0) {
            els.leaveListBody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding: 30px; color: #64748b;">등록된 휴가원이 없습니다.</td></tr>`;
            return;
        }

        els.leaveListBody.innerHTML = leaveRequests.map(item => `
            <tr>
                <td class="col-check"><input type="checkbox" class="row-check" value="${item.id}"></td>
                <td>${item.submitDate || '-'}</td>
                <td>${item.department || '-'}</td>
                <td>${item.rank || '-'}</td>
                <td><strong>${item.name || '-'}</strong></td>
                <td>${item.leaveStart} ~ ${item.leaveEnd}</td>
                <td><span class="badge ${item.leaveType.includes('반차') ? 'badge-warning' : 'badge-primary'}">${item.leaveType || '-'}</span></td>
                <td class="col-action">
                    <button class="btn-icon btn-edit" data-id="${item.id}" title="수정/인쇄"><i class='bx bx-edit-alt'></i></button>
                    <button class="btn-icon btn-delete text-danger" data-id="${item.id}" title="삭제"><i class='bx bx-trash'></i></button>
                </td>
            </tr>
        `).join('');
    }

    // 미리보기 업데이트 함수
    function updatePreview() {
        const startDate = els.fLeaveStart.value;
        const endDate = els.fLeaveEnd.value;
        let periodStr = '';
        
        if (startDate && endDate) {
            // YYYY. MM. DD.(요일) 형식 변환 로직 (간단히)
            const formatKorDate = (dStr) => {
                const d = new Date(dStr);
                const days = ['일', '월', '화', '수', '목', '금', '토'];
                return `${d.getFullYear()}. ${String(d.getMonth()+1).padStart(2,'0')}. ${String(d.getDate()).padStart(2,'0')}.(${days[d.getDay()]})`;
            };
            periodStr = `${formatKorDate(startDate)} ~ ${formatKorDate(endDate)}`;
        }
        
        if (els.fLeaveType.value) {
            periodStr += `, (${els.fLeaveType.value})`;
        }

        let submitDateStr = 'YYYY. MM. DD.';
        if (els.fSubmitDate.value) {
            const sd = new Date(els.fSubmitDate.value);
            submitDateStr = `${sd.getFullYear()}. ${String(sd.getMonth()+1).padStart(2,'0')}. ${String(sd.getDate()).padStart(2,'0')}.`;
        }

        // 값 할당
        els.pRank.textContent = els.fRank.value;
        els.pName.textContent = els.fName.value;
        els.pPeriod.textContent = periodStr;
        els.pReason.textContent = els.fReason.value;
        els.pDate.textContent = submitDateStr;
        
        // 서명란 이름은 띄어쓰기 적용 (예: 박 준 영)
        els.pSignName.textContent = els.fName.value.split('').join(' ');

        // 클론 업데이트 (화면 미리보기용)
        els.printPreviewClone.innerHTML = els.printArea.innerHTML;
    }

    // 입력 필드 변경 시 실시간 미리보기 업데이트
    const inputs = [els.fDepartment, els.fRank, els.fName, els.fLeaveStart, els.fLeaveEnd, els.fLeaveType, els.fSubmitDate, els.fReason];
    inputs.forEach(input => {
        input.addEventListener('input', updatePreview);
        input.addEventListener('change', updatePreview);
    });

    // 모달 열기
    function openModal(id = null) {
        currentEditId = id;
        els.form.reset();
        els.fDepartment.value = '주식회사 케앤지';
        
        if (id) {
            const item = leaveRequests.find(x => x.id === id);
            if (item) {
                els.fDepartment.value = item.department || '';
                els.fRank.value = item.rank || '';
                els.fName.value = item.name || '';
                els.fLeaveStart.value = item.leaveStart || '';
                els.fLeaveEnd.value = item.leaveEnd || '';
                els.fLeaveType.value = item.leaveType || '';
                els.fSubmitDate.value = item.submitDate || '';
                els.fReason.value = item.reason || '';
            }
        } else {
            // 새 작성 시 오늘 날짜 기본 세팅
            const today = new Date().toISOString().split('T')[0];
            els.fSubmitDate.value = today;
        }
        
        updatePreview();
        els.modal.classList.add('active');
    }

    // 모달 닫기
    function closeModal() {
        els.modal.classList.remove('active');
        currentEditId = null;
    }

    // 저장
    function saveLeave() {
        const payload = {
            department: els.fDepartment.value.trim(),
            rank: els.fRank.value.trim(),
            name: els.fName.value.trim(),
            leaveStart: els.fLeaveStart.value,
            leaveEnd: els.fLeaveEnd.value,
            leaveType: els.fLeaveType.value.trim(),
            submitDate: els.fSubmitDate.value,
            reason: els.fReason.value.trim()
        };

        if (!payload.name || !payload.leaveStart || !payload.leaveEnd) {
            showToast('성명과 휴가 기간을 입력해주세요.', 'error');
            return;
        }

        const method = currentEditId ? 'PUT' : 'POST';
        const url = currentEditId ? `${API_URL}/${currentEditId}` : API_URL;

        authFetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })
        .then(res => {
            if (!res.ok) throw new Error('저장 실패');
            return res.json();
        })
        .then(() => {
            showToast('휴가원이 저장되었습니다.', 'success');
            loadLeaveRequests();
        })
        .catch(err => {
            console.error(err);
            showToast('저장 중 오류가 발생했습니다.', 'error');
        });
    }

    // 인쇄
    function printLeave() {
        updatePreview(); // 혹시 모를 누락 방지
        setTimeout(() => {
            window.print();
        }, 100);
    }

    // 단일 삭제
    function deleteItem(id) {
        Swal.fire({
            title: '삭제하시겠습니까?',
            text: '삭제된 휴가원은 복구할 수 없습니다.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소'
        }).then((result) => {
            if (result.isConfirmed) {
                authFetch(`${API_URL}/${id}`, { method: 'DELETE' })
                    .then(res => res.json())
                    .then(() => {
                        showToast('삭제되었습니다.', 'success');
                        loadLeaveRequests();
                    })
                    .catch(() => showToast('삭제 실패', 'error'));
            }
        });
    }

    // 선택 삭제
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
        }).then((result) => {
            if (result.isConfirmed) {
                let deletedCount = 0;
                let errorCount = 0;
                
                const deletePromises = Array.from(checked).map(cb => {
                    return authFetch(`${API_URL}/${cb.value}`, { method: 'DELETE' })
                        .then(res => { if(res.ok) deletedCount++; else errorCount++; })
                        .catch(() => errorCount++);
                });

                Promise.all(deletePromises).then(() => {
                    if (errorCount > 0) showToast(`${deletedCount}개 삭제 완료, ${errorCount}개 실패`, 'warning');
                    else showToast(`${deletedCount}개 항목이 삭제되었습니다.`, 'success');
                    els.selectAll.checked = false;
                    loadLeaveRequests();
                });
            }
        });
    }

    // 이벤트 리스너 등록
    els.btnNewLeave.addEventListener('click', () => openModal());
    els.btnClose.addEventListener('click', closeModal);
    els.btnSave.addEventListener('click', saveLeave);
    els.btnPrint.addEventListener('click', printLeave);
    els.btnDeleteSelected.addEventListener('click', deleteSelected);

    els.leaveListBody.addEventListener('click', (e) => {
        const btnEdit = e.target.closest('.btn-edit');
        const btnDelete = e.target.closest('.btn-delete');
        
        if (btnEdit) {
            openModal(btnEdit.dataset.id);
        } else if (btnDelete) {
            deleteItem(btnDelete.dataset.id);
        }
    });

    els.selectAll.addEventListener('change', function() {
        document.querySelectorAll('.row-check').forEach(cb => cb.checked = this.checked);
    });

    // 초기화
    loadLeaveRequests();
});
