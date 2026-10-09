import { Type, type Static } from '@sinclair/typebox';
import {
  ClientId,
  CurrencyCode,
  DistanceUnit,
  IsoDate,
  IsoDateTime,
  MoneyOutput,
  Nullable,
  PaginationQuery,
  TaskPrioritySchema,
  Uuid,
} from './common';

export const DueStatusSchema = Type.Union([
  Type.Literal('OK'),
  Type.Literal('DUE_SOON'),
  Type.Literal('OVERDUE'),
  /** Intervals exist but nothing can be measured yet — no baseline, or no odometer reading. */
  Type.Literal('UNSCHEDULED'),
]);
export type DueStatus = Static<typeof DueStatusSchema>;

export const DueTriggerSchema = Type.Union([
  Type.Literal('DATE'),
  Type.Literal('DISTANCE'),
  Type.Literal('ENGINE_HOURS'),
]);

/**
 * A maintenance plan with its computed due state.
 *
 * The status is calculated server-side on every read (Architecture.md §23): the answer
 * depends on today's date and the vehicle's current odometer, so a value cached in the
 * database would be stale the moment either moved.
 */
export const MaintenancePlan = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  title: Type.String(),
  description: Nullable(Type.String()),
  priority: TaskPrioritySchema,

  intervalDistance: Nullable(Type.Integer()),
  intervalDistanceUnit: Nullable(DistanceUnit),
  intervalMonths: Nullable(Type.Integer()),
  intervalEngineHours: Nullable(Type.Integer()),

  lastPerformedAt: Nullable(IsoDateTime),
  lastPerformedOdometer: Nullable(Type.Integer()),
  lastPerformedEngineHours: Nullable(Type.Integer()),

  nextDueDate: Nullable(IsoDate),
  /** In the vehicle's odometer unit, already converted from the interval's own unit. */
  nextDueOdometer: Nullable(Type.Integer()),
  nextDueEngineHours: Nullable(Type.Integer()),

  status: DueStatusSchema,
  /** Which interval arrives first — what the UI shows as the reason. */
  trigger: Nullable(DueTriggerSchema),
  daysRemaining: Nullable(Type.Integer()),
  distanceRemaining: Nullable(Type.Integer()),
  engineHoursRemaining: Nullable(Type.Integer()),

  isActive: Type.Boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MaintenancePlan = Static<typeof MaintenancePlan>;

/**
 * At least one interval is required — a plan with none can never come due, which is a task,
 * not a schedule. Enforced server-side; the schema cannot express "at least one of these".
 */
export const CreateMaintenancePlan = Type.Object(
  {
    /** Chosen by the client when the plan was made offline. */
    id: ClientId,
    title: Type.String({ minLength: 1, maxLength: 200 }),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    priority: Type.Optional(TaskPrioritySchema),

    intervalDistance: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
    intervalDistanceUnit: Type.Optional(DistanceUnit),
    intervalMonths: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
    intervalEngineHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),

    /*
     * The baseline the intervals count from. Omitted, it is seeded from the vehicle's
     * current state — "start counting from today". Supplied, it means "this was last done
     * then", which is how an existing vehicle's real schedule gets entered.
     */
    lastPerformedAt: Type.Optional(IsoDateTime),
    lastPerformedOdometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    lastPerformedEngineHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
  },
  { additionalProperties: false },
);
export type CreateMaintenancePlan = Static<typeof CreateMaintenancePlan>;

export const UpdateMaintenancePlan = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    description: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
    priority: Type.Optional(TaskPrioritySchema),
    intervalDistance: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 1_000_000 }))),
    intervalDistanceUnit: Type.Optional(DistanceUnit),
    intervalMonths: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 600 }))),
    intervalEngineHours: Type.Optional(Nullable(Type.Integer({ minimum: 1, maximum: 100_000 }))),
    lastPerformedAt: Type.Optional(Nullable(IsoDateTime)),
    lastPerformedOdometer: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    lastPerformedEngineHours: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
    isActive: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type UpdateMaintenancePlan = Static<typeof UpdateMaintenancePlan>;

export const MaintenanceRecord = Type.Object({
  id: Uuid,
  vehicleId: Uuid,
  planId: Nullable(Uuid),
  eventId: Nullable(Uuid),
  title: Type.String(),
  workPerformed: Nullable(Type.String()),
  notes: Nullable(Type.String()),
  provider: Nullable(Type.String()),
  performedAt: IsoDateTime,
  odometer: Nullable(Type.Integer()),
  odometerUnit: Nullable(DistanceUnit),
  engineHours: Nullable(Type.Integer()),
  partsCost: Nullable(MoneyOutput),
  laborCost: Nullable(MoneyOutput),
  totalCost: Nullable(MoneyOutput),
  createdAt: IsoDateTime,
});
export type MaintenanceRecord = Static<typeof MaintenanceRecord>;

/**
 * Logging a completed service.
 *
 * One request produces the record, a timeline event and — where a cost is given — an
 * expense, all in a single transaction (§38). Recording work in three separate calls would
 * leave a service half-logged whenever one of them failed.
 */
export const CompleteMaintenance = Type.Object(
  {
    performedAt: IsoDateTime,
    workPerformed: Type.Optional(Type.String({ maxLength: 5000 })),
    notes: Type.Optional(Type.String({ maxLength: 5000 })),
    provider: Type.Optional(Type.String({ maxLength: 200 })),

    odometer: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000_000 })),
    odometerUnit: Type.Optional(DistanceUnit),
    engineHours: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),

    partsCostAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
    laborCostAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
    costCurrency: Type.Optional(CurrencyCode),
  },
  { additionalProperties: false },
);
export type CompleteMaintenance = Static<typeof CompleteMaintenance>;

/** An unscheduled repair — real maintenance history with no plan behind it. */
export const LogMaintenance = Type.Composite([
  Type.Object({ title: Type.String({ minLength: 1, maxLength: 200 }) }),
  CompleteMaintenance,
]);
export type LogMaintenance = Static<typeof LogMaintenance>;

export const MaintenanceCompletion = Type.Object({
  record: MaintenanceRecord,
  /** Null for an unscheduled repair; otherwise the plan with its clock reset. */
  plan: Nullable(MaintenancePlan),
});
export type MaintenanceCompletion = Static<typeof MaintenanceCompletion>;

export const PlanParams = Type.Object({ vehicleId: Uuid, planId: Uuid });

export const ListMaintenanceQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    status: Type.Optional(DueStatusSchema),
    includeInactive: Type.Optional(Type.Boolean()),
  }),
]);
export type ListMaintenanceQuery = Static<typeof ListMaintenanceQuery>;

/**
 * Due work across every garage the caller belongs to — what the dashboard's "attention
 * required" section reads.
 */
export const DueItem = Type.Object({
  plan: MaintenancePlan,
  vehicleId: Uuid,
  vehicleName: Type.String(),
  vehicleType: Type.String(),
  /** The unit `nextDueOdometer` is expressed in — without it the dashboard renders miles as km. */
  odometerUnit: DistanceUnit,
});
export type DueItem = Static<typeof DueItem>;
