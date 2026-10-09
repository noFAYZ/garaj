import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { schema, type Executor } from '@vehicle-os/database';
import type { VehicleStatus, VehicleType } from '@vehicle-os/domain';
import type { VehicleEntity } from '../../domain/entities/vehicle';

export interface VehicleWithPhoto extends VehicleEntity {
  primaryPhoto: {
    id: string;
    storageKey: string;
    cutoutKey: string | null;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    caption: string | null;
    category: string | null;
    capturedAt: string | null;
    eventId: string | null;
    conditionAssessmentId: string | null;
    createdAt: Date;
  } | null;
}

const photoColumns = {
  id: schema.vehiclePhotos.id,
  storageKey: schema.vehiclePhotos.storageKey,
  cutoutKey: schema.vehiclePhotos.cutoutKey,
  mimeType: schema.vehiclePhotos.mimeType,
  sizeBytes: schema.vehiclePhotos.sizeBytes,
  width: schema.vehiclePhotos.width,
  height: schema.vehiclePhotos.height,
  caption: schema.vehiclePhotos.caption,
  category: schema.vehiclePhotos.category,
  capturedAt: schema.vehiclePhotos.capturedAt,
  eventId: schema.vehiclePhotos.eventId,
  conditionAssessmentId: schema.vehiclePhotos.conditionAssessmentId,
  createdAt: schema.vehiclePhotos.createdAt,
};

function baseSelect(db: Executor) {
  return db
    .select({
      vehicle: schema.vehicles,
      primaryPhoto: photoColumns,
    })
    .from(schema.vehicles)
    .leftJoin(
      schema.vehiclePhotos,
      and(
        eq(schema.vehiclePhotos.id, schema.vehicles.primaryPhotoId),
        isNull(schema.vehiclePhotos.deletedAt),
      ),
    );
}

type Row = {
  vehicle: typeof schema.vehicles.$inferSelect;
  primaryPhoto: VehicleWithPhoto['primaryPhoto'];
};

function toEntity(row: Row): VehicleWithPhoto {
  return {
    ...row.vehicle,
    // A left join with no match yields an object of nulls rather than null itself; the id
    // is what distinguishes "no primary photo" from "a photo with no caption".
    primaryPhoto: row.primaryPhoto?.id ? row.primaryPhoto : null,
  };
}

export interface ListVehiclesFilters {
  readonly garageIds: readonly string[];
  readonly garageId?: string;
  readonly vehicleType?: VehicleType;
  readonly status?: VehicleStatus;
  readonly limit: number;
  readonly cursor?: { createdAt: Date; id: string };
}

/**
 * Vehicles across every garage the caller belongs to.
 *
 * `garageIds` comes from the actor's memberships, never from the request, so the tenant
 * filter is applied by construction — there is no code path that lists vehicles without it.
 */
export async function listVehicles(
  db: Executor,
  filters: ListVehiclesFilters,
): Promise<VehicleWithPhoto[]> {
  if (filters.garageIds.length === 0) return [];

  const conditions: SQL[] = [
    inArray(schema.vehicles.garageId, [...filters.garageIds]),
    isNull(schema.vehicles.deletedAt),
  ];

  if (filters.garageId) conditions.push(eq(schema.vehicles.garageId, filters.garageId));
  if (filters.vehicleType) conditions.push(eq(schema.vehicles.vehicleType, filters.vehicleType));
  if (filters.status) conditions.push(eq(schema.vehicles.status, filters.status));

  if (filters.cursor) {
    /*
     * Keyset pagination on (created_at, id). The id breaks ties, which matters because
     * several vehicles imported in one batch share a timestamp — ordering by created_at
     * alone would repeat or skip them across page boundaries.
     */
    conditions.push(
      or(
        lt(schema.vehicles.createdAt, filters.cursor.createdAt),
        and(
          eq(schema.vehicles.createdAt, filters.cursor.createdAt),
          lt(schema.vehicles.id, filters.cursor.id),
        ),
      )!,
    );
  }

  const rows = await baseSelect(db)
    .where(and(...conditions))
    .orderBy(desc(schema.vehicles.createdAt), desc(schema.vehicles.id))
    // One extra row tells the caller whether another page exists without a COUNT.
    .limit(filters.limit + 1);

  return rows.map(toEntity);
}

export async function findVehicleById(
  db: Executor,
  vehicleId: string,
): Promise<VehicleWithPhoto | null> {
  const [row] = await baseSelect(db)
    .where(and(eq(schema.vehicles.id, vehicleId), isNull(schema.vehicles.deletedAt)))
    .limit(1);
  return row ? toEntity(row) : null;
}

/**
 * The garage a vehicle belongs to, resolved server-side.
 *
 * This is what `requireCapability` is given. Trusting a `garageId` from the request would
 * let a caller pair their own garage id with someone else's vehicle id and pass the check.
 */
export async function findGarageIdForVehicle(
  db: Executor,
  vehicleId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ garageId: schema.vehicles.garageId })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.id, vehicleId), isNull(schema.vehicles.deletedAt)))
    .limit(1);
  return row?.garageId ?? null;
}

/**
 * Inserts a vehicle, or does nothing if one already carries that id.
 *
 * Returns the id when the row is new and `null` when it was already there — a client replaying a
 * queued create after a lost acknowledgement (§66). Without a client-supplied id there is nothing
 * to conflict on, so this behaves exactly as a plain insert.
 */
export async function insertVehicle(
  db: Executor,
  values: typeof schema.vehicles.$inferInsert,
): Promise<string | null> {
  const [row] = await db
    .insert(schema.vehicles)
    .values(values)
    .onConflictDoNothing({ target: schema.vehicles.id })
    .returning({ id: schema.vehicles.id });
  return row?.id ?? null;
}

export async function updateVehicle(
  db: Executor,
  vehicleId: string,
  changes: Partial<typeof schema.vehicles.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.vehicles).set(changes).where(eq(schema.vehicles.id, vehicleId));
}

/**
 * Soft delete (§103). The vehicle's events, expenses and documents are its owner's history;
 * a hard delete would take a decade of maintenance records with it on a misclick.
 */
export async function archiveVehicle(db: Executor, vehicleId: string): Promise<void> {
  await db
    .update(schema.vehicles)
    .set({ deletedAt: new Date(), status: 'ARCHIVED' })
    .where(eq(schema.vehicles.id, vehicleId));
}

/**
 * Advances the cached odometer, but only forwards.
 *
 * Events are entered out of order all the time — a receipt found in a glovebox months
 * later carries an older reading, and letting it overwrite the current one would make the
 * vehicle appear to travel backwards and would break every maintenance due calculation.
 */
export async function raiseOdometer(
  db: Executor,
  vehicleId: string,
  odometer: number,
): Promise<void> {
  await db
    .update(schema.vehicles)
    .set({ currentOdometer: odometer })
    .where(
      and(
        eq(schema.vehicles.id, vehicleId),
        or(isNull(schema.vehicles.currentOdometer), lt(schema.vehicles.currentOdometer, odometer)),
      ),
    );
}

export async function raiseEngineHours(
  db: Executor,
  vehicleId: string,
  engineHours: number,
): Promise<void> {
  await db
    .update(schema.vehicles)
    .set({ currentEngineHours: engineHours })
    .where(
      and(
        eq(schema.vehicles.id, vehicleId),
        or(
          isNull(schema.vehicles.currentEngineHours),
          lt(schema.vehicles.currentEngineHours, engineHours),
        ),
      ),
    );
}

export async function countVehiclesInGarage(db: Executor, garageId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.vehicles)
    .where(and(eq(schema.vehicles.garageId, garageId), isNull(schema.vehicles.deletedAt)));
  return row?.total ?? 0;
}

/**
 * Whether a photo is attached to this vehicle.
 *
 * Scoped to the vehicle, not just the photo id: without that a caller could point their own
 * vehicle card at a photo in someone else's garage and then read it through the signed
 * download endpoint, which authorises on the vehicle.
 */
export async function photoBelongsToVehicle(
  db: Executor,
  vehicleId: string,
  photoId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.vehiclePhotos.id })
    .from(schema.vehiclePhotos)
    .where(
      and(
        eq(schema.vehiclePhotos.id, photoId),
        eq(schema.vehiclePhotos.vehicleId, vehicleId),
        isNull(schema.vehiclePhotos.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
