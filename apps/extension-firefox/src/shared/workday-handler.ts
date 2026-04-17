/**
 * Workday-specific autofill handler
 *
 * Handles the parts of Workday job applications that the generic fill engine
 * cannot reach:
 *   - "My Experience" → Work Experience / Education inline "Add" forms
 *   - Skills tag-input ("Type to Add Skills")
 *   - Step-context detection
 *
 * KEY INSIGHT FROM CONSOLE LOGS:
 * Workday renders Work Experience forms INLINE (not in [role="dialog"]).
 * Field IDs follow the pattern "workExperience-{hash}--{fieldName}".
 * The generic fill engine handles these fields automatically IF labels are
 * extracted (fixed in dom.ts Strategy 7).  This handler's job is:
 *   1. Save the already-filled first entry (generic fill filled its fields)
 *   2. Open + fill + save additional entries if profile has more than one
 *   3. Open + fill + save all Education entries (generic fill won't touch these)
 *   4. Fill the Skills tag input
 */

import type { UserProfile } from './profile';
import { setReactInputValue } from './react-input';
import { showWarning } from '../ui/notification';

// ── Workday detection ────────────────────────────────────────────────────────

export function isWorkdayPage(): boolean {
  const h = window.location.hostname;
  return (
    h.includes('workday.com') ||
    h.includes('myworkdayjobs.com') ||
    !!document.querySelector('[data-automation-id="progressBar"], [data-automation-id="stepProgress"]')
  );
}

// ── Step detection ───────────────────────────────────────────────────────────

export type WorkdayStep =
  | 'My Information'
  | 'My Experience'
  | 'Application Questions'
  | 'Voluntary Disclosures'
  | 'Self Identify'
  | 'Review'
  | 'Unknown';

export function detectWorkdayStep(): WorkdayStep {
  // Mirror extractJobMetadata()'s approach: filter for VISIBLE elements only.
  // document.querySelector('h1, h2') returns the first in DOM order which can
  // be a hidden h1 (company logo area, etc.), causing false "Unknown" results.
  const headings = Array.from(
    document.querySelectorAll(
      '[data-automation-id="headingText"], ' +
      '[data-automation-id="applicationPageTitle"], ' +
      'h1, h2, h3'
    )
  ).filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  for (const el of headings) {
    const text = el.textContent?.trim() ?? '';
    if (/my information/i.test(text)) return 'My Information';
    if (/my experience/i.test(text)) return 'My Experience';
    if (/application questions/i.test(text)) return 'Application Questions';
    if (/voluntary disclosure/i.test(text)) return 'Voluntary Disclosures';
    if (/self.?identify/i.test(text)) return 'Self Identify';
    if (/^review$/i.test(text)) return 'Review';
  }

  // Fallback: active progress-bar step tab
  const activeStep = document.querySelector(
    '[data-automation-id*="progressBarStep"][aria-current="true"], ' +
    '[role="tab"][aria-selected="true"]'
  );
  if (activeStep) {
    const text = activeStep.textContent?.trim() ?? '';
    if (/my information/i.test(text)) return 'My Information';
    if (/my experience/i.test(text)) return 'My Experience';
    if (/application questions/i.test(text)) return 'Application Questions';
    if (/voluntary disclosure/i.test(text)) return 'Voluntary Disclosures';
    if (/self.?identify/i.test(text)) return 'Self Identify';
    if (/^review$/i.test(text)) return 'Review';
  }

  return 'Unknown';
}

// ── Timing utilities ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForSelector(
  selector: string,
  timeoutMs = 5000,
  root: ParentNode = document
): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = root.querySelector(selector);
    if (el) return el;
    await sleep(150);
  }
  return null;
}

/** Wait until a selector is ABSENT (i.e. element has been removed from DOM). */
async function waitForAbsence(selector: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!document.querySelector(selector)) return;
    await sleep(200);
  }
}

/**
 * Wait for a Workday inline form to open by polling for a visible
 * [data-automation-id="formField"] whose label matches labelPattern.
 * This is more robust than waiting for ID-prefixed fields since Workday's
 * Education IDs may use a different prefix across instances.
 */
async function waitForInlineFormWithLabel(
  labelPattern: RegExp,
  timeoutMs = 5000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (checkFormFieldLabel(labelPattern)) return true;
    await sleep(200);
  }
  return false;
}

function checkFormFieldLabel(labelPattern: RegExp): boolean {
  const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]'));
  for (const ff of ffs) {
    const input = ff.querySelector(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea'
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) continue;
    const label =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      (input.labels?.[0]?.textContent?.trim()) ??
      input.getAttribute('aria-label') ?? '';
    if (labelPattern.test(label)) return true;
  }
  return false;
}

/**
 * Check if a Workday inline form is currently open by looking for a visible
 * formField whose label matches the given pattern.
 * Label-based detection is more reliable than ID-prefix matching.
 */
function isInlineFormOpenByLabel(labelPattern: RegExp): boolean {
  return checkFormFieldLabel(labelPattern);
}

/**
 * Find the skills tag input by looking for a formField whose label contains "skill".
 * This handles Workday's "Type to Add Skills" label pattern without relying on
 * data-automation-id attributes on the input itself.
 */
function findSkillsInput(): HTMLInputElement | null {
  const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]'));
  for (const ff of ffs) {
    const label =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      ff.querySelector('label')?.textContent?.trim() ?? '';
    if (/skill/i.test(label)) {
      const input = ff.querySelector(
        'input[type="text"], input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"])'
      ) as HTMLInputElement | null;
      if (input) return input;
    }
  }

  // Method 2: placeholder or data-automation-id attribute fallbacks
  return (
    document.querySelector('[placeholder*="skill" i]') ??
    document.querySelector('[data-automation-id*="skill"] input') ??
    null
  ) as HTMLInputElement | null;
}

/**
 * Find the container element for an Education inline form.
 * Workday's Education IDs may not start with "education-" in all instances,
 * so we fall back to a label-based container search.
 */
function findEducationFormContainer(): Element | null {
  // ID-based (works when Workday uses "education-{hash}--" prefix)
  const byId = findInlineFormContainer('education', true);
  if (byId) return byId;

  // Label-based: find the School/Degree formField and walk up to the section
  const ffs = Array.from(document.querySelectorAll('[data-automation-id^="formField"]'));
  const anchor = ffs.find(ff => {
    const label =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      ff.querySelector('label')?.textContent?.trim() ?? '';
    return /school|university|college|institution|degree/i.test(label);
  });
  if (!anchor) return null;

  let el: Element | null = anchor;
  while (el && el !== document.body) {
    if (el.querySelectorAll('[data-automation-id^="formField"]').length >= 2) {
      return el.parentElement ?? el;
    }
    el = el.parentElement;
  }
  return anchor.parentElement;
}

// ── Inline form detection ────────────────────────────────────────────────────

/**
 * Workday's inline entry forms (Work Experience, Education) contain input
 * fields whose IDs follow a consistent pattern like:
 *   workExperience-{hash}--jobTitle
 *   education-{hash}--school
 *
 * This function finds the closest ancestor that wraps ALL the inline form
 * fields for a given prefix (e.g. "workExperience").
 */
function findInlineFormContainer(idPrefix: string, preferLast = false): Element | null {
  const allFields = Array.from(document.querySelectorAll(`[id*="${idPrefix}-"][id*="--"]`));
  if (!allFields.length) return null;

  // Extract unique entry hashes (e.g., "workExperience-11", "workExperience-12")
  // Each Workday inline form entry uses a unique hash in its field IDs.
  const hashes = new Set<string>();
  for (const f of allFields) {
    const match = f.id.match(new RegExp(`(${idPrefix}-[^-]+)--`));
    if (match) hashes.add(match[1]);
  }
  const hashArr = Array.from(hashes);
  const targetHash = preferLast ? hashArr[hashArr.length - 1] : hashArr[0];

  if (targetHash) {
    // Scope to fields belonging to this specific entry only
    const scopedFields = allFields.filter(f => f.id.startsWith(targetHash + '--'));
    if (scopedFields.length) {
      const sentinel = scopedFields[0];
      let el: Element | null = sentinel;
      while (el && el !== document.body) {
        const ownFields = el.querySelectorAll(`[id^="${targetHash}--"]`).length;
        if (ownFields >= 2) return el.parentElement ?? el;
        el = el.parentElement;
      }
      return sentinel.parentElement;
    }
  }

  // Fallback: original behavior
  const sentinel = preferLast ? allFields[allFields.length - 1] : allFields[0];
  let el: Element | null = sentinel;
  while (el && el !== document.body) {
    if (el.querySelectorAll(`[id*="${idPrefix}-"][id*="--"]`).length >= 2) {
      return el.parentElement ?? el;
    }
    el = el.parentElement;
  }
  return sentinel.parentElement;
}

/** True when at least one inline form field for the prefix is in the DOM. */
function isInlineFormOpen(idPrefix: string): boolean {
  return !!document.querySelector(`[id*="${idPrefix}-"][id*="--"]`);
}

// ── Save button helpers ───────────────────────────────────────────────────────

/**
 * Click the Save button for an open inline entry form.
 *
 * Workday places the Save button in a footer section that is often OUTSIDE
 * the formField container returned by findInlineFormContainer(), so we always
 * fall back to a document-wide visible-button search.
 */
async function saveInlineForm(container: Element | null): Promise<boolean> {
  // 1. Try the container scope first (fast path)
  if (container) {
    const inContainer =
      (container.querySelector('[data-automation-id="saveButton"]') as HTMLElement | null) ??
      (Array.from(container.querySelectorAll('button')).find(
        b => /^save$/i.test(b.textContent?.trim() ?? '') && !(b as HTMLButtonElement).disabled
      ) as HTMLElement | null);
    if (inContainer) {
      inContainer.click();
      await sleep(800);
      return true;
    }
  }

  // 2. Document-wide fallback — find the visible Save button anywhere on the page
  const docSaveBtn =
    (document.querySelector('[data-automation-id="saveButton"]:not([disabled])') as HTMLElement | null) ??
    (Array.from(document.querySelectorAll('button')).find(b => {
      const label = b.textContent?.trim() ?? '';
      const rect = b.getBoundingClientRect();
      return /^save$/i.test(label) &&
             !(b as HTMLButtonElement).disabled &&
             rect.width > 0 && rect.height > 0;
    }) as HTMLElement | null);

  if (docSaveBtn) {
    docSaveBtn.click();
    await sleep(800);
    return true;
  }

  console.warn('[Workday] Save button not found');
  return false;
}

// ── "Add" button helpers ─────────────────────────────────────────────────────

/**
 * Click an "Add" button in a Workday section identified by its heading text.
 *
 * Workday wraps each section (Work Experience, Education, etc.) in a container
 * whose visible heading matches the section name.  We scan outward from each
 * "Add" button until we find a heading that matches the pattern.
 */
async function clickAddInSection(sectionHeadingPattern: RegExp): Promise<boolean> {
  const allAddBtns = Array.from(document.querySelectorAll(
    'button, [role="button"]'
  )).filter(b => {
    const text = b.textContent?.trim() ?? '';
    const aria = b.getAttribute('aria-label') ?? '';
    const autoId = b.getAttribute('data-automation-id') ?? '';
    return /^add(\s+another)?$/i.test(text) ||
           /\badd\b/i.test(aria) ||
           /\badd\b/i.test(autoId);
  }) as HTMLElement[];

  for (const btn of allAddBtns) {
    // Find the nearest preceding section heading by walking backwards through
    // siblings and then up. This prevents matching a heading from a different
    // section (e.g., "Education" heading when looking at a WE "Add Another" button).
    const nearestHeading = findNearestPrecedingHeading(btn);
    if (nearestHeading && sectionHeadingPattern.test(nearestHeading)) {
      btn.click();
      await sleep(900);
      return true;
    }
  }
  return false;
}

function findNearestPrecedingHeading(el: HTMLElement): string {
  let node: Node | null = el;
  for (let depth = 0; depth < 10 && node; depth++) {
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement) {
        if (/^h[1-6]$/i.test(sibling.tagName)) {
          return sibling.textContent?.trim() ?? '';
        }
        // Check last heading child if it's a wrapper div
        const innerHeading = sibling.querySelector('h1, h2, h3, h4, h5, h6');
        if (innerHeading) return innerHeading.textContent?.trim() ?? '';
      }
      sibling = sibling.previousSibling;
    }
    node = (node as HTMLElement).parentElement;
  }
  return '';
}

// ── Field fill helpers ────────────────────────────────────────────────────────

/**
 * Resolve the visible label text for any input element.
 *
 * Workday uses two distinct labelling strategies depending on which part of the
 * page we are on:
 *
 *  • Main-page fields (My Information, Application Questions, …):
 *      [data-automation-id="formField"] → [data-automation-id="label"]
 *
 *  • Inline entry forms (Work Experience, Education, …):
 *      Native <label for="workExperience-9--jobTitle"> HTML association
 *      (exposed via input.labels[0])
 *
 * We check every available signal so fillFieldByLabel works for both.
 */
function getLabelForInput(input: HTMLInputElement | HTMLTextAreaElement): string {
  // 1. Native HTML label association (fastest, most reliable for inline forms)
  const nativeLabels = (input as HTMLInputElement).labels;
  if (nativeLabels?.length) {
    return nativeLabels[0].textContent?.trim() ?? '';
  }

  // 2. Explicit <label for="id"> when .labels isn't populated (older browsers)
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent?.trim() ?? '';
  }

  // 3. Workday main-page style: ancestor formField → data-automation-id="label"
  const ff = input.closest('[data-automation-id="formField"]');
  const wdLabel = ff?.querySelector('[data-automation-id="label"]')?.textContent?.trim();
  if (wdLabel) return wdLabel;

  // 4. ARIA attributes
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    return document.getElementById(labelledBy)?.textContent?.trim() ?? '';
  }

  return '';
}

/**
 * Type into an input using character-by-character keyboard events to trigger
 * Workday's autocomplete/API search. Unlike setReactInputValue (which sets the
 * value in bulk and only dispatches a final input event), this fires keydown/
 * input/keyup per character, which Workday's debounced search handlers require.
 */
async function typeForAutocomplete(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  input.focus();
  // Clear existing value
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set ?? Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value'
  )?.set;
  if (nativeSetter) nativeSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(50);

  for (const char of value) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    const current = input.value + char;
    if (nativeSetter) nativeSetter.call(input, current);
    const tracker = (input as any)._valueTracker;
    if (tracker) tracker.setValue(current.slice(0, -1));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await sleep(30);
  }
}

/**
 * Fill a spinbutton input using character-by-character keyboard events.
 *
 * Workday's spinbutton React components ignore bulk value changes via native
 * property setters. They only recognise values entered through actual keyboard
 * interaction (focus → type digits → blur). Puppeteer's `keyboard.type()` works
 * because it dispatches CDP-level events; from a content script we must emulate
 * the same sequence with synthetic DOM events + native setter for each keystroke.
 */
async function fillSpinbutton(
  input: HTMLInputElement,
  value: string
): Promise<void> {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set;

  input.focus();
  input.select();
  await sleep(50);

  // Set the full value at once via native setter — avoids the stale-read bug
  // where React re-renders between character typings and `input.value` returns
  // an unexpected intermediate value.
  if (nativeSetter) nativeSetter.call(input, value);
  const tracker = (input as any)._valueTracker;
  if (tracker) tracker.setValue('');
  await sleep(30);

  // Dispatch keyboard events for each digit to trigger Workday's keydown
  // handlers (which update the React component's internal state).
  for (const char of value) {
    const keyCode = char.charCodeAt(0);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: char, code: `Digit${char}`, keyCode, which: keyCode, bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keypress', {
      key: char, code: `Digit${char}`, keyCode, charCode: keyCode, which: keyCode, bubbles: true, cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent('keyup', {
      key: char, code: `Digit${char}`, keyCode, which: keyCode, bubbles: true
    }));
    await sleep(30);
  }

  // Commit: input → change → blur
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.blur();
  await sleep(100);
}

/**
 * Fill a single input using native setter (bulk) with a fallback to re-querying
 * the element by ID after React re-renders.
 *
 * Human-like typing is incompatible with Workday's React inline forms: each
 * keystroke triggers a state update → re-render → element disconnect. Instead,
 * set the full value at once via the native property descriptor setter.
 */
async function fillInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  // For spinbutton inputs, delegate to the keyboard-based filler
  if (input.role === 'spinbutton' || input.getAttribute('role') === 'spinbutton') {
    await fillSpinbutton(input as HTMLInputElement, value);
    return;
  }

  const elementId = input.id;
  let ok = setReactInputValue(input, value);
  if (!ok && elementId) {
    await sleep(200);
    const fresh = document.getElementById(elementId) as HTMLInputElement | HTMLTextAreaElement | null;
    if (fresh) {
      ok = setReactInputValue(fresh, value);
    }
  }
  if (!ok) {
    console.warn(`[Workday] fillInput failed for "${elementId || '(no id)'}"`);
  }
}

/**
 * Fill a text/textarea field by matching its label text.
 * Scoped to `container` to avoid touching fields from other sections.
 *
 * Strategy A — Workday main-page style ([data-automation-id="formField"])
 * Strategy B — Workday inline-form style (native <label for="…"> / input.labels)
 */
async function fillFieldByLabel(
  container: ParentNode,
  labelPattern: RegExp,
  value: string
): Promise<boolean> {
  if (!value) return false;

  // ── Strategy A: data-automation-id formField wrappers ────────────────────
  const formFields = Array.from(
    container.querySelectorAll('[data-automation-id="formField"]')
  ) as Element[];

  for (const ff of formFields) {
    const labelEl = ff.querySelector('[data-automation-id="label"]');
    if (!labelEl) continue;
    const labelText = labelEl.textContent?.trim() ?? '';
    if (!labelPattern.test(labelText)) continue;

    const input = ff.querySelector(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea'
    ) as HTMLInputElement | HTMLTextAreaElement | null;

    if (input) {
      await fillInput(input, value);
      return true;
    }

    // Workday combobox / typeahead
    const combo = ff.querySelector('[role="combobox"]') as HTMLElement | null;
    if (combo) {
      combo.focus();
      combo.click();
      await sleep(400);
      const textInput = ff.querySelector('input') as HTMLInputElement | null;
      if (textInput) {
        setReactInputValue(textInput, value);
        await sleep(300);
        const option = await waitForSelector('[role="option"]', 2000, document);
        if (option) (option as HTMLElement).click();
      }
      return true;
    }
  }

  // ── Strategy B: native label association (inline Work Experience / Education) ──
  const inputs = Array.from(
    container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea'
    )
  ) as (HTMLInputElement | HTMLTextAreaElement)[];

  wdLog(`[Workday] Strategy B: ${inputs.length} inputs, pattern=${labelPattern}`);
  for (const input of inputs) {
    const labelText = getLabelForInput(input);
    if (!labelText || !labelPattern.test(labelText)) continue;

    wdLog(`[Workday] Filling "${labelText}" (id=${input.id}) with "${value.substring(0, 30)}"`);
    await fillInput(input, value);
    wdLog(`[Workday] After fillInput: value="${input.value}"`);
    return true;
  }

  return false;
}

async function tickCheckboxByLabel(
  container: ParentNode,
  labelPattern: RegExp,
  checked: boolean
): Promise<boolean> {
  // Search in container first, then fall back to document-wide search
  let checkboxes = Array.from(
    container.querySelectorAll('input[type="checkbox"]')
  ) as HTMLInputElement[];
  if (!checkboxes.length) {
    checkboxes = Array.from(
      document.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[];
  }

  for (const cb of checkboxes) {
    const labelText =
      document.querySelector(`label[for="${CSS.escape(cb.id ?? '')}"]`)?.textContent?.trim() ??
      cb.getAttribute('aria-label') ??
      cb.closest('label')?.textContent?.trim() ??
      cb.parentElement?.textContent?.trim() ?? '';
    if (!labelPattern.test(labelText)) continue;
    if (cb.checked !== checked) {
      // Workday checkboxes may be React-controlled; use _valueTracker invalidation
      const tracker = (cb as any)._valueTracker;
      if (tracker) tracker.setValue(String(!checked));
      cb.click();
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      cb.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(200);
    wdLog(`[Workday] Checkbox "${labelText}" → ${checked ? 'checked' : 'unchecked'}`);
    return true;
  }
  wdLog(`[Workday] Checkbox matching /${labelPattern.source}/ not found (${checkboxes.length} checkboxes checked)`);
  return false;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseMonthYear(dateStr: string): { month: string; monthNum: string; year: string } | null {
  if (!dateStr) return null;
  // ISO: "2022-04"
  const iso = dateStr.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const num = parseInt(iso[2], 10);
    return { month: MONTH_NAMES[num - 1] ?? iso[2], monthNum: String(num), year: iso[1] };
  }
  // Slash: "04/2022"
  const slash = dateStr.match(/^(\d{1,2})\/(\d{4})/);
  if (slash) {
    const num = parseInt(slash[1], 10);
    return { month: MONTH_NAMES[num - 1] ?? slash[1], monthNum: String(num), year: slash[2] };
  }
  // Year only: "2022"
  const yr = dateStr.match(/^(\d{4})$/);
  if (yr) return { month: '', monthNum: '', year: yr[1] };
  return null;
}

/**
 * Fill Workday's split date widget (separate month + year inputs).
 * Workday nests these inside a field group whose label matches the date role
 * (e.g. "Start Date", "End Date").  We scope to the container to avoid
 * touching sibling date widgets.
 */
async function fillDateWidget(
  container: ParentNode,
  dateLabelPattern: RegExp,
  month: string,
  year: string,
  monthNum?: string
): Promise<void> {
  // Strategy A: formField containers (exact or starts-with)
  const formFields = Array.from(
    container.querySelectorAll('[data-automation-id^="formField"]')
  ) as Element[];

  for (const ff of formFields) {
    const lbl =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      ff.querySelector('label')?.textContent?.trim() ?? '';
    if (!dateLabelPattern.test(lbl)) continue;

    // Month: use data-automation-id selectors first (stable), then role-based fallback
    const monthEl = (
      ff.querySelector('input[data-automation-id="dateSectionMonth-input"]') ??
      ff.querySelector('input[role="spinbutton"][aria-label*="Month" i]') ??
      ff.querySelector('[data-automation-id*="month"] input, input[placeholder*="MM"], input[aria-label*="Month" i]')
    ) as HTMLInputElement | null;
    if (monthEl && (monthNum || month)) {
      await fillInput(monthEl, monthNum || month);
    }

    // Year: use data-automation-id selectors first (stable), then role-based fallback
    const yearEl = (
      ff.querySelector('input[data-automation-id="dateSectionYear-input"]') ??
      ff.querySelector('input[role="spinbutton"][aria-label*="Year" i]') ??
      ff.querySelector('[data-automation-id*="year"] input, input[placeholder*="YYYY"], input[aria-label*="Year" i]')
    ) as HTMLInputElement | null;
    if (yearEl && year) await fillInput(yearEl, year);

    return;
  }

  // Strategy B: fallback by partial ID match
  const el = container as Element;
  const monthInput = el.querySelector(
    `[id*="startDate-month"], [id*="fromDate-month"], [aria-label*="Month" i]`
  ) as HTMLInputElement | null;
  if (monthInput && (monthNum || month)) await fillInput(monthInput, monthNum || month);

  const yearInput = el.querySelector(
    `[id*="startDate-year"], [id*="fromDate-year"], [aria-label*="Year" i]`
  ) as HTMLInputElement | null;
  if (yearInput && year) await fillInput(yearInput, year);
}

// ── Work Experience inline form fill ─────────────────────────────────────────

async function fillOpenWorkExperienceForm(
  entry: UserProfile['work'][number]
): Promise<boolean> {
  const container = findInlineFormContainer('workExperience', true);
  if (!container) {
    wdLog('[Workday] Could not find open Work Experience form container');
    return false;
  }
  const scope = container as ParentNode;

  wdLog(`[Workday] Filling WE form. title="${entry.title}", company="${entry.company}"`);
  if (entry.title?.trim()) {
    const ok = await fillFieldByLabel(scope, /job title|position|title/i, entry.title);
    wdLog(`[Workday] fillFieldByLabel(job title) => ${ok}`);
  }
  if (entry.company?.trim()) {
    const ok = await fillFieldByLabel(scope, /company|employer|organization/i, entry.company);
    wdLog(`[Workday] fillFieldByLabel(company) => ${ok}`);
  }
  // Location intentionally left blank — profile city may differ from job location

  const start = parseMonthYear(entry.startDate);
  if (start?.month) {
    await fillDateWidget(scope, /start date|from/i, start.month, start.year, start.monthNum);
  } else if (start?.year) {
    await fillFieldByLabel(scope, /start.*year/i, start.year);
  }

  if (entry.current) {
    await tickCheckboxByLabel(scope, /currently work|present|current/i, true);
  } else {
    const end = parseMonthYear(entry.endDate);
    if (end?.month) {
      await fillDateWidget(scope, /end date|to\b/i, end.month, end.year, end.monthNum);
    } else if (end?.year) {
      await fillFieldByLabel(scope, /end.*year/i, end.year);
    }
  }

  if (entry.description) {
    await fillFieldByLabel(scope, /description|responsibilit|summary|details/i, entry.description);
  }

  return true;
}

// ── Autocomplete-aware field fill (for Field of Study, etc.) ─────────────────

/**
 * Fill a Workday autocomplete/typeahead field. Tries exact match first,
 * then tokenized partial match, then falls back to selecting the first option
 * whose text contains any token from the target value.
 */
async function fillFieldByAutocompleteLabel(
  container: ParentNode,
  labelPattern: RegExp,
  value: string
): Promise<boolean> {
  if (!value?.trim()) return false;

  const formFields = Array.from(
    container.querySelectorAll('[data-automation-id^="formField"]')
  ) as Element[];
  for (const ff of formFields) {
    const labelText =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      ff.querySelector('label')?.textContent?.trim() ?? '';
    if (!labelText || !labelPattern.test(labelText)) continue;

    const combo = ff.querySelector('[role="combobox"]') as HTMLElement | null;
    const textInput = (combo
      ? ff.querySelector('input')
      : ff.querySelector('input:not([type="hidden"])')
    ) as HTMLInputElement | null;
    if (!textInput) { wdLog(`[Workday] Autocomplete "${labelText}" — no input found`); continue; }

    wdLog(`[Workday] Autocomplete "${labelText}" — typing "${value}" (combo=${!!combo})`);
    await typeForAutocomplete(textInput, value);

    // Poll for autocomplete options (Workday can take 1-2s for API-backed searches)
    const getOwnedOptions = (): HTMLElement[] => {
      const ownedId = combo?.getAttribute('aria-controls') ?? combo?.getAttribute('aria-owns')
        ?? textInput.getAttribute('aria-controls') ?? textInput.getAttribute('aria-owns');
      if (ownedId) {
        const lb = document.getElementById(ownedId);
        if (lb) return Array.from(lb.querySelectorAll('[role="option"]')) as HTMLElement[];
      }
      const listboxes = Array.from(document.querySelectorAll('[role="listbox"]'));
      for (let i = listboxes.length - 1; i >= 0; i--) {
        const opts = Array.from(listboxes[i].querySelectorAll('[role="option"]')) as HTMLElement[];
        if (opts.length > 0 && !/no items/i.test(opts[0].textContent?.trim() ?? '')) return opts;
      }
      return [];
    };

    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      await sleep(400);
      options = getOwnedOptions();
      const real = options.filter(o => !/no items/i.test(o.textContent?.trim() ?? ''));
      if (real.length > 0) { options = real; break; }
    }

    if (options.length === 0) {
      const token = value.split(/\s+/)[0];
      wdLog(`[Workday] Autocomplete "${labelText}" — retrying with "${token}"`);
      await typeForAutocomplete(textInput, token);
      for (let attempt = 0; attempt < 4; attempt++) {
        await sleep(400);
        options = getOwnedOptions().filter(o => !/no items/i.test(o.textContent?.trim() ?? ''));
        if (options.length > 0) break;
      }
    }

    const realOptions = options;
    wdLog(`[Workday] Autocomplete "${labelText}" — ${realOptions.length} options found`);
    if (realOptions.length > 0) {
      const valueLower = value.toLowerCase();
      const tokens = valueLower.split(/\s+/).filter(t => t.length > 2);

      let best = realOptions.find(o => o.textContent?.trim().toLowerCase().includes(valueLower));
      if (!best) {
        best = realOptions.find(o => {
          const oText = o.textContent?.trim().toLowerCase() ?? '';
          return tokens.every(t => oText.includes(t));
        });
      }
      if (!best) {
        best = realOptions.find(o => {
          const oText = o.textContent?.trim().toLowerCase() ?? '';
          return tokens.some(t => oText.includes(t));
        });
      }
      if (!best) best = realOptions[0];

      if (best) {
        best.click();
        await sleep(300);
        wdLog(`[Workday] Autocomplete "${labelText}" → "${best.textContent?.trim()}"`);
        return true;
      }
    }

    await fillInput(textInput, value);
    return true;
  }

  return fillFieldByLabel(container, labelPattern, value);
}

// ── Education inline form fill ────────────────────────────────────────────────

async function fillOpenEducationForm(
  entry: UserProfile['education'][number]
): Promise<boolean> {
  const container = findEducationFormContainer();
  if (!container) {
    wdLog('[Workday] Could not find open Education form container');
    return false;
  }
  const scope = container as ParentNode;

  wdLog(`[Workday] Filling Education: school="${entry.school}", degree="${entry.degree}", field="${entry.field}", gradYear="${entry.graduationYear}"`);

  if (entry.school?.trim()) {
    await fillFieldByAutocompleteLabel(scope, /school|university|college|institution/i, entry.school);
  }

  // Degree is typically a dropdown button on Workday
  if (entry.degree?.trim()) {
    const filled = await fillDropdownByLabel(scope, /^degree/i, entry.degree);
    if (!filled) await fillFieldByLabel(scope, /degree|qualification/i, entry.degree);
  }

  if (entry.field?.trim()) {
    await fillFieldByAutocompleteLabel(scope, /field of study|major|discipline/i, entry.field);
  }

  if (entry.graduationYear) {
    // Use stable data-automation-id selectors matching the Puppeteer automator pattern
    const lastYearInput = (scope as Element).querySelector(
      '[data-automation-id="formField-lastYearAttended"] input'
    ) as HTMLInputElement | null;
    if (lastYearInput) {
      await fillInput(lastYearInput, entry.graduationYear);
    } else {
      // Fallback: find year spinbuttons — the last one is "To (Actual or Expected)"
      const toYearInputs = Array.from(
        (scope as Element).querySelectorAll('input[role="spinbutton"][aria-label*="Year" i]')
      ) as HTMLInputElement[];
      const toYear = toYearInputs[toYearInputs.length - 1];
      if (toYear) {
        await fillInput(toYear, entry.graduationYear);
      } else {
        await fillFieldByLabel(scope, /graduation.*year|end.*year|year.*graduat/i, entry.graduationYear);
      }
    }
  }

  // Education start year (From) — derive from graduation year if not stored
  const startYear = (entry as any).startYear ?? (
    entry.graduationYear ? String(Number(entry.graduationYear) - 4) : null
  );
  if (startYear) {
    const firstYearInput = (scope as Element).querySelector(
      '[data-automation-id="formField-firstYearAttended"] input'
    ) as HTMLInputElement | null;
    if (firstYearInput) {
      await fillInput(firstYearInput, startYear);
    } else {
      const yearSpinbuttons = Array.from(
        (scope as Element).querySelectorAll('input[role="spinbutton"][aria-label*="Year" i]')
      ) as HTMLInputElement[];
      if (yearSpinbuttons.length >= 2) {
        await fillInput(yearSpinbuttons[0], startYear);
      }
    }
  }

  return true;
}

async function fillDropdownByLabel(
  container: ParentNode,
  labelPattern: RegExp,
  value: string
): Promise<boolean> {
  const formFields = Array.from(
    container.querySelectorAll('[data-automation-id^="formField"]')
  ) as Element[];

  for (const ff of formFields) {
    const lbl =
      ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ??
      ff.querySelector('label')?.textContent?.trim() ?? '';
    if (!labelPattern.test(lbl)) continue;

    const dropBtn = ff.querySelector('button[aria-haspopup="listbox"]') as HTMLElement | null;
    if (!dropBtn) continue;

    dropBtn.click();
    await sleep(300);

    // Poll for aria-controls (Workday sets it asynchronously after click)
    let controlsId: string | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      controlsId = dropBtn.getAttribute('aria-controls');
      if (controlsId) break;
      await sleep(200);
    }

    const listbox = controlsId
      ? document.getElementById(controlsId)
      : ff.querySelector('[role="listbox"]');
    if (!listbox) {
      wdLog(`[Workday] Dropdown "${lbl}" — no listbox found (aria-controls=${controlsId})`);
      dropBtn.click(); await sleep(200); continue;
    }

    const options = Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[];
    const valueLower = value.toLowerCase();
    const tokens = valueLower.split(/\s+/).filter(t => t.length > 1);

    wdLog(`[Workday] Dropdown "${lbl}" — searching for "${value}" among ${options.length} options`);

    // 1) Exact substring match
    let match = options.find(o =>
      o.textContent?.trim().toLowerCase().includes(valueLower)
    );
    // 2) ALL significant tokens must match
    if (!match) {
      match = options.find(o => {
        const oText = o.textContent?.trim().toLowerCase() ?? '';
        return tokens.every(t => oText.includes(t));
      });
    }
    // 3) ANY significant token with length > 2 (last resort)
    if (!match) {
      match = options.find(o => {
        const oText = o.textContent?.trim().toLowerCase() ?? '';
        return tokens.filter(t => t.length > 2).some(t => oText.includes(t));
      });
    }

    if (match && !/select one/i.test(match.textContent?.trim() ?? '')) {
      match.click();
      await sleep(300);
      wdLog(`[Workday] Dropdown "${lbl}" set to "${match.textContent?.trim()}"`);
      return true;
    }

    wdLog(`[Workday] Dropdown "${lbl}" — no match for "${value}"`);
    dropBtn.click();
    await sleep(200);
  }
  return false;
}

// ── Skills tag-input ─────────────────────────────────────────────────────────

async function fillSkillsTagInput(skills: string[]): Promise<void> {
  if (!skills.length) return;

  wdLog(`[Workday] Filling ${skills.length} skill(s) via tag input`);

  for (const skill of skills) {
    const input = findSkillsInput();
    if (!input) {
      wdLog('[Workday] Skills tag input not found — stopping');
      break;
    }

    // Dismiss any lingering autocomplete by blurring, then re-focusing
    input.blur();
    await sleep(200);
    input.focus();
    await sleep(100);

    await typeForAutocomplete(input, skill);
    await sleep(1200);

    // Poll for options (Workday's API-backed autocomplete can be slow)
    let options: HTMLElement[] = [];
    for (let attempt = 0; attempt < 3 && options.length === 0; attempt++) {
      const ownedId = input.getAttribute('aria-controls') ?? input.getAttribute('aria-owns');
      let listbox: Element | null = ownedId ? document.getElementById(ownedId) : null;
      if (!listbox) {
        const allListboxes = Array.from(document.querySelectorAll('[role="listbox"]'));
        listbox = allListboxes[allListboxes.length - 1] ?? null;
      }
      options = listbox
        ? (Array.from(listbox.querySelectorAll('[role="option"]')) as HTMLElement[])
          .filter(o => !/no items/i.test(o.textContent?.trim() ?? ''))
        : [];
      if (options.length === 0) await sleep(500);
    }

    const skillLower = skill.toLowerCase();
    // Strip " not checked" / " checked" suffixes from option text for matching
    const cleanText = (o: HTMLElement) =>
      (o.textContent?.trim() ?? '').replace(/\s*(not\s+)?checked\s*$/i, '').toLowerCase();

    const exactMatch = options.find(o => cleanText(o) === skillLower);
    const containsMatch = options.find(o => cleanText(o).includes(skillLower));
    const startsWithMatch = options.find(o => cleanText(o).startsWith(skillLower));
    const match = exactMatch ?? startsWithMatch ?? containsMatch;

    if (match) {
      const checkbox = match.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (checkbox && !checkbox.checked) {
        checkbox.click();
      } else {
        match.click();
      }
      await sleep(400);
      wdLog(`[Workday] Skill added: "${cleanText(match)}"`);
    } else {
      wdLog(`[Workday] Skill not found in autocomplete: "${skill}" (${options.length} options available)`);
    }

    await sleep(200);
  }

  // Close any lingering skills autocomplete
  const finalInput = findSkillsInput();
  if (finalInput) {
    finalInput.blur();
    setReactInputValue(finalInput, '');
  }
}

// ── "My Experience" orchestration ────────────────────────────────────────────

/** Label patterns that identify an open Work Experience inline form */
const WE_FORM_LABEL = /job title|position/i;
/** Label patterns that identify an open Education inline form */
const EDU_FORM_LABEL = /school|university|college|institution|degree|field of study/i;

function wdLog(msg: string): void {
  console.log(msg);
  const el = document.getElementById('__offlyn_diag') || (() => {
    const d = document.createElement('div');
    d.id = '__offlyn_diag';
    d.style.display = 'none';
    document.body.appendChild(d);
    return d;
  })();
  el.setAttribute('data-log', (el.getAttribute('data-log') || '') + '\n' + msg);
}

async function handleMyExperienceStep(profile: UserProfile): Promise<void> {
  wdLog('[Workday] Handling "My Experience" step');
  wdLog(`[Workday] profile.work entries: ${profile.work?.length ?? 0}`);

  // ── Work Experience ───────────────────────────────────────────────────────
  if (profile.work?.length) {
    const entries = profile.work;
    const firstAlreadyOpen = isInlineFormOpenByLabel(WE_FORM_LABEL);
    wdLog(`[Workday] firstAlreadyOpen=${firstAlreadyOpen}, entries=${entries.length}`);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isFirst = i === 0;
      wdLog(`[Workday] WE entry ${i}: "${entry.title}" at "${entry.company}"`);

      if (!isFirst || !firstAlreadyOpen) {
        wdLog(`[Workday] Clicking Add for WE entry ${i}`);
        const clicked = await clickAddInSection(/work experience/i);
        if (!clicked) {
          wdLog('[Workday] "Add" button not found — stopping');
          break;
        }
        wdLog(`[Workday] Waiting for inline form...`);
        const appeared = await waitForInlineFormWithLabel(WE_FORM_LABEL, 5000);
        if (!appeared) {
          wdLog('[Workday] Inline form did not appear — stopping');
          break;
        }
        wdLog(`[Workday] Inline form appeared`);
      }

      // Fill whatever is open now
      wdLog(`[Workday] Calling fillOpenWorkExperienceForm...`);
      const filled = await fillOpenWorkExperienceForm(entry);
      wdLog(`[Workday] fillOpenWorkExperienceForm => ${filled}`);
      if (filled) {
        const container = findInlineFormContainer('workExperience', true);
        const saved = await saveInlineForm(container);
        if (saved) {
          const stillOpen = await waitForInlineFormWithLabel(WE_FORM_LABEL, 4000);
          wdLog(`[Workday] WE entry ${i} saved. stillOpen=${stillOpen}`);
        } else {
          // Some Workday instances don't have per-entry Save buttons; entries
          // are committed via the main "Save and Continue" button instead.
          wdLog(`[Workday] No Save button for WE entry ${i} — entries may auto-save`);
        }
        await sleep(400);
      }
    }
  }

  // ── Education ────────────────────────────────────────────────────────────
  if (profile.education?.length) {
    const eduAlreadyOpen = isInlineFormOpenByLabel(EDU_FORM_LABEL);
    wdLog(`[Workday] eduAlreadyOpen=${eduAlreadyOpen}, entries=${profile.education.length}`);

    for (let i = 0; i < profile.education.length; i++) {
      const entry = profile.education[i];
      const isFirst = i === 0;

      // Skip "Add" click if the first form is already open
      if (!isFirst || !eduAlreadyOpen) {
        const clicked = await clickAddInSection(/education/i);
        if (!clicked) {
          wdLog('[Workday] "Add" button not found in Education section — stopping');
          break;
        }
        const appeared = await waitForInlineFormWithLabel(EDU_FORM_LABEL, 5000);
        if (!appeared) {
          wdLog('[Workday] Education inline form did not appear after clicking Add');
          break;
        }
      }

      const filled = await fillOpenEducationForm(entry);
      if (filled) {
        const container = findEducationFormContainer();
        const saved = await saveInlineForm(container);
        if (saved) {
          wdLog(`[Workday] Education entry ${i + 1} saved`);
        } else {
          wdLog(`[Workday] No Save button for Education entry ${i + 1} — entries may auto-save`);
        }
        await sleep(400);
      }
    }
  }

  // ── Skills — skipped (flagged for manual input) ──────────────────────────
  // Workday's skills autocomplete is API-backed and frequently returns
  // "No Items" for programmatic input. Skip and let the user fill manually.
  if (profile.skills?.length) {
    wdLog(`[Workday] ⚠ Skipping ${profile.skills.length} skill(s) — please add skills manually`);
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all Workday-specific fill logic that the generic engine cannot handle.
 * Called from content.ts AFTER executeFillPlan has run on visible fields.
 */
export async function runWorkdaySpecialHandlers(profile: UserProfile): Promise<void> {
  if (!isWorkdayPage()) return;

  const step = detectWorkdayStep();
  console.log(`[Workday] Current step: "${step}"`);

  // Steps that require manual input — show notification and stop auto-advancing
  const MANUAL_STEPS = ['Voluntary Disclosures', 'Self Identify'];
  if (MANUAL_STEPS.some(s => step === s)) {
    wdLog(`[Workday] "${step}" requires manual input — skipping autofill`);
    showWarning(
      'Manual Input Needed',
      `Please fill out "${step}" manually, then click Save and Continue.`,
      15000
    );
    return;
  }

  if (step === 'My Experience') {
    await handleMyExperienceStep(profile);
  }

  // Auto-advance: click "Save and Continue" after filling the current step.
  // Skipped for Review step to prevent accidental submission.
  if (step !== 'Review') {
    await clickSaveAndContinue();
  }
}

/**
 * Click Workday's "Save and Continue" / "Next" button to advance to the next step.
 * Uses the stable data-automation-id selector from Workday's DOM.
 */
async function clickSaveAndContinue(): Promise<void> {
  await sleep(500);
  const btn = (
    document.querySelector('button[data-automation-id="bottom-navigation-next-button"]') ??
    Array.from(document.querySelectorAll('button')).find(b =>
      /save and continue|next/i.test(b.textContent?.trim() ?? '')
    )
  ) as HTMLButtonElement | null;

  if (btn) {
    wdLog('[Workday] Clicking "Save and Continue"');
    btn.click();
  } else {
    wdLog('[Workday] "Save and Continue" button not found');
  }
}
