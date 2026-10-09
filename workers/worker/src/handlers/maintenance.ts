/**
 * Maintenance job handlers.
 *
 * Idempotent, as every handler must be (§39): BullMQ retries, and the outbox delivers
 * at-least-once, so running one of these twice has to be indistinguishable from running it
 * once.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { scanForDueMaintenance } from '@vehicle-os/api/maintenance-scan';
import type { JobHandler } from './index';

/** The daily sweep. Safe to run repeatedly — the dedupe key absorbs a double firing. */
export const scanDueMaintenance: JobHandler = async (_job, { db, log }) => {
  const result = await scanForDueMaintenance(db);
  log.info(result, 'Maintenance due scan complete');
};

/**
 * Clears the reminder for a cycle that has just been closed.
 *
 * Marking it read rather than deleting it: the notification is a record that the user was
 * told, and a service logged five minutes after the reminder arrived should not erase the
 * evidence the system did its job.
 */
export const maintenanceCompleted: JobHandler = async (job, { db, log }) => {
  const { planId } = job.data as { planId: string };
  if (!planId) return;

  const cleared = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.notificationType, 'MAINTENANCE_DUE'),
        isNull(schema.notifications.readAt),
        /*
         * `@>` (containment), not equality: the payload also carries the trigger, so an
         * equality test against `{ planId }` matches nothing. Containment asks "does this
         * JSON include this key and value", which is the actual question.
         */
        sql`${schema.notifications.payload} @> ${JSON.stringify({ planId })}::jsonb`,
      ),
    )
    .returning({ id: schema.notifications.id });

  log.info({ planId, cleared: cleared.length }, 'Cleared reminders for completed maintenance');
};
