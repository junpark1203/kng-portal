const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run("CREATE TABLE test (id INTEGER)");
    db.run("ALTER TABLE test ADD COLUMN a TEXT");
    
    // Simulate what happens in logistics.js
    const queries = [
        "ALTER TABLE test ADD COLUMN a TEXT", // This will fail (duplicate)
        "ALTER TABLE test ADD COLUMN b TEXT"  // Will this execute?
    ];
    
    db.serialize(() => {
        queries.forEach(sql => db.run(sql, (err) => {
            if (err) console.log("Error:", err.message);
            else console.log("Success:", sql);
        }));
    });
    
    db.all("PRAGMA table_info(test)", (err, rows) => {
        console.log("Columns:", rows.map(r => r.name));
    });
});
