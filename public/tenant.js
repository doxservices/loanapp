// Which lender does this page belong to?
//
// LoanApp hosts many lenders. Each one is a tenant, its slug is the path its
// home page lives at (/loanit-financing), and the pages inside the product are
// shared. So a page asks this module who it is working for instead of carrying
// a lender's name in its markup.
//
// Resolution order: the path, then ?lender=, then the last tenant this browser
// used, and finally — while the platform hosts a single lender — that one.
//
// Include before the page script:
//   <script src="api-base.js"></script>
//   <script src="tenant.js"></script>
// Then await window.Tenant.ready().
(function () {
  var API = window.LOANIT_API_BASE || '';
  var REMEMBER = 'tenantSlug';
  var CACHE_MS = 10 * 60 * 1000;

  function slugFromPath() {
    var parts = location.pathname.split('/').filter(Boolean);
    // A tenant home is the only single-segment path with no file extension.
    if (parts.length !== 1) return '';
    return /\.[a-z0-9]+$/i.test(parts[0]) ? '' : parts[0];
  }

  function remembered() { try { return localStorage.getItem(REMEMBER) || ''; } catch (e) { return ''; } }
  function remember(slug) { try { if (slug) localStorage.setItem(REMEMBER, slug); } catch (e) {} }

  // A tenant's public details change rarely; holding them for a few minutes
  // keeps the name and address on screen from flickering page to page.
  function cached(slug) {
    try {
      var hit = JSON.parse(sessionStorage.getItem('tenant:' + slug) || 'null');
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.tenant;
    } catch (e) {}
    return null;
  }
  function keep(slug, tenant) {
    try { sessionStorage.setItem('tenant:' + slug, JSON.stringify({ at: Date.now(), tenant: tenant })); } catch (e) {}
  }

  async function bySlug(slug) {
    var hit = cached(slug);
    if (hit) return hit;
    var res = await fetch(API + '/api/tenants/' + encodeURIComponent(slug));
    if (!res.ok) return null;
    var json = await res.json();
    if (!json.ok) return null;
    keep(slug, json.tenant);
    return json.tenant;
  }

  var lendersPromise = null;
  function lenders() {
    if (!lendersPromise) {
      lendersPromise = fetch(API + '/api/tenants')
        .then(function (r) { return r.json(); })
        .then(function (j) { return j.ok ? j.tenants : []; })
        .catch(function () { return []; });
    }
    return lendersPromise;
  }

  var asked = slugFromPath() ||
    new URLSearchParams(location.search).get('lender') || '';
  var state = { slug: asked, tenant: null, unknown: false };

  var settled = (async function () {
    var slug = asked || remembered();
    if (slug) {
      var tenant = await bySlug(slug);
      if (tenant) {
        state.slug = tenant.slug;
        state.tenant = tenant;
        remember(tenant.slug);
        return tenant;
      }
      // A slug that came from the address bar and matches nothing is worth
      // saying so; a stale remembered one just falls through.
      if (asked) { state.unknown = true; return null; }
    }
    var all = await lenders();
    if (all.length === 1) {
      state.slug = all[0].slug;
      state.tenant = all[0];
      remember(all[0].slug);
      return all[0];
    }
    return null;
  })();

  window.Tenant = {
    ready: function () { return settled; },
    get slug() { return state.slug; },
    get tenant() { return state.tenant; },
    get unknown() { return state.unknown; },
    lenders: lenders,
    remember: remember,
    // Where a lender's own home page lives.
    home: function (slug) {
      var s = slug || state.slug;
      return s ? '/' + s : 'tenant-home.html';
    }
  };
})();
