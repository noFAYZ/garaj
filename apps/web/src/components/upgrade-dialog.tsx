'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Clock, Lock } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError, type PlanWall } from '@vehicle-os/api-client';
import { pricesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import type { PlanPrice } from '@vehicle-os/contracts';
import {
  ENTITLEMENT_COPY,
  ENTITLEMENTS,
  entitlementsFor,
  formatPlanPrice,
  limitsFor,
  PLAN_NAMES,
  PLAN_RANK,
  PLAN_TIERS,
  type Entitlement,
  type PlanLimits,
  type PlanTier,
} from '@vehicle-os/domain';
import { api } from '@/lib/api';
import { closeUpgrade, openUpgrade, usePlan, useUpgradeWall } from '@/lib/upgrade';
import { BrandLogo } from '@/components/brand-logo';
import { Icon, type IconName } from '@/components/icons';
import { FormError, Modal } from '@/components/ui/modal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { Button } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { PlanPass, TierMark } from '@/components/plan-kit';
import { cn } from '@/lib/utils';
import logoMark from '@/public/Logo.png';

type PaidTier = 'PLUS' | 'BUSINESS';
type Limit = keyof PlanLimits;

export const FEATURE_ICON: Record<Entitlement, IconName> = {
  'passport.share': 'document',
  'income.track': 'money',
  'mileage.report': 'odometer',
  'driver.assign': 'people',
};

const LIMIT_ICON: Record<Limit, IconName> = {
  vehicles: 'car',
  garages: 'garage',
  members: 'people',
};

const LIMIT_TITLE: Record<Limit, string> = {
  vehicles: 'Your garage is full',
  garages: 'No room for another garage',
  members: 'No room for another person',
};

const LIMIT_NOUN: Record<Limit, [string, string]> = {
  vehicles: ['vehicle', 'vehicles'],
  garages: ['garage', 'garages'],
  members: ['person', 'people'],
};

const LIMIT_ROWS = [
  ['Vehicles', 'vehicles'],
  ['Garages', 'garages'],
  ['People', 'members'],
] as const;

const CADENCE: Record<string, string> = {
  day: 'daily',
  week: 'weekly',
  month: 'monthly',
  year: 'yearly',
};

/** Which plan a checkout was for, kept across the round trip through Stripe. */
const CHECKOUT_KEY = 'garaj.checkout';

const pad = (value: number) => String(value).padStart(2, '0');
const noun = (limit: Limit, count: number) => LIMIT_NOUN[limit][count === 1 ? 0 : 1];
const isPaid = (value: unknown): value is PaidTier => value === 'PLUS' || value === 'BUSINESS';
const isEntitlement = (value: string | undefined): value is Entitlement =>
  (ENTITLEMENTS as readonly string[]).includes(value ?? '');

/** Features `to` has that `from` does not — the only ones worth listing at a wall. */
export const gainedFeatures = (from: PlanTier, to: PlanTier) =>
  entitlementsFor(to).filter((entitlement) => !entitlementsFor(from).includes(entitlement));

/** A failed checkout, said as what it means for the person rather than as a code. */
function billingError(error: Error): string {
  if (error instanceof ApiError && error.code === 'NO_BILLING')
    return 'Upgrades aren’t available yet.';
  if (error instanceof ApiError && error.code === 'NO_PRICE') return 'This plan isn’t on sale yet.';
  return error.message;
}

/** "Billed monthly", "Billed every 3 months" — from the price Stripe holds. */
function cadence(price: PlanPrice): string {
  return price.intervalCount === 1
    ? `Billed ${CADENCE[price.interval] ?? `every ${price.interval}`}`
    : `Billed every ${price.intervalCount} ${price.interval}s`;
}

/**
 * Send the person to Stripe.
 *
 * Nothing here changes the plan: the webhook does, once payment is real. The return comes back
 * to the page the wall was opened on, where `CheckoutReturn` waits for the webhook to land.
 * Someone already paying is sent to Stripe's confirm page for a plan change instead of a second
 * checkout — the server decides that, so every caller gets it.
 */
export function useCheckout() {
  return useMutation({
    mutationFn: (plan: PaidTier) => {
      try {
        sessionStorage.setItem(CHECKOUT_KEY, plan);
      } catch {
        // Storage refused: the return still confirms, just without naming the plan.
      }
      return api.billing.checkout({ plan, returnPath: window.location.pathname });
    },
    // Its own feedback is the page leaving; a "Saved" toast on the way out would be a lie.
    meta: { toast: false },
    onSuccess: ({ url }) => window.location.assign(url),
  });
}

/**
 * A row of parking bays — the garage pattern the whole app is drawn in, used here to show a
 * ceiling as a place rather than as a number.
 *
 * `filled` bays are taken, `open` ones are free on the current plan, and `fresh` ones are what
 * an upgrade adds — dashed, because they do not exist yet. Each kind is capped so a business
 * plan's hundred bays draw as a handful and a count, never as a hundred squares.
 */
export function Bays({
  filled,
  open = 0,
  fresh = 0,
  pulse = false,
  icon,
  marks = [],
  label,
  size = 'md',
  className,
}: {
  filled: number;
  open?: number;
  fresh?: number;
  /** The fresh bays breathe while a payment confirms — bought, not yet built. */
  pulse?: boolean;
  icon: IconName;
  /**
   * What is parked in the taken bays, in order - the person's own vehicles, as their makes'
   * logos. A bay past the end of the list shows the generic glyph, so a count the list does not
   * cover (a second page of vehicles) still draws.
   */
  marks?: readonly ReactNode[];
  /** Said to a screen reader in place of the picture. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const box = size === 'sm' ? 'size-7 rounded-lg' : 'size-10 rounded-xl';
  const glyph = size === 'sm' ? 14 : 18;
  const cells: { kind: 'filled' | 'open' | 'fresh'; more?: number }[] = [];

  const push = (kind: 'filled' | 'open' | 'fresh', count: number, cap: number) => {
    const shown = Math.min(count, cap);
    for (let index = 0; index < shown; index += 1) {
      // The last visible bay of a capped run carries the rest as a count.
      const more = index === shown - 1 && count > cap ? count - cap + 1 : undefined;
      cells.push({ kind, more });
    }
  };
  push('filled', filled, 6);
  push('open', open, 3);
  push('fresh', fresh, 3);

  let freshIndex = 0;
  let filledIndex = 0;
  return (
    <div role="img" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {cells.map((cell, index) => {
        const order = cell.kind === 'fresh' ? freshIndex++ : 0;
        const mark = cell.kind === 'filled' ? marks[filledIndex++] : undefined;
        return (
          <span
            key={index}
            className={cn(
              'grid shrink-0 place-items-center',
              box,
              cell.kind === 'filled' && 'bg-card text-foreground shadow-sm',
              // An empty bay is an outline on the floor: room that exists today, drawn solid so
              // it reads differently from the dashed bays an upgrade would add.
              cell.kind === 'open' && 'text-muted-foreground ring-1 ring-inset ring-border-strong',
              // Stagger in: the bays an upgrade adds arrive one after another, which is the
              // whole argument of the picture made without a word.
              cell.kind === 'fresh' &&
                'stagger animate-rise border border-dashed border-border-strong text-muted-foreground',
              cell.kind === 'fresh' && pulse && 'animate-pulse',
            )}
            style={cell.kind === 'fresh' ? ({ '--i': order + 2 } as CSSProperties) : undefined}
          >
            {cell.more ? (
              <span className="font-mono text-xs font-semibold tabular-nums">+{cell.more}</span>
            ) : cell.kind === 'filled' ? (
              (mark ?? <Icon name={icon} size={glyph} />)
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * The person's own vehicles as bay marks - their makes' logos - so a full garage on the wall is
 * *their* garage. From the vehicle list the home page has already cached; before it arrives the
 * bays draw the generic glyph, which is the same picture with less in it.
 */
export function useVehicleMarks(size: number): ReactNode[] {
  const vehicles = useQuery(vehiclesQuery(api));
  return (vehicles.data?.data ?? []).map((vehicle) => (
    <BrandLogo key={vehicle.id} make={vehicle.make} size={size} />
  ));
}

/** The tiers above `current` that would remove this wall, cheapest first. */
function tiersFor(wall: PlanWall, current: PlanTier): PaidTier[] {
  const floor = wall.requiredPlan ? PLAN_RANK[wall.requiredPlan] : Number.POSITIVE_INFINITY;
  return PLAN_TIERS.filter(
    (tier): tier is PaidTier =>
      tier !== 'FREE' && PLAN_RANK[tier] > PLAN_RANK[current] && PLAN_RANK[tier] >= floor,
  );
}

/**
 * A price as a reading: the amount large, the period small. Free reads as zero in the paid
 * plans' own currency, so the three cards compare like for like.
 */
function PriceReading({
  tier,
  size = 'lg',
  className,
}: {
  tier: PlanTier;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const prices = useQuery(pricesQuery(api));
  const paid = prices.data?.PLUS ?? prices.data?.BUSINESS;
  const price = isPaid(tier) ? prices.data?.[tier] : paid && { ...paid, amountMinor: 0 };
  if (prices.isPending) return <Skeleton className="h-8 w-20" />;
  if (!price) return <span className="text-sm text-muted-foreground">No price yet</span>;
  const { amount, per } = formatPlanPrice(price);
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      <span
        className={cn(
          'font-bold tracking-tight text-foreground',
          size === 'lg' ? 'text-3xl' : 'text-2xl',
        )}
      >
        {amount}
      </span>
      <span className="text-sm text-muted-foreground">/{per}</span>
    </span>
  );
}

/**
 * The order, as a ticket: the plan and its price above the tear, what it changes below it.
 *
 * A garage hands you a ticket on the way in; this is that, for the bigger garage. The notches
 * are cut in the dialog's own colour, so the tear reads as a tear and not as a rule.
 */
function Ticket({ from, to, switching }: { from: PlanTier; to: PaidTier; switching: boolean }) {
  const prices = useQuery(pricesQuery(api));
  const price = prices.data?.[to];
  const before = limitsFor(from);
  const after = limitsFor(to);
  const gained = gainedFeatures(from, to);

  return (
    <div className="rounded-2xl bg-muted/60">
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <p className="text-label uppercase text-muted-foreground">
            {switching ? 'Switch' : 'Upgrade'} from {PLAN_NAMES[from]}
          </p>
          <p className="mt-1 flex items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
            {PLAN_NAMES[to]}
            <TierMark tier={to} />
          </p>
          {price ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cadence(price)}
              {switching ? ' · prorated today' : ''}
            </p>
          ) : null}
        </div>
        <PriceReading tier={to} className="shrink-0 pt-1" />
      </div>

      <div aria-hidden="true" className="relative mx-5 border-t-2 border-dashed border-border">
        <span className="absolute -left-[1.875rem] -top-[11px] size-5 rounded-full bg-card" />
        <span className="absolute -right-[1.875rem] -top-[11px] size-5 rounded-full bg-card" />
      </div>

      <div className="flex flex-col gap-4 px-5 pb-5 pt-4">
        <dl className="grid grid-cols-3 gap-3">
          {LIMIT_ROWS.map(([label, key]) => {
            const more = after[key] - before[key];
            return (
              <div key={key}>
                <dt className="text-label uppercase text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 flex items-baseline gap-1.5 font-mono tabular-nums">
                  <span
                    className={cn(
                      'text-lg font-semibold',
                      more > 0 ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {pad(after[key])}
                  </span>
                  {more > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      <span className="sr-only">, </span>+{more}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>

        {gained.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Features added">
            {gained.map((entitlement) => (
              <li
                key={entitlement}
                className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-sm font-medium text-foreground"
              >
                <Check className="size-3.5 text-success" aria-hidden="true" />
                {ENTITLEMENT_COPY[entitlement].name}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The picture at the top of the wall: what was hit.
 *
 * A limit is drawn as bays — the ones you have, full, beside the ones the next plan adds. A
 * feature is drawn as itself, locked. Either way the reason is seen before it is read, and the
 * caption says the move in the same mono shorthand: from what you have, to what fixes it.
 */
function WallVisual({
  wall,
  current,
  next,
}: {
  wall: PlanWall;
  current: PlanTier;
  next: PlanTier | null;
}) {
  const { data } = usePlan();
  const marks = useVehicleMarks(30);

  if (wall.reason === 'limit' && wall.limit) {
    const limit = wall.limit;
    const allowed = limitsFor(current)[limit];
    // People are per garage and not counted on the account, so a full garage is drawn full.
    const used = limit === 'members' ? allowed : Math.min(data?.usage[limit] ?? allowed, allowed);
    const room = next ? Math.max(0, limitsFor(next)[limit] - used) : 0;

    return (
      <figure className="flex flex-col items-center gap-3 rounded-2xl bg-muted/40 px-4 py-6">
        <Bays
          filled={used}
          fresh={room}
          icon={LIMIT_ICON[limit]}
          marks={limit === 'vehicles' ? marks : []}
          label={
            next
              ? `${used} of ${allowed} ${noun(limit, allowed)} on ${PLAN_NAMES[current]}; ${PLAN_NAMES[next]} has room for ${room} more`
              : `${used} of ${allowed} ${noun(limit, allowed)}, all taken`
          }
          className="justify-center"
        />
        <figcaption className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {PLAN_NAMES[current]} {pad(used)}/{pad(allowed)}
          {next ? (
            <>
              {' '}
              <span aria-hidden="true">&rarr;</span>{' '}
              <span className="text-foreground">
                {PLAN_NAMES[next]} {pad(limitsFor(next)[limit])}
              </span>
            </>
          ) : null}
        </figcaption>
      </figure>
    );
  }

  const entitlement = isEntitlement(wall.entitlement) ? wall.entitlement : null;
  return (
    <figure className="flex flex-col items-center gap-4 rounded-2xl bg-muted/40 px-4 py-6">
      <span className="relative grid size-16 place-items-center rounded-2xl bg-card text-foreground shadow-sm">
        <Icon name={entitlement ? FEATURE_ICON[entitlement] : 'star'} size={30} />
        <span className="absolute -bottom-1.5 -right-1.5 grid size-7 place-items-center rounded-full bg-primary text-primary-foreground ring-4 ring-muted">
          <Lock className="size-3.5" aria-hidden="true" />
        </span>
      </span>
      <figcaption className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {PLAN_NAMES[current]}: locked
        {next ? (
          <>
            {' '}
            <span aria-hidden="true">&rarr;</span>{' '}
            <span className="text-foreground">{PLAN_NAMES[next]}: included</span>
          </>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * The wall: one decision, not a pricing table.
 *
 * It shows what was hit, offers only the tiers that would remove it — with the cheapest one
 * chosen — and hands over a ticket for that tier: its price, and what it *changes*. One button
 * to go ahead, one to not, and one line saying exactly what the button does next. Everything
 * longer lives in settings, for the person who came to compare.
 *
 * Mounted once beside the toaster and opened from anywhere: by the query client when a server
 * refusal costs money, and by a gated control that knew in advance.
 */
export function UpgradeDialog() {
  const wall = useUpgradeWall();
  if (!wall) return null;
  // Keyed on the wall, so a second refusal while one is open starts from its own cheapest tier.
  return <Wall key={`${wall.reason}-${wall.limit ?? wall.entitlement ?? ''}`} wall={wall} />;
}

function Wall({ wall }: { wall: PlanWall }) {
  const { data } = usePlan();
  const prices = useQuery(pricesQuery(api));
  const current = data?.plan ?? 'FREE';
  const options = tiersFor(wall, current);
  const [tier, setTier] = useState<string>(options[0] ?? '');
  const checkout = useCheckout();

  const chosen = options.find((option) => option === tier) ?? options[0] ?? null;
  const entitlement = isEntitlement(wall.entitlement) ? wall.entitlement : null;
  const limit = wall.reason === 'limit' ? (wall.limit ?? null) : null;
  // Paying already: the button changes that subscription rather than starting another.
  const switching = current !== 'FREE';
  // Loaded, and Stripe has no price for it: say so now rather than fail on the press.
  const unavailable = Boolean(chosen && prices.isSuccess && !prices.data[chosen]);

  const title = !chosen
    ? 'You’re on the largest plan'
    : limit
      ? LIMIT_TITLE[limit]
      : entitlement
        ? `${ENTITLEMENT_COPY[entitlement].name} needs ${PLAN_NAMES[options[0]!]}`
        : `This needs ${PLAN_NAMES[options[0]!]}`;

  const allowed = limit ? limitsFor(current)[limit] : 0;
  const description = !chosen
    ? wall.message
    : limit === 'members'
      ? `${PLAN_NAMES[current]} garages hold ${allowed} ${noun('members', allowed)}.`
      : limit
        ? `${PLAN_NAMES[current]} holds ${allowed} ${noun(limit, allowed)}.`
        : entitlement
          ? ENTITLEMENT_COPY[entitlement].does
          : wall.message;

  const footnote = unavailable
    ? 'Upgrades aren’t available yet.'
    : switching
      ? 'Stripe shows the prorated charge before you confirm.'
      : 'You pay on Stripe’s page next. Cancel anytime from Billing.';

  return (
    <Modal title={title} description={description} onClose={closeUpgrade}>
      <div className="flex flex-col gap-5">
        <WallVisual wall={wall} current={current} next={chosen} />

        {chosen ? (
          <Tabs value={chosen} onValueChange={setTier} className="flex flex-col gap-3">
            {/* A switch only when there is a choice: one tier that fixes it is not a question. */}
            {options.length > 1 ? (
              <TabsList className="self-start bg-muted/60">
                {options.map((option) => {
                  const price = prices.data?.[option];
                  return (
                    <TabsTrigger key={option} value={option} className="gap-2 px-4">
                      <TierMark tier={option} />
                      {PLAN_NAMES[option]}
                      {price ? (
                        <span className="font-mono text-xs tabular-nums opacity-70">
                          {formatPlanPrice(price).amount}
                        </span>
                      ) : null}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            ) : null}
            {options.map((option) => (
              <TabsContent key={option} value={option} className="mt-0">
                <Ticket from={current} to={option} switching={switching} />
              </TabsContent>
            ))}
          </Tabs>
        ) : null}

        {checkout.isError ? <FormError>{billingError(checkout.error)}</FormError> : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" size="lg" onClick={closeUpgrade}>
              {chosen ? 'Not now' : 'Close'}
            </Button>
            {chosen ? (
              <Button
                variant="primary"
                size="lg"
                loading={checkout.isPending}
                disabled={unavailable}
                onClick={() => checkout.mutate(chosen)}
                className="sm:min-w-52"
              >
                {switching ? 'Switch' : 'Upgrade'} to {PLAN_NAMES[chosen]}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          {chosen ? (
            <p className="text-center text-xs text-muted-foreground sm:text-right">{footnote}</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Back from Stripe, on whichever page the checkout started from.
 *
 * Arriving here does not change the plan — the webhook does, usually within seconds. So this
 * waits for it in plain sight: the bays the new plan adds breathe until the plan is real, then
 * settle into place. It never claims an upgrade the server has not confirmed; if the webhook is
 * slow it says exactly that, and stops asking rather than polling forever.
 */
export function CheckoutReturn() {
  const [target, setTarget] = useState<PaidTier | null | undefined>(undefined);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('checkout');
    if (!outcome) return;

    params.delete('checkout');
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${params.size ? `?${params}` : ''}${window.location.hash}`,
    );
    let stashed: string | null = null;
    try {
      stashed = sessionStorage.getItem(CHECKOUT_KEY);
      sessionStorage.removeItem(CHECKOUT_KEY);
    } catch {
      // No storage: confirm without naming the plan.
    }
    // A cancelled checkout charged nothing and changed nothing; there is nothing to say.
    if (outcome === 'done') setTarget(isPaid(stashed) ? stashed : null);
  }, []);

  if (target === undefined) return null;
  return <Confirming target={target} onClose={() => setTarget(undefined)} />;
}

const POLL_MS = 2_000;
const PATIENCE_MS = 30_000;

type SealState = 'working' | 'slow' | 'done';

/**
 * The payment's state as one mark. Working: the Garaj mark inside a ring whose arc chases round
 * it. Done: the ring draws closed in the success tone, a tick draws in, one ripple goes out.
 * Rendered in the same place in both, so the arc visibly becomes the closed ring. Decorative —
 * the dialog's title and live status line say the same in words.
 */
function PaymentSeal({ state }: { state: SealState }) {
  const done = state === 'done';
  return (
    <div className="relative grid size-24 place-items-center" aria-hidden="true">
      {done ? <span className="seal-ripple absolute inset-0 rounded-full bg-success-soft" /> : null}
      <svg viewBox="0 0 96 96" className="absolute inset-0 size-full -rotate-90">
        <circle cx="48" cy="48" r="44" fill="none" strokeWidth="3" className="stroke-border" />
        <circle
          key={done ? 'closed' : 'open'}
          cx="48"
          cy="48"
          r="44"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={done ? undefined : '30 70'}
          className={cn(
            done ? 'seal-close stroke-success' : 'stroke-foreground',
            state === 'working' && 'seal-orbit',
          )}
        />
      </svg>
      <span
        className={cn(
          'relative grid size-16 place-items-center rounded-full transition-colors duration-500',
          done ? 'seal-disk bg-success-soft text-success' : 'bg-card',
        )}
      >
        {done ? (
          <svg viewBox="0 0 24 24" className="size-8">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              pathLength={1}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="seal-tick"
            />
          </svg>
        ) : (
          <Image src={logoMark} alt="" priority className="h-7 w-auto" />
        )}
      </span>
    </div>
  );
}

type StepState = 'done' | 'active' | 'waiting' | 'pending';

/** One row of what has happened so far: a status glyph, the step, and a mono aside. */
function Step({
  state,
  aside,
  children,
}: {
  state: StepState;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
        (state === 'active' || state === 'waiting') && 'bg-muted/60',
      )}
    >
      <span className="grid size-6 shrink-0 place-items-center" aria-hidden="true">
        {state === 'done' ? (
          <span className="grid size-6 animate-pop place-items-center rounded-full bg-success-soft text-success">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : state === 'active' ? (
          <span className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
        ) : state === 'waiting' ? (
          <span className="grid size-6 place-items-center rounded-full bg-warning-soft text-warning">
            <Clock className="size-3.5" strokeWidth={2.5} />
          </span>
        ) : (
          <span className="size-3 rounded-full ring-2 ring-inset ring-border-strong" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-sm',
          state === 'pending' ? 'text-muted-foreground' : 'font-semibold text-foreground',
        )}
      >
        {children}
      </span>
      {aside ? (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{aside}</span>
      ) : null}
    </li>
  );
}

const clock = (seconds: number) => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;

function Confirming({ target, onClose }: { target: PaidTier | null; onClose: () => void }) {
  const { data, plan } = usePlan();
  const marks = useVehicleMarks(30);
  const [slow, setSlow] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const { refetch } = plan;

  // Without a remembered target, any paid plan is the upgrade having landed.
  const reached = Boolean(data && (target ? data.plan === target : data.plan !== 'FREE'));
  const tier: PlanTier = target ?? (data && data.plan !== 'FREE' ? data.plan : 'PLUS');
  const state: SealState = reached ? 'done' : slow ? 'slow' : 'working';

  useEffect(() => {
    const giveUp = window.setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => window.clearTimeout(giveUp);
  }, []);

  // How long it has been, as a figure: a wait with a clock on it reads as measured, not stuck.
  useEffect(() => {
    if (reached) return;
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(tick);
  }, [reached]);

  /*
   * Ask the provider, not only its webhook — which may never come (no `stripe listen` in
   * development) and left this dialog confirming a plan that had been paid for. Once on open,
   * and again from "Check again". The poll below just reads the plan the sync wrote.
   */
  const check = useMutation({
    mutationFn: async () => {
      await api.billing.sync().catch(() => undefined);
      await refetch();
    },
    meta: { toast: false },
  });
  const { mutate: checkNow } = check;
  useEffect(() => checkNow(), [checkNow]);

  useEffect(() => {
    if (reached || slow) return;
    const tick = window.setInterval(() => void refetch(), POLL_MS);
    return () => window.clearInterval(tick);
  }, [reached, slow, refetch]);

  const used = data?.usage.vehicles ?? 0;
  const room = Math.max(0, limitsFor(tier).vehicles - used);
  const gained = gainedFeatures('FREE', tier);

  const title = reached
    ? `You’re on ${PLAN_NAMES[tier]}`
    : slow
      ? 'Payment received'
      : 'Confirming your payment';
  const description = reached
    ? `${PLAN_NAMES[tier]} is active on your account.`
    : slow
      ? 'Your plan hasn’t updated yet. It can take a minute.'
      : 'Usually a few seconds.';

  return (
    <Modal title={title} description={description} onClose={onClose}>
      <div className="flex flex-col gap-5">
        <p role="status" className="sr-only">
          {reached
            ? `${PLAN_NAMES[tier]} is active`
            : slow
              ? 'Not confirmed yet'
              : 'Confirming your payment'}
        </p>

        <figure
          aria-busy={state === 'working'}
          className="flex flex-col items-center gap-4 rounded-2xl bg-muted/40 px-4 pb-6 pt-7"
        >
          <PaymentSeal state={state} />

          {reached && data ? (
            // After the ring has closed, the pass it issued rises into place — the plan you now
            // hold, as settings will show it — with the room it brought under it.
            <div
              className="flex w-full animate-rise flex-col items-center gap-4"
              style={{ animationDelay: '700ms' }}
            >
              <PlanPass plan={data} className="w-full text-left" />
              <Bays
                filled={used}
                open={room}
                icon="car"
                marks={marks}
                label={`${used} vehicles parked, room for ${room} more`}
                className="justify-center"
              />
            </div>
          ) : (
            <figcaption className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {PLAN_NAMES[tier]} {pad(limitsFor(tier).vehicles)}
            </figcaption>
          )}
        </figure>

        {reached ? (
          gained.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="Now included">
              {gained.map((entitlement, index) => (
                <li
                  key={entitlement}
                  className="flex animate-rise items-center gap-3 rounded-xl bg-muted/60 p-3"
                  style={{ animationDelay: `${850 + index * 70}ms` }}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card text-foreground">
                    <Icon name={FEATURE_ICON[entitlement]} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">
                      {ENTITLEMENT_COPY[entitlement].name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {ENTITLEMENT_COPY[entitlement].does}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null
        ) : (
          <ol className="flex flex-col gap-1" aria-label="Payment progress">
            <Step state="done">Paid at Stripe</Step>
            <Step state={slow ? 'waiting' : 'active'} aside={clock(seconds)}>
              {slow ? 'Still confirming' : 'Confirming with Stripe'}
            </Step>
            <Step state="pending">{PLAN_NAMES[tier]} unlocked</Step>
          </ol>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {reached ? (
            <Button variant="primary" size="lg" onClick={onClose} className="sm:min-w-40">
              Done
            </Button>
          ) : slow ? (
            <>
              <Button variant="ghost" size="lg" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="primary"
                size="lg"
                loading={check.isPending}
                onClick={() => check.mutate()}
                className="sm:min-w-40"
              >
                Check again
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="lg" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The tiers side by side, for the person who came to compare rather than hit a wall.
 *
 * Each card lists only what it adds over the one before — "Everything in Plus, and" — so the
 * same line is never read three times. Limits and features come from `@vehicle-os/domain`, so a
 * card cannot promise what the server's own table does not grant.
 */
export function PlanCompare({
  current,
  onDowngrade,
}: {
  current: PlanTier | undefined;
  /** Offered where the smaller paid tier is shown; only the plan settings page manages one. */
  onDowngrade?: (tier: 'PLUS') => void;
}) {
  const checkout = useCheckout();
  const switching = Boolean(current && current !== 'FREE');

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {PLAN_TIERS.map((tier, index) => {
          const limits = limitsFor(tier);
          const previous = index > 0 ? PLAN_TIERS[index - 1]! : null;
          const added = previous ? gainedFeatures(previous, tier) : [];
          const isCurrent = tier === current;
          const canUpgrade = isPaid(tier) && PLAN_RANK[tier] > PLAN_RANK[current ?? 'FREE'];

          return (
            <li
              key={tier}
              className={cn(
                'flex flex-col gap-4 rounded-2xl p-4 transition-colors',
                // Muted, not card: these sit inside a card or a card-coloured dialog, and a
                // card on a card has nothing to separate it (the system's surface rule).
                // The plan you hold is outlined in ink as well as filled: selection, not hover.
                isCurrent
                  ? 'bg-primary-soft ring-2 ring-inset ring-primary'
                  : 'bg-muted/50 hover:bg-muted',
              )}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
                    <TierMark tier={tier} />
                    {PLAN_NAMES[tier]}
                  </h3>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary py-0.5 pl-1.5 pr-2 text-xs font-semibold text-primary-foreground">
                      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                      Current
                    </span>
                  ) : null}
                </div>
                <PriceReading tier={tier} size="md" />
              </div>

              <ul className="flex flex-col gap-0.5 text-sm">
                {(
                  [
                    ['vehicles', limits.vehicles],
                    ['garages', limits.garages],
                    ['people per garage', limits.members],
                  ] as const
                ).map(([label, value]) => (
                  <li key={label} className="flex items-baseline gap-2">
                    <span className="w-8 font-mono font-semibold tabular-nums text-foreground">
                      {pad(value)}
                    </span>
                    <span className="text-muted-foreground">{label}</span>
                  </li>
                ))}
              </ul>

              <ul className="flex flex-1 flex-col gap-1.5 text-sm">
                <li className="text-muted-foreground">
                  {previous ? `Everything in ${PLAN_NAMES[previous]}` : 'Every record, kept free'}
                </li>
                {added.map((entitlement) => (
                  <li key={entitlement} className="flex items-center gap-2 text-foreground">
                    <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" />
                    {ENTITLEMENT_COPY[entitlement].name}
                  </li>
                ))}
              </ul>

              {onDowngrade && tier === 'PLUS' && current === 'BUSINESS' ? (
                <Button variant="secondary" size="sm" onClick={() => onDowngrade(tier)}>
                  Switch to {PLAN_NAMES[tier]}
                </Button>
              ) : null}
              {canUpgrade ? (
                <Button
                  // Ink for the next step up only: one primary on the row, where it leads.
                  variant={
                    PLAN_RANK[tier] === PLAN_RANK[current ?? 'FREE'] + 1 ? 'primary' : 'secondary'
                  }
                  size="sm"
                  loading={checkout.isPending && checkout.variables === tier}
                  disabled={checkout.isPending}
                  onClick={() => checkout.mutate(tier)}
                >
                  {switching ? 'Switch' : 'Upgrade'}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {checkout.isError ? <FormError>{billingError(checkout.error)}</FormError> : null}
    </div>
  );
}

/**
 * A paid feature, in the place it would have been — one row, not a paragraph.
 *
 * Instead of the control rather than beside a disabled one: a greyed-out form invites someone
 * to fill it in to find out why it will not submit.
 */
export function LockedFeature({ wall }: { wall: PlanWall }) {
  const entitlement = isEntitlement(wall.entitlement) ? wall.entitlement : null;
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-muted/50 p-3 pr-4">
      <span className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-card text-foreground">
        <Icon name={entitlement ? FEATURE_ICON[entitlement] : 'star'} size={20} />
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-muted">
          <Lock className="size-2.5" aria-hidden="true" />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {entitlement ? ENTITLEMENT_COPY[entitlement].name : 'Paid feature'}
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {entitlement ? ENTITLEMENT_COPY[entitlement].does : wall.message}
        </p>
      </div>
      <Button size="sm" variant="primary" onClick={() => openUpgrade(wall)}>
        {wall.requiredPlan ? `Get ${PLAN_NAMES[wall.requiredPlan]}` : 'See plans'}
      </Button>
    </div>
  );
}
