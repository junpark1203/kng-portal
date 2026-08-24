const fs = require('fs');

let c = fs.readFileSync('app.js', 'utf8');

const target = '    openDirectExcelModal: function() {';
const replacement = `    openExcelMenuModal: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (!modal) modal = new bootstrap.Modal(modalEl);
        modal.show();
    },

    closeExcelMenuAndOpenDirect: function() {
        const modalEl = document.getElementById('excelMenuModal');
        let modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
        setTimeout(() => app.openDirectExcelModal(), 300);
    },

    openDirectExcelModal: function() {`;

if (c.includes(target) && !c.includes('openExcelMenuModal: function()')) {
    c = c.replace(target, replacement);
}

// Remove min="0.01" just in case there are any in app.js
c = c.replace(/min="0\.01" /g, '');

fs.writeFileSync('app.js', Buffer.from(c, 'utf8'));
console.log('Done app.js');
