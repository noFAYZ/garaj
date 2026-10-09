import { Type, type Static } from '@sinclair/typebox';
import { PASSPORT_SECTIONS, SHARE_SCOPES } from '@vehicle-os/domain';
import {
  DistanceUnit,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  Uuid,
  VehicleTypeSchema,
} from './common';
import { ConditionCategorySchema } from './condition';

export const ShareScopeSchema = Type.Union(SHARE_SCOPES.map((scope) => Type.Literal(scope)));

export const PassportSectionSchema = Type.Union(
  PASSPORT_SECTIONS.map((section) => Type.Literal(section)),
);

export const ShareLink = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  scope: ShareScopeSchema,
  label: Nullable(Type.String()),
  /** What the link discloses beyond identity, mileage and health. */
  sections: Type.Array(PassportSectionSchema),
  expiresAt: Nullable(IsoDateTime),
  revokedAt: Nullable(IsoDateTime),
  viewCount: Type.Integer(),
  lastViewedAt: Nullable(IsoDateTime),
  createdAt: IsoDateTime,
  /**
   * The token, returned only in the response that created the link.
   *
   * The database stores a hash, so this cannot be recovered afterwards — a lost link is
   * replaced, not looked up. Listing links never includes it.
   */
  token: Type.Optional(Type.String()),
});
export type ShareLink = Static<typeof ShareLink>;

export const CreateShareLink = Type.Object(
  {
    label: Type.Optional(Type.String({ maxLength: 120 })),
    /** Days until it stops working. Omitted, the link lasts until it is revoked. */
    expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
    /**
     * Required, not defaulted: what a stranger sees is the owner's decision to make at the
     * moment they make the link, and a default would make it for them. An empty list is valid
     * — identity, mileage and health only.
     */
    sections: Type.Array(PassportSectionSchema, { uniqueItems: true, maxItems: 6 }),
  },
  { additionalProperties: false },
);
export type CreateShareLink = Static<typeof CreateShareLink>;

export const ShareLinkParams = Type.Object({ vehicleId: Uuid, shareId: Uuid });
export const PassportTokenParam = Type.Object({
  token: Type.String({ minLength: 20, maxLength: 200 }),
});

/**
 * The vehicle passport (PRD §23, Architecture.md §35).
 *
 * An allowlist, not a projection of the vehicle. Everything here was chosen to be shown to a
 * stranger holding a link, and the omissions are the point:
 *
 *  - **No people.** No owner, no member names, no email addresses, no "recorded by". Who
 *    maintained a car is not part of the car's history as far as a buyer is concerned, and
 *    it is personal data about someone who never agreed to be published.
 *  - **No document files.** Titles and types only. A registration certificate or an
 *    insurance schedule carries an address, a signature and an identity number, and a
 *    passport that hands those to anyone with the link is an identity-theft kit.
 *  - **No notes fields.** Free text is where people write things they never meant to publish.
 *
 * What *is* here — the VIN, what was spent, what it is worth — is what PRD §23 asks for: the
 * point is to give the next owner a history they can verify against the car in front of them.
 * The owner is told plainly what the link exposes before they create it.
 */
export const VehiclePassport = Type.Object({
  vehicle: Type.Object({
    displayName: Type.String(),
    vehicleType: VehicleTypeSchema,
    make: Nullable(Type.String()),
    model: Nullable(Type.String()),
    variant: Nullable(Type.String()),
    year: Nullable(Type.Integer()),
    color: Nullable(Type.String()),
    identificationNumber: Nullable(Type.String()),
    currentOdometer: Nullable(Type.Integer()),
    odometerUnit: DistanceUnit,
    specs: Type.Record(Type.String(), Type.Unknown()),
    primaryPhotoUrl: Nullable(Type.String()),
  }),

  ownership: Type.Object({
    since: Nullable(IsoDate),
    /** How long the current owner has had it, in whole months. */
    months: Nullable(Type.Integer()),
  }),

  /** What the owner chose to include; a section not listed here is null below, not empty. */
  sections: Type.Array(PassportSectionSchema),

  maintenance: Nullable(
    Type.Object({
      recordCount: Type.Integer(),
      lastServicedAt: Nullable(IsoDateTime),
      /** Every logged service, oldest first — the history a buyer actually wants. */
      history: Type.Array(
        Type.Object({
          title: Type.String(),
          performedAt: IsoDateTime,
          odometer: Nullable(Type.Integer()),
          provider: Nullable(Type.String()),
          /** Null when the link does not include `MAINTENANCE_COSTS`. */
          totalCost: Nullable(MoneyOutput),
        }),
      ),
    }),
  ),

  condition: Nullable(
    Type.Object({
      overallScore: Nullable(Type.Integer()),
      categories: Type.Array(
        Type.Object({
          category: ConditionCategorySchema,
          score: Nullable(Type.Integer()),
          assessedAt: IsoDateTime,
        }),
      ),
    }),
  ),

  /** Types and titles only — never a link to the file itself. */
  documents: Nullable(
    Type.Array(
      Type.Object({
        documentType: Type.String(),
        title: Type.String(),
        issuedOn: Nullable(IsoDate),
        expiresOn: Nullable(IsoDate),
      }),
    ),
  ),

  finances: Nullable(
    Type.Object({
      purchasePrice: Nullable(MoneyOutput),
      totalInvested: Nullable(MoneyOutput),
      currentValue: Nullable(MoneyOutput),
    }),
  ),

  health: Type.Object({
    overall: Nullable(Type.Integer()),
    summary: Type.String(),
  }),

  generatedAt: IsoDateTime,
});
export type VehiclePassport = Static<typeof VehiclePassport>;
