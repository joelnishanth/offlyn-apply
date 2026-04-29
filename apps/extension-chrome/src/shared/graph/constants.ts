/**
 * Graph Memory Layer — Constants
 *
 * Enums, storage keys, scoring weights, pruning thresholds, and node ID prefixes.
 */

import type { MatchClass, NodeType } from './types';

// ── Storage keys ──────────────────────────────────────────────────────────────

export const GRAPH_STORAGE_KEYS = {
  nodes:          'graph_nodes',
  edges:          'graph_edges',
  meta:           'graph_meta',
  embeddingCache: 'graph_embedding_cache',
} as const;

export type GraphStorageKey = (typeof GRAPH_STORAGE_KEYS)[keyof typeof GRAPH_STORAGE_KEYS];

// ── Schema version ────────────────────────────────────────────────────────────

export const CURRENT_SCHEMA_VERSION = 1;

// ── Node ID prefixes ──────────────────────────────────────────────────────────

export const NODE_ID_PREFIX: Record<NodeType, string> = {
  question:    'question',
  answer:      'answer',
  field:       'field',
  application: 'application',
  correction:  'correction',
};

/**
 * Long-form fields where answer deduplication is skipped.
 * Each generated/edited response is kept as a distinct answer node.
 */
export const LONG_FORM_FIELDS = new Set([
  'cover_letter',
  'why_company',
  'about_yourself',
  'additional_info',
  'personal_statement',
  'motivation',
  'career_goals',
]);

/** Answers longer than this (characters) are treated as long-form regardless of field type. */
export const LONG_FORM_LENGTH_THRESHOLD = 120;

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Tier order — higher always wins regardless of within-tier score.
 * A correction-backed result always outranks an exact match,
 * which always outranks a field match, etc.
 */
export const MATCH_CLASS_TIER: Record<MatchClass, number> = {
  correction: 4,
  exact:      3,
  field:      2,
  similarity: 1,
};

/**
 * Confidence ranges mapped to match class.
 * Within each range, within-tier score linearly scales the final value.
 */
export const CONFIDENCE_RANGE: Record<MatchClass | 'correction', [number, number]> = {
  correction: [0.90, 1.00],
  exact:      [0.80, 0.90],
  field:      [0.65, 0.80],
  similarity: [0.45, 0.75],
};

/** Minimum confidence for an answer to be used in autofill (not just suggestions). */
export const AUTOFILL_CONFIDENCE_THRESHOLD = 0.60;

/** Minimum similarity score to consider two questions related. */
export const SIMILARITY_THRESHOLD = 0.70;

/** Similarity-backed answers with prior usage get a confidence boost into the 0.60–0.75 range. */
export const SIMILARITY_WITH_USAGE_MIN_CONFIDENCE = 0.60;

// ── Pruning thresholds ────────────────────────────────────────────────────────

export const PRUNING = {
  /** Orphan answer nodes (no edges, zero usage) older than this are pruned. */
  orphanAnswerAgeMs: 7 * 24 * 60 * 60 * 1000,

  /** Application nodes older than this and unreferenced are pruned. */
  applicationAgeMs: 90 * 24 * 60 * 60 * 1000,

  /** SIMILAR_TO edges with weight below this are pruned. */
  minSimilarityEdgeWeight: 0.30,

  /** Question nodes with no outbound ANSWERED_BY and no inbound edges, older than this. */
  orphanQuestionAgeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

// ── Recency decay ─────────────────────────────────────────────────────────────

/** 30-day half-life for recency scoring. */
export const RECENCY_DECAY_MS = 30 * 24 * 60 * 60 * 1000;

// ── Write debounce ────────────────────────────────────────────────────────────

/** Debounce window for storage saves (ms). */
export const SAVE_DEBOUNCE_MS = 500;

/** Debounce window for embedding cache saves (ms). */
export const EMBEDDING_CACHE_SAVE_DEBOUNCE_MS = 2000;
