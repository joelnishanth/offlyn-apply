/**
 * Graph Memory Layer — Tiered Scoring
 *
 * Answers are ranked by MATCH CLASS first (tier), then by secondary factors
 * within the same tier. This prevents a highly-recent similar answer from
 * accidentally outranking a correction-backed exact match.
 *
 * Tier order (higher always wins):
 *   4 = correction
 *   3 = exact question match
 *   2 = canonical field match
 *   1 = embedding similarity
 *
 * Confidence ranges per tier are mapped to [min, max] and the within-tier
 * score linearly scales the final confidence value within that range.
 */

import {
  AUTOFILL_CONFIDENCE_THRESHOLD,
  CONFIDENCE_RANGE,
  MATCH_CLASS_TIER,
  RECENCY_DECAY_MS,
} from './constants';
import type { AnswerPayload, GraphNode, MatchClass, ScoringContext } from './types';

// ── Within-tier secondary score ───────────────────────────────────────────────

/**
 * Score an answer candidate on secondary factors (all 0–1 scale).
 * Used to rank answers within the same match class tier.
 */
export function withinTierScore(answer: GraphNode, ctx: ScoringContext): number {
  const payload = answer.payload as AnswerPayload;
  let score = 0;

  // Recency decay — 30-day half-life
  const age = Date.now() - payload.lastUsedAt;
  score += Math.exp(-age / RECENCY_DECAY_MS) * 0.5;

  // Platform match
  if (ctx.platform && ctx.questionPlatform && ctx.platform === ctx.questionPlatform) {
    score += 0.3;
  }

  // Usage frequency (log scale to prevent high-use answers dominating completely)
  score += Math.min(Math.log(payload.usageCount + 1) * 0.1, 0.15);

  // Similarity score bonus (only meaningful in similarity tier)
  if (ctx.matchClass === 'similarity' && ctx.similarityScore !== undefined) {
    score += ctx.similarityScore * 0.2;
  }

  // Clamp to [0, 1]
  return Math.min(score, 1);
}

// ── Confidence derivation ─────────────────────────────────────────────────────

/**
 * Derive a final confidence score for an answer given its match class and
 * within-tier secondary score.
 *
 * Confidence is the within-tier score linearly mapped to the tier's
 * confidence range [min, max].
 */
export function deriveConfidence(matchClass: MatchClass, secondaryScore: number): number {
  // Correction-backed answers always use the correction range
  const rangeKey: keyof typeof CONFIDENCE_RANGE =
    matchClass === 'correction' ? 'correction' : matchClass;

  const [min, max] = CONFIDENCE_RANGE[rangeKey];
  const confidence = min + secondaryScore * (max - min);
  return Math.min(Math.max(confidence, 0), 1);
}

// ── Candidate ranking ─────────────────────────────────────────────────────────

export interface ScoredCandidate {
  node: GraphNode;
  matchClass: MatchClass;
  confidence: number;
  secondaryScore: number;
}

/**
 * Select the best answer from a list of scored candidates.
 *
 * Comparison:
 *   1. Higher tier wins
 *   2. Within same tier: higher secondary score wins
 *   3. Tie-break: higher confidence wins
 */
export function selectBestCandidate(
  candidates: ScoredCandidate[]
): ScoredCandidate | null {
  if (candidates.length === 0) return null;

  return candidates.reduce((best, curr) => {
    const bestTier = MATCH_CLASS_TIER[best.matchClass];
    const currTier = MATCH_CLASS_TIER[curr.matchClass];

    if (currTier > bestTier) return curr;
    if (currTier < bestTier) return best;

    // Same tier — compare secondary score
    if (curr.secondaryScore > best.secondaryScore) return curr;
    if (curr.secondaryScore < best.secondaryScore) return best;

    // Tiebreak by confidence
    return curr.confidence >= best.confidence ? curr : best;
  });
}

/**
 * Score a single answer candidate and return a ScoredCandidate.
 */
export function scoreCandidate(
  answerNode: GraphNode,
  ctx: ScoringContext
): ScoredCandidate {
  const secondary = withinTierScore(answerNode, ctx);
  const confidence = deriveConfidence(ctx.matchClass, secondary);
  return { node: answerNode, matchClass: ctx.matchClass, confidence, secondaryScore: secondary };
}

/**
 * Returns true if the confidence is high enough to use in autofill.
 */
export function meetsAutofillThreshold(confidence: number): boolean {
  return confidence >= AUTOFILL_CONFIDENCE_THRESHOLD;
}
