import React from 'react';
import { TrendingUp, AlertCircle, Clock } from 'lucide-react';
import { Card } from './ui/Card';
import { StatRow } from './ui/StatPill';
import { ConfidenceBar } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import type { LearnedPattern, CorrectionEvent } from '../../shared/learning-types';

interface RLPatternsTabProps {
  patterns: LearnedPattern[];
  corrections: CorrectionEvent[];
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
  return `${days}d ago`;
}

function confClass(c: number): string {
  return c >= 0.75 ? 'high' : c >= 0.5 ? 'mid' : 'low';
}

function confColor(c: number): string {
  return c >= 0.75 ? 'var(--conf-high)' : c >= 0.5 ? 'var(--conf-mid)' : 'var(--conf-low)';
}

export function RLPatternsTab({ patterns, corrections }: RLPatternsTabProps) {
  const highConf = patterns.filter(p => p.confidence >= 0.75).length;
  const midConf  = patterns.filter(p => p.confidence >= 0.5 && p.confidence < 0.75).length;
  const lowConf  = patterns.filter(p => p.confidence < 0.5).length;
  const avgConf  = patterns.length
    ? Math.round(patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length * 100)
    : 0;

  const sorted = [...patterns].sort((a, b) => b.confidence - a.confidence);
  const recentCorrections = [...corrections].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);

  if (patterns.length === 0 && corrections.length === 0) {
    return (
      <div className="de-tab-panel active">
        <EmptyState
          icon={<TrendingUp size={18} />}
          title="No RL patterns yet"
          description="Patterns are learned as Offlyn fills forms and you confirm or correct the values."
        />
      </div>
    );
  }

  return (
    <div className="de-tab-panel active">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, margin: '0 auto' }}>

        {/* Stats */}
        <StatRow stats={[
          { value: patterns.length,   label: 'Total Patterns',    color: 'var(--text)' },
          { value: highConf,           label: 'High Confidence',   color: 'var(--conf-high)' },
          { value: midConf,            label: 'Mid Confidence',    color: 'var(--conf-mid)' },
          { value: lowConf,            label: 'Low Confidence',    color: 'var(--conf-low)' },
          { value: `${avgConf}%`,      label: 'Avg Confidence',    color: 'var(--accent)' },
          { value: corrections.length, label: 'Total Corrections', color: 'var(--text-muted)' },
        ]} />

        {/* Pattern table */}
        {sorted.length > 0 && (
          <Card
            title={
              <span className="flex-row">
                <TrendingUp size={13} />
                Learned Patterns
              </span>
            }
            action={<span className="badge badge-neutral">{sorted.length}</span>}
            noPadding
          >
            <table className="de-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Learned Value</th>
                  <th style={{ width: 160 }}>Confidence</th>
                  <th style={{ width: 80 }}>Used</th>
                  <th style={{ width: 90 }}>Last Used</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontSize: 12, fontWeight: 500 }}>{p.fieldLabel}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                        {p.fieldType}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.learnedValue}
                      </div>
                      {p.originalValue && p.originalValue !== p.learnedValue && (
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', textDecoration: 'line-through', marginTop: 2 }}>
                          {p.originalValue}
                        </div>
                      )}
                    </td>
                    <td>
                      <ConfidenceBar value={p.confidence} />
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {(p.successCount || 0) + (p.failureCount || 0)}×
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        {timeAgo(p.lastUsed)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Corrections history */}
        {recentCorrections.length > 0 && (
          <Card
            title={
              <span className="flex-row">
                <AlertCircle size={13} />
                Correction History
              </span>
            }
            action={<span className="badge badge-correction">{corrections.length}</span>}
            noPadding
          >
            {recentCorrections.map(c => (
              <div key={c.id} className="list-row">
                <div className="list-row-main">
                  <div className="list-row-meta" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                      {c.fieldType}
                    </span>
                    {c.context?.company && (
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>@ {c.context.company}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--conf-low)', textDecoration: 'line-through', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.autoFilledValue}
                    </span>
                    <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>→</span>
                    <span style={{ fontSize: 12, color: 'var(--conf-high)', fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.userCorrectedValue}
                    </span>
                  </div>
                </div>
                <div className="list-row-side">
                  <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{timeAgo(c.timestamp)}</span>
                </div>
              </div>
            ))}
          </Card>
        )}

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
