/**
 * Progress indicator — delegates to the widget's minimized ring when it
 * is mounted; falls back to a standalone slide-in card otherwise.
 * Brand: navy #0a0a0a + green #1a7f5a
 */

import { setHTML } from '../shared/html';
import {
  isWidgetMounted,
  enterFillMode,
  updateFillProgress,
  exitFillMode,
} from './compatibility-widget';

let progressElement: HTMLElement | null = null;
let usingWidgetRing = false;

/**
 * Show progress indicator
 */
export function showProgress(total: number): void {
  hideProgress(0);

  if (isWidgetMounted()) {
    usingWidgetRing = true;
    enterFillMode(total);
    return;
  }

  usingWidgetRing = false;
  ensureProgressStyles();

  const container = document.createElement('div');
  container.id = 'offlyn-progress-indicator';
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 2147483647;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 1px 4px rgba(30,41,59,0.08);
    padding: 14px 16px;
    min-width: 300px;
    max-width: 380px;
    border-left: 4px solid #0a0a0a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: offlyn-progress-in 0.25s cubic-bezier(0.16,1,0.3,1) forwards;
  `;

  setHTML(container, `
    <div style="display:flex;align-items:flex-start;gap:10px;">
      <div class="offlyn-spinner" style="
        flex-shrink:0;
        margin-top:2px;
        width:18px;height:18px;
        border:2.5px solid #e2e8f0;
        border-top-color:#1a7f5a;
        border-radius:50%;
        animation:offlyn-spin 0.7s linear infinite;
      "></div>
      <div style="flex:1;min-width:0;">
        <div class="offlyn-progress-title" style="
          font-weight:600;font-size:13px;color:#0a0a0a;line-height:1.3;margin-bottom:6px;
        ">Auto-filling form…</div>
        <div style="
          background:#f1f5f9;height:5px;border-radius:3px;overflow:hidden;
        ">
          <div id="offlyn-progress-bar" style="
            background:linear-gradient(90deg,#1a7f5a,#22c55e);
            height:100%;width:0%;
            border-radius:3px;
            transition:width 0.25s ease;
          "></div>
        </div>
        <div id="offlyn-progress-text" style="
          font-size:11px;color:#64748b;margin-top:5px;
        ">0 / ${total} fields</div>
      </div>
    </div>
  `);

  document.body.appendChild(container);
  progressElement = container;
}

/**
 * Update fill progress
 */
export function updateProgress(current: number, total: number, fieldName?: string): void {
  if (usingWidgetRing) {
    updateFillProgress(current, total, fieldName);
    return;
  }

  if (!progressElement) return;

  const bar = progressElement.querySelector('#offlyn-progress-bar') as HTMLElement;
  const text = progressElement.querySelector('#offlyn-progress-text') as HTMLElement;

  if (bar) bar.style.width = `${Math.round((current / total) * 100)}%`;
  if (text) text.textContent = fieldName
    ? `${current} / ${total} fields — ${fieldName}`
    : `${current} / ${total} fields`;
}

/**
 * Hide progress indicator (with optional delay)
 */
export function hideProgress(delay: number = 1000): void {
  if (usingWidgetRing) {
    usingWidgetRing = false;
    return;
  }

  if (!progressElement) return;
  const el = progressElement;
  setTimeout(() => {
    el.style.animation = 'offlyn-progress-out 0.2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, delay);
  progressElement = null;
}

/**
 * Show completion state then auto-hide
 */
export function showProgressComplete(success: boolean, filled: number, total: number): void {
  if (usingWidgetRing) {
    exitFillMode(success, filled, total);
    usingWidgetRing = false;
    return;
  }

  if (!progressElement) return;

  const spinner = progressElement.querySelector('.offlyn-spinner') as HTMLElement;
  const title = progressElement.querySelector('.offlyn-progress-title') as HTMLElement;
  const bar = progressElement.querySelector('#offlyn-progress-bar') as HTMLElement;

  if (spinner) {
    spinner.style.animation = 'none';
    spinner.style.border = 'none';
    setHTML(spinner, success
      ? `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#1a7f5a"/><path d="M5.5 9l2.5 2.5 4.5-4.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="9" fill="#f59e0b"/><path d="M9 6v3.5M9 11.5h.01" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/></svg>`);
  }

  if (title) {
    title.textContent = success
      ? `Filled ${filled} / ${total} fields`
      : `Partially filled: ${filled} / ${total}`;
    title.style.color = success ? '#1a7f5a' : '#f59e0b';
  }

  if (bar) {
    bar.style.width = '100%';
    bar.style.background = success
      ? 'linear-gradient(90deg,#1a7f5a,#22c55e)'
      : 'linear-gradient(90deg,#f59e0b,#fbbf24)';
  }

  progressElement = progressElement;
  hideProgress(2000);
}

/**
 * Inject keyframes once
 */
function ensureProgressStyles(): void {
  if (document.getElementById('offlyn-progress-styles')) return;
  const style = document.createElement('style');
  style.id = 'offlyn-progress-styles';
  style.textContent = `
    @keyframes offlyn-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes offlyn-progress-in {
      from { opacity:0; transform:translateX(24px); }
      to   { opacity:1; transform:translateX(0); }
    }
    @keyframes offlyn-progress-out {
      from { opacity:1; transform:translateX(0); }
      to   { opacity:0; transform:translateX(24px); }
    }
  `;
  document.head.appendChild(style);
}
