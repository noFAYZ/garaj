import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  can,
  capabilitiesFor,
  roleInGarage,
  type ActorContext,
  type Capability,
} from './authz';
import { GARAGE_ROLES } from './enums';

const GARAGE_A = 'garage-a';
const GARAGE_B = 'garage-b';

function actor(memberships: ActorContext['memberships']): ActorContext {
  return {
    userId: 'user-1',
    email: 'user-1@example.test',
    sessionId: 'session-1',
    memberships,
  };
}

describe('capability table', () => {
  it('grants OWNER every capability', () => {
    expect(capabilitiesFor('OWNER')).toHaveLength(CAPABILITIES.length);
  });

  it('reserves billing and garage deletion for OWNER alone', () => {
    for (const role of GARAGE_ROLES) {
      const expected = role === 'OWNER';
      expect(ROLE_CAPABILITIES[role].has('billing.manage')).toBe(expected);
      expect(ROLE_CAPABILITIES[role].has('garage.delete')).toBe(expected);
    }
  });

  it('gives VIEWER reads and nothing else', () => {
    for (const capability of capabilitiesFor('VIEWER')) {
      expect(capability.endsWith('.read')).toBe(true);
    }
  });

  it('lets DRIVER log a completed service but not change the schedule', () => {
    expect(ROLE_CAPABILITIES.DRIVER.has('maintenance.record.write')).toBe(true);
    expect(ROLE_CAPABILITIES.DRIVER.has('maintenance.plan.write')).toBe(false);
  });

  it('gives DRIVER no delete and no document write', () => {
    for (const capability of capabilitiesFor('DRIVER')) {
      expect(capability.endsWith('.delete')).toBe(false);
    }
    expect(ROLE_CAPABILITIES.DRIVER.has('document.write')).toBe(false);
  });

  it('nests roles: every role can read everything a VIEWER can', () => {
    for (const role of GARAGE_ROLES) {
      for (const capability of capabilitiesFor('VIEWER')) {
        expect(ROLE_CAPABILITIES[role].has(capability)).toBe(true);
      }
    }
  });

  it('keeps MEMBER strictly below ADMIN', () => {
    for (const capability of capabilitiesFor('MEMBER')) {
      expect(ROLE_CAPABILITIES.ADMIN.has(capability)).toBe(true);
    }
    expect(ROLE_CAPABILITIES.MEMBER.has('garage.manage_members')).toBe(false);
    expect(ROLE_CAPABILITIES.ADMIN.has('garage.manage_members')).toBe(true);
  });
});

describe('can()', () => {
  it('resolves capability from the role held in that specific garage', () => {
    const a = actor([
      { garageId: GARAGE_A, role: 'OWNER' },
      { garageId: GARAGE_B, role: 'VIEWER' },
    ]);
    expect(can(a, 'vehicle.delete', GARAGE_A)).toBe(true);
    expect(can(a, 'vehicle.delete', GARAGE_B)).toBe(false);
  });

  /*
   * The cross-tenant case (PRD §75). A non-member must be refused every capability,
   * including the read ones — otherwise a leaked vehicle id becomes a readable garage.
   */
  it('denies every capability in a garage the actor does not belong to', () => {
    const outsider = actor([{ garageId: GARAGE_A, role: 'OWNER' }]);
    for (const capability of CAPABILITIES) {
      expect(can(outsider, capability, GARAGE_B)).toBe(false);
    }
  });

  it('denies everything to an actor with no memberships at all', () => {
    const stranger = actor([]);
    for (const capability of CAPABILITIES) {
      expect(can(stranger, capability, GARAGE_A)).toBe(false);
    }
  });

  it('returns null role for an unknown garage', () => {
    expect(roleInGarage(actor([]), GARAGE_A)).toBeNull();
  });

  it('rejects a capability string that is not in the table', () => {
    const owner = actor([{ garageId: GARAGE_A, role: 'OWNER' }]);
    expect(can(owner, 'vehicle.launch' as Capability, GARAGE_A)).toBe(false);
  });
});
