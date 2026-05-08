const mockApiData = [
  {
    exportId: 'ME-P-1778062272486-43hz-global',
    marketCode: 'global',
    id: 'P-1778062272486-43hz',
    date: '2026-05-06',
    mcode: 'CGM2-06-002-03',
    catEn: 'Home & Living > Kitchenware',
    catKo: '홈 & 리빙 > 주방 용품',
    nameEn: '[LocknLock]',
    nameKo: '락앤락',
    priceKrw: 9160,
    rate: 1468.43,
    weight: 750,
    optionName: '3 Pack',
    status: 'active'
  }
];

try {
    let output = "Test starting...\n";
    
    // Extracted from app.js
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
                    children: items.sort((a, b) => a.mcode.localeCompare(b.mcode))
                };
                grouped.push(parent);
            } else {
                grouped.push(items[0]);
            }
        });

        grouped.sort((a, b) => {
            const dateDiff = new Date(b.date) - new Date(a.date);
            if (dateDiff !== 0) return dateDiff;
            return b.mcode.localeCompare(a.mcode);
        });
        return grouped;
    }

    function escapeHtmlAttr(str) {
        if (!str) return '';
        return String(str).replace(/"/g, '&quot;');
    }

    const marketExportsMap = {};

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

        const optionBadge = p.optionName ? `<div style="margin-top:4px; font-size:0.8rem; color:var(--primary); font-weight:bold;">↳ Opt: ${p.optionName}</div>` : '';
        const nameEnHtml = parentMcode ? `<div style="font-weight: 600; opacity: 0.5;" class="prod-name-en">${p.nameEn}</div>` : `<div style="font-weight: 600;" class="prod-name-en">${p.nameEn}</div>`;
        const statusBadge = p.status === 'draft' ? `<span class="draft">draft</span>` : '';
        const nameKoHtml = parentMcode ? `<div class="body-sm text-secondary prod-name-ko" style="opacity: 0.5;">${p.nameKo}${statusBadge}</div>` : `<div class="body-sm text-secondary prod-name-ko">${p.nameKo}${statusBadge}</div>`;
        const catHtml = parentMcode ? `<div style="opacity: 0.3; font-size: 0.8rem;">(Same as parent)</div>` : `
            <div class="prod-cat-en-1">${catEn1}</div>
            <div class="prod-cat-en-2">${catEn2}</div>
            <div class="body-sm text-secondary prod-cat-ko" style="margin-top: 4px;">${p.catKo}</div>
        `;

        return `<tr>...${p.mcode}...</tr>`;
    }

    function renderGlobalSkuTable(globalSkuList) {
        const groupedData = groupProductsByParent(globalSkuList);
        let html = '';
        groupedData.forEach(item => {
            if (item.isVirtualParent) {
                let minPrice = Math.min(...item.children.map(c => c.priceKrw));
                let maxPrice = Math.max(...item.children.map(c => c.priceKrw));
                let priceRangeStr = minPrice === maxPrice ? `KRW ${minPrice}` : `KRW ${minPrice} ~ ${maxPrice}`;
                
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

    const htmlOutput = renderGlobalSkuTable(mockApiData);
    console.log("Success! Rendered HTML length:", htmlOutput.length);
} catch (e) {
    console.error("ERROR:", e);
}
