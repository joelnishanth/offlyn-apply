/**
 * Field Summary UI - Shows detected form fields in a floating panel
 */

import type { FieldSchema } from '../shared/types';

let summaryPanel: HTMLElement | null = null;

/**
 * Update existing panel or create new one
 */
export function showFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  // If panel exists, just update its content
  if (summaryPanel && summaryPanel.parentElement) {
    updatePanelContent(summaryPanel, fields, jobTitle, company);
    return;
  }
  
  // Remove any orphaned panels
  const existing = document.getElementById('offlyn-field-summary');
  if (existing) {
    existing.remove();
  }
  
  // Create panel
  summaryPanel = document.createElement('div');
  summaryPanel.id = 'offlyn-field-summary';
  summaryPanel.innerHTML = `
    <div class="offlyn-summary-header">
      <h3>Offlyn - Detected Fields</h3>
      <button class="offlyn-close-btn" title="Close">&times;</button>
    </div>
    
    <div class="offlyn-summary-body">
      ${jobTitle || company ? `
        <div class="offlyn-job-info">
          ${jobTitle ? `<div class="offlyn-job-title">${escapeHtml(jobTitle)}</div>` : ''}
          ${company ? `<div class="offlyn-company">${escapeHtml(company)}</div>` : ''}
        </div>
      ` : ''}
      
      <div class="offlyn-field-count">
        Found <strong>${fields.length}</strong> form field${fields.length !== 1 ? 's' : ''}
        ${fields.filter(f => f.required).length > 0 ? 
          `(<span class="offlyn-required">${fields.filter(f => f.required).length} required</span>)` : ''}
      </div>
      
      <div class="offlyn-info-box">
        💡 <strong>Tip:</strong> Click the extension icon and use the <strong>🚀 Auto-Fill Form</strong> button to fill these fields!
      </div>
      
      <div class="offlyn-field-list">
        ${fields.length === 0 ? 
          '<div class="offlyn-no-fields">No form fields detected on this page.</div>' :
          fields.map(field => renderField(field)).join('')
        }
      </div>
    </div>
    
    <div class="offlyn-summary-footer">
      <button class="offlyn-export-btn">Copy as JSON</button>
      <button class="offlyn-refresh-btn">Refresh</button>
    </div>
  `;
  
  // Add styles
  addStyles();
  
  // Add to page
  document.body.appendChild(summaryPanel);
  
  // Add event listeners
  const closeBtn = summaryPanel.querySelector('.offlyn-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideFieldSummary);
  }
  
  const exportBtn = summaryPanel.querySelector('.offlyn-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportFields(fields));
  }
  
  const refreshBtn = summaryPanel.querySelector('.offlyn-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Show loading state
      const originalText = refreshBtn.textContent;
      refreshBtn.textContent = 'Scanning...';
      (refreshBtn as HTMLButtonElement).disabled = true;
      
      // Trigger a re-scan
      window.dispatchEvent(new CustomEvent('offlyn-refresh-scan'));
      
      // Reset button after a delay
      setTimeout(() => {
        refreshBtn.textContent = originalText;
        (refreshBtn as HTMLButtonElement).disabled = false;
      }, 2000);
    });
  }
  
  // Make draggable
  makeDraggable(summaryPanel);
}

/**
 * Hide the field summary panel
 */
export function hideFieldSummary(): void {
  if (summaryPanel) {
    summaryPanel.remove();
    summaryPanel = null;
  }
}

/**
 * Toggle field summary visibility
 */
export function toggleFieldSummary(fields: FieldSchema[], jobTitle?: string, company?: string): void {
  if (summaryPanel) {
    hideFieldSummary();
  } else {
    showFieldSummary(fields, jobTitle, company);
  }
}

/**
 * Render a single field
 */
function renderField(field: FieldSchema): string {
  const typeIcon = getFieldIcon(field.type || 'text');
  const requiredBadge = field.required ? '<span class="offlyn-badge-required">Required</span>' : '';
  const disabledBadge = field.disabled ? '<span class="offlyn-badge-disabled">Disabled</span>' : '';
  const multipleBadge = field.multiple ? '<span class="offlyn-badge-multiple">Multiple</span>' : '';
  
  const label = field.label || field.name || field.id || 'Unnamed';
  const fieldType = field.type || 'text';
  const currentValue = field.valuePreview ? `<div class="offlyn-field-value">Current: ${escapeHtml(field.valuePreview)}</div>` : '';
  
  // Show available options for dropdowns/autocomplete
  let optionsHtml = '';
  if ((field.type === 'select' || field.type === 'select-one' || field.type === 'autocomplete') && 
      field.options && field.options.length > 0) {
    const optionCount = field.options.length;
    const previewOptions = field.options.slice(0, 3).map(opt => escapeHtml(opt)).join(', ');
    const moreText = optionCount > 3 ? ` (+${optionCount - 3} more)` : '';
    optionsHtml = `<div class="offlyn-field-options">Options: ${previewOptions}${moreText}</div>`;
  }
  
  return `
    <div class="offlyn-field-item" data-selector="${escapeHtml(field.selector)}">
      <div class="offlyn-field-header">
        <span class="offlyn-field-icon">${typeIcon}</span>
        <span class="offlyn-field-label">${escapeHtml(label)}</span>
        <span class="offlyn-field-type">${escapeHtml(fieldType)}</span>
      </div>
      <div class="offlyn-field-meta">
        ${requiredBadge}
        ${disabledBadge}
        ${multipleBadge}
      </div>
      ${currentValue}
      ${optionsHtml}
      <div class="offlyn-field-selector">${escapeHtml(field.selector)}</div>
    </div>
  `;
}

/**
 * Get icon for field type
 */
function getFieldIcon(type: string): string {
  const icons: Record<string, string> = {
    'text': '[T]',
    'email': '[E]',
    'tel': '[P]',
    'url': '[U]',
    'number': '[N]',
    'date': '[D]',
    'time': '[T]',
    'password': '[*]',
    'file': '[F]',
    'checkbox': '[X]',
    'radio': '[O]',
    'select': '[▼]',        // Dropdown list
    'select-one': '[▼]',    // Single-select dropdown
    'autocomplete': '[▼?]', // Searchable dropdown
    'textarea': '[A]',
    'search': '[?]',
  };
  return icons[type] || '[I]';
}

/**
 * Export fields as JSON
 */
function exportFields(fields: FieldSchema[]): void {
  const json = JSON.stringify(fields, null, 2);
  navigator.clipboard.writeText(json).then(() => {
    const btn = summaryPanel?.querySelector('.offlyn-export-btn');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  }).catch(err => {
    console.error('Failed to copy:', err);
    alert('Failed to copy to clipboard');
  });
}

/**
 * Make panel draggable
 */
function makeDraggable(panel: HTMLElement): void {
  const header = panel.querySelector('.offlyn-summary-header') as HTMLElement;
  if (!header) return;
  
  let isDragging = false;
  let currentX = 0;
  let currentY = 0;
  let initialX = 0;
  let initialY = 0;
  
  header.style.cursor = 'move';
  
  header.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).classList.contains('offlyn-close-btn')) return;
    
    isDragging = true;
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    e.preventDefault();
    currentX = e.clientX - initialX;
    currentY = e.clientY - initialY;
    
    panel.style.transform = `translate(${currentX}px, ${currentY}px)`;
  });
  
  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
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
 * Update panel content without recreating it
 */
function updatePanelContent(panel: HTMLElement, fields: FieldSchema[], jobTitle?: string, company?: string): void {
  const bodyEl = panel.querySelector('.offlyn-summary-body');
  if (!bodyEl) return;
  
  bodyEl.innerHTML = `
    ${jobTitle || company ? `
      <div class="offlyn-job-info">
        ${jobTitle ? `<div class="offlyn-job-title">${escapeHtml(jobTitle)}</div>` : ''}
        ${company ? `<div class="offlyn-company">${escapeHtml(company)}</div>` : ''}
      </div>
    ` : ''}
    
    <div class="offlyn-field-count">
      Found <strong>${fields.length}</strong> form field${fields.length !== 1 ? 's' : ''}
      ${fields.filter(f => f.required).length > 0 ? 
        `(<span class="offlyn-required">${fields.filter(f => f.required).length} required</span>)` : ''}
    </div>
    
    <div class="offlyn-info-box">
      💡 <strong>Tip:</strong> Click the extension icon and use the <strong>🚀 Auto-Fill Form</strong> button to fill these fields!
    </div>
    
    <div class="offlyn-field-list">
      ${fields.length === 0 ? 
        '<div class="offlyn-no-fields">No form fields detected on this page.</div>' :
        fields.map(field => renderField(field)).join('')
      }
    </div>
  `;
  
  // Re-attach export button handler (body was replaced)
  const exportBtn = panel.querySelector('.offlyn-export-btn');
  if (exportBtn) {
    exportBtn.replaceWith(exportBtn.cloneNode(true));
    const newExportBtn = panel.querySelector('.offlyn-export-btn');
    if (newExportBtn) {
      newExportBtn.addEventListener('click', () => exportFields(fields));
    }
  }
}

/**
 * Add CSS styles
 */
function addStyles(): void {
  if (document.getElementById('offlyn-field-summary-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'offlyn-field-summary-styles';
  style.textContent = `
    #offlyn-field-summary {
      position: fixed;
      top: 20px;
      right: 20px;
      width: 400px;
      max-height: 80vh;
      background: white;
      border: 2px solid #2196F3;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      display: flex;
      flex-direction: column;
    }
    
    .offlyn-summary-header {
      background: #2196F3;
      color: white;
      padding: 12px 16px;
      border-radius: 6px 6px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
    }
    
    .offlyn-summary-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    
    .offlyn-close-btn {
      background: transparent;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      line-height: 24px;
      text-align: center;
      border-radius: 4px;
    }
    
    .offlyn-close-btn:hover {
      background: rgba(255,255,255,0.2);
    }
    
    .offlyn-summary-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      max-height: calc(80vh - 140px);
    }
    
    .offlyn-job-info {
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
      margin-bottom: 16px;
    }
    
    .offlyn-job-title {
      font-weight: 600;
      font-size: 15px;
      color: #1a1a1a;
      margin-bottom: 4px;
    }
    
    .offlyn-company {
      font-size: 13px;
      color: #666;
    }
    
    .offlyn-field-count {
      padding: 10px 12px;
      background: #e3f2fd;
      border-left: 3px solid #2196F3;
      margin-bottom: 16px;
      border-radius: 4px;
    }
    
    .offlyn-field-count strong {
      color: #2196F3;
    }
    
    .offlyn-required {
      color: #f44336;
      font-weight: 600;
    }
    
    .offlyn-info-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }
    
    .offlyn-info-box strong {
      font-weight: 700;
    }
    
    .offlyn-field-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .offlyn-no-fields {
      text-align: center;
      padding: 40px 20px;
      color: #999;
      font-style: italic;
    }
    
    .offlyn-field-item {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 12px;
      background: #fafafa;
      transition: all 0.2s;
    }
    
    .offlyn-field-item:hover {
      border-color: #2196F3;
      background: white;
      box-shadow: 0 2px 8px rgba(33,150,243,0.1);
    }
    
    .offlyn-field-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .offlyn-field-icon {
      font-size: 18px;
    }
    
    .offlyn-field-label {
      flex: 1;
      font-weight: 600;
      color: #1a1a1a;
    }
    
    .offlyn-field-type {
      font-size: 12px;
      padding: 2px 8px;
      background: #e0e0e0;
      border-radius: 3px;
      color: #666;
    }
    
    .offlyn-field-meta {
      display: flex;
      gap: 6px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    
    .offlyn-badge-required {
      font-size: 11px;
      padding: 2px 6px;
      background: #ffebee;
      color: #c62828;
      border-radius: 3px;
      font-weight: 600;
    }
    
    .offlyn-badge-disabled {
      font-size: 11px;
      padding: 2px 6px;
      background: #f5f5f5;
      color: #999;
      border-radius: 3px;
    }
    
    .offlyn-badge-multiple {
      font-size: 11px;
      padding: 2px 6px;
      background: #e3f2fd;
      color: #1976d2;
      border-radius: 3px;
    }
    
    .offlyn-field-value {
      font-size: 12px;
      color: #666;
      margin-bottom: 6px;
      padding: 6px 8px;
      background: #fff;
      border-radius: 3px;
      font-family: monospace;
    }
    
    .offlyn-field-options {
      font-size: 11px;
      color: #0066cc;
      margin-bottom: 6px;
      padding: 6px 8px;
      background: #e8f4ff;
      border-radius: 3px;
      border-left: 3px solid #0066cc;
      font-style: italic;
    }
    
    .offlyn-field-selector {
      font-size: 11px;
      font-family: 'Courier New', monospace;
      color: #999;
      padding: 6px 8px;
      background: white;
      border-radius: 3px;
      overflow-x: auto;
      white-space: nowrap;
    }
    
    .offlyn-summary-footer {
      padding: 12px 16px;
      border-top: 1px solid #e0e0e0;
      display: flex;
      gap: 8px;
      background: #fafafa;
      border-radius: 0 0 6px 6px;
    }
    
    .offlyn-summary-footer button {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ddd;
      background: white;
      color: #333;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .offlyn-summary-footer button:hover {
      background: #f5f5f5;
      border-color: #2196F3;
    }
    
    .offlyn-summary-footer button:active {
      background: #e3f2fd;
    }
  `;
  
  document.head.appendChild(style);
}
