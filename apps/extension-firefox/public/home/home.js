(async function () {
  const OLLAMA_URL = 'http://localhost:11434/api/tags';

  // Build an array of dailySummary_YYYY-MM-DD keys for the past N days.
  // Avoids browser.storage.local.get(null) which is unreliable in Firefox.
  function buildDailySummaryKeys(daysBack) {
    const keys = [];
    const today = new Date();
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      keys.push('dailySummary_' + d.toISOString().split('T')[0]);
    }
    return keys;
  }

  function openPage(path) {
    browser.tabs.create({ url: browser.runtime.getURL(path) });
  }

  // --- Navigation ---
  document.getElementById('navDashboard').addEventListener('click', () => openPage('dashboard/dashboard.html'));
  document.getElementById('navProfile').addEventListener('click', () => openPage('onboarding/onboarding.html'));
  document.getElementById('navLearned').addEventListener('click', async () => {
    await browser.storage.local.set({ showLearnedValues: true });
    openPage('onboarding/onboarding.html');
  });
  document.getElementById('navSettings').addEventListener('click', () => openPage('settings/settings.html'));
  document.getElementById('navHelp').addEventListener('click', () => openPage('help/help.html'));
  document.getElementById('navPrivacy').addEventListener('click', () => openPage('privacy/privacy.html'));
  document.getElementById('footerPrivacy').addEventListener('click', () => openPage('privacy/privacy.html'));
  document.getElementById('footerHelp').addEventListener('click', () => openPage('help/help.html'));
  document.getElementById('footerSettings').addEventListener('click', () => openPage('settings/settings.html'));

  // CTA button
  document.getElementById('ctaSetup').addEventListener('click', () => openPage('onboarding/onboarding.html'));

  // --- Quick actions ---
  document.getElementById('actionExport').addEventListener('click', async () => {
    try {
      const data = await browser.storage.local.get('userProfile');
      if (!data.userProfile) {
        alert('No profile to export. Set up your profile first.');
        return;
      }
      const blob = new Blob([JSON.stringify(data.userProfile, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'offlyn-apply-profile.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  });

  document.getElementById('actionClear').addEventListener('click', async () => {
    if (!confirm('Clear all tracked job applications? This cannot be undone.')) return;
    try {
      // Build keys for past 365 days using dailySummary_ prefix
      const keysToRemove = buildDailySummaryKeys(365);
      await browser.storage.local.remove(keysToRemove);
      document.getElementById('statTotal').textContent = '0';
      document.getElementById('statInterviewing').textContent = '0';
      document.getElementById('statThisWeek').textContent = '0';
      if (document.getElementById('statRate')) {
        document.getElementById('statRate').textContent = '0%';
      }
    } catch (err) {
      console.error('Clear failed:', err);
    }
  });

  // --- Load stats ---
  try {
    const keys = buildDailySummaryKeys(365);
    const all = await browser.storage.local.get(keys);
    let total = 0;
    let interviewing = 0;
    let thisWeek = 0;
    let responded = 0;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const key of keys) {
      const summary = all[key];
      if (!summary || !Array.isArray(summary.applications)) continue;
      for (const app of summary.applications) {
        if (app.status === 'detected') continue; // skip unsubmitted detections
        total++;
        if (app.status === 'interviewing') interviewing++;
        if (app.status === 'interviewing' || app.status === 'rejected' || app.status === 'accepted') responded++;
        if (app.timestamp && app.timestamp > weekAgo) thisWeek++;
      }
    }

    const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

    document.getElementById('statTotal').textContent = String(total);
    document.getElementById('statInterviewing').textContent = String(interviewing);
    document.getElementById('statThisWeek').textContent = String(thisWeek);
    const rateEl = document.getElementById('statRate');
    if (rateEl) rateEl.textContent = responseRate + '%';
  } catch (err) {
    console.error('Failed to load stats:', err);
  }

  // --- Profile completion ---
  try {
    const data = await browser.storage.local.get('userProfile');
    const profile = data.userProfile;

    if (profile) {
      let filled = 0;
      let fields = 0;

      const check = (val) => { fields++; if (val && String(val).trim()) filled++; };

      check(profile.personal?.firstName);
      check(profile.personal?.lastName);
      check(profile.personal?.email);
      check(profile.personal?.phone);
      check(profile.personal?.location);
      check(profile.professional?.linkedin);
      check(profile.professional?.github);
      check(profile.professional?.portfolio);
      check(profile.skills?.length > 0 ? 'yes' : '');
      check(profile.summary);

      const pct = fields > 0 ? Math.round((filled / fields) * 100) : 0;
      document.getElementById('profileFill').style.width = pct + '%';
      document.getElementById('profilePct').textContent = pct + '%';

      if (pct >= 80) {
        document.getElementById('profileLabel').textContent = 'Profile Complete';
        document.getElementById('ctaTitle').textContent = 'Edit Your Profile';
        document.getElementById('ctaSubtitle').textContent = 'Update your resume info or add new details';
      } else if (pct > 0) {
        document.getElementById('profileLabel').textContent = 'Profile In Progress';
        document.getElementById('ctaTitle').textContent = 'Continue Profile Setup';
        document.getElementById('ctaSubtitle').textContent = 'Finish filling in your details for best results';
      }
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }

  // --- Ollama status ---
  try {
    const res = await fetch(OLLAMA_URL, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      document.getElementById('ollamaDot').classList.add('connected');
      document.getElementById('ollamaText').textContent = 'Ollama connected - AI features available';
      document.getElementById('ollamaStatus').classList.add('connected');
    } else {
      throw new Error('not ok');
    }
  } catch {
    document.getElementById('ollamaDot').classList.add('disconnected');
    document.getElementById('ollamaText').textContent = 'Ollama not detected — click to set up AI';
    const chip = document.getElementById('ollamaStatus');
    if (chip) {
      chip.classList.add('clickable');
      chip.title = 'Click to set up AI';
      chip.addEventListener('click', () => openPage('onboarding/onboarding.html'));
    }
  }
})();
