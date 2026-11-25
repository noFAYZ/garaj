import { Type, type Static } from '@sinclair/typebox';
import { PART_ACTIONS, PART_POSITION_KEYS, PART_UNITS } from '@vehicle-os/domain';
import {
  ClientId,
  CurrencyCode,
  DistanceUnit,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  Uuid,
} from './common';

export const PartPositionSchema = Type.Union(PART_POSITION_KEYS.map((key) => Type.Literal(key)));
export const PartActionSchema = Type.Union(PART_ACTIONS.map((action) => Type.Literal(action)));
export const PartUnitSchema = Type.Union(PART_UNITS.map((unit) => Type.Literal(unit)));

const Words = (maxLength: number) => Type.Optional(Nullable(Type.String({ maxLength })));

/**
 * One line of what went in: a product at a position. Sent inside an entry (`CreateEvent.parts`,
 * a completed service's `parts`), so the entry and its lines are one write — offline, they queue
 * and replay together. Every product field is optional: an unknown oil still resets the oil's age.
 */
const lineFields = {
  /** Chosen by the client, so a replayed write lands on the same line. */
  id: ClientId,
  position: PartPositionSchema,
  /** `REPLACED` unless said: a top-up adds without resetting the position's age. */
  action: Type.Optional(PartActionSchema),
  brand: Words(80),
  name: Words(120),
  /** The grade or size: "5W-30", "225/45 R17 94W", "DOT 4". */
  spec: Words(80),
  partNumber: Words(80),
  quantity: Type.Optional(Nullable(Type.Number({ exclusiveMinimum: 0, maximum: 10_000 }))),
  /** Defaults by position: litres for a fluid, pieces for a part. */
  unit: Type.Optional(PartUnitSchema),
  costAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
  costCurrency: Type.Optional(CurrencyCode),
  /** Until when it is covered; the expiry scan says so before it runs out. */
  warrantyUntil: Type.Optional(Nullable(IsoDate)),
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
};

/** When a line on its own was fitted, if known; a line on an entry has the entry's. */
const ownDate = {
  fittedAt: Type.Optional(IsoDateTime),
  odometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
  odometerUnit: Type.Optional(DistanceUnit),
};

export const PartLine = Type.Object(lineFields, { additionalProperties: false });
export type PartLine = Static<typeof PartLine>;

/** At most this many lines on one entry: a full service invoice, not a parts catalogue. */
export const PARTS_PER_ENTRY = 30;
export const PartLines = Type.Array(PartLine, { maxItems: PARTS_PER_ENTRY });

/**
 * Lines recorded on their own: what is fitted now, typed in without an entry, or lines added to
 * an entry after it was saved (`eventId`). A line on its own may say when it was fitted; one on
 * an entry takes the entry's date and reading, and is refused if it brings its own.
 */
export const RecordParts = Type.Object(
  {
    eventId: Type.Optional(Uuid),
    parts: Type.Array(Type.Object({ ...lineFields, ...ownDate }, { additionalProperties: false }), {
      minItems: 1,
      maxItems: PARTS_PER_ENTRY,
    }),
  },
  { additionalProperties: false },
);
export type RecordParts = Static<typeof RecordParts>;

/**
 * A line corrected: the whole line as it should now read — what is left out is cleared. Its
 * position and its entry stay as they were; a part in the wrong place is removed and recorded
 * again, so a history never shows one line under two positions.
 */
const { id: _id, position: _position, ...editable } = lineFields;
export const UpdatePart = Type.Object({ ...editable, ...ownDate }, { additionalProperties: false });
export type UpdatePart = Static<typeof UpdatePart>;

export const VehiclePart = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  /** The entry it was fitted with; null for one recorded on its own. */
  eventId: Nullable(Uuid),
  // A plain string on the way out: an older app must still read a position added after it.
  position: Type.String(),
  action: PartActionSchema,
  brand: Nullable(Type.String()),
  name: Nullable(Type.String()),
  spec: Nullable(Type.String()),
  partNumber: Nullable(Type.String()),
  quantity: Nullable(Type.Number()),
  unit: Nullable(PartUnitSchema),
  cost: Nullable(MoneyOutput),
  /** When it was fitted — its entry's date, or its own. Null when nobody knows. */
  fittedAt: Nullable(IsoDateTime),
  odometer: Nullable(Type.Integer()),
  odometerUnit: Type.Union([DistanceUnit, Type.Null()]),
  warrantyUntil: Nullable(IsoDate),
  notes: Nullable(Type.String()),
  createdAt: IsoDateTime,
});
export type VehiclePart = Static<typeof VehiclePart>;

/** A product the garage has fitted before, as the forms offer it: its last line's details. */
export const PartProduct = Type.Object({
  position: Type.String(),
  brand: Nullable(Type.String()),
  name: Nullable(Type.String()),
  spec: Nullable(Type.String()),
  partNumber: Nullable(Type.String()),
  quantity: Nullable(Type.Number()),
  unit: Nullable(PartUnitSchema),
  lastUsedAt: IsoDateTime,
});
export type PartProduct = Static<typeof PartProduct>;

export const VehicleParts = Type.Object({
  /** Every line, newest first by when it was fitted — `currentParts` reads "now" off this order. */
  data: Type.Array(VehiclePart),
  /** The garage's products, most recently used first, for the forms to offer. */
  products: Type.Array(PartProduct),
});
export type VehicleParts = Static<typeof VehicleParts>;

export const PartParams = Type.Object({ vehicleId: Uuid, partId: Uuid });
