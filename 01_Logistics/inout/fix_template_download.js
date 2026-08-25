const fs = require('fs');

let js = fs.readFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', 'utf8');
const target = "    downloadExcelTemplate: function() {\n        window.location.href = API_BASE + '/direct/template';\n    },";
const replacement = `    downloadExcelTemplate: async function() {
        try {
            const res = await fetch(API_BASE + '/direct/template', {
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
            });
            if (!res.ok) throw new Error('다운로드 실패');
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'logistics_direct_template.xlsx';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (e) {
            alert('템플릿 다운로드 중 오류가 발생했습니다: ' + e.message);
        }
    },`;

if (js.includes("window.location.href = API_BASE + '/direct/template';")) {
    js = js.replace(target, replacement);
    fs.writeFileSync('c:/DEV/KNG WEBPAGE_20260505/01_Logistics/inout/app.js', Buffer.from(js, 'utf8'));
    console.log('Updated app.js');
} else {
    console.log('Target not found');
}
