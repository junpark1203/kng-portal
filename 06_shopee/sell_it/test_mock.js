const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Overwrite 'document.addEventListener("DOMContentLoaded", async () => {'
code = code.replace("document.addEventListener('DOMContentLoaded', async () => {", "async function run() {");
// Overwrite the last '});'
const lastIndex = code.lastIndexOf("});");
code = code.substring(0, lastIndex) + "}\nrun().catch(console.error);" + code.substring(lastIndex + 3);

fs.writeFileSync('test_app.js', code);
