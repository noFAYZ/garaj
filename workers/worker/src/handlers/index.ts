/**
 * Job handler registry.
 *
 * Handlers are looked up by `job.name`, so adding work means adding an entry here — there is
 * no `switch` in the runner to forget to update.
 *
 * Handlers must be idempotent (§39): running is at-least-once and failures retry, so running
 * the same job twice must not send two emails or write two rows.
 */

import { lt } from 'drizzle-orm';
import { schema, type Database } from '@vehicle-os/database';

/** One outbox message, as a handler sees it. */
export interface Job {
  readonly id: string;
  readonly name: string;
  readonly data: Record<string, unknown>;
}

/** A failure retrying cannot fix: the runner dead-letters the job at once instead of five times. */
export class PermanentError extends Error {}

export interface JobContext {
  readonly db: Database;
  readonly log: {
    info: (o: object, m: string) => void;
    warn: (o: object, m: string) => void;
    error: (o: object, m: string) => void;
  };
}

export type JobHandler = (job: Job, context: JobContext) => Promise<void>;

import { maintenanceCompleted, scanDueMaintenance } from './maintenance';
import { collectDocumentObjects, scanExpiringDocuments } from './documents';
import { deliverNotificationJob } from './delivery';
import { scanRecalls } from './recalls';
import { deletePhotoObjects, processPhoto } from './images';

/*
 * Processed messages are history nobody reads after the admin console's last-day count; left
 * alone the table — and its indexes — grow by a row for every notification, forever. Dead
 * letters stay: they are the evidence a human is meant to find.
 */
const pruneOutbox: JobHandler = async (_job, { db, log }) => {
  const removed = await db
    .delete(schema.outboxMessages)
    .where(lt(schema.outboxMessages.processedAt, new Date(Date.now() - 14 * 86_400_000)))
    .returning({ id: schema.outboxMessages.id });
  log.info({ removed: removed.length }, 'Outbox pruned');
};

/**
 * Populated as each phase lands: image-processing in Phase 5, ocr and ai in Phase 7+. The
 * queues and the dispatcher existed from Phase 1 so those phases add a handler rather than
 * an infrastructure layer.
 */
export const HANDLERS: Record<string, JobHandler> = {
  'scan-due-maintenance': scanDueMaintenance,
  'maintenance-completed': maintenanceCompleted,
  // Both names kept: they are what the scans enqueue, and jobs already in the outbox carry them.
  'deliver-maintenance-reminder': deliverNotificationJob,
  'scan-expiring-documents': scanExpiringDocuments,
  'deliver-document-expiry': deliverNotificationJob,
  'scan-recalls': scanRecalls,
  'deliver-recall': deliverNotificationJob,
  'process-photo': processPhoto,
  'delete-photo-objects': deletePhotoObjects,
  'collect-document-objects': collectDocumentObjects,
  'prune-outbox': pruneOutbox,
};

export function resolveHandler(jobName: string): JobHandler | undefined {
  return HANDLERS[jobName];
}
