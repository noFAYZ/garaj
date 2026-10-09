import { describe, expect, it } from 'vitest';
import { isUuid, newId } from './id';

describe('newId', () => {
  it('produces a well-formed UUID', () => {
    expect(isUuid(newId())).toBe(true);
  });

  it('produces distinct ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
  });

  /*
   * The whole reason for v7 over v4: ids generated later must sort later as plain strings,
   * so a "newest first" cursor needs no companion timestamp column.
   */
  it('sorts lexicographically in generation order, including within one millisecond', () => {
    const ids = Array.from({ length: 500 }, newId);
    expect([...ids].sort()).toEqual(ids);
  });

  it('sets the version 7 nibble', () => {
    expect(newId()[14]).toBe('7');
  });
});
