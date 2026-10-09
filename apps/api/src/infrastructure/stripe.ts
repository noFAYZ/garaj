/**
 * The payment provider, behind one adapter (GAPS §17).
 *
 * Same shape as `ai-port.ts` and `fx.ts`: everything vendor-specific is in this file, so the
 * routes talk about plans and checkouts rather than about Stripe, and a second provider — or
 * a test — replaces one module instead of a feature.
 *
 * Absent configuration is not an error here. A deployment with no `STRIPE_SECRET_KEY` runs
 * the whole product on the free plan and reports billing as unavailable, which is what the
 * `billing` flag already says; failing at boot would make a payment provider a hard
 * dependency of a garage log.
 */

import Stripe from 'stripe';
import { env } from '@vehicle-os/config';
import type { PlanTier } from '@vehicle-os/domain';
import { ServiceUnavailableError } from './errors';

let client: Stripe | null = null;

/** The configured client, or null when this deployment has no payment provider. */
export function stripe(): Stripe | null {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) return null;
  // One client for the process: it holds a connection pool, and building one per request is
  // a new TLS handshake on the path a person is waiting on.
  client ??= new Stripe(key, { apiVersion: '2026-08-26.dahlia' });
  return client;
}

export function requireStripe(): Stripe {
  const configured = stripe();
  if (!configured) {
    throw new ServiceUnavailableError('Billing is not configured on this deployment', 'NO_BILLING');
  }
  return configured;
}

/**
 * Which price a tier checks out against.
 *
 * Read from configuration rather than taken from the request. A price id in a request body is
 * a price the caller chose, and every account would quickly discover the cheapest one.
 */
export function priceFor(plan: Exclude<PlanTier, 'FREE'>): string {
  const price = plan === 'PLUS' ? env().STRIPE_PRICE_PLUS : env().STRIPE_PRICE_BUSINESS;
  if (!price) {
    throw new ServiceUnavailableError(`No price configured for the ${plan} plan`, 'NO_PRICE');
  }
  return price;
}

export interface ResolvedPrice {
  readonly amountMinor: number;
  readonly currency: string;
  readonly interval: string;
  readonly intervalCount: number;
}

const PRICE_TTL_MS = 60 * 60 * 1000;
const priceCache = new Map<string, { value: ResolvedPrice | null; at: number }>();

/**
 * A tier's price as the provider holds it, or null when there is none to show.
 *
 * Cached for an hour per process: the upgrade screen opens far more often than prices change,
 * and a provider round trip on every open would put its latency in front of the one screen that
 * must feel instant. A failed read is cached too, briefly — as null, never as an error — so an
 * outage at the provider degrades the screen to "no price shown" instead of breaking it.
 */
export async function resolvePrice(plan: Exclude<PlanTier, 'FREE'>): Promise<ResolvedPrice | null> {
  const client = stripe();
  const priceId = plan === 'PLUS' ? env().STRIPE_PRICE_PLUS : env().STRIPE_PRICE_BUSINESS;
  if (!client || !priceId) return null;

  const cached = priceCache.get(priceId);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.value;

  let value: ResolvedPrice | null = null;
  try {
    const price = await client.prices.retrieve(priceId);
    if (price.unit_amount !== null && price.recurring) {
      value = {
        amountMinor: price.unit_amount,
        currency: price.currency.toUpperCase(),
        interval: price.recurring.interval,
        intervalCount: price.recurring.interval_count,
      };
    }
  } catch {
    // Reported as no price rather than as a failure; see above.
    value = null;
  }
  priceCache.set(priceId, { value, at: Date.now() });
  return value;
}

/**
 * Which tier a subscription's price belongs to — the reverse of `priceFor`.
 *
 * Returns null for a price this deployment does not know, which is a real case: a plan sold
 * last year, or a webhook from another environment sharing the account. A null is reported
 * and ignored, never guessed at — guessing would upgrade someone for free or downgrade
 * someone who paid.
 */
export function planForPrice(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  if (priceId === env().STRIPE_PRICE_PLUS) return 'PLUS';
  if (priceId === env().STRIPE_PRICE_BUSINESS) return 'BUSINESS';
  return null;
}

/**
 * The provider's status vocabulary, in ours.
 *
 * `unpaid` maps to `PAST_DUE` rather than `CANCELED`: the provider has stopped retrying but
 * has not ended the subscription, and the person still has an account they can fix. Anything
 * unrecognised reads as `INCOMPLETE`, which grants nothing — the safe direction to be wrong in
 * when a provider adds a status we have never seen.
 */
export function toSubscriptionStatus(status: string): SubscriptionStatusName {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
    case 'unpaid':
      return 'PAST_DUE';
    case 'canceled':
      return 'CANCELED';
    default:
      return 'INCOMPLETE';
  }
}

type SubscriptionStatusName = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';
