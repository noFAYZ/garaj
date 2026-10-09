/**
 * Authentication tables (Architecture.md §12).
 *
 * These four are Better Auth's contract — column names and types are fixed by the adapter,
 * so they deliberately break this codebase's naming conventions. Application-owned user
 * data (preferences, units, locale) lives on `userProfiles` instead, so a Better Auth
 * upgrade that touches its own tables cannot collide with product columns.
 */

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, timestamps, updatedAt } from './_shared';
import { distanceUnitEnum, volumeUnitEnum } from './_shared';
import { accountKindEnum, planTierEnum, subscriptionStatusEnum } from './enums';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    idToken: text('id_token'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('accounts_user_id_idx').on(table.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

/**
 * Product-owned settings for a user (PRD §45, §46). Separate from `users` so the auth
 * provider stays swappable: replacing Better Auth rewrites the four tables above and
 * leaves every preference here intact.
 */
export const userProfiles = pgTable('user_profiles', {
  id: primaryId(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  locale: text('locale').notNull().default('en-US'),
  timezone: text('timezone').notNull().default('UTC'),
  defaultCurrency: text('default_currency').notNull().default('USD'),
  distanceUnit: distanceUnitEnum('distance_unit').notNull().default('KM'),
  volumeUnit: volumeUnitEnum('volume_unit').notNull().default('LITER'),
  /*
   * What this person uses the product for. It decides which surfaces they see — trip
   * purpose, income, the driver on a job — and nothing about what they may reach, which is
   * the subscription's business. A preference, so it lives with the preferences.
   */
  accountKind: accountKindEnum('account_kind').notNull().default('PERSONAL'),
  ...timestamps(),
});

/**
 * What a person has paid for (Architecture.md §13, GAPS §10).
 *
 * One row per user, created on the first upgrade — no row is the free plan, which is the
 * common case and not worth a write at sign-up. The provider's ids live here rather than on
 * `users`, because that table is Better Auth's and a column of ours in it is a collision
 * waiting for their next release.
 *
 * `plan` is what was bought; `effectivePlan` in `@vehicle-os/domain` says what it is worth
 * today. Nothing reads `plan` without passing it through that first.
 */
export const subscriptions = pgTable('subscriptions', {
  id: primaryId(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  plan: planTierEnum('plan').notNull().default('FREE'),
  status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
  /*
   * Unique: two users sharing a provider customer means one person's card change silently
   * moves another person's plan, and it is the kind of bug that is only found in billing
   * support. Nullable because a free account has never met the provider.
   */
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  /** When the current paid period ends — what a cancellation counts down to. */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, mode: 'date' }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  ...timestamps(),
});
