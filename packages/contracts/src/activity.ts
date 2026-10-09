import { Type, type Static } from '@sinclair/typebox';
import { EventTypeSchema, Paginated, PaginationQuery } from './common';
import { VehicleEvent } from './events';
import { MaintenancePlan } from './maintenance';
import { Task } from './tasks';

/**
 * A vehicle's activity: everything about it, as one feed.
 *
 * Two halves, because they are two different kinds of fact. `done` is what happened — every
 * service, fill-up, repair, payment and note, newest first. An expense is always one of these:
 * it is recorded as an event carrying a cost. `planned` is what is coming — repeating
 * schedules and one-off tasks for this vehicle, most urgent first. Completing a planned item
 * turns it into a done one.
 *
 * Storage stays split — a schedule needs interval arithmetic, a task can belong to no vehicle,
 * money needs litres and full-tank flags — so this is a read model over three tables rather
 * than a table of its own.
 */
export const PlannedItem = Type.Union([
  Type.Object({ kind: Type.Literal('SCHEDULE'), schedule: MaintenancePlan }),
  Type.Object({ kind: Type.Literal('TASK'), task: Task }),
]);
export type PlannedItem = Static<typeof PlannedItem>;

export const VehicleActivity = Type.Object({
  /**
   * Only on the first page. It is short and never paginated, so repeating it on every page of
   * `done` would show the same planned items again below each "load more".
   */
  planned: Type.Array(PlannedItem),
  done: Paginated(VehicleEvent),
});
export type VehicleActivity = Static<typeof VehicleActivity>;

export const ListActivityQuery = Type.Composite([
  PaginationQuery,
  Type.Object({
    // Narrows `done` only. Repeatable: `?eventType=FUEL&eventType=CHARGE`.
    eventType: Type.Optional(
      Type.Union([EventTypeSchema, Type.Array(EventTypeSchema, { maxItems: 20 })]),
    ),
  }),
]);
export type ListActivityQuery = Static<typeof ListActivityQuery>;
