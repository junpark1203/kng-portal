const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(
    "const { verifyToken } = require('./auth-middleware');",
    "app.use('/api/tbm-material-quotes', tbmMaterialQuotesRoutes.router);\nconst { verifyToken } = require('./auth-middleware');"
);
fs.writeFileSync('server.js', code);
