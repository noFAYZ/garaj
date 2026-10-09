/**
 * Personal API keys: how a script, an integration or an AI client (over MCP) acts as a user
 * without that user's password or session.
 *
 * Only a SHA-256 of the key is stored. The key is 32 random bytes, so a fast hash is enough — a
 * slow one protects low-entropy passwords from guessing, and there is nothing here to guess —
 * and a database leak yields nothing that can be sent as a credential. `prefix` is the visible
 * start of the key, so a person can tell their keys apart in a list.
 *
 * Revoked keys are kept, with `revoked_at` set, so an audit row that names one still resolves.
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared';
import { users } from './auth';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (table) => [index('api_keys_user_idx').on(table.userId)],
);
