/**
 * The job runner (Architecture.md §37–§39): the outbox is the queue.
 *
 * The API writes each job into `outbox_messages` in the same transaction as the domain change,
 * so a job exists exactly when its data does. This runs those rows directly. It used to copy
 * them into BullMQ first, and that copy in Redis was the whole Redis bill: every idle poll,
 * lock renewal and state move is a billed command, thirty-odd per job on a per-request plan.
 * The worker now needs no Redis at all.
 *
 * Claiming is one statement. `FOR UPDATE SKIP LOCKED` takes rows no other runner holds, and the
 * same UPDATE leases them by pushing `available_at` past now, so nothing holds a transaction
 * while a job runs. A running job's lease is renewed every minute; a runner that dies leaves its
 * lease to expire and the row runs again. That is at-least-once, which is why handlers are
 * idempotent (§39).
 */

import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';
import { HANDLERS, PermanentError, type JobContext, type JobHandler } from './handlers/index';

export interface RunnerDeps {
  readonly db: Database;
  readonly log: JobContext['log'];
  /** Test seam; the real registry otherwise. */
  readonly handlers?: Readonly<Record<string, JobHandler>>;
  /** Runs before a job is dead-lettered. */
  readonly maxAttempts?: number;
}

export interface RunResult {
  readonly completed: number;
  readonly failed: number;
  readonly deadLettered: number;
}

type Message = typeof schema.outboxMessages.$inferSelect;

const outbox = schema.outboxMessages;
const DEFAULT_MAX_ATTEMPTS = 5;
/** Long enough that no job outlives it between renewals. */
const LEASE = sql`now() + interval '5 minutes'`;
const RENEW_MS = 60_000;
/** Ceiling for the backoff while Postgres is down: a minute, not a tight error loop. */
const MAX_BACKOFF_MS = 60_000;

/** 2s, 4s, 8s, 16s: about half a minute over five runs, enough for a provider blip. */
export function retryDelayMs(attempts: number): number {
  return Math.min(2000 * 2 ** (attempts - 1), 3_600_000);
}

/** Leases up to `limit` due messages to this runner. One round trip, even when there are none. */
export async function claimDue(db: Database, limit: number): Promise<Message[]> {
  const due = db
    .select({ id: outbox.id })
    .from(outbox)
    .where(
      and(
        isNull(outbox.processedAt),
        isNull(outbox.deadLetteredAt),
        // The database's clock, not this process's, so replicas agree on "now".
        lte(outbox.availableAt, sql`now()`),
      ),
    )
    .orderBy(asc(outbox.availableAt))
    .limit(limit)
    .for('update', { skipLocked: true });

  return db
    .update(outbox)
    .set({ availableAt: LEASE, attempts: sql`${outbox.attempts} + 1` })
    .where(inArray(outbox.id, due))
    .returning();
}

/** Runs one claimed message and records the outcome on its row. */
export async function runOne(
  deps: RunnerDeps,
  message: Message,
): Promise<'completed' | 'failed' | 'dead'> {
  const handler = (deps.handlers ?? HANDLERS)[message.jobName];
  try {
    /*
     * A job with no handler is a deployment mismatch — the API enqueueing work this worker
     * build does not know. Parked for a human rather than retried, or dropped silently while
     * every dashboard stays green.
     */
    if (!handler) throw new PermanentError(`No handler registered for job "${message.jobName}"`);
    await handler(
      { id: message.id, name: message.jobName, data: message.payload },
      { db: deps.db, log: deps.log },
    );
    await deps.db
      .update(outbox)
      .set({ processedAt: new Date(), lastError: null })
      .where(eq(outbox.id, message.id));
    return 'completed';
  } catch (error) {
    const dead =
      error instanceof PermanentError ||
      message.attempts >= (deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    await deps.db
      .update(outbox)
      .set({
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        ...(dead
          ? { deadLetteredAt: new Date() }
          : { availableAt: new Date(Date.now() + retryDelayMs(message.attempts)) }),
      })
      .where(eq(outbox.id, message.id));
    deps.log.error(
      { err: error, jobId: message.id, jobName: message.jobName, attempts: message.attempts, dead },
      'Job failed',
    );
    return dead ? 'dead' : 'failed';
  }
}

/** Claims and runs everything due, to completion. What a tick does, minus the concurrency cap. */
export async function runDue(deps: RunnerDeps, limit = 100): Promise<RunResult> {
  const outcomes = await Promise.all(
    (await claimDue(deps.db, limit)).map((message) => runOne(deps, message)),
  );
  const count = (outcome: string) => outcomes.filter((value) => value === outcome).length;
  return { completed: count('completed'), failed: count('failed'), deadLettered: count('dead') };
}

/**
 * Polls every 2.5s — one indexed round trip when idle — and keeps up to `concurrency` jobs in
 * flight without waiting for a slow one (a recall sweep) before starting the next photo.
 *
 * Returns a stop that stops claiming and then waits for what is running, so a deploy never cuts a
 * job off halfway.
 */
export function startRunner(
  deps: RunnerDeps,
  { intervalMs = 2500, concurrency = 8 } = {},
): () => Promise<void> {
  const running = new Map<string, Promise<unknown>>();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let delay = intervalMs;
  let renewedAt = Date.now();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      if (running.size > 0 && Date.now() - renewedAt >= RENEW_MS) {
        renewedAt = Date.now();
        await deps.db
          .update(outbox)
          .set({ availableAt: LEASE })
          .where(and(inArray(outbox.id, [...running.keys()]), isNull(outbox.processedAt)));
      }
      const free = concurrency - running.size;
      if (free > 0) {
        for (const message of await claimDue(deps.db, free)) {
          running.set(
            message.id,
            runOne(deps, message)
              .catch((error: unknown) =>
                deps.log.error({ err: error, jobId: message.id }, 'Job outcome not recorded'),
              )
              .finally(() => running.delete(message.id)),
          );
        }
      }
      delay = intervalMs;
    } catch (error) {
      deps.log.error({ err: error }, 'Job runner tick failed');
      // Doubling while Postgres is down, back to normal on the first healthy tick.
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
    // Scheduled after the work, not on a fixed interval, so ticks never overlap.
    if (!stopped) timer = setTimeout(() => void tick(), delay);
  };

  void tick();

  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await Promise.allSettled(running.values());
  };
}
