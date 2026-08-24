const fs = require('fs');

let c = fs.readFileSync('index.html'); // Read as raw Buffer to avoid encoding issues

// We will use string for replacement, assuming the file is UTF-8 encoded
let content = c.toString('utf8');

const old_buttons = '        <div class="d-flex gap-2">\n            <div class="btn-group shadow-sm">\n                <button class="btn btn-warning" onclick="app.openDrawer(\'direct_create\')">\n                    <i class=\'bx bx-shuffle\'></i> \uC9C1\uCD9C\uACE0 \uB4F1\uB85D\n                </button>\n                <button class="btn btn-outline-warning text-dark fw-bold" onclick="app.openDirectExcelModal()">\n                    <i class=\'bx bx-table\'></i> \uC5D1\uC140 \uC77C\uAD04 \uB4F1\uB85D\n                </button>\n            </div>';

const new_buttons = '        <div class="d-flex gap-2">\n            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">\n                <i class=\'bx bx-table\'></i> \uC5D1\uC140\uB4F1\uB85D\n            </button>\n            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer(\'direct_create\')">\n                <i class=\'bx bx-shuffle\'></i> \uC9C1\uCD9C\uACE0 \uB4F1\uB85D\n            </button>';

if (content.includes(old_buttons)) {
    content = content.replace(old_buttons, new_buttons);
} else {
    console.log("Could not find old buttons");
}

// Remove min="0.01" from inputs
content = content.replace(/min="0\.01" /g, '');

const new_modal = '<!-- \uC5D1\uC140 \uB4F1\uB85D \uBA54\uB274 \uBAA8\uB2EC -->\n<div class="modal fade" id="excelMenuModal" tabindex="-1" aria-hidden="true" data-bs-backdrop="static">\n    <div class="modal-dialog modal-dialog-centered modal-sm">\n        <div class="modal-content">\n            <div class="modal-header bg-light">\n                <h5 class="modal-title fw-bold"><i class=\'bx bx-table\'></i> \uC5D1\uC140 \uC77C\uAD04 \uB4F1\uB85D</h5>\n                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>\n            </div>\n            <div class="modal-body text-center py-4">\n                <button class="btn btn-warning w-100 py-3 fw-bold fs-6 shadow-sm" onclick="app.closeExcelMenuAndOpenDirect()">\n                    <i class=\'bx bx-shuffle\'></i> \uC9C1\uCD9C\uACE0 \uC77C\uAD04\uB4F1\uB85D\n                </button>\n                <div class="mt-4 text-muted small text-start">\n                    <i class=\'bx bx-info-circle\'></i> \uC785\uACE0 \uBC0F \uCD9C\uACE0 \uC77C\uAD04\uB4F1\uB85D\uC740 \uCD94\uD6C4 \uC9C0\uC6D0 \uC608\uC815\uC785\uB2C8\uB2E4.\n                </div>\n            </div>\n        </div>\n    </div>\n</div>\n\n';

const idx = content.indexOf('<!-- \uC9C1\uCD9C\uACE0 \uC5D1\uC140 \uC5C5\uB85C\uB4DC \uBAA8\uB2EC -->');
if (idx !== -1 && !content.includes('excelMenuModal')) {
    content = content.substring(0, idx) + new_modal + content.substring(idx);
}

fs.writeFileSync('index.html', Buffer.from(content, 'utf8'));
console.log('Done');
