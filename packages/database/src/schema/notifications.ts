/**
 * Notifications (Architecture.md §36, PRD §31).
 *
 * "Contextual rather than noisy" is enforced by `dedupeKey`: a maintenance item that stays
 * overdue for six weeks produces one notification, not forty-two, because the scheduled
 * scan and every worker retry converge on the same key.
 */

import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { notificationChannelEnum, notificationTypeEnum } from './enums';
import { primaryId, timestamps } from './_shared';
import { users } from './auth';
import { garages } from './garages';
import { vehicles } from './vehicles';

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    garageId: uuid('garage_id').references(() => garages.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),

    notificationType: notificationTypeEnum('notification_type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),

    /*
     * The idempotency key for delivery (§39). Derived from the subject and the period it
     * covers — e.g. `MAINTENANCE_DUE:{planId}:{dueOdometer}` — so a retried job re-inserts
     * the same key and is rejected by the unique constraint instead of notifying twice.
     */
    dedupeKey: text('dedupe_key').notNull(),

    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    unique('notifications_user_dedupe_unique').on(table.userId, table.dedupeKey),
    index('notifications_user_unread_idx').on(table.userId, table.readAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationType: notificationTypeEnum('notification_type').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    unique('notification_preferences_unique').on(
      table.userId,
      table.notificationType,
      table.channel,
    ),
  ],
);

/**
 * Where push notifications go (Architecture.md §36).
 *
 * One row per installed app, not per user: a person with a phone and a tablet gets the
 * reminder on both. The token is unique on its own because the platform issues it per
 * install — a phone handed to someone else and signed into their account re-registers the
 * same token, and that registration moves the row to its new owner rather than leaving the
 * previous one receiving their reminders.
 */
export const deviceTokens = pgTable(
  'device_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('device_tokens_token_unique').on(table.token),
    index('device_tokens_user_idx').on(table.userId),
  ],
);
