import { minorUnitExponent } from '@vehicle-os/domain';

/** `PLUGIN_HYBRID` -> `Plugin hybrid`. The same rule the web uses, four lines of it. */
export function humanise(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/*
 * `Intl` formatters are expensive to build and these run once per row in every list, so each
 * is built once. `toLocaleString` builds a fresh one internally on every call.
 */
const distanceFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
// ponytail: unbounded map, but keyed by currency — a handful of entries in practice.
const moneyFormats = new Map<string, Intl.NumberFormat>();

/** Whole units only: nobody reads an odometer to two decimal places. */
export function formatDistance(value: number | null, unit: string | null): string {
  if (value === null) return '—';
  return `${distanceFormat.format(value)} ${unit === 'MI' ? 'mi' : 'km'}`;
}

/**
 * Money, in its own currency, never converted.
 *
 * `Intl` knows each currency's exponent, so JPY (0 decimals) and KWD (3) scale correctly
 * from minor units — the same rule the web uses.
 */
export function formatMoney(
  money: { amountMinor: number; currency: string } | null,
  /** Whole units, for a figure read at a glance — ledgers keep the cents. */
  whole = false,
): string {
  if (!money) return '—';
  const key = `${money.currency}|${whole}`;
  let formatter = moneyFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: money.currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    moneyFormats.set(key, formatter);
  }
  return formatter.format(money.amountMinor / 10 ** minorUnitExponent(money.currency));
}

/**
 * A typed amount to minor units, for the currency it is in.
 *
 * The exponent comes from `@vehicle-os/domain`, the same table the server stores against —
 * 25 JPY is 25 and 25 USD is 2500. A flat `× 100` bills a yen amount a hundredfold, and the
 * result still looks like money.
 */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 10 ** minorUnitExponent(currency));
}

/** Money for an axis or a tight label: `€84k`, `€1.2M` — whole units below a thousand. */
export function compactMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 10 ** minorUnitExponent(currency);
  const symbol = formatMoney({ amountMinor: 0, currency }, true).replace(/[\d\s.,]/g, '');
  const size = Math.abs(major);
  const figure =
    size >= 1_000_000
      ? `${(major / 1_000_000).toFixed(size >= 10_000_000 ? 0 : 1)}M`
      : size >= 1_000
        ? `${(major / 1_000).toFixed(size >= 10_000 ? 0 : 1)}k`
        : String(Math.round(major));
  return `${symbol}${figure}`;
}
