/**
 * Gentle Autofill Notification - shown when fields are detected on a page
 * Brand: navy #1e293b + green #16a34a
 */

import { setHTML } from '../shared/html';

let notification: HTMLElement | null = null;
let autoHideTimeout: number | null = null;

export function showAutofillNotification(fieldCount: number): void {
  hideAutofillNotification();
  ensureStyles();

  notification = document.createElement('div');
  notification.id = 'offlyn-autofill-notification';
  setHTML(notification, `
    <div class="offlyn-notif-content">
      <div class="offlyn-notif-icon">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="9" fill="#16a34a"/>
          <path d="M5.5 9l2.5 2.5 4.5-4.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="offlyn-notif-text">
        <div class="offlyn-notif-title">Autofill Ready</div>
        <div class="offlyn-notif-subtitle">${fieldCount} field${fieldCount !== 1 ? 's' : ''} detected on this page</div>
      </div>
      <button class="offlyn-notif-close" title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
      </button>
    </div>
  `);

  document.body.appendChild(notification);

  const closeBtn = notification.querySelector('.offlyn-notif-close');
  if (closeBtn) closeBtn.addEventListener('click', hideAutofillNotification);

  autoHideTimeout = window.setTimeout(hideAutofillNotification, 5000);

  requestAnimationFrame(() => notification?.classList.add('show'));
}

export function hideAutofillNotification(): void {
  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
  }
  if (notification) {
    notification.classList.remove('show');
    setTimeout(() => { notification?.remove(); notification = null; }, 250);
  }
}

let shoppingNotification: HTMLElement | null = null;
let shoppingAutoHideTimeout: number | null = null;

/** Friendly amber notification shown on checkout/shopping pages where Offlyn helps with name+address only */
export function showShoppingHelperNotification(): void {
  if (shoppingNotification) return;
  ensureStyles();
  ensureShoppingStyles();

  shoppingNotification = document.createElement('div');
  shoppingNotification.id = 'offlyn-shopping-notification';
  setHTML(shoppingNotification, `
    <div class="offlyn-shop-notif-content">
      <div class="offlyn-shop-notif-icon">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="9" fill="#d97706"/>
          <path d="M9 5v4l2.5 2.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="offlyn-notif-text">
        <div class="offlyn-notif-title">Offlyn Apply can help with this too</div>
        <div class="offlyn-notif-subtitle">Filling your name and address</div>
      </div>
      <button class="offlyn-notif-close offlyn-shop-close" title="Dismiss">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
      </button>
    </div>
  `);

  document.body.appendChild(shoppingNotification);

  const closeBtn = shoppingNotification.querySelector('.offlyn-shop-close');
  if (closeBtn) closeBtn.addEventListener('click', hideShoppingHelperNotification);

  shoppingAutoHideTimeout = window.setTimeout(hideShoppingHelperNotification, 4000);

  requestAnimationFrame(() => shoppingNotification?.classList.add('show'));
}

export function hideShoppingHelperNotification(): void {
  if (shoppingAutoHideTimeout) {
    clearTimeout(shoppingAutoHideTimeout);
    shoppingAutoHideTimeout = null;
  }
  if (shoppingNotification) {
    shoppingNotification.classList.remove('show');
    setTimeout(() => { shoppingNotification?.remove(); shoppingNotification = null; }, 250);
  }
}

function ensureShoppingStyles(): void {
  if (document.getElementById('offlyn-shopping-notification-styles')) return;
  const style = document.createElement('style');
  style.id = 'offlyn-shopping-notification-styles';
  style.textContent = `
    #offlyn-shopping-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0;
      transform: translateX(24px);
      transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16,1,0.3,1);
      pointer-events: none;
    }
    #offlyn-shopping-notification.show {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .offlyn-shop-notif-content {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 1px 4px rgba(30,41,59,0.08);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 280px;
      max-width: 360px;
      border-left: 4px solid #d97706;
    }
    .offlyn-shop-notif-icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }
  `;
  document.head.appendChild(style);
}

function ensureStyles(): void {
  if (document.getElementById('offlyn-autofill-notification-styles')) return;

  const style = document.createElement('style');
  style.id = 'offlyn-autofill-notification-styles';
  style.textContent = `
    @keyframes offlyn-notif-pulse {
      0%   { box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 0 0 0 rgba(22,163,74,0.45); }
      50%  { box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 0 0 7px rgba(22,163,74,0); }
      100% { box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 0 0 0 rgba(22,163,74,0); }
    }

    #offlyn-autofill-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0;
      transform: translateX(24px);
      transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.16,1,0.3,1);
      pointer-events: none;
    }
    #offlyn-autofill-notification.show {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .offlyn-notif-content {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(30,41,59,0.14), 0 1px 4px rgba(30,41,59,0.08);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 280px;
      max-width: 360px;
      border-left: 4px solid #16a34a;
      animation: offlyn-notif-pulse 2s ease-out 0.35s 3;
    }
    .offlyn-notif-icon {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      position: relative;
    }
    /* Pulsing ring behind the icon */
    .offlyn-notif-icon::after {
      content: '';
      position: absolute;
      inset: -4px;
      border-radius: 50%;
      background: rgba(22,163,74,0.18);
      animation: offlyn-notif-pulse 2s ease-out 0.35s 3;
    }
    .offlyn-notif-text { flex: 1; min-width: 0; }
    .offlyn-notif-title {
      font-weight: 600;
      font-size: 13px;
      color: #1e293b;
      line-height: 1.3;
      margin-bottom: 2px;
    }
    .offlyn-notif-subtitle {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
    }
    .offlyn-notif-close {
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 0;
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .offlyn-notif-close:hover {
      background: #f1f5f9;
      color: #334155;
    }
  `;
  document.head.appendChild(style);
}
