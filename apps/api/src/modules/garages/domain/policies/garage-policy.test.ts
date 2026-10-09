import { describe, expect, it } from 'vitest';
import {
  GarageRuleViolation,
  assertMayAssignRole,
  assertMayModifyMember,
  assertOwnerRemains,
  type MembershipSnapshot,
} from './garage-policy';

const owner = (id: string): MembershipSnapshot => ({
  memberId: id,
  userId: `u-${id}`,
  role: 'OWNER',
});
const admin = (id: string): MembershipSnapshot => ({
  memberId: id,
  userId: `u-${id}`,
  role: 'ADMIN',
});

describe('assertOwnerRemains', () => {
  it('allows demoting an owner while another remains', () => {
    expect(() => assertOwnerRemains([owner('a'), owner('b')], 'a', 'MEMBER')).not.toThrow();
  });

  /*
   * The state this prevents: a garage with no owner. Nobody can then manage billing,
   * members or deletion, and there is no in-app path back — it needs a database edit.
   */
  it('refuses to demote the only owner', () => {
    expect(() => assertOwnerRemains([owner('a'), admin('b')], 'a', 'MEMBER')).toThrow(
      GarageRuleViolation,
    );
  });

  it('refuses to remove the only owner', () => {
    expect(() => assertOwnerRemains([owner('a'), admin('b')], 'a', null)).toThrow(
      GarageRuleViolation,
    );
  });

  it('allows an owner to be "changed" to owner, which is a no-op', () => {
    expect(() => assertOwnerRemains([owner('a')], 'a', 'OWNER')).not.toThrow();
  });

  it('allows removing a non-owner regardless of owner count', () => {
    expect(() => assertOwnerRemains([owner('a'), admin('b')], 'b', null)).not.toThrow();
  });
});

describe('assertMayAssignRole', () => {
  it('lets an owner grant ownership', () => {
    expect(() => assertMayAssignRole('OWNER', 'OWNER')).not.toThrow();
  });

  /*
   * Without this an ADMIN — who legitimately holds `garage.manage_members` — could promote
   * themselves to OWNER and pick up billing and deletion rights on the way.
   */
  it('stops an admin granting ownership', () => {
    expect(() => assertMayAssignRole('ADMIN', 'OWNER')).toThrow(GarageRuleViolation);
  });

  it('lets an admin assign every non-owner role', () => {
    for (const role of ['ADMIN', 'MEMBER', 'DRIVER', 'VIEWER'] as const) {
      expect(() => assertMayAssignRole('ADMIN', role)).not.toThrow();
    }
  });
});

describe('assertMayModifyMember', () => {
  it('stops an admin modifying an owner', () => {
    expect(() => assertMayModifyMember('ADMIN', 'OWNER')).toThrow(GarageRuleViolation);
  });

  it('lets an owner modify anyone', () => {
    for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'DRIVER', 'VIEWER'] as const) {
      expect(() => assertMayModifyMember('OWNER', role)).not.toThrow();
    }
  });

  it('lets an admin modify a non-owner', () => {
    expect(() => assertMayModifyMember('ADMIN', 'MEMBER')).not.toThrow();
  });
});
