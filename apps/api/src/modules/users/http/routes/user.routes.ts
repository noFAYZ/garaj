import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  CapabilitiesResponse,
  PlanState,
  StandardErrors,
  UpdateUserProfile,
  UserProfile,
} from '@vehicle-os/contracts';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { capabilityMap, entitlementsFor } from '@vehicle-os/domain';
import {
  countGaragesOwnedBy,
  countVehiclesOwnedBy,
} from '../../../garages/infrastructure/repositories/garage-repository';
import { getCurrentUser } from '../../application/queries/get-current-user';
import { updateUserPreferences } from '../../application/commands/update-user-preferences';
import { serializeUser } from '../serializers/user-serializer';

export const userRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.get(
    '/me',
    {
      schema: {
        tags: ['users'],
        summary: 'Current user profile and preferences',
        response: { 200: UserProfile, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      return serializeUser(await getCurrentUser(fastify.db, actor.userId));
    },
  );

  /**
   * What this account may do and how much of it is left (GAPS §10).
   *
   * Usage is counted the same way the ceilings are enforced — from the same two queries the
   * create routes call — so "2 of 3" on a button and the 409 behind it can never disagree.
   */
  fastify.get(
    '/me/plan',
    {
      schema: {
        tags: ['users'],
        summary: 'Plan, entitlements and usage',
        response: { 200: PlanState, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const plan = await fastify.planFor(request, actor.userId);

      const [subscription] = await fastify.db
        .select({
          status: schema.subscriptions.status,
          currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
        })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, actor.userId))
        .limit(1);

      const [vehicles, garages] = await Promise.all([
        countVehiclesOwnedBy(fastify.db, actor.userId),
        countGaragesOwnedBy(fastify.db, actor.userId),
      ]);

      return {
        plan: plan.plan,
        // No row is an account that has never subscribed, which is active on the free plan
        // rather than canceled — those read differently to anyone building an upgrade screen.
        status: subscription?.status ?? 'ACTIVE',
        accountKind: plan.accountKind,
        entitlements: [...entitlementsFor(plan.plan)],
        limits: plan.limits,
        usage: { vehicles, garages },
        currentPeriodEnd: subscription?.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      };
    },
  );

  fastify.patch(
    '/me',
    {
      schema: {
        tags: ['users'],
        summary: 'Update preferences',
        description:
          'Only the supplied fields change. An omitted field is left as-is, never reset.',
        body: UpdateUserProfile,
        response: { 200: UserProfile, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      return serializeUser(await updateUserPreferences(fastify.db, actor.userId, request.body));
    },
  );

  fastify.get(
    '/me/capabilities',
    {
      schema: {
        tags: ['users'],
        summary: 'What the caller may do, per garage',
        description:
          'A convenience for hiding UI. The server re-checks every request regardless of ' +
          'what a client believes it is allowed to do.',
        response: { 200: CapabilitiesResponse, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      return { garages: capabilityMap(actor) };
    },
  );
};
