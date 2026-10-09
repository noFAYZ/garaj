'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import type { Dashboard, Garage, Vehicle } from '@vehicle-os/contracts';
import { BrandLogo } from '@/components/brand-logo';
import { Icon } from '@/components/icons';
import { typeIcon } from '@/components/vehicle-hero';
import { humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

/** How many parking bays a card draws. Past that, the last bay counts the rest. */
const BAYS = 4;

const pad = (value: number) => String(value).padStart(2, '0');

type Flag = 'late' | 'soon';

/** What a garage's vehicles are waiting on, from the dashboard's one list of it. */
export interface GarageAttention {
  /** Services past due. */
  late: number;
  /** Services due within the warning window. */
  soon: number;
  /** Papers expired or expiring. */
  papers: number;
  /** The worst flag each vehicle carries, for the light over its bay. */
  vehicles: ReadonlyMap<string, Flag>;
}

/**
 * The dashboard's attention list, sorted into garages through the vehicles it names. `undefined`
 * while either is unknown.
 */
export function attentionByGarage(
  attention: Dashboard['attention'] | undefined,
  vehicles: readonly Vehicle[] | undefined,
): ReadonlyMap<string, GarageAttention> | undefined {
  if (!attention || !vehicles) return undefined;
  const garageOf = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.garageId]));
  const out = new Map<string, GarageAttention & { vehicles: Map<string, Flag> }>();
  const note = (vehicleId: string, flag: Flag, count: 'late' | 'soon' | 'papers') => {
    const garageId = garageOf.get(vehicleId);
    if (!garageId) return;
    const entry = out.get(garageId) ?? { late: 0, soon: 0, papers: 0, vehicles: new Map() };
    entry[count] += 1;
    if (entry.vehicles.get(vehicleId) !== 'late') entry.vehicles.set(vehicleId, flag);
    out.set(garageId, entry);
  };
  for (const item of attention.maintenance) {
    if (item.plan.status === 'OVERDUE') note(item.vehicleId, 'late', 'late');
    else if (item.plan.status === 'DUE_SOON') note(item.vehicleId, 'soon', 'soon');
  }
  for (const item of attention.documents) {
    note(item.vehicleId, item.daysRemaining < 0 ? 'late' : 'soon', 'papers');
  }
  return out;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * A garage, drawn as its floor: a row of numbered bays with painted lines between them and its
 * vehicles parked in them — the photo where there is one, standing on the floor when it is a
 * cutout, else the make's badge, else the kind of vehicle. Empty bays keep their number, so a
 * garage of one reads as a garage with room, not a card that failed to load.
 *
 * Under it, the name and its line. Whether anything in here needs you is said on the floor itself:
 * a light over the bay of each vehicle with a service overdue or due soon, or papers running out —
 * red, then amber — and those vehicles park first. The counts are in the link's name for a screen
 * reader. A garage with nothing due shows no light at all.
 *
 * `vehicles` is whatever part of the list is loaded; the count comes from the garage itself, so a
 * partial list still gets the overflow right.
 */
export function GarageCard({
  garage,
  vehicles = [],
  attention,
  className,
}: {
  garage: Garage;
  vehicles?: readonly Vehicle[];
  /** `null` when known to be clear; `undefined` while unknown. */
  attention?: GarageAttention | null;
  className?: string;
}) {
  const count = garage.vehicleCount;
  const overflows = count > BAYS;
  // The vehicles that need something park first: the floor is read left to right.
  const parked = [...vehicles]
    .sort((a, b) => rank(attention?.vehicles.get(a.id)) - rank(attention?.vehicles.get(b.id)))
    .slice(0, overflows ? BAYS - 1 : BAYS);
  const shared = garage.role !== 'OWNER';

  const summary = [
    garage.name,
    plural(count, 'vehicle'),
    shared ? `shared with you as ${humanise(garage.role).toLowerCase()}` : null,
    attention?.late ? `${attention.late} overdue` : null,
    attention?.soon ? `${attention.soon} due soon` : null,
    attention?.papers ? plural(attention.papers, 'paper') + ' running out' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Link
      href={`/garages/${garage.id}`}
      aria-label={summary}
      className={cn(
        'group flex flex-col gap-3.5 rounded-2xl bg-card/50 p-2.5 pb-4 transition-[background-color,translate,scale,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:bg-card hover:shadow-float active:scale-[0.99]',
        className,
      )}
    >
      {/* The floor. */}
      <div
        aria-hidden="true"
        className="relative grid grid-cols-4 overflow-hidden rounded-xl bg-muted/60 px-1 pt-1.5 transition-colors duration-300 group-hover:bg-muted"
      >
        {Array.from({ length: BAYS }, (_, bay) => {
          const vehicle = parked[bay];
          const isOverflow = overflows && bay === BAYS - 1;
          const flag = vehicle ? attention?.vehicles.get(vehicle.id) : undefined;
          return (
            <div
              key={bay}
              className="relative flex aspect-[4/5] flex-col items-center justify-end px-1 pb-1"
              style={{ '--bay': bay } as CSSProperties}
            >
              {/* The painted line between this bay and the last. */}
              {bay > 0 ? (
                <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[repeating-linear-gradient(to_bottom,var(--color-border-strong)_0_5px,transparent_5px_9px)]" />
              ) : null}
              <span className="flex min-h-0 w-full flex-1 items-end justify-center transition-transform duration-300 ease-out [transition-delay:calc(var(--bay)*40ms)] group-hover:-translate-y-0.5">
                {isOverflow ? (
                  <span className="mb-2 font-mono text-sm font-semibold tabular-nums text-foreground">
                    +{count - (BAYS - 1)}
                  </span>
                ) : vehicle ? (
                  <Parked vehicle={vehicle} />
                ) : null}
              </span>
              {/* The bay's number, painted on the floor. */}
              <span
                className={cn(
                  'mt-0.5 font-mono text-[0.5625rem] font-semibold tabular-nums tracking-wider',
                  vehicle || isOverflow ? 'text-muted-foreground' : 'text-muted-foreground/50',
                )}
              >
                {pad(bay + 1)}
              </span>
              {flag ? (
                <span
                  className={cn(
                    'absolute right-1.5 top-1 size-2 rounded-full ring-2 ring-muted',
                    flag === 'late' ? 'bg-destructive' : 'bg-warning',
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-start gap-3 px-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold tracking-tight text-foreground">
            {garage.name}
          </h3>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono font-semibold tabular-nums text-foreground">
              {pad(count)}
            </span>
            <span className="shrink-0">{count === 1 ? 'vehicle' : 'vehicles'}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{garage.description ?? garage.defaultCurrency}</span>
            {/* Only when it is not yours: every garage you made says Owner, which is noise. */}
            {shared ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{humanise(garage.role)}</span>
              </>
            ) : null}
          </p>
        </div>
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-[background-color,color,rotate] duration-300 group-hover:-rotate-45 group-hover:bg-primary group-hover:text-primary-foreground"
        >
          <ArrowRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}

const rank = (flag: Flag | undefined) => (flag === 'late' ? 0 : flag === 'soon' ? 1 : 2);

/**
 * A vehicle in its bay. A cutout stands on the floor with a shadow under it; a full photo fills
 * the bay as a picture; without one, the make's badge, then the kind of vehicle.
 */
function Parked({ vehicle }: { vehicle: Vehicle }) {
  const photo = vehicle.primaryPhoto;
  if (photo?.thumbnailUrl && photo.isCutout) {
    return (
      <span className="relative flex size-full items-end justify-center">
        <span className="absolute bottom-0.5 left-1/2 h-1.5 w-4/5 -translate-x-1/2 rounded-[100%] bg-foreground opacity-20 blur-[3px]" />
        <img
          src={photo.thumbnailUrl}
          alt=""
          loading="lazy"
          className="relative max-h-full w-full object-contain object-bottom"
        />
      </span>
    );
  }
  if (photo?.thumbnailUrl) {
    return (
      <img
        src={photo.thumbnailUrl}
        alt=""
        loading="lazy"
        className="size-full rounded-lg object-cover"
      />
    );
  }
  return (
    <span className="mb-1 grid size-10 place-items-center overflow-hidden rounded-xl bg-card text-muted-foreground">
      {vehicle.make ? (
        <BrandLogo
          make={vehicle.make}
          size={40}
          fill
          className="rounded-xl text-base text-foreground"
        />
      ) : (
        <Icon name={typeIcon(vehicle.vehicleType)} size={20} />
      )}
    </span>
  );
}
