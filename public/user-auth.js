// Google sign-in for customers. Unlike admin-auth.js, which only admits
// allow-listed admin accounts, any verified Google account is welcome here —
// the server creates a user record the first time it sees one, so a ticket
// always has an owner.
//
// Include after firebase-config.js:
//   <script src="firebase-config.js"></script>
//   <script type="module" src="user-auth.js"></script>
// Then await window.userAuth.ready(), and listen for the 'user-auth' event,
// which fires whenever the signed-in person changes.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const API_BASE = window.LOANIT_API_BASE || '';
const auth = getAuth(initializeApp(window.FIREBASE_CONFIG));

let me = null;
let settle;
const first = new Promise(resolve => { settle = resolve; });
let settled = false;

function announce() {
  if (!settled) { settled = true; settle(me); }
  window.dispatchEvent(new CustomEvent('user-auth', { detail: me }));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { me = null; announce(); return; }
  try {
    const token = await user.getIdToken();
    const res = await fetch(API_BASE + '/api/me', { headers: { Authorization: 'Bearer ' + token } });
    const json = await res.json();
    me = json && json.ok ? json : null;
  } catch (err) {
    console.error('[user-auth] could not load the signed-in person', err);
    me = null;
  }
  announce();
});

window.userAuth = {
  ready: () => first,
  get me() { return me; },
  signIn: () => signInWithPopup(auth, new GoogleAuthProvider()),
  signOut: async () => { await signOut(auth); location.reload(); },
  fetch: async (path, opts = {}) => {
    const user = auth.currentUser;
    const token = user ? await user.getIdToken() : null;
    return fetch(API_BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    });
  }
};
