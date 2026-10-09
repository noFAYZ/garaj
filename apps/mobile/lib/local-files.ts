/**
 * Files waiting to be uploaded.
 *
 * A photo from the camera lives in a cache directory the OS is free to empty whenever it wants
 * the space — fine for a picture that is about to be sent, useless for one that has to survive a
 * week in a valley with no signal. So a queued upload copies its bytes somewhere durable first,
 * and the queue stores the path rather than the picture.
 *
 * The copies are this module's to clean up: on a finished upload, on a discarded one, and on a
 * sweep at launch for anything the queue no longer refers to — a crash between copying the file
 * and queueing it would otherwise leave bytes on the phone that nothing will ever collect.
 */

import * as FileSystem from 'expo-file-system';

const DIRECTORY = `${FileSystem.documentDirectory}pending-uploads/`;

/**
 * What the phone will hold for a queue that cannot drain.
 *
 * ponytail: a flat ceiling rather than a quota per vehicle or an LRU. At 50 MB a full queue is
 * around thirty photographs, which is far more than a trip without signal produces; the upgrade
 * if that is ever wrong is evicting the oldest rather than refusing the newest.
 */
export const MAX_BYTES = 50 * 1024 * 1024;

export class StorageFullError extends Error {
  constructor() {
    super('No room for more unsent files. Send what is waiting first.');
    this.name = 'StorageFullError';
  }
}

async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIRECTORY);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
}

/** Bytes currently held, for the ceiling and for telling someone why a save was refused. */
export async function heldBytes(): Promise<number> {
  await ensureDirectory();
  const names = await FileSystem.readDirectoryAsync(DIRECTORY);
  let total = 0;
  for (const name of names) {
    const info = await FileSystem.getInfoAsync(`${DIRECTORY}${name}`);
    if (info.exists && !info.isDirectory) total += info.size;
  }
  return total;
}

/**
 * Copies a picked file somewhere it will still be after a reboot, and answers with its new path.
 *
 * Refuses rather than evicts when the ceiling is reached: the file already queued is one someone
 * chose to keep, and silently dropping it to make room for a newer one loses the older record
 * with no way to tell them which.
 */
export async function keepLocally(uri: string, id: string): Promise<string> {
  await ensureDirectory();

  const source = await FileSystem.getInfoAsync(uri);
  if (!source.exists) throw new Error('That file is no longer on this phone.');
  if ((await heldBytes()) + source.size > MAX_BYTES) throw new StorageFullError();

  // The queue entry's own id names the file, so a sweep can match the two without a manifest.
  const destination = `${DIRECTORY}${id}`;
  await FileSystem.copyAsync({ from: uri, to: destination });
  return destination;
}

/** Deletes one kept file. Missing is success: the point is that it is gone. */
export async function forgetLocally(path: string): Promise<void> {
  await FileSystem.deleteAsync(path, { idempotent: true });
}

/**
 * Deletes kept files that no queue entry refers to any more.
 *
 * Called at launch. The crash window is small — between the copy finishing and the entry being
 * written — but a phone that loses a byte of disk on every such crash and never gives it back is
 * a phone that eventually cannot take a photograph.
 */
export async function sweepOrphans(keep: readonly string[]): Promise<number> {
  await ensureDirectory();
  const wanted = new Set(keep);
  const names = await FileSystem.readDirectoryAsync(DIRECTORY);

  let removed = 0;
  for (const name of names) {
    const path = `${DIRECTORY}${name}`;
    if (wanted.has(path)) continue;
    await FileSystem.deleteAsync(path, { idempotent: true });
    removed += 1;
  }
  return removed;
}
