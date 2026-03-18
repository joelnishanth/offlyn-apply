import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AnswerPayload, QuestionPayload, FieldPayload, CorrectionPayload, ApplicationPayload } from '../../shared/graph/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

type DetailLevel = 'compact' | 'medium' | 'full';

/**
 * Derives how much text/metadata to show based on selection + mode.
 * compact  → single-line truncated label, no metadata
 * medium   → 2-line label, key metadata
 * full     → 2-line label, all metadata (Advanced mode + selected)
 */
function detail(selected: boolean, data: any): DetailLevel {
  if (data?.dimmed) return 'compact';
  const mode = data?.mode ?? 'overview';
  if (mode === 'advanced') return selected ? 'full' : 'medium';
  if (selected)           return 'medium';
  if (data?.neighbor)     return 'medium';
  return 'compact';
}

const TRUNC: Record<DetailLevel, number> = { compact: 22, medium: 38, full: 65 };

function t(s: string, level: DetailLevel): string {
  if (!s) return '';
  const max = TRUNC[level];
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function stateClass(selected: boolean, data: any): string {
  if (data?.dimmed)   return 'dimmed';
  if (selected)       return 'selected';
  if (data?.neighbor) return 'neighbor';
  return '';
}

// ── Question node ──────────────────────────────────────────────────────────────

export function QuestionNode({ data, selected }: NodeProps) {
  const p = data.payload as QuestionPayload;
  const label = p?.normalizedText || p?.rawText || data.label as string || '?';
  const sc  = stateClass(selected, data);
  const dlv = detail(selected, data);

  return (
    <div className={`gnode gnode-question ${sc}`} title={label}>
      <Handle type="target" position={Position.Top}    className="gnode-handle" />
      <div className="gnode-header">
        <div className="gnode-type-dot" />
        <span className="gnode-type-label">Question</span>
        {dlv !== 'compact' && p?.platform && (
          <span className="gnode-meta-chip">{p.platform}</span>
        )}
      </div>
      <div className="gnode-body">
        <div className={`gnode-label ${dlv !== 'compact' ? 'gnode-label-wrap' : ''}`}>
          {t(label, dlv)}
        </div>
      </div>
      {dlv !== 'compact' && p?.canonicalField && (
        <div className="gnode-footer">
          <span className="mono gnode-mono-label">{p.canonicalField}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="gnode-handle" />
    </div>
  );
}

// ── Answer node ────────────────────────────────────────────────────────────────

export function AnswerNode({ data, selected }: NodeProps) {
  const p   = data.payload as AnswerPayload;
  const val = p?.value || data.label as string || '';
  const conf     = p?.confidence ?? 0;
  const confPct  = Math.round(conf * 100);
  const confColor = conf >= 0.75 ? 'var(--conf-high)' : conf >= 0.5 ? 'var(--conf-mid)' : 'var(--conf-low)';
  const sc  = stateClass(selected, data);
  const dlv = detail(selected, data);

  return (
    <div className={`gnode gnode-answer ${sc}`} title={val}>
      <Handle type="target" position={Position.Top}    className="gnode-handle" />
      <div className="gnode-header">
        <div className="gnode-type-dot" />
        <span className="gnode-type-label">Answer</span>
        {dlv !== 'compact' && p?.source && (
          <span className="gnode-source">{p.source}</span>
        )}
      </div>
      <div className="gnode-body">
        <div className={`gnode-label ${dlv !== 'compact' ? 'gnode-label-wrap' : ''}`}>
          {t(val, dlv)}
        </div>
      </div>
      {/* Conf bar always — it's 2px and carries meaning at a glance */}
      <div className="gnode-conf-row">
        <div className="gnode-conf-bar">
          <div className="gnode-conf-fill" style={{ width: `${confPct}%`, background: confColor }} />
        </div>
        {dlv !== 'compact' && (
          <span className="gnode-conf-pct">{confPct}%</span>
        )}
      </div>
      {dlv === 'full' && p?.usageCount !== undefined && (
        <div className="gnode-footer">
          <span className="gnode-mono-label">used {p.usageCount}×</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="gnode-handle" />
    </div>
  );
}

// ── Field node ─────────────────────────────────────────────────────────────────

export function FieldNode({ data, selected }: NodeProps) {
  const p     = data.payload as FieldPayload;
  const label = p?.canonicalField || data.label as string || '?';
  const sc    = stateClass(selected, data);
  const dlv   = detail(selected, data);

  return (
    <div className={`gnode gnode-field ${sc}`} title={label}>
      <Handle type="target" position={Position.Top}    className="gnode-handle" />
      <div className="gnode-header">
        <div className="gnode-type-dot" />
        <span className="gnode-type-label">Field</span>
      </div>
      <div className="gnode-body">
        <div className="gnode-label mono">{t(label, dlv)}</div>
      </div>
      {dlv === 'full' && p?.aliases?.length > 0 && (
        <div className="gnode-footer">
          <span className="gnode-mono-label">{p.aliases.slice(0, 2).join(', ')}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="gnode-handle" />
    </div>
  );
}

// ── Correction node ────────────────────────────────────────────────────────────

export function CorrectionNode({ data, selected }: NodeProps) {
  const p    = data.payload as CorrectionPayload;
  const corr = p?.correctedValue || data.label as string || '';
  const orig = p?.originalValue || '';
  const sc   = stateClass(selected, data);
  const dlv  = detail(selected, data);

  return (
    <div className={`gnode gnode-correction ${sc}`} title={`${orig} → ${corr}`}>
      <Handle type="target" position={Position.Top}    className="gnode-handle" />
      <div className="gnode-header">
        <div className="gnode-type-dot" />
        <span className="gnode-type-label">Correction</span>
      </div>
      <div className="gnode-body">
        {dlv !== 'compact' && orig && (
          <div className="gnode-strikethrough">{t(orig, 'compact')}</div>
        )}
        <div className={`gnode-label ${dlv !== 'compact' ? 'gnode-label-wrap' : ''}`}>
          {t(corr, dlv)}
        </div>
      </div>
      {dlv === 'full' && p?.context?.company && (
        <div className="gnode-footer">
          <span className="gnode-mono-label">@ {p.context.company}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="gnode-handle" />
    </div>
  );
}

// ── Application node ───────────────────────────────────────────────────────────

export function ApplicationNode({ data, selected }: NodeProps) {
  const p       = data.payload as ApplicationPayload;
  const company = p?.company || data.label as string || '?';
  const title   = p?.jobTitle || '';
  const plat    = p?.platform || '';
  const sc      = stateClass(selected, data);
  const dlv     = detail(selected, data);

  return (
    <div className={`gnode gnode-application ${sc}`} title={`${company}${title ? ' — ' + title : ''}`}>
      <Handle type="target" position={Position.Top}    className="gnode-handle" />
      <div className="gnode-header">
        <div className="gnode-type-dot" />
        <span className="gnode-type-label">App</span>
        {dlv !== 'compact' && plat && (
          <span className="gnode-meta-chip">{plat}</span>
        )}
      </div>
      <div className="gnode-body">
        <div className={`gnode-label ${dlv !== 'compact' ? 'gnode-label-wrap' : ''}`}>
          {t(company, dlv)}
        </div>
        {dlv !== 'compact' && title && (
          <div className="gnode-subtitle">{t(title, 'compact')}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="gnode-handle" />
    </div>
  );
}

// ── Node types map ─────────────────────────────────────────────────────────────

export const nodeTypes = {
  question:    QuestionNode,
  answer:      AnswerNode,
  field:       FieldNode,
  correction:  CorrectionNode,
  application: ApplicationNode,
};
