/**
 * Notification system - shows toast notifications to user
 */

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  duration: number;
}

const activeNotifications = new Map<string, HTMLElement>();

/**
 * Show a notification toast
 */
export function showNotification(
  title: string,
  message: string,
  type: NotificationType = 'info',
  duration: number = 4000
): void {
  const id = `notification_${Date.now()}`;
  
  // Create notification container if it doesn't exist
  let container = document.getElementById('offlyn-notifications-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'offlyn-notifications-container';
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      gap: 12px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  
  // Create notification element
  const notification = document.createElement('div');
  notification.id = id;
  notification.style.cssText = `
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 16px;
    min-width: 300px;
    max-width: 400px;
    pointer-events: auto;
    animation: slideInRight 0.3s ease;
    border-left: 4px solid ${getTypeColor(type)};
  `;
  
  const icon = getTypeIcon(type);
  
  notification.innerHTML = `
    <div style="display: flex; align-items: start; gap: 12px;">
      <div style="
        font-size: 24px;
        flex-shrink: 0;
        line-height: 1;
      ">${icon}</div>
      <div style="flex: 1; min-width: 0;">
        <div style="
          font-weight: 600;
          font-size: 14px;
          color: #111827;
          margin-bottom: 4px;
        ">${escapeHtml(title)}</div>
        <div style="
          font-size: 13px;
          color: #6b7280;
          line-height: 1.4;
        ">${escapeHtml(message)}</div>
      </div>
      <button style="
        background: none;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
        padding: 0;
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      " onclick="this.closest('[id^=notification_]').remove()">×</button>
    </div>
  `;
  
  container.appendChild(notification);
  activeNotifications.set(id, notification);
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(id);
    }, duration);
  }
}

/**
 * Remove a notification
 */
function removeNotification(id: string): void {
  const notification = activeNotifications.get(id);
  if (!notification) return;
  
  notification.style.animation = 'slideOutRight 0.3s ease';
  
  setTimeout(() => {
    notification.remove();
    activeNotifications.delete(id);
    
    // Remove container if empty
    const container = document.getElementById('offlyn-notifications-container');
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 300);
}

/**
 * Clear all notifications
 */
export function clearAllNotifications(): void {
  for (const id of activeNotifications.keys()) {
    removeNotification(id);
  }
}

/**
 * Get color for notification type
 */
function getTypeColor(type: NotificationType): string {
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  return colors[type];
}

/**
 * Get icon for notification type
 */
function getTypeIcon(type: NotificationType): string {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  return icons[type];
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Add animation styles
 */
function addNotificationStyles(): void {
  if (document.getElementById('offlyn-notification-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'offlyn-notification-styles';
  style.textContent = `
    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    
    @keyframes slideOutRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100px);
      }
    }
  `;
  
  document.head.appendChild(style);
}

// Initialize styles
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addNotificationStyles);
} else {
  addNotificationStyles();
}

/**
 * Show success notification
 */
export function showSuccess(title: string, message: string, duration?: number): void {
  showNotification(title, message, 'success', duration);
}

/**
 * Show error notification
 */
export function showError(title: string, message: string, duration?: number): void {
  showNotification(title, message, 'error', duration);
}

/**
 * Show warning notification
 */
export function showWarning(title: string, message: string, duration?: number): void {
  showNotification(title, message, 'warning', duration);
}

/**
 * Show info notification
 */
export function showInfo(title: string, message: string, duration?: number): void {
  showNotification(title, message, 'info', duration);
}
