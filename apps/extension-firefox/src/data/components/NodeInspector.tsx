import React from 'react';
import { X, Copy, Check } from 'lucide-react';
import { Badge, ConfidenceBar, SourceBadge, NodeTypeBadge } from './ui/Badge';
import type { GraphNode, AnswerPayload, QuestionPayload, FieldPayload, CorrectionPayload, ApplicationPayload } from '../../shared/graph/types';

interface NodeInspectorProps {
  node: GraphNode | null;
  linkedEdgesCount: { incoming: number; outgoing: number };
  onClose: () => void;
}

function timeAgo(ts: number): string {
  if (!ts) return 'never';
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

function NIField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ni-field">
      <div className="ni-field-label">{label}</div>
      <div className="ni-field-value">{children}</div>
    </div>
  );
}

export function NodeInspector({ node, linkedEdgesCount, onClose }: NodeInspectorProps) {
  const [copied, setCopied] = React.useState(false);
  const open = !!node;

  function copyId() {
    if (!node) return;
    navigator.clipboard.writeText(node.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className={`node-inspector ${open ? 'open' : ''}`}>
      {node && (
        <>
          <div className="ni-header">
            <NodeTypeBadge type={node.type} />
            <span className="ni-title">
              {getNodeTitle(node)}
            </span>
            <button className="btn btn-icon" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>

          <div className="ni-body">
            <NIField label="Node ID">
              <span className="ni-field-value mono">{node.id}</span>
            </NIField>

            <NIField label="Type">
              <NodeTypeBadge type={node.type} />
            </NIField>

            <NIField label="Connections">
              <span className="flex-row">
                <span className="badge badge-neutral">{linkedEdgesCount.incoming} in</span>
                <span className="badge badge-neutral">{linkedEdgesCount.outgoing} out</span>
              </span>
            </NIField>

            <NIField label="Created">
              <span className="text-muted text-sm">{timeAgo(node.createdAt)}</span>
            </NIField>

            <NIField label="Updated">
              <span className="text-muted text-sm">{timeAgo(node.updatedAt)}</span>
            </NIField>

            {/* Type-specific fields */}
            {node.type === 'answer' && <AnswerFields payload={node.payload as AnswerPayload} />}
            {node.type === 'question' && <QuestionFields payload={node.payload as QuestionPayload} />}
            {node.type === 'field' && <FieldFields payload={node.payload as FieldPayload} />}
            {node.type === 'correction' && <CorrectionFields payload={node.payload as CorrectionPayload} />}
            {node.type === 'application' && <AppFields payload={node.payload as ApplicationPayload} />}
          </div>

          <div className="ni-footer">
            <button className="btn" onClick={copyId} style={{ flex: 1 }}>
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied!' : 'Copy ID'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AnswerFields({ payload }: { payload: AnswerPayload }) {
  return (
    <>
      <NIField label="Value">
        <span style={{ wordBreak: 'break-word', lineHeight: 1.5 }}>{payload.value}</span>
      </NIField>
      <NIField label="Source">
        <SourceBadge source={payload.source} />
      </NIField>
      <NIField label="Confidence">
        <ConfidenceBar value={payload.confidence} />
      </NIField>
      <NIField label="Usage Count">
        <span className="text-muted">{payload.usageCount}×</span>
      </NIField>
      {payload.lastUsedAt > 0 && (
        <NIField label="Last Used">
          <span className="text-muted text-sm">{timeAgo(payload.lastUsedAt)}</span>
        </NIField>
      )}
      {payload.selectionReason && (
        <NIField label="Selection Reason">
          <Badge variant="neutral">{payload.selectionReason}</Badge>
        </NIField>
      )}
    </>
  );
}

function QuestionFields({ payload }: { payload: QuestionPayload }) {
  return (
    <>
      <NIField label="Raw Text">
        <span style={{ wordBreak: 'break-word', lineHeight: 1.5 }}>{payload.rawText}</span>
      </NIField>
      <NIField label="Normalized">
        <span className="ni-field-value mono">{payload.normalizedText}</span>
      </NIField>
      {payload.canonicalField && (
        <NIField label="Canonical Field">
          <span className="ni-field-value mono">{payload.canonicalField}</span>
        </NIField>
      )}
      {payload.platform && (
        <NIField label="Platform">
          <Badge variant="neutral">{payload.platform}</Badge>
        </NIField>
      )}
    </>
  );
}

function FieldFields({ payload }: { payload: FieldPayload }) {
  return (
    <>
      <NIField label="Canonical Field">
        <span className="ni-field-value mono">{payload.canonicalField}</span>
      </NIField>
      {payload.aliases?.length > 0 && (
        <NIField label="Aliases">
          <div className="chips-wrap" style={{ marginTop: 2 }}>
            {payload.aliases.map((a, i) => (
              <span key={i} className="chip">{a}</span>
            ))}
          </div>
        </NIField>
      )}
    </>
  );
}

function CorrectionFields({ payload }: { payload: CorrectionPayload }) {
  return (
    <>
      <NIField label="Original Value">
        <span style={{ color: 'var(--conf-low)', textDecoration: 'line-through', wordBreak: 'break-word' }}>
          {payload.originalValue}
        </span>
      </NIField>
      <NIField label="Corrected To">
        <span style={{ color: 'var(--conf-high)', fontWeight: 500, wordBreak: 'break-word' }}>
          {payload.correctedValue}
        </span>
      </NIField>
      {payload.context?.company && (
        <NIField label="Company">
          <span className="text-muted">{payload.context.company}</span>
        </NIField>
      )}
      {payload.context?.jobTitle && (
        <NIField label="Job Title">
          <span className="text-muted">{payload.context.jobTitle}</span>
        </NIField>
      )}
    </>
  );
}

function AppFields({ payload }: { payload: ApplicationPayload }) {
  return (
    <>
      <NIField label="Company">
        <span className="text-base">{payload.company}</span>
      </NIField>
      {payload.jobTitle && (
        <NIField label="Job Title">
          <span className="text-muted">{payload.jobTitle}</span>
        </NIField>
      )}
      {payload.platform && (
        <NIField label="Platform">
          <Badge variant="neutral">{payload.platform}</Badge>
        </NIField>
      )}
      {payload.url && (
        <NIField label="URL">
          <a href={payload.url} target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--accent)', fontSize: 11, wordBreak: 'break-all' }}>
            {payload.url}
          </a>
        </NIField>
      )}
    </>
  );
}

function getNodeTitle(node: GraphNode): string {
  const p = node.payload as any;
  switch (node.type) {
    case 'question':    return p.normalizedText?.slice(0, 40) || 'Question';
    case 'answer':      return p.value?.slice(0, 40) || 'Answer';
    case 'field':       return p.canonicalField || 'Field';
    case 'correction':  return p.correctedValue?.slice(0, 40) || 'Correction';
    case 'application': return p.company || 'Application';
    default:            return node.id.slice(0, 20);
  }
}
