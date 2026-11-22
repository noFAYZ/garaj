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
import { ApiError, planWall, RequestTimeoutError, type PlanWall } from '@vehicle-os/api-client';
import type {
  CompleteMaintenance,
  CreateEvent,
  CreateMaintenancePlan,
  CreateTask,
  CreateVehicle,
  FinalizeDocumentUpload,
  FinalizePhotoUpload,
  LogMaintenance,
  Task,
  UpdateGarage,
  UpdateUserProfile,
  UpdateVehicle,
} from '@vehicle-os/contracts';
import { newId } from '@vehicle-os/utils';
import { api } from './api';
import { uploadDocumentFile, uploadPhotoFile } from './file-picker';
import { forgetLocally, keepLocally, keptFileExists, keptPath } from './local-files';

const QUEUE_KEY = 'vehicleos.pending-writes';

/**
 * What a queued write is: a named action with its arguments, not a serialised HTTP request. The
 * endpoint can change between the version that queued an entry and the one that sends it, and a
 * named action lets this file decide what to do about that.
 *
 * Each body is the contract the endpoint validates, so a change to one is a compile error at
 * every form that queues it — not an entry that sits on a phone and fails when it finally sends.
 */
export type PendingWrite = (
  | { kind: 'event'; vehicleId: string; body: CreateEvent }
  /** Completing a schedule: the service record, the activity item and the restarted clock. */
  | { kind: 'maintenance'; vehicleId: string; planId: string; body: CompleteMaintenance }
  /** An unscheduled service, filed as a maintenance record. */
  | { kind: 'maintenance-log'; vehicleId: string; body: LogMaintenance }
  | { kind: 'task-create'; vehicleId: string | null; body: CreateTask }
  | { kind: 'plan-create'; vehicleId: string; body: CreateMaintenancePlan }
  | { kind: 'task-status'; taskId: string; status: Task['status'] }
  /** A vehicle added offline. Its id is chosen here, so later writes can already refer to it. */
  | { kind: 'vehicle-create'; body: CreateVehicle }
  | { kind: 'vehicle-update'; vehicleId: string; body: UpdateVehicle }
  | { kind: 'vehicle-archive'; vehicleId: string }
  | { kind: 'profile-update'; body: UpdateUserProfile }
  | { kind: 'garage-update'; garageId: string; body: UpdateGarage }
  /**
   * A document or photo, with its bytes copied somewhere durable (`local-files`). `path` names
   * that copy (older entries hold its absolute path), and it is deleted once the upload finishes
   * or the entry is discarded. `uploadId` is the document's or photo's id, chosen here, so a
   * replay after a lost reply lands on the same one.
   */
  | {
      kind: 'upload';
      target: 'document' | 'photo';
      vehicleId: string;
      path: string;
      uploadId?: string;
      name: string;
      mimeType: string;
      size: number;
      body: FinalizeDocumentUpload | FinalizePhotoUpload;
    }
) & {
  id: string;
  queuedAt: number;
  /** Set once the server has refused it: the reason, in the server's words. */
  error?: string;
  /** Failed sends that were not the network's fault, toward `MAX_ATTEMPTS`. */
  attempts?: number;
};

/**
 * The queue entry a caller supplies — everything but the bookkeeping. Distributive on purpose:
 * `Omit` over the union would collapse to the keys the members share.
 */
export type NewWrite<T = PendingWrite> = T extends unknown
  ? Omit<T, 'id' | 'queuedAt' | 'error' | 'attempts'>
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
const syncListeners = new Set<(vehicles: ReadonlySet<string> | null) => void>();
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

/**
 * Called after a run that sent or settled anything, so screens can refetch what it changed: the
 * vehicles its writes were about, or `null` when one of them reaches past any single vehicle.
 */
export function onSynced(listener: (vehicles: ReadonlySet<string> | null) => void): () => void {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

/**
 * The one vehicle a write changes, or `null` for one whose reach is wider: a task's status (the
 * entry does not say whose), the profile's and a garage's units and currency (every figure).
 */
export function vehicleOf(entry: PendingWrite): string | null {
  switch (entry.kind) {
    case 'task-status':
    case 'profile-update':
    case 'garage-update':
      return null;
    case 'vehicle-create':
      return typeof entry.body.id === 'string' ? entry.body.id : null;
    default:
      return entry.vehicleId;
  }
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
  entry: Omit<Extract<NewWrite, { kind: 'upload' }>, 'path' | 'uploadId'> & { uri: string },
): Promise<void> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = await keepLocally(entry.uri, id);
  await load();
  const { uri: _uri, ...rest } = entry;
  await save([
    ...entries,
    { ...rest, path, uploadId: newId(), id, queuedAt: Date.now() } as PendingWrite,
  ]);
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
      await api.events.create(entry.vehicleId, entry.body);
      return;
    case 'maintenance':
      await api.maintenance.complete(entry.vehicleId, entry.planId, entry.body);
      return;
    case 'maintenance-log':
      await api.maintenance.log(entry.vehicleId, entry.body);
      return;
    case 'task-create':
      await api.tasks.create(entry.body);
      return;
    case 'plan-create':
      await api.maintenance.createPlan(entry.vehicleId, entry.body);
      return;
    case 'task-status':
      await api.tasks.update(entry.taskId, { status: entry.status });
      return;
    case 'vehicle-create':
      await api.vehicles.create(entry.body);
      return;
    case 'vehicle-update':
      await api.vehicles.update(entry.vehicleId, entry.body);
      return;
    case 'vehicle-archive':
      await api.vehicles.archive(entry.vehicleId);
      return;
    case 'profile-update':
      await api.users.updateMe(entry.body);
      return;
    case 'garage-update':
      await api.garages.update(entry.garageId, entry.body);
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
  if (!(await keptFileExists(entry.path))) throw new LostFileError();
  const file = {
    uri: keptPath(entry.path),
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
  };
  if (entry.target === 'document') {
    await uploadDocumentFile(
      entry.vehicleId,
      file,
      entry.body as FinalizeDocumentUpload,
      entry.uploadId,
    );
  } else {
    await uploadPhotoFile(entry.vehicleId, file, entry.body as FinalizePhotoUpload, entry.uploadId);
  }
  await forgetLocally(entry.path);
}

/** A queued upload whose bytes are gone. No retry brings them back; the person is told. */
class LostFileError extends Error {
  constructor() {
    super('The file is no longer on this phone. Attach it again.');
    this.name = 'LostFileError';
  }
}

/**
 * Failures that pass with time: no route, a timeout, the server down, the session expired, or
 * the server asking for a pause — too many requests (429) or a request it gave up waiting for
 * (408). None says anything about the entry, so they wait for the next run however often they
 * happen; marking a fill-up "Not saved" because a long-offline phone sent too much at once would
 * lose it for no reason.
 */
function waitsForNetwork(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.status >= 500 || error.status === 401 || error.status === 408 || error.status === 429
    );
  }
  if (error instanceof RequestTimeoutError) return true;
  // React Native's `fetch` fails with "Network request failed"; an upload cut off mid-way says so too.
  return error instanceof Error && /network/i.test(error.message);
}

/*
 * Anything else — storage refusing the bytes, an exception nobody foresaw — gets a few runs and
 * is then set aside like a refusal. Before this, one such entry at the head of the queue was
 * retried for ever, and every entry behind it waited with it.
 */
const MAX_ATTEMPTS = 3;

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
  // What the settled writes were about, for `onSynced`; `null` once one reaches past a vehicle.
  let touched: Set<string> | null = new Set();
  const settled = (entry: PendingWrite) => {
    const vehicle = vehicleOf(entry);
    touched = vehicle && touched ? touched.add(vehicle) : null;
  };

  for (const entry of entries.filter((item) => !item.error)) {
    try {
      await send(entry);
      settled(entry);
      sent += 1;
      recent = [...recent, { ...entry, sentAt: Date.now() }];
      await save(entries.filter((item) => item.id !== entry.id));
    } catch (error) {
      /*
       * 401 is the session, not the entry: signing in again makes it valid, so it waits like a
       * network failure rather than being marked as refused.
       */
      if (waitsForNetwork(error)) break;

      const refused = error instanceof ApiError;
      const attempts = (entry.attempts ?? 0) + 1;
      if (!refused && !(error instanceof LostFileError) && attempts < MAX_ATTEMPTS) {
        // Counted, and the run stops here: order still matters while it might yet go.
        await save(entries.map((item) => (item.id === entry.id ? { ...item, attempts } : item)));
        break;
      }

      failed += 1;
      settled(entry);
      const wall = refused ? planWall(error) : null;
      if (wall) wallListeners.forEach((listener) => listener(wall));
      const reason = refused
        ? reasonFor(error)
        : error instanceof Error
          ? error.message
          : 'This could not be sent.';
      await save(entries.map((item) => (item.id === entry.id ? { ...item, error: reason } : item)));
    }
  }

  if (sent > 0 || failed > 0) syncListeners.forEach((listener) => listener(touched));
  return { sent, failed, remaining: entries.filter((item) => !item.error).length };
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  recent = [];
  loaded = null;
  publish([]);
}
