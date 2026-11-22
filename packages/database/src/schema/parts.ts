/**
 * Parts and fluids (PRD §17): every product that went into a vehicle, one row per line.
 *
 * One table, deliberately. Each row keeps the product *as fitted* — brand, name, grade, part
 * number — rather than pointing at a shared catalogue row, so:
 *
 * - a vehicle's history travels with it whole when it moves to another garage, and nothing a
 *   former garage later deletes can take the brand out of it;
 * - the garage's "product library" that the forms offer is a read over these rows (distinct
 *   products, newest first), not a second table to keep in step with this one.
 *
 * A line made with a logbook entry takes its date and reading from that entry through the join,
 * so editing the entry's date moves its parts too. Only a line recorded on its own — "what is
 * fitted now", typed in without an entry — carries a date and reading of its own; the check
 * below keeps the two from ever both being set.
 *
 * What is fitted *now* is never stored: it is the newest replacement per position
 * (`currentParts` in the domain), so a back-dated or deleted entry is reflected at once.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { PART_ACTIONS, PART_UNITS } from '@vehicle-os/domain';
import { distanceUnitEnum, primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { vehicleEvents } from './events';
import { users } from './auth';

export const partActionEnum = pgEnum('part_action', PART_ACTIONS);
export const partUnitEnum = pgEnum('part_unit', PART_UNITS);

export const vehicleParts = pgTable(
  'vehicle_parts',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    // The entry it was fitted with; its lines go when it does.
    eventId: uuid('event_id').references(() => vehicleEvents.id, { onDelete: 'cascade' }),

    // A key of the domain's `PART_POSITIONS`, as text: a new position is not a migration.
    position: text('position').notNull(),
    action: partActionEnum('action').notNull().default('REPLACED'),

    // The product, as fitted. All four may be empty: "the garage did it" still resets the age.
    brand: text('brand'),
    name: text('name'),
    spec: text('spec'),
    partNumber: text('part_number'),

    quantity: numeric('quantity', { precision: 10, scale: 3 }),
    unit: partUnitEnum('unit'),

    // A line's share of the entry's bill, when it was itemised. Not mirrored into expenses: the
    // entry's own cost already is, and counting the line too would spend the money twice.
    costAmountMinor: bigint('cost_amount_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),

    // Only on a line with no entry: when it was fitted, if known, and at what reading.
    fittedAt: timestamp('fitted_at', { withTimezone: true, mode: 'date' }),
    odometer: integer('odometer'),
    odometerUnit: distanceUnitEnum('odometer_unit'),

    // Until when the maker or the shop covers it — a battery's 3 years, a tyre's road hazard.
    warrantyUntil: date('warranty_until'),

    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // The parts view and "what is fitted at this position": one vehicle, by position.
    index('vehicle_parts_vehicle_position_idx').on(table.vehicleId, table.position),
    // The entry screen's lines, and the cascade when an entry is deleted.
    index('vehicle_parts_event_id_idx').on(table.eventId),
    // The daily expiry scan reads only lines that have a warranty at all.
    index('vehicle_parts_warranty_idx')
      .on(table.warrantyUntil)
      .where(sql`${table.warrantyUntil} is not null`),
    check(
      'vehicle_parts_cost_complete',
      sql`(${table.costAmountMinor} is null) = (${table.costCurrency} is null)`,
    ),
    check(
      'vehicle_parts_reading_unit',
      sql`${table.odometer} is null or ${table.odometerUnit} is not null`,
    ),
    // One source for a line's date: its entry's, or its own — never both.
    check(
      'vehicle_parts_dated_once',
      sql`${table.eventId} is null or (${table.fittedAt} is null and ${table.odometer} is null)`,
    ),
  ],
);
