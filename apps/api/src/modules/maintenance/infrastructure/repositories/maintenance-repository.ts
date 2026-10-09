import { and, asc, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { idConflict } from '../../../../infrastructure/idempotency';
import { schema, type Executor } from '@vehicle-os/database';
import type { DistanceUnit, VehicleType } from '@vehicle-os/domain';

export type PlanRow = typeof schema.maintenancePlans.$inferSelect;
export type RecordRow = typeof schema.maintenanceRecords.$inferSelect;

export async function listPlans(
  db: Executor,
  vehicleId: string,
  includeInactive = false,
): Promise<PlanRow[]> {
  const conditions: SQL[] = [eq(schema.maintenancePlans.vehicleId, vehicleId)];
  if (!includeInactive) conditions.push(eq(schema.maintenancePlans.isActive, true));

  return (
    db
      .select()
      .from(schema.maintenancePlans)
      .where(and(...conditions))
      // Soonest first, nulls last: a plan with no date interval has no `next_due_date`, and
      // Postgres sorts nulls first by default, which would float unscheduled items to the top.
      .orderBy(
        sql`${schema.maintenancePlans.nextDueDate} asc nulls last`,
        asc(schema.maintenancePlans.title),
      )
  );
}

export async function findPlanById(
  db: Executor,
  vehicleId: string,
  planId: string,
): Promise<PlanRow | null> {
  const [row] = await db
    .select()
    .from(schema.maintenancePlans)
    .where(
      and(
        eq(schema.maintenancePlans.id, planId),
        // Scoped to the vehicle so a plan id from another garage cannot be reached through
        // a vehicle the caller does have access to.
        eq(schema.maintenancePlans.vehicleId, vehicleId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertPlan(
  db: Executor,
  values: typeof schema.maintenancePlans.$inferInsert,
): Promise<{ row: PlanRow; created: boolean }> {
  const [row] = await db
    .insert(schema.maintenancePlans)
    .values(values)
    .onConflictDoNothing({ target: schema.maintenancePlans.id })
    .returning();
  if (row) return { row, created: true };

  // A row already carries this id: the client is replaying a queued create.
  const [existing] = values.id
    ? await db
        .select()
        .from(schema.maintenancePlans)
        .where(eq(schema.maintenancePlans.id, values.id))
        .limit(1)
    : [];
  if (!existing) throw idConflict('maintenance plan');
  return { row: existing, created: false };
}

export async function updatePlan(
  db: Executor,
  planId: string,
  changes: Partial<typeof schema.maintenancePlans.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db
    .update(schema.maintenancePlans)
    .set(changes)
    .where(eq(schema.maintenancePlans.id, planId));
}

export async function deletePlan(db: Executor, planId: string): Promise<void> {
  await db.delete(schema.maintenancePlans).where(eq(schema.maintenancePlans.id, planId));
}

export async function listRecords(
  db: Executor,
  vehicleId: string,
  planId?: string,
): Promise<RecordRow[]> {
  const conditions: SQL[] = [eq(schema.maintenanceRecords.vehicleId, vehicleId)];
  if (planId) conditions.push(eq(schema.maintenanceRecords.planId, planId));

  return db
    .select()
    .from(schema.maintenanceRecords)
    .where(and(...conditions))
    .orderBy(desc(schema.maintenanceRecords.performedAt));
}

export async function insertRecord(
  db: Executor,
  values: typeof schema.maintenanceRecords.$inferInsert,
): Promise<RecordRow> {
  const [row] = await db.insert(schema.maintenanceRecords).values(values).returning();
  if (!row) throw new Error('Maintenance record insert returned no row');
  return row;
}

export interface PlanWithVehicle {
  plan: PlanRow;
  vehicleId: string;
  // The narrow enum type, not `string`: `displayName` and the capability checks both switch
  // on it, and widening here pushes a cast onto every consumer.
  vehicleType: VehicleType;
  nickname: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  currentOdometer: number | null;
  odometerUnit: DistanceUnit;
  currentEngineHours: number | null;
}

/**
 * Active plans across every garage the caller belongs to, joined to the vehicle state each
 * one is measured against.
 *
 * One query rather than "list vehicles, then list plans per vehicle": the dashboard needs
 * every plan in the garage, and the N+1 version puts a round trip per vehicle on the first
 * screen after sign-in.
 */
export async function listDuePlansForGarages(
  db: Executor,
  garageIds: readonly string[],
): Promise<PlanWithVehicle[]> {
  if (garageIds.length === 0) return [];

  const rows = await db
    .select({
      plan: schema.maintenancePlans,
      vehicleId: schema.vehicles.id,
      vehicleType: schema.vehicles.vehicleType,
      nickname: schema.vehicles.nickname,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      currentOdometer: schema.vehicles.currentOdometer,
      odometerUnit: schema.vehicles.odometerUnit,
      currentEngineHours: schema.vehicles.currentEngineHours,
    })
    .from(schema.maintenancePlans)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.maintenancePlans.vehicleId))
    .where(
      and(
        inArray(schema.vehicles.garageId, [...garageIds]),
        // An archived vehicle's schedules are history, not outstanding work.
        isNull(schema.vehicles.deletedAt),
        eq(schema.maintenancePlans.isActive, true),
      ),
    )
    .orderBy(sql`${schema.maintenancePlans.nextDueDate} asc nulls last`);

  return rows;
}

/**
 * Plans the notification scan should consider (Architecture.md §84).
 *
 * Deliberately coarse: it selects anything whose date has arrived *or* that tracks distance
 * at all, and the exact status is decided by `computeNextDue` afterwards. Encoding the
 * distance rule in SQL would duplicate the domain logic in a second language, where it would
 * drift the first time a threshold changed.
 */
export async function listPlansForDueScan(db: Executor, horizon: Date): Promise<PlanWithVehicle[]> {
  const rows = await db
    .select({
      plan: schema.maintenancePlans,
      vehicleId: schema.vehicles.id,
      vehicleType: schema.vehicles.vehicleType,
      nickname: schema.vehicles.nickname,
      make: schema.vehicles.make,
      model: schema.vehicles.model,
      year: schema.vehicles.year,
      currentOdometer: schema.vehicles.currentOdometer,
      odometerUnit: schema.vehicles.odometerUnit,
      currentEngineHours: schema.vehicles.currentEngineHours,
    })
    .from(schema.maintenancePlans)
    .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.maintenancePlans.vehicleId))
    .where(
      and(
        eq(schema.maintenancePlans.isActive, true),
        isNull(schema.vehicles.deletedAt),
        or(
          lte(schema.maintenancePlans.nextDueDate, horizon.toISOString().slice(0, 10)),
          sql`${schema.maintenancePlans.nextDueOdometer} is not null`,
          sql`${schema.maintenancePlans.nextDueEngineHours} is not null`,
        )!,
      ),
    );

  return rows;
}
