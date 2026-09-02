const sqlite3 = require('sqlite3'); 
const db = new sqlite3.Database('database.sqlite'); 
db.all("PRAGMA table_info(logistics_inbound);", (err, rows) => { 
    console.log("inbound:", rows.map(r => r.name)); 
});
db.all("PRAGMA table_info(logistics_outbound);", (err, rows) => { 
    console.log("outbound:", rows.map(r => r.name)); 
});
