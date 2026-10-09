import { describe, expect, it } from 'vitest';
import { computeNet } from './net';

describe('computeNet', () => {
  it('reports a loss as a loss', () => {
    const net = computeNet({
      earned: [{ currency: 'USD', amountMinor: 40_000, count: 8 }],
      spentMinor: 95_000,
      currency: 'USD',
      distanceCovered: null,
    });
    expect(net.netMinor).toBe(-55_000);
  });

  it('leaves another currency out of the total and says what it left', () => {
    const net = computeNet({
      earned: [
        { currency: 'USD', amountMinor: 30_000, count: 5 },
        { currency: 'EUR', amountMinor: 12_000, count: 2 },
      ],
      spentMinor: 10_000,
      currency: 'USD',
      distanceCovered: null,
    });
    expect(net.totalEarnedMinor).toBe(30_000);
    expect(net.netMinor).toBe(20_000);
    expect(net.otherCurrencies).toEqual([{ currency: 'EUR', amountMinor: 12_000, count: 2 }]);
  });

  it('gives earnings per distance only when there is a distance', () => {
    const base = {
      earned: [{ currency: 'USD', amountMinor: 50_000, count: 10 }],
      spentMinor: 0,
      currency: 'USD',
    };
    expect(computeNet({ ...base, distanceCovered: 1_000 }).earnedPerDistanceMinor).toBe(50);
    expect(computeNet({ ...base, distanceCovered: 0 }).earnedPerDistanceMinor).toBeNull();
    expect(computeNet({ ...base, distanceCovered: null }).earnedPerDistanceMinor).toBeNull();
  });
});
