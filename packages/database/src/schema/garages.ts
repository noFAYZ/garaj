/**
 * Garages: the tenant boundary (Architecture.md §14).
 *
 * Every row in the product hangs off a garage, directly or through a vehicle. Membership
 * in `garage_members` is the only thing that grants access — a `garageId` arriving in a
 * request body is an argument to be checked, never evidence of anything.
 */

import { index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { costReportingModeEnum, garageRoleEnum } from './enums';
import { primaryId, timestamps } from './_shared';
import { users } from './auth';

export const garages = pgTable(
  'garages',
  {
    id: primaryId(),
    name: text('name').notNull(),
    description: text('description'),
    // Denormalised from the OWNER membership so "my garages" and ownership transfer are
    // both single-row operations. `garage_members` remains the authorization source.
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    defaultCurrency: text('default_currency').notNull().default('USD'),
    costReporting: costReportingModeEnum('cost_reporting').notNull().default('STRICT'),
    ...timestamps(),
  },
  (table) => [index('garages_owner_id_idx').on(table.ownerId)],
);

export const garageMembers = pgTable(
  'garage_members',
  {
    id: primaryId(),
    garageId: uuid('garage_id')
      .notNull()
      .references(() => garages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: garageRoleEnum('role').notNull().default('MEMBER'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // A second membership row for the same pair would make `roleInGarage` non-deterministic
    // — whichever row the planner returned first would decide the caller's permissions.
    unique('garage_members_garage_user_unique').on(table.garageId, table.userId),
    index('garage_members_user_id_idx').on(table.userId),
  ],
);
