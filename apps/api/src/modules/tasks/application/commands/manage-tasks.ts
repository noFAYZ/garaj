import type { Database } from '@vehicle-os/database';
import {
  assertCurrency,
  MoneyError,
  type ActorContext,
  type TaskPriority,
  type TaskStatus,
} from '@vehicle-os/domain';
import { NotFoundError, ValidationError } from '../../../../infrastructure/errors';
import {
  findTaskById,
  insertTask,
  isGarageMember,
  softDeleteTask,
  updateTask,
  vehicleBelongsToGarage,
  type TaskRow,
} from '../../infrastructure/repositories/task-repository';

type Category = TaskRow['category'];

export interface CreateTaskInput {
  /** Chosen by the client for a task made offline; makes this create idempotent. */
  readonly id?: string;
  readonly garageId: string;
  readonly vehicleId?: string;
  readonly maintenancePlanId?: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly category?: Category;
  readonly dueDate?: string;
  readonly dueOdometer?: number;
  readonly assigneeId?: string;
  readonly estimatedCostAmountMinor?: number;
  readonly costCurrency?: string;
}

async function validateReferences(
  db: Database,
  garageId: string,
  input: { vehicleId?: string; assigneeId?: string | null; costCurrency?: string },
  fields: Record<string, string>,
): Promise<void> {
  /*
   * A vehicle from another garage would let a task act as a pointer across the tenant
   * boundary: the task is readable in the caller's garage but names a vehicle that is not.
   */
  if (input.vehicleId && !(await vehicleBelongsToGarage(db, input.vehicleId, garageId))) {
    fields.vehicleId = 'That vehicle is not in this garage.';
  }

  // Assigning work to someone with no access to the garage means they can never see it.
  if (input.assigneeId && !(await isGarageMember(db, garageId, input.assigneeId))) {
    fields.assigneeId = 'That person is not a member of this garage.';
  }

  if (input.costCurrency) {
    try {
      assertCurrency(input.costCurrency);
    } catch (error) {
      if (error instanceof MoneyError) fields.costCurrency = error.message;
      else throw error;
    }
  }
}

export async function createTask(
  db: Database,
  actor: ActorContext,
  input: CreateTaskInput,
): Promise<TaskRow> {
  const fields: Record<string, string> = {};
  await validateReferences(db, input.garageId, input, fields);

  const hasEstimate = input.estimatedCostAmountMinor !== undefined;
  if (hasEstimate && !input.costCurrency) {
    fields.costCurrency = 'A cost estimate needs a currency.';
  }

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const status = input.status ?? 'TODO';
  /*
   * No `created` flag needed here: there is no once-only work beside the insert, and the read
   * below is already scoped to the caller's garages — so a replay of someone else's id is a 404
   * rather than a peek at their task.
   */
  const { id: taskId } = await insertTask(db, {
    ...(input.id ? { id: input.id } : {}),
    garageId: input.garageId,
    vehicleId: input.vehicleId ?? null,
    maintenancePlanId: input.maintenancePlanId ?? null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    status,
    priority: input.priority ?? 'MEDIUM',
    category: input.category ?? 'MAINTENANCE',
    dueDate: input.dueDate ?? null,
    dueOdometer: input.dueOdometer ?? null,
    assigneeId: input.assigneeId ?? null,
    estimatedCostAmountMinor: input.estimatedCostAmountMinor ?? null,
    costCurrency: input.costCurrency ?? null,
    // Set on creation when a task is filed as already done — importing a backlog, or
    // ticking something off while entering it.
    completedAt: status === 'COMPLETED' ? new Date() : null,
    createdBy: actor.userId,
  });

  const created = await findTaskById(
    db,
    taskId,
    actor.memberships.map((membership) => membership.garageId),
  );
  if (!created) throw new NotFoundError('Task');
  return created;
}

export interface UpdateTaskInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly category?: Category;
  readonly dueDate?: string | null;
  readonly dueOdometer?: number | null;
  readonly assigneeId?: string | null;
  readonly estimatedCostAmountMinor?: number | null;
  readonly actualCostAmountMinor?: number | null;
  readonly costCurrency?: string;
}

export async function editTask(
  db: Database,
  actor: ActorContext,
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskRow> {
  const garageIds = actor.memberships.map((membership) => membership.garageId);
  const existing = await findTaskById(db, taskId, garageIds);
  if (!existing) throw new NotFoundError('Task');

  const fields: Record<string, string> = {};
  await validateReferences(db, existing.garageId, input, fields);

  const currency = input.costCurrency ?? existing.costCurrency;
  if (input.actualCostAmountMinor != null && !currency) {
    fields.costCurrency = 'A cost needs a currency.';
  }

  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid request', fields);

  const changes: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    if (value !== undefined) changes[key] = value;
  };

  assign('title', input.title?.trim());
  assign(
    'description',
    input.description === undefined ? undefined : (input.description?.trim() ?? null),
  );
  assign('status', input.status);
  assign('priority', input.priority);
  assign('category', input.category);
  assign('dueDate', input.dueDate);
  assign('dueOdometer', input.dueOdometer);
  assign('assigneeId', input.assigneeId);
  assign('estimatedCostAmountMinor', input.estimatedCostAmountMinor);
  assign('actualCostAmountMinor', input.actualCostAmountMinor);
  assign('costCurrency', input.costCurrency);

  /*
   * `completedAt` follows the status rather than being set by the client — the two cannot
   * then disagree. Re-opening clears it; completing an already-complete task leaves the
   * original timestamp, because it did not just happen again.
   */
  if (input.status !== undefined) {
    if (input.status === 'COMPLETED') {
      if (!existing.completedAt) changes.completedAt = new Date();
    } else {
      changes.completedAt = null;
    }
  }

  await updateTask(db, taskId, changes);

  const updated = await findTaskById(db, taskId, garageIds);
  if (!updated) throw new NotFoundError('Task');
  return updated;
}

export async function removeTask(db: Database, actor: ActorContext, taskId: string): Promise<void> {
  const garageIds = actor.memberships.map((membership) => membership.garageId);
  const existing = await findTaskById(db, taskId, garageIds);
  if (!existing) throw new NotFoundError('Task');

  await softDeleteTask(db, taskId);
}
