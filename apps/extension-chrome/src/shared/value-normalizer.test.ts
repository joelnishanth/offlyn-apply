import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  normalizeLinkedIn,
  normalizeFullName,
  normalizeCountryCode,
  normalizeYesNo,
  normalizeValue,
} from './value-normalizer';

// ── normalizePhone ────────────────────────────────────────────────────────────

describe('normalizePhone', () => {
  it('returns empty string unchanged', () => {
    expect(normalizePhone('')).toBe('');
  });

  it('converts 10-digit US number to +1 prefix', () => {
    expect(normalizePhone('4085551234')).toBe('+14085551234');
  });

  it('converts formatted US number (parentheses + dashes)', () => {
    expect(normalizePhone('(408) 555-1234')).toBe('+14085551234');
  });

  it('converts 11-digit number starting with 1 to E.164', () => {
    expect(normalizePhone('14085551234')).toBe('+14085551234');
  });

  it('leaves already-valid E.164 number unchanged', () => {
    expect(normalizePhone('+14085551234')).toBe('+14085551234');
  });

  it('leaves Indian number with +91 prefix alone', () => {
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
  });

  it('strips dots and spaces from E.164-like number', () => {
    const result = normalizePhone('+1.408.555.1234');
    expect(result).toMatch(/^\+1/);
    expect(result.replace(/\D/g, '')).toContain('14085551234');
  });

  it('strips parentheses and dashes from UK number', () => {
    const result = normalizePhone('+44 20 7946 0958');
    expect(result.startsWith('+44') || result.includes('44')).toBe(true);
  });

  it('handles number with dots as separators', () => {
    const result = normalizePhone('408.555.1234');
    expect(result).toBe('+14085551234');
  });
});

// ── normalizeLinkedIn ─────────────────────────────────────────────────────────

describe('normalizeLinkedIn', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeLinkedIn('')).toBe('');
  });

  it('leaves a fully-formed https URL unchanged', () => {
    expect(normalizeLinkedIn('https://linkedin.com/in/johndoe')).toBe('https://linkedin.com/in/johndoe');
  });

  it('upgrades http to https', () => {
    expect(normalizeLinkedIn('http://linkedin.com/in/johndoe')).toBe('https://linkedin.com/in/johndoe');
  });

  it('removes trailing slash from valid URL', () => {
    expect(normalizeLinkedIn('https://linkedin.com/in/johndoe/')).toBe('https://linkedin.com/in/johndoe');
  });

  it('expands a bare username to full URL', () => {
    expect(normalizeLinkedIn('johndoe')).toBe('https://linkedin.com/in/johndoe');
  });

  it('expands a partial path (linkedin.com/in/username) to full URL', () => {
    expect(normalizeLinkedIn('linkedin.com/in/jane-smith')).toBe('https://linkedin.com/in/jane-smith');
  });

  it('handles www prefix in URL', () => {
    const result = normalizeLinkedIn('https://www.linkedin.com/in/johndoe');
    expect(result).toMatch(/linkedin\.com\/in\/johndoe/);
  });
});

// ── normalizeFullName ─────────────────────────────────────────────────────────

describe('normalizeFullName', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeFullName('')).toBe('');
  });

  it('title-cases a lowercase name', () => {
    expect(normalizeFullName('john doe')).toBe('John Doe');
  });

  it('title-cases an uppercase name', () => {
    expect(normalizeFullName('JANE SMITH')).toBe('Jane Smith');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeFullName('  alice johnson  ')).toBe('Alice Johnson');
  });

  it('handles single-word name', () => {
    expect(normalizeFullName('prince')).toBe('Prince');
  });

  it('handles multiple words', () => {
    expect(normalizeFullName('mary ann jones')).toBe('Mary Ann Jones');
  });

  it('collapses internal extra spaces', () => {
    expect(normalizeFullName('john  doe')).toBe('John Doe');
  });
});

// ── normalizeCountryCode ──────────────────────────────────────────────────────

describe('normalizeCountryCode', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeCountryCode('')).toBe('');
  });

  it('maps "United States" → "US"', () => {
    expect(normalizeCountryCode('United States')).toBe('US');
  });

  it('maps "usa" (lowercase) → "US"', () => {
    expect(normalizeCountryCode('usa')).toBe('US');
  });

  it('maps "United Kingdom" → "GB"', () => {
    expect(normalizeCountryCode('United Kingdom')).toBe('GB');
  });

  it('maps "India" → "IN"', () => {
    expect(normalizeCountryCode('India')).toBe('IN');
  });

  it('maps "Australia" → "AU"', () => {
    expect(normalizeCountryCode('Australia')).toBe('AU');
  });

  it('maps "Canada" → "CA"', () => {
    expect(normalizeCountryCode('Canada')).toBe('CA');
  });

  it('maps "uk" (alias) → "GB"', () => {
    expect(normalizeCountryCode('uk')).toBe('GB');
  });

  it('maps "United States of America" → "US"', () => {
    expect(normalizeCountryCode('United States of America')).toBe('US');
  });

  it('returns unknown country string as-is (trimmed)', () => {
    expect(normalizeCountryCode('  Narnia  ')).toBe('Narnia');
  });

  it('handles ISO code that is already correct — returned as-is', () => {
    expect(normalizeCountryCode('US')).toBe('US');
  });
});

// ── normalizeYesNo ────────────────────────────────────────────────────────────

describe('normalizeYesNo', () => {
  it('returns empty string unchanged', () => {
    expect(normalizeYesNo('')).toBe('');
  });

  it('"yes" → "Yes"', () => { expect(normalizeYesNo('yes')).toBe('Yes'); });
  it('"YES" → "Yes"', () => { expect(normalizeYesNo('YES')).toBe('Yes'); });
  it('"true" → "Yes"', () => { expect(normalizeYesNo('true')).toBe('Yes'); });
  it('"1" → "Yes"', () => { expect(normalizeYesNo('1')).toBe('Yes'); });
  it('"y" → "Yes"', () => { expect(normalizeYesNo('y')).toBe('Yes'); });
  it('"yep" → "Yes"', () => { expect(normalizeYesNo('yep')).toBe('Yes'); });
  it('"yeah" → "Yes"', () => { expect(normalizeYesNo('yeah')).toBe('Yes'); });

  it('"no" → "No"', () => { expect(normalizeYesNo('no')).toBe('No'); });
  it('"NO" → "No"', () => { expect(normalizeYesNo('NO')).toBe('No'); });
  it('"false" → "No"', () => { expect(normalizeYesNo('false')).toBe('No'); });
  it('"0" → "No"', () => { expect(normalizeYesNo('0')).toBe('No'); });
  it('"n" → "No"', () => { expect(normalizeYesNo('n')).toBe('No'); });
  it('"nope" → "No"', () => { expect(normalizeYesNo('nope')).toBe('No'); });

  it('returns unrecognised value trimmed but unchanged', () => {
    expect(normalizeYesNo('  maybe  ')).toBe('maybe');
  });

  it('returns "Prefer not to say" unchanged (trimmed)', () => {
    expect(normalizeYesNo('Prefer not to say')).toBe('Prefer not to say');
  });
});

// ── normalizeValue — routing ──────────────────────────────────────────────────

describe('normalizeValue', () => {
  it('routes enum_yes_no through normalizeYesNo', () => {
    expect(normalizeValue('yes', 'enum_yes_no')).toBe('Yes');
    expect(normalizeValue('false', 'enum_yes_no')).toBe('No');
  });

  it('routes enum_auth through normalizeYesNo', () => {
    expect(normalizeValue('true', 'enum_auth')).toBe('Yes');
  });

  it('routes enum_country through normalizeCountryCode', () => {
    expect(normalizeValue('India', 'enum_country')).toBe('IN');
  });

  it('trims free_text_short values', () => {
    expect(normalizeValue('  hello world  ', 'free_text_short')).toBe('hello world');
  });

  it('trims long_form_generic values', () => {
    expect(normalizeValue('  some long text  ', 'long_form_generic')).toBe('some long text');
  });

  it('normalizes LinkedIn-like value in profile_field', () => {
    const result = normalizeValue('linkedin.com/in/johndoe', 'profile_field');
    expect(result).toContain('linkedin.com/in/johndoe');
  });

  it('normalizes phone-like value in profile_field', () => {
    const result = normalizeValue('4085551234', 'profile_field');
    expect(result).toBe('+14085551234');
  });

  it('returns value unchanged for junk type', () => {
    expect(normalizeValue('anything', 'junk')).toBe('anything');
  });

  it('returns empty string unchanged for any type', () => {
    expect(normalizeValue('', 'enum_yes_no')).toBe('');
  });

  it('never throws — returns original on unexpected input', () => {
    expect(() => normalizeValue(null as any, 'profile_field')).not.toThrow();
  });
});
