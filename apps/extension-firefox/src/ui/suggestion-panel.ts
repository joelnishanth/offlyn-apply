/**
 * Suggestion panel UI — right-side slide-in panel that shows smart suggestions
 * for unfilled form fields. Hovering or selecting a card highlights the
 * corresponding field on the page so the user always knows which field they're
 * working with.
 */

import type { FieldSuggestion, SuggestionOption } from '../shared/suggestion-service';
import { setHTML } from '../shared/html';

// ── State ────────────────────────────────────────────────────────────────────

interface PanelState {
  visible: boolean;
  suggestions: FieldSuggestion[];
  selected: Map<string, SuggestionOption>; // selector → chosen option
  enabled: Map<string, boolean>;           // selector → checkbox on/off
  onApply?: (selections: Map<string, SuggestionOption>) => void;
  onDismiss?: () => void;
}

let state: PanelState = {
  visible: false,
  suggestions: [],
  selected: new Map(),
  enabled: new Map(),
};

let panelEl: HTMLElement | null = null;
let activeHighlight: string | null = null; // selector of currently highlighted field
let appliedSelectors: Set<string> = new Set(); // tracks individually-applied cards

// ── Public API ───────────────────────────────────────────────────────────────

export function showSuggestionPanel(
  suggestions: FieldSuggestion[],
  onApply: (selections: Map<string, SuggestionOption>) => void,
  onDismiss: () => void,
): void {
  if (suggestions.length === 0) {
    console.warn('[Suggestions] No suggestions to show');
    return;
  }

  appliedSelectors.clear();

  state = {
    visible: true,
    suggestions,
    selected: new Map(),
    enabled: new Map(),
    onApply,
    onDismiss,
  };

  // Pre-select primary suggestion and enable all by default
  for (const s of suggestions) {
    const primary = s.suggestions.find(o => o.isPrimary);
    if (primary) state.selected.set(s.selector, primary);
    state.enabled.set(s.selector, true);
  }

  injectStyles();
  render();
}

export function hideSuggestionPanel(): void {
  clearFieldHighlight();
  panelEl?.remove();
  panelEl = null;
  state.visible = false;
  state.suggestions = [];
  state.selected.clear();
  state.enabled.clear();
  appliedSelectors.clear();
}

export function isSuggestionPanelVisible(): boolean {
  return state.visible;
}

// ── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  panelEl?.remove();

  const panel = document.createElement('div');
  panel.id = 'offlyn-suggestion-panel';

  // Build HTML
  const enabledCount = [...state.enabled.values()].filter(Boolean).length;

  setHTML(panel, `
    <div class="osp-header">
      <div class="osp-header-left">
        <span class="osp-logo">O</span>
        <div>
          <div class="osp-title">Smart Suggestions</div>
          <div class="osp-subtitle">${state.suggestions.length} field${state.suggestions.length !== 1 ? 's' : ''} detected</div>
        </div>
      </div>
      <button class="osp-close" title="Close">&times;</button>
    </div>

    <div class="osp-body">
      ${state.suggestions.map((s, i) => buildCard(s, i)).join('')}
    </div>

    <div class="osp-footer">
      <button class="osp-btn osp-btn-cancel">Cancel</button>
      <button class="osp-btn osp-btn-apply">Apply ${enabledCount} Suggestion${enabledCount !== 1 ? 's' : ''}</button>
    </div>
  `);

  document.body.appendChild(panel);
  panelEl = panel;

  // ── Attach listeners ───────────────────────────────────────────────────

  // Close / Cancel
  panel.querySelector('.osp-close')?.addEventListener('click', dismiss);
  panel.querySelector('.osp-btn-cancel')?.addEventListener('click', dismiss);

  // Apply All (only enabled + not-yet-applied)
  panel.querySelector('.osp-btn-apply')?.addEventListener('click', async (e) => {
    (e as MouseEvent).stopPropagation();
    const toApply = new Map<string, SuggestionOption>();
    for (const [sel, opt] of state.selected.entries()) {
      if (state.enabled.get(sel) && !appliedSelectors.has(sel)) toApply.set(sel, opt);
    }
    if (toApply.size === 0) return;

    try { await state.onApply?.(toApply); } catch (err) { console.error('[Suggestions]', err); }
    hideSuggestionPanel();
  });

  // ESC key
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { dismiss(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);

  // Per-card listeners
  state.suggestions.forEach((s, i) => {
    const card = panel.querySelector(`[data-osp-card="${i}"]`) as HTMLElement | null;
    if (!card) return;

    // Checkbox toggle
    const cb = card.querySelector('.osp-toggle') as HTMLInputElement | null;
    cb?.addEventListener('change', () => {
      state.enabled.set(s.selector, cb.checked);
      card.classList.toggle('osp-card--disabled', !cb.checked);
      updateApplyCount();
    });

    // Hover highlight
    card.addEventListener('mouseenter', () => highlightField(s.selector));
    card.addEventListener('mouseleave', () => clearFieldHighlight());

    // Click card → scroll field into view + persistent highlight
    card.querySelector('.osp-card-label')?.addEventListener('click', () => {
      scrollToField(s.selector);
    });

    // Per-card "Apply" button
    const singleApplyBtn = card.querySelector('.osp-btn-single') as HTMLButtonElement | null;
    singleApplyBtn?.addEventListener('click', async (ev) => {
      (ev as MouseEvent).stopPropagation();
      const opt = state.selected.get(s.selector);
      if (!opt) return;

      // Visual feedback: show loading
      singleApplyBtn.textContent = '…';
      singleApplyBtn.disabled = true;

      try {
        const single = new Map<string, SuggestionOption>();
        single.set(s.selector, opt);
        await state.onApply?.(single);
        // Mark as applied
        appliedSelectors.add(s.selector);
        state.enabled.set(s.selector, false);
        // Update card visually
        card.classList.remove('osp-card--disabled');
        card.classList.add('osp-card--applied');
        singleApplyBtn.replaceWith(createAppliedTag());
        (card.querySelector('.osp-toggle') as HTMLInputElement | null)!.disabled = true;
        (card.querySelector('.osp-toggle') as HTMLInputElement | null)!.checked = false;
        updateApplyCount();
        // Flash the field green
        highlightFieldSuccess(s.selector);
      } catch (err) {
        console.error('[Suggestions] Single apply error:', err);
        singleApplyBtn.textContent = 'Retry';
        singleApplyBtn.disabled = false;
      }
    });

    // Option buttons
    s.suggestions.slice(0, 3).forEach((opt, oi) => {
      const btn = card.querySelector(`[data-osp-opt="${oi}"]`) as HTMLElement | null;
      btn?.addEventListener('click', (e) => {
        (e as MouseEvent).stopPropagation();
        if (appliedSelectors.has(s.selector)) return; // already applied, ignore
        state.selected.set(s.selector, opt);
        // Update visual selection on this card only (no full re-render)
        card.querySelectorAll('.osp-option').forEach(el => el.classList.remove('osp-option--selected'));
        btn.classList.add('osp-option--selected');
        (btn.querySelector('input[type=radio]') as HTMLInputElement | null)!.checked = true;
        // Flash the field to confirm
        highlightField(s.selector);
      });
    });
  });

  // Slide-in animation
  requestAnimationFrame(() => panel.classList.add('osp--open'));
}

// ── Card HTML ────────────────────────────────────────────────────────────────

function buildCard(s: FieldSuggestion, index: number): string {
  const isEnabled = state.enabled.get(s.selector) !== false;
  const isApplied = appliedSelectors.has(s.selector);
  const label = s.field.label || s.field.name || `Field ${index + 1}`;
  const disabledClass = isApplied ? 'osp-card--applied' : (!isEnabled ? 'osp-card--disabled' : '');

  return `
    <div class="osp-card ${disabledClass}" data-osp-card="${index}">
      <div class="osp-card-head">
        <input type="checkbox" class="osp-toggle" ${isEnabled ? 'checked' : ''} ${isApplied ? 'disabled' : ''} />
        <span class="osp-card-label" title="Click to scroll to field">${escHtml(label)}</span>
        <span class="osp-badge" style="background:${confidenceColor(s.confidence)}">${Math.round(s.confidence * 100)}%</span>
        ${isApplied
          ? '<span class="osp-applied-tag">&#10003; Applied</span>'
          : '<button class="osp-btn-single" title="Apply this suggestion only">Apply</button>'}
      </div>
      <div class="osp-options">
        ${s.suggestions.slice(0, 3).map((opt, oi) => buildOption(s.selector, opt, oi)).join('')}
      </div>
    </div>
  `;
}

function buildOption(selector: string, opt: SuggestionOption, index: number): string {
  const isSelected = state.selected.get(selector)?.id === opt.id;
  return `
    <label class="osp-option ${isSelected ? 'osp-option--selected' : ''}" data-osp-opt="${index}">
      <input type="radio" name="osp-${CSS.escape(selector)}" ${isSelected ? 'checked' : ''} />
      <div class="osp-option-body">
        <div class="osp-option-value">${escHtml(truncate(opt.value, 120))}</div>
        <div class="osp-option-meta">
          <span class="osp-source osp-source--${opt.source}">${sourceLabel(opt.source)}</span>
          <span class="osp-reason">${escHtml(opt.reasoning)}</span>
        </div>
      </div>
    </label>
  `;
}

// ── Field highlighting ───────────────────────────────────────────────────────

function highlightField(selector: string): void {
  clearFieldHighlight();
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  activeHighlight = selector;

  el.style.transition = 'outline .2s, box-shadow .2s';
  el.style.outline = '3px solid #0a0a0a';
  el.style.boxShadow = '0 0 0 6px rgba(30,42,58,.25)';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Gentle pulse
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.015)' }, { transform: 'scale(1)' }],
    { duration: 400, easing: 'ease-in-out' },
  );
}

function clearFieldHighlight(): void {
  if (!activeHighlight) return;
  const el = document.querySelector(activeHighlight) as HTMLElement | null;
  if (el) {
    el.style.outline = '';
    el.style.boxShadow = '';
    el.style.transition = '';
  }
  activeHighlight = null;
}

function scrollToField(selector: string): void {
  highlightField(selector);
  // Keep the highlight for 3 seconds
  const sel = selector;
  setTimeout(() => { if (activeHighlight === sel) clearFieldHighlight(); }, 3000);
}

function highlightFieldSuccess(selector: string): void {
  clearFieldHighlight();
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  activeHighlight = selector;

  el.style.transition = 'outline .2s, box-shadow .2s';
  el.style.outline = '3px solid #1a7f5a';
  el.style.boxShadow = '0 0 0 6px rgba(16,185,129,.25)';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Auto-clear after 2 seconds
  const sel = selector;
  setTimeout(() => { if (activeHighlight === sel) clearFieldHighlight(); }, 2000);
}

function createAppliedTag(): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'osp-applied-tag';
  tag.textContent = '✓ Applied';
  return tag;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dismiss(): void {
  hideSuggestionPanel();
  state.onDismiss?.();
}

function updateApplyCount(): void {
  let count = 0;
  for (const [sel, on] of state.enabled.entries()) {
    if (on && !appliedSelectors.has(sel)) count++;
  }
  const btn = panelEl?.querySelector('.osp-btn-apply');
  if (btn) btn.textContent = `Apply ${count} Suggestion${count !== 1 ? 's' : ''}`;
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#1a7f5a';
  if (c >= 0.6) return '#f59e0b';
  return '#94a3b8';
}

function sourceLabel(s: string): string {
  const map: Record<string, string> = { profile: 'Profile', contextual: 'Saved', ai: 'AI', learned: 'Learned' };
  return map[s] || s;
}

function truncate(t: string, n: number): string {
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

function escHtml(t: string): string {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectStyles(): void {
  if (document.getElementById('osp-styles')) return;
  const s = document.createElement('style');
  s.id = 'osp-styles';
  s.textContent = `
/* ── Panel container ── */
#offlyn-suggestion-panel {
  position: fixed;
  top: 0; right: 0;
  width: 380px;
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
#offlyn-suggestion-panel.osp--open {
  transform: translateX(0);
}

/* ── Header ── */
.osp-header {
  padding: 16px 20px;
  background: linear-gradient(135deg, #0a0a0a 0%, #1a7f5a 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.osp-header-left { display: flex; align-items: center; gap: 12px; }
.osp-logo {
  width: 32px; height: 32px;
  background: rgba(255,255,255,.2);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 16px; flex-shrink: 0;
}
.osp-title { font-weight: 700; font-size: 16px; line-height: 1.2; }
.osp-subtitle { font-size: 12px; opacity: .85; margin-top: 2px; }
.osp-close {
  background: rgba(255,255,255,.15);
  border: none; color: #fff; width: 30px; height: 30px;
  border-radius: 6px; cursor: pointer; font-size: 20px;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s;
}
.osp-close:hover { background: rgba(255,255,255,.3); }

/* ── Scrollable body ── */
.osp-body {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  scrollbar-width: thin;
}

/* ── Card ── */
.osp-card {
  border: 1px solid #e2e0da;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
  background: #fff;
  transition: border-color .2s, opacity .2s;
}
.osp-card:hover { border-color: #0a0a0a; }
.osp-card--disabled { opacity: .45; }
.osp-card--disabled:hover { border-color: #e2e0da; }
.osp-card--applied {
  border-color: #1a7f5a;
  background: #e6f4ee;
  opacity: .7;
}
.osp-card--applied:hover { border-color: #1a7f5a; }
.osp-card--applied .osp-options { pointer-events: none; opacity: .5; }

.osp-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.osp-toggle {
  width: 16px; height: 16px; cursor: pointer;
  accent-color: #0a0a0a; flex-shrink: 0;
}
.osp-card-label {
  font-weight: 600; font-size: 13px; color: #111827;
  flex: 1; cursor: pointer;
  text-decoration: underline;
  text-decoration-color: transparent;
  transition: text-decoration-color .15s;
}
.osp-card-label:hover {
  text-decoration-color: #0a0a0a;
  color: #0a0a0a;
}
.osp-badge {
  color: #fff; font-size: 10px; font-weight: 700;
  padding: 2px 7px; border-radius: 4px;
  flex-shrink: 0;
}
.osp-btn-single {
  background: #eef2ff; color: #0a0a0a;
  border: 1px solid #c7d2fe; border-radius: 6px;
  padding: 3px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; transition: all .15s;
  flex-shrink: 0; font-family: inherit;
}
.osp-btn-single:hover {
  background: #0a0a0a; color: #fff;
  border-color: #0a0a0a;
}
.osp-btn-single:disabled {
  opacity: .5; cursor: default;
}
.osp-applied-tag {
  color: #1a7f5a; font-size: 11px; font-weight: 700;
  flex-shrink: 0; white-space: nowrap;
}

/* ── Options ── */
.osp-options { display: flex; flex-direction: column; gap: 6px; }
.osp-option {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 8px 10px; border: 2px solid #e2e0da;
  border-radius: 8px; cursor: pointer;
  transition: border-color .15s, background .15s;
}
.osp-option:hover { border-color: rgba(124, 179, 66, 0.4); background: #f0f7e8; }
.osp-option--selected { border-color: #0a0a0a; background: #f0f7e8; }
.osp-option input[type=radio] { margin-top: 3px; accent-color: #0a0a0a; flex-shrink: 0; }

.osp-option-body { flex: 1; min-width: 0; }
.osp-option-value {
  font-size: 13px; color: #111827;
  word-break: break-word; line-height: 1.4;
}
.osp-option-meta {
  display: flex; align-items: center; gap: 6px;
  margin-top: 4px; font-size: 11px; color: #6b7280;
}
.osp-source {
  padding: 1px 5px; border-radius: 3px;
  font-size: 10px; font-weight: 600;
  text-transform: uppercase; color: #fff;
}
.osp-source--profile { background: #3b82f6; }
.osp-source--contextual { background: #0a0a0a; }
.osp-source--ai { background: #1a7f5a; }
.osp-source--learned { background: #1a7f5a; }
.osp-reason {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ── Footer ── */
.osp-footer {
  padding: 12px 16px;
  border-top: 1px solid #e2e0da;
  background: #f9fafb;
  display: flex; gap: 10px; justify-content: flex-end;
  flex-shrink: 0;
}
.osp-btn {
  padding: 9px 18px; border-radius: 8px;
  font-size: 13px; font-weight: 600;
  cursor: pointer; border: none;
  transition: all .15s; font-family: inherit;
}
.osp-btn-cancel {
  background: #fff; color: #374151;
  border: 1px solid #d1d5db;
}
.osp-btn-cancel:hover { background: #f3f4f6; }
.osp-btn-apply {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a7f5a 100%);
  color: #fff;
}
.osp-btn-apply:hover {
  box-shadow: 0 4px 14px rgba(30, 42, 58, 0.3);
  transform: translateY(-1px);
}
.osp-btn-apply:active { transform: translateY(0); }
  `;
  document.head.appendChild(s);
}
