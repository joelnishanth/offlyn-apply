/**
 * Offlyn Apply — Shared Dark Mode Manager
 * - Auto-detects night time (before 7am or after 8pm) as default
 * - Persists user preference to localStorage
 * - Wires up any element with id="dark-mode-toggle"
 */
(function () {
  var KEY = 'ofl-dark-mode';

  var MOON_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN_SVG  = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

  function getPref() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }

  function setPref(val) {
    try { localStorage.setItem(KEY, val); } catch (_) {}
    // Sync across extension pages via browser.storage
    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        browser.storage.local.set({ 'ofl-dark-mode': val });
      }
    } catch (_) {}
  }

  function _setHTML(el, html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var frag = document.createDocumentFragment();
    Array.from(doc.body.childNodes).forEach(function (n) { frag.appendChild(document.adoptNode(n)); });
    el.replaceChildren(frag);
  }

  function updateButton(btn, isDark) {
    if (!btn) return;
    _setHTML(btn, isDark ? SUN_SVG : MOON_SVG);
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }

  function applyTheme(isDark) {
    document.documentElement.classList.toggle('dark', isDark);
    updateButton(document.getElementById('dark-mode-toggle'), isDark);
  }

  function init() {
    var btn = document.getElementById('dark-mode-toggle');
    if (!btn) return;

    var isDark = document.documentElement.classList.contains('dark');
    updateButton(btn, isDark);

    btn.addEventListener('click', function () {
      var nowDark = !document.documentElement.classList.contains('dark');
      applyTheme(nowDark);
      setPref(nowDark ? 'dark' : 'light');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.offlynDarkMode = { applyTheme: applyTheme, getPref: getPref, setPref: setPref };
})();
