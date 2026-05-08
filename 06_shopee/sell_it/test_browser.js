const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

async function runBrowserTest() {
    try {
        const html = fs.readFileSync('index.html', 'utf8');
        const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable", url: "http://localhost/" });
        
        // Mock fetch
        dom.window.fetch = async (url) => {
            if (url.includes('market-exports?market=global')) {
                const res = await fetch('https://shopee-api.junparks.com/api/market-exports?market=global');
                return res;
            }
            if (url.includes('market-exports/all')) {
                const res = await fetch('https://shopee-api.junparks.com/api/market-exports/all');
                return res;
            }
            if (url.includes('/products')) {
                const res = await fetch('https://shopee-api.junparks.com/api/products');
                return res;
            }
            return { ok: true, json: async () => ({}) };
        };

        // Load scripts
        const apiCode = fs.readFileSync('api.js', 'utf8');
        dom.window.eval(apiCode);
        
        const searchCode = fs.readFileSync('../../Common/js/search-engine.js', 'utf8');
        dom.window.eval(searchCode);
        
        const appCode = fs.readFileSync('app.js', 'utf8');
        dom.window.eval(appCode);

        // Wait for DOMContentLoaded logic
        await new Promise(r => setTimeout(r, 2000));

        // Click Global SKU tab
        const gsTab = dom.window.document.querySelector('.sidebar .nav-item[data-view="global-sku"]');
        if (gsTab) {
            gsTab.click();
        } else {
            console.log("NO GS TAB");
        }

        // Wait for fetch
        await new Promise(r => setTimeout(r, 2000));

        const tbody = dom.window.document.querySelector('#gs-table tbody');
        console.log("TBODY Length:", tbody.innerHTML.length);
        console.log("TBODY Content (first 200 chars):", tbody.innerHTML.substring(0, 200));

    } catch(err) {
        console.error(err);
    }
}
runBrowserTest();
