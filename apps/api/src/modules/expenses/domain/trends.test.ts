import { describe, expect, it } from 'vitest';
import { distancePerYear, ownershipCurve } from './trends';

const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('ownershipCurve', () => {
  it('draws the quiet months, so a busy one reads as busy', () => {
    const points = ownershipCurve(
      [
        { month: '2026-01', amountMinor: 5_000 },
        { month: '2026-04', amountMinor: 90_000 },
      ],
      null,
      on('2026-04-20'),
    );

    expect(points.map((point) => point.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
    ]);
    expect(points.map((point) => point.spentMinor)).toEqual([5_000, 0, 0, 90_000]);
    expect(points.map((point) => point.cumulativeMinor)).toEqual([5_000, 5_000, 5_000, 95_000]);
  });

  it('starts the curve at the price, in the month it was bought', () => {
    const points = ownershipCurve(
      [{ month: '2026-02', amountMinor: 10_000 }],
      { amountMinor: 1_500_000, occurredAt: on('2026-01-15') },
      on('2026-02-10'),
    );

    expect(points[0]).toEqual({
      month: '2026-01',
      spentMinor: 1_500_000,
      cumulativeMinor: 1_500_000,
    });
    expect(points.at(-1)?.cumulativeMinor).toBe(1_510_000);
  });

  it('crosses a year boundary', () => {
    const points = ownershipCurve(
      [
        { month: '2025-11', amountMinor: 1_000 },
        { month: '2026-01', amountMinor: 2_000 },
      ],
      null,
      on('2026-01-05'),
    );
    expect(points.map((point) => point.month)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('has nothing to draw with no records', () => {
    expect(ownershipCurve([], null, on('2026-01-01'))).toEqual([]);
  });
});

describe('distancePerYear', () => {
  it('splits a gap across the years it spans, by days', () => {
    const years = distancePerYear(
      [
        { occurredAt: on('2025-12-17'), odometer: 10_000, odometerUnit: 'KM' },
        // 30 days later: 14.5 of them in 2025 and 15.5 in 2026, so 1000 km splits 483/517
        // rather than evenly — which is the point of splitting by days at all.
        { occurredAt: on('2026-01-16'), odometer: 11_000, odometerUnit: 'KM' },
      ],
      'KM',
    );

    expect(years.map((year) => year.year)).toEqual([2025, 2026]);
    expect(years[0]!.distance).toBe(483);
    expect(years[1]!.distance).toBe(517);
    expect(years[0]!.distance + years[1]!.distance).toBe(1_000);
  });

  it('converts a reading taken in the other unit', () => {
    const [year] = distancePerYear(
      [
        { occurredAt: on('2026-02-01'), odometer: 1_000, odometerUnit: 'MI' },
        { occurredAt: on('2026-03-01'), odometer: 1_100, odometerUnit: 'MI' },
      ],
      'KM',
    );
    // 100 miles is 160.9 km.
    expect(year?.distance).toBe(161);
  });

  it('ends the run on a reading that went backwards', () => {
    const years = distancePerYear(
      [
        { occurredAt: on('2026-01-01'), odometer: 50_000, odometerUnit: 'KM' },
        { occurredAt: on('2026-02-01'), odometer: 51_000, odometerUnit: 'KM' },
        // A replacement cluster reading from zero: not minus 51,000 km of driving.
        { occurredAt: on('2026-03-01'), odometer: 10, odometerUnit: 'KM' },
        { occurredAt: on('2026-04-01'), odometer: 510, odometerUnit: 'KM' },
      ],
      'KM',
    );
    expect(years).toHaveLength(1);
    expect(years[0]!.distance).toBe(1_500);
  });

  it('says nothing from a single reading', () => {
    expect(
      distancePerYear([{ occurredAt: on('2026-01-01'), odometer: 10, odometerUnit: 'KM' }], 'KM'),
    ).toEqual([]);
  });
});
