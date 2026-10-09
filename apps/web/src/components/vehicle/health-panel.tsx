'use client';

import { useQuery } from '@tanstack/react-query';
import { healthQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { HealthDial } from '@/components/health-dial';
import { SectionCard } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';
import { humanise } from '@/lib/format';

/**
 * The health score with its working shown — what the Details tab led with, opened in place
 * from Activity.
 */
export function HealthPanel({ vehicleId }: { vehicleId: string }) {
  const health = useQuery(healthQuery(api, vehicleId));

  return (
    <SectionCard title="Health" description="Built from what is due, its condition and its record.">
      {health.isPending ? (
        <Loading label="Loading health">
          <div className="flex items-center gap-6">
            <Skeleton className="size-20 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        </Loading>
      ) : health.data ? (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <HealthDial score={health.data.overall} />

          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{health.data.summary}</p>

            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-3">
              {health.data.categories.map((category) => (
                <div key={category.category} className="min-w-0">
                  <dt className="text-label uppercase text-muted-foreground">
                    {humanise(category.category)}
                  </dt>
                  <dd className="mt-0.5 text-sm tabular-nums text-foreground">
                    {category.score === null ? '—' : category.score}
                    <span className="ml-2 text-xs text-muted-foreground">{category.basis}</span>
                  </dd>
                </div>
              ))}
            </dl>

            {/*
             * Every deduction, listed. §33 asks that a user can understand why the score moved,
             * and a number with no working shown is not an explanation.
             */}
            {health.data.factors.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-1">
                {health.data.factors.map((factor) => (
                  <li
                    key={`${factor.category}-${factor.label}`}
                    className="flex items-baseline justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {factor.label} — {factor.detail}
                    </span>
                    <span className="shrink-0 tabular-nums text-destructive">
                      −{factor.penalty}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
