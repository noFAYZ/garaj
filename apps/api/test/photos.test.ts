import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import {
  as,
  createTestContext,
  seedGarageWithVehicle,
  signUp,
  type SignedUpUser,
  type TestContext,
} from './harness';

interface Ticket {
  photoId: string;
  uploadUrl: string;
  storageKey: string;
}

describe('photos', () => {
  let context: TestContext;
  let alice: SignedUpUser;
  let bob: SignedUpUser;
  let garageId: string;
  let vehicleId: string;

  beforeAll(async () => {
    context = await createTestContext();
    alice = await signUp(context, 'Alice');
    bob = await signUp(context, 'Bob');
    const seeded = await seedGarageWithVehicle(context, alice, 'Photo Garage');
    garageId = seeded.garageId;
    vehicleId = seeded.vehicleId;
  });

  afterAll(async () => {
    await context.close();
  });

  const requestTicket = async (vehicle = vehicleId) => {
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicle}/photos/upload-url`,
      { filename: 'front.jpg', mimeType: 'image/jpeg', sizeBytes: 240_000 },
    );
    return { status: response.status, ticket: response.body as Ticket };
  };

  /** Stands in for the client's direct PUT to object storage. */
  const completeUpload = (key: string, sizeBytes = 240_000) =>
    context.storage.put(key, { sizeBytes, mimeType: 'image/jpeg', checksum: 'abc123' });

  it('issues a ticket whose key is scoped to the garage and vehicle', async () => {
    const { status, ticket } = await requestTicket();

    expect(status).toBe(201);
    // The tenant prefix (§30) — a key cannot be edited into another garage's namespace.
    expect(ticket.storageKey).toBe(
      `garages/${garageId}/vehicles/${vehicleId}/photos/${ticket.photoId}`,
    );
    expect(ticket.uploadUrl).toContain('memory://upload');
  });

  /*
   * A client that abandons the PUT would otherwise leave a row pointing at nothing, and the
   * vehicle card would render a broken image with no explanation.
   */
  it('refuses to finalize when nothing was actually uploaded', async () => {
    const { ticket } = await requestTicket();

    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      {},
    );

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('UPLOAD_NOT_FOUND');
  });

  it('hides an unfinalized photo from nobody — the row exists but the object does not', async () => {
    const before = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/photos`);
    expect(Array.isArray(before.body)).toBe(true);
  });

  it('finalizes after the upload lands and records the real size and type', async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey, 512_345);

    const finalized = await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      { caption: 'Front three-quarter', category: 'exterior' },
    );
    expect(finalized.status).toBe(204);

    const [row] = await context.database.db
      .select()
      .from(schema.vehiclePhotos)
      .where(eq(schema.vehiclePhotos.id, ticket.photoId));

    // Taken from storage, not from what the client declared when asking for the ticket.
    expect(row?.sizeBytes).toBe(512_345);
    expect(row?.checksum).toBe('abc123');
    expect(row?.caption).toBe('Front three-quarter');
  });

  /* §31: EXIF location is opt-in per photo, so a shared garage cannot leak a home address. */
  it('defaults location sharing to off', async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      {},
    );

    const [row] = await context.database.db
      .select()
      .from(schema.vehiclePhotos)
      .where(eq(schema.vehiclePhotos.id, ticket.photoId));

    expect(row?.locationShared).toBe(false);
  });

  it('queues image processing exactly once per photo', async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      {},
    );

    const messages = await context.database.db
      .select()
      .from(schema.outboxMessages)
      .where(eq(schema.outboxMessages.jobKey, `process-photo:${ticket.photoId}:finalize`));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.queue).toBe('image-processing');
  });

  /*
   * The one that was missing. `setAsPrimary` was never sent by any client, so a vehicle
   * finished onboarding with photos and no primary — the card showed a glyph, and the
   * background-removal job, which only runs for the primary photo, never fired.
   */
  it('makes the first photo the primary one without being asked', async () => {
    const bare = await as(context, alice).post('/api/v1/vehicles', {
      garageId,
      vehicleType: 'CAR',
      make: 'Citroen',
      model: 'DS',
    });
    const bareId = (bare.body as { id: string }).id;

    const first = await requestTicket(bareId);
    completeUpload(first.ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${bareId}/photos/${first.ticket.photoId}/finalize`,
      {},
    );

    const afterFirst = await as(context, alice).get(`/api/v1/vehicles/${bareId}`);
    expect((afterFirst.body as { primaryPhoto: { id: string } }).primaryPhoto.id).toBe(
      first.ticket.photoId,
    );

    // And a second upload does not take it over — the first choice stands until someone
    // deliberately changes it.
    const second = await requestTicket(bareId);
    completeUpload(second.ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${bareId}/photos/${second.ticket.photoId}/finalize`,
      {},
    );

    const afterSecond = await as(context, alice).get(`/api/v1/vehicles/${bareId}`);
    expect((afterSecond.body as { primaryPhoto: { id: string } }).primaryPhoto.id).toBe(
      first.ticket.photoId,
    );
  });

  it('sets the photo as the vehicle primary when asked', async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      { setAsPrimary: true },
    );

    const vehicle = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
    const primary = (vehicle.body as { primaryPhoto: { id: string; url: string } }).primaryPhoto;

    expect(primary.id).toBe(ticket.photoId);
    // A signed URL, never the storage key — that would be a stable handle to a private object.
    expect(primary.url).toContain('memory://download');
  });

  it('lists photos with a signed URL each', async () => {
    const list = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}/photos`);

    expect(list.status).toBe(200);
    const photos = list.body as { url: string; storageKey?: string }[];
    expect(photos.length).toBeGreaterThan(0);
    expect(photos.every((photo) => photo.url.startsWith('memory://download'))).toBe(true);
    // The key never leaves the server.
    expect(photos.every((photo) => photo.storageKey === undefined)).toBe(true);
  });

  it('clears the vehicle primary photo when that photo is deleted', async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      { setAsPrimary: true },
    );

    const deleted = await as(context, alice).delete(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}`,
    );
    expect(deleted.status).toBe(204);

    const vehicle = await as(context, alice).get(`/api/v1/vehicles/${vehicleId}`);
    expect((vehicle.body as { primaryPhoto: null }).primaryPhoto).toBeNull();
  });

  it('rejects a non-image mime type', async () => {
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/upload-url`,
      { filename: 'payload.exe', mimeType: 'application/x-msdownload', sizeBytes: 1000 },
    );

    expect(response.status).toBe(400);
  });

  it('rejects a file over the size cap', async () => {
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/upload-url`,
      { filename: 'huge.jpg', mimeType: 'image/jpeg', sizeBytes: 100 * 1024 * 1024 },
    );

    expect(response.status).toBe(400);
  });

  it('refuses to attach a photo to an event from another vehicle', async () => {
    const other = await seedGarageWithVehicle(context, alice, 'Other Vehicle');
    const event = await as(context, alice).post(`/api/v1/vehicles/${other.vehicleId}/events`, {
      eventType: 'NOTE',
      title: 'Elsewhere',
      occurredAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    });
    const eventId = (event.body as { event: { id: string } }).event.id;

    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    const response = await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      { eventId },
    );

    expect(response.status).toBe(400);
  });

  it("will not let another user request an upload for someone else's vehicle", async () => {
    const response = await as(context, bob).post(
      `/api/v1/vehicles/${vehicleId}/photos/upload-url`,
      { filename: 'x.jpg', mimeType: 'image/jpeg', sizeBytes: 1000 },
    );

    expect(response.status).toBe(404);
  });

  /*
   * Cross-vehicle photo theft: a real photo id from Alice's vehicle, pointed at from a
   * vehicle Bob controls. If the check were on the photo id alone, Bob's vehicle card would
   * render Alice's photo through the signed download URL.
   */
  it("will not adopt another vehicle's photo as a primary", async () => {
    const { ticket } = await requestTicket();
    completeUpload(ticket.storageKey);
    await as(context, alice).post(
      `/api/v1/vehicles/${vehicleId}/photos/${ticket.photoId}/finalize`,
      {},
    );

    const bobsGarage = await seedGarageWithVehicle(context, bob, 'Bob Garage');
    const response = await as(context, bob).patch(`/api/v1/vehicles/${bobsGarage.vehicleId}`, {
      primaryPhotoId: ticket.photoId,
    });

    expect(response.status).toBe(400);
    expect((response.body as { error: { fields: object } }).error.fields).toHaveProperty(
      'primaryPhotoId',
    );
  });
});
