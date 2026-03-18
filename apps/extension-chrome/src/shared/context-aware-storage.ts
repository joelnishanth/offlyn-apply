/**
 * Context-aware storage for multiple answer variations
 * Similar to superfill.ai - stores different versions of answers for different contexts
 */

import browser from './browser-compat';
import type { UserProfile } from './profile';

export interface ContextualAnswer {
  fieldType: string; // 'cover_letter', 'why_company', 'availability', etc.
  variations: AnswerVariation[];
  defaultVariation?: string; // ID of default variation
}

export interface AnswerVariation {
  id: string;
  value: string;
  context: {
    industry?: string[]; // e.g., ['tech', 'finance']
    companySize?: string[]; // e.g., ['startup', 'enterprise']
    jobLevel?: string[]; // e.g., ['entry', 'senior', 'lead']
    tone?: string; // 'formal', 'casual', 'creative'
  };
  usageCount: number;
  lastUsed: number;
  userRating?: number; // 1-5 stars
}

export interface ContextualStorage {
  answers: Map<string, ContextualAnswer>;
  lastUpdated: number;
}

const CONTEXTUAL_STORAGE_KEY = 'contextualAnswers';

/**
 * Get contextual answers storage
 */
export async function getContextualStorage(): Promise<ContextualStorage> {
  try {
    const result = await browser.storage.local.get(CONTEXTUAL_STORAGE_KEY);
    const data = result[CONTEXTUAL_STORAGE_KEY];
    
    if (!data) {
      return {
        answers: new Map(),
        lastUpdated: Date.now()
      };
    }
    
    // Convert object to Map (storage can't directly store Maps)
    const answers = new Map<string, ContextualAnswer>(
      Object.entries(data.answers || {})
    );
    
    return {
      answers,
      lastUpdated: data.lastUpdated || Date.now()
    };
  } catch (err) {
    console.error('Failed to get contextual storage:', err);
    return {
      answers: new Map(),
      lastUpdated: Date.now()
    };
  }
}

/**
 * Save contextual answers storage
 */
export async function saveContextualStorage(storage: ContextualStorage): Promise<void> {
  try {
    storage.lastUpdated = Date.now();
    
    // Convert Map to object for storage
    const data = {
      answers: Object.fromEntries(storage.answers),
      lastUpdated: storage.lastUpdated
    };
    
    await browser.storage.local.set({ [CONTEXTUAL_STORAGE_KEY]: data });
  } catch (err) {
    console.error('Failed to save contextual storage:', err);
    throw err;
  }
}

/**
 * Add or update an answer variation
 */
export async function addAnswerVariation(
  fieldType: string,
  value: string,
  context: AnswerVariation['context'],
  setAsDefault: boolean = false
): Promise<void> {
  const storage = await getContextualStorage();
  
  const existing = storage.answers.get(fieldType);
  const variationId = `${fieldType}_${Date.now()}`;
  
  const newVariation: AnswerVariation = {
    id: variationId,
    value,
    context,
    usageCount: 0,
    lastUsed: Date.now()
  };
  
  if (existing) {
    existing.variations.push(newVariation);
    if (setAsDefault) {
      existing.defaultVariation = variationId;
    }
  } else {
    storage.answers.set(fieldType, {
      fieldType,
      variations: [newVariation],
      defaultVariation: setAsDefault ? variationId : undefined
    });
  }
  
  await saveContextualStorage(storage);
}

/**
 * Get best answer variation for a given context
 */
export async function getBestAnswerForContext(
  fieldType: string,
  context: {
    industry?: string;
    companySize?: string;
    jobLevel?: string;
    jobTitle?: string;
    company?: string;
  }
): Promise<string | null> {
  const storage = await getContextualStorage();
  const answers = storage.answers.get(fieldType);
  
  if (!answers || answers.variations.length === 0) {
    return null;
  }
  
  // Score each variation based on context match
  const scoredVariations = answers.variations.map(variation => {
    let score = 0;
    
    // Industry match
    if (context.industry && variation.context.industry?.includes(context.industry)) {
      score += 3;
    }
    
    // Company size match
    if (context.companySize && variation.context.companySize?.includes(context.companySize)) {
      score += 2;
    }
    
    // Job level match
    if (context.jobLevel && variation.context.jobLevel?.includes(context.jobLevel)) {
      score += 2;
    }
    
    // User rating
    if (variation.userRating) {
      score += variation.userRating;
    }
    
    // Usage frequency (more used = better)
    score += Math.log(variation.usageCount + 1) * 0.5;
    
    // Recency bonus
    const daysSinceUsed = (Date.now() - variation.lastUsed) / (1000 * 60 * 60 * 24);
    if (daysSinceUsed < 7) {
      score += 1;
    }
    
    return { variation, score };
  });
  
  // Sort by score
  scoredVariations.sort((a, b) => b.score - a.score);
  
  // Return best match or default
  const best = scoredVariations[0];
  
  if (best.score > 0) {
    // Update usage stats
    best.variation.usageCount++;
    best.variation.lastUsed = Date.now();
    await saveContextualStorage(storage);
    
    return best.variation.value;
  }
  
  // Return default if exists
  if (answers.defaultVariation) {
    const defaultVar = answers.variations.find(v => v.id === answers.defaultVariation);
    if (defaultVar) {
      defaultVar.usageCount++;
      defaultVar.lastUsed = Date.now();
      await saveContextualStorage(storage);
      return defaultVar.value;
    }
  }
  
  // Return first variation as fallback
  const fallback = answers.variations[0];
  fallback.usageCount++;
  fallback.lastUsed = Date.now();
  await saveContextualStorage(storage);
  
  return fallback.value;
}

/**
 * Get all variations for a field type
 */
export async function getAllVariations(fieldType: string): Promise<AnswerVariation[]> {
  const storage = await getContextualStorage();
  const answers = storage.answers.get(fieldType);
  
  return answers?.variations || [];
}

/**
 * Delete a variation
 */
export async function deleteVariation(fieldType: string, variationId: string): Promise<void> {
  const storage = await getContextualStorage();
  const answers = storage.answers.get(fieldType);
  
  if (!answers) return;
  
  answers.variations = answers.variations.filter(v => v.id !== variationId);
  
  if (answers.defaultVariation === variationId) {
    answers.defaultVariation = undefined;
  }
  
  if (answers.variations.length === 0) {
    storage.answers.delete(fieldType);
  }
  
  await saveContextualStorage(storage);
}

/**
 * Rate a variation (1-5 stars)
 */
export async function rateVariation(
  fieldType: string,
  variationId: string,
  rating: number
): Promise<void> {
  const storage = await getContextualStorage();
  const answers = storage.answers.get(fieldType);
  
  if (!answers) return;
  
  const variation = answers.variations.find(v => v.id === variationId);
  if (variation) {
    variation.userRating = Math.max(1, Math.min(5, rating));
    await saveContextualStorage(storage);
  }
}

/**
 * Detect the canonical field type for a form field label.
 * Delegates to the FieldClassifier deterministic rule table (~50 patterns).
 * Returns 'unknown' for unrecognised fields.
 *
 * @param label     Visible label text of the field
 * @param context   HTML input type attribute (used for junk detection)
 * @param fieldType HTML name/id attribute
 */
export function detectFieldType(label: string, context: string, fieldType: string): string {
  const { classifyFieldSync } = require('./field-classifier') as typeof import('./field-classifier');
  return classifyFieldSync(label, context, fieldType);
}

/**
 * Migrate existing profile data to contextual storage
 */
export async function migrateProfileToContextual(profile: UserProfile): Promise<void> {
  const storage = await getContextualStorage();
  
  // Migrate summary/cover letter
  if (profile.summary && !storage.answers.has('cover_letter')) {
    await addAnswerVariation(
      'cover_letter',
      profile.summary,
      { tone: 'professional' },
      true
    );
  }
  
  // Could add more migrations here as needed
}
