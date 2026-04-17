/**
 * Content script for web.whatsapp.com — detects job/ATS links in messages
 * and injects branded "Apply" buttons next to them.
 */

import { isJobURL } from './shared/ats-domains';
import browser from './shared/browser-compat';

const PROCESSED_ATTR = 'data-offlyn-processed';
const BUTTON_CLASS = 'offlyn-wa-apply';

const ROBOT_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="4" r="2"/><rect x="10" y="5" width="2" height="3" rx="1"/><rect x="3" y="8" width="16" height="12" rx="6"/><circle cx="8.5" cy="14" r="2.5" fill="#25D366"/><circle cx="15" cy="14" r="2.5" fill="#25D366"/></svg>`;

function createApplyButton(url: string): HTMLElement {
  const host = document.createElement('span');
  host.className = BUTTON_CLASS;
  host.style.cssText = 'display:inline-flex;margin-left:6px;vertical-align:middle;';

  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 12px;
      border: none;
      background: #25D366;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      line-height: 1.4;
      white-space: nowrap;
    }
    button:hover { background: #1fb855; transform: scale(1.04); }
    button:active { transform: scale(0.97); }
    svg { flex-shrink: 0; }
  `;

  const btn = document.createElement('button');
  btn.innerHTML = ROBOT_SVG + ' Apply';
  btn.title = 'Open in Offlyn Apply and auto-fill';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    browser.runtime.sendMessage({ kind: 'OPEN_AND_APPLY', url });
  });

  shadow.appendChild(style);
  shadow.appendChild(btn);
  return host;
}

function scanForJobLinks(): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('a[href]');

  for (const link of links) {
    if (link.hasAttribute(PROCESSED_ATTR)) continue;
    link.setAttribute(PROCESSED_ATTR, '1');

    const href = link.href;
    if (!href || href.startsWith('javascript:')) continue;

    let isJob = false;
    try { isJob = isJobURL(href); } catch { /* ignore malformed URLs */ }
    if (isJob) {
      const existing = link.parentElement?.querySelector(`.${BUTTON_CLASS}`);
      if (existing) continue;

      const btn = createApplyButton(href);
      if (link.parentElement) {
        link.parentElement.insertBefore(btn, link.nextSibling);
      }
    }
  }
}

scanForJobLinks();

const observer = new MutationObserver(() => {
  scanForJobLinks();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

console.log('[Offlyn] WhatsApp Web content script loaded — scanning for job links');
