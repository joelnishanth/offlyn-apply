/**
 * Browser-Use style action generation for form filling
 * Compatible with Ollama - inspired by https://github.com/browser-use/browser-use
 *
 * Uses the same approach as browser-use: LLM receives form state + task,
 * returns a structured list of actions (fill, click, select_option) to execute.
 */

import type { FieldSchema, FillMapping } from './types';
import type { UserProfile } from './profile';
import type { JobMeta } from './types';
import { analyzeFieldsWithOllama } from './ollama-service';
import { getEmbedding, cosineSimilarity, smartMatchDropdown } from './ollama-service';
import { generateFillMappings, resolveIsHispanicLatino } from './autofill';
import { rlSystem } from './learning-rl';

/** Action types matching browser-use's action schema */
export type BrowserUseAction =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'select_option'; selector: string; value: string }
  | { action: 'scroll'; selector?: string }
  | { action: 'wait'; milliseconds?: number };

export interface BrowserUseActionPlan {
  actions: BrowserUseAction[];
  reasoning?: string;
}

/** Default Ollama model - same as browser-use docs (llama3.1:8b or llama3.2) */
const DEFAULT_MODEL = 'llama3.2';

/**
 * Build a browser-use style prompt for the LLM
 * Form state + user profile → list of actions to fill the form
 */
export function buildBrowserUsePrompt(
  schema: FieldSchema[],
  profile: UserProfile,
  jobMeta: JobMeta | null
): string {
  const task = 'Fill out this job application form with the user\'s information. Use ONLY the exact selectors provided. Output a JSON object with an "actions" array.';

  const formState = schema.map((f) => ({
    selector: f.selector,
    label: f.label || f.name || f.id || 'unknown',
    type: f.type || 'text',
    required: f.required,
    currentValue: f.valuePreview || '',
    options: (f as FieldSchema & { options?: string[] }).options,
  }));

  const profileSummary = {
    personal: profile.personal,
    professional: profile.professional,
    workAuth: profile.workAuth,
    selfId: profile.selfId,
    summary: profile.summary?.slice(0, 200),
  };

  return `${task}

## Form fields (use these exact "selector" values in your actions)
${JSON.stringify(formState, null, 2)}

## User profile
${JSON.stringify(profileSummary, null, 2)}

## Job context
${jobMeta ? `Title: ${jobMeta.jobTitle || 'N/A'}, Company: ${jobMeta.company || 'N/A'}` : 'Unknown'}

## Output format
Respond with ONLY a valid JSON object, no markdown or explanation:
{
  "actions": [
    { "action": "fill", "selector": "#first_name", "value": "John" },
    { "action": "fill", "selector": "#last_name", "value": "Doe" },
    { "action": "fill", "selector": "#email", "value": "john@example.com" },
    { "action": "select_option", "selector": "#country", "value": "United States" },
    { "action": "click", "selector": "#submit" }
  ]
}

Allowed actions:
- "fill": { "action": "fill", "selector": "<exact selector>", "value": "<string>" }
- "select_option": { "action": "select_option", "selector": "<exact selector>", "value": "<option text>" }
- "click": { "action": "click", "selector": "<exact selector>" }
- "wait": { "action": "wait", "milliseconds": 500 }

Use ONLY selectors from the form fields list. Generate the "actions" array now:`;
}

/**
 * Generate a list of actions using Ollama (browser-use style)
 * Compatible with Ollama as per https://docs.browser-use.com/supported-models
 */
export async function generateActionsWithOllama(
  schema: FieldSchema[],
  profile: UserProfile,
  jobMeta: JobMeta | null,
  model: string = DEFAULT_MODEL
): Promise<BrowserUseAction[]> {
  const prompt = buildBrowserUsePrompt(schema, profile, jobMeta);

  const response = await analyzeFieldsWithOllama(prompt, model);

  if (!response) {
    return [];
  }

  // Response might be { actions: [...] } or the raw structure from analyzeFieldsWithOllama
  let parsed: BrowserUseAction[] = [];

  if (response && typeof response === 'object') {
    if (Array.isArray((response as BrowserUseActionPlan).actions)) {
      parsed = (response as BrowserUseActionPlan).actions;
    } else if (Array.isArray(response)) {
      parsed = response as BrowserUseAction[];
    } else if ('actions' in response && Array.isArray((response as { actions: unknown }).actions)) {
      parsed = (response as BrowserUseActionPlan).actions;
    }
  }

  // Validate and filter to allowed action types
  const allowed = ['fill', 'click', 'select_option', 'scroll', 'wait'];
  return parsed.filter((a) => a && typeof a === 'object' && 'action' in a && allowed.includes(String(a.action)));
}

/** Profile "slots" for embedding-based matching: label-like text → value */
function buildProfileSlots(profile: UserProfile): Array<{ label: string; value: string | boolean }> {
  const slots: Array<{ label: string; value: string | boolean }> = [];
  slots.push({ label: 'first name given name', value: profile.personal.firstName });
  slots.push({ label: 'last name family name surname', value: profile.personal.lastName });
  slots.push({ label: 'email e-mail', value: profile.personal.email });
  slots.push({ label: 'phone telephone mobile number', value: profile.personal.phone });
  const loc = profile.personal.location || '';
  slots.push({ label: 'city', value: loc.split(',')[0]?.trim() || loc });
  slots.push({ label: 'state province', value: loc.split(',')[1]?.trim() || '' });
  slots.push({ label: 'country', value: loc.split(',')[2]?.trim() || loc });
  slots.push({ label: 'location address', value: loc });
  if (profile.professional?.linkedin) slots.push({ label: 'linkedin profile url', value: profile.professional.linkedin });
  if (profile.professional?.github) slots.push({ label: 'github portfolio url', value: profile.professional.github });
  if (profile.professional?.portfolio) slots.push({ label: 'portfolio website url', value: profile.professional.portfolio });
  if (profile.professional?.yearsOfExperience != null) slots.push({ label: 'years of experience', value: String(profile.professional.yearsOfExperience) });
  if (profile.selfId) {
    if (profile.selfId.gender?.length) slots.push({ label: 'gender identity sex', value: profile.selfId.gender[0] });
    if (profile.selfId.race?.length) slots.push({ label: 'race ethnicity', value: profile.selfId.race[0] });
    // Resolve Hispanic/Latino using the shared negation-safe helper — the stored
    // ethnicity string may be "No, not Hispanic or Latino" (full radio text).
    const _isHispanic = resolveIsHispanicLatino(profile.selfId.ethnicity, profile.selfId.race);
    slots.push({ label: 'hispanic latino ethnicity', value: _isHispanic ? 'Yes' : 'No' });
    slots.push({ label: 'veteran military status', value: profile.selfId.veteran });
    slots.push({ label: 'disability disabled', value: profile.selfId.disability });
    slots.push({ label: 'transgender', value: profile.selfId.transgender });
    if (profile.selfId.orientation?.length) slots.push({ label: 'sexual orientation', value: profile.selfId.orientation[0] });
  }
  if (profile.workAuth) {
    slots.push({ label: 'sponsorship visa work authorization', value: profile.workAuth.requiresSponsorship ? 'Yes' : 'No' });
    if (profile.workAuth.currentStatus) slots.push({ label: 'work authorization status', value: profile.workAuth.currentStatus });
  }
  return slots.filter((s) => s.value !== '' && s.value != null);
}

const EMBEDDING_SIMILARITY_THRESHOLD = 0.45;

/**
 * Get values for all fields: learned corrections first, then rule-based,
 * then embedding-based for the rest.
 * Uses exact selectors from schema so the executor never gets wrong selectors.
 */
export async function getFieldValuesWithEmbeddings(
  schema: FieldSchema[],
  profile: UserProfile
): Promise<FillMapping[]> {
  const mappings = generateFillMappings(schema, profile);
  const bySelector = new Map<string, string | boolean | number>();
  for (const m of mappings) {
    bySelector.set(m.selector, m.value);
  }
  
  // Override rule-based mappings with RL learned corrections (user corrections
  // take priority over profile data). Also fills fields that rule-based
  // matching missed but the user has previously corrected.
  for (const field of schema) {
    if (field.type === 'file' || !field.selector) continue;
    const learned = rlSystem.getLearnedValue(field);
    if (learned) {
      const previousValue = bySelector.get(field.selector);
      if (previousValue !== learned.value) {
        console.log(`[Browser-Use] RL override for "${field.label}": "${previousValue ?? '(empty)'}" → "${learned.value}" (confidence: ${learned.confidence.toFixed(2)})`);
      }
      bySelector.set(field.selector, learned.value);
    }
  }
  
  const unfilled = schema.filter((f) => f.type !== 'file' && f.selector && !bySelector.has(f.selector));
  if (unfilled.length === 0) {
    return Array.from(bySelector.entries()).map(([selector, value]) => ({ selector, value }));
  }

  // Build profile slots AND learned correction slots for embedding matching.
  // Learned slots ensure the embedding pipeline uses user-corrected values
  // (e.g., if user corrected LinkedIn URL, the embedding match returns the
  // corrected URL instead of the original profile value).
  const slots = buildProfileSlots(profile);
  
  // Get high-confidence RL patterns as embedding slots
  const rlPatterns = await rlSystem.getAllPatterns();
  const learnedSlots = rlPatterns
    .filter(p => p.confidence >= 0.6)
    .map(p => ({ label: p.fieldLabel, value: p.learnedValue }));
  for (const ls of learnedSlots) {
    // Check if an existing profile slot covers this label
    const existingIdx = slots.findIndex(s =>
      s.label.toLowerCase().includes(ls.label) || ls.label.includes(s.label.toLowerCase())
    );
    if (existingIdx !== -1) {
      // Override profile slot with learned value (user preferred this)
      console.log(`[Browser-Use] Embedding slot override: "${slots[existingIdx].label}" value "${slots[existingIdx].value}" → "${ls.value}"`);
      slots[existingIdx].value = ls.value;
    } else {
      // Add as new slot so embedding matching can find it
      slots.push({ label: ls.label, value: ls.value });
    }
  }
  
  const slotLabels = slots.map((s) => s.label);
  const slotEmbeddings: (number[] | null)[] = [];
  for (const label of slotLabels) {
    slotEmbeddings.push(await getEmbedding(label));
  }

  for (const field of unfilled) {
    const fieldLabel = [field.label, field.name, field.id].filter(Boolean).join(' ').toLowerCase();
    if (!fieldLabel) continue;
    const fieldEmb = await getEmbedding(fieldLabel);
    if (!fieldEmb) continue;
    let bestSim = EMBEDDING_SIMILARITY_THRESHOLD;
    let bestValue: string | boolean | null = null;
    for (let i = 0; i < slotEmbeddings.length; i++) {
      const se = slotEmbeddings[i];
      if (!se) continue;
      const sim = cosineSimilarity(fieldEmb, se);
      if (sim > bestSim) {
        bestSim = sim;
        bestValue = slots[i].value;
      }
    }
    if (bestValue != null) {
      const fieldWithOptions = field as FieldSchema & { options?: string[] };
      const options = fieldWithOptions.options;
      if (options?.length && typeof bestValue === 'string') {
        const matched = await smartMatchDropdown(field.label || '', options, bestValue, undefined);
        bySelector.set(field.selector, matched ?? bestValue);
      } else {
        bySelector.set(field.selector, bestValue);
      }
    }
  }
  return Array.from(bySelector.entries()).map(([selector, value]) => ({ selector, value }));
}

/**
 * Convert (schema + mappings) to browser-use actions using exact selectors from schema.
 */
export function mappingsToBrowserUseActions(schema: FieldSchema[], mappings: FillMapping[]): BrowserUseAction[] {
  const schemaBySelector = new Map<string, FieldSchema>();
  for (const f of schema) schemaBySelector.set(f.selector, f);
  const actions: BrowserUseAction[] = [];
  for (const m of mappings) {
    const field = schemaBySelector.get(m.selector);
    if (!field || field.type === 'file') continue;
    // Skip duplicate placeholder inputs — same dropdown is the autocomplete field with id/options
    const isPlaceholderDuplicate =
      field.type === 'text' &&
      !field.id &&
      (field.label === 'Select...' ||
       field.label === 'Select' ||
       field.label === 'No options' ||
       field.label?.includes('Decline To Self Identify') || // e.g. "MaleFemaleDecline To Self Identify"
       field.label?.includes('YesNo')); // e.g. "YesNoDecline To Self Identify"
    if (isPlaceholderDuplicate) {
      continue;
    }
    const valueStr = typeof m.value === 'boolean' ? (m.value ? 'true' : 'false') : String(m.value);
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (m.value === true || valueStr.toLowerCase() === 'true' || valueStr === 'checked') {
        actions.push({ action: 'click', selector: m.selector });
      }
      continue;
    }
    const fieldWithOptions = field as FieldSchema & { options?: string[] };
    const hasOptions = Array.isArray(fieldWithOptions.options) && fieldWithOptions.options.length > 0;
    if (
      field.type === 'autocomplete' ||
      field.type === 'select' ||
      field.type === 'select-one' ||
      hasOptions
    ) {
      actions.push({ action: 'select_option', selector: m.selector, value: valueStr });
      continue;
    }
    actions.push({ action: 'fill', selector: m.selector, value: valueStr });
  }
  return actions;
}

/**
 * Full flow: detect fields → embeddings + profile → browser-use actions.
 * Caller executes with executeBrowserUseActions(actions).
 */
export async function buildBrowserUseActionsFromEmbeddings(
  schema: FieldSchema[],
  profile: UserProfile
): Promise<BrowserUseAction[]> {
  const mappings = await getFieldValuesWithEmbeddings(schema, profile);
  return mappingsToBrowserUseActions(schema, mappings);
}
