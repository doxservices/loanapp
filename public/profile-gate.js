// The profile everybody fills in once, asked for the moment they sign in.
//
// A loan record has to belong to a person: their name as it will appear on the
// agreement, the TRN the forms carry, where they live, who employs them and
// what they earn — the last two because campaign cohorts are judged on them.
// So this is not a page somebody may or may not visit. It is a modal that
// stands in front of whatever they opened, pre-filled from their Google
// account, and it does not go away until the profile is saved against their
// user record.
//
// Sign-in is Google's, so there is no password and nothing here about
// two-factor: that belongs to the Google account, not to this application.
//
// Include after user-auth.js, on any page a signed-in person can reach:
//   <script type="module" src="user-auth.js"></script>
//   <script src="profile-gate.js"></script>
(function () {
  var PARISHES = ['Kingston', 'St. Andrew', 'St. Catherine', 'Clarendon', 'Manchester',
    'St. Elizabeth', 'Westmoreland', 'Hanover', 'St. James', 'Trelawny', 'St. Ann',
    'St. Mary', 'Portland', 'St. Thomas'];

  // A member of staff is not a borrower: they are asked for the name that
  // appears against their decisions and a date of birth to tell two people of
  // the same name apart. No TRN, no address, no employer, no income — the
  // business has no use for those and no business holding them. Everything
  // else comes from the Google account they signed in with.
  var STAFF_FIELDS = [
    { k: 'firstName', label: 'First name', required: true, span: 1, auto: 'given-name' },
    { k: 'lastName', label: 'Last name', required: true, span: 1, auto: 'family-name' },
    { k: 'dateOfBirth', label: 'Date of birth', required: true, span: 1, type: 'date', auto: 'bday' }
  ];

  // Same shape the server accepts from a borrower, and the same nine it
  // insists on.
  var FIELDS = [
    { k: 'firstName', label: 'First name', required: true, span: 1, auto: 'given-name' },
    { k: 'lastName', label: 'Last name', required: true, span: 1, auto: 'family-name' },
    { k: 'phone', label: 'Phone', required: true, span: 1, type: 'tel', auto: 'tel', hint: 'e.g. 876-555-0123' },
    { k: 'trn', label: 'TRN', required: true, span: 1, hint: 'Nine digits' },
    { k: 'addressLine1', label: 'Address', required: true, span: 2, auto: 'address-line1' },
    { k: 'addressLine2', label: 'Address line 2', required: false, span: 2, auto: 'address-line2' },
    { k: 'town', label: 'Town', required: true, span: 1, auto: 'address-level2' },
    { k: 'parish', label: 'Parish', required: true, span: 1, options: PARISHES },
    { k: 'employer', label: 'Employer', required: true, span: 1, auto: 'organization' },
    { k: 'monthlyIncome', label: 'Monthly income (J$)', required: true, span: 1, type: 'number', hint: 'Before deductions' }
  ];

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  function injectStyles() {
    if (document.getElementById('profile-gate-styles')) return;
    var css = document.createElement('style');
    css.id = 'profile-gate-styles';
    css.textContent = [
      '#profile-gate{position:fixed;inset:0;z-index:9990;display:flex;align-items:flex-start;',
      'justify-content:center;padding:26px 16px;overflow:auto;background:rgba(8,22,44,.74);',
      "font-family:'Public Sans','Segoe UI',system-ui,sans-serif;backdrop-filter:blur(4px);}",
      '#profile-gate .sheet{width:100%;max-width:620px;background:#fff;color:#12243a;border-radius:14px;',
      'box-shadow:0 30px 70px rgba(8,22,44,.4);overflow:hidden;}',
      '#profile-gate header{padding:22px 26px 18px;border-bottom:1px solid #e1e9f2;}',
      '#profile-gate h2{margin:0 0 6px;font-size:20px;font-weight:700;letter-spacing:-.02em;}',
      '#profile-gate .sub{margin:0;font-size:14px;color:#74899f;line-height:1.55;}',
      '#profile-gate .who{display:flex;align-items:center;gap:11px;margin-top:16px;padding:11px 13px;',
      'background:#f4f7fb;border:1px solid #e1e9f2;border-radius:10px;}',
      '#profile-gate .who img{width:34px;height:34px;border-radius:50%;flex:none;}',
      '#profile-gate .who .initial{width:34px;height:34px;border-radius:50%;flex:none;display:grid;',
      'place-items:center;background:#0b5ea8;color:#fff;font-weight:700;font-size:15px;}',
      '#profile-gate .who b{display:block;font-size:14px;font-weight:600;line-height:1.3;}',
      '#profile-gate .who span{font-size:12.5px;color:#74899f;}',
      '#profile-gate form{padding:20px 26px 0;}',
      '#profile-gate .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}',
      '#profile-gate .f.wide{grid-column:1 / -1;}',
      '#profile-gate label{display:block;font-size:12.5px;font-weight:600;margin-bottom:5px;}',
      '#profile-gate label i{color:#b3261e;font-style:normal;}',
      '#profile-gate input,#profile-gate select{width:100%;font:inherit;font-size:14.5px;padding:10px 12px;',
      'border:1px solid #cddbea;border-radius:8px;background:#fff;color:inherit;}',
      '#profile-gate input:focus,#profile-gate select:focus{outline:2px solid #0b5ea8;outline-offset:1px;border-color:#0b5ea8;}',
      '#profile-gate .hint{display:block;margin-top:4px;font-size:11.5px;color:#93a3b5;}',
      '#profile-gate footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
      'padding:18px 26px 22px;margin-top:20px;border-top:1px solid #e1e9f2;background:#f9fbfd;}',
      '#profile-gate .btn{font:inherit;font-size:14.5px;font-weight:600;padding:11px 20px;border-radius:9px;',
      'cursor:pointer;border:1px solid #0b5ea8;background:#0b5ea8;color:#fff;}',
      '#profile-gate .btn:hover{background:#084a85;}',
      '#profile-gate .btn[disabled]{opacity:.6;cursor:default;}',
      '#profile-gate .btn.quiet{background:transparent;color:#46607a;border-color:#cddbea;}',
      '#profile-gate .btn.quiet:hover{background:#eaf1f9;}',
      '#profile-gate .msg{font-size:13px;color:#a0231d;margin-right:auto;}',
      '#profile-gate .msg.ok{color:#146b4a;}',
      '@media (max-width:560px){#profile-gate .grid{grid-template-columns:1fr;}',
      '#profile-gate .sheet{border-radius:12px;}}'
    ].join('');
    document.head.appendChild(css);
  }

  function field(f, value) {
    var id = 'pg-' + f.k;
    var label = '<label for="' + id + '">' + esc(f.label) + (f.required ? ' <i aria-hidden="true">*</i>' : '') + '</label>';
    var input;
    if (f.options) {
      input = '<select id="' + id + '" name="' + f.k + '"' + (f.required ? ' required' : '') + '>' +
        '<option value="">Choose…</option>' +
        f.options.map(function (o) {
          return '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
        }).join('') + '</select>';
    } else {
      input = '<input id="' + id + '" name="' + f.k + '" type="' + (f.type || 'text') + '"' +
        (f.auto ? ' autocomplete="' + f.auto + '"' : '') +
        (f.required ? ' required' : '') + ' value="' + esc(value) + '" />';
    }
    return '<div class="f' + (f.span === 2 ? ' wide' : '') + '">' + label + input +
      (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</div>';
  }

  // What we already know: whatever is on the record, and for a first-time
  // sign-in the name Google gave us, split on the first space.
  function fieldsFor(me) { return (me && me.staff) ? STAFF_FIELDS : FIELDS; }

  function seed(me) {
    var p = (me && me.profile) || {};
    var known = {};
    fieldsFor(me).forEach(function (f) { known[f.k] = p[f.k] || ''; });
    var google = (window.userAuth.google) || {};
    var full = String(google.displayName || me.name || '').trim();
    if (!known.firstName && full) known.firstName = full.split(' ')[0];
    if (!known.lastName && full.indexOf(' ') > -1) known.lastName = full.split(' ').slice(1).join(' ');
    return known;
  }

  var open = false;
  var openFor = null;   // who the form on screen was built for

  function show(me) {
    // Somebody signed in as a different person while this was up — the form
    // belongs to whoever is signed in now, not to whoever opened it.
    if (open && openFor && me && openFor !== (me.userId || me.email)) close();
    if (open || document.getElementById('profile-gate')) return;
    open = true;
    openFor = me ? (me.userId || me.email) : null;
    injectStyles();

    var fields = fieldsFor(me);
    var staff = !!(me && me.staff);
    var known = seed(me);
    var google = window.userAuth.google || {};
    var name = google.displayName || me.name || me.email;
    var avatar = google.photoURL
      ? '<img src="' + esc(google.photoURL) + '" alt="" referrerpolicy="no-referrer" />'
      : '<span class="initial">' + esc(String(name).trim().charAt(0).toUpperCase() || '?') + '</span>';

    var el = document.createElement('div');
    el.id = 'profile-gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'profile-gate-title');
    el.innerHTML =
      '<div class="sheet">' +
        '<header>' +
          '<h2 id="profile-gate-title">Finish setting up your profile</h2>' +
          '<p class="sub">' + (staff
            ? 'Just your name as it should appear against your work, and a date of birth so two people of the ' +
              'same name are never confused. Everything else comes from your Google account.'
            : 'We need these details before you can apply for a loan — they are the ones that go on your ' +
              'agreement and your repayment forms. You only fill this in once.') + '</p>' +
          '<div class="who">' + avatar +
            '<div><b>' + esc(name) + '</b><span>' + esc(me.email) + ' · signed in with Google</span></div>' +
          '</div>' +
        '</header>' +
        '<form id="profile-gate-form" novalidate>' +
          '<div class="grid">' +
            fields.map(function (f) { return field(f, known[f.k]); }).join('') +
          '</div>' +
          '<footer>' +
            '<span class="msg" id="profile-gate-msg"></span>' +
            '<button type="button" class="btn quiet" id="profile-gate-out">Sign out</button>' +
            '<button type="submit" class="btn" id="profile-gate-save">Save my details</button>' +
          '</footer>' +
        '</form>' +
      '</div>';

    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';

    // The TRN is nine digits, grouped the way the printed forms group it.
    var trn = document.getElementById('pg-trn');
    if (trn) trn.addEventListener('input', function () {
      var d = trn.value.replace(/\D/g, '').slice(0, 9);
      trn.value = d.length > 6 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6)
        : d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
    });

    // Land on the first thing we do not already know.
    var firstEmpty = fields.filter(function (f) { return f.required && !known[f.k]; })[0];
    var focusEl = document.getElementById('pg-' + ((firstEmpty && firstEmpty.k) || 'firstName'));
    if (focusEl) focusEl.focus();

    document.getElementById('profile-gate-out').addEventListener('click', function () {
      window.userAuth.signOut();
    });

    document.getElementById('profile-gate-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var msg = document.getElementById('profile-gate-msg');
      var save = document.getElementById('profile-gate-save');
      msg.className = 'msg';
      msg.textContent = '';

      var body = {};
      fields.forEach(function (f) {
        var input = document.getElementById('pg-' + f.k);
        body[f.k] = input ? input.value.trim() : '';
      });

      var missing = fields.filter(function (f) { return f.required && !body[f.k]; });
      if (missing.length) {
        msg.textContent = 'Still needed: ' + missing.map(function (f) {
          return f.label.replace(/\s*\(.*\)$/, '').toLowerCase();
        }).join(', ');
        var firstMissing = document.getElementById('pg-' + missing[0].k);
        if (firstMissing) firstMissing.focus();
        return;
      }

      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        var res = await window.userAuth.fetch('/api/me/profile', {
          method: 'PUT', body: JSON.stringify(body)
        });
        var json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Could not save your details.');
        msg.className = 'msg ok';
        msg.textContent = 'Saved.';
        close();
        // The page can now show whatever it was holding back.
        await window.userAuth.refresh();
        window.dispatchEvent(new CustomEvent('profile-complete', { detail: json.profile }));
      } catch (err) {
        msg.textContent = err.message || 'Could not save your details.';
        save.disabled = false;
        save.textContent = 'Save my details';
      }
    });
  }

  function close() {
    var el = document.getElementById('profile-gate');
    if (el) el.remove();
    document.documentElement.style.overflow = '';
    open = false;
    openFor = null;
  }

  function consider(me) {
    // Not signed in, already done, or one of the bootstrap admin accounts that
    // has no user record to hang a profile on.
    if (!me || me.profileComplete || !me.userId) { close(); return; }
    show(me);
  }

  window.ProfileGate = { open: show, close: close };
  window.addEventListener('user-auth', function (e) { consider(e.detail); });
  if (window.userAuth) window.userAuth.ready().then(consider);
})();
