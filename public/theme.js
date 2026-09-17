// Shared light/dark theme switch for every admin page. Loaded in <head> so
// the stored choice is applied before first paint (no flash), then renders a
// toggle once the page — or admin-shell.js — has built its controls.
//
// Pages keep BOTH themes: the sidebar pages are authored dark and get their
// light rules from admin-light.css (scoped to [data-theme="light"]); the
// utility pages are authored light in admin-theme.css and get their dark
// rules from its [data-theme="dark"] block.
//
// The controls live in a dock that sits retracted above the top edge, leaving
// only a small tab on screen. They are needed rarely — a theme is chosen once
// — so they stay out of the way of the page until the tab is pulled down.
(function () {
  var KEY = 'adminTheme';
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}
  document.documentElement.setAttribute('data-theme', stored === 'dark' ? 'dark' : 'light');

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function label(btn) {
    var dark = currentTheme() === 'dark';
    btn.innerHTML = '<i class="fas ' + (dark ? 'fa-sun' : 'fa-moon') + '"></i><span>' + (dark ? 'Light' : 'Dark') + '</span>';
    btn.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
    btn.title = btn.getAttribute('aria-label');
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    var btn = document.getElementById('theme-toggle');
    if (btn) label(btn);
  }

  // The toggle and the dock carry their own styling so they look right on
  // every admin page, whichever stylesheet that page happens to use.
  function injectStyles() {
    if (document.getElementById('theme-toggle-styles')) return;
    var css = document.createElement('style');
    css.id = 'theme-toggle-styles';
    css.textContent = [
      '.theme-toggle{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font:inherit;',
      'font-size:12px;font-weight:700;border-radius:8px;padding:5px 10px;line-height:1;',
      'background:#f2f8ff;color:#0a4f8b;border:1px solid #b9d8f2;transition:all .16s ease;}',
      '.theme-toggle:hover{background:#e4f0fd;}',
      ':root[data-theme="dark"] .theme-toggle{background:rgba(13,62,164,.70);color:rgba(255,255,255,.97);',
      'border-color:rgba(205,226,255,.20);}',
      ':root[data-theme="dark"] .theme-toggle:hover{background:rgba(13,62,164,.92);}',

      // The dock is shifted up by its own height, less the height of the tab,
      // so the tab is all that remains on screen.
      '.float-dock{position:fixed;top:0;right:18px;z-index:45;display:flex;flex-direction:column;',
      'align-items:flex-end;gap:0;transform:translateY(calc(-100% + 20px));',
      'transition:transform .24s cubic-bezier(.4,0,.2,1);}',
      '.float-dock.open{transform:translateY(10px);}',
      '@media (prefers-reduced-motion: reduce){.float-dock{transition:none;}}',

      '.float-dock-body{display:flex;align-items:center;gap:8px;padding:8px 12px;',
      'background:rgba(255,255,255,.94);border:1px solid #b9d8f2;border-radius:12px;',
      'box-shadow:0 6px 20px rgba(16,57,92,.16);}',
      ':root[data-theme="dark"] .float-dock-body{background:rgba(10,20,50,.86);',
      'border-color:rgba(205,226,255,.20);box-shadow:0 6px 20px rgba(0,0,0,.34);}',

      // Sits inside the dock now, so its own fixed positioning is dropped.
      '.float-dock .sidebar-mode-toggle{position:static;top:auto;right:auto;z-index:auto;',
      'padding:0;background:none;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;}',

      '.float-dock-handle{margin-top:-1px;display:flex;align-items:center;justify-content:center;gap:6px;',
      'width:62px;height:21px;cursor:pointer;font:inherit;font-size:10px;font-weight:700;',
      'letter-spacing:.04em;text-transform:uppercase;border:1px solid #b9d8f2;border-top:0;',
      'border-radius:0 0 9px 9px;background:rgba(255,255,255,.94);color:#0a4f8b;',
      'box-shadow:0 4px 12px rgba(16,57,92,.14);}',
      '.float-dock-handle:hover{background:#e4f0fd;}',
      '.float-dock-handle i{font-size:9px;transition:transform .24s ease;}',
      '.float-dock.open .float-dock-handle i{transform:rotate(180deg);}',
      ':root[data-theme="dark"] .float-dock-handle{background:rgba(10,20,50,.92);',
      'color:rgba(255,255,255,.92);border-color:rgba(205,226,255,.20);}',
      ':root[data-theme="dark"] .float-dock-handle:hover{background:rgba(13,62,164,.92);}',

      '@media (max-width: 992px){.float-dock{right:10px;}}'
    ].join('');
    document.head.appendChild(css);
  }

  function dock() {
    var existing = document.getElementById('float-dock');
    if (existing) return existing;

    var el = document.createElement('div');
    el.className = 'float-dock';
    el.id = 'float-dock';

    var body = document.createElement('div');
    body.className = 'float-dock-body';
    body.id = 'float-dock-body';

    var handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'float-dock-handle';
    handle.id = 'float-dock-handle';
    handle.setAttribute('aria-expanded', 'false');
    handle.setAttribute('aria-controls', 'float-dock-body');
    handle.setAttribute('aria-label', 'Show theme and layout controls');
    handle.innerHTML = '<i class="fas fa-chevron-down"></i>';

    function setOpen(open) {
      el.classList.toggle('open', open);
      handle.setAttribute('aria-expanded', open ? 'true' : 'false');
      handle.setAttribute('aria-label', (open ? 'Hide' : 'Show') + ' theme and layout controls');
    }
    handle.addEventListener('click', function (e) {
      e.stopPropagation();
      setOpen(!el.classList.contains('open'));
    });
    // Clicking the page, or Escape, puts it away again.
    document.addEventListener('click', function (e) {
      if (el.classList.contains('open') && !el.contains(e.target)) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    el.appendChild(body);
    el.appendChild(handle);
    document.body.appendChild(el);
    return el;
  }

  // Runs more than once on some pages — theme.js renders on DOMContentLoaded
  // and admin-shell.js calls it again once it has built its controls — so
  // everything here is written to be safe to repeat.
  function render() {
    injectStyles();
    if (!document.body) return;
    var el = dock();
    var body = document.getElementById('float-dock-body');

    // The sidebar pages carry their own floating mode switch; it belongs in
    // the dock rather than floating separately.
    var mode = document.querySelector('.sidebar-mode-toggle');
    if (mode && mode.parentNode !== body) body.insertBefore(mode, body.firstChild);

    if (!document.getElementById('theme-toggle')) {
      var btn = document.createElement('button');
      btn.id = 'theme-toggle';
      btn.type = 'button';
      btn.className = 'theme-toggle';
      label(btn);
      btn.addEventListener('click', function () {
        apply(currentTheme() === 'dark' ? 'light' : 'dark');
      });
      body.appendChild(btn);
    } else if (document.getElementById('theme-toggle').parentNode !== body) {
      body.appendChild(document.getElementById('theme-toggle'));
    }
    void el;
  }

  window.__renderThemeToggle = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
