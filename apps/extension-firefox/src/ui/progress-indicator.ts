/**
 * Progress indicator - shows progress during autofill
 */

let progressElement: HTMLElement | null = null;

/**
 * Show progress indicator
 */
export function showProgress(total: number): void {
  // Remove existing if any
  hideProgress();
  
  // Create progress container
  const container = document.createElement('div');
  container.id = 'offlyn-progress-indicator';
  container.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 16px 24px;
    min-width: 300px;
    animation: slideInDown 0.3s ease;
  `;
  
  container.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div class="spinner" style="
        width: 20px;
        height: 20px;
        border: 3px solid #e5e7eb;
        border-top-color: #667eea;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      "></div>
      <div style="flex: 1;">
        <div style="
          font-weight: 600;
          font-size: 14px;
          color: #111827;
          margin-bottom: 8px;
        ">Auto-filling form...</div>
        <div style="
          background: #e5e7eb;
          height: 6px;
          border-radius: 3px;
          overflow: hidden;
        ">
          <div id="offlyn-progress-bar" style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100%;
            width: 0%;
            transition: width 0.3s ease;
          "></div>
        </div>
        <div id="offlyn-progress-text" style="
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        ">0 / ${total} fields</div>
      </div>
    </div>
  `;
  
  document.body.appendChild(container);
  progressElement = container;
  
  // Add spinner animation if not already present
  if (!document.getElementById('offlyn-progress-styles')) {
    const style = document.createElement('style');
    style.id = 'offlyn-progress-styles';
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      
      @keyframes slideInDown {
        from {
          opacity: 0;
          transform: translate(-50%, -20px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }
      
      @keyframes slideOutUp {
        from {
          opacity: 1;
          transform: translate(-50%, 0);
        }
        to {
          opacity: 0;
          transform: translate(-50%, -20px);
        }
      }
    `;
    document.head.appendChild(style);
  }
}

/**
 * Update progress
 */
export function updateProgress(current: number, total: number, fieldName?: string): void {
  if (!progressElement) return;
  
  const progressBar = progressElement.querySelector('#offlyn-progress-bar') as HTMLElement;
  const progressText = progressElement.querySelector('#offlyn-progress-text') as HTMLElement;
  
  if (progressBar) {
    const percentage = (current / total) * 100;
    progressBar.style.width = `${percentage}%`;
  }
  
  if (progressText) {
    let text = `${current} / ${total} fields`;
    if (fieldName) {
      text += ` - ${fieldName}`;
    }
    progressText.textContent = text;
  }
}

/**
 * Hide progress indicator
 */
export function hideProgress(delay: number = 1000): void {
  if (!progressElement) return;
  
  setTimeout(() => {
    if (progressElement) {
      progressElement.style.animation = 'slideOutUp 0.3s ease';
      setTimeout(() => {
        progressElement?.remove();
        progressElement = null;
      }, 300);
    }
  }, delay);
}

/**
 * Show completion state
 */
export function showProgressComplete(success: boolean, filled: number, total: number): void {
  if (!progressElement) return;
  
  const spinner = progressElement.querySelector('.spinner') as HTMLElement;
  const titleEl = progressElement.querySelector('div[style*="font-weight: 600"]') as HTMLElement;
  
  if (spinner) {
    spinner.style.display = 'none';
  }
  
  if (titleEl) {
    if (success) {
      titleEl.innerHTML = `✅ Complete! Filled ${filled} / ${total} fields`;
      titleEl.style.color = '#10b981';
    } else {
      titleEl.innerHTML = `⚠️ Partially complete: ${filled} / ${total} fields`;
      titleEl.style.color = '#f59e0b';
    }
  }
  
  // Hide after showing completion
  hideProgress(2000);
}
