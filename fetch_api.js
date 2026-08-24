const https = require('https');

https.get('https://kng-portal.junparks.com/api/logistics/history?page=1', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        console.log("Status:", res.statusCode);
        console.log("Response:", data.substring(0, 500));
    });
}).on('error', (err) => {
    console.error("Error:", err.message);
});
