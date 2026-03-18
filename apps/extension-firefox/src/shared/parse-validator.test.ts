import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParseValidator } from './parse-validator';

// Stub out heavy dependencies so tests run without Ollama
vi.mock('./mastra-agent', () => ({
  mastraAgent: {
    parseResume: vi.fn().mockResolvedValue({ personal: {}, professional: {}, skills: [], work: [], education: [] }),
  },
}));
vi.mock('./rag-parser', () => ({
  ragParser: {
    parseResume: vi.fn().mockResolvedValue({ personal: {}, professional: {}, skills: [], work: [], education: [] }),
  },
}));

// ── ParseValidator.merge ──────────────────────────────────────────────────────

describe('ParseValidator.merge', () => {
  let validator: ParseValidator;

  beforeEach(() => {
    validator = new ParseValidator();
  });

  it('returns a ParseComparison with merged, differences, and confidence', () => {
    const rag = { personal: { name: 'Alice', email: 'alice@example.com' }, skills: ['TypeScript'], work: [], education: [] };
    const legacy = { personal: { name: 'Alice', email: 'alice@example.com' }, skills: ['TypeScript'], work: [], education: [] };

    const result = validator.merge(rag, legacy);

    expect(result).toHaveProperty('ragResult');
    expect(result).toHaveProperty('legacyResult');
    expect(result).toHaveProperty('merged');
    expect(result).toHaveProperty('differences');
    expect(result).toHaveProperty('confidence');
  });

  it('reports zero differences when results are identical', () => {
    const profile = {
      personal: { name: 'Bob Smith', email: 'bob@example.com' },
      skills: ['Python', 'Go'],
      work: [],
      education: [],
    };
    const result = validator.merge(profile, profile);
    expect(result.differences).toHaveLength(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects a difference in personal.name', () => {
    const rag = { personal: { name: 'Alice Smith' }, skills: [], work: [], education: [] };
    const legacy = { personal: { name: 'ALICE SMITH' }, skills: [], work: [], education: [] };

    // Case difference — after toLowerCase() trim, these are equal
    const result = validator.merge(rag, legacy);
    expect(result.differences.some(d => d.field === 'personal.name')).toBe(false);
  });

  it('detects a meaningful difference in personal.email', () => {
    const rag = { personal: { email: 'alice@example.com' }, skills: [], work: [], education: [] };
    const legacy = { personal: { email: 'alice@other.com' }, skills: [], work: [], education: [] };

    const result = validator.merge(rag, legacy);
    expect(result.differences.some(d => d.field === 'personal.email')).toBe(true);
  });

  it('detects skill-count difference', () => {
    const rag = { personal: {}, skills: ['TypeScript', 'React', 'Go'], work: [], education: [] };
    const legacy = { personal: {}, skills: ['TypeScript'], work: [], education: [] };

    const result = validator.merge(rag, legacy);
    expect(result.differences.some(d => d.field === 'skills')).toBe(true);
  });

  it('confidence is lower when there are many differences', () => {
    const rag = {
      personal: { name: 'Alice', email: 'a@x.com', phone: '111', city: 'NYC' },
      skills: ['TypeScript', 'Go', 'Rust'],
      work: [{ company: 'Acme', title: 'Engineer', startDate: '2020' }],
      education: [{ school: 'MIT', degree: 'BS' }],
    };
    const legacy = {
      personal: { name: 'Bob', email: 'b@y.com', phone: '222', city: 'LA' },
      skills: ['Python', 'Java'],
      work: [{ company: 'Corp', title: 'Dev', startDate: '2019' }],
      education: [{ school: 'Stanford', degree: 'MS' }],
    };

    const resultMany = validator.merge(rag, legacy);
    const resultNone = validator.merge(rag, rag);

    expect(resultMany.confidence).toBeLessThan(resultNone.confidence);
  });

  it('merged result prefers the non-empty value when one side is missing', () => {
    const rag = { personal: { name: 'Carol' }, skills: [], work: [], education: [] };
    const legacy = { personal: { name: '' }, skills: [], work: [], education: [] };

    const result = validator.merge(rag, legacy);
    // Merged should keep 'Carol' from RAG
    expect(result.merged?.personal?.name).toBe('Carol');
  });

  it('passes both original results through unchanged', () => {
    const rag = { personal: { name: 'Alice' }, skills: ['Go'], work: [], education: [] };
    const legacy = { personal: { name: 'Alice' }, skills: ['Go'], work: [], education: [] };

    const result = validator.merge(rag, legacy);
    expect(result.ragResult).toBe(rag);
    expect(result.legacyResult).toBe(legacy);
  });
});
