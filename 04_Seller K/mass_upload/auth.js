// ========================================
// SmartStore Mass Upload — Firebase Auth
// kng-inventory와 동일한 Firebase 프로젝트 사용
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDqdzlXTddvoBYWaVbTM7_ERO_rUGWjIgE",
    authDomain: "kng-inventory.firebaseapp.com",
    projectId: "kng-inventory",
    storageBucket: "kng-inventory.firebasestorage.app",
    messagingSenderId: "647181899026",
    appId: "1:647181899026:web:7cd3b62a7a10771b204fcb",
    measurementId: "G-5VYMDB59XD"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);

// ── 포털 전용: 인증은 포털(index.html)에서 처리 ──
// 바로 앱 표시
var mainApp = document.getElementById('mainApp');
if (mainApp) mainApp.classList.remove('hidden');
console.log('[Auth] 포털 전용 모드 — 앱 바로 표시');

// ── 로그인 폼 핸들러 ──
document.addEventListener('DOMContentLoaded', function() {
    var loginForm = document.getElementById('loginForm');
    var loginError = document.getElementById('loginError');
    var logoutBtn = document.getElementById('logoutBtn');

    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var email = document.getElementById('loginEmail').value;
            var password = document.getElementById('loginPassword').value;
            var btn = document.getElementById('loginBtn');
            
            if (btn) btn.disabled = true;
            if (loginError) loginError.classList.add('hidden');

            signInWithEmailAndPassword(auth, email, password)
                .then(function() {
                    if (btn) btn.disabled = false;
                })
                .catch(function(error) {
                    console.error('[Auth] 로그인 실패:', error);
                    if (loginError) {
                        loginError.textContent = '아이디 또는 비밀번호가 틀렸습니다.';
                        loginError.classList.remove('hidden');
                    }
                    if (btn) btn.disabled = false;
                });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            signOut(auth).then(function() {
                console.log('[Auth] 로그아웃 완료');
            });
        });
    }
});

window.fbAuth = auth;
