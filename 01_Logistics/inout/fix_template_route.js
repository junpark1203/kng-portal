const fs = require('fs');

// 1. Modify index.html
let html = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/index.html', 'utf8');
const targetHref = '<a href="/api/logistics/outbound/direct/template" class="btn btn-sm btn-outline-primary">';
const newHref = '<a href="javascript:app.downloadExcelTemplate()" class="btn btn-sm btn-outline-primary">';

if (html.includes(targetHref)) {
    html = html.replace(targetHref, newHref);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/index.html', Buffer.from(html, 'utf8'));
    console.log('Updated index.html');
} else {
    console.log('Could not find target href in index.html');
}

// 2. Modify app.js
let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');
const jsTarget = '    openDirectExcelModal: function() {';
const jsReplacement = `    downloadExcelTemplate: function() {
        window.location.href = API_BASE + '/direct/template';
    },

    openDirectExcelModal: function() {`;

if (js.includes(jsTarget) && !js.includes('downloadExcelTemplate: function()')) {
    js = js.replace(jsTarget, jsReplacement);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js');
} else {
    console.log('Could not find js target or already modified');
}
