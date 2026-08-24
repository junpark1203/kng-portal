const sqlite3 = require('sqlite3');
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("ALTER TABLE test ADD COLUMN note TEXT"); // Success
    db.run("ALTER TABLE test ADD COLUMN note TEXT", (err) => { // Fails
        if (err) console.log("Error adding note:", err.message);
    });
    db.run("ALTER TABLE test ADD COLUMN next_col TEXT", (err) => { // Does it run?
        if (err) console.log("Error adding next_col:", err.message);
        else console.log("next_col added successfully!");
    });
});
