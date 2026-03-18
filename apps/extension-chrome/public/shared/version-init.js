/**
 * Version Init — reads the extension version from manifest.json at runtime.
 * manifest.json is the single source of truth; no HTML file should ever
 * contain a hardcoded version string.
 *
 * Usage in HTML:
 *   <span data-version></span>    → renders "0.3.0"
 *   <span data-version-v></span>  → renders "v0.3.0"
 *
 * Add <script src="../shared/version-init.js"></script> to any page that
 * needs to display the version number.
 */
(function () {
  function applyVersion() {
    var version = '—';
    try {
      var rt = typeof browser !== 'undefined' ? browser : chrome;
      version = rt.runtime.getManifest().version || version;
    } catch (_) {}

    [].forEach.call(document.querySelectorAll('[data-version]'), function (el) {
      el.textContent = version;
    });

    [].forEach.call(document.querySelectorAll('[data-version-v]'), function (el) {
      el.textContent = 'v' + version;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersion);
  } else {
    applyVersion();
  }
})();
