const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbFile = path.join(__dirname, 'data', 'kng.db');
const db = new sqlite3.Database(dbFile);

async function runMigration() {
    console.log('Starting Migration: Mapping unregistered text partners to official partner names...');

    // 1. Get all official partners
    const partners = await new Promise((resolve, reject) => {
        db.all("SELECT id, name, company_name FROM partners", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

    if (partners.length === 0) {
        console.log('No partners found in the database. Migration skipped.');
        db.close();
        return;
    }

    console.log(`Loaded ${partners.length} official partners.`);

    // Helper function to find the best matching partner
    const findMatchingPartner = (textName) => {
        if (!textName) return null;
        textName = textName.trim();
        
        // Exact match first
        let match = partners.find(p => p.name === textName || p.company_name === textName);
        if (match) return match.name;
        
        // Contains match (if the official name contains the text name)
        match = partners.find(p => p.name.includes(textName) || (p.company_name && p.company_name.includes(textName)));
        if (match) return match.name;
        
        // Reverse contains match (if the text name contains the official name)
        match = partners.find(p => textName.includes(p.name) || (p.company_name && textName.includes(p.company_name)));
        if (match) return match.name;
        
        return null;
    };

    // 2. Migrate logistics_inbound (supplier)
    const inboundRows = await new Promise((resolve, reject) => {
        db.all("SELECT id, supplier FROM logistics_inbound", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

    let inboundUpdated = 0;
    for (const row of inboundRows) {
        const matchedName = findMatchingPartner(row.supplier);
        if (matchedName && matchedName !== row.supplier) {
            await new Promise((resolve) => {
                db.run("UPDATE logistics_inbound SET supplier = ? WHERE id = ?", [matchedName, row.id], () => {
                    inboundUpdated++;
                    resolve();
                });
            });
            console.log(`[INBOUND] Migrated: ${row.supplier} -> ${matchedName}`);
        }
    }

    // 3. Migrate logistics_outbound (destination)
    const outboundRows = await new Promise((resolve, reject) => {
        db.all("SELECT id, destination FROM logistics_outbound", [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });

    let outboundUpdated = 0;
    for (const row of outboundRows) {
        const matchedName = findMatchingPartner(row.destination);
        if (matchedName && matchedName !== row.destination) {
            await new Promise((resolve) => {
                db.run("UPDATE logistics_outbound SET destination = ? WHERE id = ?", [matchedName, row.id], () => {
                    outboundUpdated++;
                    resolve();
                });
            });
            console.log(`[OUTBOUND] Migrated: ${row.destination} -> ${matchedName}`);
        }
    }

    console.log(`Migration completed. Inbound updated: ${inboundUpdated}, Outbound updated: ${outboundUpdated}`);
    db.close();
}

runMigration().catch(err => {
    console.error('Migration failed:', err);
    db.close();
});
