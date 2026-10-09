/**
 * Scheduled work (Architecture.md §84).
 *
 * Timers in the process that write an ordinary outbox row, which the runner picks up like any
 * other job. The job key is the slot (`scheduled:scan-recalls:<time>`), and a slot already in
 * the outbox is not written again — so a second replica, or a restart's catch-up, adds nothing.
 */

import { eq } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';

export interface ScheduledJob {
  readonly name: string;
  /** Hour of the day, UTC. */
  readonly hour: number;
  /** 0 is Sunday. Absent means every day. */
  readonly weekday?: number;
}

/**
 * The scans run once a day in one fixed zone; they only write in-app rows.
 *
 * What reaches a phone or an inbox is held per recipient by the delivery handler until
 * 08:00 in their own zone (`nextSendableTime`), so a single UTC schedule never buzzes anyone
 * at 03:00 — and there is no need for a schedule per timezone.
 */
export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  { name: 'scan-due-maintenance', hour: 7 },
  /*
   * An hour after the maintenance sweep rather than alongside it: both walk every garage,
   * and staggering them keeps one morning's scans from being a single spike against the
   * database.
   */
  { name: 'scan-expiring-documents', hour: 8 },
  /*
   * Weekly, not daily: campaigns are published a few times a week across the whole market, and
   * a daily sweep would ask NHTSA the same few hundred questions seven times for nothing.
   */
  { name: 'scan-recalls', hour: 6, weekday: 1 },
  { name: 'collect-document-objects', hour: 3 },
  { name: 'prune-outbox', hour: 4 },
];

const DAY_MS = 86_400_000;

const periodOf = (job: ScheduledJob): number => (job.weekday === undefined ? 1 : 7) * DAY_MS;

/** The latest time `job` was due, at or before `now`. */
export function lastSlot(job: ScheduledJob, now: Date): Date {
  const slot = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), job.hour),
  );
  while (slot > now || (job.weekday !== undefined && slot.getUTCDay() !== job.weekday)) {
    slot.setUTCDate(slot.getUTCDate() - 1);
  }
  return slot;
}

export function startScheduler(
  db: Database,
  log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
): () => void {
  const timers = new Map<string, NodeJS.Timeout>();
  let stopped = false;

  const enqueue = async (job: ScheduledJob, slot: Date) => {
    const jobKey = `scheduled:${job.name}:${slot.toISOString()}`;
    try {
      const [seen] = await db
        .select({ id: schema.outboxMessages.id })
        .from(schema.outboxMessages)
        .where(eq(schema.outboxMessages.jobKey, jobKey))
        .limit(1);
      if (!seen) {
        await db
          .insert(schema.outboxMessages)
          .values({ queue: 'scheduled', jobName: job.name, payload: {}, jobKey });
      }
    } catch (error) {
      log.error({ err: error, job: job.name }, 'Scheduled job not queued');
    }
  };

  for (const job of SCHEDULED_JOBS) {
    let slot = lastSlot(job, new Date());
    // Catch-up: a slot that passed while no worker was up runs now, once — the key dedupes it.
    void enqueue(job, slot);

    const arm = () => {
      slot = new Date(slot.getTime() + periodOf(job));
      timers.set(
        job.name,
        setTimeout(() => {
          if (stopped) return;
          void enqueue(job, slot);
          arm();
        }, slot.getTime() - Date.now()),
      );
    };
    arm();
    log.info({ job: job.name, next: slot.toISOString() }, 'Scheduled job armed');
  }

  return () => {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
  };
}
