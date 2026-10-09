import { and, desc, eq, gte, inArray, isNotNull, lt, lte, or, type SQL } from 'drizzle-orm';
import { idConflict } from '../../../../infrastructure/idempotency';
import { schema, type Executor } from '@vehicle-os/database';
import type { EventType } from '@vehicle-os/domain';

export type EventRow = typeof schema.vehicleEvents.$inferSelect;

export interface ListEventsFilters {
  readonly vehicleId: string;
  readonly eventTypes?: readonly EventType[];
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
  readonly cursor?: { occurredAt: Date; id: string };
}

/**
 * The timeline query (§20). Newest first, which is both how it is read and the direction the
 * `(vehicle_id, occurred_at DESC)` index is built, so Postgres walks the index rather than
 * sorting the result.
 */
export async function listEvents(db: Executor, filters: ListEventsFilters): Promise<EventRow[]> {
  const conditions: SQL[] = [eq(schema.vehicleEvents.vehicleId, filters.vehicleId)];

  if (filters.eventTypes?.length) {
    conditions.push(inArray(schema.vehicleEvents.eventType, [...filters.eventTypes]));
  }
  if (filters.from) conditions.push(gte(schema.vehicleEvents.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(schema.vehicleEvents.occurredAt, filters.to));

  if (filters.cursor) {
    /*
     * Keyset on (occurred_at, id). The id tiebreak is not optional here: entering three
     * services from one invoice gives them the same `occurred_at` to the millisecond, and
     * ordering on the timestamp alone would show one of them on both pages.
     */
    conditions.push(
      or(
        lt(schema.vehicleEvents.occurredAt, filters.cursor.occurredAt),
        and(
          eq(schema.vehicleEvents.occurredAt, filters.cursor.occurredAt),
          lt(schema.vehicleEvents.id, filters.cursor.id),
        ),
      )!,
    );
  }

  return db
    .select()
    .from(schema.vehicleEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.vehicleEvents.occurredAt), desc(schema.vehicleEvents.id))
    .limit(filters.limit + 1);
}

export async function findEventById(
  db: Executor,
  vehicleId: string,
  eventId: string,
): Promise<EventRow | null> {
  const [row] = await db
    .select()
    .from(schema.vehicleEvents)
    .where(
      and(
        eq(schema.vehicleEvents.id, eventId),
        // Scoped to the vehicle so a valid event id from another garage cannot be read
        // through a vehicle the caller does have access to.
        eq(schema.vehicleEvents.vehicleId, vehicleId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Inserts an entry, or returns null if one already carries that id — a client replaying a queued
 * write whose acknowledgement was lost (`infrastructure/idempotency`).
 */
export async function insertEvent(
  db: Executor,
  values: typeof schema.vehicleEvents.$inferInsert,
): Promise<{ row: EventRow; created: boolean }> {
  const [row] = await db
    .insert(schema.vehicleEvents)
    .values(values)
    .onConflictDoNothing({ target: schema.vehicleEvents.id })
    .returning();
  if (row) return { row, created: true };

  /*
   * Nothing inserted, so a row already carries this id: the client is replaying a queued write.
   * Only reachable when the client chose the id — the server's own is fresh every time.
   */
  const existing = values.id ? await findEventAnywhere(db, values.id) : undefined;
  if (!existing) throw idConflict('timeline entry');
  return { row: existing, created: false };
}

/** By id alone, for resolving a replay. Callers check the vehicle themselves. */
async function findEventAnywhere(db: Executor, id: string): Promise<EventRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.vehicleEvents)
    .where(eq(schema.vehicleEvents.id, id))
    .limit(1);
  return row;
}

export async function updateEvent(
  db: Executor,
  eventId: string,
  changes: Partial<typeof schema.vehicleEvents.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.vehicleEvents).set(changes).where(eq(schema.vehicleEvents.id, eventId));
}

export async function deleteEvent(db: Executor, eventId: string): Promise<void> {
  await db.delete(schema.vehicleEvents).where(eq(schema.vehicleEvents.id, eventId));
}

/**
 * The most recent odometer reading recorded *before* a given moment.
 *
 * Used to judge whether a new reading is a regression. It has to be the reading before the
 * event's own date rather than simply the latest one: entering an old receipt should be
 * compared against what the odometer said back then, not against today's figure.
 */
export async function latestOdometerBefore(
  db: Executor,
  vehicleId: string,
  before: Date,
): Promise<{ odometer: number; odometerUnit: 'KM' | 'MI' } | null> {
  const [row] = await db
    .select({
      odometer: schema.vehicleEvents.odometer,
      odometerUnit: schema.vehicleEvents.odometerUnit,
    })
    .from(schema.vehicleEvents)
    .where(
      and(
        eq(schema.vehicleEvents.vehicleId, vehicleId),
        lt(schema.vehicleEvents.occurredAt, before),
        // Most events carry no odometer at all — a note, a document, an insurance renewal.
        // Without this the query returns the newest event and then reports "no reading".
        isNotNull(schema.vehicleEvents.odometer),
        isNotNull(schema.vehicleEvents.odometerUnit),
      ),
    )
    .orderBy(desc(schema.vehicleEvents.occurredAt))
    .limit(1);

  if (row?.odometer == null || !row.odometerUnit) return null;
  return { odometer: row.odometer, odometerUnit: row.odometerUnit };
}
