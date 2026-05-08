global.window = { updateExportCharCount: ()=>{}, updateBulkActionBar: ()=>{},
    location: { hostname: 'localhost' },
    generateManagementCode: () => 'TEST-001'
};
global.document = { addEventListener:()=>{},
    querySelector: (sel) => {
        if (sel === '#pl-table tbody') return global._mockTbody;
        return { innerHTML: '', addEventListener: () => {} };
    },
    querySelectorAll: () => [],
    getElementById: (id) => {
        if (id === 'pl-table') return { id: 'pl-table', querySelectorAll: () => [] };
        return {
            innerHTML: '',
            addEventListener: () => {},
            value: '10',
            dataset: {}
        };
    },
    createElement: () => ({
        innerHTML: '',
        addEventListener: () => {},
        appendChild: () => {}
    })
};
global._mockTbody = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(val) { this._html = val; console.log("==> TBODY innerHTML updated! Length:", val.length); }
};

global.fetch = async () => ({
    ok: true,
    json: async () => ([
        { id: '1', mcode: 'TEST-123-01', nameEn: 'Test Product', priceKrw: 10000, date: '2026-05-08' }
    ])
});

require('./test_app.js');
