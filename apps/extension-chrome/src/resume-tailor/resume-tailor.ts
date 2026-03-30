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

// Wire up "Got it" dismiss for the PDF instructions banner
document.getElementById('pdf-instructions-close')?.addEventListener('click', () => {
  const el = document.getElementById('pdf-instructions');
  if (el) el.classList.remove('visible');
});

async function loadProfileResume(): Promise<void> {
  const profile = await getUserProfile();
  if (profile?.resumeText) {
    resumeTextArea.value = profile.resumeText;
    statusText.textContent = 'Resume loaded from active profile.';
  } else {
    statusText.textContent = 'No resume found. Paste your resume text.';
  }
}

btnScrape?.addEventListener('click', async () => {
  try {
    statusText.textContent = 'Scraping job description from active tab...';
    const response = await browser.runtime.sendMessage({ kind: 'SCRAPE_JOB_DESCRIPTION' });
    if (response?.text) {
      jdTextArea.value = response.text;
      statusText.textContent = 'Job description scraped successfully.';
    } else {
      statusText.textContent = 'Could not extract job description from the active tab.';
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
  resultText.textContent = '';
  tailoredResult = '';

  try {
    const [tailored, keywords] = await Promise.all([
      tailorResume(resume, jd, (chunk) => {
        tailoredResult += chunk;
        resultText.textContent = tailoredResult;
      }),
      analyzeKeywordGap(resume, jd),
    ]);

    tailoredResult = tailored;
    resultText.textContent = tailoredResult;

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

    printWindow.document.write(`
      <!DOCTYPE html><html><head>
      <title>Tailored Resume</title>
      <style>
        body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; margin: 1in; color: #000; }
        pre { white-space: pre-wrap; font-family: inherit; }
        @media print { body { margin: 0.5in; } }
      </style>
      </head><body>
      <pre>${escapeHtml(tailoredResult)}</pre>
      <script>
        // Slight delay so content renders before dialog opens
        setTimeout(function() { window.print(); }, 400);
      <\/script>
      </body></html>
    `);
    printWindow.document.close();
  } catch (err) {
    statusText.textContent = 'PDF export failed.';
    console.error('PDF export failed:', err);
  }
});

loadProfileResume();
