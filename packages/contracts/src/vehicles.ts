import { Type, type Static } from '@sinclair/typebox';
import {
  ClientId,
  CurrencyCode,
  DistanceUnit,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  PaginationQuery,
  Uuid,
  VehicleStatusSchema,
  VehicleTypeSchema,
  Nullable,
} from './common';

/**
 * Type-specific fields (Architecture.md §19). Free-form on the wire, then validated against
 * the vehicle type's capability field set server-side — the schema cannot express "valid
 * keys depend on another property's value" without a ten-branch discriminated union that
 * would have to be regenerated every time a field is added.
 */
const Specs = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
);

export const VehiclePhoto = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  eventId: Nullable(Uuid),
  /** Set when the photo is evidence for a condition assessment — the scratch, the tyre wear. */
  conditionAssessmentId: Nullable(Uuid),
  url: Nullable(Type.String()),
  /**
   * What a card should show: the background-removed cutout where one exists, otherwise the
   * original. Never the other way round — a photo with no cutout is still a thumbnail.
   */
  thumbnailUrl: Nullable(Type.String()),
  /** True when `thumbnailUrl` is a cutout, which is drawn contained rather than cropped. */
  isCutout: Type.Boolean(),
  mimeType: Type.String(),
  sizeBytes: Type.Integer(),
  width: Nullable(Type.Integer()),
  height: Nullable(Type.Integer()),
  caption: Nullable(Type.String()),
  category: Nullable(Type.String()),
  capturedAt: Nullable(IsoDate),
  createdAt: IsoDateTime,
});
export type VehiclePhoto = Static<typeof VehiclePhoto>;

export const Vehicle = Type.Object({
  id: Uuid,
  garageId: Uuid,
  vehicleType: VehicleTypeSchema,
  status: VehicleStatusSchema,

  nickname: Nullable(Type.String()),
  make: Nullable(Type.String()),
  model: Nullable(Type.String()),
  variant: Nullable(Type.String()),
  year: Nullable(Type.Integer()),
  color: Nullable(Type.String()),
  /** A label built from nickname, or year/make/model — whatever the vehicle actually has. */
  displayName: Type.String(),

  identificationNumber: Nullable(Type.String()),
  registrationIdentifier: Nullable(Type.String()),

  purchaseDate: Nullable(IsoDate),
  purchasePrice: Nullable(MoneyOutput),

  currentOdometer: Nullable(Type.Integer()),
  odometerUnit: DistanceUnit,
  currentEngineHours: Nullable(Type.Integer()),

  primaryPhoto: Nullable(VehiclePhoto),
  specs: Specs,
  /** What this type supports, so a client can render only the sections that apply. */
  capabilities: Type.Array(Type.String()),

  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Vehicle = Static<typeof Vehicle>;

export const CreateVehicle = Type.Object(
  {
    /** Chosen by the client when the vehicle was added offline. */
    id: ClientId,
    garageId: Uuid,
    vehicleType: VehicleTypeSchema,
    nickname: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    make: Type.Optional(Type.String({ maxLength: 120 })),
    model: Type.Optional(Type.String({ maxLength: 120 })),
    variant: Type.Optional(Type.String({ maxLength: 120 })),
    // Upper bound is next year, not this one: people register a model year before it ends.
    year: Type.Optional(Type.Integer({ minimum: 1885, maximum: 2100 })),
    color: Type.Optional(Type.String({ maxLength: 60 })),
    identificationNumber: Type.Optional(Type.String({ maxLength: 64 })),
    registrationIdentifier: Type.Optional(Type.String({ maxLength: 32 })),
    purchaseDate: Type.Optional(IsoDate),
    purchasePriceAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
    purchasePriceCurrency: Type.Optional(CurrencyCode),
    currentOdometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    odometerUnit: Type.Optional(DistanceUnit),
    currentEngineHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
    specs: Type.Optional(Specs),
  },
  { additionalProperties: false },
);
export type CreateVehicle = Static<typeof CreateVehicle>;

/**
 * `vehicleType` is absent on purpose: changing it would invalidate every spec field and
 * every maintenance plan attached to the vehicle. Deleting and recreating is the honest
 * operation, and it makes the data loss visible instead of silent.
 */
export const UpdateVehicle = Type.Object(
  {
    nickname: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
    make: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
    model: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
    variant: Type.Optional(Nullable(Type.String({ maxLength: 120 }))),
    year: Type.Optional(Nullable(Type.Integer({ minimum: 1885, maximum: 2100 }))),
    color: Type.Optional(Nullable(Type.String({ maxLength: 60 }))),
    status: Type.Optional(VehicleStatusSchema),
    identificationNumber: Type.Optional(Nullable(Type.String({ maxLength: 64 }))),
    registrationIdentifier: Type.Optional(Nullable(Type.String({ maxLength: 32 }))),
    purchaseDate: Type.Optional(Nullable(IsoDate)),
    purchasePriceAmountMinor: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    purchasePriceCurrency: Type.Optional(CurrencyCode),
    currentOdometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    odometerUnit: Type.Optional(DistanceUnit),
    currentEngineHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
    /** Merged into the existing specs; send `null` for a key to clear it. */
    specs: Type.Optional(Specs),
    primaryPhotoId: Type.Optional(Nullable(Uuid)),
  },
  { additionalProperties: false },
);
export type UpdateVehicle = Static<typeof UpdateVehicle>;

export const ListVehiclesQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    garageId: Type.Optional(Uuid),
    vehicleType: Type.Optional(VehicleTypeSchema),
    status: Type.Optional(VehicleStatusSchema),
  }),
]);
export type ListVehiclesQuery = Static<typeof ListVehiclesQuery>;

export const VehicleIdParam = Type.Object({ vehicleId: Uuid });

/** Drives the "add vehicle" form: which fields exist for a type, and how to render them. */
export const SpecFieldSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  kind: Type.Union([
    Type.Literal('text'),
    Type.Literal('number'),
    Type.Literal('integer'),
    Type.Literal('select'),
  ]),
  unit: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String())),
  max: Type.Optional(Type.Number()),
});

export const VehicleTypeDescriptor = Type.Object({
  vehicleType: VehicleTypeSchema,
  capabilities: Type.Array(Type.String()),
  specFields: Type.Array(SpecFieldSchema),
  primaryUsageMeter: Type.Union([
    Type.Literal('odometer'),
    Type.Literal('engineHours'),
    Type.Null(),
  ]),
});
export type VehicleTypeDescriptor = Static<typeof VehicleTypeDescriptor>;

// --- Photos -----------------------------------------------------------------

export const RequestPhotoUpload = Type.Object(
  {
    filename: Type.String({ minLength: 1, maxLength: 255 }),
    mimeType: Type.String({ pattern: '^image/(jpeg|png|webp|heic|heif|avif)$' }),
    sizeBytes: Type.Integer({ minimum: 1, maximum: 25 * 1024 * 1024 }),
  },
  { additionalProperties: false },
);
export type RequestPhotoUpload = Static<typeof RequestPhotoUpload>;

export const PhotoUploadTicket = Type.Object({
  photoId: Uuid,
  uploadUrl: Type.String(),
  storageKey: Type.String(),
  expiresInSeconds: Type.Integer(),
});
export type PhotoUploadTicket = Static<typeof PhotoUploadTicket>;

export const FinalizePhotoUpload = Type.Object(
  {
    caption: Type.Optional(Type.String({ maxLength: 500 })),
    category: Type.Optional(Type.String({ maxLength: 60 })),
    capturedAt: Type.Optional(IsoDate),
    eventId: Type.Optional(Uuid),
    conditionAssessmentId: Type.Optional(Uuid),
    /** Opt-in per photo. EXIF location is discarded unless this is explicitly true (§31). */
    shareLocation: Type.Optional(Type.Boolean()),
    setAsPrimary: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type FinalizePhotoUpload = Static<typeof FinalizePhotoUpload>;

export const PhotoParams = Type.Object({ vehicleId: Uuid, photoId: Uuid });

export const DecodeVinRequest = Type.Object(
  { vin: Type.String({ minLength: 11, maxLength: 32 }) },
  { additionalProperties: false },
);
export type DecodeVinRequest = Static<typeof DecodeVinRequest>;

/**
 * What a VIN says about a vehicle — candidates for a form, never written anywhere.
 *
 * `decoded: false` is a normal answer: the provider is US-market, and a European or Japanese
 * VIN often decodes to nothing. The client keeps the manual form in that case rather than
 * showing an error, and never overwrites a field the person has already typed.
 */
export const VinDecodeResult = Type.Object({
  vin: Type.String(),
  decoded: Type.Boolean(),
  make: Nullable(Type.String()),
  model: Nullable(Type.String()),
  year: Nullable(Type.Integer()),
  variant: Nullable(Type.String()),
  specs: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
  warning: Nullable(Type.String()),
});
export type VinDecodeResult = Static<typeof VinDecodeResult>;
