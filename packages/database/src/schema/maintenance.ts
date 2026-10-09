/**
 * Maintenance (Architecture.md §22, §23).
 *
 * Two distinct concepts, deliberately two tables: a *plan* says when something becomes due,
 * a *record* says it was done. Merging them loses the schedule the moment a service is
 * logged, and it is the schedule that drives every reminder.
 */

import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { recordSourceEnum, taskPriorityEnum } from './enums';
import { distanceUnitEnum, odometerColumns, primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { vehicleEvents } from './events';
import { users } from './auth';

export const maintenancePlans = pgTable(
  'maintenance_plans',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),
    priority: taskPriorityEnum('priority').notNull().default('MEDIUM'),

    /*
     * Compound intervals: any subset may be set, and the earliest condition to arrive wins
     * ("every 10,000 km OR every 12 months, whichever comes first"). All-null means a
     * one-off item with an explicit due date and no recurrence.
     */
    intervalDistance: integer('interval_distance'),
    intervalDistanceUnit: distanceUnitEnum('interval_distance_unit'),
    intervalMonths: integer('interval_months'),
    intervalEngineHours: integer('interval_engine_hours'),

    // Denormalised from the newest record so the "what is due" query does not need a
    // correlated subquery per plan. Recomputed inside the transaction that logs a record.
    lastPerformedAt: timestamp('last_performed_at', { withTimezone: true, mode: 'date' }),
    lastPerformedOdometer: integer('last_performed_odometer'),
    lastPerformedEngineHours: integer('last_performed_engine_hours'),

    nextDueDate: date('next_due_date'),
    nextDueOdometer: integer('next_due_odometer'),
    nextDueEngineHours: integer('next_due_engine_hours'),

    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (table) => [
    index('maintenance_plans_vehicle_id_idx').on(table.vehicleId),
    // Drives the reminder scan: active plans ordered by when they come due.
    index('maintenance_plans_due_idx').on(table.isActive, table.nextDueDate),
  ],
);

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    // Null for an unscheduled repair that was never on a plan — those still belong in
    // maintenance history.
    planId: uuid('plan_id').references(() => maintenancePlans.id, { onDelete: 'set null' }),
    // Every record surfaces on the timeline; the event row is created in the same
    // transaction, so a record can never exist without its timeline entry.
    eventId: uuid('event_id').references(() => vehicleEvents.id, { onDelete: 'set null' }),

    title: text('title').notNull(),
    workPerformed: text('work_performed'),
    notes: text('notes'),
    provider: text('provider'),

    performedAt: timestamp('performed_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...odometerColumns(),

    partsCostAmountMinor: bigint('parts_cost_amount_minor', { mode: 'number' }),
    laborCostAmountMinor: bigint('labor_cost_amount_minor', { mode: 'number' }),
    totalCostAmountMinor: bigint('total_cost_amount_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),

    nextRecommendedDate: date('next_recommended_date'),
    nextRecommendedOdometer: integer('next_recommended_odometer'),

    source: recordSourceEnum('source').notNull().default('USER'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    index('maintenance_records_vehicle_idx').on(table.vehicleId, table.performedAt.desc()),
    index('maintenance_records_plan_idx').on(table.planId, table.performedAt.desc()),
  ],
);
