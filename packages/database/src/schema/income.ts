/**
 * What a vehicle earned (GAPS §14).
 *
 * Its own table rather than a sign on `expenses`. Every cost figure in the product reads that
 * table — `sumByCategory`, the monthly chart, the ownership curve, the fuel consumption — and
 * a negative row in it would have to be excluded by all of them forever. The one query that
 * forgot would report a busy month as a cheap one, and a driver would take that figure to an
 * accountant.
 *
 * Shaped like an expense on purpose: same columns, same names, same odometer. A person logging
 * a fare and a person logging a fill-up should not be filling in two different kinds of form.
 */

import { bigint, char, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { incomeCategoryEnum, recordSourceEnum } from './enums';
import { odometerColumns, primaryId, timestamps } from './_shared';
import { users } from './auth';
import { garageMembers } from './garages';
import { vehicles } from './vehicles';

export const vehicleIncome = pgTable(
  'vehicle_income',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    category: incomeCategoryEnum('category').notNull(),
    description: text('description').notNull(),
    /** Who paid — a platform, a client, an employer. */
    payer: text('payer'),

    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...odometerColumns(),

    /*
     * Which member earned it, for a fleet that pays per driver (`driver.assign`). A membership
     * rather than a user: it is a fact about this garage, and someone who has left should not
     * vanish from last quarter's report — `set null` keeps the row and loses only the name.
     */
    driverId: uuid('driver_id').references(() => garageMembers.id, { onDelete: 'set null' }),

    source: recordSourceEnum('source').notNull().default('USER'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // Every income rollup filters by vehicle and a date window, then groups by category.
    index('vehicle_income_vehicle_occurred_idx').on(table.vehicleId, table.occurredAt.desc()),
    index('vehicle_income_driver_idx').on(table.driverId),
  ],
);
