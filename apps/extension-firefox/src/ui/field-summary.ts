/**
 * Autofill Action Popup — floating panel that appears when a job application
 * page is detected. Shows fully for 3 seconds, then auto-minimizes into a
 * small branded cube. Click the cube to re-expand.
 */

import type { FieldSchema } from '../shared/types';

let summaryPanel: HTMLElement | null = null;
let panelFields: FieldSchema[] = [];
let isMinimized = false;
let autoMinTimer: ReturnType<typeof setTimeout> | null = null;
let mouseInsidePanel = false;
let dragOffset = { x: 0, y: 0 }; // persists across minimize/expand

// ── Public API ─────────────────────────────────────────────────────────────

export function showFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  panelFields = fields;

  if (summaryPanel && summaryPanel.parentElement) {
    updatePanelContent(summaryPanel, fields, jobTitle, company);
    // Reset auto-minimize timer on updates
    scheduleAutoMinimize();
    return;
  }

  // Remove orphaned panels
  document.getElementById('offlyn-field-summary')?.remove();

  addStyles();

  // Build expanded panel
  summaryPanel = document.createElement('div');
  summaryPanel.id = 'offlyn-field-summary';
  summaryPanel.innerHTML = buildPanelHTML(fields, jobTitle, company);

  document.body.appendChild(summaryPanel);

  attachListeners(summaryPanel);
  makeDraggable(summaryPanel);

  isMinimized = false;

  // Auto-minimize after 3 seconds
  scheduleAutoMinimize();
}

export function hideFieldSummary(): void {
  clearAutoMinTimer();
  mouseInsidePanel = false;
  if (summaryPanel) { summaryPanel.remove(); summaryPanel = null; }
  isMinimized = false;
}

export function toggleFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  if (summaryPanel) hideFieldSummary();
  else showFieldSummary(fields, jobTitle, company);
}

// ── Minimize / Expand ──────────────────────────────────────────────────────

function scheduleAutoMinimize(): void {
  clearAutoMinTimer();
  // Don't even start the timer if the mouse is already inside the panel
  if (mouseInsidePanel) return;
  autoMinTimer = setTimeout(() => {
    // Double-check: don't minimize if mouse moved in while timer was running
    if (summaryPanel && !isMinimized && !mouseInsidePanel) minimizePanel();
  }, 3000);
}

function clearAutoMinTimer(): void {
  if (autoMinTimer) { clearTimeout(autoMinTimer); autoMinTimer = null; }
}

function minimizePanel(): void {
  if (!summaryPanel || isMinimized) return;
  isMinimized = true;

  summaryPanel.classList.add('ofl-minimized');

  // Hide inner content, show cube logo
  const body = summaryPanel.querySelector('.ofl-body') as HTMLElement;
  const footer = summaryPanel.querySelector('.ofl-footer') as HTMLElement;
  const header = summaryPanel.querySelector('.ofl-header') as HTMLElement;
  const cube = summaryPanel.querySelector('.ofl-cube') as HTMLElement;

  if (body) body.style.display = 'none';
  if (footer) footer.style.display = 'none';
  if (header) header.style.display = 'none';
  if (cube) cube.style.display = 'flex';
}

function expandPanel(): void {
  if (!summaryPanel || !isMinimized) return;
  isMinimized = false;

  summaryPanel.classList.remove('ofl-minimized');

  const body = summaryPanel.querySelector('.ofl-body') as HTMLElement;
  const footer = summaryPanel.querySelector('.ofl-footer') as HTMLElement;
  const header = summaryPanel.querySelector('.ofl-header') as HTMLElement;
  const cube = summaryPanel.querySelector('.ofl-cube') as HTMLElement;

  if (body) body.style.display = '';
  if (footer) footer.style.display = '';
  if (header) header.style.display = '';
  if (cube) cube.style.display = 'none';

  // Auto-minimize again after 5 seconds when re-expanded
  scheduleAutoMinimize();
}

// ── HTML ───────────────────────────────────────────────────────────────────

function buildPanelHTML(fields: FieldSchema[], jobTitle?: string, company?: string): string {
  const requiredCount = fields.filter(f => f.required).length;

  return `
    <!-- Minimized cube (hidden initially) -->
    <div class="ofl-cube" style="display:none;" title="Click to expand Offlyn">
      <span class="ofl-cube-logo">O</span>
    </div>

    <!-- Expanded view -->
    <div class="ofl-header">
      <div class="ofl-brand">
        <span class="ofl-logo">O</span>
        <span class="ofl-title">Offlyn</span>
      </div>
      <div class="ofl-header-actions">
        <button class="ofl-minimize-btn" title="Minimize">&#8722;</button>
        <button class="ofl-close" title="Close">&times;</button>
      </div>
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
        <button class="ofl-btn ofl-btn-cover" id="ofl-cover-letter-btn">
          <span class="ofl-btn-icon">&#9998;</span>
          Cover Letter
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

// ── Listeners ──────────────────────────────────────────────────────────────

function attachListeners(panel: HTMLElement): void {
  // Close
  panel.querySelector('.ofl-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideFieldSummary();
  });

  // Minimize button
  panel.querySelector('.ofl-minimize-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearAutoMinTimer();
    minimizePanel();
  });

  // Cube click → expand
  panel.querySelector('.ofl-cube')?.addEventListener('click', (e) => {
    e.stopPropagation();
    expandPanel();
  });

  // Auto-Fill
  panel.querySelector('#ofl-autofill-btn')?.addEventListener('click', () => {
    setStatus('Filling...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));
  });

  // Cover Letter
  panel.querySelector('#ofl-cover-letter-btn')?.addEventListener('click', () => {
    setStatus('Generating cover letter...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-generate-cover-letter'));
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

  // Details
  panel.querySelector('#ofl-details-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(panelFields, null, 2))
      .then(() => setStatus('Field details copied!', 'success'))
      .catch(() => setStatus('Copy failed', 'error'));
  });

  // Pause auto-minimize while user's mouse is inside the panel
  panel.addEventListener('mouseenter', () => {
    mouseInsidePanel = true;
    if (!isMinimized) clearAutoMinTimer();
  });
  panel.addEventListener('mouseleave', () => {
    mouseInsidePanel = false;
    if (!isMinimized) scheduleAutoMinimize();
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

// ── Update ─────────────────────────────────────────────────────────────────

function updatePanelContent(panel: HTMLElement, fields: FieldSchema[], jobTitle?: string, company?: string): void {
  panelFields = fields;
  const requiredCount = fields.filter(f => f.required).length;

  const jobEl = panel.querySelector('.ofl-job');
  if (jobTitle || company) {
    if (jobEl) {
      jobEl.innerHTML = `
        ${jobTitle ? `<div class="ofl-job-title">${escapeHtml(jobTitle)}</div>` : ''}
        ${company ? `<div class="ofl-job-company">${escapeHtml(company)}</div>` : ''}
      `;
    }
  }

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

// ── Dragging ───────────────────────────────────────────────────────────────

function makeDraggable(panel: HTMLElement): void {
  let isDragging = false;
  let ix = 0, iy = 0;

  const startDrag = (e: MouseEvent) => {
    // Don't drag from buttons
    const t = e.target as HTMLElement;
    if (t.closest('button')) return;
    isDragging = true;
    ix = e.clientX - dragOffset.x;
    iy = e.clientY - dragOffset.y;
    e.preventDefault();
  };

  // Header is the drag handle when expanded
  panel.querySelector('.ofl-header')?.addEventListener('mousedown', startDrag);
  // Cube is the drag handle when minimized
  panel.querySelector('.ofl-cube')?.addEventListener('mousedown', startDrag);

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    dragOffset.x = e.clientX - ix;
    dragOffset.y = e.clientY - iy;
    if (panel) panel.style.transform = `translate(${dragOffset.x}px, ${dragOffset.y}px)`;
  });

  document.addEventListener('mouseup', () => { isDragging = false; });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ── Styles ─────────────────────────────────────────────────────────────────

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
      transition: width .35s cubic-bezier(.4,0,.2,1),
                  height .35s cubic-bezier(.4,0,.2,1),
                  border-radius .35s cubic-bezier(.4,0,.2,1),
                  box-shadow .2s;
    }
    #offlyn-field-summary:hover {
      box-shadow: 0 12px 40px rgba(0,0,0,.22), 0 4px 12px rgba(0,0,0,.10);
    }

    /* ─── Minimized cube state ─── */
    #offlyn-field-summary.ofl-minimized {
      width: 48px;
      height: 48px !important;
      border-radius: 14px;
      cursor: pointer;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.08);
    }
    #offlyn-field-summary.ofl-minimized:hover {
      box-shadow: 0 6px 24px rgba(102, 126, 234, .35);
      transform: translate(var(--tx, 0), var(--ty, 0)) scale(1.08);
    }

    /* ─── Cube logo ─── */
    .ofl-cube {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .ofl-cube-logo {
      font-weight: 800;
      font-size: 20px;
      color: #fff;
      user-select: none;
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
    .ofl-header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .ofl-minimize-btn,
    .ofl-close {
      background: transparent;
      border: none;
      color: rgba(255,255,255,.8);
      font-size: 20px;
      cursor: pointer;
      width: 28px; height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .15s;
      padding: 0;
      font-family: inherit;
    }
    .ofl-minimize-btn:hover,
    .ofl-close:hover {
      background: rgba(255,255,255,.2);
      color: #fff;
    }

    /* ─── Body ─── */
    .ofl-body { padding: 16px; }

    .ofl-job { margin-bottom: 14px; }
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

    .ofl-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #f7f7fb;
      border-radius: 10px;
    }
    .ofl-stat { display: flex; align-items: baseline; gap: 5px; }
    .ofl-stat-num {
      font-size: 22px; font-weight: 700; color: #667eea; line-height: 1;
    }
    .ofl-stat-num.ofl-required { color: #f5576c; }
    .ofl-stat-label { font-size: 12px; color: #999; font-weight: 500; }

    .ofl-actions { display: flex; flex-direction: column; gap: 8px; }
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
    .ofl-btn-icon { font-size: 16px; }
    .ofl-btn-fill {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .ofl-btn-fill:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, .4);
    }
    .ofl-btn-fill:active { transform: translateY(0); }
    .ofl-btn-cover {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    .ofl-btn-cover:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(240, 147, 251, .4);
    }
    .ofl-btn-cover:active { transform: translateY(0); }

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
    .ofl-link-btn:hover { color: #667eea; background: #f5f5ff; }
    .ofl-link-btn:disabled { opacity: .5; cursor: default; }
    .ofl-sep { flex: 1; }
  `;

  document.head.appendChild(style);
}
