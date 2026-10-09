/**
 * Authorization (Architecture.md §13).
 *
 * Permissions are capability strings, not role checks scattered through handlers. A route
 * asks "may this actor do `vehicle.delete` in this garage?" — it never asks "is this user
 * an ADMIN?". Adding a role then means editing one table here instead of auditing every
 * call site for the ones that were missed.
 *
 * This module is pure and shared with the clients so the UI can hide actions the server
 * would reject. That is a convenience only: the server re-checks every request, because
 * the frontend is not a security boundary (PRD §47).
 */

import type { GarageRole } from './enums';

export const CAPABILITIES = [
  'garage.read',
  'garage.manage_settings',
  'garage.manage_members',
  'garage.delete',

  'vehicle.read',
  'vehicle.write',
  'vehicle.delete',

  'event.read',
  'event.write',
  'event.delete',

  'maintenance.read',
  // Configuring a schedule is an owner-ish decision; logging a completed service is
  // day-to-day activity. A driver gets the second without the first.
  'maintenance.plan.write',
  'maintenance.record.write',

  'task.read',
  'task.write',
  'task.delete',

  'idea.read',
  'idea.write',

  'expense.read',
  'expense.write',
  'expense.delete',

  'document.read',
  'document.write',
  'document.delete',

  'photo.read',
  'photo.write',
  'photo.delete',

  'component.read',
  'component.write',

  'condition.read',
  'condition.write',

  'valuation.read',
  'valuation.write',

  'billing.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const READ_CAPABILITIES = CAPABILITIES.filter((capability) =>
  capability.endsWith('.read'),
) as readonly Capability[];

const ALL_CAPABILITIES: readonly Capability[] = CAPABILITIES;

/** Everything an ADMIN may do: full access minus the two owner-only powers. */
const ADMIN_CAPABILITIES = ALL_CAPABILITIES.filter(
  (capability) => capability !== 'billing.manage' && capability !== 'garage.delete',
);

const MEMBER_CAPABILITIES: readonly Capability[] = [
  ...READ_CAPABILITIES,
  'vehicle.write',
  'event.write',
  'event.delete',
  'maintenance.plan.write',
  'maintenance.record.write',
  'task.write',
  'task.delete',
  'idea.write',
  'expense.write',
  'expense.delete',
  'document.write',
  'photo.write',
  'photo.delete',
  'component.write',
  'condition.write',
  'valuation.write',
];

/**
 * DRIVER records what happened; it does not reshape the garage. So: log a service, add a
 * trip, note a fuel stop, attach a photo — but no editing vehicle identity, no maintenance
 * schedules, no deleting anything, no documents (those are legal/financial artefacts).
 */
const DRIVER_CAPABILITIES: readonly Capability[] = [
  ...READ_CAPABILITIES,
  'event.write',
  'maintenance.record.write',
  'task.write',
  'expense.write',
  'photo.write',
  'condition.write',
];

export const ROLE_CAPABILITIES: Readonly<Record<GarageRole, ReadonlySet<Capability>>> =
  Object.freeze({
    OWNER: new Set(ALL_CAPABILITIES),
    ADMIN: new Set(ADMIN_CAPABILITIES),
    MEMBER: new Set(MEMBER_CAPABILITIES),
    DRIVER: new Set(DRIVER_CAPABILITIES),
    VIEWER: new Set(READ_CAPABILITIES),
  });

export interface GarageMembership {
  readonly garageId: string;
  readonly role: GarageRole;
}

/**
 * Everything the API knows about the caller, built once per request from the verified
 * session (Architecture.md §12). Memberships are read from the database — a garageId that
 * arrives in a request body or URL is an argument, never evidence.
 */
export interface ActorContext {
  readonly userId: string;
  /** Copied onto audit rows, which outlive the account they describe. */
  readonly email: string;
  readonly sessionId: string;
  /**
   * How the caller proved who they are. A personal API key acts as its owner in every garage,
   * but may not mint or revoke keys — a leaked key must not be able to outlive its revocation.
   */
  readonly credential?: 'session' | 'api-key';
  readonly memberships: readonly GarageMembership[];
}

export function roleInGarage(actor: ActorContext, garageId: string): GarageRole | null {
  return actor.memberships.find((m) => m.garageId === garageId)?.role ?? null;
}

export function can(actor: ActorContext, capability: Capability, garageId: string): boolean {
  const role = roleInGarage(actor, garageId);
  if (!role) return false;
  return ROLE_CAPABILITIES[role].has(capability);
}

export function capabilitiesFor(role: GarageRole): readonly Capability[] {
  return [...ROLE_CAPABILITIES[role]];
}

/**
 * Capabilities per garage, for a client that wants to grey out what it cannot do.
 *
 * The arrays are freshly built copies, so they are returned mutable rather than `readonly`
 * — marking a copy immutable buys no safety and forces every consumer to clone it again.
 */
export function capabilityMap(actor: ActorContext): Record<string, Capability[]> {
  const map: Record<string, Capability[]> = {};
  for (const membership of actor.memberships) {
    map[membership.garageId] = [...ROLE_CAPABILITIES[membership.role]];
  }
  return map;
}
