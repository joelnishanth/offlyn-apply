/**
 * Resume Tailor page logic — loads profile resume, accepts JD input,
 * calls Ollama for tailoring + keyword gap analysis, displays results.
 */

import browser from '../shared/browser-compat';
import { getUserProfile } from '../shared/profile';
import { tailorResume, analyzeKeywordGap } from '../shared/resume-tailor-service';

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function mdToHtml(md: string): string {
  let html = escapeHtml(md);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = '<p>' + html + '</p>';
  html = html.replace(/<p>\s*(<h[123]>)/g, '$1');
  html = html.replace(/(<\/h[123]>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*(<hr>)\s*<\/p>/g, '$1');
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

const resumeTextArea = document.getElementById('resume-text') as HTMLTextAreaElement;
const jdTextArea = document.getElementById('jd-text') as HTMLTextAreaElement;
const btnTailor = document.getElementById('btn-tailor') as HTMLButtonElement;
const btnExport = document.getElementById('btn-export') as HTMLButtonElement;
const btnCopy = document.getElementById('btn-copy') as HTMLButtonElement;
const btnScrape = document.getElementById('btn-scrape') as HTMLButtonElement;
const statusText = document.getElementById('status-text') as HTMLElement;
const keywordSection = document.getElementById('keyword-section') as HTMLElement;
const keywordScoreEl = document.getElementById('keyword-score') as HTMLElement;
const keywordsPresentEl = document.getElementById('keywords-present') as HTMLElement;
const keywordsMissingEl = document.getElementById('keywords-missing') as HTMLElement;
const resultPanel = document.getElementById('result-panel') as HTMLElement;
const resultText = document.getElementById('result-text') as HTMLElement;

let tailoredResult = '';
let sourceTabId: number | null = null;

// Wire up "Got it" dismiss for the PDF instructions banner
document.getElementById('pdf-instructions-close')?.addEventListener('click', () => {
  const el = document.getElementById('pdf-instructions');
  if (el) el.classList.remove('visible');
});

const OLLAMA_URL = 'http://localhost:11434';

async function checkOllamaStatus(): Promise<boolean> {
  const indicatorEl = document.getElementById('ollama-indicator');
  const statusLabelEl = document.getElementById('ollama-status-label');
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { method: 'GET', signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      if (indicatorEl) { indicatorEl.className = 'ollama-indicator connected'; }
      if (statusLabelEl) { statusLabelEl.textContent = 'Ollama Connected'; }
      if (btnTailor) btnTailor.disabled = false;
      return true;
    }
  } catch { /* offline */ }
  if (indicatorEl) { indicatorEl.className = 'ollama-indicator disconnected'; }
  if (statusLabelEl) {
    statusLabelEl.innerHTML = 'Ollama Offline — <a href="https://ollama.com/download" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Download</a> &amp; run <code style="font-size:11px;background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px;">ollama serve</code>';
  }
  if (btnTailor) { btnTailor.disabled = true; btnTailor.title = 'Ollama must be running to tailor your resume'; }
  return false;
}

async function loadProfileResume(): Promise<void> {
  const profile = await getUserProfile();
  if (profile?.resumeText) {
    resumeTextArea.value = profile.resumeText;
    statusText.textContent = 'Resume loaded from active profile.';
  } else {
    statusText.textContent = 'No resume found. Paste your resume text.';
  }
}

async function loadPendingJD(): Promise<void> {
  try {
    const data = await browser.storage.local.get([
      'pending_tailor_jd', 'pending_tailor_title', 'pending_tailor_company',
      'pending_tailor_url', 'pending_tailor_source_tab',
    ]);
    if (data.pending_tailor_jd && typeof data.pending_tailor_jd === 'string' && data.pending_tailor_jd.length > 10) {
      jdTextArea.value = data.pending_tailor_jd;
      const parts: string[] = [];
      if (data.pending_tailor_title) parts.push(data.pending_tailor_title);
      if (data.pending_tailor_company) parts.push(`at ${data.pending_tailor_company}`);
      statusText.textContent = parts.length
        ? `Job description loaded: ${parts.join(' ')}`
        : 'Job description loaded from previous page.';
    }
    if (data.pending_tailor_source_tab && typeof data.pending_tailor_source_tab === 'number') {
      sourceTabId = data.pending_tailor_source_tab;
    }
    await browser.storage.local.remove([
      'pending_tailor_jd', 'pending_tailor_title', 'pending_tailor_company',
      'pending_tailor_url', 'pending_tailor_source_tab',
    ]);
  } catch (err) {
    console.warn('Failed to load pending JD:', err);
  }
}

btnScrape?.addEventListener('click', async () => {
  try {
    statusText.textContent = 'Scraping job description...';
    const msg: any = { kind: 'SCRAPE_JOB_DESCRIPTION' };
    if (sourceTabId) msg.sourceTabId = sourceTabId;
    const response = await browser.runtime.sendMessage(msg);
    if (response?.text) {
      jdTextArea.value = response.text;
      statusText.textContent = 'Job description scraped successfully.';
    } else {
      statusText.textContent = 'Could not extract job description. Paste it manually.';
    }
  } catch (err) {
    console.error('Scrape failed:', err);
    statusText.textContent = 'Scrape failed. Paste the job description manually.';
  }
});

btnTailor?.addEventListener('click', async () => {
  const resume = resumeTextArea.value.trim();
  const jd = jdTextArea.value.trim();

  if (!resume) {
    statusText.textContent = 'Please provide your resume text.';
    return;
  }
  if (!jd) {
    statusText.textContent = 'Please provide a job description.';
    return;
  }

  btnTailor.disabled = true;
  statusText.textContent = 'Tailoring resume with AI...';
  resultPanel.classList.add('visible');
  resultText.innerHTML = '<p style="color:#6b7280;">Generating tailored resume...</p>';
  tailoredResult = '';

  try {
    const [tailored, keywords] = await Promise.all([
      tailorResume(resume, jd),
      analyzeKeywordGap(resume, jd),
    ]);

    tailoredResult = tailored;
    resultText.innerHTML = mdToHtml(tailoredResult);

    // Keyword gap UI
    keywordSection.classList.add('visible');
    const scoreClass = keywords.score >= 70 ? 'high' : keywords.score >= 40 ? 'medium' : 'low';
    keywordScoreEl.textContent = `${keywords.score}%`;
    keywordScoreEl.className = `keyword-score ${scoreClass}`;

    keywordsPresentEl.innerHTML = keywords.present
      .map(k => `<span class="keyword-badge present">${escapeHtml(k)}</span>`)
      .join('');
    keywordsMissingEl.innerHTML = keywords.missing
      .map(k => `<span class="keyword-badge missing">${escapeHtml(k)}</span>`)
      .join('');

    btnExport.disabled = false;
    btnCopy.disabled = false;
    statusText.textContent = 'Resume tailored successfully.';
  } catch (err) {
    console.error('Tailor failed:', err);
    statusText.textContent = `Error: ${err instanceof Error ? err.message : 'Tailoring failed'}. Is Ollama running?`;
  } finally {
    btnTailor.disabled = false;
  }
});

btnCopy?.addEventListener('click', async () => {
  if (!tailoredResult) return;
  await navigator.clipboard.writeText(tailoredResult);
  const orig = btnCopy.textContent;
  btnCopy.textContent = 'Copied!';
  setTimeout(() => { btnCopy.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`; }, 1500);
});

btnExport?.addEventListener('click', async () => {
  if (!tailoredResult) return;

  // Show the step-by-step instructions banner immediately
  const instrEl = document.getElementById('pdf-instructions');
  if (instrEl) instrEl.classList.add('visible');

  statusText.textContent = 'Opening print window — set Destination → "Save as PDF" then click Save.';

  try {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      statusText.textContent = 'Please allow popups to export PDF.';
      return;
    }

    const resumeHtml = mdToHtml(tailoredResult);
    printWindow.document.write(`
      <!DOCTYPE html><html><head>
      <title>Tailored Resume</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; margin: 1in; color: #000; }
        h1 { font-size: 18pt; margin: 0 0 4pt; }
        h2 { font-size: 14pt; margin: 12pt 0 4pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
        h3 { font-size: 12pt; margin: 8pt 0 2pt; }
        ul { margin: 4pt 0; padding-left: 18pt; }
        li { margin-bottom: 2pt; }
        p { margin: 4pt 0; }
        hr { border: none; border-top: 1px solid #999; margin: 10pt 0; }
        @media print { body { margin: 0.5in; } }
      </style>
      </head><body>
      ${resumeHtml}
      <script>setTimeout(function() { window.print(); }, 400);<\/script>
      </body></html>
    `);
    printWindow.document.close();
  } catch (err) {
    statusText.textContent = 'PDF export failed.';
    console.error('PDF export failed:', err);
  }
});

async function init(): Promise<void> {
  await loadProfileResume();
  await loadPendingJD();
  await checkOllamaStatus();
}
init();
