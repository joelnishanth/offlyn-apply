import React from 'react';

type BadgeVariant =
  | 'question' | 'answer' | 'field' | 'correction' | 'application'
  | 'profile' | 'llm' | 'user' | 'learned'
  | 'success' | 'warning' | 'danger' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  );
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const cls = value >= 0.75 ? 'high' : value >= 0.5 ? 'mid' : 'low';
  return (
    <div className="conf-bar-wrap">
      <div className="conf-bar">
        <div className={`conf-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="conf-label">{pct}%</span>
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const variant: BadgeVariant =
    source === 'profile' ? 'profile' :
    source === 'llm'     ? 'llm'     :
    source === 'user'    ? 'user'    : 'learned';
  return <Badge variant={variant}>{source}</Badge>;
}

export function NodeTypeBadge({ type }: { type: string }) {
  return <Badge variant={type as BadgeVariant}>{type}</Badge>;
}
