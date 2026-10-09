/**
 * Display formatting.
 *
 * Money and distances arrive from the API in their stored form — minor units plus a
 * currency, a number plus its unit — and are turned into text only here. Formatting in a
 * component is how the same amount ends up rendered three different ways on three screens.
 */

import { minorUnitExponent, type DistanceUnit } from '@vehicle-os/domain';

/*
 * `Intl` formatters are expensive to build — each one parses locale data — and these run
 * once per row in every list. Built once per locale and currency, then reused.
 * ponytail: unbounded map, but its keys are a handful of locales and currencies.
 */
const formatters = new Map<string, unknown>();
function cached<T>(key: string, create: () => T): T {
  if (!formatters.has(key)) formatters.set(key, create());
  return formatters.get(key) as T;
}

export function formatMoney(
  money: { amountMinor: number; currency: string } | null | undefined,
  locale = 'en-US',
): string {
  if (!money) return '—';

  const formatter = cached(
    `money|${locale}|${money.currency}`,
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }),
  );
  // Intl knows each currency's exponent, so JPY (0 decimals) and KWD (3) scale correctly
  // without a per-currency table here.
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(money.amountMinor / 10 ** exponent);
}

/** Whole units, for a figure read at a glance (the vehicle's cluster). Ledgers keep the cents. */
export function formatMoneyWhole(
  money: { amountMinor: number; currency: string } | null | undefined,
  locale = 'en-US',
): string {
  if (!money) return '—';
  const formatter = cached(
    `money0|${locale}|${money.currency}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: money.currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
  );
  return formatter.format(fromMinorUnits(money.amountMinor, money.currency));
}

/** Whole units only: nobody reads an odometer to two decimal places. */
export function formatDistance(
  value: number | null | undefined,
  unit: DistanceUnit | null | undefined,
  locale = 'en-US',
): string {
  if (value === null || value === undefined) return '—';
  const suffix = unit === 'MI' ? 'mi' : 'km';
  const formatter = cached(
    `distance|${locale}`,
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
  );
  return `${formatter.format(value)} ${suffix}`;
}

export function formatDate(iso: string, locale = 'en-US'): string {
  const formatter = cached(
    `date|${locale}`,
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
  );
  return formatter.format(new Date(iso));
}

/**
 * "3 days ago", "in 2 months". `Intl.RelativeTimeFormat` handles the grammar and the
 * pluralisation for every locale, which a hand-rolled version gets wrong past English.
 */
export function formatRelative(iso: string, locale = 'en-US'): string {
  const formatter = cached(
    `relative|${locale}`,
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
  );
  const deltaSeconds = (new Date(iso).getTime() - Date.now()) / 1000;

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }
  return formatter.format(Math.round(deltaSeconds), 'second');
}

/** `MAINTENANCE` -> `Maintenance`, `PLUGIN_HYBRID` -> `Plugin hybrid`. */
export function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * A typed amount to minor units, and back.
 *
 * The exponent comes from `@vehicle-os/domain`, which is the same table the server stores
 * against — a second lookup here could disagree with it, and a form that writes 2500 where
 * the server expects 25 is a hundredfold error that still looks like money.
 */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** minorUnitExponent(currency));
}

export function fromMinorUnits(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** minorUnitExponent(currency);
}

/** Money for an axis or a tight label: `€84K`, `€1.2M`. Intl's compact notation, per currency. */
export function formatMoneyCompact(
  amountMinor: number,
  currency: string,
  locale = 'en-US',
): string {
  const formatter = cached(
    `money-compact|${locale}|${currency}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        notation: 'compact',
        // Two figures is what an axis needs: `€910`, `€7.3K`, never `€906.5`.
        maximumSignificantDigits: 2,
      }),
  );
  return formatter.format(fromMinorUnits(amountMinor, currency));
}
