import React from 'react';
import {
  Brain, HelpCircle, CheckCircle, Layers, Building2,
  ArrowRight,
} from 'lucide-react';
import { Card } from './ui/Card';
import { StatRow } from './ui/StatPill';
import { Badge, ConfidenceBar, SourceBadge, NodeTypeBadge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import type { GraphNode, GraphEdge, AnswerPayload, CorrectionPayload, ApplicationPayload } from '../../shared/graph/types';

interface GraphMemoryTabProps {
  graphNodes: Record<string, GraphNode>;
  graphEdges: Record<string, GraphEdge>;
}

export function GraphMemoryTab({ graphNodes, graphEdges }: GraphMemoryTabProps) {
  const nodes = Object.values(graphNodes);
  const edges = Object.values(graphEdges);

  if (nodes.length === 0) {
    return (
      <div className="de-tab-panel active">
        <EmptyState
          icon={<Brain size={18} />}
          title="Graph is empty"
          description="The graph memory builds up as you apply to jobs. Come back after using autofill."
        />
      </div>
    );
  }

  // Counts
  const byType: Record<string, number> = {};
  for (const n of nodes) {
    byType[n.type] = (byType[n.type] || 0) + 1;
  }

  // Top answers — sorted by usageCount desc
  const answerNodes = nodes
    .filter(n => n.type === 'answer')
    .sort((a, b) => {
      const pa = a.payload as AnswerPayload;
      const pb = b.payload as AnswerPayload;
      return (pb.usageCount || 0) - (pa.usageCount || 0);
    })
    .slice(0, 20);

  // Corrections
  const correctionNodes = nodes
    .filter(n => n.type === 'correction')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10);

  // Applications — unique
  const appNodes = nodes
    .filter(n => n.type === 'application')
    .sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="de-tab-panel active">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, margin: '0 auto' }}>

        {/* Stats */}
        <StatRow stats={[
          { value: nodes.length,              label: 'Total Nodes',  color: 'var(--text)' },
          { value: edges.length,              label: 'Total Edges',  color: 'var(--text)' },
          { value: byType.field       || 0,   label: 'Fields',       color: 'var(--node-field)' },
          { value: byType.question    || 0,   label: 'Questions',    color: 'var(--node-question)' },
          { value: byType.answer      || 0,   label: 'Answers',      color: 'var(--node-answer)' },
          { value: byType.correction  || 0,   label: 'Corrections',  color: 'var(--node-correction)' },
          { value: byType.application || 0,   label: 'Applications', color: 'var(--node-application)' },
        ]} />

        {/* Top Answers */}
        <Card
          title={
            <span className="flex-row">
              <CheckCircle size={13} />
              Top Answers
            </span>
          }
          action={<span className="badge badge-neutral">{answerNodes.length}</span>}
          noPadding
        >
          {answerNodes.length === 0 ? (
            <EmptyState title="No answers recorded" />
          ) : (
            answerNodes.map((n, i) => {
              const p = n.payload as AnswerPayload;
              return (
                <div key={n.id} className="list-row">
                  <div style={{ color: 'var(--text-faint)', fontSize: 11, minWidth: 20, paddingTop: 2 }}>
                    {i + 1}
                  </div>
                  <div className="list-row-main">
                    <div className="list-row-value">{p.value}</div>
                    <div className="list-row-meta">
                      <SourceBadge source={p.source} />
                      <ConfidenceBar value={p.confidence} />
                    </div>
                  </div>
                  <div className="list-row-side">
                    <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
                      {p.usageCount}×
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </Card>

        <div className="de-grid-2">
          {/* Corrections */}
          <Card
            title={
              <span className="flex-row">
                <ArrowRight size={13} />
                Corrections
              </span>
            }
            action={<span className="badge badge-correction">{correctionNodes.length}</span>}
            noPadding
          >
            {correctionNodes.length === 0 ? (
              <EmptyState title="No corrections yet" />
            ) : (
              correctionNodes.map(n => {
                const p = n.payload as CorrectionPayload;
                return (
                  <div key={n.id} className="diff-row">
                    <span className="diff-from">{p.originalValue}</span>
                    <span className="diff-arrow">→</span>
                    <span className="diff-to">{p.correctedValue}</span>
                  </div>
                );
              })
            )}
          </Card>

          {/* Applications */}
          <Card
            title={
              <span className="flex-row">
                <Building2 size={13} />
                Applications
              </span>
            }
            action={<span className="badge badge-application">{appNodes.length}</span>}
            noPadding
          >
            {appNodes.length === 0 ? (
              <EmptyState title="No applications tracked" />
            ) : (
              appNodes.map(n => {
                const p = n.payload as ApplicationPayload;
                return (
                  <div key={n.id} className="list-row">
                    <div className="list-row-main">
                      <div className="list-row-value">{p.company}</div>
                      <div className="list-row-meta">
                        {p.jobTitle && <span className="text-sm text-muted">{p.jobTitle}</span>}
                        {p.platform && <Badge variant="neutral">{p.platform}</Badge>}
                      </div>
                    </div>
                    {p.url && (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--accent)', fontSize: 11 }}
                      >
                        ↗
                      </a>
                    )}
                  </div>
                );
              })
            )}
          </Card>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
