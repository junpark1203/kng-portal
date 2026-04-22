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

// ── 인증 상태 감시 ──
var isEmbed = new URLSearchParams(window.location.search).get('embed') === 'true';

if (isEmbed) {
    // 포털 임베드 모드: 인증 건너뛰고 바로 앱 표시
    var loginOverlay = document.getElementById('loginOverlay');
    var mainApp = document.getElementById('mainApp');
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (mainApp) mainApp.classList.remove('hidden');
    console.log('[Auth] 포털 임베드 모드 — 인증 건너뜀');
} else {
    onAuthStateChanged(auth, function(user) {
        var loginOverlay = document.getElementById('loginOverlay');
        var mainApp = document.getElementById('mainApp');
        
        if (user) {
            // 로그인 상태 → 앱 표시
            if (loginOverlay) loginOverlay.classList.add('hidden');
            if (mainApp) mainApp.classList.remove('hidden');
            console.log('[Auth] 로그인됨:', user.email);
        } else {
            // 비로그인 → 로그인 화면 표시
            if (loginOverlay) loginOverlay.classList.remove('hidden');
            if (mainApp) mainApp.classList.add('hidden');
            console.log('[Auth] 로그아웃 상태');
        }
    });
}

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
