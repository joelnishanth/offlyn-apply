/**
 * Onboarding page logic
 */

import type { UserProfile, PhoneDetails, LocationDetails, SelfIdentification } from '../shared/profile';
import { saveUserProfile, normalizeProfile, isPhoneDetails, isLocationDetails, formatPhone, formatLocation } from '../shared/profile';
import { rlSystem } from '../shared/learning-rl';
import type { LearnedPattern } from '../shared/learning-types';
import { getOllamaConfig, saveOllamaConfig, testOllamaConnection, DEFAULT_OLLAMA_CONFIG } from '../shared/ollama-config';
import { setHTML, clearEl } from '../shared/html';
import { classifyParseError } from '../shared/error-classify';
import { extractPagesText } from '../shared/pdf-extract';

// PDF.js is loaded via CDN in the HTML
declare const pdfjsLib: any;

let uploadedFile: File | null = null;
let extractedProfile: UserProfile | null = null;
let isConnected = false;

/**
 * Show a specific step
 */
const STEP_ORDER = ['step-ollama', 'step-upload', 'step-review', 'step-links', 'step-selfid', 'step-workauth', 'step-coverletter', 'step-success'];

function showStep(stepId: string): void {
  document.querySelectorAll('.step').forEach(step => {
    step.classList.remove('active');
  });
  const targetStep = document.getElementById(stepId);
  if (targetStep) {
    targetStep.classList.add('active');
  }
  updateWizard(stepId);
}

function updateWizard(activeStepId: string): void {
  const stepIndex = STEP_ORDER.indexOf(activeStepId);
  if (stepIndex < 0) return;

  const indicator = document.getElementById('stepIndicator');
  if (indicator) {
    indicator.textContent = `Step ${stepIndex + 1} of ${STEP_ORDER.length}`;
  }

  const wizardSteps = document.querySelectorAll('.wizard-step');
  wizardSteps.forEach((el, i) => {
    el.classList.remove('active', 'completed');
    if (i < stepIndex) {
      el.classList.add('completed');
    } else if (i === stepIndex) {
      el.classList.add('active');
    }
  });
}

/**
 * Show status message
 */
function showStatus(type: 'info' | 'success' | 'error', message: string): void {
  const statusEl = document.getElementById('uploadStatus');
  if (!statusEl) return;
  
  statusEl.className = `status visible ${type}`;
  statusEl.textContent = message;
}

/**
 * Update progress bar
 */
function updateProgress(stage: 'read' | 'extract' | 'parse' | 'done', percent: number, message: string): void {
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  
  if (progressContainer && progressFill && progressText) {
    progressContainer.classList.add('visible');
    progressFill.style.width = `${percent}%`;
    progressText.textContent = message;
    
    // Update stage indicators
    const stages = ['read', 'extract', 'parse', 'done'];
    const currentIndex = stages.indexOf(stage);
    
    stages.forEach((s, index) => {
      const stageEl = document.getElementById(`stage-${s}`);
      if (stageEl) {
        stageEl.classList.remove('active', 'completed');
        if (index < currentIndex) {
          stageEl.classList.add('completed');
        } else if (index === currentIndex) {
          stageEl.classList.add('active');
        }
      }
    });
  }
}

/**
 * Hide progress bar
 */
function hideProgress(): void {
  const progressContainer = document.getElementById('progressContainer');
  if (progressContainer) {
    progressContainer.classList.remove('visible');
  }
  hideLiveFeed();
}

// ── Live Parse Feed ──────────────────────────────────────────────────────

let feedWordTimer: ReturnType<typeof setTimeout> | null = null;

function showLiveFeed(): void {
  const feed = document.getElementById('liveParseFeed');
  if (feed) {
    feed.classList.add('visible');
    clearEl(feed);
  }
}

function hideLiveFeed(): void {
  const feed = document.getElementById('liveParseFeed');
  if (feed) feed.classList.remove('visible');
  if (feedWordTimer) { clearTimeout(feedWordTimer); feedWordTimer = null; }
}

function appendFeedLine(text: string, cls: string = ''): void {
  const feed = document.getElementById('liveParseFeed');
  if (!feed) return;

  // Remove any existing cursor
  const oldCursor = feed.querySelector('.feed-cursor');
  if (oldCursor) oldCursor.remove();

  const line = document.createElement('div');
  line.className = `feed-line ${cls}`.trim();
  line.textContent = text;
  feed.appendChild(line);

  // Add blinking cursor after latest line
  const cursor = document.createElement('span');
  cursor.className = 'feed-cursor';
  line.appendChild(cursor);

  feed.scrollTop = feed.scrollHeight;
}

/**
 * Stream extracted text word-by-word into the feed.
 * Shows ~first 120 words so the user can see actual resume content being read.
 */
function streamTextToFeed(rawText: string): void {
  const feed = document.getElementById('liveParseFeed');
  if (!feed) return;

  showLiveFeed();
  appendFeedLine('Reading resume content...', 'stage-label');

  const words = rawText.replace(/\s+/g, ' ').trim().split(' ');
  const maxWords = Math.min(words.length, 120);
  let i = 0;
  let currentLine = '';
  const LINE_WORD_LIMIT = 12;

  const tick = () => {
    if (i >= maxWords) {
      if (currentLine) appendFeedLine(currentLine, 'text-chunk');
      if (words.length > maxWords) {
        appendFeedLine(`... +${words.length - maxWords} more words`, 'text-chunk');
      }
      appendFeedLine('Text extraction complete', 'stage-label');
      return;
    }
    currentLine += (currentLine ? ' ' : '') + words[i];
    i++;
    if (i % LINE_WORD_LIMIT === 0 || i >= maxWords) {
      appendFeedLine(currentLine, 'text-chunk');
      currentLine = '';
    }
    feedWordTimer = setTimeout(tick, 25);
  };
  tick();
}

/**
 * Listen for PARSE_PROGRESS messages from the background script
 * and update the live feed + progress bar in real time.
 */
let progressListener: ((msg: any) => void) | null = null;

function startProgressListener(): void {
  if (progressListener) return;

  progressListener = (message: any) => {
    if (typeof message !== 'object' || message === null) return;
    if (message.kind !== 'PARSE_PROGRESS') return;

    const { stage, percent, detail } = message as { stage: string; percent: number; detail?: string };

    // Update the main progress bar
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    if (progressFill) progressFill.style.width = `${Math.min(percent, 99)}%`;
    if (progressText) progressText.textContent = stage;

    // Show in live feed
    showLiveFeed();
    appendFeedLine(stage, 'stage-label');
    if (detail) {
      appendFeedLine(detail, 'extracted');
    }
  };

  browser.runtime.onMessage.addListener(progressListener);
}

function stopProgressListener(): void {
  if (progressListener) {
    browser.runtime.onMessage.removeListener(progressListener);
    progressListener = null;
  }
}

/**
 * Show detailed error information
 */
function showErrorDetails(error: string, details?: any): void {
  const errorDetailsEl = document.getElementById('errorDetails');
  if (!errorDetailsEl) return;

  const errorKind = classifyParseError(error);

  let html = '<div class="error-details">';
  html += '<h4>Parsing Failed</h4>';
  html += `<p><strong>Error:</strong> ${escapeHtml(error)}</p>`;

  if (errorKind === 'model-not-found') {
    html += `
      <p><strong>Cause:</strong> Ollama is running but the required AI models are not installed.</p>
      <p><strong>Fix — run these commands in your terminal:</strong></p>
      <pre style="background:#1e2a3a;color:#a3e635;padding:10px 12px;border-radius:6px;font-size:12px;margin:8px 0;white-space:pre-wrap;word-break:break-all;">ollama pull llama3.2</pre>
      <pre style="background:#1e2a3a;color:#a3e635;padding:10px 12px;border-radius:6px;font-size:12px;margin:8px 0;white-space:pre-wrap;word-break:break-all;">ollama pull nomic-embed-text</pre>
      <p style="font-size:12px;color:#666;margin-top:8px;">
        These models are required for resume parsing. Downloads are typically 2–4 GB total.
        After the downloads finish, click <em>Next</em> again to retry.
      </p>
    `;
  } else if (errorKind === 'cors') {
    html += `
      <p><strong>Cause:</strong> Ollama is running but blocking this extension's requests (CORS).</p>
      <p><strong>Fix — run this as one complete command, keep the terminal open:</strong></p>
      <pre style="background:#1e2a3a;color:#a3e635;padding:10px 12px;border-radius:6px;font-size:12px;margin:8px 0;white-space:pre-wrap;word-break:break-all;">OLLAMA_ORIGINS='moz-extension://*' ollama serve</pre>
      <p style="font-size:12px;color:#e65100;margin-bottom:10px;">
        ⚠️ Stop the currently running Ollama first (Ctrl+C or quit the menu-bar app),
        then run the command above and keep that terminal open.
      </p>
      <p><strong>Permanent fix</strong> (so you never need to do this again):</p>
      <pre style="background:#1e2a3a;color:#a3e635;padding:10px 12px;border-radius:6px;font-size:12px;margin:8px 0;white-space:pre-wrap;word-break:break-all;">echo 'export OLLAMA_ORIGINS="moz-extension://*"' >> ~/.zshrc &amp;&amp; source ~/.zshrc</pre>
      <p style="font-size:12px;color:#666;">After that, plain <code>ollama serve</code> will always allow this extension.</p>
      <p style="margin-top:10px;"><strong>Then:</strong> Click <em>Next</em> again to retry parsing, or go back to the AI Setup step to re-test the connection.</p>
    `;
  } else if (errorKind === 'offline') {
    html += `
      <p><strong>Cause:</strong> Cannot reach Ollama. Make sure it is installed and running.</p>
      <p><strong>Fix:</strong></p>
      <ul>
        <li>Start Ollama: <pre style="display:inline;background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:12px;">ollama serve</pre></li>
        <li>Or open the Ollama app from your Applications folder</li>
        <li>Then click <em>Next</em> again to retry</li>
      </ul>
      <p style="margin-top:8px;font-size:12px;color:#666;">
        Don't have Ollama? <a href="https://ollama.com/download" target="_blank" style="color:#558b2f;">Download it here</a> — it's free and runs 100% locally.
      </p>
    `;
  } else {
    html += `
      <p><strong>Troubleshooting steps:</strong></p>
      <ul>
        <li>Verify Ollama is running: <pre style="display:inline;background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:12px;">ollama ps</pre></li>
        <li>Verify the model is downloaded: <pre style="display:inline;background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:12px;">ollama list</pre></li>
        <li>If you see "403 / Forbidden", restart Ollama with:
          <pre style="background:#1e2a3a;color:#a3e635;padding:8px 10px;border-radius:5px;font-size:12px;margin:6px 0;">OLLAMA_ORIGINS='moz-extension://*' ollama serve</pre>
        </li>
        <li>Test Ollama directly: <pre style="display:inline;background:#f1f5f9;padding:2px 6px;border-radius:3px;font-size:12px;">curl http://localhost:11434/api/version</pre></li>
      </ul>
    `;
  }

  if (details) {
    html += `<details style="margin-top:12px;"><summary style="cursor:pointer;font-size:12px;color:#94a3b8;">Technical details</summary><pre style="font-size:11px;margin-top:8px;overflow-x:auto;">${escapeHtml(JSON.stringify(details, null, 2))}</pre></details>`;
  }

  html += '</div>';

  setHTML(errorDetailsEl, html);
}

/**
 * Hide error details
 */
function hideErrorDetails(): void {
  const errorDetailsEl = document.getElementById('errorDetails');
  if (errorDetailsEl) {
    clearEl(errorDetailsEl);
  }
}

/**
 * Update connection status display
 */
function updateConnectionStatus(connected: boolean): void {
  isConnected = connected;
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;

  if (connected) {
    statusEl.className = 'connection-status connected';
    setHTML(statusEl, '<span class="status-indicator connected"></span><span>Ollama Connected — AI parsing ready</span>');
  } else {
    statusEl.className = 'connection-status disconnected';
    setHTML(statusEl, '<span class="status-indicator disconnected"></span><span>Ollama not detected — AI parsing unavailable (you can still fill info manually)</span>');
  }
}

/**
 * Check connection status
 */
async function checkConnection(): Promise<boolean> {
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_CONNECTION_STATUS' });
    return response?.connected || false;
  } catch (err) {
    console.error('Failed to check connection:', err);
    return false;
  }
}

/**
 * Hide status message
 */
function hideStatus(): void {
  const statusEl = document.getElementById('uploadStatus');
  if (statusEl) {
    statusEl.classList.remove('visible');
  }
}

// ── Ollama Setup Step ──────────────────────────────────────────────────────

type OllamaUIState = 'checking' | 'connected' | 'not-installed';

function showOllamaUIState(state: OllamaUIState): void {
  (['checking', 'connected', 'not-installed'] as OllamaUIState[]).forEach(s => {
    const id = s === 'not-installed' ? 'ollamaNotInstalled' : s === 'checking' ? 'ollamaChecking' : 'ollamaConnected';
    document.getElementById(id)?.classList.toggle('active', s === state);
  });

  // Show/hide action buttons depending on state
  const continueBtn = document.getElementById('continueWithOllamaBtn') as HTMLButtonElement | null;
  const skipBtn = document.getElementById('skipOllamaBtn') as HTMLButtonElement | null;

  if (continueBtn) continueBtn.style.display = state === 'connected' ? '' : 'none';
  if (skipBtn) skipBtn.style.display = state !== 'checking' ? '' : 'none';
}

async function checkOllamaConnection(): Promise<void> {
  showOllamaUIState('checking');
  console.log('[Ollama Setup] Checking connection...');

  const config = await getOllamaConfig();
  const result = await testOllamaConnection(config.endpoint);

  if (result.success) {
    console.log('[Ollama Setup] Connected, version:', result.version, 'corsBlocked:', result.corsBlocked);

    // Update UI labels
    const versionEl = document.getElementById('ollamaVersion');
    const endpointEl = document.getElementById('ollamaEndpoint');
    const modelEl = document.getElementById('ollamaModel');
    if (versionEl) versionEl.textContent = `v${result.version}`;
    if (endpointEl) endpointEl.textContent = config.endpoint;
    if (modelEl) modelEl.textContent = config.chatModel;

    // Pre-fill advanced config inputs
    const epInput = document.getElementById('customOllamaEndpoint') as HTMLInputElement | null;
    const chatInput = document.getElementById('customChatModel') as HTMLInputElement | null;
    const embInput = document.getElementById('customEmbeddingModel') as HTMLInputElement | null;
    if (epInput) epInput.value = config.endpoint;
    if (chatInput) chatInput.value = config.chatModel;
    if (embInput) embInput.value = config.embeddingModel;

    showOllamaUIState('connected');

    // If CORS is blocked, show warning and disable Continue (only Skip available)
    const corsWarning = document.getElementById('ollamaCorsWarning');
    const connectedCard = document.getElementById('ollamaConnectedCard');
    const continueBtn = document.getElementById('continueWithOllamaBtn') as HTMLButtonElement | null;

    if (result.corsBlocked) {
      corsWarning?.classList.add('visible');
      // Turn the success card amber to signal "reachable but not usable"
      if (connectedCard) {
        connectedCard.style.background = '#fffbeb';
        connectedCard.style.borderColor = '#fde68a';
        const icon = connectedCard.querySelector('svg');
        if (icon) (icon as SVGElement).style.color = '#d97706';
        const heading = connectedCard.querySelector('h3');
        if (heading) { heading.textContent = 'Ollama Reachable — CORS Blocked'; heading.style.color = '#92400e'; }
      }
      // Block the Continue button so user can't proceed with broken AI
      if (continueBtn) {
        continueBtn.disabled = true;
        continueBtn.title = 'Fix the CORS issue first, then Re-test Connection';
      }
    } else {
      // Clean / green state — make sure warning is hidden, card is green
      corsWarning?.classList.remove('visible');
      if (connectedCard) {
        connectedCard.style.background = '';
        connectedCard.style.borderColor = '';
        const icon = connectedCard.querySelector('svg');
        if (icon) (icon as SVGElement).style.color = '';
        const heading = connectedCard.querySelector('h3');
        if (heading) { heading.textContent = 'Ollama Connected'; heading.style.color = ''; }
      }
      if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.title = '';
      }
    }
  } else {
    console.warn('[Ollama Setup] Connection failed:', result.error);
    showOllamaUIState('not-installed');
    checkNativeHelper().then(installed => updateHelperSubstate(installed));
  }
}

// ── Native Messaging helpers ──────────────────────────────────────────────

const HELPER_INSTALL_BASE =
  'https://raw.githubusercontent.com/joelnishanth/offlyn-apply/main/scripts/native-host';

function detectOS(): 'mac' | 'windows' | 'linux' {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
}

function getHelperInstallCommand(): string {
  const os = detectOS();
  if (os === 'windows') {
    return `irm ${HELPER_INSTALL_BASE}/install-win.bat -OutFile $env:TEMP\\offlyn-install.bat; & $env:TEMP\\offlyn-install.bat`;
  }
  return `curl -fsSL ${HELPER_INSTALL_BASE}/install-mac-linux.sh | bash`;
}

function getHelperTerminalHint(): string {
  const os = detectOS();
  if (os === 'windows') return 'Open PowerShell (Start → search "PowerShell") → paste → Enter';
  if (os === 'mac') return 'Open Terminal (Cmd+Space → type "Terminal" → Enter) → paste → Enter';
  return 'Open a terminal → paste → Enter';
}

async function checkNativeHelper(): Promise<boolean> {
  try {
    const res = await browser.runtime.sendMessage({ kind: 'CHECK_NATIVE_HELPER' });
    return (res as any)?.installed === true;
  } catch {
    return false;
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\[K/g, '').trim();
}

function appendToLog(logEl: HTMLElement, rawText: string, isError = false): void {
  const text = stripAnsi(rawText);
  if (!text) return;
  const line = document.createElement('div');
  line.textContent = text;
  if (isError) line.style.color = '#f87171';
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function runSetupViaHelper(logElId: string, onDone: (ok: boolean) => void): void {
  const logEl = document.getElementById(logElId);
  if (logEl) logEl.style.display = 'block';

  const progressHandler = (msg: any) => {
    if (typeof msg !== 'object' || msg === null || msg.kind !== 'SETUP_PROGRESS') return;
    if (msg.type === 'progress' && logEl) {
      appendToLog(logEl, msg.line as string);
    }
    if (msg.type === 'done') {
      browser.runtime.onMessage.removeListener(progressHandler);
      onDone(!!(msg as any).ok);
    }
  };

  browser.runtime.onMessage.addListener(progressHandler);
  browser.runtime.sendMessage({ kind: 'RUN_OLLAMA_SETUP' }).catch((err: unknown) => {
    browser.runtime.onMessage.removeListener(progressHandler);
    if (logEl) appendToLog(logEl, `Error: ${String(err)}`, true);
    onDone(false);
  });
}

function updateHelperSubstate(helperInstalled: boolean): void {
  const notInstalled = document.getElementById('helperNotInstalled');
  const installed = document.getElementById('helperInstalled');
  if (notInstalled) notInstalled.style.display = helperInstalled ? 'none' : '';
  if (installed) installed.style.display = helperInstalled ? '' : 'none';
}

function setupOllamaStepListeners(): void {
  // Populate OS-specific helper install command
  const cmdEl = document.getElementById('helperInstallCmd');
  const hintEl = document.getElementById('helperTerminalHint');
  if (cmdEl) cmdEl.textContent = getHelperInstallCommand();
  if (hintEl) hintEl.textContent = getHelperTerminalHint();

  // Copy helper install command
  document.getElementById('copyHelperCmd')?.addEventListener('click', () => {
    const cmd = getHelperInstallCommand();
    navigator.clipboard.writeText(cmd).then(() => {
      const btn = document.getElementById('copyHelperCmd');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    }).catch(() => {});
  });

  // "Helper Installed — Check Again" button
  document.getElementById('checkHelperBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('checkHelperBtn') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
    const installed = await checkNativeHelper();
    if (btn) { btn.disabled = false; btn.textContent = 'Helper Installed — Check Again'; }
    updateHelperSubstate(installed);
  });

  // "Set Up AI" button
  document.getElementById('runSetupBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('runSetupBtn') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Setting up...'; }

    runSetupViaHelper('setupProgressLog', (ok) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Set Up AI'; }
      if (ok) {
        checkOllamaConnection();
      } else {
        const logEl = document.getElementById('setupProgressLog');
        if (logEl) appendToLog(logEl, '✗ Setup failed — see log above', true);
      }
    });
  });

  // "Fix CORS Automatically" button
  document.getElementById('runCorsFixBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('runCorsFixBtn') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Fixing...'; }

    runSetupViaHelper('corsFixProgressLog', (ok) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Fix CORS Automatically'; }
      if (ok) checkOllamaConnection();
    });
  });

  // Back button — AI Setup is now Step 1, nothing to go back to
  document.getElementById('backFromOllamaBtn')?.addEventListener('click', () => {
    // Step 1 has no previous step; do nothing
  });

  // Continue with AI Features
  document.getElementById('continueWithOllamaBtn')?.addEventListener('click', async () => {
    const epInput = (document.getElementById('customOllamaEndpoint') as HTMLInputElement | null)?.value.trim() || DEFAULT_OLLAMA_CONFIG.endpoint;
    const chatModel = (document.getElementById('customChatModel') as HTMLInputElement | null)?.value.trim() || DEFAULT_OLLAMA_CONFIG.chatModel;
    const embModel = (document.getElementById('customEmbeddingModel') as HTMLInputElement | null)?.value.trim() || DEFAULT_OLLAMA_CONFIG.embeddingModel;

    const config = await getOllamaConfig();
    config.enabled = true;
    config.endpoint = epInput;
    config.chatModel = chatModel;
    config.embeddingModel = embModel;
    config.lastChecked = Date.now();
    await saveOllamaConfig(config);
    showStep('step-upload');
  });

  // Skip AI Features
  const doSkip = async () => {
    const config = await getOllamaConfig();
    config.enabled = false;
    await saveOllamaConfig(config);
    showStep('step-upload');
  };

  document.getElementById('skipOllamaBtn')?.addEventListener('click', doSkip);

  // Retry / Test Connection button
  document.getElementById('retryOllamaBtn')?.addEventListener('click', () => {
    checkOllamaConnection();
  });

  // Re-test button inside CORS warning banner
  document.getElementById('retestAfterCorsBtn')?.addEventListener('click', () => {
    checkOllamaConnection();
  });

  // Test custom endpoint
  document.getElementById('testCustomEndpointBtn')?.addEventListener('click', async () => {
    const epInput = (document.getElementById('customOllamaEndpoint') as HTMLInputElement | null)?.value.trim();
    const resultEl = document.getElementById('advTestResult');
    if (!epInput || !resultEl) return;

    resultEl.textContent = 'Testing...';
    resultEl.className = 'adv-test-result visible';

    const result = await testOllamaConnection(epInput);
    if (result.success) {
      resultEl.textContent = `Connected! Ollama v${result.version}`;
      resultEl.className = 'adv-test-result visible ok';
    } else {
      resultEl.textContent = `Failed: ${result.error}`;
      resultEl.className = 'adv-test-result visible fail';
    }
  });

  // Reset to defaults
  document.getElementById('resetOllamaDefaultsBtn')?.addEventListener('click', () => {
    const epInput = document.getElementById('customOllamaEndpoint') as HTMLInputElement | null;
    const chatInput = document.getElementById('customChatModel') as HTMLInputElement | null;
    const embInput = document.getElementById('customEmbeddingModel') as HTMLInputElement | null;
    if (epInput) epInput.value = DEFAULT_OLLAMA_CONFIG.endpoint;
    if (chatInput) chatInput.value = DEFAULT_OLLAMA_CONFIG.chatModel;
    if (embInput) embInput.value = DEFAULT_OLLAMA_CONFIG.embeddingModel;
    const resultEl = document.getElementById('advTestResult');
    if (resultEl) { resultEl.className = 'adv-test-result'; resultEl.textContent = ''; }
  });

  // Show troubleshooting modal
  document.getElementById('showTroubleshootingBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('troubleshootModal')?.classList.add('visible');
  });

  // Close troubleshooting modal
  const closeModal = () => document.getElementById('troubleshootModal')?.classList.remove('visible');
  document.getElementById('closeTroubleshootingBtn')?.addEventListener('click', closeModal);
  document.getElementById('tsOverlay')?.addEventListener('click', closeModal);

  // Skip from troubleshooting modal
  document.getElementById('skipFromTroubleshootingBtn')?.addEventListener('click', async () => {
    closeModal();
    await doSkip();
  });

  // Copy buttons (command snippets)
  document.querySelectorAll<HTMLButtonElement>('.btn-copy-cmd').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.getAttribute('data-copy') || btn.previousElementSibling?.textContent || '';
      if (text) {
        navigator.clipboard.writeText(text.trim()).then(() => {
          const orig = btn.textContent;
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = orig; }, 1500);
        }).catch(() => {});
      }
    });
  });
}

/**
 * Read file as text
 */
async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Extract text from PDF using PDF.js
 */
async function extractTextFromPDF(file: File): Promise<string> {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js library failed to load. Please reload the page and try again.');
  }

  try {
    // Do NOT set workerSrc to a URL. The matching pdf.worker.min.js is loaded
    // via a <script> tag in onboarding.html, which sets globalThis.pdfjsWorker.
    // pdf.js detects that global and uses main-thread processing automatically,
    // avoiding Web Worker creation entirely. This is critical because Firefox
    // blocks Worker creation in store-installed extensions (stricter CSP).
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    updateProgress('extract', 30, 'Loading PDF...');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    return await extractPagesText(pdf);
  } catch (err) {
    console.error('PDF extraction failed:', err);
    throw new Error('Failed to extract text from PDF: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Extract text from file based on type
 */
async function extractTextFromFile(file: File): Promise<string> {
  console.log('Extracting text from file:', file.name, 'Type:', file.type);
  
  if (file.type === 'text/plain') {
    return readFileAsText(file);
  }
  
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return extractTextFromPDF(file);
  }
  
  // For DOC/DOCX or unknown types, try plain text
  try {
    const text = await readFileAsText(file);
    
    // Check if it looks like PDF markup (starts with %PDF or has xref)
    if (text.includes('%PDF') || text.includes('xref')) {
      throw new Error('This appears to be a PDF file. Please save as .pdf or use a plain text resume.');
    }
    
    return text;
  } catch (err) {
    throw new Error('Failed to read file. Please use a PDF (.pdf) or plain text (.txt) resume.');
  }
}

/**
 * Parse resume using Ollama via background script
 */
async function parseResume(resumeText: string): Promise<UserProfile> {
  updateProgress('parse', 60, 'Sending to AI for parsing...');
  hideErrorDetails();
  
  try {
    console.log('Sending resume to background script, length:', resumeText.length);
    
    // Check connection first
    updateProgress('parse', 65, 'Checking Ollama connection...');
    const connected = await checkConnection();
    if (!connected) {
      throw new Error('Ollama not connected. Please ensure Ollama is running.');
    }
    
    // Send to background script which calls Ollama
    updateProgress('parse', 70, 'AI is analyzing your resume...');
    const response = await browser.runtime.sendMessage({
      kind: 'PARSE_RESUME',
      resumeText,
    });
    
    console.log('Received response:', response);
    
    if (response && response.kind === 'RESUME_PARSED' && response.profile) {
      console.log('Successfully parsed profile:', response.profile);
      updateProgress('done', 100, 'Parsing complete!');
      hideErrorDetails();
      return response.profile;
    } else if (response && response.kind === 'ERROR') {
      console.error('Parser error:', response.message);
      showErrorDetails(response.message || 'Failed to parse resume', response);
      throw new Error(response.message || 'Failed to parse resume');
    } else {
      console.error('Invalid response structure:', response);
      showErrorDetails('Invalid response from parser', response);
      throw new Error('Invalid response from parser. See details below.');
    }
  } catch (err) {
    console.error('Parse error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to parse resume';
    if (!document.getElementById('errorDetails')?.innerHTML) {
      showErrorDetails(errorMessage);
    }
    throw new Error(errorMessage);
  }
}

/**
 * Handle file selection
 */
function handleFileSelect(file: File): void {
  if (file.size > 5 * 1024 * 1024) {
    showStatus('error', 'File too large. Please upload a file under 5MB.');
    return;
  }
  
  uploadedFile = file;
  
  // Show file info
  const fileInfo = document.getElementById('fileInfo');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const parseBtn = document.getElementById('parseBtn') as HTMLButtonElement;
  
  if (fileInfo && fileName && fileSize && parseBtn) {
    fileInfo.classList.add('visible');
    fileName.textContent = file.name;
    fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    parseBtn.disabled = false;
  }
  
  hideStatus();
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Render profile preview with editable fields
 */
/**
 * Build an input field, wrapped with an AI hint tile if the value is empty.
 */
function buildField(
  tag: 'input' | 'textarea',
  fieldName: string,
  value: string,
  attrs: string = '',
  placeholder: string = ''
): string {
  const isEmpty = !value || value.trim() === '' || value === '0';
  const escapedValue = escapeHtml(value);

  let inputHtml: string;
  if (tag === 'textarea') {
    const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    inputHtml = `<textarea class="profile-textarea" name="${fieldName}"${phAttr}${attrs}>${escapedValue}</textarea>`;
  } else {
    const phAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    inputHtml = `<input class="profile-input" name="${fieldName}" value="${escapedValue}"${phAttr}${attrs} />`;
  }

  if (isEmpty) {
    return (
      `<div class="input-wrapper">${inputHtml}` +
      `<div class="ai-suggest-tile" data-field="${fieldName}">` +
        `<span class="ai-sparkle">&#10024;</span>` +
        `<span class="ai-label">Ask AI to suggest</span>` +
      `</div></div>`
    );
  }
  return inputHtml;
}

/**
 * Populate the static personal info form fields (Step 2) from a profile.
 * Handles both old string format and new PhoneDetails / LocationDetails objects.
 */
function populatePersonalInfoForm(profile: UserProfile): void {
  const setValue = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = value;
  };

  setValue('piFirstName', profile.personal.firstName || '');
  setValue('piLastName', profile.personal.lastName || '');
  setValue('piEmail', profile.personal.email || '');

  // Phone
  const phone = profile.personal.phone;
  if (isPhoneDetails(phone)) {
    // Normalise country code: "+1-CA" stored as "+1" with Canada flag — just use "+1"
    const codeValue = phone.countryCode === '+1-CA' ? '+1-CA' : phone.countryCode;
    setValue('piPhoneCountryCode', codeValue);
    setValue('piPhoneNumber', phone.number || '');
  } else if (typeof phone === 'string' && phone) {
    // Legacy string: try to parse out country code
    const match = phone.match(/^(\+\d{1,3})\s*(.*)$/);
    if (match) {
      setValue('piPhoneCountryCode', match[1]);
      // Strip non-digits from the remainder
      setValue('piPhoneNumber', match[2].replace(/\D/g, ''));
    } else {
      setValue('piPhoneNumber', phone.replace(/\D/g, ''));
    }
  }

  // Location
  const location = profile.personal.location;
  if (isLocationDetails(location)) {
    setValue('piCity', location.city || '');
    setValue('piState', location.state || '');
    setValue('piCountry', location.country || 'United States');
    setValue('piZipCode', location.zipCode || '');
  } else if (typeof location === 'string' && location) {
    // Legacy string: "City, State" or "City, State, Country"
    const parts = location.split(',').map(p => p.trim());
    setValue('piCity', parts[0] || '');
    setValue('piState', parts[1] || '');
    if (parts[2]) setValue('piCountry', parts[2]);
  }
}

function renderProfilePreview(profile: UserProfile): void {
  // Populate the static personal info form
  populatePersonalInfoForm(profile);

  const preview = document.getElementById('profilePreview');
  if (!preview) return;
  
  let html = '<form id="profileForm">';
  
  // Skills (editable list)
  html += '<div class="profile-section">';
  html += '<h3>Skills</h3>';
  html += '<div class="profile-field"><label class="profile-label">Skills:</label><div class="editable-list" id="skillsList">';
  if (profile.skills && profile.skills.length > 0) {
    profile.skills.forEach((skill, index) => {
      html += `<div class="editable-list-item" data-skill-index="${index}">`;
      html += `<input type="text" value="${escapeHtml(skill)}" />`;
      html += `<button type="button" class="remove-skill-btn">Remove</button>`;
      html += `</div>`;
    });
  }
  html += '</div></div>';
  html += '<button type="button" class="add-item-btn" id="addSkillBtn">Add Skill</button>';
  html += '</div>';
  
  // Work Experience (simplified display - work/education are complex, keep as read-only for now)
  if (profile.work && profile.work.length > 0) {
    html += '<div class="profile-section">';
    html += '<h3>Work Experience</h3>';
    profile.work.forEach(job => {
      html += `<div class="profile-value" style="margin-bottom: 12px; padding: 12px; background: #f9f9f9; border-radius: 4px;">`;
      html += `<strong>${escapeHtml(job.title)}</strong> at ${escapeHtml(job.company)}<br/>`;
      html += `<small style="color: #666;">${escapeHtml(job.startDate)} - ${job.current ? 'Present' : escapeHtml(job.endDate)}</small>`;
      if (job.description) {
        html += `<p style="margin-top: 8px; font-size: 13px; color: #666;">${escapeHtml(job.description)}</p>`;
      }
      html += '</div>';
    });
    html += '<p style="font-size: 12px; color: #999; margin-top: 8px;">Note: Work experience editing coming soon</p>';
    html += '</div>';
  }
  
  // Education (read-only for now)
  if (profile.education && profile.education.length > 0) {
    html += '<div class="profile-section">';
    html += '<h3>Education</h3>';
    profile.education.forEach(edu => {
      html += `<div class="profile-value" style="margin-bottom: 12px; padding: 12px; background: #f9f9f9; border-radius: 4px;">`;
      html += `<strong>${escapeHtml(edu.degree)}</strong> in ${escapeHtml(edu.field || 'N/A')}<br/>`;
      html += `<small style="color: #666;">${escapeHtml(edu.school)} - ${escapeHtml(edu.graduationYear)}</small>`;
      html += '</div>';
    });
    html += '<p style="font-size: 12px; color: #999; margin-top: 8px;">Note: Education editing coming soon</p>';
    html += '</div>';
  }
  
  // Summary
  html += '<div class="profile-section">';
  html += '<h3>Professional Summary</h3>';
  html += `<div class="profile-field"><label class="profile-label">Summary:</label>${buildField('textarea', 'summary', profile.summary || '', '', 'Brief professional summary...')}</div>`;
  html += '</div>';
  
  html += '</form>';
  
  setHTML(preview, html);
  
  // Setup event listeners for skills
  setupSkillsEventListeners();
  
  // Setup AI suggestion tiles for empty fields
  setupAiSuggestTiles();
  
  // Populate raw JSON data
  const rawDataJson = document.getElementById('rawDataJson');
  if (rawDataJson) {
    // Create a clean copy without resumeText for display
    const displayProfile = { ...profile };
    delete displayProfile.resumeText;
    rawDataJson.textContent = JSON.stringify(displayProfile, null, 2);
  }
}

/**
 * Setup event listeners for skills management
 */
function setupSkillsEventListeners(): void {
  // Add skill button
  const addSkillBtn = document.getElementById('addSkillBtn');
  if (addSkillBtn) {
    addSkillBtn.addEventListener('click', () => {
      const skillsList = document.getElementById('skillsList');
      if (!skillsList) return;
      
      const index = skillsList.querySelectorAll('.editable-list-item').length;
      const div = document.createElement('div');
      div.className = 'editable-list-item';
      div.setAttribute('data-skill-index', String(index));
      setHTML(div, `<input type="text" placeholder="Enter skill..." /><button type="button" class="remove-skill-btn">Remove</button>`);
      
      // Add event listener to the new remove button
      const removeBtn = div.querySelector('.remove-skill-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', () => {
          div.remove();
        });
      }
      
      skillsList.appendChild(div);
    });
  }
  
  // Remove skill buttons (use event delegation for existing items)
  const skillsList = document.getElementById('skillsList');
  if (skillsList) {
    skillsList.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('remove-skill-btn')) {
        const item = target.closest('.editable-list-item');
        if (item) {
          item.remove();
        }
      }
    });
  }
}

/**
 * Setup click handlers for AI suggestion tiles on empty fields.
 * When clicked, sends a SUGGEST_FIELD message to the background script
 * which uses Ollama to infer the value from the resume text.
 */
function setupAiSuggestTiles(): void {
  const tiles = document.querySelectorAll<HTMLElement>('.ai-suggest-tile');
  if (tiles.length === 0) return;

  console.log(`[Onboarding] Setting up ${tiles.length} AI suggestion tiles`);

  tiles.forEach(tile => {
    tile.addEventListener('click', async () => {
      const fieldName = tile.getAttribute('data-field');
      if (!fieldName) return;

      // Prevent double-click
      if (tile.classList.contains('loading')) return;
      tile.classList.add('loading');
      tile.querySelector('.ai-label')!.textContent = 'Thinking...';

      try {
        // Get the resume text from the currently extracted profile
        const resumeText = extractedProfile?.resumeText || '';
        if (!resumeText) {
          showSuggestionError(tile, 'No resume text available. Upload a resume first.');
          return;
        }

        const response = await browser.runtime.sendMessage({
          kind: 'SUGGEST_FIELD',
          fieldName,
          resumeText,
        });

        if (response?.kind === 'SUGGEST_FIELD_RESULT' && response.value) {
          showSuggestionResult(tile, fieldName, response.value);
        } else {
          const errMsg = response?.error || 'Could not find this info in your resume.';
          showSuggestionError(tile, errMsg);
        }
      } catch (err) {
        console.error('[Onboarding] AI suggest failed:', err);
        showSuggestionError(tile, 'AI suggestion failed. Is Ollama running?');
      }
    });
  });

  // Also hide tiles when user starts typing in the input
  tiles.forEach(tile => {
    const wrapper = tile.closest('.input-wrapper');
    if (!wrapper) return;
    const input = wrapper.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) return;

    input.addEventListener('input', () => {
      if (input.value.trim()) {
        tile.style.display = 'none';
        // Also remove any suggestion result
        const result = wrapper.querySelector('.ai-suggestion-result');
        if (result) result.remove();
      } else {
        tile.style.display = '';
      }
    });
  });
}

/**
 * Show an AI suggestion result below the field, replacing the tile.
 */
function showSuggestionResult(tile: HTMLElement, fieldName: string, value: string): void {
  const wrapper = tile.closest('.input-wrapper');
  if (!wrapper) return;

  // Hide the tile
  tile.style.display = 'none';

  // Remove any existing result
  const existing = wrapper.querySelector('.ai-suggestion-result');
  if (existing) existing.remove();

  // Create suggestion result UI
  const result = document.createElement('div');
  result.className = 'ai-suggestion-result';
  setHTML(result, `
    <span class="suggestion-text">${escapeHtml(value)}</span>
    <button type="button" class="accept-btn">Accept</button>
    <button type="button" class="dismiss-btn">Dismiss</button>
  `);

  // Accept: fill the input with the suggested value
  result.querySelector('.accept-btn')!.addEventListener('click', () => {
    const input = wrapper.querySelector('input, textarea') as HTMLInputElement | HTMLTextAreaElement | null;
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    result.remove();
  });

  // Dismiss: remove the suggestion, re-show tile
  result.querySelector('.dismiss-btn')!.addEventListener('click', () => {
    result.remove();
    tile.style.display = '';
    tile.classList.remove('loading');
    tile.querySelector('.ai-label')!.textContent = 'Ask AI to suggest';
  });

  wrapper.appendChild(result);
}

/**
 * Show an error on the tile, then reset after a delay.
 */
function showSuggestionError(tile: HTMLElement, message: string): void {
  const label = tile.querySelector('.ai-label') as HTMLElement;
  tile.classList.remove('loading');
  label.textContent = message;
  label.style.color = '#c62828';

  setTimeout(() => {
    label.textContent = 'Ask AI to suggest';
    label.style.color = '';
  }, 3000);
}

/**
 * Collect self-ID data from form
 */
function collectSelfIdData(): any {
  const form = document.getElementById('selfIdForm') as HTMLFormElement;
  if (!form) return null;

  const formData = new FormData(form);
  
  // Collect multi-select checkboxes
  const gender: string[] = [];
  const race: string[] = [];
  const orientation: string[] = [];
  
  form.querySelectorAll('input[name="gender"]:checked').forEach((input: any) => {
    gender.push(input.value);
  });
  
  form.querySelectorAll('input[name="race"]:checked').forEach((input: any) => {
    race.push(input.value);
  });
  
  form.querySelectorAll('input[name="orientation"]:checked').forEach((input: any) => {
    orientation.push(input.value);
  });
  
  return {
    gender,
    race,
    orientation,
    veteran: formData.get('veteran') as string || '',
    transgender: formData.get('transgender') as string || '',
    disability: formData.get('disability') as string || '',
  };
}

/**
 * Collect work authorization data from form
 */
function collectWorkAuthData(): any {
  const form = document.getElementById('workAuthForm') as HTMLFormElement;
  if (!form) return null;

  const formData = new FormData(form);
  
  const legallyAuthorizedValue = formData.get('legallyAuthorized') as string;
  const requiresSponsorshipValue = formData.get('requiresSponsorship') as string;
  
  return {
    legallyAuthorized: legallyAuthorizedValue === 'yes',
    requiresSponsorship: requiresSponsorshipValue === 'yes',
    currentStatus: formData.get('currentStatus') as string || undefined,
    visaType: formData.get('visaType') as string || undefined,
    sponsorshipTimeline: formData.get('sponsorshipTimeline') as string || undefined,
  };
}

/**
 * Save profile with self-ID and move to work auth step
 */
async function saveSelfIdAndContinue(includeSelfId: boolean): Promise<void> {
  if (!extractedProfile) return;
  
  try {
    // Add self-ID data if requested
    if (includeSelfId) {
      const selfIdData = collectSelfIdData();
      if (selfIdData) {
        extractedProfile.selfId = selfIdData;
      }
    }
    
    // Move to work authorization step
    showStep('step-workauth');
  } catch (err) {
    alert('Failed to proceed: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

/**
 * Pre-fill the Links form from profile data
 */
function prefillLinksForm(profile: UserProfile): void {
  const linkedin = document.getElementById('linksLinkedin') as HTMLInputElement;
  const portfolio = document.getElementById('linksPortfolio') as HTMLInputElement;
  const github = document.getElementById('linksGithub') as HTMLInputElement;
  
  if (linkedin && profile.professional?.linkedin) linkedin.value = profile.professional.linkedin;
  if (portfolio && profile.professional?.portfolio) portfolio.value = profile.professional.portfolio;
  if (github && profile.professional?.github) github.value = profile.professional.github;
}

/**
 * Collect links data from form and save to extractedProfile
 */
function collectLinksFromForm(): void {
  if (!extractedProfile) return;
  
  const linkedin = (document.getElementById('linksLinkedin') as HTMLInputElement)?.value || '';
  const portfolio = (document.getElementById('linksPortfolio') as HTMLInputElement)?.value || '';
  const github = (document.getElementById('linksGithub') as HTMLInputElement)?.value || '';
  
  if (!extractedProfile.professional) {
    extractedProfile.professional = { linkedin: '', github: '', portfolio: '' };
  }
  extractedProfile.professional.linkedin = linkedin;
  extractedProfile.professional.portfolio = portfolio;
  extractedProfile.professional.github = github;
}

/**
 * Collect cover letter defaults from form and save to extractedProfile
 */
function collectCoverLetterFromForm(): void {
  if (!extractedProfile) return;
  
  const tone = (document.getElementById('clTone') as HTMLSelectElement)?.value || 'Professional';
  const keySkillsRaw = (document.getElementById('clKeySkills') as HTMLInputElement)?.value || '';
  const notes = (document.getElementById('clNotes') as HTMLTextAreaElement)?.value || '';
  
  const keySkills = keySkillsRaw.split(',').map(s => s.trim()).filter(Boolean);
  
  (extractedProfile as any).coverLetterDefaults = {
    tone,
    keySkills,
    additionalNotes: notes,
  };
}

/**
 * Save final profile with all data
 */
async function saveFinalProfile(includeWorkAuth: boolean): Promise<void> {
  if (!extractedProfile) return;
  
  try {
    // Add work auth data if requested
    if (includeWorkAuth) {
      const workAuthData = collectWorkAuthData();
      if (workAuthData) {
        extractedProfile.workAuth = workAuthData;
      }
    }

    // Normalize the profile before saving — splits middle names out of lastName,
    // drops phantom work entries without startDate, deduplicates work by company+title.
    extractedProfile = normalizeProfile(extractedProfile) as any;
    console.log('[Onboarding] Profile normalized:', {
      firstName: extractedProfile.personal?.firstName,
      middleName: (extractedProfile.personal as any)?.middleName,
      lastName: extractedProfile.personal?.lastName,
      workEntries: extractedProfile.work?.length,
    });

    // Try to save the profile
    let profileSaved = false;
    try {
      await saveUserProfile(extractedProfile);
      profileSaved = true;
    } catch (saveErr) {
      console.error('[Onboarding] Initial save failed:', saveErr);

      // Wait briefly and retry once — transient storage errors often resolve quickly
      await new Promise(r => setTimeout(r, 500));
      try {
        await saveUserProfile(extractedProfile);
        profileSaved = true;
        console.log('[Onboarding] Profile saved on retry after transient error');
      } catch (_) {
        // Still failing — escalate to storage repair
      }

      if (!profileSaved) {
        // Storage might be full/corrupted - repair it first
        console.log('[Onboarding] Attempting storage repair before retry...');
        const repaired = await repairStorage();

        if (repaired) {
          try {
            await saveUserProfile(extractedProfile);
            profileSaved = true;
            console.log('[Onboarding] Profile saved after storage repair');
          } catch (retryErr) {
            console.error('[Onboarding] Save still failing after repair:', retryErr);

            // Last resort: strip resumeText (can be very large) and try again
            const lightProfile = { ...extractedProfile };
            lightProfile.resumeText = '';
            try {
              await saveUserProfile(lightProfile);
              profileSaved = true;
              console.log('[Onboarding] Profile saved (without resume text) after stripping heavy data');
            } catch (finalErr) {
              console.error('[Onboarding] Even light save failed:', finalErr);
            }
          }
        }
      }
    }
    
    if (!profileSaved) {
      alert(
        'Failed to save profile. Your browser storage may be full or corrupted.\n\n' +
        'Try these steps:\n' +
        '1. Go to about:addons in Firefox\n' +
        '2. Find this extension and click "Remove"\n' +
        '3. Reinstall the extension\n' +
        '4. Upload your resume again'
      );
      return;
    }
    
    // Save resume file for auto-upload using chunked storage (handles large files > 400KB)
    if (uploadedFile) {
      try {
        const MAX_RESUME_SIZE = 5 * 1024 * 1024; // 5MB hard limit
        if (uploadedFile.size > MAX_RESUME_SIZE) {
          console.warn(`[Resume] File too large (${(uploadedFile.size / 1024 / 1024).toFixed(1)}MB). Maximum 5MB.`);
          // Still continue — profile was saved, resume just won't auto-attach
        } else {
          await saveResumeWithChunking(uploadedFile);
        }
      } catch (err) {
        console.warn('Failed to save resume file binary:', err);
        // Profile was saved, just the file auto-upload won't work
      }
    }
    
    // Seed graph with profile values so it has data from day one
    if (profileSaved && extractedProfile) {
      browser.runtime.sendMessage({ kind: 'GRAPH_SEED_FROM_PROFILE', profile: extractedProfile }).catch(() => {
        // Non-critical — graph will seed on next background startup
      });
    }

    populateReviewSummary();
    showStep('step-success');
  } catch (err) {
    console.error('[Onboarding] saveFinalProfile error:', err);
    alert('Failed to save profile: ' + (err instanceof Error ? err.message : 'Unknown error'));
  }
}

function populateReviewSummary(): void {
  const container = document.getElementById('reviewSummary');
  if (!container || !extractedProfile) return;

  const p = extractedProfile;
  let html = '';

  const fullName = [p.personal.firstName, p.personal.lastName].filter(Boolean).join(' ');
  const phoneDisplay    = formatPhone(p.personal.phone);
  const locationDisplay = formatLocation(p.personal.location);
  html += '<div class="review-section">';
  html += '<div class="review-section-title">Personal Information</div>';
  if (fullName)        html += `<div class="review-field"><strong>Name:</strong> ${fullName}</div>`;
  if (p.personal.email) html += `<div class="review-field"><strong>Email:</strong> ${p.personal.email}</div>`;
  if (phoneDisplay)    html += `<div class="review-field"><strong>Phone:</strong> ${phoneDisplay}</div>`;
  if (locationDisplay) html += `<div class="review-field"><strong>Location:</strong> ${locationDisplay}</div>`;
  html += '</div>';

  const hasLinks = p.professional?.linkedin || p.professional?.portfolio || p.professional?.github;
  if (hasLinks) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title">Links</div>';
    if (p.professional?.linkedin) html += `<div class="review-field"><strong>LinkedIn:</strong> ${p.professional.linkedin}</div>`;
    if (p.professional?.portfolio) html += `<div class="review-field"><strong>Portfolio:</strong> ${p.professional.portfolio}</div>`;
    if (p.professional?.github) html += `<div class="review-field"><strong>GitHub:</strong> ${p.professional.github}</div>`;
    html += '</div>';
  }

  if (p.workAuth) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title">Work Authorization</div>';
    if (p.workAuth.currentStatus) html += `<div class="review-field"><strong>Status:</strong> ${p.workAuth.currentStatus}</div>`;
    html += `<div class="review-field"><strong>Sponsorship:</strong> ${p.workAuth.requiresSponsorship ? 'Required' : 'Not required'}</div>`;
    html += '</div>';
  }

  if (p.skills?.length) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title">Skills</div>';
    html += `<div class="review-field">${p.skills.join(', ')}</div>`;
    html += '</div>';
  }

  const clDefaults = (p as any).coverLetterDefaults;
  if (clDefaults) {
    html += '<div class="review-section">';
    html += '<div class="review-section-title">Cover Letter Preferences</div>';
    if (clDefaults.tone) html += `<div class="review-field"><strong>Tone:</strong> ${clDefaults.tone}</div>`;
    if (clDefaults.keySkills?.length) html += `<div class="review-field"><strong>Key Skills:</strong> ${clDefaults.keySkills.join(', ')}</div>`;
    html += '</div>';
  }

  setHTML(container, html);
}

/**
 * Collect personal info from the static split-field form (Step 2).
 */
function collectPersonalInfoFromForm(): UserProfile['personal'] | null {
  const getVal = (id: string): string => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return el ? el.value.trim() : '';
  };

  const firstName = getVal('piFirstName');
  const lastName  = getVal('piLastName');
  const email     = getVal('piEmail');

  if (!firstName || !lastName || !email) return null;

  // Build PhoneDetails
  let rawCode = getVal('piPhoneCountryCode');
  // "+1-CA" is stored in the dropdown as "+1-CA" but the actual code is "+1"
  if (rawCode === '+1-CA') rawCode = '+1';
  const phoneNumber = getVal('piPhoneNumber').replace(/\D/g, '');
  const phone: PhoneDetails = {
    countryCode: rawCode || '+1',
    number: phoneNumber,
    formatted: rawCode && phoneNumber ? `${rawCode} ${phoneNumber}` : '',
  };

  // Build LocationDetails
  const location: LocationDetails = {
    city:    getVal('piCity'),
    state:   getVal('piState'),
    country: getVal('piCountry') || 'United States',
    zipCode: getVal('piZipCode') || undefined,
  };

  return { firstName, lastName, email, phone, location };
}

/**
 * Collect edited profile data from form
 * Preserves work, education, selfId, and workAuth from existing profile
 */
function collectProfileFromForm(): UserProfile | null {
  const personal = collectPersonalInfoFromForm();
  if (!personal) return null;

  // Collect skills from the dynamic skill list
  const skillsList = document.getElementById('skillsList');
  const skills: string[] = [];
  if (skillsList) {
    skillsList.querySelectorAll('.editable-list-item input').forEach((input: any) => {
      const value = input.value.trim();
      if (value) skills.push(value);
    });
  }

  // Collect summary from profileForm if present
  const summaryEl = document.querySelector<HTMLTextAreaElement>('#profileForm textarea[name="summary"]');
  const summary = summaryEl ? summaryEl.value.trim() : (extractedProfile?.summary || '');

  const profile: UserProfile = {
    personal,
    professional: {
      linkedin: extractedProfile?.professional?.linkedin || '',
      github: extractedProfile?.professional?.github || '',
      portfolio: extractedProfile?.professional?.portfolio || '',
      yearsOfExperience: extractedProfile?.professional?.yearsOfExperience || 0,
    },
    skills,
    work: extractedProfile?.work || [],
    education: extractedProfile?.education || [],
    summary,
    resumeText: extractedProfile?.resumeText || '',
    selfId: extractedProfile?.selfId,
    workAuth: extractedProfile?.workAuth,
    lastUpdated: Date.now(),
  };

  console.log('[Onboarding] Collected profile from form:', {
    hasWork: profile.work.length > 0,
    hasEducation: profile.education.length > 0,
    hasSelfId: !!profile.selfId,
    hasWorkAuth: !!profile.workAuth,
  });

  return profile;
}

/**
 * Create an empty profile template for manual entry
 */
function createEmptyProfile(): UserProfile {
  return {
    personal: {
      firstName: '',
      lastName: '',
      email: '',
      phone: { countryCode: '+1', number: '', formatted: '' } as PhoneDetails,
      location: { city: '', state: '', country: 'United States' } as LocationDetails,
    },
    professional: {
      linkedin: '',
      github: '',
      portfolio: '',
      yearsOfExperience: 0
    },
    work: [],
    education: [],
    skills: [],
    summary: '',
    lastUpdated: Date.now()
  };
}

/**
 * Setup conditional field visibility for work authorization form
 */
function setupWorkAuthConditionalFields(): void {
  const legallyAuthorizedInputs = document.querySelectorAll('input[name="legallyAuthorized"]');
  const requiresSponsorshipInputs = document.querySelectorAll('input[name="requiresSponsorship"]');
  
  const currentStatusGroup = document.getElementById('currentStatusGroup');
  const visaTypeGroup = document.getElementById('visaTypeGroup');
  const sponsorshipTimelineGroup = document.getElementById('sponsorshipTimelineGroup');

  // Show/hide current status based on authorization
  legallyAuthorizedInputs.forEach((input: any) => {
    input.addEventListener('change', () => {
      if (input.checked && input.value === 'yes') {
        if (currentStatusGroup) currentStatusGroup.style.display = 'block';
      } else if (input.checked) {
        if (currentStatusGroup) currentStatusGroup.style.display = 'none';
      }
    });
  });

  // Show/hide visa fields based on sponsorship requirement
  requiresSponsorshipInputs.forEach((input: any) => {
    input.addEventListener('change', () => {
      if (input.checked && input.value === 'yes') {
        if (visaTypeGroup) visaTypeGroup.style.display = 'block';
        if (sponsorshipTimelineGroup) sponsorshipTimelineGroup.style.display = 'block';
      } else if (input.checked) {
        if (visaTypeGroup) visaTypeGroup.style.display = 'none';
        if (sponsorshipTimelineGroup) sponsorshipTimelineGroup.style.display = 'none';
      }
    });
  });
}

/**
 * Initialize onboarding
 */
/**
 * Pre-fill Self-ID form with existing data
 */
function preFillSelfIdForm(selfId: any): void {
  console.log('[Onboarding] Pre-filling Self-ID form with:', selfId);
  
  // Gender checkboxes
  if (selfId.gender && Array.isArray(selfId.gender)) {
    selfId.gender.forEach((genderValue: string) => {
      const checkbox = document.querySelector(`input[name="gender"][value="${genderValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Race checkboxes
  if (selfId.race && Array.isArray(selfId.race)) {
    selfId.race.forEach((raceValue: string) => {
      const checkbox = document.querySelector(`input[name="race"][value="${raceValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Orientation checkboxes
  if (selfId.orientation && Array.isArray(selfId.orientation)) {
    selfId.orientation.forEach((orientationValue: string) => {
      const checkbox = document.querySelector(`input[name="orientation"][value="${orientationValue}"]`) as HTMLInputElement;
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }
  
  // Veteran radio buttons
  if (selfId.veteran) {
    const veteranRadio = document.querySelector(`input[name="veteran"][value="${selfId.veteran}"]`) as HTMLInputElement;
    if (veteranRadio) {
      veteranRadio.checked = true;
    }
  }
  
  // Transgender radio buttons
  if (selfId.transgender) {
    const transgenderRadio = document.querySelector(`input[name="transgender"][value="${selfId.transgender}"]`) as HTMLInputElement;
    if (transgenderRadio) {
      transgenderRadio.checked = true;
    }
  }
  
  // Disability radio buttons
  if (selfId.disability) {
    const disabilityRadio = document.querySelector(`input[name="disability"][value="${selfId.disability}"]`) as HTMLInputElement;
    if (disabilityRadio) {
      disabilityRadio.checked = true;
    }
  }

  // Ethnicity radio buttons
  if (selfId.ethnicity) {
    const ethnicityRadio = document.querySelector(`input[name="ethnicity"][value="${selfId.ethnicity}"]`) as HTMLInputElement;
    if (ethnicityRadio) ethnicityRadio.checked = true;
  }

  // Age
  const exactAgeInput  = document.getElementById('selfIdExactAge') as HTMLInputElement | null;
  const ageRangeSelect = document.getElementById('selfIdAgeRange') as HTMLSelectElement | null;
  if (selfId.age !== undefined && exactAgeInput) {
    const exactRadio = document.querySelector<HTMLInputElement>('input[name="ageOption"][value="exact"]');
    if (exactRadio) exactRadio.checked = true;
    exactAgeInput.value = String(selfId.age);
    exactAgeInput.style.display = 'block';
  } else if (selfId.ageRange && ageRangeSelect) {
    const rangeRadio = document.querySelector<HTMLInputElement>('input[name="ageOption"][value="range"]');
    if (rangeRadio) rangeRadio.checked = true;
    ageRangeSelect.value = selfId.ageRange;
    ageRangeSelect.style.display = 'block';
  }
}

/**
 * Setup mutually exclusive gender selection (only one can be selected)
 */
function setupMutuallyExclusiveGender(): void {
  const genderCheckboxes = document.querySelectorAll('input[name="gender"]');
  
  genderCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      
      if (target.checked) {
        // When one is checked, uncheck all others
        genderCheckboxes.forEach(other => {
          if (other !== target) {
            (other as HTMLInputElement).checked = false;
          }
        });
      }
    });
  });
  
  console.log('[Onboarding] Setup mutually exclusive gender selection');
}

/**
 * Setup self-ID form interactivity: age toggle, gender "Other" text reveal.
 */
function setupSelfIdFormInteractivity(): void {
  // Age option radios — show/hide exact age input or age range select
  const ageRadios = document.querySelectorAll<HTMLInputElement>('input[name="ageOption"]');
  const exactAgeInput  = document.getElementById('selfIdExactAge') as HTMLInputElement | null;
  const ageRangeSelect = document.getElementById('selfIdAgeRange') as HTMLSelectElement | null;

  ageRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (!exactAgeInput || !ageRangeSelect) return;
      if (radio.value === 'exact' && radio.checked) {
        exactAgeInput.style.display = 'block';
        ageRangeSelect.style.display = 'none';
      } else if (radio.value === 'range' && radio.checked) {
        exactAgeInput.style.display = 'none';
        ageRangeSelect.style.display = 'block';
      } else {
        exactAgeInput.style.display = 'none';
        ageRangeSelect.style.display = 'none';
      }
    });
  });

  // Gender "Other" checkbox — reveal free-text input
  const genderOtherCheck = document.getElementById('genderOtherCheck') as HTMLInputElement | null;
  const genderOtherText  = document.getElementById('genderOtherText') as HTMLInputElement | null;
  if (genderOtherCheck && genderOtherText) {
    genderOtherCheck.addEventListener('change', () => {
      genderOtherText.style.display = genderOtherCheck.checked ? 'block' : 'none';
    });
  }
}

/**
 * Collect self-identification data from the Self-ID form.
 */
function collectSelfIdFromForm(): SelfIdentification {
  const getCheckedValues = (name: string): string[] => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`);
    return Array.from(checkboxes).map(cb => cb.value);
  };

  const getRadioValue = (name: string): string => {
    const radio = document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
    return radio ? radio.value : '';
  };

  // Gender: collect checked, append custom "Other" text if applicable
  let gender = getCheckedValues('gender');
  const genderOtherText = (document.getElementById('genderOtherText') as HTMLInputElement | null)?.value.trim();
  if (gender.includes('Other') && genderOtherText) {
    gender = gender.filter(g => g !== 'Other');
    gender.push(genderOtherText);
  }

  // Age
  let age: number | undefined;
  let ageRange: string | undefined;
  const ageOptionRadio = document.querySelector<HTMLInputElement>('input[name="ageOption"]:checked');
  if (ageOptionRadio?.value === 'exact') {
    const exactAge = parseInt((document.getElementById('selfIdExactAge') as HTMLInputElement | null)?.value || '', 10);
    if (!isNaN(exactAge) && exactAge > 0) age = exactAge;
  } else if (ageOptionRadio?.value === 'range') {
    const rangeVal = (document.getElementById('selfIdAgeRange') as HTMLSelectElement | null)?.value;
    if (rangeVal) ageRange = rangeVal;
  }

  const selfId: SelfIdentification = {
    gender,
    race: getCheckedValues('race'),
    orientation: getCheckedValues('orientation'),
    veteran:     getRadioValue('veteran')     || "I don't wish to answer",
    transgender: getRadioValue('transgender') || 'Decline to self-identify',
    disability:  getRadioValue('disability')  || "I don't wish to answer",
    ethnicity:   getRadioValue('ethnicity')   || undefined,
  };

  if (age !== undefined) selfId.age = age;
  if (ageRange)          selfId.ageRange = ageRange;

  console.log('[Onboarding] Collected self-ID data:', selfId);
  return selfId;
}

/**
 * Pre-fill Work Authorization form with existing data
 */
function preFillWorkAuthForm(workAuth: any): void {
  console.log('[Onboarding] Pre-filling Work Auth form with:', workAuth);
  
  // Legally authorized radio (form uses "yes"/"no" strings)
  if (typeof workAuth.legallyAuthorized === 'boolean') {
    const radioValue = workAuth.legallyAuthorized ? 'yes' : 'no';
    const legalRadio = document.querySelector(`input[name="legallyAuthorized"][value="${radioValue}"]`) as HTMLInputElement;
    if (legalRadio) {
      legalRadio.checked = true;
      console.log('[Onboarding] Checked legally authorized:', radioValue);
    }
  }
  
  // Requires sponsorship radio (form uses "yes"/"no" strings)
  if (typeof workAuth.requiresSponsorship === 'boolean') {
    const radioValue = workAuth.requiresSponsorship ? 'yes' : 'no';
    const sponsorRadio = document.querySelector(`input[name="requiresSponsorship"][value="${radioValue}"]`) as HTMLInputElement;
    if (sponsorRadio) {
      sponsorRadio.checked = true;
      console.log('[Onboarding] Checked requires sponsorship:', radioValue);
    }
  }
  
  // Current status dropdown
  if (workAuth.currentStatus) {
    const statusSelect = document.querySelector('select[name="currentStatus"]') as HTMLSelectElement;
    if (statusSelect) {
      statusSelect.value = workAuth.currentStatus;
      console.log('[Onboarding] Set current status:', workAuth.currentStatus);
    }
  }
  
  // Visa type dropdown
  if (workAuth.visaType) {
    const visaSelect = document.querySelector('select[name="visaType"]') as HTMLSelectElement;
    if (visaSelect) {
      visaSelect.value = workAuth.visaType;
      console.log('[Onboarding] Set visa type:', workAuth.visaType);
    }
  }
  
  // Trigger conditional field visibility
  setupWorkAuthConditionalFields();
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Format a relative time string (e.g. "2 days ago"). */
function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (days >= 1) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours >= 1) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes >= 1) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/** Derive a confidence bar color class. */
function confidenceColorClass(confidence: number): string {
  if (confidence >= 0.8) return 'rl-bar--high';
  if (confidence >= 0.6) return 'rl-bar--medium';
  return 'rl-bar--low';
}

/** Render a single learned pattern card. */
function renderPatternCard(pattern: LearnedPattern): HTMLElement {
  const pct = Math.round(pattern.confidence * 100);
  const colorClass = confidenceColorClass(pattern.confidence);
  const lastUsedStr = relativeTime(pattern.lastUsed);
  const lastCtx = pattern.contexts[pattern.contexts.length - 1];
  const contextStr = lastCtx
    ? `${lastCtx.company || 'Unknown company'}${lastCtx.jobTitle ? ` — ${lastCtx.jobTitle}` : ''}`
    : '';

  const card = document.createElement('div');
  card.className = 'rl-card';
  card.dataset.patternId = pattern.id;

  // Capitalise field label for display
  const displayLabel = pattern.fieldLabel
    ? pattern.fieldLabel.charAt(0).toUpperCase() + pattern.fieldLabel.slice(1)
    : pattern.fieldType;

  setHTML(card, `
    <div class="rl-card__header">
      <span class="rl-card__field-name">${displayLabel}</span>
      <button class="rl-card__delete" data-pattern-id="${pattern.id}" title="Delete this learned pattern">Delete</button>
    </div>
    <div class="rl-card__divider"></div>
    <div class="rl-card__learned-label">Learned value</div>
    <div class="rl-card__learned-value">${pattern.learnedValue || '(empty)'}</div>
    <div class="rl-card__confidence-row">
      <div class="rl-bar ${colorClass}">
        <div class="rl-bar__fill" style="width: ${pct}%"></div>
      </div>
      <span class="rl-bar__pct">${pct}%</span>
    </div>
    <div class="rl-card__stats">
      Used successfully ${pattern.successCount} time${pattern.successCount !== 1 ? 's' : ''}
      &nbsp;&middot;&nbsp; Last used ${lastUsedStr}
      ${contextStr ? `<div class="rl-card__ctx">${contextStr}</div>` : ''}
    </div>
  `);

  return card;
}

/**
 * Load and display learned patterns from the RL system.
 */
async function loadLearnedValues(showBackButton = false): Promise<void> {
  try {
    // Ensure RL system is ready
    await rlSystem.initialize();

    const container = document.getElementById('learnedValuesContainer');
    if (!container) return;

    // Update button group
    const buttonGroup = document.getElementById('learnedButtonGroup');
    if (buttonGroup) {
      if (showBackButton) {
        setHTML(buttonGroup, `
          <button id="backFromLearnedBtn" class="btn btn-secondary">Back</button>
          <button id="clearAllLearnedBtn" class="btn btn-outline-danger">Clear All</button>
        `);
        const backBtn = document.getElementById('backFromLearnedBtn');
        if (backBtn) {
          backBtn.addEventListener('click', () => showStep('step-success'));
        }
      } else {
        setHTML(buttonGroup, `
          <a id="doneFromLearnedBtn" class="btn btn-primary" href="../home/home.html">Back to Home</a>
          <button id="clearAllLearnedBtn" class="btn btn-outline-danger">Clear All</button>
        `);
      }

      // Wire up Clear All button
      const clearAllBtn = document.getElementById('clearAllLearnedBtn');
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', async () => {
          const confirmed = window.confirm(
            'Clear all learned patterns? This cannot be undone.'
          );
          if (!confirmed) return;
          await rlSystem.clearAll();
          const hasBack = document.getElementById('backFromLearnedBtn') !== null;
          await loadLearnedValues(hasBack);
        });
      }
    }

    // Fetch patterns
    const patterns = await rlSystem.getAllPatterns();

    clearEl(container);

    if (patterns.length === 0) {
      setHTML(container, `
        <div class="rl-empty-state">
          <div class="rl-empty-state__icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
              <path d="M12 8v4m0 4h.01"/>
            </svg>
          </div>
          <h3 class="rl-empty-state__title">No learned patterns yet</h3>
          <p class="rl-empty-state__desc">
            The system will learn as you use the extension. When you manually correct
            an autofilled value, it will appear here with a confidence score.
          </p>
        </div>
      `);
      return;
    }

    // Render each pattern card
    for (const pattern of patterns) {
      const card = renderPatternCard(pattern);
      container.appendChild(card);
    }

    // Wire up delete buttons
    container.querySelectorAll('.rl-card__delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const patternId = target.dataset.patternId;
        if (!patternId) return;

        const confirmed = window.confirm('Delete this learned pattern?');
        if (!confirmed) return;

        await rlSystem.deletePattern(patternId);
        const hasBack = document.getElementById('backFromLearnedBtn') !== null;
        await loadLearnedValues(hasBack);
      });
    });

    console.log('[Onboarding] Displayed', patterns.length, 'RL patterns');
  } catch (err) {
    console.error('[Onboarding] Failed to load learned values:', err);
  }
}

/**
 * @deprecated Use rlSystem.deletePattern() directly via the card buttons.
 * Kept as a stub to avoid breaking any external callers.
 */
async function deleteLearnedValue(_index: number): Promise<void> {
  const hasBack = document.getElementById('backFromLearnedBtn') !== null;
  await loadLearnedValues(hasBack);
}

/**
 * Retry a storage read up to `retries` times with a delay between attempts.
 * Transient Firefox storage errors (disk I/O, quota checks, browser sleep)
 * almost always resolve within a few hundred milliseconds.
 */
async function retryStorageRead<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 300,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i < retries - 1) {
        console.warn(
          `[Onboarding] Storage read failed (attempt ${i + 1}/${retries}), retrying in ${delayMs}ms...`,
          err,
        );
        await new Promise(r => setTimeout(r, delayMs));
      } else {
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

/**
 * Attempt to repair corrupted/full storage.
 * Strategy: only remove large resume-related keys that cause bloat.
 * If a full clear is truly unavoidable, back up and restore the user's
 * profile and dashboard metrics so they are never lost.
 * Returns true if storage is now working.
 */
async function repairStorage(): Promise<boolean> {
  console.log('[Onboarding] Attempting storage repair...');

  // Snapshot critical data before any destructive operation so we can restore it
  let profileBackup: unknown = null;
  const dailySummaryBackup: Record<string, unknown> = {};

  try {
    const r = await browser.storage.local.get('userProfile');
    profileBackup = r.userProfile ?? null;
    console.log('[Onboarding] Backed up userProfile before repair:', !!profileBackup);
  } catch (_) {
    console.warn('[Onboarding] Could not back up userProfile before repair (storage may already be unreadable)');
  }

  try {
    const all = await browser.storage.local.get(null);
    for (const key of Object.keys(all)) {
      if (key.startsWith('dailySummary_')) {
        dailySummaryBackup[key] = all[key];
      }
    }
    console.log('[Onboarding] Backed up', Object.keys(dailySummaryBackup).length, 'dailySummary keys');
  } catch (_) {
    console.warn('[Onboarding] Could not back up dailySummary keys before repair');
  }

  // Step 1: Remove just the resume file (most common cause of storage bloat)
  try {
    await browser.storage.local.remove('resumeFile');
    await browser.storage.local.get('userProfile');
    console.log('[Onboarding] Storage working after removing resumeFile');
    return true;
  } catch (_) {
    console.warn('[Onboarding] Remove resumeFile failed, trying more resume keys...');
  }

  // Step 2: Remove all resume-related large keys (chunks, embeddings, RAG context)
  try {
    const resumeKeys: string[] = [
      'resumeFile', 'resumeFileMeta', 'field_corrections',
      'resume_embeddings', 'resume_chunks', 'rag_context',
    ];
    try {
      const all = await browser.storage.local.get(null);
      for (const key of Object.keys(all)) {
        if (key.startsWith('resumeChunk_')) resumeKeys.push(key);
      }
    } catch (_) { /* best-effort key collection */ }

    await browser.storage.local.remove(resumeKeys);
    await browser.storage.local.get('userProfile');
    console.log('[Onboarding] Storage working after removing all resume-related keys');
    return true;
  } catch (_) {
    console.warn('[Onboarding] Selective remove failed, storage may be fundamentally broken');
  }

  // Step 3: Last resort full clear — but always restore profile + metrics afterward
  try {
    await browser.storage.local.clear();
    console.log('[Onboarding] Full storage cleared');

    const toRestore: Record<string, unknown> = {};
    if (profileBackup !== null) {
      toRestore['userProfile'] = profileBackup;
    }
    Object.assign(toRestore, dailySummaryBackup);

    if (Object.keys(toRestore).length > 0) {
      try {
        await browser.storage.local.set(toRestore);
        console.log(
          '[Onboarding] Restored',
          Object.keys(toRestore).length,
          'keys (profile + dashboard metrics) after full clear',
        );
      } catch (restoreErr) {
        console.error('[Onboarding] Could not restore critical data after full clear:', restoreErr);
      }
    }

    await browser.storage.local.set({ _test: 1 });
    await browser.storage.local.remove('_test');
    console.log('[Onboarding] Storage is working after full clear + restore');
    return true;
  } catch (clearErr) {
    console.error('[Onboarding] Even clear() failed - storage may be permanently broken:', clearErr);
    return false;
  }
}

/**
 * Migrate legacy resume file storage from number array to base64
 * Number array: 1MB PDF → ~4MB JSON storage
 * Base64: 1MB PDF → ~1.33MB JSON storage (3x improvement)
 */
async function migrateResumeFileStorage(): Promise<void> {
  try {
    const result = await browser.storage.local.get('resumeFile');
    const resumeFile = result.resumeFile;
    
    if (!resumeFile) return;
    
    // Already migrated (has base64 data)
    if (resumeFile.dataBase64 && resumeFile.dataBase64.length > 0) return;
    
    // Has legacy number array - migrate to base64
    if (resumeFile.data && Array.isArray(resumeFile.data) && resumeFile.data.length > 0) {
      console.log(`[Onboarding] Migrating resume file from number array (${resumeFile.data.length} bytes) to base64...`);
      
      try {
        const uint8Array = new Uint8Array(resumeFile.data);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, i + chunkSize);
          binary += String.fromCharCode(...chunk);
        }
        const base64Data = btoa(binary);
        
        // Save migrated data (remove the bloated number array)
        await browser.storage.local.set({
          resumeFile: {
            name: resumeFile.name,
            type: resumeFile.type,
            size: resumeFile.size,
            dataBase64: base64Data,
            data: null, // Clear the bloated array
            lastUpdated: resumeFile.lastUpdated || Date.now(),
          }
        });
        
        console.log(`[Onboarding] Resume file migrated to base64 (${base64Data.length} chars, was ${resumeFile.data.length} numbers)`);
      } catch (migErr) {
        console.warn('[Onboarding] Failed to migrate resume file, clearing it:', migErr);
        // If migration fails, just remove the resume file data to free storage
        try {
          await browser.storage.local.remove('resumeFile');
        } catch (_) { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn('[Onboarding] Resume file migration check failed, skipping migration:', err);
    // This is likely a transient read error - skip migration rather than triggering
    // a destructive repair. The migration will be retried on the next page open.
  }
}

/**
 * Save resume file using chunked storage to handle large files (> ~300KB)
 * browser.storage.local struggles with single keys > ~400KB
 */
async function saveResumeWithChunking(file: File): Promise<void> {
  const CHUNK_SIZE = 100 * 1024; // 100KB per chunk (in base64 chars)

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  // Convert to base64
  let binary = '';
  const readChunkSize = 8192;
  for (let i = 0; i < uint8Array.length; i += readChunkSize) {
    const chunk = uint8Array.subarray(i, i + readChunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64Data = btoa(binary);

  const chunkCount = Math.ceil(base64Data.length / CHUNK_SIZE);
  console.log(`[Resume] Saving "${file.name}" as ${chunkCount} chunks (${base64Data.length} base64 chars)`);

  // Remove old single-key format first to free space
  try {
    await browser.storage.local.remove('resumeFile');
    // Also remove stale chunks from a previous upload
    const existingMeta = (await browser.storage.local.get('resumeFileMeta')).resumeFileMeta;
    if (existingMeta?.chunkCount) {
      const oldKeys = Array.from({ length: existingMeta.chunkCount }, (_, i) => `resumeChunk_${i}`);
      await browser.storage.local.remove(oldKeys);
    }
  } catch (_) { /* ignore cleanup errors */ }

  // Save metadata first
  await browser.storage.local.set({
    resumeFileMeta: {
      name: file.name,
      type: file.type,
      size: file.size,
      lastUpdated: Date.now(),
      chunkCount,
      chunked: true,
    }
  });

  // Save each chunk
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, base64Data.length);
    await browser.storage.local.set({ [`resumeChunk_${i}`]: base64Data.slice(start, end) });
    console.log(`[Resume] Saved chunk ${i + 1}/${chunkCount}`);
  }

  console.log(`[Resume] Resume saved successfully (${chunkCount} chunks)`);
}

async function init(): Promise<void> {
  // First, try to migrate any legacy bloated resume file storage
  await migrateResumeFileStorage();
  
  // Deep-link: open directly on the Learned Values step
  // Set by the popup "View Learned Values" button and the dashboard link.
  try {
    const flags = await browser.storage.local.get('showLearnedValues');
    if (flags.showLearnedValues) {
      await browser.storage.local.remove('showLearnedValues');
      await rlSystem.initialize();
      await loadLearnedValues(false);
      showStep('step-learned');
      // Hide the wizard nav and progress indicator — not needed for this view
      const wizard = document.getElementById('stepWizard');
      if (wizard) wizard.style.display = 'none';
      const indicator = document.getElementById('stepIndicator');
      if (indicator) (indicator.closest('.wizard-header') as HTMLElement | null)?.style && ((indicator.closest('.wizard-header') as HTMLElement).style.display = 'none');
      return; // Skip normal onboarding init
    }
  } catch (err) {
    console.warn('[Onboarding] Failed to check learned values flag:', err);
  }
  
  // Check if we're editing an existing profile
  let existingProfile: UserProfile | undefined;
  try {
    // Use retries first — transient Firefox storage errors resolve within milliseconds
    const existingProfileData = await retryStorageRead(
      () => browser.storage.local.get('userProfile'),
    );
    existingProfile = existingProfileData.userProfile as UserProfile | undefined;
  } catch (err) {
    console.error('[Onboarding] Failed to load existing profile after retries:', err);
    // Only repair storage after retries are exhausted
    const repaired = await repairStorage();
    if (repaired) {
      try {
        const retryData = await browser.storage.local.get('userProfile');
        existingProfile = retryData.userProfile as UserProfile | undefined;
        console.log('[Onboarding] Profile loaded after storage repair:', !!existingProfile);
      } catch (retryErr) {
        console.error('[Onboarding] Still failing after repair, starting completely fresh:', retryErr);
        existingProfile = undefined;
      }
    } else {
      console.error('[Onboarding] Storage repair failed, starting fresh');
      existingProfile = undefined;
    }
  }
  
  if (existingProfile) {
    console.log('[Onboarding] Existing profile found, pre-filling form...');
    
    // Clean up empty education entries before displaying
    if (existingProfile.education) {
      existingProfile.education = existingProfile.education.filter(edu => 
        edu.school && edu.school.trim() !== '' || 
        edu.degree && edu.degree.trim() !== '' ||
        edu.field && edu.field.trim() !== ''
      );
    }
    
    // Skip directly to the review step with existing data
    extractedProfile = existingProfile;
    showStep('step-review');
    renderProfilePreview(existingProfile);
    
    // Update the title to indicate we're editing
    const titleEl = document.querySelector('h1');
    if (titleEl) {
      titleEl.textContent = 'Edit Your Profile';
    }
    
    // Add a "Start Fresh" button at the top
    const reviewStepDiv = document.getElementById('step-review');
    if (reviewStepDiv) {
      const existingButton = reviewStepDiv.querySelector('#startFreshBtn');
      if (!existingButton) {
        const startFreshBtn = document.createElement('button');
        startFreshBtn.id = 'startFreshBtn';
        startFreshBtn.className = 'btn btn-secondary';
        startFreshBtn.textContent = 'Start Fresh (Upload New Resume)';
        startFreshBtn.style.cssText = 'margin-bottom: 16px; width: 100%;';
        startFreshBtn.onclick = () => {
          if (confirm('This will discard your current profile and start from scratch. Continue?')) {
            extractedProfile = null;
            showStep('step-ollama');
            checkOllamaConnection();
            
            // Reset title
            const titleEl = document.querySelector('h1');
            if (titleEl) {
              titleEl.textContent = 'Setup Your Profile';
            }
          }
        };
        
        reviewStepDiv.insertBefore(startFreshBtn, reviewStepDiv.firstChild);
      }
    }
    
    // Show a notice
    showStatus('info', 'Editing existing profile. Make your changes and click Save.');
  }
  
  // Check connection status on load
  const connected = await checkConnection();
  updateConnectionStatus(connected);

  // Setup Ollama step event listeners
  setupOllamaStepListeners();

  // For fresh users (no existing profile), AI Setup is now Step 1 — check Ollama right away
  if (!existingProfile) {
    showStep('step-ollama');
    checkOllamaConnection();
  }

  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('fileInput') as HTMLInputElement;
  const parseBtn = document.getElementById('parseBtn') as HTMLButtonElement;
  const skipUploadBtn = document.getElementById('skipUploadBtn');
  const backBtn = document.getElementById('backBtn');
  const saveBtn = document.getElementById('saveBtn');
  const doneBtn = document.getElementById('doneBtn');
  
  // Upload area click
  if (uploadArea && fileInput) {
    uploadArea.addEventListener('click', () => {
      fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    });
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragging');
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragging');
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragging');
      
      const file = e.dataTransfer?.files[0];
      if (file) {
        handleFileSelect(file);
      }
    });
  }
  
  // Skip upload button - go directly to personal info
  if (skipUploadBtn) {
    skipUploadBtn.addEventListener('click', () => {
      extractedProfile = createEmptyProfile();
      renderProfilePreview(extractedProfile);
      showStep('step-review');
    });
  }
  
  // Parse button
  if (parseBtn) {
    parseBtn.addEventListener('click', async () => {
      if (!uploadedFile) return;
      
      parseBtn.disabled = true;
      const originalText = parseBtn.textContent;
      setHTML(parseBtn, '<span class="spinner"></span>Parsing...');
      hideStatus();
      
      try {
        // Stage 1: Reading file
        updateProgress('read', 10, 'Reading file...');
        showLiveFeed();
        appendFeedLine('Starting resume analysis...', 'stage-label');
        
        // Stage 2: Extract text from file
        const resumeText = await extractTextFromFile(uploadedFile);
        updateProgress('extract', 50, 'Text extraction complete');

        // Stream the extracted text word-by-word to give live visual feedback
        streamTextToFeed(resumeText);
        
        // Stage 3: Parse with AI — start listening for background progress
        startProgressListener();
        const profile = await parseResume(resumeText);
        stopProgressListener();
        profile.resumeText = resumeText;
        
        extractedProfile = profile;
        
        // Stage 4: Complete
        updateProgress('done', 100, 'All done!');
        appendFeedLine('Profile parsed successfully!', 'done-line');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Resume parsed — go directly to personal info
        hideProgress();
        renderProfilePreview(profile);
        showStep('step-review');
      } catch (err) {
        stopProgressListener();
        hideProgress();
        showStatus('error', err instanceof Error ? err.message : 'Failed to parse resume');
        parseBtn.disabled = false;
        parseBtn.textContent = originalText;
      }
    });
  }
  
  // Back button
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      showStep('step-upload');
    });
  }
  
  // Save button (review step) - validate and go to links
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (!extractedProfile) return;
      
      try {
        const editedProfile = collectProfileFromForm();
        if (!editedProfile) {
          alert('Please fill in all required fields: First Name, Last Name, and Email.');
          return;
        }
        
        // Store the profile temporarily
        extractedProfile = editedProfile;
        
        console.log('[Onboarding] Moving to links step');
        prefillLinksForm(editedProfile);
        showStep('step-links');
      } catch (err) {
        alert('Failed to proceed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    });
  }

  // Setup mutually exclusive gender selection and self-ID interactivity (after DOM ready)
  setTimeout(() => {
    setupMutuallyExclusiveGender();
    setupSelfIdFormInteractivity();

    if (existingProfile && existingProfile.selfId) {
      preFillSelfIdForm(existingProfile.selfId);
    }
    
    if (existingProfile && existingProfile.workAuth) {
      preFillWorkAuthForm(existingProfile.workAuth);
    }
  }, 100);
  
  // Back button from Work Auth step
  const backFromWorkAuthBtn = document.getElementById('backFromWorkAuthBtn');
  if (backFromWorkAuthBtn) {
    backFromWorkAuthBtn.addEventListener('click', () => {
      showStep('step-selfid');
    });
  }
  
  // Watch for when Work Auth step becomes visible to pre-fill it
  const observer = new MutationObserver(() => {
    const workAuthStep = document.getElementById('step-workauth');
    
    if (workAuthStep?.classList.contains('active') && existingProfile?.workAuth) {
      preFillWorkAuthForm(existingProfile.workAuth);
    }
  });
  
  const stepsContainer = document.querySelector('.content');
  if (stepsContainer) {
    observer.observe(stepsContainer, { 
      attributes: true, 
      attributeFilter: ['class'],
      subtree: true 
    });
  }

  // Work Authorization buttons - now goes to cover letter step
  const saveWorkAuthBtn = document.getElementById('saveWorkAuthBtn');
  
  if (saveWorkAuthBtn) {
    saveWorkAuthBtn.addEventListener('click', async () => {
      console.log('[Onboarding] Save Work Auth clicked, moving to cover letter');
      if (extractedProfile) {
        const workAuthData = collectWorkAuthData();
        if (workAuthData) {
          extractedProfile.workAuth = workAuthData;
        }
      }
      showStep('step-coverletter');
    });
  }

  // Work Auth form conditional logic
  setupWorkAuthConditionalFields();

  // --- Links step buttons ---
  const backFromLinksBtn = document.getElementById('backFromLinksBtn');
  if (backFromLinksBtn) {
    backFromLinksBtn.addEventListener('click', () => {
      showStep('step-review');
    });
  }
  
  const saveLinksBtn = document.getElementById('saveLinksBtn');
  if (saveLinksBtn) {
    saveLinksBtn.addEventListener('click', () => {
      collectLinksFromForm();
      showStep('step-selfid');
    });
  }

  // --- Self-ID step buttons ---
  const backFromSelfIdBtn = document.getElementById('backFromSelfIdBtn');
  if (backFromSelfIdBtn) {
    backFromSelfIdBtn.addEventListener('click', () => {
      showStep('step-links');
    });
  }

  const saveSelfIdBtn = document.getElementById('saveSelfIdBtn');
  if (saveSelfIdBtn) {
    saveSelfIdBtn.addEventListener('click', () => {
      if (extractedProfile) {
        extractedProfile.selfId = collectSelfIdFromForm();
      }
      showStep('step-workauth');
    });
  }

  // --- Cover Letter step buttons ---
  const backFromCoverLetterBtn = document.getElementById('backFromCoverLetterBtn');
  if (backFromCoverLetterBtn) {
    backFromCoverLetterBtn.addEventListener('click', () => {
      showStep('step-workauth');
    });
  }

  const saveCoverLetterBtn = document.getElementById('saveCoverLetterBtn');
  if (saveCoverLetterBtn) {
    saveCoverLetterBtn.addEventListener('click', async () => {
      collectCoverLetterFromForm();
      await saveFinalProfile(false);
    });
  }

  // View Learned Values button (from success step)
  const viewLearnedBtn = document.getElementById('viewLearnedBtn');
  if (viewLearnedBtn) {
    viewLearnedBtn.addEventListener('click', async () => {
      await loadLearnedValues(true);
      showStep('step-learned');
    });
  }
  
  // Done button - go to home page
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      window.location.href = '../home/home.html';
    });
  }

  // --- Exit button - navigate to home page ---
  const exitBtn = document.getElementById('exitBtn');
  if (exitBtn) {
    exitBtn.addEventListener('click', () => {
      window.location.href = '../home/home.html';
    });
  }

  // --- Wizard step click navigation ---
  const wizardSteps = document.querySelectorAll('.wizard-step');
  wizardSteps.forEach((el, i) => {
    (el as HTMLElement).style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const targetStepId = STEP_ORDER[i];
      if (!targetStepId) return;
      // Only allow navigating to completed steps or the current active step
      if (el.classList.contains('completed') || el.classList.contains('active')) {
        showStep(targetStepId);
      }
    });
  });
  
  // Raw data toggle
  const rawDataToggle = document.getElementById('rawDataToggle');
  const rawDataContent = document.getElementById('rawDataContent');
  if (rawDataToggle && rawDataContent) {
    rawDataToggle.addEventListener('click', () => {
      const isExpanded = rawDataContent.classList.contains('expanded');
      rawDataContent.classList.toggle('expanded');
      
      const toggleIcon = rawDataToggle.querySelector('.raw-data-toggle');
      if (toggleIcon) {
        toggleIcon.textContent = isExpanded ? '[+] Show' : '[-] Hide';
      }
    });
  }
}

init().catch(err => {
  console.error('[Onboarding] Initialization failed:', err);
  
  // If storage is corrupted, offer to clear and retry
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (message.includes('unexpected') || message.includes('quota') || message.includes('corrupt')) {
    const shouldClear = confirm(
      'Failed to load profile data (storage may be full or corrupted). ' +
      'Would you like to clear storage and start fresh?'
    );
    if (shouldClear) {
      browser.storage.local.clear().then(() => {
        window.location.reload();
      }).catch(() => {
        alert('Failed to clear storage. Please try reinstalling the extension.');
      });
    }
  } else {
    // Show the AI setup step as fallback
    showStep('step-ollama');
    checkOllamaConnection();
    showStatus('error', `Failed to initialize: ${message}. You can still set up AI.`);
  }
});
