const fs = require('fs');

async function testProd() {
    try {
        const res = await fetch('https://shopee-api.junparks.com/api/market-exports?market=global');
        const data = await res.json();
        console.log("Fetched " + data.length + " items from PROD.");

        const marketExportsMap = {};
        // Simulate marketExportsMap
        data.forEach(p => {
            if (!marketExportsMap[p.id]) marketExportsMap[p.id] = [];
            marketExportsMap[p.id].push({ marketCode: 'global' });
        });

        // Copy functions
        function getBaseMcode(mcode) {
            if (!mcode) return '';
            if (mcode.includes('-')) {
                const parts = mcode.split('-');
                if (parts.length > 2) {
                    return parts[0] + '-' + parts[1] + '-' + parts[2];
                }
            }
            return mcode;
        }

        function groupProductsByParent(list) {
            const map = new Map();
            list.forEach(p => {
                const base = getBaseMcode(p.mcode);
                if (!map.has(base)) {
                    map.set(base, []);
                }
                map.get(base).push(p);
            });

            const grouped = [];
            map.forEach((items, baseMcode) => {
                if (items.length > 1 || (items.length === 1 && items[0].optionName)) {
                    const parent = {
                        isVirtualParent: true,
                        mcode: baseMcode,
                        date: items[0].date,
                        catEn: items[0].catEn,
                        catKo: items[0].catKo,
                        nameEn: items[0].nameEn,
                        nameKo: items[0].nameKo,
                        children: items.sort((a, b) => (a.mcode||'').localeCompare(b.mcode||''))
                    };
                    grouped.push(parent);
                } else {
                    grouped.push(items[0]);
                }
            });

            grouped.sort((a, b) => {
                const dateDiff = new Date(b.date||0) - new Date(a.date||0);
                if (dateDiff !== 0 && !isNaN(dateDiff)) return dateDiff;
                return (b.mcode||'').localeCompare(a.mcode||'');
            });
            return grouped;
        }

        function escapeHtmlAttr(str) {
            if (!str) return '';
            return String(str).replace(/"/g, '&quot;');
        }

        function renderGsRow(p, extraStyle, parentMcode) {
            let catEn1 = p.catEn || '';
            let catEn2 = '';
            if (catEn1 && catEn1.includes(' > ')) {
                const parts = catEn1.split(' > ');
                catEn1 = parts[0] + ' >';
                catEn2 = parts[1];
            }
            const priceUsd = (p.priceKrw / (p.rate || 1)).toFixed(2);

            const exports = marketExportsMap[p.id] || [];
            const exportedMarkets = exports.map(e => e.marketCode);
            const marketCodes = ['sg','my','tw','th','ph','vn','br','mx'];
            const badgesHtml = marketCodes.map(code => {
                const isActive = exportedMarkets.includes(code) ? ' active' : '';
                return `<span class="badge-market${isActive}" data-market="${code}">${code.toUpperCase()}</span>`;
            }).join('');

            return `<tr data-mcode="${p.mcode}"><td>${p.nameEn}</td></tr>`;
        }

        function renderGlobalSkuTable(globalSkuList) {
            const groupedData = groupProductsByParent(globalSkuList);
            let html = '';
            groupedData.forEach(item => {
                if (item.isVirtualParent) {
                    html += `<tr>Parent ${item.mcode}</tr>`;
                    item.children.forEach((c, idx) => {
                        html += renderGsRow(c, '', item.mcode);
                    });
                } else {
                    html += renderGsRow(item, '', '');
                }
            });
            return html;
        }

        const html = renderGlobalSkuTable(data);
        console.log("HTML successfully generated! Length:", html.length);
        
    } catch(err) {
        console.error("ERROR:", err);
    }
}
testProd();
