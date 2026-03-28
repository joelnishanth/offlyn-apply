/**
 * LinkedIn auto-apply overlay UI. Rendered inside a Shadow DOM host
 * to avoid CSS conflicts with LinkedIn's page styles.
 */

import type { AutoApplyResult, AutoApplyStatus } from '../linkedin/linkedin-autoapply';

const OVERLAY_ID = 'offlyn-linkedin-overlay';

let shadowRoot: ShadowRoot | null = null;

function getOrCreateHost(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'position:fixed;top:80px;right:20px;z-index:2147483647;';
    document.body.appendChild(host);
  }

  shadowRoot = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .oln-panel {
      width: 300px;
      background: #1e293b;
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #f1f5f9;
      overflow: hidden;
      transition: opacity 0.2s;
    }

    .oln-header {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .oln-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 14px;
    }

    .oln-brand-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #4ade80;
    }

    .oln-close {
      background: none;
      border: none;
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px;
    }
    .oln-close:hover { color: #fff; }

    .oln-body {
      padding: 16px;
    }

    .oln-profile-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
      font-size: 12px;
      color: #94a3b8;
    }

    .oln-profile-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .oln-profile-name {
      font-weight: 600;
      color: #f1f5f9;
    }

    .oln-slider-row {
      margin-bottom: 14px;
    }

    .oln-slider-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 6px;
    }

    .oln-slider-value {
      font-weight: 700;
      color: #f1f5f9;
    }

    .oln-slider {
      width: 100%;
      -webkit-appearance: none;
      height: 6px;
      border-radius: 3px;
      background: #334155;
      outline: none;
    }

    .oln-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px; height: 18px;
      border-radius: 50%;
      background: #7c3aed;
      cursor: pointer;
      border: 2px solid #fff;
    }

    .oln-controls {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }

    .oln-btn {
      flex: 1;
      padding: 10px 12px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }

    .oln-btn-start {
      background: #16a34a;
      color: #fff;
    }
    .oln-btn-start:hover { background: #15803d; }
    .oln-btn-start:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .oln-btn-pause {
      background: #d97706;
      color: #fff;
    }
    .oln-btn-pause:hover { background: #b45309; }

    .oln-btn-stop {
      background: #dc2626;
      color: #fff;
    }
    .oln-btn-stop:hover { background: #b91c1c; }

    .oln-stats {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 8px;
    }

    .oln-stat {
      text-align: center;
      background: #0f172a;
      border-radius: 8px;
      padding: 10px 8px;
    }

    .oln-stat-num {
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
    }

    .oln-stat-label {
      font-size: 10px;
      color: #64748b;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .oln-stat-num.applied { color: #4ade80; }
    .oln-stat-num.skipped { color: #fbbf24; }
    .oln-stat-num.failed { color: #f87171; }

    .oln-status {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 12px;
    }

    .oln-status-dot {
      display: inline-block;
      width: 6px; height: 6px;
      border-radius: 50%;
      margin-right: 4px;
    }
    .oln-status-dot.idle { background: #64748b; }
    .oln-status-dot.running { background: #4ade80; animation: pulse 1.4s infinite; }
    .oln-status-dot.paused { background: #fbbf24; }
    .oln-status-dot.done { background: #7c3aed; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    /* Minimized state */
    .oln-panel.minimized .oln-body { display: none; }
    .oln-panel.minimized { width: auto; }
    .oln-panel.minimized .oln-header { border-radius: 14px; }
  `;
  shadowRoot.appendChild(style);
  return shadowRoot;
}

export function showLinkedInOverlay(
  profileName: string,
  profileColor: string,
  onStart: (maxApply: number) => void,
  onStop: () => void,
): void {
  const root = getOrCreateHost();

  const panel = document.createElement('div');
  panel.className = 'oln-panel';
  panel.innerHTML = `
    <div class="oln-header">
      <div class="oln-brand">
        <div class="oln-brand-dot"></div>
        Offlyn Auto-Apply
      </div>
      <button class="oln-close" title="Close">&times;</button>
    </div>
    <div class="oln-body">
      <div class="oln-profile-row">
        <div class="oln-profile-dot" style="background:${profileColor}"></div>
        <span class="oln-profile-name">${profileName}</span>
      </div>
      <div class="oln-slider-row">
        <div class="oln-slider-label">
          <span>Max applications</span>
          <span class="oln-slider-value" id="oln-slider-val">25</span>
        </div>
        <input type="range" class="oln-slider" id="oln-slider" min="1" max="50" value="25">
      </div>
      <div class="oln-controls" id="oln-controls">
        <button class="oln-btn oln-btn-start" id="oln-start">Start</button>
      </div>
      <div class="oln-stats">
        <div class="oln-stat"><div class="oln-stat-num applied" id="oln-applied">0</div><div class="oln-stat-label">Applied</div></div>
        <div class="oln-stat"><div class="oln-stat-num skipped" id="oln-skipped">0</div><div class="oln-stat-label">Skipped</div></div>
        <div class="oln-stat"><div class="oln-stat-num failed" id="oln-failed">0</div><div class="oln-stat-label">Failed</div></div>
      </div>
      <div class="oln-status" id="oln-status">
        <span class="oln-status-dot idle"></span> Ready
      </div>
    </div>
  `;

  // Clear and append
  while (root.childNodes.length > 1) root.removeChild(root.lastChild!);
  root.appendChild(panel);

  // Slider
  const slider = root.getElementById('oln-slider') as HTMLInputElement;
  const sliderVal = root.getElementById('oln-slider-val')!;
  slider?.addEventListener('input', () => {
    sliderVal.textContent = slider.value;
  });

  // Close
  root.querySelector('.oln-close')?.addEventListener('click', () => {
    hideLinkedInOverlay();
  });

  // Start
  root.getElementById('oln-start')?.addEventListener('click', () => {
    const max = parseInt(slider?.value ?? '25', 10);
    onStart(max);
    updateOverlayControls('running', onStop);
  });
}

export function updateOverlayControls(
  status: AutoApplyStatus,
  onStop?: () => void,
): void {
  if (!shadowRoot) return;
  const controls = shadowRoot.getElementById('oln-controls');
  if (!controls) return;

  if (status === 'running') {
    controls.innerHTML = `<button class="oln-btn oln-btn-stop" id="oln-stop">Stop</button>`;
    shadowRoot.getElementById('oln-stop')?.addEventListener('click', () => {
      onStop?.();
      updateOverlayControls('done');
    });
  } else if (status === 'done') {
    controls.innerHTML = `<button class="oln-btn oln-btn-start" id="oln-start" disabled>Done</button>`;
  } else {
    controls.innerHTML = `<button class="oln-btn oln-btn-start" id="oln-start">Start</button>`;
  }

  // Update status indicator
  const statusEl = shadowRoot.getElementById('oln-status');
  if (statusEl) {
    const labels: Record<AutoApplyStatus, string> = {
      idle: 'Ready',
      running: 'Applying...',
      paused: 'Paused',
      done: 'Finished',
    };
    statusEl.innerHTML = `<span class="oln-status-dot ${status}"></span> ${labels[status]}`;
  }
}

export function updateOverlayStats(result: Partial<AutoApplyResult>): void {
  if (!shadowRoot) return;
  const applied = shadowRoot.getElementById('oln-applied');
  const skipped = shadowRoot.getElementById('oln-skipped');
  const failed = shadowRoot.getElementById('oln-failed');
  if (applied) applied.textContent = String(result.applied ?? 0);
  if (skipped) skipped.textContent = String(result.skipped ?? 0);
  if (failed) failed.textContent = String(result.failed ?? 0);
}

export function hideLinkedInOverlay(): void {
  const host = document.getElementById(OVERLAY_ID);
  if (host) host.remove();
  shadowRoot = null;
}

export function isOverlayVisible(): boolean {
  return !!document.getElementById(OVERLAY_ID);
}
