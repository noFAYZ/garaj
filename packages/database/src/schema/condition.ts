/**
 * Condition assessments (Architecture.md §32).
 *
 * A vehicle's physical state at a point in time, not a running total: each assessment is a
 * snapshot, and the history of them is what makes a before/after comparison possible. Two
 * tables because §32 models it that way — a header carrying when and at what odometer, and
 * one row per category scored, so an assessment that only looked at the tyres says exactly
 * that instead of implying the rest were fine.
 */

import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { conditionCategoryEnum } from './enums';
import { odometerColumns, primaryId, timestamps } from './_shared';
import { vehicles } from './vehicles';
import { users } from './auth';

export const conditionAssessments = pgTable(
  'condition_assessments',
  {
    id: primaryId(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),

    assessedAt: timestamp('assessed_at', { withTimezone: true, mode: 'date' }).notNull(),
    /*
     * The mean of the item scores, written at assessment time rather than derived on read.
     * Unlike a due status, this one does not drift: the items it averages are immutable
     * facts about a moment that has passed, so recomputing it on every read would always
     * give the same answer at the cost of a join.
     */
    overallScore: integer('overall_score'),
    notes: text('notes'),
    ...odometerColumns(),

    assessedBy: uuid('assessed_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (table) => [
    // The condition timeline: one vehicle, newest first.
    index('condition_vehicle_assessed_idx').on(table.vehicleId, table.assessedAt.desc()),
  ],
);

export const conditionItems = pgTable(
  'condition_items',
  {
    id: primaryId(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => conditionAssessments.id, { onDelete: 'cascade' }),

    category: conditionCategoryEnum('category').notNull(),
    /** 0–100. Nullable so "looked at it, could not judge" differs from "did not look". */
    score: integer('score'),
    notes: text('notes'),
    ...timestamps(),
  },
  (table) => [index('condition_items_assessment_idx').on(table.assessmentId)],
);
