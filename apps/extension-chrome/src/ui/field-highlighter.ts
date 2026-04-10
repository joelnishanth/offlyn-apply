/**
 * Field highlighter - visually highlights fields during autofill
 */

interface HighlightedField {
  element: HTMLElement;
  originalStyle: {
    outline: string;
    backgroundColor: string;
    transition: string;
  };
}

const highlightedFields = new Map<string, HighlightedField>();

/**
 * Highlight a field with animation
 */
export function highlightField(selector: string, type: 'filling' | 'success' | 'error' = 'filling'): void {
  try {
    const element = document.querySelector(selector);
    if (!element || !(element instanceof HTMLElement)) {
      console.warn(`[Highlighter] Element not found: ${selector}`);
      return;
    }
    
    // Save original styles if not already saved
    if (!highlightedFields.has(selector)) {
      highlightedFields.set(selector, {
        element,
        originalStyle: {
          outline: element.style.outline,
          backgroundColor: element.style.backgroundColor,
          transition: element.style.transition
        }
      });
    }
    
    // Apply highlight based on type
    const colors = {
      filling: {
        outline: '3px solid #3b82f6',
        background: 'rgba(59, 130, 246, 0.1)'
      },
      success: {
        outline: '3px solid #1a7f5a',
        background: 'rgba(16, 185, 129, 0.1)'
      },
      error: {
        outline: '3px solid #ef4444',
        background: 'rgba(239, 68, 68, 0.1)'
      }
    };
    
    const color = colors[type];
    
    // Add transition for smooth effect
    element.style.transition = 'all 0.3s ease';
    element.style.outline = color.outline;
    element.style.backgroundColor = color.background;
    
    // Scroll element into view
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Add pulse animation
    element.animate([
      { transform: 'scale(1)', opacity: 1 },
      { transform: 'scale(1.02)', opacity: 0.9 },
      { transform: 'scale(1)', opacity: 1 }
    ], {
      duration: 500,
      easing: 'ease-in-out'
    });
    
  } catch (err) {
    console.error('[Highlighter] Error highlighting field:', err);
  }
}

/**
 * Remove highlight from a field
 */
export function removeHighlight(selector: string, delay: number = 2000): void {
  const doRemove = () => {
    try {
      const highlighted = highlightedFields.get(selector);
      if (!highlighted) return;
      
      const { element, originalStyle } = highlighted;
      
      // Restore original styles
      element.style.transition = 'all 0.3s ease';
      element.style.outline = originalStyle.outline;
      element.style.backgroundColor = originalStyle.backgroundColor;
      
      // Clean up after transition
      setTimeout(() => {
        element.style.transition = originalStyle.transition;
        highlightedFields.delete(selector);
      }, 300);
      
    } catch (err) {
      console.error('[Highlighter] Error removing highlight:', err);
    }
  };
  
  if (delay === 0) {
    doRemove();
  } else {
    setTimeout(doRemove, delay);
  }
}

/**
 * Highlight field as being filled (blue)
 */
export async function highlightFieldAsFilling(selector: string): Promise<void> {
  highlightField(selector, 'filling');
}

/**
 * Highlight field as successfully filled (green)
 */
export async function highlightFieldAsSuccess(selector: string, autoRemove: boolean = true): Promise<void> {
  highlightField(selector, 'success');
  if (autoRemove) {
    removeHighlight(selector, 2000);
  }
}

/**
 * Highlight field as error (red)
 */
export async function highlightFieldAsError(selector: string, autoRemove: boolean = true): Promise<void> {
  highlightField(selector, 'error');
  if (autoRemove) {
    removeHighlight(selector, 3000);
  }
}

/**
 * Clear all highlights
 */
export function clearAllHighlights(): void {
  for (const selector of highlightedFields.keys()) {
    const highlighted = highlightedFields.get(selector);
    if (highlighted) {
      const { element, originalStyle } = highlighted;
      element.style.outline = originalStyle.outline;
      element.style.backgroundColor = originalStyle.backgroundColor;
      element.style.transition = originalStyle.transition;
    }
  }
  highlightedFields.clear();
}

/**
 * Highlight multiple fields with staggered animation
 */
export async function highlightFieldsSequentially(
  selectors: string[],
  delayBetween: number = 100
): Promise<void> {
  for (let i = 0; i < selectors.length; i++) {
    highlightFieldAsFilling(selectors[i]);
    if (i < selectors.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayBetween));
    }
  }
}

/**
 * Show a temporary label on a field
 */
export function showFieldLabel(selector: string, text: string, duration: number = 2000): void {
  try {
    const element = document.querySelector(selector);
    if (!element || !(element instanceof HTMLElement)) return;
    
    // Create label
    const label = document.createElement('div');
    label.style.cssText = `
      position: absolute;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a7f5a 100%);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      z-index: 2147483646;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      animation: slideInDown 0.3s ease;
    `;
    label.textContent = text;
    
    // Position above the element
    const rect = element.getBoundingClientRect();
    label.style.left = `${rect.left + window.scrollX}px`;
    label.style.top = `${rect.top + window.scrollY - 30}px`;
    
    document.body.appendChild(label);
    
    // Remove after duration
    setTimeout(() => {
      label.style.animation = 'slideOutUp 0.3s ease';
      setTimeout(() => label.remove(), 300);
    }, duration);
    
  } catch (err) {
    console.error('[Highlighter] Error showing label:', err);
  }
}

/**
 * Add animation CSS if not already present
 */
function addAnimationStyles(): void {
  if (document.getElementById('offlyn-highlighter-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'offlyn-highlighter-styles';
  style.textContent = `
    @keyframes slideInDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes slideOutUp {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-10px);
      }
    }
  `;
  
  document.head.appendChild(style);
}

// Initialize animation styles
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', addAnimationStyles);
} else {
  addAnimationStyles();
}
