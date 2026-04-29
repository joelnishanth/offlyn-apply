/**
 * Inline Placeholder Hints - injects "Right-click → Offlyn Fill" placeholder
 * text into empty text fields so users discover the right-click context menu.
 *
 * Replaces the previous floating AI fill tile overlay which required Ollama
 * and had an unreliable click handler. The context menu fill is always available.
 *
 * When a field is empty and has no placeholder, we inject our hint. When the
 * field receives a value, we restore the original placeholder. When the field
 * is cleared again, the hint reappears.
 */

import type { FieldSchema } from '../shared/types';

/** Track fields we've patched so we can restore them */
interface PlaceholderEntry {
  field: FieldSchema;
  element: HTMLInputElement | HTMLTextAreaElement;
  originalPlaceholder: string;
  inputHandler: () => void;
  observer: MutationObserver | null;
}

const managedFields = new Map<string, PlaceholderEntry>();

const HINT_TEXT = 'Right-click → Offlyn Fill';

/** Fields where we've already restored the original placeholder */
const restoredFields = new Set<string>();

/**
 * Register placeholder hints on all eligible text/textarea fields.
 * Safe to call multiple times — skips already-managed fields.
 */
export function showInlineSuggestionTiles(
  fields: FieldSchema[],
  _filledSelectors: Set<string>,
  _onClick: unknown
): void {
  for (const field of fields) {
    if (field.type === 'autocomplete' || field.type === 'select' || field.type === 'checkbox' || field.type === 'radio') continue;
    if (managedFields.has(field.selector)) continue;

    const element = document.querySelector(field.selector);
    if (!element || !(element instanceof HTMLElement)) continue;
    if (!isPlainTextInput(element)) continue;
    if (isInsideDropdownWidget(element)) continue;

    registerPlaceholderHint(field, element as HTMLInputElement | HTMLTextAreaElement);
  }
}

/**
 * Remove all managed placeholder hints and restore original placeholders.
 */
export function removeAllTiles(): void {
  for (const [selector, entry] of managedFields) {
    restorePlaceholder(entry);
    entry.element.removeEventListener('input', entry.inputHandler);
    entry.element.removeEventListener('change', entry.inputHandler);
    entry.observer?.disconnect();
    managedFields.delete(selector);
  }
  restoredFields.clear();
}

/**
 * Remove a single placeholder hint by selector.
 */
export function removeTile(selector: string): void {
  const entry = managedFields.get(selector);
  if (!entry) return;
  restorePlaceholder(entry);
  entry.element.removeEventListener('input', entry.inputHandler);
  entry.element.removeEventListener('change', entry.inputHandler);
  entry.observer?.disconnect();
  managedFields.delete(selector);
}

/** Always false — no floating tiles exist anymore */
export function hasActiveTiles(): boolean {
  return false;
}

// ── Internals ──────────────────────────────────────────────────────────────

function registerPlaceholderHint(
  field: FieldSchema,
  element: HTMLInputElement | HTMLTextAreaElement
): void {
  const originalPlaceholder = element.getAttribute('placeholder') || '';
  const isEmpty = () => !element.value?.trim();

  // Only inject hint if field is empty
  if (isEmpty() && !originalPlaceholder) {
    element.setAttribute('placeholder', HINT_TEXT);
  }

  const syncPlaceholder = () => {
    const fieldEmpty = isEmpty();
    const currentPlaceholder = element.getAttribute('placeholder') || '';

    if (!fieldEmpty) {
      // Field has a value — restore original (or remove hint)
      if (currentPlaceholder === HINT_TEXT) {
        if (originalPlaceholder) {
          element.setAttribute('placeholder', originalPlaceholder);
        } else {
          element.removeAttribute('placeholder');
        }
      }
    } else {
      // Field is empty — show hint if no original placeholder exists
      if (!originalPlaceholder && currentPlaceholder !== HINT_TEXT) {
        element.setAttribute('placeholder', HINT_TEXT);
      }
    }
  };

  element.addEventListener('input', syncPlaceholder);
  element.addEventListener('change', syncPlaceholder);

  // Catch programmatic value changes (React-driven)
  const observer = new MutationObserver(syncPlaceholder);
  observer.observe(element, { attributes: true, attributeFilter: ['value'] });

  element.addEventListener('blur', () => setTimeout(syncPlaceholder, 50));

  managedFields.set(field.selector, {
    field,
    element,
    originalPlaceholder,
    inputHandler: syncPlaceholder,
    observer,
  });
}

function restorePlaceholder(entry: PlaceholderEntry): void {
  const current = entry.element.getAttribute('placeholder') || '';
  if (current === HINT_TEXT) {
    if (entry.originalPlaceholder) {
      entry.element.setAttribute('placeholder', entry.originalPlaceholder);
    } else {
      entry.element.removeAttribute('placeholder');
    }
  }
}

function isPlainTextInput(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (['text', 'email', 'tel', 'url', 'search', 'number', ''].includes(inputType)) {
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox') return false;
      if (el.getAttribute('aria-autocomplete')) return false;
      return true;
    }
  }
  return false;
}

function isInsideDropdownWidget(el: HTMLElement): boolean {
  const parent = el.closest(
    '[class*="select__"], [class*="Select__"], [role="combobox"], [role="listbox"], ' +
    '[class*="dropdown"], [class*="Dropdown"], [class*="combobox"], [class*="Combobox"]'
  );
  return !!parent;
}
