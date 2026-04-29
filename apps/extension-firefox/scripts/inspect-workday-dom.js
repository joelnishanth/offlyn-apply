/**
 * Workday Application Form DOM Inspector
 *
 * Run this script in the browser console while on a Workday job application page:
 * https://expedia.wd108.myworkdayjobs.com/.../apply
 *
 * It will output a detailed report of form structure for autofill development.
 * DO NOT submit or fill real information - this is for inspection only.
 */

(function inspectWorkdayDOM() {
  const report = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    steps: [],
    allDataAutomationIds: [],
    formFields: [],
    checkboxes: [],
    dropdowns: [],
    phoneFields: [],
    stateRegionField: null,
    gsatCheckboxes: []
  };

  function getVisibleText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style').forEach(s => s.remove());
    return (clone.textContent || '').trim();
  }

  function describeElement(el, depth = 0) {
    if (!el) return null;
    const indent = '  '.repeat(depth);
    const tag = el.tagName?.toLowerCase() || 'unknown';
    const id = el.id || null;
    const name = el.name || null;
    const type = el.type || null;
    const automationId = el.getAttribute?.('data-automation-id') || null;
    const ariaLabel = el.getAttribute?.('aria-label') || null;
    const ariaLabelledby = el.getAttribute?.('aria-labelledby') || null;
    const role = el.getAttribute?.('role') || null;
    const placeholder = el.placeholder || null;
    const classes = (el.className && typeof el.className === 'string') ? el.className.split(/\s+/).filter(Boolean).slice(0, 5) : [];

    const desc = {
      tag,
      id,
      name,
      type,
      'data-automation-id': automationId,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      role,
      placeholder,
      classes: classes.length ? classes : undefined,
      text: getVisibleText(el).substring(0, 100) || undefined,
      childCount: el.children?.length || 0
    };
    return desc;
  }

  function findLabelAssociation(field) {
    const result = { method: null, labelText: null };
    if (field.id) {
      const label = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
      if (label) {
        result.method = 'for';
        result.labelText = getVisibleText(label);
        return result;
      }
    }
    if (field.getAttribute('aria-label')) {
      result.method = 'aria-label';
      result.labelText = field.getAttribute('aria-label');
      return result;
    }
    const labelledBy = field.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) {
        result.method = 'aria-labelledby';
        result.labelText = getVisibleText(labelEl);
        return result;
      }
    }
    const formField = field.closest('[data-automation-id="formField"]');
    if (formField) {
      const labelEl = formField.querySelector('[data-automation-id="label"]');
      if (labelEl) {
        result.method = 'data-automation-id="label"';
        result.labelText = getVisibleText(labelEl);
        return result;
      }
    }
    return result;
  }

  // Collect all data-automation-id values
  document.querySelectorAll('[data-automation-id]').forEach(el => {
    const val = el.getAttribute('data-automation-id');
    if (val && !report.allDataAutomationIds.includes(val)) {
      report.allDataAutomationIds.push(val);
    }
  });

  // Find step indicators (Create Account, My Information, etc.)
  const stepElements = document.querySelectorAll('[data-automation-id*="step"], [class*="step"], [role="tab"]');
  stepElements.forEach((el, i) => {
    report.steps.push({
      index: i,
      text: getVisibleText(el),
      automationId: el.getAttribute('data-automation-id'),
      classes: el.className
    });
  });

  // Inspect all form fields
  const fieldSelectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
    'select',
    'textarea',
    '[role="combobox"]',
    '[role="textbox"]',
    '[contenteditable="true"]'
  ].join(', ');

  const fields = document.querySelectorAll(fieldSelectors);
  fields.forEach((field, idx) => {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // Skip invisible

    const labelAssoc = findLabelAssociation(field);
    const formFieldContainer = field.closest('[data-automation-id="formField"]');
    const parentHtml = field.parentElement?.outerHTML?.substring(0, 300) || '';

    const entry = {
      index: idx,
      ...describeElement(field),
      labelAssociation: labelAssoc,
      hasFormFieldContainer: !!formFieldContainer,
      formFieldAutomationId: formFieldContainer?.getAttribute('data-automation-id') || null,
      parentTag: field.parentElement?.tagName,
      parentAutomationId: field.parentElement?.getAttribute?.('data-automation-id') || null
    };

    report.formFields.push(entry);

    // Phone fields
    const labelLower = (labelAssoc.labelText || '').toLowerCase();
    const nameLower = (field.name || '').toLowerCase();
    const idLower = (field.id || '').toLowerCase();
    if (labelLower.includes('phone') || labelLower.includes('country code') || nameLower.includes('phone') || idLower.includes('phone')) {
      report.phoneFields.push({
        ...entry,
        fieldType: labelLower.includes('country code') ? 'country_code' : 'phone_number'
      });
    }

    // State/Region
    if (labelLower.includes('state') || labelLower.includes('region') || labelLower.includes('province')) {
      report.stateRegionField = entry;
    }

    // Dropdowns / autocomplete
    if (field.tagName === 'SELECT' || field.getAttribute('role') === 'combobox' || (field.type === 'text' && field.readOnly)) {
      let options = [];
      if (field.tagName === 'SELECT') {
        options = Array.from(field.options).map(o => ({ value: o.value, text: o.textContent?.trim() }));
      }
      report.dropdowns.push({ ...entry, options });
    }

    // Checkboxes
    if (field.type === 'checkbox' || field.getAttribute('role') === 'checkbox') {
      const isGsat = /^gsat[0-9a-f]+$/i.test(field.id || '');
      const hasLabel = !!labelAssoc.labelText || !!document.querySelector(`label[for="${CSS.escape(field.id || '')}"]`);
      report.checkboxes.push({
        ...entry,
        isGsatAnonymous: isGsat && !field.name && !hasLabel,
        value: field.value,
        checked: field.checked
      });
      if (isGsat) {
        report.gsatCheckboxes.push({
          id: field.id,
          name: field.name,
          hasLabel,
          parent: field.parentElement?.outerHTML?.substring(0, 500),
          precedingSibling: field.previousElementSibling?.outerHTML?.substring(0, 200),
          nextSibling: field.nextElementSibling?.outerHTML?.substring(0, 200)
        });
      }
    }
  });

  // Output report
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('WORKDAY DOM INSPECTION REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('URL:', report.url);
  console.log('Timestamp:', report.timestamp);
  console.log('');
  console.log('ALL data-automation-id VALUES:', report.allDataAutomationIds);
  console.log('');
  console.log('STEPS DETECTED:', report.steps);
  console.log('');
  console.log('PHONE FIELDS:', JSON.stringify(report.phoneFields, null, 2));
  console.log('');
  console.log('STATE/REGION FIELD:', JSON.stringify(report.stateRegionField, null, 2));
  console.log('');
  console.log('GSAT CHECKBOXES (anonymous):', JSON.stringify(report.gsatCheckboxes, null, 2));
  console.log('');
  console.log('ALL FORM FIELDS:', JSON.stringify(report.formFields, null, 2));
  console.log('');
  console.log('FULL REPORT (copy this):');
  console.log(JSON.stringify(report, null, 2));
  console.log('═══════════════════════════════════════════════════════════════');

  return report;
})();
