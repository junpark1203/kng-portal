const fs = require('fs');
let code = fs.readFileSync('../../01_Logistics/inout/app.js', 'utf8');
code = code.replace(
    /<button class="btn btn-sm btn-outline-secondary py-0 px-2 me-1" onclick="event\.stopPropagation\(\); \$\{editFn\}" title="수정"><i class='bx bx-edit'><\/i><\/button>\n                    <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="event\.stopPropagation\(\); \$\{delFn\}" title="삭제"><i class='bx bx-trash'><\/i><\/button>/g,
    `\$\{r.settlement_status === '정산완료' 
                        ? \`<span class="badge bg-secondary">정산완료</span>\` 
                        : \`<button class="btn btn-sm btn-outline-secondary py-0 px-2 me-1" onclick="event.stopPropagation(); \$\{editFn\}" title="수정"><i class='bx bx-edit'></i></button>
                           <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="event.stopPropagation(); \$\{delFn\}" title="삭제"><i class='bx bx-trash'></i></button>\`
                    }`
);
fs.writeFileSync('../../01_Logistics/inout/app.js', code);
