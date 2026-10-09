/**
 * Units (Architecture.md §16, PRD §46).
 *
 * A distance is never a bare number. Every reading carries the unit it was recorded in,
 * and conversion is always explicit — `convertDistance` demands both units, so there is
 * no call shape that can quietly read miles as kilometres.
 */

import { ENERGY_UNITS, MASS_UNITS } from './enums';
import type { DistanceUnit, QuantityUnit, VolumeUnit } from './enums';

export interface Distance {
  readonly value: number;
  readonly unit: DistanceUnit;
}

export interface Volume {
  readonly value: number;
  readonly unit: VolumeUnit;
}

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnitError';
  }
}

/** Exact by international agreement (1959), not an approximation. */
const KM_PER_MILE = 1.609344;

const LITERS_PER_UNIT: Record<VolumeUnit, number> = {
  LITER: 1,
  US_GALLON: 3.785411784,
  IMP_GALLON: 4.54609,
};

export function distance(value: number, unit: DistanceUnit): Distance {
  if (!Number.isFinite(value)) throw new UnitError(`Distance must be finite, received: ${value}`);
  if (value < 0) throw new UnitError(`Distance cannot be negative, received: ${value}`);
  return Object.freeze({ value, unit });
}

export function convertDistance(value: number, from: DistanceUnit, to: DistanceUnit): number {
  if (from === to) return value;
  return from === 'MI' ? value * KM_PER_MILE : value / KM_PER_MILE;
}

/**
 * Canonical form for analytics and cross-vehicle comparison (§16). The original reading
 * and its unit stay on the row untouched; this is a derived value, never a replacement.
 */
export function toKilometers(reading: Distance): number {
  return convertDistance(reading.value, reading.unit, 'KM');
}

export function toMiles(reading: Distance): number {
  return convertDistance(reading.value, reading.unit, 'MI');
}

export function convertVolume(value: number, from: VolumeUnit, to: VolumeUnit): number {
  if (from === to) return value;
  return (value * LITERS_PER_UNIT[from]) / LITERS_PER_UNIT[to];
}

export function toLiters(reading: Volume): number {
  return convertVolume(reading.value, reading.unit, 'LITER');
}

export function formatDistance(reading: Distance, locale = 'en-US', fractionDigits = 0): string {
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: fractionDigits,
  }).format(reading.value);
  return `${formatted} ${reading.unit === 'KM' ? 'km' : 'mi'}`;
}

/**
 * Odometers are physical: they get replaced, corrected, and occasionally read wrong off a
 * dash photo. A decrease is reported, never rejected — refusing the write would leave the
 * user unable to record a legitimate cluster swap, which is worse than a flagged row.
 */
export function isOdometerRegression(previous: Distance | null, next: Distance): boolean {
  if (!previous) return false;
  return toKilometers(next) < toKilometers(previous);
}

/**
 * Which family a quantity unit belongs to — what it measures, not how much.
 *
 * Every consumption figure branches on this: litres give l/100km and mpg, kilowatt-hours give
 * kWh/100km and mi/kWh, kilograms give kg/100km. Mixing two families in one average is the
 * bug this exists to make impossible — a plug-in hybrid's tank and battery are two separate
 * measurements of the same journey, and adding them produces a number with no unit at all.
 */
export type UnitFamily = 'VOLUME' | 'ENERGY' | 'MASS';

export function unitFamily(unit: QuantityUnit): UnitFamily {
  if ((ENERGY_UNITS as readonly string[]).includes(unit)) return 'ENERGY';
  if ((MASS_UNITS as readonly string[]).includes(unit)) return 'MASS';
  return 'VOLUME';
}

/**
 * Convert within a family, refusing across them.
 *
 * There is no exchange rate between a litre and a kilowatt-hour: how far either takes you is
 * the vehicle's business, not the unit's. A caller that reaches here with two families has a
 * bug upstream, and a throw is how it is found in a test rather than in a chart.
 */
export function convertQuantity(value: number, from: QuantityUnit, to: QuantityUnit): number {
  if (from === to) return value;
  const family = unitFamily(from);
  if (family !== unitFamily(to)) {
    throw new UnitError(`Cannot convert ${from} to ${to}: different kinds of quantity`);
  }
  // Within energy and within mass there is currently one member each, so only volume has
  // anywhere to go — and `from === to` has already returned for the other two.
  return convertVolume(value as never, from as VolumeUnit, to as VolumeUnit);
}
