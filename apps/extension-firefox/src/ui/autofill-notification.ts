/**
 * Gentle Autofill Notification - Shows a simple notification when fields are detected
 */

let notification: HTMLElement | null = null;
let autoHideTimeout: number | null = null;

export function showAutofillNotification(fieldCount: number): void {
  // Remove existing notification
  hideAutofillNotification();
  
  // Create notification
  notification = document.createElement('div');
  notification.id = 'offlyn-autofill-notification';
  notification.innerHTML = `
    <div class="offlyn-notif-content">
      <div class="offlyn-notif-icon">✨</div>
      <div class="offlyn-notif-text">
        <div class="offlyn-notif-title">Autofill Ready</div>
        <div class="offlyn-notif-subtitle">${fieldCount} field${fieldCount !== 1 ? 's' : ''} detected</div>
      </div>
      <button class="offlyn-notif-close" title="Dismiss">×</button>
    </div>
  `;
  
  // Add styles
  addStyles();
  
  // Add to page
  document.body.appendChild(notification);
  
  // Add close handler
  const closeBtn = notification.querySelector('.offlyn-notif-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideAutofillNotification);
  }
  
  // Auto-hide after 5 seconds
  autoHideTimeout = window.setTimeout(() => {
    hideAutofillNotification();
  }, 5000);
  
  // Animate in
  requestAnimationFrame(() => {
    notification?.classList.add('show');
  });
}

export function hideAutofillNotification(): void {
  if (autoHideTimeout) {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
  }
  
  if (notification) {
    notification.classList.remove('show');
    setTimeout(() => {
      notification?.remove();
      notification = null;
    }, 300);
  }
}

function addStyles(): void {
  if (document.getElementById('offlyn-autofill-notification-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'offlyn-autofill-notification-styles';
  style.textContent = `
    #offlyn-autofill-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      opacity: 0;
      transform: translateY(-10px);
      transition: all 0.3s ease;
      pointer-events: none;
    }
    
    #offlyn-autofill-notification.show {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    
    .offlyn-notif-content {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 280px;
      border: 1px solid rgba(102, 126, 234, 0.2);
    }
    
    .offlyn-notif-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    
    .offlyn-notif-text {
      flex: 1;
    }
    
    .offlyn-notif-title {
      font-weight: 600;
      font-size: 15px;
      color: #1a1a1a;
      margin-bottom: 2px;
    }
    
    .offlyn-notif-subtitle {
      font-size: 13px;
      color: #666;
    }
    
    .offlyn-notif-close {
      background: none;
      border: none;
      color: #999;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      line-height: 24px;
      text-align: center;
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.2s;
    }
    
    .offlyn-notif-close:hover {
      background: #f5f5f5;
      color: #333;
    }
  `;
  
  document.head.appendChild(style);
}
