import { describe, expect, it } from 'vitest';
import {
  UnitError,
  convertDistance,
  convertVolume,
  distance,
  formatDistance,
  isOdometerRegression,
  toKilometers,
  toLiters,
  toMiles,
} from './units';

describe('distance', () => {
  it('rejects negative and non-finite readings', () => {
    expect(() => distance(-1, 'KM')).toThrow(UnitError);
    expect(() => distance(Number.NaN, 'KM')).toThrow(UnitError);
  });

  it('is a no-op when the units already match', () => {
    expect(convertDistance(42_381, 'KM', 'KM')).toBe(42_381);
  });

  it('uses the exact 1959 international mile', () => {
    expect(convertDistance(1, 'MI', 'KM')).toBe(1.609344);
    expect(convertDistance(100, 'KM', 'MI')).toBeCloseTo(62.137119, 6);
  });

  it('round-trips without drift', () => {
    const km = convertDistance(convertDistance(12_345, 'KM', 'MI'), 'MI', 'KM');
    expect(km).toBeCloseTo(12_345, 9);
  });

  it('normalises either unit to kilometres and miles', () => {
    expect(toKilometers(distance(10, 'MI'))).toBeCloseTo(16.09344, 5);
    expect(toMiles(distance(10, 'KM'))).toBeCloseTo(6.213712, 5);
  });
});

describe('volume', () => {
  it('separates US and imperial gallons', () => {
    expect(toLiters({ value: 1, unit: 'US_GALLON' })).toBeCloseTo(3.785412, 6);
    expect(toLiters({ value: 1, unit: 'IMP_GALLON' })).toBeCloseTo(4.54609, 6);
  });

  it('converts between the two gallon definitions', () => {
    expect(convertVolume(1, 'IMP_GALLON', 'US_GALLON')).toBeCloseTo(1.20095, 5);
  });
});

describe('isOdometerRegression', () => {
  it('reports a decrease even when the two readings use different units', () => {
    // 100 mi is ~160.9 km, so a later reading of 150 km is a regression.
    expect(isOdometerRegression(distance(100, 'MI'), distance(150, 'KM'))).toBe(true);
    expect(isOdometerRegression(distance(100, 'MI'), distance(170, 'KM'))).toBe(false);
  });

  it('treats the first ever reading as valid', () => {
    expect(isOdometerRegression(null, distance(42_381, 'KM'))).toBe(false);
  });

  it('does not flag an unchanged reading', () => {
    expect(isOdometerRegression(distance(500, 'KM'), distance(500, 'KM'))).toBe(false);
  });
});

describe('formatDistance', () => {
  it('groups digits and appends the recorded unit', () => {
    expect(formatDistance(distance(42_381, 'KM'))).toBe('42,381 km');
    expect(formatDistance(distance(8_240, 'MI'))).toBe('8,240 mi');
  });
});
