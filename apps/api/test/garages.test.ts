import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import { as, createTestContext, signUp, type SignedUpUser, type TestContext } from './harness';

describe('garages', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
  });

  afterAll(async () => {
    await context.close();
  });

  it('makes the creator the owner', async () => {
    const created = await as(context, alice).post('/api/v1/garages', { name: 'Home Garage' });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Home Garage',
      role: 'OWNER',
      ownerId: alice.userId,
      vehicleCount: 0,
      defaultCurrency: 'USD',
    });
  });

  it('lists only garages the caller belongs to', async () => {
    await as(context, alice).post('/api/v1/garages', { name: 'Alice Only' });
    const bobsList = await as(context, bob).get('/api/v1/garages');

    expect(bobsList.status).toBe(200);
    expect((bobsList.body as { name: string }[]).map((g) => g.name)).not.toContain('Alice Only');
  });

  /*
   * The core tenancy guarantee (PRD §75). Bob holds a real garage id belonging to Alice;
   * every verb must answer 404, not 403 — a 403 would confirm the garage exists and turn an
   * id leak into an enumeration oracle.
   */
  it("answers 404 for every operation on someone else's garage", async () => {
    const garage = await as(context, alice).post('/api/v1/garages', { name: 'Private' });
    const id = (garage.body as { id: string }).id;
    const bobClient = as(context, bob);

    expect((await bobClient.get(`/api/v1/garages/${id}`)).status).toBe(404);
    expect((await bobClient.patch(`/api/v1/garages/${id}`, { name: 'Mine now' })).status).toBe(404);
    expect((await bobClient.delete(`/api/v1/garages/${id}`)).status).toBe(404);
    expect((await bobClient.get(`/api/v1/garages/${id}/members`)).status).toBe(404);
    expect(
      (await bobClient.post(`/api/v1/garages/${id}/members`, { email: bob.email, role: 'OWNER' }))
        .status,
    ).toBe(404);
  });

  it('rejects an unknown currency', async () => {
    const response = await as(context, alice).post('/api/v1/garages', {
      name: 'Bad Currency',
      defaultCurrency: 'XYZ',
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
      'defaultCurrency',
    );
  });

  it('leaves untouched fields alone on a partial update', async () => {
    const garage = await as(context, alice).post('/api/v1/garages', {
      name: 'Patch Me',
      description: 'Original description',
      defaultCurrency: 'EUR',
    });
    const id = (garage.body as { id: string }).id;

    const patched = await as(context, alice).patch(`/api/v1/garages/${id}`, { name: 'Renamed' });

    expect(patched.body).toMatchObject({
      name: 'Renamed',
      description: 'Original description',
      defaultCurrency: 'EUR',
    });
  });

  describe('members', () => {
    let garageId: string;

    beforeAll(async () => {
      const garage = await as(context, alice).post('/api/v1/garages', { name: 'Shared' });
      garageId = (garage.body as { id: string }).id;
    });

    it('adds an existing user by email', async () => {
      const added = await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: bob.email,
        role: 'MEMBER',
      });

      expect(added.status).toBe(201);
      expect(added.body).toMatchObject({ email: bob.email, role: 'MEMBER', userId: bob.userId });
    });

    it('makes the garage visible to the new member', async () => {
      const list = await as(context, bob).get('/api/v1/garages');
      const names = list.body as { name: string; role: string }[];
      expect(names.find((g) => g.name === 'Shared')?.role).toBe('MEMBER');
    });

    it('matches the email case-insensitively', async () => {
      const carol = await signUp(context, 'Carol');
      const added = await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: carol.email.toUpperCase(),
        role: 'VIEWER',
      });

      expect(added.status).toBe(201);
      expect((added.body as { userId: string }).userId).toBe(carol.userId);
    });

    it('refuses to add the same person twice', async () => {
      const again = await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: bob.email,
        role: 'ADMIN',
      });

      expect(again.status).toBe(409);
      expect((again.body as { error: { code: string } }).error.code).toBe('ALREADY_MEMBER');
    });

    /*
     * There is no pending-invitation concept yet, so an unknown address must fail loudly.
     * Silently succeeding would leave the owner waiting for someone who was never added.
     */
    it('reports an address with no account rather than pretending to invite', async () => {
      const response = await as(context, alice).post(`/api/v1/garages/${garageId}/members`, {
        email: 'nobody@example.test',
        role: 'MEMBER',
      });

      expect(response.status).toBe(400);
      expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty('email');
    });

    it('stops a MEMBER managing members at all', async () => {
      const response = await as(context, bob).post(`/api/v1/garages/${garageId}/members`, {
        email: 'someone@example.test',
        role: 'MEMBER',
      });

      // Bob is a member, so the garage is not hidden from him — 403 is the honest answer.
      expect(response.status).toBe(403);
    });

    it('refuses to remove the last owner', async () => {
      const members = await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
      const owner = (members.body as { id: string; role: string }[]).find(
        (m) => m.role === 'OWNER',
      )!;

      const response = await as(context, alice).delete(
        `/api/v1/garages/${garageId}/members/${owner.id}`,
      );

      expect(response.status).toBe(409);
      expect((response.body as { error: { code: string } }).error.code).toBe('LAST_OWNER');
    });

    it('refuses to demote the last owner', async () => {
      const members = await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
      const owner = (members.body as { id: string; role: string }[]).find(
        (m) => m.role === 'OWNER',
      )!;

      const response = await as(context, alice).patch(
        `/api/v1/garages/${garageId}/members/${owner.id}`,
        { role: 'MEMBER' },
      );

      expect(response.status).toBe(409);
    });

    it('stops an admin promoting anyone to owner, including themselves', async () => {
      const members = await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
      const bobMember = (members.body as { id: string; userId: string }[]).find(
        (m) => m.userId === bob.userId,
      )!;
      await as(context, alice).patch(`/api/v1/garages/${garageId}/members/${bobMember.id}`, {
        role: 'ADMIN',
      });

      const response = await as(context, bob).patch(
        `/api/v1/garages/${garageId}/members/${bobMember.id}`,
        { role: 'OWNER' },
      );

      expect(response.status).toBe(409);
      expect((response.body as { error: { code: string } }).error.code).toBe('OWNER_ONLY');
    });

    it('stops an admin removing an owner', async () => {
      const members = await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
      const owner = (members.body as { id: string; role: string }[]).find(
        (m) => m.role === 'OWNER',
      )!;

      const response = await as(context, bob).delete(
        `/api/v1/garages/${garageId}/members/${owner.id}`,
      );

      expect(response.status).toBe(409);
    });

    it('writes an audit row for every membership change', async () => {
      const logs = await context.database.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.garageId, garageId));

      const actions = logs.map((log) => log.action);
      expect(actions).toContain('garage.created');
      expect(actions).toContain('garage.member_added');
      expect(actions).toContain('garage.member_role_changed');
      // The email is denormalised so the trail survives the account being deleted.
      expect(logs.every((log) => log.actorEmail !== null)).toBe(true);
    });

    it('removes a member and takes their access with it', async () => {
      const members = await as(context, alice).get(`/api/v1/garages/${garageId}/members`);
      const bobMember = (members.body as { id: string; userId: string }[]).find(
        (m) => m.userId === bob.userId,
      )!;

      const removed = await as(context, alice).delete(
        `/api/v1/garages/${garageId}/members/${bobMember.id}`,
      );
      expect(removed.status).toBe(204);

      expect((await as(context, bob).get(`/api/v1/garages/${garageId}`)).status).toBe(404);
    });
  });

  describe('drivers', () => {
    it('assigns many vehicles to many members, only within the garage, managers only', async () => {
      const alice2 = as(context, alice);
      const garage = await alice2.post('/api/v1/garages', { name: 'Fleet' });
      const garageId = (garage.body as { id: string }).id;
      const vehicle = async (model: string) =>
        (
          (await alice2.post('/api/v1/vehicles', { garageId, vehicleType: 'CAR', model })).body as {
            id: string;
          }
        ).id;
      const [van, car] = [await vehicle('Van'), await vehicle('Car')];
      await alice2.post(`/api/v1/garages/${garageId}/members`, {
        email: bob.email,
        role: 'DRIVER',
      });
      const members = (await alice2.get(`/api/v1/garages/${garageId}/members`)).body as {
        id: string;
        userId: string;
        vehicleIds: string[];
      }[];
      const me = members.find((m) => m.userId === alice.userId)!;
      const bobMember = members.find((m) => m.userId === bob.userId)!;
      expect(bobMember.vehicleIds).toEqual([]);

      const path = (memberId: string) => `/api/v1/garages/${garageId}/members/${memberId}/vehicles`;
      expect((await alice2.put(path(bobMember.id), { vehicleIds: [van, car] })).status).toBe(200);
      expect((await alice2.put(path(me.id), { vehicleIds: [van] })).status).toBe(200);

      const after = (await alice2.get(`/api/v1/garages/${garageId}/members`)).body as {
        id: string;
        vehicleIds: string[];
      }[];
      expect(after.find((m) => m.id === bobMember.id)!.vehicleIds.sort()).toEqual(
        [van, car].sort(),
      );
      expect(after.find((m) => m.id === me.id)!.vehicleIds).toEqual([van]);

      // A vehicle from another garage is refused, and so is a driver reshaping assignments.
      const elsewhere = await alice2.post('/api/v1/garages', { name: 'Elsewhere' });
      const foreign = (
        (
          await alice2.post('/api/v1/vehicles', {
            garageId: (elsewhere.body as { id: string }).id,
            vehicleType: 'CAR',
            model: 'Other',
          })
        ).body as { id: string }
      ).id;
      expect((await alice2.put(path(me.id), { vehicleIds: [foreign] })).status).toBe(400);
      expect((await as(context, bob).put(path(bobMember.id), { vehicleIds: [] })).status).toBe(403);

      // Replacing with an empty set unassigns.
      await alice2.put(path(bobMember.id), { vehicleIds: [] });
      const cleared = (await alice2.get(`/api/v1/garages/${garageId}/members`)).body as {
        id: string;
        vehicleIds: string[];
      }[];
      expect(cleared.find((m) => m.id === bobMember.id)!.vehicleIds).toEqual([]);
    });

    it('sets who drives one vehicle from its side, replacing only that vehicle', async () => {
      const owner = as(context, alice);
      const garage = await owner.post('/api/v1/garages', { name: 'Shared car' });
      const garageId = (garage.body as { id: string }).id;
      const make = async (model: string) =>
        (
          (await owner.post('/api/v1/vehicles', { garageId, vehicleType: 'CAR', model })).body as {
            id: string;
          }
        ).id;
      const [car, van] = [await make('Car'), await make('Van')];
      await owner.post(`/api/v1/garages/${garageId}/members`, { email: bob.email, role: 'DRIVER' });
      type Row = { id: string; userId: string; vehicleIds: string[] };
      const list = async () =>
        (await owner.get(`/api/v1/garages/${garageId}/members`)).body as Row[];
      const [me, bobRow] = [
        (await list()).find((m) => m.userId === alice.userId)!,
        (await list()).find((m) => m.userId === bob.userId)!,
      ];
      // Bob already drives the van; setting the car's drivers must leave that alone.
      await owner.put(`/api/v1/garages/${garageId}/members/${bobRow.id}/vehicles`, {
        vehicleIds: [van],
      });

      const path = `/api/v1/garages/${garageId}/vehicles/${car}/drivers`;
      const set = await owner.put(path, { memberIds: [me.id, bobRow.id] });
      expect(set.status).toBe(200);
      const after = await list();
      expect(after.find((m) => m.id === me.id)!.vehicleIds).toEqual([car]);
      expect(after.find((m) => m.id === bobRow.id)!.vehicleIds.sort()).toEqual([car, van].sort());

      // Not a member here, a driver reshaping it, and clearing it.
      expect((await owner.put(path, { memberIds: [crypto.randomUUID()] })).status).toBe(400);
      expect((await as(context, bob).put(path, { memberIds: [] })).status).toBe(403);
      await owner.put(path, { memberIds: [] });
      const cleared = await list();
      expect(cleared.find((m) => m.id === me.id)!.vehicleIds).toEqual([]);
      expect(cleared.find((m) => m.id === bobRow.id)!.vehicleIds).toEqual([van]);
    });
  });
});
