import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { and, eq } from 'drizzle-orm';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';
import { __setFxCache } from '../src/infrastructure/fx';

const iso = (value: string) => new Date(value).toISOString();

describe('expenses', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    /*
     * Fixed rates, and never a request: a test that reaches a live rate provider fails on a
     * plane and reports a different number every morning.
     */
    __setFxCache({
      base: 'USD',
      asOf: '2026-09-18T11:17:00.000Z',
      rates: { CHF: 0.8, EUR: 0.9 },
    });
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Expense Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const create = (payload: unknown, vehicle = vehicleId) =>
    as(context, alice).post(`/api/v1/vehicles/${vehicle}/expenses`, payload);

  const expense = (overrides: Record<string, unknown> = {}) => ({
    category: 'FUEL',
    description: 'Fill-up',
    amountMinor: 8_500,
    currency: 'USD',
    occurredAt: iso('2026-06-01T10:00:00Z'),
    ...overrides,
  });

  describe('recording', () => {
    it('records an expense with its amount and currency', async () => {
      const response = await create(
        expense({ vendor: 'Shell', amountMinor: 9_250, occurredAt: iso('2026-05-02T08:00:00Z') }),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        category: 'FUEL',
        vendor: 'Shell',
        amount: { amountMinor: 9_250, currency: 'USD' },
      });
    });

    it('rejects an amount with no currency', async () => {
      const response = await create({
        category: 'FUEL',
        description: 'Nameless money',
        amountMinor: 5_000,
        occurredAt: iso('2026-05-02T08:00:00Z'),
      });

      expect(response.status).toBe(400);
    });

    /** A well-formed code that no runtime can format is a row that can never be displayed. */
    it('rejects a currency that is not a real ISO 4217 code', async () => {
      const response = await create(expense({ currency: 'XYZ' }));

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'currency',
      );
    });

    /*
     * Quantity stays text end to end. The column is `numeric` so a decade of fill-ups can be
     * summed exactly, and parsing "48.7215" into a float on the way in throws that away.
     */
    it('keeps a fuel quantity exact rather than rounding it through a float', async () => {
      const response = await create(
        expense({ quantity: '48.7215', quantityUnit: 'LITER', isFullTank: true }),
      );

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ quantity: '48.7215', isFullTank: true });
    });

    /*
     * What was bought, kept apart from the category. A DEF top-up and a diesel fill-up are both
     * FUEL, and a total that cannot tell them apart cannot answer what the diesel actually cost.
     */
    it('records what went in, and lets a correction change it', async () => {
      const created = await create(expense({ fuelType: 'DIESEL', quantity: '48.72' }));
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ fuelType: 'DIESEL' });

      const id = (created.body as { id: string }).id;
      const updated = await as(context, alice).patch(
        `/api/v1/vehicles/${vehicleId}/expenses/${id}`,
        {
          fuelType: 'DEF',
        },
      );
      expect(updated.body).toMatchObject({ fuelType: 'DEF' });
    });

    it('leaves the fuel type unstated when the receipt does not say', async () => {
      const response = await create(expense({ quantity: '30' }));
      expect(response.body).toMatchObject({ fuelType: null });
    });

    it('rejects a fuel type that is not one of the known ones', async () => {
      expect((await create(expense({ fuelType: 'COAL' }))).status).toBe(400);
    });

    it('rejects a quantity that is not a decimal number', async () => {
      const response = await create(expense({ quantity: 'half a tank' }));

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'quantity',
      );
    });

    /*
     * A fill-up is an odometer reading like any other, and `raiseOdometer` only moves the
     * vehicle forward — entering last spring's receipt must not drag today's reading back.
     */
    it('carries the odometer forward, and a back-dated receipt does not drag it back', async () => {
      await create(expense({ odometer: 41_000, odometerUnit: 'KM' }));
      const after = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
      expect((after.body as { currentOdometer: number }).currentOdometer).toBe(41_000);

      await create(
        expense({
          odometer: 30_000,
          odometerUnit: 'KM',
          occurredAt: iso('2024-01-01T10:00:00Z'),
        }),
      );
      const later = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
      expect((later.body as { currentOdometer: number }).currentOdometer).toBe(41_000);
    });

    it('writes an audit entry naming the amount', async () => {
      const created = await create(expense({ description: 'Audited', amountMinor: 1_234 }));
      const id = (created.body as { id: string }).id;

      const [entry] = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, 'expense.created')),
        );

      expect(entry?.metadata).toMatchObject({ amountMinor: 1_234, currency: 'USD' });
    });
  });

  describe('listing', () => {
    let listVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'List Garage');
      listVehicle = seeded.vehicleId;

      await create(
        expense({ category: 'FUEL', occurredAt: iso('2026-01-10T10:00:00Z') }),
        listVehicle,
      );
      await create(
        expense({
          category: 'MAINTENANCE',
          amountMinor: 45_000,
          occurredAt: iso('2026-03-10T10:00:00Z'),
        }),
        listVehicle,
      );
      await create(
        expense({
          category: 'INSURANCE',
          amountMinor: 90_000,
          occurredAt: iso('2026-07-10T10:00:00Z'),
        }),
        listVehicle,
      );
    });

    it('returns them newest first', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${listVehicle}/expenses`);
      const data = (response.body as { data: { category: string }[] }).data;

      expect(data.map((row) => row.category)).toEqual(['INSURANCE', 'MAINTENANCE', 'FUEL']);
    });

    it('filters by category', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${listVehicle}/expenses?category=MAINTENANCE`,
      );
      const data = (response.body as { data: unknown[] }).data;

      expect(data).toHaveLength(1);
    });

    it('filters by a date window', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${listVehicle}/expenses?from=${iso('2026-02-01T00:00:00Z')}&to=${iso('2026-06-01T00:00:00Z')}`,
      );
      const data = (response.body as { data: { category: string }[] }).data;

      expect(data.map((row) => row.category)).toEqual(['MAINTENANCE']);
    });

    it('pages with a stable cursor', async () => {
      const first = await as(context, alice).get(
        `/api/v1/vehicles/${listVehicle}/expenses?limit=2`,
      );
      const page = first.body as {
        data: { id: string }[];
        pagination: { nextCursor: string; hasMore: boolean };
      };
      expect(page.pagination.hasMore).toBe(true);

      const second = await as(context, alice).get(
        `/api/v1/vehicles/${listVehicle}/expenses?limit=2&cursor=${encodeURIComponent(page.pagination.nextCursor)}`,
      );
      const rest = (second.body as { data: { id: string }[] }).data;

      expect(rest).toHaveLength(1);
      expect(page.data.map((row) => row.id)).not.toContain(rest[0]!.id);
    });
  });

  describe('correcting and deleting', () => {
    it('updates an expense and records what the amount used to be', async () => {
      const created = await create(expense({ amountMinor: 10_000 }));
      const id = (created.body as { id: string }).id;

      const updated = await as(context, alice).patch(
        `/api/v1/vehicles/${vehicleId}/expenses/${id}`,
        { amountMinor: 12_000 },
      );

      expect(updated.status).toBe(200);
      expect((updated.body as { amount: { amountMinor: number } }).amount.amountMinor).toBe(12_000);

      const [entry] = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, 'expense.updated')),
        );
      expect(entry?.metadata).toMatchObject({ previousAmountMinor: 10_000 });
    });

    /*
     * Hard delete (§103). Financial records are not soft-deleted: a total that quietly
     * changes when a hidden row is excluded is worse than no total at all.
     */
    it('deletes the row outright and leaves the removal in the audit log', async () => {
      const created = await create(expense({ description: 'Mistake' }));
      const id = (created.body as { id: string }).id;

      expect(
        (await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/expenses/${id}`)).status,
      ).toBe(204);

      const rows = await context.database.db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.id, id));
      expect(rows).toHaveLength(0);

      const [entry] = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, 'expense.deleted')),
        );
      expect(entry?.metadata).toMatchObject({ description: 'Mistake' });
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for a vehicle in someone else s garage', async () => {
      const responses = await Promise.all([
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/expenses`),
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/cost`),
        as(context, bob).post(`/api/v1/vehicles/${vehicleId}/expenses`, expense()),
      ]);

      for (const response of responses) expect(response.status).toBe(404);
    });

    /** An expense id is only reachable through the vehicle it belongs to. */
    it('answers 404 for a valid expense id read through another vehicle', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Second Garage');
      const created = await create(expense());
      const id = (created.body as { id: string }).id;

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${other.vehicleId}/expenses/${id}`,
      );
      expect(response.status).toBe(404);
    });
  });

  describe('cost summary', () => {
    let costVehicle: string;

    beforeAll(async () => {
      const created = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'Volvo',
        model: '240',
        year: 1989,
        currentOdometer: 200_000,
        odometerUnit: 'KM',
        purchaseDate: '2021-09-08',
        purchasePriceAmountMinor: 500_000,
        purchasePriceCurrency: 'USD',
      });
      costVehicle = (created.body as { id: string }).id;

      // Two readings on the timeline, so there is a distance to divide by.
      const client = as(context, alice);
      await client.post(`/api/v1/vehicles/${costVehicle}/events`, {
        eventType: 'NOTE',
        title: 'Bought it',
        occurredAt: iso('2021-09-08T10:00:00Z'),
        odometer: 190_000,
        odometerUnit: 'KM',
      });
      await client.post(`/api/v1/vehicles/${costVehicle}/events`, {
        eventType: 'NOTE',
        title: 'Today',
        occurredAt: iso('2026-06-08T10:00:00Z'),
        odometer: 200_000,
        odometerUnit: 'KM',
      });

      await create(
        expense({
          category: 'MAINTENANCE',
          amountMinor: 120_000,
          occurredAt: iso('2025-05-01T10:00:00Z'),
        }),
        costVehicle,
      );
      await create(
        expense({ category: 'FUEL', amountMinor: 80_000, occurredAt: iso('2026-05-01T10:00:00Z') }),
        costVehicle,
      );
    });

    it('adds the purchase price to running spend for the ownership total', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        currency: 'USD',
        purchasePrice: { amountMinor: 500_000 },
        ownershipCost: { amountMinor: 700_000 },
        totalSpent: { amountMinor: 200_000 },
      });
    });

    it('breaks the spend down by category, largest first', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost`);
      const byCategory = (response.body as { byCategory: { category: string }[] }).byCategory;

      expect(byCategory.map((row) => row.category)).toEqual(['MAINTENANCE', 'FUEL']);
    });

    /** Running spend over the distance actually covered — 2,000.00 over 10,000 km. */
    it('divides running spend by the distance between the readings on record', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost`);

      expect(response.body).toMatchObject({
        distanceCovered: 10_000,
        distanceUnit: 'KM',
        costPerDistance: { amountMinor: 20 },
      });
    });

    it('narrows the window without touching the lifetime figures', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${costVehicle}/cost?from=${iso('2026-01-01T00:00:00Z')}`,
      );

      expect(response.body).toMatchObject({
        // Only the fuel falls inside the window.
        totalSpent: { amountMinor: 80_000 },
        // Ownership cost is a lifetime question and ignores it.
        ownershipCost: { amountMinor: 700_000 },
      });
    });

    /*
     * The stated totals are still the sum of the rows stored in the quoted currency — spend
     * in another currency is set aside and named, so every figure remains reproducible from
     * the rows alone. What today's rate makes of it rides alongside, dated.
     */
    it('sets aside spend in another currency instead of folding it into the totals', async () => {
      await create(
        expense({
          category: 'FUEL',
          amountMinor: 6_000,
          currency: 'CHF',
          occurredAt: iso('2026-05-05T10:00:00Z'),
        }),
        costVehicle,
      );

      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost`);

      expect(response.body).toMatchObject({
        currency: 'USD',
        ownershipCost: { amountMinor: 700_000 },
        otherCurrencies: [{ currency: 'CHF', amountMinor: 6_000, count: 1 }],
        includesConverted: false,
        // 60.00 CHF at 0.8 CHF to the dollar is $75.00, and the date rides with it.
        otherCurrenciesConverted: { amountMinor: 7_500, currency: 'USD' },
        ratesAsOf: '2026-09-18T11:17:00.000Z',
      });
    });

    it('folds other currencies into the figures for a garage that reports in one', async () => {
      const own = await seedGarageWithVehicle(context, alice, 'One Currency Garage');
      await as(context, alice).patch(`/api/v1/garages/${own.garageId}`, {
        costReporting: 'CONVERTED',
      });
      await create(expense({ amountMinor: 10_000, currency: 'USD' }), own.vehicleId);
      await create(expense({ amountMinor: 6_000, currency: 'CHF' }), own.vehicleId);

      const response = await as(context, alice).get(`/api/v1/vehicles/${own.vehicleId}/cost`);

      expect(response.body).toMatchObject({
        currency: 'USD',
        // $100 + 60 CHF at 0.8 = $175, and the figures say which rate made it.
        totalSpent: { amountMinor: 17_500 },
        includesConverted: true,
        ratesAsOf: '2026-09-18T11:17:00.000Z',
        otherCurrencies: [{ currency: 'CHF', amountMinor: 6_000, count: 1 }],
      });
    });

    it('converts the monthly chart and fuel prices for a converting garage too', async () => {
      const own = await seedGarageWithVehicle(context, alice, 'Converted Chart Garage');
      await as(context, alice).patch(`/api/v1/garages/${own.garageId}`, {
        costReporting: 'CONVERTED',
      });
      const month = new Date();
      month.setUTCDate(1);
      const when = month.toISOString();
      await create(
        expense({
          amountMinor: 8_000,
          currency: 'USD',
          quantity: '40',
          quantityUnit: 'LITER',
          occurredAt: when,
        }),
        own.vehicleId,
      );
      await create(
        expense({
          amountMinor: 4_000,
          currency: 'CHF',
          quantity: '25',
          quantityUnit: 'LITER',
          occurredAt: when,
        }),
        own.vehicleId,
      );

      const monthly = await as(context, alice).get(
        `/api/v1/vehicles/${own.vehicleId}/cost/monthly?months=2`,
      );
      const body = monthly.body as { points: { amountMinor: number }[] };
      // $80 + 40 CHF at 0.8 = $130, in this month's bar.
      expect(monthly.body).toMatchObject({
        includesConverted: true,
        ratesAsOf: '2026-09-18T11:17:00.000Z',
      });
      expect(body.points.at(-1)?.amountMinor).toBe(13_000);

      const fuel = await as(context, alice).get(
        `/api/v1/vehicles/${own.vehicleId}/cost/fuel-prices`,
      );
      // $130 over 65 L. One series per fuel family now, and this vehicle only takes litres.
      expect(fuel.body).toMatchObject([
        { unit: 'LITER', includesConverted: true, averagePerUnit: '2.000' },
      ]);
    });

    it('keeps the monthly chart strict for a strict garage', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost/monthly`);
      expect(response.body).toMatchObject({ includesConverted: false, ratesAsOf: null });
    });

    it('offers no conversion when there is nothing in another currency', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/cost`);

      expect(response.body).toMatchObject({
        otherCurrencies: [],
        otherCurrenciesConverted: null,
        ratesAsOf: null,
      });
    });

    /*
     * The provider quotes a long tail it does not cover, and a summary quoted in one of those
     * must say nothing rather than drop the part it could not convert and look merely small.
     */
    it('omits the conversion entirely when a currency is missing from the rate table', async () => {
      await create(
        expense({
          amountMinor: 4_000,
          currency: 'XPF',
          occurredAt: iso('2026-05-06T10:00:00Z'),
        }),
        costVehicle,
      );

      const response = await as(context, alice).get(`/api/v1/vehicles/${costVehicle}/cost`);

      expect(response.body).toMatchObject({ otherCurrenciesConverted: null, ratesAsOf: null });
    });

    it('reports no annual or per-distance figure for a vehicle with nothing to divide by', async () => {
      const bare = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'BICYCLE',
        make: 'Surly',
        model: 'Cross-Check',
      });
      const bareId = (bare.body as { id: string }).id;

      const response = await as(context, alice).get(`/api/v1/vehicles/${bareId}/cost`);

      expect(response.body).toMatchObject({
        // Falls back to the garage's own default rather than inventing one.
        currency: 'USD',
        ownershipCost: { amountMinor: 0 },
        costPerYear: null,
        costPerDistance: null,
        distanceCovered: null,
        fuelConsumption: null,
      });
    });

    it('reports spend per month with the empty months filled in', async () => {
      const chartVehicle = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'Saab',
        model: '900',
      });
      const chartId = (chartVehicle.body as { id: string }).id;

      const now = new Date();
      const monthsAgo = (count: number) =>
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 15)).toISOString();

      await create(expense({ amountMinor: 3000, occurredAt: monthsAgo(0) }), chartId);
      await create(expense({ amountMinor: 1500, occurredAt: monthsAgo(2) }), chartId);
      // Excluded, like every other running-cost figure: one bar this size flattens the rest.
      await create(
        expense({ category: 'PURCHASE', amountMinor: 900_000, occurredAt: monthsAgo(1) }),
        chartId,
      );

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${chartId}/cost/monthly?months=4`,
      );

      expect(response.status).toBe(200);
      const body = response.body as { currency: string; points: { amountMinor: number }[] };
      expect(body.points).toHaveLength(4);
      // Oldest first: [3 ago, 2 ago, 1 ago, this month].
      expect(body.points.map((point) => point.amountMinor)).toEqual([0, 1500, 0, 3000]);
    });

    it('measures fuel consumption full tank to full tank', async () => {
      const fuelVehicle = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'Skoda',
        model: 'Octavia',
        odometerUnit: 'KM',
      });
      const fuelId = (fuelVehicle.body as { id: string }).id;

      const fill = (occurredAt: string, odometer: number, quantity: string, isFullTank: boolean) =>
        create(
          {
            category: 'FUEL',
            description: 'Fill-up',
            amountMinor: 6000,
            currency: 'USD',
            occurredAt: iso(occurredAt),
            odometer,
            odometerUnit: 'KM',
            quantity,
            quantityUnit: 'LITER',
            isFullTank,
          },
          fuelId,
        );

      await fill('2026-01-01T09:00:00Z', 10_000, '55', true);
      await fill('2026-01-08T09:00:00Z', 10_200, '15', false);
      await fill('2026-01-15T09:00:00Z', 10_500, '25', true);

      const response = await as(context, alice).get(`/api/v1/vehicles/${fuelId}/cost`);

      // 40 litres over 500 km: the first full tank's own 55 are not part of it, the partial
      // fill in the middle is.
      expect(response.body).toMatchObject({
        fuelConsumption: { litersPer100Km: 8, liters: 40, distanceCovered: 500, segments: 1 },
      });
    });
  });
  /*
   * The timeline and the cost summary are two views of the same money. A cost typed into one
   * has to appear in the other, or the product has reproduced the fragmentation it exists to
   * remove (PRD §4).
   */
  describe('costs entered on the timeline', () => {
    let mirrorVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Mirror Garage');
      mirrorVehicle = seeded.vehicleId;
    });

    const addEvent = (payload: Record<string, unknown>) =>
      as(context, alice).post(`/api/v1/vehicles/${mirrorVehicle}/events`, {
        eventType: 'REPAIR',
        title: 'New alternator',
        occurredAt: iso('2026-04-01T10:00:00Z'),
        ...payload,
      });

    it('becomes an expense in the matching category', async () => {
      await addEvent({ costAmountMinor: 42_000, costCurrency: 'USD' });

      const response = await as(context, alice).get(`/api/v1/vehicles/${mirrorVehicle}/expenses`);
      const data = (
        response.body as { data: { category: string; amount: { amountMinor: number } }[] }
      ).data;

      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ category: 'REPAIR', amount: { amountMinor: 42_000 } });
    });

    it('follows a corrected amount rather than leaving the two disagreeing', async () => {
      const created = await addEvent({
        title: 'Tyres',
        costAmountMinor: 60_000,
        costCurrency: 'USD',
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      // The currency travels with the amount: the API refuses a figure with no unit on it.
      const corrected = await as(context, alice).patch(
        `/api/v1/vehicles/${mirrorVehicle}/events/${eventId}`,
        { costAmountMinor: 65_000, costCurrency: 'USD' },
      );
      expect(corrected.status).toBe(200);

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${mirrorVehicle}/expenses?category=REPAIR`,
      );
      const amounts = (response.body as { data: { amount: { amountMinor: number } }[] }).data.map(
        (row) => row.amount.amountMinor,
      );

      expect(amounts).toContain(65_000);
      expect(amounts).not.toContain(60_000);
    });

    /** Clearing the cost must not keep charging the owner for something now recorded as free. */
    it('disappears when the cost is cleared', async () => {
      const created = await addEvent({
        title: 'Free warranty work',
        costAmountMinor: 15_000,
        costCurrency: 'USD',
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      await as(context, alice).patch(`/api/v1/vehicles/${mirrorVehicle}/events/${eventId}`, {
        costAmountMinor: null,
      });

      const rows = await context.database.db
        .select()
        .from(schema.expenses)
        .where(eq(schema.expenses.eventId, eventId));
      expect(rows).toHaveLength(0);
    });

    /*
     * `event_id` is `set null` on delete, so without an explicit removal the expense would
     * survive as an orphan nobody can see and every total still counts.
     */
    it('is removed with the event rather than orphaned into the totals', async () => {
      const created = await addEvent({
        title: 'Duplicate entry',
        costAmountMinor: 25_000,
        costCurrency: 'USD',
      });
      const eventId = (created.body as { event: { id: string } }).event.id;

      const before = await as(context, alice).get(`/api/v1/vehicles/${mirrorVehicle}/cost`);
      await as(context, alice).delete(`/api/v1/vehicles/${mirrorVehicle}/events/${eventId}`);
      const after = await as(context, alice).get(`/api/v1/vehicles/${mirrorVehicle}/cost`);

      const spent = (body: unknown) =>
        (body as { totalSpent: { amountMinor: number } }).totalSpent.amountMinor;
      expect(spent(before.body) - spent(after.body)).toBe(25_000);
    });

    /** A logged service already writes its own expense; the mirror must not add a second. */
    it('does not double-count a maintenance completion', async () => {
      const plan = await as(context, alice).post(`/api/v1/vehicles/${mirrorVehicle}/maintenance`, {
        title: 'Oil change',
        intervalMonths: 12,
      });
      const planId = (plan.body as { id: string }).id;

      await as(context, alice).post(
        `/api/v1/vehicles/${mirrorVehicle}/maintenance/${planId}/complete`,
        {
          performedAt: iso('2026-04-10T10:00:00Z'),
          partsCostAmountMinor: 7_000,
          laborCostAmountMinor: 3_000,
          costCurrency: 'USD',
        },
      );

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${mirrorVehicle}/expenses?category=MAINTENANCE`,
      );
      const data = (response.body as { data: { amount: { amountMinor: number } }[] }).data;

      expect(data).toHaveLength(1);
      expect(data[0]?.amount.amountMinor).toBe(10_000);
    });
  });

  describe('fuel prices', () => {
    it('quotes per litre from amount and quantity, cheapest station first', async () => {
      const car = await seedGarageWithVehicle(context, alice, 'Fuel Price Garage');
      const fillUp = (vendor: string, amountMinor: number, day: string) =>
        create(
          expense({
            vendor,
            amountMinor,
            quantity: '40',
            quantityUnit: 'LITER',
            occurredAt: iso(`2026-05-${day}T08:00:00Z`),
          }),
          car.vehicleId,
        );
      await fillUp('Shell', 7_200, '01');
      await fillUp('Shell', 7_200, '08');
      await fillUp('Aral', 6_400, '15');
      await fillUp('Aral', 6_400, '22');

      const response = await as(context, alice).get(
        `/api/v1/vehicles/${car.vehicleId}/cost/fuel-prices`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject([
        {
          currency: 'USD',
          unit: 'LITER',
          averagePerUnit: '1.700',
          stations: [
            { vendor: 'Aral', averagePerUnit: '1.600', fills: 2 },
            { vendor: 'Shell', averagePerUnit: '1.800', fills: 2 },
          ],
        },
      ]);
      expect((response.body as { points: unknown[] }[])[0]?.points).toHaveLength(4);
    });
  });
});
