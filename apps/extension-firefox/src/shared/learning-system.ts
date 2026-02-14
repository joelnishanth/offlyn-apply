/**
 * Adaptive Learning System
 * 
 * Learns from user corrections and improves autofill accuracy over time
 */

import { mastraAgent as ollama } from './mastra-agent';
import type { FieldSchema } from './types';

export interface FieldCorrection {
  fieldLabel: string;
  fieldType: string;
  fieldName: string;
  fieldId: string;
  autoFilledValue: string | boolean;
  userCorrectedValue: string | boolean;
  timestamp: number;
  embedding: number[];
  context: {
    url: string;
    company?: string;
    jobTitle?: string;
    nearbyLabels: string[];
  };
}

export interface LearningPattern {
  pattern: string;
  originalValue: string;
  preferredValue: string;
  confidence: number;
  occurrences: number;
  lastSeen: number;
}

export class LearningSystem {
  private corrections: FieldCorrection[] = [];
  private patterns: Map<string, LearningPattern> = new Map();
  private maxCorrections = 500; // Store last 500 corrections

  /**
   * Initialize - load from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await browser.storage.local.get(['field_corrections', 'learning_patterns']);
      
      if (stored.field_corrections) {
        this.corrections = stored.field_corrections;
        console.log(`[Learning] Loaded ${this.corrections.length} past corrections`);
      }
      
      if (stored.learning_patterns) {
        this.patterns = new Map(Object.entries(stored.learning_patterns));
        console.log(`[Learning] Loaded ${this.patterns.size} learned patterns`);
      }
    } catch (err) {
      console.warn('[Learning] Failed to load corrections:', err);
    }
  }

  /**
   * Record a user correction
   */
  async recordCorrection(
    field: FieldSchema,
    autoFilledValue: string | boolean,
    userValue: string | boolean,
    context: {
      url: string;
      company?: string;
      jobTitle?: string;
    }
  ): Promise<void> {
    // Skip if values are the same
    if (autoFilledValue === userValue) {
      return;
    }

    console.log(`[Learning] Recording correction for "${field.label}"`);
    console.log(`[Learning]   Autofilled: "${autoFilledValue}"`);
    console.log(`[Learning]   User chose: "${userValue}"`);

    // Get nearby labels for context
    const nearbyLabels = this.extractNearbyLabels(field);

    // Create embedding for this field + context
    const embeddingText = this.buildEmbeddingText(field, nearbyLabels);
    const embedding = await ollama.createEmbedding(embeddingText);

    // Create correction record
    const correction: FieldCorrection = {
      fieldLabel: field.label || '',
      fieldType: field.type || field.tagName,
      fieldName: field.name || '',
      fieldId: field.id || '',
      autoFilledValue,
      userCorrectedValue: userValue,
      timestamp: Date.now(),
      embedding,
      context: {
        url: context.url,
        company: context.company,
        jobTitle: context.jobTitle,
        nearbyLabels,
      },
    };

    // Add to corrections
    this.corrections.push(correction);

    // Trim to max size (keep most recent)
    if (this.corrections.length > this.maxCorrections) {
      this.corrections = this.corrections.slice(-this.maxCorrections);
    }

    // Update patterns
    this.updatePatterns(correction);

    // Save to storage
    await this.save();

    console.log(`[Learning] ✓ Correction recorded. Total: ${this.corrections.length}`);
  }

  /**
   * Build text for embedding
   */
  private buildEmbeddingText(field: FieldSchema, nearbyLabels: string[]): string {
    const parts = [
      `Field label: ${field.label || 'unknown'}`,
      `Field type: ${field.type || field.tagName}`,
      `Field name: ${field.name || ''}`,
      `Nearby labels: ${nearbyLabels.join(', ')}`,
    ];
    return parts.join('\n');
  }

  /**
   * Extract nearby labels for context
   */
  private extractNearbyLabels(field: FieldSchema): string[] {
    // This would ideally parse DOM, but we'll use what we have
    // In practice, the content script can pass this
    const label = field.label || '';
    const name = field.name || '';
    const id = field.id || '';
    
    return [label, name, id].filter(Boolean);
  }

  /**
   * Update learned patterns
   */
  private updatePatterns(correction: FieldCorrection): void {
    // Create pattern key (field label + type)
    const patternKey = `${correction.fieldLabel.toLowerCase()}_${correction.fieldType}`;

    // Get existing pattern or create new
    let pattern = this.patterns.get(patternKey);

    if (pattern) {
      // Update existing pattern
      pattern.occurrences++;
      pattern.lastSeen = correction.timestamp;
      
      // Update confidence (increases with consistency)
      const consistencyBonus = pattern.preferredValue === correction.userCorrectedValue ? 0.1 : -0.2;
      pattern.confidence = Math.max(0.1, Math.min(1.0, pattern.confidence + consistencyBonus));
      
      // If user consistently chooses different value, update preferred
      if (pattern.preferredValue !== correction.userCorrectedValue) {
        pattern.preferredValue = String(correction.userCorrectedValue);
      }
    } else {
      // Create new pattern
      pattern = {
        pattern: patternKey,
        originalValue: String(correction.autoFilledValue),
        preferredValue: String(correction.userCorrectedValue),
        confidence: 0.6, // Start with moderate confidence
        occurrences: 1,
        lastSeen: correction.timestamp,
      };
    }

    this.patterns.set(patternKey, pattern);
  }

  /**
   * Query for similar past corrections.
   * Only returns corrections above a minimum similarity threshold to avoid
   * polluting suggestions with unrelated corrections (e.g., suggesting a
   * LinkedIn URL for a "State" field just because it has the highest score
   * among all stored corrections).
   */
  private static readonly MIN_SIMILARITY = 0.90; // Only very similar fields

  async querySimilarCorrections(
    field: FieldSchema,
    topK: number = 5
  ): Promise<FieldCorrection[]> {
    if (this.corrections.length === 0) {
      return [];
    }

    // Build query embedding
    const nearbyLabels = this.extractNearbyLabels(field);
    const queryText = this.buildEmbeddingText(field, nearbyLabels);
    const queryEmbedding = await ollama.createEmbedding(queryText);

    // Calculate similarity scores
    const scored = this.corrections
      .map(correction => ({
        correction,
        score: this.cosineSimilarity(queryEmbedding, correction.embedding),
      }))
      // Only keep corrections above the minimum threshold
      .filter(s => s.score >= LearningSystem.MIN_SIMILARITY);

    // Sort by score and return top K
    scored.sort((a, b) => b.score - a.score);
    const topCorrections = scored.slice(0, topK);

    console.log(`[Learning] Found ${topCorrections.length} similar corrections above threshold ${LearningSystem.MIN_SIMILARITY} (scores: ${topCorrections.map(c => c.score.toFixed(3)).join(', ')})`);

    return topCorrections.map(s => s.correction);
  }

  /**
   * Get learned pattern for field
   */
  getPattern(field: FieldSchema): LearningPattern | null {
    const patternKey = `${(field.label || '').toLowerCase()}_${field.type || field.tagName}`;
    return this.patterns.get(patternKey) || null;
  }

  /**
   * Quick synchronous lookup: get the learned value for a field if a pattern
   * with sufficient confidence exists. Used by autofill/embedding pipelines
   * to override profile values with user-corrected values.
   */
  getLearnedValue(field: FieldSchema): { value: string; confidence: number } | null {
    const pattern = this.getPattern(field);
    if (pattern && pattern.confidence >= 0.6 && pattern.preferredValue && pattern.preferredValue.trim() !== '') {
      return {
        value: pattern.preferredValue,
        confidence: pattern.confidence,
      };
    }
    return null;
  }

  /**
   * Get all learned patterns as label→value slots for embedding-based matching.
   * These can be merged into profile slots so the embedding pipeline picks up
   * user corrections when matching fields to values.
   */
  getLearnedSlots(): Array<{ label: string; value: string; confidence: number }> {
    const slots: Array<{ label: string; value: string; confidence: number }> = [];
    
    for (const [_key, pattern] of this.patterns.entries()) {
      if (pattern.confidence >= 0.6 && pattern.preferredValue && pattern.preferredValue.trim() !== '') {
        // Pattern key is "fieldlabel_fieldtype" — extract the label part
        // e.g. "linkedin profile_text" → "linkedin profile"
        const labelPart = pattern.pattern.replace(/_[^_]+$/, '').replace(/_/g, ' ');
        slots.push({
          label: labelPart,
          value: pattern.preferredValue,
          confidence: pattern.confidence,
        });
      }
    }
    
    return slots;
  }

  /**
   * Suggest value based on learning
   */
  async suggestValue(
    field: FieldSchema,
    proposedValue: string | boolean,
    context: { url?: string; company?: string }
  ): Promise<{
    suggestedValue: string | boolean;
    confidence: number;
    reason: string;
  } | null> {
    // Check learned patterns first (fast)
    const pattern = this.getPattern(field);
    if (pattern && pattern.confidence > 0.7) {
      console.log(`[Learning] Found pattern for "${field.label}": ${pattern.preferredValue} (confidence: ${pattern.confidence})`);
      return {
        suggestedValue: pattern.preferredValue,
        confidence: pattern.confidence,
        reason: `Learned from ${pattern.occurrences} past corrections`,
      };
    }

    // Query similar corrections (semantic search with minimum threshold)
    const similarCorrections = await this.querySimilarCorrections(field, 5);

    if (similarCorrections.length === 0) {
      return null; // No learning data above similarity threshold
    }

    // Additional guard: only consider corrections whose field label is
    // semantically related. This prevents e.g. a "LinkedIn Profile" correction
    // from leaking into a "State" or "Work Authorization" field just because
    // their embeddings happen to be close.
    const queryLabel = (field.label || '').toLowerCase();
    const relevantCorrections = similarCorrections.filter(c => {
      const corrLabel = c.fieldLabel.toLowerCase();
      // Require at least one meaningful word overlap between labels
      const queryWords = queryLabel.split(/\s+/).filter(w => w.length > 2);
      const corrWords = corrLabel.split(/\s+/).filter(w => w.length > 2);
      return queryWords.some(qw => corrWords.some(cw => 
        qw.includes(cw) || cw.includes(qw)
      ));
    });

    if (relevantCorrections.length === 0) {
      return null; // Similar embeddings but different field labels
    }

    // Analyze corrections
    const valueCounts = new Map<string, number>();
    let totalScore = 0;

    for (const correction of relevantCorrections) {
      const value = String(correction.userCorrectedValue);
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);
      totalScore += 1;
    }

    // Find most common corrected value
    let mostCommonValue = '';
    let maxCount = 0;
    for (const [value, count] of valueCounts.entries()) {
      if (count > maxCount) {
        mostCommonValue = value;
        maxCount = count;
      }
    }

    // Calculate confidence (% of similar corrections agreeing)
    const confidence = maxCount / totalScore;

    // Require at least 2 agreeing corrections and >60% agreement
    if (confidence > 0.6 && maxCount >= 2 && mostCommonValue !== String(proposedValue)) {
      console.log(`[Learning] Suggesting "${mostCommonValue}" instead of "${proposedValue}" (confidence: ${confidence.toFixed(2)}, from ${maxCount} corrections)`);
      return {
        suggestedValue: mostCommonValue,
        confidence,
        reason: `Based on ${maxCount}/${relevantCorrections.length} similar past corrections`,
      };
    }

    return null;
  }

  /**
   * Cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Save to storage
   */
  private async save(): Promise<void> {
    try {
      await browser.storage.local.set({
        field_corrections: this.corrections,
        learning_patterns: Object.fromEntries(this.patterns),
      });
    } catch (err) {
      console.error('[Learning] Failed to save:', err);
    }
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    totalCorrections: number;
    learnedPatterns: number;
    avgConfidence: number;
    recentCorrections: number;
  } {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    
    const recentCorrections = this.corrections.filter(c => c.timestamp > dayAgo).length;
    
    let totalConfidence = 0;
    for (const pattern of this.patterns.values()) {
      totalConfidence += pattern.confidence;
    }
    const avgConfidence = this.patterns.size > 0 ? totalConfidence / this.patterns.size : 0;

    return {
      totalCorrections: this.corrections.length,
      learnedPatterns: this.patterns.size,
      avgConfidence,
      recentCorrections,
    };
  }

  /**
   * Export learning data
   */
  exportData(): {
    corrections: FieldCorrection[];
    patterns: LearningPattern[];
  } {
    return {
      corrections: this.corrections,
      patterns: Array.from(this.patterns.values()),
    };
  }

  /**
   * Import learning data
   */
  async importData(data: {
    corrections?: FieldCorrection[];
    patterns?: LearningPattern[];
  }): Promise<void> {
    if (data.corrections) {
      this.corrections = data.corrections;
    }
    
    if (data.patterns) {
      this.patterns = new Map(data.patterns.map(p => [p.pattern, p]));
    }

    await this.save();
    console.log(`[Learning] Imported ${this.corrections.length} corrections and ${this.patterns.size} patterns`);
  }

  /**
   * Clear all learning data
   */
  async clear(): Promise<void> {
    this.corrections = [];
    this.patterns.clear();
    await this.save();
    console.log('[Learning] All learning data cleared');
  }
}

// Singleton instance
export const learningSystem = new LearningSystem();
