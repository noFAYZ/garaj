/**
 * Tasks and ideas (Architecture.md §24, §25).
 *
 * A task is committed work; an idea is a maybe. They are separate tables because an idea
 * has a research/ordered lifecycle a task does not, and because mixing them makes the task
 * list — the screen people actually act from — noisy with wishes.
 */

import {
  bigint,
  char,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { ideaStatusEnum, taskCategoryEnum, taskPriorityEnum, taskStatusEnum } from './enums';
import { deletedAt, primaryId, timestamps } from './_shared';
import { garages } from './garages';
import { vehicles } from './vehicles';
import { maintenancePlans } from './maintenance';
import { users } from './auth';

export const tasks = pgTable(
  'tasks',
  {
    id: primaryId(),
    // A task belongs to the garage even when it names no vehicle ("call the insurer"), so
    // the garage id is here rather than reached through a nullable vehicle.
    garageId: uuid('garage_id')
      .notNull()
      .references(() => garages.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'cascade' }),
    maintenancePlanId: uuid('maintenance_plan_id').references(() => maintenancePlans.id, {
      onDelete: 'set null',
    }),

    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('TODO'),
    priority: taskPriorityEnum('priority').notNull().default('MEDIUM'),
    category: taskCategoryEnum('category').notNull().default('MAINTENANCE'),

    dueDate: date('due_date'),
    // "Replace the rear tyre by 45,000 km" — a deadline that has nothing to do with dates.
    dueOdometer: integer('due_odometer'),

    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),

    estimatedCostAmountMinor: bigint('estimated_cost_amount_minor', { mode: 'number' }),
    actualCostAmountMinor: bigint('actual_cost_amount_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),

    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // The task centre: open work for a garage, soonest first.
    index('tasks_garage_status_due_idx').on(table.garageId, table.status, table.dueDate),
    index('tasks_vehicle_idx').on(table.vehicleId),
    index('tasks_assignee_idx').on(table.assigneeId, table.status),
  ],
);

export const ideas = pgTable(
  'ideas',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    title: text('title').notNull(),
    description: text('description'),
    status: ideaStatusEnum('status').notNull().default('IDEA'),

    estimatedCostAmountMinor: bigint('estimated_cost_amount_minor', { mode: 'number' }),
    costCurrency: char('cost_currency', { length: 3 }),
    referenceUrl: text('reference_url'),

    // Set when the idea graduates into committed work, keeping the plan-to-history bridge
    // §25 describes traceable in both directions.
    promotedTaskId: uuid('promoted_task_id').references(() => tasks.id, { onDelete: 'set null' }),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (table) => [index('ideas_vehicle_status_idx').on(table.vehicleId, table.status)],
);
