
const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Mock DOM
global.document = {
    addEventListener: (evt, cb) => {
        if(evt === 'DOMContentLoaded') {
            global.runApp = cb;
        }
    },
    getElementById: () => ({ style: {}, addEventListener: () => {}, classList: { add: ()=>{}, remove: ()=>{} }, querySelector: ()=>({innerText: ''}) }),
    querySelector: () => ({ innerHTML: '', addEventListener: () => {}, classList: { add: ()=>{}, remove: ()=>{} } }),
    querySelectorAll: () => ([]),
};
global.window = {
    latestExchangeRates: {},
    SHOPEE_CATEGORIES: []
};
global.localStorage = {
    getItem: () => null,
    setItem: () => {}
};

// Mock API
global.api = {
    getProducts: async () => [{id: '1', mcode: 'M-1', date: '2026-05-06', priceKrw: 1000}],
    getAllMarketExports: async () => ({}),
    getPresets: async () => ([]),
    getPromotionPresets: async () => ([]),
    getShippingPresets: async () => ([]),
    getSystemSettings: async () => ({}),
    getMarketExports: async () => ([]),
    getMarketAnalysis: async () => ([])
};

// Evaluate app.js
try {
    eval(code);
    console.log('Eval success. Running app...');
    runApp().then(() => console.log('App init finished without crashing')).catch(e => console.error('App init crashed:', e));
} catch(e) {
    console.error('Syntax/Eval error:', e);
}

