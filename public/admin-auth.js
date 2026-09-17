// Shared Google Sign-In gate for all admin pages, cross-origin safe (Bearer
// token, no cookies). Include after firebase-config.js:
//   <script src="firebase-config.js"></script>
//   <script type="module" src="admin-auth.js"></script>
// Then call window.adminAuth.ready() before rendering, and use
// window.adminAuth.fetch(path, opts) instead of bare fetch() for API calls.
//
// Navigation is not decided here. The server works out which nav entries this
// account may see, from the permission each entry names, and sends that list
// with the profile. This file renders exactly that list — it never renders a
// full menu and then takes items away, which is what used to make options
// flash on screen. The list is remembered between visits so the first paint
// of the next page is already right.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const API_BASE = window.LOANIT_API_BASE || 'https://doxservices-loanapp.web.app';
const fbApp = initializeApp(window.FIREBASE_CONFIG);
const auth = getAuth(fbApp);
// The sign-in itself outlives the tab, so closing the browser does not mean
// signing in again.
setPersistence(auth, browserLocalPersistence).catch(err =>
  console.error('[admin-auth] could not persist the sign-in', err));

// One signed-in session, kept until the expiry the server states. Moving
// between admin pages reads this instead of verifying again — every API call
// is still verified on its own, so this only decides how quickly a change of
// access reaches the menus, and a background refresh keeps that short.
const SESSION_KEY = 'adminSession';
const ROLE_KEY = 'adminRole';   // kept for the CSS hook on <html>

let currentRole = null;
let currentPermissions = null;
let currentNav = null;
let gatedPages = [];
let session = null;

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pageName = () => location.pathname.split('/').pop() || 'index.html';

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!raw) return;
    session = raw;
    currentRole = raw.role || null;
    currentPermissions = Array.isArray(raw.permissions) ? raw.permissions : null;
    currentNav = Array.isArray(raw.nav) ? raw.nav : null;
    gatedPages = Array.isArray(raw.gatedPages) ? raw.gatedPages : [];
  } catch (e) { /* private window, or nothing stored yet */ }
}
function writeCache() {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session || {}));
    if (currentRole) localStorage.setItem(ROLE_KEY, currentRole);
  } catch (e) { /* private window */ }
}
function clearCache() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(ROLE_KEY); } catch (e) {}
}
// A session is usable while it has not expired and belongs to the account
// that is actually signed in.
function sessionUsableFor(uid) {
  return !!(session && session.uid === uid && session.expiresAt &&
    Date.parse(session.expiresAt) > Date.now() && Array.isArray(session.nav));
}
readCache();
// Before the sidebar is built, so the very first paint is already correct.
if (currentRole) document.documentElement.setAttribute('data-admin-role', currentRole);

// These links are rendered by this file, so their appearance comes with them.
// The admin pages do not share one stylesheet — the sidebar pages carry their
// own CSS and never defined .nav-btn — so relying on a class the page might
// style left them as bare underlined links. The palette matches the theme
// toggle, which already sits correctly on every admin page.
function injectNavStyles() {
  if (document.getElementById('admin-nav-styles')) return;
  const css = document.createElement('style');
  css.id = 'admin-nav-styles';
  css.textContent = [
    '.admin-quicklink{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;',
    'border-radius:8px;font-size:13px;font-weight:600;line-height:1;text-decoration:none;',
    'background:#f2f8ff;color:#0a4f8b;border:1px solid #b9d8f2;transition:background .16s ease;}',
    '.admin-quicklink:hover{background:#e4f0fd;text-decoration:none;}',
    '.admin-quicklink i{font-size:12px;opacity:.85;}',
    ':root[data-theme="dark"] .admin-quicklink{background:rgba(13,62,164,.70);',
    'color:rgba(255,255,255,.97);border-color:rgba(205,226,255,.20);}',
    ':root[data-theme="dark"] .admin-quicklink:hover{background:rgba(13,62,164,.92);}',
    '.admin-role-pill{align-self:center;padding:6px 12px;border-radius:999px;font-size:12px;',
    'font-weight:700;background:rgba(15,111,190,.12);color:#0a4f8b;border:1px solid rgba(15,111,190,.30);}',
    ':root[data-theme="dark"] .admin-role-pill{background:rgba(205,226,255,.14);',
    'color:rgba(255,255,255,.92);border-color:rgba(205,226,255,.24);}'
  ].join('');
  document.head.appendChild(css);
}

// Renders the sidebar and the header links from the nav list. Called by
// admin-shell.js once it has built the shell, and again if the server's
// answer differs from what was remembered.
function renderNav() {
  if (!Array.isArray(currentNav)) return;
  injectNavStyles();
  const page = pageName();

  const side = document.querySelector('.sidebar .nav-links');
  if (side) {
    side.innerHTML = currentNav.map(i =>
      `<li><a href="${esc(i.href)}"${i.href === page ? ' class="active"' : ''}>` +
      `<i class="fas ${esc(i.icon)}"></i> ${esc(i.label)}</a></li>`).join('');
  }

  // The header carries a few of the same links, so every admin page offers the
  // same set rather than whatever was hard-coded into its markup.
  const bar = document.querySelector('.top-bar .user-info');
  if (bar) {
    const quick = currentNav.filter(i => i.href !== page && i.key !== 'logout').slice(0, 3);
    bar.innerHTML = quick.map(i =>
      `<a href="${esc(i.href)}" class="admin-quicklink"><i class="fas ${esc(i.icon)}"></i> ${esc(i.label)}</a>`).join('');
    if (currentPermissions && !currentPermissions.includes('records.edit')) {
      const pill = document.createElement('span');
      pill.id = 'admin-role-pill';
      pill.className = 'admin-role-pill';
      pill.textContent = 'View only';
      bar.insertBefore(pill, bar.firstChild);
    }
  }
  document.documentElement.setAttribute('data-nav-ready', '1');
}
window.__renderAdminNav = renderNav;

// A page the nav governs, that this account's nav does not include, is not
// theirs to open. Rather than bouncing them somewhere else — which loses the
// address they typed and gives no reason — the page stays put behind a modal
// that says so, offers the pages they can open, and lets them sign in as
// somebody else. Pages outside the nav registry (the public forms, the
// contract) are left alone.
function renderNoAccess() {
  if (document.getElementById('admin-denied')) return;
  injectNavStyles();

  const style = document.createElement('style');
  style.textContent = [
    '#admin-denied{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;',
    'justify-content:center;padding:20px;background:rgba(6,18,42,.72);',
    "font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;backdrop-filter:blur(3px);}",
    '#admin-denied .card{width:100%;max-width:440px;background:#fff;color:#16202a;border-radius:16px;',
    'padding:26px 28px;box-shadow:0 24px 60px rgba(3,25,89,.34);text-align:left;}',
    ':root[data-theme="dark"] #admin-denied .card{background:#10203a;color:rgba(255,255,255,.95);}',
    '#admin-denied h2{margin:0 0 8px;font-size:19px;}',
    '#admin-denied p{margin:0 0 14px;font-size:14px;line-height:1.55;opacity:.85;}',
    '#admin-denied .who{font-weight:700;}',
    '#admin-denied .go{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;}',
    '#admin-denied .actions{display:flex;flex-wrap:wrap;gap:10px;}',
    '#admin-denied button{font:inherit;font-size:13px;font-weight:600;padding:10px 15px;',
    'border-radius:8px;cursor:pointer;border:1px solid #b9d8f2;background:#f2f8ff;color:#0a4f8b;}',
    '#admin-denied button.primary{background:linear-gradient(180deg,#f1c75a,#dfa938);',
    'border-color:#b8912f;color:#1f2430;}',
    ':root[data-theme="dark"] #admin-denied button{background:rgba(13,62,164,.7);',
    'color:rgba(255,255,255,.95);border-color:rgba(205,226,255,.2);}'
  ].join('');

  const el = document.createElement('div');
  el.id = 'admin-denied';
  const links = (currentNav || []).filter(i => i.key !== 'logout');
  el.innerHTML =
    '<div class="card" role="dialog" aria-modal="true" aria-labelledby="admin-denied-title">' +
      '<h2 id="admin-denied-title">This page is not part of your access</h2>' +
      '<p>You are signed in as <span class="who">' + esc((session && session.email) || 'this account') +
      '</span>, which does not include this page. Nothing has gone wrong — it is simply not yours to open.</p>' +
      (links.length
        ? '<p>Pages you can open:</p><div class="go">' + links.map(i =>
            '<a class="admin-quicklink" href="' + esc(i.href) + '">' +
            '<i class="fas ' + esc(i.icon) + '"></i> ' + esc(i.label) + '</a>').join('') + '</div>'
        : '<p>There are no admin pages open to this account.</p>') +
      '<div class="actions">' +
        '<button type="button" class="primary" id="admin-denied-switch">Sign in as someone else</button>' +
        '<button type="button" id="admin-denied-back">Go back</button>' +
      '</div>' +
    '</div>';

  document.head.appendChild(style);
  document.body.appendChild(el);
  document.getElementById('admin-denied-switch').addEventListener('click', () => window.adminAuth.signOut());
  document.getElementById('admin-denied-back').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else if (links.length) location.href = links[0].href;
  });
}

function gatePage() {
  if (!Array.isArray(currentNav) || !gatedPages.length) return true;
  const page = pageName();
  if (!gatedPages.includes(page)) return true;
  if (currentNav.some(i => i.href === page)) return true;
  renderNoAccess();
  return false;
}

function applyProfile(json, uid) {
  const before = JSON.stringify([currentPermissions, currentNav]);
  currentRole = json.role || currentRole || 'superAdmin';
  if (Array.isArray(json.permissions)) currentPermissions = json.permissions;
  if (Array.isArray(json.nav)) currentNav = json.nav;
  if (Array.isArray(json.gatedPages)) gatedPages = json.gatedPages;
  session = {
    uid: uid || (session && session.uid) || null,
    email: json.email || (session && session.email) || null,
    role: currentRole,
    permissions: currentPermissions || [],
    nav: currentNav || [],
    gatedPages: gatedPages || [],
    // If the server does not say, trust it for a day.
    expiresAt: json.sessionExpiresAt || new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  };
  document.documentElement.setAttribute('data-admin-role', currentRole);
  writeCache();
  // Redraw only if what was remembered turned out to be wrong.
  if (before !== JSON.stringify([currentPermissions, currentNav])) renderNav();
  else document.documentElement.setAttribute('data-nav-ready', '1');
  return gatePage();
}

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
      <p style="margin:0 0 20px;color:rgba(239,245,255,.92);font-size:14px;line-height:1.55;">Sign in with an authorized Google account to continue to the admin area.</p>
      <button id="admin-auth-signin" type="button" style="display:inline-flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:13px 20px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:12px;color:#172033;border:1px solid rgba(255,255,255,.18);background:linear-gradient(180deg,#f1c75a,#dfa938);box-shadow:0 8px 18px rgba(96,65,8,.18);">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.4 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8C43.8 38 46.5 31.8 46.5 24.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.6-2 15.4-5.6l-7.5-5.8c-2.1 1.4-4.8 2.3-7.9 2.3-6.3 0-11.6-3.9-13.5-9.3l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        Sign in with Google
      </button>
      <div id="admin-auth-msg" style="color:#ff9a9a;font-size:13px;margin-top:14px;min-height:16px;font-weight:600;"></div>
      <p style="margin:18px 0 0;font-size:12px;color:rgba(228,237,255,.78);"><a href="tenant-home.html" style="color:#efc352;text-decoration:none;font-weight:600;">&larr; Back to your lender</a></p>
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
      if (json.ok) { applyProfile(json, result.user.uid); overlay.remove(); onReady(); return; }
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

// Asks the server who this is, and puts the answer away as the session.
async function verifyNow(user) {
  const idToken = await user.getIdToken();
  const res = await fetch(API_BASE + '/auth/verify', { headers: { Authorization: 'Bearer ' + idToken } });
  const json = await res.json();
  if (json.ok) currentToken = idToken;
  return json;
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearCache();
    document.getElementById('admin-auth-overlay') || renderGate();
    return;
  }

  // Already signed in, within the session the server granted: open the page
  // straight away and confirm in the background. Navigation between admin
  // pages therefore costs nothing, while a change of access still lands on
  // the next page load rather than at the end of the day.
  if (sessionUsableFor(user.uid)) {
    renderNav();
    if (gatePage()) readyResolve();
    verifyNow(user).then(json => {
      if (json && json.ok) { applyProfile(json, user.uid); return; }
      // Access was taken away while the session was still valid.
      clearCache();
      signOut(auth);
    }).catch(err => {
      // Offline or the API is down: the session stands until it expires.
      console.warn('[admin-auth] background check did not complete', err);
    });
    return;
  }

  try {
    const json = await verifyNow(user);
    if (json.ok) {
      const overlay = document.getElementById('admin-auth-overlay');
      if (overlay) overlay.remove();
      // False means a redirect is under way; leave the page as it is.
      if (applyProfile(json, user.uid)) readyResolve();
      return;
    }
  } catch (err) {
    console.error('[admin-auth] verify failed', err);
  }
  // Signed in, but not an authorized account (or verify failed) — show the
  // gate and sign this identity out so a retry starts clean.
  clearCache();
  await signOut(auth);
  document.getElementById('admin-auth-overlay') || renderGate();
});

window.adminAuth = {
  ready: () => readyPromise,
  get role() { return currentRole; },
  get permissions() { return currentPermissions; },
  get nav() { return currentNav; },
  can: id => !currentPermissions || currentPermissions.indexOf(id) > -1,
  get viewOnly() { return !!currentPermissions && currentPermissions.indexOf('records.edit') === -1; },
  fetch: async (path, opts = {}) => {
    const user = auth.currentUser;
    const idToken = user ? await user.getIdToken() : currentToken;
    const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + idToken };
    return fetch(API_BASE + path, { ...opts, headers });
  },
  get session() { return session; },
  signOut: async () => {
    clearCache();
    await signOut(auth);
    location.reload();
  },
  apiBase: API_BASE
};

// The header exists in the page's own markup, so it can be filled before the
// shell is built.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderNav);
else renderNav();
