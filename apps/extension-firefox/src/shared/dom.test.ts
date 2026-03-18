// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { isTrustedATSIframe, classifyPage } from './dom';

// ── isTrustedATSIframe ────────────────────────────────────────────────────────

describe('isTrustedATSIframe', () => {
  it('returns false for empty src', () => {
    expect(isTrustedATSIframe('')).toBe(false);
  });

  it('returns false for about:blank', () => {
    expect(isTrustedATSIframe('about:blank')).toBe(false);
  });

  it('returns false for javascript: URL', () => {
    expect(isTrustedATSIframe('javascript:void(0)')).toBe(false);
  });

  it('returns false for a random third-party URL', () => {
    expect(isTrustedATSIframe('https://www.google.com/search')).toBe(false);
  });

  it('returns false for malformed URL', () => {
    expect(isTrustedATSIframe('not-a-url')).toBe(false);
  });

  // ── Trusted ATS hostnames ──────────────────────────────────────────────────

  it('returns true for greenhouse.io iframe', () => {
    expect(isTrustedATSIframe('https://boards.greenhouse.io/acme/jobs/123')).toBe(true);
  });

  it('returns true for job-boards.greenhouse.io iframe', () => {
    expect(isTrustedATSIframe('https://job-boards.greenhouse.io/acme/jobs/456')).toBe(true);
  });

  it('returns true for lever.co iframe', () => {
    expect(isTrustedATSIframe('https://jobs.lever.co/acme/abc-def')).toBe(true);
  });

  it('returns true for workday.com iframe', () => {
    expect(isTrustedATSIframe('https://acme.myworkdayjobs.com/jobs/apply')).toBe(true);
  });

  it('returns true for ashbyhq.com iframe', () => {
    expect(isTrustedATSIframe('https://app.ashbyhq.com/jobs/abc')).toBe(true);
  });

  it('returns true for smartrecruiters.com iframe', () => {
    expect(isTrustedATSIframe('https://jobs.smartrecruiters.com/Acme/123')).toBe(true);
  });

  it('returns true for bamboohr.com iframe', () => {
    expect(isTrustedATSIframe('https://acme.bamboohr.com/jobs/apply')).toBe(true);
  });

  it('returns true for workable.com iframe', () => {
    expect(isTrustedATSIframe('https://apply.workable.com/acme/j/123')).toBe(true);
  });

  it('returns true for icims.com iframe', () => {
    expect(isTrustedATSIframe('https://acme.icims.com/jobs/123/apply')).toBe(true);
  });

  it('returns true for taleo.net iframe', () => {
    expect(isTrustedATSIframe('https://acme.taleo.net/careersection/apply')).toBe(true);
  });

  it('returns true for hire.withgoogle.com iframe', () => {
    expect(isTrustedATSIframe('https://hire.withgoogle.com/jobs/acme/123')).toBe(true);
  });

  // ── Subdomain matching ─────────────────────────────────────────────────────

  it('accepts deep subdomain of a trusted ATS', () => {
    expect(isTrustedATSIframe('https://careers.acme.bamboohr.com/jobs/apply')).toBe(true);
  });

  it('rejects a domain that merely contains a trusted ATS name as a substring', () => {
    // "fakegreenhouse.io" is not a subdomain of greenhouse.io
    expect(isTrustedATSIframe('https://fakegreenhouse.io/jobs')).toBe(false);
  });

  it('rejects a domain where trusted ATS appears as a path segment only', () => {
    expect(isTrustedATSIframe('https://example.com/greenhouse.io/jobs')).toBe(false);
  });
});

// ── classifyPage (jsdom environment) ─────────────────────────────────────────

describe('classifyPage', () => {
  beforeEach(() => {
    // Reset document between tests
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    // Remove all iframes
    document.querySelectorAll('iframe').forEach(el => el.remove());
  });

  function setLocation(href: string) {
    // jsdom allows setting location via window.location.assign or direct
    Object.defineProperty(window, 'location', {
      writable: true,
      value: new URL(href),
    });
  }

  it('returns JOB_APPLICATION_PAGE when a trusted ATS iframe is present', () => {
    setLocation('https://wiz.com/careers/software-engineer');
    const iframe = document.createElement('iframe');
    iframe.src = 'https://boards.greenhouse.io/wiz/jobs/123';
    document.body.appendChild(iframe);

    const result = classifyPage();
    expect(result.state).toBe('JOB_APPLICATION_PAGE');
    expect(result.hasTrustedATSIframe).toBe(true);
    expect(result.parentFillSuppressed).toBe(true);
  });

  it('returns NOT_JOB_PAGE for a generic non-job URL with no form', () => {
    setLocation('https://example.com/about-us');
    document.body.innerHTML = '<p>About us page</p>';

    const result = classifyPage();
    expect(result.state).toBe('NOT_JOB_PAGE');
  });

  it('returns JOB_POSTING_PAGE for a job-URL with no real form', () => {
    setLocation('https://wiz.com/jobs/software-engineer-123');
    // Only an apply button — no substantial form
    document.body.innerHTML = '<a href="/apply">Apply Now</a>';

    const result = classifyPage();
    expect(result.state).toBe('JOB_POSTING_PAGE');
  });

  it('returns JOB_APPLICATION_PAGE for a URL with a substantial form (≥4 inputs)', () => {
    setLocation('https://startup.com/apply');
    document.body.innerHTML = `
      <form>
        <input type="text" name="firstName" />
        <input type="text" name="lastName" />
        <input type="email" name="email" />
        <input type="tel" name="phone" />
        <textarea name="coverLetter"></textarea>
      </form>
    `;

    const result = classifyPage();
    expect(result.state).toBe('JOB_APPLICATION_PAGE');
  });

  it('returns NOT_JOB_PAGE for a small form (< 4 fields) on a generic URL', () => {
    setLocation('https://example.com/contact');
    // Only 3 fields — does not meet the 4-field threshold for a "substantial form"
    document.body.innerHTML = `
      <form>
        <input type="text" name="name" />
        <input type="email" name="email" />
        <textarea name="message"></textarea>
      </form>
    `;

    const result = classifyPage();
    expect(result.state).toBe('NOT_JOB_PAGE');
  });

  it('suppresses parent fill when ATS iframe is found', () => {
    setLocation('https://company.com/jobs/engineer');
    const iframe = document.createElement('iframe');
    iframe.src = 'https://app.ashbyhq.com/jobs/123/apply';
    document.body.appendChild(iframe);

    const result = classifyPage();
    expect(result.parentFillSuppressed).toBe(true);
    expect(result.hasTrustedATSIframe).toBe(true);
  });

  it('does not suppress parent fill when no ATS iframe is present', () => {
    setLocation('https://startup.com/apply');
    document.body.innerHTML = `
      <form>
        <input type="text" name="firstName" />
        <input type="text" name="lastName" />
        <input type="email" name="email" />
        <input type="tel" name="phone" />
      </form>
    `;

    const result = classifyPage();
    expect(result.parentFillSuppressed).toBe(false);
  });
});
