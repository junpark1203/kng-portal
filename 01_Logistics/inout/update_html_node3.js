const fs = require('fs');

let c = fs.readFileSync('index.html', 'utf8');

const new_modal = `\n<!-- \uC5D1\uC140 \uB4F1\uB85D \uBA54\uB274 \uBAA8\uB2EC -->
<div class="modal fade" id="excelMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">
    <div class="modal-dialog modal-dialog-centered modal-sm">
        <div class="modal-content">
            <div class="modal-header bg-light">
                <h5 class="modal-title fw-bold"><i class='bx bx-table'></i> \uC5D1\uC140 \uC77C\uAD04 \uB4F1\uB85D</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body text-center py-4">
                <button class="btn btn-warning w-100 py-3 fw-bold fs-6 shadow-sm" onclick="app.closeExcelMenuAndOpenDirect()">
                    <i class='bx bx-shuffle'></i> \uC9C1\uCD9C\uACE0 \uC77C\uAD04\uB4F1\uB85D
                </button>
                <div class="mt-4 text-muted small text-start">
                    <i class='bx bx-info-circle'></i> \uC785\uACE0 \uBC0F \uCD9C\uACE0 \uC77C\uAD04\uB4F1\uB85D\uC740 \uCD94\uD6C4 \uC9C0\uC6D0 \uC608\uC815\uC785\uB2C8\uB2E4.
                </div>
            </div>
        </div>
    </div>
</div>
`;

const idx = c.indexOf('<!-- \uC9C1\uCD9C\uACE0 \uC5D1\uC140 \uC5C5\uB85C\uB4DC \uBAA8\uB2EC -->');
if (idx !== -1 && !c.includes('excelMenuModal')) {
    c = c.substring(0, idx) + new_modal + c.substring(idx);
}

// Remove min="0.01" from qty inputs
c = c.replace(/min="0\.01" /g, '');

fs.writeFileSync('index.html', Buffer.from(c, 'utf8'));
console.log('Done modifying index.html');
