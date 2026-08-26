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

// The gate is styled to match the app's default theme (banking backdrop,
// deep-blue glass card, gold action) so the sign-in step doesn't look like
// a different product from the pages behind it.
function renderGate() {
  const overlay = document.createElement('div');
  overlay.id = 'admin-auth-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9999', 'display:flex', 'align-items:center', 'justify-content:center', 'padding:20px',
    "background:linear-gradient(rgba(4,22,66,.66),rgba(4,22,66,.66)),url('assets/banking-background.jpg') center center / cover no-repeat fixed",
    "font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif", 'color:rgba(255,255,255,.97)', 'text-shadow:0 1px 2px rgba(0,0,0,.14)'
  ].join(';');
  overlay.innerHTML = `
    <div style="width:100%;max-width:420px;padding:34px 36px 30px;border-radius:24px;text-align:center;
                background:linear-gradient(135deg,rgba(5,48,132,.86) 0%,rgba(31,91,190,.62) 55%,rgba(105,151,226,.40) 100%);
                border:1px solid rgba(255,255,255,.26);box-shadow:0 22px 50px rgba(3,25,89,.35);
                backdrop-filter:blur(10px) saturate(115%);-webkit-backdrop-filter:blur(10px) saturate(115%);">
      <div style="width:150px;height:64px;margin:0 auto 18px;border-radius:14px;background:#fff;padding:8px 12px;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(3,25,89,.30);">
        <img src="assets/logo.png" alt="Loan It Financing" style="width:100%;height:100%;object-fit:contain;" />
      </div>
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:600;">Admin sign-in</h2>
      <p style="margin:0 0 20px;color:rgba(239,245,255,.92);font-size:14px;line-height:1.55;">Sign in with the doxservices Google account to continue to the admin area.</p>
      <button id="admin-auth-signin" type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px 20px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:12px;color:#172033;border:1px solid rgba(255,255,255,.18);background:linear-gradient(180deg,#f1c75a,#dfa938);box-shadow:0 8px 18px rgba(96,65,8,.18);">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.8 38 46.5 31.8 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-3.9-13.5-9.3l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        Sign in with Google
      </button>
      <div id="admin-auth-msg" style="color:#ff9a9a;font-size:13px;margin-top:14px;min-height:16px;font-weight:600;"></div>
      <p style="margin:18px 0 0;font-size:12px;color:rgba(228,237,255,.78);"><a href="index.html" style="color:#efc352;text-decoration:none;font-weight:600;">&larr; Back to Loan It Financing</a></p>
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
