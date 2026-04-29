/**
 * Theme Init — must load in <head> BEFORE any CSS to prevent FOUC.
 * Reads persisted preference, falls back to time-based auto (dark before 7am or after 8pm).
 */
(function () {
  var KEY = 'ofl-dark-mode';
  var pref;
  try { pref = localStorage.getItem(KEY); } catch (_) {}
  var isDark;
  if (pref === 'dark')       isDark = true;
  else if (pref === 'light') isDark = false;
  else { var h = new Date().getHours(); isDark = h < 7 || h >= 20; }
  if (isDark) document.documentElement.classList.add('dark');
})();
