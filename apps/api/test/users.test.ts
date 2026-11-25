import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

describe('users module', () => {
  let context: TestContext;
  let alice: SignedUpUser;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
  });

  afterAll(async () => {
    await context.close();
  });

  it('rejects an unauthenticated request', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/v1/users/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a bearer token on the very next request after it signs out', async () => {
    // The phone's credential: a bearer token, which only the API's own session cache remembers.
    const signIn = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email: alice.email, password: 'correct-horse-battery-staple' },
    });
    const headers = { authorization: `Bearer ${String(signIn.headers['set-auth-token'])}` };
    const me = () => context.app.inject({ method: 'GET', url: '/api/v1/users/me', headers });

    // Two at once, as a screen sends them: they share one lookup and both get in.
    expect((await Promise.all([me(), me()])).map((r) => r.statusCode)).toEqual([200, 200]);
    const out = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers,
      payload: {},
    });
    expect(out.statusCode).toBe(200);
    expect((await me()).statusCode).toBe(401);
  });

  it('returns the signed-in user with default preferences', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: alice.userId,
      email: alice.email,
      name: 'Alice',
      // No profile row exists yet — the mapper supplies defaults rather than failing.
      locale: 'en-US',
      defaultCurrency: 'USD',
      distanceUnit: 'KM',
    });
  });

  it('creates the profile row lazily on the first preference change', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
      payload: { distanceUnit: 'MI', defaultCurrency: 'GBP' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ distanceUnit: 'MI', defaultCurrency: 'GBP' });
  });

  /*
   * The rule from the settings model: a PATCH carrying one field must not reset the others.
   * A form that sends only what the user touched would otherwise wipe their currency every
   * time they flipped a unit.
   */
  it('leaves untouched preferences alone on a partial update', async () => {
    await context.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
      payload: { timezone: 'Europe/Berlin' },
    });

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
    });

    expect(response.json()).toMatchObject({
      timezone: 'Europe/Berlin',
      distanceUnit: 'MI',
      defaultCurrency: 'GBP',
    });
  });

  it('rejects an unknown currency with a field-level message', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
      payload: { defaultCurrency: 'XYZ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toHaveProperty('defaultCurrency');
  });

  it('rejects an unknown time zone', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
      payload: { timezone: 'Mars/Olympus_Mons' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toHaveProperty('timezone');
  });

  it('rejects an unknown field rather than silently ignoring it', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: '/api/v1/users/me',
      headers: { cookie: alice.cookie },
      payload: { isAdmin: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('reports no garage capabilities before the user joins one', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/users/me/capabilities',
      headers: { cookie: alice.cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ garages: {} });
  });

  it("keeps two users' sessions separate", async () => {
    const bob = await signUp(context, 'Bob');

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie: bob.cookie },
    });

    expect(response.json().id).toBe(bob.userId);
    expect(response.json().id).not.toBe(alice.userId);
  });

  it('deletes the account with the garages it owns, and nothing it does not', async () => {
    const owner = await signUp(context, 'Leaving');
    const other = await signUp(context, 'Staying');
    const mine = await seedGarageWithVehicle(context, owner, 'Mine');
    const theirs = await seedGarageWithVehicle(context, other, 'Theirs');

    const response = await as(context, owner).delete('/api/v1/users/me');

    expect(response.status).toBe(204);
    const { db } = context.database;
    expect(await db.select().from(schema.users).where(eq(schema.users.id, owner.userId))).toEqual(
      [],
    );
    expect(
      await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, mine.vehicleId)),
    ).toEqual([]);
    expect(
      await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, theirs.vehicleId)),
    ).toHaveLength(1);
    // The sessions went with the account.
    expect(
      await db.select().from(schema.sessions).where(eq(schema.sessions.userId, owner.userId)),
    ).toEqual([]);
  });
});
