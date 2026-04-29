/**
 * Cover letter preview panel — right-side slide-in panel that shows the
 * generated cover letter with live streaming preview. Once approved the user
 * can download as PDF, copy, auto-apply, or refine (shorten / lengthen /
 * make more impactful).
 */

import type { CoverLetterResult } from '../shared/cover-letter-service';
import { setHTML } from '../shared/html';

// ── State ────────────────────────────────────────────────────────────────────

type PanelPhase = 'generating' | 'preview' | 'refining' | 'error';

interface PanelState {
  phase: PanelPhase;
  partialText: string;
  result: CoverLetterResult | null;
  errorMsg: string | null;
  jobTitle: string;
  company: string;
  onAutoApply?: (text: string) => void;
}

let state: PanelState = {
  phase: 'generating',
  partialText: '',
  result: null,
  errorMsg: null,
  jobTitle: '',
  company: '',
};

let panelEl: HTMLElement | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Open the panel in "generating" mode. Call `updatePreview` as tokens stream
 * in, then `showFinalResult` when done.
 */
export function openCoverLetterPanel(
  jobTitle: string,
  company: string,
  onAutoApply?: (text: string) => void,
): void {
  state = {
    phase: 'generating',
    partialText: '',
    result: null,
    errorMsg: null,
    jobTitle,
    company,
    onAutoApply,
  };
  injectStyles();
  render();
}

/** Live-update the preview body while streaming. */
export function updateCoverLetterPreview(partialText: string): void {
  state.partialText = partialText;
  const body = panelEl?.querySelector('.ocl-body-text') as HTMLElement | null;
  if (body) body.innerText = partialText;
  // Auto-scroll to bottom while generating
  const bodyWrap = panelEl?.querySelector('.ocl-body') as HTMLElement | null;
  if (bodyWrap) bodyWrap.scrollTop = bodyWrap.scrollHeight;
}

/** Called once generation is complete. */
export function showCoverLetterResult(result: CoverLetterResult): void {
  state.phase = 'preview';
  state.result = result;
  state.partialText = result.text;
  // Update text
  const body = panelEl?.querySelector('.ocl-body-text') as HTMLElement | null;
  if (body) body.innerText = result.text;
  // Show action buttons + refinement bar, hide spinner
  panelEl?.querySelector('.ocl-generating')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-refining')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-actions')?.classList.remove('ocl-hidden');
  panelEl?.querySelector('.ocl-refine-bar')?.classList.remove('ocl-hidden');
  // Enable copy button
  const copyBtn = panelEl?.querySelector('.ocl-btn-copy') as HTMLButtonElement | null;
  if (copyBtn) copyBtn.disabled = false;
  // Enable refine buttons
  panelEl?.querySelectorAll('.ocl-refine-btn').forEach(b => {
    (b as HTMLButtonElement).disabled = false;
  });
}

/** Called if generation fails. */
export function showCoverLetterError(msg: string): void {
  state.phase = 'error';
  state.errorMsg = msg;
  const body = panelEl?.querySelector('.ocl-body-text') as HTMLElement | null;
  if (body) {
    body.innerText = '';
    setHTML(body, `<div class="ocl-error">${escHtml(msg)}</div>`);
  }
  panelEl?.querySelector('.ocl-generating')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-refining')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-actions')?.classList.remove('ocl-hidden');
}

export function hideCoverLetterPanel(): void {
  panelEl?.remove();
  panelEl = null;
}

export function isCoverLetterPanelVisible(): boolean {
  return !!panelEl;
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  panelEl?.remove();

  const panel = document.createElement('div');
  panel.id = 'offlyn-cover-letter-panel';

  const hasAutoApply = !!state.onAutoApply;

  setHTML(panel, `
    <div class="ocl-header">
      <button class="ocl-back" title="Back">&#8592;</button>
      <div class="ocl-header-center">
        <div class="ocl-title">Cover Letter</div>
        <div class="ocl-subtitle">${escHtml(state.jobTitle)}${state.company ? ` · ${escHtml(state.company)}` : ''}</div>
      </div>
      <button class="ocl-close" title="Close">&times;</button>
    </div>

    <div class="ocl-body">
      <!-- Generating indicator -->
      <div class="ocl-generating">
        <span class="ocl-spinner"></span>
        <span>Generating your cover letter…</span>
      </div>
      <!-- Refining indicator -->
      <div class="ocl-refining ocl-hidden">
        <span class="ocl-spinner"></span>
        <span>Refining your cover letter…</span>
      </div>
      <!-- Letter text -->
      <div class="ocl-body-text"></div>
    </div>

    <!-- Refinement bar (between body and actions) -->
    <div class="ocl-refine-bar ocl-hidden">
      <span class="ocl-refine-label">Refine:</span>
      <button class="ocl-refine-btn" data-refine="shorten" title="Make it shorter and more concise">Shorten</button>
      <button class="ocl-refine-btn" data-refine="lengthen" title="Expand with more detail">Lengthen</button>
      <button class="ocl-refine-btn" data-refine="impactful" title="Make it more compelling and impactful">More Impactful</button>
    </div>

    <div class="ocl-actions ocl-hidden">
      <button class="ocl-btn ocl-btn-copy" disabled title="Copy to clipboard">
        &#128203; Copy
      </button>
      <button class="ocl-btn ocl-btn-download" title="Download as text file">
        &#8681; Download
      </button>
      ${hasAutoApply ? `
        <button class="ocl-btn ocl-btn-apply" title="Paste into the cover letter field on this page">
          &#9889; Auto-Apply
        </button>
      ` : ''}
      <button class="ocl-btn ocl-btn-regen" title="Regenerate from scratch">
        &#8635; Regenerate
      </button>
    </div>
  `);

  document.body.appendChild(panel);
  panelEl = panel;

  // ── Listeners ──────────────────────────────────────────────────────────

  // Back button — close panel, signal content.ts to expand field summary
  panel.querySelector('.ocl-back')?.addEventListener('click', () => {
    hideCoverLetterPanel();
    window.dispatchEvent(new CustomEvent('offlyn-cover-letter-back'));
  });

  // Close button — just close, no back navigation
  panel.querySelector('.ocl-close')?.addEventListener('click', () => hideCoverLetterPanel());

  // ESC
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { hideCoverLetterPanel(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Copy
  panel.querySelector('.ocl-btn-copy')?.addEventListener('click', async () => {
    const text = state.result?.text || state.partialText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flashButton(panel.querySelector('.ocl-btn-copy') as HTMLButtonElement, 'Copied!');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      flashButton(panel.querySelector('.ocl-btn-copy') as HTMLButtonElement, 'Copied!');
    }
  });

  // Download .txt
  panel.querySelector('.ocl-btn-download')?.addEventListener('click', () => {
    const text = state.result?.text || state.partialText;
    if (!text) return;
    const filename = `Cover_Letter_${sanitizeFilename(state.company || 'Company')}_${sanitizeFilename(state.jobTitle || 'Position')}.txt`;
    downloadText(text, filename);
    flashButton(panel.querySelector('.ocl-btn-download') as HTMLButtonElement, 'Downloaded!');
  });

  // Auto-Apply
  panel.querySelector('.ocl-btn-apply')?.addEventListener('click', () => {
    const text = state.result?.text || state.partialText;
    if (!text) return;
    state.onAutoApply?.(text);
    flashButton(panel.querySelector('.ocl-btn-apply') as HTMLButtonElement, 'Applied!');
  });

  // Regenerate
  panel.querySelector('.ocl-btn-regen')?.addEventListener('click', () => {
    resetToGenerating();
    window.dispatchEvent(new CustomEvent('offlyn-regenerate-cover-letter'));
  });

  // Refinement buttons
  panel.querySelectorAll('.ocl-refine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = (btn as HTMLElement).dataset.refine;
      if (!action) return;
      const currentText = state.result?.text || state.partialText;
      if (!currentText) return;

      // Show refining indicator
      state.phase = 'refining';
      panelEl?.querySelector('.ocl-refining')?.classList.remove('ocl-hidden');
      panelEl?.querySelector('.ocl-refine-bar')?.classList.add('ocl-hidden');
      panelEl?.querySelector('.ocl-actions')?.classList.add('ocl-hidden');

      // Disable refine buttons
      panelEl?.querySelectorAll('.ocl-refine-btn').forEach(b => {
        (b as HTMLButtonElement).disabled = true;
      });

      // Dispatch event for content.ts to handle
      window.dispatchEvent(new CustomEvent('offlyn-refine-cover-letter', {
        detail: { action, currentText },
      }));
    });
  });

  // Slide in
  requestAnimationFrame(() => panel.classList.add('ocl--open'));
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function resetToGenerating(): void {
  state.phase = 'generating';
  state.partialText = '';
  state.result = null;
  const body = panelEl?.querySelector('.ocl-body-text') as HTMLElement;
  if (body) body.innerText = '';
  panelEl?.querySelector('.ocl-generating')?.classList.remove('ocl-hidden');
  panelEl?.querySelector('.ocl-refining')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-refine-bar')?.classList.add('ocl-hidden');
  panelEl?.querySelector('.ocl-actions')?.classList.add('ocl-hidden');
}

function flashButton(btn: HTMLButtonElement | null, text: string): void {
  if (!btn) return;
  const origNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => { btn.replaceChildren(...origNodes); btn.disabled = false; }, 1500);
}

// ── Download ────────────────────────────────────────────────────────────────

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 40);
}

function escHtml(t: string): string {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById('ocl-styles')) return;
  const s = document.createElement('style');
  s.id = 'ocl-styles';
  s.textContent = `
/* ── Panel container ── */
#offlyn-cover-letter-panel {
  position: fixed;
  top: 0; right: 0;
  width: 440px;
  height: 100vh;
  background: #fff;
  box-shadow: -4px 0 24px rgba(0,0,0,.12);
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a1a;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform .3s cubic-bezier(.4,0,.2,1);
}
#offlyn-cover-letter-panel.ocl--open {
  transform: translateX(0);
}

/* ── Header ── */
.ocl-header {
  padding: 12px 16px;
  background: linear-gradient(135deg, #0a0a0a 0%, #1a7f5a 100%);
  color: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.ocl-back {
  background: rgba(255,255,255,.15);
  border: none; color: #fff; width: 32px; height: 32px;
  border-radius: 6px; cursor: pointer; font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.ocl-back:hover { background: rgba(255,255,255,.3); }
.ocl-header-center { flex: 1; min-width: 0; }
.ocl-title { font-weight: 700; font-size: 16px; line-height: 1.2; }
.ocl-subtitle {
  font-size: 12px; opacity: .85; margin-top: 2px;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ocl-close {
  background: rgba(255,255,255,.15);
  border: none; color: #fff; width: 32px; height: 32px;
  border-radius: 6px; cursor: pointer; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s; flex-shrink: 0;
}
.ocl-close:hover { background: rgba(255,255,255,.3); }

/* ── Body ── */
.ocl-body {
  flex: 1; overflow-y: auto; padding: 20px;
  scrollbar-width: thin;
}
.ocl-generating, .ocl-refining {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; margin-bottom: 16px;
  background: #e6f4ee; border-radius: 8px;
  font-size: 13px; color: #0a0a0a;
}
.ocl-spinner {
  width: 16px; height: 16px;
  border: 2px solid rgba(124, 179, 66, 0.3);
  border-top-color: #1a7f5a;
  border-radius: 50%;
  animation: oclSpin .7s linear infinite;
  flex-shrink: 0;
}
@keyframes oclSpin { to { transform: rotate(360deg); } }

.ocl-body-text {
  font-size: 14px;
  line-height: 1.75;
  color: #1f2937;
  white-space: pre-wrap;
  word-break: break-word;
}

.ocl-error {
  color: #dc2626;
  background: #fef2f2;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
}

.ocl-hidden { display: none !important; }

/* ── Refinement bar ── */
.ocl-refine-bar {
  padding: 10px 20px;
  border-top: 1px solid #e2e0da;
  background: #f5f9f0;
  display: flex; align-items: center; gap: 8px;
  flex-shrink: 0;
}
.ocl-refine-label {
  font-size: 12px; font-weight: 600; color: #0a0a0a;
  flex-shrink: 0;
}
.ocl-refine-btn {
  padding: 5px 12px; border-radius: 6px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; border: 1px solid rgba(124, 179, 66, 0.4);
  background: #fff; color: #1a7f5a;
  transition: all .15s; font-family: inherit;
}
.ocl-refine-btn:hover {
  background: #1a7f5a; color: #fff; border-color: #1a7f5a;
}
.ocl-refine-btn:disabled {
  opacity: .5; cursor: default;
  background: #fff; color: #1a7f5a;
}

/* ── Actions ── */
.ocl-actions {
  padding: 12px 20px;
  border-top: 1px solid #e2e0da;
  background: #f9fafb;
  display: flex; flex-wrap: wrap; gap: 8px;
  flex-shrink: 0;
}
.ocl-btn {
  padding: 8px 14px; border-radius: 8px;
  font-size: 12px; font-weight: 600;
  cursor: pointer; border: 1px solid #d1d5db;
  background: #fff; color: #374151;
  transition: all .15s; font-family: inherit;
  display: flex; align-items: center; gap: 4px;
}
.ocl-btn:hover { background: #f3f4f6; border-color: #9ca3af; }
.ocl-btn:disabled { opacity: .5; cursor: default; }

.ocl-btn-apply {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a7f5a 100%);
  color: #fff; border: none;
}
.ocl-btn-apply:hover {
  box-shadow: 0 4px 14px rgba(30, 42, 58, 0.3);
  transform: translateY(-1px);
}
.ocl-btn-regen {
  margin-left: auto;
  color: #0a0a0a; border-color: rgba(124, 179, 66, 0.3);
}
.ocl-btn-regen:hover { background: #e6f4ee; }
  `;
  document.head.appendChild(s);
}
