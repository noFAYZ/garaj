import { describe, expect, it } from 'vitest';
import { resolveTrip, tripDeductionMinor } from './trip';

describe('resolveTrip', () => {
  it('measures the distance from the readings and keeps the rate it was given', () => {
    expect(
      resolveTrip(
        { purpose: 'BUSINESS', startOdometer: 10_000, rateMinor: 70, rateCurrency: 'USD' },
        10_042,
      ),
    ).toEqual({
      trip: {
        tripPurpose: 'BUSINESS',
        tripStartOdometer: 10_000,
        tripDistance: 42,
        mileageRateMinor: 70,
        mileageRateCurrency: 'USD',
      },
    });
  });

  it('accepts a typed distance without readings', () => {
    const result = resolveTrip({ purpose: 'PERSONAL', distance: 15 }, undefined);
    expect(result).toMatchObject({ trip: { tripDistance: 15, mileageRateMinor: null } });
  });

  it('refuses readings and a distance that disagree, or no distance at all', () => {
    expect(
      resolveTrip({ purpose: 'BUSINESS', startOdometer: 100, distance: 5 }, 150),
    ).toMatchObject({
      errors: { 'trip.distance': expect.stringContaining('50') },
    });
    expect(resolveTrip({ purpose: 'BUSINESS' }, 150)).toHaveProperty(['errors', 'trip.distance']);
    expect(resolveTrip({ purpose: 'BUSINESS', startOdometer: 200 }, 150)).toHaveProperty([
      'errors',
      'trip.startOdometer',
    ]);
  });

  it('needs a currency with a rate', () => {
    expect(resolveTrip({ purpose: 'BUSINESS', distance: 5, rateMinor: 45 }, null)).toHaveProperty([
      'errors',
      'trip.rateCurrency',
    ]);
  });
});

describe('tripDeductionMinor', () => {
  it('multiplies by the stored rate, rounding once', () => {
    expect(tripDeductionMinor(42, 70)).toBe(2940);
    expect(tripDeductionMinor(42, null)).toBeNull();
  });
});
