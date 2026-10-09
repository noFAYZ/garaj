/**
 * S3-compatible storage adapter (Architecture.md §29).
 *
 * One implementation covers MinIO locally, Cloudflare R2 in production, and AWS S3 if that
 * ever becomes the choice — they differ in endpoint and addressing style, not in protocol.
 */

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { S3StorageConfig } from '@vehicle-os/config';
import type { SignedUpload, StoragePort, StoredObject } from './storage-port';

const UPLOAD_URL_TTL_SECONDS = 900;
const DOWNLOAD_URL_TTL_SECONDS = 300;

export function createS3Storage(config: S3StorageConfig): StoragePort {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    // MinIO addresses buckets as a path segment; R2 and S3 use a virtual host. A mismatch
    // produces signed URLs that 404 with no other symptom, so it is configuration, not a
    // guess based on the endpoint string.
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });

  const Bucket = config.bucket;

  return {
    async createUploadUrl(key, mimeType, sizeBytes): Promise<SignedUpload> {
      /*
       * Content type and length are signed into the URL, so the ticket issued for a 2 MB
       * JPEG cannot be redeemed for a 2 GB video. Without them the size limit checked at
       * request time would be advisory only.
       */
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: mimeType,
          ContentLength: sizeBytes,
        }),
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-length']) },
      );
      return { url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
    },

    createDownloadUrl(key, expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async head(key): Promise<StoredObject | null> {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          sizeBytes: result.ContentLength ?? 0,
          mimeType: result.ContentType ?? 'application/octet-stream',
          // S3 returns the ETag quoted; callers compare it against a stored value, so the
          // quotes have to come off exactly once, here.
          checksum: result.ETag?.replaceAll('"', '') ?? null,
        };
      } catch (error) {
        // A missing object is an expected answer to "did the upload land?", not a failure.
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === 'NotFound' || candidate.$metadata?.httpStatusCode === 404;
}
