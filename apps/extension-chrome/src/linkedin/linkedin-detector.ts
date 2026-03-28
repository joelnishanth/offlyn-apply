/**
 * Detect LinkedIn page types and extract job metadata from DOM.
 */

export type LinkedInPageType = 'job-search' | 'job-detail' | 'easy-apply-modal' | 'other';

export interface LinkedInJobMeta {
  jobId: string;
  title: string;
  company: string;
  location: string;
  isEasyApply: boolean;
  isAlreadyApplied: boolean;
}

export function detectLinkedInPage(): LinkedInPageType {
  const path = window.location.pathname;
  if (path.startsWith('/jobs/search')) return 'job-search';
  if (path.startsWith('/jobs/view') || path.startsWith('/jobs/collections')) return 'job-detail';
  if (document.querySelector('.jobs-easy-apply-modal')) return 'easy-apply-modal';
  return 'other';
}

export function isLinkedIn(): boolean {
  return window.location.hostname.includes('linkedin.com');
}

export function getJobCards(): HTMLElement[] {
  const selectors = [
    '.jobs-search-results__list-item',
    '.scaffold-layout__list-item',
    'li.jobs-search-results-list__list-item',
    '.job-card-container',
  ];
  for (const sel of selectors) {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (cards.length > 0) return cards;
  }
  return [];
}

export function extractJobMetaFromCard(card: HTMLElement): LinkedInJobMeta | null {
  const titleEl = card.querySelector<HTMLElement>(
    '.job-card-list__title, .artdeco-entity-lockup__title, a[data-control-name="job_card_title"]'
  );
  const companyEl = card.querySelector<HTMLElement>(
    '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle, .job-card-container__company-name'
  );
  const locationEl = card.querySelector<HTMLElement>(
    '.job-card-container__metadata-item, .artdeco-entity-lockup__caption'
  );

  const title = titleEl?.textContent?.trim() ?? '';
  const company = companyEl?.textContent?.trim() ?? '';
  const location = locationEl?.textContent?.trim() ?? '';

  const linkEl = card.querySelector<HTMLAnchorElement>('a[href*="/jobs/view/"]');
  const jobIdMatch = linkEl?.href?.match(/\/jobs\/view\/(\d+)/);
  const jobId = jobIdMatch?.[1] ?? '';

  if (!title || !jobId) return null;

  const easyApplyBadge = card.querySelector(
    '.job-card-container__apply-method, [class*="easy-apply"]'
  );
  const isEasyApply = !!easyApplyBadge ||
    card.textContent?.toLowerCase().includes('easy apply') === true;

  const appliedBadge = card.querySelector(
    '.job-card-container__footer-job-state, [class*="applied"]'
  );
  const isAlreadyApplied = !!appliedBadge ||
    card.textContent?.toLowerCase().includes('applied') === true;

  return { jobId, title, company, location, isEasyApply, isAlreadyApplied };
}

export function extractJobMetaFromDetailPane(): LinkedInJobMeta | null {
  const titleEl = document.querySelector<HTMLElement>(
    '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title, h1.t-24'
  );
  const companyEl = document.querySelector<HTMLElement>(
    '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name'
  );
  const locationEl = document.querySelector<HTMLElement>(
    '.job-details-jobs-unified-top-card__bullet, .jobs-unified-top-card__bullet'
  );

  const title = titleEl?.textContent?.trim() ?? '';
  const company = companyEl?.textContent?.trim() ?? '';
  const location = locationEl?.textContent?.trim() ?? '';

  const urlMatch = window.location.href.match(/\/jobs\/view\/(\d+)/);
  const jobId = urlMatch?.[1] ?? '';

  const easyApplyBtn = document.querySelector(
    '.jobs-apply-button, button.jobs-apply-button--top-card, button[aria-label*="Easy Apply"]'
  );
  const isEasyApply = !!easyApplyBtn;

  const appliedText = document.querySelector('.artdeco-inline-feedback--success');
  const isAlreadyApplied = !!appliedText ||
    document.body.textContent?.includes('Application submitted') === true;

  if (!title) return null;
  return { jobId, title, company, location, isEasyApply, isAlreadyApplied };
}

export function findEasyApplyButton(): HTMLButtonElement | null {
  const selectors = [
    'button.jobs-apply-button',
    'button[aria-label*="Easy Apply"]',
    '.jobs-apply-button--top-card',
    'button.jobs-s-apply button',
  ];
  for (const sel of selectors) {
    const btn = document.querySelector<HTMLButtonElement>(sel);
    if (btn && !btn.disabled) return btn;
  }
  return null;
}

export function findModalNextButton(): HTMLButtonElement | null {
  const modal = document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
  if (!modal) return null;

  const footerBtns = modal.querySelectorAll<HTMLButtonElement>(
    'footer button, .jobs-easy-apply-footer button'
  );
  for (const btn of Array.from(footerBtns)) {
    const text = btn.textContent?.trim().toLowerCase() ?? '';
    if (text === 'next' || text === 'review' || text === 'continue') return btn;
  }
  return null;
}

export function findModalSubmitButton(): HTMLButtonElement | null {
  const modal = document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
  if (!modal) return null;

  const footerBtns = modal.querySelectorAll<HTMLButtonElement>(
    'footer button, .jobs-easy-apply-footer button'
  );
  for (const btn of Array.from(footerBtns)) {
    const text = btn.textContent?.trim().toLowerCase() ?? '';
    if (text.includes('submit') || text.includes('send application')) return btn;
  }
  return null;
}

export function findModalDismissButton(): HTMLButtonElement | null {
  const modal = document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
  if (!modal) return null;

  return modal.querySelector<HTMLButtonElement>(
    'button[data-test-modal-close-btn], button[aria-label="Dismiss"], .artdeco-modal__dismiss'
  );
}

export function isModalOpen(): boolean {
  return !!document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
}

export function getModalFormFields(): HTMLElement[] {
  const modal = document.querySelector('.jobs-easy-apply-modal, [data-test-modal]');
  if (!modal) return [];

  return Array.from(modal.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]):not([type="file"]), select, textarea, [role="combobox"], [role="listbox"]'
  ));
}
