const XLSX = require('xlsx');
const fs = require('fs');

function getCategories(file) {
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const categories = new Map();
    
    for (let r = 1; r <= range.e.r; r++) {
        const id = ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v || '';
        const l1 = ws[XLSX.utils.encode_cell({ r, c: 1 })]?.v || '';
        const l2 = ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v || '';
        const l3 = ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v || '';
        const l4 = ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v || '';
        if (id) {
            categories.set(String(id), [l1, l2, l3, l4].filter(Boolean).join(' > '));
        }
    }
    return categories;
}

const oldCats = getCategories('Templates/category_20260417_140714.xls');
const newCats = getCategories('Templates/category_20260805_094804.xls');

const added = [];
const removed = [];

for (const [id, path] of newCats.entries()) {
    if (!oldCats.has(id)) {
        added.push({ id, path });
    }
}

for (const [id, path] of oldCats.entries()) {
    if (!newCats.has(id)) {
        removed.push({ id, path });
    }
}

fs.writeFileSync('diff.json', JSON.stringify({ added, removed }, null, 2));
console.log('Wrote diff.json');
