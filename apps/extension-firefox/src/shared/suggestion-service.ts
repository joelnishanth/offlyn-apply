/**
 * Suggestion service - shows intelligent suggestions before auto-filling
 * Similar to superfill.ai's approach: suggest appropriate answers from stored data
 */

import type { FieldSchema } from './types';
import type { UserProfile } from './profile';
import { getBestAnswerForContext, getAllVariations, detectFieldType } from './context-aware-storage';
import { inferFieldValue } from './ollama-service';
import { validateFieldData } from './field-data-validator';

export interface FieldSuggestion {
  selector: string;
  field: FieldSchema;
  suggestions: SuggestionOption[];
  confidence: number;
  reasoning: string;
}

export interface SuggestionOption {
  id: string;
  value: string;
  source: 'profile' | 'contextual' | 'ai' | 'learned';
  confidence: number;
  reasoning: string;
  isPrimary: boolean; // Primary suggestion (best match)
}

export interface SuggestionContext {
  company?: string;
  jobTitle?: string;
  industry?: string;
  url: string;
}

/**
 * Generate suggestions for a field
 */
export async function generateFieldSuggestions(
  field: FieldSchema,
  profile: UserProfile,
  context: SuggestionContext,
  useAI: boolean = true
): Promise<FieldSuggestion | null> {
  const suggestions: SuggestionOption[] = [];
  
  // Get field context
  const fieldLabel = field.label || field.name || field.id || '';
  const fieldType = detectFieldType(
    fieldLabel,
    field.placeholder || '',
    field.type || ''
  );
  
  // 1. Check contextual storage for this field type
  const contextualAnswer = await getBestAnswerForContext(fieldType, {
    company: context.company,
    jobTitle: context.jobTitle,
    industry: context.industry
  });
  
  if (contextualAnswer) {
    // Validate before adding
    const validation = validateFieldData(field, contextualAnswer, fieldType);
    if (validation.isValid) {
      suggestions.push({
        id: 'contextual_1',
        value: contextualAnswer,
        source: 'contextual',
        confidence: 0.9,
        reasoning: 'Previously used answer for similar context',
        isPrimary: true
      });
    } else {
      console.warn(`[Suggestions] Contextual answer failed validation: ${validation.reason}`);
    }
  }
  
  // 2. Get other variations from contextual storage
  const allVariations = await getAllVariations(fieldType);
  allVariations.slice(0, 3).forEach((variation, idx) => {
    if (variation.value !== contextualAnswer) {
      // Validate before adding
      const validation = validateFieldData(field, variation.value, fieldType);
      if (validation.isValid) {
        suggestions.push({
          id: `contextual_${idx + 2}`,
          value: variation.value,
          source: 'contextual',
          confidence: 0.7 - (idx * 0.1),
          reasoning: `Alternative from your saved answers`,
          isPrimary: false
        });
      }
    }
  });
  
  // 3. Try basic profile matching
  const profileValue = matchFieldToProfileData(field, profile);
  if (profileValue && !suggestions.some(s => s.value === String(profileValue))) {
    // Validate before adding
    const validation = validateFieldData(field, String(profileValue));
    if (validation.isValid) {
      suggestions.push({
        id: 'profile_1',
        value: String(profileValue),
        source: 'profile',
        confidence: 0.85,
        reasoning: 'From your profile',
        isPrimary: suggestions.length === 0
      });
    } else if (validation.suggestedFix) {
      // Try the suggested fix
      const retryValidation = validateFieldData(field, validation.suggestedFix);
      if (retryValidation.isValid) {
        suggestions.push({
          id: 'profile_1_fixed',
          value: validation.suggestedFix,
          source: 'profile',
          confidence: 0.75,
          reasoning: 'From your profile (adjusted)',
          isPrimary: suggestions.length === 0
        });
      }
    }
  }
  
  // 4. Use AI inference if enabled and no high-confidence suggestions yet
  if (useAI && (suggestions.length === 0 || suggestions[0].confidence < 0.8)) {
    try {
      const aiValue = await inferFieldValue(
        fieldLabel,
        field.type || '',
        field.placeholder || '',
        {
          personal: profile.personal,
          professional: profile.professional,
          skills: profile.skills,
          work: profile.work.slice(0, 2),
          education: profile.education.slice(0, 2),
          summary: profile.summary
        },
        'options' in field ? (field as any).options : undefined
      );
      
      if (aiValue && !suggestions.some(s => s.value === aiValue)) {
        // Validate AI-generated value
        const validation = validateFieldData(field, aiValue, fieldType);
        if (validation.isValid) {
          suggestions.push({
            id: 'ai_1',
            value: aiValue,
            source: 'ai',
            confidence: 0.75,
            reasoning: 'AI-generated based on your profile',
            isPrimary: suggestions.length === 0
          });
        } else {
          console.warn(`[Suggestions] AI value failed validation: ${validation.reason}`);
          
          // Try suggested fix
          if (validation.suggestedFix) {
            const retryValidation = validateFieldData(field, validation.suggestedFix, fieldType);
            if (retryValidation.isValid) {
              suggestions.push({
                id: 'ai_1_fixed',
                value: validation.suggestedFix,
                source: 'ai',
                confidence: 0.65,
                reasoning: 'AI-generated (adjusted)',
                isPrimary: suggestions.length === 0
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('AI inference failed:', err);
    }
  }
  
  // No suggestions found
  if (suggestions.length === 0) {
    return null;
  }
  
  // Ensure we have a primary suggestion
  if (!suggestions.some(s => s.isPrimary)) {
    suggestions[0].isPrimary = true;
  }
  
  // Calculate overall confidence (based on primary suggestion)
  const primarySuggestion = suggestions.find(s => s.isPrimary) || suggestions[0];
  
  return {
    selector: field.selector,
    field,
    suggestions,
    confidence: primarySuggestion.confidence,
    reasoning: primarySuggestion.reasoning
  };
}

/**
 * Generate suggestions for multiple fields
 */
export async function generateBatchSuggestions(
  fields: FieldSchema[],
  profile: UserProfile,
  context: SuggestionContext,
  useAI: boolean = true
): Promise<FieldSuggestion[]> {
  const suggestions: FieldSuggestion[] = [];
  
  // Process fields in parallel (limit to 5 at a time to avoid overwhelming)
  const batchSize = 5;
  for (let i = 0; i < fields.length; i += batchSize) {
    const batch = fields.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(field => generateFieldSuggestions(field, profile, context, useAI))
    );
    
    suggestions.push(...batchResults.filter((s): s is FieldSuggestion => s !== null));
  }
  
  return suggestions;
}

/**
 * Match field to profile data (basic matching logic)
 */
function matchFieldToProfileData(field: FieldSchema, profile: UserProfile): string | boolean | null {
  const label = (field.label || field.name || field.id || '').toLowerCase();
  const name = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  
  // Basic profile fields
  if (matchesAny([label, name, id], ['first', 'fname', 'firstname', 'given'])) {
    return profile.personal.firstName;
  }
  
  if (matchesAny([label, name, id], ['last', 'lname', 'lastname', 'family', 'surname'])) {
    return profile.personal.lastName;
  }
  
  if (matchesAny([label, name, id], ['email', 'e-mail', 'mail'])) {
    return profile.personal.email;
  }
  
  if (matchesAny([label, name, id], ['phone', 'mobile', 'tel', 'telephone'])) {
    return profile.personal.phone;
  }
  
  if (matchesAny([label, name, id], ['location', 'city', 'address'])) {
    return profile.personal.location || '';
  }
  
  if (matchesAny([label, name, id], ['linkedin'])) {
    return profile.professional.linkedin || '';
  }
  
  if (matchesAny([label, name, id], ['github'])) {
    return profile.professional.github || '';
  }
  
  if (matchesAny([label, name, id], ['portfolio', 'website'])) {
    return profile.professional.portfolio || '';
  }
  
  if (matchesAny([label, name, id], ['experience', 'years'])) {
    return profile.professional.yearsOfExperience?.toString() || '';
  }
  
  // For textarea fields, try summary
  if (field.tagName === 'TEXTAREA' && matchesAny([label, name, id], ['cover', 'summary', 'about', 'bio'])) {
    return profile.summary || '';
  }
  
  return null;
}

/**
 * Check if any of the texts match any of the patterns
 */
function matchesAny(texts: string[], patterns: string[]): boolean {
  for (const text of texts) {
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Filter suggestions by confidence threshold
 */
export function filterSuggestionsByConfidence(
  suggestions: FieldSuggestion[],
  minConfidence: number = 0.6
): FieldSuggestion[] {
  return suggestions.filter(s => s.confidence >= minConfidence);
}

/**
 * Get primary suggestions only (one per field)
 */
export function getPrimarySuggestions(suggestions: FieldSuggestion[]): Map<string, SuggestionOption> {
  const primary = new Map<string, SuggestionOption>();
  
  for (const suggestion of suggestions) {
    const primaryOption = suggestion.suggestions.find(s => s.isPrimary) || suggestion.suggestions[0];
    if (primaryOption) {
      primary.set(suggestion.selector, primaryOption);
    }
  }
  
  return primary;
}

/**
 * Sort suggestions by confidence (highest first)
 */
export function sortSuggestionsByConfidence(suggestions: FieldSuggestion[]): FieldSuggestion[] {
  return [...suggestions].sort((a, b) => b.confidence - a.confidence);
}
