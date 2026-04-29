import { showCompatibilityWidget } from '../ui/compatibility-widget';
import type { UserProfile } from '../shared/profile';
import type { FieldSchema } from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Mock data for the tutorial widget
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PROFILE: UserProfile = {
  personal: {
    firstName: 'Alex',
    lastName: 'Johnson',
    email: 'alex.johnson@email.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA',
  },
  professional: {
    linkedin: 'https://linkedin.com/in/alexjohnson',
    yearsOfExperience: 6,
  },
  work: [
    { company: 'TechCorp', title: 'Software Engineer', startDate: '2020', endDate: '', current: true, description: 'Full-stack development' },
  ],
  education: [
    { school: 'Stanford University', degree: "Bachelor's", field: 'Computer Science', graduationYear: '2018' },
  ],
  skills: ['typescript', 'javascript', 'react', 'node', 'python', 'docker', 'aws', 'graphql'],
  lastUpdated: Date.now(),
};

const MOCK_FIELDS: FieldSchema[] = [
  { tagName: 'INPUT', type: 'text', name: 'firstName', id: 'field-firstname', autocomplete: 'given-name', required: true, disabled: false, multiple: false, label: 'First Name', selector: '#field-firstname', valuePreview: null, trustTier: 1 },
  { tagName: 'INPUT', type: 'text', name: 'lastName', id: 'field-lastname', autocomplete: 'family-name', required: true, disabled: false, multiple: false, label: 'Last Name', selector: '#field-lastname', valuePreview: null, trustTier: 1 },
  { tagName: 'INPUT', type: 'email', name: 'email', id: 'field-email', autocomplete: 'email', required: true, disabled: false, multiple: false, label: 'Email Address', selector: '#field-email', valuePreview: null, trustTier: 1 },
  { tagName: 'INPUT', type: 'tel', name: 'phone', id: 'field-phone', autocomplete: 'tel', required: false, disabled: false, multiple: false, label: 'Phone Number', selector: '#field-phone', valuePreview: null, trustTier: 1 },
  { tagName: 'INPUT', type: 'url', name: 'linkedin', id: 'field-linkedin', autocomplete: null, required: false, disabled: false, multiple: false, label: 'LinkedIn Profile URL', selector: '#field-linkedin', valuePreview: null, trustTier: 1 },
  { tagName: 'TEXTAREA', type: null, name: 'coverletter', id: 'field-coverletter', autocomplete: null, required: false, disabled: false, multiple: false, label: 'Cover Letter', selector: '#field-coverletter', valuePreview: null, trustTier: 1 },
  { tagName: 'TEXTAREA', type: null, name: 'interest', id: 'field-interest', autocomplete: null, required: false, disabled: false, multiple: false, label: 'Why are you interested in this role?', selector: '#field-interest', valuePreview: null, trustTier: 1 },
];

const FAKE_JOB_TEXT = document.querySelector('.page-container')?.textContent ?? '';

const MOCK_FILL_DATA: Record<string, string> = {
  'field-firstname': 'Alex',
  'field-lastname': 'Johnson',
  'field-email': 'alex.johnson@email.com',
  'field-phone': '+1 (555) 123-4567',
  'field-linkedin': 'https://linkedin.com/in/alexjohnson',
  'field-coverletter': 'Dear Hiring Manager,\n\nI am excited to apply for the Senior Software Engineer position at Offlyn Technologies. With 6 years of experience building modern web applications using TypeScript, React, and Node.js, I am confident I can contribute to your mission of building AI-powered job application tools.\n\nBest regards,\nAlex Johnson',
  'field-interest': 'I\'m passionate about developer tools and AI integration. Offlyn\'s approach to local-first AI for job applications aligns perfectly with my interests in privacy-respecting technology and browser extension development.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tour steps
// ─────────────────────────────────────────────────────────────────────────────

interface TourStep {
  title: string;
  body: string;
  /** -1 = hero card, 0+ = accordion index inside #ow-accordions */
  targetIndex: number;
}

const STEPS: TourStep[] = [
  {
    title: 'Auto-Fill Application',
    body: 'This is your one-click Auto-Fill. It pulls from your profile to fill the entire application instantly.',
    targetIndex: -1,
  },
  {
    title: 'Resume Keywords',
    body: 'See how your resume matches the job keywords. If keywords are missing, tailor your resume with one click.',
    targetIndex: 0,
  },
  {
    title: 'Cover Letter',
    body: 'Generate a tailored cover letter based on the job description and your resume. It writes directly into the form.',
    targetIndex: 1,
  },
  {
    title: 'Unique Questions',
    body: 'AI answers open-ended questions like "Why are you interested?" using your profile and the job posting.',
    targetIndex: 2,
  },
];

let currentStep = -1;
let tooltipEl: HTMLElement | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Shadow DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

function getWidgetShadow(): ShadowRoot | null {
  const host = document.getElementById('offlyn-widget-host');
  return host?.shadowRoot ?? null;
}

function waitForWidget(): Promise<ShadowRoot> {
  return new Promise((resolve) => {
    const check = () => {
      const shadow = getWidgetShadow();
      if (shadow?.getElementById('ow-panel')) {
        resolve(shadow);
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

function openPanel(shadow: ShadowRoot): void {
  const panel = shadow.getElementById('ow-panel');
  if (panel && panel.style.display === 'none') {
    const pill = shadow.querySelector('.ow-root > button') as HTMLElement | null;
    pill?.click();
  }
}

function getAccordionToggles(shadow: ShadowRoot): HTMLElement[] {
  const accordions = shadow.getElementById('ow-accordions');
  if (!accordions) return [];
  const toggles: HTMLElement[] = [];
  for (const child of Array.from(accordions.children)) {
    const btn = child.querySelector('button') as HTMLElement | null;
    if (btn) toggles.push(btn);
  }
  return toggles;
}

function expandAccordion(toggle: HTMLElement): void {
  const wrap = toggle.parentElement;
  if (!wrap) return;
  const body = wrap.querySelector('div:last-child') as HTMLElement | null;
  if (body && body.style.display === 'none') {
    toggle.click();
  }
}

function collapseAccordion(toggle: HTMLElement): void {
  const wrap = toggle.parentElement;
  if (!wrap) return;
  const body = wrap.querySelector('div:last-child') as HTMLElement | null;
  if (body && body.style.display !== 'none') {
    toggle.click();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip positioning
// ─────────────────────────────────────────────────────────────────────────────

function getTargetRect(shadow: ShadowRoot, step: TourStep): DOMRect | null {
  if (step.targetIndex === -1) {
    const scrollBody = shadow.querySelector('.ow-scrollbody');
    if (!scrollBody) return null;
    const heroCard = scrollBody.querySelector('div:first-child') as HTMLElement | null;
    return heroCard?.getBoundingClientRect() ?? null;
  }

  const toggles = getAccordionToggles(shadow);
  const toggle = toggles[step.targetIndex];
  if (!toggle) return null;

  expandAccordion(toggle);
  return toggle.parentElement!.getBoundingClientRect();
}

function positionTooltip(targetRect: DOMRect): void {
  if (!tooltipEl) return;

  const TOOLTIP_W = 300;
  const GAP = 16;

  let left = targetRect.left - TOOLTIP_W - GAP;
  let top = targetRect.top + targetRect.height / 2 - 50;

  if (left < 16) {
    left = targetRect.right + GAP;
    tooltipEl.classList.add('arrow-left');
    tooltipEl.classList.remove('arrow-right');
  } else {
    tooltipEl.classList.remove('arrow-left');
    tooltipEl.classList.add('arrow-right');
  }

  top = Math.max(16, Math.min(window.innerHeight - 240, top));

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tour logic
// ─────────────────────────────────────────────────────────────────────────────

function showStep(idx: number): void {
  const shadow = getWidgetShadow();
  if (!shadow) return;

  if (idx >= STEPS.length) {
    if (tooltipEl) tooltipEl.classList.remove('visible');
    document.getElementById('completion-overlay')?.classList.add('active');
    return;
  }

  currentStep = idx;
  const step = STEPS[idx];

  openPanel(shadow);

  // Collapse all accordions first, then expand the target one
  const toggles = getAccordionToggles(shadow);
  toggles.forEach((t, i) => {
    if (step.targetIndex >= 0 && i === step.targetIndex) return;
    collapseAccordion(t);
  });

  const stepEl = document.getElementById('tour-step')!;
  const titleEl = document.getElementById('tour-title')!;
  const bodyEl = document.getElementById('tour-body')!;
  const nextBtn = document.getElementById('tour-next')!;

  stepEl.textContent = `Step ${idx + 1} of ${STEPS.length}`;
  titleEl.textContent = step.title;
  bodyEl.textContent = step.body;
  nextBtn.textContent = idx === STEPS.length - 1 ? 'Finish' : 'Next';

  setTimeout(() => {
    const rect = getTargetRect(shadow, step);
    if (rect) {
      positionTooltip(rect);
      tooltipEl?.classList.add('visible');
    }
  }, 180);
}

function goToJobs(): void {
  window.location.href = '../jobs/jobs.html';
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock autofill (typewriter effect)
// ─────────────────────────────────────────────────────────────────────────────

function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
  return new Promise((resolve) => {
    el.value = '';
    el.classList.remove('filled');
    let i = 0;
    const speed = el.tagName === 'TEXTAREA' ? 8 : 18;
    const tick = () => {
      if (i < text.length) {
        el.value += text[i];
        i++;
        setTimeout(tick, speed);
      } else {
        el.classList.add('filled');
        resolve();
      }
    };
    tick();
  });
}

let fillInProgress = false;

async function mockAutofill(): Promise<void> {
  if (fillInProgress) return;
  fillInProgress = true;

  const ids = Object.keys(MOCK_FILL_DATA);
  let filled = 0;

  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) continue;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    await typeInto(el, MOCK_FILL_DATA[id]);
    filled++;
    await new Promise(r => setTimeout(r, 120));
  }

  window.dispatchEvent(new CustomEvent('offlyn-autofill-done', {
    detail: { success: true, filled, total: ids.length, message: `Filled ${filled}/${ids.length} fields` },
  }));

  fillInProgress = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock cover letter generation (typewriter into the textarea)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_COVER_LETTER = `Dear Hiring Manager,

I am writing to express my strong interest in the Senior Software Engineer position at Offlyn Technologies. With over 6 years of experience in full-stack development, specializing in TypeScript, React, and Node.js, I am confident in my ability to contribute to your team's mission of building AI-powered job application tools.

In my current role at TechCorp, I have led the development of several high-impact projects involving browser extensions, real-time data processing, and cloud infrastructure on AWS. My experience with Docker, GraphQL, and Python aligns well with your technical requirements.

What excites me most about Offlyn is your commitment to local-first AI and privacy-respecting technology. I am passionate about building tools that empower users while keeping their data secure.

I would welcome the opportunity to discuss how my skills and experience can contribute to Offlyn's continued success.

Best regards,
Alex Johnson`;

let coverLetterGenerating = false;

async function mockGenerateCoverLetter(): Promise<void> {
  if (coverLetterGenerating) return;
  coverLetterGenerating = true;

  const textarea = document.getElementById('field-coverletter') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 300));
    await typeInto(textarea, MOCK_COVER_LETTER);
  }

  coverLetterGenerating = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock tailor resume (open resume-tailor page with demo JD data)
// ─────────────────────────────────────────────────────────────────────────────

async function mockTailorResume(): Promise<void> {
  try {
    // Store demo job description data so the resume tailor page picks it up
    await chrome.storage.local.set({
      pending_tailor_jd: FAKE_JOB_TEXT.slice(0, 2000),
      pending_tailor_title: 'Senior Software Engineer',
      pending_tailor_company: 'Offlyn Technologies',
      pending_tailor_url: window.location.href,
    });
  } catch { /* storage may not be available */ }

  try {
    const url = chrome.runtime.getURL('resume-tailor/resume-tailor.html');
    window.open(url, '_blank');
  } catch { /* fallback: do nothing on tutorial page */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  tooltipEl = document.getElementById('tour-tooltip');

  document.getElementById('tour-next')?.addEventListener('click', () => showStep(currentStep + 1));
  document.getElementById('tour-skip')?.addEventListener('click', goToJobs);
  document.getElementById('skip-tutorial')?.addEventListener('click', goToJobs);
  document.getElementById('start-applying-btn')?.addEventListener('click', goToJobs);

  // Mock handlers: the widget dispatches these events but there's no content
  // script on extension pages, so we handle them here with demo behavior
  window.addEventListener('offlyn-manual-autofill', () => mockAutofill());
  window.addEventListener('offlyn-generate-cover-letter', () => mockGenerateCoverLetter());
  window.addEventListener('offlyn-tailor-resume', () => mockTailorResume());
  window.addEventListener('offlyn-open-resume-tailor', () => mockTailorResume());

  // Resolve logo URLs (extension page has access to chrome.runtime)
  let monogramUrl = '';
  let logoUrl = '';
  try {
    monogramUrl = chrome.runtime.getURL('icons/monogram-nosquare.png');
    logoUrl = chrome.runtime.getURL('icons/primary-logo.png');
  } catch { /* fallback to empty */ }

  // Mount the widget on this page directly
  showCompatibilityWidget(
    MOCK_PROFILE,
    'Senior Software Engineer',
    'Offlyn Technologies',
    FAKE_JOB_TEXT,
    MOCK_FIELDS,
    monogramUrl,
    logoUrl,
  );

  const shadow = await waitForWidget();

  // Auto-open the panel after a brief moment
  setTimeout(() => {
    openPanel(shadow);
    // Start the guided tour
    setTimeout(() => showStep(0), 400);
  }, 600);
}

window.addEventListener('resize', () => {
  if (currentStep >= 0 && currentStep < STEPS.length) {
    const shadow = getWidgetShadow();
    if (!shadow) return;
    const rect = getTargetRect(shadow, STEPS[currentStep]);
    if (rect) positionTooltip(rect);
  }
});

init();
