import { Type, type Static } from '@sinclair/typebox';
import { IsoDateTime, Nullable, Uuid } from './common';

/**
 * The categories health is scored in (Architecture.md §33, §80).
 *
 * Only what the system can actually observe. `CONDITION` arrived with condition tracking and
 * carries the recorded physical state; §33 also names mechanical, exterior, interior and
 * electrical individually, and those now exist as condition *categories* rather than as
 * separate health scores — one axis per kind of evidence, not one per noun.
 *
 * Diagnostics and telemetry are still absent, so nothing here pretends to score them.
 */
export const HealthCategorySchema = Type.Union([
  Type.Literal('MAINTENANCE'),
  Type.Literal('TASKS'),
  Type.Literal('DOCUMENTATION'),
  Type.Literal('CONDITION'),
]);
export type HealthCategory = Static<typeof HealthCategorySchema>;

export const HealthCategoryScore = Type.Object({
  category: HealthCategorySchema,
  /** Null when there is nothing to judge — no plans, no documents, no tasks. */
  score: Nullable(Type.Integer({ minimum: 0, maximum: 100 })),
  /** What the score was computed from, so "82" is never the whole answer. */
  basis: Type.String(),
});

/**
 * One reason the score is not 100.
 *
 * `§33`: "the user should be able to understand why the score changed". A factor names the
 * thing, the vehicle-relative detail and what it cost, so the arithmetic is reproducible by
 * hand rather than taken on trust.
 */
export const HealthFactor = Type.Object({
  category: HealthCategorySchema,
  label: Type.String(),
  detail: Type.String(),
  /** Points deducted. Always positive; it is a deduction, not a signed adjustment. */
  penalty: Type.Integer({ minimum: 0 }),
});
export type HealthFactor = Static<typeof HealthFactor>;

export const VehicleHealth = Type.Object({
  vehicleId: Uuid,
  /** Null when no category could be assessed — an honest "not enough information yet". */
  overall: Nullable(Type.Integer({ minimum: 0, maximum: 100 })),
  categories: Type.Array(HealthCategoryScore),
  factors: Type.Array(HealthFactor),
  /** One sentence a person can read without decoding the numbers. */
  summary: Type.String(),
  /** Derived on read, never stored — it changes as the calendar moves (§23). */
  calculatedAt: IsoDateTime,
});
export type VehicleHealth = Static<typeof VehicleHealth>;
