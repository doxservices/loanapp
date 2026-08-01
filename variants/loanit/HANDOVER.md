# Handover — Loanapp / Loanit — 2026-08-01

This file exists so a future AI session (or human) can pick up work without re-discovering
context. It sits inside `variants/loanit` (the real Loanit rewrite, as opposed to
`variants/loanit-gh-pages`, which is just a static clone of the marketing/form page), but
most of what it describes concerns the **live app at the repo root**
(`App Development/Loanapp/`), since that's what currently runs.

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

## Open intent — NOT implemented yet: Google Sign-In on /admin.html

**The ask:** replace (or front) the current HTTP Basic Auth on `/admin.html` — and
presumably the other admin pages — with **"Sign in with Google," restricted to the
doxservices Google account specifically.** Not open to any Google user — only that one
identity should be let in.

This has **not been built**. Current state is still plain Basic Auth
(`ADMIN_USER` / `ADMIN_PASSWORD` in `.env`). Whoever picks this up next needs to implement
the Google login flow. Two reasonable paths, given the user has also said the backend is
migrating to **Firebase**:

- **Firebase Authentication, Google provider** (recommended, since it aligns with the
  planned Firebase backend migration). Client calls
  `signInWithPopup(auth, new GoogleAuthProvider())`, gets an ID token, sends it to the
  server; server verifies it with the `firebase-admin` SDK and checks the decoded token's
  `email` against a single allowed address (the doxservices account) before setting a
  session/cookie. This also sets up Firestore as a natural next step for storing
  `standing-orders.json`'s data instead of a local file.
- **Plain Google OAuth 2.0 / One Tap**, verified server-side with `google-auth-library`,
  same email allow-list check, no Firebase project required. Faster to stand up if the
  Firebase migration hasn't started yet, but is throwaway work once Firebase Auth is in
  place.

Either approach needs, at minimum:
- A Google Cloud / Firebase project with OAuth consent screen configured
- The specific doxservices Google account email to allow (decide/confirm this — not yet
  specified anywhere in code or this handover)
- A decision on whether Basic Auth stays as a fallback or is fully removed once Google
  login works
- The other admin pages (`admin-applications.html`, `admin-nav.html`,
  `admin-standing-orders.html`, `applications-list.html`) presumably get the same
  treatment, not just `admin.html` — confirm with the user before doing only one page

## Other loose ends worth knowing about

- The Render Postgres database (`.env` → `DATABASE_URL`) backing `apply-legacy.html` /
  `admin.html` appears to be **dead** — `/health` returns a connection error. It was
  created ~August 2025 and Render's free tier expires databases after ~90 days.
- `variants/loanit` (this folder) is a fully separate Express app with its own
  `src/server.js` and **no external database** — it stores everything in
  `storage/data/*.json` locally. If the Firebase migration doesn't land soon, this is the
  most self-contained variant to build on.
- The `Github Projects\loanapp` folder on the Desktop (outside `App Development`) is a
  now-redundant leftover — its `.git` was moved into this repo and the remaining files
  matched `HEAD` exactly at the time. Safe to delete, was never auto-removed due to a
  permission block.
