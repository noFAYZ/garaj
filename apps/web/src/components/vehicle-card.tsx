'use client';

import { useQueries } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { Vehicle } from '@vehicle-os/contracts';
import { costQuery } from '@vehicle-os/api-client/react';
import { paintSwatch } from '@vehicle-os/ui';
import { api } from '@/lib/api';
import { BrandLogo } from '@/components/brand-logo';
import { Icon } from '@/components/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { typeIcon } from '@/components/vehicle-hero';
import { formatMoneyWhole, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';

type Money = { amountMinor: number; currency: string };

/**
 * What each vehicle has cost to run: everything spent on it except buying it, lifetime, in its own
 * currency — the cost summary's ownership cost less its purchase price. One summary per vehicle,
 * asked for together and cached, so the page and the vehicle's own Statistics share them.
 *
 * ponytail: one request per card. Plans cap a garage at a handful of vehicles; a `spent` on the
 * vehicles list itself would make it one, at the price of the summary's currency rules there too.
 *
 * `undefined` while it loads, `null` when it could not be had.
 */
export function useSpent(
  vehicles: readonly Vehicle[],
): ReadonlyMap<string, Money | null | undefined> {
  const results = useQueries({
    queries: vehicles.map((vehicle) => costQuery(api, vehicle.id)),
  });
  return new Map(
    vehicles.map((vehicle, index) => {
      const result = results[index];
      if (!result || result.isPending) return [vehicle.id, undefined];
      const cost = result.data;
      if (!cost) return [vehicle.id, null];
      return [
        vehicle.id,
        {
          amountMinor: cost.ownershipCost.amountMinor - (cost.purchasePrice?.amountMinor ?? 0),
          currency: cost.currency,
        },
      ];
    }),
  );
}

/**
 * The garage grid's unit (PRD §27): the vehicle, who it is, and its two running figures.
 *
 * A whole-card link rather than a link inside a card — the entire tile is the target, so the hit
 * area matches what it looks like, and keyboard focus lands on one thing instead of three nested.
 *
 * The picture sits on a stage inset in the card, the way the hero sets its screen. Nothing is
 * printed over a photograph: text on an image needs a scrim, and the scrim darkens the car it
 * covers. A cutout stands on the stage's floor with a shadow under it; with no photo at all the
 * make's badge takes the stage, so a new vehicle reads as itself rather than a grey box.
 *
 * Under it the name, given two lines — "2022 Ducati Monster" cut to "2022 Duc…" said nothing —
 * then what tells this one apart, then the figures. The year is in the name already, so the
 * figures are the two that grow: how far it has gone, and what it has cost to run (`useSpent`).
 */
export function VehicleCard({
  vehicle,
  spent,
}: {
  vehicle: Vehicle;
  /** Running spend: `undefined` while it loads, `null` when it could not be had. */
  spent?: Money | null;
}) {
  const inactive = vehicle.status !== 'ACTIVE';
  const icon = typeIcon(vehicle.vehicleType);
  const photo = vehicle.primaryPhoto?.thumbnailUrl ? vehicle.primaryPhoto : null;
  const swatch = paintSwatch(vehicle.color);
  const unit = vehicle.odometerUnit === 'MI' ? 'mi' : 'km';
  const kind = [humanise(vehicle.vehicleType), vehicle.variant].filter(Boolean).join(' · ');

  return (
    <Link
      href={`/vehicles/${vehicle.id}`}
      // Lifts toward the pointer and gives under a press. Tailwind v4 only applies `hover:` on
      // devices that can hover, so a tap on a phone never leaves a card stuck raised.
      className="group flex h-full flex-col gap-3 rounded-2xl bg-card/50 p-2 pb-2.5 transition-[background-color,translate,scale,box-shadow] duration-300 ease-out hover:-translate-y-1 hover:bg-card hover:shadow-float active:scale-[0.99]"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted">
        {photo ? (
          photo.isCutout ? (
            <>
              <span
                aria-hidden="true"
                className="absolute bottom-[10%] left-1/2 h-3 w-3/5 -translate-x-1/2 rounded-[100%] bg-foreground opacity-15 blur-md"
              />
              {/*
               * A plain <img>: the src is a short-lived signed URL whose host and query change
               * per request, which defeats next/image's caching and its optimiser entirely.
               */}
              <img
                src={photo.thumbnailUrl!}
                alt=""
                loading="lazy"
                className="absolute inset-0 m-auto max-h-[86%] max-w-[90%] object-contain transition-transform duration-500 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.03]"
              />
            </>
          ) : (
            <img
              src={photo.thumbnailUrl!}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            />
          )
        ) : vehicle.make ? (
          <span className="grid size-full place-items-center">
            <span className="size-14 overflow-hidden rounded-2xl bg-card shadow-float transition-transform duration-500 ease-out group-hover:scale-105">
              <BrandLogo
                make={vehicle.make}
                size={56}
                fill
                className="rounded-2xl text-xl text-foreground"
              />
            </span>
          </span>
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground/40">
            <Icon name={icon} size={44} />
          </span>
        )}

        {/*
         * The one thing that does sit on the picture, because it qualifies the whole card — the
         * figures below are about the vehicle, not about its being here.
         */}
        {inactive ? (
          <span className="absolute left-2 top-2 rounded-full bg-background/80 px-2.5 py-1 text-label uppercase text-muted-foreground backdrop-blur">
            {humanise(vehicle.status)}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 items-start gap-2 px-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug tracking-tight text-foreground">
            {vehicle.displayName}
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {/* The badge is on the stage when there is no photo; beside the kind when there is. */}
            {photo && vehicle.make ? (
              <BrandLogo make={vehicle.make} size={14} className="shrink-0 text-[0.625rem]" />
            ) : null}
            <span className="truncate">{kind}</span>
            {vehicle.color ? (
              <>
                <span aria-hidden="true">·</span>
                {swatch ? (
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/15"
                    style={{ background: swatch }}
                  />
                ) : null}
                <span className="truncate">{vehicle.color}</span>
              </>
            ) : null}
          </p>
        </div>
        {/* Says the whole card is the way in; turns toward where it goes under the pointer. */}
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-[background-color,color,rotate] duration-300 group-hover:-rotate-45 group-hover:bg-primary group-hover:text-primary-foreground"
        >
          <ArrowRight className="size-3.5" />
        </span>
      </div>

      {/*
       * Two figures in a small panel, pushed to the bottom by `mt-auto` so a card whose name takes
       * two lines still lines its figures up with its neighbours. The odometer is always the first
       * cell, so a row of cards reads across.
       */}
      <dl className="mx-1.5 mt-auto grid grid-cols-2 divide-x divide-border rounded-xl bg-muted/60">
        <Figure
          label="Odometer"
          value={vehicle.currentOdometer !== null ? vehicle.currentOdometer.toLocaleString() : null}
          unit={unit}
        />
        <Figure
          label="Spent"
          value={spent === undefined ? undefined : spent && formatMoneyWhole(spent)}
        />
      </dl>
    </Link>
  );
}

function Figure({
  label,
  value,
  unit,
}: {
  label: string;
  /** `undefined` while it loads; `null` for nothing to show. */
  value: string | null | undefined;
  unit?: string;
}) {
  return (
    <div className="min-w-0 px-3 py-2">
      <dt className="truncate text-label uppercase text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 flex min-w-0 items-baseline gap-1 font-mono text-sm font-semibold tabular-nums',
          value === null ? 'text-muted-foreground/60' : 'text-foreground',
        )}
      >
        {value === undefined ? (
          <Skeleton className="my-0.5 h-4 w-14 max-w-full" />
        ) : (
          <span className="truncate">{value ?? '—'}</span>
        )}
        {value && unit ? (
          <span className="shrink-0 text-[0.6875rem] font-medium text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
