/**
 * Cursor pagination (Architecture.md §101).
 *
 * Offset pagination drifts: rows inserted while a user is reading page 2 push items down,
 * so page 3 repeats what page 2 already showed. A cursor anchored to the last row of the
 * previous page is stable regardless of what was written in between.
 */

import { ValidationError } from './errors';

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly pagination: {
    readonly nextCursor: string | null;
    readonly hasMore: boolean;
  };
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Opaque on purpose: base64url so clients treat it as a token and do not build their own. */
export function encodeCursor(parts: readonly (string | number | Date)[]): string {
  const serialised = parts
    .map((part) => (part instanceof Date ? part.toISOString() : String(part)))
    .join('\u0000');
  return Buffer.from(serialised, 'utf8').toString('base64url');
}

/**
 * Decodes the (timestamp, id) cursor every collection here uses, and validates both halves.
 *
 * `decodeCursor` alone is not enough: base64url decoding is lenient, so an arbitrary string
 * decodes to garbage rather than throwing, and the garbage then becomes an Invalid Date
 * whose SQL comparison matches nothing in particular — the endpoint quietly returns the
 * first page as if the cursor were absent. Validating here turns that into a 400.
 */
export function decodeKeysetCursor(cursor: string): { at: Date; id: string } {
  const [timestamp, id, ...rest] = decodeCursor(cursor);
  const at = timestamp ? new Date(timestamp) : new Date(Number.NaN);

  if (rest.length > 0 || !id || !UUID_PATTERN.test(id) || Number.isNaN(at.getTime())) {
    throw new ValidationError('Invalid cursor', { cursor: 'Malformed pagination cursor' });
  }
  return { at, id };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(cursor: string): string[] {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parts = decoded.split('\u0000');
    if (parts.length === 0 || parts[0] === '') throw new Error('empty cursor');
    return parts;
  } catch {
    throw new ValidationError('Invalid cursor', { cursor: 'Malformed pagination cursor' });
  }
}

/**
 * Turns `limit + 1` rows into a page. Fetching one extra row is how `hasMore` is known
 * without a second COUNT query — and a COUNT over a filtered timeline is the expensive
 * half of the request.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => string,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    pagination: {
      nextCursor: hasMore && last ? toCursor(last) : null,
      hasMore,
    },
  };
}

export function normaliseLimit(requested: number | undefined): number {
  if (requested === undefined) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_SIZE);
}
