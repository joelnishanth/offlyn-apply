/**
 * Popup UI logic — simplified single-page interface
 */

import type { PopupState } from '../shared/types';
import { getSettings, setSettings, getTodayApplications, generateSummaryMessage } from '../shared/storage';
import { log, error } from '../shared/log';

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

  // Connection status
  const statusEl = document.getElementById('status');
  if (statusEl) {
    if (currentState.nativeHostConnected) {
      statusEl.textContent = 'Ollama Connected';
      statusEl.className = 'conn conn-ok';
    } else {
      statusEl.textContent = 'Ollama Disconnected';
      statusEl.className = 'conn conn-err';
    }
  }

  // Job info
  const jobInfoEl = document.getElementById('job-info');
  if (jobInfoEl) {
    if (currentState.lastJob) {
      const title = currentState.lastJob.title || 'Unknown Title';
      const ats = currentState.lastJob.atsHint ? ` (${currentState.lastJob.atsHint})` : '';
      jobInfoEl.innerHTML = `
        <div class="job-bar-title">${escapeHtml(title)}${escapeHtml(ats)}</div>
        <div>${escapeHtml(currentState.lastJob.hostname || '')}</div>
      `;
    } else {
      jobInfoEl.innerHTML = '<div class="job-bar-empty">No job detected yet</div>';
    }
  }
}

async function updateStats(): Promise<void> {
  try {
    const summary = await getTodayApplications();
    const total = summary.applications.length;
    const submitted = summary.applications.filter(a => a.status === 'submitted').length;
    const detected = total - submitted;

    const subEl = document.getElementById('stat-submitted');
    const detEl = document.getElementById('stat-detected');
    if (subEl) subEl.textContent = String(submitted);
    if (detEl) detEl.textContent = String(detected);
  } catch (err) {
    error('Failed to update stats:', err);
  }
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
      updateStats();
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

async function init(): Promise<void> {
  const settings = await getSettings();
  currentState.enabled = settings.enabled;
  currentState.dryRun = settings.dryRun;
  requestState();

  // ── Manage Profile (single button → onboarding page) ──
  document.getElementById('profile-btn')?.addEventListener('click', () => {
    browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
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
        updateStats();
      }
    }
  });

  // Initial render
  updateUI();
  updateStats();

  // Poll
  setInterval(() => { requestState(); updateStats(); }, 3000);

  log('Popup initialized');
}

init();
