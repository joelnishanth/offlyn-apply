/**
 * DOM utilities for extracting job metadata and form schemas
 */

import type { JobMeta, FieldSchema, PageClassification } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Trust / exclusion constants (shared by extractFormSchema and classifyPage)
// ─────────────────────────────────────────────────────────────────────────────

/** Hostnames that unambiguously host a job application form. */
const TRUSTED_ATS_HOSTNAMES = [
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'workable.com',
  'breezy.hr',
  'bamboohr.com',
  'icims.com',
  'ultipro.com',
  'ashbyhq.com',
  'jobvite.com',
  'taleo.net',
  'successfactors.com',
  'jazz.co',
  'fountain.com',
  'recruiting.paylocity.com',
  'applytojob.com',
  'hire.withgoogle.com',
  'jobs.lever.co',
  'jobs.workday.com',
  'app.ashbyhq.com',
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
];

/**
 * Returns true when an iframe src URL belongs to a trusted ATS platform.
 * Exported so content.ts can use the same check for iframe forwarding.
 */
export function isTrustedATSIframe(src: string): boolean {
  if (!src || src === 'about:blank' || src.startsWith('javascript:')) return false;
  try {
    const hostname = new URL(src).hostname.toLowerCase();
    return TRUSTED_ATS_HOSTNAMES.some(ats => hostname === ats || hostname.endsWith('.' + ats));
  } catch {
    return false;
  }
}

/**
 * CSS selectors for containers that must never be scanned for autofill fields.
 * Covers cookie banners, privacy modals, chat widgets, marketing embeds, etc.
 */
const EXCLUDED_CONTAINER_SELECTORS = [
  // OneTrust / cookie consent
  '#onetrust-consent-sdk',
  '#onetrust-banner-sdk',
  '#onetrust-pc-sdk',
  '[id*="onetrust"]',
  '[class*="onetrust"]',
  // Generic cookie / GDPR banners
  '[id*="cookie-banner"]',
  '[id*="cookie-consent"]',
  '[id*="cookie-notice"]',
  '[class*="cookie-banner"]',
  '[class*="cookie-consent"]',
  '[class*="cookie-notice"]',
  '[class*="gdpr"]',
  '[id*="gdpr"]',
  // Privacy preference / CMP panels
  '[class*="privacy-banner"]',
  '[class*="privacy-center"]',
  '[id*="privacy-modal"]',
  '[class*="sp_message"]',
  '[class*="sp-message"]',
  '[id*="sp_message"]',
  '#didomi-host',
  '[class*="didomi"]',
  '#quantcast-choice',
  '[class*="qc-cmp"]',
  // Chat / live-support widgets
  '[id*="intercom"]',
  '[class*="intercom-"]',
  '[id*="drift-widget"]',
  '[class*="drift-"]',
  '#hubspot-messages-iframe-container',
  '[class*="zendesk"]',
  '[id*="zendesk"]',
  '[id*="qualified"]',
  '[class*="crisp-chat"]',
  '[id*="crisp"]',
  '[class*="livechat"]',
  '[class*="freshchat"]',
  '[class*="tawk"]',
  '[id*="chat-widget"]',
  '[class*="chat-widget"]',
  // reCAPTCHA / CAPTCHA
  '[id*="recaptcha"]',
  '[class*="recaptcha"]',
  '[id*="captcha"]',
  '.g-recaptcha',
  // Share / social widgets
  '[class*="sharethis"]',
  '[class*="addthis"]',
  '[class*="social-share"]',
  // Analytics / experimentation
  '[class*="optimizely"]',
  '[id*="optimizely"]',
  // Vendor list / privacy preference manager
  '[class*="vendor-list"]',
  '[id*="vendor-list"]',
  '[class*="iab-vendor"]',
  // Marketing / promotional overlays
  '[class*="promo-banner"]',
  '[class*="announcement-bar"]',
  '[id*="announcement-bar"]',
];

/** Returns true if `el` or any of its ancestors matches an excluded container. */
function isInsideExcludedContainer(el: Element): { excluded: boolean; containerType: string } {
  for (const sel of EXCLUDED_CONTAINER_SELECTORS) {
    if (el.closest(sel)) {
      // Derive a human-readable container type from the selector
      let containerType = 'untrusted_widget';
      if (sel.includes('onetrust') || sel.includes('cookie') || sel.includes('gdpr') ||
          sel.includes('privacy') || sel.includes('sp_message') || sel.includes('didomi') ||
          sel.includes('qc-cmp') || sel.includes('quantcast')) {
        containerType = 'cookie_consent';
      } else if (sel.includes('intercom') || sel.includes('drift') || sel.includes('hubspot-messages') ||
                 sel.includes('zendesk') || sel.includes('qualified') || sel.includes('crisp') ||
                 sel.includes('livechat') || sel.includes('freshchat') || sel.includes('tawk') ||
                 sel.includes('chat-widget')) {
        containerType = 'chat_widget';
      } else if (sel.includes('recaptcha') || sel.includes('captcha')) {
        containerType = 'captcha';
      } else if (sel.includes('sharethis') || sel.includes('addthis') || sel.includes('social-share') ||
                 sel.includes('optimizely')) {
        containerType = 'marketing_widget';
      } else if (sel.includes('vendor-list') || sel.includes('iab-vendor')) {
        containerType = 'vendor_list';
      }
      return { excluded: true, containerType };
    }
  }
  return { excluded: false, containerType: '' };
}

/**
 * Classify the current page into one of three states:
 *  - NOT_JOB_PAGE: no job signals
 *  - JOB_POSTING_PAGE: looks like a job detail page but has no real application form
 *  - JOB_APPLICATION_PAGE: contains a real form or trusted ATS iframe
 *
 * This replaces the old boolean `isJobApplicationPage()` and adds the nuance
 * needed to avoid scanning/learning on job-posting-only pages.
 */
// Payment processor iframes that should always be silently ignored
const PAYMENT_PROCESSOR_HOSTNAMES = [
  /checkout\.pci\./i,
  /pay\.google\.com/i,
  /shop\.app/i,
  /checkout\.shopify\.com/i,
  /js\.stripe\.com/i,
];

// URL patterns that indicate a checkout/shopping page (not a job application)
const CHECKOUT_URL_PATTERNS = [
  /\/checkouts?\//i,
  /\/cart\//i,
  /\/orders?\//i,
  /\/purchase\//i,
  /\/checkout$/i,
];

export function classifyPage(): PageClassification {
  const url = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  const signals: string[] = [];

  // ── Hard-block payment processor iframes — always silent ─────────────────
  if (PAYMENT_PROCESSOR_HOSTNAMES.some(p => p.test(hostname))) {
    return {
      state: 'NOT_JOB_PAGE',
      reason: 'Payment processor iframe — silent',
      hasTrustedATSIframe: false,
      parentFillSuppressed: false,
      applicationFieldsVerified: false,
      detectionReason: `Payment processor: ${hostname}`,
    };
  }

  // ── Tier 1: We are running directly inside a known ATS hostname ──────────
  if (TRUSTED_ATS_HOSTNAMES.some(ats => hostname === ats || hostname.endsWith('.' + ats))) {
    return {
      state: 'JOB_APPLICATION_PAGE',
      reason: 'Running on a trusted ATS hostname',
      hasTrustedATSIframe: false,
      parentFillSuppressed: false,
      applicationFieldsVerified: true,
      detectionReason: `ATS hostname: ${hostname}`,
    };
  }

  // ── Trusted ATS iframe present ────────────────────────────────────────────
  const iframes = Array.from(document.querySelectorAll('iframe'));
  const trustedIframe = iframes.find(iframe => isTrustedATSIframe(iframe.src));
  if (trustedIframe) {
    signals.push(`trusted ATS iframe: ${trustedIframe.src}`);
    return {
      state: 'JOB_APPLICATION_PAGE',
      reason: 'Trusted ATS iframe detected',
      hasTrustedATSIframe: true,
      // Suppress parent page field scanning — the iframe has the real form
      parentFillSuppressed: true,
      applicationFieldsVerified: true,
      detectionReason: signals.join('; '),
    };
  }

  // ── Checkout / shopping pages — friendly form helper ─────────────────────
  const hasCheckoutUrl = CHECKOUT_URL_PATTERNS.some(p => p.test(url));

  // ── Scoring for first-party pages ─────────────────────────────────────────
  let score = 0;

  const jobUrlPatterns = [
    /\/job[s]?\/[^/]+/i,
    /\/position[s]?\/[^/]+/i,
    /\/opening[s]?\/[^/]+/i,
    /\/apply\b/i,
    /\/application\b/i,
    /\/publication\//i,
  ];
  if (jobUrlPatterns.some(p => p.test(url))) {
    score += 2;
    signals.push('strong job URL');
  } else if (/\/career[s]?\//i.test(url) || /\/recruitment\//i.test(url)) {
    score += 1;
    signals.push('weak career URL');
  }

  // A real application form is required to reach JOB_APPLICATION_PAGE on a first-party page
  const forms = Array.from(document.querySelectorAll('form'));
  const substantialFormFields = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="password"]), select, textarea';
  let hasSubstantialForm = false;
  for (const form of forms) {
    const fieldCount = form.querySelectorAll(substantialFormFields).length;
    if (fieldCount >= 4) {
      hasSubstantialForm = true;
      // Reduced from 3→2 so a form alone no longer reaches the JOB_APPLICATION threshold
      score += 2;
      signals.push(`real form (${fieldCount} fields)`);
      break;
    }
  }

  // Checkout page with a fillable form → FORM_HELPER_PAGE (name/address fill, no credit cards)
  if (hasCheckoutUrl && hasSubstantialForm) {
    return {
      state: 'FORM_HELPER_PAGE',
      reason: 'Shopping checkout with fillable form',
      hasTrustedATSIframe: false,
      parentFillSuppressed: false,
      applicationFieldsVerified: false,
      detectionReason: `checkout URL + form`,
    };
  }

  const applyBtnPattern = /\bapply\b|submit application|start application|begin application/i;
  const hasApplyButton = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'))
    .some(btn => applyBtnPattern.test(getVisibleText(btn)));
  if (hasApplyButton) {
    score += 1;
    signals.push('apply button');
  }

  const bodyText = document.body.textContent?.toLowerCase() ?? '';
  const jobContentSignals = ['apply for this position', 'submit your application', 'upload resume', 'cover letter', 'upload cv'];
  if (jobContentSignals.some(s => bodyText.includes(s))) {
    score += 1;
    signals.push('job content');
  }

  const detectionReason = `score=${score}; ${signals.join('; ')}`;

  // Need BOTH a job URL signal AND a verified form to reach APPLICATION_PAGE
  if (score >= 3 && hasSubstantialForm) {
    return {
      state: 'JOB_APPLICATION_PAGE',
      reason: 'Verified application form on first-party page',
      hasTrustedATSIframe: false,
      parentFillSuppressed: false,
      applicationFieldsVerified: true,
      detectionReason,
    };
  }

  // Has job signals but no form = posting page only
  if (score >= 2 || hasApplyButton) {
    return {
      state: 'JOB_POSTING_PAGE',
      reason: 'Job posting detected but no application form yet',
      hasTrustedATSIframe: false,
      parentFillSuppressed: false,
      applicationFieldsVerified: false,
      detectionReason,
    };
  }

  return {
    state: 'NOT_JOB_PAGE',
    reason: 'No job signals detected',
    hasTrustedATSIframe: false,
    parentFillSuppressed: false,
    applicationFieldsVerified: false,
    detectionReason,
  };
}

/**
 * Get visible text from an element, excluding script and style tags
 */
export function getVisibleText(element: Element | null): string {
  if (!element) return '';
  
  const clone = element.cloneNode(true) as Element;
  const scripts = clone.querySelectorAll('script, style');
  scripts.forEach(el => el.remove());
  
  return clone.textContent?.trim() || '';
}

/**
 * Extract label text for a form field using multiple strategies
 */
export function extractLabel(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string | null {
  // Strategy 1: <label for=id>
  if (field.id) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    if (label) {
      const text = getVisibleText(label);
      if (text) return text;
    }
  }
  
  // Strategy 2: aria-label
  if (field.getAttribute('aria-label')) {
    return field.getAttribute('aria-label');
  }
  
  // Strategy 3: aria-labelledby
  const labelledBy = field.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) {
      const text = getVisibleText(labelEl);
      if (text) return text;
    }
  }
  
  // Strategy 4: placeholder
  if (field.placeholder) {
    return field.placeholder;
  }
  
  // Strategy 5: Find closest label ancestor
  let current: Element | null = field.parentElement;
  while (current) {
    if (current.tagName === 'LABEL') {
      const text = getVisibleText(current);
      if (text) return text;
    }
    current = current.parentElement;
  }
  
  // Strategy 6: Find fieldset legend
  const fieldset = field.closest('fieldset');
  if (fieldset) {
    const legend = fieldset.querySelector('legend');
    if (legend) {
      const text = getVisibleText(legend);
      if (text) return text;
    }
  }
  
  // Strategy 7: Workday — [data-automation-id="formField"] → [data-automation-id="label"]
  const workdayFormField = field.closest('[data-automation-id="formField"]');
  if (workdayFormField) {
    const workdayLabel = workdayFormField.querySelector('[data-automation-id="label"]');
    if (workdayLabel) {
      const text = getVisibleText(workdayLabel);
      if (text) return text;
    }
  }

  // Strategy 8: Preceding sibling text (common pattern)
  let prev = field.previousElementSibling;
  while (prev) {
    if (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV') {
      const text = getVisibleText(prev);
      if (text && text.length < 100) return text; // Reasonable label length
    }
    prev = prev.previousElementSibling;
  }
  
  return null;
}

/**
 * Generate a stable CSS selector for a form field
 */
export function generateSelector(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, form: HTMLFormElement | null): string {
  // Priority 1: ID
  if (field.id) {
    return `#${CSS.escape(field.id)}`;
  }
  
  // Priority 2: name attribute (scoped to form)
  if (field.name && form) {
    const formId = form.id ? `#${CSS.escape(form.id)}` : '';
    const formClass = form.className ? `.${form.className.split(' ')[0]}` : '';
    if (formId) {
      return `${formId} [name="${CSS.escape(field.name)}"]`;
    }
    if (formClass) {
      return `${formClass} [name="${CSS.escape(field.name)}"]`;
    }
    return `form [name="${CSS.escape(field.name)}"]`;
  }
  
  // Priority 3: data-testid, data-test, data-qa
  const testId = field.getAttribute('data-testid') || 
                 field.getAttribute('data-test') || 
                 field.getAttribute('data-qa');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }
  
  // Priority 4: Fallback to form-scoped nth-of-type path
  if (form) {
    const path: string[] = [];
    let current: Element | null = field;
    
    while (current && current !== form && current !== document.body) {
      const parent = current.parentElement;
      if (!parent) break;
      
      const siblings = Array.from(parent.children).filter(
        el => el.tagName === current!.tagName
      );
      const index = siblings.indexOf(current as Element);
      
      path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index + 1})`);
      current = parent;
    }
    
    if (form.id) {
      return `#${CSS.escape(form.id)} ${path.join(' > ')}`;
    }
    return `form ${path.join(' > ')}`;
  }
  
  // Last resort: tag name
  return field.tagName.toLowerCase();
}

/**
 * Redact sensitive values in preview
 */
function redactValue(value: string): string {
  // Simple heuristics for email/phone
  if (value.includes('@') || /^\d{10,}$/.test(value.replace(/\D/g, ''))) {
    return '[REDACTED]';
  }
  return value.length > 50 ? value.substring(0, 50) + '...' : value;
}

/**
 * Detect if a text input is actually a dropdown/autocomplete field
 * (Common in Lever, Greenhouse, and other ATS platforms)
 */
function detectLikelyDropdown(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, label: string | null): boolean {
  // Already a select element - definitely a dropdown
  if (field.tagName.toLowerCase() === 'select') {
    return true;
  }
  
  // Not a text input - not applicable
  if (!(field instanceof HTMLInputElement) || (field.type !== 'text' && field.type !== 'search')) {
    return false;
  }
  
  const labelLower = (label || '').toLowerCase();
  const idLower = (field.id || '').toLowerCase();
  const nameLower = (field.name || '').toLowerCase();
  
  // Pattern 1: Yes/No questions (binary dropdowns)
  const yesNoPatterns = [
    'are you', 'do you', 'have you', 'will you', 'would you',
    'can you', 'did you', 'does', 'is this', 'have you ever',
    'require sponsorship', 'need sponsorship', 'legally authorized',
    'open to relocation', 'willing to', 'available to'
  ];
  
  if (yesNoPatterns.some(pattern => labelLower.includes(pattern))) {
    console.log('[OA] Detected Yes/No dropdown:', label);
    return true;
  }
  
  // Pattern 2: Self-ID fields (fixed list of options)
  const selfIdPatterns = [
    'gender', 'race', 'ethnicity', 'hispanic', 'latino',
    'veteran', 'disability', 'disabled', 'orientation',
    'pronoun', 'sex', 'identify as'
  ];
  
  if (selfIdPatterns.some(pattern => 
    labelLower.includes(pattern) || idLower.includes(pattern) || nameLower.includes(pattern)
  )) {
    console.log('[OA] Detected Self-ID dropdown:', label);
    return true;
  }
  
  // Pattern 3: Work authorization fields
  const workAuthPatterns = [
    'work authorization', 'visa', 'sponsorship', 'legal status',
    'authorized to work', 'eligible to work', 'work permit'
  ];
  
  if (workAuthPatterns.some(pattern => labelLower.includes(pattern))) {
    console.log('[OA] Detected Work Auth dropdown:', label);
    return true;
  }
  
  // Pattern 4: Education fields (School, Degree, Discipline, Major)
  const educationPatterns = [
    'school', 'university', 'college', 'institution',
    'degree', 'diploma', 'certification',
    'discipline', 'major', 'field of study', 'specialization',
    'education level', 'highest education'
  ];
  
  if (educationPatterns.some(pattern => 
    labelLower.includes(pattern) || idLower.includes(pattern) || nameLower.includes(pattern)
  )) {
    console.log('[OA] Detected Education dropdown:', label);
    return true;
  }
  
  // Pattern 5: Experience level (often dropdown)
  if (labelLower.includes('experience') && (
    labelLower.includes('years') || 
    labelLower.includes('level')
  )) {
    console.log('[OA] Detected Experience dropdown:', label);
    return true;
  }
  
  // Pattern 6: Has autocomplete="off" AND is readonly (common for custom dropdowns)
  if (field.autocomplete === 'off' && field.readOnly) {
    console.log('[OA] Detected readonly autocomplete=off field (likely dropdown):', label);
    return true;
  }
  
  // Pattern 7: Check for dropdown-related attributes
  const role = field.getAttribute('role');
  if (role === 'combobox' || role === 'listbox') {
    console.log('[OA] Detected ARIA combobox/listbox:', label);
    return true;
  }
  
  // Pattern 8: Check placeholder text for "Select..." pattern
  const placeholder = (field.placeholder || '').toLowerCase();
  if (placeholder.includes('select') || 
      placeholder === 'select...' ||
      placeholder === 'choose' ||
      placeholder.includes('pick one')) {
    console.log('[OA] Detected dropdown by placeholder:', label, placeholder);
    return true;
  }
  
  // Pattern 9: Has a dropdown arrow icon nearby (check parent for arrow/chevron)
  const parent = field.parentElement;
  if (parent) {
    const parentHtml = parent.innerHTML.toLowerCase();
    if (parentHtml.includes('▼') || 
        parentHtml.includes('▾') || 
        parentHtml.includes('dropdown') ||
        parentHtml.includes('chevron') ||
        parent.querySelector('[class*="arrow"], [class*="chevron"], [class*="caret"]')) {
      console.log('[OA] Detected dropdown by arrow icon:', label);
      return true;
    }
  }
  
  return false;
}

/**
 * Get common options for known dropdown types
 */
function getCommonDropdownOptions(label: string | null): string[] | undefined {
  if (!label) return undefined;
  
  const labelLower = label.toLowerCase();
  
  // Yes/No questions
  if (labelLower.includes('are you') || labelLower.includes('do you') || 
      labelLower.includes('have you') || labelLower.includes('will you')) {
    return ['Yes', 'No'];
  }
  
  // Gender
  if (labelLower.includes('gender') && !labelLower.includes('transgender')) {
    return ['Male', 'Female', 'Non-binary', 'Prefer not to say', 'Other'];
  }
  
  // Hispanic/Latino
  if (labelLower.includes('hispanic') || labelLower.includes('latino')) {
    return ['Yes', 'No', 'Prefer not to say'];
  }
  
  // Veteran status
  if (labelLower.includes('veteran')) {
    return ['I am a veteran', 'I am not a veteran', 'Prefer not to say'];
  }
  
  // Disability status
  if (labelLower.includes('disability')) {
    return ['Yes', 'No', 'Prefer not to say'];
  }
  
  // Race (simplified - actual options vary)
  if (labelLower.includes('race')) {
    return [
      'American Indian or Alaskan Native',
      'Asian',
      'Black or African American',
      'Hispanic or Latino',
      'Native Hawaiian or Other Pacific Islander',
      'White',
      'Two or More Races',
      'Prefer not to say'
    ];
  }
  
  return undefined;
}

/**
 * Extract form schema from a form element or entire document
 */
export function extractFormSchema(form: HTMLFormElement | Document): FieldSchema[] {
  const fields: FieldSchema[] = [];
  
  // More comprehensive selector that catches custom components
  const selector = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"])',
    'select',
    'textarea',
    '[role="combobox"]',  // ARIA combobox (custom dropdowns)
    '[role="checkbox"]',   // ARIA checkbox
    '[role="radio"]',      // ARIA radio
    '[role="textbox"]',    // ARIA textbox
    '[contenteditable="true"]',  // Contenteditable fields
    '[data-testid*="input"]',  // Common test IDs
    '[class*="input-field"]',  // Common class patterns
    '[class*="form-control"]',
    '[class*="text-field"]',
  ].join(', ');
  
  console.log('[OA] Querying with selector:', selector);
  const formFields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  console.log('[OA] Found', formFields.length, 'fields with standard query');
  
  // Determine the trust context for this extraction call.
  // Fields inside excluded containers (cookie banners, chat widgets, etc.)
  // are annotated as Tier 3 and marked as not eligible for fill or learning.
  const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
  const isATSHost = TRUSTED_ATS_HOSTNAMES.some(ats => hostname === ats || hostname.endsWith('.' + ats));
  const baseTier: 1 | 2 = isATSHost ? 1 : 2;
  const detectedFrom = isATSHost ? `ats_host:${hostname}` : 'parent_page';

  // Add fields from standard DOM
  for (const field of formFields) {
    const label = extractLabel(field);
    const fieldSelector = generateSelector(field, form instanceof HTMLFormElement ? form : null);

    // Container exclusion check
    const { excluded, containerType } = isInsideExcludedContainer(field);
    if (excluded) {
      // Still include in schema for debug visibility, but mark as Tier 3 / ineligible
      fields.push({
        tagName: field.tagName.toLowerCase(),
        type: field instanceof HTMLInputElement ? (field.type || null) : null,
        name: field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? (field.name || null) : null,
        id: field.id || null,
        autocomplete: null,
        required: false,
        disabled: true,
        multiple: false,
        label,
        selector: fieldSelector,
        valuePreview: null,
        trustTier: 3,
        detectedFrom,
        containerType,
        fillEligible: false,
        learnEligible: false,
        exclusionReason: `Inside excluded container (${containerType})`,
      });
      continue;
    }
    
    // For checkboxes/radio, always include the value attribute
    let valuePreview: string | null = null;
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
      valuePreview = field.getAttribute('value') || field.value || null;
      console.log('[OA] 🔍 Found checkbox/radio:', {
        type: field.type,
        label,
        value: valuePreview,
        id: field.id,
        name: field.name
      });
    } else {
      valuePreview = field.value ? redactValue(field.value) : null;
    }
    
    // Detect if this text input is actually a dropdown (common in ATS platforms)
    let actualType = field instanceof HTMLInputElement ? (field.type || null) : (field.tagName === 'SELECT' ? 'select' : 'textarea');
    let options: string[] | undefined = undefined;
    
    if (detectLikelyDropdown(field, label)) {
      actualType = 'autocomplete'; // Mark as autocomplete (searchable dropdown)
      options = getCommonDropdownOptions(label);
      console.log('[OA] Upgraded field to autocomplete:', label, 'Options:', options?.length || 0);
    }
    
    // For actual select elements, extract options
    if (field instanceof HTMLSelectElement) {
      options = Array.from(field.options)
        .map(opt => opt.textContent?.trim() || opt.value)
        .filter(Boolean) as string[];
    }
    
    fields.push({
      tagName: field.tagName.toLowerCase(),
      type: actualType,
      name: field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? (field.name || null) : null,
      id: field.id || null,
      autocomplete: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? (field.autocomplete || null) : null,
      required: field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? field.required : false,
      disabled: field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement ? field.disabled : false,
      multiple: field instanceof HTMLInputElement || field instanceof HTMLSelectElement ? (field.multiple || false) : false,
      label,
      selector: fieldSelector,
      valuePreview,
      options,
      trustTier: baseTier,
      detectedFrom,
      containerType: isATSHost ? 'ats_host' : 'application_form',
      fillEligible: true,
      learnEligible: true,
    });
  }
  
  // CRITICAL: Traverse Shadow DOM (SmartRecruiters uses this!)
  console.log('[OA] Scanning for Shadow DOM fields...');
  const shadowFields = traverseShadowDOM(form);
  console.log('[OA] Found', shadowFields.length, 'fields in Shadow DOM');
  fields.push(...shadowFields);
  
  return fields;
}

/**
 * Traverse Shadow DOM to find form fields
 */
function traverseShadowDOM(root: HTMLFormElement | Document | ShadowRoot): FieldSchema[] {
  const shadowFields: FieldSchema[] = [];
  
  // Selector for form fields
  const selector = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
    'select',
    'textarea',
    '[role="textbox"]',
    '[contenteditable="true"]',
  ].join(', ');
  
  // Get all elements in current root
  const allElements = root.querySelectorAll('*');
  
  for (const element of allElements) {
    // Check if this element has a shadow root
    if (element.shadowRoot) {
      console.log('[OA Shadow] Traversing:', element.tagName);
      
      // Query fields in this shadow root
      const fieldsInShadow = element.shadowRoot.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
      
      for (const field of fieldsInShadow) {
        console.log('[OA Shadow] Found field in', element.tagName, ':', field.tagName, field.type);
        
        // Extract label from shadow DOM context
        const label = extractLabelFromShadow(field, element);
        
        // Generate selector (shadow DOM requires special handling)
        const fieldSelector = generateShadowSelector(field, element);
        
        // Detect actual field type (especially for custom components)
        const actualType = detectShadowFieldType(field, element);
        
        // Get value
        let valuePreview: string | null = null;
        if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
          valuePreview = field.getAttribute('value') || field.value || null;
        } else {
          valuePreview = field.value ? redactValue(field.value) : null;
        }
        
        // Get options if this is a dropdown/autocomplete
        const options = actualType === 'select' || actualType === 'autocomplete' ? 
          extractShadowOptions(element) : undefined;
        
        shadowFields.push({
          tagName: field.tagName.toLowerCase(),
          type: actualType || field.type || null,
          name: field.name || null,
          id: field.id || null,
          autocomplete: field.autocomplete || null,
          required: field.required,
          disabled: field.disabled,
          multiple: field.multiple || false,
          label,
          selector: fieldSelector,
          valuePreview,
          options,
          shadowHost: element.tagName, // Mark as shadow DOM field
        } as any);
      }
      
      // Recursively traverse nested shadow DOMs
      const nested = traverseShadowDOM(element.shadowRoot);
      shadowFields.push(...nested);
    }
  }
  
  return shadowFields;
}

/**
 * Extract label from shadow DOM context
 */
function extractLabelFromShadow(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, host: Element): string | null {
  // Try standard label extraction first
  const standardLabel = extractLabel(field);
  if (standardLabel) return standardLabel;
  
  // Check shadow root for labels
  const shadowRoot = host.shadowRoot;
  if (!shadowRoot) return null;
  
  // Look for label elements in shadow root
  const labels = shadowRoot.querySelectorAll('label, [slot="label"]');
  for (const label of labels) {
    const text = getVisibleText(label);
    if (text) return text;
  }
  
  // Check host element attributes
  const hostLabel = host.getAttribute('label') || host.getAttribute('aria-label');
  if (hostLabel) return hostLabel;
  
  // Check for text content in host
  const hostText = Array.from(host.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent?.trim())
    .filter(Boolean)
    .join(' ');
  
  if (hostText && hostText.length < 100) return hostText;
  
  return null;
}

/**
 * Detect actual field type for Shadow DOM components
 */
function detectShadowFieldType(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, host: Element): string {
  const hostTag = host.tagName.toLowerCase();
  
  // SmartRecruiters component detection
  if (hostTag === 'spl-autocomplete') {
    console.log('[OA Shadow] Detected AUTOCOMPLETE (dropdown)');
    return 'autocomplete'; // Dropdown with search
  }
  
  if (hostTag === 'spl-phone-field') {
    console.log('[OA Shadow] Detected PHONE FIELD');
    return 'tel';
  }
  
  if (hostTag === 'spl-dropzone') {
    console.log('[OA Shadow] Detected FILE UPLOAD');
    return 'file';
  }
  
  // Check for select elements in shadow root
  if (host.shadowRoot) {
    const hasSelect = host.shadowRoot.querySelector('select');
    if (hasSelect) {
      console.log('[OA Shadow] Detected SELECT element inside');
      return 'select-one';
    }
    
    // Check for role="listbox" or role="combobox" (custom dropdowns)
    const hasListbox = host.shadowRoot.querySelector('[role="listbox"], [role="combobox"]');
    if (hasListbox) {
      console.log('[OA Shadow] Detected custom dropdown (role-based)');
      return 'select';
    }
  }
  
  // Check host attributes
  const role = host.getAttribute('role');
  if (role === 'combobox' || role === 'listbox') {
    console.log('[OA Shadow] Detected dropdown by host role');
    return 'select';
  }
  
  // Default to field's actual type
  return field.type || field.tagName.toLowerCase();
}

/**
 * Extract dropdown options from Shadow DOM component
 */
function extractShadowOptions(host: Element): string[] | undefined {
  if (!host.shadowRoot) return undefined;
  
  const options: string[] = [];
  
  // Check for <select> options
  const selectOptions = host.shadowRoot.querySelectorAll('option');
  if (selectOptions.length > 0) {
    selectOptions.forEach(opt => {
      const text = opt.textContent?.trim();
      if (text && text !== '' && !text.includes('Select')) {
        options.push(text);
      }
    });
    console.log('[OA Shadow] Extracted', options.length, 'options from <select>');
    return options;
  }
  
  // Check for custom dropdown items (role="option", [role="menuitem"])
  const customOptions = host.shadowRoot.querySelectorAll('[role="option"], [role="menuitem"], li[data-value]');
  if (customOptions.length > 0) {
    customOptions.forEach(opt => {
      const text = opt.textContent?.trim() || opt.getAttribute('data-value');
      if (text && text !== '') {
        options.push(text);
      }
    });
    console.log('[OA Shadow] Extracted', options.length, 'options from custom dropdown');
    return options;
  }
  
  // Check host attributes for options (some components store options as data)
  const dataOptions = host.getAttribute('options') || host.getAttribute('data-options');
  if (dataOptions) {
    try {
      const parsed = JSON.parse(dataOptions);
      if (Array.isArray(parsed)) {
        console.log('[OA Shadow] Extracted', parsed.length, 'options from host attribute');
        return parsed.map(String);
      }
    } catch (e) {
      // Not JSON, try splitting
      const split = dataOptions.split(',').map(s => s.trim());
      if (split.length > 1) {
        return split;
      }
    }
  }
  
  return undefined;
}

/**
 * Generate selector for shadow DOM field
 */
function generateShadowSelector(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, host: Element): string {
  // Generate host selector
  let hostSelector = '';
  
  if (host.id) {
    hostSelector = `#${CSS.escape(host.id)}`;
  } else if (host.getAttribute('name')) {
    hostSelector = `${host.tagName.toLowerCase()}[name="${CSS.escape(host.getAttribute('name')!)}"]`;
  } else {
    hostSelector = host.tagName.toLowerCase();
  }
  
  // Generate field selector within shadow root
  let fieldSelector = '';
  if (field.id) {
    fieldSelector = `#${CSS.escape(field.id)}`;
  } else if (field.name) {
    fieldSelector = `[name="${CSS.escape(field.name)}"]`;
  } else {
    fieldSelector = field.tagName.toLowerCase();
  }
  
  // Combine with special shadow DOM marker
  return `${hostSelector}::shadow::${fieldSelector}`;
}

/**
 * Extract job metadata from the page
 */
// Heading text that signals a confirmation/thank-you page, not a job title
const CONFIRMATION_HEADINGS = new Set([
  'thank you for applying',
  'thank you',
  'thanks for applying',
  'application submitted',
  'application received',
  'application complete',
  'your application has been submitted',
  'we received your application',
  'you\'ve applied',
  'you applied',
  'application successful',
  // Single-word page headings that appear on confirmation/thank-you pages
  'confirmation',
  'submitted',
  'success',
  'congratulations',
  'congrats',
  'done',
  // Multi-word variants
  'your application is under review',
  'we\'ll be in touch',
  'application complete',
  'application confirmed',
  'you have successfully applied',
  'successfully submitted',
]);

// ATS provider names that should never be used as a company name
const ATS_PROVIDER_NAMES = new Set([
  'greenhouse', 'lever', 'workday', 'ashby', 'bamboohr', 'icims',
  'smartrecruiters', 'taleo', 'successfactors', 'jobvite', 'workable',
  'breezy', 'jazz', 'fountain', 'paylocity', 'ultipro',
]);

function isConfirmationHeading(text: string): boolean {
  return CONFIRMATION_HEADINGS.has(text.toLowerCase().trim().replace(/[!.]+$/, ''));
}

export function extractJobMetadata(): JobMeta {
  const url = window.location.href;
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

  // ── Company extraction ────────────────────────────────────────────────────
  // Priority: shared-ATS URL path > og:site_name (if not an ATS name) > CSS selectors > subdomain
  let company: string | null = null;

  // 1. Shared ATS boards: company is first path segment
  const PATH_GENERICS = new Set(['jobs', 'job', 'apply', 'application', 'confirmation', 'careers',
    'positions', 'openings', 'portal', 'en-us', 'en-gb', 'external', 'apply-now']);
  if (hostname === 'job-boards.greenhouse.io' || hostname === 'boards.greenhouse.io') {
    company = pathParts[0] || null;
  } else if (hostname === 'jobs.lever.co') {
    company = pathParts[0] || null;
  } else if (hostname === 'app.ashbyhq.com') {
    company = pathParts.find(p => !PATH_GENERICS.has(p.toLowerCase())) || null;
  }

  // 2. og:site_name — skip if it's an ATS provider name
  if (!company) {
    const ogSiteName = document.querySelector('meta[property="og:site_name"]');
    const siteName = ogSiteName?.getAttribute('content')?.trim();
    if (siteName && !ATS_PROVIDER_NAMES.has(siteName.toLowerCase())) {
      company = siteName;
    }
  }

  // 3. DOM selectors
  if (!company) {
    const companySelectors = [
      '[data-testid*="company"]',
      '[class*="company-name"]',
      'header [class*="logo"]',
      'header strong',
    ];
    for (const selector of companySelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = getVisibleText(el);
        if (text && text.length > 1 && text.length < 100 && !ATS_PROVIDER_NAMES.has(text.toLowerCase())) {
          company = text;
          break;
        }
      }
    }
  }

  // 4. Subdomain — skip generic subdomains
  if (!company) {
    try {
      const parts = hostname.replace(/^www\./, '').split('.');
      const GENERIC_SUBDOMAINS = new Set(['careers', 'jobs', 'hiring', 'apply', 'work', 'talent',
        'recruit', 'hr', 'job', 'career', 'boards', 'job-boards']);
      const companyPart = parts.find(p =>
        !GENERIC_SUBDOMAINS.has(p) && !ATS_PROVIDER_NAMES.has(p) &&
        p !== 'com' && p !== 'io' && p !== 'net' && p !== 'org' && p !== 'co' && p.length > 1
      );
      company = companyPart || null;
    } catch {
      // Ignore
    }
  }

  // ── Job title extraction ──────────────────────────────────────────────────
  // Skip headings that are confirmation messages, not job titles
  let jobTitle: string | null = null;

  // 1. Visible h1/h2/h3 — skip confirmation-page headings
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(h => {
    const rect = h.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
  for (const tag of ['H1', 'H2', 'H3']) {
    const el = headings.find(h => h.tagName === tag);
    if (el) {
      const text = getVisibleText(el);
      if (text && !isConfirmationHeading(text)) {
        jobTitle = text;
        break;
      }
    }
  }

  // 2. Specific job-title data attributes / classes
  if (!jobTitle) {
    const titleSelectors = [
      '[data-testid*="job-title"]',
      '[data-testid*="title"]',
      '[class*="job-title"]',
    ];
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = getVisibleText(el);
        if (text && text.length > 5 && text.length < 200 && !isConfirmationHeading(text)) {
          jobTitle = text;
          break;
        }
      }
    }
  }

  // 3. og:title (often has real job title even on confirmation pages)
  if (!jobTitle) {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const text = ogTitle?.getAttribute('content');
    if (text && text.length > 3 && !isConfirmationHeading(text)) {
      jobTitle = text.replace(/\s*[\|–\-]\s*.+$/, '').trim() || null;
    }
  }

  // 4. document.title
  if (!jobTitle) {
    const cleaned = document.title.replace(/\s*[\|–\-]\s*.+$/, '').trim();
    if (cleaned.length > 3 && !isConfirmationHeading(cleaned)) {
      jobTitle = cleaned;
    }
  }

  // 5. URL path — take the most descriptive non-numeric, non-generic segment
  if (!jobTitle) {
    try {
      const skipSegments = new Set(['jobs', 'job', 'apply', 'application', 'confirmation',
        'careers', 'positions', 'openings', 'thank-you', 'thankyou', 'success', 'submitted',
        ...pathParts.slice(0, 1)  // skip the company slug we already extracted
      ]);
      const candidate = [...pathParts].reverse()
        .find(p => !skipSegments.has(p.toLowerCase()) && isNaN(Number(p)) && p.length > 2);
      if (candidate) {
        jobTitle = candidate.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    } catch {
      // Ignore
    }
  }
  
  // Extract ATS hint from hostname
  let atsHint: string | null = null;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const atsPatterns = [
      { pattern: /workday/i, name: 'workday' },
      { pattern: /greenhouse/i, name: 'greenhouse' },
      { pattern: /lever/i, name: 'lever' },
      { pattern: /icims/i, name: 'icims' },
      { pattern: /smartrecruiters/i, name: 'smartrecruiters' },
      { pattern: /taleo/i, name: 'taleo' },
      { pattern: /ashby/i, name: 'ashby' },
      { pattern: /bamboohr/i, name: 'bamboohr' },
    ];
    
    for (const { pattern, name } of atsPatterns) {
      if (pattern.test(hostname)) {
        atsHint = name;
        break;
      }
    }
  } catch {
    // Ignore
  }
  
  return {
    jobTitle,
    company,
    url,
    atsHint,
  };
}

/**
 * Check if the current URL is a post-submission confirmation / thank-you page.
 * These pages are definitive proof that an application was just submitted —
 * no form fields need to be present.
 */
export function isJobConfirmationPage(): boolean {
  const url = window.location.href.toLowerCase();
  const patterns = [
    /\/confirmation\b/,
    /\/thank-you\b/,
    /\/thank_you\b/,
    /\/thankyou\b/,
    /\/application-submitted\b/,
    /\/submitted\b/,
    /\/apply-success\b/,
    /\/application-complete\b/,
    /[?&]success=true\b/,
    /[?&]submitted=true\b/,
  ];
  return patterns.some(p => p.test(url));
}

/**
 * Check if page likely contains a job application flow.
 *
 * Uses a scoring system so a single weak signal (e.g. a /careers URL or a form
 * with 3 fields) is not enough by itself.  Known ATS hostnames are still an
 * instant match because they virtually never give false positives.
 */
export function isJobApplicationPage(): boolean {
  const url = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  
  console.log('[OA Detection] Checking URL:', url);
  console.log('[OA Detection] Hostname:', hostname);
  
  // ── Tier 1: Known ATS hostnames (instant match) ───────────────────────
  const knownATSHostnames = [
    'greenhouse.io',
    'lever.co',
    'workday.com',
    'myworkdayjobs.com',
    'smartrecruiters.com',
    'workable.com',
    'breezy.hr',
    'bamboohr.com',
    'icims.com',
    'ultipro.com',
    'ashbyhq.com',
    'jobvite.com',
    'taleo.net',
    'successfactors.com',
    'jazz.co',
    'fountain.com',
    'recruiting.paylocity.com',
    'applytojob.com',
  ];
  
  for (const ats of knownATSHostnames) {
    if (hostname.includes(ats)) {
      console.log('[OA Detection] Tier-1 match (ATS hostname):', ats);
      return true;
    }
  }
  
  // ── Tier 2: Scoring system ────────────────────────────────────────────
  // A page needs at least 3 points to be considered a job application page.
  // This avoids false positives from a single weak signal.
  let score = 0;
  
  // --- Signal: Job-related URL path (+2) ---
  const jobUrlPatterns = [
    /\/job[s]?\/[^/]+/i,       // /jobs/some-position (not just /jobs/)
    /\/position[s]?\/[^/]+/i,  // /positions/some-role
    /\/opening[s]?\/[^/]+/i,   // /openings/some-role
    /\/apply\b/i,              // /apply
    /\/application\b/i,        // /application
    /\/publication\//i,        // SmartRecruiters
  ];
  
  for (const pattern of jobUrlPatterns) {
    if (pattern.test(url)) {
      score += 2;
      console.log('[OA Detection] +2 URL pattern:', pattern);
      break;
    }
  }
  
  // --- Signal: Generic career URL path (+1, weaker) ---
  const weakUrlPatterns = [
    /\/career[s]?\//i,
    /\/recruitment\//i,
  ];
  if (score === 0) { // Only check if no strong URL match
    for (const pattern of weakUrlPatterns) {
      if (pattern.test(url)) {
        score += 1;
        console.log('[OA Detection] +1 weak URL pattern:', pattern);
        break;
      }
    }
  }
  
  // --- Signal: Page has a form with enough fields (+2) ---
  const forms = Array.from(document.querySelectorAll('form'));
  let hasSubstantialForm = false;
  for (const form of forms) {
    const fields = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="password"]), select, textarea'
    );
    if (fields.length >= 4) {
      hasSubstantialForm = true;
      score += 2;
      console.log('[OA Detection] +2 form with', fields.length, 'fields');
      break;
    }
  }
  
  // --- Signal: SPA form fields without <form> tags (+1) ---
  if (!hasSubstantialForm) {
    const allFields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]):not([type="password"]), select, textarea'
    );
    if (allFields.length >= 6) {
      score += 1;
      console.log('[OA Detection] +1 loose fields:', allFields.length);
    }
  }
  
  // --- Signal: Apply/submit button present (+1) ---
  const applyPattern = /\bapply\b|submit application|submit your application|continue to apply|start application|begin application/i;
  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
  for (const btn of buttons) {
    const text = getVisibleText(btn) || '';
    if (applyPattern.test(text)) {
      score += 1;
      console.log('[OA Detection] +1 apply button:', text.substring(0, 50));
      break;
    }
  }
  
  // --- Signal: Job-application-specific content (+1) ---
  const bodyText = document.body.textContent?.toLowerCase() || '';
  const strongJobIndicators = [
    'apply for this position',
    'submit your application',
    'start your application',
    'upload resume',
    'upload cv',
    'cover letter',
  ];
  
  for (const indicator of strongJobIndicators) {
    if (bodyText.includes(indicator)) {
      score += 1;
      console.log('[OA Detection] +1 content indicator:', indicator);
      break;
    }
  }
  
  console.log('[OA Detection] Final score:', score, '(need >= 3)');
  
  if (score >= 3) {
    console.log('[OA Detection] Page IS a job application page');
    return true;
  }
  
  console.log('[OA Detection] Page is NOT a job application page');
  return false;
}
