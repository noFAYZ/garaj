'use client';

import Link from 'next/link';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Dashboard, Vehicle } from '@vehicle-os/contracts';
import { AddMenu, QuickLine } from '@/components/add-menu';
import { BrandLogo } from '@/components/brand-logo';
import { Icon } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { typeIcon } from '@/components/vehicle-hero';
import { readDue } from '@/lib/due';
import { cn } from '@/lib/utils';

const pad = (value: number) => String(value).padStart(2, '0');
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });

/** The time, kept current to the minute: the greeting and the clock both read from it. */
function useNow(every = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), every);
    return () => window.clearInterval(timer);
  }, [every]);
  return now;
}

/** Morning from five, afternoon from noon, evening from six — and evening again until five. */
function salutationFor(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type Tone = 'late' | 'soon';

interface Item {
  key: string;
  tone: Tone;
  title: string;
  detail: string;
  href: string;
}

/**
 * What needs the person, most urgent first: services overdue, then papers expired, then recalls
 * that may apply, then what is merely coming — each a way straight to the vehicle it is about.
 */
function itemsFrom(attention: Dashboard['attention']): Item[] {
  const items: (Item & { rank: number })[] = [];
  for (const due of attention.maintenance) {
    if (due.plan.status !== 'OVERDUE' && due.plan.status !== 'DUE_SOON') continue;
    const late = due.plan.status === 'OVERDUE';
    items.push({
      key: `plan-${due.plan.id}`,
      rank: late ? 0 : 3,
      tone: late ? 'late' : 'soon',
      title: due.plan.title,
      detail: `${due.vehicleName} · ${readDue(due.plan, due.odometerUnit).headline}`,
      href: `/vehicles/${due.vehicleId}`,
    });
  }
  for (const paper of attention.documents) {
    const days = paper.daysRemaining;
    items.push({
      key: `doc-${paper.document.id}`,
      rank: days < 0 ? 1 : 4,
      tone: days < 0 ? 'late' : 'soon',
      title: paper.document.title,
      detail: `${paper.vehicleName} · ${
        days < 0
          ? `Expired ${-days} ${-days === 1 ? 'day' : 'days'} ago`
          : days === 0
            ? 'Expires today'
            : `Expires in ${days} ${days === 1 ? 'day' : 'days'}`
      }`,
      href: `/vehicles/${paper.vehicleId}/documents`,
    });
  }
  for (const recall of attention.recalls) {
    items.push({
      key: `recall-${recall.notificationId}`,
      rank: 2,
      tone: 'late',
      title: recall.component || recall.campaign,
      detail: `${recall.vehicleName} · May be under recall`,
      href: `/vehicles/${recall.vehicleId}`,
    });
  }
  return items.sort((a, b) => a.rank - b.rank);
}

/** How many of them the greeting names; the rest are counted. */
const SHOWN = 3;

/**
 * The top of the home screen: the day, the person, one line to add or ask anything, and what
 * needs them — compact, so the garage below starts high.
 *
 * Set as a panel over a quiet ground: a fine dot grid, workshop graph paper, fading out before it
 * reaches the words. On the right, the person's own vehicles as a fanned hand of cards — photo,
 * cutout or badge — that spreads as the pointer comes over the panel: whose garage this is, said
 * in pictures, before a word is read.
 *
 * Under the greeting, the line (`QuickLine`) with the add key (`AddMenu`) at its end. Then what
 * is waiting, as pills that go straight to the vehicle concerned; nothing at all when nothing is.
 */
export function Greeting({
  name,
  dashboard,
  vehicles,
}: {
  name: string;
  dashboard: Dashboard;
  /** For the line and the menu — which vehicle a line names — and the cards on the right. */
  vehicles: readonly Vehicle[];
}) {
  const now = useNow();
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  const items = itemsFrom(dashboard.attention);

  return (
    <section
      aria-labelledby="greeting"
      className="group/greeting relative isolate animate-rise rounded-3xl bg-card/60 p-4 sm:p-6"
    >
      <Ground />

      <div className="relative grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 self-center">
          <p className=" text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {DAY.format(now)}
            <span aria-hidden="true"> · </span>
            <time dateTime={now.toISOString()} className="tabular-nums">
              {pad(now.getHours())}:{pad(now.getMinutes())}
            </time>
          </p>
          <h1
            id="greeting"
            className="mt-1.5 text-2xl font-bold tracking-tight text-foreground sm:text-[2rem] sm:leading-tight"
          >
            {salutationFor(now.getHours())}
            {firstName ? (
              <>
                , <span className="text-muted-foreground">{firstName}</span>
              </>
            ) : null}
          </h1>
        </div>

        <Fleet vehicles={vehicles} className="hidden md:row-span-2 md:block md:self-end" />

        <div className="min-w-0">
          <QuickLine vehicles={vehicles} aside={<AddMenu vehicles={vehicles} />} />
        </div>
      </div>

      {items.length > 0 ? (
        <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-label uppercase text-muted-foreground">
            Needs you
            <span className="ml-1.5 font-mono tabular-nums tracking-normal">
              {pad(items.length)}
            </span>
          </span>
          {items.slice(0, SHOWN).map((item, index) => (
            <Link
              key={item.key}
              href={item.href}
              style={{ '--i': index + 1 } as CSSProperties}
              className="stagger inline-flex max-w-full animate-rise items-center gap-2 rounded-full bg-background/60 py-1.5 pl-2.5 pr-3 text-xs backdrop-blur-sm transition-colors hover:bg-background"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  item.tone === 'late' ? 'bg-destructive' : 'bg-warning',
                )}
              />
              <span className="shrink-0 font-semibold text-foreground">{item.title}</span>
              <span className="truncate text-muted-foreground">{item.detail}</span>
            </Link>
          ))}
          {items.length > SHOWN ? (
            <span className="px-1 font-mono text-xs tabular-nums text-muted-foreground">
              +{items.length - SHOWN}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** Workshop graph paper: a fine dot grid, strongest behind the cards and gone before the words. */
export function Ground() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit] bg-[radial-gradient(var(--color-border-strong)_1px,transparent_1.2px)] bg-[length:16px_16px] opacity-60 [mask-image:radial-gradient(90%_120%_at_100%_100%,black,transparent_60%)]"
    />
  );
}

/** How far each card sits from the middle of the hand, at rest and fanned. */
const HAND = { step: 2.25, fan: 3.5, tilt: 7, fanTilt: 11 } as const;

/**
 * The person's vehicles as a hand of cards, three at most, the best picture held in front — a
 * vehicle with a photo before one without. Each is the vehicle as the app draws it everywhere: a
 * cutout standing on its floor, a photo, or the make's badge. The front card carries its name; the
 * ones behind show only their edges. They spread as the pointer comes over the greeting.
 */
function Fleet({ vehicles, className }: { vehicles: readonly Vehicle[]; className?: string }) {
  const shown = [...vehicles]
    .sort(
      (a, b) =>
        Number(Boolean(b.primaryPhoto?.thumbnailUrl)) -
        Number(Boolean(a.primaryPhoto?.thumbnailUrl)),
    )
    .slice(0, 3);
  if (shown.length === 0) return null;
  // The best card in the middle, in front: [2nd, 1st, 3rd].
  const hand = shown.length === 3 ? [shown[1]!, shown[0]!, shown[2]!] : shown;
  const middle = (hand.length - 1) / 2;
  const front = shown[0]!.id;

  return (
    <div aria-hidden="true" className={cn('relative h-36 w-64', className)}>
      {hand.map((vehicle, index) => {
        const spread = index - middle;
        const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
        return (
          <span
            key={vehicle.id}
            style={
              {
                '--x': `${spread * HAND.step}rem`,
                '--fx': `${spread * HAND.fan}rem`,
                '--y': `${Math.abs(spread) * 0.375}rem`,
                '--r': `${spread * HAND.tilt}deg`,
                '--fr': `${spread * HAND.fanTilt}deg`,
                zIndex: 10 - Math.round(Math.abs(spread) * 2),
              } as CSSProperties
            }
            className="absolute bottom-1 left-1/2 h-28 w-[8.5rem] overflow-hidden rounded-2xl bg-muted shadow-float ring-4 ring-card transition-[translate,rotate] duration-500 ease-out [rotate:var(--r)] [translate:calc(-50%+var(--x))_var(--y)] group-hover/greeting:[rotate:var(--fr)] group-hover/greeting:[translate:calc(-50%+var(--fx))_var(--y)]"
          >
            {photo ? (
              photo.isCutout ? (
                <>
                  <span className="absolute bottom-[22%] left-1/2 h-2 w-3/5 -translate-x-1/2 rounded-[100%] bg-foreground opacity-20 blur-sm" />
                  <img
                    src={photo.thumbnailUrl!}
                    alt=""
                    loading="lazy"
                    className="absolute inset-x-2 bottom-[18%] top-2 m-auto max-h-[70%] object-contain"
                  />
                </>
              ) : (
                <img
                  src={photo.thumbnailUrl!}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                />
              )
            ) : (
              <span className="absolute inset-0 grid place-items-center pb-5">
                <span className="grid size-12 place-items-center overflow-hidden rounded-xl bg-card text-muted-foreground">
                  {vehicle.make ? (
                    <BrandLogo
                      make={vehicle.make}
                      size={48}
                      fill
                      className="rounded-xl text-lg text-foreground"
                    />
                  ) : (
                    <Icon name={typeIcon(vehicle.vehicleType)} size={24} />
                  )}
                </span>
              </span>
            )}
            {vehicle.id === front ? (
              <span className="absolute inset-x-1.5 bottom-1.5 truncate rounded-lg bg-background/85 px-2 py-1 text-[0.6875rem] font-semibold text-foreground backdrop-blur">
                {vehicle.displayName}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** The greeting before the dashboard arrives: the same panel, only the words waiting. */
export function GreetingSkeleton() {
  return (
    <div className="relative isolate rounded-3xl bg-card/60 p-4 sm:p-6">
      <Ground />
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2.5 h-8 w-72 max-w-full" />
        </div>
        {/* The real line and key: the menu works before the data arrives. */}
        <QuickLine vehicles={[]} aside={<AddMenu vehicles={[]} />} />
      </div>
    </div>
  );
}
