import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

/** `YYYY-MM-DD` relative to today, so the buckets are exercised against a real clock. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe('tasks', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Task Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const create = (payload: Record<string, unknown>) =>
    as(context, alice).post('/api/v1/tasks', { garageId, ...payload });

  describe('creation', () => {
    it('creates a task attached to a vehicle', async () => {
      const response = await create({
        vehicleId,
        title: 'Replace the rear tyre',
        priority: 'HIGH',
        dueDate: daysFromNow(3),
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        title: 'Replace the rear tyre',
        priority: 'HIGH',
        status: 'TODO',
        // Named from the joined vehicle so a task list needs no second query per row.
        vehicleName: '2021 BMW M3',
      });
    });

    /* Garage-level work — "call the insurer" names no vehicle and must still be creatable. */
    it('creates a task with no vehicle at all', async () => {
      const response = await create({ title: 'Call the insurer', category: 'ADMINISTRATIVE' });

      expect(response.status).toBe(201);
      expect((response.body as { vehicleId: null; vehicleName: null }).vehicleId).toBeNull();
      expect((response.body as { vehicleName: null }).vehicleName).toBeNull();
    });

    it('accepts a mileage deadline instead of a date', async () => {
      const response = await create({ title: 'Timing belt by 90,000', dueOdometer: 90_000 });

      expect((response.body as { dueOdometer: number }).dueOdometer).toBe(90_000);
      expect((response.body as { dueDate: null }).dueDate).toBeNull();
    });

    /*
     * A vehicle from another garage would make the task a pointer across the tenant
     * boundary — readable here, naming something that is not.
     */
    it('refuses a vehicle that is not in the garage', async () => {
      const other = await seedGarageWithVehicle(context, bob, 'Bob Garage');
      const response = await create({ title: 'Cross-tenant', vehicleId: other.vehicleId });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'vehicleId',
      );
    });

    /* Assigning work to someone with no access means they can never see it. */
    it('refuses an assignee who is not a garage member', async () => {
      const response = await create({ title: 'Unassignable', assigneeId: bob.userId });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'assigneeId',
      );
    });

    it('refuses a cost estimate with no currency', async () => {
      const response = await create({ title: 'Priceless', estimatedCostAmountMinor: 50_000 });

      expect(response.status).toBe(400);
    });

    it("refuses to create a task in someone else's garage", async () => {
      const response = await as(context, bob).post('/api/v1/tasks', {
        garageId,
        title: 'Not mine',
      });

      expect(response.status).toBe(404);
    });
  });

  describe('lifecycle', () => {
    let taskId: string;

    beforeAll(async () => {
      const created = await create({ title: 'Lifecycle', dueDate: daysFromNow(2) });
      taskId = (created.body as { id: string }).id;
    });

    /*
     * `completedAt` follows the status rather than being set by the client, so the two
     * cannot disagree.
     */
    it('stamps completedAt when the status becomes COMPLETED', async () => {
      const response = await as(context, alice).patch(`/api/v1/tasks/${taskId}`, {
        status: 'COMPLETED',
      });

      expect((response.body as { completedAt: string }).completedAt).toBeTruthy();
    });

    it('keeps the original timestamp when completing an already-complete task', async () => {
      const first = await as(context, alice).get(`/api/v1/tasks/${taskId}`);
      const stamp = (first.body as { completedAt: string }).completedAt;

      const again = await as(context, alice).patch(`/api/v1/tasks/${taskId}`, {
        status: 'COMPLETED',
      });

      // It did not just happen a second time.
      expect((again.body as { completedAt: string }).completedAt).toBe(stamp);
    });

    it('clears completedAt when the task is re-opened', async () => {
      const response = await as(context, alice).patch(`/api/v1/tasks/${taskId}`, {
        status: 'IN_PROGRESS',
      });

      expect((response.body as { completedAt: null }).completedAt).toBeNull();
    });

    it('leaves untouched fields alone on a partial update', async () => {
      await as(context, alice).patch(`/api/v1/tasks/${taskId}`, { priority: 'URGENT' });
      const response = await as(context, alice).get(`/api/v1/tasks/${taskId}`);

      expect(response.body).toMatchObject({ title: 'Lifecycle', priority: 'URGENT' });
    });

    it('clears a description with an explicit null', async () => {
      await as(context, alice).patch(`/api/v1/tasks/${taskId}`, { description: 'Some detail' });
      const cleared = await as(context, alice).patch(`/api/v1/tasks/${taskId}`, {
        description: null,
      });

      expect((cleared.body as { description: null }).description).toBeNull();
    });

    it('soft-deletes, removing it from every list', async () => {
      const created = await create({ title: 'Delete me' });
      const id = (created.body as { id: string }).id;

      expect((await as(context, alice).delete(`/api/v1/tasks/${id}`)).status).toBe(204);
      expect((await as(context, alice).get(`/api/v1/tasks/${id}`)).status).toBe(404);

      const list = await as(context, alice).get('/api/v1/tasks');
      const titles = (list.body as { title: string }[]).map((task) => task.title);
      expect(titles).not.toContain('Delete me');
    });
  });

  describe('the task centre', () => {
    let bucketUser: SignedUpUser;
    let bucketGarage: string;

    beforeAll(async () => {
      bucketUser = await signUp(context, 'Buckets');
      const garage = await as(context, bucketUser).post('/api/v1/garages', { name: 'Buckets' });
      bucketGarage = (garage.body as { id: string }).id;

      const add = (payload: Record<string, unknown>) =>
        as(context, bucketUser).post('/api/v1/tasks', { garageId: bucketGarage, ...payload });

      await add({ title: 'Overdue', dueDate: daysFromNow(-5) });
      await add({ title: 'Today', dueDate: daysFromNow(0) });
      await add({ title: 'This week', dueDate: daysFromNow(4) });
      await add({ title: 'Upcoming', dueDate: daysFromNow(30) });
      await add({ title: 'Someday' });
      await add({ title: 'Already done', dueDate: daysFromNow(-2), status: 'COMPLETED' });
    });

    it('sorts open work into the four time buckets', async () => {
      const response = await as(context, bucketUser).get('/api/v1/tasks/buckets');

      expect(response.status).toBe(200);
      const body = response.body as {
        overdue: { title: string }[];
        today: { title: string }[];
        thisWeek: { title: string }[];
        upcoming: { title: string }[];
        someday: { title: string }[];
        counts: Record<string, number>;
      };

      expect(body.overdue.map((task) => task.title)).toEqual(['Overdue']);
      expect(body.today.map((task) => task.title)).toEqual(['Today']);
      expect(body.thisWeek.map((task) => task.title)).toEqual(['This week']);
      expect(body.upcoming.map((task) => task.title)).toEqual(['Upcoming']);
      expect(body.counts).toEqual({
        overdue: 1,
        today: 1,
        thisWeek: 1,
        upcoming: 1,
        someday: 1,
      });
    });

    it('leaves completed work out of every bucket', async () => {
      const response = await as(context, bucketUser).get('/api/v1/tasks/buckets');
      const body = response.body as Record<string, { title: string }[]>;
      const everything = [
        ...body.overdue!,
        ...body.today!,
        ...body.thisWeek!,
        ...body.upcoming!,
        ...body.someday!,
      ];

      expect(everything.map((task) => task.title)).not.toContain('Already done');
    });

    it("does not mix in another user's tasks", async () => {
      const response = await as(context, bob).get('/api/v1/tasks/buckets');
      const counts = (response.body as { counts: Record<string, number> }).counts;

      expect(Object.values(counts).every((count) => count === 0)).toBe(true);
    });
  });

  describe('listing and filters', () => {
    it('returns only open work when asked', async () => {
      const response = await as(context, alice).get('/api/v1/tasks?openOnly=true');
      const statuses = (response.body as { status: string }[]).map((task) => task.status);

      expect(statuses).not.toContain('COMPLETED');
      expect(statuses).not.toContain('CANCELLED');
    });

    it('filters to one vehicle', async () => {
      const response = await as(context, alice).get(`/api/v1/tasks?vehicleId=${vehicleId}`);
      const ids = (response.body as { vehicleId: string }[]).map((task) => task.vehicleId);

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids)).toEqual(new Set([vehicleId]));
    });

    /* The tenant filter comes from membership; a query parameter can only narrow it. */
    it('returns nothing for a garage the caller does not belong to', async () => {
      const response = await as(context, bob).get(`/api/v1/tasks?garageId=${garageId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('sorts undated work last rather than first', async () => {
      const response = await as(context, alice).get('/api/v1/tasks?openOnly=true');
      const dates = (response.body as { dueDate: string | null }[]).map((task) => task.dueDate);

      const firstNull = dates.indexOf(null);
      if (firstNull !== -1) {
        expect(dates.slice(firstNull).every((date) => date === null)).toBe(true);
      }
    });
  });

  describe('permissions', () => {
    it('lets a DRIVER create a task but not delete one', async () => {
      const driver = await signUp(context, 'TaskDriver');
      await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: driver.email,
        role: 'DRIVER',
      });

      const created = await as(context, driver).post('/api/v1/tasks', {
        garageId,
        title: 'Driver task',
      });
      expect(created.status).toBe(201);

      const id = (created.body as { id: string }).id;
      expect((await as(context, driver).delete(`/api/v1/tasks/${id}`)).status).toBe(403);
    });

    it("answers 404 for another user's task rather than 403", async () => {
      const created = await create({ title: 'Private' });
      const id = (created.body as { id: string }).id;

      expect((await as(context, bob).get(`/api/v1/tasks/${id}`)).status).toBe(404);
      expect((await as(context, bob).patch(`/api/v1/tasks/${id}`, { title: 'Mine' })).status).toBe(
        404,
      );
      expect((await as(context, bob).delete(`/api/v1/tasks/${id}`)).status).toBe(404);
    });
  });
});
