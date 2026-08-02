# Handover — Loanapp / Loanit — 2026-08-01, updated 2026-08-02

This file exists so a future AI session (or human) can pick up work without re-discovering
context. It sits inside `variants/loanit` (the real Loanit rewrite, as opposed to
`variants/loanit-gh-pages`, which is just a static clone of the marketing/form page), but
most of what it describes concerns the **live app at the repo root**
(`App Development/Loanapp/`), since that's what currently runs.

## READ THIS FIRST — 2026-08-02: migrated to Firebase (Hosting + Functions + Firestore + Storage)

**Everything below the "What's been done this session" (2026-08-01) heading describes the
Express-on-a-VM / Render-Postgres architecture. That architecture is retired.** The user
asked to "migrate all functions to firebase and firestore, and shut down Render and other
parts of the stack we don't need." That's done. Current architecture:

```
Browser
  │
  ├─▶ Firebase Hosting (https://doxservices-loanapp.web.app) — serves public/*.html
  │     directly (static, free, no cold start) for everything NOT listed below
  │
  └─▶ Hosting rewrites (see firebase.json) route these paths to one Cloud Function:
        /admin.html, /admin-applications.html, /admin-nav.html,
        /admin-standing-orders.html, /applications-list.html,
        /auth/**, /api/**, /uploads/**, /standing-orders, /applications, /health
        │
        ▼
      Cloud Function `api` (functions/index.js, Node 20, 2nd gen, us-central1)
        — one Express app wrapped in `onRequest`, same auth logic as before
          (Google Sign-In session cookie for admin.html, Basic Auth for the other
          4 admin pages, `flexibleAdminAuth` accepts either on shared endpoints)
        │
        ├─▶ Firestore (native mode, project doxservices-loanapp, region nam5)
        │     collections: `standingOrders`, `applications`, `promotions`
        │
        └─▶ Cloud Storage bucket `doxservices-loanapp-uploads`
              (NOT the reserved `doxservices-loanapp.firebasestorage.app` name —
              that name is Firebase-reserved and creating it hit a domain-ownership
              wall; used a plain bucket name instead, works identically via the
              Admin SDK's `getStorage().bucket('doxservices-loanapp-uploads')`)
              photo IDs / payslips, proxied back through GET /uploads/:appDir/:file
              (kept private; served through the Function so PII isn't a public URL)
```

**Everything that used to live in root `server.js` now lives in `functions/index.js`**,
rewritten against Firestore/Storage instead of Postgres/local-disk/JSON. It also absorbed
the **full loan-application feature set** (promotions CRUD, applicant CRUD by id/TRN,
attachments, messaging, review flags) that previously only existed in this
`variants/loanit` folder's JSON-file-backed `src/server.js` — that logic has been ported
onto Firestore and now backs new pages copied into the root `public/`:
`admin-dashboard.html`, `admin-promotions.html`, `applicant-edit.html`, `status.html`,
`styles.css`, `user-apply.html`, `user-edit.html`, `user-management.html`,
`user-profile.html`. (3 filenames collided with existing root pages tied to the old flat
Postgres model — `admin-applications.html`, `applications-list.html`, `index.html` — those
were **not** overwritten; the root versions stayed, now backed by Firestore instead.)

**Infrastructure provisioned** (as `doxcorp.services@gmail.com`, via `gcloud`/`firebase`
CLI, non-interactively except where noted):
- GCP/Firebase project `doxservices-loanapp` (created 2026-08-01, same session as the
  Google Sign-In work — see the dated section below).
- Firestore native-mode database, region `nam5`. A composite index
  (`applicant.trn` ASC + `createdAt` DESC) is required for the TRN-lookup query and is
  defined in `firestore.indexes.json` — deployed already, but if you ever add a new
  `.where(...).orderBy(...)` combo on a different field pair, Firestore will reject the
  query with a console link to create the missing index; add it to that file and redeploy.
- Cloud Storage bucket `doxservices-loanapp-uploads`, with `roles/storage.objectAdmin`
  granted to the Functions runtime service account
  (`doxservices-loanapp@appspot.gserviceaccount.com`) via IAM (not Firebase Storage
  Security Rules — `storage.rules` is default-deny and irrelevant here, since the Function
  talks to Storage via the Admin SDK, which IAM governs, not client-facing security rules).
- **Billing was linked** — Cloud Functions (2nd gen) requires a Blaze-plan billing account
  even to stay within the free tier, because it depends on Cloud Build + Artifact Registry.
  Linked existing billing account `017455-2E74C1-59E10A` ("Firebase Payment") — the user
  chose this one out of three existing accounts when asked. **This means the project can
  now incur real charges** if usage ever exceeds the free tier (unlikely at this app's
  scale, but worth knowing). A cleanup policy was set for Cloud Build's container images
  (auto-delete after 1 day) to avoid Artifact Registry storage creeping up for no reason.
- `firestore.rules` / `storage.rules` are both default-deny — intentional, since 100% of
  data access goes through the Function's Admin SDK, which bypasses security rules
  entirely. If direct client-side Firestore/Storage SDK access is ever added (e.g. for
  realtime updates without polling), these rules need real logic at that point — right now
  they're just defense-in-depth against a future mistake, not doing any actual gating.

**Firestore was seeded** with the 7 promotions that used to live in
`variants/loanit/storage/data/promotions.json` (`scripts/seed-firestore.js` — safe to
re-run, it no-ops if the `promotions` collection isn't empty). **These read as demo/seed
data from the original MVP build** (round numbers, generic names like "Starter 30") —
they were never confirmed as real production loan terms. Whoever owns the business side
should review them via `admin-promotions.html` (Basic Auth) and edit/replace as needed.

**Deployed and smoke-tested live** (`https://doxservices-loanapp.web.app`), then the
test data was cleaned out of production Firestore/Storage afterward:
- Static homepage serves via Hosting ✓
- `/api/parishes`, `/api/promotions` ✓
- `/admin.html` with no session → login page (not the dashboard) ✓
- `/admin-applications.html` with no Basic Auth → 401 ✓
- `POST /standing-orders` (public) → Firestore write ✓, `GET /standing-orders` (Basic Auth) → reads it back ✓
- `POST /api/applications` → create, `GET /api/applications/trn/:trn` → lookup,
  `PATCH /api/applications/:id` with a message + a base64 photo attachment → Cloud Storage
  write + Firestore update, `GET /applications` (flat legacy view) reflects it,
  `GET /uploads/app-:id/:file` (Basic Auth) streams the file back ✓ — full loop works.

**Local dev now uses the Firebase emulator suite, not `node server.js`:**
```bash
export GOOGLE_APPLICATION_CREDENTIALS=.secrets/firebase-adminsdk.json
firebase emulators:start --only functions,firestore,hosting,storage
```
(`.secrets/firebase-adminsdk.json` is the same service-account key from the Google
Sign-In work below — gitignored, ask whoever has it if it's missing.)

**Cleanup — done, with explicit user approval after the fact:** the first pass hit the
harness's permission classifier (destructive-action guard) on a bare `rm`; the user then
explicitly approved it and it went through on retry.
- Deleted: root `server.js`, `schema.sql`, `.env.render` (the old Express+Postgres app,
  fully superseded by `functions/index.js`), plus three pre-consolidation orphan files at
  repo root that were never served by Express in the first place (confirmed via diff
  against the `public/` versions): `index.html`, `admin-applications.html`,
  `applications-list.html`.
- `public/apply-legacy.html` and `public/test.html` were deleted earlier in the same
  session (tied to the retired `/apply` Postgres endpoint).
- Root `package.json` trimmed to drop `express`/`pg`/`dotenv` (nothing left to use them
  now) — kept `firebase-admin` only, since `scripts/seed-firestore.js` needs it. Lockfile
  regenerated to match (`npm install`, 68 packages removed).

**Render**: the Postgres database there was already dead (free-tier expiry) before this
session — nothing currently depends on it. The Render *service* itself (if one still
exists in the Render dashboard) still needs to be deleted from Render's dashboard
directly — no API credentials for Render were available in this session to do it via
CLI/API; this is the one item the user has to do by hand.

**Git**: `origin` now points at `https://github.com/doxservices/loanapp.git` (was
`xhemmings/loanapp` — that repo was transferred to `doxservices/loanapp` earlier in this
session; see the dated section below). Connectivity confirmed via `git ls-remote`. This
session's Firebase migration work is committed and pushed to `main` — see the commit log
for the exact commit if you need the hash.

## Update — 2026-08-02, later: moved to doxservices.com/loanit-financing/, auth reworked for cross-origin

The user wanted the app reachable from **`doxservices.com/loanit-financing/`**, not the
Firebase `.web.app` URL or GitHub Pages' own `.github.io` domain. `doxservices.com` turned
out to already be GitHub Pages itself (confirmed via `nslookup` — resolves to GitHub's
Pages IPs, `Server: GitHub.com`, custom domain `www.doxservices.com` via a `CNAME` file) —
it's the **`doxservices/doxservices`** repo, a plain static site with an existing
`transformation/` folder as precedent for "one subfolder = one product section." So:

- All of this app's static pages now live at **`doxservices/doxservices` → `/loanit-financing/`**
  (pushed there, not to `doxservices/loanapp`). `doxservices/loanapp`'s `public/` folder
  is kept as a staging mirror only, still served at `doxservices-loanapp.web.app` for
  testing changes before pushing the real copy to the site repo — there is no automated
  sync between the two; changes need to be made/copied to both by hand (or scripted later).
- **This forced an auth rework.** GitHub Pages can't run Cloud Functions, so the frontend
  (`doxservices.com`) and backend (`doxservices-loanapp.web.app`, Cloud Functions) are
  permanently different origins. The cookie-based Google session built earlier the same
  day would not have survived that reliably (modern browsers increasingly block/partition
  third-party cookies — Safari ITP, Firefox ETP, Chrome's ongoing phase-out). Fixed by
  switching to **Bearer-token auth**: the client keeps its Firebase ID token (via the
  Firebase SDK's own session, `onAuthStateChanged`) and sends `Authorization: Bearer
  <token>` on every request; the server (`functions/index.js`) verifies it fresh on every
  single call — no cookie, no server-side session state at all.
- **HTTP Basic Auth was dropped entirely**, per the user's choice when asked. All 5
  previously-mixed-auth admin pages (`admin.html`, `admin-applications.html`,
  `admin-nav.html`, `admin-standing-orders.html`, `applications-list.html`) now use the
  same Google Sign-In gate, via a new shared script: **`public/admin-auth.js`** (copied
  into `loanit-financing/` too). It renders a "Sign in with Google" overlay if not
  authenticated as `doxcorp.services@gmail.com`, and exposes `window.adminAuth.fetch(path,
  opts)` — same as plain `fetch` but auto-attaches the Bearer token and prefixes the
  Firebase API base URL. New endpoint `GET /auth/verify` lets the client confirm "am I
  signed in as the right account" independent of any specific data call.
- **CORS added** to `functions/index.js` (was not needed before — same-origin). Allow-list
  lives in `functions/.env` → `CORS_ORIGINS` (currently: `www.doxservices.com`,
  `doxservices.com`, the Firebase staging URL, and two localhost ports for local testing).
- **New shared file `public/api-base.js`** (also copied to `loanit-financing/`): sets
  `window.LOANIT_API_BASE = 'https://doxservices-loanapp.web.app'`. Every page that talks
  to the API (`index.html`, `applicant-edit.html`, `status.html`, and all 5 admin pages)
  now builds absolute URLs against this instead of relative paths like `/api/...` — those
  would otherwise resolve against `doxservices.com` itself (wrong host) once the pages
  moved out of the same origin as the backend.
- **All root-relative asset paths fixed** (`/analytics.js` → `analytics.js`, etc.) across
  every page — they now live in a subfolder (`/loanit-financing/`) on the site, so an
  absolute `/xxx` path would incorrectly resolve against the site root instead of the
  subfolder. `admin-nav.html` also got its stale links fixed (it pointed at
  `/apply-legacy.html` and `/test.html`, both deleted earlier the same day) and now links
  to the real page set, including the ones from the "full loan-application feature set"
  work (`user-apply.html`, `status.html`, `admin-promotions.html`, etc.) that weren't in
  its catalog before.
- `firebase.json` hosting rewrites trimmed to API-only paths (`/auth/**`, `/api/**`,
  `/uploads/**`, `/standing-orders`, `/applications`, `/health`) — no more page-path
  rewrites, since the Function no longer serves any HTML at all (that was only ever needed
  to gate Basic-Auth/cookie pages server-side; with Bearer tokens, gating is 100%
  client-side + API-side, so plain static files work fine).
- **Deployed and smoke-tested for real**, including actual CORS preflight/response headers
  against `Origin: https://www.doxservices.com` (not just localhost) and a live
  cross-origin `POST /standing-orders` + `GET /api/promotions` from that exact origin —
  both confirmed working, then the smoke-test record was deleted from Firestore
  afterward. Live URLs:
  - **https://www.doxservices.com/loanit-financing/** — the real, user-facing site
  - https://doxservices-loanapp.web.app — Firebase staging mirror + the actual API backend

**Still outstanding — same manual step as before, not yet done as of this update:** the
Google sign-in provider still needs to be enabled once in the Firebase Console
(https://console.firebase.google.com/project/doxservices-loanapp/authentication/providers
→ Get started → enable Google → Save). Until that happens, `signInWithPopup` will fail
client-side with `auth/operation-not-allowed` on every admin page. This could not be
verified end-to-end in this session since it requires an actual interactive Google OAuth
popup in a real browser — everything else (CORS, Bearer verification, the `/auth/verify`
endpoint, page routing) was tested up to that point via curl with forged/garbage tokens
behaving correctly (401/403 as expected), but the *real* sign-in flow itself needs a human
in a browser to complete for the first time.

## Where things are, top to bottom

```
App Development/Loanapp/            <- the live app (this is what `node server.js` runs)
  server.js                         <- Express server: /apply, /applications, /health,
                                        /standing-orders, adminAuth() middleware
  public/
    index.html                      <- HOMEPAGE. Imported from github.com/doxservices/loanit
                                        (the "Standing Order Authorization" form). Posts to
                                        POST /standing-orders on submit.
    apply-legacy.html                <- the old Postgres-backed loan-application form (was
                                        the homepage before the loanit import)
    admin.html                       <- admin: applications table          } all behind
    admin-applications.html          <- admin: applications (alt view)     } adminAuth()
    admin-nav.html                   <- admin: links to every page/endpoint} HTTP Basic Auth,
    admin-standing-orders.html       <- admin: standing-order submissions  } see below
    applications-list.html           <- admin: list viewer                 }
    analytics.js                     <- shared Google tag (gtag.js) include, G-6VTM5DBDXJ
  storage/data/standing-orders.json  <- gitignored. Real applicant data lands here.
  .env                                <- gitignored. DATABASE_URL, PORT, ADMIN_USER, ADMIN_PASSWORD
  variants/                          <- other loan-app copies, kept for reference/salvage
    loanit/            (you are here) <- most-evolved rewrite: local JSON storage, no DB
    loanit-gh-pages/                  <- pristine clone of doxservices/loanit as imported
    test/, test2/                     <- earlier experiments
    loan-system-safe-snapshot/        <- an older loan-system snapshot, kept as-is
```

Latest commit on `main` as of this handover: `c9f870b`
("Import doxservices/loanit as the new home page; add standing-order tracking and admin lock").

## What's been done this session

1. Consolidated every loan-related project (Desktop\loanapp, Desktop\loan-system /
   `Loanit`, Desktop\test, Desktop\test2, Desktop\safe\loan-system) into this one folder,
   with git history imported from `github.com/xhemmings/loanapp`. See
   `../../README-CONSOLIDATION.md` for that part.
2. Added `public/admin-nav.html` — one page linking every page and API route.
3. Added the Google Analytics tag as a shared include (`public/analytics.js`), inserted on
   every page right after `<head>`.
4. Imported `doxservices/loanit`'s standing-order form as the new homepage
   (`public/index.html`), keeping the old form at `public/apply-legacy.html`.
5. Wired form completion to record a copy of the submission server-side:
   `recordSubmission()` in `index.html` → `POST /standing-orders` → written to
   `storage/data/standing-orders.json`. That path (and `.env`) is gitignored — applicant
   PII (names, account numbers, phone numbers, bank details) never reaches GitHub.
6. Locked every admin page and the `/applications` + `/standing-orders` GET endpoints
   behind HTTP Basic Auth (`adminAuth()` in `server.js`), currently username `doxservices`
   with a random password stored in `.env` only.

## Update — 2026-08-01 (later the same day): Google Sign-In on /admin.html — built, one manual step left

Decisions made with the user (via AskUserQuestion, not guessed):
- Approach: **Firebase Authentication**, Google provider (not plain OAuth).
- Basic Auth is **fully removed** on `/admin.html` once Google Sign-In works (no fallback).
- Scope: **just `/admin.html`** for now. The other four admin pages
  (`admin-applications.html`, `admin-nav.html`, `admin-standing-orders.html`,
  `applications-list.html`) still use the original HTTP Basic Auth — untouched.
- Allowed identity: **`doxcorp.services@gmail.com`** — confirmed with the user; this is
  also the account `gcloud` on this machine is already authenticated as.

What was provisioned (via `gcloud`/REST, `doxcorp.services@gmail.com` account):
- New GCP project **`doxservices-loanapp`**, Firebase added to it.
- A Firebase Web App registered; its client config lives in `public/firebase-config.js`
  (this is a public identifier, not a secret — normal Firebase practice).
- A `firebase-adminsdk-fbsvc@doxservices-loanapp.iam.gserviceaccount.com` service account,
  with its key saved to `.secrets/firebase-adminsdk.json` (gitignored, never commit).

What was built in `server.js` (the live app, not this `variants/loanit` folder):
- `POST /auth/google` — client sends a Firebase ID token (from `signInWithPopup` +
  `GoogleAuthProvider`); server verifies it with `firebase-admin`
  (`firebase-admin/app` + `firebase-admin/auth`, **not** the old `admin.credential.cert()`
  / `admin.auth()` shape — v14 moved those to modular imports), checks
  `email_verified && email === ALLOWED_ADMIN_EMAIL`, then sets a signed, httpOnly session
  cookie (`admin_session`, HMAC-SHA256 over `SESSION_SECRET`, 12h expiry, no session store
  needed — stateless).
- `POST /auth/logout` — clears the cookie.
- `googleAdminAuth` middleware on `/admin.html` — valid session → serves the real page;
  otherwise serves an inline "Sign in with Google" page (Firebase modular SDK loaded from
  the `gstatic.com` CDN via `<script type="module">`, no bundler).
- `flexibleAdminAuth` on the shared `GET /applications` data endpoint — accepts **either**
  a valid Google session **or** Basic Auth, since both `admin.html` (Google-only now) and
  `admin-applications.html` (still Basic Auth) call the same endpoint.
- `.env` gained `ALLOWED_ADMIN_EMAIL`, `SESSION_SECRET`, `FIREBASE_SERVICE_ACCOUNT_PATH`.
- Tested locally: cookie forged with the real `SESSION_SECRET` → unlocks `/admin.html`;
  tampered signature / expired / wrong email → all correctly fall back to the login page;
  `/auth/google` with a garbage token correctly 401s (proves `firebaseAuth.verifyIdToken`
  is actually wired up, not silently no-op'd); logout clears the cookie. Full real-Google
  sign-in was **not** tested end-to-end — see the manual step below.

**One manual step remains, and it cannot be done via API** (Firebase Console does this
through an internal flow with no public equivalent; the raw Identity Toolkit API demands a
pre-existing OAuth client, and the API that provisions those — IAP OAuth brands — is
deprecated and being shut down March 2026, so scripting around it isn't worth it):

1. Go to https://console.firebase.google.com/project/doxservices-loanapp/authentication/providers
   (sign in as `doxcorp.services@gmail.com`).
2. Click **Get started** on Authentication if this is the first visit, then enable the
   **Google** provider, click Save. That's it — no OAuth consent screen fields to fill in
   for this internal/basic use case.
3. Restart `node server.js` if it's already running (picks up nothing new, just a sanity
   restart) and load `/admin.html` in a browser — the "Sign in with Google" button should
   now complete instead of failing with `auth/operation-not-allowed`.

Also worth doing, not done yet:
- `git remote -v` in the repo root still points at `https://github.com/xhemmings/loanapp.git`.
  That repo was **transferred to `doxservices/loanapp`** earlier (GitHub redirects the old
  URL for now, so pushes still work, but it should be repointed:
  `git remote set-url origin https://github.com/doxservices/loanapp.git`).
- 4 local commits (as of this update) are still unpushed (`git log origin/main..HEAD`).
- If the Firebase migration proceeds further, Firestore under this same
  `doxservices-loanapp` project is a natural next step for `storage/data/standing-orders.json`.

## Other loose ends worth knowing about

- The Render Postgres database (`.env` → `DATABASE_URL`) backing `apply-legacy.html` /
  `admin.html` appears to be **dead** — `/health` (and `/applications` when auth passes)
  return a connection error. It was created ~August 2025 and Render's free tier expires
  databases after ~90 days.
- `variants/loanit` (this folder) is a fully separate Express app with its own
  `src/server.js` and **no external database** — it stores everything in
  `storage/data/*.json` locally. If the Firebase migration doesn't land soon, this is the
  most self-contained variant to build on.
- The `Github Projects\loanapp` folder on the Desktop (outside `App Development`) is a
  now-redundant leftover — its `.git` was moved into this repo and the remaining files
  matched `HEAD` exactly at the time. Safe to delete, was never auto-removed due to a
  permission block.
