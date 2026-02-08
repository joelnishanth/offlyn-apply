/**
 * DOM utilities for extracting job metadata and form schemas
 */

import type { JobMeta, FieldSchema } from './types';

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
  
  // Strategy 7: Preceding sibling text (common pattern)
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
    console.log('[Offlyn] Detected Yes/No dropdown:', label);
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
    console.log('[Offlyn] Detected Self-ID dropdown:', label);
    return true;
  }
  
  // Pattern 3: Work authorization fields
  const workAuthPatterns = [
    'work authorization', 'visa', 'sponsorship', 'legal status',
    'authorized to work', 'eligible to work', 'work permit'
  ];
  
  if (workAuthPatterns.some(pattern => labelLower.includes(pattern))) {
    console.log('[Offlyn] Detected Work Auth dropdown:', label);
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
    console.log('[Offlyn] Detected Education dropdown:', label);
    return true;
  }
  
  // Pattern 5: Experience level (often dropdown)
  if (labelLower.includes('experience') && (
    labelLower.includes('years') || 
    labelLower.includes('level')
  )) {
    console.log('[Offlyn] Detected Experience dropdown:', label);
    return true;
  }
  
  // Pattern 6: Has autocomplete="off" AND is readonly (common for custom dropdowns)
  if (field.autocomplete === 'off' && field.readOnly) {
    console.log('[Offlyn] Detected readonly autocomplete=off field (likely dropdown):', label);
    return true;
  }
  
  // Pattern 7: Check for dropdown-related attributes
  const role = field.getAttribute('role');
  if (role === 'combobox' || role === 'listbox') {
    console.log('[Offlyn] Detected ARIA combobox/listbox:', label);
    return true;
  }
  
  // Pattern 8: Check placeholder text for "Select..." pattern
  const placeholder = (field.placeholder || '').toLowerCase();
  if (placeholder.includes('select') || 
      placeholder === 'select...' ||
      placeholder === 'choose' ||
      placeholder.includes('pick one')) {
    console.log('[Offlyn] Detected dropdown by placeholder:', label, placeholder);
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
      console.log('[Offlyn] Detected dropdown by arrow icon:', label);
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
  
  console.log('[Offlyn] Querying with selector:', selector);
  const formFields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  console.log('[Offlyn] Found', formFields.length, 'fields with standard query');
  
  // Add fields from standard DOM
  for (const field of formFields) {
    const label = extractLabel(field);
    const fieldSelector = generateSelector(field, form instanceof HTMLFormElement ? form : null);
    
    // For checkboxes/radio, always include the value attribute
    let valuePreview: string | null = null;
    if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
      valuePreview = field.getAttribute('value') || field.value || null;
    } else {
      valuePreview = field.value ? redactValue(field.value) : null;
    }
    
    // Detect if this text input is actually a dropdown (common in ATS platforms)
    let actualType = field.type || null;
    let options: string[] | undefined = undefined;
    
    if (detectLikelyDropdown(field, label)) {
      actualType = 'autocomplete'; // Mark as autocomplete (searchable dropdown)
      options = getCommonDropdownOptions(label);
      console.log('[Offlyn] Upgraded field to autocomplete:', label, 'Options:', options?.length || 0);
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
    });
  }
  
  // CRITICAL: Traverse Shadow DOM (SmartRecruiters uses this!)
  console.log('[Offlyn] Scanning for Shadow DOM fields...');
  const shadowFields = traverseShadowDOM(form);
  console.log('[Offlyn] Found', shadowFields.length, 'fields in Shadow DOM');
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
      console.log('[Offlyn Shadow] Traversing:', element.tagName);
      
      // Query fields in this shadow root
      const fieldsInShadow = element.shadowRoot.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
      
      for (const field of fieldsInShadow) {
        console.log('[Offlyn Shadow] Found field in', element.tagName, ':', field.tagName, field.type);
        
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
    console.log('[Offlyn Shadow] Detected AUTOCOMPLETE (dropdown)');
    return 'autocomplete'; // Dropdown with search
  }
  
  if (hostTag === 'spl-phone-field') {
    console.log('[Offlyn Shadow] Detected PHONE FIELD');
    return 'tel';
  }
  
  if (hostTag === 'spl-dropzone') {
    console.log('[Offlyn Shadow] Detected FILE UPLOAD');
    return 'file';
  }
  
  // Check for select elements in shadow root
  if (host.shadowRoot) {
    const hasSelect = host.shadowRoot.querySelector('select');
    if (hasSelect) {
      console.log('[Offlyn Shadow] Detected SELECT element inside');
      return 'select-one';
    }
    
    // Check for role="listbox" or role="combobox" (custom dropdowns)
    const hasListbox = host.shadowRoot.querySelector('[role="listbox"], [role="combobox"]');
    if (hasListbox) {
      console.log('[Offlyn Shadow] Detected custom dropdown (role-based)');
      return 'select';
    }
  }
  
  // Check host attributes
  const role = host.getAttribute('role');
  if (role === 'combobox' || role === 'listbox') {
    console.log('[Offlyn Shadow] Detected dropdown by host role');
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
    console.log('[Offlyn Shadow] Extracted', options.length, 'options from <select>');
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
    console.log('[Offlyn Shadow] Extracted', options.length, 'options from custom dropdown');
    return options;
  }
  
  // Check host attributes for options (some components store options as data)
  const dataOptions = host.getAttribute('options') || host.getAttribute('data-options');
  if (dataOptions) {
    try {
      const parsed = JSON.parse(dataOptions);
      if (Array.isArray(parsed)) {
        console.log('[Offlyn Shadow] Extracted', parsed.length, 'options from host attribute');
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
export function extractJobMetadata(): JobMeta {
  const url = window.location.href;
  
  // Extract job title - try largest visible heading
  let jobTitle: string | null = null;
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(h => {
    const rect = h.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0; // Visible
  });
  
  if (headings.length > 0) {
    // Prefer h1, then h2, then h3
    const h1 = headings.find(h => h.tagName === 'H1');
    if (h1) {
      jobTitle = getVisibleText(h1);
    } else {
      const h2 = headings.find(h => h.tagName === 'H2');
      if (h2) {
        jobTitle = getVisibleText(h2);
      } else if (headings[0]) {
        jobTitle = getVisibleText(headings[0]);
      }
    }
  }
  
  // Fallback: look for common title-like elements
  if (!jobTitle) {
    const titleSelectors = [
      '[data-testid*="title"]',
      '[class*="title"]',
      '[class*="job-title"]',
      'strong',
    ];
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = getVisibleText(el);
        if (text && text.length > 5 && text.length < 200) {
          jobTitle = text;
          break;
        }
      }
    }
  }
  
  // Extract company name
  let company: string | null = null;
  
  // Try meta og:site_name
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) {
    company = ogSiteName.getAttribute('content');
  }
  
  // Try common header selectors
  if (!company) {
    const companySelectors = [
      '[data-testid*="company"]',
      '[class*="company"]',
      'header [class*="logo"]',
      'header strong',
    ];
    for (const selector of companySelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = getVisibleText(el);
        if (text && text.length > 1 && text.length < 100) {
          company = text;
          break;
        }
      }
    }
  }
  
  // Fallback: domain-based hint
  if (!company) {
    try {
      const hostname = new URL(url).hostname;
      company = hostname.replace(/^www\./, '').split('.')[0];
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
 * Check if page likely contains a job application flow
 */
export function isJobApplicationPage(): boolean {
  const url = window.location.href.toLowerCase();
  const hostname = window.location.hostname.toLowerCase();
  
  console.log('[Offlyn Detection] Checking URL:', url);
  console.log('[Offlyn Detection] Hostname:', hostname);
  
  // Known ATS platforms (URL-based detection)
  const knownATS = [
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
    'oracle.com/hcm',
    'jazz.co',
    'fountain.com',
    'recruiting.paylocity.com',
    'applytojob.com',
    'careers-page',
    '/careers',
    '/jobs',
    '/apply',
    '/application',
  ];
  
  // Check if URL matches known ATS
  for (const ats of knownATS) {
    if (hostname.includes(ats) || url.includes(ats)) {
      console.log('[Offlyn Detection] ✓ Matched known ATS:', ats);
      return true;
    }
  }
  console.log('[Offlyn Detection] No known ATS match in URL');
  
  // Check for job-specific URL patterns
  const jobUrlPatterns = [
    /\/job[s]?\//i,
    /\/career[s]?\//i,
    /\/position[s]?\//i,
    /\/opening[s]?\//i,
    /\/application/i,
    /\/apply/i,
    /posting/i,
    /recruitment/i,
    /publication/i,  // SmartRecruiters uses this!
  ];
  
  console.log('[Offlyn Detection] Checking URL patterns...');
  for (const pattern of jobUrlPatterns) {
    if (pattern.test(url)) {
      console.log('[Offlyn Detection] ✓ Matched URL pattern:', pattern);
      return true;
    }
  }
  console.log('[Offlyn Detection] No URL pattern match');
  
  // Check for forms with >= 3 fields (lowered threshold)
  const forms = Array.from(document.querySelectorAll('form'));
  console.log('[Offlyn Detection] Found', forms.length, 'forms');
  for (const form of forms) {
    const fields = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    console.log('[Offlyn Detection] Form has', fields.length, 'fields');
    if (fields.length >= 3) {  // Lowered from 4 to 3
      console.log('[Offlyn Detection] ✓ Form has enough fields');
      return true;
    }
  }
  
  // Check for form fields even without <form> tags (SPA applications)
  const allFields = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
  console.log('[Offlyn Detection] Found', allFields.length, 'total fields on page');
  if (allFields.length >= 4) {  // Lowered from 6 to 4
    console.log('[Offlyn Detection] ✓ Enough fields without form tag');
    return true;
  }
  
  // Check for apply/submit buttons/links
  const applyPattern = /apply|submit application|submit your|continue to apply|start application|begin application/i;
  const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"], [class*="apply"], [class*="submit"]'));
  console.log('[Offlyn Detection] Found', buttons.length, 'buttons');
  for (const btn of buttons) {
    const text = getVisibleText(btn) || btn.className || '';
    if (applyPattern.test(text)) {
      console.log('[Offlyn Detection] ✓ Found apply button:', text.substring(0, 50));
      return true;
    }
  }
  
  // Check for job-specific content indicators
  const bodyText = document.body.textContent?.toLowerCase() || '';
  const jobIndicators = [
    'apply for this position',
    'submit your application',
    'start your application',
    'job application',
    'upload resume',
    'upload cv',
    'apply now',
    'submit application',
  ];
  
  console.log('[Offlyn Detection] Checking page content for job indicators...');
  for (const indicator of jobIndicators) {
    if (bodyText.includes(indicator)) {
      console.log('[Offlyn Detection] ✓ Found job indicator:', indicator);
      return true;
    }
  }
  
  console.log('[Offlyn Detection] ✗ No detection criteria matched');
  return false;
}
