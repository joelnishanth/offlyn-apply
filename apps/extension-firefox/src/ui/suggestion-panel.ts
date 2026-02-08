/**
 * Suggestion panel UI - shows intelligent suggestions for form fields
 * Similar to superfill.ai's suggestion interface
 */

import type { FieldSuggestion, SuggestionOption } from '../shared/suggestion-service';
import { addAnswerVariation } from '../shared/context-aware-storage';

interface SuggestionPanelState {
  visible: boolean;
  suggestions: FieldSuggestion[];
  selectedSuggestions: Map<string, SuggestionOption>; // selector -> selected option
  onApply?: (selections: Map<string, SuggestionOption>) => void;
  onDismiss?: () => void;
}

let panelState: SuggestionPanelState = {
  visible: false,
  suggestions: [],
  selectedSuggestions: new Map()
};

let panelElement: HTMLElement | null = null;

/**
 * Show suggestion panel with field suggestions
 */
export function showSuggestionPanel(
  suggestions: FieldSuggestion[],
  onApply: (selections: Map<string, SuggestionOption>) => void,
  onDismiss: () => void
): void {
  if (suggestions.length === 0) {
    console.warn('[Suggestions] No suggestions to show');
    return;
  }
  
  panelState = {
    visible: true,
    suggestions,
    selectedSuggestions: new Map(),
    onApply,
    onDismiss
  };
  
  // Pre-select primary suggestions
  for (const suggestion of suggestions) {
    const primary = suggestion.suggestions.find(s => s.isPrimary);
    if (primary) {
      panelState.selectedSuggestions.set(suggestion.selector, primary);
    }
  }
  
  renderPanel();
}

/**
 * Hide suggestion panel
 */
export function hideSuggestionPanel(): void {
  if (panelElement) {
    panelElement.remove();
    panelElement = null;
  }
  
  panelState.visible = false;
  panelState.suggestions = [];
  panelState.selectedSuggestions.clear();
}

/**
 * Render the suggestion panel UI
 */
function renderPanel(): void {
  // Remove existing panel if any
  if (panelElement) {
    panelElement.remove();
  }
  
  // Create panel container
  const panel = document.createElement('div');
  panel.id = 'offlyn-suggestion-panel';
  panel.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
    max-height: 80vh;
    background: white;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `;
  
  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 20px 24px;
    border-bottom: 1px solid #e5e7eb;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  `;
  header.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h2 style="margin: 0 0 4px 0; font-size: 20px; font-weight: 600;">
          Smart Fill Suggestions
        </h2>
        <p style="margin: 0; font-size: 14px; opacity: 0.9;">
          Review and apply ${panelState.suggestions.length} suggested field values
        </p>
      </div>
      <button id="offlyn-panel-close" style="
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      ">×</button>
    </div>
  `;
  
  // Content area (scrollable)
  const content = document.createElement('div');
  content.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
  `;
  
  // Render each suggestion
  for (const suggestion of panelState.suggestions) {
    const suggestionCard = createSuggestionCard(suggestion);
    content.appendChild(suggestionCard);
  }
  
  // Footer with actions
  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 16px 24px;
    border-top: 1px solid #e5e7eb;
    background: #f9fafb;
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  `;
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = `
    padding: 10px 20px;
    border: 1px solid #d1d5db;
    background: white;
    color: #374151;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  `;
  cancelBtn.onmouseover = () => {
    cancelBtn.style.background = '#f3f4f6';
  };
  cancelBtn.onmouseout = () => {
    cancelBtn.style.background = 'white';
  };
  cancelBtn.onclick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    hideSuggestionPanel();
    panelState.onDismiss?.();
  };
  
  const applyBtn = document.createElement('button');
  applyBtn.textContent = `Apply ${panelState.selectedSuggestions.size} Suggestions`;
  applyBtn.style.cssText = `
    padding: 10px 20px;
    border: none;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  `;
  applyBtn.onmouseover = () => {
    applyBtn.style.transform = 'translateY(-1px)';
    applyBtn.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
  };
  applyBtn.onmouseout = () => {
    applyBtn.style.transform = 'translateY(0)';
    applyBtn.style.boxShadow = 'none';
  };
  applyBtn.onclick = async (e: MouseEvent) => {
    // Prevent event from bubbling up to avoid interference with global click handlers
    e.stopPropagation();
    e.preventDefault();
    
    console.log('[Suggestions] Apply button clicked!');
    console.log('[Suggestions] Selected suggestions count:', panelState.selectedSuggestions.size);
    console.log('[Suggestions] Selected suggestions (detailed):');
    
    // Log each selection in detail
    for (const [selector, option] of panelState.selectedSuggestions.entries()) {
      console.log(`  - Selector: ${selector}`);
      console.log(`    Value: ${option.value}`);
      console.log(`    Source: ${option.source}`);
    }
    
    if (panelState.selectedSuggestions.size === 0) {
      console.warn('[Suggestions] No suggestions selected, nothing to apply');
      alert('Please select at least one suggestion to apply');
      return;
    }
    
    console.log('[Suggestions] Calling onApply callback with Map size:', panelState.selectedSuggestions.size);
    console.log('[Suggestions] Panel will be hidden AFTER callback completes');
    
    // Call the callback and wait for it to complete BEFORE hiding the panel
    try {
      await panelState.onApply?.(panelState.selectedSuggestions);
      console.log('[Suggestions] onApply callback completed, now hiding panel');
    } catch (err) {
      console.error('[Suggestions] Error in onApply callback:', err);
    } finally {
      hideSuggestionPanel();
    }
  };
  
  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  
  // Assemble panel
  panel.appendChild(header);
  panel.appendChild(content);
  panel.appendChild(footer);
  
  // Add to document
  document.body.appendChild(panel);
  panelElement = panel;
  
  // Add close button listener
  const closeBtn = panel.querySelector('#offlyn-panel-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      hideSuggestionPanel();
      panelState.onDismiss?.();
    });
  }
  
  // Close on ESC key
  const escListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      hideSuggestionPanel();
      panelState.onDismiss?.();
      document.removeEventListener('keydown', escListener);
    }
  };
  document.addEventListener('keydown', escListener);
}

/**
 * Create a suggestion card for a single field
 */
function createSuggestionCard(suggestion: FieldSuggestion): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = `
    margin-bottom: 16px;
    padding: 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: white;
    transition: all 0.2s;
  `;
  
  // Field label
  const fieldLabel = document.createElement('div');
  fieldLabel.style.cssText = `
    font-size: 14px;
    font-weight: 600;
    color: #111827;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  `;
  fieldLabel.innerHTML = `
    <span>${escapeHtml(suggestion.field.label || suggestion.field.name || 'Field')}</span>
    <span style="
      background: ${getConfidenceBadgeColor(suggestion.confidence)};
      color: white;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    ">${Math.round(suggestion.confidence * 100)}% match</span>
  `;
  
  card.appendChild(fieldLabel);
  
  // Suggestion options
  const optionsContainer = document.createElement('div');
  optionsContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
  `;
  
  for (const option of suggestion.suggestions.slice(0, 3)) { // Show max 3 options
    const optionBtn = createSuggestionOption(suggestion.selector, option);
    optionsContainer.appendChild(optionBtn);
  }
  
  card.appendChild(optionsContainer);
  
  return card;
}

/**
 * Create a single suggestion option button
 */
function createSuggestionOption(selector: string, option: SuggestionOption): HTMLElement {
  const isSelected = panelState.selectedSuggestions.get(selector)?.id === option.id;
  
  const btn = document.createElement('button');
  btn.style.cssText = `
    padding: 12px;
    border: 2px solid ${isSelected ? '#667eea' : '#e5e7eb'};
    background: ${isSelected ? '#f5f7ff' : 'white'};
    border-radius: 6px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  `;
  
  btn.innerHTML = `
    <div style="display: flex; align-items: start; gap: 8px;">
      <input type="radio" 
        name="suggestion-${selector}" 
        ${isSelected ? 'checked' : ''}
        style="margin-top: 2px; cursor: pointer;"
      />
      <div style="flex: 1;">
        <div style="font-size: 14px; color: #111827; margin-bottom: 4px;">
          ${truncateText(escapeHtml(option.value), 100)}
        </div>
        <div style="font-size: 12px; color: #6b7280; display: flex; align-items: center; gap: 8px;">
          <span>${getSourceBadge(option.source)}</span>
          <span>•</span>
          <span>${escapeHtml(option.reasoning)}</span>
        </div>
      </div>
    </div>
  `;
  
  btn.onclick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    panelState.selectedSuggestions.set(selector, option);
    renderPanel(); // Re-render to update selection
  };
  
  btn.onmouseover = () => {
    if (!isSelected) {
      btn.style.borderColor = '#cbd5e1';
      btn.style.background = '#f9fafb';
    }
  };
  
  btn.onmouseout = () => {
    if (!isSelected) {
      btn.style.borderColor = '#e5e7eb';
      btn.style.background = 'white';
    }
  };
  
  return btn;
}

/**
 * Get confidence badge color
 */
function getConfidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.8) return '#10b981'; // green
  if (confidence >= 0.6) return '#f59e0b'; // orange
  return '#6b7280'; // gray
}

/**
 * Get source badge HTML
 */
function getSourceBadge(source: string): string {
  const badges: Record<string, { label: string; color: string }> = {
    profile: { label: 'Profile', color: '#3b82f6' },
    contextual: { label: 'Saved', color: '#8b5cf6' },
    ai: { label: 'AI', color: '#ec4899' },
    learned: { label: 'Learned', color: '#10b981' }
  };
  
  const badge = badges[source] || { label: source, color: '#6b7280' };
  
  return `<span style="
    background: ${badge.color};
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  ">${badge.label}</span>`;
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if suggestion panel is visible
 */
export function isSuggestionPanelVisible(): boolean {
  return panelState.visible;
}
