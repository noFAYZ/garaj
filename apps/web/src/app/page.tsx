'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Dashboard, Vehicle } from '@vehicle-os/contracts';
import { dashboardQuery, garagesQuery, vehiclesQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';
import { AddVehicleButton } from '@/components/add-vehicle-button';
import { useSession } from '@/lib/auth-client';
import { GarageCard, attentionByGarage } from '@/components/garage-card';
import { Greeting, GreetingSkeleton } from '@/components/greeting';
import { Icon } from '@/components/icons';
import { NewGarageButton } from '@/components/new-garage-dialog';
import { SectionHeading, SectionLink } from '@/components/ui/overview';
import { Button, buttonClass, EmptyState } from '@/components/ui/primitives';
import { CardGridSkeleton, Loading, Skeleton } from '@/components/ui/skeleton';
import { VehicleCard, useSpent } from '@/components/vehicle-card';
import { VEHICLE_GRID } from '@/components/vehicle-grid';
import {
  ENTRY_CARD,
  EntryHead,
  Fact,
  Facts,
  MonthHeading,
  TimelineRow,
  groupByMonth,
  startsDay,
} from '@/components/timeline';
import { cn } from '@/lib/utils';

export default function GaragePage() {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  // Which garage the vehicle grid shows; `null` is all of them.
  const [garageFilter, setGarageFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionPending && !session) router.replace('/sign-in');
  }, [session, sessionPending, router]);

  /*
   * One request for the whole screen (PRD §25). The summary, what needs attention, the
   * activity and the briefing all come from the same garage-wide reads, so the server does
   * them together — five separate endpoints was five times the latency for one answer.
   */
  const dashboard = useQuery({ ...dashboardQuery(api), enabled: Boolean(session) });
  const vehicles = useQuery({ ...vehiclesQuery(api), enabled: Boolean(session) });
  const garages = useQuery({ ...garagesQuery(api), enabled: Boolean(session) });
  // Each card's running spend; before the early returns, as hooks must be.
  const spent = useSpent(vehicles.data?.data ?? []);

  if (sessionPending || !session || dashboard.isPending) return <GarageSkeleton />;

  if (dashboard.isError) {
    return (
      <EmptyState
        title="Could not load your garage"
        description={dashboard.error.message}
        action={
          <Button variant="primary" onClick={() => void dashboard.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const data = dashboard.data;

  if (data.summary.garages === 0) {
    return (
      <EmptyState
        title="Welcome to Garaj"
        description="Start with a garage. It holds your vehicles and the people you share them with."
        action={
          <NewGarageButton className={buttonClass('primary')}>
            <Plus className="size-4" aria-hidden="true" />
            Create your first garage
          </NewGarageButton>
        }
      />
    );
  }

  // ponytail: the first page of vehicles only — bays and the garage filter count what is loaded.
  // Page through `vehicles.list` here if a garage ever outgrows one page.
  const vehicleList = vehicles.data?.data ?? [];
  const garageList = garages.data ?? [];

  const byGarage = new Map<string, Vehicle[]>();
  for (const vehicle of vehicleList) {
    byGarage.set(vehicle.garageId, [...(byGarage.get(vehicle.garageId) ?? []), vehicle]);
  }
  // What each garage's vehicles are waiting on, from the attention list the dashboard already holds.
  const attention = attentionByGarage(data.attention, vehicles.data?.data);
  // A filter left pointing at a garage that has since gone falls back to everything.
  const activeFilter = garageList.some((garage) => garage.id === garageFilter)
    ? garageFilter
    : null;
  const shownVehicles = activeFilter ? (byGarage.get(activeFilter) ?? []) : vehicleList;
  const filterName = garageList.find((garage) => garage.id === activeFilter)?.name;

  return (
    <div className="flex flex-col gap-10">
      <Greeting name={session.user.name} dashboard={data} vehicles={vehicleList} />

      {/*
       * The garages, as a rail rather than a line of text. They are where vehicles and people
       * are grouped, so they get a place on the home screen instead of a link to another one —
       * and the way to add one sits at the end of the row it will join.
       */}
      <section aria-labelledby="home-garages" className="flex flex-col gap-4">
        <SectionHeading
          id="home-garages"
          title="Garages"
          count={garages.isPending ? undefined : garageList.length}
          action={<SectionLink href="/garages">Manage</SectionLink>}
        />
        {/*
         * `scroll-px-4` because snapping ignores padding: without it the first card snapped to
         * the scroller's outer edge, sixteen pixels under the fade, and looked cut off. A scroller
         * clips both ways, so it is padded top and bottom too — room for a card to lift and cast
         * its shadow on hover — and pulled back by the same, so the spacing reads unchanged.
         */}
        <ul className="scroll-fade-x -mx-4 -mb-4 -mt-2 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-6 pt-2 [scrollbar-width:none]">
          {garages.isPending
            ? Array.from({ length: 2 }, (_, index) => (
                <li key={index} className="w-72 shrink-0">
                  <Skeleton className="h-44 rounded-2xl" />
                </li>
              ))
            : garageList.map((garage, index) => (
                <li
                  key={garage.id}
                  className="stagger w-72 shrink-0 animate-rise snap-start"
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
          {/* Room for another: an outline, so it never reads as a garage of its own. */}
          <li className="w-44 shrink-0 snap-start">
            <NewGarageButton className="group flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-[background-color,border-color,color,scale] duration-300 hover:border-border-strong hover:bg-card/50 hover:text-foreground active:scale-[0.99]">
              <span
                aria-hidden="true"
                className="grid size-11 place-items-center rounded-full bg-muted transition-[background-color,color,rotate] duration-300 ease-out group-hover:rotate-90 group-hover:bg-primary group-hover:text-primary-foreground"
              >
                <Icon name="add" size={22} />
              </span>
              <span className="text-sm font-semibold">New garage</span>
            </NewGarageButton>
          </li>
        </ul>
      </section>

      <section aria-labelledby="home-vehicles" className="flex flex-col gap-4">
        <SectionHeading
          id="home-vehicles"
          title="Vehicles"
          count={vehicles.isPending ? undefined : vehicleList.length}
          action={
            vehicleList.length > 0 ? <SectionLink href="/vehicles">See all</SectionLink> : null
          }
        />

        {/* One garage is the common case, and a filter with one option is not a choice. */}
        {garageList.length > 1 && vehicleList.length > 0 ? (
          <div
            role="group"
            aria-label="Show vehicles from"
            className="scroll-fade-x -mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
          >
            <FilterChip
              label="All"
              count={vehicleList.length}
              selected={activeFilter === null}
              onSelect={() => setGarageFilter(null)}
            />
            {garageList.map((garage) => (
              <FilterChip
                key={garage.id}
                label={garage.name}
                count={byGarage.get(garage.id)?.length ?? 0}
                selected={activeFilter === garage.id}
                onSelect={() => setGarageFilter(garage.id)}
              />
            ))}
          </div>
        ) : null}

        {vehicles.isPending ? (
          <Loading label="Loading vehicles">
            <CardGridSkeleton />
          </Loading>
        ) : shownVehicles.length === 0 ? (
          <EmptyState
            title={filterName ? `Nothing in ${filterName} yet` : 'No vehicles yet'}
            description="Add a car, motorcycle, bicycle, boat — anything with a story worth keeping."
            action={
              <AddVehicleButton
                label={filterName ? `Add to ${filterName}` : 'Add your first vehicle'}
                garageId={activeFilter ?? undefined}
              />
            }
          />
        ) : (
          // Two across, not three: at this width a third column squeezed each card's figures
          // until their labels ran into one another.
          <div className={VEHICLE_GRID}>
            {shownVehicles.map((vehicle, index) => (
              <div
                key={vehicle.id}
                className="stagger animate-rise"
                style={{ '--i': index } as CSSProperties}
              >
                <VehicleCard vehicle={vehicle} spent={spent.get(vehicle.id)} />
              </div>
            ))}
          </div>
        )}
      </section>

      {data.recentActivity.length > 0 ? <Activity data={data} /> : null}
    </div>
  );
}

/** Rendered on the client only (the page waits for the session), so the clock is the reader's. */
function FilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-[background-color,color,scale] duration-200 active:scale-95',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-border hover:text-foreground',
      )}
    >
      <span className="max-w-40 truncate">{label}</span>
      <span className="font-mono text-xs tabular-nums opacity-70">{count}</span>
    </button>
  );
}

/**
 * Recent activity as the logbook it is — the vehicle Activity's own parts (`components/timeline`),
 * so an entry looks the same wherever it is read: the month as a chapter, the day on the rail, the
 * entry beside it. On this page every entry can be a different vehicle, so the vehicle leads its
 * second line, and the whole card goes to that vehicle.
 */
function Activity({ data }: { data: Dashboard }) {
  const months = groupByMonth(data.recentActivity);

  return (
    <section aria-labelledby="home-activity" className="flex flex-col gap-4">
      <SectionHeading id="home-activity" title="Recent activity" />

      <div className="flex flex-col gap-6">
        {months.map((group) => (
          <section key={group.key} aria-label={`${group.month} ${group.year}`}>
            {/* Under the site header, the only thing that sticks on this page. */}
            <MonthHeading group={group} className="sticky top-16" />
            <ol className="mt-2">
              {group.items.map((item, index) => (
                <TimelineRow
                  key={item.id}
                  occurredAt={item.occurredAt}
                  firstOfDay={startsDay(group.items, index)}
                  last={index === group.items.length - 1}
                  index={index}
                >
                  <Link href={`/vehicles/${item.vehicleId}`} className={cn('block', ENTRY_CARD)}>
                    <EntryHead
                      eventType={item.eventType}
                      title={item.title}
                      occurredAt={item.occurredAt}
                      cost={item.cost}
                    >
                      <Facts>
                        <Fact icon="car">
                          <span className="font-medium text-foreground">{item.vehicleName}</span>
                        </Fact>
                        <Fact icon="stopwatch">
                          <time dateTime={item.occurredAt} className="font-mono tabular-nums">
                            {TIME_LABEL.format(new Date(item.occurredAt))}
                          </time>
                        </Fact>
                      </Facts>
                    </EntryHead>
                  </Link>
                </TimelineRow>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );
}

const TIME_LABEL = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * The home screen before its data arrives.
 *
 * Everything that reads the same for every garage is drawn for real — the section headings and
 * the buttons. Placeholders stand only where this garage's own data will go.
 */
function GarageSkeleton() {
  return (
    <Loading label="Loading your garage">
      <div className="flex flex-col gap-10">
        <GreetingSkeleton />

        <section aria-label="Garages" className="flex flex-col gap-4">
          <SectionHeading title="Garages" />
          <div className="flex gap-3 overflow-hidden">
            <Skeleton className="h-44 w-72 shrink-0 rounded-2xl" />
            <Skeleton className="h-44 w-72 shrink-0 rounded-2xl" />
          </div>
        </section>

        <section aria-label="Vehicles" className="flex flex-col gap-4">
          <SectionHeading title="Vehicles" />
          <CardGridSkeleton />
        </section>
      </div>
    </Loading>
  );
}
