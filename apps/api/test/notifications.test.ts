import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import { scanForDueMaintenance } from '../src/modules/notifications/application/services/due-scan';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

const iso = (value: string) => new Date(value).toISOString();

describe('maintenance due scan', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let vehicleId: string;
  let garageId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Reminder Garage');
    vehicleId = seeded.vehicleId;
    garageId = seeded.garageId;
  });

  afterAll(async () => {
    await context.close();
  });

  const notificationsFor = (userId: string) =>
    context.database.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));

  it('says nothing when nothing is due', async () => {
    const result = await scanForDueMaintenance(context.database.db);

    expect(result.due).toBe(0);
    expect(result.notified).toBe(0);
  });

  it('notifies about an overdue plan, naming the reason', async () => {
    await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/maintenance`, {
      title: 'Annual inspection',
      intervalMonths: 12,
      lastPerformedAt: iso('2020-01-01T00:00:00Z'),
    });

    const result = await scanForDueMaintenance(context.database.db);
    expect(result.notified).toBe(1);

    const [notification] = await notificationsFor(alice.userId);
    expect(notification?.notificationType).toBe('MAINTENANCE_OVERDUE');
    // PRD §31: a reminder that does not say why is not actionable.
    expect(notification?.body).toContain('2021 BMW M3');
    expect(notification?.body).toContain('Annual inspection');
    expect(notification?.body).toMatch(/days ago/);
  });

  /*
   * The property the whole design turns on. A plan overdue for six weeks is scanned daily
   * and must still produce exactly one notification — otherwise the list becomes noise and
   * people stop reading it (§36).
   */
  it('does not notify twice about the same cycle', async () => {
    await scanForDueMaintenance(context.database.db);
    await scanForDueMaintenance(context.database.db);
    await scanForDueMaintenance(context.database.db);

    const rows = await notificationsFor(alice.userId);
    expect(rows).toHaveLength(1);
  });

  it('queues exactly one delivery job for that notification', async () => {
    const messages = await context.database.db
      .select()
      .from(schema.outboxMessages)
      .where(eq(schema.outboxMessages.jobName, 'deliver-maintenance-reminder'));

    expect(messages).toHaveLength(1);
  });

  it('notifies again once the service is done and the next cycle comes due', async () => {
    const plans = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/maintenance`);
    const plan = (plans.body as { id: string; title: string }[]).find(
      (entry) => entry.title === 'Annual inspection',
    )!;

    // Complete it, but back-dated far enough that the next cycle is already overdue too.
    await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/maintenance/${plan.id}/complete`, {
      performedAt: iso('2023-01-01T00:00:00Z'),
    });

    await scanForDueMaintenance(context.database.db);

    const rows = await notificationsFor(alice.userId);
    // The due point moved, so the key changed and a fresh reminder is correct.
    expect(rows.length).toBe(2);
  });

  it('notifies every member of the garage, viewers included', async () => {
    const viewer = await signUp(context, 'Viewer');
    await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
      email: viewer.email,
      role: 'VIEWER',
    });

    await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/maintenance`, {
      title: 'Brake fluid',
      intervalMonths: 24,
      lastPerformedAt: iso('2019-01-01T00:00:00Z'),
    });

    await scanForDueMaintenance(context.database.db);

    const viewerRows = await notificationsFor(viewer.userId);
    // Being unable to act on something is not a reason to be kept unaware of it.
    expect(viewerRows.length).toBeGreaterThan(0);
  });

  it("never notifies someone outside the vehicle's garage", async () => {
    const rows = await notificationsFor(bob.userId);
    expect(rows).toHaveLength(0);
  });

  it('reports a distance trigger in the vehicle unit', async () => {
    const seeded = await seedGarageWithVehicle(context, alice, 'Distance Garage');
    await as(context, alice).post(`/api/v1/vehicles/${seeded.vehicleId}/maintenance`, {
      title: 'Oil change',
      intervalDistance: 10_000,
      intervalDistanceUnit: 'KM',
      // The vehicle is at 36,000. A baseline of 26,300 puts the next service at 36,300,
      // so 300 km remain — inside the 500 km window, but not yet passed.
      lastPerformedOdometer: 26_300,
    });

    await scanForDueMaintenance(context.database.db);

    const rows = await notificationsFor(alice.userId);
    const distanceReminder = rows.find((row) => row.body.includes('km'));
    expect(distanceReminder?.body).toContain('Oil change');
    expect(distanceReminder?.notificationType).toBe('MAINTENANCE_DUE');
  });

  it('ignores an archived vehicle', async () => {
    const seeded = await seedGarageWithVehicle(context, alice, 'Archived Garage');
    await as(context, alice).post(`/api/v1/vehicles/${seeded.vehicleId}/maintenance`, {
      title: 'Ignored',
      intervalMonths: 12,
      lastPerformedAt: iso('2015-01-01T00:00:00Z'),
    });
    await as(context, alice).delete(`/api/v1/vehicles/${seeded.vehicleId}`);

    const before = (await notificationsFor(alice.userId)).length;
    await scanForDueMaintenance(context.database.db);
    const after = await notificationsFor(alice.userId);

    // An archived vehicle's schedules are history, not outstanding work.
    expect(after.length).toBe(before);
    expect(after.every((row) => row.title !== 'Ignored')).toBe(true);
  });

  it('ignores a deactivated plan', async () => {
    const seeded = await seedGarageWithVehicle(context, alice, 'Inactive Garage');
    const created = await as(context, alice).post(
      `/api/v1/vehicles/${seeded.vehicleId}/maintenance`,
      { title: 'Paused', intervalMonths: 12, lastPerformedAt: iso('2015-01-01T00:00:00Z') },
    );
    const planId = (created.body as { id: string }).id;
    await as(context, alice).patch(`/api/v1/vehicles/${seeded.vehicleId}/maintenance/${planId}`, {
      isActive: false,
    });

    await scanForDueMaintenance(context.database.db);

    const rows = await notificationsFor(alice.userId);
    expect(rows.every((row) => row.title !== 'Paused')).toBe(true);
  });
});

describe('notification endpoints', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');

    const seeded = await seedGarageWithVehicle(context, alice, 'Endpoint Garage');
    await as(context, alice).post(`/api/v1/vehicles/${seeded.vehicleId}/maintenance`, {
      title: 'Overdue thing',
      intervalMonths: 12,
      lastPerformedAt: iso('2020-01-01T00:00:00Z'),
    });
    await scanForDueMaintenance(context.database.db);
  });

  afterAll(async () => {
    await context.close();
  });

  it('lists the caller notifications with an unread count', async () => {
    const list = await as(context, alice).get('/api/v1/notifications');
    expect(list.status).toBe(200);
    expect((list.body as unknown[]).length).toBe(1);

    const count = await as(context, alice).get('/api/v1/notifications/unread-count');
    expect((count.body as { unread: number }).unread).toBe(1);
  });

  it('shows nothing to a user with no notifications', async () => {
    const list = await as(context, bob).get('/api/v1/notifications');
    expect(list.body).toEqual([]);
  });

  it('marks one as read', async () => {
    const list = await as(context, alice).get('/api/v1/notifications');
    const id = (list.body as { id: string }[])[0]!.id;

    expect((await as(context, alice).post(`/api/v1/notifications/${id}/read`)).status).toBe(204);

    const count = await as(context, alice).get('/api/v1/notifications/unread-count');
    expect((count.body as { unread: number }).unread).toBe(0);
  });

  /* Ownership is part of the UPDATE, so there is no window to exploit between the two. */
  it("refuses to mark someone else's notification as read", async () => {
    const list = await as(context, alice).get('/api/v1/notifications');
    const id = (list.body as { id: string }[])[0]!.id;

    expect((await as(context, bob).post(`/api/v1/notifications/${id}/read`)).status).toBe(404);
  });

  it('marks everything read at once', async () => {
    expect((await as(context, alice).post('/api/v1/notifications/read-all')).status).toBe(204);

    const count = await as(context, alice).get('/api/v1/notifications/unread-count');
    expect((count.body as { unread: number }).unread).toBe(0);
  });
});
