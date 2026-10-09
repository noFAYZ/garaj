/**
 * Fuel consumption, by the full-to-full method (PRD §18).
 *
 * Pure: the caller does the SQL, this does the arithmetic.
 *
 * A tank is only a known quantity when it is full. Between two full-ups, everything poured
 * in — including the partial fills in between — is exactly what the distance covered
 * consumed, so that pair is one measurable segment. A partial fill on its own says nothing:
 * the level it started and ended at are both unknown.
 */

import {
  convertDistance,
  convertVolume,
  unitFamily,
  type DistanceUnit,
  type QuantityUnit,
} from '@vehicle-os/domain';

export interface FuelFill {
  /** Ordering key. Present on every expense; the odometer is not. */
  readonly occurredAt: Date;
  readonly odometer: number | null;
  readonly odometerUnit: DistanceUnit | null;
  /** `numeric(12,4)` as it comes back from the driver. */
  readonly quantity: string | null;
  readonly quantityUnit: QuantityUnit | null;
  readonly isFullTank: boolean | null;
}

export interface FuelConsumption {
  /** Distance covered across every measurable segment, in the vehicle's unit. */
  readonly distanceCovered: number;
  readonly distanceUnit: DistanceUnit;
  readonly liters: number;
  /** Both quoted, because the pair of units a reader expects follows the vehicle, not the data. */
  readonly litersPer100Km: number;
  readonly milesPerUsGallon: number;
  /** How many full-to-full pairs the average is built on. */
  readonly segments: number;
}

const KM_PER_MILE = 1.609344;
const LITERS_PER_US_GALLON = 3.785411784;

/**
 * Null until there are two full tanks with odometer readings between them — an average over
 * one guess is a guess, and quoting it as a figure invites the owner to act on it.
 */
export function computeFuelConsumption(
  fills: readonly FuelFill[],
  distanceUnit: DistanceUnit,
): FuelConsumption | null {
  const ordered = [...fills].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  let anchor: number | null = null;
  let pending = 0;
  let totalDistance = 0;
  let totalLiters = 0;
  let segments = 0;

  for (const fill of ordered) {
    const liters = litersOf(fill);
    if (liters === null) continue;
    pending += liters;

    if (fill.isFullTank !== true) continue;
    const reading = odometerIn(fill, distanceUnit);
    // A full tank nobody wrote an odometer against still adds its fuel to the running
    // segment; it just cannot close one.
    if (reading === null) continue;

    /*
     * A decrease is a cluster swap or a mis-keyed reading, not a car driven backwards.
     * The segment across it is unmeasurable, so it is dropped and the anchor moves on —
     * counting it would divide a tank of fuel by a negative distance.
     */
    if (anchor !== null && reading > anchor) {
      totalDistance += reading - anchor;
      totalLiters += pending;
      segments += 1;
    }
    anchor = reading;
    pending = 0;
  }

  if (segments === 0 || totalDistance <= 0 || totalLiters <= 0) return null;

  const km = convertDistance(totalDistance, distanceUnit, 'KM');
  return {
    distanceCovered: totalDistance,
    distanceUnit,
    liters: totalLiters,
    litersPer100Km: (totalLiters / km) * 100,
    milesPerUsGallon: km / KM_PER_MILE / (totalLiters / LITERS_PER_US_GALLON),
    segments,
  };
}

function litersOf(fill: FuelFill): number | null {
  if (!fill.quantity || !fill.quantityUnit) return null;
  /*
   * The column holds kilowatt-hours and kilograms too now (GAPS §11). Anything that is not a
   * volume is not part of a full-to-full average, and would otherwise be looked up in the
   * litres table, miss, and poison the total with NaN. `energy.ts` is what measures those.
   */
  if (unitFamily(fill.quantityUnit) !== 'VOLUME') return null;
  const value = Number(fill.quantity);
  if (!Number.isFinite(value) || value <= 0) return null;
  return convertVolume(value, fill.quantityUnit as 'LITER' | 'US_GALLON' | 'IMP_GALLON', 'LITER');
}

function odometerIn(fill: FuelFill, unit: DistanceUnit): number | null {
  if (fill.odometer === null) return null;
  // A reading with no unit is in the vehicle's own — that is what the entry forms record.
  return convertDistance(fill.odometer, fill.odometerUnit ?? unit, unit);
}
