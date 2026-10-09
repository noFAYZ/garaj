import { Type, type Static } from '@sinclair/typebox';
import { TRIP_PURPOSES } from '@vehicle-os/domain';
import {
  ClientId,
  CurrencyCode,
  DistanceUnit,
  EventTypeSchema,
  IsoDateTime,
  MoneyOutput,
  PaginationQuery,
  Uuid,
  Nullable,
} from './common';

export const TripPurposeSchema = Type.Union(TRIP_PURPOSES.map((purpose) => Type.Literal(purpose)));

/**
 * The mileage-log half of a `TRIP` (GAPS §6).
 *
 * Distance and rate are in the event's `odometerUnit`. The rate is stored on the trip rather
 * than looked up: rates change every year, and a report recomputed at today's rate would
 * rewrite every claim already made.
 */
export const Trip = Type.Object({
  purpose: TripPurposeSchema,
  startOdometer: Nullable(Type.Integer()),
  distance: Type.Integer(),
  /** Per one unit of distance. */
  rate: Nullable(MoneyOutput),
  /** `distance × rate`, rounded once. Null without a rate. */
  deduction: Nullable(MoneyOutput),
});
export type Trip = Static<typeof Trip>;

export const TripInput = Type.Object(
  {
    purpose: TripPurposeSchema,
    /** With the event's `odometer` as the end reading, the distance is measured, not typed. */
    startOdometer: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000_000 }))),
    distance: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 100_000 }))),
    // ponytail: whole minor units per distance unit (70¢/mi, 30 ct/km). A regime with a
    // fractional-cent rate would need a decimal string here.
    rateMinor: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000 }))),
    rateCurrency: Type.Optional(Nullable(CurrencyCode)),
  },
  { additionalProperties: false },
);
export type TripInput = Static<typeof TripInput>;

export const VehicleEvent = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  eventType: EventTypeSchema,
  title: Type.String(),
  description: Nullable(Type.String()),
  occurredAt: IsoDateTime,
  odometer: Nullable(Type.Integer()),
  odometerUnit: Type.Union([DistanceUnit, Type.Null()]),
  engineHours: Nullable(Type.Integer()),
  cost: Nullable(MoneyOutput),
  provider: Nullable(Type.String()),
  /** Present on `TRIP` events that were logged with mileage detail. */
  trip: Nullable(Trip),
  source: Type.String(),
  createdBy: Nullable(Uuid),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type VehicleEvent = Static<typeof VehicleEvent>;

const eventFields = {
  /** Chosen by the client when the entry was made offline. */
  id: ClientId,
  eventType: EventTypeSchema,
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  occurredAt: IsoDateTime,
  odometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
  odometerUnit: Type.Optional(DistanceUnit),
  engineHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
  costAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
  costCurrency: Type.Optional(CurrencyCode),
  provider: Type.Optional(Type.String({ maxLength: 200 })),
  /** Only on `eventType: 'TRIP'`. */
  trip: Type.Optional(TripInput),
};

export const CreateEvent = Type.Object(eventFields, { additionalProperties: false });
export type CreateEvent = Static<typeof CreateEvent>;

export const UpdateEvent = Type.Object(
  {
    eventType: Type.Optional(EventTypeSchema),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
    occurredAt: Type.Optional(IsoDateTime),
    odometer: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000_000 }))),
    odometerUnit: Type.Optional(DistanceUnit),
    engineHours: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 1_000_000 }))),
    costAmountMinor: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    costCurrency: Type.Optional(CurrencyCode),
    provider: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    /** Replaces the trip detail whole; `null` removes it. */
    trip: Type.Optional(Nullable(TripInput)),
  },
  { additionalProperties: false },
);
export type UpdateEvent = Static<typeof UpdateEvent>;

export const ListEventsQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    // Repeatable in the query string: `?eventType=MAINTENANCE&eventType=REPAIR`.
    eventType: Type.Optional(
      Type.Union([EventTypeSchema, Type.Array(EventTypeSchema, { maxItems: 20 })]),
    ),
    from: Type.Optional(IsoDateTime),
    to: Type.Optional(IsoDateTime),
  }),
]);
export type ListEventsQuery = Static<typeof ListEventsQuery>;

export const EventParams = Type.Object({ vehicleId: Uuid, eventId: Uuid });

/**
 * A create/update can succeed while still being worth a word to the user — most often an
 * odometer reading lower than the previous one. Refusing the write would leave someone
 * unable to record a legitimate cluster replacement, so it is reported, not rejected.
 */
export const EventWithWarnings = Type.Object({
  event: VehicleEvent,
  warnings: Type.Array(
    Type.Object({
      code: Type.String(),
      message: Type.String(),
    }),
  ),
});
export type EventWithWarnings = Static<typeof EventWithWarnings>;

export const MileageReportQuery = Type.Object({
  from: IsoDateTime,
  to: IsoDateTime,
  format: Type.Optional(Type.Union([Type.Literal('json'), Type.Literal('csv')])),
});
export type MileageReportQuery = Static<typeof MileageReportQuery>;

/**
 * Trips in a period, for a tax return or an expense claim.
 *
 * Totals per purpose, and deductions per currency — never summed across currencies, and
 * always from the rate stored on each trip.
 */
export const MileageReport = Type.Object({
  vehicleId: Uuid,
  from: IsoDateTime,
  to: IsoDateTime,
  distanceUnit: DistanceUnit,
  totals: Type.Object({
    BUSINESS: Type.Integer(),
    PERSONAL: Type.Integer(),
    COMMUTE: Type.Integer(),
  }),
  deductions: Type.Array(MoneyOutput),
  /** Business trips with no rate: counted in the distance, missing from the deduction. */
  unratedBusinessTrips: Type.Integer(),
  trips: Type.Array(
    Type.Object({
      eventId: Uuid,
      occurredAt: IsoDateTime,
      title: Type.String(),
      description: Nullable(Type.String()),
      trip: Trip,
    }),
  ),
});
export type MileageReport = Static<typeof MileageReport>;
