'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { pricesQuery } from '@vehicle-os/api-client/react';
import type { PlanState } from '@vehicle-os/contracts';
import {
  formatPlanPrice,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  type PlanLimits,
  type PlanTier,
} from '@vehicle-os/domain';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import logoMark from '@/public/Logo.png';

/*
 * The plan's pieces, drawn once for every place a plan appears: settings, the wall, the
 * confirmation, the downgrade. A tier is never given a colour of its own — ink carries rank, and
 * colour is kept for status — so the same three shapes read the same everywhere.
 */

const pad = (value: number) => String(value).padStart(2, '0');

/** A tier's rank as three bars lit up to it, like signal strength: how far up, in ink. */
export function TierMark({ tier, className }: { tier: PlanTier; className?: string }) {
  const rank = PLAN_RANK[tier];
  return (
    <span aria-hidden="true" className={cn('inline-flex items-end gap-[3px]', className)}>
      {(['h-2', 'h-3', 'h-4'] as const).map((height, step) => (
        <span
          key={height}
          className={cn('w-1 rounded-full bg-current', height, step > rank && 'opacity-25')}
        />
      ))}
    </span>
  );
}

export type BadgeTone = 'success' | 'warning' | 'destructive' | 'neutral';

const BADGE: Record<BadgeTone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  destructive: 'bg-destructive-soft text-destructive',
  neutral: 'bg-muted text-muted-foreground',
};

/** A status on its own soft tint — the pairing the contrast tests cover — with a dot. */
export function StatusBadge({
  tone,
  live = false,
  children,
  className,
}: {
  tone: BadgeTone;
  /** The dot breathes: something is current, not merely true. */
  live?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        BADGE[tone],
        className,
      )}
    >
      <span aria-hidden="true" className="relative grid size-1.5 place-items-center">
        {live ? <span className="status-ping absolute inset-0 rounded-full bg-current" /> : null}
        <span className="size-1.5 rounded-full bg-current" />
      </span>
      {children}
    </span>
  );
}

/** What a plan's state means, once, for every badge and line that reports it. */
export function planStatus(plan: PlanState): { tone: BadgeTone; label: string; live: boolean } {
  if (plan.status === 'PAST_DUE')
    return { tone: 'destructive', label: 'Payment failed', live: false };
  if (plan.cancelAtPeriodEnd) return { tone: 'warning', label: 'Ending', live: false };
  if (plan.plan === 'FREE') return { tone: 'neutral', label: 'Free', live: false };
  return { tone: 'success', label: 'Active', live: true };
}

/**
 * The plan you hold, as a pass.
 *
 * A paid plan is ink — the one solid card on the page, the way a paid membership card is the
 * black one — and Free is the outline of the same card, so what upgrading gets you is visible
 * before it is read. Rank is the bars beside the name; status is the badge; the dates and the
 * price are figures. `children` sits along the bottom edge: the actions that manage it.
 */
export function PlanPass({
  plan,
  children,
  className,
}: {
  plan: PlanState;
  children?: ReactNode;
  className?: string;
}) {
  const paid = plan.plan !== 'FREE';
  const prices = useQuery(pricesQuery(api));
  const price = paid ? prices.data?.[plan.plan as 'PLUS' | 'BUSINESS'] : null;
  const reading = price ? formatPlanPrice(price) : null;
  const status = planStatus(plan);

  const line = !paid
    ? 'No card · no renewal'
    : !plan.currentPeriodEnd
      ? 'Complimentary'
      : plan.status === 'PAST_DUE'
        ? 'Update the card to keep it'
        : `${plan.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${formatDate(plan.currentPeriodEnd)}`;

  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-2xl',
        paid
          ? 'bg-primary text-primary-foreground shadow-float'
          : 'bg-muted/60 text-foreground ring-1 ring-inset ring-border-strong',
        className,
      )}
    >
      {/*
       * The logo's speed lines, faint and running off the card's edge: the pass's texture, in its
       * own ink, so the only colour on it is still the mark itself.
       */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 top-7 -z-10 flex flex-col items-end gap-2 opacity-[0.12]"
      >
        {/* Thin, like the mark's own lines: thick bars would read as a skeleton still loading. */}
        {['w-40', 'w-24', 'w-32', 'w-16'].map((width) => (
          <span key={width} className={cn('h-0.5 rounded-full bg-current', width)} />
        ))}
      </span>

      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <span className="flex items-center gap-2">
          <Image src={logoMark} alt="" className="h-5 w-auto" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
            Garaj pass
          </span>
        </span>
        <StatusBadge tone={status.tone} live={status.live}>
          {status.label}
        </StatusBadge>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pb-5 pt-7">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-4xl font-bold tracking-tight">
            {PLAN_NAMES[plan.plan]}
            <TierMark tier={plan.plan} className="mb-1" />
          </p>
          <p className="mt-2 font-mono text-xs uppercase tracking-wider opacity-70">{line}</p>
        </div>
        {reading ? (
          <p className="font-mono tabular-nums">
            <span className="text-2xl font-bold tracking-tight">{reading.amount}</span>
            <span className="text-sm opacity-70">/{reading.per}</span>
          </p>
        ) : null}
      </div>

      {children ? (
        <div
          className={cn(
            'flex flex-wrap items-center justify-end gap-1 border-t border-dashed px-3 py-2',
            paid ? 'border-primary-foreground/20' : 'border-border-strong',
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A plan as a small pass, for a from → to strip. */
export function PassChip({ tier }: { tier: PlanTier }) {
  const paid = tier !== 'FREE';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold',
        paid
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted/60 text-foreground ring-1 ring-inset ring-border-strong',
      )}
    >
      <TierMark tier={tier} />
      {PLAN_NAMES[tier]}
    </span>
  );
}

const LEDGER: readonly [string, keyof PlanLimits][] = [
  ['Vehicles', 'vehicles'],
  ['Garages', 'garages'],
  ['People per garage', 'members'],
];

/**
 * Every ceiling, from one plan to the other, as a ledger: old, arrow, new. A row the account is
 * already over is flagged where it stands, with the count — over is not a refusal, nothing is
 * deleted, but it should never be found out afterwards.
 */
export function LimitLedger({
  from,
  to,
  usage,
}: {
  from: PlanTier;
  to: PlanTier;
  usage?: { vehicles: number; garages: number };
}) {
  const before = limitsFor(from);
  const after = limitsFor(to);
  return (
    <dl className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/60">
      {LEDGER.map(([label, key]) => {
        const used = key === 'members' ? undefined : usage?.[key];
        const over = used !== undefined && used > after[key];
        return (
          <div
            key={key}
            className={cn(
              'flex items-center justify-between gap-3 px-4 py-3',
              over && 'bg-warning-soft',
            )}
          >
            <dt className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-foreground">
              {label}
              {over ? (
                <span className="text-xs font-semibold text-warning">you have {pad(used)}</span>
              ) : null}
            </dt>
            <dd className="flex shrink-0 items-center gap-2 font-mono text-sm tabular-nums">
              <span className={cn(over ? 'text-foreground' : 'text-muted-foreground')}>
                {pad(before[key])}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
              <span className={cn('font-semibold', over ? 'text-warning' : 'text-foreground')}>
                {pad(after[key])}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
