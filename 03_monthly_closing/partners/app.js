const API_BASE = 'https://kng.junparks.com/api/logistics';

const app = {
    data: [],
    modal: null,

    init() {
        this.modal = new bootstrap.Modal(document.getElementById('partnerModal'));
        this.loadData();
    },

    async loadData() {
        try {
            const res = await window.authFetch(`${API_BASE}/partners`);
            if (!res.ok) throw new Error('API Error');
            this.data = await res.json();
            this.renderTable();
        } catch (error) {
            console.error('Failed to load partners:', error);
            Swal.fire('오류', '데이터를 불러오는 중 오류가 발생했습니다.', 'error');
        }
    },

    renderTable() {
        const tbody = document.getElementById('partnersTableBody');
        const filterType = document.getElementById('typeFilter').value;
        const searchWord = document.getElementById('searchInput').value.toLowerCase().trim();

        let filtered = this.data;

        if (filterType !== 'ALL') {
            filtered = filtered.filter(p => p.type === filterType);
        }

        if (searchWord) {
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(searchWord) || 
                (p.note && p.note.toLowerCase().includes(searchWord)) ||
                (p.contact && p.contact.toLowerCase().includes(searchWord))
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">등록된 거래처가 없거나 검색 결과가 없습니다.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map((p, index) => `
            <tr>
                <td class="text-center">${index + 1}</td>
                <td>
                    <span class="badge ${p.type === '매입처' ? 'bg-danger' : (p.type === '매출처' ? 'bg-primary' : 'bg-secondary')} bg-opacity-75">
                        ${p.type}
                    </span>
                </td>
                <td class="fw-bold">${p.name}</td>
                <td>${p.contact || '-'}</td>
                <td class="text-muted small">${p.note || ''}</td>
                <td class="text-center">
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="app.openEditModal(${p.id})">수정</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="app.deletePartner(${p.id})">삭제</button>
                </td>
            </tr>
        `).join('');
    },

    openAddModal() {
        document.getElementById('partnerForm').reset();
        document.getElementById('partnerId').value = '';
        document.getElementById('modalTitle').innerText = '새 거래처 등록';
        this.modal.show();
    },

    openEditModal(id) {
        const partner = this.data.find(p => p.id === id);
        if (!partner) return;

        document.getElementById('partnerId').value = partner.id;
        document.getElementById('partnerName').value = partner.name;
        document.getElementById('partnerType').value = partner.type;
        document.getElementById('partnerContact').value = partner.contact || '';
        document.getElementById('partnerNote').value = partner.note || '';
        
        document.getElementById('modalTitle').innerText = '거래처 수정';
        this.modal.show();
    },

    async savePartner() {
        const id = document.getElementById('partnerId').value;
        const name = document.getElementById('partnerName').value.trim();
        const type = document.getElementById('partnerType').value;
        const contact = document.getElementById('partnerContact').value.trim();
        const note = document.getElementById('partnerNote').value.trim();

        if (!name) {
            return Swal.fire('알림', '거래처명을 입력해주세요.', 'warning');
        }

        const payload = { name, type, contact, note };

        try {
            if (id) {
                // 수정
                const res = await window.authFetch(`${API_BASE}/partners/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '저장 중 오류가 발생했습니다.');
                }
                Swal.fire({ title: '저장 완료', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            } else {
                // 등록
                const res = await window.authFetch(`${API_BASE}/partners`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '등록 중 오류가 발생했습니다.');
                }
                Swal.fire({ title: '등록 완료', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
            }
            this.modal.hide();
            this.loadData(); // 리로드
        } catch (error) {
            console.error(error);
            Swal.fire('오류', error.message || '저장 중 오류가 발생했습니다.', 'error');
        }
    },

    async deletePartner(id) {
        const partner = this.data.find(p => p.id === id);
        if (!partner) return;

        const result = await Swal.fire({
            title: '삭제 확인',
            html: `정말 <strong>${partner.name}</strong> 거래처를 삭제하시겠습니까?<br><span class="text-danger small">주의: 장부나 물류 기록에 연동된 경우 문제가 발생할 수 있습니다.</span>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '삭제',
            cancelButtonText: '취소',
            confirmButtonColor: '#dc3545'
        });

        if (result.isConfirmed) {
            try {
                const res = await window.authFetch(`${API_BASE}/partners/${id}`, {
                    method: 'DELETE'
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || '삭제 중 오류가 발생했습니다.');
                }
                Swal.fire({ title: '삭제됨', icon: 'success', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
                this.loadData();
            } catch (error) {
                console.error(error);
                Swal.fire('오류', error.message || '삭제 중 오류가 발생했습니다.', 'error');
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
