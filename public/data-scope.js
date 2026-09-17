// Real data / seeded demo data / everything — the one switch the admin tables
// share, so the seeded records used to build the app stop cluttering the
// screens that are meant to show the business's own records.
//
// A table opts in with a placeholder in its toolbar:
//   <span data-scope-filter></span>
// and filters its rows through DataScope.keep(rows, r => r.isDummy).
//
// The choice is remembered per browser and applies to every table at once,
// so switching to demo data does not have to be done five times.
(function () {
  var KEY = 'adminDataScope';

  function get() {
    try { return localStorage.getItem(KEY) || 'real'; } catch (e) { return 'real'; }
  }
  function set(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* private window */ }
  }

  // Anything without the flag counts as real: the seeded records are the ones
  // that were deliberately marked.
  function keep(rows, isDummy) {
    var scope = get();
    if (scope === 'all') return rows || [];
    var wantDummy = scope === 'dummy';
    return (rows || []).filter(function (row) { return !!isDummy(row) === wantDummy; });
  }

  function label(scope) {
    return scope === 'dummy' ? 'seeded demo data' : scope === 'all' ? 'all records' : 'real data';
  }

  function mount(onChange) {
    document.querySelectorAll('[data-scope-filter]').forEach(function (host) {
      if (host.dataset.scopeMounted) return;
      host.dataset.scopeMounted = '1';

      var lab = document.createElement('label');
      lab.setAttribute('for', 'data-scope');
      lab.textContent = 'Showing';

      var select = document.createElement('select');
      select.id = 'data-scope';
      select.innerHTML =
        '<option value="real">Real data</option>' +
        '<option value="dummy">Seeded demo data</option>' +
        '<option value="all">Everything</option>';
      select.value = get();
      select.addEventListener('change', function () {
        set(select.value);
        if (typeof onChange === 'function') onChange(select.value);
      });

      host.appendChild(lab);
      host.appendChild(select);
    });
  }

  window.DataScope = { get: get, keep: keep, mount: mount, label: label };
})();
