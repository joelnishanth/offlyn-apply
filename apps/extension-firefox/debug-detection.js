// Debug script - paste this in browser console on the SmartRecruiters page

console.log('=== DEBUG: Page Detection ===');
console.log('URL:', window.location.href);
console.log('Hostname:', window.location.hostname);

// Check for forms
const forms = document.querySelectorAll('form');
console.log('Forms found:', forms.length);
forms.forEach((form, i) => {
  const fields = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
  console.log(`  Form ${i}: ${fields.length} fields`);
});

// Check for fields without forms
const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
const allSelects = document.querySelectorAll('select');
const allTextareas = document.querySelectorAll('textarea');
console.log('All inputs:', allInputs.length);
console.log('All selects:', allSelects.length);
console.log('All textareas:', allTextareas.length);
console.log('Total fields:', allInputs.length + allSelects.length + allTextareas.length);

// Check for apply buttons
const buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
console.log('Buttons found:', buttons.length);
const applyButtons = Array.from(buttons).filter(b => 
  /apply|submit|next|continue/i.test(b.textContent || b.value || '')
);
console.log('Apply-related buttons:', applyButtons.length);
applyButtons.forEach(b => console.log('  -', b.textContent?.trim()));

// Check page text
const bodyText = document.body.textContent?.toLowerCase() || '';
const indicators = ['apply', 'application', 'resume', 'cv', 'job'];
console.log('Text indicators found:');
indicators.forEach(ind => {
  if (bodyText.includes(ind)) {
    console.log(`  ✓ "${ind}"`);
  }
});

// Check if extension is loaded
console.log('\nExtension loaded?', typeof window.offlyn !== 'undefined' || document.querySelector('[id*="offlyn"]') !== null);
