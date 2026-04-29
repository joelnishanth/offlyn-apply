import { describe, it, expect } from 'vitest';
import { scoreCandidate, selectBestCandidate, deriveConfidence, meetsAutofillThreshold } from '../scoring';
import type { GraphNode, ScoringContext } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnswerNode(usageCount = 1, lastUsedAt = Date.now()): GraphNode {
  return {
    id: 'answer:test',
    type: 'answer',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    payload: {
      value: 'Test value',
      source: 'llm',
      confidence: 0.8,
      usageCount,
      lastUsedAt,
    },
  };
}

function makeCtx(matchClass: ScoringContext['matchClass'], overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    matchClass,
    hasCorrectionNode: matchClass === 'correction',
    ...overrides,
  };
}

// ── deriveConfidence ──────────────────────────────────────────────────────────

describe('deriveConfidence', () => {
  it('correction tier maps to [0.90, 1.0] range', () => {
    const low = deriveConfidence('correction', 0);
    const high = deriveConfidence('correction', 1);
    expect(low).toBeCloseTo(0.90, 1);
    expect(high).toBeCloseTo(1.0, 1);
  });

  it('exact tier maps to [0.80, 0.90] range', () => {
    const low = deriveConfidence('exact', 0);
    const high = deriveConfidence('exact', 1);
    expect(low).toBeCloseTo(0.80, 1);
    expect(high).toBeCloseTo(0.90, 1);
  });

  it('field tier maps to [0.65, 0.80] range', () => {
    const low = deriveConfidence('field', 0);
    const high = deriveConfidence('field', 1);
    expect(low).toBeCloseTo(0.65, 1);
    expect(high).toBeCloseTo(0.80, 1);
  });

  it('similarity tier maps to [0.45, 0.75] range', () => {
    const low = deriveConfidence('similarity', 0);
    const high = deriveConfidence('similarity', 1);
    expect(low).toBeCloseTo(0.45, 1);
    expect(high).toBeCloseTo(0.75, 1);
  });

  it('clamps to [0, 1]', () => {
    expect(deriveConfidence('exact', 2)).toBeLessThanOrEqual(1);
    expect(deriveConfidence('similarity', -1)).toBeGreaterThanOrEqual(0);
  });
});

// ── meetsAutofillThreshold ────────────────────────────────────────────────────

describe('meetsAutofillThreshold', () => {
  it('passes confidence >= 0.60', () => {
    expect(meetsAutofillThreshold(0.60)).toBe(true);
    expect(meetsAutofillThreshold(0.85)).toBe(true);
    expect(meetsAutofillThreshold(1.0)).toBe(true);
  });

  it('fails confidence < 0.60', () => {
    expect(meetsAutofillThreshold(0.59)).toBe(false);
    expect(meetsAutofillThreshold(0.45)).toBe(false);
    expect(meetsAutofillThreshold(0)).toBe(false);
  });
});

// ── selectBestCandidate — tier ordering ───────────────────────────────────────

describe('selectBestCandidate — tier ordering', () => {
  it('returns null for empty candidates', () => {
    expect(selectBestCandidate([])).toBeNull();
  });

  it('correction tier always beats exact tier', () => {
    const answer = makeAnswerNode();
    const correctionCandidate = scoreCandidate(answer, makeCtx('correction'));
    const exactCandidate = scoreCandidate(answer, makeCtx('exact'));

    const best = selectBestCandidate([exactCandidate, correctionCandidate]);
    expect(best?.matchClass).toBe('correction');
  });

  it('exact tier always beats field tier', () => {
    const answer = makeAnswerNode();
    const exactCandidate = scoreCandidate(answer, makeCtx('exact'));
    const fieldCandidate = scoreCandidate(answer, makeCtx('field'));

    const best = selectBestCandidate([fieldCandidate, exactCandidate]);
    expect(best?.matchClass).toBe('exact');
  });

  it('field tier always beats similarity tier', () => {
    const answer = makeAnswerNode();
    const fieldCandidate = scoreCandidate(answer, makeCtx('field'));
    const simCandidate = scoreCandidate(answer, makeCtx('similarity', { similarityScore: 0.99 }));

    const best = selectBestCandidate([simCandidate, fieldCandidate]);
    expect(best?.matchClass).toBe('field');
  });

  it('correction beats exact even when exact has much higher usage', () => {
    const highUsageAnswer = makeAnswerNode(100);
    const lowUsageAnswer = makeAnswerNode(1);

    const exact = scoreCandidate(highUsageAnswer, makeCtx('exact'));
    const correction = scoreCandidate(lowUsageAnswer, makeCtx('correction'));

    const best = selectBestCandidate([exact, correction]);
    expect(best?.matchClass).toBe('correction');
  });
});

// ── selectBestCandidate — within-tier tiebreaking ────────────────────────────

describe('selectBestCandidate — within-tier comparison', () => {
  it('prefers more recently used answer in same tier', () => {
    const recentAnswer = makeAnswerNode(1, Date.now());
    const staleAnswer = makeAnswerNode(1, Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentCand = scoreCandidate(recentAnswer, makeCtx('exact'));
    const staleCand = scoreCandidate(staleAnswer, makeCtx('exact'));

    const best = selectBestCandidate([staleCand, recentCand]);
    expect(best).toBe(recentCand);
  });

  it('prefers answer with platform match over non-matching', () => {
    const answer = makeAnswerNode();
    const withPlatform = scoreCandidate(answer, makeCtx('field', {
      platform: 'greenhouse',
      questionPlatform: 'greenhouse',
    }));
    const withoutPlatform = scoreCandidate(answer, makeCtx('field', {
      platform: 'lever',
      questionPlatform: 'greenhouse',
    }));

    const best = selectBestCandidate([withoutPlatform, withPlatform]);
    expect(best).toBe(withPlatform);
  });

  it('single candidate is always returned', () => {
    const answer = makeAnswerNode();
    const single = scoreCandidate(answer, makeCtx('field'));
    expect(selectBestCandidate([single])).toBe(single);
  });
});
