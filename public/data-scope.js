// Real data / seeded demo data / everything — the one switch the admin tables
// share, so the seeded records used to build the app stop cluttering the
// screens that are meant to show the business's own records.
//
// It belongs against the table it governs, not up in the page toolbar among
// the search and refresh controls: a filter that changes what a table contains
// should sit where the reader can see the table change. So each table places a
// strip of its own immediately above itself:
//
//   <div data-scope-filter></div>
//   <table>…</table>
//
// and filters its rows through DataScope.keep(rows, r => r.isDummy). The strip
// carries its own styling — the admin pages do not share one stylesheet — and
// says how many records the filter is holding back, so a short table is never
// mistaken for an empty one.
//
// The choice is remembered per browser and applies to every table at once, so
// switching to demo data does not have to be done five times.
// Turning it off: this control is scaffolding — it exists because the app was
// built alongside seeded demo records. When those are gone it should leave
// without a trace, so it is written to be removable by one switch rather than
// by editing five pages:
//
//   window.LOANIT_SHOW_DATA_FILTER = false;   // in api-base.js, or any page
//
// With that set, nothing is rendered, the styles are never injected, any
// placeholder left in the markup is hidden, and every table is served real
// records regardless of what this browser last chose. The strip is a plain
// block in normal flow that carries its own margin and nothing else depends
// on its presence — no sibling or nth-child rule in any of the four pages
// refers to it — so removing it reclaims its space and changes nothing else.
(function () {
  var KEY = 'adminDataScope';
  var last = { kept: null, total: null };
  var shown = window.LOANIT_SHOW_DATA_FILTER !== false;

  function get() {
    if (!shown) return 'real';
    try { return localStorage.getItem(KEY) || 'real'; } catch (e) { return 'real'; }
  }
  function set(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* private window */ }
  }

  // Anything without the flag counts as real: the seeded records are the ones
  // that were deliberately marked.
  function keep(rows, isDummy) {
    var scope = get();
    var all = rows || [];
    var out = scope === 'all' ? all : all.filter(function (row) {
      return !!isDummy(row) === (scope === 'dummy');
    });
    last = { kept: out.length, total: all.length };
    note();
    return out;
  }

  function label(scope) {
    return scope === 'dummy' ? 'seeded demo data' : scope === 'all' ? 'all records' : 'real data';
  }

  // What the filter is holding back, in the strip itself.
  function note() {
    var text = '';
    if (last.total != null) {
      var hidden = last.total - last.kept;
      text = hidden > 0
        ? last.kept + ' of ' + last.total + ' records · ' + hidden + ' hidden by this filter'
        : last.total + (last.total === 1 ? ' record' : ' records');
    }
    document.querySelectorAll('.data-scope-note').forEach(function (el) { el.textContent = text; });
  }

  // A placeholder left in the markup should take up no room at all.
  function hideAny() {
    if (document.getElementById('data-scope-hidden')) return;
    var css = document.createElement('style');
    css.id = 'data-scope-hidden';
    css.textContent = '[data-scope-filter]{display:none !important;}';
    document.head.appendChild(css);
  }

  function injectStyles() {
    if (document.getElementById('data-scope-styles')) return;
    var css = document.createElement('style');
    css.id = 'data-scope-styles';
    // Neutral translucent tones, so the strip sits correctly on the dark admin
    // pages and the light ones without either page having to style it.
    css.textContent = [
      '[data-scope-filter]{display:flex;align-items:center;gap:9px;flex-wrap:wrap;',
      'margin:0 0 10px;padding:8px 12px;border-radius:9px;font-size:12.5px;line-height:1.4;',
      'background:rgba(125,160,205,.10);border:1px solid rgba(125,160,205,.24);}',
      '[data-scope-filter] .data-scope-label{font-weight:600;opacity:.8;}',
      '[data-scope-filter] select{font:inherit;font-size:12.5px;font-weight:600;padding:5px 9px;',
      'border-radius:7px;cursor:pointer;color:inherit;background:rgba(255,255,255,.08);',
      'border:1px solid rgba(125,160,205,.4);}',
      // a light page needs a readable field; a dark one keeps the translucent look
      ':root[data-theme="light"] [data-scope-filter] select,',
      'body:not([class]) [data-scope-filter] select{background:#fff;}',
      '[data-scope-filter] .data-scope-note{margin-left:auto;opacity:.7;text-align:right;}',
      '@media (max-width:560px){[data-scope-filter] .data-scope-note{margin-left:0;flex-basis:100%;text-align:left;}}'
    ].join('');
    document.head.appendChild(css);
  }

  function mount(onChange) {
    if (!shown) { hideAny(); return; }
    injectStyles();
    document.querySelectorAll('[data-scope-filter]').forEach(function (host) {
      if (host.dataset.scopeMounted) return;
      host.dataset.scopeMounted = '1';

      var lab = document.createElement('span');
      lab.className = 'data-scope-label';
      lab.textContent = 'Showing';

      var select = document.createElement('select');
      select.id = 'data-scope';
      select.setAttribute('aria-label', 'Which records to show in this table');
      select.innerHTML =
        '<option value="real">Real data</option>' +
        '<option value="dummy">Seeded demo data</option>' +
        '<option value="all">Everything</option>';
      select.value = get();
      select.addEventListener('change', function () {
        set(select.value);
        if (typeof onChange === 'function') onChange(select.value);
      });

      var count = document.createElement('span');
      count.className = 'data-scope-note';

      host.appendChild(lab);
      host.appendChild(select);
      host.appendChild(count);
    });
    note();
  }

  window.DataScope = { get: get, keep: keep, mount: mount, label: label, get shown() { return shown; } };
  if (!shown && document.head) hideAny();
})();
