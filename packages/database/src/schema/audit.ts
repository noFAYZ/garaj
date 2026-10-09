/**
 * Audit log (Architecture.md §57).
 *
 * Distinct from `vehicle_events`: that table is the vehicle's biography, this one answers
 * "who changed what, and when" — the question that matters in a shared garage after
 * something goes missing. Append-only by convention and by the absence of any update path
 * in the repository; nothing in the application issues an UPDATE or DELETE against it.
 */

import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared';
import { users } from './auth';
import { garages } from './garages';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    // `set null` rather than cascade: deleting a user must not erase the record of what
    // they did, which is the entire point of an audit trail.
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: text('actor_email'),
    garageId: uuid('garage_id').references(() => garages.id, { onDelete: 'set null' }),

    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    // Ties the entry back to the request in the structured logs, and to every other row
    // written by the same transaction.
    requestId: text('request_id'),
    ipAddress: text('ip_address'),

    createdAt: createdAt(),
  },
  (table) => [
    index('audit_logs_garage_created_idx').on(table.garageId, table.createdAt.desc()),
    index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_logs_actor_idx').on(table.actorId, table.createdAt.desc()),
  ],
);
