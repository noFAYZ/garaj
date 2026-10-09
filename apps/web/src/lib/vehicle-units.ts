'use client';

import { useQuery } from '@tanstack/react-query';
import type { DistanceUnit } from '@vehicle-os/domain';
import { garagesQuery, vehicleQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';

/**
 * The units a vehicle is recorded in.
 *
 * Entry forms were hard-coding `'USD'` and `'KM'`, which stamped dollars on every record in
 * a euro garage and kilometres on a vehicle read in miles. Neither looks wrong on screen —
 * the number still reads like money, and 36,000 still reads like an odometer — so nothing
 * ever surfaced it. Both are properties of the vehicle, and this is where they come from.
 *
 * The currency follows the same precedence the server uses in `primaryCurrency` (§27): the
 * price it was bought at first, because that is almost always the largest single sum and
 * what every other figure is compared against; then the garage's own default, which is what
 * the next expense will most likely be entered in. `'USD'` is the last resort, not the
 * default.
 */
export function useVehicleUnits(vehicleId: string): {
  currency: string;
  odometerUnit: DistanceUnit;
} {
  const vehicle = useQuery(vehicleQuery(api, vehicleId));
  // Both are already cached by the pages these forms sit on, so in practice this costs no
  // extra request — and a user's garages are a handful of rows when it does.
  const garages = useQuery(garagesQuery(api));

  const garage = garages.data?.find((candidate) => candidate.id === vehicle.data?.garageId);

  return {
    currency: vehicle.data?.purchasePrice?.currency ?? garage?.defaultCurrency ?? 'USD',
    odometerUnit: vehicle.data?.odometerUnit ?? 'KM',
  };
}
