// Gives the lightweight admin utility pages (admin navigation, submissions
// and applications tables) the same sidebar shell as the main admin pages,
// without duplicating markup into each file: it wraps the existing .page in
// the standard admin-container + sidebar structure and wires the same
// floating/attached mode and mobile drawer behaviour.
(function () {
  var LINKS = [
    { href: 'admin-dashboard.html', icon: 'fa-tachometer-alt', label: 'Dashboard' },
    { href: 'admin-promotions.html', icon: 'fa-tags', label: 'Manage Promotions' },
    { href: 'applications-list.html', icon: 'fa-list-alt', label: 'Applications List' },
    { href: 'admin-standing-orders.html', icon: 'fa-file-invoice', label: 'Standing Orders' },
    { href: 'admin-salary-deductions.html', icon: 'fa-file-signature', label: 'Salary Deductions' },
    { href: 'user-management.html', icon: 'fa-users', label: 'User Management' },
    { href: 'admin.html', icon: 'fa-cog', label: 'Settings' },
    { href: 'index.html', icon: 'fa-sign-out-alt', label: 'Logout' }
  ];

  function build() {
    var page = document.querySelector('.page');
    if (!page || document.querySelector('.admin-container')) return;
    var current = location.pathname.split('/').pop() || 'index.html';

    var container = document.createElement('div');
    container.className = 'admin-container';

    var aside = document.createElement('aside');
    aside.className = 'sidebar';
    aside.innerHTML =
      '<div class="logo"><i class="fas fa-university"></i><h1>LoanAdmin Pro</h1></div>' +
      '<ul class="nav-links">' + LINKS.map(function (l) {
        return '<li><a href="' + l.href + '"' + (l.href === current ? ' class="active"' : '') +
          '><i class="fas ' + l.icon + '"></i> ' + l.label + '</a></li>';
      }).join('') + '</ul>';

    var main = document.createElement('main');
    main.className = 'main-content';

    page.parentNode.insertBefore(container, page);
    main.appendChild(page);
    container.appendChild(aside);
    container.appendChild(main);

    var toggle = document.createElement('button');
    toggle.className = 'sidebar-toggle';
    toggle.id = 'sidebarToggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.innerHTML = '<i class="fas fa-bars"></i>';

    var backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.id = 'sidebarBackdrop';

    var mode = document.createElement('div');
    mode.className = 'sidebar-mode-toggle';
    mode.innerHTML =
      '<i class="fas fa-thumbtack"></i><span id="sidebarModeLabel">Floating</span>' +
      '<label class="mini-switch"><input type="checkbox" id="sidebarModeSwitch"><span class="mini-slider"></span></label>';

    document.body.insertBefore(toggle, document.body.firstChild);
    document.body.insertBefore(backdrop, document.body.firstChild);
    document.body.insertBefore(mode, document.body.firstChild);

    // Same persisted floating/attached preference as the other admin pages.
    var sidebarModeSwitch = document.getElementById('sidebarModeSwitch');
    var sidebarModeLabel = document.getElementById('sidebarModeLabel');
    function applySidebarMode(m) {
      var attached = m === 'attached';
      aside.classList.toggle('attached', attached);
      container.classList.toggle('attached-layout', attached);
      sidebarModeSwitch.checked = attached;
      sidebarModeLabel.textContent = attached ? 'Attached' : 'Floating';
    }
    applySidebarMode(localStorage.getItem('adminSidebarMode') || 'floating');
    sidebarModeSwitch.addEventListener('change', function () {
      var m = this.checked ? 'attached' : 'floating';
      localStorage.setItem('adminSidebarMode', m);
      applySidebarMode(m);
    });

    function closeMobile() { aside.classList.remove('mobile-open'); backdrop.classList.remove('show'); }
    toggle.addEventListener('click', function () { aside.classList.add('mobile-open'); backdrop.classList.add('show'); });
    backdrop.addEventListener('click', closeMobile);
    aside.querySelectorAll('.nav-links a').forEach(function (a) { a.addEventListener('click', closeMobile); });

    if (window.__renderThemeToggle) window.__renderThemeToggle();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
