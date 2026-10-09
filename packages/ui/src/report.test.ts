import { describe, expect, it } from 'vitest';
import {
  buildIncomeReport,
  buildRefuelReport,
  buildRoutesReport,
  buildSpendReport,
  bucketLabel,
  depreciationPerYear,
  distanceInWindow,
  distancePerYear,
  efficiencyInWindow,
  groupDetail,
  groupOf,
  monthlyPace,
  periodStart,
  timeBuckets,
  trueCostPerDistance,
  type LedgerRow,
} from './report';

const NOW = new Date('2026-09-23T12:00:00Z');

const row = (over: Partial<LedgerRow> & Pick<LedgerRow, 'category' | 'occurredAt'>): LedgerRow => ({
  id: Math.random().toString(36),
  description: over.category,
  vendor: null,
  amount: { amountMinor: 10_000, currency: 'EUR' },
  odometer: null,
  quantity: null,
  quantityUnit: null,
  energyKwh: null,
  ...over,
});

describe('report', () => {
  it('files every running category under exactly one group, and the purchase under none', () => {
    expect(groupOf('FUEL')).toBe('REFUELING');
    expect(groupOf('CHARGING')).toBe('REFUELING');
    expect(groupOf('REPAIR')).toBe('SERVICES');
    expect(groupOf('INSURANCE')).toBe('EXPENSES');
    // A category added later lands somewhere rather than vanishing from every total.
    expect(groupOf('SOMETHING_NEW')).toBe('EXPENSES');
    expect(groupOf('PURCHASE')).toBeNull();
  });

  it('draws months up to two years and years past that, quiet ones included', () => {
    expect(timeBuckets(Date.parse('2026-07-10T00:00:00Z'), NOW)).toEqual({
      unit: 'month',
      keys: ['2026-07', '2026-08', '2026-09'],
    });
    expect(timeBuckets(Date.parse('2023-02-01T00:00:00Z'), NOW)).toEqual({
      unit: 'year',
      keys: ['2023', '2024', '2025', '2026'],
    });
    expect(periodStart(3, NOW)).toBe('2026-06-23T00:00:00.000Z');
    expect(periodStart(null, NOW)).toBeUndefined();
    expect(bucketLabel('2026-09', 'short')).toBe('Sep');
    expect(bucketLabel('2025', 'short')).toBe('’25');
  });

  it('adds the groups up to the running total, leaving out the purchase and other currencies', () => {
    const report = buildSpendReport(
      [
        row({
          category: 'PURCHASE',
          occurredAt: '2026-08-01T10:00:00Z',
          amount: { amountMinor: 900_000, currency: 'EUR' },
        }),
        row({ category: 'FUEL', occurredAt: '2026-08-02T10:00:00Z' }),
        row({ category: 'FUEL', occurredAt: '2026-09-02T10:00:00Z' }),
        row({
          category: 'REPAIR',
          occurredAt: '2026-09-03T10:00:00Z',
          vendor: 'Garage A',
          amount: { amountMinor: 40_000, currency: 'EUR' },
        }),
        row({
          category: 'INSURANCE',
          occurredAt: '2026-09-04T10:00:00Z',
          amount: { amountMinor: 25_000, currency: 'EUR' },
        }),
        row({
          category: 'FUEL',
          occurredAt: '2026-09-05T10:00:00Z',
          amount: { amountMinor: 5_000, currency: 'CHF' },
        }),
        // Before the window: out of every figure.
        row({ category: 'FUEL', occurredAt: '2026-01-05T10:00:00Z' }),
      ],
      { currency: 'EUR', from: '2026-07-23T00:00:00Z', now: NOW },
    );
    expect(report.total).toBe(85_000);
    expect(report.groups.REFUELING).toEqual({ total: 20_000, count: 2 });
    expect(report.groups.SERVICES.total + report.groups.EXPENSES.total).toBe(65_000);
    expect(report.purchaseMinor).toBe(900_000);
    expect(report.excluded).toEqual([{ currency: 'CHF', amountMinor: 5_000, count: 1 }]);
    expect(report.buckets.map((bucket) => [bucket.key, bucket.total])).toEqual([
      ['2026-07', 0],
      ['2026-08', 10_000],
      ['2026-09', 75_000],
    ]);
    expect(report.days).toBe(63); // 62.5 days, rounded

    const services = groupDetail(report, 'SERVICES');
    expect(services.byVendor).toEqual([{ key: 'Garage A', amountMinor: 40_000, count: 1 }]);
    expect(services.buckets.at(-1)).toEqual({ key: '2026-09', value: 40_000 });
  });

  it('prices fuel per unit it was bought in, and ranks places cheapest first', () => {
    const report = buildSpendReport(
      [
        row({
          category: 'FUEL',
          occurredAt: '2026-09-01T10:00:00Z',
          vendor: 'Shell',
          quantity: '50',
          quantityUnit: 'LITER',
          odometer: 10_000,
          amount: { amountMinor: 9_000, currency: 'EUR' },
        }),
        row({
          category: 'FUEL',
          occurredAt: '2026-09-11T10:00:00Z',
          vendor: 'shell ',
          quantity: '40',
          quantityUnit: 'LITER',
          odometer: 10_600,
          amount: { amountMinor: 7_600, currency: 'EUR' },
        }),
        row({
          category: 'FUEL',
          occurredAt: '2026-09-21T10:00:00Z',
          vendor: 'Aral',
          quantity: '10',
          quantityUnit: 'LITER',
          odometer: 11_200,
          amount: { amountMinor: 1_700, currency: 'EUR' },
        }),
        row({
          category: 'CHARGING',
          occurredAt: '2026-09-15T10:00:00Z',
          energyKwh: '20',
          amount: { amountMinor: 800, currency: 'EUR' },
        }),
      ],
      { currency: 'EUR', from: '2026-08-23T00:00:00Z', now: NOW },
    );
    const fuel = buildRefuelReport(report);
    expect(fuel.fills).toBe(4);
    expect(fuel.daysBetween).toBeCloseTo(20 / 3);
    expect(fuel.distanceBetween).toBe(600);
    expect(fuel.units.map((unit) => [unit.unit, unit.quantity, unit.fills])).toEqual([
      ['LITER', 100, 3],
      ['KWH', 20, 1],
    ]);
    expect(fuel.units[0]!.pricePerUnitMinor).toBeCloseTo(183);
    // "Shell" and "shell " are one place; Aral is cheaper per litre and so comes first.
    expect(fuel.units[0]!.places.map((place) => [place.vendor, place.fills])).toEqual([
      ['Aral', 1],
      ['Shell', 2],
    ]);
  });

  it('weights consumption by distance, inside the window only', () => {
    const points = [
      {
        occurredAt: '2026-01-01T00:00:00Z',
        quantity: 99,
        distanceCovered: 100,
        per100Km: 99,
        distancePerUnit: 1,
      },
      {
        occurredAt: '2026-09-01T00:00:00Z',
        quantity: 30,
        distanceCovered: 500,
        per100Km: 6,
        distancePerUnit: 16.7,
      },
      {
        occurredAt: '2026-09-10T00:00:00Z',
        quantity: 8,
        distanceCovered: 100,
        per100Km: 8,
        distancePerUnit: 12.5,
      },
    ];
    const result = efficiencyInWindow(points, Date.parse('2026-08-01T00:00:00Z'), true);
    expect(result?.average).toBeCloseTo((38 / 600) * 100);
    expect(result?.best).toBe(6);
    expect(result?.worst).toBe(8);
    expect(efficiencyInWindow(points, NOW.getTime(), true)).toBeNull();
  });

  it('measures distance from the readings inside the window', () => {
    const readings = [
      { occurredAt: '2026-01-01T00:00:00Z', odometer: 1_000 },
      { occurredAt: '2026-09-01T00:00:00Z', odometer: 5_000 },
      { occurredAt: '2026-09-20T00:00:00Z', odometer: 5_800 },
      { occurredAt: '2026-09-21T00:00:00Z', odometer: null },
    ];
    expect(distanceInWindow(readings, Date.parse('2026-08-01T00:00:00Z'), NOW.getTime())).toBe(800);
    expect(
      distanceInWindow(readings, Date.parse('2026-09-10T00:00:00Z'), NOW.getTime()),
    ).toBeNull();
  });

  it('nets income against the same window’s spend, and says when it lost money', () => {
    const spend = buildSpendReport(
      [
        row({
          category: 'FUEL',
          occurredAt: '2026-09-02T10:00:00Z',
          amount: { amountMinor: 30_000, currency: 'EUR' },
        }),
      ],
      { currency: 'EUR', from: '2026-08-23T00:00:00Z', now: NOW },
    );
    const income = buildIncomeReport(
      [
        {
          id: 'a',
          category: 'FARE',
          description: 'Fares',
          payer: 'Uber',
          amount: { amountMinor: 20_000, currency: 'EUR' },
          occurredAt: '2026-09-03T10:00:00Z',
        },
        {
          id: 'b',
          category: 'FARE',
          description: 'Fares',
          payer: 'Bolt',
          amount: { amountMinor: 1_000, currency: 'USD' },
          occurredAt: '2026-09-03T10:00:00Z',
        },
      ],
      spend,
    );
    expect(income.total).toBe(20_000);
    expect(income.net).toBe(-10_000);
    expect(income.excluded).toEqual([{ currency: 'USD', amountMinor: 1_000, count: 1 }]);
    expect(income.buckets.at(-1)).toEqual({ key: '2026-09', earned: 20_000, spent: 30_000 });
  });

  it('splits trips by purpose and ranks the longest', () => {
    const trip = (purpose: 'BUSINESS' | 'PERSONAL' | 'COMMUTE', distance: number, day: string) => ({
      eventId: `${purpose}-${day}`,
      occurredAt: `2026-09-${day}T10:00:00Z`,
      title: 'Trip',
      trip: { purpose, distance, deduction: null },
    });
    const routes = buildRoutesReport(
      [
        trip('BUSINESS', 120, '01'),
        trip('PERSONAL', 40, '02'),
        trip('BUSINESS', 80, '03'),
        trip('COMMUTE', 10, '04'),
      ],
      { from: '2026-08-23T00:00:00Z', now: NOW },
    );
    expect(routes.trips).toBe(4);
    expect(routes.distance).toBe(250);
    expect(routes.businessShare).toBeCloseTo(0.8);
    expect(routes.longest[0]!.trip.distance).toBe(120);
    expect(routes.buckets.at(-1)!.values).toEqual({ BUSINESS: 200, PERSONAL: 40, COMMUTE: 10 });
  });

  it('averages spend over the months owned and compares a full year with the one before', () => {
    const points = [...Array(12).fill(10_000), ...Array(12).fill(12_000)].map((amountMinor) => ({
      amountMinor,
    }));
    expect(monthlyPace(points, 36)).toEqual({
      averageMinor: 12_000,
      lastYearMinor: 144_000,
      changePercent: 20,
    });
    // Bought three months ago: three months of spend over three months, and no year to compare.
    const recent = [...Array(9).fill(0), 30_000, 30_000, 30_000].map((amountMinor) => ({
      amountMinor,
    }));
    expect(monthlyPace(recent, 3)).toEqual({
      averageMinor: 30_000,
      lastYearMinor: 90_000,
      changePercent: null,
    });
  });

  it('counts what the vehicle lost in value into what each kilometre cost', () => {
    expect(
      trueCostPerDistance({
        runningMinor: 363_300,
        paidMinor: 8_450_000,
        worthMinor: 7_150_000,
        distance: 20_000,
      }),
    ).toEqual({ perDistanceMinor: 83.165, includesDepreciation: true });
    expect(
      trueCostPerDistance({ runningMinor: 1_000, paidMinor: null, worthMinor: null, distance: 0 }),
    ).toBeNull();
  });

  it('annualises depreciation and distance from whole periods only', () => {
    const local = new Date('2026-09-23T12:00:00');
    expect(depreciationPerYear(8_450_000, 7_150_000, '2022-04-01', local)).toBe(290_147);
    expect(depreciationPerYear(8_450_000, 7_150_000, '2026-09-01', local)).toBeNull();
    expect(
      distancePerYear(
        [
          { year: 2024, distance: 8_000 },
          { year: 2025, distance: 10_000 },
          { year: 2026, distance: 4_000 },
        ],
        local,
      ),
    ).toBe(9_000);
  });
});
