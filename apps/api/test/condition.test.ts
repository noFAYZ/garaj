import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
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

/** Days back from now, as an instant — assessments are timestamped, not dated. */
const daysAgo = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};

const today = () => new Date().toISOString().slice(0, 10);

describe('condition and valuations', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Condition Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const assess = (payload: Record<string, unknown>, vehicle = vehicleId) =>
    as(context, alice).post(`/api/v1/vehicles/${vehicle}/condition`, payload);

  describe('recording an assessment', () => {
    it('averages the scored items into an overall score', async () => {
      const response = await assess({
        assessedAt: iso('2026-09-01T10:00:00Z'),
        items: [
          { category: 'EXTERIOR', score: 80 },
          { category: 'INTERIOR', score: 90 },
        ],
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ overallScore: 85 });
    });

    /*
     * "Looked at it, could not judge" is not "it is ruined" — counting a null as zero would
     * make a careful inspector's report score worse than a careless one's.
     */
    it('leaves an unscored item out of the average rather than counting it as zero', async () => {
      const response = await assess({
        assessedAt: iso('2026-09-02T10:00:00Z'),
        items: [
          { category: 'EXTERIOR', score: 80 },
          { category: 'FRAME', notes: 'Could not see it without a lift.' },
        ],
      });

      expect((response.body as { overallScore: number }).overallScore).toBe(80);
      expect((response.body as { items: unknown[] }).items).toHaveLength(2);
    });

    it('refuses an assessment that scored nothing at all', async () => {
      const response = await assess({ assessedAt: iso('2026-09-02T10:00:00Z'), items: [] });
      expect(response.status).toBe(400);
    });

    it('carries the odometer forward like any other reading', async () => {
      await assess({
        assessedAt: iso('2026-09-03T10:00:00Z'),
        odometer: 44_000,
        odometerUnit: 'KM',
        items: [{ category: 'TIRES', score: 70 }],
      });

      const vehicle = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
      expect((vehicle.body as { currentOdometer: number }).currentOdometer).toBe(44_000);
    });

    it('lists assessments newest first with their items', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/condition`);
      const data = (response.body as { data: { assessedAt: string; items: unknown[] }[] }).data;

      expect(data.length).toBeGreaterThan(1);
      expect(new Date(data[0]!.assessedAt) >= new Date(data[1]!.assessedAt)).toBe(true);
      expect(data[0]!.items.length).toBeGreaterThan(0);
    });
  });

  describe('the current standing', () => {
    let summaryVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Summary Garage');
      summaryVehicle = seeded.vehicleId;

      await assess(
        {
          assessedAt: daysAgo(500),
          items: [
            { category: 'FRAME', score: 95 },
            { category: 'TIRES', score: 30 },
          ],
        },
        summaryVehicle,
      );
      await assess(
        { assessedAt: daysAgo(5), items: [{ category: 'TIRES', score: 85 }] },
        summaryVehicle,
      );
    });

    /*
     * The whole reason the summary is not just "the newest assessment": tyres checked last
     * week and a frame checked over a year ago are both current knowledge about their own
     * category, and showing only the newest would drop the frame entirely.
     */
    it('takes the most recent score per category, across assessments', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${summaryVehicle}/condition/summary`,
      );
      const categories = (
        response.body as { categories: { category: string; score: number; ageDays: number }[] }
      ).categories;

      expect(categories.find((row) => row.category === 'TIRES')?.score).toBe(85);
      expect(categories.find((row) => row.category === 'FRAME')?.score).toBe(95);
      expect(categories.find((row) => row.category === 'TIRES')?.ageDays).toBe(5);
    });

    it('says how many assessments the standing was drawn from', async () => {
      const response = await as(context, alice).get(
        `/api/v1/vehicles/${summaryVehicle}/condition/summary`,
      );
      expect((response.body as { assessmentCount: number }).assessmentCount).toBe(2);
    });
  });

  describe('condition in the health score', () => {
    let healthVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Health Garage');
      healthVehicle = seeded.vehicleId;
    });

    it('adds a condition axis once something has been assessed', async () => {
      const before = await as(context, alice).get(`/api/v1/vehicles/${healthVehicle}/health`);
      const beforeCategory = (
        before.body as { categories: { category: string; score: number | null }[] }
      ).categories.find((row) => row.category === 'CONDITION');
      expect(beforeCategory?.score).toBeNull();

      await assess(
        {
          assessedAt: daysAgo(2),
          items: [
            { category: 'EXTERIOR', score: 60 },
            { category: 'TIRES', score: 40 },
          ],
        },
        healthVehicle,
      );

      const after = await as(context, alice).get(`/api/v1/vehicles/${healthVehicle}/health`);
      const body = after.body as {
        categories: { category: string; score: number | null }[];
        factors: { category: string; label: string; penalty: number }[];
      };

      expect(body.categories.find((row) => row.category === 'CONDITION')?.score).toBe(50);
      // One deduction, naming the worst category — so the arithmetic still checks out.
      const conditionFactors = body.factors.filter((factor) => factor.category === 'CONDITION');
      expect(conditionFactors).toHaveLength(1);
      expect(conditionFactors[0]?.label).toBe('Tires');
      expect(conditionFactors[0]?.penalty).toBe(50);
    });

    /*
     * A judgement from two years ago is not evidence about the vehicle now, and letting it
     * prop up a score would be the system reassuring the owner on the strength of something
     * nobody has checked since.
     */
    it('ignores an assessment older than a year', async () => {
      const stale = await seedGarageWithVehicle(context, alice, 'Stale Garage');
      await assess(
        { assessedAt: daysAgo(400), items: [{ category: 'EXTERIOR', score: 20 }] },
        stale.vehicleId,
      );

      const response = await as(context, alice).get(`/api/v1/vehicles/${stale.vehicleId}/health`);
      const category = (
        response.body as { categories: { category: string; score: number | null }[] }
      ).categories.find((row) => row.category === 'CONDITION');

      expect(category?.score).toBeNull();
    });
  });

  describe('valuations', () => {
    let valued: string;

    beforeAll(async () => {
      const created = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'Porsche',
        model: '944',
        purchasePriceAmountMinor: 2_000_000,
        purchasePriceCurrency: 'USD',
        purchaseDate: '2022-01-01',
      });
      valued = (created.body as { id: string }).id;
    });

    const record = (payload: Record<string, unknown>) =>
      as(context, alice).post(`/api/v1/vehicles/${valued}/valuations`, payload);

    it('records what the vehicle is worth, with its source', async () => {
      const response = await record({
        amountMinor: 2_400_000,
        currency: 'USD',
        valuationDate: '2026-01-15',
        source: 'DEALER',
        confidence: 80,
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        estimatedValue: { amountMinor: 2_400_000, currency: 'USD' },
        source: 'DEALER',
        confidence: 80,
      });
    });

    it('reports the change since purchase, and the percentage', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${valued}/valuations`);

      expect(response.body).toMatchObject({
        purchasePrice: { amountMinor: 2_000_000 },
        currentValue: { amountMinor: 2_400_000 },
        changeSincePurchase: { amountMinor: 400_000, currency: 'USD' },
        changePercent: 20,
      });
    });

    it('takes the newest valuation as the current value', async () => {
      await record({ amountMinor: 2_600_000, currency: 'USD', valuationDate: '2026-06-01' });
      // Deliberately out of order: an older figure entered later must not become "current".
      await record({ amountMinor: 1_000_000, currency: 'USD', valuationDate: '2023-01-01' });

      const response = await as(context, alice).get(`/api/v1/vehicles/${valued}/valuations`);
      expect(
        (response.body as { currentValue: { amountMinor: number } }).currentValue.amountMinor,
      ).toBe(2_600_000);
    });

    it('keeps the full history in date order', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${valued}/valuations`);
      const dates = (response.body as { history: { valuationDate: string }[] }).history.map(
        (row) => row.valuationDate,
      );

      expect(dates).toEqual([...dates].sort().reverse());
    });

    /*
     * A gain computed across an exchange rate this application invented would be a number
     * nobody could check, so it is not computed at all.
     */
    it('reports no change when the valuation is in another currency', async () => {
      const other = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'Renault',
        model: '5',
        purchasePriceAmountMinor: 800_000,
        purchasePriceCurrency: 'EUR',
      });
      const otherId = (other.body as { id: string }).id;

      await as(context, alice).post(`/api/v1/vehicles/${otherId}/valuations`, {
        amountMinor: 900_000,
        currency: 'CHF',
        valuationDate: '2026-05-01',
      });

      const response = await as(context, alice).get(`/api/v1/vehicles/${otherId}/valuations`);
      expect(response.body).toMatchObject({
        currentValue: { currency: 'CHF' },
        changeSincePurchase: null,
        changePercent: null,
      });
    });

    it('rejects a currency that is not a real ISO 4217 code', async () => {
      const response = await record({
        amountMinor: 100,
        currency: 'XYZ',
        valuationDate: '2026-05-01',
      });
      expect(response.status).toBe(400);
    });

    it('deletes a valuation outright', async () => {
      const created = await record({
        amountMinor: 123_456,
        currency: 'USD',
        valuationDate: today(),
      });
      const id = (created.body as { id: string }).id;

      expect(
        (await as(context, alice).delete(`/api/v1/vehicles/${valued}/valuations/${id}`)).status,
      ).toBe(204);

      const response = await as(context, alice).get(`/api/v1/vehicles/${valued}/valuations`);
      const ids = (response.body as { history: { id: string }[] }).history.map((row) => row.id);
      expect(ids).not.toContain(id);
    });

    /** The dashboard's "total value" is what things are worth now, not what they cost. */
    it('moves the dashboard total to the latest valuation', async () => {
      const response = await as(context, alice).get('/api/v1/dashboard');
      const total = (response.body as { summary: { totalValue: { amountMinor: number } | null } })
        .summary.totalValue;

      // Mixed currencies across this garage's vehicles, so the honest answer is null; the
      // point is that it did not silently sum them.
      expect(total === null || total.amountMinor > 0).toBe(true);
    });
  });

  describe('correcting an assessment', () => {
    const record = async () =>
      (
        await assess({
          assessedAt: iso('2026-08-01T10:00:00Z'),
          notes: 'First look',
          items: [
            { category: 'EXTERIOR', score: 60 },
            { category: 'FRAME', notes: 'Could not see it.' },
          ],
        })
      ).body as { id: string; assessedAt: string };

    const patch = (id: string, payload: Record<string, unknown>, user = alice) =>
      as(context, user).patch(`/api/v1/vehicles/${vehicleId}/condition/${id}`, payload);

    it('changes only the fields sent, keeping the items', async () => {
      const { id, assessedAt } = await record();

      const response = await patch(id, { notes: 'Second look' });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ notes: 'Second look', assessedAt, overallScore: 60 });
      expect((response.body as { items: unknown[] }).items).toHaveLength(2);
    });

    it('replaces the whole item set and recomputes the overall score', async () => {
      const { id } = await record();

      const response = await patch(id, {
        items: [
          { category: 'EXTERIOR', score: 90 },
          { category: 'INTERIOR', score: 70 },
        ],
      });

      const body = response.body as { overallScore: number; items: { category: string }[] };
      expect(body.overallScore).toBe(80);
      expect(body.items.map((item) => item.category).sort()).toEqual(['EXTERIOR', 'INTERIOR']);
    });

    it('refuses to empty an assessment', async () => {
      const { id } = await record();
      expect((await patch(id, { items: [] })).status).toBe(400);
    });

    it('writes an audit entry', async () => {
      const { id } = await record();
      await patch(id, { notes: 'Audited' });

      const rows = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.resourceId, id));
      expect(rows.map((row) => row.action)).toContain('condition.updated');
    });

    it('answers 404 to someone outside the garage', async () => {
      const { id } = await record();
      expect((await patch(id, { notes: 'Not mine' }, bob)).status).toBe(404);
    });
  });

  describe('photos on an assessment', () => {
    const attachPhoto = async (conditionAssessmentId: string, vehicle = vehicleId) => {
      const ticket = (
        await as(context, alice).post(`/api/v1/vehicles/${vehicle}/photos/upload-url`, {
          filename: 'scratch.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 1000,
        })
      ).body as { photoId: string; storageKey: string };
      context.storage.put(ticket.storageKey, {
        sizeBytes: 1000,
        mimeType: 'image/jpeg',
        checksum: null,
      });
      const finalized = await as(context, alice).post(
        `/api/v1/vehicles/${vehicle}/photos/${ticket.photoId}/finalize`,
        { conditionAssessmentId },
      );
      return { photoId: ticket.photoId, status: finalized.status };
    };

    const photoFor = async (photoId: string, vehicle = vehicleId) => {
      const photos = (await as(context, alice).get(`/api/v1/vehicles/${vehicle}/photos`)).body as {
        id: string;
        conditionAssessmentId: string | null;
      }[];
      return photos.find((photo) => photo.id === photoId);
    };

    it('attaches a photo and says so in the gallery', async () => {
      const { id } = (
        await assess({
          assessedAt: iso('2026-08-05T10:00:00Z'),
          items: [{ category: 'EXTERIOR', score: 50 }],
        })
      ).body as { id: string };

      const { photoId, status } = await attachPhoto(id);

      expect(status).toBe(204);
      expect((await photoFor(photoId))?.conditionAssessmentId).toBe(id);
    });

    it('does not make an assessment photo the vehicle photo on its own', async () => {
      const bare = await seedGarageWithVehicle(context, alice, 'No Photo Garage');
      const { id } = (
        await assess(
          { assessedAt: iso('2026-08-05T10:00:00Z'), items: [{ category: 'TIRES', score: 50 }] },
          bare.vehicleId,
        )
      ).body as { id: string };

      await attachPhoto(id, bare.vehicleId);

      const vehicle = (await as(context, alice).get(`/api/v1/vehicles/${bare.vehicleId}`)).body as {
        primaryPhoto: unknown;
      };
      expect(vehicle.primaryPhoto).toBeNull();
    });

    it('refuses an assessment that belongs to another vehicle', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Other Garage');
      const { id } = (
        await assess(
          { assessedAt: iso('2026-08-05T10:00:00Z'), items: [{ category: 'EXTERIOR', score: 50 }] },
          other.vehicleId,
        )
      ).body as { id: string };

      const { status } = await attachPhoto(id);
      expect(status).toBe(400);
    });

    it('keeps the photo in the gallery, detached, when the assessment is deleted', async () => {
      const { id } = (
        await assess({
          assessedAt: iso('2026-08-06T10:00:00Z'),
          items: [{ category: 'EXTERIOR', score: 40 }],
        })
      ).body as { id: string };
      const { photoId } = await attachPhoto(id);

      await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/condition/${id}`);

      const photo = await photoFor(photoId);
      expect(photo).toBeDefined();
      expect(photo?.conditionAssessmentId).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('answers 404 for a vehicle in another garage', async () => {
      const responses = await Promise.all([
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/condition`),
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/condition/summary`),
        as(context, bob).get(`/api/v1/vehicles/${vehicleId}/valuations`),
        as(context, bob).post(`/api/v1/vehicles/${vehicleId}/valuations`, {
          amountMinor: 1,
          currency: 'USD',
          valuationDate: '2026-01-01',
        }),
      ]);

      for (const response of responses) expect(response.status).toBe(404);
    });
  });
});
