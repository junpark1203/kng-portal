const fs = require('fs');

const inj = `
async function authFetch(url, options = {}) {
    let token = null;
    try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
    if (!token && typeof auth !== 'undefined' && auth.currentUser) token = await auth.currentUser.getIdToken(true);
    if (!options.headers) options.headers = {};
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    return fetch(url, options);
}
`;

['seller-k-products.js', 'kng-inventory/server/public/seller-k-products.js'].forEach(f => {
    if(!fs.existsSync(f)) return;
    let c = fs.readFileSync(f, 'utf8');
    if(c.includes('async function authFetch')) return; // Already injected
    
    // Inject authFetch right before // ========================================== 유틸리티 함수
    c = c.replace(/\/\/\s*==========================================\r?\n\/\/\s*유틸리티 함수/, inj + '\n// ==========================================\n// 유틸리티 함수');
    
    // Replace all fetch() with authFetch() except the ones inside authFetch
    c = c.replace(/fetch\(/g, 'authFetch(');
    
    // Fix Firebase SDK script imports if any (though in this file it's `import` not `fetch`)
    // Just to be safe:
    c = c.replace(/authFetch\((['"]https?:\/\/www\.gstatic\.com)/g, 'fetch($1');
    
    // Fix the fetch inside authFetch itself to not loop
    c = c.replace(/return authFetch\(url, options\);/g, 'return fetch(url, options);');
    
    fs.writeFileSync(f, c);
    console.log('Updated ' + f);
});
