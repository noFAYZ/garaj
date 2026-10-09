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
import type { ImportReport } from '@vehicle-os/contracts';

const iso = (value: string) => new Date(value).toISOString();

const FUELLY = [
  'Date,Odometer,Gallons,Total Spent,Partial,Gas Brand',
  '2026-04-01,10000,12.5,41.25,0,Shell',
  '2026-04-15,10400,11.0,37.40,1,BP',
  'not-a-date,10800,10.0,33.00,0,Esso',
].join('\r\n');

describe('export and import', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Transfer Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;

    await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/expenses`, {
      category: 'MAINTENANCE',
      description: 'Oil change, filter',
      amountMinor: 9_950,
      currency: 'USD',
      occurredAt: iso('2026-03-01T09:00:00Z'),
    });
  });

  afterAll(async () => {
    await context.close();
  });

  describe('export', () => {
    it('returns a CSV download whose rows parse back to what was stored', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/export`);

      expect(response.status).toBe(200);
      expect(response.raw.headers['content-type']).toContain('text/csv');
      expect(response.raw.headers['content-disposition']).toContain('attachment');

      const { rows } = parseCsvRecords(response.text);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        category: 'MAINTENANCE',
        // The comma in the description survives the round trip rather than shifting columns.
        description: 'Oil change, filter',
        amountminor: '9950',
        currency: 'USD',
      });
    });

    it('returns every dataset at once as JSON', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${vehicleId}/export?format=json`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ vehicleIds: [vehicleId] });
      const archive = response.body as { expenses: unknown[]; events: unknown[] };
      expect(archive.expenses).toHaveLength(1);
      expect(Array.isArray(archive.events)).toBe(true);
    });

    it('exports a whole garage for a member, and 404s for a stranger', async () => {
      const mine = await as(context, alice).get(`/api/v1/garages/${garageId}/export`);
      expect(mine.status).toBe(200);

      const theirs = await as(context, bob).get(`/api/v1/garages/${garageId}/export`);
      expect(theirs.status).toBe(404);
    });
  });

  describe('import', () => {
    const importFuelly = (payload: Record<string, unknown> = {}) =>
      as(context, alice).post(`/api/v1/vehicles/${vehicleId}/import`, {
        format: 'fuelly',
        csv: FUELLY,
        ...payload,
      });

    it('reports what it would do and writes nothing by default', async () => {
      const response = await importFuelly();
      const report = response.body as ImportReport;

      expect(response.status).toBe(200);
      expect(report).toMatchObject({ dryRun: true, rowsRead: 3, created: 2, failed: 1 });
      expect(report.problems[0]).toMatchObject({ line: 4 });
      expect(report.preview[0]).toMatchObject({ amountMinor: 4_125, currency: 'USD' });

      const after = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/expenses`);
      expect((after.body as { data: unknown[] }).data).toHaveLength(1);
    });

    it('creates the rows once, however many times the same file is sent', async () => {
      const first = await importFuelly({ dryRun: false });
      expect((first.body as ImportReport).created).toBe(2);

      const second = await importFuelly({ dryRun: false });
      expect(second.body).toMatchObject({ created: 0, duplicates: 2 });

      const after = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/expenses`);
      expect((after.body as { data: unknown[] }).data).toHaveLength(3);
    });

    it('stores quantities in the unit the importer was told the file uses', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Gallon Garage');
      const response = await as(context, alice).post(`/api/v1/vehicles/${other.vehicleId}/import`, {
        format: 'fuelly',
        csv: FUELLY,
        volumeUnit: 'US_GALLON',
        dryRun: false,
      });
      expect(response.body).toMatchObject({ volumeUnit: 'US_GALLON', created: 2 });

      const list = await as(context, alice).get(`/api/v1/vehicles/${other.vehicleId}/expenses`);
      const rows = (list.body as { data: { quantityUnit: string }[] }).data;
      expect(rows.every((row) => row.quantityUnit === 'US_GALLON')).toBe(true);
    });

    it('round-trips its own export', async () => {
      const exported = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/export`);
      const response = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/import`, {
        format: 'garaj',
        csv: exported.text,
        dryRun: false,
      });

      // Every row is already here under the id the export wrote, so nothing is created.
      expect(response.body).toMatchObject({ created: 0, failed: 0 });
    });

    it('refuses a file that maps to nothing rather than importing blanks', async () => {
      const response = await importFuelly({ csv: 'a,b\r\n1,2\r\n' });
      expect(response.status).toBe(400);
      expect(
        (response.body as { error: { fields?: Record<string, string> } }).error.fields,
      ).toHaveProperty('format');
    });

    it('is refused for someone outside the garage', async () => {
      const response = await as(context, bob).post(`/api/v1/vehicles/${vehicleId}/import`, {
        format: 'fuelly',
        csv: FUELLY,
      });
      expect(response.status).toBe(404);
    });
  });
});
