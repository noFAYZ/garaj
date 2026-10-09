/**
 * The last step every scan shares: write the in-app rows nobody has had yet, and queue delivery
 * for exactly those.
 *
 * Batched, not one transaction per row. The scans run daily over every garage and most of what
 * they find was already said yesterday, so the old per-row BEGIN/SELECT/INSERT/COMMIT spent
 * thousands of round trips a morning discovering nothing was new. The unique
 * `(user_id, dedupe_key)` is the idempotency: `on conflict do nothing` skips what exists, and
 * `returning` names what did not — which is the only set that gets a delivery job.
 *
 * A failed chunk rolls back whole and the job retries; the dedupe key makes the rerun a no-op
 * for everything that already landed.
 */

import { schema, type Database } from '@vehicle-os/database';
import { enqueue } from '../../../../infrastructure/outbox';

type NotificationRow = typeof schema.notifications.$inferInsert;

export interface PendingNotification {
  readonly row: NotificationRow;
  /** Which `deliver-*` job the worker runs; the handler reads everything else back from the row. */
  readonly jobName: string;
}

// Well under Postgres's 65,535 bind parameters at nine columns a row.
const CHUNK = 500;

/** Returns how many were new. */
export async function notifyOnce(
  db: Database,
  pending: readonly PendingNotification[],
): Promise<number> {
  let notified = 0;
  for (let start = 0; start < pending.length; start += CHUNK) {
    const chunk = pending.slice(start, start + CHUNK);
    notified += await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.notifications)
        .values(chunk.map((item) => item.row))
        .onConflictDoNothing()
        .returning({
          userId: schema.notifications.userId,
          dedupeKey: schema.notifications.dedupeKey,
        });
      if (inserted.length === 0) return 0;

      const fresh = new Set(inserted.map((row) => `${row.userId}|${row.dedupeKey}`));
      await enqueue(
        tx,
        chunk.flatMap(({ row, jobName }) => {
          // `delete` doubles as the dedupe for a pair that appears twice in one scan.
          if (!fresh.delete(`${row.userId}|${row.dedupeKey}`)) return [];
          return [
            {
              queue: 'notifications' as const,
              jobName,
              payload: { userId: row.userId, dedupeKey: row.dedupeKey },
              jobKey: `deliver:${row.userId}:${row.dedupeKey}`,
            },
          ];
        }),
      );
      return inserted.length;
    });
  }
  return notified;
}
