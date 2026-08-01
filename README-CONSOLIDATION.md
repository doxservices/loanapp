# Loanapp Consolidation — 2026-08-01

All loan application projects were reconciled into this single folder. This file documents
what was merged, where everything came from, and where to find each version.

## Git history

The `.git` repository was moved here from `Desktop\Github Projects\loanapp`
(remote: https://github.com/xhemmings/loanapp.git).

- **`main`** — the latest committed version of the app (last commit 2025-08-25,
  "Add files via upload"), checked out fresh from git. This is what you see at the root.
- **`snapshot/local-aug22-copy`** — the working copy that previously lived at
  `Desktop\loanapp` (files dated 2025-08-22). It was older than git's latest commit and
  was missing several pages (admin-applications.html, applications-list.html, index.html),
  so it was preserved on this branch instead of overwriting main.
  View it with: `git checkout snapshot/local-aug22-copy`

After the `.git` move, the leftover files in `Github Projects\loanapp` were an exact copy
of `main` (the repo was clean), so that folder was removed.

## variants/ — the other loan apps, merged here

| Folder | Came from | What it is |
|---|---|---|
| `variants/loanit` | `App Development\Loanit` (originally `Desktop\loan-system`) | The most evolved rewrite: `src/server.js` (~370 lines), JSON file storage, admin dashboard/promotions pages. Includes its own README. |
| `variants/test` | `Desktop\test` | Loanapp experiment, 2025-08-25 (~55-line server.js). |
| `variants/test2` | `Desktop\test2` | Loanapp experiment, 2025-08-25 (~100-line server.js), default-data loader. |
| `variants/loan-system-safe-snapshot` | **copied** from `Desktop\safe\loan-system` | An earlier, different snapshot of loan-system (has admin-profile.html / admin.html; loanit has admin-dashboard / admin-promotions instead). The original backup in `Desktop\safe` was left untouched. |

## Not tracked in git (see .gitignore)

- `node_modules/`, `.env*`, `.chat-archive/`
- `variants/*/storage/` and `variants/*/scripts/storage/` — contain real applicant data
  (uploaded photo IDs, payslips, application JSON). Kept local on purpose so they can
  never be pushed to GitHub accidentally.

## Claude Code chats

Both the original Loanapp chat and the Loanit chat are registered to this folder —
open it in VS Code and run `/resume` to see them. Raw chat archives are in `.chat-archive/`.

## Possible next step

Mount the variant UIs at different routes inside the main app (e.g. `/loanit`, `/test2`)
instead of keeping them as separate folders — not done yet; variants are preserved as-is.
