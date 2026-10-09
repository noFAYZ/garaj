import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@vehicle-os/database/testing';
import { schema } from '@vehicle-os/database';
import type { Job } from './index';

const storage = {
  createDownloadUrl: vi.fn(),
  createUploadUrl: vi.fn(),
  head: vi.fn(),
  delete: vi.fn(async (_key: string) => {}),
};

vi.mock('@vehicle-os/api/storage', () => ({ createStorage: () => storage }));
vi.mock('@vehicle-os/api/expiry-scan', () => ({ scanForExpiringDocuments: vi.fn() }));

const { collectDocumentObjects } = await import('./documents');

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('collectDocumentObjects', () => {
  let database: TestDatabase;
  let vehicleId: string;

  beforeEach(async () => {
    database = await createTestDatabase();
    vi.clearAllMocks();

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
  });

  afterEach(async () => {
    await database.close();
  });

  const seed = (key: string, row: Partial<typeof schema.documents.$inferInsert>) =>
    database.db.insert(schema.documents).values({
      vehicleId,
      documentType: 'OTHER',
      title: key,
      filename: `${key}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1,
      storageKey: key,
      uploadedAt: daysAgo(100),
      ...row,
    });

  it('collects expired deletions and abandoned uploads, and leaves everything else', async () => {
    await seed('deleted-long-ago', { deletedAt: daysAgo(31) });
    await seed('abandoned', { uploadedAt: null, createdAt: daysAgo(2) });
    // Still restorable, still uploading, and simply alive.
    await seed('deleted-yesterday', { deletedAt: daysAgo(1) });
    await seed('uploading-now', { uploadedAt: null });
    await seed('live', {});

    await collectDocumentObjects({} as Job, { db: database.db, log });

    const deletedKeys = storage.delete.mock.calls.map(([key]) => key).sort();
    expect(deletedKeys).toEqual(['abandoned', 'deleted-long-ago']);

    const remaining = await database.db
      .select({ key: schema.documents.storageKey })
      .from(schema.documents);
    expect(remaining.map((row) => row.key).sort()).toEqual([
      'deleted-yesterday',
      'live',
      'uploading-now',
    ]);
  });

  it('keeps the row when deleting the bytes fails, so the next run can retry', async () => {
    await seed('deleted-long-ago', { deletedAt: daysAgo(31) });
    storage.delete.mockRejectedValueOnce(new Error('storage down'));

    await expect(collectDocumentObjects({} as Job, { db: database.db, log })).rejects.toThrow(
      'storage down',
    );

    const remaining = await database.db.select().from(schema.documents);
    expect(remaining).toHaveLength(1);
  });
});
