/**
 * Consumption for anything that is not a tank of petrol (GAPS §11, §19).
 *
 * `fuel.ts` answers "how much fuel per distance" by the full-to-full method, which works
 * because a tank is a known quantity exactly when it is full. A battery is not: nobody
 * charges to 100% every time, chargers report what they delivered rather than what the pack
 * holds, and a plug-in hybrid burns two different things on the same journey.
 *
 * So this measures the other way round — not *fuel per known distance between full tanks*,
 * but *everything put in over the distance it was put in across*. Between the first and last
 * reading of a run, every kWh recorded went into covering that distance. It is a weaker
 * measurement and it is named as one: `basis: 'SPAN'` rather than `'FULL_TO_FULL'`, so a
 * client can say which method produced the number instead of implying they are the same.
 *
 * Grouped by fuel type, which is what makes a hybrid work at all. Petrol segments and
 * electric segments are two measurements of one car, and averaging them together produces a
 * figure in no unit — 6 of what, per 100 km?
 */

import {
  convertDistance,
  convertQuantity,
  unitFamily,
  type DistanceUnit,
  type FuelType,
  type QuantityUnit,
  type UnitFamily,
} from '@vehicle-os/domain';

export interface EnergyFill {
  readonly occurredAt: Date;
  readonly odometer: number | null;
  readonly odometerUnit: DistanceUnit | null;
  /** `numeric(12,4)` as the driver returns it. */
  readonly quantity: string | null;
  readonly quantityUnit: QuantityUnit | null;
  readonly fuelType: FuelType | null;
  readonly isFullTank: boolean | null;
}

/** How a figure was arrived at, so a reader can weigh it. */
export type ConsumptionBasis = 'FULL_TO_FULL' | 'SPAN';

export interface FuelUsage {
  /** Null when the fills never said — an old row, or a plain "Fuel" expense. */
  readonly fuelType: FuelType | null;
  readonly family: UnitFamily;
  /** The unit the total is in: LITER, KWH or KG. */
  readonly unit: QuantityUnit;
  readonly quantity: number;
  readonly distanceCovered: number;
  readonly distanceUnit: DistanceUnit;
  /** Units of this fuel per 100 km — litres, kilowatt-hours or kilograms. */
  readonly per100Km: number;
  /** Distance per unit, which is how an EV is read: mi/kWh, km/kWh, mpg. */
  readonly distancePerUnit: number;
  readonly basis: ConsumptionBasis;
  /** Fills the figure is built on. One is an anecdote; the client can say so. */
  readonly fills: number;
}

/** The canonical unit each family reports in, so two vehicles can be compared. */
const CANONICAL: Readonly<Record<UnitFamily, QuantityUnit>> = {
  VOLUME: 'LITER',
  ENERGY: 'KWH',
  MASS: 'KG',
};

/**
 * One usage figure per fuel type the vehicle actually took.
 *
 * Fuels are kept apart by *type*, not by unit family: petrol and diesel are both litres, and
 * a car that has taken both has had its engine swapped or its log mis-entered. Either way
 * they are not one average.
 *
 * Distance comes from the span of odometer readings within each group. A group whose fills
 * never carried a reading cannot be measured against distance at all, and is left out rather
 * than divided by a guess.
 */
export function computeUsage(
  fills: readonly EnergyFill[],
  distanceUnit: DistanceUnit,
): FuelUsage[] {
  const groups = new Map<string, EnergyFill[]>();
  for (const fill of fills) {
    if (!fill.quantityUnit || !fill.quantity) continue;
    const key = fill.fuelType ?? '';
    groups.set(key, [...(groups.get(key) ?? []), fill]);
  }

  const usages: FuelUsage[] = [];
  for (const [key, group] of groups) {
    const usage = usageFor(key === '' ? null : (key as FuelType), group, distanceUnit);
    if (usage) usages.push(usage);
  }

  // Most-used first: on a plug-in hybrid the fuel it mostly runs on is the headline, and
  // that is a fact about the record rather than a preference about powertrains.
  return usages.sort((a, b) => b.distanceCovered - a.distanceCovered);
}

function usageFor(
  fuelType: FuelType | null,
  group: readonly EnergyFill[],
  distanceUnit: DistanceUnit,
): FuelUsage | null {
  const ordered = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const family = unitFamily(ordered[0]!.quantityUnit!);
  const unit = CANONICAL[family];

  let quantity = 0;
  let lowest: number | null = null;
  let highest: number | null = null;
  let counted = 0;

  for (const fill of ordered) {
    // A group is one fuel type but not necessarily one family: a mis-entered row can put a
    // litre against a charge. Skipping it keeps the total in one unit rather than throwing
    // out the vehicle's whole reading because of one bad row.
    if (!fill.quantityUnit || unitFamily(fill.quantityUnit) !== family) continue;
    const value = Number(fill.quantity);
    if (!Number.isFinite(value) || value <= 0) continue;

    quantity += convertQuantity(value, fill.quantityUnit, unit);
    counted += 1;

    if (fill.odometer === null) continue;
    const reading = convertDistance(fill.odometer, fill.odometerUnit ?? distanceUnit, distanceUnit);
    lowest = lowest === null ? reading : Math.min(lowest, reading);
    highest = highest === null ? reading : Math.max(highest, reading);
  }

  if (quantity <= 0 || lowest === null || highest === null) return null;
  const distanceCovered = highest - lowest;
  if (distanceCovered <= 0) return null;

  /*
   * The first fill of the span went into reaching the *second* reading, so the quantity
   * that covered this distance excludes it — counting it attributes a charge to distance
   * driven before it. With two fills that leaves one, which is the smallest honest figure.
   */
  const first = ordered.find((fill) => fill.odometer !== null);
  const firstQuantity =
    first && first.quantityUnit && unitFamily(first.quantityUnit) === family
      ? convertQuantity(Number(first.quantity), first.quantityUnit, unit)
      : 0;
  const used = quantity - (Number.isFinite(firstQuantity) ? firstQuantity : 0);
  if (used <= 0) return null;

  const km = convertDistance(distanceCovered, distanceUnit, 'KM');
  return {
    fuelType,
    family,
    unit,
    quantity: used,
    distanceCovered,
    distanceUnit,
    per100Km: (used / km) * 100,
    distancePerUnit: distanceCovered / used,
    // Every figure here spans readings rather than closing full tanks. `fuel.ts` remains the
    // one that may claim the stronger basis, and only for a liquid tank.
    basis: 'SPAN',
    fills: counted,
  };
}

/** One measurable step of a fuel's history: what went in, over the distance it covered. */
export interface UsagePoint {
  readonly occurredAt: string;
  /** Distance since the previous reading, in the vehicle's unit. */
  readonly distanceCovered: number;
  readonly quantity: number;
  readonly per100Km: number;
  readonly distancePerUnit: number;
}

export interface UsageSeries {
  readonly fuelType: FuelType | null;
  readonly family: UnitFamily;
  readonly unit: QuantityUnit;
  readonly distanceUnit: DistanceUnit;
  readonly points: UsagePoint[];
}

/**
 * Consumption over time rather than averaged flat (GAPS §12).
 *
 * `computeUsage` answers "what does this car do"; this answers "is it getting worse", which is
 * the question a trend chart exists for — a clogged filter, a dragging brake or a winter of
 * short trips all show here before they show in a lifetime average that has years of good
 * driving in it.
 *
 * A point per consecutive pair of readings within one fuel, and the quantity attributed to a
 * step is what went in *reaching* it — the fills after the previous reading up to and including
 * this one. A single fill between two readings is the common case and gives one honest point.
 *
 * Steps with no fuel, no distance or a reading that went backwards are dropped rather than
 * drawn: a chart is read as measurement, and a segment across a cluster swap is not one.
 */
export function usageSeries(
  fills: readonly EnergyFill[],
  distanceUnit: DistanceUnit,
): UsageSeries[] {
  const groups = new Map<string, EnergyFill[]>();
  for (const fill of fills) {
    if (!fill.quantityUnit || !fill.quantity) continue;
    groups.set(fill.fuelType ?? '', [...(groups.get(fill.fuelType ?? '') ?? []), fill]);
  }

  const series: UsageSeries[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const family = unitFamily(ordered[0]!.quantityUnit!);
    const unit = CANONICAL[family];

    const points: UsagePoint[] = [];
    let anchor: number | null = null;
    let pending = 0;

    for (const fill of ordered) {
      if (!fill.quantityUnit || unitFamily(fill.quantityUnit) !== family) continue;
      const value = Number(fill.quantity);
      if (!Number.isFinite(value) || value <= 0) continue;
      pending += convertQuantity(value, fill.quantityUnit, unit);

      if (fill.odometer === null) continue;
      const reading = convertDistance(
        fill.odometer,
        fill.odometerUnit ?? distanceUnit,
        distanceUnit,
      );

      if (anchor !== null && reading > anchor && pending > 0) {
        const distanceCovered = reading - anchor;
        const km = convertDistance(distanceCovered, distanceUnit, 'KM');
        points.push({
          occurredAt: fill.occurredAt.toISOString(),
          distanceCovered,
          quantity: pending,
          per100Km: (pending / km) * 100,
          distancePerUnit: distanceCovered / pending,
        });
      }
      anchor = reading;
      pending = 0;
    }

    if (points.length > 0)
      series.push({
        fuelType: key === '' ? null : (key as FuelType),
        family,
        unit,
        distanceUnit,
        points,
      });
  }

  return series.sort((a, b) => b.points.length - a.points.length);
}
