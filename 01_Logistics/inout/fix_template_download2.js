const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');

const targetRegex = /    downloadExcelTemplate: async function\(\) \{[\s\S]*?    \},/;

const replacement = `    downloadExcelTemplate: async function() {
        try {
            let token = null;
            try {
                if (window.parent && window.parent !== window && window.parent.getAuthToken) {
                    token = await window.parent.getAuthToken();
                }
            } catch(e) {}
            if (!token) {
                try { token = await waitForAuth(); } catch(e) {}
            }
            if (!token) token = localStorage.getItem('token');

            const res = await fetch(API_BASE + '/direct/template', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) {
                const err = await res.json().catch(()=>({}));
                throw new Error(err.error || 'HTTP error ' + res.status);
            }
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = '직출고_엑셀일괄등록_양식.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            alert('템플릿 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    },`;

if (js.match(targetRegex)) {
    js = js.replace(targetRegex, replacement);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js with token logic');
} else {
    console.log('Target not found in app.js');
}
