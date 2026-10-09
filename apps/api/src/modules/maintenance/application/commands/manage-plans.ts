import type { Database } from '@vehicle-os/database';
import {
  supports,
  type ActorContext,
  type DistanceUnit,
  type TaskPriority,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import { recordAudit } from '../../../../infrastructure/audit';
import type { CommandMeta } from '../../../garages/application/commands/create-garage';
import { findVehicleById } from '../../../vehicles/infrastructure/repositories/vehicle-repository';
import { computeNextDue } from '../../domain/next-due';
import {
  deletePlan,
  findPlanById,
  insertPlan,
  updatePlan,
  type PlanRow,
} from '../../infrastructure/repositories/maintenance-repository';

export interface CreatePlanInput {
  /** Chosen by the client for a plan made offline; makes this create idempotent. */
  readonly id?: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: TaskPriority;
  readonly intervalDistance?: number;
  readonly intervalDistanceUnit?: DistanceUnit;
  readonly intervalMonths?: number;
  readonly intervalEngineHours?: number;
  readonly lastPerformedAt?: string;
  readonly lastPerformedOdometer?: number;
  readonly lastPerformedEngineHours?: number;
}

/**
 * Recomputes the cached due columns from the plan's intervals and the vehicle's state.
 *
 * The columns exist so the notification scan can filter in SQL without loading every plan.
 * They are derived, never authoritative — every read recomputes the live status, because the
 * answer changes as the calendar and the odometer move, with no write to trigger a refresh.
 */
function dueColumns(
  plan: PlanRow,
  vehicle: {
    currentOdometer: number | null;
    odometerUnit: DistanceUnit;
    currentEngineHours: number | null;
  },
) {
  const due = computeNextDue(plan, vehicle);
  return {
    nextDueDate: due.nextDueDate,
    nextDueOdometer: due.nextDueOdometer,
    nextDueEngineHours: due.nextDueEngineHours,
  };
}

export async function createPlan(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  garageId: string,
  input: CreatePlanInput,
  meta: CommandMeta,
): Promise<PlanRow> {
  const vehicle = await findVehicleById(db, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');

  const fields: Record<string, string> = {};

  /*
   * At least one interval, or the plan can never come due. That is a task, not a schedule,
   * and silently accepting it would leave an item that looks scheduled and never fires.
   */
  if (!input.intervalDistance && !input.intervalMonths && !input.intervalEngineHours) {
    fields.intervalMonths =
      'A maintenance plan needs at least one interval — distance, time or engine hours.';
  }

  if (input.intervalDistance && !input.intervalDistanceUnit) {
    fields.intervalDistanceUnit = 'A distance interval needs its unit.';
  }

  // Engine hours only mean something on a type that has the meter.
  if (input.intervalEngineHours && !supports(vehicle.vehicleType, 'engineHours')) {
    fields.intervalEngineHours = `A ${vehicle.vehicleType.toLowerCase()} does not track engine hours.`;
  }

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  /*
   * The baseline. Omitted, it is seeded from the vehicle's state right now — "start counting
   * from today". Without a baseline `computeNextDue` reports UNSCHEDULED forever, so a plan
   * created with no history would silently never come due.
   */
  const lastPerformedAt = input.lastPerformedAt ? new Date(input.lastPerformedAt) : new Date();
  const lastPerformedOdometer = input.lastPerformedOdometer ?? vehicle.currentOdometer;
  const lastPerformedEngineHours = input.lastPerformedEngineHours ?? vehicle.currentEngineHours;

  return db.transaction(async (tx) => {
    const { row: created, created: isNew } = await insertPlan(tx, {
      ...(input.id ? { id: input.id } : {}),
      vehicleId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      priority: input.priority ?? 'MEDIUM',
      intervalDistance: input.intervalDistance ?? null,
      intervalDistanceUnit: input.intervalDistanceUnit ?? null,
      intervalMonths: input.intervalMonths ?? null,
      intervalEngineHours: input.intervalEngineHours ?? null,
      lastPerformedAt,
      lastPerformedOdometer,
      lastPerformedEngineHours,
    });

    // A replay: the plan, its due dates and its audit entry are all already there.
    if (!isNew) return created;

    const columns = dueColumns(created, vehicle);
    await updatePlan(tx, created.id, columns);

    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'maintenance.plan_created',
      resourceType: 'maintenance_plan',
      resourceId: created.id,
      metadata: { vehicleId, title: created.title },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });

    return { ...created, ...columns };
  });
}

export interface UpdatePlanInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: TaskPriority;
  readonly intervalDistance?: number | null;
  readonly intervalDistanceUnit?: DistanceUnit;
  readonly intervalMonths?: number | null;
  readonly intervalEngineHours?: number | null;
  readonly lastPerformedAt?: string | null;
  readonly lastPerformedOdometer?: number | null;
  readonly lastPerformedEngineHours?: number | null;
  readonly isActive?: boolean;
}

export async function editPlan(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  planId: string,
  garageId: string,
  input: UpdatePlanInput,
  meta: CommandMeta,
): Promise<PlanRow> {
  const existing = await findPlanById(db, vehicleId, planId);
  if (!existing) throw new NotFoundError('Maintenance plan');

  const vehicle = await findVehicleById(db, vehicleId);
  if (!vehicle) throw new NotFoundError('Vehicle');

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('title', input.title?.trim());
  assign(
    'description',
    input.description === undefined ? undefined : (input.description?.trim() ?? null),
  );
  assign('priority', input.priority);
  assign('intervalDistance', input.intervalDistance);
  assign('intervalDistanceUnit', input.intervalDistanceUnit);
  assign('intervalMonths', input.intervalMonths);
  assign('intervalEngineHours', input.intervalEngineHours);
  assign(
    'lastPerformedAt',
    input.lastPerformedAt === undefined
      ? undefined
      : input.lastPerformedAt
        ? new Date(input.lastPerformedAt)
        : null,
  );
  assign('lastPerformedOdometer', input.lastPerformedOdometer);
  assign('lastPerformedEngineHours', input.lastPerformedEngineHours);
  assign('isActive', input.isActive);

  const merged = { ...existing, ...changes } as PlanRow;
  if (!merged.intervalDistance && !merged.intervalMonths && !merged.intervalEngineHours) {
    throw new ValidationError('Invalid request', {
      intervalMonths: 'A maintenance plan needs at least one interval.',
    });
  }

  await db.transaction(async (tx) => {
    // Any interval or baseline change moves the due point, so the cached columns are
    // recomputed in the same transaction rather than left stale until the next scan.
    await updatePlan(tx, planId, { ...changes, ...dueColumns(merged, vehicle) });
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'maintenance.plan_updated',
      resourceType: 'maintenance_plan',
      resourceId: planId,
      metadata: { vehicleId, changed: Object.keys(changes) },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
  });

  const updated = await findPlanById(db, vehicleId, planId);
  if (!updated) throw new NotFoundError('Maintenance plan');
  return updated;
}

export async function removePlan(
  db: Database,
  actor: ActorContext,
  vehicleId: string,
  planId: string,
  garageId: string,
  meta: CommandMeta,
): Promise<void> {
  const existing = await findPlanById(db, vehicleId, planId);
  if (!existing) throw new NotFoundError('Maintenance plan');

  await db.transaction(async (tx) => {
    await recordAudit(tx, {
      actorId: actor.userId,
      actorEmail: actor.email,
      garageId,
      action: 'maintenance.plan_deleted',
      resourceType: 'maintenance_plan',
      resourceId: planId,
      metadata: { vehicleId, title: existing.title },
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
    });
    /*
     * The plan goes; its records stay. `maintenance_records.plan_id` is `set null`, so the
     * services already performed remain in the vehicle's history — deleting a schedule must
     * not erase the evidence that the work was done.
     */
    await deletePlan(tx, planId);
  });
}
