import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';
import { parseCsvRecords } from '../src/infrastructure/csv';

const iso = (value: string) => new Date(value).toISOString();

describe('mileage log', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    ({ vehicleId } = await seedGarageWithVehicle(context, alice, 'Mileage Garage'));
  });

  afterAll(async () => {
    await context.close();
  });

  const trip = (payload: Record<string, unknown>) =>
    as(context, alice).post(`/api/v1/vehicles/${vehicleId}/events`, {
      eventType: 'TRIP',
      title: 'Client visit',
      occurredAt: iso('2026-04-10T09:00:00Z'),
      ...payload,
    });

  it('measures a trip from its readings and keeps the rate on the record', async () => {
    const response = await trip({
      odometer: 36_120,
      odometerUnit: 'KM',
      trip: { purpose: 'BUSINESS', startOdometer: 36_000, rateMinor: 30, rateCurrency: 'EUR' },
    });

    expect(response.status).toBe(201);
    expect((response.body as { event: unknown }).event).toMatchObject({
      trip: {
        purpose: 'BUSINESS',
        distance: 120,
        rate: { amountMinor: 30, currency: 'EUR' },
        deduction: { amountMinor: 3_600, currency: 'EUR' },
      },
    });
  });

  it('refuses mileage on anything but a trip, and readings that disagree', async () => {
    const fuel = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/events`, {
      eventType: 'FUEL',
      title: 'Fill',
      occurredAt: iso('2026-04-11T09:00:00Z'),
      trip: { purpose: 'BUSINESS', distance: 10 },
    });
    expect(fuel.status).toBe(400);

    const mismatch = await trip({
      odometer: 36_200,
      odometerUnit: 'KM',
      trip: { purpose: 'BUSINESS', startOdometer: 36_120, distance: 99 },
    });
    expect(mismatch.status).toBe(400);
  });

  it('reports a period by purpose, deducting only business trips at their own rate', async () => {
    await trip({
      occurredAt: iso('2026-05-02T09:00:00Z'),
      trip: { purpose: 'PERSONAL', distance: 40, rateMinor: 30, rateCurrency: 'EUR' },
    });
    await trip({
      occurredAt: iso('2026-05-03T09:00:00Z'),
      trip: { purpose: 'BUSINESS', distance: 10 },
    });
    // Outside the window.
    await trip({
      occurredAt: iso('2026-08-01T09:00:00Z'),
      trip: { purpose: 'BUSINESS', distance: 500, rateMinor: 30, rateCurrency: 'EUR' },
    });

    const window = `from=${iso('2026-04-01T00:00:00Z')}&to=${iso('2026-06-30T23:59:59Z')}`;
    const report = await as(context, alice).get(
      `/api/v1/vehicles/${vehicleId}/mileage-report?${window}`,
    );

    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({
      distanceUnit: 'KM',
      totals: { BUSINESS: 130, PERSONAL: 40, COMMUTE: 0 },
      deductions: [{ amountMinor: 3_600, currency: 'EUR' }],
      unratedBusinessTrips: 1,
    });

    const csv = await as(context, alice).get(
      `/api/v1/vehicles/${vehicleId}/mileage-report?${window}&format=csv`,
    );
    expect(csv.raw.headers['content-type']).toContain('text/csv');
    const { rows } = parseCsvRecords(csv.text);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ purpose: 'BUSINESS', distance: '120', deduction: '36.00' });
  });
});
