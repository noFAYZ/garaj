/**
 * Entitlements: what a plan includes (Architecture.md §13 extends to billing).
 *
 * This is the second of two questions every gated request asks. `authz.ts` answers *may this
 * person do it here* from their role; this answers *is it included in what was paid for*.
 * Both must pass, and they fail differently on purpose: a missing capability is 403 and will
 * never change by itself, a missing entitlement is 402 and is fixed by upgrading.
 *
 * Keeping them apart is what stops "owner" quietly meaning "paid". An owner of a free garage
 * has `billing.manage` — that is how they upgrade — and still cannot open a passport link.
 *
 * Pure and shared with the clients, so a phone can grey out what the server would refuse.
 * That is a courtesy: the routes check again, because a client is not a security boundary.
 */

import type { AccountKind, PlanTier, SubscriptionStatus } from './enums';
import { minorUnitExponent } from './money';

/**
 * The paid features, named as what they let you do.
 *
 * Deliberately short. Everything a person needs to *keep their own records* — logging fuel,
 * charge, services, costs, documents, photos, the importer and the export — is free at every
 * tier, because a product that holds your history hostage is one you should not have trusted
 * with it (PRD §6.5). What is paid for is scale, and the work that is done *for* you: the
 * shareable passport, and the business reporting a sole trader bills against.
 *
 * Analytics is not here on purpose. Charts read rows that are already yours.
 */
export const ENTITLEMENTS = [
  /** Publish a vehicle's history as a shareable, revocable link. */
  'passport.share',
  /** Record what a vehicle earned, and report profit rather than only cost. */
  'income.track',
  /** The period mileage report — quarter or tax year, with the rate used, as CSV or PDF. */
  'mileage.report',
  /** Name which member drove a trip, and report per driver. */
  'driver.assign',
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

/**
 * Each paid feature as a person reads it: its name, and what it does in one line. Shared by
 * the web and the phone, so a feature is never called two things.
 */
export const ENTITLEMENT_COPY: Readonly<Record<Entitlement, { name: string; does: string }>> =
  Object.freeze({
    'passport.share': {
      name: 'Vehicle passport',
      does: 'Share a vehicle’s full history as a link you can revoke.',
    },
    'income.track': {
      name: 'Income & profit',
      does: 'Log what a vehicle earns and see its profit.',
    },
    'mileage.report': {
      name: 'Mileage reports',
      does: 'Business-trip totals and tax deductions for any period.',
    },
    'driver.assign': {
      name: 'Driver earnings',
      does: 'Assign trips to drivers and see what each one earned.',
    },
  });

/**
 * A recurring price as it is said: `{ amount: '$2.99', per: 'mo' }`. Whole amounts drop the
 * `.00`, and the minor unit comes from the currency, so ¥500 is not read as ¥5.
 */
export function formatPlanPrice(
  price: { amountMinor: number; currency: string; interval: string; intervalCount: number },
  locale?: string,
): { amount: string; per: string } {
  const major = price.amountMinor / 10 ** minorUnitExponent(price.currency);
  const amount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: price.currency,
    ...(Number.isInteger(major) ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
  }).format(major);
  const unit =
    ({ day: 'day', week: 'wk', month: 'mo', year: 'yr' } as Record<string, string>)[
      price.interval
    ] ?? price.interval;
  return { amount, per: price.intervalCount > 1 ? `${price.intervalCount} ${unit}` : unit };
}

/** What each tier includes. A tier includes everything the tier below it does. */
const TIER_GRANTS: Readonly<Record<PlanTier, readonly Entitlement[]>> = Object.freeze({
  FREE: [],
  PLUS: ['passport.share'],
  BUSINESS: ['income.track', 'mileage.report', 'driver.assign'],
});

/**
 * What each tier is called to a person. The enum is for code: "Your FREE plan" reads as a
 * shouted error code, and every message that names a plan — server or client — takes it from
 * here so they cannot drift into two spellings.
 */
export const PLAN_NAMES: Readonly<Record<PlanTier, string>> = Object.freeze({
  FREE: 'Free',
  PLUS: 'Plus',
  BUSINESS: 'Business',
});

/** Cheapest first, so "is this at least PLUS" is a comparison rather than a list of ors. */
export const PLAN_RANK: Readonly<Record<PlanTier, number>> = Object.freeze({
  FREE: 0,
  PLUS: 1,
  BUSINESS: 2,
});

/**
 * How much of the product a tier holds.
 *
 * Per person, not per garage: the subscription is on the account, so someone cannot buy one
 * PLUS plan and spread twelve vehicles over six free garages. A garage's own limits come from
 * whoever owns it, which is also who is billed for it.
 *
 * `members` counts the people in one garage, the owner included — an invitation that would
 * take a garage past it is refused at the invite, not at the accept, so the person invited
 * never sees a door close in their face.
 */
export interface PlanLimits {
  readonly vehicles: number;
  readonly garages: number;
  readonly members: number;
}

export const PLAN_LIMITS: Readonly<Record<PlanTier, PlanLimits>> = Object.freeze({
  FREE: { vehicles: 3, garages: 1, members: 2 },
  PLUS: { vehicles: 6, garages: 3, members: 5 },
  BUSINESS: { vehicles: 100, garages: 25, members: 25 },
});

const ENTITLEMENTS_BY_TIER: Readonly<Record<PlanTier, ReadonlySet<Entitlement>>> = Object.freeze({
  FREE: new Set(TIER_GRANTS.FREE),
  PLUS: new Set([...TIER_GRANTS.FREE, ...TIER_GRANTS.PLUS]),
  BUSINESS: new Set([...TIER_GRANTS.FREE, ...TIER_GRANTS.PLUS, ...TIER_GRANTS.BUSINESS]),
});

/** A subscription as anything that needs to reason about one sees it. */
export interface SubscriptionSnapshot {
  readonly plan: PlanTier;
  readonly status: SubscriptionStatus;
}

/**
 * What a subscription is actually worth right now.
 *
 * A row says which plan was bought; this says which one applies. `INCOMPLETE` never took
 * payment, and `CANCELED` has stopped — both read as free. `PAST_DUE` keeps its plan: the
 * provider is still retrying the card, and locking someone out of their own service history
 * over a card that expired on Tuesday is how a renewal becomes a cancellation.
 *
 * No subscription row at all is the common case, and it is free rather than an error.
 */
export function effectivePlan(subscription: SubscriptionSnapshot | null | undefined): PlanTier {
  if (!subscription) return 'FREE';
  if (subscription.status === 'CANCELED' || subscription.status === 'INCOMPLETE') return 'FREE';
  return subscription.plan;
}

export function hasEntitlement(plan: PlanTier, entitlement: Entitlement): boolean {
  return ENTITLEMENTS_BY_TIER[plan].has(entitlement);
}

/** Everything a plan includes, for a client that wants to grey out the rest. */
export function entitlementsFor(plan: PlanTier): readonly Entitlement[] {
  return [...ENTITLEMENTS_BY_TIER[plan]];
}

/** The cheapest tier that includes this, for an upgrade prompt that names a plan. */
export function tierForEntitlement(entitlement: Entitlement): PlanTier {
  const tier = (['FREE', 'PLUS', 'BUSINESS'] as const).find((candidate) =>
    ENTITLEMENTS_BY_TIER[candidate].has(entitlement),
  );
  // Every entitlement is granted by some tier; the fallback keeps the type honest rather
  // than asserting, so a new entitlement added without a grant reads as "business only"
  // instead of throwing inside a request.
  return tier ?? 'BUSINESS';
}

export function limitsFor(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan];
}

/**
 * The cheapest tier that would hold `count` of something, or null when nothing does.
 *
 * So the wall can say "PLUS holds six" rather than "limit reached", which is the difference
 * between a prompt someone can act on and one they close.
 */
export function tierForCount(limit: keyof PlanLimits, count: number): PlanTier | null {
  return (
    (['FREE', 'PLUS', 'BUSINESS'] as const).find((tier) => PLAN_LIMITS[tier][limit] >= count) ??
    null
  );
}

/**
 * Whether the business surfaces apply — the trip purpose, the income line, the driver.
 *
 * Kind, not plan. What someone is *doing* decides whether a field belongs on their form;
 * what they *paid* decides whether the server will store it. A personal account on a business
 * plan sees a clean form; a business account on a free plan sees the fields and an upgrade
 * prompt, which is the honest order — the ask comes after the need is visible.
 */
export function showsBusinessSurfaces(kind: AccountKind): boolean {
  return kind === 'BUSINESS';
}
