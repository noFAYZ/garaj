import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { env, isProduction } from '@vehicle-os/config';
import {
  CheckoutSession,
  Downgrade,
  PlanPrices,
  StandardErrors,
  StartCheckout,
} from '@vehicle-os/contracts';
import { PLAN_NAMES, PLAN_RANK } from '@vehicle-os/domain';
import { newId } from '@vehicle-os/utils';
import { ForbiddenError, ValidationError } from '../../../../infrastructure/errors';
import {
  planForPrice,
  priceFor,
  requireStripe,
  resolvePrice,
  toSubscriptionStatus,
} from '../../../../infrastructure/stripe';

/**
 * Subscriptions (GAPS §17).
 *
 * **Nothing here decides what someone has paid for except the provider.** The checkout route
 * only sends a person to the provider; it never writes a plan, because the reply to "did you
 * pay" cannot come from the browser that was asked to. Someone who closes the tab at the
 * payment page has still had a successful redirect, and a plan written on that redirect is a
 * plan granted for free.
 *
 * Two readers of the provider, one writer (`applySubscription`), both idempotent: the
 * signature-verified webhook, and `syncFromProvider`, which asks the provider directly on the
 * return from checkout. The second exists because the first can simply not arrive — no
 * `stripe listen` in development, a delayed delivery in production — and a paid checkout then
 * sat on "confirming" forever while the next attempt billed a second subscription.
 */
/** A subscription still being billed — the provider is charging or retrying it. */
const LIVE = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

export const billingRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  /**
   * What each paid tier costs, for the upgrade screen.
   *
   * Always 200: a deployment without billing, or a provider that is down, answers with nulls
   * and the screen shows the plans without prices — the upgrade screen must never be the thing
   * that breaks because payments are not set up yet.
   */
  fastify.get(
    '/prices',
    {
      schema: {
        tags: ['billing'],
        summary: 'Prices of the paid tiers',
        response: { 200: PlanPrices, ...StandardErrors },
      },
    },
    async (request) => {
      await fastify.requireAuth(request);
      const [plus, business] = await Promise.all([resolvePrice('PLUS'), resolvePrice('BUSINESS')]);
      return { PLUS: plus, BUSINESS: business };
    },
  );

  fastify.post(
    '/checkout',
    {
      schema: {
        tags: ['billing'],
        summary: 'Start a checkout for a paid plan',
        description:
          'Returns the provider’s hosted page. The plan changes only once the provider ' +
          'confirms payment through the webhook — never on the return from this page.',
        body: StartCheckout,
        response: { 200: CheckoutSession, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const stripe = requireStripe();

      const current = () =>
        fastify.db
          .select({
            id: schema.subscriptions.id,
            plan: schema.subscriptions.plan,
            status: schema.subscriptions.status,
            stripeCustomerId: schema.subscriptions.stripeCustomerId,
            stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
          })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.userId, actor.userId))
          .limit(1);
      let [existing] = await current();

      /*
       * A customer this row says is not paying is asked about first: a webhook that never
       * arrived must not turn into a second subscription billed alongside the first. One provider
       * call, and only for someone who has been to checkout before.
       */
      if (
        existing?.stripeCustomerId &&
        !(existing.stripeSubscriptionId && LIVE.has(existing.status)) &&
        (await syncFromProvider(fastify, stripe, existing.stripeCustomerId))
      ) {
        [existing] = await current();
      }

      const plan = request.body.plan as 'PLUS' | 'BUSINESS';
      const returnTo = safeReturn(request.body.returnPath);

      /*
       * Already paying: change that subscription, never start a second one. A second checkout
       * would bill both plans every month, and the webhook would only remember the newer one.
       * The provider's own confirm page shows the prorated charge before anything is taken.
       */
      if (
        existing?.stripeCustomerId &&
        existing.stripeSubscriptionId &&
        LIVE.has(existing.status)
      ) {
        if (existing.plan === plan)
          throw new ValidationError(`You are already on ${PLAN_NAMES[plan]}`);
        const subscription = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
        const item = subscription.items.data[0];
        if (!item) throw new ValidationError('The subscription has no plan to change');
        /*
         * The provider already charges that price, so this row is what is stale — a webhook that
         * never came, or a plan set by hand in the admin console. Asking the provider to "change"
         * to the price it already has fails with "no changes to confirm"; instead its answer is
         * written through and the person is sent on as if checkout had finished, where the plan
         * now reads right.
         */
        if (item.price.id === priceFor(plan)) {
          await applySubscription(fastify, subscription);
          return { url: `${returnTo}?checkout=done` };
        }
        const session = await stripe.billingPortal.sessions.create({
          customer: existing.stripeCustomerId,
          configuration: env().STRIPE_PORTAL_CONFIGURATION,
          return_url: returnTo,
          flow_data: {
            type: 'subscription_update_confirm',
            subscription_update_confirm: {
              subscription: subscription.id,
              items: [{ id: item.id, price: priceFor(plan), quantity: 1 }],
            },
            after_completion: {
              type: 'redirect',
              redirect: { return_url: `${returnTo}?checkout=done` },
            },
          },
        });
        return { url: session.url };
      }

      /*
       * One provider customer per account, reused across upgrades and lapses. A second one
       * would split a person's payment history in two and leave the older card on file
       * against an id nothing reads.
       */
      const customerId =
        existing?.stripeCustomerId ??
        (
          await stripe.customers.create(
            { email: actor.email, metadata: { userId: actor.userId } },
            // Two checkouts racing (a double click, two tabs) both see no customer yet; the
            // key makes the provider hand the second one the first's customer, not a new one.
            { idempotencyKey: `customer:${actor.userId}` },
          )
        ).id;

      if (!existing) {
        await fastify.db
          .insert(schema.subscriptions)
          .values({ id: newId(), userId: actor.userId, stripeCustomerId: customerId })
          .onConflictDoNothing();
      } else if (!existing.stripeCustomerId) {
        await fastify.db
          .update(schema.subscriptions)
          .set({ stripeCustomerId: customerId })
          .where(eq(schema.subscriptions.id, existing.id));
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceFor(plan), quantity: 1 }],
        success_url: `${returnTo}?checkout=done`,
        cancel_url: `${returnTo}?checkout=cancelled`,
        // Echoed back on the webhook, so the event can be matched to an account even if the
        // customer record is ever recreated.
        subscription_data: { metadata: { userId: actor.userId } },
        client_reference_id: actor.userId,
      });

      if (!session.url) throw new ValidationError('The provider returned no checkout URL');
      return { url: session.url };
    },
  );

  /**
   * The return from checkout: ask the provider what the caller now has, rather than waiting on
   * a webhook that may never come. Safe to call any time — it writes only what the provider
   * says, through the same path the webhook uses.
   */
  fastify.post(
    '/sync',
    {
      schema: {
        tags: ['billing'],
        summary: 'Refresh the plan from the payment provider',
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      const stripe = requireStripe();
      const [row] = await fastify.db
        .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, actor.userId))
        .limit(1);
      if (row?.stripeCustomerId) await syncFromProvider(fastify, stripe, row.stripeCustomerId);
      return reply.status(204).send(null);
    },
  );

  /**
   * The caller's live subscription. Synced from the provider first when this row is not sure,
   * so a webhook that never arrived cannot leave a paid plan impossible to change.
   */
  async function liveSubscriptionOf(userId: string, stripe: Stripe) {
    const current = () =>
      fastify.db
        .select({
          plan: schema.subscriptions.plan,
          status: schema.subscriptions.status,
          stripeCustomerId: schema.subscriptions.stripeCustomerId,
          stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId,
        })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, userId))
        .limit(1);
    let [row] = await current();
    if (row?.stripeCustomerId && !(row.stripeSubscriptionId && LIVE.has(row.status))) {
      if (await syncFromProvider(fastify, stripe, row.stripeCustomerId)) [row] = await current();
    }
    if (!row?.stripeSubscriptionId || !LIVE.has(row.status)) {
      throw new ValidationError('You are on the free plan');
    }
    return { plan: row.plan, subscriptionId: row.stripeSubscriptionId };
  }

  /**
   * Moving down, in the app rather than the provider's portal.
   *
   * To Free: cancelled at the end of the period — the time paid for is kept. To a smaller paid
   * tier: switched now, the unused part credited to the next invoice. Neither charges the card,
   * so neither can stall on a bank's verification step — which is why going *up* is still a
   * checkout. The provider's answer is written through `applySubscription`, so the next read
   * shows it; the webhook that follows says the same again.
   */
  fastify.post(
    '/downgrade',
    {
      schema: {
        tags: ['billing'],
        summary: 'Move to a smaller plan',
        body: Downgrade,
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      const stripe = requireStripe();
      const { plan, subscriptionId } = await liveSubscriptionOf(actor.userId, stripe);
      const target = request.body.plan;
      if (PLAN_RANK[target] >= PLAN_RANK[plan]) {
        throw new ValidationError(`${PLAN_NAMES[target]} is not smaller than ${PLAN_NAMES[plan]}`);
      }

      let updated: Stripe.Subscription;
      if (target === 'FREE') {
        updated = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
      } else {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const item = subscription.items.data[0];
        if (!item) throw new ValidationError('The subscription has no plan to change');
        updated = await stripe.subscriptions.update(subscriptionId, {
          items: [{ id: item.id, price: priceFor(target) }],
          proration_behavior: 'create_prorations',
          // Choosing a plan is choosing to stay: a pending cancellation goes with it.
          cancel_at_period_end: false,
        });
      }
      await applySubscription(fastify, updated);
      return reply.status(204).send(null);
    },
  );

  /** Changed their mind before the period ended: the cancellation is withdrawn. */
  fastify.post(
    '/resume',
    {
      schema: {
        tags: ['billing'],
        summary: 'Keep a plan that was set to cancel',
        response: { 204: Type.Null(), ...StandardErrors },
      },
    },
    async (request, reply) => {
      const actor = await fastify.requireAuth(request);
      const stripe = requireStripe();
      const { subscriptionId } = await liveSubscriptionOf(actor.userId, stripe);
      await applySubscription(
        fastify,
        await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false }),
      );
      return reply.status(204).send(null);
    },
  );

  /**
   * The provider's own page for changing a card and downloading invoices.
   *
   * Hosted rather than rebuilt: card details must never reach this server.
   */
  fastify.post(
    '/portal',
    {
      schema: {
        tags: ['billing'],
        summary: 'Open the billing portal',
        body: Type.Object(
          { returnPath: Type.Optional(Type.String({ maxLength: 512 })) },
          { additionalProperties: false },
        ),
        response: { 200: CheckoutSession, ...StandardErrors },
      },
    },
    async (request) => {
      const actor = await fastify.requireAuth(request);
      const stripe = requireStripe();

      const [subscription] = await fastify.db
        .select({ stripeCustomerId: schema.subscriptions.stripeCustomerId })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, actor.userId))
        .limit(1);

      if (!subscription?.stripeCustomerId) {
        throw new ValidationError('This account has never subscribed');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        configuration: env().STRIPE_PORTAL_CONFIGURATION,
        return_url: safeReturn(request.body.returnPath),
      });
      return { url: session.url };
    },
  );

  /**
   * What the provider says happened — the only thing that changes a plan.
   *
   * Registered in its own scope with a parser that keeps the body as bytes. The signature
   * covers the exact bytes sent: `JSON.parse` followed by re-serialising reorders keys and
   * rewrites numbers, so a parsed body fails a valid signature — and a route that skipped
   * verification to get around that would let anyone on the internet grant themselves a
   * business plan.
   */
  await fastify.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, body);
      },
    );

    scope.post(
      '/webhook',
      {
        schema: {
          tags: ['billing'],
          summary: 'Payment provider webhook',
          description: 'Signature-verified against the raw body. Not for any other caller.',
          response: { 200: Type.Object({ received: Type.Boolean() }), ...StandardErrors },
        },
      },
      async (request) => {
        const stripe = requireStripe();
        const secret = env().STRIPE_WEBHOOK_SECRET;
        if (!secret) throw new ForbiddenError('Webhooks are not configured');

        const signature = request.headers['stripe-signature'];
        const raw = request.body;
        if (typeof signature !== 'string' || !Buffer.isBuffer(raw)) {
          throw new ForbiddenError('Missing webhook signature');
        }

        let event: Stripe.Event;
        try {
          event = stripe.webhooks.constructEvent(raw, signature, secret);
        } catch {
          // No detail in the response: a forged request learns nothing about why it failed.
          throw new ForbiddenError('Invalid webhook signature');
        }

        switch (event.type) {
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
            await applySubscription(fastify, event.data.object);
            break;
          default:
            // Acknowledged and ignored. An error for an event we do not handle makes the
            // provider retry it forever.
            break;
        }

        return { received: true };
      },
    );
  });
};

/**
 * The customer's subscription as the provider holds it, written through. Returns whether one is
 * live. The newest wins: the list comes back newest first.
 */
export async function syncFromProvider(
  fastify: Parameters<FastifyPluginAsyncTypebox>[0],
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  const { data } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 5,
  });
  const latest =
    data.find((subscription) => LIVE.has(toSubscriptionStatus(subscription.status))) ?? data[0];
  if (latest) await applySubscription(fastify, latest);
  return Boolean(latest && LIVE.has(toSubscriptionStatus(latest.status)));
}

/**
 * Write what the provider says, keyed by the customer it is about.
 *
 * Idempotent by construction: it sets the state rather than adjusting it, so the provider's
 * retries converge on the same row instead of stacking.
 */
async function applySubscription(
  fastify: Parameters<FastifyPluginAsyncTypebox>[0],
  subscription: {
    id: string;
    customer: string | { id: string };
    status: string;
    cancel_at_period_end?: boolean | null;
    items: { data: { price: { id: string }; current_period_end?: number | null }[] };
    metadata?: Record<string, string>;
  },
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const item = subscription.items.data[0];
  const plan = planForPrice(item?.price.id);
  const status = toSubscriptionStatus(subscription.status);

  /*
   * An unrecognised price is reported and left alone. It means a plan sold under a price this
   * deployment does not know, or an event from another environment sharing the account —
   * guessing would either upgrade someone for free or downgrade someone who paid.
   */
  if (plan === null && status !== 'CANCELED') {
    fastify.log.warn(
      { subscriptionId: subscription.id, priceId: item?.price.id },
      'Subscription webhook for an unknown price; leaving the plan unchanged',
    );
    return;
  }

  /*
   * One row per account, but a customer can hold two subscriptions (a double checkout, one made
   * in the dashboard). The end of one the row is not following must not overwrite the one it is:
   * cancelling a duplicate would otherwise mark a paying account cancelled. A subscription that
   * is live still takes the row over — that is a new one replacing an old.
   */
  if (!LIVE.has(status)) {
    const [row] = await fastify.db
      .select({ tracking: schema.subscriptions.stripeSubscriptionId })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.stripeCustomerId, customerId))
      .limit(1);
    if (row?.tracking && row.tracking !== subscription.id) {
      fastify.log.info(
        { subscriptionId: subscription.id, tracking: row.tracking },
        'A subscription the account is not following ended; the plan follows the live one',
      );
      return;
    }
  }

  const periodEnd = item?.current_period_end;
  const changes = {
    // A cancelled subscription keeps the tier it was, and `effectivePlan` reads the status —
    // so the row still says what they had, which the history is worth more than a blank.
    ...(plan === null ? {} : { plan }),
    status,
    stripeSubscriptionId: subscription.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
  };

  const updated = await fastify.db
    .update(schema.subscriptions)
    .set(changes)
    .where(eq(schema.subscriptions.stripeCustomerId, customerId))
    .returning({ id: schema.subscriptions.id });

  if (updated.length > 0) return;

  /*
   * No row for this customer. Reachable when a subscription is created in the provider's own
   * dashboard rather than through checkout, so the account is matched by the metadata the
   * checkout attached — and if that is missing too, there is nobody to bill and the event is
   * logged rather than guessed at.
   */
  const userId = subscription.metadata?.userId;
  if (!userId) {
    fastify.log.error(
      { subscriptionId: subscription.id, customerId },
      'Subscription webhook for an unknown customer with no userId metadata',
    );
    return;
  }

  await fastify.db
    .insert(schema.subscriptions)
    .values({ id: newId(), userId, stripeCustomerId: customerId, plan: plan ?? 'FREE', ...changes })
    .onConflictDoUpdate({ target: schema.subscriptions.userId, set: changes });
}

/**
 * A return path from the client, kept inside this product.
 *
 * Only a path is accepted, and it is joined onto the configured origin. An absolute URL from
 * a request body is an open redirect: a checkout link that returns the person to a page an
 * attacker controls, wearing this product's name.
 *
 * The one exception is the mobile app's own link, so a phone comes back to the app rather than
 * to a web page it may not reach (in development, the web app's localhost). Expo Go's `exp://`
 * names a host to load code from — the same open redirect — so it is honoured only outside
 * production.
 */
export function safeReturn(path: string | undefined): string {
  // `scheme` in apps/mobile/app.json.
  if (path?.startsWith('vehicleos://')) return path;
  if (path && /^exps?:\/\//.test(path) && !isProduction()) return path;
  const base = env().WEB_URL.replace(/\/$/, '');
  if (!path || !path.startsWith('/') || path.startsWith('//')) return `${base}/settings`;
  return `${base}${path}`;
}
