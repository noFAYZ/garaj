/**
 * Integration harness: the real app, the real schema, no containers.
 *
 * `buildApp` is given a PGlite database and no Redis, then driven through `app.inject()` —
 * so routes, TypeBox validation, the error handler, Better Auth and the authorization
 * checks all run exactly as they do in production, minus the socket.
 */

import { createTestDatabase, type TestDatabase } from '@vehicle-os/database/testing';
import { schema } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import type { PlanTier } from '@vehicle-os/domain';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import {
  createMemoryStorage,
  type MemoryStorage,
} from '../src/infrastructure/storage/memory-storage';
import type { AiProviderPort } from '../src/modules/ai/infrastructure/ai-port';

export interface TestContext {
  readonly app: FastifyInstance;
  readonly database: TestDatabase;
  readonly storage: MemoryStorage;
  readonly close: () => Promise<void>;
}

export async function createTestContext(
  options: { ai?: AiProviderPort } = {},
): Promise<TestContext> {
  // Set before `buildApp` reads it: config is parsed once per process and cached.
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.AUTH_SECRET ??= 'test-secret-at-least-thirty-two-characters-long';
  process.env.OBJECT_STORAGE_ENDPOINT ??= 'http://localhost:9000';
  process.env.OBJECT_STORAGE_BUCKET ??= 'test';
  process.env.OBJECT_STORAGE_ACCESS_KEY ??= 'test';
  process.env.OBJECT_STORAGE_SECRET_KEY ??= 'test';
  // Turns the `ai` feature flag on. No provider is ever reached — the tests inject one.
  process.env.AI_API_KEY ??= 'test-ai-key';

  const database = await createTestDatabase();
  const storage = createMemoryStorage();
  const app = await buildApp({ db: database.db, redis: null, storage, ai: options.ai });
  await app.ready();

  return {
    app,
    database,
    storage,
    async close() {
      await app.close();
      await database.close();
    },
  };
}

export interface SignedUpUser {
  readonly userId: string;
  readonly email: string;
  /** Ready to pass as a `cookie` header on subsequent requests. */
  readonly cookie: string;
}

let sequence = 0;

/**
 * Registers a user through the real sign-up route and returns their session cookie.
 *
 * On the business plan by default (GAPS §10). These tests are about the features, not the
 * ceiling: a case that creates five vehicles is testing that pagination walks a cursor, and
 * having it fail on a plan limit would prove nothing about pagination and hide whatever it
 * was actually asserting. The limits have their own tests, which set the plan deliberately —
 * see `plans.test.ts`.
 */
export async function signUp(
  context: TestContext,
  name = 'Test User',
  plan: PlanTier = 'BUSINESS',
): Promise<SignedUpUser> {
  const email = `user${++sequence}.${Date.now()}@example.test`;
  const password = 'correct-horse-battery-staple';

  const response = await context.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password, name },
  });

  if (response.statusCode >= 400) {
    throw new Error(`Sign-up failed (${response.statusCode}): ${response.body}`);
  }

  /*
   * Several Set-Cookie headers can come back. Only the name=value pair before the first
   * `;` belongs in a request Cookie header — sending the attributes back (Path, HttpOnly,
   * SameSite) produces a header the server cannot parse, and the session silently reads as
   * anonymous.
   */
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');

  const body = JSON.parse(response.body) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!userId) throw new Error(`Sign-up returned no user id: ${response.body}`);

  if (plan !== 'FREE') await setPlan(context, userId, plan);

  return { userId, email, cookie };
}

/**
 * Put an account on a plan, the way a completed checkout will.
 *
 * Writes the row the entitlement check reads, rather than stubbing the check — so a test that
 * asserts a 402 is asserting the same path a real free account takes.
 */
export async function setPlan(
  context: TestContext,
  userId: string,
  plan: PlanTier,
  status: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE' = 'ACTIVE',
): Promise<void> {
  await context.database.db
    .insert(schema.subscriptions)
    .values({ id: newId(), userId, plan, status })
    .onConflictDoUpdate({ target: schema.subscriptions.userId, set: { plan, status } });
}

// --- Request helpers --------------------------------------------------------

/**
 * A thin wrapper over `app.inject` that carries a user's cookie and parses the body.
 *
 * Every test that touches authorization needs "act as this specific person", so making it
 * one argument keeps the intent of each case visible instead of buried in header plumbing.
 */
export function as(context: TestContext, user: SignedUpUser) {
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => {
    const response = await context.app.inject({
      method,
      url,
      headers: { cookie: user.cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    // Parsed only when the server said it sent JSON: the export routes return CSV, and a
    // harness that parses every body unconditionally fails those with a syntax error
    // instead of the assertion the test is actually making.
    const isJson = String(response.headers['content-type'] ?? '').includes('json');
    return {
      status: response.statusCode,
      body: (isJson && response.body ? JSON.parse(response.body) : undefined) as unknown,
      text: response.body,
      raw: response,
    };
  };

  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload),
    put: (url: string, payload?: unknown) => call('PUT', url, payload),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload),
    delete: (url: string) => call('DELETE', url),
  };
}

export interface SeededGarage {
  readonly garageId: string;
  readonly vehicleId: string;
}

/** A garage owned by `user` with one car in it — the starting point for most cases. */
export async function seedGarageWithVehicle(
  context: TestContext,
  user: SignedUpUser,
  name = 'Test Garage',
): Promise<SeededGarage> {
  const client = as(context, user);

  const garage = await client.post('/api/v1/garages', { name });
  if (garage.status !== 201)
    throw new Error(`Garage create failed: ${JSON.stringify(garage.body)}`);
  const garageId = (garage.body as { id: string }).id;

  const vehicle = await client.post('/api/v1/vehicles', {
    garageId,
    vehicleType: 'CAR',
    make: 'BMW',
    model: 'M3',
    year: 2021,
    currentOdometer: 36_000,
    odometerUnit: 'KM',
  });
  if (vehicle.status !== 201) {
    throw new Error(`Vehicle create failed: ${JSON.stringify(vehicle.body)}`);
  }

  return { garageId, vehicleId: (vehicle.body as { id: string }).id };
}
