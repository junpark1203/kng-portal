import re
import sys
import os

with open('06_shopee/sell_it/server/server.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add videoUpload
video_upload_code = """
const videoUpload = multer({
    storage: storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: function(req, file, cb) {
        if (path.extname(file.originalname).toLowerCase() === '.mp4' && file.mimetype === 'video/mp4') {
            return cb(null, true);
        }
        cb(new Error('MP4 동영상 파일만 업로드 가능합니다. (최대 30MB)'));
    }
});
"""
content = re.sub(r'(const upload = multer\(.*?\n\}\);)', lambda m: m.group(1) + '\n' + video_upload_code, content, flags=re.DOTALL)

# 2. Migration in initDb
migration_code = """
            if (err) console.error('market_analysis 테이블 생성 오류:', err.message);
            else {
                console.log('market_analysis 테이블 확인 완료');
                const cols = [
                    "ALTER TABLE market_analysis ADD COLUMN imageUrls TEXT",
                    "ALTER TABLE market_analysis ADD COLUMN videoUrl TEXT",
                    "ALTER TABLE market_analysis ADD COLUMN coupangRocket INTEGER DEFAULT 0"
                ];
                cols.forEach(sql => {
                    db.run(sql, (e) => {});
                });
            }
"""
content = re.sub(
    r"if \(err\) console\.error\('market_analysis 테이블 생성 오류:', err\.message\);\s+else console\.log\('market_analysis 테이블 확인 완료'\);",
    lambda m: migration_code.strip(),
    content
)

# 3. Replace processMarketAnalysisImageSync
process_media_sync_code = r"""function processMarketAnalysisMediaSync(d) {
    const market = (d.market || 'XX').toUpperCase();
    const storeName = (d.storeName || 'Unknown').replace(/[^a-zA-Z0-9가-힣_]/g, '');
    
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateFormatted = `${yy}${mm}${dd}`;

    let maxSeq = 0;
    try {
        const files = fs.readdirSync(UPLOAD_DIR);
        const regex = new RegExp(`-${dateFormatted}-(\\d{3})-[0-9V]+\\.[a-zA-Z0-9]+$`);
        files.forEach(f => {
            const match = f.match(regex);
            if (match) {
                const seq = parseInt(match[1], 10);
                if (seq > maxSeq) maxSeq = seq;
            }
        });
    } catch (e) {}

    let needsRename = false;
    if (d.imageUrl && d.imageUrl.includes('/api/images/MA-')) needsRename = true;
    if (d.imageUrls && Array.isArray(d.imageUrls)) {
        d.imageUrls.forEach(url => { if (url && url.includes('/api/images/MA-')) needsRename = true; });
    }
    if (d.videoUrl && d.videoUrl.includes('/api/images/MA-')) needsRename = true;

    if (!needsRename) return;

    const dailySeq = String(maxSeq + 1).padStart(3, '0');
    
    const renameFile = (url, suffix) => {
        if (!url || !url.includes('/api/images/MA-')) return url;
        try {
            const oldFilename = url.split('/api/images/').pop();
            const oldPath = path.join(UPLOAD_DIR, oldFilename);
            if (!fs.existsSync(oldPath)) return url;
            
            const ext = path.extname(oldFilename);
            const newFilename = `${market}-${storeName}-${dateFormatted}-${dailySeq}-${suffix}${ext}`;
            const newPath = path.join(UPLOAD_DIR, newFilename);
            
            fs.renameSync(oldPath, newPath);
            return url.replace(oldFilename, newFilename);
        } catch (e) {
            return url;
        }
    };

    if (d.imageUrl) d.imageUrl = renameFile(d.imageUrl, '01');
    if (d.imageUrls && Array.isArray(d.imageUrls)) {
        d.imageUrls = d.imageUrls.map((url, idx) => renameFile(url, String(idx + 1).padStart(2, '0')));
    }
    if (d.videoUrl) d.videoUrl = renameFile(d.videoUrl, 'V01');
}"""
content = re.sub(
    r"function processMarketAnalysisImageSync\(d\) \{.*?\n\}(?=\n*// 등록\napp\.post\('/api/market-analysis')",
    lambda m: process_media_sync_code + '\n\n',
    content,
    flags=re.DOTALL
)

# 4. Update POST and PUT
# POST
post_original = """
// 등록
app.post('/api/market-analysis', (req, res) => {
    const d = req.body;
    d.imageUrl = processMarketAnalysisImageSync(d);
    const id = d.id || ('MA-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const sql = `INSERT INTO market_analysis
        (id, market, shopeeCategory, productName, storeName, listingPrice, actualPrice,
         weight, sellerShipping, monthlySales, coupangPrice, coupangShipping,
         naverPrice, naverShipping, shopeeUrl, coupangUrl, naverUrl, imageUrl, note, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const params = [
        id, d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', d.note||'', now, now
    ];
"""

post_new = """
// 등록
app.post('/api/market-analysis', (req, res) => {
    const d = req.body;
    processMarketAnalysisMediaSync(d);
    const id = d.id || ('MA-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6));
    const now = new Date().toISOString();
    const imageUrlsStr = Array.isArray(d.imageUrls) ? JSON.stringify(d.imageUrls) : '[]';
    const coupangRocket = d.coupangRocket ? 1 : 0;
    
    const sql = `INSERT INTO market_analysis
        (id, market, shopeeCategory, productName, storeName, listingPrice, actualPrice,
         weight, sellerShipping, monthlySales, coupangPrice, coupangShipping, coupangRocket,
         naverPrice, naverShipping, shopeeUrl, coupangUrl, naverUrl, imageUrl, imageUrls, videoUrl, note, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const params = [
        id, d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, coupangRocket,
        d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', imageUrlsStr, d.videoUrl||'', d.note||'', now, now
    ];
"""
content = content.replace(post_original.strip(), post_new.strip())

# PUT
put_original = """
// 수정
app.put('/api/market-analysis/:id', (req, res) => {
    const id = req.params.id;
    const d = req.body;
    d.imageUrl = processMarketAnalysisImageSync(d);
    const now = new Date().toISOString();
    const sql = `UPDATE market_analysis SET
        market=?, shopeeCategory=?, productName=?, storeName=?, listingPrice=?, actualPrice=?,
        weight=?, sellerShipping=?, monthlySales=?, coupangPrice=?, coupangShipping=?,
        naverPrice=?, naverShipping=?, shopeeUrl=?, coupangUrl=?, naverUrl=?, imageUrl=?, note=?, updatedAt=?
        WHERE id=?`;
    const params = [
        d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', d.note||'', now, id
    ];
"""

put_new = """
// 수정
app.put('/api/market-analysis/:id', (req, res) => {
    const id = req.params.id;
    const d = req.body;
    processMarketAnalysisMediaSync(d);
    const now = new Date().toISOString();
    const imageUrlsStr = Array.isArray(d.imageUrls) ? JSON.stringify(d.imageUrls) : '[]';
    const coupangRocket = d.coupangRocket ? 1 : 0;
    
    const sql = `UPDATE market_analysis SET
        market=?, shopeeCategory=?, productName=?, storeName=?, listingPrice=?, actualPrice=?,
        weight=?, sellerShipping=?, monthlySales=?, coupangPrice=?, coupangShipping=?, coupangRocket=?,
        naverPrice=?, naverShipping=?, shopeeUrl=?, coupangUrl=?, naverUrl=?, imageUrl=?, imageUrls=?, videoUrl=?, note=?, updatedAt=?
        WHERE id=?`;
    const params = [
        d.market||'sg', d.shopeeCategory||'', d.productName||'', d.storeName||'',
        d.listingPrice||0, d.actualPrice||0, d.weight||0, d.sellerShipping||0, d.monthlySales||0,
        d.coupangPrice||0, d.coupangShipping||0, coupangRocket,
        d.naverPrice||0, d.naverShipping||0,
        d.shopeeUrl||'', d.coupangUrl||'', d.naverUrl||'', d.imageUrl||'', imageUrlsStr, d.videoUrl||'', d.note||'', now, id
    ];
"""
content = content.replace(put_original.strip(), put_new.strip())

# 5. Add /upload-video endpoint
video_endpoint = """
// 동영상 업로드
app.post('/api/market-analysis/upload-video', videoUpload.single('video'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: '동영상 파일이 없습니다.' });
        const filename = req.file.filename;
        const imgBase = process.env.IMG_BASE_URL || (req.protocol + '://' + req.get('host'));
        const url = imgBase + '/api/images/' + filename;
        res.json({ message: '업로드 성공', filename, url, size: req.file.size });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
"""
content = re.sub(
    r'(app\.post\(\'/api/market-analysis/upload-image\', upload\.single\(\'image\'\), \(req, res\) => \{.*?\n\}\);)',
    lambda m: m.group(1) + '\n\n' + video_endpoint.strip(),
    content,
    flags=re.DOTALL
)

with open('06_shopee/sell_it/server/server.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied to server.js")
