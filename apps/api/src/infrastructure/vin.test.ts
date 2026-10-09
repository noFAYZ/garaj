import { describe, expect, it } from 'vitest';
import { isVin, mapVpic, normaliseVin } from './vin';

describe('VIN', () => {
  it('accepts 17 characters without I, O or Q', () => {
    expect(isVin(normaliseVin('wba 3b1c5-0ek1 23456'))).toBe(true);
    expect(isVin('WBA3B1C50EK1234')).toBe(false);
    expect(isVin('WBA3B1C50EK123456')).toBe(true);
    expect(isVin('WBA3B1C50EK12345O')).toBe(false);
  });

  it('maps a vPIC row, dropping "Not Applicable"', () => {
    const decoded = mapVpic('1HGCM82633A004352', {
      Make: 'HONDA',
      Model: 'Accord',
      ModelYear: '2003',
      Trim: 'EX-V6',
      DisplacementCC: '2998.0',
      EngineCylinders: '6',
      FuelTypePrimary: 'Gasoline',
      TransmissionStyle: 'Automatic',
      DriveType: 'FWD/Front-Wheel Drive',
      EngineHP: 'Not Applicable',
      ErrorCode: '0',
    });

    expect(decoded).toMatchObject({ make: 'Honda', model: 'Accord', year: 2003, variant: 'EX-V6' });
    expect(decoded.specs).toEqual({
      displacementCc: 2998,
      cylinders: 6,
      fuelType: 'GASOLINE',
      transmissionType: 'AUTOMATIC',
      drivetrain: 'FWD',
    });
    expect(decoded.warning).toBeNull();
  });

  it('keeps initialism makes in capitals and reports a partial decode', () => {
    const decoded = mapVpic('WBA3B1C50EK123456', {
      Make: 'BMW',
      ErrorCode: '1',
      ErrorText: '1 - Check Digit (9th position) does not calculate properly',
    });
    expect(decoded.make).toBe('BMW');
    expect(decoded.warning).toContain('Check Digit');
  });
});
