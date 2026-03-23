/**
 * Auto-fill form fields using user profile
 */

import type { FieldSchema, FillMapping } from './types';
import type { UserProfile } from './profile';
import { isPhoneDetails, isLocationDetails } from './profile';
import { getCountryCode, getPhoneNumber, parsePhoneNumber } from './phone-parser';
import { validateFieldData } from './field-data-validator';
import { rlSystem } from './learning-rl';
import { detectFieldType } from './context-aware-storage';
import type { GetBestAnswerResult } from './graph/types';

/**
 * Generate fill mappings from profile and form schema
 */
export function generateFillMappings(schema: FieldSchema[], profile: UserProfile): FillMapping[] {
  const mappings: FillMapping[] = [];

  let skippedNoMatch = 0;
  let skippedEmpty = 0;
  let skippedValidation = 0;
  let fromLearned = 0;
  let fromProfile = 0;

  console.log(`[Autofill] ═══ Generating fill mappings for ${schema.length} field(s) ═══`);

  for (const field of schema) {
    const fieldName = field.label || field.name || field.id || field.selector;
    console.log(`[Autofill] ─ Field: "${fieldName}" | type: ${field.type || 'text'}`);

    // Skip untrusted fields (Tier 3: cookie banners, chat widgets, marketing embeds)
    if (field.fillEligible === false || field.trustTier === 3) {
      console.log(`[Autofill] Skipping untrusted field (tier=${field.trustTier}): "${fieldName}" — ${field.exclusionReason ?? ''}`);
      continue;
    }

    // Skip reCAPTCHA fields — never autofill these
    const _fieldNameLC = (field.name || '').toLowerCase();
    const _fieldIdLC = (field.id || '').toLowerCase();
    if (_fieldNameLC.includes('recaptcha') || _fieldIdLC.includes('recaptcha') ||
        (field.label || '').toLowerCase().includes('recaptcha')) {
      console.log(`[Autofill] Skipping reCAPTCHA field: "${fieldName}"`);
      skippedNoMatch++;
      continue;
    }

    // Skip intl-tel-input (ITI) country-code search widget — its id follows the
    // pattern "iti-N__search-input" and it is an internal widget, not a real field
    if (_fieldIdLC.startsWith('iti-') || _fieldIdLC.includes('__search')) {
      console.log(`[Autofill] Skipping ITI phone widget field: "${fieldName}"`);
      skippedNoMatch++;
      continue;
    }

    // PRIORITY 1: Check for learned corrections FIRST (highest priority)
    const learnedValue = rlSystem.getLearnedValue(field);
    let value: any;
    let source: string;

    if (learnedValue && learnedValue.confidence >= 0.6) {
      // Use learned value (user has corrected this field before)
      value = learnedValue.value;
      source = 'learned';

      // CRITICAL: Validate learned value makes sense for this field type
      const learnedValueStr = String(value).toLowerCase().trim();
      const fieldLabelLower = (field.label || '').toLowerCase();
      const isUrl = learnedValueStr.startsWith('http') || learnedValueStr.includes('linkedin.com') || learnedValueStr.includes('github.com');
      // Detect file paths (e.g. "C:\fakepath\resume.pdf" from file input RL associations)
      const isFilePath = learnedValueStr.includes('fakepath') ||
                        /\.(pdf|docx?|rtf)$/i.test(learnedValueStr) ||
                        (learnedValueStr.includes('\\') && learnedValueStr.includes('.'));
      const isSelfIdField = fieldLabelLower.includes('gender') ||
                           fieldLabelLower.includes('sex') ||
                           fieldLabelLower.includes('race') ||
                           fieldLabelLower.includes('veteran') ||
                           fieldLabelLower.includes('disability') ||
                           fieldLabelLower.includes('hispanic') ||
                           fieldLabelLower.includes('ethnicity');

      // Reject learned URL or file path for self-ID/radio/checkbox fields
      if ((isUrl || isFilePath) && (field.type === 'radio' || field.type === 'checkbox' || isSelfIdField)) {
        console.warn(`[Autofill] Rejecting learned value (URL for ${field.type || 'self-ID'} field): "${value}". Falling back to profile.`);
        value = matchFieldToProfile(field, profile);
        source = 'profile';
      }
      // Reject learned short strings for URL fields
      else if ((fieldLabelLower.includes('linkedin') || fieldLabelLower.includes('github') || fieldLabelLower.includes('website') || fieldLabelLower.includes('portfolio')) &&
               !isUrl && learnedValueStr.length < 10) {
        console.warn(`[Autofill] Rejecting learned value (non-URL for URL field): "${value}". Falling back to profile.`);
        value = matchFieldToProfile(field, profile);
        source = 'profile';
      }
      // Reject learned full name for first-name-only or last-name-only fields.
      // The RL system can record a full name (e.g. "Nishanth Ponukumatla") as the
      // "correct" answer for a First Name field if the user submitted the form with
      // a full name there. This guard prevents that stale pattern from being reused.
      else if (
        /\bfirst\s*name\b/i.test(fieldLabelLower) &&
        String(value).trim().includes(' ')
      ) {
        const profileFirst = profile.personal?.firstName;
        if (profileFirst) {
          console.warn(`[Autofill] Rejecting learned full name for first-name field: "${value}". Using profile firstName.`);
          value = profileFirst;
          source = 'profile';
        }
      }
      else if (
        /\blast\s*name\b/i.test(fieldLabelLower) &&
        String(value).trim().includes(' ')
      ) {
        const profileLast = profile.personal?.lastName;
        if (profileLast) {
          console.warn(`[Autofill] Rejecting learned full name for last-name field: "${value}". Using profile lastName.`);
          value = profileLast;
          source = 'profile';
        }
      }
      // If valid, normalize and use
      else {
        // Normalize Yes/No values for dropdown fields (capitalize first letter)
        if (field.type === 'select-one' || field.type === 'autocomplete') {
          const valueLower = String(value).toLowerCase().trim();
          if (valueLower === 'yes' || valueLower === 'no') {
            value = valueLower.charAt(0).toUpperCase() + valueLower.slice(1);
          }
        }
        console.log(`[Autofill]   source: learned (confidence: ${learnedValue.confidence.toFixed(2)}), value: "${value}"`);
      }
    } else {
      // PRIORITY 2: Fall back to profile matching
      value = matchFieldToProfile(field, profile);
      source = 'profile';
    }

    if (value === null || value === undefined) {
      skippedNoMatch++;
      console.log(`[Autofill]   SKIP — no profile match for "${fieldName}"`);
      continue;
    }

    // Skip empty values
    const valueStr = String(value).trim();
    if (valueStr === '') {
      skippedEmpty++;
      console.log(`[Autofill]   SKIP — empty value for "${fieldName}"`);
      continue;
    }

    if (source === 'profile') {
      console.log(`[Autofill]   source: profile, value: "${valueStr.substring(0, 80)}"`);
    }

    // Validate the value before adding to mappings
    const validation = validateFieldData(field, value);

    if (validation.isValid) {
      mappings.push({ selector: field.selector, value });
      if (source === 'learned') fromLearned++; else fromProfile++;
      console.log(`[Autofill]   FILL`);
    } else {
      // Try suggested fix first
      if (validation.suggestedFix) {
        const retryValidation = validateFieldData(field, validation.suggestedFix);
        if (retryValidation.isValid) {
          mappings.push({ selector: field.selector, value: validation.suggestedFix });
          if (source === 'learned') fromLearned++; else fromProfile++;
          console.log(`[Autofill]   FILL (with fix: "${validation.suggestedFix}" — was: "${valueStr}")`);
          continue;
        }
      }
      skippedValidation++;
      console.warn(`[Autofill]   SKIP — validation failed for "${fieldName}": ${validation.reason}`);
    }
  }

  console.log(`[Autofill] ═══ Summary: ${mappings.length}/${schema.length} fields will fill`);
  console.log(`[Autofill]   From profile: ${fromProfile} | From learned: ${fromLearned}`);
  console.log(`[Autofill]   Skipped — no match: ${skippedNoMatch} | empty: ${skippedEmpty} | validation: ${skippedValidation}`);
  console.log(`[Autofill] ══════════════════════════════`);

  return mappings;
}

/**
 * Enhance fill mappings with graph memory lookups.
 *
 * Routes all graph calls through message passing to the background script's
 * single initialized GraphMemoryService instance. The content script must
 * never call graphMemory directly — it has its own empty, uninitialized copy.
 *
 * Runs AFTER generateFillMappings() and fills any fields left unmapped.
 * Returns an augmented copy of the mappings array — does not mutate the input.
 */
export async function applyGraphEnhancement(
  schema: FieldSchema[],
  existingMappings: FillMapping[],
  context?: { platform?: string; company?: string; jobTitle?: string; url?: string }
): Promise<FillMapping[]> {
  const filledSelectors = new Set(existingMappings.map(m => m.selector));
  const enhanced = [...existingMappings];
  const unfilledCount = schema.filter(f => !filledSelectors.has(f.selector)).length;
  console.log(`[Autofill/Graph] Running — ${filledSelectors.size} already filled, checking ${unfilledCount} unfilled fields`);

  // Labels that are generic UI placeholders — never meaningful to look up in the graph
  const PLACEHOLDER_LABELS = /^(select\.{0,3}|search|attach|upload|choose\.{0,3}|file|browse|open|add|upload file|attach file)$/i;

  // Field types that cannot be programmatically filled (security restriction) or have no text to match
  const UNFILLABLE_TYPES = new Set(['file', 'image', 'submit', 'button', 'reset', 'hidden']);

  // Question patterns that need human judgment / contextual answers — graph "No" from a
  // previous sponsorship question must not bleed into timeline or address fields
  const CONTEXTUAL_QUESTION_PATTERNS = [
    /earliest.*start/i,
    /when.*start/i,
    /start.*date/i,
    /available.*start/i,
    /\baddress\b/i,
    /\bstreet\b/i,
    /city.*state/i,
    /salary.*expect/i,
    /desired.*salary/i,
    /\bsalary\b/i,
    /\bcompensation\b/i,
    /cover letter/i,
  ];

  for (const field of schema) {
    const fieldLabel = field.label ?? field.name ?? field.id ?? '';
    const fieldType = field.type ?? '';

    // Skip file inputs and other non-textual inputs — they can never be graph-filled
    if (UNFILLABLE_TYPES.has(fieldType)) continue;

    // Skip generic placeholder labels — these are dropdown/UI chrome, not real questions
    if (!fieldLabel || PLACEHOLDER_LABELS.test(fieldLabel.trim())) continue;

    // Skip fields where the label is shorter than 3 chars (likely a widget artifact)
    if (fieldLabel.trim().length < 3) continue;

    if (filledSelectors.has(field.selector)) {
      // Already filled by profile/RL — record provenance in background for debug panel
      const existingMapping = existingMappings.find(m => m.selector === field.selector);
      if (existingMapping && fieldLabel) {
        browser.runtime.sendMessage({
          kind: 'GRAPH_RECORD_PROVENANCE',
          label: fieldLabel,
          record: {
            value: String(existingMapping.value),
            source: 'profile',
            confidence: 1.0,
            resolvedAt: Date.now(),
          },
        }).catch(() => {});
      }
      continue;
    }

    // Skip contextual questions that need specific answers — graph similarity can produce
    // false positives here (e.g. matching a "No" sponsorship answer to a timeline question)
    if (CONTEXTUAL_QUESTION_PATTERNS.some(re => re.test(fieldLabel))) continue;

    // Field is unfilled — ask background to classify, gate, and look it up in the graph.
    // Pass inputType and fieldName so the background can run the full two-stage classifier.
    let result: GetBestAnswerResult & { abstained?: boolean; reason?: string } = {
      value: null, confidence: 0, source: null, selectionReason: null,
    };

    try {
      result = await browser.runtime.sendMessage({
        kind: 'GRAPH_GET_BEST_ANSWER',
        questionText: fieldLabel,
        inputType:    field.type   ?? 'text',
        fieldName:    field.name   ?? field.id ?? '',
        // canonicalField omitted — background classifier resolves it
        platform: context?.platform,
        company:  context?.company,
        jobTitle: context?.jobTitle,
        url:      context?.url,
      }) as typeof result;
    } catch {
      // Background not ready — skip silently
    }

    // Abstained fields (junk/unclassifiable) are never filled or recorded
    if (result?.abstained) continue;

    if (result?.value && result.confidence >= 0.6) {
      enhanced.push({ selector: field.selector, value: result.value });
      console.log(
        `[Autofill/Graph] Filled "${fieldLabel}" via ${result.source} (confidence: ${result.confidence.toFixed(2)})`
      );
    }

    // Record provenance in background so debug panel can show it
    if (fieldLabel) {
      browser.runtime.sendMessage({
        kind: 'GRAPH_RECORD_PROVENANCE',
        label: fieldLabel,
        record: {
          value:             result?.value ?? '',
          source:            result?.selectionReason ?? null,
          confidence:        result?.confidence ?? 0,
          matchedQuestionId: result?.questionNodeId,
          answerNodeId:      result?.answerNodeId,
          resolvedAt:        Date.now(),
        },
      }).catch(() => {});
    }
  }

  return enhanced;
}

/**
 * Generate role-aware "Why" answer
 * Formula: 1 sentence mission + 1 sentence role-fit + 1 sentence impact
 */
function generateWhyAnswer(field: FieldSchema, profile: UserProfile): string | null {
  const label = (field.label || '').toLowerCase();
  
  // Extract company name from label — handles "Why Anthropic?", "Why work at Stripe?",
  // "Why are you interested in joining Google?", "Why do you want to work here at Meta?"
  const companyMatch = field.label?.match(
    /why\s+(?:work\s+at|join|do\s+you\s+want\s+to\s+(?:work\s+at|join)|are\s+you\s+interested\s+in\s+(?:joining)?)?\s*([A-Z][a-zA-Z0-9.]+)/i
  );
  const companyName = companyMatch ? companyMatch[1] : 'this company';
  
  // Infer role focus from profile (engineering, product, design, etc.)
  let roleFocus = 'technical excellence';
  let impactArea = 'innovative solutions';
  
  // Detect engineering/technical roles
  if (profile.professional.currentRole?.toLowerCase().includes('engineer') ||
      profile.professional.currentRole?.toLowerCase().includes('architect') ||
      profile.professional.currentRole?.toLowerCase().includes('developer')) {
    roleFocus = 'building scalable, reliable systems';
    impactArea = 'developer experience and platform reliability';
  }
  
  // Detect infrastructure/platform roles
  if (profile.professional.currentRole?.toLowerCase().includes('infrastructure') ||
      profile.professional.currentRole?.toLowerCase().includes('platform') ||
      profile.professional.currentRole?.toLowerCase().includes('devops') ||
      profile.professional.currentRole?.toLowerCase().includes('sre')) {
    roleFocus = 'infrastructure at scale and developer experience';
    impactArea = 'platform reliability and operational excellence';
  }
  
  // Detect security/trust & safety roles
  if (profile.professional.currentRole?.toLowerCase().includes('security') ||
      profile.professional.currentRole?.toLowerCase().includes('safety') ||
      profile.professional.currentRole?.toLowerCase().includes('trust')) {
    roleFocus = 'trust, safety, and security at scale';
    impactArea = 'user safety and platform integrity';
  }
  
  // Detect product/design roles
  if (profile.professional.currentRole?.toLowerCase().includes('product') ||
      profile.professional.currentRole?.toLowerCase().includes('design')) {
    roleFocus = 'user experience and product innovation';
    impactArea = 'user engagement and product quality';
  }
  
  // Company-specific mission sentences — add entries here for companies you apply to often
  const companyMissions: Record<string, string> = {
    anthropic:  "I'm drawn to Anthropic's mission of responsible AI development for the long-term benefit of humanity — building AI systems that are safe, interpretable, and aligned with human values.",
    openai:     "I'm excited about OpenAI's mission to ensure that artificial general intelligence benefits all of humanity.",
    google:     "I'm excited about Google's mission to organize the world's information and make it universally accessible and useful.",
    meta:       "I'm excited about Meta's mission to connect people and build the social infrastructure for a more connected world.",
    apple:      "I'm excited about Apple's commitment to building products that enrich people's lives through the intersection of technology and the liberal arts.",
    microsoft:  "I'm excited about Microsoft's mission to empower every person and every organization on the planet to achieve more.",
    amazon:     "I'm excited about Amazon's relentless focus on customer obsession and its mission to be Earth's most customer-centric company.",
    stripe:     "I'm excited about Stripe's mission to increase the GDP of the internet by making it easier for businesses of all sizes to accept payments.",
    airbnb:     "I'm excited about Airbnb's mission to create a world where anyone can belong anywhere.",
    discord:    "I'm excited about Discord's mission to create spaces where everyone can find belonging and build communities.",
    netflix:    "I'm excited about Netflix's commitment to entertaining the world and delivering the best streaming experience to its members.",
    spotify:    "I'm excited about Spotify's mission to unlock the potential of human creativity by giving a million creative artists the opportunity to live off their art.",
    github:     "I'm excited about GitHub's mission to accelerate human progress by making software development more collaborative and accessible.",
    figma:      "I'm excited about Figma's mission to make design accessible to everyone and transform how products are built through collaborative tools.",
    notion:     "I'm excited about Notion's vision to build an all-in-one workspace that gives teams the tools they need to work better together.",
    linear:     "I'm excited about Linear's commitment to building the future of software development tooling — fast, opinionated tools that help teams ship great products.",
  };

  const companyKey = companyName.toLowerCase();
  const missionSentence = companyMissions[companyKey]
    ?? `I'm excited about ${companyName}'s work and the opportunity to contribute to its mission.`;

  // Build the 3-sentence answer
  const answer = `${missionSentence} My experience in ${roleFocus} aligns well with the technical challenges at ${companyName}. I'm eager to contribute to ${impactArea} and help the team deliver at scale.`;
  
  console.log(`[Autofill] Generated why answer for ${companyName} (${profile.professional.currentRole || 'role'})`);
  return answer;
}

/**
 * Resolve whether a user profile identifies as Hispanic/Latino.
 *
 * Exported so other modules (e.g. browser-use-actions) can reuse the same
 * negation-safe logic without duplicating it.
 *
 * `collectSelfIdFromForm` stores the raw radio-button text verbatim, so the
 * ethnicity value may be a full sentence like "No, not Hispanic or Latino".
 * A bare `.includes('hispanic')` check would return true for that and produce
 * the wrong autofill answer — we MUST test for negation explicitly.
 *
 * Template: mirrors the disability-check pattern used in the radio/select
 * handlers below: positive indicator AND explicit no-negation guard.
 */
export function resolveIsHispanicLatino(
  ethnicity: string | undefined,
  race: string[]
): boolean {
  if (ethnicity) {
    const e = ethnicity.toLowerCase();
    const hasMention = e.includes('hispanic') || e.includes('latino');
    // Negation: "No, not Hispanic or Latino", "Not Hispanic or Latino",
    // "Prefer not to say", etc. — any of these invalidate the positive mention.
    const isNegated =
      e.startsWith('no') ||     // "No," or "No, not..."
      e.includes('not ') ||     // "Not Hispanic", "not hispanic or latino"
      e.includes('prefer not'); // "Prefer not to say"
    if (hasMention && !isNegated) return true;
  }
  // Fall back to race array (some ATS forms store Hispanic/Latino there)
  return race.some(r => {
    const rL = r.toLowerCase();
    return (rL.includes('hispanic') || rL.includes('latino')) && !rL.includes('not');
  });
}

/**
 * Match a form field to profile data
 */
function matchFieldToProfile(field: FieldSchema, profile: UserProfile): string | boolean | null {
  const label = (field.label || field.name || field.id || '').toLowerCase();
  const name = (field.name || '').toLowerCase();
  const id = (field.id || '').toLowerCase();
  
  // DEBUG: Log all field matching attempts for Self-ID fields
  const labelContainsSelfId = label.includes('hispanic') || label.includes('latino') || 
                                label.includes('race') || label.includes('ethnic') ||
                                label.includes('veteran') || label.includes('disability');
  if (labelContainsSelfId) {
    console.log('[Autofill] 🔍 Matching Self-ID field:', {
      label: field.label,
      name: field.name,
      id: field.id,
      labelLower: label,
      nameLower: name,
      idLower: id
    });
  }
  
  // First name
  if (matchesAny([label, name, id], ['first', 'fname', 'firstname', 'given'])) {
    return profile.personal.firstName;
  }

  // Middle name
  if (matchesAny([label, name, id], ['middle', 'mname', 'middlename', 'middleinitial', 'middle_name', 'middle_initial'])) {
    return profile.personal.middleName ?? '';
  }

  // Last name
  if (matchesAny([label, name, id], ['last', 'lname', 'lastname', 'family', 'surname'])) {
    const storedLast = profile.personal.lastName;
    // Guard: if the profile's lastName was accidentally stored as a full name (contains a space),
    // try to extract just the last name. If it starts with the firstName, strip it.
    // This handles the common onboarding mistake of storing "Firstname Lastname" in the lastName field.
    if (storedLast && storedLast.includes(' ')) {
      const firstName = profile.personal.firstName || '';
      const firstLower = firstName.toLowerCase();
      const lastLower = storedLast.toLowerCase();
      if (firstLower && lastLower.startsWith(firstLower + ' ')) {
        return storedLast.substring(firstName.length + 1).trim();
      }
      // Fallback: if it's exactly two words (e.g., "Nishanth Ponukumatla"), return the last word
      const parts = storedLast.trim().split(/\s+/);
      if (parts.length === 2) {
        return parts[1];
      }
    }
    return storedLast;
  }
  
  // Full name
  if (matchesAny([label, name, id], ['name', 'fullname', 'full_name']) && 
      !matchesAny([label, name, id], ['first', 'last', 'company'])) {
    return `${profile.personal.firstName} ${profile.personal.lastName}`;
  }
  
  // Email
  if (matchesAny([label, name, id], ['email', 'e-mail', 'mail'])) {
    return profile.personal.email;
  }
  
  // Phone - Country Code (separate field)
  // Check for explicit phone country code patterns OR "Country" field adjacent to phone
  if (matchesAny([label, name, id], ['country code', 'countrycode', 'country_code', 'phone_country', 'phonecountry', 'dialcode', 'dial code', 'dial_code', 'phone code', 'select country'])) {
    const phoneData = profile.personal.phone;
    const code = isPhoneDetails(phoneData) ? phoneData.countryCode : getCountryCode(phoneData as string);
    
    // Check if this is a custom dropdown (type=text but has options)
    // Some fields expect full format: "United States (+1)"
    // Others expect just: "+1"
    // Check current value to determine expected format
    const currentValue = field.valuePreview || '';
    if (currentValue.includes('United States') || currentValue.includes('🇺🇸')) {
      // This field expects full country name format
      // Map common country codes to names
      const countryNames: Record<string, string> = {
        '+1': 'United States',
        '+44': 'United Kingdom',
        '+91': 'India',
        '+86': 'China',
        '+81': 'Japan',
        '+49': 'Germany',
        '+33': 'France',
        '+61': 'Australia',
        // Add more as needed
      };
      
      const countryName = countryNames[code];
      if (countryName) {
        return `${countryName} (${code})`; // Format: "United States (+1)"
      }
    }
    
    // Default: just return the code
    console.log('[Autofill] 📞 Phone country code field:', code);
    return code;
  }
  
  // Generic "Country" field - check if it's phone_country_code or country_of_residence
  // Country field - exclude labels that merely mention "country" in a work-auth context
  // e.g. "Are you legally authorized to work in the country in which you are applying?"
  if (matchesAny([label, name, id], ['country']) && 
      !matchesAny([label, name, id], ['country code', 'countrycode']) &&
      !matchesAny([label], ['authorized', 'legally', 'sponsorship', 'sponsor', 'visa', 'employment', 'previously worked'])) {
    // Check if options look like country codes (+1, +44, etc.)
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const firstOptions = options.slice(0, 5).join(' ');
      const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions);
      
      if (looksLikeCountryCodes) {
        // This is actually phone_country_code
        const phoneData2 = profile.personal.phone;
        const code = isPhoneDetails(phoneData2) ? phoneData2.countryCode : getCountryCode(phoneData2 as string);
        console.log('[Autofill] 📞 Country field is phone_country_code:', code);
        return code;
      }
    }
    
    // Check if field is adjacent to / grouped with phone field
    try {
      const container = field.closest('form, .form-group, .field-group, [class*="phone"], [class*="contact"]');
      if (container) {
        const hasPhoneField = !!container.querySelector('[name*="phone"], [id*="phone"], [type="tel"], [placeholder*="phone"]');
        if (hasPhoneField) {
          // This is phone_country_code
          const phoneData3 = profile.personal.phone;
          const code = isPhoneDetails(phoneData3) ? phoneData3.countryCode : getCountryCode(phoneData3 as string);
          console.log('[Autofill] 📞 Country field adjacent to phone, treating as country code:', code);
          return code;
        }
      }
    } catch (e) {
      // DOM query failed, continue
    }
    
    // This is country_of_residence - for now, return US as default
    // TODO: Add to profile schema
    console.log('[Autofill] 🌍 Country of residence field (defaulting to United States)');
    return 'United States';
  }
  
  // Phone Extension - Skip these (should not be auto-filled)
  // CAREFUL: "ext" is too broad — it matches "extend" in sponsorship labels.
  // Only match if label is specifically about phone extensions.
  if (matchesAny([label, name, id], ['phone extension', 'phone ext']) ||
      ((matchesAny([label, name, id], ['extension']) || id === 'ext' || name === 'ext') &&
       (matchesAny([label, name, id], ['phone', 'tel', 'mobile', 'call']) || label.length < 30))) {
    console.log('[Autofill] 📞 Phone extension field - skipping (not auto-filled)');
    return null;
  }
  
  // Phone - Check if this is JUST the phone number field (without country code)
  if (matchesAny([label, name, id], ['phone', 'mobile', 'tel', 'telephone', 'cell', 'phone_number', 'phonenumber', 'mobile_number', 'mobilenumber'])) {
    const labelLower = (label || '').toLowerCase();
    
    // Skip if this is "Country Phone Code" - handled separately above
    if (labelLower.includes('country') && (labelLower.includes('code') || labelLower.includes('phone'))) {
      return null;
    }
    
    // Try to detect if this is a split phone field by checking:
    // 1. Field type (tel fields are often split)
    // 2. Nearby labels/fields mentioning country code
    // 3. Field length (short fields suggest split)
    // 4. Workday-specific: Look for "Country Phone Code" text in page
    
    const fieldType = field.type;
    const maxLength = field instanceof HTMLInputElement ? field.maxLength : -1;
    
    // Check DOM for nearby country code field
    let hasCountryCodeField = false;
    try {
      // Look in the same form or parent container
      const container = typeof document !== 'undefined' ? 
        (field.closest?.('form') || field.closest?.('div[class*="form"]') || field.closest?.('fieldset') || document.body) : 
        null;
      
      if (container) {
        // Check for various country code field patterns
        hasCountryCodeField = !!container.querySelector(
          '[name*="country"][name*="code"], ' +
          '[name*="countrycode"], ' +
          '[id*="country"][id*="code"], ' +
          '[id*="countrycode"], ' +
          '[placeholder*="country code"], ' +
          'select[name*="country"], ' +
          '[aria-label*="Country Phone Code"], ' +  // Workday uses aria-label
          'label:contains("Country Phone Code"), ' + // Workday label text
          '[class*="countryCode"]'
        );
        
        // Also check for Workday-specific pattern: look for "Country Phone Code" text in page
        if (!hasCountryCodeField && container.textContent) {
          hasCountryCodeField = container.textContent.includes('Country Phone Code') ||
                                container.textContent.includes('Country Code');
        }
      }
    } catch (e) {
      // DOM not available, fallback
    }
    
    // Also check if max length suggests a local number (10-11 digits)
    const suggestsSplit = hasCountryCodeField || (maxLength > 0 && maxLength <= 11);
    
    console.log('[Autofill] 📞 Phone number field - split detected:', suggestsSplit);
    
    if (suggestsSplit) {
      // Return just the phone number without country code
      const phoneData4 = profile.personal.phone;
      const localNumber = isPhoneDetails(phoneData4) ? phoneData4.number : getPhoneNumber(phoneData4 as string);
      console.log('[Autofill] 📞 Returning local number:', localNumber);
      return localNumber;
    } else {
      // Return full phone number with country code
      const phoneData5 = profile.personal.phone;
      if (isPhoneDetails(phoneData5)) {
        const fullNumber = `${phoneData5.countryCode} ${phoneData5.number}`;
        console.log('[Autofill] 📞 Returning full number:', fullNumber);
        return fullNumber;
      }
      const parsed = parsePhoneNumber(phoneData5 as string);
      console.log('[Autofill] 📞 Returning full number:', parsed.fullNumber);
      return parsed.fullNumber;
    }
  }
  
  // Country field - MUST be strict
  // Exclude labels that merely mention "country" in a work-auth/sponsorship context
  if (matchesAny([label, name, id], ['country']) &&
      !matchesAny([label], ['authorized', 'legally', 'sponsorship', 'sponsor', 'visa', 'employment', 'previously worked'])) {
    // Skip country fields - too risky without proper country detection
    console.log('[Autofill] Skipping country field (needs manual input or proper country detection)');
    return null;
  }
  
  // Phone country code dropdown - check if options look like country codes
  if ('options' in field && Array.isArray((field as any).options)) {
    const options = (field as any).options;
    const firstOptions = options.slice(0, 5).join(' ');
    const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions) || 
                                  /[A-Z][a-z]+\+\d/.test(firstOptions);
    
    if (looksLikeCountryCodes) {
      console.log('[Autofill] Detected country code dropdown, extracting code from phone');
      // This is a phone country code dropdown
      const phoneData6 = profile.personal.phone;
      const countryCode = isPhoneDetails(phoneData6) ? phoneData6.countryCode : getCountryCode(phoneData6 as string);
      
      // Find matching option
      const match = options.find((opt: string) => opt.includes(countryCode));
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Could not find country code in dropdown');
      return null;
    }
  }
  
  // ==========================================================================
  // SELF-ID FIELDS - CHECK THESE FIRST (before location/address)
  // ==========================================================================
  
  // Check selfId exists
  if (!profile.selfId) {
    // Initialize with defaults if not set
    profile.selfId = {
      gender: [],
      race: [],
      orientation: [],
      veteran: 'Decline to self-identify',
      transgender: 'Decline to self-identify',
      disability: 'Decline to self-identify'
    };
  }
  
  // Hispanic/Latino ethnicity (specific question) - CHECK FIRST!
  // BUT: defer to race handler if this is a multi-option race field
  let skipHispanicLatino = false;
  
  if (matchesAny([label, name, id], ['hispanic', 'latino', 'latina', 'latinx'])) {
    const labelLower = (label || '').toLowerCase();
    
    // STRICT: Only if label explicitly mentions hispanic/latino
    if (!labelLower.includes('hispanic') && !labelLower.includes('latino')) {
      // Don't match - might be part of another field name
      skipHispanicLatino = true;
    } else if (labelLower.includes('not hispanic') || labelLower.includes('not latino') ||
               labelLower.includes('non-hispanic')) {
      // "White (Not Hispanic or Latino)", "Black (Not Hispanic or Latino)", etc. are RACE options,
      // not Hispanic/Latino Yes-No questions — let the race handler process them instead.
      skipHispanicLatino = true;
    } else {
      // CRITICAL: Check if this is actually a RACE field with multiple options (Ashby style)
      // On Ashby, "Hispanic or Latino" is ONE option in a race radio group, not a separate Yes/No
      if (field.type === 'radio' && (field as any).radioOptions) {
        const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
        
        // Count how many options mention race/ethnicity (not just Hispanic)
        const raceOptionCount = options.filter(opt => {
          const optLower = opt.label.toLowerCase();
          return optLower.includes('white') || 
                 optLower.includes('black') || 
                 optLower.includes('asian') || 
                 optLower.includes('native') ||
                 optLower.includes('pacific islander') ||
                 optLower.includes('races') ||
                 optLower.includes('african american');
        }).length;
        
        // If there are 3+ race options, this is a RACE field, not a Hispanic Yes/No
        if (raceOptionCount >= 3) {
          console.log('[Autofill] ℹ️ Hispanic/Latino label detected, but this is a multi-option race field (', raceOptionCount, 'race options). Deferring to race handler.');
          skipHispanicLatino = true; // Skip Hispanic handler, let race handler process this
        }
      }
    }
    
    // Only process Hispanic/Latino logic if we didn't defer
    if (!skipHispanicLatino) {
      console.log('[Autofill] 🏁 Hispanic/Latino field detected (PRIORITY MATCH) - simple Yes/No');
    
    // resolveIsHispanicLatino handles negation-aware checks — see its JSDoc for why
    // a bare .includes('hispanic') is unsafe on stored ethnicity strings.
    const isHispanic = resolveIsHispanicLatino(profile.selfId.ethnicity, profile.selfId.race);
    
    // For radio button groups (simple Yes/No only), return the label of the correct option
    if (field.type === 'radio' && (field as any).radioOptions) {
      const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
      
      if (isHispanic) {
        // Find "Yes" or "Hispanic or Latino" option
        const yesOption = options.find(opt => 
          opt.label.toLowerCase().includes('yes') || 
          (opt.label.toLowerCase().includes('hispanic') && !opt.label.toLowerCase().includes('not hispanic'))
        );
        if (yesOption) {
          console.log('[Autofill] 🏁 Hispanic/Latino: selecting option:', yesOption.label);
          return yesOption.label;
        }
      } else {
        // Find "No" or "Not Hispanic" option
        const noOption = options.find(opt => 
          opt.label.toLowerCase().includes('no') ||
          opt.label.toLowerCase().includes('not hispanic') ||
          opt.label.toLowerCase().includes('decline')
        );
        if (noOption) {
          console.log('[Autofill] 🏁 Hispanic/Latino: selecting option:', noOption.label);
          return noOption.label;
        }
      }
    }
    
      // For non-radio fields (select/autocomplete), return Yes/No
      const returnValue = isHispanic ? 'Yes' : 'No';
      console.log('[Autofill] 🏁 Hispanic/Latino returning:', returnValue);
      return returnValue;
    }
    // If we reach here and skipHispanicLatino is true, continue to race handler
  }
  
  // Race/Ethnicity - CHECK EARLY!
  // Also check for multi-option radio groups with race keywords
  const labelLower = (label || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();
  const idLower = (id || '').toLowerCase();
  
  // Ethnicity-only fields (labeled "ethnicity" but NOT "race") are typically asking the
  // Hispanic/Latino question rather than asking for race categories. Handle them separately
  // so we don't accidentally fill them with the user's race value (e.g. "Asian").
  if ((labelLower.includes('ethnicity') || labelLower.includes('ethnic')) && !labelLower.includes('race')) {
    // resolveIsHispanicLatino handles negation-aware checks — see its JSDoc for why
    // a bare .includes('hispanic') is unsafe on stored ethnicity strings.
    const isHispanic = resolveIsHispanicLatino(profile.selfId.ethnicity, profile.selfId.race);

    // If options are available, find the right one by inspecting their text
    if ('options' in field && Array.isArray((field as any).options)) {
      const opts = (field as any).options as string[];
      const hasHispanicOptions = opts.some(o => o.toLowerCase().includes('hispanic') || o.toLowerCase().includes('latino'));

      if (hasHispanicOptions) {
        // This is a Hispanic/Latino Yes-No style field
        const match = isHispanic
          ? opts.find(o => { const l = o.toLowerCase(); return (l.includes('hispanic') || l.includes('latino')) && !l.includes('not'); })
          : opts.find(o => { const l = o.toLowerCase(); return l.includes('not hispanic') || l.includes('not latino') || l.includes('decline') || l === 'no'; });
        const fallback = isHispanic ? 'Hispanic or Latino' : 'Not Hispanic or Latino';
        const result = match || fallback;
        console.log('[Autofill] 🏁 Ethnicity field (Hispanic/Latino):', result);
        return result;
      }
      // Options don't look like Hispanic/Latino → fall through to race handler below
    } else {
      // No options pre-loaded — default to Hispanic/Latino answer
      const result = isHispanic ? 'Hispanic or Latino' : 'Not Hispanic or Latino';
      console.log('[Autofill] 🏁 Ethnicity field (Hispanic/Latino, no options):', result);
      return result;
    }
  }

  let isRaceField = matchesAny([label, name, id], ['race', 'ethnicity', 'ethnic']);
  
  // Additional check: If this is a radio group with multiple race options (Ashby style)
  if (!isRaceField && field.type === 'radio' && (field as any).radioOptions) {
    const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
    const raceOptionCount = options.filter(opt => {
      const optLower = opt.label.toLowerCase();
      return optLower.includes('white') || 
             optLower.includes('black') || 
             optLower.includes('asian') || 
             optLower.includes('native') ||
             optLower.includes('pacific islander') ||
             optLower.includes('african american');
    }).length;
    
    if (raceOptionCount >= 3) {
      console.log('[Autofill] 🔍 Detected race field via radio options (', raceOptionCount, 'race options found)');
      isRaceField = true;
    }
  }
  
  if (isRaceField) {
    console.log('[Autofill] Race/Ethnicity field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      raceData: profile.selfId.race,
      firstValue: profile.selfId.race[0] || '(empty)'
    });
    
    // For radio button groups, find the option that matches the user's race
    if (field.type === 'radio' && (field as any).radioOptions) {
      const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
      
      for (const userRace of profile.selfId.race) {
        const userRaceLower = userRace.toLowerCase();
        const matchedOption = options.find(opt => {
          const optLower = opt.label.toLowerCase();
          return optLower.includes(userRaceLower) || userRaceLower.includes(optLower);
        });
        
        if (matchedOption) {
          console.log('[Autofill] ✓ Race: selecting option:', matchedOption.label, 'for user race:', userRace);
          return matchedOption.label;
        }
      }
      
      // No match found - look for "decline" option
      const declineOption = options.find(opt => 
        opt.label.toLowerCase().includes('decline') ||
        opt.label.toLowerCase().includes('prefer not')
      );
      if (declineOption) {
        console.log('[Autofill] ℹ️ Race: no match, selecting decline option:', declineOption.label);
        return declineOption.label;
      }
      
      return null;
    }
    
    // For checkbox/radio (old logic - should not reach here if radio groups are deduplicated)
    if (field.type === 'checkbox' || field.type === 'radio') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      
      return profile.selfId.race.some(r => {
        const rLower = r.toLowerCase();
        return fieldValue.toLowerCase().includes(rLower) || 
               fieldLabel.includes(rLower) ||
               rLower.includes(fieldValue.toLowerCase());
      });
    }
    
    // For autocomplete/select fields with options, try to match
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.race[0] || '';
      const valueLower = value.toLowerCase();
      
      // Check if user declined to answer (multiple variations)
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not') ||
                        valueLower.includes("don't wish") ||
                        valueLower.includes('no answer');
      
      if (isDecline) {
        // Find "decline to answer" option in dropdown
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not') ||
                 optLower.includes("don't wish") ||
                 optLower.includes('no answer');
        });
        
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" variation to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Race value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.race[0] || '';
    // Don't fill if value looks like wrong data (location, sponsorship, etc.)
    if (value && (
      value.toLowerCase().includes('palo alto') ||
      value.toLowerCase().includes('california') ||
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      /^\d+$/.test(value) || // Just a number
      value.length > 50 // Too long to be a race option
    )) {
      console.warn('[Autofill] Race value looks suspicious (might be location/work auth):', value);
      return null; // Skip filling
    }
    // If profile stored an ethnicity answer in the race field, skip — wrong category
    if (!value ||
        value.toLowerCase() === 'not hispanic or latino' ||
        value.toLowerCase() === 'hispanic or latino') {
      console.warn('[Autofill] Race value looks like an ethnicity answer, skipping:', value);
      return null;
    }

    return value;
  }

  // Veteran status - CHECK EARLY!
  if (matchesAny([label, name, id], ['veteran', 'military'])) {
    // STRICT: Only if label explicitly mentions veteran (not just contains "us" or "permanent")
    const labelLower = (label || '').toLowerCase();
    if (!labelLower.includes('veteran') && !labelLower.includes('military')) {
      return null; // Don't match if not clearly veteran question
    }
    
    // DEBUG: Log veteran status value
    console.log('[Autofill] Veteran status field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      veteranValue: profile.selfId.veteran,
      valueType: typeof profile.selfId.veteran
    });
    
    // For radio button groups, find the correct option label
    if (field.type === 'radio' && (field as any).radioOptions) {
      const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
      const veteranLower = profile.selfId.veteran.toLowerCase();
      
      // Check if user is a veteran
      const isVeteran = veteranLower.includes('yes') || 
                       veteranLower.includes('i am') ||
                       veteranLower.includes('protected veteran');
      
      if (isVeteran) {
        // Find "Yes" or "I identify as..." option
        const yesOption = options.find(opt => {
          const optLower = opt.label.toLowerCase();
          return optLower.includes('yes') ||
                 optLower.includes('i identify as') ||
                 (optLower.includes('protected veteran') && !optLower.includes('not'));
        });
        if (yesOption) {
          console.log('[Autofill] 🎖️ Veteran: selecting option:', yesOption.label);
          return yesOption.label;
        }
      } else {
        // Find "No" or "I am not..." option
        const noOption = options.find(opt => {
          const optLower = opt.label.toLowerCase();
          return optLower.includes('not a protected veteran') ||
                 optLower.includes('i am not') ||
                 (optLower.includes('no') && !optLower.includes('yes'));
        });
        if (noOption) {
          console.log('[Autofill] 🎖️ Veteran: selecting option:', noOption.label);
          return noOption.label;
        }
      }
      
      // Fallback: decline option
      const declineOption = options.find(opt => 
        opt.label.toLowerCase().includes('decline')
      );
      if (declineOption) {
        console.log('[Autofill] 🎖️ Veteran: selecting decline option:', declineOption.label);
        return declineOption.label;
      }
      
      return null;
    }
    
    // For individual radio buttons without grouped radioOptions (e.g. Ashby single radios)
    if (field.type === 'radio') {
      const optLower = (field.label || '').toLowerCase().trim();
      const veteranLower = profile.selfId.veteran.toLowerCase();
      const isVet = veteranLower.includes('yes') || veteranLower.includes('i identify') ||
                    (veteranLower.includes('protected veteran') && !veteranLower.includes('not'));
      const isDeclineVet = veteranLower.includes('decline');

      if (isVet) {
        if (optLower.includes('yes') || optLower.includes('i identify') ||
            (optLower.includes('protected veteran') && !optLower.includes('not'))) return true;
      } else if (isDeclineVet) {
        if (optLower.includes('decline')) return true;
      } else {
        // Default: not a protected veteran
        if (optLower.includes('not a protected veteran') || optLower.includes('i am not') ||
            (optLower.includes('not') && optLower.includes('veteran'))) return true;
      }
      return null; // This option doesn't match — skip it
    }

    // For checkbox (old logic)
    if (field.type === 'checkbox') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      const veteranLower = profile.selfId.veteran.toLowerCase();
      
      return fieldValue.toLowerCase().includes(veteranLower) || 
             fieldLabel.includes(veteranLower) ||
             veteranLower.includes(fieldValue.toLowerCase());
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.veteran;
      const valueLower = value.toLowerCase();
      
      // Handle common veteran status variations
      let searchValue = valueLower;
      if (valueLower.includes('not') && valueLower.includes('veteran')) {
        // "Not a veteran" -> look for "I am not a protected veteran", "No", etc.
        // IMPORTANT: exclude "I am a veteran and I do NOT belong to a classification of
        // protected veterans" — that's someone who IS a veteran (just not "protected").
        const noOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          const isActuallyVeteranOption = optLower.startsWith('i am a veteran');
          return !isActuallyVeteranOption && (
            optLower === 'no' || 
            (optLower.includes('not') && optLower.includes('veteran')) ||
            optLower.includes('decline')
          );
        });
        if (noOption) {
          console.log('[Autofill] ✅ Mapped "Not a veteran" to:', noOption);
          return noOption;
        }
      } else if (valueLower.includes('yes') || valueLower.includes('veteran')) {
        // "Yes" or contains "veteran" -> look for veteran options
        const yesOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'yes' || 
                 (optLower.includes('veteran') && !optLower.includes('not'));
        });
        if (yesOption) {
          console.log('[Autofill] ✅ Mapped veteran status to:', yesOption);
          return yesOption;
        }
      }
      
      // Check if user declined to answer
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not');
      
      if (isDecline) {
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not');
        });
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Veteran value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.veteran;
    // Don't fill if value looks like wrong data
    if (value && (
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      value.toLowerCase().includes('visa') ||
      /^\d+$/.test(value) // Just a number
    )) {
      console.warn('[Autofill] Veteran value looks suspicious (might be work auth):', value);
      return null; // Skip filling
    }
    
    return value;
  }
  
  // Disability status - CHECK EARLY!
  if (matchesAny([label, name, id], ['disability', 'disabled'])) {
    // STRICT: Only if label explicitly mentions disability
    const labelLower = (label || '').toLowerCase();
    if (!labelLower.includes('disability') && !labelLower.includes('disabled')) {
      return null; // Don't match if not clearly disability question
    }
    
    // DEBUG: Log disability status value
    console.log('[Autofill] Disability status field detected (PRIORITY MATCH):', {
      fieldLabel: field.label,
      disabilityValue: profile.selfId.disability,
      valueType: typeof profile.selfId.disability
    });
    
    // For radio button groups, find the correct option label
    if (field.type === 'radio' && (field as any).radioOptions) {
      const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
      const disabilityLower = profile.selfId.disability.toLowerCase();
      
      // Check if user has a disability
      const hasDisability = disabilityLower.includes('yes') || 
                           disabilityLower.includes('i have') ||
                           disabilityLower.includes('disability');
      
      if (hasDisability && !disabilityLower.includes('no')) {
        // Find "Yes" option
        const yesOption = options.find(opt => {
          const optLower = opt.label.toLowerCase();
          return optLower.includes('yes') && optLower.includes('disability');
        });
        if (yesOption) {
          console.log('[Autofill] ♿ Disability: selecting option:', yesOption.label);
          return yesOption.label;
        }
      } else {
        // Find "No" option
        const noOption = options.find(opt => {
          const optLower = opt.label.toLowerCase();
          return (optLower.includes('no') || optLower.includes('don\'t')) && 
                 optLower.includes('disability');
        });
        if (noOption) {
          console.log('[Autofill] ♿ Disability: selecting option:', noOption.label);
          return noOption.label;
        }
      }
      
      // Fallback: decline option
      const declineOption = options.find(opt => 
        opt.label.toLowerCase().includes('decline') ||
        opt.label.toLowerCase().includes('do not want to answer')
      );
      if (declineOption) {
        console.log('[Autofill] ♿ Disability: selecting decline option:', declineOption.label);
        return declineOption.label;
      }
      
      return null;
    }
    
    // For individual radio buttons without grouped radioOptions (e.g. Ashby single radios)
    if (field.type === 'radio') {
      const optLower = (field.label || '').toLowerCase().trim();
      const disabilityLower = profile.selfId.disability.toLowerCase();
      const hasDisability = disabilityLower.includes('yes') || disabilityLower.includes('i have') ||
                            (disabilityLower.includes('disability') && !disabilityLower.includes('no'));
      const isDeclineDisability = disabilityLower.includes('decline') || disabilityLower.includes('do not want');

      if (hasDisability && !disabilityLower.includes('no')) {
        if (optLower.includes('yes') && optLower.includes('disability')) return true;
      } else if (isDeclineDisability) {
        if (optLower.includes('decline') || optLower.includes('do not want')) return true;
      } else {
        // Default: no disability
        if ((optLower.includes('no') || optLower.includes("don't")) && optLower.includes('disability')) return true;
      }
      return null; // This option doesn't match — skip it
    }

    // For checkbox (old logic)
    if (field.type === 'checkbox') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      const disabilityLower = profile.selfId.disability.toLowerCase();
      
      return fieldValue.toLowerCase().includes(disabilityLower) || 
             fieldLabel.includes(disabilityLower) ||
             disabilityLower.includes(fieldValue.toLowerCase());
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.disability;
      const valueLower = value.toLowerCase();
      
      // Handle common disability status variations.
      // IMPORTANT: "No, I don't have a disability" contains the substring "have a disability"
      // so we must check for negation FIRST before checking affirmative phrases.
      const hasNoDisability =
        valueLower === 'no' ||
        valueLower.includes('no disability') ||
        valueLower.includes('not disabled') ||
        (valueLower.includes("don't") && valueLower.includes('disabilit')) ||
        (valueLower.includes('do not') && valueLower.includes('disabilit')) ||
        (valueLower.startsWith('no') && valueLower.includes('disabilit'));

      const hasYesDisability =
        !hasNoDisability && (
          valueLower === 'yes' ||
          (valueLower.includes('have a disability') && !valueLower.includes("don't") && !valueLower.includes('not')) ||
          (valueLower.includes('disabled') && !valueLower.includes('not disabled'))
        );

      if (hasNoDisability) {
        // "No" -> look for "I do not have a disability", "No", etc.
        const noOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'no' || 
                 (optLower.includes('not') && optLower.includes('disabilit')) ||
                 (optLower.includes('do not') && optLower.includes('disabilit')) ||
                 optLower.includes('decline');
        });
        if (noOption) {
          console.log('[Autofill] ✅ Mapped "No disability" to:', noOption);
          return noOption;
        }
      } else if (hasYesDisability) {
        // "Yes" -> look for "I have a disability", "Yes", etc.
        const yesOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower === 'yes' || 
                 (optLower.includes('have') && optLower.includes('disabilit')) ||
                 (optLower.includes('disabilit') && !optLower.includes('not'));
        });
        if (yesOption) {
          console.log('[Autofill] ✅ Mapped disability status to:', yesOption);
          return yesOption;
        }
      }
      
      // Check if user declined to answer
      const isDecline = valueLower.includes('decline') || 
                        valueLower.includes('not disclose') || 
                        valueLower.includes('choose not') ||
                        valueLower.includes('prefer not');
      
      if (isDecline) {
        const declineOption = options.find((opt: string) => {
          const optLower = opt.toLowerCase();
          return optLower.includes('decline') || 
                 optLower.includes('not disclose') ||
                 optLower.includes('prefer not');
        });
        if (declineOption) {
          console.log('[Autofill] ✅ Mapped "decline" to:', declineOption);
          return declineOption;
        }
      }
      
      // Try to find exact match in options
      const match = options.find((opt: string) => 
        opt.toLowerCase() === valueLower ||
        opt.toLowerCase().includes(valueLower) ||
        valueLower.includes(opt.toLowerCase())
      );
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Disability value not found in dropdown options:', {
        profileValue: value,
        availableOptions: options.slice(0, 5)
      });
      return null;
    }
    
    // For text fields, validate the value makes sense
    const value = profile.selfId.disability;
    // Don't fill if value looks like wrong data
    if (value && (
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      value.toLowerCase().includes('sponsor') ||
      value.toLowerCase().includes('visa') ||
      /^\d+$/.test(value) // Just a number
    )) {
      console.warn('[Autofill] Disability value looks suspicious (might be work auth):', value);
      return null; // Skip filling
    }
    
    return value;
  }
  
  // Gender (early check to avoid conflicts)
  if (matchesAny([label, name, id], ['gender', 'sex'])) {
    const labelLower = (label || '').toLowerCase();
    
    // Exclude transgender-specific questions and unrelated fields containing "sex"
    // (e.g. "Please do not have sex with clients" type warnings — very unlikely but guard anyway)
    if (labelLower.includes('transgender') || labelLower.includes('trans')) {
      return null; // Handle separately
    }
    // "sex" in isolation or "identify your sex" → gender handler; exclude "sexual orientation"
    if (labelLower.includes('sex') && labelLower.includes('orientation')) {
      return null; // Orientation handled separately
    }
    
    // Gender synonym groups: forms may say "Male" or "Man", "Female" or "Woman"
    const GENDER_MALE_TERMS = ['male', 'man'];
    const GENDER_FEMALE_TERMS = ['female', 'woman'];
    const isUserMale = (g: string) => g === 'male' || g === 'man';
    const isUserFemale = (g: string) => g === 'female' || g === 'woman';
    const isOptionMale = (opt: string) => 
      GENDER_MALE_TERMS.some(t => opt === t || opt.startsWith(t + ' ') || opt.startsWith(t + '(')) &&
      !GENDER_FEMALE_TERMS.some(t => opt.includes(t));
    const isOptionFemale = (opt: string) => 
      GENDER_FEMALE_TERMS.some(t => opt === t || opt.startsWith(t + ' ') || opt.startsWith(t + '('));
    
    // For radio button groups, find the correct option label
    if (field.type === 'radio' && (field as any).radioOptions) {
      const options = (field as any).radioOptions as Array<{ selector: string; label: string; value: string }>;
      const userGender = (profile.selfId.gender[0] || '').toLowerCase().trim();
      
      // Try to find exact or fuzzy match
      for (const opt of options) {
        const optLower = opt.label.toLowerCase().trim();
        
        // Handle common male/female variations (Male↔Man, Female↔Woman)
        if (isUserMale(userGender) && isOptionMale(optLower)) {
          console.log('[Autofill] 👤 Gender: selecting option:', opt.label);
          return opt.label;
        }
        if (isUserFemale(userGender) && isOptionFemale(optLower)) {
          console.log('[Autofill] 👤 Gender: selecting option:', opt.label);
          return opt.label;
        }
        if (userGender.includes('non-binary') && (optLower.includes('non-binary') || optLower.includes('nonbinary'))) {
          console.log('[Autofill] 👤 Gender: selecting option:', opt.label);
          return opt.label;
        }
        
        // Exact or partial match
        if (optLower.includes(userGender) || userGender.includes(optLower)) {
          console.log('[Autofill] 👤 Gender: selecting option:', opt.label);
          return opt.label;
        }
      }
      
      // Fallback: decline option
      const declineOption = options.find(opt => 
        opt.label.toLowerCase().includes('decline')
      );
      if (declineOption) {
        console.log('[Autofill] 👤 Gender: selecting decline option:', declineOption.label);
        return declineOption.label;
      }
      
      return null;
    }
    
    // For individual radio buttons without grouped radioOptions (e.g. Ashby single radios)
    // Compare this radio button's own label against the user's gender choice
    if (field.type === 'radio') {
      const optLower = (field.label || '').toLowerCase().trim();
      const userGender = (profile.selfId.gender[0] || '').toLowerCase().trim();
      if (!userGender) return null;

      if (isUserMale(userGender) && isOptionMale(optLower)) return true;
      if (isUserFemale(userGender) && isOptionFemale(optLower)) return true;
      if (userGender.includes('non-binary') && (optLower.includes('non-binary') || optLower.includes('nonbinary'))) return true;
      // Generic partial match (e.g. "decline to self-identify" ↔ "decline")
      if (optLower === userGender || (userGender.length > 4 && optLower.includes(userGender))) return true;
      // This radio option is NOT the user's gender — skip it
      return null;
    }

    // For checkboxes (old logic)
    if (field.type === 'checkbox') {
      const fieldValue = field.valuePreview || '';
      const fieldLabel = (field.label || '').toLowerCase();
      
      // Check if any of the user's gender selections match this field's value or label
      return profile.selfId.gender.some(g => {
        const gLower = g.toLowerCase();
        return fieldValue.toLowerCase().includes(gLower) || 
               fieldLabel.includes(gLower) ||
               gLower.includes(fieldValue.toLowerCase());
      });
    }
    
    // For autocomplete/select fields with options, match exactly
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const value = profile.selfId.gender[0] || '';
      const valLower = value.toLowerCase().trim();
      
      // Try to find match in options using synonym-aware matching
      const match = options.find((opt: string) => {
        const optLower = opt.toLowerCase().trim();
        
        // Use synonym-aware matching (Male↔Man, Female↔Woman)
        if (isUserMale(valLower) && isOptionMale(optLower)) return true;
        if (isUserFemale(valLower) && isOptionFemale(optLower)) return true;
        if (valLower.includes('non-binary') && (optLower.includes('non-binary') || optLower.includes('nonbinary'))) return true;
        
        return optLower === valLower || 
               optLower.includes(valLower) || 
               valLower.includes(optLower);
      });
      
      if (match) {
        return match;
      }
      
      console.warn('[Autofill] Gender value not found in dropdown options');
      return null;
    }
    
    // For text fields, return first selection
    const value = profile.selfId.gender[0] || '';
    
    // Validate it's not wrong data
    if (value && (
      value.toLowerCase().includes('palo alto') ||
      value.toLowerCase().includes('resident') ||
      value.toLowerCase().includes('citizen') ||
      /^\d+$/.test(value)
    )) {
      console.warn('[Autofill] Gender value looks suspicious:', value);
      return null;
    }
    
    return value;
  }
  
  // Transgender identity question (e.g. Netflix "Are you a person of transgender experience?", Greenhouse "Do you identify as transgender?")
  if (matchesAny([label, name, id], ['transgender', 'trans experience', 'trans identity', 'identify as transgender'])) {
    const trans = (profile.selfId?.transgender || 'Decline to self-identify').toLowerCase();
    const isYes = trans === 'yes' || trans === 'true';
    const isNo  = trans === 'no'  || trans === 'false';

    if ('options' in field && Array.isArray((field as any).options)) {
      const opts = (field as any).options as string[];
      if (isYes) {
        return opts.find(o => o.toLowerCase().includes('yes') || o.toLowerCase().includes('identify as transgender')) ?? 'Yes';
      } else if (isNo) {
        return opts.find(o => o.toLowerCase().includes('no') || o.toLowerCase().includes('do not identify')) ?? 'No';
      }
      return opts.find(o => o.toLowerCase().includes('decline') || o.toLowerCase().includes('prefer not')) ?? 'Decline to self-identify';
    }

    if (isYes) return 'Yes';
    if (isNo)  return 'No';
    return 'Prefer not to disclose';
  }

  // Sexual orientation
  if (matchesAny([label, name, id], ['sexual orientation', 'orientation', 'sexual_orientation'])) {
    const orientations = profile.selfId?.orientation || [];

    if ('options' in field && Array.isArray((field as any).options)) {
      const opts = (field as any).options as string[];
      if (orientations.length > 0) {
        const valLower = orientations[0].toLowerCase();
        const match = opts.find(o => o.toLowerCase() === valLower || o.toLowerCase().includes(valLower) || valLower.includes(o.toLowerCase()));
        if (match) return match;
      }
      return opts.find(o => o.toLowerCase().includes('decline') || o.toLowerCase().includes('prefer not')) ?? 'Decline to self-identify';
    }

    if (orientations.length > 0) return orientations[0];
    return 'Decline to self-identify';
  }

  // ==========================================================================
  // END SELF-ID FIELDS
  // ==========================================================================

  // ==========================================================================
  // YES/NO POLICY QUESTIONS (PRIORITY: Before location/contact)
  // ==========================================================================

  // Netflix / company-specific: prior employment or contractor questions
  if (/worked.*before|contractor.*currently|currently.*contractor|previously.*employed|prior.*employment|employed.*before|former.*employ/i.test(label)) {
    console.log('[Autofill] 🏢 Prior employment/contractor question — defaulting to No');
    return 'No';
  }
  if (/worked for.*or.*subsidiaries|subsidiaries.*in the past|currently working.*as a contractor/i.test(label)) {
    console.log('[Autofill] 🏢 Company-specific prior employment question — defaulting to No');
    return 'No';
  }

  // Relocation / Willing to relocate questions
  // CRITICAL: Check this BEFORE location fields to avoid misclassification
  if (matchesAny([label, name, id], ['relocate', 'relocation', 'willing to move', 'open to relocation'])) {
    const labelLower = label.toLowerCase();
    
    // "Are you open to relocation for this role?"
    if (labelLower.includes('open to') || labelLower.includes('willing')) {
      console.log('[Autofill] 🌎 Relocation policy question (Yes/No)');
      return 'Yes';  // Default to yes (user can configure)
    }
    
    // "Are you currently based in or willing to relocate to X?"
    if (labelLower.includes('based in') || labelLower.includes('relocate to')) {
      const userLocation = (profile.personal.location || '').toLowerCase();
      
      // If asking about "Bay Area" or "San Francisco" and user is in Palo Alto
      if ((labelLower.includes('bay area') || labelLower.includes('san francisco')) && 
          (userLocation.includes('palo alto') || userLocation.includes('bay area') || userLocation.includes('san francisco'))) {
        console.log('[Autofill] 🌎 Bay Area relocation: Yes (already there)');
        return 'Yes';
      }
      
      // Default: willing to relocate
      console.log('[Autofill] 🌎 Relocation question: Yes (default)');
      return 'Yes';
    }
  }
  
  // "Are you currently located in the US?"
  if (matchesAny([label, name, id], ['currently located', 'located in'])) {
    const labelLower = label.toLowerCase();
    
    if (labelLower.includes(' us') || labelLower.includes('united states') || labelLower.includes('u.s.') || labelLower.includes(' us?')) {
      // Check work auth status or location to infer
      if (profile.workAuth && profile.workAuth.currentStatus && 
          (profile.workAuth.currentStatus.includes('US') || profile.workAuth.currentStatus.includes('United States'))) {
        console.log('[Autofill] 🌎 US location question: Yes (based on work auth)');
        return 'Yes';
      }
      // Or check if location seems US-based
      const userLocation = (profile.personal.location || '').toLowerCase();
      if (userLocation && (userLocation.includes('ca') || userLocation.includes('california') || 
          userLocation.includes('ny') || userLocation.includes('texas') || userLocation.includes('usa') ||
          userLocation.includes('palo alto'))) {
        console.log('[Autofill] 🌎 US location question: Yes (based on location)');
        return 'Yes';
      }
    }
  }
  
  // "Are you able to work from our [location] office X days per week?"
  // "Are you open to working in person in our San Francisco office 2-3 times a week?"
  if (matchesAny([label, name, id], ['able to work', 'work from', 'office', 'days per week', 'in-office', 'in person', 'times a week', 'times per week'])) {
    const labelLower = label.toLowerCase();
    
    // Check if asking about office attendance / hybrid work
    if ((labelLower.includes('office') || labelLower.includes('in-office') || labelLower.includes('in person')) && 
        (labelLower.includes('able') || labelLower.includes('work from') || labelLower.includes('days') || 
         labelLower.includes('times') || labelLower.includes('open to'))) {
      
      const locData = profile.personal.location;
      const userLocation = (isLocationDetails(locData)
        ? `${locData.city} ${locData.state} ${locData.country}`
        : (locData as string) || ''
      ).toLowerCase();
      
      // Check if asking about San Francisco office
      if (labelLower.includes('san francisco')) {
        // If user is in Bay Area/SF/Palo Alto, answer Yes
        if (userLocation.includes('palo alto') || userLocation.includes('bay area') || 
            userLocation.includes('san francisco') || userLocation.includes('sf')) {
          console.log('[Autofill] 🏢 SF office attendance: Yes (user is in Bay Area)');
          return 'Yes';
        }
      }
      
      // For other office locations, check if user is in that area
      // Extract city name from label if possible
      const cityMatch = labelLower.match(/work from (?:our |the )?([a-z\s]+) office/);
      if (cityMatch) {
        const cityName = cityMatch[1].trim();
        if (userLocation.includes(cityName)) {
          console.log(`[Autofill] 🏢 ${cityName} office attendance: Yes (user is in ${cityName})`);
          return 'Yes';
        }
      }
      
      // Default: Yes (willing to work from office if in reasonable commute distance)
      console.log('[Autofill] 🏢 Office attendance question: Yes (default)');
      return 'Yes';
    }
  }
  
  // Non-compete / NDA / restrictive agreements questions
  // "Are you currently bound by any agreements with a current or former employer..."
  if (matchesAny([label, name, id], ['non-compete', 'non compete', 'non-solicitation', 'non-disclosure', 'nda', 'bound by', 'restrictive agreement', 'contractual obligation'])) {
    console.log('[Autofill] 📋 Non-compete/NDA agreements question: No (default)');
    return 'No';
  }

  // ==========================================================================
  // WORK AUTHORIZATION FIELDS (PRIORITY: Check BEFORE location fields)
  // ==========================================================================
  // Work authorization keywords (sponsor, visa, etc.) must be checked BEFORE
  // location keywords to prevent "sponsorship in country X" from being
  // misclassified as a location field.

  // Work Authorization fields (if user has provided this data)
  if (profile.workAuth) {
    console.log('[Autofill] 💼 Work Auth data available:', {
      legallyAuthorized: profile.workAuth.legallyAuthorized,
      requiresSponsorship: profile.workAuth.requiresSponsorship,
      currentStatus: profile.workAuth.currentStatus
    });
    
    // Legally authorized to work
    // IMPORTANT: Exclude sponsorship questions — "Will you require sponsorship for work authorization?"
    // contains "authorization" but is asking about sponsorship, not legal authorization.
    if (matchesAny([label, name, id], ['legally', 'authorized', 'legal', 'eligible', 'work authorization']) &&
        !label.includes('sponsor')) {
      console.log('[Autofill] 💼 Matched work authorization field:', field.label);
      
      if (field.type === 'checkbox' || field.type === 'radio') {
        const fieldValue = (field.valuePreview || '').toLowerCase();
        const fieldLabel = (field.label || '').toLowerCase();
        
        // Check if this is asking for "yes" answer
        const isYesOption = fieldValue.includes('yes') || fieldLabel.includes('yes') || 
                           fieldValue.includes('authorized') || fieldValue.includes('eligible');
        const isNoOption = fieldValue.includes('no') || fieldLabel.includes('no');
        
        if (profile.workAuth.legallyAuthorized) {
          return isYesOption;
        } else {
          return isNoOption;
        }
      } else {
        // For select-one, autocomplete, or text fields - return Yes/No string
        const answer = profile.workAuth.legallyAuthorized ? 'Yes' : 'No';
        console.log('[Autofill] 💼 Returning work authorization answer:', answer);
        return answer;
      }
    }

    // Requires sponsorship
    // Match both "sponsorship" and "Will you now or in the future require..."
    if (matchesAny([label, name, id], ['sponsorship', 'visa', 'sponsor', 'work permit', 'require']) ||
        (label && label.toLowerCase().includes('now or in the future') && label.toLowerCase().includes('require'))) {
      const labelLower = (label || '').toLowerCase();
      
      // Skip if this is asking about visa TYPE (handled below)
      if (matchesAny([label, name, id], ['type', 'kind', 'which'])) {
        // This is asking for visa type, not yes/no
        if (profile.workAuth.visaType) {
          return profile.workAuth.visaType;
        }
      } else {
        // Ensure this is really a sponsorship YES/NO question
        const isSponsorshipQuestion = labelLower.includes('sponsor') || 
                                     labelLower.includes('visa') || 
                                     labelLower.includes('require') ||
                                     (labelLower.includes('now or in the future') && labelLower.includes('employment'));
        
        if (!isSponsorshipQuestion) {
          return null; // Not specific enough
        }
        
        console.log('[Autofill] 💼 Sponsorship question detected:', label);
        
        // This is asking yes/no about sponsorship requirement
        if (field.type === 'checkbox' || field.type === 'radio') {
          const fieldValue = (field.valuePreview || '').toLowerCase();
          const fieldLabel = (field.label || '').toLowerCase();
          
          const isYesOption = fieldValue.includes('yes') || fieldLabel.includes('yes') ||
                             fieldValue.includes('require') || fieldValue.includes('need');
          const isNoOption = fieldValue.includes('no') || fieldLabel.includes('no');
          
          if (profile.workAuth.requiresSponsorship) {
            return isYesOption;
          } else {
            return isNoOption;
          }
        } else if (field.type === 'select-one' || field.type === 'text' || field.type === 'autocomplete') {
          // For dropdowns (including React-Select), return Yes/No
          const answer = profile.workAuth.requiresSponsorship ? 'Yes' : 'No';
          console.log('[Autofill] 💼 Sponsorship answer:', answer);
          return answer;
        }
      }
    }

    // "I am a U.S. person" radio (OFAC/export-control question on some ATS forms)
    // Maps to legally authorized = true
    if (field.type === 'radio' &&
        (label.includes('u.s. person') || label.includes('us person') ||
         label.includes('united states person'))) {
      return profile.workAuth.legallyAuthorized ? true : null;
    }

    // Current work status
    // CRITICAL: Exclude sanctioned-country citizenship labels such as
    // "I am a citizen of Cuba, Iran, North Korea, or Syria AND I am NOT a U.S. person"
    if (matchesAny([label, name, id], ['status', 'citizenship', 'citizen', 'resident', 'permanent']) &&
        !matchesAny([label], ['cuba', 'iran', 'north korea', 'syria', 'sanctions',
                              'not a u.s', 'citizen of cuba', 'citizen of a different'])) {
      if (profile.workAuth.currentStatus) {
        return profile.workAuth.currentStatus;
      }
    }

    // Visa type
    if (matchesAny([label, name, id], ['visa type', 'visa', 'h-1b', 'opt', 'cpt', 'immigration'])) {
      if (profile.workAuth.visaType) {
        return profile.workAuth.visaType;
      }
    }

    // Sponsorship timeline
    if (matchesAny([label, name, id], ['when', 'timeline', 'timeframe', 'how soon'])) {
      if (profile.workAuth.sponsorshipTimeline) {
        return profile.workAuth.sponsorshipTimeline;
      }
    }
  }

  // Smart defaults when no workAuth profile data exists
  if (!profile.workAuth) {
    // "Will you require visa sponsorship / work permit?"
    if (matchesAny([label, name, id], ['sponsorship', 'sponsor', 'work permit']) ||
        (label && /require.*sponsor|sponsor.*now|future.*sponsor/i.test(label))) {
      console.log('[Autofill] 💼 Sponsorship question, no workAuth — defaulting to No');
      return 'No';
    }
    // "Are you legally authorized / eligible to work?"
    if (matchesAny([label, name, id], ['legally authorized', 'authorized to work', 'eligible to work']) &&
        !label.includes('sponsor')) {
      console.log('[Autofill] 💼 Work authorization question, no workAuth — defaulting to Yes');
      return 'Yes';
    }
  }

  // ==========================================================================
  // LOCATION FREEFORM FIELDS (AFTER work auth checks)
  // ==========================================================================
  
  // Location / City / Address (actual freeform fields)
  // Only match if it's asking for an address/location, NOT a policy question
  if (matchesAny([label, name, id], ['location', 'city', 'address', 'where', 'postal', 'zip', 'county', 'state', 'region'])) {
    const labelLower = (label || '').toLowerCase();
    
    // EXCLUDE policy questions that contain location keywords
    if (labelLower.includes('open to') || 
        labelLower.includes('willing to') || 
        labelLower.includes('relocate') ||
        labelLower.includes('relocation')) {
      console.log('[Autofill] 🚫 Skipping location-like field (is actually a policy question):', field.label);
      return null;
    }
    
    // Don't match if this is asking for country
    if (labelLower.includes('country') && !labelLower.includes('county')) {
      return null;
    }
    
    // Don't match if this is really asking about work authorization
    if (labelLower.includes('sponsorship') || 
        labelLower.includes('visa') || 
        labelLower.includes('work authorization') ||
        labelLower.includes('legally authorized') ||
        labelLower.includes('authorized to work') ||
        (labelLower.includes('require') && labelLower.includes('work'))) {
      // Skip - this is work auth question, not location
      return null;
    }
    
    // Check if this dropdown actually has country codes as options
    if ('options' in field && Array.isArray((field as any).options)) {
      const options = (field as any).options;
      const firstOptions = options.slice(0, 5).join(' ');
      const looksLikeCountryCodes = /\+\d{1,3}/.test(firstOptions);
      
      if (looksLikeCountryCodes) {
        console.warn('[Autofill] Location field has country codes as options - skipping');
        return null;
      }
    }
    
    // Resolve city / state / country / zip from profile (supports both object and legacy string)
    const locationData = profile.personal.location;
    let city    = '';
    let state   = '';
    let country = 'United States';
    let zipCode = '';

    if (isLocationDetails(locationData)) {
      // New structured format — direct access, no parsing needed
      city    = locationData.city    || '';
      state   = locationData.state   || '';
      country = locationData.country || 'United States';
      zipCode = locationData.zipCode || '';
    } else if (typeof locationData === 'string' && locationData) {
      // Legacy string: "City, State" or "City, State, Country"
      const parts = locationData.split(',').map(p => p.trim());
      city  = parts[0] || '';
      state = parts[1] || '';
      if (parts[2]) country = parts[2];
    }

    // City
    if (labelLower.includes('city') || labelLower === 'city*') {
      console.log('[Autofill] 📍 City field:', city);
      return city;
    }
    
    // State / Region / Province
    if ((labelLower.includes('state') || labelLower.includes('region') || labelLower.includes('province')) &&
        !labelLower.includes('authorized') && !labelLower.includes('legally') && 
        !labelLower.includes('sponsorship') && !labelLower.includes('united states') &&
        !labelLower.includes('visa') && !labelLower.includes('employment')) {
      console.log('[Autofill] 📍 State/Region field:', state);
      return state;
    }
    
    // Postal Code / ZIP
    if (labelLower.includes('postal') || labelLower.includes('zip')) {
      if (zipCode) {
        console.log('[Autofill] 📍 ZIP/Postal code field:', zipCode);
        return zipCode;
      }
      console.log('[Autofill] 📍 Postal code field - no data in profile');
      return null;
    }
    
    // County
    if (labelLower.includes('county')) {
      const countyMap: Record<string, string> = {
        'palo alto': 'Santa Clara',
        'san francisco': 'San Francisco',
        'san jose': 'Santa Clara',
        'seattle': 'King',
        'new york': 'New York',
        'brooklyn': 'Kings',
        'los angeles': 'Los Angeles',
        'austin': 'Travis',
        'chicago': 'Cook',
      };
      const cityLower = city.toLowerCase();
      const county = countyMap[cityLower] || '';
      console.log('[Autofill] 📍 County field:', county || '(unknown)');
      return county;
    }
    
    // Address Line 1 (street address)
    if (labelLower.includes('address line 1') || labelLower.includes('street address')) {
      console.log('[Autofill] 📍 Address Line 1 - skipping (no profile data)');
      return null;
    }
    
    // Address Line 2 (apt/suite)
    if (labelLower.includes('address line 2') || labelLower.includes('apt') || labelLower.includes('suite')) {
      console.log('[Autofill] 📍 Address Line 2 - skipping (optional)');
      return null;
    }
    
    // Generic location/address field — return a readable string
    const locationString = typeof locationData === 'string'
      ? locationData.replace(/\s*,\s*/g, ', ').trim()
      : [city, state, country].filter(Boolean).join(', ');

    console.log('[Autofill] 📍 Generic location field matched:', {
      fieldLabel: field.label,
      returnValue: locationString,
    });
    return locationString;
  }
  
  // LinkedIn
  if (matchesAny([label, name, id], ['linkedin', 'linked-in'])) {
    return profile.professional.linkedin || '';
  }
  
  // GitHub
  if (matchesAny([label, name, id], ['github', 'git'])) {
    return profile.professional.github || '';
  }
  
  // Portfolio / Website
  if (matchesAny([label, name, id], ['portfolio', 'website', 'site', 'web', 'personal site', 'blog'])) {
    // Check if label specifically says "website" (not "How did you hear")
    if (!label.includes('hear') && !label.includes('find') && !label.includes('source')) {
      const portfolioValue = profile.professional.portfolio || profile.professional.github || '';
      console.log('[Autofill] 🌐 Website/Portfolio field matched:', portfolioValue || '(empty)');
      return portfolioValue;
    }
  }
  
  // How did you hear about this job / Referral source
  if (matchesAny([label, name, id], ['hear', 'heard', 'find', 'source', 'referral', 'how did you'])) {
    const labelLower = label.toLowerCase();
    
    // Make sure it's asking "how did you hear/find"
    if (labelLower.includes('hear') || labelLower.includes('find') || labelLower.includes('source') || labelLower.includes('referral')) {
      // Common answers - return empty or a default
      // TODO: Could store this in profile.referralSource if needed
      return ''; // Let user fill manually or use Smart Suggestions
    }
  }
  
  // Years of experience — only for short fields explicitly asking for a number
  if (matchesAny([label, name, id], ['experience', 'years', 'yoe'])) {
    const labelLower = (label || '').toLowerCase();
    const idLowerFull = (field.id || '').toLowerCase();
    const nameLowerFull = (field.name || '').toLowerCase();

    // EXCLUDE Workday date sub-fields whose id/name contains dateSectionMonth or dateSectionYear
    if (idLowerFull.includes('datesectionmonth') || nameLowerFull.includes('datesectionmonth') ||
        idLowerFull.includes('datesectionyear') || nameLowerFull.includes('datesectionyear')) {
      return null;
    }

    // EXCLUDE Workday job title, company, school, and other non-year fields
    if ((idLowerFull.includes('jobtitle') || nameLowerFull.includes('jobtitle') ||
         idLowerFull.includes('company') || nameLowerFull.includes('company') ||
         idLowerFull.includes('school') || nameLowerFull.includes('school') ||
         idLowerFull.includes('university') || nameLowerFull.includes('university') ||
         idLowerFull.includes('degree') || nameLowerFull.includes('degree') ||
         idLowerFull.includes('fieldofstudy') || nameLowerFull.includes('fieldofstudy'))) {
      return null;
    }

    // EXCLUDE self-ID questions
    if (labelLower.includes('transgender') || 
        labelLower.includes('veteran') ||
        labelLower.includes('disability') ||
        labelLower.includes('gender') ||
        labelLower.includes('identity')) {
      // This is a self-ID question, not experience
      return null;
    }
    
    // EXCLUDE long-form / description fields — "describe your experience" is NOT a years field
    if (labelLower.includes('describe') || labelLower.includes('explain') ||
        labelLower.includes('tell us') || labelLower.includes('please share') ||
        labelLower.includes('provide') || labelLower.includes('projects') ||
        labelLower.includes('working on') || labelLower.includes('elaborate') ||
        labelLower.includes('how have you') || labelLower.includes('how do you') ||
        labelLower.includes('how would you') || labelLower.includes('what is your') ||
        labelLower.length > 80 || field.tagName === 'TEXTAREA') {
      console.log(`[Autofill] Skipping "years of experience" match for long-form field: "${labelLower.substring(0, 60)}..."`);
      return null;
    }
    
    return profile.professional.yearsOfExperience?.toString() || '';
  }
  
  // Education fields - be very strict
  if (matchesAny([label, name, id], ['school', 'university', 'college'])) {
    // Don't match if this looks like it's asking for something else
    const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('high school') || labelLower.includes('name') || labelLower.includes('school')) {
      console.log('[Autofill] 🎓 School field detected, education data:', profile.education);
      // Find first non-empty school from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.school && edu.school.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning school:', validEntry.school);
          return validEntry.school;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
    return null;
  }
  
  if (matchesAny([label, name, id], ['degree'])) {
      const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('degree')) {
      console.log('[Autofill] 🎓 Degree field detected, education data:', profile.education);
      // Find first non-empty degree from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.degree && edu.degree.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning degree:', validEntry.degree);
          return validEntry.degree;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
        return null;
      }
      
  if (matchesAny([label, name, id], ['discipline', 'major', 'field of study'])) {
    const labelLower = (label || '').toLowerCase();
    if (labelLower.includes('discipline') || labelLower.includes('major') || labelLower.includes('field')) {
      console.log('[Autofill] 🎓 Discipline field detected, education data:', profile.education);
      // Find first non-empty field from education
      if (profile.education && profile.education.length > 0) {
        const validEntry = profile.education.find(edu => edu.field && edu.field.trim() !== '');
        if (validEntry) {
          console.log('[Autofill] 🎓 Returning discipline:', validEntry.field);
          return validEntry.field;
        }
      }
      console.log('[Autofill] ⚠️ No valid education data found in profile');
    }
    return null;
  }
  
  // Cover letter / Summary / About / Why questions
  if (field.tagName?.toUpperCase() === 'TEXTAREA') {
    const labelLower = (label || '').toLowerCase();
    
    // Only match if it's clearly asking for a summary/bio/cover letter
    if (labelLower.includes('cover') || 
        labelLower.includes('letter') || 
        labelLower.includes('why') ||
        (labelLower.includes('about') && labelLower.includes('yourself')) ||
        labelLower.includes('bio') ||
        labelLower.includes('summary') ||
        labelLower.includes('motivation')) {
      
      console.log('[Autofill] 📝 Textarea field matched:', field.label);
      
      // For "Why" questions, generate role-aware answer
      if (labelLower.includes('why')) {
        const answer = generateWhyAnswer(field, profile);
        console.log('[Autofill] 💬 Generated "Why" answer:', answer ? answer.substring(0, 100) + '...' : '(empty)');
        return answer;
      }
      
      return profile.summary || '';
    }
  }

  // Security Clearance fields
  if (matchesAny([label, name, id], ['security clearance', 'clearance', 'security'])) {
    const labelLower = (label || '').toLowerCase();
    
    // "Do you hold an active US security clearance?"
    if (labelLower.includes('hold') || labelLower.includes('have') || labelLower.includes('active')) {
      // This is asking Yes/No
      if (field.type === 'select-one' || field.type === 'autocomplete') {
        // Default to No (user can configure this in profile later)
        console.log('[Autofill] Security clearance Yes/No question - returning: No');
        return 'No';
      }
    }
    
    // "What is the highest level of clearance you hold?"
    if (labelLower.includes('level') || labelLower.includes('highest') || labelLower.includes('what')) {
      // This is asking for clearance level - skip for now (needs profile data)
      console.log('[Autofill] Security clearance level question - skipping (no profile data)');
      return null;
    }
  }
  
  // Start Date / Availability
  if (matchesAny([label, name, id], ['start date', 'start a new role', 'when can you start', 'availability', 'available to start', 'earliest start date'])) {
      const labelLower = (label || '').toLowerCase();
    
    // Check if asking for a date
    if (labelLower.includes('when') || labelLower.includes('start') || labelLower.includes('available')) {
      // Default: "Immediately" or "2 weeks notice" depending on field type
      if (field.type === 'date') {
        // For date fields, return 2 weeks from now
        const twoWeeksFromNow = new Date();
        twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
        const formattedDate = twoWeeksFromNow.toISOString().split('T')[0]; // YYYY-MM-DD
        console.log('[Autofill] 📅 Start date: 2 weeks from now:', formattedDate);
        return formattedDate;
      } else if (field.type === 'select-one' || field.type === 'autocomplete') {
        // For dropdowns, try common options
        if ('options' in field && Array.isArray((field as any).options)) {
          const options = (field as any).options as string[];
          
          // Look for "Immediately" or "2 weeks" option
          const immediateOption = options.find((opt: string) => 
            opt.toLowerCase().includes('immediate') || 
            opt.toLowerCase().includes('asap') ||
            opt.toLowerCase().includes('right away')
          );
          if (immediateOption) {
            console.log('[Autofill] 📅 Start date: Immediately');
            return immediateOption;
          }
          
          const twoWeeksOption = options.find((opt: string) => 
            opt.toLowerCase().includes('2 weeks') || 
            opt.toLowerCase().includes('two weeks')
          );
          if (twoWeeksOption) {
            console.log('[Autofill] 📅 Start date: 2 weeks notice');
            return twoWeeksOption;
          }
          
          // If no good option, return first non-empty option
          if (options.length > 0 && options[0]) {
            console.log('[Autofill] 📅 Start date: first option:', options[0]);
            return options[0];
          }
        }
        
        // Default for freeform: "Immediately" or "2 weeks notice"
        console.log('[Autofill] 📅 Start date: Immediately (default)');
        return 'Immediately';
      } else {
        // For text fields, return "Immediately" or "2 weeks notice"
        console.log('[Autofill] 📅 Start date: Immediately (text field)');
        return 'Immediately';
      }
    }
  }
  
  // Export control / sanctions checkbox groups (Databricks-style)
  // "Please confirm whether any of the below applies to you" - sanctions compliance
  // These are checkbox fields where the label is the option text
  if (field.type === 'checkbox') {
        const fieldLabel = (field.label || '').toLowerCase();
    const fieldValue = (field.valuePreview || '').toLowerCase();
    
    console.log('[Autofill] 🔍 Checking checkbox field:', {
      label: field.label,
      value: field.valuePreview,
      id: field.id,
      name: field.name
    });
    
    // Sanctions compliance: "Citizen or permanent resident of Cuba, Iran, North Korea, or Syria" etc.
    // For US-based applicants, select "None of the above"
    if (fieldLabel.includes('none of the above') || fieldValue.includes('none of the above')) {
      // Check context: is this in a sanctions/export control section?
      // Look at nearby labels or the group label
      const parentText = (field as any).groupLabel?.toLowerCase() || '';
      const isSanctionsContext = parentText.includes('sanction') || parentText.includes('export control') ||
                                 parentText.includes('confirm whether') || parentText.includes('cuba') || 
                                 parentText.includes('iran');
      
      console.log('[Autofill] Found "none of the above" checkbox, sanctions context:', isSanctionsContext);
      
      if (isSanctionsContext || fieldLabel === 'none of the above') {
        console.log('[Autofill] 🏛️ Sanctions/export control: selecting "None of the above"');
        return true; // Check this checkbox
      }
    }
    
    // Citizenship status confirmation: "U.S. permanent resident (Green Card holder)"
    if (profile.workAuth) {
      const status = (profile.workAuth.currentStatus || '').toLowerCase();
      
      console.log('[Autofill] Checking citizenship checkbox, workAuth status:', status, 'field label:', fieldLabel);
      
      if (status.includes('permanent resident') || status.includes('green card')) {
        if (fieldLabel.includes('permanent resident') || fieldLabel.includes('green card')) {
          console.log('[Autofill] 🏛️ Citizenship confirmation: selecting "U.S. permanent resident"');
          return true;
        }
      } else if (status.includes('citizen')) {
        if (fieldLabel.includes('u.s. citizen') && !fieldLabel.includes('non-citizen')) {
          console.log('[Autofill] 🏛️ Citizenship confirmation: selecting "U.S. citizen"');
          return true;
        }
      }
      
      // "Not applicable" checkbox (selected "none of the above" for prior question)
      if (fieldLabel.includes('not applicable') && fieldLabel.includes('none of the above')) {
        // Only select this if we would have selected "none of the above" for the prior question
        // Skip - the correct citizenship option should be selected instead
        console.log('[Autofill] Skipping "Not applicable" checkbox (citizenship status should be selected instead)');
      }
    }
    
    console.log('[Autofill] Checkbox did not match any patterns, skipping');
  }
  
  // NOTE: Self-ID questions are now checked at the TOP of matchFieldToProfile()
  // (before location/address matchers) to prevent incorrect matches
  
  return null;
}

/**
 * Check if any of the texts match any of the patterns (HELPER MOVED FROM BELOW)
 */
function matchesAny(texts: string[], patterns: string[]): boolean {
  for (const text of texts) {
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        return true;
      }
    }
  }
  return false;
}
