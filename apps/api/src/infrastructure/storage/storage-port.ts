/**
 * Object storage port (Architecture.md §29, §92).
 *
 * The application layer depends on this interface, never on an SDK. Swapping R2 for S3,
 * Supabase Storage or MinIO is then an adapter change — and the local development stack
 * already runs a different implementation of the same contract than production will.
 */

export interface SignedUpload {
  readonly url: string;
  readonly expiresInSeconds: number;
}

export interface StoredObject {
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly checksum: string | null;
}

/**
 * How long a photo link lives. Longer than a document's: a photo is drawn in lists and galleries
 * that stay on screen and are restored from a client's cache, where a five-minute link had often
 * died before the image was ever requested. Still private — an hour, not forever. A store may cap
 * it lower (Upstash signs with credentials that live about ten minutes); clients key their image
 * cache by photo, not by link, and ask for fresh links when one has lapsed.
 */
export const PHOTO_URL_TTL_SECONDS = 3600;

export interface StoragePort {
  /**
   * A short-lived URL the client PUTs to directly (§29), so a 20 MB photo never occupies
   * an API worker for the length of an upload on a phone connection.
   */
  createUploadUrl(key: string, mimeType: string, sizeBytes: number): Promise<SignedUpload>;

  /** A short-lived read URL. Nothing in the bucket is public, so this is the only way in. */
  createDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Returns null when the object is absent — which is how "finalize" tells an upload that
   * actually completed from one the client abandoned or never started.
   */
  head(key: string): Promise<StoredObject | null>;

  delete(key: string): Promise<void>;
}

/**
 * Tenant-scoped keys (§30). The garage id is the first meaningful segment, so a key cannot
 * be edited into another garage's namespace without also being signed for it, and a bucket
 * listing is grouped by tenant for lifecycle rules and deletion.
 */
export function vehiclePhotoKey(garageId: string, vehicleId: string, photoId: string): string {
  return `garages/${garageId}/vehicles/${vehicleId}/photos/${photoId}`;
}

export function vehicleDocumentKey(
  garageId: string,
  vehicleId: string,
  documentId: string,
): string {
  return `garages/${garageId}/vehicles/${vehicleId}/documents/${documentId}`;
}
