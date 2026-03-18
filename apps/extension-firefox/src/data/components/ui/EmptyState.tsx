import React from 'react';
import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {icon ?? <Inbox size={18} />}
      </div>
      <div className="empty-state-title">{title}</div>
      {description && (
        <div className="empty-state-desc">{description}</div>
      )}
    </div>
  );
}
