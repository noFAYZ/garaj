/**
 * Usage logs for the admin console: what the paid providers were asked to do, and what came
 * of it. Append-only, one row per event — the console aggregates them by day.
 *
 * `set null` on the user: a deleted account's usage still happened, and the totals would
 * otherwise change retroactively.
 *
 * ponytail: kept forever. At real volume, prune rows older than the console's longest window
 * (90 days) from the scheduler, or roll them up into daily totals first.
 */

import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from './_shared';
import { users } from './auth';
import { notificationChannelEnum, notificationTypeEnum } from './enums';
import { notifications } from './notifications';

/** One question to the model — every turn of its tool loop summed into one row. */
export const aiRequests = pgTable(
  'ai_requests',
  {
    id: primaryId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    /** `ok` or `error`. */
    status: text('status').notNull(),
    turns: integer('turns').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    /** Includes a thinking model's reasoning tokens, which are billed as output. */
    outputTokens: integer('output_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [
    index('ai_requests_created_idx').on(table.createdAt),
    index('ai_requests_user_idx').on(table.userId),
  ],
);

/** One attempt to send a notification over email or push. A retried failure is a row per try. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    notificationType: notificationTypeEnum('notification_type').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    /** `sent` or `failed`. */
    status: text('status').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [index('notification_deliveries_created_idx').on(table.createdAt)],
);
