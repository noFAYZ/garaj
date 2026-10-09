import { expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  clamp,
  column,
  fromDay,
  monthGrid,
  ordered,
  within,
} from './calendar-math';

it('reads, steps and bounds calendar days without drifting a day', () => {
  expect(fromDay('2026-02-31')).toBeNull();
  expect(fromDay('2026-2-1')).toBeNull();
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(clamp('2027-01-01', undefined, '2026-10-05')).toBe('2026-10-05');
  expect(within('2026-10-05', '2026-10-05', '2026-10-05')).toBe(true);
  expect(ordered('2026-10-05', '2026-01-01')).toEqual(['2026-01-01', '2026-10-05']);

  // February 2026 starts on a Sunday: a Monday-first grid opens on 26 January, six weeks long.
  const grid = monthGrid(2026, 1);
  expect(grid).toHaveLength(42);
  expect(grid[0]).toBe('2026-01-26');
  expect(grid[6]).toBe('2026-02-01');
  expect(column('2026-02-01')).toBe(6);
});
