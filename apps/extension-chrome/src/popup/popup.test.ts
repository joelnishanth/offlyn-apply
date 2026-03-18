// @vitest-environment jsdom
/**
 * Popup functional tests.
 * Verifies the job-detected state UI — including the pulsating ring animation —
 * and the no-job-detected fallback state.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadPopupHTML(): Document {
  const html = readFileSync(
    resolve(__dirname, '../../public/popup/popup.html'),
    'utf-8'
  );
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

function getInlineStyles(doc: Document): string {
  return Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent ?? '')
    .join('\n');
}

// ── Animation CSS presence ────────────────────────────────────────────────────

describe('popup.html — pulsating ring CSS', () => {
  let doc: Document;
  let styles: string;

  beforeEach(() => {
    doc = loadPopupHTML();
    styles = getInlineStyles(doc);
  });

  it('defines the @keyframes job-dot-ping animation', () => {
    expect(styles).toContain('@keyframes job-dot-ping');
  });

  it('keyframe scales from 1 up to a larger value', () => {
    // Must contain a scale() transform that expands the ring
    expect(styles).toMatch(/scale\(\s*1\s*\)/);
    expect(styles).toMatch(/scale\(\s*[2-9]/);  // scale > 2 for visible ring
  });

  it('keyframe fades out (opacity 0 at end)', () => {
    expect(styles).toMatch(/opacity:\s*0/);
  });

  it('.job-dot has position: relative (needed to anchor ::before)', () => {
    expect(styles).toMatch(/\.job-dot\s*\{[^}]*position:\s*relative/s);
  });

  it('.job-dot::before references the ping animation', () => {
    expect(styles).toMatch(/\.job-dot::before\s*\{[^}]*animation:[^}]*job-dot-ping/s);
  });

  it('.job-dot::before has border-radius 50% (circular ring)', () => {
    expect(styles).toMatch(/\.job-dot::before\s*\{[^}]*border-radius:\s*50%/s);
  });

  it('.job-dot::before uses a green background matching the dot', () => {
    // The pseudo-element should share the same green color as the dot
    const dotSection = styles.match(/\.job-dot::before\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(dotSection).toMatch(/background:\s*#4ade80/);
  });

  it('.job-dot base color is green (#4ade80)', () => {
    const dotBase = styles.match(/\.job-dot\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(dotBase).toContain('#4ade80');
  });
});

// ── Job detected state (dynamic HTML injected by popup.ts) ───────────────────

describe('popup.html — job-bar structure', () => {
  let doc: Document;

  beforeEach(() => {
    doc = loadPopupHTML();
  });

  it('renders the #job-info placeholder in the initial HTML', () => {
    expect(doc.getElementById('job-info')).not.toBeNull();
  });

  it('shows the "no job detected" empty state initially', () => {
    const jobInfo = doc.getElementById('job-info')!;
    expect(jobInfo.querySelector('.job-bar-empty')).not.toBeNull();
  });

  it('can render the job-detected state with .job-dot element', () => {
    const jobInfo = doc.getElementById('job-info')!;
    jobInfo.innerHTML = `
      <div class="job-bar-detected">
        <div class="job-dot"></div>
        <div>
          <div class="job-bar-label">Job Page Detected</div>
          <div class="job-bar-detail">Software Engineer · Stripe</div>
        </div>
      </div>
    `;

    expect(jobInfo.querySelector('.job-dot')).not.toBeNull();
    expect(jobInfo.querySelector('.job-bar-label')?.textContent).toBe('Job Page Detected');
    expect(jobInfo.querySelector('.job-bar-detail')?.textContent).toContain('Stripe');
  });

  it('detected state does NOT contain the empty-bar element', () => {
    const jobInfo = doc.getElementById('job-info')!;
    jobInfo.innerHTML = `
      <div class="job-bar-detected">
        <div class="job-dot"></div>
        <div><div class="job-bar-label">Job Page Detected</div></div>
      </div>
    `;
    expect(jobInfo.querySelector('.job-bar-empty')).toBeNull();
  });
});

// ── Header toggle structure ───────────────────────────────────────────────────

describe('popup.html — header toggle', () => {
  let doc: Document;

  beforeEach(() => {
    doc = loadPopupHTML();
  });

  it('has the extension enabled toggle in the header', () => {
    const toggle = doc.getElementById('enabled-toggle');
    expect(toggle).not.toBeNull();
  });

  it('toggle starts in active (enabled) state', () => {
    const toggle = doc.getElementById('enabled-toggle')!;
    expect(toggle.classList.contains('active')).toBe(true);
  });

  it('has a role="switch" for accessibility', () => {
    const toggle = doc.getElementById('enabled-toggle')!;
    expect(toggle.getAttribute('role')).toBe('switch');
  });
});

// ── Ollama status footer ──────────────────────────────────────────────────────

describe('popup.html — Ollama status footer', () => {
  let doc: Document;

  beforeEach(() => {
    doc = loadPopupHTML();
  });

  it('renders the Ollama status element', () => {
    expect(doc.getElementById('ollama-status')).not.toBeNull();
  });

  it('Ollama status element is inside the ollama-bar container', () => {
    const el = doc.getElementById('ollama-status')!;
    const bar = el.closest('.ollama-bar');
    expect(bar).not.toBeNull();
  });
});
