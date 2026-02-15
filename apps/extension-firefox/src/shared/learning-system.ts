/**
 * Adaptive Learning System
 * 
 * Learns from:
 *   1. Form submissions — snapshots ALL field values when the user submits
 *      (highest confidence, because the user actively submitted with these values)
 *   2. User corrections — when a user edits an auto-filled value
 *
 * Data model:
 *   - SubmittedValue: field label → value from a submitted form (high confidence)
 *   - FieldCorrection: a record of auto-filled → user-corrected (medium confidence)
 *   - LearningPattern: aggregated pattern from corrections (derived)
 */

import { mastraAgent as ollama } from './mastra-agent';
import type { FieldSchema } from './types';

// ── Types ──────────────────────────────────────────────────────────────────

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

export interface SubmittedValue {
  /** Normalized field label (lowercased, trimmed) */
  fieldLabel: string;
  fieldType: string;
  fieldName: string;
  fieldId: string;
  value: string;
  timestamp: number;
  context: {
    url: string;
    company?: string;
    jobTitle?: string;
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

// ── Learning System ────────────────────────────────────────────────────────

export class LearningSystem {
  private corrections: FieldCorrection[] = [];
  private patterns: Map<string, LearningPattern> = new Map();
  private submittedValues: SubmittedValue[] = [];
  private maxCorrections = 500;
  private maxSubmittedValues = 2000;

  // ── Init / Persist ─────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    try {
      const stored = await browser.storage.local.get([
        'field_corrections',
        'learning_patterns',
        'submitted_values',
      ]);

      if (stored.field_corrections) {
        this.corrections = stored.field_corrections;
        console.log(`[Learning] Loaded ${this.corrections.length} past corrections`);
      }

      if (stored.learning_patterns) {
        this.patterns = new Map(Object.entries(stored.learning_patterns));
        console.log(`[Learning] Loaded ${this.patterns.size} learned patterns`);
      }

      if (stored.submitted_values) {
        this.submittedValues = stored.submitted_values;
        console.log(`[Learning] Loaded ${this.submittedValues.length} submitted values`);
      }
    } catch (err) {
      console.warn('[Learning] Failed to load data:', err);
    }
  }

  private async save(): Promise<void> {
    try {
      await browser.storage.local.set({
        field_corrections: this.corrections,
        learning_patterns: Object.fromEntries(this.patterns),
        submitted_values: this.submittedValues,
      });
    } catch (err) {
      console.error('[Learning] Failed to save:', err);
    }
  }

  // ── Learn from form submission ─────────────────────────────────────────

  /**
   * Called when the user submits a form. Snapshots ALL current field values
   * so they can be reused on future applications.
   *
   * This is the most reliable learning signal — the user actively submitted
   * with these values.
   */
  async learnFromSubmission(
    fields: FieldSchema[],
    fieldValues: Map<string, string>, // selector → current DOM value
    context: { url: string; company?: string; jobTitle?: string }
  ): Promise<number> {
    let learnedCount = 0;

    for (const field of fields) {
      const value = fieldValues.get(field.selector);

      // Skip empty fields — nothing to learn
      if (!value || !value.trim()) continue;

      // Skip very short values for long-form fields (probably placeholder/partial)
      if (field.tagName === 'TEXTAREA' && value.trim().length < 10) continue;

      const sv: SubmittedValue = {
        fieldLabel: (field.label || '').toLowerCase().trim(),
        fieldType: field.type || field.tagName,
        fieldName: field.name || '',
        fieldId: field.id || '',
        value: value.trim(),
        timestamp: Date.now(),
        context: {
          url: context.url,
          company: context.company,
          jobTitle: context.jobTitle,
        },
      };

      this.submittedValues.push(sv);
      learnedCount++;

      // Also update patterns with high confidence (submitted = confirmed)
      this.updatePatternFromSubmission(sv);
    }

    // Trim to max size
    if (this.submittedValues.length > this.maxSubmittedValues) {
      this.submittedValues = this.submittedValues.slice(-this.maxSubmittedValues);
    }

    await this.save();
    console.log(`[Learning] ✓ Learned ${learnedCount} values from form submission (total submitted: ${this.submittedValues.length})`);
    return learnedCount;
  }

  /**
   * Update patterns from a submitted value (high confidence).
   */
  private updatePatternFromSubmission(sv: SubmittedValue): void {
    const patternKey = `${sv.fieldLabel}_${sv.fieldType}`;

    let pattern = this.patterns.get(patternKey);

    if (pattern) {
      pattern.occurrences++;
      pattern.lastSeen = sv.timestamp;

      if (pattern.preferredValue === sv.value) {
        // User submitted the same value again — boost confidence
        pattern.confidence = Math.min(1.0, pattern.confidence + 0.15);
      } else {
        // Different value — update but don't tank confidence
        // (user might legitimately give different answers per company)
        pattern.preferredValue = sv.value;
        // Keep confidence stable, slight bump since it's a submission
        pattern.confidence = Math.min(1.0, Math.max(pattern.confidence, 0.7));
      }
    } else {
      // New pattern from submission — starts at high confidence
      pattern = {
        pattern: patternKey,
        originalValue: '',
        preferredValue: sv.value,
        confidence: 0.8, // Submissions start high
        occurrences: 1,
        lastSeen: sv.timestamp,
      };
    }

    this.patterns.set(patternKey, pattern);
  }

  // ── Learn from user corrections ────────────────────────────────────────

  /**
   * Record a user correction (user changed an auto-filled value).
   */
  async recordCorrection(
    field: FieldSchema,
    autoFilledValue: string | boolean,
    userValue: string | boolean,
    context: { url: string; company?: string; jobTitle?: string }
  ): Promise<void> {
    // Skip if values are the same
    if (autoFilledValue === userValue) return;

    // Skip if user corrected to empty — this means they deleted a bad fill,
    // NOT that they want the field to be empty on future forms.
    const userStr = String(userValue).trim();
    if (!userStr) {
      console.log(`[Learning] Skipping empty correction for "${field.label}" (user cleared the field)`);
      return;
    }

    console.log(`[Learning] Recording correction for "${field.label}"`);
    console.log(`[Learning]   Autofilled: "${autoFilledValue}"`);
    console.log(`[Learning]   User chose: "${userValue}"`);

    const nearbyLabels = this.extractNearbyLabels(field);
    const embeddingText = this.buildEmbeddingText(field, nearbyLabels);
    const embedding = await ollama.createEmbedding(embeddingText);

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

    this.corrections.push(correction);

    if (this.corrections.length > this.maxCorrections) {
      this.corrections = this.corrections.slice(-this.maxCorrections);
    }

    this.updatePatterns(correction);
    await this.save();

    console.log(`[Learning] ✓ Correction recorded. Total: ${this.corrections.length}`);
  }

  // ── Suggest values ─────────────────────────────────────────────────────

  /**
   * Suggest value based on learning data.
   * Priority: submitted values > patterns > semantic corrections
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
    const fieldLabel = (field.label || '').toLowerCase().trim();

    // 1. Check submitted values (highest confidence)
    const submitted = this.findBestSubmittedValue(field);
    if (submitted) {
      console.log(`[Learning] Found submitted value for "${field.label}": "${submitted.value.substring(0, 60)}..." (confidence: ${submitted.confidence})`);
      return {
        suggestedValue: submitted.value,
        confidence: submitted.confidence,
        reason: `Used in ${submitted.count} previous submission(s)`,
      };
    }

    // 2. Check learned patterns (fast, synchronous)
    const pattern = this.getPattern(field);
    if (pattern && pattern.confidence >= 0.7 && pattern.preferredValue.trim()) {
      console.log(`[Learning] Found pattern for "${field.label}": ${pattern.preferredValue.substring(0, 60)} (confidence: ${pattern.confidence})`);
      return {
        suggestedValue: pattern.preferredValue,
        confidence: pattern.confidence,
        reason: `Learned from ${pattern.occurrences} past interaction(s)`,
      };
    }

    // 3. Query similar corrections via embedding search
    const similarCorrections = await this.querySimilarCorrections(field, 5);
    if (similarCorrections.length === 0) return null;

    // Guard: require label word overlap
    const queryWords = fieldLabel.split(/\s+/).filter(w => w.length > 2);
    const relevantCorrections = similarCorrections.filter(c => {
      const corrWords = c.fieldLabel.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      return queryWords.some(qw => corrWords.some(cw => qw.includes(cw) || cw.includes(qw)));
    });

    if (relevantCorrections.length === 0) return null;

    // Find most common non-empty corrected value
    const valueCounts = new Map<string, number>();
    for (const c of relevantCorrections) {
      const v = String(c.userCorrectedValue).trim();
      if (v) valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
    }

    let bestValue = '';
    let bestCount = 0;
    for (const [v, count] of valueCounts) {
      if (count > bestCount) { bestValue = v; bestCount = count; }
    }

    const confidence = bestCount / relevantCorrections.length;

    if (confidence > 0.6 && bestCount >= 2 && bestValue !== String(proposedValue)) {
      console.log(`[Learning] Suggesting "${bestValue.substring(0, 60)}" instead of "${String(proposedValue).substring(0, 30)}" (confidence: ${confidence.toFixed(2)}, from ${bestCount} corrections)`);
      return {
        suggestedValue: bestValue,
        confidence,
        reason: `Based on ${bestCount}/${relevantCorrections.length} similar past corrections`,
      };
    }

    return null;
  }

  /**
   * Find the best submitted value for a field.
   * Matches by field label, name, or id. Returns the most recent
   * non-empty value if multiple submissions exist.
   */
  private findBestSubmittedValue(field: FieldSchema): { value: string; confidence: number; count: number } | null {
    const fieldLabel = (field.label || '').toLowerCase().trim();
    const fieldName = (field.name || '').toLowerCase().trim();
    const fieldId = (field.id || '').toLowerCase().trim();

    if (!fieldLabel && !fieldName && !fieldId) return null;

    // Find all matching submitted values
    const matches: SubmittedValue[] = [];

    for (const sv of this.submittedValues) {
      // Match by label (fuzzy: both contain the same key words)
      const labelMatch = fieldLabel && sv.fieldLabel &&
        (sv.fieldLabel === fieldLabel || this.labelsSimilar(fieldLabel, sv.fieldLabel));

      // Match by name or id (exact)
      const nameMatch = fieldName && sv.fieldName && sv.fieldName.toLowerCase() === fieldName;
      const idMatch = fieldId && sv.fieldId && sv.fieldId.toLowerCase() === fieldId;

      if (labelMatch || nameMatch || idMatch) {
        matches.push(sv);
      }
    }

    if (matches.length === 0) return null;

    // Count value frequency and find the most recent
    const valueCounts = new Map<string, { count: number; latest: number }>();
    for (const m of matches) {
      const v = m.value.trim();
      if (!v) continue;
      const existing = valueCounts.get(v);
      if (existing) {
        existing.count++;
        existing.latest = Math.max(existing.latest, m.timestamp);
      } else {
        valueCounts.set(v, { count: 1, latest: m.timestamp });
      }
    }

    if (valueCounts.size === 0) return null;

    // Pick: most frequent, tiebreak by most recent
    let bestValue = '';
    let bestInfo = { count: 0, latest: 0 };
    for (const [v, info] of valueCounts) {
      if (info.count > bestInfo.count ||
          (info.count === bestInfo.count && info.latest > bestInfo.latest)) {
        bestValue = v;
        bestInfo = info;
      }
    }

    // Confidence based on count
    const confidence = Math.min(0.95, 0.75 + (bestInfo.count - 1) * 0.05);

    return { value: bestValue, confidence, count: bestInfo.count };
  }

  /**
   * Check if two field labels are similar enough to be the same concept.
   * Handles variations like "Years of Experience" vs "Total Years of Experience".
   */
  private labelsSimilar(a: string, b: string): boolean {
    // Exact match
    if (a === b) return true;

    // One contains the other
    if (a.includes(b) || b.includes(a)) return true;

    // Word overlap: require >= 60% of the shorter label's words to appear in the longer
    const wordsA = a.split(/\s+/).filter(w => w.length > 2);
    const wordsB = b.split(/\s+/).filter(w => w.length > 2);
    const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
    const longer = wordsA.length > wordsB.length ? wordsA : wordsB;

    if (shorter.length === 0) return false;

    const overlapCount = shorter.filter(sw =>
      longer.some(lw => sw.includes(lw) || lw.includes(sw))
    ).length;

    return overlapCount / shorter.length >= 0.6;
  }

  // ── Sync lookups (used by autofill pipeline) ───────────────────────────

  getPattern(field: FieldSchema): LearningPattern | null {
    const patternKey = `${(field.label || '').toLowerCase()}_${field.type || field.tagName}`;
    return this.patterns.get(patternKey) || null;
  }

  /**
   * Quick synchronous lookup for autofill: returns the best learned value.
   * Checks submitted values first, then patterns.
   */
  getLearnedValue(field: FieldSchema): { value: string; confidence: number } | null {
    // Check submitted values first
    const submitted = this.findBestSubmittedValue(field);
    if (submitted && submitted.value.trim()) {
      return { value: submitted.value, confidence: submitted.confidence };
    }

    // Fall back to patterns
    const pattern = this.getPattern(field);
    if (pattern && pattern.confidence >= 0.7 && pattern.preferredValue && pattern.preferredValue.trim()) {
      return { value: pattern.preferredValue, confidence: pattern.confidence };
    }

    return null;
  }

  getLearnedSlots(): Array<{ label: string; value: string; confidence: number }> {
    const slots: Array<{ label: string; value: string; confidence: number }> = [];

    for (const [_key, pattern] of this.patterns.entries()) {
      if (pattern.confidence >= 0.7 && pattern.preferredValue && pattern.preferredValue.trim()) {
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

  // ── Internal helpers ───────────────────────────────────────────────────

  private buildEmbeddingText(field: FieldSchema, nearbyLabels: string[]): string {
    return [
      `Field label: ${field.label || 'unknown'}`,
      `Field type: ${field.type || field.tagName}`,
      `Field name: ${field.name || ''}`,
      `Nearby labels: ${nearbyLabels.join(', ')}`,
    ].join('\n');
  }

  private extractNearbyLabels(field: FieldSchema): string[] {
    return [field.label || '', field.name || '', field.id || ''].filter(Boolean);
  }

  /**
   * Update patterns from a correction (lower confidence than submission).
   */
  private updatePatterns(correction: FieldCorrection): void {
    const patternKey = `${correction.fieldLabel.toLowerCase()}_${correction.fieldType}`;
    let pattern = this.patterns.get(patternKey);

    // Skip empty corrections for pattern updates
    const corrValue = String(correction.userCorrectedValue).trim();
    if (!corrValue) return;

    if (pattern) {
      pattern.occurrences++;
      pattern.lastSeen = correction.timestamp;

      const consistencyBonus = pattern.preferredValue === corrValue ? 0.1 : -0.15;
      pattern.confidence = Math.max(0.1, Math.min(1.0, pattern.confidence + consistencyBonus));

      if (pattern.preferredValue !== corrValue) {
        pattern.preferredValue = corrValue;
      }
    } else {
      // New pattern from correction — starts at moderate confidence
      // (needs a second confirmation to reach the 0.7 threshold for use)
      pattern = {
        pattern: patternKey,
        originalValue: String(correction.autoFilledValue),
        preferredValue: corrValue,
        confidence: 0.5,
        occurrences: 1,
        lastSeen: correction.timestamp,
      };
    }

    this.patterns.set(patternKey, pattern);
  }

  private static readonly MIN_SIMILARITY = 0.90;

  async querySimilarCorrections(field: FieldSchema, topK: number = 5): Promise<FieldCorrection[]> {
    if (this.corrections.length === 0) return [];

    const nearbyLabels = this.extractNearbyLabels(field);
    const queryText = this.buildEmbeddingText(field, nearbyLabels);
    const queryEmbedding = await ollama.createEmbedding(queryText);

    const scored = this.corrections
      .map(c => ({ correction: c, score: this.cosineSimilarity(queryEmbedding, c.embedding) }))
      .filter(s => s.score >= LearningSystem.MIN_SIMILARITY);

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    console.log(`[Learning] Found ${top.length} similar corrections above threshold ${LearningSystem.MIN_SIMILARITY} (scores: ${top.map(c => c.score.toFixed(3)).join(', ')})`);
    return top.map(s => s.correction);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      nA += a[i] * a[i];
      nB += b[i] * b[i];
    }
    return dot / (Math.sqrt(nA) * Math.sqrt(nB));
  }

  // ── Stats / Export / Import / Clear ────────────────────────────────────

  getStats(): {
    totalCorrections: number;
    learnedPatterns: number;
    submittedValues: number;
    avgConfidence: number;
    recentCorrections: number;
  } {
    const dayAgo = Date.now() - 86400000;
    const recentCorrections = this.corrections.filter(c => c.timestamp > dayAgo).length;

    let totalConf = 0;
    for (const p of this.patterns.values()) totalConf += p.confidence;
    const avgConfidence = this.patterns.size > 0 ? totalConf / this.patterns.size : 0;

    return {
      totalCorrections: this.corrections.length,
      learnedPatterns: this.patterns.size,
      submittedValues: this.submittedValues.length,
      avgConfidence,
      recentCorrections,
    };
  }

  exportData() {
    return {
      corrections: this.corrections,
      patterns: Array.from(this.patterns.values()),
      submittedValues: this.submittedValues,
    };
  }

  async importData(data: {
    corrections?: FieldCorrection[];
    patterns?: LearningPattern[];
    submittedValues?: SubmittedValue[];
  }): Promise<void> {
    if (data.corrections) this.corrections = data.corrections;
    if (data.patterns) this.patterns = new Map(data.patterns.map(p => [p.pattern, p]));
    if (data.submittedValues) this.submittedValues = data.submittedValues;
    await this.save();
    console.log(`[Learning] Imported ${this.corrections.length} corrections, ${this.patterns.size} patterns, ${this.submittedValues.length} submitted values`);
  }

  async clear(): Promise<void> {
    this.corrections = [];
    this.patterns.clear();
    this.submittedValues = [];
    await this.save();
    console.log('[Learning] All learning data cleared');
  }
}

// Singleton
export const learningSystem = new LearningSystem();
