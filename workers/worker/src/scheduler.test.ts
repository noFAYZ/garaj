import { describe, expect, it } from 'vitest';
import { lastSlot } from './scheduler';

describe('lastSlot', () => {
  const daily = { name: 'daily', hour: 7 } as const;
  const monday = { name: 'weekly', hour: 6, weekday: 1 } as const;

  it('is today once the hour has passed, yesterday before it', () => {
    expect(lastSlot(daily, new Date('2026-09-28T09:00:00Z')).toISOString()).toBe(
      '2026-09-28T07:00:00.000Z',
    );
    expect(lastSlot(daily, new Date('2026-09-28T06:59:59Z')).toISOString()).toBe(
      '2026-09-27T07:00:00.000Z',
    );
  });

  it('includes the exact instant, so a timer firing on time names its own slot', () => {
    expect(lastSlot(daily, new Date('2026-09-28T07:00:00Z')).toISOString()).toBe(
      '2026-09-28T07:00:00.000Z',
    );
  });

  it('walks back to the right weekday', () => {
    // 2026-09-28 is a Monday.
    expect(lastSlot(monday, new Date('2026-09-28T12:00:00Z')).toISOString()).toBe(
      '2026-09-28T06:00:00.000Z',
    );
    expect(lastSlot(monday, new Date('2026-09-28T05:00:00Z')).toISOString()).toBe(
      '2026-09-21T06:00:00.000Z',
    );
    expect(lastSlot(monday, new Date('2026-10-03T00:00:00Z')).toISOString()).toBe(
      '2026-09-28T06:00:00.000Z',
    );
  });
});
