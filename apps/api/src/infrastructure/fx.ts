/**
 * Exchange rates, for reporting only.
 *
 * Nothing here ever touches a stored amount. An expense is kept in the currency it was paid
 * in, forever — the rates below exist so a summary can say "and about $680 more, in euros"
 * instead of leaving the reader to do it themselves. The stated figures stay reproducible
 * because the date the rates came from is published beside them (§103).
 *
 * `fetch` rather than a client library, as with every other outbound call here: the response
 * is one JSON document.
 */

import { minorUnitExponent, type CurrencyCode } from '@vehicle-os/domain';

export interface FxRates {
  /** Every rate is "one unit of base buys this much". */
  readonly base: string;
  /** When the provider published them, ISO 8601. Quoted to the user beside the figure. */
  readonly asOf: string;
  readonly rates: Readonly<Record<string, number>>;
}

interface FxResponse {
  success?: boolean;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
}

/*
 * Rates move on a daily cycle and these figures are a rounded aside, not a settlement price,
 * so an hour-old rate is indistinguishable from a fresh one in the only place it is shown.
 *
 * ponytail: one in-process cache, which means one fetch per hour per instance rather than
 * per fleet. A shared cache in Postgres or Redis if the instance count ever makes that rude
 * to the provider.
 */
const TTL_MS = 60 * 60 * 1000;

let cache: { at: number; value: FxRates } | null = null;
/** In-flight request, so a burst of cost requests on a cold cache makes one call, not twenty. */
let inFlight: Promise<FxRates | null> | null = null;

/** Test seam: integration tests must not reach the provider, and must not be clock-dependent. */
export function __setFxCache(value: FxRates | null, at = Date.now()): void {
  cache = value === null ? null : { at, value };
  inFlight = null;
}

/**
 * The latest rates, or null when they cannot be had.
 *
 * Null is a normal answer, not an error: the provider being down means a summary omits its
 * "about $680" aside for an hour. Failing the whole cost request over it would take the
 * figures the user actually asked for down with it.
 */
export async function latestRates(url: string, log?: { warn: (o: object, m: string) => void }) {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = fetchRates(url)
    .then((value) => {
      if (value) cache = { at: Date.now(), value };
      return value;
    })
    .catch((error: unknown) => {
      log?.warn({ err: error }, 'Could not fetch exchange rates; totals will omit conversions');
      // The stale rates outlive their TTL rather than nothing at all: yesterday's rate is a
      // far better approximation than dropping the figure the moment the provider blinks.
      return cache?.value ?? null;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchRates(url: string): Promise<FxRates | null> {
  // Without a deadline a hanging provider hangs every cost request behind it.
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error(`Exchange rate provider returned ${response.status}`);

  const body = (await response.json()) as FxResponse;
  if (!body.rates || !body.base) throw new Error('Exchange rate provider returned no rates');

  return { base: body.base, asOf: body.date ?? new Date().toISOString(), rates: body.rates };
}

/**
 * `amountMinor` of `from`, expressed in `to`.
 *
 * Null when either currency is missing from the table — the provider quotes crypto and a
 * long tail of minor currencies, but a summary in a currency it has never heard of must say
 * nothing rather than guess at 1:1.
 *
 * Via the base currency, because the table is quoted against one: dividing out of `from` and
 * multiplying into `to` is the only route the data supports. Minor units are converted
 * through the major amount, since the exponents differ — 1000 JPY is ¥1000 and 1000 USD is
 * $10, and treating them as the same number is off by a hundred.
 */
export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: FxRates,
): number | null {
  if (from === to) return amountMinor;

  const fromRate = from === rates.base ? 1 : rates.rates[from];
  const toRate = to === rates.base ? 1 : rates.rates[to];
  if (!fromRate || !toRate) return null;

  const major = amountMinor / 10 ** minorUnitExponent(from);
  return Math.round((major / fromRate) * toRate * 10 ** minorUnitExponent(to));
}
