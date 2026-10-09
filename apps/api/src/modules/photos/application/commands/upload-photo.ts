/**
 * Photo upload (Architecture.md §29, §31).
 *
 * Three steps, because the bytes never pass through the API:
 *
 *   1. `requestUpload` writes a pending row and signs a PUT URL for its key.
 *   2. The client uploads directly to object storage.
 *   3. `finalizeUpload` confirms the object landed and records its real size and type.
 *
 * The row exists before the upload so the storage key is derived from an id that is already
 * committed — a key invented client-side would be a way to write outside the tenant prefix.
 * A row whose object never appears simply stays unfinalized and is invisible to every read.
 */

import type { Database } from '@vehicle-os/database';
import { schema } from '@vehicle-os/database';
import { and, eq, isNull } from 'drizzle-orm';
import type { ActorContext } from '@vehicle-os/domain';
import { newId } from '@vehicle-os/utils';
import { ConflictError, NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { enqueue } from '../../../../infrastructure/outbox';
import type { StoragePort } from '../../../../infrastructure/storage/storage-port';
import { vehiclePhotoKey } from '../../../../infrastructure/storage/storage-port';

export interface UploadTicket {
  readonly photoId: string;
  readonly uploadUrl: string;
  readonly storageKey: string;
  readonly expiresInSeconds: number;
}

export async function requestUpload(
  db: Database,
  storage: StoragePort,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  input: { filename: string; mimeType: string; sizeBytes: number },
): Promise<UploadTicket> {
  // Generated here rather than left to the column default: the storage key has to be built
  // from the id, and the key is written on the same insert.
  const photoId = newId();
  const storageKey = vehiclePhotoKey(garageId, vehicleId, photoId);

  await db.insert(schema.vehiclePhotos).values({
    id: photoId,
    vehicleId,
    storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    uploadedBy: actor.userId,
    // Null until the image-processing worker has produced its variants; a client renders
    // the original until then rather than requesting a thumbnail that does not exist.
    processedAt: null,
  });

  const upload = await storage.createUploadUrl(storageKey, input.mimeType, input.sizeBytes);
  return {
    photoId,
    uploadUrl: upload.url,
    storageKey,
    expiresInSeconds: upload.expiresInSeconds,
  };
}

export interface FinalizeInput {
  readonly caption?: string;
  readonly category?: string;
  readonly capturedAt?: string;
  readonly eventId?: string;
  readonly conditionAssessmentId?: string;
  readonly shareLocation?: boolean;
  readonly setAsPrimary?: boolean;
}

export async function finalizeUpload(
  db: Database,
  storage: StoragePort,
  vehicleId: string,
  photoId: string,
  input: FinalizeInput,
): Promise<void> {
  const [photo] = await db
    .select()
    .from(schema.vehiclePhotos)
    .where(
      and(
        eq(schema.vehiclePhotos.id, photoId),
        eq(schema.vehiclePhotos.vehicleId, vehicleId),
        isNull(schema.vehiclePhotos.deletedAt),
      ),
    )
    .limit(1);
  if (!photo) throw new NotFoundError('Photo');

  /*
   * Verified against storage, not taken on trust. A client that abandoned the PUT would
   * otherwise leave a row pointing at nothing, and the vehicle card would render a broken
   * image with no way to tell why.
   */
  const object = await storage.head(photo.storageKey);
  if (!object) {
    throw new ConflictError(
      'UPLOAD_NOT_FOUND',
      'No uploaded file found for this photo. Complete the upload before finalizing.',
    );
  }

  if (input.eventId) {
    const [event] = await db
      .select({ id: schema.vehicleEvents.id })
      .from(schema.vehicleEvents)
      .where(
        and(
          eq(schema.vehicleEvents.id, input.eventId),
          eq(schema.vehicleEvents.vehicleId, vehicleId),
        ),
      )
      .limit(1);
    if (!event) {
      throw new ValidationError('Invalid request', {
        eventId: 'That event does not belong to this vehicle.',
      });
    }
  }

  if (input.conditionAssessmentId) {
    const [assessment] = await db
      .select({ id: schema.conditionAssessments.id })
      .from(schema.conditionAssessments)
      .where(
        and(
          eq(schema.conditionAssessments.id, input.conditionAssessmentId),
          eq(schema.conditionAssessments.vehicleId, vehicleId),
        ),
      )
      .limit(1);
    if (!assessment) {
      throw new ValidationError('Invalid request', {
        conditionAssessmentId: 'That assessment does not belong to this vehicle.',
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.vehiclePhotos)
      .set({
        // The real values from storage, not the ones the client declared when asking for
        // the ticket — those were a request, these are what actually arrived.
        sizeBytes: object.sizeBytes,
        mimeType: object.mimeType,
        checksum: object.checksum,
        caption: input.caption?.trim() || null,
        category: input.category?.trim() || null,
        capturedAt: input.capturedAt ?? null,
        eventId: input.eventId ?? null,
        conditionAssessmentId: input.conditionAssessmentId ?? null,
        // Opt-in per photo (§31). Left false, the worker strips EXIF GPS on ingest, so a
        // photo of a car on a driveway does not hand every garage member a home address.
        locationShared: input.shareLocation ?? false,
      })
      .where(eq(schema.vehiclePhotos.id, photoId));

    /*
     * The first photo becomes the primary one on its own.
     *
     * A vehicle holding one photo and no primary is a state with no meaning: the card falls
     * back to a glyph while a photograph of the vehicle sits in the gallery, and the
     * background-removal job — which only runs for the primary photo — never fires. Every
     * client had to remember to ask for it and none of them did, so the rule belongs here.
     *
     * `where primary_photo_id is null` does the work: it is a no-op once one is set, so this
     * never steals the choice back from someone who picked a different photo.
     */
    if (input.setAsPrimary) {
      await tx
        .update(schema.vehicles)
        .set({ primaryPhotoId: photoId })
        .where(eq(schema.vehicles.id, vehicleId));
    } else if (!input.conditionAssessmentId) {
      // A close-up of a scratch is evidence, not a portrait — it never becomes the card photo
      // on its own.
      await tx
        .update(schema.vehicles)
        .set({ primaryPhotoId: photoId })
        .where(and(eq(schema.vehicles.id, vehicleId), isNull(schema.vehicles.primaryPhotoId)));
    }

    await enqueue(tx, {
      queue: 'image-processing',
      jobName: 'process-photo',
      payload: { photoId, vehicleId, storageKey: photo.storageKey },
      // Keyed by the reason, so promoting this photo to primary later enqueues work that
      // BullMQ does not mistake for this one and drop. A retried finalize still dedupes.
      jobKey: `process-photo:${photoId}:finalize`,
    });
  });
}

export async function deletePhoto(db: Database, vehicleId: string, photoId: string): Promise<void> {
  const [photo] = await db
    .select({ id: schema.vehiclePhotos.id })
    .from(schema.vehiclePhotos)
    .where(
      and(
        eq(schema.vehiclePhotos.id, photoId),
        eq(schema.vehiclePhotos.vehicleId, vehicleId),
        isNull(schema.vehiclePhotos.deletedAt),
      ),
    )
    .limit(1);
  if (!photo) throw new NotFoundError('Photo');

  await db.transaction(async (tx) => {
    await tx
      .update(schema.vehiclePhotos)
      .set({ deletedAt: new Date() })
      .where(eq(schema.vehiclePhotos.id, photoId));

    /*
     * Clear the vehicle's primary photo if it pointed here. Without this the vehicle keeps
     * a reference to a deleted row and its card renders with no image and no explanation.
     */
    await tx
      .update(schema.vehicles)
      .set({ primaryPhotoId: null })
      .where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.primaryPhotoId, photoId)));

    // The object itself is removed by a worker: deleting it inline would make the request
    // wait on a third party, and a failure there would roll back a delete the user saw
    // succeed. The row is already invisible.
    await enqueue(tx, {
      queue: 'image-processing',
      jobName: 'delete-photo-objects',
      payload: { photoId },
      jobKey: `delete-photo-objects:${photoId}`,
    });
  });
}
