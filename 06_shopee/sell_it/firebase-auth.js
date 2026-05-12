import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDqdzlXTddvoBYWaVbTM7_ERO_rUGWjIgE",
    authDomain: "kng-inventory.firebaseapp.com",
    projectId: "kng-inventory",
    storageBucket: "kng-inventory.firebasestorage.app",
    messagingSenderId: "647181899026",
    appId: "1:647181899026:web:7cd3b62a7a10771b204fcb",
    measurementId: "G-5VYMDB59XD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let tokenPromiseResolve;
window.authReadyPromise = new Promise(resolve => {
    tokenPromiseResolve = resolve;
});

window.getAuthToken = async function() {
    await window.authReadyPromise;
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        tokenPromiseResolve(true);
    } else {
        // 로그인이 안되어 있으면 포털 메인으로 리다이렉트
        alert('로그인이 필요합니다. 메인 포털로 이동합니다.');
        window.location.href = '../../index.html';
    }
});
