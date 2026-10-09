import { Bot, Mail, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Gauge } from '@/components/ui/instruments';
import { Readings } from '@/components/ui/overview';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Usage } from '../lib/api';
import { formatCount, formatExact, percent, secondsOf, share } from '../lib/format';
import { useActivity, useUsage } from '../lib/queries';
import { href, setParams, useRoute } from '../lib/route';
import { RankBars, SplitBar, TimeChart } from '../components/chart';
import { FailureGroups } from '../components/errors';
import { Cell, MetricTabs, type Better, type Metric } from '../components/metrics';
import { Aside, Chip, Face, Figure, PageHeader, PageTabs, Panel } from '../components/ui';
import { RangePicker, windowFrom } from './overview';

type Day = NonNullable<ReturnType<typeof useActivity>['data']>['days'][number];
type Key = Exclude<keyof Day, 'day'>;
type Tab = 'ai' | 'email' | 'push';

/** A latency's verdict: quick under four seconds, slow past ten. */
const speedTone = (ms: number | null) =>
  ms === null ? 'muted' : ms < 4000 ? 'success' : ms < 10_000 ? 'warning' : 'destructive';

export function AnalyticsPage() {
  const { params } = useRoute();
  const days = windowFrom(params.get('days'));
  const tab: Tab =
    params.get('tab') === 'email' ? 'email' : params.get('tab') === 'push' ? 'push' : 'ai';
  const usage = useUsage(days);
  const activity = useActivity();
  const u = usage.data;
  const all = activity.data?.days;
  const shown = all?.slice(-days);
  const before = all && all.length >= days * 2 ? all.slice(-days * 2, -days) : undefined;
  const range = { days, shown, before };

  if (usage.isError) {
    return (
      <EmptyState
        title="Couldn't load analytics"
        description={usage.error.message}
        action={<Button onClick={() => void usage.refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-6 transition-opacity duration-150',
        usage.isPlaceholderData && 'opacity-60',
      )}
    >
      <PageHeader
        eyebrow="Monitor"
        title="Analytics"
        description={`What Ask Garaj answered, and what reached people, over the last ${days} days.`}
        actions={<RangePicker value={days} />}
      />

      <PageTabs
        label="Analytics"
        value={tab}
        onChange={(next) => setParams({ tab: next === 'ai' ? null : next })}
        tabs={[
          {
            value: 'ai',
            label: 'Ask Garaj',
            icon: Bot,
            badge: u ? (
              u.ai.errors && percent(u.ai.errors, u.ai.requests) >= 5 ? (
                <Chip tone="destructive" className="h-5 px-1.5 font-mono text-[11px]">
                  {share(u.ai.errors, u.ai.requests)} failed
                </Chip>
              ) : (
                <Count value={u.ai.requests} />
              )
            ) : null,
          },
          {
            value: 'email',
            label: 'Email',
            icon: Mail,
            badge: u ? (
              u.email.failed ? (
                <Chip tone="destructive" className="h-5 px-1.5 font-mono text-[11px]">
                  {formatCount(u.email.failed)} failed
                </Chip>
              ) : (
                <Count value={u.email.sent} />
              )
            ) : null,
          },
          {
            value: 'push',
            label: 'Push',
            icon: Smartphone,
            badge: u ? (
              u.push.failed ? (
                <Chip tone="destructive" className="h-5 px-1.5 font-mono text-[11px]">
                  {formatCount(u.push.failed)} failed
                </Chip>
              ) : (
                <Count value={u.push.sent} />
              )
            ) : null,
          },
        ]}
      >
        {tab === 'ai' ? (
          <AiTab u={u} {...range} />
        ) : tab === 'email' ? (
          <EmailTab u={u} {...range} />
        ) : (
          <PushTab u={u} {...range} />
        )}
      </PageTabs>
    </div>
  );
}

const Count = ({ value }: { value: number }) => (
  <span className="rounded-md bg-muted px-1.5 py-px font-mono text-[11px] tabular-nums text-muted-foreground">
    {formatCount(value)}
  </span>
);

interface TabProps {
  u: Usage | undefined;
  days: number;
  shown: Day[] | undefined;
  before: Day[] | undefined;
}

const sum = (rows: Day[] | undefined, key: Key) =>
  rows?.reduce((total, row) => total + row[key], 0);

/** A line above a tab's figures saying what is being measured, and by what. */
function Context({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{children}</p>
      {aside}
    </div>
  );
}

// --- Ask Garaj -----------------------------------------------------------------------------

function AiTab({ u, days, shown, before }: TabProps) {
  const daily = (key: Key, label: string, better?: Better): Metric => ({
    key,
    label,
    value: sum(shown, key),
    now: sum(shown, key),
    before: sum(before, key),
    better,
    daily: shown?.map((day) => day[key]),
  });
  const tokens = u ? u.ai.inputTokens + u.ai.outputTokens : 0;
  const scale = Math.max(20_000, (u?.ai.p95LatencyMs ?? 0) * 1.25);

  return (
    <>
      <Context
        aside={
          u ? (
            <Chip tone={u.ai.configured ? 'muted' : 'warning'}>
              <span className="font-mono">{u.ai.configured ? u.ai.model : 'No AI_API_KEY'}</span>
            </Chip>
          ) : null
        }
      >
        Questions people asked about their vehicles, what they cost in tokens, and how fast and how
        often they were answered.
      </Context>
      <MetricTabs
        label="Ask Garaj"
        days={days}
        dayKeys={shown?.map((day) => day.day)}
        modes={['daily']}
        metrics={[daily('aiRequests', 'Questions'), daily('aiTokens', 'Tokens')]}
        extra={
          <Cell label="Reliability">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Figure
                label="Failed"
                value={u ? share(u.ai.errors, u.ai.requests) : '—'}
                tone={u && u.ai.errors > 0 ? 'bad' : undefined}
                hint={
                  u ? `${formatCount(u.ai.errors)} of ${formatCount(u.ai.requests)}` : undefined
                }
              />
              <Figure
                label="Turns / ask"
                value={u && u.ai.requests ? (u.ai.turns / u.ai.requests).toFixed(1) : '—'}
                hint="model calls"
              />
            </dl>
          </Cell>
        }
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="Response time" aside={<Aside>per question</Aside>}>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Typical', u?.ai.avgLatencyMs ?? null, 'average'],
                ['Slowest 5%', u?.ai.p95LatencyMs ?? null, 'p95'],
              ] as const
            ).map(([label, ms, caption]) => (
              <div key={label} className="flex flex-col items-center">
                <Gauge
                  fraction={ms === null ? 0 : ms / scale}
                  tone={speedTone(ms)}
                  redlineFrom={10_000 / scale}
                  label={`${label} answer: ${ms === null ? 'no answers yet' : secondsOf(ms)}`}
                  className="gauge-rise w-full max-w-36"
                >
                  <span className="font-mono text-base font-semibold tabular-nums">
                    {u ? secondsOf(ms) : '—'}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {caption}
                  </span>
                </Gauge>
                <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Tokens" aside={<Aside>{u ? formatCount(tokens) : ''}</Aside>}>
          {u ? (
            <>
              <SplitBar
                parts={[
                  {
                    key: 'in',
                    label: 'Read (input)',
                    value: u.ai.inputTokens,
                    color: 'var(--color-chart-service)',
                  },
                  {
                    key: 'out',
                    label: 'Written (output)',
                    value: u.ai.outputTokens,
                    color: 'var(--color-primary)',
                  },
                ]}
              />
              <dl className="grid grid-cols-2 gap-3">
                <Figure
                  label="Per question"
                  value={u.ai.requests ? formatCount(Math.round(tokens / u.ai.requests)) : '—'}
                />
                <Figure label="Questions" value={formatExact(u.ai.requests)} />
              </dl>
            </>
          ) : (
            <Skeleton className="h-32 w-full rounded-xl" />
          )}
        </Panel>
        <Panel title="Top askers" aside={<Aside>asks · tokens</Aside>}>
          {u?.ai.topUsers.length ? (
            <RankBars
              rows={u.ai.topUsers.map((row) => ({
                key: row.userId ?? 'deleted',
                lead: row.userId ? (
                  <Face id={row.userId} size={24} className="relative z-10" />
                ) : undefined,
                label: row.name || row.email || 'Deleted account',
                value: row.requests,
                href: row.userId ? href('users', row.userId) : undefined,
                aside: formatCount(row.tokens),
              }))}
            />
          ) : u ? (
            <p className="text-sm text-muted-foreground">Nobody asked anything.</p>
          ) : (
            <Skeleton className="h-32 w-full rounded-xl" />
          )}
        </Panel>
      </div>
      <Panel
        title="Why questions failed"
        aside={<Aside>{u ? formatCount(u.ai.errors) : ''}</Aside>}
      >
        {u ? (
          <FailureGroups
            rows={u.ai.recentErrors.map((row) => ({
              at: row.createdAt,
              who: row.email,
              message: row.error,
            }))}
            empty="Every question was answered."
          />
        ) : (
          <Skeleton className="h-16 w-full rounded-xl" />
        )}
      </Panel>
    </>
  );
}

// --- Email and push ------------------------------------------------------------------------

/** What one channel sent and what it failed to, the same four ways for email and for push. */
function Channel({ u, days, shown, before, channel }: TabProps & { channel: 'EMAIL' | 'PUSH' }) {
  const email = channel === 'EMAIL';
  const stats = u ? (email ? u.email : u.push) : undefined;
  const sentKey = email ? 'emails' : 'pushes';
  const failedKey = email ? 'emailFailures' : 'pushFailures';
  const sentNow = sum(shown, sentKey);
  const sentBefore = sum(before, sentKey);
  const attempts = stats ? stats.sent + stats.failed : 0;
  const color = email ? 'var(--color-chart-service)' : 'var(--color-chart-trip)';
  const noun = email ? 'Emails' : 'Pushes';

  return (
    <>
      <Readings
        readings={[
          {
            label: 'Sent',
            value: stats ? formatExact(stats.sent) : undefined,
            caption:
              sentNow !== undefined && sentBefore !== undefined
                ? sentBefore
                  ? `${sentNow >= sentBefore ? '+' : '−'}${Math.abs(Math.round(((sentNow - sentBefore) / sentBefore) * 100))}% on the ${days} days before`
                  : `${formatCount(sentNow)} in ${days} days`
                : `last ${days} days`,
          },
          {
            label: 'Failed',
            value: stats ? formatExact(stats.failed) : undefined,
            tone: stats?.failed ? 'destructive' : undefined,
            caption: stats ? `${share(stats.failed, attempts)} of attempts` : undefined,
          },
          {
            label: 'Delivered',
            value: stats ? (attempts ? `${percent(stats.sent, attempts)}%` : '—') : undefined,
            tone: stats && attempts && stats.sent / attempts < 0.95 ? 'warning' : undefined,
            caption: 'of what was tried',
          },
          email
            ? {
                label: 'Reminder kinds',
                value: u
                  ? formatExact(
                      u.notifications.byType.filter((row) => row.channel === channel).length,
                    )
                  : undefined,
                caption: 'sent at least once',
              }
            : {
                label: 'Phones',
                value: u
                  ? formatExact(u.push.devices.reduce((total, row) => total + row.count, 0))
                  : undefined,
                caption: 'registered for push',
              },
        ]}
      />

      <Panel title={`${noun} per day`} aside={<Aside>last {days} days</Aside>}>
        {shown ? (
          <TimeChart
            key={`${channel}-${days}`}
            days={shown.map((day) => day.day)}
            mode="bars"
            trend={days > 7}
            caption={`${noun} sent and failed per day`}
            series={[
              { key: 'sent', label: 'Sent', color, values: shown.map((day) => day[sentKey]) },
              {
                key: 'failed',
                label: 'Failed',
                color: 'var(--color-destructive)',
                values: shown.map((day) => day[failedKey]),
              },
            ]}
          />
        ) : (
          <Skeleton className="h-[260px] w-full rounded-xl" />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="By reminder" aside={<Aside>sent</Aside>}>
          {u ? (
            <ByReminder
              rows={u.notifications.byType.filter((row) => row.channel === channel)}
              color={color}
            />
          ) : (
            <Skeleton className="h-32 w-full rounded-xl" />
          )}
        </Panel>
        {email ? (
          <Panel title="Sender">
            {u ? (
              <dl className="flex flex-col">
                <Line label="Provider">Resend</Line>
                <Line label="From">{u.email.configured ? u.email.from : 'Not set'}</Line>
                <Line label="Status">
                  {u.email.configured ? (
                    <Chip tone="success">Configured</Chip>
                  ) : (
                    <Chip tone="warning">No RESEND_API_KEY</Chip>
                  )}
                </Line>
              </dl>
            ) : (
              <Skeleton className="h-28 w-full rounded-xl" />
            )}
          </Panel>
        ) : (
          <Panel title="Phones" aside={<Aside>by platform</Aside>}>
            {u?.push.devices.length ? (
              <SplitBar
                parts={u.push.devices.map((row, i) => ({
                  key: row.platform,
                  label: row.platform === 'ios' ? 'iOS' : humanise(row.platform),
                  value: row.count,
                  color: i === 0 ? 'var(--color-primary)' : 'var(--color-chart-service)',
                }))}
              />
            ) : u ? (
              <p className="text-sm text-muted-foreground">No phone registered for push yet.</p>
            ) : (
              <Skeleton className="h-24 w-full rounded-xl" />
            )}
            {u ? (
              <p className="mt-auto border-t border-border/60 pt-3 text-xs text-muted-foreground">
                <span className="font-mono font-semibold text-foreground">
                  {percent(u.notifications.read, u.notifications.created)}%
                </span>{' '}
                of reminders were read in the app ({formatCount(u.notifications.read)} of{' '}
                {formatCount(u.notifications.created)}).
              </p>
            ) : null}
          </Panel>
        )}
      </div>

      <Panel
        title={`Why ${noun.toLowerCase()} failed`}
        aside={<Aside>{stats ? formatCount(stats.failed) : ''}</Aside>}
      >
        {u ? (
          <FailureGroups
            rows={u.recentFailures
              .filter((row) => row.channel === channel)
              .map((row) => ({
                at: row.createdAt,
                who: row.email,
                message: row.error,
                source: humanise(row.type),
              }))}
            empty={`Every ${email ? 'email' : 'push'} that was sent arrived.`}
          />
        ) : (
          <Skeleton className="h-16 w-full rounded-xl" />
        )}
      </Panel>
    </>
  );
}

function EmailTab(props: TabProps) {
  return (
    <>
      <Context>Reminders sent by email: how many went out, how many bounced, and why.</Context>
      <Channel {...props} channel="EMAIL" />
    </>
  );
}

function PushTab(props: TabProps) {
  return (
    <>
      <Context>
        Reminders sent to phones through Expo, and the phones that can receive them.
      </Context>
      <Channel {...props} channel="PUSH" />
    </>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 py-2.5 first:border-t-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-xs font-semibold">{children}</dd>
    </div>
  );
}

/** Each reminder type as a bar against the busiest one. */
function ByReminder({ rows, color }: { rows: { type: string; count: number }[]; color: string }) {
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...sorted.map((row) => row.count));
  if (sorted.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing sent in this window.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((row) => (
        <li key={row.type}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{humanise(row.type)}</span>
            <span className="font-mono font-semibold tabular-nums">{formatExact(row.count)}</span>
          </div>
          <div aria-hidden="true" className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(row.count / max) * 100}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
