/**
 * Document upload (Architecture.md §28, §29, §30).
 *
 * The same three steps as a photo, for the same reason: the bytes never pass through the
 * API, so a 20 MB scanned service book does not occupy a request worker for the length of
 * an upload. The row is written when the ticket is issued, so the storage key is derived
 * from an id that is already committed — a key invented client-side would be a way to write
 * outside the tenant prefix.
 *
 * A row whose object never arrives stays unfinalized (`uploadedAt` null) and is invisible to
 * every read.
 */

import type { Database } from '@vehicle-os/database';
import { schema } from '@vehicle-os/database';
import { and, eq } from 'drizzle-orm';
import type { ActorContext, DocumentType } from '@vehicle-os/domain';
import { newId } from '@vehicle-os/utils';
import { ConflictError, NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import type { StoragePort } from '../../../../infrastructure/storage/storage-port';
import { vehicleDocumentKey } from '../../../../infrastructure/storage/storage-port';
import {
  findDocumentById,
  softDeleteDocument,
  updateDocument,
  type DocumentRow,
} from '../../infrastructure/repositories/document-repository';

export interface DocumentUploadTicket {
  readonly documentId: string;
  readonly uploadUrl: string;
  readonly storageKey: string;
  readonly expiresInSeconds: number;
}

export async function requestDocumentUpload(
  db: Database,
  storage: StoragePort,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  input: { filename: string; mimeType: string; sizeBytes: number },
): Promise<DocumentUploadTicket> {
  const documentId = newId();
  const storageKey = vehicleDocumentKey(garageId, vehicleId, documentId);

  await db.insert(schema.documents).values({
    id: documentId,
    vehicleId,
    // Placeholders until finalize supplies the real ones. The columns are NOT NULL because
    // a finalized document without a type or a title is not something any screen can show.
    documentType: 'OTHER',
    title: input.filename,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageKey,
    uploadedAt: null,
    uploadedBy: actor.userId,
  });

  const upload = await storage.createUploadUrl(storageKey, input.mimeType, input.sizeBytes);
  return {
    documentId,
    uploadUrl: upload.url,
    storageKey,
    expiresInSeconds: upload.expiresInSeconds,
  };
}

export interface FinalizeDocumentInput {
  readonly documentType: DocumentType;
  readonly title: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly notes?: string;
  readonly eventId?: string;
}

export async function finalizeDocumentUpload(
  db: Database,
  storage: StoragePort,
  vehicleId: string,
  garageId: string,
  documentId: string,
  input: FinalizeDocumentInput,
  actor: ActorContext,
  meta: CommandMeta,
): Promise<DocumentRow> {
  const document = await findDocumentById(db, vehicleId, documentId);
  if (!document) throw new NotFoundError('Document');

  /*
   * Verified against storage, not taken on trust. A client that abandoned the PUT would
   * otherwise leave a row offering a download of nothing, which is worse than no row: the
   * insurance certificate looks filed when it is not.
   */
  const object = await storage.head(document.storageKey);
  if (!object) {
    throw new ConflictError(
      'UPLOAD_NOT_FOUND',
      'No uploaded file found for this document. Complete the upload before finalizing.',
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

  await db.transaction(async (tx) => {
    await updateDocument(tx, documentId, {
      documentType: input.documentType,
      title: input.title.trim(),
      // What actually arrived, not what the client declared when asking for the ticket.
      sizeBytes: object.sizeBytes,
      mimeType: object.mimeType,
      checksum: object.checksum,
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      notes: input.notes?.trim() || null,
      eventId: input.eventId ?? null,
      uploadedAt: new Date(),
    });

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'document.uploaded',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { vehicleId, documentType: input.documentType, filename: document.filename },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  const finalized = await findDocumentById(db, vehicleId, documentId);
  if (!finalized) throw new NotFoundError('Document');
  return finalized;
}

export interface EditDocumentInput {
  readonly documentType?: DocumentType;
  readonly title?: string;
  readonly issuedOn?: string | null;
  readonly expiresOn?: string | null;
  readonly notes?: string | null;
  readonly eventId?: string | null;
}

export async function editDocument(
  db: Database,
  vehicleId: string,
  documentId: string,
  input: EditDocumentInput,
): Promise<DocumentRow> {
  const existing = await findDocumentById(db, vehicleId, documentId);
  if (!existing) throw new NotFoundError('Document');

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('documentType', input.documentType);
  assign('title', input.title?.trim());
  assign('issuedOn', input.issuedOn);
  assign('expiresOn', input.expiresOn);
  assign('notes', input.notes === undefined ? undefined : (input.notes?.trim() ?? null));
  assign('eventId', input.eventId);

  await updateDocument(db, documentId, changes);

  const updated = await findDocumentById(db, vehicleId, documentId);
  if (!updated) throw new NotFoundError('Document');
  return updated;
}

/**
 * A signed URL to read the file.
 *
 * Minted per request and short-lived, after the authorization check — nothing in the bucket
 * is public, so this is the only way in, and the link stops working on its own rather than
 * living on in whatever the URL was pasted into.
 */
export async function downloadUrlFor(
  storage: StoragePort,
  document: DocumentRow,
  expiresInSeconds = 300,
): Promise<{ url: string; expiresInSeconds: number }> {
  const url = await storage.createDownloadUrl(document.storageKey, expiresInSeconds);
  return { url, expiresInSeconds };
}

export async function removeDocument(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  documentId: string,
  meta: CommandMeta,
): Promise<void> {
  const existing = await findDocumentById(db, vehicleId, documentId);
  if (!existing) throw new NotFoundError('Document');

  await db.transaction(async (tx) => {
    await softDeleteDocument(tx, documentId);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'document.deleted',
      resourceType: 'document',
      resourceId: documentId,
      metadata: { vehicleId, title: existing.title, documentType: existing.documentType },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });
}
