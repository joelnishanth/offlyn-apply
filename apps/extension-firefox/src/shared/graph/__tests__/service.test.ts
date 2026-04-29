import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock browser.storage.local before importing service
const mockStorage: Record<string, unknown> = {};

vi.stubGlobal('browser', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const k of keys) {
          if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
        }
        return result;
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(mockStorage, data);
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const k of keys) delete mockStorage[k];
      }),
    },
  },
});

// Import after stubbing
import { GraphMemoryService } from '../service';
import { normalizeQuestion, questionNodeId, fieldNodeId } from '../normalize';
import type { AnswerPayload, QuestionPayload } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function freshService(): Promise<GraphMemoryService> {
  // Clear mock storage
  for (const k of Object.keys(mockStorage)) delete mockStorage[k];
  const svc = new GraphMemoryService();
  await svc.initialize();
  return svc;
}

// ── Node deduplication ────────────────────────────────────────────────────────

describe('node deduplication', () => {
  it('creates only one question node for the same normalized text', async () => {
    const svc = await freshService();
    const q1 = svc.upsertQuestionNode('What is your current role?');
    const q2 = svc.upsertQuestionNode('what is your current role');
    // Different raw text but same normalized — should deduplicate
    expect(q1.id).toBe(questionNodeId(normalizeQuestion('what is your current role')));
    expect(q2.id).toBe(q1.id);
  });

  it('creates only one field node for the same canonicalField', async () => {
    const svc = await freshService();
    const f1 = svc.upsertFieldNode('cover_letter');
    const f2 = svc.upsertFieldNode('cover_letter', 'Cover Letter');
    expect(f1.id).toBe(fieldNodeId('cover_letter'));
    expect(f2.id).toBe(f1.id);
  });

  it('adds alias to existing field node without creating duplicate', async () => {
    const svc = await freshService();
    svc.upsertFieldNode('first_name');
    const updated = svc.upsertFieldNode('first_name', 'First Name');
    expect((updated.payload as import('../types').FieldPayload).aliases).toContain('First Name');
  });
});

// ── Edge upsert ───────────────────────────────────────────────────────────────

describe('createOrUpdateEdge', () => {
  it('creates a new edge when none exists', async () => {
    const svc = await freshService();
    const q = svc.upsertQuestionNode('test question');
    const a = svc.upsertAnswerNode('test answer', 'some_field', 'llm');
    const edge = svc.createOrUpdateEdge(q.id, a.id, 'ANSWERED_BY', 1.0);
    expect(edge.from).toBe(q.id);
    expect(edge.to).toBe(a.id);
    expect(edge.type).toBe('ANSWERED_BY');
  });

  it('updates existing edge instead of creating duplicate', async () => {
    const svc = await freshService();
    const q = svc.upsertQuestionNode('test question');
    const a = svc.upsertAnswerNode('test answer', 'some_field', 'llm');
    const edge1 = svc.createOrUpdateEdge(q.id, a.id, 'ANSWERED_BY', 0.5);
    const edge2 = svc.createOrUpdateEdge(q.id, a.id, 'ANSWERED_BY', 0.9);
    expect(edge1.id).toBe(edge2.id); // same edge
    expect(edge2.weight).toBe(0.9);  // updated weight
  });

  it('does not confuse edges with different types between same nodes', async () => {
    const svc = await freshService();
    const q1 = svc.upsertQuestionNode('question A');
    const q2 = svc.upsertQuestionNode('question B');
    const similar = svc.createOrUpdateEdge(q1.id, q2.id, 'SIMILAR_TO', 0.8);
    const derived = svc.createOrUpdateEdge(q1.id, q2.id, 'DERIVED_FROM', 1.0);
    expect(similar.id).not.toBe(derived.id);
  });
});

// ── Question lookup ───────────────────────────────────────────────────────────

describe('getBestAnswerForField — exact match', () => {
  it('returns null when graph is empty', async () => {
    const svc = await freshService();
    const result = await svc.getBestAnswerForField({ questionText: 'What is your name?' });
    expect(result.value).toBeNull();
    expect(result.source).toBeNull();
  });

  it('returns the answer for an exact question match', async () => {
    const svc = await freshService();
    svc.recordAnswer('What is your current role?', 'Software Engineer', 'llm', 'job_title');
    const result = await svc.getBestAnswerForField({
      questionText: 'what is your current role',
    });
    expect(result.value).toBe('Software Engineer');
    expect(result.source).toBe('graph-exact');
  });

  it('matches despite different phrasing (normalized same)', async () => {
    const svc = await freshService();
    svc.recordAnswer('Please enter your email address', 'user@example.com', 'profile', 'email');
    const result = await svc.getBestAnswerForField({
      questionText: 'Enter your email address',
    });
    expect(result.value).toBe('user@example.com');
  });
});

// ── Field lookup ──────────────────────────────────────────────────────────────

describe('getBestAnswerForField — field match', () => {
  it('finds answer via canonical field when no exact question match', async () => {
    const svc = await freshService();
    // Record answer for a differently-worded question but same canonical field
    svc.recordAnswer('What is your current job title?', 'Senior Engineer', 'profile', 'job_title');

    // Lookup with a new question phrasing but same canonical field
    const result = await svc.getBestAnswerForField({
      questionText: 'Desired role',
      canonicalField: 'job_title',
    });
    expect(result.value).toBe('Senior Engineer');
    expect(result.source).toBe('graph-field');
  });
});

// ── Correction recording ──────────────────────────────────────────────────────

describe('recordCorrection', () => {
  it('stores a correction node and connects to question AND field', async () => {
    const svc = await freshService();
    svc.recordCorrection(
      'What is your first name?',
      'first_name',
      'John Doe',
      'John',
      { company: 'Acme', jobTitle: 'Engineer' }
    );

    // After correction, the corrected value should be returned
    const result = await svc.getBestAnswerForField({
      questionText: 'What is your first name?',
    });
    expect(result.value).toBe('John');
  });

  it('no-ops when original and corrected values are the same', async () => {
    const svc = await freshService();
    const statsBefore = svc.getStats();
    svc.recordCorrection('field', 'first_name', 'same', 'same', {});
    const statsAfter = svc.getStats();
    expect(statsAfter.nodeCount).toBe(statsBefore.nodeCount);
  });
});

// ── Fill provenance ───────────────────────────────────────────────────────────

describe('fill provenance', () => {
  it('stores and retrieves fill provenance by label', async () => {
    const svc = await freshService();
    const record = {
      value: 'hello',
      source: 'exact' as const,
      confidence: 0.85,
      resolvedAt: Date.now(),
    };
    svc.recordFillProvenance('First Name', record);
    const retrieved = svc.getLastFillProvenance('First Name');
    expect(retrieved?.value).toBe('hello');
    expect(retrieved?.confidence).toBe(0.85);
  });

  it('normalizes label before storing', async () => {
    const svc = await freshService();
    const record = { value: 'x', source: 'rl' as const, confidence: 0.7, resolvedAt: Date.now() };
    svc.recordFillProvenance('  First Name!  ', record);
    // Should retrieve under the normalized form
    expect(svc.getLastFillProvenance('first name')).not.toBeNull();
  });

  it('returns null for an unknown label', async () => {
    const svc = await freshService();
    expect(svc.getLastFillProvenance('nonexistent')).toBeNull();
  });
});

// ── Pruning ───────────────────────────────────────────────────────────────────

describe('pruneGraph', () => {
  it('removes SIMILAR_TO edges below weight threshold', async () => {
    const svc = await freshService();
    const q1 = svc.upsertQuestionNode('question one');
    const q2 = svc.upsertQuestionNode('question two');
    const edge = svc.createOrUpdateEdge(q1.id, q2.id, 'SIMILAR_TO', 0.1); // below 0.30
    const statsBefore = svc.getStats();
    svc.pruneGraph();
    const statsAfter = svc.getStats();
    expect(statsAfter.edgeCount).toBeLessThan(statsBefore.edgeCount);
  });

  it('does not remove field nodes', async () => {
    const svc = await freshService();
    svc.upsertFieldNode('cover_letter');
    svc.pruneGraph();
    expect(svc.getStats().nodeCount).toBeGreaterThan(0);
  });
});
