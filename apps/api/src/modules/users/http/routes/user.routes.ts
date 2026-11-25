import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
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
import { deleteAccount } from '../../application/commands/delete-account';
import { serializeUser } from '../serializers/user-serializer';
import { syncFromProvider, syncStoreAccess } from '../../../billing/http/routes/billing.routes';
import { stripe } from '../../../../infrastructure/stripe';
import { deleteStoreCustomer, revenuecatConfigured } from '../../../../infrastructure/revenuecat';

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
      const read = () =>
        fastify.db
          .select({
            status: schema.subscriptions.status,
            currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
            cancelAtPeriodEnd: schema.subscriptions.cancelAtPeriodEnd,
            provider: schema.subscriptions.provider,
            store: schema.subscriptions.store,
            managementUrl: schema.subscriptions.managementUrl,
            stripeCustomerId: schema.subscriptions.stripeCustomerId,
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.userId, actor.userId))
          .limit(1);
      let [subscription] = await read();

      /*
       * A paid period that has run out with no word since — a renewal or an expiry whose
       * webhook never came. The provider is asked once, here, so the plan heals on the next
       * look instead of staying paid (or unpaid) until somebody notices. A renewal moves the
       * period on, so this runs once per lapse, not on every read.
       */
      if (
        subscription?.currentPeriodEnd &&
        subscription.currentPeriodEnd.getTime() < Date.now() &&
        subscription.status !== 'CANCELED'
      ) {
        try {
          const client = stripe();
          if (subscription.provider === 'REVENUECAT' && revenuecatConfigured()) {
            await syncStoreAccess(fastify, actor.userId);
          } else if (client && subscription.stripeCustomerId) {
            await syncFromProvider(fastify, client, subscription.stripeCustomerId);
          }
          [subscription] = await read();
          request.planCache?.delete(actor.userId);
        } catch (error) {
          // The provider being down is no reason to fail the plan read: it answers as it was.
          request.log.warn({ err: error }, 'Plan refresh from the provider failed');
        }
      }
      const plan = await fastify.planFor(request, actor.userId);

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
        // A Stripe row with no subscription id is a plan given by hand: nobody bills it.
        provider:
          subscription?.provider === 'REVENUECAT'
            ? ('REVENUECAT' as const)
            : subscription?.stripeSubscriptionId
              ? ('STRIPE' as const)
              : null,
        store: subscription?.provider === 'REVENUECAT' ? subscription.store : null,
        managementUrl: subscription?.provider === 'REVENUECAT' ? subscription.managementUrl : null,
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

  fastify.delete(
    '/me',
    {
      schema: {
        tags: ['users'],
        summary: 'Delete my account',
        description:
          'Cancels a live subscription, deletes every garage the caller owns with everything in ' +
          'it, then the account. Garages owned by someone else keep their records.',
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      await deleteAccount(fastify.db, actor.userId, {
        requestId: request.id,
        ipAddress: request.ip,
        actorEmail: request.actor?.email ?? null,
      });
      /*
       * And forgotten at RevenueCat, once the account is gone here. After the fact and not
       * fatal: the account is already deleted, and a failure there leaves only an id that no
       * longer names anyone. A store subscription is not cancelled by this — only the store can,
       * which is why the app asks the person to cancel it first.
       */
      if (revenuecatConfigured()) {
        await deleteStoreCustomer(actor.userId).catch((error: unknown) =>
          request.log.warn({ err: error }, 'RevenueCat customer not deleted'),
        );
      }
      return reply.status(204).send(null);
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
