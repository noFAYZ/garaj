import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, fromDateOnly, startOfUtcDay, toDateOnly } from './dates';

const at = (iso: string) => new Date(iso);

describe('addMonths', () => {
  it('advances a normal date', () => {
    expect(toDateOnly(addMonths(at('2026-03-15T00:00:00Z'), 6))).toBe('2026-09-15');
  });

  /*
   * The bug this exists to prevent: `setMonth` on 31 Jan rolls into March, so an oil
   * change scheduled "every month" from the 31st silently skips February every year.
   */
  it('clamps to the last day when the target month is shorter', () => {
    expect(toDateOnly(addMonths(at('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28');
    expect(toDateOnly(addMonths(at('2026-08-31T00:00:00Z'), 1))).toBe('2026-09-30');
  });

  it('lands on 29 February in a leap year', () => {
    expect(toDateOnly(addMonths(at('2028-01-31T00:00:00Z'), 1))).toBe('2028-02-29');
  });

  it('crosses the year boundary in both directions', () => {
    expect(toDateOnly(addMonths(at('2026-11-15T00:00:00Z'), 3))).toBe('2027-02-15');
    expect(toDateOnly(addMonths(at('2026-02-15T00:00:00Z'), -3))).toBe('2025-11-15');
  });

  it('keeps the time of day', () => {
    expect(addMonths(at('2026-03-15T13:45:30.500Z'), 1).toISOString()).toBe(
      '2026-04-15T13:45:30.500Z',
    );
  });

  it('is a no-op for zero months', () => {
    expect(addMonths(at('2026-01-31T00:00:00Z'), 0).toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(toDateOnly(addDays(at('2026-01-30T00:00:00Z'), 5))).toBe('2026-02-04');
  });
});

describe('daysBetween', () => {
  it('counts forward and backward', () => {
    expect(daysBetween(at('2026-01-01T00:00:00Z'), at('2026-01-11T00:00:00Z'))).toBe(10);
    expect(daysBetween(at('2026-01-11T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toBe(-10);
  });

  /*
   * Compared by calendar day, not elapsed hours: 23:59 today to 00:01 tomorrow is one day
   * away, and a "due tomorrow" reminder that reads it as zero fires a day early.
   */
  it('ignores the time of day', () => {
    expect(daysBetween(at('2026-01-01T23:59:00Z'), at('2026-01-02T00:01:00Z'))).toBe(1);
    expect(daysBetween(at('2026-01-01T00:01:00Z'), at('2026-01-01T23:59:00Z'))).toBe(0);
  });
});

describe('date-only round trip', () => {
  it('survives both directions', () => {
    expect(toDateOnly(fromDateOnly('2026-09-07'))).toBe('2026-09-07');
  });

  it('rejects an unparseable value', () => {
    expect(() => fromDateOnly('not-a-date')).toThrow(TypeError);
  });

  it('truncates to midnight UTC', () => {
    expect(startOfUtcDay(at('2026-09-07T18:30:00Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });
});
