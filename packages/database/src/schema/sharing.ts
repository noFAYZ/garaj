/**
 * Share links (Architecture.md §35, PRD §23).
 *
 * A revocable, optionally expiring link that lets somebody without an account read one
 * vehicle's passport. This is the only path in the system that authenticates by URL rather
 * than by session, so the rules around it are deliberately narrow: one vehicle, one scope,
 * and a token the database does not store.
 */

import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { shareScopeEnum } from './enums';
import { primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { users } from './auth';

export const shareLinks = pgTable(
  'share_links',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    /*
     * The SHA-256 of the token, never the token itself.
     *
     * The token is a bearer credential: whoever holds it can read the passport. Storing it
     * in plain text means a database dump — or a stray log line, or a support engineer with
     * read access — hands over every live link at once. The plaintext is returned exactly
     * once, at creation, and cannot be recovered afterwards; a lost link is replaced, not
     * looked up.
     */
    tokenHash: text('token_hash').notNull().unique(),

    scope: shareScopeEnum('scope').notNull().default('VEHICLE_PASSPORT'),
    label: text('label'),

    /*
     * What this link discloses (`PASSPORT_SECTIONS`). Stored per link, not per vehicle: the
     * buyer's link and the mechanic's link are different decisions. Existing links default to
     * everything, which is what they already showed when they were created.
     */
    sections: text('sections')
      .array()
      .notNull()
      .default(
        sql`ARRAY['IDENTIFICATION_NUMBER','MAINTENANCE','MAINTENANCE_COSTS','CONDITION','DOCUMENTS','FINANCES']::text[]`,
      ),

    /** Null means it does not expire on its own. Revocation always works regardless. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),

    // So the owner can see whether the link was ever opened, and when it last was.
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true, mode: 'date' }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [index('share_links_vehicle_idx').on(table.vehicleId)],
);
