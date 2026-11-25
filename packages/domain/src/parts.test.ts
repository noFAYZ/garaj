import { describe, expect, it } from 'vitest';
import { VEHICLE_TYPES } from './enums';
import { specFieldsFor } from './vehicle-specs';
import {
  currentParts,
  draftFor,
  PART_POSITIONS,
  partName,
  partSummary,
  productsFor,
  toPartLine,
  partPositionsFor,
  partProductKey,
  positionsForJob,
  type PartAction,
} from './parts';

describe('partPositionsFor', () => {
  it('follows the type: a bicycle has a chain and pads but no oil', () => {
    const bicycle = partPositionsFor('BICYCLE');
    expect(bicycle).toContain('CHAIN');
    expect(bicycle).toContain('BRAKE_PADS_FRONT');
    expect(bicycle).not.toContain('ENGINE_OIL');
    expect(partPositionsFor('CAR')).toContain('CABIN_FILTER');
    expect(partPositionsFor('MOTORCYCLE')).not.toContain('CABIN_FILTER');
    expect(partPositionsFor('BOAT')).toContain('ANODES');
  });

  it('drops what an electric vehicle does not burn, but keeps its coolant', () => {
    const ev = partPositionsFor('CAR', { fuelType: 'ELECTRIC_FAST' });
    expect(ev).not.toContain('ENGINE_OIL');
    expect(ev).not.toContain('SPARK_PLUGS');
    expect(ev).toContain('COOLANT');
    expect(ev).toContain('TYRES_FRONT');
  });

  it('gives every type somewhere to put a part', () => {
    for (const type of VEHICLE_TYPES) expect(partPositionsFor(type)).toContain('OTHER');
  });

  // A position that points at a spec its type does not have would offer a grade that never fills.
  it('names only spec fields that exist on the types it applies to', () => {
    for (const type of VEHICLE_TYPES) {
      const specs = new Set(specFieldsFor(type).map((field) => field.key));
      for (const key of partPositionsFor(type)) {
        const { specKey } = PART_POSITIONS[key] as { specKey?: string };
        if (specKey) expect(specs, `${type} ${key}`).toContain(specKey);
      }
    }
  });
});

describe('positionsForJob', () => {
  it.each([
    ['Oil change', ['ENGINE_OIL', 'OIL_FILTER']],
    ['Engine oil and filter', ['ENGINE_OIL', 'OIL_FILTER']],
    ['Annual service', ['ENGINE_OIL', 'OIL_FILTER']],
    ['Oil filter', ['OIL_FILTER']],
    ['Gearbox oil', ['GEARBOX_OIL']],
    ['Transmission fluid', ['GEARBOX_OIL']],
    ['Front brake pads', ['BRAKE_PADS_FRONT']],
    ['Rear pads and discs', ['BRAKE_PADS_REAR', 'BRAKE_DISCS_REAR']],
    ['New tyres', ['TYRES_FRONT', 'TYRES_REAR']],
    ['Brake fluid', ['BRAKE_FLUID']],
    ['Cambelt', ['TIMING_BELT']],
    ['Replace battery', ['BATTERY']],
  ])('%s', (title, expected) => {
    expect(positionsForJob(title).sort()).toEqual([...expected].sort());
  });

  it('names nothing for work that does not replace a part', () => {
    expect(positionsForJob('Tyre rotation')).toEqual([]);
    expect(positionsForJob('Check tyre pressures')).toEqual([]);
    expect(positionsForJob('Chain lube')).toEqual([]);
    expect(positionsForJob('Wash')).toEqual([]);
  });
});

describe('partName and partProductKey', () => {
  it('reads as one name, and matches however it was typed', () => {
    const a = { brand: 'Castrol', name: 'Edge', spec: '5W-30', partNumber: null };
    const b = { brand: ' castrol ', name: 'EDGE', spec: '5w-30', partNumber: '' };
    expect(partName(a)).toBe('Castrol Edge 5W-30');
    expect(partProductKey(a)).toBe(partProductKey(b));
    expect(partName({ brand: null, name: null, spec: null, partNumber: 'P3300' })).toBe('P3300');
    expect(partName({ brand: null, name: null, spec: null })).toBeNull();
  });
});

describe('currentParts', () => {
  const part = (id: string, position: string, action: PartAction = 'REPLACED') => ({
    id,
    position,
    action,
  });

  it('takes the newest replacement per position, skipping top-ups and Other', () => {
    // Newest first, as the API lists them.
    const current = currentParts([
      part('top-up', 'ENGINE_OIL', 'TOPPED_UP'),
      part('new-oil', 'ENGINE_OIL'),
      part('old-oil', 'ENGINE_OIL'),
      part('pads', 'BRAKE_PADS_FRONT'),
      part('dashcam', 'OTHER'),
    ]);
    expect(current.get('ENGINE_OIL')?.id).toBe('new-oil');
    expect(current.get('BRAKE_PADS_FRONT')?.id).toBe('pads');
    expect(current.has('OTHER')).toBe(false);
  });
});

describe('part drafts', () => {
  const car = { specs: { oilType: '0W-20' }, odometerUnit: 'KM' };
  const last = {
    position: 'ENGINE_OIL',
    action: 'REPLACED' as const,
    brand: 'Castrol',
    name: 'Edge',
    spec: '5W-30',
    partNumber: null,
    quantity: 4.2,
    unit: 'LITER' as const,
    warrantyUntil: '2027-01-01',
  };

  it('starts a line from last time, or from the spec when nothing named was fitted', () => {
    expect(draftFor('a', 'ENGINE_OIL', car, last)).toMatchObject({
      brand: 'Castrol',
      quantity: '4.2',
      same: true,
      // The new item's cover is its own.
      warrantyUntil: '',
    });
    expect(draftFor('b', 'ENGINE_OIL', car)).toMatchObject({ spec: '0W-20', same: false });
    expect(draftFor('c', 'ENGINE_OIL', { ...car, odometerUnit: 'MI' }).unit).toBe('QUART');
    expect(draftFor('d', 'OIL_FILTER', car).unit).toBeNull();
  });

  it('sends only what was typed', () => {
    const draft = {
      ...draftFor('e', 'BATTERY', car),
      brand: ' Varta ',
      warrantyUntil: '2029-03-01',
    };
    expect(toPartLine(draft)).toEqual({
      id: 'e',
      position: 'BATTERY',
      action: 'REPLACED',
      brand: 'Varta',
      name: undefined,
      spec: undefined,
      partNumber: undefined,
      warrantyUntil: '2029-03-01',
    });
  });

  it('summarises a line, with the part number the name did not say', () => {
    expect(partSummary({ ...last, partNumber: 'C-1' }, 'en-US')).toBe(
      'Castrol Edge 5W-30 · C-1 · 4.2 L',
    );
    const nameless = {
      ...last,
      brand: null,
      name: null,
      spec: null,
      quantity: 2,
      unit: 'PIECE' as const,
    };
    expect(partSummary(nameless, 'en-US')).toBe('Product not recorded · ×2');
  });

  it('offers products across positions of one kind, each once', () => {
    const tyre = { brand: 'Michelin', name: 'PS4', spec: null, partNumber: null };
    const offered = productsFor(
      [
        { ...tyre, position: 'TYRES_FRONT' },
        { ...tyre, position: 'TYRES_REAR' },
        { ...tyre, brand: 'Castrol', position: 'ENGINE_OIL' },
      ],
      'TYRES_REAR',
    );
    expect(offered).toHaveLength(1);
  });
});
