/**
 * Preference learning engine for job discovery.
 * Tracks search and apply actions, derives weighted preferences
 * to power scheduled background searches.
 */

const SEARCH_HISTORY_KEY = 'job_search_history';
const APPLY_HISTORY_KEY = 'job_apply_history';
const PREFERENCES_KEY = 'job_preferences';
const SEEN_JOB_IDS_KEY = 'seen_job_ids';
const SCHEDULED_RESULTS_KEY = 'scheduled_search_results';
const LAST_SCHEDULED_KEY = 'last_scheduled_search';

const MAX_SEARCH_HISTORY = 50;
const MAX_APPLY_HISTORY = 100;
const MAX_SEEN_IDS = 500;

export interface SearchAction {
  keywords: string;
  location?: string;
  remote?: boolean;
  fullTime?: boolean;
  contract?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  timestamp: number;
}

export interface ApplyAction {
  jobTitle: string;
  company: string;
  location: string;
  category?: string;
  salaryMin?: number;
  salaryMax?: number;
  timestamp: number;
}

export interface LearnedPreferences {
  topKeywords: string[];
  preferredLocations: string[];
  salaryMin?: number;
  salaryMax?: number;
  remoteRatio: number; // 0-1
  fullTimeRatio: number;
  lastUpdated: number;
}

export async function recordSearchAction(action: SearchAction): Promise<void> {
  try {
    const result = await browser.storage.local.get(SEARCH_HISTORY_KEY);
    const history: SearchAction[] = result[SEARCH_HISTORY_KEY] ?? [];
    history.push(action);
    if (history.length > MAX_SEARCH_HISTORY) {
      history.splice(0, history.length - MAX_SEARCH_HISTORY);
    }
    await browser.storage.local.set({ [SEARCH_HISTORY_KEY]: history });
    await recomputePreferences();
  } catch (e) {
    console.error('[Prefs] Failed to record search:', e);
  }
}

export async function recordApplyAction(action: ApplyAction): Promise<void> {
  try {
    const result = await browser.storage.local.get(APPLY_HISTORY_KEY);
    const history: ApplyAction[] = result[APPLY_HISTORY_KEY] ?? [];
    history.push(action);
    if (history.length > MAX_APPLY_HISTORY) {
      history.splice(0, history.length - MAX_APPLY_HISTORY);
    }
    await browser.storage.local.set({ [APPLY_HISTORY_KEY]: history });
    await recomputePreferences();
  } catch (e) {
    console.error('[Prefs] Failed to record apply:', e);
  }
}

/**
 * Tokenize a string into meaningful words, filtering out stop words.
 */
function tokenize(text: string): string[] {
  const stops = new Set([
    'a', 'an', 'the', 'and', 'or', 'in', 'at', 'to', 'for', 'of', 'on',
    'with', 'is', 'are', 'was', 'be', 'by', 'from', 'as', 'it', 'that',
    'this', 'we', 'you', 'our', 'your', 'i', 'my', 'remote', 'job', 'jobs',
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stops.has(w));
}

async function recomputePreferences(): Promise<void> {
  try {
    const data = await browser.storage.local.get([SEARCH_HISTORY_KEY, APPLY_HISTORY_KEY]);
    const searches: SearchAction[] = data[SEARCH_HISTORY_KEY] ?? [];
    const applies: ApplyAction[] = data[APPLY_HISTORY_KEY] ?? [];

    // Keyword frequency (searches weighted 1x, applies weighted 2x)
    const keywordFreq = new Map<string, number>();

    for (const s of searches) {
      for (const token of tokenize(s.keywords)) {
        keywordFreq.set(token, (keywordFreq.get(token) ?? 0) + 1);
      }
    }
    for (const a of applies) {
      for (const token of tokenize(a.jobTitle)) {
        keywordFreq.set(token, (keywordFreq.get(token) ?? 0) + 2);
      }
    }

    const topKeywords = [...keywordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    // Location frequency
    const locationFreq = new Map<string, number>();
    for (const s of searches) {
      if (s.location) locationFreq.set(s.location, (locationFreq.get(s.location) ?? 0) + 1);
    }
    for (const a of applies) {
      if (a.location) locationFreq.set(a.location, (locationFreq.get(a.location) ?? 0) + 2);
    }
    const preferredLocations = [...locationFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([loc]) => loc);

    // Remote ratio
    const remoteSearches = searches.filter(s => s.remote).length;
    const remoteRatio = searches.length > 0 ? remoteSearches / searches.length : 0;

    // Full-time ratio
    const ftSearches = searches.filter(s => s.fullTime).length;
    const fullTimeRatio = searches.length > 0 ? ftSearches / searches.length : 0;

    // Salary range (from applies that have salary data)
    const salaries = applies.filter(a => a.salaryMin || a.salaryMax);
    let salaryMin: number | undefined;
    let salaryMax: number | undefined;
    if (salaries.length > 0) {
      const mins = salaries.filter(a => a.salaryMin).map(a => a.salaryMin!);
      const maxes = salaries.filter(a => a.salaryMax).map(a => a.salaryMax!);
      if (mins.length) salaryMin = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
      if (maxes.length) salaryMax = Math.round(maxes.reduce((a, b) => a + b, 0) / maxes.length);
    }

    const prefs: LearnedPreferences = {
      topKeywords,
      preferredLocations,
      salaryMin,
      salaryMax,
      remoteRatio,
      fullTimeRatio,
      lastUpdated: Date.now(),
    };

    await browser.storage.local.set({ [PREFERENCES_KEY]: prefs });
  } catch (e) {
    console.error('[Prefs] Failed to recompute:', e);
  }
}

export async function getLearnedPreferences(): Promise<LearnedPreferences | null> {
  try {
    const result = await browser.storage.local.get(PREFERENCES_KEY);
    return result[PREFERENCES_KEY] ?? null;
  } catch {
    return null;
  }
}

export async function clearPreferences(): Promise<void> {
  await browser.storage.local.remove([
    SEARCH_HISTORY_KEY,
    APPLY_HISTORY_KEY,
    PREFERENCES_KEY,
  ]);
}

// --- Seen job IDs (for deduplication in scheduled searches) ---

export async function getSeenJobIds(): Promise<Set<string>> {
  try {
    const result = await browser.storage.local.get(SEEN_JOB_IDS_KEY);
    const arr: string[] = result[SEEN_JOB_IDS_KEY] ?? [];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function addSeenJobIds(ids: string[]): Promise<void> {
  const existing = await getSeenJobIds();
  for (const id of ids) existing.add(id);
  const arr = [...existing];
  if (arr.length > MAX_SEEN_IDS) arr.splice(0, arr.length - MAX_SEEN_IDS);
  await browser.storage.local.set({ [SEEN_JOB_IDS_KEY]: arr });
}

// --- Scheduled search results ---

export async function getScheduledResults(): Promise<any[]> {
  try {
    const result = await browser.storage.local.get(SCHEDULED_RESULTS_KEY);
    return result[SCHEDULED_RESULTS_KEY] ?? [];
  } catch {
    return [];
  }
}

export async function setScheduledResults(jobs: any[]): Promise<void> {
  await browser.storage.local.set({ [SCHEDULED_RESULTS_KEY]: jobs });
}

export async function clearScheduledResults(): Promise<void> {
  await browser.storage.local.remove(SCHEDULED_RESULTS_KEY);
}

export async function getLastScheduledSearch(): Promise<number | null> {
  try {
    const result = await browser.storage.local.get(LAST_SCHEDULED_KEY);
    return result[LAST_SCHEDULED_KEY] ?? null;
  } catch {
    return null;
  }
}

export async function setLastScheduledSearch(ts: number): Promise<void> {
  await browser.storage.local.set({ [LAST_SCHEDULED_KEY]: ts });
}
