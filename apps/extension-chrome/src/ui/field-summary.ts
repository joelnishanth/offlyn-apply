/**
 * Autofill Action Popup — floating panel that appears when a job application
 * page is detected. Shows fully for 3 seconds, then auto-minimizes into a
 * small branded cube. Click the cube to re-expand.
 *
 * Three panel states:
 *   expanded    — full panel (default)
 *   minimized   — 48×48 cube (auto after 3 s, or via minimize button)
 *   edge-folded — 88×88 semi-circle tab protruding from any viewport edge
 *                 (triggered automatically when dragged within 80px of an edge)
 *
 * Dragging: header drags the expanded panel; cube drags the minimized panel.
 * Pointer capture is set on the handle element so events are guaranteed even
 * when the pointer leaves the element or a host-page SPA calls stopPropagation.
 * Grid snapping (20px) is applied on drop. Dragging near any edge auto-folds.
 */

import browser from '../shared/browser-compat';
import type { FieldSchema } from '../shared/types';
import { setHTML } from '../shared/html';

let summaryPanel: HTMLElement | null = null;
let panelFields: FieldSchema[] = [];

type PanelState = 'expanded' | 'minimized' | 'edge-folded';
type FoldSide   = 'left' | 'right' | 'top' | 'bottom';

let panelState: PanelState = 'expanded';

let autoMinTimer: ReturnType<typeof setTimeout> | null = null;
let mouseInsidePanel = false;

// Drag state — panel always uses direct left/top pixel positioning once dragged
let panelLeft = 0;
let panelTop  = 0;
let anchoredLeft = false;
let foldedSide: FoldSide | null = null;

// ── Public API ─────────────────────────────────────────────────────────────

export function showFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  panelFields = fields;

  if (summaryPanel && summaryPanel.parentElement) {
    updatePanelContent(summaryPanel, fields, jobTitle, company);
    scheduleAutoMinimize();
    return;
  }

  document.getElementById('offlyn-field-summary')?.remove();

  addStyles();

  summaryPanel = document.createElement('div');
  summaryPanel.id = 'offlyn-field-summary';
  setHTML(summaryPanel, buildPanelHTML(fields, jobTitle, company));

  document.body.appendChild(summaryPanel);

  attachListeners(summaryPanel);
  makeDraggable(summaryPanel);

  panelState = 'expanded';
  anchoredLeft = false;
  foldedSide = null;
  panelLeft = 0;
  panelTop  = 0;

  scheduleAutoMinimize();
}

export function hideFieldSummary(): void {
  clearAutoMinTimer();
  mouseInsidePanel = false;
  if (summaryPanel) { summaryPanel.remove(); summaryPanel = null; }
  panelState = 'expanded';
}

export function toggleFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  if (summaryPanel) hideFieldSummary();
  else showFieldSummary(fields, jobTitle, company);
}

// ── State transitions ──────────────────────────────────────────────────────

function scheduleAutoMinimize(): void {
  clearAutoMinTimer();
  if (mouseInsidePanel) return;
  autoMinTimer = setTimeout(() => {
    if (summaryPanel && panelState === 'expanded' && !mouseInsidePanel) minimizePanel();
  }, 3000);
}

function clearAutoMinTimer(): void {
  if (autoMinTimer) { clearTimeout(autoMinTimer); autoMinTimer = null; }
}

function minimizePanel(): void {
  if (!summaryPanel || panelState !== 'expanded') return;
  panelState = 'minimized';
  summaryPanel.className = 'ofl-minimized';

  const body = summaryPanel.querySelector('.ofl-body') as HTMLElement;
  const footer = summaryPanel.querySelector('.ofl-footer') as HTMLElement;
  const header = summaryPanel.querySelector('.ofl-header') as HTMLElement;
  const cube = summaryPanel.querySelector('.ofl-cube') as HTMLElement;
  const edgeTab = summaryPanel.querySelector('.ofl-edge-tab') as HTMLElement;

  if (body) body.style.display = 'none';
  if (footer) footer.style.display = 'none';
  if (header) header.style.display = 'none';
  if (cube) cube.style.display = 'flex';
  if (edgeTab) edgeTab.style.display = 'none';
}

function expandPanel(autoMin = true): void {
  if (!summaryPanel || panelState === 'expanded') return;
  panelState = 'expanded';
  summaryPanel.className = '';
  summaryPanel.style.width  = '';
  summaryPanel.style.height = '';

  const body    = summaryPanel.querySelector('.ofl-body')     as HTMLElement;
  const footer  = summaryPanel.querySelector('.ofl-footer')   as HTMLElement;
  const header  = summaryPanel.querySelector('.ofl-header')   as HTMLElement;
  const cube    = summaryPanel.querySelector('.ofl-cube')     as HTMLElement;
  const edgeTab = summaryPanel.querySelector('.ofl-edge-tab') as HTMLElement;

  if (body)    body.style.display    = '';
  if (footer)  footer.style.display  = '';
  if (header)  header.style.display  = '';
  if (cube)    cube.style.display    = 'none';
  if (edgeTab) edgeTab.style.display = 'none';

  // Restore position: snap to a grid-aligned point near whichever edge we folded from
  if (foldedSide !== null) {
    const panelW = summaryPanel.offsetWidth  || 280;
    const panelH = summaryPanel.offsetHeight || 200;
    switch (foldedSide) {
      case 'right':  panelLeft = snapToGrid(window.innerWidth  - panelW - 20); break;
      case 'left':   panelLeft = snapToGrid(20);                                break;
      case 'top':    panelTop  = snapToGrid(20);                                break;
      case 'bottom': panelTop  = snapToGrid(window.innerHeight - panelH - 20); break;
    }
    panelLeft = Math.max(0, Math.min(panelLeft, window.innerWidth  - panelW));
    panelTop  = Math.max(0, Math.min(panelTop,  window.innerHeight - panelH));
    applyPos(summaryPanel, panelLeft, panelTop);
    anchoredLeft = true;
  } else if (anchoredLeft) {
    applyPos(summaryPanel, panelLeft, panelTop);
  }
  foldedSide = null;

  if (autoMin) scheduleAutoMinimize();
}

// Semi-circle handle dimensions: 88×88, half protrudes from edge (44px visible)
const FOLD_SIZE = 88;
const FOLD_HALF = 44;

function foldToEdge(side: FoldSide): void {
  if (!summaryPanel) return;
  clearAutoMinTimer();
  panelState = 'edge-folded';
  foldedSide = side;
  summaryPanel.className = `ofl-edge-folded ofl-edge-${side}`;

  const body    = summaryPanel.querySelector('.ofl-body')     as HTMLElement;
  const footer  = summaryPanel.querySelector('.ofl-footer')   as HTMLElement;
  const header  = summaryPanel.querySelector('.ofl-header')   as HTMLElement;
  const cube    = summaryPanel.querySelector('.ofl-cube')     as HTMLElement;
  const edgeTab = summaryPanel.querySelector('.ofl-edge-tab') as HTMLElement;

  if (body)    body.style.display    = 'none';
  if (footer)  footer.style.display  = 'none';
  if (header)  header.style.display  = 'none';
  if (cube)    cube.style.display    = 'none';
  if (edgeTab) edgeTab.style.display = 'flex';

  summaryPanel.style.width     = `${FOLD_SIZE}px`;
  summaryPanel.style.height    = `${FOLD_SIZE}px`;
  summaryPanel.style.transform = '';
  summaryPanel.style.bottom    = '';

  switch (side) {
    case 'right':
      summaryPanel.style.left  = `${window.innerWidth - FOLD_HALF}px`;
      summaryPanel.style.top   = `${snapToGrid(Math.max(0, Math.min(panelTop,  window.innerHeight - FOLD_SIZE)))}px`;
      summaryPanel.style.right = '';
      break;
    case 'left':
      summaryPanel.style.left  = `${-FOLD_HALF}px`;
      summaryPanel.style.top   = `${snapToGrid(Math.max(0, Math.min(panelTop,  window.innerHeight - FOLD_SIZE)))}px`;
      summaryPanel.style.right = '';
      break;
    case 'top':
      summaryPanel.style.top   = `${-FOLD_HALF}px`;
      summaryPanel.style.left  = `${snapToGrid(Math.max(0, Math.min(panelLeft, window.innerWidth  - FOLD_SIZE)))}px`;
      summaryPanel.style.right = '';
      break;
    case 'bottom':
      summaryPanel.style.top   = `${window.innerHeight - FOLD_HALF}px`;
      summaryPanel.style.left  = `${snapToGrid(Math.max(0, Math.min(panelLeft, window.innerWidth  - FOLD_SIZE)))}px`;
      summaryPanel.style.right = '';
      break;
  }
}

/**
 * Ensure the field summary is expanded and keep it expanded (no auto-minimize).
 * Used when returning from sub-panels like the cover letter panel.
 */
export function ensureFieldSummaryExpanded(): void {
  clearAutoMinTimer();
  if (summaryPanel && panelState !== 'expanded') {
    expandPanel(false);
  }
  clearAutoMinTimer();
}

// ── HTML ───────────────────────────────────────────────────────────────────

function buildPanelHTML(fields: FieldSchema[], jobTitle?: string, company?: string): string {
  const requiredCount = fields.filter(f => f.required).length;
  const cubeIconUrl = browser.runtime.getURL('icons/monogram-transparent.png');
  const headerIconUrl = browser.runtime.getURL('icons/primary-logo.png');

  return `
    <!-- Minimized cube (hidden initially) -->
    <div class="ofl-cube" style="display:none;" title="Click to expand Offlyn Apply">
      <img class="ofl-cube-logo" src="${cubeIconUrl}" alt="Offlyn Apply">
    </div>

    <!-- Edge-docked tab (hidden initially) -->
    <div class="ofl-edge-tab" style="display:none;" title="Click to expand Offlyn Apply">
      <img class="ofl-edge-tab-logo" src="${cubeIconUrl}" alt="Offlyn Apply">
    </div>

    <!-- Expanded view -->
    <div class="ofl-header">
      <div class="ofl-drag-grip" title="Drag to move">
        <span class="ofl-grip-dots">⠿</span>
      </div>
      <div class="ofl-brand">
        <img class="ofl-logo" src="${headerIconUrl}" alt="Offlyn Apply">
        <span class="ofl-title">Offlyn Apply</span>
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
  panel.querySelector('.ofl-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideFieldSummary();
  });

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

  // Edge tab click → expand
  panel.querySelector('.ofl-edge-tab')?.addEventListener('click', (e) => {
    e.stopPropagation();
    expandPanel();
  });

  panel.querySelector('#ofl-autofill-btn')?.addEventListener('click', () => {
    setStatus('Filling...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));
  });

  panel.querySelector('#ofl-cover-letter-btn')?.addEventListener('click', () => {
    setStatus('Generating cover letter...', 'info');
    window.dispatchEvent(new CustomEvent('offlyn-generate-cover-letter'));
  });

  panel.querySelector('#ofl-refresh-btn')?.addEventListener('click', () => {
    const btn = panel.querySelector('#ofl-refresh-btn') as HTMLButtonElement;
    if (btn) {
      btn.textContent = '⟳ Scanning...';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = '⟳ Refresh'; btn.disabled = false; }, 2000);
    }
    window.dispatchEvent(new CustomEvent('offlyn-refresh-scan'));
  });

  panel.querySelector('#ofl-details-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(JSON.stringify(panelFields, null, 2))
      .then(() => setStatus('Field details copied!', 'success'))
      .catch(() => setStatus('Copy failed', 'error'));
  });

  panel.addEventListener('mouseenter', () => {
    mouseInsidePanel = true;
    if (panelState === 'expanded') clearAutoMinTimer();
  });
  panel.addEventListener('mouseleave', () => {
    mouseInsidePanel = false;
    if (panelState === 'expanded') scheduleAutoMinimize();
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
      setHTML(jobEl, `
        ${jobTitle ? `<div class="ofl-job-title">${escapeHtml(jobTitle)}</div>` : ''}
        ${company ? `<div class="ofl-job-company">${escapeHtml(company)}</div>` : ''}
      `);
    }
  }

  const statsEl = panel.querySelector('.ofl-stats');
  if (statsEl) {
    setHTML(statsEl, `
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
    `);
  }
}

// ── Dragging ───────────────────────────────────────────────────────────────

const DRAG_GRID = 20;      // snap grid (px)
const EDGE_THRESHOLD = 60; // distance from edge to trigger fold (px)

function snapToGrid(v: number): number {
  return Math.round(v / DRAG_GRID) * DRAG_GRID;
}

function applyPos(panel: HTMLElement, left: number, top: number): void {
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = '';
  panel.style.bottom = '';
  panel.style.transform = '';
}

function anchorToLeft(panel: HTMLElement): void {
  if (anchoredLeft) return;
  anchoredLeft = true;
  const rect = panel.getBoundingClientRect();
  panelLeft = rect.left;
  panelTop = rect.top;
  applyPos(panel, panelLeft, panelTop);
}

function makeDraggable(panel: HTMLElement): void {
  let isDragging = false;
  let startPX   = 0;
  let startPY   = 0;
  let startLeft = 0;
  let startTop  = 0;

  function clamp(left: number, top: number): { left: number; top: number } {
    const pw = panel.offsetWidth  || 280;
    const ph = panel.offsetHeight || 200;
    return {
      left: Math.max(0, Math.min(left, window.innerWidth  - pw)),
      top:  Math.max(0, Math.min(top,  window.innerHeight - ph)),
    };
  }

  function onPointerDown(this: HTMLElement, e: PointerEvent): void {
    if (panelState === 'edge-folded') return;
    if ((e.target as HTMLElement).closest('button')) return;

    anchorToLeft(panel);
    isDragging = true;
    startPX   = e.clientX;
    startPY   = e.clientY;
    startLeft = panelLeft;
    startTop  = panelTop;

    // Capture on the specific handle element so events route here reliably
    this.setPointerCapture(e.pointerId);
    panel.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!isDragging) return;
    const { left, top } = clamp(
      startLeft + (e.clientX - startPX),
      startTop  + (e.clientY - startPY),
    );
    panelLeft = left;
    panelTop  = top;
    applyPos(panel, left, top);
  }

  function onPointerUp(this: HTMLElement, e: PointerEvent): void {
    if (!isDragging) return;
    isDragging = false;
    panel.style.cursor = '';
    this.releasePointerCapture(e.pointerId);

    // Snap to grid
    const { left, top } = clamp(snapToGrid(panelLeft), snapToGrid(panelTop));
    panelLeft = left;
    panelTop  = top;

    // Edge-fold detection (all 4 edges)
    const pw = panel.offsetWidth  || 280;
    const ph = panel.offsetHeight || 200;
    const nearRight  = (window.innerWidth  - (left + pw)) < EDGE_THRESHOLD;
    const nearLeft   = left                               < EDGE_THRESHOLD;
    const nearTop    = top                                < EDGE_THRESHOLD;
    const nearBottom = (window.innerHeight - (top  + ph)) < EDGE_THRESHOLD;

    if      (nearRight)  foldToEdge('right');
    else if (nearLeft)   foldToEdge('left');
    else if (nearTop)    foldToEdge('top');
    else if (nearBottom) foldToEdge('bottom');
    else                 applyPos(panel, left, top);
  }

  // Attach pointer events to each drag handle so capture targets the right element
  const handles = [
    panel.querySelector('.ofl-header'),
    panel.querySelector('.ofl-cube'),
  ].filter(Boolean) as HTMLElement[];

  for (const handle of handles) {
    handle.addEventListener('pointerdown',   onPointerDown as EventListener);
    handle.addEventListener('pointermove',   onPointerMove as EventListener);
    handle.addEventListener('pointerup',     onPointerUp   as EventListener);
    handle.addEventListener('pointercancel', onPointerUp   as EventListener);
  }
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
      box-shadow: 0 6px 24px rgba(30, 42, 58, 0.25);
    }

    /* ─── Edge-folded state — 88×88 semi-circle tab protruding from viewport edge ─── */
    #offlyn-field-summary.ofl-edge-folded {
      width: 88px !important;
      height: 88px !important;
      cursor: pointer;
      overflow: hidden;
      background: #0F172A;
      transition: transform .18s ease, box-shadow .18s ease;
    }
    /* Right edge: left half-circle visible, right half off-screen */
    #offlyn-field-summary.ofl-edge-right {
      border-radius: 50% 0 0 50%;
      box-shadow: -4px 0 20px rgba(0,0,0,.30);
    }
    #offlyn-field-summary.ofl-edge-right:hover {
      transform: translateX(-6px);
      box-shadow: -8px 0 28px rgba(39, 227, 141, 0.45);
    }
    /* Left edge: right half-circle visible, left half off-screen */
    #offlyn-field-summary.ofl-edge-left {
      border-radius: 0 50% 50% 0;
      box-shadow: 4px 0 20px rgba(0,0,0,.30);
    }
    #offlyn-field-summary.ofl-edge-left:hover {
      transform: translateX(6px);
      box-shadow: 8px 0 28px rgba(39, 227, 141, 0.45);
    }
    /* Top edge: bottom half-circle visible, top half off-screen */
    #offlyn-field-summary.ofl-edge-top {
      border-radius: 0 0 50% 50%;
      box-shadow: 0 4px 20px rgba(0,0,0,.30);
    }
    #offlyn-field-summary.ofl-edge-top:hover {
      transform: translateY(6px);
      box-shadow: 0 8px 28px rgba(39, 227, 141, 0.45);
    }
    /* Bottom edge: top half-circle visible, bottom half off-screen */
    #offlyn-field-summary.ofl-edge-bottom {
      border-radius: 50% 50% 0 0;
      box-shadow: 0 -4px 20px rgba(0,0,0,.30);
    }
    #offlyn-field-summary.ofl-edge-bottom:hover {
      transform: translateY(-6px);
      box-shadow: 0 -8px 28px rgba(39, 227, 141, 0.45);
    }

    /* ─── Edge tab content ─── */
    .ofl-edge-tab {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px 6px;
    }
    .ofl-edge-tab-logo {
      width: 26px;
      height: 26px;
      object-fit: contain;
      user-select: none;
      pointer-events: none;
      filter: brightness(10);
    }

    /* ─── Cube logo ─── */
    .ofl-cube {
      width: 64px;
      height: 40px;
      background:
        linear-gradient(
          180deg,
          rgba(255,255,255,0.55) 0%,
          rgba(255,255,255,0.06) 50%,
          rgba(255,255,255,0.00) 51%
        ),
        #FFFCF0;
      border: none;
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 10px;
      cursor: pointer;
      box-shadow:
        0 3px 10px rgba(30, 41, 59, 0.20),
        inset 0 1px 2px rgba(255,255,255,0.90);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
      overflow: hidden;
    }
    .ofl-cube:hover {
      transform: scale(1.08);
      box-shadow:
        0 5px 16px rgba(22, 163, 74, 0.30),
        inset 0 1px 2px rgba(255,255,255,0.90);
    }
    .ofl-cube-logo {
      width: 100%;
      height: 100%;
      object-fit: contain;
      user-select: none;
      pointer-events: none;
    }

    /* ─── Header ─── */
    .ofl-header {
      background: #0F172A;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: grab;
    }
    .ofl-header:active { cursor: grabbing; }

    .ofl-drag-grip {
      color: rgba(255,255,255,0.35);
      font-size: 14px;
      line-height: 1;
      cursor: grab;
      flex-shrink: 0;
      user-select: none;
      padding: 0 2px;
      transition: color .15s;
    }
    .ofl-header:hover .ofl-drag-grip { color: rgba(255,255,255,0.7); }

    .ofl-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
    }
    .ofl-logo {
      width: 22px; height: 22px;
      border-radius: 5px;
      object-fit: contain;
      flex-shrink: 0;
    }
    .ofl-title {
      font-weight: 700;
      font-size: 14px;
      color: #fff;
      letter-spacing: .3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ofl-header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }
    .ofl-minimize-btn,
    .ofl-close {
      background: transparent;
      border: none;
      color: rgba(255,255,255,.7);
      font-size: 16px;
      cursor: pointer;
      width: 26px; height: 26px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all .15s;
      padding: 0;
      font-family: inherit;
      flex-shrink: 0;
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
      font-size: 22px; font-weight: 700; color: #0F172A; line-height: 1;
    }
    .ofl-stat-num.ofl-required { color: #EF4444; }
    .ofl-stat-label { font-size: 12px; color: #64748B; font-weight: 500; }

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
      background: #27E38D;
      color: #0F172A;
    }
    .ofl-btn-fill:hover {
      background: #22CC7A;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(39, 227, 141, 0.3);
    }
    .ofl-btn-fill:active {
      background: #1EB86B;
      transform: translateY(0);
    }
    .ofl-btn-cover {
      background: #0F172A;
      color: #FFFFFF;
      border: 2px solid #27E38D;
    }
    .ofl-btn-cover:hover {
      background: #1E293B;
      border-color: #22CC7A;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(39, 227, 141, 0.2);
    }
    .ofl-btn-cover:active {
      background: #0F172A;
      transform: translateY(0);
    }

    .ofl-status {
      text-align: center;
      font-size: 12px;
      margin-top: 8px;
      min-height: 18px;
      border-radius: 6px;
      padding: 0 8px;
      transition: all .2s;
    }
    .ofl-status-info  { color: #0F172A; }
    .ofl-status-success { color: #0F172A; background: rgba(39, 227, 141, 0.15); padding: 4px 8px; border: 1px solid #27E38D; }
    .ofl-status-error   { color: #0F172A; background: rgba(239, 68, 68, 0.15); padding: 4px 8px; border: 1px solid #EF4444; }

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
      color: #64748B;
      font-size: 12px;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      transition: all .15s;
      font-family: inherit;
    }
    .ofl-link-btn:hover {
      color: #0F172A;
      background: rgba(39, 227, 141, 0.1);
    }
    .ofl-link-btn:disabled { opacity: .5; cursor: default; }
    .ofl-sep { flex: 1; }
  `;

  document.head.appendChild(style);
}
