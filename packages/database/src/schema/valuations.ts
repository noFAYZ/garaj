/**
 * Valuations (Architecture.md §34).
 *
 * Modelled separately from the purchase price, which lives on the vehicle: the price paid is
 * one fact that never changes, while what a vehicle is worth is a series of estimates, each
 * from a source of its own. Collapsing them into one "current value" column would overwrite
 * the history every time someone looked up a figure, and §34 asks for the history.
 */

import { char, date, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bigint } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './_shared';
import { valuationSourceEnum } from './enums';
import { vehicles } from './vehicles';
import { users } from './auth';

export const valuations = pgTable(
  'valuations',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    // Money as the standard pair (§16): minor units plus the ISO 4217 code.
    estimatedValueAmountMinor: bigint('estimated_value_amount_minor', { mode: 'number' }).notNull(),
    estimatedValueCurrency: char('estimated_value_currency', { length: 3 }).notNull(),

    /** A calendar date: a valuation is "as at" a day, not an instant. */
    valuationDate: date('valuation_date').notNull(),
    source: valuationSourceEnum('source').notNull().default('USER_ESTIMATE'),
    /*
     * 0–100, and nullable. §34 lists confidence because the sources it anticipates — market
     * data, a dealer, an AI estimate — differ in how much they should be trusted, and a
     * number presented without that is a number presented as fact.
     */
    confidence: integer('confidence'),
    notes: text('notes'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // The value chart: one vehicle, in date order.
    index('valuations_vehicle_date_idx').on(table.vehicleId, table.valuationDate.desc()),
  ],
);
