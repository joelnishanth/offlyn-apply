/**
 * Popup UI logic — simplified single-page interface
 */

import type { PopupState } from '../shared/types';
import { getSettings, setSettings, getTodayApplications, generateSummaryMessage } from '../shared/storage';
import { log, error } from '../shared/log';
import { getUserProfile, checkProfileCompleteness } from '../shared/profile';
import { setHTML } from '../shared/html';

let currentState: PopupState = {
  enabled: true,
  dryRun: false,
  nativeHostConnected: false,
  lastError: null,
  lastJob: null,
};

// ── UI Updates ─────────────────────────────────────────────────────────────

function updateUI(): void {
  // Enabled toggle (in header)
  const enabledToggle = document.getElementById('enabled-toggle');
  if (enabledToggle) enabledToggle.classList.toggle('active', currentState.enabled);

  // Dry run toggle
  const dryrunToggle = document.getElementById('dryrun-toggle');
  if (dryrunToggle) dryrunToggle.classList.toggle('active', currentState.dryRun);

  // Ollama status
  const ollamaStatusEl = document.getElementById('ollama-status');
  if (ollamaStatusEl) {
    if (currentState.nativeHostConnected) {
      ollamaStatusEl.textContent = 'Connected';
      ollamaStatusEl.className = 'ollama-status connected';
    } else {
      ollamaStatusEl.textContent = 'Disconnected';
      ollamaStatusEl.className = 'ollama-status disconnected';
    }
  }

  // Make ollama-bar clickable only when disconnected → opens AI Setup onboarding
  const ollamaBar = document.getElementById('ollama-bar');
  if (ollamaBar) {
    if (currentState.nativeHostConnected) {
      ollamaBar.classList.remove('clickable');
      ollamaBar.title = '';
      ollamaBar.onclick = null;
    } else {
      ollamaBar.classList.add('clickable');
      ollamaBar.title = 'Click to set up AI';
      ollamaBar.onclick = () => {
        browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
        window.close();
      };
    }
  }

  // Job info
  const jobInfoEl = document.getElementById('job-info');
  if (jobInfoEl) {
    if (currentState.lastJob) {
      const title = currentState.lastJob.title || 'Unknown Title';
      const company = currentState.lastJob.hostname || '';
      setHTML(jobInfoEl, `
        <div class="job-bar-detected">
          <div class="job-dot"></div>
          <div>
            <div class="job-bar-label">Job Page Detected</div>
            <div class="job-bar-detail">${escapeHtml(title)} &middot; ${escapeHtml(company)}</div>
          </div>
        </div>
      `);
    } else {
      setHTML(jobInfoEl, '<div class="job-bar-empty">No job detected yet</div>');
    }
  }
}

function updateStats(total: number, interviewing: number): void {
  const totalEl = document.getElementById('stat-total');
  const interviewingEl = document.getElementById('stat-interviewing');
  if (totalEl) totalEl.textContent = String(total);
  if (interviewingEl) interviewingEl.textContent = String(interviewing);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function requestState(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_STATE' });
    if (response && response.kind === 'STATE_UPDATE') {
      currentState = {
        ...currentState,
        enabled: response.enabled ?? currentState.enabled,
        dryRun: response.dryRun ?? currentState.dryRun,
        nativeHostConnected: response.nativeHostConnected ?? currentState.nativeHostConnected,
        lastError: response.lastError ?? currentState.lastError,
        lastJob: response.lastJob ?? currentState.lastJob,
      };
      updateUI();
      // Stats come from background (reliable storage access)
      updateStats(response.statTotal ?? 0, response.statInterviewing ?? 0);
    }
  } catch (err) {
    error('Failed to request state:', err);
  }
}

async function executeOnActiveTab(code: string): Promise<void> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    await browser.tabs.executeScript(tabs[0].id, { code });
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

function setActionButtonsDisabled(disabled: boolean): void {
  const autofillBtn = document.getElementById('manual-autofill-btn') as HTMLButtonElement | null;
  const coverBtn = document.getElementById('cover-letter-btn') as HTMLButtonElement | null;
  [autofillBtn, coverBtn].forEach(btn => {
    if (!btn) return;
    btn.disabled = disabled;
    btn.classList.toggle('btn-no-profile', disabled);
  });
}

async function checkProfileStatus(): Promise<void> {
  try {
    const profile = await getUserProfile();
    const warningEl = document.getElementById('profile-warning');
    if (!warningEl) return;

    if (!profile) {
      warningEl.style.display = 'block';
      setHTML(warningEl, '<strong>No profile found.</strong> <a href="#" id="profile-warning-link" style="color:#ea580c;text-decoration:underline;">Set up your profile</a> to enable auto-fill.');
      warningEl.querySelector('#profile-warning-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
        window.close();
      });
      setActionButtonsDisabled(true);
      return;
    }

    const completeness = checkProfileCompleteness(profile);
    log(`Profile completeness: ${completeness.completionPercentage}% (missing: ${completeness.missingFields.join(', ') || 'none'})`);

    if (completeness.completionPercentage < 70) {
      const missing = completeness.missingFields.slice(0, 4).join(', ');
      const moreCount = completeness.missingFields.length - 4;
      const moreText = moreCount > 0 ? ` +${moreCount} more` : '';
      warningEl.style.display = 'block';
      setHTML(warningEl, `<strong>Profile ${completeness.completionPercentage}% complete.</strong> Missing: ${missing}${moreText}. <a href="#" id="profile-warning-link" style="color:#ea580c;text-decoration:underline;">Complete profile</a>`);
      warningEl.querySelector('#profile-warning-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
        window.close();
      });
      setActionButtonsDisabled(false);
    } else {
      warningEl.style.display = 'none';
      setActionButtonsDisabled(false);
    }
  } catch (err) {
    error('Failed to check profile status:', err);
  }
}

async function init(): Promise<void> {
  const settings = await getSettings();
  currentState.enabled = settings.enabled;
  currentState.dryRun = settings.dryRun;
  requestState();
  checkProfileStatus();

  // ── Manage Profile (single button → onboarding page) ──
  document.getElementById('profile-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
    window.close();
  });

  // ── View Dashboard ──
  document.getElementById('view-dashboard-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('dashboard/dashboard.html') });
    window.close();
  });

  document.getElementById('chat-resume-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('chat/chat.html') });
    window.close();
  });

  document.getElementById('data-explorer-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('data/data.html') });
    window.close();
  });

  // ── Footer links ──
  document.getElementById('home-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('home/home.html') });
    window.close();
  });
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('settings/settings.html') });
    window.close();
  });
  document.getElementById('help-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('help/help.html') });
    window.close();
  });
  document.getElementById('privacy-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('privacy/privacy.html') });
    window.close();
  });

  // ── Auto-Fill ──
  document.getElementById('manual-autofill-btn')?.addEventListener('click', async () => {
    try {
      await executeOnActiveTab(`window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));`);
      window.close();
    } catch (err) { error('Autofill trigger failed:', err); }
  });

  // ── Cover Letter ──
  document.getElementById('cover-letter-btn')?.addEventListener('click', async () => {
    try {
      await executeOnActiveTab(`window.dispatchEvent(new CustomEvent('offlyn-generate-cover-letter'));`);
      window.close();
    } catch (err) { error('Cover letter trigger failed:', err); }
  });

  // ── Enabled toggle ──
  document.getElementById('enabled-toggle')?.addEventListener('click', async () => {
    currentState.enabled = !currentState.enabled;
    await setSettings({ enabled: currentState.enabled });
    updateUI();
  });

  // ── Dry Run toggle ──
  document.getElementById('dryrun-toggle')?.addEventListener('click', async () => {
    currentState.dryRun = !currentState.dryRun;
    await setSettings({ dryRun: currentState.dryRun });
    updateUI();
  });

  // ── Advanced panel toggle ──
  const advToggle = document.getElementById('advanced-toggle');
  const advPanel = document.getElementById('advanced-panel');
  if (advToggle && advPanel) {
    advToggle.addEventListener('click', () => {
      const isOpen = advPanel.classList.toggle('open');
      advToggle.classList.toggle('open', isOpen);
    });
  }

  // ── View Learned Values ──
  document.getElementById('view-learned-btn')?.addEventListener('click', async () => {
    try {
      await browser.storage.local.set({ showLearnedValues: true });
      browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
      window.close();
    } catch (err) { error('Failed to open learned values:', err); }
  });

  // ── Clean Self-ID Data ──
  document.getElementById('clean-selfid-btn')?.addEventListener('click', async () => {
    try {
      if (!confirm('Reset Self-ID data (Gender, Race, Disability, Veteran Status) to defaults?\n\nYour personal info and work history will not be affected.')) return;

      const result = await browser.storage.local.get('userProfile');
      const profile = result.userProfile;
      if (!profile) { alert('No profile found. Set up your profile first.'); return; }

      profile.selfId = {
        gender: [], race: [], orientation: [],
        veteran: 'Decline to self-identify',
        transgender: 'Decline to self-identify',
        disability: 'Decline to self-identify',
      };
      profile.lastUpdated = Date.now();
      await browser.storage.local.set({ userProfile: profile });

      const btn = document.getElementById('clean-selfid-btn') as HTMLButtonElement;
      if (btn) { btn.textContent = 'Done!'; setTimeout(() => { btn.textContent = 'Clean Self-ID Data'; }, 1500); }
    } catch (err) { error('Failed to clean Self-ID:', err); }
  });

  // ── Debug Profile ──
  document.getElementById('debug-profile-btn')?.addEventListener('click', async () => {
    try {
      const result = await browser.storage.local.get('userProfile');
      const profile = result.userProfile;
      if (!profile) { alert('No profile found.'); return; }

      const text = JSON.stringify(profile, null, 2);
      await navigator.clipboard.writeText(text);
      console.log('Profile data:', profile);

      const btn = document.getElementById('debug-profile-btn') as HTMLButtonElement;
      if (btn) { btn.textContent = 'Copied to clipboard!'; setTimeout(() => { btn.textContent = 'Debug Profile Data'; }, 1500); }
    } catch (err) { error('Failed to debug profile:', err); }
  });

  // ── Copy Summary ──
  document.getElementById('copy-summary-btn')?.addEventListener('click', async () => {
    try {
      const summary = await getTodayApplications();
      const message = generateSummaryMessage(summary);
      await navigator.clipboard.writeText(message);

      const btn = document.getElementById('copy-summary-btn') as HTMLButtonElement;
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Daily Summary'; }, 1500); }
    } catch (err) { error('Failed to copy summary:', err); }
  });

  // ── State updates from background ──
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message === 'object' && message !== null && 'kind' in message) {
      if (message.kind === 'STATE_UPDATE') {
        const update = message as Partial<PopupState> & { kind: string };
        currentState = {
          ...currentState,
          enabled: update.enabled ?? currentState.enabled,
          dryRun: update.dryRun ?? currentState.dryRun,
          nativeHostConnected: update.nativeHostConnected ?? currentState.nativeHostConnected,
          lastError: update.lastError ?? currentState.lastError,
          lastJob: update.lastJob ?? currentState.lastJob,
        };
        updateUI();
        const upd = update as any;
        updateStats(upd.statTotal ?? 0, upd.statInterviewing ?? 0);
      }
    }
  });

  // Initial render
  updateUI();
  // Stats are loaded via requestState() → background reads storage
  requestState();

  // Poll every 3s — background will return fresh stats each time
  setInterval(() => requestState(), 3000);

  log('Popup initialized');
}

init();
