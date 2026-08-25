const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');

const targetStr = `            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error || 'HTTP error ' + res.status);
            }`;

const replacementStr = `            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                const errMsg = err.details ? err.error + ': ' + err.details : err.error;
                throw new Error(errMsg || 'HTTP error ' + res.status);
            }`;

if (js.includes(targetStr)) {
    js = js.replace(targetStr, replacementStr);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js for better error display');
} else {
    console.log('Target not found in app.js');
}
