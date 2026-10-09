import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestContext, setPlan, signUp, type TestContext } from './harness';

/**
 * Plans, limits and entitlements over the real routes (GAPS §10).
 *
 * The harness puts every other test's user on the business plan, so these are the only cases
 * that see a ceiling at all — which makes them the ones that have to be thorough. Each asserts
 * the *status code* as much as the outcome: 402 and 403 are fixed differently by whoever hits
 * them, and a product that returns the wrong one sends people to the wrong screen.
 */
describe('plans', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  afterAll(async () => {
    await context.close();
  });

  const garageFor = async (user: Awaited<ReturnType<typeof signUp>>, name = 'Home') => {
    const response = await as(context, user).post('/api/v1/garages', { name });
    return (response.body as { id: string }).id;
  };

  const addVehicle = (user: Awaited<ReturnType<typeof signUp>>, garageId: string, n: number) =>
    as(context, user).post('/api/v1/vehicles', {
      id: crypto.randomUUID(),
      garageId,
      vehicleType: 'CAR',
      nickname: `Car ${n}`,
    });

  describe('reporting what the account may do', () => {
    it('reports a free account as free, with its ceilings and what it has used', async () => {
      const user = await signUp(context, 'Free', 'FREE');
      await garageFor(user);

      const response = await as(context, user).get('/api/v1/users/me/plan');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        plan: 'FREE',
        status: 'ACTIVE',
        accountKind: 'PERSONAL',
        entitlements: [],
        limits: { vehicles: 3, garages: 1, members: 2 },
        usage: { vehicles: 0, garages: 1 },
      });
    });

    it('lists what a business plan includes', async () => {
      const user = await signUp(context, 'Fleet', 'BUSINESS');
      const response = await as(context, user).get('/api/v1/users/me/plan');

      expect((response.body as { entitlements: string[] }).entitlements).toEqual(
        expect.arrayContaining(['passport.share', 'income.track', 'mileage.report']),
      );
    });

    it('keeps the plan while the card is being retried, and drops it once cancelled', async () => {
      const user = await signUp(context, 'Lapsing', 'FREE');
      await setPlan(context, user.userId, 'BUSINESS', 'PAST_DUE');
      let response = await as(context, user).get('/api/v1/users/me/plan');
      expect(response.body).toMatchObject({ plan: 'BUSINESS', status: 'PAST_DUE' });

      await setPlan(context, user.userId, 'BUSINESS', 'CANCELED');
      response = await as(context, user).get('/api/v1/users/me/plan');
      expect(response.body).toMatchObject({ plan: 'FREE', status: 'CANCELED' });
    });
  });

  describe('prices', () => {
    it('answers without billing configured, with no prices rather than an error', async () => {
      // The upgrade screen must render on a deployment with no payment provider: nulls, 200.
      const user = await signUp(context, 'Price check', 'FREE');
      const response = await as(context, user).get('/api/v1/billing/prices');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ PLUS: null, BUSINESS: null });
    });
  });

  describe('limits', () => {
    it('refuses the fourth vehicle on a free plan, and names the tier that holds it', async () => {
      const user = await signUp(context, 'Three cars', 'FREE');
      const garageId = await garageFor(user);

      for (let n = 1; n <= 3; n += 1) {
        expect((await addVehicle(user, garageId, n)).status).toBe(201);
      }

      const refused = await addVehicle(user, garageId, 4);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        error: { code: 'PLAN_LIMIT', fields: { limit: 'vehicles', requiredPlan: 'PLUS' } },
      });
    });

    it('counts vehicles across every garage the person owns', async () => {
      // Two garages is a PLUS thing, and PLUS holds six vehicles — so the ceiling that bites
      // here is the account's, not the garage's, which is the whole point of counting this way.
      const user = await signUp(context, 'Two garages', 'PLUS');
      const first = await garageFor(user, 'One');
      const second = await garageFor(user, 'Two');

      for (let n = 1; n <= 3; n += 1) {
        expect((await addVehicle(user, first, n)).status).toBe(201);
      }
      for (let n = 4; n <= 6; n += 1) {
        expect((await addVehicle(user, second, n)).status).toBe(201);
      }

      const refused = await addVehicle(user, second, 7);
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: { code: 'PLAN_LIMIT' } });
    });

    it('refuses a second garage on a free plan', async () => {
      const user = await signUp(context, 'One garage', 'FREE');
      await garageFor(user, 'First');

      const refused = await as(context, user).post('/api/v1/garages', { name: 'Second' });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        error: { code: 'PLAN_LIMIT', fields: { limit: 'garages' } },
      });
    });

    it('refuses the invitation rather than the acceptance', async () => {
      const owner = await signUp(context, 'Owner', 'FREE');
      const guest = await signUp(context, 'Guest', 'FREE');
      const stranger = await signUp(context, 'Stranger', 'FREE');
      const garageId = await garageFor(owner);

      // Free holds two people, and the owner is one of them.
      expect(
        (
          await as(context, owner).post(`/api/v1/garages/${garageId}/members`, {
            email: guest.email,
            role: 'MEMBER',
          })
        ).status,
      ).toBe(201);

      const refused = await as(context, owner).post(`/api/v1/garages/${garageId}/members`, {
        email: stranger.email,
        role: 'MEMBER',
      });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({
        error: { code: 'PLAN_LIMIT', fields: { limit: 'members' } },
      });
    });
  });

  describe('entitlements', () => {
    it('asks a free owner to upgrade before sharing a passport, naming the plan', async () => {
      const user = await signUp(context, 'Sharer', 'FREE');
      const garageId = await garageFor(user);
      const vehicleId = (await addVehicle(user, garageId, 1)).body as { id: string };

      const refused = await as(context, user).post(`/api/v1/vehicles/${vehicleId.id}/shares`, {
        sections: ['MAINTENANCE'],
      });

      expect(refused.status).toBe(402);
      expect(refused.body).toMatchObject({
        error: {
          code: 'PLAN_REQUIRED',
          fields: { entitlement: 'passport.share', requiredPlan: 'PLUS' },
        },
      });
    });

    it('lets a plus account share one', async () => {
      const user = await signUp(context, 'Plus sharer', 'PLUS');
      const garageId = await garageFor(user);
      const vehicle = (await addVehicle(user, garageId, 1)).body as { id: string };

      const response = await as(context, user).post(`/api/v1/vehicles/${vehicle.id}/shares`, {
        sections: ['MAINTENANCE'],
      });
      expect(response.status).toBe(201);
    });

    it('keeps income to the business plan, and admits it is about money not permission', async () => {
      const user = await signUp(context, 'Plus driver', 'PLUS');
      const garageId = await garageFor(user);
      const vehicle = (await addVehicle(user, garageId, 1)).body as { id: string };

      const refused = await as(context, user).get(`/api/v1/vehicles/${vehicle.id}/income`);
      expect(refused.status).toBe(402);
      expect(refused.body).toMatchObject({
        error: { code: 'PLAN_REQUIRED', fields: { requiredPlan: 'BUSINESS' } },
      });
    });

    it('records and reports income on a business plan', async () => {
      const user = await signUp(context, 'Cab firm', 'BUSINESS');
      const garageId = await garageFor(user);
      const vehicle = (await addVehicle(user, garageId, 1)).body as { id: string };

      const created = await as(context, user).post(`/api/v1/vehicles/${vehicle.id}/income`, {
        category: 'FARE',
        description: 'Airport run',
        amountMinor: 8_400,
        currency: 'USD',
        occurredAt: '2026-03-02T09:00:00.000Z',
      });
      expect(created.status).toBe(201);

      const summary = await as(context, user).get(`/api/v1/vehicles/${vehicle.id}/income/summary`);
      expect(summary.status).toBe(200);
      expect(summary.body).toMatchObject({
        currency: 'USD',
        totalEarned: { amountMinor: 8_400, currency: 'USD' },
        // Nothing spent yet, so the whole fare is the net.
        netMinor: 8_400,
        byCategory: [{ category: 'FARE', amountMinor: 8_400, count: 1 }],
      });
    });

    it('answers 404 for an income row belonging to another vehicle', async () => {
      const user = await signUp(context, 'Two cars', 'BUSINESS');
      const garageId = await garageFor(user);
      const first = (await addVehicle(user, garageId, 1)).body as { id: string };
      const second = (await addVehicle(user, garageId, 2)).body as { id: string };

      const created = await as(context, user).post(`/api/v1/vehicles/${first.id}/income`, {
        category: 'DELIVERY',
        description: 'Run',
        amountMinor: 1_000,
        currency: 'USD',
        occurredAt: '2026-03-02T09:00:00.000Z',
      });
      const incomeId = (created.body as { id: string }).id;

      const response = await as(context, user).delete(
        `/api/v1/vehicles/${second.id}/income/${incomeId}`,
      );
      expect(response.status).toBe(404);
    });

    it('refuses a driver who is not a member of the garage', async () => {
      const owner = await signUp(context, 'Fleet owner', 'BUSINESS');
      const outsider = await signUp(context, 'Outsider', 'BUSINESS');
      const garageId = await garageFor(owner, 'Fleet');
      const otherGarage = await garageFor(outsider, 'Theirs');
      const vehicle = (await addVehicle(owner, garageId, 1)).body as { id: string };

      const members = await as(context, outsider).get(`/api/v1/garages/${otherGarage}/members`);
      const foreignMemberId = (members.body as { id: string }[])[0]!.id;

      const refused = await as(context, owner).post(`/api/v1/vehicles/${vehicle.id}/income`, {
        category: 'FARE',
        description: 'Run',
        amountMinor: 1_000,
        currency: 'USD',
        occurredAt: '2026-03-02T09:00:00.000Z',
        driverId: foreignMemberId,
      });

      expect(refused.status).toBe(400);
    });
  });
});
