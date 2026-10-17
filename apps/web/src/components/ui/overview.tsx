'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A section's title with its count beside it in the cluster's figures, and its one way onward.
 *
 * Quiet on purpose: the section's content is the thing to look at, so the heading is type alone —
 * no pill, no rule, no box. One fixed height whether or not there is an action, so sections line
 * up the same down the page; a long title truncates rather than pushing the action off.
 */
export function SectionHeading({
  id,
  title,
  count,
  action,
}: {
  id?: string;
  title: string;
  /** `undefined` while it loads: the heading is drawn at once, only the count waits. */
  count?: number;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <h2
        id={id}
        className="flex min-w-0 items-baseline gap-2 text-lg font-semibold tracking-tight text-foreground"
      >
        <span className="truncate">{title}</span>
        {count !== undefined ? (
          <span className="shrink-0 font-mono text-sm font-medium tabular-nums text-muted-foreground">
            {pad(count)}
          </span>
        ) : null}
      </h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * A section's way onward: text and an arrow that steps forward under the pointer. The hit area is
 * a full 32px tall, pulled back into the margin so the words line up with the section's edge.
 */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group -mr-2 inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <ArrowRight
        aria-hidden="true"
        className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
      />
    </Link>
  );
}
