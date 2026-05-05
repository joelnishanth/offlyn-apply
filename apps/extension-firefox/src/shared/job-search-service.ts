/**
 * Job search API service — aggregates Adzuna, Remotive, and Arbeitnow.
 * Adzuna free tier: 250 req/day. Remotive and Arbeitnow: no key required.
 */

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  url: string;
  directUrl?: string;
  postedDate: string;
  source: string;
  category?: string;
}

export interface JobSearchFilters {
  keywords: string;
  location?: string;
  remote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  daysPosted?: number;
  page?: number;
  resultsPerPage?: number;
  country?: string;
  sortBy?: 'default' | 'date' | 'salary' | 'relevance' | 'hybrid';
  fullTime?: boolean;
  partTime?: boolean;
  permanent?: boolean;
  contract?: boolean;
}

export interface JobSearchResult {
  jobs: JobListing[];
  totalResults: number;
  page: number;
  totalPages: number;
}

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID ?? 'ad50e38e';
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY ?? '';

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes (up from 5)
const cache = new Map<string, { data: JobSearchResult; ts: number }>();

/* ── Adzuna ─────────────────────────────────────────────────── */

function buildAdzunaUrl(filters: JobSearchFilters): string {
  const country = filters.country ?? 'us';
  const page = filters.page ?? 1;
  const base = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`;

  const params = new URLSearchParams();
  if (ADZUNA_APP_ID) params.set('app_id', ADZUNA_APP_ID);
  if (ADZUNA_APP_KEY) params.set('app_key', ADZUNA_APP_KEY);
  if (filters.keywords) params.set('what', filters.keywords);
  if (filters.location) params.set('where', filters.location);
  if (filters.salaryMin) params.set('salary_min', String(filters.salaryMin));
  if (filters.salaryMax) params.set('salary_max', String(filters.salaryMax));
  if (filters.daysPosted) params.set('max_days_old', String(filters.daysPosted));
  if (filters.resultsPerPage) params.set('results_per_page', String(filters.resultsPerPage));
  if (filters.sortBy && filters.sortBy !== 'default') params.set('sort_by', filters.sortBy);
  if (filters.fullTime) params.set('full_time', '1');
  if (filters.partTime) params.set('part_time', '1');
  if (filters.permanent) params.set('permanent', '1');
  if (filters.contract) params.set('contract', '1');
  params.set('content-type', 'application/json');

  return `${base}?${params.toString()}`;
}

function normalizeAdzunaResult(raw: any): JobListing {
  return {
    id: raw.id?.toString() ?? `adzuna_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    title: raw.title ?? 'Untitled',
    company: raw.company?.display_name ?? 'Unknown Company',
    location: raw.location?.display_name ?? raw.location?.area?.join(', ') ?? '',
    description: raw.description ?? '',
    salaryMin: raw.salary_min ?? undefined,
    salaryMax: raw.salary_max ?? undefined,
    salaryCurrency: raw.salary_is_predicted !== undefined ? 'USD' : undefined,
    url: raw.redirect_url ?? raw.adref ?? '#',
    directUrl: undefined,
    postedDate: raw.created ?? new Date().toISOString(),
    source: 'adzuna',
    category: raw.category?.label ?? undefined,
  };
}

async function fetchAdzuna(filters: JobSearchFilters): Promise<{ jobs: JobListing[]; count: number }> {
  try {
    const url = buildAdzunaUrl(filters);
    const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!response.ok) return { jobs: [], count: 0 };
    const data = await response.json();
    return { jobs: (data.results ?? []).map(normalizeAdzunaResult), count: data.count ?? 0 };
  } catch { return { jobs: [], count: 0 }; }
}

/* ── Remotive (free, no API key, remote-focused) ──────────── */

async function fetchRemotive(filters: JobSearchFilters): Promise<JobListing[]> {
  try {
    const params = new URLSearchParams();
    if (filters.keywords) params.set('search', filters.keywords);
    params.set('limit', String(filters.resultsPerPage ?? 20));
    const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs ?? []).slice(0, filters.resultsPerPage ?? 20).map((raw: any): JobListing => ({
      id: `remotive_${raw.id ?? Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: raw.title ?? 'Untitled',
      company: raw.company_name ?? 'Unknown Company',
      location: raw.candidate_required_location ?? 'Remote',
      description: (raw.description ?? '').replace(/<[^>]*>/g, '').slice(0, 500),
      salaryMin: undefined,
      salaryMax: undefined,
      url: raw.url ?? '#',
      postedDate: raw.publication_date ?? new Date().toISOString(),
      source: 'remotive',
      category: raw.category ?? undefined,
    }));
  } catch { return []; }
}

/* ── Arbeitnow (free, no API key, broad international) ────── */

async function fetchArbeitnow(filters: JobSearchFilters): Promise<JobListing[]> {
  try {
    const params = new URLSearchParams();
    if (filters.keywords) params.set('search', filters.keywords);
    if (filters.location) params.set('location', filters.location);
    const res = await fetch(`https://www.arbeitnow.com/api/job-board-api?${params}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data ?? []).slice(0, filters.resultsPerPage ?? 20).map((raw: any): JobListing => ({
      id: `arbeitnow_${raw.slug ?? Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: raw.title ?? 'Untitled',
      company: raw.company_name ?? 'Unknown Company',
      location: raw.location ?? '',
      description: (raw.description ?? '').replace(/<[^>]*>/g, '').slice(0, 500),
      salaryMin: undefined,
      salaryMax: undefined,
      url: raw.url ?? '#',
      postedDate: raw.created_at ? new Date(raw.created_at * 1000).toISOString() : new Date().toISOString(),
      source: 'arbeitnow',
      category: raw.tags?.join(', ') ?? undefined,
    }));
  } catch { return []; }
}

/* ── Location relevance filter ───────────────────────────── */

const US_STATES: Record<string, string> = {
  'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California',
  'CO':'Colorado','CT':'Connecticut','DE':'Delaware','FL':'Florida','GA':'Georgia',
  'HI':'Hawaii','ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa',
  'KS':'Kansas','KY':'Kentucky','LA':'Louisiana','ME':'Maine','MD':'Maryland',
  'MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi',
  'MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire',
  'NJ':'New Jersey','NM':'New Mexico','NY':'New York','NC':'North Carolina',
  'ND':'North Dakota','OH':'Ohio','OK':'Oklahoma','OR':'Oregon','PA':'Pennsylvania',
  'RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota','TN':'Tennessee',
  'TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington',
  'WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','DC':'District of Columbia',
};

function isLocationRelevant(jobLocation: string, searchLocation: string): boolean {
  if (!searchLocation) return true;
  const jobLoc = jobLocation.toLowerCase().trim();
  const searchLoc = searchLocation.toLowerCase().trim();

  if (!jobLoc) return false;
  if (jobLoc.includes('remote') || jobLoc.includes('anywhere')) return true;

  const searchTokens = searchLoc.split(/[,\s]+/).filter(t => t.length > 1);
  const matchCount = searchTokens.filter(token => jobLoc.includes(token)).length;
  if (matchCount > 0) return true;

  // Expand state abbreviations: "CA" -> also match "California"
  for (const token of searchTokens) {
    const expanded = US_STATES[token.toUpperCase()];
    if (expanded && jobLoc.includes(expanded.toLowerCase())) return true;
  }
  // Check if search has full state name and job has abbreviation
  for (const [abbr, full] of Object.entries(US_STATES)) {
    if (searchLoc.includes(full.toLowerCase()) && jobLoc.includes(abbr.toLowerCase())) return true;
  }

  // If search looks like a US location, reject non-US jobs
  const isUSSearch = searchTokens.some(t =>
    US_STATES[t.toUpperCase()] || Object.values(US_STATES).some(s => s.toLowerCase() === t)
  );
  if (isUSSearch) return false;

  return false;
}

/* ── Deduplication ────────────────────────────────────────── */

function deduplicateJobs(jobs: JobListing[]): JobListing[] {
  const seen = new Set<string>();
  return jobs.filter(job => {
    const key = `${job.title.toLowerCase().trim()}|${job.company.toLowerCase().trim()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ── Main search (parallel multi-API) ────────────────────── */

export async function searchJobs(filters: JobSearchFilters): Promise<JobSearchResult> {
  const cacheKey = JSON.stringify(filters);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const [adzunaResult, remotiveResult, arbeitnowResult] = await Promise.allSettled([
    fetchAdzuna(filters),
    fetchRemotive(filters),
    fetchArbeitnow(filters),
  ]);

  const adzuna = adzunaResult.status === 'fulfilled' ? adzunaResult.value : { jobs: [], count: 0 };
  const remotive = remotiveResult.status === 'fulfilled' ? remotiveResult.value : [];
  const arbeitnow = arbeitnowResult.status === 'fulfilled' ? arbeitnowResult.value : [];

  const locationFiltered = filters.location
    ? [...adzuna.jobs, ...remotive.filter(j => isLocationRelevant(j.location, filters.location!)), ...arbeitnow.filter(j => isLocationRelevant(j.location, filters.location!))]
    : [...adzuna.jobs, ...remotive, ...arbeitnow];
  const allJobs = deduplicateJobs(locationFiltered);

  if (allJobs.length === 0) {
    const emptyResult: JobSearchResult = {
      jobs: [],
      totalResults: 0,
      page: filters.page ?? 1,
      totalPages: 0,
    };
    cache.set(cacheKey, { data: emptyResult, ts: Date.now() });
    return emptyResult;
  }

  const result: JobSearchResult = {
    jobs: allJobs,
    totalResults: allJobs.length,
    page: filters.page ?? 1,
    totalPages: 1,
  };

  cache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

export function computeCompatibilityScore(
  job: JobListing,
  profileSkills: string[],
  profileYears?: number,
): number {
  if (!profileSkills.length) return 50;

  const text = `${job.title} ${job.description}`.toLowerCase();
  let matched = 0;
  for (const skill of profileSkills) {
    if (text.includes(skill.toLowerCase())) matched++;
  }
  const skillScore = (matched / Math.max(profileSkills.length, 1)) * 100;

  let levelScore = 50;
  if (profileYears !== undefined) {
    const isSenior = text.includes('senior') || text.includes('lead') || text.includes('staff');
    const isJunior = text.includes('junior') || text.includes('entry') || text.includes('associate');
    if (isSenior && profileYears >= 5) levelScore = 90;
    else if (isSenior && profileYears < 3) levelScore = 20;
    else if (isJunior && profileYears <= 3) levelScore = 90;
    else if (isJunior && profileYears > 5) levelScore = 30;
    else levelScore = 60;
  }

  return Math.round(skillScore * 0.7 + levelScore * 0.3);
}
