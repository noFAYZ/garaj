/**
 * What a vehicle has cost as it happened, rather than as one total (GAPS §13).
 *
 * `cost.ts` answers "what has this cost" with a figure. These answer the same question with a
 * shape — which is what tells you whether the figure is normal. A year of £40 months and one
 * £900 month average to the same number, and only one of them is a gearbox.
 *
 * Pure: the caller does the SQL, this does the arithmetic. Every function here takes rows
 * already filtered to one currency, because a curve that adds euros to dollars is a chart of
 * exchange rates (the same rule `cost.ts` and `fuel-price.ts` follow).
 */

import { convertDistance, type DistanceUnit } from '@vehicle-os/domain';

/** A month's spend and the running total behind it. `month` is `YYYY-MM`. */
export interface CumulativePoint {
  readonly month: string;
  readonly spentMinor: number;
  readonly cumulativeMinor: number;
}

export interface MonthTotal {
  readonly month: string;
  readonly amountMinor: number;
}

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

function nextMonth(key: string): string {
  const [year, month] = key.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * The ownership curve: every month from the first record to now, with its running total.
 *
 * Empty months are drawn rather than skipped. A curve of only the months that had spending
 * puts January beside July and reports a quiet summer as a busy one — the same reason the
 * spend chart draws its zeros.
 *
 * The purchase starts the curve rather than sitting in a month of its own, because what the
 * line is for is "what has this vehicle cost me by now", and on the day you bought it the
 * answer was the price.
 */
export function ownershipCurve(
  months: readonly MonthTotal[],
  purchase: { amountMinor: number; occurredAt: Date } | null,
  now: Date,
): CumulativePoint[] {
  const byMonth = new Map(months.map((month) => [month.month, month.amountMinor]));
  if (purchase) {
    const key = monthKey(purchase.occurredAt);
    byMonth.set(key, (byMonth.get(key) ?? 0) + purchase.amountMinor);
  }
  if (byMonth.size === 0) return [];

  const keys = [...byMonth.keys()].sort();
  const last = monthKey(now);
  const points: CumulativePoint[] = [];
  let cumulative = 0;

  for (let key = keys[0]!; key <= last; key = nextMonth(key)) {
    const spentMinor = byMonth.get(key) ?? 0;
    cumulative += spentMinor;
    points.push({ month: key, spentMinor, cumulativeMinor: cumulative });
    // A record dated in the future — a prepaid insurance year — would otherwise run the loop
    // to it one month at a time and then stop; the guard keeps the curve to what has happened.
    if (points.length > 600) break;
  }

  return points;
}

export interface Reading {
  readonly occurredAt: Date;
  readonly odometer: number;
  readonly odometerUnit: DistanceUnit | null;
}

export interface YearDistance {
  readonly year: number;
  readonly distance: number;
  readonly distanceUnit: DistanceUnit;
}

/**
 * Distance covered per calendar year, from the readings on record.
 *
 * Attributed to the year the distance was *driven in*, which is not the year of the reading
 * that closed it: a reading in March measures the drive since the last one, which may have
 * been in December. A straight-line split across the days of the gap is the honest
 * approximation — the readings do not say which week the driving happened in, and pretending
 * otherwise by dumping it all into the closing year makes every January look like a road trip.
 *
 * A reading that goes backwards ends the run: a cluster swap or a corrected entry is not a
 * year of negative driving.
 */
export function distancePerYear(
  readings: readonly Reading[],
  distanceUnit: DistanceUnit,
): YearDistance[] {
  const ordered = [...readings]
    .filter((reading) => Number.isFinite(reading.odometer))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const years = new Map<number, number>();
  let previous: { at: number; reading: number } | null = null;

  for (const entry of ordered) {
    const reading = convertDistance(
      entry.odometer,
      entry.odometerUnit ?? distanceUnit,
      distanceUnit,
    );
    const at = entry.occurredAt.getTime();

    if (previous && reading > previous.reading && at > previous.at) {
      spread(years, previous.at, at, reading - previous.reading);
    }
    previous = { at, reading };
  }

  return [...years.entries()]
    .map(([year, distance]) => ({ year, distance: Math.round(distance), distanceUnit }))
    .filter((entry) => entry.distance > 0)
    .sort((a, b) => a.year - b.year);
}

/** Share a gap's distance across the calendar years it spans, by the days in each. */
function spread(years: Map<number, number>, from: number, to: number, distance: number): void {
  const span = to - from;
  let cursor = from;

  while (cursor < to) {
    const year = new Date(cursor).getUTCFullYear();
    const yearEnd = Date.UTC(year + 1, 0, 1);
    const slice = Math.min(yearEnd, to) - cursor;
    years.set(year, (years.get(year) ?? 0) + (distance * slice) / span);
    cursor = Math.min(yearEnd, to);
  }
}
