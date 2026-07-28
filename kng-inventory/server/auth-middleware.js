const admin = require('firebase-admin');

let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
    } else {
        const fs = require('fs');
        const path = require('path');
        const rootPath = path.join(__dirname, 'firebase-service-account.json');
        const dataPath = path.join(__dirname, 'data', 'firebase-service-account.json');
        
        if (fs.existsSync(rootPath)) {
            serviceAccount = require('./firebase-service-account.json');
        } else if (fs.existsSync(dataPath)) {
            serviceAccount = require('./data/firebase-service-account.json');
        }
    }

    if (!admin.apps.length) {
        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('[Auth] Firebase Admin SDK initialized with Service Account.');
        } else {
            // Service Account 파일이 없어도, 프로젝트 ID만으로 토큰 검증이 가능합니다.
            // verifyIdToken()은 Google의 공개 서명 키를 사용하여 토큰을 검증합니다.
            admin.initializeApp({
                projectId: 'kng-inventory'
            });
            console.log('[Auth] Firebase Admin SDK initialized with Project ID only (token verification available).');
        }
    }
} catch (error) {
    console.warn('[Auth Warning] Failed to initialize Firebase Admin SDK:', error.message);
}

const verifyToken = async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    // 이미지 프록시 등 인증 없이 접근해야 하는 경로 예외 처리
    const publicPaths = ['/exhibition-report/proxy'];
    if (publicPaths.some(p => req.originalUrl && req.originalUrl.includes(p))) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '인증 토큰이 누락되었습니다. (Unauthorized)' });
    }

    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('[Auth Error] Invalid Token:', error.message);
        return res.status(403).json({ error: '유효하지 않거나 만료된 토큰입니다. (Forbidden)' });
    }
};

module.exports = { verifyToken };
