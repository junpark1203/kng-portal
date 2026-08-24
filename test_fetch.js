const http = require('http');

http.get('http://localhost:3000/api/logistics/history?page=1&limit=50', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log('Status:', res.statusCode);
        console.log('Body:', data);
    });
}).on('error', err => {
    console.error('Request Error:', err.message);
});
