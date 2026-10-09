/**
 * The one place a concrete storage adapter is chosen.
 *
 * Extracted from the Fastify plugin so the worker can build the same port without a web
 * server around it — it downloads a photo and uploads its cutout through signed URLs,
 * exactly as a browser client would.
 */

import { env, objectStorage } from '@vehicle-os/config';
import { createS3Storage } from './s3-storage';
import { createUpstashBlobStorage } from './upstash-blob-storage';
import { createUnconfiguredStorage } from './unconfigured-storage';
import type { StoragePort } from './storage-port';

export type { StoragePort } from './storage-port';
export { vehiclePhotoKey, vehicleDocumentKey } from './storage-port';

let built: StoragePort | null | undefined;

/**
 * Null when storage was deliberately left out, so the caller can say so in its own terms.
 *
 * One per process. The worker asks on every job, and a fresh adapter is a fresh S3 client and —
 * on Upstash Blob — a fresh credentials request before the first byte moves; the adapters
 * refresh their own credentials, so a single instance never goes stale.
 */
export function createStorage(): StoragePort | null {
  if (built !== undefined) return built;
  const config = objectStorage(env());
  built = !config
    ? null
    : config.provider === 'upstash-blob'
      ? createUpstashBlobStorage(config.token)
      : createS3Storage(config);
  return built;
}

export { createUnconfiguredStorage };
