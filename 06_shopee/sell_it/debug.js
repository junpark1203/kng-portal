
const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'dangerously', resources: 'usable' });
dom.window.fetch = fetch; // Polyfill fetch if needed
dom.window.document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        console.log('App loaded. Checking error...');
        const errorCell = dom.window.document.querySelector('#pc-table tbody td');
        if (errorCell && errorCell.textContent.includes('������ �ε� ����')) {
            console.error('ERROR FOUND IN DOM:', errorCell.textContent);
        } else {
            console.log('NO ERROR FOUND in DOM');
        }
    }, 2000);
});

