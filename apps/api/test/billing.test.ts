import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import { as, createTestContext, signUp, type SignedUpUser, type TestContext } from './harness';
import type * as StripeAdapter from '../src/infrastructure/stripe';

/*
 * The provider, in memory: enough of `subscriptions` to move a plan down and back, and to be the
 * truth a missed webhook left the database behind on. Prices map to tiers as the real adapter
 * would read them from configuration.
 */
interface FakeSubscription {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  items: { data: { id: string; price: { id: string }; current_period_end: number }[] };
  metadata: Record<string, string>;
}

const provider = vi.hoisted(() => {
  // Before the config is first read: the webhook refuses to run without a secret.
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  return {
    subscriptions: new Map<string, FakeSubscription>(),
    updates: [] as { id: string; params: Record<string, unknown> }[],
  };
});

vi.mock('../src/infrastructure/stripe', async (original) => {
  const real = await original<typeof StripeAdapter>();
  const PRICES = { PLUS: 'price_plus', BUSINESS: 'price_business' } as const;
  const client = {
    // The signature is the real client's job; here the body is the event.
    webhooks: { constructEvent: (raw: Buffer) => JSON.parse(raw.toString()) as unknown },
    subscriptions: {
      list: async ({ customer }: { customer: string }) => ({
        data: [...provider.subscriptions.values()].filter((sub) => sub.customer === customer),
      }),
      retrieve: async (id: string) => provider.subscriptions.get(id),
      update: async (id: string, params: Record<string, unknown>) => {
        provider.updates.push({ id, params });
        const sub = provider.subscriptions.get(id)!;
        if (typeof params.cancel_at_period_end === 'boolean') {
          sub.cancel_at_period_end = params.cancel_at_period_end;
        }
        const items = params.items as { price: string }[] | undefined;
        if (items) sub.items.data[0]!.price.id = items[0]!.price;
        return sub;
      },
    },
  };
  return {
    ...real,
    stripe: () => client,
    requireStripe: () => client,
    priceFor: (plan: 'PLUS' | 'BUSINESS') => PRICES[plan],
    planForPrice: (price: string | null | undefined) =>
      price === PRICES.PLUS ? 'PLUS' : price === PRICES.BUSINESS ? 'BUSINESS' : null,
  };
});

describe('moving to a smaller plan', () => {
  let context: TestContext;
  let user: SignedUpUser;
  const periodEnd = Math.floor(Date.parse('2026-10-28T10:00:00Z') / 1000);

  /** A live subscription at the provider, and — unless `missedWebhook` — the row that knows it. */
  async function subscribe(plan: 'PLUS' | 'BUSINESS', { missedWebhook = false } = {}) {
    provider.subscriptions.clear();
    provider.updates.length = 0;
    provider.subscriptions.set('sub_1', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      items: {
        data: [
          {
            id: 'si_1',
            price: { id: plan === 'PLUS' ? 'price_plus' : 'price_business' },
            current_period_end: periodEnd,
          },
        ],
      },
      metadata: { userId: user.userId },
    });
    await context.database.db
      .delete(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, user.userId));
    await context.database.db.insert(schema.subscriptions).values({
      id: newId(),
      userId: user.userId,
      stripeCustomerId: 'cus_1',
      ...(missedWebhook
        ? { plan: 'FREE' as const, status: 'ACTIVE' as const }
        : { plan, status: 'ACTIVE' as const, stripeSubscriptionId: 'sub_1' }),
    });
  }

  const planNow = async () =>
    (await as(context, user).get('/api/v1/users/me/plan')).body as {
      plan: string;
      cancelAtPeriodEnd: boolean;
      currentPeriodEnd: string | null;
    };

  beforeAll(async () => {
    context = await createTestContext();
    user = await signUp(context, 'Payer', 'FREE');
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(() => subscribe('BUSINESS'));

  it('switches Business to Plus now, credited, and says so on the next read', async () => {
    const response = await as(context, user).post('/api/v1/billing/downgrade', { plan: 'PLUS' });

    expect(response.status).toBe(204);
    expect(provider.updates).toEqual([
      {
        id: 'sub_1',
        params: {
          items: [{ id: 'si_1', price: 'price_plus' }],
          proration_behavior: 'create_prorations',
          cancel_at_period_end: false,
        },
      },
    ]);
    expect(await planNow()).toMatchObject({ plan: 'PLUS', cancelAtPeriodEnd: false });
  });

  it('cancels to Free at the end of the period, keeping the plan until then', async () => {
    const response = await as(context, user).post('/api/v1/billing/downgrade', { plan: 'FREE' });

    expect(response.status).toBe(204);
    expect(provider.updates[0]?.params).toEqual({ cancel_at_period_end: true });
    expect(await planNow()).toMatchObject({
      plan: 'BUSINESS',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-10-28T10:00:00.000Z',
    });
  });

  it('withdraws a cancellation', async () => {
    await as(context, user).post('/api/v1/billing/downgrade', { plan: 'FREE' });

    expect((await as(context, user).post('/api/v1/billing/resume')).status).toBe(204);
    expect(await planNow()).toMatchObject({ plan: 'BUSINESS', cancelAtPeriodEnd: false });
  });

  it('refuses a "downgrade" that is not smaller, and changes nothing', async () => {
    await subscribe('PLUS');

    const response = await as(context, user).post('/api/v1/billing/downgrade', { plan: 'PLUS' });

    expect(response.status).toBe(400);
    expect(provider.updates).toHaveLength(0);
  });

  it('answers a free account plainly', async () => {
    await context.database.db
      .delete(schema.subscriptions)
      .where(eq(schema.subscriptions.userId, user.userId));

    const response = await as(context, user).post('/api/v1/billing/downgrade', { plan: 'FREE' });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toContain('free plan');
  });

  /*
   * The row says Free but Stripe bills Plus (a plan overwritten by hand), and the person presses
   * "Upgrade to Plus". Stripe refuses a change to the price it already has, so the row is put
   * right from Stripe and the person is sent on as if checkout had finished.
   */
  it('puts a stale row right instead of asking Stripe for a change it already has', async () => {
    await subscribe('PLUS');
    await context.database.db
      .update(schema.subscriptions)
      .set({ plan: 'FREE' })
      .where(eq(schema.subscriptions.userId, user.userId));

    const response = await as(context, user).post('/api/v1/billing/checkout', {
      plan: 'PLUS',
      returnPath: '/settings',
    });

    expect(response.status).toBe(200);
    expect((response.body as { url: string }).url).toMatch(/\/settings\?checkout=done$/);
    expect(provider.updates).toHaveLength(0);
    expect(await planNow()).toMatchObject({ plan: 'PLUS' });
  });

  const ended = (id: string) =>
    context.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 'signed' },
      payload: JSON.stringify({
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id,
            customer: 'cus_1',
            status: 'canceled',
            cancel_at_period_end: false,
            items: {
              data: [
                { id: 'si_x', price: { id: 'price_business' }, current_period_end: periodEnd },
              ],
            },
            metadata: {},
          },
        },
      }),
    });

  // A double checkout left two subscriptions; ending the extra one must not end the plan.
  it('ignores the end of a subscription the account is not following', async () => {
    const response = await ended('sub_duplicate');

    expect(response.statusCode).toBe(200);
    expect(await planNow()).toMatchObject({ plan: 'BUSINESS' });
  });

  it('ends the plan when the subscription it follows ends', async () => {
    await ended('sub_1');

    expect(await planNow()).toMatchObject({ plan: 'FREE' });
  });

  // The webhook never came: the row still says Free, the provider says Business. The provider wins.
  it('asks the provider first when the database missed the webhook', async () => {
    await subscribe('BUSINESS', { missedWebhook: true });

    const response = await as(context, user).post('/api/v1/billing/downgrade', { plan: 'FREE' });

    expect(response.status).toBe(204);
    expect(await planNow()).toMatchObject({ plan: 'BUSINESS', cancelAtPeriodEnd: true });
  });
});
