import { describe, expect, it } from 'vitest';
import { ENTITLEMENTS, PLAN_TIERS } from './index';
import {
  effectivePlan,
  formatPlanPrice,
  entitlementsFor,
  hasEntitlement,
  limitsFor,
  tierForCount,
  tierForEntitlement,
} from './plans';

describe('effectivePlan', () => {
  it('is free without a subscription', () => {
    expect(effectivePlan(null)).toBe('FREE');
    expect(effectivePlan(undefined)).toBe('FREE');
  });

  it('keeps the plan while the provider is still retrying the card', () => {
    expect(effectivePlan({ plan: 'PLUS', status: 'PAST_DUE' })).toBe('PLUS');
    expect(effectivePlan({ plan: 'BUSINESS', status: 'TRIALING' })).toBe('BUSINESS');
  });

  it('drops to free once it has stopped or never started', () => {
    expect(effectivePlan({ plan: 'BUSINESS', status: 'CANCELED' })).toBe('FREE');
    expect(effectivePlan({ plan: 'PLUS', status: 'INCOMPLETE' })).toBe('FREE');
  });
});

describe('entitlements', () => {
  it('gives a free account nothing paid, and never refuses its own records', () => {
    expect(entitlementsFor('FREE')).toEqual([]);
    expect(hasEntitlement('FREE', 'passport.share')).toBe(false);
  });

  it('includes every lower tier', () => {
    expect(hasEntitlement('BUSINESS', 'passport.share')).toBe(true);
    expect(hasEntitlement('PLUS', 'passport.share')).toBe(true);
  });

  it('keeps the business reporting to the business tier', () => {
    for (const entitlement of ['income.track', 'mileage.report', 'driver.assign'] as const) {
      expect(hasEntitlement('PLUS', entitlement)).toBe(false);
      expect(hasEntitlement('BUSINESS', entitlement)).toBe(true);
    }
  });

  it('names the tier an upgrade prompt should offer', () => {
    expect(tierForEntitlement('passport.share')).toBe('PLUS');
    expect(tierForEntitlement('income.track')).toBe('BUSINESS');
  });

  it('grants every entitlement at the top tier, so none is unreachable', () => {
    for (const entitlement of ENTITLEMENTS) {
      expect(hasEntitlement('BUSINESS', entitlement)).toBe(true);
    }
  });
});

describe('limits', () => {
  it('rises with the tier and never falls', () => {
    for (const limit of ['vehicles', 'garages', 'members'] as const) {
      const values = PLAN_TIERS.map((tier) => limitsFor(tier)[limit]);
      expect(values).toEqual([...values].sort((a, b) => a - b));
    }
  });

  it('names the cheapest tier that would hold the count', () => {
    expect(tierForCount('vehicles', 3)).toBe('FREE');
    expect(tierForCount('vehicles', 4)).toBe('PLUS');
    expect(tierForCount('vehicles', 7)).toBe('BUSINESS');
    expect(tierForCount('vehicles', 101)).toBeNull();
  });
});

describe('formatPlanPrice', () => {
  const monthly = (amountMinor: number, currency = 'USD') => ({
    amountMinor,
    currency,
    interval: 'month',
    intervalCount: 1,
  });

  it('says a price the way it is read', () => {
    expect(formatPlanPrice(monthly(299), 'en-US')).toEqual({ amount: '$2.99', per: 'mo' });
    expect(formatPlanPrice(monthly(500), 'en-US')).toEqual({ amount: '$5', per: 'mo' });
    expect(formatPlanPrice(monthly(250), 'en-US').amount).toBe('$2.50');
  });

  it('takes the minor unit from the currency', () => {
    expect(formatPlanPrice(monthly(500, 'JPY'), 'en-US').amount).toBe('¥500');
  });

  it('names longer and grouped intervals', () => {
    expect(formatPlanPrice({ ...monthly(2999), interval: 'year' }, 'en-US').per).toBe('yr');
    expect(formatPlanPrice({ ...monthly(799), intervalCount: 3 }, 'en-US').per).toBe('3 mo');
  });
});
