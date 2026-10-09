import { useQueries, useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  BadgeCheck,
  Download,
  NotebookPen,
  Search,
  Star,
  ToggleRight,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Gauge } from '@/components/ui/instruments';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { authClient, get, type AuditEntry, type Page, type UserRow } from '../lib/api';
import { splitAction, verbOf } from '../lib/audit';
import { ago, dayLabel, formatCount, formatExact, percent } from '../lib/format';
import { useActivity, useHealth, useOverview, useSystem, useUsage } from '../lib/queries';
import { href, setParams, useRoute } from '../lib/route';
import { partsOf, worst, type Part } from '../lib/status';
import { Funnel, Heatmap, SplitBar } from '../components/chart';
import { downloadCsv, fetchEvery, useArrivals } from '../components/list';
import { Cell, MetricTabs } from '../components/metrics';
import { APPS, openPalette } from '../components/palette';
import {
  Aside,
  Chip,
  Dot,
  Face,
  Kbd,
  Meter,
  PageHeader,
  Panel,
  Segmented,
  StatusTile,
  TONE_TEXT,
} from '../components/ui';

const WINDOWS = [7, 30, 90] as const;
type Window = (typeof WINDOWS)[number];

export const windowFrom = (value: string | null): Window =>
  WINDOWS.find((days) => String(days) === value) ?? 30;

export const RangePicker = ({ value }: { value: Window }) => (
  <Segmented
    label="Time range"
    value={String(value)}
    onChange={(days) => setParams({ days: days === '30' ? null : days })}
    options={WINDOWS.map((days) => ({
      value: String(days),
      label: `${days}d`,
      title: `Last ${days} days`,
    }))}
  />
);

/**
 * Up or not, nothing more: `no-cors` gets an opaque answer from any origin, and an opaque answer
 * is still an answer. A refused connection or a four-second silence is down.
 */
const reachable = (url: string) =>
  fetch(url, {
    method: 'HEAD',
    mode: 'no-cors',
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  })
    .then(() => true)
    .catch(() => false);

/** Level at the end of each day, walked back from today's total by what each day added. */
const running = (total: number, added: number[]) => {
  const out: number[] = [];
  let level = total;
  for (let i = added.length - 1; i >= 0; i -= 1) {
    out[i] = Math.max(0, level);
    level -= added[i]!;
  }
  return out;
};

const ENTITIES = [
  { key: 'users', label: 'Users', added: 'signups' },
  { key: 'garages', label: 'Garages', added: 'garages' },
  { key: 'vehicles', label: 'Vehicles', added: 'vehicles' },
] as const;

export function OverviewPage() {
  const { params } = useRoute();
  const days = windowFrom(params.get('days'));
  const session = authClient.useSession() as { data: { user: { name: string } } | null };
  const overview = useOverview();
  const activity = useActivity();
  const usage = useUsage(30);
  const system = useSystem();
  const health = useHealth();

  const data = overview.data;
  const counts = data?.counts;
  const all = activity.data?.days;
  const shown = all?.slice(-days);
  const before = all && all.length >= days * 2 ? all.slice(-days * 2, -days) : undefined;
  const sum = (rows: typeof all, key: 'signups' | 'garages' | 'vehicles' | 'records') =>
    rows?.reduce((total, row) => total + row[key], 0);

  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? 'Up late'
      : hour < 12
        ? 'Good morning'
        : hour < 18
          ? 'Good afternoon'
          : 'Good evening';
  const firstName = session.data?.user.name.trim().split(/\s+/)[0];
  const today = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date());

  if (overview.isError) {
    return (
      <EmptyState
        title="Couldn't load the overview"
        description={overview.error.message}
        action={<Button onClick={() => void overview.refetch()}>Try again</Button>}
      />
    );
  }

  const parts = partsOf({
    health: health.data,
    healthFailed: health.isError,
    system: system.data,
    systemFailed: system.isError,
    overview: data,
    usage: usage.data,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="relative">
        {/* Bleeds to the page's edges — exactly its gutter at each width, or a phone scrolls sideways. */}
        <div
          aria-hidden="true"
          className="drafting pointer-events-none absolute -inset-x-4 -top-6 bottom-0 sm:-inset-x-6 lg:-inset-x-10 lg:-top-10"
        />
        <PageHeader
          className="relative"
          eyebrow={`${data ? `${data.environment} · ` : ''}${today}`}
          title={`${greeting}${firstName ? `, ${firstName}` : ''}`}
          description={`Here is Garaj over the last ${days} days.`}
          actions={<RangePicker value={days} />}
        />
      </div>

      <Systems parts={parts} />

      <MetricTabs
        label="Growth"
        className="stagger animate-rise [--i:2]"
        days={days}
        dayKeys={shown?.map((day) => day.day)}
        modes={['total', 'daily']}
        metrics={ENTITIES.map((item) => {
          const now = sum(shown, item.added);
          return {
            key: item.key,
            label: item.label,
            value: counts?.[item.key],
            sub: now === undefined ? undefined : `+${formatCount(now)} in ${days}d`,
            now,
            before: sum(before, item.added),
            // ponytail: vehicles counts live rows but "added" includes ones deleted since, so the
            // early vehicle line reads a little low. A deletions series would square it.
            levels:
              all && counts
                ? running(
                    counts[item.key],
                    all.map((day) => day[item.added]),
                  ).slice(-days)
                : undefined,
            daily: shown?.map((day) => day[item.added]),
          };
        })}
        extra={<Online online={counts?.online} today={activity.data?.activeUsers.day} />}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel
          title="Activation"
          className="stagger animate-rise [--i:3]"
          aside={<Aside>{counts ? `${formatCount(counts.users)} people` : ''}</Aside>}
        >
          <Funnel
            steps={[
              { key: 'signed', label: 'Signed up', value: counts?.users },
              { key: 'garage', label: 'Has a garage', value: data?.funnel.garage },
              { key: 'vehicle', label: 'Has a vehicle', value: data?.funnel.vehicle },
              { key: 'record', label: 'Logged a record', value: data?.funnel.record },
            ]}
          />
        </Panel>
        <Engagement
          users={counts?.users}
          active={activity.data?.activeUsers}
          className="stagger animate-rise [--i:4]"
        />
        <Plans users={counts?.users} plans={data?.plans} className="stagger animate-rise [--i:5]" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Logbook days={all} className="stagger animate-rise [--i:6]" />
        <QuickActions className="stagger animate-rise [--i:7]" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <LiveFeed className="stagger animate-rise [--i:8]" />
        <Newest className="stagger animate-rise [--i:9]" />
      </div>
    </div>
  );
}

// --- Systems -----------------------------------------------------------------------------

/**
 * The cluster's warning lights, in a row: one per part of the system, lit in the colour of its
 * verdict. The heading says the one thing worth knowing — all clear, or how many want a look.
 */
function Systems({ parts }: { parts: Part[] }) {
  const tone = worst(parts);
  const trouble = parts.filter((part) => part.tone === 'warning' || part.tone === 'destructive');
  const checking = parts.some((part) => part.state === 'Checking');
  return (
    <section
      aria-label="Systems"
      className="stagger animate-rise rounded-2xl bg-card/50 p-2 [--i:1]"
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-1 pt-2">
        <p className="flex items-center gap-2.5 text-sm font-semibold">
          <Dot
            tone={checking ? 'muted' : tone === 'muted' ? 'success' : tone}
            pulse={tone === 'destructive'}
          />
          {checking
            ? 'Checking every system…'
            : trouble.length === 0
              ? 'Every system is answering'
              : `${trouble.length} ${trouble.length === 1 ? 'system wants' : 'systems want'} a look`}
        </p>
        <a
          href={href('system')}
          className="group inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          System
          <ArrowUpRight
            className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </a>
      </div>
      <ul className="grid grid-cols-2 gap-1 sm:grid-cols-5 xl:grid-cols-10">
        {parts.map((part) => (
          <li key={part.key}>
            <a
              href={href('system')}
              title={`${part.name}: ${part.state} — ${part.detail}`}
              className="flex min-w-0 items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-card xl:flex-col xl:items-center xl:gap-2 xl:py-3 xl:text-center"
            >
              <StatusTile part={part} />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">{part.name}</span>
                <span
                  className={cn(
                    'block truncate font-mono text-[11px] tabular-nums',
                    TONE_TEXT[part.tone],
                  )}
                >
                  {part.state}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Online ------------------------------------------------------------------------------

/** People here now, against everyone seen today. Not a tab: there is no history of it to chart. */
function Online({ online, today }: { online: number | undefined; today: number | undefined }) {
  // Today's figure moves once a day per person, so the live count can briefly run ahead of it.
  const base = Math.max(today ?? 0, online ?? 0);
  return (
    <Cell
      label={
        <>
          <Dot tone="success" pulse />
          Online now
        </>
      }
    >
      {online === undefined ? (
        <Skeleton className="h-9 w-12" />
      ) : (
        <span className="font-mono text-[1.9rem] font-semibold leading-9 tracking-tight">
          {formatCount(online)}
        </span>
      )}
      <span className="flex min-h-6 items-center font-mono text-xs tabular-nums text-muted-foreground">
        {online === undefined || today === undefined ? ' ' : `of ${formatCount(base)} seen today`}
      </span>
      <div className="flex h-9 items-end">
        <Meter value={base ? (online ?? 0) / base : 0} tone="success" className="h-2 w-full" />
      </div>
    </Cell>
  );
}

// --- Engagement and plans ------------------------------------------------------------------

function Engagement({
  users,
  active,
  className,
}: {
  users: number | undefined;
  active: { day: number; week: number; month: number } | undefined;
  className?: string;
}) {
  const stickiness = active && active.month ? active.day / active.month : 0;
  const rows = active
    ? [
        { label: 'Today', value: active.day },
        { label: '7 days', value: active.week },
        { label: '30 days', value: active.month },
        { label: 'Dormant', value: Math.max(0, (users ?? 0) - active.month) },
      ]
    : undefined;
  return (
    <Panel title="Engagement" className={className} aside={<Aside>people seen</Aside>}>
      <div className="flex items-center gap-4">
        <Gauge
          fraction={stickiness}
          tone={stickiness >= 0.2 ? 'success' : stickiness > 0 ? 'ink' : 'muted'}
          label={`Stickiness: ${Math.round(stickiness * 100)} percent of this month's people came today`}
          className="gauge-rise w-32 shrink-0"
        >
          <span className="font-mono text-lg font-semibold tabular-nums">
            {active ? `${Math.round(stickiness * 100)}%` : '—'}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            DAU/MAU
          </span>
        </Gauge>
        <dl className="flex min-w-0 flex-1 flex-col gap-1.5">
          {(rows ?? Array.from({ length: 4 }, () => null)).map((row, i) =>
            row ? (
              <div key={row.label} className="flex items-baseline justify-between gap-2 text-sm">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="font-mono font-semibold tabular-nums">
                  {formatCount(row.value)}
                  <span className="ml-1.5 inline-block w-9 text-right text-xs font-normal text-muted-foreground">
                    {users ? `${percent(row.value, users)}%` : ''}
                  </span>
                </dd>
              </div>
            ) : (
              <Skeleton key={i} className="h-5 w-full" />
            ),
          )}
        </dl>
      </div>
    </Panel>
  );
}

function Plans({
  users,
  plans,
  className,
}: {
  users: number | undefined;
  plans: { PLUS?: number; BUSINESS?: number } | undefined;
  className?: string;
}) {
  const plus = plans?.PLUS ?? 0;
  const business = plans?.BUSINESS ?? 0;
  const paid = plus + business;
  return (
    <Panel
      title="Plans"
      className={className}
      aside={
        <a
          href={href('users', undefined, { plan: 'PAID' })}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          Who pays
        </a>
      }
    >
      <div>
        {users === undefined ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              {percent(paid, users)}%
            </span>
            <span className="text-sm text-muted-foreground">
              paid · <span className="font-mono tabular-nums">{formatCount(paid)}</span> of{' '}
              {formatCount(users)}
            </span>
          </p>
        )}
      </div>
      <SplitBar
        onSelect={(plan) => {
          window.location.hash = href('users', undefined, { plan });
        }}
        parts={[
          {
            key: 'FREE',
            label: 'Free',
            value: Math.max(0, (users ?? 0) - paid),
            color: 'var(--color-chart-neutral)',
          },
          {
            key: 'PLUS',
            label: 'Plus',
            value: plus,
            color: 'color-mix(in oklch, var(--color-primary) 55%, transparent)',
          },
          { key: 'BUSINESS', label: 'Business', value: business, color: 'var(--color-primary)' },
        ]}
      />
    </Panel>
  );
}

// --- Logbook heatmap ---------------------------------------------------------------------

function Logbook({
  days,
  className,
}: {
  days: { day: string; records: number }[] | undefined;
  className?: string;
}) {
  const total = days?.reduce((sum, day) => sum + day.records, 0) ?? 0;
  const busiest = days?.reduce<{ day: string; records: number } | null>(
    (best, day) => (!best || day.records > best.records ? day : best),
    null,
  );
  const activeDays = days?.filter((day) => day.records > 0).length ?? 0;
  // The same days folded onto the week: which day people sit down to write.
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (const day of days ?? [])
    byWeekday[(new Date(`${day.day}T12:00:00Z`).getUTCDay() + 6) % 7]! += day.records;
  const peakWeekday = Math.max(1, ...byWeekday);
  return (
    <Panel
      title="Logbook activity"
      icon={NotebookPen}
      className={className}
      aside={<Aside>records written · 13 weeks</Aside>}
    >
      {days ? (
        <>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <Heatmap
              days={days.map((day) => day.day)}
              values={days.map((day) => day.records)}
              noun={['record', 'records']}
            />
            <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-1 sm:gap-y-3 sm:text-right">
              <Stat label="Records" value={formatExact(total)} />
              <Stat label="Per day" value={(total / Math.max(days.length, 1)).toFixed(1)} />
              <Stat label="Active days" value={`${activeDays}/${days.length}`} />
              <Stat
                label="Busiest"
                value={busiest && busiest.records ? formatExact(busiest.records) : '—'}
                hint={busiest && busiest.records ? dayLabel(busiest.day, 'long') : undefined}
              />
            </dl>
          </div>
          <div className="mt-auto border-t border-border/60 pt-4">
            <p className="mb-2 text-label uppercase text-muted-foreground">By day of the week</p>
            <ul className="grid grid-cols-7 gap-2">
              {WEEKDAY_NAMES.map((name, i) => {
                const value = byWeekday[i]!;
                const top = value === peakWeekday && value > 0;
                return (
                  <li
                    key={name}
                    className="flex flex-col items-center gap-1.5"
                    title={`${name}: ${formatExact(value)} records`}
                  >
                    <span className="flex h-14 w-full items-end overflow-hidden rounded-md bg-muted/50">
                      <span
                        className={cn(
                          'w-full rounded-md transition-[height] duration-700',
                          top ? 'bg-primary' : 'bg-primary/35',
                        )}
                        style={{
                          height: `${value ? Math.max((value / peakWeekday) * 100, 6) : 0}%`,
                        }}
                      />
                    </span>
                    <span
                      className={cn(
                        'text-[11px] font-semibold',
                        top ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {name.slice(0, 3)}
                    </span>
                    <span className="sr-only">{formatExact(value)} records</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      ) : (
        <Skeleton className="h-[150px] w-full rounded-xl" />
      )}
    </Panel>
  );
}

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-label uppercase text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg font-semibold tabular-nums tracking-tight">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

// --- Quick actions -------------------------------------------------------------------------

function QuickActions({ className }: { className?: string }) {
  const probes = useQueries({
    queries: APPS.map((app) => ({
      queryKey: ['admin', 'reachable', app.url],
      queryFn: () => reachable(new URL(app.probe ?? '/', app.url).href),
      enabled: Boolean(app.probe),
      refetchInterval: 30_000,
      retry: false,
    })),
  });
  const health = useHealth();

  const actions: { label: string; icon: LucideIcon; hint?: ReactNode; run: () => void }[] = [
    { label: 'Search anything', icon: Search, hint: <Kbd>/</Kbd>, run: () => openPalette() },
    { label: 'Set a plan', icon: Star, run: () => openPalette({ kind: 'pick', purpose: 'plan' }) },
    {
      label: 'Verify an email',
      icon: BadgeCheck,
      run: () => openPalette({ kind: 'pick', purpose: 'verify' }),
    },
    {
      label: 'Sign someone out',
      icon: UserX,
      run: () => openPalette({ kind: 'pick', purpose: 'revoke' }),
    },
    { label: 'Flip a feature', icon: ToggleRight, run: () => openPalette({ kind: 'flags' }) },
    {
      label: 'Export users',
      icon: Download,
      run: () =>
        void fetchEvery<UserRow>('users', {}).then((rows) =>
          downloadCsv(
            'garaj-users',
            ['id', 'name', 'email', 'plan', 'verified', 'garages', 'joined', 'last seen'],
            rows.map((u) => [
              u.id,
              u.name,
              u.email,
              u.plan,
              u.emailVerified ? 'yes' : 'no',
              u.garages,
              u.createdAt,
              u.lastSeenAt,
            ]),
          ),
        ),
    },
  ];

  return (
    <Panel title="Quick actions" className={className} aside={<Aside>or press ⌘K</Aside>}>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {actions.map((action) => (
          <li key={action.label}>
            <button
              type="button"
              onClick={action.run}
              className="group flex h-full w-full flex-col items-start gap-3 rounded-xl bg-muted/50 p-3 text-left transition-[background-color,scale] duration-200 hover:bg-muted active:scale-[0.97]"
            >
              <span className="flex w-full items-center justify-between">
                <span className="grid size-8 place-items-center rounded-lg bg-card transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <action.icon className="size-4" aria-hidden="true" />
                </span>
                {action.hint}
              </span>
              <span className="text-xs font-semibold leading-tight">{action.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div>
        <p className="mb-1.5 text-label uppercase text-muted-foreground">Apps</p>
        <ul className="flex flex-col">
          {APPS.map((app, i) => {
            const up = app.probe
              ? probes[i]!.data
              : health.data
                ? true
                : health.isError
                  ? false
                  : undefined;
            return (
              <li key={app.name}>
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                >
                  <app.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{app.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground max-sm:hidden">
                    {new URL(app.url).host}
                  </span>
                  <Dot tone={up === undefined ? 'muted' : up ? 'success' : 'destructive'} />
                  <span className="sr-only">
                    {up === undefined ? 'checking' : up ? 'running' : 'not responding'}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

// --- Live feed and newest members -----------------------------------------------------------

/** The audit log's newest entries, kept fresh: a new one arrives with a flash. */
function LiveFeed({ className }: { className?: string }) {
  const log = useQuery({
    queryKey: ['admin', 'audit-feed'],
    queryFn: () => get<Page<AuditEntry>>('/audit?limit=8'),
    refetchInterval: 15_000,
  });
  const fresh = useArrivals(
    log.data?.data.map((entry) => entry.id),
    'feed',
  );

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Live activity
          <Chip tone="success" className="h-5 px-2 text-[10px] uppercase tracking-wider">
            <Dot tone="success" pulse className="size-1.5" />
            Live
          </Chip>
        </span>
      }
      className={className}
      aside={
        <a
          href={href('logs')}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          All logs
        </a>
      }
    >
      {log.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-xl" />
          ))}
        </div>
      ) : log.data?.data.length ? (
        <ol className="-mx-2 flex flex-col">
          {log.data.data.map((entry, index) => {
            const verb = verbOf(entry.action);
            const { scope, what } = splitAction(entry.action);
            return (
              <li
                key={entry.id}
                className={cn(
                  'stagger animate-rise rounded-xl',
                  fresh.has(entry.id) && 'row-flash',
                )}
                style={{ '--i': index } as CSSProperties}
              >
                <a
                  href={href('logs', undefined, { q: entry.action })}
                  className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-lg"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${verb.rule} 14%, transparent)`,
                      color: verb.rule,
                    }}
                  >
                    <verb.icon className="size-4" strokeWidth={2.4} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]">
                      <span className="text-muted-foreground">{scope}</span>
                      <span className="font-semibold">{what}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.actorEmail ?? 'System'}
                    </span>
                  </span>
                  <time
                    dateTime={entry.createdAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {ago(entry.createdAt)}
                  </time>
                </a>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      )}
    </Panel>
  );
}

function Newest({ className }: { className?: string }) {
  const newest = useQuery({
    queryKey: ['admin', 'users', 'newest'],
    queryFn: () => get<Page<UserRow>>('/users?limit=8'),
  });
  return (
    <Panel
      title="Newest members"
      className={className}
      aside={
        <a
          href={href('users')}
          className="text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          All users
        </a>
      }
    >
      {newest.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-xl" />
          ))}
        </div>
      ) : newest.data?.data.length ? (
        <ul className="-mx-2 flex flex-col">
          {newest.data.data.map((user, index) => (
            <li
              key={user.id}
              className="stagger animate-rise"
              style={{ '--i': index } as CSSProperties}
            >
              <a
                href={href('users', user.id)}
                className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-card"
              >
                <Face id={user.id} image={user.image} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {user.name || user.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                {user.plan !== 'FREE' ? <Chip tone="ink">{humanise(user.plan)}</Chip> : null}
                <time dateTime={user.createdAt} className="shrink-0 text-xs text-muted-foreground">
                  {ago(user.createdAt)}
                </time>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody yet.</p>
      )}
    </Panel>
  );
}
