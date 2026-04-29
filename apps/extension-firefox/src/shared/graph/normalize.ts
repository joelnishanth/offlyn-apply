/**
 * Graph Memory Layer — Normalization
 *
 * Deterministic normalization for questions and field names, plus a fast
 * non-crypto hash used to build stable node IDs.
 */

// ── Hash ──────────────────────────────────────────────────────────────────────

/**
 * FNV-1a 32-bit hash — fast, deterministic, no crypto dependency.
 * Returns an 8-character lowercase hex string.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // Multiply by FNV prime, keeping within 32-bit unsigned range
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ── Abbreviation map ──────────────────────────────────────────────────────────

/** Common abbreviation normalizations applied during question normalization. */
const ABBREVIATION_MAP: Array<[RegExp, string]> = [
  [/\bu\.s\.a?\.?\b/gi, 'us'],
  [/\bu\.k\.?\b/gi, 'uk'],
  [/\bpls\b/gi, 'please'],
  [/\bcurrently\b/gi, 'current'],
  [/\btel(ephone)?\b/gi, 'phone'],
  [/\be-?mail\b/gi, 'email'],
];

/** Filler words stripped from questions (they add noise, not meaning). */
const FILLER_PATTERN =
  /\b(please|kindly|briefly|provide|enter|type|describe|tell us|let us know|share|your)\b\s*/gi;

// ── Question normalization ────────────────────────────────────────────────────

/**
 * Normalize a question label for consistent graph matching.
 *
 * Applies in order:
 *   1. Lowercase + trim
 *   2. Abbreviation normalization
 *   3. Punctuation removal (safe punctuation only)
 *   4. Filler word stripping
 *   5. Whitespace collapse
 */
export function normalizeQuestion(text: string): string {
  if (!text) return '';

  let s = text.toLowerCase().trim();

  for (const [pattern, replacement] of ABBREVIATION_MAP) {
    s = s.replace(pattern, replacement);
  }

  // Remove safe punctuation — preserve hyphens inside words (e.g. "full-time")
  s = s.replace(/[.,;:!?'"()[\]{}*]/g, '');

  // Strip filler words
  s = s.replace(FILLER_PATTERN, '');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

// ── Field name normalization ──────────────────────────────────────────────────

/**
 * Normalize a field name / label to a canonical snake_case identifier.
 *
 * Used to build `field:${canonicalField}` node IDs and for index lookups.
 */
export function normalizeField(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .replace(/[\s\-/]+/g, '_')   // spaces, hyphens, slashes → underscore
    .replace(/[^a-z0-9_]/g, '')  // strip everything else
    .replace(/_+/g, '_')         // collapse multiple underscores
    .replace(/^_|_$/g, '');      // trim leading/trailing underscores
}

// ── Answer value normalization (for short-form dedup) ────────────────────────

/**
 * Normalize a short-form answer value for answer node deduplication.
 * Only used when the answer is NOT long-form.
 */
export function normalizeAnswerValue(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── Stable node ID builders ───────────────────────────────────────────────────

/**
 * Deterministic question node ID.
 * Two question phrasings that normalize to the same text share one node.
 */
export function questionNodeId(normalizedText: string): string {
  return `question:${hashText(normalizedText)}`;
}

/**
 * Deterministic field node ID.
 * Field nodes are deduplicated by canonical field name.
 */
export function fieldNodeId(canonicalField: string): string {
  return `field:${canonicalField}`;
}

/**
 * Deterministic answer node ID for SHORT-FORM answers.
 * Two answers with the same value for the same field share one node.
 */
export function shortFormAnswerNodeId(normalizedValue: string, canonicalField: string): string {
  return `answer:${hashText(normalizedValue + '|' + canonicalField)}`;
}

/**
 * Random answer node ID for LONG-FORM answers.
 * Each generated or edited long-form response is a distinct node.
 */
export function longFormAnswerNodeId(): string {
  return `answer:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Random correction node ID.
 */
export function correctionNodeId(): string {
  return `correction:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Random application node ID.
 */
export function applicationNodeId(): string {
  return `application:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Edge key for upsert lookup: `${from}:${to}:${type}` → edge id.
 */
export function edgeKey(from: string, to: string, type: string): string {
  return `${from}:${to}:${type}`;
}
