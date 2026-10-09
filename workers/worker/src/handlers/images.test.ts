import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@vehicle-os/database/testing';
import { schema } from '@vehicle-os/database';
import { eq } from 'drizzle-orm';
import type { Job } from './index';

const storage = {
  createDownloadUrl: vi.fn(async () => 'https://storage.test/original'),
  createUploadUrl: vi.fn(async () => ({ url: 'https://storage.test/put', expiresInSeconds: 900 })),
  head: vi.fn(),
  delete: vi.fn(async () => {}),
};

vi.mock('@vehicle-os/api/storage', () => ({ createStorage: () => storage }));
vi.mock('../background-removal', () => ({
  backgroundRemovalConfigured: () => true,
  removeBackground: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
  BackgroundRemovalError: class extends Error {},
}));

const { processPhoto } = await import('./images');
const { removeBackground } = await import('../background-removal');

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const job = (photoId: string) => ({ data: { photoId } }) as unknown as Job;

describe('processPhoto', () => {
  let database: TestDatabase;
  let vehicleId: string;
  let photoId: string;

  beforeEach(async () => {
    database = await createTestDatabase();
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array([9]), { status: 200 })),
    );

    const [user] = await database.db
      .insert(schema.users)
      .values({
        id: '0192f0d0-0000-7000-8000-000000000001',
        name: 'Owner',
        email: 'owner@example.test',
      })
      .returning();
    const [garage] = await database.db
      .insert(schema.garages)
      .values({ name: 'Garage', ownerId: user!.id })
      .returning();
    const [vehicle] = await database.db
      .insert(schema.vehicles)
      .values({ garageId: garage!.id, vehicleType: 'CAR' })
      .returning();
    vehicleId = vehicle!.id;

    const [photo] = await database.db
      .insert(schema.vehiclePhotos)
      .values({
        vehicleId,
        storageKey: 'garages/g/vehicles/v/photos/p',
        mimeType: 'image/jpeg',
        sizeBytes: 1000,
      })
      .returning();
    photoId = photo!.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await database.close();
  });

  const makePrimary = () =>
    database.db
      .update(schema.vehicles)
      .set({ primaryPhotoId: photoId })
      .where(eq(schema.vehicles.id, vehicleId));

  const reload = async () => {
    const [row] = await database.db
      .select()
      .from(schema.vehiclePhotos)
      .where(eq(schema.vehiclePhotos.id, photoId));
    return row!;
  };

  it("stores a cutout for the vehicle's primary photo", async () => {
    await makePrimary();

    await processPhoto(job(photoId), { db: database.db, log });

    const row = await reload();
    expect(row.cutoutKey).toBe('garages/g/vehicles/v/photos/p-cutout');
    expect(row.processedAt).not.toBeNull();
    expect(removeBackground).toHaveBeenCalledOnce();
  });

  it('leaves a photo that is not the primary one alone', async () => {
    await processPhoto(job(photoId), { db: database.db, log });

    expect((await reload()).cutoutKey).toBeNull();
    expect(removeBackground).not.toHaveBeenCalled();
  });

  it('does not buy a second cutout when the job is redelivered', async () => {
    await makePrimary();

    await processPhoto(job(photoId), { db: database.db, log });
    await processPhoto(job(photoId), { db: database.db, log });

    expect(removeBackground).toHaveBeenCalledOnce();
  });

  it('skips a photo deleted between the enqueue and the job', async () => {
    await makePrimary();
    await database.db
      .update(schema.vehiclePhotos)
      .set({ deletedAt: new Date() })
      .where(eq(schema.vehiclePhotos.id, photoId));

    await processPhoto(job(photoId), { db: database.db, log });

    expect((await reload()).cutoutKey).toBeNull();
    expect(removeBackground).not.toHaveBeenCalled();
  });
});
