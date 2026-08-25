const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');

const targetRegex = /            const res = await fetch\(`\$\{API_BASE\}\/outbound\/direct\/upload`, \{\n                method: 'POST',\n                headers: \{\n                    'Authorization': `Bearer \$\{localStorage\.getItem\('token'\)\}`\n                \},\n                body: formData\n            \}\);/g;

const replacement = `            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(\`\${API_BASE}/outbound/direct/upload\`, {
                method: 'POST',
                headers: {
                    'Authorization': \`Bearer \${token}\`
                },
                body: formData
            });`;

if (js.match(targetRegex)) {
    js = js.replace(targetRegex, replacement);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js for uploadDirectExcel');
} else {
    console.log('Target not found in app.js');
}
