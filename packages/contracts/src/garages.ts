import { Type, type Static } from '@sinclair/typebox';
import { COST_REPORTING_MODES } from '@vehicle-os/domain';
import { CurrencyCode, GarageRoleSchema, IsoDateTime, Nullable, Uuid } from './common';

export const CostReportingModeSchema = Type.Union(
  COST_REPORTING_MODES.map((mode) => Type.Literal(mode)),
);

export const Garage = Type.Object({
  id: Uuid,
  name: Type.String(),
  description: Nullable(Type.String()),
  ownerId: Uuid,
  defaultCurrency: CurrencyCode,
  /** Whether cost figures fold other currencies in at today's rate. */
  costReporting: CostReportingModeSchema,
  vehicleCount: Type.Integer(),
  /** The caller's role in this garage — what the client uses to decide what to render. */
  role: GarageRoleSchema,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Garage = Static<typeof Garage>;

export const CreateGarage = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    defaultCurrency: Type.Optional(CurrencyCode),
  },
  { additionalProperties: false },
);
export type CreateGarage = Static<typeof CreateGarage>;

export const UpdateGarage = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    description: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
    defaultCurrency: Type.Optional(CurrencyCode),
    costReporting: Type.Optional(CostReportingModeSchema),
  },
  { additionalProperties: false },
);
export type UpdateGarage = Static<typeof UpdateGarage>;

export const GarageMember = Type.Object({
  id: Uuid,
  userId: Uuid,
  email: Type.String({ format: 'email' }),
  name: Type.String(),
  image: Nullable(Type.String()),
  role: GarageRoleSchema,
  joinedAt: IsoDateTime,
  /** The vehicles in this garage they drive. Any member can drive; a vehicle can have several. */
  vehicleIds: Type.Array(Uuid),
});
export type GarageMember = Static<typeof GarageMember>;

/**
 * Membership is granted by email, and only to an account that already exists.
 *
 * Inviting a stranger by email is a different feature with different problems — pending
 * invitations, expiry, revocation, and an email that must not confirm whether an address
 * has an account. That is the sharing work in Phase 7, not a variation of this endpoint.
 */
export const AddGarageMember = Type.Object(
  {
    email: Type.String({ format: 'email', maxLength: 320 }),
    role: GarageRoleSchema,
  },
  { additionalProperties: false },
);
export type AddGarageMember = Static<typeof AddGarageMember>;

export const UpdateGarageMember = Type.Object(
  { role: GarageRoleSchema },
  { additionalProperties: false },
);
export type UpdateGarageMember = Static<typeof UpdateGarageMember>;

/** The whole set of vehicles a member drives, replacing what was there: an empty list unassigns. */
export const AssignMemberVehicles = Type.Object(
  { vehicleIds: Type.Array(Uuid, { maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false },
);
export type AssignMemberVehicles = Static<typeof AssignMemberVehicles>;

/** The same assignments read from the vehicle's side: everyone who drives it, replacing the set. */
export const AssignVehicleDrivers = Type.Object(
  { memberIds: Type.Array(Uuid, { maxItems: 500, uniqueItems: true }) },
  { additionalProperties: false },
);
export type AssignVehicleDrivers = Static<typeof AssignVehicleDrivers>;

export const GarageIdParam = Type.Object({ garageId: Uuid });
export const GarageMemberParams = Type.Object({ garageId: Uuid, memberId: Uuid });
export const GarageVehicleParams = Type.Object({ garageId: Uuid, vehicleId: Uuid });
