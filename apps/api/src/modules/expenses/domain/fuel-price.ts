/**
 * What fuel cost per unit (GAPS §5, §11).
 *
 * Derived at read time from `amountMinor / quantity` rather than stored: both halves are
 * already on the row, a derived column would need a migration and a backfill, and a stored
 * price goes stale the moment someone corrects either half.
 *
 * Always per canonical unit of its family — per litre, per kilowatt-hour, per kilogram —
 * whatever the fill was entered in, so two fills in different units compare. Quoted as a
 * decimal string in major units with three places ("1.759"), because that is how a pump
 * displays it and minor units per litre is a fraction nobody reads.
 *
 * One family per call. A plug-in hybrid's petrol and its charging are both "what fuel cost",
 * and a single average across them is a number in no unit — the route asks once per family
 * and the client draws one line each.
 */

import {
  convertQuantity,
  minorUnitExponent,
  unitFamily,
  type QuantityUnit,
  type UnitFamily,
} from '@vehicle-os/domain';

/** What each family's prices are quoted in. */
const CANONICAL: Readonly<Record<UnitFamily, QuantityUnit>> = {
  VOLUME: 'LITER',
  ENERGY: 'KWH',
  MASS: 'KG',
};

export interface PricedFill {
  readonly occurredAt: Date;
  readonly amountMinor: number;
  readonly currency: string;
  readonly quantity: string | null;
  readonly quantityUnit: QuantityUnit | null;
  readonly vendor: string | null;
}

export interface FuelPricePoint {
  readonly occurredAt: string;
  readonly perUnit: string;
  readonly vendor: string | null;
}

export interface StationPrice {
  readonly vendor: string;
  readonly averagePerUnit: string;
  readonly fills: number;
}

export interface FuelPrices {
  readonly currency: string;
  /** What the prices are per: LITER, KWH or KG. */
  readonly unit: QuantityUnit;
  readonly averagePerUnit: string | null;
  readonly points: FuelPricePoint[];
  /** Cheapest first. Only stations with at least two fills — one fill is an anecdote. */
  readonly stations: StationPrice[];
}

function perUnitMajor(fill: PricedFill, unit: QuantityUnit): number | null {
  const quantity = Number(fill.quantity);
  if (!fill.quantityUnit || !Number.isFinite(quantity) || quantity <= 0) return null;
  if (unitFamily(fill.quantityUnit) !== unitFamily(unit)) return null;
  const amount = convertQuantity(quantity, fill.quantityUnit, unit);
  if (amount <= 0) return null;
  return fill.amountMinor / 10 ** minorUnitExponent(fill.currency) / amount;
}

const quote = (value: number) => value.toFixed(3);

/**
 * Price per litre over every fill in `currency`, oldest first.
 *
 * Fills in another currency are left out rather than converted, the same rule every cost
 * figure follows: a price in euros next to prices in dollars is a chart of exchange rates.
 */
export function fuelPrices(
  fills: readonly PricedFill[],
  currency: string,
  family: UnitFamily = 'VOLUME',
): FuelPrices {
  const unit = CANONICAL[family];
  const priced = fills
    .filter((fill) => fill.currency === currency)
    .map((fill) => ({ fill, price: perUnitMajor(fill, unit) }))
    .filter((entry): entry is { fill: PricedFill; price: number } => entry.price !== null)
    .sort((a, b) => a.fill.occurredAt.getTime() - b.fill.occurredAt.getTime());

  if (priced.length === 0)
    return { currency, unit, averagePerUnit: null, points: [], stations: [] };

  /*
   * Volume-weighted average, not the mean of prices: ten litres bought dear and fifty bought
   * cheap cost what fifty-plus-ten cost, which the plain mean of the two prices misstates.
   */
  let spent = 0;
  let liters = 0;
  const byStation = new Map<
    string,
    { spent: number; liters: number; fills: number; name: string }
  >();
  for (const { fill } of priced) {
    const amount = fill.amountMinor / 10 ** minorUnitExponent(fill.currency);
    const volume = convertQuantity(Number(fill.quantity), fill.quantityUnit!, unit);
    spent += amount;
    liters += volume;

    const name = fill.vendor?.trim();
    if (!name) continue;
    // Case-folded, so "Shell" and "SHELL" typed a month apart are one station.
    const key = name.toLowerCase();
    const station = byStation.get(key) ?? { spent: 0, liters: 0, fills: 0, name };
    station.spent += amount;
    station.liters += volume;
    station.fills += 1;
    byStation.set(key, station);
  }

  const stations = [...byStation.values()]
    .filter((station) => station.fills >= 2)
    .map((station) => ({
      vendor: station.name,
      average: station.spent / station.liters,
      fills: station.fills,
    }))
    .sort((a, b) => a.average - b.average)
    .map((station) => ({
      vendor: station.vendor,
      averagePerUnit: quote(station.average),
      fills: station.fills,
    }));

  return {
    currency,
    unit,
    averagePerUnit: quote(spent / liters),
    points: priced.map(({ fill, price }) => ({
      occurredAt: fill.occurredAt.toISOString(),
      perUnit: quote(price),
      vendor: fill.vendor,
    })),
    stations,
  };
}
