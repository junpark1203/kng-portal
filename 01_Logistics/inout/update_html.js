const fs = require('fs');

let c = fs.readFileSync('index.html', 'utf8');

const old_buttons =         <div class="d-flex gap-2">
            <div class="btn-group shadow-sm">
                <button class="btn btn-warning" onclick="app.openDrawer('direct_create')">
                    <i class='bx bx-shuffle'></i> ����� ���
                </button>
                <button class="btn btn-outline-warning text-dark fw-bold" onclick="app.openDirectExcelModal()">
                    <i class='bx bx-table'></i> ���� �ϰ� ���
                </button>
            </div>;

const new_buttons =         <div class="d-flex gap-2">
            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> �������
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> ����� ���
            </button>;

if (c.includes(old_buttons)) {
    c = c.replace(old_buttons, new_buttons);
} else {
    console.log("Could not find old buttons");
    // Just replace the inner group if it's slightly different formatting
    const regex = /<div class="btn-group shadow-sm">[\s\S]*?<\/div>/;
    c = c.replace(regex, <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> �������
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> ����� ���
            </button>);
}

const new_modal = <!-- ���� ��� �޴� ��� -->
<div class="modal fade" id="excelMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold"><i class='bx bx-table'></i> ���� �ϰ� ���</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center py-4">
                <button class="btn btn-warning w-100 py-3 fw-bold fs-6 shadow-sm" onclick="app.closeExcelMenuAndOpenDirect()">
                    <i class='bx bx-shuffle'></i> ����� �ϰ����
                </button>
                <div class="mt-4 text-muted small text-start">
                    <i class='bx bx-info-circle'></i> �԰� �� ��� �ϰ������ ���� ���� �����Դϴ�.
                </div>
            </div>
        </div>
    </div>
</div>

;

const idx = c.indexOf('<!-- ����� ���� ���ε� ��� -->');
if (idx !== -1 && !c.includes('excelMenuModal')) {
    c = c.substring(0, idx) + new_modal + c.substring(idx);
}

fs.writeFileSync('index.html', c, 'utf8');
console.log('Done');
