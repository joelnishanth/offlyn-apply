(function () {
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var params = new URLSearchParams(window.location.search);
  var tabId = parseInt(params.get('tabId') || '', 10);
  if (!tabId) {
    document.getElementById('job-title').textContent = 'No job info';
    return;
  }
  api.runtime.sendMessage({ kind: 'GET_JOB_FOR_TAB', tabId: tabId }, function (response) {
    var lastJob = response && response.lastJob;
    if (lastJob) {
      document.getElementById('job-title').textContent = lastJob.title || 'Job application';
      var companyEl = document.getElementById('job-company');
      companyEl.textContent = lastJob.company ? 'at ' + lastJob.company : '';
      companyEl.style.display = lastJob.company ? '' : 'none';
      document.getElementById('job-hostname').textContent = lastJob.hostname || '';
    }
  });
  document.getElementById('btn-focus').addEventListener('click', function () {
    api.tabs.get(tabId).then(function (tab) {
      api.tabs.update(tabId, { active: true });
      api.windows.update(tab.windowId, { focused: true });
      window.close();
    }).catch(function () {});
  });
  document.getElementById('link-onboarding').addEventListener('click', function (e) {
    e.preventDefault();
    api.tabs.create({ url: api.runtime.getURL('onboarding/onboarding.html') });
    window.close();
  });
})();
