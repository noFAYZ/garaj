import { describe, expect, it } from 'vitest';
import { monthlySeries, windowStart } from './monthly';

const now = new Date('2026-03-15T12:00:00Z');

describe('monthlySeries', () => {
  it('fills a month with no spending as zero rather than omitting it', () => {
    const series = monthlySeries([{ month: '2026-01', amountMinor: 5000 }], 3, now);

    expect(series).toEqual([
      { month: '2026-01', amountMinor: 5000 },
      { month: '2026-02', amountMinor: 0 },
      { month: '2026-03', amountMinor: 0 },
    ]);
  });

  it('counts the current month as part of the window', () => {
    const series = monthlySeries([{ month: '2026-03', amountMinor: 100 }], 12, now);

    expect(series).toHaveLength(12);
    expect(series.at(0)?.month).toBe('2025-04');
    expect(series.at(-1)).toEqual({ month: '2026-03', amountMinor: 100 });
  });

  it('crosses a year boundary without repeating a month', () => {
    const series = monthlySeries([], 4, new Date('2026-02-01T00:00:00Z'));

    expect(series.map((point) => point.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('ignores a month outside the window rather than bending the range to it', () => {
    const series = monthlySeries([{ month: '2020-01', amountMinor: 999 }], 3, now);

    expect(series.every((point) => point.amountMinor === 0)).toBe(true);
  });

  it('starts the window at the first of the earliest month', () => {
    expect(windowStart(3, now).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
