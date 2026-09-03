// Shared toolbar nav for the authorization form pages. Each form carries an
// empty <nav class="toolbar-nav"> that this fills in, so adding a form here
// updates every page at once. The current page is marked active by filename.
(function () {
  var links = [
    { href: 'index.html', label: 'Home' },
    { href: 'standing-order.html', label: 'Standing Order' },
    { href: 'salary-deduction.html', label: 'Salary Deduction' },
    { href: 'loan-contract.html', label: 'Loan Contract' }
  ];
  var current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.toolbar-nav').forEach(function (nav) {
    nav.innerHTML = links.map(function (link) {
      var active = link.href === current;
      return '<a href="' + link.href + '"' + (active ? ' class="active" aria-current="page"' : '') + '>' + link.label + '</a>';
    }).join('');
  });
})();
