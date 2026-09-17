# Keeping the shell static between pages — an evaluation

*Written for: whoever decides what to build next on Loanapp. Measured on the
live build at doxservices-loanapp.web.app, 17 September 2026.*

The question: keep the navigation and other common parts in place from page to
page, load the changing part with JavaScript, and transition smoothly.

Short answer: **worth doing, but not as one job.** The smoothness can be had
this week for almost nothing. The architecture change it implies is a real
refactor, and there is a piece of preparatory work that has to happen first
either way.

---

## 1. What a navigation costs today

Measured in Edge 153 against the live build, warm cache:

| | Lender home | My profile | Support |
|---|---|---|---|
| First contentful paint | 632 ms | 356 ms | 436 ms |
| DOM ready | 618 ms | 404 ms | 417 ms |
| **Identity re-established** | **1233 ms** | — | **453 ms** |
| Requests | 16 | 18 | 14 |
| Transferred | 11 KB | 8 KB | 7 KB |

The transfer is small because everything is cached. The cost is not bandwidth,
it is **re-establishing the session on every page**: the Firebase SDK is
re-imported from gstatic, persistence is re-read, `/api/me` or `/auth/verify`
is called again. That is the 0.45–1.2 s above, and it repeats on every click.

There is also duplication in the source: **195 KB of inline CSS across 24 of
the 31 pages**, much of it the same buttons, cards and panels written again.

## 2. What is already shared

More than it looks, which makes the job smaller:

- **The navigation is already dynamic.** The server decides which entries an
  account may see (`navFor()`), sends them with the profile, and
  `admin-auth.js` renders exactly that list. Nothing is rendered then removed.
- **The session is already cached** in `localStorage` with a server-stated
  expiry, so moving between pages does not re-authenticate — it revalidates in
  the background.
- `admin-shell.js` already builds the sidebar; `theme.js`, `tenant.js`,
  `profile-gate.js`, `data-scope.js` are shared modules.

So the *logic* is centralised already. What repeats is the document: the CSS,
the SDK boot, and the paint.

## 3. The obstacle nobody sees until they try

**The same class names mean different things on different pages.**

- `.btn` is defined in **17** pages
- `.card` in **15**
- `.grid` in 4, `.shell` in 3, `.masthead` in 3

Each with its own rules. Today that is harmless, because only one page's CSS is
ever in the document. The moment two views share a document, those definitions
collide and the second view inherits the first one's buttons.

This is the single biggest hazard, and it is why the CSS work below has to come
before any shell work, not after.

## 4. Options

### Option A — Native cross-document view transitions *(recommended first)*

```css
@view-transition { navigation: auto; }
```

The browser cross-fades between ordinary page loads. No router, no shell, no
JavaScript. Verified supported in this environment: the at-rule parses,
`document.startViewTransition` exists, the Navigation API is present.

- **Effort:** hours. Three lines per page, or one shared stylesheet.
- **Risk:** near zero. Firefox ignores the rule and navigates as it does today.
- **Buys:** the smooth transitioning, and named transitions so the masthead and
  logo can be made to *persist visually* across the navigation
  (`view-transition-name`) even though the document is replaced.
- **Does not buy:** the 0.45–1.2 s identity cost. The page still reloads.

### Option B — Speculation rules *(pairs with A)*

```html
<script type="speculationrules">
{ "prerender": [{ "where": { "href_matches": "/*" }, "eagerness": "moderate" }] }
</script>
```

The browser prerenders the likely next page on hover. Supported here
(`HTMLScriptElement.supports('speculationrules')` is true). Navigation becomes
effectively instant, *including* the identity work, because it happened before
the click.

- **Effort:** an hour.
- **Risk:** low, but real — a prerendered page runs its scripts early, so
  anything with a side effect (analytics, `touchLastLogin`) needs to defer
  until activation. Worth auditing before switching it on.

### Option C — Extract the shared CSS *(the enabling work)*

One stylesheet of tokens and primitives — buttons, cards, panels, the masthead
— replacing the per-page copies. Removes the 195 KB duplication, makes the two
designs (lender light, platform dark) explicit, and removes the collision
hazard in §3.

- **Effort:** roughly a day, page by page, with screenshots before and after.
- **Risk:** moderate but contained — visual regressions are visible, and each
  page can be converted on its own.
- **Buys:** consistency now, and it is a prerequisite for Option D.

### Option D — A real shell with JavaScript view loading

One document; the masthead, nav and footer never re-render; the main region is
fetched and swapped; the History API keeps URLs honest.

- **Effort:** multi-day, across 31 pages.
- **Buys:** identity established once (the 0.45–1.2 s per navigation), no
  re-parse of page CSS, preserved scroll and state, and the smoothest result.
- **Costs and risks, specific to this codebase:**
  - **Access control.** `gatePage()` runs on page load and decides whether the
    page is even shown. As a router guard it has to be re-implemented and
    re-tested per role — the part of the system most recently repaired.
  - **Print documents.** `loan-contract.html`, `standing-order.html`,
    `salary-deduction.html` and `loan-statement.html` carry `@page` and
    `@media print` rules that assume they are the whole document. These should
    stay real pages whatever else changes.
  - **The tenant slug.** `/loanit-financing` is served by a hosting rewrite and
    resolved from `location.pathname`. A router has to keep that contract.
  - It would land in the middle of the open tenancy-enforcement work.

## 5. Recommendation

1. **Now:** Option A. Add view transitions, with `view-transition-name` on the
   masthead and logo so the chrome appears to stay put while the page beneath
   it changes. This is the effect being asked for, at almost no cost or risk.
2. **Next:** Option C. Extract the shared CSS. It pays for itself in
   consistency alone, and without it Option D cannot be done safely.
3. **Then, if still wanted:** Option B for instant navigation, after auditing
   what runs on prerender.
4. **Only if the app grows into it:** Option D, and then **for the admin area
   only** — the part with frequent navigation between related views. Leave the
   public pages and the print documents as ordinary documents.

The honest summary: steps 1–3 get most of what is actually wanted — it feels
continuous and fast — for a fraction of the effort of step 4, and none of the
risk to access control.
