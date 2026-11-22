import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  unverify,
  type SignedUpUser,
  type TestContext,
} from './harness';

/*
 * RevenueCat, in memory: what each customer's subscriptions and purchases look like at its API.
 * The real adapter runs against it, so the mapping from RevenueCat's shapes to a plan is what
 * these cases test — only the network is fake.
 */
const store = vi.hoisted(() => {
  // Before the config is first read.
  process.env.REVENUECAT_SECRET_KEY = 'sk_test';
  process.env.REVENUECAT_PROJECT_ID = 'proj_test';
  process.env.REVENUECAT_WEBHOOK_AUTH = 'Bearer hook-secret';
  return {
    subscriptions: new Map<string, unknown[]>(),
    purchases: new Map<string, unknown[]>(),
    calls: 0,
  };
});

const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const match = /api\.revenuecat\.com\/v2\/projects\/proj_test\/customers\/([^/]+)\/(\w+)/.exec(
    url,
  );
  if (!match) return realFetch(input, init);
  store.calls += 1;
  const [, customer, list] = match;
  const items = (list === 'subscriptions' ? store.subscriptions : store.purchases).get(customer!);
  if (!items) return new Response('{"type":"resource_missing"}', { status: 404 });
  return Response.json({ object: 'list', items, next_page: null });
});

const entitlements = (...keys: string[]) => ({
  object: 'list',
  items: keys.map((lookup_key) => ({ object: 'entitlement', lookup_key })),
});

const playSubscription = (key: string, overrides: Record<string, unknown> = {}) => ({
  object: 'subscription',
  gives_access: true,
  status: 'active',
  auto_renewal_status: 'will_renew',
  current_period_ends_at: Date.parse('2027-01-01T00:00:00Z'),
  store: 'play_store',
  management_url: 'https://play.google.com/store/account/subscriptions',
  entitlements: entitlements(key),
  ...overrides,
});

describe('store purchases (RevenueCat)', () => {
  let context: TestContext;
  let user: SignedUpUser;

  const hook = (appUserId: string, authorization = 'Bearer hook-secret') =>
    context.app.inject({
      method: 'POST',
      url: '/api/v1/billing/revenuecat/webhook',
      headers: { authorization },
      payload: { api_version: '1.0', event: { type: 'RENEWAL', app_user_id: appUserId } },
    });
  const plan = async () =>
    (await as(context, user).get('/api/v1/users/me/plan')).body as {
      plan: string;
      status: string;
      provider: string | null;
      store: string | null;
      managementUrl: string | null;
      currentPeriodEnd: string | null;
      cancelAtPeriodEnd: boolean;
    };

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await context.close();
  });
  beforeEach(async () => {
    store.subscriptions.clear();
    store.purchases.clear();
    user = await signUp(context, 'Pump Person', 'FREE');
  });

  it('refuses a webhook without the shared secret', async () => {
    expect((await hook(user.userId, 'Bearer wrong')).statusCode).toBe(403);
    expect((await hook(user.userId, '')).statusCode).toBe(403);
  });

  it('grants what the store sold, and says who bills it', async () => {
    store.subscriptions.set(user.userId, [playSubscription('plus')]);
    expect((await hook(user.userId)).statusCode).toBe(200);

    expect(await plan()).toMatchObject({
      plan: 'PLUS',
      status: 'ACTIVE',
      provider: 'REVENUECAT',
      store: 'PLAY_STORE',
      managementUrl: 'https://play.google.com/store/account/subscriptions',
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
    });
  });

  it('reads renewal turned off as cancelling at the period end, on the phone’s sync', async () => {
    store.subscriptions.set(user.userId, [
      playSubscription('business', { auto_renewal_status: 'will_not_renew' }),
    ]);
    expect((await as(context, user).post('/api/v1/billing/sync')).status).toBe(204);
    expect(await plan()).toMatchObject({ plan: 'BUSINESS', cancelAtPeriodEnd: true });
  });

  it('takes the higher tier, and a one-time purchase never runs out', async () => {
    store.subscriptions.set(user.userId, [playSubscription('plus')]);
    store.purchases.set(user.userId, [
      { status: 'owned', store: 'play_store', entitlements: entitlements('business') },
      { status: 'refunded', store: 'play_store', entitlements: entitlements('business') },
    ]);
    await hook(user.userId);
    expect(await plan()).toMatchObject({ plan: 'BUSINESS', currentPeriodEnd: null });
  });

  it('ends the plan once nothing gives access', async () => {
    store.subscriptions.set(user.userId, [playSubscription('plus')]);
    await hook(user.userId);
    store.subscriptions.set(user.userId, [
      playSubscription('plus', { gives_access: false, status: 'expired' }),
    ]);
    await hook(user.userId);
    expect(await plan()).toMatchObject({ plan: 'FREE', status: 'CANCELED' });
  });

  it('heals a lapsed period on the next look, when the expiry webhook never came', async () => {
    store.subscriptions.set(user.userId, [playSubscription('plus')]);
    await hook(user.userId);
    await context.database.db
      .update(schema.subscriptions)
      .set({ currentPeriodEnd: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.subscriptions.userId, user.userId));
    // RevenueCat has since forgotten the customer: nothing is owned.
    store.subscriptions.delete(user.userId);

    expect(await plan()).toMatchObject({ plan: 'FREE', status: 'CANCELED' });
  });

  it('never overwrites a plan Stripe is billing', async () => {
    await context.database.db.insert(schema.subscriptions).values({
      id: newId(),
      userId: user.userId,
      plan: 'BUSINESS',
      status: 'ACTIVE',
      stripeCustomerId: `cus_${user.userId}`,
      stripeSubscriptionId: `sub_${user.userId}`,
    });
    store.subscriptions.set(user.userId, [playSubscription('plus')]);
    await hook(user.userId);
    expect(await plan()).toMatchObject({ plan: 'BUSINESS', provider: 'STRIPE' });
  });

  it('ignores ids that are not accounts, without asking RevenueCat', async () => {
    const before = store.calls;
    expect((await hook('$RCAnonymousID:abc')).statusCode).toBe(200);
    expect((await hook(newId())).statusCode).toBe(200);
    expect(store.calls).toBe(before);
  });
});

describe('garage members need a confirmed email', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await context.close();
  });

  it('refuses an address nobody has confirmed', async () => {
    const owner = await signUp(context, 'Owner');
    const claimed = await signUp(context, 'Claimed');
    await unverify(context, claimed.userId);
    const { garageId } = await seedGarageWithVehicle(context, owner);

    const refused = await as(context, owner).post(`/api/v1/garages/${garageId}/members`, {
      email: claimed.email,
      role: 'MEMBER',
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("hasn't confirmed their email");
  });
});

describe('deleting a garage', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await context.close();
  });

  it('hands its stored files to the worker', async () => {
    const owner = await signUp(context, 'Owner');
    const { garageId, vehicleId } = await seedGarageWithVehicle(context, owner);
    await context.database.db.insert(schema.documents).values({
      vehicleId,
      documentType: 'INSURANCE',
      title: 'Policy',
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      storageKey: `doc-${garageId}`,
    });
    await context.database.db.insert(schema.vehiclePhotos).values({
      vehicleId,
      storageKey: `photo-${garageId}`,
      cutoutKey: `cutout-${garageId}`,
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });

    expect((await as(context, owner).delete(`/api/v1/garages/${garageId}`)).status).toBe(204);

    const jobs = await context.database.db
      .select({ payload: schema.outboxMessages.payload })
      .from(schema.outboxMessages)
      .where(
        and(
          eq(schema.outboxMessages.jobName, 'delete-objects'),
          eq(schema.outboxMessages.jobKey, `delete-objects:${garageId}:0`),
        ),
      );
    expect(jobs).toHaveLength(1);
    expect((jobs[0]!.payload as { keys: string[] }).keys.sort()).toEqual(
      [`cutout-${garageId}`, `doc-${garageId}`, `photo-${garageId}`].sort(),
    );
  });
});

describe('the dashboard', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });
  afterAll(async () => {
    await context.close();
  });

  it('sums spend in the database and lists the newest entries across vehicles', async () => {
    const owner = await signUp(context, 'Owner');
    const { garageId, vehicleId } = await seedGarageWithVehicle(context, owner);
    const client = as(context, owner);
    const second = await client.post('/api/v1/vehicles', {
      garageId,
      vehicleType: 'CAR',
      make: 'Audi',
      model: 'A4',
    });
    const otherId = (second.body as { id: string }).id;

    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    for (let n = 0; n < 6; n += 1) {
      await client.post(`/api/v1/vehicles/${vehicleId}/events`, {
        eventType: 'NOTE',
        title: `First ${n}`,
        occurredAt: day(10 + n * 2),
      });
      await client.post(`/api/v1/vehicles/${otherId}/events`, {
        eventType: 'NOTE',
        title: `Second ${n}`,
        occurredAt: day(11 + n * 2),
      });
    }
    for (const [category, amountMinor] of [
      ['FUEL', 4_000],
      ['FUEL', 6_000],
      ['INSURANCE', 50_000],
    ] as const) {
      const expense = await client.post(`/api/v1/vehicles/${vehicleId}/expenses`, {
        category,
        description: category,
        amountMinor,
        currency: 'USD',
        occurredAt: day(400),
      });
      expect(expense.status).toBe(201);
    }

    const dashboard = (await client.get('/api/v1/dashboard')).body as {
      recentActivity: { title: string; occurredAt: string }[];
      vehicleSpend: Record<string, { amountMinor: number; currency: string }>;
    };
    const titles = dashboard.recentActivity.map((item) => item.title);
    // The eight newest of the twelve notes and three expenses, both vehicles interleaved.
    expect(titles.slice(0, 4)).toEqual(['First 0', 'Second 0', 'First 1', 'Second 1']);
    expect(titles).toHaveLength(8);
    const times = dashboard.recentActivity.map((item) => Date.parse(item.occurredAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(dashboard.vehicleSpend[vehicleId]).toEqual({ amountMinor: 60_000, currency: 'USD' });
  });
});
