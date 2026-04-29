/**
 * Data Explorer page — renders profile, graph memory, and RL patterns
 * directly from browser.storage.local (no background message passing needed).
 */

import browser from '../shared/browser-compat';
import type { UserProfile } from '../shared/profile';
import type { GraphNode, GraphEdge, AnswerPayload, CorrectionPayload, ApplicationPayload } from '../shared/graph/types';
import type { LearnedPattern, CorrectionEvent } from '../shared/learning-types';
import { formatPhone, formatLocation } from '../shared/profile';

// ── Storage keys (mirrored to avoid importing service layer) ─────────────────
const STORAGE = {
  profile: 'userProfile',
  graphNodes: 'graph_nodes',
  graphEdges: 'graph_edges',
  graphMeta: 'graph_meta',
  rlPatterns: 'rl_learned_patterns',
  rlCorrections: 'rl_correction_events',
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function confColor(c: number): string {
  if (c >= 0.75) return 'conf-high';
  if (c >= 0.5) return 'conf-mid';
  return 'conf-low';
}

function confLabel(c: number): string {
  const pct = Math.round(c * 100);
  return `${pct}%`;
}

function sourceBadgeClass(source: string): string {
  if (source === 'profile') return 'badge-profile';
  if (source === 'llm') return 'badge-llm';
  if (source === 'user') return 'badge-user';
  return 'badge-learned';
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function initTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  const contents = document.querySelectorAll<HTMLElement>('.content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab!;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === target));
      contents.forEach(c => {
        c.classList.toggle('active', c.id === `tab-${target}`);
      });
    });
  });
}

// ── Profile tab ───────────────────────────────────────────────────────────────

function renderProfile(profile: UserProfile): void {
  const loading = document.getElementById('profile-loading')!;
  const empty   = document.getElementById('profile-empty')!;
  const content = document.getElementById('profile-content')!;

  loading.style.display = 'none';

  if (!profile) {
    empty.style.display = 'flex';
    return;
  }

  content.style.display = 'block';

  // Personal info grid
  const personalGrid = document.getElementById('personal-grid')!;
  const p = profile.personal;
  const pro = profile.professional ?? {};
  const phoneStr = p.phone ? formatPhone(p.phone) : null;
  const locationStr = p.location ? formatLocation(p.location) : null;

  const personalItems: Array<[string, string | null | undefined]> = [
    ['First Name', p.firstName],
    ['Last Name', p.lastName],
    ['Email', p.email],
    ['Phone', phoneStr],
    ['Location', locationStr],
    ['LinkedIn', pro.linkedin],
    ['GitHub', pro.github],
    ['Portfolio', pro.portfolio],
    ['Years of Exp.', pro.yearsOfExperience != null ? String(pro.yearsOfExperience) : null],
  ];

  personalGrid.innerHTML = personalItems
    .filter(([, v]) => v)
    .map(([label, val]) => {
      const isUrl = String(val).startsWith('http') || String(val).includes('.com');
      const display = isUrl
        ? `<a href="${esc(val!)}" target="_blank" rel="noopener">${esc(val!)}</a>`
        : esc(val!);
      return `<div class="info-item">
        <div class="info-label">${esc(label)}</div>
        <div class="info-value">${display}</div>
      </div>`;
    })
    .join('');

  // Summary
  if (profile.summary) {
    const sec = document.getElementById('summary-section')!;
    sec.style.display = 'block';
    document.getElementById('summary-text')!.textContent = profile.summary;
  }

  // Work auth
  if (profile.workAuth) {
    const sec = document.getElementById('workauth-section')!;
    sec.style.display = 'block';
    const wa = profile.workAuth;
    const badges: string[] = [];
    if (wa.legallyAuthorized) {
      badges.push(`<span class="auth-badge authorized">✓ Legally authorized to work</span>`);
    }
    if (wa.requiresSponsorship) {
      badges.push(`<span class="auth-badge sponsorship">⚠ Requires sponsorship</span>`);
    } else {
      badges.push(`<span class="auth-badge authorized">✓ No sponsorship needed</span>`);
    }
    if (wa.currentStatus) {
      badges.push(`<span class="auth-badge authorized">🪪 ${esc(wa.currentStatus)}</span>`);
    }
    document.getElementById('workauth-badges')!.innerHTML = badges.join('');
  }

  // Work history
  if (profile.work?.length) {
    const sec = document.getElementById('work-section')!;
    sec.style.display = 'block';
    const timeline = document.getElementById('work-timeline')!;
    timeline.innerHTML = profile.work.map((job, i) => {
      const isLast = i === profile.work.length - 1;
      const dateRange = job.current
        ? `${esc(job.startDate)} – Present`
        : `${esc(job.startDate)} – ${esc(job.endDate)}`;
      return `<div class="timeline-item">
        <div class="timeline-dot-col">
          <div class="timeline-dot"></div>
          ${!isLast ? '<div class="timeline-line"></div>' : ''}
        </div>
        <div class="timeline-body">
          <div class="timeline-header">
            <div>
              <div class="timeline-title">${esc(job.title)}${job.current ? '<span class="badge-current">Current</span>' : ''}</div>
              <div class="timeline-company">${esc(job.company)}</div>
            </div>
            <div class="timeline-date">${dateRange}</div>
          </div>
          ${job.description ? `<div class="timeline-desc">${esc(job.description)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // Education
  if (profile.education?.length) {
    const sec = document.getElementById('edu-section')!;
    sec.style.display = 'block';
    const grid = document.getElementById('edu-grid')!;
    grid.innerHTML = profile.education.map(edu => `
      <div class="edu-item">
        <div class="edu-icon">🎓</div>
        <div class="edu-body">
          <div class="edu-school">${esc(edu.school)}</div>
          <div class="edu-degree">${esc(edu.degree)}${edu.field ? ` · ${esc(edu.field)}` : ''}</div>
          ${edu.graduationYear ? `<div class="edu-year">Class of ${esc(edu.graduationYear)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  // Skills
  if (profile.skills?.length) {
    const sec = document.getElementById('skills-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('skills-list')!;
    list.innerHTML = profile.skills
      .map(s => `<span class="skill-tag">${esc(s)}</span>`)
      .join('');
  }
}

// ── Graph Memory tab ──────────────────────────────────────────────────────────

function renderGraph(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>
): void {
  const loading = document.getElementById('graph-loading')!;
  const empty   = document.getElementById('graph-empty')!;
  const content = document.getElementById('graph-content')!;
  loading.style.display = 'none';

  const allNodes = Object.values(nodes);
  const allEdges = Object.values(edges);

  if (!allNodes.length) {
    empty.style.display = 'flex';
    return;
  }

  content.style.display = 'block';

  // Count by type
  const counts: Record<string, number> = {};
  for (const n of allNodes) counts[n.type] = (counts[n.type] ?? 0) + 1;

  // Stats row
  const statsRow = document.getElementById('graph-stats-row')!;
  const statItems: Array<[string, number, string]> = [
    ['Total Nodes', allNodes.length, ''],
    ['Questions', counts['question'] ?? 0, '#1d4ed8'],
    ['Answers', counts['answer'] ?? 0, '#16a34a'],
    ['Fields', counts['field'] ?? 0, '#7c3aed'],
    ['Corrections', counts['correction'] ?? 0, '#c2410c'],
    ['Applications', counts['application'] ?? 0, ''],
    ['Edges', allEdges.length, ''],
  ];
  statsRow.innerHTML = statItems.map(([label, num, color]) => `
    <div class="stat-pill">
      <div class="stat-num" style="${color ? `color:${color}` : ''}">${num}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>`).join('');

  // Update tab badge
  const badge = document.getElementById('tab-badge-graph')!;
  badge.textContent = String(allNodes.length);

  // Top answers — sort by usageCount descending, take top 30
  const answerNodes = allNodes
    .filter(n => n.type === 'answer')
    .sort((a, b) => {
      const pa = a.payload as AnswerPayload;
      const pb = b.payload as AnswerPayload;
      return (pb.usageCount ?? 0) - (pa.usageCount ?? 0);
    })
    .slice(0, 30);

  // Build question lookup for context
  const questionById: Record<string, GraphNode> = {};
  for (const n of allNodes) {
    if (n.type === 'question') questionById[n.id] = n;
  }

  // Build edge index: answer -> question (DERIVED_FROM edges)
  const answerToQuestion: Record<string, string> = {};
  for (const e of allEdges) {
    if (e.type === 'DERIVED_FROM') {
      answerToQuestion[e.from] = e.to;
    }
  }
  // Also ANSWERED_BY edges: question -> answer
  const questionForAnswer: Record<string, string> = {};
  for (const e of allEdges) {
    if (e.type === 'ANSWERED_BY') {
      questionForAnswer[e.to] = e.from;
    }
  }

  if (answerNodes.length) {
    const sec = document.getElementById('graph-answers-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('graph-answers-list')!;
    list.innerHTML = answerNodes.map(n => {
      const p = n.payload as AnswerPayload;
      const qId = answerToQuestion[n.id] ?? questionForAnswer[n.id];
      const qNode = qId ? questionById[qId] : null;
      const questionLabel = qNode
        ? (qNode.payload as any).rawText ?? (qNode.payload as any).normalizedText ?? ''
        : '';
      return `<div class="answer-row">
        <div class="answer-meta">
          ${questionLabel ? `<div class="answer-question">${esc(questionLabel.slice(0, 80))}${questionLabel.length > 80 ? '…' : ''}</div>` : ''}
          <div class="answer-value">${esc(String(p.value ?? '').slice(0, 200))}${String(p.value ?? '').length > 200 ? '…' : ''}</div>
          <div class="answer-source-row">
            <span class="badge ${sourceBadgeClass(p.source ?? '')}">${esc(p.source ?? 'unknown')}</span>
            ${p.confidence != null ? `<span style="font-size:11px;color:var(--text-faint)">conf ${Math.round(p.confidence * 100)}%</span>` : ''}
            <span style="font-size:11px;color:var(--text-faint)">${timeAgo(p.lastUsedAt)}</span>
          </div>
        </div>
        <div class="answer-usage">${p.usageCount ?? 0}×</div>
      </div>`;
    }).join('');
  }

  // Corrections
  const correctionNodes = allNodes.filter(n => n.type === 'correction');
  if (correctionNodes.length) {
    const sec = document.getElementById('graph-corrections-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('graph-corrections-list')!;
    list.innerHTML = correctionNodes.map(n => {
      const p = n.payload as CorrectionPayload;
      return `<div class="correction-row">
        <div class="correction-arrow">✏</div>
        <div class="correction-body">
          <div class="correction-old">${esc(String(p.originalValue ?? '').slice(0, 100))}</div>
          <div class="correction-new">${esc(String(p.correctedValue ?? '').slice(0, 120))}</div>
          ${p.context?.company ? `<div class="correction-field">@ ${esc(p.context.company)}${p.context.jobTitle ? ` · ${esc(p.context.jobTitle)}` : ''}</div>` : ''}
          <div class="correction-field">${timeAgo(n.updatedAt)}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Applications
  const appNodes = allNodes.filter(n => n.type === 'application');
  if (appNodes.length) {
    const sec = document.getElementById('graph-apps-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('graph-apps-list')!;
    list.innerHTML = appNodes
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 15)
      .map(n => {
        const p = n.payload as ApplicationPayload;
        return `<div class="answer-row">
          <div class="answer-meta">
            <div class="answer-value">${esc(p.company ?? 'Unknown company')}</div>
            <div class="answer-source-row">
              ${p.jobTitle ? `<span style="font-size:12px;color:var(--text-muted)">${esc(p.jobTitle)}</span>` : ''}
              ${p.platform ? `<span class="badge badge-profile">${esc(p.platform)}</span>` : ''}
              <span style="font-size:11px;color:var(--text-faint)">${timeAgo(n.updatedAt)}</span>
            </div>
          </div>
        </div>`;
      }).join('');
  }
}

// ── RL Patterns tab ───────────────────────────────────────────────────────────

function renderRL(patterns: LearnedPattern[], corrections: CorrectionEvent[]): void {
  const loading = document.getElementById('rl-loading')!;
  const empty   = document.getElementById('rl-empty')!;
  const content = document.getElementById('rl-content')!;
  loading.style.display = 'none';

  if (!patterns.length && !corrections.length) {
    empty.style.display = 'flex';
    return;
  }

  content.style.display = 'block';

  const highConf = patterns.filter(p => p.confidence >= 0.75).length;
  const midConf  = patterns.filter(p => p.confidence >= 0.5 && p.confidence < 0.75).length;
  const lowConf  = patterns.filter(p => p.confidence < 0.5).length;

  // Stats
  const statsRow = document.getElementById('rl-stats-row')!;
  statsRow.innerHTML = [
    ['Total Patterns', patterns.length, ''],
    ['High Confidence', highConf, '#16a34a'],
    ['Medium Conf.', midConf, '#f59e0b'],
    ['Low Confidence', lowConf, '#ef4444'],
    ['Corrections', corrections.length, '#7c3aed'],
  ].map(([label, num, color]) => `
    <div class="stat-pill">
      <div class="stat-num" style="${color ? `color:${color}` : ''}">${num}</div>
      <div class="stat-label">${esc(label as string)}</div>
    </div>`).join('');

  // Update tab badge
  const badge = document.getElementById('tab-badge-rl')!;
  badge.textContent = String(patterns.length);

  // Patterns sorted by confidence desc
  if (patterns.length) {
    const sec = document.getElementById('rl-patterns-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('rl-patterns-list')!;
    const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);
    list.innerHTML = sorted.map(p => {
      const barClass = confColor(p.confidence);
      const learned = String(p.learnedValue ?? '');
      return `<div class="rl-row">
        <div class="rl-row-header">
          <div class="rl-field">${esc(p.fieldLabel || 'Unknown field')}</div>
          <div class="rl-conf" style="color:${p.confidence >= 0.75 ? '#16a34a' : p.confidence >= 0.5 ? '#f59e0b' : '#ef4444'}">${confLabel(p.confidence)}</div>
        </div>
        <div class="conf-bar-wrap"><div class="conf-bar ${barClass}" style="width:${Math.round(p.confidence * 100)}%"></div></div>
        <div class="rl-value">→ <strong>${esc(learned.slice(0, 120))}${learned.length > 120 ? '…' : ''}</strong></div>
        <div class="rl-meta">
          type: ${esc(p.fieldType || 'text')}
          · success ${p.successCount ?? 0}× / fail ${p.failureCount ?? 0}×
          ${p.lastUsed ? ` · ${timeAgo(p.lastUsed)}` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // Correction events
  if (corrections.length) {
    const sec = document.getElementById('rl-corr-section')!;
    sec.style.display = 'block';
    const list = document.getElementById('rl-corr-list')!;
    const sorted = [...corrections].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    list.innerHTML = sorted.slice(0, 30).map(c => `
      <div class="correction-row">
        <div class="correction-arrow">✏</div>
        <div class="correction-body">
          <div class="correction-old">${esc(String(c.autoFilledValue ?? '').slice(0, 100))}</div>
          <div class="correction-new">${esc(String(c.userCorrectedValue ?? '').slice(0, 120))}</div>
          <div class="correction-field">
            ${esc(c.fieldLabel || 'unknown field')}
            ${c.timestamp ? ` · ${timeAgo(c.timestamp)}` : ''}
          </div>
        </div>
      </div>`).join('');
  }
}

// ── Force-directed flowchart ──────────────────────────────────────────────────

interface SimNode {
  id: string;
  type: string;
  label: string;
  detail: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // radius
}

interface SimEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  question:    { fill: '#eff6ff', stroke: '#3b82f6', text: '#1d4ed8' },
  answer:      { fill: '#f0fdf4', stroke: '#22c55e', text: '#15803d' },
  field:       { fill: '#faf5ff', stroke: '#a855f7', text: '#7c3aed' },
  correction:  { fill: '#fff7ed', stroke: '#f97316', text: '#c2410c' },
  application: { fill: '#f8fafc', stroke: '#94a3b8', text: '#475569' },
};
const NODE_COLORS_DARK: Record<string, { fill: string; stroke: string; text: string }> = {
  question:    { fill: '#1e3a5f', stroke: '#60a5fa', text: '#93c5fd' },
  answer:      { fill: '#14532d', stroke: '#4ade80', text: '#86efac' },
  field:       { fill: '#2e1065', stroke: '#c084fc', text: '#d8b4fe' },
  correction:  { fill: '#431407', stroke: '#fb923c', text: '#fdba74' },
  application: { fill: '#1e293b', stroke: '#64748b', text: '#94a3b8' },
};

const EDGE_LABEL_COLORS: Record<string, string> = {
  ANSWERED_BY:   '#22c55e',
  MAPS_TO:       '#a855f7',
  SIMILAR_TO:    '#3b82f6',
  USED_IN:       '#94a3b8',
  CORRECTED_TO:  '#f97316',
  DERIVED_FROM:  '#f59e0b',
};

// Max nodes per type shown in the visualization (keeps it readable)
const MAX_PER_TYPE: Record<string, number> = {
  question: 40,
  answer: 40,
  field: 30,
  correction: 15,
  application: 10,
};

let fcNodes: SimNode[] = [];
let fcEdges: SimEdge[] = [];
let fcAnimFrame = 0;
let fcTransform = { x: 0, y: 0, scale: 1 };
let fcSelectedId: string | null = null;
let fcFilters: Record<string, boolean> = {
  question: true, answer: true, field: true, correction: false, application: false,
};

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

function nodeColors(type: string) {
  return (isDark() ? NODE_COLORS_DARK : NODE_COLORS)[type] ?? NODE_COLORS['application'];
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function nodeLabel(n: GraphNode): string {
  const p = n.payload as any;
  switch (n.type) {
    case 'question':    return truncate(p.rawText ?? p.normalizedText ?? '', 35);
    case 'answer':      return truncate(String(p.value ?? ''), 35);
    case 'field':       return truncate(p.canonicalField ?? '', 25);
    case 'correction':  return truncate(String(p.correctedValue ?? ''), 30);
    case 'application': return truncate(p.company ?? p.jobTitle ?? '', 30);
    default:            return n.id.slice(0, 12);
  }
}

function nodeDetail(n: GraphNode): string {
  const p = n.payload as any;
  switch (n.type) {
    case 'question':    return p.rawText ?? '';
    case 'answer':      return `${String(p.value ?? '')} · src: ${p.source ?? ''} · used: ${p.usageCount ?? 0}×`;
    case 'field':       return `aliases: ${(p.aliases ?? []).slice(0, 3).join(', ')}`;
    case 'correction':  return `${p.originalValue ?? ''} → ${p.correctedValue ?? ''}`;
    case 'application': return `${p.company ?? ''} · ${p.jobTitle ?? ''} · ${p.platform ?? ''}`;
    default:            return '';
  }
}

// Simple force simulation — runs inline (synchronously, fixed iterations)
function runSimulation(nodes: SimNode[], edges: SimEdge[], W: number, H: number): void {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const REPEL = 2200;
  const SPRING_LENGTH = 110;
  const SPRING_K = 0.04;
  const DAMPING = 0.82;
  const ITERATIONS = 250;
  const GRAVITY = 0.015; // pull toward center

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Repulsion between all node pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.5;
        const force = REPEL / (dist * dist);
        a.vx += force * dx / dist;
        a.vy += force * dy / dist;
        b.vx -= force * dx / dist;
        b.vy -= force * dy / dist;
      }
    }

    // Spring attraction along edges
    for (const e of edges) {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.5;
      const stretch = dist - SPRING_LENGTH;
      const force = SPRING_K * stretch;
      a.vx += force * dx / dist;
      a.vy += force * dy / dist;
      b.vx -= force * dx / dist;
      b.vy -= force * dy / dist;
    }

    // Gravity toward center
    const cx = W / 2, cy = H / 2;
    for (const n of nodes) {
      n.vx += (cx - n.x) * GRAVITY;
      n.vy += (cy - n.y) * GRAVITY;
    }

    // Integrate
    for (const n of nodes) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x = Math.max(n.r + 4, Math.min(W - n.r - 4, n.x + n.vx));
      n.y = Math.max(n.r + 4, Math.min(H - n.r - 4, n.y + n.vy));
    }
  }
}

function buildFlowchartData(
  rawNodes: Record<string, GraphNode>,
  rawEdges: Record<string, GraphEdge>
): void {
  const allNodes = Object.values(rawNodes);
  const allEdges = Object.values(rawEdges);

  // Filter and cap per type
  const countPerType: Record<string, number> = {};
  const visibleNodeIds = new Set<string>();

  // Sort answer nodes by usageCount so we show the most used ones
  const sorted = [...allNodes].sort((a, b) => {
    const ua = (a.payload as any).usageCount ?? 0;
    const ub = (b.payload as any).usageCount ?? 0;
    return ub - ua;
  });

  for (const n of sorted) {
    const max = MAX_PER_TYPE[n.type] ?? 20;
    countPerType[n.type] = (countPerType[n.type] ?? 0);
    if (countPerType[n.type] < max) {
      visibleNodeIds.add(n.id);
      countPerType[n.type]++;
    }
  }

  const wrap = document.getElementById('flowchart-wrap')!;
  const W = wrap.clientWidth || 800;
  const H = wrap.clientHeight || 500;

  fcNodes = sorted
    .filter(n => visibleNodeIds.has(n.id))
    .map(n => ({
      id: n.id,
      type: n.type,
      label: nodeLabel(n),
      detail: nodeDetail(n),
      x: W / 2 + (Math.random() - 0.5) * W * 0.7,
      y: H / 2 + (Math.random() - 0.5) * H * 0.7,
      vx: 0, vy: 0,
      r: n.type === 'field' ? 26 : n.type === 'question' ? 22 : 18,
    }));

  fcEdges = allEdges
    .filter(e => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to))
    .map(e => ({
      id: e.id,
      from: e.from,
      to: e.to,
      label: e.type,
    }));

  runSimulation(fcNodes, fcEdges, W, H);
  fcTransform = { x: 0, y: 0, scale: 1 };
  fcSelectedId = null;
}

function renderFlowchart(): void {
  const svg = document.getElementById('flowchart-svg') as unknown as SVGSVGElement;
  const edgesG = document.getElementById('fc-edges')!;
  const nodesG = document.getElementById('fc-nodes')!;
  const emptyDiv = document.getElementById('flowchart-empty')!;

  const visibleTypes = Object.entries(fcFilters)
    .filter(([, on]) => on)
    .map(([t]) => t);

  const visNodes = fcNodes.filter(n => visibleTypes.includes(n.type));
  const visNodeIds = new Set(visNodes.map(n => n.id));
  const visEdges = fcEdges.filter(e => visNodeIds.has(e.from) && visNodeIds.has(e.to));

  if (!visNodes.length) {
    emptyDiv.classList.add('show');
    edgesG.innerHTML = '';
    nodesG.innerHTML = '';
    return;
  }
  emptyDiv.classList.remove('show');

  // Apply viewport transform
  const vp = document.getElementById('fc-viewport')!;
  vp.setAttribute('transform', `translate(${fcTransform.x},${fcTransform.y}) scale(${fcTransform.scale})`);

  // Build lookup
  const nodeById = new Map(visNodes.map(n => [n.id, n]));

  // Render edges
  const ns = 'http://www.w3.org/2000/svg';
  const selectedNeighbours = fcSelectedId
    ? new Set(visEdges.filter(e => e.from === fcSelectedId || e.to === fcSelectedId).flatMap(e => [e.from, e.to]))
    : null;

  edgesG.innerHTML = '';
  for (const e of visEdges) {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    if (!a || !b) continue;

    const isHighlit = fcSelectedId && (e.from === fcSelectedId || e.to === fcSelectedId);
    const isGhosted = fcSelectedId && !isHighlit;

    // Offset line endpoints to stop at node rim
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
    const x1 = a.x + dx / dist * a.r;
    const y1 = a.y + dy / dist * a.r;
    const x2 = b.x - dx / dist * (b.r + 8);
    const y2 = b.y - dy / dist * (b.r + 8);

    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', isHighlit ? '#f59e0b' : '#94a3b8');
    line.setAttribute('stroke-width', isHighlit ? '2' : '1');
    line.setAttribute('stroke-opacity', isGhosted ? '0.15' : isHighlit ? '1' : '0.5');
    line.setAttribute('marker-end', isHighlit ? 'url(#arrow-hi)' : 'url(#arrow)');
    edgesG.appendChild(line);

    // Edge label (only when highlighted or graph is small)
    if (isHighlit || visEdges.length <= 20) {
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const txt = document.createElementNS(ns, 'text');
      txt.setAttribute('x', String(mx));
      txt.setAttribute('y', String(my - 4));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', EDGE_LABEL_COLORS[e.label] ?? '#94a3b8');
      txt.setAttribute('font-size', '9');
      txt.setAttribute('font-weight', '700');
      txt.setAttribute('opacity', isGhosted ? '0.1' : '0.85');
      txt.textContent = e.label;
      edgesG.appendChild(txt);
    }
  }

  // Render nodes
  nodesG.innerHTML = '';
  for (const n of visNodes) {
    const isSelected = n.id === fcSelectedId;
    const isNeighbour = selectedNeighbours?.has(n.id) ?? false;
    const isGhosted = fcSelectedId && !isSelected && !isNeighbour;

    const col = nodeColors(n.type);
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);
    g.setAttribute('class', 'fc-node-g');
    g.setAttribute('data-id', n.id);
    g.setAttribute('opacity', isGhosted ? '0.2' : '1');
    g.style.cursor = 'pointer';

    // Circle
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('r', String(n.r));
    circle.setAttribute('fill', col.fill);
    circle.setAttribute('stroke', isSelected ? '#f59e0b' : col.stroke);
    circle.setAttribute('stroke-width', isSelected ? '3' : '1.5');
    g.appendChild(circle);

    // Label text
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('fill', col.text);
    text.setAttribute('font-size', n.r > 22 ? '9.5' : '8.5');
    text.setAttribute('font-weight', '600');
    text.setAttribute('pointer-events', 'none');

    // Wrap long labels to 2 lines
    const words = n.label.split(' ');
    if (words.length > 3 && n.label.length > 18) {
      const half = Math.ceil(words.length / 2);
      const line1 = document.createElementNS(ns, 'tspan');
      line1.setAttribute('x', '0');
      line1.setAttribute('dy', '-6');
      line1.textContent = words.slice(0, half).join(' ');
      const line2 = document.createElementNS(ns, 'tspan');
      line2.setAttribute('x', '0');
      line2.setAttribute('dy', '12');
      line2.textContent = words.slice(half).join(' ');
      text.appendChild(line1);
      text.appendChild(line2);
    } else {
      text.textContent = n.label;
    }
    g.appendChild(text);

    nodesG.appendChild(g);
  }

  // Wire up node click + hover events after render
  nodesG.querySelectorAll<SVGGElement>('.fc-node-g').forEach(g => {
    const id = g.dataset.id!;
    g.addEventListener('click', (ev) => {
      ev.stopPropagation();
      fcSelectedId = fcSelectedId === id ? null : id;
      renderFlowchart();
    });
    g.addEventListener('mousemove', (ev: MouseEvent) => {
      const n = fcNodes.find(x => x.id === id);
      if (!n) return;
      const tt = document.getElementById('fc-tooltip')!;
      tt.style.display = 'block';
      tt.style.left = `${ev.clientX + 14}px`;
      tt.style.top  = `${ev.clientY - 10}px`;
      tt.innerHTML = `<strong>${esc(n.label)}</strong><span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-faint)">${esc(n.type)}</span>${n.detail ? `<div class="fc-tt-meta">${esc(n.detail.slice(0, 180))}</div>` : ''}`;
    });
    g.addEventListener('mouseleave', () => {
      document.getElementById('fc-tooltip')!.style.display = 'none';
    });
  });

  // Drag individual nodes
  wireNodeDrag();
}

function wireNodeDrag(): void {
  const nodesG = document.getElementById('fc-nodes')!;
  let dragging: SimNode | null = null;
  let dragOffX = 0, dragOffY = 0;

  nodesG.querySelectorAll<SVGGElement>('.fc-node-g').forEach(g => {
    g.addEventListener('mousedown', (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      const id = g.dataset.id!;
      dragging = fcNodes.find(n => n.id === id) ?? null;
      if (!dragging) return;
      const pt = svgPoint(ev);
      dragOffX = pt.x - dragging.x;
      dragOffY = pt.y - dragging.y;
    });
  });

  const svg = document.getElementById('flowchart-svg')!;
  svg.addEventListener('mousemove', (ev: MouseEvent) => {
    if (!dragging) return;
    const pt = svgPoint(ev);
    dragging.x = pt.x - dragOffX;
    dragging.y = pt.y - dragOffY;
    dragging.vx = 0;
    dragging.vy = 0;
    renderFlowchart();
  });
  svg.addEventListener('mouseup', () => { dragging = null; });
}

function svgPoint(ev: MouseEvent): { x: number; y: number } {
  const svg = document.getElementById('flowchart-svg') as unknown as SVGSVGElement;
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: ev.clientX, y: ev.clientY };
  const inv = ctm.inverse();
  const world = pt.matrixTransform(inv);
  // Account for viewport transform
  return {
    x: (world.x - fcTransform.x) / fcTransform.scale,
    y: (world.y - fcTransform.y) / fcTransform.scale,
  };
}

function initFlowchartInteraction(): void {
  const wrap = document.getElementById('flowchart-wrap')!;
  const svg  = document.getElementById('flowchart-svg')!;

  // Pan via canvas drag
  let panning = false;
  let panStart = { x: 0, y: 0 };
  let panOrigin = { x: 0, y: 0 };

  wrap.addEventListener('mousedown', (ev: MouseEvent) => {
    if ((ev.target as Element).closest('.fc-node-g')) return;
    panning = true;
    panStart = { x: ev.clientX, y: ev.clientY };
    panOrigin = { x: fcTransform.x, y: fcTransform.y };
    ev.preventDefault();
  });
  window.addEventListener('mousemove', (ev: MouseEvent) => {
    if (!panning) return;
    fcTransform.x = panOrigin.x + (ev.clientX - panStart.x);
    fcTransform.y = panOrigin.y + (ev.clientY - panStart.y);
    document.getElementById('fc-viewport')!
      .setAttribute('transform', `translate(${fcTransform.x},${fcTransform.y}) scale(${fcTransform.scale})`);
  });
  window.addEventListener('mouseup', () => { panning = false; });

  // Zoom via scroll
  wrap.addEventListener('wheel', (ev: WheelEvent) => {
    ev.preventDefault();
    const factor = ev.deltaY < 0 ? 1.1 : 0.91;
    const rect = wrap.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    fcTransform.x = mx - (mx - fcTransform.x) * factor;
    fcTransform.y = my - (my - fcTransform.y) * factor;
    fcTransform.scale = Math.max(0.15, Math.min(4, fcTransform.scale * factor));
    document.getElementById('fc-viewport')!
      .setAttribute('transform', `translate(${fcTransform.x},${fcTransform.y}) scale(${fcTransform.scale})`);
  }, { passive: false });

  // Deselect on background click
  svg.addEventListener('click', (ev) => {
    if (!(ev.target as Element).closest('.fc-node-g')) {
      fcSelectedId = null;
      renderFlowchart();
    }
  });

  // Zoom buttons
  document.getElementById('fc-zoom-in')?.addEventListener('click', () => {
    const wrap2 = document.getElementById('flowchart-wrap')!;
    const cx = wrap2.clientWidth / 2, cy = wrap2.clientHeight / 2;
    fcTransform.x = cx - (cx - fcTransform.x) * 1.2;
    fcTransform.y = cy - (cy - fcTransform.y) * 1.2;
    fcTransform.scale = Math.min(4, fcTransform.scale * 1.2);
    renderFlowchart();
  });
  document.getElementById('fc-zoom-out')?.addEventListener('click', () => {
    const wrap2 = document.getElementById('flowchart-wrap')!;
    const cx = wrap2.clientWidth / 2, cy = wrap2.clientHeight / 2;
    fcTransform.x = cx - (cx - fcTransform.x) * 0.83;
    fcTransform.y = cy - (cy - fcTransform.y) * 0.83;
    fcTransform.scale = Math.max(0.15, fcTransform.scale * 0.83);
    renderFlowchart();
  });
  document.getElementById('fc-fit')?.addEventListener('click', () => {
    fitFlowchart();
  });

  // Filter checkboxes
  const filterMap: Record<string, string> = {
    'fc-show-question':    'question',
    'fc-show-answer':      'answer',
    'fc-show-field':       'field',
    'fc-show-correction':  'correction',
    'fc-show-application': 'application',
  };
  Object.entries(filterMap).forEach(([elId, type]) => {
    const el = document.getElementById(elId) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener('change', () => {
      fcFilters[type] = el.checked;
      renderFlowchart();
    });
  });
}

function fitFlowchart(): void {
  const wrap = document.getElementById('flowchart-wrap')!;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if (!fcNodes.length) return;

  const visNodes = fcNodes.filter(n => fcFilters[n.type]);
  if (!visNodes.length) return;

  const xs = visNodes.map(n => n.x);
  const ys = visNodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pad = 50;
  const scaleX = (W - pad * 2) / (maxX - minX + 1);
  const scaleY = (H - pad * 2) / (maxY - minY + 1);
  const scale = Math.max(0.2, Math.min(2, Math.min(scaleX, scaleY)));
  fcTransform.scale = scale;
  fcTransform.x = pad + (-minX) * scale;
  fcTransform.y = pad + (-minY) * scale;
  renderFlowchart();
}

let _fcRawNodes: Record<string, GraphNode> = {};
let _fcRawEdges: Record<string, GraphEdge> = {};

function initFlowchartFromData(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>
): void {
  _fcRawNodes = nodes;
  _fcRawEdges = edges;

  if (!Object.keys(nodes).length) {
    document.getElementById('flowchart-empty')!.classList.add('show');
    return;
  }

  buildFlowchartData(nodes, edges);
  renderFlowchart();
  // Auto-fit after first render
  requestAnimationFrame(() => fitFlowchart());
}

// ── Export / Import ───────────────────────────────────────────────────────────

function showToast(msg: string, type: 'success' | 'error' | '' = ''): void {
  const el = document.getElementById('io-toast')!;
  el.textContent = msg;
  el.className = `io-toast ${type} show`;
  setTimeout(() => { el.className = 'io-toast'; }, 3200);
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}

function datestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// CSV helpers
function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
function csvRow(...cols: unknown[]): string {
  return cols.map(csvEscape).join(',');
}

async function exportAllJSON(): Promise<void> {
  const stored = await browser.storage.local.get([
    STORAGE.profile,
    STORAGE.graphNodes,
    STORAGE.graphEdges,
    STORAGE.graphMeta,
    STORAGE.rlPatterns,
    STORAGE.rlCorrections,
  ]);

  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    profile: stored[STORAGE.profile] ?? null,
    graph: {
      nodes: stored[STORAGE.graphNodes] ?? {},
      edges: stored[STORAGE.graphEdges] ?? {},
      meta:  stored[STORAGE.graphMeta]  ?? {},
    },
    rl: {
      patterns:    stored[STORAGE.rlPatterns]    ?? [],
      corrections: stored[STORAGE.rlCorrections] ?? [],
    },
  };

  downloadFile(
    JSON.stringify(payload, null, 2),
    `offlyn-data-${datestamp()}.json`,
    'application/json'
  );
  showToast('✓ Full export downloaded', 'success');
}

async function exportNodesCSV(): Promise<void> {
  const stored = await browser.storage.local.get(STORAGE.graphNodes);
  const nodes = Object.values((stored[STORAGE.graphNodes] ?? {}) as Record<string, GraphNode>);

  if (!nodes.length) { showToast('No graph nodes to export', 'error'); return; }

  const header = csvRow(
    'id', 'type', 'createdAt', 'updatedAt',
    // Question fields
    'q_rawText', 'q_normalizedText', 'q_canonicalField', 'q_platform',
    // Answer fields
    'a_value', 'a_source', 'a_confidence', 'a_usageCount', 'a_lastUsedAt', 'a_selectionReason',
    // Field fields
    'f_canonicalField', 'f_aliases',
    // Correction fields
    'c_originalValue', 'c_correctedValue', 'c_company', 'c_jobTitle', 'c_url', 'c_platform',
    // Application fields
    'ap_company', 'ap_jobTitle', 'ap_url', 'ap_platform'
  );

  const rows = nodes.map(n => {
    const p = n.payload as any;
    return csvRow(
      n.id, n.type,
      new Date(n.createdAt).toISOString(),
      new Date(n.updatedAt).toISOString(),
      // question
      n.type === 'question' ? p.rawText ?? '' : '',
      n.type === 'question' ? p.normalizedText ?? '' : '',
      n.type === 'question' ? p.canonicalField ?? '' : '',
      n.type === 'question' ? p.platform ?? '' : '',
      // answer
      n.type === 'answer' ? p.value ?? '' : '',
      n.type === 'answer' ? p.source ?? '' : '',
      n.type === 'answer' ? p.confidence ?? '' : '',
      n.type === 'answer' ? p.usageCount ?? 0 : '',
      n.type === 'answer' ? (p.lastUsedAt ? new Date(p.lastUsedAt).toISOString() : '') : '',
      n.type === 'answer' ? p.selectionReason ?? '' : '',
      // field
      n.type === 'field' ? p.canonicalField ?? '' : '',
      n.type === 'field' ? (p.aliases ?? []).join('; ') : '',
      // correction
      n.type === 'correction' ? p.originalValue ?? '' : '',
      n.type === 'correction' ? p.correctedValue ?? '' : '',
      n.type === 'correction' ? p.context?.company ?? '' : '',
      n.type === 'correction' ? p.context?.jobTitle ?? '' : '',
      n.type === 'correction' ? p.context?.url ?? '' : '',
      n.type === 'correction' ? p.context?.platform ?? '' : '',
      // application
      n.type === 'application' ? p.company ?? '' : '',
      n.type === 'application' ? p.jobTitle ?? '' : '',
      n.type === 'application' ? p.url ?? '' : '',
      n.type === 'application' ? p.platform ?? '' : '',
    );
  });

  downloadFile(
    [header, ...rows].join('\n'),
    `offlyn-graph-nodes-${datestamp()}.csv`,
    'text/csv'
  );
  showToast(`✓ ${nodes.length} nodes exported`, 'success');
}

async function exportEdgesCSV(): Promise<void> {
  const stored = await browser.storage.local.get([STORAGE.graphEdges, STORAGE.graphNodes]);
  const edges = Object.values((stored[STORAGE.graphEdges] ?? {}) as Record<string, GraphEdge>);
  const nodes = (stored[STORAGE.graphNodes] ?? {}) as Record<string, GraphNode>;

  if (!edges.length) { showToast('No graph edges to export', 'error'); return; }

  // Helper to get a short label for a node
  const nodeLabel2 = (id: string): string => {
    const n = nodes[id];
    if (!n) return id.slice(0, 20);
    const p = n.payload as any;
    return String(
      p.rawText ?? p.value ?? p.canonicalField ?? p.company ?? p.correctedValue ?? id
    ).slice(0, 60);
  };

  const header = csvRow(
    'id', 'type', 'from', 'fromType', 'fromLabel',
    'to', 'toType', 'toLabel',
    'weight', 'createdAt', 'updatedAt',
    'meta_similarityScore', 'meta_platform', 'meta_successCount'
  );

  const rows = edges.map(e => {
    const fn = nodes[e.from];
    const tn = nodes[e.to];
    return csvRow(
      e.id, e.type,
      e.from, fn?.type ?? '', nodeLabel2(e.from),
      e.to,   tn?.type ?? '', nodeLabel2(e.to),
      e.weight,
      new Date(e.createdAt).toISOString(),
      new Date(e.updatedAt).toISOString(),
      e.metadata?.similarityScore ?? '',
      e.metadata?.platform ?? '',
      e.metadata?.successCount ?? '',
    );
  });

  downloadFile(
    [header, ...rows].join('\n'),
    `offlyn-graph-edges-${datestamp()}.csv`,
    'text/csv'
  );
  showToast(`✓ ${edges.length} edges exported`, 'success');
}

async function exportRLCSV(): Promise<void> {
  const stored = await browser.storage.local.get([STORAGE.rlPatterns, STORAGE.rlCorrections]);
  const patterns = (stored[STORAGE.rlPatterns] ?? []) as any[];
  const corrections = (stored[STORAGE.rlCorrections] ?? []) as any[];

  if (!patterns.length && !corrections.length) {
    showToast('No RL data to export', 'error'); return;
  }

  // Patterns sheet
  const pHeader = csvRow(
    'id', 'fieldType', 'fieldLabel', 'learnedValue', 'originalValue',
    'confidence', 'successCount', 'failureCount', 'lastUsed', 'createdAt'
  );
  const pRows = patterns.map((p: any) => csvRow(
    p.id ?? '', p.fieldType ?? '', p.fieldLabel ?? '',
    p.learnedValue ?? '', p.originalValue ?? '',
    p.confidence ?? '', p.successCount ?? 0, p.failureCount ?? 0,
    p.lastUsed ? new Date(p.lastUsed).toISOString() : '',
    p.createdAt ? new Date(p.createdAt).toISOString() : '',
  ));

  // Corrections sheet
  const cHeader = csvRow(
    'id', 'fieldType', 'fieldLabel', 'autoFilledValue', 'userCorrectedValue',
    'timestamp', 'patternId', 'company', 'jobTitle', 'url'
  );
  const cRows = corrections.map((c: any) => csvRow(
    c.id ?? '', c.fieldType ?? '', c.fieldLabel ?? '',
    c.autoFilledValue ?? '', c.userCorrectedValue ?? '',
    c.timestamp ? new Date(c.timestamp).toISOString() : '',
    c.patternId ?? '',
    c.context?.company ?? '', c.context?.jobTitle ?? '', c.context?.url ?? '',
  ));

  // Combine into one CSV with section headers
  const combined = [
    '# RL LEARNED PATTERNS',
    pHeader,
    ...pRows,
    '',
    '# RL CORRECTION EVENTS',
    cHeader,
    ...cRows,
  ].join('\n');

  downloadFile(
    combined,
    `offlyn-rl-patterns-${datestamp()}.csv`,
    'text/csv'
  );
  showToast(`✓ ${patterns.length} patterns + ${corrections.length} corrections exported`, 'success');
}

// ── Import ────────────────────────────────────────────────────────────────────

let _importFileData: string | null = null;

function openImportModal(): void {
  _importFileData = null;
  (document.getElementById('import-file-input') as HTMLInputElement).value = '';
  document.getElementById('import-file-name')!.style.display = 'none';
  (document.getElementById('import-confirm') as HTMLButtonElement).disabled = true;
  document.getElementById('import-modal')!.classList.add('open');
}

function closeImportModal(): void {
  document.getElementById('import-modal')!.classList.remove('open');
  _importFileData = null;
}

function handleImportFile(file: File): void {
  if (!file.name.endsWith('.json')) {
    showToast('Please select a .json file', 'error'); return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    _importFileData = e.target?.result as string ?? null;
    const nameEl = document.getElementById('import-file-name')!;
    nameEl.textContent = `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    nameEl.style.display = 'block';
    (document.getElementById('import-confirm') as HTMLButtonElement).disabled = false;
  };
  reader.readAsText(file);
}

async function confirmImport(): Promise<void> {
  if (!_importFileData) return;

  let parsed: any;
  try {
    parsed = JSON.parse(_importFileData);
  } catch {
    showToast('Invalid JSON — file could not be parsed', 'error');
    return;
  }

  if (!parsed.version || !parsed.exportedAt) {
    showToast('Not a valid Offlyn export file', 'error');
    return;
  }

  const importGraph   = (document.getElementById('import-opt-graph') as HTMLInputElement).checked;
  const importRL      = (document.getElementById('import-opt-rl') as HTMLInputElement).checked;
  const importProfile = (document.getElementById('import-opt-profile') as HTMLInputElement).checked;

  const writes: Record<string, unknown> = {};

  if (importGraph && parsed.graph) {
    if (parsed.graph.nodes) writes[STORAGE.graphNodes] = parsed.graph.nodes;
    if (parsed.graph.edges) writes[STORAGE.graphEdges] = parsed.graph.edges;
    if (parsed.graph.meta)  writes[STORAGE.graphMeta]  = parsed.graph.meta;
  }
  if (importRL && parsed.rl) {
    if (parsed.rl.patterns)    writes[STORAGE.rlPatterns]    = parsed.rl.patterns;
    if (parsed.rl.corrections) writes[STORAGE.rlCorrections] = parsed.rl.corrections;
  }
  if (importProfile && parsed.profile) {
    writes[STORAGE.profile] = parsed.profile;
  }

  if (!Object.keys(writes).length) {
    showToast('Nothing to import — check your selections', 'error'); return;
  }

  try {
    await browser.storage.local.set(writes);
    closeImportModal();
    showToast('✓ Import successful — refreshing…', 'success');
    setTimeout(() => loadAll(), 800);
  } catch (err) {
    showToast('Import failed: ' + String(err), 'error');
  }
}

function initExportImport(): void {
  document.getElementById('btn-export-json')?.addEventListener('click', exportAllJSON);
  document.getElementById('btn-export-nodes-csv')?.addEventListener('click', exportNodesCSV);
  document.getElementById('btn-export-edges-csv')?.addEventListener('click', exportEdgesCSV);
  document.getElementById('btn-export-rl-csv')?.addEventListener('click', exportRLCSV);
  document.getElementById('btn-import-json')?.addEventListener('click', openImportModal);

  document.getElementById('import-cancel')?.addEventListener('click', closeImportModal);
  document.getElementById('import-modal')?.addEventListener('click', (e) => {
    if ((e.target as Element).id === 'import-modal') closeImportModal();
  });
  document.getElementById('import-confirm')?.addEventListener('click', confirmImport);

  // File input
  const fileInput = document.getElementById('import-file-input') as HTMLInputElement;
  fileInput?.addEventListener('change', () => {
    if (fileInput.files?.[0]) handleImportFile(fileInput.files[0]);
  });

  // Drag and drop
  const dropZone = document.getElementById('import-drop-zone')!;
  dropZone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) handleImportFile(file);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function loadAll(): Promise<void> {
  const stored = await browser.storage.local.get([
    STORAGE.profile,
    STORAGE.graphNodes,
    STORAGE.graphEdges,
    STORAGE.rlPatterns,
    STORAGE.rlCorrections,
  ]);

  const profile   = stored[STORAGE.profile] as UserProfile | null;
  const nodes     = (stored[STORAGE.graphNodes] ?? {}) as Record<string, GraphNode>;
  const edges     = (stored[STORAGE.graphEdges] ?? {}) as Record<string, GraphEdge>;
  const patterns  = (stored[STORAGE.rlPatterns] ?? []) as LearnedPattern[];
  const corrections = (stored[STORAGE.rlCorrections] ?? []) as CorrectionEvent[];

  renderProfile(profile!);
  renderGraph(nodes, edges);
  renderRL(patterns, corrections);
  initFlowchartFromData(nodes, edges);
}

function init(): void {
  initTabs();
  initFlowchartInteraction();
  initExportImport();

  // Re-run layout when Relationships tab becomes visible (so we have correct dimensions)
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'flowchart' && Object.keys(_fcRawNodes).length) {
        requestAnimationFrame(() => {
          buildFlowchartData(_fcRawNodes, _fcRawEdges);
          renderFlowchart();
          requestAnimationFrame(() => fitFlowchart());
        });
      }
    });
  });

  // Reset layout button
  document.getElementById('fc-reset')?.addEventListener('click', () => {
    if (Object.keys(_fcRawNodes).length) {
      buildFlowchartData(_fcRawNodes, _fcRawEdges);
      renderFlowchart();
      requestAnimationFrame(() => fitFlowchart());
    }
  });

  document.getElementById('back-btn')?.addEventListener('click', () => {
    window.close();
  });

  const refreshBtn = document.getElementById('refresh-btn')!;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    ['profile', 'graph', 'rl'].forEach(tab => {
      const loading = document.getElementById(`${tab}-loading`);
      const empty   = document.getElementById(`${tab}-empty`);
      const content = document.getElementById(`${tab}-content`);
      if (loading) loading.style.display = 'flex';
      if (empty)   empty.style.display = 'none';
      if (content) content.style.display = 'none';
    });
    await loadAll();
    setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
  });

  loadAll();
}

document.addEventListener('DOMContentLoaded', init);
