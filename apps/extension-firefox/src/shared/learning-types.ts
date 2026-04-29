/**
 * TypeScript interfaces for the Reinforcement Learning learning system.
 * These replace the old LearningPattern/FieldCorrection types.
 */

/**
 * A learned preference pattern for a specific field type.
 * Confidence is tracked via RL reward/penalty signals.
 */
export interface LearnedPattern {
  /** Unique ID for this pattern */
  id: string;

  /** Normalized field type: "email", "phone", "linkedin", etc. */
  fieldType: string;

  /** Normalized field label (lowercased, trimmed) */
  fieldLabel: string;

  // ── RL Components ──────────────────────────────────────────────────────

  /** The value autofill originally suggested */
  originalValue: string;

  /** The value the user prefers (corrected to) */
  learnedValue: string;

  /**
   * RL confidence score [0, 1].
   * > 0.6 → used in autofill.
   * Increases with successes, decreases with corrections, decays with age.
   */
  confidence: number;

  // ── Tracking ───────────────────────────────────────────────────────────

  /** Times autofill used this learned value and user did NOT change it */
  successCount: number;

  /** Times autofill used this learned value and user changed it again */
  failureCount: number;

  /** Timestamp of most recent use (ms since epoch) */
  lastUsed: number;

  /** Timestamp of first correction (ms since epoch) */
  createdAt: number;

  // ── Context History ────────────────────────────────────────────────────

  /** Up to 20 most recent application contexts where this pattern was active */
  contexts: Array<{
    company: string;
    jobTitle: string;
    url: string;
    timestamp: number;
  }>;
}

/**
 * A single correction event — when the user edits an autofilled field.
 */
export interface CorrectionEvent {
  id: string;
  fieldType: string;
  fieldLabel: string;
  autoFilledValue: string;
  userCorrectedValue: string;
  timestamp: number;

  /** ID of the LearnedPattern that was updated (if any) */
  patternId?: string;

  context: {
    company: string;
    jobTitle: string;
    url: string;
  };
}

/**
 * Context about the current job application.
 */
export interface JobContext {
  company: string;
  jobTitle: string;
  url: string;
}

/**
 * Storage keys used by the RL system.
 * All data is kept in browser.storage.local.
 */
export const RL_STORAGE_KEYS = {
  patterns: 'rl_learned_patterns',
  corrections: 'rl_correction_events',
} as const;

/**
 * Confidence thresholds for decision-making.
 */
export const RL_THRESHOLDS = {
  /** Minimum confidence to use a learned value in autofill */
  autofill: 0.6,
  /** Confidence level at which we stop showing a pattern in UI (too low to matter) */
  hide: 0.1,
} as const;

/**
 * RL algorithm hyperparameters.
 */
export const RL_PARAMS = {
  learningRate: 0.1,
  successReward: 1,
  penaltyReward: -1,
  /** Multiplicative decay applied on each confidence update */
  decayFactor: 0.95,
  /** Time window for age-based decay: 30 days in ms */
  decayWindowMs: 30 * 24 * 60 * 60 * 1000,
  /** Starting confidence for a new pattern from a user correction */
  initialConfidenceCorrection: 0.5,
  /** Starting confidence for a pattern confirmed by form submission */
  initialConfidenceSubmission: 0.8,
  /** Maximum stored patterns */
  maxPatterns: 1000,
  /** Maximum stored correction events */
  maxCorrections: 500,
} as const;
