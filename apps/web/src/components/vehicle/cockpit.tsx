'use client';

import { Maximize2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useId,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { CostSummary, MonthlySpend, Vehicle } from '@vehicle-os/contracts';
import { monthlyPace, monthsSince } from '@vehicle-os/ui';
import { Icon, type IconName } from '@/components/icons';
import { buttonClass } from '@/components/ui/button-class';
import { Odometer } from '@/components/ui/instruments';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoneyWhole } from '@/lib/format';
import { addLinkProps } from '@/lib/open-add';
import { cn } from '@/lib/utils';

/**
 * The vehicle's readout, set into the hero as a screen: the two figures people open a vehicle to
 * read — how far it has gone and what it has cost — large, each in a panel of its own, and engine
 * hours beneath them for what runs by the hour.
 *
 * The screen carries figures, not charts. Pressing a panel opens its year in a dialog: the
 * odometer as a line (it is a running total), the spend as a column a month (an amount per
 * period), both on the same twelve calendar months. Hovering there scrubs the figure: the drums
 * roll back to what they read on that day, the spend to that month.
 *
 * Every reading draws its label at once: `undefined` is a placeholder in its final place, `null`
 * a reading nobody has taken, said as a dash.
 */

export interface Reading {
  readonly occurredAt: string;
  readonly odometer: number | null;
}

/**
 * The year's months as their thirteen edges, oldest first, so the current month is the last
 * column. UTC, because that is how the spend is bucketed.
 */
function monthEdges(now = new Date()) {
  return Array.from({ length: 13 }, (_, i) =>
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1),
  );
}

/**
 * Where a moment falls across the twelve columns, 0–1. Measured within its own month, so a reading
 * sits over its month's column however long that month is. Older than the first edge pins left.
 */
function across(edges: readonly number[], t: number) {
  const month = edges.findLastIndex((edge) => edge <= t);
  if (month < 0) return 0;
  if (month >= 12) return 1;
  return (month + (t - edges[month]!) / (edges[month + 1]! - edges[month]!)) / 12;
}

const dateIn = (t: number, options: Intl.DateTimeFormatOptions) =>
  new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', ...options });

/** A month's key in the spend series: `YYYY-MM`, UTC like the edges. */
const monthKey = (edge: number) => new Date(edge).toISOString().slice(0, 7);

/** The column a pointer is over, 0–11. */
const columnAt = (event: PointerEvent<HTMLElement>) => {
  const box = event.currentTarget.getBoundingClientRect();
  return Math.min(11, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * 12)));
};

const PANEL =
  'group/panel stagger relative flex min-w-0 animate-rise flex-col justify-between bg-background px-4 py-3 transition-colors @md:px-5 @md:py-3.5';
/*
 * Sized by the container, not the viewport — the screen in the hero (full width on a phone, where
 * the panels stack, half of it beside each other), the dialog's body in the dialog. A fixed-height
 * line, so the drums and the money share a floor.
 */
const FIGURE =
  'flex h-[1.35em] min-w-0 items-center font-mono font-semibold leading-none tabular-nums tracking-tight text-foreground';
const ON_SCREEN = 'mt-2 text-[length:min(11cqi,2.75rem)] @md:text-[length:min(5.2cqi,2.5rem)]';
const IN_DIALOG = 'text-[length:min(11cqi,3rem)]';
const LINE = 'mt-2 flex min-h-5 min-w-0 items-baseline gap-1 text-xs text-muted-foreground';
const TRACE = 'relative mt-5 h-32 touch-pan-y';

/** Nothing on record yet: a dash, quieter than a figure, so a gap never reads as a reading. */
const NONE = (
  <span role="img" aria-label="None yet" className="text-muted-foreground/70">
    —
  </span>
);

type Open = 'odometer' | 'spend' | null;

export function CockpitDisplay({
  vehicle,
  cost,
  monthly,
  trail,
  className,
}: {
  /** `undefined` while it loads. */
  vehicle: Vehicle | undefined;
  /** The last twelve months' spend. `undefined` while it loads, `null` when it could not be had. */
  cost: CostSummary | null | undefined;
  /**
   * Spend per month, oldest first: two years, so this one can be set against the last. The screen
   * shows its current month. `undefined` while it loads, `null` when it could not be had.
   */
  monthly: MonthlySpend | null | undefined;
  /** The odometer readings of the last year, in any order. */
  trail: readonly Reading[] | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState<Open>(null);
  const edges = monthEdges();
  const close = () => setOpen(null);
  const onOpen = vehicle ? setOpen : undefined;

  return (
    <div
      data-screen=""
      className={cn(
        '@container flex min-w-0 flex-col overflow-hidden rounded-2xl bg-background',
        className,
      )}
    >
      <div className="grid flex-1 gap-px bg-border/60 @md:grid-cols-2">
        <OdometerPanel vehicle={vehicle} trail={trail} edges={edges} onOpen={onOpen} />
        <SpendPanel vehicle={vehicle} cost={cost} monthly={monthly} edges={edges} onOpen={onOpen} />
        <EngineHours hours={vehicle?.currentEngineHours ?? null} />
      </div>

      {/* Mounted only while open, so each opening starts at rest rather than mid-scrub. */}
      {open && vehicle ? (
        <Modal title={open === 'odometer' ? 'Odometer' : 'Spending'} size="lg" onClose={close}>
          <div className="@container min-w-0">
            {open === 'odometer' ? (
              <OdometerPanel vehicle={vehicle} trail={trail} edges={edges} onClose={close} />
            ) : (
              <SpendPanel
                vehicle={vehicle}
                cost={cost}
                monthly={monthly}
                edges={edges}
                onClose={close}
              />
            )}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * A panel on the screen: its label, an aside, the figure. The whole panel is the way into its
 * year — a button laid over it, so the label and figure stay plain text for a screen reader.
 */
function ScreenPanel({
  icon,
  label,
  basis,
  aside,
  index,
  onOpen,
  children,
}: {
  icon: IconName;
  label: string;
  basis?: string;
  aside?: ReactNode;
  index: number;
  onOpen?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(PANEL, onOpen && 'hover:bg-card/40')}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="flex min-w-0 items-center gap-2 text-label uppercase text-muted-foreground">
          {/* Side by side in a narrow screen (beside a photo), the label needs the room. */}
          <span className="contents @md:@max-2xl:hidden">
            <Icon name={icon} size={14} />
          </span>
          <span className="truncate">{label}</span>
          {basis ? (
            <span className="whitespace-nowrap font-mono tracking-wider opacity-80">· {basis}</span>
          ) : null}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          {aside}
          {onOpen ? (
            <span
              aria-hidden="true"
              className="-mr-1 grid size-6 place-items-center rounded-md text-muted-foreground @md:@max-2xl:hidden transition-[background-color,color,scale] group-hover/panel:bg-muted group-hover/panel:text-foreground group-active/panel:scale-95"
            >
              <Maximize2 className="size-3.5" />
            </span>
          ) : null}
        </div>
      </div>
      {children}
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${label}, last 12 months`}
          aria-haspopup="dialog"
          // The screen clips its corners, so the focus outline is drawn inside the panel.
          className="absolute inset-0 cursor-pointer focus-visible:-outline-offset-2"
        />
      ) : null}
    </section>
  );
}

/** The twelve months lettered under a trace, the one in view lit. */
function Months({ edges, lit }: { edges: readonly number[]; lit: number }) {
  return (
    <div
      aria-hidden="true"
      className="mt-2 grid grid-cols-12 gap-1 text-center font-mono text-[0.625rem] font-semibold uppercase text-muted-foreground @lg:text-[0.6875rem]"
    >
      {edges.slice(0, 12).map((edge, i) => (
        <span key={edge} className={cn('transition-colors', i === lit && 'text-foreground')}>
          <span className="@lg:hidden">{dateIn(edge, { month: 'narrow' })}</span>
          <span className="hidden @lg:inline">{dateIn(edge, { month: 'short' })}</span>
        </span>
      ))}
    </div>
  );
}

/** Where each action leaves the dialog for: the dialog closes on the way. */
function DialogAction({
  href,
  onClick,
  children,
}: {
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-5 flex justify-end">
      <Link href={href} scroll={false} onClick={onClick} className={buttonClass('secondary', 'md')}>
        {children}
      </Link>
    </div>
  );
}

function OdometerPanel({
  vehicle,
  trail,
  edges,
  onOpen,
  onClose,
}: {
  vehicle: Vehicle | undefined;
  trail: readonly Reading[] | undefined;
  edges: readonly number[];
  /** On the screen: opens the year. Without it, this is the dialog's body. */
  onOpen?: (open: Open) => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [at, setAt] = useState<number | null>(null);
  const unit = vehicle?.odometerUnit === 'MI' ? 'mi' : 'km';
  const points = (trail ?? [])
    .flatMap(({ occurredAt, odometer }) =>
      odometer === null ? [] : [{ t: Date.parse(occurredAt), odometer }],
    )
    .toSorted((a, b) => a.t - b.t)
    .map((point) => ({ ...point, x: across(edges, point.t) }));
  const scrubbed = at === null ? null : (points[at] ?? null);
  const odometer = vehicle ? (scrubbed?.odometer ?? vehicle.currentOdometer) : undefined;
  const distance = points.length > 1 ? points.at(-1)!.odometer - points[0]!.odometer : null;
  const onScreen = Boolean(onOpen) || !vehicle;

  const figure = (
    <div className={cn(FIGURE, onScreen ? ON_SCREEN : IN_DIALOG)}>
      {odometer === undefined ? (
        <Skeleton className="h-[0.9em] w-[6em] max-w-full" />
      ) : odometer === null ? (
        NONE
      ) : (
        <span
          role="img"
          aria-label={`${odometer.toLocaleString()} ${unit === 'km' ? 'kilometres' : 'miles'}`}
          className="odo-drums flex min-w-0 items-center gap-[0.3em] whitespace-nowrap"
        >
          <Odometer value={odometer} />
          <span className="self-end pb-[0.25em] text-[0.36em] uppercase tracking-[0.2em] text-muted-foreground">
            {unit}
          </span>
        </span>
      )}
    </div>
  );

  const line = (
    <p className={LINE}>
      {scrubbed ? (
        <span className="font-mono uppercase tracking-wider text-foreground">
          {dateIn(scrubbed.t, { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      ) : distance !== null ? (
        <>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            +{distance.toLocaleString()}
          </span>
          {unit}
        </>
      ) : vehicle?.currentOdometer === null ? (
        'Not read yet'
      ) : vehicle && trail ? (
        'No readings this year'
      ) : (
        ' '
      )}
    </p>
  );

  if (onScreen) {
    return (
      <ScreenPanel
        icon="odometer"
        label="Odometer"
        index={0}
        onOpen={onOpen && (() => onOpen('odometer'))}
      >
        {figure}
      </ScreenPanel>
    );
  }
  return (
    <>
      {figure}
      {line}
      <Trail points={points} at={at} onScrub={setAt} />
      <Months edges={edges} lit={scrubbed ? Math.min(11, Math.floor(scrubbed.x * 12)) : 11} />
      <DialogAction {...addLinkProps(router, `/vehicles/${vehicle!.id}?add=done`, onClose)}>
        Log a reading
      </DialogAction>
    </>
  );
}

const H = 40;

/**
 * The odometer's year: a running total, so a line, scaled from the year's low to its high and
 * drawn through the readings only — a straight run between two is what anyone would assume.
 * The month graticule behind it is the spend's columns, so the two dialogs read alike.
 */
function Trail({
  points,
  at,
  onScrub,
}: {
  points: readonly { odometer: number; x: number }[];
  at: number | null;
  onScrub: (index: number | null) => void;
}) {
  const id = useId();
  const lo = Math.min(...points.map((point) => point.odometer));
  const hi = Math.max(...points.map((point) => point.odometer));
  const xy = points.map((point) => ({
    x: point.x * 100,
    y: hi === lo ? H / 2 : H - 3 - ((point.odometer - lo) / (hi - lo)) * (H - 9),
  }));
  const line = xy
    .map(({ x, y }, i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');
  const marked = xy[at ?? xy.length - 1];

  return (
    <div
      aria-hidden="true"
      className={cn(
        TRACE,
        'bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px)] bg-[length:calc(100%/12)_100%]',
      )}
      onPointerMove={(event) => {
        if (points.length < 2) return;
        const box = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - box.left) / box.width) * 100;
        let nearest = 0;
        xy.forEach((point, i) => {
          if (Math.abs(point.x - x) < Math.abs(xy[nearest]!.x - x)) nearest = i;
        });
        onScrub(nearest);
      }}
      onPointerLeave={() => onScrub(null)}
    >
      {xy.length > 1 ? (
        <div className="trail-wipe absolute inset-0">
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0"
                  style={{ stopColor: 'var(--color-foreground)', stopOpacity: 0.14 }}
                />
                <stop offset="1" style={{ stopColor: 'var(--color-foreground)', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <path
              d={`${line} L ${xy.at(-1)!.x.toFixed(2)} ${H} L ${xy[0]!.x.toFixed(2)} ${H} Z`}
              fill={`url(#${id})`}
            />
            <path
              d={line}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-muted-foreground"
            />
          </svg>
          {at !== null ? (
            <span
              className="absolute inset-y-0 w-px -translate-x-1/2 bg-border-strong"
              style={{ left: `${marked!.x}%` }}
            />
          ) : null}
          {/* The latest reading at rest; the one under the pointer while scrubbing. */}
          <span
            className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card"
            style={{ left: `${marked!.x}%`, top: `${(marked!.y / H) * 100}%` }}
          />
        </div>
      ) : (
        // Fewer than two readings make no line: the floor it would stand on, so the dialog keeps its shape.
        <span className="absolute inset-x-0 bottom-0 border-t border-dashed border-border-strong" />
      )}
    </div>
  );
}

function SpendPanel({
  vehicle,
  cost,
  monthly,
  edges,
  onOpen,
  onClose,
}: {
  vehicle: Vehicle | undefined;
  cost: CostSummary | null | undefined;
  monthly: MonthlySpend | null | undefined;
  edges: readonly number[];
  /** On the screen: opens the year. Without it, this is the dialog's body. */
  onOpen?: (open: Open) => void;
  onClose?: () => void;
}) {
  const [at, setAt] = useState<number | null>(null);
  // A series in another currency than the total would set two units side by side.
  const series = monthly && (!cost || monthly.currency === cost.currency) ? monthly : undefined;
  const byMonth = new Map(series?.points.map((point) => [point.month, point.amountMinor]));
  const amounts = edges.slice(0, 12).map((edge) => byMonth.get(monthKey(edge)) ?? 0);
  // The screen's figure, in the series' own currency: it stands alone, beside no total.
  const thisMonth =
    monthly?.points.find((point) => point.month === monthKey(edges[11]!))?.amountMinor ?? 0;
  const peak = Math.max(...amounts, 1);
  const pace = series
    ? monthlyPace(series.points, vehicle?.purchaseDate ? monthsSince(vehicle.purchaseDate) : null)
    : null;
  const before = series?.points.slice(-24, -12).reduce((sum, point) => sum + point.amountMinor, 0);
  const money = (amountMinor: number) =>
    formatMoneyWhole(series && { amountMinor, currency: series.currency });
  const onScreen = Boolean(onOpen) || !vehicle;

  /*
   * On the screen, this calendar month's spend — the last column — so the hero answers "what has it
   * cost lately" without a year's sum to unpick. In the dialog, the cost summary's twelve months to
   * today (purchase included, as on Statistics); the columns are calendar months of running spend,
   * and hovering a column reads that month, so the two never claim to be the same sum.
   */
  const total = onScreen
    ? monthly && formatMoneyWhole({ amountMinor: thisMonth, currency: monthly.currency })
    : at !== null && series
      ? money(amounts[at]!)
      : cost
        ? formatMoneyWhole(cost.totalSpent)
        : cost;
  const change = pace?.changePercent ?? null;

  // Spending more is the thing to notice; less is the good news — as on Statistics.
  const chip =
    change !== null ? (
      <span
        title={before ? `${money(before)} the 12 months before` : undefined}
        className={cn(
          'inline-flex h-5 items-center gap-1 rounded-full px-1.5 font-mono text-xs font-semibold tabular-nums',
          change > 0
            ? 'bg-warning-soft text-warning'
            : change < 0
              ? 'bg-success-soft text-success'
              : 'bg-muted text-muted-foreground',
        )}
      >
        <span aria-hidden="true">{change > 0 ? '▲' : change < 0 ? '▼' : '→'}</span>
        {Math.abs(Math.round(change))}%
        <span className="sr-only"> against the 12 months before</span>
      </span>
    ) : null;

  const figure = (
    <div className={cn(FIGURE, onScreen ? ON_SCREEN : IN_DIALOG)}>
      {total === undefined ? (
        <Skeleton className="h-[0.9em] w-[4.5em] max-w-full" />
      ) : total === null ? (
        NONE
      ) : (
        <span className="truncate">{total}</span>
      )}
    </div>
  );

  const line = (
    <p className={LINE}>
      {at !== null && series ? (
        <span className="font-mono uppercase tracking-wider text-foreground">
          {dateIn(edges[at]!, { month: 'long', year: 'numeric' })}
        </span>
      ) : pace && pace.averageMinor > 0 ? (
        <>
          <span className="font-mono font-semibold tabular-nums text-foreground">
            {money(pace.averageMinor)}
          </span>
          / mo avg
        </>
      ) : (
        ' '
      )}
      {onScreen ? null : <span className="ml-auto self-center">{chip}</span>}
    </p>
  );

  if (onScreen) {
    return (
      <ScreenPanel
        icon="money"
        label="Spent"
        basis={dateIn(edges[11]!, { month: 'short' })}
        index={1}
        onOpen={onOpen && (() => onOpen('spend'))}
      >
        {figure}
      </ScreenPanel>
    );
  }
  return (
    <>
      {figure}
      {line}
      <div
        aria-hidden="true"
        className={cn(TRACE, 'flex items-end gap-1')}
        onPointerMove={(event) => series && setAt(columnAt(event))}
        onPointerLeave={() => setAt(null)}
      >
        {amounts.map((amount, i) => (
          <span
            key={i}
            className={cn(
              'bar-grow flex-1 rounded-t-[4px] transition-[height,background-color] duration-500',
              !amount
                ? 'bg-muted'
                : i === at
                  ? 'bg-foreground'
                  : i === 11 && at === null
                    ? 'bg-muted-foreground'
                    : 'bg-border-strong',
            )}
            style={
              {
                height: amount ? `${Math.max(3, (amount / peak) * 100)}%` : '2px',
                '--i': i,
              } as CSSProperties
            }
          />
        ))}
        {/* The monthly average as a rule across the columns: above it is a dear month. */}
        {pace && pace.averageMinor > 0 ? (
          <span
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground"
            style={{ bottom: `${Math.min(100, (pace.averageMinor / peak) * 100)}%` }}
          />
        ) : null}
      </div>
      <Months edges={edges} lit={at ?? 11} />
      <DialogAction href={`/vehicles/${vehicle!.id}/statistics`} onClick={onClose}>
        Open Statistics
      </DialogAction>
    </>
  );
}

/**
 * Hours run, for what is measured by the hour as well as the distance — a boat, a tractor. Most
 * vehicles have none, and then the screen is the two panels alone.
 */
function EngineHours({ hours }: { hours: number | null }) {
  if (hours === null) return null;
  return (
    <dl className="flex items-baseline gap-2 bg-background px-4 py-2.5 @md:col-span-2 @md:px-5">
      <dt className="text-label uppercase text-muted-foreground">Engine</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {hours.toLocaleString()} h
      </dd>
    </dl>
  );
}
