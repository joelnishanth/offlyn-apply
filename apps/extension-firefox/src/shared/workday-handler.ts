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
import { setReactInputValue, fillWithHumanTyping } from './react-input';

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
    const ffs = Array.from(document.querySelectorAll('[data-automation-id="formField"]'));
    for (const ff of ffs) {
      const label = ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ?? '';
      const input = ff.querySelector(
        'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea'
      );
      if (labelPattern.test(label) && input) return true;
    }
    await sleep(200);
  }
  return false;
}

/**
 * Check if a Workday inline form is currently open by looking for a visible
 * formField whose label matches the given pattern.
 * Label-based detection is more reliable than ID-prefix matching.
 */
function isInlineFormOpenByLabel(labelPattern: RegExp): boolean {
  const ffs = Array.from(document.querySelectorAll('[data-automation-id="formField"]'));
  return ffs.some(ff => {
    const label = ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ?? '';
    const input = ff.querySelector(
      'input:not([type="hidden"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]), textarea'
    );
    return labelPattern.test(label) && !!input;
  });
}

/**
 * Find the skills tag input by looking for a formField whose label contains "skill".
 * This handles Workday's "Type to Add Skills" label pattern without relying on
 * data-automation-id attributes on the input itself.
 */
function findSkillsInput(): HTMLInputElement | null {
  // Method 1: formField whose label contains "skill"
  const ffs = Array.from(document.querySelectorAll('[data-automation-id="formField"]'));
  for (const ff of ffs) {
    const label = ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ?? '';
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
  const byId = findInlineFormContainer('education');
  if (byId) return byId;

  // Label-based: find the School/Degree formField and walk up to the section
  const ffs = Array.from(document.querySelectorAll('[data-automation-id="formField"]'));
  const anchor = ffs.find(ff => {
    const label = ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ?? '';
    return /school|university|college|institution|degree/i.test(label);
  });
  if (!anchor) return null;

  let el: Element | null = anchor;
  while (el && el !== document.body) {
    if (el.querySelectorAll('[data-automation-id="formField"]').length >= 2) {
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
function findInlineFormContainer(idPrefix: string): Element | null {
  // A reliable sentinel field (present in every WE form)
  const sentinel = document.querySelector(`[id*="${idPrefix}-"][id*="--"]`);
  if (!sentinel) return null;

  // Walk up until we reach a container that holds >= 2 inline fields
  let el: Element | null = sentinel;
  while (el && el !== document.body) {
    if (el.querySelectorAll(`[id*="${idPrefix}-"][id*="--"]`).length >= 2) {
      // One more level up gives us the section wrapper that also includes
      // the Save button and section heading.
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
  // Broader selector: exact "Add" text, aria-label containing "Add", or data-automation-id containing "add"
  const allAddBtns = Array.from(document.querySelectorAll(
    'button, [role="button"]'
  )).filter(b => {
    const text = b.textContent?.trim() ?? '';
    const aria = b.getAttribute('aria-label') ?? '';
    const autoId = b.getAttribute('data-automation-id') ?? '';
    return /^add$/i.test(text) ||
           /\badd\b/i.test(aria) ||
           /\badd\b/i.test(autoId);
  }) as HTMLElement[];

  for (const btn of allAddBtns) {
    let el: Element | null = btn.parentElement;
    let depth = 0;
    while (el && el !== document.body && depth < 15) {
      const headings = el.querySelectorAll(
        'h2, h3, h4, [class*="title"], [data-automation-id*="title"], [data-automation-id*="heading"], legend'
      );
      for (const h of headings) {
        if (sectionHeadingPattern.test(h.textContent?.trim() ?? '')) {
          btn.click();
          await sleep(900);
          return true;
        }
      }
      if (sectionHeadingPattern.test(el.textContent?.trim() ?? '') &&
          el.querySelectorAll('button').length <= 5) {
        btn.click();
        await sleep(900);
        return true;
      }
      el = el.parentElement;
      depth++;
    }
  }
  return false;
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
 * Fill a single input using human-like typing (preferred, triggers Workday's
 * form-state listeners) with a fallback to the native setter.
 */
async function fillInput(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<void> {
  const ok = await fillWithHumanTyping(input, value);
  if (!ok) {
    // Human typing can fail if React remounts the element; native setter as backstop
    setReactInputValue(input, value);
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

  for (const input of inputs) {
    const labelText = getLabelForInput(input);
    if (!labelText || !labelPattern.test(labelText)) continue;

    console.log(`[Workday] Filling "${labelText}" with "${value.substring(0, 30)}"`);
    await fillInput(input, value);
    return true;
  }

  return false;
}

async function tickCheckboxByLabel(
  container: ParentNode,
  labelPattern: RegExp,
  checked: boolean
): Promise<boolean> {
  const checkboxes = Array.from(
    container.querySelectorAll('input[type="checkbox"]')
  ) as HTMLInputElement[];

  for (const cb of checkboxes) {
    const labelText =
      document.querySelector(`label[for="${CSS.escape(cb.id ?? '')}"]`)?.textContent?.trim() ??
      cb.getAttribute('aria-label') ??
      cb.closest('label')?.textContent?.trim() ??
      cb.parentElement?.textContent?.trim() ?? '';
    if (!labelPattern.test(labelText)) continue;
    if (cb.checked !== checked) cb.click();
    await sleep(100);
    return true;
  }
  return false;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parseMonthYear(dateStr: string): { month: string; year: string } | null {
  if (!dateStr) return null;
  // ISO: "2022-04"
  const iso = dateStr.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const idx = parseInt(iso[2], 10) - 1;
    return { month: MONTH_NAMES[idx] ?? iso[2], year: iso[1] };
  }
  // Slash: "04/2022"
  const slash = dateStr.match(/^(\d{1,2})\/(\d{4})/);
  if (slash) {
    const idx = parseInt(slash[1], 10) - 1;
    return { month: MONTH_NAMES[idx] ?? slash[1], year: slash[2] };
  }
  // Year only: "2022"
  const yr = dateStr.match(/^(\d{4})$/);
  if (yr) return { month: '', year: yr[1] };
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
  year: string
): Promise<void> {
  // Try: look for a formField whose label matches and drill into its month/year inputs
  const formFields = Array.from(
    container.querySelectorAll('[data-automation-id="formField"]')
  ) as Element[];

  for (const ff of formFields) {
    const lbl = ff.querySelector('[data-automation-id="label"]')?.textContent?.trim() ?? '';
    if (!dateLabelPattern.test(lbl)) continue;

    // Month combobox / input
    const monthEl = ff.querySelector(
      '[data-automation-id*="month"] input, input[placeholder*="MM"], input[aria-label*="Month" i]'
    ) as HTMLInputElement | null;
    if (monthEl && month) await fillInput(monthEl, month);

    // Year input
    const yearEl = ff.querySelector(
      '[data-automation-id*="year"] input, input[placeholder*="YYYY"], input[aria-label*="Year" i]'
    ) as HTMLInputElement | null;
    if (yearEl && year) await fillInput(yearEl, year);

    return;
  }

  // Fallback: look for inputs by partial id match within the container scope
  const el = container as Element;

  const monthInput = el.querySelector(
    `[id*="startDate-month"], [id*="fromDate-month"], [aria-label*="Month" i]`
  ) as HTMLInputElement | null;
  if (monthInput && month) await fillInput(monthInput, month);

  const yearInput = el.querySelector(
    `[id*="startDate-year"], [id*="fromDate-year"], [aria-label*="Year" i]`
  ) as HTMLInputElement | null;
  if (yearInput && year) await fillInput(yearInput, year);
}

// ── Work Experience inline form fill ─────────────────────────────────────────

async function fillOpenWorkExperienceForm(
  entry: UserProfile['work'][number]
): Promise<boolean> {
  const container = findInlineFormContainer('workExperience');
  if (!container) {
    console.warn('[Workday] Could not find open Work Experience form container');
    return false;
  }
  const scope = container as ParentNode;

  console.log('[Workday] Filling open Work Experience form');
  if (entry.title?.trim()) await fillFieldByLabel(scope, /job title|position|title/i, entry.title);
  if (entry.company?.trim()) await fillFieldByLabel(scope, /company|employer|organization/i, entry.company);
  // Location intentionally left blank — profile city may differ from job location

  const start = parseMonthYear(entry.startDate);
  if (start?.month) {
    await fillDateWidget(scope, /start date|from/i, start.month, start.year);
  } else if (start?.year) {
    await fillFieldByLabel(scope, /start.*year/i, start.year);
  }

  if (entry.current) {
    await tickCheckboxByLabel(scope, /currently work|present|current/i, true);
  } else {
    const end = parseMonthYear(entry.endDate);
    if (end?.month) {
      await fillDateWidget(scope, /end date|to\b/i, end.month, end.year);
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

async function fillFieldByAutocompleteLabel(
  container: ParentNode,
  labelPattern: RegExp,
  value: string
): Promise<boolean> {
  if (!value?.trim()) return false;

  const formFields = Array.from(container.querySelectorAll('[data-automation-id="formField"]')) as Element[];
  for (const ff of formFields) {
    const labelEl = ff.querySelector('[data-automation-id="label"]');
    if (!labelEl) continue;
    if (!labelPattern.test(labelEl.textContent?.trim() ?? '')) continue;

    const combo = ff.querySelector('[role="combobox"]') as HTMLElement | null;
    const textInput = (combo ? ff.querySelector('input') : ff.querySelector('input:not([type="hidden"])')) as HTMLInputElement | null;
    if (!textInput) continue;

    textInput.focus();
    setReactInputValue(textInput, value);
    await sleep(500);

    let options = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (options.length === 0) {
      const token = value.split(/\s+/)[0];
      setReactInputValue(textInput, token);
      await sleep(500);
    }

    const freshOptions = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (freshOptions.length > 0) {
      const valueLower = value.toLowerCase();
      const tokens = valueLower.split(/\s+/).filter(t => t.length > 2);
      let best = freshOptions.find(o => o.textContent?.trim().toLowerCase().includes(valueLower));
      if (!best) {
        best = freshOptions.find(o => {
          const oText = o.textContent?.trim().toLowerCase() ?? '';
          return tokens.some(t => oText.includes(t));
        });
      }
      if (!best) best = freshOptions[0];
      if (best) {
        best.click();
        await sleep(300);
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
    console.warn('[Workday] Could not find open Education form container');
    return false;
  }
  const scope = container as ParentNode;

  console.log('[Workday] Filling open Education form');
  if (entry.school?.trim()) await fillFieldByLabel(scope, /school|university|college|institution/i, entry.school);
  if (entry.degree?.trim()) await fillFieldByLabel(scope, /degree|qualification/i, entry.degree);
  if (entry.field?.trim()) await fillFieldByAutocompleteLabel(scope, /field of study|major|discipline/i, entry.field);

  if (entry.graduationYear) {
    // Workday may show graduation as a single year field or a date widget
    await fillFieldByLabel(scope, /graduation.*year|end.*year|year.*graduat/i, entry.graduationYear);
    await fillFieldByLabel(scope, /graduation date|end date/i, entry.graduationYear);
  }

  return true;
}

// ── Skills tag-input ─────────────────────────────────────────────────────────

async function fillSkillsTagInput(skills: string[]): Promise<void> {
  if (!skills.length) return;

  const skillInput = findSkillsInput();

  if (!skillInput) {
    console.warn('[Workday] Skills tag input not found — skipping skills fill');
    return;
  }

  console.log(`[Workday] Filling ${skills.length} skill(s) via tag input`);

  for (const skill of skills) {
    skillInput.focus();
    await fillWithHumanTyping(skillInput, skill, { clearFirst: true });
    await sleep(600);

    // Workday shows a suggestions dropdown — click the best matching option
    const options = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
    const match = options.find(o =>
      o.textContent?.trim().toLowerCase().includes(skill.toLowerCase())
    ) ?? options[0] ?? null;

    if (match) {
      match.click();
      await sleep(300);
    } else {
      // No suggestion — press Enter to add the raw skill tag
      skillInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      skillInput.dispatchEvent(new KeyboardEvent('keyup',  { key: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(300);
    }

    // Clear the input for the next skill (native setter is fine here — just clearing)
    setReactInputValue(skillInput, '');
    await sleep(150);
  }
}

// ── "My Experience" orchestration ────────────────────────────────────────────

/** Label patterns that identify an open Work Experience inline form */
const WE_FORM_LABEL = /job title|position/i;
/** Label patterns that identify an open Education inline form */
const EDU_FORM_LABEL = /school|university|college|institution|degree|field of study/i;

async function handleMyExperienceStep(profile: UserProfile): Promise<void> {
  console.log('[Workday] Handling "My Experience" step');

  // ── Work Experience ───────────────────────────────────────────────────────
  if (profile.work?.length) {
    const entries = profile.work;
    const firstAlreadyOpen = isInlineFormOpenByLabel(WE_FORM_LABEL);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isFirst = i === 0;

      if (!isFirst || !firstAlreadyOpen) {
        // Open the inline form by clicking "Add"
        const clicked = await clickAddInSection(/work experience/i);
        if (!clicked) {
          console.warn('[Workday] "Add" button not found in Work Experience section — stopping');
          break;
        }
        const appeared = await waitForInlineFormWithLabel(WE_FORM_LABEL, 5000);
        if (!appeared) {
          console.warn('[Workday] Work Experience inline form did not appear after clicking Add');
          break;
        }
      }

      // Fill whatever is open now
      const filled = await fillOpenWorkExperienceForm(entry);
      if (filled) {
        const container = findInlineFormContainer('workExperience');
        const saved = await saveInlineForm(container);
        if (saved) {
          // Wait for the form to close (Job Title label disappears)
          const closed = !(await waitForInlineFormWithLabel(WE_FORM_LABEL, 4000).then(() => true).catch(() => false));
          console.log(`[Workday] Work Experience entry ${i + 1} ${closed ? 'saved' : 'save pending'}`);
          await sleep(400);
        } else {
          console.warn('[Workday] Could not save Work Experience entry — skipping remaining entries');
          break;
        }
      }
    }
  }

  // ── Education ────────────────────────────────────────────────────────────
  if (profile.education?.length) {
    for (let i = 0; i < profile.education.length; i++) {
      const entry = profile.education[i];

      const clicked = await clickAddInSection(/education/i);
      if (!clicked) {
        console.warn('[Workday] "Add" button not found in Education section — stopping');
        break;
      }
      // Use label-based wait — more robust than ID-prefix matching
      const appeared = await waitForInlineFormWithLabel(EDU_FORM_LABEL, 5000);
      if (!appeared) {
        console.warn('[Workday] Education inline form did not appear after clicking Add');
        break;
      }

      const filled = await fillOpenEducationForm(entry);
      if (filled) {
        const container = findEducationFormContainer();
        const saved = await saveInlineForm(container);
        if (saved) {
          console.log(`[Workday] Education entry ${i + 1} saved`);
          await sleep(400);
        } else {
          console.warn('[Workday] Could not save Education entry — skipping remaining entries');
          break;
        }
      }
    }
  }

  // ── Skills ───────────────────────────────────────────────────────────────
  if (profile.skills?.length) {
    await fillSkillsTagInput(profile.skills);
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

  if (step === 'My Experience') {
    await handleMyExperienceStep(profile);
  }
  // All other steps (My Information, Application Questions, Voluntary Disclosures,
  // Self Identify, Review) are handled adequately by the generic fill engine
  // now that dom.ts extracts Workday's data-automation-id labels correctly.
}
