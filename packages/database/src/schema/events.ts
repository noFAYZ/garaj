/**
 * The vehicle timeline (Architecture.md §20, §21).
 *
 * This is a *product history* table, not an event-sourcing log: rows describe what happened
 * to the vehicle, they are editable, and no application state is rebuilt by replaying them.
 * Internal software messages live in `outbox_messages`; security records live in
 * `audit_logs`. Conflating the three is how a timeline ends up full of `USER_LOGGED_IN`.
 */

import { bigint, char, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { eventTypeEnum, recordSourceEnum, tripPurposeEnum } from './enums';
import { odometerColumns, primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { users } from './auth';

export const vehicleEvents = pgTable(
  'vehicle_events',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    eventType: eventTypeEnum('event_type').notNull(),
    title: text('title').notNull(),
    description: text('description'),

    // When it happened, which is not when it was recorded. A service entered three weeks
    // late belongs at its real position on the timeline.
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...odometerColumns(),

    costAmountMinor: bigint('cost_amount_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),

    provider: text('provider'),

    /*
     * Mileage-log detail, set only on `TRIP` events (GAPS §6). The distance is stored even
     * when it was measured from readings, so a later correction to the end reading cannot
     * silently change a claim already filed. The rate is stored for the same reason: rates
     * change yearly, and a total recomputed at today's rate rewrites history.
     * Distance and rate are in the event's `odometer_unit`.
     */
    tripPurpose: tripPurposeEnum('trip_purpose'),
    tripStartOdometer: integer('trip_start_odometer'),
    tripDistance: integer('trip_distance'),
    mileageRateMinor: bigint('mileage_rate_minor', { mode: 'number' }),
    mileageRateCurrency: char('mileage_rate_currency', { length: 3 }),

    source: recordSourceEnum('source').notNull().default('USER'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // The timeline query: one vehicle, newest first. Descending matches the read order so
    // Postgres can walk the index instead of sorting the result.
    index('vehicle_events_vehicle_occurred_idx').on(table.vehicleId, table.occurredAt.desc()),
    index('vehicle_events_vehicle_type_idx').on(table.vehicleId, table.eventType),
    index('vehicle_events_occurred_at_idx').on(table.occurredAt.desc()),
  ],
);
