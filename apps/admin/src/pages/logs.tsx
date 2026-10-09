import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ChevronRight, Filter, Radio, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { get, withQuery, type AuditEntry, type ErrorEntry } from '../lib/api';
import { splitAction, subjectHref, verbOf } from '../lib/audit';
import { ago, clockTime, formatExact, fullStamp, shortId } from '../lib/format';
import { resourceLabel } from '../lib/names';
import { href, setParams, useRoute } from '../lib/route';
import { TimeChart } from '../components/chart';
import { FailureGroups } from '../components/errors';
import {
  DataTable,
  downloadCsv,
  ExportButton,
  fetchEvery,
  SearchField,
  Toolbar,
  useAdminList,
  useArrivals,
} from '../components/list';
import {
  Aside,
  Chip,
  CopyButton,
  PageHeader,
  Panel,
  Segmented,
  type ChipTone,
} from '../components/ui';

/*
 * Two streams: what people changed (the audit log) and what failed (the model, email, push and the
 * outbox). Every filter is the server's own — a prefix of the action, an actor's email, a source —
 * so it is right across every page, not a sieve over the fifty loaded; and the volume chart above
 * the list counts under the same filters, so its bars are the list's own shape.
 */

const CATEGORIES = [
  { label: 'Everything', action: '' },
  { label: 'Console', action: 'admin.' },
  { label: 'Garages', action: 'garage.' },
  { label: 'Vehicles', action: 'vehicle.' },
  { label: 'Records', action: 'event.' },
  { label: 'Expenses', action: 'expense.' },
  { label: 'Maintenance', action: 'maintenance.' },
  { label: 'Documents', action: 'document.' },
  { label: 'Sharing', action: 'share.' },
  { label: 'API keys', action: 'api_key.' },
] as const;

/** Time · verb · action · by · on · ›. */
const COLUMNS =
  'grid-cols-[4.25rem_minmax(0,1fr)_1rem] sm:grid-cols-[4.25rem_5.5rem_minmax(0,1.2fr)_minmax(0,1fr)_1rem] lg:grid-cols-[4.25rem_5.5rem_minmax(0,1.2fr)_minmax(0,1fr)_8rem_1rem]';

const ERROR_COLUMNS =
  'grid-cols-[4.25rem_minmax(0,1fr)_1rem] sm:grid-cols-[4.25rem_5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_1rem]';

const SOURCES: Record<ErrorEntry['source'], { label: string; tone: ChipTone }> = {
  ai: { label: 'Ask', tone: 'ink' },
  email: { label: 'Email', tone: 'info' },
  push: { label: 'Push', tone: 'info' },
  outbox: { label: 'Outbox', tone: 'warning' },
};

const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (iso: string) => new Date(iso).toDateString();

/** The day a run of rows belongs to, as a heading between them. */
function DayHeading({ at, first }: { at: string; first: boolean }) {
  const key = dayKey(at);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  return (
    <li
      className={`px-2.5 pb-1.5 text-label uppercase text-muted-foreground ${first ? 'pt-1' : 'pt-5'}`}
    >
      {key === today ? 'Today' : key === yesterday ? 'Yesterday' : day.format(new Date(at))}
    </li>
  );
}

export function LogsPage() {
  const { id, params } = useRoute();
  const stream = params.get('stream') === 'errors' ? 'errors' : 'changes';
  const live = params.get('live') === '1';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Monitor"
        title="Logs"
        description="Every change and who made it — and everything that failed."
        actions={
          <button
            type="button"
            aria-pressed={live}
            onClick={() => setParams({ live: live ? null : '1' })}
            className={cn(
              'flex h-8 items-center gap-2 rounded-full px-3 text-sm font-semibold transition-colors',
              live
                ? 'bg-success-soft text-success'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            <Radio className={cn('size-4', live && 'animate-pulse')} aria-hidden="true" />
            {live ? 'Live' : 'Go live'}
          </button>
        }
      />
      <Segmented
        label="Stream"
        className="stagger animate-rise self-start [--i:1]"
        value={stream}
        onChange={(next) =>
          setParams({ stream: next === 'changes' ? null : next, source: null, group: null })
        }
        options={[
          { value: 'changes', label: 'Changes' },
          { value: 'errors', label: 'Errors' },
        ]}
      />
      {stream === 'changes' ? <Changes legacy={id} live={live} /> : <Errors live={live} />}
    </div>
  );
}

// --- Changes -------------------------------------------------------------------------------

function Changes({ legacy, live }: { legacy: string | undefined; live: boolean }) {
  const { params } = useRoute();
  // `#/logs/admin.` was how a link pointed at one kind of change; it still lands filtered.
  const action = params.get('action') ?? (legacy?.endsWith('.') ? legacy : '');
  const filters = { q: params.get('q') ?? '', action, actor: params.get('actor') ?? '' };
  const { list, rows } = useAdminList<AuditEntry>('audit', filters, {
    refetchInterval: live ? 5000 : false,
  });
  const volume = useQuery({
    queryKey: ['admin', 'audit-volume', filters],
    queryFn: () =>
      get<{ days: { day: string; count: number }[] }>(
        withQuery('/audit/volume', { ...filters, days: 30 }),
      ),
    refetchInterval: live ? 15_000 : false,
  });
  const fresh = useArrivals(
    rows?.map((row) => row.id),
    JSON.stringify(filters),
    !list.isPlaceholderData,
  );
  const total = volume.data?.days.reduce((sum, row) => sum + row.count, 0);

  return (
    <>
      <Toolbar>
        <SearchField
          label="Search an action or an email"
          value={filters.q}
          onChange={(q) => setParams({ q })}
          className="min-w-56 flex-1"
        />
        <ExportButton
          onExport={async () => {
            const all = await fetchEvery<AuditEntry>('audit', filters, 5000);
            downloadCsv(
              'garaj-audit',
              [
                'time',
                'action',
                'actor',
                'resource',
                'resource id',
                'garage id',
                'ip',
                'request',
                'metadata',
              ],
              all.map((e) => [
                e.createdAt,
                e.action,
                e.actorEmail,
                e.resourceType,
                e.resourceId,
                e.garageId,
                e.ipAddress,
                e.requestId,
                JSON.stringify(e.metadata),
              ]),
            );
          }}
        />
      </Toolbar>
      <div
        role="group"
        aria-label="Kind of change"
        className="scroll-fade-x -mx-4 -mt-2 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {CATEGORIES.map((category) => {
          const on = action === category.action;
          return (
            <button
              key={category.label}
              type="button"
              aria-pressed={on}
              onClick={() => setParams({ action: category.action || null })}
              className={cn(
                'h-8 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors',
                on
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/70 text-muted-foreground hover:text-foreground',
              )}
            >
              {category.label}
            </button>
          );
        })}
      </div>
      {filters.actor ? (
        <div className="-mt-2 flex">
          <Chip tone="ink" className="h-8 pl-3 pr-1">
            <Filter className="size-3.5" aria-hidden="true" />
            By {filters.actor}
            <button
              type="button"
              aria-label="Show everyone's changes"
              onClick={() => setParams({ actor: null })}
              className="grid size-6 place-items-center rounded-full hover:bg-primary/20"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </Chip>
        </div>
      ) : null}

      <Panel
        title="Volume"
        aside={<Aside>{total === undefined ? '' : `${formatExact(total)} in 30 days`}</Aside>}
        className="gap-3 py-4"
      >
        {volume.data ? (
          <TimeChart
            days={volume.data.days.map((row) => row.day)}
            series={[
              {
                key: 'entries',
                label: 'Entries',
                color: 'var(--color-primary)',
                values: volume.data.days.map((row) => row.count),
              },
            ]}
            mode="bars"
            height={84}
            compact
            caption="Log entries per day, last 30 days, under the filters above"
          />
        ) : (
          <Skeleton className="h-[84px] w-full rounded-xl" />
        )}
      </Panel>

      <DataTable
        label="the log"
        list={list}
        rows={rows}
        rowKey={(entry) => entry.id}
        columns={COLUMNS}
        head={
          <>
            <span>Time</span>
            <span className="max-sm:hidden">Kind</span>
            <span>Action</span>
            <span className="max-sm:hidden">By</span>
            <span className="max-lg:hidden">On</span>
            <span />
          </>
        }
        before={(entry, index) =>
          index === 0 || dayKey(rows![index - 1]!.createdAt) !== dayKey(entry.createdAt) ? (
            <DayHeading at={entry.createdAt} first={index === 0} />
          ) : null
        }
        empty={{
          title: filters.q || action || filters.actor ? 'Nothing matches' : 'Nothing recorded yet',
          description: 'Entries appear as people change things.',
        }}
      >
        {(entry) => <LogRow entry={entry} fresh={fresh.has(entry.id)} />}
      </DataTable>
    </>
  );
}

function LogRow({ entry, fresh }: { entry: AuditEntry; fresh: boolean }) {
  const verb = verbOf(entry.action);
  const { scope, what } = splitAction(entry.action);
  const subject = subjectHref(entry);
  const metadata = Object.keys(entry.metadata).length > 0;

  return (
    <details
      className={cn('group/row rounded-xl transition-colors open:bg-card', fresh && 'row-flash')}
    >
      <summary
        className={cn(
          'relative grid cursor-pointer list-none items-center gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-card [&::-webkit-details-marker]:hidden',
          COLUMNS,
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full"
          style={{ backgroundColor: verb.rule }}
        />
        <time
          dateTime={entry.createdAt}
          title={fullStamp(entry.createdAt)}
          className="font-mono text-xs tabular-nums text-muted-foreground"
        >
          {clockTime(entry.createdAt)}
        </time>
        <span className="max-sm:hidden">
          <Chip tone={verb.tone} className="h-5 px-2 text-[11px]">
            <verb.icon className="size-3" strokeWidth={2.6} aria-hidden="true" />
            {verb.label}
          </Chip>
        </span>
        <span className="truncate font-mono text-[13px]">
          <span className="text-muted-foreground">{scope}</span>
          <span className="font-semibold">{what}</span>
        </span>
        <span className="truncate text-sm text-muted-foreground max-sm:hidden">
          {entry.actorEmail ?? 'System'}
        </span>
        <span className="truncate text-xs text-muted-foreground max-lg:hidden">
          {resourceLabel(entry.resourceType)}
          {entry.resourceId ? (
            <span className="font-mono"> · {shortId(entry.resourceId)}</span>
          ) : null}
        </span>
        <ChevronRight
          className="size-4 text-muted-foreground transition-transform group-open/row:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-4 pt-2 sm:pl-[5.25rem]">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Detail label="When">
            {fullStamp(entry.createdAt)} · {ago(entry.createdAt)}
          </Detail>
          <Detail label="By">{entry.actorEmail ?? 'System'}</Detail>
          <Detail label={resourceLabel(entry.resourceType)} copy={entry.resourceId}>
            {entry.resourceId ?? '—'}
          </Detail>
          {entry.garageId ? (
            <Detail label="Garage" copy={entry.garageId}>
              <a
                href={href('garages', entry.garageId)}
                className="underline-offset-2 hover:underline"
              >
                {entry.garageId}
              </a>
            </Detail>
          ) : null}
          {entry.ipAddress ? <Detail label="From">{entry.ipAddress}</Detail> : null}
          {entry.requestId ? (
            <Detail label="Request" copy={entry.requestId}>
              {entry.requestId}
            </Detail>
          ) : null}
        </dl>
        {metadata ? (
          <div className="relative">
            <JsonView value={entry.metadata} />
            <CopyButton
              value={JSON.stringify(entry.metadata, null, 2)}
              label="Copy the metadata"
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {subject ? (
            <a
              href={subject}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold hover:bg-border"
            >
              Open the {entry.resourceType === 'user' ? 'person' : 'garage'}
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {entry.actorEmail ? (
            <button
              type="button"
              onClick={() => setParams({ actor: entry.actorEmail })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold hover:bg-border"
            >
              <Filter className="size-3.5" aria-hidden="true" />
              Only this person
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setParams({ action: entry.action, q: null })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold hover:bg-border"
          >
            <Filter className="size-3.5" aria-hidden="true" />
            Only <span className="font-mono">{entry.action}</span>
          </button>
        </div>
      </div>
    </details>
  );
}

function Detail({
  label,
  copy,
  children,
}: {
  label: string;
  copy?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1 font-mono">
        <span className="truncate">{children}</span>
        {copy ? (
          <CopyButton value={copy} label={`Copy ${label.toLowerCase()}`} className="size-6" />
        ) : null}
      </dd>
    </div>
  );
}

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],]/g;

/** JSON as an editor shows it: keys in ink, strings, numbers and literals each in their colour. */
function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [token, string, colon, literal] = match;
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    if (string) {
      parts.push(
        <span key={at} className={colon ? 'json-key' : 'json-string'}>
          {string}
        </span>,
      );
      if (colon)
        parts.push(
          <span key={`${at}:`} className="json-punct">
            {colon}
          </span>,
        );
    } else if (literal) {
      parts.push(
        <span key={at} className="json-literal">
          {token}
        </span>,
      );
    } else if (/^[{}[\],]$/.test(token)) {
      parts.push(
        <span key={at} className="json-punct">
          {token}
        </span>,
      );
    } else {
      parts.push(
        <span key={at} className="json-number">
          {token}
        </span>,
      );
    }
    last = at + token.length;
  }
  parts.push(text.slice(last));
  return (
    <pre className="scrollbar-slim max-h-80 overflow-auto rounded-xl bg-muted/60 p-3 pr-10 font-mono text-xs leading-relaxed">
      {parts}
    </pre>
  );
}

// --- Errors --------------------------------------------------------------------------------

function Errors({ live }: { live: boolean }) {
  const { params } = useRoute();
  const source = params.get('source') ?? '';
  const grouped = params.get('group') === '1';
  const { list, rows } = useAdminList<ErrorEntry>(
    'errors',
    { source },
    { refetchInterval: live ? 5000 : false },
  );
  const fresh = useArrivals(
    rows?.map((row) => row.id),
    source,
    !list.isPlaceholderData,
  );

  return (
    <>
      <Toolbar>
        <Segmented
          label="Source"
          value={source || 'all'}
          onChange={(next) => setParams({ source: next === 'all' ? null : next })}
          options={[
            { value: 'all', label: 'Everything' },
            { value: 'ai', label: 'Ask Garaj' },
            { value: 'email', label: 'Email' },
            { value: 'push', label: 'Push' },
            { value: 'outbox', label: 'Outbox' },
          ]}
        />
        <Segmented
          label="Show"
          size="sm"
          className="ml-auto"
          value={grouped ? 'group' : 'each'}
          onChange={(next) => setParams({ group: next === 'group' ? '1' : null })}
          options={[
            { value: 'each', label: 'Each one' },
            { value: 'group', label: 'By cause' },
          ]}
        />
      </Toolbar>

      {grouped ? (
        <Panel
          title="By cause"
          aside={<Aside>{rows ? `in the latest ${formatExact(rows.length)}` : ''}</Aside>}
        >
          {rows ? (
            <FailureGroups
              rows={rows.map((row) => ({
                at: row.at,
                message: row.message,
                who: row.email,
                source: `${SOURCES[row.source].label} · ${humanise(row.kind)}`,
              }))}
              empty="Nothing has failed."
            />
          ) : (
            <Skeleton className="h-40 w-full rounded-xl" />
          )}
        </Panel>
      ) : (
        <DataTable
          label="errors"
          list={list}
          rows={rows}
          rowKey={(row) => `${row.source}-${row.id}`}
          columns={ERROR_COLUMNS}
          head={
            <>
              <span>Time</span>
              <span className="max-sm:hidden">Source</span>
              <span>What failed</span>
              <span className="max-sm:hidden">For</span>
              <span />
            </>
          }
          before={(row, index) =>
            index === 0 || dayKey(rows![index - 1]!.at) !== dayKey(row.at) ? (
              <DayHeading at={row.at} first={index === 0} />
            ) : null
          }
          empty={{
            title: 'Nothing has failed',
            description: 'Failed questions, deliveries and dead jobs appear here as they happen.',
          }}
        >
          {(row) => (
            <details
              className={cn('group/row rounded-xl open:bg-card', fresh.has(row.id) && 'row-flash')}
            >
              <summary
                className={cn(
                  'relative grid cursor-pointer list-none items-center gap-4 rounded-xl px-2.5 py-2 transition-colors hover:bg-card [&::-webkit-details-marker]:hidden',
                  ERROR_COLUMNS,
                )}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-destructive"
                />
                <time
                  dateTime={row.at}
                  title={fullStamp(row.at)}
                  className="font-mono text-xs tabular-nums text-muted-foreground"
                >
                  {clockTime(row.at)}
                </time>
                <span className="max-sm:hidden">
                  <Chip tone={SOURCES[row.source].tone} className="h-5 px-2 text-[11px]">
                    {SOURCES[row.source].label}
                  </Chip>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-destructive">
                    {row.message ?? 'No reason recorded'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {humanise(row.kind)}
                  </span>
                </span>
                <span className="truncate text-sm text-muted-foreground max-sm:hidden">
                  {row.email ?? '—'}
                </span>
                <ChevronRight
                  className="size-4 text-muted-foreground transition-transform group-open/row:rotate-90"
                  aria-hidden="true"
                />
              </summary>
              <div className="flex flex-col gap-3 px-3 pb-4 pt-1 sm:pl-[5.25rem]">
                <div className="relative">
                  <pre className="scrollbar-slim max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-destructive-soft p-3 pr-10 font-mono text-xs text-destructive">
                    {row.message ?? 'No reason recorded'}
                  </pre>
                  {row.message ? (
                    <CopyButton
                      value={row.message}
                      label="Copy the message"
                      className="absolute right-1.5 top-1.5"
                    />
                  ) : null}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                  <Detail label="When">
                    {fullStamp(row.at)} · {ago(row.at)}
                  </Detail>
                  <Detail label="Kind">{humanise(row.kind)}</Detail>
                  {row.attempts !== null ? <Detail label="Attempts">{row.attempts}</Detail> : null}
                  <Detail label="Id" copy={row.id}>
                    {row.id}
                  </Detail>
                </dl>
                {row.userId ? (
                  <a
                    href={href('users', row.userId)}
                    className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-semibold hover:bg-border"
                  >
                    Open {row.email ?? 'the person'}
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </details>
          )}
        </DataTable>
      )}
    </>
  );
}
