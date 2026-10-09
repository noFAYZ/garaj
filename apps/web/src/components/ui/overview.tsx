'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

const pad = (value: number) => String(value).padStart(2, '0');

const TONES = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

export interface Reading {
  label: string;
  /** `undefined` while it loads: the label is drawn at once, only the figure waits. */
  value: string | undefined;
  tone?: keyof typeof TONES;
  /**
   * A line under the figure saying what it is of — "out of 100", "last 12 months". A number
   * whose basis is not stated is a number a reader has to take on trust.
   */
  caption?: string;
  /** Makes the whole cell the way in to what it counts. */
  href?: string;
}

/**
 * An overview's figures as an instrument cluster: a handful of readings in one panel.
 *
 * `gap-px` over a border-coloured ground draws the hairlines between cells at every breakpoint —
 * two by two on a phone, four across above it — without a divider per cell to keep in sync.
 *
 * A cell with a link is a `div` with the link laid over it, not a link wrapping the term: a
 * `<dl>` may only hold `<div>`s of `<dt>` and `<dd>`, and a screen reader walks it as pairs.
 */
/**
 * One track per reading above the fold, so a cluster of three does not leave a fourth cell
 * standing empty. Written out rather than built into a string because Tailwind reads the class
 * names it generates out of the source.
 */
const COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

export function Readings({ readings, className }: { readings: Reading[]; className?: string }) {
  return (
    <dl
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border/60',
        COLUMNS[readings.length] ?? 'sm:grid-cols-4',
        // Two across on a phone leaves an odd cluster one cell short, and an empty cell in a
        // panel reads as a figure that failed to load. The last one takes the spare width.
        readings.length % 2 === 1 && 'max-sm:[&>*:last-child]:col-span-2',
        className,
      )}
    >
      {readings.map(({ label, value, tone, caption, href }) => (
        <div
          key={label}
          className={cn(
            'relative min-w-0 bg-card p-4 sm:p-5',
            href && 'transition-colors has-[a:hover]:bg-muted',
          )}
        >
          <dt className="text-label uppercase text-muted-foreground">{label}</dt>
          {value === undefined ? (
            <dd>
              <Skeleton className="mt-3 h-7 w-16 max-w-full" />
            </dd>
          ) : (
            <dd
              className={cn(
                'mt-2 truncate font-mono text-2xl font-semibold tabular-nums tracking-tight',
                tone ? TONES[tone] : 'text-foreground',
              )}
            >
              {value}
            </dd>
          )}
          {caption ? (
            // Under the figure, not beside the label: it qualifies the number, and a reader
            // who has the number already has stopped reading the row.
            <p className="mt-1 truncate text-xs text-muted-foreground">{caption}</p>
          ) : null}
          {href ? (
            <Link
              href={href}
              aria-label={value === undefined ? label : `${label}: ${value}`}
              className="absolute inset-0 rounded-[inherit]"
            />
          ) : null}
        </div>
      ))}
    </dl>
  );
}

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
