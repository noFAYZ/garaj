/**
 * Upstash Blob storage adapter (Architecture.md §29, §92).
 *
 * Upstash Blob is S3-compatible — `bucket.s3()` hands back an endpoint, a bucket name and
 * credentials in the shape the AWS SDK expects, so this is the same protocol as R2 or MinIO
 * behind a different handshake. (It is R2 underneath, which is what §29 names anyway.)
 *
 * The one real difference from a static-key provider: `endpoint` and `credentials` arrive as
 * async *providers*, not strings, and the credentials are short-lived. The SDK calls the
 * providers itself and refreshes on expiry, so the config is passed through untouched rather
 * than destructured into fixed values — flattening it would freeze the first credential and
 * every request would start failing an hour later.
 */

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Bucket } from '@upstash/blob';
import type { SignedUpload, StoragePort, StoredObject } from './storage-port';

const UPLOAD_URL_TTL_SECONDS = 900;
const DOWNLOAD_URL_TTL_SECONDS = 300;

export function createUpstashBlobStorage(token: string): StoragePort {
  const bucket = new Bucket({ token });
  const config = bucket.s3();
  const client = new S3Client(config);
  const Bucket_ = config.bucket;

  /**
   * A presigned URL is only usable while the credentials that signed it are still valid.
   *
   * These expire, so a 15-minute upload URL minted five minutes before expiry would die
   * after five — and the client would see a 403 on an upload it had every reason to think
   * would work. Clamping to whatever the credential has left makes the returned
   * `expiresInSeconds` the truth rather than an aspiration.
   */
  async function ttl(requested: number): Promise<number> {
    const credentials = await config.credentials();
    const expiration = credentials.expiration;
    if (!expiration) return requested;

    // A small margin so a URL is not handed out in the instant before it dies.
    const remaining = Math.floor((expiration.getTime() - Date.now()) / 1000) - 10;
    return Math.max(1, Math.min(requested, remaining));
  }

  return {
    async createUploadUrl(key, mimeType, sizeBytes): Promise<SignedUpload> {
      const expiresIn = await ttl(UPLOAD_URL_TTL_SECONDS);
      /*
       * Content type and length are signed into the URL, so the ticket issued for a 2 MB
       * JPEG cannot be redeemed for a 2 GB video. Without them the size limit checked at
       * request time would be advisory only.
       */
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: Bucket_,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes,
        }),
        { expiresIn, signableHeaders: new Set(['content-length']) },
      );
      return { url, expiresInSeconds: expiresIn };
    },

    /*
     * Through the SDK's own read signer, not the AWS presigner above. That one signed with the
     * short-lived object credential and clamped to whatever it had left — near the end of a
     * credential's life a "5 minute" photo link died in seconds, which is why vehicle photos
     * intermittently failed to load. `signedReadUrl` re-mints when the credential cannot cover
     * the request, and signs with the bucket's read credential where one exists.
     */
    async createDownloadUrl(key, expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS): Promise<string> {
      const { url } = await bucket.signedReadUrl(key, { expiresIn: expiresInSeconds });
      return url;
    },

    async head(key): Promise<StoredObject | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket: Bucket_, Key: key }));
        return {
          sizeBytes: result.ContentLength ?? 0,
          mimeType: result.ContentType ?? 'application/octet-stream',
          // The ETag comes back quoted; callers compare it against a stored value, so the
          // quotes come off exactly once, here.
          checksum: result.ETag?.replaceAll('"', '') ?? null,
        };
      } catch (error) {
        // A missing object is an expected answer to "did the upload land?", not a failure.
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: Bucket_, Key: key }));
    },
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}
