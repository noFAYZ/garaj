'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { SearchResultType } from '@vehicle-os/contracts';
import { searchQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { SEARCH_KINDS } from '@/lib/search-kinds';
import { Icon } from '@/components/icons';
import { EmptyState, Field, StatusRegion } from '@/components/ui/primitives';
import { ListSkeleton, Loading } from '@/components/ui/skeleton';
import { formatDate, humanise } from '@/lib/format';

const ORDER: SearchResultType[] = [
  'VEHICLE',
  'MAINTENANCE',
  'TASK',
  'DOCUMENT',
  'EVENT',
  'EXPENSE',
  'IDEA',
];

export default function SearchPage() {
  // `useSearchParams` suspends during prerender, so the page owns a boundary of its own.
  return (
    <Suspense fallback={<StatusRegion>Loading search…</StatusRegion>}>
      <SearchScreen />
    </Suspense>
  );
}

function SearchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';
  const [term, setTerm] = useState(initial);

  /*
   * The URL follows the box, debounced. A search you can paste to someone is worth the
   * `replace` — and `replace` rather than `push` so the back button leaves the page instead
   * of walking back through every keystroke.
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = term.trim();
      if (next === (params.get('q') ?? '')) return;
      router.replace(next ? `/search?q=${encodeURIComponent(next)}` : '/search');
    }, 300);
    return () => clearTimeout(timer);
  }, [term, router, params]);

  // Holds the previous results while the next ones load, so the list does not blink on
  // every keystroke.
  const results = useQuery({
    ...searchQuery(api, term.trim(), { limit: 40 }),
    placeholderData: keepPreviousData,
  });

  const grouped = ORDER.map((type) => ({
    type,
    items: (results.data?.results ?? []).filter((result) => result.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Across every vehicle, service, task, document and expense you can see.
        </p>
      </div>

      <Field
        label="Search"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Timing belt, Hoffman Motors, insurance…"
        autoFocus
      />

      {term.trim().length < 2 ? (
        <p className="text-sm text-muted-foreground">Type at least two characters.</p>
      ) : results.isPending ? (
        <Loading label="Searching">
          <ListSkeleton rows={4} />
        </Loading>
      ) : grouped.length === 0 ? (
        <EmptyState
          title={`Nothing matches “${term.trim()}”`}
          description="Try a shorter word — the search matches anywhere in a title, not just the start."
        />
      ) : (
        <>
          <StatusRegion>
            {results.data?.results.length}{' '}
            {results.data?.results.length === 1 ? 'result' : 'results'}
          </StatusRegion>

          {grouped.map((group) => (
            <section key={group.type} aria-labelledby={`results-${group.type}`}>
              <h2
                id={`results-${group.type}`}
                className="mb-3 text-sm font-medium text-muted-foreground"
              >
                {SEARCH_KINDS[group.type].label}{' '}
                <span className="tabular-nums">({group.items.length})</span>
              </h2>

              <ul className="flex flex-col gap-2">
                {group.items.map((result) => (
                  <li key={`${result.type}-${result.id}`}>
                    <Link
                      href={SEARCH_KINDS[result.type].href(result)}
                      className="flex items-start gap-3 rounded-xl bg-card/50 p-4 transition-colors hover:bg-card"
                    >
                      <Icon
                        name={SEARCH_KINDS[result.type].icon}
                        size={18}
                        className="mt-0.5 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {result.title}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[result.subtitle ? humanise(result.subtitle) : null, result.vehicleName]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      {result.date ? (
                        <time
                          dateTime={result.date}
                          className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        >
                          {formatDate(result.date)}
                        </time>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
