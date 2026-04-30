import re

with open('06_shopee/sell_it/server/server.js', 'r', encoding='utf-8') as f:
    server_content = f.read()

new_endpoint = """
app.post('/api/market-analysis/upload-video-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required.' });
        const ext = '.mp4';
        const filename = 'MA-' + Date.now() + ext;
        const filePath = path.join(UPLOAD_DIR, filename);
        const protocol = url.startsWith('https') ? require('https') : require('http');
        await new Promise((resolve, reject) => {
            const request = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    const rProto = response.headers.location.startsWith('https') ? require('https') : require('http');
                    rProto.get(response.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
                        const ws = require('fs').createWriteStream(filePath); r2.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
                    }).on('error', reject);
                    return;
                }
                if (response.statusCode !== 200) { reject(new Error('HTTP ' + response.statusCode)); return; }
                const ws = require('fs').createWriteStream(filePath); response.pipe(ws); ws.on('finish', () => { ws.close(); resolve(); }); ws.on('error', reject);
            });
            request.on('error', reject);
            request.setTimeout(15000, () => { request.destroy(); reject(new Error('Timeout')); });
        });
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        res.json({ message: 'Success', filename, url: imgBase + '/api/images/' + filename, size: require('fs').statSync(filePath).size });
    } catch (err) {
        res.status(500).json({ error: 'Video URL download failed: ' + err.message });
    }
});
"""

server_content = server_content.replace("app.delete('/api/images/:filename'", new_endpoint + "\napp.delete('/api/images/:filename'")

with open('06_shopee/sell_it/server/server.js', 'w', encoding='utf-8') as f:
    f.write(server_content)

with open('06_shopee/sell_it/app.js', 'r', encoding='utf-8') as f:
    app_content = f.read()

app_handlers = """
    document.getElementById('ma-image-url')?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = e.target.value.trim();
        if (!url) return;
        if (currentMAImages.length >= 9) {
            alert('이미지는 최대 9장까지만 업로드 가능합니다.');
            return;
        }
        try {
            const result = await api.uploadMarketAnalysisImageUrl(url);
            currentMAImages.push(result.url);
            renderMAImageGrid();
            e.target.value = '';
        } catch (err) {
            alert('이미지 URL 업로드 실패: ' + err.message);
        }
    });

    document.getElementById('ma-video-url')?.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = e.target.value.trim();
        if (!url) return;
        try {
            const result = await api.uploadMarketAnalysisVideoUrl(url);
            currentMAVideoUrl = result.url;
            renderMAVideo();
            e.target.value = '';
        } catch (err) {
            alert('동영상 URL 업로드 실패: ' + err.message);
        }
    });
"""

app_content = app_content.replace("document.getElementById('ma-video-remove-btn')?.addEventListener('click', () => {", app_handlers + "\n    document.getElementById('ma-video-remove-btn')?.addEventListener('click', () => {")

clear_fields = """
        const imgUrlInput = document.getElementById('ma-image-url');
        if (imgUrlInput) imgUrlInput.value = '';
        const videoUrlInput = document.getElementById('ma-video-url');
        if (videoUrlInput) videoUrlInput.value = '';
"""
app_content = app_content.replace("document.getElementById('ma-note').value = isEdit ? (item.note || '') : '';", "document.getElementById('ma-note').value = isEdit ? (item.note || '') : '';\n" + clear_fields)

with open('06_shopee/sell_it/app.js', 'w', encoding='utf-8') as f:
    f.write(app_content)

print("Patch applied to server.js and app.js")
