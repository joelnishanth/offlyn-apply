/**
 * Job search API service using Adzuna.
 * Free tier: 250 requests/day, covers US/UK/EU/AU/IN.
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
}

export interface JobSearchResult {
  jobs: JobListing[];
  totalResults: number;
  page: number;
  totalPages: number;
}

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID ?? 'ad50e38e';
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY ?? '';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, { data: JobSearchResult; ts: number }>();

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

export async function searchJobs(filters: JobSearchFilters): Promise<JobSearchResult> {
  const cacheKey = JSON.stringify(filters);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = buildAdzunaUrl(filters);

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return generateMockResults(filters);
    }

    const data = await response.json();
    const result: JobSearchResult = {
      jobs: (data.results ?? []).map(normalizeAdzunaResult),
      totalResults: data.count ?? 0,
      page: filters.page ?? 1,
      totalPages: Math.ceil((data.count ?? 0) / (filters.resultsPerPage ?? 10)),
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch {
    return generateMockResults(filters);
  }
}

function generateMockResults(filters: JobSearchFilters): JobSearchResult {
  const mockJobs: JobListing[] = [
    {
      id: 'mock_1',
      title: `Senior ${filters.keywords || 'Software'} Engineer`,
      company: 'TechCorp Inc.',
      location: filters.location || 'San Francisco, CA',
      description: `We are looking for an experienced ${filters.keywords || 'software'} engineer to join our team. You will work on building scalable systems and leading technical initiatives.`,
      salaryMin: 120000,
      salaryMax: 180000,
      salaryCurrency: 'USD',
      url: 'https://example.com/job/1',
      postedDate: new Date(Date.now() - 86400000).toISOString(),
      source: 'mock',
      category: 'IT Jobs',
    },
    {
      id: 'mock_2',
      title: `${filters.keywords || 'Software'} Developer`,
      company: 'StartupAI',
      location: filters.location || 'New York, NY',
      description: `Join our fast-growing startup as a ${filters.keywords || 'software'} developer. Work with cutting-edge AI technologies.`,
      salaryMin: 90000,
      salaryMax: 140000,
      salaryCurrency: 'USD',
      url: 'https://example.com/job/2',
      postedDate: new Date(Date.now() - 172800000).toISOString(),
      source: 'mock',
      category: 'IT Jobs',
    },
    {
      id: 'mock_3',
      title: `Lead ${filters.keywords || 'Software'} Architect`,
      company: 'Enterprise Solutions Ltd',
      location: filters.location || 'Remote',
      description: `Design and implement enterprise-scale ${filters.keywords || 'software'} systems. Lead a team of 8 engineers.`,
      salaryMin: 150000,
      salaryMax: 220000,
      salaryCurrency: 'USD',
      url: 'https://example.com/job/3',
      postedDate: new Date(Date.now() - 259200000).toISOString(),
      source: 'mock',
      category: 'IT Jobs',
    },
    {
      id: 'mock_4',
      title: `Junior ${filters.keywords || 'Software'} Engineer`,
      company: 'DevHub',
      location: filters.location || 'Austin, TX',
      description: `Great opportunity for a junior ${filters.keywords || 'software'} engineer. Mentorship program and growth path included.`,
      salaryMin: 70000,
      salaryMax: 100000,
      salaryCurrency: 'USD',
      url: 'https://example.com/job/4',
      postedDate: new Date(Date.now() - 345600000).toISOString(),
      source: 'mock',
      category: 'IT Jobs',
    },
    {
      id: 'mock_5',
      title: `${filters.keywords || 'Software'} Engineering Manager`,
      company: 'GlobalTech',
      location: filters.location || 'Seattle, WA',
      description: `Manage a distributed team building ${filters.keywords || 'software'} products used by millions.`,
      salaryMin: 160000,
      salaryMax: 230000,
      salaryCurrency: 'USD',
      url: 'https://example.com/job/5',
      postedDate: new Date(Date.now() - 432000000).toISOString(),
      source: 'mock',
      category: 'IT Jobs',
    },
  ];

  return {
    jobs: mockJobs,
    totalResults: mockJobs.length,
    page: 1,
    totalPages: 1,
  };
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
