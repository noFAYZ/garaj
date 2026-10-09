'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unstable_ViewTransition as ViewTransition, useState, type CSSProperties } from 'react';
import type { VehicleStatus } from '@vehicle-os/domain';
import { garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { AddVehicleButton } from '@/components/add-vehicle-button';
import { Icon } from '@/components/icons';
import { VehicleFiltersDialog } from '@/components/vehicle-filters-dialog';
import { buttonClass, EmptyState, StatusRegion } from '@/components/ui/primitives';
import { CardGridSkeleton, Loading } from '@/components/ui/skeleton';
import { VehicleCard, useSpent } from '@/components/vehicle-card';
import { VEHICLE_GRID } from '@/components/vehicle-grid';
import { vehicleTransitionName } from '@/components/vehicle-hero';

export default function VehiclesPage() {
  const [garageId, setGarageId] = useState<string | null>(null);
  const [status, setStatus] = useState<VehicleStatus | null>(null);

  const garages = useQuery(garagesQuery(api));
  const filters = {
    ...(garageId ? { garageId } : {}),
    ...(status ? { status } : {}),
  };
  // The grid stays put while a narrower one loads: pressing a filter chip should change the
  // list, not empty the page and refill it.
  const vehicles = useQuery({ ...vehiclesQuery(api, filters), placeholderData: keepPreviousData });

  const list = vehicles.data?.data ?? [];
  const spent = useSpent(list);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = (garageId ? 1 : 0) + (status ? 1 : 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Vehicles</h1>

        {/*
         * One control, two actions: the thing you came to do, and the thing that changes what
         * you are looking at. Joined rather than spaced, because separated they read as two
         * unrelated buttons competing for the same corner.
         */}
        <div className="flex items-stretch">
          <AddVehicleButton className="rounded-r-none" />
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={
              activeFilters === 0
                ? 'Filter vehicles'
                : `Filter vehicles, ${activeFilters} filter${activeFilters === 1 ? '' : 's'} active`
            }
            className={buttonClass('primary', 'md', 'gap-1.5 rounded-l-none pl-2.5 pr-3')}
          >
            {/* A hairline in the foreground colour, so the seam reads on the accent. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-2 left-0 w-px bg-primary-foreground/25"
            />
            <Icon name="filter" size={16} />
            {activeFilters > 0 ? (
              <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs font-semibold tabular-nums">
                {activeFilters}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {vehicles.isPending ? (
        <Loading label="Loading vehicles">
          <CardGridSkeleton />
        </Loading>
      ) : list.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Try widening the garage or status filter."
        />
      ) : (
        <>
          {/*
           * The count is gone from the page but not from the announcement. A filter that
           * changes the grid tells a screen reader user how many results it left; without it
           * they get silence and a changed page.
           */}
          <StatusRegion className="sr-only">
            {list.length} {list.length === 1 ? 'vehicle' : 'vehicles'}
          </StatusRegion>

          <div className={VEHICLE_GRID}>
            {list.map((vehicle, index) => (
              <ViewTransition key={vehicle.id} name={vehicleTransitionName(vehicle.id)}>
                <div className="stagger animate-rise" style={{ '--i': index } as CSSProperties}>
                  <VehicleCard vehicle={vehicle} spent={spent.get(vehicle.id)} />
                </div>
              </ViewTransition>
            ))}
          </div>
        </>
      )}
      <VehicleFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        garages={garages.data ?? []}
        garageId={garageId}
        status={status}
        onGarageChange={setGarageId}
        onStatusChange={setStatus}
      />
    </div>
  );
}
