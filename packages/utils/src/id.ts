/**
 * Identifiers (Architecture.md §16): UUIDv7, generated server-side.
 *
 * v7 leads with a millisecond timestamp, so ids sort chronologically. That matters more
 * than it sounds: a random v4 primary key scatters inserts across the B-tree and fragments
 * the index, and cursor pagination over "newest first" needs no second sort column when the
 * key itself is ordered.
 *
 * The `uuidv7` package is used rather than a hand-rolled generator because the spec's
 * same-millisecond monotonic counter is the part that is easy to get subtly wrong, and
 * getting it wrong breaks ordering only under load.
 */

import { uuidv7 } from 'uuidv7';

export function newId(): string {
  return uuidv7();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
