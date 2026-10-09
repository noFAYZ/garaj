/**
 * Expenses (Architecture.md §27).
 *
 * Financial records are never soft-deleted — a total that silently changes when a row is
 * hidden is worse than no total (§103). Deleting an expense removes it outright and the
 * removal is written to `audit_logs`.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { expenseCategoryEnum, fuelTypeEnum, recordSourceEnum } from './enums';
import { odometerColumns, primaryId, quantityUnitEnum, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { vehicleEvents } from './events';
import { users } from './auth';

export const expenses = pgTable(
  'expenses',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => vehicleEvents.id, { onDelete: 'set null' }),

    category: expenseCategoryEnum('category').notNull(),
    description: text('description').notNull(),
    vendor: text('vendor'),

    // Amount and currency are both required here, unlike the optional cost on an event:
    // an expense with no amount is not an expense.
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),

    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...odometerColumns(),

    /*
     * Fuel and charging detail. `numeric` rather than a float: litres and kWh are summed
     * into consumption figures, and binary float error compounds across a year of fill-ups.
     */
    // What was actually bought. Nullable and unconstrained by category on purpose: a receipt
    // may be for DEF on a diesel, and an expense from before this column existed says nothing.
    fuelType: fuelTypeEnum('fuel_type'),
    quantity: numeric('quantity', { precision: 12, scale: 4 }),
    quantityUnit: quantityUnitEnum('quantity_unit'),
    energyKwh: numeric('energy_kwh', { precision: 12, scale: 4 }),
    isFullTank: integer('is_full_tank'),

    /*
     * Where it was bought (GAPS §15).
     *
     * `numeric(9,6)` rather than a float: six places is about 10cm, which is more than a fuel
     * stop needs, and a binary float would make the same forecourt two different places on
     * two different devices — so "have I filled up here before" would answer no.
     *
     * Both or neither. A latitude without a longitude is not half a location, it is a number
     * nothing can use, and the check keeps that out of the table rather than out of a form.
     */
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),

    source: recordSourceEnum('source').notNull().default('USER'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // Every cost rollup filters by vehicle and a date window, then groups by category.
    index('expenses_vehicle_occurred_idx').on(table.vehicleId, table.occurredAt.desc()),
    index('expenses_vehicle_category_idx').on(table.vehicleId, table.category),
    check(
      'expenses_location_complete',
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
  ],
);
