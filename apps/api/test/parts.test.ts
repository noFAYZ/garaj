import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { newId } from '@vehicle-os/utils';
import { scanForExpiringPartWarranties } from '../src/modules/notifications/application/services/expiry-scan';
import { currentParts, type PartAction } from '@vehicle-os/domain';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

interface Part {
  id: string;
  eventId: string | null;
  position: string;
  action: PartAction;
  brand: string | null;
  name: string | null;
  spec: string | null;
  quantity: number | null;
  unit: string | null;
  fittedAt: string | null;
  odometer: number | null;
  odometerUnit: string | null;
  warrantyUntil: string | null;
}
interface Parts {
  data: Part[];
  products: { position: string; brand: string | null; name: string | null; spec: string | null }[];
}

const iso = (value: string) => new Date(value).toISOString();
const oil = {
  position: 'ENGINE_OIL',
  brand: 'Castrol',
  name: 'Edge',
  spec: '5W-30',
  quantity: 4.2,
};
const filter = { position: 'OIL_FILTER', brand: 'Bosch', partNumber: 'P3300' };

describe('parts and fluids', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    vehicleId = (await seedGarageWithVehicle(context, alice, 'Parts Garage')).vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const url = (path = '') => `/api/v1/vehicles/${vehicleId}${path}`;
  const parts = async () => (await as(context, alice).get(url('/parts'))).body as Parts;
  const entry = (payload: Record<string, unknown>) =>
    as(context, alice).post(url('/events'), {
      eventType: 'MAINTENANCE',
      title: 'Oil service',
      ...payload,
    });

  it('saves lines with their entry, dated by it, once however often it is replayed', async () => {
    const id = newId();
    const body = {
      id,
      occurredAt: iso('2026-03-12T09:00:00Z'),
      odometer: 38_000,
      odometerUnit: 'KM',
      parts: [oil, filter],
    };
    expect((await entry(body)).status).toBe(201);
    // The reply went missing; the phone sends the same write again.
    expect((await entry(body)).status).toBe(201);

    const lines = (await parts()).data.filter((line) => line.eventId === id);
    expect(lines).toHaveLength(2);
    expect(lines.find((line) => line.position === 'ENGINE_OIL')).toMatchObject({
      action: 'REPLACED',
      brand: 'Castrol',
      spec: '5W-30',
      // Exact, and in litres by default for a fluid.
      quantity: 4.2,
      unit: 'LITER',
      fittedAt: iso('2026-03-12T09:00:00Z'),
      odometer: 38_000,
      odometerUnit: 'KM',
    });
    // A part with no quantity has no unit.
    expect(lines.find((line) => line.position === 'OIL_FILTER')?.unit).toBeNull();
  });

  it('moves a line with its entry when the entry’s date is corrected', async () => {
    const id = newId();
    await entry({
      id,
      occurredAt: iso('2026-04-01T09:00:00Z'),
      parts: [{ position: 'AIR_FILTER' }],
    });
    const edit = await as(context, alice).patch(url(`/events/${id}`), {
      occurredAt: iso('2026-04-05T09:00:00Z'),
      odometer: 39_000,
      odometerUnit: 'KM',
    });
    expect(edit.status).toBe(200);
    const line = (await parts()).data.find((part) => part.eventId === id);
    expect(line).toMatchObject({ fittedAt: iso('2026-04-05T09:00:00Z'), odometer: 39_000 });
  });

  it('writes a completed service’s lines on the entry it makes', async () => {
    const plan = await as(context, alice).post(url('/maintenance'), {
      title: 'Engine oil and filter',
      intervalMonths: 12,
    });
    const planId = (plan.body as { id: string }).id;
    const done = await as(context, alice).post(url(`/maintenance/${planId}/complete`), {
      performedAt: iso('2026-05-01T09:00:00Z'),
      parts: [{ ...oil, brand: 'Mobil 1', name: 'ESP', spec: '0W-30' }],
    });
    expect(done.status).toBe(201);
    const eventId = (done.body as { record: { eventId: string } }).record.eventId;
    const line = (await parts()).data.find((part) => part.eventId === eventId);
    expect(line).toMatchObject({ position: 'ENGINE_OIL', brand: 'Mobil 1' });
  });

  it('reads "now" as the newest replacement; a top-up adds without resetting it', async () => {
    await entry({
      occurredAt: iso('2026-06-01T09:00:00Z'),
      title: 'Top-up',
      parts: [{ position: 'ENGINE_OIL', action: 'TOPPED_UP', quantity: 0.5, brand: 'Castrol' }],
    });
    // A receipt found later, back-dated before the newest change.
    await entry({ occurredAt: iso('2025-12-01T09:00:00Z'), parts: [oil] });

    const current = currentParts((await parts()).data);
    // The service on 2026-05-01, not the later top-up and not the back-dated receipt.
    expect(current.get('ENGINE_OIL')).toMatchObject({ brand: 'Mobil 1', action: 'REPLACED' });
  });

  it('offers each product once, however it was typed, newest first', async () => {
    await entry({
      occurredAt: iso('2026-06-10T09:00:00Z'),
      parts: [{ ...oil, brand: ' castrol', name: 'EDGE', spec: '5w-30' }],
    });
    const products = (await parts()).products.filter(
      (product) => product.position === 'ENGINE_OIL',
    );
    const castrols = products.filter(
      (product) => product.brand?.trim().toLowerCase() === 'castrol',
    );
    // The full Edge 5W-30 once, and the bare "Castrol" of the top-up as its own entry.
    expect(castrols.filter((product) => product.name?.toLowerCase() === 'edge')).toHaveLength(1);
    // Newest first, as it was last typed (trimmed).
    expect(products[0]).toMatchObject({ brand: 'castrol', name: 'EDGE', spec: '5w-30' });
  });

  it('refuses a line that does not fit the vehicle, and saves nothing of the entry', async () => {
    const id = newId();
    const refused = await entry({
      id,
      occurredAt: iso('2026-06-02T09:00:00Z'),
      parts: [{ position: 'ANODES' }, { position: 'OIL_FILTER', action: 'TOPPED_UP' }],
    });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain('parts.0.position');
    expect(JSON.stringify(refused.body)).toContain('parts.1.action');
    expect((await as(context, alice).get(url(`/events/${id}`))).status).toBe(404);
  });

  it('records what is fitted now without an entry, and adds lines to a saved entry', async () => {
    const recorded = await as(context, alice).post(url('/parts'), {
      parts: [
        {
          position: 'BATTERY',
          brand: 'Varta',
          spec: 'AGM 70 Ah',
          fittedAt: iso('2025-01-15T00:00:00Z'),
          odometer: 30_000,
        },
        // Fitted at some point; nobody remembers when.
        { position: 'TYRES_FRONT', brand: 'Michelin', name: 'Pilot Sport 4' },
      ],
    });
    expect(recorded.status).toBe(201);
    const [battery, tyres] = (recorded.body as { data: Part[] }).data.sort((a, b) =>
      a.position.localeCompare(b.position),
    );
    // The reading's unit is the vehicle's when none was said.
    expect(battery).toMatchObject({ eventId: null, odometer: 30_000, odometerUnit: 'KM' });
    expect(tyres?.fittedAt).toBeNull();

    const id = newId();
    await entry({ id, occurredAt: iso('2026-06-03T09:00:00Z') });
    const added = await as(context, alice).post(url('/parts'), {
      eventId: id,
      parts: [{ position: 'CABIN_FILTER' }],
    });
    expect(added.status).toBe(201);
    expect((added.body as { data: Part[] }).data[0]).toMatchObject({
      eventId: id,
      fittedAt: iso('2026-06-03T09:00:00Z'),
    });

    // A line on an entry has the entry's date: one of its own is a client mistake.
    const dated = await as(context, alice).post(url('/parts'), {
      eventId: id,
      parts: [{ position: 'CABIN_FILTER', fittedAt: iso('2026-01-01T00:00:00Z') }],
    });
    expect(dated.status).toBe(400);
  });

  it('goes with its entry, and one line can be removed on its own', async () => {
    const id = newId();
    await entry({ id, occurredAt: iso('2026-06-04T09:00:00Z'), parts: [oil, filter] });
    const mine = () => parts().then((all) => all.data.filter((line) => line.eventId === id));

    const [first] = await mine();
    expect((await as(context, alice).delete(url(`/parts/${first!.id}`))).status).toBe(204);
    expect(await mine()).toHaveLength(1);

    expect((await as(context, alice).delete(url(`/events/${id}`))).status).toBe(204);
    expect(await mine()).toHaveLength(0);
  });

  it('is the garage’s own: another account can neither read nor write it', async () => {
    expect((await as(context, bob).get(url('/parts'))).status).toBe(404);
    const write = await as(context, bob).post(url('/parts'), { parts: [{ position: 'BATTERY' }] });
    expect(write.status).toBe(404);
    const someone = (await parts()).data[0]!;
    expect((await as(context, bob).delete(url(`/parts/${someone.id}`))).status).toBe(404);
  });
  it('corrects a line in place: the whole line as it should read, its entry and place kept', async () => {
    const id = newId();
    await entry({ id, occurredAt: iso('2026-06-05T09:00:00Z'), parts: [oil] });
    const line = (await parts()).data.find((part) => part.eventId === id)!;

    const fixed = await as(context, alice).put(url(`/parts/${line.id}`), {
      brand: 'Castrol',
      name: 'Edge',
      spec: '0W-20',
      quantity: 4.5,
    });
    expect(fixed.status).toBe(200);
    expect(fixed.body).toMatchObject({
      id: line.id,
      eventId: id,
      position: 'ENGINE_OIL',
      spec: '0W-20',
      quantity: 4.5,
      fittedAt: iso('2026-06-05T09:00:00Z'),
    });

    // On an entry it keeps the entry's date; one of its own is refused, as on the way in.
    const dated = await as(context, alice).put(url(`/parts/${line.id}`), {
      fittedAt: iso('2026-01-01T00:00:00Z'),
    });
    expect(dated.status).toBe(400);
    // Someone else's line is not found, not edited.
    const theirs = await as(context, bob).put(url(`/parts/${line.id}`), { brand: 'Nope' });
    expect(theirs.status).toBe(404);
  });

  it('warns about a warranty running out on a part still fitted, once, and not on one replaced', async () => {
    const inDays = (days: number) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    // The old battery's cover ends soon too, but it has been replaced: nothing to say about it.
    await as(context, alice).post(url('/parts'), {
      parts: [
        {
          position: 'BRAKE_DISCS_REAR',
          brand: 'Brembo',
          warrantyUntil: inDays(20),
          fittedAt: iso('2025-01-01T00:00:00Z'),
        },
      ],
    });
    await as(context, alice).post(url('/parts'), {
      parts: [
        {
          position: 'BRAKE_DISCS_REAR',
          brand: 'ATE',
          warrantyUntil: inDays(10),
          fittedAt: iso('2026-01-01T00:00:00Z'),
        },
      ],
    });
    const listed = (await parts()).data.find((part) => part.brand === 'ATE');
    expect(listed?.warrantyUntil).toBe(inDays(10));

    const first = await scanForExpiringPartWarranties(context.database.db);
    expect(first.notified).toBeGreaterThan(0);
    const rows = await context.database.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, alice.userId),
          eq(schema.notifications.notificationType, 'WARRANTY_EXPIRING'),
        ),
      );
    expect(rows.map((row) => row.body)).toEqual([expect.stringContaining('ATE')]);

    // The second morning says nothing new.
    expect((await scanForExpiringPartWarranties(context.database.db)).notified).toBe(0);
  });
});
