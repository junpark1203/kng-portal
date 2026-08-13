import sys

with open('05_Management/project_tracker/app.js', 'a', encoding='utf-8') as f:
    f.write('''

/* ==========================================================================
   Print Logic (Project Logs)
   ========================================================================== */

document.getElementById('btnPrintProject').addEventListener('click', () => {
    if (!currentProjectId) {
        Swal.fire('알림', '인쇄할 프로젝트를 먼저 선택해주세요.', 'info');
        return;
    }

    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;

    // Filter logs for this project and sort chronologically (oldest first for a log/history view, or newest first depending on preference - we'll use the current timeline order which is usually newest first, but for print let's do oldest first so it reads like a history document)
    // Wait, the current renderTimeline sorts logs by date desc. Let's just pass project.logs sorted by date ascending for a proper chronological report.
    let printLogs = (project.logs || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    executePrintProjectLogs(project, printLogs);
});

function executePrintProjectLogs(project, logs) {
    const container = document.getElementById('printContainer');
    if (!container) return;

    // Build the HTML template
    let html = `<table style="width: 100%; border: none; margin: 0; padding: 0; border-spacing: 0;">`;
    html += `<thead style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></thead>`;
    html += `<tfoot style="height: 15mm; border: none;"><tr><td style="border: none;"></td></tr></tfoot>`;
    html += `<tbody><tr><td style="border: none; padding: 0 10mm;">`;
    
    html += `<div class="print-report">`;
    
    // Header
    html += `
        <div class="print-header">
            <h1 class="print-title">프로젝트 로그 내역</h1>
        </div>
    `;

    // Project Info
    html += `
        <table class="print-info-table">
            <tr>
                <th>프로젝트명</th>
                <td colspan="3" style="font-size:15px; font-weight:700;">${project.title}</td>
            </tr>
            <tr>
                <th>담당자</th>
                <td>${project.manager}</td>
                <th>상태</th>
                <td>${project.status}</td>
            </tr>
            <tr>
                <th>구분</th>
                <td>${project.category}</td>
                <th>생성일</th>
                <td>${new Date(project.createdAt).toLocaleDateString()}</td>
            </tr>
        </table>
    `;

    // Logs Table
    html += `
        <h3 style="margin-bottom: 10px; border-left: 3px solid #0f172a; padding-left: 8px;">상세 진행 내역</h3>
        <table class="print-log-table">
            <thead>
                <tr>
                    <th class="col-date">일자</th>
                    <th class="col-type">유형</th>
                    <th class="col-manager">작성자</th>
                    <th class="col-content">내용</th>
                </tr>
            </thead>
            <tbody>
    `;

    if (logs.length === 0) {
        html += `<tr><td colspan="4" style="text-align:center; padding: 20px; color: #64748b;">등록된 로그가 없습니다.</td></tr>`;
    } else {
        logs.forEach(log => {
            const dateStr = log.date.substring(0,10);
            let typeLabel = '일반';
            let typeClass = 'info';
            if (log.type === 'warning') { typeLabel = '주의/이슈'; typeClass = 'warning'; }
            if (log.type === 'success') { typeLabel = '완료/성공'; typeClass = 'success'; }

            // Format content with newlines
            const formattedContent = (log.content || '').replace(/\\n/g, '<br>');
            
            // Attachments
            let attachHtml = '';
            if (log.attachments && log.attachments.length > 0) {
                attachHtml = `<div style="margin-top: 8px; font-size: 11px; color: #64748b; border-top: 1px dashed #e2e8f0; padding-top: 5px;">
                    <strong>[첨부파일]</strong> ${log.attachments.map(a => {
                        let name = a;
                        if(a.startsWith('/uploads/projects/')) name = a.split('/').pop().split('_').slice(1).join('_');
                        return name;
                    }).join(', ')}
                </div>`;
            }

            html += `
                <tr>
                    <td class="col-date">${dateStr}</td>
                    <td class="col-type"><span class="type-badge ${typeClass}">${typeLabel}</span></td>
                    <td class="col-manager">${log.manager || project.manager}</td>
                    <td class="col-content">
                        <div style="white-space: pre-wrap;">${formattedContent}</div>
                        ${attachHtml}
                    </td>
                </tr>
            `;
        });
    }

    html += `
            </tbody>
        </table>
    `;
    
    html += `</div>`; // end .print-report
    html += `</td></tr></tbody></table>`; // end wrapper table

    // Inject and Print
    container.innerHTML = html;
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            container.innerHTML = '';
        }, 500);
    }, 100);
}
''')

print('SUCCESS')
