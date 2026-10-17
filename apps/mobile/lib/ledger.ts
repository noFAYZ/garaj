/*
 * The logbook's arithmetic, apart from its drawing so it can be checked off the device: how an
 * entry's day is said, and what a month spent.
 */

type Money = { amountMinor: number; currency: string };
export type Dated = {
  readonly occurredAt: string;
  readonly cost: Money | null;
  readonly eventType?: string;
};

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const DAY_MS = 86_400_000;

/**
 * When an entry happened, as a person says it: Today, Yesterday, the weekday inside the week, the
 * date after that. The month and year are the heading's to say. Days are counted between
 * midnights, so 00:30 today and 23:30 yesterday are a day apart.
 */
export function ledgerDate(occurredAt: string, now = new Date()): string {
  const date = new Date(occurredAt);
  const days = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / DAY_MS,
  );
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return WEEKDAY.format(date);
  return SHORT.format(date);
}

/** The month's spend, when every cost in it shares a currency; null with none, or a mix. */
export function monthSpend(items: readonly Dated[]): Money | null {
  const costs = items.flatMap((item) => (item.cost ? [item.cost] : []));
  if (costs.length === 0) return null;
  const currency = costs[0]!.currency;
  if (costs.some((cost) => cost.currency !== currency)) return null;
  return { amountMinor: costs.reduce((sum, cost) => sum + cost.amountMinor, 0), currency };
}

type Reading = Dated & {
  readonly id: string;
  readonly odometer: number | null;
  readonly odometerUnit: string | null;
};

const startOfDay = (iso: string) => new Date(iso).setHours(0, 0, 0, 0);

/**
 * The entry of the same kind before this one, and what has passed since: whole days between them
 * and, where both took a reading in the same unit and it went up, the distance.
 */
export function sincePrevious<T extends Reading>(entry: T, sameKind: readonly T[]) {
  const at = Date.parse(entry.occurredAt);
  let previous: T | null = null;
  for (const item of sameKind) {
    if (item.id === entry.id) continue;
    const when = Date.parse(item.occurredAt);
    if (when <= at && (!previous || when > Date.parse(previous.occurredAt))) previous = item;
  }
  if (!previous) return null;
  const days = Math.round((startOfDay(entry.occurredAt) - startOfDay(previous.occurredAt)) / DAY_MS);
  const distance =
    entry.odometer !== null &&
    previous.odometer !== null &&
    entry.odometerUnit === previous.odometerUnit &&
    entry.odometer > previous.odometer
      ? entry.odometer - previous.odometer
      : null;
  return { previous, days, distance };
}

// ponytail: a comma is read as the decimal point — fills under a thousand litres, as they all are.
const QUANTITY_PARTS = /^(\d+(?:[.,]\d+)?)\s?(l|kwh|gal)$/i;

/** A fill's quantity as `fillQuantity` says it ("40 L"), as a number and its unit. */
function quantityParts(quantity: string | null) {
  const match = quantity ? QUANTITY_PARTS.exec(quantity.trim()) : null;
  const amount = match ? Number(match[1]!.replace(',', '.')) : 0;
  if (!match || !(amount > 0)) return null;
  const unit = match[2]!.toLowerCase();
  return { amount, unit: unit === 'l' ? 'L' : unit === 'kwh' ? 'kWh' : 'gal' };
}

/**
 * How far a fill went, from what went in and the distance since the fill before — full to full:
 * litres or kWh per 100, or miles per gallon where the fill is in gallons.
 */
export function economy(
  quantity: string | null,
  distance: number | null,
  unit: string | null,
): string | null {
  const fill = quantityParts(quantity);
  if (!fill || !distance) return null;
  const per = unit === 'MI' ? 'mi' : 'km';
  if (fill.unit === 'gal') return `${(distance / fill.amount).toFixed(1)} ${per === 'mi' ? 'mpg' : 'km/gal'}`;
  return `${((fill.amount / distance) * 100).toFixed(1)} ${fill.unit}/100 ${per}`;
}

/** What one litre (kWh, gallon) of a fill cost: `formatMoney` rounds it to the cent. */
export function unitPrice(cost: Money | null, quantity: string | null) {
  const fill = quantityParts(quantity);
  if (!cost || !fill) return null;
  return {
    price: { amountMinor: cost.amountMinor / fill.amount, currency: cost.currency },
    per: fill.unit,
  };
}

/**
 * A kind's spend round one entry, for its bars: up to `size` entries in that entry's currency,
 * oldest first, placed so the entry sits as near the middle as the record allows — and the kind's
 * typical spend, the median of every cost loaded, so one big bill does not move it. Nothing under
 * three costs: two bars are not a pattern.
 */
export function spendWindow<T extends Dated & { readonly id: string }>(
  entry: T,
  sameKind: readonly T[],
  size = 8,
) {
  if (!entry.cost) return null;
  const currency = entry.cost.currency;
  const costed = [...sameKind.filter((item) => item.id !== entry.id), entry]
    .filter((item) => item.cost?.currency === currency)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  if (costed.length < 3) return null;
  const at = costed.findIndex((item) => item.id === entry.id);
  const start = Math.max(0, Math.min(at - Math.floor(size / 2), costed.length - size));
  const bars = costed.slice(start, start + size);
  const amounts = costed.map((item) => item.cost!.amountMinor).sort((a, b) => a - b);
  const mid = amounts.length >> 1;
  const typical =
    amounts.length % 2 ? amounts[mid]! : Math.round((amounts[mid - 1]! + amounts[mid]!) / 2);
  return { bars, typical, max: Math.max(typical, ...bars.map((item) => item.cost!.amountMinor)) };
}
