// Google tag (gtag.js) — single shared include for every page.
// Add to a page with: <script src="/analytics.js"></script> immediately after <head>.
// Google tag ID: G-6VTM5DBDXJ  (don't add more than one Google tag per page)
(function () {
  var GTAG_ID = 'G-6VTM5DBDXJ';
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GTAG_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GTAG_ID);
})();
