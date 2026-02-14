/**
 * Field validation using Ollama
 */

import { inferFieldValue } from './ollama-service';
import type { FieldSchema } from './types';
import type { UserProfile } from './profile';

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  suggestedValue?: string;
  reason: string;
}

/**
 * Normalize URL values before validation
 */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  
  // If empty, return as-is
  if (!trimmed) return trimmed;
  
  // Already has scheme, return as-is
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  
  // Reject obvious invalid values
  if (trimmed === 'www' || trimmed === 'http' || trimmed === 'https') {
    return ''; // Return empty to fail validation
  }
  
  // Check if it looks like a URL (has a dot and no spaces)
  if (trimmed.includes('.') && !trimmed.includes(' ')) {
    // Check if it has a valid TLD
    const parts = trimmed.split('.');
    const lastPart = parts[parts.length - 1].toLowerCase();
    
    // Common TLDs - expand as needed
    const validTlds = ['com', 'org', 'net', 'edu', 'gov', 'io', 'ai', 'co', 'us', 'uk', 'ca', 'dev'];
    
    // Remove trailing slashes/paths for TLD check
    const tld = lastPart.split('/')[0];
    
    if (validTlds.includes(tld) || tld.length >= 2) {
      // Prepend https://
      return `https://${trimmed}`;
    }
  }
  
  // Doesn't look like a URL
  return trimmed;
}

/**
 * Validate if a value makes sense for a field using Ollama
 */
export async function validateFieldValue(
  field: FieldSchema,
  proposedValue: string | boolean,
  profile: UserProfile,
  useOllama: boolean = false
): Promise<ValidationResult> {
  
  // Normalize URL fields before validation
  let normalizedValue = proposedValue;
  if (typeof proposedValue === 'string' && 
      (field.type === 'url' || 
       (field.label || field.name || '').toLowerCase().match(/url|website|link|linkedin|github|portfolio/))) {
    normalizedValue = normalizeUrl(proposedValue);
  }
  
  // Basic validation first (fast, no AI needed)
  const basicValidation = performBasicValidation(field, normalizedValue);
  if (!basicValidation.isValid) {
    return basicValidation;
  }
  
  // If value was normalized (changed), suggest the normalized value
  const wasNormalized = normalizedValue !== proposedValue;
  
  // If Ollama not available or not requested, return basic validation
  if (!useOllama) {
    return {
      isValid: true,
      confidence: 0.8,
      reason: 'Basic validation passed',
      ...(wasNormalized && { suggestedValue: String(normalizedValue) })
    };
  }
  
  // Use Ollama for semantic validation
  try {
    const semanticValidation = await performSemanticValidation(
      field,
      proposedValue,
      profile
    );
    return semanticValidation;
  } catch (err) {
    console.warn('Ollama validation failed, falling back to basic:', err);
    return basicValidation;
  }
}

/**
 * Basic validation without AI
 */
function performBasicValidation(
  field: FieldSchema,
  proposedValue: string | boolean
): ValidationResult {
  const value = String(proposedValue);
  
  // Email validation
  if (field.type === 'email' || 
      (field.label || field.name || '').toLowerCase().includes('email')) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return {
        isValid: false,
        confidence: 1.0,
        reason: 'Invalid email format'
      };
    }
  }
  
  // Phone validation
  if (field.type === 'tel' || 
      (field.label || field.name || '').toLowerCase().includes('phone')) {
    // Basic phone validation (at least 10 digits)
    const digitsOnly = value.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return {
        isValid: false,
        confidence: 1.0,
        reason: 'Phone number too short'
      };
    }
  }
  
  // URL validation
  if (field.type === 'url' || 
      (field.label || field.name || '').toLowerCase().match(/url|website|link|linkedin|github/)) {
    if (value && !value.match(/^https?:\/\/.+/)) {
      return {
        isValid: false,
        confidence: 0.9,
        reason: 'URL should start with http:// or https://'
      };
    }
  }
  
  // Number validation
  if (field.type === 'number') {
    if (isNaN(Number(value))) {
      return {
        isValid: false,
        confidence: 1.0,
        reason: 'Not a valid number'
      };
    }
  }
  
  // Required field validation
  if (field.required && !value) {
    return {
      isValid: false,
      confidence: 1.0,
      reason: 'Required field cannot be empty'
    };
  }
  
  return {
    isValid: true,
    confidence: 0.8,
    reason: 'Basic validation passed'
  };
}

/**
 * Semantic validation using Ollama
 */
async function performSemanticValidation(
  field: FieldSchema,
  proposedValue: string | boolean,
  profile: UserProfile
): Promise<ValidationResult> {
  
  const fieldLabel = field.label || field.name || field.id || 'Unknown field';
  const value = String(proposedValue);
  
  // Build validation prompt
  const prompt = `You are a form validation expert. Analyze if this value makes sense for this form field.

FIELD: "${fieldLabel}"
FIELD TYPE: ${field.type || field.tagName}
PROPOSED VALUE: "${value}"

CONTEXT:
- This is a job application form
- User's name: ${profile.personal.firstName} ${profile.personal.lastName}
- User's email: ${profile.personal.email}
- User's location: ${profile.personal.location}

TASK: Does this value make sense for this field?

Respond in JSON format:
{
  "isValid": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation",
  "suggestedValue": "better value if needed" or null
}`;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt,
        stream: false,
        format: 'json'
      })
    });

    if (!response.ok) {
      throw new Error('Ollama validation request failed');
    }

    const data = await response.json();
    const result = JSON.parse(data.response);
    
    return {
      isValid: result.isValid,
      confidence: result.confidence,
      suggestedValue: result.suggestedValue,
      reason: result.reason
    };
  } catch (err) {
    throw new Error('Semantic validation failed: ' + err);
  }
}

/**
 * Batch validate multiple field-value pairs
 */
export async function batchValidateFields(
  mappings: Array<{ field: FieldSchema; value: string | boolean }>,
  profile: UserProfile,
  useOllama: boolean = false
): Promise<Map<string, ValidationResult>> {
  
  const results = new Map<string, ValidationResult>();
  
  for (const { field, value } of mappings) {
    const validation = await validateFieldValue(field, value, profile, useOllama);
    results.set(field.selector, validation);
  }
  
  return results;
}

/**
 * Get validation summary
 */
export function getValidationSummary(
  validations: Map<string, ValidationResult>
): {
  total: number;
  valid: number;
  invalid: number;
  needsReview: number;
} {
  let valid = 0;
  let invalid = 0;
  let needsReview = 0;
  
  for (const result of validations.values()) {
    if (!result.isValid) {
      invalid++;
    } else if (result.confidence < 0.7) {
      needsReview++;
    } else {
      valid++;
    }
  }
  
  return {
    total: validations.size,
    valid,
    invalid,
    needsReview
  };
}
