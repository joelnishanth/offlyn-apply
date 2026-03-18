import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isGenericJobEntry,
  isDuplicateSubmit,
  resetDedupState,
  GENERIC_JOB_TITLES,
  GENERIC_COMPANY_NAMES,
  SUBMIT_DEDUP_WINDOW_MS,
} from './job-dedup';

// ── isGenericJobEntry ─────────────────────────────────────────────────────────

describe('isGenericJobEntry', () => {
  it('returns false for a real job + real company', () => {
    expect(isGenericJobEntry('Software Engineer', 'Stripe')).toBe(false);
  });

  it('returns false for a real job title with unusual casing', () => {
    expect(isGenericJobEntry('Senior Product Manager', 'Acme Corp')).toBe(false);
  });

  // ── Generic job title hits ─────────────────────────────────────────────────

  it.each([...GENERIC_JOB_TITLES])(
    'returns true for generic title "%s"',
    (title) => {
      expect(isGenericJobEntry(title, 'Stripe')).toBe(true);
    }
  );

  it('matches generic title case-insensitively', () => {
    expect(isGenericJobEntry('APPLY NOW', 'Google')).toBe(true);
    expect(isGenericJobEntry('  Confirmation  ', 'Airbnb')).toBe(true);
  });

  it('matches "Thank You" (confirmation page heading)', () => {
    expect(isGenericJobEntry('Thank You', 'Meta')).toBe(true);
  });

  it('matches "Application Submitted" (confirmation page heading)', () => {
    expect(isGenericJobEntry('Application Submitted', 'Netflix')).toBe(true);
  });

  // ── Generic company name hits ──────────────────────────────────────────────

  it.each([...GENERIC_COMPANY_NAMES])(
    'returns true for generic company "%s"',
    (company) => {
      expect(isGenericJobEntry('Software Engineer', company)).toBe(true);
    }
  );

  it('matches ATS provider name "greenhouse" as generic company', () => {
    expect(isGenericJobEntry('Software Engineer', 'greenhouse')).toBe(true);
  });

  it('matches ATS provider name "lever" as generic company', () => {
    expect(isGenericJobEntry('Backend Developer', 'lever')).toBe(true);
  });

  it('returns false when company is a real company containing "jobs" as substring', () => {
    // "Jobs & More Inc" would NOT match because the lookup is exact on the normalized value
    expect(isGenericJobEntry('Engineer', 'Jobs & More Inc')).toBe(false);
  });
});

// ── isDuplicateSubmit ─────────────────────────────────────────────────────────

describe('isDuplicateSubmit', () => {
  beforeEach(() => {
    resetDedupState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetDedupState();
  });

  it('returns false on the very first call for a key', () => {
    expect(isDuplicateSubmit('Stripe', 'Software Engineer')).toBe(false);
  });

  it('returns true on the immediate second call for the same key', () => {
    isDuplicateSubmit('Stripe', 'Software Engineer');
    expect(isDuplicateSubmit('Stripe', 'Software Engineer')).toBe(true);
  });

  it('returns false for a different company+title pair', () => {
    isDuplicateSubmit('Stripe', 'Software Engineer');
    expect(isDuplicateSubmit('Stripe', 'Product Manager')).toBe(false);
    expect(isDuplicateSubmit('Airbnb', 'Software Engineer')).toBe(false);
  });

  it('is case-insensitive — "STRIPE"/"stripe" deduplicate together', () => {
    isDuplicateSubmit('STRIPE', 'Software Engineer');
    expect(isDuplicateSubmit('stripe', 'software engineer')).toBe(true);
  });

  it('trims whitespace when building the key', () => {
    isDuplicateSubmit('  Stripe  ', '  Software Engineer  ');
    expect(isDuplicateSubmit('Stripe', 'Software Engineer')).toBe(true);
  });

  it('returns false again after the dedup window expires', () => {
    isDuplicateSubmit('Stripe', 'Software Engineer');
    // Advance past the 60-second window
    vi.advanceTimersByTime(SUBMIT_DEDUP_WINDOW_MS + 1000);
    expect(isDuplicateSubmit('Stripe', 'Software Engineer')).toBe(false);
  });

  it('still returns true within the dedup window', () => {
    isDuplicateSubmit('Stripe', 'Software Engineer');
    vi.advanceTimersByTime(SUBMIT_DEDUP_WINDOW_MS - 1000);
    expect(isDuplicateSubmit('Stripe', 'Software Engineer')).toBe(true);
  });

  it('handles multiple independent keys simultaneously', () => {
    isDuplicateSubmit('CompanyA', 'Role1');
    isDuplicateSubmit('CompanyB', 'Role2');
    expect(isDuplicateSubmit('CompanyA', 'Role1')).toBe(true);
    expect(isDuplicateSubmit('CompanyB', 'Role2')).toBe(true);
    expect(isDuplicateSubmit('CompanyC', 'Role3')).toBe(false);
  });
});
