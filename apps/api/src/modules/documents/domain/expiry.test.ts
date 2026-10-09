import { describe, expect, it } from 'vitest';
import { daysUntil, isExpiringSoon } from './expiry';

describe('daysUntil', () => {
  it('counts whole days forward', () => {
    expect(daysUntil('2026-09-18', '2026-09-08')).toBe(10);
  });

  it('is negative once the date has passed', () => {
    expect(daysUntil('2026-08-08', '2026-09-08')).toBe(-31);
  });

  it('is zero on the day itself', () => {
    expect(daysUntil('2026-09-08', '2026-09-08')).toBe(0);
  });

  /*
   * The reason both sides are date strings. Parsing them as local timestamps would make a
   * document that expires on the 18th read as 9 days away for anyone west of UTC, and the
   * reminder would go out a day late.
   */
  it('crosses a daylight-saving boundary without losing or gaining a day', () => {
    // Europe changes clocks on 25 October 2026; the count is still 31 days.
    expect(daysUntil('2026-11-10', '2026-10-10')).toBe(31);
  });
});

describe('isExpiringSoon', () => {
  const today = '2026-09-08';

  it('is false for a document with no expiry date at all', () => {
    expect(isExpiringSoon(null, today)).toBe(false);
  });

  it('is true inside the horizon', () => {
    expect(isExpiringSoon('2026-10-01', today)).toBe(true);
  });

  it('is false beyond it', () => {
    expect(isExpiringSoon('2027-01-01', today)).toBe(false);
  });

  it('includes the last day of the horizon rather than dropping it', () => {
    expect(isExpiringSoon('2026-11-07', today)).toBe(true);
    expect(isExpiringSoon('2026-11-08', today)).toBe(false);
  });

  /** Already expired is more urgent than expiring, not less — it must not fall out. */
  it('still counts a document that expired last month', () => {
    expect(isExpiringSoon('2026-08-01', today)).toBe(true);
  });
});
