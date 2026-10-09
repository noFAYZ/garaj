/**
 * Turning someone else's spreadsheet into this product's rows.
 *
 * Pure, and deliberately so: a mapping is where an import quietly corrupts a record the
 * owner then believes is authoritative, and the only way to be sure a column means what it
 * is assumed to mean is to be able to assert on it without a database.
 *
 * A format is a *named* mapping, never a sniffed one. Guessing from the headers would turn
 * a mis-detected file into a year of silently wrong history — so the caller says which app
 * the file came from, and a column that is not in that format's alias list is ignored
 * rather than interpreted.
 */

import { minorUnitExponent, type DistanceUnit, type VolumeUnit } from '@vehicle-os/domain';
import type { ExpenseCategory, FuelType } from '@vehicle-os/domain';
import type { ImportFormat } from '@vehicle-os/contracts';
import { normaliseHeader } from '../../../infrastructure/csv';

/** One row as this product understands it, before anything is written. */
export interface MappedRow {
  readonly occurredAt: Date;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly vendor: string | null;
  readonly amountMinor: number;
  readonly odometer: number | null;
  readonly quantity: string | null;
  /** From the file when it says (a `garaj` export does, per row); otherwise the caller's choice. */
  readonly quantityUnit: VolumeUnit | null;
  readonly fuelType: FuelType | null;
  readonly isFullTank: boolean | null;
  /**
   * From the file, when it names one — a `garaj` export does, per row. Null leaves the
   * choice to the caller's default, which is the only honest answer for a fuel-log export
   * that never recorded a currency at all.
   */
  readonly currency: string | null;
  /** Present only on a `garaj` file, which carries the ids it was exported with. */
  readonly id: string | null;
}

export interface MappingDefaults {
  readonly currency: string;
  readonly distanceUnit: DistanceUnit;
  readonly volumeUnit: VolumeUnit;
}

/**
 * Column aliases per format, keyed by the field this product needs.
 *
 * Several spellings each because the same app writes "Total Cost" in one version and
 * "total_spent" in the next, and a mapping that lists one of them drops the column silently
 * on the other. Compared after `normaliseHeader`, so case and punctuation do not appear here.
 */
const ALIASES: Record<ImportFormat, Readonly<Record<string, readonly string[]>>> = {
  garaj: {
    id: ['id'],
    date: ['occurredat', 'date'],
    category: ['category'],
    description: ['description', 'title'],
    vendor: ['vendor', 'provider'],
    amountMinor: ['amountminor'],
    currency: ['currency'],
    odometer: ['odometer'],
    quantity: ['quantity'],
    quantityUnit: ['quantityunit'],
    fuelType: ['fueltype'],
    fullTank: ['isfulltank'],
  },
  fuelly: {
    date: ['date', 'fuelupdate'],
    odometer: ['odometer', 'odometermi', 'odometerkm'],
    volume: ['gallons', 'fillamount', 'liters', 'litres', 'quantity'],
    total: ['totalspent', 'totalcost', 'cost'],
    unitPrice: ['ppg', 'priceunit', 'pricepergallon', 'priceperunit'],
    vendor: ['gasbrand', 'location', 'station'],
    note: ['note', 'notes'],
    // Fuelly records the *absence* of a full tank, which inverts on the way in.
    partial: ['partial', 'partialfillup'],
    fuelType: ['fuel', 'fueltype', 'fuelupType', 'octane'],
  },
  /*
   * Fuelio exports one CSV holding several sections; the fuel one is what is mapped here.
   * Its headers are lower-case with underscores, which `normaliseHeader` already folds, and
   * it writes the *unit* price rather than the total on some versions — `resolveAmount`
   * multiplies it back out.
   */
  fuelio: {
    date: ['data', 'date', 'fueldate'],
    odometer: ['odo', 'odometer', 'mileage'],
    volume: ['fuel', 'volume', 'liters', 'litres', 'quantity'],
    total: ['cost', 'totalcost', 'price'],
    unitPrice: ['priceperunit', 'unitprice', 'pricel', 'priceliter'],
    vendor: ['fuelstationname', 'station', 'name', 'location'],
    note: ['notes', 'note'],
    fullTank: ['full', 'fullfillup'],
    fuelType: ['fueltype', 'fuel_type'],
  },
  /*
   * "My Cars" (Kine Apps) writes a general event export with a type column, so its category
   * is mapped rather than assumed to be fuel — a service row in a file read as fuel would
   * land in the consumption figures and quietly wreck them.
   */
  mycars: {
    date: ['date', 'eventdate', 'datetime'],
    odometer: ['odometer', 'mileage', 'km', 'distance'],
    volume: ['quantity', 'amount', 'volume', 'liters', 'litres', 'kwh'],
    total: ['cost', 'price', 'totalcost', 'total'],
    unitPrice: ['unitprice', 'priceperunit'],
    vendor: ['place', 'station', 'vendor', 'supplier'],
    note: ['note', 'notes', 'description', 'comment'],
    fullTank: ['fulltank', 'full'],
    fuelType: ['fueltype', 'fuel'],
    category: ['type', 'eventtype', 'category'],
    currency: ['currency'],
  },
  drivvo: {
    date: ['date', 'data'],
    odometer: ['odometer', 'odometro', 'km'],
    volume: ['volume', 'liters', 'litres', 'quantity', 'litros'],
    total: ['totalprice', 'totalcost', 'total', 'valortotal'],
    unitPrice: ['priceperunit', 'unitprice', 'price', 'preco'],
    vendor: ['gasstation', 'station', 'place', 'posto'],
    note: ['observation', 'note', 'notes', 'observacao'],
    fullTank: ['fulltank', 'tanquecheio'],
    fuelType: ['typeoffuel', 'fuel', 'combustivel'],
    category: ['type', 'category', 'service', 'tipo'],
  },
};

/** The first alias the file actually has a column for, or undefined. */
function pick(
  row: Readonly<Record<string, string>>,
  format: ImportFormat,
  field: string,
): string | undefined {
  for (const alias of ALIASES[format][field] ?? []) {
    const value = row[normaliseHeader(alias)];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

/**
 * A decimal written by a person, in whichever convention their locale uses.
 *
 * `1,234.56` and `1.234,56` are the same amount, and a file exported in one convention is
 * routinely opened and re-saved in the other. The rule: whichever separator appears last is
 * the decimal one, and a lone comma is a decimal point only when exactly two digits follow
 * it — which is what distinguishes `42,50` from `1,500`.
 *
 * ponytail: heuristic, not a locale parameter. `1,500` meaning one and a half in a file
 * that writes three decimals would be read as fifteen hundred — take a locale on the
 * request if a real file ever turns up that way.
 */
export function parseDecimal(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, '').trim();
  if (cleaned === '' || cleaned === '-') return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalised: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalised =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalised = /,\d{2}$/.test(cleaned) ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  } else {
    normalised = cleaned;
  }

  const value = Number(normalised);
  return Number.isFinite(value) ? value : null;
}

/** A major-unit amount as the integer count of minor units the rest of the system uses. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** minorUnitExponent(currency));
}

/**
 * A date as the file wrote it.
 *
 * ISO first, because that is what this product's own export emits and what every sane
 * exporter emits. Then `DD/MM/YYYY`, which Drivvo writes — never `MM/DD/YYYY`: the two are
 * indistinguishable for the first twelve days of a month, and a silent coin flip on which
 * one was meant is precisely the corruption an import must not commit. A file in US order
 * fails its rows with a message rather than landing them three months out.
 */
export function parseRowDate(raw: string): Date | null {
  const text = raw.trim();
  if (text === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const parsed = new Date(text.length > 10 ? text : `${text}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const slashed = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(text);
  if (slashed) {
    const [, day, month, year] = slashed;
    // Midday UTC, not midnight: a date stored at 00:00Z lands on the previous day for every
    // reader west of Greenwich, which moves half an import's history back by one.
    const parsed = new Date(
      `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}T12:00:00Z`,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

const FUEL_WORDS: readonly (readonly [RegExp, FuelType])[] = [
  [/diesel|gasoil|gazole/i, 'DIESEL'],
  [/lpg|gpl|propane|autogas/i, 'LPG'],
  [/cng|methane|gnv/i, 'CNG'],
  [/electric|ev|kwh/i, 'ELECTRIC_SLOW'],
  [/def|adblue/i, 'DEF'],
  [/gasoline|petrol|benzin|unleaded|regular|premium|octane|\b9[0-9]\b/i, 'GASOLINE'],
];

function toFuelType(raw: string | undefined): FuelType | null {
  if (!raw) return null;
  for (const [pattern, fuel] of FUEL_WORDS) if (pattern.test(raw)) return fuel;
  return null;
}

const CATEGORY_WORDS: readonly (readonly [RegExp, ExpenseCategory])[] = [
  [/fuel|refuel|gas|petrol|diesel|abastec/i, 'FUEL'],
  [/charg/i, 'CHARGING'],
  [/service|maintenance|revis/i, 'MAINTENANCE'],
  [/repair|repar/i, 'REPAIR'],
  [/insur|seguro/i, 'INSURANCE'],
  [/tax|imposto/i, 'TAX'],
  [/registr|licen/i, 'REGISTRATION'],
  [/wash|clean|lava/i, 'CLEANING'],
  [/park|toll|transport/i, 'TRANSPORT'],
];

function toCategory(raw: string | undefined, fallback: ExpenseCategory): ExpenseCategory {
  if (!raw) return fallback;
  for (const [pattern, category] of CATEGORY_WORDS) if (pattern.test(raw)) return category;
  return 'OTHER';
}

function parseBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  if (/^(1|true|yes|y|sim)$/i.test(raw.trim())) return true;
  if (/^(0|false|no|n|nao|não)$/i.test(raw.trim())) return false;
  return null;
}

/** Only this product's own spellings; anything else leaves the caller's choice in place. */
function toVolumeUnit(raw: string | undefined): VolumeUnit | null {
  const value = raw?.trim().toUpperCase();
  return value === 'LITER' || value === 'US_GALLON' || value === 'IMP_GALLON' ? value : null;
}

export class MappingError extends Error {}

/**
 * One file row as a row this product could store, or a thrown reason it could not.
 *
 * Throwing rather than returning null: every refusal carries the sentence the user will
 * read next to the line number, and "row 41 skipped" with no reason is a bug report waiting
 * to be filed.
 */
export function mapRow(
  row: Readonly<Record<string, string>>,
  format: ImportFormat,
  defaults: MappingDefaults,
): MappedRow {
  const rawDate = pick(row, format, 'date');
  if (!rawDate) throw new MappingError('No date column found in this row.');

  const occurredAt = parseRowDate(rawDate);
  if (!occurredAt) {
    throw new MappingError(
      `Could not read "${rawDate}" as a date. Expected YYYY-MM-DD or DD/MM/YYYY.`,
    );
  }

  const quantityRaw = pick(row, format, 'volume') ?? pick(row, format, 'quantity');
  const quantity = quantityRaw === undefined ? null : parseDecimal(quantityRaw);

  const amountMinor = resolveAmount(row, format, defaults.currency, quantity);
  const odometerRaw = pick(row, format, 'odometer');
  const odometer = odometerRaw === undefined ? null : parseDecimal(odometerRaw);

  const fuelType = toFuelType(pick(row, format, 'fuelType'));
  const category =
    format === 'garaj'
      ? toCategory(pick(row, format, 'category'), 'OTHER')
      : toCategory(pick(row, format, 'category'), quantity === null ? 'OTHER' : 'FUEL');

  const note = pick(row, format, 'note') ?? pick(row, format, 'description');

  /*
   * Fuelly stores "partial", this product stores "full" — the same fact, inverted. Getting
   * this backwards would not fail anything: it would quietly halve every consumption figure
   * computed from the imported tanks.
   */
  const fullTank =
    format === 'fuelly'
      ? invert(parseBoolean(pick(row, format, 'partial')))
      : parseBoolean(pick(row, format, 'fullTank'));

  return {
    occurredAt,
    category,
    description: note?.trim() || defaultDescription(category, format),
    vendor: pick(row, format, 'vendor')?.trim() || null,
    amountMinor,
    odometer: odometer === null ? null : Math.round(odometer),
    quantity: quantity === null ? null : String(quantity),
    quantityUnit: toVolumeUnit(pick(row, format, 'quantityUnit')),
    fuelType,
    isFullTank: fullTank,
    currency: pick(row, format, 'currency')?.trim().toUpperCase() || null,
    id: pick(row, format, 'id') ?? null,
  };
}

function invert(value: boolean | null): boolean | null {
  return value === null ? null : !value;
}

/**
 * The amount, in minor units.
 *
 * A `garaj` file already carries minor units and is taken as-is — re-deriving them from a
 * decimal would reintroduce the rounding the integer column exists to avoid. Everything
 * else is a decimal total; where a file has only a unit price, the total is that times the
 * volume, which is the arithmetic the exporting app did to fill its own total column.
 */
function resolveAmount(
  row: Readonly<Record<string, string>>,
  format: ImportFormat,
  currency: string,
  quantity: number | null,
): number {
  if (format === 'garaj') {
    const raw = pick(row, format, 'amountMinor');
    const parsed = raw === undefined ? null : Number(raw);
    if (parsed === null || !Number.isFinite(parsed)) {
      throw new MappingError('No amountMinor column found in this row.');
    }
    return Math.round(parsed);
  }

  const totalRaw = pick(row, format, 'total');
  const total = totalRaw === undefined ? null : parseDecimal(totalRaw);
  if (total !== null) return toMinor(total, currency);

  const unitPriceRaw = pick(row, format, 'unitPrice');
  const unitPrice = unitPriceRaw === undefined ? null : parseDecimal(unitPriceRaw);
  if (unitPrice !== null && quantity !== null) return toMinor(unitPrice * quantity, currency);

  throw new MappingError('No total cost column found in this row.');
}

function defaultDescription(category: ExpenseCategory, format: ImportFormat): string {
  const source = format === 'garaj' ? 'import' : format;
  return category === 'FUEL' ? 'Fuel' : `Imported from ${source}`;
}
