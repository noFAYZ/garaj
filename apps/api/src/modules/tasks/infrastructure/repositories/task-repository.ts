import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { idConflict } from '../../../../infrastructure/idempotency';
import { schema, type Executor } from '@vehicle-os/database';
import type { TaskPriority, TaskStatus, VehicleType } from '@vehicle-os/domain';

export interface TaskRow {
  id: string;
  garageId: string;
  vehicleId: string | null;
  maintenancePlanId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: (typeof schema.tasks.$inferSelect)['category'];
  dueDate: string | null;
  dueOdometer: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  estimatedCostAmountMinor: number | null;
  actualCostAmountMinor: number | null;
  costCurrency: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Joined so a task list can name the vehicle without a second query per row.
  vehicleNickname: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleType: VehicleType | null;
}

const COLUMNS = {
  id: schema.tasks.id,
  garageId: schema.tasks.garageId,
  vehicleId: schema.tasks.vehicleId,
  maintenancePlanId: schema.tasks.maintenancePlanId,
  title: schema.tasks.title,
  description: schema.tasks.description,
  status: schema.tasks.status,
  priority: schema.tasks.priority,
  category: schema.tasks.category,
  dueDate: schema.tasks.dueDate,
  dueOdometer: schema.tasks.dueOdometer,
  assigneeId: schema.tasks.assigneeId,
  assigneeName: schema.users.name,
  estimatedCostAmountMinor: schema.tasks.estimatedCostAmountMinor,
  actualCostAmountMinor: schema.tasks.actualCostAmountMinor,
  costCurrency: schema.tasks.costCurrency,
  completedAt: schema.tasks.completedAt,
  createdAt: schema.tasks.createdAt,
  updatedAt: schema.tasks.updatedAt,
  vehicleNickname: schema.vehicles.nickname,
  vehicleMake: schema.vehicles.make,
  vehicleModel: schema.vehicles.model,
  vehicleYear: schema.vehicles.year,
  vehicleType: schema.vehicles.vehicleType,
};

function baseSelect(db: Executor) {
  return (
    db
      .select(COLUMNS)
      .from(schema.tasks)
      // Both left joins: a task need not name a vehicle ("call the insurer") and need not be
      // assigned to anyone. An inner join would silently drop exactly those.
      .leftJoin(schema.vehicles, eq(schema.vehicles.id, schema.tasks.vehicleId))
      .leftJoin(schema.users, eq(schema.users.id, schema.tasks.assigneeId))
  );
}

export interface ListTasksFilters {
  readonly garageIds: readonly string[];
  readonly garageId?: string;
  readonly vehicleId?: string;
  readonly statuses?: readonly TaskStatus[];
  readonly priority?: TaskPriority;
  readonly assigneeId?: string;
  readonly openOnly?: boolean;
}

const CLOSED: TaskStatus[] = ['COMPLETED', 'CANCELLED'];

export async function listTasks(db: Executor, filters: ListTasksFilters): Promise<TaskRow[]> {
  if (filters.garageIds.length === 0) return [];

  const conditions: SQL[] = [
    // The tenant filter, from the actor's memberships. A `garageId` in the query narrows
    // this set; it can never widen it.
    inArray(schema.tasks.garageId, [...filters.garageIds]),
    isNull(schema.tasks.deletedAt),
  ];

  if (filters.garageId) conditions.push(eq(schema.tasks.garageId, filters.garageId));
  if (filters.vehicleId) conditions.push(eq(schema.tasks.vehicleId, filters.vehicleId));
  if (filters.priority) conditions.push(eq(schema.tasks.priority, filters.priority));
  if (filters.assigneeId) conditions.push(eq(schema.tasks.assigneeId, filters.assigneeId));
  if (filters.statuses?.length) {
    conditions.push(inArray(schema.tasks.status, [...filters.statuses]));
  } else if (filters.openOnly) {
    conditions.push(notInArray(schema.tasks.status, CLOSED));
  }

  return (
    baseSelect(db)
      .where(and(...conditions))
      /*
       * Soonest first with nulls last, then by priority. Postgres sorts nulls first by
       * default, which would float every undated task above genuinely overdue work.
       */
      .orderBy(
        sql`${schema.tasks.dueDate} asc nulls last`,
        sql`case ${schema.tasks.priority}
            when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end`,
        asc(schema.tasks.createdAt),
      )
  );
}

export async function findTaskById(
  db: Executor,
  taskId: string,
  garageIds: readonly string[],
): Promise<TaskRow | null> {
  if (garageIds.length === 0) return null;

  const [row] = await baseSelect(db)
    .where(
      and(
        eq(schema.tasks.id, taskId),
        // Scoped by membership in the same query, so there is no window between finding the
        // task and checking whether the caller may see it.
        inArray(schema.tasks.garageId, [...garageIds]),
        isNull(schema.tasks.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function insertTask(
  db: Executor,
  values: typeof schema.tasks.$inferInsert,
): Promise<{ id: string; created: boolean }> {
  const [row] = await db
    .insert(schema.tasks)
    .values(values)
    .onConflictDoNothing({ target: schema.tasks.id })
    .returning({ id: schema.tasks.id });
  if (row) return { id: row.id, created: true };

  // A row already carries this id: the client is replaying a queued create.
  const [existing] = values.id
    ? await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, values.id))
        .limit(1)
    : [];
  if (!existing) throw idConflict('task');
  return { id: existing.id, created: false };
}

export async function updateTask(
  db: Executor,
  taskId: string,
  changes: Partial<typeof schema.tasks.$inferInsert>,
): Promise<void> {
  if (Object.keys(changes).length === 0) return;
  await db.update(schema.tasks).set(changes).where(eq(schema.tasks.id, taskId));
}

/** Soft delete (§103): a task is one of the four tables where history is worth keeping. */
export async function softDeleteTask(db: Executor, taskId: string): Promise<void> {
  await db.update(schema.tasks).set({ deletedAt: new Date() }).where(eq(schema.tasks.id, taskId));
}

export async function vehicleBelongsToGarage(
  db: Executor,
  vehicleId: string,
  garageId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.vehicles.id })
    .from(schema.vehicles)
    .where(
      and(
        eq(schema.vehicles.id, vehicleId),
        eq(schema.vehicles.garageId, garageId),
        isNull(schema.vehicles.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function isGarageMember(
  db: Executor,
  garageId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.garageMembers.id })
    .from(schema.garageMembers)
    .where(
      and(eq(schema.garageMembers.garageId, garageId), eq(schema.garageMembers.userId, userId)),
    )
    .limit(1);
  return Boolean(row);
}
