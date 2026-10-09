import type { ReactNode } from 'react';
import { VEHICLE_GRID } from '@/components/vehicle-grid';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders.
 *
 * A page never waits behind the words "Loading…", and a placeholder only ever stands where
 * data will go. Headings, labels, section titles and buttons are the same before and after a
 * request, so they render immediately as real text — a grey bar where a word like "Odometer"
 * belongs hides something the page already knew. Matching the data's shape is the point: a
 * placeholder of a different height moves the page under the reader's cursor when it lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      // Decorative. The announcement comes from the `Loading` wrapper, once, rather than
      // from forty individual boxes. A `span` so it can also stand in for a number inside a
      // sentence ("<n> overdue") — pass `inline-block` for that.
      aria-hidden="true"
      className={cn(
        'block animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className,
      )}
    />
  );
}

/**
 * Announces "loading" once for a whole region of placeholders.
 *
 * `aria-busy` on a live region tells a screen reader that what is inside is provisional, so
 * it waits for the real content instead of reading out a shape.
 */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * The row shape shared by the timeline, maintenance, tasks, expenses and documents.
 *
 * Every part of a row is its data — the title, the meta line, the figure — so the whole row is
 * placeholder. Widths vary per row from a fixed pattern rather than at random: a placeholder
 * that reshuffles on every render is a page that will not sit still, and `Math.random()` in a
 * component body also differs between the server render and the client one.
 */
const ROW_WIDTHS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-5/12', 'w-7/12', 'w-1/2'] as const;

export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-4 rounded-xl bg-card/50 p-4">
          <Skeleton className="size-5 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className={cn('h-4', ROW_WIDTHS[index % ROW_WIDTHS.length])} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** The figures every vehicle card shows, in the card's own order. */
const CARD_FIGURE_LABELS = ['Odometer', 'Spent'] as const;

/**
 * The vehicle grid on the home, garage and vehicles pages.
 *
 * Mirrors `VehicleCard`: the picture, name and kind are this vehicle's, so they are placeholders;
 * the figure labels are the same on every card, so they are real text.
 */
export function CardGridSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className={VEHICLE_GRID}>
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-2xl bg-card/50 p-2 pb-2.5">
          {/* The same 16/10 stage as a real card, so nothing jumps when the picture arrives. */}
          <Skeleton className="aspect-[16/10] w-full rounded-xl" />
          <div className="flex min-w-0 items-start gap-2 px-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3.5 w-1/2" />
            </div>
            <Skeleton className="size-7 shrink-0 rounded-full" />
          </div>
          <dl className="mx-1.5 mt-auto grid grid-cols-2 divide-x divide-border rounded-xl bg-muted/60">
            {CARD_FIGURE_LABELS.map((label) => (
              <div key={label} className="min-w-0 px-3 py-2">
                <dt className="truncate text-label uppercase text-muted-foreground">{label}</dt>
                <dd className="mt-1">
                  <Skeleton className="h-4 w-14 max-w-full" />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
