// Edit mode for the authorization forms.
//
// Opening a form with ?record=<id> (from the admin submissions lists) loads
// that saved record into the real form so it can be reviewed, corrected and
// reprinted. Because the records hold applicant personal details, the admin
// sign-in is required — but only in this mode: firebase-config.js and
// admin-auth.js are imported on demand, so the public form is never gated.
//
// In edit mode the silent autosave is switched off and Save writes back to
// the SAME record through the admin-only PUT, so editing can never spawn a
// duplicate. The page exposes window.__formEditMode for its autosave guard.
(function () {
  var params = new URLSearchParams(location.search);
  var recordId = params.get('record');
  if (!recordId) return;

  var endpoint = document.body.dataset.recordEndpoint;   // e.g. /salary-deductions
  var formLabel = document.body.dataset.recordLabel || 'record';
  if (!endpoint) return;

  window.__formEditMode = true;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function bar() {
    var el = document.getElementById('record-bar');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'record-bar';
    el.className = 'record-bar';
    var toolbar = document.querySelector('.toolbar');
    toolbar.parentNode.insertBefore(el, toolbar.nextSibling);
    return el;
  }

  function setBar(html) { bar().innerHTML = html; }

  function fmtWhen(v) {
    if (!v) return '';
    if (typeof v === 'object' && v._seconds) return new Date(v._seconds * 1000).toLocaleString();
    try { return new Date(v).toLocaleString(); } catch (e) { return String(v); }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  // Record fields are stored under the same ids the form uses, so filling the
  // form is a straight id lookup; anything unknown (draftId, timestamps) is
  // simply skipped.
  function populate(record) {
    var filled = 0;
    Object.keys(record).forEach(function (key) {
      var el = document.getElementById(key);
      if (!el || !('value' in el)) return;
      el.value = record[key];
      filled++;
    });
    // Keep the saved amounts exactly as they were rather than letting the
    // form recalculate over them.
    try {
      if (typeof deductionAmountOverridden !== 'undefined') deductionAmountOverridden = true;
    } catch (e) {}
    try {
      if (typeof orderAmountOverridden !== 'undefined') orderAmountOverridden = true;
    } catch (e) {}
    try {
      if (typeof activeTermInput !== 'undefined') activeTermInput = 'total';
    } catch (e) {}
    if (typeof updateSchedule === 'function') updateSchedule();
    return filled;
  }

  function collect() {
    return typeof collectFormData === 'function' ? collectFormData() : {};
  }

  async function save(record) {
    var status = document.getElementById('record-save-status');
    var btn = document.getElementById('record-save-btn');
    btn.disabled = true;
    status.textContent = 'Saving…';
    try {
      var res = await window.adminAuth.fetch(endpoint + '/' + encodeURIComponent(recordId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect())
      });
      var json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || ('HTTP ' + res.status));
      status.textContent = 'Saved ' + new Date().toLocaleTimeString();
    } catch (err) {
      status.textContent = 'Save failed: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function start() {
    setBar('<span class="record-bar-tag">Edit mode</span><span class="record-bar-msg">Signing in to load the saved ' + esc(formLabel) + '…</span>');
    try {
      if (!window.FIREBASE_CONFIG) await loadScript('firebase-config.js');
      if (!window.adminAuth) await import('./admin-auth.js');
      await window.adminAuth.ready();

      var res = await window.adminAuth.fetch(endpoint + '/' + encodeURIComponent(recordId));
      var json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || ('HTTP ' + res.status));

      var record = json.record;
      populate(record);

      var who = [record.borrowerName, record.employer].filter(Boolean).join(' · ');
      setBar(
        '<span class="record-bar-tag">Edit mode</span>' +
        '<span class="record-bar-msg"><strong>' + esc(who || 'Saved record') + '</strong>' +
        (record.submittedAt ? ' — submitted ' + esc(fmtWhen(record.submittedAt)) : '') +
        '. Changes update this record; autosave is off.</span>' +
        '<span class="record-bar-actions">' +
        '<span id="record-save-status" class="record-bar-status"></span>' +
        '<button type="button" id="record-save-btn" class="record-bar-btn primary">Save changes</button>' +
        '<a href="' + location.pathname + '" class="record-bar-btn">New blank form</a>' +
        '</span>'
      );
      document.getElementById('record-save-btn').addEventListener('click', function () { save(record); });
    } catch (err) {
      setBar('<span class="record-bar-tag error">Edit mode</span><span class="record-bar-msg">Could not load this ' +
        esc(formLabel) + ': ' + esc(err.message) + '</span>' +
        '<span class="record-bar-actions"><a href="' + location.pathname + '" class="record-bar-btn">New blank form</a></span>');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
