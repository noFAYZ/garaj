/**
 * Image job handlers.
 *
 * The cutout is made for the vehicle's primary photo only. Every photo goes through this
 * job because finalize enqueues one, and the check below is what stops a gallery of
 * receipts and engine bays from each costing a background removal.
 */

import { eq } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { createStorage } from '@vehicle-os/api/storage';
import {
  BackgroundRemovalError,
  backgroundRemovalConfigured,
  removeBackground,
} from '../background-removal';
import type { JobHandler } from './index';

/** The cutout sits beside the original, so deleting a photo's prefix still takes both. */
export const cutoutKeyFor = (storageKey: string): string => `${storageKey}-cutout`;

export const processPhoto: JobHandler = async (job, { db, log }) => {
  const { photoId } = job.data as { photoId: string };

  const [photo] = await db
    .select({
      id: schema.vehiclePhotos.id,
      vehicleId: schema.vehiclePhotos.vehicleId,
      storageKey: schema.vehiclePhotos.storageKey,
      cutoutKey: schema.vehiclePhotos.cutoutKey,
      deletedAt: schema.vehiclePhotos.deletedAt,
    })
    .from(schema.vehiclePhotos)
    .where(eq(schema.vehiclePhotos.id, photoId))
    .limit(1);

  // Deleted between the enqueue and here, or the row is gone entirely. Not an error: the
  // work simply no longer needs doing, and throwing would retry it five times.
  if (!photo || photo.deletedAt) return;
  // Idempotent (§39): at-least-once delivery must not buy the same cutout twice.
  if (photo.cutoutKey) return;

  const [vehicle] = await db
    .select({ primaryPhotoId: schema.vehicles.primaryPhotoId })
    .from(schema.vehicles)
    .where(eq(schema.vehicles.id, photo.vehicleId))
    .limit(1);
  if (vehicle?.primaryPhotoId !== photoId) return;

  if (!backgroundRemovalConfigured()) {
    log.info({ photoId }, 'No background remover configured; thumbnail stays the original');
    return;
  }

  const storage = createStorage();
  if (!storage) {
    log.warn({ photoId }, 'Object storage is not configured; cannot process photo');
    return;
  }

  /*
   * Signed URLs throughout, the same path a browser takes — the port needs no byte-level
   * methods and the worker holds no bucket credentials. Ten minutes rather than the default:
   * the remover fetches the original itself, and a link that expires mid-download fails a
   * job for a reason nothing in the response explains.
   */
  let cutout: Blob;
  try {
    cutout = await removeBackground(await storage.createDownloadUrl(photo.storageKey, 600));
  } catch (error) {
    /*
     * A rejected image is an answer, not an outage — a 1x1 test file will be too small on
     * the fifth attempt too. Swallowed so the card quietly keeps the original rather than
     * the job retrying five times and sitting in failed forever.
     */
    if (error instanceof BackgroundRemovalError && error.permanent) {
      log.warn({ photoId, reason: error.message }, 'Photo cannot have its background removed');
      return;
    }
    throw error;
  }
  const bytes = new Uint8Array(await cutout.arrayBuffer());
  const cutoutKey = cutoutKeyFor(photo.storageKey);

  const upload = await storage.createUploadUrl(cutoutKey, 'image/png', bytes.byteLength);
  const stored = await fetch(upload.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: bytes,
  });
  if (!stored.ok) throw new Error(`Could not store cutout for ${photoId}: ${stored.status}`);

  // Written last: the row pointing at a key is what makes the cutout visible, so it only
  // happens once the bytes are actually there.
  await db
    .update(schema.vehiclePhotos)
    .set({ cutoutKey, processedAt: new Date().toISOString().slice(0, 10) })
    .where(eq(schema.vehiclePhotos.id, photoId));

  log.info({ photoId, bytes: bytes.byteLength }, 'Cutout stored');
};

/** The objects behind a soft-deleted photo, including its cutout if one was made. */
export const deletePhotoObjects: JobHandler = async (job, { db, log }) => {
  const { photoId } = job.data as { photoId: string };

  const [photo] = await db
    .select({
      storageKey: schema.vehiclePhotos.storageKey,
      cutoutKey: schema.vehiclePhotos.cutoutKey,
    })
    .from(schema.vehiclePhotos)
    .where(eq(schema.vehiclePhotos.id, photoId))
    .limit(1);
  if (!photo) return;

  const storage = createStorage();
  if (!storage) return;

  for (const key of [photo.storageKey, photo.cutoutKey]) {
    if (key) await storage.delete(key);
  }
  log.info({ photoId }, 'Photo objects deleted');
};
