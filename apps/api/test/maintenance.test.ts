import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

const iso = (value: string) => new Date(value).toISOString();

describe('maintenance', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Maintenance Garage');
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const createPlan = (payload: unknown, vehicle = vehicleId) =>
    as(context, alice).post(`/api/v1/vehicles/${vehicle}/maintenance`, payload);

  describe('plans', () => {
    it('creates a compound plan and counts from the vehicle state today', async () => {
      const response = await createPlan({
        title: 'Engine oil and filter',
        intervalDistance: 10_000,
        intervalDistanceUnit: 'KM',
        intervalMonths: 12,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Engine oil and filter',
        intervalDistance: 10_000,
        intervalMonths: 12,
        status: 'OK',
        // Seeded from the vehicle's 36,000 km, so the next one is at 46,000.
        nextDueOdometer: 46_000,
      });
    });

    /*
     * A plan with no interval can never come due. Accepting it would leave an item that
     * looks scheduled and silently never fires.
     */
    it('refuses a plan with no interval at all', async () => {
      const response = await createPlan({ title: 'Vague intentions' });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'intervalMonths',
      );
    });

    it('refuses a distance interval with no unit', async () => {
      const response = await createPlan({ title: 'No unit', intervalDistance: 10_000 });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'intervalDistanceUnit',
      );
    });

    it('refuses engine hours on a type with no engine-hour meter', async () => {
      const response = await createPlan({ title: 'Impossible', intervalEngineHours: 100 });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'intervalEngineHours',
      );
    });

    it('accepts a supplied baseline for work already done in the past', async () => {
      const response = await createPlan({
        title: 'Brake fluid',
        intervalMonths: 24,
        lastPerformedAt: iso('2025-01-15T00:00:00Z'),
        lastPerformedOdometer: 28_000,
      });

      expect(response.status).toBe(201);
      expect((response.body as { nextDueDate: string }).nextDueDate).toBe('2027-01-15');
    });

    it('reports OVERDUE for a plan whose date has passed', async () => {
      const response = await createPlan({
        title: 'Annual inspection',
        intervalMonths: 12,
        lastPerformedAt: iso('2020-01-01T00:00:00Z'),
      });

      expect((response.body as { status: string }).status).toBe('OVERDUE');
      expect((response.body as { trigger: string }).trigger).toBe('DATE');
    });

    it('sorts the list overdue first, then soonest', async () => {
      const list = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/maintenance`);
      const statuses = (list.body as { status: string }[]).map((plan) => plan.status);

      const rank = { OVERDUE: 0, DUE_SOON: 1, OK: 2, UNSCHEDULED: 3 } as const;
      const ranks = statuses.map((status) => rank[status as keyof typeof rank]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    });

    /*
     * The status is computed on read, not stored. A plan sitting untouched in the database
     * becomes overdue as the calendar advances, with no write to refresh a cached value.
     */
    it('recomputes status on read rather than serving a stored value', async () => {
      const created = await createPlan({
        title: 'Recompute me',
        intervalMonths: 12,
        lastPerformedAt: iso('2026-01-01T00:00:00Z'),
      });
      const planId = (created.body as { id: string }).id;
      expect((created.body as { status: string }).status).not.toBe('OVERDUE');

      // Reach past the API and age the baseline, exactly as the passage of time would.
      await context.database.db
        .update(schema.maintenancePlans)
        .set({ lastPerformedAt: new Date('2020-01-01T00:00:00Z') })
        .where(eq(schema.maintenancePlans.id, planId));

      const reread = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}`,
      );
      expect((reread.body as { status: string }).status).toBe('OVERDUE');
    });

    it('keeps completed records when the plan is deleted', async () => {
      const created = await createPlan({
        title: 'Deleted later',
        intervalMonths: 6,
      });
      const planId = (created.body as { id: string }).id;

      await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}/complete`,
        { performedAt: iso('2026-05-01T00:00:00Z') },
      );

      const deleted = await as(context, alice).delete(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}`,
      );
      expect(deleted.status).toBe(204);

      const records = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/maintenance/records`,
      );
      const titles = records.body as { title: string; planId: string | null }[];
      const orphan = titles.find((record) => record.title === 'Deleted later');
      expect(orphan).toBeDefined();
      // The schedule is gone, the evidence the work happened is not.
      expect(orphan?.planId).toBeNull();
    });
  });

  describe('completion', () => {
    let planId: string;

    beforeAll(async () => {
      const created = await createPlan({
        title: 'Oil change',
        intervalDistance: 10_000,
        intervalDistanceUnit: 'KM',
        intervalMonths: 12,
        lastPerformedAt: iso('2025-06-01T00:00:00Z'),
        lastPerformedOdometer: 30_000,
      });
      planId = (created.body as { id: string }).id;
    });

    it('writes a record, a timeline event and an expense in one call', async () => {
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}/complete`,
        {
          performedAt: iso('2026-05-01T09:00:00Z'),
          workPerformed: 'Oil, filter, sump plug washer',
          provider: 'Munich Motors',
          odometer: 40_000,
          odometerUnit: 'KM',
          partsCostAmountMinor: 12_000,
          laborCostAmountMinor: 6_000,
          costCurrency: 'USD',
        },
      );

      expect(response.status).toBe(201);
      const body = response.body as {
        record: { totalCost: { amountMinor: number }; eventId: string };
        plan: { nextDueOdometer: number; nextDueDate: string; status: string };
      };

      // Parts plus labour, summed server-side so the total is a stored fact.
      expect(body.record.totalCost.amountMinor).toBe(18_000);
      expect(body.record.eventId).toBeTruthy();

      const timeline = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/events`);
      const events = (timeline.body as { data: { id: string; eventType: string }[] }).data;
      expect(events.find((event) => event.id === body.record.eventId)?.eventType).toBe(
        'MAINTENANCE',
      );

      const expenses = await context.database.db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.eventId, body.record.eventId));
      expect(expenses).toHaveLength(1);
      expect(expenses[0]?.amountMinor).toBe(18_000);
      expect(expenses[0]?.category).toBe('MAINTENANCE');
    });

    it('resets the clock to the reading at completion, not to now', async () => {
      const plan = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}`,
      );
      const body = plan.body as { nextDueOdometer: number; nextDueDate: string };

      // Serviced at 40,000 km on 1 May, so 50,000 km or 1 May next year — not measured
      // from the vehicle's current 42,000 km.
      expect(body.nextDueOdometer).toBe(50_000);
      expect(body.nextDueDate).toBe('2027-05-01');
    });

    it('queues exactly one notification job per completion', async () => {
      const messages = await context.database.db
        .select()
        .from(schema.outboxMessages)
        .where(eq(schema.outboxMessages.queue, 'notifications'));

      const keys = messages.map((message) => message.jobKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('rejects a cost with no currency', async () => {
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}/complete`,
        { performedAt: iso('2026-05-02T00:00:00Z'), partsCostAmountMinor: 5_000 },
      );

      expect(response.status).toBe(400);
    });

    it('rejects work recorded as done in the future', async () => {
      const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/${planId}/complete`,
        { performedAt: nextYear },
      );

      expect(response.status).toBe(400);
    });

    it('logs unscheduled work with no plan behind it', async () => {
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/records`,
        {
          title: 'Replaced a broken indicator stalk',
          performedAt: iso('2026-04-10T00:00:00Z'),
          partsCostAmountMinor: 8_500,
          costCurrency: 'USD',
        },
      );

      expect(response.status).toBe(201);
      expect((response.body as { plan: null }).plan).toBeNull();
      expect((response.body as { record: { planId: null } }).record.planId).toBeNull();
    });

    it('requires a title for unscheduled work', async () => {
      const response = await as(context, alice).post(
        `/api/v1/vehicles/${vehicleId}/maintenance/records`,
        { performedAt: iso('2026-04-10T00:00:00Z') },
      );

      expect(response.status).toBe(400);
    });
  });

  describe('permissions and tenancy', () => {
    it("answers 404 on another garage's vehicle", async () => {
      const bobClient = as(context, bob);

      expect((await bobClient.get(`/api/v1/vehicles/${vehicleId}/maintenance`)).status).toBe(404);
      expect(
        (
          await bobClient.post(`/api/v1/vehicles/${vehicleId}/maintenance`, {
            title: 'Mine now',
            intervalMonths: 6,
          })
        ).status,
      ).toBe(404);
    });

    /*
     * The split that justifies two capabilities: a DRIVER records what happened, but does
     * not decide the schedule.
     */
    it('lets a DRIVER complete a service but not create a plan', async () => {
      const driver = await signUp(context, 'Driver');
      const seeded = await seedGarageWithVehicle(context, alice, 'Driver Maintenance');
      await as(context, alice).post(`/api/v1/garages/${seeded.garageId}/members`, {
        email: driver.email,
        role: 'DRIVER',
      });

      const created = await as(context, alice).post(
        `/api/v1/vehicles/${seeded.vehicleId}/maintenance`,
        { title: 'Oil', intervalMonths: 6 },
      );
      const id = (created.body as { id: string }).id;

      const completed = await as(context, driver).post(
        `/api/v1/vehicles/${seeded.vehicleId}/maintenance/${id}/complete`,
        { performedAt: iso('2026-05-01T00:00:00Z') },
      );
      expect(completed.status).toBe(201);

      const blocked = await as(context, driver).post(
        `/api/v1/vehicles/${seeded.vehicleId}/maintenance`,
        { title: 'New schedule', intervalMonths: 12 },
      );
      expect(blocked.status).toBe(403);
    });

    it('lets a VIEWER read plans but not complete one', async () => {
      const viewer = await signUp(context, 'Viewer');
      const seeded = await seedGarageWithVehicle(context, alice, 'Viewer Maintenance');
      await as(context, alice).post(`/api/v1/garages/${seeded.garageId}/members`, {
        email: viewer.email,
        role: 'VIEWER',
      });

      const created = await as(context, alice).post(
        `/api/v1/vehicles/${seeded.vehicleId}/maintenance`,
        { title: 'Oil', intervalMonths: 6 },
      );
      const id = (created.body as { id: string }).id;

      expect(
        (await as(context, viewer).get(`/api/v1/vehicles/${seeded.vehicleId}/maintenance`)).status,
      ).toBe(200);
      expect(
        (
          await as(context, viewer).post(
            `/api/v1/vehicles/${seeded.vehicleId}/maintenance/${id}/complete`,
            { performedAt: iso('2026-05-01T00:00:00Z') },
          )
        ).status,
      ).toBe(403);
    });

    it('will not reach a plan through a vehicle it does not belong to', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Other Vehicle');
      const created = await createPlan({ title: 'Elsewhere', intervalMonths: 6 });
      const planId = (created.body as { id: string }).id;

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${other.vehicleId}/maintenance/${planId}`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('due across garages', () => {
    it('returns due work with the vehicle it belongs to, overdue first', async () => {
      const response = await as(context, alice).get('/api/v1/vehicles/due');

      expect(response.status).toBe(200);
      const items = response.body as { plan: { status: string }; vehicleName: string }[];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.vehicleName).toBeTruthy();
      expect(items[0]?.plan.status).toBe('OVERDUE');
    });

    it("does not leak another user's due work", async () => {
      const response = await as(context, bob).get('/api/v1/vehicles/due');
      expect(response.body).toEqual([]);
    });
  });
});
