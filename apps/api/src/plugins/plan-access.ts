/**
 * Entitlement resolution (GAPS §10).
 *
 * The sibling of `actor-context`: that one answers *may this person do it here*, this one
 * answers *is it included in what was paid for*. A gated route asks both, and they fail
 * differently on purpose — 403 for a door that will not open, 402 for one with a price.
 *
 * **The subscription is on the account, and a garage's entitlements are its owner's.** A
 * member of someone's Business fleet gets that fleet's features inside it and their own free
 * plan at home, which is the only reading that does not either make membership a way to buy
 * nothing or make every collaborator pay twice. `garages.owner_id` is the billed party, and
 * it moves with ownership transfer — so the garage a person hands over stops costing them.
 *
 * Every lookup is cached on the request. A route that checks an entitlement and then a limit
 * would otherwise read the same two rows twice, and this sits in front of hot endpoints.
 */

import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  effectivePlan,
  hasEntitlement,
  limitsFor,
  PLAN_NAMES,
  tierForCount,
  tierForEntitlement,
  type AccountKind,
  type Entitlement,
  type PlanLimits,
  type PlanTier,
} from '@vehicle-os/domain';
import { NotFoundError, PaymentRequiredError, PlanLimitError } from '../infrastructure/errors';

/** What a plan check needs to know about the person being billed. */
export interface PlanContext {
  readonly userId: string;
  readonly plan: PlanTier;
  readonly accountKind: AccountKind;
  readonly limits: PlanLimits;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Per-request memo: user id → resolved plan. Populated by the helpers below. */
    planCache?: Map<string, PlanContext>;
    /** Per-request memo: garage id → the user id billed for it. */
    garageOwnerCache?: Map<string, string>;
  }

  interface FastifyInstance {
    /** The plan of a given account. A user with no subscription row is free, not an error. */
    planFor: (request: FastifyRequest, userId: string) => Promise<PlanContext>;
    /** The plan that governs a garage: whoever owns it is whoever is billed for it. */
    planForGarage: (request: FastifyRequest, garageId: string) => Promise<PlanContext>;
    /**
     * Refuse unless the garage's plan includes this. Returns the plan, because a route that
     * checked one entitlement usually wants the tier for the next decision too.
     */
    requireEntitlement: (
      request: FastifyRequest,
      entitlement: Entitlement,
      garageId: string,
    ) => Promise<PlanContext>;
    /** The same check against the caller's own account, for routes with no garage in scope. */
    requireOwnEntitlement: (
      request: FastifyRequest,
      entitlement: Entitlement,
    ) => Promise<PlanContext>;
  }
}

/**
 * One more of something than the plan holds.
 *
 * `current` is what exists now, so the caller is adding the `current + 1`-th. Phrased as a
 * count rather than a boolean because the message has to say the number — "3 of 3 vehicles"
 * is actionable and "limit reached" is not.
 */
export function assertWithinLimit(
  plan: PlanContext,
  limit: keyof PlanLimits,
  current: number,
  noun: string,
): void {
  const allowed = plan.limits[limit];
  if (current < allowed) return;

  const upgrade = tierForCount(limit, current + 1);
  throw new PlanLimitError(
    limit,
    allowed,
    upgrade && upgrade !== plan.plan ? upgrade : null,
    upgrade && upgrade !== plan.plan
      ? `Your ${PLAN_NAMES[plan.plan]} plan holds ${allowed} ${noun}. ${PLAN_NAMES[upgrade]} holds ${limitsFor(upgrade)[limit]}.`
      : `Your ${PLAN_NAMES[plan.plan]} plan holds ${allowed} ${noun}.`,
  );
}

export default fp(
  (fastify) => {
    const planFor = async (request: FastifyRequest, userId: string): Promise<PlanContext> => {
      request.planCache ??= new Map();
      const known = request.planCache.get(userId);
      if (known) return known;

      /*
       * One read, both rows outer-joined off the user. Against a hosted Postgres the cost is
       * the round trip, not the join — two sequential primary-key lookups paid it twice on
       * every gated request.
       */
      const [row] = await fastify.db
        .select({
          plan: schema.subscriptions.plan,
          status: schema.subscriptions.status,
          accountKind: schema.userProfiles.accountKind,
        })
        .from(schema.users)
        .leftJoin(schema.subscriptions, eq(schema.subscriptions.userId, schema.users.id))
        .leftJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.users.id))
        .where(eq(schema.users.id, userId))
        .limit(1);

      const plan = effectivePlan(
        row?.plan && row.status ? { plan: row.plan, status: row.status } : null,
      );
      const context: PlanContext = {
        userId,
        plan,
        // No profile row yet (a session older than the profile backfill) reads as personal,
        // which shows fewer fields rather than more — the safe direction to be wrong in.
        accountKind: row?.accountKind ?? 'PERSONAL',
        limits: limitsFor(plan),
      };
      request.planCache.set(userId, context);
      return context;
    };

    const ownerOf = async (request: FastifyRequest, garageId: string): Promise<string> => {
      request.garageOwnerCache ??= new Map();
      const known = request.garageOwnerCache.get(garageId);
      if (known) return known;

      const [garage] = await fastify.db
        .select({ ownerId: schema.garages.ownerId })
        .from(schema.garages)
        .where(eq(schema.garages.id, garageId))
        .limit(1);
      // Reached only after a capability check has already proved membership, so a missing
      // row here means the garage went away mid-request rather than that it was never theirs.
      if (!garage) throw new NotFoundError('Garage');

      request.garageOwnerCache.set(garageId, garage.ownerId);
      return garage.ownerId;
    };

    fastify.decorate('planFor', planFor);

    fastify.decorate('planForGarage', async (request: FastifyRequest, garageId: string) =>
      planFor(request, await ownerOf(request, garageId)),
    );

    fastify.decorate(
      'requireEntitlement',
      async (request: FastifyRequest, entitlement: Entitlement, garageId: string) => {
        const plan = await fastify.planForGarage(request, garageId);
        assertEntitled(plan, entitlement);
        return plan;
      },
    );

    fastify.decorate(
      'requireOwnEntitlement',
      async (request: FastifyRequest, entitlement: Entitlement) => {
        const actor = await fastify.requireAuth(request);
        const plan = await planFor(request, actor.userId);
        assertEntitled(plan, entitlement);
        return plan;
      },
    );
  },
  { name: 'plan-access', dependencies: ['actor-context', 'database'] },
);

/** The refusal, worded so the client can build the prompt without a second lookup. */
function assertEntitled(plan: PlanContext, entitlement: Entitlement): void {
  if (hasEntitlement(plan.plan, entitlement)) return;
  const required = tierForEntitlement(entitlement);
  throw new PaymentRequiredError(
    entitlement,
    required,
    `${LABELS[entitlement]} is part of the ${PLAN_NAMES[required]} plan.`,
  );
}

/** How each entitlement is named to the person who just hit it. */
const LABELS: Readonly<Record<Entitlement, string>> = Object.freeze({
  'passport.share': 'Sharing a vehicle passport',
  'income.track': 'Recording income',
  'mileage.report': 'The mileage report',
  'driver.assign': 'Assigning a driver',
});
