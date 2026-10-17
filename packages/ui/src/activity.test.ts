import { describe, expect, it } from 'vitest';
import {
  amountOnly,
  dayBucket,
  daysUntil,
  digitsOnly,
  dueGauge,
  spanOfDays,
  groupByMonth,
  localDay,
  odometerDeltas,
  shortAge,
  stampForDay,
} from './activity';

const entry = (id: string, day: string, odometer: number | null, unit = 'KM') => ({
  id,
  occurredAt: `${day}T12:00:00Z`,
  odometer,
  odometerUnit: odometer === null ? null : unit,
});

describe('groupByMonth', () => {
  it('keeps the given order and starts a group when the month changes', () => {
    const groups = groupByMonth([
      entry('a', '2026-09-12', null),
      entry('b', '2026-09-03', null),
      entry('c', '2026-08-27', null),
    ]);
    expect(groups.map((group) => [group.key, group.label, group.items.length])).toEqual([
      ['2026-09', 'September 2026', 2],
      ['2026-08', 'August 2026', 1],
    ]);
  });
});

describe('odometerDeltas', () => {
  it('measures each rise from the previous reading, skipping gaps and unit changes', () => {
    const deltas = odometerDeltas([
      entry('d', '2026-09-12', 42_800),
      entry('c', '2026-09-03', null),
      entry('b', '2026-08-27', 42_310),
      entry('x', '2026-08-20', 26_000, 'MI'),
      entry('a', '2026-08-14', 41_900),
    ]);
    expect([...deltas]).toEqual([['d', 490]]);
  });

  it('keeps a drop as a negative change, and an unchanged reading as none', () => {
    const deltas = odometerDeltas([
      entry('c', '2026-09-20', 41_880),
      entry('b', '2026-09-12', 41_880),
      entry('a', '2026-09-03', 42_000),
    ]);
    expect([...deltas]).toEqual([['b', -120]]);
  });
});

describe('dates', () => {
  const now = new Date(2026, 8, 16, 23, 30);
  it('reads the local calendar day, including across a month', () => {
    expect(localDay({}, now)).toBe('2026-09-16');
    expect(localDay({ days: -16 }, now)).toBe('2026-08-31');
    expect(localDay({ months: 1 }, now)).toBe('2026-10-16');
  });
  it('counts days and buckets between local midnights', () => {
    expect(daysUntil('2026-09-16', now)).toBe(0);
    expect(daysUntil('2026-09-10', now)).toBe(-6);
    expect(dayBucket(new Date(2026, 8, 16, 0, 5).toISOString(), now)).toBe('Today');
    expect(dayBucket(new Date(2026, 8, 15, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(dayBucket(new Date(2026, 8, 12).toISOString(), now)).toBe('This week');
    expect(dayBucket(new Date(2026, 7, 1).toISOString(), now)).toBe('Earlier');
  });
  it('stamps today with the moment, and another day with the same time of day', () => {
    expect(stampForDay('2026-09-16', now)).toBe(now.toISOString());
    const earlier = new Date(stampForDay('2026-09-14', now));
    expect([earlier.getFullYear(), earlier.getMonth(), earlier.getDate()]).toEqual([2026, 8, 14]);
    expect([earlier.getHours(), earlier.getMinutes()]).toEqual([23, 30]);
  });

  it('writes a short age', () => {
    expect(shortAge(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('now');
    expect(shortAge(new Date(now.getTime() - 12 * 60_000).toISOString(), now)).toBe('12m');
    expect(shortAge(new Date(now.getTime() - 3 * 3_600_000).toISOString(), now)).toBe('3h');
    expect(shortAge(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now)).toBe('2d');
  });
});

describe('typed figures', () => {
  it('cleans odometers and amounts', () => {
    expect(digitsOnly('042,890 km')).toBe('42890');
    expect(amountOnly('$0089.567')).toBe('89.56');
    expect(amountOnly('12.3.4')).toBe('12.34');
  });
});

describe('dueGauge', () => {
  const plan = {
    status: 'OK',
    lastPerformedAt: '2026-01-01T00:00:00Z',
    nextDueDate: '2027-01-01',
    lastPerformedOdometer: 40_000,
    nextDueOdometer: 50_000,
    daysRemaining: 107,
    distanceRemaining: 7_200,
  };

  it('leads with whichever interval is further along', () => {
    const time = dueGauge(plan)!;
    expect(time.byDistance).toBe(false);
    expect(time.remaining).toBe(107);
    expect(time.progress).toBeCloseTo(258 / 365, 2);

    const distance = dueGauge({ ...plan, distanceRemaining: 500 })!;
    expect(distance).toEqual({ byDistance: true, remaining: 500, progress: 0.95 });
  });

  it('goes past a full interval when overdue, and has nothing to read without a baseline', () => {
    expect(dueGauge({ ...plan, distanceRemaining: -1_000 })!.progress).toBeCloseTo(1.1);
    expect(dueGauge({ ...plan, status: 'UNSCHEDULED' })).toBeNull();
    expect(dueGauge({ ...plan, lastPerformedAt: null, lastPerformedOdometer: null })).toBeNull();
  });

  it('says spans the way a person does', () => {
    expect(spanOfDays(1)).toBe('1 day');
    expect(spanOfDays(45)).toBe('45 days');
    expect(spanOfDays(90)).toBe('3 months');
    expect(spanOfDays(800)).toBe('2 years');
  });
});
