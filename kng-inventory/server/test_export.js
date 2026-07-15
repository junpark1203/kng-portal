const http = require('http');

const data = JSON.stringify({
    ids: ['test1', 'test2']
});

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/supply-history/export',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
        // No token needed if we bypass or if we just want to see if it reaches the route
    }
};

const req = http.request(options, res => {
    console.log(`STATUS: ${res.statusCode}`);
    res.on('data', d => {
        process.stdout.write(d);
    });
});

req.on('error', error => {
    console.error(error);
});

req.write(data);
req.end();
