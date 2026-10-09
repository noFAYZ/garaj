/**
 * Shared request/response fragments (Architecture.md §10).
 *
 * TypeBox rather than hand-written types: one declaration becomes runtime validation, the
 * OpenAPI document, and the TypeScript type. A separate type declaration would be a second
 * source of truth that compiles fine while disagreeing with the validator.
 */

import { Type, type Static, type TSchema } from '@sinclair/typebox';
import {
  DISTANCE_UNITS,
  EVENT_TYPES,
  EXPENSE_CATEGORIES,
  GARAGE_ROLES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
} from '@vehicle-os/domain';

/**
 * A field that accepts an explicit `null`.
 *
 * `Type.Union([X, Type.Null()])` compiles to `anyOf`, and Ajv's `coerceTypes` — which
 * Fastify needs so `?limit=25` arrives as a number — walks the branches in order and
 * coerces `null` into `""` on the string one. Every "clear this field" in the API silently
 * became an empty string.
 *
 * For a schema with a concrete `type` the fix is a type array: `['string', 'null']` has no
 * branches to walk, so null survives. A union of literals has no `type` to extend, but it
 * also has no plain-string branch for null to be coerced into — every member is a `const` —
 * so the plain union is already safe there and is used unchanged.
 */
export function Nullable<T extends TSchema>(schema: T) {
  const type = (schema as { type?: string }).type;
  if (typeof type !== 'string') {
    return Type.Unsafe<Static<T> | null>(Type.Union([schema, Type.Null()]));
  }
  return Type.Unsafe<Static<T> | null>({ ...schema, type: [type, 'null'] });
}

export const Uuid = Type.String({ format: 'uuid' });

/**
 * A client-chosen primary key, for a record created before the server has heard of it.
 *
 * The phone writes to disk first and sends later (§6.6), so an entry made in a car park needs an
 * identity the moment it exists — later entries may already reference it. Supplying it here makes
 * the create idempotent: the same id sent twice is one record, which is what makes it safe to
 * replay a queue whose acknowledgement was lost.
 *
 * UUIDv7, like the server's own: it leads with a timestamp, so client-made keys keep the index
 * locality the server's ordering depends on.
 */
export const ClientId = Type.Optional(Uuid);
export const IsoDateTime = Type.String({ format: 'date-time' });
export const IsoDate = Type.String({ format: 'date' });

/** ISO 4217. Uppercase-only so `usd` and `USD` cannot become two currencies in a total. */
export const CurrencyCode = Type.String({ pattern: '^[A-Z]{3}$', minLength: 3, maxLength: 3 });

/**
 * Money crosses the wire as minor units, never as a decimal.
 *
 * A JSON number is a double, so `129.99` arrives as 129.99000000000001 often enough to
 * matter. An integer count of cents survives the round trip exactly.
 */
export const MoneyInput = Type.Object(
  {
    amountMinor: Type.Integer({
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    }),
    currency: CurrencyCode,
  },
  { additionalProperties: false },
);
export type MoneyInput = Static<typeof MoneyInput>;

export const MoneyOutput = Type.Object({
  amountMinor: Type.Integer(),
  currency: CurrencyCode,
});

export const DistanceUnit = Type.Union(DISTANCE_UNITS.map((unit) => Type.Literal(unit)));
export const VehicleTypeSchema = Type.Union(VEHICLE_TYPES.map((type) => Type.Literal(type)));
export const VehicleStatusSchema = Type.Union(VEHICLE_STATUSES.map((s) => Type.Literal(s)));
export const GarageRoleSchema = Type.Union(GARAGE_ROLES.map((role) => Type.Literal(role)));
export const EventTypeSchema = Type.Union(EVENT_TYPES.map((type) => Type.Literal(type)));
export const TaskStatusSchema = Type.Union(TASK_STATUSES.map((s) => Type.Literal(s)));
export const TaskPrioritySchema = Type.Union(TASK_PRIORITIES.map((p) => Type.Literal(p)));
export const ExpenseCategorySchema = Type.Union(
  EXPENSE_CATEGORIES.map((category) => Type.Literal(category)),
);

export const PaginationQuery = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
  cursor: Type.Optional(Type.String()),
});

/** Wraps a row schema in the envelope every collection endpoint returns (§101). */
export function Paginated<T extends TSchema>(item: T) {
  return Type.Object({
    data: Type.Array(item),
    pagination: Type.Object({
      nextCursor: Nullable(Type.String()),
      hasMore: Type.Boolean(),
    }),
  });
}

export const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    fields: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
});

/** Attached to every authenticated route so the generated client knows the failure shapes. */
export const StandardErrors = {
  400: ErrorResponse,
  401: ErrorResponse,
  403: ErrorResponse,
  404: ErrorResponse,
  429: ErrorResponse,
  500: ErrorResponse,
} as const;
