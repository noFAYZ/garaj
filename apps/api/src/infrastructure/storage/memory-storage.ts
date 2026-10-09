/**
 * In-memory storage adapter, for integration tests.
 *
 * The photo upload flow — issue a ticket, client uploads, finalize verifies the object
 * exists — is only meaningfully testable if "the object exists" can be made true and false
 * on demand. Pointing the tests at MinIO would put a container back in the way of a suite
 * that otherwise needs nothing.
 */

import type { SignedUpload, StoragePort, StoredObject } from './storage-port';

export interface MemoryStorage extends StoragePort {
  /** Simulates a completed client upload. */
  put(key: string, object: StoredObject): void;
  has(key: string): boolean;
  readonly keys: () => string[];
}

export function createMemoryStorage(): MemoryStorage {
  const objects = new Map<string, StoredObject>();

  return {
    createUploadUrl(key, mimeType): Promise<SignedUpload> {
      return Promise.resolve({
        url: `memory://upload/${encodeURIComponent(key)}?contentType=${encodeURIComponent(mimeType)}`,
        expiresInSeconds: 900,
      });
    },
    createDownloadUrl(key): Promise<string> {
      return Promise.resolve(`memory://download/${encodeURIComponent(key)}`);
    },
    head(key): Promise<StoredObject | null> {
      return Promise.resolve(objects.get(key) ?? null);
    },
    delete(key): Promise<void> {
      objects.delete(key);
      return Promise.resolve();
    },
    put(key, object): void {
      objects.set(key, object);
    },
    has(key): boolean {
      return objects.has(key);
    },
    keys: () => [...objects.keys()],
  };
}
