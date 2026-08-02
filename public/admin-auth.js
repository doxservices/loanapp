// Shared Google Sign-In gate for all admin pages, cross-origin safe (Bearer
// token, no cookies). Include after firebase-config.js:
//   <script src="firebase-config.js"></script>
//   <script type="module" src="admin-auth.js"></script>
// Then call window.adminAuth.ready() before rendering, and use
// window.adminAuth.fetch(path, opts) instead of bare fetch() for API calls.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const API_BASE = window.LOANIT_API_BASE || 'https://doxservices-loanapp.web.app';
const fbApp = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(fbApp);

function renderGate() {
  const overlay = document.createElement('div');
  overlay.id = 'admin-auth-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:#f5f5f7;display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;';
  overlay.innerHTML = `
    <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center;max-width:360px">
      <h2 style="margin:0 0 8px">Admin sign-in</h2>
      <p style="margin:0 0 16px;color:#555">Sign in with the doxservices Google account to continue.</p>
      <button id="admin-auth-signin" style="padding:10px 20px;font-size:15px;cursor:pointer;border:1px solid #ddd;border-radius:6px;background:#fff">Sign in with Google</button>
      <div id="admin-auth-msg" style="color:#c00;font-size:13px;margin-top:12px;min-height:16px"></div>
    </div>`;
  document.body.appendChild(overlay);
  const msg = overlay.querySelector('#admin-auth-msg');
  overlay.querySelector('#admin-auth-signin').addEventListener('click', async () => {
    msg.textContent = '';
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const idToken = await result.user.getIdToken();
      const res = await fetch(API_BASE + '/auth/verify', { headers: { Authorization: 'Bearer ' + idToken } });
      const json = await res.json();
      if (json.ok) { overlay.remove(); onReady(); return; }
      msg.textContent = json.error || 'Sign-in failed.';
      await signOut(auth);
    } catch (err) {
      msg.textContent = err.message || 'Sign-in failed.';
    }
  });
  return overlay;
}

let readyResolve;
const readyPromise = new Promise(resolve => { readyResolve = resolve; });
let onReady = () => {};
let currentToken = null;

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.getElementById('admin-auth-overlay') || renderGate();
    return;
  }
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(API_BASE + '/auth/verify', { headers: { Authorization: 'Bearer ' + idToken } });
    const json = await res.json();
    if (json.ok) {
      currentToken = idToken;
      const overlay = document.getElementById('admin-auth-overlay');
      if (overlay) overlay.remove();
      readyResolve();
      return;
    }
  } catch (err) {
    console.error('[admin-auth] verify failed', err);
  }
  // Signed in, but not the allowed account (or verify failed) — show the
  // gate and sign this identity out so a retry starts clean.
  await signOut(auth);
  document.getElementById('admin-auth-overlay') || renderGate();
});

window.adminAuth = {
  ready: () => readyPromise,
  fetch: async (path, opts = {}) => {
    const user = auth.currentUser;
    const idToken = user ? await user.getIdToken() : currentToken;
    const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + idToken };
    return fetch(API_BASE + path, { ...opts, headers });
  },
  signOut: async () => { await signOut(auth); location.reload(); },
  apiBase: API_BASE
};
