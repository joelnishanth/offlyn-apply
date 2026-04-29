import React from 'react';

interface CardProps {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
  className?: string;
}

export function Card({ title, action, children, noPadding, className = '' }: CardProps) {
  return (
    <div className={`card ${className}`}>
      {title && (
        <div className="card-header">
          <span className="card-title">{title}</span>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className={`card-body ${noPadding ? 'p0' : ''}`}>
        {children}
      </div>
    </div>
  );
}
