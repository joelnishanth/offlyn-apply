/**
 * Field data validator - ensures data matches field context
 * Prevents filling wrong data in fields (like location in race field)
 */

import type { FieldSchema } from './types';

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  suggestedFix?: string;
}

/**
 * Common patterns that indicate wrong data
 */
const LOCATION_PATTERNS = [
  /palo alto/i,
  /california/i,
  /san francisco/i,
  /new york/i,
  /\d{5}/, // ZIP codes
  /, [A-Z]{2}$/, // City, ST format
];

const WORK_AUTH_PATTERNS = [
  /resident/i,
  /citizen/i,
  /sponsorship/i,
  /visa/i,
  /h-1b/i,
  /opt/i,
  /cpt/i,
];

const NUMBER_ONLY_PATTERN = /^\d+$/;

const URL_PATTERN = /^https?:\/\//i;

/**
 * Validate if a value is appropriate for a field
 */
export function validateFieldData(
  field: FieldSchema,
  value: string | boolean,
  fieldType?: string
): ValidationResult {
  // Convert to string for validation
  const valueStr = String(value).trim();
  
  if (!valueStr) {
    return { isValid: true }; // Empty is valid (might be optional)
  }
  
  const label = (field.label || field.name || field.id || '').toLowerCase();
  
  // Validate based on field type
  
  // 1. Self-ID fields should not contain location data
  if (isSelfIdField(label)) {
    if (containsLocationData(valueStr)) {
      console.warn(`[Validator] 🚫 Self-ID field "${field.label}" rejected:`, {
        attemptedValue: valueStr,
        reason: 'Contains location data',
        fieldLabel: field.label,
        fieldName: field.name,
        fieldId: field.id
      });
      return {
        isValid: false,
        reason: 'Self-ID field contains location data',
        suggestedFix: undefined
      };
    }
    
    if (containsWorkAuthData(valueStr)) {
      console.warn(`[Validator] 🚫 Self-ID field "${field.label}" rejected:`, {
        attemptedValue: valueStr,
        reason: 'Contains work authorization data',
        fieldLabel: field.label,
        fieldName: field.name,
        fieldId: field.id
      });
      return {
        isValid: false,
        reason: 'Self-ID field contains work authorization data',
        suggestedFix: undefined
      };
    }
  }
  
  // 2. Education fields (school, degree, discipline)
  if (isEducationField(label)) {
    if (containsLocationData(valueStr) && !label.includes('location')) {
      return {
        isValid: false,
        reason: 'Education field contains location data',
        suggestedFix: undefined
      };
    }
    
    if (NUMBER_ONLY_PATTERN.test(valueStr)) {
      return {
        isValid: false,
        reason: 'Education field contains only numbers',
        suggestedFix: undefined
      };
    }
    
    if (valueStr.length < 2) {
      return {
        isValid: false,
        reason: 'Education field value too short',
        suggestedFix: undefined
      };
    }
  }
  
  // 3. Location/Country fields should not contain work auth or self-id data
  if (isLocationField(label)) {
    if (containsWorkAuthData(valueStr)) {
      return {
        isValid: false,
        reason: 'Location field contains work authorization data',
        suggestedFix: undefined
      };
    }
  }
  
  // 4. Country field should be a country name, not city
  if (label.includes('country') && !label.includes('code')) {
    if (LOCATION_PATTERNS.some(pattern => pattern.test(valueStr)) && 
        !isCountryName(valueStr)) {
      return {
        isValid: false,
        reason: 'Country field contains city/state data',
        suggestedFix: extractCountryFromLocation(valueStr)
      };
    }
  }
  
  // 5. URL fields should be URLs
  if (label.includes('linkedin') || label.includes('website') || label.includes('url') || label.includes('portfolio')) {
    if (!URL_PATTERN.test(valueStr) && valueStr.length > 0) {
      return {
        isValid: false,
        reason: 'URL field does not contain a valid URL',
        suggestedFix: valueStr.includes('.') ? `https://${valueStr}` : undefined
      };
    }
  }
  
  // 6. Dropdown fields with options should match options
  if ('options' in field && Array.isArray((field as any).options)) {
    const options = (field as any).options;
    
    // Check if options look like country codes (e.g. "Afghanistan+93")
    const firstOptions = options.slice(0, 5).join(' ');
    const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions) || 
                                  /[A-Z][a-z]+\+\d/.test(firstOptions);
    
    if (looksLikeCountryCodes) {
      // This is a country code dropdown
      if (!valueStr.includes('+') && !options.some((opt: string) => opt.includes(valueStr))) {
        return {
          isValid: false,
          reason: 'City/location value cannot be filled in country code dropdown',
          suggestedFix: undefined
        };
      }
    }
    
    const hasMatch = options.some((opt: string) => 
      opt.toLowerCase() === valueStr.toLowerCase() ||
      opt.toLowerCase().includes(valueStr.toLowerCase()) ||
      valueStr.toLowerCase().includes(opt.toLowerCase())
    );
    
    if (!hasMatch) {
      return {
        isValid: false,
        reason: `Value "${valueStr}" not found in dropdown options`,
        suggestedFix: findClosestMatch(valueStr, options)
      };
    }
  }
  
  // 7. "Why" questions should not have short/generic answers
  if (label.includes('why')) {
    if (valueStr.length < 20) {
      return {
        isValid: false,
        reason: '"Why" questions require thoughtful answers (too short)',
        suggestedFix: undefined
      };
    }
    
    if (containsLocationData(valueStr) || containsWorkAuthData(valueStr)) {
      return {
        isValid: false,
        reason: '"Why" question contains unrelated data',
        suggestedFix: undefined
      };
    }
  }
  
  return { isValid: true };
}

/**
 * Check if field is a self-ID field
 */
function isSelfIdField(label: string): boolean {
  return (
    label.includes('gender') ||
    label.includes('race') ||
    label.includes('ethnic') ||
    label.includes('orientation') ||
    label.includes('veteran') ||
    label.includes('disability') ||
    label.includes('lgbtq') ||
    label.includes('lgbt')
  );
}

/**
 * Check if field is an education field
 */
function isEducationField(label: string): boolean {
  return (
    label.includes('school') ||
    label.includes('degree') ||
    label.includes('discipline') ||
    label.includes('major') ||
    label.includes('university') ||
    label.includes('college')
  );
}

/**
 * Check if field is a location field
 */
function isLocationField(label: string): boolean {
  return (
    label.includes('location') ||
    label.includes('city') ||
    label.includes('address') ||
    label.includes('country')
  );
}

/**
 * Check if value contains location data
 */
function containsLocationData(value: string): boolean {
  return LOCATION_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if value contains work authorization data
 */
function containsWorkAuthData(value: string): boolean {
  return WORK_AUTH_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Check if value is a country name
 */
function isCountryName(value: string): boolean {
  const countries = [
    'united states', 'usa', 'us', 'canada', 'mexico', 'uk', 'united kingdom',
    'india', 'china', 'japan', 'germany', 'france', 'italy', 'spain',
    'brazil', 'australia', 'russia', 'south korea', 'indonesia', 'netherlands'
    // Add more as needed
  ];
  
  const valueLower = value.toLowerCase();
  return countries.some(country => valueLower === country || valueLower.includes(country));
}

/**
 * Try to extract country from location string
 */
function extractCountryFromLocation(location: string): string | undefined {
  // Simple heuristic: if it contains US state, return "United States"
  const usStates = ['california', 'new york', 'texas', 'florida', 'illinois'];
  const locationLower = location.toLowerCase();
  
  if (usStates.some(state => locationLower.includes(state))) {
    return 'United States';
  }
  
  return undefined;
}

/**
 * Find closest match in options using simple string similarity
 */
function findClosestMatch(value: string, options: string[]): string | undefined {
  const valueLower = value.toLowerCase();
  
  // Try exact substring match first
  const exactMatch = options.find(opt => 
    opt.toLowerCase().includes(valueLower) || valueLower.includes(opt.toLowerCase())
  );
  
  if (exactMatch) {
    return exactMatch;
  }
  
  // Try word-level matching
  const valueWords = valueLower.split(/\s+/);
  
  let bestMatch: string | undefined;
  let bestScore = 0;
  
  for (const option of options) {
    const optionLower = option.toLowerCase();
    const optionWords = optionLower.split(/\s+/);
    
    let score = 0;
    for (const vWord of valueWords) {
      if (optionWords.some(oWord => oWord.includes(vWord) || vWord.includes(oWord))) {
        score++;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = option;
    }
  }
  
  return bestScore > 0 ? bestMatch : undefined;
}

/**
 * Validate multiple fields at once
 */
export function validateBatchFieldData(
  fields: FieldSchema[],
  values: Map<string, string | boolean>
): Map<string, ValidationResult> {
  const results = new Map<string, ValidationResult>();
  
  for (const field of fields) {
    const value = values.get(field.selector);
    if (value !== undefined) {
      results.set(field.selector, validateFieldData(field, value));
    }
  }
  
  return results;
}

/**
 * Get validation warnings for display
 */
export function getValidationWarnings(
  validationResults: Map<string, ValidationResult>
): Array<{ selector: string; reason: string; suggestedFix?: string }> {
  const warnings: Array<{ selector: string; reason: string; suggestedFix?: string }> = [];
  
  for (const [selector, result] of validationResults) {
    if (!result.isValid) {
      warnings.push({
        selector,
        reason: result.reason || 'Validation failed',
        suggestedFix: result.suggestedFix
      });
    }
  }
  
  return warnings;
}
