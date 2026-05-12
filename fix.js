const fs=require('fs'); 
const files=['hq-entry.js','hq-inventory.js','hq-transactions.js','06_shopee/sell_it/api.js', '06_shopee/sell_it/harness.js']; 
files.forEach(f => { 
    if(!fs.existsSync(f)) return; 
    let c = fs.readFileSync(f, 'utf8'); 
    if(c.includes('async function authFetch')) return; 
    const inj = `
    async function authFetch(url, options = {}) {
        let token = null;
        try { if (window.parent && window.parent.getAuthToken) token = await window.parent.getAuthToken(); } catch(e){}
        if (!options.headers) options.headers = {};
        if (token) options.headers['Authorization'] = 'Bearer ' + token;
        return fetch(url, options);
    }
`; 
    c = c.replace(/\(function\(\) \{\r?\n\s*'use strict';/, function(m) { return m + inj; }); 
    c = c.replace(/fetch\(/g, 'authFetch('); 
    // Fix unintended replace if any
    c = c.replace(/authFetch\((['"]https?:\/\/www.gstatic.com)/g, 'fetch($1');
    fs.writeFileSync(f, c); 
    console.log('Updated ' + f); 
});
