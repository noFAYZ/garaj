import { describe, expect, it } from 'vitest';
import { bucketFor, bucketTasks, isOpen, localDateIn } from './buckets';

const task = (dueDate: string | null, status = 'TODO') => ({ dueDate, status });

describe('localDateIn', () => {
  /*
   * The reason bucketing is server-side at all. At this instant it is already tomorrow in
   * Auckland and still yesterday evening in Los Angeles, so "is this due today?" has three
   * different correct answers depending on where the user is.
   */
  it('gives a different calendar date for the same instant in different zones', () => {
    const instant = new Date('2026-03-01T11:00:00Z');

    expect(localDateIn('Pacific/Auckland', instant)).toBe('2026-03-02');
    expect(localDateIn('UTC', instant)).toBe('2026-03-01');
    expect(localDateIn('America/Los_Angeles', instant)).toBe('2026-03-01');
  });

  it('crosses midnight correctly in a zone behind UTC', () => {
    const instant = new Date('2026-03-01T04:00:00Z');
    expect(localDateIn('America/Los_Angeles', instant)).toBe('2026-02-28');
  });

  /*
   * Adding a fixed offset would be wrong twice a year. On this date Auckland is on daylight
   * saving (UTC+13); in July it is UTC+12.
   */
  it('respects daylight saving rather than a fixed offset', () => {
    expect(localDateIn('Pacific/Auckland', new Date('2026-01-15T11:30:00Z'))).toBe('2026-01-16');
    expect(localDateIn('Pacific/Auckland', new Date('2026-07-15T11:30:00Z'))).toBe('2026-07-15');
  });

  it('falls back to UTC for a timezone that is not recognised', () => {
    expect(localDateIn('Mars/Olympus_Mons', new Date('2026-03-01T11:00:00Z'))).toBe('2026-03-01');
  });
});

describe('bucketFor', () => {
  const today = '2026-03-01';

  it('sorts a task by how far away its due date is', () => {
    expect(bucketFor(task('2026-02-28'), today)).toBe('overdue');
    expect(bucketFor(task('2026-03-01'), today)).toBe('today');
    expect(bucketFor(task('2026-03-05'), today)).toBe('thisWeek');
    expect(bucketFor(task('2026-03-08'), today)).toBe('thisWeek');
    expect(bucketFor(task('2026-03-09'), today)).toBe('upcoming');
  });

  it('puts a task with no due date in someday, never in a count', () => {
    expect(bucketFor(task(null), today)).toBe('someday');
  });

  it('crosses a month boundary without arithmetic drift', () => {
    expect(bucketFor(task('2026-03-03'), '2026-02-27')).toBe('thisWeek');
    expect(bucketFor(task('2026-02-26'), '2026-03-01')).toBe('overdue');
  });

  it('handles a leap day', () => {
    expect(bucketFor(task('2028-02-29'), '2028-02-29')).toBe('today');
    expect(bucketFor(task('2028-03-01'), '2028-02-29')).toBe('thisWeek');
  });
});

describe('isOpen', () => {
  it('treats completed and cancelled as closed', () => {
    expect(isOpen(task('2026-03-01', 'TODO'))).toBe(true);
    expect(isOpen(task('2026-03-01', 'IN_PROGRESS'))).toBe(true);
    expect(isOpen(task('2026-03-01', 'BLOCKED'))).toBe(true);
    expect(isOpen(task('2026-03-01', 'COMPLETED'))).toBe(false);
    expect(isOpen(task('2026-03-01', 'CANCELLED'))).toBe(false);
  });
});

describe('bucketTasks', () => {
  it('splits a mixed list and drops closed work', () => {
    const buckets = bucketTasks(
      [
        task('2026-02-20'),
        task('2026-03-01'),
        task('2026-03-04'),
        task('2026-04-01'),
        task(null),
        task('2026-02-01', 'COMPLETED'),
      ],
      '2026-03-01',
    );

    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.today).toHaveLength(1);
    expect(buckets.thisWeek).toHaveLength(1);
    expect(buckets.upcoming).toHaveLength(1);
    expect(buckets.someday).toHaveLength(1);
  });

  /* A blocked task is still work someone is waiting on — it stays in the counts. */
  it('keeps blocked tasks in their bucket', () => {
    const buckets = bucketTasks([task('2026-02-20', 'BLOCKED')], '2026-03-01');
    expect(buckets.overdue).toHaveLength(1);
  });

  it('preserves the order it was given, so the SQL sort survives', () => {
    const buckets = bucketTasks(
      [task('2026-02-01'), task('2026-02-15'), task('2026-02-28')],
      '2026-03-01',
    );

    expect(buckets.overdue.map((entry) => entry.dueDate)).toEqual([
      '2026-02-01',
      '2026-02-15',
      '2026-02-28',
    ]);
  });

  it('returns empty buckets rather than undefined for an empty list', () => {
    const buckets = bucketTasks([], '2026-03-01');
    expect(buckets).toEqual({ overdue: [], today: [], thisWeek: [], upcoming: [], someday: [] });
  });
});
