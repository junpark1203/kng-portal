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
        } else {
            throw new Error('Firebase service account key not found in root or data directory');
        }
    }

    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log('[Auth] Firebase Admin SDK initialized successfully.');
    }
} catch (error) {
    console.warn('[Auth Warning] Failed to load Firebase Service Account. API calls will fail if token validation is required.', error.message);
}

const verifyToken = async (req, res, next) => {
    if (req.method === 'OPTIONS') return next();

    // 이미지 프록시 등 인증 없이 접근해야 하는 경로 예외 처리
    const publicPaths = ['/exhibition-report/proxy'];
    if (publicPaths.some(p => req.path.includes(p))) {
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
