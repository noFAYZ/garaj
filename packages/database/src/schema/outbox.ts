/**
 * Transactional outbox (Architecture.md §38).
 *
 * A job enqueued straight to Redis inside a request can be lost two ways: the transaction
 * rolls back after the job was queued (work fires for data that does not exist), or the
 * process dies after commit but before the enqueue (data exists, notification never sent).
 * Writing the message into the same transaction as the domain rows removes both — the
 * worker runs committed messages straight from this table, at-least-once.
 */

import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared';

export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: primaryId(),
    queue: text('queue').notNull(),
    jobName: text('job_name').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),

    /*
     * Stable identity for the work (§39) — what a scheduled slot is deduplicated by, and what a
     * person reads in the admin console to know which job a row is.
     */
    jobKey: text('job_key').notNull(),

    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    // Set after the retry budget is exhausted, so a poison message stops being retried
    // forever and becomes something a human can find.
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true, mode: 'date' }),
    /*
     * Not run before this. How delivery waits out someone's quiet hours, how a failed job backs
     * off, and — pushed forward while a job runs — the lease that keeps two runners off it.
     */
    availableAt: timestamp('available_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    createdAt: createdAt(),
  },
  (table) => [
    /*
     * The dispatcher's only query: unprocessed and due. Partial index so it stays the size of
     * the backlog rather than the size of history — the processed rows, which are the
     * overwhelming majority, are not in it at all.
     */
    index('outbox_pending_idx')
      .on(table.availableAt)
      .where(sql`processed_at is null and dead_lettered_at is null`),
    // The scheduler's "is this slot already queued?" — a lookup, not a scan of history.
    index('outbox_job_key_idx').on(table.jobKey),
  ],
);
