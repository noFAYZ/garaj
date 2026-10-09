import { Type, type Static } from '@sinclair/typebox';
import { INCOME_CATEGORIES } from '@vehicle-os/domain';
import {
  CurrencyCode,
  DistanceUnit,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  Paginated,
  PaginationQuery,
  Uuid,
} from './common';

export const IncomeCategorySchema = Type.Union(
  INCOME_CATEGORIES.map((category) => Type.Literal(category)),
);

/**
 * What a vehicle earned (GAPS §14).
 *
 * Shaped like an expense deliberately — same fields, same names, same odometer — because a
 * person logging a fare and a person logging a fill-up should not be learning two forms.
 * Stored in its own table, so no cost figure in the product can ever accidentally net against
 * it (see `schema/income.ts`).
 */
export const Income = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  category: IncomeCategorySchema,
  description: Type.String(),
  /** Who paid — a platform, a client, an employer. */
  payer: Nullable(Type.String()),
  amount: MoneyOutput,
  occurredAt: IsoDateTime,
  odometer: Nullable(Type.Integer()),
  odometerUnit: Nullable(DistanceUnit),
  /** The membership that earned it, where a fleet tracks per driver. */
  driverId: Nullable(Uuid),
  driverName: Nullable(Type.String()),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Income = Static<typeof Income>;

export const CreateIncome = Type.Object(
  {
    category: IncomeCategorySchema,
    description: Type.String({ minLength: 1, maxLength: 500 }),
    payer: Type.Optional(Type.String({ maxLength: 200 })),
    amountMinor: Type.Integer({ minimum: 0 }),
    currency: CurrencyCode,
    occurredAt: IsoDateTime,
    odometer: Type.Optional(Type.Integer({ minimum: 0 })),
    odometerUnit: Type.Optional(DistanceUnit),
    driverId: Type.Optional(Uuid),
  },
  { additionalProperties: false },
);
export type CreateIncome = Static<typeof CreateIncome>;

/** Every field optional; an omitted one is left alone, never reset. */
export const UpdateIncome = Type.Partial(CreateIncome, { additionalProperties: false });
export type UpdateIncome = Static<typeof UpdateIncome>;

export const IncomeList = Paginated(Income);
export type IncomeList = Static<typeof IncomeList>;

export const IncomeQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    from: Type.Optional(IsoDateTime),
    to: Type.Optional(IsoDateTime),
    category: Type.Optional(IncomeCategorySchema),
    driverId: Type.Optional(Uuid),
  }),
]);
export type IncomeQuery = Static<typeof IncomeQuery>;

/**
 * Earned against spent, for a vehicle that is someone's work.
 *
 * `net` may be negative, and is reported as such rather than floored at zero: a month that
 * cost more than it earned is the single most useful thing this figure can tell anyone.
 *
 * One currency, the cost summary's own, with everything paid in another left out and counted
 * separately — the same rule every other total here follows, for the same reason.
 */
export const IncomeSummary = Type.Object({
  vehicleId: Uuid,
  currency: CurrencyCode,
  totalEarned: MoneyOutput,
  /** From the cost summary, so profit and cost can never be two different answers. */
  totalSpent: MoneyOutput,
  /** Earned minus spent. Negative when the vehicle has cost more than it has made. */
  netMinor: Type.Integer(),
  byCategory: Type.Array(
    Type.Object({
      category: IncomeCategorySchema,
      amountMinor: Type.Integer(),
      count: Type.Integer(),
    }),
  ),
  /** Per driver, for a fleet. Empty where nothing names one. */
  byDriver: Type.Array(
    Type.Object({
      driverId: Uuid,
      driverName: Nullable(Type.String()),
      amountMinor: Type.Integer(),
      count: Type.Integer(),
    }),
  ),
  /** Earned per unit of distance covered in the window, where the readings allow it. */
  earnedPerDistance: Nullable(MoneyOutput),
  distanceUnit: DistanceUnit,
  /** Sums per currency for everything the figures above had to exclude. */
  otherCurrencies: Type.Array(
    Type.Object({ currency: CurrencyCode, amountMinor: Type.Integer(), count: Type.Integer() }),
  ),
});
export type IncomeSummary = Static<typeof IncomeSummary>;
