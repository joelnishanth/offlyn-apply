/**
 * Field Classifier — two-stage field classification for autofill gating.
 *
 * Stage 1: Deterministic rules (~50 pattern groups).
 * Stage 2: Ollama LLM fallback for non-trivial unknown labels.
 *
 * The classifier answers three questions for every field:
 *   - What canonical field name maps to this label? (or undefined for junk)
 *   - What prompt type is this? (enum, long-form, profile, date, etc.)
 *   - Is it safe to autofill and persist?
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Semantic category of a form field, used to gate lookup strategy and
 * prevent type mismatches (e.g. reusing "No" for a date field).
 */
export type PromptType =
  | 'profile_field'      // Direct profile mapping — name, email, phone, address…
  | 'enum_yes_no'        // Boolean yes/no question
  | 'enum_auth'          // Work authorization / sponsorship questions
  | 'enum_self_id'       // Gender, race, veteran, disability self-identification
  | 'enum_country'       // Country selector
  | 'enum_state'         // State / province selector
  | 'free_text_short'    // Short free-text (1–2 sentences)
  | 'long_form_generic'  // Multi-paragraph generic text (experience, skills…)
  | 'long_form_company'  // Company-scoped long-form (why company, cover letter)
  | 'date_field'         // Availability, start date, graduation date
  | 'salary_field'       // Salary / compensation expectations
  | 'junk';              // UI control artifact — never fill, never persist

export interface ClassificationResult {
  /** Canonical field name, e.g. 'first_name'. undefined means junk — skip. */
  canonicalField: string | undefined;
  promptType: PromptType;
  /** 0–1 confidence in classification */
  confidence: number;
  /** Whether it is safe to autofill this field */
  shouldAutofill: boolean;
  /** Whether to persist an answer for this field into the graph */
  shouldPersist: boolean;
  /** Human-readable reason (for debug panel) */
  reason: string;
}

// ── Junk detection ────────────────────────────────────────────────────────────

const JUNK_INPUT_TYPES = new Set([
  'file', 'image', 'submit', 'button', 'reset', 'hidden', 'checkbox',
]);

// Exact-match junk labels (case-insensitive, stripped)
const JUNK_LABEL_RE = new RegExp(
  '^(' +
  // Generic UI controls
  'select\\.{0,3}|type to search|vendor list search|attach|upload|choose\\.{0,3}|browse|' +
  'button|submit|reset|captcha|close|cancel|clear|next|back|continue|open|add|' +
  'upload file|attach file|drag|drop|drag and drop|drag & drop|' +
  'checkbox label|switch label|toggle label|radio label|' +
  // Search widgets
  'search|vendor search|filter|filter by|' +
  // Cookie / consent / privacy (exact label text from common CMPs)
  'i agree|terms|consent|accept|accept all|accept cookies|accept all cookies|' +
  'reject|reject all|decline|privacy|privacy policy|cookie policy|' +
  'manage preferences|cookie preferences|cookie settings|' +
  'save preferences|save settings|confirm choices|confirm my choices|' +
  'share or sale of personal data|do not sell|opt out|opt-out|' +
  'legitimate interest|special features|' +
  // Share/social widgets
  'share|share this|copy link|' +
  // Analytics / chat / marketing
  'live chat|start chat|chat with us|send message|message us|' +
  'subscribe|unsubscribe|sign up for newsletter|' +
  // File/resume upload UI
  'file|choose file|no file chosen|supported formats' +
  ')$',
  'i'
);

// Partial-match patterns for junk that can appear anywhere in a longer label
const JUNK_LABEL_PARTIAL_RE = /\b(onetrust|gdpr|iab tcf|tcf vendor|purpose consent|feature consent|legitimate interests|special purpose)\b/i;

// Credit card field patterns — never fill regardless of page type
const JUNK_CC_LABEL_RE = /\bcredit.?card\b|\bcard.?number\b|\bcvc\b|\bcvv\b|\bsecurity.?code\b|\bexpir(y|ation)\b|\bcardholder\b|\bcard.?holder\b|\bcard.?type\b|\bpayment.?method\b/i;
const JUNK_CC_AUTOCOMPLETE = new Set(['cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-name', 'cc-type']);

/** Returns true when the field is an obvious UI control artifact. */
function isJunkField(label: string, inputType: string, el?: Element | null): boolean {
  if (JUNK_INPUT_TYPES.has(inputType)) return true;
  const l = label.trim();
  if (!l || l.length < 2) return true;
  if (JUNK_LABEL_RE.test(l)) return true;
  if (JUNK_LABEL_PARTIAL_RE.test(l)) return true;
  if (JUNK_CC_LABEL_RE.test(l)) return true;
  // Check autocomplete attribute for credit card fields
  if (el) {
    const ac = (el as HTMLElement).getAttribute?.('autocomplete') ?? '';
    if (JUNK_CC_AUTOCOMPLETE.has(ac.toLowerCase())) return true;
  }
  // Pure number labels (e.g. "1", "2") are usually widget artifacts
  if (/^\d+$/.test(l)) return true;
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matches(text: string, ...patterns: (string | RegExp)[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some(p =>
    typeof p === 'string' ? lower.includes(p) : p.test(lower)
  );
}

// ── Deterministic rule table ──────────────────────────────────────────────────
// Each rule: [canonicalField, promptType, confidence]
type Rule = [string, PromptType, number];

function deterministic(label: string, _inputType: string, fieldName: string): Rule | null {
  const l = label.toLowerCase();
  const n = fieldName.toLowerCase();
  const both = l + ' ' + n;

  // ── Profile — identity ───────────────────────────────────────────────────

  if (matches(both, 'first name', 'firstname', 'given name', 'fname'))
    return ['first_name', 'profile_field', 0.98];

  if (matches(both, 'last name', 'lastname', 'surname', 'family name', 'lname'))
    return ['last_name', 'profile_field', 0.98];

  if (matches(both, 'middle name', 'middlename'))
    return ['middle_name', 'profile_field', 0.95];

  if (matches(both, /\bfull name\b/, /\byour name\b/, /\bname\b/) &&
      !matches(both, 'company', 'employer', 'school', 'university', 'first', 'last', 'legal'))
    return ['full_name', 'profile_field', 0.85];

  if (matches(both, 'preferred name', 'goes by', 'nickname'))
    return ['preferred_name', 'profile_field', 0.90];

  if (matches(both, 'legal name', 'legal full name'))
    return ['full_name', 'profile_field', 0.92];

  // ── Profile — contact ────────────────────────────────────────────────────

  if (matches(both, 'email', 'e-mail', 'email address'))
    return ['email', 'profile_field', 0.98];

  if (matches(both, /\bphone\b/, /\bmobile\b/, /\bcell\b/, /\btel\b/) &&
      !matches(both, 'country', 'code', 'extension'))
    return ['phone', 'profile_field', 0.95];

  if (matches(both, 'phone country', 'country code', 'calling code', 'dial code'))
    return ['phone_country_code', 'profile_field', 0.93];

  if (matches(both, 'phone extension', 'ext.', 'extension'))
    return ['phone_extension', 'profile_field', 0.90];

  // ── Profile — location ───────────────────────────────────────────────────

  if (matches(both, 'street address', 'address line 1', 'street line'))
    return ['address_line1', 'profile_field', 0.95];

  if (matches(both, 'address line 2', 'apt', 'suite', 'unit'))
    return ['address_line2', 'profile_field', 0.90];

  if (matches(both, /\bcity\b/) && !matches(both, 'city and state', 'city, state'))
    return ['city', 'profile_field', 0.95];

  if (matches(both, /\bstate\b/, /\bprovince\b/) &&
      !matches(both, 'country', 'nation', 'status', 'visa'))
    return ['state', 'enum_state', 0.90];

  if (matches(both, /\bcountry\b/, 'nation of residence') &&
      !matches(both, 'code'))
    return ['country', 'enum_country', 0.95];

  if (matches(both, 'zip', 'postal code', 'postcode', 'zip code'))
    return ['zip_code', 'profile_field', 0.95];

  // ── Profile — professional links ─────────────────────────────────────────

  if (matches(both, 'linkedin', 'linked-in', 'linkedin profile', 'linkedin url'))
    return ['linkedin', 'profile_field', 0.98];

  if (matches(both, 'github', 'git hub'))
    return ['github', 'profile_field', 0.98];

  if (matches(both, 'portfolio', 'personal website', 'personal site'))
    return ['portfolio', 'profile_field', 0.92];

  if (matches(both, /\bwebsite\b/, /\burl\b/, /\bhomepage\b/) &&
      !matches(both, 'company', 'linkedin', 'github'))
    return ['website', 'profile_field', 0.85];

  // ── Profile — job details ────────────────────────────────────────────────

  if (matches(both, 'current role', 'current title', 'current position', 'current job title'))
    return ['current_role', 'profile_field', 0.92];

  if (matches(both, 'years of experience', 'years experience', 'total experience'))
    return ['years_experience', 'profile_field', 0.90];

  if (matches(both, 'current company', 'current employer', 'current organization'))
    return ['current_company', 'profile_field', 0.90];

  // ── Profile — education ──────────────────────────────────────────────────

  if (matches(both, 'university', 'college', 'school', 'institution') &&
      !matches(both, 'currently', 'looking', 'interested'))
    return ['school', 'profile_field', 0.85];

  if (matches(both, 'degree', 'level of education', 'highest education'))
    return ['degree', 'profile_field', 0.88];

  if (matches(both, 'major', 'field of study', 'area of study', 'concentration'))
    return ['major', 'profile_field', 0.90];

  if (matches(both, 'graduation year', 'year of graduation', 'expected graduation'))
    return ['graduation_year', 'date_field', 0.88];

  if (matches(both, 'gpa', 'grade point'))
    return ['gpa', 'profile_field', 0.92];

  // ── Enum — work authorization ────────────────────────────────────────────

  if (matches(both, 'require.*sponsor', 'visa sponsor', 'need.*sponsor', 'authorization.*sponsor'))
    return ['requires_sponsorship', 'enum_auth', 0.95];

  if (matches(both, 'legally authorized', 'work authorization', 'authorized to work',
                    'eligible to work', 'right to work'))
    return ['legally_authorized', 'enum_auth', 0.95];

  if (matches(both, 'visa status', 'visa type', 'immigration status', 'work visa'))
    return ['visa_status', 'enum_auth', 0.88];

  if (matches(both, 'us citizen', 'citizen.*united states', 'citizenship'))
    return ['citizenship', 'enum_auth', 0.90];

  if (matches(both, 'security clearance', 'clearance level'))
    return ['security_clearance', 'enum_auth', 0.90];

  // ── Enum — self-identification ───────────────────────────────────────────

  if (matches(both, /\bgender\b/, /\bsex\b/) &&
      !matches(both, 'company', 'pay gap', 'diversity'))
    return ['gender', 'enum_self_id', 0.95];

  if (matches(both, /\brace\b/, 'racial', 'ethnicity', 'ethnic'))
    return ['race_ethnicity', 'enum_self_id', 0.92];

  if (matches(both, 'veteran', 'military service', 'military status', 'armed forces'))
    return ['veteran_status', 'enum_self_id', 0.95];

  if (matches(both, 'disability', 'disabled', 'accessibility'))
    return ['disability_status', 'enum_self_id', 0.95];

  if (matches(both, 'sexual orientation', 'lgbtq'))
    return ['sexual_orientation', 'enum_self_id', 0.92];

  if (matches(both, 'pronouns', 'preferred pronouns'))
    return ['pronouns', 'enum_self_id', 0.92];

  // ── Date fields ──────────────────────────────────────────────────────────

  if (matches(both, 'start date', 'earliest start', 'when can you start',
                    'available to start', 'availability', 'available from'))
    return ['availability', 'date_field', 0.92];

  if (matches(both, 'notice period', 'notice required', 'required notice'))
    return ['notice_period', 'date_field', 0.88];

  if (matches(both, 'date of birth', 'birthday', 'birth date', 'dob'))
    return ['date_of_birth', 'date_field', 0.95];

  // ── Salary ───────────────────────────────────────────────────────────────

  if (matches(both, 'salary', 'compensation', 'pay expectation', 'expected pay',
                    'desired salary', 'salary expectation'))
    return ['salary_expectation', 'salary_field', 0.92];

  // ── Long-form — company-scoped ───────────────────────────────────────────

  if (matches(both, 'cover letter'))
    return ['cover_letter', 'long_form_company', 0.98];

  if (matches(l, /why\s+(do you want to work|would you like to work|are you interested in working)/i) ||
      (matches(l, 'why') && matches(l, 'company', 'us', 'work at', 'join us', 'this company',
                                       'this team', 'this role here')))
    return ['why_company', 'long_form_company', 0.92];

  if (matches(both, /what excites you about/i, /why are you excited about/i))
    return ['why_company', 'long_form_company', 0.88];

  if (matches(both, 'why this role', 'why this position', 'why this job',
                    'why are you interested in this role', 'why this opportunity'))
    return ['why_role', 'long_form_company', 0.90];

  // ── Long-form — generic ──────────────────────────────────────────────────

  if (matches(both, 'cover letter', 'covering letter'))
    return ['cover_letter', 'long_form_company', 0.98];

  if (matches(both, 'tell us about yourself', 'about yourself', 'describe yourself',
                    'personal statement', 'brief introduction'))
    return ['personal_statement', 'long_form_generic', 0.88];

  if (matches(both, 'strength', 'what makes you a great', 'what makes you stand out'))
    return ['strengths', 'long_form_generic', 0.85];

  if (matches(both, 'weakness', 'area.*improve', 'areas for improvement'))
    return ['weaknesses', 'long_form_generic', 0.85];

  if (matches(both, 'career goal', 'career aspiration', 'long.term goal', 'five year'))
    return ['career_goals', 'long_form_generic', 0.88];

  if (matches(both, 'additional information', 'additional comments', 'anything else',
                    'is there anything else', 'other information'))
    return ['additional_info', 'long_form_generic', 0.82];

  if (matches(both, 'reference', 'referral source', 'how did you hear about us'))
    return ['references', 'free_text_short', 0.82];

  // ── Enum yes/no — misc ───────────────────────────────────────────────────

  if (matches(both, 'willing to relocate', 'open to relocation', 'relocation'))
    return ['willing_to_relocate', 'enum_yes_no', 0.90];

  if (matches(both, 'willing to travel', 'travel required', 'travel percentage'))
    return ['willing_to_travel', 'enum_yes_no', 0.88];

  if (matches(both, 'remote', 'work from home', 'hybrid', 'work model'))
    return ['work_preference', 'enum_yes_no', 0.82];

  if (matches(both, 'previously worked', 'worked here before', 'former employee',
                    'prior employee'))
    return ['previously_employed', 'enum_yes_no', 0.90];

  if (matches(both, 'non-compete', 'non compete', 'restrictive covenant'))
    return ['non_compete', 'enum_yes_no', 0.85];

  if (matches(both, 'background check', 'drug test', 'drug screening'))
    return ['background_check', 'enum_yes_no', 0.88];

  return null;
}

// ── JUNK result ───────────────────────────────────────────────────────────────

const JUNK_RESULT: ClassificationResult = {
  canonicalField: undefined,
  promptType: 'junk',
  confidence: 1.0,
  shouldAutofill: false,
  shouldPersist: false,
  reason: 'junk_field',
};

// ── LLM fallback ─────────────────────────────────────────────────────────────

const LLM_CLASSIFY_SYSTEM = `You are a form field classifier for a job application autofill system.
Given a form field label, classify it. Respond with a single JSON object only — no markdown, no explanation.

Response format:
{"canonicalField":"<snake_case_name_or_null>","promptType":"<one of: profile_field|enum_yes_no|enum_auth|enum_self_id|enum_country|enum_state|free_text_short|long_form_generic|long_form_company|date_field|salary_field|junk>","confidence":<0-1>,"shouldAutofill":<true|false>,"shouldPersist":<true|false>}

Rules:
- Return canonicalField=null and promptType=junk for UI controls (search boxes, upload buttons, checkboxes for consent, CAPTCHA).
- Return shouldAutofill=false for junk fields and very sensitive PII (SSN, passport, bank).
- Return shouldPersist=false for junk fields.
- For company-specific long-form questions (why company, cover letter), use long_form_company.`;

async function classifyWithLLM(label: string): Promise<ClassificationResult | null> {
  try {
    // Dynamic import to keep this module usable in tests without browser globals
    const { ollama } = await import('./ollama-client');
    if (!ollama) return null;

    const raw = await (ollama as any).chat([
      { role: 'system', content: LLM_CLASSIFY_SYSTEM },
      { role: 'user',   content: `Field label: "${label}"` },
    ], { temperature: 0, timeout: 5000 });

    if (!raw) return null;
    const parsed = JSON.parse(raw.trim());
    if (typeof parsed !== 'object' || !parsed.promptType) return null;

    return {
      canonicalField: parsed.canonicalField || undefined,
      promptType:     parsed.promptType     as PromptType,
      confidence:     Number(parsed.confidence) || 0.5,
      shouldAutofill: Boolean(parsed.shouldAutofill),
      shouldPersist:  Boolean(parsed.shouldPersist),
      reason:         'llm',
    };
  } catch {
    return null;
  }
}

// ── FieldClassifier ───────────────────────────────────────────────────────────

export class FieldClassifier {
  /**
   * Classify a form field and return gating/routing metadata.
   *
   * @param label     Visible label text of the field
   * @param inputType HTML input type (text, select, file, checkbox, …)
   * @param fieldName HTML name / id attribute of the field
   */
  async classify(
    label: string,
    inputType: string,
    fieldName: string
  ): Promise<ClassificationResult> {
    const cleanLabel = label.trim();

    // Stage 0 — immediate junk rejection
    if (isJunkField(cleanLabel, inputType)) return JUNK_RESULT;

    // Stage 1 — deterministic rules
    const det = deterministic(cleanLabel, inputType, fieldName);
    if (det) {
      const [canonicalField, promptType, confidence] = det;
      return {
        canonicalField,
        promptType,
        confidence,
        shouldAutofill: true,
        shouldPersist: true,
        reason: 'deterministic',
      };
    }

    // Stage 2 — LLM fallback (only for non-trivial labels)
    if (cleanLabel.length > 10) {
      const llmResult = await classifyWithLLM(cleanLabel);
      if (llmResult) return llmResult;
    }

    // Fallback — unknown field; allow graph lookup but don't persist junk
    return {
      canonicalField: undefined,
      promptType: 'free_text_short',
      confidence: 0.3,
      shouldAutofill: true,
      shouldPersist: false, // don't pollute graph with unknown fields
      reason: 'unknown',
    };
  }
}

// ── Type compatibility guard ──────────────────────────────────────────────────

const ENUM_VALUES = new Set([
  'yes', 'no', 'true', 'false', '1', '0', 'n/a', 'none', 'other',
  'prefer not to say', 'prefer not to answer', 'decline to state',
  'not applicable', 'checked', 'unchecked',
]);

const LONG_VALUE_THRESHOLD = 80;

/**
 * Returns false when a stored value would be type-incompatible with the
 * current field's prompt type — prevents "No" from filling a date field.
 */
export function isTypeCompatible(value: string, promptType: PromptType): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  const isEnum = ENUM_VALUES.has(v) || v.length <= 3;
  const isLong = value.length > LONG_VALUE_THRESHOLD;

  switch (promptType) {
    case 'date_field':
      // Enum values ("No", "Yes") must never fill date fields
      if (isEnum) return false;
      return true;

    case 'salary_field':
      // Must look like a number or range
      if (isEnum) return false;
      if (!/[\d$£€]/.test(value)) return false;
      return true;

    case 'enum_yes_no':
    case 'enum_auth':
    case 'enum_self_id':
    case 'enum_country':
    case 'enum_state':
      // Long-form paragraphs must never fill enum/select fields
      if (isLong) return false;
      return true;

    case 'long_form_company':
    case 'long_form_generic':
      // Enum values must never fill long-form fields
      if (isEnum) return false;
      return true;

    case 'profile_field':
    case 'free_text_short':
    case 'junk':
    default:
      return true;
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const fieldClassifier = new FieldClassifier();

/**
 * Synchronous canonical-field lookup using only the deterministic rule table.
 * Used by detectFieldType (which is called from synchronous autofill code).
 * Returns 'unknown' for fields not covered by the rule table.
 */
export function classifyFieldSync(label: string, inputType: string, fieldName: string): string {
  const cleanLabel = label.trim();
  if (!cleanLabel || isJunkField(cleanLabel, inputType)) return 'unknown';
  const rule = deterministic(cleanLabel, inputType, fieldName);
  return rule ? rule[0] : 'unknown';
}
