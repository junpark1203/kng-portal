const fs = require('fs');

async function testProd() {
    try {
        const res = await fetch('https://shopee-api.junparks.com/api/market-exports?market=global');
        const data = await res.json();
        
        for (const p of data) {
            if (p.catEn && typeof p.catEn !== 'string') {
                console.log("FOUND NON-STRING CATEN:", p.catEn, "TYPE:", typeof p.catEn);
            }
        }
        console.log("Check complete.");
    } catch(err) {
        console.error("ERROR:", err);
    }
}
testProd();
