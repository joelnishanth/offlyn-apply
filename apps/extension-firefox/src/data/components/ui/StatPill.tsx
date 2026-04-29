import React from 'react';

interface StatPillProps {
  value: number | string;
  label: string;
  color?: string;
}

export function StatPill({ value, label, color }: StatPillProps) {
  return (
    <div className="stat-pill">
      <div className="stat-num" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

interface StatRowProps {
  stats: Array<{ value: number | string; label: string; color?: string }>;
}

export function StatRow({ stats }: StatRowProps) {
  return (
    <div className="stat-row">
      {stats.map((s, i) => (
        <StatPill key={i} value={s.value} label={s.label} color={s.color} />
      ))}
    </div>
  );
}
