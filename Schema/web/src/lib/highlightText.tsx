import React from 'react';

export function highlightText(text: string, query: string): React.ReactNode {
  if (!text) return '—';
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerQuery, start);

  while (idx >= 0) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(
      <mark key={idx} className="rounded bg-brand-muted px-0.5 text-brand">
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    start = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, start);
  }

  if (start < text.length) parts.push(text.slice(start));
  return parts.length > 0 ? <>{parts}</> : text;
}
