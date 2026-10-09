import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@vehicle-os/utils';
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

describe('vehicle timeline', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    const seeded = await seedGarageWithVehicle(context, alice, 'Timeline Garage');
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const post = (payload: unknown) =>
    as(context, alice).post(`/api/v1/vehicles/${vehicleId}/events`, payload);

  /*
   * The queue's guarantee (§66): a phone that commits an entry and loses the reply sends the same
   * write again. Landing twice would be a duplicate fill-up, a doubled expense and an odometer
   * moved forward two ways.
   */
  it('takes a client id, and a repeat of it changes nothing', async () => {
    const id = newId();
    const body = {
      id,
      eventType: 'FUEL',
      title: 'Fill-up',
      occurredAt: new Date('2026-06-01T10:00:00Z').toISOString(),
      // Deliberately no odometer: these tests share a vehicle, and raising its reading here
      // would move the ground under the two that check how a reading carries forward.
      costAmountMinor: 6_000,
      costCurrency: 'USD',
    };

    const first = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/events`, body);
    expect(first.status).toBe(201);
    expect((first.body as { event: { id: string } }).event.id).toBe(id);

    const replay = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/events`, body);
    expect(replay.status).toBe(201);

    const list = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/events`);
    const mine = (list.body as { data: { id: string }[] }).data.filter((e) => e.id === id);
    expect(mine).toHaveLength(1);

    // And the cost was mirrored into spending once, not once per attempt.
    const expenses = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/expenses`);
    const mirrored = (expenses.body as { data: { eventId: string | null }[] }).data.filter(
      (expense) => expense.eventId === id,
    );
    expect(mirrored).toHaveLength(1);
  });

  it('records an event and returns it with no warnings', async () => {
    const response = await post({
      eventType: 'MAINTENANCE',
      title: 'Oil and filter',
      occurredAt: iso('2026-03-01T09:00:00Z'),
      odometer: 38_000,
      odometerUnit: 'KM',
      costAmountMinor: 18_000,
      costCurrency: 'USD',
      provider: 'Munich Motors',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      event: {
        eventType: 'MAINTENANCE',
        title: 'Oil and filter',
        odometer: 38_000,
        cost: { amountMinor: 18_000, currency: 'USD' },
        source: 'USER',
      },
      warnings: [],
    });
  });

  it('carries the vehicle odometer forward', async () => {
    const vehicle = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
    expect((vehicle.body as { currentOdometer: number }).currentOdometer).toBe(38_000);
  });

  /*
   * A receipt found months later is entered with an old date and an old reading. It belongs
   * on the timeline at its real position, and it must not drag the current odometer back.
   */
  it('does not lower the vehicle odometer when back-filling an older event', async () => {
    await post({
      eventType: 'FUEL',
      title: 'Fuel stop found in the glovebox',
      occurredAt: iso('2026-01-15T09:00:00Z'),
      odometer: 37_000,
      odometerUnit: 'KM',
    });

    const vehicle = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
    expect((vehicle.body as { currentOdometer: number }).currentOdometer).toBe(38_000);
  });

  /*
   * Clusters get replaced and dashboards get misread. Refusing the write would leave someone
   * unable to record what happened, so the event saves and the response says why it looks odd.
   */
  it('saves a lower reading but warns about it', async () => {
    const response = await post({
      eventType: 'INSPECTION',
      title: 'Post-cluster-swap check',
      occurredAt: iso('2026-04-01T09:00:00Z'),
      odometer: 1_200,
      odometerUnit: 'KM',
    });

    expect(response.status).toBe(201);
    const body = response.body as { warnings: { code: string }[] };
    expect(body.warnings.map((w) => w.code)).toContain('ODOMETER_REGRESSION');
  });

  it('compares against the reading before the event date, not the newest one', async () => {
    // 37,500 sits between the January (37,000) and March (38,000) entries, so it is not a
    // regression even though the vehicle's current reading is higher.
    const response = await post({
      eventType: 'NOTE',
      title: 'Mid-February note',
      occurredAt: iso('2026-02-10T09:00:00Z'),
      odometer: 37_500,
      odometerUnit: 'KM',
    });

    expect((response.body as { warnings: unknown[] }).warnings).toHaveLength(0);
  });

  it('detects a regression across mixed units', async () => {
    const seeded = await seedGarageWithVehicle(context, alice, 'Mixed Units');
    const client = as(context, alice);

    await client.post(`/api/v1/vehicles/${seeded.vehicleId}/events`, {
      eventType: 'NOTE',
      title: 'Miles reading',
      occurredAt: iso('2026-01-01T09:00:00Z'),
      odometer: 100,
      odometerUnit: 'MI',
    });

    // 100 mi is ~160.9 km, so 150 km later is a regression.
    const response = await client.post(`/api/v1/vehicles/${seeded.vehicleId}/events`, {
      eventType: 'NOTE',
      title: 'Kilometres reading',
      occurredAt: iso('2026-02-01T09:00:00Z'),
      odometer: 150,
      odometerUnit: 'KM',
    });

    expect((response.body as { warnings: { code: string }[] }).warnings[0]?.code).toBe(
      'ODOMETER_REGRESSION',
    );
  });

  it('rejects an odometer reading with no unit', async () => {
    const response = await post({
      eventType: 'NOTE',
      title: 'No unit',
      occurredAt: iso('2026-03-05T09:00:00Z'),
      odometer: 39_000,
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
      'odometerUnit',
    );
  });

  it('rejects a cost with no currency', async () => {
    const response = await post({
      eventType: 'EXPENSE',
      title: 'Mystery charge',
      occurredAt: iso('2026-03-05T09:00:00Z'),
      costAmountMinor: 5_000,
    });

    expect(response.status).toBe(400);
  });

  /* A future service has not happened yet — that is a task, not history. */
  it('rejects an event dated in the future', async () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const response = await post({
      eventType: 'MAINTENANCE',
      title: 'Next years service',
      occurredAt: nextYear,
    });

    expect(response.status).toBe(400);
    expect(
      (response.body as { error: { fields: { occurredAt: string } } }).error.fields.occurredAt,
    ).toContain('task');
  });

  describe('listing', () => {
    it('returns newest first', async () => {
      const list = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/events`);
      const dates = (list.body as { data: { occurredAt: string }[] }).data.map(
        (event) => event.occurredAt,
      );

      expect(dates).toEqual([...dates].sort().reverse());
    });

    it('filters by a single event type', async () => {
      const list = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/events?eventType=MAINTENANCE`,
      );
      const types = (list.body as { data: { eventType: string }[] }).data.map((e) => e.eventType);

      expect(types.length).toBeGreaterThan(0);
      expect(new Set(types)).toEqual(new Set(['MAINTENANCE']));
    });

    it('filters by several event types at once', async () => {
      const list = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/events?eventType=MAINTENANCE&eventType=FUEL`,
      );
      const types = new Set(
        (list.body as { data: { eventType: string }[] }).data.map((e) => e.eventType),
      );

      expect(types).toEqual(new Set(['MAINTENANCE', 'FUEL']));
    });

    it('filters by date range', async () => {
      const list = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/events?from=${iso('2026-03-01T00:00:00Z')}`,
      );
      const dates = (list.body as { data: { occurredAt: string }[] }).data;

      expect(dates.every((e) => e.occurredAt >= iso('2026-03-01T00:00:00Z'))).toBe(true);
    });

    /*
     * Three events entered from one invoice share a timestamp to the millisecond. Without the
     * id tiebreak in the keyset, one of them appears on two consecutive pages.
     */
    it('pages without repeating events that share a timestamp', async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Same Timestamp');
      const sameMoment = iso('2026-05-01T12:00:00Z');

      for (let index = 0; index < 5; index += 1) {
        await as(context, alice).post(`/api/v1/vehicles/${seeded.vehicleId}/events`, {
          eventType: 'NOTE',
          title: `Line item ${index}`,
          occurredAt: sameMoment,
        });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const url: string = `/api/v1/vehicles/${seeded.vehicleId}/events?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await as(context, alice).get(url);
        const body = page.body as {
          data: { id: string }[];
          pagination: { nextCursor: string | null };
        };
        seen.push(...body.data.map((e) => e.id));
        cursor = body.pagination.nextCursor;
        guard += 1;
      } while (cursor && guard < 10);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });
  });

  describe('editing and deleting', () => {
    it('clears a description with null', async () => {
      const created = await post({
        eventType: 'NOTE',
        title: 'Has a description',
        description: 'Something to clear',
        occurredAt: iso('2026-03-10T09:00:00Z'),
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      const patched = await as(context, alice).patch(
        `/api/v1/vehicles/${vehicleId}/events/${eventId}`,
        { description: null },
      );

      expect((patched.body as { event: { description: null } }).event.description).toBeNull();
    });

    it('audits an edit and a delete, but not a create', async () => {
      const created = await post({
        eventType: 'NOTE',
        title: 'Audit me',
        occurredAt: iso('2026-03-11T09:00:00Z'),
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      await as(context, alice).patch(`/api/v1/vehicles/${vehicleId}/events/${eventId}`, {
        title: 'Audited',
      });
      await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/events/${eventId}`);

      const logs = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.resourceId, eventId));

      const actions = logs.map((log) => log.action).sort();
      expect(actions).toEqual(['event.deleted', 'event.updated']);
    });

    it('will not read an event through a vehicle it does not belong to', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Other Vehicle');
      const created = await post({
        eventType: 'NOTE',
        title: 'Belongs elsewhere',
        occurredAt: iso('2026-03-12T09:00:00Z'),
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${other.vehicleId}/events/${eventId}`,
      );

      expect(response.status).toBe(404);
    });

    it('lets a DRIVER record an event but not delete one', async () => {
      const driver = await signUp(context, 'Driver');
      const seeded = await seedGarageWithVehicle(context, alice, 'Driver Garage');
      await as(context, alice).post(`/api/v1/garages/${seeded.garageId}/members`, {
        email: driver.email,
        role: 'DRIVER',
      });

      const created = await as(context, driver).post(
        `/api/v1/vehicles/${seeded.vehicleId}/events`,
        { eventType: 'FUEL', title: 'Filled up', occurredAt: iso('2026-03-13T09:00:00Z') },
      );
      expect(created.status).toBe(201);

      const eventId = (created.body as { event: { id: string } }).event.id;
      const deleted = await as(context, driver).delete(
        `/api/v1/vehicles/${seeded.vehicleId}/events/${eventId}`,
      );
      expect(deleted.status).toBe(403);
    });
  });
});
