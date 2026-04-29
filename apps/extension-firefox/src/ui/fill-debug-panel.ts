/**
 * Fill Debug Panel — "Why was this filled?"
 *
 * A floating panel anchored near a right-clicked field that explains
 * why Offlyn filled it with a particular value.
 * Triggered via the context menu → "Why was this filled?" option.
 */

import type { FillProvenanceRecord } from '../shared/graph/types';

const PANEL_ID = 'offlyn-fill-debug-panel';
const Z_INDEX = 2147483640;

// ── Render ────────────────────────────────────────────────────────────────────

/**
 * Show the debug panel anchored near the given element.
 * Dismisses any previously open panel first.
 */
export function showFillDebugPanel(
  anchor: HTMLElement,
  label: string,
  provenance: FillProvenanceRecord | null
): void {
  removeFillDebugPanel();

  const panel = buildPanel(label, provenance);
  document.body.appendChild(panel);
  positionPanel(panel, anchor);

  // Dismiss on outside click
  const dismissHandler = (e: MouseEvent) => {
    if (!panel.contains(e.target as Node)) {
      removeFillDebugPanel();
      document.removeEventListener('mousedown', dismissHandler, true);
    }
  };
  document.addEventListener('mousedown', dismissHandler, true);

  // Dismiss on Escape
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      removeFillDebugPanel();
      document.removeEventListener('keydown', keyHandler, true);
    }
  };
  document.addEventListener('keydown', keyHandler, true);
}

export function removeFillDebugPanel(): void {
  document.getElementById(PANEL_ID)?.remove();
}

// ── Build panel HTML ──────────────────────────────────────────────────────────

function buildPanel(label: string, provenance: FillProvenanceRecord | null): HTMLElement {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Fill debug info');

  Object.assign(panel.style, {
    position: 'fixed',
    zIndex: String(Z_INDEX),
    background: '#1e1e2e',
    color: '#cdd6f4',
    border: '1px solid #45475a',
    borderRadius: '8px',
    padding: '14px 16px',
    fontSize: '13px',
    lineHeight: '1.6',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '340px',
    minWidth: '240px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    userSelect: 'none',
    pointerEvents: 'auto',
  });

  panel.innerHTML = buildContent(label, provenance);

  // Wire dismiss button
  panel.querySelector('.offlyn-debug-dismiss')?.addEventListener('click', () => {
    removeFillDebugPanel();
  });

  return panel;
}

function buildContent(label: string, provenance: FillProvenanceRecord | null): string {
  const fieldLabel = label || 'Unknown field';
  const truncatedLabel =
    fieldLabel.length > 40 ? fieldLabel.slice(0, 40) + '…' : fieldLabel;

  const header = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <span style="font-weight:600;color:#89b4fa;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">
        Offlyn — Why was this filled?
      </span>
      <button class="offlyn-debug-dismiss" style="background:none;border:none;color:#6c7086;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;" title="Dismiss">×</button>
    </div>
    <div style="color:#585b70;font-size:11px;margin-bottom:8px;font-style:italic;">${escHtml(truncatedLabel)}</div>
  `;

  const body = renderProvenance(provenance);

  return header + body;
}

function renderProvenance(p: FillProvenanceRecord | null): string {
  if (!p || !p.source) {
    return row('Status', '<span style="color:#f38ba8">Not filled by Offlyn</span>');
  }

  const rows: string[] = [];

  if (p.value) {
    rows.push(row('Value', `<strong style="color:#a6e3a1">${escHtml(truncate(p.value, 60))}</strong>`));
  }

  switch (p.source) {
    case 'exact':
      rows.push(row('Source', '<span style="color:#89b4fa">Graph — exact question match</span>'));
      rows.push(row('Confidence', confidenceBadge(p.confidence)));
      if (p.matchedQuestionText) {
        rows.push(row('Matched', `"${escHtml(truncate(p.matchedQuestionText, 50))}"`));
      }
      break;

    case 'field':
      rows.push(row('Source', '<span style="color:#89dceb">Graph — canonical field match</span>'));
      rows.push(row('Confidence', confidenceBadge(p.confidence)));
      break;

    case 'similarity':
      rows.push(row('Source', '<span style="color:#cba6f7">Graph — similar question</span>'));
      rows.push(row('Confidence', confidenceBadge(p.confidence)));
      if (p.similarityScore !== undefined) {
        rows.push(row('Similarity', `${Math.round(p.similarityScore * 100)}%`));
      }
      if (p.matchedQuestionText) {
        rows.push(row('Matched', `"${escHtml(truncate(p.matchedQuestionText, 50))}"`));
      }
      break;

    case 'correction':
      rows.push(row('Source', '<span style="color:#f9e2af">User correction applied</span>'));
      rows.push(row('Confidence', confidenceBadge(p.confidence)));
      if (p.correctionContext?.originalValue) {
        rows.push(row('Original', `<s style="color:#6c7086">${escHtml(truncate(p.correctionContext.originalValue, 40))}</s>`));
        rows.push(row('Corrected to', `<span style="color:#a6e3a1">${escHtml(truncate(p.value, 40))}</span>`));
      }
      break;

    case 'rl':
      rows.push(row('Source', '<span style="color:#fab387">Learned from past submissions</span>'));
      rows.push(row('Confidence', confidenceBadge(p.confidence)));
      break;

    case 'profile':
      rows.push(row('Source', '<span style="color:#a6e3a1">Filled from your profile</span>'));
      break;

    case 'llm':
      rows.push(row('Source', '<span style="color:#6c7086">Generated by AI</span>'));
      rows.push(row('Note', 'No prior answer found in graph'));
      break;

    default:
      rows.push(row('Source', escHtml(String(p.source))));
      break;
  }

  if (p.resolvedAt) {
    const ago = timeAgo(p.resolvedAt);
    rows.push(row('Filled', `<span style="color:#585b70">${ago}</span>`));
  }

  return `<div style="border-top:1px solid #313244;padding-top:8px;">${rows.join('')}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function row(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;">
      <span style="color:#6c7086;white-space:nowrap;flex-shrink:0;">${label}:</span>
      <span style="text-align:right;word-break:break-word;">${value}</span>
    </div>
  `;
}

function confidenceBadge(confidence: number): string {
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.8 ? '#a6e3a1' : confidence >= 0.6 ? '#f9e2af' : '#f38ba8';
  return `<span style="color:${color};font-weight:600;">${pct}%</span>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function positionPanel(panel: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Default: below and right-aligned to anchor
  let top = rect.bottom + 6;
  let left = rect.right - 340;

  // Flip above if not enough room below
  if (top + 300 > vh) {
    top = rect.top - 300 - 6;
  }

  // Keep within viewport horizontally
  if (left < 8) left = 8;
  if (left + 340 > vw - 8) left = vw - 340 - 8;
  if (top < 8) top = 8;

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}
