// Row actions for the admin submission tables: a ⋮ menu per row and a
// full-detail view, so the table itself only has to carry the columns you
// scan and everything else stays one click away.
//
// The menu is rendered into <body> as a fixed-positioned element rather than
// inside the row, because the table scroll container clips absolutely
// positioned children — a dropdown placed in the row would be cut off.
(function () {
  const LABELS = {
    borrowerName: 'Full name', trn: 'TRN', contactNo: 'Contact no.',
    employer: 'Employer', position: 'Department / position', payrollContact: 'Payroll contact',
    borrowerBank: 'Bank', borrowerBranch: 'Branch',
    borrowerAccountName: 'Account name', borrowerAccountNo: 'Account no.',
    bankAddressee: 'Attn.', bankAddress1: 'Address line 1', bankAddress2: 'Address line 2',
    bankTown: 'Town / city', bankParish: 'Parish', bankCountry: 'Country',
    loanAmount: 'Loan amount', deductionAmount: 'Deduction amount', paymentAmount: 'Order amount',
    payFrequency: 'Pay period', repaymentFrequency: 'Repayment terms',
    contractDate: 'Contract date', startDate: 'First payment date',
    repaymentPeriod: 'Repayment period',
    termYears: 'Term (years)', termMonths: 'Term (months)', totalMonths: 'Total months',
    submittedAt: 'First submitted', updatedAt: 'Last updated',
    draftId: 'Form session', id: 'Record id'
  };

  const GROUPS = [
    { title: 'Borrower', keys: ['borrowerName', 'trn', 'contactNo'] },
    { title: 'Employer', keys: ['employer', 'position', 'payrollContact'] },
    { title: 'Account to be debited', keys: ['borrowerBank', 'borrowerBranch', 'borrowerAccountName', 'borrowerAccountNo'] },
    { title: 'Bank address', keys: ['bankAddressee', 'bankAddress1', 'bankAddress2', 'bankTown', 'bankParish', 'bankCountry'] },
    { title: 'Loan', keys: ['loanAmount', 'deductionAmount', 'paymentAmount', 'payFrequency', 'repaymentFrequency', 'contractDate', 'startDate', 'repaymentPeriod', 'termYears', 'termMonths', 'totalMonths'] },
    { title: 'Record', keys: ['submittedAt', 'updatedAt', 'draftId', 'id'] }
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function fmt(key, value) {
    if (value == null || value === '') return '—';
    if (key === 'submittedAt' || key === 'updatedAt') {
      if (typeof value === 'object' && value._seconds) return new Date(value._seconds * 1000).toLocaleString();
      try { return new Date(value).toLocaleString(); } catch (e) { return String(value); }
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  let openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
  }
  document.addEventListener('click', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeModal(); } });
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);

  function menu(button, record, opts) {
    const wasOpen = openMenu && openMenu.dataset.for === record.id;
    closeMenu();
    if (wasOpen) return;

    const el = document.createElement('div');
    el.className = 'row-menu';
    el.dataset.for = record.id;
    el.innerHTML =
      '<button type="button" data-act="details"><i class="fas fa-list-ul"></i> View full details</button>' +
      '<a href="' + opts.formHref(record) + '"><i class="fas fa-pen-to-square"></i> Open in form</a>' +
      '<button type="button" data-act="copy"><i class="fas fa-copy"></i> Copy record id</button>';
    document.body.appendChild(el);

    const r = button.getBoundingClientRect();
    const width = el.offsetWidth || 210;
    el.style.top = Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
    el.style.left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) + 'px';
    openMenu = el;

    el.querySelector('[data-act="details"]').addEventListener('click', () => { closeMenu(); details(record, opts); });
    el.querySelector('[data-act="copy"]').addEventListener('click', () => {
      navigator.clipboard && navigator.clipboard.writeText(record.id);
      closeMenu();
    });
  }

  function closeModal() {
    const m = document.getElementById('record-modal');
    if (m) m.remove();
  }

  function details(record, opts) {
    closeModal();
    const sections = GROUPS.map(g => {
      const rows = g.keys.filter(k => record[k] !== undefined && record[k] !== '')
        .map(k => '<dt>' + esc(LABELS[k] || k) + '</dt><dd>' + esc(fmt(k, record[k])) + '</dd>').join('');
      return rows ? '<section><h4>' + esc(g.title) + '</h4><dl>' + rows + '</dl></section>' : '';
    }).join('');

    const type = record.autosaved ? 'Autosaved draft' : 'Printed submission';
    const el = document.createElement('div');
    el.className = 'record-modal';
    el.id = 'record-modal';
    el.innerHTML =
      '<div class="record-modal-card" role="dialog" aria-modal="true" aria-label="Record details">' +
        '<header>' +
          '<div><h3>' + esc(record.borrowerName || 'Record') + '</h3>' +
          '<p>' + esc(type) + ' · ' + esc(fmt('submittedAt', record.submittedAt)) + '</p></div>' +
          '<button type="button" class="record-modal-close" aria-label="Close">&times;</button>' +
        '</header>' +
        '<div class="record-modal-body">' + sections +
          '<details class="record-raw"><summary>Raw record</summary><pre>' + esc(JSON.stringify(record, null, 2)) + '</pre></details>' +
        '</div>' +
        '<footer>' +
          '<a class="btn btn-primary" href="' + opts.formHref(record) + '"><i class="fas fa-pen-to-square"></i> Open in form</a>' +
          '<button type="button" class="btn record-modal-close">Close</button>' +
        '</footer>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', e => { if (e.target === el) closeModal(); });
    el.querySelectorAll('.record-modal-close').forEach(b => b.addEventListener('click', closeModal));
  }

  window.RecordActions = { menu, details, fmt, esc };
})();
