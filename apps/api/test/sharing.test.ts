import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import { hashToken } from '../src/modules/sharing/domain/token';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

const iso = (value: string) => new Date(value).toISOString();

const ALL = [
  'IDENTIFICATION_NUMBER',
  'MAINTENANCE',
  'MAINTENANCE_COSTS',
  'CONDITION',
  'DOCUMENTS',
  'FINANCES',
];

describe('sharing and the vehicle passport', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;
  let token: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Passport Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;

    const client = as(context, alice);
    await client.patch(`/api/v1/vehicles/${vehicleId}`, {
      identificationNumber: 'WBSBL93040JR12345',
      purchaseDate: '2022-03-01',
      purchasePriceAmountMinor: 4_500_000,
      purchasePriceCurrency: 'USD',
    });

    const plan = await client.post(`/api/v1/vehicles/${vehicleId}/maintenance`, {
      title: 'Oil and filter',
      intervalMonths: 12,
    });
    await client.post(
      `/api/v1/vehicles/${vehicleId}/maintenance/${(plan.body as { id: string }).id}/complete`,
      {
        performedAt: iso('2026-03-01T10:00:00Z'),
        provider: 'Hoffman Motors',
        partsCostAmountMinor: 12_000,
        laborCostAmountMinor: 8_000,
        costCurrency: 'USD',
      },
    );

    await client.post(`/api/v1/vehicles/${vehicleId}/condition`, {
      assessedAt: iso('2026-08-01T10:00:00Z'),
      items: [
        { category: 'EXTERIOR', score: 85 },
        { category: 'TIRES', score: 70 },
      ],
    });

    await client.post(`/api/v1/vehicles/${vehicleId}/valuations`, {
      amountMinor: 4_900_000,
      currency: 'USD',
      valuationDate: '2026-08-15',
      source: 'DEALER',
    });

    const share = await client.post(`/api/v1/vehicles/${vehicleId}/shares`, {
      label: 'For sale',
      sections: ALL,
    });
    token = (share.body as { token: string }).token;
  });

  afterAll(async () => {
    await context.close();
  });

  describe('creating a link', () => {
    it('returns the token exactly once', async () => {
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
      });
      const body = created.body as { id: string; token: string };

      expect(created.status).toBe(201);
      expect(body.token).toBeTruthy();

      const listed = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/shares`);
      const row = (listed.body as { id: string; token?: string }[]).find(
        (item) => item.id === body.id,
      );
      // Listing never carries it — the database has only the hash.
      expect(row?.token).toBeUndefined();
    });

    /*
     * The token is a bearer credential. Storing it in plain text means a database dump — or
     * a stray log line — hands over every live link at once.
     */
    it('stores a hash, not the token', async () => {
      const [row] = await context.database.db
        .select()
        .from(schema.shareLinks)
        .where(eq(schema.shareLinks.tokenHash, hashToken(token)));

      expect(row).toBeDefined();
      expect(row?.tokenHash).not.toBe(token);
      expect(row?.tokenHash).toHaveLength(64);
    });

    /** Sharing a vehicle's whole history is a settings-level act, not a read. */
    it('refuses a member who cannot manage the garage', async () => {
      await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: bob.email,
        role: 'MEMBER',
      });

      const response = await as(context, bob).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
      });
      expect(response.status).toBe(403);

      await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
    });
  });

  describe('reading the passport', () => {
    const read = (value: string) => as(context, bob).get(`/api/v1/public/passport/${value}`);

    it('serves the history to anyone holding the link', async () => {
      const response = await read(token);
      const body = response.body as {
        vehicle: { displayName: string; identificationNumber: string };
        maintenance: { recordCount: number; history: { provider: string }[] };
        condition: { overallScore: number };
        finances: { totalInvested: { amountMinor: number }; currentValue: { amountMinor: number } };
        health: { overall: number };
      };

      expect(response.status).toBe(200);
      expect(body.vehicle.identificationNumber).toBe('WBSBL93040JR12345');
      expect(body.maintenance.recordCount).toBe(1);
      expect(body.maintenance.history[0]?.provider).toBe('Hoffman Motors');
      expect(body.condition.overallScore).toBe(78);
      // 45,000.00 paid plus 200.00 of service.
      expect(body.finances.totalInvested.amountMinor).toBe(4_520_000);
      expect(body.finances.currentValue.amountMinor).toBe(4_900_000);
      expect(body.health.overall).toBeGreaterThan(0);
    });

    /*
     * The passport is an allowlist. Nobody who never agreed to be published should appear in
     * something handed to a stranger.
     */
    it('names no people at all', async () => {
      const serialised = JSON.stringify((await read(token)).body);

      expect(serialised).not.toContain(alice.email);
      expect(serialised).not.toContain('Alice');
      expect(serialised.toLowerCase()).not.toContain('createdby');
      expect(serialised.toLowerCase()).not.toContain('assessedby');
    });

    /*
     * A registration certificate carries an address, a signature and an identity number. The
     * passport lists that a document exists; it never links to the file.
     */
    it('lists documents without any way to open them', async () => {
      const body = (await read(token)).body as { documents: Record<string, unknown>[] };

      for (const document of body.documents) {
        expect(document).not.toHaveProperty('storageKey');
        expect(document).not.toHaveProperty('url');
        expect(document).not.toHaveProperty('id');
      }
    });

    it('works without a session at all', async () => {
      const response = await context.app.inject({
        method: 'GET',
        url: `/api/v1/public/passport/${token}`,
      });
      expect(response.statusCode).toBe(200);
    });

    it('answers 404 for a token that was never issued', async () => {
      const response = await read('a'.repeat(43));
      expect(response.status).toBe(404);
    });

    it('stops working the moment the link is revoked', async () => {
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
      });
      const { id, token: fresh } = created.body as { id: string; token: string };

      expect((await read(fresh)).status).toBe(200);

      await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/shares/${id}`);

      expect((await read(fresh)).status).toBe(404);
    });

    it('stops working once it has expired', async () => {
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
        expiresInDays: 1,
      });
      const { id, token: fresh } = created.body as { id: string; token: string };

      expect((await read(fresh)).status).toBe(200);

      // Move the expiry into the past rather than waiting a day for it.
      await context.database.db
        .update(schema.shareLinks)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.shareLinks.id, id));

      expect((await read(fresh)).status).toBe(404);
    });

    /** The row survives revocation: the owner should still see the link existed. */
    it('keeps a revoked link visible to its owner, with its view count', async () => {
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
        label: 'Kept',
      });
      const { id, token: fresh } = created.body as { id: string; token: string };

      await read(fresh);
      await read(fresh);
      await as(context, alice).delete(`/api/v1/vehicles/${vehicleId}/shares/${id}`);

      const listed = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/shares`);
      const row = (
        listed.body as { id: string; revokedAt: string | null; viewCount: number }[]
      ).find((item) => item.id === id);

      expect(row?.revokedAt).not.toBeNull();
      expect(row?.viewCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('choosing what a link shows (PRD §1531)', () => {
    it('leaves out every section the link was not made with', async () => {
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ['MAINTENANCE'],
      });
      expect(created.body).toMatchObject({ sections: ['MAINTENANCE'] });

      const response = await as(context, bob).get(
        `/api/v1/public/passport/${(created.body as { token: string }).token}`,
      );
      const passport = response.body as Record<string, unknown> & {
        vehicle: { identificationNumber: string | null };
        maintenance: { history: { provider: string | null; totalCost: unknown }[] };
      };

      expect(response.status).toBe(200);
      expect(passport.sections).toEqual(['MAINTENANCE']);
      expect(passport.vehicle.identificationNumber).toBeNull();
      expect(passport.finances).toBeNull();
      expect(passport.condition).toBeNull();
      expect(passport.documents).toBeNull();
      // The history is shown, what it cost is not.
      expect(passport.maintenance.history[0]).toMatchObject({
        provider: 'Hoffman Motors',
        totalCost: null,
      });

      const serialised = response.text;
      expect(serialised).not.toContain('WBSBL93040JR12345');
      expect(serialised).not.toContain('4500000');
      expect(serialised).not.toContain('20000');
    });

    it('requires the owner to say what to include', async () => {
      const response = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {});
      expect(response.status).toBe(400);
    });
  });

  describe('managing links', () => {
    it('answers 404 for a vehicle in another garage', async () => {
      const other = await seedGarageWithVehicle(context, bob, 'Bob Garage');
      const response = await as(context, alice).get(`/api/v1/vehicles/${other.vehicleId}/shares`);
      expect(response.status).toBe(404);
    });

    it('answers 404 revoking a link that belongs to another vehicle', async () => {
      const other = await seedGarageWithVehicle(context, alice, 'Other Garage');
      const created = await as(context, alice).post(`/api/v1/vehicles/${vehicleId}/shares`, {
        sections: ALL,
      });
      const { id } = created.body as { id: string };

      const response = await as(context, alice).delete(
        `/api/v1/vehicles/${other.vehicleId}/shares/${id}`,
      );
      expect(response.status).toBe(404);
    });
  });
});
