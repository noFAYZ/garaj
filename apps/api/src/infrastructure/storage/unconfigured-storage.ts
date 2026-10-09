/**
 * The adapter used when no object storage is configured.
 *
 * A deployment without storage is a legitimate configuration — the whole product works
 * apart from photos and documents — so the API boots and only the file endpoints fail. They
 * fail with a 503 naming the missing configuration, which is far more useful than a crash
 * at startup that takes down vehicles, the timeline and authentication along with them.
 */

import { AppError } from '../errors';
import type { StoragePort } from './storage-port';

class StorageUnavailableError extends AppError {
  constructor() {
    super(
      'STORAGE_NOT_CONFIGURED',
      'File storage is not configured on this server. Set the OBJECT_STORAGE_* environment variables to enable photos and documents.',
      503,
    );
  }
}

export function createUnconfiguredStorage(): StoragePort {
  const unavailable = (): never => {
    throw new StorageUnavailableError();
  };

  return {
    createUploadUrl: unavailable,
    createDownloadUrl: unavailable,
    // `head` is the exception: it answers "does this object exist?", and with no storage
    // configured the honest answer is no, not an exception mid-transaction.
    head: () => Promise.resolve(null),
    delete: unavailable,
  };
}
