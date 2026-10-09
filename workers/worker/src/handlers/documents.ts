/**
 * Document job handlers.
 *
 * Idempotent, as every handler must be (§39): the scan's dedupe key absorbs a double firing,
 * so re-running the sweep writes nothing a second time.
 */

import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { schema } from '@vehicle-os/database';
import { scanForExpiringDocuments } from '@vehicle-os/api/expiry-scan';
import { createStorage } from '@vehicle-os/api/storage';
import type { JobHandler } from './index';

/** How long a deleted document stays restorable before its file and row are collected. */
export const DOCUMENT_RETENTION_DAYS = 30;

/** An upload ticket lives minutes; a row still pending a day later was abandoned. */
const ABANDONED_UPLOAD_HOURS = 24;

// ponytail: one batch per daily run. A backlog beyond it drains over the following days;
// loop until a short batch if deletes ever outpace that.
const COLLECT_BATCH = 500;

/**
 * The daily sweep for bytes nothing points at: documents soft-deleted past the retention
 * window, and pending uploads whose client never finalized (their PUT may have landed).
 *
 * Bytes first, then the row. A crash between the two leaves a row the next run deletes an
 * already-missing object for — a no-op. The other order would lose the key and orphan the
 * file for good.
 */
export const collectDocumentObjects: JobHandler = async (_job, { db, log }) => {
  const storage = createStorage();
  if (!storage) return;

  const now = Date.now();
  const rows = await db
    .select({ id: schema.documents.id, storageKey: schema.documents.storageKey })
    .from(schema.documents)
    .where(
      or(
        lt(schema.documents.deletedAt, new Date(now - DOCUMENT_RETENTION_DAYS * 86_400_000)),
        and(
          isNull(schema.documents.uploadedAt),
          lt(schema.documents.createdAt, new Date(now - ABANDONED_UPLOAD_HOURS * 3_600_000)),
        ),
      ),
    )
    .limit(COLLECT_BATCH);

  for (const row of rows) {
    await storage.delete(row.storageKey);
    await db.delete(schema.documents).where(eq(schema.documents.id, row.id));
  }
  log.info({ collected: rows.length }, 'Document objects collected');
};

/** The daily sweep for documents that have expired or are about to. */
export const scanExpiringDocuments: JobHandler = async (_job, { db, log }) => {
  const result = await scanForExpiringDocuments(db);
  log.info(result, 'Document expiry scan complete');
};
