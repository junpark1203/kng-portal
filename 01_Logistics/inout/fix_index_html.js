const fs = require('fs');

let c = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/index.html', 'utf8');

const regex = /<div class="btn-group shadow-sm">[\s\S]*?<\/div>/;
const new_buttons = `            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> 엑셀등록
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> 직출고 등록
            </button>`;

if (c.match(regex)) {
    c = c.replace(regex, new_buttons);
} else {
    console.log("Could not find button group regex in index.html");
}

const new_modal = `\n<!-- 엑셀 등록 메뉴 모달 -->
<div class="modal fade" id="excelMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold"><i class='bx bx-table'></i> 엑셀 일괄 등록</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center py-4">
                <button class="btn btn-warning w-100 py-3 fw-bold fs-6 shadow-sm" onclick="app.closeExcelMenuAndOpenDirect()">
                    <i class='bx bx-shuffle'></i> 직출고 일괄등록
                </button>
                <div class="mt-4 text-muted small text-start">
                    <i class='bx bx-info-circle'></i> 입고 및 출고 일괄등록은 추후 지원 예정입니다.
                </div>
            </div>
        </div>
    </div>
</div>
`;

const idx = c.indexOf('<!-- 직출고 엑셀 업로드 모달 -->');
if (idx !== -1 && !c.includes('excelMenuModal')) {
    c = c.substring(0, idx) + new_modal + c.substring(idx);
}

// Remove min="0.01" from qty inputs
c = c.replace(/min="0\.01" /g, '');

fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/index.html', Buffer.from(c, 'utf8'));
console.log('Done modifying index.html');
