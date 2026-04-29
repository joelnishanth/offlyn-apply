/**
 * Value normalizer — normalizes stored/retrieved values by prompt type before
 * they are written to form fields or persisted into the graph.
 *
 * Never throws — returns the original value on any parse failure.
 */

import type { PromptType } from './field-classifier';

// ── Phone ─────────────────────────────────────────────────────────────────────

const COUNTRY_CODES: Record<string, string> = {
  'united states': '+1', 'usa': '+1', 'us': '+1', 'canada': '+1', 'ca': '+1',
  'united kingdom': '+44', 'uk': '+44', 'gb': '+44',
  'india': '+91', 'in': '+91',
  'australia': '+61', 'au': '+61',
  'germany': '+49', 'de': '+49',
  'france': '+33', 'fr': '+33',
  'singapore': '+65', 'sg': '+65',
  'ireland': '+353', 'ie': '+353',
  'canada/usa': '+1',
};

/** Normalize a phone number to consistent E.164-like format. */
export function normalizePhone(v: string): string {
  if (!v) return v;
  const trimmed = v.trim();
  // Already looks like E.164 — leave it
  if (/^\+\d{7,15}$/.test(trimmed.replace(/[\s\-().]/g, ''))) return trimmed;
  // Strip everything except digits and leading +
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (!digits) return v;
  // If it already starts with +, leave as-is
  if (digits.startsWith('+')) return digits;
  // 10 digits → assume US (+1)
  if (digits.length === 10) return `+1${digits}`;
  // 11 digits starting with 1 → US
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

/** Normalize a LinkedIn URL to https://linkedin.com/in/... */
export function normalizeLinkedIn(v: string): string {
  if (!v) return v;
  const trimmed = v.trim();
  // Already a valid linkedin URL
  if (/^https?:\/\/(www\.)?linkedin\.com\/in\//i.test(trimmed)) {
    return trimmed.replace(/^http:/, 'https:').replace(/\/+$/, '');
  }
  // Just the username / path
  const match = trimmed.match(/(?:linkedin\.com\/in\/)?([A-Za-z0-9\-_%]+)/i);
  if (match) return `https://linkedin.com/in/${match[1]}`;
  return trimmed;
}

// ── Full name ─────────────────────────────────────────────────────────────────

/** Trim and title-case a full name. */
export function normalizeFullName(v: string): string {
  if (!v) return v;
  return v
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ── Country ───────────────────────────────────────────────────────────────────

const ISO2: Record<string, string> = {
  'united states of america': 'US', 'united states': 'US', 'usa': 'US', 'us': 'US',
  'united kingdom': 'GB', 'uk': 'GB', 'great britain': 'GB',
  'india': 'IN', 'australia': 'AU', 'canada': 'CA', 'germany': 'DE',
  'france': 'FR', 'singapore': 'SG', 'ireland': 'IE', 'netherlands': 'NL',
  'new zealand': 'NZ', 'japan': 'JP', 'china': 'CN', 'brazil': 'BR',
  'mexico': 'MX', 'spain': 'ES', 'italy': 'IT', 'sweden': 'SE',
  'norway': 'NO', 'denmark': 'DK', 'finland': 'FI', 'switzerland': 'CH',
  'austria': 'AT', 'belgium': 'BE', 'poland': 'PL', 'portugal': 'PT',
  'south africa': 'ZA', 'kenya': 'KE', 'nigeria': 'NG', 'ghana': 'GH',
};

/**
 * Map a country string to its ISO 3166-1 alpha-2 code.
 * Returns the original value if no mapping found.
 */
export function normalizeCountryCode(v: string): string {
  if (!v) return v;
  const lower = v.trim().toLowerCase();
  return ISO2[lower] ?? v.trim();
}

// ── Yes/No ────────────────────────────────────────────────────────────────────

/** Normalize boolean-style values to "Yes" / "No". */
export function normalizeYesNo(v: string): string {
  if (!v) return v;
  const lower = v.trim().toLowerCase();
  if (['yes', 'true', '1', 'y', 'yep', 'yeah'].includes(lower)) return 'Yes';
  if (['no', 'false', '0', 'n', 'nope'].includes(lower)) return 'No';
  return v.trim();
}

// ── Unified entry point ───────────────────────────────────────────────────────

/**
 * Normalize a value before it is written to a form field or stored in the graph.
 * Applies the appropriate normalizer based on the field's semantic prompt type.
 */
export function normalizeValue(value: string, promptType: PromptType): string {
  if (!value) return value;

  try {
    switch (promptType) {
      case 'profile_field': {
        // Heuristic: if value looks like a phone number, normalize it
        if (/^[\+\d\s\-().]{7,20}$/.test(value.trim())) return normalizePhone(value);
        // If value looks like a LinkedIn URL/slug
        if (/linkedin/i.test(value)) return normalizeLinkedIn(value);
        return value.trim();
      }

      case 'enum_yes_no':
      case 'enum_auth':
        return normalizeYesNo(value);

      case 'enum_country':
        return normalizeCountryCode(value);

      case 'enum_state':
      case 'enum_self_id':
        return value.trim();

      case 'date_field':
      case 'salary_field':
      case 'free_text_short':
      case 'long_form_generic':
      case 'long_form_company':
        return value.trim();

      case 'junk':
      default:
        return value;
    }
  } catch {
    return value;
  }
}
