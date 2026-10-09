import {
  ArrowRight,
  Inbox,
  Layers,
  LoaderCircle,
  OctagonAlert,
  Plug,
  RefreshCw,
  ShieldCheck,
  Skull,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Gauge } from '@/components/ui/instruments';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { QueueState } from '../lib/api';
import { ago, bytes, formatCount, percent, span } from '../lib/format';
import { useHealth, useOverview, useSystem, useUsage } from '../lib/queries';
import { BACKLOG, partsOf, worst } from '../lib/status';
import { FailureGroups } from '../components/errors';
import {
  Aside,
  Chip,
  Dot,
  Figure,
  Meter,
  PageHeader,
  Panel,
  Quiet,
  StatusTile,
  TONE_TEXT,
} from '../components/ui';

const VERDICT = {
  success: { title: 'Every system is answering', icon: ShieldCheck },
  warning: { title: 'Something wants a look', icon: TriangleAlert },
  destructive: { title: 'Something is broken', icon: OctagonAlert },
  muted: { title: 'Checking every system…', icon: LoaderCircle },
} as const;

const SEGMENT = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground/30',
} as const;

export function SystemPage() {
  const system = useSystem();
  const health = useHealth();
  const overview = useOverview();
  const usage = useUsage(30);
  const redis = system.data?.redis;
  const outbox = system.data?.outbox;
  const live = redis && 'pingMs' in redis ? redis : null;
  const integrations = overview.data?.integrations;

  if (system.isError && !system.data) {
    return (
      <EmptyState
        title="Couldn't read the system"
        description={system.error.message}
        action={<Button onClick={() => void system.refetch()}>Try again</Button>}
      />
    );
  }

  const parts = partsOf({
    health: health.data,
    healthFailed: health.isError,
    system: system.data,
    systemFailed: system.isError,
    overview: overview.data,
    usage: usage.data,
  });
  const checking = parts.some((part) => part.state === 'Checking');
  const verdict = checking ? 'muted' : worst(parts) === 'muted' ? 'success' : worst(parts);
  const trouble = parts.filter((part) => part.tone === 'warning' || part.tone === 'destructive');
  const memory = live && (live.maxMemory || live.peakMemory);
  const used = live && memory ? (live.usedMemory ?? 0) / memory : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Monitor"
        title="System"
        description="The parts Garaj runs on, read when you open this page — never on a timer."
        actions={
          <>
            <span className="text-xs text-muted-foreground max-sm:hidden">
              {system.dataUpdatedAt
                ? `Read ${ago(new Date(system.dataUpdatedAt).toISOString())}`
                : ''}
            </span>
            <Button
              size="sm"
              loading={system.isFetching}
              onClick={() => {
                void system.refetch();
                void health.refetch();
              }}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Check again
            </Button>
          </>
        }
      />

      {/* One panel that answers "is anything wrong?" before any figure is read. */}
      <section
        role="status"
        className="stagger flex animate-rise flex-col gap-5 rounded-2xl bg-card/50 p-5 [--i:1] sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-4">
          <StatusTile
            size="lg"
            part={{ ...parts[0]!, key: 'verdict', icon: VERDICT[verdict].icon, tone: verdict }}
            className={cn(
              verdict === 'success' && 'bg-success-soft text-success',
              checking && '[&_svg]:animate-spin',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold tracking-tight">
              {trouble.length > 1
                ? `${trouble.length} systems want a look`
                : VERDICT[verdict].title}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {checking
                ? 'Reading the API, the database, Redis and the queues.'
                : trouble.length
                  ? trouble.map((part) => `${part.name}: ${part.state}`).join(' · ')
                  : `API up ${span(health.data?.uptimeSeconds ?? null)}, database connected, no failed jobs.`}
            </p>
          </div>
          {health.data ? (
            <dl className="flex gap-6">
              <Figure label="API uptime" value={span(health.data.uptimeSeconds)} />
              <Figure label="Environment" value={overview.data?.environment ?? '—'} />
            </dl>
          ) : null}
        </div>
        {/* A segment per part, in the cluster's order: the whole system in one line. */}
        <ol aria-label="Every part" className="grid grid-cols-10 gap-1">
          {parts.map((part) => (
            <li
              key={part.key}
              title={`${part.name}: ${part.state}`}
              className="group flex flex-col gap-1.5"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-[background-color,scale] duration-150 group-hover:scale-y-150',
                  SEGMENT[part.tone],
                )}
              />
              <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground max-sm:hidden">
                {part.name}
              </span>
              <span className="sr-only">
                {part.name}: {part.state}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <ul className="stagger grid animate-rise grid-cols-1 gap-2 [--i:2] sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {parts.map((part) => (
          <li
            key={part.key}
            className="flex items-start gap-3 rounded-2xl bg-card/50 p-4 transition-colors duration-150 hover:bg-card"
          >
            <StatusTile part={part} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{part.name}</p>
              <p
                className={cn(
                  'truncate font-mono text-xs font-semibold tabular-nums',
                  TONE_TEXT[part.tone],
                )}
              >
                {part.state}
              </p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{part.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="Redis"
          icon={Zap}
          aside={
            redis?.configured ? (
              <Aside>
                {redis.provider}
                {live?.version ? ` ${live.version}` : ''}
              </Aside>
            ) : null
          }
        >
          {!redis ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : !redis.configured ? (
            <Quiet>Not configured: rate limits are per process and the worker can't run.</Quiet>
          ) : redis.error ? (
            <FailureGroups rows={[{ at: null, message: redis.error }]} empty="" />
          ) : live ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex shrink-0 flex-col items-center">
                <Gauge
                  fraction={used}
                  tone={used >= 0.9 ? 'destructive' : used >= 0.75 ? 'warning' : 'ink'}
                  redlineFrom={0.9}
                  label={`Memory: ${bytes(live.usedMemory)} of ${bytes(memory)}`}
                  className="gauge-rise w-36"
                >
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {percent(used, 1)}%
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    memory
                  </span>
                </Gauge>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {bytes(live.usedMemory)} of {bytes(memory)}
                  {live.maxMemory ? '' : ' peak'}
                </span>
              </div>
              <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                <Figure
                  label="Ping"
                  value={`${live.pingMs} ms`}
                  tone={live.pingMs > 500 ? 'warn' : undefined}
                />
                <div className="min-w-0">
                  <dt className="truncate text-label uppercase text-muted-foreground">Hit rate</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tabular-nums tracking-tight">
                    {live.hitRate === null ? '—' : `${Math.round(live.hitRate * 100)}%`}
                  </dd>
                  <dd>
                    <Meter value={live.hitRate ?? 0} tone="success" className="mt-1" />
                  </dd>
                </div>
                <Figure label="Ops / s" value={formatCount(live.opsPerSecond ?? 0)} />
                <Figure label="Keys" value={formatCount(live.keys)} />
                <Figure
                  label="Evicted"
                  value={formatCount(live.evictedKeys ?? 0)}
                  tone={(live.evictedKeys ?? 0) > 0 ? 'warn' : undefined}
                />
                <Figure
                  label="Clients · up"
                  value={`${live.clients ?? '—'} · ${span(live.uptimeSeconds)}`}
                />
              </dl>
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Outbox"
          icon={Inbox}
          aside={
            outbox?.oldestPendingAt ? (
              <Aside>oldest waiting {ago(outbox.oldestPendingAt)}</Aside>
            ) : null
          }
        >
          {outbox ? (
            <>
              <ol className="flex items-stretch gap-1.5" aria-label="Work through the outbox">
                <Station
                  label="Waiting"
                  value={outbox.pending}
                  tone={outbox.pending > BACKLOG ? 'warning' : undefined}
                />
                <li aria-hidden="true" className="grid place-items-center text-muted-foreground">
                  <ArrowRight className="size-4" />
                </li>
                <Station label="Sent · 24h" value={outbox.processedLastDay} tone="success" />
                <Station
                  label="Gave up"
                  value={outbox.deadLettered}
                  tone={outbox.deadLettered > 0 ? 'destructive' : undefined}
                  icon={<Skull className="size-3.5" aria-hidden="true" />}
                />
              </ol>
              <FailureGroups
                rows={outbox.recentDeadLetters.map((row) => ({
                  at: row.deadLetteredAt,
                  message: row.lastError,
                  source: `${row.queue} · ${row.jobName} · ${row.attempts} attempts`,
                }))}
                empty="Nothing dead-lettered: every job ran or is waiting its turn."
              />
            </>
          ) : (
            <Skeleton className="h-40 w-full rounded-xl" />
          )}
        </Panel>
      </div>

      <Panel title="Queues" icon={Layers} aside={live ? <Aside>{live.queues.length}</Aside> : null}>
        {!live ? (
          <Quiet>
            {redis && !redis.configured
              ? 'Queues need Redis.'
              : redis
                ? 'Redis is unreachable.'
                : ' '}
          </Quiet>
        ) : live.queues.length === 0 ? (
          <Quiet>None yet: a queue appears the first time the worker uses it.</Quiet>
        ) : (
          <ul className="flex flex-col gap-2">
            {live.queues.map((queue) => (
              <QueueRow key={queue.name} queue={queue} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Integrations"
        icon={Plug}
        aside={
          integrations ? (
            <Aside>
              {integrations.filter((item) => item.on).length} of {integrations.length} configured
            </Aside>
          ) : null
        }
      >
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {(integrations ?? []).map((item) => (
            <li
              key={item.name}
              className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5"
            >
              <Dot tone={item.on ? 'success' : 'muted'} />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm font-semibold',
                    !item.on && 'text-muted-foreground',
                  )}
                >
                  {item.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
              </span>
              <Chip tone={item.on ? 'success' : 'muted'}>{item.on ? 'Set' : 'Off'}</Chip>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Station({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'warning' | 'destructive';
  icon?: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-1 rounded-xl p-3',
        tone === 'destructive'
          ? 'bg-destructive-soft'
          : tone === 'warning'
            ? 'bg-warning-soft'
            : 'bg-muted/50',
      )}
    >
      <span className="flex items-center gap-1 truncate text-label uppercase text-muted-foreground">
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-2xl font-semibold tabular-nums tracking-tight',
          tone === 'destructive' && 'text-destructive',
          tone === 'warning' && 'text-warning',
        )}
      >
        {formatCount(value)}
      </span>
    </li>
  );
}

const QUEUE_PARTS = [
  { key: 'waiting', label: 'Waiting', color: 'var(--color-chart-service)' },
  { key: 'active', label: 'Active', color: 'var(--color-primary)' },
  { key: 'delayed', label: 'Delayed', color: 'var(--color-chart-trip)' },
  { key: 'failed', label: 'Failed', color: 'var(--color-destructive)' },
] as const;

/** A queue as its work in flight — a bar of what is waiting, running, delayed and failed — and its total done. */
function QueueRow({ queue }: { queue: QueueState }) {
  const inFlight = QUEUE_PARTS.reduce((total, part) => total + queue[part.key], 0);
  return (
    <li className="rounded-xl bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-32 font-mono text-sm font-semibold">{queue.name}</span>
        <div
          aria-hidden="true"
          className="flex h-2 min-w-24 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted"
        >
          {QUEUE_PARTS.map((part) =>
            queue[part.key] ? (
              <span
                key={part.key}
                style={{ flexGrow: queue[part.key], backgroundColor: part.color }}
              />
            ) : null,
          )}
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
          {QUEUE_PARTS.map((part) => (
            <div key={part.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-[3px]"
                style={{ backgroundColor: part.color }}
              />
              <dt className="text-muted-foreground">{part.label}</dt>
              <dd
                className={cn(
                  'font-semibold',
                  part.key === 'failed' && queue.failed > 0
                    ? 'text-destructive'
                    : !queue[part.key] && 'text-muted-foreground',
                )}
              >
                {formatCount(queue[part.key])}
              </dd>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Done</dt>
            <dd className="font-semibold">{formatCount(queue.completed)}</dd>
          </div>
        </dl>
        {inFlight === 0 ? <span className="sr-only">Nothing in flight</span> : null}
      </div>
      {queue.recentFailures.length ? (
        <div className="mt-3">
          <FailureGroups
            rows={queue.recentFailures.map((job) => ({
              at: job.at,
              message: job.reason,
              source: `${job.name ?? 'job'} #${job.id}${job.attempts ? ` · ${job.attempts} attempts` : ''}`,
            }))}
            empty=""
          />
        </div>
      ) : null}
    </li>
  );
}
