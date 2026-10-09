/**
 * The offline write queue (PRD §6.6: mobile optimises for quick entry).
 *
 * The moment an entry is most useful — a fill-up at the pump, the odometer in an underground car
 * park — is exactly where there is no signal. So nothing the phone records waits on the network:
 * it goes into this queue, shows in the feed at once, and the queue drains whenever it can — on
 * launch, when the app returns to the foreground, on a timer while anything is waiting, and right
 * after anything is queued.
 *
 * A write the server refuses on its merits (a 4xx) is not silently dropped: it moves to `failed`
 * with the server's reason, so the feed can say "Not saved" and offer to discard it.
 *
 * ponytail: AsyncStorage and a JSON array, not SQLite or a sync engine. The ceiling is that it is
 * rewritten whole on every change, which stops being free somewhere past a few hundred pending
 * writes — far beyond one fill-up and the next connection.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { ApiError, planWall, type PlanWall } from '@vehicle-os/api-client';
import { api } from './api';
import { uploadDocumentFile, uploadPhotoFile } from './file-picker';
import { forgetLocally, keepLocally } from './local-files';

const QUEUE_KEY = 'vehicleos.pending-writes';

/**
 * What a queued write is: a named action with its arguments, not a serialised HTTP request. The
 * endpoint can change between the version that queued an entry and the one that sends it, and a
 * named action lets this file decide what to do about that.
 */
export type PendingWrite = (
  | { kind: 'event'; vehicleId: string; body: Record<string, unknown> }
  /** Completing a schedule: the service record, the activity item and the restarted clock. */
  | { kind: 'maintenance'; vehicleId: string; planId: string; body: Record<string, unknown> }
  /** An unscheduled service, filed as a maintenance record. */
  | { kind: 'maintenance-log'; vehicleId: string; body: Record<string, unknown> }
  | { kind: 'task-create'; vehicleId: string | null; body: Record<string, unknown> }
  | { kind: 'plan-create'; vehicleId: string; body: Record<string, unknown> }
  | { kind: 'task-status'; taskId: string; status: string }
  /** A vehicle added offline. Its id is chosen here, so later writes can already refer to it. */
  | { kind: 'vehicle-create'; body: Record<string, unknown> }
  | { kind: 'vehicle-update'; vehicleId: string; body: Record<string, unknown> }
  | { kind: 'vehicle-archive'; vehicleId: string }
  | { kind: 'profile-update'; body: Record<string, unknown> }
  | { kind: 'garage-update'; garageId: string; body: Record<string, unknown> }
  /**
   * A document or photo, with its bytes copied somewhere durable (`local-files`). `path` is that
   * copy, and it is deleted once the upload finishes or the entry is discarded.
   */
  | {
      kind: 'upload';
      target: 'document' | 'photo';
      vehicleId: string;
      path: string;
      name: string;
      mimeType: string;
      size: number;
      body: Record<string, unknown>;
    }
) & {
  id: string;
  queuedAt: number;
  /** Set once the server has refused it: the reason, in the server's words. */
  error?: string;
};

/**
 * The queue entry a caller supplies — everything but the bookkeeping. Distributive on purpose:
 * `Omit` over the union would collapse to the keys the members share.
 */
export type NewWrite<T = PendingWrite> = T extends unknown
  ? Omit<T, 'id' | 'queuedAt' | 'error'>
  : never;

/*
 * An in-memory mirror of the stored queue, so screens can render pending entries synchronously
 * and re-render when the queue changes. Storage stays the source of truth across restarts.
 */
let entries: PendingWrite[] = [];
/*
 * Writes the server has just accepted, kept on screen a little longer. Between a send finishing
 * and the refetched feed arriving there is a gap of a second or two, and without these the entry
 * would blink out of the list and back in. A screen hides one as soon as its own data is newer
 * than `sentAt`.
 */
let recent: SentWrite[] = [];
let snapshot: readonly (PendingWrite | SentWrite)[] = [];
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const syncListeners = new Set<() => void>();
const RECENT_MS = 60_000;

export type SentWrite = PendingWrite & { sentAt: number };

function publish(next: PendingWrite[]) {
  entries = next;
  recent = recent.filter((item) => Date.now() - item.sentAt < RECENT_MS);
  snapshot = [...entries, ...recent];
  listeners.forEach((listener) => listener());
}

function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(QUEUE_KEY)
    .then((raw) => publish(raw ? (JSON.parse(raw) as PendingWrite[]) : []))
    // A corrupt queue is not worth an app that cannot start until its storage is cleared.
    .catch(() => publish([]));
  return loaded;
}

async function save(next: PendingWrite[]): Promise<void> {
  publish(next);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
}

/** Every queued write — pending, failed, and just sent (`sentAt`) — kept current. */
export function usePendingWrites(): readonly (PendingWrite | SentWrite)[] {
  void load();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** Called after any write reaches the server, so screens can refetch what it changed. */
export function onSynced(listener: () => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export async function enqueue(entry: NewWrite): Promise<void> {
  await load();
  await save([
    ...entries,
    {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: Date.now(),
    } as PendingWrite,
  ]);
}

/**
 * Queues a file, keeping its bytes somewhere durable first.
 *
 * The copy is made before the entry so a crash can only ever orphan bytes, never leave an entry
 * pointing at a file that was never written — the launch sweep collects the former, and nothing
 * can recover the latter.
 */
export async function enqueueUpload(
  entry: Omit<Extract<NewWrite, { kind: 'upload' }>, 'path'> & { uri: string },
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = await keepLocally(entry.uri, id);
  await load();
  const { uri: _uri, ...rest } = entry;
  await save([...entries, { ...rest, path, id, queuedAt: Date.now() } as PendingWrite]);
}

/** Writes still to be sent — the failed ones are waiting on a person, not on signal. */
export async function pendingCount(): Promise<number> {
  await load();
  return entries.filter((entry) => !entry.error).length;
}

/** Drops one write — a failed entry the person has chosen to let go. */
export async function discard(id: string): Promise<void> {
  await load();
  // Its bytes go with it; nothing else will ever refer to them.
  const entry = entries.find((item) => item.id === id);
  if (entry?.kind === 'upload') await forgetLocally(entry.path).catch(() => undefined);
  await save(entries.filter((item) => item.id !== id));
}

/** Every kept file the queue still needs, for the launch sweep in `local-files`. */
export async function keptFiles(): Promise<string[]> {
  await load();
  return entries.flatMap((entry) => (entry.kind === 'upload' ? [entry.path] : []));
}

async function send(entry: PendingWrite): Promise<void> {
  switch (entry.kind) {
    case 'event':
      await api.events.create(entry.vehicleId, entry.body as never);
      return;
    case 'maintenance':
      await api.maintenance.complete(entry.vehicleId, entry.planId, entry.body as never);
      return;
    case 'maintenance-log':
      await api.maintenance.log(entry.vehicleId, entry.body as never);
      return;
    case 'task-create':
      await api.tasks.create(entry.body as never);
      return;
    case 'plan-create':
      await api.maintenance.createPlan(entry.vehicleId, entry.body as never);
      return;
    case 'task-status':
      await api.tasks.update(entry.taskId, { status: entry.status as never });
      return;
    case 'vehicle-create':
      await api.vehicles.create(entry.body as never);
      return;
    case 'vehicle-update':
      await api.vehicles.update(entry.vehicleId, entry.body as never);
      return;
    case 'vehicle-archive':
      await api.vehicles.archive(entry.vehicleId);
      return;
    case 'profile-update':
      await api.users.updateMe(entry.body as never);
      return;
    case 'garage-update':
      await api.garages.update(entry.garageId, entry.body as never);
      return;
    case 'upload':
      await sendUpload(entry);
      return;
  }
}

/**
 * The three-step upload, replayed from disk.
 *
 * Ticket, bytes, finalize — and the ticket is asked for again on every attempt rather than being
 * stored, because a signed URL from a week ago in a valley has long since expired. The local copy
 * goes once the server has the file; a failed attempt keeps it for the next one.
 */
async function sendUpload(entry: Extract<PendingWrite, { kind: 'upload' }>): Promise<void> {
  const file = {
    uri: entry.path,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
  };
  if (entry.target === 'document') {
    await uploadDocumentFile(entry.vehicleId, file, entry.body as never);
  } else {
    await uploadPhotoFile(entry.vehicleId, file, entry.body as never);
  }
  await forgetLocally(entry.path);
}

function reasonFor(error: ApiError): string {
  /*
   * A plan refusal's fields are machine values — `limit: "vehicles"` — and the first of them
   * as a failure reason would read "vehicles" under a failed entry. Its message is the sentence
   * ("Your FREE plan holds 3 vehicles.").
   */
  if (planWall(error)) return error.message;
  const fields = error.fields ? Object.values(error.fields) : [];
  return fields[0] ?? error.message;
}

const wallListeners = new Set<(wall: PlanWall) => void>();

/**
 * Hear about a queued write the plan refused.
 *
 * A listener rather than a direct call to the alert: this module is plain TypeScript with unit
 * tests, and the queue is exactly where a write made offline meets the plan — a vehicle added
 * on a train is refused on the platform, long after the form closed, and the app layout is the
 * one place still on screen to say so.
 */
export function onPlanWall(listener: (wall: PlanWall) => void): () => void {
  wallListeners.add(listener);
  return () => wallListeners.delete(listener);
}

export interface FlushResult {
  readonly sent: number;
  readonly failed: number;
  readonly remaining: number;
}

let inFlight: Promise<FlushResult> | null = null;

/**
 * Sends what it can and keeps what it cannot.
 *
 * One at a time and in order: a fill-up and the odometer reading after it are not independent.
 * A 4xx marks the entry failed with the server's reason — it will still be invalid on the tenth
 * attempt, and a stuck entry would block every later write. Anything else (a timeout, a 500, an
 * aeroplane) stops the run and keeps the rest for next time.
 *
 * Concurrent calls share one run. Two overlapping runs would each send the head of the queue,
 * and the server would record it twice.
 *
 * Replays are safe: every create carries a client-chosen id and the server treats a repeat of one
 * as the same record (`infrastructure/idempotency` on the API side). So a write whose response is
 * lost after the server saved it is sent again and lands on the row it already made.
 */
export function flush(): Promise<FlushResult> {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<FlushResult> {
  await load();
  let sent = 0;
  let failed = 0;

  for (const entry of entries.filter((item) => !item.error)) {
    try {
      await send(entry);
      sent += 1;
      recent = [...recent, { ...entry, sentAt: Date.now() }];
      await save(entries.filter((item) => item.id !== entry.id));
    } catch (error) {
      /*
       * 401 is the session, not the entry: signing in again makes it valid, so it waits like a
       * network failure rather than being marked as refused.
       */
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 401
      ) {
        failed += 1;
        const wall = planWall(error);
        if (wall) wallListeners.forEach((listener) => listener(wall));
        await save(
          entries.map((item) =>
            item.id === entry.id ? { ...item, error: reasonFor(error) } : item,
          ),
        );
        continue;
      }
      break;
    }
  }

  if (sent > 0 || failed > 0) syncListeners.forEach((listener) => listener());
  return { sent, failed, remaining: entries.filter((item) => !item.error).length };
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  recent = [];
  loaded = null;
  publish([]);
}
