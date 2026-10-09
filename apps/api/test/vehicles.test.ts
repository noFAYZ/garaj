import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

describe('vehicles', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let bobGarageId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const garage = await as(context, alice).post('/api/v1/garages', { name: 'Main' });
    garageId = (garage.body as { id: string }).id;
    const bobGarage = await as(context, bob).post('/api/v1/garages', { name: 'Bob' });
    bobGarageId = (bobGarage.body as { id: string }).id;
  });

  afterAll(async () => {
    await context.close();
  });

  describe('type descriptors', () => {
    it('describes every type without authentication, since the form needs it first', async () => {
      const response = await context.app.inject({ method: 'GET', url: '/api/v1/vehicles/types' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(10);
    });

    it('gives a bicycle no engine fields and a boat engine hours', async () => {
      const response = await context.app.inject({ method: 'GET', url: '/api/v1/vehicles/types' });
      const types = response.json() as {
        vehicleType: string;
        specFields: { key: string }[];
        primaryUsageMeter: string | null;
      }[];

      const bicycle = types.find((t) => t.vehicleType === 'BICYCLE')!;
      const boat = types.find((t) => t.vehicleType === 'BOAT')!;

      expect(bicycle.specFields.map((f) => f.key)).not.toContain('fuelType');
      expect(bicycle.primaryUsageMeter).toBe('odometer');
      expect(boat.primaryUsageMeter).toBe('engineHours');
    });
  });

  describe('creation', () => {
    it('creates a car and derives a display name from year, make and model', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'BMW',
        model: 'M3',
        year: 2021,
        currentOdometer: 36_000,
        odometerUnit: 'KM',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        displayName: '2021 BMW M3',
        status: 'ACTIVE',
        currentOdometer: 36_000,
      });
    });

    it('prefers a nickname over the derived name', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'MOTORCYCLE',
        nickname: 'The Blue One',
        make: 'Yamaha',
        model: 'MT-09',
      });

      expect((response.body as { displayName: string }).displayName).toBe('The Blue One');
    });

    /*
     * PRD §6.3: adding a vehicle must not demand a form full of fields. A type alone has to
     * produce something with a usable card title.
     */
    it('creates a vehicle from nothing but a type', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'BICYCLE',
      });

      expect(response.status).toBe(201);
      expect((response.body as { displayName: string }).displayName).toBe('Bicycle');
    });

    /*
     * The offline queue's guarantee (§66). A phone that commits a row and then loses the reply
     * sends the same write again; landing twice would be a duplicate vehicle nobody could tell
     * apart from a real one.
     */
    it('takes a client id and treats a repeat of it as the same vehicle', async () => {
      const id = newId();
      const body = { id, garageId, vehicleType: 'CAR', make: 'Saab', model: '900' };

      const first = await as(context, alice).post('/api/v1/vehicles', body);
      expect(first.status).toBe(201);
      expect((first.body as { id: string }).id).toBe(id);

      const replay = await as(context, alice).post('/api/v1/vehicles', body);
      expect(replay.status).toBe(201);
      expect((replay.body as { id: string }).id).toBe(id);

      const list = await as(context, alice).get(`/api/v1/vehicles?garageId=${garageId}`);
      const saabs = (list.body as { data: { id: string }[] }).data.filter((v) => v.id === id);
      expect(saabs).toHaveLength(1);

      // And the creation is audited once, not once per attempt.
      const entries = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(
          and(eq(schema.auditLogs.resourceId, id), eq(schema.auditLogs.action, 'vehicle.created')),
        );
      expect(entries).toHaveLength(1);
    });

    it('refuses a client id that belongs to someone else s vehicle', async () => {
      const id = newId();
      const mine = await as(context, alice).post('/api/v1/vehicles', {
        id,
        garageId,
        vehicleType: 'CAR',
      });
      expect(mine.status).toBe(201);

      const theirs = await as(context, bob).post('/api/v1/vehicles', {
        id,
        garageId: bobGarageId,
        vehicleType: 'CAR',
      });
      expect(theirs.status).toBe(409);
    });

    it('normalises a VIN so it can be compared and searched', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        identificationNumber: ' wba 8e9 g50 gnu 12345 ',
      });

      expect((response.body as { identificationNumber: string }).identificationNumber).toBe(
        'WBA8E9G50GNU12345',
      );
    });

    it('accepts specs the type supports', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        make: 'BMW',
        specs: { displacementCc: 2993, fuelType: 'GASOLINE', powerHp: 510 },
      });

      expect(response.status).toBe(201);
      expect((response.body as { specs: object }).specs).toEqual({
        displacementCc: 2993,
        fuelType: 'GASOLINE',
        powerHp: 510,
      });
    });

    it('rejects a spec field that does not apply to the type', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'BICYCLE',
        specs: { displacementCc: 2993 },
      });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'specs.displacementCc',
      );
    });

    it('rejects engine hours on a type with no engine-hour meter', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        currentEngineHours: 120,
      });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
        'currentEngineHours',
      );
    });

    /*
     * §79: an amount without a currency cannot be interpreted, and a currency without an
     * amount is noise. Either both or neither.
     */
    it('rejects a purchase price missing half of the money pair', async () => {
      const amountOnly = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        purchasePriceAmountMinor: 5_700_000,
      });
      expect(amountOnly.status).toBe(400);

      const currencyOnly = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        purchasePriceCurrency: 'USD',
      });
      expect(currencyOnly.status).toBe(400);
    });

    it('stores a purchase price as minor units with its currency', async () => {
      const response = await as(context, alice).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
        purchasePriceAmountMinor: 5_700_000,
        purchasePriceCurrency: 'USD',
      });

      expect((response.body as { purchasePrice: object }).purchasePrice).toEqual({
        amountMinor: 5_700_000,
        currency: 'USD',
      });
    });

    it("refuses to add a vehicle to someone else's garage", async () => {
      const response = await as(context, bob).post('/api/v1/vehicles', {
        garageId,
        vehicleType: 'CAR',
      });

      expect(response.status).toBe(404);
    });
  });

  describe('reading and updating', () => {
    let vehicleId: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Update Garage');
      vehicleId = seeded.vehicleId;
    });

    it('returns the type capabilities alongside the vehicle', async () => {
      const response = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);

      expect(response.status).toBe(200);
      expect((response.body as { capabilities: string[] }).capabilities).toContain('engine');
    });

    it('merges specs rather than replacing them', async () => {
      await as(context, alice).patch(`/api/v1/vehicles/${vehicleId}`, {
        specs: { displacementCc: 2993, oilType: '0W-30' },
      });
      const patched = await as(context, alice).patch(`/api/v1/vehicles/${vehicleId}`, {
        specs: { powerHp: 510 },
      });

      expect((patched.body as { specs: object }).specs).toEqual({
        displacementCc: 2993,
        oilType: '0W-30',
        powerHp: 510,
      });
    });

    it('clears a single spec field with null', async () => {
      const patched = await as(context, alice).patch(`/api/v1/vehicles/${vehicleId}`, {
        specs: { oilType: null },
      });

      expect((patched.body as { specs: Record<string, unknown> }).specs).not.toHaveProperty(
        'oilType',
      );
      expect((patched.body as { specs: Record<string, unknown> }).specs).toHaveProperty('powerHp');
    });

    it('refuses to change the vehicle type', async () => {
      const response = await as(context, alice).patch(`/api/v1/vehicles/${vehicleId}`, {
        vehicleType: 'BOAT',
      });

      expect(response.status).toBe(400);
    });

    it('archives rather than deleting, removing it from the list', async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Archive Garage');

      const deleted = await as(context, alice).delete(`/api/v1/vehicles/${seeded.vehicleId}`);
      expect(deleted.status).toBe(204);

      expect((await as(context, alice).get(`/api/v1/vehicles/${seeded.vehicleId}`)).status).toBe(
        404,
      );

      const list = await as(context, alice).get(`/api/v1/vehicles?garageId=${seeded.garageId}`);
      expect((list.body as { data: unknown[] }).data).toHaveLength(0);
    });
  });

  describe('tenancy', () => {
    let aliceVehicle: string;

    beforeAll(async () => {
      const seeded = await seedGarageWithVehicle(context, alice, 'Tenancy Garage');
      aliceVehicle = seeded.vehicleId;
    });

    it("answers 404 for every verb on someone else's vehicle", async () => {
      const bobClient = as(context, bob);

      expect((await bobClient.get(`/api/v1/vehicles/${aliceVehicle}`)).status).toBe(404);
      expect(
        (await bobClient.patch(`/api/v1/vehicles/${aliceVehicle}`, { nickname: 'Mine' })).status,
      ).toBe(404);
      expect((await bobClient.delete(`/api/v1/vehicles/${aliceVehicle}`)).status).toBe(404);
      expect((await bobClient.get(`/api/v1/vehicles/${aliceVehicle}/events`)).status).toBe(404);
      expect((await bobClient.get(`/api/v1/vehicles/${aliceVehicle}/photos`)).status).toBe(404);
    });

    /*
     * The listing must be scoped by membership, not by the query string. Passing a garage id
     * the caller does not belong to has to narrow to nothing, never widen.
     */
    it('returns nothing when filtering by a garage the caller is not in', async () => {
      const list = await as(context, bob).get(`/api/v1/vehicles?garageId=${garageId}`);

      expect(list.status).toBe(200);
      expect((list.body as { data: unknown[] }).data).toHaveLength(0);
    });

    it('lets a VIEWER read but not write', async () => {
      const carol = await signUp(context, 'Carol');
      const seeded = await seedGarageWithVehicle(context, alice, 'Viewer Garage');
      await as(context, alice).post(`/api/v1/garages/${seeded.garageId}/members`, {
        email: carol.email,
        role: 'VIEWER',
      });

      expect((await as(context, carol).get(`/api/v1/vehicles/${seeded.vehicleId}`)).status).toBe(
        200,
      );
      expect(
        (await as(context, carol).patch(`/api/v1/vehicles/${seeded.vehicleId}`, { year: 2020 }))
          .status,
      ).toBe(403);
      expect((await as(context, carol).delete(`/api/v1/vehicles/${seeded.vehicleId}`)).status).toBe(
        403,
      );
    });
  });

  describe('pagination', () => {
    it('pages with a stable cursor and never repeats a row', async () => {
      const dave = await signUp(context, 'Dave');
      const garage = await as(context, dave).post('/api/v1/garages', { name: 'Fleet' });
      const fleetId = (garage.body as { id: string }).id;

      for (let index = 0; index < 5; index += 1) {
        await as(context, dave).post('/api/v1/vehicles', {
          garageId: fleetId,
          vehicleType: 'CAR',
          nickname: `Car ${index}`,
        });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let guard = 0;

      do {
        const url: string = `/api/v1/vehicles?limit=2${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await as(context, dave).get(url);
        const body = page.body as {
          data: { id: string }[];
          pagination: { nextCursor: string | null };
        };
        seen.push(...body.data.map((v) => v.id));
        cursor = body.pagination.nextCursor;
        guard += 1;
      } while (cursor && guard < 10);

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('rejects a malformed cursor instead of returning the first page', async () => {
      const response = await as(context, alice).get('/api/v1/vehicles?cursor=not-a-cursor');
      expect(response.status).toBe(400);
    });
  });
});
