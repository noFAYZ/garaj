/**
 * Money (Architecture.md §16).
 *
 * Amounts are stored as an integer count of the currency's minor unit plus an ISO 4217
 * code. Never a float: `0.1 + 0.2 !== 0.3`, and a cost-per-kilometre report built on
 * accumulated float error is wrong in a way nobody notices until it is quoted to a buyer.
 *
 * `amountMinor` is a JS `number`, not a `bigint`. The column is `bigint` so the database
 * never truncates, but a safe integer holds ±9.0e15 minor units — 90 trillion dollars —
 * and `bigint` does not survive `JSON.stringify`. The guard below is what makes that safe:
 * anything outside the safe range throws instead of silently rounding.
 */

export type CurrencyCode = string;

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/*
 * Intl already ships the ISO 4217 minor-unit table, so the exponent is looked up rather
 * than hardcoded to 2. Hardcoding breaks JPY and KRW (0 decimals) and KWD/BHD/TND (3):
 * ¥1000 stored as 100000 would display as ¥1,000.00 and be off by a factor of 100.
 */
const exponentCache = new Map<string, number>();

export function minorUnitExponent(currency: CurrencyCode): number {
  const code = currency.toUpperCase();
  const cached = exponentCache.get(code);
  if (cached !== undefined) return cached;

  assertCurrency(code);
  let exponent: number;
  try {
    exponent =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    throw new MoneyError(`Unknown currency code: ${currency}`);
  }
  exponentCache.set(code, exponent);
  return exponent;
}

/*
 * The set of codes the runtime can actually format, straight from ICU. A pattern check
 * alone lets "XYZ" through — it is well-formed and utterly meaningless — and an amount
 * stored in a currency nothing can format is a row that can never be displayed or summed.
 * Built once, lazily, because `supportedValuesOf` allocates a ~300-entry array.
 *
 * Hermes — the phone's engine — has no `Intl.supportedValuesOf`, and calling it crashed every
 * mobile screen that formats money. Without it the pattern check stands alone there: the phone
 * only formats amounts the server already validated with the full list.
 */
let knownCurrencies: Set<string> | null | undefined;

function isKnownCurrency(code: string): boolean {
  if (knownCurrencies === undefined) {
    knownCurrencies =
      typeof Intl.supportedValuesOf === 'function'
        ? new Set(Intl.supportedValuesOf('currency'))
        : null;
  }
  return knownCurrencies === null || knownCurrencies.has(code);
}

export function assertCurrency(currency: CurrencyCode): asserts currency is CurrencyCode {
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new MoneyError(`Currency must be a 3-letter ISO 4217 code, received: ${currency}`);
  }
  if (!isKnownCurrency(currency)) {
    throw new MoneyError(`Unknown ISO 4217 currency code: ${currency}`);
  }
}

function assertSafeMinor(amountMinor: number): void {
  if (!Number.isInteger(amountMinor)) {
    throw new MoneyError(`amountMinor must be an integer, received: ${amountMinor}`);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyError(`amountMinor exceeds safe integer range: ${amountMinor}`);
  }
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  const code = currency.toUpperCase();
  assertCurrency(code);
  assertSafeMinor(amountMinor);
  return Object.freeze({ amountMinor, currency: code });
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/**
 * Rounds a scaled amount to a whole minor unit, half away from zero.
 *
 * The epsilon nudge is doing real work. `1.005 * 100` evaluates to 100.49999999999999,
 * because the double nearest to 1.005 is fractionally below it — so a bare `Math.round`
 * returns 100 and quietly loses a cent. Widening the magnitude by one ulp before rounding
 * recovers the decimal the user actually typed.
 *
 * The trade-off: a value genuinely one ulp below a .5 boundary now rounds up. That is the
 * right way to be wrong here, because this function exists to translate human-entered
 * amounts, and the API boundary accepts minor units directly (see `money`) — no value that
 * arrived over the wire ever passes through this path.
 */
function roundToMinorUnit(scaled: number): number {
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) * (1 + Number.EPSILON));
  // `Math.sign(-0.4) * Math.round(0.4)` is -0, which survives into JSON as "-0".
  return rounded + 0;
}

/** Build from a human-scale amount, e.g. `fromMajor(12.5, 'USD')` -> 1250 minor units. */
export function fromMajor(amountMajor: number, currency: CurrencyCode): Money {
  if (!Number.isFinite(amountMajor)) {
    throw new MoneyError(`amountMajor must be finite, received: ${amountMajor}`);
  }
  const factor = 10 ** minorUnitExponent(currency);
  return money(roundToMinorUnit(amountMajor * factor), currency);
}

export function toMajor(value: Money): number {
  return value.amountMinor / 10 ** minorUnitExponent(value.currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      `Cannot combine ${a.currency} with ${b.currency}. Convert explicitly with a dated rate.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function negate(value: Money): Money {
  return money(-value.amountMinor, value.currency);
}

export function multiply(value: Money, factor: number): Money {
  if (!Number.isFinite(factor)) {
    throw new MoneyError(`factor must be finite, received: ${factor}`);
  }
  return money(roundToMinorUnit(value.amountMinor * factor), value.currency);
}

/**
 * Sums same-currency amounts. Returns `null` for an empty list rather than guessing a
 * currency — "zero of what?" has no correct default, and a caller that assumes USD will
 * mislabel every other user's garage total.
 */
export function sum(values: readonly Money[]): Money | null {
  const [first, ...rest] = values;
  if (!first) return null;
  return rest.reduce(add, first);
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0;
}

export function format(value: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: value.currency,
  }).format(toMajor(value));
}
