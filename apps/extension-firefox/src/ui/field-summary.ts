/**
 * Autofill Action Popup - compact floating panel that appears when a job
 * application page is detected. Replaces the old "detected fields" list
 * with actionable buttons: Auto-Fill, Smart Suggestions, Refresh.
 */

import type { FieldSchema } from '../shared/types';

let summaryPanel: HTMLElement | null = null;
let panelFields: FieldSchema[] = [];

/**
 * Show or update the autofill action popup
 */
export function showFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  panelFields = fields;

  // If panel exists, just update content
  if (summaryPanel && summaryPanel.parentElement) {
    updatePanelContent(summaryPanel, fields, jobTitle, company);
    return;
  }

  // Remove any orphaned panels
  const existing = document.getElementById('offlyn-field-summary');
  if (existing) existing.remove();

  // Inject styles once
  addStyles();

  // Build panel
  summaryPanel = document.createElement('div');
  summaryPanel.id = 'offlyn-field-summary';
  summaryPanel.innerHTML = buildPanelHTML(fields, jobTitle, company);

  document.body.appendChild(summaryPanel);

  // Wire up event listeners
  attachListeners(summaryPanel, fields);

  // Make header draggable
  makeDraggable(summaryPanel);
}

/**
 * Hide the panel
 */
export function hideFieldSummary(): void {
  if (summaryPanel) {
    summaryPanel.remove();
    summaryPanel = null;
  }
}

/**
 * Toggle visibility
 */
export function toggleFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  if (summaryPanel) {
    hideFieldSummary();
  } else {
    showFieldSummary(fields, jobTitle, company);
  }
}

// ── HTML Builder ──────────────────────────────────────────────────────────────

function buildPanelHTML(fields: FieldSchema[], jobTitle?: string, company?: string): string {
  const requiredCount = fields.filter(f => f.required).length;

  return `
    <div class="ofl-header">
      <div class="ofl-brand">
        <span class="ofl-logo">O</span>
        <span class="ofl-title">Offlyn</span>
      </div>
      <button class="ofl-close" title="Close">&times;</button>
    </div>

    <div class="ofl-body">
      ${jobTitle || company ? `
        <div class="ofl-job">
          ${jobTitle ? `<div class="ofl-job-title">${escapeHtml(jobTitle)}</div>` : ''}
          ${company ? `<div class="ofl-job-company">${escapeHtml(company)}</div>` : ''}
        </div>
      ` : ''}

      <div class="ofl-stats">
        <div class="ofl-stat">
          <span class="ofl-stat-num">${fields.length}</span>
          <span class="ofl-stat-label">fields</span>
        </div>
        ${requiredCount > 0 ? `
          <div class="ofl-stat">
            <span class="ofl-stat-num ofl-required">${requiredCount}</span>
            <span class="ofl-stat-label">required</span>
          </div>
        ` : ''}
      </div>

      <div class="ofl-actions">
        <button class="ofl-btn ofl-btn-fill" id="ofl-autofill-btn">
          <span class="ofl-btn-icon">&#9889;</span>
          Auto-Fill Form
        </button>
        <button class="ofl-btn ofl-btn-suggest" id="ofl-suggest-btn">
          <span class="ofl-btn-icon">&#10024;</span>
          Smart Suggestions
        </button>
      </div>

      <div class="ofl-status" id="ofl-status"></div>
    </div>

    <div class="ofl-footer">
      <button class="ofl-link-btn" id="ofl-refresh-btn" title="Re-scan page for fields">
        &#8635; Refresh
      </button>
      <span class="ofl-sep"></span>
      <button class="ofl-link-btn" id="ofl-details-btn" title="Copy field details as JSON">
        &#128203; Details
      </button>
    </div>
  `;
}

// ── Event Wiring ──────────────────────────────────────────────────────────────

function attachListeners(panel: HTMLElement, fields: FieldSchema[]): void {
  // Close
  panel.querySelector('.ofl-close')?.addEventListener('click', hideFieldSummary);

  // Auto-Fill
  panel.querySelector('#ofl-autofill-btn')?.addEventListener('click', () => {
    setStatus('Filling...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));
  });

  // Smart Suggestions
  panel.querySelector('#ofl-suggest-btn')?.addEventListener('click', () => {
    setStatus('Loading suggestions...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-show-suggestions'));
  });

  // Refresh
  panel.querySelector('#ofl-refresh-btn')?.addEventListener('click', () => {
    const btn = panel.querySelector('#ofl-refresh-btn') as HTMLButtonElement;
    if (btn) {
      btn.textContent = '⟳ Scanning...';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = '⟳ Refresh'; btn.disabled = false; }, 2000);
    }
    window.dispatchEvent(new CustomEvent('offlyn-refresh-scan'));
  });

  // Details (copy JSON)
  panel.querySelector('#ofl-details-btn')?.addEventListener('click', () => {
    const json = JSON.stringify(panelFields, null, 2);
    navigator.clipboard.writeText(json)
      .then(() => setStatus('Field details copied!', 'success'))
      .catch(() => setStatus('Copy failed', 'error'));
  });
}

function setStatus(text: string, type: 'info' | 'success' | 'error'): void {
  const el = summaryPanel?.querySelector('#ofl-status');
  if (!el) return;
  el.textContent = text;
  el.className = `ofl-status ofl-status-${type}`;
  if (type !== 'info') {
    setTimeout(() => { el.textContent = ''; el.className = 'ofl-status'; }, 3000);
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

function updatePanelContent(panel: HTMLElement, fields: FieldSchema[], jobTitle?: string, company?: string): void {
  panelFields = fields;
  const body = panel.querySelector('.ofl-body');
  if (!body) return;

  const requiredCount = fields.filter(f => f.required).length;

  // Update job info
  const jobEl = panel.querySelector('.ofl-job');
  if (jobTitle || company) {
    if (jobEl) {
      jobEl.innerHTML = `
        ${jobTitle ? `<div class="ofl-job-title">${escapeHtml(jobTitle)}</div>` : ''}
        ${company ? `<div class="ofl-job-company">${escapeHtml(company)}</div>` : ''}
      `;
    }
  }

  // Update stats
  const statsEl = panel.querySelector('.ofl-stats');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="ofl-stat">
        <span class="ofl-stat-num">${fields.length}</span>
        <span class="ofl-stat-label">fields</span>
      </div>
      ${requiredCount > 0 ? `
        <div class="ofl-stat">
          <span class="ofl-stat-num ofl-required">${requiredCount}</span>
          <span class="ofl-stat-label">required</span>
        </div>
      ` : ''}
    `;
  }
}

// ── Dragging ──────────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement): void {
  const header = panel.querySelector('.ofl-header') as HTMLElement;
  if (!header) return;

  let isDragging = false;
  let cx = 0, cy = 0, ix = 0, iy = 0;

  header.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('ofl-close')) return;
    isDragging = true;
    ix = e.clientX - cx;
    iy = e.clientY - cy;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    cx = e.clientX - ix;
    cy = e.clientY - iy;
    panel.style.transform = `translate(${cx}px, ${cy}px)`;
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ── Styles ────────────────────────────────────────────────────────────────────

function addStyles(): void {
  if (document.getElementById('offlyn-field-summary-styles')) return;

  const style = document.createElement('style');
  style.id = 'offlyn-field-summary-styles';
  style.textContent = `
    /* ─── Container ─── */
    #offlyn-field-summary {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 280px;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.08);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      overflow: hidden;
      color: #1a1a1a;
      transition: box-shadow .2s;
    }
    #offlyn-field-summary:hover {
      box-shadow: 0 12px 40px rgba(0,0,0,.22), 0 4px 12px rgba(0,0,0,.10);
    }

    /* ─── Header ─── */
    .ofl-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
    }
    .ofl-brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ofl-logo {
      width: 26px; height: 26px;
      background: rgba(255,255,255,.25);
      border-radius: 7px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 15px;
      color: #fff;
    }
    .ofl-title {
      font-weight: 700;
      font-size: 15px;
      color: #fff;
      letter-spacing: .3px;
    }
    .ofl-close {
      background: transparent;
      border: none;
      color: rgba(255,255,255,.8);
      font-size: 22px;
      cursor: pointer;
      width: 28px; height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .15s;
      padding: 0;
    }
    .ofl-close:hover {
      background: rgba(255,255,255,.2);
      color: #fff;
    }

    /* ─── Body ─── */
    .ofl-body {
      padding: 16px;
    }

    /* Job info */
    .ofl-job {
      margin-bottom: 14px;
    }
    .ofl-job-title {
      font-weight: 600;
      font-size: 14px;
      color: #1a1a1a;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .ofl-job-company {
      font-size: 12px;
      color: #888;
      margin-top: 2px;
    }

    /* Stats row */
    .ofl-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #f7f7fb;
      border-radius: 10px;
    }
    .ofl-stat {
      display: flex;
      align-items: baseline;
      gap: 5px;
    }
    .ofl-stat-num {
      font-size: 22px;
      font-weight: 700;
      color: #667eea;
      line-height: 1;
    }
    .ofl-stat-num.ofl-required {
      color: #f5576c;
    }
    .ofl-stat-label {
      font-size: 12px;
      color: #999;
      font-weight: 500;
    }

    /* Action buttons */
    .ofl-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .ofl-btn {
      width: 100%;
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all .2s;
      color: #fff;
      font-family: inherit;
    }
    .ofl-btn-icon {
      font-size: 16px;
    }
    .ofl-btn-fill {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .ofl-btn-fill:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, .4);
    }
    .ofl-btn-fill:active {
      transform: translateY(0);
    }
    .ofl-btn-suggest {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    .ofl-btn-suggest:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(240, 147, 251, .4);
    }
    .ofl-btn-suggest:active {
      transform: translateY(0);
    }

    /* Status message */
    .ofl-status {
      text-align: center;
      font-size: 12px;
      margin-top: 8px;
      min-height: 18px;
      border-radius: 6px;
      padding: 0 8px;
      transition: all .2s;
    }
    .ofl-status-info  { color: #667eea; }
    .ofl-status-success { color: #2e7d32; background: #e8f5e9; padding: 4px 8px; }
    .ofl-status-error   { color: #c62828; background: #ffebee; padding: 4px 8px; }

    /* ─── Footer ─── */
    .ofl-footer {
      padding: 8px 16px;
      border-top: 1px solid #f0f0f0;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ofl-link-btn {
      background: none;
      border: none;
      color: #999;
      font-size: 12px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      transition: all .15s;
      font-family: inherit;
    }
    .ofl-link-btn:hover {
      color: #667eea;
      background: #f5f5ff;
    }
    .ofl-link-btn:disabled {
      opacity: .5;
      cursor: default;
    }
    .ofl-sep {
      flex: 1;
    }
  `;

  document.head.appendChild(style);
}
