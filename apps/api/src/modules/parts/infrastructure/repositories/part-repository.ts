import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { PartDraft } from '../../domain/part-lines';

const parts = schema.vehicleParts;
const events = schema.vehicleEvents;

export type PartRow = typeof parts.$inferSelect;

/** A line with the date and reading of the entry it was fitted with, when it has one. */
export interface PartWithEntry {
  readonly part: PartRow;
  readonly entryAt: Date | null;
  readonly entryOdometer: number | null;
  readonly entryOdometerUnit: PartRow['odometerUnit'];
}

/**
 * ponytail: a whole vehicle's lines in one read — dozens, rarely hundreds. Capped so a runaway
 * import cannot make it unbounded; paginate by position if a vehicle ever gets near it.
 */
const HISTORY_CAP = 2_000;

/**
 * Lines newest first by when they were fitted: the entry's date, the line's own, or — for "fitted
 * now, date unknown" — when it was recorded. `currentParts` relies on this order.
 */
export async function listVehicleParts(
  db: Executor,
  vehicleId: string,
  ids?: readonly string[],
): Promise<PartWithEntry[]> {
  return db
    .select({
      part: parts,
      entryAt: events.occurredAt,
      entryOdometer: events.odometer,
      entryOdometerUnit: events.odometerUnit,
    })
    .from(parts)
    .leftJoin(events, eq(events.id, parts.eventId))
    .where(
      ids
        ? and(eq(parts.vehicleId, vehicleId), inArray(parts.id, [...ids]))
        : eq(parts.vehicleId, vehicleId),
    )
    .orderBy(
      desc(sql`coalesce(${events.occurredAt}, ${parts.fittedAt}, ${parts.createdAt})`),
      desc(parts.createdAt),
      desc(parts.id),
    )
    .limit(HISTORY_CAP);
}

/**
 * Lines whose warranty ends between `from` and `to` (inclusive, `YYYY-MM-DD`) and that are still
 * fitted — a battery replaced since has nobody to warn about its old warranty. Two bounded reads:
 * the lines in the window (the partial index), then what is fitted now on just those vehicles.
 */
export async function listExpiringWarranties(db: Executor, from: string, to: string) {
  const candidates = await db
    .select({
      part: parts,
      garageId: schema.vehicles.garageId,
      nickname: schema.vehicles.nickname,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      vehicleType: schema.vehicles.vehicleType,
    })
    .from(parts)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, parts.vehicleId))
    .where(
      and(
        gte(parts.warrantyUntil, from),
        lte(parts.warrantyUntil, to),
        isNull(schema.vehicles.deletedAt),
      ),
    );

  // Other holds unrelated things, each its own: every one of them is still fitted.
  const tracked = candidates.filter((row) => row.part.position !== 'OTHER');
  if (tracked.length === 0) return candidates;
  const fitted = await db
    .selectDistinctOn([parts.vehicleId, parts.position], { id: parts.id })
    .from(parts)
    .leftJoin(events, eq(events.id, parts.eventId))
    .where(
      and(
        inArray(parts.vehicleId, [...new Set(tracked.map((row) => row.part.vehicleId))]),
        inArray(parts.position, [...new Set(tracked.map((row) => row.part.position))]),
        eq(parts.action, 'REPLACED'),
      ),
    )
    .orderBy(
      parts.vehicleId,
      parts.position,
      desc(sql`coalesce(${events.occurredAt}, ${parts.fittedAt}, ${parts.createdAt})`),
      desc(parts.createdAt),
      desc(parts.id),
    );
  const now = new Set(fitted.map((row) => row.id));
  return candidates.filter((row) => row.part.position === 'OTHER' || now.has(row.part.id));
}

/** How many products the forms are offered, most recently used first. */
const LIBRARY_SIZE = 300;

/**
 * The garage's products: one row per product per position across its vehicles, the latest line
 * of each, newest first. Read straight off the lines — there is no product table to drift from
 * them. Only lines that name something: an unknown product is nothing to offer again.
 *
 * Every vehicle in the garage, including ones a driver of this vehicle cannot open: a product's
 * name ("Castrol Edge 5W-30") says nothing about the vehicle it went into.
 */
export async function listGarageProducts(db: Executor, garageId: string) {
  const key = [parts.brand, parts.name, parts.spec, parts.partNumber].map(
    (column) => sql`lower(coalesce(${column}, ''))`,
  );
  const rows = await db
    .selectDistinctOn([parts.position, ...key], {
      position: parts.position,
      brand: parts.brand,
      name: parts.name,
      spec: parts.spec,
      partNumber: parts.partNumber,
      quantity: parts.quantity,
      unit: parts.unit,
      createdAt: parts.createdAt,
    })
    .from(parts)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, parts.vehicleId))
    .where(
      and(
        eq(schema.vehicles.garageId, garageId),
        or(isNotNull(parts.brand), isNotNull(parts.name), isNotNull(parts.partNumber)),
      ),
    )
    .orderBy(parts.position, ...key, desc(parts.createdAt));
  // DISTINCT ON fixes the order to its key; recency is a sort of the (small) result.
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, LIBRARY_SIZE);
}

/**
 * Lines inserted once: a replayed write whose reply went missing brings the same client ids and
 * changes nothing. Returns the ids that were actually written.
 */
export async function insertParts(
  tx: Executor,
  drafts: readonly PartDraft[],
  eventId: string | null,
): Promise<string[]> {
  if (drafts.length === 0) return [];
  const rows = await tx
    .insert(parts)
    .values(drafts.map((draft) => ({ ...draft, eventId })))
    .onConflictDoNothing({ target: parts.id })
    .returning({ id: parts.id });
  return rows.map((row) => row.id);
}

/** A line rewritten in place; its vehicle, entry, position and author stay as they were. */
export async function updatePart(
  tx: Executor,
  vehicleId: string,
  partId: string,
  changes: Omit<PartDraft, 'id' | 'vehicleId' | 'position' | 'createdBy'>,
): Promise<boolean> {
  const rows = await tx
    .update(parts)
    .set(changes)
    .where(and(eq(parts.id, partId), eq(parts.vehicleId, vehicleId)))
    .returning({ id: parts.id });
  return rows.length > 0;
}

export async function findPart(
  db: Executor,
  vehicleId: string,
  partId: string,
): Promise<PartRow | null> {
  const [row] = await db
    .select()
    .from(parts)
    .where(and(eq(parts.id, partId), eq(parts.vehicleId, vehicleId)))
    .limit(1);
  return row ?? null;
}

export async function deletePart(
  tx: Executor,
  vehicleId: string,
  partId: string,
): Promise<PartRow | null> {
  const [row] = await tx
    .delete(parts)
    .where(and(eq(parts.id, partId), eq(parts.vehicleId, vehicleId)))
    .returning();
  return row ?? null;
}
