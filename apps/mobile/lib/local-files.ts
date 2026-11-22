/**
 * Files waiting to be uploaded.
 *
 * A photo from the camera lives in a cache directory the OS is free to empty whenever it wants
 * the space — fine for a picture that is about to be sent, useless for one that has to survive a
 * week in a valley with no signal. So a queued upload copies its bytes somewhere durable first,
 * and the queue stores the file's name rather than the picture.
 *
 * The name, not the path: iOS moves an app's container — and with it the absolute path of every
 * file in it — on each app update. A queue holding absolute paths came back from an update
 * pointing at nothing, and the launch sweep, finding no entry for the files it did see, deleted
 * them. Every path is worked out from the name, against wherever the container is today.
 *
 * The copies are this module's to clean up: on a finished upload, on a discarded one, and on a
 * sweep at launch for anything the queue no longer refers to — a crash between copying the file
 * and queueing it would otherwise leave bytes on the phone that nothing will ever collect.
 */

// The path-and-string API; SDK 54 moved it under `legacy` when it made the File/Directory one default.
import * as FileSystem from 'expo-file-system/legacy';

const DIRECTORY = `${FileSystem.documentDirectory}pending-uploads/`;

/**
 * Where a kept file is today. Takes the name — or a path stored by an older version of the app,
 * whose last segment is the name.
 */
export const keptPath = (name: string) => `${DIRECTORY}${name.slice(name.lastIndexOf('/') + 1)}`;

/** Whether a kept file is still there: the OS may have been asked to free space, or a restore. */
export async function keptFileExists(name: string): Promise<boolean> {
  return (await FileSystem.getInfoAsync(keptPath(name))).exists;
}

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
 * Copies a picked file somewhere it will still be after a reboot, and answers with its name.
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
  await FileSystem.copyAsync({ from: uri, to: keptPath(id) });
  return id;
}

/** Deletes one kept file. Missing is success: the point is that it is gone. */
export async function forgetLocally(name: string): Promise<void> {
  await FileSystem.deleteAsync(keptPath(name), { idempotent: true });
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
  // Compared by name, so an entry written with an older app's absolute path still keeps its file.
  const wanted = new Set(keep.map((kept) => kept.slice(kept.lastIndexOf('/') + 1)));
  const names = await FileSystem.readDirectoryAsync(DIRECTORY);

  let removed = 0;
  for (const name of names) {
    if (wanted.has(name)) continue;
    await FileSystem.deleteAsync(keptPath(name), { idempotent: true });
    removed += 1;
  }
  return removed;
}
