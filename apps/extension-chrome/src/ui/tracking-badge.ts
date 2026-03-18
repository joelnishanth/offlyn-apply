/**
 * Tracking badge — subtle translucent pill shown on detected job pages.
 * Positioned bottom-left so it doesn't conflict with other extension UI.
 * Stays visible for the session; can be dismissed by the user.
 */

const BADGE_ID = 'offlyn-tracking-badge';
const STYLE_ID = 'offlyn-tracking-badge-styles';

/**
 * Show (or update) the tracking badge with the detected job title / company.
 * Safe to call multiple times — it updates in place if already visible.
 */
export function showTrackingBadge(jobTitle: string | null, company: string | null): void {
  ensureBadgeStyles();

  const existing = document.getElementById(BADGE_ID);
  if (existing) {
    updateBadgeText(existing, jobTitle, company);
    return;
  }

  const badge = document.createElement('div');
  badge.id = BADGE_ID;
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');

  const label = buildLabel(jobTitle, company);

  const icon = document.createElement('span');
  icon.className = 'offlyn-tb-icon';
  icon.setAttribute('aria-hidden', 'true');
  const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  iconSvg.setAttribute('width', '12'); iconSvg.setAttribute('height', '12');
  iconSvg.setAttribute('viewBox', '0 0 12 12'); iconSvg.setAttribute('fill', 'none');
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('d', 'M2 6.5L4.5 9L10 3.5');
  iconPath.setAttribute('stroke', 'currentColor'); iconPath.setAttribute('stroke-width', '1.6');
  iconPath.setAttribute('stroke-linecap', 'round'); iconPath.setAttribute('stroke-linejoin', 'round');
  iconSvg.appendChild(iconPath);
  icon.appendChild(iconSvg);

  const text = document.createElement('span');
  text.className = 'offlyn-tb-text';
  text.textContent = label;

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'offlyn-tb-dismiss';
  dismissBtn.title = 'Dismiss';
  dismissBtn.setAttribute('aria-label', 'Dismiss tracking badge');
  const dismissSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dismissSvg.setAttribute('width', '8'); dismissSvg.setAttribute('height', '8');
  dismissSvg.setAttribute('viewBox', '0 0 8 8'); dismissSvg.setAttribute('fill', 'none');
  const dismissPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dismissPath.setAttribute('d', 'M1.5 1.5L6.5 6.5M6.5 1.5L1.5 6.5');
  dismissPath.setAttribute('stroke', 'currentColor'); dismissPath.setAttribute('stroke-width', '1.4');
  dismissPath.setAttribute('stroke-linecap', 'round');
  dismissSvg.appendChild(dismissPath);
  dismissBtn.appendChild(dismissSvg);

  badge.appendChild(icon);
  badge.appendChild(text);
  badge.appendChild(dismissBtn);

  dismissBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTrackingBadge();
  });

  document.body.appendChild(badge);

  // Trigger entrance animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      badge.classList.add('offlyn-tb-visible');
    });
  });
}

/**
 * Remove the tracking badge (e.g. on page navigation away from a job page).
 */
export function hideTrackingBadge(): void {
  const badge = document.getElementById(BADGE_ID);
  if (!badge) return;

  badge.classList.remove('offlyn-tb-visible');
  badge.classList.add('offlyn-tb-hidden');
  setTimeout(() => badge.remove(), 300);
}

// ─── Internals ────────────────────────────────────────────────────────────────

function buildLabel(jobTitle: string | null, company: string | null): string {
  if (jobTitle && company) return `Offlyn · ${truncate(jobTitle, 30)} @ ${truncate(company, 22)}`;
  if (jobTitle) return `Offlyn · ${truncate(jobTitle, 40)}`;
  if (company) return `Offlyn · ${truncate(company, 40)}`;
  return 'Offlyn · Application page detected';
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function updateBadgeText(badge: HTMLElement, jobTitle: string | null, company: string | null): void {
  const textEl = badge.querySelector('.offlyn-tb-text');
  if (textEl) textEl.textContent = buildLabel(jobTitle, company);
}


function ensureBadgeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BADGE_ID} {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 2147483646;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 6px 10px 6px 8px;
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 20px;
      color: rgba(255, 255, 255, 0.90);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0.01em;
      pointer-events: auto;
      user-select: none;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
    }

    #${BADGE_ID}.offlyn-tb-visible {
      opacity: 1;
      transform: translateY(0);
    }

    #${BADGE_ID}.offlyn-tb-hidden {
      opacity: 0;
      transform: translateY(8px);
    }

    .offlyn-tb-icon {
      display: flex;
      align-items: center;
      color: #4ade80;
      flex-shrink: 0;
    }

    .offlyn-tb-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 320px;
    }

    .offlyn-tb-dismiss {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 14px;
      height: 14px;
      padding: 0;
      margin-left: 2px;
      background: none;
      border: none;
      border-radius: 50%;
      color: rgba(255, 255, 255, 0.45);
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
    }

    .offlyn-tb-dismiss:hover {
      color: rgba(255, 255, 255, 0.90);
      background: rgba(255, 255, 255, 0.12);
    }
  `;

  document.head.appendChild(style);
}
