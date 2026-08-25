const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');

const targetStr = `\${API_BASE}/outbound/direct/upload`;
const replacementStr = `\${API_BASE}/direct/upload`;

if (js.includes(targetStr)) {
    js = js.replace(targetStr, replacementStr);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js for upload endpoint');
} else {
    console.log('Target not found in app.js');
}
