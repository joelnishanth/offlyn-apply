/**
 * Job application de-duplication and generic-entry filtering.
 * Extracted here so background.ts stays thin and these pure helpers are testable.
 */

// ── Generic entry blocklist ───────────────────────────────────────────────────

/**
 * Job titles that are actually confirmation-page headings, apply-button labels,
 * or listing-page artifacts rather than real job titles.
 */
export const GENERIC_JOB_TITLES = new Set([
  'apply for this job',
  'apply now',
  'apply to this job',
  'apply to this position',
  'submit application',
  'submit your application',
  'job application',
  'application form',
  'apply',
  'apply here',
  'apply today',
  'apply online',
  'apply for this position',
  'apply for this role',
  'apply for job',
  'quick apply',
  // Confirmation / thank-you page artifacts
  'confirmation',
  'submitted',
  'success',
  'thank you',
  'thanks',
  'congratulations',
  'congrats',
  'done',
  'application confirmed',
  'successfully submitted',
  'application complete',
  'application received',
  'application submitted',
]);

/**
 * Company names that are ATS provider names or generic career-page hostnames
 * rather than actual employer names.
 */
export const GENERIC_COMPANY_NAMES = new Set([
  'job-boards',
  'job boards',
  'jobs',
  'careers',
  'jobboard',
  'job board',
  'career',
  'hiring',
  'recruiter',
  'recruitment',
  'talent',
  'hr',
  'human resources',
  'greenhouse',
  'lever',
  'workday',
  'ashby',
  'bamboohr',
  'icims',
  'smartrecruiters',
  'taleo',
  'boards',
]);

/**
 * Returns true if the job title or company name looks like a generic
 * listing-page artifact rather than a real application entry.
 */
export function isGenericJobEntry(jobTitle: string, company: string): boolean {
  const titleNorm = jobTitle.trim().toLowerCase();
  const companyNorm = company.trim().toLowerCase();
  return GENERIC_JOB_TITLES.has(titleNorm) || GENERIC_COMPANY_NAMES.has(companyNorm);
}

// ── Deduplication ─────────────────────────────────────────────────────────────

const recentSubmitKeys = new Map<string, number>();

/** Milliseconds within which a second SUBMIT_ATTEMPT for the same key is suppressed. */
export const SUBMIT_DEDUP_WINDOW_MS = 60_000;

/**
 * Returns true (and suppresses) when the same company+title combination was
 * already recorded within the dedup window.
 * The first call for a given key always returns false and stamps a timestamp.
 * Call `resetDedupState()` between test runs.
 */
export function isDuplicateSubmit(company: string, jobTitle: string): boolean {
  const key = `${company.trim().toLowerCase()}|${jobTitle.trim().toLowerCase()}`;
  const lastSeen = recentSubmitKeys.get(key);
  if (lastSeen && Date.now() - lastSeen < SUBMIT_DEDUP_WINDOW_MS) {
    return true;
  }
  recentSubmitKeys.set(key, Date.now());
  // Evict stale entries to prevent unbounded growth
  const cutoff = Date.now() - SUBMIT_DEDUP_WINDOW_MS;
  for (const [k, ts] of recentSubmitKeys) {
    if (ts < cutoff) recentSubmitKeys.delete(k);
  }
  return false;
}

/** Reset in-memory dedup state. Call between independent test cases. */
export function resetDedupState(): void {
  recentSubmitKeys.clear();
}
