/**
 * Inline Suggestion Tile - subtle AI suggestion badges that appear
 * inside empty text fields after autofill, offering one-click AI fill.
 *
 * Tiles reappear automatically when a user clears a field, enabling
 * regeneration of AI suggestions.
 *
 * Positioning: tiles are absolutely positioned in the document using
 * scroll-aware coordinates so they stay anchored to their field.
 */

import type { FieldSchema } from '../shared/types';

/** Track active (visible or hidden) tiles */
interface TileEntry {
  tile: HTMLElement;
  field: FieldSchema;
  element: HTMLElement;
  observer: MutationObserver | null;
  scrollHandler: (() => void) | null;
  resizeHandler: (() => void) | null;
  inputHandler: (() => void) | null;
  visible: boolean;
  destroyed: boolean; // true once fully removed (cleanup done)
}
const activeTiles = new Map<string, TileEntry>();

/** Permanently dismissed tiles (user explicitly clicked the X) */
const dismissedSelectors = new Set<string>();

/** Callback when a tile is clicked */
type OnTileClick = (field: FieldSchema, selector: string) => void;

let globalOnTileClick: OnTileClick | null = null;

/**
 * Register inline suggestion tiles on all eligible text/textarea fields.
 * Tiles auto-show when a field is empty and auto-hide when it has a value.
 * If the user clears a filled field, the tile reappears for regeneration.
 *
 * Call this after autofill completes — it registers ALL eligible fields,
 * including already-filled ones (tiles will be hidden until the field is cleared).
 */
export function showInlineSuggestionTiles(
  fields: FieldSchema[],
  _filledSelectors: Set<string>, // kept for API compat; visibility is based on actual DOM value
  onClick: OnTileClick
): void {
  // Inject styles once
  injectTileStyles();

  globalOnTileClick = onClick;

  for (const field of fields) {
    // Skip dropdown / autocomplete / select fields — tiles are only for text inputs
    if (field.type === 'autocomplete' || field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') continue;

    // Skip permanently dismissed fields
    if (dismissedSelectors.has(field.selector)) continue;

    const element = document.querySelector(field.selector);
    if (!element || !(element instanceof HTMLElement)) continue;

    // Only show on plain text inputs and textareas
    if (!isPlainTextInput(element)) continue;

    // Skip inputs inside React-Select or combobox containers
    if (isInsideDropdownWidget(element)) continue;

    // Don't create duplicate entries
    if (activeTiles.has(field.selector)) continue;

    // Register the field — tile will show/hide based on whether field is empty
    registerFieldTile(field, element);
  }
}

/**
 * Check if element is a plain text input or textarea (not a combobox, select, etc.)
 */
function isPlainTextInput(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();

  if (tag === 'textarea') return true;

  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    // Only plain text-like inputs
    if (['text', 'email', 'tel', 'url', 'search', 'number', ''].includes(inputType)) {
      // Exclude combobox-role inputs
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox') return false;
      // Exclude inputs with aria-autocomplete (dropdown search inputs)
      if (el.getAttribute('aria-autocomplete')) return false;
      return true;
    }
  }

  return false;
}

/**
 * Check if an element is inside a React-Select or other dropdown widget.
 */
function isInsideDropdownWidget(el: HTMLElement): boolean {
  const parent = el.closest(
    '[class*="select__"], [class*="Select__"], [role="combobox"], [role="listbox"], ' +
    '[class*="dropdown"], [class*="Dropdown"], [class*="combobox"], [class*="Combobox"]'
  );
  return !!parent;
}

/**
 * Register a field for tile management. Creates the tile and sets up
 * watchers that toggle visibility based on whether the field is empty.
 */
function registerFieldTile(field: FieldSchema, element: HTMLElement): void {
  const tile = document.createElement('div');
  tile.className = 'offlyn-ai-tile';
  tile.setAttribute('data-offlyn-selector', field.selector);

  tile.innerHTML = `
    <span class="offlyn-ai-tile__icon">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 0L9.79 5.53H15.6L10.91 8.94L12.7 14.47L8 11.06L3.3 14.47L5.09 8.94L0.4 5.53H6.21L8 0Z" fill="currentColor"/>
      </svg>
    </span>
    <span class="offlyn-ai-tile__text">AI fill</span>
  `;

  const inputEl = element as HTMLInputElement | HTMLTextAreaElement;
  const isEmpty = () => !inputEl.value?.trim();

  // Start hidden if field already has a value
  const startVisible = isEmpty();

  // Position tile
  positionTile(tile, element);
  if (!startVisible) {
    tile.style.display = 'none';
    tile.style.opacity = '0';
  }

  // Click handler — triggers AI fill
  tile.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    // Reset tile text for regeneration case (it might say "AI fill" or "Regenerate")
    setTileLoading(tile);

    globalOnTileClick?.(field, field.selector);
  });

  // Hover highlights the field
  tile.addEventListener('mouseenter', () => {
    element.style.transition = 'box-shadow 0.2s ease';
    element.style.boxShadow = '0 0 0 2px rgba(102, 126, 234, 0.25)';
  });
  tile.addEventListener('mouseleave', () => {
    element.style.boxShadow = '';
  });

  document.body.appendChild(tile);

  // Create the entry before setting up watchers
  const entry: TileEntry = {
    tile,
    field,
    element,
    observer: null,
    scrollHandler: null,
    resizeHandler: null,
    inputHandler: null,
    visible: startVisible,
    destroyed: false,
  };
  activeTiles.set(field.selector, entry);

  // --- Watcher: toggle tile on field empty/filled ---
  const syncVisibility = () => {
    if (entry.destroyed) return;
    const fieldEmpty = isEmpty();

    if (fieldEmpty && !entry.visible) {
      // Field just became empty → show tile (as "AI fill" again)
      showTileElement(entry);
    } else if (!fieldEmpty && entry.visible) {
      // Field got a value → hide tile
      hideTileElement(entry);
    }
  };

  // Listen for user input and programmatic changes
  element.addEventListener('input', syncVisibility);
  element.addEventListener('change', syncVisibility);
  entry.inputHandler = syncVisibility;

  // MutationObserver catches React-driven value changes
  const observer = new MutationObserver(syncVisibility);
  observer.observe(element, { attributes: true, attributeFilter: ['value'] });
  entry.observer = observer;

  // Also poll briefly after focus/blur (catches edge cases like paste-then-clear)
  element.addEventListener('blur', () => {
    setTimeout(syncVisibility, 100);
  });

  // Reposition on scroll/resize (debounced via rAF)
  let rafId: number | null = null;
  const reposition = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!entry.destroyed && entry.visible) {
        positionTile(tile, element);
      }
    });
  };

  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  const scrollParent = findScrollParent(element);
  if (scrollParent && scrollParent !== document.documentElement && scrollParent !== document.body) {
    scrollParent.addEventListener('scroll', reposition, { passive: true });
  }

  entry.scrollHandler = reposition;
  entry.resizeHandler = reposition;
}

/**
 * Show a tile element (field just became empty).
 */
function showTileElement(entry: TileEntry): void {
  entry.visible = true;
  const tile = entry.tile;

  // Reset to default state
  tile.classList.remove('offlyn-ai-tile--loading', 'offlyn-ai-tile--fadeout', 'offlyn-ai-tile--hidden');

  const textEl = tile.querySelector('.offlyn-ai-tile__text');
  if (textEl) textEl.textContent = 'AI fill';

  // Reposition before showing
  positionTile(tile, entry.element);

  // Animate in
  tile.style.display = '';
  tile.style.opacity = '0';
  // Use a tiny delay so display:'' takes effect before animation
  requestAnimationFrame(() => {
    tile.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    tile.style.opacity = '1';
  });
}

/**
 * Hide a tile element (field got a value).
 */
function hideTileElement(entry: TileEntry): void {
  entry.visible = false;
  const tile = entry.tile;

  tile.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  tile.style.opacity = '0';

  // After fade, set display:none so it doesn't block clicks
  setTimeout(() => {
    if (!entry.visible && !entry.destroyed) {
      tile.style.display = 'none';
    }
  }, 200);
}

/**
 * Position the tile at the right edge of the input field, using absolute
 * positioning in the document (scroll-aware).
 */
function positionTile(tile: HTMLElement, element: HTMLElement): void {
  const rect = element.getBoundingClientRect();

  // If element is not visible (zero size or off-screen), hide the tile
  if (rect.width === 0 || rect.height === 0) {
    tile.style.display = 'none';
    return;
  }
  if (tile.style.display === 'none' && activeTiles.get(tile.getAttribute('data-offlyn-selector') || '')?.visible) {
    tile.style.display = '';
  }

  // Convert viewport coords to document (absolute) coords
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  const tileHeight = 22;
  const topOffset = Math.max(0, (rect.height - tileHeight) / 2);

  // Place at the right side inside the input, with 8px padding from the right edge
  tile.style.position = 'absolute';
  tile.style.top = `${rect.top + scrollY + topOffset}px`;
  tile.style.left = `${rect.right + scrollX - 8}px`;
  tile.style.transform = 'translateX(-100%)';
  tile.style.zIndex = '2147483640';
}

/**
 * Find the nearest scrollable parent of an element.
 */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let parent = el.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return document.documentElement;
}

/**
 * Set a tile to loading state while AI is generating.
 */
function setTileLoading(tile: HTMLElement): void {
  tile.classList.add('offlyn-ai-tile--loading');
  const textEl = tile.querySelector('.offlyn-ai-tile__text');
  if (textEl) textEl.textContent = 'Thinking...';
}

/**
 * Remove a single tile by selector (permanent removal).
 */
export function removeTile(selector: string): void {
  const entry = activeTiles.get(selector);
  if (!entry || entry.destroyed) return;

  entry.destroyed = true;
  entry.tile.classList.add('offlyn-ai-tile--fadeout');
  entry.observer?.disconnect();

  // Clean up event listeners
  if (entry.scrollHandler) {
    window.removeEventListener('scroll', entry.scrollHandler);
    const scrollParent = findScrollParent(entry.element);
    if (scrollParent) scrollParent.removeEventListener('scroll', entry.scrollHandler);
  }
  if (entry.resizeHandler) {
    window.removeEventListener('resize', entry.resizeHandler);
  }
  if (entry.inputHandler) {
    entry.element.removeEventListener('input', entry.inputHandler);
    entry.element.removeEventListener('change', entry.inputHandler);
  }

  // Remove after fade animation
  setTimeout(() => {
    entry.tile.remove();
    activeTiles.delete(selector);
  }, 200);
}

/**
 * Remove all active tiles (e.g. on page refresh/re-scan).
 */
export function removeAllTiles(): void {
  for (const selector of [...activeTiles.keys()]) {
    removeTile(selector);
  }
  dismissedSelectors.clear();
}

/**
 * Check if any tiles are currently showing.
 */
export function hasActiveTiles(): boolean {
  return activeTiles.size > 0;
}

/**
 * Inject CSS styles for inline tiles (once).
 */
function injectTileStyles(): void {
  if (document.getElementById('offlyn-inline-tile-styles')) return;

  const style = document.createElement('style');
  style.id = 'offlyn-inline-tile-styles';
  style.textContent = `
    .offlyn-ai-tile {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px 2px 5px;
      background: rgba(255, 255, 255, 0.92);
      border: 1px solid rgba(102, 126, 234, 0.3);
      border-radius: 10px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 10px;
      font-weight: 500;
      color: #7c83db;
      white-space: nowrap;
      user-select: none;
      pointer-events: auto;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
      line-height: 1;
      height: 20px;
      box-sizing: border-box;
    }

    .offlyn-ai-tile:hover {
      background: rgba(102, 126, 234, 0.1);
      border-color: rgba(102, 126, 234, 0.5);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.18);
      color: #5b63d3;
    }

    .offlyn-ai-tile:active {
      box-shadow: 0 1px 2px rgba(102, 126, 234, 0.12);
    }

    .offlyn-ai-tile--loading {
      pointer-events: none;
      opacity: 0.65 !important;
    }

    .offlyn-ai-tile--loading .offlyn-ai-tile__icon {
      animation: offlyn-tile-spin 1s linear infinite;
    }

    .offlyn-ai-tile--fadeout {
      opacity: 0 !important;
      transform: translateX(-100%) scale(0.9) !important;
      transition: all 0.2s ease !important;
    }

    .offlyn-ai-tile--hidden {
      display: none !important;
    }

    .offlyn-ai-tile__icon {
      display: flex;
      align-items: center;
      justify-content: center;
      color: currentColor;
      flex-shrink: 0;
    }

    .offlyn-ai-tile__text {
      line-height: 1;
    }

    @keyframes offlyn-tile-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;

  document.head.appendChild(style);
}
