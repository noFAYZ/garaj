/**
 * Trips for a mileage log (GAPS §6).
 *
 * For contractors and rideshare drivers the log *is* the reason to keep records, so the rules
 * here are the ones a tax office would apply to the row:
 *
 *  - **The distance comes from the odometer when it can.** A start reading plus the event's
 *    own (end) reading is evidence; a typed distance is a claim. Both are accepted, and when
 *    both are given they have to agree.
 *  - **The rate is stored on the trip.** Mileage rates are set per jurisdiction and change
 *    every year; a total recomputed from today's rate would silently rewrite every past claim
 *    the day the rate moves.
 */

import { assertCurrency, MoneyError, type TripPurpose } from '@vehicle-os/domain';

export interface TripInput {
  readonly purpose: TripPurpose;
  readonly startOdometer?: number | null;
  readonly distance?: number | null;
  /** Minor units per one unit of distance, in the event's odometer unit. */
  readonly rateMinor?: number | null;
  readonly rateCurrency?: string | null;
}

export interface ResolvedTrip {
  readonly tripPurpose: TripPurpose;
  readonly tripStartOdometer: number | null;
  readonly tripDistance: number;
  readonly mileageRateMinor: number | null;
  readonly mileageRateCurrency: string | null;
}

/**
 * The trip as it will be stored, or field errors keyed the way the form names them.
 *
 * `endOdometer` is the event's own reading — a trip ends where the log says the car is now,
 * which is also what moves the vehicle's odometer forward.
 */
export function resolveTrip(
  trip: TripInput,
  endOdometer: number | null | undefined,
): { trip: ResolvedTrip } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const start = trip.startOdometer ?? null;
  const typed = trip.distance ?? null;
  let measured: number | null = null;

  if (start !== null) {
    if (endOdometer === null || endOdometer === undefined) {
      errors['trip.startOdometer'] = 'A start reading needs the end reading in the odometer field.';
    } else if (endOdometer < start) {
      errors['trip.startOdometer'] = 'The start reading is higher than the end reading.';
    } else {
      measured = endOdometer - start;
    }
  }

  if (measured !== null && typed !== null && measured !== typed) {
    errors['trip.distance'] =
      `The readings say ${measured}, not ${typed}. Leave the distance empty to use the readings.`;
  }

  const distance = measured ?? typed;
  if (distance === null) {
    errors['trip.distance'] ??= 'A trip needs a distance, or start and end readings.';
  } else if (distance <= 0) {
    errors['trip.distance'] ??= 'A trip needs a distance above zero.';
  }

  const rate = trip.rateMinor ?? null;
  const currency = trip.rateCurrency ?? null;
  if (rate !== null && currency === null) errors['trip.rateCurrency'] = 'A rate needs a currency.';
  if (currency !== null) {
    try {
      assertCurrency(currency);
    } catch (error) {
      if (error instanceof MoneyError) errors['trip.rateCurrency'] = error.message;
      else throw error;
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    trip: {
      tripPurpose: trip.purpose,
      tripStartOdometer: start,
      tripDistance: distance!,
      mileageRateMinor: rate,
      mileageRateCurrency: rate === null ? null : currency,
    },
  };
}

/** What a trip is worth at the rate stored on it. Rounded once, per trip, as a claim form does. */
export function tripDeductionMinor(distance: number, rateMinor: number | null): number | null {
  return rateMinor === null ? null : Math.round(distance * rateMinor);
}
