/**
 * What the add forms ask, shared so the web and the phone ask the same questions in the same
 * order and in the same words: which kinds come first, what each kind's line looks like, which
 * figures a kind takes, the jobs a reminder starts from and the presets under them — and, for a
 * new vehicle, how a description is split into the five answers and what it found besides.
 *
 * Kinds and types are the domain's strings, typed structurally like the rest of this package.
 */

import { localDay } from './activity';
import { vinTail } from './vehicle-facts';

/* ---------------------------------------------------------------------------------------------- */
/* Something done                                                                                  */

/** The kinds people log week to week, in the order a vehicle with no history offers them. */
export const COMMON_KINDS = [
  'FUEL',
  'MAINTENANCE',
  'REPAIR',
  'CHARGE',
  'CLEANING',
  'INSPECTION',
  'EXPENSE',
  'NOTE',
] as const;

/**
 * Every kind in the order the rail offers them: what this vehicle logs, most used first, then the
 * common ones, then the rest — so the kind wanted is nearly always one of the first chips.
 */
export function rankKinds<K extends string>(
  all: readonly K[],
  logged: readonly { readonly eventType: string }[],
): K[] {
  const counts = new Map<string, number>();
  for (const entry of logged) counts.set(entry.eventType, (counts.get(entry.eventType) ?? 0) + 1);
  // `sort`, not `toSorted`: the phone's Hermes has no `toSorted`. `filter` made the array, so
  // sorting it in place touches nothing anyone else holds.
  const used = all
    .filter((kind) => counts.has(kind))
    .sort((a, b) => counts.get(b)! - counts.get(a)!);
  const common = all.filter((kind) => (COMMON_KINDS as readonly string[]).includes(kind));
  return [...new Set([...used, ...common, ...all])];
}

/** Work on the vehicle: what can complete a schedule, where a fill-up or a fee cannot. */
const WORK = ['MAINTENANCE', 'REPAIR', 'INSPECTION', 'CLEANING', 'MODIFICATION', 'PART_INSTALLED'];

/**
 * Whether a schedule is offered to complete: one the line names always is; otherwise only to
 * work — every schedule to a service, the ones that are due to the rest of it.
 */
export function offersSchedule(kind: string, due: boolean, named: boolean): boolean {
  return named || (WORK.includes(kind) && (due || kind === 'MAINTENANCE'));
}

/** Each kind's example line, in the reader's own grammar, so the placeholder teaches it. */
const EXAMPLE: Readonly<Record<string, string>> = {
  FUEL: 'Filled up 40 L, €62 at Shell, 52,900 km',
  CHARGE: 'Charged 32 kWh, €9 at Ionity',
  MAINTENANCE: 'Oil and filter change, €189 at Kwik Fit',
  REPAIR: 'Replaced the front pads, €240 yesterday',
  CLEANING: 'Full valet, €35 on Saturday',
  INSPECTION: 'Annual inspection passed, €55',
  EXPENSE: 'Parking permit €120',
  INSURANCE: 'Renewed the policy, €640',
  REGISTRATION: 'Road tax for the year, €190',
  TRIP: 'Drove to Galway, 52,900 km',
  NOTE: 'Odometer reading, 52,900 km',
};

/** The line a kind's placeholder shows, in the vehicle's own currency sign. */
export function exampleLine(kind: string, name: string, symbol: string): string {
  return (EXAMPLE[kind] ?? `${name}, €20`).replace(/€/g, symbol);
}

/** What a kind measures besides its cost: litres at a pump, kWh at a charger. */
export function quantityUnit(kind: string): 'L' | 'kWh' | null {
  return kind === 'FUEL' ? 'L' : kind === 'CHARGE' ? 'kWh' : null;
}

/** Paperwork is not done at a reading; everything else may carry one. */
export const asksOdometer = (kind: string): boolean =>
  kind !== 'INSURANCE' && kind !== 'REGISTRATION';

const COST_LABEL: Readonly<Record<string, string>> = {
  INSURANCE: 'Premium',
  INSPECTION: 'Fee',
  REGISTRATION: 'Fee',
  PURCHASE: 'Price',
  SALE: 'Sold for',
  VALUATION: 'Valued at',
  TRIP: 'Spent',
};

/** What the money is called, where "cost" is the wrong word: a premium, a fee, a price. */
export const costLabel = (kind: string): string => COST_LABEL[kind] ?? 'Cost';

/**
 * What a photo is to a kind, for the receipt key and the reader behind it: the reader knows a
 * receipt at a pump, a workshop's invoice and a dashboard.
 */
export function photoRead(kind: string): {
  readonly draft: 'fuel' | 'service' | 'odometer';
  readonly name: string;
} {
  if (kind === 'FUEL' || kind === 'CHARGE') return { draft: 'fuel', name: 'receipt' };
  if (kind === 'NOTE' || kind === 'TRIP') return { draft: 'odometer', name: 'dashboard' };
  return { draft: 'service', name: kind === 'EXPENSE' ? 'receipt' : 'invoice' };
}

/**
 * The measured amount of a fill, as the line said it ("40 L", "10 gal", "32 kWh"): the figure, and
 * the unit it was said in.
 */
export function splitQuantity(said: string | null): { amount: string; unit: string } | null {
  const match = said ? /^([\d.]+)\s*(\S+)$/.exec(said.trim()) : null;
  return match ? { amount: match[1]!, unit: match[2]! } : null;
}

/** "€", "$", "£": how a currency is written in front of an amount. */
export function symbolOf(currency: string): string {
  try {
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
      })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency
    );
  } catch {
    return currency;
  }
}

/**
 * The currency a typed amount is in: "€62" is euros whatever the vehicle counts in. A bare "$"
 * is the vehicle's own dollar when it counts in one, else the US dollar; no sign at all is the
 * vehicle's currency.
 */
export function currencyOfLine(written: string | null, vehicleCurrency: string): string | null {
  if (written === '$') return symbolOf(vehicleCurrency).includes('$') ? vehicleCurrency : 'USD';
  return written;
}

/* ---------------------------------------------------------------------------------------------- */
/* Something coming up                                                                             */

/** The distance round jobs are done at: 10,000 km, or 6,000 mi. */
const bigDistance = (unit: string) => (unit === 'mi' ? 6000 : 10000);
/** Grouped the way the reader reads a figure, whatever the device's own locale groups with. */
const grouped = (value: number) => value.toLocaleString('en-US');

/** Reminders people set, ready-made: one press writes the whole line in the reader's grammar. */
export function commonJobs(
  unit: string,
): readonly { readonly label: string; readonly line: string }[] {
  const at = (times: number) => `${grouped(bigDistance(unit) * times)} ${unit}`;
  return [
    { label: 'Oil change', line: `Oil change every 12 months or ${at(1)}` },
    { label: 'Tyre rotation', line: `Rotate tyres every ${at(1)}` },
    { label: 'Brake check', line: 'Brake check every 12 months' },
    { label: 'Annual inspection', line: 'Annual inspection yearly' },
    { label: 'Insurance renewal', line: 'Renew insurance in a year' },
    { label: 'Registration', line: 'Renew registration in a year' },
    { label: 'Air filter', line: `Air filter every 24 months or ${at(2)}` },
    { label: 'Battery check', line: 'Battery check every 12 months' },
    { label: 'Coolant', line: 'Coolant every 24 months' },
    { label: 'Spark plugs', line: `Spark plugs every 36 months or ${at(4)}` },
    { label: 'Timing belt', line: `Timing belt every 60 months or ${at(10)}` },
    { label: 'Full valet', line: 'Full valet every 3 months' },
  ];
}

/** When a one-off is due, as the chips under it offer it. */
export function duePresets(now = new Date()): readonly { label: string; day: string }[] {
  return [
    { label: 'No date', day: '' },
    { label: 'Next week', day: localDay({ days: 7 }, now) },
    { label: 'Next month', day: localDay({ months: 1 }, now) },
    { label: 'In 3 months', day: localDay({ months: 3 }, now) },
  ];
}

/** How often a repeat runs, as the chips under it offer it. */
export function intervalPresets(
  unit: string,
): readonly { label: string; months: string; distance: string }[] {
  const big = bigDistance(unit);
  const said = `${grouped(big)} ${unit}`;
  return [
    { label: '6 months', months: '6', distance: '' },
    { label: '12 months', months: '12', distance: '' },
    { label: said, months: '', distance: String(big) },
    { label: `12 mo or ${said}`, months: '12', distance: String(big) },
  ];
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

/**
 * When a new schedule first comes due, in a line: "Oct 2027 or 62,900 km". A new schedule counts
 * from today and the current reading, so this is the server's own answer.
 */
export function firstDue(
  months: number | null,
  distance: number | null,
  odometer: number | null,
  unit: string,
  now = new Date(),
): string | null {
  const parts = [
    months ? MONTH_YEAR.format(new Date(now.getFullYear(), now.getMonth() + months, 1)) : null,
    distance
      ? odometer !== null
        ? `${grouped(odometer + distance)} ${unit}`
        : `${grouped(distance)} ${unit} on`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' or ') : null;
}

/* ---------------------------------------------------------------------------------------------- */
/* A new vehicle                                                                                   */

/** A VIN as typed or pasted — 17 letters and digits, never I, O or Q — or null if it is not one. */
export function asVin(text: string): string | null {
  const vin = text.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

/** The five questions the add form asks, as it holds them: strings, empty when unanswered. */
export interface VehicleAnswers {
  readonly name: string;
  readonly make: string;
  readonly model: string;
  readonly year: string;
  readonly plate: string;
  readonly odometer: string;
}

/**
 * What a description, a VIN or a look-up found that the form has no question for. It goes with
 * the vehicle and shows as chips that can be dropped: the form stays five questions long, and
 * nothing read is lost.
 */
export interface VehicleExtras {
  readonly vin?: string;
  readonly variant?: string;
  readonly color?: string;
  readonly purchaseDate?: string;
  /** In major units, as said. */
  readonly purchasePrice?: number;
  readonly purchaseCurrency?: string;
  readonly engineHours?: number;
  readonly specs?: Readonly<Record<string, string | number>>;
}

export type ExtraKey = 'vin' | 'variant' | 'color' | 'purchase' | 'engineHours' | 'specs';

/** A read description, in `VehicleDraft`'s names. */
interface DraftLike {
  readonly vehicleType?: string;
  readonly make?: string;
  readonly model?: string;
  readonly variant?: string;
  readonly year?: number;
  readonly nickname?: string;
  readonly color?: string;
  readonly identificationNumber?: string;
  readonly registrationIdentifier?: string;
  readonly purchaseDate?: string;
  readonly purchasePrice?: number;
  readonly purchaseCurrency?: string;
  readonly currentOdometer?: number;
  readonly odometerUnit?: string;
  readonly currentEngineHours?: number;
  readonly specs: Readonly<Record<string, string | number>>;
}

/** A draft, split into the answers it gives, the type and unit, and the extras it found. */
export function splitDraft(draft: DraftLike): {
  answers: Partial<Record<keyof VehicleAnswers, string>>;
  type: string | null;
  unit: string | null;
  extras: VehicleExtras;
} {
  const answers: Partial<Record<keyof VehicleAnswers, string>> = {};
  const put = (key: keyof VehicleAnswers, value: string | number | undefined) => {
    if (value !== undefined && String(value).trim()) answers[key] = String(value).trim();
  };
  put('name', draft.nickname);
  put('make', draft.make);
  put('model', draft.model);
  put('year', draft.year);
  put('plate', draft.registrationIdentifier?.toUpperCase());
  put('odometer', draft.currentOdometer);
  const extras: Record<string, unknown> = {
    vin: draft.identificationNumber?.toUpperCase(),
    variant: draft.variant,
    color: draft.color,
    purchaseDate: draft.purchaseDate,
    purchasePrice: draft.purchasePrice,
    purchaseCurrency: draft.purchaseCurrency,
    engineHours: draft.currentEngineHours,
    specs: Object.keys(draft.specs).length ? draft.specs : undefined,
  };
  return {
    answers,
    type: draft.vehicleType ?? null,
    unit: draft.odometerUnit ?? null,
    extras: Object.fromEntries(
      Object.entries(extras).filter(([, value]) => value !== undefined && value !== ''),
    ) as VehicleExtras,
  };
}

/** The extras without one of them: what a chip's × does. */
export function dropExtra(extras: VehicleExtras, key: ExtraKey): VehicleExtras {
  const keys: Record<ExtraKey, readonly (keyof VehicleExtras)[]> = {
    vin: ['vin'],
    variant: ['variant'],
    color: ['color'],
    purchase: ['purchaseDate', 'purchasePrice', 'purchaseCurrency'],
    engineHours: ['engineHours'],
    specs: ['specs'],
  };
  return Object.fromEntries(
    Object.entries(extras).filter(([name]) => !keys[key].includes(name as keyof VehicleExtras)),
  );
}

const BOUGHT = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' });

/** The extras as chips, in the order they read: what it is, then its story, then the figures. */
export function extraChips(extras: VehicleExtras): readonly { key: ExtraKey; label: string }[] {
  const chips: { key: ExtraKey; label: string }[] = [];
  if (extras.vin) chips.push({ key: 'vin', label: `VIN ${vinTail(extras.vin)}` });
  if (extras.variant) chips.push({ key: 'variant', label: extras.variant });
  if (extras.color) chips.push({ key: 'color', label: extras.color });
  if (extras.purchaseDate || extras.purchasePrice) {
    const when = extras.purchaseDate
      ? BOUGHT.format(new Date(`${extras.purchaseDate}T12:00:00`))
      : null;
    let price: string | null = null;
    if (extras.purchasePrice) {
      try {
        price = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: extras.purchaseCurrency ?? 'USD',
          maximumFractionDigits: 0,
        }).format(extras.purchasePrice);
      } catch {
        price = grouped(extras.purchasePrice);
      }
    }
    chips.push({
      key: 'purchase',
      label: ['Bought', when, price ? `for ${price}` : null].filter(Boolean).join(' '),
    });
  }
  if (extras.engineHours)
    chips.push({ key: 'engineHours', label: `${grouped(extras.engineHours)} h` });
  const specs = Object.keys(extras.specs ?? {}).length;
  if (specs)
    chips.push({ key: 'specs', label: `${specs} factory ${specs === 1 ? 'spec' : 'specs'}` });
  return chips;
}
