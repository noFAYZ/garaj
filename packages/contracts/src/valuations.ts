import { Type, type Static } from '@sinclair/typebox';
import { VALUATION_SOURCES } from '@vehicle-os/domain';
import {
  CurrencyCode,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  PaginationQuery,
  Uuid,
} from './common';

export const ValuationSourceSchema = Type.Union(
  VALUATION_SOURCES.map((source) => Type.Literal(source)),
);
export type ValuationSource = Static<typeof ValuationSourceSchema>;

export const Valuation = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  estimatedValue: MoneyOutput,
  valuationDate: IsoDate,
  source: ValuationSourceSchema,
  /** 0–100. A dealer's written offer and an owner's guess are not the same evidence. */
  confidence: Nullable(Type.Integer({ minimum: 0, maximum: 100 })),
  notes: Nullable(Type.String()),
  createdAt: IsoDateTime,
});
export type Valuation = Static<typeof Valuation>;

export const CreateValuation = Type.Object(
  {
    amountMinor: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    currency: CurrencyCode,
    valuationDate: IsoDate,
    source: Type.Optional(ValuationSourceSchema),
    confidence: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    notes: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export type CreateValuation = Static<typeof CreateValuation>;

export const ListValuationsQuery = PaginationQuery;

export const ValuationParams = Type.Object({ vehicleId: Uuid, valuationId: Uuid });

/**
 * What a vehicle is worth now, against what it cost (PRD §19).
 *
 * `change` is only present when both figures are in the same currency — a gain computed
 * across an exchange rate this application invented would be a number nobody could check.
 */
export const ValuationSummary = Type.Object({
  vehicleId: Uuid,
  purchasePrice: Nullable(MoneyOutput),
  currentValue: Nullable(MoneyOutput),
  currentValueDate: Nullable(IsoDate),
  changeSincePurchase: Nullable(MoneyOutput),
  /** Rounded to one decimal place; null for the same reasons `changeSincePurchase` is. */
  changePercent: Nullable(Type.Number()),
  history: Type.Array(Valuation),
});
export type ValuationSummary = Static<typeof ValuationSummary>;
