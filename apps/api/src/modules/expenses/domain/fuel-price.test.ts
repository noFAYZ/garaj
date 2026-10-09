import { describe, expect, it } from 'vitest';
import { fuelPrices, type PricedFill } from './fuel-price';

const fill = (overrides: Partial<PricedFill>): PricedFill => ({
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  amountMinor: 5000,
  currency: 'EUR',
  quantity: '40',
  quantityUnit: 'LITER',
  vendor: null,
  ...overrides,
});

describe('fuelPrices', () => {
  it('quotes per litre, converting gallons, and weights the average by volume', () => {
    const result = fuelPrices(
      [
        fill({ amountMinor: 1000, quantity: '10' }), // 1.000/L
        fill({ amountMinor: 10000, quantity: '50', occurredAt: new Date('2026-02-01') }), // 2.000/L
      ],
      'EUR',
    );
    expect(result.points.map((point) => point.perUnit)).toEqual(['1.000', '2.000']);
    // (10 + 100) / 60, not (1 + 2) / 2.
    expect(result.averagePerUnit).toBe('1.833');

    const gallon = fuelPrices(
      [fill({ amountMinor: 379, quantity: '1', quantityUnit: 'US_GALLON' })],
      'EUR',
    );
    expect(gallon.averagePerUnit).toBe('1.001');
  });

  it('ranks stations cheapest first, only with two fills or more, ignoring case', () => {
    const result = fuelPrices(
      [
        fill({ vendor: 'Shell', amountMinor: 8000 }),
        fill({ vendor: 'SHELL', amountMinor: 8000 }),
        fill({ vendor: 'Aral', amountMinor: 6000 }),
        fill({ vendor: 'Aral', amountMinor: 6000 }),
        fill({ vendor: 'Esso', amountMinor: 1000 }),
      ],
      'EUR',
    );
    expect(result.stations.map((station) => station.vendor)).toEqual(['Aral', 'Shell']);
    expect(result.stations[0]).toMatchObject({ averagePerUnit: '1.500', fills: 2 });
  });

  it('leaves out other currencies and fills without a quantity', () => {
    const result = fuelPrices(
      [fill({ currency: 'USD' }), fill({ quantity: null }), fill({ quantity: '0' })],
      'EUR',
    );
    expect(result).toMatchObject({ averagePerUnit: null, points: [] });
  });
});
