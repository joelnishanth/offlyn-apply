/**
 * Popup UI logic
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

/**
 * Update UI from state
 */
function updateUI(): void {
  // Update toggles
  const enabledToggle = document.getElementById('enabled-toggle');
  const dryrunToggle = document.getElementById('dryrun-toggle');
  
  if (enabledToggle) {
    enabledToggle.classList.toggle('active', currentState.enabled);
  }
  if (dryrunToggle) {
    dryrunToggle.classList.toggle('active', currentState.dryRun);
  }
  
  // Update status
  const statusEl = document.getElementById('status');
  const errorTextEl = document.getElementById('error-text');
  
  if (statusEl) {
    if (currentState.nativeHostConnected) {
      statusEl.textContent = 'Native Host Connected';
      statusEl.className = 'status connected';
      if (errorTextEl) {
        errorTextEl.style.display = 'none';
      }
    } else {
      statusEl.textContent = 'Native Host Disconnected';
      statusEl.className = 'status disconnected';
      if (errorTextEl && currentState.lastError) {
        errorTextEl.textContent = currentState.lastError;
        errorTextEl.style.display = 'block';
      } else if (errorTextEl) {
        errorTextEl.style.display = 'none';
      }
    }
  }
  
  // Update job info
  const jobInfoEl = document.getElementById('job-info');
  if (jobInfoEl) {
    if (currentState.lastJob) {
      const title = currentState.lastJob.title || 'Unknown Title';
      const ats = currentState.lastJob.atsHint ? ` (${currentState.lastJob.atsHint})` : '';
      const hostname = currentState.lastJob.hostname;
      
      jobInfoEl.innerHTML = `
        <div class="job-info-title">${escapeHtml(title)}${escapeHtml(ats)}</div>
        <div class="job-info-meta">${escapeHtml(hostname)}</div>
      `;
    } else {
      jobInfoEl.innerHTML = '<div class="job-info-empty">No job detected yet</div>';
    }
  }
}

/**
 * Update summary count
 */
async function updateSummaryCount(): Promise<void> {
  try {
    const summary = await getTodayApplications();
    const countEl = document.getElementById('summary-count');
    
    if (countEl) {
      const total = summary.applications.length;
      const submitted = summary.applications.filter(a => a.status === 'submitted').length;
      const detected = total - submitted;
      
      if (total === 0) {
        countEl.innerHTML = 'No applications today yet';
      } else {
        countEl.innerHTML = `
          <strong>${total}</strong> application${total !== 1 ? 's' : ''} today
          <br>
          <span style="font-size: 12px;">✅ ${submitted} submitted · 👁️ ${detected} detected</span>
        `;
      }
    }
  } catch (err) {
    error('Failed to update summary count:', err);
  }
}

/**
 * Copy daily summary to clipboard
 */
async function copySummary(): Promise<void> {
  const btn = document.getElementById('copy-summary-btn') as HTMLButtonElement;
  const statusEl = document.getElementById('summary-status');
  const textArea = document.getElementById('summary-text') as HTMLTextAreaElement;
  
  if (!btn || !statusEl || !textArea) return;
  
  try {
    const summary = await getTodayApplications();
    const message = generateSummaryMessage(summary);
    
    // Show the text area with the message
    textArea.value = message;
    textArea.style.display = 'block';
    
    // Copy to clipboard
    await navigator.clipboard.writeText(message);
    
    statusEl.textContent = '✅ Summary copied to clipboard!';
    statusEl.className = 'summary-status success';
    statusEl.style.display = 'block';
    
    // Hide status after 3 seconds
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 3000);
  } catch (err) {
    error('Failed to copy summary:', err);
    if (statusEl) {
      statusEl.textContent = '❌ Failed to copy summary';
      statusEl.className = 'summary-status error';
      statusEl.style.display = 'block';
    }
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Request state from background
 */
async function requestState(): Promise<void> {
  try {
    await browser.runtime.sendMessage({ kind: 'GET_STATE' });
  } catch (err) {
    error('Failed to request state:', err);
  }
}

/**
 * Initialize popup
 */
async function init(): Promise<void> {
  // Load current settings
  const settings = await getSettings();
  currentState.enabled = settings.enabled;
  currentState.dryRun = settings.dryRun;
  
  // Request state from background
  requestState();
  
  // Setup profile button
  const setupBtn = document.getElementById('setup-profile-btn');
  if (setupBtn) {
    setupBtn.addEventListener('click', () => {
      browser.tabs.create({
        url: browser.runtime.getURL('onboarding/onboarding.html')
      });
    });
  }
  
  // Edit Profile button
  const editProfileBtn = document.getElementById('edit-profile-btn');
  if (editProfileBtn) {
    editProfileBtn.addEventListener('click', () => {
      // Open onboarding page which will pre-fill with existing profile data
      browser.tabs.create({
        url: browser.runtime.getURL('onboarding/onboarding.html')
      });
    });
  }
  
  // View Learned Values button
  const viewLearnedBtn = document.getElementById('view-learned-btn');
  if (viewLearnedBtn) {
    viewLearnedBtn.addEventListener('click', async () => {
      try {
        // Open the onboarding page with a flag to show learned values
        await browser.storage.local.set({ showLearnedValues: true });
        browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
        window.close();
      } catch (err) {
        error('Failed to open learned values:', err);
        alert('Failed to open learned values. Check console for errors.');
      }
    });
  }
  
  // Clean Self-ID Data button
  const cleanSelfIdBtn = document.getElementById('clean-selfid-btn');
  if (cleanSelfIdBtn) {
    cleanSelfIdBtn.addEventListener('click', async () => {
      try {
        const btn = cleanSelfIdBtn as HTMLButtonElement;
        const originalText = btn.textContent;
        
        // Show confirmation
        if (!confirm('This will reset your Self-ID data (Gender, Race, Disability, Veteran Status) to default values. Your personal info and work history will not be affected.\n\nContinue?')) {
          return;
        }
        
        btn.disabled = true;
        btn.textContent = '🧹 Cleaning...';
        
        // Load current profile
        const result = await browser.storage.local.get('userProfile');
        const profile = result.userProfile;
        
        if (!profile) {
          alert('No profile found. Please set up your profile first.');
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }
        
        // Clean Self-ID data with proper defaults
        profile.selfId = {
          gender: [],  // Empty - user can fill in onboarding
          race: [],  // Empty - user can fill in onboarding
          orientation: [],  // Empty - user can fill in onboarding
          veteran: 'Decline to self-identify',  // Safe default
          transgender: 'Decline to self-identify',  // Safe default
          disability: 'Decline to self-identify'  // Safe default
        };
        
        // Save the cleaned profile
        profile.lastUpdated = Date.now();
        await browser.storage.local.set({ userProfile: profile });
        
        btn.textContent = '✅ Cleaned!';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = originalText;
        }, 2000);
        
        log('Self-ID data cleaned successfully');
      } catch (err) {
        error('Failed to clean Self-ID data:', err);
        const btn = cleanSelfIdBtn as HTMLButtonElement;
        btn.textContent = '❌ Failed';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '🧹 Clean Self-ID Data';
        }, 2000);
      }
    });
  }
  
  // Debug Profile Data button
  const debugProfileBtn = document.getElementById('debug-profile-btn');
  if (debugProfileBtn) {
    debugProfileBtn.addEventListener('click', async () => {
      try {
        // Load current profile
        const result = await browser.storage.local.get('userProfile');
        const profile = result.userProfile;
        
        if (!profile) {
          alert('No profile found. Please set up your profile first.');
          return;
        }
        
        // Create detailed debug report
        const report = {
          'Personal Info': {
            firstName: profile.personal?.firstName || '(empty)',
            lastName: profile.personal?.lastName || '(empty)',
            email: profile.personal?.email || '(empty)',
            phone: profile.personal?.phone || '(empty)',
            location: profile.personal?.location || '(empty)',
          },
          'Self-ID Data': profile.selfId || '(not set)',
          'Work Auth Data': profile.workAuth || '(not set)',
        };
        
        // Format as readable text
        let debugText = '=== PROFILE DEBUG REPORT ===\n\n';
        
        debugText += '📋 PERSONAL INFO:\n';
        debugText += `  First Name: ${report['Personal Info'].firstName}\n`;
        debugText += `  Last Name: ${report['Personal Info'].lastName}\n`;
        debugText += `  Email: ${report['Personal Info'].email}\n`;
        debugText += `  Phone: ${report['Personal Info'].phone}\n`;
        debugText += `  Location: ${report['Personal Info'].location}\n\n`;
        
        debugText += '🏳️ SELF-ID DATA:\n';
        if (typeof report['Self-ID Data'] === 'string') {
          debugText += `  ${report['Self-ID Data']}\n\n`;
        } else {
          const selfId = profile.selfId;
          debugText += `  Gender: ${JSON.stringify(selfId.gender || [])}\n`;
          debugText += `  Race: ${JSON.stringify(selfId.race || [])}\n`;
          debugText += `  Orientation: ${JSON.stringify(selfId.orientation || [])}\n`;
          debugText += `  Veteran: ${selfId.veteran || '(empty)'}\n`;
          debugText += `  Transgender: ${selfId.transgender || '(empty)'}\n`;
          debugText += `  Disability: ${selfId.disability || '(empty)'}\n\n`;
        }
        
        debugText += '💼 WORK AUTH DATA:\n';
        if (typeof report['Work Auth Data'] === 'string') {
          debugText += `  ${report['Work Auth Data']}\n\n`;
        } else {
          const workAuth = profile.workAuth;
          debugText += `  Requires Sponsorship: ${workAuth.requiresSponsorship}\n`;
          debugText += `  Legally Authorized: ${workAuth.legallyAuthorized}\n`;
          debugText += `  Current Status: ${workAuth.currentStatus || '(empty)'}\n`;
          debugText += `  Visa Type: ${workAuth.visaType || '(empty)'}\n\n`;
        }
        
        debugText += '=== ISSUES DETECTED ===\n';
        
        // Check for common issues
        const issues: string[] = [];
        
        if (profile.selfId) {
          // Check if race contains location data
          if (profile.selfId.race && Array.isArray(profile.selfId.race)) {
            const raceStr = JSON.stringify(profile.selfId.race).toLowerCase();
            if (raceStr.includes('palo alto') || raceStr.includes('california') || 
                raceStr.includes('resident') || raceStr.includes('citizen')) {
              issues.push('⚠️ Race field contains LOCATION/CITIZENSHIP data!');
            }
          }
          
          // Check if veteran contains work auth data
          if (profile.selfId.veteran && typeof profile.selfId.veteran === 'string') {
            const veteranStr = profile.selfId.veteran.toLowerCase();
            if (veteranStr.includes('resident') || veteranStr.includes('citizen') || 
                veteranStr.includes('sponsor') || veteranStr.includes('visa') ||
                veteranStr.includes('authorized')) {
              issues.push('⚠️ Veteran field contains WORK AUTH data!');
            }
          }
          
          // Check if disability contains work auth data
          if (profile.selfId.disability && typeof profile.selfId.disability === 'string') {
            const disabilityStr = profile.selfId.disability.toLowerCase();
            if (disabilityStr.includes('resident') || disabilityStr.includes('citizen') || 
                disabilityStr.includes('sponsor') || disabilityStr.includes('visa') ||
                disabilityStr.includes('authorized')) {
              issues.push('⚠️ Disability field contains WORK AUTH data!');
            }
          }
        }
        
        if (issues.length > 0) {
          debugText += issues.join('\n') + '\n\n';
          debugText += '👉 SOLUTION: Click "🧹 Clean Self-ID Data" button to fix these issues.\n';
        } else {
          debugText += '✅ No obvious issues detected.\n';
        }
        
        // Copy to clipboard and show in console
        await navigator.clipboard.writeText(debugText);
        console.log(debugText);
        console.log('Full profile object:', profile);
        
        alert('✅ Profile debug report copied to clipboard and logged to console!\n\nCheck the browser console (F12) for full details.');
        
      } catch (err) {
        error('Failed to debug profile:', err);
        alert('❌ Failed to debug profile. Check console for errors.');
      }
    });
  }
  
  // Manual autofill button
  const manualAutofillBtn = document.getElementById('manual-autofill-btn');
  if (manualAutofillBtn) {
    manualAutofillBtn.addEventListener('click', async () => {
      try {
        // Get active tab
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          // Dispatch custom event on the page to trigger autofill
          await browser.tabs.executeScript(tabs[0].id, {
            code: `window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));`
          });
          
          window.close(); // Close popup after triggering
        }
      } catch (err) {
        error('Failed to trigger manual autofill:', err);
      }
    });
  }
  
  // Smart suggestions button
  const smartSuggestionsBtn = document.getElementById('smart-suggestions-btn');
  if (smartSuggestionsBtn) {
    smartSuggestionsBtn.addEventListener('click', async () => {
      try {
        // Get active tab
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) {
          // Send message to content script to show suggestions
          await browser.tabs.sendMessage(tabs[0].id, { action: 'show-suggestions' });
          
          // Dispatch custom event on the page
          await browser.tabs.executeScript(tabs[0].id, {
            code: `window.dispatchEvent(new CustomEvent('offlyn-show-suggestions'));`
          });
          
          window.close(); // Close popup after triggering
        }
      } catch (err) {
        error('Failed to trigger smart suggestions:', err);
      }
    });
  }
  
  // Set up toggle handlers
  const enabledToggle = document.getElementById('enabled-toggle');
  const dryrunToggle = document.getElementById('dryrun-toggle');
  
  if (enabledToggle) {
    enabledToggle.addEventListener('click', async () => {
      currentState.enabled = !currentState.enabled;
      await setSettings({ enabled: currentState.enabled });
      updateUI();
    });
  }
  
  if (dryrunToggle) {
    dryrunToggle.addEventListener('click', async () => {
      currentState.dryRun = !currentState.dryRun;
      await setSettings({ dryRun: currentState.dryRun });
      updateUI();
    });
  }
  
  // Set up copy summary button
  const copySummaryBtn = document.getElementById('copy-summary-btn');
  if (copySummaryBtn) {
    copySummaryBtn.addEventListener('click', () => {
      copySummary();
    });
  }
  
  // Listen for state updates from background
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
        updateSummaryCount(); // Update summary count when state changes
      }
    }
  });
  
  // Initial UI update
  updateUI();
  updateSummaryCount();
  
  // Poll for state updates every 2 seconds
  setInterval(() => {
    requestState();
    updateSummaryCount();
  }, 2000);
  
  log('Popup initialized');
}

init();
