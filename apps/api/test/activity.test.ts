import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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

const BACKFILL = resolve(
  import.meta.dirname,
  '../../../packages/database/migrations/0005_expense_activity_backfill.sql',
);

interface ActivityBody {
  planned: { kind: 'SCHEDULE' | 'TASK'; schedule?: { title: string }; task?: { title: string } }[];
  done: {
    data: {
      id: string;
      eventType: string;
      title: string;
      cost: { amountMinor: number; currency: string } | null;
    }[];
    pagination: { nextCursor: string | null; hasMore: boolean };
  };
}

describe('vehicle activity', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    ({ garageId, vehicleId } = await seedGarageWithVehicle(context, alice, 'Activity Garage'));
  });

  afterAll(async () => {
    await context.close();
  });

  const client = () => as(context, alice);
  const vehiclePath = (path: string) => `/api/v1/vehicles/${vehicleId}${path}`;

  const activity = async (query = '') =>
    (await client().get(vehiclePath(`/activity${query}`))).body as ActivityBody;

  const expenseRow = async (expenseId: string) => {
    const [row] = await context.database.db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.id, expenseId));
    return row;
  };

  const recordExpense = async (overrides: Record<string, unknown> = {}) => {
    const response = await client().post(vehiclePath('/expenses'), {
      category: 'FUEL',
      description: 'Fill-up',
      amountMinor: 8_500,
      currency: 'USD',
      occurredAt: iso('2026-06-01T10:00:00Z'),
      ...overrides,
    });
    expect(response.status).toBe(201);
    const row = await expenseRow((response.body as { id: string }).id);
    expect(row?.eventId).toBeTruthy();
    return row!;
  };

  describe('every expense is an activity item', () => {
    it('shows an expense recorded on the spending page as a done item carrying its cost', async () => {
      const expense = await recordExpense({
        category: 'TAX',
        description: 'Road tax',
        amountMinor: 18_000,
        occurredAt: iso('2026-04-01T09:00:00Z'),
      });

      const item = (await activity()).done.data.find((event) => event.id === expense.eventId);
      expect(item).toMatchObject({
        eventType: 'EXPENSE',
        title: 'Road tax',
        cost: { amountMinor: 18_000, currency: 'USD' },
      });
    });

    it('moves the item when the expense is corrected', async () => {
      const expense = await recordExpense();

      const patched = await client().patch(vehiclePath(`/expenses/${expense.id}`), {
        description: 'Fill-up, premium',
        amountMinor: 9_900,
      });
      expect(patched.status).toBe(200);

      const event = await client().get(vehiclePath(`/events/${expense.eventId}`));
      expect(event.body).toMatchObject({
        eventType: 'FUEL',
        title: 'Fill-up, premium',
        cost: { amountMinor: 9_900, currency: 'USD' },
      });
    });

    /*
     * The regression this guards: `EXPENSE` maps back to `OTHER`, so recomputing the category
     * on every event edit refiled tax as "other" the first time its title was touched.
     */
    it('keeps the expense category when the item is edited', async () => {
      const expense = await recordExpense({ category: 'TAX', description: 'Road tax' });

      const edited = await client().patch(vehiclePath(`/events/${expense.eventId}`), {
        title: 'Road tax 2026',
      });
      expect(edited.status).toBe(200);

      expect(await expenseRow(expense.id)).toMatchObject({
        category: 'TAX',
        description: 'Road tax 2026',
      });
    });

    it('removes the item when the expense is deleted', async () => {
      const expense = await recordExpense({ description: 'Duplicate fill-up' });

      const removed = await client().delete(vehiclePath(`/expenses/${expense.id}`));
      expect(removed.status).toBeLessThan(300);

      const event = await client().get(vehiclePath(`/events/${expense.eventId}`));
      expect(event.status).toBe(404);
    });

    it('keeps a completed service when the money behind it is deleted', async () => {
      const plan = await client().post(vehiclePath('/maintenance'), {
        title: 'Oil service',
        intervalMonths: 12,
      });
      expect(plan.status).toBe(201);

      const completion = await client().post(
        vehiclePath(`/maintenance/${(plan.body as { id: string }).id}/complete`),
        {
          performedAt: iso('2026-05-10T10:00:00Z'),
          laborCostAmountMinor: 12_000,
          costCurrency: 'USD',
        },
      );
      expect(completion.status).toBeLessThan(300);
      const eventId = (completion.body as { record: { eventId: string } }).record.eventId;

      const [money] = await context.database.db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.eventId, eventId));
      const removed = await client().delete(vehiclePath(`/expenses/${money!.id}`));
      expect(removed.status).toBeLessThan(300);

      const event = await client().get(vehiclePath(`/events/${eventId}`));
      expect(event.status).toBe(200);
      expect((event.body as { cost: unknown }).cost).toBeNull();
    });
  });

  describe('planned', () => {
    it("lists the vehicle's schedules and open tasks, the overdue task first", async () => {
      await client().post('/api/v1/tasks', {
        garageId,
        vehicleId,
        title: 'Book inspection',
        dueDate: '2026-01-15',
      });
      await client().post('/api/v1/tasks', { garageId, title: 'Garage-wide chore' });
      await client().post(vehiclePath('/maintenance'), {
        title: 'Tyre rotation',
        intervalMonths: 6,
      });

      const titles = (await activity()).planned.map(
        (item) => item.schedule?.title ?? item.task?.title,
      );

      expect(titles[0]).toBe('Book inspection');
      expect(titles).toContain('Tyre rotation');
      // Garage-level work names no vehicle, so it belongs to the task centre, not this feed.
      expect(titles).not.toContain('Garage-wide chore');
    });

    it('sends planned items with the first page only', async () => {
      const first = await activity('?limit=1');
      expect(first.planned.length).toBeGreaterThan(0);
      expect(first.done.pagination.nextCursor).toBeTruthy();

      const second = await activity(
        `?limit=1&cursor=${encodeURIComponent(first.done.pagination.nextCursor!)}`,
      );
      expect(second.planned).toEqual([]);
      expect(second.done.data).toHaveLength(1);
    });
  });

  describe('backfill migration', () => {
    it('gives every expense without an item one, and changes nothing on a second run', async () => {
      const db = context.database.db;
      const [orphan] = await db
        .insert(schema.expenses)
        .values({
          vehicleId,
          category: 'STORAGE',
          description: 'Winter storage',
          vendor: 'Dry Dock',
          amountMinor: 30_000,
          currency: 'USD',
          occurredAt: new Date('2026-02-01T00:00:00Z'),
          odometer: 35_500,
          odometerUnit: 'KM',
        })
        .returning();

      const script = readFileSync(BACKFILL, 'utf8');
      await db.execute(sql.raw(script));

      const linked = await expenseRow(orphan!.id);
      expect(linked?.eventId).toBeTruthy();

      const [event] = await db
        .select()
        .from(schema.vehicleEvents)
        .where(eq(schema.vehicleEvents.id, linked!.eventId!));
      expect(event).toMatchObject({
        eventType: 'EXPENSE',
        title: 'Winter storage',
        provider: 'Dry Dock',
        costAmountMinor: 30_000,
        costCurrency: 'USD',
        odometer: 35_500,
      });

      const count = async () =>
        (await db.select({ total: sql<number>`count(*)::int` }).from(schema.vehicleEvents))[0]!
          .total;
      const before = await count();
      await db.execute(sql.raw(script));
      expect(await count()).toBe(before);
    });
  });
});
