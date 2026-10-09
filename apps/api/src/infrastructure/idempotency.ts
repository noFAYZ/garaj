/**
 * Creates that can be sent twice (Architecture.md §66).
 *
 * A phone records offline and sends later, so every queued write is replayed until it is
 * acknowledged — and the acknowledgement is the part most likely to be lost: the row commits, the
 * van enters a tunnel, the reply never arrives. Without a defence, that turns one fill-up into
 * two, and nothing after the fact can tell which of the pair was the accident.
 *
 * The defence is the client choosing the primary key. The second attempt carries the same id, the
 * insert conflicts, and the row already there is returned as though it had just been made — so
 * the caller sees one record either way.
 *
 * The shape, in each create that supports it:
 *
 *   1. `insert(...).onConflictDoNothing({ target: table.id })` — returns nothing on a replay.
 *   2. Nothing returned means the row exists: skip the once-only work beside it — the audit
 *      entry, the outbox message, the odometer moving forward — and return the existing row.
 *   3. If it cannot then be read back, the id belongs to a record this caller cannot see
 *      (someone else's, or soft-deleted). That is `idConflict()`, not a replay.
 *
 * A create without a client id keeps the server's own and is not idempotent, which is correct:
 * there is nothing to match a second attempt against.
 */

import { ConflictError } from './errors';

/** The id is taken by a row this caller cannot see — someone else's, or soft-deleted. */
export const idConflict = (resource = 'record') =>
  new ConflictError('ID_CONFLICT', `That id is already in use by a ${resource} you cannot access.`);
