/**
 * Job description scraper — extracts the full job description text for
 * cover letter generation. Because the application form is often on a
 * different page from the JD, this module:
 *  1. Scrapes the current page for any visible JD text.
 *  2. Falls back to meta/OG tags, JSON-LD structured data, etc.
 *  3. Can be fed a URL to fetch the JD from the original posting page.
 */

export interface JobDescription {
  title: string;
  company: string;
  description: string;       // full JD body text
  requirements: string[];    // extracted bullet requirements (best-effort)
  location: string | null;
  source: 'current-page' | 'structured-data' | 'meta-tags' | 'referrer' | 'manual';
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Best-effort scrape of the job description from the current page.
 * Combines multiple strategies and returns the richest result.
 */
export function scrapeJobDescription(
  fallbackTitle?: string | null,
  fallbackCompany?: string | null,
): JobDescription {
  // Strategy 1: JSON-LD structured data (most reliable when present)
  const jsonLd = extractFromJsonLd();
  if (jsonLd && jsonLd.description.length > 100) {
    return { ...jsonLd, title: jsonLd.title || fallbackTitle || '', company: jsonLd.company || fallbackCompany || '' };
  }

  // Strategy 2: Well-known JD containers (Greenhouse, Lever, Workday, etc.)
  const container = extractFromKnownContainers();
  if (container && container.length > 100) {
    return {
      title: fallbackTitle || extractTitle() || '',
      company: fallbackCompany || extractCompany() || '',
      description: container,
      requirements: extractBullets(container),
      location: extractLocation(),
      source: 'current-page',
    };
  }

  // Strategy 3: OG / meta description
  const meta = extractFromMeta();
  if (meta && meta.length > 60) {
    return {
      title: fallbackTitle || extractTitle() || '',
      company: fallbackCompany || extractCompany() || '',
      description: meta,
      requirements: extractBullets(meta),
      location: extractLocation(),
      source: 'meta-tags',
    };
  }

  // Strategy 4: largest text block on page
  const largestBlock = extractLargestTextBlock();
  return {
    title: fallbackTitle || extractTitle() || '',
    company: fallbackCompany || extractCompany() || '',
    description: largestBlock,
    requirements: extractBullets(largestBlock),
    location: extractLocation(),
    source: 'current-page',
  };
}

// ── JSON-LD ─────────────────────────────────────────────────────────────────

function extractFromJsonLd(): Partial<JobDescription> | null {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent || '');
      // Could be an array or a single object
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'JobPosting') {
          return {
            title: item.title || item.name || null,
            company: item.hiringOrganization?.name || null,
            description: stripHtml(item.description || ''),
            requirements: extractBullets(stripHtml(item.description || '')),
            location: item.jobLocation?.address?.addressLocality || null,
            source: 'structured-data',
          };
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return null;
}

// ── Known ATS containers ────────────────────────────────────────────────────

function extractFromKnownContainers(): string | null {
  const selectors = [
    // Greenhouse
    '#content .job-post-content',
    '#content #job_description',
    '.job-description',
    '.job__description',
    // Lever
    '.posting-page .section-wrapper',
    '.posting-categories + .section-wrapper',
    '[data-qa="job-description"]',
    // Workday
    '[data-automation-id="jobPostingDescription"]',
    '.css-cygeeu', // Workday common JD class
    // Ashby
    '.ashby-job-posting-description',
    // Generic
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="job_description"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    '[id*="job_description"]',
    'article',
    '.description',
    '[role="main"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = extractVisibleText(el as HTMLElement);
      if (text.length > 100) return text;
    }
  }
  return null;
}

// ── Meta / OG ───────────────────────────────────────────────────────────────

function extractFromMeta(): string | null {
  const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
  if (ogDesc && ogDesc.length > 60) return ogDesc;
  const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content');
  if (metaDesc && metaDesc.length > 60) return metaDesc;
  return null;
}

// ── Largest text block ──────────────────────────────────────────────────────

function extractLargestTextBlock(): string {
  const candidates = document.querySelectorAll('main, article, section, .content, [role="main"], #content, #main');
  let best = '';
  for (const el of candidates) {
    const text = extractVisibleText(el as HTMLElement);
    if (text.length > best.length) best = text;
  }
  // Fallback: body
  if (best.length < 100) {
    best = extractVisibleText(document.body);
  }
  // Cap at ~6000 chars to avoid blowing up the LLM context
  return best.slice(0, 6000);
}

// ── Helpers (title, company, location) ──────────────────────────────────────

function extractTitle(): string | null {
  const h1 = document.querySelector('h1');
  if (h1) {
    const t = h1.textContent?.trim();
    if (t && t.length > 3 && t.length < 200) return t;
  }
  return document.title?.split(/[|\-–—]/).map(s => s.trim()).filter(s => s.length > 3)[0] || null;
}

function extractCompany(): string | null {
  const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (og) return og;
  try {
    return new URL(window.location.href).hostname.replace(/^www\./, '').split('.')[0] || null;
  } catch { return null; }
}

function extractLocation(): string | null {
  const locationSelectors = [
    '[class*="location"]', '[data-testid*="location"]',
    '[class*="Location"]', '.job-location',
  ];
  for (const sel of locationSelectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text && text.length > 2 && text.length < 100) return text;
  }
  return null;
}

// ── Text utilities ──────────────────────────────────────────────────────────

function extractVisibleText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      const rect = parent.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim();
    if (text) parts.push(text);
  }
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function stripHtml(html: string): string {
  const d = new DOMParser().parseFromString(html, 'text/html');
  return d.body.textContent?.trim() || '';
}

function extractBullets(text: string): string[] {
  // Split on newlines / bullet chars, filter short noise
  return text
    .split(/[\n•·▪-]/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 300);
}
