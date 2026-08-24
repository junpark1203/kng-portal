const fs = require('fs');

let c = fs.readFileSync('index.html', 'utf8');

const regex = /<div class="btn-group shadow-sm">[\s\S]*?<\/div>/;
const new_buttons = `            <button class="btn btn-outline-secondary shadow-sm fw-bold text-dark bg-white" onclick="app.openExcelMenuModal()">
                <i class='bx bx-table'></i> \uC5D1\uC140\uB4F1\uB85D
            </button>
            <button class="btn btn-warning shadow-sm" onclick="app.openDrawer('direct_create')">
                <i class='bx bx-shuffle'></i> \uC9C1\uCD9C\uACE0 \uB4F1\uB85D
            </button>`;

if (c.match(regex)) {
    c = c.replace(regex, new_buttons);
} else {
    console.log("Could not find button group regex");
}

fs.writeFileSync('index.html', Buffer.from(c, 'utf8'));
console.log('Done');
