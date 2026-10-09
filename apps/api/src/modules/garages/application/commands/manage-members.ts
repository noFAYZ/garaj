/**
 * Membership commands (Architecture.md §11, §57).
 *
 * Every one of these is audited: in a shared garage, "who let them in" and "who removed
 * that" are the questions that get asked after something goes wrong.
 */

import type { Database } from '@vehicle-os/database';
import { roleInGarage, type ActorContext, type GarageRole } from '@vehicle-os/domain';
import { ConflictError, NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import {
  GarageRuleViolation,
  assertMayAssignRole,
  assertMayModifyMember,
  assertOwnerRemains,
} from '../../domain/policies/garage-policy';
import {
  deleteMember,
  findUserByEmail,
  insertMember,
  listMembers,
  liveVehicleIdsIn,
  setMemberVehicles,
  setVehicleDrivers,
  updateMemberRole,
  type MemberRow,
} from '../../infrastructure/repositories/garage-repository';
import type { CommandMeta } from './create-garage';

function toConflict(error: unknown): never {
  if (error instanceof GarageRuleViolation) throw new ConflictError(error.code, error.message);
  throw error;
}

function snapshot(members: readonly MemberRow[]) {
  return members.map((member) => ({
    memberId: member.id,
    userId: member.userId,
    role: member.role,
  }));
}

export async function addMember(
  db: Database,
  actor: ActorContext,
  garageId: string,
  input: { email: string; role: GarageRole },
  meta: CommandMeta,
): Promise<MemberRow> {
  const actorRole = roleInGarage(actor, garageId);
  if (!actorRole) throw new NotFoundError('Garage');

  try {
    assertMayAssignRole(actorRole, input.role);
  } catch (error) {
    toConflict(error);
  }

  const memberId = await db.transaction(async (tx) => {
    const user = await findUserByEmail(tx, input.email);
    /*
     * Deliberately a 400 naming the address rather than a silent success. There is no
     * pending-invitation concept yet, so pretending it worked would leave the owner waiting
     * for someone who was never added. Inviting a non-user is the Phase 7 sharing feature.
     */
    if (!user) {
      throw new ValidationError('Invalid request', {
        email: `No Garaj account exists for ${input.email}. They need to sign up first.`,
      });
    }

    const existing = await listMembers(tx, garageId);
    if (existing.some((member) => member.userId === user.id)) {
      throw new ConflictError('ALREADY_MEMBER', 'That person is already a member of this garage.');
    }

    const id = await insertMember(tx, {
      garageId,
      userId: user.id,
      role: input.role,
      invitedBy: actor.userId,
    });

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.member_added',
      resourceType: 'garage_member',
      resourceId: id,
      metadata: { email: user.email, role: input.role },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return id;
  });

  const members = await listMembers(db, garageId);
  const created = members.find((member) => member.id === memberId);
  if (!created) throw new NotFoundError('Garage member');
  return created;
}

export async function changeMemberRole(
  db: Database,
  actor: ActorContext,
  garageId: string,
  memberId: string,
  role: GarageRole,
  meta: CommandMeta,
): Promise<MemberRow> {
  const actorRole = roleInGarage(actor, garageId);
  if (!actorRole) throw new NotFoundError('Garage');

  return db.transaction(async (tx) => {
    const members = await listMembers(tx, garageId);
    const target = members.find((member) => member.id === memberId);
    if (!target) throw new NotFoundError('Garage member');

    try {
      assertMayModifyMember(actorRole, target.role);
      assertMayAssignRole(actorRole, role);
      assertOwnerRemains(snapshot(members), memberId, role);
    } catch (error) {
      toConflict(error);
    }

    await updateMemberRole(tx, memberId, role);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.member_role_changed',
      resourceType: 'garage_member',
      resourceId: memberId,
      metadata: { email: target.email, from: target.role, to: role },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return { ...target, role };
  });
}

export async function removeMember(
  db: Database,
  actor: ActorContext,
  garageId: string,
  memberId: string,
  meta: CommandMeta,
): Promise<void> {
  const actorRole = roleInGarage(actor, garageId);
  if (!actorRole) throw new NotFoundError('Garage');

  await db.transaction(async (tx) => {
    const members = await listMembers(tx, garageId);
    const target = members.find((member) => member.id === memberId);
    if (!target) throw new NotFoundError('Garage member');

    try {
      assertMayModifyMember(actorRole, target.role);
      assertOwnerRemains(snapshot(members), memberId, null);
    } catch (error) {
      toConflict(error);
    }

    await deleteMember(tx, memberId);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.member_removed',
      resourceType: 'garage_member',
      resourceId: memberId,
      metadata: { email: target.email, role: target.role },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });
}

/**
 * Sets the vehicles a member drives. Any member may drive, whatever their role — the role is
 * what they may change, not whether they are behind the wheel. Every id must be a live vehicle
 * of this garage: an assignment cannot reach into a garage the caller does not manage.
 */
export async function assignVehicles(
  db: Database,
  actor: ActorContext,
  garageId: string,
  memberId: string,
  vehicleIds: readonly string[],
  meta: CommandMeta,
): Promise<MemberRow> {
  if (!roleInGarage(actor, garageId)) throw new NotFoundError('Garage');

  return db.transaction(async (tx) => {
    const members = await listMembers(tx, garageId);
    const target = members.find((member) => member.id === memberId);
    if (!target) throw new NotFoundError('Garage member');

    const live = await liveVehicleIdsIn(tx, garageId, vehicleIds);
    if (live.length !== vehicleIds.length) {
      throw new ValidationError('Invalid request', {
        vehicleIds: 'Every vehicle must be in this garage.',
      });
    }

    await setMemberVehicles(tx, memberId, vehicleIds);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.member_vehicles_assigned',
      resourceType: 'garage_member',
      resourceId: memberId,
      metadata: { email: target.email, from: target.vehicleIds, to: vehicleIds },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return { ...target, vehicleIds: [...vehicleIds] };
  });
}

/**
 * Sets everyone who drives one vehicle — the same assignments as `assignVehicles`, from the
 * vehicle's side, in one transaction rather than one request per person. The vehicle must be live
 * in this garage and every id a membership of it.
 */
export async function assignDrivers(
  db: Database,
  actor: ActorContext,
  garageId: string,
  vehicleId: string,
  memberIds: readonly string[],
  meta: CommandMeta,
): Promise<MemberRow[]> {
  if (!roleInGarage(actor, garageId)) throw new NotFoundError('Garage');

  await db.transaction(async (tx) => {
    if ((await liveVehicleIdsIn(tx, garageId, [vehicleId])).length === 0) {
      throw new NotFoundError('Vehicle');
    }
    const members = await listMembers(tx, garageId);
    if (!memberIds.every((id) => members.some((member) => member.id === id))) {
      throw new ValidationError('Invalid request', {
        memberIds: 'Every driver must be a member of this garage.',
      });
    }

    await setVehicleDrivers(tx, vehicleId, memberIds);
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: meta.actorEmail,
      garageId,
      action: 'garage.vehicle_drivers_assigned',
      resourceType: 'vehicle',
      resourceId: vehicleId,
      metadata: {
        from: members.filter((m) => m.vehicleIds.includes(vehicleId)).map((m) => m.id),
        to: memberIds,
      },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  return listMembers(db, garageId);
}
