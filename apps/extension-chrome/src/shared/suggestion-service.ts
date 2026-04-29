/**
 * Suggestion service - shows intelligent suggestions before auto-filling
 * Similar to superfill.ai's approach: suggest appropriate answers from stored data
 */

import type { FieldSchema } from './types';
import type { UserProfile } from './profile';
import { getBestAnswerForContext, getAllVariations, detectFieldType } from './context-aware-storage';
import { inferFieldValue } from './ollama-service';
import { validateFieldData } from './field-data-validator';
import { rlSystem } from './learning-rl';

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
 * Generate suggestions for a field.
 * `onChunk` is forwarded to the Ollama call so callers can stream partial AI
 * text into the UI while the model is still generating.
 */
export async function generateFieldSuggestions(
  field: FieldSchema,
  profile: UserProfile,
  context: SuggestionContext,
  useAI: boolean = true,
  onChunk?: (partial: string) => void
): Promise<FieldSuggestion | null> {
  const suggestions: SuggestionOption[] = [];
  
  // Get field context
  const fieldLabel = field.label || field.name || field.id || '';
  const fieldType = detectFieldType(
    fieldLabel,
    field.placeholder || '',
    field.type || ''
  );
  
  // 0. Check RL learning system (highest priority, in-memory lookup)
  try {
    const learned = rlSystem.getLearnedValue(field);
    const learnedStr = learned?.value?.trim() ?? '';
    if (learned && learnedStr !== '') {
      // Validate before adding
      const validation = validateFieldData(field, learnedStr, fieldType);
      if (validation.isValid) {
        suggestions.push({
          id: 'learned_1',
          value: learnedStr,
          source: 'learned',
          confidence: Math.min(0.95, learned.confidence + 0.1), // Boost: user explicitly corrected
          reasoning: `Learned from ${learned.patternId ? 'user corrections' : 'past submissions'}`,
          isPrimary: true
        });
        console.log(`[Suggestions] Added RL learned value for "${fieldLabel}": "${learnedStr}" (confidence: ${learned.confidence.toFixed(2)})`);
      }
    }
  } catch (err) {
    console.warn('[Suggestions] Learning system query failed:', err);
  }
  
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
  
  // 3. Try basic profile matching (skipped for long-form fields)
  const profileValue = matchFieldToProfileData(field, profile);
  if (profileValue && !suggestions.some(s => s.value === String(profileValue))) {
    const profileStr = String(profileValue);
    
    // Sanity check: reject obviously wrong matches
    // (e.g. a single number for a textarea, or a very short value for a long question)
    const labelLower = fieldLabel.toLowerCase();
    const isSuspicious = (
      (field.tagName === 'TEXTAREA' && profileStr.length < 20) ||
      (labelLower.length > 80 && profileStr.length < 10) ||
      (labelLower.includes('describe') && profileStr.length < 20) ||
      (labelLower.includes('explain') && profileStr.length < 20)
    );
    
    if (isSuspicious) {
      console.warn(`[Suggestions] Profile value "${profileStr}" looks suspicious for field "${fieldLabel.substring(0, 60)}..." — skipping`);
    } else {
      // Validate before adding
      const validation = validateFieldData(field, profileStr);
      if (validation.isValid) {
        const hasLearnedSuggestion = suggestions.some(s => s.source === 'learned');
        suggestions.push({
          id: 'profile_1',
          value: profileStr,
          source: 'profile',
          confidence: 0.85,
          reasoning: 'From your profile',
          isPrimary: !hasLearnedSuggestion && suggestions.length === 0
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
  }
  
  // 4. Use AI inference if enabled
  //    - Always try AI for long-form / textarea fields (profile data is rarely correct)
  //    - For simple fields, only try if no high-confidence suggestion exists yet
  const isLongForm = isLongFormField(field, fieldLabel.toLowerCase());
  const needsAI = suggestions.length === 0 || suggestions[0].confidence < 0.8 || isLongForm;
  
  if (useAI && needsAI) {
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
        'options' in field ? (field as any).options : undefined,
        onChunk
      );
      
      if (aiValue && !suggestions.some(s => s.value === aiValue)) {
        // Validate AI-generated value
        const validation = validateFieldData(field, aiValue, fieldType);
        if (validation.isValid) {
          // For long-form fields, AI should be primary (it understands the question)
          const aiConfidence = isLongForm ? 0.9 : 0.75;
          const aiIsPrimary = isLongForm || suggestions.length === 0;
          
          // If AI is primary for long-form, demote any existing primaries
          if (aiIsPrimary && isLongForm) {
            for (const s of suggestions) {
              s.isPrimary = false;
            }
          }
          
          suggestions.push({
            id: 'ai_1',
            value: aiValue,
            source: 'ai',
            confidence: aiConfidence,
            reasoning: isLongForm ? 'AI-generated response tailored to this question' : 'AI-generated based on your profile',
            isPrimary: aiIsPrimary
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
 * Match field to profile data (basic matching logic).
 *
 * IMPORTANT: This should only match for simple, unambiguous fields like
 * "First Name", "Email", etc. Long-form / description / textarea fields
 * should NOT be matched to simple profile values — they need AI inference.
 */
function matchFieldToProfileData(field: FieldSchema, profile: UserProfile): string | boolean | null {
  const label = (field.label || field.name || field.id || '').toLowerCase();
  const name = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  
  // Detect if this is a long-form / description field — if so, skip simple profile matching
  // (these need AI inference, not a single profile value)
  if (isLongFormField(field, label)) {
    return null;
  }
  
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
  
  // "Years of experience" — only match if the label is specifically asking for
  // a count/number, NOT if it says "describe your experience"
  if (isYearsOfExperienceField(label, name, id)) {
    return profile.professional.yearsOfExperience?.toString() || '';
  }
  
  // For textarea fields, try summary — but only for short-label summary fields
  if (field.tagName === 'TEXTAREA' && matchesAny([label, name, id], ['cover', 'summary', 'about', 'bio'])) {
    // Only if the label is short (a real "summary" field, not a long question)
    if (label.length < 40) {
      return profile.summary || '';
    }
  }
  
  return null;
}

/**
 * Check if a field is a long-form / description field that needs AI,
 * not simple profile matching.
 */
function isLongFormField(field: FieldSchema, labelLower: string): boolean {
  // Textareas are almost always long-form
  if (field.tagName === 'TEXTAREA') return true;
  
  // Long labels that are actually questions / prompts
  if (labelLower.length > 60) return true;
  
  // Labels that contain description-requesting keywords
  const descriptionKeywords = [
    'describe', 'explain', 'tell us', 'please share', 'elaborate',
    'why are you', 'why do you', 'what is your', 'what are your',
    'how would you', 'how do you', 'how have you',
    'provide detail', 'provide an example', 'share an example',
    'personal or professional', 'projects that', 'working on',
    'cover letter', 'additional information', 'anything else',
    'why anthropic', 'why this', 'why our', 'motivation',
  ];
  
  for (const keyword of descriptionKeywords) {
    if (labelLower.includes(keyword)) return true;
  }
  
  return false;
}

/**
 * Check if the field is specifically asking for years of experience (a number),
 * NOT a description of experience.
 */
function isYearsOfExperienceField(label: string, name: string, id: string): boolean {
  const allText = `${label} ${name} ${id}`;
  
  // Positive: specifically asking for years/count
  const yearsPatterns = [
    'years of experience', 'years experience', 'yrs of experience',
    'how many years', 'number of years', 'total years',
    'years_of_experience', 'yearsofexperience', 'experience_years',
  ];
  
  for (const pattern of yearsPatterns) {
    if (allText.includes(pattern)) return true;
  }
  
  // If name/id explicitly says "years" but label doesn't say "describe"
  if ((name.includes('years') || id.includes('years')) && !label.includes('describe')) {
    return true;
  }
  
  return false;
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
