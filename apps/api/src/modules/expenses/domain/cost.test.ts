import { describe, expect, it } from 'vitest';
import type { ExpenseCategory } from '@vehicle-os/domain';
import { computeCost, elapsedYears, primaryCurrency, type CostInput, convertSums } from './cost';

const sum = (category: ExpenseCategory, amountMinor: number, currency = 'EUR', count = 1) => ({
  category,
  currency,
  amountMinor,
  count,
});

const input = (overrides: Partial<CostInput> = {}): CostInput => ({
  windowSums: [],
  lifetimeSums: [],
  purchasePriceAmountMinor: null,
  purchasePriceCurrency: null,
  purchaseDate: null,
  odometerLow: null,
  odometerHigh: null,
  now: new Date('2026-09-08T12:00:00Z'),
  ...overrides,
});

describe('primaryCurrency', () => {
  it('takes the purchase currency, which is usually the largest single sum', () => {
    const totals = input({
      purchasePriceCurrency: 'GBP',
      lifetimeSums: [sum('FUEL', 90_000, 'EUR')],
    });
    expect(primaryCurrency(totals, 'USD')).toBe('GBP');
  });

  /*
   * By spend, not by row count. Six tanks of fuel bought abroad are six rows; one gearbox
   * rebuild at home is one — and the summary belongs in the currency the money is in.
   */
  it('picks the currency with the most spent, not the most entries', () => {
    const totals = input({
      lifetimeSums: [sum('FUEL', 6_000, 'CHF', 6), sum('REPAIR', 250_000, 'EUR', 1)],
    });
    expect(primaryCurrency(totals, 'USD')).toBe('EUR');
  });

  it('falls back when the vehicle has no purchase price and no expenses', () => {
    expect(primaryCurrency(input(), 'USD')).toBe('USD');
  });

  it('breaks a tie the same way every time, whatever order the rows arrive in', () => {
    const forwards = input({
      lifetimeSums: [sum('FUEL', 5_000, 'EUR'), sum('FUEL', 5_000, 'AUD')],
    });
    const backwards = input({ lifetimeSums: [...forwards.lifetimeSums].reverse() });
    expect(primaryCurrency(forwards, 'USD')).toBe(primaryCurrency(backwards, 'USD'));
  });
});

describe('elapsedYears', () => {
  it('is null without a purchase date', () => {
    expect(elapsedYears(null, new Date('2026-09-08T12:00:00Z'))).toBeNull();
  });

  it('measures a mean Gregorian year, not 365 days', () => {
    const years = elapsedYears('2016-09-08', new Date('2026-09-08T00:00:00Z'));
    expect(years).toBeCloseTo(10, 2);
  });

  /** A typo in the purchase date must not produce a negative annual cost. */
  it('is null for a purchase date in the future', () => {
    expect(elapsedYears('2030-01-01', new Date('2026-09-08T12:00:00Z'))).toBeNull();
  });
});

describe('computeCost', () => {
  it('totals the window and orders the breakdown by spend', () => {
    const result = computeCost(
      input({
        windowSums: [sum('FUEL', 30_000), sum('MAINTENANCE', 120_000), sum('CLEANING', 4_000)],
      }),
      'EUR',
    );

    expect(result.totalSpentMinor).toBe(154_000);
    expect(result.byCategory.map((row) => row.category)).toEqual([
      'MAINTENANCE',
      'FUEL',
      'CLEANING',
    ]);
  });

  /*
   * The double-count that is invisible once it happens: the purchase price lives on the
   * vehicle, and someone who also filed it as a PURCHASE expense would otherwise see it
   * twice in the ownership total, looking only like an expensive car.
   */
  it('does not count a PURCHASE expense on top of the vehicle purchase price', () => {
    const result = computeCost(
      input({
        purchasePriceAmountMinor: 2_000_000,
        purchasePriceCurrency: 'EUR',
        lifetimeSums: [sum('PURCHASE', 2_000_000), sum('MAINTENANCE', 150_000)],
      }),
      'EUR',
    );

    expect(result.ownershipCostMinor).toBe(2_150_000);
  });

  it('is running spend alone when the vehicle has no purchase price', () => {
    const result = computeCost(input({ lifetimeSums: [sum('FUEL', 88_000)] }), 'EUR');

    expect(result.purchasePriceMinor).toBeNull();
    expect(result.ownershipCostMinor).toBe(88_000);
  });

  /** A purchase billed in another currency cannot be added; it is reported, not converted. */
  it('excludes a purchase price in a different currency from the ownership total', () => {
    const result = computeCost(
      input({
        purchasePriceAmountMinor: 2_000_000,
        purchasePriceCurrency: 'GBP',
        lifetimeSums: [sum('FUEL', 50_000, 'EUR')],
      }),
      'EUR',
    );

    // The purchase currency wins, so the EUR fuel is what gets set aside.
    expect(result.currency).toBe('GBP');
    expect(result.ownershipCostMinor).toBe(2_000_000);
    expect(result.otherCurrencies).toEqual([{ currency: 'EUR', amountMinor: 50_000, count: 1 }]);
  });

  it('divides the ownership cost by the years since purchase', () => {
    const result = computeCost(
      input({
        purchasePriceAmountMinor: 1_000_000,
        purchasePriceCurrency: 'EUR',
        purchaseDate: '2021-09-08',
        lifetimeSums: [sum('MAINTENANCE', 500_000)],
        now: new Date('2026-09-08T00:00:00Z'),
      }),
      'EUR',
    );

    /*
     * 15,000.00 over five calendar years — 3,000.00 a year, give or take the 35 minor units
     * that separate five calendar years from five mean Gregorian ones across a leap year.
     */
    expect(result.costPerYearMinor).toBeGreaterThan(299_900);
    expect(result.costPerYearMinor).toBeLessThan(300_100);
  });

  it('reports no annual cost without a purchase date', () => {
    const result = computeCost(input({ lifetimeSums: [sum('FUEL', 10_000)] }), 'EUR');
    expect(result.costPerYearMinor).toBeNull();
  });

  /*
   * Between readings, not from zero. A car bought at 80,000 km and driven to 90,000 has
   * cost its owner over 10,000 km — dividing by 90,000 would report a running cost less
   * than a tenth of the truth.
   */
  it('measures distance between the first and last readings, not from zero', () => {
    const result = computeCost(
      input({
        lifetimeSums: [sum('FUEL', 100_000)],
        odometerLow: 80_000,
        odometerHigh: 90_000,
      }),
      'EUR',
    );

    expect(result.distanceCovered).toBe(10_000);
    expect(result.costPerDistanceMinor).toBe(10);
  });

  it('leaves the purchase out of cost per distance', () => {
    const result = computeCost(
      input({
        purchasePriceAmountMinor: 2_000_000,
        purchasePriceCurrency: 'EUR',
        lifetimeSums: [sum('PURCHASE', 2_000_000), sum('FUEL', 100_000)],
        odometerLow: 0,
        odometerHigh: 10_000,
      }),
      'EUR',
    );

    // 1,000.00 of fuel over 10,000 km, not 30,000.00 of everything.
    expect(result.costPerDistanceMinor).toBe(10);
  });

  it('reports no cost per distance with a single reading', () => {
    const result = computeCost(
      input({ lifetimeSums: [sum('FUEL', 50_000)], odometerLow: 42_000, odometerHigh: 42_000 }),
      'EUR',
    );

    expect(result.distanceCovered).toBe(0);
    expect(result.costPerDistanceMinor).toBeNull();
  });

  it('reports no cost per distance with no readings at all', () => {
    const result = computeCost(input({ lifetimeSums: [sum('FUEL', 50_000)] }), 'EUR');
    expect(result.costPerDistanceMinor).toBeNull();
    expect(result.distanceCovered).toBeNull();
  });

  it('groups everything it set aside by currency, largest first', () => {
    const result = computeCost(
      input({
        purchasePriceCurrency: 'EUR',
        lifetimeSums: [
          sum('FUEL', 3_000, 'CHF', 2),
          sum('FUEL', 9_000, 'GBP', 1),
          sum('CLEANING', 1_000, 'CHF', 1),
          sum('MAINTENANCE', 40_000, 'EUR', 2),
        ],
      }),
      'EUR',
    );

    expect(result.otherCurrencies).toEqual([
      { currency: 'GBP', amountMinor: 9_000, count: 1 },
      { currency: 'CHF', amountMinor: 4_000, count: 3 },
    ]);
  });

  /** Every figure is an integer count of minor units — a fraction of a cent is not money. */
  it('rounds derived figures to whole minor units', () => {
    const result = computeCost(
      input({
        lifetimeSums: [sum('FUEL', 10_000)],
        odometerLow: 0,
        odometerHigh: 3_000,
      }),
      'EUR',
    );

    expect(Number.isInteger(result.costPerDistanceMinor)).toBe(true);
    expect(result.costPerDistanceMinor).toBe(3);
  });
});

describe('convertSums', () => {
  const rate = (amountMinor: number, from: string) => (from === 'EUR' ? amountMinor * 2 : null);

  it('merges converted groups into the target currency', () => {
    expect(
      convertSums(
        [
          { category: 'FUEL', currency: 'USD', amountMinor: 1000, count: 2 },
          { category: 'FUEL', currency: 'EUR', amountMinor: 100, count: 1 },
        ],
        'USD',
        rate,
      ),
    ).toEqual([{ category: 'FUEL', currency: 'USD', amountMinor: 1200, count: 3 }]);
  });

  it('gives up entirely when any currency cannot be converted', () => {
    expect(
      convertSums([{ category: 'FUEL', currency: 'CHF', amountMinor: 1, count: 1 }], 'USD', rate),
    ).toBeNull();
  });
});
