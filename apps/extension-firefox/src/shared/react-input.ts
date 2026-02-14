/**
 * React-compatible input value setter
 * 
 * React uses its own internal state system, so setting `element.value = ...` directly
 * often gets ignored or overwritten. This utility uses the native setter via property
 * descriptor and properly dispatches events that React listens to.
 * 
 * Also includes superfill.ai-inspired human-like typing simulation for better
 * compatibility with React-controlled inputs and other framework event systems.
 */

/**
 * Normalize phone number for comparison (E.164-like format)
 * Keeps only digits and leading +
 */
function normalizePhoneNumber(phone: string): string {
  // Keep leading + if present, then only digits
  const hasLeadingPlus = phone.trim().startsWith('+');
  const digitsOnly = phone.replace(/\D/g, '');
  return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
}

/**
 * Check if a value looks like a phone number
 */
function looksLikePhoneNumber(value: string): boolean {
  // Contains at least 7 digits (handles all formats: +1234567890, (123) 456-7890, 1234567890, etc.)
  const digitCount = (value.match(/\d/g) || []).length;
  return digitCount >= 7;
}

/**
 * Set value on a React-controlled input/textarea using the native setter
 * 
 * @param element - The input or textarea element
 * @param value - The value to set
 * @returns true if the value was successfully set and verified, false otherwise
 */
export function setReactInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): boolean {
  try {
    // Get the native input value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    
    // Use the appropriate setter based on element type
    if (element instanceof HTMLInputElement && nativeInputValueSetter) {
      nativeInputValueSetter.call(element, value);
    } else if (element instanceof HTMLTextAreaElement && nativeTextAreaValueSetter) {
      nativeTextAreaValueSetter.call(element, value);
    } else {
      // Fallback to direct assignment
      element.value = value;
    }
    
    // Dispatch events that React listens to (in order of importance)
    // 1. input event - most important for React controlled components
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    
    // 2. change event - for some React forms and non-React forms
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    // 3. blur event - triggers validation and final value commit in some forms
    element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    
    // Verify the value stuck - check multiple sources for phone fields
    let actualValue = element.value;
    
    // For phone fields, also check getAttribute('value') and hidden inputs
    if (element.type === 'tel' || element.name?.toLowerCase().includes('phone')) {
      if (!actualValue || actualValue.trim() === '') {
        actualValue = element.getAttribute('value') || '';
      }
      if (!actualValue || actualValue.trim() === '') {
        const container = element.closest('div, fieldset, form');
        if (container) {
          const hiddenPhone = container.querySelector<HTMLInputElement>(
            'input[type="hidden"][name*="phone"], input[type="hidden"][name*="tel"]'
          );
          if (hiddenPhone) {
            actualValue = hiddenPhone.value;
          }
        }
      }
    }
    
    let success = actualValue === value;
    
    // Special handling for phone numbers - normalize before comparison
    if (!success && looksLikePhoneNumber(value) && looksLikePhoneNumber(actualValue)) {
      const normalizedExpected = normalizePhoneNumber(value);
      const normalizedActual = normalizePhoneNumber(actualValue);
      success = normalizedExpected === normalizedActual;
      
      if (success) {
        console.log(
          `[ReactInput] ✓ Phone number set successfully (formatted). Expected: "${normalizedExpected}", Got: "${normalizedActual}" (displayed: "${actualValue}")`
        );
      }
    }
    
    if (!success) {
      console.warn(
        `[ReactInput] Value verification failed. Expected: "${value}", Got: "${actualValue}"`
      );
    }
    
    return success;
  } catch (err) {
    console.error('[ReactInput] Error setting value:', err);
    return false;
  }
}

/**
 * Set value on a React-controlled input with retry logic
 * 
 * Sometimes React overwrites the value immediately, so we retry a few times
 * 
 * @param element - The input or textarea element
 * @param value - The value to set
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @returns true if the value was successfully set, false otherwise
 */
export async function setReactInputValueWithRetry(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  maxRetries: number = 3
): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const success = setReactInputValue(element, value);
    
    if (success) {
      console.log(`[ReactInput] ✓ Value set successfully on attempt ${attempt + 1}`);
      return true;
    }
    
    // Wait a bit before retrying (React might be re-rendering)
    if (attempt < maxRetries - 1) {
      console.log(`[ReactInput] Retry ${attempt + 1}/${maxRetries - 1}...`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  console.error(`[ReactInput] ✗ Failed to set value after ${maxRetries} attempts`);
  return false;
}

/**
 * Set checkbox/radio value for React-controlled inputs
 */
export function setReactCheckboxValue(
  element: HTMLInputElement,
  checked: boolean
): boolean {
  try {
    // Get the native checked setter
    const nativeCheckboxSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'checked'
    )?.set;
    
    if (nativeCheckboxSetter) {
      nativeCheckboxSetter.call(element, checked);
    } else {
      element.checked = checked;
    }
    
    // Dispatch events
    element.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    // Verify
    const success = element.checked === checked;
    
    if (!success) {
      console.warn(
        `[ReactInput] Checkbox verification failed. Expected: ${checked}, Got: ${element.checked}`
      );
    }
    
    return success;
  } catch (err) {
    console.error('[ReactInput] Error setting checkbox:', err);
    return false;
  }
}

/**
 * Set select dropdown value for React-controlled selects
 */
export function setReactSelectValue(
  element: HTMLSelectElement,
  value: string
): boolean {
  try {
    // Get the native value setter
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    )?.set;
    
    if (nativeSelectValueSetter) {
      nativeSelectValueSetter.call(element, value);
    } else {
      element.value = value;
    }
    
    // Dispatch events
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    // Verify
    const success = element.value === value;
    
    if (!success) {
      console.warn(
        `[ReactInput] Select verification failed. Expected: "${value}", Got: "${element.value}"`
      );
    }
    
    return success;
  } catch (err) {
    console.error('[ReactInput] Error setting select:', err);
    return false;
  }
}

// ============================================================================
// Superfill.ai-inspired Human-Like Typing & Smart Fill
// ============================================================================

/**
 * Small async delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fill an input/textarea with human-like typing simulation.
 * Types character-by-character with random delays, dispatching proper
 * keydown/input/keyup events for each character. This approach is
 * more compatible with React-controlled inputs and other framework
 * event systems than bulk value setting.
 * 
 * Inspired by superfill.ai's fill-handler approach.
 * 
 * @param element - The input or textarea to fill
 * @param value - The value to type
 * @param options - Typing speed options
 * @returns true if the value was successfully set
 */
export async function fillWithHumanTyping(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options: { 
    baseDelay?: number;    // Base delay between keystrokes (ms), default 25
    jitter?: number;       // Random jitter range (ms), default 15
    initialDelay?: number; // Delay before starting to type (ms), default 50
    clearFirst?: boolean;  // Whether to clear existing value first, default true
  } = {}
): Promise<boolean> {
  const {
    baseDelay = 25,
    jitter = 15,
    initialDelay = 50,
    clearFirst = true,
  } = options;
  
  try {
    // Focus the element
    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    
    await delay(initialDelay);
    
    // Clear existing value if requested
    if (clearFirst) {
      // Use native setter to clear
      const proto = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }
      
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: '',
        inputType: 'deleteContentBackward',
      }));
      
      await delay(30);
    }
    
    // Type each character
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      
      // keydown
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
      
      // keypress (deprecated but some React versions still listen for it)
      element.dispatchEvent(new KeyboardEvent('keypress', {
        key: char,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        cancelable: true,
        composed: true,
      }));
      
      // Update value character by character using native setter
      const proto = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      
      const newValue = value.substring(0, i + 1);
      if (nativeSetter) {
        nativeSetter.call(element, newValue);
      } else {
        element.value = newValue;
      }
      
      // input event (this is what React listens to most)
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: char,
        inputType: 'insertText',
        composed: true,
      }));
      
      // keyup
      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        charCode: char.charCodeAt(0),
        keyCode: char.charCodeAt(0),
        which: char.charCodeAt(0),
        bubbles: true,
        composed: true,
      }));
      
      // Random human-like delay between keystrokes
      await delay(baseDelay + Math.random() * jitter);
    }
    
    // Final events after typing is complete
    await delay(initialDelay);
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    
    // Verify
    const actualValue = element.value;
    const success = actualValue === value;
    
    if (!success) {
      console.warn(
        `[HumanTyping] Value verification failed. Expected: "${value}", Got: "${actualValue}"`
      );
    }
    
    return success;
  } catch (err) {
    console.error('[HumanTyping] Error during typing simulation:', err);
    return false;
  }
}

/**
 * Smart fill: tries human-like typing first, falls back to native setter.
 * This is the recommended way to fill form fields as it handles
 * React, Angular, Vue, and plain HTML forms.
 * 
 * Strategy (inspired by superfill.ai):
 * 1. Try human-like typing (best React compatibility)
 * 2. Fall back to native setter with events (faster, still works with most React)
 * 3. Fall back to direct value assignment (last resort)
 * 
 * @param element - The input or textarea to fill
 * @param value - The value to set
 * @returns true if the value was successfully set
 */
export async function smartFillField(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): Promise<boolean> {
  // For short values (< 50 chars), use human-like typing for best compatibility
  if (value.length < 50) {
    const typingSuccess = await fillWithHumanTyping(element, value);
    if (typingSuccess) {
      console.log(`[SmartFill] ✓ Human typing succeeded for "${value.substring(0, 30)}..."`);
      return true;
    }
    console.log('[SmartFill] Human typing failed, falling back to native setter');
  }
  
  // For long values or if typing failed, use native setter (much faster)
  const nativeSuccess = setReactInputValue(element, value);
  if (nativeSuccess) {
    console.log(`[SmartFill] ✓ Native setter succeeded`);
    return true;
  }
  
  // Final retry with native setter + retry logic
  console.log('[SmartFill] Native setter failed, trying with retry');
  return await setReactInputValueWithRetry(element, value, 3);
}

/**
 * Fill a React Select (combobox) field by simulating user interaction.
 * Opens the dropdown, types to filter, and clicks the matching option.
 * 
 * Inspired by superfill.ai's fillReactSelect approach.
 * 
 * @param element - The input element with role="combobox" or inside a React Select
 * @param value - The value to select
 * @returns true if successfully selected
 */
export async function fillReactSelectField(
  element: HTMLInputElement,
  value: string
): Promise<boolean> {
  try {
    console.log(`[ReactSelect] Attempting to fill with value "${value}"`);
    
    // Step 1: Focus and open the dropdown
    element.focus();
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    
    // Try clicking the control container to open dropdown
    const controlContainer = element.closest('[class*="control"]');
    if (controlContainer) {
      controlContainer.dispatchEvent(new MouseEvent('mousedown', { 
        bubbles: true, cancelable: true 
      }));
    }
    
    element.dispatchEvent(new MouseEvent('mousedown', { 
      bubbles: true, cancelable: true 
    }));
    
    await delay(200);
    
    // Step 2: Look for the dropdown menu
    let menuEl: Element | null = null;
    
    // Check aria-controls for the listbox
    const listboxId = element.getAttribute('aria-controls');
    if (listboxId) {
      menuEl = document.getElementById(listboxId);
    }
    
    // Fallback: look for menu elements
    if (!menuEl) {
      menuEl = document.querySelector(
        '[class*="menu"]:not([class*="menu-"]), [class*="-menu"], .select__menu, [class*="listbox"]'
      );
    }
    
    // Step 3: Try to find and click an option directly
    let options: HTMLElement[] = [];
    
    if (menuEl) {
      options = Array.from(menuEl.querySelectorAll<HTMLElement>(
        '[class*="option"], [role="option"]'
      ));
    } else {
      options = Array.from(document.querySelectorAll<HTMLElement>(
        '[class*="select__option"], [id*="react-select"][id*="option"], [role="option"]'
      ));
    }
    
    console.log(`[ReactSelect] Found ${options.length} options`);
    
    // Try exact match first, then partial match
    const normalizedValue = value.toLowerCase().trim();
    let matchedOption: HTMLElement | null = null;
    
    for (const option of options) {
      const optionText = option.textContent?.toLowerCase().trim() || '';
      if (optionText === normalizedValue) {
        matchedOption = option;
        break;
      }
      if (!matchedOption && optionText.includes(normalizedValue)) {
        matchedOption = option;
      }
    }
    
    if (matchedOption) {
      console.log(`[ReactSelect] ✓ Found match: "${matchedOption.textContent?.trim()}"`);
      matchedOption.dispatchEvent(new MouseEvent('mousedown', { 
        bubbles: true, cancelable: true 
      }));
      await delay(50);
      matchedOption.click();
      return true;
    }
    
    // Step 4: Type to filter options
    console.log('[ReactSelect] No direct match, typing to filter...');
    
    // Clear existing value
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )?.set;
    
    if (nativeSetter) {
      nativeSetter.call(element, '');
    } else {
      element.value = '';
    }
    
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '',
      inputType: 'deleteContentBackward',
    }));
    
    // Type the value character by character
    for (const char of value) {
      element.dispatchEvent(new KeyboardEvent('keydown', { 
        key: char, bubbles: true 
      }));
      
      element.value += char;
      
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: char,
        inputType: 'insertText',
      }));
      
      await delay(30 + Math.random() * 20);
    }
    
    await delay(300);
    
    // Step 5: Select from filtered options
    const filteredOptions = document.querySelectorAll<HTMLElement>(
      '[class*="select__option"], [id*="react-select"][id*="option"], [role="option"]'
    );
    
    console.log(`[ReactSelect] Found ${filteredOptions.length} filtered options`);
    
    if (filteredOptions.length > 0) {
      // Find best match among filtered options
      let bestMatch: HTMLElement | null = null;
      let bestScore = 0;
      
      for (const opt of filteredOptions) {
        const text = opt.textContent?.toLowerCase().trim() || '';
        let score = 0;
        
        if (text === normalizedValue) {
          score = 10000;
        } else if (text.includes(normalizedValue)) {
          score = 5000 - text.length; // Prefer shorter matches
        } else if (normalizedValue.includes(text)) {
          score = 3000 - Math.abs(text.length - normalizedValue.length);
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = opt;
        }
      }
      
      if (bestMatch) {
        console.log(`[ReactSelect] ✓ Clicking filtered option: "${bestMatch.textContent?.trim()}"`);
        bestMatch.dispatchEvent(new MouseEvent('mousedown', { 
          bubbles: true, cancelable: true 
        }));
        await delay(50);
        bestMatch.click();
        return true;
      }
      
      // Just click the first option as last resort
      const firstOption = filteredOptions[0];
      console.log(`[ReactSelect] Clicking first filtered option: "${firstOption.textContent?.trim()}"`);
      firstOption.dispatchEvent(new MouseEvent('mousedown', { 
        bubbles: true, cancelable: true 
      }));
      await delay(50);
      firstOption.click();
      return true;
    }
    
    // Step 6: Press Enter as final fallback
    element.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
    }));
    
    console.log('[ReactSelect] Pressed Enter as fallback');
    return true;
    
  } catch (err) {
    console.error('[ReactSelect] Error filling:', err);
    return false;
  }
}

/**
 * Fill a native <select> dropdown with value matching.
 * Tries exact match, then case-insensitive match, then partial match.
 * 
 * @param element - The select element
 * @param value - The value to select
 * @returns true if a matching option was found and selected
 */
export function fillNativeSelect(
  element: HTMLSelectElement,
  value: string
): boolean {
  const normalizedValue = value.toLowerCase().trim();
  let matched = false;
  
  // Try exact value match
  for (const option of Array.from(element.options)) {
    if (option.value === value || option.text === value) {
      option.selected = true;
      matched = true;
      break;
    }
  }
  
  // Try case-insensitive match
  if (!matched) {
    for (const option of Array.from(element.options)) {
      if (option.value.toLowerCase() === normalizedValue || 
          option.text.toLowerCase() === normalizedValue) {
        option.selected = true;
        matched = true;
        break;
      }
    }
  }
  
  // Try partial match
  if (!matched) {
    for (const option of Array.from(element.options)) {
      const optionText = option.text.toLowerCase();
      if (optionText.includes(normalizedValue) || normalizedValue.includes(optionText)) {
        option.selected = true;
        matched = true;
        break;
      }
    }
  }
  
  if (!matched) {
    console.warn(`[NativeSelect] No option matching "${value}" in select ${element.name || element.id}`);
    // Use native setter as last resort
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype, 'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }
  }
  
  // Dispatch events
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  
  return matched;
}
