import type { VehicleDocument } from '@vehicle-os/contracts';
import type { DocumentRow } from '../../infrastructure/repositories/document-repository';

/**
 * No download URL: reading the bytes means asking for a signed one, which expires on its own.
 * `thumbnailUrl` is passed in by the one route that signs previews (the vehicle's list); every
 * other response leaves it null rather than minting links nobody will render.
 */
export function serializeDocument(
  document: DocumentRow,
  thumbnailUrl: string | null = null,
): VehicleDocument {
  return {
    thumbnailUrl,
    id: document.id,
    vehicleId: document.vehicleId,
    eventId: document.eventId,

    documentType: document.documentType,
    title: document.title,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,

    issuedOn: document.issuedOn,
    expiresOn: document.expiresOn,
    notes: document.notes,

    uploadedAt: document.uploadedAt?.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}
