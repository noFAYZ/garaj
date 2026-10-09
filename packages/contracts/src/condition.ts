import { Type, type Static } from '@sinclair/typebox';
import { CONDITION_CATEGORIES } from '@vehicle-os/domain';
import { DistanceUnit, IsoDateTime, Nullable, PaginationQuery, Uuid } from './common';

export const ConditionCategorySchema = Type.Union(
  CONDITION_CATEGORIES.map((category) => Type.Literal(category)),
);
export type ConditionCategory = Static<typeof ConditionCategorySchema>;

/** 0–100, like every other score in the product, so one scale is learned rather than three. */
const Score = Type.Integer({ minimum: 0, maximum: 100 });

export const ConditionItem = Type.Object({
  category: ConditionCategorySchema,
  /** Null means "looked at, could not judge" — distinct from a category left out entirely. */
  score: Nullable(Score),
  notes: Nullable(Type.String()),
});
export type ConditionItem = Static<typeof ConditionItem>;

export const ConditionAssessment = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  assessedAt: IsoDateTime,
  /** The mean of the scored items, as it stood at the time. */
  overallScore: Nullable(Score),
  notes: Nullable(Type.String()),
  odometer: Nullable(Type.Integer()),
  odometerUnit: Nullable(DistanceUnit),
  items: Type.Array(ConditionItem),
  createdAt: IsoDateTime,
});
export type ConditionAssessment = Static<typeof ConditionAssessment>;

export const CreateConditionAssessment = Type.Object(
  {
    assessedAt: IsoDateTime,
    notes: Type.Optional(Type.String({ maxLength: 5000 })),
    odometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    odometerUnit: Type.Optional(DistanceUnit),
    /*
     * At least one item. An assessment that scored nothing records that somebody looked and
     * says nothing about what they found, which is not a snapshot of anything.
     */
    items: Type.Array(
      Type.Object(
        {
          category: ConditionCategorySchema,
          score: Type.Optional(Score),
          notes: Type.Optional(Type.String({ maxLength: 2000 })),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: CONDITION_CATEGORIES.length },
    ),
  },
  { additionalProperties: false },
);
export type CreateConditionAssessment = Static<typeof CreateConditionAssessment>;

/**
 * A correction. `items`, when sent, replaces the whole set rather than merging into it —
 * otherwise there would be no way to take back a category that was never really looked at.
 */
export const UpdateConditionAssessment = Type.Partial(CreateConditionAssessment, {
  additionalProperties: false,
});
export type UpdateConditionAssessment = Static<typeof UpdateConditionAssessment>;

export const ListConditionQuery = PaginationQuery;

export const ConditionParams = Type.Object({ vehicleId: Uuid, assessmentId: Uuid });

/**
 * The latest score per category, across assessments.
 *
 * A vehicle's current condition is not one assessment — the tyres may have been checked last
 * week and the frame two years ago. This takes the most recent score for each category and
 * says how old it is, so a stale judgement is visible as stale rather than passed off as
 * current.
 */
export const ConditionSummary = Type.Object({
  vehicleId: Uuid,
  overallScore: Nullable(Score),
  categories: Type.Array(
    Type.Object({
      category: ConditionCategorySchema,
      score: Nullable(Score),
      notes: Nullable(Type.String()),
      assessedAt: IsoDateTime,
      /** How long ago that category was last looked at. */
      ageDays: Type.Integer(),
    }),
  ),
  assessmentCount: Type.Integer(),
});
export type ConditionSummary = Static<typeof ConditionSummary>;
