/**
 * Settings page logic
 */
import browser from '../shared/browser-compat';
import { getSettings, setSettings } from '../shared/storage';
import { log, error } from '../shared/log';
import { getOllamaConfig, saveOllamaConfig, testOllamaConnection, DEFAULT_OLLAMA_CONFIG } from '../shared/ollama-config';
import { setHTML } from '../shared/html';

async function init(): Promise<void> {
  const settings = await getSettings();

  // --- Toggles ---
  const enabledToggle = document.getElementById('toggle-enabled');
  const dryrunToggle = document.getElementById('toggle-dryrun');

  if (enabledToggle) {
    enabledToggle.classList.toggle('active', settings.enabled);
    enabledToggle.setAttribute('aria-checked', String(settings.enabled));
    enabledToggle.addEventListener('click', async () => {
      const next = !enabledToggle.classList.contains('active');
      enabledToggle.classList.toggle('active', next);
      enabledToggle.setAttribute('aria-checked', String(next));
      await setSettings({ enabled: next });
    });
  }

  if (dryrunToggle) {
    dryrunToggle.classList.toggle('active', settings.dryRun);
    dryrunToggle.setAttribute('aria-checked', String(settings.dryRun));
    dryrunToggle.addEventListener('click', async () => {
      const next = !dryrunToggle.classList.contains('active');
      dryrunToggle.classList.toggle('active', next);
      dryrunToggle.setAttribute('aria-checked', String(next));
      await setSettings({ dryRun: next });
    });
  }

  // --- WhatsApp number ---
  const whatsappInput = document.getElementById('input-whatsapp') as HTMLInputElement | null;
  if (whatsappInput) {
    whatsappInput.value = settings.whatsappTarget || '';
    let debounce: ReturnType<typeof setTimeout>;
    whatsappInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const val = whatsappInput.value.trim();
        await setSettings({ whatsappTarget: val || undefined });
      }, 600);
    });
  }

  // --- Update Resume (re-upload & re-parse) ---
  const reuploadBtn = document.getElementById('btn-reupload-resume');
  const reuploadInput = document.getElementById('reupload-resume-input') as HTMLInputElement | null;
  const reuploadFeedback = document.getElementById('feedback-reupload') as HTMLElement | null;

  function showReuploadStatus(msg: string, isError = false): void {
    if (!reuploadFeedback) return;
    reuploadFeedback.textContent = msg;
    reuploadFeedback.style.display = 'inline';
    reuploadFeedback.style.color = isError ? '#dc2626' : '#16a34a';
  }

  async function extractTextForSettings(file: File): Promise<string> {
    const name = file.name.toLowerCase();
    if (file.type === 'text/plain' || name.endsWith('.txt')) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read text file'));
        reader.readAsText(file);
      });
    }
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
      const pdfjsLib = (window as any).pdfjsLib;
      if (!pdfjsLib) throw new Error('PDF reader not available. Please reload the page and try again.');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
      }
      return text;
    }
    if (name.endsWith('.docx') ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = (window as any).mammoth;
      if (!mammoth) throw new Error('DOCX reader not available. Please reload the page and try again.');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (!result.value?.trim()) throw new Error('Could not extract text from DOCX file.');
      return result.value;
    }
    throw new Error(`Unsupported file type. Please upload a PDF, DOCX, or TXT file.`);
  }

  if (reuploadBtn && reuploadInput) {
    reuploadBtn.addEventListener('click', () => reuploadInput.click());

    reuploadInput.addEventListener('change', async () => {
      const file = reuploadInput.files?.[0];
      if (!file) return;
      reuploadInput.value = '';

      reuploadBtn.setAttribute('disabled', 'true');
      showReuploadStatus('Parsing resume...');

      try {
        const resumeText = await extractTextForSettings(file);

        // Quality gate
        const nonPrintable = (resumeText.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) || []).length;
        if (nonPrintable / Math.max(resumeText.length, 1) > 0.05) {
          throw new Error('File appears garbled or is a scanned image. Use a text-based PDF, DOCX, or TXT.');
        }
        if (resumeText.trim().length < 100) {
          throw new Error('Extracted text is too short. Is the file empty?');
        }

        showReuploadStatus('AI is analyzing your resume...');
        const response = await browser.runtime.sendMessage({ kind: 'PARSE_RESUME', resumeText });

        if (response?.kind === 'RESUME_PARSED' && response.profile) {
          // Merge: preserve selfId, workAuth, professional links — overwrite skills/work/education/summary
          const existing = (await browser.storage.local.get('userProfile'))?.userProfile || {};
          const merged = {
            ...existing,
            skills: response.profile.skills || existing.skills || [],
            work: response.profile.work || existing.work || [],
            education: response.profile.education || existing.education || [],
            summary: response.profile.summary || existing.summary || '',
            resumeText,
            lastUpdated: Date.now(),
          };
          await browser.storage.local.set({ userProfile: merged });
          showReuploadStatus('Profile updated!');
        } else {
          throw new Error(response?.error || 'Parse failed. Please try again.');
        }
      } catch (err) {
        showReuploadStatus(err instanceof Error ? err.message : 'Failed to update resume.', true);
      } finally {
        reuploadBtn.removeAttribute('disabled');
      }
    });
  }

  // --- Export Profile ---
  document.getElementById('btn-export-profile')?.addEventListener('click', async () => {
    try {
      const result = await browser.storage.local.get('userProfile');
      const profile = result.userProfile;
      if (!profile) { alert('No profile found. Set up your profile first.'); return; }
      await navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
      showFeedback('feedback-export');
    } catch (err) { error('Export failed:', err); }
  });

  // --- View Learned Values ---
  document.getElementById('btn-view-learned')?.addEventListener('click', async () => {
    await browser.storage.local.set({ showLearnedValues: true });
    browser.tabs.create({ url: browser.runtime.getURL('onboarding/onboarding.html') });
  });

  // --- Reset Self-ID ---
  document.getElementById('btn-clean-selfid')?.addEventListener('click', async () => {
    if (!confirm('Reset Self-ID data (Gender, Race, Disability, Veteran Status) to defaults?\n\nYour personal info and work history will not be affected.')) return;
    try {
      const result = await browser.storage.local.get('userProfile');
      const profile = result.userProfile;
      if (!profile) { alert('No profile found.'); return; }
      profile.selfId = {
        gender: [], race: [], orientation: [],
        veteran: 'Decline to self-identify',
        transgender: 'Decline to self-identify',
        disability: 'Decline to self-identify',
      };
      profile.lastUpdated = Date.now();
      await browser.storage.local.set({ userProfile: profile });
      showFeedback('feedback-selfid');
    } catch (err) { error('Self-ID reset failed:', err); }
  });

  // --- Clear All Applications ---
  document.getElementById('btn-clear-apps')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL tracked job applications?\n\nThis cannot be undone.')) return;
    try {
      const allKeys = await browser.storage.local.get(null);
      const summaryKeys = Object.keys(allKeys).filter(k => k.startsWith('dailySummary_'));
      if (summaryKeys.length > 0) {
        await browser.storage.local.remove(summaryKeys);
      }
      showFeedback('feedback-clear');
    } catch (err) { error('Clear apps failed:', err); }
  });

  // --- Danger Zone: Clear All Data ---
  const confirmPanel = document.getElementById('danger-confirm-panel');

  document.getElementById('btn-open-clear-all')?.addEventListener('click', () => {
    confirmPanel?.classList.add('open');
    confirmPanel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btn-cancel-clear')?.addEventListener('click', () => {
    confirmPanel?.classList.remove('open');
  });

  document.getElementById('btn-download-data')?.addEventListener('click', async () => {
    try {
      const allData = await browser.storage.local.get(null);
      const json = JSON.stringify(allData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offlyn-data-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { error('Data download failed:', err); }
  });

  document.getElementById('btn-nuke-all')?.addEventListener('click', async () => {
    const nukeBtn = document.getElementById('btn-nuke-all') as HTMLButtonElement;
    if (nukeBtn) {
      nukeBtn.textContent = 'Deleting...';
      nukeBtn.disabled = true;
    }
    try {
      await browser.storage.local.clear();
      // Reload so settings UI reflects the cleared state
      window.location.reload();
    } catch (err) {
      error('Nuclear clear failed:', err);
      if (nukeBtn) { nukeBtn.textContent = 'Delete Everything'; nukeBtn.disabled = false; }
    }
  });

  // --- Storage usage ---
  try {
    const allData = await browser.storage.local.get(null);
    const bytes = new Blob([JSON.stringify(allData)]).size;
    const kb = (bytes / 1024).toFixed(1);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const pct = Math.min(100, (bytes / (10 * 1024 * 1024)) * 100);
    const fill = document.getElementById('storage-fill');
    const text = document.getElementById('storage-text');
    if (fill) fill.style.width = `${pct}%`;
    if (text) text.textContent = bytes > 1024 * 1024 ? `${mb} MB used` : `${kb} KB used`;
  } catch { /* ignore */ }

  // --- Ollama Configuration section ---
  await initOllamaSettings();

  // --- Version ---
  try {
    const manifest = browser.runtime.getManifest();
    const v = manifest.version || '0.1.0';
    const versionText = document.getElementById('version-text');
    const footerVersion = document.getElementById('footer-version');
    if (versionText) versionText.textContent = v;
    if (footerVersion) footerVersion.textContent = `v${v}`;
  } catch { /* ignore */ }

  log('Settings page initialized');
}

function showFeedback(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

async function initOllamaSettings(): Promise<void> {
  const badge = document.getElementById('ollama-badge') as HTMLElement | null;
  const hint = document.getElementById('ollama-status') as HTMLElement | null;
  const epInput = document.getElementById('settings-ollama-endpoint') as HTMLInputElement | null;
  const chatInput = document.getElementById('settings-ollama-chat-model') as HTMLInputElement | null;
  const embInput = document.getElementById('settings-ollama-embed-model') as HTMLInputElement | null;
  const testResultEl = document.getElementById('settings-ollama-test-result') as HTMLElement | null;

  // Load current config into inputs
  try {
    const config = await getOllamaConfig();
    if (epInput) epInput.value = config.endpoint;
    if (chatInput) chatInput.value = config.chatModel;
    if (embInput) embInput.value = config.embeddingModel;

    // Show connection status badge
    const result = await testOllamaConnection(config.endpoint);
    applyOllamaBadge(badge, hint, result, config.endpoint, config.enabled);
  } catch (err) {
    error('Failed to load Ollama config:', err);
  }

  // Test connection button
  document.getElementById('btn-test-ollama')?.addEventListener('click', async () => {
    const endpoint = epInput?.value.trim() || DEFAULT_OLLAMA_CONFIG.endpoint;
    if (testResultEl) {
      testResultEl.textContent = 'Testing...';
      testResultEl.className = 'ollama-test-result visible';
    }
    const result = await testOllamaConnection(endpoint);
    if (testResultEl) {
      if (!result.success) {
        testResultEl.textContent = `Cannot reach Ollama: ${result.error}`;
        testResultEl.className = 'ollama-test-result visible fail';
      } else if (result.corsBlocked) {
        setHTML(testResultEl,
          `<strong>CORS Blocked</strong> — Ollama v${result.version} is running but blocking this extension.<br><br>` +
          `<strong>Fix:</strong> Stop Ollama, then run this as ONE command in a new terminal:<br>` +
          `<code style="background:#1e2a3a;color:#fbbf24;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:6px;font-size:12px;word-break:break-all;">` +
          `OLLAMA_ORIGINS='chrome-extension://*' ollama serve</code><br>` +
          `<span style="font-size:11px;color:#6b7280;margin-top:4px;display:inline-block;">Keep that terminal open, then click Test Connection again.</span>`);
        testResultEl.className = 'ollama-test-result visible fail';
      } else {
        testResultEl.textContent = `Connected! Ollama v${result.version} — AI features fully working`;
        testResultEl.className = 'ollama-test-result visible ok';
      }
    }
    applyOllamaBadge(badge, hint, result, endpoint, true);
  });

  // Save config button
  document.getElementById('btn-save-ollama')?.addEventListener('click', async () => {
    try {
      const endpoint = epInput?.value.trim() || DEFAULT_OLLAMA_CONFIG.endpoint;
      const chatModel = chatInput?.value.trim() || DEFAULT_OLLAMA_CONFIG.chatModel;
      const embeddingModel = embInput?.value.trim() || DEFAULT_OLLAMA_CONFIG.embeddingModel;

      const cfg = await getOllamaConfig();
      cfg.endpoint = endpoint;
      cfg.chatModel = chatModel;
      cfg.embeddingModel = embeddingModel;

      // Test before enabling — only enable if both reachable AND CORS is not blocked
      const result = await testOllamaConnection(endpoint);
      cfg.enabled = result.success && !result.corsBlocked;
      cfg.lastChecked = Date.now();
      await saveOllamaConfig(cfg);

      applyOllamaBadge(badge, hint, result, endpoint, cfg.enabled);
      showFeedback('feedback-ollama');
    } catch (err) {
      error('Failed to save Ollama config:', err);
    }
  });
}

/** Apply badge + hint text based on connection test result */
function applyOllamaBadge(
  badge: HTMLElement | null,
  hint: HTMLElement | null,
  result: Awaited<ReturnType<typeof testOllamaConnection>>,
  endpoint: string,
  enabled: boolean,
): void {
  if (!result.success) {
    if (badge) { badge.textContent = 'Offline'; badge.style.background = '#ffebee'; badge.style.color = '#c62828'; }
    if (hint) hint.textContent = enabled ? 'Cannot reach Ollama — check that it is running' : 'AI features disabled — configure below to enable';
  } else if (result.corsBlocked) {
    if (badge) { badge.textContent = 'CORS Blocked'; badge.style.background = '#fffbeb'; badge.style.color = '#d97706'; }
    if (hint) hint.textContent = `Ollama v${result.version} reachable but blocking extension. Stop Ollama, then run as one command: OLLAMA_ORIGINS='chrome-extension://*' ollama serve`;
  } else {
    if (badge) { badge.textContent = 'Connected'; badge.style.background = '#e8f5e9'; badge.style.color = '#2e7d32'; }
    if (hint) hint.textContent = `Ollama v${result.version} at ${endpoint} — AI features ready`;
  }
}

init();
