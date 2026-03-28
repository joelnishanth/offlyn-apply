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

function renderJobCard(job: JobListing, score: number): string {
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const scoreClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-medium' : 'score-low';
  const isSaved = savedJobIds.has(job.id);

  return `
    <div class="job-card" data-job-id="${escapeHtml(job.id)}">
      <div class="job-card-header">
        <div>
          <div class="job-card-title">${escapeHtml(job.title)}</div>
          <div class="job-card-company">${escapeHtml(job.company)}</div>
          <div class="job-card-location">${escapeHtml(job.location)}</div>
        </div>
        <div class="job-card-score ${scoreClass}">${score}%</div>
      </div>
      ${salary ? `<div class="job-card-salary">${escapeHtml(salary)}</div>` : ''}
      <div class="job-card-desc">${escapeHtml(job.description)}</div>
      <div class="job-card-footer">
        <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener" class="btn-apply">Apply</a>
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
  }
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

async function doSearch(): Promise<void> {
  const keywords = (document.getElementById('search-keywords') as HTMLInputElement).value.trim();
  const location = (document.getElementById('search-location') as HTMLInputElement).value.trim();
  const daysStr = (document.getElementById('search-days') as HTMLSelectElement).value;
  const remote = (document.getElementById('search-remote') as HTMLInputElement).checked;

  if (!keywords) return;

  const loading = document.getElementById('loading')!;
  const emptyState = document.getElementById('empty-state')!;
  const grid = document.getElementById('jobs-grid')!;
  const resultsInfo = document.getElementById('results-info')!;

  emptyState.style.display = 'none';
  grid.style.display = 'none';
  loading.style.display = '';

  try {
    const response = await browser.runtime.sendMessage({
      kind: 'SEARCH_JOBS',
      filters: {
        keywords: remote ? `${keywords} remote` : keywords,
        location: location || undefined,
        daysPosted: daysStr ? parseInt(daysStr, 10) : undefined,
        resultsPerPage: 20,
      },
    });

    if (response?.kind === 'SEARCH_JOBS_RESULT' && response.result) {
      const result = response.result as JobSearchResult;
      currentResults = result.jobs;

      resultsInfo.style.display = '';
      (document.getElementById('results-count') as HTMLElement).textContent =
        `${result.totalResults} jobs found`;

      activeTab = 'results';
      updateTabButtons();
      await renderResults();
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

document.getElementById('btn-search')?.addEventListener('click', doSearch);

document.getElementById('search-keywords')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activeTab = ((btn as HTMLElement).dataset.tab as 'results' | 'saved') ?? 'results';
    updateTabButtons();
    renderResults();
  });
});

loadSavedIds();
