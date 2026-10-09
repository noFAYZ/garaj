/**
 * Documents (Architecture.md §28, §30).
 *
 * Metadata in Postgres, bytes in object storage. `storageKey` is tenant-scoped
 * (`garages/{garageId}/vehicles/{vehicleId}/documents/{documentId}`) so a key cannot be
 * guessed into another garage, and nothing in the bucket is public — downloads go through
 * an authorization check that then mints a short-lived signed URL.
 */

import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { documentTypeEnum } from './enums';
import { deletedAt, primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { vehicleEvents } from './events';
import { users } from './auth';

export const documents = pgTable(
  'documents',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => vehicleEvents.id, { onDelete: 'set null' }),

    documentType: documentTypeEnum('document_type').notNull(),
    title: text('title').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    // Lets a re-upload be recognised as the same file, and proves the stored bytes are
    // the ones that were uploaded.
    checksum: text('checksum'),

    issuedOn: date('issued_on'),
    /*
     * Drives the "expiring soon" section of the dashboard. Indexed because that scan runs
     * across every garage on a schedule, not just on demand for one vehicle.
     */
    expiresOn: date('expires_on'),

    notes: text('notes'),
    /*
     * Null until the upload has been confirmed against storage. The row is written when the
     * signed URL is issued — so the storage key comes from an id that is already committed —
     * and a client that abandons the PUT leaves a pending row that every read ignores.
     */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true, mode: 'date' }),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('documents_expires_on_idx').on(table.expiresOn),
    index('documents_type_idx').on(table.vehicleId, table.documentType),
  ],
);
