const API_BASE = 'https://kng.junparks.com/api';

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
                (p.name && p.name.toLowerCase().includes(searchWord)) || 
                (p.company_name && p.company_name.toLowerCase().includes(searchWord)) ||
                (p.note && p.note.toLowerCase().includes(searchWord)) ||
                (p.phone && p.phone.includes(searchWord)) ||
                (p.manager1_name && p.manager1_name.includes(searchWord))
            );
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">등록된 거래처가 없거나 검색 결과가 없습니다.</td></tr>`;
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
                <td>
                    <div class="fw-bold">${p.name}</div>
                    <div class="small text-muted">${p.company_name || '-'}</div>
                </td>
                <td>${p.ceoName || p.ceo_name || '-'}</td>
                <td>
                    ${p.phone ? `<i class='bx bx-phone'></i> ${p.phone}<br>` : ''}
                    ${p.manager1_name ? `<i class='bx bx-user'></i> ${p.manager1_name}` : ''}
                </td>
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
        document.getElementById('partnerName').value = partner.name || '';
        document.getElementById('companyName').value = partner.company_name || '';
        document.getElementById('ceoName').value = partner.ceo_name || '';
        document.getElementById('businessNumber').value = partner.business_number || '';
        document.getElementById('address').value = partner.address || '';
        document.getElementById('partnerType').value = partner.type || 'ALL';
        
        document.getElementById('bankName').value = partner.bank_name || '';
        document.getElementById('accountNumber').value = partner.account_number || '';
        document.getElementById('accountHolder').value = partner.account_holder || '';
        
        document.getElementById('phone').value = partner.phone || '';
        document.getElementById('fax').value = partner.fax || '';
        
        document.getElementById('manager1Name').value = partner.manager1_name || '';
        document.getElementById('manager1Phone').value = partner.manager1_phone || '';
        document.getElementById('manager1Email').value = partner.manager1_email || '';
        
        document.getElementById('manager2Name').value = partner.manager2_name || '';
        document.getElementById('manager2Phone').value = partner.manager2_phone || '';
        document.getElementById('manager2Email').value = partner.manager2_email || '';
        
        document.getElementById('partnerNote').value = partner.note || '';
        
        document.getElementById('modalTitle').innerText = '거래처 수정';
        this.modal.show();
    },

    async savePartner() {
        const id = document.getElementById('partnerId').value;
        const name = document.getElementById('partnerName').value.trim();
        const company_name = document.getElementById('companyName').value.trim();
        const ceo_name = document.getElementById('ceoName').value.trim();
        const business_number = document.getElementById('businessNumber').value.trim();
        const address = document.getElementById('address').value.trim();
        const type = document.getElementById('partnerType').value;
        
        const bank_name = document.getElementById('bankName').value.trim();
        const account_number = document.getElementById('accountNumber').value.trim();
        const account_holder = document.getElementById('accountHolder').value.trim();
        
        const phone = document.getElementById('phone').value.trim();
        const fax = document.getElementById('fax').value.trim();
        
        const manager1_name = document.getElementById('manager1Name').value.trim();
        const manager1_phone = document.getElementById('manager1Phone').value.trim();
        const manager1_email = document.getElementById('manager1Email').value.trim();
        
        const manager2_name = document.getElementById('manager2Name').value.trim();
        const manager2_phone = document.getElementById('manager2Phone').value.trim();
        const manager2_email = document.getElementById('manager2Email').value.trim();
        
        const note = document.getElementById('partnerNote').value.trim();

        if (!name || !company_name) {
            return Swal.fire('알림', '거래처명과 사업자명을 모두 입력해주세요.', 'warning');
        }

        const payload = { 
            name, company_name, ceo_name, business_number, address, type,
            bank_name, account_number, account_holder,
            phone, fax,
            manager1_name, manager1_phone, manager1_email,
            manager2_name, manager2_phone, manager2_email,
            note 
        };

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
