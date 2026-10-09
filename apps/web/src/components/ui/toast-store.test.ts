import { afterEach, expect, it, vi } from 'vitest';
import { hold, raise, snapshot } from './toast-store';

afterEach(() => vi.useRealTimers());

it('merges repeats, holds the clock while held, and expires on time', () => {
  vi.useFakeTimers();
  raise('success', 'Saved');
  raise('success', 'Saved');
  expect(snapshot()).toMatchObject([{ text: 'Saved', count: 2 }]);

  vi.advanceTimersByTime(1000);
  hold(true);
  vi.advanceTimersByTime(10_000); // held: nothing expires
  expect(snapshot()).toHaveLength(1);

  hold(false);
  vi.advanceTimersByTime(1500); // 2500 of 2600 ms used
  expect(snapshot()).toHaveLength(1);
  vi.advanceTimersByTime(100);
  expect(snapshot()).toHaveLength(0);
});
