import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as config from '@vehicle-os/config';
import { isEnabled, env } from '@vehicle-os/config';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import type { AiProviderPort, AiTurn } from '../src/modules/ai/infrastructure/ai-port';
import { deliverNotification } from '../src/modules/notifications/application/services/deliver';
import { daysFrom, parseInfo, windowStart } from '../src/modules/admin/http/routes/insights.routes';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

/*
 * The admin list is read from the environment, which is parsed once — but an id only exists
 * after sign-up. So `env()` is wrapped to read the list from here, set once the admin exists.
 */
const admin = vi.hoisted(() => ({ ids: '' }));
vi.mock('@vehicle-os/config', async (importOriginal) => {
  const actual = await importOriginal<typeof config>();
  return { ...actual, env: () => ({ ...actual.env(), ADMIN_USER_IDS: admin.ids }) };
});

describe('admin', () => {
  let context: TestContext;
  let root: SignedUpUser;
  let bob: SignedUpUser;

  // Two turns per question — a tool call, then the answer — each billed, to check they sum.
  const turns: (AiTurn | Error)[] = [];
  const ai: AiProviderPort = {
    model: 'test-model',
    generate: () => {
      const next = turns.shift() ?? { text: 'Done.', calls: [] };
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
  };

  beforeAll(async () => {
    context = await createTestContext({ ai });
    root = await signUp(context, 'Root');
    bob = await signUp(context, 'Bob Tester');
    admin.ids = ` ${root.userId} , `;
  });

  afterAll(async () => {
    await context.close();
  });

  it('refuses anyone not on the list', async () => {
    const anonymous = await context.app.inject({ method: 'GET', url: '/api/v1/admin/overview' });
    expect(anonymous.statusCode).toBe(401);
    expect((await as(context, bob).get('/api/v1/admin/overview')).status).toBe(403);
    // Refused before validation: a bad body tells a non-admin nothing about the schema.
    expect((await as(context, bob).patch('/api/v1/admin/flags', { nope: 1 })).status).toBe(403);
  });

  it('counts the deployment', async () => {
    const overview = await as(context, root).get('/api/v1/admin/overview');
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({ counts: { users: 2, newUsers: 2 } });
    // The request asking is itself a signed-in request: the asker is online.
    expect((overview.body as { counts: { online: number } }).counts.online).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('finds, edits and revokes a user', async () => {
    const client = as(context, root);
    const found = await client.get('/api/v1/admin/users?q=bob%20tes');
    expect((found.body as { data: { id: string }[] }).data.map((u) => u.id)).toEqual([bob.userId]);
    // A literal `%` is a character to match, not a wildcard.
    expect((await client.get('/api/v1/admin/users?q=%25')).body).toMatchObject({ data: [] });

    const patched = await client.patch(`/api/v1/admin/users/${bob.userId}`, {
      plan: 'PLUS',
      distanceUnit: 'MI',
      emailVerified: true,
    });
    expect(patched.status).toBe(204);

    const detail = await client.get(`/api/v1/admin/users/${bob.userId}`);
    expect(detail.body).toMatchObject({
      distanceUnit: 'MI',
      emailVerified: true,
      subscription: { plan: 'PLUS' },
      isAdmin: false,
    });
    expect((detail.body as { sessions: unknown[] }).sessions).toHaveLength(1);
    expect(JSON.stringify(detail.body)).not.toContain('token');

    // Someone Stripe is billing: a plan set here would disagree with the bill, so it is refused.
    await context.database.db
      .update(schema.subscriptions)
      .set({ stripeCustomerId: 'cus_bob', stripeSubscriptionId: 'sub_bob', status: 'ACTIVE' })
      .where(eq(schema.subscriptions.userId, bob.userId));
    const overPaid = await client.patch(`/api/v1/admin/users/${bob.userId}`, { plan: 'FREE' });
    expect(overPaid.status).toBe(409);
    expect((await client.get(`/api/v1/admin/users/${bob.userId}`)).body).toMatchObject({
      subscription: { plan: 'PLUS' },
    });

    expect((await client.delete(`/api/v1/admin/users/${bob.userId}/sessions`)).status).toBe(204);
    const after = await client.get(`/api/v1/admin/users/${bob.userId}`);
    expect((after.body as { sessions: unknown[] }).sessions).toHaveLength(0);
  });

  it('will not delete an owner until their garages are gone', async () => {
    const owner = await signUp(context, 'Owner');
    const { garageId } = await seedGarageWithVehicle(context, owner, 'Doomed');
    const client = as(context, root);

    const refused = await client.delete(`/api/v1/admin/users/${owner.userId}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: { code: 'USER_OWNS_GARAGES' } });

    const garage = await client.get(`/api/v1/admin/garages/${garageId}`);
    expect(garage.body).toMatchObject({ name: 'Doomed', vehicles: [{ make: 'BMW' }] });
    expect((await client.delete(`/api/v1/admin/garages/${garageId}`)).status).toBe(204);
    expect((await client.delete(`/api/v1/admin/users/${owner.userId}`)).status).toBe(204);
    expect((await client.get(`/api/v1/admin/users/${owner.userId}`)).status).toBe(404);

    expect((await client.delete(`/api/v1/admin/users/${root.userId}`)).status).toBe(409);
  });

  it('overrides a flag and clears it again', async () => {
    const client = as(context, root);
    const off = await client.patch('/api/v1/admin/flags', { passport: false });
    expect(off.body).toContainEqual(
      expect.objectContaining({ flag: 'passport', enabled: false, override: false, default: true }),
    );
    expect(isEnabled(env(), 'passport')).toBe(false);

    await client.patch('/api/v1/admin/flags', { passport: null });
    expect(isEnabled(env(), 'passport')).toBe(true);
  });

  it('writes every change to the audit log', async () => {
    const log = await as(context, root).get('/api/v1/admin/audit?q=admin.');
    const actions = (log.body as { data: { action: string }[] }).data.map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'admin.user.updated',
        'admin.user.sessions_revoked',
        'admin.garage.deleted',
        'admin.user.deleted',
        'admin.flags.updated',
      ]),
    );
  });

  it('logs every question to the model, with its tokens summed across turns', async () => {
    turns.push(
      {
        text: null,
        calls: [{ name: 'list_vehicles', args: {} }],
        usage: { inputTokens: 100, outputTokens: 10 },
      },
      { text: 'None yet.', calls: [], usage: { inputTokens: 150, outputTokens: 20 } },
      new Error('provider down'),
    );
    expect(
      (await as(context, bob).post('/api/v1/ai/ask', { question: 'What do I own?' })).status,
    ).toBe(200);
    expect((await as(context, bob).post('/api/v1/ai/ask', { question: 'Again?' })).status).toBe(
      500,
    );

    const rows = await context.database.db.select().from(schema.aiRequests);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: bob.userId,
          status: 'ok',
          turns: 2,
          inputTokens: 250,
          outputTokens: 30,
        }),
        expect.objectContaining({ status: 'error', turns: 0, error: 'provider down' }),
      ]),
    );
  });

  it('logs each delivery channel, and a failed one does not cost the other', async () => {
    const db = context.database.db;
    // Off the harness's reserved test domain, which delivery never emails.
    const address = 'bob@mail.garaj.dev';
    await db.update(schema.users).set({ email: address }).where(eq(schema.users.id, bob.userId));
    await db
      .insert(schema.deviceTokens)
      .values({ userId: bob.userId, token: 'ExponentPushToken[bob]', platform: 'ios' });
    await db.insert(schema.notifications).values({
      userId: bob.userId,
      notificationType: 'TASK_DUE',
      title: 'Wash the car',
      body: 'Today.',
      dedupeKey: 'admin-test',
    });
    const outcome = await deliverNotification(
      db,
      {
        email: { send: () => Promise.reject(new Error('Email provider returned 503')) },
        push: { send: () => Promise.resolve({ invalid: [] }) },
      },
      { userId: bob.userId, dedupeKey: 'admin-test', now: new Date('2026-06-01T12:00:00Z') },
    );
    expect(outcome).toMatchObject({ status: 'sent', channels: ['PUSH'] });

    const usage = await as(context, root).get('/api/v1/admin/usage?days=7');
    expect(usage.body).toMatchObject({
      ai: { requests: 2, errors: 1, inputTokens: 250, outputTokens: 30 },
      email: { sent: 0, failed: 1 },
      push: { sent: 1, failed: 0, devices: [{ platform: 'ios', count: 1 }] },
      notifications: { byType: [{ type: 'TASK_DUE', channel: 'PUSH', count: 1 }] },
      recentFailures: [{ channel: 'EMAIL', error: 'Email provider returned 503' }],
    });
    expect((usage.body as { ai: { topUsers: { email: string }[] } }).ai.topUsers[0]?.email).toBe(
      address,
    );

    const detail = await as(context, root).get(`/api/v1/admin/users/${bob.userId}`);
    expect(detail.body).toMatchObject({
      usage: { aiRequests: 2, aiTokens: 280, pushes: 1, emails: 0 },
    });
  });

  it('counts activity by UTC day, with quiet days as zeros', async () => {
    const activity = await as(context, root).get('/api/v1/admin/activity?days=14');
    const days = (activity.body as { days: { day: string; signups: number; aiRequests: number }[] })
      .days;
    expect(days).toHaveLength(14);
    expect(days.at(-1)).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      aiRequests: 2,
    });
    expect(days.at(-1)!.signups).toBeGreaterThanOrEqual(2);
    // Bob's email failed and his push went: the failure is counted on its own channel.
    expect(days.at(-1)).toMatchObject({ deliveryFailures: 1, emailFailures: 1, pushFailures: 0 });
    expect(days[0]).toMatchObject({ signups: 0 });
    expect((await as(context, root).get('/api/v1/admin/activity?days=500')).status).toBe(400);
  });

  it('reports the system without Redis, and the outbox from the database', async () => {
    const system = await as(context, root).get('/api/v1/admin/system');
    expect(system.body).toMatchObject({
      redis: { configured: false },
      outbox: { deadLettered: 0 },
    });
  });

  it('filters and sorts the lists', async () => {
    const client = as(context, root);
    const ids = async (url: string) =>
      ((await client.get(url)).body as { data: { id: string }[] }).data.map((row) => row.id);
    const free = await signUp(context, 'Aaron Free', 'FREE');

    // Bob was comped Plus above; the harness signs everyone else up on Business.
    expect(await ids('/api/v1/admin/users?plan=PLUS')).toEqual([bob.userId]);
    expect(await ids('/api/v1/admin/users?plan=FREE')).toEqual([free.userId]);
    expect(await ids('/api/v1/admin/users?plan=PAID')).not.toContain(free.userId);
    // Bob's address was confirmed by hand above; nobody else's has been.
    expect(await ids('/api/v1/admin/users?verified=true')).toEqual([bob.userId]);
    expect(await ids('/api/v1/admin/users?verified=false')).toContain(free.userId);
    expect((await ids('/api/v1/admin/users?sort=oldest'))[0]).toBe(root.userId);
    expect((await ids('/api/v1/admin/users?sort=name'))[0]).toBe(free.userId);
    expect((await client.get('/api/v1/admin/users?sort=sideways')).status).toBe(400);
    const listed = (await client.get('/api/v1/admin/users?q=aaron')).body as {
      data: { image: string | null }[];
    };
    expect(listed.data[0]).toHaveProperty('image');

    const { garageId, vehicleId } = await seedGarageWithVehicle(context, root, 'Fleet');
    const empty = await as(context, bob).post('/api/v1/garages', { name: 'Empty' });
    const emptyId = (empty.body as { id: string }).id;
    expect((await ids('/api/v1/admin/garages'))[0]).toBe(emptyId);
    expect((await ids('/api/v1/admin/garages?sort=vehicles'))[0]).toBe(garageId);
    expect(await ids('/api/v1/admin/vehicles?type=BOAT')).toEqual([]);
    expect(await ids('/api/v1/admin/vehicles?type=CAR&status=ACTIVE')).toContain(vehicleId);
    expect(await ids('/api/v1/admin/vehicles?status=SOLD')).not.toContain(vehicleId);

    await client.post(`/api/v1/vehicles/${vehicleId}/events`, {
      eventType: 'MAINTENANCE',
      title: 'Oil change',
      occurredAt: new Date().toISOString(),
    });
    const overview = (await client.get('/api/v1/admin/overview')).body as {
      counts: { users: number; unverified: number };
      funnel: { garage: number; vehicle: number; record: number };
      vehicleTypes: { type: string; count: number }[];
    };
    // Root's Fleet holds the only car; Bob's garage is empty; Aaron has none.
    expect(overview.funnel).toMatchObject({ garage: 2, vehicle: 1 });
    expect(overview.funnel.record).toBeGreaterThanOrEqual(1);
    expect(overview.vehicleTypes).toContainEqual({ type: 'CAR', count: 1 });
    expect(overview.counts.unverified).toBe(overview.counts.users - 1);
  });

  it('narrows the audit log, and counts it by day under the same filters', async () => {
    const client = as(context, root);
    const rows = async (query: string) =>
      (
        (await client.get(`/api/v1/admin/audit?${query}`)).body as {
          data: { action: string; actorEmail: string | null }[];
        }
      ).data;

    const fromConsole = await rows('action=admin.');
    expect(fromConsole.length).toBeGreaterThan(0);
    expect(fromConsole.every((row) => row.action.startsWith('admin.'))).toBe(true);
    // An underscore in the prefix is a letter, not a one-character wildcard.
    expect((await rows('action=admin.user.sessions_')).map((row) => row.action)).toEqual([
      'admin.user.sessions_revoked',
    ]);
    const mine = await rows(`actor=${encodeURIComponent(root.email)}`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((row) => row.actorEmail === root.email)).toBe(true);

    const volume = (await client.get('/api/v1/admin/audit/volume?days=7&action=admin.')).body as {
      days: { day: string; count: number }[];
    };
    expect(volume.days).toHaveLength(7);
    expect(volume.days.at(-1)).toMatchObject({
      day: new Date().toISOString().slice(0, 10),
      count: fromConsole.length,
    });
    expect((await client.get('/api/v1/admin/audit/volume?days=365')).status).toBe(400);
  });

  it('streams every failure, newest first, from each source', async () => {
    await context.database.db.insert(schema.outboxMessages).values({
      queue: 'notifications',
      jobName: 'deliver',
      payload: {},
      jobKey: 'admin-test-dead',
      attempts: 5,
      lastError: 'gave up',
      deadLetteredAt: new Date(),
    });
    const client = as(context, root);
    type Errors = {
      data: { source: string; kind: string; message: string | null; at: string }[];
      hasMore: boolean;
    };

    const all = (await client.get('/api/v1/admin/errors')).body as Errors;
    expect(all.data.map((row) => row.source).sort()).toEqual(['ai', 'email', 'outbox']);
    expect(all.data[0]).toMatchObject({
      source: 'outbox',
      kind: 'notifications · deliver',
      message: 'gave up',
    });
    const times = all.data.map((row) => Date.parse(row.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const ai = (await client.get('/api/v1/admin/errors?source=ai')).body as Errors;
    expect(ai.data).toEqual([expect.objectContaining({ source: 'ai', message: 'provider down' })]);
    const second = (await client.get('/api/v1/admin/errors?limit=1&offset=1')).body as Errors;
    expect(second).toEqual({ data: [all.data[1]], hasMore: true });
  });

  it('opens one vehicle with its garage, logbook and what it has cost', async () => {
    const client = as(context, root);
    const { garageId, vehicleId } = await seedGarageWithVehicle(context, root, 'Detail');
    await client.post(`/api/v1/vehicles/${vehicleId}/events`, {
      eventType: 'MAINTENANCE',
      title: 'Brake pads',
      occurredAt: new Date().toISOString(),
      costAmountMinor: 12_500,
      costCurrency: 'USD',
    });

    const detail = await client.get(`/api/v1/admin/vehicles/${vehicleId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      make: 'BMW',
      currentOdometer: 36_000,
      photoUrl: null,
      garage: { id: garageId, name: 'Detail' },
      owner: { id: root.userId, email: root.email },
      counts: { events: expect.any(Number), openTasks: 0 },
      recentEvents: [expect.objectContaining({ title: 'Brake pads', costAmountMinor: 12_500 })],
    });
    // The cost on the timeline reached the bill through its mirrored expense.
    expect((detail.body as { spending: unknown[] }).spending).toContainEqual(
      expect.objectContaining({ currency: 'USD', amountMinor: 12_500 }),
    );
    expect(
      (await client.get('/api/v1/admin/vehicles/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(404);
  });

  it('names who the console lets in, and an id that matches nobody', async () => {
    admin.ids = `${root.userId}, not-a-uuid`;
    const admins = (await as(context, root).get('/api/v1/admin/admins')).body;
    expect(admins).toEqual([
      expect.objectContaining({ id: root.userId, email: root.email }),
      { id: 'not-a-uuid', name: null, email: null, image: null, lastSeenAt: null },
    ]);
    admin.ids = root.userId;
  });

  it('reads the day window and Redis INFO correctly', () => {
    const now = new Date('2026-03-31T23:59:00Z');
    expect(windowStart(7, now).toISOString()).toBe('2026-03-25T00:00:00.000Z');
    expect(daysFrom(windowStart(7, now), now)).toEqual([
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
    expect(parseInfo('# Memory\r\nused_memory:1024\r\nredis_version:7.2.4\r\n')).toEqual({
      used_memory: '1024',
      redis_version: '7.2.4',
    });
  });
});
