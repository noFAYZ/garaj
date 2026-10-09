import { describe, expect, it } from 'vitest';
import { specFieldsFor, validateSpecs } from './vehicle-specs';
import { VEHICLE_TYPES } from './enums';

describe('specFieldsFor', () => {
  it('gives a car engine and fuel fields', () => {
    const keys = specFieldsFor('CAR').map((field) => field.key);
    expect(keys).toContain('displacementCc');
    expect(keys).toContain('fuelType');
    expect(keys).toContain('frontTireSize');
  });

  /*
   * The point of modelling by capability: a bicycle is not a car with null columns. It has
   * no engine, no fuel system and no registration, so those fields do not exist for it at
   * all — the form never renders them and the API never accepts them.
   */
  it('gives a bicycle no engine, fuel or registration fields', () => {
    const keys = specFieldsFor('BICYCLE').map((field) => field.key);
    expect(keys).toContain('groupset');
    expect(keys).toContain('frontTireSize');
    expect(keys).not.toContain('displacementCc');
    expect(keys).not.toContain('fuelType');
    expect(keys).not.toContain('registrationCountry');
  });

  it('gives a boat hull and mooring fields', () => {
    const keys = specFieldsFor('BOAT').map((field) => field.key);
    expect(keys).toContain('hullType');
    expect(keys).toContain('marina');
    expect(keys).toContain('draftM');
  });

  it('shares the chain fields between motorcycles and bicycles', () => {
    expect(specFieldsFor('MOTORCYCLE').map((f) => f.key)).toContain('chainSize');
    expect(specFieldsFor('BICYCLE').map((f) => f.key)).toContain('chainSize');
  });

  it('produces no duplicate keys for any vehicle type', () => {
    for (const type of VEHICLE_TYPES) {
      const keys = specFieldsFor(type).map((field) => field.key);
      expect(new Set(keys).size, `duplicate spec key for ${type}`).toBe(keys.length);
    }
  });

  it('covers every vehicle type without throwing', () => {
    for (const type of VEHICLE_TYPES) {
      expect(Array.isArray(specFieldsFor(type))).toBe(true);
    }
  });
});

describe('validateSpecs', () => {
  it('accepts fields the type supports', () => {
    const result = validateSpecs('CAR', { displacementCc: 2993, fuelType: 'GASOLINE' });

    expect(result.errors).toEqual({});
    expect(result.specs).toEqual({ displacementCc: 2993, fuelType: 'GASOLINE' });
  });

  it('rejects a field belonging to a different type rather than dropping it', () => {
    const result = validateSpecs('BICYCLE', { displacementCc: 2993 });

    expect(result.specs).toEqual({});
    expect(result.errors.displacementCc).toContain('does not apply');
  });

  it('coerces a numeric string, because form inputs send strings', () => {
    expect(validateSpecs('CAR', { powerHp: '510' }).specs).toEqual({ powerHp: 510 });
  });

  it('rejects a non-numeric value for a numeric field', () => {
    expect(validateSpecs('CAR', { powerHp: 'lots' }).errors).toHaveProperty('powerHp');
  });

  it('rejects a fractional value for an integer field', () => {
    expect(validateSpecs('CAR', { cylinders: 5.5 }).errors).toHaveProperty('cylinders');
    expect(validateSpecs('CAR', { oilCapacityL: 5.5 }).errors).toEqual({});
  });

  it('rejects negative and out-of-range numbers', () => {
    expect(validateSpecs('CAR', { powerHp: -1 }).errors).toHaveProperty('powerHp');
    expect(validateSpecs('CAR', { powerHp: 999_999 }).errors).toHaveProperty('powerHp');
  });

  it('rejects a value outside a select field options', () => {
    expect(validateSpecs('CAR', { fuelType: 'STEAM' }).errors).toHaveProperty('fuelType');
    expect(validateSpecs('CAR', { fuelType: 'ELECTRIC_FAST' }).errors).toEqual({});
  });

  /*
   * A form clears a field by sending null or an empty string. Both must mean "remove", not
   * "store an empty value" — otherwise the spec object slowly fills with blanks that render
   * as empty rows on the vehicle profile.
   */
  it('treats null and empty string as clearing the field', () => {
    const result = validateSpecs('CAR', { engineCode: null, oilType: '' });

    expect(result.specs).toEqual({});
    expect(result.errors).toEqual({});
  });

  it('collects every error rather than stopping at the first', () => {
    const result = validateSpecs('CAR', {
      powerHp: -1,
      fuelType: 'STEAM',
      hullType: 'planing',
    });

    expect(Object.keys(result.errors).sort()).toEqual(['fuelType', 'hullType', 'powerHp']);
  });

  it('caps text length', () => {
    expect(validateSpecs('CAR', { engineCode: 'x'.repeat(201) }).errors).toHaveProperty(
      'engineCode',
    );
  });

  it('accepts an empty spec object', () => {
    expect(validateSpecs('CAR', {})).toEqual({ specs: {}, errors: {} });
  });
});
