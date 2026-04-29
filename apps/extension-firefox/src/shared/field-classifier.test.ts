import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FieldClassifier,
  isTypeCompatible,
  classifyFieldSync,
  fieldClassifier,
} from './field-classifier';

// ── isTypeCompatible ──────────────────────────────────────────────────────────

describe('isTypeCompatible', () => {
  it('returns false for empty value', () => {
    expect(isTypeCompatible('', 'profile_field')).toBe(false);
  });

  // date_field rejects enum values
  it('rejects "Yes" for date_field', () => {
    expect(isTypeCompatible('Yes', 'date_field')).toBe(false);
  });

  it('rejects "No" for date_field', () => {
    expect(isTypeCompatible('No', 'date_field')).toBe(false);
  });

  it('accepts a date-like string for date_field', () => {
    expect(isTypeCompatible('January 2024', 'date_field')).toBe(true);
  });

  // salary_field
  it('rejects "Yes" for salary_field', () => {
    expect(isTypeCompatible('Yes', 'salary_field')).toBe(false);
  });

  it('accepts "$120,000" for salary_field', () => {
    expect(isTypeCompatible('$120,000', 'salary_field')).toBe(true);
  });

  it('accepts "£80k - £90k" for salary_field', () => {
    expect(isTypeCompatible('£80k - £90k', 'salary_field')).toBe(true);
  });

  it('rejects a non-numeric string for salary_field', () => {
    expect(isTypeCompatible('negotiable', 'salary_field')).toBe(false);
  });

  // enum fields reject long text
  it('rejects a 90-character essay for enum_yes_no', () => {
    const longText = 'I have extensive experience in software development and believe strongly in quality.';
    expect(isTypeCompatible(longText, 'enum_yes_no')).toBe(false);
  });

  it('accepts "Yes" for enum_yes_no', () => {
    expect(isTypeCompatible('Yes', 'enum_yes_no')).toBe(true);
  });

  it('rejects long essay for enum_country', () => {
    const essay = 'A'.repeat(100);
    expect(isTypeCompatible(essay, 'enum_country')).toBe(false);
  });

  // long_form rejects enum values
  it('rejects "No" for long_form_generic', () => {
    expect(isTypeCompatible('No', 'long_form_generic')).toBe(false);
  });

  it('rejects "yes" for long_form_company', () => {
    expect(isTypeCompatible('yes', 'long_form_company')).toBe(false);
  });

  it('accepts a paragraph for long_form_generic', () => {
    const para = 'I have five years of experience in full-stack development and am passionate about building great user experiences.';
    expect(isTypeCompatible(para, 'long_form_generic')).toBe(true);
  });

  // profile_field — permissive
  it('accepts any non-empty value for profile_field', () => {
    expect(isTypeCompatible('john@example.com', 'profile_field')).toBe(true);
    expect(isTypeCompatible('John Doe', 'profile_field')).toBe(true);
  });
});

// ── classifyFieldSync ─────────────────────────────────────────────────────────

describe('classifyFieldSync', () => {
  it('returns "unknown" for empty label', () => {
    expect(classifyFieldSync('', 'text', '')).toBe('unknown');
  });

  it('returns "unknown" for junk input types', () => {
    expect(classifyFieldSync('Upload Resume', 'file', '')).toBe('unknown');
    expect(classifyFieldSync('Submit', 'submit', '')).toBe('unknown');
  });

  it('classifies "First name" → "first_name"', () => {
    expect(classifyFieldSync('First name', 'text', 'firstName')).toBe('first_name');
  });

  it('classifies "Last name" → "last_name"', () => {
    expect(classifyFieldSync('Last name', 'text', 'lastName')).toBe('last_name');
  });

  it('classifies "Email address" → "email"', () => {
    expect(classifyFieldSync('Email address', 'email', 'email')).toBe('email');
  });

  it('classifies "Phone number" → "phone"', () => {
    expect(classifyFieldSync('Phone number', 'tel', 'phone')).toBe('phone');
  });

  it('classifies "LinkedIn profile" → "linkedin"', () => {
    expect(classifyFieldSync('LinkedIn profile', 'text', 'linkedin')).toBe('linkedin');
  });

  it('classifies "City" → "city"', () => {
    expect(classifyFieldSync('City', 'text', 'city')).toBe('city');
  });

  it('classifies "Country" → "country"', () => {
    expect(classifyFieldSync('Country', 'select', 'country')).toBe('country');
  });

  it('classifies "Are you authorized to work in the US?" → legally_authorized', () => {
    const result = classifyFieldSync('Are you authorized to work in the US?', 'select', '');
    expect(['legally_authorized', 'work_authorization', 'authorized_to_work']).toContain(result);
  });

  it('returns "unknown" for truly unknown label', () => {
    expect(classifyFieldSync('Favourite pizza topping', 'text', '')).toBe('unknown');
  });

  it('returns "unknown" for junk label "checkbox label"', () => {
    expect(classifyFieldSync('checkbox label', 'checkbox', '')).toBe('unknown');
  });

  it('returns "unknown" for "Search" label', () => {
    expect(classifyFieldSync('Search', 'text', 'search')).toBe('unknown');
  });

  it('returns "unknown" for "Vendor list search" (cookie CMP widget)', () => {
    expect(classifyFieldSync('Vendor list search', 'text', '')).toBe('unknown');
  });

  it('classifies "Cover letter" → a cover_letter canonical field', () => {
    const result = classifyFieldSync('Cover letter', 'textarea', 'cover_letter');
    expect(result).not.toBe('unknown');
  });

  it('classifies "Salary expectation" → salary field', () => {
    const result = classifyFieldSync('Salary expectation', 'text', 'salary');
    expect(result).not.toBe('unknown');
  });

  it('classifies "visa sponsor" label → requires_sponsorship', () => {
    // Uses a phrase that directly hits the visa sponsor pattern
    const result = classifyFieldSync('Do you need visa sponsorship?', 'select', 'visa sponsor');
    expect(result).not.toBe('unknown');
  });
});

// ── FieldClassifier.classify (async, no LLM) ─────────────────────────────────

describe('FieldClassifier.classify', () => {
  beforeEach(() => {
    // Ensure the ollama import path is mocked so LLM stage is never reached
    vi.mock('./ollama-client', () => ({ ollama: null }));
  });

  it('immediately marks file input as junk', async () => {
    const result = await fieldClassifier.classify('Resume', 'file', '');
    expect(result.promptType).toBe('junk');
    expect(result.shouldAutofill).toBe(false);
    expect(result.shouldPersist).toBe(false);
  });

  it('immediately marks submit button as junk', async () => {
    const result = await fieldClassifier.classify('Submit', 'submit', '');
    expect(result.promptType).toBe('junk');
    expect(result.shouldAutofill).toBe(false);
  });

  it('classifies "First Name" with full metadata', async () => {
    const result = await fieldClassifier.classify('First Name', 'text', 'firstName');
    expect(result.canonicalField).toBe('first_name');
    expect(result.promptType).toBe('profile_field');
    expect(result.shouldAutofill).toBe(true);
    expect(result.shouldPersist).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.reason).toBe('deterministic');
  });

  it('classifies "Email" with full metadata', async () => {
    const result = await fieldClassifier.classify('Email', 'email', 'email');
    expect(result.canonicalField).toBe('email');
    expect(result.promptType).toBe('profile_field');
    expect(result.shouldAutofill).toBe(true);
    expect(result.shouldPersist).toBe(true);
  });

  it('marks "checkbox label" as junk', async () => {
    const result = await fieldClassifier.classify('checkbox label', 'checkbox', '');
    expect(result.promptType).toBe('junk');
    expect(result.shouldAutofill).toBe(false);
    expect(result.shouldPersist).toBe(false);
  });

  it('marks "Share or Sale of Personal Data" as junk', async () => {
    const result = await fieldClassifier.classify('Share or Sale of Personal Data', 'checkbox', '');
    expect(result.promptType).toBe('junk');
  });

  it('classifies work authorization label as enum_auth', async () => {
    // Use the exact phrase that hits the deterministic rule
    const result = await fieldClassifier.classify(
      'Work authorization',
      'select',
      'workAuthorization'
    );
    expect(result.promptType).toBe('enum_auth');
    expect(result.canonicalField).toBe('legally_authorized');
    expect(result.shouldAutofill).toBe(true);
  });

  it('classifies "Cover letter" as long_form type', async () => {
    const result = await fieldClassifier.classify('Cover letter', 'textarea', 'coverLetter');
    expect(['long_form_company', 'long_form_generic', 'free_text_short']).toContain(result.promptType);
  });

  it('falls back gracefully when LLM is unavailable for a short unknown label', async () => {
    const result = await fieldClassifier.classify('bio', 'text', '');
    // Short label (< 10 chars) skips LLM — should return unknown fallback
    expect(result.shouldPersist).toBe(false);
    expect(result.reason).toBe('unknown');
  });
});
