/**
 * RevenueCat: what a person bought in a phone's store (Google Play now, the App Store later).
 *
 * Same shape as `stripe.ts` — everything vendor-specific is here, and the routes talk about
 * plans. The phone buys through RevenueCat's SDK with the account's own id as RevenueCat's app
 * user id, so "what does this account own" is one question to RevenueCat's API, asked with the
 * secret key. Nothing the phone says about a purchase is ever taken on its word.
 *
 * The store side is set up in RevenueCat, not here: an entitlement per paid tier, whose lookup
 * keys are `plus` and `business`, attached to the Play subscriptions and to any one-time
 * ("lifetime") product. A product attached to neither grants nothing.
 */

import { env } from '@vehicle-os/config';
import type { PlanTier, SubscriptionStatus } from '@vehicle-os/domain';

const API = 'https://api.revenuecat.com/v2';

/** The entitlement lookup keys set in RevenueCat, and the tier each one is. */
const TIER_OF: Readonly<Record<string, Exclude<PlanTier, 'FREE'>>> = {
  plus: 'PLUS',
  business: 'BUSINESS',
};
const RANK: Readonly<Record<Exclude<PlanTier, 'FREE'>, number>> = { PLUS: 1, BUSINESS: 2 };

/** What the account owns in the store right now, as the plan row records it. */
export interface StoreAccess {
  readonly plan: Exclude<PlanTier, 'FREE'>;
  readonly status: SubscriptionStatus;
  /** When the paid period ends; null for a one-time purchase, which does not. */
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  /** `PLAY_STORE`, `APP_STORE`, … — where it was bought, so the app sends people there. */
  readonly store: string | null;
  readonly managementUrl: string | null;
}

interface EntitlementList {
  readonly items: readonly { readonly lookup_key: string }[];
}

interface RcSubscription {
  readonly gives_access: boolean;
  readonly status: string;
  readonly auto_renewal_status: string;
  readonly current_period_ends_at: number | null;
  readonly store: string;
  readonly management_url: string | null;
  readonly entitlements: EntitlementList;
}

interface RcPurchase {
  readonly status: string;
  readonly store: string;
  readonly entitlements: EntitlementList;
}

interface RcList<T> {
  readonly items: readonly T[];
}

/** Whether this deployment can ask RevenueCat anything. */
export function revenuecatConfigured(): boolean {
  const config = env();
  return Boolean(config.REVENUECAT_SECRET_KEY && config.REVENUECAT_PROJECT_ID);
}

/** One call to RevenueCat; null for a customer it has never seen (a 404). */
async function call<T>(method: 'GET' | 'DELETE', path: string): Promise<T | null> {
  const config = env();
  const response = await fetch(
    `${API}/projects/${encodeURIComponent(config.REVENUECAT_PROJECT_ID!)}${path}`,
    {
      method,
      headers: { authorization: `Bearer ${config.REVENUECAT_SECRET_KEY!}` },
      // In front of a person waiting on their plan: a stalled call must end, not hang the request.
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`RevenueCat ${method} ${path} returned ${response.status}: ${detail}`);
  }
  return method === 'DELETE' ? null : ((await response.json()) as T);
}

/** The highest tier among an item's entitlements, or null when it grants none of ours. */
function tierOf(entitlements: EntitlementList): Exclude<PlanTier, 'FREE'> | null {
  let best: Exclude<PlanTier, 'FREE'> | null = null;
  for (const { lookup_key } of entitlements.items) {
    const tier = TIER_OF[lookup_key];
    if (tier && (!best || RANK[tier] > RANK[best])) best = tier;
  }
  return best;
}

/**
 * RevenueCat's subscription state, in ours. Only ones that still give access get here; a grace
 * period is a failed renewal the store is still retrying, so access holds and it reads as past
 * due, the way Stripe's retries do.
 */
function statusOf(subscription: RcSubscription): SubscriptionStatus {
  if (subscription.status === 'trialing') return 'TRIALING';
  if (subscription.status === 'in_grace_period' || subscription.status === 'in_billing_retry') {
    return 'PAST_DUE';
  }
  return 'ACTIVE';
}

/**
 * What the account owns in the store: the best of its live subscriptions and its one-time
 * purchases, or null when it owns nothing (or RevenueCat has never heard of it).
 *
 * The highest tier wins; at the same tier a one-time purchase wins, since it never runs out.
 */
export async function storeAccessOf(userId: string): Promise<StoreAccess | null> {
  const customer = `/customers/${encodeURIComponent(userId)}`;
  const [subscriptions, purchases] = await Promise.all([
    call<RcList<RcSubscription>>('GET', `${customer}/subscriptions?limit=100`),
    call<RcList<RcPurchase>>('GET', `${customer}/purchases?limit=100`),
  ]);

  let best: StoreAccess | null = null;
  const consider = (candidate: StoreAccess) => {
    if (!best || RANK[candidate.plan] > RANK[best.plan]) best = candidate;
  };

  for (const purchase of purchases?.items ?? []) {
    const plan = purchase.status === 'owned' ? tierOf(purchase.entitlements) : null;
    if (!plan) continue;
    consider({
      plan,
      status: 'ACTIVE',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      store: purchase.store.toUpperCase(),
      managementUrl: null,
    });
  }
  for (const subscription of subscriptions?.items ?? []) {
    const plan = subscription.gives_access ? tierOf(subscription.entitlements) : null;
    if (!plan) continue;
    consider({
      plan,
      status: statusOf(subscription),
      currentPeriodEnd:
        subscription.current_period_ends_at === null
          ? null
          : new Date(subscription.current_period_ends_at),
      // Turned off renewal, or set to pause: either way access stops when the period does.
      cancelAtPeriodEnd:
        subscription.auto_renewal_status === 'will_not_renew' ||
        subscription.auto_renewal_status === 'will_pause',
      store: subscription.store.toUpperCase(),
      managementUrl: subscription.management_url,
    });
  }
  return best;
}

/**
 * Forget the account at RevenueCat, for a deleted account. It does not cancel a store
 * subscription — only the store can — which is why the app tells the person to cancel first.
 */
export async function deleteStoreCustomer(userId: string): Promise<void> {
  await call('DELETE', `/customers/${encodeURIComponent(userId)}`);
}

/** "Google Play", "the App Store" — how a store is named in a sentence. */
export function storeName(store: string | null | undefined): string {
  if (store === 'PLAY_STORE') return 'Google Play';
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'the App Store';
  return 'the app store you bought it in';
}
