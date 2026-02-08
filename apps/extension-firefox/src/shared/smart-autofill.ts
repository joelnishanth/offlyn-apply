/**
 * Smart autofill using Ollama embeddings for field matching
 */

import type { FieldSchema, FillMapping } from './types';
import type { UserProfile } from './profile';

export interface UnfilledField {
  field: FieldSchema;
  context: FieldContext;
  reason: string;
}

export interface FieldContext {
  label: string;
  placeholder: string;
  nearbyText: string;
  fieldType: string;
  options?: string[]; // For select/dropdown fields
  currentValue: string;
}

export interface SmartFillSuggestion {
  selector: string;
  suggestedValue: string;
  confidence: number;
  reasoning: string;
}

/**
 * Analyze unfilled fields and gather context
 */
export function analyzeUnfilledFields(
  allFields: FieldSchema[],
  filledSelectors: Set<string>
): UnfilledField[] {
  const unfilled: UnfilledField[] = [];

  for (const field of allFields) {
    // Check if field is actually filled by checking DOM value
    const element = document.querySelector(field.selector);
    let hasValue = false;
    
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      hasValue = element.value && element.value.trim() !== '';
    } else if (element instanceof HTMLSelectElement) {
      hasValue = element.value && element.value !== '';
    }
    
    // Skip if already filled (check both filledSelectors and actual DOM value)
    if (filledSelectors.has(field.selector) && hasValue) {
      continue;
    }
    
    // If it's in filledSelectors but has no value, it failed - remove from set
    if (filledSelectors.has(field.selector) && !hasValue) {
      console.log('[SmartAutofill] Field marked as filled but has no value:', field.label);
      filledSelectors.delete(field.selector);
    }

    // Skip hidden or disabled fields
    if (field.disabled) {
      continue;
    }

    // Skip file inputs (handled separately)
    if (field.type === 'file') {
      continue;
    }

    // Gather context for this field
    const context = gatherFieldContext(field);

    unfilled.push({
      field,
      context,
      reason: determineUnfilledReason(field, context)
    });
  }

  return unfilled;
}

/**
 * Gather rich context about a field
 */
function gatherFieldContext(field: FieldSchema): FieldContext {
  const element = document.querySelector(field.selector);
  
  let options: string[] | undefined;
  if (element instanceof HTMLSelectElement) {
    options = Array.from(element.options)
      .map(opt => opt.textContent?.trim() || opt.value)
      .filter(Boolean);
  }

  // Get nearby text (labels, legends, hints)
  let nearbyText = '';
  if (element) {
    const parent = element.closest('div, fieldset, section');
    if (parent) {
      // Get text content but exclude the field's own value
      const clone = parent.cloneNode(true) as HTMLElement;
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(input => input.remove());
      nearbyText = clone.textContent?.trim() || '';
    }
  }

  return {
    label: field.label || '',
    placeholder: element instanceof HTMLInputElement ? element.placeholder : '',
    nearbyText,
    fieldType: field.type || field.tagName,
    options,
    currentValue: field.valuePreview || ''
  };
}

/**
 * Determine why a field wasn't filled
 */
function determineUnfilledReason(field: FieldSchema, context: FieldContext): string {
  if (context.options && context.options.length > 0) {
    return 'dropdown_no_match';
  }
  
  if (field.type === 'checkbox' || field.type === 'radio') {
    return 'checkbox_radio_no_match';
  }
  
  if (context.label || context.nearbyText) {
    return 'no_profile_data_match';
  }
  
  return 'unknown_field_type';
}

/**
 * Build prompt for Ollama to understand field intent
 */
export function buildFieldAnalysisPrompt(
  unfilledFields: UnfilledField[],
  profile: UserProfile
): string {
  const profileSummary = {
    name: `${profile.personal.firstName} ${profile.personal.lastName}`,
    email: profile.personal.email,
    phone: profile.personal.phone,
    location: profile.personal.location,
    experience: profile.professional.yearsOfExperience,
    skills: profile.skills.join(', '),
    summary: profile.summary,
    work: profile.work.map(w => `${w.title} at ${w.company}`).join('; '),
    education: profile.education.map(e => `${e.degree} in ${e.field} from ${e.school}`).join('; '),
    selfId: profile.selfId
  };

  let prompt = `You are a job application assistant. Help fill out form fields based on the candidate's profile.

CANDIDATE PROFILE:
${JSON.stringify(profileSummary, null, 2)}

UNFILLED FIELDS:
`;

  unfilledFields.forEach((unfilled, index) => {
    const { field, context } = unfilled;
    prompt += `\n${index + 1}. Field: ${field.selector}
   Label: "${context.label}"
   Placeholder: "${context.placeholder}"
   Type: ${context.fieldType}
   Nearby text: "${context.nearbyText.substring(0, 200)}"`;
    
    if (context.options && context.options.length > 0) {
      prompt += `\n   Available options: ${context.options.slice(0, 10).join(', ')}`;
    }
  });

  prompt += `\n\nFor each field, provide:
1. What the field is asking for
2. The best value from the candidate's profile
3. Confidence level (0-1)
4. Brief reasoning

Respond in JSON format:
{
  "fields": [
    {
      "fieldIndex": 0,
      "intent": "asking for years of experience",
      "suggestedValue": "5",
      "confidence": 0.9,
      "reasoning": "Profile shows 5 years experience"
    }
  ]
}`;

  return prompt;
}

/**
 * Build embedding-based prompts for each field
 */
export function buildEmbeddingPrompts(unfilledFields: UnfilledField[]): Map<string, string> {
  const prompts = new Map<string, string>();

  for (const unfilled of unfilledFields) {
    const { field, context } = unfilled;
    
    // Create a rich text representation of what this field is asking
    const fieldDescription = [
      context.label,
      context.placeholder,
      context.nearbyText.substring(0, 100)
    ].filter(Boolean).join(' | ');

    prompts.set(field.selector, fieldDescription);
  }

  return prompts;
}

/**
 * Match dropdown options using embeddings
 */
export async function matchDropdownOption(
  fieldContext: FieldContext,
  profileValue: string,
  embeddings: Map<string, number[]>
): Promise<string | null> {
  if (!fieldContext.options || fieldContext.options.length === 0) {
    return null;
  }

  // Simple text matching first
  const exactMatch = fieldContext.options.find(
    opt => opt.toLowerCase() === profileValue.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Partial match
  const partialMatch = fieldContext.options.find(
    opt => opt.toLowerCase().includes(profileValue.toLowerCase()) ||
           profileValue.toLowerCase().includes(opt.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  // If we have embeddings, use cosine similarity
  if (embeddings.size > 0) {
    // This would require embedding computation
    // For now, return best fuzzy match
  }

  return null;
}

/**
 * Analyze Self-ID fields that weren't matched
 */
export function analyzeUnmatchedSelfIdFields(
  unfilledFields: UnfilledField[],
  profile: UserProfile
): UnfilledField[] {
  if (!profile.selfId) return [];

  return unfilledFields.filter(unfilled => {
    const { field, context } = unfilled;
    const label = context.label.toLowerCase();
    
    // Check if this is a self-ID field
    return (
      label.includes('gender') ||
      label.includes('race') ||
      label.includes('ethnicity') ||
      label.includes('orientation') ||
      label.includes('veteran') ||
      label.includes('transgender') ||
      label.includes('disability')
    );
  });
}

/**
 * Create smart fill suggestions for self-ID checkboxes using fuzzy matching
 */
export function suggestSelfIdMatches(
  unfilledFields: UnfilledField[],
  profile: UserProfile
): SmartFillSuggestion[] {
  if (!profile.selfId) return [];

  const suggestions: SmartFillSuggestion[] = [];

  for (const unfilled of unfilledFields) {
    const { field, context } = unfilled;
    const label = context.label.toLowerCase();

    // Gender matching with fuzzy logic
    if (label.includes('gender') || label.includes('sex')) {
      for (const gender of profile.selfId.gender) {
        const match = fuzzyMatchFieldValue(
          gender,
          field.valuePreview || '',
          context.label
        );
        
        if (match.confidence > 0.5) {
          suggestions.push({
            selector: field.selector,
            suggestedValue: 'true', // Check the checkbox
            confidence: match.confidence,
            reasoning: `Gender "${gender}" matches field value/label`
          });
        }
      }
    }

    // Race matching with fuzzy logic
    if (label.includes('race') || label.includes('ethnic')) {
      for (const race of profile.selfId.race) {
        const match = fuzzyMatchFieldValue(
          race,
          field.valuePreview || '',
          context.label
        );
        
        if (match.confidence > 0.5) {
          suggestions.push({
            selector: field.selector,
            suggestedValue: 'true',
            confidence: match.confidence,
            reasoning: `Race "${race}" matches field value/label`
          });
        }
      }
    }

    // Orientation matching
    if (label.includes('orientation') || label.includes('sexual')) {
      for (const orientation of profile.selfId.orientation) {
        const match = fuzzyMatchFieldValue(
          orientation,
          field.valuePreview || '',
          context.label
        );
        
        if (match.confidence > 0.5) {
          suggestions.push({
            selector: field.selector,
            suggestedValue: 'true',
            confidence: match.confidence,
            reasoning: `Orientation "${orientation}" matches field value/label`
          });
        }
      }
    }

    // Veteran status
    if (label.includes('veteran') || label.includes('military')) {
      const match = fuzzyMatchFieldValue(
        profile.selfId.veteran,
        field.valuePreview || '',
        context.label
      );
      
      if (match.confidence > 0.5) {
        suggestions.push({
          selector: field.selector,
          suggestedValue: field.type === 'checkbox' ? 'true' : profile.selfId.veteran,
          confidence: match.confidence,
          reasoning: `Veteran status "${profile.selfId.veteran}" matches`
        });
      }
    }

    // Transgender
    if (label.includes('transgender') || label.includes('trans')) {
      const match = fuzzyMatchFieldValue(
        profile.selfId.transgender,
        field.valuePreview || '',
        context.label
      );
      
      if (match.confidence > 0.5) {
        suggestions.push({
          selector: field.selector,
          suggestedValue: field.type === 'checkbox' ? 'true' : profile.selfId.transgender,
          confidence: match.confidence,
          reasoning: `Transgender status "${profile.selfId.transgender}" matches`
        });
      }
    }

    // Disability
    if (label.includes('disability') || label.includes('disabled')) {
      const match = fuzzyMatchFieldValue(
        profile.selfId.disability,
        field.valuePreview || '',
        context.label
      );
      
      if (match.confidence > 0.5) {
        suggestions.push({
          selector: field.selector,
          suggestedValue: field.type === 'checkbox' ? 'true' : profile.selfId.disability,
          confidence: match.confidence,
          reasoning: `Disability status "${profile.selfId.disability}" matches`
        });
      }
    }
  }

  return suggestions;
}

/**
 * Fuzzy match between profile value and field
 */
function fuzzyMatchFieldValue(
  profileValue: string,
  fieldValue: string,
  fieldLabel: string
): { confidence: number; reason: string } {
  const profileLower = profileValue.toLowerCase();
  const fieldValueLower = fieldValue.toLowerCase();
  const fieldLabelLower = fieldLabel.toLowerCase();

  // Exact match
  if (fieldValueLower === profileLower || fieldLabelLower === profileLower) {
    return { confidence: 1.0, reason: 'exact_match' };
  }

  // Field contains profile value
  if (fieldValueLower.includes(profileLower) || fieldLabelLower.includes(profileLower)) {
    return { confidence: 0.9, reason: 'contains_profile_value' };
  }

  // Profile value contains field
  if (profileLower.includes(fieldValueLower) && fieldValueLower.length > 2) {
    return { confidence: 0.8, reason: 'profile_contains_field' };
  }

  // Word-level matching
  const profileWords = profileLower.split(/\s+/);
  const fieldWords = [...fieldValueLower.split(/\s+/), ...fieldLabelLower.split(/\s+/)];
  
  let matchingWords = 0;
  for (const pWord of profileWords) {
    if (pWord.length > 2 && fieldWords.some(fWord => fWord.includes(pWord) || pWord.includes(fWord))) {
      matchingWords++;
    }
  }
  
  if (matchingWords > 0) {
    const confidence = 0.6 + (matchingWords / profileWords.length) * 0.3;
    return { confidence, reason: 'word_match' };
  }

  // Check common synonyms/variations
  const synonyms = getSynonyms(profileLower);
  for (const synonym of synonyms) {
    if (fieldValueLower.includes(synonym) || fieldLabelLower.includes(synonym)) {
      return { confidence: 0.7, reason: 'synonym_match' };
    }
  }

  return { confidence: 0.0, reason: 'no_match' };
}

/**
 * Get common synonyms/variations for Self-ID terms
 */
function getSynonyms(term: string): string[] {
  const synonymMap: Record<string, string[]> = {
    'yes': ['y', 'yeah', 'yep', 'true'],
    'no': ['n', 'nope', 'false'],
    'man': ['male', 'boy'],
    'woman': ['female', 'girl'],
    'asian': ['asian american', 'asian pacific'],
    'black': ['african', 'black or african american'],
    'white': ['caucasian'],
    'hispanic': ['latino', 'latina', 'latinx', 'latin'],
    'gay': ['homosexual'],
    'heterosexual': ['straight', 'hetero'],
    'bisexual': ['bi'],
    'not a veteran': ['non veteran', 'no veteran', 'civilian'],
    'veteran': ['military', 'service member'],
  };

  return synonymMap[term] || [];
}
