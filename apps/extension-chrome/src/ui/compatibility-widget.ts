/**
 * Unified Floating Widget
 *
 * UX:
 *  - Collapsed monogram pill stays visible at all times — top-right.
 *  - Click pill → panel opens BELOW the pill.
 *  - Panel shows Actions first (Auto-Fill, Cover Letter, Refresh, Details).
 *  - Compatibility breakdown is COLLAPSED by default inside the panel.
 *  - All layout uses inline styles to be immune to host-page CSS.
 */

import { setHTML } from '../shared/html';

import type { UserProfile, ProfileMeta } from '../shared/profile';
import type { FieldSchema }  from '../shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CompatData {
  overall: number;
  skills:  { score: number; matched: string[]; missing: string[]; total: number };
  experience: { score: number; required: string; yours: string; match: boolean };
  education:  { score: number; required: string; yours: string; match: boolean };
  location:   { score: number; required: string; yours: string; match: boolean };
  salary:     { score: number; required: string; match: 'yes' | 'partial' | 'no' };
  aiInsight: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

let host:              HTMLElement | null = null;
let shadow:            ShadowRoot  | null = null;
let fields:            FieldSchema[]      = [];
let logoUrl:           string             = '';
let headerLogoUrl:     string             = '';
let panelOpen       = false;
let currentProfiles:   ProfileMeta[]      = [];
let currentActiveId:   string             = '';
let currentSetupIds:   Set<string>        = new Set();
let currentProfileScores: Map<string, number> = new Map();

// Fill-mode state (minimized progress ring)
let fillModeActive     = false;
let fillRingSvg:       SVGSVGElement | null = null;
let fillRingCircle:    SVGCircleElement | null = null;
let fillLabelEl:       HTMLElement | null = null;
let fillPanelRef:      HTMLElement | null = null;
let fillPillRef:       HTMLElement | null = null;
let fillPauseOverlay:  HTMLElement | null = null;

let lastCompatData:  CompatData | null = null;

// Drag state
let isDragging       = false;
let dragStartX       = 0;
let dragStartY       = 0;
let dragHostStartX   = 0;
let dragHostStartY   = 0;
let dragMoved        = false;

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function showCompatibilityWidget(
  profile: UserProfile,
  _jobTitle: string,
  _company:  string,
  pageText:  string,
  jobFields: FieldSchema[] = [],
  monogramUrl: string = '',
  primaryLogoUrl: string = '',
  profiles: ProfileMeta[] = [],
  activeProfileId: string = '',
  setupProfileIds: Set<string> = new Set(),
  profileScores: Map<string, number> = new Map(),
): void {
  const wasPanelOpen = panelOpen;
  removeCompatibilityWidget();
  fields           = jobFields;
  logoUrl          = monogramUrl;
  headerLogoUrl    = primaryLogoUrl;
  currentProfiles  = profiles;
  currentActiveId  = activeProfileId;
  currentSetupIds  = setupProfileIds;
  currentProfileScores = profileScores;
  panelOpen  = wasPanelOpen;

  const data = computeCompatibility(profile, pageText);
  lastCompatData = data;

  host = document.createElement('div');
  host.id = 'offlyn-widget-host';
  setStyles(host, {
    position: 'fixed',
    top:      '24px',
    right:    '24px',
    zIndex:   '2147483647',
  });
  host.style.setProperty('line-height', 'normal', 'important');
  document.body.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  injectBaseCSS(shadow);
  mount(shadow, data);
}

export function updateCompatibilityFields(newFields: FieldSchema[]): void {
  fields = newFields;
}

export function removeCompatibilityWidget(): void {
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  host?.remove();
  host = shadow = null;
  fields = [];
  currentProfiles = [];
  currentActiveId = '';
  currentSetupIds = new Set();
  currentProfileScores = new Map();
  panelOpen = false;
  fillModeActive = false;
  lastCompatData = null;
  fillRingSvg = fillRingCircle = null;
  fillLabelEl = fillPanelRef = fillPillRef = null;
  fillPauseOverlay = null;
  isDragging = dragMoved = false;
}

export function updateWidgetProfile(
  newActiveId: string,
  newProfiles: ProfileMeta[],
  newSetupIds?: Set<string>,
  newScores?: Map<string, number>,
): void {
  currentActiveId = newActiveId;
  currentProfiles = newProfiles;
  if (newSetupIds) currentSetupIds = newSetupIds;
  if (newScores) currentProfileScores = newScores;
  if (!shadow) return;
  const existing = shadow.getElementById('ow-profile-section');
  if (!existing) return;
  const fresh = buildProfileSection();
  existing.replaceWith(fresh);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fill-mode API (minimized circular progress ring)
// ─────────────────────────────────────────────────────────────────────────────

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function isWidgetMounted(): boolean {
  return host !== null && shadow !== null;
}

export function enterFillMode(total: number): void {
  if (!shadow || !host) return;
  fillModeActive = true;

  // Close panel
  if (fillPanelRef) fillPanelRef.style.display = 'none';
  panelOpen = false;

  // Create SVG ring around pill
  if (!fillRingSvg && fillPillRef) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '76');
    svg.setAttribute('height', '76');
    svg.setAttribute('viewBox', '0 0 76 76');
    svg.style.cssText = 'position:absolute;top:-8px;right:-8px;pointer-events:none;z-index:1;';

    // Track circle (gray)
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '38');
    track.setAttribute('cy', '38');
    track.setAttribute('r', String(RING_RADIUS));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', '#e2e0da');
    track.setAttribute('stroke-width', '3.5');
    svg.appendChild(track);

    // Progress circle (green)
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '38');
    circle.setAttribute('cy', '38');
    circle.setAttribute('r', String(RING_RADIUS));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', '#1a7f5a');
    circle.setAttribute('stroke-width', '3.5');
    circle.setAttribute('stroke-linecap', 'round');
    circle.style.cssText = `
      stroke-dasharray: ${RING_CIRCUMFERENCE};
      stroke-dashoffset: ${RING_CIRCUMFERENCE};
      transform: rotate(-90deg);
      transform-origin: 38px 38px;
      transition: stroke-dashoffset 0.3s ease;
    `;
    svg.appendChild(circle);

    fillRingSvg = svg;
    fillRingCircle = circle;

    // Attach to pill's parent (relative container)
    fillPillRef.style.position = 'relative';
    const pillWrap = fillPillRef.parentElement;
    if (pillWrap) {
      pillWrap.style.position = 'relative';
      pillWrap.appendChild(svg as unknown as HTMLElement);
    }
  }

  // Create progress label below pill
  if (!fillLabelEl) {
    const label = el('div');
    label.id = 'ow-fill-label';
    setStyles(label, {
      textAlign: 'center',
      fontSize: '10px',
      fontWeight: '600',
      color: '#1a7f5a',
      marginTop: '-4px',
      whiteSpace: 'nowrap',
      opacity: '0.9',
    });
    label.textContent = `0 / ${total}`;

    const root = shadow.querySelector('.ow-root');
    if (root && fillPillRef) {
      // Insert label after pill
      const nextSib = fillPillRef.nextSibling;
      if (nextSib) root.insertBefore(label, nextSib);
      else root.appendChild(label);
    }
    fillLabelEl = label;
  }

  // Pause/play overlay on the pill
  if (!fillPauseOverlay && fillPillRef) {
    const overlay = el('div');
    overlay.id = 'ow-pause-overlay';
    setStyles(overlay, {
      position:       'absolute',
      top:            '0',
      left:           '0',
      width:          '100%',
      height:         '100%',
      borderRadius:   '50%',
      background:     'rgba(10,10,10,0.55)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      cursor:         'pointer',
      zIndex:         '10',
      opacity:        '0',
      transition:     'opacity 0.15s',
      pointerEvents:  'auto',
    });
    setHTML(overlay, `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`);

    overlay.addEventListener('mouseenter', () => { overlay.style.opacity = '1'; });
    overlay.addEventListener('mouseleave', () => {
      overlay.style.opacity = '0';
    });
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      // Dispatch toggle event that progress-indicator listens for
      window.dispatchEvent(new CustomEvent('offlyn-toggle-fill-pause'));
    });

    fillPillRef.style.position = 'relative';
    fillPillRef.appendChild(overlay);
    fillPauseOverlay = overlay;
  }

  // Listen for pause state changes from progress-indicator
  const pauseHandler = ((e: CustomEvent) => {
    if (!fillPauseOverlay) return;
    const isPaused = e.detail?.paused;
    if (isPaused) {
      fillPauseOverlay.style.opacity = '1';
      setHTML(fillPauseOverlay, `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>`);
      if (fillLabelEl) {
        fillLabelEl.textContent = 'Paused';
        fillLabelEl.style.color = '#d97706';
      }
    } else {
      fillPauseOverlay.style.opacity = '0';
      setHTML(fillPauseOverlay, `<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`);
      if (fillLabelEl) {
        fillLabelEl.style.color = '#1a7f5a';
      }
    }
  }) as EventListener;
  window.addEventListener('offlyn-fill-pause-state', pauseHandler);

  updateFillProgress(0, total);
}

export function updateFillProgress(current: number, total: number, fieldName?: string): void {
  if (!fillModeActive) return;

  const pct = total > 0 ? current / total : 0;
  if (fillRingCircle) {
    fillRingCircle.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - pct));
  }

  if (fillLabelEl) {
    fillLabelEl.textContent = fieldName
      ? `${current}/${total}`
      : `${current}/${total}`;
  }
}

export function exitFillMode(success: boolean, filled: number, total: number): void {
  if (!fillModeActive) return;

  // Show completion state on ring
  if (fillRingCircle) {
    fillRingCircle.style.strokeDashoffset = '0';
    fillRingCircle.setAttribute('stroke', success ? '#1a7f5a' : '#f59e0b');
  }

  if (fillLabelEl) {
    fillLabelEl.textContent = success ? `${filled} filled` : `${filled}/${total}`;
    fillLabelEl.style.color = success ? '#1a7f5a' : '#f59e0b';
  }

  // Remove pause overlay immediately
  fillPauseOverlay?.remove();
  fillPauseOverlay = null;

  // After 2.5s, clean up ring and restore normal state
  setTimeout(() => {
    fillRingSvg?.remove();
    fillRingSvg = null;
    fillRingCircle = null;
    fillLabelEl?.remove();
    fillLabelEl = null;
    fillModeActive = false;
  }, 2500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mount / render
// ─────────────────────────────────────────────────────────────────────────────

function mount(sr: ShadowRoot, data: CompatData): void {
  sr.querySelectorAll('.ow-root').forEach(e => e.remove());

  const root = el('div');
  root.className = 'ow-root';
  setStyles(root, {
    position:      'relative',
    display:       'inline-flex',
    flexDirection: 'column',
    alignItems:    'flex-end',
  });

  // ── monogram pill (always visible, at top) ──
  const pill = buildPill(data);
  if (data.overall >= 80) pill.classList.add('ow-anim-excellent');
  else if (data.overall >= 60) pill.classList.add('ow-anim-match');
  root.appendChild(pill);

  const panel = buildPanel(sr, data);
  setStyles(panel, {
    position: 'absolute',
    top:      '70px',
    width:    '380px',
    maxWidth: `${Math.min(380, window.innerWidth - 20)}px`,
  });
  panel.style.display = panelOpen ? 'block' : 'none';
  root.appendChild(panel);

  fillPanelRef = panel;
  fillPillRef = pill;

  // Click to toggle panel (only if not dragging)
  pill.addEventListener('click', (e) => {
    if (dragMoved || fillModeActive) return;
    e.stopPropagation();
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) repositionPanel();
  });

  // ── Drag support on pill ──
  pill.addEventListener('pointerdown', onDragStart);

  sr.appendChild(root);

  // Must happen after root is in the DOM so layout measurements are accurate
  if (panelOpen) repositionPanel();
}

/**
 * Position the panel using a fixed-position overlay so it always
 * opens toward the side with more viewport space, regardless of
 * how the host/root flex container lays out internally.
 */
function repositionPanel(): void {
  if (!host || !shadow) return;
  const panel = shadow.getElementById('ow-panel') as HTMLElement;
  if (!panel) return;

  const hostRect = host.getBoundingClientRect();
  const vw = window.innerWidth;
  const panelW = Math.min(380, vw - 20);

  const pillCenterX = hostRect.left + hostRect.width / 2;

  // Pick side: if pill is on the left half, panel goes right; otherwise left
  let panelLeft: number;
  if (pillCenterX < vw / 2) {
    // Open rightward — align panel's left edge with pill's left edge
    panelLeft = hostRect.left;
  } else {
    // Open leftward — align panel's right edge with pill's right edge
    panelLeft = hostRect.right - panelW;
  }

  // Clamp so panel stays within viewport
  panelLeft = Math.max(10, Math.min(panelLeft, vw - panelW - 10));

  // Convert from viewport coords to host-relative coords
  const offsetLeft = panelLeft - hostRect.left;

  panel.style.left = `${offsetLeft}px`;
  panel.style.right = 'auto';
  panel.style.width = `${panelW}px`;
  panel.style.maxWidth = `${panelW}px`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drag handling
// ─────────────────────────────────────────────────────────────────────────────

function onDragStart(e: PointerEvent): void {
  if (!host) return;
  isDragging = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  const rect = host.getBoundingClientRect();
  dragHostStartX = rect.left;
  dragHostStartY = rect.top;

  // Switch from right-based to left-based positioning for dragging
  host.style.right = 'auto';
  host.style.left = `${dragHostStartX}px`;
  host.style.top = `${dragHostStartY}px`;
  host.style.cursor = 'grabbing';

  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  e.preventDefault();
}

function onDragMove(e: PointerEvent): void {
  if (!isDragging || !host) return;
  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  if (!dragMoved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
  dragMoved = true;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const newX = Math.max(0, Math.min(vw - 80, dragHostStartX + dx));
  const newY = Math.max(0, Math.min(vh - 80, dragHostStartY + dy));

  host.style.left = `${newX}px`;
  host.style.top = `${newY}px`;
}

function onDragEnd(): void {
  if (!host) return;
  isDragging = false;
  host.style.cursor = '';
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);

  if (dragMoved) {
    repositionPanel();
    // Reset after a short delay so the click handler doesn't fire on pointer-up
    setTimeout(() => { dragMoved = false; }, 50);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pill
// ─────────────────────────────────────────────────────────────────────────────

function buildPill(data: CompatData): HTMLElement {
  const dotColor = scoreDot(data.overall);

  const pill = el('button');
  pill.title = 'Offlyn Apply — click to open';
  setStyles(pill, {
    position:       'relative',
    width:          '60px',
    height:         '60px',
    borderRadius:   '50%',
    background:     `radial-gradient(circle at 38% 32%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.20) 55%, transparent 56%), #ffffff`,
    boxShadow:      '0 4px 18px rgba(30,41,59,0.22), inset 0 1px 4px rgba(255,255,255,1)',
    border:         '1px solid rgba(30,41,59,0.08)',
    cursor:         'pointer',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '8px',
    transition:     'transform 0.18s, box-shadow 0.18s',
    flexShrink:     '0',
    outline:        'none',
    touchAction:    'none',
  });

  if (logoUrl) {
    const img = document.createElement('img');
    img.src = logoUrl;
    img.alt = 'Offlyn Apply';
    setStyles(img as unknown as HTMLElement, {
      width:     '100%',
      height:    '100%',
      objectFit: 'contain',
      display:   'block',
      pointerEvents: 'none',
    });
    pill.appendChild(img as unknown as HTMLElement);
  } else {
    // Fallback: "OA" text if image not available
    const fallback = el('span');
    setStyles(fallback, { fontSize: '14px', fontWeight: '700', color: '#0a0a0a', letterSpacing: '0.5px' });
    fallback.textContent = 'OA';
    pill.appendChild(fallback);
  }

  // Score indicator dot — bottom-right corner
  const dotEl = el('div');
  setStyles(dotEl, {
    position:     'absolute',
    bottom:       '5px',
    right:        '5px',
    width:        '12px',
    height:       '12px',
    borderRadius: '50%',
    background:   dotColor,
    border:       '2px solid #ffffff',
    boxShadow:    '0 1px 4px rgba(0,0,0,0.18)',
  });
  pill.appendChild(dotEl);

  pill.addEventListener('mouseenter', () => {
    pill.style.transform  = 'scale(1.08)';
    pill.style.boxShadow  = `0 6px 24px rgba(30,41,59,0.28), inset 0 1px 4px rgba(255,255,255,1)`;
  });
  pill.addEventListener('mouseleave', () => {
    pill.style.transform  = '';
    pill.style.boxShadow  = '0 4px 18px rgba(30,41,59,0.22), inset 0 1px 4px rgba(255,255,255,1)';
  });

  return pill;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field categorization
// ─────────────────────────────────────────────────────────────────────────────

interface FieldCategories {
  coverLetter: FieldSchema[];
  unique: FieldSchema[];
  common: FieldSchema[];
}

function categorizeFields(fieldList: FieldSchema[]): FieldCategories {
  const coverLetter: FieldSchema[] = [];
  const unique: FieldSchema[] = [];
  const common: FieldSchema[] = [];

  for (const f of fieldList) {
    if (f.trustTier === 3 || f.fillEligible === false) continue;
    const label = (f.label || '').toLowerCase();
    const isTextarea = f.tagName?.toUpperCase() === 'TEXTAREA';

    if (isTextarea && /cover|letter|motivation/.test(label)) {
      coverLetter.push(f);
    } else if (isTextarea || /why|describe|explain|tell us|how (have|do|would)|what .*(excite|interest|motivat)/.test(label)) {
      unique.push(f);
    } else {
      common.push(f);
    }
  }
  return { coverLetter, unique, common };
}

function countFilled(fieldList: FieldSchema[]): number {
  return fieldList.filter(f => f.valuePreview && f.valuePreview.trim().length > 0).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic accordion builder
// ─────────────────────────────────────────────────────────────────────────────

interface AccordionOpts {
  iconBg: string;
  iconSvg: string;
  label: string;
  statusText: string;
  statusColor: string;
  defaultOpen?: boolean;
  body: HTMLElement;
}

function buildAccordion(opts: AccordionOpts): HTMLElement {
  const wrap = el('div');
  setStyles(wrap, { borderTop: '1px solid #f4f3f0' });

  let isOpen = opts.defaultOpen ?? false;

  const toggle = el('button');
  setStyles(toggle, {
    display: 'flex', alignItems: 'center', gap: '10px',
    width: '100%', padding: '10px 14px', background: '#fff',
    border: 'none', cursor: 'pointer', textAlign: 'left',
  });

  const icon = el('div');
  setStyles(icon, {
    width: '28px', height: '28px', borderRadius: '50%',
    background: opts.iconBg, display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: '0',
  });
  setHTML(icon, opts.iconSvg);

  const labelEl = el('span');
  setStyles(labelEl, {
    flex: '1', fontSize: '13px', fontWeight: '600', color: '#0a0a0a',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  labelEl.textContent = opts.label;

  const status = el('span');
  setStyles(status, {
    fontSize: '11px', fontWeight: '500', color: opts.statusColor,
    flexShrink: '0', whiteSpace: 'nowrap',
  });
  status.textContent = opts.statusText;

  const arrow = el('span');
  setStyles(arrow, {
    display: 'inline-flex', color: '#9e9b93',
    transition: 'transform 0.2s', flexShrink: '0',
    transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
  });
  setHTML(arrow, `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 5 7 9 11 5"/></svg>`);

  toggle.appendChild(icon);
  toggle.appendChild(labelEl);
  toggle.appendChild(status);
  toggle.appendChild(arrow);
  wrap.appendChild(toggle);

  setStyles(opts.body, {
    display: isOpen ? 'flex' : 'none',
    flexDirection: 'column', gap: '8px',
    padding: '0 14px 12px', borderTop: '1px solid #f4f3f0',
  });
  wrap.appendChild(opts.body);

  toggle.addEventListener('click', () => {
    isOpen = !isOpen;
    opts.body.style.display = isOpen ? 'flex' : 'none';
    arrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  });

  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

function buildPanel(_sr: ShadowRoot, data: CompatData): HTMLElement {
  const panel = el('div');
  panel.id = 'ow-panel';
  setStyles(panel, {
    width:        '380px',
    background:   '#fff',
    borderRadius: '14px',
    boxShadow:    '0 8px 36px rgba(30,41,59,0.16), 0 2px 8px rgba(30,41,59,0.08)',
    border:       '1px solid #e2e0da',
    overflow:     'hidden',
  });

  // ── Header ──
  panel.appendChild(buildPanelHeader(panel));

  // ── Body ──
  const body = el('div');
  setStyles(body, {
    display: 'flex', flexDirection: 'column', gap: '0',
    maxHeight: '520px', overflowY: 'auto',
  });
  body.className = 'ow-scrollbody';

  // Hero card (autofill CTA)
  body.appendChild(buildHeroCard());

  // Profile row
  body.appendChild(buildProfileSection());

  // Categorize fields
  const cats = categorizeFields(fields);

  // Accordion sections container (for show less/more toggle)
  const accordions = el('div');
  accordions.id = 'ow-accordions';
  setStyles(accordions, { display: 'flex', flexDirection: 'column' });

  // 1. Resume accordion
  accordions.appendChild(buildResumeAccordion(data));

  // 2. Cover Letter accordion
  accordions.appendChild(buildCoverLetterAccordion(cats.coverLetter));

  // 3. Unique Questions accordion
  if (cats.unique.length > 0) {
    accordions.appendChild(buildQuestionsAccordion('Unique Questions', cats.unique, '#7c3aed',
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/></svg>`));
  }

  body.appendChild(accordions);

  // Show less / Show more footer
  body.appendChild(buildShowLessFooter(accordions));

  panel.appendChild(body);
  return panel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel header
// ─────────────────────────────────────────────────────────────────────────────

function buildPanelHeader(panel: HTMLElement): HTMLElement {
  const hdr = el('div');
  setStyles(hdr, {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', padding: '12px 14px',
    background: '#0a0a0a', color: '#fff',
  });

  const hdrLeft = el('div');
  setStyles(hdrLeft, { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '10px' });

  const logoBadge = el('div');
  setStyles(logoBadge, {
    width: '36px', height: '36px', borderRadius: '50%', background: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: '0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
    padding: '4px',
  });
  if (headerLogoUrl) {
    const logoImg = document.createElement('img');
    logoImg.src = headerLogoUrl;
    logoImg.alt = 'Offlyn Apply';
    setStyles(logoImg as unknown as HTMLElement, {
      width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none',
    });
    logoBadge.appendChild(logoImg as unknown as HTMLElement);
  } else {
    txt(logoBadge, 'OA', { fontSize: '11px', fontWeight: '700', color: '#0a0a0a' });
  }

  const hdrTitle = el('p');
  setStyles(hdrTitle, { fontSize: '13px', fontWeight: '600', color: '#fff', margin: '0', padding: '0', lineHeight: '1.3' });
  hdrTitle.textContent = 'Offlyn Apply';
  hdrLeft.appendChild(logoBadge);
  hdrLeft.appendChild(hdrTitle);

  const closeBtn = el('button');
  setStyles(closeBtn, {
    width: '26px', height: '26px', borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: '0',
  });
  setHTML(closeBtn, `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="1" y1="1" x2="10" y2="10"/><line x1="10" y1="1" x2="1" y2="10"/></svg>`);
  closeBtn.addEventListener('click', () => {
    panelOpen = false;
    panel.style.display = 'none';
  });

  hdr.appendChild(hdrLeft);
  hdr.appendChild(closeBtn);
  return hdr;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero card (Autofill CTA)
// ─────────────────────────────────────────────────────────────────────────────

function buildHeroCard(): HTMLElement {
  const wrap = el('div');
  setStyles(wrap, {
    margin: '10px', padding: '16px', borderRadius: '12px',
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    color: '#fff',
  });

  const headline = el('p');
  setStyles(headline, { fontSize: '14px', fontWeight: '700', margin: '0 0 4px', lineHeight: '1.3' });
  headline.textContent = 'Autofill this job application!';
  wrap.appendChild(headline);

  const sub = el('p');
  setStyles(sub, { fontSize: '11px', opacity: '0.85', margin: '0 0 12px', lineHeight: '1.4' });
  sub.textContent = 'Information is pulled from your Offlyn profile';
  wrap.appendChild(sub);

  const btn = el('button');
  setStyles(btn, {
    width: '100%', padding: '10px', borderRadius: '8px',
    background: '#fff', color: '#15803d', border: 'none',
    fontSize: '13px', fontWeight: '700', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.15s, transform 0.1s',
  });
  btn.textContent = 'Auto-Fill Application';
  btn.addEventListener('mouseenter', () => { btn.style.background = '#f0fdf4'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = '#fff'; });
  btn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('offlyn-manual-autofill'));
  });

  // Status line (shown after fill attempt)
  const statusEl = el('div');
  statusEl.id = 'ow-status';
  setStyles(statusEl, { fontSize: '11px', minHeight: '0', marginTop: '6px', color: 'rgba(255,255,255,0.8)', textAlign: 'center' });

  window.addEventListener('offlyn-autofill-done', ((e: CustomEvent) => {
    const { success, filled, total, message } = e.detail ?? {};
    if (success && filled > 0) {
      statusEl.textContent = message || `Filled ${filled}/${total} fields`;
      statusEl.style.color = '#fff';
    } else {
      statusEl.textContent = message || 'Fill failed';
      statusEl.style.color = '#fecaca';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  }) as EventListener);

  wrap.appendChild(btn);
  wrap.appendChild(statusEl);
  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile section
// ─────────────────────────────────────────────────────────────────────────────

function buildProfileSection(): HTMLElement {
  const wrap = el('div');
  wrap.id = 'ow-profile-section';
  setStyles(wrap, {
    padding:       '8px 14px',
    borderBottom:  '1px solid #f4f3f0',
    display:       'flex',
    flexDirection: 'column',
    gap:           '0',
  });

  const active = currentProfiles.find(p => p.id === currentActiveId) ?? currentProfiles[0];
  const profileColor = active?.color ?? '#7c3aed';
  const profileName  = active?.name || 'My Profile';
  const isSetUp      = active ? currentSetupIds.has(active.id) : false;

  // Single compact row: [dot] [name · role] [arrow?] [manage]
  const headerRow = el('div');
  setStyles(headerRow, {
    display:     'flex',
    flexDirection: 'row',
    alignItems:  'center',
    gap:         '6px',
    padding:     '4px 0',
  });

  const dot = el('div');
  setStyles(dot, {
    width: '8px', height: '8px', borderRadius: '50%',
    background: profileColor, flexShrink: '0',
  });
  headerRow.appendChild(dot);

  const nameLabel = el('span');
  setStyles(nameLabel, {
    fontSize: '12px', fontWeight: '600', color: '#0a0a0a',
    lineHeight: '16px',
    flex: '1', minWidth: '0', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  });
  nameLabel.textContent = profileName;
  if (!isSetUp) {
    const badge = el('span');
    setStyles(badge, { fontSize: '9px', color: '#9e9b93', fontWeight: '400', marginLeft: '4px' });
    badge.textContent = '(needs setup)';
    nameLabel.appendChild(badge);
  }
  headerRow.appendChild(nameLabel);

  let dropdownEl: HTMLElement | null = null;
  let arrow: HTMLElement | null = null;
  if (currentProfiles.length > 1) {
    arrow = el('span');
    setStyles(arrow, { color: '#9e9b93', display: 'inline-flex', flexShrink: '0', cursor: 'pointer', transition: 'transform 0.2s' });
    setHTML(arrow, `<svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 5 7 9 11 5"/></svg>`);
    headerRow.appendChild(arrow);
  }

  const manageBtn = el('button');
  setStyles(manageBtn, {
    fontSize: '10px', color: '#7c3aed', background: 'none', border: 'none',
    cursor: 'pointer', padding: '0', fontFamily: 'inherit', flexShrink: '0',
    textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '2px',
    whiteSpace: 'nowrap',
  });
  manageBtn.textContent = 'Manage';
  manageBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('offlyn-open-profiles'));
  });
  headerRow.appendChild(manageBtn);

  wrap.appendChild(headerRow);

  // Dropdown (if >1 profile)
  if (currentProfiles.length > 1 && arrow) {
    dropdownEl = el('div');
    setStyles(dropdownEl, {
      display: 'none', flexDirection: 'column', gap: '1px',
      marginTop: '4px', background: '#f4f3f0', borderRadius: '6px',
      padding: '3px', border: '1px solid #e2e0da',
    });

    let dropOpen = false;
    const toggleDrop = () => {
      dropOpen = !dropOpen;
      dropdownEl!.style.display = dropOpen ? 'flex' : 'none';
      arrow!.style.transform = dropOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    };
    arrow.addEventListener('click', (e) => { e.stopPropagation(); toggleDrop(); });
    nameLabel.style.cursor = 'pointer';
    nameLabel.addEventListener('click', (e) => { e.stopPropagation(); toggleDrop(); });

    let bestFitId = '';
    let bestFitScore = -1;
    currentProfileScores.forEach((score, id) => {
      if (score > bestFitScore) { bestFitScore = score; bestFitId = id; }
    });

    currentProfiles.forEach(p => {
      const isActive = p.id === currentActiveId;
      const hasData = currentSetupIds.has(p.id);
      const score = currentProfileScores.get(p.id);
      const isBestFit = p.id === bestFitId && currentProfileScores.size > 1;
      const item = el('button');
      setStyles(item, {
        display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px',
        padding: '5px 6px', borderRadius: '4px', border: 'none',
        background: isActive ? '#e0e7ff' : isBestFit ? '#f0fdf4' : 'transparent',
        cursor: isActive ? 'default' : 'pointer',
        textAlign: 'left', fontFamily: 'inherit', width: '100%',
        opacity: hasData || isActive ? '1' : '0.7',
      });
      const itemDot = el('div');
      setStyles(itemDot, { width: '7px', height: '7px', borderRadius: '50%', background: p.color, flexShrink: '0' });
      item.appendChild(itemDot);

      const itemLabel = el('span');
      setStyles(itemLabel, {
        fontSize: '11px', fontWeight: isActive ? '600' : '400',
        color: isActive ? '#4338ca' : '#334155', flex: '1',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      });
      itemLabel.textContent = (p.name || 'Unnamed Profile') + (p.targetRole ? ` · ${p.targetRole}` : '');
      item.appendChild(itemLabel);

      if (score !== undefined) {
        const scorePill = el('span');
        const pillColor = isBestFit ? '#1a7f5a' : '#5a5750';
        setStyles(scorePill, {
          fontSize: '9px', fontWeight: '600', color: pillColor,
          background: isBestFit ? '#dcfce7' : '#f4f3f0',
          padding: '1px 5px', borderRadius: '8px', flexShrink: '0',
          lineHeight: '1.4',
        });
        scorePill.textContent = `${score}%`;
        item.appendChild(scorePill);
      }

      if (isBestFit) {
        const bestTag = el('span');
        setStyles(bestTag, {
          fontSize: '8px', fontWeight: '600', color: '#1a7f5a',
          flexShrink: '0', letterSpacing: '0.02em',
        });
        bestTag.textContent = 'Best fit';
        item.appendChild(bestTag);
      } else if (!hasData && !isActive) {
        const setupTag = el('span');
        setStyles(setupTag, { fontSize: '9px', color: '#9e9b93', flexShrink: '0' });
        setupTag.textContent = 'Set up';
        item.appendChild(setupTag);
      }
      if (isActive) {
        const check = el('span');
        setStyles(check, { color: '#4338ca', flexShrink: '0', fontSize: '10px' });
        check.textContent = '✓';
        item.appendChild(check);
      }

      if (!isActive) {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('offlyn-switch-profile', { detail: { profileId: p.id } }));
          dropdownEl!.style.display = 'none';
          dropOpen = false;
          arrow!.style.transform = 'rotate(0deg)';
        });
      }
      dropdownEl!.appendChild(item);
    });

    // "+ Set up new profile" link at bottom
    const newProfileBtn = el('button');
    setStyles(newProfileBtn, {
      display: 'flex', alignItems: 'center', gap: '4px',
      padding: '5px 6px', borderRadius: '4px', border: 'none', background: 'transparent',
      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%',
      fontSize: '10px', color: '#7c3aed', borderTop: '1px solid #e2e0da', marginTop: '2px',
    });
    newProfileBtn.textContent = '+ New profile';
    newProfileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('offlyn-open-profiles'));
    });
    dropdownEl.appendChild(newProfileBtn);

    wrap.appendChild(dropdownEl);
  }

  return wrap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resume accordion
// ─────────────────────────────────────────────────────────────────────────────

function buildResumeAccordion(data: CompatData): HTMLElement {
  const matched = data.skills.matched;
  const missing = data.skills.missing;
  const total = data.skills.total;
  const matchPct = total > 0 ? Math.round((matched.length / total) * 100) : 0;
  const statusLabel = matchPct >= 70 ? 'Good' : matchPct >= 40 ? 'Needs Work' : 'Needs Work';
  const statusColor = matchPct >= 70 ? '#16a34a' : '#dc2626';

  const body = el('div');
  setStyles(body, { paddingTop: '8px' });

  // Keyword match summary
  const matchLine = el('p');
  setStyles(matchLine, { fontSize: '12px', color: '#0a0a0a', margin: '0 0 6px', lineHeight: '1.4' });
  setHTML(matchLine, `Keyword Match - <span style="color:${statusColor};font-weight:600">${statusLabel}</span>`);
  body.appendChild(matchLine);

  const matchSub = el('p');
  setStyles(matchSub, { fontSize: '11px', color: '#5a5750', margin: '0 0 8px' });
  matchSub.textContent = `Your resume has ${matched.length} out of ${total} keywords`;
  body.appendChild(matchSub);

  body.appendChild(progressBar(matchPct, statusColor));

  // Missing keywords
  if (missing.length > 0) {
    const missingWrap = el('div');
    setStyles(missingWrap, { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' });
    missingWrap.appendChild(txt2('Missing', { fontSize: '9px', fontWeight: '600', color: '#9e9b93', textTransform: 'uppercase', letterSpacing: '0.5px' }));
    const badges = el('div');
    setStyles(badges, { display: 'flex', flexWrap: 'wrap', gap: '3px' });
    missing.forEach(kw => {
      const b = el('span');
      setStyles(b, { padding: '2px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: '500', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' });
      b.textContent = kw;
      badges.appendChild(b);
    });
    missingWrap.appendChild(badges);
    body.appendChild(missingWrap);
  }

  // Matched keywords
  if (matched.length > 0) {
    const matchWrap = el('div');
    setStyles(matchWrap, { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' });
    matchWrap.appendChild(txt2('Matched', { fontSize: '9px', fontWeight: '600', color: '#9e9b93', textTransform: 'uppercase', letterSpacing: '0.5px' }));
    const badges = el('div');
    setStyles(badges, { display: 'flex', flexWrap: 'wrap', gap: '3px' });
    matched.forEach(kw => {
      const b = el('span');
      setStyles(b, { padding: '2px 7px', borderRadius: '20px', fontSize: '10px', fontWeight: '500', background: '#f0fdf4', color: '#1a7f5a', border: '1px solid #dcfce7' });
      b.textContent = kw;
      badges.appendChild(b);
    });
    matchWrap.appendChild(badges);
    body.appendChild(matchWrap);
  }

  // Tailor Resume button
  const tailorBtn = el('button');
  setStyles(tailorBtn, {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
    width: '100%', padding: '8px 10px', borderRadius: '8px',
    background: '#16a34a', color: '#fff', border: 'none',
    fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
    marginTop: '8px', transition: 'background 0.15s',
  });
  setHTML(tailorBtn, `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z"/></svg>` + escHtml('Tailor Resume'));
  tailorBtn.addEventListener('mouseenter', () => { tailorBtn.style.background = '#15803d'; });
  tailorBtn.addEventListener('mouseleave', () => { tailorBtn.style.background = '#16a34a'; });
  tailorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('offlyn-tailor-resume'));
    window.dispatchEvent(new CustomEvent('offlyn-open-resume-tailor'));
  });
  body.appendChild(tailorBtn);

  return buildAccordion({
    iconBg: '#dcfce7',
    iconSvg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    label: 'Resume',
    statusText: statusLabel,
    statusColor,
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cover Letter accordion
// ─────────────────────────────────────────────────────────────────────────────

function buildCoverLetterAccordion(coverLetterFields: FieldSchema[]): HTMLElement {
  const hasField = coverLetterFields.length > 0;
  const filled = countFilled(coverLetterFields);
  const statusText = hasField ? (filled > 0 ? 'Filled' : 'Field Found') : 'No Field Found';
  const statusColor = filled > 0 ? '#16a34a' : hasField ? '#d97706' : '#9e9b93';

  const body = el('div');
  setStyles(body, { paddingTop: '8px' });

  if (hasField) {
    const info = el('p');
    setStyles(info, { fontSize: '11px', color: '#5a5750', margin: '0 0 8px', lineHeight: '1.4' });
    info.textContent = `Cover letter field detected on this page.`;
    body.appendChild(info);
  } else {
    const info = el('p');
    setStyles(info, { fontSize: '11px', color: '#9e9b93', margin: '0 0 8px', lineHeight: '1.4' });
    info.textContent = 'No cover letter field found on this page. You can still generate one to copy.';
    body.appendChild(info);
  }

  const genBtn = el('button');
  setStyles(genBtn, {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
    width: '100%', padding: '8px 10px', borderRadius: '8px',
    background: '#ea580c', color: '#fff', border: 'none',
    fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.15s',
  });
  genBtn.textContent = 'Generate Cover Letter';
  genBtn.addEventListener('mouseenter', () => { genBtn.style.background = '#c2410c'; });
  genBtn.addEventListener('mouseleave', () => { genBtn.style.background = '#ea580c'; });
  genBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('offlyn-generate-cover-letter'));
  });
  body.appendChild(genBtn);

  return buildAccordion({
    iconBg: '#ffedd5',
    iconSvg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    label: 'Cover Letter',
    statusText,
    statusColor,
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions accordion (used for both Unique and Common)
// ─────────────────────────────────────────────────────────────────────────────

function buildQuestionsAccordion(
  title: string,
  questionFields: FieldSchema[],
  iconBg: string,
  iconSvg: string,
): HTMLElement {
  const filled = countFilled(questionFields);
  const total = questionFields.length;
  const allFilled = filled === total && total > 0;
  const statusText = `Filled (${filled}/${total})`;
  const statusColor = allFilled ? '#16a34a' : '#9e9b93';

  const body = el('div');
  setStyles(body, { paddingTop: '4px' });

  questionFields.forEach((f, i) => {
    const row = el('div');
    setStyles(row, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 0',
      borderTop: i > 0 ? '1px solid #f4f3f0' : 'none',
    });

    const isFilled = !!(f.valuePreview && f.valuePreview.trim().length > 0);
    const checkSvg = isFilled
      ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round"><polyline points="2 6 5 9 10 3"/></svg>`
      : `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#d1d5db" stroke-width="1.5"><circle cx="6" cy="6" r="4.5"/></svg>`;
    const checkEl = el('span');
    setStyles(checkEl, { display: 'inline-flex', flexShrink: '0' });
    setHTML(checkEl, checkSvg);
    row.appendChild(checkEl);

    const label = el('span');
    setStyles(label, {
      fontSize: '11px', color: isFilled ? '#0a0a0a' : '#5a5750',
      fontWeight: isFilled ? '500' : '400',
      flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    });
    label.textContent = f.label || f.name || 'Unnamed field';
    row.appendChild(label);

    body.appendChild(row);
  });

  const lightBg = iconBg === '#7c3aed' ? '#f3e8ff' : '#e0f2fe';

  return buildAccordion({
    iconBg: lightBg,
    iconSvg,
    label: title,
    statusText,
    statusColor,
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Show less / Show more footer
// ─────────────────────────────────────────────────────────────────────────────

function buildShowLessFooter(accordionsContainer: HTMLElement): HTMLElement {
  let collapsed = false;

  const footer = el('button');
  setStyles(footer, {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
    width: '100%', padding: '8px 14px',
    background: '#f9fafb', border: 'none', borderTop: '1px solid #f4f3f0',
    fontSize: '12px', fontWeight: '500', color: '#5a5750',
    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.12s',
  });
  footer.textContent = 'Show less';

  const arrow = el('span');
  setStyles(arrow, { display: 'inline-flex', transition: 'transform 0.2s' });
  setHTML(arrow, `<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 9 7 5 11 9"/></svg>`);
  footer.appendChild(arrow);

  footer.addEventListener('mouseenter', () => { footer.style.background = '#f4f3f0'; });
  footer.addEventListener('mouseleave', () => { footer.style.background = '#f9fafb'; });

  footer.addEventListener('click', () => {
    collapsed = !collapsed;
    accordionsContainer.style.display = collapsed ? 'none' : 'flex';
    footer.textContent = collapsed ? 'Show more' : 'Show less';
    footer.appendChild(arrow);
    arrow.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  });

  return footer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

function el(tag: string): HTMLElement { return document.createElement(tag) as HTMLElement; }

function setStyles(e: HTMLElement, styles: Record<string, string>): void {
  Object.assign(e.style, styles);
}

function txt(parent: HTMLElement, content: string, styles: Record<string, string>): void {
  const s = el('span');
  Object.assign(s.style, styles);
  s.textContent = content;
  parent.appendChild(s);
}

function txt2(content: string, styles: Record<string, string>): HTMLElement {
  const s = el('span');
  Object.assign(s.style, styles);
  s.textContent = content;
  return s;
}

function progressBar(pct: number, color: string): HTMLElement {
  const track = el('div');
  setStyles(track, { height: '6px', background: '#e2e0da', borderRadius: '3px', overflow: 'hidden' });
  const fill = el('div');
  setStyles(fill, { height: '100%', width: `${pct}%`, background: color, borderRadius: '3px', transition: 'width 0.5s ease' });
  track.appendChild(fill);
  return track;
}


// ─────────────────────────────────────────────────────────────────────────────
// Score computation
// ─────────────────────────────────────────────────────────────────────────────

export function computeCompatibility(profile: UserProfile, pageText: string): CompatData {
  const text = pageText.toLowerCase();

  const userSkills = (profile.skills || []).map(s => s.toLowerCase().trim());
  const techDict   = [
    'react','typescript','javascript','node','python','java','sql','aws','azure','gcp',
    'docker','kubernetes','graphql','rest','css','html','vue','angular','go','rust',
    'swift','kotlin','scala','ruby','php','c#','c++','git','agile','scrum','terraform',
    'jenkins','linux','bash','figma','ux','ui','machine learning','pytorch','tensorflow',
    'spark','kafka','redis','mongodb','postgresql','mysql','spring','django','flask',
    'express','tailwind','jira','confluence','salesforce','tableau','powerbi','android',
    'ios','flutter','elasticsearch','cloudformation','ansible','chef','prometheus',
    'grafana','datadog','airflow','snowflake','bigquery','redshift','lambda',
    'microservices','serverless','devops','mlops','backend','frontend','fullstack',
  ];
  const inJob   = techDict.filter(s => text.includes(s));
  const matched = userSkills.filter(us => text.includes(us) || inJob.some(m => m.includes(us) || us.includes(m)));
  const missing = inJob.filter(m => !userSkills.some(us => us.includes(m) || m.includes(us))).slice(0, 5);
  const total   = Math.max(inJob.length, matched.length + missing.length, 1);
  const skillScore = Math.min(100, Math.max(10, Math.round((matched.length / total) * 100)));

  const yearsOwned = profile.professional?.yearsOfExperience ?? 0;
  const reqMatch   = text.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|exp)/i);
  const reqYears   = reqMatch ? parseInt(reqMatch[1]) : 3;
  const expScore   = Math.min(100, yearsOwned >= reqYears
    ? 90 + Math.min(10, yearsOwned - reqYears)
    : Math.max(40, Math.round((yearsOwned / reqYears) * 90)));
  const reqLabel   = reqMatch ? `${reqYears}+ years` : 'Relevant experience';
  const yoursLabel = yearsOwned ? `${yearsOwned} yr${yearsOwned !== 1 ? 's' : ''}` : 'Not set';

  const hasDegree = (profile.education ?? []).length > 0;
  const topDeg    = profile.education?.[0];
  const degreeStr = topDeg ? `${topDeg.degree}${topDeg.field ? ' in ' + topDeg.field : ''}` : 'Not specified';
  const degScore  = Math.min(100, hasDegree ? 88 : 50);
  const reqDeg    = text.includes('master') ? "Master's" : "Bachelor's degree";

  const isRemote  = text.includes('remote') || text.includes('work from home');
  const isHybrid  = text.includes('hybrid');
  const userLocRaw = profile.personal?.location;
  const userLoc   = typeof userLocRaw === 'string' ? userLocRaw : (userLocRaw as any)?.city ?? '';
  const locScore  = Math.min(100, isRemote ? 100 : isHybrid ? 90 : userLoc ? 70 : 55);
  const reqLoc    = isRemote ? 'Remote' : isHybrid ? 'Remote / Hybrid' : 'On-site';

  const salMatch  = text.match(/\$(\d[\d,]*)\s*[-–—]\s*\$(\d[\d,]*)/);
  const salScore  = salMatch ? 78 : 70;
  const salLabel  = salMatch ? `$${salMatch[1]} – $${salMatch[2]}` : 'Not listed';

  const overall = Math.min(100, Math.round(
    skillScore * 0.35 + expScore * 0.30 + degScore * 0.15 + locScore * 0.10 + salScore * 0.10
  ));

  let aiInsight = '';
  if (overall >= 85) {
    aiInsight = `<strong style="color:#1a7f5a">Strong candidate!</strong> Profile aligns well.`;
    if (missing.length) aiInsight += ` Consider: <em>${missing.slice(0,2).map(cap).join(', ')}</em>.`;
  } else if (overall >= 65) {
    aiInsight = `<strong style="color:#d97706">Good fit</strong> with some gaps.`;
    if (missing.length) aiInsight += ` Skills to add: <em>${missing.slice(0,3).map(cap).join(', ')}</em>.`;
  } else {
    aiInsight = `<strong style="color:#dc2626">Partial match.</strong> Tailor your resume. Gaps: `;
    aiInsight += missing.length ? `<em>${missing.slice(0,3).map(cap).join(', ')}</em>.` : 'review JD.';
  }

  return {
    overall,
    skills:     { score: skillScore, matched: matched.slice(0,6).map(cap), missing: missing.map(cap), total },
    experience: { score: expScore,   required: reqLabel,  yours: yoursLabel, match: yearsOwned >= reqYears },
    education:  { score: degScore,   required: reqDeg,    yours: degreeStr,  match: hasDegree },
    location:   { score: locScore,   required: reqLoc,    yours: userLoc,    match: locScore >= 75 },
    salary:     { score: salScore,   required: salLabel,  match: salScore >= 80 ? 'yes' : 'partial' },
    aiInsight,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Score helpers
// ─────────────────────────────────────────────────────────────────────────────

function scoreDot(s: number)      { return s >= 80 ? '#1a7f5a' : s >= 60 ? '#f59e0b' : '#ef4444'; }
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escHtml(s: string) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─────────────────────────────────────────────────────────────────────────────
// Base CSS (minimal — only animations + scrollbar; all layout is inline)
// ─────────────────────────────────────────────────────────────────────────────

function injectBaseCSS(sr: ShadowRoot): void {
  const s = document.createElement('style');
  s.textContent = `
    :host { all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.4; }
    * { box-sizing: border-box; font-family: inherit; line-height: normal; }
    .ow-scrollbody::-webkit-scrollbar { width: 3px; }
    .ow-scrollbody::-webkit-scrollbar-thumb { background: #e2e0da; border-radius: 2px; }
    button { font-family: inherit; cursor: pointer; }
    p { margin: 0; }
    @keyframes ow-swivel {
      0%   { transform: rotate(0deg)   scale(1);    }
      12%  { transform: rotate(-22deg) scale(1.10); }
      28%  { transform: rotate(18deg)  scale(1.07); }
      44%  { transform: rotate(-13deg) scale(1.04); }
      58%  { transform: rotate(9deg)   scale(1.02); }
      72%  { transform: rotate(-5deg)  scale(1.01); }
      86%  { transform: rotate(3deg)   scale(1);    }
      100% { transform: rotate(0deg)   scale(1);    }
    }
    @keyframes ow-glow-green {
      0%,100% { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0  0px  0px rgba(22,163,74,0);    }
      40%     { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0 20px 10px rgba(22,163,74,0.55); }
      70%     { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0 10px  4px rgba(22,163,74,0.28); }
    }
    @keyframes ow-glow-amber {
      0%,100% { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0  0px  0px rgba(245,158,11,0);    }
      40%     { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0 20px 10px rgba(245,158,11,0.55); }
      70%     { box-shadow: 0 4px 18px rgba(30,41,59,.22), 0 0 10px  4px rgba(245,158,11,0.28); }
    }
    .ow-anim-match {
      animation: ow-swivel 1.4s cubic-bezier(.36,.07,.19,.97) 0.35s 1 both,
                 ow-glow-amber 1.8s ease-in-out 0.35s 3 forwards;
    }
    .ow-anim-excellent {
      animation: ow-swivel 1.4s cubic-bezier(.36,.07,.19,.97) 0.35s 1 both,
                 ow-glow-green 1.8s ease-in-out 0.35s 3 forwards;
    }
  `;
  sr.appendChild(s);
}
