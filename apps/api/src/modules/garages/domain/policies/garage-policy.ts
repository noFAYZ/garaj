/**
 * Garage membership rules (Architecture.md §11, §13).
 *
 * Pure predicates over the membership list, kept out of the command handlers so each rule
 * has a name and a test rather than living as an `if` inside a transaction.
 */

import type { GarageRole } from '@vehicle-os/domain';

export interface MembershipSnapshot {
  readonly memberId: string;
  readonly userId: string;
  readonly role: GarageRole;
}

export class GarageRuleViolation extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GarageRuleViolation';
  }
}

function owners(members: readonly MembershipSnapshot[]): MembershipSnapshot[] {
  return members.filter((member) => member.role === 'OWNER');
}

/**
 * A garage must always have at least one owner.
 *
 * Without this the last owner can demote themselves and leave a garage nobody can delete,
 * bill, or manage members in — recoverable only by a manual database edit.
 */
export function assertOwnerRemains(
  members: readonly MembershipSnapshot[],
  changingMemberId: string,
  newRole: GarageRole | null,
): void {
  const remaining = owners(members).filter(
    (owner) => owner.memberId !== changingMemberId || newRole === 'OWNER',
  );
  if (remaining.length === 0) {
    throw new GarageRuleViolation(
      'LAST_OWNER',
      'A garage must keep at least one owner. Promote another member first.',
    );
  }
}

/**
 * Only an owner may create another owner.
 *
 * An admin can manage members, so without this an admin could promote themselves to owner
 * and gain billing and deletion rights the role was defined not to have.
 */
export function assertMayAssignRole(actorRole: GarageRole, targetRole: GarageRole): void {
  if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
    throw new GarageRuleViolation('OWNER_ONLY', 'Only an owner can grant the owner role.');
  }
}

/**
 * An admin cannot act on an owner. Otherwise "manage members" quietly includes "remove the
 * person who can remove me".
 */
export function assertMayModifyMember(actorRole: GarageRole, targetRole: GarageRole): void {
  if (targetRole === 'OWNER' && actorRole !== 'OWNER') {
    throw new GarageRuleViolation('OWNER_ONLY', 'Only an owner can modify another owner.');
  }
}
