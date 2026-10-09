import { describe, expect, it } from 'vitest';
import { computeFuelConsumption, type FuelFill } from './fuel';

let day = 0;
const fill = (overrides: Partial<FuelFill> = {}): FuelFill => ({
  occurredAt: new Date(Date.UTC(2026, 0, ++day)),
  odometer: null,
  odometerUnit: null,
  quantity: '40',
  quantityUnit: 'LITER',
  isFullTank: true,
  ...overrides,
});

describe('computeFuelConsumption', () => {
  it("measures between two full tanks, ignoring the first tank's own fuel", () => {
    const result = computeFuelConsumption(
      [fill({ odometer: 10_000, quantity: '55' }), fill({ odometer: 10_500, quantity: '40' })],
      'KM',
    );

    expect(result).not.toBeNull();
    expect(result!.distanceCovered).toBe(500);
    expect(result!.liters).toBe(40);
    expect(result!.litersPer100Km).toBeCloseTo(8, 6);
    expect(result!.segments).toBe(1);
  });

  it('counts partial fills between two full tanks', () => {
    const result = computeFuelConsumption(
      [
        fill({ odometer: 10_000 }),
        fill({ odometer: 10_200, quantity: '15', isFullTank: false }),
        fill({ odometer: 10_500, quantity: '25' }),
      ],
      'KM',
    );

    expect(result!.liters).toBe(40);
    expect(result!.segments).toBe(1);
  });

  it('needs two full tanks with readings', () => {
    expect(computeFuelConsumption([fill({ odometer: 10_000 })], 'KM')).toBeNull();
    expect(
      computeFuelConsumption(
        [fill({ odometer: 10_000 }), fill({ odometer: 10_500, isFullTank: false })],
        'KM',
      ),
    ).toBeNull();
  });

  it('drops the segment across an odometer that went backwards', () => {
    const result = computeFuelConsumption(
      [
        fill({ odometer: 10_000 }),
        fill({ odometer: 10_500 }),
        fill({ odometer: 200 }), // cluster swap
        fill({ odometer: 700 }),
      ],
      'KM',
    );

    expect(result!.segments).toBe(2);
    expect(result!.distanceCovered).toBe(1000);
  });

  it("converts mixed units into the vehicle's", () => {
    const result = computeFuelConsumption(
      [
        fill({ odometer: 10_000, odometerUnit: 'KM' }),
        fill({ odometer: 6_250, odometerUnit: 'MI', quantity: '10', quantityUnit: 'US_GALLON' }),
      ],
      'KM',
    );

    expect(result!.distanceCovered).toBeCloseTo(6_250 * 1.609344 - 10_000, 6);
    expect(result!.liters).toBeCloseTo(37.85411784, 6);
  });

  it('quotes mpg alongside l/100km', () => {
    // 100 miles on exactly 5 US gallons.
    const result = computeFuelConsumption(
      [
        fill({ odometer: 1_000, quantity: '1', quantityUnit: 'US_GALLON' }),
        fill({ odometer: 1_100, quantity: '5', quantityUnit: 'US_GALLON' }),
      ],
      'MI',
    );

    expect(result!.milesPerUsGallon).toBeCloseTo(20, 6);
    expect(result!.litersPer100Km).toBeCloseTo(235.2145 / 20, 3);
  });
});
