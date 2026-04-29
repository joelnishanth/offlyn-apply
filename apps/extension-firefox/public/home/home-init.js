(function () {
  document.getElementById('navDashboardCard')?.addEventListener('click', () =>
    document.getElementById('navDashboard')?.click());
  document.getElementById('navDashboardSide')?.addEventListener('click', () =>
    document.getElementById('navDashboard')?.click());
  document.getElementById('navProfileSide')?.addEventListener('click', () =>
    document.getElementById('navProfile')?.click());
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => {
      const total = document.getElementById('statTotal')?.textContent;
      if (total) document.getElementById('dashBadge').textContent = total + ' Applications';
    });
    const el = document.getElementById('statTotal');
    if (el) observer.observe(el, { childList: true, characterData: true, subtree: true });
  });
})();
