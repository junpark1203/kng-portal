const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');

const targetStr = `            const res = await fetch(\`\${API_BASE}/outbound/direct/upload\`, {`;

const insertTokenStr = `            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(\`\${API_BASE}/outbound/direct/upload\`, {`;

if (js.includes(targetStr)) {
    js = js.replace(targetStr, insertTokenStr);
    js = js.replace("`Bearer ${localStorage.getItem('token')}`", "`Bearer ${token}`");
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js for uploadDirectExcel');
} else {
    console.log('Target not found in app.js');
}
