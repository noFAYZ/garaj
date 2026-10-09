import { describe, expect, it } from 'vitest';
import { computeUsage, type EnergyFill } from './energy';

const at = (day: number) => new Date(`2026-03-${String(day).padStart(2, '0')}T09:00:00Z`);

const fill = (partial: Partial<EnergyFill> & Pick<EnergyFill, 'quantity'>): EnergyFill => ({
  occurredAt: at(1),
  odometer: null,
  odometerUnit: null,
  quantityUnit: 'KWH',
  fuelType: 'ELECTRIC_FAST',
  isFullTank: null,
  ...partial,
});

describe('computeUsage', () => {
  it('reads an EV in kWh per 100 km and km per kWh', () => {
    const [usage] = computeUsage(
      [
        fill({ occurredAt: at(1), odometer: 10_000, quantity: '40' }),
        fill({ occurredAt: at(5), odometer: 10_200, quantity: '30' }),
        fill({ occurredAt: at(9), odometer: 10_400, quantity: '32' }),
      ],
      'KM',
    );

    // 400 km covered; the first charge got the car to the first reading, so 62 kWh did it.
    expect(usage?.distanceCovered).toBe(400);
    expect(usage?.quantity).toBe(62);
    expect(usage?.unit).toBe('KWH');
    expect(usage?.family).toBe('ENERGY');
    expect(usage?.per100Km).toBeCloseTo(15.5, 6);
    expect(usage?.distancePerUnit).toBeCloseTo(6.4516, 3);
    expect(usage?.basis).toBe('SPAN');
  });

  it('keeps a plug-in hybrid as two readings, never one average', () => {
    const usages = computeUsage(
      [
        fill({ occurredAt: at(1), odometer: 5_000, quantity: '20' }),
        fill({ occurredAt: at(4), odometer: 5_300, quantity: '25' }),
        fill({
          occurredAt: at(2),
          odometer: 5_100,
          quantity: '30',
          quantityUnit: 'LITER',
          fuelType: 'GASOLINE',
        }),
        fill({
          occurredAt: at(6),
          odometer: 5_500,
          quantity: '28',
          quantityUnit: 'LITER',
          fuelType: 'GASOLINE',
        }),
      ],
      'KM',
    );

    expect(usages).toHaveLength(2);
    const electric = usages.find((usage) => usage.family === 'ENERGY');
    const petrol = usages.find((usage) => usage.family === 'VOLUME');
    expect(electric?.unit).toBe('KWH');
    expect(petrol?.unit).toBe('LITER');
    // Ordered by distance covered, so the fuel the car mostly runs on leads.
    expect(usages[0]?.fuelType).toBe('GASOLINE');
  });

  it('converts gallons and miles into one comparable figure', () => {
    const [usage] = computeUsage(
      [
        fill({
          occurredAt: at(1),
          odometer: 1_000,
          odometerUnit: 'MI',
          quantity: '10',
          quantityUnit: 'US_GALLON',
          fuelType: 'GASOLINE',
        }),
        fill({
          occurredAt: at(8),
          odometer: 1_300,
          odometerUnit: 'MI',
          quantity: '10',
          quantityUnit: 'US_GALLON',
          fuelType: 'GASOLINE',
        }),
      ],
      'MI',
    );

    expect(usage?.unit).toBe('LITER');
    expect(usage?.distanceCovered).toBe(300);
    // 10 US gallons is 37.854 litres over 300 miles.
    expect(usage?.quantity).toBeCloseTo(37.854, 3);
    expect(usage?.distancePerUnit).toBeCloseTo(7.925, 3);
  });

  it('reports nothing rather than a guess', () => {
    // No odometer anywhere: a quantity with no distance is not a consumption figure.
    expect(computeUsage([fill({ quantity: '40' }), fill({ quantity: '35' })], 'KM')).toEqual([]);
    // One reading is a point, not a span.
    expect(computeUsage([fill({ odometer: 100, quantity: '40' })], 'KM')).toEqual([]);
    // Everything put in went into reaching the only reading there is.
    expect(
      computeUsage(
        [fill({ odometer: 100, quantity: '40' }), fill({ odometer: 100, quantity: '10' })],
        'KM',
      ),
    ).toEqual([]);
  });

  it('ignores a row whose unit contradicts its fuel, instead of dropping the vehicle', () => {
    const [usage] = computeUsage(
      [
        fill({ occurredAt: at(1), odometer: 200, quantity: '10' }),
        // A litre against a fast charge: someone picked the wrong unit.
        fill({ occurredAt: at(3), odometer: 300, quantity: '9', quantityUnit: 'LITER' }),
        fill({ occurredAt: at(5), odometer: 400, quantity: '12' }),
      ],
      'KM',
    );

    expect(usage?.fills).toBe(2);
    expect(usage?.unit).toBe('KWH');
    expect(usage?.quantity).toBe(12);
  });
});
