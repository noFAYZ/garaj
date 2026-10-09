import { Type, type Static } from '@sinclair/typebox';
import { ACCOUNT_KINDS, ENTITLEMENTS, PLAN_TIERS, SUBSCRIPTION_STATUSES } from '@vehicle-os/domain';
import { IsoDateTime, Nullable } from './common';

export const AccountKind = Type.Union(ACCOUNT_KINDS.map((kind) => Type.Literal(kind)));
export const PlanTier = Type.Union(PLAN_TIERS.map((tier) => Type.Literal(tier)));
export const SubscriptionStatus = Type.Union(
  SUBSCRIPTION_STATUSES.map((status) => Type.Literal(status)),
);

/**
 * What the caller's account may do, and how much of it is left (GAPS §10).
 *
 * One response rather than a plan name the client maps to features itself: the mapping is in
 * `@vehicle-os/domain` and the two would drift the first time a tier changed. The client
 * greys things out from `entitlements`; the server refuses them again regardless.
 *
 * `usage` is here so a limit can be shown *before* it is hit — "2 of 3 vehicles" on the add
 * button is a different product from a 409 after filling in a form.
 */
export const PlanState = Type.Object({
  plan: PlanTier,
  status: SubscriptionStatus,
  accountKind: AccountKind,
  /** Everything this plan includes, as `@vehicle-os/domain` defines it. */
  entitlements: Type.Array(Type.Union(ENTITLEMENTS.map((name) => Type.Literal(name)))),
  limits: Type.Object({
    vehicles: Type.Integer(),
    garages: Type.Integer(),
    members: Type.Integer(),
  }),
  /** What the account has now, counted the same way the ceilings are enforced. */
  usage: Type.Object({
    vehicles: Type.Integer(),
    garages: Type.Integer(),
  }),
  /** When the paid period ends; null on a free plan, which has no period. */
  currentPeriodEnd: Nullable(IsoDateTime),
  cancelAtPeriodEnd: Type.Boolean(),
});
export type PlanState = Static<typeof PlanState>;

/** Switching what the product is *for*. Never switches what it costs. */
export const UpdateAccountKind = Type.Object(
  { accountKind: AccountKind },
  { additionalProperties: false },
);
export type UpdateAccountKind = Static<typeof UpdateAccountKind>;

/**
 * Starting a checkout. The client names the tier; the price id lives on the server, because
 * a price that arrives in a request body is a price the caller chose.
 */
export const StartCheckout = Type.Object(
  {
    plan: Type.Union([Type.Literal('PLUS'), Type.Literal('BUSINESS')]),
    /**
     * Where the provider returns the person to: a path on the web app, or the mobile app's own
     * link (`vehicleos://…`, or Expo Go's outside production). Anything else becomes /settings.
     */
    returnPath: Type.Optional(Type.String({ maxLength: 512 })),
  },
  { additionalProperties: false },
);
export type StartCheckout = Static<typeof StartCheckout>;

/**
 * Moving to a smaller plan. `FREE` cancels at the end of the paid period; a smaller paid tier
 * switches now, the unused time credited to the next bill. Going up is a checkout, not this.
 */
export const Downgrade = Type.Object(
  { plan: Type.Union([Type.Literal('FREE'), Type.Literal('PLUS')]) },
  { additionalProperties: false },
);
export type Downgrade = Static<typeof Downgrade>;

export const CheckoutSession = Type.Object({ url: Type.String() });
export type CheckoutSession = Static<typeof CheckoutSession>;

/** One tier's price, as the provider holds it. */
export const PlanPrice = Type.Object({
  amountMinor: Type.Integer(),
  currency: Type.String(),
  /** `month` or `year` — whatever the configured price recurs on. */
  interval: Type.String(),
  intervalCount: Type.Integer(),
});
export type PlanPrice = Static<typeof PlanPrice>;

/**
 * What each paid tier costs, read from the provider rather than written into a client.
 *
 * A price hard-coded in an app is wrong the day it changes and stays wrong on every phone that
 * has not updated. Null for a tier when billing is not configured, or its price could not be
 * read: the upgrade screen then shows the plan without a number rather than a stale one.
 */
export const PlanPrices = Type.Object({
  PLUS: Nullable(PlanPrice),
  BUSINESS: Nullable(PlanPrice),
});
export type PlanPrices = Static<typeof PlanPrices>;
