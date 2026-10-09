'use client';

import Link from 'next/link';
import { useState } from 'react';
import { MethodBadge } from './code';

export interface IndexRow {
  href: string;
  method: string;
  path: string;
  summary: string;
  chapter: string;
}

/**
 * Every endpoint on one page, filtered as you type — by path, by what it does, or by area. The
 * question is usually "is there a route for X", and a text box answers it faster than a tree.
 */
export function EndpointIndex({ rows }: { rows: readonly IndexRow[] }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) =>
        `${row.method} ${row.path} ${row.summary} ${row.chapter}`.toLowerCase().includes(needle),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="sr-only">Filter endpoints</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter — “fuel”, “tasks”, “POST”"
          className="h-11 rounded-xl bg-input px-4 text-sm text-foreground placeholder:text-muted-foreground focus:bg-border"
        />
      </label>
      <p className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {String(shown.length).padStart(2, '0')} of {rows.length}
      </p>
      <ul className="flex flex-col gap-1">
        {shown.map((row) => (
          <li key={row.href}>
            <Link
              href={row.href}
              className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-card"
            >
              <MethodBadge method={row.method} small />
              <code className="min-w-0 shrink truncate font-mono text-sm text-foreground">{row.path}</code>
              <span className="hidden min-w-0 flex-1 truncate text-right text-sm text-muted-foreground sm:block">
                {row.summary}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
