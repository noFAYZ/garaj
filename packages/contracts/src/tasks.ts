import { Type, type Static } from '@sinclair/typebox';
import { TASK_CATEGORIES } from '@vehicle-os/domain';
import {
  ClientId,
  CurrencyCode,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  PaginationQuery,
  TaskPrioritySchema,
  TaskStatusSchema,
  Uuid,
} from './common';

export const TaskCategorySchema = Type.Union(
  TASK_CATEGORIES.map((category) => Type.Literal(category)),
);

export const Task = Type.Object({
  id: Uuid,
  garageId: Uuid,
  /** Null for garage-level work — "call the insurer" names no vehicle. */
  vehicleId: Nullable(Uuid),
  vehicleName: Nullable(Type.String()),
  maintenancePlanId: Nullable(Uuid),

  title: Type.String(),
  description: Nullable(Type.String()),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  category: TaskCategorySchema,

  dueDate: Nullable(IsoDate),
  /** "Replace the rear tyre by 45,000 km" — a deadline with nothing to do with dates. */
  dueOdometer: Nullable(Type.Integer()),

  assigneeId: Nullable(Uuid),
  assigneeName: Nullable(Type.String()),

  estimatedCost: Nullable(MoneyOutput),
  actualCost: Nullable(MoneyOutput),

  completedAt: Nullable(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Task = Static<typeof Task>;

export const CreateTask = Type.Object(
  {
    /** Chosen by the client when the task was made offline. */
    id: ClientId,
    garageId: Uuid,
    vehicleId: Type.Optional(Uuid),
    maintenancePlanId: Type.Optional(Uuid),
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 5000 })),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    category: Type.Optional(TaskCategorySchema),
    dueDate: Type.Optional(IsoDate),
    dueOdometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    assigneeId: Type.Optional(Uuid),
    estimatedCostAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
    costCurrency: Type.Optional(CurrencyCode),
  },
  { additionalProperties: false },
);
export type CreateTask = Static<typeof CreateTask>;

export const UpdateTask = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    description: Type.Optional(Nullable(Type.String({ maxLength: 5000 }))),
    status: Type.Optional(TaskStatusSchema),
    priority: Type.Optional(TaskPrioritySchema),
    category: Type.Optional(TaskCategorySchema),
    dueDate: Type.Optional(Nullable(IsoDate)),
    dueOdometer: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 100_000_000 }))),
    assigneeId: Type.Optional(Nullable(Uuid)),
    estimatedCostAmountMinor: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    actualCostAmountMinor: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    costCurrency: Type.Optional(CurrencyCode),
  },
  { additionalProperties: false },
);
export type UpdateTask = Static<typeof UpdateTask>;

export const ListTasksQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    garageId: Type.Optional(Uuid),
    vehicleId: Type.Optional(Uuid),
    status: Type.Optional(
      Type.Union([TaskStatusSchema, Type.Array(TaskStatusSchema, { maxItems: 5 })]),
    ),
    priority: Type.Optional(TaskPrioritySchema),
    assigneeId: Type.Optional(Uuid),
    /** Shorthand for "everything not yet done" — the default view of a task list. */
    openOnly: Type.Optional(Type.Boolean()),
  }),
]);
export type ListTasksQuery = Static<typeof ListTasksQuery>;

export const TaskIdParam = Type.Object({ taskId: Uuid });

/**
 * The task centre (PRD §29).
 *
 * Bucketed server-side because "today" depends on the *user's* timezone, not the browser's
 * and not UTC — a task due 1 March is overdue in Auckland hours before it is in Los Angeles,
 * and each client computing its own answer makes them disagree.
 */
export const TaskBuckets = Type.Object({
  overdue: Type.Array(Task),
  today: Type.Array(Task),
  thisWeek: Type.Array(Task),
  upcoming: Type.Array(Task),
  /** Real work with no deadline; hidden from the counts so it cannot look urgent. */
  someday: Type.Array(Task),
  counts: Type.Object({
    overdue: Type.Integer(),
    today: Type.Integer(),
    thisWeek: Type.Integer(),
    upcoming: Type.Integer(),
    someday: Type.Integer(),
  }),
});
export type TaskBuckets = Static<typeof TaskBuckets>;
