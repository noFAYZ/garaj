import { useQuery } from '@tanstack/react-query';
import type { Garage, Vehicle } from '@vehicle-os/contracts';
import type { DistanceUnit } from '@vehicle-os/domain';
import { garagesQuery } from '@vehicle-os/api-client/react';
import { api } from '@/lib/api';

/** The signed-in person's profile. One key for every screen, so a change on You shows everywhere. */
export const profileQuery = { queryKey: ['me'], queryFn: () => api.users.me() } as const;

export function useProfile() {
  return useQuery(profileQuery);
}

/**
 * The units a new record on this vehicle is entered in.
 *
 * Currency: the person's own default first — they chose it on You, and every amount they type
 * should be in it. Then the vehicle's purchase currency and its garage's default, for the moment
 * before the profile has loaded; `'USD'` is the last resort. Amounts already recorded keep the
 * currency they were entered in: there is no exchange rate to convert them honestly.
 *
 * Distance: always the vehicle's own unit. An odometer reading in the wrong unit is wrong at the one
 * moment it cannot be recovered, whatever the person prefers elsewhere.
 */
export function useUnitsFor(vehicle: Vehicle | null | undefined): {
  currency: string;
  odometerUnit: DistanceUnit;
} {
  const profile = useProfile();
  // Already cached by every screen that lists garages; a handful of rows when it is not.
  const garages = useQuery(garagesQuery(api));
  const garage = garages.data?.find((candidate: Garage) => candidate.id === vehicle?.garageId);

  return {
    currency:
      profile.data?.defaultCurrency ??
      vehicle?.purchasePrice?.currency ??
      garage?.defaultCurrency ??
      'USD',
    odometerUnit: vehicle?.odometerUnit ?? profile.data?.distanceUnit ?? 'KM',
  };
}
