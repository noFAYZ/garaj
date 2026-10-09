import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  deliverNotification,
  isDeliverableAddress,
  nextSendableTime,
  type EmailMessage,
  type PushPort,
} from '../src/modules/notifications/application/services/deliver';
import { as, createTestContext, signUp, type SignedUpUser, type TestContext } from './harness';

describe('quiet hours', () => {
  it('sends at once during the day, and holds the night until 08:00 local', () => {
    const noonUtc = new Date('2026-06-01T12:00:00Z');
    expect(nextSendableTime(noonUtc, 'UTC')).toEqual(noonUtc);

    // 07:00 UTC is 03:00 in New York (EDT): held five hours, to 08:00 there.
    const morningUtc = new Date('2026-06-01T07:00:00Z');
    expect(nextSendableTime(morningUtc, 'America/New_York').toISOString()).toBe(
      '2026-06-01T12:00:00.000Z',
    );

    // 22:30 in Berlin (CEST) waits past midnight.
    expect(nextSendableTime(new Date('2026-06-01T20:30:00Z'), 'Europe/Berlin').toISOString()).toBe(
      '2026-06-02T06:00:00.000Z',
    );
  });

  it('falls back to UTC for a zone it cannot read', () => {
    const noon = new Date('2026-06-01T12:00:00Z');
    expect(nextSendableTime(noon, 'Not/AZone')).toEqual(noon);
  });
});

describe('delivery', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  const noon = new Date('2026-06-01T12:00:00Z');

  const sentEmail: EmailMessage[] = [];
  const pushed: string[][] = [];
  const email = { send: async (message: EmailMessage) => void sentEmail.push(message) };
  const push: PushPort = {
    send: async (tokens) => {
      pushed.push([...tokens]);
      return { invalid: tokens.filter((token) => token.includes('dead')) };
    },
  };

  const notify = async (dedupeKey: string) => {
    await context.database.db.insert(schema.notifications).values({
      userId: alice.userId,
      notificationType: 'MAINTENANCE_DUE',
      title: 'Oil change due',
      body: 'Due in 300 km.',
      dedupeKey,
    });
  };

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    // Off the reserved test domain the harness signs up on, which is never emailed (below).
    await context.database.db
      .update(schema.users)
      .set({ email: 'alice@mail.garaj.dev' })
      .where(eq(schema.users.id, alice.userId));
  });

  it('never emails a reserved domain, which could only bounce', async () => {
    expect(isDeliverableAddress('someone@example.test')).toBe(false);
    expect(isDeliverableAddress('someone@example.com')).toBe(false);
    expect(isDeliverableAddress('someone@mail.garaj.dev')).toBe(true);

    const bob = await signUp(context, 'Bob');
    await context.database.db.insert(schema.notifications).values({
      userId: bob.userId,
      notificationType: 'MAINTENANCE_DUE',
      title: 'Oil change due',
      body: 'Due in 300 km.',
      dedupeKey: 'RESERVED',
    });
    const before = sentEmail.length;

    const outcome = await deliverNotification(
      context.database.db,
      { email, push: null },
      { userId: bob.userId, dedupeKey: 'RESERVED', now: noon },
    );

    expect(outcome.status).toBe('skipped');
    expect(sentEmail).toHaveLength(before);
  });

  afterAll(async () => {
    await context.close();
  });

  it('registers a device, idempotently', async () => {
    const register = () =>
      as(context, alice).post('/api/v1/notifications/devices', {
        token: 'ExponentPushToken[alive]',
        platform: 'ios',
      });
    expect((await register()).status).toBe(204);
    expect((await register()).status).toBe(204);

    const rows = await context.database.db.select().from(schema.deviceTokens);
    expect(rows).toHaveLength(1);
  });

  it('sends to every enabled channel and prunes dead tokens', async () => {
    await context.database.db
      .insert(schema.deviceTokens)
      .values({ userId: alice.userId, token: 'ExponentPushToken[dead]', platform: 'android' });
    await notify('K1');

    const outcome = await deliverNotification(
      context.database.db,
      { email, push },
      { userId: alice.userId, dedupeKey: 'K1', now: noon },
    );

    expect(outcome).toMatchObject({ status: 'sent', channels: ['EMAIL', 'PUSH'] });
    expect(sentEmail.at(-1)).toMatchObject({ subject: 'Oil change due', text: 'Due in 300 km.' });
    expect(pushed.at(-1)).toHaveLength(2);

    const left = await context.database.db.select().from(schema.deviceTokens);
    expect(left.map((row) => row.token)).toEqual(['ExponentPushToken[alive]']);
  });

  it('honours a channel switched off for that type', async () => {
    const off = await as(context, alice).put('/api/v1/notifications/preferences', {
      preferences: [{ notificationType: 'MAINTENANCE_DUE', channel: 'EMAIL', enabled: false }],
    });
    expect(off.status).toBe(204);

    const grid = await as(context, alice).get('/api/v1/notifications/preferences');
    expect(grid.body).toContainEqual({
      notificationType: 'MAINTENANCE_DUE',
      channel: 'EMAIL',
      enabled: false,
    });

    await notify('K2');
    const before = sentEmail.length;
    const outcome = await deliverNotification(
      context.database.db,
      { email, push },
      { userId: alice.userId, dedupeKey: 'K2', now: noon },
    );

    expect(outcome).toMatchObject({ status: 'sent', channels: ['PUSH'] });
    expect(sentEmail.length).toBe(before);
  });

  it('defers at night and skips what has already been read', async () => {
    await notify('K3');
    const night = await deliverNotification(
      context.database.db,
      { email, push },
      { userId: alice.userId, dedupeKey: 'K3', now: new Date('2026-06-01T02:00:00Z') },
    );
    expect(night.status).toBe('deferred');

    await as(context, alice).post('/api/v1/notifications/read-all');
    const later = await deliverNotification(
      context.database.db,
      { email, push },
      { userId: alice.userId, dedupeKey: 'K3', now: noon },
    );
    expect(later).toMatchObject({ status: 'skipped', reason: 'already read in-app' });
  });

  it('retries only when nothing went out', async () => {
    await notify('K4');
    const broken = { send: async () => Promise.reject(new Error('provider down')) };
    await expect(
      deliverNotification(
        context.database.db,
        { email: broken, push: null },
        { userId: alice.userId, dedupeKey: 'K4', now: noon },
      ),
    ).resolves.toMatchObject({ status: 'skipped' });

    // EMAIL was switched off above for this type, so re-enable it to see the throw.
    await as(context, alice).put('/api/v1/notifications/preferences', {
      preferences: [{ notificationType: 'MAINTENANCE_DUE', channel: 'EMAIL', enabled: true }],
    });
    await expect(
      deliverNotification(
        context.database.db,
        { email: broken, push: null },
        { userId: alice.userId, dedupeKey: 'K4', now: noon },
      ),
    ).rejects.toThrow('provider down');
  });
});
