/**
 * Job Discovery page logic — searches jobs via background,
 * renders results with compatibility scores, and manages bookmarks.
 */

import browser from '../shared/browser-compat';
import { getUserProfile } from '../shared/profile';
import { setHTML } from '../shared/html';
import type { JobListing, JobSearchResult } from '../shared/job-search-service';
import { computeCompatibilityScore } from '../shared/job-search-service';

interface SavedJob extends JobListing {
  savedAt: number;
}

const SAVED_JOBS_KEY = 'savedJobs';

let currentResults: JobListing[] = [];
let savedJobIds = new Set<string>();
let activeTab: 'results' | 'saved' = 'results';

/* ------------------------------------------------------------------ */
/*  Autocomplete data                                                  */
/* ------------------------------------------------------------------ */

const JOB_TITLES: string[] = [
  'Software Engineer', 'Senior Software Engineer', 'Staff Software Engineer',
  'Frontend Developer', 'Backend Developer', 'Full Stack Developer',
  'DevOps Engineer', 'Site Reliability Engineer', 'Cloud Engineer',
  'Data Scientist', 'Data Engineer', 'Data Analyst',
  'Machine Learning Engineer', 'AI Engineer', 'ML Ops Engineer',
  'Product Manager', 'Technical Product Manager', 'Program Manager',
  'Project Manager', 'Scrum Master', 'Agile Coach',
  'UX Designer', 'UI Designer', 'Product Designer', 'Graphic Designer',
  'QA Engineer', 'Test Engineer', 'SDET',
  'Security Engineer', 'Cybersecurity Analyst', 'Penetration Tester',
  'Solutions Architect', 'Cloud Architect', 'Enterprise Architect',
  'Database Administrator', 'System Administrator', 'Network Engineer',
  'Technical Writer', 'Content Strategist',
  'Mobile Developer', 'iOS Developer', 'Android Developer',
  'React Developer', 'Angular Developer', 'Vue Developer',
  'Python Developer', 'Java Developer', 'Go Developer', 'Rust Developer',
  'Kubernetes Engineer', 'Platform Engineer', 'Infrastructure Engineer',
  'Business Analyst', 'Systems Analyst', 'Business Intelligence Analyst',
  'Sales Engineer', 'Customer Success Manager', 'Account Executive',
  'Marketing Manager', 'Growth Engineer', 'SEO Specialist',
  'Engineering Manager', 'VP of Engineering', 'CTO',
  'IT Manager', 'IT Support Specialist', 'Help Desk Technician',
  'Blockchain Developer', 'Web3 Engineer',
  'Embedded Systems Engineer', 'Firmware Engineer', 'Hardware Engineer',
  'Operations Manager', 'Supply Chain Analyst', 'Logistics Coordinator',
  'Financial Analyst', 'Accountant', 'Controller',
  'Human Resources Manager', 'Recruiter', 'Talent Acquisition',
  'Legal Counsel', 'Compliance Officer', 'Paralegal',
  'Nurse', 'Physician', 'Pharmacist', 'Medical Assistant',
  'Teacher', 'Professor', 'Instructional Designer',
  'Mechanical Engineer', 'Electrical Engineer', 'Civil Engineer', 'Chemical Engineer',
  'Research Scientist', 'Lab Technician',
  'Warehouse Associate', 'Delivery Driver', 'Forklift Operator',
];

const US_LOCATIONS: string[] = [
  'Remote',
  'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX',
  'Phoenix, AZ', 'Philadelphia, PA', 'San Antonio, TX', 'San Diego, CA',
  'Dallas, TX', 'San Jose, CA', 'Austin, TX', 'Jacksonville, FL',
  'Fort Worth, TX', 'Columbus, OH', 'Charlotte, NC', 'Indianapolis, IN',
  'San Francisco, CA', 'Seattle, WA', 'Denver, CO', 'Nashville, TN',
  'Washington, DC', 'Oklahoma City, OK', 'El Paso, TX', 'Boston, MA',
  'Portland, OR', 'Las Vegas, NV', 'Memphis, TN', 'Louisville, KY',
  'Baltimore, MD', 'Milwaukee, WI', 'Albuquerque, NM', 'Tucson, AZ',
  'Fresno, CA', 'Mesa, AZ', 'Sacramento, CA', 'Atlanta, GA',
  'Kansas City, MO', 'Colorado Springs, CO', 'Omaha, NE', 'Raleigh, NC',
  'Miami, FL', 'Minneapolis, MN', 'Tampa, FL', 'New Orleans, LA',
  'Cleveland, OH', 'Pittsburgh, PA', 'Cincinnati, OH', 'St. Louis, MO',
  'Orlando, FL', 'Salt Lake City, UT', 'Detroit, MI', 'Honolulu, HI',
  'Palo Alto, CA', 'Mountain View, CA', 'Sunnyvale, CA', 'Cupertino, CA',
  'Redmond, WA', 'Bellevue, WA', 'Irvine, CA', 'Santa Monica, CA',
  'Boulder, CO', 'Ann Arbor, MI', 'Madison, WI', 'Durham, NC',
  'Cambridge, MA', 'Scottsdale, AZ', 'Plano, TX', 'Irving, TX',
  'Arlington, VA', 'Tysons, VA', 'Herndon, VA', 'Bethesda, MD',
  'Silicon Valley, CA', 'Bay Area, CA', 'Research Triangle, NC',
  'California', 'Texas', 'New York', 'Florida', 'Washington',
  'Massachusetts', 'Colorado', 'Illinois', 'Georgia', 'Virginia',
  'North Carolina', 'Pennsylvania', 'Ohio', 'Oregon', 'Arizona',
];

/* ------------------------------------------------------------------ */
/*  Utility helpers                                                    */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatSalary(min?: number, max?: number, currency?: string): string {
  if (!min && !max) return '';
  const fmt = (n: number) => {
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  };
  const c = currency ?? 'USD';
  if (min && max) return `$${fmt(min)} - $${fmt(max)} ${c}`;
  if (min) return `$${fmt(min)}+ ${c}`;
  return `Up to $${fmt(max!)} ${c}`;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/* ------------------------------------------------------------------ */
/*  Autocomplete engine                                                */
/* ------------------------------------------------------------------ */

function setupAutocomplete(
  inputId: string,
  dropdownId: string,
  items: string[],
): void {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const dropdown = document.getElementById(dropdownId) as HTMLElement;
  if (!input || !dropdown) return;

  let highlighted = -1;
  let filtered: string[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function highlightMatch(text: string, query: string): string {
    if (!query) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return escapeHtml(text);
    const before = escapeHtml(text.slice(0, idx));
    const match = escapeHtml(text.slice(idx, idx + query.length));
    const after = escapeHtml(text.slice(idx + query.length));
    return `${before}<mark>${match}</mark>${after}`;
  }

  function render(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) { close(); return; }

    filtered = items.filter(item => item.toLowerCase().includes(q)).slice(0, 8);
    if (filtered.length === 0) { close(); return; }

    const exactMatch = filtered.length === 1 && filtered[0].toLowerCase() === q;
    if (exactMatch) { close(); return; }

    highlighted = -1;
    dropdown.innerHTML = filtered.map((item, i) =>
      `<div class="ac-option" data-index="${i}">${highlightMatch(item, query.trim())}</div>`
    ).join('');
    dropdown.classList.add('open');
  }

  function close(): void {
    dropdown.classList.remove('open');
    highlighted = -1;
    filtered = [];
  }

  function select(value: string): void {
    input.value = value;
    close();
    input.focus();
  }

  input.addEventListener('input', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => render(input.value), 80);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) render(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('open')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, filtered.length - 1);
      updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      updateHighlight();
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      select(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });

  function updateHighlight(): void {
    dropdown.querySelectorAll('.ac-option').forEach((el, i) => {
      el.classList.toggle('highlighted', i === highlighted);
    });
    const active = dropdown.querySelector('.highlighted');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  dropdown.addEventListener('mousedown', (e) => {
    e.preventDefault(); // keep focus on input
    const target = (e.target as HTMLElement).closest('.ac-option') as HTMLElement;
    if (!target) return;
    const idx = parseInt(target.dataset.index ?? '-1', 10);
    if (idx >= 0 && idx < filtered.length) select(filtered[idx]);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
      close();
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Filter pill toggle behavior                                        */
/* ------------------------------------------------------------------ */

function setupFilterPills(): void {
  document.querySelectorAll<HTMLLabelElement>('.filter-pill').forEach(pill => {
    const cb = pill.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (!cb) return;
    cb.addEventListener('change', () => {
      pill.classList.toggle('active', cb.checked);
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Saved jobs                                                         */
/* ------------------------------------------------------------------ */

async function getSavedJobs(): Promise<SavedJob[]> {
  try {
    const result = await browser.storage.local.get(SAVED_JOBS_KEY);
    return result[SAVED_JOBS_KEY] ?? [];
  } catch { return []; }
}

async function saveJob(job: JobListing): Promise<void> {
  const saved = await getSavedJobs();
  if (saved.some(j => j.id === job.id)) return;
  saved.push({ ...job, savedAt: Date.now() });
  await browser.storage.local.set({ [SAVED_JOBS_KEY]: saved });
  savedJobIds.add(job.id);
}

async function unsaveJob(jobId: string): Promise<void> {
  const saved = await getSavedJobs();
  const filtered = saved.filter(j => j.id !== jobId);
  await browser.storage.local.set({ [SAVED_JOBS_KEY]: filtered });
  savedJobIds.delete(jobId);
}

async function loadSavedIds(): Promise<void> {
  const saved = await getSavedJobs();
  savedJobIds = new Set(saved.map(j => j.id));
}

/* ------------------------------------------------------------------ */
/*  Job card rendering                                                 */
/* ------------------------------------------------------------------ */

function companyNameToDomain(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('');
  return cleaned ? `${cleaned}.com` : '';
}

function getLogoUrl(job: JobListing): string {
  const domain = companyNameToDomain(job.company);
  if (!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}


function renderJobCard(job: JobListing, score: number): string {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-medium' : 'score-low';
  const isSaved = savedJobIds.has(job.id);
  const logoUrl = getLogoUrl(job);
  const monogramUrl = chrome.runtime.getURL('icons/monogram-icon.png');

  return `
    <div class="job-card" data-job-id="${escapeHtml(job.id)}">
      <div class="job-card-header">
        <div class="job-card-logo-wrap">
          ${logoUrl
            ? `<img class="job-card-logo" src="${escapeHtml(logoUrl)}" alt="" data-fallback="1">`
            : ''}
          <div class="job-card-logo-fallback" ${logoUrl ? 'style="display:none"' : ''}>
            <img src="${escapeHtml(monogramUrl)}" alt="Offlyn" class="job-card-logo-monogram">
          </div>
        </div>
        <div class="job-card-info">
          <div class="job-card-title">${escapeHtml(job.title)}</div>
          <div class="job-card-company">${escapeHtml(job.company)}</div>
          <div class="job-card-location">${escapeHtml(job.location)}</div>
        </div>
        <div class="job-card-score ${scoreClass}">${score}%</div>
      </div>
      ${salary ? `<div class="job-card-salary">${escapeHtml(salary)}</div>` : ''}
      <div class="job-card-desc">${escapeHtml(job.description)}</div>
      <div class="job-card-footer">
        <button class="btn-apply" data-apply-url="${escapeHtml(job.url)}">Apply</button>
        <button class="btn-save ${isSaved ? 'saved' : ''}" data-save-id="${escapeHtml(job.id)}">
          ${isSaved ? 'Saved' : 'Save'}
        </button>
      </div>
      <div class="job-card-date">${relativeDate(job.postedDate)} &middot; ${escapeHtml(job.source)}</div>
    </div>
  `;
}

async function renderResults(): Promise<void> {
  const profile = await getUserProfile();
  const skills = profile?.skills ?? [];
  const years = profile?.professional?.yearsOfExperience;

  const grid = document.getElementById('jobs-grid')!;
  const savedGrid = document.getElementById('saved-grid')!;

  if (activeTab === 'results') {
    grid.style.display = '';
    savedGrid.style.display = 'none';

    if (currentResults.length === 0) {
      setHTML(grid, '<div class="empty-state"><h3>No results</h3><p>Try different keywords or location.</p></div>');
    } else {
      const cards = currentResults.map(job => {
        const score = computeCompatibilityScore(job, skills, years);
        return renderJobCard(job, score);
      });
      setHTML(grid, cards.join(''));
    }
    bindSaveButtons(grid);
    bindLogoFallbacks(grid);
    bindApplyButtons(grid);
  } else {
    grid.style.display = 'none';
    savedGrid.style.display = '';

    const saved = await getSavedJobs();
    if (saved.length === 0) {
      setHTML(savedGrid, '<div class="empty-state"><h3>No saved jobs</h3><p>Save jobs from search results.</p></div>');
    } else {
      const cards = saved.map(job => {
        const score = computeCompatibilityScore(job, skills, years);
        return renderJobCard(job, score);
      });
      setHTML(savedGrid, cards.join(''));
    }
    bindSaveButtons(savedGrid);
    bindLogoFallbacks(savedGrid);
    bindApplyButtons(savedGrid);
  }
}

function bindLogoFallbacks(container: HTMLElement): void {
  container.querySelectorAll<HTMLImageElement>('img[data-fallback]').forEach(img => {
    const showMonogram = () => {
      img.style.display = 'none';
      const fallback = img.nextElementSibling as HTMLElement | null;
      if (fallback) fallback.style.display = 'flex';
    };
    img.addEventListener('error', showMonogram);
    if (img.complete) {
      if (img.naturalWidth === 0 || img.naturalWidth <= 16) showMonogram();
    } else {
      img.addEventListener('load', () => {
        if (img.naturalWidth <= 16) showMonogram();
      });
    }
  });
}

function bindApplyButtons(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('button.btn-apply').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rawUrl = btn.dataset.applyUrl ?? '#';
      if (!rawUrl || rawUrl === '#') return;
      btn.disabled = true;
      btn.textContent = 'Opening…';

      // Record apply action for preference learning
      const card = btn.closest('.job-card');
      if (card) {
        const jobId = card.getAttribute('data-job-id') ?? '';
        const job = currentResults.find(j => j.id === jobId);
        if (job) {
          browser.runtime.sendMessage({
            kind: 'RECORD_APPLY_ACTION',
            action: {
              jobTitle: job.title,
              company: job.company,
              location: job.location,
              category: job.category,
              salaryMin: job.salaryMin,
              salaryMax: job.salaryMax,
              timestamp: Date.now(),
            },
          }).catch(() => {});
        }
      }

      try {
        let finalUrl = rawUrl;
        if (rawUrl.includes('adzuna.com')) {
          const res = await chrome.runtime.sendMessage({ kind: 'RESOLVE_JOB_URL', url: rawUrl }) as { url?: string } | undefined;
          finalUrl = res?.url && res.url !== rawUrl ? res.url : rawUrl;
        }
        chrome.tabs.create({ url: finalUrl });
      } catch {
        chrome.tabs.create({ url: rawUrl });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Apply';
      }
    });
  });
}

function bindSaveButtons(container: HTMLElement): void {
  container.querySelectorAll('[data-save-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = (btn as HTMLElement).dataset.saveId!;
      if (savedJobIds.has(id)) {
        await unsaveJob(id);
      } else {
        const job = currentResults.find(j => j.id === id) || (await getSavedJobs()).find(j => j.id === id);
        if (job) await saveJob(job);
      }
      await renderResults();
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

function gatherFilters() {
  const keywords = (document.getElementById('search-keywords') as HTMLInputElement).value.trim();
  const location = (document.getElementById('search-location') as HTMLInputElement).value.trim();
  const daysStr = (document.getElementById('search-days') as HTMLSelectElement).value;
  const remote = (document.getElementById('search-remote') as HTMLInputElement).checked;
  const sortBy = (document.getElementById('search-sort') as HTMLSelectElement).value;
  const salaryMinStr = (document.getElementById('salary-min') as HTMLInputElement).value.trim();
  const salaryMaxStr = (document.getElementById('salary-max') as HTMLInputElement).value.trim();
  const fullTime = (document.getElementById('search-fulltime') as HTMLInputElement).checked;
  const contract = (document.getElementById('search-contract') as HTMLInputElement).checked;

  return { keywords, location, daysStr, remote, sortBy, salaryMinStr, salaryMaxStr, fullTime, contract };
}

async function doSearch(): Promise<void> {
  const { keywords, location, daysStr, remote, sortBy, salaryMinStr, salaryMaxStr, fullTime, contract } = gatherFilters();

  if (!keywords) return;

  const loading = document.getElementById('loading')!;
  const emptyState = document.getElementById('empty-state')!;
  const grid = document.getElementById('jobs-grid')!;
  const resultsInfo = document.getElementById('results-info')!;

  emptyState.style.display = 'none';
  grid.style.display = 'none';
  loading.style.display = '';

  try {
    const filters: Record<string, any> = {
      keywords: remote ? `${keywords} remote` : keywords,
      location: location || undefined,
      daysPosted: daysStr ? parseInt(daysStr, 10) : undefined,
      resultsPerPage: 20,
    };

    if (sortBy && sortBy !== 'default' && sortBy !== 'compatibility') filters.sortBy = sortBy;
    if (salaryMinStr) filters.salaryMin = parseInt(salaryMinStr, 10);
    if (salaryMaxStr) filters.salaryMax = parseInt(salaryMaxStr, 10);
    if (fullTime) filters.fullTime = true;
    if (contract) filters.contract = true;

    const response = await browser.runtime.sendMessage({
      kind: 'SEARCH_JOBS',
      filters,
    });

    if (response?.kind === 'SEARCH_JOBS_RESULT' && response.result) {
      const result = response.result as JobSearchResult;
      currentResults = result.jobs;

      if (sortBy === 'compatibility') {
        const profile = await getUserProfile();
        const skills = profile?.skills ?? [];
        const years = profile?.professional?.yearsOfExperience;
        currentResults.sort((a, b) =>
          computeCompatibilityScore(b, skills, years) - computeCompatibilityScore(a, skills, years)
        );
      }

      resultsInfo.style.display = '';
      (document.getElementById('results-count') as HTMLElement).textContent =
        `${result.totalResults} jobs found`;

      activeTab = 'results';
      updateTabButtons();
      await renderResults();

      saveFormState();
      // Record search action for preference learning
      browser.runtime.sendMessage({
        kind: 'RECORD_SEARCH_ACTION',
        action: {
          keywords,
          location: location || undefined,
          remote,
          fullTime,
          contract,
          salaryMin: salaryMinStr ? parseInt(salaryMinStr, 10) : undefined,
          salaryMax: salaryMaxStr ? parseInt(salaryMaxStr, 10) : undefined,
          timestamp: Date.now(),
        },
      }).catch(() => {});
    } else {
      currentResults = [];
      setHTML(grid, '<div class="empty-state"><h3>Search failed</h3><p>Could not fetch results. Try again.</p></div>');
      grid.style.display = '';
    }
  } catch (err) {
    console.error('Search failed:', err);
    setHTML(grid, '<div class="empty-state"><h3>Error</h3><p>Failed to search. Check your connection.</p></div>');
    grid.style.display = '';
  } finally {
    loading.style.display = 'none';
  }
}

function updateTabButtons(): void {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = (btn as HTMLElement).dataset.tab;
    btn.classList.toggle('active', tab === activeTab);
  });
}

/* ------------------------------------------------------------------ */
/*  Event bindings                                                     */
/* ------------------------------------------------------------------ */

document.getElementById('btn-search')?.addEventListener('click', doSearch);

document.getElementById('search-keywords')?.addEventListener('keydown', (e) => {
  const dropdown = document.getElementById('ac-keywords-dropdown');
  if (dropdown?.classList.contains('open')) return;
  if (e.key === 'Enter') doSearch();
});

document.getElementById('search-location')?.addEventListener('keydown', (e) => {
  const dropdown = document.getElementById('ac-location-dropdown');
  if (dropdown?.classList.contains('open')) return;
  if (e.key === 'Enter') doSearch();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = ((btn as HTMLElement).dataset.tab as 'results' | 'saved') ?? 'results';
    updateTabButtons();
    renderResults();
  });
});

/* ------------------------------------------------------------------ */
/*  Profile auto-populate                                              */
/* ------------------------------------------------------------------ */

async function autoPopulateFromProfile(): Promise<void> {
  const profile = await getUserProfile();
  if (!profile) return;

  const keywordsInput = document.getElementById('search-keywords') as HTMLInputElement;
  const locationInput = document.getElementById('search-location') as HTMLInputElement;

  const workEntries = (profile.work ?? []) as any[];
  const sortedWork = [...workEntries].sort((a, b) =>
    new Date(b.endDate ?? b.startDate ?? 0).getTime() -
    new Date(a.endDate ?? a.startDate ?? 0).getTime()
  );
  const titleKeyword =
    sortedWork.find((w) => w.current)?.title ??
    sortedWork[0]?.title ??
    (profile.professional as any)?.currentRole ??
    (profile.professional as any)?.currentTitle ??
    '';
  const skillKeywords = (profile.skills ?? []).slice(0, 3).join(', ');
  const keywords = titleKeyword || skillKeywords;

  if (keywords && !keywordsInput.value) {
    keywordsInput.value = keywords;
  }

  const loc = profile.personal?.location;
  if (loc && !locationInput.value) {
    locationInput.value = typeof loc === 'string' ? loc : [loc.city, loc.state].filter(Boolean).join(', ');
  }

  if (keywordsInput.value) {
    doSearch();
  }
}

/* ------------------------------------------------------------------ */
/*  Scheduled results banner                                           */
/* ------------------------------------------------------------------ */

async function checkScheduledResults(): Promise<void> {
  try {
    const response = await browser.runtime.sendMessage({ kind: 'GET_SCHEDULED_RESULTS' });
    if (response?.kind !== 'SCHEDULED_RESULTS') return;
    const jobs = response.jobs ?? [];
    if (jobs.length === 0) return;

    const banner = document.getElementById('scheduled-banner');
    const countEl = document.getElementById('scheduled-count');
    if (banner && countEl) {
      countEl.textContent = String(jobs.length);
      banner.style.display = '';
    }

    document.getElementById('scheduled-view-btn')?.addEventListener('click', async () => {
      currentResults = jobs;
      const resultsInfo = document.getElementById('results-info')!;
      const emptyState = document.getElementById('empty-state')!;

      resultsInfo.style.display = '';
      (document.getElementById('results-count') as HTMLElement).textContent =
        `${jobs.length} jobs found from background search`;
      emptyState.style.display = 'none';

      activeTab = 'results';
      updateTabButtons();
      await renderResults();

      if (banner) banner.style.display = 'none';
      browser.runtime.sendMessage({ kind: 'CLEAR_SCHEDULED_RESULTS' }).catch(() => {});
    });

    document.getElementById('scheduled-dismiss-btn')?.addEventListener('click', () => {
      if (banner) banner.style.display = 'none';
      browser.runtime.sendMessage({ kind: 'CLEAR_SCHEDULED_RESULTS' }).catch(() => {});
    });
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  Init                                                               */
/* ------------------------------------------------------------------ */

setupAutocomplete('search-keywords', 'ac-keywords-dropdown', JOB_TITLES);
setupAutocomplete('search-location', 'ac-location-dropdown', US_LOCATIONS);
setupFilterPills();

const FORM_STATE_KEY = 'job_search_form_state';

async function saveFormState(): Promise<void> {
  const state = gatherFilters();
  await browser.storage.local.set({ [FORM_STATE_KEY]: state });
}

async function restoreFormState(): Promise<boolean> {
  try {
    const result = await browser.storage.local.get(FORM_STATE_KEY);
    const state = result[FORM_STATE_KEY];
    if (!state) return false;

    const keywordsInput = document.getElementById('search-keywords') as HTMLInputElement;
    const locationInput = document.getElementById('search-location') as HTMLInputElement;
    const daysSelect = document.getElementById('search-days') as HTMLSelectElement;
    const sortSelect = document.getElementById('search-sort') as HTMLSelectElement;
    const salaryMinInput = document.getElementById('salary-min') as HTMLInputElement;
    const salaryMaxInput = document.getElementById('salary-max') as HTMLInputElement;
    const remoteCheckbox = document.getElementById('search-remote') as HTMLInputElement;
    const fullTimeCheckbox = document.getElementById('search-fulltime') as HTMLInputElement;
    const contractCheckbox = document.getElementById('search-contract') as HTMLInputElement;

    if (state.keywords) keywordsInput.value = state.keywords;
    if (state.location) locationInput.value = state.location;
    if (state.daysStr) daysSelect.value = state.daysStr;
    if (state.sortBy) sortSelect.value = state.sortBy;
    if (state.salaryMinStr) salaryMinInput.value = state.salaryMinStr;
    if (state.salaryMaxStr) salaryMaxInput.value = state.salaryMaxStr;
    if (state.remote) { remoteCheckbox.checked = true; remoteCheckbox.closest('.filter-pill')?.classList.add('active'); }
    if (state.fullTime) { fullTimeCheckbox.checked = true; fullTimeCheckbox.closest('.filter-pill')?.classList.add('active'); }
    if (state.contract) { contractCheckbox.checked = true; contractCheckbox.closest('.filter-pill')?.classList.add('active'); }

    return !!state.keywords;
  } catch { return false; }
}

loadSavedIds().then(async () => {
  const restored = await restoreFormState();
  if (!restored) {
    await autoPopulateFromProfile();
  } else {
    doSearch();
  }
  checkScheduledResults();
});
