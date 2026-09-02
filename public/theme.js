// Shared light/dark theme switch for every admin page. Loaded in <head> so
// the stored choice is applied before first paint (no flash), then renders a
// toggle once the page — or admin-shell.js — has built its controls.
//
// Pages keep BOTH themes: the sidebar pages are authored dark and get their
// light rules from admin-light.css (scoped to [data-theme="light"]); the
// utility pages are authored light in admin-theme.css and get their dark
// rules from its [data-theme="dark"] block.
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

  // The toggle carries its own styling so it looks right on every admin
  // page, whichever stylesheet that page happens to use.
  function injectStyles() {
    if (document.getElementById('theme-toggle-styles')) return;
    var css = document.createElement('style');
    css.id = 'theme-toggle-styles';
    css.textContent = [
      '.theme-toggle{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font:inherit;',
      'font-size:12px;font-weight:700;border-radius:8px;padding:5px 10px;line-height:1;',
      'background:#f2f8ff;color:#0a4f8b;border:1px solid #b9d8f2;transition:all .16s ease;}',
      '.theme-toggle:hover{background:#e4f0fd;}',
      '.theme-toggle.in-pill{margin-left:2px;}',
      '.theme-toggle.floating{position:fixed;top:16px;right:16px;z-index:30;padding:9px 13px;',
      'box-shadow:0 4px 14px rgba(16,57,92,.12);}',
      ':root[data-theme="dark"] .theme-toggle{background:rgba(13,62,164,.70);color:rgba(255,255,255,.97);',
      'border-color:rgba(205,226,255,.20);}',
      ':root[data-theme="dark"] .theme-toggle:hover{background:rgba(13,62,164,.92);}'
    ].join('');
    document.head.appendChild(css);
  }

  // Sits inside the existing sidebar-mode pill when there is one, otherwise
  // as its own floating control in the same corner.
  function render() {
    injectStyles();
    if (document.getElementById('theme-toggle')) return;
    var btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.type = 'button';
    btn.className = 'theme-toggle';
    label(btn);
    btn.addEventListener('click', function () {
      apply(currentTheme() === 'dark' ? 'light' : 'dark');
    });

    var host = document.querySelector('.sidebar-mode-toggle');
    if (host) {
      btn.classList.add('in-pill');
      host.appendChild(btn);
    } else {
      btn.classList.add('floating');
      document.body.appendChild(btn);
    }
  }

  window.__renderThemeToggle = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})();
