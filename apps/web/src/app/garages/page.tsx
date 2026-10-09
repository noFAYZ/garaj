'use client';

import { useQuery } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import type { Vehicle } from '@vehicle-os/contracts';
import { dashboardQuery, garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { GarageCard, attentionByGarage } from '@/components/garage-card';
import { Plus } from 'lucide-react';
import { NewGarageButton } from '@/components/new-garage-dialog';
import { buttonClass, EmptyState } from '@/components/ui/primitives';
import { Loading, Skeleton } from '@/components/ui/skeleton';

export default function GaragesPage() {
  const garages = useQuery(garagesQuery(api));
  // Only for the bays on each card; the counts come from the garages themselves.
  const vehicles = useQuery(vehiclesQuery(api));
  // What each garage needs: the home screen's own read, so arriving from there costs nothing.
  const dashboard = useQuery(dashboardQuery(api));

  if (garages.isError) {
    return <EmptyState title="Could not load your garages" description={garages.error.message} />;
  }

  const list = garages.data ?? [];
  const byGarage = new Map<string, Vehicle[]>();
  for (const vehicle of vehicles.data?.data ?? []) {
    byGarage.set(vehicle.garageId, [...(byGarage.get(vehicle.garageId) ?? []), vehicle]);
  }
  const attention = attentionByGarage(dashboard.data?.attention, vehicles.data?.data);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Garages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group vehicles, and choose who else can see and change them.
          </p>
        </div>

        <NewGarageButton className={buttonClass('primary')}>
          <Plus className="size-4" aria-hidden="true" />
          New garage
        </NewGarageButton>
      </div>

      {garages.isPending ? (
        <Loading label="Loading garages">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        </Loading>
      ) : list.length === 0 ? (
        <EmptyState
          title="No garages yet"
          description="Create one to start adding vehicles."
          action={
            <NewGarageButton className={buttonClass('primary')}>Create a garage</NewGarageButton>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((garage, index) => (
            <li
              key={garage.id}
              className="stagger animate-rise"
              style={{ '--i': index } as CSSProperties}
            >
              <GarageCard
                garage={garage}
                vehicles={byGarage.get(garage.id)}
                attention={attention ? (attention.get(garage.id) ?? null) : undefined}
                className="h-full"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
