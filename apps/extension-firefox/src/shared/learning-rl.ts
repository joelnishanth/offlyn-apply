/**
 * Reinforcement Learning System for Offlyn Apply
 *
 * Learns from user corrections and successes to improve autofill accuracy.
 *
 * Algorithm (lightweight, 100% local, no neural networks):
 *   - Reward:  +1 when user submits without changing an autofilled value
 *   - Penalty: -1 when user changes an autofilled value
 *   - Decay:   Old patterns lose confidence over a 30-day window
 *   - Threshold: Only patterns with confidence > 0.6 are used in autofill
 *
 * Performance targets:
 *   - All lookups < 50ms (in-memory cache)
 *   - Storage writes are batched / async
 */

import type { FieldSchema } from './types';
import {
  type LearnedPattern,
  type CorrectionEvent,
  type JobContext,
  RL_STORAGE_KEYS,
  RL_THRESHOLDS,
  RL_PARAMS,
} from './learning-types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `rl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize a field label for consistent matching.
 */
function normalizeLabel(label: string | null | undefined): string {
  return (label || '').toLowerCase().trim();
}

/**
 * Build a canonical key for pattern lookup.
 * Combines field label + field type for disambiguation.
 */
function patternKey(fieldLabel: string, fieldType: string): string {
  return `${fieldLabel}__${fieldType}`;
}

/**
 * Check whether two labels are similar enough to count as the same field.
 * Uses word-overlap heuristic (>= 60% of shorter label's words appear in longer).
 */
function labelsSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const wordsA = a.split(/\s+/).filter(w => w.length > 2);
  const wordsB = b.split(/\s+/).filter(w => w.length > 2);
  const shorter = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const longer = wordsA.length > wordsB.length ? wordsA : wordsB;

  if (shorter.length === 0) return false;

  const overlap = shorter.filter(sw => longer.some(lw => sw.includes(lw) || lw.includes(sw)));
  return overlap.length / shorter.length >= 0.6;
}

// ── Semantic value validation ────────────────────────────────────────────────

/**
 * Validation rules keyed by a field-label pattern.
 * Each rule returns `true` (value is valid) or `false` (reject it).
 *
 * Rules are checked in order; the first matching label wins.
 */
type ValidationRule = {
  /** Substrings that must appear in the normalised label to trigger this rule */
  labelIncludes: string[];
  /** Validation predicate — return false to reject the value */
  validate: (value: string) => boolean;
  /** Human-readable reason logged when a value is rejected */
  reason: string;
};

const FIELD_VALIDATION_RULES: ValidationRule[] = [
  // ── Name parts: must be a single word (no spaces) ─────────────────────────
  {
    labelIncludes: ['first name', 'firstname', 'given name', 'fname'],
    validate: (v) => !v.includes(' '),
    reason: 'First-name field must not contain a space (full name rejected)',
  },
  {
    labelIncludes: ['last name', 'lastname', 'surname', 'family name', 'lname'],
    validate: (v) => !v.includes(' '),
    reason: 'Last-name field must not contain a space (full name rejected)',
  },
  // ── Email: must look like an email address ────────────────────────────────
  {
    labelIncludes: ['email', 'e-mail'],
    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
    reason: 'Email field must contain a valid email address',
  },
  // ── Phone: must be phone-like (digits, spaces, +, -, parens) ─────────────
  {
    labelIncludes: ['phone', 'mobile', 'tel', 'telephone', 'cell'],
    validate: (v) => /^[0-9+\-() .ext]+$/i.test(v) && v.replace(/\D/g, '').length >= 7,
    reason: 'Phone field must contain digits only (no letters)',
  },
  // ── LinkedIn: must look like a LinkedIn URL ────────────────────────────────
  {
    labelIncludes: ['linkedin'],
    validate: (v) => v.includes('linkedin.com') || v.startsWith('http'),
    reason: 'LinkedIn field must be a URL containing linkedin.com',
  },
  // ── GitHub: must look like a GitHub URL ──────────────────────────────────
  {
    labelIncludes: ['github', 'git hub'],
    validate: (v) => v.includes('github.com') || v.startsWith('http'),
    reason: 'GitHub field must be a URL containing github.com',
  },
  // ── Generic URL fields ────────────────────────────────────────────────────
  {
    labelIncludes: ['website', 'portfolio', 'personal site', 'url'],
    validate: (v) => v.startsWith('http') || v.startsWith('www.'),
    reason: 'URL field must start with http or www.',
  },
];

/**
 * Validate a value before storing/using it for a given field label.
 *
 * Returns `{ valid: true }` if acceptable, or
 * `{ valid: false, reason: string }` to reject.
 */
function validateValueForField(
  fieldLabel: string,
  value: string
): { valid: true } | { valid: false; reason: string } {
  const label = fieldLabel.toLowerCase().trim();
  const trimmed = value.trim();

  // Never store empty values
  if (!trimmed) {
    return { valid: false, reason: 'Empty value' };
  }

  for (const rule of FIELD_VALIDATION_RULES) {
    // Check if any of the trigger substrings appear in the label
    if (rule.labelIncludes.some(sub => label.includes(sub))) {
      if (!rule.validate(trimmed)) {
        return { valid: false, reason: rule.reason };
      }
      // First matching rule passed — no need to check further rules
      return { valid: true };
    }
  }

  return { valid: true };
}

/**
 * Age-based decay factor. Returns a multiplier close to 1 for recent patterns
 * and approaching 0 for patterns not used in 30+ days.
 */
function ageFactor(lastUsed: number): number {
  const age = Date.now() - lastUsed;
  return Math.exp(-age / RL_PARAMS.decayWindowMs);
}

/**
 * Apply the RL confidence update formula.
 *
 *   new_confidence = clamp(current + learningRate * reward) * decayFactor * ageFactor
 */
function computeNewConfidence(
  current: number,
  reward: number,
  lastUsed: number
): number {
  const raw = current + RL_PARAMS.learningRate * reward;
  const decayed = raw * RL_PARAMS.decayFactor * ageFactor(lastUsed);
  return Math.max(0, Math.min(1, decayed));
}

// ── ReinforcementLearningSystem ──────────────────────────────────────────────

export class ReinforcementLearningSystem {
  /** In-memory cache of learned patterns keyed by patternKey() */
  private patterns: Map<string, LearnedPattern> = new Map();

  /** Recent correction events (capped at RL_PARAMS.maxCorrections) */
  private corrections: CorrectionEvent[] = [];

  /** Whether initialize() has been called */
  private ready = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Load patterns + corrections from browser.storage.local.
   * Must be called once before any other method.
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    try {
      const stored = await browser.storage.local.get([
        RL_STORAGE_KEYS.patterns,
        RL_STORAGE_KEYS.corrections,
      ]);

      if (stored[RL_STORAGE_KEYS.patterns]) {
        const patternsArr: LearnedPattern[] = stored[RL_STORAGE_KEYS.patterns];
        for (const p of patternsArr) {
          this.patterns.set(patternKey(p.fieldLabel, p.fieldType), p);
        }
        console.log(`[RL] Loaded ${this.patterns.size} learned patterns`);
      }

      if (stored[RL_STORAGE_KEYS.corrections]) {
        this.corrections = stored[RL_STORAGE_KEYS.corrections];
        console.log(`[RL] Loaded ${this.corrections.length} correction events`);
      }
    } catch (err) {
      console.warn('[RL] Failed to load from storage:', err);
    }

    this.ready = true;

    // Remove any patterns that fail validation (e.g. full names stored for
    // first-name / last-name slots from a previous bug).
    const purged = this.purgeInvalidPatterns();
    if (purged > 0) {
      console.warn(`[RL] Purged ${purged} invalid pattern(s) on load — saving cleaned data`);
      this.save();
    }
  }

  /**
   * Remove patterns whose stored `learnedValue` fails the field validation
   * rules.  Returns the number of patterns removed.
   */
  private purgeInvalidPatterns(): number {
    let removed = 0;
    for (const [key, pattern] of this.patterns.entries()) {
      const check = validateValueForField(pattern.fieldLabel, pattern.learnedValue);
      if (!check.valid) {
        console.warn(
          `[RL] Removing invalid pattern "${pattern.fieldLabel}" → "${pattern.learnedValue}": ${check.reason}`
        );
        this.patterns.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Evict low-confidence / old patterns when the set grows too large.
   * Keeps at most MAX_PATTERNS, prioritising high-confidence and recently used.
   */
  private evictIfNeeded(): void {
    const MAX_PATTERNS = 200;
    const MAX_CORRECTIONS = 100;

    if (this.patterns.size > MAX_PATTERNS) {
      const sorted = Array.from(this.patterns.entries()).sort(([, a], [, b]) => {
        // Primary sort: confidence descending; secondary: lastUsed descending
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return (b.lastUsed ?? 0) - (a.lastUsed ?? 0);
      });
      // Drop the tail beyond MAX_PATTERNS
      for (const [key] of sorted.slice(MAX_PATTERNS)) {
        this.patterns.delete(key);
      }
      console.log(`[RL] Evicted patterns — keeping top ${MAX_PATTERNS}`);
    }

    if (this.corrections.length > MAX_CORRECTIONS) {
      this.corrections = this.corrections.slice(-MAX_CORRECTIONS);
    }
  }

  /** Persist current state to browser.storage.local (async, non-blocking). */
  private save(): void {
    this.evictIfNeeded();
    const patternsArr = Array.from(this.patterns.values());

    browser.storage.local
      .set({
        [RL_STORAGE_KEYS.patterns]: patternsArr,
        [RL_STORAGE_KEYS.corrections]: this.corrections,
      })
      .catch(err => console.error('[RL] Save failed:', err));
  }

  // ── Core RL Methods ───────────────────────────────────────────────────

  /**
   * Record that the user corrected an autofilled value.
   * This is a negative signal (penalty) for whatever we filled.
   */
  async recordCorrection(
    field: FieldSchema,
    autoFilledValue: string,
    userCorrectedValue: string,
    context: JobContext
  ): Promise<void> {
    if (!this.ready) await this.initialize();

    const correctedStr = userCorrectedValue.trim();
    if (!correctedStr || autoFilledValue === userCorrectedValue) return;

    // Validate the corrected value before storing it
    const fieldLabel = normalizeLabel(field.label);
    const check = validateValueForField(fieldLabel, correctedStr);
    if (!check.valid) {
      console.warn(`[RL] Rejecting correction for "${fieldLabel}": ${check.reason} (value: "${correctedStr}")`);
      return;
    }

    const fieldType = field.type || field.tagName;
    const key = patternKey(fieldLabel, fieldType);
    const now = Date.now();

    console.log(`[RL] Correction recorded — "${fieldLabel}": "${autoFilledValue}" → "${correctedStr}"`);

    // Create correction event
    const correctionId = generateId();
    const correctionEvent: CorrectionEvent = {
      id: correctionId,
      fieldType,
      fieldLabel,
      autoFilledValue,
      userCorrectedValue: correctedStr,
      timestamp: now,
      context: {
        company: context.company,
        jobTitle: context.jobTitle,
        url: context.url,
      },
    };

    // Update or create pattern
    let pattern = this.findPattern(fieldLabel, fieldType);

    if (pattern) {
      correctionEvent.patternId = pattern.id;

      if (pattern.learnedValue === correctedStr) {
        // User is reinforcing the same learned value — positive signal
        pattern.confidence = computeNewConfidence(
          pattern.confidence,
          RL_PARAMS.successReward,
          pattern.lastUsed
        );
        pattern.successCount++;
      } else {
        // User wants a different value — penalty + update learned value
        pattern.confidence = computeNewConfidence(
          pattern.confidence,
          RL_PARAMS.penaltyReward,
          pattern.lastUsed
        );
        pattern.learnedValue = correctedStr;
        pattern.failureCount++;
      }

      pattern.lastUsed = now;
      this.addContext(pattern, context);
    } else {
      // New pattern — starts at moderate confidence
      const newId = generateId();
      correctionEvent.patternId = newId;

      pattern = {
        id: newId,
        fieldType,
        fieldLabel,
        originalValue: autoFilledValue,
        learnedValue: correctedStr,
        confidence: RL_PARAMS.initialConfidenceCorrection,
        successCount: 0,
        failureCount: 1,
        lastUsed: now,
        createdAt: now,
        contexts: [{ company: context.company, jobTitle: context.jobTitle, url: context.url, timestamp: now }],
      };

      this.patterns.set(key, pattern);
    }

    // Cap corrections list
    this.corrections.push(correctionEvent);
    if (this.corrections.length > RL_PARAMS.maxCorrections) {
      this.corrections = this.corrections.slice(-RL_PARAMS.maxCorrections);
    }

    this.save();
  }

  /**
   * Record that the user submitted a form without changing an autofilled value.
   * This is a positive signal (reward) — the learned value worked.
   */
  async recordSuccess(
    field: FieldSchema,
    value: string,
    context: JobContext
  ): Promise<void> {
    if (!this.ready) await this.initialize();

    const fieldLabel = normalizeLabel(field.label);
    const fieldType = field.type || field.tagName;
    const now = Date.now();

    // Validate the value before storing it
    const check = validateValueForField(fieldLabel, value.trim());
    if (!check.valid) {
      console.warn(`[RL] Rejecting success for "${fieldLabel}": ${check.reason} (value: "${value.trim()}")`);
      return;
    }

    let pattern = this.findPattern(fieldLabel, fieldType);

    if (pattern) {
      // Boost confidence
      pattern.confidence = computeNewConfidence(
        pattern.confidence,
        RL_PARAMS.successReward,
        pattern.lastUsed
      );
      pattern.successCount++;
      pattern.lastUsed = now;
      this.addContext(pattern, context);

      console.log(
        `[RL] Success recorded — "${fieldLabel}" confidence: ${pattern.confidence.toFixed(2)}`
      );
    } else {
      // Create a new pattern from a successful submission (high initial confidence)
      const trimmedValue = value.trim();
      if (!trimmedValue) return;

      pattern = {
        id: generateId(),
        fieldType,
        fieldLabel,
        originalValue: trimmedValue,
        learnedValue: trimmedValue,
        confidence: RL_PARAMS.initialConfidenceSubmission,
        successCount: 1,
        failureCount: 0,
        lastUsed: now,
        createdAt: now,
        contexts: [{ company: context.company, jobTitle: context.jobTitle, url: context.url, timestamp: now }],
      };

      this.patterns.set(patternKey(fieldLabel, fieldType), pattern);

      console.log(
        `[RL] New pattern from submission — "${fieldLabel}" confidence: ${pattern.confidence.toFixed(2)}`
      );
    }

    this.save();
  }

  /**
   * Look up a learned value for a field.
   * Returns null if no pattern exists or confidence is below threshold.
   *
   * This is a synchronous-style fast lookup (in-memory cache).
   * Call initialize() first.
   */
  getLearnedValue(
    field: FieldSchema
  ): { value: string; confidence: number; patternId: string } | null {
    if (!this.ready) {
      console.warn('[RL] getLearnedValue called before initialize()');
      return null;
    }

    const fieldLabel = normalizeLabel(field.label);
    const fieldType = field.type || field.tagName;
    const pattern = this.findPattern(fieldLabel, fieldType);

    if (!pattern) return null;

    if (pattern.confidence < RL_THRESHOLDS.autofill) {
      console.log(
        `[RL] Pattern for "${fieldLabel}" has low confidence (${pattern.confidence.toFixed(2)}) — skipping`
      );
      return null;
    }

    return {
      value: pattern.learnedValue,
      confidence: pattern.confidence,
      patternId: pattern.id,
    };
  }

  // ── Pattern Management ────────────────────────────────────────────────

  /**
   * Find a pattern by field label and type, with fuzzy label matching.
   */
  private findPattern(fieldLabel: string, fieldType: string): LearnedPattern | null {
    // Try exact key first (fast)
    const exact = this.patterns.get(patternKey(fieldLabel, fieldType));
    if (exact) return exact;

    // Fuzzy label scan (needed when label wording varies slightly)
    for (const p of this.patterns.values()) {
      if (p.fieldType === fieldType && labelsSimilar(p.fieldLabel, fieldLabel)) {
        return p;
      }
    }

    return null;
  }

  /** Add a job context to a pattern (capped at 20 entries). */
  private addContext(pattern: LearnedPattern, context: JobContext): void {
    pattern.contexts.push({
      company: context.company,
      jobTitle: context.jobTitle,
      url: context.url,
      timestamp: Date.now(),
    });

    if (pattern.contexts.length > 20) {
      pattern.contexts = pattern.contexts.slice(-20);
    }
  }

  // ── Export / Management ───────────────────────────────────────────────

  /**
   * Get all learned patterns sorted by confidence (descending).
   * Used by the UI to display the learned values list.
   */
  async getAllPatterns(): Promise<LearnedPattern[]> {
    if (!this.ready) await this.initialize();

    return Array.from(this.patterns.values())
      .filter(p => p.confidence >= RL_THRESHOLDS.hide)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Delete a specific learned pattern by ID.
   */
  async deletePattern(patternId: string): Promise<void> {
    if (!this.ready) await this.initialize();

    let deleted = false;
    for (const [key, pattern] of this.patterns.entries()) {
      if (pattern.id === patternId) {
        this.patterns.delete(key);
        deleted = true;
        break;
      }
    }

    if (deleted) {
      console.log(`[RL] Deleted pattern ${patternId}`);
      this.save();
    }
  }

  /**
   * Clear all learned patterns and correction events.
   */
  async clearAll(): Promise<void> {
    this.patterns.clear();
    this.corrections = [];

    await browser.storage.local.remove([
      RL_STORAGE_KEYS.patterns,
      RL_STORAGE_KEYS.corrections,
    ]);

    console.log('[RL] All learned data cleared');
  }

  /**
   * Prune patterns that have fallen below the hide threshold
   * and enforce the max patterns cap (keeps highest confidence).
   */
  prunePatterns(): void {
    // Remove very low confidence patterns
    for (const [key, pattern] of this.patterns.entries()) {
      if (pattern.confidence < RL_THRESHOLDS.hide) {
        this.patterns.delete(key);
      }
    }

    // Enforce max patterns cap
    if (this.patterns.size > RL_PARAMS.maxPatterns) {
      const sorted = Array.from(this.patterns.entries()).sort(
        ([, a], [, b]) => b.confidence - a.confidence
      );
      this.patterns = new Map(sorted.slice(0, RL_PARAMS.maxPatterns));
    }
  }

  /**
   * Get summary stats (for debugging / popup display).
   */
  getStats(): {
    totalPatterns: number;
    highConfidence: number;
    totalCorrections: number;
    avgConfidence: number;
  } {
    const patternsArr = Array.from(this.patterns.values());
    const highConfidence = patternsArr.filter(
      p => p.confidence >= RL_THRESHOLDS.autofill
    ).length;
    const avgConfidence =
      patternsArr.length > 0
        ? patternsArr.reduce((sum, p) => sum + p.confidence, 0) / patternsArr.length
        : 0;

    return {
      totalPatterns: patternsArr.length,
      highConfidence,
      totalCorrections: this.corrections.length,
      avgConfidence,
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const rlSystem = new ReinforcementLearningSystem();
