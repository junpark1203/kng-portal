document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
    loadCalendarEvents();

    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadDashboardData();
        loadCalendarEvents();
    });

    // 이벤트 모달 처리
    const modal = document.getElementById('eventModal');
    document.getElementById('addEventBtn').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('closeEventModal').addEventListener('click', () => modal.classList.add('hidden'));
    
    document.getElementById('eventForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const summary = document.getElementById('eventSummary').value;
        const start = document.getElementById('eventStart').value;
        const end = document.getElementById('eventEnd').value;
        
        try {
            const res = await fetch('/api/calendar/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary,
                    start: { date: start },
                    end: { date: end }
                })
            });
            if (!res.ok) throw new Error('일정 등록 실패');
            alert('일정이 등록되었습니다.');
            modal.classList.add('hidden');
            document.getElementById('eventForm').reset();
            loadCalendarEvents();
        } catch (err) {
            alert(err.message);
        }
    });
});

async function loadDashboardData() {
    try {
        const res = await fetch('/api/dashboard/summary');
        if (!res.ok) throw new Error('데이터 불러오기 실패');
        const data = await res.json();
        
        renderApprovals(data.pendingExpenses, data.pendingExhibitions);
        renderInvoices(data.pendingInvoices);
        renderLowStock(data.lowStockHqProducts);
        renderRecentSellerK(data.recentSellerKProducts);
    } catch (err) {
        console.error(err);
    }
}

async function loadCalendarEvents() {
    const container = document.getElementById('calendarWidget');
    try {
        const res = await fetch('/api/calendar/events');
        if (!res.ok) throw new Error('일정 불러오기 실패');
        const events = await res.json();
        
        if (events.length === 0) {
            container.innerHTML = '<div class="empty-state">이번 달 일정이 없습니다.</div>';
            return;
        }
        
        container.innerHTML = events.map(ev => `
            <div class="event-item">
                <div class="event-date">${ev.start.date || (ev.start.dateTime ? ev.start.dateTime.split('T')[0] : '')}</div>
                <div class="event-title">${ev.summary}</div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<div class="empty-state" style="color:red">${err.message}</div>`;
    }
}

function renderApprovals(expenses, exhibitions) {
    const container = document.getElementById('approvalWidget');
    let html = '';
    
    if (expenses.length === 0 && exhibitions.length === 0) {
        container.innerHTML = '<div class="empty-state">대기 중인 결재 문서가 없습니다.</div>';
        return;
    }

    expenses.forEach(doc => {
        html += `
            <div class="list-item">
                <div class="item-header">
                    <span class="item-title">[지출결의] ${doc.title || '제목없음'}</span>
                    <select class="status-select" onchange="updateStatus('expense-resolution', '${doc.id}', this.value)">
                        <option value="임시작성" ${doc.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                        <option value="결재대기" ${doc.status === '결재대기' ? 'selected' : ''}>결재대기</option>
                        <option value="결재상신" ${doc.status === '결재상신' ? 'selected' : ''}>결재상신</option>
                        <option value="결재보류">결재보류</option>
                        <option value="결재완료">결재완료</option>
                    </select>
                </div>
                <div class="item-meta">
                    기안자: ${doc.personInCharge || '-'} | 금액: ₩${doc.amount.toLocaleString()} | 작성일: ${doc.createdAt.split('T')[0]}
                </div>
            </div>
        `;
    });

    exhibitions.forEach(doc => {
        html += `
            <div class="list-item">
                <div class="item-header">
                    <span class="item-title">[참관보고] ${doc.exhibitionName || '전시회명 없음'}</span>
                    <select class="status-select" onchange="updateStatus('exhibition-report', '${doc.id}', this.value)">
                        <option value="임시작성" ${doc.status === '임시작성' ? 'selected' : ''}>임시작성</option>
                        <option value="결재대기" ${doc.status === '결재대기' ? 'selected' : ''}>결재대기</option>
                        <option value="결재상신" ${doc.status === '결재상신' ? 'selected' : ''}>결재상신</option>
                        <option value="결재보류">결재보류</option>
                        <option value="결재완료">결재완료</option>
                    </select>
                </div>
                <div class="item-meta">
                    방문일: ${doc.visitDate || '-'} | 작성일: ${doc.createdAt.split('T')[0]}
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderInvoices(invoices) {
    const container = document.getElementById('invoiceWidget');
    if (invoices.length === 0) {
        container.innerHTML = '<div class="empty-state">진행 중인 인보이스가 없습니다.</div>';
        return;
    }

    container.innerHTML = invoices.map(inv => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${inv.invoiceNo || 'No Invoice No'}</span>
                <select class="status-select" onchange="updateStatus('invoice-packing/documents', '${inv.id}', this.value)">
                    <option value="진행중" ${inv.status === '진행중' ? 'selected' : ''}>진행중</option>
                    <option value="보류" ${inv.status === '보류' ? 'selected' : ''}>보류</option>
                    <option value="완료">완료</option>
                </select>
            </div>
            <div class="item-meta">
                작성일: ${inv.docDate || inv.createdAt.split('T')[0]} | Shipper: ${inv.shipper?.name || '-'}
            </div>
        </div>
    `).join('');
}

function renderLowStock(products) {
    const container = document.getElementById('lowStockWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">안전재고 미달 품목이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name} (${p.color}, ${p.size})</span>
                <span class="badge danger">재고: ${p.stock}</span>
            </div>
            <div class="item-meta">공급사: ${p.supplier} | 브랜드: ${p.brand}</div>
        </div>
    `).join('');
}

function renderRecentSellerK(products) {
    const container = document.getElementById('recentSellerKWidget');
    if (products.length === 0) {
        container.innerHTML = '<div class="empty-state">최근 5일 이내 변동 내역이 없습니다.</div>';
        return;
    }

    container.innerHTML = products.map(p => `
        <div class="list-item">
            <div class="item-header">
                <span class="item-title">${p.name}</span>
                <span class="badge">수정일: ${p.updatedAt.split('T')[0]}</span>
            </div>
            <div class="item-meta">옵션: ${p.color} / ${p.size}</div>
        </div>
    `).join('');
}

async function updateStatus(apiEndpoint, id, newStatus) {
    try {
        const res = await fetch(`/api/${apiEndpoint}/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('상태 변경 실패');
        
        // 보류나 완료 등 화면에서 사라져야 할 상태면 목록 새로고침
        if (newStatus === '결재완료' || newStatus === '결재보류' || newStatus === '완료') {
            loadDashboardData();
        }
    } catch (err) {
        alert(err.message);
        loadDashboardData(); // 롤백
    }
}
