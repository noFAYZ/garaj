import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

const iso = (value: string) => new Date(value).toISOString();

const inDays = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

describe('search, health and the dashboard', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Insight Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;

    const client = as(context, alice);
    await client.post(`/api/v1/vehicles/${vehicleId}/events`, {
      eventType: 'MAINTENANCE',
      title: 'Gearbox rebuild at Hoffman Motors',
      occurredAt: iso('2026-05-01T10:00:00Z'),
      costAmountMinor: 250_000,
      costCurrency: 'USD',
      provider: 'Hoffman Motors',
    });
    await client.post('/api/v1/tasks', {
      garageId,
      vehicleId,
      title: 'Order replacement wiper blades',
      dueDate: inDays(-3),
      priority: 'HIGH',
    });
    await client.post(`/api/v1/vehicles/${vehicleId}/maintenance`, {
      title: 'Timing belt',
      intervalMonths: 1,
      lastPerformedAt: iso('2020-01-01T00:00:00Z'),
    });
  });

  afterAll(async () => {
    await context.close();
  });

  describe('search', () => {
    const find = (query: string) =>
      as(context, alice).get(`/api/v1/search?q=${encodeURIComponent(query)}`);

    it('finds a timeline event by its title', async () => {
      const response = await find('gearbox');
      const results = (response.body as { results: { type: string; title: string }[] }).results;

      expect(response.status).toBe(200);
      expect(results.some((row) => row.type === 'EVENT' && row.title.includes('Gearbox'))).toBe(
        true,
      );
    });

    it('finds an idea by its title, and hides it once deleted', async () => {
      const [idea] = await context.database.db
        .insert(schema.ideas)
        .values({ vehicleId, title: 'Coilover conversion' })
        .returning();

      const hits = async () =>
        ((await find('coilover')).body as { results: { type: string; id: string }[] }).results;
      expect(await hits()).toContainEqual(expect.objectContaining({ type: 'IDEA', id: idea!.id }));

      const outsider = await as(context, bob).get('/api/v1/search?q=coilover');
      expect((outsider.body as { results: unknown[] }).results).toHaveLength(0);

      await context.database.db.update(schema.ideas).set({ deletedAt: new Date() });
      expect(await hits()).toHaveLength(0);
    });

    it('finds a vehicle by its make', async () => {
      const results = (await find('BMW')).body as { results: { type: string }[] };
      expect(results.results.some((row) => row.type === 'VEHICLE')).toBe(true);
    });

    it('searches across types at once and counts them', async () => {
      const body = (await find('belt')).body as {
        results: { type: string }[];
        counts: Record<string, number>;
      };

      expect(body.counts.MAINTENANCE).toBeGreaterThan(0);
    });

    it('narrows to one type when asked', async () => {
      const response = await as(context, alice).get('/api/v1/search?q=belt&type=MAINTENANCE');
      const results = (response.body as { results: { type: string }[] }).results;

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((row) => row.type === 'MAINTENANCE')).toBe(true);
    });

    /** A hit whose title starts with the term is more useful than one that buries it. */
    it('ranks a title that starts with the term above one that merely contains it', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Rank Garage');
      const client = as(context, alice);
      await client.post(`/api/v1/vehicles/${other.vehicleId}/maintenance`, {
        title: 'Brake fluid change',
        intervalMonths: 24,
      });
      await client.post(`/api/v1/vehicles/${other.vehicleId}/maintenance`, {
        title: 'Rear brake pads',
        intervalMonths: 24,
      });

      const results = (
        (await as(context, alice).get('/api/v1/search?q=brake&type=MAINTENANCE')).body as {
          results: { title: string; relevance: number }[];
        }
      ).results;

      const starts = results.find((row) => row.title === 'Brake fluid change')!;
      const contains = results.find((row) => row.title === 'Rear brake pads')!;
      expect(starts.relevance).toBeGreaterThan(contains.relevance);
      expect(results.indexOf(starts)).toBeLessThan(results.indexOf(contains));
    });

    /*
     * §83. The scope is applied inside the query, so there is no moment where another
     * garage's rows have been read and are one bug away from being returned.
     */
    it('shows nothing from a garage the caller is not in', async () => {
      const response = await as(context, bob).get('/api/v1/search?q=gearbox');
      expect((response.body as { results: unknown[] }).results).toEqual([]);
    });

    it('treats a wildcard character as a character, not a wildcard', async () => {
      const response = await as(context, alice).get('/api/v1/search?q=%25%25');
      expect((response.body as { results: unknown[] }).results).toEqual([]);
    });

    it('refuses a single-character query rather than returning the whole garage', async () => {
      const response = await as(context, alice).get('/api/v1/search?q=a');
      expect(response.status).toBe(400);
    });
  });

  describe('vehicle health', () => {
    it('scores the vehicle and explains every deduction', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/health`);
      const body = response.body as {
        overall: number;
        categories: { category: string; score: number | null }[];
        factors: { category: string; label: string; penalty: number }[];
        summary: string;
      };

      expect(response.status).toBe(200);
      // An overdue timing belt and an overdue high-priority task.
      expect(body.factors.some((factor) => factor.label === 'Timing belt')).toBe(true);
      expect(body.factors.some((factor) => factor.category === 'TASKS')).toBe(true);
      expect(body.overall).toBeLessThan(100);
      expect(body.summary).toBeTruthy();
    });

    /*
     * The arithmetic has to be checkable by hand — that is what §33 means by explainable.
     */
    it('reports a score its own factors add up to', async () => {
      const body = (await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/health`)).body as {
        categories: { category: string; score: number | null }[];
        factors: { category: string; penalty: number }[];
      };

      for (const category of body.categories) {
        if (category.score === null) continue;
        const deducted = body.factors
          .filter((factor) => factor.category === category.category)
          .reduce((total, factor) => total + factor.penalty, 0);
        expect(category.score).toBe(Math.max(0, 100 - deducted));
      }
    });

    it('says it cannot judge a vehicle with nothing recorded', async () => {
      const bare = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'BICYCLE',
        make: 'Surly',
        model: 'Cross-Check',
      });
      const bareId = (bare.body as { id: string }).id;

      const body = (await as(context, alice).get(`/api/v1/vehicles/${bareId}/health`)).body as {
        overall: number | null;
        summary: string;
      };

      expect(body.overall).toBeNull();
      expect(body.summary).toContain('Not enough recorded');
    });

    it('answers 404 for a vehicle in another garage', async () => {
      const response = await as(context, bob).get(`/api/v1/vehicles/${vehicleId}/health`);
      expect(response.status).toBe(404);
    });
  });

  describe('dashboard', () => {
    it('returns the summary, what needs attention, activity and a briefing', async () => {
      const response = await as(context, alice).get('/api/v1/dashboard');
      const body = response.body as {
        summary: { vehicles: number; garages: number; averageHealth: number | null };
        attention: { maintenance: unknown[]; overdueTasks: number; total: number };
        recentActivity: { title: string }[];
        briefing: string[];
      };

      expect(response.status).toBe(200);
      expect(body.summary.vehicles).toBeGreaterThan(0);
      expect(body.attention.maintenance.length).toBeGreaterThan(0);
      expect(body.attention.overdueTasks).toBeGreaterThan(0);
      expect(body.attention.total).toBeGreaterThan(0);
      expect(body.recentActivity.some((item) => item.title.includes('Gearbox'))).toBe(true);
      expect(body.briefing.length).toBeGreaterThan(0);
    });

    it('writes the briefing as sentences a person can read', async () => {
      const briefing = (await as(context, alice).get('/api/v1/dashboard')).body as {
        briefing: string[];
      };

      expect(briefing.briefing.some((line) => line.includes('maintenance'))).toBe(true);
      expect(briefing.briefing.every((line) => line.endsWith('.'))).toBe(true);
    });

    /*
     * A vehicle with nothing recorded has no score, and averaging it in as 100 would let an
     * empty garage report perfect health.
     */
    it('averages health over only the vehicles it could assess', async () => {
      const body = (await as(context, alice).get('/api/v1/dashboard')).body as {
        summary: { averageHealth: number | null; worstVehicle: { health: number } | null };
      };

      expect(body.summary.averageHealth).not.toBeNull();
      expect(body.summary.averageHealth).toBeLessThan(100);
      expect(body.summary.worstVehicle).not.toBeNull();
    });

    it('gives a caller with no garage an empty dashboard rather than an error', async () => {
      const response = await as(context, bob).get('/api/v1/dashboard');
      const body = response.body as {
        summary: { vehicles: number };
        attention: { total: number };
        briefing: string[];
      };

      expect(response.status).toBe(200);
      expect(body.summary.vehicles).toBe(0);
      expect(body.attention.total).toBe(0);
      expect(body.briefing[0]).toContain('Create a garage');
    });

    it('shows nothing from a garage the caller is not in', async () => {
      const body = (await as(context, bob).get('/api/v1/dashboard')).body as {
        recentActivity: unknown[];
      };
      expect(body.recentActivity).toEqual([]);
    });
  });
});
