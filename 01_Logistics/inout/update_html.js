const fs = require('fs');

let c = fs.readFileSync('index.html', 'utf8');

const old_buttons =         <div class="d-flex gap-2">
            <div class="btn-group shadow-sm">
                <button class="btn btn-warning" onclick="app.openDrawer('direct_create')">
                    <i class='bx bx-shuffle'></i> 직출고 등록
                </button>
                <button class="btn btn-outline-warning text-dark fw-bold" onclick="app.openDirectExcelModal()">
                    <i class='bx bx-table'></i> 엑셀 일괄 등록
                </button>
            </div>;

const new_buttons =         <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> 엑셀등록
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> 직출고 등록
            </button>;

if (c.includes(old_buttons)) {
    c = c.replace(old_buttons, new_buttons);
} else {
    console.log("Could not find old buttons");
    // Just replace the inner group if it's slightly different formatting
    const regex = /<div class="btn-group shadow-sm">[\s\S]*?<\/div>/;
    c = c.replace(regex, <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> 엑셀등록
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> 직출고 등록
            </button>);
}

const new_modal = <!-- 엑셀 등록 메뉴 모달 -->
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

;

const idx = c.indexOf('<!-- 직출고 엑셀 업로드 모달 -->');
if (idx !== -1 && !c.includes('excelMenuModal')) {
    c = c.substring(0, idx) + new_modal + c.substring(idx);
}

fs.writeFileSync('index.html', c, 'utf8');
console.log('Done');
