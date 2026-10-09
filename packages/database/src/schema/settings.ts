/**
 * Deployment-wide settings the admin console changes at runtime — today, feature-flag
 * overrides under the key `flags`. One row per key with a JSON value, because each setting is
 * read whole and there are a handful of them; a column per setting would be a migration per
 * toggle.
 */

import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { updatedAt } from './_shared';
import { users } from './auth';

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});
