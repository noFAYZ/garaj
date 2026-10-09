import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Download, Search, X } from 'lucide-react';
import { Fragment, useDeferredValue, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, EmptyState } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { get, withQuery, type Page } from '../lib/api';
import { formatExact } from '../lib/format';

const PAGE = 50;

/**
 * A searchable, filtered, paged admin list. The filters are the server's own (`?plan=PAID`), so a
 * filter is right across every page rather than a sieve over the fifty loaded. Typing searches as
 * you go: the search is deferred so the field stays responsive, and the previous answer stays on
 * screen, dimmed, while the next one is on its way.
 */
export function useAdminList<T>(
  resource: string,
  filters: Record<string, string | undefined>,
  options: { refetchInterval?: number | false } = {},
) {
  const q = useDeferredValue(filters.q?.trim() ?? '');
  const params = { ...filters, q };
  const list = useInfiniteQuery({
    queryKey: ['admin', resource, params],
    queryFn: ({ pageParam }) =>
      get<Page<T>>(withQuery(`/${resource}`, { ...params, limit: PAGE, offset: pageParam })),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
    placeholderData: keepPreviousData,
    refetchInterval: options.refetchInterval,
  });
  const rows = list.data?.pages.flatMap((page) => page.data);
  return { list, rows, searching: q !== '' };
}

export type AdminList<T> = ReturnType<typeof useAdminList<T>>['list'];

/**
 * Rows that arrived since the list was last read, so a live list can light them as they land.
 * Only rows above the newest one already on screen count: an older page loading underneath is
 * not news, and neither is a whole new list after a filter changes (`scope`) — nor rows shown
 * as a placeholder while the next answer is on its way (`ready`).
 */
export function useArrivals(ids: string[] | undefined, scope: string, ready = true) {
  const known = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const signature = ids?.join(',');
  useEffect(() => {
    if (!ids || !ready) return;
    const before = known.current?.scope === scope ? known.current.ids : null;
    known.current = { scope, ids: new Set(ids) };
    if (!before) return;
    const firstKnown = ids.findIndex((id) => before.has(id));
    const arrived = firstKnown > 0 ? ids.slice(0, firstKnown) : [];
    if (arrived.length) setFresh((current) => new Set([...current, ...arrived]));
    // Keyed by the ids' value, not the array, which is new on every render.
  }, [signature, scope, ready]);
  return fresh;
}

/** Every row the filters match, a hundred at a time, for an export. Stops at `max`. */
export async function fetchEvery<T>(
  resource: string,
  filters: Record<string, string | undefined>,
  max = 10_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < max; offset += 100) {
    const page = await get<Page<T>>(withQuery(`/${resource}`, { ...filters, limit: 100, offset }));
    rows.push(...page.data);
    if (!page.hasMore) break;
  }
  return rows;
}

/** A CSV file, saved. Quoted throughout, so a comma or a quote in a name stays in its cell. */
export function downloadCsv(name: string, header: string[], rows: (string | number | null)[][]) {
  const cell = (value: string | number | null) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const text = [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `${name}-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  link.click();
  URL.revokeObjectURL(url);
}

/** The export button: fetches every matching row, then saves them. */
export function ExportButton({ onExport }: { onExport: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() => {
        setPending(true);
        void onExport().finally(() => setPending(false));
      }}
    >
      <Download className="size-4" aria-hidden="true" />
      Export CSV
    </Button>
  );
}

export function SearchField({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={cn('relative block min-w-0', className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        className="h-10 w-full rounded-full bg-input pl-10 pr-9 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:bg-border focus:bg-border [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

/** The row above a list: search first, then the filters that narrow it. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex animate-rise flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}

/**
 * A list's body in every state — loading, failed, empty, rows, and the next page — as a table
 * card. `columns` is one grid template shared by the header and every row, so the figures line
 * up down the page; hide a header cell and its column's cells together. The header sticks under
 * the page's chrome (`--chrome`), so a long list keeps its column names.
 */
export function DataTable<T>({
  label,
  list,
  rows,
  columns,
  head,
  empty,
  rowKey,
  children,
  before,
}: {
  label: string;
  list: AdminList<T>;
  rows: T[] | undefined;
  columns: string;
  head: ReactNode;
  empty: { title: string; description: string; action?: ReactNode };
  rowKey: (row: T) => string;
  children: (row: T, index: number) => ReactNode;
  /** An `<li>` between a row and the one before it: a day's heading in the log. */
  before?: (row: T, index: number) => ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;

  // The next page loads as the end of the list comes into view; the button is there for keyboards.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (list.isError && !rows) {
    return (
      <EmptyState
        title={`Couldn't load ${label}`}
        description={list.error.message}
        action={<Button onClick={() => void list.refetch()}>Try again</Button>}
      />
    );
  }
  if (!list.isPending && !rows?.length) return <EmptyState {...empty} />;

  return (
    <div className="flex animate-rise flex-col gap-3">
      <div className="rounded-2xl bg-card/50">
        {/*
         * Not through `cn`: tailwind-merge reads `text-label` (a size) as a colour, and would drop it
         * for `text-muted-foreground`.
         */}
        <div
          aria-hidden="true"
          className={`sticky top-[var(--chrome,0px)] z-10 grid items-center gap-4 rounded-t-2xl bg-background/85 px-4 pb-2 pt-3.5 text-label uppercase text-muted-foreground backdrop-blur-md ${columns}`}
        >
          {head}
        </div>
        {list.isPending ? (
          <Loading label={`Loading ${label}`}>
            <div className="flex flex-col gap-1 p-1.5">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton
                      className={cn('h-3.5', ['w-1/3', 'w-1/4', 'w-2/5', 'w-1/5'][i % 4])}
                    />
                    <Skeleton className="h-3 w-1/6" />
                  </div>
                  <Skeleton className="h-3.5 w-16" />
                </div>
              ))}
            </div>
          </Loading>
        ) : (
          <ul
            aria-label={label}
            aria-busy={list.isPlaceholderData || undefined}
            className={cn(
              'flex flex-col p-1.5 transition-opacity',
              list.isPlaceholderData && 'opacity-55',
            )}
          >
            {rows!.map((row, index) => (
              <Fragment key={rowKey(row)}>
                {before?.(row, index)}
                <li className="group relative">{children(row, index)}</li>
              </Fragment>
            ))}
          </ul>
        )}
      </div>
      <div ref={sentinel} className="flex min-h-10 items-center justify-center gap-3">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {rows ? `${formatExact(rows.length)}${hasNextPage ? '+' : ''} shown` : ''}
        </span>
        {hasNextPage ? (
          <Button size="sm" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A table row that opens what it names: a link stretched over the row, so the row's own buttons
 * (its ⋯) sit above it as siblings rather than inside a link, where a button may not go.
 */
export function RowLink({ href, label }: { href: string; label: string }) {
  return <a href={href} className="absolute inset-0 z-0 rounded-xl" aria-label={label} />;
}

/** A row's grid: hover lights the row, and everything but its controls lets the link through. */
export const rowClass =
  'pointer-events-none relative grid min-w-0 items-center gap-4 rounded-xl px-2.5 py-2.5 transition-colors group-hover:bg-card [&_:is(a,button,[data-interactive])]:pointer-events-auto';
